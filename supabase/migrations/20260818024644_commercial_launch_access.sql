-- Due Diligence immediate commercial launch foundation.
--
-- This migration is additive and intentionally installs with the commercial
-- switch disabled.  Production activation is a separate, audited operation so
-- the database, Worker and static frontend can be deployed and verified in
-- that order without interrupting the existing service.

begin;

-- ---------------------------------------------------------------------------
-- Commercial policy and immutable launch dates
-- ---------------------------------------------------------------------------

alter table public.platform_access_settings
  add column if not exists commercial_launch_enabled boolean not null default false,
  add column if not exists free_daily_grade_limit integer not null default 5,
  add column if not exists quota_timezone text not null default 'Asia/Manila',
  add column if not exists early_access_sales_close_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz,
  add column if not exists early_access_entitlement_ends_at timestamptz not null
    default '2026-10-01 23:59:59+08'::timestamptz,
  add column if not exists public_pricing_enabled boolean not null default false,
  add column if not exists commercial_terms_version text not null
    default 'terms-commercial-v1-2026-08-18',
  add column if not exists commercial_privacy_version text not null
    default 'privacy-commercial-v1-2026-08-18',
  add column if not exists commercial_policy_version bigint not null default 1,
  add column if not exists commercial_updated_at timestamptz not null default now(),
  add column if not exists commercial_updated_by uuid references auth.users(id);

alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_free_daily_grade_limit_check;
alter table public.platform_access_settings
  add constraint platform_access_settings_free_daily_grade_limit_check
    check (free_daily_grade_limit between 1 and 100);
alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_quota_timezone_check;
alter table public.platform_access_settings
  add constraint platform_access_settings_quota_timezone_check
    check (quota_timezone = 'Asia/Manila');
alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_commercial_dates_check;
alter table public.platform_access_settings
  add constraint platform_access_settings_commercial_dates_check check (
    early_access_sales_close_at < early_access_entitlement_ends_at
    and nullif(btrim(commercial_terms_version), '') is not null
    and nullif(btrim(commercial_privacy_version), '') is not null
  );

update public.platform_access_settings
set free_daily_grade_limit = 5,
    quota_timezone = 'Asia/Manila',
    early_access_sales_close_at = '2026-09-01 23:59:59+08'::timestamptz,
    early_access_entitlement_ends_at = '2026-10-01 23:59:59+08'::timestamptz,
    commercial_terms_version = 'terms-commercial-v1-2026-08-18',
    commercial_privacy_version = 'privacy-commercial-v1-2026-08-18'
where singleton = true;

-- One immutable pre-launch snapshot makes the operational rollback explicit.
-- The snapshot contains policy/catalog configuration only; no user or payment data.
create table if not exists public.commercial_launch_rollback_snapshots (
  singleton boolean primary key default true check (singleton),
  previous_settings jsonb not null,
  previous_plan_catalog jsonb not null,
  captured_at timestamptz not null default now(),
  captured_by uuid references auth.users(id)
);

-- ---------------------------------------------------------------------------
-- Daily, cross-track reservation accounting
-- ---------------------------------------------------------------------------

alter table public.grade_reservations
  add column if not exists usage_date_ph date,
  add column if not exists examination_track text,
  add column if not exists consumes_quota boolean not null default false,
  add column if not exists session_request_key text,
  add column if not exists external_resource_id text,
  add column if not exists batch_ordinal integer;

update public.grade_reservations
set usage_date_ph = (reserved_at at time zone 'Asia/Manila')::date,
    examination_track = coalesce(nullif(examination_track, ''), 'bar_practice')
where usage_date_ph is null or examination_track is null;

alter table public.grade_reservations
  alter column usage_date_ph set default ((now() at time zone 'Asia/Manila')::date),
  alter column usage_date_ph set not null,
  alter column examination_track set default 'bar_practice',
  alter column examination_track set not null;

alter table public.grade_reservations
  drop constraint if exists grade_reservations_access_basis_check;
alter table public.grade_reservations
  add constraint grade_reservations_access_basis_check check (access_basis in (
    'super_admin', 'founder_admin', 'free_beta', 'paid_subscription',
    'trial', 'lifetime_free', 'global_beta_all_access', 'founding_beta',
    'early_access', 'provisional_payment', 'daily_free'
  ));
alter table public.grade_reservations
  drop constraint if exists grade_reservations_examination_track_check;
alter table public.grade_reservations
  add constraint grade_reservations_examination_track_check check (
    examination_track in (
      'bar_practice', 'subject_matter', 'mock_bar', 'bar_feels',
      'quiz', 'doctrine_review', 'examination_room'
    )
  );
alter table public.grade_reservations
  drop constraint if exists grade_reservations_batch_ordinal_check;
alter table public.grade_reservations
  add constraint grade_reservations_batch_ordinal_check check (
    batch_ordinal is null or batch_ordinal between 1 and 100
  );

create index if not exists grade_reservations_daily_quota_idx
  on public.grade_reservations (
    user_id, usage_date_ph, consumes_quota, status, reservation_expires_at
  );
create unique index if not exists grade_reservations_session_item_uidx
  on public.grade_reservations (user_id, session_request_key, batch_ordinal)
  where session_request_key is not null and batch_ordinal is not null;

-- ---------------------------------------------------------------------------
-- Founding Beta roster and commercial profile declarations
-- ---------------------------------------------------------------------------

alter table public.free_beta_access
  add column if not exists access_program text not null default 'legacy_beta';
alter table public.free_beta_access
  drop constraint if exists free_beta_access_program_check;
alter table public.free_beta_access
  add constraint free_beta_access_program_check check (
    access_program in ('legacy_beta', 'founding_beta_2026')
  );

create table if not exists public.founding_beta_invites (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  access_ends_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'revoked')),
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'claimed' and claimed_user_id is not null and claimed_at is not null)
    or (status <> 'claimed')
  )
);

-- Approved roster: SHA-256(lower(trim(email))) only. Plaintext addresses are
-- deliberately absent from the repository and database.
insert into public.founding_beta_invites (email_hash, access_ends_at)
select email_hash, '2026-09-01 23:59:59+08'::timestamptz
from unnest(array[
  'ba9a75bf1d7dce6abfc3c66f3b9dafc1c496cb64f1a5db69adc94adf1043de8a',
  '255357802e1657545085ed127c3612c08ae3d5dd93870040f782661e62ca4f12',
  '8442eeaa176fad4eb8d280926c6b23e89009ccc41c8ada1f58483de80237d8ff',
  '005913b0a5ab10a737212235cf55f838401452c789abf8ef7f890d512f42325b',
  '853f72f294a02867ff94dc1e362f481b6ab0c0e820b589e24bcc9cd774d7dbe4',
  '33ed905329c5c1efd2a5d79fb8d1e0288cfc2d6813c3b959fbd4ee788a30e71a',
  'fe60c21316e5cfd88b5c71e430dd35f45fc038ab484d3305b1f5f4296159ccc1',
  '5099ef0c695e6051e3fda3870f5e3f7eebf84c53d73602ea356bded426aec1bd',
  '71e9aca0da7ee13c87b2a996eac3055c8212737133ff652ea8a4926f8a0cdde8',
  'c4cdd1f37972d906f779df6d2b1ae209bac5cf91bd54032a066cd33ac5361b55',
  '180eb411ec9df3b9aca4e3e6f5819ed11a82df334a4dfa9496aa673e048bf37e',
  'f1db6e4dc87b620dab9d94f27fac7b35589d05a2a6bbe014b0c61a60318ee2cc',
  'ddd9f38d860cb4de5e6b9e463d0ce5006f382f20f46fcb153cfa9db8a2d54490',
  'ddb7a1b9379872742a73917a3a12e44ac02bed59c803837076f2972f0f82191d',
  '8eff7bc58b9fdce49dd73db3d6f3797cd95f3eab73eede4e6c1cfd38b5720fde',
  'fae877626836977e34fc9826bba631f2c9cfb2905ab17f0fe8c6467d1753d688',
  '943f5776182d9e750bfa42e6bec1a59e897e3a86b76b744772a552baac95491f',
  'd50113b5027d7f65eaff06a11141d3ccdb637da5c44d5d789e8b1fedd136149f'
]::text[]) as roster(email_hash)
on conflict (email_hash) do nothing;

alter table public.profiles
  add column if not exists law_school_id text,
  add column if not exists law_school_other text,
  add column if not exists commercial_category text,
  add column if not exists commercial_onboarding_completed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_commercial_category_check;
alter table public.profiles
  add constraint profiles_commercial_category_check check (
    commercial_category is null or commercial_category in (
      'first_year', 'second_year', 'third_year', 'fourth_year',
      'fifth_year', 'review', 'professor'
    )
  );
alter table public.profiles
  drop constraint if exists profiles_law_school_other_check;
alter table public.profiles
  add constraint profiles_law_school_other_check check (
    law_school_other is null
    or char_length(btrim(law_school_other)) between 2 and 180
  );

create table if not exists public.professor_license_declarations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  license_number text not null
    check (char_length(btrim(license_number)) between 3 and 80),
  declaration_version text not null default 'professor-declaration-v1-2026-08-18',
  declared_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Payment proof starts one non-renewable 24-hour provisional entitlement.
alter table public.payment_requests
  add column if not exists provisional_access_started_at timestamptz,
  add column if not exists provisional_access_expires_at timestamptz,
  add column if not exists provisional_access_revoked_at timestamptz;
alter table public.payment_requests
  drop constraint if exists payment_requests_payment_method_check;
