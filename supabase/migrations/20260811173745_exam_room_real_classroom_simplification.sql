-- Examination Room real-classroom simplification.
--
-- This migration deliberately keeps publication, roster readiness, opening,
-- individual attempts, grading, and release as independent states. Existing
-- immutable publications, submissions, receipts, grades, and audit evidence
-- are never rewritten or deleted.

begin;

alter table public.exam_room_exams
  add column if not exists scheduled_opens_at timestamptz,
  add column if not exists opened_early_at timestamptz,
  add column if not exists opened_early_by uuid references auth.users(id) on delete set null;

update public.exam_room_exams
set scheduled_opens_at = opens_at
where scheduled_opens_at is null and opens_at is not null;

alter table public.exam_room_exams
  drop constraint if exists exam_room_opened_early_shape_check;
alter table public.exam_room_exams
  add constraint exam_room_opened_early_shape_check check (
    (opened_early_at is null and opened_early_by is null)
    or (opened_early_at is not null and opened_early_by is not null)
  );

create table if not exists public.exam_room_roster_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  source_kind text not null check (source_kind in ('xlsx', 'csv', 'paste', 'manual')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  normalized_rows jsonb not null check (
    jsonb_typeof(normalized_rows) = 'array'
    and jsonb_array_length(normalized_rows) between 1 and 500
  ),
  row_count integer not null check (row_count between 1 and 500),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp(),
  unique (exam_id, version_number),
  unique (exam_id, source_hash)
);

create table if not exists public.exam_room_student_code_attempt_windows (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  rate_key_hash text not null check (rate_key_hash ~ '^[0-9a-f]{64}$'),
  last_code_fingerprint text check (
    last_code_fingerprint is null or last_code_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  window_started_at timestamptz not null default clock_timestamp(),
  failures integer not null default 0 check (failures between 0 and 10),
  locked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (actor_user_id, rate_key_hash)
);

create table if not exists public.exam_room_grading_memberships (
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  professor_user_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references public.exam_room_credentials(id) on delete restrict,
  verified_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp(),
  primary key (exam_id, professor_user_id)
);

alter table public.exam_room_roster_versions enable row level security;
alter table public.exam_room_roster_versions force row level security;
alter table public.exam_room_student_code_attempt_windows enable row level security;
alter table public.exam_room_student_code_attempt_windows force row level security;
alter table public.exam_room_grading_memberships enable row level security;
alter table public.exam_room_grading_memberships force row level security;

revoke all privileges on table public.exam_room_roster_versions
  from public, anon, authenticated;
revoke all privileges on table public.exam_room_student_code_attempt_windows
  from public, anon, authenticated;
revoke all privileges on table public.exam_room_grading_memberships
  from public, anon, authenticated;
grant select, insert, update on table public.exam_room_roster_versions to service_role;
grant select, insert, update on table public.exam_room_student_code_attempt_windows to service_role;
grant select, insert, update, delete on table public.exam_room_grading_memberships to service_role;

create or replace function public.exam_room_open_exam_now_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_original_opens_at timestamptz;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'open_exam_now_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'EXAM_ROOM_OPEN_NOW_REASON_REQUIRED';
  end if;
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null
    or v_exam.release_id is not null
    or v_exam.status not in ('scheduled', 'open')
    or v_exam.hard_closes_at is null
    or clock_timestamp() >= v_exam.hard_closes_at
  then raise exception 'EXAM_ROOM_OPEN_NOW_NOT_ALLOWED'; end if;

  v_original_opens_at := coalesce(v_exam.scheduled_opens_at, v_exam.opens_at);
  if v_exam.opens_at is null or v_exam.opens_at > clock_timestamp() then
    update public.exam_room_exams
    set scheduled_opens_at = coalesce(scheduled_opens_at, opens_at),
        -- Legacy attempt-start validation compares against transaction_timestamp().
        -- Use the same clock boundary so "Open exam now" is immediately effective
        -- even when opening and admission are exercised in one atomic transaction.
        opens_at = transaction_timestamp(),
        opened_early_at = clock_timestamp(),
        opened_early_by = p_professor_user_id,
        status = 'open',
        updated_at = clock_timestamp()
    where id = v_exam.id
    returning * into v_exam;

    -- Student codes issued for the original schedule must become usable in the
    -- same instant as an authorized early opening.  Their expiry is preserved.
    update public.exam_room_credentials credential
    set valid_from = least(credential.valid_from, transaction_timestamp())
    where credential.exam_id = v_exam.id
      and credential.credential_type = 'student_exam'
      and credential.status = 'active'
      and credential.expires_at > transaction_timestamp();

    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, null, 'exam', v_exam.id,
      'exam_opened_early', p_request_key,
      jsonb_build_object(
        'scheduledOpensAt', v_original_opens_at,
        'openedAt', v_exam.opened_early_at,
        'hardClosesAt', v_exam.hard_closes_at,
        'reason', p_reason
      )
    );
  elsif v_exam.status = 'scheduled' then
    update public.exam_room_exams
    set status = 'open', updated_at = clock_timestamp()
    where id = v_exam.id
    returning * into v_exam;
  end if;

  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'scheduledOpensAt', coalesce(v_exam.scheduled_opens_at, v_original_opens_at),
    'opensAt', v_exam.opens_at,
    'openedEarlyAt', v_exam.opened_early_at,
    'hardClosesAt', v_exam.hard_closes_at
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'open_exam_now_v1', p_request_key,
    v_request, v_response
  );
end;
$$;

-- Extend the existing durable queue. Credential values remain encrypted with
-- the Worker-held AES key; only the delivery Worker decrypts them in memory.
alter table public.exam_room_email_jobs
  alter column exam_id drop not null;
alter table public.exam_room_email_jobs
  add column if not exists activation_id uuid
    references public.exam_room_professor_activations(id) on delete restrict;
alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_scope_v3_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_scope_v3_check check (
    (exam_id is not null)::integer + (activation_id is not null)::integer = 1
  ) not valid;
alter table public.exam_room_email_jobs
  validate constraint exam_room_email_jobs_scope_v3_check;
alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_email_type_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_email_type_check check (email_type in (
    'student_result', 'student_correction', 'professor_release_summary',
    'exam_publication_replaced', 'submission_reopened',
    'professor_room_key', 'professor_grading_key', 'beadle_key',
    'student_exam_code', 'professor_submission_notice',
    'student_submission_receipt'
  ));
create unique index if not exists exam_room_email_jobs_scope_event_v3_uq
  on public.exam_room_email_jobs (
    coalesce(exam_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(activation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    email_type, recipient_email, event_key
  );

create or replace function public.exam_room_generate_provisional_key_and_email_v1(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_code_ciphertext text,
  p_code_nonce text,
  p_code_key_id text,
  p_code_algorithm text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_activation_id uuid;
  v_email text;
  v_title text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_code_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or p_code_nonce !~ '^[A-Za-z0-9_-]{16}$'
    or p_code_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_code_algorithm <> 'A256GCM'
  then raise exception 'EXAM_ROOM_PROVISIONAL_KEY_INVALID'; end if;
  v_result := public.exam_room_generate_provisional_key(
    p_actor_user_id, p_request_public_id, p_token_hash,
    p_expires_at, p_request_key
  );
  v_activation_id := (v_result ->> 'activationId')::uuid;
  select request.professor_email, request.examination_title
  into v_email, v_title
  from public.exam_room_requests request
  where request.public_id = p_request_public_id;
  insert into public.exam_room_email_jobs (
    activation_id, recipient_email, email_type, payload, event_key
  ) values (
    v_activation_id, v_email, 'professor_room_key',
    jsonb_build_object(
      'title', v_title,
      'expiresAt', p_expires_at,
      'credentialEnvelope', jsonb_build_object(
        'examId', p_request_public_id,
        'tokenHash', p_token_hash,
        'ciphertext', p_code_ciphertext,
        'nonce', p_code_nonce,
        'keyId', p_code_key_id,
        'algorithm', p_code_algorithm
      )
    ),
    'activation_' || replace(v_activation_id::text, '-', '')
  ) on conflict do nothing;
  return v_result || jsonb_build_object('roomKeyEmailQueued', true);
end;
$$;

create or replace function public.exam_room_publish_for_beadle_and_email_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_revision bigint,
  p_rules jsonb,
  p_grading_key_hash text,
  p_grading_code_ciphertext text,
  p_grading_code_nonce text,
  p_grading_code_key_id text,
  p_grading_code_algorithm text,
  p_beadle_email text,
  p_beadle_token_hash text,
  p_beadle_code_ciphertext text,
  p_beadle_code_nonce text,
  p_beadle_code_key_id text,
  p_beadle_code_algorithm text,
  p_beadle_expires_at timestamptz,
  p_beadle_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_professor_email text;
  v_queued integer := 0;
begin
  if p_grading_key_hash !~ '^[0-9a-f]{64}$'
    or p_beadle_token_hash !~ '^[0-9a-f]{64}$'
    or p_grading_code_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or p_beadle_code_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or p_grading_code_nonce !~ '^[A-Za-z0-9_-]{16}$'
    or p_beadle_code_nonce !~ '^[A-Za-z0-9_-]{16}$'
    or p_grading_code_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_beadle_code_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_grading_code_algorithm <> 'A256GCM'
    or p_beadle_code_algorithm <> 'A256GCM'
  then raise exception 'EXAM_ROOM_CLASS_HANDOFF_INVALID'; end if;

  v_result := public.exam_room_publish_for_beadle_v4(
    p_professor_user_id, p_exam_public_id, p_expected_revision,
    p_rules, p_grading_key_hash, p_beadle_email, p_beadle_token_hash,
    p_beadle_expires_at, p_beadle_reason, p_request_key
  );
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  select lower(user_record.email) into v_professor_email
  from auth.users user_record where user_record.id = p_professor_user_id;

  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type, payload, event_key
  ) values (
    v_exam.id, p_professor_user_id, v_professor_email, 'professor_grading_key',
    jsonb_build_object(
      'title', v_exam.title, 'examId', v_exam.public_id,
      'hardClosesAt', v_exam.hard_closes_at,
      'credentialEnvelope', jsonb_build_object(
        'examId', v_exam.public_id, 'tokenHash', p_grading_key_hash,
        'ciphertext', p_grading_code_ciphertext, 'nonce', p_grading_code_nonce,
        'keyId', p_grading_code_key_id, 'algorithm', p_grading_code_algorithm
      )
    ),
    'publication_' || replace(v_exam.current_publication_id::text, '-', '')
  ) on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  get diagnostics v_queued = row_count;

  insert into public.exam_room_email_jobs (
    exam_id, recipient_email, email_type, payload, event_key
  ) values (
    v_exam.id, lower(btrim(p_beadle_email)), 'beadle_key',
    jsonb_build_object(
      'title', v_exam.title, 'examId', v_exam.public_id,
      'expiresAt', p_beadle_expires_at,
      'credentialEnvelope', jsonb_build_object(
        'examId', v_exam.public_id, 'tokenHash', p_beadle_token_hash,
        'ciphertext', p_beadle_code_ciphertext, 'nonce', p_beadle_code_nonce,
        'keyId', p_beadle_code_key_id, 'algorithm', p_beadle_code_algorithm
      )
    ),
    'publication_' || replace(v_exam.current_publication_id::text, '-', '')
  ) on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  v_queued := v_queued + case when found then 1 else 0 end;
  return v_result || jsonb_build_object('keyEmailsQueued', v_queued);
end;
$$;

create or replace function public.exam_room_submit_attempt_generation_v3(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_client_answer_set_hash text,
  p_request_key text,
  p_client_pending_at timestamptz default null,
  p_offline_since timestamptz default null,
  p_outage_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_submission public.exam_room_submissions%rowtype;
  v_student_email text;
  v_student_name text;
  v_professor_email text;
  v_event_key text;
  v_queued integer := 0;
begin
  v_result := public.exam_room_submit_attempt_generation_v2(
    p_student_user_id, p_attempt_public_id, p_session_public_id,
    p_session_epoch, p_client_answer_set_hash, p_request_key,
    p_client_pending_at, p_offline_since, p_outage_evidence
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then return v_result; end if;
  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.student_user_id = p_student_user_id;
  select * into v_exam from public.exam_room_exams exam where exam.id = v_attempt.exam_id;
  select * into v_submission
  from public.exam_room_submissions submission
  where submission.attempt_id = v_attempt.id
  order by submission.generation desc limit 1;
  if not found then raise exception 'EXAM_ROOM_SUBMISSION_NOT_FOUND'; end if;
  select roster.canonical_email, roster.display_name
  into v_student_email, v_student_name
  from public.exam_room_roster roster where roster.id = v_attempt.roster_id;
  select lower(user_record.email) into v_professor_email
  from auth.users user_record where user_record.id = v_exam.owner_professor_id;
  v_event_key := 'submission_g' || v_submission.generation::text
    || '_' || replace(v_attempt.id::text, '-', '');

  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type, payload, event_key
  ) values (
    v_exam.id, v_exam.owner_professor_id, v_professor_email,
    'professor_submission_notice',
    jsonb_build_object(
      'title', v_exam.title, 'examId', v_exam.public_id,
      'studentName', coalesce(v_student_name, v_attempt.candidate_number),
      'candidateNumber', v_attempt.candidate_number,
      'submittedAt', v_submission.committed_at,
      'generation', v_submission.generation
    ),
    v_event_key
  ) on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  get diagnostics v_queued = row_count;

  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type, payload, event_key
  ) values (
    v_exam.id, p_student_user_id, v_student_email,
    'student_submission_receipt',
    jsonb_build_object(
      'title', v_exam.title, 'examId', v_exam.public_id,
      'studentName', coalesce(v_student_name, v_attempt.candidate_number),
      'candidateNumber', v_attempt.candidate_number,
      'submittedAt', v_submission.committed_at,
      'generation', v_submission.generation,
      'receiptId', v_result ->> 'receiptId',
      'snapshotHash', v_submission.answer_snapshot_hash,
      'answers', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'questionId', question.id,
          'ordinal', question.ordinal,
          'questionText', question.prompt_text,
          'answerText', coalesce(answer_item.value ->> 'answerText', '')
        ) order by question.ordinal), '[]'::jsonb)
        from public.exam_room_questions question
        left join lateral (
          select answer.value
          from jsonb_array_elements(v_submission.answer_snapshot) answer(value)
          where answer.value ->> 'questionId' = question.id::text
          limit 1
        ) answer_item on true
        where question.question_version_id = v_attempt.question_version_id
      )
    ),
    v_event_key
  ) on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  v_queued := v_queued + case when found then 1 else 0 end;
  return v_result || jsonb_build_object(
    'submissionEmailsQueued', v_queued,
    'submissionEmailStatus', case when v_queued > 0 then 'queued' else 'already_queued' end
  );
