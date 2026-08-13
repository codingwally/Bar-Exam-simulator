-- Examination Room candidate-level results and independent lifecycle controls.
--
-- This migration is additive. It preserves legacy classwide releases while
-- allowing an owning Professor to release one or more fully graded candidates
-- without sealing the examination, revoking unrelated access, or waiting for
-- the rest of the class.

begin;

-- -------------------------------------------------------------------------
-- Candidate-level result release records
-- -------------------------------------------------------------------------

create table if not exists public.exam_room_result_release_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  released_by uuid not null references auth.users(id) on delete restrict,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{64}$'),
  include_questionnaire boolean not null default false,
  requested_count integer not null check (requested_count between 1 and 500),
  released_count integer not null default 0 check (released_count between 0 and 500),
  skipped_count integer not null default 0 check (skipped_count between 0 and 500),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (released_by, request_key),
  constraint exam_room_release_batch_counts_check check (
    released_count + skipped_count <= requested_count
  )
);

create table if not exists public.exam_room_candidate_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.exam_room_result_release_batches(id) on delete restrict,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  version integer not null check (version between 1 and 1000),
  released_by uuid not null references auth.users(id) on delete restrict,
  include_questionnaire boolean not null default false,
  source_grade_hash text not null check (source_grade_hash ~ '^[0-9a-f]{64}$'),
  result_snapshot jsonb not null check (
    jsonb_typeof(result_snapshot) = 'object'
    and octet_length(result_snapshot::text) between 2 and 2097152
  ),
  release_kind text not null check (release_kind in ('initial', 'correction')),
  supersedes_id uuid references public.exam_room_candidate_releases(id) on delete restrict,
  released_at timestamptz not null default now(),
  unique (attempt_id, version),
  unique (batch_id, attempt_id),
  constraint exam_room_candidate_release_version_check check (
    (version = 1 and release_kind = 'initial' and supersedes_id is null)
    or (version > 1 and release_kind = 'correction' and supersedes_id is not null)
  )
);

create index if not exists exam_room_candidate_releases_exam_idx
  on public.exam_room_candidate_releases (exam_id, released_at desc);
create index if not exists exam_room_candidate_releases_attempt_idx
  on public.exam_room_candidate_releases (attempt_id, version desc);

alter table public.exam_room_email_jobs
  add column if not exists candidate_release_id uuid
    references public.exam_room_candidate_releases(id) on delete restrict;
create index if not exists exam_room_email_candidate_release_idx
  on public.exam_room_email_jobs (candidate_release_id, created_at desc)
  where candidate_release_id is not null;

alter table public.exam_room_result_release_batches enable row level security;
alter table public.exam_room_result_release_batches force row level security;
alter table public.exam_room_candidate_releases enable row level security;
alter table public.exam_room_candidate_releases force row level security;
revoke all on table public.exam_room_result_release_batches from public, anon, authenticated, service_role;
revoke all on table public.exam_room_candidate_releases from public, anon, authenticated, service_role;
grant select, insert, update on table public.exam_room_result_release_batches to service_role;
grant select, insert on table public.exam_room_candidate_releases to service_role;

-- -------------------------------------------------------------------------
-- Independent administrative lifecycle dimensions
-- -------------------------------------------------------------------------

alter table public.exam_room_exams
  add column if not exists access_ended_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_lifecycle_order_check;
alter table public.exam_room_exams
  add constraint exam_room_exams_lifecycle_order_check check (
    (completed_at is null or access_ended_at is not null)
    and (archived_at is null or completed_at is not null)
  ) not valid;

create index if not exists exam_room_exams_lifecycle_idx
  on public.exam_room_exams (owner_professor_id, archived_at, completed_at, access_ended_at, updated_at desc);

-- -------------------------------------------------------------------------
-- Candidate release command
-- -------------------------------------------------------------------------

