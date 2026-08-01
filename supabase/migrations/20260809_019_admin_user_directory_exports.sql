-- Authorized administrator directory with exact user emails, plus a
-- founder-only response export wrapper that attaches server-derived identity.
-- No browser-facing table grants are added. Both functions are callable only
-- through the trusted Worker service-role path and repeat authorization inside
-- the database as defense in depth.

begin;

create or replace function public.admin_user_directory(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
        where ev.user_id = u.id
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
      and target_resource_type = 'admin_user_directory'
      and details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_user_directory',
      p_access_purpose,
      case p_access_purpose
        when 'csv_export' then 'Authorized user directory CSV export'
        else 'Authorized Students dashboard directory view'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
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
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    'hasMore', v_offset + v_result_count < v_total,
    'tooMany', p_access_purpose = 'csv_export' and v_total > v_limit
  );
end;
$$;

create or replace function public.admin_export_user_responses_with_identity(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_email text;
  v_display_name text;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  select u.email, p.display_name
    into v_email, v_display_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_target_user_id;
  if not found then
    raise exception 'Target user not found';
  end if;

  v_result := public.admin_export_user_responses(
    p_actor_user_id,
    p_target_user_id,
    p_from,
    p_to,
    p_limit,
    p_reason,
    p_request_key
  );

  return v_result || jsonb_build_object(
    'user', jsonb_build_object(
      'id', p_target_user_id,
      'email', v_email,
      'displayName', v_display_name
    )
  );
end;
$$;

revoke all on function public.admin_user_directory(
  uuid, text, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;

grant execute on function public.admin_user_directory(
  uuid, text, integer, integer, text, text
) to service_role;
grant execute on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_user_directory(
  uuid, text, integer, integer, text, text
) is 'Capability-restricted and audited administrator directory containing exact user emails.';
comment on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Founder-only audited response export with server-derived user identity.';

commit;
