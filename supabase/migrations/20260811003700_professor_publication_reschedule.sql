-- Professor-controlled Examination Room schedule revisions.
--
-- `supabase migration new` generated an empty 20260810094151 stub from the
-- workstation clock. This migration depends on 20260811003600, so the empty,
-- unapplied stub was reordered before any database saw it.
--
-- A schedule correction creates a new immutable publication in the existing
-- lineage. It never changes the published questions, roster, Beadle assignment,
-- active student-code issuance/envelope, or Professor grading credential.

begin;

-- Returning to an earlier schedule is a legitimate second correction. Command
-- receipts and publication lineage provide idempotency; a content-hash unique
-- constraint must not prevent A -> B -> A schedule history.
alter table public.exam_room_publications
  drop constraint if exists exam_room_publications_exam_id_snapshot_hash_key;

alter table public.exam_room_backup_outbox
  drop constraint if exists exam_room_backup_outbox_event_type_check;
alter table public.exam_room_backup_outbox
  add constraint exam_room_backup_outbox_event_type_check check (
    event_type in (
      'exam_confirmed', 'roster_imported', 'attempt_submitted', 'grades_released',
      'dispute_opened', 'dispute_closed', 'admin_correction', 'exam_erratum',
      'publication_replaced', 'submission_reopened', 'admin_break_glass',
      'exam_details_revised', 'exam_questions_revised',
      'exam_rules_draft_saved', 'exam_roster_reopened',
      'exam_schedule_changed'
    )
  );