create or replace function public.exam_room_release_candidate_results_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_ids uuid[],
  p_include_questionnaire boolean,
  p_request_key text,
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
  v_selection uuid[];
  v_selection_hash text;
  v_batch public.exam_room_result_release_batches%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_latest public.exam_room_candidate_releases%rowtype;
  v_release public.exam_room_candidate_releases%rowtype;
  v_grade_snapshot jsonb;
  v_grade_hash text;
  v_questions jsonb;
  v_grades jsonb;
  v_released integer := 0;
  v_skipped integer := 0;
  v_version integer;
  v_email_type text;
  v_event_key text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_attempt_public_ids is null
    or cardinality(p_attempt_public_ids) not between 1 and 500
    or cardinality(p_attempt_public_ids) <> (
      select count(distinct selected_id)
      from unnest(p_attempt_public_ids) selected(selected_id)
    )
  then raise exception 'EXAM_ROOM_RESULT_SELECTION_INVALID'; end if;

  select array_agg(selected_id order by selected_id)
  into v_selection
  from unnest(p_attempt_public_ids) selected(selected_id);
  v_selection_hash := public.exam_room_hash_json(to_jsonb(v_selection));

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select * into v_batch
  from public.exam_room_result_release_batches batch
  where batch.released_by = p_professor_user_id
    and batch.request_key = p_request_key;
  if found then
    if v_batch.exam_id <> v_exam.id
      or v_batch.selection_hash <> v_selection_hash
      or v_batch.include_questionnaire <> coalesce(p_include_questionnaire, false)
    then raise exception 'EXAM_ROOM_RESULT_RELEASE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object(
      'ok', true,
      'batchId', v_batch.id,
      'requestedCount', v_batch.requested_count,
      'releasedCount', v_batch.released_count,
      'skippedCount', v_batch.skipped_count,
      'completedAt', v_batch.completed_at,
      'sealed', false,
      'idempotentReplay', true
    );
  end if;

  insert into public.exam_room_result_release_batches (
    exam_id, released_by, request_key, selection_hash,
    include_questionnaire, requested_count
  ) values (
    v_exam.id, p_professor_user_id, p_request_key, v_selection_hash,
    coalesce(p_include_questionnaire, false), cardinality(v_selection)
  ) returning * into v_batch;

  for v_attempt in
    select attempt.*
    from public.exam_room_attempts attempt
    where attempt.public_id = any(v_selection)
      and attempt.exam_id = v_exam.id
    order by attempt.public_id
    for update
  loop
    if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed') then
      raise exception 'EXAM_ROOM_FINAL_SUBMISSION_REQUIRED';
    end if;
    if exists (
      select 1
      from public.exam_room_questions question
      left join public.exam_room_grades grade
        on grade.attempt_id = v_attempt.id and grade.question_id = question.id
      where question.question_version_id = v_attempt.question_version_id
        and (grade.question_id is null or grade.grade_state <> 'final')
    ) or not exists (
      select 1 from public.exam_room_questions question
      where question.question_version_id = v_attempt.question_version_id
    ) then
      raise exception 'EXAM_ROOM_FINAL_GRADES_REQUIRED';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', question.id,
      'ordinal', question.ordinal,
      'score', grade.score,
      'maximumPoints', grade.maximum_points,
      'comment', grade.professor_comment,
      'gradeState', grade.grade_state,
      'revision', grade.revision
    ) order by question.ordinal), '[]'::jsonb)
    into v_grade_snapshot
    from public.exam_room_questions question
    join public.exam_room_grades grade
      on grade.question_id = question.id and grade.attempt_id = v_attempt.id
    where question.question_version_id = v_attempt.question_version_id;
    v_grade_hash := public.exam_room_hash_json(v_grade_snapshot);

    select * into v_latest
    from public.exam_room_candidate_releases candidate_release
    where candidate_release.attempt_id = v_attempt.id
    order by candidate_release.version desc
    limit 1;
    if found
      and v_latest.source_grade_hash = v_grade_hash
      and v_latest.include_questionnaire = coalesce(p_include_questionnaire, false)
    then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_roster from public.exam_room_roster where id = v_attempt.roster_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', question.id,
      'ordinal', question.ordinal,
      'prompt', case when coalesce(p_include_questionnaire, false)
        then question.prompt_text else null end
    ) order by question.ordinal), '[]'::jsonb)
    into v_questions
    from public.exam_room_questions question
    where question.question_version_id = v_attempt.question_version_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', question.id,
      'ordinal', question.ordinal,
      'score', grade.score,
      'maximumPoints', grade.maximum_points,
      'comment', grade.professor_comment,
      'gradeRevision', grade.revision,
      'question', case when coalesce(p_include_questionnaire, false)
        then question.prompt_text else null end
    ) order by question.ordinal), '[]'::jsonb)
    into v_grades
    from public.exam_room_questions question
    join public.exam_room_grades grade
      on grade.question_id = question.id and grade.attempt_id = v_attempt.id
    where question.question_version_id = v_attempt.question_version_id;

    v_version := coalesce(v_latest.version, 0) + 1;
    insert into public.exam_room_candidate_releases (
      batch_id, exam_id, attempt_id, version, released_by,
      include_questionnaire, source_grade_hash, result_snapshot,
      release_kind, supersedes_id
    ) values (
      v_batch.id, v_exam.id, v_attempt.id, v_version, p_professor_user_id,
      coalesce(p_include_questionnaire, false), v_grade_hash,
      jsonb_build_object('questions', v_questions, 'grades', v_grades),
      case when v_version = 1 then 'initial' else 'correction' end,
      case when v_version = 1 then null else v_latest.id end
    ) returning * into v_release;

    v_email_type := case when v_version = 1 then 'student_result' else 'student_correction' end;
    v_event_key := 'candidate_release_' || replace(v_release.id::text, '-', '');
    insert into public.exam_room_email_jobs (
      exam_id, candidate_release_id, recipient_user_id, recipient_email,
      email_type, payload, status, next_attempt_at, event_key, delivery_status
    ) values (
      v_exam.id, v_release.id, v_attempt.student_user_id, v_roster.canonical_email,
      v_email_type,
      jsonb_build_object(
        'examId', v_exam.public_id,
        'title', v_exam.title,
        'studentName', coalesce(v_roster.display_name, v_attempt.candidate_number),
        'studentNumber', v_roster.student_number,
        'candidateNumber', v_attempt.candidate_number,
        'attemptId', v_attempt.public_id,
        'includeQuestionnaire', coalesce(p_include_questionnaire, false),
        'questions', v_questions,
        'grades', v_grades,
        'releaseVersion', v_version,
        'corrected', v_version > 1,
        'releasedAt', v_release.released_at
      ),
      'pending', clock_timestamp(), v_event_key, 'pending'
    ) on conflict (exam_id, email_type, recipient_email, event_key) do nothing;

    perform public.exam_room_queue_backup(
      v_exam.id,
      'grades_released',
      jsonb_build_object(
        'candidateReleaseId', v_release.id,
        'attemptId', v_attempt.public_id,
        'version', v_version,
        'sourceGradeHash', v_grade_hash,
        'releasedAt', v_release.released_at
      )
    );
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, v_attempt.id,
      'candidate_release', v_release.id,
      case when v_version = 1 then 'candidate_result_released' else 'candidate_result_corrected' end,
      p_request_key,
      jsonb_build_object(
        'version', v_version,
        'includeQuestionnaire', coalesce(p_include_questionnaire, false),
        'sourceGradeHash', v_grade_hash
      )
    );
    v_released := v_released + 1;
  end loop;

  if v_released + v_skipped <> cardinality(v_selection) then
    raise exception 'EXAM_ROOM_RESULT_SELECTION_INVALID';
  end if;

  update public.exam_room_result_release_batches
  set released_count = v_released,
      skipped_count = v_skipped,
      completed_at = clock_timestamp()
  where id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'ok', true,
    'batchId', v_batch.id,
    'requestedCount', v_batch.requested_count,
    'releasedCount', v_batch.released_count,
    'skippedCount', v_batch.skipped_count,
    'completedAt', v_batch.completed_at,
    'sealed', false,
    'idempotentReplay', false
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Student result, Professor dashboard, delivery, and export views
-- -------------------------------------------------------------------------

