-- Staging-only behavioral and security verification for the shared examination engine.
-- Every synthetic record is wrapped in a transaction and rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '91000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'exam-admin@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Examination Admin"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '91000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'exam-student-a@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Examination Student A"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '91000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'exam-student-b@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Examination Student B"}'::jsonb,
    now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id = '91000000-0000-4000-8000-000000000001'::uuid;

do $examination_behavior$
declare
  v_admin constant uuid := '91000000-0000-4000-8000-000000000001'::uuid;
  v_student_a constant uuid := '91000000-0000-4000-8000-000000000002'::uuid;
  v_student_b constant uuid := '91000000-0000-4000-8000-000000000003'::uuid;
  v_result jsonb;
  v_exam_id uuid;
  v_version_id uuid;
  v_attempt_id uuid;
  v_second_attempt_id uuid;
  v_question_ids jsonb;
  v_question_id uuid;
  v_assignment_token constant text :=
    'synthetic_assignment_token_1234567890abcdef';
  v_assignment_id uuid;
  v_revision_sum integer;
  v_upload_id uuid;
  v_upload_version_id uuid;
  v_submission_count integer;
  v_counter integer;
begin
  if not public.examination_is_admin(v_admin) then
    raise exception 'TEST_FAILED: synthetic admin role not recognized';
  end if;
  if public.examination_is_admin(v_student_a) then
    raise exception 'TEST_FAILED: student incorrectly recognized as admin';
  end if;

  perform public.examination_admin(
    v_admin,
    'set_beta_access',
    jsonb_build_object(
      'userId', v_student_a,
      'enabled', true,
      'expiresAt', now() + interval '1 day',
      'reason', 'Synthetic staging beta access.',
      'requestKey', 'staging_beta_access_0001'
    )
  );
  if not public.examination_has_beta_access(v_student_a) then
    raise exception 'TEST_FAILED: allowlisted student lacks beta access';
  end if;
  if public.examination_has_beta_access(v_student_b) then
    raise exception 'TEST_FAILED: unlisted student received beta access';
  end if;

  select jsonb_agg(id order by source_key)
  into v_question_ids
  from (
    select id, source_key
    from public.examination_questions
    where subject = 'Criminal Law I'
      and review_status = 'approved'
      and publication_ready
    order by source_key
    limit 5
  ) approved;
  if jsonb_array_length(coalesce(v_question_ids, '[]'::jsonb)) <> 5 then
    raise exception 'TEST_FAILED: expected five approved Criminal Law I questions';
  end if;
  if (
    select count(*)
    from public.examination_questions
    where id in (
      select value::uuid
      from jsonb_array_elements_text(v_question_ids)
    )
      and bar_year = 2026
      and nullif(question_number, '') is not null
      and nullif(difficulty, '') is not null
      and nullif(doctrine, '') is not null
      and source_metadata->>'editorialStatus' = 'Approved'
      and source_metadata->>'publicationReady' = 'Yes'
  ) <> 5 then
    raise exception 'TEST_FAILED: approved source metadata was not preserved';
  end if;

  v_result := public.examination_admin(v_admin, 'dashboard', '{}'::jsonb);
  if jsonb_array_length(coalesce(v_result->'approvedQuestions', '[]'::jsonb)) < 20
    or not exists (
      select 1
      from jsonb_array_elements(v_result->'approvedQuestions') item
      where item->>'sourceQuestionId' = 'LEB-Y1T1-JD401-20260729-Q01'
        and item->>'difficulty' = 'Foundational'
        and item->>'barYear' = '2026'
    )
  then
    raise exception 'TEST_FAILED: admin dashboard omitted approved source fields';
  end if;

  v_result := public.examination_admin(
    v_admin,
    'create_exam',
    jsonb_build_object(
      'track', 'per_subject',
      'assessmentKind', 'system_test',
      'title', 'SYNTHETIC ROLLBACK Subject Matter System Test',
      'subject', 'Criminal Law I',
      'yearLevel', 1,
      'testOnly', true,
      'reason', 'Synthetic staging engine verification.',
      'requestKey', 'staging_create_exam_0001'
    )
  );
  v_exam_id := (v_result->>'examId')::uuid;

  v_result := public.examination_admin(
    v_admin,
    'create_version',
    jsonb_build_object(
      'examId', v_exam_id,
      'label', 'Synthetic rollback v1',
      'durationSeconds', 600,
      'timerMode', 'strict',
      'gradingRoute', 'either',
      'answerReleaseRule', 'after_ai',
      'instructions', 'Synthetic test. Answer every question using ALAC.',
      'syllabus', jsonb_build_array('General Principles', 'Criminal Liability'),
      'reason', 'Synthetic staging version verification.',
      'requestKey', 'staging_create_version_0001'
    )
  );
  v_version_id := (v_result->>'versionId')::uuid;

  perform public.examination_admin(
    v_admin,
    'set_questions',
    jsonb_build_object(
      'versionId', v_version_id,
      'questionIds', v_question_ids,
      'reason', 'Attach five approved unique questions.',
      'requestKey', 'staging_set_questions_0001'
    )
  );
  v_result := public.examination_admin(
    v_admin,
    'publish_version',
    jsonb_build_object(
      'versionId', v_version_id,
      'reason', 'Publish controlled synthetic staging version.',
      'requestKey', 'staging_publish_version_0001'
    )
  );
  if v_result->>'status' <> 'published' or (v_result->>'questionCount')::integer <> 5 then
    raise exception 'TEST_FAILED: controlled version was not published correctly';
  end if;

  begin
    update public.examination_versions
    set duration_seconds = 601
    where id = v_version_id;
    raise exception 'TEST_FAILED: published version mutation was permitted';
  exception
    when others then
      if sqlerrm not like '%EXAM_VERSION_IMMUTABLE%' then raise; end if;
  end;

  v_result := public.examination_query(
    v_student_a, 'setup', jsonb_build_object('versionId', v_version_id)
  );
  if v_result::text ~* 'modelAnswer|legalBasis|application_snapshot|conclusion_snapshot' then
    raise exception 'TEST_FAILED: setup leaked sealed grading content';
  end if;
  if exists (
    select 1 from public.examination_attempts_multi
    where user_id = v_student_a and version_id = v_version_id
  ) then
    raise exception 'TEST_FAILED: reading setup started the timer';
  end if;

  begin
    perform public.examination_query(
      v_student_b, 'setup', jsonb_build_object('versionId', v_version_id)
    );
    raise exception 'TEST_FAILED: non-allowlisted student opened setup';
  exception
    when others then
      if sqlerrm not like '%EXAM_BETA_ACCESS_REQUIRED%' then raise; end if;
  end;

  v_result := public.examination_command(
    v_student_a,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_version_id,
      'timerMode', 'strict',
      'requestKey', 'staging_start_attempt_0001',
      'tabToken', 'staging_primary_tab_token_1234567890'
    )
  );
  v_attempt_id := (v_result->'attempt'->>'attemptId')::uuid;
  if v_attempt_id is null
    or (v_result->'attempt'->>'remainingSeconds')::integer > 600
    or (v_result->'attempt'->>'remainingSeconds')::integer < 590
  then
    raise exception 'TEST_FAILED: strict overall timer was not started by confirmation';
  end if;

  v_result := public.examination_command(
    v_student_a,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_version_id,
      'timerMode', 'strict',
      'requestKey', 'staging_start_attempt_0001',
      'tabToken', 'staging_primary_tab_token_1234567890'
    )
  );
  if (v_result->'attempt'->>'attemptId')::uuid <> v_attempt_id then
    raise exception 'TEST_FAILED: repeated start request created a second attempt';
  end if;

  begin
    perform public.examination_command(
      v_student_a,
      'heartbeat',
      jsonb_build_object(
        'attemptId', v_attempt_id,
        'tabToken', 'staging_secondary_tab_token_0987654321',
        'takeover', false
      )
    );
    raise exception 'TEST_FAILED: concurrent second tab was accepted';
  exception
    when others then
      if sqlerrm not like '%EXAM_SECOND_TAB_BLOCKED%' then raise; end if;
  end;

  v_question_id := (v_question_ids->>0)::uuid;
  v_result := public.examination_command(
    v_student_a,
    'save_response',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'questionId', v_question_id,
      'tabToken', 'staging_primary_tab_token_1234567890',
      'answerText', 'Answer: No. Legal Basis: Article 3. Application: The exact facts negate criminal intent. Conclusion: No criminal liability.',
      'expectedRevision', 0,
      'flagged', false
    )
  );
  if (v_result->>'revision')::integer <> 1 then
    raise exception 'TEST_FAILED: first server answer revision was not recorded';
  end if;

  begin
    perform public.examination_command(
      v_student_a,
      'save_response',
      jsonb_build_object(
        'attemptId', v_attempt_id,
        'questionId', v_question_id,
        'tabToken', 'staging_primary_tab_token_1234567890',
        'answerText', 'Stale overwrite.',
        'expectedRevision', 0,
        'flagged', false
      )
    );
    raise exception 'TEST_FAILED: stale answer revision overwrote server state';
  exception
    when others then
      if sqlerrm not like '%EXAM_RESPONSE_CONFLICT%' then raise; end if;
  end;

  begin
    perform public.examination_query(
      v_student_b, 'resume', jsonb_build_object('attemptId', v_attempt_id)
    );
    raise exception 'TEST_FAILED: another student resumed the private attempt';
  exception
    when others then
      if sqlerrm not like '%EXAM_ATTEMPT_NOT_FOUND%'
        and sqlerrm not like '%EXAM_BETA_ACCESS_REQUIRED%'
      then raise; end if;
  end;

  v_result := public.examination_query(
    v_student_a, 'verdict', jsonb_build_object('attemptId', v_attempt_id)
  );
  if exists (
    select 1
    from jsonb_array_elements(v_result->'results') item
    where item->>'modelAnswer' is not null
  ) then
    raise exception 'TEST_FAILED: verdict released model answer before grading finalization';
  end if;

  v_result := public.examination_command(
    v_student_a,
    'submit_attempt',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'tabToken', 'staging_primary_tab_token_1234567890',
      'requestKey', 'staging_submit_attempt_0001',
      'confirmed', true
    )
  );
  if v_result->>'receiptCode' is null then
    raise exception 'TEST_FAILED: submission receipt was not issued';
  end if;
  perform public.examination_command(
    v_student_a,
    'submit_attempt',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'tabToken', 'staging_primary_tab_token_1234567890',
      'requestKey', 'staging_submit_attempt_0001',
      'confirmed', true
    )
  );
  select count(*) into v_submission_count
  from public.examination_submissions where attempt_id = v_attempt_id;
  if v_submission_count <> 1 then
    raise exception 'TEST_FAILED: duplicate submission records were created';
  end if;

  v_result := public.examination_command(
    v_student_a,
    'request_ai_grading',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'requestKey', 'staging_ai_request_0001'
    )
  );
  if jsonb_array_length(v_result->'questions') <> 5
    or v_result->'questions'->0->>'modelAnswer' is null
  then
    raise exception 'TEST_FAILED: Worker-only grading package is incomplete';
  end if;

  v_counter := 0;
  for v_question_id in
    select question_id
    from public.examination_version_questions
    where version_id = v_version_id
    order by ordinal
  loop
    v_counter := v_counter + 1;
    select public.examination_store_ai_assessment(
      v_student_a,
      (v_result->>'jobId')::uuid,
      v_question_id,
      round((3.0 + v_counter / 10.0)::numeric, 1),
      jsonb_build_object(
        'score', round((3.0 + v_counter / 10.0)::numeric, 1),
        'rationale', 'Synthetic rollback assessment.',
        'modelAnswerALAC', jsonb_build_object(
          'answer', 'Synthetic',
          'legalBasis', 'Synthetic',
          'application', 'Synthetic',
          'conclusion', 'Synthetic'
        )
      ),
      'synthetic-grader',
      (
        select snapshot_hash
        from public.examination_version_questions
        where version_id = v_version_id and question_id = v_question_id
      )
    ) into v_result;
  end loop;
  if v_result->>'status' <> 'completed'
    or (v_result->>'completedQuestions')::integer <> 5
  then
    raise exception 'TEST_FAILED: individual AI assessments did not finalize the job';
  end if;

  v_result := public.examination_command(
    v_student_a,
    'request_ai_grading',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'requestKey', 'staging_ai_request_0002'
    )
  );
  if coalesce(jsonb_array_length(v_result->'questions'), 0) <> 0
    or v_result->>'status' <> 'completed'
  then
    raise exception 'TEST_FAILED: completed grading job re-exposed assessed packages';
  end if;

  v_result := public.examination_query(
    v_student_a, 'verdict', jsonb_build_object('attemptId', v_attempt_id)
  );
  if jsonb_array_length(v_result->'results') <> 5
    or not exists (
      select 1
      from jsonb_array_elements(v_result->'results') item
      where item->>'modelAnswer' is not null
    )
  then
    raise exception 'TEST_FAILED: finalized individual verdict or model release missing';
  end if;

  -- A second attempt validates strict automatic full-exam submission on expiry.
  v_result := public.examination_command(
    v_student_a,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_version_id,
      'timerMode', 'strict',
      'requestKey', 'staging_start_attempt_0002',
      'tabToken', 'staging_expiry_tab_token_12345678901'
    )
  );
  v_second_attempt_id := (v_result->'attempt'->>'attemptId')::uuid;
  update public.examination_attempts_multi
  set deadline_at = now() - interval '1 second'
  where id = v_second_attempt_id;
  v_result := public.examination_command(
    v_student_a,
    'heartbeat',
    jsonb_build_object(
      'attemptId', v_second_attempt_id,
      'tabToken', 'staging_expiry_tab_token_12345678901',
      'takeover', false
    )
  );
  if coalesce((v_result->>'automatic')::boolean, false) is not true
    or v_result->>'status' <> 'expired'
  then
    raise exception 'TEST_FAILED: strict expiration did not submit the full exam';
  end if;

  -- Human review is independently assignable and finalization is single-use.
  v_result := public.examination_command(
    v_student_a,
    'create_examiner_assignment',
    jsonb_build_object(
      'attemptId', v_second_attempt_id,
      'examinerEmail', 'human-examiner@example.invalid',
      'assignmentToken', v_assignment_token,
      'requestKey', 'staging_human_assign_0001'
    )
  );
  v_assignment_id := (v_result->>'assignmentId')::uuid;
  v_result := public.examination_query(
    null, 'assignment', jsonb_build_object('assignmentToken', v_assignment_token)
  );
  if (v_result->>'assignmentId')::uuid <> v_assignment_id
    or jsonb_array_length(v_result->'questions') <> 5
  then
    raise exception 'TEST_FAILED: secure examiner assignment query failed';
  end if;
  v_revision_sum := 0;
  for v_question_id in
    select question_id
    from public.examination_version_questions
    where version_id = v_version_id
    order by ordinal
  loop
    perform public.examination_command(
      null,
      'save_examiner_review',
      jsonb_build_object(
        'assignmentToken', v_assignment_token,
        'questionId', v_question_id,
        'score', 4.2,
        'comments', 'Synthetic structured examiner comment.',
        'expectedRevision', 0
      )
    );
    v_revision_sum := v_revision_sum + 1;
  end loop;
  v_result := public.examination_command(
    null,
    'finalize_examiner_review',
    jsonb_build_object(
      'assignmentToken', v_assignment_token,
      'expectedRevision', v_revision_sum,
      'confirmed', true
    )
  );
  if v_result->>'status' <> 'finalized' then
    raise exception 'TEST_FAILED: human review did not finalize';
  end if;
  begin
    perform public.examination_command(
      null,
      'finalize_examiner_review',
      jsonb_build_object(
        'assignmentToken', v_assignment_token,
        'expectedRevision', v_revision_sum,
        'confirmed', true
      )
    );
    raise exception 'TEST_FAILED: human review finalized concurrently twice';
  exception
    when others then
      if sqlerrm not like '%EXAM_ASSIGNMENT_FINALIZED%' then raise; end if;
  end;

  -- Uploaded examination metadata remains owner-private and starts no timer before confirmation.
  v_result := public.examination_register_upload(
    v_student_a,
    v_student_a::text || '/' || repeat('a', 64) || '/synthetic-exam.txt',
    'synthetic-exam.txt',
    'text/plain',
    256,
    repeat('a', 64),
    jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'prompt', 'Explain this synthetic uploaded legal question with sufficient detail.')
    ),
    'staging_upload_register_0001'
  );
  v_upload_id := (v_result->>'uploadId')::uuid;
  if exists (
    select 1 from public.examination_attempts_multi
    where user_id = v_student_a and created_at >= now() - interval '2 seconds'
      and version_id not in (v_version_id)
  ) then
    raise exception 'TEST_FAILED: parsing an upload started an attempt';
  end if;
  v_result := public.examination_confirm_upload(
    v_student_a,
    v_upload_id,
    'SYNTHETIC ROLLBACK Uploaded Examination',
    'none',
    600,
    'human',
    'staging_upload_confirm_0001'
  );
  v_upload_version_id := (v_result->>'versionId')::uuid;
  if v_upload_version_id is null or (v_result->>'questionCount')::integer <> 1 then
    raise exception 'TEST_FAILED: private uploaded examination confirmation failed';
  end if;
  begin
    perform public.examination_query(
      v_student_b, 'setup', jsonb_build_object('versionId', v_upload_version_id)
    );
    raise exception 'TEST_FAILED: another user opened a private upload';
  exception
    when others then
      if sqlerrm not like '%EXAM_BETA_ACCESS_REQUIRED%'
        and sqlerrm not like '%EXAM_NOT_AVAILABLE%'
      then raise; end if;
  end;

  -- Recursive metadata safety rejects sensitive keys at any nesting depth.
  begin
    insert into public.examination_audit_log (
      actor_user_id, action, resource_type, resource_id, reason, metadata
    ) values (
      v_admin, 'synthetic_forbidden', 'test', 'nested',
      'Synthetic nested sensitive-key rejection.',
      '{"outer":{"answer_text":"must not persist"}}'::jsonb
    );
    raise exception 'TEST_FAILED: nested sensitive metadata was stored';
  exception
    when check_violation then null;
  end;

  if has_table_privilege('anon', 'public.examination_questions', 'SELECT')
    or has_table_privilege('authenticated', 'public.examination_attempts_multi', 'SELECT')
    or has_table_privilege('authenticated', 'public.examination_responses', 'UPDATE')
    or exists (
      select 1
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name like 'examination\_%' escape '\'
        and grantee = 'PUBLIC'
    )
  then
    raise exception 'TEST_FAILED: browser role received direct examination-table privileges';
  end if;

  if not has_table_privilege('service_role', 'public.examination_questions', 'SELECT')
    or not has_table_privilege('service_role', 'public.examination_responses', 'UPDATE')
  then
    raise exception 'TEST_FAILED: trusted backend lacks required examination privileges';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name like 'examination\_%' escape '\'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  ) then
    raise exception 'TEST_FAILED: browser role can execute Worker-only examination functions';
  end if;

  if not exists (
    select 1 from public.examination_audit_log
    where action = 'admin_publish_version' and actor_user_id = v_admin
  ) then
    raise exception 'TEST_FAILED: publication audit record missing';
  end if;

  raise notice 'EXAMINATION_BEHAVIORAL_SECURITY_TEST_PASSED';
end
$examination_behavior$;

select jsonb_build_object(
  'status', 'passed',
  'syntheticUsers', 3,
  'approvedQuestionsUsed', 5,
  'transactionRolledBack', true
) as examination_test_result;

rollback;
