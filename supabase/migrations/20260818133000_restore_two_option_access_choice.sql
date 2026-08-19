-- Restore the owner-approved two-option commercial access gate.
--
-- Ordinary accounts must explicitly choose either:
--   1. Free Trial through September 1, 2026 at 11:59:59 PM Asia/Manila; or
--   2. ₱149 Early Access through October 1, 2026 at 11:59:59 PM Asia/Manila.
--
-- Administrator, Founding Beta, active paid, and provisional-payment access
-- retain precedence. The rollout switch installs disabled so Worker and Pages
-- can be deployed before activation.

begin;

alter table public.platform_access_settings
  add column if not exists mandatory_access_choice_enabled boolean not null default false,
  add column if not exists launch_trial_ends_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz;

update public.platform_access_settings
set mandatory_access_choice_enabled = false,
    launch_trial_ends_at = '2026-09-01 23:59:59+08'::timestamptz,
    commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = now(),
    updated_at = now()
where singleton = true;

alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_launch_trial_date_check;
alter table public.platform_access_settings
  add constraint platform_access_settings_launch_trial_date_check check (
    launch_trial_ends_at <= early_access_entitlement_ends_at
  );

alter table public.access_trials
  add column if not exists trial_program text not null default 'legacy';
alter table public.access_trials
  drop constraint if exists access_trials_trial_program_check;
alter table public.access_trials
  add constraint access_trials_trial_program_check check (
    trial_program in ('legacy', 'commercial_launch_2026')
  );

alter table public.grade_reservations
  drop constraint if exists grade_reservations_access_basis_check;
alter table public.grade_reservations
  add constraint grade_reservations_access_basis_check check (access_basis in (
    'super_admin', 'founder_admin', 'free_beta', 'paid_subscription',
    'trial', 'lifetime_free', 'global_beta_all_access', 'founding_beta',
    'early_access', 'provisional_payment', 'daily_free', 'launch_trial'
  ));

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
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_trial public.access_trials%rowtype;
  v_role text := 'student';
  v_profile_complete boolean := false;
  v_access jsonb;
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
    hashtextextended('commercial-launch-trial:' || p_user_id::text, 0)
  );

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    raise exception 'Free Trial selection is not available';
  end if;

  if v_now >= v_settings.launch_trial_ends_at then
    raise exception 'The Free Trial has closed';
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

  select coalesce(role, 'student') into v_role
  from public.user_roles
  where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  select (
    p.commercial_onboarding_completed_at is not null
    or p.profile_completed_at is not null
  )
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  v_profile_complete := coalesce(v_profile_complete, false);

  if not v_profile_complete then
    raise exception 'Complete the required profile before choosing access';
  end if;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if coalesce((v_access->>'allowed')::boolean, false) then
    return v_access;
  end if;

  select * into v_trial
  from public.access_trials
  where user_id = p_user_id
  for update;

  if found then
    if v_trial.trial_program = 'commercial_launch_2026' then
      if v_trial.expires_at > v_now then
        return public.phase4_access_snapshot(p_user_id, false, null);
      end if;
      raise exception 'The Free Trial has already been used';
    end if;

    -- Historical beta/legacy trials do not disqualify an existing user from
    -- the separately approved 2026 launch trial.
    update public.access_trials
    set started_at = v_now,
        expires_at = v_settings.launch_trial_ends_at,
        first_exam_request_key = p_request_key,
        trial_program = 'commercial_launch_2026',
        manually_adjusted_at = null,
        manually_adjusted_by = null,
        adjustment_reason = null
    where user_id = p_user_id;
  else
    insert into public.access_trials (
      user_id,
      started_at,
      expires_at,
      first_exam_request_key,
      trial_program
    ) values (
      p_user_id,
      v_now,
      v_settings.launch_trial_ends_at,
      p_request_key,
      'commercial_launch_2026'
    );
  end if;

  return public.phase4_access_snapshot(p_user_id, false, null);