create or replace function public.exam_room_student_result(
  p_student_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_candidate_release public.exam_room_candidate_releases%rowtype;
  v_legacy_release public.exam_room_releases%rowtype;
  v_rows jsonb;
  v_include boolean;
  v_released_at timestamptz;
begin
  select * into v_exam from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_RESULT_NOT_FOUND'; end if;
  select * into v_attempt from public.exam_room_attempts attempt
  where attempt.exam_id = v_exam.id and attempt.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_RESULT_NOT_FOUND'; end if;

  select * into v_candidate_release
  from public.exam_room_candidate_releases candidate_release
  where candidate_release.attempt_id = v_attempt.id
  order by candidate_release.version desc
  limit 1;
  if found then
    v_include := v_candidate_release.include_questionnaire;
    v_released_at := v_candidate_release.released_at;
  else
    select * into v_legacy_release from public.exam_room_releases legacy_release
    where legacy_release.exam_id = v_exam.id;
    if not found or v_exam.status <> 'sealed' then
      raise exception 'EXAM_ROOM_RESULT_NOT_RELEASED';
    end if;
    v_include := v_legacy_release.include_questionnaire;
    v_released_at := v_legacy_release.released_at;
  end if;

  if v_candidate_release.id is not null then
    v_rows := coalesce(v_candidate_release.result_snapshot -> 'grades', '[]'::jsonb);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'ordinal', question.ordinal,
      'question', case when v_include then question.prompt_text else null end,
      'score', grade.score,
      'maximumPoints', grade.maximum_points,
      'comment', grade.professor_comment,
      'gradeRevision', grade.revision
    ) order by question.ordinal), '[]'::jsonb)
    into v_rows
    from public.exam_room_questions question
    join public.exam_room_grades grade
      on grade.question_id = question.id and grade.attempt_id = v_attempt.id
    where question.question_version_id = v_attempt.question_version_id
      and grade.grade_state = 'final';
  end if;

  return jsonb_build_object(
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'candidateNumber', v_attempt.candidate_number,
    'releasedAt', v_released_at,
    'includeQuestionnaire', v_include,
    'releaseVersion', coalesce(v_candidate_release.version, 1),
    'corrected', coalesce(v_candidate_release.version, 1) > 1,
    'grades', v_rows
  );