end;
$$;

-- Resolve the active examination from the class-wide code without accepting
-- an exam identifier from the browser. Invalid codes receive one generic
-- response, so the endpoint cannot be used to enumerate examinations.
create or replace function public.exam_room_student_waiting_room_by_code_v1(
  p_student_user_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text,
  p_code_fingerprint text,
  p_device_instance_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window public.exam_room_student_code_attempt_windows%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_failures integer;
  v_result jsonb;
begin
  if p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
    or p_code_fingerprint !~ '^[0-9a-f]{64}$'
    or p_code_fingerprint <> p_student_key_hash
  then raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID'; end if;

  select * into v_window
  from public.exam_room_student_code_attempt_windows attempt_window
  where attempt_window.actor_user_id = p_student_user_id
    and attempt_window.rate_key_hash = p_rate_key_hash
  for update;
  if found and v_window.locked_until is not null and v_window.locked_until > v_now then
    return jsonb_build_object(
      'ok', false, 'code', 'STUDENT_CODE_LOCKED',
      'waitingRoom', true, 'canStart', false,
      'lockedUntil', v_window.locked_until, 'serverNow', v_now
    );
  end if;

  select exam.* into v_exam
  from public.exam_room_credentials credential
  join public.exam_room_student_access_issuances issuance
    on issuance.credential_id = credential.id and issuance.status = 'active'
  join public.exam_room_exams exam on exam.id = credential.exam_id
  where credential.credential_type = 'student_exam'
    and credential.status = 'active'
    and credential.token_hash = p_student_key_hash
    and credential.expires_at > v_now
    and exam.current_publication_id is not null
    and exam.release_id is null
    and exam.status <> 'sealed'
  limit 1;

  if not found then
    if v_window.id is null or v_window.window_started_at < v_now - interval '15 minutes' then
      insert into public.exam_room_student_code_attempt_windows (
        actor_user_id, rate_key_hash, last_code_fingerprint,
        window_started_at, failures, locked_until, updated_at
      ) values (
        p_student_user_id, p_rate_key_hash, p_code_fingerprint,
        v_now, 1, null, v_now
      )
      on conflict (actor_user_id, rate_key_hash) do update
      set last_code_fingerprint = excluded.last_code_fingerprint,
          window_started_at = excluded.window_started_at,
          failures = 1,
          locked_until = null,
          updated_at = excluded.updated_at
      returning failures into v_failures;
    else
      v_failures := least(v_window.failures + 1, 10);
      update public.exam_room_student_code_attempt_windows
      set last_code_fingerprint = p_code_fingerprint,
          failures = v_failures,
          locked_until = case when v_failures >= 10
            then v_now + interval '15 minutes' else null end,
          updated_at = v_now
      where id = v_window.id;
    end if;
    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (
      p_student_user_id, 'student_code_lookup_failed',
      jsonb_build_object('failureCount', v_failures)
    );
    return jsonb_build_object(
      'ok', false,
      'code', case when v_failures >= 10 then 'STUDENT_CODE_LOCKED' else 'STUDENT_CODE_INVALID' end,
      'waitingRoom', true, 'canStart', false, 'serverNow', v_now
    );
  end if;

  delete from public.exam_room_student_code_attempt_windows attempt_window
  where attempt_window.actor_user_id = p_student_user_id
    and attempt_window.rate_key_hash = p_rate_key_hash;

  v_result := public.exam_room_student_waiting_room_v4(
    p_student_user_id,
    v_exam.public_id,
    p_student_key_hash,
    p_rate_key_hash,
    p_device_instance_hash
  );
  return v_result || jsonb_build_object('resolvedByCode', true);
end;
$$;

create or replace function public.exam_room_start_attempt_by_code_v1(
  p_student_user_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text,
  p_code_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight jsonb;
begin
  v_preflight := public.exam_room_student_waiting_room_by_code_v1(
    p_student_user_id,
    p_student_key_hash,
    p_rate_key_hash,
    p_code_fingerprint,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_preflight ->> 'startBlockerCode', v_preflight ->> 'code'),
      'serverNow', v_preflight -> 'serverNow',
      'opensAt', v_preflight -> 'opensAt',
      'entryClosesAt', v_preflight -> 'entryClosesAt'
    );
  end if;
  return public.exam_room_start_attempt_v4(
    p_student_user_id,
    (v_preflight ->> 'examId')::uuid,
    p_student_key_hash,
    p_rate_key_hash
  );
end;
$$;

create or replace function public.exam_room_verify_grading_access_v3(
  p_professor_user_id uuid,
  p_exam_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.exam_room_grading_memberships%rowtype;
  v_credential jsonb;
  v_credential_id uuid;
begin
  select membership.* into v_membership
  from public.exam_room_grading_memberships membership
  join public.exam_room_credentials credential
    on credential.id = membership.credential_id
  where membership.exam_id = p_exam_id
    and membership.professor_user_id = p_professor_user_id
    and credential.status = 'active'
    and credential.credential_type = 'professor_grading'
    and credential.expires_at > clock_timestamp()
  for update of membership;
  if found then
    update public.exam_room_grading_memberships
    set last_used_at = clock_timestamp()
    where exam_id = p_exam_id and professor_user_id = p_professor_user_id;
    return jsonb_build_object('ok', true, 'remembered', true);
  end if;
  if p_grading_key_hash is null or p_rate_key_hash is null then
    return jsonb_build_object('ok', false, 'code', 'GRADING_KEY_REQUIRED');
  end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, p_exam_id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_credential ->> 'ok')::boolean, false) then return v_credential; end if;
  v_credential_id := (v_credential ->> 'credentialId')::uuid;
  insert into public.exam_room_grading_memberships (
    exam_id, professor_user_id, credential_id, verified_at, last_used_at
  ) values (
    p_exam_id, p_professor_user_id, v_credential_id,
    clock_timestamp(), clock_timestamp()
  ) on conflict (exam_id, professor_user_id) do update
  set credential_id = excluded.credential_id,
      verified_at = excluded.verified_at,
      last_used_at = excluded.last_used_at;
  return jsonb_build_object('ok', true, 'remembered', false);
