-- Support administrators need the account identity that belongs to each case.
-- The original operational RPC returned the message but dropped user_id,
-- reply_email, profile name, and account email, making follow-up impossible.

begin;

create or replace function public.admin_support_queue_v1(
  p_actor_user_id uuid,
  p_search text,
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
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_audit_exists boolean := false;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'support_admin') then
    raise exception 'Support capability required';
  end if;
  if char_length(coalesce(p_search, '')) > 180 then
    raise exception 'Support search is too long';
  end if;
  if coalesce(v_search, '') ~ '[[:cntrl:]]' then
    raise exception 'Support search contains unsupported characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid support queue request key required';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'search', coalesce(v_search, ''),
      'limit', v_limit,
      'offset', v_offset
    )::text,
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor_user_id::text || ':' || p_request_key,
    20260828
  ));
  select a.details->>'requestFingerprint'
  into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_support_queue_v1'
    and a.details->>'requestKey' = p_request_key
  order by a.occurred_at desc
  limit 1;
  v_audit_exists := found;
  if v_audit_exists and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Support queue request key conflict';
  end if;

  select count(*)::integer
  into v_total
  from public.support_requests s
  left join public.profiles p on p.id = s.user_id
  left join auth.users u on u.id = s.user_id
  where v_search is null
    or s.id::text ilike '%' || v_search || '%'
    or coalesce(s.message, '') ilike '%' || v_search || '%'
    or coalesce(s.category, '') ilike '%' || v_search || '%'
    or coalesce(s.status, '') ilike '%' || v_search || '%'
    or coalesce(s.reply_email, '') ilike '%' || v_search || '%'
    or coalesce(u.email, '') ilike '%' || v_search || '%'
    or coalesce(p.display_name, '') ilike '%' || v_search || '%'
    or coalesce(u.raw_user_meta_data->>'full_name', '') ilike '%' || v_search || '%'
    or coalesce(u.raw_user_meta_data->>'name', '') ilike '%' || v_search || '%';

  select coalesce(
    jsonb_agg(
      to_jsonb(q) - 'sort_priority'
      order by q.sort_priority, q.created_at, q.id
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      s.id,
      s.user_id,
      nullif(btrim(p.display_name), '') as display_name,
      coalesce(
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), '')
      ) as account_claimed_name,
      u.email as account_email,
      s.reply_email,
      coalesce(nullif(btrim(s.reply_email), ''), u.email) as contact_email,
      s.category,
      s.message,
      s.status,
      s.priority,
      s.assigned_to,
      s.created_at,
      s.updated_at,
      s.first_responded_at,
      s.resolved_at,
      s.internal_note,
      extract(epoch from (now() - s.created_at))::integer as age_seconds,
      s.first_responded_at is null
        and s.status not in ('resolved', 'closed')
        and s.created_at < now() - interval '24 hours' as overdue_24h,
      case s.priority
        when 'urgent' then 1
        when 'high' then 2
        when 'normal' then 3
        else 4
      end as sort_priority
    from public.support_requests s
    left join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
    where v_search is null
      or s.id::text ilike '%' || v_search || '%'
      or coalesce(s.message, '') ilike '%' || v_search || '%'
      or coalesce(s.category, '') ilike '%' || v_search || '%'
      or coalesce(s.status, '') ilike '%' || v_search || '%'
      or coalesce(s.reply_email, '') ilike '%' || v_search || '%'
      or coalesce(u.email, '') ilike '%' || v_search || '%'
      or coalesce(p.display_name, '') ilike '%' || v_search || '%'
      or coalesce(u.raw_user_meta_data->>'full_name', '') ilike '%' || v_search || '%'
      or coalesce(u.raw_user_meta_data->>'name', '') ilike '%' || v_search || '%'
    order by
      case s.priority
        when 'urgent' then 1
        when 'high' then 2
        when 'normal' then 3
        else 4
      end,
      s.created_at,
      s.id
    limit v_limit offset v_offset
  ) q;

  if not v_audit_exists then
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
      'admin_support_queue_v1',
      'support',
      'Authorized support queue identity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'requestFingerprint', v_request_fingerprint,
        'searchApplied', v_search is not null,
        'searchFingerprint', encode(extensions.digest(
          coalesce(v_search, ''),
          'sha256'
        ), 'hex'),
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', jsonb_array_length(v_items),
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'section', 'support',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
end;
$$;

revoke all on function public.admin_support_queue_v1(uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_support_queue_v1(uuid, text, integer, integer, text)
  to service_role;

comment on function public.admin_support_queue_v1(uuid, text, integer, integer, text)
  is 'Audited support-admin-only queue with linked profile identity, account email, and requester-supplied reply email.';

commit;
