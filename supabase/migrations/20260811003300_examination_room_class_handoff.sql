-- Examination Room classroom handoff.
--
-- The immutable examination publication is completed before roster work. The
-- publication freezes that a student access code is required, but no usable
-- student credential exists until the assigned Beadle saves the roster and
-- explicitly issues the exam-day handout. Invitation keys, student codes, and
-- Professor grading keys remain separate, hashed-at-rest credentials.

begin;

create table if not exists public.exam_room_student_access_issuances (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  credential_id uuid not null unique references public.exam_room_credentials(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'revoked')),
  roster_count integer not null check (roster_count between 1 and 500),
  roster_snapshot_hash text not null check (roster_snapshot_hash ~ '^[0-9a-f]{64}$'),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  supersedes_issuance_id uuid references public.exam_room_student_access_issuances(id) on delete restrict,
  superseded_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or char_length(btrim(revoke_reason)) between 5 and 1000
  ),
  unique (exam_id, request_key),
  constraint exam_room_student_access_superseded_shape_check check (
    status <> 'superseded' or superseded_at is not null
  ),
  constraint exam_room_student_access_revoked_shape_check check (
    status <> 'revoked'
    or (revoked_by is not null and revoked_at is not null and revoke_reason is not null)
  )
);

create unique index if not exists exam_room_student_access_one_active_idx
  on public.exam_room_student_access_issuances (exam_id)
  where status = 'active';

create index if not exists exam_room_student_access_exam_history_idx
  on public.exam_room_student_access_issuances (exam_id, issued_at desc);

