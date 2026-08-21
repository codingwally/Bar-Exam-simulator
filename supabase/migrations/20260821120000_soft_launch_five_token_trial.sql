-- Due Diligence soft-launch access model.
--
-- Installs the one-time five-token introductory allowance, the single Early
-- Access offer, durable payment-verifier delivery, and mandatory token
-- disclosure acknowledgement. Existing examinations, grades, questions,
-- payments, subscriptions, and beta/admin entitlements are preserved.

begin;

alter table public.platform_access_settings
  add column if not exists soft_launch_enabled boolean not null default false,
  add column if not exists introductory_token_limit integer not null default 5,
  add column if not exists introductory_token_disclosure_version text not null
    default 'trial-tokens-v1-2026-08-21',
  add column if not exists reauthentication_required_after timestamptz,
  add column if not exists early_access_regular_price_centavos integer not null default 19900,
  add column if not exists early_access_manual_renewal_at timestamptz not null
    default '2026-10-01 00:00:00+08'::timestamptz;

alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_introductory_token_limit_check,
  drop constraint if exists platform_access_settings_introductory_disclosure_check,
  drop constraint if exists platform_access_settings_regular_price_check;

alter table public.platform_access_settings
  add constraint platform_access_settings_introductory_token_limit_check
    check (introductory_token_limit = 5),
  add constraint platform_access_settings_introductory_disclosure_check
    check (char_length(btrim(introductory_token_disclosure_version)) between 8 and 120),
  add constraint platform_access_settings_regular_price_check
    check (early_access_regular_price_centavos = 19900);

create table if not exists public.introductory_token_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  token_limit integer not null default 5 check (token_limit = 5),
  disclosure_version text not null,
  granted_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (acknowledged_at is null or acknowledged_at >= granted_at)
);

create table if not exists public.introductory_token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid not null references public.introductory_token_grants(id) on delete cascade,
  reservation_id uuid references public.grade_reservations(id) on delete restrict,
  request_key text,
  event_type text not null check (event_type in ('grant','consumed')),
  token_delta integer not null check (token_delta in (-1, 5)),
  balance_after integer not null check (balance_after between 0 and 5),
  examination_track text,
  resource_id text,
  reason text not null,
  occurred_at timestamptz not null default now(),
  check (
    (event_type = 'grant' and token_delta = 5 and reservation_id is null and balance_after = 5)
    or (event_type = 'consumed' and token_delta = -1 and reservation_id is not null)
  )
);

create unique index if not exists introductory_token_ledger_one_grant_uidx
  on public.introductory_token_ledger (grant_id)
  where event_type = 'grant';
create unique index if not exists introductory_token_ledger_one_consumption_uidx
  on public.introductory_token_ledger (reservation_id)
  where event_type = 'consumed';
create index if not exists introductory_token_ledger_user_time_idx
  on public.introductory_token_ledger (user_id, occurred_at desc);

alter table public.introductory_token_grants enable row level security;
alter table public.introductory_token_grants force row level security;
alter table public.introductory_token_ledger enable row level security;
alter table public.introductory_token_ledger force row level security;
revoke all on table public.introductory_token_grants from public, anon, authenticated;
revoke all on table public.introductory_token_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.introductory_token_grants to service_role;
grant select, insert on table public.introductory_token_ledger to service_role;

insert into public.introductory_token_grants (
  user_id, token_limit, disclosure_version, granted_at
)
select
  u.id,
  5,
  s.introductory_token_disclosure_version,
  clock_timestamp()
from auth.users u
cross join public.platform_access_settings s
where s.singleton = true
  and coalesce(u.is_anonymous, false) = false
on conflict (user_id) do nothing;

insert into public.introductory_token_ledger (
  user_id, grant_id, event_type, token_delta, balance_after, reason, occurred_at
)
select
  g.user_id, g.id, 'grant', 5, 5,
  'One-time introductory token grant', g.granted_at
from public.introductory_token_grants g
on conflict do nothing;

alter table public.grade_reservations
  drop constraint if exists grade_reservations_access_basis_check;
alter table public.grade_reservations
  add constraint grade_reservations_access_basis_check check (access_basis in (
    'super_admin', 'founder_admin', 'free_beta', 'paid_subscription',
    'trial', 'lifetime_free', 'global_beta_all_access', 'founding_beta',
    'early_access', 'provisional_payment', 'daily_free', 'introductory_tokens'
  ));

