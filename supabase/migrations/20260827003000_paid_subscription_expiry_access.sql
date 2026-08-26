begin;

create index if not exists subscriptions_paid_expiry_lookup_idx
  on public.subscriptions (user_id, expires_at desc, updated_at desc)
  where source in ('manual_payment', 'admin_adjustment', 'migration')
    and status in ('active', 'paused', 'cancelled', 'expired')
    and expires_at is not null;

-- A paid subscriber must renew after the paid entitlement expires. The
-- one-time introductory grant is for accounts that have never crossed into a
-- paid entitlement; it is not a fallback or reset after paid access ends.
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
  v_expired_paid_subscription public.subscriptions%rowtype;
  v_payment public.payment_requests%rowtype;
  v_grant public.introductory_token_grants%rowtype;
  v_used integer := 0;
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
  v_last_sign_in_at timestamptz;
  v_reauthentication_required boolean := false;
  v_introductory_tokens_eligible boolean := true;
  v_legacy_access jsonb;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'Authenticated user required'; end if;

  select * into strict v_settings
  from public.platform_access_settings where singleton = true;

  -- Resolve current and historical paid entitlement before any trial/token
  -- activation. manual_payment is direct payment evidence; admin_adjustment is
  -- the audited owner repair/activation path (complimentary has its own source);
  -- migration retains paid accounts imported from the legacy system.
  select * into v_subscription from public.subscriptions
  where user_id = p_user_id and status = 'active'
    and starts_at <= v_now and (expires_at is null or expires_at > v_now)
  order by expires_at desc nulls first, updated_at desc, created_at desc limit 1;

  select * into v_expired_paid_subscription from public.subscriptions
  where user_id = p_user_id
    and source in ('manual_payment', 'admin_adjustment', 'migration')
    and status in ('active', 'paused', 'cancelled', 'expired')
    and starts_at is not null and starts_at <= v_now
    and expires_at is not null and expires_at <= v_now
  order by expires_at desc, updated_at desc, created_at desc limit 1;
  v_introductory_tokens_eligible := v_expired_paid_subscription.id is null;

  -- Preserve the disabled-soft-launch rollback path, but never reactivate a
  -- trial for a user with expired paid history. Administrator, Founding Beta,
  -- active paid, and provisional-payment entitlements remain valid overrides.
  if not v_settings.soft_launch_enabled then
    v_legacy_access := public.phase4_access_snapshot_pre_soft_launch(
      p_user_id,
      p_activate_trial and v_introductory_tokens_eligible,
      p_request_key
    );
    if not v_introductory_tokens_eligible
       and v_subscription.id is null
       and coalesce(v_legacy_access->>'basis', '') not in (
         'super_admin', 'founder_admin', 'global_beta_all_access',
         'founding_beta', 'free_beta', 'paid_subscription', 'early_access',
         'provisional_payment'
       ) then
      return v_legacy_access || jsonb_build_object(
        'allowed', false,
        'basis', 'paid_subscription_expired',
        'accessMode', 'payment_required',
        'accountLabel', 'Paid Bar access expired',
        'unlimited', false,
        'paymentRequired', true,
        'planSelectionRequired', false,
        'choiceRequired', false,
        'paidSubscriptionExpired', true,
        'introductoryTokensEligible', false,
        'tokenAcknowledgementRequired', false,
        'tokenLimit', 0,
        'tokensUsed', 0,
        'tokensReserved', 0,
        'tokensRemaining', 0,
        'dailyLimit', 0,
        'completedToday', 0,
        'reservedToday', 0,
        'remainingToday', 0,
        'freeGrades', jsonb_build_object('limit', 0, 'used', 0, 'remaining', 0),
        'entitlementEndsAt', v_expired_paid_subscription.expires_at,
        'paymentState', 'expired',
        'subscription', jsonb_build_object(
          'id', v_expired_paid_subscription.id,
          'planCode', v_expired_paid_subscription.plan_code,
          'status', 'expired',
          'source', v_expired_paid_subscription.source,
          'startsAt', v_expired_paid_subscription.starts_at,
          'expiresAt', v_expired_paid_subscription.expires_at
        )
      );
    end if;
    return v_legacy_access;
  end if;

  select
    case when email is null then null
      else encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex') end,
    last_sign_in_at
  into v_email_hash, v_last_sign_in_at
  from auth.users
  where id = p_user_id;
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

  select commercial_onboarding_completed_at is not null
  into v_profile_complete
  from public.profiles where id = p_user_id;
  v_profile_complete := coalesce(v_profile_complete, false);

  select * into v_beta from public.free_beta_access
  where user_id = p_user_id
    and enabled
    and access_program = 'founding_beta_2026'
    and (expires_at is null or expires_at > v_now);

  select * into v_payment from public.payment_requests
  where user_id = p_user_id
    and plan_code = 'early_access_beta'
    and status in ('pending','needs_information')
    and provisional_access_started_at is not null
    and provisional_access_expires_at > v_now
    and provisional_access_revoked_at is null
  order by submitted_at desc limit 1;

  -- Never create or replenish an introductory grant after paid history has
  -- expired. Existing ledger evidence remains immutable, but it cannot
  -- authorize Bar Exam Simulator use after paid expiry.
  if v_introductory_tokens_eligible then
    insert into public.introductory_token_grants (
      user_id, token_limit, disclosure_version, granted_at
    ) values (
      p_user_id, v_settings.introductory_token_limit,
      v_settings.introductory_token_disclosure_version, v_now
    ) on conflict (user_id) do nothing;

    select * into strict v_grant from public.introductory_token_grants
    where user_id = p_user_id;

    insert into public.introductory_token_ledger (
      user_id, grant_id, event_type, token_delta, balance_after, reason, occurred_at
    ) values (
      p_user_id, v_grant.id, 'grant', 5, 5,
      'One-time introductory token grant', v_grant.granted_at
    ) on conflict do nothing;

    select count(*) into v_used
    from public.introductory_token_ledger
    where grant_id = v_grant.id and event_type = 'consumed';
    select count(*) into v_reserved
    from public.grade_reservations
    where user_id = p_user_id
      and consumes_quota
      and status = 'reserved'
      and reservation_expires_at > v_now
      and reserved_at >= v_grant.granted_at;
    v_remaining := greatest(0, v_grant.token_limit - v_used - v_reserved);
  else
    -- Read existing evidence only so active paid accounts keep an accurate
    -- audit trail. It is intentionally hidden from access/quota decisions.
    select * into v_grant from public.introductory_token_grants
    where user_id = p_user_id;
  end if;

  v_checkout_open := v_settings.public_pricing_enabled
    and v_now < v_settings.early_access_sales_close_at
    and exists (
      select 1 from public.plan_catalog
      where plan_code = 'early_access_beta'
        and status = 'active' and checkout_enabled and price_php = 149.00
    );

  v_reauthentication_required :=
    v_settings.reauthentication_required_after is not null
    and coalesce(v_last_sign_in_at, '-infinity'::timestamptz)
      < v_settings.reauthentication_required_after;

  if v_terms_ok then
    if v_role in ('super_admin','founder_admin') then
      v_allowed := true; v_unlimited := true; v_basis := v_role;
      v_access_mode := 'administrator'; v_account_label := 'Administrator';
    elsif v_beta.user_id is not null then
      v_allowed := true; v_unlimited := true; v_basis := 'founding_beta';
      v_access_mode := 'founding_beta'; v_account_label := 'Founding Beta';
      v_entitlement_ends_at := v_beta.expires_at;
    elsif v_reauthentication_required then
      v_basis := 'reauthentication_required';
      v_access_mode := 'locked';
      v_account_label := 'Sign in again';
    elsif not v_introductory_tokens_eligible
       and v_subscription.id is null
       and v_payment.id is null then
      v_basis := 'paid_subscription_expired';
      v_access_mode := 'payment_required';
      v_account_label := 'Paid Bar access expired';
      v_entitlement_ends_at := v_expired_paid_subscription.expires_at;
      v_payment_state := 'expired';
    elsif not v_profile_complete
       or (
         v_introductory_tokens_eligible and (
           v_grant.acknowledged_at is null
           or v_grant.disclosure_version <> v_settings.introductory_token_disclosure_version
         )
       ) then
      v_basis := 'profile_required';
      v_access_mode := 'locked';
      v_account_label := 'Complete setup';
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
      v_allowed := true; v_unlimited := true; v_basis := 'provisional_payment';
      v_access_mode := 'provisional'; v_account_label := 'Early Access — pending';
      v_entitlement_ends_at := v_payment.provisional_access_expires_at;
      v_payment_state := v_payment.status;
    elsif v_remaining > 0 then
      v_allowed := true; v_basis := 'introductory_tokens';
      v_access_mode := 'introductory'; v_account_label := 'Introductory access';
    else
      v_basis := 'trial_tokens_exhausted';
      v_access_mode := 'locked'; v_account_label := 'Early Access required';
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'basis', v_basis,
    'termsRequired', not v_terms_ok,
    'reauthenticationRequired', v_reauthentication_required
      and v_role not in ('super_admin','founder_admin')
      and v_beta.user_id is null,
    'profileCompleted', v_profile_complete and (
      not v_introductory_tokens_eligible
      or (
        v_grant.acknowledged_at is not null
        and v_grant.disclosure_version = v_settings.introductory_token_disclosure_version
      )
    ),
    'tokenAcknowledgementRequired', v_introductory_tokens_eligible and (
      v_grant.acknowledged_at is null
      or v_grant.disclosure_version <> v_settings.introductory_token_disclosure_version
    ),
    'choiceRequired', false,
    'planSelectionRequired', false,
    'paymentRequired', v_basis in ('trial_tokens_exhausted', 'paid_subscription_expired'),
    'paidSubscriptionExpired', v_basis = 'paid_subscription_expired',
    'introductoryTokensEligible', v_introductory_tokens_eligible,
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'tokenLimit', case when v_introductory_tokens_eligible then v_grant.token_limit else 0 end,
    'tokensUsed', case when v_introductory_tokens_eligible then v_used else 0 end,
    'tokensReserved', case when v_introductory_tokens_eligible then v_reserved else 0 end,
    'tokensRemaining', case when v_introductory_tokens_eligible then v_remaining else 0 end,
    'tokenGrantAt', case when v_introductory_tokens_eligible then v_grant.granted_at else null end,
    'tokenAcknowledgedAt', case when v_introductory_tokens_eligible then v_grant.acknowledged_at else null end,
    'tokenDisclosureVersion', v_settings.introductory_token_disclosure_version,
    -- Compatibility aliases for the database-first/Worker-first rollout.
    'dailyLimit', case when v_introductory_tokens_eligible then v_grant.token_limit else 0 end,
    'completedToday', case when v_introductory_tokens_eligible then v_used else 0 end,
    'reservedToday', case when v_introductory_tokens_eligible then v_reserved else 0 end,
    'remainingToday', case when v_introductory_tokens_eligible then v_remaining else 0 end,
    'resetAt', null,
    'checkoutOpen', v_checkout_open,
    'priceCentavos', 14900,
    'regularPriceCentavos', v_settings.early_access_regular_price_centavos,
    'renewalAt', v_settings.early_access_manual_renewal_at,
    'manualRenewal', true,
    'automaticRenewal', false,
    'salesCloseAt', null,
    'entitlementEndsAt', v_entitlement_ends_at,
    'paymentState', v_payment_state,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'softLaunchEnabled', v_settings.soft_launch_enabled,
    'mandatoryAccessChoiceEnabled', false,
    'freeChoiceAvailable', false,
    'selectedChoice', null,
    'freeGrades', jsonb_build_object(
      'limit', case when v_introductory_tokens_eligible then v_grant.token_limit else 0 end,
      'used', case when v_introductory_tokens_eligible then v_used else 0 end,
      'remaining', case when v_introductory_tokens_eligible then v_remaining else 0 end
    ),
    'freeBeta', jsonb_build_object(
      'enabled', v_beta.user_id is not null,
      'expiresAt', v_beta.expires_at,
      'active', v_beta.user_id is not null,
      'program', v_beta.access_program
    ),
    'subscription', case
      when v_subscription.id is not null then jsonb_build_object(
        'id', v_subscription.id,
        'planCode', v_subscription.plan_code,
        'status', v_subscription.status,
        'source', v_subscription.source,
        'startsAt', v_subscription.starts_at,
        'expiresAt', v_subscription.expires_at
      )
      when v_expired_paid_subscription.id is not null then jsonb_build_object(
        'id', v_expired_paid_subscription.id,
        'planCode', v_expired_paid_subscription.plan_code,
        'status', 'expired',
        'source', v_expired_paid_subscription.source,
        'startsAt', v_expired_paid_subscription.starts_at,
        'expiresAt', v_expired_paid_subscription.expires_at
      )
      else null
    end
  );
end;
$$;

revoke all on function public.phase4_access_snapshot(uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot(uuid,boolean,text)
  to service_role;

commit;
