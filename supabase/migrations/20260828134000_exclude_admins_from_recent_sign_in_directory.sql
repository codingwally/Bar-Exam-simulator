-- Keep the recent learner sign-in directory learner-only. Privileged accounts
-- are excluded before ordering and limiting so admin activity cannot displace
-- the newest regular or internal-test learner rows.

begin;

create or replace function public.admin_recent_sign_in_directory_scoped_v1(
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
  v_limit integer := least(greatest(coalesce(p_limit, 7), 1), 25);
  v_items jsonb := '[]'::jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid recent-sign-in request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260823));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce(a.details->>'dataScope', '') <> p_data_scope
      )
  ) then
    raise exception 'Recent-sign-in request key conflict';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.last_sign_in_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      u.id,
      p.display_name,
      u.email,
      p.school,
      coalesce(r.role::text, 'student') as role,
      case
        when signin.signed_in_at is null then u.last_sign_in_at
        when u.last_sign_in_at is null then signin.signed_in_at
        else greatest(signin.signed_in_at, u.last_sign_in_at)
      end as last_sign_in_at,
      signin.signed_in_at as monitoring_recorded_at,
      case
        when signin.region is not null and signin.country_code is not null
          then signin.region || ', ' || signin.country_code
        else coalesce(signin.region, signin.country_code)
      end as current_region,
      coalesce(signin.device_category, session.device_category) as current_device_category,
      signin.browser as current_browser,
      signin.operating_system as current_operating_system,
      signin.language as current_language,
      coalesce(counts.answered_question_count, 0) as answered_question_count,
      greatest(
        0,
        coalesce(token_grant.token_limit, 0) - coalesce(token_usage.used_tokens, 0)
      ) as free_grades_remaining,
      coalesce(beta.enabled, false) as free_beta_enabled,
      beta.expires_at as free_beta_expires_at,
      subscription.plan_code as subscription_plan,
      subscription.status as subscription_status,
      subscription.starts_at as subscription_starts_at,
      subscription.expires_at as subscription_expires_at,
      public.admin_subscription_category(u.id) as subscription_category,
      case
        when coalesce(r.role::text, 'student') in ('admin', 'founder_admin', 'super_admin')
          then 'Admin & Staff access'
        when coalesce(beta.enabled, false)
          and (beta.expires_at is null or beta.expires_at > now())
          then 'Founding Beta'
        when subscription.status = 'active'
          and subscription.starts_at <= now()
          and (subscription.expires_at is null or subscription.expires_at > now())
          then 'Active subscription'
        else 'Introductory access'
      end as effective_access
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles r on r.user_id = u.id
    left join private.admin_user_answer_counts_scoped_v1(p_data_scope) counts on counts.user_id = u.id
    left join public.introductory_token_grants token_grant on token_grant.user_id = u.id
    left join lateral (
      select count(*)::integer as used_tokens
      from public.introductory_token_ledger ledger
      where ledger.grant_id = token_grant.id
        and ledger.event_type = 'consumed'
    ) token_usage on true
    left join public.free_beta_access beta on beta.user_id = u.id
    left join lateral (
      select
        s.plan_code,
        s.status,
        s.starts_at,
        s.expires_at
      from public.subscriptions s
      where s.user_id = u.id
      order by s.updated_at desc, s.created_at desc
      limit 1
    ) subscription on true
    left join lateral (
      select
        e.signed_in_at,
        e.device_category,
        e.browser,
        e.operating_system,
        e.region,
        e.country_code,
        e.language
      from public.user_sign_in_events e
      where e.user_id = u.id
      order by e.signed_in_at desc, e.id desc
      limit 1
    ) signin on true
    left join lateral (
      select s.device_category, s.last_seen_at
      from public.usage_sessions s
      where s.user_id = u.id
      order by s.last_seen_at desc, s.id desc
      limit 1
    ) session on true
    where coalesce(u.is_anonymous, false) = false
      and private.admin_reporting_scope_matches(u.id, p_data_scope)
      and coalesce(r.role::text, 'student') not in ('admin', 'founder_admin', 'super_admin')
      and coalesce(signin.signed_in_at, u.last_sign_in_at) is not null
    order by
      case
        when signin.signed_in_at is null then u.last_sign_in_at
        when u.last_sign_in_at is null then signin.signed_in_at
        else greatest(signin.signed_in_at, u.last_sign_in_at)
      end desc
    limit v_limit
  ) q;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_resource_type,
      target_resource_id,
      reason,
      details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_recent_sign_in_directory_scoped_v1',
      'executive_pulse',
      'Authorized recent sign-in monitoring view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'limit', v_limit,
        'resultCount', jsonb_array_length(v_items)
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
    'items', v_items,
    'limit', v_limit,
    'total', jsonb_array_length(v_items)
  );
end;
$$;

revoke all on function public.admin_recent_sign_in_directory_scoped_v1(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_recent_sign_in_directory_scoped_v1(
  uuid, integer, text, text
) to service_role;

comment on function public.admin_recent_sign_in_directory_scoped_v1(
  uuid, integer, text, text
) is 'Audited recent learner sign-ins partitioned by immutable-user-id scope; administrator and staff roles are excluded before ordering and limiting.';

commit;
