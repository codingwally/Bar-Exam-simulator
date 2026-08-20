-- Due Diligence permanent Free + one-time Early Access commercial cutover.
--
-- This migration intentionally reuses the existing, concurrency-safe grade
-- reservation lifecycle. It adds only the explicit account choice required to
-- distinguish a permanent five-per-day Free account from an account that has
-- not yet selected access.

begin;

alter table public.platform_access_settings
  add column if not exists mandatory_access_choice_enabled boolean not null default false,
  add column if not exists launch_trial_ends_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz;

create table if not exists public.commercial_access_choices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  choice text not null,
  selected_at timestamptz not null default now(),
  request_key text,
  choice_source text not null default 'commercial_gate',
  version bigint not null default 1,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commercial_access_choices
  add column if not exists choice text,
  add column if not exists selected_at timestamptz not null default now(),
  add column if not exists request_key text,
  add column if not exists choice_source text not null default 'commercial_gate',
  add column if not exists version bigint not null default 1,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $migration$
declare
  v_choice_attnum smallint;
  v_constraint record;
begin
  select attnum into strict v_choice_attnum
  from pg_attribute
  where attrelid = 'public.commercial_access_choices'::regclass
    and attname = 'choice'
    and not attisdropped;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.commercial_access_choices'::regclass
      and contype = 'c'
      and v_choice_attnum = any(conkey)
  loop
    execute format(
      'alter table public.commercial_access_choices drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

-- Convert legacy launch choices only after removing their old enum-style
-- check. PostgreSQL evaluates the existing check during UPDATE, so reversing
-- this order would reject the otherwise valid permanent-Free conversion.
update public.commercial_access_choices
set choice = 'free',
    choice_source = coalesce(nullif(btrim(choice_source), ''), 'migrated_launch_choice'),
    updated_at = now()
where choice in ('launch_trial', 'free_trial');

alter table public.commercial_access_choices
  alter column choice set not null,
  alter column selected_at set not null,
  alter column choice_source set not null,
  alter column version set not null;

-- The migration is deliberately safe to rehearse repeatedly on staging. The
-- block above removes every legacy choice check; these named checks may still
-- exist when the exact migration is replayed, so remove only our own names
-- before recreating the reviewed definitions.
alter table public.commercial_access_choices
  drop constraint if exists commercial_access_choices_choice_check,
  drop constraint if exists commercial_access_choices_choice_source_check,
  drop constraint if exists commercial_access_choices_request_key_check,
  drop constraint if exists commercial_access_choices_source_check,
  drop constraint if exists commercial_access_choices_version_check;

alter table public.commercial_access_choices
  add constraint commercial_access_choices_choice_check
    check (choice in ('free', 'early_access')),
  add constraint commercial_access_choices_request_key_check
    check (
      request_key is null
      or request_key ~ '^[A-Za-z0-9_-]{16,128}$'
    ),
  add constraint commercial_access_choices_source_check
    check (char_length(btrim(choice_source)) between 2 and 80),
  add constraint commercial_access_choices_version_check
    check (version > 0);

-- Preserve any explicit staging-era Free Trial selection as the now-permanent
-- Free choice. The access_trials table itself remains untouched for rollback.
do $migration$
begin
  if to_regclass('public.access_trials') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'access_trials'
         and column_name = 'trial_program'
     ) then
    execute $sql$
      insert into public.commercial_access_choices (
        user_id,
        choice,
        selected_at,
        request_key,
        choice_source,
        trial_started_at,
        trial_expires_at
      )
      select
        user_id,
        'free',
        started_at,
        case
          when first_exam_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
            then first_exam_request_key
          else 'migrated_choice_' || replace(user_id::text, '-', '')
        end,
        'migrated_launch_choice',
        started_at,
        expires_at
      from public.access_trials
      where trial_program = 'commercial_launch_2026'
      on conflict (user_id) do nothing
    $sql$;
  end if;
end;
$migration$;

alter table public.commercial_access_choices enable row level security;
revoke all on table public.commercial_access_choices
  from public, anon, authenticated;