create or replace function public.phase4_record_introductory_token_consumption()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.introductory_token_grants%rowtype;
  v_used integer;
begin
  if new.status <> 'completed'
     or old.status = 'completed'
     or not new.consumes_quota
     or new.access_basis <> 'introductory_tokens' then
    return new;
  end if;

  select * into strict v_grant
  from public.introductory_token_grants
  where user_id = new.user_id
  for update;

  select count(*) into v_used
  from public.introductory_token_ledger
  where grant_id = v_grant.id and event_type = 'consumed';

  if v_used >= v_grant.token_limit then
    raise exception 'INTRODUCTORY_TOKENS_EXHAUSTED';
  end if;

  insert into public.introductory_token_ledger (
    user_id, grant_id, reservation_id, request_key, event_type,
    token_delta, balance_after, examination_track, resource_id, reason,
    occurred_at
  ) values (
    new.user_id, v_grant.id, new.id, new.request_key, 'consumed',
    -1, v_grant.token_limit - v_used - 1, new.examination_track,
    new.question_bank_id, 'Successful eligible evaluation',
    coalesce(new.completed_at, clock_timestamp())
  )
  on conflict (reservation_id) where event_type = 'consumed' do nothing;

  return new;
end;
$$;

drop trigger if exists phase4_record_introductory_token_consumption_trigger
  on public.grade_reservations;
create trigger phase4_record_introductory_token_consumption_trigger
after update of status on public.grade_reservations
for each row execute function public.phase4_record_introductory_token_consumption();

revoke all on function public.phase4_record_introductory_token_consumption()
  from public, anon, authenticated;

-- Preserve the prior resolver for an application-level rollback.
do $migration$
begin
  if to_regprocedure('public.phase4_access_snapshot_pre_soft_launch(uuid,boolean,text)') is null then
    if to_regprocedure('public.phase4_access_snapshot(uuid,boolean,text)') is null then
      raise exception 'The existing commercial access resolver is missing';
    end if;
    execute 'alter function public.phase4_access_snapshot(uuid, boolean, text) rename to phase4_access_snapshot_pre_soft_launch';
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
  v_role text := 'student';
  v_terms_ok boolean := false;
  v_profile_complete boolean := false;
  v_beta public.free_beta_access%rowtype;
  v_subscription public.subscriptions%rowtype;
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
begin
  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'Authenticated user required'; end if;

  select * into strict v_settings
  from public.platform_access_settings where singleton = true;

  if not v_settings.soft_launch_enabled then
    return public.phase4_access_snapshot_pre_soft_launch(
      p_user_id, p_activate_trial, p_request_key
    );
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

  select * into v_subscription from public.subscriptions
  where user_id = p_user_id and status = 'active'
    and starts_at <= v_now and (expires_at is null or expires_at > v_now)
  order by expires_at desc nulls first, updated_at desc limit 1;

  select * into v_payment from public.payment_requests
  where user_id = p_user_id
    and plan_code = 'early_access_beta'
    and status in ('pending','needs_information')
    and provisional_access_started_at is not null
    and provisional_access_expires_at > v_now
    and provisional_access_revoked_at is null
  order by submitted_at desc limit 1;

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
    elsif not v_profile_complete
       or v_grant.acknowledged_at is null
       or v_grant.disclosure_version <> v_settings.introductory_token_disclosure_version then
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
    'profileCompleted', v_profile_complete
      and v_grant.acknowledged_at is not null
      and v_grant.disclosure_version = v_settings.introductory_token_disclosure_version,
    'tokenAcknowledgementRequired', v_grant.acknowledged_at is null
      or v_grant.disclosure_version <> v_settings.introductory_token_disclosure_version,
    'choiceRequired', false,
    'planSelectionRequired', false,
    'paymentRequired', v_basis = 'trial_tokens_exhausted',
    'role', v_role,
    'accessMode', v_access_mode,
    'accountLabel', v_account_label,
    'unlimited', v_unlimited,
    'tokenLimit', v_grant.token_limit,
    'tokensUsed', v_used,
    'tokensReserved', v_reserved,
    'tokensRemaining', v_remaining,
    'tokenGrantAt', v_grant.granted_at,
    'tokenAcknowledgedAt', v_grant.acknowledged_at,
    'tokenDisclosureVersion', v_settings.introductory_token_disclosure_version,
    -- Compatibility aliases for the database-first/Worker-first rollout.
    'dailyLimit', v_grant.token_limit,
    'completedToday', v_used,
    'reservedToday', v_reserved,
    'remainingToday', v_remaining,
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
      'limit', v_grant.token_limit,
      'used', v_used,
      'remaining', v_remaining
    ),
    'freeBeta', jsonb_build_object(
      'enabled', v_beta.user_id is not null,
      'expiresAt', v_beta.expires_at,
      'active', v_beta.user_id is not null,
      'program', v_beta.access_program
    ),
    'subscription', case when v_subscription.id is null then null else
      jsonb_build_object(
        'id', v_subscription.id,
        'planCode', v_subscription.plan_code,
        'status', v_subscription.status,
        'source', v_subscription.source,
        'startsAt', v_subscription.starts_at,
        'expiresAt', v_subscription.expires_at
      ) end
  );
