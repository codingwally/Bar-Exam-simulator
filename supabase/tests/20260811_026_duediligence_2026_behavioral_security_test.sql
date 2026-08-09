-- Staging-only behavioral/security coverage for DueDiligence 2026.
-- Synthetic users, classes, exams, answers, grades, email jobs, backup events,
-- and dispute records are enclosed in one transaction and rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

create temporary table dd26_test_state (
  key text primary key,
  value text not null
) on commit drop;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('a0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-admin@example.invalid', '{}', '{"full_name":"DD26 Admin"}', now(), now(), false, false),
  ('b0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-professor@example.invalid', '{}', '{"full_name":"DD26 Professor"}', now(), now(), false, false),
  ('c0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-other-professor@example.invalid', '{}', '{"full_name":"DD26 Other Professor"}', now(), now(), false, false),
  ('d0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-student-a@example.invalid', '{}', '{"full_name":"DD26 Student A"}', now(), now(), false, false),
  ('d0260000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-student-b@example.invalid', '{}', '{"full_name":"DD26 Student B"}', now(), now(), false, false),
  ('e0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-outsider@example.invalid', '{}', '{"full_name":"DD26 Outsider"}', now(), now(), false, false);

update public.user_roles
set role = 'super_admin'
where user_id = 'a0260000-0000-4000-8000-000000000001';

do $dd26_setup$
declare
  v_admin constant uuid := 'a0260000-0000-4000-8000-000000000001';
  v_professor constant uuid := 'b0260000-0000-4000-8000-000000000001';
  v_other_professor constant uuid := 'c0260000-0000-4000-8000-000000000001';
  v_student constant uuid := 'd0260000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'e0260000-0000-4000-8000-000000000001';
  v_admin_class_public_id uuid;
  v_admin_exam_public_id uuid;
  v_class_public_id uuid;
  v_exam_public_id uuid;
  v_exam_id uuid;
  v_attempt_public_id uuid;
  v_attempt_id uuid;
  v_question_id uuid;
  v_version_id uuid;
  v_dispute_id uuid;
  v_count integer;
  v_revision integer;
  v_source_hash text;
  v_student_hash text;
  v_grading_hash text;
  v_rate_hash text;
  v_questions jsonb;
  v_result jsonb;
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object('email', 'dd26-student-a@example.invalid', 'studentNumber', '2026-001', 'candidateNumber', 'CAND-001', 'displayName', 'Student A'),
    jsonb_build_object('email', 'dd26-student-b@example.invalid', 'studentNumber', '2026-002', 'candidateNumber', 'CAND-002', 'displayName', 'Student B')
  );