grant select, insert, update, delete on table public.commercial_access_choices
  to service_role;

-- Keep the resolver that existed immediately before this migration as a
-- compatibility base. This works both on production (where later draft access
-- migrations were never applied) and staging (where they were rehearsed).
do $migration$
begin
  if to_regprocedure(
       'public.phase4_access_snapshot_pre_permanent_free(uuid,boolean,text)'
     ) is null then
    if to_regprocedure(
         'public.phase4_access_snapshot(uuid,boolean,text)'
       ) is null then
      raise exception 'The commercial access resolver is missing';
    end if;
    execute
      'alter function public.phase4_access_snapshot(uuid, boolean, text) '
      'rename to phase4_access_snapshot_pre_permanent_free';
  end if;
end;
$migration$;

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
  v_choice public.commercial_access_choices%rowtype;
  v_base jsonb;
  v_basis text := 'locked';
  v_profile_complete boolean := false;
  v_completed integer := 0;
  v_reserved integer := 0;
  v_used integer := 0;
  v_remaining integer := 0;
  v_common jsonb;
begin
  v_base := public.phase4_access_snapshot_pre_permanent_free(
    p_user_id,
    p_activate_trial,
    p_request_key
  );

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_choice
  from public.commercial_access_choices
  where user_id = p_user_id;

  select (
    p.commercial_onboarding_completed_at is not null
    or p.profile_completed_at is not null
  )
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  v_profile_complete := coalesce(v_profile_complete, false);

  select
    count(*) filter (
      where status = 'completed'
        and usage_date_ph = public.phase4_ph_date(v_now)
    ),
    count(*) filter (
      where status = 'reserved'
        and reservation_expires_at > v_now
    )
  into v_completed, v_reserved
  from public.grade_reservations
  where user_id = p_user_id
    and consumes_quota;

  v_completed := coalesce(v_completed, 0);
  v_reserved := coalesce(v_reserved, 0);
  v_used := v_completed + v_reserved;
  v_remaining := greatest(
    0,
    v_settings.free_daily_grade_limit - v_used
  );
  v_basis := coalesce(v_base ->> 'basis', 'locked');

  v_common := jsonb_build_object(
    'profileCompleted', v_profile_complete,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'mandatoryAccessChoiceEnabled',
      v_settings.mandatory_access_choice_enabled,
    'dailyLimit', v_settings.free_daily_grade_limit,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'remainingToday', v_remaining,
    'resetAt', public.phase4_ph_reset_at(v_now),
    'freeChoiceAvailable',
      v_settings.commercial_launch_enabled
      and v_settings.mandatory_access_choice_enabled
      and v_choice.user_id is null,
    'selectedChoice', v_choice.choice,
    'choiceRecordedAt', v_choice.selected_at
  );

  if coalesce((v_base ->> 'termsRequired')::boolean, false) then
    return v_base || v_common || jsonb_build_object(
      'allowed', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  if not v_profile_complete then
    return v_base || v_common || jsonb_build_object(
      'allowed', false,
      'basis', 'profile_required',
      'accessMode', 'locked',
      'accountLabel', 'Complete profile',
      'unlimited', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'remainingToday', 0,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  if v_basis in (
    'super_admin',
    'founder_admin',
    'global_beta_all_access',
    'founding_beta',
    'free_beta',
    'early_access',
    'paid_subscription',
    'provisional_payment'
  ) then
    return v_base || v_common || jsonb_build_object(
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false
    );
  end if;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    return v_base || v_common;
  end if;

  if v_choice.choice = 'free' then
    return v_base || v_common || jsonb_build_object(
      -- A completed Free choice grants platform access even after today's
      -- allowance is exhausted. The atomic reservation RPC alone blocks a
      -- sixth successful submission, so users can still review saved work,
      -- history, and study material until Philippine midnight.
      'allowed', true,
      'basis', case
        when v_remaining > 0 then 'daily_free'
        else 'daily_limit_reached'
      end,
      'accessMode', 'free',
      'accountLabel', 'Free',
      'unlimited', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'entitlementEndsAt', null,
      'freeChoiceAvailable', false,
      'freeGrades', jsonb_build_object(
        'limit', v_settings.free_daily_grade_limit,
        'used', v_used,
        'remaining', v_remaining
      )
    );
  end if;

  if v_choice.choice = 'early_access' then
    return v_base || v_common || jsonb_build_object(
      'allowed', false,
      'basis', 'payment_required',
      'accessMode', 'locked',
      'accountLabel', 'Complete Early Access',
      'unlimited', false,
      'choiceRequired', true,
      'planSelectionRequired', true,
      'paymentRequired', true,
      'remainingToday', 0,
      'freeChoiceAvailable', false,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  return v_base || v_common || jsonb_build_object(
    'allowed', false,
    'basis', 'plan_selection_required',
    'accessMode', 'locked',
    'accountLabel', 'Choose access',
    'unlimited', false,
    'choiceRequired', true,
    'planSelectionRequired', true,
    'paymentRequired', false,
    'selectedChoice', null,
    'choiceRecordedAt', null,
    'entitlementEndsAt', null,
    'remainingToday', 0,
    'freeGrades', jsonb_build_object(
      'limit', 0,
      'used', 0,
      'remaining', 0
    )
  );
end;
$$;

-- Keep the established RPC name so older trusted Workers remain compatible
-- during database-first deployment. Its behavior is now a permanent Free
-- selection rather than an expiring trial.
create or replace function public.phase4_choose_launch_trial(
  p_user_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.platform_access_settings%rowtype;
  v_access jsonb;
  v_existing public.commercial_access_choices%rowtype;
  v_profile_complete boolean := false;
begin
  if p_user_id is null or not exists (
    select 1
    from auth.users
    where id = p_user_id
      and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;

  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('commercial-access-choice:' || p_user_id::text, 0)
  );

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    raise exception 'Free access selection is not available';
  end if;

  if not exists (
    select 1
    from public.terms_acceptances
    where user_id = p_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) then
    raise exception 'Current Terms and Privacy acceptance is required';
  end if;

  select (
    p.commercial_onboarding_completed_at is not null
    or p.profile_completed_at is not null
  )
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  if not coalesce(v_profile_complete, false) then
    raise exception 'Complete the required profile before choosing access';
  end if;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if coalesce((v_access ->> 'allowed')::boolean, false)
     and coalesce(v_access ->> 'basis', '') in (
       'super_admin', 'founder_admin', 'global_beta_all_access',
       'founding_beta', 'free_beta', 'early_access',
       'paid_subscription', 'provisional_payment'
     ) then
    return v_access;
  end if;

  select * into v_existing
  from public.commercial_access_choices
  where user_id = p_user_id
  for update;

  if found then
    if v_existing.choice = 'free' then
      return public.phase4_access_snapshot(p_user_id, false, null);
    end if;
    raise exception 'An access choice is already recorded for this account';
  end if;

  insert into public.commercial_access_choices (
    user_id,
    choice,
    selected_at,
    request_key,
    choice_source
  ) values (
    p_user_id,
    'free',
    clock_timestamp(),
    p_request_key,
    'commercial_gate'
  );

  return public.phase4_access_snapshot(p_user_id, false, null);
end;
$$;

create or replace function public.phase4_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_early public.plan_catalog%rowtype;
  v_early_open boolean;
begin
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_early
  from public.plan_catalog
  where plan_code = 'early_access_beta';

  v_early_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and v_now <= v_settings.early_access_sales_close_at
    and coalesce(v_early.status = 'active', false)
    and coalesce(v_early.checkout_enabled, false);

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'free',
      'name', 'Free',
      'pricePhp', 0,
      'priceCentavos', 0,
      'billing', 'free',
      'checkoutEnabled', false,
      'status', 'active',
      'displayOrder', 1,
      'promotional', false,
      'salesCloseAt', null,
      'entitlementEndsAt', null,
      'description',
        'Five successful question submissions per Philippine calendar day.',
      'features', jsonb_build_array(
        'Five successful submissions daily',
        'One shared allowance across examination tracks',
        'Allowance resets at Philippine midnight',
        'No payment and no automatic renewal'
      ),
      'note', 'Always available after account setup.'
    ),
    jsonb_build_object(
      'planCode', 'early_access_beta',
      'name', 'Early Access',
      'pricePhp', 149,
      'priceCentavos', 14900,
      'billing', 'one_time',
      'checkoutEnabled', v_early_open,
      'status', case when v_early_open then 'active' else 'closed' end,
      'displayOrder', 2,
      'promotional', true,
      'salesCloseAt', v_settings.early_access_sales_close_at,
      'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
      'description', case
        when v_early_open then
          '₱149 one-time for unlimited access through October 1, 2026.'
        else 'Next paid-plan pricing will be announced separately.'
      end,
      'features', coalesce(
        v_early.features,
        jsonb_build_array(
          'Unlimited successful submissions through October 1, 2026',
          'All Due Diligence examination tracks',
          'Provisional access while payment verification is pending',
          'No automatic renewal'
        )
      ),
      'note', 'One-time payment. No automatic renewal.'
    )
  );
end;
$$;

-- Activate the approved policy atomically. Older Workers remain compatible
-- because the established resolver and RPC names are preserved above.
update public.platform_access_settings
set commercial_launch_enabled = true,
    mandatory_access_choice_enabled = true,
    global_beta_all_access_enabled = false,
    free_daily_grade_limit = 5,
    quota_timezone = 'Asia/Manila',
    early_access_sales_close_at = '2026-09-01 23:59:59+08'::timestamptz,
    early_access_entitlement_ends_at = '2026-10-01 23:59:59+08'::timestamptz,
    public_pricing_enabled = true,
    commercial_terms_version = 'terms-commercial-v1-2026-08-18',
    commercial_privacy_version = 'privacy-commercial-v1-2026-08-18',
    current_terms_version = 'terms-commercial-v1-2026-08-18',
    current_privacy_version = 'privacy-commercial-v1-2026-08-18',
    commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = now(),
    updated_at = now()
where singleton = true;

update public.plan_catalog
set display_name = 'Early Access',
    price_php = 149.00,
    status = 'active',
    description = 'One-time Early Access through October 1, 2026 at 11:59 PM (Asia/Manila).',
    features = '[
      "Unlimited successful submissions through October 1, 2026",
      "All Due Diligence examination tracks",
      "Source-based coaching and saved progress",
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
set status = 'retired',
    checkout_enabled = false,
    promotional = false,
    note = 'Historical records are preserved; this plan is unavailable for new checkout.',
    updated_at = now()
where plan_code in ('standard', 'premium');

revoke all on function public.phase4_access_snapshot_pre_permanent_free(
  uuid,
  boolean,
  text
) from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.phase4_choose_launch_trial(uuid, text)
  from public, anon, authenticated;
revoke all on function public.phase4_plan_catalog()
  from public, anon, authenticated;

grant execute on function public.phase4_access_snapshot_pre_permanent_free(
  uuid,
  boolean,
  text
) to service_role;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;
grant execute on function public.phase4_choose_launch_trial(uuid, text)
  to service_role;
grant execute on function public.phase4_plan_catalog()
  to service_role;

comment on table public.commercial_access_choices
  is 'Private, account-bound commercial access choice. Ordinary clients have no direct privileges.';
comment on function public.phase4_access_snapshot(uuid, boolean, text)
  is 'Server-authoritative access resolver requiring an explicit permanent Free choice or a valid unlimited entitlement.';
comment on function public.phase4_choose_launch_trial(uuid, text)
  is 'Compatibility-named service-role RPC that records the permanent five-per-day Free choice exactly once.';
comment on function public.phase4_plan_catalog()
  is 'Public catalog exposing exactly permanent Free and the one-time ₱149 Early Access offer.';

commit;