alter table public.payment_requests
  add constraint payment_requests_payment_method_check check (
    payment_method in ('gcash', 'maribank', 'bpi_instapay')
  );
alter table public.payment_requests
  drop constraint if exists payment_requests_provisional_window_check;
alter table public.payment_requests
  add constraint payment_requests_provisional_window_check check (
    (provisional_access_started_at is null and provisional_access_expires_at is null)
    or (
      provisional_access_started_at is not null
      and provisional_access_expires_at = provisional_access_started_at + interval '24 hours'
    )
  );

alter table public.refund_requests
  add column if not exists first_access_started_at timestamptz,
  add column if not exists cancellation_effective_at timestamptz,
  add column if not exists entitlement_ends_at timestamptz;

-- A user can receive the one-time provisional Early Access grant only once,
-- and one payment can have at most one refund case even under concurrency.
create unique index if not exists payment_requests_one_early_provisional_per_user_uidx
  on public.payment_requests (user_id)
  where plan_code = 'early_access_beta'
    and provisional_access_started_at is not null;
create unique index if not exists refund_requests_one_per_payment_uidx
  on public.refund_requests (payment_request_id);

-- Preserve the existing mailboxes and add only the approved commercial mailbox.
alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_recipient_mailbox_check;
alter table public.outbound_notifications
  add constraint outbound_notifications_recipient_mailbox_check check (
    recipient_mailbox in (
      'plansandpricing@duediligence.ph',
      'premium@duediligence.ph',
      'founders@duediligence.ph',
      'support@duediligence.ph'
    )
  );

insert into public.commercial_launch_rollback_snapshots (
  singleton, previous_settings, previous_plan_catalog
)
select
  true,
  to_jsonb(s),
  coalesce((select jsonb_agg(to_jsonb(p) order by p.plan_code)
            from public.plan_catalog p), '[]'::jsonb)
from public.platform_access_settings s
where s.singleton = true
on conflict (singleton) do nothing;

-- Preserve historical plans and transactions while retiring those plans from
-- all new public checkout paths.
update public.plan_catalog
set display_name = 'Early Access',
    price_php = 149.00,
    status = 'active',
    description = 'One-time Early Access through October 1, 2026 at 11:59 PM (Asia/Manila).',
    features = '[
      "Unlimited successful submissions through October 1, 2026",
      "All Due Diligence examination tracks",
      "AI grading and source-based review",
      "One-time payment with no automatic renewal"
    ]'::jsonb,
    duration_days = null,
    display_order = 10,
    promotional = true,
    checkout_enabled = true,
    note = 'One-time payment. No automatic renewal. Later pricing is unannounced.',
    updated_at = now()
where plan_code = 'early_access_beta';

update public.plan_catalog
set status = 'retired', checkout_enabled = false, promotional = false,
    note = 'Historical records are preserved; this plan is not available for new checkout.',
    updated_at = now()
where plan_code in ('standard', 'premium');

-- Preserve the historical flags while ending both former public treatments.
update public.dd2026_feature_flags
set enabled = false, updated_at = now()
where flag_key in ('VERDICT_PDF_PREMIUM_REQUIRED', 'AI_PREPARED_BETA_BADGE');

-- Premium once required an explicit future date.  Historical rows retain
-- their dates, but the public plan is no longer purchasable.
alter table public.subscriptions
  drop constraint if exists subscriptions_premium_expiry_required_check;

create or replace function public.phase4_ph_date(p_at timestamptz default clock_timestamp())
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (p_at at time zone 'Asia/Manila')::date;
$$;

create or replace function public.phase4_ph_reset_at(p_at timestamptz default clock_timestamp())
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select to_char(
    ((p_at at time zone 'Asia/Manila')::date + 1)::timestamp,
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) || '+08:00';
$$;

