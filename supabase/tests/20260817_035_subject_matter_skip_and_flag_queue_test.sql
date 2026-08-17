-- Staging-only structural, security, and transactional coverage for Subject
-- Matter Skip and Flagged for later. Synthetic records are rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select has_column(
  'public', 'examination_attempts_multi', 'subject_matter_skipped_at',
  'Subject Matter attempts persist a dedicated skipped timestamp'
);

select has_column(
  'public', 'examination_attempts_multi', 'subject_matter_skip_request_key',
  'Subject Matter skips persist an owner-scoped idempotency key'
);

select has_column(
  'public', 'examination_attempts_multi', 'subject_matter_skip_next_version_id',
  'Subject Matter skips persist the atomically selected next version'
);

select ok(
  position('subject_matter_skipped_at IS NULL' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.examination_attempts_multi'::regclass
       and conname = 'examination_attempts_subject_skip_check')
  )) > 0
  and position('subject_matter_skip_request_key IS NULL' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.examination_attempts_multi'::regclass
       and conname = 'examination_attempts_subject_skip_check')
  )) > 0
  and position('subject_matter_skipped_at IS NOT NULL' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.examination_attempts_multi'::regclass
       and conname = 'examination_attempts_subject_skip_check')
  )) > 0
  and position('subject_matter_skip_request_key IS NOT NULL' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.examination_attempts_multi'::regclass
       and conname = 'examination_attempts_subject_skip_check')
  )) > 0,
  'skip lifecycle fields must be absent together or form one closed, unsubmitted skip'
);

select function_returns(
  'public', 'subject_matter_skip_question',
  array['uuid', 'uuid', 'text', 'text'], 'jsonb',
  'the trusted Subject Matter skip operation exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.subject_matter_skip_question(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.subject_matter_skip_question(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.subject_matter_skip_question(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.subject_matter_skip_question(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only the trusted service role can execute Subject Matter skip'
);

