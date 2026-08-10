-- Transactional behavior for Professor-controlled schedule revisions.
-- Synthetic records always roll back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '37000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'schedule-professor@example.invalid',
    '{}'::jsonb, '{"full_name":"Schedule Professor"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '37000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'schedule-beadle@example.invalid',
    '{}'::jsonb, '{"full_name":"Schedule Beadle"}'::jsonb,
    now(), now(), false, false
  );

insert into public.exam_room_professors (user_id, activated_by)
values (
  '37000000-0000-4000-8000-000000000001'::uuid,
  '37000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_classrooms (
  id, public_id, owner_professor_id, title, school_name, academic_term
) values (
  '37000000-0000-4000-8000-000000000010'::uuid,
  '37000000-0000-4000-8000-000000000011'::uuid,
  '37000000-0000-4000-8000-000000000001'::uuid,
  'Schedule Correction Room', 'Synthetic College of Law', 'Beta 2026'
);

insert into public.exam_room_exams (
  id, public_id, classroom_id, owner_professor_id, title, instructions,
  requested_question_count, duration_minutes, opens_at, hard_closes_at,
  status, integrity_preset, include_questionnaire
) values (
  '37000000-0000-4000-8000-000000000020'::uuid,
  '37000000-0000-4000-8000-000000000021'::uuid,
  '37000000-0000-4000-8000-000000000010'::uuid,
  '37000000-0000-4000-8000-000000000001'::uuid,
  'Schedule Correction Examination', 'Answer the question.',
  1, 120, now() - interval '3 hours', now() - interval '1 hour',
  'closed', 'standard', false
);

insert into public.exam_room_question_sources (
  id, exam_id, source_version, object_path, safe_file_name, mime_type,
  size_bytes, content_hash, extraction_status, uploaded_by,
  confirmed_by, confirmed_at
) values (
  '37000000-0000-4000-8000-000000000030'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  1, '37000000-0000-4000-8000-000000000020/source.txt',
  'source.txt', 'text/plain', 32, repeat('a', 64), 'confirmed',
  '37000000-0000-4000-8000-000000000001'::uuid,
  '37000000-0000-4000-8000-000000000001'::uuid, now() - interval '1 day'
);

insert into public.exam_room_question_versions (
  id, exam_id, source_id, version_number, question_count, snapshot_hash,
  confirmed_by, confirmed_at
) values (
  '37000000-0000-4000-8000-000000000040'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  '37000000-0000-4000-8000-000000000030'::uuid,
  1, 1, repeat('b', 64),
  '37000000-0000-4000-8000-000000000001'::uuid, now() - interval '1 day'
);

insert into public.exam_room_questions (
  id, question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
) values (
  '37000000-0000-4000-8000-000000000050'::uuid,
  '37000000-0000-4000-8000-000000000040'::uuid,
  1, 'Explain the controlling rule.', 5, repeat('c', 64)
);

update public.exam_room_exams
set active_question_version_id = '37000000-0000-4000-8000-000000000040'::uuid
where id = '37000000-0000-4000-8000-000000000020'::uuid;

insert into public.exam_room_publications (
  id, public_id, exam_id, question_version_id, publication_number,
  title_snapshot, instructions_snapshot, question_count, questions_snapshot,
  rules_snapshot, snapshot_hash, published_by, published_at
) values (
  '37000000-0000-4000-8000-000000000060'::uuid,
  '37000000-0000-4000-8000-000000000061'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  '37000000-0000-4000-8000-000000000040'::uuid,
  1, 'Schedule Correction Examination', 'Answer the question.', 1,
  jsonb_build_array(jsonb_build_object(
    'id', '37000000-0000-4000-8000-000000000050'::uuid,
    'ordinal', 1, 'prompt', 'Explain the controlling rule.',
    'maximumPoints', 5, 'promptHash', repeat('c', 64)
  )),
  jsonb_build_object(
    'opensAt', now() - interval '3 hours',
    'hardClosesAt', now() - interval '1 hour',
    'durationMinutes', 120,
    'lateAdmissionMinutes', 15,
    'submissionGraceMinutes', 5,
    'allowedMaterials', 'Codal only',
    'navigationMode', 'free',
    'integrityMode', 'record_only',
    'fullscreenPolicy', 'requested',
    'admissionMode', 'automatic',
    'temporaryLeaveAcknowledgment', true,
    'suggestedAnswerMode', 'none',
    'aiGradingEnabled', false,
    'studentAccessCodeRequired', true
  ),
  repeat('d', 64),
  '37000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
);

update public.exam_room_exams
set current_publication_id = '37000000-0000-4000-8000-000000000060'::uuid,
    published_at = now() - interval '1 day'
where id = '37000000-0000-4000-8000-000000000020'::uuid;