-- Claiming requires the trusted Worker to supply a SHA-256 hash of the
-- authenticated email.  The database never stores the source email address.
create or replace function public.phase4_claim_founding_beta(
  p_user_id uuid,
  p_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.founding_beta_invites%rowtype;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;
  if lower(coalesce(p_email_hash, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid normalized email hash required';
  end if;
  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.email is not null
      and encode(
        extensions.digest(lower(btrim(u.email)), 'sha256'),
        'hex'
      ) = lower(p_email_hash)
  ) then
    raise exception 'Authenticated email hash does not match user';
  end if;

  select * into v_invite
  from public.founding_beta_invites
  where email_hash = lower(p_email_hash)
  for update;

  if not found or v_invite.status = 'revoked' then
    return jsonb_build_object('claimed', false);
  end if;
  if v_invite.status = 'claimed' and v_invite.claimed_user_id <> p_user_id then
    return jsonb_build_object('claimed', false);
  end if;

  update public.founding_beta_invites
  set status = 'claimed', claimed_user_id = p_user_id,
      claimed_at = coalesce(claimed_at, now()), updated_at = now()
  where email_hash = lower(p_email_hash);

  insert into public.free_beta_access (
    user_id, enabled, expires_at, reason, created_by, updated_by, access_program
  ) values (
    p_user_id, true, v_invite.access_ends_at,
    'Approved 2026 Founding Beta complimentary access.',
    p_user_id, p_user_id, 'founding_beta_2026'
  )
  on conflict (user_id) do update
  set enabled = true,
      expires_at = excluded.expires_at,
      reason = excluded.reason,
      updated_at = now(),
      updated_by = excluded.updated_by,
      access_program = excluded.access_program;

  return jsonb_build_object(
    'claimed', true,
    'accessEndsAt', v_invite.access_ends_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative access snapshot
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
  v_beta public.free_beta_access%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_payment public.payment_requests%rowtype;
  v_trial public.access_trials%rowtype;
  v_legacy_used integer := 0;
  v_completed integer := 0;
  v_reserved integer := 0;
  v_remaining integer := 0;
  v_basis text := 'locked';
  v_access_mode text := 'locked';
  v_account_label text := 'Unavailable';
  v_allowed boolean := false;
  v_unlimited boolean := false;
  v_checkout_open boolean := false;
  v_entitlement_ends_at timestamptz;
  v_payment_state text;
  v_email_hash text;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;

  select * into strict v_settings
  from public.platform_access_settings where singleton = true;
  select encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex')
  into v_email_hash
  from auth.users
  where id = p_user_id and email is not null;
  if v_email_hash is not null then
    perform public.phase4_claim_founding_beta(p_user_id, v_email_hash);
  end if;
  select coalesce(role, 'student') into v_role
  from public.user_roles where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');
  select exists (
    select 1 from public.terms_acceptances
    where user_id = p_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) into v_terms_ok;

  select * into v_beta from public.free_beta_access where user_id = p_user_id;
  select * into v_subscription
  from public.subscriptions
  where user_id = p_user_id
    and status = 'active'
    and starts_at <= v_now
    and (expires_at is null or expires_at > v_now)
  order by expires_at desc nulls first, updated_at desc
  limit 1;
  select * into v_payment
  from public.payment_requests
  where user_id = p_user_id
    and plan_code = 'early_access_beta'
    and status in ('pending', 'needs_information')
    and provisional_access_started_at is not null
    and provisional_access_expires_at > v_now
    and provisional_access_revoked_at is null
  order by submitted_at desc
  limit 1;
  select * into v_trial from public.access_trials where user_id = p_user_id;
  select coalesce(successful_grades, 0) into v_legacy_used
  from public.lifetime_grade_usage where user_id = p_user_id;
  v_legacy_used := coalesce(v_legacy_used, 0);

  select
    count(*) filter (
      where status = 'completed'
        and usage_date_ph = public.phase4_ph_date(v_now)
    ),
    count(*) filter (
      where status = 'reserved' and reservation_expires_at > v_now
    )
  into v_completed, v_reserved
  from public.grade_reservations
  where user_id = p_user_id
    and consumes_quota;
  v_completed := coalesce(v_completed, 0);
  v_reserved := coalesce(v_reserved, 0);
  v_remaining := greatest(0, v_settings.free_daily_grade_limit - v_completed - v_reserved);

  v_checkout_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and v_now <= v_settings.early_access_sales_close_at
    and exists (
      select 1 from public.plan_catalog
      where plan_code = 'early_access_beta'
        and status = 'active' and checkout_enabled and price_php = 149.00
    );

  if v_terms_ok then
    if v_role = 'super_admin' then
      v_allowed := true; v_unlimited := true;
      v_basis := 'super_admin'; v_access_mode := 'administrator';
      v_account_label := 'Administrator';
    elsif v_role = 'founder_admin' then
      v_allowed := true; v_unlimited := true;
      v_basis := 'founder_admin'; v_access_mode := 'administrator';
      v_account_label := 'Administrator';
    elsif v_settings.global_beta_all_access_enabled then
      -- This compatibility bridge remains active until the final release step.
      v_allowed := true; v_unlimited := true;
      v_basis := 'global_beta_all_access'; v_access_mode := 'global_beta';
      v_account_label := 'All Access';
    elsif v_settings.commercial_launch_enabled then
      if coalesce(v_beta.enabled, false)
         and v_beta.access_program = 'founding_beta_2026'
         and v_beta.expires_at > v_now then
        v_allowed := true; v_unlimited := true;
        v_basis := 'founding_beta'; v_access_mode := 'founding_beta';
        v_account_label := 'Founding Beta';
        v_entitlement_ends_at := v_beta.expires_at;
      elsif v_subscription.id is not null then
        v_allowed := true; v_unlimited := true;
        v_basis := case when v_subscription.plan_code = 'early_access_beta'
          then 'early_access' else 'paid_subscription' end;
        v_access_mode := case when v_subscription.plan_code = 'early_access_beta'
          then 'early_access' else 'legacy_paid' end;
        v_account_label := case when v_subscription.plan_code = 'early_access_beta'
          then 'Early Access' else 'Paid Access' end;
        v_entitlement_ends_at := v_subscription.expires_at;
      elsif v_payment.id is not null then
        v_allowed := true; v_unlimited := true;
        v_basis := 'provisional_payment'; v_access_mode := 'provisional';
        v_account_label := 'Early Access — pending';
        v_entitlement_ends_at := v_payment.provisional_access_expires_at;
        v_payment_state := v_payment.status;
      elsif v_remaining > 0 then
        v_allowed := true; v_unlimited := false;
        v_basis := 'daily_free'; v_access_mode := 'free';
        v_account_label := 'Free';
      else
        v_basis := 'daily_limit_reached'; v_access_mode := 'free';
        v_account_label := 'Free';
      end if;
    else
      -- Pre-activation compatibility preserves the existing production policy.
      if coalesce(v_beta.enabled, false)
         and (v_beta.expires_at is null or v_beta.expires_at > v_now) then
        v_allowed := true; v_unlimited := true;
        v_basis := 'free_beta'; v_access_mode := 'legacy_beta';
        v_account_label := 'Beta Access';
      elsif v_subscription.id is not null then
        v_allowed := true; v_unlimited := true;
        v_basis := 'paid_subscription'; v_access_mode := 'legacy_paid';
        v_account_label := 'Paid Access';
      elsif v_trial.user_id is not null and v_trial.expires_at > v_now then
        v_allowed := true; v_unlimited := true;
        v_basis := 'trial'; v_access_mode := 'trial';
        v_account_label := 'Trial';
      elsif v_legacy_used < v_settings.lifetime_free_grades then
        v_allowed := true; v_unlimited := false;
        v_basis := 'lifetime_free'; v_access_mode := 'legacy_free';
        v_account_label := 'Free';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'basis', v_basis,
    'termsRequired', not v_terms_ok,
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'dailyLimit', v_settings.free_daily_grade_limit,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'remainingToday', case when v_unlimited then v_settings.free_daily_grade_limit else v_remaining end,
    'resetAt', public.phase4_ph_reset_at(v_now),
    'checkoutOpen', v_checkout_open,
    'priceCentavos', 14900,
    'salesCloseAt', v_settings.early_access_sales_close_at,
    'entitlementEndsAt', v_entitlement_ends_at,
    'paymentState', v_payment_state,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'globalBeta', jsonb_build_object(
      'enabled', v_settings.global_beta_all_access_enabled,
      'eligible', v_settings.global_beta_all_access_enabled,
      'active', v_settings.global_beta_all_access_enabled and v_terms_ok,
      'expiresAt', null
    ),
    'freeGrades', jsonb_build_object(
      'limit', case when v_settings.commercial_launch_enabled
        then v_settings.free_daily_grade_limit else v_settings.lifetime_free_grades end,
      'used', case when v_settings.commercial_launch_enabled then v_completed else v_legacy_used end,
      'remaining', case when v_settings.commercial_launch_enabled then v_remaining
        else greatest(0, v_settings.lifetime_free_grades - v_legacy_used) end
    ),
    'freeBeta', jsonb_build_object(
      'enabled', coalesce(v_beta.enabled, false),
      'expiresAt', v_beta.expires_at,
      'active', coalesce(v_beta.enabled and (v_beta.expires_at is null or v_beta.expires_at > v_now), false),
      'program', v_beta.access_program
    ),
    'subscription', case when v_subscription.id is null then null else
      jsonb_build_object(
        'id', v_subscription.id, 'planCode', v_subscription.plan_code,
        'status', v_subscription.status, 'source', v_subscription.source,
        'startsAt', v_subscription.starts_at, 'expiresAt', v_subscription.expires_at
      ) end
  );
end;
$$;

create or replace function public.phase4_user_subscription_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access jsonb;
  v_pending jsonb;
begin
  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  select jsonb_build_object(
    'id', p.id,
    'planCode', p.plan_code,
    'amountPhp', p.trusted_amount_php,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'provisionalAccessStartedAt', p.provisional_access_started_at,
    'provisionalAccessExpiresAt', p.provisional_access_expires_at,
    'provisionalAccessActive', p.provisional_access_started_at is not null
      and p.provisional_access_expires_at > clock_timestamp()
      and p.provisional_access_revoked_at is null
  ) into v_pending
  from public.payment_requests p
  where p.user_id = p_user_id
    and p.status in ('pending','needs_information')
  order by p.submitted_at desc
  limit 1;
  return jsonb_build_object(
    'accessMode', v_access->>'accessMode',
    'accountLabel', v_access->>'accountLabel',
    'unlimited', coalesce((v_access->>'unlimited')::boolean, false),
    'dailyLimit', (v_access->>'dailyLimit')::integer,
    'completedToday', (v_access->>'completedToday')::integer,
    'reservedToday', (v_access->>'reservedToday')::integer,
    'remainingToday', (v_access->>'remainingToday')::integer,
    'resetAt', v_access->>'resetAt',
    'checkoutOpen', coalesce((v_access->>'checkoutOpen')::boolean, false),
    'priceCentavos', (v_access->>'priceCentavos')::integer,
    'salesCloseAt', v_access->>'salesCloseAt',
    'entitlementEndsAt', v_access->>'entitlementEndsAt',
    'globalBeta', v_access->'globalBeta',
    'subscription', v_access->'subscription',
    'pendingPayment', v_pending,
    'examinationBeta', null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic single and multi-question quota reservations
-- ---------------------------------------------------------------------------

create or replace function public.phase4_reserve_grade_v2(
  p_user_id uuid,
  p_request_key text,
  p_question_bank_id text,
  p_examination_track text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_access jsonb;
  v_existing public.grade_reservations%rowtype;
  v_reservation_id uuid;
  v_count integer := 0;
  v_basis text;
  v_consumes boolean := false;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid grading request key';
  end if;
  if char_length(btrim(coalesce(p_question_bank_id, ''))) not between 3 and 100 then
    raise exception 'Invalid question identifier';
  end if;
  if p_examination_track not in (
    'bar_practice','subject_matter','mock_bar','bar_feels',
    'quiz','doctrine_review','examination_room'
  ) then
    raise exception 'Invalid examination track';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_existing from public.grade_reservations
  where request_key = p_request_key for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.question_bank_id <> btrim(p_question_bank_id)
       or v_existing.examination_track <> p_examination_track then
      raise exception 'Grading request key conflict';
    end if;
    if v_existing.status in ('reserved','completed') then
      return jsonb_build_object(
        'allowed', true,
        'reason', case when v_existing.status = 'reserved'
          then 'duplicate_active' else 'duplicate_completed' end,
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'accessBasis', v_existing.access_basis,
        'replayed', true
      );
    end if;
    if v_existing.status in ('released','expired')
       and coalesce(v_existing.release_reason, '') not in (
         'provider_capacity','provider_rate_limit','provider_timeout','provider_unavailable',
         'grading_failed','network_failure'
       ) then
      return jsonb_build_object(
        'allowed', false, 'reason', 'duplicate_closed',
        'reservationId', v_existing.id, 'replayed', true
      );
    end if;
  end if;

  update public.grade_reservations
  set status = 'expired', released_at = v_now, release_reason = 'reservation_timeout'
  where user_id = p_user_id and status = 'reserved'
    and reservation_expires_at <= v_now;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('reservationId', null, 'replayed', false);
  end if;
  v_basis := v_access->>'basis';
  v_consumes := v_settings.commercial_launch_enabled
    and not coalesce((v_access->>'unlimited')::boolean, false);

  if v_consumes then
    select count(*) into v_count
    from public.grade_reservations
    where user_id = p_user_id and consumes_quota
      and (
        (status = 'completed' and usage_date_ph = public.phase4_ph_date(v_now))
        or (status = 'reserved' and reservation_expires_at > v_now)
      );
    if v_count >= v_settings.free_daily_grade_limit then
      return public.phase4_access_snapshot(p_user_id, false, null)
        || jsonb_build_object('allowed', false, 'reason', 'daily_limit_reached', 'reservationId', null);
    end if;
  elsif not v_settings.commercial_launch_enabled and v_basis = 'lifetime_free' then
    select coalesce(successful_grades, 0) into v_count
    from public.lifetime_grade_usage where user_id = p_user_id;
    v_count := coalesce(v_count, 0) + (
      select count(*) from public.grade_reservations
      where user_id = p_user_id and status = 'reserved' and reservation_expires_at > v_now
    );
    if v_count >= v_settings.lifetime_free_grades then
      return v_access || jsonb_build_object(
        'allowed', false, 'reason', 'lifetime_free_grades_exhausted', 'reservationId', null
      );
    end if;
  end if;

  if v_existing.id is not null then
    update public.grade_reservations
    set status = 'reserved', access_basis = v_basis, reserved_at = v_now,
        reservation_expires_at = v_now + interval '20 minutes',
        completed_at = null, released_at = null, release_reason = null,
        usage_date_ph = public.phase4_ph_date(v_now),
        examination_track = p_examination_track,
        consumes_quota = v_consumes
    where id = v_existing.id returning id into v_reservation_id;
  else
    insert into public.grade_reservations (
      user_id, request_key, question_bank_id, access_basis,
      usage_date_ph, examination_track, consumes_quota
    ) values (
      p_user_id, p_request_key, btrim(p_question_bank_id), v_basis,
      public.phase4_ph_date(v_now), p_examination_track, v_consumes
    ) returning id into v_reservation_id;
  end if;

  return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
    'allowed', true, 'reservationId', v_reservation_id, 'status', 'reserved',
    'accessBasis', v_basis, 'replayed', v_existing.id is not null
  );
end;
$$;

create or replace function public.phase4_reserve_grade_v2(
  p_user_id uuid,
  p_request_key text,
  p_question_bank_id text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.phase4_reserve_grade_v2(
    p_user_id, p_request_key, p_question_bank_id, 'bar_practice'
  );
$$;

create or replace function public.phase4_reserve_submission_batch(
  p_user_id uuid,
  p_request_key text,
  p_examination_track text,
  p_external_resource_id text,
  p_required_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_access jsonb;
  v_basis text;
  v_consumes boolean;
  v_existing integer := 0;
  v_used integer := 0;
  v_i integer;
  v_item_key text;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or char_length(btrim(coalesce(p_external_resource_id, ''))) not between 3 and 100
     or p_required_count not between 1 and 100 then
    raise exception 'Invalid submission reservation request';
  end if;
  if p_examination_track not in (
    'subject_matter','mock_bar','bar_feels','examination_room'
  ) then
    raise exception 'Invalid batch examination track';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_settings from public.platform_access_settings where singleton = true;

  select count(*) into v_existing
  from public.grade_reservations
  where user_id = p_user_id and session_request_key = p_request_key;
  if v_existing > 0 then
    if v_existing <> p_required_count or exists (
      select 1 from public.grade_reservations
      where user_id = p_user_id and session_request_key = p_request_key
        and (examination_track <> p_examination_track
          or external_resource_id <> btrim(p_external_resource_id))
    ) then
      raise exception 'Submission reservation request conflict';
    end if;
    return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
      'allowed', not exists (
        select 1 from public.grade_reservations
        where user_id = p_user_id and session_request_key = p_request_key
          and (
            status = 'expired'
            or (status = 'released' and coalesce(release_reason, '') <> 'unused_session_hold')
          )
      ),
      'heldCount', v_existing,
      'sessionRequestKey', p_request_key,
      'replayed', true
    );
  end if;

  update public.grade_reservations
  set status = 'expired', released_at = v_now, release_reason = 'reservation_timeout'
  where user_id = p_user_id and status = 'reserved'
    and reservation_expires_at <= v_now;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('heldCount', 0, 'replayed', false);
  end if;
  v_basis := v_access->>'basis';
  v_consumes := v_settings.commercial_launch_enabled
    and not coalesce((v_access->>'unlimited')::boolean, false);

  if v_consumes then
    select count(*) into v_used
    from public.grade_reservations
    where user_id = p_user_id and consumes_quota
      and (
        (status = 'completed' and usage_date_ph = public.phase4_ph_date(v_now))
        or (status = 'reserved' and reservation_expires_at > v_now)
      );
    if v_used + p_required_count > v_settings.free_daily_grade_limit then
      return public.phase4_access_snapshot(p_user_id, false, null)
        || jsonb_build_object(
          'allowed', false, 'reason', 'insufficient_daily_allowance',
          'requiredCount', p_required_count, 'heldCount', 0, 'replayed', false
        );
    end if;
  end if;

  for v_i in 1..p_required_count loop
    v_item_key := encode(extensions.digest(p_request_key || ':' || v_i::text, 'sha256'), 'hex');
    insert into public.grade_reservations (
      user_id, request_key, question_bank_id, access_basis,
      usage_date_ph, examination_track, consumes_quota,
      session_request_key, external_resource_id, batch_ordinal,
      reservation_expires_at
    ) values (
      p_user_id, v_item_key,
      left(p_examination_track || ':' || btrim(p_external_resource_id) || ':' || v_i::text, 100),
      v_basis, public.phase4_ph_date(v_now), p_examination_track, v_consumes,
      p_request_key, btrim(p_external_resource_id), v_i,
      v_now + interval '6 hours'
    );
  end loop;

  return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
    'allowed', true, 'requiredCount', p_required_count,
    'heldCount', p_required_count, 'sessionRequestKey', p_request_key,
    'replayed', false
  );
end;
$$;

create or replace function public.phase4_finalize_submission_batch(
  p_user_id uuid,
  p_session_request_key text,
  p_completed_count integer,
  p_release_reason text default 'unused_session_hold'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_now timestamptz := clock_timestamp();
  v_completed integer := 0;
  v_released integer := 0;
  v_reserved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select count(*) into v_total
  from public.grade_reservations
  where user_id = p_user_id and session_request_key = p_session_request_key;
  if v_total = 0 then raise exception 'Submission reservation not found'; end if;
  if p_completed_count < 0 or p_completed_count > v_total then
    raise exception 'Invalid completed submission count';
  end if;

  update public.grade_reservations
  set status = 'expired', released_at = v_now,
      release_reason = 'reservation_timeout'
  where user_id = p_user_id and session_request_key = p_session_request_key
    and status = 'reserved' and reservation_expires_at <= v_now;

  select
    count(*) filter (where status = 'completed'),
    count(*) filter (where status in ('released','expired')),
    count(*) filter (where status = 'reserved')
  into v_completed, v_released, v_reserved
  from public.grade_reservations
  where user_id = p_user_id and session_request_key = p_session_request_key;

  if v_reserved = 0 then
    if p_completed_count <> v_completed then
      raise exception 'Submission reservation replay conflicts with recorded outcome';
    end if;
    return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
      'completed', true, 'completedCount', v_completed,
      'releasedCount', v_released, 'replayed', true
    );
  end if;
  if p_completed_count < v_completed
     or p_completed_count > v_completed + v_reserved then
    raise exception 'Submission reservation completion count cannot be satisfied';
  end if;

  update public.grade_reservations
  set status = 'completed', completed_at = coalesce(completed_at, v_now),
      usage_date_ph = public.phase4_ph_date(v_now),
      released_at = null, release_reason = null
  where user_id = p_user_id and session_request_key = p_session_request_key
    and batch_ordinal <= p_completed_count and status = 'reserved';

  update public.grade_reservations
  set status = 'released', released_at = v_now,
      release_reason = left(coalesce(nullif(btrim(p_release_reason), ''), 'unused_session_hold'), 200)
  where user_id = p_user_id and session_request_key = p_session_request_key
    and batch_ordinal > p_completed_count and status = 'reserved';

  select
    count(*) filter (where status = 'completed'),
    count(*) filter (where status in ('released','expired'))
  into v_completed, v_released
  from public.grade_reservations
  where user_id = p_user_id and session_request_key = p_session_request_key;

  return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
    'completed', true, 'completedCount', v_completed,
    'releasedCount', v_released, 'replayed', false
  );
end;
$$;

create or replace function public.phase4_release_submission_batch(
  p_user_id uuid,
  p_session_request_key text,
  p_reason text default 'session_failed'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.grade_reservations
  set status = 'released', released_at = now(),
      release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'session_failed'), 200)
  where user_id = p_user_id and session_request_key = p_session_request_key
    and status = 'reserved';
end;
$$;

-- Examination Room reservations are derived entirely from immutable server
-- records. The browser never chooses the held count or reservation identity.
create or replace function public.phase4_exam_room_reservation_key(
  p_user_id uuid,
  p_exam_id uuid
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(
      pg_catalog.convert_to(
        'exam-room:' || p_user_id::text || ':' || p_exam_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.phase4_prepare_exam_room_hold(
  p_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_required integer;
  v_session_key text;
  v_hold jsonb;
begin
  select * into v_exam
  from public.exam_room_exams
  where public_id = p_exam_public_id
  for share;
  if not found or v_exam.current_publication_id is null then
    raise exception 'EXAM_ROOM_EXAM_NOT_PUBLISHED';
  end if;

  select * into strict v_publication
  from public.exam_room_publications
  where id = v_exam.current_publication_id;
  select count(*) into v_required
  from public.exam_room_questions
  where question_version_id = v_publication.question_version_id;
  if v_required < 1 or v_required > 100 then
    raise exception 'EXAM_ROOM_QUESTION_COUNT_INVALID';
  end if;

  v_session_key := public.phase4_exam_room_reservation_key(p_user_id, v_exam.id);
  v_hold := public.phase4_reserve_submission_batch(
    p_user_id,
    v_session_key,
    'examination_room',
    v_exam.public_id::text,
    v_required
  );
  return (v_hold - 'sessionRequestKey') || jsonb_build_object(
    'requiredCount', v_required,
    'examId', v_exam.public_id
  );
end;
$$;

create or replace function public.phase4_exam_room_allowance_preview(
  p_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_question_version_id uuid;
  v_required integer;
  v_access jsonb;
  v_sufficient boolean;
begin
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id;
  if not found or v_exam.current_publication_id is null then
    return jsonb_build_object(
      'available', false,
      'code', 'EXAM_ROOM_EXAM_NOT_PUBLISHED'
    );
  end if;
  select question_version_id into strict v_question_version_id
  from public.exam_room_publications
  where id = v_exam.current_publication_id;
  select count(*) into v_required from public.exam_room_questions
  where question_version_id = v_question_version_id;
  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  v_sufficient := coalesce((v_access ->> 'unlimited')::boolean, false)
    or coalesce((v_access ->> 'remainingToday')::integer, 0) >= v_required;
  return jsonb_build_object(
    'available', true,
    'requiredCount', v_required,
    'remainingToday', coalesce((v_access ->> 'remainingToday')::integer, 0),
    'dailyLimit', coalesce((v_access ->> 'dailyLimit')::integer, 5),
    'unlimited', coalesce((v_access ->> 'unlimited')::boolean, false),
    'sufficient', v_sufficient,
    'resetAt', v_access -> 'resetAt',
    'accountLabel', v_access -> 'accountLabel'
  );
end;
$$;

create or replace function public.phase4_extend_exam_room_hold(
  p_user_id uuid,
  p_attempt_public_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session_key text;
begin
  select * into strict v_attempt
  from public.exam_room_attempts
  where public_id = p_attempt_public_id
    and student_user_id = p_user_id;
  v_session_key := public.phase4_exam_room_reservation_key(
    p_user_id,
    v_attempt.exam_id
  );
  update public.grade_reservations
  set reservation_expires_at = greatest(
        reservation_expires_at,
        v_attempt.server_deadline + interval '15 minutes'
      )
  where user_id = p_user_id
    and session_request_key = v_session_key
    and status = 'reserved';
end;
$$;

create or replace function public.exam_room_start_attempt_commercial_v1(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preflight jsonb;
  v_hold jsonb;
  v_result jsonb;
begin
  v_preflight := public.exam_room_student_waiting_room_v4(
    p_student_user_id,
    p_exam_public_id,
    p_student_key_hash,
    p_rate_key_hash,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return public.exam_room_start_attempt_v4(
      p_student_user_id,
      p_exam_public_id,
      p_student_key_hash,
      p_rate_key_hash
    );
  end if;

  v_hold := public.phase4_prepare_exam_room_hold(
    p_student_user_id,
    p_exam_public_id
  );
  if not coalesce((v_hold ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'EXAM_ROOM_INSUFFICIENT_DAILY_ALLOWANCE',
      'message', 'This examination needs more successful submissions than remain in today''s Free allowance.',
      'requiredCount', v_hold -> 'requiredCount',
      'remainingToday', v_hold -> 'remainingToday',
      'resetAt', v_hold -> 'resetAt',
      'access', v_hold
    );
  end if;

  v_result := public.exam_room_start_attempt_v4(
    p_student_user_id,
    p_exam_public_id,
    p_student_key_hash,
    p_rate_key_hash
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    perform public.phase4_release_submission_batch(
      p_student_user_id,
      public.phase4_exam_room_reservation_key(
        p_student_user_id,
        (select id from public.exam_room_exams where public_id = p_exam_public_id)
      ),
      'exam_start_failed'
    );
    return v_result;
  end if;
  perform public.phase4_extend_exam_room_hold(
    p_student_user_id,
    (v_result ->> 'attemptId')::uuid
  );
  return v_result || jsonb_build_object(
    'quotaHold', v_hold - 'examId'
  );
end;
$$;

create or replace function public.exam_room_start_attempt_by_code_commercial_v1(
  p_student_user_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text,
  p_code_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preflight jsonb;
  v_exam_public_id uuid;
begin
  v_preflight := public.exam_room_student_waiting_room_by_code_v1(
    p_student_user_id,
    p_student_key_hash,
    p_rate_key_hash,
    p_code_fingerprint,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_preflight ->> 'startBlockerCode', v_preflight ->> 'code'),
      'serverNow', v_preflight -> 'serverNow',
      'opensAt', v_preflight -> 'opensAt',
      'entryClosesAt', v_preflight -> 'entryClosesAt'
    );
  end if;
  v_exam_public_id := (v_preflight ->> 'examId')::uuid;
  return public.exam_room_start_attempt_commercial_v1(
    p_student_user_id,
    v_exam_public_id,
    p_student_key_hash,
    p_rate_key_hash
  );
end;
$$;

create or replace function public.exam_room_start_beadle_attempt_commercial_v1(
  p_user_id uuid,
  p_exam_public_id uuid,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preflight jsonb;
  v_hold jsonb;
  v_result jsonb;
  v_exam_id uuid;
begin
  v_preflight := public.exam_room_beadle_student_waiting_room_v1(
    p_user_id,
    p_exam_public_id,
    p_rate_key_hash,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return public.exam_room_start_beadle_student_attempt_v1(
      p_user_id,
      p_exam_public_id,
      p_rate_key_hash
    );
  end if;

  v_hold := public.phase4_prepare_exam_room_hold(p_user_id, p_exam_public_id);
  if not coalesce((v_hold ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'EXAM_ROOM_INSUFFICIENT_DAILY_ALLOWANCE',
      'message', 'This examination needs more successful submissions than remain in today''s Free allowance.',
      'requiredCount', v_hold -> 'requiredCount',
      'remainingToday', v_hold -> 'remainingToday',
      'resetAt', v_hold -> 'resetAt',
      'access', v_hold,
      'beadleDirectEntry', true
    );
  end if;

  v_result := public.exam_room_start_beadle_student_attempt_v1(
    p_user_id,
    p_exam_public_id,
    p_rate_key_hash
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    select id into v_exam_id from public.exam_room_exams
    where public_id = p_exam_public_id;
    perform public.phase4_release_submission_batch(
      p_user_id,
      public.phase4_exam_room_reservation_key(p_user_id, v_exam_id),
      'exam_start_failed'
    );
    return v_result;
  end if;
  perform public.phase4_extend_exam_room_hold(
    p_user_id,
    (v_result ->> 'attemptId')::uuid
  );
  return v_result || jsonb_build_object(
    'quotaHold', v_hold - 'examId',
    'beadleDirectEntry', true
  );
end;
$$;

-- Every submission path, including deadline auto-submit, inserts the immutable
-- snapshot below. Finalizing quota here prevents a Worker-only path from
-- missing an automatic submission while leaving legacy attempts untouched.
create or replace function public.phase4_finalize_exam_room_quota_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session_key text;
  v_completed integer := 0;
begin
  select * into strict v_attempt
  from public.exam_room_attempts
  where id = new.attempt_id;
  v_session_key := public.phase4_exam_room_reservation_key(
    v_attempt.student_user_id,
    v_attempt.exam_id
  );
  if not exists (
    select 1 from public.grade_reservations
    where user_id = v_attempt.student_user_id
      and session_request_key = v_session_key
      and status = 'reserved'
  ) then
    return new;
  end if;

  select count(*) into v_completed
  from jsonb_array_elements(coalesce(new.answer_snapshot, '[]'::jsonb)) item
  where char_length(btrim(coalesce(item ->> 'answerText', ''))) > 0;
  perform public.phase4_finalize_submission_batch(
    v_attempt.student_user_id,
    v_session_key,
    v_completed,
    'unused_exam_room_hold'
  );
  return new;
end;
$$;

drop trigger if exists phase4_finalize_exam_room_quota_trigger
  on public.exam_room_submissions;
create trigger phase4_finalize_exam_room_quota_trigger
after insert on public.exam_room_submissions
for each row execute function public.phase4_finalize_exam_room_quota_on_submission();

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
  v_now timestamptz := clock_timestamp();
  v_reservation public.grade_reservations%rowtype;
  v_settings public.platform_access_settings%rowtype;
  v_used integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into strict v_reservation
  from public.grade_reservations
  where id = p_reservation_id and user_id = p_user_id
  for update;

  if v_reservation.status = 'completed' then
    return public.phase4_access_snapshot(p_user_id, false, null)
      || jsonb_build_object('completed', true, 'replayed', true);
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'Grade reservation is no longer active';
  end if;
  if v_reservation.reservation_expires_at <= v_now then
    update public.grade_reservations
    set status = 'expired', released_at = v_now,
        release_reason = 'reservation_timeout'
    where id = p_reservation_id and status = 'reserved';
    raise exception 'Grade reservation expired';
  end if;

  update public.grade_reservations
  set status = 'completed', completed_at = v_now,
      usage_date_ph = public.phase4_ph_date(v_now)
  where id = p_reservation_id;

  if not v_settings.commercial_launch_enabled
     and v_reservation.access_basis = 'lifetime_free' then
    insert into public.lifetime_grade_usage (
      user_id, successful_grades, first_success_at, third_success_at, updated_at
    ) values (p_user_id, 1, now(), null, now())
    on conflict (user_id) do update
    set successful_grades = least(3, public.lifetime_grade_usage.successful_grades + 1),
        first_success_at = coalesce(public.lifetime_grade_usage.first_success_at, now()),
        third_success_at = case
          when public.lifetime_grade_usage.successful_grades + 1 >= 3
            then coalesce(public.lifetime_grade_usage.third_success_at, now())
          else public.lifetime_grade_usage.third_success_at end,
        updated_at = now()
    returning successful_grades into v_used;
  end if;

  return public.phase4_access_snapshot(p_user_id, false, null)
    || jsonb_build_object('completed', true, 'replayed', false, 'used', v_used);
end;
$$;

-- Persist learning outcomes and consume the reserved use in one transaction.
-- If either operation fails, both roll back and the Worker releases the hold.
create or replace function public.dd2026_record_bar_easy_completion_commercial(
  p_user_id uuid,
  p_content_id text,
  p_request_key text,
  p_grader_model text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_completion jsonb;
  v_access jsonb;
begin
  v_completion := public.dd2026_record_bar_easy_completion(
    p_user_id, p_content_id, p_request_key, p_grader_model
  );
  v_access := public.phase4_finalize_grade(p_user_id, p_reservation_id);
  return v_completion || jsonb_build_object('access', v_access);
end;
$$;

create or replace function public.dd2026_record_doctrine_mastery_commercial(
  p_user_id uuid,
  p_doctrine_id text,
  p_mastery_result text,
  p_request_key text,
  p_grader_model text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_completion jsonb;
  v_access jsonb;
begin
  v_completion := public.dd2026_record_doctrine_mastery(
    p_user_id, p_doctrine_id, p_mastery_result, p_request_key, p_grader_model
  );
  v_access := public.phase4_finalize_grade(p_user_id, p_reservation_id);
  return v_completion || jsonb_build_object('access', v_access);
end;
$$;

create or replace function public.examination_store_ai_assessment_commercial(
  p_user_id uuid,
  p_job_id uuid,
  p_question_id uuid,
  p_score numeric,
  p_assessment jsonb,
  p_grader_model text,
  p_model_answer_hash text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_access jsonb;
begin
  v_state := public.examination_store_ai_assessment(
    p_user_id, p_job_id, p_question_id, p_score, p_assessment,
    p_grader_model, p_model_answer_hash
  );
  v_access := public.phase4_finalize_grade(p_user_id, p_reservation_id);
  return v_state || jsonb_build_object('access', v_access);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public catalog, provisional access, fixed expiry and refunds
-- ---------------------------------------------------------------------------

create or replace function public.phase4_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.platform_access_settings%rowtype;
  v_open boolean;
  v_early public.plan_catalog%rowtype;
begin
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_early from public.plan_catalog where plan_code = 'early_access_beta';
  v_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and clock_timestamp() <= v_settings.early_access_sales_close_at
    and v_early.status = 'active' and v_early.checkout_enabled;

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'free', 'name', 'Free', 'pricePhp', 0,
      'priceCentavos', 0, 'billing', 'free', 'checkoutEnabled', false,
      'status', 'active', 'displayOrder', 1,
      'description', 'Five successful question submissions per Philippine calendar day.',
      'features', jsonb_build_array(
        'Five successful submissions daily', 'All examination tracks',
        'Allowance resets at Philippine midnight'
      )
    ),
    jsonb_build_object(
      'planCode', 'early_access_beta', 'name', 'Early Access',
      'pricePhp', 149, 'priceCentavos', 14900,
      'billing', 'one_time', 'checkoutEnabled', v_open,
      'status', case when v_open then 'active' else 'closed' end,
      'displayOrder', 2, 'promotional', true,
      'salesCloseAt', v_settings.early_access_sales_close_at,
      'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
      'description', case when v_open
        then '₱149 one-time for unlimited access through October 1, 2026.'
        else 'Next paid-plan pricing will be announced separately.' end,
      'features', v_early.features,
      'note', 'One-time payment. No automatic renewal.'
    )
  );
end;
$$;

create or replace function public.phase4_create_payment_request(
  p_user_id uuid,
  p_plan_code text,
  p_amount_php numeric,
  p_payment_method text,
  p_payment_date date,
  p_transaction_reference text,
  p_student_note text,
  p_proof_object_path text,
  p_proof_original_name text,
  p_proof_mime_type text,
  p_proof_size_bytes integer,
  p_proof_sha256 text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_request public.payment_requests%rowtype;
  v_prior_provisional boolean := false;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'Authenticated user required'; end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'Valid request key required'; end if;
  if lower(btrim(coalesce(p_plan_code, ''))) <> 'early_access_beta'
     or round(coalesce(p_amount_php, 0), 2) <> 149.00 then
    raise exception 'Only the ₱149 Early Access offer is available';
  end if;

  select * into strict v_settings from public.platform_access_settings where singleton = true;
  if not v_settings.commercial_launch_enabled
     or not v_settings.public_pricing_enabled
     or v_now > v_settings.early_access_sales_close_at
     or not exists (
       select 1 from public.plan_catalog where plan_code = 'early_access_beta'
         and status = 'active' and checkout_enabled and price_php = 149.00
     ) then
    raise exception 'Early Access checkout is closed';
  end if;

  select * into v_request from public.payment_requests where request_key = p_request_key;
  if found then
    if v_request.user_id <> p_user_id then raise exception 'Request key already used'; end if;
    return jsonb_build_object(
      'id', v_request.id, 'status', v_request.status,
      'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
      'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_user_id::text, 0));
  select * into v_request
  from public.payment_requests
  where user_id = p_user_id and plan_code = 'early_access_beta'
    and provisional_access_started_at is not null
  order by submitted_at desc limit 1;
  if found then
    v_prior_provisional := true;
    if v_request.status in ('pending','needs_information','approved') then
      return jsonb_build_object(
        'id', v_request.id, 'status', v_request.status,
        'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
        'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
        'provisionalAccessRevokedAt', v_request.provisional_access_revoked_at,
        'replayed', true,
        'provisionalGrantReused', true
      );
    end if;
  end if;

  if p_payment_method <> 'bpi_instapay' then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_date is null or p_payment_date < current_date - 31 or p_payment_date > current_date + 1 then
    raise exception 'Payment date is outside the accepted range';
  end if;

  insert into public.payment_requests (
    user_id, plan_code, trusted_amount_php, payment_method, payment_date,
    transaction_reference, student_note, proof_object_path, proof_original_name,
    proof_mime_type, proof_size_bytes, proof_sha256, request_key,
    provisional_access_started_at, provisional_access_expires_at
  ) values (
    p_user_id, 'early_access_beta', 149.00, p_payment_method, p_payment_date,
    btrim(p_transaction_reference), nullif(btrim(coalesce(p_student_note, '')), ''),
    p_proof_object_path, left(p_proof_original_name, 180), p_proof_mime_type,
    p_proof_size_bytes, lower(p_proof_sha256), p_request_key,
    case when v_prior_provisional then null else v_now end,
    case when v_prior_provisional then null else v_now + interval '24 hours' end
  ) returning * into v_request;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, metadata
  ) values (
    v_request.id, p_user_id, 'submitted', null, 'pending',
    'Student submitted Early Access payment for manual verification.',
    left(p_request_key, 96) || '_history',
    jsonb_build_object('provisionalAccessExpiresAt', v_request.provisional_access_expires_at)
  );
  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  ) values (
    'payment_submitted', 'premium@duediligence.ph',
    'Due Diligence Early Access verification request',
    '/admin/payments?request=' || v_request.id::text,
    'payment_request', v_request.id
  );

  return jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
    'amountCentavos', 14900, 'submittedAt', v_request.submitted_at,
    'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
    'provisionalGrantReused', v_prior_provisional,
    'replayed', false
  );
exception
  when unique_violation then
    if exists (
      select 1 from public.payment_requests
      where payment_method = p_payment_method
        and reference_normalized = lower(btrim(p_transaction_reference))
    ) then
      raise exception 'This transaction reference has already been submitted for this payment channel';
    end if;
    raise;
end;
$$;

create or replace function public.phase4_admin_review_payment(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_payload jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_payment public.payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_status text;
  v_previous jsonb;
  v_result jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid review reason and request key required';
  end if;
  if exists (select 1 from public.admin_action_requests where request_key = p_request_key) then
    select result into v_result from public.admin_action_requests where request_key = p_request_key;
    if v_result is null then raise exception 'Action is already in progress'; end if;
    return v_result || jsonb_build_object('replayed', true);
  end if;
  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (p_request_key, p_actor_user_id, 'payment_review', p_payment_request_id::text);

  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_payment from public.payment_requests
  where id = p_payment_request_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  v_status := lower(btrim(coalesce(p_payload->>'status', '')));
  if v_status not in ('needs_information','approved','rejected')
     or v_payment.status not in ('pending','needs_information') then
    raise exception 'Payment request is no longer reviewable';
  end if;
  v_previous := to_jsonb(v_payment) - array[
    'student_note','proof_object_path','proof_original_name','proof_sha256'
  ];

  if v_status = 'approved' then
    if v_payment.plan_code <> 'early_access_beta'
       or v_payment.trusted_amount_php <> 149.00
       or v_now >= v_settings.early_access_entitlement_ends_at then
      raise exception 'Trusted Early Access payment cannot be activated';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_payment.user_id::text, 500));
    select * into v_subscription
    from public.subscriptions
    where user_id = v_payment.user_id
      and status = 'active'
      and starts_at <= v_now
      and (expires_at is null or expires_at > v_now)
    order by expires_at desc nulls first, updated_at desc
    limit 1 for update;

    -- Never shorten a valid legacy entitlement. Only replace access that ends
    -- before the fixed Early Access entitlement end.
    if v_subscription.id is null
       or (
         v_subscription.expires_at is not null
         and v_subscription.expires_at < v_settings.early_access_entitlement_ends_at
       ) then
      update public.subscriptions
      set status = 'cancelled', updated_at = v_now, updated_by = p_actor_user_id,
          reason = 'Replaced by approved Early Access payment.', version = version + 1
      where user_id = v_payment.user_id
        and status in ('trialing','pending_payment','active','paused');
      insert into public.subscriptions (
        user_id, plan_code, status, starts_at, expires_at, source,
        created_by, updated_by, reason
      ) values (
        v_payment.user_id, 'early_access_beta', 'active',
        coalesce(v_payment.provisional_access_started_at, v_now),
        v_settings.early_access_entitlement_ends_at, 'manual_payment',
        p_actor_user_id, p_actor_user_id, btrim(p_reason)
      ) returning * into v_subscription;
      insert into public.subscription_history (
        subscription_id, user_id, actor_user_id, action,
        previous_state, new_state, reason, request_key
      ) values (
        v_subscription.id, v_subscription.user_id, p_actor_user_id, 'activate',
        '{}'::jsonb, to_jsonb(v_subscription), btrim(p_reason),
        left(p_request_key, 96) || '_subscription'
      );
    end if;
  elsif v_status = 'rejected' then
    update public.payment_requests
    set provisional_access_revoked_at = v_now
    where id = v_payment.id;
  end if;

  update public.payment_requests
  set status = v_status, reviewed_at = v_now, reviewed_by = p_actor_user_id,
      review_reason = btrim(p_reason),
      subscription_id = case when v_status = 'approved' then v_subscription.id else subscription_id end,
      provisional_access_revoked_at = case when v_status = 'rejected'
        then coalesce(provisional_access_revoked_at, v_now) else provisional_access_revoked_at end,
      updated_at = v_now, version = version + 1
  where id = v_payment.id returning * into v_payment;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key
  ) values (
    v_payment.id, p_actor_user_id, v_status, v_previous->>'status', v_status,
    btrim(p_reason), left(p_request_key, 96) || '_payment'
  );

  v_result := jsonb_build_object(
    'ok', true, 'action', 'payment_review', 'targetUserId', v_payment.user_id,
    'payment', to_jsonb(v_payment) - array[
      'student_note','proof_object_path','proof_original_name','proof_sha256'
    ],
    'subscription', case when v_subscription.id is null then null else to_jsonb(v_subscription) end,
    'requestKey', p_request_key, 'replayed', false
  );
  update public.admin_action_requests set result = v_result, completed_at = v_now
  where request_key = p_request_key;
  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'payment_changed', v_payment.user_id,
    'payment_request', v_payment.id::text, btrim(p_reason),
    jsonb_build_object('requestKey', p_request_key, 'status', v_status)
  );
  return v_result;
end;
$$;

create or replace function public.phase4_create_refund_request(
  p_user_id uuid,
  p_payment_request_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_payment public.payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_refund public.refund_requests%rowtype;
  v_start timestamptz;
  v_total_seconds numeric;
  v_unused_seconds numeric;
  v_suggested numeric(10,2);
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 2000
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid refund reason and request key required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('refund:' || p_payment_request_id::text, 0)
  );
  select * into v_refund from public.refund_requests where request_key = p_request_key;
  if found then
    if v_refund.user_id <> p_user_id
       or v_refund.payment_request_id <> p_payment_request_id then
      raise exception 'Request key already used';
    end if;
    return jsonb_build_object('id', v_refund.id, 'status', v_refund.status, 'replayed', true);
  end if;
  if exists (
    select 1 from public.refund_requests
    where payment_request_id = p_payment_request_id
      and status in ('pending','needs_information','approved','paid')
  ) then raise exception 'A refund request already exists for this payment'; end if;

  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_payment from public.payment_requests
  where id = p_payment_request_id and user_id = p_user_id
    and plan_code = 'early_access_beta'
    and status in ('pending','needs_information','approved')
  for update;
  if not found then raise exception 'Eligible Early Access payment not found'; end if;
  select * into v_subscription from public.subscriptions where id = v_payment.subscription_id;
  v_start := coalesce(v_payment.provisional_access_started_at, v_subscription.starts_at, v_payment.submitted_at);
  if public.phase4_ph_date(v_now) > public.phase4_ph_date(v_start) + 6 then
    raise exception 'Refund requests must be filed within seven calendar days of first access';
  end if;
  v_total_seconds := greatest(1, extract(epoch from (v_settings.early_access_entitlement_ends_at - v_start)));
  v_unused_seconds := greatest(0, extract(epoch from (v_settings.early_access_entitlement_ends_at - v_now)));
  v_suggested := least(149.00, greatest(0, round(149.00 * v_unused_seconds / v_total_seconds, 2)));

  insert into public.refund_requests (
    user_id, payment_request_id, subscription_id, reason, request_type,
    paid_amount_php, suggested_refund_php, calculation_note, request_key,
    first_access_started_at, cancellation_effective_at, entitlement_ends_at
  ) values (
    p_user_id, v_payment.id, v_payment.subscription_id, btrim(p_reason),
    'student_request', 149.00, v_suggested,
    'Prorated unused Early Access time from effective cancellation through October 1, 2026; subject to administrator review and statutory rights.',
    p_request_key, v_start, v_now, v_settings.early_access_entitlement_ends_at
  ) returning * into v_refund;

  update public.payment_requests
  set provisional_access_revoked_at = coalesce(provisional_access_revoked_at, v_now),
      updated_at = v_now
  where id = v_payment.id;
  update public.subscriptions
  set status = 'cancelled', updated_at = v_now,
      reason = 'Early Access refund requested; effective cancellation recorded.',
      version = version + 1
  where id = v_payment.subscription_id and status = 'active';

  insert into public.refund_request_history (
    refund_request_id, actor_user_id, action, previous_state, new_state,
    reason, request_key
  ) values (
    v_refund.id, p_user_id, 'submitted', '{}'::jsonb,
    jsonb_build_object(
      'status', 'pending',
      'suggestedRefundPhp', v_refund.suggested_refund_php,
      'cancellationEffectiveAt', v_now
    ),
    'Student submitted Early Access refund request for administrator review.',
    left(p_request_key, 96) || '_history'
  );

  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  ) values (
    'refund_submitted', 'premium@duediligence.ph',
    'Due Diligence Early Access refund review request',
    '/admin/refunds?request=' || v_refund.id::text,
    'refund_request', v_refund.id
  );
  return jsonb_build_object(
    'id', v_refund.id, 'status', v_refund.status,
    'suggestedRefundPhp', v_refund.suggested_refund_php,
    'calculationNote', v_refund.calculation_note, 'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Commercial onboarding and audited activation
-- ---------------------------------------------------------------------------

create or replace function public.complete_commercial_profile_onboarding(
  p_display_name text,
  p_law_school_id text,
  p_law_school_other text,
  p_category text,
  p_professor_license_number text,
  p_terms_version text default 'terms-commercial-v1-2026-08-18',
  p_privacy_version text default 'privacy-commercial-v1-2026-08-18'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.platform_access_settings%rowtype;
  v_school_id text := lower(btrim(coalesce(p_law_school_id, '')));
  v_category text := lower(btrim(coalesce(p_category, '')));
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  if btrim(coalesce(p_terms_version, '')) <> v_settings.current_terms_version
     or btrim(coalesce(p_privacy_version, '')) <> v_settings.current_privacy_version then
    raise exception 'Current Terms and Privacy versions are required';
  end if;
  if not exists (
    select 1 from public.terms_acceptances
    where user_id = v_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) then raise exception 'Required terms have not been accepted'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 120 then
    raise exception 'Name is required';
  end if;
  if v_school_id = '' then raise exception 'Law school is required'; end if;
  if v_school_id = 'other'
     and char_length(btrim(coalesce(p_law_school_other, ''))) not between 2 and 180 then
    raise exception 'Enter the law school name';
  end if;
  if v_category not in (
    'first_year','second_year','third_year','fourth_year','fifth_year','review','professor'
  ) then raise exception 'Select a valid law-school category'; end if;
  if v_category = 'professor'
     and char_length(btrim(coalesce(p_professor_license_number, ''))) not between 3 and 80 then
    raise exception 'Professor license declaration is required';
  end if;

  update public.profiles
  set display_name = btrim(p_display_name),
      law_school_id = v_school_id,
      law_school_other = case when v_school_id = 'other'
        then btrim(p_law_school_other) else null end,
      commercial_category = v_category,
      commercial_onboarding_completed_at = now(),
      school = case when v_school_id = 'other'
        then btrim(p_law_school_other) else v_school_id end,
      enrollment_status = 'enrolled',
      year_level = v_category,
      profile_completed_at = coalesce(profile_completed_at, now()),
      updated_at = now()
  where id = v_user_id;
  if not found then raise exception 'Profile does not exist for authenticated user'; end if;

  if v_category = 'professor' then
    insert into public.professor_license_declarations (
      user_id, license_number, declaration_version, declared_at, updated_at
    ) values (
      v_user_id, btrim(p_professor_license_number),
      'professor-declaration-v1-2026-08-18', now(), now()
    )
    on conflict (user_id) do update
    set license_number = excluded.license_number,
        declaration_version = excluded.declaration_version,
        declared_at = excluded.declared_at,
        updated_at = excluded.updated_at;
  else
    delete from public.professor_license_declarations where user_id = v_user_id;
  end if;
end;
$$;

create or replace function public.phase4_activate_commercial_launch(
  p_actor_user_id uuid,
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
begin
  perform public.phase4_require_founder(p_actor_user_id);
  perform pg_advisory_xact_lock(hashtextextended('commercial_launch_activation', 0));
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid activation reason and request key required';
  end if;
  if exists (
    select 1 from public.admin_audit_log
    where action_type = 'security_setting_changed'
      and details->>'setting' = 'commercial_launch'
      and details->>'requestKey' = p_request_key
  ) then
    select * into strict v_settings from public.platform_access_settings where singleton = true;
    return jsonb_build_object(
      'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
      'publicPricingEnabled', v_settings.public_pricing_enabled,
      'globalBetaStillEnabled', v_settings.global_beta_all_access_enabled,
      'replayed', true
    );
  end if;

  update public.platform_access_settings
  set commercial_launch_enabled = true,
      public_pricing_enabled = true,
      current_terms_version = commercial_terms_version,
      current_privacy_version = commercial_privacy_version,
      commercial_policy_version = commercial_policy_version + 1,
      commercial_updated_at = now(),
      commercial_updated_by = p_actor_user_id,
      updated_at = now(), updated_by = p_actor_user_id
  where singleton = true returning * into strict v_settings;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'security_setting_changed',
    'platform_access_settings', 'singleton', btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'setting', 'commercial_launch',
      'commercialPolicyVersion', v_settings.commercial_policy_version,
      'globalBetaStillEnabled', v_settings.global_beta_all_access_enabled
    )
  );
  return jsonb_build_object(
    'commercialLaunchEnabled', true, 'publicPricingEnabled', true,
    'globalBetaStillEnabled', v_settings.global_beta_all_access_enabled,
    'replayed', false
  );
end;
$$;

create or replace function public.phase4_rollback_commercial_launch(
  p_actor_user_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.commercial_launch_rollback_snapshots%rowtype;
  v_plan jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  perform pg_advisory_xact_lock(hashtextextended('commercial_launch_activation', 0));
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid rollback reason and request key required';
  end if;
  if exists (
    select 1 from public.admin_audit_log
    where action_type = 'security_setting_changed'
      and details->>'setting' = 'commercial_launch_rollback'
      and details->>'requestKey' = p_request_key
  ) then
    return jsonb_build_object('rolledBack', true, 'replayed', true);
  end if;

  select * into strict v_snapshot
  from public.commercial_launch_rollback_snapshots
  where singleton = true;

  update public.platform_access_settings
  set commercial_launch_enabled = false,
      public_pricing_enabled = false,
      global_beta_all_access_enabled = true,
      current_terms_version = v_snapshot.previous_settings->>'current_terms_version',
      current_privacy_version = v_snapshot.previous_settings->>'current_privacy_version',
      commercial_policy_version = commercial_policy_version + 1,
      commercial_updated_at = now(),
      commercial_updated_by = p_actor_user_id,
      updated_at = now(),
      updated_by = p_actor_user_id
  where singleton = true;

  for v_plan in
    select value from jsonb_array_elements(v_snapshot.previous_plan_catalog)
  loop
    update public.plan_catalog
    set display_name = v_plan->>'display_name',
        price_php = (v_plan->>'price_php')::numeric,
        status = v_plan->>'status',
        description = coalesce(v_plan->>'description', ''),
        features = coalesce(v_plan->'features', '[]'::jsonb),
        duration_days = nullif(v_plan->>'duration_days', '')::integer,
        display_order = coalesce((v_plan->>'display_order')::integer, 0),
        promotional = coalesce((v_plan->>'promotional')::boolean, false),
        checkout_enabled = coalesce((v_plan->>'checkout_enabled')::boolean, false),
        note = coalesce(v_plan->>'note', ''),
        updated_at = now(),
        updated_by = p_actor_user_id
    where plan_code = v_plan->>'plan_code';
  end loop;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'security_setting_changed',
    'platform_access_settings', 'singleton', btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'setting', 'commercial_launch_rollback',
      'snapshotCapturedAt', v_snapshot.captured_at
    )
  );
  return jsonb_build_object(
    'rolledBack', true,
    'globalBetaEnabled', true,
    'publicPricingEnabled', false,
    'replayed', false
  );
end;
$$;

-- Subject Matter, Mock Bar and Bar Feels now share one commercial access
-- resolver. Historical owner access remains available for prior attempts.
create or replace function public.examination_authorize_access(
  p_user_id uuid,
  p_track text default null,
  p_version_id uuid default null,
  p_attempt_id uuid default null,
  p_allow_historical boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_access jsonb;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'EXAM_ACCESS_REQUIRED'; end if;
  if p_attempt_id is not null then
    select d.track into v_track
    from public.examination_attempts_multi a
    join public.examination_versions ev on ev.id = a.version_id
    join public.examination_definitions d on d.id = ev.exam_id
    where a.id = p_attempt_id and a.user_id = p_user_id;
    if v_track is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if p_allow_historical then
      return jsonb_build_object('allowed', true, 'basis', 'historical_owner', 'track', v_track);
    end if;
  elsif p_version_id is not null then
    select d.track into v_track
    from public.examination_versions ev
    join public.examination_definitions d on d.id = ev.exam_id
    where ev.id = p_version_id;
    if v_track is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
  end if;
  if v_track is not null and v_track not in ('per_subject','bar_feels') then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;
  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object(
    'allowed', true, 'basis', v_access->>'basis', 'track', v_track,
    'accessMode', v_access->>'accessMode',
    'remainingToday', (v_access->>'remainingToday')::integer,
    'unlimited', (v_access->>'unlimited')::boolean
  );
end;
$$;

-- Backend-only tables and functions.  Profile onboarding itself runs as the
-- authenticated user but cannot assign any application role.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'founding_beta_invites', 'professor_license_declarations',
    'commercial_launch_rollback_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', v_table);
  end loop;
end $$;

revoke all on function public.phase4_ph_date(timestamptz) from public, anon, authenticated;
revoke all on function public.phase4_ph_reset_at(timestamptz) from public, anon, authenticated;
revoke all on function public.phase4_claim_founding_beta(uuid, text) from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.phase4_user_subscription_status(uuid) from public, anon, authenticated;
revoke all on function public.phase4_reserve_grade_v2(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.phase4_reserve_grade_v2(uuid, text, text) from public, anon, authenticated;
revoke all on function public.phase4_reserve_submission_batch(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.phase4_finalize_submission_batch(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.phase4_release_submission_batch(uuid, text, text) from public, anon, authenticated;
revoke all on function public.phase4_exam_room_reservation_key(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phase4_prepare_exam_room_hold(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phase4_exam_room_allowance_preview(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phase4_extend_exam_room_hold(uuid, uuid) from public, anon, authenticated;
revoke all on function public.exam_room_start_attempt_commercial_v1(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.exam_room_start_attempt_by_code_commercial_v1(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.exam_room_start_beadle_attempt_commercial_v1(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.phase4_finalize_exam_room_quota_on_submission() from public, anon, authenticated;
revoke all on function public.phase4_finalize_grade(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dd2026_record_bar_easy_completion_commercial(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.dd2026_record_doctrine_mastery_commercial(uuid,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.examination_store_ai_assessment_commercial(uuid,uuid,uuid,numeric,jsonb,text,text,uuid) from public, anon, authenticated;
revoke all on function public.phase4_plan_catalog() from public, anon, authenticated;
revoke all on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.phase4_create_refund_request(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.complete_commercial_profile_onboarding(
  text,text,text,text,text,text,text
) from public, anon;
revoke all on function public.phase4_activate_commercial_launch(uuid,text,text) from public, anon, authenticated;
revoke all on function public.phase4_rollback_commercial_launch(uuid,text,text) from public, anon, authenticated;
revoke all on function public.examination_authorize_access(uuid,text,uuid,uuid,boolean) from public, anon, authenticated;

grant execute on function public.phase4_ph_date(timestamptz) to service_role;
grant execute on function public.phase4_ph_reset_at(timestamptz) to service_role;
grant execute on function public.phase4_claim_founding_beta(uuid,text) to service_role;
grant execute on function public.phase4_access_snapshot(uuid,boolean,text) to service_role;
grant execute on function public.phase4_user_subscription_status(uuid) to service_role;
grant execute on function public.phase4_reserve_grade_v2(uuid,text,text,text) to service_role;
grant execute on function public.phase4_reserve_grade_v2(uuid,text,text) to service_role;
grant execute on function public.phase4_reserve_submission_batch(uuid,text,text,text,integer) to service_role;
grant execute on function public.phase4_finalize_submission_batch(uuid,text,integer,text) to service_role;
grant execute on function public.phase4_release_submission_batch(uuid,text,text) to service_role;
grant execute on function public.phase4_exam_room_reservation_key(uuid,uuid) to service_role;
grant execute on function public.phase4_prepare_exam_room_hold(uuid,uuid) to service_role;
grant execute on function public.phase4_exam_room_allowance_preview(uuid,uuid) to service_role;
grant execute on function public.phase4_extend_exam_room_hold(uuid,uuid) to service_role;
grant execute on function public.exam_room_start_attempt_commercial_v1(uuid,uuid,text,text) to service_role;
grant execute on function public.exam_room_start_attempt_by_code_commercial_v1(uuid,text,text,text) to service_role;
grant execute on function public.exam_room_start_beadle_attempt_commercial_v1(uuid,uuid,text) to service_role;
grant execute on function public.phase4_finalize_grade(uuid,uuid) to service_role;
grant execute on function public.dd2026_record_bar_easy_completion_commercial(uuid,text,text,text,uuid) to service_role;
grant execute on function public.dd2026_record_doctrine_mastery_commercial(uuid,text,text,text,text,uuid) to service_role;
grant execute on function public.examination_store_ai_assessment_commercial(uuid,uuid,uuid,numeric,jsonb,text,text,uuid) to service_role;
grant execute on function public.phase4_plan_catalog() to service_role;
grant execute on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) to service_role;
grant execute on function public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text) to service_role;
grant execute on function public.phase4_create_refund_request(uuid,uuid,text,text) to service_role;
grant execute on function public.complete_commercial_profile_onboarding(
  text,text,text,text,text,text,text
) to authenticated;
grant execute on function public.phase4_activate_commercial_launch(uuid,text,text) to service_role;
grant execute on function public.phase4_rollback_commercial_launch(uuid,text,text) to service_role;
grant execute on function public.examination_authorize_access(uuid,text,uuid,uuid,boolean) to service_role;

comment on column public.grade_reservations.usage_date_ph
  is 'Philippine calendar date used for the shared commercial daily allowance.';
comment on table public.founding_beta_invites
  is 'Private SHA-256 normalized email roster; plaintext addresses are never stored.';
comment on table public.professor_license_declarations
  is 'Private self-declaration only. It never grants an application role or authority.';

commit;
