-- Astra payment activation contract, 7 September 2026.
-- This forward migration changes future approvals and current plan metadata only.
-- It does NOT correct existing customer records, resend receipts, alter proof
-- evidence, invalidate approvals, or change the scheduled September 14 QR.
begin;

alter table public.payment_requests
  add column if not exists approved_activation_at timestamptz,
  add column if not exists approved_entitlement_mode text,
  add column if not exists approved_duration_days integer;

do $term_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_approved_term_v1_check'
  ) then
    alter table public.payment_requests add constraint payment_requests_approved_term_v1_check check (
      (approved_activation_at is null and approved_entitlement_mode is null and approved_duration_days is null)
      or (
        approved_activation_at is not null and approved_entitlement_starts_at is not null
        and approved_entitlement_mode is not null
        and (
          (approved_entitlement_mode = 'fixed_end' and approved_entitlement_ends_at is not null)
          or (
            approved_entitlement_mode = 'rolling_days'
            and approved_duration_days is not null and approved_duration_days between 1 and 366
            and approved_entitlement_ends_at is not null
            and approved_entitlement_ends_at = approved_entitlement_starts_at
              + pg_catalog.make_interval(hours => 24 * approved_duration_days)
          )
        )
      )
    ) not valid;
  end if;
end;
$term_constraint$;
alter table public.payment_requests validate constraint payment_requests_approved_term_v1_check;

-- Hours, rather than local calendar days, keep elapsed duration exact even if
-- a database session is configured to a daylight-saving timezone.
create or replace function public.phase4_exact_payment_term_end(
  p_starts_at timestamptz, p_duration_days integer
)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_starts_at is null or not pg_catalog.isfinite(p_starts_at)
     or p_duration_days is null or p_duration_days not between 1 and 366 then
    raise exception 'A finite start and valid payment duration are required';
  end if;
  return p_starts_at + pg_catalog.make_interval(hours => 24 * p_duration_days);
end;
$$;
revoke all on function public.phase4_exact_payment_term_end(timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.phase4_exact_payment_term_end(timestamptz,integer) to service_role;

-- Normalize only newly written supported-plan versions. Existing immutable
-- published rows retain their original commercial evidence. This also makes
-- cloning/rolling back an old revision safe without restoring fixed149 terms.
create or replace function public.phase4_normalize_current_payment_term()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.plan_code = 'early_access_beta' and new.price_centavos = 14900)
     or (new.plan_code = 'bar_access_30d' and new.price_centavos = 19900) then
    new.duration_days := 30;
    new.entitlement_mode := 'rolling_days';
    new.fixed_ends_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.phase4_normalize_current_payment_term()
  from public, anon, authenticated, service_role;
drop trigger if exists phase4_normalize_current_payment_term_trigger on public.pricing_plan_versions;
create trigger phase4_normalize_current_payment_term_trigger
before insert or update on public.pricing_plan_versions
for each row execute function public.phase4_normalize_current_payment_term();

update public.plan_catalog
set duration_days = 30, updated_at = clock_timestamp()
where (plan_code = 'early_access_beta' and price_php = 149.00)
   or (plan_code = 'bar_access_30d' and price_php = 199.00);

