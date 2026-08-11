-- Transactional staging proof for the real-classroom Examination Room flow.
-- Every synthetic identity and classroom record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  ('5a000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-professor@example.invalid', '{}',
   '{"full_name":"Classroom Professor"}', now(), now(), false, false),
  ('5a000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-beadle@example.invalid', '{}',
   '{"full_name":"Classroom Beadle"}', now(), now(), false, false),
  ('5a000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-submitted@example.invalid', '{}',
   '{"full_name":"Submitted Student"}', now(), now(), false, false),
  ('5a000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-blank@example.invalid', '{}',
   '{"full_name":"Blank Student"}', now(), now(), false, false),
  ('5a000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-active@example.invalid', '{}',
   '{"full_name":"Active Student"}', now(), now(), false, false),
  ('5a000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'classroom-outsider@example.invalid', '{}',
   '{"full_name":"Outside Student"}', now(), now(), false, false);

insert into public.exam_room_professors (user_id, activated_by)
values ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001');

insert into public.exam_room_classrooms (
  id, public_id, owner_professor_id, title, school_name, academic_term
) values (
  '5a000000-0000-4000-8000-000000000010',
  '5a000000-0000-4000-8000-000000000011',
  '5a000000-0000-4000-8000-000000000001',
  'Real Classroom Staging Room', 'Synthetic College of Law', 'Beta 2026'
);

insert into public.exam_room_exams (
  id, public_id, classroom_id, owner_professor_id, title, instructions,
  requested_question_count, duration_minutes, opens_at, hard_closes_at,
  status, integrity_preset, include_questionnaire
) values (
  '5a000000-0000-4000-8000-000000000020',
  '5a000000-0000-4000-8000-000000000021',
  '5a000000-0000-4000-8000-000000000010',
  '5a000000-0000-4000-8000-000000000001',
  'Real Classroom Staging Examination', 'Answer using ALAC.',
  1, 120, clock_timestamp() + interval '30 minutes',
  clock_timestamp() + interval '3 hours', 'scheduled', 'standard', false
);

insert into public.exam_room_question_sources (
  id, exam_id, source_version, object_path, safe_file_name, mime_type,
  size_bytes, content_hash, extraction_status, uploaded_by,
  confirmed_by, confirmed_at
) values (
  '5a000000-0000-4000-8000-000000000030',
  '5a000000-0000-4000-8000-000000000020', 1,
  '5a000000-0000-4000-8000-000000000020/source.txt',
  'source.txt', 'text/plain', 32, repeat('a', 64), 'confirmed',
  '5a000000-0000-4000-8000-000000000001',
  '5a000000-0000-4000-8000-000000000001', clock_timestamp()
);

insert into public.exam_room_question_versions (
  id, exam_id, source_id, version_number, question_count, snapshot_hash,
  confirmed_by, confirmed_at
) values (
  '5a000000-0000-4000-8000-000000000040',
  '5a000000-0000-4000-8000-000000000020',
  '5a000000-0000-4000-8000-000000000030', 1, 1, repeat('b', 64),
  '5a000000-0000-4000-8000-000000000001', clock_timestamp()
);

insert into public.exam_room_questions (
  id, question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
) values (
  '5a000000-0000-4000-8000-000000000050',
  '5a000000-0000-4000-8000-000000000040', 1,
  'Explain the controlling legal rule and apply it.', 5, repeat('c', 64)
);

update public.exam_room_exams
set active_question_version_id = '5a000000-0000-4000-8000-000000000040'
where id = '5a000000-0000-4000-8000-000000000020';

insert into public.exam_room_publications (
  id, public_id, exam_id, question_version_id, publication_number,
  title_snapshot, instructions_snapshot, question_count, questions_snapshot,
  rules_snapshot, snapshot_hash, published_by, published_at
) values (
  '5a000000-0000-4000-8000-000000000060',
  '5a000000-0000-4000-8000-000000000061',
  '5a000000-0000-4000-8000-000000000020',
  '5a000000-0000-4000-8000-000000000040', 1,
  'Real Classroom Staging Examination', 'Answer using ALAC.', 1,
  jsonb_build_array(jsonb_build_object(
    'id', '5a000000-0000-4000-8000-000000000050'::uuid,
    'ordinal', 1, 'prompt', 'Explain the controlling legal rule and apply it.',
    'maximumPoints', 5, 'promptHash', repeat('c', 64)
  )),
  jsonb_build_object(
    'opensAt', clock_timestamp() + interval '30 minutes',
    'hardClosesAt', clock_timestamp() + interval '3 hours',
    'durationMinutes', 120, 'lateAdmissionMinutes', 60,
    'submissionGraceMinutes', 5, 'allowedMaterials', 'Codal only',
    'navigationMode', 'free', 'integrityMode', 'record_only',
    'fullscreenPolicy', 'requested', 'admissionMode', 'automatic',
    'temporaryLeaveAcknowledgment', true, 'suggestedAnswerMode', 'none',
    'aiGradingEnabled', false, 'studentAccessCodeRequired', true
  ),
  repeat('d', 64), '5a000000-0000-4000-8000-000000000001', clock_timestamp()
);

