-- Private-beta admission foundation.
--
-- This migration is additive. It does not enable the public gate by itself.
-- Runtime enforcement remains controlled by the Worker's
-- PRIVATE_BETA_GATE_ENABLED flag and must stay disabled until every release
-- gate in the private-beta launch plan has passed.

begin;

-- Ordinary admitted students receive the explicit beta_tester role. Existing
-- privileged roles are preserved by the admission function below.
alter table public.user_roles
  drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in (
    'student', 'beta_tester', 'admin', 'founder_admin', 'super_admin'
  ));

create table if not exists public.private_beta_settings (
  singleton boolean primary key default true check (singleton),
  disclosure_version text not null
    check (disclosure_version ~ '^beta-disclosure-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  pending_token_minutes integer not null default 15
    check (pending_token_minutes between 5 and 30),
  access_session_hours integer not null default 12
    check (access_session_hours = 12),
  flow_attempt_limit integer not null default 5
    check (flow_attempt_limit = 5),
  network_attempt_limit integer not null default 20
    check (network_attempt_limit = 20),
  code_window_seconds integer not null default 900
    check (code_window_seconds between 60 and 3600),
  code_block_seconds integer not null default 900
    check (code_block_seconds between 60 and 86400),
  updated_at timestamptz not null default now()
);

insert into public.private_beta_settings (
  singleton,
  disclosure_version,
  pending_token_minutes,
  access_session_hours,
  flow_attempt_limit,
  network_attempt_limit,
  code_window_seconds,
  code_block_seconds
)
values (
  true,
  'beta-disclosure-v1-2026-07-31',
  15,
  12,
  5,
  20,
  900,
  900
)
on conflict (singleton) do update
set disclosure_version = excluded.disclosure_version,
    pending_token_minutes = excluded.pending_token_minutes,
    access_session_hours = excluded.access_session_hours,
    flow_attempt_limit = excluded.flow_attempt_limit,
    network_attempt_limit = excluded.network_attempt_limit,
    code_window_seconds = excluded.code_window_seconds,
    code_block_seconds = excluded.code_block_seconds,
    updated_at = now();

create table if not exists public.private_beta_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  disclosure_version text not null,
  acknowledged_ai_limitations boolean not null
    check (acknowledged_ai_limitations),
  acknowledged_educational_only boolean not null
    check (acknowledged_educational_only),
  acknowledged_terms_and_privacy boolean not null
    check (acknowledged_terms_and_privacy),
  pending_jti_hash text not null unique
    check (pending_jti_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  unique (user_id, disclosure_version)
);

create index if not exists private_beta_acceptances_user_time_idx
  on public.private_beta_acceptances (user_id, accepted_at desc);

create table if not exists public.private_beta_pending_tokens (
  pending_jti_hash text primary key
    check (pending_jti_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  disclosure_version text not null,
  consumed_at timestamptz not null default now()
);

create index if not exists private_beta_pending_tokens_user_time_idx
  on public.private_beta_pending_tokens (user_id, consumed_at desc);

create table if not exists public.private_beta_admissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  admission_kind text not null
    check (admission_kind in ('founder', 'beta_tester')),
  disclosure_version text not null,
  admitted_at timestamptz not null default now(),
  access_expires_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  check (access_expires_at > admitted_at),
  check (access_expires_at <= admitted_at + interval '12 hours'),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index if not exists private_beta_admissions_status_expiry_idx
  on public.private_beta_admissions (status, access_expires_at);

create table if not exists public.private_beta_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  acceptance_id uuid not null
    references public.private_beta_acceptances(id) on delete restrict,
  access_jti_hash text not null unique
    check (access_jti_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > issued_at),
  check (expires_at = issued_at + interval '12 hours'),
  check (revoked_at is null or revoked_at >= issued_at)
);

create index if not exists private_beta_sessions_user_expiry_idx
  on public.private_beta_sessions (user_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.private_beta_code_attempts (
  scope text not null
    check (scope in ('flow', 'network')),
  subject_hash text not null
    check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, subject_hash)
);

alter table public.private_beta_settings enable row level security;
alter table public.private_beta_settings force row level security;
alter table public.private_beta_acceptances enable row level security;
alter table public.private_beta_acceptances force row level security;
alter table public.private_beta_pending_tokens enable row level security;
alter table public.private_beta_pending_tokens force row level security;
alter table public.private_beta_admissions enable row level security;
alter table public.private_beta_admissions force row level security;
alter table public.private_beta_sessions enable row level security;
alter table public.private_beta_sessions force row level security;
alter table public.private_beta_code_attempts enable row level security;
alter table public.private_beta_code_attempts force row level security;

revoke all on public.private_beta_settings
  from public, anon, authenticated;
revoke all on public.private_beta_acceptances
  from public, anon, authenticated;
revoke all on public.private_beta_pending_tokens
  from public, anon, authenticated;
revoke all on public.private_beta_admissions
  from public, anon, authenticated;
revoke all on public.private_beta_sessions
  from public, anon, authenticated;
revoke all on public.private_beta_code_attempts
  from public, anon, authenticated;

grant select, insert, update, delete on public.private_beta_settings
  to service_role;
grant select, insert, update, delete on public.private_beta_acceptances
  to service_role;
grant select, insert, update, delete on public.private_beta_pending_tokens
  to service_role;
grant select, insert, update, delete on public.private_beta_admissions
  to service_role;
grant select, insert, update, delete on public.private_beta_sessions
  to service_role;
grant select, insert, update, delete on public.private_beta_code_attempts
  to service_role;

create or replace function public.private_beta_evaluate_code_attempt(
  p_flow_hash text,
  p_network_hash text,
  p_code_valid boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.private_beta_settings%rowtype;
  v_row public.private_beta_code_attempts%rowtype;
  v_scope text;
  v_subject_hash text;
  v_attempt_limit integer;
  v_attempt_count integer;
  v_blocked_until timestamptz;
  v_any_blocked boolean := false;
  v_retry_after_seconds integer := 0;
begin
  if p_flow_hash is null
     or p_flow_hash !~ '^[0-9a-f]{64}$'
     or p_network_hash is null
     or p_network_hash !~ '^[0-9a-f]{64}$'
     or p_code_valid is null then
    raise exception 'PRIVATE_BETA_RATE_SUBJECT_INVALID';
  end if;
  select *
  into strict v_settings
  from public.private_beta_settings
  where singleton = true;

  for v_scope, v_subject_hash, v_attempt_limit in
    select *
    from (
      values
        ('flow'::text, p_flow_hash, v_settings.flow_attempt_limit),
        ('network'::text, p_network_hash, v_settings.network_attempt_limit)
    ) limits(scope, subject_hash, attempt_limit)
    order by scope
  loop
    -- Create each durable counter before locking it. ON CONFLICT makes
    -- concurrent first attempts serialize safely instead of leaking a
    -- unique-key failure.
    insert into public.private_beta_code_attempts (
      scope,
      subject_hash,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    )
    values (v_scope, v_subject_hash, v_now, 0, null, v_now)
    on conflict (scope, subject_hash) do nothing;

    select *
    into strict v_row
    from public.private_beta_code_attempts
    where scope = v_scope
      and subject_hash = v_subject_hash
    for update;

    if v_row.window_started_at <=
       v_now - make_interval(secs => v_settings.code_window_seconds) then
      update public.private_beta_code_attempts
      set window_started_at = v_now,
          attempt_count = 0,
          blocked_until = null,
          updated_at = v_now
      where scope = v_scope
        and subject_hash = v_subject_hash;
      v_row.window_started_at := v_now;
      v_row.attempt_count := 0;
      v_row.blocked_until := null;
    end if;

    if v_row.blocked_until is not null
       and v_row.blocked_until > v_now then
      v_any_blocked := true;
      v_retry_after_seconds := greatest(
        v_retry_after_seconds,
        greatest(
          1,
          ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer
        )
      );
      continue;
    end if;

    if not p_code_valid then
      v_attempt_count := v_row.attempt_count + 1;
      v_blocked_until := case
        when v_attempt_count >= v_attempt_limit
          then v_now + make_interval(secs => v_settings.code_block_seconds)
        else null
      end;

      update public.private_beta_code_attempts
      set attempt_count = v_attempt_count,
          blocked_until = v_blocked_until,
          updated_at = v_now
      where scope = v_scope
        and subject_hash = v_subject_hash;

      if v_blocked_until is not null then
        v_any_blocked := true;
        v_retry_after_seconds := greatest(
          v_retry_after_seconds,
          v_settings.code_block_seconds
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'allowed', p_code_valid and not v_any_blocked,
    'blocked', v_any_blocked,
    'retryAfterSeconds', case
      when v_any_blocked then v_retry_after_seconds
      else null
    end
  );
end;
$$;

create or replace function public.private_beta_complete_admission(
  p_user_id uuid,
  p_disclosure_version text,
  p_pending_jti_hash text,
  p_access_jti_hash text,
  p_acknowledged_ai_limitations boolean,
  p_acknowledged_educational_only boolean,
  p_acknowledged_terms_and_privacy boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.private_beta_settings%rowtype;
  v_current_role text := 'student';
  v_admission_kind text := 'beta_tester';
  v_expires_at timestamptz;
  v_acceptance_id uuid;
  v_terms_version text;
  v_privacy_version text;
  v_previous_free_beta_state jsonb := '{}'::jsonb;
  v_current_free_beta_state jsonb := '{}'::jsonb;
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'PRIVATE_BETA_AUTH_REQUIRED';
  end if;

  select *
  into strict v_settings
  from public.private_beta_settings
  where singleton = true;

  if p_disclosure_version is distinct from v_settings.disclosure_version then
    raise exception 'PRIVATE_BETA_DISCLOSURE_OUTDATED';
  end if;
  if not coalesce(p_acknowledged_ai_limitations, false)
     or not coalesce(p_acknowledged_educational_only, false)
     or not coalesce(p_acknowledged_terms_and_privacy, false) then
    raise exception 'PRIVATE_BETA_ACKNOWLEDGMENTS_REQUIRED';
  end if;
  if p_pending_jti_hash is null
     or p_pending_jti_hash !~ '^[0-9a-f]{64}$'
     or p_access_jti_hash is null
     or p_access_jti_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PRIVATE_BETA_TOKEN_REFERENCE_INVALID';
  end if;

  insert into public.private_beta_pending_tokens (
    pending_jti_hash,
    user_id,
    disclosure_version,
    consumed_at
  )
  values (
    p_pending_jti_hash,
    p_user_id,
    p_disclosure_version,
    v_now
  )
  on conflict (pending_jti_hash) do nothing;
  if not found then
    raise exception 'PRIVATE_BETA_FLOW_ALREADY_USED';
  end if;

  select coalesce(role, 'student')
  into v_current_role
  from public.user_roles
  where user_id = p_user_id;
  v_current_role := coalesce(v_current_role, 'student');

  if v_current_role in ('founder_admin', 'super_admin') then
    v_admission_kind := 'founder';
  elsif v_current_role not in ('admin') then
    insert into public.user_roles (
      user_id,
      role,
      assigned_by,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      'beta_tester',
      p_user_id,
      v_now,
      v_now
    )
    on conflict (user_id) do update
    set role = 'beta_tester',
        assigned_by = excluded.assigned_by,
        updated_at = excluded.updated_at
    where public.user_roles.role not in (
      'admin', 'founder_admin', 'super_admin'
    );
  end if;

  v_expires_at := v_now + make_interval(hours => v_settings.access_session_hours);

  select current_terms_version, current_privacy_version
  into strict v_terms_version, v_privacy_version
  from public.platform_access_settings
  where singleton = true;

  insert into public.terms_acceptances (
    user_id,
    terms_version,
    privacy_version,
    accepted_at,
    acceptance_source
  )
  values (
    p_user_id,
    v_terms_version,
    v_privacy_version,
    v_now,
    'private_beta_admission'
  )
  on conflict (user_id, terms_version, privacy_version) do nothing;

  insert into public.private_beta_acceptances (
    user_id,
    disclosure_version,
    acknowledged_ai_limitations,
    acknowledged_educational_only,
    acknowledged_terms_and_privacy,
    pending_jti_hash,
    accepted_at
  )
  values (
    p_user_id,
    p_disclosure_version,
    true,
    true,
    true,
    p_pending_jti_hash,
    v_now
  )
  on conflict (user_id, disclosure_version) do update
  set acknowledged_ai_limitations = true,
      acknowledged_educational_only = true,
      acknowledged_terms_and_privacy = true,
      pending_jti_hash = excluded.pending_jti_hash,
      accepted_at = excluded.accepted_at
  returning id into v_acceptance_id;

  update public.private_beta_sessions
  set revoked_at = v_now
  where user_id = p_user_id
    and revoked_at is null
    and expires_at > v_now;

  insert into public.private_beta_sessions (
    user_id,
    acceptance_id,
    access_jti_hash,
    issued_at,
    expires_at,
    created_at
  )
  values (
    p_user_id,
    v_acceptance_id,
    p_access_jti_hash,
    v_now,
    v_expires_at,
    v_now
  );

  insert into public.private_beta_admissions (
    user_id,
    status,
    admission_kind,
    disclosure_version,
    admitted_at,
    access_expires_at,
    revoked_at,
    updated_at
  )
  values (
    p_user_id,
    'active',
    v_admission_kind,
    p_disclosure_version,
    v_now,
    v_expires_at,
    null,
    v_now
  )
  on conflict (user_id) do update
  set status = 'active',
      admission_kind = excluded.admission_kind,
      disclosure_version = excluded.disclosure_version,
      admitted_at = excluded.admitted_at,
      access_expires_at = excluded.access_expires_at,
      revoked_at = null,
      updated_at = excluded.updated_at;

  select jsonb_build_object(
    'enabled', enabled,
    'expiresAt', expires_at,
    'reason', reason
  )
  into v_previous_free_beta_state
  from public.free_beta_access
  where user_id = p_user_id;
  v_previous_free_beta_state :=
    coalesce(v_previous_free_beta_state, '{}'::jsonb);

  insert into public.free_beta_access (
    user_id,
    enabled,
    expires_at,
    reason,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  values (
    p_user_id,
    true,
    v_expires_at,
    'Verified private-beta admission',
    v_now,
    p_user_id,
    v_now,
    p_user_id
  )
  on conflict (user_id) do update
  set enabled = true,
      expires_at = case
        when public.free_beta_access.enabled
             and (
               public.free_beta_access.expires_at is null
               or public.free_beta_access.expires_at > excluded.expires_at
             )
          then public.free_beta_access.expires_at
        else excluded.expires_at
      end,
      reason = case
        when public.free_beta_access.enabled
             and (
               public.free_beta_access.expires_at is null
               or public.free_beta_access.expires_at > excluded.expires_at
             )
          then public.free_beta_access.reason
        else excluded.reason
      end,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  returning jsonb_build_object(
    'enabled', enabled,
    'expiresAt', expires_at,
    'reason', reason
  )
  into v_current_free_beta_state;

  insert into public.free_beta_access_history (
    user_id,
    actor_user_id,
    previous_state,
    new_state,
    reason,
    request_key,
    occurred_at
  )
  values (
    p_user_id,
    p_user_id,
    v_previous_free_beta_state,
    v_current_free_beta_state
      || jsonb_build_object('source', 'private_beta_admission'),
    'Verified private-beta admission',
    p_access_jti_hash,
    v_now
  )
  on conflict (request_key) do nothing;

  insert into public.examination_beta_access (
    user_id,
    enabled,
    expires_at,
    granted_by,
    reason,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    true,
    v_expires_at,
    p_user_id,
    'Verified private-beta admission',
    v_now,
    v_now
  )
  on conflict (user_id) do update
  set enabled = true,
      expires_at = case
        when public.examination_beta_access.enabled
             and (
               public.examination_beta_access.expires_at is null
               or public.examination_beta_access.expires_at > excluded.expires_at
             )
          then public.examination_beta_access.expires_at
        else excluded.expires_at
      end,
      granted_by = case
        when public.examination_beta_access.enabled
             and (
               public.examination_beta_access.expires_at is null
               or public.examination_beta_access.expires_at > excluded.expires_at
             )
          then public.examination_beta_access.granted_by
        else excluded.granted_by
      end,
      reason = case
        when public.examination_beta_access.enabled
             and (
               public.examination_beta_access.expires_at is null
               or public.examination_beta_access.expires_at > excluded.expires_at
             )
          then public.examination_beta_access.reason
        else excluded.reason
      end,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'admitted', true,
    'admissionKind', v_admission_kind,
    'disclosureVersion', p_disclosure_version,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.private_beta_access_snapshot(
  p_user_id uuid,
  p_access_jti_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.private_beta_settings%rowtype;
  v_admission public.private_beta_admissions%rowtype;
  v_session public.private_beta_sessions%rowtype;
  v_role text := 'student';
  v_allowed boolean := false;
begin
  if p_user_id is null
     or p_access_jti_hash is null
     or p_access_jti_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('allowed', false);
  end if;

  select *
  into strict v_settings
  from public.private_beta_settings
  where singleton = true;

  select *
  into v_admission
  from public.private_beta_admissions
  where user_id = p_user_id;

  select *
  into v_session
  from public.private_beta_sessions
  where user_id = p_user_id
    and access_jti_hash = p_access_jti_hash
    and revoked_at is null
    and expires_at > v_now;

  select coalesce(role, 'student')
  into v_role
  from public.user_roles
  where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  v_allowed :=
    v_admission.user_id is not null
    and v_session.id is not null
    and v_admission.status = 'active'
    and v_admission.access_expires_at > v_now
    and v_admission.disclosure_version = v_settings.disclosure_version
    and exists (
      select 1
      from public.private_beta_acceptances a
      where a.id = v_session.acceptance_id
        and a.user_id = p_user_id
        and a.disclosure_version = v_settings.disclosure_version
    )
    and (
      (
        v_admission.admission_kind = 'founder'
        and v_role in ('founder_admin', 'super_admin')
      )
      or (
        v_admission.admission_kind = 'beta_tester'
        and v_role in ('beta_tester', 'admin')
      )
    );

  return jsonb_build_object(
    'allowed', v_allowed,
    'admissionKind', case when v_allowed then v_admission.admission_kind else null end,
    'disclosureVersion', v_settings.disclosure_version,
    'expiresAt', case when v_allowed then v_session.expires_at else null end
  );
end;
$$;

revoke all on function public.private_beta_evaluate_code_attempt(
  text, text, boolean
)
  from public, anon, authenticated;
revoke all on function public.private_beta_complete_admission(
  uuid, text, text, text, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.private_beta_access_snapshot(
  uuid, text
) from public, anon, authenticated;

grant execute on function public.private_beta_evaluate_code_attempt(
  text, text, boolean
)
  to service_role;
grant execute on function public.private_beta_complete_admission(
  uuid, text, text, text, boolean, boolean, boolean
) to service_role;
grant execute on function public.private_beta_access_snapshot(
  uuid, text
) to service_role;

commit;
