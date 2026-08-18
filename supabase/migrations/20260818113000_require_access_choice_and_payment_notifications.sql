-- Require every ordinary commercial account to choose Early Access or the
-- fixed launch trial, and create a private, retryable payment-verification
-- notification queue. Installs disabled for a safe database -> Worker -> Pages
-- rollout. Activation is a separate audited operator update.

begin;

alter table public.platform_access_settings
  add column if not exists mandatory_access_choice_enabled boolean not null default false,
  add column if not exists launch_trial_ends_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz;

update public.platform_access_settings
set launch_trial_ends_at = '2026-09-01 23:59:59+08'::timestamptz
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

create table if not exists public.payment_verifier_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    char_length(email) between 5 and 254
    and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  check (display_name is null or char_length(btrim(display_name)) between 2 and 120)
);
create unique index if not exists payment_verifier_recipients_email_uidx
  on public.payment_verifier_recipients (lower(email));

create table if not exists public.payment_notification_deliveries (
  payment_request_id uuid primary key
    references public.payment_requests(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  lease_until timestamptz,
  provider_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (status = 'processing' and claim_token is not null and lease_until is not null)
    or status <> 'processing'
  )
);
create index if not exists payment_notification_deliveries_queue_idx
  on public.payment_notification_deliveries (status, next_attempt_at, lease_until);

alter table public.payment_verifier_recipients enable row level security;
alter table public.payment_verifier_recipients force row level security;
alter table public.payment_notification_deliveries enable row level security;
alter table public.payment_notification_deliveries force row level security;
revoke all on public.payment_verifier_recipients from public, anon, authenticated;
revoke all on public.payment_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.payment_verifier_recipients to service_role;
grant select, insert, update, delete on public.payment_notification_deliveries to service_role;