create table if not exists public.exam_room_result_exports (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  professor_user_id uuid not null references auth.users(id) on delete restrict,
  export_scope text not null
    check (export_scope in ('questions_answers', 'answers_only', 'grades_comments')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  output_bytes integer check (output_bytes is null or output_bytes between 1 and 5242880),
  output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  unique (professor_user_id, request_key)
);

create index if not exists exam_room_result_exports_exam_idx
  on public.exam_room_result_exports (exam_id, requested_at desc);

-- A Beadle invitation is deliberately short-lived and one-use. Once the
-- invited account redeems it, the assignment is a separate authorization
-- whose lifetime follows the examination hard close, capped at one academic
-- term. Existing active beta assignments are extended on the same rule.
alter table public.exam_room_beadle_assignments
  drop constraint if exists exam_room_beadle_assignment_expiry_check;

update public.exam_room_beadle_assignments b
set expires_at = least(e.hard_closes_at, b.assigned_at + interval '180 days')
from public.exam_room_exams e
where e.id = b.exam_id
  and b.status = 'active'
  and e.status <> 'sealed'
  and e.release_id is null
  and e.hard_closes_at > now()
  and least(e.hard_closes_at, b.assigned_at + interval '180 days') > b.expires_at;

alter table public.exam_room_beadle_assignments
  add constraint exam_room_beadle_assignment_expiry_check
  check (expires_at > assigned_at and expires_at <= assigned_at + interval '180 days');

-- The handoff publisher uses a private scheduler that does not require a
-- roster. The legacy public scheduling command retains its roster gate, so an
-- older client cannot bypass the Beadle workflow during a rolling deployment.
-- This scheduler creates an unreturnable placeholder student credential; the
-- Beadle later rotates it to the first usable exam-day code.
create or replace function public.exam_room_schedule_for_handoff_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_opens_at timestamptz,
  p_hard_closes_at timestamptz,
  p_duration_minutes integer,
  p_student_key_hash text,
  p_grading_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_unlock_hash text;
  v_roster_count integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status not in ('confirmed', 'scheduled')
    or v_exam.active_question_version_id is null
    or v_exam.current_publication_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_EXAM_NOT_SCHEDULABLE'; end if;
  if p_opens_at is null
    or p_hard_closes_at is null
    or p_hard_closes_at <= p_opens_at
    or (p_duration_minutes is not null and p_duration_minutes not between 1 and 480)
    or p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_grading_key_hash !~ '^[0-9a-f]{64}$'
    or p_student_key_hash = p_grading_key_hash
  then raise exception 'EXAM_ROOM_SCHEDULE_INVALID'; end if;
  if p_opens_at < clock_timestamp() + interval '30 minutes' then
    raise exception 'EXAM_ROOM_HANDOFF_TIME_REQUIRED';
  end if;
  select count(*)::integer into v_roster_count
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';
  v_unlock_hash := encode(extensions.digest(
    pg_catalog.convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'
  ), 'hex');
  update public.exam_room_credentials
  set status = 'revoked', revoked_by = p_professor_user_id,
      revoked_at = now(), revoke_reason = 'Replaced during pre-publication scheduling.'
  where exam_id = v_exam.id and status = 'active'
    and credential_type in ('student_exam', 'professor_grading', 'attempt_unlock');
  update public.exam_room_exams
  set opens_at = p_opens_at,
      hard_closes_at = p_hard_closes_at,
      duration_minutes = p_duration_minutes,
      status = 'scheduled',
      updated_at = now()
  where id = v_exam.id;
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values
    (v_exam.id, 'student_exam', p_student_key_hash, null, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id),
    (v_exam.id, 'professor_grading', p_grading_key_hash, p_professor_user_id, 'active', p_hard_closes_at, p_hard_closes_at + interval '180 days', p_professor_user_id),
    (v_exam.id, 'attempt_unlock', v_unlock_hash, p_professor_user_id, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id);
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'exam_scheduled',
    jsonb_build_object(
      'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at,
      'durationMinutes', p_duration_minutes, 'credentialRotation', v_exam.status = 'scheduled',
      'rosterDeferred', v_roster_count = 0
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'exam', v_exam.id,
    case when v_exam.status = 'scheduled' then 'exam_rescheduled' else 'exam_scheduled' end,
    null, jsonb_build_object(
      'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at,
      'rosterDeferred', v_roster_count = 0
    )
  );
  return jsonb_build_object(
    'ok', true, 'examId', v_exam.public_id, 'status', 'scheduled',
    'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at,
    'credentialsRotated', v_exam.status = 'scheduled',
    'rosterDeferred', v_roster_count = 0
  );
end;
$$;

-- Redemption consumes the invitation exactly once, but the resulting
-- assignment no longer inherits the invitation's short expiry. The existing
-- release/seal trigger and explicit revocation command remain authoritative.
create or replace function public.exam_room_redeem_beadle_invitation_v2(
  p_beadle_user_id uuid,
  p_token_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.exam_room_beadle_invitations%rowtype;
  v_assignment public.exam_room_beadle_assignments%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_email text;
  v_assignment_expires_at timestamptz;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object('tokenHash', p_token_hash);
  v_response := public.exam_room_command_begin_v2(
    p_beadle_user_id, 'redeem_beadle_invitation_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_BEADLE_INVITATION_INVALID';
  end if;
  select lower(u.email) into v_email
  from auth.users u where u.id = p_beadle_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_invitation
  from public.exam_room_beadle_invitations i
  where i.token_hash = p_token_hash
  for update;
  if not found
    or v_invitation.status <> 'issued'
    or v_invitation.expires_at <= now()
    or v_invitation.target_email <> v_email
  then raise exception 'EXAM_ROOM_BEADLE_INVITATION_NOT_ACTIVE'; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.id = v_invitation.exam_id
  for share;
  if not found
    or v_exam.status = 'sealed'
    or v_exam.release_id is not null
    or (v_exam.hard_closes_at is not null and v_exam.hard_closes_at <= now())
  then raise exception 'EXAM_ROOM_BEADLE_DELEGATION_CLOSED'; end if;
  v_assignment_expires_at := least(
    coalesce(v_exam.hard_closes_at, now() + interval '7 days'),
    now() + interval '180 days'
  );
  insert into public.exam_room_beadle_assignments (
    exam_id, beadle_user_id, invitation_id, assigned_by, expires_at
  ) values (
    v_invitation.exam_id, p_beadle_user_id, v_invitation.id,
    v_invitation.invited_by, v_assignment_expires_at
  )
  on conflict (exam_id, beadle_user_id) do update
  set invitation_id = excluded.invitation_id,
      status = 'active',
      can_manage_roster = true,
      can_manage_operations = true,
      can_view_answers = false,
      assigned_by = excluded.assigned_by,
      assigned_at = now(),
      expires_at = excluded.expires_at,
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
  returning * into v_assignment;
  update public.exam_room_beadle_invitations
  set status = 'redeemed', redeemed_by = p_beadle_user_id, redeemed_at = now()
  where id = v_invitation.id;
  perform public.exam_room_append_audit_v2(
    p_beadle_user_id, v_invitation.exam_id, null,
    'beadle_assignment', v_assignment.id,
    'beadle_invitation_redeemed', p_request_key,
    jsonb_build_object(
      'invitationExpiresAt', v_invitation.expires_at,
      'assignmentExpiresAt', v_assignment.expires_at,
      'assignmentFollowsExamWindow', v_exam.hard_closes_at is not null
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'examId', v_exam.public_id,
    'canViewAnswers', false,
    'expiresAt', v_assignment.expires_at
  );
  return public.exam_room_command_complete_v2(
    p_beadle_user_id, 'redeem_beadle_invitation_v2',
    p_request_key, v_request, v_response
  );
end;
$$;

-- Roster work remains available after publication, but only before the exam
-- opens, before any attempt, and before a real student credential is issued.
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
    select 1 from public.exam_room_exams e
    where e.id = p_exam_id
      and (
        (e.owner_professor_id = p_user_id and e.current_publication_id is null)
        or exists (
          select 1 from public.exam_room_beadle_assignments b
          where b.exam_id = e.id and b.beadle_user_id = p_user_id
            and b.status = 'active' and b.expires_at > now()
            and b.can_manage_roster
        )
      )
      and e.status in ('draft', 'confirmed', 'scheduled')
      and e.release_id is null
      and (e.opens_at is null or now() < e.opens_at)
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = e.id)
      and not exists (
        select 1 from public.exam_room_student_access_issuances i
        where i.exam_id = e.id and i.status = 'active'
      )
      and not exists (
        select 1 from public.exam_room_exams other
        where other.classroom_id = e.classroom_id and other.id <> e.id
          and (other.current_publication_id is not null or other.status in ('open', 'closed', 'grading', 'sealed'))
      )
  );
$$;

create or replace function public.exam_room_import_exam_roster_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_rows jsonb,
  p_request_key text,
  p_source_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_row jsonb;
  v_user_id uuid;
  v_count integer := 0;
  v_removed_count integer := 0;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'rows', p_rows, 'sourceHash', p_source_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'import_exam_roster_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_ROSTER_REQUEST_INVALID';
  end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_ROSTER_LOCKED';
  end if;
  select * into v_class
  from public.exam_room_classrooms c
  where c.id = v_exam.classroom_id
  for update;
  v_validation := public.exam_room_validate_roster(
    v_exam.owner_professor_id, v_class.public_id, p_rows
  );
  if not (v_validation ->> 'ok')::boolean then return v_validation; end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select u.id into v_user_id
    from auth.users u
    where lower(u.email) = lower(btrim(v_row ->> 'email'))
    limit 1;
    insert into public.exam_room_roster (
      classroom_id, student_user_id, canonical_email, student_number,
      candidate_number, display_name, status, created_by, updated_by
    ) values (
      v_class.id, v_user_id, lower(btrim(v_row ->> 'email')),
      btrim(v_row ->> 'studentNumber'), btrim(v_row ->> 'candidateNumber'),
      nullif(btrim(v_row ->> 'displayName'), ''), 'active', p_actor_user_id, p_actor_user_id
    )
    on conflict (classroom_id, canonical_email) do update
    set student_user_id = excluded.student_user_id,
        student_number = excluded.student_number,
        candidate_number = excluded.candidate_number,
        display_name = excluded.display_name,
        status = 'active',
        updated_by = excluded.updated_by,
        updated_at = now();
    v_count := v_count + 1;
  end loop;
  -- A roster import is the authoritative class list for this exam. The
  -- roster gate above guarantees that no access credential or attempt exists,
  -- so entries omitted from a corrected upload can be removed safely.
  update public.exam_room_roster r
  set status = 'removed',
      updated_by = p_actor_user_id,
      updated_at = now()
  where r.classroom_id = v_class.id
    and r.status = 'active'
    and not exists (
      select 1
      from jsonb_array_elements(p_rows) incoming(value)
      where lower(btrim(incoming.value ->> 'email')) = r.canonical_email
    );
  get diagnostics v_removed_count = row_count;
  perform public.exam_room_queue_backup(
    v_exam.id, 'roster_imported',
    jsonb_build_object(
      'examId', v_exam.public_id, 'rowCount', v_count,
      'removedCount', v_removed_count,
      'sourceHash', p_source_hash, 'rows', p_rows,
      'publicationId', (
        select p.public_id from public.exam_room_publications p
        where p.id = v_exam.current_publication_id
      )
    )
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'exam_roster', v_exam.id,
    'exam_roster_imported', p_request_key,
    jsonb_build_object(
      'rowCount', v_count, 'removedCount', v_removed_count,
      'sourceHash', p_source_hash,
      'afterPublication', v_exam.current_publication_id is not null
    )
  );
  v_response := jsonb_build_object(
    'ok', true, 'imported', v_count, 'removed', v_removed_count,
    'sourceHash', p_source_hash,
    'studentAccessReady', false, 'rosterLocked', false
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'import_exam_roster_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_upsert_roster_row_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_row jsonb,
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
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_roster public.exam_room_roster%rowtype;
  v_user_id uuid;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'row', p_row, 'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'upsert_roster_row_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if jsonb_typeof(p_row) <> 'object'
    or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_ROSTER_REQUEST_INVALID'; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_ROSTER_LOCKED';
  end if;
  select * into v_class
  from public.exam_room_classrooms c
  where c.id = v_exam.classroom_id
  for update;
  v_validation := public.exam_room_validate_roster(
    v_exam.owner_professor_id, v_class.public_id, jsonb_build_array(p_row)
  );
  if not (v_validation ->> 'ok')::boolean then return v_validation; end if;
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_row ->> 'email'))
  limit 1;
  insert into public.exam_room_roster (
    classroom_id, student_user_id, canonical_email, student_number,
    candidate_number, display_name, status, created_by, updated_by
  ) values (
    v_class.id, v_user_id, lower(btrim(p_row ->> 'email')),
    btrim(p_row ->> 'studentNumber'), btrim(p_row ->> 'candidateNumber'),
    nullif(btrim(p_row ->> 'displayName'), ''), 'active', p_actor_user_id, p_actor_user_id
  )
  on conflict (classroom_id, canonical_email) do update
  set student_user_id = excluded.student_user_id,
      student_number = excluded.student_number,
      candidate_number = excluded.candidate_number,
      display_name = excluded.display_name,
      status = 'active',
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into v_roster;
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'exam_roster', v_roster.id,
    'exam_roster_row_changed', p_request_key,
    jsonb_build_object(
      'candidateNumber', v_roster.candidate_number,
      'reason', p_reason,
      'afterPublication', v_exam.current_publication_id is not null
    )
  );
  v_response := jsonb_build_object(
    'ok', true, 'candidateNumber', v_roster.candidate_number,
    'displayName', v_roster.display_name,
    'accountLinked', v_roster.student_user_id is not null,
    'studentAccessReady', false
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'upsert_roster_row_v2', p_request_key, v_request, v_response
  );
