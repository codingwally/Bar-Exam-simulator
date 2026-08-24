-- Dedicated Recent Users activity ledger for the administrator dashboard.
--
-- This view is intentionally separate from the account directory. It exposes
-- only controlled session/event fields (never usage metadata, request headers,
-- raw IP addresses, or answer text), requires the learner analytics capability,
-- and records each sensitive view in the administrator audit log.

begin;

create or replace function public.admin_recent_user_activity_directory(
  p_actor_user_id uuid,
  p_search text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_offset integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_to timestamptz := least(coalesce(p_to, now()), now() + interval '5 minutes');
  v_from timestamptz := coalesce(p_from, least(coalesce(p_to, now()), now()) - interval '30 days');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_unique_users bigint := 0;
  v_active_now bigint := 0;
  v_average_duration_seconds bigint := 0;
  v_total_duration_seconds bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_daily_activity jsonb := '[]'::jsonb;
  v_activity_mix jsonb := '[]'::jsonb;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Recent user search exceeds 180 characters';
  end if;
  if v_to <= v_from or v_to - v_from > interval '366 days' then
    raise exception 'Recent user reporting window is invalid';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid recent user request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260824));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_user_activity_directory'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce((a.details->>'offset')::integer, -1) <> v_offset
        or coalesce(a.details->>'from', '') <> v_from::text
        or coalesce(a.details->>'to', '') <> v_to::text
        or coalesce(a.details->>'searchFingerprint', '') <> md5(coalesce(v_search, ''))
      )
  ) then
    raise exception 'Recent user request key conflict';
  end if;

  with filtered as materialized (
    select
      s.id,
      s.user_id,
      s.started_at,
      coalesce(s.last_seen_at, s.started_at) as last_activity_at,
      s.ended_at,
      greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )::bigint as duration_seconds
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.user_id is not null
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
  )
  select
    count(*),
    count(distinct user_id),
    count(*) filter (
      where ended_at is null
        and last_activity_at >= now() - interval '5 minutes'
    ),
    coalesce(round(avg(duration_seconds)), 0)::bigint,
    coalesce(sum(duration_seconds), 0)::bigint
  into
    v_total,
    v_unique_users,
    v_active_now,
    v_average_duration_seconds,
    v_total_duration_seconds
  from filtered;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.last_activity_at desc, q.session_id desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      s.id as session_id,
      s.user_id,
      coalesce(nullif(btrim(p.display_name), ''), 'Not provided') as display_name,
      u.email,
      coalesce(nullif(btrim(p.school), ''), 'Not provided') as school,
      coalesce(r.role::text, 'student') as role,
      s.started_at,
      coalesce(s.last_seen_at, s.started_at) as last_activity_at,
      s.ended_at,
      greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )::bigint as duration_seconds,
      (
        s.ended_at is null
        and coalesce(s.last_seen_at, s.started_at) >= now() - interval '5 minutes'
      ) as active_now,
      latest.event_type as latest_event_type,
      latest.page_area as latest_page_area,
      latest.result_category as latest_result_category,
      latest.occurred_at as latest_event_at,
      coalesce(activity.event_count, 0) as event_count,
      coalesce(activity.questions_answered, 0) as questions_answered,
      case
        when signin.region is not null and signin.country_code is not null
          then signin.region || ', ' || signin.country_code
        else coalesce(signin.region, signin.country_code)
      end as current_region,
      coalesce(signin.device_category, s.device_category) as current_device_category,
      signin.browser as current_browser,
      signin.operating_system as current_operating_system,
      public.admin_subscription_category(s.user_id) as subscription_category,
      greatest(
        0,
        coalesce(token_grant.token_limit, 0) - coalesce(token_usage.used_tokens, 0)
      ) as free_grades_remaining,
      case
        when coalesce(r.role::text, 'student') in ('admin', 'founder_admin', 'super_admin')
          then 'Administrator'
        when coalesce(beta.enabled, false)
          and (beta.expires_at is null or beta.expires_at > now())
          then 'Founding Beta'
        when subscription.status = 'active'
          and subscription.starts_at <= now()
          and (subscription.expires_at is null or subscription.expires_at > now())
          then 'Paid access'
        else 'Introductory access'
      end as effective_access
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    left join public.user_roles r on r.user_id = s.user_id
    left join public.free_beta_access beta on beta.user_id = s.user_id
    left join public.introductory_token_grants token_grant on token_grant.user_id = s.user_id
    left join lateral (
      select count(*)::integer as used_tokens
      from public.introductory_token_ledger ledger
      where ledger.grant_id = token_grant.id
        and ledger.event_type = 'consumed'
    ) token_usage on true
    left join lateral (
      select
        sub.status,
        sub.starts_at,
        sub.expires_at
      from public.subscriptions sub
      where sub.user_id = s.user_id
      order by sub.updated_at desc, sub.created_at desc
      limit 1
    ) subscription on true
    left join lateral (
      select
        e.signed_in_at,
        e.device_category,
        e.browser,
        e.operating_system,
        e.region,
        e.country_code
      from public.user_sign_in_events e
      where e.user_id = s.user_id
        and e.signed_in_at >= s.started_at - interval '1 hour'
        and e.signed_in_at <= coalesce(s.last_seen_at, s.started_at) + interval '5 minutes'
      order by e.signed_in_at desc, e.id desc
      limit 1
    ) signin on true
    left join lateral (
      select
        e.event_type,
        e.page_area,
        e.result_category,
        e.occurred_at
      from public.usage_events e
      where e.session_id = s.id
      order by e.occurred_at desc, e.id desc
      limit 1
    ) latest on true
    left join lateral (
      select
        count(*)::integer as event_count,
        count(*) filter (where e.event_type = 'grading_success')::integer as questions_answered
      from public.usage_events e
      where e.session_id = s.id
    ) activity on true
    where s.user_id is not null
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    order by coalesce(s.last_seen_at, s.started_at) desc, s.id desc
    limit v_limit offset v_offset
  ) q;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.activity_date),
    '[]'::jsonb
  )
  into v_daily_activity
  from (
    select
      (coalesce(s.last_seen_at, s.started_at) at time zone 'Asia/Manila')::date as activity_date,
      count(*)::integer as sessions,
      count(distinct s.user_id)::integer as users,
      coalesce(sum(greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )), 0)::bigint as duration_seconds
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.user_id is not null
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    group by 1
    order by 1
  ) q;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.event_count desc, q.event_type),
    '[]'::jsonb
  )
  into v_activity_mix
  from (
    select
      e.event_type,
      count(*)::integer as event_count
    from public.usage_events e
    join public.usage_sessions s on s.id = e.session_id
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.user_id is not null
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    group by e.event_type
    order by count(*) desc, e.event_type
    limit 8
  ) q;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_user_activity_directory'
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
      'admin_recent_user_activity_directory',
      'recent_users',
      'Authorized recent user activity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'from', v_from::text,
        'to', v_to::text,
        'searchApplied', v_search is not null,
        'searchFingerprint', md5(coalesce(v_search, '')),
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', jsonb_array_length(v_items),
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'from', v_from,
    'to', v_to,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total,
    'summary', jsonb_build_object(
      'uniqueUsers', v_unique_users,
      'sessions', v_total,
      'activeNow', v_active_now,
      'averageDurationSeconds', v_average_duration_seconds,
      'totalDurationSeconds', v_total_duration_seconds
    ),
    'dailyActivity', v_daily_activity,
    'activityMix', v_activity_mix,
    'items', v_items
  );
end;
$$;

revoke all on function public.admin_recent_user_activity_directory(
  uuid, text, timestamptz, timestamptz, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.admin_recent_user_activity_directory(
  uuid, text, timestamptz, timestamptz, integer, integer, text
) to service_role;

comment on function public.admin_recent_user_activity_directory(
  uuid, text, timestamptz, timestamptz, integer, integer, text
) is 'Capability-restricted and audited recent signed-in session ledger with controlled activity, duration, coarse region/device, and access fields; raw metadata is never returned.';

commit;