end;
$$;

create or replace function public.exam_room_professor_results_dashboard_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_base jsonb;
  v_candidates jsonb;
  v_released_count integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_base := public.exam_room_professor_results_dashboard_v1(
    p_professor_user_id, p_exam_public_id
  );

  select coalesce(jsonb_agg(candidate || jsonb_build_object(
    'released', latest.release_id is not null or coalesce((v_base ->> 'released')::boolean, false),
    'releaseVersion', latest.version,
    'releasedAt', latest.released_at,
    'releaseKind', latest.release_kind,
    'deliveryStatus', coalesce(latest.delivery_status,
      case when coalesce((v_base ->> 'released')::boolean, false) then 'legacy_released' else 'not_queued' end),
    'deliveredAt', latest.delivered_at,
    'deliveryErrorCode', latest.safe_error_code,
    'resultRetryable', latest.release_id is not null
      and coalesce(latest.delivery_status, 'not_queued') not in ('delivered', 'complained')
  ) order by candidate ->> 'studentName'), '[]'::jsonb)
  into v_candidates
  from jsonb_array_elements(v_base -> 'candidates') candidate
  left join lateral (
    select candidate_release.id release_id,
      candidate_release.version,
      candidate_release.released_at,
      candidate_release.release_kind,
      email_job.delivery_status,
      email_job.delivered_at,
      email_job.safe_error_code
    from public.exam_room_attempts attempt
    join public.exam_room_candidate_releases candidate_release
      on candidate_release.attempt_id = attempt.id
    left join lateral (
      select job.delivery_status, job.delivered_at, job.safe_error_code
      from public.exam_room_email_jobs job
      where job.candidate_release_id = candidate_release.id
      order by job.created_at desc, job.id desc
      limit 1
    ) email_job on true
    where attempt.public_id = (candidate ->> 'attemptId')::uuid
    order by candidate_release.version desc
    limit 1
  ) latest on true;

  select count(distinct candidate_release.attempt_id)::integer into v_released_count
  from public.exam_room_candidate_releases candidate_release
  where candidate_release.exam_id = v_exam.id;

  return v_base || jsonb_build_object(
    'candidates', v_candidates,
    'releasedCount', v_released_count,
    'allReleased', jsonb_array_length(v_candidates) > 0
      and v_released_count = jsonb_array_length(v_candidates),
    'accessEndedAt', v_exam.access_ended_at,
    'completedAt', v_exam.completed_at,
    'archivedAt', v_exam.archived_at,
    'administrativeState', case
      when v_exam.archived_at is not null then 'archived'
      when v_exam.completed_at is not null then 'completed'
      when v_exam.access_ended_at is not null then 'student_access_ended'
      else 'active'
    end
  );