create or replace function public.phase4_enqueue_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.plan_code = 'early_access_beta' then
    insert into public.payment_notification_deliveries (
      payment_request_id, status, next_attempt_at
    ) values (
      new.id, 'pending', now()
    )
    on conflict (payment_request_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists phase4_enqueue_payment_notification_trigger
  on public.payment_requests;
create trigger phase4_enqueue_payment_notification_trigger
after insert on public.payment_requests
for each row execute function public.phase4_enqueue_payment_notification();

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
  v_existing public.access_trials%rowtype;
  v_profile_complete boolean := false;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('launch-trial:' || p_user_id::text, 0));
  select * into strict v_settings
  from public.platform_access_settings where singleton = true;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    raise exception 'Launch trial selection is not available';
  end if;
  if v_now >= v_settings.launch_trial_ends_at then
    raise exception 'The launch trial has closed';
  end if;
  if not exists (
    select 1 from public.terms_acceptances
    where user_id = p_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) then
    raise exception 'Current Terms and Privacy acceptance is required';
  end if;

  select coalesce(
    p.commercial_onboarding_completed_at is not null,
    false
  ) or p.profile_completed_at is not null
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  if not coalesce(v_profile_complete, false) then
    raise exception 'Complete the required profile before choosing access';
  end if;

  select * into v_existing
  from public.access_trials
  where user_id = p_user_id
  for update;

  if found then
    if v_existing.trial_program = 'commercial_launch_2026'
       and v_existing.expires_at > v_now then
      return public.phase4_access_snapshot(p_user_id, false, null);
    end if;
    raise exception 'The launch trial has already been used';
  end if;

  insert into public.access_trials (
    user_id, started_at, expires_at, first_exam_request_key, trial_program
  ) values (
    p_user_id, v_now, v_settings.launch_trial_ends_at,
    p_request_key, 'commercial_launch_2026'
  );

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

  if p_activate_trial and v_terms_ok and not v_settings.commercial_launch_enabled then
    if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
      raise exception 'A valid first-exam request key is required';
    end if;
    insert into public.access_trials (
      user_id, started_at, expires_at, first_exam_request_key, trial_program
    ) values (
      p_user_id, v_now, v_now + make_interval(hours => v_settings.trial_duration_hours),
      p_request_key, 'legacy'
    ) on conflict (user_id) do nothing;
  end if;

  select coalesce(
    p.commercial_onboarding_completed_at is not null,
    false
  ) or p.profile_completed_at is not null
  into v_profile_complete
  from public.profiles p
  where p.id = p_user_id;
  v_profile_complete := coalesce(v_profile_complete, false);

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
      v_allowed := true; v_unlimited := true;
      v_basis := 'global_beta_all_access'; v_access_mode := 'global_beta';
      v_account_label := 'All Access';
    elsif v_settings.commercial_launch_enabled then
      if not v_profile_complete then
        v_basis := 'profile_required';
        v_access_mode := 'locked';
        v_account_label := 'Complete profile';
      elsif coalesce(v_beta.enabled, false)
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
      elsif v_settings.mandatory_access_choice_enabled then
        if v_trial.user_id is not null
           and v_trial.trial_program = 'commercial_launch_2026'
           and v_trial.expires_at > v_now then
          v_allowed := true; v_unlimited := true;
          v_basis := 'launch_trial'; v_access_mode := 'trial';
          v_account_label := 'Launch Trial';
          v_entitlement_ends_at := v_trial.expires_at;
        elsif v_trial.user_id is not null
           and v_trial.trial_program = 'commercial_launch_2026' then
          v_basis := 'trial_expired'; v_access_mode := 'locked';
          v_account_label := 'Trial expired';
        else
          v_basis := 'plan_selection_required'; v_access_mode := 'locked';
          v_account_label := 'Choose access';
        end if;
      elsif v_remaining > 0 then
        v_allowed := true; v_unlimited := false;
        v_basis := 'daily_free'; v_access_mode := 'free';
        v_account_label := 'Free';
      else
        v_basis := 'daily_limit_reached'; v_access_mode := 'free';
        v_account_label := 'Free';
      end if;
    else
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
    'profileCompleted', v_profile_complete,
    'choiceRequired', v_basis in ('plan_selection_required', 'trial_expired'),
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'dailyLimit', case when v_settings.mandatory_access_choice_enabled then 0
      else v_settings.free_daily_grade_limit end,
    'completedToday', v_completed,
    'reservedToday', v_reserved,
    'remainingToday', case
      when not v_allowed then 0
      when v_unlimited then v_settings.free_daily_grade_limit
      else v_remaining end,
    'resetAt', public.phase4_ph_reset_at(v_now),
    'checkoutOpen', v_checkout_open,
    'priceCentavos', 14900,
    'salesCloseAt', v_settings.early_access_sales_close_at,
    'entitlementEndsAt', v_entitlement_ends_at,
    'paymentState', v_payment_state,
    'commercialLaunchEnabled', v_settings.commercial_launch_enabled,
    'mandatoryAccessChoiceEnabled', v_settings.mandatory_access_choice_enabled,
    'trialAvailable', v_settings.mandatory_access_choice_enabled
      and v_profile_complete
      and v_now < v_settings.launch_trial_ends_at
      and not (v_trial.user_id is not null and v_trial.trial_program = 'commercial_launch_2026'),
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
        when v_settings.mandatory_access_choice_enabled then 0
        when v_settings.commercial_launch_enabled then v_settings.free_daily_grade_limit
        else v_settings.lifetime_free_grades end,
      'used', case when v_settings.commercial_launch_enabled then v_completed else v_legacy_used end,
      'remaining', case
        when v_settings.mandatory_access_choice_enabled then 0
        when v_settings.commercial_launch_enabled then v_remaining
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
  v_trial_open boolean;
  v_early public.plan_catalog%rowtype;