exception
  when invalid_text_representation then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
end;
$$;

create or replace function public.exam_room_grading_workspace_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_access jsonb;
  v_candidates jsonb;
  v_class_statuses jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for share;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null then
    raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED';
  end if;
  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select coalesce(jsonb_agg(candidate_data order by student_name, candidate_number), '[]'::jsonb)
  into v_candidates
  from (
    select roster.display_name as student_name,
      attempt.candidate_number,
      jsonb_build_object(
        'attemptId', attempt.public_id,
        'candidateNumber', attempt.candidate_number,
        'studentName', coalesce(roster.display_name, attempt.candidate_number),
        'studentEmail', roster.canonical_email,
        'status', attempt.status,
        'submittedAt', attempt.submitted_at,
        'submissionGeneration', submission.generation,
        'unansweredCount', (
          select count(*)
          from jsonb_array_elements(submission.answer_snapshot) answer_entry
          where btrim(coalesce(answer_entry ->> 'answerText', '')) = ''
        ),
        'incidentCount', (
          select count(*) from public.exam_room_integrity_events incident
          where incident.attempt_id = attempt.id
        ),
        'questions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'questionId', question.id,
            'ordinal', question.ordinal,
            'prompt', question.prompt_text,
            'answer', coalesce((
              select answer_entry ->> 'answerText'
              from jsonb_array_elements(submission.answer_snapshot) answer_entry
              where answer_entry ->> 'questionId' = question.id::text
              limit 1
            ), ''),
            'maximumPoints', question.maximum_points,
            'score', grade.score,
            'comment', grade.professor_comment,
            'gradeState', grade.grade_state,
            'gradeRevision', coalesce(grade.revision, 0)
          ) order by question.ordinal), '[]'::jsonb)
          from public.exam_room_questions question
          left join public.exam_room_grades grade
            on grade.attempt_id = attempt.id and grade.question_id = question.id
          where question.question_version_id = attempt.question_version_id
        )
      ) candidate_data
    from public.exam_room_attempts attempt
    join public.exam_room_roster roster on roster.id = attempt.roster_id
    join lateral (
      select submitted.*
      from public.exam_room_submissions submitted
      where submitted.attempt_id = attempt.id
      order by submitted.generation desc
      limit 1
    ) submission on true
    where attempt.exam_id = v_exam.id
      and attempt.status in ('submitted', 'auto_submitted', 'sealed')
  ) candidate_rows;

  -- Status-only class data supports Professor filters without exposing any
  -- active student's autosaved draft. Answer text remains available only in
  -- v_candidates after a server-confirmed final submission exists.
  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', roster.candidate_number,
    'studentName', coalesce(roster.display_name, roster.candidate_number),
    'studentEmail', roster.canonical_email,
    'status', coalesce(attempt.status, admission.status, 'not_started'),
    'displayStatus', case
      when attempt.status in ('submitted', 'auto_submitted', 'sealed') then 'Submitted'
      when attempt.status = 'in_progress' then 'Active'
      when attempt.status = 'locked' then 'Active — review required'
      when admission.status = 'no_show' then 'Absent'
      when attempt.id is null and (
        v_exam.status in ('closed', 'grading', 'sealed')
        or (v_exam.hard_closes_at is not null and clock_timestamp() >= v_exam.hard_closes_at)
      ) then 'Absent'
      else 'Not started'
    end,
    'active', attempt.status in ('in_progress', 'locked'),
    'absent', admission.status = 'no_show' or (
      attempt.id is null and (
        v_exam.status in ('closed', 'grading', 'sealed')
        or (v_exam.hard_closes_at is not null and clock_timestamp() >= v_exam.hard_closes_at)
      )
    ),
    'accommodated', exists (
      select 1 from public.exam_room_accommodations accommodation
      where accommodation.exam_id = v_exam.id
        and accommodation.roster_id = roster.id
        and accommodation.status = 'active'
    ),
    'submittedAt', attempt.submitted_at
  ) order by coalesce(roster.display_name, roster.candidate_number), roster.candidate_number), '[]'::jsonb)
  into v_class_statuses
  from public.exam_room_roster roster
  left join public.exam_room_attempts attempt
    on attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
  left join public.exam_room_admissions admission
    on admission.exam_id = v_exam.id and admission.roster_id = roster.id
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active';

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'questionCount', v_exam.requested_question_count,
    'submittedCount', jsonb_array_length(v_candidates),
    'classExamStillOpen', v_exam.status in ('scheduled', 'open'),
    'classStatuses', v_class_statuses,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_save_grade_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_question_id uuid,
  p_score numeric,
  p_comment text,
  p_grade_state text,
  p_expected_revision integer,
  p_change_reason text,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_question public.exam_room_questions%rowtype;
  v_grade public.exam_room_grades%rowtype;
  v_access jsonb;
  v_revision integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if char_length(coalesce(p_comment, '')) > 5000
    or p_grade_state not in ('draft', 'final')
    or p_expected_revision is null or p_expected_revision < 0
    or char_length(btrim(coalesce(p_change_reason, ''))) not between 5 and 1000
  then raise exception 'EXAM_ROOM_GRADE_INVALID'; end if;
  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id and attempt.exam_id = v_exam.id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed')
    or not exists (
      select 1 from public.exam_room_submissions submission
      where submission.attempt_id = v_attempt.id
    )
  then raise exception 'EXAM_ROOM_GRADING_NOT_OPEN'; end if;

  select * into v_question
  from public.exam_room_questions question
  where question.id = p_question_id
    and question.question_version_id = v_attempt.question_version_id;
  if not found then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;
  if p_score < 0 or p_score > v_question.maximum_points then
    raise exception 'EXAM_ROOM_SCORE_INVALID';
  end if;

  select * into v_grade
  from public.exam_room_grades grade
  where grade.attempt_id = v_attempt.id and grade.question_id = p_question_id
  for update;
  if found and v_grade.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'GRADE_CONFLICT', 'revision', v_grade.revision);
  end if;
  if not found and p_expected_revision <> 0 then
    return jsonb_build_object('ok', false, 'code', 'GRADE_CONFLICT', 'revision', 0);
  end if;
  v_revision := case when found then v_grade.revision + 1 else 1 end;

  insert into public.exam_room_grades (
    attempt_id, question_id, score, maximum_points, professor_comment,
    grade_state, revision, graded_by, graded_at, finalized_at
  ) values (
    v_attempt.id, p_question_id, p_score, v_question.maximum_points,
    coalesce(p_comment, ''), p_grade_state, v_revision,
    p_professor_user_id, clock_timestamp(),
    case when p_grade_state = 'final' then clock_timestamp() else null end
  )
  on conflict (attempt_id, question_id) do update
  set score = excluded.score,
      maximum_points = excluded.maximum_points,
      professor_comment = excluded.professor_comment,
      grade_state = excluded.grade_state,
      revision = excluded.revision,
      graded_by = excluded.graded_by,
      graded_at = excluded.graded_at,
      finalized_at = excluded.finalized_at;

  insert into public.exam_room_grade_history (
    attempt_id, question_id, revision, score, maximum_points,
    professor_comment, grade_state, changed_by, change_reason
  ) values (
    v_attempt.id, p_question_id, v_revision, p_score,
    v_question.maximum_points, coalesce(p_comment, ''),
    p_grade_state, p_professor_user_id, p_change_reason
  );
  return jsonb_build_object(
    'ok', true, 'revision', v_revision,
    'gradeState', p_grade_state, 'savedAt', clock_timestamp()
  );