end;
$$;

create or replace function public.exam_room_result_delivery_report_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dashboard jsonb;
  v_candidates jsonb;
  v_summary jsonb;
begin
  v_dashboard := public.exam_room_professor_results_dashboard_v2(
    p_professor_user_id, p_exam_public_id
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', candidate ->> 'attemptId',
    'candidateNumber', candidate ->> 'candidateNumber',
    'studentName', candidate ->> 'studentName',
    'studentNumber', candidate ->> 'studentNumber',
    'studentEmail', candidate ->> 'studentEmail',
    'released', coalesce((candidate ->> 'released')::boolean, false),
    'releaseVersion', nullif(candidate ->> 'releaseVersion', '')::integer,
    'releasedAt', candidate -> 'releasedAt',
    'deliveryStatus', coalesce(candidate ->> 'deliveryStatus', 'not_queued'),
    'deliveredAt', candidate -> 'deliveredAt',
    'safeErrorCode', candidate ->> 'deliveryErrorCode',
    'retryable', coalesce((candidate ->> 'resultRetryable')::boolean, false)
  ) order by candidate ->> 'studentName'), '[]'::jsonb)
  into v_candidates
  from jsonb_array_elements(v_dashboard -> 'candidates') candidate;

  select jsonb_build_object(
    'total', count(*),
    'released', count(*) filter (where coalesce((item ->> 'released')::boolean, false)),
    'delivered', count(*) filter (where item ->> 'deliveryStatus' = 'delivered'),
    'accepted', count(*) filter (where item ->> 'deliveryStatus' = 'accepted'),
    'delayed', count(*) filter (where item ->> 'deliveryStatus' = 'delayed'),
    'failed', count(*) filter (where item ->> 'deliveryStatus' in ('failed', 'bounced', 'complained')),
    'pending', count(*) filter (where item ->> 'deliveryStatus' in ('pending', 'not_queued', 'unknown'))
  ) into v_summary from jsonb_array_elements(v_candidates) item;

  return jsonb_build_object(
    'ok', true,
    'examId', p_exam_public_id,
    'released', coalesce((v_summary ->> 'released')::integer, 0) > 0,
    'generatedAt', clock_timestamp(),
    'summary', v_summary,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_retry_student_result_email_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_release public.exam_room_candidate_releases%rowtype;
  v_source public.exam_room_email_jobs%rowtype;
  v_retry public.exam_room_email_jobs%rowtype;
  v_count integer;
  v_event_key text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID'; end if;
  select * into v_exam from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select * into v_attempt from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id and attempt.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_release from public.exam_room_candidate_releases candidate_release
  where candidate_release.attempt_id = v_attempt.id
  order by candidate_release.version desc limit 1;
  if not found then
    return public.exam_room_retry_student_result_email_v1(
      p_professor_user_id, p_exam_public_id, p_attempt_public_id, p_request_key
    );
  end if;
  select count(*)::integer into v_count from public.exam_room_email_jobs job
  where job.candidate_release_id = v_release.id;
  if v_count < 1 then raise exception 'EXAM_ROOM_RESULT_EMAIL_NOT_FOUND'; end if;
  if v_count >= 4 then raise exception 'EXAM_ROOM_EMAIL_RETRY_LIMIT'; end if;
  select * into v_source from public.exam_room_email_jobs job
  where job.candidate_release_id = v_release.id
  order by job.created_at desc, job.id desc limit 1;
  v_event_key := 'candidate_retry_' || substr(md5(p_request_key || v_source.id::text), 1, 32);
  select * into v_retry from public.exam_room_email_jobs job
  where job.exam_id = v_exam.id and job.email_type = v_source.email_type
    and job.recipient_email = v_source.recipient_email and job.event_key = v_event_key;
  if not found then
    insert into public.exam_room_email_jobs (
      exam_id, candidate_release_id, recipient_user_id, recipient_email,
      email_type, payload, status, next_attempt_at, event_key, delivery_status
    ) values (
      v_exam.id, v_release.id, v_source.recipient_user_id, v_source.recipient_email,
      v_source.email_type, v_source.payload, 'pending', clock_timestamp(),
      v_event_key, 'pending'
    ) returning * into v_retry;
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, v_attempt.id,
      'candidate_release', v_release.id, 'candidate_result_email_retried',
      p_request_key,
      jsonb_build_object('version', v_release.version, 'priorDeliveryStatus', v_source.delivery_status)
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'attemptId', v_attempt.public_id,
    'releaseVersion', v_release.version,
    'queued', true,
    'deliveryStatus', v_retry.delivery_status
  );
