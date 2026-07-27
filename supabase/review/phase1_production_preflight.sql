-- PHASE 1 PRODUCTION PREFLIGHT — READ-ONLY / FAIL-FAST.
--
-- This file validates the Phase 1B production inventory before any future
-- production migration is considered. It performs catalog/data reads and
-- raises exceptions on drift. It does not alter schema or data.
--
-- Expected project at the future approval gate:
--   hbllomlijfznnuudpdvr
--
-- IMPORTANT: PostgreSQL cannot independently prove a Supabase project ref.
-- The operator must verify the linked project ref outside SQL before running
-- this preflight. A passing result is not authorization to migrate.

do $phase1_preflight$
declare
  v_actual text[];
  v_expected constant text[] := array[
    'calibration_examples',
    'grade_disputes',
    'grading_results',
    'profiles',
    'questions',
    'subjects',
    'submissions'
  ];
  v_count bigint;
begin
  select array_agg(c.relname order by c.relname)
    into v_actual
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p');

  if coalesce(v_actual, array[]::text[]) <> v_expected then
    raise exception
      'PHASE1_PREFLIGHT_TABLE_DRIFT: expected exactly %, found %',
      v_expected,
      coalesce(v_actual, array[]::text[]);
  end if;

  if exists (
    with expected(table_name, column_name, udt_name, is_nullable, column_default) as (
      values
        ('profiles', 'id', 'uuid', 'NO', null::text),
        ('profiles', 'display_name', 'text', 'YES', null::text),
        ('profiles', 'subscription_tier', 'text', 'NO', '''free''::text'),
        ('profiles', 'subscription_status', 'text', 'NO', '''inactive''::text'),
        ('profiles', 'created_at', 'timestamptz', 'NO', 'now()'),
        ('subjects', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('subjects', 'name', 'text', 'NO', null::text),
        ('subjects', 'sort_order', 'int4', 'NO', null::text),
        ('questions', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('questions', 'subject_id', 'uuid', 'NO', null::text),
        ('questions', 'bar_year', 'int4', 'YES', null::text),
        ('questions', 'question_no', 'text', 'YES', null::text),
        ('questions', 'prompt_text', 'text', 'NO', null::text),
        ('questions', 'model_answer', 'text', 'YES', null::text),
        ('questions', 'case_law', 'text', 'YES', null::text),
        ('questions', 'rubric_points', 'jsonb', 'NO', '''{}''::jsonb'),
        ('questions', 'source', 'text', 'YES', null::text),
        ('questions', 'created_at', 'timestamptz', 'NO', 'now()'),
        ('submissions', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('submissions', 'user_id', 'uuid', 'NO', null::text),
        ('submissions', 'question_id', 'uuid', 'NO', null::text),
        ('submissions', 'answer_text', 'text', 'NO', null::text),
        ('submissions', 'word_count', 'int4', 'NO', '0'),
        ('submissions', 'time_spent_seconds', 'int4', 'NO', '0'),
        ('submissions', 'submitted_at', 'timestamptz', 'NO', 'now()'),
        ('grading_results', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('grading_results', 'submission_id', 'uuid', 'NO', null::text),
        ('grading_results', 'overall_score', 'numeric', 'YES', null::text),
        ('grading_results', 'passed', 'bool', 'YES', null::text),
        ('grading_results', 'answer_score', 'numeric', 'YES', null::text),
        ('grading_results', 'legal_basis_score', 'numeric', 'YES', null::text),
        ('grading_results', 'application_score', 'numeric', 'YES', null::text),
        ('grading_results', 'conclusion_score', 'numeric', 'YES', null::text),
        ('grading_results', 'feedback_json', 'jsonb', 'NO', '''{}''::jsonb'),
        ('grading_results', 'rubric_version', 'text', 'YES', null::text),
        ('grading_results', 'grader_model', 'text', 'YES', null::text),
        ('grading_results', 'graded_at', 'timestamptz', 'NO', 'now()'),
        ('calibration_examples', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('calibration_examples', 'question_id', 'uuid', 'NO', null::text),
        ('calibration_examples', 'example_answer_text', 'text', 'NO', null::text),
        ('calibration_examples', 'expert_score', 'numeric', 'YES', null::text),
        ('calibration_examples', 'expert_notes', 'text', 'YES', null::text),
        ('calibration_examples', 'added_by', 'uuid', 'YES', null::text),
        ('calibration_examples', 'created_at', 'timestamptz', 'NO', 'now()'),
        ('grade_disputes', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('grade_disputes', 'submission_id', 'uuid', 'NO', null::text),
        ('grade_disputes', 'user_id', 'uuid', 'NO', null::text),
        ('grade_disputes', 'reason', 'text', 'NO', null::text),
        ('grade_disputes', 'status', 'text', 'NO', '''pending''::text'),
        ('grade_disputes', 'admin_notes', 'text', 'YES', null::text),
        ('grade_disputes', 'created_at', 'timestamptz', 'NO', 'now()')
    ),
    actual as (
      select
        table_name,
        column_name,
        udt_name,
        is_nullable,
        column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any(v_expected)
    )
    (
      select * from expected
      except
      select * from actual
    )
    union all
    (
      select * from actual
      except
      select * from expected
    )
  ) then
    raise exception
      'PHASE1_PREFLIGHT_COLUMN_DRIFT: columns, types, nullability, or defaults differ from the Phase 1B inventory';
  end if;

  if (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(v_expected)
      and c.relrowsecurity
      and not c.relforcerowsecurity
  ) <> 7 then
    raise exception
      'PHASE1_PREFLIGHT_RLS_DRIFT: all seven core tables must have RLS enabled and not forced';
  end if;

  if exists (
    with expected(
      table_name,
      constraint_name,
      referenced_schema,
      referenced_table,
      delete_action
    ) as (
      values
        ('profiles', 'profiles_id_fkey', 'auth', 'users', 'CASCADE'),
        ('questions', 'questions_subject_id_fkey', 'public', 'subjects', 'NO ACTION'),
        ('submissions', 'submissions_user_id_fkey', 'auth', 'users', 'CASCADE'),
        ('submissions', 'submissions_question_id_fkey', 'public', 'questions', 'NO ACTION'),
        ('grading_results', 'grading_results_submission_id_fkey', 'public', 'submissions', 'CASCADE'),
        ('calibration_examples', 'calibration_examples_question_id_fkey', 'public', 'questions', 'CASCADE'),
        ('calibration_examples', 'calibration_examples_added_by_fkey', 'auth', 'users', 'SET NULL'),
        ('grade_disputes', 'grade_disputes_submission_id_fkey', 'public', 'submissions', 'CASCADE'),
        ('grade_disputes', 'grade_disputes_user_id_fkey', 'auth', 'users', 'CASCADE')
    ),
    actual as (
      select
        source_rel.relname::text as table_name,
        con.conname::text as constraint_name,
        target_ns.nspname::text as referenced_schema,
        target_rel.relname::text as referenced_table,
        case con.confdeltype
          when 'a' then 'NO ACTION'
          when 'r' then 'RESTRICT'
          when 'c' then 'CASCADE'
          when 'n' then 'SET NULL'
          when 'd' then 'SET DEFAULT'
        end as delete_action
      from pg_constraint con
      join pg_class source_rel on source_rel.oid = con.conrelid
      join pg_namespace source_ns on source_ns.oid = source_rel.relnamespace
      join pg_class target_rel on target_rel.oid = con.confrelid
      join pg_namespace target_ns on target_ns.oid = target_rel.relnamespace
      where source_ns.nspname = 'public'
        and source_rel.relname = any(v_expected)
        and con.contype = 'f'
    )
    (
      select * from expected
      except
      select * from actual
    )
    union all
    (
      select * from actual
      except
      select * from expected
    )
  ) then
    raise exception
      'PHASE1_PREFLIGHT_FOREIGN_KEY_DRIFT: foreign-key targets or delete actions differ from the Phase 1B inventory';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = any(v_expected)
      and con.contype in ('u', 'c')
  ) then
    raise exception
      'PHASE1_PREFLIGHT_CONSTRAINT_DRIFT: unexpected UNIQUE or CHECK constraint exists on a core table';
  end if;

  select array_agg(indexname order by indexname)
    into v_actual
  from pg_indexes
  where schemaname = 'public'
    and tablename = any(v_expected);

  if coalesce(v_actual, array[]::text[]) <> array[
    'calibration_examples_pkey',
    'grade_disputes_pkey',
    'grading_results_pkey',
    'profiles_pkey',
    'questions_pkey',
    'subjects_pkey',
    'submissions_pkey'
  ] then
    raise exception
      'PHASE1_PREFLIGHT_INDEX_DRIFT: expected only core primary-key indexes, found %',
      coalesce(v_actual, array[]::text[]);
  end if;

  if (
    select count(*)
    from (
      values
        ('profiles', 'profiles_select_own', 'SELECT'),
        ('profiles', 'profiles_update_own', 'UPDATE'),
        ('subjects', 'subjects_public_read', 'SELECT'),
        ('questions', 'questions_public_read', 'SELECT'),
        ('submissions', 'submissions_select_own', 'SELECT'),
        ('submissions', 'submissions_insert_own', 'INSERT'),
        ('grading_results', 'grading_results_select_own', 'SELECT'),
        ('grade_disputes', 'grade_disputes_select_own', 'SELECT'),
        ('grade_disputes', 'grade_disputes_insert_own', 'INSERT')
    ) expected(table_name, policy_name, command)
    left join pg_policies p
      on p.schemaname = 'public'
     and p.tablename = expected.table_name
     and p.policyname = expected.policy_name
     and p.cmd = expected.command
    where p.policyname is null
  ) > 0
  or (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(v_expected)
  ) <> 9 then
    raise exception
      'PHASE1_PREFLIGHT_POLICY_DRIFT: expected the nine Phase 1B core policies and no extras';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) api_role
    cross join unnest(v_expected) table_name
    where not has_table_privilege(
      api_role,
      format('public.%I', table_name),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception
      'PHASE1_PREFLIGHT_GRANT_DRIFT: legacy broad grants are not present exactly as expected';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) then
    raise exception
      'PHASE1_PREFLIGHT_FUNCTION_DRIFT: expected no public functions before Phase 1';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and (
        n.nspname = 'public'
        or (n.nspname = 'auth' and t.tgname = 'on_auth_user_created_due_diligence')
      )
  ) then
    raise exception
      'PHASE1_PREFLIGHT_TRIGGER_DRIFT: expected no Phase 1 public/Auth trigger';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'terms_acceptances',
        'marketing_consents',
        'user_roles',
        'usage_sessions',
        'usage_events',
        'user_entitlements',
        'admin_audit_log'
      ])
  ) then
    raise exception
      'PHASE1_PREFLIGHT_PHASE1_OBJECT_DRIFT: one or more Phase 1 tables already exist';
  end if;

  select count(*) into v_count from auth.users;
  if v_count <> 0 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 0 auth.users rows, found %',
      v_count;
  end if;

  select count(*) into v_count from public.profiles;
  if v_count <> 0 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 0 profiles rows, found %',
      v_count;
  end if;

  select count(*) into v_count from public.submissions;
  if v_count <> 0 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 0 submissions rows, found %',
      v_count;
  end if;

  select count(*) into v_count from public.grading_results;
  if v_count <> 0 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 0 grading_results rows, found %',
      v_count;
  end if;

  select count(*) into v_count from public.subjects;
  if v_count <> 8 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 8 subjects rows, found %',
      v_count;
  end if;

  select count(*) into v_count from public.questions;
  if v_count <> 2 then
    raise exception
      'PHASE1_PREFLIGHT_DATA_DRIFT: expected 2 questions rows, found %',
      v_count;
  end if;

  raise notice
    'PHASE1_PREFLIGHT_OK: schema, policies, grants, functions, triggers, and cardinalities match the Phase 1B inventory';
end
$phase1_preflight$;