end;
$$;

create or replace function public.exam_room_grading_model_answer_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_model public.exam_room_publication_model_answers%rowtype;
  v_source public.exam_room_model_answer_sources%rowtype;
  v_access jsonb;
  v_response jsonb;
begin
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.exam_room_attempts attempt
    where attempt.exam_id = v_exam.id
      and attempt.status in ('submitted', 'auto_submitted', 'sealed')
  ) then return jsonb_build_object('ok', false, 'code', 'NO_SUBMITTED_EXAMS'); end if;
  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;
  select * into v_publication
  from public.exam_room_publications publication
  where publication.id = v_exam.current_publication_id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED'; end if;
  select * into v_model
  from public.exam_room_publication_model_answers model_answer
  where model_answer.publication_id = v_publication.id;
  if not found then
    v_response := jsonb_build_object(
      'ok', true, 'available', false, 'mode', 'none',
      'code', 'MODEL_ANSWER_NOT_CONFIGURED'
    );
  elsif v_model.mode = 'paste' then
    v_response := jsonb_build_object(
      'ok', true, 'available', true, 'mode', 'paste',
      'answerText', v_model.answer_text, 'contentHash', v_model.content_hash
    );
  else
    select * into v_source
    from public.exam_room_model_answer_sources source
    where source.id = v_model.source_id and source.exam_id = v_exam.id;
    if not found then raise exception 'EXAM_ROOM_MODEL_ANSWER_SOURCE_NOT_FOUND'; end if;
    v_response := jsonb_build_object(
      'ok', true, 'available', false, 'mode', 'upload',
      'code', 'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
      'safeFileName', v_source.safe_file_name,
      'mimeType', v_source.mime_type,
      'sizeBytes', v_source.size_bytes,
      'contentHash', v_model.content_hash
    );
  end if;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'publication', v_publication.id,
    'grading_model_answer_accessed', null,
    jsonb_build_object(
      'mode', v_response ->> 'mode',
      'available', coalesce((v_response ->> 'available')::boolean, false)
    )
  );
  return v_response;
