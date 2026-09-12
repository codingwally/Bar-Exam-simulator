-- Manual rollback for 20260913020000_optimize_admin_user_directory.sql
-- Restores the production function bodies captured before the performance change.

begin;

create or replace function private.admin_user_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_max_limit integer;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_result_count integer := 0;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid directory request key required';
  end if;
  if p_access_purpose not in ('dashboard', 'csv_export') then
    raise exception 'Valid directory access purpose required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Directory search is too long';
  end if;

  v_max_limit := case when p_access_purpose = 'csv_export' then 5000 else 100 end;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), v_max_limit);
  if p_access_purpose = 'csv_export' and v_offset <> 0 then
    raise exception 'Directory export offset is not allowed';
  end if;

  select count(*) into v_total
  from auth.users u
  left join public.profiles p on p.id = u.id
  where coalesce(u.is_anonymous, false) = false
    and private.admin_reporting_scope_matches(u.id, p_data_scope)
    and (
      v_search is null
      or p.display_name ilike '%' || v_search || '%'
      or p.school ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%'
    );

  if p_access_purpose <> 'csv_export' or v_total <= v_limit then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        u.id,
        p.display_name,
        u.email,
        p.school,
        p.enrollment_status,
        p.year_level,
        coalesce(p.created_at, u.created_at) as created_at,
        p.profile_completed_at,
        coalesce(r.role, 'student') as role,
        e.plan_code,
        e.status as entitlement_status,
        (
          select max(s.last_seen_at)
          from public.usage_sessions s
          where s.user_id = u.id
        ) as last_active_at,
        (
          select count(*)
          from public.usage_sessions s
          where s.user_id = u.id
        ) as session_count,
        (
          select count(*)
          from public.usage_events ev
          left join public.usage_sessions event_session
            on event_session.id = ev.session_id
          where private.admin_usage_event_owner(ev.user_id, event_session.user_id) = u.id
            and ev.event_type = 'grading_success'
        ) as successful_grade_count,
        (
          select mc.opted_in
          from public.marketing_consents mc
          where mc.user_id = u.id
          order by mc.changed_at desc
          limit 1
        ) as marketing_consent
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.user_roles r on r.user_id = u.id
      left join public.user_entitlements e on e.user_id = u.id
      where coalesce(u.is_anonymous, false) = false
        and private.admin_reporting_scope_matches(u.id, p_data_scope)
        and (
          v_search is null
          or p.display_name ilike '%' || v_search || '%'
          or p.school ilike '%' || v_search || '%'
          or u.email ilike '%' || v_search || '%'
        )
      order by coalesce(p.created_at, u.created_at) desc
      limit v_limit offset v_offset
    ) x;
  end if;

  v_result_count := jsonb_array_length(v_items);
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 1901));
  if not exists (
    select 1
    from public.admin_audit_log
    where actor_user_id = p_actor_user_id
      and action_type = 'sensitive_data_viewed'
      and target_resource_type = 'admin_user_directory_scoped_v1'
      and details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_user_directory_scoped_v1',
      p_access_purpose,
      case p_access_purpose
        when 'csv_export' then 'Authorized user directory CSV export'
        else 'Authorized Students dashboard directory view'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'purpose', p_access_purpose,
        'searchApplied', v_search is not null,
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', v_result_count,
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    'hasMore', v_offset + v_result_count < v_total,
    'tooMany', p_access_purpose = 'csv_export' and v_total > v_limit
  );
end;
$$;

