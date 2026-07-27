-- Phase 1 post-migration read-only access inventory.
-- Run only after Phase 1 in an approved staging environment.

-- RLS and policy state.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'question_corrections',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
order by c.relname, p.policyname;

-- Direct grant provenance, including an explicit PUBLIC grantee.
select
  c.relname as table_name,
  case
    when acl.grantee = 0 then 'PUBLIC'
    else pg_get_userbyid(acl.grantee)
  end as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(
  coalesce(c.relacl, acldefault('r', c.relowner))
) acl
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'calibration_examples',
    'question_corrections',
    'terms_acceptances',
    'marketing_consents',
    'user_roles',
    'usage_sessions',
    'usage_events',
    'user_entitlements',
    'admin_audit_log'
  )
  and (
    acl.grantee = 0
    or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated', 'service_role')
  )
order by c.relname, grantee, acl.privilege_type;

-- Effective API-role access after table, column, and RLS grant hardening.
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
    ('question_corrections'),
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
