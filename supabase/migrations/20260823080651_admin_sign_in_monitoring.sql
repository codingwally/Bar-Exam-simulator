-- Privacy-safe administrator sign-in monitoring.
--
-- This migration intentionally stores only coarse, operational metadata that
-- the trusted Worker derives after Supabase has verified the user's access
-- token. It never stores an IP address, raw user agent, bearer token, cookie,
-- device fingerprint, or student answer.

begin;

create table if not exists public.user_sign_in_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_digest text not null unique,
  signed_in_at timestamptz not null default now(),
  device_category text not null default 'unknown',
  browser text,
  operating_system text,
  region text,
  country_code text,
  language text,
  constraint user_sign_in_events_session_digest_check check (
    session_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint user_sign_in_events_device_category_check check (
    device_category in ('desktop', 'tablet', 'mobile', 'unknown')
  ),
  constraint user_sign_in_events_text_bounds_check check (
    char_length(coalesce(browser, '')) <= 80
    and char_length(coalesce(operating_system, '')) <= 80
    and char_length(coalesce(region, '')) <= 80
    and char_length(coalesce(country_code, '')) <= 2
    and char_length(coalesce(language, '')) <= 40
  ),
  constraint user_sign_in_events_country_code_check check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  )
);

create index if not exists user_sign_in_events_user_signed_in_idx
  on public.user_sign_in_events (user_id, signed_in_at desc);

alter table public.user_sign_in_events enable row level security;
revoke all on public.user_sign_in_events from public, anon, authenticated;
grant select, insert on public.user_sign_in_events to service_role;

comment on table public.user_sign_in_events is
  'Backend-only coarse sign-in metadata. Excludes IP addresses, raw user agents, credentials, tokens, fingerprints, and answer content.';

create or replace function public.record_user_sign_in_event(
  p_user_id uuid,
  p_session_digest text,
  p_device_category text,
  p_browser text default null,
  p_operating_system text default null,
  p_region text default null,
  p_country_code text default null,
  p_language text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_category text := lower(btrim(coalesce(p_device_category, 'unknown')));
  v_country_code text := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
  v_event_id uuid;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Verified user is required';
  end if;
  if coalesce(p_session_digest, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid session digest is required';
  end if;
  if v_device_category not in ('desktop', 'tablet', 'mobile', 'unknown') then
    raise exception 'Valid device category is required';
  end if;
  if v_country_code is not null and v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Valid country code is required';
  end if;
  if char_length(coalesce(p_browser, '')) > 80
    or char_length(coalesce(p_operating_system, '')) > 80
    or char_length(coalesce(p_region, '')) > 80
    or char_length(coalesce(p_language, '')) > 40 then
    raise exception 'Sign-in metadata is too long';
  end if;

  insert into public.user_sign_in_events (
    user_id,
    session_digest,
    device_category,
    browser,
    operating_system,
    region,
    country_code,
    language
  ) values (
    p_user_id,
    p_session_digest,
    v_device_category,
    nullif(btrim(coalesce(p_browser, '')), ''),
    nullif(btrim(coalesce(p_operating_system, '')), ''),
    nullif(btrim(coalesce(p_region, '')), ''),
    v_country_code,
    nullif(btrim(coalesce(p_language, '')), '')
  )
  on conflict (session_digest) do nothing
  returning id into v_event_id;

  return jsonb_build_object(
    'recorded', v_event_id is not null,
    'alreadyRecorded', v_event_id is null
  );
end;
$$;

revoke all on function public.record_user_sign_in_event(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_user_sign_in_event(
  uuid, text, text, text, text, text, text, text
) to service_role;

comment on function public.record_user_sign_in_event(
  uuid, text, text, text, text, text, text, text
) is 'Service-role-only idempotent persistence for privacy-safe sign-in metadata.';

create or replace function public.admin_user_monitoring_directory(
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
set search_path = ''
as $$
declare
  v_directory jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  -- The established directory performs capability authorization, validates
  -- request bounds, returns exact emails, and writes the sensitive-access log.
  v_directory := public.admin_user_engagement_directory(
    p_actor_user_id,
    p_search,
    p_limit,
    p_offset,
    p_request_key,
    p_access_purpose
  );

  select coalesce(
    jsonb_agg(
      d.item || jsonb_strip_nulls(jsonb_build_object(
        'current_region', case
          when signin.region is not null and signin.country_code is not null
            then signin.region || ', ' || signin.country_code
          else coalesce(signin.region, signin.country_code)
        end,
        'current_device_category', coalesce(signin.device_category, session.device_category),
        'current_browser', signin.browser,
        'current_operating_system', signin.operating_system,
        'current_language', signin.language,
        'monitoring_recorded_at', coalesce(signin.signed_in_at, session.last_seen_at)
      ))
      order by d.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
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
    where e.user_id = (d.item->>'id')::uuid
    order by e.signed_in_at desc, e.id desc
    limit 1
  ) signin on true
  left join lateral (
    select s.device_category, s.last_seen_at
    from public.usage_sessions s
    where s.user_id = (d.item->>'id')::uuid
    order by s.last_seen_at desc, s.id desc
    limit 1
  ) session on true;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

revoke all on function public.admin_user_monitoring_directory(
  uuid, text, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.admin_user_monitoring_directory(
  uuid, text, integer, integer, text, text
) to service_role;

comment on function public.admin_user_monitoring_directory(
  uuid, text, integer, integer, text, text
) is 'Capability-restricted audited administrator directory enriched with the latest coarse sign-in and device metadata.';

commit;
