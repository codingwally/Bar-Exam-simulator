-- Correct the explicit Free Trial choice to the owner-approved five-question
-- daily allowance.  No ordinary account receives protected access until it
-- explicitly chooses Free Trial or completes the Early Access payment path.
--
-- Free Trial: five successful protected question submissions per Philippine
-- calendar day through September 1, 2026 at 11:59:59 PM Asia/Manila.
-- Early Access: one-time ₱149 for unlimited access through October 1, 2026.

begin;

update public.platform_access_settings
set free_daily_grade_limit = 5,
    commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = now(),
    updated_at = now()
where singleton = true;

-- A staging-only predecessor recorded the same explicit Free Trial choice in a
-- separate table.  Preserve any such choice without making that table a new
-- production dependency.
do $migration$
begin
  if to_regclass('public.commercial_access_choices') is not null then
    execute $sql$
      insert into public.access_trials (
        user_id,
        started_at,
        expires_at,
        first_exam_request_key,
        trial_program
      )
      select
        c.user_id,
        coalesce(c.trial_started_at, c.selected_at),
        least(
          coalesce(c.trial_expires_at, s.launch_trial_ends_at),
          s.launch_trial_ends_at
        ),
        coalesce(c.request_key, 'migrated_choice_' || replace(c.user_id::text, '-', '')),
        'commercial_launch_2026'
      from public.commercial_access_choices c
      cross join public.platform_access_settings s
      where s.singleton = true
        and c.choice = 'launch_trial'
        and coalesce(c.trial_started_at, c.selected_at) < s.launch_trial_ends_at
      on conflict (user_id) do update
      set started_at = least(
            public.access_trials.started_at,
            excluded.started_at
          ),
          expires_at = greatest(
            public.access_trials.expires_at,
            excluded.expires_at
          ),
          first_exam_request_key = coalesce(
            public.access_trials.first_exam_request_key,
            excluded.first_exam_request_key
          ),
          trial_program = 'commercial_launch_2026'
    $sql$;
  end if;
end;
$migration$;

-- Keep the preceding resolver as a least-privilege compatibility base.  The
-- final resolver below applies the explicit-choice and daily-quota policy.
do $migration$
begin
  if to_regprocedure(
       'public.phase4_access_snapshot_pre_five_daily_choice(uuid,boolean,text)'
     ) is null then
    if to_regprocedure(
         'public.phase4_access_snapshot(uuid,boolean,text)'
       ) is null then
      raise exception 'The commercial access resolver is missing';
    end if;
    execute
      'alter function public.phase4_access_snapshot(uuid, boolean, text) '
      'rename to phase4_access_snapshot_pre_five_daily_choice';
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
  v_trial public.access_trials%rowtype;
  v_base jsonb;
  v_basis text := 'locked';
  v_role text := 'student';
  v_terms_required boolean := false;
  v_profile_complete boolean := false;
  v_completed integer := 0;
  v_reserved integer := 0;
  v_used integer := 0;
  v_remaining integer := 0;
  v_trial_selected boolean := false;
  v_trial_active boolean := false;
  v_common jsonb;
