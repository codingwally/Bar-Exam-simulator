-- One reversible, founder-controlled Beta All Access policy for every current
-- and future non-anonymous authenticated account. Existing trials, per-user
-- beta grants, subscriptions, and private-beta admissions remain intact as the
-- fallback policy when this global switch is disabled.

begin;

alter table public.platform_access_settings
  add column if not exists global_beta_all_access_enabled boolean not null default true,
  add column if not exists global_beta_all_access_updated_at timestamptz not null default now(),
  add column if not exists global_beta_all_access_updated_by uuid
    references auth.users(id) on delete set null,
  add column if not exists global_beta_all_access_version bigint not null default 1
    check (global_beta_all_access_version >= 1);

-- The new NOT NULL column's TRUE default initializes the existing singleton
-- row and future fresh installs. Do not issue an unconditional UPDATE here:
-- migration replays must preserve a founder's later decision to disable the
-- global policy instead of silently turning it back on.

create table if not exists public.global_beta_all_access_history (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  previous_enabled boolean not null,
  enabled boolean not null,
  version bigint not null check (version >= 1),
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now()
);

alter table public.global_beta_all_access_history enable row level security;
alter table public.global_beta_all_access_history force row level security;
revoke all on public.global_beta_all_access_history from public, anon, authenticated;
grant select, insert on public.global_beta_all_access_history to service_role;

create or replace function public.phase4_global_beta_identity_eligible(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.global_beta_all_access_enabled
    from public.platform_access_settings s
    where s.singleton = true
  ), false)
  and exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and coalesce(u.is_anonymous, false) = false
  )
$$;

create or replace function public.phase4_has_current_legal_acceptance(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_access_settings s
    join public.terms_acceptances t
      on t.user_id = p_user_id
     and t.terms_version = s.current_terms_version
     and t.privacy_version = s.current_privacy_version
    where s.singleton = true
  )
$$;

create or replace function public.phase4_global_beta_effective(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.phase4_global_beta_identity_eligible(p_user_id)
     and public.phase4_has_current_legal_acceptance(p_user_id)
$$;

create or replace function public.phase4_global_beta_public_policy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.global_beta_all_access_enabled
  )
  from public.platform_access_settings s
  where s.singleton = true
$$;