insert into public.exam_room_credentials (
  id, exam_id, credential_type, token_hash, status,
  valid_from, expires_at, created_by
) values
  (
    '37000000-0000-4000-8000-000000000070'::uuid,
    '37000000-0000-4000-8000-000000000020'::uuid,
    'student_exam', repeat('e', 64), 'active',
    now() - interval '3 hours', now() - interval '1 hour',
    '37000000-0000-4000-8000-000000000002'::uuid
  ),
  (
    '37000000-0000-4000-8000-000000000071'::uuid,
    '37000000-0000-4000-8000-000000000020'::uuid,
    'professor_grading', repeat('f', 64), 'active',
    now() - interval '1 day', now() + interval '30 days',
    '37000000-0000-4000-8000-000000000001'::uuid
  );

insert into public.exam_room_credentials (
  id, exam_id, credential_type, token_hash, scoped_user_id, status,
  valid_from, expires_at, created_by
) values (
  '37000000-0000-4000-8000-000000000072'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  'attempt_unlock', repeat('9', 64),
  '37000000-0000-4000-8000-000000000001'::uuid,
  'active', now() - interval '3 hours', now() - interval '1 hour',
  '37000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_student_access_issuances (
  id, exam_id, credential_id, roster_count, roster_snapshot_hash,
  request_key, issued_by, issued_at
) values (
  '37000000-0000-4000-8000-000000000080'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  '37000000-0000-4000-8000-000000000070'::uuid,
  1, repeat('1', 64), 'schedule_original_access_0001',
  '37000000-0000-4000-8000-000000000002'::uuid,
  now() - interval '1 day'
);

insert into public.exam_room_beadle_assignments (
  id, exam_id, beadle_user_id, status, assigned_by, assigned_at, expires_at
) values (
  '37000000-0000-4000-8000-000000000090'::uuid,
  '37000000-0000-4000-8000-000000000020'::uuid,
  '37000000-0000-4000-8000-000000000002'::uuid,
  'active',
  '37000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '2 days', now() - interval '1 hour'
);

do $professor_reschedule_behavior$
declare
  v_owner constant uuid := '37000000-0000-4000-8000-000000000001'::uuid;
  v_exam_public constant uuid := '37000000-0000-4000-8000-000000000021'::uuid;
  v_previous_public constant uuid := '37000000-0000-4000-8000-000000000061'::uuid;
  v_exam public.exam_room_exams%rowtype;
  v_response jsonb;
  v_replay jsonb;
  v_snapshot jsonb;
  v_new_publication public.exam_room_publications%rowtype;
  v_new_opens timestamptz := clock_timestamp() + interval '2 hours';
  v_new_closes timestamptz := clock_timestamp() + interval '5 hours';
  v_before_horizon_exam public.exam_room_exams%rowtype;
  v_before_horizon_publication_count integer;
  v_before_horizon_unlock public.exam_room_credentials%rowtype;