create or replace function public.exam_room_professor_authoring_snapshot_v2(
  p_professor_user_id uuid,
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
  v_attempts_exist boolean := false;
  v_can_reschedule boolean := false;
  v_blocker text;
begin
  -- The v1 projection performs the exact-owner check and builds the bounded
  -- question/rules review. Extend it rather than broadening a public portal.
  v_base := public.exam_room_professor_authoring_snapshot_v1(
    p_professor_user_id, p_exam_public_id
  );

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select exists (
    select 1 from public.exam_room_attempts attempt
    where attempt.exam_id = v_exam.id
  ) into v_attempts_exist;

  v_can_reschedule := v_exam.current_publication_id is not null
    and v_exam.release_id is null
    and v_exam.status in ('scheduled', 'closed', 'grading')
    and not v_attempts_exist;

  v_blocker := case
    when v_exam.current_publication_id is null then 'NOT_PUBLISHED'
    when v_exam.release_id is not null or v_exam.status = 'sealed'
      then 'EXAM_ALREADY_RELEASED'
    when v_attempts_exist then 'CANDIDATE_ATTEMPTS_EXIST'
    when v_exam.status not in ('scheduled', 'closed', 'grading') then 'EXAM_STATE_BLOCKED'
    else null
  end;

  return v_base || jsonb_build_object(
    'capabilities', coalesce(v_base -> 'capabilities', '{}'::jsonb)
      || jsonb_build_object('canReschedulePublication', v_can_reschedule),
    'blockers', coalesce(v_base -> 'blockers', '{}'::jsonb)
      || jsonb_build_object('rescheduleBlocker', v_blocker)
  );
end;
$$;

create or replace function public.exam_room_reschedule_publication_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_publication_id uuid,
  p_expected_workspace_revision bigint,
  p_opens_at timestamptz,
  p_hard_closes_at timestamptz,
  p_duration_minutes integer,
  p_late_admission_minutes integer,
  p_submission_grace_minutes integer,
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
  v_previous public.exam_room_publications%rowtype;
  v_current public.exam_room_publications%rowtype;
  v_model public.exam_room_publication_model_answers%rowtype;
  v_rules jsonb;
  v_snapshot jsonb;
  v_model_hash text;
  v_publication_number integer;
  v_student_expires_at timestamptz;
  v_request jsonb;
  v_response jsonb;
  v_outbox_id uuid;
  v_workspace_revision bigint;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedPublicationId', p_expected_publication_id,
    'expectedWorkspaceRevision', p_expected_workspace_revision,
    'opensAt', p_opens_at,
    'hardClosesAt', p_hard_closes_at,
    'durationMinutes', p_duration_minutes,
    'lateAdmissionMinutes', p_late_admission_minutes,
    'submissionGraceMinutes', p_submission_grace_minutes,
    'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'reschedule_publication_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;

  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  if p_expected_workspace_revision is null
    or p_expected_workspace_revision <> v_exam.workspace_revision
  then raise exception 'EXAM_ROOM_WORKSPACE_CONFLICT'; end if;
  if v_exam.current_publication_id is null
    or v_exam.release_id is not null
    or v_exam.status not in ('scheduled', 'closed', 'grading')
  then raise exception 'EXAM_ROOM_RESCHEDULE_NOT_ALLOWED'; end if;
  if exists (
    select 1 from public.exam_room_attempts attempt
    where attempt.exam_id = v_exam.id
  ) then raise exception 'EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST'; end if;

  select * into v_previous
  from public.exam_room_publications publication
  where publication.id = v_exam.current_publication_id
    and publication.public_id = p_expected_publication_id
    and publication.exam_id = v_exam.id
  for share;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_VERSION_CONFLICT'; end if;

  if p_opens_at is null
    or p_hard_closes_at is null
    or p_opens_at < clock_timestamp() + interval '30 minutes'
    or p_hard_closes_at <= p_opens_at
    or p_duration_minutes not between 1 and 480
    or p_late_admission_minutes not between 0 and 480
    or p_submission_grace_minutes not between 0 and 120
    or char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000
  then raise exception 'EXAM_ROOM_RESCHEDULE_INVALID'; end if;

  if jsonb_typeof(v_previous.rules_snapshot) <> 'object'
    or not coalesce(
      (v_previous.rules_snapshot ->> 'studentAccessCodeRequired')::boolean,
      false
    )
  then raise exception 'EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID'; end if;

  -- An active Beadle assignment cannot be silently shortened below the new
  -- examination window, and the 180-day delegation cap must remain absolute.
  -- Reject before appending a publication so the Professor can choose a
  -- compliant date or arrange a fresh delegation through the normal flow.
  if exists (
    select 1
    from public.exam_room_beadle_assignments assignment
    where assignment.exam_id = v_exam.id
      and assignment.status = 'active'
      and p_hard_closes_at > assignment.assigned_at + interval '180 days'
  ) then
    raise exception 'EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON';
  end if;

  v_rules := v_previous.rules_snapshot || jsonb_build_object(
    'opensAt', p_opens_at,
    'hardClosesAt', p_hard_closes_at,
    'durationMinutes', p_duration_minutes,
    'lateAdmissionMinutes', p_late_admission_minutes,
    'submissionGraceMinutes', p_submission_grace_minutes
  );
  select coalesce(max(publication.publication_number), 0) + 1
  into v_publication_number
  from public.exam_room_publications publication
  where publication.exam_id = v_exam.id;

  select * into v_model
  from public.exam_room_publication_model_answers model
  where model.publication_id = v_previous.id;
  v_model_hash := case when found then v_model.content_hash else null end;

  v_snapshot := jsonb_build_object(
    'examId', v_exam.public_id,
    'title', v_previous.title_snapshot,
    'instructions', v_previous.instructions_snapshot,
    'durationMinutes', p_duration_minutes,
    'opensAt', p_opens_at,
    'hardClosesAt', p_hard_closes_at,
    'integrityPreset', v_exam.integrity_preset,
    'questionVersionId', v_previous.question_version_id,
    'questions', v_previous.questions_snapshot,
    'rules', v_rules,
    'privateModelAnswerHash', v_model_hash
  );

  insert into public.exam_room_publications (
    exam_id, question_version_id, publication_number,
    supersedes_publication_id, replacement_reason, replacement_request_key,
    title_snapshot, instructions_snapshot, question_count,
    questions_snapshot, rules_snapshot, snapshot_hash, published_by
  ) values (
    v_exam.id, v_previous.question_version_id, v_publication_number,
    v_previous.id, btrim(p_reason), p_request_key,
    v_previous.title_snapshot, v_previous.instructions_snapshot,
    v_previous.question_count, v_previous.questions_snapshot,
    v_rules, public.exam_room_hash_json(v_snapshot), p_professor_user_id
  ) returning * into v_current;

  if v_model.publication_id is not null then
    insert into public.exam_room_publication_model_answers (
      publication_id, exam_id, mode, answer_text, source_id,
      content_hash, created_by, created_at
    ) values (
      v_current.id, v_model.exam_id, v_model.mode, v_model.answer_text,
      v_model.source_id, v_model.content_hash, v_model.created_by,
      v_model.created_at
    );
  end if;

  v_student_expires_at := greatest(p_hard_closes_at, coalesce((
    select max(
      coalesce(
        nullif(accommodation.configuration ->> 'individualHardClosesAt', '')::timestamptz,
        p_hard_closes_at
      ) + make_interval(mins =>
        coalesce((accommodation.configuration ->> 'extraMinutes')::integer, 0)
        + coalesce((accommodation.configuration ->> 'incidentExtensionMinutes')::integer, 0)
      )
    )
    from public.exam_room_accommodations accommodation
    where accommodation.exam_id = v_exam.id
      and accommodation.status = 'active'
  ), p_hard_closes_at));

  update public.exam_room_credentials credential
  set valid_from = p_opens_at,
      expires_at = v_student_expires_at
  where credential.exam_id = v_exam.id
    and credential.credential_type = 'student_exam'
    and credential.status = 'active';

  -- The derived attempt-unlock secret is part of the Professor's existing
  -- grading credential set. Preserve its token hash while moving its bounded
  -- validity window to the corrected examination schedule.
  update public.exam_room_credentials credential
  set valid_from = p_opens_at,
      expires_at = p_hard_closes_at
  where credential.exam_id = v_exam.id
    and credential.credential_type = 'attempt_unlock'
    and credential.status = 'active';

  update public.exam_room_credentials credential
  set expires_at = greatest(
    credential.expires_at,
    p_hard_closes_at + interval '180 days'
  )
  where credential.exam_id = v_exam.id
    and credential.credential_type = 'professor_grading'
    and credential.status = 'active';

  update public.exam_room_beadle_assignments assignment
  set expires_at = least(
    p_hard_closes_at,
    assignment.assigned_at + interval '180 days'
  )
  where assignment.exam_id = v_exam.id
    and assignment.status = 'active';

  update public.exam_room_exams exam
  set opens_at = p_opens_at,
      hard_closes_at = p_hard_closes_at,
      duration_minutes = p_duration_minutes,
      status = 'scheduled',
      current_publication_id = v_current.id,
      published_at = v_current.published_at,
      updated_at = clock_timestamp()
  where exam.id = v_exam.id
  returning exam.workspace_revision into v_workspace_revision;

  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null,
    'publication', v_current.id, 'exam_schedule_changed', p_request_key,
    jsonb_build_object(
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'previousOpensAt', v_exam.opens_at,
      'previousHardClosesAt', v_exam.hard_closes_at,
      'opensAt', p_opens_at,
      'hardClosesAt', p_hard_closes_at,
      'durationMinutes', p_duration_minutes,
      'lateAdmissionMinutes', p_late_admission_minutes,
      'submissionGraceMinutes', p_submission_grace_minutes,
      'reason', btrim(p_reason),
      'zeroAttemptGuard', true,
      'studentAccessPreserved', true,
      'beadleAssignmentPreserved', true
    )
  );

  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'exam_schedule_changed',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'title', v_previous.title_snapshot,
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'previousOpensAt', v_exam.opens_at,
      'previousHardClosesAt', v_exam.hard_closes_at,
      'opensAt', p_opens_at,
      'hardClosesAt', p_hard_closes_at,
      'durationMinutes', p_duration_minutes,
      'lateAdmissionMinutes', p_late_admission_minutes,
      'submissionGraceMinutes', p_submission_grace_minutes,
      'reason', btrim(p_reason),
      'occurredAt', v_current.published_at
    )
  );

  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'publicationId', v_current.public_id,
    'publicationNumber', v_current.publication_number,
    'workspaceRevision', v_workspace_revision,
    'opensAt', p_opens_at,
    'hardClosesAt', p_hard_closes_at,
    'durationMinutes', p_duration_minutes,
    'lateAdmissionMinutes', p_late_admission_minutes,
    'submissionGraceMinutes', p_submission_grace_minutes,
    'preserved', jsonb_build_object(
      'questions', true,
      'classList', true,
      'beadleAccess', true,
      'studentExamCode', true,
      'gradingAccess', true
    ),
    'backupOutboxId', v_outbox_id
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'reschedule_publication_v1',
    p_request_key, v_request, v_response
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_RESCHEDULE_INVALID';
end;
$$;

revoke all on function public.exam_room_professor_authoring_snapshot_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_professor_authoring_snapshot_v2(uuid, uuid)
  to service_role;

revoke all on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) to service_role;

comment on function public.exam_room_professor_authoring_snapshot_v2(uuid, uuid) is
  'Exact-owner authoring snapshot with zero-attempt published-schedule revision capability.';
comment on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) is
  'Creates an immutable schedule-only publication revision while preserving questions and class handoff credentials.';

commit;
