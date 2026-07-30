-- Staging-only verification for active-time accounting.
-- The transaction is always rolled back and creates no durable records.

begin;
set local search_path = public, extensions, auth, pg_temp;

select plan(21);

select has_function(
  'public',
  'examination_active_elapsed_seconds',
  array['integer', 'timestamp with time zone', 'timestamp with time zone'],
  'active elapsed helper exists'
);

select has_function(
  'public',
  'examination_guard_active_elapsed_seconds',
  array[]::text[],
  'active elapsed trigger function exists'
);

select has_trigger(
  'public',
  'examination_attempts_multi',
  'examination_active_time_guard',
  'attempt table has the active-time trigger'
);

select is(
  public.examination_active_elapsed_seconds(
    100,
    '2026-07-31 00:00:00+00'::timestamptz,
    '2026-07-31 00:00:30+00'::timestamptz
  ),
  130,
  'a normal 30-second heartbeat advances active time'
);

select is(
  public.examination_active_elapsed_seconds(
    100,
    '2026-07-31 00:00:00+00'::timestamptz,
    '2026-07-31 00:00:45+00'::timestamptz
  ),
  145,
  'the bounded 45-second jitter allowance advances active time'
);

select is(
  public.examination_active_elapsed_seconds(
    100,
    '2026-07-31 00:00:00+00'::timestamptz,
    '2026-07-31 00:00:46+00'::timestamptz
  ),
  100,
  'a hidden or disconnected interval over 45 seconds is excluded'
);

select is(
  public.examination_active_elapsed_seconds(
    100,
    '2026-07-31 00:05:00+00'::timestamptz,
    '2026-07-31 00:00:00+00'::timestamptz
  ),
  100,
  'a backwards timestamp cannot reduce or increase active time'
);

select is(
  public.examination_active_elapsed_seconds(
    -100,
    null,
    '2026-07-31 00:00:00+00'::timestamptz
  ),
  0,
  'invalid negative input is normalized safely'
);

select function_privs_are(
  'public',
  'examination_active_elapsed_seconds',
  array['integer', 'timestamp with time zone', 'timestamp with time zone'],
  'anon',
  array[]::text[],
  'anon cannot call the active-time helper'
);

select function_privs_are(
  'public',
  'examination_active_elapsed_seconds',
  array['integer', 'timestamp with time zone', 'timestamp with time zone'],
  'authenticated',
  array[]::text[],
  'authenticated clients cannot call the active-time helper'
);

select function_privs_are(
  'public',
  'examination_guard_active_elapsed_seconds',
  array[]::text[],
  'anon',
  array[]::text[],
  'anon cannot call the trigger function'
);

select function_privs_are(
  'public',
  'examination_guard_active_elapsed_seconds',
  array[]::text[],
  'authenticated',
  array[]::text[],
  'authenticated clients cannot call the trigger function'
);

select ok(
  position(
    'p_attempt.elapsed_seconds'
    in pg_get_functiondef(
      'public.examination_attempt_summary(public.examination_attempts_multi)'::regprocedure
    )
  ) > 0,
  'attempt summaries return the stored elapsed counter'
);

select ok(
  position(
    'now() - p_attempt.started_at'
    in pg_get_functiondef(
      'public.examination_attempt_summary(public.examination_attempts_multi)'::regprocedure
    )
  ) = 0,
  'attempt summaries do not derive self-paced time from wall-clock age'
);

select is(
  public.examination_active_elapsed_seconds(
    2147483640,
    '2026-07-31 00:00:00+00'::timestamptz,
    '2026-07-31 00:00:30+00'::timestamptz
  ),
  2147483647,
  'the active counter cannot overflow an integer'
);

