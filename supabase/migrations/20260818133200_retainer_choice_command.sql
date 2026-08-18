-- Add the authenticated Retainer choice command and paid-choice synchronization.
-- Split from the reviewed explicit Retainer choice release for rolling safety.

begin;

create or replace function public.phase4_choose_access(
  p_choice text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_settings public.platform_access_settings%rowtype;
  v_existing public.commercial_access_choices%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_payment_started boolean := false;
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users
    where id = v_user_id
      and coalesce(is_anonymous, false) = false
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Sign in with Google before choosing access.';
  end if;

  if v_choice not in ('launch_trial', 'early_access') then
    raise exception using
      errcode = 'P0001',
      message = 'Choose either Free Trial or Early Access.';
  end if;

  if v_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception using
      errcode = 'P0001',
      message = 'A valid access-choice request key is required.';
  end if;

  select * into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  if not v_settings.commercial_launch_enabled
     or not v_settings.mandatory_access_choice_enabled then
    raise exception using
      errcode = 'P0001',
      message = 'The Retainer choice is not currently available.';
  end if;

  v_before := public.phase4_access_snapshot(v_user_id, false, null);

  if coalesce((v_before ->> 'termsRequired')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message =
        'Review and accept the current Terms and Privacy Notice before choosing access.';
  end if;

  if not coalesce((v_before ->> 'profileCompleted')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'Complete your profile before choosing access.';
  end if;

  if (v_before ->> 'basis') in (
    'super_admin', 'founder_admin', 'founding_beta',
    'early_access', 'paid_subscription', 'provisional_payment'
  ) then
    return jsonb_build_object(
      'ok', true,
      'exempt', true,
      'choice', v_before ->> 'selectedChoice',
      'access', v_before
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 912));

  select * into v_existing
  from public.commercial_access_choices
  where user_id = v_user_id
  for update;

  if v_existing.user_id is not null
     and v_existing.choice = v_choice then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'choice', v_existing.choice,
      'access', public.phase4_access_snapshot(v_user_id, false, null)
    );
  end if;

  if v_choice = 'launch_trial' then
    if v_now > v_settings.launch_trial_ends_at then
      raise exception using
        errcode = 'P0001',
        message = 'The launch Free Trial ended on September 1, 2026.';
    end if;

    if v_existing.trial_started_at is not null then
      raise exception using
        errcode = 'P0001',
        message =
          'The launch Free Trial has already been selected for this account.';
    end if;

    select exists (
      select 1
      from public.payment_requests
      where user_id = v_user_id
        and plan_code = 'early_access_beta'
        and status in ('pending', 'needs_information', 'approved')
    ) into v_payment_started;

    if v_payment_started then
      raise exception using
        errcode = 'P0001',
        message =
          'Early Access payment verification has already started for this account.';
    end if;

    insert into public.commercial_access_choices (
      user_id,
      choice,
      selected_at,
      trial_started_at,
      trial_expires_at,
      request_key,
      choice_source
    ) values (
      v_user_id,
      'launch_trial',
      v_now,
      v_now,
      v_settings.launch_trial_ends_at,
      v_request_key,
      'user'
    )
    on conflict (user_id) do update
    set choice = 'launch_trial',
        selected_at = excluded.selected_at,
        trial_started_at = excluded.trial_started_at,
        trial_expires_at = excluded.trial_expires_at,
        request_key = excluded.request_key,
        choice_source = 'user',
        version = public.commercial_access_choices.version + 1,
        updated_at = now();
  else
    insert into public.commercial_access_choices (
      user_id,
      choice,
      selected_at,
      request_key,
      choice_source
    ) values (
      v_user_id,
      'early_access',
      v_now,
      v_request_key,
      'user'
    )
    on conflict (user_id) do update
    set choice = 'early_access',
        selected_at = excluded.selected_at,
        request_key = excluded.request_key,
        choice_source = 'user',
        version = public.commercial_access_choices.version + 1,
        updated_at = now();
  end if;

  v_after := public.phase4_access_snapshot(v_user_id, false, null);
  return jsonb_build_object(
    'ok', true,
    'exempt', false,
    'choice', v_choice,
    'access', v_after
  );
end;
$$;

revoke all on function public.phase4_choose_access(text, text)
  from public, anon;
grant execute on function public.phase4_choose_access(text, text)
  to authenticated, service_role;

create or replace function public.phase4_payment_implies_early_access_choice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.plan_code = 'early_access_beta'
     and new.status in ('pending', 'needs_information', 'approved') then
    insert into public.commercial_access_choices (
      user_id, choice, selected_at, choice_source
    ) values (
      new.user_id,
      'early_access',
      coalesce(new.submitted_at, clock_timestamp()),
      'payment_submission'
    )
    on conflict (user_id) do update
    set choice = 'early_access',
        selected_at = excluded.selected_at,
        choice_source = excluded.choice_source,
        version = public.commercial_access_choices.version + 1,
        updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.phase4_payment_implies_early_access_choice()
  from public, anon, authenticated;

drop trigger if exists payment_requests_record_access_choice
  on public.payment_requests;
create trigger payment_requests_record_access_choice
after insert or update of status, provisional_access_started_at
on public.payment_requests
for each row
execute function public.phase4_payment_implies_early_access_choice();

create or replace function public.phase4_subscription_implies_early_access_choice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' then
    insert into public.commercial_access_choices (
      user_id, choice, selected_at, choice_source
    ) values (
      new.user_id,
      'early_access',
      coalesce(new.starts_at, clock_timestamp()),
      'existing_subscription'
    )
    on conflict (user_id) do update
    set choice = 'early_access',
        selected_at = excluded.selected_at,
        choice_source = excluded.choice_source,
        version = public.commercial_access_choices.version + 1,
        updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.phase4_subscription_implies_early_access_choice()
  from public, anon, authenticated;

drop trigger if exists subscriptions_record_access_choice
  on public.subscriptions;
create trigger subscriptions_record_access_choice
after insert or update of status
on public.subscriptions
for each row
execute function public.phase4_subscription_implies_early_access_choice();

commit;