end;
$$;

revoke all on function public.phase4_access_snapshot(uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot(uuid,boolean,text)
  to service_role;

create or replace function public.complete_commercial_profile_onboarding_v2(
  p_display_name text,
  p_law_school_id text,
  p_law_school_other text,
  p_category text,
  p_professor_license_number text,
  p_terms_version text,
  p_privacy_version text,
  p_trial_disclosure_version text,
  p_trial_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.platform_access_settings%rowtype;
  v_school_id text := lower(btrim(coalesce(p_law_school_id, '')));
  v_school_name text := btrim(coalesce(p_law_school_other, p_law_school_id, ''));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_grant public.introductory_token_grants%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  if btrim(coalesce(p_terms_version, '')) <> v_settings.current_terms_version
     or btrim(coalesce(p_privacy_version, '')) <> v_settings.current_privacy_version
     or not exists (
       select 1 from public.terms_acceptances
       where user_id = v_user_id
         and terms_version = v_settings.current_terms_version
         and privacy_version = v_settings.current_privacy_version
     ) then raise exception 'Current Terms and Privacy acceptance is required'; end if;
  if p_trial_acknowledged is not true
     or btrim(coalesce(p_trial_disclosure_version, ''))
       <> v_settings.introductory_token_disclosure_version then
    raise exception 'Five-token disclosure acknowledgement is required';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 120 then
    raise exception 'Name is required'; end if;
  if v_school_id = '' or char_length(v_school_name) not between 2 and 180 then
    raise exception 'Law school is required'; end if;
  if v_category not in (
    'first_year','second_year','third_year','fourth_year','fifth_year','review','professor'
  ) then raise exception 'Select a valid law-school category'; end if;
  if v_category = 'professor'
     and char_length(btrim(coalesce(p_professor_license_number, ''))) not between 3 and 80 then
    raise exception 'Professor license declaration is required'; end if;

  update public.profiles
  set display_name = btrim(p_display_name),
      law_school_id = v_school_id,
      law_school_other = case when v_school_id = 'other' then v_school_name else null end,
      commercial_category = v_category,
      commercial_onboarding_completed_at = clock_timestamp(),
      school = case when v_school_id = 'other' then v_school_name else btrim(p_law_school_id) end,
      enrollment_status = 'enrolled',
      year_level = v_category,
      profile_completed_at = coalesce(profile_completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where id = v_user_id;
  if not found then raise exception 'Profile does not exist for authenticated user'; end if;

  insert into public.introductory_token_grants (
    user_id, token_limit, disclosure_version, granted_at, acknowledged_at
  ) values (
    v_user_id, v_settings.introductory_token_limit,
    v_settings.introductory_token_disclosure_version,
    clock_timestamp(), clock_timestamp()
  )
  on conflict (user_id) do update
  set disclosure_version = excluded.disclosure_version,
      acknowledged_at = case
        when public.introductory_token_grants.disclosure_version
          is distinct from excluded.disclosure_version then clock_timestamp()
        else coalesce(public.introductory_token_grants.acknowledged_at, clock_timestamp())
      end,
      updated_at = clock_timestamp()
  returning * into v_grant;

  insert into public.introductory_token_ledger (
    user_id, grant_id, event_type, token_delta, balance_after, reason, occurred_at
  ) values (
    v_user_id, v_grant.id, 'grant', 5, 5,
    'One-time introductory token grant', v_grant.granted_at
  ) on conflict do nothing;

  if v_category = 'professor' then
    insert into public.professor_license_declarations (
      user_id, license_number, declaration_version, declared_at, updated_at
    ) values (
      v_user_id, btrim(p_professor_license_number),
      'professor-declaration-v1-2026-08-18', clock_timestamp(), clock_timestamp()
    ) on conflict (user_id) do update
    set license_number = excluded.license_number,
        declaration_version = excluded.declaration_version,
        declared_at = excluded.declared_at,
        updated_at = excluded.updated_at;
  else
    delete from public.professor_license_declarations where user_id = v_user_id;
  end if;

  return public.phase4_access_snapshot(v_user_id, false, null);
end;
$$;

revoke all on function public.complete_commercial_profile_onboarding_v2(
  text,text,text,text,text,text,text,text,boolean
) from public, anon;
grant execute on function public.complete_commercial_profile_onboarding_v2(
  text,text,text,text,text,text,text,text,boolean
) to authenticated, service_role;

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
  v_grant public.introductory_token_grants%rowtype;
  v_reservation_id uuid;
  v_used integer := 0;
  v_reserved integer := 0;
  v_basis text;
  v_consumes boolean := false;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'Invalid grading request key'; end if;
  if char_length(btrim(coalesce(p_question_bank_id, ''))) not between 3 and 100 then raise exception 'Invalid question identifier'; end if;
  if p_examination_track not in (
    'bar_practice','subject_matter','mock_bar','bar_feels','quiz','doctrine_review','examination_room'
  ) then raise exception 'Invalid examination track'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_existing from public.grade_reservations where request_key = p_request_key for update;
  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.question_bank_id <> btrim(p_question_bank_id)
       or v_existing.examination_track <> p_examination_track then
      raise exception 'Grading request key conflict';
    end if;
    if v_existing.status in ('reserved','completed') then
      return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
        'allowed', true,
        'reason', case when v_existing.status = 'reserved' then 'duplicate_active' else 'duplicate_completed' end,
        'reservationId', v_existing.id, 'status', v_existing.status,
        'accessBasis', v_existing.access_basis, 'replayed', true
      );
    end if;
    if v_existing.status in ('released','expired')
       and coalesce(v_existing.release_reason, '') not in (
         'provider_capacity','provider_rate_limit','provider_timeout','provider_unavailable',
         'grading_failed','network_failure'
       ) then
      return jsonb_build_object('allowed', false, 'reason', 'duplicate_closed',
        'reservationId', v_existing.id, 'replayed', true);
    end if;
  end if;

  update public.grade_reservations
  set status = 'expired', released_at = v_now, release_reason = 'reservation_timeout'
  where user_id = p_user_id and status = 'reserved' and reservation_expires_at <= v_now;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('reservationId', null, 'replayed', false);
  end if;
  v_basis := v_access->>'basis';
  v_consumes := v_settings.soft_launch_enabled
    and not coalesce((v_access->>'unlimited')::boolean, false);

  if v_consumes then
    select * into strict v_grant from public.introductory_token_grants where user_id = p_user_id;
    select count(*) into v_used from public.introductory_token_ledger
    where grant_id = v_grant.id and event_type = 'consumed';
    select count(*) into v_reserved from public.grade_reservations
    where user_id = p_user_id and consumes_quota and status = 'reserved'
      and reservation_expires_at > v_now and reserved_at >= v_grant.granted_at;
    if v_used + v_reserved >= v_grant.token_limit then
      return public.phase4_access_snapshot(p_user_id, false, null)
        || jsonb_build_object('allowed', false, 'reason', 'trial_tokens_exhausted', 'reservationId', null);
    end if;
    v_basis := 'introductory_tokens';
  end if;

  if v_existing.id is not null then
    update public.grade_reservations
    set status = 'reserved', access_basis = v_basis, reserved_at = v_now,
        reservation_expires_at = v_now + interval '20 minutes',
        completed_at = null, released_at = null, release_reason = null,
        usage_date_ph = public.phase4_ph_date(v_now),
        examination_track = p_examination_track, consumes_quota = v_consumes
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
  p_user_id uuid, p_request_key text, p_question_bank_id text
)
returns jsonb language sql security definer set search_path = public, pg_temp
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
  v_grant public.introductory_token_grants%rowtype;
  v_basis text;
  v_consumes boolean;
  v_existing integer := 0;
  v_existing_reserved integer := 0;
  v_existing_completed integer := 0;
  v_existing_closed integer := 0;
  v_used integer := 0;
  v_reserved integer := 0;
  v_i integer;
  v_item_key text;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or char_length(btrim(coalesce(p_external_resource_id, ''))) not between 3 and 100
     or p_required_count not between 1 and 100 then raise exception 'Invalid submission reservation request'; end if;
  if p_examination_track not in ('subject_matter','mock_bar','bar_feels','examination_room') then
    raise exception 'Invalid batch examination track'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  update public.grade_reservations
  set status = 'expired', released_at = v_now, release_reason = 'reservation_timeout'
  where user_id = p_user_id and status = 'reserved' and reservation_expires_at <= v_now;

  select
    count(*),
    count(*) filter (where status = 'reserved'),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status in ('released','expired'))
  into v_existing, v_existing_reserved, v_existing_completed, v_existing_closed
  from public.grade_reservations
  where user_id = p_user_id and session_request_key = p_request_key;

  if v_existing > 0 and (
    v_existing <> p_required_count or exists (
      select 1 from public.grade_reservations
      where user_id = p_user_id and session_request_key = p_request_key
        and (examination_track <> p_examination_track
          or external_resource_id <> btrim(p_external_resource_id))
    )
  ) then raise exception 'Submission reservation request conflict'; end if;

  if v_existing > 0 and v_existing_completed > 0 then
    return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
      'allowed', true, 'requiredCount', p_required_count,
      'heldCount', v_existing_reserved, 'completedCount', v_existing_completed,
      'releasedCount', v_existing_closed, 'sessionRequestKey', p_request_key,
      'terminal', v_existing_reserved = 0, 'replayed', true
    );
  end if;

  if v_existing > 0 and v_existing_reserved = 0 and exists (
    select 1 from public.grade_reservations
    where user_id = p_user_id and session_request_key = p_request_key
      and coalesce(release_reason, '') not in (
        'exam_start_failed','session_failed','network_failure','provider_capacity',
        'provider_rate_limit','provider_timeout','provider_unavailable','reservation_timeout'
      )
  ) then
    return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
      'allowed', false, 'reason', 'duplicate_closed', 'requiredCount', p_required_count,
      'heldCount', 0, 'sessionRequestKey', p_request_key, 'replayed', true
    );
  end if;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('heldCount', 0, 'replayed', v_existing > 0);
  end if;
  v_basis := v_access->>'basis';
  v_consumes := v_settings.soft_launch_enabled
    and not coalesce((v_access->>'unlimited')::boolean, false);

  if v_consumes then
    select * into strict v_grant from public.introductory_token_grants where user_id = p_user_id;
    select count(*) into v_used from public.introductory_token_ledger
    where grant_id = v_grant.id and event_type = 'consumed';
    select count(*) into v_reserved from public.grade_reservations
    where user_id = p_user_id and consumes_quota and status = 'reserved'
      and reservation_expires_at > v_now and reserved_at >= v_grant.granted_at
      and coalesce(session_request_key, '') <> p_request_key;
    if v_used + v_reserved + p_required_count > v_grant.token_limit then
      return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
        'allowed', false, 'reason', 'insufficient_introductory_tokens',
        'requiredCount', p_required_count, 'heldCount', 0, 'replayed', v_existing > 0
      );
    end if;
    v_basis := 'introductory_tokens';
  end if;

  if v_existing > 0 then
    update public.grade_reservations
    set status = 'reserved', access_basis = v_basis, reserved_at = v_now,
        reservation_expires_at = v_now + interval '6 hours',
        completed_at = null, released_at = null, release_reason = null,
        consumes_quota = v_consumes, usage_date_ph = public.phase4_ph_date(v_now)
    where user_id = p_user_id and session_request_key = p_request_key;
  else
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
  end if;

  return public.phase4_access_snapshot(p_user_id, false, null) || jsonb_build_object(
    'allowed', true, 'requiredCount', p_required_count,
    'heldCount', p_required_count, 'sessionRequestKey', p_request_key,
    'replayed', v_existing > 0
  );