create or replace function private.admin_user_engagement_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_access_purpose text := lower(btrim(coalesce(p_access_purpose, '')));
  v_limit integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_max_limit integer;
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_directory jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;

  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid directory request key required';
  end if;
  if v_access_purpose not in ('dashboard', 'csv_export') then
    raise exception 'Valid directory access purpose required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Directory search is too long';
  end if;
  if coalesce(v_search, '') ~ '[[:cntrl:]]' then
    raise exception 'Directory search contains unsupported characters';
  end if;

  v_max_limit := case when v_access_purpose = 'csv_export' then 5000 else 100 end;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), v_max_limit);
  if v_access_purpose = 'csv_export' and v_offset <> 0 then
    raise exception 'Directory export offset is not allowed';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'search', coalesce(v_search, ''),
      'purpose', v_access_purpose,
      'limit', v_limit,
      'offset', v_offset,
      'dataScope', p_data_scope
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260826));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_user_engagement_directory_scoped_v1_request'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Directory request key conflict';
  end if;

  if not found then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_user_engagement_directory_scoped_v1_request',
      v_access_purpose,
      case v_access_purpose
        when 'csv_export' then 'Authorized user-list download request'
        else 'Authorized Admin user-list view request'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'requestFingerprint', v_request_fingerprint,
        'purpose', v_access_purpose,
        'searchApplied', v_search is not null,
        'searchFingerprint', encode(extensions.digest(
          coalesce(v_search, ''), 'sha256'
        ), 'hex'),
        'limit', v_limit,
        'offset', v_offset
      )
    );
  end if;

  v_directory := private.admin_user_directory_scoped_v1(
    p_actor_user_id,
    v_search,
    v_limit,
    v_offset,
    p_request_key,
    v_access_purpose,
    p_data_scope
  );

  select coalesce(
    jsonb_agg(
      (d.item - 'last_active_at' - 'session_count') || jsonb_strip_nulls(jsonb_build_object(
        'last_sign_in_at', u.last_sign_in_at,
        'has_signed_in', u.last_sign_in_at is not null,
        'practice_answered_count', coalesce(c.practice_answered, 0),
        'examination_answered_count', coalesce(c.examination_answered, 0),
        'answered_question_count', coalesce(c.answered_question_count, 0),
        'last_answered_at', c.last_answered_at,
        'graded_answer_count', coalesce(sc.graded_answer_count, 0),
        'average_score', sc.average_score,
        'latest_score', sc.latest_score,
        'last_graded_at', sc.last_graded_at,
        'subscription_category', public.admin_subscription_category(u.id),
        'subscription_id', sub.id,
        'subscription_plan', sub.plan_code,
        'subscription_status', sub.status,
        'subscription_source', sub.source,
        'subscription_starts_at', sub.starts_at,
        'subscription_expires_at', sub.expires_at,
        'trial_expires_at', trial.expires_at,
        'free_beta_enabled', coalesce(beta.enabled, false),
        'free_beta_expires_at', beta.expires_at,
        'beta_all_access_enabled', coalesce(settings.global_beta_all_access_enabled, false),
        'current_legal_accepted', public.phase4_has_current_legal_acceptance(u.id),
        'effective_access', case
          when not public.phase4_has_current_legal_acceptance(u.id)
            then 'Legal acceptance required'
          when coalesce((d.item->>'role') in ('super_admin', 'founder_admin'), false)
            then 'Admin & Staff access'
          when public.phase4_global_beta_effective(u.id) then 'Beta All Access'
          when sub.currently_active then 'Active subscription'
          else 'No active subscription'
        end
      ))
      order by d.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
  left join auth.users u on u.id = (d.item->>'id')::uuid
  left join private.admin_user_answer_counts_scoped_v1(p_data_scope) c on c.user_id = u.id
  left join public.admin_user_score_summary() sc on sc.user_id = u.id
  left join public.access_trials trial on trial.user_id = u.id
  left join public.free_beta_access beta on beta.user_id = u.id
  left join lateral (
    select
      s.id,
      s.plan_code,
      s.status,
      s.source,
      s.starts_at,
      s.expires_at,
      (
        s.status = 'active'
        and s.starts_at <= now()
        and (s.expires_at is null or s.expires_at > now())
      ) as currently_active
    from public.subscriptions s
    where s.user_id = u.id
      and s.status in ('active', 'paused', 'pending_payment', 'trialing')
    order by
      (s.status = 'active') desc,
      s.updated_at desc,
      s.created_at desc
    limit 1
  ) sub on true
  left join public.platform_access_settings settings on settings.singleton = true;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

commit;