begin
  v_base := public.phase4_access_snapshot_pre_five_daily_choice(
    p_user_id,
    p_activate_trial,
    p_request_key
  );

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_trial
  from public.access_trials
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
  v_role := coalesce(v_base ->> 'role', 'student');
  v_terms_required := coalesce(
    (v_base ->> 'termsRequired')::boolean,
    false
  );
  v_trial_selected := coalesce(
    v_trial.trial_program = 'commercial_launch_2026',
    false
  );
  v_trial_active := v_trial_selected
    and v_trial.expires_at > v_now
    and v_now < v_settings.launch_trial_ends_at;

  v_common := jsonb_build_object(
    'profileCompleted', v_profile_complete,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'mandatoryAccessChoiceEnabled',
      v_settings.mandatory_access_choice_enabled,
    'dailyLimit', v_settings.free_daily_grade_limit,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'resetAt', public.phase4_ph_reset_at(v_now),
    'trialAvailable',
      v_settings.commercial_launch_enabled
      and v_settings.mandatory_access_choice_enabled
      and not v_terms_required
      and v_profile_complete
      and v_now < v_settings.launch_trial_ends_at
      and not v_trial_selected,
    'trialEndsAt', v_settings.launch_trial_ends_at,
    'trial', jsonb_build_object(
      'startedAt', v_trial.started_at,
      'expiresAt', v_trial.expires_at,
      'active', v_trial_active,
      'program', v_trial.trial_program
    )
  );

  if v_terms_required then
    return v_base || v_common || jsonb_build_object(
      'allowed', false,
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

  if v_trial_active then
    return v_base || v_common || jsonb_build_object(
      'allowed', v_remaining > 0,
      'basis', case
        when v_remaining > 0 then 'daily_free'
        else 'daily_limit_reached'
      end,
      'accessMode', 'free',
      'accountLabel', 'Free Trial',
      'unlimited', false,
      'choiceRequired', false,
      'planSelectionRequired', false,
      'paymentRequired', false,
      'selectedChoice', 'free_trial',
      'choiceRecordedAt', v_trial.started_at,
      'entitlementEndsAt', v_trial.expires_at,
      'remainingToday', v_remaining,
      'freeGrades', jsonb_build_object(
        'limit', v_settings.free_daily_grade_limit,
        'used', v_used,
        'remaining', v_remaining
      )
    );
  end if;

  if v_trial_selected then
    return v_base || v_common || jsonb_build_object(
      'allowed', false,
      'basis', 'trial_expired',
      'accessMode', 'locked',
      'accountLabel', 'Free Trial ended',
      'unlimited', false,
      'choiceRequired', true,
      'planSelectionRequired', true,
      'paymentRequired', true,
      'selectedChoice', 'free_trial',
      'choiceRecordedAt', v_trial.started_at,
      'entitlementEndsAt', v_trial.expires_at,
      'remainingToday', 0,
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
  v_free_open boolean;
  v_early_open boolean;
begin
  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  select * into v_early
  from public.plan_catalog
  where plan_code = 'early_access_beta';

  v_free_open := v_settings.commercial_launch_enabled
    and v_settings.mandatory_access_choice_enabled
    and v_now < v_settings.launch_trial_ends_at;

  v_early_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and v_now <= v_settings.early_access_sales_close_at
    and v_early.status = 'active'
    and v_early.checkout_enabled;

  if not v_settings.mandatory_access_choice_enabled then
    return jsonb_build_array(
      jsonb_build_object(
        'planCode', 'early_access_beta',
        'name', 'Early Access',
        'pricePhp', 149,
        'priceCentavos', 14900,
        'billing', 'one_time',
        'checkoutEnabled', v_early_open,
        'status', case when v_early_open then 'active' else 'closed' end,
        'displayOrder', 1,
        'promotional', true,
        'salesCloseAt', v_settings.early_access_sales_close_at,
        'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
        'description', case
          when v_early_open then
            '₱149 one-time for unlimited access through October 1, 2026.'
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
      'billing', 'daily_free_trial',
      'checkoutEnabled', v_free_open,
      'status', case when v_free_open then 'active' else 'closed' end,
      'displayOrder', 1,
      'promotional', false,
      'salesCloseAt', v_settings.launch_trial_ends_at,
      'entitlementEndsAt', v_settings.launch_trial_ends_at,
      'description', case
        when v_free_open then
          'Up to five protected question submissions per Philippine calendar day through September 1, 2026.'
        else 'The Free Trial has ended.'
      end,
      'features', jsonb_build_array(
        'Five protected question submissions per Philippine day',
        'Allowance resets at midnight in Asia/Manila',
        'Saved progress and history remain account-bound',
        'No payment and no automatic renewal'
      ),
      'note',
        'One Free Trial per account. Signing in never starts it automatically.'
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

revoke all on function public.phase4_access_snapshot_pre_five_daily_choice(
  uuid,
  boolean,
  text
) from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.phase4_plan_catalog()
  from public, anon, authenticated;

grant execute on function public.phase4_access_snapshot_pre_five_daily_choice(
  uuid,
  boolean,
  text
) to service_role;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;
grant execute on function public.phase4_plan_catalog()
  to service_role;

comment on function public.phase4_access_snapshot(uuid, boolean, text)
  is 'Server-authoritative explicit Free Trial choice with five successful protected submissions per Philippine day.';
comment on function public.phase4_plan_catalog()
  is 'Retainer catalog offering the five-per-day Free Trial or one-time ₱149 Early Access.';

commit;
