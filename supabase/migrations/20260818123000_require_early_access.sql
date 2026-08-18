-- Corrective commercial-access policy for Due Diligence.
--
-- Ordinary authenticated users no longer receive an automatic daily-free
-- entitlement. Access is allowed only for administrators, approved Founding
-- Beta accounts, active paid subscriptions, or a valid provisional payment.
-- The existing ₱149 Early Access checkout remains available through the
-- previously approved sales-close date.

begin;

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

  -- Retained only for pre-commercial rollback compatibility. Commercial
  -- access intentionally does not activate or honor a general trial.
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
      where status = 'reserved' and reservation_expires_at > v_now
    )
  into v_completed, v_reserved
  from public.grade_reservations
  where user_id = p_user_id
    and consumes_quota;

  v_completed := coalesce(v_completed, 0);
  v_reserved := coalesce(v_reserved, 0);
  v_remaining := greatest(
    0,
    v_settings.free_daily_grade_limit - v_completed - v_reserved
  );

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
      if coalesce(v_beta.enabled, false)
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
      else
        -- No plan selection or valid entitlement means no protected access.
        v_allowed := false;
        v_unlimited := false;
        v_basis := 'payment_required';
        v_access_mode := 'locked';
        v_account_label := 'Early Access required';
        v_remaining := 0;
      end if;
    else
      -- Pre-activation compatibility is retained solely for an explicit
      -- commercial rollback. It is not used while commercial launch is active.
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
      elsif v_trial.user_id is not null and v_trial.expires_at > v_now then
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
    'paymentRequired', v_basis = 'payment_required',
    'planSelectionRequired', v_basis = 'payment_required',
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'dailyLimit', v_settings.free_daily_grade_limit,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'remainingToday', case
      when v_unlimited then v_settings.free_daily_grade_limit
      when v_basis = 'payment_required' then 0
      else v_remaining
    end,
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
  v_open boolean;
  v_early public.plan_catalog%rowtype;
begin
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_early
  from public.plan_catalog
  where plan_code = 'early_access_beta';

  v_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and clock_timestamp() <= v_settings.early_access_sales_close_at
    and v_early.status = 'active'
    and v_early.checkout_enabled;

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'early_access_beta',
      'name', 'Early Access',
      'pricePhp', 149,
      'priceCentavos', 14900,
      'billing', 'one_time',
      'checkoutEnabled', v_open,
      'status', case when v_open then 'active' else 'closed' end,
      'displayOrder', 1,
      'promotional', true,
      'salesCloseAt', v_settings.early_access_sales_close_at,
      'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
      'description', case
        when v_open then '₱149 one-time for unlimited access through October 1, 2026.'
        else 'The Early Access offer is closed.'
      end,
      'features', v_early.features,
      'note', 'One-time payment. No automatic renewal.'
    )
  );
end;
$$;

update public.platform_access_settings
set commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = now(),
    updated_at = now()
where singleton = true;

comment on function public.phase4_access_snapshot(uuid, boolean, text)
  is 'Server-authoritative commercial access resolver. Ordinary users require a valid Early Access entitlement; automatic daily-free access is disabled.';

comment on function public.phase4_plan_catalog()
  is 'Public commercial catalog exposing only the approved one-time Early Access offer.';

commit;