begin
  select * into strict v_settings
  from public.platform_access_settings where singleton = true;
  select * into v_early
  from public.plan_catalog where plan_code = 'early_access_beta';
  v_open := v_settings.commercial_launch_enabled
    and v_settings.public_pricing_enabled
    and clock_timestamp() <= v_settings.early_access_sales_close_at
    and v_early.status = 'active' and v_early.checkout_enabled;
  v_trial_open := v_settings.commercial_launch_enabled
    and v_settings.mandatory_access_choice_enabled
    and clock_timestamp() < v_settings.launch_trial_ends_at;

  return jsonb_build_array(
    jsonb_build_object(
      'planCode', 'free',
      'name', case when v_settings.mandatory_access_choice_enabled
        then 'Launch Trial' else 'Free' end,
      'pricePhp', 0,
      'priceCentavos', 0,
      'billing', case when v_settings.mandatory_access_choice_enabled
        then 'fixed_trial' else 'free' end,
      'checkoutEnabled', v_trial_open,
      'status', case when v_settings.mandatory_access_choice_enabled and not v_trial_open
        then 'closed' else 'active' end,
      'displayOrder', 1,
      'salesCloseAt', v_settings.launch_trial_ends_at,
      'entitlementEndsAt', v_settings.launch_trial_ends_at,
      'description', case when v_settings.mandatory_access_choice_enabled
        then 'Optional complimentary access through September 1, 2026 at 11:59 PM Philippine time.'
        else 'Five successful question submissions per Philippine calendar day.' end,
      'features', case when v_settings.mandatory_access_choice_enabled
        then jsonb_build_array(
          'Unlimited successful submissions during the trial',
          'All Due Diligence examination tracks',
          'Ends September 1, 2026 at 11:59 PM Philippine time',
          'One trial per account'
        )
        else jsonb_build_array(
          'Five successful submissions daily',
          'All examination tracks',
          'Allowance resets at Philippine midnight'
        ) end
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

create or replace function public.phase4_payment_notification_context(
  p_payment_request_id uuid,
  p_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_recipients jsonb;
begin
  if p_claim_token is not null and not exists (
    select 1 from public.payment_notification_deliveries d
    where d.payment_request_id = p_payment_request_id
      and d.status = 'processing'
      and d.claim_token = p_claim_token
      and d.lease_until > clock_timestamp()
  ) then
    raise exception 'Payment notification claim is not active';
  end if;

  select coalesce(jsonb_agg(r.email order by r.email), '[]'::jsonb)
  into v_recipients
  from public.payment_verifier_recipients r
  where r.enabled;

  select jsonb_build_object(
    'paymentRequestId', p.id,
    'userId', p.user_id,
    'name', coalesce(nullif(btrim(pr.display_name), ''), 'Not provided'),
    'email', coalesce(nullif(btrim(u.email), ''), 'Not provided'),
    'planCode', p.plan_code,
    'amountPhp', p.trusted_amount_php,
    'paymentMethod', p.payment_method,
    'paymentDate', p.payment_date,
    'transactionReference', p.transaction_reference,
    'studentNote', p.student_note,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'provisionalAccessStartedAt', p.provisional_access_started_at,
    'provisionalAccessExpiresAt', p.provisional_access_expires_at,
    'proofObjectPath', p.proof_object_path,
    'proofOriginalName', p.proof_original_name,
    'proofMimeType', p.proof_mime_type,
    'proofSizeBytes', p.proof_size_bytes,
    'proofSha256', p.proof_sha256,
    'recipients', v_recipients
  ) into v_result
  from public.payment_requests p
  left join public.profiles pr on pr.id = p.user_id
  left join auth.users u on u.id = p.user_id
  where p.id = p_payment_request_id
    and p.plan_code = 'early_access_beta';

  if v_result is null then
    raise exception 'Early Access payment request not found';
  end if;
  return v_result;
end;
$$;

create or replace function public.phase4_claim_payment_notification(
  p_payment_request_id uuid,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_token uuid := gen_random_uuid();
  v_updated uuid;
begin
  if p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid payment notification lease';
  end if;
  update public.payment_notification_deliveries d
  set status = 'processing',
      attempt_count = d.attempt_count + 1,
      claim_token = v_claim_token,
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where d.payment_request_id = p_payment_request_id
    and d.status <> 'sent'
    and d.next_attempt_at <= clock_timestamp()
    and (d.status <> 'processing' or d.lease_until <= clock_timestamp())
  returning d.payment_request_id into v_updated;
  if v_updated is null then return null; end if;
  return public.phase4_payment_notification_context(v_updated, v_claim_token)
    || jsonb_build_object('claimToken', v_claim_token);
end;
$$;

create or replace function public.phase4_claim_payment_notification_batch(
  p_limit integer default 10,
  p_lease_seconds integer default 180
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_claim_token uuid;
begin
  if p_limit not between 1 and 25 or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid payment notification batch request';
  end if;
  for v_row in
    select d.payment_request_id
    from public.payment_notification_deliveries d
    where d.status <> 'sent'
      and d.next_attempt_at <= clock_timestamp()
      and (d.status <> 'processing' or d.lease_until <= clock_timestamp())
    order by d.next_attempt_at, d.created_at
    limit p_limit
    for update skip locked
  loop
    v_claim_token := gen_random_uuid();
    update public.payment_notification_deliveries d
    set status = 'processing',
        attempt_count = d.attempt_count + 1,
        claim_token = v_claim_token,
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    where d.payment_request_id = v_row.payment_request_id;
    return next public.phase4_payment_notification_context(
      v_row.payment_request_id,
      v_claim_token
    ) || jsonb_build_object('claimToken', v_claim_token);
  end loop;
end;
$$;

create or replace function public.phase4_complete_payment_notification(
  p_payment_request_id uuid,
  p_claim_token uuid,
  p_provider_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.payment_notification_deliveries d
  set status = 'sent',
      provider_id = left(nullif(btrim(p_provider_id), ''), 180),
      last_error_code = null,
      sent_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      claim_token = null,
      lease_until = null
  where d.payment_request_id = p_payment_request_id
    and d.status = 'processing'
    and d.claim_token = p_claim_token;
  if not found then raise exception 'Payment notification claim was lost'; end if;
end;
$$;

create or replace function public.phase4_fail_payment_notification(
  p_payment_request_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.payment_notification_deliveries d
  set status = 'failed',
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'delivery_failed'), 120),
      next_attempt_at = clock_timestamp() + case
        when d.attempt_count <= 1 then interval '2 minutes'
        when d.attempt_count = 2 then interval '5 minutes'
        when d.attempt_count = 3 then interval '15 minutes'
        else interval '1 hour' end,
      updated_at = clock_timestamp(),
      claim_token = null,
      lease_until = null
  where d.payment_request_id = p_payment_request_id
    and d.status = 'processing'
    and d.claim_token = p_claim_token;
  if not found then raise exception 'Payment notification claim was lost'; end if;
end;
$$;

revoke all on function public.phase4_enqueue_payment_notification() from public, anon, authenticated;
revoke all on function public.phase4_choose_launch_trial(uuid, text) from public, anon, authenticated;
revoke all on function public.phase4_payment_notification_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phase4_claim_payment_notification(uuid, integer) from public, anon, authenticated;
revoke all on function public.phase4_claim_payment_notification_batch(integer, integer) from public, anon, authenticated;
revoke all on function public.phase4_complete_payment_notification(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.phase4_fail_payment_notification(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.phase4_choose_launch_trial(uuid, text) to service_role;
grant execute on function public.phase4_payment_notification_context(uuid, uuid) to service_role;
grant execute on function public.phase4_claim_payment_notification(uuid, integer) to service_role;
grant execute on function public.phase4_claim_payment_notification_batch(integer, integer) to service_role;
grant execute on function public.phase4_complete_payment_notification(uuid, uuid, text) to service_role;
grant execute on function public.phase4_fail_payment_notification(uuid, uuid, text) to service_role;

comment on column public.platform_access_settings.mandatory_access_choice_enabled
  is 'When true, ordinary commercial accounts must choose Early Access or the fixed launch trial; daily_free is disabled.';
comment on table public.payment_verifier_recipients
  is 'Private service-role-only operational recipients for Early Access payment verification notices.';
comment on table public.payment_notification_deliveries
  is 'Retryable service-role-only delivery ledger for payment-proof notification emails.';

commit;
