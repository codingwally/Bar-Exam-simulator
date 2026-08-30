-- Due Diligence Admin Pulse pilot.
--
-- This migration is deliberately additive and default-off. Authoritative
-- product writes emit one of five append-only event types only after the
-- singleton capture switch is explicitly enabled. Browser roles never receive
-- direct access to events, push endpoints, or delivery state.

begin;

create table if not exists private.admin_pulse_settings (
  singleton boolean primary key default true check (singleton),
  capture_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into private.admin_pulse_settings (
  singleton,
  capture_enabled,
  delivery_enabled
) values (true, false, false)
on conflict (singleton) do nothing;

revoke all on private.admin_pulse_settings from public, anon, authenticated;

create table if not exists private.admin_pulse_subscriber_first_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_subscription_id uuid references public.subscriptions(id) on delete set null,
  first_activated_at timestamptz not null,
  created_at timestamptz not null default now()
);

revoke all on private.admin_pulse_subscriber_first_seen
  from public, anon, authenticated, service_role;

-- Seed the first-seen marker before the trigger is installed. Historical
-- active-state audit rows are preferred; legacy subscription rows are a
-- conservative fallback so a renewal cannot be mislabeled as a new subscriber.
insert into private.admin_pulse_subscriber_first_seen (
  user_id,
  first_subscription_id,
  first_activated_at
)
select distinct on (candidate.user_id)
  candidate.user_id,
  candidate.subscription_id,
  candidate.activated_at
from (
  select
    history.user_id,
    history.subscription_id,
    history.occurred_at as activated_at
  from public.subscription_history history
  where coalesce(history.new_state->>'status', '') = 'active'

  union all

  select
    subscription.user_id,
    subscription.id as subscription_id,
    coalesce(subscription.starts_at, subscription.created_at) as activated_at
  from public.subscriptions subscription
  where subscription.status in (
    'active', 'paused', 'cancelled', 'expired', 'refunded'
  )
) candidate
order by candidate.user_id, candidate.activated_at, candidate.subscription_id
on conflict (user_id) do nothing;

create table if not exists public.admin_pulse_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'new_subscriber',
    'home_wall_post',
    'support_request',
    'user_active',
    'new_sign_in'
  )),
  dedupe_key text not null unique,
  actor_user_id uuid,
  data_scope text not null default 'regular'
    check (data_scope in ('regular', 'internal_test')),
  resource_type text not null,
  resource_id text not null,
  title text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint admin_pulse_events_dedupe_key_check check (
    char_length(dedupe_key) between 8 and 200
    and dedupe_key !~ '[[:cntrl:]]'
  ),
  constraint admin_pulse_events_resource_check check (
    char_length(resource_type) between 1 and 80
    and char_length(resource_id) between 1 and 200
  ),
  constraint admin_pulse_events_copy_check check (
    char_length(title) between 1 and 100
    and char_length(summary) between 1 and 500
  ),
  constraint admin_pulse_events_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists admin_pulse_events_scope_time_idx
  on public.admin_pulse_events (data_scope, occurred_at desc, id desc);

alter table public.admin_pulse_events enable row level security;
revoke all on public.admin_pulse_events from public, anon, authenticated, service_role;

comment on table public.admin_pulse_events is
  'Append-only, backend-only Admin Pulse event ledger. Exactly five event types; no browser role has direct access.';

create table if not exists public.admin_pulse_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  endpoint text,
  endpoint_hash text not null unique,
  p256dh text,
  auth_secret text,
  status text not null default 'active'
    check (status in ('active', 'stale', 'revoked')),
  expiration_time timestamptz,
  user_agent_family text,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_http_status integer,
  last_error_code text,
  last_success_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_pulse_push_subscriptions_hash_check check (
    endpoint_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint admin_pulse_push_subscriptions_active_material_check check (
    status <> 'active'
    or (
      endpoint is not null
      and endpoint ~ '^https://'
      and char_length(endpoint) between 16 and 2048
      and p256dh is not null
      and p256dh ~ '^[A-Za-z0-9_-]{80,180}$'
      and auth_secret is not null
      and auth_secret ~ '^[A-Za-z0-9_-]{16,64}$'
    )
  ),
  constraint admin_pulse_push_subscriptions_text_bounds_check check (
    char_length(coalesce(user_agent_family, '')) <= 80
    and char_length(coalesce(last_error_code, '')) <= 120
  )
);

