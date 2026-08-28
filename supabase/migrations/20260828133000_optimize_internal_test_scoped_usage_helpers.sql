-- Keep the internal/test reporting split set-based. The original helpers
-- called a SECURITY DEFINER classifier once per usage row; the dashboard
-- invokes these helpers repeatedly and could exceed PostgREST's 8-second
-- statement timeout at production cardinality.

begin;

create or replace function private.admin_scoped_usage_events(
  p_data_scope text
)
returns setof public.usage_events
language sql
stable
security definer
set search_path = ''
as $$
  with validated_scope as materialized (
    select private.require_admin_data_scope(p_data_scope) as data_scope
  )
  select event_row.*
  from validated_scope scope
  cross join public.usage_events event_row
  left join public.usage_sessions session_row
    on session_row.id = event_row.session_id
  left join private.internal_test_accounts classified
    on classified.user_id = coalesce(event_row.user_id, session_row.user_id)
  left join public.user_roles role_row
    on role_row.user_id = coalesce(event_row.user_id, session_row.user_id)
  where case scope.data_scope
    when 'internal_test' then classified.user_id is not null
    when 'regular' then
      classified.user_id is null
      and (
        coalesce(event_row.user_id, session_row.user_id) is null
        or coalesce(role_row.role::text, 'student')
          not in ('admin', 'founder_admin', 'super_admin')
      )
    else false
  end
$$;

create or replace function private.admin_scoped_usage_sessions(
  p_data_scope text
)
returns setof public.usage_sessions
language sql
stable
security definer
set search_path = ''
as $$
  with validated_scope as materialized (
    select private.require_admin_data_scope(p_data_scope) as data_scope
  )
  select session_row.*
  from validated_scope scope
  cross join public.usage_sessions session_row
  left join private.internal_test_accounts classified
    on classified.user_id = session_row.user_id
  left join public.user_roles role_row
    on role_row.user_id = session_row.user_id
  where case scope.data_scope
    when 'internal_test' then classified.user_id is not null
    when 'regular' then
      classified.user_id is null
      and (
        session_row.user_id is null
        or coalesce(role_row.role::text, 'student')
          not in ('admin', 'founder_admin', 'super_admin')
      )
    else false
  end
$$;

comment on function private.admin_scoped_usage_events(text) is
  'Returns usage events for one validated Admin reporting scope using immutable effective-owner attribution and set-based classification.';

comment on function private.admin_scoped_usage_sessions(text) is
  'Returns usage sessions for one validated Admin reporting scope using set-based immutable-owner classification.';

-- These helpers are implementation details of the public scoped Admin RPCs.
revoke all on function private.admin_scoped_usage_events(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_scoped_usage_sessions(text)
  from public, anon, authenticated, service_role;

commit;