end;
$$;

revoke all on function public.phase4_reserve_grade_v2(uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.phase4_reserve_grade_v2(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.phase4_reserve_submission_batch(uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.phase4_reserve_grade_v2(uuid,text,text,text)
  to service_role;
grant execute on function public.phase4_reserve_grade_v2(uuid,text,text)
  to service_role;
grant execute on function public.phase4_reserve_submission_batch(uuid,text,text,text,integer)
  to service_role;

-- Payment notification delivery is durable and tied to the canonical proof.
alter table public.payment_requests
  add column if not exists verification_email_status text,
  add column if not exists verification_email_attempts integer,
  add column if not exists verification_email_provider_id text,
  add column if not exists verification_email_error text,
  add column if not exists verification_email_last_attempt_at timestamptz,
  add column if not exists verification_email_sent_at timestamptz;

-- Historical payment requests predate this queue. They must never be emailed
-- merely because the queue was installed.
update public.payment_requests
set verification_email_status = coalesce(verification_email_status, 'suppressed'),
    verification_email_attempts = coalesce(verification_email_attempts, 0);

alter table public.payment_requests
  alter column verification_email_status set default 'pending',
  alter column verification_email_status set not null,
  alter column verification_email_attempts set default 0,
  alter column verification_email_attempts set not null;

alter table public.payment_requests
  drop constraint if exists payment_requests_verification_email_status_check;
alter table public.payment_requests
  add constraint payment_requests_verification_email_status_check
    check (verification_email_status in ('pending','sending','sent','failed','suppressed'));

create index if not exists payment_requests_verification_email_queue_idx
  on public.payment_requests (verification_email_status, verification_email_last_attempt_at, submitted_at)
  where verification_email_status in ('pending','failed','sending');

create or replace function public.phase4_payment_notification_context(
  p_payment_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'amountPhp', p.trusted_amount_php,
    'paymentMethod', p.payment_method,
    'paymentDate', p.payment_date,
    'transactionReference', p.transaction_reference,
    'note', p.student_note,
    'proofObjectPath', p.proof_object_path,
    'proofOriginalName', p.proof_original_name,
    'proofMimeType', p.proof_mime_type,
    'proofSizeBytes', p.proof_size_bytes,
    'proofSha256', p.proof_sha256,
    'provisionalAccessExpiresAt', p.provisional_access_expires_at,
    'notificationStatus', p.verification_email_status,
    'notificationAttempts', p.verification_email_attempts,
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'displayName', coalesce(pr.display_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    )
  )
  from public.payment_requests p
  join auth.users u on u.id = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  where p.id = p_payment_request_id;
$$;

create or replace function public.phase4_claim_payment_notification(
  p_payment_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.payment_requests
  where (p_payment_request_id is null or id = p_payment_request_id)
    and (
      verification_email_status in ('pending','failed')
      or (
        verification_email_status = 'sending'
        and verification_email_last_attempt_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and verification_email_attempts < 8
    and (
      verification_email_status = 'sending'
      or verification_email_last_attempt_at is null
      or verification_email_last_attempt_at < clock_timestamp()
        - make_interval(mins => least(60, greatest(1, verification_email_attempts * 2)))
    )
  order by submitted_at
  for update skip locked
  limit 1;
  if v_id is null then return null; end if;

  update public.payment_requests
  set verification_email_status = 'sending',
      verification_email_attempts = verification_email_attempts + 1,
      verification_email_last_attempt_at = clock_timestamp(),
      verification_email_error = null
  where id = v_id;

  return public.phase4_payment_notification_context(v_id);
end;
$$;

create or replace function public.phase4_complete_payment_notification(
  p_payment_request_id uuid,
  p_status text,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent','failed','suppressed') then
    raise exception 'Invalid payment notification status';
  end if;
  update public.payment_requests
  set verification_email_status = p_status,
      verification_email_provider_id = case when p_status = 'sent'
        then left(nullif(btrim(coalesce(p_provider_id, '')), ''), 180) else null end,
      verification_email_error = case when p_status = 'failed'
        then left(coalesce(nullif(btrim(p_error), ''), 'delivery_failed'), 500) else null end,
      verification_email_sent_at = case when p_status = 'sent'
        then clock_timestamp() else verification_email_sent_at end
  where id = p_payment_request_id;
end;
$$;

revoke all on function public.phase4_payment_notification_context(uuid) from public, anon, authenticated;
revoke all on function public.phase4_claim_payment_notification(uuid) from public, anon, authenticated;
revoke all on function public.phase4_complete_payment_notification(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.phase4_payment_notification_context(uuid) to service_role;
grant execute on function public.phase4_claim_payment_notification(uuid) to service_role;
grant execute on function public.phase4_complete_payment_notification(uuid,text,text,text) to service_role;

-- Founder payment operations must expose the durable delivery state and the
-- proof metadata needed to review a request without preloading private files.
create or replace function public.phase4_admin_operational_data(
  p_actor_user_id uuid,
  p_section text,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_limit integer := greatest(1, least(coalesce(p_limit,50),100));
  v_offset integer := greatest(0,coalesce(p_offset,0));
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if p_section = 'payments' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (select count(*) from public.payment_requests)
    ) into v_result
    from (
      select p.id, p.user_id, pr.display_name, u.email,
        pr.school, pr.year_level, p.plan_code,
        p.trusted_amount_php, p.payment_method, p.payment_date,
        p.transaction_reference, p.status, p.submitted_at, p.reviewed_at,
        p.reviewed_by, p.review_reason, p.subscription_id,
        p.provisional_access_expires_at,
        p.proof_original_name, p.proof_mime_type, p.proof_size_bytes,
        p.verification_email_status, p.verification_email_attempts,
        p.verification_email_last_attempt_at, p.verification_email_sent_at,
        p.verification_email_error
      from public.payment_requests p
      join auth.users u on u.id = p.user_id
      left join public.profiles pr on pr.id = p.user_id
      where v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or lower(coalesce(u.email,'')) like '%'||v_search||'%'
         or lower(p.transaction_reference) like '%'||v_search||'%'
         or p.id::text = v_search
      order by p.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'refunds' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (select count(*) from public.refund_requests)
    ) into v_result
    from (
      select r.id, r.user_id, pr.display_name, r.payment_request_id,
        r.status, r.paid_amount_php, r.suggested_refund_php,
        r.approved_refund_php, r.calculation_note, r.submitted_at,
        r.review_reason
      from public.refund_requests r
      left join public.profiles pr on pr.id = r.user_id
      where v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or r.id::text = v_search
      order by r.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'partnerships' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (select count(*) from public.partnership_inquiries)
    ) into v_result
    from (
      select i.id, i.inquiry_type, i.contact_name, i.contact_email,
        i.organization, i.message, i.consent, i.contact_verified,
        i.status, i.assignee_user_id, i.created_at, i.updated_at
      from public.partnership_inquiries i
      where v_search = ''
         or lower(i.contact_name) like '%'||v_search||'%'
         or lower(i.contact_email) like '%'||v_search||'%'
         or lower(coalesce(i.organization,'')) like '%'||v_search||'%'
      order by i.created_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'access' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (select count(*) from public.profiles)
    ) into v_result
    from (
      select p.id as user_id, p.display_name, p.created_at,
        coalesce(r.role,'student') as role,
        g.granted_at as introductory_tokens_granted_at,
        g.acknowledged_at as introductory_tokens_acknowledged_at,
        g.token_limit as introductory_token_limit,
        coalesce(t.used_tokens,0) as introductory_tokens_used,
        greatest(0,coalesce(g.token_limit,0)-coalesce(t.used_tokens,0))
          as introductory_tokens_remaining,
        b.enabled as free_beta_enabled, b.expires_at as free_beta_expires_at,
        s.id as subscription_id, s.plan_code, s.status as subscription_status,
        s.starts_at, s.expires_at
      from public.profiles p
      left join public.user_roles r on r.user_id = p.id
      left join public.introductory_token_grants g on g.user_id = p.id
      left join lateral (
        select count(*)::integer as used_tokens
        from public.introductory_token_ledger l
        where l.grant_id = g.id and l.event_type = 'consumed'
      ) t on true
      left join public.free_beta_access b on b.user_id = p.id
      left join lateral (
        select * from public.subscriptions x where x.user_id=p.id
        order by x.updated_at desc limit 1
      ) s on true
      where v_search = ''
         or lower(coalesce(p.display_name,'')) like '%'||v_search||'%'
         or p.id::text = v_search
      order by p.created_at desc limit v_limit offset v_offset
    ) q;
  else
    raise exception 'Unsupported Phase 4 administrator section';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type, target_resource_id,
    reason, details
  ) values (
    p_actor_user_id, 'sensitive_data_viewed', 'phase4_admin_section', p_section,
    'Authorized Founder administration data view.',
    jsonb_build_object(
      'section',p_section,
      'resultCount',jsonb_array_length(coalesce(v_result->'items','[]'::jsonb))
    )
  );
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'total',0));
end;
$$;

revoke all on function public.phase4_admin_operational_data(
  uuid,text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.phase4_admin_operational_data(
  uuid,text,text,integer,integer
) to service_role;

create or replace function public.phase4_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.platform_access_settings%rowtype;
  v_early public.plan_catalog%rowtype;
  v_open boolean;
begin
  select * into strict v_settings from public.platform_access_settings where singleton = true;
  select * into v_early from public.plan_catalog where plan_code = 'early_access_beta';
  v_open := v_settings.public_pricing_enabled
    and clock_timestamp() < v_settings.early_access_sales_close_at
    and coalesce(v_early.status = 'active', false)
    and coalesce(v_early.checkout_enabled, false);
  return jsonb_build_array(jsonb_build_object(
    'planCode', 'early_access_beta',
    'name', 'Early Access',
    'pricePhp', 149,
    'priceCentavos', 14900,
    'regularPricePhp', 199,
    'regularPriceCentavos', v_settings.early_access_regular_price_centavos,
    'billing', 'manual_renewal',
    'checkoutEnabled', v_open,
    'status', case when v_open then 'active' else 'closed' end,
    'displayOrder', 1,
    'promotional', true,
    'salesCloseAt', null,
    'entitlementEndsAt', v_settings.early_access_entitlement_ends_at,
    'renewalAt', v_settings.early_access_manual_renewal_at,
    'renewalPriceCentavos', v_settings.early_access_regular_price_centavos,
    'manualRenewal', true,
    'automaticRenewal', false,
    'description', 'Unlimited practice access after manual payment verification.',
    'features', coalesce(v_early.features, jsonb_build_array(
      'Unlimited eligible practice submissions',
      'All Due Diligence study tracks',
      'Saved progress and source-based coaching',
      '24-hour provisional access while proof is reviewed'
    )),
    'note', 'The October 1 renewal is manual. Due Diligence will not automatically charge you.'
  ));
end;
$$;

-- Activate only the new access resolver. Existing beta/admin and paid records
-- retain precedence, while ordinary users receive the five-token allowance.
update public.platform_access_settings
set soft_launch_enabled = true,
    commercial_launch_enabled = true,
    current_terms_version = 'terms-soft-launch-v1-2026-08-21',
    current_privacy_version = 'privacy-soft-launch-v1-2026-08-21',
    mandatory_access_choice_enabled = false,
    global_beta_all_access_enabled = false,
    free_daily_grade_limit = 5,
    public_pricing_enabled = true,
    early_access_sales_close_at = '2026-10-01 00:00:00+08'::timestamptz,
    reauthentication_required_after = coalesce(
      reauthentication_required_after,
      clock_timestamp()
    ),
    commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = clock_timestamp(),
    updated_at = clock_timestamp()
where singleton = true;

update public.plan_catalog
set display_name = 'Early Access',
    price_php = 149.00,
    status = 'active',
    description = 'Promotional Early Access with manual payment verification.',
    features = '[
      "Unlimited eligible practice submissions",
      "All Due Diligence study tracks",
      "Saved progress and source-based coaching",
      "24-hour provisional access while proof is reviewed"
    ]'::jsonb,
    display_order = 1,
    promotional = true,
    checkout_enabled = true,
    note = 'Promotional ₱149 price; regular manual renewal price ₱199 on October 1, 2026. No automatic charge.',
    updated_at = clock_timestamp()
where plan_code = 'early_access_beta';

commit;