end;
$$;

-- Defense in depth: a grade may target only a committed terminal submission.
-- Whole-class readiness remains a release/sealing concern, not a draft-grade
-- concern.
create or replace function public.exam_room_guard_submitted_grade_write_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.attempt_id is distinct from old.attempt_id
    or new.question_id is distinct from old.question_id
  ) then raise exception 'EXAM_ROOM_GRADE_IDENTITY_IMMUTABLE'; end if;
  if tg_op = 'DELETE' then raise exception 'EXAM_ROOM_GRADE_EVIDENCE_DELETE_FORBIDDEN'; end if;
  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.id = new.attempt_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams exam where exam.id = v_attempt.exam_id;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed')
    or not exists (
      select 1 from public.exam_room_submissions submission
      where submission.attempt_id = v_attempt.id
    )
  then raise exception 'EXAM_ROOM_GRADING_NOT_OPEN'; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_grade_write_guard_v2 on public.exam_room_grades;
drop trigger if exists exam_room_grade_write_guard_v3 on public.exam_room_grades;
create trigger exam_room_grade_write_guard_v3
before insert or update or delete on public.exam_room_grades
for each row execute function public.exam_room_guard_submitted_grade_write_v3();

-- Roster preparation is a classroom operation, not an exam-clock operation.
-- An authorized Beadle may revise it until release/seal. Existing attempt rows
-- are preserved by the atomic finalizer below.
create or replace function public.exam_room_can_manage_roster_v2(
  p_user_id uuid,
  p_exam_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.exam_room_exams exam
    where exam.id = p_exam_id
      and exam.current_publication_id is not null
      and exam.release_id is null
      and exam.status <> 'sealed'
      and (
        exam.owner_professor_id = p_user_id
        or exists (
          select 1
          from public.exam_room_beadle_assignments assignment
          where assignment.exam_id = exam.id
            and assignment.beadle_user_id = p_user_id
            and assignment.status = 'active'
            and assignment.expires_at > clock_timestamp()
            and assignment.can_manage_roster
        )
      )
  );
$$;

