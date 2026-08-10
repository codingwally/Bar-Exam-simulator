-- Transactional behavior for authoritative student start-state checks.
-- Synthetic records, credential failures, and attempt state always roll back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '39000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'start-professor@example.invalid',
    '{}'::jsonb, '{"full_name":"Start Professor"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '39000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'start-student@example.invalid',
    '{}'::jsonb, '{"full_name":"Start Student"}'::jsonb,
    now(), now(), false, false
  );

insert into public.exam_room_professors (user_id, activated_by)
values (
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_classrooms (
  id, public_id, owner_professor_id, title, school_name, academic_term
) values (
  '39000000-0000-4000-8000-000000000010'::uuid,
  '39000000-0000-4000-8000-000000000011'::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid,
  'Student Start Correctness Room', 'Synthetic College of Law', 'Beta 2026'
);

insert into public.exam_room_exams (
  id, public_id, classroom_id, owner_professor_id, title, instructions,
  requested_question_count, duration_minutes, opens_at, hard_closes_at,
  status, integrity_preset, include_questionnaire
) values (
  '39000000-0000-4000-8000-000000000020'::uuid,
  '39000000-0000-4000-8000-000000000021'::uuid,
  '39000000-0000-4000-8000-000000000010'::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid,
  'Student Start Correctness Examination', 'Answer every question.',
  1, 120, now() - interval '2 hours', now() - interval '1 hour',
  'scheduled', 'standard', false
);

insert into public.exam_room_question_sources (
  id, exam_id, source_version, object_path, safe_file_name, mime_type,
  size_bytes, content_hash, extraction_status, uploaded_by,
  confirmed_by, confirmed_at
) values (
  '39000000-0000-4000-8000-000000000030'::uuid,
  '39000000-0000-4000-8000-000000000020'::uuid,
  1, '39000000-0000-4000-8000-000000000020/source.txt',
  'source.txt', 'text/plain', 32, repeat('a', 64), 'confirmed',
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
);

insert into public.exam_room_question_versions (
  id, exam_id, source_id, version_number, question_count, snapshot_hash,
  confirmed_by, confirmed_at
) values (
  '39000000-0000-4000-8000-000000000040'::uuid,
  '39000000-0000-4000-8000-000000000020'::uuid,
  '39000000-0000-4000-8000-000000000030'::uuid,
  1, 1, repeat('b', 64),
  '39000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
);

insert into public.exam_room_questions (
  id, question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
) values (
  '39000000-0000-4000-8000-000000000050'::uuid,
  '39000000-0000-4000-8000-000000000040'::uuid,
  1, 'Explain the controlling rule.', 5, repeat('c', 64)
);

update public.exam_room_exams
set active_question_version_id = '39000000-0000-4000-8000-000000000040'::uuid
where id = '39000000-0000-4000-8000-000000000020'::uuid;

insert into public.exam_room_publications (
  id, public_id, exam_id, question_version_id, publication_number,
  title_snapshot, instructions_snapshot, question_count, questions_snapshot,
  rules_snapshot, snapshot_hash, published_by, published_at
) values (
  '39000000-0000-4000-8000-000000000060'::uuid,
  '39000000-0000-4000-8000-000000000061'::uuid,
  '39000000-0000-4000-8000-000000000020'::uuid,
  '39000000-0000-4000-8000-000000000040'::uuid,
  1, 'Student Start Correctness Examination', 'Answer every question.', 1,
  jsonb_build_array(jsonb_build_object(
    'id', '39000000-0000-4000-8000-000000000050'::uuid,
    'ordinal', 1,
    'prompt', 'Explain the controlling rule.',
    'maximumPoints', 5,
    'promptHash', repeat('c', 64)
  )),
  jsonb_build_object(
    'opensAt', now() - interval '2 hours',
    'hardClosesAt', now() - interval '1 hour',
    'durationMinutes', 120,
    'lateAdmissionMinutes', 60,
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
  '39000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
);

update public.exam_room_exams
set current_publication_id = '39000000-0000-4000-8000-000000000060'::uuid,
    published_at = now() - interval '1 day'
where id = '39000000-0000-4000-8000-000000000020'::uuid;

insert into public.exam_room_roster (
  id, classroom_id, student_user_id, canonical_email,
  student_number, candidate_number, display_name, status,
  created_by, updated_by
) values (
  '39000000-0000-4000-8000-000000000070'::uuid,
  '39000000-0000-4000-8000-000000000010'::uuid,
  '39000000-0000-4000-8000-000000000002'::uuid,
  'start-student@example.invalid',
  'STUDENT-001', 'STUDENT-001', 'Student, Start A.', 'active',
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_credentials (
  id, exam_id, credential_type, token_hash, status,
  valid_from, expires_at, created_by
) values (
  '39000000-0000-4000-8000-000000000080'::uuid,
  '39000000-0000-4000-8000-000000000020'::uuid,
  'student_exam', repeat('e', 64), 'active',
  now() - interval '2 hours', now() + interval '4 hours',
  '39000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_student_access_issuances (
  id, exam_id, credential_id, roster_count, roster_snapshot_hash,
  request_key, issued_by, issued_at
) values (
  '39000000-0000-4000-8000-000000000090'::uuid,
  '39000000-0000-4000-8000-000000000020'::uuid,
  '39000000-0000-4000-8000-000000000080'::uuid,
  1, repeat('1', 64), 'student_start_issuance_0001',
  '39000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
);

do $student_start_correctness_behavior$
declare
  v_professor constant uuid := '39000000-0000-4000-8000-000000000001'::uuid;
  v_student constant uuid := '39000000-0000-4000-8000-000000000002'::uuid;
  v_exam_id constant uuid := '39000000-0000-4000-8000-000000000020'::uuid;
  v_exam_public constant uuid := '39000000-0000-4000-8000-000000000021'::uuid;
  v_correct_key constant text := repeat('e', 64);
  v_wrong_key constant text := repeat('0', 64);
  v_rate_key constant text := repeat('f', 64);
  v_result jsonb;
  v_start_result jsonb;
  v_audit_before integer;
begin
  if has_function_privilege(
      'anon',
      'public.exam_room_student_waiting_room_v4(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.exam_room_student_waiting_room_v4(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.exam_room_student_waiting_room_v4(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
  then raise exception 'STUDENT_START_PRIVILEGE_BOUNDARY_FAILED'; end if;

  -- Outsiders continue to receive only the minimum denial; no schedule,
  -- instructions, rules, roster identity, or question material is disclosed.
  v_result := public.exam_room_student_waiting_room_v4(
    v_professor, v_exam_public, null, null, null
  );
  if v_result ->> 'startBlockerCode' <> 'ROSTER_REQUIRED'
    or (v_result ->> 'eligible')::boolean is not false
    or v_result ?| array[
      'title', 'instructions', 'rules', 'opensAt', 'entryClosesAt',
      'hardClosesAt', 'studentAccessReady', 'rosterIdentity', 'questions'
    ]
  then raise exception 'STUDENT_START_MINIMAL_DENIAL_FAILED'; end if;

  select count(*)::integer into v_audit_before
  from public.exam_room_audit_log audit
  where audit.exam_id = v_exam_id and audit.action = 'credential_failed';

  -- The effective hard close has passed even though the scheduled status has
  -- not yet transitioned.  Closure must win and the wrong code must not be
  -- checked or counted as a credential failure.
  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key, null
  );
  if v_result ->> 'startBlockerCode' <> 'EXAM_CLOSED'
    or (v_result ->> 'canStart')::boolean is not false
    or v_result ->> 'waitingRoomState' <> 'blocked'
    or (select count(*) from public.exam_room_audit_log audit
        where audit.exam_id = v_exam_id and audit.action = 'credential_failed')
      <> v_audit_before
    or exists (
      select 1 from public.exam_room_credential_windows credential_window
      where credential_window.exam_id = v_exam_id
        and credential_window.actor_user_id = v_student
    )
  then raise exception 'STUDENT_START_EFFECTIVE_CLOSE_FAILED'; end if;

  -- A terminal stored status is independently authoritative, even if its
  -- timestamps are moved into the future.
  update public.exam_room_exams
  set status = 'closed',
      opens_at = clock_timestamp() - interval '10 minutes',
      hard_closes_at = clock_timestamp() + interval '2 hours'
  where id = v_exam_id;
  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key, null
  );
  if v_result ->> 'startBlockerCode' <> 'EXAM_CLOSED'
    or (v_result ->> 'canStart')::boolean is not false
    or (select count(*) from public.exam_room_audit_log audit
        where audit.exam_id = v_exam_id and audit.action = 'credential_failed')
      <> v_audit_before
  then raise exception 'STUDENT_START_TERMINAL_STATUS_FAILED'; end if;

  -- A still-open examination cannot resume an attempt whose personal server
  -- deadline has passed.  start_attempt_v4 must return the same denial after
  -- its immediate preflight recheck.
  update public.exam_room_exams
  set status = 'scheduled',
      opens_at = clock_timestamp() - interval '10 minutes',
      hard_closes_at = clock_timestamp() + interval '2 hours'
  where id = v_exam_id;
  insert into public.exam_room_attempts (
    id, public_id, exam_id, question_version_id, publication_id, roster_id,
    student_user_id, candidate_number, status, started_at, server_deadline
  ) values (
    '39000000-0000-4000-8000-000000000100'::uuid,
    '39000000-0000-4000-8000-000000000101'::uuid,
    v_exam_id,
    '39000000-0000-4000-8000-000000000040'::uuid,
    '39000000-0000-4000-8000-000000000060'::uuid,
    '39000000-0000-4000-8000-000000000070'::uuid,
    v_student, 'STUDENT-001', 'in_progress',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 minute'
  );

  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key, null
  );
  v_start_result := public.exam_room_start_attempt_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key
  );
  if v_result ->> 'startBlockerCode' <> 'DEADLINE_REACHED'
    or (v_result ->> 'canStart')::boolean is not false
    or v_result ->> 'waitingRoomState' <> 'blocked'
    or v_start_result ->> 'code' <> 'DEADLINE_REACHED'
    or (v_start_result ->> 'ok')::boolean is not false
    or (select count(*) from public.exam_room_audit_log audit
        where audit.exam_id = v_exam_id and audit.action = 'credential_failed')
      <> v_audit_before
  then raise exception 'STUDENT_START_ATTEMPT_DEADLINE_FAILED'; end if;

  -- A genuine live attempt before its deadline keeps the established resume
  -- behavior and does not require re-entering the class code.
  update public.exam_room_attempts
  set server_deadline = clock_timestamp() + interval '1 hour'
  where id = '39000000-0000-4000-8000-000000000100'::uuid;
  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key, null
  );
  if v_result ->> 'startBlockerCode' <> 'RESUME_READY'
    or (v_result ->> 'canStart')::boolean is not true
    or v_result ->> 'waitingRoomState' <> 'resume'
  then raise exception 'STUDENT_START_VALID_RESUME_FAILED'; end if;

  delete from public.exam_room_attempts
  where id = '39000000-0000-4000-8000-000000000100'::uuid;

  -- A correct class code can still be checked before opening time and reaches
  -- the question-free waiting room without creating an attempt.
  update public.exam_room_exams
  set opens_at = clock_timestamp() + interval '30 minutes',
      hard_closes_at = clock_timestamp() + interval '3 hours'
  where id = v_exam_id;
  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_correct_key, v_rate_key, null
  );
  if v_result ->> 'startBlockerCode' <> 'EXAM_NOT_OPEN'
    or (v_result ->> 'canStart')::boolean is not false
    or v_result ->> 'waitingRoomState' <> 'waiting'
    or (v_result ->> 'accessCodeAccepted')::boolean is not true
    or v_result ? 'questions'
    or exists (
      select 1 from public.exam_room_attempts attempt
      where attempt.exam_id = v_exam_id
    )
  then raise exception 'STUDENT_START_WAITING_ROOM_REGRESSION'; end if;

  -- During a valid entry window, the established bounded credential failure
  -- path remains active.
  update public.exam_room_exams
  set opens_at = clock_timestamp() - interval '10 minutes',
      hard_closes_at = clock_timestamp() + interval '2 hours'
  where id = v_exam_id;
  v_result := public.exam_room_student_waiting_room_v4(
    v_student, v_exam_public, v_wrong_key, v_rate_key, null
  );
  if v_result ->> 'startBlockerCode' <> 'CREDENTIAL_INVALID'
    or (v_result ->> 'canStart')::boolean is not false
    or (select count(*) from public.exam_room_audit_log audit
        where audit.exam_id = v_exam_id and audit.action = 'credential_failed')
      <> v_audit_before + 1
    or not exists (
      select 1 from public.exam_room_credential_windows credential_window
      where credential_window.exam_id = v_exam_id
        and credential_window.actor_user_id = v_student
        and credential_window.credential_type = 'student_exam'
        and credential_window.rate_key_hash = v_rate_key
        and credential_window.failures = 1
        and credential_window.locked_until is null
    )
  then raise exception 'STUDENT_START_CREDENTIAL_LOCKOUT_REGRESSION'; end if;
end;
$student_start_correctness_behavior$;

rollback;
