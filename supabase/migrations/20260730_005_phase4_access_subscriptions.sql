-- Due Diligence Phase 4, Release 1
-- Authentication-gated access, non-restartable trials, lifetime free grades,
-- Free Beta overrides, active subscriptions, and Founder administration.
--
-- Apply only after the Phase 4 production preflight passes. This migration is
-- backward compatible with the Phase 1-3 schema and does not alter questions,
-- answers, Gemini grading, or existing Super Admin records.

begin;

-- ---------------------------------------------------------------------------
-- Versioned legal configuration
-- ---------------------------------------------------------------------------

create table if not exists public.platform_access_settings (
  singleton boolean primary key default true check (singleton),
  current_terms_version text not null,
  current_privacy_version text not null,
  ai_consent_version text not null,
  trial_duration_hours integer not null default 72
    check (trial_duration_hours = 72),
  lifetime_free_grades integer not null default 3
    check (lifetime_free_grades = 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.platform_access_settings (
  singleton,
  current_terms_version,
  current_privacy_version,
  ai_consent_version,
  trial_duration_hours,
  lifetime_free_grades
)
values (
  true,
  'terms-beta-v2-2026-07-28',
  'privacy-beta-v2-2026-07-28',
  'ai-improvement-beta-v1-2026-07-28',
  72,
  3
)
on conflict (singleton) do update
set current_terms_version = excluded.current_terms_version,
    current_privacy_version = excluded.current_privacy_version,
    ai_consent_version = excluded.ai_consent_version,
    trial_duration_hours = excluded.trial_duration_hours,
    lifetime_free_grades = excluded.lifetime_free_grades,
    updated_at = now();

create table if not exists public.ai_improvement_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opted_in boolean not null default false,
  consent_version text not null
    check (nullif(btrim(consent_version), '') is not null),
  source text not null check (nullif(btrim(source), '') is not null),
  changed_at timestamptz not null default now()
);

create index if not exists ai_improvement_consents_user_time_idx
  on public.ai_improvement_consents (user_id, changed_at desc);

-- Accept only the current Phase 4 Terms and Privacy versions. Historical
-- acceptances remain immutable and readable by their owner.
create or replace function public.accept_terms(
  p_terms_version text default 'terms-beta-v2-2026-07-28',
  p_privacy_version text default 'privacy-beta-v2-2026-07-28',
  p_acceptance_source text default 'web_onboarding'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.platform_access_settings%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;
  if btrim(coalesce(p_terms_version, '')) <> v_settings.current_terms_version
     or btrim(coalesce(p_privacy_version, '')) <> v_settings.current_privacy_version then
    raise exception 'Current Terms and Privacy versions are required';
  end if;
  if nullif(btrim(p_acceptance_source), '') is null then
    raise exception 'Acceptance source is required';
  end if;

  insert into public.terms_acceptances (
    user_id, terms_version, privacy_version, accepted_at, acceptance_source
  )
  values (
    v_user_id,
    v_settings.current_terms_version,
    v_settings.current_privacy_version,
    now(),
    btrim(p_acceptance_source)
  )
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

create or replace function public.record_ai_improvement_consent(
  p_opted_in boolean default false,
  p_consent_version text default 'ai-improvement-beta-v1-2026-07-28',
  p_source text default 'web_onboarding'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_version text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  select ai_consent_version into strict v_current_version
  from public.platform_access_settings
  where singleton = true;
  if btrim(coalesce(p_consent_version, '')) <> v_current_version then
    raise exception 'Current AI-improvement consent version is required';
  end if;
  if nullif(btrim(p_source), '') is null then
    raise exception 'Consent source is required';
  end if;

  insert into public.ai_improvement_consents (
    user_id, opted_in, consent_version, source, changed_at
  )
  values (
    v_user_id, coalesce(p_opted_in, false), v_current_version,
    btrim(p_source), now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder Admin role
-- ---------------------------------------------------------------------------

alter table public.user_roles
  drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('student', 'admin', 'founder_admin', 'super_admin'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() in ('admin', 'founder_admin', 'super_admin');
$$;

create or replace function public.admin_has_capability(
  p_actor_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_actor_user_id
      and role in ('founder_admin', 'super_admin')
  ) or exists (
    select 1
    from public.user_roles r
    join public.admin_capabilities c on c.user_id = r.user_id
    where r.user_id = p_actor_user_id
      and r.role = 'admin'
      and c.capability = p_capability
      and c.revoked_at is null
  );
$$;

create or replace function public.admin_authorization_context(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_capabilities text[];
begin
  select role into v_role
  from public.user_roles
  where user_id = p_actor_user_id;

  if v_role not in ('admin', 'founder_admin', 'super_admin') then
    raise exception 'Administrator authorization required';
  end if;

  if v_role in ('founder_admin', 'super_admin') then
    v_capabilities := array[
      'analytics_viewer',
      'learner_analytics_viewer',
      'support_admin',
      'correction_admin',
      'subscription_admin',
      'account_recovery_admin',
      'advertiser_report_viewer',
      'role_admin'
    ];
  else
    select coalesce(array_agg(capability order by capability), '{}'::text[])
      into v_capabilities
    from public.admin_capabilities
    where user_id = p_actor_user_id
      and revoked_at is null;
  end if;

  return jsonb_build_object(
    'authorized', true,
    'role', v_role,
    'role_label', case
      when v_role = 'super_admin' then 'Super Admin'
      when v_role = 'founder_admin' then 'Founder Admin'
      else 'Admin'
    end,
    'capabilities', to_jsonb(v_capabilities),
    'account_transfer_enabled', false,
    'account_transfer_explanation',
      'Google identity transfer remains disabled until same-UUID ownership transfer is proven in staging.'
  );
end;
$$;

create or replace function public.assign_user_role(
  p_target_user_id uuid,
  p_role text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_previous_role text;
  v_action_type text;
begin
  if v_actor_user_id is null or not public.is_super_admin() then
    raise exception 'Super administrator authorization required';
  end if;
  if p_target_user_id = v_actor_user_id then
    raise exception 'Self-directed administrator role changes are not allowed';
  end if;
  if p_role not in ('student', 'admin', 'founder_admin') then
    raise exception 'Only student, admin, or Founder Admin roles may be assigned';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target authenticated user does not exist';
  end if;

  select role into v_previous_role
  from public.user_roles
  where user_id = p_target_user_id
  for update;
  if v_previous_role = 'super_admin' then
    raise exception 'The Super Admin role cannot be changed here';
  end if;

  insert into public.user_roles (user_id, role, assigned_by, updated_at)
  values (p_target_user_id, p_role, v_actor_user_id, now())
  on conflict (user_id) do update
  set role = excluded.role,
      assigned_by = excluded.assigned_by,
      updated_at = excluded.updated_at;

  v_action_type := case
    when p_role = 'student' then 'administrator_role_removed'
    when coalesce(v_previous_role, 'student') = 'student'
      then 'administrator_role_assigned'
    else 'administrator_role_changed'
  end;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  )
  values (
    v_actor_user_id, v_action_type, p_target_user_id, 'user_role',
    p_target_user_id::text, btrim(p_reason),
    jsonb_build_object(
      'previous_role', coalesce(v_previous_role, 'student'),
      'new_role', p_role
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Trial, lifetime-grade, Free Beta, and subscription records
-- ---------------------------------------------------------------------------

create table if not exists public.access_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  first_exam_request_key text not null unique
    check (first_exam_request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  manually_adjusted_at timestamptz,
  manually_adjusted_by uuid references auth.users(id),
  adjustment_reason text,
  created_at timestamptz not null default now(),
  check (expires_at > started_at),
  check (
    (manually_adjusted_at is null and manually_adjusted_by is null and adjustment_reason is null)
    or (
      manually_adjusted_at is not null
      and manually_adjusted_by is not null
      and char_length(btrim(adjustment_reason)) between 5 and 1000
    )
  )
);

create table if not exists public.lifetime_grade_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  successful_grades integer not null default 0
    check (successful_grades between 0 and 3),
  first_success_at timestamptz,
  third_success_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.grade_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  question_bank_id text not null
    check (char_length(btrim(question_bank_id)) between 3 and 100),
  access_basis text not null check (access_basis in (
    'super_admin', 'founder_admin', 'free_beta', 'paid_subscription',
    'trial', 'lifetime_free'
  )),
  status text not null default 'reserved'
    check (status in ('reserved', 'completed', 'released', 'expired')),
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null default (now() + interval '20 minutes'),
  completed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  check (reservation_expires_at > reserved_at)
);

create index if not exists grade_reservations_user_status_idx
  on public.grade_reservations (user_id, status, reservation_expires_at);

create table if not exists public.free_beta_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  expires_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);

create table if not exists public.free_beta_access_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now()
);

alter table public.plan_catalog
  add column if not exists duration_days integer,
  add column if not exists display_order integer not null default 0,
  add column if not exists promotional boolean not null default false,
  add column if not exists checkout_enabled boolean not null default false;

alter table public.plan_catalog
  drop constraint if exists plan_catalog_status_check;
alter table public.plan_catalog
  add constraint plan_catalog_status_check
  check (status in ('draft', 'active', 'disabled', 'paused', 'retired'));

alter table public.plan_catalog
  drop constraint if exists plan_catalog_phase4_duration_check;
alter table public.plan_catalog
  add constraint plan_catalog_phase4_duration_check
  check (duration_days is null or duration_days between 1 and 366);

update public.plan_catalog
set display_name = 'Early Access Beta',
    price_php = 149.00,
    status = 'active',
    description = 'Complete current digital Philippine Bar Essay Simulator experience for 30 calendar days after Founder approval.',
    features = '["Complete digital simulator", "AI grading", "Suggested answers", "Legal sources", "Progress and history", "Timer modes", "Corrections"]'::jsonb,
    duration_days = 30,
    display_order = 10,
    promotional = true,
    checkout_enabled = true,
    note = 'Manual GCash or MariBank verification. No automatic renewal.',
    updated_at = now()
where plan_code = 'early_access_beta';

update public.plan_catalog
set display_name = 'Standard',
    price_php = 249.00,
    status = 'active',
    description = 'Complete digital simulator and student analytics for 30 calendar days after Founder approval.',
    features = '["Complete digital simulator", "AI grading", "Suggested answers", "Legal sources", "Progress and history", "Timer modes", "Corrections", "Student analytics"]'::jsonb,
    duration_days = 30,
    display_order = 20,
    promotional = false,
    checkout_enabled = true,
    note = 'Manual GCash or MariBank verification. No automatic renewal.',
    updated_at = now()
where plan_code = 'standard';

update public.plan_catalog
set display_name = 'Premium',
    price_php = 499.00,
    status = 'disabled',
    description = 'Held in Abeyance. Further proceedings pending. Premium enrollment is not yet available.',
    features = '[]'::jsonb,
    duration_days = null,
    display_order = 30,
    promotional = false,
    checkout_enabled = false,
    note = 'Held in Abeyance. Payment submission is disabled.',
    updated_at = now()
where plan_code = 'premium';

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plan_catalog(plan_code),
  status text not null check (status in (
    'trialing', 'pending_payment', 'active', 'paused', 'cancelled',
    'expired', 'refunded'
  )),
  starts_at timestamptz,
  expires_at timestamptz,
  source text not null check (source in (
    'manual_payment', 'complimentary', 'admin_adjustment', 'migration'
  )),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  reason text,
  version integer not null default 1 check (version > 0),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);

create unique index if not exists subscriptions_one_live_per_user_idx
  on public.subscriptions (user_id)
  where status in ('trialing', 'pending_payment', 'active', 'paused');

create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in (
    'create', 'activate', 'pause', 'resume', 'cancel', 'extend',
    'replace_plan', 'expire', 'refund', 'adjust'
  )),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access-resolution and transactional grade functions
-- ---------------------------------------------------------------------------

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
  v_trial public.access_trials%rowtype;
  v_beta public.free_beta_access%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_used integer := 0;
  v_basis text := 'locked';
  v_allowed boolean := false;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Authenticated user required';
  end if;
  select * into strict v_settings
  from public.platform_access_settings where singleton = true;
  select coalesce(role, 'student') into v_role
  from public.user_roles where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');
  select exists (
    select 1 from public.terms_acceptances
    where user_id = p_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) into v_terms_ok;

  if p_activate_trial and v_terms_ok then
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
      'enabled', coalesce(v_beta.enabled, false),
      'expiresAt', v_beta.expires_at,
      'active', coalesce(
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

create or replace function public.phase4_reserve_grade(
  p_user_id uuid,
  p_request_key text,
  p_question_bank_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access jsonb;
  v_existing public.grade_reservations%rowtype;
  v_reservation_id uuid;
  v_used integer := 0;
  v_active_reservations integer := 0;
  v_basis text;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid grading request key';
  end if;
  if char_length(btrim(coalesce(p_question_bank_id, ''))) not between 3 and 100 then
    raise exception 'Invalid question identifier';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));

  select * into v_existing
  from public.grade_reservations
  where request_key = p_request_key;
  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.question_bank_id <> btrim(p_question_bank_id) then
      raise exception 'Grading request key conflict';
    end if;
    return jsonb_build_object(
      'allowed', v_existing.status in ('reserved', 'completed'),
      'reservationId', v_existing.id,
      'status', v_existing.status,
      'accessBasis', v_existing.access_basis,
      'replayed', true
    );
  end if;

  update public.grade_reservations
  set status = 'expired',
      released_at = now(),
      release_reason = 'reservation_timeout'
  where user_id = p_user_id
    and status = 'reserved'
    and reservation_expires_at <= now();

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('reservationId', null, 'replayed', false);
  end if;
  v_basis := v_access->>'basis';

  insert into public.lifetime_grade_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select successful_grades into v_used
  from public.lifetime_grade_usage
  where user_id = p_user_id
  for update;

  if v_basis = 'lifetime_free' then
    select count(*) into v_active_reservations
    from public.grade_reservations
    where user_id = p_user_id
      and status = 'reserved'
      and reservation_expires_at > now();
    if v_used + v_active_reservations >= 3 then
      return jsonb_build_object(
        'allowed', false,
        'basis', 'locked',
        'reason', 'lifetime_free_grades_exhausted',
        'termsRequired', false,
        'freeGrades', jsonb_build_object(
          'limit', 3,
          'used', v_used,
          'remaining', greatest(0, 3 - v_used)
        )
      );
    end if;
  end if;

  insert into public.grade_reservations (
    user_id, request_key, question_bank_id, access_basis
  )
  values (
    p_user_id, p_request_key, btrim(p_question_bank_id), v_basis
  )
  returning id into v_reservation_id;

  return v_access || jsonb_build_object(
    'reservationId', v_reservation_id,
    'status', 'reserved',
    'accessBasis', v_basis,
    'replayed', false
  );
end;
$$;

create or replace function public.phase4_finalize_grade(
  p_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.grade_reservations%rowtype;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_reservation
  from public.grade_reservations
  where id = p_reservation_id and user_id = p_user_id
  for update;

  if v_reservation.status = 'completed' then
    select successful_grades into v_used
    from public.lifetime_grade_usage where user_id = p_user_id;
    return jsonb_build_object(
      'completed', true, 'replayed', true,
      'used', coalesce(v_used, 0), 'remaining', greatest(0, 3 - coalesce(v_used, 0))
    );
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'Grade reservation is no longer active';
  end if;

  update public.grade_reservations
  set status = 'completed', completed_at = now()
  where id = p_reservation_id;

  insert into public.lifetime_grade_usage (
    user_id, successful_grades, first_success_at, third_success_at, updated_at
  )
  values (p_user_id, 1, now(), null, now())
  on conflict (user_id) do update
  set successful_grades = least(3, public.lifetime_grade_usage.successful_grades + 1),
      first_success_at = coalesce(public.lifetime_grade_usage.first_success_at, now()),
      third_success_at = case
        when public.lifetime_grade_usage.successful_grades + 1 >= 3
          then coalesce(public.lifetime_grade_usage.third_success_at, now())
        else public.lifetime_grade_usage.third_success_at
      end,
      updated_at = now()
  returning successful_grades into v_used;

  return jsonb_build_object(
    'completed', true, 'replayed', false,
    'used', v_used, 'remaining', greatest(0, 3 - v_used)
  );
end;
$$;

create or replace function public.phase4_release_grade(
  p_user_id uuid,
  p_reservation_id uuid,
  p_reason text default 'grading_failed'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.grade_reservations
  set status = 'released',
      released_at = now(),
      release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'grading_failed'), 200)
  where id = p_reservation_id
    and user_id = p_user_id
    and status = 'reserved';
end;
$$;

-- ---------------------------------------------------------------------------
-- Backend-only security
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'platform_access_settings',
    'ai_improvement_consents',
    'access_trials',
    'lifetime_grade_usage',
    'grade_reservations',
    'free_beta_access',
    'free_beta_access_history',
    'subscriptions',
    'subscription_history'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'revoke all on public.%I from public, anon, authenticated',
      v_table
    );
    execute format(
      'grant select, insert, update, delete on public.%I to service_role',
      v_table
    );
  end loop;
end
$$;

-- Signed-in users may read their own consent history only.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_improvement_consents'
      and policyname = 'ai_improvement_consents_select_own'
  ) then
    create policy ai_improvement_consents_select_own
      on public.ai_improvement_consents
      for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$$;
grant select on public.ai_improvement_consents to authenticated;

revoke all on function public.accept_terms(text, text, text)
  from public, anon;
revoke all on function public.record_ai_improvement_consent(boolean, text, text)
  from public, anon;
grant execute on function public.accept_terms(text, text, text)
  to authenticated;
grant execute on function public.record_ai_improvement_consent(boolean, text, text)
  to authenticated;

revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.phase4_reserve_grade(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.phase4_finalize_grade(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_release_grade(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;
grant execute on function public.phase4_reserve_grade(uuid, text, text)
  to service_role;
grant execute on function public.phase4_finalize_grade(uuid, uuid)
  to service_role;
grant execute on function public.phase4_release_grade(uuid, uuid, text)
  to service_role;

revoke all on function public.admin_has_capability(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_authorization_context(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_has_capability(uuid, text)
  to service_role;
grant execute on function public.admin_authorization_context(uuid)
  to service_role;

commit;