do $publish_current_term$
declare
  v_now timestamptz := clock_timestamp();
  v_source public.pricing_revisions%rowtype;
  v_revision_id constant uuid := 'a9070000-0000-4000-8000-000000000149'::uuid;
  v_schedule_before jsonb;
  v_schedule_after jsonb;
  v_content jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pricing-publication', 0)
  );
  if exists (select 1 from public.pricing_revisions where id = v_revision_id) then
    if not exists (
      select 1 from public.pricing_revisions r
      join public.pricing_plan_versions p on p.revision_id = r.id
      where r.id = v_revision_id and r.state = 'published'
        and p.plan_code = 'early_access_beta' and p.price_centavos = 14900
        and p.duration_days = 30 and p.entitlement_mode = 'rolling_days'
        and p.fixed_ends_at is null
    ) then raise exception 'Existing Astra pricing revision does not match the reviewed contract'; end if;
    return;
  end if;
  if v_now >= '2026-09-14 00:00:00+08'::timestamptz then
    raise exception 'The 149 publication window has ended; review the live offer before applying this migration';
  end if;
  if exists (select 1 from public.pricing_revisions where state = 'draft') then
    raise exception 'An existing Founder pricing draft must be preserved and resolved before this publication';
  end if;
  select jsonb_agg(to_jsonb(r) order by r.id) into v_schedule_before
  from public.pricing_revisions r where r.state = 'scheduled';
  select r.* into v_source from public.pricing_revisions r
  where r.state in ('published','scheduled') and r.effective_at <= v_now
  order by r.effective_at desc, r.revision_number desc limit 1;
  if v_source.id is null or not exists (
    select 1 from public.pricing_plan_versions p
    where p.revision_id = v_source.id
      and p.plan_code = 'early_access_beta' and p.price_centavos = 14900
      and p.visible and p.checkout_enabled
  ) then raise exception 'Current 149 offer is unavailable; refusing to replace another live offer'; end if;

  insert into public.pricing_revisions (
    id,state,schema_version,lock_version,page_config,based_on_revision_id
  ) values (
    v_revision_id,'draft',v_source.schema_version,1,v_source.page_config,v_source.id
  );
  perform public.phase4_clone_pricing_revision(v_source.id,v_revision_id);
  if not exists (
    select 1 from public.pricing_plan_versions p
    join public.pricing_payment_channel_versions c on c.revision_id=p.revision_id
      and (c.plan_version_id is null or c.plan_version_id=p.id)
    where p.revision_id=v_revision_id and p.plan_code='early_access_beta'
      and p.price_centavos=14900 and p.duration_days=30
      and p.entitlement_mode='rolling_days' and p.fixed_ends_at is null
      and c.enabled and c.visible and (c.qr_asset_id is not null or c.qr_public_path is not null)
      and (c.amount_centavos is null or c.amount_centavos=14900)
  ) then raise exception 'Cloned 149 plan and payment channel are incompatible'; end if;

  select jsonb_build_object(
    'page',v_source.page_config,
    'plans',(select jsonb_agg(to_jsonb(p) order by p.plan_code)
      from public.pricing_plan_versions p where p.revision_id=v_revision_id),
    'channels',(select jsonb_agg(to_jsonb(c) order by c.channel_code,c.id)
      from public.pricing_payment_channel_versions c where c.revision_id=v_revision_id)
  ) into v_content;
  update public.pricing_revisions
  set state='published',effective_at=v_now,published_at=v_now,updated_at=v_now,
    lock_version=lock_version+1,
    content_hash=encode(pg_catalog.sha256(pg_catalog.convert_to(v_content::text,'UTF8')),'hex')
  where id=v_revision_id and state='draft';
  select jsonb_agg(to_jsonb(r) order by r.id) into v_schedule_after
  from public.pricing_revisions r where r.state='scheduled';
  if v_schedule_after is distinct from v_schedule_before then
    raise exception 'Scheduled pricing changed unexpectedly; refusing publication';
  end if;
end;
$publish_current_term$;

-- Captured approval fields are authoritative for each purchased segment;
-- a later subscription renewal must not rewrite the old receipt's term.
create or replace function public.phase4_effective_payment_terms(p public.payment_requests)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'activatedAt',p.approved_activation_at,
    'durationDays',coalesce(p.approved_duration_days,
      case when p.status in ('pending','needs_information')
        and p.plan_code='early_access_beta' and p.trusted_amount_php=149.00
        and p.submitted_at >= '2026-09-01 00:00:00+08'::timestamptz then 30
        else p.trusted_duration_days end),
    'entitlementMode',coalesce(p.approved_entitlement_mode,
      case when p.status in ('pending','needs_information')
        and p.plan_code='early_access_beta' and p.trusted_amount_php=149.00
        and p.submitted_at >= '2026-09-01 00:00:00+08'::timestamptz then 'rolling_days'
        else p.trusted_entitlement_mode end),
    'fixedEntitlementEndsAt',case
      when p.approved_entitlement_mode='rolling_days' then null
      when p.status in ('pending','needs_information')
        and p.plan_code='early_access_beta' and p.trusted_amount_php=149.00
        and p.submitted_at >= '2026-09-01 00:00:00+08'::timestamptz then null
      else p.trusted_fixed_ends_at end,
    'fixedEndsAt',case
      when p.approved_entitlement_mode='rolling_days' then null
      when p.status in ('pending','needs_information')
        and p.plan_code='early_access_beta' and p.trusted_amount_php=149.00
        and p.submitted_at >= '2026-09-01 00:00:00+08'::timestamptz then null
      else p.trusted_fixed_ends_at end,
    'purchasedStartsAt',p.approved_entitlement_starts_at,
    'purchasedEndsAt',p.approved_entitlement_ends_at
  );
$$;
revoke all on function public.phase4_effective_payment_terms(public.payment_requests)
  from public,anon,authenticated;
grant execute on function public.phase4_effective_payment_terms(public.payment_requests) to service_role;

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
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_inserted integer := 0;
  v_existing_action public.admin_action_requests%rowtype;
  v_payment public.payment_requests%rowtype;
  v_plan public.pricing_plan_versions%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_status text;
  v_mode text;
  v_duration integer;
  v_fixed_end timestamptz;
  v_expires_at timestamptz;
  v_base timestamptz;
  v_purchased_start timestamptz;
  v_purchased_end timestamptz;
  v_prior_expiry timestamptz;
  v_entitlement_changed boolean := false;
  v_previous_payment jsonb;
  v_previous_subscription jsonb := '{}'::jsonb;
  v_prior_subscription_snapshot jsonb;
  v_history_action text := 'activate';
  v_result jsonb;
  v_paid_at_text text;
  v_paid_at timestamptz;
  v_activation_anchor boolean := false;
  v_term_start timestamptz;