end;
$$;

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
  v_profile_complete boolean := false;
  v_beta public.free_beta_access%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_payment public.payment_requests%rowtype;
  v_trial public.access_trials%rowtype;
  v_legacy_used integer := 0;
  v_completed integer := 0;
  v_reserved integer := 0;
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
    select 1
    from auth.users
    where id = p_user_id
      and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select encode(
    extensions.digest(lower(btrim(email)), 'sha256'),
    'hex'
  )
  into v_email_hash
  from auth.users
  where id = p_user_id
    and email is not null;

  if v_email_hash is not null then
    perform public.phase4_claim_founding_beta(p_user_id, v_email_hash);
  end if;

  select coalesce(role, 'student') into v_role
  from public.user_roles
  where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  select exists (
    select 1
    from public.terms_acceptances
    where user_id = p_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) into v_terms_ok;

  -- Preserve the retired pre-commercial trial activation contract only while
  -- the commercial launch is disabled.
  if p_activate_trial and v_terms_ok and not v_settings.commercial_launch_enabled then
    if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
      raise exception 'A valid first-exam request key is required';
    end if;
    insert into public.access_trials (
      user_id, started_at, expires_at, first_exam_request_key, trial_program
    ) values (
      p_user_id,
      v_now,
      v_now + make_interval(hours => v_settings.trial_duration_hours),
      p_request_key,
      'legacy'
    )
    on conflict (user_id) do nothing;
  end if;

  select (
    p.commercial_onboarding_completed_at is not null
    or p.profile_completed_at is not null
  )
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  v_profile_complete := coalesce(v_profile_complete, false);

  select * into v_beta
  from public.free_beta_access
  where user_id = p_user_id;

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

  select * into v_trial
  from public.access_trials
  where user_id = p_user_id;

  select coalesce(successful_grades, 0) into v_legacy_used
  from public.lifetime_grade_usage
  where user_id = p_user_id;
  v_legacy_used := coalesce(v_legacy_used, 0);

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

  v_checkout_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and v_now <= v_settings.early_access_sales_close_at
    and exists (
      select 1
      from public.plan_catalog
      where plan_code = 'early_access_beta'
        and status = 'active'
        and checkout_enabled
        and price_php = 149.00
    );

  if v_terms_ok then
    if v_role = 'super_admin' then
      v_allowed := true;
      v_unlimited := true;
      v_basis := 'super_admin';
      v_access_mode := 'administrator';
      v_account_label := 'Administrator';
    elsif v_role = 'founder_admin' then
      v_allowed := true;
      v_unlimited := true;
      v_basis := 'founder_admin';
      v_access_mode := 'administrator';
      v_account_label := 'Administrator';
    elsif v_settings.global_beta_all_access_enabled then
      v_allowed := true;
      v_unlimited := true;
      v_basis := 'global_beta_all_access';
      v_access_mode := 'global_beta';
      v_account_label := 'All Access';
    elsif v_settings.commercial_launch_enabled then
      if not v_profile_complete then
        v_basis := 'profile_required';
        v_access_mode := 'locked';
        v_account_label := 'Complete profile';
      elsif coalesce(v_beta.enabled, false)
         and v_beta.access_program = 'founding_beta_2026'
         and v_beta.expires_at > v_now then
        v_allowed := true;
        v_unlimited := true;
        v_basis := 'founding_beta';
        v_access_mode := 'founding_beta';
        v_account_label := 'Founding Beta';
        v_entitlement_ends_at := v_beta.expires_at;
      elsif v_subscription.id is not null then
        v_allowed := true;
        v_unlimited := true;
        v_basis := case
          when v_subscription.plan_code = 'early_access_beta'
            then 'early_access'
          else 'paid_subscription'
        end;
        v_access_mode := case
          when v_subscription.plan_code = 'early_access_beta'
            then 'early_access'
          else 'legacy_paid'
        end;
        v_account_label := case
          when v_subscription.plan_code = 'early_access_beta'
            then 'Early Access'
          else 'Paid Access'
        end;
        v_entitlement_ends_at := v_subscription.expires_at;
      elsif v_payment.id is not null then
        v_allowed := true;
        v_unlimited := true;
        v_basis := 'provisional_payment';
        v_access_mode := 'provisional';
        v_account_label := 'Early Access — pending';
        v_entitlement_ends_at := v_payment.provisional_access_expires_at;
        v_payment_state := v_payment.status;
      elsif v_settings.mandatory_access_choice_enabled then
        if v_trial.user_id is not null
           and v_trial.trial_program = 'commercial_launch_2026'
           and v_trial.expires_at > v_now then
          v_allowed := true;
          v_unlimited := true;
          v_basis := 'launch_trial';
          v_access_mode := 'trial';
          v_account_label := 'Free Trial';
          v_entitlement_ends_at := v_trial.expires_at;
        elsif v_trial.user_id is not null
           and v_trial.trial_program = 'commercial_launch_2026' then
          v_basis := 'trial_expired';
          v_access_mode := 'locked';
          v_account_label := 'Free Trial expired';
        else
          v_basis := 'plan_selection_required';
          v_access_mode := 'locked';
          v_account_label := 'Choose access';
        end if;
      else
        -- Safe pre-activation state: no automatic daily-free entitlement.
        v_basis := 'payment_required';
        v_access_mode := 'locked';
        v_account_label := 'Access choice pending';
      end if;
    else
      -- Legacy behavior remains available only when commercial launch is off.
      if coalesce(v_beta.enabled, false)
         and (v_beta.expires_at is null or v_beta.expires_at > v_now) then
        v_allowed := true;
        v_unlimited := true;
        v_basis := 'free_beta';
        v_access_mode := 'legacy_beta';
        v_account_label := 'Beta Access';
      elsif v_subscription.id is not null then
        v_allowed := true;
        v_unlimited := true;
        v_basis := 'paid_subscription';
        v_access_mode := 'legacy_paid';
        v_account_label := 'Paid Access';
      elsif v_trial.user_id is not null
         and v_trial.expires_at > v_now then
        v_allowed := true;
        v_unlimited := true;
        v_basis := 'trial';
        v_access_mode := 'trial';
        v_account_label := 'Trial';
      elsif v_legacy_used < v_settings.lifetime_free_grades then
        v_allowed := true;
        v_unlimited := false;
        v_basis := 'lifetime_free';
        v_access_mode := 'legacy_free';
        v_account_label := 'Free';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'basis', v_basis,
    'termsRequired', not v_terms_ok,
    'profileCompleted', v_profile_complete,
    'choiceRequired', v_basis in (
      'plan_selection_required',
      'trial_expired',
      'payment_required'
    ),
    'paymentRequired', v_basis = 'payment_required',
    'planSelectionRequired', v_basis in (
      'plan_selection_required',
      'trial_expired'
    ),
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'dailyLimit', case
      when v_settings.commercial_launch_enabled then 0
      else v_settings.lifetime_free_grades
    end,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'remainingToday', case
      when v_settings.commercial_launch_enabled then 0
      else greatest(0, v_settings.lifetime_free_grades - v_legacy_used)
    end,
    'resetAt', public.phase4_ph_reset_at(v_now),
    'checkoutOpen', v_checkout_open,
    'priceCentavos', 14900,
    'salesCloseAt', v_settings.early_access_sales_close_at,
    'entitlementEndsAt', v_entitlement_ends_at,
    'paymentState', v_payment_state,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'mandatoryAccessChoiceEnabled', v_settings.mandatory_access_choice_enabled,
    'trialAvailable',
      v_settings.mandatory_access_choice_enabled
      and v_profile_complete
      and v_terms_ok
      and v_now < v_settings.launch_trial_ends_at
      and not (
        v_trial.user_id is not null
        and v_trial.trial_program = 'commercial_launch_2026'
      ),
    'trialEndsAt', v_settings.launch_trial_ends_at,
    'trial', jsonb_build_object(
      'startedAt', v_trial.started_at,
      'expiresAt', v_trial.expires_at,
      'active', coalesce(
        v_trial.trial_program = 'commercial_launch_2026'
        and v_trial.expires_at > v_now,
        false
      ),
      'program', v_trial.trial_program
    ),
    'globalBeta', jsonb_build_object(
      'enabled', v_settings.global_beta_all_access_enabled,
      'eligible', v_settings.global_beta_all_access_enabled,
      'active', v_settings.global_beta_all_access_enabled and v_terms_ok,
      'expiresAt', null
    ),
    'freeGrades', jsonb_build_object(
      'limit', case
        when v_settings.commercial_launch_enabled then 0
        else v_settings.lifetime_free_grades
      end,
      'used', case
        when v_settings.commercial_launch_enabled then 0
        else v_legacy_used
      end,
      'remaining', case
        when v_settings.commercial_launch_enabled then 0
        else greatest(0, v_settings.lifetime_free_grades - v_legacy_used)
      end
    ),
    'freeBeta', jsonb_build_object(
      'enabled', coalesce(v_beta.enabled, false),
      'expiresAt', v_beta.expires_at,
      'active', coalesce(
        v_beta.enabled
        and (v_beta.expires_at is null or v_beta.expires_at > v_now),
        false
      ),
      'program', v_beta.access_program
    ),
    'subscription', case
      when v_subscription.id is null then null
      else jsonb_build_object(
        'id', v_subscription.id,
        'planCode', v_subscription.plan_code,
        'status', v_subscription.status,
        'source', v_subscription.source,
        'startsAt', v_subscription.starts_at,
        'expiresAt', v_subscription.expires_at
      )
    end
  );
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
  v_settings public.platform_access_settings%rowtype;
  v_paid_open boolean;
  v_trial_open boolean;
  v_early public.plan_catalog%rowtype;