end;
$$;

-- One transaction schedules the exam, creates the immutable publication, and
-- issues the exact-email Beadle invitation. A failure in any part rolls back
-- every part; an exact request-key replay returns the original safe receipt.
create or replace function public.exam_room_publish_for_beadle_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_rules jsonb,
  p_grading_key_hash text,
  p_beadle_email text,
  p_beadle_token_hash text,
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
  v_exam public.exam_room_exams%rowtype;
  v_placeholder_hash text;
  v_schedule jsonb;
  v_publication jsonb;
  v_invitation jsonb;
  v_request jsonb;
  v_response jsonb;
  v_duration integer;
  v_opens_at timestamptz;
  v_hard_closes_at timestamptz;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'rules', p_rules,
    'gradingCredentialHash', p_grading_key_hash,
    'beadleEmail', lower(btrim(p_beadle_email)),
    'beadleCredentialHash', p_beadle_token_hash,
    'beadleExpiresAt', p_beadle_expires_at,
    'beadleReason', p_beadle_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'publish_for_beadle_v3', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is not null
    or v_exam.status not in ('confirmed', 'scheduled')
    or v_exam.active_question_version_id is null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_EXAM_NOT_PUBLISHABLE'; end if;
  if coalesce(jsonb_typeof(p_rules), 'null') <> 'object'
    or coalesce(jsonb_typeof(p_rules -> 'opensAt'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_rules -> 'hardClosesAt'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_rules -> 'studentAccessCodeRequired'), 'null') <> 'boolean'
    or not (p_rules ->> 'studentAccessCodeRequired')::boolean
    or p_grading_key_hash !~ '^[0-9a-f]{64}$'
    or p_beadle_token_hash !~ '^[0-9a-f]{64}$'
    or p_grading_key_hash = p_beadle_token_hash
  then raise exception 'EXAM_ROOM_CLASS_HANDOFF_INVALID'; end if;
  v_opens_at := (p_rules ->> 'opensAt')::timestamptz;
  v_hard_closes_at := (p_rules ->> 'hardClosesAt')::timestamptz;
  if v_opens_at < clock_timestamp() + interval '30 minutes' then
    raise exception 'EXAM_ROOM_HANDOFF_TIME_REQUIRED';
  end if;
  if exists (
      select 1 from public.exam_room_credentials c
      where c.token_hash = p_beadle_token_hash
    )
    or exists (
      select 1 from public.exam_room_professor_activations a
      where a.token_hash = p_beadle_token_hash
    )
    or exists (
      select 1 from public.exam_room_beadle_invitations i
      where i.token_hash = p_beadle_token_hash
    )
  then raise exception 'EXAM_ROOM_CREDENTIAL_REUSE_FORBIDDEN'; end if;
  if jsonb_typeof(p_rules -> 'durationMinutes') = 'null' then
    v_duration := null;
  else
    v_duration := (p_rules ->> 'durationMinutes')::integer;
  end if;
  v_placeholder_hash := encode(extensions.digest(
    extensions.gen_random_bytes(32), 'sha256'
  ), 'hex');
  v_schedule := public.exam_room_schedule_for_handoff_v3(
    p_professor_user_id,
    p_exam_public_id,
    v_opens_at,
    v_hard_closes_at,
    v_duration,
    v_placeholder_hash,
    p_grading_key_hash
  );
  if not coalesce((v_schedule ->> 'ok')::boolean, false) then
    raise exception 'EXAM_ROOM_SCHEDULE_FAILED';
  end if;
  v_publication := public.exam_room_publish_exam_v2(
    p_professor_user_id,
    p_exam_public_id,
    p_rules,
    v_placeholder_hash,
    p_request_key
  );
  if not coalesce((v_publication ->> 'ok')::boolean, false) then
    raise exception 'EXAM_ROOM_PUBLICATION_FAILED';
  end if;
  v_invitation := public.exam_room_issue_beadle_invitation_v2(
    p_professor_user_id,
    p_exam_public_id,
    p_beadle_email,
    p_beadle_token_hash,
    p_beadle_expires_at,
    p_beadle_reason,
    p_request_key
  );
  if not coalesce((v_invitation ->> 'ok')::boolean, false) then
    raise exception 'EXAM_ROOM_BEADLE_INVITATION_FAILED';
  end if;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'exam', v_exam.id,
    'exam_published_for_beadle_handoff', p_request_key,
    jsonb_build_object(
      'publicationId', v_publication -> 'publicationId',
      'invitationId', v_invitation -> 'invitationId',
      'targetEmailHash', public.exam_room_hash_json(to_jsonb(lower(btrim(p_beadle_email)))),
      'studentAccessPending', true
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', p_exam_public_id,
    'status', 'published_for_class_preparation',
    'publication', v_publication,
    'beadleInvitation', v_invitation,
    'studentAccessReady', false,
    'rosterRequiredBeforeStudentAccess', true,
    'nextStep', 'BEADLE_REDEEM_AND_UPLOAD_ROSTER'
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'publish_for_beadle_v3', p_request_key,
    v_request, v_response
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_CLASS_HANDOFF_INVALID';
end;
$$;

-- The assigned Beadle can issue or rotate the exam-day code only after a
-- successful roster save, before opening, and while no candidate attempt
-- exists. Rotation invalidates the prior code immediately and never returns it.
create or replace function public.exam_room_issue_student_access_v3(
  p_beadle_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
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
  v_roster_count integer;
  v_roster_snapshot jsonb;
  v_roster_hash text;
  v_expires_at timestamptz;
  v_entry_closes_at timestamptz;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'studentCredentialHash', p_student_key_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_beadle_user_id, 'issue_student_access_v3', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_student_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_STUDENT_ACCESS_INVALID';
  end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_has_active_beadle_assignment_v2(p_beadle_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_BEADLE_REQUIRED';
  end if;
  if v_exam.current_publication_id is null
    or v_exam.status <> 'scheduled'
    or v_exam.opens_at is null
    or now() >= v_exam.opens_at
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_STUDENT_ACCESS_NOT_ISSUABLE'; end if;
  select * into v_publication
  from public.exam_room_publications p
  where p.id = v_exam.current_publication_id
  for share;
  if not found
    or not coalesce((v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean, false)
  then raise exception 'EXAM_ROOM_STUDENT_ACCESS_POLICY_MISMATCH'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', r.canonical_email,
    'studentNumber', r.student_number,
    'candidateNumber', r.candidate_number
  ) order by r.canonical_email), '[]'::jsonb), count(*)::integer
  into v_roster_snapshot, v_roster_count
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';
  if v_roster_count < 1 then
    raise exception 'EXAM_ROOM_STUDENT_ACCESS_ROSTER_REQUIRED';
  end if;
  v_roster_hash := public.exam_room_hash_json(v_roster_snapshot);
  if exists (
      select 1 from public.exam_room_credentials c
      where c.token_hash = p_student_key_hash
    )
    or exists (
      select 1 from public.exam_room_beadle_invitations i
      where i.token_hash = p_student_key_hash
    )
    or exists (
      select 1 from public.exam_room_professor_activations a
      where a.token_hash = p_student_key_hash
    )
  then raise exception 'EXAM_ROOM_CREDENTIAL_REUSE_FORBIDDEN'; end if;
  select * into v_prior
  from public.exam_room_student_access_issuances i
  where i.exam_id = v_exam.id and i.status = 'active'
  for update;
  if found then
    update public.exam_room_student_access_issuances
    set status = 'superseded', superseded_at = now()
    where id = v_prior.id;
  end if;
  update public.exam_room_credentials c
  set status = 'revoked',
      revoked_by = p_beadle_user_id,
      revoked_at = now(),
      revoke_reason = case
        when v_prior.id is null then 'Placeholder replaced by Beadle-issued student access code.'
        else 'Student access code rotated before the examination opened.'
      end
  where c.exam_id = v_exam.id
    and c.credential_type = 'student_exam'
    and c.status = 'active';
  v_expires_at := greatest(v_exam.hard_closes_at, coalesce((
    select max(
      coalesce(
        nullif(a.configuration ->> 'individualHardClosesAt', '')::timestamptz,
        v_exam.hard_closes_at
      ) + make_interval(mins =>
        coalesce((a.configuration ->> 'extraMinutes')::integer, 0)
        + coalesce((a.configuration ->> 'incidentExtensionMinutes')::integer, 0)
      )
    )
    from public.exam_room_accommodations a
    where a.exam_id = v_exam.id and a.status = 'active'
  ), v_exam.hard_closes_at));
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values (
    v_exam.id, 'student_exam', p_student_key_hash, null, 'active',
    v_exam.opens_at, v_expires_at, p_beadle_user_id
  ) returning * into v_credential;
  insert into public.exam_room_student_access_issuances (
    exam_id, credential_id, roster_count, roster_snapshot_hash,
    request_key, issued_by, supersedes_issuance_id
  ) values (
    v_exam.id, v_credential.id, v_roster_count, v_roster_hash,
    p_request_key, p_beadle_user_id, v_prior.id
  ) returning * into v_issuance;
  v_entry_closes_at := least(
    v_exam.hard_closes_at,
    v_exam.opens_at + make_interval(mins => greatest(
      coalesce((v_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer, 0),
      1
    ))
  );
  perform public.exam_room_append_audit_v2(
    p_beadle_user_id, v_exam.id, null, 'student_access_issuance', v_issuance.id,
    case when v_prior.id is null
      then 'student_access_issued'
      else 'student_access_rotated'
    end,
    p_request_key,
    jsonb_build_object(
      'rosterCount', v_roster_count,
      'rosterSnapshotHash', v_roster_hash,
      'supersedesIssuanceId', v_prior.id,
      'opensAt', v_exam.opens_at,
      'expiresAt', v_expires_at
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'issuanceId', v_issuance.id,
    'issued', v_prior.id is null,
    'rotated', v_prior.id is not null,
    'studentAccessReady', true,
    'rosterLocked', true,
    'rosterCount', v_roster_count,
    'examPath', '/#examination-room',
    'entryPolicy', 'SIGNED_IN_ROSTER_AND_ACCESS_CODE',
    'opensAt', v_exam.opens_at,
    'entryClosesAt', v_entry_closes_at,
    'hardClosesAt', v_exam.hard_closes_at
  );
  return public.exam_room_command_complete_v2(
    p_beadle_user_id, 'issue_student_access_v3', p_request_key,
    v_request, v_response
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_STUDENT_ACCESS_INVALID';
end;
$$;

create or replace function public.exam_room_exam_access_v3(
  p_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_owner boolean;
  v_beadle boolean;
  v_operator boolean;
  v_roster_count integer := 0;
  v_question_count integer := 0;
  v_total_points numeric := 0;
  v_questions_ready boolean := false;
  v_invitation_issued boolean := false;
  v_beadle_assigned boolean := false;
  v_student_access_ready boolean := false;
  v_grading jsonb := '{}'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  v_base := public.exam_room_exam_access_v2(p_user_id, p_exam_public_id);
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_owner := v_exam.owner_professor_id = p_user_id;
  v_beadle := public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id);
  v_operator := v_owner or v_beadle;
  select count(*)::integer into v_roster_count
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';
  if v_exam.active_question_version_id is not null then
    select count(*)::integer, coalesce(sum(q.maximum_points), 0)
    into v_question_count, v_total_points
    from public.exam_room_questions q
    where q.question_version_id = v_exam.active_question_version_id;
  end if;
  v_questions_ready := v_exam.active_question_version_id is not null
    and v_question_count = v_exam.requested_question_count
    and v_question_count > 0;
  v_invitation_issued := exists (
    select 1 from public.exam_room_beadle_invitations i
    where i.exam_id = v_exam.id and i.status = 'issued' and i.expires_at > now()
  );
  v_beadle_assigned := exists (
    select 1 from public.exam_room_beadle_assignments b
    where b.exam_id = v_exam.id and b.status = 'active' and b.expires_at > now()
  );
  v_student_access_ready := exists (
    select 1
    from public.exam_room_student_access_issuances i
    join public.exam_room_credentials c on c.id = i.credential_id
    where i.exam_id = v_exam.id and i.status = 'active'
      and c.status = 'active' and c.credential_type = 'student_exam'
  );
  if v_exam.current_publication_id is not null then
    v_grading := public.exam_room_grading_readiness_v2(v_exam.id);
  end if;
  if not v_owner then v_blockers := v_blockers || jsonb_build_array('NOT_OWNER'); end if;
  if not v_questions_ready then
    v_blockers := v_blockers || jsonb_build_array('QUESTIONS_NOT_READY');
  end if;
  if v_exam.current_publication_id is not null then
    v_blockers := v_blockers || jsonb_build_array('ALREADY_PUBLISHED');
  end if;
  if v_exam.status not in ('confirmed', 'scheduled') then
    v_blockers := v_blockers || jsonb_build_array('EXAM_STATE_BLOCKED');
  end if;
  if exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id) then
    v_blockers := v_blockers || jsonb_build_array('CANDIDATE_ATTEMPTS_EXIST');
  end if;
  return v_base || jsonb_build_object(
    'rosterCount', case when v_operator then v_roster_count else null end,
    'totalPoints', case when v_operator then v_total_points else null end,
    'questionsReady', case when v_operator then v_questions_ready else null end,
    'published', v_exam.current_publication_id is not null,
    'beadleInvitationIssued', case when v_owner then v_invitation_issued else null end,
    'beadleAssigned', case when v_owner then v_beadle_assigned else null end,
    'studentAccessReady', case when v_operator then v_student_access_ready else null end,
    'canPublish', v_owner and jsonb_array_length(v_blockers) = 0,
    'publishBlockers', case when v_owner then v_blockers else '[]'::jsonb end,
    'gradingReady', case
      when v_owner and v_exam.current_publication_id is not null
      then coalesce((v_grading ->> 'ready')::boolean, false)
      else false
    end,
    'readyAt', case when v_owner then v_grading -> 'waitUntil' else null end,
    'nonTerminalAttemptCount', case
      when v_owner then coalesce((v_grading ->> 'nonTerminalAttemptCount')::integer, 0)
      else null
    end
  );
end;
$$;

create or replace function public.exam_room_beadle_portal_v3(
  p_user_id uuid,
  p_exam_public_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_roster_count integer := 0;
  v_can_edit boolean := false;
  v_can_issue boolean := false;
  v_access_ready boolean := false;
  v_lock_reason text;
  v_entry_closes_at timestamptz;
begin
  v_base := public.exam_room_beadle_portal_v2(p_user_id, p_exam_public_id);
  if p_exam_public_id is null then return v_base; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select * into v_publication
  from public.exam_room_publications p
  where p.id = v_exam.current_publication_id;
  select count(*)::integer into v_roster_count
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';
  v_access_ready := exists (
    select 1
    from public.exam_room_student_access_issuances i
    join public.exam_room_credentials c on c.id = i.credential_id
    where i.exam_id = v_exam.id and i.status = 'active'
      and c.status = 'active' and c.credential_type = 'student_exam'
  );
  v_can_edit := public.exam_room_can_manage_roster_v2(p_user_id, v_exam.id);
  v_can_issue := public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id)
    and v_exam.current_publication_id is not null
    and v_exam.status = 'scheduled'
    and v_exam.opens_at is not null
    and now() < v_exam.opens_at
    and v_roster_count > 0
    and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id);
  v_lock_reason := case
    when v_can_edit then null
    when v_access_ready then 'STUDENT_ACCESS_ISSUED'
    when exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
      then 'CANDIDATE_ATTEMPTS_EXIST'
    when v_exam.release_id is not null or v_exam.status = 'sealed'
      then 'RESULTS_RELEASED'
    when v_exam.opens_at is not null and now() >= v_exam.opens_at
      then 'EXAM_ALREADY_OPEN'
    else 'ROSTER_CHANGES_CLOSED'
  end;
  if v_publication.id is not null then
    v_entry_closes_at := least(
      v_exam.hard_closes_at,
      v_exam.opens_at + make_interval(mins => greatest(
        coalesce((v_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer, 0),
        1
      ))
    );
  end if;
  return v_base || jsonb_build_object(
    'rosterCount', v_roster_count,
    'canEditRoster', v_can_edit,
    'rosterLockedReason', v_lock_reason,
    'canIssueStudentAccess', v_can_issue,
    'studentAccessReady', v_access_ready,
    'examPath', '/#examination-room',
    'entryPolicy', 'SIGNED_IN_ROSTER_AND_ACCESS_CODE',
    'accessCodeRequired', coalesce(
      (v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean,
      true
    ),
    'entryClosesAt', v_entry_closes_at
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_PUBLICATION_RULES_INVALID';
end;
$$;

create or replace function public.exam_room_student_preflight_v3(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_device_instance_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_email text;
  v_accommodation jsonb := '{}'::jsonb;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_entry_closes_at timestamptz;
  v_late_minutes integer := 0;
  v_access_required boolean := true;
  v_access_ready boolean := false;
  v_blocker text;
  v_can_start boolean := false;
begin
  v_base := public.exam_room_student_preflight_v2(
    p_student_user_id, p_exam_public_id, p_device_instance_hash
  );
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select lower(u.email) into v_email
  from auth.users u where u.id = p_student_user_id;
  select * into v_roster
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and (r.student_user_id = p_student_user_id or r.canonical_email = v_email)
  limit 1;
  select * into v_publication
  from public.exam_room_publications p
  where p.id = v_exam.current_publication_id;
  if v_roster.id is not null then
    select a.configuration into v_accommodation
    from public.exam_room_accommodations a
    where a.exam_id = v_exam.id and a.roster_id = v_roster.id and a.status = 'active';
    v_accommodation := coalesce(v_accommodation, '{}'::jsonb);
    select * into v_attempt
    from public.exam_room_attempts a
    where a.exam_id = v_exam.id and a.roster_id = v_roster.id;
  end if;
  if v_publication.id is not null then
    v_access_required := coalesce(
      (v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean,
      true
    );
    v_late_minutes := coalesce(
      (v_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer,
      0
    );
    v_window_open := coalesce(
      nullif(v_accommodation ->> 'individualOpensAt', '')::timestamptz,
      v_exam.opens_at
    );
    v_window_close := coalesce(
      nullif(v_accommodation ->> 'individualHardClosesAt', '')::timestamptz,
      v_exam.hard_closes_at
    );
    v_entry_closes_at := least(
      v_window_close,
      v_window_open + make_interval(mins => greatest(v_late_minutes, 1))
    );
  end if;
  v_access_ready := not v_access_required or exists (
    select 1
    from public.exam_room_student_access_issuances i
    join public.exam_room_credentials c on c.id = i.credential_id
    where i.exam_id = v_exam.id and i.status = 'active'
      and c.status = 'active' and c.credential_type = 'student_exam'
  );
  if v_attempt.id is not null and v_attempt.status in ('in_progress', 'locked') then
    v_blocker := 'RESUME_READY';
    v_can_start := true;
  elsif v_attempt.id is not null and v_attempt.status in ('submitted', 'auto_submitted', 'sealed') then
    v_blocker := 'ATTEMPT_ALREADY_SUBMITTED';
  elsif not coalesce((v_base ->> 'eligible')::boolean, false) then
    v_blocker := coalesce(v_base ->> 'code', 'STUDENT_NOT_ELIGIBLE');
  elsif v_exam.status in ('grading', 'sealed') then
    v_blocker := 'EXAM_CLOSED';
  elsif v_window_open is null or now() < v_window_open then
    v_blocker := 'EXAM_NOT_OPEN';
  elsif v_entry_closes_at is null or now() >= v_entry_closes_at then
    v_blocker := 'LATE_ADMISSION_CLOSED';
  elsif not v_access_ready then
    v_blocker := 'STUDENT_ACCESS_NOT_READY';
  else
    v_blocker := 'READY';
    v_can_start := true;
  end if;
  return v_base || jsonb_build_object(
    'canStart', v_can_start,
    'startBlockerCode', v_blocker,
    'studentAccessReady', v_access_ready,
    'entryClosesAt', v_entry_closes_at
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_PUBLICATION_RULES_INVALID';
end;
$$;

create or replace function public.exam_room_start_attempt_v3(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight jsonb;
begin
  v_preflight := public.exam_room_student_preflight_v3(
    p_student_user_id, p_exam_public_id, null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', v_preflight ->> 'startBlockerCode',
      'entryClosesAt', v_preflight -> 'entryClosesAt',
      'studentAccessReady', v_preflight -> 'studentAccessReady'
    );
  end if;
  return public.exam_room_start_attempt(
    p_student_user_id, p_exam_public_id, p_student_key_hash, p_rate_key_hash
  );
end;
$$;

create or replace function public.exam_room_prepare_result_export_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_export_scope text,
  p_request_key text,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_submission public.exam_room_submissions%rowtype;
  v_export public.exam_room_result_exports%rowtype;
  v_credential jsonb;
  v_questions jsonb;
  v_question_count integer;
  v_final_grade_count integer;
  v_total_score numeric;
  v_total_maximum numeric;
  v_created boolean := false;
  v_response jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_export_scope not in ('questions_answers', 'answers_only', 'grades_comments')
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_RESULT_EXPORT_INVALID'; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_credential ->> 'ok')::boolean, false) then
    return v_credential;
  end if;
  select * into v_attempt
  from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed') then
    raise exception 'EXAM_ROOM_RESULT_EXPORT_NOT_READY';
  end if;
  select * into v_submission
  from public.exam_room_submissions s
  where s.attempt_id = v_attempt.id
  order by s.generation desc
  limit 1;
  if not found then raise exception 'EXAM_ROOM_SUBMISSION_REQUIRED'; end if;
  select count(*)::integer into v_question_count
  from public.exam_room_questions q
  where q.question_version_id = v_attempt.question_version_id;
  select count(*)::integer,
         coalesce(sum(g.score), 0),
         coalesce(sum(g.maximum_points), 0)
  into v_final_grade_count, v_total_score, v_total_maximum
  from public.exam_room_grades g
  where g.attempt_id = v_attempt.id and g.grade_state = 'final';
  if v_question_count < 1 or v_final_grade_count <> v_question_count then
    raise exception 'EXAM_ROOM_FINAL_GRADES_REQUIRED';
  end if;
  insert into public.exam_room_result_exports (
    exam_id, attempt_id, professor_user_id, export_scope, request_key
  ) values (
    v_exam.id, v_attempt.id, p_professor_user_id, p_export_scope, p_request_key
  )
  on conflict (professor_user_id, request_key) do nothing
  returning * into v_export;
  if found then
    v_created := true;
  else
    select * into v_export
    from public.exam_room_result_exports e
    where e.professor_user_id = p_professor_user_id
      and e.request_key = p_request_key;
    if not found
      or v_export.exam_id <> v_exam.id
      or v_export.attempt_id <> v_attempt.id
      or v_export.export_scope <> p_export_scope
    then raise exception 'EXAM_ROOM_REQUEST_KEY_REUSED'; end if;
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object('ordinal', q.ordinal)
    || case
      when p_export_scope = 'questions_answers' then jsonb_build_object(
        'prompt', q.prompt_text,
        'answer', coalesce(answer_item.value ->> 'answerText', '')
      )
      when p_export_scope = 'answers_only' then jsonb_build_object(
        'answer', coalesce(answer_item.value ->> 'answerText', '')
      )
      else jsonb_build_object(
        'score', g.score,
        'maximumPoints', g.maximum_points,
        'comment', g.professor_comment
      )
    end
    order by q.ordinal
  ), '[]'::jsonb)
  into v_questions
  from public.exam_room_questions q
  join public.exam_room_grades g
    on g.attempt_id = v_attempt.id and g.question_id = q.id and g.grade_state = 'final'
  left join lateral (
    select answer.value
    from jsonb_array_elements(v_submission.answer_snapshot) answer(value)
    where answer.value ->> 'questionId' = q.id::text
    limit 1
  ) answer_item on true
  where q.question_version_id = v_attempt.question_version_id;
  if v_created then
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, v_attempt.id,
      'result_export', v_export.id, 'result_export_accessed', p_request_key,
      jsonb_build_object(
        'scope', p_export_scope,
        'candidateNumber', v_attempt.candidate_number,
        'submissionGeneration', v_submission.generation,
        'questionCount', v_question_count
      )
    );
  end if;
  v_response := jsonb_build_object(
    'ok', true,
    'exportId', v_export.id,
    'examId', v_exam.public_id,
    'examTitle', v_exam.title,
    'candidateNumber', v_attempt.candidate_number,
    'scope', p_export_scope,
    'submittedAt', v_submission.committed_at,
    'generatedAt', v_export.requested_at,
    'questionCount', v_question_count,
    'questions', v_questions
  );
  if p_export_scope = 'grades_comments' then
    v_response := v_response || jsonb_build_object(
      'totals', jsonb_build_object(
        'score', v_total_score,
        'maximumPoints', v_total_maximum
      )
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.exam_room_complete_result_export_v3(
  p_professor_user_id uuid,
  p_export_id uuid,
  p_request_key text,
  p_output_bytes integer,
  p_output_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.exam_room_result_exports%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_output_bytes not between 1 and 5242880
    or p_output_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'EXAM_ROOM_RESULT_EXPORT_INVALID'; end if;
  select * into v_export
  from public.exam_room_result_exports e
  where e.id = p_export_id
    and e.professor_user_id = p_professor_user_id
    and e.request_key = p_request_key
  for update;
  if not found then raise exception 'EXAM_ROOM_RESULT_EXPORT_NOT_FOUND'; end if;
  if v_export.completed_at is null then
    update public.exam_room_result_exports
    set completed_at = now(), output_bytes = p_output_bytes,
        output_sha256 = p_output_sha256
    where id = v_export.id;
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_export.exam_id, v_export.attempt_id,
      'result_export', v_export.id, 'result_export_completed', p_request_key,
      jsonb_build_object(
        'scope', v_export.export_scope,
        'outputBytes', p_output_bytes,
        'outputSha256', p_output_sha256
      )
    );
  elsif v_export.output_bytes is distinct from p_output_bytes
    or v_export.output_sha256 is distinct from p_output_sha256
  then
    raise exception 'EXAM_ROOM_RESULT_EXPORT_CHANGED';
  end if;
  return jsonb_build_object(
    'ok', true,
    'exportId', v_export.id,
    'completed', true,
    'outputBytes', coalesce(v_export.output_bytes, p_output_bytes)
  );
end;
$$;

comment on table public.exam_room_student_access_issuances is
  'Audit-only issuance ledger. It stores credential references and roster hashes, never raw student access codes.';
comment on table public.exam_room_result_exports is
  'Professor-only candidate result export ledger. Exported answer content is not stored in this table.';

alter table public.exam_room_student_access_issuances enable row level security;
alter table public.exam_room_student_access_issuances force row level security;
alter table public.exam_room_result_exports enable row level security;
alter table public.exam_room_result_exports force row level security;

revoke all privileges on table public.exam_room_student_access_issuances
  from public, anon, authenticated;
revoke all privileges on table public.exam_room_result_exports
  from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_room_student_access_issuances
  to service_role;
grant select, insert, update, delete on table public.exam_room_result_exports
  to service_role;

revoke all on function public.exam_room_redeem_beadle_invitation_v2(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_redeem_beadle_invitation_v2(
  uuid, text, text
) to service_role;

-- Internal-only helper. The Worker may invoke only the atomic publisher below.
revoke all on function public.exam_room_schedule_for_handoff_v3(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.exam_room_publish_for_beadle_v3(
  uuid, uuid, jsonb, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_publish_for_beadle_v3(
  uuid, uuid, jsonb, text, text, text, timestamptz, text, text
) to service_role;

revoke all on function public.exam_room_issue_student_access_v3(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_issue_student_access_v3(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.exam_room_exam_access_v3(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_exam_access_v3(uuid, uuid)
  to service_role;

revoke all on function public.exam_room_beadle_portal_v3(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_beadle_portal_v3(uuid, uuid)
  to service_role;

revoke all on function public.exam_room_student_preflight_v3(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_student_preflight_v3(uuid, uuid, text)
  to service_role;

revoke all on function public.exam_room_start_attempt_v3(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_start_attempt_v3(uuid, uuid, text, text)
  to service_role;

revoke all on function public.exam_room_prepare_result_export_v3(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_prepare_result_export_v3(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

revoke all on function public.exam_room_complete_result_export_v3(
  uuid, uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.exam_room_complete_result_export_v3(
  uuid, uuid, text, integer, text
) to service_role;

commit;
