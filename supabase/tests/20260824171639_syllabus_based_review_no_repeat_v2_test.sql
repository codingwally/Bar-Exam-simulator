-- Staging-only pgTAP coverage for the opt-in Syllabus-Based Review v2
-- selector and skip RPCs.  Synthetic mutations are rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select has_column(
  'public',
  'examination_attempts_multi',
  'subject_matter_skip_exhausted_v2',
  'terminal Syllabus-Based Review skips have an explicit durable state'
);

select ok(
  position('subject_matter_skip_exhausted_v2 IS TRUE' in pg_get_constraintdef(
    (
      select oid
      from pg_constraint
      where conrelid = 'public.examination_attempts_multi'::regclass
        and conname = 'examination_attempts_subject_skip_check'
    )
  )) > 0
  and position('subject_matter_skip_next_version_id IS NULL' in pg_get_constraintdef(
    (
      select oid
      from pg_constraint
      where conrelid = 'public.examination_attempts_multi'::regclass
        and conname = 'examination_attempts_subject_skip_check'
    )
  )) > 0,
  'the attempt constraint accepts an explicit terminal skip without inventing a next version'
);

select function_returns(
  'public',
  'subject_matter_next_question_v2',
  array['uuid', 'text', 'smallint', 'smallint', 'boolean'],
  'jsonb',
  'the versioned lifetime selector exists'
);

select function_returns(
  'public',
  'subject_matter_skip_question_v2',
  array['uuid', 'uuid', 'text', 'text'],
  'jsonb',
  'the versioned terminal skip operation exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only the trusted service role can execute either v2 rotation RPC'
);

