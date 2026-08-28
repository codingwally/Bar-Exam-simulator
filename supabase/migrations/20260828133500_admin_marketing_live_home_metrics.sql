begin;

-- Executive marketing totals use the product's visible name, Home. The
-- underlying forum telemetry event keeps its legacy identifier so historical
-- records remain queryable without rewriting production data.
create or replace function public.admin_marketing_summary_scoped_v1(
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_data_scope text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.require_admin_data_scope(p_data_scope);
  v_result jsonb;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;

  if p_from is null or p_to is null or p_from >= p_to
     or p_previous_from is null or p_previous_to is null
     or p_previous_from >= p_previous_to then
    raise exception 'Current and comparison reporting windows are required';
  end if;
  if p_to - p_from > interval '366 days'
     or p_previous_to - p_previous_from > interval '366 days' then
    raise exception 'Reporting window exceeds 366 days';
  end if;

  with periods(period_key, from_at, to_at) as (
    values
      ('current'::text, p_from, p_to),
      ('previous'::text, p_previous_from, p_previous_to)
  ),
  home_viewers as (
    select
      period.period_key,
      count(distinct telemetry.user_id)::integer as total
    from periods period
    join public.forum_telemetry_events telemetry
      on telemetry.created_at >= period.from_at
     and telemetry.created_at < period.to_at
     and telemetry.event_type = 'quorum_opened'
    left join private.internal_test_accounts classified
      on classified.user_id = telemetry.user_id
    left join public.user_roles role_row
      on role_row.user_id = telemetry.user_id
    where telemetry.user_id is not null
      and coalesce(role_row.role::text, 'student')
        not in ('admin', 'founder_admin', 'super_admin')
      and case
        when v_scope = 'internal_test' then classified.user_id is not null
        else classified.user_id is null
      end
    group by period.period_key
  ),
  new_accounts as (
    select
      period.period_key,
      count(*)::integer as total
    from periods period
    join auth.users user_row
      on user_row.created_at >= period.from_at
     and user_row.created_at < period.to_at
    left join private.internal_test_accounts classified
      on classified.user_id = user_row.id
    left join public.user_roles role_row
      on role_row.user_id = user_row.id
    where coalesce(user_row.is_anonymous, false) = false
      and coalesce(role_row.role::text, 'student')
        not in ('admin', 'founder_admin', 'super_admin')
      and case
        when v_scope = 'internal_test' then classified.user_id is not null
        else classified.user_id is null
      end
    group by period.period_key
  )
  select jsonb_build_object(
    'dataScope', v_scope,
    'current', jsonb_build_object(
      'home_viewers', coalesce((
        select total from home_viewers where period_key = 'current'
      ), 0),
      'new_accounts', coalesce((
        select total from new_accounts where period_key = 'current'
      ), 0)
    ),
    'previous', jsonb_build_object(
      'home_viewers', coalesce((
        select total from home_viewers where period_key = 'previous'
      ), 0),
      'new_accounts', coalesce((
        select total from new_accounts where period_key = 'previous'
      ), 0)
    ),
    'definitions', jsonb_build_object(
      'home_viewers',
        'Distinct signed-in non-administrator users who opened Home during the reporting period.',
      'new_accounts',
        'Distinct non-administrator Auth accounts created during the reporting period.'
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Live monitoring reports distinct people, not an inflated count of open
-- session rows. Home includes the current analytics name and both historical
-- aliases so the transition does not discard earlier activity.
create or replace function public.admin_live_activity_scoped_v1(
  p_actor_user_id uuid,
  p_limit integer,
  p_request_key text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := private.require_admin_data_scope(p_data_scope);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_active_5 bigint := 0;
  v_active_30 bigint := 0;
  v_home_5 bigint := 0;
  v_home_30 bigint := 0;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid activity request key required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260823));
  if exists (
    select 1
    from public.admin_audit_log audit_row
    where audit_row.actor_user_id = p_actor_user_id
      and audit_row.action_type = 'sensitive_data_viewed'
      and audit_row.target_resource_type = 'admin_live_activity_scoped_v1'
      and audit_row.details->>'requestKey' = p_request_key
      and (
        coalesce((audit_row.details->>'limit')::integer, -1) <> v_limit
        or coalesce(audit_row.details->>'dataScope', '') <> v_scope
      )
  ) then
    raise exception 'Activity request key was already used for a different request';
  end if;

  select
    count(distinct session_row.user_id) filter (
      where session_row.last_seen_at >= now() - interval '5 minutes'
    ),
    count(distinct session_row.user_id),
    count(distinct session_row.user_id) filter (
      where session_row.last_seen_at >= now() - interval '5 minutes'
        and lower(coalesce(session_row.last_page_area, ''))
          in ('home', 'quorum', 'lex-forum')
    ),
    count(distinct session_row.user_id) filter (
      where lower(coalesce(session_row.last_page_area, ''))
        in ('home', 'quorum', 'lex-forum')
    )
  into v_active_5, v_active_30, v_home_5, v_home_30
  from public.usage_sessions session_row
  left join private.internal_test_accounts classified
    on classified.user_id = session_row.user_id
  left join public.user_roles role_row
    on role_row.user_id = session_row.user_id
  where session_row.user_id is not null
    and session_row.ended_at is null
    and session_row.last_seen_at >= now() - interval '30 minutes'
    and coalesce(role_row.role::text, 'student')
      not in ('admin', 'founder_admin', 'super_admin')
    and case
      when v_scope = 'internal_test' then classified.user_id is not null
      else classified.user_id is null
    end;

  if not exists (
    select 1
    from public.admin_audit_log audit_row
    where audit_row.actor_user_id = p_actor_user_id
      and audit_row.action_type = 'sensitive_data_viewed'
      and audit_row.target_resource_type = 'admin_live_activity_scoped_v1'
      and audit_row.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_live_activity_scoped_v1',
      'last_30_minutes',
      'Authorized Admin aggregate activity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', v_scope,
        'active5Minutes', v_active_5,
        'active30Minutes', v_active_30,
        'activeHome5Minutes', v_home_5,
        'activeHome30Minutes', v_home_30,
        'limit', v_limit,
        'resultCount', 0,
        'identityRowsWithheld', true
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', v_scope,
    'generatedAt', now(),
    'windowSeconds', 300,
    'activeSignedInLast5Minutes', v_active_5,
    'activeSignedInLast30Minutes', v_active_30,
    'activeHomeLast5Minutes', v_home_5,
    'activeHomeLast30Minutes', v_home_30,
    'items', '[]'::jsonb,
    'definition',
      'Approximate distinct signed-in non-administrator users with a visible-page session update in the stated window. Named identities are intentionally withheld.'
  );
end;
$$;

revoke all on function public.admin_marketing_summary_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_marketing_summary_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) to service_role;

revoke all on function public.admin_live_activity_scoped_v1(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_live_activity_scoped_v1(
  uuid, integer, text, text
) to service_role;

comment on function public.admin_marketing_summary_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) is 'Selected-period Home reach and account-creation marketing totals, excluding administrator roles and partitioned by immutable internal-test identity.';

comment on function public.admin_live_activity_scoped_v1(
  uuid, integer, text, text
) is 'Aggregate distinct-user live monitoring for all pages and Home, excluding administrator roles and partitioned by immutable internal-test identity.';

commit;