update public.exam_room_exams
set current_publication_id = '5a000000-0000-4000-8000-000000000060',
    published_at = clock_timestamp()
where id = '5a000000-0000-4000-8000-000000000020';

insert into public.exam_room_beadle_assignments (
  id, exam_id, beadle_user_id, status, assigned_by, assigned_at, expires_at
) values (
  '5a000000-0000-4000-8000-000000000070',
  '5a000000-0000-4000-8000-000000000020',
  '5a000000-0000-4000-8000-000000000002', 'active',
  '5a000000-0000-4000-8000-000000000001',
  clock_timestamp(), clock_timestamp() + interval '1 day'
);

insert into public.exam_room_credentials (
  id, exam_id, credential_type, token_hash, scoped_user_id, status,
  valid_from, expires_at, created_by
) values (
  '5a000000-0000-4000-8000-000000000080',
  '5a000000-0000-4000-8000-000000000020', 'professor_grading',
  repeat('5', 64), '5a000000-0000-4000-8000-000000000001', 'active',
  clock_timestamp() - interval '1 hour', clock_timestamp() + interval '30 days',
  '5a000000-0000-4000-8000-000000000001'
);

do $real_classroom_behavior$
declare
  v_professor constant uuid := '5a000000-0000-4000-8000-000000000001';
  v_beadle constant uuid := '5a000000-0000-4000-8000-000000000002';
  v_submitted constant uuid := '5a000000-0000-4000-8000-000000000003';
  v_blank constant uuid := '5a000000-0000-4000-8000-000000000004';
  v_active constant uuid := '5a000000-0000-4000-8000-000000000005';
  v_outsider constant uuid := '5a000000-0000-4000-8000-000000000006';
  v_exam_id constant uuid := '5a000000-0000-4000-8000-000000000020';
  v_exam_public constant uuid := '5a000000-0000-4000-8000-000000000021';
  v_question constant uuid := '5a000000-0000-4000-8000-000000000050';
  v_publication constant uuid := '5a000000-0000-4000-8000-000000000060';
  v_question_version constant uuid := '5a000000-0000-4000-8000-000000000040';
  v_student_hash constant text := repeat('2', 64);
  v_result jsonb;
  v_workspace jsonb;
  v_roster_submitted uuid;
  v_roster_blank uuid;
  v_roster_active uuid;
  v_attempt_submitted constant uuid := '5a000000-0000-4000-8000-000000000101';
  v_attempt_blank constant uuid := '5a000000-0000-4000-8000-000000000102';
  v_attempt_active uuid;