select function_privs_are(
  'public',
  'examination_attempt_summary',
  array['public.examination_attempts_multi'],
  'authenticated',
  array[]::text[],
  'attempt summaries remain backend-only'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '96000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'active-selfpaced@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
  ),
  (
    '96000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'active-strict@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
  ),
  (
    '96000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'active-none@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
  );

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, last_activity_at,
  last_heartbeat_at, active_tab_hash, tab_lease_until, elapsed_seconds,
  start_request_key
)
values (
  '96000000-0000-4000-8000-000000000011'::uuid,
  '96000000-0000-4000-8000-000000000001'::uuid,
  (select id from public.examination_versions order by created_at, id limit 1),
  'selfPaced', 'in_progress',
  '2026-07-31 00:00:00+00', '2026-07-31 00:00:00+00',
  '2026-07-31 00:00:00+00', repeat('a', 64),
  '2026-07-31 00:01:30+00', 100, 'active_time_selfpaced_20260731'
);

update public.examination_attempts_multi
set last_heartbeat_at = '2026-07-31 00:00:30+00',
    elapsed_seconds = 999,
    updated_at = '2026-07-31 00:00:30+00'
where id = '96000000-0000-4000-8000-000000000011'::uuid;

select is(
  (
    select elapsed_seconds
    from public.examination_attempts_multi
    where id = '96000000-0000-4000-8000-000000000011'::uuid
  ),
  130,
  'the row trigger replaces wall-clock input with a normal active heartbeat delta'
);

update public.examination_attempts_multi
set last_heartbeat_at = '2026-07-31 00:05:00+00',
    elapsed_seconds = 999,
    updated_at = '2026-07-31 00:05:00+00'
where id = '96000000-0000-4000-8000-000000000011'::uuid;

select is(
  (
    select elapsed_seconds
    from public.examination_attempts_multi
    where id = '96000000-0000-4000-8000-000000000011'::uuid
  ),
  130,
  'the row trigger excludes a hidden or disconnected interval'
);

select is(
  (
    select (
      public.examination_attempt_summary(a)->>'elapsedSeconds'
    )::integer
    from public.examination_attempts_multi a
    where a.id = '96000000-0000-4000-8000-000000000011'::uuid
  ),
  130,
  'the rendered attempt returns the stored active-time counter'
);

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, deadline_at,
  last_activity_at, last_heartbeat_at, active_tab_hash, tab_lease_until,
  elapsed_seconds, start_request_key
)
values (
  '96000000-0000-4000-8000-000000000012'::uuid,
  '96000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.examination_versions order by created_at, id limit 1),
  'strict', 'in_progress',
  '2026-07-31 00:00:00+00', '2026-07-31 01:00:00+00',
  '2026-07-31 00:00:00+00', '2026-07-31 00:00:00+00',
  repeat('b', 64), '2026-07-31 00:01:30+00',
  100, 'active_time_strict_20260731'
);

update public.examination_attempts_multi
set last_heartbeat_at = '2026-07-31 00:05:00+00',
    elapsed_seconds = 300
where id = '96000000-0000-4000-8000-000000000012'::uuid;

select is(
  (
    select elapsed_seconds
    from public.examination_attempts_multi
    where id = '96000000-0000-4000-8000-000000000012'::uuid
  ),
  300,
  'strict timer accounting is unchanged'
);

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, last_activity_at,
  last_heartbeat_at, active_tab_hash, tab_lease_until, elapsed_seconds,
  start_request_key
)
values (
  '96000000-0000-4000-8000-000000000013'::uuid,
  '96000000-0000-4000-8000-000000000003'::uuid,
  (select id from public.examination_versions order by created_at, id limit 1),
  'none', 'in_progress',
  '2026-07-31 00:00:00+00', '2026-07-31 00:00:00+00',
  '2026-07-31 00:00:00+00', repeat('c', 64),
  '2026-07-31 00:01:30+00', 100, 'active_time_none_20260731'
);

update public.examination_attempts_multi
set last_heartbeat_at = '2026-07-31 00:05:00+00',
    elapsed_seconds = 300
where id = '96000000-0000-4000-8000-000000000013'::uuid;

select is(
  (
    select elapsed_seconds
    from public.examination_attempts_multi
    where id = '96000000-0000-4000-8000-000000000013'::uuid
  ),
  300,
  'untimed examination accounting is unchanged'
);

select * from finish();
rollback;