begin
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_early
  from public.plan_catalog
  where plan_code = 'early_access_beta';

  v_paid_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and clock_timestamp() <= v_settings.early_access_sales_close_at
    and v_early.status = 'active'
    and v_early.checkout_enabled;

  v_trial_open := v_settings.commercial_launch_enabled
    and v_settings.mandatory_access_choice_enabled
    and clock_timestamp() < v_settings.launch_trial_ends_at;

  if not v_settings.mandatory_access_choice_enabled then
    return jsonb_build_array(
      jsonb_build_object(
        'planCode', 'early_access_beta',
        'name', 'Early Access',
        'pricePhp', 149,
        'priceCentavos', 14900,
        'billing', 'one_time',
        'checkoutEnabled', v_paid_open,
        'status', case when v_paid_open then 'active' else 'closed' end,
        'displayOrder', 1,
        'promotional', true,
        'salesCloseAt', v_settings.early_access_sales_close_at,
        'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
        'description', case
          when v_paid_open
            then '₱149 one-time for unlimited access through October 1, 2026.'
          else 'The Early Access offer is closed.'
        end,
        'features', v_early.features,
        'note', 'One-time payment. No automatic renewal.'
      )
    );
  end if;

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'free',
      'name', 'Free Trial',
      'pricePhp', 0,
      'priceCentavos', 0,
      'billing', 'fixed_launch_trial',
      'checkoutEnabled', v_trial_open,
      'status', case when v_trial_open then 'active' else 'closed' end,
      'displayOrder', 1,
      'salesCloseAt', v_settings.launch_trial_ends_at,
      'entitlementEndsAt', v_settings.launch_trial_ends_at,
      'description',
        'Complimentary full practice access through September 1, 2026 at 11:59 PM Philippine time.',
      'features', jsonb_build_array(
        'Unlimited protected practice during the trial',
        'No payment required',
        'Ends September 1, 2026 at 11:59 PM Philippine time',
        'One Free Trial per account'
      ),
      'note', 'Choosing the Free Trial starts it immediately.'
    ),
    jsonb_build_object(
      'planCode', 'early_access_beta',
      'name', 'Early Access',
      'pricePhp', 149,
      'priceCentavos', 14900,
      'billing', 'one_time',
      'checkoutEnabled', v_paid_open,
      'status', case when v_paid_open then 'active' else 'closed' end,
      'displayOrder', 2,
      'promotional', true,
      'salesCloseAt', v_settings.early_access_sales_close_at,
      'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
      'description', case
        when v_paid_open
          then '₱149 one-time for unlimited access through October 1, 2026.'
        else 'The Early Access offer is closed.'
      end,
      'features', v_early.features,
      'note', 'One-time payment. No automatic renewal.'
    )
  );
end;
$$;

revoke all on function public.phase4_choose_launch_trial(uuid, text)
  from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.phase4_plan_catalog()
  from public, anon, authenticated;

grant execute on function public.phase4_choose_launch_trial(uuid, text)
  to service_role;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;
grant execute on function public.phase4_plan_catalog()
  to service_role;

comment on function public.phase4_choose_launch_trial(uuid, text)
  is 'Starts the one-time owner-approved Free Trial through September 1, 2026 for an authenticated, eligible ordinary account.';
comment on function public.phase4_access_snapshot(uuid, boolean, text)
  is 'Server-authoritative two-option commercial access resolver. Ordinary accounts must choose Free Trial or Early Access.';
comment on function public.phase4_plan_catalog()
  is 'Public catalog for the required Free Trial or ₱149 Early Access choice.';

commit;