end;
$$;

create or replace function public.exam_room_prepare_class_result_export_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_selected_attempt_public_ids uuid[],
  p_export_scope text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_selected_candidate_numbers text[];
begin
  v_result := public.exam_room_prepare_class_result_export_v1(
    p_professor_user_id, p_exam_public_id, p_selected_attempt_public_ids,
    p_export_scope, p_request_key
  );
  if p_selected_attempt_public_ids is null or cardinality(p_selected_attempt_public_ids) = 0 then
    return v_result;
  end if;
  select coalesce(array_agg(candidate ->> 'candidateNumber'), '{}'::text[])
  into v_selected_candidate_numbers
  from jsonb_array_elements(v_result -> 'dataset' -> 'candidates') candidate;
  return jsonb_set(
    v_result,
    '{dataset,classStatuses}',
    coalesce((
      select jsonb_agg(class_status order by class_status ->> 'studentName')
      from jsonb_array_elements(v_result -> 'dataset' -> 'classStatuses') class_status
      where class_status ->> 'candidateNumber' = any(v_selected_candidate_numbers)
    ), '[]'::jsonb),
    true
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Separate end-access, complete, and archive actions
-- -------------------------------------------------------------------------

create or replace function public.exam_room_update_lifecycle_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_action text,
  p_reason text,
  p_request_key text,
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
  v_now timestamptz := clock_timestamp();
  v_changed boolean := false;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_action not in ('end_access', 'complete', 'archive')
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
  then raise exception 'EXAM_ROOM_LIFECYCLE_INPUT_INVALID'; end if;
  select * into v_exam from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  if v_exam.status = 'sealed' then
    return jsonb_build_object(
      'ok', true,
      'examId', v_exam.public_id,
      'administrativeState', 'completed',
      'legacySealed', true,
      'changed', false
    );
  end if;
  if p_action = 'end_access' and v_exam.access_ended_at is null then
    update public.exam_room_exams
    set access_ended_at = v_now,
        status = case when status in ('open', 'scheduled', 'confirmed') then 'closed' else status end,
        updated_at = v_now
    where id = v_exam.id;
    update public.exam_room_credentials
    set status = 'revoked', revoked_by = p_professor_user_id,
        revoked_at = v_now, revoke_reason = btrim(p_reason)
    where exam_id = v_exam.id and credential_type = 'student_exam' and status = 'active';
    v_changed := true;
  elsif p_action = 'complete' and v_exam.completed_at is null then
    if v_exam.access_ended_at is null then raise exception 'EXAM_ROOM_END_ACCESS_REQUIRED'; end if;
    update public.exam_room_exams
    set completed_at = v_now,
        status = case when status = 'closed' then 'grading' else status end,
        updated_at = v_now
    where id = v_exam.id;
    v_changed := true;
  elsif p_action = 'archive' and v_exam.archived_at is null then
    if v_exam.completed_at is null then raise exception 'EXAM_ROOM_COMPLETE_REQUIRED'; end if;
    update public.exam_room_exams set archived_at = v_now, updated_at = v_now
    where id = v_exam.id;
    v_changed := true;
  end if;

  select * into v_exam from public.exam_room_exams where id = v_exam.id;
  if v_changed then
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, null,
      'exam_lifecycle', v_exam.id,
      case p_action
        when 'end_access' then 'student_access_ended'
        when 'complete' then 'examination_completed'
        else 'examination_archived'
      end,
      p_request_key,
      jsonb_build_object('reason', btrim(p_reason))
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'accessEndedAt', v_exam.access_ended_at,
    'completedAt', v_exam.completed_at,
    'archivedAt', v_exam.archived_at,
    'administrativeState', case
      when v_exam.archived_at is not null then 'archived'
      when v_exam.completed_at is not null then 'completed'
      when v_exam.access_ended_at is not null then 'student_access_ended'
      else 'active'
    end,
    'changed', v_changed,
    'sealed', false
  );