create index if not exists admin_pulse_push_subscriptions_admin_idx
  on public.admin_pulse_push_subscriptions (admin_user_id, status, updated_at desc);

alter table public.admin_pulse_push_subscriptions enable row level security;
revoke all on public.admin_pulse_push_subscriptions
  from public, anon, authenticated, service_role;

create table if not exists public.admin_pulse_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.admin_pulse_events(id) on delete restrict,
  subscription_id uuid not null
    references public.admin_pulse_push_subscriptions(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'delivered', 'stale', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  last_http_status integer,
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, subscription_id),
  constraint admin_pulse_deliveries_error_bounds_check check (
    char_length(coalesce(last_error_code, '')) <= 120
  )
);

create index if not exists admin_pulse_deliveries_ready_idx
  on public.admin_pulse_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'retry');

create index if not exists admin_pulse_deliveries_subscription_idx
  on public.admin_pulse_deliveries (subscription_id, created_at desc);

alter table public.admin_pulse_deliveries enable row level security;
revoke all on public.admin_pulse_deliveries
  from public, anon, authenticated, service_role;

create or replace function private.admin_pulse_is_privileged_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles role_row
    where role_row.user_id = p_user_id
      and role_row.role::text in ('admin', 'founder_admin', 'super_admin')
  );
$$;

revoke all on function private.admin_pulse_is_privileged_user(uuid)
  from public, anon, authenticated;