begin
  -- astra-payment-activation-v1: paid evidence and activation are distinct.
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
     or p_request_key is null
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid review reason and request key required';
  end if;

  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (
    p_request_key, p_actor_user_id, 'payment_review', p_payment_request_id::text
  ) on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select r.* into v_existing_action
    from public.admin_action_requests r
    where r.request_key = p_request_key;
    if v_existing_action.actor_user_id <> p_actor_user_id
       or v_existing_action.action <> 'payment_review'
       or v_existing_action.target_resource_id <> p_payment_request_id::text then
      raise exception 'Request key conflict';
    end if;
    if v_existing_action.result is null then
      raise exception 'Action is already in progress';
    end if;
    if v_existing_action.result->'payment'->>'status'
       is distinct from lower(btrim(coalesce(p_payload->>'status', ''))) then
      raise exception 'Request key conflicts with the original payment decision';
    end if;
    return v_existing_action.result || jsonb_build_object('replayed', true);
  end if;

  select r.* into v_payment
  from public.payment_requests r
  where r.id = p_payment_request_id
  for update;
  if v_payment.id is null then
    raise exception 'Payment request not found';
  end if;
  v_status := lower(btrim(coalesce(p_payload->>'status', '')));
  if v_status not in ('needs_information', 'approved', 'rejected')
     or v_payment.status not in ('pending', 'needs_information') then
    raise exception 'Payment request is no longer reviewable';
  end if;
  if v_status <> 'approved'
     and nullif(btrim(coalesce(p_payload->>'verifiedPaidAt', '')), '') is not null then
    raise exception 'verifiedPaidAt is accepted only for approval';
  end if;
  v_previous_payment := to_jsonb(v_payment) - array[
    'student_note', 'proof_object_path', 'proof_original_name', 'proof_sha256',
    'trusted_payment_account_details', 'transaction_reference',
    'reference_normalized'
  ];

  if v_status = 'approved' then
    if v_payment.pricing_plan_version_id is not null then
      select p.* into v_plan
      from public.pricing_plan_versions p
      where p.id = v_payment.pricing_plan_version_id
        and p.revision_id = v_payment.pricing_revision_id
        and p.plan_code = v_payment.plan_code;
      if v_plan.id is null
         or v_payment.trusted_amount_centavos <> v_plan.price_centavos
         or v_payment.trusted_amount_php <> v_plan.price_centavos / 100.0
         or v_payment.trusted_plan_name <> v_plan.name
         or v_payment.trusted_currency <> v_plan.currency
         or v_payment.trusted_entitlement_mode <> v_plan.entitlement_mode
         or v_payment.trusted_duration_days is distinct from v_plan.duration_days
         or v_payment.trusted_fixed_ends_at is distinct from v_plan.fixed_ends_at then
        raise exception 'Captured payment plan snapshot does not match immutable pricing evidence';
      end if;
    elsif v_payment.plan_code = 'early_access_beta'
       and v_payment.trusted_amount_php = 149.00
       and v_payment.submitted_at < '2026-09-14 00:00:00+08'::timestamptz then
      select p.* into v_plan
      from public.pricing_plan_versions p
      where p.id = 'a8300000-0000-4000-8000-000000000101'::uuid;
      if v_plan.id is null then
        raise exception 'Legacy pricing evidence is unavailable';
      end if;
    else
      raise exception 'Trusted payment plan evidence cannot be activated';
    end if;

    -- Honor accepted September proofs after a later pricing publication without
    -- rewriting their original offer/payment evidence or charging a difference.
    if v_payment.plan_code = 'early_access_beta'
       and v_payment.trusted_amount_php = 149.00
       and v_payment.submitted_at >= '2026-09-01 00:00:00+08'::timestamptz
       and v_plan.entitlement_mode = 'fixed_end' then
      select p.* into v_plan
      from public.pricing_plan_versions p
      join public.pricing_revisions r on r.id = p.revision_id
      where p.plan_code = 'early_access_beta' and p.price_centavos = 14900
        and p.entitlement_mode = 'rolling_days' and p.duration_days = 30
        and p.fixed_ends_at is null
        and r.state in ('published', 'scheduled') and r.effective_at <= v_now
      order by r.effective_at desc, r.revision_number desc limit 1;
      if v_plan.id is null then
        raise exception 'The approved rolling 149 term is unavailable';
      end if;
    end if;
    v_activation_anchor := (v_plan.plan_code = 'early_access_beta'
        and v_plan.price_centavos = 14900 and v_plan.entitlement_mode = 'rolling_days')
      or (v_plan.plan_code = 'bar_access_30d' and v_plan.price_centavos = 19900);
    v_mode := v_plan.entitlement_mode;
    v_duration := v_plan.duration_days;
    v_fixed_end := v_plan.fixed_ends_at;
    if v_mode = 'fixed_end'
       and (v_fixed_end is null or v_fixed_end <= v_now) then
      raise exception 'The fixed legacy entitlement has ended';
    end if;

    v_paid_at_text := nullif(btrim(coalesce(p_payload->>'verifiedPaidAt', '')), '');
    if v_mode = 'rolling_days' and not v_activation_anchor and v_paid_at_text is null then
      raise exception 'verifiedPaidAt is required to approve a rolling subscription';
    end if;
    if v_paid_at_text is not null then
      if v_paid_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'verifiedPaidAt must be an ISO-8601 timestamp with timezone';
      end if;
      v_paid_at := v_paid_at_text::timestamptz;
      if v_paid_at > v_now then
        raise exception 'verifiedPaidAt cannot be in the future';
      end if;
      if v_paid_at > v_payment.submitted_at then
        raise exception 'verifiedPaidAt cannot be after the proof submission time';
      end if;
      if v_plan.checkout_starts_at is not null
         and v_paid_at < v_plan.checkout_starts_at then
        raise exception 'verifiedPaidAt cannot precede the plan checkout start';
      end if;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('subscription:' || v_payment.user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_payment.user_id::text, 499)
    );
    select s.* into v_subscription
    from public.subscriptions s
    where s.user_id = v_payment.user_id
      and s.status in ('trialing', 'pending_payment', 'active', 'paused')
    order by s.expires_at desc nulls first, s.updated_at desc
    limit 1
    for update;

    -- Timestamp the activation after acquiring the subscription locks.
    v_now := clock_timestamp();
    if v_subscription.id is not null
       and (v_subscription.starts_at > v_now
         or (v_subscription.expires_at is null
           and (v_subscription.status <> 'active' or v_subscription.starts_at is null))) then
      -- A future-start or inactive non-expiring row is not current usable access, but
      -- replacing it could erase a legitimate independent grant. Roll back the
      -- entire review and require the Founder to resolve its provenance first.
      raise exception 'PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW: Resolve the future-start or inactive non-expiring subscription before approving this payment';
    end if;
    v_term_start := case when v_activation_anchor then v_now else v_paid_at end;
    if v_activation_anchor and (v_mode <> 'rolling_days' or v_duration <> 30) then
      raise exception 'Approved 149/199 purchases require an exact 30-day term';
    end if;

    if v_subscription.id is not null then
      v_prior_subscription_snapshot := jsonb_build_object(
        'snapshotVersion', 1,
        'subscriptionId', v_subscription.id,
        'planCode', v_subscription.plan_code,
        'status', v_subscription.status,
        'startsAt', v_subscription.starts_at,
        'expiresAt', v_subscription.expires_at,
        'source', v_subscription.source,
        'pricingRevisionId', v_subscription.pricing_revision_id,
        'pricingPlanVersionId', v_subscription.pricing_plan_version_id,
        'termDurationDays', v_subscription.term_duration_days,
        'entitlementMode', v_subscription.entitlement_mode
      );
    end if;

    if v_mode = 'rolling_days'
       and v_subscription.id is not null
       and v_subscription.expires_at is null then
      -- A non-expiring entitlement is stronger and must never be shortened.
      v_history_action := null;
      v_entitlement_changed := false;
      -- Record this purchase's finite term while preserving the independent,
      -- stronger non-expiring subscription without modification.
      v_purchased_start := v_term_start;
      v_purchased_end := public.phase4_exact_payment_term_end(v_term_start, v_duration);

    elsif v_mode = 'rolling_days'
       and v_subscription.id is not null
       and v_subscription.expires_at is not null then
      v_previous_subscription := to_jsonb(v_subscription);
      v_prior_expiry := v_subscription.expires_at;
      v_base := greatest(v_term_start, v_subscription.expires_at);
      v_expires_at := public.phase4_exact_payment_term_end(v_base, v_duration);
      v_purchased_start := v_base;
      v_purchased_end := v_expires_at;
      v_entitlement_changed := true;
      v_history_action := case
        when v_subscription.plan_code = v_plan.plan_code then 'extend'
        else 'replace_plan'
      end;
      update public.subscriptions
      set plan_code = v_plan.plan_code,
          status = 'active',
          starts_at = coalesce(starts_at, v_term_start),
          expires_at = v_expires_at,
          source = 'manual_payment',
          updated_at = v_now,
          updated_by = p_actor_user_id,
          reason = btrim(p_reason),
          version = version + 1,
          pricing_revision_id = v_plan.revision_id,
          pricing_plan_version_id = v_plan.id,
          term_duration_days = v_plan.duration_days,
          entitlement_mode = v_plan.entitlement_mode
      where id = v_subscription.id
      returning * into v_subscription;

    elsif v_mode = 'fixed_end'
       and v_subscription.id is not null
       and (
         v_subscription.expires_at is null
         or v_subscription.expires_at >= v_fixed_end
       ) then
      v_history_action := null;
      v_entitlement_changed := false;
      v_purchased_start := coalesce(v_payment.provisional_access_started_at, v_now);
      v_purchased_end := v_fixed_end;

    else
      v_prior_expiry := v_subscription.expires_at;
      if v_mode = 'rolling_days' then
        v_base := v_term_start;
        v_expires_at := public.phase4_exact_payment_term_end(v_base, v_duration);
        v_purchased_start := v_base;
        v_purchased_end := v_expires_at;
      else
        v_expires_at := v_fixed_end;
        v_purchased_start := coalesce(v_payment.provisional_access_started_at, v_now);
        v_purchased_end := v_fixed_end;
      end if;
      v_entitlement_changed := true;
      update public.subscriptions
      set status = 'cancelled',
          updated_at = v_now,
          updated_by = p_actor_user_id,
          reason = 'Replaced by approved versioned manual payment.',
          version = version + 1
      where user_id = v_payment.user_id
        and status in ('trialing', 'pending_payment', 'active', 'paused');
      insert into public.subscriptions (
        user_id, plan_code, status, starts_at, expires_at, source,
        created_by, updated_by, reason, pricing_revision_id,
        pricing_plan_version_id, term_duration_days, entitlement_mode
      ) values (
        v_payment.user_id,
        v_plan.plan_code,
        'active',
        case
          when v_mode = 'rolling_days' then v_term_start
          else coalesce(v_payment.provisional_access_started_at, v_now)
        end,
        v_expires_at,
        'manual_payment',
        p_actor_user_id,
        p_actor_user_id,
        btrim(p_reason),
        v_plan.revision_id,
        v_plan.id,
        v_plan.duration_days,
        v_plan.entitlement_mode
      ) returning * into v_subscription;
      v_history_action := 'activate';
    end if;

    if v_history_action is not null then
      insert into public.subscription_history (
        subscription_id, user_id, actor_user_id, action,
        previous_state, new_state, reason, request_key
      ) values (
        v_subscription.id,
        v_subscription.user_id,
        p_actor_user_id,
        v_history_action,
        v_previous_subscription,
        to_jsonb(v_subscription),
        btrim(p_reason),
        left(p_request_key, 96) || '_subscription'
      );
    end if;
  elsif v_status = 'rejected' then
    update public.payment_requests
    set provisional_access_revoked_at = coalesce(provisional_access_revoked_at, v_now)
    where id = v_payment.id;
  end if;

  update public.payment_requests
  set status = v_status,
      reviewed_at = v_now,
      reviewed_by = p_actor_user_id,
      review_reason = btrim(p_reason),
      subscription_id = case
        when v_status = 'approved' then v_subscription.id
        else subscription_id
      end,
      approved_activation_at = case when v_status = 'approved' then v_now else approved_activation_at end,
      approved_entitlement_mode = case when v_status = 'approved' then v_mode else approved_entitlement_mode end,
      approved_duration_days = case when v_status = 'approved' then v_duration else approved_duration_days end,
      approved_entitlement_starts_at = case
        when v_status = 'approved' then v_purchased_start
        else approved_entitlement_starts_at
      end,
      approved_entitlement_ends_at = case
        when v_status = 'approved' then v_purchased_end
        else approved_entitlement_ends_at
      end,
      approved_prior_expires_at = case
        when v_status = 'approved' then v_prior_expiry
        else approved_prior_expires_at
      end,
      approved_prior_subscription_state = case
        when v_status = 'approved' then v_prior_subscription_snapshot
        else approved_prior_subscription_state
      end,
      approved_entitlement_changed = case
        when v_status = 'approved' then v_entitlement_changed
        else approved_entitlement_changed
      end,
      paid_at = case
        when v_status = 'approved' and v_paid_at is not null then v_paid_at
        else paid_at
      end,
      paid_at_verified_by = case
        when v_status = 'approved' and v_paid_at is not null then p_actor_user_id
        else paid_at_verified_by
      end,
      paid_at_verified_at = case
        when v_status = 'approved' and v_paid_at is not null then v_now
        else paid_at_verified_at
      end,
      paid_at_verification_source = case
        when v_status = 'approved' and v_paid_at is not null then 'reviewer_proof'
        else paid_at_verification_source
      end,
      provisional_access_revoked_at = case
        when v_status = 'rejected'
          then coalesce(provisional_access_revoked_at, v_now)
        else provisional_access_revoked_at
      end,
      updated_at = v_now,
      version = version + 1
  where id = v_payment.id
  returning * into v_payment;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, metadata
  ) values (
    v_payment.id,
    p_actor_user_id,
    v_status,
    v_previous_payment->>'status',
    v_status,
    btrim(p_reason),
    left(p_request_key, 96) || '_payment',
    jsonb_build_object(
      'pricingRevisionId', v_payment.pricing_revision_id,
      'planVersionId', v_payment.pricing_plan_version_id,
      'subscriptionId', v_subscription.id,
      'paymentEvidenceMode', v_payment.payment_evidence_mode,
      'verifiedPaidAt', v_payment.paid_at,
      'verifiedPaidAtBy', v_payment.paid_at_verified_by,
      'verifiedPaidAtVerifiedAt', v_payment.paid_at_verified_at,
      'activatedAt', v_payment.approved_activation_at,
      'entitlementMode', v_payment.approved_entitlement_mode,
      'durationDays', v_payment.approved_duration_days,
      'purchasedStartsAt', v_payment.approved_entitlement_starts_at,
      'purchasedEndsAt', v_payment.approved_entitlement_ends_at
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'payment_review',
    'targetUserId', v_payment.user_id,
    'payment', (
      to_jsonb(v_payment) - array[
        'student_note', 'proof_object_path', 'proof_original_name',
        'proof_sha256', 'trusted_payment_account_details',
        'transaction_reference', 'reference_normalized', 'payment_date',
        'paid_at', 'paid_at_verified_by', 'paid_at_verified_at',
        'paid_at_verification_source', 'payment_evidence_mode'
      ]
    ) || jsonb_build_object(
      'paymentEvidenceMode', v_payment.payment_evidence_mode,
      'verifiedPaidAt', v_payment.paid_at,
      'verifiedPaidAtBy', v_payment.paid_at_verified_by,
      'verifiedPaidAtVerifiedAt', v_payment.paid_at_verified_at,
      'activatedAt', v_payment.approved_activation_at,
      'entitlementMode', v_payment.approved_entitlement_mode,
      'durationDays', v_payment.approved_duration_days,
      'purchasedStartsAt', v_payment.approved_entitlement_starts_at,
      'purchasedEndsAt', v_payment.approved_entitlement_ends_at
    ),
    'subscription', case
      when v_subscription.id is null then null
      else to_jsonb(v_subscription)
    end,
    'paymentEvidenceMode', v_payment.payment_evidence_mode,
    'verifiedPaidAt', v_payment.paid_at,
    'verifiedPaidAtBy', v_payment.paid_at_verified_by,
    'verifiedPaidAtVerifiedAt', v_payment.paid_at_verified_at,
    'purchasedStartsAt', v_payment.approved_entitlement_starts_at,
    'purchasedEndsAt', v_payment.approved_entitlement_ends_at,
    'requestKey', p_request_key,
    'replayed', false
  );
  update public.admin_action_requests
  set result = v_result,
      completed_at = v_now
  where request_key = p_request_key;
  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'payment_changed',
    v_payment.user_id,
    'payment_request',
    v_payment.id::text,
    btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'status', v_status,
      'pricingRevisionId', v_payment.pricing_revision_id,
      'planVersionId', v_payment.pricing_plan_version_id,
      'paymentEvidenceMode', v_payment.payment_evidence_mode,
      'verifiedPaidAt', v_payment.paid_at,
      'activatedAt', v_payment.approved_activation_at,
      'entitlementMode', v_payment.approved_entitlement_mode,
      'durationDays', v_payment.approved_duration_days,
      'purchasedStartsAt', v_payment.approved_entitlement_starts_at,
      'purchasedEndsAt', v_payment.approved_entitlement_ends_at
    )
  );
  return v_result;