end;
$$;

-- Browser roles remain deny-all; only the trusted Worker service role calls
-- the Examination Room functions.
revoke all on function public.exam_room_release_candidate_results_v1(uuid, uuid, uuid[], boolean, text, text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_student_result(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_professor_results_dashboard_v2(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_result_delivery_report_v2(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_retry_student_result_email_v2(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_prepare_class_result_export_v2(uuid, uuid, uuid[], text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_update_lifecycle_v1(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.exam_room_release_candidate_results_v1(uuid, uuid, uuid[], boolean, text, text, text)
  to service_role;
grant execute on function public.exam_room_student_result(uuid, uuid) to service_role;
grant execute on function public.exam_room_professor_results_dashboard_v2(uuid, uuid) to service_role;
grant execute on function public.exam_room_result_delivery_report_v2(uuid, uuid) to service_role;
grant execute on function public.exam_room_retry_student_result_email_v2(uuid, uuid, uuid, text) to service_role;
grant execute on function public.exam_room_prepare_class_result_export_v2(uuid, uuid, uuid[], text, text) to service_role;
grant execute on function public.exam_room_update_lifecycle_v1(uuid, uuid, text, text, text, text, text) to service_role;

comment on table public.exam_room_candidate_releases is
  'Immutable per-candidate result versions. Releasing a candidate does not seal the examination or affect classmates.';
comment on function public.exam_room_release_candidate_results_v1(uuid, uuid, uuid[], boolean, text, text, text) is
  'Idempotently releases selected fully final candidate results and queues one private email per changed result version.';

commit;
