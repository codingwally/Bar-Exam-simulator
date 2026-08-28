-- Classify the explicitly approved internal/test identities independently of
-- authentication and authorization. Reporting functions use immutable Auth
-- user ids; no role, entitlement, payment, answer, or usage row is mutated.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.internal_test_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_at_classification text not null,
  classification_source text not null,
  classified_at timestamptz not null default clock_timestamp(),
  constraint internal_test_accounts_email_normalized_check
    check (email_at_classification = lower(btrim(email_at_classification))),
  constraint internal_test_accounts_source_not_blank_check
    check (nullif(btrim(classification_source), '') is not null)
);

create unique index if not exists internal_test_accounts_email_at_classification_key
  on private.internal_test_accounts (email_at_classification);

alter table private.internal_test_accounts enable row level security;
alter table private.internal_test_accounts force row level security;

revoke all on table private.internal_test_accounts
  from public, anon, authenticated, service_role;

comment on table private.internal_test_accounts is
  'Private immutable-user-id registry for explicitly approved internal/test reporting identities. It does not grant administrator access or alter product entitlements.';

create or replace function private.require_admin_data_scope(
  p_data_scope text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_scope text := lower(btrim(coalesce(p_data_scope, '')));
begin
  if v_scope not in ('regular', 'internal_test') then
    raise exception 'Valid data scope required';
  end if;
  return v_scope;
end;
$$;

create or replace function private.admin_reporting_scope_matches(
  p_user_id uuid,
  p_data_scope text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.require_admin_data_scope(p_data_scope);
  v_internal boolean := false;
begin
  if p_user_id is not null then
    select exists (
      select 1
      from private.internal_test_accounts classified
      where classified.user_id = p_user_id
    ) into v_internal;
  end if;

  if v_scope = 'internal_test' then
    return p_user_id is not null and v_internal;
  end if;

  -- Anonymous and genuinely unattributed activity remains in regular data.
  return not v_internal;
end;
$$;

create or replace function private.admin_learner_reporting_scope_matches(
  p_user_id uuid,
  p_data_scope text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.require_admin_data_scope(p_data_scope);
begin
  if v_scope = 'internal_test' then
    return private.admin_reporting_scope_matches(p_user_id, v_scope);
  end if;

  return private.admin_reporting_scope_matches(p_user_id, v_scope)
    and case
      when p_user_id is null then true
      else coalesce((
        select role_row.role::text
        from public.user_roles role_row
        where role_row.user_id = p_user_id
      ), 'student') not in ('admin', 'founder_admin', 'super_admin')
    end;
end;
$$;

-- For usage events, the event owner is authoritative. Only when that owner is
-- absent may the linked session owner classify the row. Visitor and anonymous
-- identifiers are deliberately excluded because they are not immutable users.
create or replace function private.admin_usage_event_owner(
  p_event_user_id uuid,
  p_session_user_id uuid
)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_event_user_id, p_session_user_id)
$$;

create or replace function private.admin_scoped_usage_events(
  p_data_scope text
)
returns setof public.usage_events
language sql
stable
security definer
set search_path = ''
as $$
  select event_row.*
  from public.usage_events event_row
  left join public.usage_sessions session_row
    on session_row.id = event_row.session_id
  where private.admin_learner_reporting_scope_matches(
    private.admin_usage_event_owner(event_row.user_id, session_row.user_id),
    p_data_scope
  )
$$;

create or replace function private.admin_scoped_usage_sessions(
  p_data_scope text
)
returns setof public.usage_sessions
language sql
stable
security definer
set search_path = ''
as $$
  select session_row.*
  from public.usage_sessions session_row
  where private.admin_learner_reporting_scope_matches(
    session_row.user_id,
    p_data_scope
  )
$$;

-- This one-shot resolver is intentionally private and is not executable by
-- API roles. A deployment data step calls it only after the target environment
-- is confirmed to contain all seven approved Auth identities. It is atomic:
-- any missing or non-unique email raises before the first registry write.
create or replace function private.seed_internal_test_accounts_20260828()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected constant text[] := array[
    'wallyesteban1993@gmail.com',
    'tc.mdppa@gmail.com',
    'orientalmindorodebsoc@gmail.com',
    'gilmardecastro05@gmail.com',
    'titanpatrol6969@gmail.com',
    'support.duediligence@gmail.com',
    'perezemricoluiz@gmail.com'
  ];
  v_invalid text[];
  v_total_matches integer := 0;
  v_inserted integer := 0;
begin
  if cardinality(v_expected) <> 7
     or (select count(distinct expected_email)
         from unnest(v_expected) expected(expected_email)) <> 7 then
    raise exception 'Internal/test seed manifest must contain exactly seven unique emails';
  end if;

  select
    coalesce(sum(match_count.matches), 0)::integer,
    array_agg(match_count.expected_email order by match_count.expected_email)
      filter (where match_count.matches <> 1)
  into v_total_matches, v_invalid
  from (
    select expected.expected_email, count(user_row.id)::integer as matches
    from unnest(v_expected) expected(expected_email)
    left join auth.users user_row
      on lower(btrim(coalesce(user_row.email, ''))) = expected.expected_email
    group by expected.expected_email
  ) match_count;

  -- Fresh, preview, and staging databases intentionally contain none of the
  -- production identities. A zero match is therefore a portable no-op.
  if v_total_matches = 0 then
    return 0;
  end if;

  if v_total_matches <> 7 or coalesce(cardinality(v_invalid), 0) <> 0 then
    raise exception 'Internal/test seed requires exactly one Auth identity for each approved email; unresolved emails: %',
      coalesce(array_to_string(v_invalid, ', '), 'duplicate Auth identities');
  end if;

  insert into private.internal_test_accounts (
    user_id,
    email_at_classification,
    classification_source
  )
  select
    user_row.id,
    expected.expected_email,
    'owner_allowlist_20260828'
  from unnest(v_expected) expected(expected_email)
  join auth.users user_row
    on lower(btrim(coalesce(user_row.email, ''))) = expected.expected_email
  on conflict (user_id) do update
  set email_at_classification = excluded.email_at_classification,
      classification_source = excluded.classification_source;

  get diagnostics v_inserted = row_count;

  if (
    select count(*)
    from private.internal_test_accounts classified
    where classified.classification_source = 'owner_allowlist_20260828'
      and classified.email_at_classification = any(v_expected)
  ) <> 7 then
    raise exception 'Internal/test seed verification failed';
  end if;

  return v_inserted;
end;
$$;

select private.seed_internal_test_accounts_20260828();

revoke all on function private.require_admin_data_scope(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_reporting_scope_matches(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_learner_reporting_scope_matches(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_usage_event_owner(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_scoped_usage_events(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_scoped_usage_sessions(text)
  from public, anon, authenticated, service_role;
revoke all on function private.seed_internal_test_accounts_20260828()
  from public, anon, authenticated, service_role;

commit;