create or replace function public.phase4_global_beta_policy_snapshot(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.platform_access_settings%rowtype;
  v_signed_in_accounts bigint := 0;
begin
  perform public.admin_authorization_context(p_actor_user_id);

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select count(*) into v_signed_in_accounts
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
    and u.last_sign_in_at is not null;

  return jsonb_build_object(
    'enabled', v_settings.global_beta_all_access_enabled,
    'defaultEnabled', true,
    'scope', 'all_current_and_future_signed_in_users',
    'expiresAt', null,
    'legalAcceptanceRequired', true,
    'signedInAccountCount', v_signed_in_accounts,
    'updatedAt', v_settings.global_beta_all_access_updated_at,
    'updatedBy', v_settings.global_beta_all_access_updated_by,
    'version', v_settings.global_beta_all_access_version,
    'fallbackWhenDisabled',
      'Existing per-user beta, trial, subscription, and historical-access rules.'
  );
end;
$$;

create or replace function public.phase4_admin_set_global_beta_all_access(
  p_actor_user_id uuid,
  p_enabled boolean,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.platform_access_settings%rowtype;
  v_history public.global_beta_all_access_history%rowtype;
  v_previous boolean;
  v_changed boolean;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_enabled is null then
    raise exception 'Beta All Access state is required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Change reason must be 5 to 1000 characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260810));

  select * into v_history
  from public.global_beta_all_access_history
  where request_key = p_request_key;

  if v_history.id is not null then
    if v_history.actor_user_id <> p_actor_user_id
       or v_history.enabled <> p_enabled
       or btrim(v_history.reason) <> btrim(p_reason) then
      raise exception 'Request key conflicts with a different Beta All Access change';
    end if;
    return public.phase4_global_beta_policy_snapshot(p_actor_user_id)
      || jsonb_build_object(
        'changed', v_history.previous_enabled <> v_history.enabled,
        'replayed', true
      );
  end if;

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true
  for update;

  v_previous := v_settings.global_beta_all_access_enabled;
  v_changed := v_previous is distinct from p_enabled;

  update public.platform_access_settings
  set global_beta_all_access_enabled = p_enabled,
      global_beta_all_access_updated_at = now(),
      global_beta_all_access_updated_by = p_actor_user_id,
      global_beta_all_access_version = global_beta_all_access_version + 1,
      updated_at = now(),
      updated_by = p_actor_user_id
  where singleton = true
  returning * into strict v_settings;

  insert into public.global_beta_all_access_history (
    actor_user_id,
    previous_enabled,
    enabled,
    version,
    reason,
    request_key
  ) values (
    p_actor_user_id,
    v_previous,
    p_enabled,
    v_settings.global_beta_all_access_version,
    btrim(p_reason),
    p_request_key
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action_type,
    target_resource_type,
    target_resource_id,
    reason,
    details
  ) values (
    p_actor_user_id,
    'security_setting_changed',
    'global_beta_all_access_policy',
    'singleton',
    btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'setting', 'global_beta_all_access',
      'previousEnabled', v_previous,
      'newEnabled', p_enabled,
      'version', v_settings.global_beta_all_access_version
    )
  );

  return public.phase4_global_beta_policy_snapshot(p_actor_user_id)
    || jsonb_build_object('changed', v_changed, 'replayed', false);
end;
$$;

-- Central simulator/grading entitlement. Legal acceptance is deliberately
-- preserved; global beta replaces only monetary/time/usage eligibility.
create or replace function public.phase4_access_snapshot(
  p_user_id uuid,
  p_activate_trial boolean default false,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_role text := 'student';
  v_terms_ok boolean := false;
  v_global_identity boolean := false;
  v_global_effective boolean := false;
  v_trial public.access_trials%rowtype;
  v_beta public.free_beta_access%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_used integer := 0;
  v_basis text := 'locked';
  v_allowed boolean := false;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;
  select * into strict v_settings
  from public.platform_access_settings where singleton = true;
  select coalesce(role, 'student') into v_role
  from public.user_roles where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');
  v_terms_ok := public.phase4_has_current_legal_acceptance(p_user_id);
  v_global_identity := public.phase4_global_beta_identity_eligible(p_user_id);
  v_global_effective := v_global_identity and v_terms_ok;

  if p_activate_trial and v_terms_ok and not v_global_identity then
    if nullif(btrim(coalesce(p_request_key, '')), '') is null
       or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
      raise exception 'A valid first-exam request key is required';
    end if;
    insert into public.access_trials (
      user_id, started_at, expires_at, first_exam_request_key
    )
    values (
      p_user_id, v_now, v_now + make_interval(hours => v_settings.trial_duration_hours),
      p_request_key
    )
    on conflict (user_id) do nothing;
  end if;

  select * into v_trial from public.access_trials where user_id = p_user_id;
  select * into v_beta from public.free_beta_access where user_id = p_user_id;
  select * into v_subscription
  from public.subscriptions
  where user_id = p_user_id
    and status = 'active'
    and starts_at <= v_now
    and (expires_at is null or expires_at > v_now)
  order by expires_at desc nulls first
  limit 1;
  select coalesce(successful_grades, 0) into v_used
  from public.lifetime_grade_usage where user_id = p_user_id;
  v_used := coalesce(v_used, 0);

  if v_terms_ok then
    if v_role = 'super_admin' then
      v_allowed := true; v_basis := 'super_admin';
    elsif v_role = 'founder_admin' then
      v_allowed := true; v_basis := 'founder_admin';
    elsif v_global_effective then
      -- Reuse the existing allowed reservation basis so no historical grade
      -- check constraint or accounting behavior needs to change.
      v_allowed := true; v_basis := 'free_beta';
    elsif v_beta.enabled
      and (v_beta.expires_at is null or v_beta.expires_at > v_now) then
      v_allowed := true; v_basis := 'free_beta';
    elsif v_subscription.id is not null then
      v_allowed := true; v_basis := 'paid_subscription';
    elsif v_trial.user_id is not null and v_trial.expires_at > v_now then
      v_allowed := true; v_basis := 'trial';
    elsif v_used < v_settings.lifetime_free_grades then
      v_allowed := true; v_basis := 'lifetime_free';
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'basis', v_basis,
    'termsRequired', not v_terms_ok,
    'role', v_role,
    'globalBeta', jsonb_build_object(
      'enabled', v_settings.global_beta_all_access_enabled,
      'eligible', v_global_identity,
      'active', v_global_effective,
      'expiresAt', null
    ),
    'trial', jsonb_build_object(
      'startedAt', v_trial.started_at,
      'expiresAt', v_trial.expires_at,
      'active', coalesce(v_trial.expires_at > v_now, false)
    ),
    'freeGrades', jsonb_build_object(
      'limit', v_settings.lifetime_free_grades,
      'used', v_used,
      'remaining', greatest(0, v_settings.lifetime_free_grades - v_used)
    ),
    'freeBeta', jsonb_build_object(
      'enabled', v_global_identity or coalesce(v_beta.enabled, false),
      'expiresAt', case when v_global_identity then null else v_beta.expires_at end,
      'active', v_global_effective or coalesce(
        v_beta.enabled and (v_beta.expires_at is null or v_beta.expires_at > v_now),
        false
      )
    ),
    'subscription', case when v_subscription.id is null then null else
      jsonb_build_object(
        'id', v_subscription.id,
        'planCode', v_subscription.plan_code,
        'status', v_subscription.status,
        'startsAt', v_subscription.starts_at,
        'expiresAt', v_subscription.expires_at
      )
    end
  );
end;
$$;

create or replace function public.phase4_user_subscription_status(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with global_state as (
    select
      public.phase4_global_beta_identity_eligible(p_user_id) as eligible,
      public.phase4_global_beta_effective(p_user_id) as active
  )
  select jsonb_build_object(
    'globalBeta', jsonb_build_object(
      'enabled', g.eligible,
      'active', g.active,
      'expiresAt', null
    ),
    'subscription', (
      select jsonb_build_object(
        'id', s.id,
        'planCode', s.plan_code,
        'status', case
          when s.status = 'active' and s.expires_at is not null and s.expires_at <= now()
            then 'expired'
          else s.status
        end,
        'source', s.source,
        'startsAt', s.starts_at,
        'expiresAt', s.expires_at
      )
      from public.subscriptions s
      where s.user_id = p_user_id
      order by s.updated_at desc, s.created_at desc
      limit 1
    ),
    'pendingPayment', (
      select jsonb_build_object(
        'id', p.id,
        'planCode', p.plan_code,
        'amountPhp', p.trusted_amount_php,
        'status', p.status,
        'submittedAt', p.submitted_at
      )
      from public.payment_requests p
      where p.user_id = p_user_id
        and p.status in ('pending', 'needs_information')
      order by p.submitted_at desc
      limit 1
    ),
    'examinationBeta', case when g.active then
      jsonb_build_object(
        'enabled', true,
        'expiresAt', null,
        'active', true,
        'source', 'global_beta_all_access'
      )
    else (
      select jsonb_build_object(
        'enabled', b.enabled,
        'expiresAt', b.expires_at,
        'active', b.enabled and (b.expires_at is null or b.expires_at > now()),
        'source', 'per_user'
      )
      from public.examination_beta_access b
      where b.user_id = p_user_id
    ) end
  )
  from global_state g
  where exists (
    select 1 from auth.users u
    where u.id = p_user_id and coalesce(u.is_anonymous, false) = false
  )
$$;

create or replace function public.examination_authorize_access(
  p_user_id uuid,
  p_track text default null,
  p_version_id uuid default null,
  p_attempt_id uuid default null,
  p_allow_historical boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_role text;
  v_source text;
  v_access jsonb;
  v_basis text := 'locked';
  v_allowed boolean := false;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if p_attempt_id is not null then
    select d.track into v_track
    from public.examination_attempts_multi a
    join public.examination_versions ev on ev.id = a.version_id
    join public.examination_definitions d on d.id = ev.exam_id
    where a.id = p_attempt_id and a.user_id = p_user_id;
    if v_track is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if p_allow_historical then
      return jsonb_build_object(
        'allowed', true, 'basis', 'historical_owner', 'track', v_track
      );
    end if;
  elsif p_version_id is not null then
    select d.track into v_track
    from public.examination_versions ev
    join public.examination_definitions d on d.id = ev.exam_id
    where ev.id = p_version_id;
    if v_track is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
  elsif p_allow_historical and exists (
    select 1 from public.examination_attempts_multi where user_id = p_user_id
  ) then
    return jsonb_build_object(
      'allowed', true, 'basis', 'historical_owner', 'track', null
    );
  elsif p_allow_historical and v_track is null then
    v_access := public.phase4_access_snapshot(p_user_id, false, null);
    if coalesce((v_access->>'allowed')::boolean, false) then
      return jsonb_build_object(
        'allowed', true,
        'basis', coalesce(v_access->>'basis', 'current_access'),
        'track', null
      );
    end if;
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if v_track not in ('per_subject', 'bar_feels') then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  select coalesce(role, 'student') into v_role
  from public.user_roles where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  if v_role in ('super_admin', 'founder_admin') then
    v_allowed := true;
    v_basis := v_role;
  elsif public.phase4_global_beta_effective(p_user_id) then
    v_allowed := true;
    v_basis := 'global_beta_all_access';
  elsif exists (
    select 1 from public.examination_beta_access
    where user_id = p_user_id
      and enabled
      and (expires_at is null or expires_at > now())
  ) then
    v_allowed := true;
    v_basis := 'examination_beta';
  elsif v_track = 'bar_feels' then
    select s.source into v_source
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.plan_code = 'premium'
      and s.status = 'active'
      and s.starts_at <= now()
      and s.expires_at is not null
      and s.expires_at > now()
    order by s.updated_at desc
    limit 1;
    if v_source is not null then
      v_access := public.phase4_access_snapshot(p_user_id, false, null);
      if coalesce((v_access->>'allowed')::boolean, false) then
        v_allowed := true;
        v_basis := case when v_source = 'complimentary'
          then 'premium_beta' else 'premium_paid' end;
      else
        raise exception 'EXAM_ACCESS_REQUIRED';
      end if;
    end if;
  else
    v_access := public.phase4_access_snapshot(p_user_id, false, null);
    v_allowed := coalesce((v_access->>'allowed')::boolean, false);
    v_basis := coalesce(v_access->>'basis', 'locked');
  end if;

  if not v_allowed then
    if v_track = 'bar_feels' then raise exception 'EXAM_PREMIUM_REQUIRED'; end if;
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  return jsonb_build_object(
    'allowed', true, 'basis', v_basis, 'track', v_track
  );
end;
$$;

create or replace function public.examination_has_beta_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.examination_is_admin(p_user_id)
    or public.phase4_global_beta_effective(p_user_id)
    or exists (
      select 1 from public.examination_beta_access
      where user_id = p_user_id
        and enabled
        and (expires_at is null or expires_at > now())
    )
    or (
      exists (
        select 1
        from public.platform_access_settings s
        where exists (
          select 1 from public.terms_acceptances t
          where t.user_id = p_user_id
            and t.terms_version = s.current_terms_version
            and t.privacy_version = s.current_privacy_version
        )
      )
      and (
        exists (
          select 1 from public.free_beta_access b
          where b.user_id = p_user_id
            and b.enabled
            and (b.expires_at is null or b.expires_at > now())
        )
        or exists (
          select 1 from public.subscriptions s
          where s.user_id = p_user_id
            and s.status = 'active'
            and s.starts_at <= now()
            and (s.expires_at is null or s.expires_at > now())
        )
        or exists (
          select 1 from public.access_trials t
          where t.user_id = p_user_id and t.expires_at > now()
        )
        or coalesce((
          select g.successful_grades
          from public.lifetime_grade_usage g
          where g.user_id = p_user_id
        ), 0) < coalesce((
          select s.lifetime_free_grades
          from public.platform_access_settings s
          where s.singleton = true
        ), 3)
      )
    )
    or exists (
      select 1 from public.examination_attempts_multi a
      where a.user_id = p_user_id
    )
$$;

-- Let every signed-in non-anonymous account bypass the obsolete 12-hour
-- admission/session gate while global policy is on. When off, the original
-- private-beta checks remain byte-for-byte equivalent in behavior.
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
  if p_user_id is null or not exists (
    select 1 from auth.users u
    where u.id = p_user_id and coalesce(u.is_anonymous, false) = false
  ) then
    return jsonb_build_object('allowed', false);
  end if;

  select * into strict v_settings
  from public.private_beta_settings
  where singleton = true;

  if public.phase4_global_beta_identity_eligible(p_user_id) then
    return jsonb_build_object(
      'allowed', true,
      'admissionKind', 'global_beta_all_access',
      'disclosureVersion', v_settings.disclosure_version,
      'expiresAt', null
    );
  end if;

  if p_access_jti_hash is null or p_access_jti_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'allowed', false,
      'admissionKind', null,
      'disclosureVersion', v_settings.disclosure_version,
      'expiresAt', null
    );
  end if;

  select * into v_admission
  from public.private_beta_admissions
  where user_id = p_user_id;

  select * into v_session
  from public.private_beta_sessions
  where user_id = p_user_id
    and access_jti_hash = p_access_jti_hash
    and revoked_at is null
    and expires_at > v_now;

  select coalesce(role, 'student') into v_role
  from public.user_roles where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  v_allowed :=
    v_admission.user_id is not null
    and v_session.id is not null
    and v_admission.status = 'active'
    and v_admission.access_expires_at > v_now
    and v_admission.disclosure_version = v_settings.disclosure_version
    and exists (
      select 1 from public.private_beta_acceptances a
      where a.id = v_session.acceptance_id
        and a.user_id = p_user_id
        and a.disclosure_version = v_settings.disclosure_version
    )
    and (
      (v_admission.admission_kind = 'founder'
        and v_role in ('founder_admin', 'super_admin'))
      or (v_admission.admission_kind = 'beta_tester'
        and v_role in ('beta_tester', 'admin'))
    );

  return jsonb_build_object(
    'allowed', v_allowed,
    'admissionKind', case when v_allowed then v_admission.admission_kind else null end,
    'disclosureVersion', v_settings.disclosure_version,
    'expiresAt', case when v_allowed then v_session.expires_at else null end
  );
end;
$$;

revoke all on function public.phase4_global_beta_identity_eligible(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_has_current_legal_acceptance(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_global_beta_effective(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_global_beta_public_policy()
  from public, anon, authenticated;
revoke all on function public.phase4_global_beta_policy_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_admin_set_global_beta_all_access(
  uuid, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.phase4_user_subscription_status(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function public.examination_has_beta_access(uuid)
  from public, anon, authenticated;
revoke all on function public.private_beta_access_snapshot(uuid, text)
  from public, anon, authenticated;

grant execute on function public.phase4_global_beta_identity_eligible(uuid)
  to service_role;
grant execute on function public.phase4_has_current_legal_acceptance(uuid)
  to service_role;
grant execute on function public.phase4_global_beta_effective(uuid)
  to service_role;
grant execute on function public.phase4_global_beta_public_policy()
  to service_role;
grant execute on function public.phase4_global_beta_policy_snapshot(uuid)
  to service_role;
grant execute on function public.phase4_admin_set_global_beta_all_access(
  uuid, boolean, text, text
) to service_role;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;
grant execute on function public.phase4_user_subscription_status(uuid)
  to service_role;
grant execute on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) to service_role;
grant execute on function public.examination_has_beta_access(uuid)
  to service_role;
grant execute on function public.private_beta_access_snapshot(uuid, text)
  to service_role;

comment on column public.platform_access_settings.global_beta_all_access_enabled
  is 'Founder-controlled, non-expiring all-feature access for current and future signed-in non-anonymous users after current legal acceptance.';
comment on function public.phase4_global_beta_identity_eligible(uuid)
  is 'True only when global beta is enabled and the user is an existing non-anonymous auth identity.';
comment on function public.phase4_global_beta_policy_snapshot(uuid)
  is 'Administrator-visible truthful status of the singleton Beta All Access policy.';
comment on function public.phase4_admin_set_global_beta_all_access(
  uuid, boolean, text, text
) is 'Founder-only, idempotent and audited update of global Beta All Access.';

commit;
