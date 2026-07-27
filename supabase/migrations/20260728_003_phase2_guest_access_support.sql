-- Due Diligence Phase 2: authoritative guest grading quota and native support.
-- Additive migration. It does not alter questions, grading results, answers,
-- subscriptions, timers, or Phase 1 role assignments.

create table if not exists public.guest_grading_usage (
  id uuid primary key default gen_random_uuid(),
  recovery_hash text not null check (recovery_hash ~ '^[0-9a-f]{64}$'),
  successful_grades smallint not null default 0
    check (successful_grades between 0 and 3),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guest_grading_usage_recovery_idx
  on public.guest_grading_usage (recovery_hash, last_seen_at desc);

create table if not exists public.guest_grading_devices (
  device_hash text primary key check (device_hash ~ '^[0-9a-f]{64}$'),
  usage_id uuid not null references public.guest_grading_usage(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists guest_grading_devices_usage_idx
  on public.guest_grading_devices (usage_id);

create table if not exists public.guest_grading_reservations (
  id uuid primary key default gen_random_uuid(),
  usage_id uuid not null references public.guest_grading_usage(id) on delete cascade,
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  status text not null default 'reserved'
    check (status in ('reserved', 'finalized', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  released_at timestamptz
);

create index if not exists guest_grading_reservations_active_idx
  on public.guest_grading_reservations (usage_id, status, expires_at);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('technical', 'account', 'content', 'accessibility', 'other')),
  message text not null check (char_length(message) between 20 and 4000),
  reply_email text check (reply_email is null or char_length(reply_email) <= 254),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.guest_grading_usage enable row level security;
alter table public.guest_grading_devices enable row level security;
alter table public.guest_grading_reservations enable row level security;
alter table public.support_requests enable row level security;

revoke all on public.guest_grading_usage from public, anon, authenticated;
revoke all on public.guest_grading_devices from public, anon, authenticated;
revoke all on public.guest_grading_reservations from public, anon, authenticated;
revoke all on public.support_requests from public, anon, authenticated;

grant select, insert, update, delete on public.guest_grading_usage to service_role;
grant select, insert, update, delete on public.guest_grading_devices to service_role;
grant select, insert, update, delete on public.guest_grading_reservations to service_role;
grant select, insert, update, delete on public.support_requests to service_role;

create or replace function public.reserve_guest_grade(
  p_device_hash text,
  p_recovery_hash text,
  p_request_key text,
  p_limit smallint default 3,
  p_reservation_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage_id uuid;
  v_candidate_id uuid;
  v_candidate_count integer;
  v_consumed integer;
  v_pending integer;
  v_reservation_id uuid;
begin
  if p_device_hash !~ '^[0-9a-f]{64}$'
     or p_recovery_hash !~ '^[0-9a-f]{64}$'
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or p_limit <> 3
     or p_reservation_seconds not between 60 and 300 then
    raise exception 'Invalid guest reservation input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guest-device:' || p_device_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('guest-recovery:' || p_recovery_hash, 0));

  if exists (
    select 1 from public.guest_grading_reservations where request_key = p_request_key
  ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'duplicate_request',
      'remaining', 0,
      'consumed', 0
    );
  end if;

  select usage_id into v_usage_id
  from public.guest_grading_devices
  where device_hash = p_device_hash
  for update;

  if v_usage_id is null then
    select count(*)
      into v_candidate_count
    from public.guest_grading_usage
    where recovery_hash = p_recovery_hash
      and last_seen_at >= now() - interval '30 days';

    if v_candidate_count = 1 then
      select id into v_candidate_id
      from public.guest_grading_usage
      where recovery_hash = p_recovery_hash
        and last_seen_at >= now() - interval '30 days'
      order by last_seen_at desc
      limit 1;
      v_usage_id := v_candidate_id;
    else
      insert into public.guest_grading_usage (recovery_hash)
      values (p_recovery_hash)
      returning id into v_usage_id;
    end if;

    insert into public.guest_grading_devices (device_hash, usage_id)
    values (p_device_hash, v_usage_id)
    on conflict (device_hash) do update
      set last_seen_at = now()
    returning usage_id into v_usage_id;
  end if;

  update public.guest_grading_devices
  set last_seen_at = now()
  where device_hash = p_device_hash;

  update public.guest_grading_usage
  set last_seen_at = now(),
      updated_at = now()
  where id = v_usage_id
  returning successful_grades into v_consumed;

  select count(*) into v_pending
  from public.guest_grading_reservations
  where usage_id = v_usage_id
    and status = 'reserved'
    and expires_at > now();

  if v_consumed + v_pending >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'limit_reached',
      'remaining', greatest(0, p_limit - v_consumed),
      'consumed', v_consumed
    );
  end if;

  insert into public.guest_grading_reservations (
    usage_id,
    request_key,
    expires_at
  )
  values (
    v_usage_id,
    p_request_key,
    now() + make_interval(secs => p_reservation_seconds)
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'remaining', greatest(0, p_limit - v_consumed - 1),
    'consumed', v_consumed
  );
end;
$$;

create or replace function public.finalize_guest_grade(
  p_reservation_id uuid,
  p_limit smallint default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage_id uuid;
  v_status text;
  v_expires_at timestamptz;
  v_consumed integer;
begin
  select usage_id, status, expires_at
    into v_usage_id, v_status, v_expires_at
  from public.guest_grading_reservations
  where id = p_reservation_id
  for update;

  if v_usage_id is null then
    raise exception 'Guest reservation not found';
  end if;
  if p_limit <> 3 then
    raise exception 'Invalid guest limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guest-usage:' || v_usage_id::text, 0));

  if v_status = 'reserved' then
    if v_expires_at <= now() then
      update public.guest_grading_reservations
      set status = 'released', released_at = now()
      where id = p_reservation_id;
      raise exception 'Guest reservation expired';
    end if;

    update public.guest_grading_usage
    set successful_grades = successful_grades + 1,
        last_seen_at = now(),
        updated_at = now()
    where id = v_usage_id
      and successful_grades < p_limit
    returning successful_grades into v_consumed;

    if v_consumed is null then
      raise exception 'Guest limit reached';
    end if;

    update public.guest_grading_reservations
    set status = 'finalized', finalized_at = now()
    where id = p_reservation_id;
  else
    select successful_grades into v_consumed
    from public.guest_grading_usage
    where id = v_usage_id;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, p_limit - v_consumed),
    'consumed', v_consumed
  );
end;
$$;

create or replace function public.release_guest_grade(
  p_reservation_id uuid
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.guest_grading_reservations
  set status = 'released',
      released_at = now()
  where id = p_reservation_id
    and status = 'reserved';
$$;

revoke all on function public.reserve_guest_grade(text, text, text, smallint, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_guest_grade(uuid, smallint)
  from public, anon, authenticated;
revoke all on function public.release_guest_grade(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_guest_grade(text, text, text, smallint, integer)
  to service_role;
grant execute on function public.finalize_guest_grade(uuid, smallint)
  to service_role;
grant execute on function public.release_guest_grade(uuid)
  to service_role;

comment on table public.guest_grading_usage is
  'Privacy-preserving authoritative guest quota. Stores keyed hashes only; never raw IP, user-agent, email, or answer text.';
comment on table public.support_requests is
  'Native support requests. Examination answers are rejected by the Worker and must not be submitted here.';