end;
$$;

create or replace function public.phase4_student_billing_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'pricingRevisionId', p.pricing_revision_id,
          'planVersionId', p.pricing_plan_version_id,
          'paymentChannelVersionId', p.pricing_payment_channel_version_id,
          'planCode', p.plan_code,
          'planName', coalesce(p.trusted_plan_name,
            case when p.plan_code = 'early_access_beta' then 'Early Access' else p.plan_code end),
          'amountPhp', p.trusted_amount_php,
          'amountCentavos', coalesce(p.trusted_amount_centavos,
            round(p.trusted_amount_php * 100)::integer),
          'currency', coalesce(p.trusted_currency, 'PHP'),
          'durationDays', p.trusted_duration_days,
          'entitlementMode', coalesce(p.trusted_entitlement_mode,
            case when p.plan_code = 'early_access_beta' then 'fixed_end' else null end),
          'fixedEntitlementEndsAt', coalesce(p.trusted_fixed_ends_at,
            case when p.plan_code = 'early_access_beta'
              then '2026-10-01 23:59:59+08'::timestamptz else null end),
          'fixedEndsAt', coalesce(p.trusted_fixed_ends_at,
            case when p.plan_code = 'early_access_beta'
              then '2026-10-01 23:59:59+08'::timestamptz else null end),
          'paymentChannelLabel', coalesce(p.trusted_payment_channel_label, p.payment_method),
          'method', p.payment_method,
          'status', p.status,
          'submittedAt', p.submitted_at,
          'reviewedAt', p.reviewed_at,
          'reviewReason', p.review_reason,
          'purchasedStartsAt', p.approved_entitlement_starts_at,
          'purchasedEndsAt', p.approved_entitlement_ends_at,
          'paymentEvidenceMode', p.payment_evidence_mode,
          'verifiedPaidAt', p.paid_at,
          'verifiedPaidAtVerifiedAt', p.paid_at_verified_at
        ) || public.phase4_effective_payment_terms(p) || case
          when p.payment_evidence_mode = 'proof_only' then '{}'::jsonb
          else jsonb_build_object(
            'paymentDate', p.payment_date,
            'reference', p.transaction_reference,
            'paymentReference', p.transaction_reference
          )
        end
        order by p.submitted_at desc
      )
      from public.payment_requests p
      where p.user_id = p_user_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'paymentRequestId', r.payment_request_id,
        'status', r.status,
        'paidAmountPhp', r.paid_amount_php,
        'suggestedRefundPhp', r.suggested_refund_php,
        'approvedRefundPhp', r.approved_refund_php,
        'calculationNote', r.calculation_note,
        'submittedAt', r.submitted_at,
        'reviewReason', r.review_reason
      ) order by r.submitted_at desc)
      from public.refund_requests r
      where r.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.phase4_payment_notification_context(
  p_payment_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'pricingRevisionId', p.pricing_revision_id,
    'planVersionId', p.pricing_plan_version_id,
    'paymentChannelVersionId', p.pricing_payment_channel_version_id,
    'planCode', p.plan_code,
    'planName', coalesce(p.trusted_plan_name,
      case when p.plan_code = 'early_access_beta' then 'Early Access' else p.plan_code end),
    'amountPhp', p.trusted_amount_php,
    'amountCentavos', coalesce(p.trusted_amount_centavos,
      round(p.trusted_amount_php * 100)::integer),
    'currency', coalesce(p.trusted_currency, 'PHP'),
    'durationDays', p.trusted_duration_days,
    'entitlementMode', coalesce(p.trusted_entitlement_mode,
      case when p.plan_code = 'early_access_beta' then 'fixed_end' else null end),
    'fixedEntitlementEndsAt', coalesce(p.trusted_fixed_ends_at,
      case when p.plan_code = 'early_access_beta'
        then '2026-10-01 23:59:59+08'::timestamptz else null end),
    'fixedEndsAt', coalesce(p.trusted_fixed_ends_at,
      case when p.plan_code = 'early_access_beta'
        then '2026-10-01 23:59:59+08'::timestamptz else null end),
    'paymentMethod', p.payment_method,
    'paymentChannelLabel', coalesce(p.trusted_payment_channel_label, p.payment_method),
    'note', p.student_note,
    'proofBucket', coalesce(p.proof_bucket, 'payment-proofs'),
    'proofObjectPath', p.proof_object_path,
    'proofOriginalName', p.proof_original_name,
    'proofMimeType', p.proof_mime_type,
    'proofSizeBytes', p.proof_size_bytes,
    'proofSha256', p.proof_sha256,
    'provisionalAccessExpiresAt', p.provisional_access_expires_at,
    'notificationStatus', p.verification_email_status,
    'notificationAttempts', p.verification_email_attempts,
    'paymentEvidenceMode', p.payment_evidence_mode,
    'verifiedPaidAt', p.paid_at,
    'verifiedPaidAtBy', p.paid_at_verified_by,
    'verifiedPaidAtVerifiedAt', p.paid_at_verified_at,
    'purchasedStartsAt', p.approved_entitlement_starts_at,
    'purchasedEndsAt', p.approved_entitlement_ends_at,
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'displayName', coalesce(pr.display_name, u.email)
    )
  ) || public.phase4_effective_payment_terms(p) || case
    when p.payment_evidence_mode = 'proof_only' then '{}'::jsonb
    else jsonb_build_object(
      'paymentDate', p.payment_date,
      'transactionReference', p.transaction_reference,
      'paymentReference', p.transaction_reference
    )
  end
  from public.payment_requests p
  join auth.users u on u.id = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  where p.id = p_payment_request_id;