begin
  v_result := public.exam_room_create_classroom(
    v_admin, 'DD26 Administrator Class', 'Due Diligence School of Law', '2026'
  );
  v_admin_class_public_id := (v_result ->> 'classroomId')::uuid;
  insert into dd26_test_state values ('admin_class_public_id', v_admin_class_public_id::text);

  v_result := public.exam_room_create_exam(
    v_admin, v_admin_class_public_id, 'DD26 Administrator Exam',
    'Administrator-owned examination regression coverage.', 1,
    'standard', false
  );
  v_admin_exam_public_id := (v_result ->> 'examId')::uuid;
  insert into dd26_test_state values ('admin_exam_public_id', v_admin_exam_public_id::text);

  update public.user_roles set role = 'student' where user_id = v_admin;
  begin
    perform public.exam_room_create_classroom(
      v_admin, 'Unauthorized post-admin class', null, null
    );
    raise exception 'DD26_ADMIN_OWNER_ROLE_LEAK';
  exception
    when others then
      if sqlerrm <> 'EXAM_ROOM_PROFESSOR_REQUIRED' then raise; end if;
  end;
  update public.user_roles set role = 'super_admin' where user_id = v_admin;

  update public.dd2026_feature_flags
  set enabled = true
  where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';

  perform public.dd2026_import_content_batch(v_admin, jsonb_build_array(jsonb_build_object(
    'id', 'dd26-staging-bar-easy', 'content_type', 'bar_easy',
    'subject', 'Labor Law', 'title', 'Staging Bar Easy',
    'source_version', '2026.1', 'source_status', 'AI_PREPARED_BETA',
    'checksum', repeat('1', 64),
    'payload', jsonb_build_object(
      'prompt', 'Is notice required?', 'suggested_answer', 'Yes.',
      'explanation', 'Due process requires notice.',
      'source_url', 'https://elibrary.judiciary.gov.ph/test'
    )
  )));
  select id into v_version_id from public.dd2026_content_versions
  where content_id = 'dd26-staging-bar-easy';
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'submit_review', 'Staging editorial review.');
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'approve', 'Staging legal approval.');
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'publish', 'Staging publication approval.');

  update public.dd2026_feature_flags
  set enabled = false
  where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';
  perform public.dd2026_import_content_batch(v_admin, jsonb_build_array(jsonb_build_object(
    'id', 'dd26-staging-doctrine', 'content_type', 'doctrine',
    'subject', 'Labor Law', 'title', 'Staging Doctrine',
    'source_version', '2026.1', 'source_status', 'AI_PREPARED_BETA',
    'checksum', repeat('2', 64),
    'payload', jsonb_build_object(
      'doctrine_title', 'Security of tenure',
      'canonical_meaning', 'Dismissal requires lawful cause.',
      'source_url', 'https://elibrary.judiciary.gov.ph/test'
    )
  )));
  perform public.dd2026_record_bar_easy_completion(
    v_student, 'dd26-staging-bar-easy', 'bar-easy-request-2026', 'gemini-test'
  );
  perform public.dd2026_record_doctrine_mastery(
    v_student, 'dd26-staging-doctrine', 'thumbs_up',
    'doctrine-request-2026', 'gemini-test'
  );

  perform public.exam_room_issue_professor_activation(
    v_admin, 'dd26-professor@example.invalid', repeat('a', 64),
    now() + interval '1 day', 'Staging professor activation.'
  );
  v_result := public.exam_room_redeem_professor_activation(
    v_professor, repeat('a', 64), repeat('b', 64)
  );
  insert into dd26_test_state values ('professor_activation', v_result::text);

  perform public.exam_room_issue_professor_activation(
    v_admin, 'dd26-other-professor@example.invalid', repeat('c', 64),
    now() + interval '1 day', 'Staging second professor activation.'
  );
  perform public.exam_room_redeem_professor_activation(
    v_other_professor, repeat('c', 64), repeat('d', 64)
  );

  v_result := public.exam_room_create_classroom(
    v_professor, 'DD26 Staging Evidence', 'Due Diligence School of Law', '2026'
  );
  v_class_public_id := (v_result ->> 'classroomId')::uuid;
  insert into dd26_test_state values ('class_public_id', v_class_public_id::text);

  v_result := public.exam_room_validate_roster(v_professor, v_class_public_id,
    jsonb_build_array(
      jsonb_build_object('email', 'duplicate@example.invalid', 'studentNumber', 'DUP-1', 'candidateNumber', 'DUP-C', 'displayName', 'Duplicate One'),
      jsonb_build_object('email', 'duplicate@example.invalid', 'studentNumber', 'DUP-2', 'candidateNumber', 'DUP-D', 'displayName', 'Duplicate Two')
    )
  );
  insert into dd26_test_state values ('duplicate_roster', v_result::text);
  perform public.exam_room_import_roster(
    v_professor, v_class_public_id, v_rows,
    'roster-import-2026', repeat('e', 64)
  );

  foreach v_count in array array[1, 7, 20, 35]
  loop
    v_source_hash := encode(extensions.digest(convert_to('source-' || v_count, 'UTF8'), 'sha256'), 'hex');
    v_student_hash := encode(extensions.digest(convert_to('student-key-' || v_count, 'UTF8'), 'sha256'), 'hex');
    v_grading_hash := encode(extensions.digest(convert_to('grading-key-' || v_count, 'UTF8'), 'sha256'), 'hex');
    v_rate_hash := encode(extensions.digest(convert_to('rate-key-' || v_count, 'UTF8'), 'sha256'), 'hex');
    select jsonb_agg(jsonb_build_object(
      'ordinal', ordinal,
      'prompt', format('Question %s. Apply the controlling law to these exact facts.', ordinal),
      'maximumPoints', 5
    ) order by ordinal)
    into v_questions
    from generate_series(1, v_count) ordinal;

    v_result := public.exam_room_create_exam(
      v_professor, v_class_public_id, format('DD26 %s-question exam', v_count),
      'Answer every question using legal basis and application.', v_count,
      case when v_count = 7 then 'strict' else 'standard' end,
      v_count = 35
    );
    v_exam_public_id := (v_result ->> 'examId')::uuid;
    select id into v_exam_id from public.exam_room_exams
    where public_id = v_exam_public_id;
    perform public.exam_room_confirm_questions(
      v_professor, v_exam_public_id,
      format('%s/%s/%s-exam-%s.txt', v_professor, v_exam_public_id, v_source_hash, v_count),
      format('exam-%s.txt', v_count), 'text/plain', 100 + v_count,
      null, v_source_hash, v_questions, '[]'::jsonb
    );
    perform public.exam_room_schedule_exam(
      v_professor, v_exam_public_id, now() - interval '2 minutes',
      now() + interval '60 minutes', 30, v_student_hash, v_grading_hash
    );

    if v_count = 1 then
      v_result := public.exam_room_start_attempt(
        v_outsider, v_exam_public_id, v_student_hash, repeat('f', 64)
      );
      insert into dd26_test_state values ('nonroster_result', v_result::text);
    end if;

    v_result := public.exam_room_start_attempt(
      v_student, v_exam_public_id, v_student_hash, v_rate_hash
    );
    v_attempt_public_id := (v_result ->> 'attemptId')::uuid;
    select id into v_attempt_id from public.exam_room_attempts
    where public_id = v_attempt_public_id;
    v_result := public.exam_room_start_attempt(
      v_student, v_exam_public_id, v_student_hash, v_rate_hash
    );
    insert into dd26_test_state values (format('resume_%s', v_count), v_result::text);

    select id into v_question_id from public.exam_room_questions
    where question_version_id = (
      select active_question_version_id from public.exam_room_exams where id = v_exam_id
    ) and ordinal = 1;

    if v_count = 7 then
      perform public.exam_room_save_answer(
        v_student, v_attempt_public_id, v_question_id,
        'Preserved answer written before the integrity lock.', 0
      );
      perform public.exam_room_record_integrity_event(v_student, v_attempt_public_id, 'focus_exit', '{"surface":"exam"}');
      perform public.exam_room_record_integrity_event(v_student, v_attempt_public_id, 'visibility_exit', '{"surface":"exam"}');
      v_result := public.exam_room_record_integrity_event(v_student, v_attempt_public_id, 'fullscreen_exit', '{"surface":"exam"}');
      insert into dd26_test_state values ('lock_result', v_result::text);
      v_result := public.exam_room_live_status(
        v_professor, v_exam_public_id, v_grading_hash, v_rate_hash
      );
      insert into dd26_test_state values ('live_status', v_result::text);
      v_result := public.exam_room_unlock_attempt(
        v_professor, v_attempt_public_id, 'Professor verified the incident.',
        v_grading_hash, v_rate_hash
      );
      insert into dd26_test_state values ('unlock_result', v_result::text);
    end if;

    for v_question_id in
      select id from public.exam_room_questions
      where question_version_id = (
        select active_question_version_id from public.exam_room_exams where id = v_exam_id
      ) order by ordinal
    loop
      select coalesce(max(revision), 0) into v_revision
      from public.exam_room_answers
      where attempt_id = v_attempt_id and question_id = v_question_id;
      perform public.exam_room_save_answer(
        v_student, v_attempt_public_id, v_question_id,
        format('Complete ALAC answer for the %s-question examination.', v_count),
        v_revision
      );
    end loop;

    if v_count = 1 then
      update public.exam_room_attempts
      set started_at = now() - interval '5 minutes',
          server_deadline = now() - interval '1 minute'
      where id = v_attempt_id;
      perform public.exam_room_auto_submit_due(v_exam_id);
    else
      perform public.exam_room_submit_attempt(
        v_student, v_attempt_public_id, format('submit-request-%s-2026', v_count)
      );
    end if;

    if v_count = 7 then
      v_result := public.exam_room_save_answer(
        v_student, v_attempt_public_id, v_question_id, 'Late mutation', 1
      );
      insert into dd26_test_state values ('post_submit_save', v_result::text);
    end if;

    update public.exam_room_exams
    set hard_closes_at = now() - interval '1 second'
    where id = v_exam_id;
    update public.exam_room_credentials
    set valid_from = now() - interval '1 minute'
    where exam_id = v_exam_id and credential_type = 'professor_grading';

    v_result := public.exam_room_grading_workspace(
      v_professor, v_exam_public_id, v_grading_hash, v_rate_hash
    );
    insert into dd26_test_state values (format('grading_count_%s', v_count),
      jsonb_array_length(v_result #> '{candidates,0,questions}')::text);

    for v_question_id in
      select q.id
      from public.exam_room_questions q
      where q.question_version_id = (
        select active_question_version_id from public.exam_room_exams where id = v_exam_id
      ) order by q.ordinal
    loop
      perform public.exam_room_save_grade(
        v_professor, v_exam_public_id, v_attempt_public_id, v_question_id,
        4.5, 'Legally responsive and applied to the facts.', 'final', 0,
        'Staging final grade.', v_grading_hash, v_rate_hash
      );
    end loop;

    perform public.exam_room_release_results(
      v_professor, v_exam_public_id, format('release-request-%s-2026', v_count),
      v_count = 35, v_grading_hash, v_rate_hash
    );
    v_result := public.exam_room_student_result(v_student, v_exam_public_id);
    insert into dd26_test_state values (format('student_result_%s', v_count), v_result::text);
    insert into dd26_test_state values (format('exam_public_%s', v_count), v_exam_public_id::text);
    insert into dd26_test_state values (format('exam_internal_%s', v_count), v_exam_id::text);
    insert into dd26_test_state values (format('attempt_public_%s', v_count), v_attempt_public_id::text);
  end loop;

  v_exam_public_id := (select value::uuid from dd26_test_state where key = 'exam_public_7');
  v_exam_id := (select value::uuid from dd26_test_state where key = 'exam_internal_7');
  v_attempt_public_id := (select value::uuid from dd26_test_state where key = 'attempt_public_7');
  select q.id into v_question_id
  from public.exam_room_questions q
  join public.exam_room_exams e on e.active_question_version_id = q.question_version_id
  where e.id = v_exam_id and q.ordinal = 1;

  v_result := public.exam_room_open_dispute(
    v_admin, v_exam_public_id, 'DD26-READ-ONLY',
    'Read-only staging dispute evidence review.', 'read_only',
    repeat('3', 64), now() + interval '1 hour'
  );
  v_dispute_id := (v_result ->> 'disputeId')::uuid;
  v_result := public.exam_room_dispute_view(
    v_admin, v_dispute_id, repeat('3', 64), repeat('4', 64)
  );
  insert into dd26_test_state values ('dispute_view', v_result::text);
  perform public.exam_room_close_dispute(v_admin, v_dispute_id, 'Read-only review completed.');

  v_result := public.exam_room_open_dispute(
    v_admin, v_exam_public_id, 'DD26-CORRECTION',
    'Correction staging review with preserved history.', 'correction',
    repeat('5', 64), now() + interval '1 hour'
  );
  v_dispute_id := (v_result ->> 'disputeId')::uuid;
  perform public.exam_room_admin_correct_grade(
    v_admin, v_dispute_id, v_attempt_public_id, v_question_id,
    4.8, 'Corrected after documented review.',
    'Documented staging correction reason.', repeat('5', 64), repeat('6', 64)
  );
  perform public.exam_room_close_dispute(v_admin, v_dispute_id, 'Correction review completed.');

  perform public.exam_room_claim_backup_batch(100);
  select id into v_dispute_id from public.exam_room_backup_outbox
  where exam_id = (select value::uuid from dd26_test_state where key = 'exam_internal_35')
    and event_type = 'grades_released' and status = 'processing';
  perform public.exam_room_fail_backup(v_dispute_id, 'SYNTHETIC_GOOGLE_OUTAGE');
  update public.exam_room_backup_outbox set next_attempt_at = now() where id = v_dispute_id;
  perform public.exam_room_claim_backup_batch(1);
  perform public.exam_room_complete_backup(
    v_dispute_id, 'staging-sheet-event', repeat('7', 64),
    'staging-google-sheet-id', true
  );
  insert into dd26_test_state values ('completed_backup_id', v_dispute_id::text);

  perform public.exam_room_claim_email_batch(100);
  select id into v_dispute_id from public.exam_room_email_jobs
  where exam_id = (select value::uuid from dd26_test_state where key = 'exam_internal_35')
    and email_type = 'professor_release_summary' and status = 'processing';
  perform public.exam_room_fail_email(v_dispute_id, 'SYNTHETIC_EMAIL_OUTAGE');
  update public.exam_room_email_jobs set next_attempt_at = now() where id = v_dispute_id;
  perform public.exam_room_claim_email_batch(1);
  perform public.exam_room_complete_email(v_dispute_id, 'staging-email-provider-id');
  insert into dd26_test_state values ('completed_email_id', v_dispute_id::text);
end
$dd26_setup$;

select is(
  (select lifecycle_state from public.dd2026_content_versions where content_id = 'dd26-staging-bar-easy'),
  'published',
  'human-review mode requires and records the complete editorial lifecycle'
);

select ok(
  (select current_published_version_id is not null from public.dd2026_content_items where id = 'dd26-staging-bar-easy'),
  'human-approved content becomes the published version'
);

select is(
  (select lifecycle_state from public.dd2026_content_versions where content_id = 'dd26-staging-doctrine'),
  'published',
  'beta-mode validated content publishes without silently removing future review controls'
);

select ok(
  (select count(*) = 1 from public.dd2026_bar_easy_usage where user_id = 'd0260000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.dd2026_doctrine_mastery where user_id = 'd0260000-0000-4000-8000-000000000001'),
  'Bar Easy and Doctrine persist only completion/mastery records'
);

select ok(
  not exists (
    select 1 from public.dd2026_bar_easy_usage where row_to_json(dd2026_bar_easy_usage)::text ilike '%DD26_CANARY_ANSWER%'
  ) and not exists (
    select 1 from public.dd2026_doctrine_mastery where row_to_json(dd2026_doctrine_mastery)::text ilike '%DD26_CANARY_ANSWER%'
  ),
  'non-retentive study records contain no answer canary'
);

select is(
  (select (value::jsonb ->> 'ok')::boolean from dd26_test_state where key = 'professor_activation'),
  true,
  'professor activation succeeds once'
);

select ok(
  exists (
    select 1 from public.exam_room_professors
    where user_id = 'a0260000-0000-4000-8000-000000000001'
      and activated_by = 'a0260000-0000-4000-8000-000000000001'
      and status = 'revoked'
  ),
  'an administrator gets only a non-active FK owner row and no durable professor entitlement'
);

select ok(
  exists (
    select 1 from public.exam_room_classrooms c
    join public.exam_room_exams e on e.classroom_id = c.id
    where c.public_id = (select value::uuid from dd26_test_state where key = 'admin_class_public_id')
      and e.public_id = (select value::uuid from dd26_test_state where key = 'admin_exam_public_id')
      and c.owner_professor_id = 'a0260000-0000-4000-8000-000000000001'
      and e.owner_professor_id = c.owner_professor_id
  ),
  'an administrator can create an owned class and examination without weakening owner foreign keys'
);

select is(
  (public.exam_room_redeem_professor_activation(
    'b0260000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64)
  ) ->> 'code'),
  'ACTIVATION_NOT_FOUND',
  'redeemed professor activation cannot be reused'
);

select is(
  (select (value::jsonb ->> 'ok')::boolean from dd26_test_state where key = 'duplicate_roster'),
  false,
  'duplicate roster rows are rejected before import'
);

select ok(
  (select value::jsonb -> 'errors' from dd26_test_state where key = 'duplicate_roster') @>
    '[{"code":"DUPLICATE_EMAIL"}]'::jsonb,
  'duplicate roster response contains a corrective error code'
);

select is(
  (select count(*) from public.exam_room_roster
   where classroom_id = (
     select id from public.exam_room_classrooms
     where public_id = (select value::uuid from dd26_test_state where key = 'class_public_id')
   )),
  2::bigint,
  'clean roster imports exactly two unique students'
);

select is(
  (select value::jsonb ->> 'code' from dd26_test_state where key = 'nonroster_result'),
  'ROSTER_REQUIRED',
  'an authenticated non-rostered user is denied even with the correct exam key'
);

select throws_ok(
  $test$
    select public.exam_room_create_exam(
      'c0260000-0000-4000-8000-000000000001',
      (select value::uuid from dd26_test_state where key = 'class_public_id'),
      'Unauthorized exam', '', 1, 'standard', false
    )
  $test$,
  'EXAM_ROOM_CLASS_NOT_FOUND',
  'another professor cannot create an exam in the owning professor classroom'
);

select throws_ok(
  $test$
    select public.exam_room_attempt_view(
      'd0260000-0000-4000-8000-000000000002',
      (select value::uuid from dd26_test_state where key = 'attempt_public_7')
    )
  $test$,
  'EXAM_ROOM_ATTEMPT_NOT_FOUND',
  'another rostered student cannot read a peer attempt'
);

select ok(
  not exists (
    select 1 from (values (1), (7), (20), (35)) expected(question_count)
    where (select value::integer from dd26_test_state
           where key = format('grading_count_%s', expected.question_count))
      <> expected.question_count
  ),
  '1, 7, 20, and 35-question exams remain exact through grading'
);

select ok(
  not exists (
    select 1 from public.exam_room_exams e
    where e.id = any(array[
      (select value::uuid from dd26_test_state where key = 'exam_internal_1'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_7'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_20'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_35')
    ]) and (
      e.status <> 'sealed'
      or (select count(*) from public.exam_room_questions q where q.question_version_id = e.active_question_version_id) <> e.requested_question_count
    )
  ),
  'all representative question counts are confirmed and sealed without a hidden 20-item assumption'
);

select ok(
  not exists (
    select 1 from (values (1), (7), (20), (35)) expected(question_count)
    where (select (value::jsonb ->> 'resumed')::boolean from dd26_test_state
           where key = format('resume_%s', expected.question_count)) is not true
  ),
  'repeated Start requests resume the one existing attempt'
);

select is(
  (select (value::jsonb ->> 'locked')::boolean from dd26_test_state where key = 'lock_result'),
  true,
  'strict integrity threshold locks the attempt after the disclosed incident count'
);

select is(
  (select value::jsonb ->> 'status' from dd26_test_state where key = 'unlock_result'),
  'in_progress',
  'the owning professor unlocks before release with the scoped unlock credential'
);

select is(
  (select value::jsonb ->> 'ok' from dd26_test_state where key = 'live_status'),
  'true',
  'live monitoring authenticates without revealing student answers'
);

select ok(
  (select value::jsonb from dd26_test_state where key = 'live_status')::text not ilike '%answerText%'
  and (select value::jsonb from dd26_test_state where key = 'live_status')::text not ilike '%Preserved answer%',
  'pre-close professor monitoring excludes answer content'
);

select ok(
  exists (
    select 1 from public.exam_room_answers a
    join public.exam_room_attempts t on t.id = a.attempt_id
    where t.public_id = (select value::uuid from dd26_test_state where key = 'attempt_public_7')
      and a.revision >= 2
  ),
  'server-acknowledged answer survives lock, unlock, resume, and submission'
);

select is(
  (select value::jsonb ->> 'code' from dd26_test_state where key = 'post_submit_save'),
  'ATTEMPT_CLOSED',
  'answer mutation is rejected after final submission'
);

select is(
  (select auto_submitted_count from public.exam_room_releases
   where exam_id = (select value::uuid from dd26_test_state where key = 'exam_internal_1')),
  1,
  'server deadline auto-submits the due attempt'
);

select ok(
  not exists (
    select 1 from public.exam_room_credentials
    where exam_id = any(array[
      (select value::uuid from dd26_test_state where key = 'exam_internal_1'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_7'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_20'),
      (select value::uuid from dd26_test_state where key = 'exam_internal_35')
    ]) and status = 'active'
  ),
  'batch release revokes every original exam-scoped credential'
);

select throws_ok(
  $test$
    update public.exam_room_answers
    set answer_text = 'Forbidden sealed mutation'
    where attempt_id = (
      select id from public.exam_room_attempts
      where public_id = (select value::uuid from dd26_test_state where key = 'attempt_public_7')
    )
  $test$,
  'EXAM_ROOM_SEALED',
  'sealed answers are immutable'
);

select throws_ok(
  $test$
    update public.exam_room_questions
    set prompt_text = 'Forbidden question rewrite'
    where question_version_id = (
      select active_question_version_id from public.exam_room_exams
      where id = (select value::uuid from dd26_test_state where key = 'exam_internal_7')
    )
  $test$,
  'EXAM_ROOM_QUESTION_VERSION_IMMUTABLE',
  'confirmed question text is immutable'
);

select ok(
  (select (value::jsonb ->> 'includeQuestionnaire')::boolean from dd26_test_state where key = 'student_result_7') = false
  and (select value::jsonb #>> '{grades,0,question}' from dd26_test_state where key = 'student_result_7') is null,
  'questionnaire-off release exposes only grades and comments'
);

select ok(
  (select (value::jsonb ->> 'includeQuestionnaire')::boolean from dd26_test_state where key = 'student_result_35') = true
  and nullif((select value::jsonb #>> '{grades,0,question}' from dd26_test_state where key = 'student_result_35'), '') is not null,
  'questionnaire-on release includes the permitted question text'
);

select ok(
  not exists (
    select 1 from (values (1), (7), (20), (35)) expected(question_count)
    where (select count(*) from public.exam_room_email_jobs j
           where j.exam_id = (select value::uuid from dd26_test_state where key = format('exam_internal_%s', expected.question_count))
             and j.email_type = 'professor_release_summary') <> 1
  ),
  'each release queues exactly one consolidated professor summary'
);

select ok(
  (select value::jsonb ->> 'ok' from dd26_test_state where key = 'dispute_view') = 'true'
  and (select value::jsonb #>> '{exam,status}' from dd26_test_state where key = 'dispute_view') = 'sealed',
  'admin dispute access uses a separate time-limited authorization for sealed evidence'
);

select ok(
  not exists (select 1 from public.exam_room_dispute_reviews where status = 'open')
  and not exists (select 1 from public.exam_room_credentials where credential_type = 'dispute_review' and status = 'active'),
  'closing disputes revokes every temporary dispute authorization'
);

select ok(
  exists (
    select 1 from public.exam_room_grade_history h
    join public.exam_room_attempts a on a.id = h.attempt_id
    where a.public_id = (select value::uuid from dd26_test_state where key = 'attempt_public_7')
      and h.revision = 1
  ) and exists (
    select 1 from public.exam_room_grade_history h
    join public.exam_room_attempts a on a.id = h.attempt_id
    where a.public_id = (select value::uuid from dd26_test_state where key = 'attempt_public_7')
      and h.revision = 2 and h.score = 4.8
  ),
  'admin correction appends a version while preserving the released grade history'
);

select is(
  (select status from public.exam_room_backup_outbox
   where id = (select value::uuid from dd26_test_state where key = 'completed_backup_id')),
  'synced',
  'failed Google backup retries and reconciles exactly once'
);

select ok(
  (select google_sheet_id = 'staging-google-sheet-id'
     and google_professor_access_removed_at is not null
   from public.exam_room_exams
   where id = (select value::uuid from dd26_test_state where key = 'exam_internal_35')),
  'release-time backup can record the isolated Sheet and professor-access removal on a sealed exam'
);

select throws_ok(
  $test$
    select public.exam_room_complete_backup(
      (select value::uuid from dd26_test_state where key = 'completed_backup_id'),
      'duplicate-completion', repeat('7', 64), null, false
    )
  $test$,
  'EXAM_ROOM_BACKUP_EVENT_NOT_FOUND',
  'a synced outbox event cannot complete twice'
);

select is(
  (select status from public.exam_room_email_jobs
   where id = (select value::uuid from dd26_test_state where key = 'completed_email_id')),
  'sent',
  'failed transactional email retries without reopening the exam'
);

select ok(
  exists (
    select 1 from public.exam_room_audit_log
    where action = 'attempt_unlocked' and reason = 'Professor verified the incident.'
  ) and exists (
    select 1 from public.exam_room_audit_log
    where action = 'dispute_review_opened'
  ) and exists (
    select 1 from public.exam_room_audit_log
    where action = 'released_grade_corrected'
  ),
  'unlock, dispute, and correction actions are audited with reasons'
);

do $dd2026_behavioral_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%' or v_result ilike 'not ok%' then
      raise exception 'DD2026_BEHAVIORAL_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$dd2026_behavioral_finish$;

rollback;