select ok(
  (select prosecdef
     and exists (
       select 1
       from unnest(coalesce(proconfig, '{}'::text[])) setting
       where setting in ('search_path=', 'search_path=""')
     )
   from pg_proc
   where oid = 'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure),
  'Subject Matter skip is SECURITY DEFINER with an explicitly empty search path'
);

select ok(
  position('attempt.user_id = p_user_id' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('examination_authorize_access' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'the Worker-supplied verified user remains bound to the owned attempt'
);

select ok(
  position('active_tab_hash <> v_tab_hash' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'skip cannot bypass the active browser-tab lease'
);

select ok(
  position('subject_matter_skip_request_key <> v_request_key' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('''replayed'', true' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'repeating the same skip request replays its stored result without advancing twice'
);

select ok(
  position('version.id <> v_attempt.version_id' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('EXAM_SUBJECT_NO_ALTERNATE_QUESTION' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'skip must return a different published question or fail plainly'
);

select ok(
  position('seen_question_ids = v_seen_question_ids' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('cycle_number = cycle_number + case' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'skips preserve no-repeat progress and safely cross cycle boundaries'
);

select ok(
  position('status = ''cancelled''' in pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('insert into public.examination_submissions' in lower(pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  ))) = 0
  and position('insert into public.examination_grading_jobs' in lower(pg_get_functiondef(
    'public.subject_matter_skip_question(uuid,uuid,text,text)'::regprocedure
  ))) = 0,
  'skip closes without creating a submission, grading job, or score'
);

select ok(
  position('''skippedQuestions''' in pg_get_functiondef(
    'public.subject_matter_performance(uuid,text,integer)'::regprocedure
  )) > 0
  and position('attempt.subject_matter_skipped_at is null' in lower(pg_get_functiondef(
    'public.subject_matter_performance(uuid,text,integer)'::regprocedure
  ))) > 0,
  'performance reports skips separately and excludes them from opened-question metrics'
);

select ok(
  position('''flaggedForLater''' in pg_get_functiondef(
    'public.subject_matter_performance(uuid,text,integer)'::regprocedure
  )) > 0
  and position('response.flagged' in pg_get_functiondef(
    'public.subject_matter_performance(uuid,text,integer)'::regprocedure
  )) > 0
  and position('later_attempt.version_id = attempt.version_id' in pg_get_functiondef(
    'public.subject_matter_performance(uuid,text,integer)'::regprocedure
  )) > 0,
  'a skipped flagged question remains private and discoverable until later submission'
);

create temp table issue8_subject_matter_behavior (
  flag_only_visible boolean not null,
  saved_draft_visible boolean not null,
  other_owner_private boolean not null,
  first_skip_different boolean not null,
  same_key_replayed boolean not null,
  different_key_rejected boolean not null,
  null_request_key_rejected boolean not null,
  skip_wrote_no_assessment boolean not null,
  exhaustion_restarted_without_repeat boolean not null,
  retry_skip_preserved_cycle boolean not null,
  skipped_metric_separate boolean not null,
  later_submission_cleared_queue boolean not null
) on commit drop;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '98000000-0000-4000-8000-000000000801'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'issue8-owner@example.invalid',
    '{}'::jsonb, '{"full_name":"Issue 8 Synthetic Owner"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '98000000-0000-4000-8000-000000000802'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'issue8-other@example.invalid',
    '{}'::jsonb, '{"full_name":"Issue 8 Synthetic Other"}'::jsonb,
    now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin', updated_at = now()
where user_id in (
  '98000000-0000-4000-8000-000000000801'::uuid,
  '98000000-0000-4000-8000-000000000802'::uuid
);

do $issue8_behavior$
declare
  v_owner constant uuid := '98000000-0000-4000-8000-000000000801'::uuid;
  v_other constant uuid := '98000000-0000-4000-8000-000000000802'::uuid;
  v_tab constant text := 'issue8_primary_tab_token_12345678901234567890';
  v_subject text;
  v_year smallint;
  v_term smallint;
  v_selection jsonb;
  v_active jsonb;
  v_saved jsonb;
  v_flagged jsonb;
  v_performance jsonb;
  v_private_performance jsonb;
  v_first_skip jsonb;
  v_replay jsonb;
  v_exhaustion_skip jsonb;
  v_retry_skip jsonb;
  v_first_version uuid;
  v_second_version uuid;
  v_third_version uuid;
  v_attempt uuid;
  v_question uuid;
  v_all_question_ids uuid[];
  v_cycle_before public.subject_matter_cycles%rowtype;
  v_cycle_after public.subject_matter_cycles%rowtype;
  v_different_key_rejected boolean := false;
  v_null_request_key_rejected boolean := false;
  v_flag_only_visible boolean := false;
  v_saved_draft_visible boolean := false;
  v_skip_wrote_no_assessment boolean := false;
  v_exhaustion_ok boolean := false;
  v_retry_preserved boolean := false;
  v_submission_count integer;
  v_job_count integer;
  v_assessment_count integer;
begin
  select placement.course_name, placement.year_level, placement.term
  into v_subject, v_year, v_term
  from public.subject_matter_placements placement
  join public.examination_definitions definition on definition.id = placement.exam_id
  join public.examination_versions version on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
  where definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1
  group by placement.course_name, placement.year_level, placement.term
  having count(distinct version_question.question_id) >= 3
  order by placement.course_name, placement.year_level, placement.term
  limit 1;

  if v_subject is null then
    raise exception 'TEST_FAILED: Issue 8 requires a selectable course with three questions';
  end if;

  v_selection := public.subject_matter_next_question(
    v_owner, v_subject, v_year, v_term, false
  );
  v_first_version := (v_selection->'setup'->>'versionId')::uuid;
  if v_first_version is null then
    raise exception 'TEST_FAILED: Subject Matter fixture did not select a first version';
  end if;

  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_first_version,
      'timerMode', 'selfPaced',
      'requestKey', 'issue8_start_first_0001',
      'tabToken', v_tab
    )
  );
  v_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_question := (v_active->'questions'->0->>'questionId')::uuid;

  v_saved := public.examination_command(
    v_owner,
    'save_response',
    jsonb_build_object(
      'attemptId', v_attempt,
      'questionId', v_question,
      'tabToken', v_tab,
      'expectedRevision', 0,
      'answerText', 'Synthetic saved draft retained for later review.',
      'flagged', false
    )
  );
  v_flagged := public.examination_command(
    v_owner,
    'flag_response',
    jsonb_build_object(
      'attemptId', v_attempt,
      'questionId', v_question,
      'tabToken', v_tab,
      'expectedRevision', (v_saved->>'revision')::integer,
      'flagged', true
    )
  );

  v_performance := public.subject_matter_performance(v_owner, v_subject, 50);
  v_private_performance := public.subject_matter_performance(v_other, v_subject, 50);
  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_performance->'flaggedForLater', '[]'::jsonb)) item
    where (item->>'attemptId')::uuid = v_attempt
      and coalesce((item->>'resumable')::boolean, false)
  ), exists (
    select 1
    from jsonb_array_elements(coalesce(v_performance->'flaggedForLater', '[]'::jsonb)) item
    where (item->>'attemptId')::uuid = v_attempt
      and item->>'answerText' = 'Synthetic saved draft retained for later review.'
  )
  into v_flag_only_visible, v_saved_draft_visible;

  v_first_skip := public.subject_matter_skip_question(
    v_owner, v_attempt, 'issue8_skip_first_0001', v_tab
  );
  v_second_version := (v_first_skip->'setup'->>'versionId')::uuid;
  begin
    update public.examination_attempts_multi
    set subject_matter_skip_request_key = null
    where id = v_attempt;
  exception when check_violation then
    v_null_request_key_rejected := true;
  end;
  v_replay := public.subject_matter_skip_question(
    v_owner, v_attempt, 'issue8_skip_first_0001', v_tab
  );

  begin
    perform public.subject_matter_skip_question(
      v_owner, v_attempt, 'issue8_skip_different_0001', v_tab
    );
  exception when others then
    v_different_key_rejected := sqlerrm = 'EXAM_ATTEMPT_CLOSED';
  end;

  -- The behavioral fixture intentionally exercises several normally separate
  -- RPC requests inside one rolled-back database transaction. Attempt starts
  -- therefore share transaction_timestamp(), while Skip correctly records the
  -- wall-clock time with clock_timestamp(). Move only this synthetic skip one
  -- second behind the fixture's transaction clock so the later-submission
  -- predicate models the ordering of real, separate HTTP requests.
  update public.examination_attempts_multi
  set subject_matter_skipped_at = transaction_timestamp() - interval '1 second'
  where id = v_attempt;

  select count(*) into v_submission_count
  from public.examination_submissions submission
  join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;
  select count(*) into v_job_count
  from public.examination_grading_jobs job
  join public.examination_attempts_multi attempt on attempt.id = job.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;
  select count(*) into v_assessment_count
  from public.examination_ai_assessments assessment
  join public.examination_attempts_multi attempt on attempt.id = assessment.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;

  -- Force the ordinary active question to the end of a fully seen cycle. Skip
  -- must restart once, retain the skipped question in the new seen set, and
  -- still select a different question.
  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_second_version,
      'timerMode', 'selfPaced',
      'requestKey', 'issue8_start_exhaust_0001',
      'tabToken', v_tab
    )
  );
  v_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_question := (v_active->'questions'->0->>'questionId')::uuid;

  select array_agg(distinct version_question.question_id)
  into v_all_question_ids
  from public.subject_matter_placements placement
  join public.examination_definitions definition on definition.id = placement.exam_id
  join public.examination_versions version on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
  where placement.course_name = v_subject
    and placement.year_level = v_year
    and placement.term = v_term
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1;

  update public.subject_matter_cycles
  set seen_question_ids = v_all_question_ids,
      updated_at = now()
  where user_id = v_owner
    and subject = v_subject
    and year_level = v_year
    and term = v_term
  returning * into v_cycle_before;

  v_exhaustion_skip := public.subject_matter_skip_question(
    v_owner, v_attempt, 'issue8_skip_exhaust_0001', v_tab
  );
  v_third_version := (v_exhaustion_skip->'setup'->>'versionId')::uuid;
  select * into v_cycle_after
  from public.subject_matter_cycles
  where user_id = v_owner
    and subject = v_subject
    and year_level = v_year
    and term = v_term;
  v_exhaustion_ok := coalesce((v_exhaustion_skip->>'cycleRestarted')::boolean, false)
    and v_third_version <> v_second_version
    and v_cycle_after.active_version_id = v_third_version
    and v_cycle_after.cycle_number = v_cycle_before.cycle_number + 1
    and cardinality(v_cycle_after.seen_question_ids) = 1
    and v_question = any(v_cycle_after.seen_question_ids);

  -- Reopen the original flagged version directly. Its Skip must close only
  -- that retry and return the cycle's current active version unchanged.
  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_first_version,
      'timerMode', 'selfPaced',
      'requestKey', 'issue8_start_retry_skip_0001',
      'tabToken', v_tab
    )
  );
  v_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  select * into v_cycle_before
  from public.subject_matter_cycles
  where user_id = v_owner
    and subject = v_subject
    and year_level = v_year
    and term = v_term;
  v_retry_skip := public.subject_matter_skip_question(
    v_owner, v_attempt, 'issue8_skip_retry_0001', v_tab
  );
  select * into v_cycle_after
  from public.subject_matter_cycles
  where user_id = v_owner
    and subject = v_subject
    and year_level = v_year
    and term = v_term;
  v_retry_preserved := coalesce((v_retry_skip->>'cyclePreserved')::boolean, false)
    and (v_retry_skip->'setup'->>'versionId')::uuid = v_cycle_before.active_version_id
    and v_cycle_after.active_version_id = v_cycle_before.active_version_id
    and v_cycle_after.seen_question_ids = v_cycle_before.seen_question_ids
    and v_cycle_after.cycle_number = v_cycle_before.cycle_number
    and v_cycle_after.updated_at = v_cycle_before.updated_at;

  select count(*) into v_submission_count
  from public.examination_submissions submission
  join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;
  select count(*) into v_job_count
  from public.examination_grading_jobs job
  join public.examination_attempts_multi attempt on attempt.id = job.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;
  select count(*) into v_assessment_count
  from public.examination_ai_assessments assessment
  join public.examination_attempts_multi attempt on attempt.id = assessment.attempt_id
  where attempt.user_id = v_owner
    and attempt.subject_matter_skipped_at is not null;
  v_skip_wrote_no_assessment := v_submission_count = 0
    and v_job_count = 0
    and v_assessment_count = 0;

  -- A later real submission of that immutable version clears its older
  -- skipped flag while leaving skip counts separate from completed work.
  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_first_version,
      'timerMode', 'selfPaced',
      'requestKey', 'issue8_start_retry_submit_0001',
      'tabToken', v_tab
    )
  );
  v_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_question := (v_active->'questions'->0->>'questionId')::uuid;
  perform public.examination_command(
    v_owner,
    'save_response',
    jsonb_build_object(
      'attemptId', v_attempt,
      'questionId', v_question,
      'tabToken', v_tab,
      'expectedRevision', 0,
      'answerText', 'Synthetic later submitted answer.',
      'flagged', false
    )
  );
  perform public.examination_command(
    v_owner,
    'submit_attempt',
    jsonb_build_object(
      'attemptId', v_attempt,
      'requestKey', 'issue8_submit_retry_0001',
      'tabToken', v_tab,
      'confirmed', true
    )
  );
  v_performance := public.subject_matter_performance(v_owner, v_subject, 50);

  insert into issue8_subject_matter_behavior values (
    v_flag_only_visible,
    v_saved_draft_visible,
    jsonb_array_length(coalesce(v_private_performance->'flaggedForLater', '[]'::jsonb)) = 0,
    v_second_version is not null and v_second_version <> v_first_version,
    coalesce((v_replay->>'replayed')::boolean, false)
      and (v_replay->'setup'->>'versionId')::uuid = v_second_version,
    v_different_key_rejected,
    v_null_request_key_rejected,
    v_skip_wrote_no_assessment,
    v_exhaustion_ok,
    v_retry_preserved,
    (v_performance->>'skippedQuestions')::integer = 3
      and (v_performance->>'completedQuestions')::integer = 1,
    not exists (
      select 1
      from jsonb_array_elements(coalesce(v_performance->'flaggedForLater', '[]'::jsonb)) item
      where (item->>'versionId')::uuid = v_first_version
    )
  );