begin
  select * into v_exam from public.exam_room_exams where public_id = v_exam_public;
  v_snapshot := public.exam_room_professor_authoring_snapshot_v2(v_owner, v_exam_public);
  if coalesce((v_snapshot #>> '{capabilities,canReschedulePublication}')::boolean, false) is not true
    or v_snapshot #>> '{blockers,rescheduleBlocker}' is not null
  then raise exception 'PROFESSOR_RESCHEDULE_CAPABILITY_FAILED'; end if;

  v_response := public.exam_room_reschedule_publication_v1(
    v_owner, v_exam_public, v_previous_public, v_exam.workspace_revision,
    v_new_opens, v_new_closes, 150, 20, 10,
    'The Professor corrected the synthetic class schedule.',
    'schedule_change_request_0001'
  );

  select * into v_exam from public.exam_room_exams where public_id = v_exam_public;
  select * into v_new_publication
  from public.exam_room_publications where id = v_exam.current_publication_id;

  if (v_response ->> 'ok')::boolean is not true
    or v_exam.status <> 'scheduled'
    or v_exam.opens_at <> v_new_opens
    or v_exam.hard_closes_at <> v_new_closes
    or v_exam.duration_minutes <> 150
    or v_new_publication.publication_number <> 2
    or v_new_publication.supersedes_publication_id
      <> '37000000-0000-4000-8000-000000000060'::uuid
    or v_new_publication.question_version_id
      <> '37000000-0000-4000-8000-000000000040'::uuid
    or v_new_publication.questions_snapshot <> (
      select publication.questions_snapshot
      from public.exam_room_publications publication
      where publication.id = '37000000-0000-4000-8000-000000000060'::uuid
    )
    or v_new_publication.rules_snapshot ->> 'allowedMaterials' <> 'Codal only'
    or (v_new_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer <> 20
    or (v_new_publication.rules_snapshot ->> 'submissionGraceMinutes')::integer <> 10
    or (select credential.token_hash from public.exam_room_credentials credential
        where credential.id = '37000000-0000-4000-8000-000000000070'::uuid)
      <> repeat('e', 64)
    or (select issuance.credential_id from public.exam_room_student_access_issuances issuance
        where issuance.id = '37000000-0000-4000-8000-000000000080'::uuid)
      <> '37000000-0000-4000-8000-000000000070'::uuid
    or (select credential.token_hash from public.exam_room_credentials credential
        where credential.id = '37000000-0000-4000-8000-000000000072'::uuid)
      <> repeat('9', 64)
    or (select credential.valid_from from public.exam_room_credentials credential
        where credential.id = '37000000-0000-4000-8000-000000000072'::uuid)
      <> v_new_opens
    or (select credential.expires_at from public.exam_room_credentials credential
        where credential.id = '37000000-0000-4000-8000-000000000072'::uuid)
      <> v_new_closes
    or (select assignment.expires_at from public.exam_room_beadle_assignments assignment
        where assignment.id = '37000000-0000-4000-8000-000000000090'::uuid)
      <> v_new_closes
  then raise exception 'PROFESSOR_RESCHEDULE_PRESERVATION_FAILED'; end if;

  v_replay := public.exam_room_reschedule_publication_v1(
    v_owner, v_exam_public, v_previous_public,
    (select workspace_revision from public.exam_room_exams where public_id = v_exam_public) - 1,
    v_new_opens, v_new_closes, 150, 20, 10,
    'The Professor corrected the synthetic class schedule.',
    'schedule_change_request_0001'
  );
  if v_replay <> v_response
    or (select count(*) from public.exam_room_publications publication
        where publication.exam_id = v_exam.id) <> 2
  then raise exception 'PROFESSOR_RESCHEDULE_IDEMPOTENCY_FAILED'; end if;

  -- A proposed close outside any active Beadle's fixed 180-day delegation
  -- horizon must fail before the immutable publication lineage or credentials
  -- move. Catch the expected database error, then prove the transaction left
  -- every consequential value unchanged.
  select * into v_before_horizon_exam
  from public.exam_room_exams where public_id = v_exam_public;
  select count(*)::integer into v_before_horizon_publication_count
  from public.exam_room_publications publication
  where publication.exam_id = v_before_horizon_exam.id;
  select * into v_before_horizon_unlock
  from public.exam_room_credentials credential
  where credential.id = '37000000-0000-4000-8000-000000000072'::uuid;

  begin
    perform public.exam_room_reschedule_publication_v1(
      v_owner,
      v_exam_public,
      v_new_publication.public_id,
      v_before_horizon_exam.workspace_revision,
      clock_timestamp() + interval '179 days',
      clock_timestamp() + interval '179 days 3 hours',
      150,
      20,
      10,
      'The proposed date exceeds the existing Beadle delegation horizon.',
      'schedule_horizon_reject_0001'
    );
    raise exception 'PROFESSOR_RESCHEDULE_HORIZON_WAS_NOT_REJECTED';
  exception
    when others then
      if sqlerrm = 'PROFESSOR_RESCHEDULE_HORIZON_WAS_NOT_REJECTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON' then
        raise exception 'PROFESSOR_RESCHEDULE_HORIZON_WRONG_ERROR: %', sqlerrm;
      end if;
  end;

  if (select count(*)::integer
      from public.exam_room_publications publication
      where publication.exam_id = v_before_horizon_exam.id)
      <> v_before_horizon_publication_count
    or (select exam.current_publication_id from public.exam_room_exams exam
        where exam.id = v_before_horizon_exam.id)
      <> v_before_horizon_exam.current_publication_id
    or (select exam.workspace_revision from public.exam_room_exams exam
        where exam.id = v_before_horizon_exam.id)
      <> v_before_horizon_exam.workspace_revision
    or (select exam.opens_at from public.exam_room_exams exam
        where exam.id = v_before_horizon_exam.id)
      <> v_before_horizon_exam.opens_at
    or (select exam.hard_closes_at from public.exam_room_exams exam
        where exam.id = v_before_horizon_exam.id)
      <> v_before_horizon_exam.hard_closes_at
    or (select credential.token_hash from public.exam_room_credentials credential
        where credential.id = v_before_horizon_unlock.id)
      <> v_before_horizon_unlock.token_hash
    or (select credential.valid_from from public.exam_room_credentials credential
        where credential.id = v_before_horizon_unlock.id)
      <> v_before_horizon_unlock.valid_from
    or (select credential.expires_at from public.exam_room_credentials credential
        where credential.id = v_before_horizon_unlock.id)
      <> v_before_horizon_unlock.expires_at
  then raise exception 'PROFESSOR_RESCHEDULE_HORIZON_MUTATED_STATE'; end if;
end;
$professor_reschedule_behavior$;

rollback;
