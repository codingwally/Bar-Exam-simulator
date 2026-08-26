-- Due Diligence Release 2: durable cleanup for replaced private profile photos.
begin;

create table if not exists public.forum_profile_avatar_cleanup_jobs (
  object_path text primary key,
  user_id uuid references auth.users(id) on delete set null,
  not_before timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000000),
  last_attempt_at timestamptz,
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (object_path ~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$')
);

create index if not exists forum_profile_avatar_cleanup_jobs_queued_idx
  on public.forum_profile_avatar_cleanup_jobs (not_before, queued_at, object_path);
create index if not exists forum_profile_avatar_cleanup_jobs_user_idx
  on public.forum_profile_avatar_cleanup_jobs (user_id)
  where user_id is not null;

alter table public.forum_profile_avatar_cleanup_jobs enable row level security;
alter table public.forum_profile_avatar_cleanup_jobs force row level security;
revoke all on public.forum_profile_avatar_cleanup_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.forum_profile_avatar_cleanup_jobs to service_role;

create or replace function public.forum_set_profile_avatar(
  p_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_path text;
  v_path text := pg_catalog.btrim(coalesce(p_payload->>'objectPath', ''));
begin
  perform public.forum_assert_member(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 74192)
  );

  if v_path !~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$'
    or p_payload->>'mimeType' not in ('image/jpeg', 'image/png', 'image/webp')
    or coalesce((p_payload->>'byteSize')::integer, 0) not between 1 and 5242880
    or coalesce((p_payload->>'width')::integer, 0) not between 256 and 4096
    or coalesce((p_payload->>'height')::integer, 0) not between 256 and 4096
  then
    raise exception 'FORUM_AVATAR_INVALID';
  end if;

  select avatar.object_path
  into v_old_path
  from public.forum_profile_avatars as avatar
  where avatar.user_id = p_user_id
  for update;

  if v_old_path is not null and v_old_path <> v_path then
    insert into public.forum_profile_avatar_cleanup_jobs (
      object_path,
      user_id,
      not_before,
      queued_at,
      updated_at
    ) values (
      v_old_path,
      p_user_id,
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now()
    )
    on conflict (object_path) do update
    set user_id = excluded.user_id,
        not_before = pg_catalog.now(),
        attempt_count = 0,
        last_attempt_at = null,
        updated_at = pg_catalog.now();
  end if;

  insert into public.forum_profile_avatars (
    user_id,
    object_path,
    mime_type,
    byte_size,
    width,
    height,
    crop_x,
    crop_y,
    updated_at
  ) values (
    p_user_id,
    v_path,
    p_payload->>'mimeType',
    (p_payload->>'byteSize')::integer,
    (p_payload->>'width')::integer,
    (p_payload->>'height')::integer,
    coalesce((p_payload->>'cropX')::numeric, 0.5),
    coalesce((p_payload->>'cropY')::numeric, 0.5),
    pg_catalog.now()
  )
  on conflict (user_id) do update
  set object_path = excluded.object_path,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size,
      width = excluded.width,
      height = excluded.height,
      crop_x = excluded.crop_x,
      crop_y = excluded.crop_y,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'updated', true,
    'avatarPath', v_path,
    'previousPath', v_old_path,
    'cleanupQueued', v_old_path is not null and v_old_path <> v_path
  );
end;
$$;

create or replace function public.forum_enqueue_profile_avatar_cleanup_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.forum_profile_avatar_cleanup_jobs (
    object_path,
    user_id,
    not_before,
    queued_at,
    updated_at
  ) values (
    old.object_path,
    null,
    pg_catalog.now() + interval '10 minutes',
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (object_path) do update
  set user_id = excluded.user_id,
      not_before = pg_catalog.now(),
      attempt_count = 0,
      last_attempt_at = null,
      updated_at = pg_catalog.now();
  return old;
end;
$$;

create or replace function public.forum_defer_profile_avatar_cleanup(
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := pg_catalog.btrim(coalesce(p_object_path, ''));
  v_attempt_count integer;
begin
  if v_path !~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$' then
    raise exception 'FORUM_AVATAR_CLEANUP_INVALID';
  end if;

  update public.forum_profile_avatar_cleanup_jobs as cleanup
  set attempt_count = cleanup.attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      not_before = pg_catalog.now() + case cleanup.attempt_count
        when 0 then interval '30 seconds'
        when 1 then interval '1 minute'
        when 2 then interval '2 minutes'
        when 3 then interval '4 minutes'
        when 4 then interval '8 minutes'
        when 5 then interval '16 minutes'
        else interval '1 hour'
      end,
      updated_at = pg_catalog.now()
  where cleanup.object_path = v_path
  returning cleanup.attempt_count into v_attempt_count;

  if not found then
    return pg_catalog.jsonb_build_object('state', 'missing');
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'deferred',
    'attemptCount', v_attempt_count
  );
end;
$$;

drop trigger if exists forum_profile_avatar_cleanup_on_delete
  on public.forum_profile_avatars;
create trigger forum_profile_avatar_cleanup_on_delete
before delete on public.forum_profile_avatars
for each row execute function public.forum_enqueue_profile_avatar_cleanup_on_delete();

create or replace function public.forum_profile_avatar_cleanup_state(
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := pg_catalog.btrim(coalesce(p_object_path, ''));
  v_user_id uuid;
  v_active_path text;
begin
  if v_path !~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$' then
    raise exception 'FORUM_AVATAR_CLEANUP_INVALID';
  end if;

  select cleanup.user_id
  into v_user_id
  from public.forum_profile_avatar_cleanup_jobs as cleanup
  where cleanup.object_path = v_path;

  if not found then
    return pg_catalog.jsonb_build_object('state', 'missing');
  end if;

  if v_user_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text, 74192)
    );
  end if;

  select cleanup.user_id
  into v_user_id
  from public.forum_profile_avatar_cleanup_jobs as cleanup
  where cleanup.object_path = v_path
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('state', 'missing');
  end if;

  if v_user_id is not null then
    select avatar.object_path
    into v_active_path
    from public.forum_profile_avatars as avatar
    where avatar.user_id = v_user_id;
  end if;

  if v_active_path = v_path then
    delete from public.forum_profile_avatar_cleanup_jobs as cleanup
    where cleanup.object_path = v_path;
    return pg_catalog.jsonb_build_object('state', 'active');
  end if;

  return pg_catalog.jsonb_build_object('state', 'safe');
end;
$$;

revoke all on function public.forum_set_profile_avatar(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.forum_set_profile_avatar(uuid, jsonb)
  to service_role;
revoke all on function public.forum_profile_avatar_cleanup_state(text)
  from public, anon, authenticated;
grant execute on function public.forum_profile_avatar_cleanup_state(text)
  to service_role;
revoke all on function public.forum_defer_profile_avatar_cleanup(text)
  from public, anon, authenticated;
grant execute on function public.forum_defer_profile_avatar_cleanup(text)
  to service_role;
revoke all on function public.forum_enqueue_profile_avatar_cleanup_on_delete()
  from public, anon, authenticated;

commit;