$$;

create or replace function public.phase4_subscription_receipt_context(
  p_payment_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'reviewedAt', p.reviewed_at,
    'pricingRevisionId', p.pricing_revision_id,
    'planVersionId', p.pricing_plan_version_id,
    'paymentChannelVersionId', p.pricing_payment_channel_version_id,
    'planCode', p.plan_code,
    'planName', coalesce(p.trusted_plan_name,
      case when p.plan_code = 'early_access_beta' then 'Early Access' else p.plan_code end),
    'amountPhp', p.trusted_amount_php,
    'amountCentavos', coalesce(p.trusted_amount_centavos,
      round(p.trusted_amount_php * 100)::integer),
    'currency', coalesce(p.trusted_currency, 'PHP'),
    'durationDays', p.trusted_duration_days,
    'entitlementMode', coalesce(p.trusted_entitlement_mode,
      case when p.plan_code = 'early_access_beta' then 'fixed_end' else null end),
    'fixedEntitlementEndsAt', coalesce(p.trusted_fixed_ends_at,
      case when p.plan_code = 'early_access_beta'
        then '2026-10-01 23:59:59+08'::timestamptz else null end),
    'fixedEndsAt', coalesce(p.trusted_fixed_ends_at,
      case when p.plan_code = 'early_access_beta'
        then '2026-10-01 23:59:59+08'::timestamptz else null end),
    'purchasedStartsAt', p.approved_entitlement_starts_at,
    'purchasedEndsAt', p.approved_entitlement_ends_at,
    'paymentMethod', p.payment_method,
    'paymentChannelLabel', coalesce(p.trusted_payment_channel_label, p.payment_method),
    'proofBucket', coalesce(p.proof_bucket, 'payment-proofs'),
    'proofObjectPath', p.proof_object_path,
    'proofOriginalName', p.proof_original_name,
    'proofMimeType', p.proof_mime_type,
    'proofSizeBytes', p.proof_size_bytes,
    'proofSha256', p.proof_sha256,
    'receiptStatus', to_jsonb(p)->>'subscriber_receipt_status',
    'receiptAttempts', nullif(to_jsonb(p)->>'subscriber_receipt_attempts', '')::integer,
    'paymentEvidenceMode', p.payment_evidence_mode,
    'verifiedPaidAt', p.paid_at,
    'verifiedPaidAtBy', p.paid_at_verified_by,
    'verifiedPaidAtVerifiedAt', p.paid_at_verified_at,
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'displayName', coalesce(pr.display_name, u.email)
    ),
    'subscription', case when s.id is null then null else jsonb_build_object(
      'id', s.id,
      'planCode', s.plan_code,
      'planName', coalesce(p.trusted_plan_name,
        case when s.plan_code = 'early_access_beta' then 'Early Access' else s.plan_code end),
      'status', s.status,
      'startsAt', s.starts_at,
      'expiresAt', s.expires_at,
      'durationDays', coalesce(s.term_duration_days, p.trusted_duration_days),
      'entitlementMode', coalesce(s.entitlement_mode, p.trusted_entitlement_mode)
    ) end
  ) || public.phase4_effective_payment_terms(p) || case
    when p.payment_evidence_mode = 'proof_only' then '{}'::jsonb
    else jsonb_build_object(
      'paymentDate', p.payment_date,
      'transactionReference', p.transaction_reference,
      'paymentReference', p.transaction_reference
    )
  end
  from public.payment_requests p
  join auth.users u on u.id = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  left join public.subscriptions s on s.id = p.subscription_id
  where p.id = p_payment_request_id;