select ok(
  (
    select prosecdef
      and exists (
        select 1
        from unnest(coalesce(proconfig, '{}'::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
    from pg_proc
    where oid = 'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )
  and (
    select prosecdef
      and exists (
        select 1
        from unnest(coalesce(proconfig, '{}'::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
    from pg_proc
    where oid = 'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  ),
  'both SECURITY DEFINER functions pin an empty search path'
);

select ok(
  position('subject-cycle:' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('subject-cycle:' in pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  )) > 0
  and position('for update of cycle' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('for update of cycle' in pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'selector and skip share one owner/course/year/term advisory lock plus row locking'
);

select ok(
  position('history_placement.course_name = v_course' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('history_placement.year_level = p_year_level' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('history_placement.term = p_term' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('btrim(coalesce(history_response.answer_text' in lower(pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  ))) > 0,
  'lifetime answered exclusion is bound to the exact course/year/term scope'
);

select ok(
  position('SUBJECT_MATTER_RESET_RETIRED' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) > 0
  and position('cycle_number = cycle_number +' in pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  )) = 0
  and position('cycle_number = cycle_number +' in pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  )) = 0
  and position('''cycleRestarted'', false' in pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'v2 contains no normal reset, recycle, or automatic skip-cycle restart'
);

select ok(
  position('insert into public.examination_submissions' in lower(pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  ))) = 0
  and position('insert into public.examination_grading_jobs' in lower(pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  ))) = 0
  and position('phase4_reserve' in lower(pg_get_functiondef(
    'public.subject_matter_next_question_v2(uuid,text,smallint,smallint,boolean)'::regprocedure
  ))) = 0
  and position('phase4_reserve' in lower(pg_get_functiondef(
    'public.subject_matter_skip_question_v2(uuid,uuid,text,text)'::regprocedure
  ))) = 0,
  'selection and skip never submit, grade, or reserve a grading credit'
);

create temp table syllabus_v2_behavior (
  active_draft_restored boolean not null,
  lifetime_nonblank_excluded boolean not null,
  ordinary_skip_different boolean not null,
  ordinary_skip_replayed boolean not null,
  terminal_skip_returned boolean not null,
  terminal_skip_replayed boolean not null,
  different_key_rejected boolean not null,
  terminal_next_returned boolean not null,
  reset_rejected boolean not null,
  cycle_never_restarted boolean not null,
  no_grade_side_effects boolean not null,
  terminal_state_durable boolean not null
) on commit drop;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
) values (
  '98000000-0000-4000-8000-000000000901'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'syllabus-v2-owner@example.invalid',
  '{}'::jsonb,
  '{"full_name":"Syllabus v2 Synthetic Owner"}'::jsonb,
  now(),
  now(),
  false,
  false
);

update public.user_roles
set role = 'super_admin', updated_at = now()
where user_id = '98000000-0000-4000-8000-000000000901'::uuid;

insert into public.terms_acceptances (
  user_id,
  terms_version,
  privacy_version,
  acceptance_source
)
select
  '98000000-0000-4000-8000-000000000901'::uuid,
  settings.current_terms_version,
  settings.current_privacy_version,
  'syllabus_v2_staging_test'
from public.platform_access_settings settings
where settings.singleton = true;

do $syllabus_v2_behavior$
declare
  v_owner constant uuid := '98000000-0000-4000-8000-000000000901'::uuid;
  v_tab constant text := 'syllabus_v2_primary_tab_token_12345678901234567890';
  v_course text;
  v_year smallint;
  v_term smallint;
  v_first_selection jsonb;
  v_restored_selection jsonb;
  v_second_selection jsonb;
  v_terminal_selection jsonb;
  v_active jsonb;
  v_saved jsonb;
  v_ordinary_skip jsonb;
  v_ordinary_replay jsonb;
  v_terminal_skip jsonb;
  v_replayed_skip jsonb;
  v_first_version uuid;
  v_second_version uuid;
  v_terminal_version uuid;
  v_first_attempt uuid;
  v_second_attempt uuid;
  v_terminal_attempt uuid;
  v_first_question uuid;
  v_second_question uuid;
  v_terminal_question uuid;
  v_other_question_ids uuid[];
  v_cycle_before integer;
  v_cycle_after integer;
  v_reset_rejected boolean := false;
  v_different_key_rejected boolean := false;
  v_no_grade_side_effects boolean := false;
  v_terminal_state_durable boolean := false;
begin
  select
    placement.course_name,
    placement.year_level,
    placement.term
  into v_course, v_year, v_term
  from public.subject_matter_placements placement
  join public.examination_definitions definition
    on definition.id = placement.exam_id
  join public.examination_versions version
    on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = placement.question_id
  where definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1
  group by placement.course_name, placement.year_level, placement.term
  having count(distinct version_question.question_id) >= 3
  order by placement.course_name, placement.year_level, placement.term
  limit 1;

  if v_course is null then
    raise exception 'TEST_FAILED: Syllabus v2 requires a published course with at least three questions';
  end if;

  v_first_selection := public.subject_matter_next_question_v2(
    v_owner,
    v_course,
    v_year,
    v_term,
    false
  );
  v_first_version := (v_first_selection->'setup'->>'versionId')::uuid;

  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_first_version,
      'timerMode', 'selfPaced',
      'requestKey', 'syllabus_v2_start_first_0001',
      'tabToken', v_tab
    )
  );
  v_first_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_first_question := (v_active->'questions'->0->>'questionId')::uuid;

  v_saved := public.examination_command(
    v_owner,
    'save_response',
    jsonb_build_object(
      'attemptId', v_first_attempt,
      'questionId', v_first_question,
      'tabToken', v_tab,
      'expectedRevision', 0,
      'answerText', 'A nonblank synthetic draft that must remain permanently excluded after closure.',
      'flagged', false
    )
  );

  -- A nonblank draft in an open attempt is restored rather than replaced.
  v_restored_selection := public.subject_matter_next_question_v2(
    v_owner,
    v_course,
    v_year,
    v_term,
    false
  );

  -- Simulate an old closed draft plus a legacy cycle reset.  v2 must recover
  -- lifetime answered history from the response/attempt records, not merely
  -- trust the mutable legacy seen array.
  update public.examination_attempts_multi
  set status = 'cancelled',
      submission_reason = 'Synthetic closed draft for lifetime exclusion test.',
      tab_lease_until = now(),
      updated_at = now()
  where id = v_first_attempt
    and user_id = v_owner;

  update public.subject_matter_cycles
  set seen_question_ids = '{}'::uuid[],
      active_version_id = null,
      updated_at = now()
  where user_id = v_owner
    and subject = v_course
    and year_level = v_year
    and term = v_term;

  v_second_selection := public.subject_matter_next_question_v2(
    v_owner,
    v_course,
    v_year,
    v_term,
    false
  );
  v_second_version := (v_second_selection->'setup'->>'versionId')::uuid;

  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_second_version,
      'timerMode', 'selfPaced',
      'requestKey', 'syllabus_v2_start_second_0001',
      'tabToken', v_tab
    )
  );
  v_second_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_second_question := (v_active->'questions'->0->>'questionId')::uuid;

  select cycle_number
  into v_cycle_before
  from public.subject_matter_cycles
  where user_id = v_owner
    and subject = v_course
    and year_level = v_year
    and term = v_term;

  v_ordinary_skip := public.subject_matter_skip_question_v2(
    v_owner,
    v_second_attempt,
    'syllabus_v2_skip_ordinary_0001',
    v_tab
  );
  v_terminal_version := (v_ordinary_skip->'setup'->>'versionId')::uuid;

  v_ordinary_replay := public.subject_matter_skip_question_v2(
    v_owner,
    v_second_attempt,
    'syllabus_v2_skip_ordinary_0001',
    v_tab
  );

  v_active := public.examination_command(
    v_owner,
    'start_attempt',
    jsonb_build_object(
      'versionId', v_terminal_version,
      'timerMode', 'selfPaced',
      'requestKey', 'syllabus_v2_start_terminal_0001',
      'tabToken', v_tab
    )
  );
  v_terminal_attempt := (v_active->'attempt'->>'attemptId')::uuid;
  v_terminal_question := (v_active->'questions'->0->>'questionId')::uuid;

  select array_agg(distinct version_question.question_id)
    filter (where version_question.question_id <> v_terminal_question)
  into v_other_question_ids
  from public.subject_matter_placements placement
  join public.examination_definitions definition
    on definition.id = placement.exam_id
  join public.examination_versions version
    on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = placement.question_id
  where placement.course_name = v_course
    and placement.year_level = v_year
    and placement.term = v_term
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1;

  update public.subject_matter_cycles
  set seen_question_ids = v_other_question_ids,
      active_version_id = v_terminal_version,
      updated_at = now()
  where user_id = v_owner
    and subject = v_course
    and year_level = v_year
    and term = v_term;

  v_terminal_skip := public.subject_matter_skip_question_v2(
    v_owner,
    v_terminal_attempt,
    'syllabus_v2_skip_terminal_0001',
    v_tab
  );

  v_replayed_skip := public.subject_matter_skip_question_v2(
    v_owner,
    v_terminal_attempt,
    'syllabus_v2_skip_terminal_0001',
    v_tab
  );

  begin
    perform public.subject_matter_skip_question_v2(
      v_owner,
      v_terminal_attempt,
      'syllabus_v2_skip_different_0001',
      v_tab
    );
  exception when others then
    v_different_key_rejected := sqlerrm = 'EXAM_ATTEMPT_CLOSED';
  end;

  select cycle_number
  into v_cycle_after
  from public.subject_matter_cycles
  where user_id = v_owner
    and subject = v_course
    and year_level = v_year
    and term = v_term;

  v_terminal_selection := public.subject_matter_next_question_v2(
    v_owner,
    v_course,
    v_year,
    v_term,
    false
  );

  begin
    perform public.subject_matter_next_question_v2(
      v_owner,
      v_course,
      v_year,
      v_term,
      true
    );
  exception when others then
    v_reset_rejected := sqlerrm = 'SUBJECT_MATTER_RESET_RETIRED';
  end;

  select
    attempt.subject_matter_skip_exhausted_v2
      and attempt.subject_matter_skip_next_version_id is null
      and attempt.status = 'cancelled'
      and attempt.submitted_at is null
  into v_terminal_state_durable
  from public.examination_attempts_multi attempt
  where attempt.id = v_terminal_attempt;

  select
    not exists (
      select 1
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt
        on attempt.id = submission.attempt_id
      where attempt.user_id = v_owner
    )
    and not exists (
      select 1
      from public.examination_grading_jobs job
      join public.examination_attempts_multi attempt
        on attempt.id = job.attempt_id
      where attempt.user_id = v_owner
    )
    and not exists (
      select 1
      from public.examination_ai_assessments assessment
      join public.examination_attempts_multi attempt
        on attempt.id = assessment.attempt_id
      where attempt.user_id = v_owner
    )
    and not exists (
      select 1
      from public.grade_reservations reservation
      where reservation.user_id = v_owner
    )
  into v_no_grade_side_effects;

  insert into syllabus_v2_behavior values (
    coalesce((v_restored_selection->>'activeRestored')::boolean, false)
      and (v_restored_selection->'setup'->>'versionId')::uuid = v_first_version,
    v_second_version is not null and v_second_version <> v_first_version,
    coalesce((v_ordinary_skip->>'skipped')::boolean, false)
      and coalesce((v_ordinary_skip->>'exhausted')::boolean, true) is false
      and v_terminal_version is not null
      and v_terminal_version <> v_second_version,
    coalesce((v_ordinary_replay->>'replayed')::boolean, false)
      and (v_ordinary_replay->'setup'->>'versionId')::uuid = v_terminal_version,
    coalesce((v_terminal_skip->>'skipped')::boolean, false)
      and coalesce((v_terminal_skip->>'exhausted')::boolean, false)
      and coalesce((v_terminal_skip->>'terminal')::boolean, false)
      and v_terminal_skip->'setup' = 'null'::jsonb,
    coalesce((v_replayed_skip->>'replayed')::boolean, false)
      and coalesce((v_replayed_skip->>'exhausted')::boolean, false)
      and v_replayed_skip->'setup' = 'null'::jsonb,
    v_different_key_rejected,
    coalesce((v_terminal_selection->>'exhausted')::boolean, false)
      and coalesce((v_terminal_selection->>'terminal')::boolean, false)
      and coalesce((v_terminal_selection->>'resetRequired')::boolean, true) is false
      and not (v_terminal_selection ? 'setup'),
    v_reset_rejected,
    v_cycle_before = v_cycle_after,
    v_no_grade_side_effects,
    v_terminal_state_durable
  );
end;
$syllabus_v2_behavior$;

select ok(active_draft_restored,
  'an open active attempt with a nonblank draft restores the same immutable question')
from syllabus_v2_behavior;

select ok(lifetime_nonblank_excluded,
  'a nonblank answer remains excluded even after legacy cycle state is cleared')
from syllabus_v2_behavior;

select ok(ordinary_skip_different,
  'an ordinary skip selects a different unseen question without recycling history')
from syllabus_v2_behavior;

select ok(ordinary_skip_replayed,
  'an ordinary same-key skip retry returns its durably stored next question')
from syllabus_v2_behavior;

select ok(terminal_skip_returned,
  'skipping the last unseen question closes safely and returns terminal exhaustion')
from syllabus_v2_behavior;

select ok(terminal_skip_replayed,
  'the same terminal skip request replays its stored result without another mutation')
from syllabus_v2_behavior;

select ok(different_key_rejected,
  'a different key cannot repurpose an already closed terminal skip')
from syllabus_v2_behavior;

select ok(terminal_next_returned,
  'ordinary entry remains terminal after the course pool is exhausted')
from syllabus_v2_behavior;

select ok(reset_rejected,
  'the legacy reset argument cannot recycle lifetime history')
from syllabus_v2_behavior;

select ok(cycle_never_restarted,
  'terminal skip does not increment or restart the legacy cycle')
from syllabus_v2_behavior;

select ok(no_grade_side_effects,
  'selection and skip create no submission, grading job, assessment, or credit reservation')
from syllabus_v2_behavior;

select ok(terminal_state_durable,
  'terminal exhaustion is owner-bound and durably represented on the closed attempt')
from syllabus_v2_behavior;

select * from finish();
rollback;
