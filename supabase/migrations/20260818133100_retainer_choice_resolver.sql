-- Require a recorded Retainer choice in the access resolver and publish two choices.
-- Split from the reviewed explicit Retainer choice release for rolling safety.

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
  v_choice public.commercial_access_choices%rowtype;
  v_base jsonb;
  v_basis text;
  v_terms_required boolean := false;
  v_profile_complete boolean := false;
  v_trial_active boolean := false;
  v_trial_available boolean := false;
  v_selected_choice text;
begin
  v_base := public.phase4_access_snapshot_base(
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

  v_basis := coalesce(v_base ->> 'basis', 'locked');
  v_terms_required := coalesce(
    (v_base ->> 'termsRequired')::boolean,
    false
  );
  v_selected_choice := v_choice.choice;
  v_trial_active := v_choice.trial_started_at is not null
    and v_choice.trial_expires_at > v_now;
  v_trial_available := v_now <= v_settings.launch_trial_ends_at
    and (v_choice.user_id is null or v_choice.trial_started_at is null);

  if v_basis in ('early_access', 'paid_subscription', 'provisional_payment') then
    v_selected_choice := coalesce(v_selected_choice, 'early_access');
  end if;

  v_base := v_base || jsonb_build_object(
    'profileCompleted', v_profile_complete,
    'selectedChoice', v_selected_choice,
    'choiceRecordedAt', v_choice.selected_at,
    'choiceSource', v_choice.choice_source,
    'trialStartedAt', v_choice.trial_started_at,
    'trialEndsAt', coalesce(
      v_choice.trial_expires_at,
      v_settings.launch_trial_ends_at
    ),
    'trialAvailable', v_trial_available,
    'trial', jsonb_build_object(
      'startedAt', v_choice.trial_started_at,
      'expiresAt', v_choice.trial_expires_at,
      'active', v_trial_active,
      'program', case
        when v_choice.trial_started_at is not null
          then 'commercial_launch_2026'
        else null
      end
    ),
    'mandatoryAccessChoiceEnabled',
      v_settings.mandatory_access_choice_enabled
  );

  if v_terms_required then
    return v_base;
  end if;

  if v_basis in ('super_admin', 'founder_admin') then
    return v_base || jsonb_build_object(
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false
    );
  end if;

  if not v_profile_complete then
    return v_base || jsonb_build_object(
      'allowed', false,
      'basis', 'profile_required',
      'accessMode', 'locked',
      'accountLabel', 'Complete profile',
      'unlimited', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'remainingToday', 0
    );
  end if;

  if v_basis in (
    'founding_beta', 'early_access',
    'paid_subscription', 'provisional_payment'
  ) then
    return v_base || jsonb_build_object(
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false
    );
  end if;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    return v_base;
  end if;

  if v_choice.user_id is null then
    return v_base || jsonb_build_object(
      'allowed', false,
      'basis', 'plan_selection_required',
      'accessMode', 'locked',
      'accountLabel', 'Choose access',
      'unlimited', false,
      'choiceRequired', true,
      'planSelectionRequired', true,
      'paymentRequired', false,
      'selectedChoice', null,
      'entitlementEndsAt', null,
      'dailyLimit', 0,
      'remainingToday', 0,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  if v_trial_active then
    return v_base || jsonb_build_object(
      'allowed', true,
      'basis', 'launch_trial',
      'accessMode', 'launch_trial',
      'accountLabel', 'Free Trial',
      'unlimited', true,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'entitlementEndsAt', v_choice.trial_expires_at,
      'dailyLimit', 0,
      'remainingToday', 0,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  if v_choice.choice = 'launch_trial' then
    return v_base || jsonb_build_object(
      'allowed', false,
      'basis', 'trial_expired',
      'accessMode', 'locked',
      'accountLabel', 'Free Trial ended',
      'unlimited', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', true,
      'entitlementEndsAt', v_choice.trial_expires_at,
      'dailyLimit', 0,
      'remainingToday', 0,
      'freeGrades', jsonb_build_object(
        'limit', 0,
        'used', 0,
        'remaining', 0
      )
    );
  end if;

  return v_base || jsonb_build_object(
    'allowed', false,
    'basis', 'payment_required',
    'accessMode', 'locked',
    'accountLabel', 'Early Access selected',
    'unlimited', false,
    'choiceRequired', false,
    'planSelectionRequired', false,
    'paymentRequired', true,
    'entitlementEndsAt', null,
    'dailyLimit', 0,
    'remainingToday', 0,
    'freeGrades', jsonb_build_object(
      'limit', 0,
      'used', 0,
      'remaining', 0
    )
  );
end;
$$;

revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;

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
  v_trial_open boolean;
  v_early_open boolean;
begin
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_early
  from public.plan_catalog
  where plan_code = 'early_access_beta';

  v_trial_open := v_settings.commercial_launch_enabled
    and v_settings.mandatory_access_choice_enabled
    and v_now <= v_settings.launch_trial_ends_at;

  v_early_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and v_now <= v_settings.early_access_sales_close_at
    and v_early.status = 'active'
    and v_early.checkout_enabled;

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'free',
      'name', 'Free Trial',
      'pricePhp', 0,
      'priceCentavos', 0,
      'billing', 'trial',
      'checkoutEnabled', v_trial_open,
      'status', case when v_trial_open then 'active' else 'closed' end,
      'displayOrder', 1,
      'promotional', false,
      'salesCloseAt', v_settings.launch_trial_ends_at,
      'entitlementEndsAt', v_settings.launch_trial_ends_at,
      'description', case
        when v_trial_open then
          'Explicitly choose a free launch trial with unlimited access through September 1, 2026.'
        else 'The launch Free Trial has ended.'
      end,
      'features', jsonb_build_array(
        'Unlimited protected practice access through September 1, 2026',
        'Saved progress and history remain account-bound',
        'No payment and no automatic renewal'
      ),
      'note',
        'One trial per account. Signing in never starts it automatically.'
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
        else 'The Early Access offer is closed.'
      end,
      'features', coalesce(
        v_early.features,
        jsonb_build_array(
          'Unlimited protected practice access through October 1, 2026',
          'Provisional access while payment verification is pending',
          'No automatic renewal'
        )
      ),
      'note', 'One-time payment. No automatic renewal.'
    )
  );
end;
$$;

revoke all on function public.phase4_plan_catalog()
  from public, anon, authenticated;
grant execute on function public.phase4_plan_catalog()
  to service_role;

commit;
