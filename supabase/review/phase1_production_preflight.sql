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
        ('subjects', 'sort_order', 'int4', 'NO', '0'),
        ('questions', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('questions', 'subject_id', 'uuid', 'NO', null::text),
        ('questions', 'bar_year', 'int4', 'YES', null::text),
        ('questions', 'question_no', 'int4', 'YES', null::text),
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
        ('submissions', 'word_count', 'int4', 'YES', null::text),
        ('submissions', 'time_spent_seconds', 'int4', 'YES', null::text),
        ('submissions', 'submitted_at', 'timestamptz', 'NO', 'now()'),
        ('grading_results', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('grading_results', 'submission_id', 'uuid', 'NO', null::text),
        ('grading_results', 'overall_score', 'numeric', 'YES', null::text),
        ('grading_results', 'passed', 'bool', 'YES', null::text),
        ('grading_results', 'answer_score', 'numeric', 'YES', null::text),
        ('grading_results', 'legal_basis_score', 'numeric', 'YES', null::text),
        ('grading_results', 'application_score', 'numeric', 'YES', null::text),
        ('grading_results', 'conclusion_score', 'numeric', 'YES', null::text),
        ('grading_results', 'feedback_json', 'jsonb', 'YES', null::text),
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
        ('grade_disputes', 'status', 'text', 'NO', '''open''::text'),
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
      source_columns,
      referenced_schema,
      referenced_table,
      referenced_columns,
      delete_action
    ) as (
      values
        ('profiles', 'profiles_id_fkey', array['id']::text[], 'auth', 'users', array['id']::text[], 'CASCADE'),
        ('questions', 'questions_subject_id_fkey', array['subject_id']::text[], 'public', 'subjects', array['id']::text[], 'CASCADE'),
        ('submissions', 'submissions_user_id_fkey', array['user_id']::text[], 'auth', 'users', array['id']::text[], 'CASCADE'),
        ('submissions', 'submissions_question_id_fkey', array['question_id']::text[], 'public', 'questions', array['id']::text[], 'CASCADE'),
        ('grading_results', 'grading_results_submission_id_fkey', array['submission_id']::text[], 'public', 'submissions', array['id']::text[], 'CASCADE'),
        ('calibration_examples', 'calibration_examples_question_id_fkey', array['question_id']::text[], 'public', 'questions', array['id']::text[], 'CASCADE'),
        ('calibration_examples', 'calibration_examples_added_by_fkey', array['added_by']::text[], 'auth', 'users', array['id']::text[], 'NO ACTION'),
        ('grade_disputes', 'grade_disputes_submission_id_fkey', array['submission_id']::text[], 'public', 'submissions', array['id']::text[], 'CASCADE'),
        ('grade_disputes', 'grade_disputes_user_id_fkey', array['user_id']::text[], 'auth', 'users', array['id']::text[], 'CASCADE')
    ),
    actual as (
      select
        source_rel.relname::text as table_name,
        con.conname::text as constraint_name,
        array(
          select source_att.attname::text
          from unnest(con.conkey) with ordinality source_key(attnum, position)
          join pg_attribute source_att
            on source_att.attrelid = con.conrelid
           and source_att.attnum = source_key.attnum
          order by source_key.position
        ) as source_columns,
        target_ns.nspname::text as referenced_schema,
        target_rel.relname::text as referenced_table,
        array(
          select target_att.attname::text
          from unnest(con.confkey) with ordinality target_key(attnum, position)
          join pg_attribute target_att
            on target_att.attrelid = con.confrelid
           and target_att.attnum = target_key.attnum
          order by target_key.position
        ) as referenced_columns,
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
      'PHASE1_PREFLIGHT_FOREIGN_KEY_DRIFT: foreign-key source columns, targets, referenced columns, or delete actions differ from the Phase 1B inventory';
  end if;

  if exists (
    with expected(table_name, constraint_name, key_columns) as (
      values
        ('profiles', 'profiles_pkey', array['id']::text[]),
        ('subjects', 'subjects_pkey', array['id']::text[]),
        ('questions', 'questions_pkey', array['id']::text[]),
        ('submissions', 'submissions_pkey', array['id']::text[]),
        ('grading_results', 'grading_results_pkey', array['id']::text[]),
        ('calibration_examples', 'calibration_examples_pkey', array['id']::text[]),
        ('grade_disputes', 'grade_disputes_pkey', array['id']::text[])
    ),
    actual as (
      select
        rel.relname::text as table_name,
        con.conname::text as constraint_name,
        array(
          select att.attname::text
          from unnest(con.conkey) with ordinality key_column(attnum, position)
          join pg_attribute att
            on att.attrelid = con.conrelid
           and att.attnum = key_column.attnum
          order by key_column.position
        ) as key_columns
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
        and rel.relname = any(v_expected)
        and con.contype = 'p'
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
      'PHASE1_PREFLIGHT_PRIMARY_KEY_DRIFT: primary-key names or constrained columns differ from the Phase 1B inventory';
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

  if exists (
    -- pg_policies deparses `(select auth.uid())` as a scalar subquery with an
    -- `AS uid` alias. Remove whitespace, parentheses, and optional public-schema
    -- qualification before exact set comparison; operators and identifiers
    -- remain significant.
    with expected(
      table_name,
      policy_name,
      permissive_mode,
      policy_roles,
      command,
      using_expression,
      check_expression
    ) as (
      values
        ('profiles', 'profiles_select_own', 'permissive', array['public']::text[], 'SELECT', 'auth.uid=id', ''),
        ('profiles', 'profiles_update_own', 'permissive', array['public']::text[], 'UPDATE', 'auth.uid=id', ''),
        ('subjects', 'subjects_select_all', 'permissive', array['public']::text[], 'SELECT', 'true', ''),
        ('questions', 'questions_select_all', 'permissive', array['public']::text[], 'SELECT', 'true', ''),
        ('submissions', 'submissions_select_own', 'permissive', array['public']::text[], 'SELECT', 'auth.uid=user_id', ''),
        ('submissions', 'submissions_insert_own', 'permissive', array['public']::text[], 'INSERT', '', 'auth.uid=user_id'),
        ('grading_results', 'grading_results_select_own', 'permissive', array['public']::text[], 'SELECT', 'existsselect1fromsubmissionsswheres.id=grading_results.submission_idands.user_id=auth.uid', ''),
        ('grade_disputes', 'grade_disputes_select_own', 'permissive', array['public']::text[], 'SELECT', 'auth.uid=user_id', ''),
        ('grade_disputes', 'grade_disputes_insert_own', 'permissive', array['public']::text[], 'INSERT', '', 'auth.uid=user_id')
    ),
    actual as (
      select
        p.tablename::text as table_name,
        p.policyname::text as policy_name,
        lower(p.permissive)::text as permissive_mode,
        array(
          select policy_role::text
          from unnest(p.roles) policy_role
          order by policy_role::text
        ) as policy_roles,
        p.cmd::text as command,
        replace(
          regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]()]', '', 'g'),
          'public.',
          ''
        ) as using_expression,
        replace(
          regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]()]', '', 'g'),
          'public.',
          ''
        ) as check_expression
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = any(v_expected)
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
      'PHASE1_PREFLIGHT_POLICY_DRIFT: policy names, tables, commands, roles, modes, USING expressions, or WITH CHECK expressions differ from the Phase 1B inventory';
  end if;

  if exists (
    with expected(table_name, grantor, grantee, privilege_type, is_grantable) as (
      select
        table_name,
        'postgres'::text,
        api_role,
        privilege_type,
        false
      from unnest(v_expected) table_name
      cross join unnest(array['anon', 'authenticated', 'service_role']) api_role
      cross join unnest(array[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN'
      ]) privilege_type
    ),
    actual as (
      select
        c.relname::text as table_name,
        grantor_role.rolname::text as grantor,
        case
          when acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname::text
        end as grantee,
        acl.privilege_type::text,
        acl.is_grantable
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(
        coalesce(c.relacl, acldefault('r', c.relowner))
      ) acl
      left join pg_roles grantor_role on grantor_role.oid = acl.grantor
      left join pg_roles grantee_role on grantee_role.oid = acl.grantee
      where n.nspname = 'public'
        and c.relname = any(v_expected)
        and (
          acl.grantee = 0
          or grantee_role.rolname in ('anon', 'authenticated', 'service_role')
        )
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
      'PHASE1_PREFLIGHT_GRANT_DRIFT: direct API-role grant provenance differs or an unexpected PUBLIC grant exists';
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