create or replace function public.exam_room_finalize_roster_access_v1(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_rows jsonb,
  p_source_kind text,
  p_source_hash text,
  p_student_key_hash text,
  p_code_ciphertext text,
  p_code_nonce text,
  p_code_key_id text,
  p_code_algorithm text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_prior public.exam_room_student_access_issuances%rowtype;
  v_credential public.exam_room_credentials%rowtype;
  v_issuance public.exam_room_student_access_issuances%rowtype;
  v_version integer;
  v_rows jsonb;
  v_row jsonb;
  v_roster public.exam_room_roster%rowtype;
  v_user_id uuid;
  v_roster_count integer := 0;
  v_removed_count integer := 0;
  v_preserved_count integer := 0;
  v_email_count integer := 0;
  v_roster_snapshot jsonb;
  v_roster_hash text;
  v_expires_at timestamptz;
  v_request jsonb;
  v_response jsonb;
begin
  if p_source_kind not in ('xlsx', 'csv', 'paste', 'manual')
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_code_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or char_length(p_code_ciphertext) not between 38 and 4096
    or p_code_nonce !~ '^[A-Za-z0-9_-]{16}$'
    or p_code_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_code_algorithm <> 'A256GCM'
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then raise exception 'EXAM_ROOM_ROSTER_FINALIZATION_INVALID'; end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_has_active_beadle_assignment_v2(p_actor_user_id, v_exam.id)
    or not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id)
  then raise exception 'EXAM_ROOM_BEADLE_REQUIRED'; end if;

  select * into v_publication
  from public.exam_room_publications publication
  where publication.id = v_exam.current_publication_id
  for share;
  if not found
    or not coalesce((v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean, false)
  then raise exception 'EXAM_ROOM_STUDENT_ACCESS_POLICY_MISMATCH'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(btrim(entry.value ->> 'email')),
    'displayName', btrim(coalesce(entry.value ->> 'displayName', entry.value ->> 'name', '')),
    'studentNumber', coalesce(
      nullif(btrim(entry.value ->> 'studentNumber'), ''),
      'AUTO-' || upper(substr(encode(extensions.digest(
        pg_catalog.convert_to(lower(btrim(entry.value ->> 'email')), 'UTF8'), 'sha256'
      ), 'hex'), 1, 12))
    ),
    'candidateNumber', coalesce(
      nullif(btrim(entry.value ->> 'candidateNumber'), ''),
      'CAND-' || upper(substr(encode(extensions.digest(
        pg_catalog.convert_to(lower(btrim(entry.value ->> 'email')), 'UTF8'), 'sha256'
      ), 'hex'), 13, 12))
    )
  ) order by entry.ordinality), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality);

  if exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    where row_value ->> 'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
      or char_length(row_value ->> 'displayName') not between 2 and 200
      or char_length(row_value ->> 'studentNumber') not between 1 and 120
      or char_length(row_value ->> 'candidateNumber') not between 1 and 120
  ) or exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    group by lower(row_value ->> 'email') having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    group by lower(row_value ->> 'studentNumber') having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    group by lower(row_value ->> 'candidateNumber') having count(*) > 1
  ) then raise exception 'EXAM_ROOM_ROSTER_FINALIZATION_INVALID'; end if;

  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'sourceKind', p_source_kind,
    'sourceHash', p_source_hash,
    'rowsHash', public.exam_room_hash_json(v_rows),
    'studentCredentialHash', p_student_key_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'finalize_roster_access_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;

  select coalesce(max(version_number), 0) + 1
  into v_version
  from public.exam_room_roster_versions version
  where version.exam_id = v_exam.id;

  insert into public.exam_room_roster_versions (
    exam_id, version_number, source_kind, source_hash,
    normalized_rows, row_count, confirmed_by
  ) values (
    v_exam.id, v_version, p_source_kind, p_source_hash,
    v_rows, jsonb_array_length(v_rows), p_actor_user_id
  ) on conflict (exam_id, source_hash) do update
  set confirmed_at = clock_timestamp()
  returning version_number into v_version;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    select user_record.id into v_user_id
    from auth.users user_record
    where lower(user_record.email) = v_row ->> 'email'
    limit 1;

    insert into public.exam_room_roster (
      classroom_id, student_user_id, canonical_email, student_number,
      candidate_number, display_name, status, created_by, updated_by
    ) values (
      v_exam.classroom_id, v_user_id, v_row ->> 'email',
      v_row ->> 'studentNumber', v_row ->> 'candidateNumber',
      v_row ->> 'displayName', 'active', p_actor_user_id, p_actor_user_id
    )
    on conflict (classroom_id, canonical_email) do update
    set student_user_id = coalesce(excluded.student_user_id, public.exam_room_roster.student_user_id),
        student_number = excluded.student_number,
        candidate_number = excluded.candidate_number,
        display_name = excluded.display_name,
        status = 'active',
        updated_by = excluded.updated_by,
        updated_at = clock_timestamp()
    returning * into v_roster;

    insert into public.exam_room_admissions (
      exam_id, roster_id, status, decided_by, decision_reason,
      decided_at, updated_at
    ) values (
      v_exam.id, v_roster.id, 'admitted', p_actor_user_id,
      'Admitted automatically from the confirmed class list.',
      clock_timestamp(), clock_timestamp()
    )
    on conflict (exam_id, roster_id) do update
    set status = case
          when public.exam_room_admissions.status in ('denied', 'withdrawn')
            then public.exam_room_admissions.status
          else 'admitted'
        end,
        decided_by = case
          when public.exam_room_admissions.status in ('denied', 'withdrawn')
            then public.exam_room_admissions.decided_by
          else excluded.decided_by
        end,
        decision_reason = case
          when public.exam_room_admissions.status in ('denied', 'withdrawn')
            then public.exam_room_admissions.decision_reason
          else excluded.decision_reason
        end,
        updated_at = clock_timestamp();
  end loop;

  update public.exam_room_roster roster
  set status = 'removed',
      updated_by = p_actor_user_id,
      updated_at = clock_timestamp()
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active'
    and not exists (
      select 1 from jsonb_array_elements(v_rows) incoming
      where incoming ->> 'email' = roster.canonical_email
    )
    and not exists (
      select 1 from public.exam_room_attempts attempt
      where attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
    );
  get diagnostics v_removed_count = row_count;

  select count(*)::integer into v_preserved_count
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active'
    and not exists (
      select 1 from jsonb_array_elements(v_rows) incoming
      where incoming ->> 'email' = roster.canonical_email
    )
    and exists (
      select 1 from public.exam_room_attempts attempt
      where attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'email', roster.canonical_email,
    'studentNumber', roster.student_number,
    'candidateNumber', roster.candidate_number,
    'displayName', roster.display_name
  ) order by roster.canonical_email), '[]'::jsonb), count(*)::integer
  into v_roster_snapshot, v_roster_count
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id and roster.status = 'active';
  if v_roster_count < 1 then raise exception 'EXAM_ROOM_STUDENT_ACCESS_ROSTER_REQUIRED'; end if;
  v_roster_hash := public.exam_room_hash_json(v_roster_snapshot);

  if exists (select 1 from public.exam_room_credentials where token_hash = p_student_key_hash)
    or exists (select 1 from public.exam_room_beadle_invitations where token_hash = p_student_key_hash)
    or exists (select 1 from public.exam_room_professor_activations where token_hash = p_student_key_hash)
  then raise exception 'EXAM_ROOM_CREDENTIAL_REUSE_FORBIDDEN'; end if;

  select * into v_prior
  from public.exam_room_student_access_issuances issuance
  where issuance.exam_id = v_exam.id and issuance.status = 'active'
  for update;
  if found then
    update public.exam_room_student_access_issuances
    set status = 'superseded', superseded_at = clock_timestamp(),
        code_ciphertext = null, code_nonce = null, code_key_id = null,
        code_algorithm = null, code_encrypted_at = null
    where id = v_prior.id;
  end if;
  update public.exam_room_credentials credential
  set status = 'revoked', revoked_by = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revoke_reason = 'Student access code rotated after class-list confirmation.'
  where credential.exam_id = v_exam.id
    and credential.credential_type = 'student_exam'
    and credential.status = 'active';

  v_expires_at := greatest(v_exam.hard_closes_at, coalesce((
    select max(coalesce(
      nullif(accommodation.configuration ->> 'individualHardClosesAt', '')::timestamptz,
      v_exam.hard_closes_at
    ) + make_interval(mins =>
      coalesce((accommodation.configuration ->> 'extraMinutes')::integer, 0)
      + coalesce((accommodation.configuration ->> 'incidentExtensionMinutes')::integer, 0)
    ))
    from public.exam_room_accommodations accommodation
    where accommodation.exam_id = v_exam.id and accommodation.status = 'active'
  ), v_exam.hard_closes_at));

  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values (
    v_exam.id, 'student_exam', p_student_key_hash, null, 'active',
    least(v_exam.opens_at, clock_timestamp()), v_expires_at, p_actor_user_id
  ) returning * into v_credential;

  insert into public.exam_room_student_access_issuances (
    exam_id, credential_id, roster_count, roster_snapshot_hash,
    request_key, issued_by, supersedes_issuance_id,
    code_ciphertext, code_nonce, code_key_id, code_algorithm, code_encrypted_at
  ) values (
    v_exam.id, v_credential.id, v_roster_count, v_roster_hash,
    p_request_key, p_actor_user_id, v_prior.id,
    p_code_ciphertext, p_code_nonce, p_code_key_id, p_code_algorithm,
    clock_timestamp()
  ) returning * into v_issuance;

  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type,
    payload, event_key
  )
  select v_exam.id, roster.student_user_id, roster.canonical_email,
    'student_exam_code',
    jsonb_build_object(
      'title', v_exam.title,
      'examId', v_exam.public_id,
      'opensAt', v_exam.opens_at,
      'hardClosesAt', v_exam.hard_closes_at,
      'studentName', roster.display_name,
      'credentialEnvelope', jsonb_build_object(
        'examId', v_exam.public_id,
        'tokenHash', p_student_key_hash,
        'ciphertext', p_code_ciphertext,
        'nonce', p_code_nonce,
        'keyId', p_code_key_id,
        'algorithm', p_code_algorithm
      )
    ),
    'roster_v' || v_version::text
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id and roster.status = 'active'
  on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  get diagnostics v_email_count = row_count;

  perform public.exam_room_queue_backup(
    v_exam.id, 'roster_imported',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'version', v_version,
      'sourceKind', p_source_kind,
      'sourceHash', p_source_hash,
      'rowCount', v_roster_count,
      'removedCount', v_removed_count,
      'preservedAttemptRows', v_preserved_count,
      'rows', v_roster_snapshot
    )
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'student_access_issuance', v_issuance.id,
    case when v_prior.id is null then 'class_list_confirmed' else 'class_list_replaced' end,
    p_request_key,
    jsonb_build_object(
      'rosterVersion', v_version,
      'rowCount', v_roster_count,
      'removedCount', v_removed_count,
      'preservedAttemptRows', v_preserved_count,
      'studentEmailsQueued', v_email_count
    )
  );

  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'rosterVersion', v_version,
    'rosterCount', v_roster_count,
    'removedCount', v_removed_count,
    'preservedAttemptRows', v_preserved_count,
    'issuanceId', v_issuance.id,
    'studentAccessReady', true,
    'studentEmailsQueued', v_email_count,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'finalize_roster_access_v1', p_request_key,
    v_request, v_response
  );
