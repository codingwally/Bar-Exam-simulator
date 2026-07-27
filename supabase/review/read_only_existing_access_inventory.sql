-- READ-ONLY preflight inventory for independent review.
--
-- Scope: all seven production core tables plus Phase 1 tables when present.
-- This script performs SELECT queries against PostgreSQL system catalogs and
-- information_schema. It does not alter data, policies, grants, or schema.

-- 1. RLS state for each existing table.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'grade_disputes',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
  and c.relkind in ('r', 'p')
order by c.relname;

-- 2. Complete policy definitions, including roles, command, USING, and CHECK.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'grade_disputes',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
order by tablename, policyname;

-- 3. Table-level grants visible through information_schema.
select
  table_schema,
  table_name,
  grantor,
  grantee,
  privilege_type,
  is_grantable,
  with_hierarchy
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'grade_disputes',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
order by table_name, grantee, privilege_type;

-- 4. Column-level grants. This is essential for confirming that profile
-- subscription fields cannot be updated through authenticated clients.
select
  table_schema,
  table_name,
  column_name,
  grantor,
  grantee,
  privilege_type,
  is_grantable
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'grade_disputes',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
order by table_name, column_name, grantee, privilege_type;

-- 5. Effective privileges for Supabase API roles on the three tables.
select
  target.table_name,
  api_role.role_name,
  has_table_privilege(
    api_role.role_name,
    format('public.%I', target.table_name),
    'SELECT'
  ) as can_select,
  has_table_privilege(
    api_role.role_name,
    format('public.%I', target.table_name),
    'INSERT'
  ) as can_insert,
  has_table_privilege(
    api_role.role_name,
    format('public.%I', target.table_name),
    'UPDATE'
  ) as can_update,
  has_table_privilege(
    api_role.role_name,
    format('public.%I', target.table_name),
    'DELETE'
  ) as can_delete
from (
  values
    ('profiles'),
    ('subjects'),
    ('questions'),
    ('submissions'),
    ('grading_results'),
    ('calibration_examples'),
    ('grade_disputes'),
    ('terms_acceptances'),
    ('marketing_consents'),
    ('user_roles'),
    ('usage_sessions'),
    ('usage_events'),
    ('user_entitlements'),
    ('admin_audit_log')
) as target(table_name)
cross join (
  values ('anon'), ('authenticated'), ('service_role')
) as api_role(role_name)
order by target.table_name, api_role.role_name;

-- 6. Effective authenticated UPDATE privileges for every profiles column.
select
  c.column_name,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    c.column_name,
    'UPDATE'
  ) as authenticated_can_update
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'profiles'
order by c.ordinal_position;

-- 7. Non-internal public triggers and functions. Phase 1B observed none before
-- the migration; Phase 1 adds reviewed objects that should appear afterward.
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname in ('public', 'auth')
order by n.nspname, c.relname, t.tgname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, identity_arguments;