$$;

create or replace function public.phase4_admin_operational_data_scoped_v2(
  p_actor_user_id uuid,
  p_section text,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb;
begin
  v_result := public.phase4_admin_operational_data_scoped_v1(
    p_actor_user_id,
    p_section,
    p_search,
    p_limit,
    p_offset,
    p_data_scope
  );
  if p_section <> 'payments' then
    return v_result;
  end if;

  select coalesce(jsonb_agg(
    (
      case when p.payment_evidence_mode = 'proof_only'
        then item.value - array['payment_date', 'transaction_reference']
        else item.value
      end
    ) || jsonb_build_object(
      'planName', coalesce(p.trusted_plan_name, p.plan_code),
      'entitlementMode', p.trusted_entitlement_mode,
      'paymentEvidenceMode', p.payment_evidence_mode,
      'verifiedPaidAt', p.paid_at,
      'verifiedPaidAtBy', p.paid_at_verified_by,
      'verifiedPaidAtVerifiedAt', p.paid_at_verified_at,
      'purchasedStartsAt', p.approved_entitlement_starts_at,
      'purchasedEndsAt', p.approved_entitlement_ends_at
    ) || public.phase4_effective_payment_terms(p)
    order by item.ordinality
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  join public.payment_requests p
    on p.id = (item.value->>'id')::uuid;

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

-- Remove only the invented universal expiry fallback; original captured
-- fixed terms and independent subscription dates remain available.
do $refund_term$
declare
  v_definition text;
  v_before constant text := $old$    case when v_payment.plan_code = 'early_access_beta'
      then '2026-10-01 23:59:59+08'::timestamptz else null end,
$old$;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.phase4_create_refund_request(uuid,uuid,text,text)'::regprocedure);
  if position(v_before in v_definition)>0 then
    v_definition := replace(v_definition,v_before,'');
    execute v_definition;
  elsif position('2026-10-01 23:59:59+08' in v_definition)>0 then
    raise exception 'Refund function changed shape; review the fallback before release';
  end if;
end;
$refund_term$;

revoke all on function public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text) to service_role;
revoke all on function public.phase4_student_billing_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.phase4_student_billing_snapshot(uuid) to service_role;
revoke all on function public.phase4_payment_notification_context(uuid) from public,anon,authenticated;
grant execute on function public.phase4_payment_notification_context(uuid) to service_role;
revoke all on function public.phase4_subscription_receipt_context(uuid) from public,anon,authenticated;
grant execute on function public.phase4_subscription_receipt_context(uuid) to service_role;
revoke all on function public.phase4_admin_operational_data_scoped_v2(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.phase4_admin_operational_data_scoped_v2(uuid,text,text,integer,integer,text) to service_role;

comment on column public.payment_requests.approved_activation_at is
  'Server-recorded successful approval/activation instant; separate from verified paid_at evidence. Historical corrections require a separate audited operation.';
comment on column public.payment_requests.approved_entitlement_starts_at is
  'Authoritative start of this purchased segment, including valid renewal stacking; not a later subscription-wide start.';
comment on column public.payment_requests.approved_entitlement_ends_at is
  'Authoritative end of this purchased segment. Exact elapsed duration for new rolling approvals.';

commit;