exception
  when unique_violation then
    raise exception 'EXAM_ROOM_ROSTER_IDENTIFIER_ALREADY_ASSIGNED';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_ROSTER_FINALIZATION_INVALID';
end;
$$;

revoke all on function public.exam_room_open_exam_now_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_open_exam_now_v1(uuid, uuid, text, text)
  to service_role;
revoke all on function public.exam_room_finalize_roster_access_v1(
  uuid, uuid, jsonb, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_finalize_roster_access_v1(
  uuid, uuid, jsonb, text, text, text, text, text, text, text, text
) to service_role;
revoke all on function public.exam_room_student_waiting_room_by_code_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_student_waiting_room_by_code_v1(
  uuid, text, text, text, text
) to service_role;
revoke all on function public.exam_room_start_attempt_by_code_v1(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_start_attempt_by_code_v1(
  uuid, text, text, text
) to service_role;
revoke all on function public.exam_room_verify_grading_access_v3(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_verify_grading_access_v3(
  uuid, uuid, text, text
) to service_role;
revoke all on function public.exam_room_grading_workspace_v3(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_grading_workspace_v3(
  uuid, uuid, text, text
) to service_role;
revoke all on function public.exam_room_save_grade_v3(
  uuid, uuid, uuid, uuid, numeric, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_save_grade_v3(
  uuid, uuid, uuid, uuid, numeric, text, text, integer, text, text, text
) to service_role;
revoke all on function public.exam_room_grading_model_answer_v3(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_grading_model_answer_v3(
  uuid, uuid, text, text
) to service_role;
revoke all on function public.exam_room_generate_provisional_key_and_email_v1(
  uuid, uuid, text, timestamptz, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_generate_provisional_key_and_email_v1(
  uuid, uuid, text, timestamptz, text, text, text, text, text
) to service_role;
revoke all on function public.exam_room_publish_for_beadle_and_email_v1(
  uuid, uuid, bigint, jsonb, text, text, text, text, text,
  text, text, text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_publish_for_beadle_and_email_v1(
  uuid, uuid, bigint, jsonb, text, text, text, text, text,
  text, text, text, text, text, text, timestamptz, text, text
) to service_role;
revoke all on function public.exam_room_submit_attempt_generation_v3(
  uuid, uuid, uuid, integer, text, text, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.exam_room_submit_attempt_generation_v3(
  uuid, uuid, uuid, integer, text, text, timestamptz, timestamptz, jsonb
) to service_role;
revoke all on function public.exam_room_guard_submitted_grade_write_v3()
  from public, anon, authenticated;
grant execute on function public.exam_room_guard_submitted_grade_write_v3()
  to service_role;

commit;