create or replace function private.admin_pulse_enqueue_event(
  p_event_type text,
  p_dedupe_key text,
  p_actor_user_id uuid,
  p_resource_type text,
  p_resource_id text,
  p_title text,
  p_summary text,
  p_metadata jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_enabled boolean := false;
  v_delivery_enabled boolean := false;
  v_event_id uuid;
  v_data_scope text := 'regular';
begin
  select setting.capture_enabled, setting.delivery_enabled
  into v_capture_enabled, v_delivery_enabled
  from private.admin_pulse_settings setting
  where setting.singleton = true;

  if not coalesce(v_capture_enabled, false) then
    return null;
  end if;

  if p_event_type not in (
    'new_subscriber', 'home_wall_post', 'support_request',
    'user_active', 'new_sign_in'
  ) then
    raise exception 'Unsupported Admin Pulse event type';
  end if;

  if p_actor_user_id is not null and exists (
    select 1
    from private.internal_test_accounts classified
    where classified.user_id = p_actor_user_id
  ) then
    v_data_scope := 'internal_test';
  end if;

  insert into public.admin_pulse_events (
    event_type,
    dedupe_key,
    actor_user_id,
    data_scope,
    resource_type,
    resource_id,
    title,
    summary,
    metadata,
    occurred_at
  ) values (
    p_event_type,
    p_dedupe_key,
    p_actor_user_id,
    v_data_scope,
    p_resource_type,
    p_resource_id,
    p_title,
    p_summary,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  on conflict (dedupe_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return null;
  end if;

  if coalesce(v_delivery_enabled, false) and v_data_scope = 'regular' then
    insert into public.admin_pulse_deliveries (event_id, subscription_id)
    select v_event_id, subscription.id
    from public.admin_pulse_push_subscriptions subscription
    join public.user_roles role_row
      on role_row.user_id = subscription.admin_user_id
      and role_row.role::text in ('admin', 'founder_admin', 'super_admin')
    where subscription.status = 'active'
      and (
        subscription.expiration_time is null
        or subscription.expiration_time > now()
      )
    on conflict (event_id, subscription_id) do nothing;
  end if;

  return v_event_id;
end;
$$;

revoke all on function private.admin_pulse_enqueue_event(
  text, text, uuid, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;

create or replace function private.admin_pulse_subscription_activated_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_seen_user_id uuid;
begin
  if new.status <> 'active'
    or (tg_op = 'UPDATE' and old.status is not distinct from 'active') then
    return new;
  end if;

  -- This marker is written even while Pulse capture is disabled. That makes
  -- first activation a durable business fact instead of a feature-toggle fact.
  insert into private.admin_pulse_subscriber_first_seen (
    user_id,
    first_subscription_id,
    first_activated_at
  ) values (
    new.user_id,
    new.id,
    coalesce(new.starts_at, new.updated_at, new.created_at, now())
  )
  on conflict (user_id) do nothing
  returning user_id into v_first_seen_user_id;

  if v_first_seen_user_id is null then
    return new;
  end if;

  perform private.admin_pulse_enqueue_event(
    'new_subscriber',
    'new_subscriber:user:' || new.user_id::text,
    new.user_id,
    'subscription',
    new.id::text,
    'New subscriber',
    'A subscription was activated for the first time.',
    jsonb_strip_nulls(jsonb_build_object(
      'planCode', new.plan_code,
      'source', new.source
    )),
    coalesce(new.starts_at, new.updated_at, new.created_at, now())
  );
  return new;
end;
$$;

revoke all on function private.admin_pulse_subscription_activated_trigger()
  from public, anon, authenticated;

create or replace function private.admin_pulse_home_wall_post_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null and new.moderation_status = 'visible' then
    perform private.admin_pulse_enqueue_event(
      'home_wall_post',
      'home_wall_post:forum_post:' || new.id::text,
      new.author_user_id,
      'forum_post',
      new.id::text,
      'New Home Wall post',
      left(regexp_replace(btrim(new.body), '[[:space:]]+', ' ', 'g'), 500),
      '{}'::jsonb,
      new.created_at
    );
  end if;
  return new;
end;
$$;

create or replace function private.admin_pulse_support_request_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_pulse_enqueue_event(
    'support_request',
    'support_request:support_request:' || new.id::text,
    new.user_id,
    'support_request',
    new.id::text,
    'New support request',
    'A new ' || replace(new.category, '_', ' ') || ' support request was received.',
    jsonb_build_object('category', new.category),
    new.created_at
  );
  return new;
end;
$$;

create or replace function private.admin_pulse_user_active_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.user_id is not null then
      return new;
    end if;
  end if;
  if private.admin_pulse_is_privileged_user(new.user_id) then
    return new;
  end if;

  perform private.admin_pulse_enqueue_event(
    'user_active',
    'user_active:usage_session:' || new.id::text,
    new.user_id,
    'usage_session',
    new.id::text,
    'User active',
    'A signed-in user started using the website.',
    jsonb_strip_nulls(jsonb_build_object(
      'pageArea', new.last_page_area,
      'deviceCategory', new.device_category
    )),
    new.started_at
  );
  return new;
end;
$$;

create or replace function private.admin_pulse_new_sign_in_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.admin_pulse_is_privileged_user(new.user_id) then
    return new;
  end if;

  perform private.admin_pulse_enqueue_event(
    'new_sign_in',
    'new_sign_in:user_sign_in_event:' || new.id::text,
    new.user_id,
    'user_sign_in_event',
    new.id::text,
    'New sign-in',
    'A user signed in to Due Diligence.',
    jsonb_strip_nulls(jsonb_build_object(
      'deviceCategory', new.device_category,
      'region', new.region,
      'countryCode', new.country_code
    )),
    new.signed_in_at
  );
  return new;
end;
$$;

drop trigger if exists admin_pulse_subscription_activated
  on public.subscriptions;
create trigger admin_pulse_subscription_activated
after insert or update of status on public.subscriptions
for each row execute function private.admin_pulse_subscription_activated_trigger();

drop trigger if exists admin_pulse_home_wall_post
  on public.forum_posts;
create trigger admin_pulse_home_wall_post
after insert on public.forum_posts
for each row execute function private.admin_pulse_home_wall_post_trigger();

drop trigger if exists admin_pulse_support_request
  on public.support_requests;
create trigger admin_pulse_support_request
after insert on public.support_requests
for each row execute function private.admin_pulse_support_request_trigger();

drop trigger if exists admin_pulse_user_active
  on public.usage_sessions;
create trigger admin_pulse_user_active
after insert or update of user_id on public.usage_sessions
for each row execute function private.admin_pulse_user_active_trigger();

drop trigger if exists admin_pulse_new_sign_in
  on public.user_sign_in_events;
create trigger admin_pulse_new_sign_in
after insert on public.user_sign_in_events
for each row execute function private.admin_pulse_new_sign_in_trigger();

create or replace function public.admin_pulse_snapshot_v1(
  p_actor_user_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_events jsonb := '[]'::jsonb;
  v_active_count bigint := 0;
  v_subscribed boolean := false;
  v_capture_enabled boolean := false;
  v_delivery_enabled boolean := false;
begin
  perform public.admin_authorization_context(p_actor_user_id);

  select
    coalesce(setting.capture_enabled, false),
    coalesce(setting.delivery_enabled, false)
  into v_capture_enabled, v_delivery_enabled
  from private.admin_pulse_settings setting
  where setting.singleton = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', selected.id,
        'eventType', selected.event_type,
        'title', selected.title,
        'summary', case selected.event_type
          when 'new_subscriber' then selected.actor_label || ' became a subscriber.'
          when 'home_wall_post' then selected.actor_label || ': ' || selected.summary
          when 'support_request' then selected.actor_label || ' sent a '
            || coalesce(selected.metadata->>'category', 'new') || ' support request.'
          when 'user_active' then selected.actor_label || ' started using the website.'
          when 'new_sign_in' then selected.actor_label || ' signed in.'
          else selected.summary
        end,
        'occurredAt', selected.occurred_at,
        'url', case selected.event_type
          when 'new_subscriber' then '/admin/#subscriptions'
          when 'home_wall_post' then '/admin/#forum'
          when 'support_request' then '/admin/#support'
          when 'user_active' then '/admin/#realtime'
          when 'new_sign_in' then '/admin/#recent_users'
          else '/admin/'
        end
      )
      order by selected.occurred_at desc, selected.id desc
    ),
    '[]'::jsonb
  ) into v_events
  from (
    select
      event.id,
      event.event_type,
      event.title,
      event.summary,
      event.metadata,
      event.occurred_at,
      coalesce(
        nullif(btrim(profile.display_name), '')
          || case when account.email is null then '' else ' (' || account.email || ')' end,
        nullif(btrim(account.raw_user_meta_data->>'full_name'), '')
          || case when account.email is null then '' else ' (' || account.email || ')' end,
        nullif(btrim(account.raw_user_meta_data->>'name'), '')
          || case when account.email is null then '' else ' (' || account.email || ')' end,
        account.email,
        'Due Diligence user'
      ) as actor_label
    from public.admin_pulse_events event
    left join public.profiles profile on profile.id = event.actor_user_id
    left join auth.users account on account.id = event.actor_user_id
    where event.data_scope = 'regular'
      and (
        event.event_type <> 'home_wall_post'
        or exists (
          select 1
          from public.forum_posts post
          where post.id::text = event.resource_id
            and post.deleted_at is null
            and post.moderation_status = 'visible'
        )
      )
    order by event.occurred_at desc, event.id desc
    limit v_limit
  ) selected;

  select count(distinct session_row.user_id)
  into v_active_count
  from public.usage_sessions session_row
  left join public.user_roles role_row on role_row.user_id = session_row.user_id
  left join private.internal_test_accounts classified
    on classified.user_id = session_row.user_id
  where session_row.user_id is not null
    and session_row.ended_at is null
    and session_row.last_seen_at >= now() - interval '5 minutes'
    and classified.user_id is null
    and coalesce(role_row.role::text, 'student')
      not in ('admin', 'founder_admin', 'super_admin');

  select exists (
    select 1
    from public.admin_pulse_push_subscriptions subscription
    where subscription.admin_user_id = p_actor_user_id
      and subscription.status = 'active'
      and (
        subscription.expiration_time is null
        or subscription.expiration_time > now()
      )
  ) into v_subscribed;

  return jsonb_build_object(
    'captureEnabled', v_capture_enabled,
    'deliveryEnabled', v_delivery_enabled,
    'generatedAt', now(),
    'activeUsers', jsonb_build_object('count', v_active_count),
    'events', v_events,
    'subscribed', v_subscribed
  );
end;
$$;

revoke all on function public.admin_pulse_snapshot_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_pulse_snapshot_v1(uuid, integer)
  to service_role;

create or replace function public.admin_pulse_upsert_push_subscription_v1(
  p_actor_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_expiration_time timestamptz,
  p_user_agent_family text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_endpoint_hash text;
  v_subscription_id uuid;
  v_capture_enabled boolean := false;
  v_delivery_enabled boolean := false;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  select
    coalesce(setting.capture_enabled, false),
    coalesce(setting.delivery_enabled, false)
  into v_capture_enabled, v_delivery_enabled
  from private.admin_pulse_settings setting
  where setting.singleton = true;
  if not v_capture_enabled or not v_delivery_enabled then
    raise exception 'Admin Pulse capture and delivery are not enabled';
  end if;
  if char_length(v_endpoint) not between 16 and 2048
    or v_endpoint !~ '^https://'
    or v_endpoint ~ '[[:cntrl:]]'
    or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,180}$'
    or coalesce(p_auth_secret, '') !~ '^[A-Za-z0-9_-]{16,64}$'
    or char_length(coalesce(p_user_agent_family, '')) > 80 then
    raise exception 'Valid Web Push subscription required';
  end if;
  if p_expiration_time is not null and p_expiration_time <= now() then
    raise exception 'Web Push subscription is expired';
  end if;

  v_endpoint_hash := encode(extensions.digest(v_endpoint, 'sha256'), 'hex');
  insert into public.admin_pulse_push_subscriptions (
    admin_user_id,
    endpoint,
    endpoint_hash,
    p256dh,
    auth_secret,
    status,
    expiration_time,
    user_agent_family,
    failure_count,
    last_http_status,
    last_error_code,
    disabled_at,
    updated_at
  ) values (
    p_actor_user_id,
    v_endpoint,
    v_endpoint_hash,
    p_p256dh,
    p_auth_secret,
    'active',
    p_expiration_time,
    nullif(btrim(coalesce(p_user_agent_family, '')), ''),
    0,
    null,
    null,
    null,
    now()
  )
  on conflict (endpoint_hash) do update
  set admin_user_id = excluded.admin_user_id,
      endpoint = excluded.endpoint,
      p256dh = excluded.p256dh,
      auth_secret = excluded.auth_secret,
      status = 'active',
      expiration_time = excluded.expiration_time,
      user_agent_family = excluded.user_agent_family,
      failure_count = 0,
      last_http_status = null,
      last_error_code = null,
      disabled_at = null,
      updated_at = now()
  returning id into v_subscription_id;

  return jsonb_build_object(
    'subscriptionId', v_subscription_id,
    'captureEnabled', v_capture_enabled,
    'deliveryEnabled', v_delivery_enabled,
    'subscribed', true
  );
end;
$$;

revoke all on function public.admin_pulse_upsert_push_subscription_v1(
  uuid, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.admin_pulse_upsert_push_subscription_v1(
  uuid, text, text, text, timestamptz, text
) to service_role;

create or replace function public.admin_pulse_remove_push_subscription_v1(
  p_actor_user_id uuid,
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint_hash text;
  v_capture_enabled boolean := false;
  v_delivery_enabled boolean := false;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  select
    coalesce(setting.capture_enabled, false),
    coalesce(setting.delivery_enabled, false)
  into v_capture_enabled, v_delivery_enabled
  from private.admin_pulse_settings setting
  where setting.singleton = true;
  if char_length(btrim(coalesce(p_endpoint, ''))) not between 16 and 2048 then
    raise exception 'Valid Web Push endpoint required';
  end if;
  v_endpoint_hash := encode(extensions.digest(btrim(p_endpoint), 'sha256'), 'hex');

  update public.admin_pulse_push_subscriptions subscription
  set status = 'revoked',
      endpoint = null,
      p256dh = null,
      auth_secret = null,
      disabled_at = now(),
      updated_at = now()
  where subscription.admin_user_id = p_actor_user_id
    and subscription.endpoint_hash = v_endpoint_hash;

  update public.admin_pulse_deliveries delivery
  set status = 'stale',
      claim_token = null,
      claimed_at = null,
      last_error_code = 'subscription_revoked',
      updated_at = now()
  from public.admin_pulse_push_subscriptions subscription
  where delivery.subscription_id = subscription.id
    and subscription.admin_user_id = p_actor_user_id
    and subscription.endpoint_hash = v_endpoint_hash
    and delivery.status in ('pending', 'retry', 'processing');

  return jsonb_build_object(
    'captureEnabled', v_capture_enabled,
    'deliveryEnabled', v_delivery_enabled,
    'subscribed', false
  );
end;
$$;

revoke all on function public.admin_pulse_remove_push_subscription_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_pulse_remove_push_subscription_v1(uuid, text)
  to service_role;

create or replace function public.admin_pulse_cleanup_deliveries_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_released integer := 0;
  v_terminal integer := 0;
  v_source_unavailable integer := 0;
begin
  update public.admin_pulse_push_subscriptions subscription
  set status = 'stale',
      endpoint = null,
      p256dh = null,
      auth_secret = null,
      disabled_at = coalesce(subscription.disabled_at, now()),
      last_error_code = case
        when subscription.expiration_time is not null
          and subscription.expiration_time <= now()
          then 'subscription_expired'
        else 'admin_authorization_revoked'
      end,
      updated_at = now()
  where subscription.status = 'active'
    and (
      (
        subscription.expiration_time is not null
        and subscription.expiration_time <= now()
      )
      or not exists (
        select 1
        from public.user_roles role_row
        where role_row.user_id = subscription.admin_user_id
          and role_row.role::text in ('admin', 'founder_admin', 'super_admin')
      )
    );
  get diagnostics v_expired = row_count;

  update public.admin_pulse_deliveries delivery
  set status = 'retry',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = now(),
      last_error_code = 'stale_claim_released',
      updated_at = now()
  where delivery.status = 'processing'
    and delivery.claimed_at < now() - interval '5 minutes'
    and delivery.attempt_count < 8;
  get diagnostics v_released = row_count;

  update public.admin_pulse_deliveries delivery
  set status = case
        when subscription.status <> 'active' then 'stale'
        else 'dead'
      end,
      claim_token = null,
      claimed_at = null,
      last_error_code = case
        when subscription.status <> 'active' then 'subscription_inactive'
        else coalesce(delivery.last_error_code, 'retry_limit_reached')
      end,
      updated_at = now()
  from public.admin_pulse_push_subscriptions subscription
  where delivery.subscription_id = subscription.id
    and delivery.status in ('pending', 'retry', 'processing')
    and (
      subscription.status <> 'active'
      or delivery.attempt_count >= 8
    );
  get diagnostics v_terminal = row_count;

  update public.admin_pulse_deliveries delivery
  set status = 'dead',
      claim_token = null,
      claimed_at = null,
      last_error_code = 'source_post_unavailable',
      updated_at = now()
  from public.admin_pulse_events event
  where delivery.event_id = event.id
    and delivery.status in ('pending', 'retry', 'processing')
    and event.event_type = 'home_wall_post'
    and not exists (
      select 1
      from public.forum_posts post
      where post.id::text = event.resource_id
        and post.deleted_at is null
        and post.moderation_status = 'visible'
    );
  get diagnostics v_source_unavailable = row_count;
  v_terminal := v_terminal + v_source_unavailable;

  return jsonb_build_object(
    'expiredSubscriptions', v_expired,
    'releasedClaims', v_released,
    'terminalDeliveries', v_terminal
  );
end;
$$;

revoke all on function public.admin_pulse_cleanup_deliveries_v1()
  from public, anon, authenticated;
grant execute on function public.admin_pulse_cleanup_deliveries_v1()
  to service_role;

create or replace function public.admin_pulse_claim_deliveries_v1(
  p_claim_token uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_delivery_enabled boolean := false;
  v_items jsonb := '[]'::jsonb;
begin
  if p_claim_token is null then
    raise exception 'Claim token required';
  end if;
  select coalesce(setting.delivery_enabled, false)
  into v_delivery_enabled
  from private.admin_pulse_settings setting
  where setting.singleton = true;
  if not v_delivery_enabled then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  with candidates as (
    select delivery.id
    from public.admin_pulse_deliveries delivery
    join public.admin_pulse_push_subscriptions subscription
      on subscription.id = delivery.subscription_id
    join public.admin_pulse_events event
      on event.id = delivery.event_id
    join public.user_roles role_row
      on role_row.user_id = subscription.admin_user_id
      and role_row.role::text in ('admin', 'founder_admin', 'super_admin')
    where delivery.status in ('pending', 'retry')
      and delivery.next_attempt_at <= now()
      and delivery.attempt_count < 8
      and event.data_scope = 'regular'
      and subscription.status = 'active'
      and (
        subscription.expiration_time is null
        or subscription.expiration_time > now()
      )
      and (
        event.event_type <> 'home_wall_post'
        or exists (
          select 1
          from public.forum_posts post
          where post.id::text = event.resource_id
            and post.deleted_at is null
            and post.moderation_status = 'visible'
        )
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    limit v_limit
    for update of delivery skip locked
  ), claimed as (
    update public.admin_pulse_deliveries delivery
    set status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        claim_token = p_claim_token,
        claimed_at = now(),
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'deliveryId', claimed.id,
        'eventId', event.id,
        'eventType', event.event_type,
        'attemptCount', claimed.attempt_count,
        'endpoint', subscription.endpoint,
        'p256dh', subscription.p256dh,
        'auth', subscription.auth_secret
      )
      order by claimed.created_at, claimed.id
    ),
    '[]'::jsonb
  ) into v_items
  from claimed
  join public.admin_pulse_events event on event.id = claimed.event_id
  join public.admin_pulse_push_subscriptions subscription
    on subscription.id = claimed.subscription_id;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.admin_pulse_claim_deliveries_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_pulse_claim_deliveries_v1(uuid, integer)
  to service_role;

create or replace function public.admin_pulse_complete_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_http_status integer,
  p_error_code text,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.admin_pulse_deliveries%rowtype;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_next_status text;
  v_retry_seconds integer;
begin
  if v_outcome not in ('delivered', 'retry', 'stale', 'dead') then
    raise exception 'Unsupported delivery outcome';
  end if;
  if char_length(coalesce(p_error_code, '')) > 120 then
    raise exception 'Delivery error code is too long';
  end if;

  select * into v_delivery
  from public.admin_pulse_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if not found then
    raise exception 'Delivery not found';
  end if;
  if v_delivery.status <> 'processing'
    or v_delivery.claim_token is distinct from p_claim_token then
    raise exception 'Delivery claim does not match';
  end if;

  v_next_status := case
    when v_outcome = 'retry' and v_delivery.attempt_count >= 8 then 'dead'
    else v_outcome
  end;
  v_retry_seconds := least(
    3600,
    greatest(
      30,
      coalesce(
        p_retry_after_seconds,
        (30 * power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer
      )
    )
  );

  update public.admin_pulse_deliveries delivery
  set status = v_next_status,
      next_attempt_at = case
        when v_next_status = 'retry' then now() + make_interval(secs => v_retry_seconds)
        else delivery.next_attempt_at
      end,
      claim_token = null,
      claimed_at = null,
      last_http_status = p_http_status,
      last_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      delivered_at = case when v_next_status = 'delivered' then now() else null end,
      updated_at = now()
  where delivery.id = p_delivery_id;

  if v_next_status = 'delivered' then
    update public.admin_pulse_push_subscriptions subscription
    set failure_count = 0,
        last_http_status = p_http_status,
        last_error_code = null,
        last_success_at = now(),
        updated_at = now()
    where subscription.id = v_delivery.subscription_id;
  elsif v_next_status = 'stale' then
    update public.admin_pulse_push_subscriptions subscription
    set status = 'stale',
        endpoint = null,
        p256dh = null,
        auth_secret = null,
        failure_count = subscription.failure_count + 1,
        last_http_status = p_http_status,
        last_error_code = nullif(left(coalesce(p_error_code, 'push_endpoint_gone'), 120), ''),
        disabled_at = now(),
        updated_at = now()
    where subscription.id = v_delivery.subscription_id;

    update public.admin_pulse_deliveries delivery
    set status = 'stale',
        claim_token = null,
        claimed_at = null,
        last_error_code = 'push_endpoint_gone',
        updated_at = now()
    where delivery.subscription_id = v_delivery.subscription_id
      and delivery.status in ('pending', 'retry', 'processing');
  else
    update public.admin_pulse_push_subscriptions subscription
    set failure_count = subscription.failure_count + 1,
        last_http_status = p_http_status,
        last_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
        updated_at = now()
    where subscription.id = v_delivery.subscription_id;
  end if;

  return jsonb_build_object(
    'deliveryId', p_delivery_id,
    'status', v_next_status,
    'retryAfterSeconds', case when v_next_status = 'retry' then v_retry_seconds else null end
  );
end;
$$;

revoke all on function public.admin_pulse_complete_delivery_v1(
  uuid, uuid, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.admin_pulse_complete_delivery_v1(
  uuid, uuid, text, integer, text, integer
) to service_role;

comment on function public.admin_pulse_snapshot_v1(uuid, integer) is
  'Admin-role-authorized read-only Pulse event feed and authoritative five-minute active-user snapshot.';
comment on function public.admin_pulse_claim_deliveries_v1(uuid, integer) is
  'Service-role-only retry-safe claim of per-subscription Web Push deliveries.';

notify pgrst, 'reload schema';

commit;
