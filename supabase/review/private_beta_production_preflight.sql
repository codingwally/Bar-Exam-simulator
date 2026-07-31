-- READ-ONLY production preflight for the private-beta admission migration.
-- This script must be executed independently before the migration. It makes
-- no schema or data changes and always rolls its read-only transaction back.

begin transaction read only;

do $private_beta_preflight$
declare
  v_role_constraint text;
  v_founder_count integer;
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260805120000'
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_BASELINE_MISSING: expected complete beta release foundation migration';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260807120000'
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_ALREADY_APPLIED: private-beta admission migration already appears in the ledger';
  end if;

  if to_regclass('public.user_roles') is null
     or to_regclass('public.free_beta_access') is null
     or to_regclass('public.free_beta_access_history') is null
     or to_regclass('public.examination_beta_access') is null
     or to_regclass('public.terms_acceptances') is null
     or to_regclass('public.platform_access_settings') is null then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_BASE_TABLE_MISSING: one or more required access tables are absent';
  end if;

  if to_regclass('public.private_beta_settings') is not null
     or to_regclass('public.private_beta_acceptances') is not null
     or to_regclass('public.private_beta_pending_tokens') is not null
     or to_regclass('public.private_beta_admissions') is not null
     or to_regclass('public.private_beta_sessions') is not null
     or to_regclass('public.private_beta_code_attempts') is not null then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_OBJECT_CONFLICT: one or more private-beta tables already exist';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'private_beta_evaluate_code_attempt',
        'private_beta_complete_admission',
        'private_beta_access_snapshot'
      )
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_FUNCTION_CONFLICT: one or more private-beta functions already exist';
  end if;

  if exists (
    with expected(table_name, column_name, data_type, is_nullable) as (
      values
        ('user_roles', 'user_id', 'uuid', 'NO'),
        ('user_roles', 'role', 'text', 'NO'),
        ('user_roles', 'assigned_by', 'uuid', 'YES'),
        ('free_beta_access', 'user_id', 'uuid', 'NO'),
        ('free_beta_access', 'enabled', 'boolean', 'NO'),
        ('free_beta_access', 'expires_at', 'timestamp with time zone', 'YES'),
        ('free_beta_access', 'reason', 'text', 'NO'),
        ('free_beta_access', 'created_by', 'uuid', 'NO'),
        ('free_beta_access', 'updated_by', 'uuid', 'NO'),
        ('free_beta_access_history', 'user_id', 'uuid', 'NO'),
        ('free_beta_access_history', 'actor_user_id', 'uuid', 'NO'),
        ('free_beta_access_history', 'previous_state', 'jsonb', 'NO'),
        ('free_beta_access_history', 'new_state', 'jsonb', 'NO'),
        ('free_beta_access_history', 'request_key', 'text', 'NO'),
        ('examination_beta_access', 'user_id', 'uuid', 'NO'),
        ('examination_beta_access', 'enabled', 'boolean', 'NO'),
        ('examination_beta_access', 'expires_at', 'timestamp with time zone', 'YES'),
        ('examination_beta_access', 'granted_by', 'uuid', 'NO'),
        ('examination_beta_access', 'reason', 'text', 'NO'),
        ('terms_acceptances', 'user_id', 'uuid', 'NO'),
        ('terms_acceptances', 'terms_version', 'text', 'NO'),
        ('terms_acceptances', 'privacy_version', 'text', 'NO'),
        ('terms_acceptances', 'acceptance_source', 'text', 'NO'),
        ('platform_access_settings', 'singleton', 'boolean', 'NO'),
        ('platform_access_settings', 'current_terms_version', 'text', 'NO'),
        ('platform_access_settings', 'current_privacy_version', 'text', 'NO')
    )
    select 1
    from expected e
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = e.table_name
     and c.column_name = e.column_name
     and c.data_type = e.data_type
     and c.is_nullable = e.is_nullable
    where c.column_name is null
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_COLUMN_SIGNATURE_DRIFT: a required baseline column differs from the reviewed schema';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.user_roles'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['user_id']::text[]
  ) or not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.free_beta_access'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['user_id']::text[]
  ) or not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.examination_beta_access'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['user_id']::text[]
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_PRIMARY_KEY_DRIFT: a required user-scoped primary key differs from the reviewed schema';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.terms_acceptances'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['user_id', 'terms_version', 'privacy_version']::text[]
  ) or not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.free_beta_access_history'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['request_key']::text[]
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_UNIQUE_KEY_DRIFT: an upsert key differs from the reviewed schema';
  end if;

  if exists (
    with expected(table_name, column_name, action_code) as (
      values
        ('user_roles', 'user_id', 'c'::"char"),
        ('user_roles', 'assigned_by', 'a'::"char"),
        ('free_beta_access', 'user_id', 'c'::"char"),
        ('free_beta_access', 'created_by', 'a'::"char"),
        ('free_beta_access', 'updated_by', 'a'::"char"),
        ('free_beta_access_history', 'user_id', 'c'::"char"),
        ('free_beta_access_history', 'actor_user_id', 'a'::"char"),
        ('examination_beta_access', 'user_id', 'c'::"char"),
        ('examination_beta_access', 'granted_by', 'r'::"char"),
        ('terms_acceptances', 'user_id', 'c'::"char")
    )
    select 1
    from expected e
    where not exists (
      select 1
      from pg_constraint c
      where c.conrelid = to_regclass('public.' || e.table_name)
        and c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass
        and c.confdeltype = e.action_code
        and (
          select array_agg(a.attname::text order by k.ordinality)
          from unnest(c.conkey) with ordinality k(attnum, ordinality)
          join pg_attribute a
            on a.attrelid = c.conrelid
           and a.attnum = k.attnum
        ) = array[e.column_name]::text[]
        and (
          select array_agg(a.attname::text order by k.ordinality)
          from unnest(c.confkey) with ordinality k(attnum, ordinality)
          join pg_attribute a
            on a.attrelid = c.confrelid
           and a.attnum = k.attnum
        ) = array['id']::text[]
    )
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_FOREIGN_KEY_DRIFT: an auth-user relationship differs from the reviewed schema';
  end if;

  select pg_get_constraintdef(oid)
  into v_role_constraint
  from pg_constraint
  where conrelid = 'public.user_roles'::regclass
    and conname = 'user_roles_role_check'
    and contype = 'c';

  if v_role_constraint is null
     or v_role_constraint not like '%student%'
     or v_role_constraint not like '%admin%'
     or v_role_constraint not like '%founder_admin%'
     or v_role_constraint not like '%super_admin%'
     or v_role_constraint like '%beta_tester%' then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_ROLE_CONSTRAINT_DRIFT: user_roles role constraint differs from the approved baseline';
  end if;

  select count(*)
  into v_founder_count
  from public.user_roles
  where role in ('founder_admin', 'super_admin');

  if v_founder_count <> 4 then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_FOUNDER_COUNT_DRIFT: expected exactly four founder-role accounts, found %',
      v_founder_count;
  end if;

  if exists (
    select 1
    from public.user_roles
    where role = 'beta_tester'
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_UNEXPECTED_BETA_ROLE: beta_tester rows already exist';
  end if;

  if (select count(*) from public.subjects) <> 8 then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_SUBJECT_DRIFT: expected eight Bar subjects';
  end if;

  if not exists (select 1 from public.examination_questions) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_QUESTION_BANK_EMPTY: examination question records are missing';
  end if;

  if (select count(*) from public.platform_access_settings) <> 1
     or exists (
       select 1
       from public.platform_access_settings
       where singleton is distinct from true
          or nullif(btrim(current_terms_version), '') is null
          or nullif(btrim(current_privacy_version), '') is null
     ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_LEGAL_SETTINGS_DRIFT: current Terms and Privacy settings are not singular and valid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'free_beta_access'
      and column_name = 'expires_at'
      and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'examination_beta_access'
      and column_name = 'expires_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception
      'PRIVATE_BETA_PREFLIGHT_ACCESS_SIGNATURE_DRIFT: existing beta-access expiry columns differ from the reviewed schema';
  end if;
end;
$private_beta_preflight$;

select jsonb_build_object(
  'status', 'passed',
  'readOnly', true,
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'examinationQuestions', (select count(*) from public.examination_questions),
  'authUsers', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'founderRoleAccounts', (
    select count(*)
    from public.user_roles
    where role in ('founder_admin', 'super_admin')
  ),
  'existingFreeBetaRows', (select count(*) from public.free_beta_access),
  'existingExaminationBetaRows', (
    select count(*) from public.examination_beta_access
  ),
  'existingGradeRows', (select count(*) from public.grading_results)
) as private_beta_preflight_result;

rollback;