end;
$issue8_behavior$;

select ok(flag_only_visible,
  'flag-only then leave remains discoverable as one resumable private queue item')
from issue8_subject_matter_behavior;
select ok(saved_draft_visible,
  'the flag-only queue lifecycle preserves its saved draft')
from issue8_subject_matter_behavior;
select ok(other_owner_private,
  'another authenticated owner cannot see the flagged queue')
from issue8_subject_matter_behavior;
select ok(first_skip_different,
  'skip returns a genuinely different eligible question')
from issue8_subject_matter_behavior;
select ok(same_key_replayed,
  'same-key skip replay returns the stored next question without a second advance')
from issue8_subject_matter_behavior;
select ok(different_key_rejected,
  'a different idempotency key cannot repurpose a closed skipped attempt')
from issue8_subject_matter_behavior;
select ok(null_request_key_rejected,
  'the skip lifecycle CHECK rejects a cancelled skipped row with a NULL request key')
from issue8_subject_matter_behavior;
select ok(skip_wrote_no_assessment,
  'skips create no submission, grading job, or assessment row')
from issue8_subject_matter_behavior;
select ok(exhaustion_restarted_without_repeat,
  'cycle exhaustion restarts once and still returns a different question')
from issue8_subject_matter_behavior;
select ok(retry_skip_preserved_cycle,
  'skipping an out-of-cycle flagged retry preserves the active no-repeat cycle exactly')
from issue8_subject_matter_behavior;
select ok(skipped_metric_separate,
  'skipped questions are counted separately from completed submissions')
from issue8_subject_matter_behavior;
select ok(later_submission_cleared_queue,
  'a later submission clears the older flagged skipped version from the queue')
from issue8_subject_matter_behavior;

select * from finish();
rollback;