begin
  if has_table_privilege('anon', 'public.exam_room_roster_versions', 'select')
    or has_table_privilege('authenticated', 'public.exam_room_grading_memberships', 'insert')
    or has_function_privilege('authenticated',
      'public.exam_room_save_grade_v3(uuid,uuid,uuid,uuid,numeric,text,text,integer,text,text,text)',
      'execute')
  then raise exception 'REAL_CLASSROOM_PRIVILEGE_BOUNDARY_FAILED'; end if;

  v_result := public.exam_room_finalize_roster_access_v1(
    v_beadle, v_exam_public,
    jsonb_build_array(
      jsonb_build_object('name', 'Submitted Student', 'email', 'classroom-submitted@example.invalid'),
      jsonb_build_object('name', 'Blank Student', 'email', 'classroom-blank@example.invalid'),
      jsonb_build_object('name', 'Active Student', 'email', 'classroom-active@example.invalid')
    ),
    'paste', repeat('1', 64), v_student_hash,
    repeat('A', 48), repeat('B', 16), 'staging-key-v1', 'A256GCM',
    'classroom_roster_confirm_0001'
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'rosterCount')::integer <> 3
    or (v_result ->> 'studentEmailsQueued')::integer <> 3
    or (select count(*) from public.exam_room_roster_versions where exam_id = v_exam_id) <> 1
    or (select count(*) from public.exam_room_admissions where exam_id = v_exam_id and status = 'admitted') <> 3
    or (select count(*) from public.exam_room_email_jobs where exam_id = v_exam_id and email_type = 'student_exam_code') <> 3
  then raise exception 'REAL_CLASSROOM_ONE_STEP_ROSTER_FAILED'; end if;

  -- Exact replay is idempotent and cannot duplicate a roster version, code,
  -- admission, or email job.
  v_result := public.exam_room_finalize_roster_access_v1(
    v_beadle, v_exam_public,
    jsonb_build_array(
      jsonb_build_object('name', 'Submitted Student', 'email', 'classroom-submitted@example.invalid'),
      jsonb_build_object('name', 'Blank Student', 'email', 'classroom-blank@example.invalid'),
      jsonb_build_object('name', 'Active Student', 'email', 'classroom-active@example.invalid')
    ),
    'paste', repeat('1', 64), v_student_hash,
    repeat('A', 48), repeat('B', 16), 'staging-key-v1', 'A256GCM',
    'classroom_roster_confirm_0001'
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (select count(*) from public.exam_room_roster_versions where exam_id = v_exam_id) <> 1
    or (select count(*) from public.exam_room_email_jobs where exam_id = v_exam_id and email_type = 'student_exam_code') <> 3
  then raise exception 'REAL_CLASSROOM_ROSTER_REPLAY_FAILED'; end if;

  select id into v_roster_submitted from public.exam_room_roster
  where classroom_id = '5a000000-0000-4000-8000-000000000010'
    and canonical_email = 'classroom-submitted@example.invalid';
  select id into v_roster_blank from public.exam_room_roster
  where classroom_id = '5a000000-0000-4000-8000-000000000010'
    and canonical_email = 'classroom-blank@example.invalid';
  select id into v_roster_active from public.exam_room_roster
  where classroom_id = '5a000000-0000-4000-8000-000000000010'
    and canonical_email = 'classroom-active@example.invalid';

  v_result := public.exam_room_student_waiting_room_by_code_v1(
    v_active, v_student_hash, repeat('3', 64), v_student_hash, repeat('4', 64)
  );
  if v_result ->> 'startBlockerCode' <> 'EXAM_NOT_OPEN'
    or (v_result ->> 'canStart')::boolean is not false
    or v_result ? 'questions'
  then raise exception 'REAL_CLASSROOM_QUESTION_FREE_WAITING_FAILED'; end if;

  v_result := public.exam_room_student_waiting_room_by_code_v1(
    v_outsider, v_student_hash, repeat('7', 64), v_student_hash, repeat('8', 64)
  );
  if (v_result ->> 'eligible')::boolean is not false
    or v_result ?| array['title', 'instructions', 'rules', 'opensAt', 'questions', 'rosterIdentity']
  then raise exception 'REAL_CLASSROOM_OFF_ROSTER_PRIVACY_FAILED'; end if;

  v_result := public.exam_room_student_waiting_room_by_code_v1(
    v_outsider, repeat('9', 64), repeat('7', 64), repeat('9', 64), null
  );
  if v_result ->> 'code' <> 'STUDENT_CODE_INVALID'
    or v_result ?| array['examId', 'title', 'opensAt', 'questions']
  then raise exception 'REAL_CLASSROOM_INVALID_CODE_PRIVACY_FAILED'; end if;

  v_result := public.exam_room_open_exam_now_v1(
    v_professor, v_exam_public, 'The class is ready to begin early.',
    'classroom_open_now_0001'
  );
  if v_result ->> 'status' <> 'open'
    or v_result ->> 'openedEarlyAt' is null
    or not exists (
      select 1 from public.exam_room_exams
      where id = v_exam_id and scheduled_opens_at > opened_early_at
        and opened_early_by = v_professor
    )
    or not exists (
      select 1 from public.exam_room_audit_events_v2
      where exam_id = v_exam_id and event_type = 'exam_opened_early'
    )
  then raise exception 'REAL_CLASSROOM_OPEN_NOW_FAILED'; end if;

  v_result := public.exam_room_start_attempt_by_code_v1(
    v_active, v_student_hash, repeat('3', 64), v_student_hash
  );
  if not coalesce((v_result ->> 'ok')::boolean, true)
    or v_result ->> 'attemptId' is null
  then raise exception 'REAL_CLASSROOM_CODE_ONLY_START_FAILED';
  end if;
  select id into v_attempt_active from public.exam_room_attempts
  where public_id = (v_result ->> 'attemptId')::uuid;

  insert into public.exam_room_attempts (
    id, public_id, exam_id, question_version_id, publication_id, roster_id,
    student_user_id, candidate_number, status, started_at, server_deadline, submitted_at
  ) values
    (v_attempt_submitted, '5a000000-0000-4000-8000-000000000111', v_exam_id,
     v_question_version, v_publication, v_roster_submitted, v_submitted,
     'SUBMITTED-001', 'submitted', clock_timestamp() - interval '20 minutes',
     clock_timestamp() + interval '1 hour', clock_timestamp()),
    (v_attempt_blank, '5a000000-0000-4000-8000-000000000112', v_exam_id,
     v_question_version, v_publication, v_roster_blank, v_blank,
     'BLANK-001', 'submitted', clock_timestamp() - interval '20 minutes',
     clock_timestamp() + interval '1 hour', clock_timestamp());

  insert into public.exam_room_submissions (
    attempt_id, publication_id, generation, request_key,
    answer_snapshot, answer_snapshot_hash, client_answer_set_hash, automatic
  ) values
    (v_attempt_submitted, v_publication, 1, 'classroom_submit_full_0001',
     jsonb_build_array(jsonb_build_object(
       'questionId', v_question, 'answerText', 'Yes. The governing rule applies to the stated facts.'
     )), repeat('a', 64), repeat('b', 64), false),
    (v_attempt_blank, v_publication, 1, 'classroom_submit_blank_0001',
     jsonb_build_array(jsonb_build_object('questionId', v_question, 'answerText', '')),
     repeat('c', 64), repeat('d', 64), false);

  v_workspace := public.exam_room_grading_workspace_v3(
    v_professor, v_exam_public, repeat('5', 64), repeat('6', 64)
  );
  if not coalesce((v_workspace ->> 'ok')::boolean, false)
    or (v_workspace ->> 'submittedCount')::integer <> 2
    or not (v_workspace ->> 'classExamStillOpen')::boolean
    or exists (
      select 1 from jsonb_array_elements(v_workspace -> 'candidates') candidate
      where candidate ->> 'attemptId' = (
        select public_id::text from public.exam_room_attempts where id = v_attempt_active
      )
    )
    or not exists (
      select 1 from jsonb_array_elements(v_workspace -> 'candidates') candidate
      where candidate ->> 'attemptId' = '5a000000-0000-4000-8000-000000000112'
        and (candidate ->> 'unansweredCount')::integer = 1
    )
    or not exists (
      select 1 from jsonb_array_elements(v_workspace -> 'classStatuses') student_status
      where student_status ->> 'studentEmail' = 'classroom-active@example.invalid'
        and (student_status ->> 'active')::boolean
        and student_status ->> 'displayStatus' = 'Active'
    )
  then raise exception 'REAL_CLASSROOM_PER_SUBMISSION_GRADING_FAILED'; end if;

  v_result := public.exam_room_save_grade_v3(
    v_professor, v_exam_public,
    '5a000000-0000-4000-8000-000000000111', v_question,
    4.2, 'Legally responsive and applied.', 'draft', 0,
    'Initial grading draft.', null, null
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'revision')::integer <> 1
  then raise exception 'REAL_CLASSROOM_GRADE_SAVE_FAILED'; end if;

  v_result := public.exam_room_save_grade_v3(
    v_professor, v_exam_public,
    '5a000000-0000-4000-8000-000000000112', v_question,
    0.0, 'The submitted answer was intentionally blank.', 'final', 0,
    'Grade the final blank submission.', null, null
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
  then raise exception 'REAL_CLASSROOM_BLANK_GRADE_FAILED'; end if;

  begin
    perform public.exam_room_save_grade_v3(
      v_professor, v_exam_public,
      (select public_id from public.exam_room_attempts where id = v_attempt_active),
      v_question, 1.0, 'Must not save.', 'draft', 0,
      'Reject an active attempt.', null, null
    );
    raise exception 'REAL_CLASSROOM_ACTIVE_ATTEMPT_WAS_GRADED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_GRADING_NOT_OPEN' then raise; end if;
  end;

  v_workspace := public.exam_room_grading_workspace_v3(
    v_professor, v_exam_public, null, null
  );
  if not coalesce((v_workspace ->> 'ok')::boolean, false)
    or not exists (
      select 1
      from jsonb_array_elements(v_workspace -> 'candidates') candidate,
           jsonb_array_elements(candidate -> 'questions') question
      where candidate ->> 'attemptId' = '5a000000-0000-4000-8000-000000000111'
        and (question ->> 'score')::numeric = 4.2
        and question ->> 'gradeState' = 'draft'
    )
    or (select status from public.exam_room_exams where id = v_exam_id) <> 'open'
    or (select status from public.exam_room_attempts where id = v_attempt_active) <> 'in_progress'
    or (select count(*) from public.exam_room_grading_memberships
        where exam_id = v_exam_id and professor_user_id = v_professor) <> 1
  then raise exception 'REAL_CLASSROOM_GRADE_RELOAD_FAILED'; end if;
end;
$real_classroom_behavior$;

rollback;
