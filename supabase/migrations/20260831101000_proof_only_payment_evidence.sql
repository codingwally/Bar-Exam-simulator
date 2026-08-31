-- Proof-only manual payment evidence and paid-at term provenance.
--
-- Students provide only an uploaded proof. The database derives private
-- SHA-based retry/deduplication keys; a Founder reviewer records the immutable
-- paid-at timestamp shown by that proof when approving a rolling-day plan.

begin;

alter table public.payment_requests
  add column if not exists payment_evidence_mode text not null default 'legacy_fields',
  add column if not exists paid_at timestamptz,
  add column if not exists paid_at_verified_by uuid references auth.users(id),
  add column if not exists paid_at_verified_at timestamptz,
  add column if not exists paid_at_verification_source text;

do $payment_evidence_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_evidence_mode_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_evidence_mode_check check (
        payment_evidence_mode in ('legacy_fields', 'proof_only')
      ) not valid;
  end if;
end;
$payment_evidence_constraint$;
alter table public.payment_requests
  validate constraint payment_requests_evidence_mode_check;

do $paid_at_provenance_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_paid_at_provenance_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_paid_at_provenance_check check (
        (
          paid_at is null
          and paid_at_verified_by is null
          and paid_at_verified_at is null
          and paid_at_verification_source is null
        )
        or (
          paid_at is not null
          and paid_at_verified_by is not null
          and paid_at_verified_at is not null
          and paid_at_verification_source = 'reviewer_proof'
        )
      ) not valid;
  end if;
end;
$paid_at_provenance_constraint$;
alter table public.payment_requests
  validate constraint payment_requests_paid_at_provenance_check;

create or replace function public.phase4_guard_payment_evidence_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.payment_evidence_mode is distinct from new.payment_evidence_mode then
    raise exception 'Payment evidence mode is immutable';
  end if;

  if old.paid_at is not null then
    if old.paid_at is distinct from new.paid_at
       or old.paid_at_verified_by is distinct from new.paid_at_verified_by
       or old.paid_at_verified_at is distinct from new.paid_at_verified_at
       or old.paid_at_verification_source is distinct from new.paid_at_verification_source then
      raise exception 'Verified payment time is immutable';
    end if;
  elsif new.paid_at is not null then
    if old.status not in ('pending', 'needs_information')
       or new.status <> 'approved'
       or new.paid_at_verified_by is null
       or new.paid_at_verified_at is null
       or new.paid_at_verification_source <> 'reviewer_proof' then
      raise exception 'Verified payment time may only be recorded by an approval review';
    end if;
  elsif new.paid_at_verified_by is not null
     or new.paid_at_verified_at is not null
     or new.paid_at_verification_source is not null then
    raise exception 'Verified payment provenance requires a payment time';
  end if;

  return new;
end;
$$;

drop trigger if exists phase4_guard_payment_evidence_provenance_trigger
  on public.payment_requests;
create trigger phase4_guard_payment_evidence_provenance_trigger
before update on public.payment_requests
for each row execute function public.phase4_guard_payment_evidence_provenance();

create or replace function public.phase4_create_payment_request_v3(
  p_user_id uuid,
  p_plan_version_id uuid,
  p_payment_channel_version_id uuid,
  p_proof_bucket text,
  p_proof_path text,
  p_proof_mime_type text,
  p_proof_size_bytes bigint,
  p_proof_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_revision public.pricing_revisions%rowtype;
  v_plan public.pricing_plan_versions%rowtype;
  v_channel public.pricing_payment_channel_versions%rowtype;
  v_request public.payment_requests%rowtype;
  v_request_key text;
  v_internal_reference text;
  v_prior_provisional boolean := false;
begin
  if p_user_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and coalesce(u.is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;
  if p_plan_version_id is null or p_payment_channel_version_id is null then
    raise exception 'Plan and payment method are required';
  end if;

  v_request_key := 'pricingv3_' || substr(encode(extensions.digest(
    p_user_id::text || '|' || p_plan_version_id::text || '|'
      || p_payment_channel_version_id::text || '|'
      || lower(coalesce(p_proof_sha256, '')),
    'sha256'
  ), 'hex'), 1, 54);

  -- Accepted retries resolve before the current pricing revision is consulted,
  -- so a lost response remains recoverable after the scheduled cutover.
  select r.* into v_request
  from public.payment_requests r
  where r.request_key = v_request_key;
  if v_request.id is not null then
    if v_request.user_id <> p_user_id
       or v_request.pricing_plan_version_id <> p_plan_version_id
       or v_request.pricing_payment_channel_version_id <> p_payment_channel_version_id
       or v_request.payment_evidence_mode <> 'proof_only' then
      raise exception 'Payment request key conflict';
    end if;
    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'pricingRevisionId', v_request.pricing_revision_id,
      'planVersionId', v_request.pricing_plan_version_id,
      'paymentChannelVersionId', v_request.pricing_payment_channel_version_id,
      'planCode', v_request.plan_code,
      'planName', v_request.trusted_plan_name,
      'amountPhp', v_request.trusted_amount_php,
      'amountCentavos', v_request.trusted_amount_centavos,
      'currency', v_request.trusted_currency,
      'durationDays', v_request.trusted_duration_days,
      'entitlementMode', v_request.trusted_entitlement_mode,
      'fixedEndsAt', v_request.trusted_fixed_ends_at,
      'submittedAt', v_request.submitted_at,
      'proofObjectPath', v_request.proof_object_path,
      'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
      'provisionalGrantReused', v_request.provisional_access_started_at is null,
      'paymentEvidenceMode', 'proof_only',
      'verifiedPaidAt', v_request.paid_at,
      'verifiedPaidAtVerifiedAt', v_request.paid_at_verified_at,
      'purchasedStartsAt', v_request.approved_entitlement_starts_at,
      'purchasedEndsAt', v_request.approved_entitlement_ends_at,
      'replayed', true
    );
  end if;

  select r.* into v_revision
  from public.pricing_revisions r
  where r.state in ('published', 'scheduled')
    and r.effective_at <= v_now
  order by r.effective_at desc, r.revision_number desc
  limit 1;
  select p.* into v_plan
  from public.pricing_plan_versions p
  where p.id = p_plan_version_id
    and p.revision_id = v_revision.id;
  if v_plan.id is null
     or not v_plan.visible
     or (v_plan.display_starts_at is not null and v_now < v_plan.display_starts_at)
     or (v_plan.display_ends_at is not null and v_now >= v_plan.display_ends_at)
     or not v_plan.checkout_enabled
     or (v_plan.checkout_starts_at is not null and v_now < v_plan.checkout_starts_at)
     or (v_plan.checkout_ends_at is not null and v_now >= v_plan.checkout_ends_at) then
    raise exception 'Selected pricing plan is not open for checkout';
  end if;

  select c.* into v_channel
  from public.pricing_payment_channel_versions c
  where c.id = p_payment_channel_version_id
    and c.revision_id = v_revision.id
    and c.enabled
    and c.visible
    and (c.qr_asset_id is not null or c.qr_public_path is not null)
    and (c.plan_version_id is null or c.plan_version_id = v_plan.id)
    and (c.amount_centavos is null or c.amount_centavos = v_plan.price_centavos);
  if v_channel.id is null then
    raise exception 'Payment method is not compatible with the selected plan amount';
  end if;

  if p_proof_bucket <> 'payment-proofs'
     or p_proof_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|pdf)$'
     or p_proof_mime_type not in ('image/png', 'image/jpeg', 'application/pdf')
     or p_proof_size_bytes not between 1 and 6291456
     or lower(coalesce(p_proof_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Payment proof metadata is invalid';
  end if;
  v_internal_reference := 'proof_sha256_' || lower(p_proof_sha256);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payment:' || p_user_id::text, 0)
  );
  select r.* into v_request
  from public.payment_requests r
  where r.request_key = v_request_key;
  if v_request.id is not null then
    if v_request.user_id <> p_user_id
       or v_request.pricing_plan_version_id <> p_plan_version_id
       or v_request.pricing_payment_channel_version_id <> p_payment_channel_version_id
       or v_request.payment_evidence_mode <> 'proof_only' then
      raise exception 'Payment request key conflict';
    end if;
    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'pricingRevisionId', v_request.pricing_revision_id,
      'planVersionId', v_request.pricing_plan_version_id,
      'paymentChannelVersionId', v_request.pricing_payment_channel_version_id,
      'planCode', v_request.plan_code,
      'planName', v_request.trusted_plan_name,
      'amountPhp', v_request.trusted_amount_php,
      'amountCentavos', v_request.trusted_amount_centavos,
      'currency', v_request.trusted_currency,
      'durationDays', v_request.trusted_duration_days,
      'entitlementMode', v_request.trusted_entitlement_mode,
      'fixedEndsAt', v_request.trusted_fixed_ends_at,
      'submittedAt', v_request.submitted_at,
      'proofObjectPath', v_request.proof_object_path,
      'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
      'provisionalGrantReused', v_request.provisional_access_started_at is null,
      'paymentEvidenceMode', 'proof_only',
      'verifiedPaidAt', v_request.paid_at,
      'verifiedPaidAtVerifiedAt', v_request.paid_at_verified_at,
      'purchasedStartsAt', v_request.approved_entitlement_starts_at,
      'purchasedEndsAt', v_request.approved_entitlement_ends_at,
      'replayed', true
    );
  end if;
  if exists (
    select 1
    from public.payment_requests r
    where r.user_id = p_user_id
      and r.status in ('pending', 'needs_information')
  ) then
    raise exception 'A payment request is already awaiting review';
  end if;

  select exists (
    select 1
    from public.payment_requests r
    where r.user_id = p_user_id
      and r.provisional_access_started_at is not null
  ) or exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.source in ('manual_payment', 'admin_adjustment', 'migration')
  ) into v_prior_provisional;

  insert into public.payment_requests (
    user_id, plan_code, trusted_amount_php, payment_method, payment_date,
    transaction_reference, student_note, proof_bucket, proof_object_path,
    proof_original_name, proof_mime_type, proof_size_bytes, proof_sha256,
    request_key, provisional_access_started_at, provisional_access_expires_at,
    pricing_revision_id, pricing_plan_version_id,
    pricing_payment_channel_version_id, trusted_plan_name,
    trusted_amount_centavos, trusted_currency, trusted_duration_days,
    trusted_entitlement_mode, trusted_fixed_ends_at,
    trusted_payment_channel_label, trusted_payment_account_details,
    payment_evidence_mode
  ) values (
    p_user_id, v_plan.plan_code, v_plan.price_centavos / 100.0,
    v_channel.channel_code,
    (v_now at time zone 'Asia/Manila')::date,
    v_internal_reference,
    null,
    p_proof_bucket,
    p_proof_path,
    left(pg_catalog.regexp_replace(p_proof_path, '^.*/', ''), 180),
    p_proof_mime_type,
    p_proof_size_bytes::integer,
    lower(p_proof_sha256),
    v_request_key,
    case when v_prior_provisional then null else v_now end,
    case when v_prior_provisional then null else v_now + interval '24 hours' end,
    v_revision.id,
    v_plan.id,
    v_channel.id,
    v_plan.name,
    v_plan.price_centavos,
    v_plan.currency,
    v_plan.duration_days,
    v_plan.entitlement_mode,
    v_plan.fixed_ends_at,
    v_channel.label,
    v_channel.account_details,
    'proof_only'
  ) returning * into v_request;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, metadata
  ) values (
    v_request.id,
    p_user_id,
    'submitted',
    null,
    'pending',
    'Student submitted payment proof for manual verification.',
    left(v_request_key, 96) || '_history',
    jsonb_build_object(
      'pricingRevisionId', v_revision.id,
      'planVersionId', v_plan.id,
      'paymentChannelVersionId', v_channel.id,
      'amountCentavos', v_plan.price_centavos,
      'paymentEvidenceMode', 'proof_only',
      'provisionalAccessExpiresAt', v_request.provisional_access_expires_at
    )
  );
  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  ) values (
    'payment_submitted',
    'premium@duediligence.ph',
    'Due Diligence plan payment verification request',
    '/admin/payments?request=' || v_request.id::text,
    'payment_request',
    v_request.id
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'pricingRevisionId', v_revision.id,
    'planVersionId', v_plan.id,
    'paymentChannelVersionId', v_channel.id,
    'planCode', v_plan.plan_code,
    'planName', v_plan.name,
    'amountPhp', v_request.trusted_amount_php,
    'amountCentavos', v_plan.price_centavos,
    'currency', v_plan.currency,
    'durationDays', v_plan.duration_days,
    'entitlementMode', v_plan.entitlement_mode,
    'fixedEndsAt', v_plan.fixed_ends_at,
    'submittedAt', v_request.submitted_at,
    'proofObjectPath', v_request.proof_object_path,
    'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
    'provisionalGrantReused', v_prior_provisional,
    'paymentEvidenceMode', 'proof_only',
    'verifiedPaidAt', null,
    'verifiedPaidAtVerifiedAt', null,
    'purchasedStartsAt', null,
    'purchasedEndsAt', null,
    'replayed', false
  );
exception
  when unique_violation then
    if exists (
      select 1
      from public.payment_requests r
      where r.payment_method = v_channel.channel_code
        and r.reference_normalized = lower(v_internal_reference)
    ) then
      raise exception 'This payment proof has already been submitted';
    end if;
    raise;
end;
$$;

-- Existing callers retain the same review signature. Rolling-day approval now
-- requires an ISO-8601 verifiedPaidAt value taken from the uploaded proof.
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
begin
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
  if v_status <> 'approved' and p_payload ? 'verifiedPaidAt' then
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

    v_mode := v_plan.entitlement_mode;
    v_duration := v_plan.duration_days;
    v_fixed_end := v_plan.fixed_ends_at;
    if v_mode = 'fixed_end'
       and (v_fixed_end is null or v_fixed_end <= v_now) then
      raise exception 'The fixed legacy entitlement has ended';
    end if;

    v_paid_at_text := nullif(btrim(coalesce(p_payload->>'verifiedPaidAt', '')), '');
    if v_mode = 'rolling_days' and v_paid_at_text is null then
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
    select s.* into v_subscription
    from public.subscriptions s
    where s.user_id = v_payment.user_id
      and s.status in ('trialing', 'pending_payment', 'active', 'paused')
    order by s.expires_at desc nulls first, s.updated_at desc
    limit 1
    for update;

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
      v_purchased_start := v_paid_at;
      v_purchased_end := null;

    elsif v_mode = 'rolling_days'
       and v_subscription.id is not null
       and v_subscription.expires_at is not null then
      v_previous_subscription := to_jsonb(v_subscription);
      v_prior_expiry := v_subscription.expires_at;
      v_base := greatest(v_paid_at, v_subscription.expires_at);
      v_expires_at := v_base + pg_catalog.make_interval(days => v_duration);
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
          starts_at = coalesce(starts_at, v_paid_at),
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
        v_base := v_paid_at;
        v_expires_at := v_base + pg_catalog.make_interval(days => v_duration);
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
          when v_mode = 'rolling_days' then v_paid_at
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
      'purchasedStartsAt', v_payment.approved_entitlement_starts_at,
      'purchasedEndsAt', v_payment.approved_entitlement_ends_at
    )
  );
  return v_result;
end;
$$;

-- Student billing never exposes the synthetic transaction reference used to
-- satisfy legacy non-null/index constraints for proof-only submissions.
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
        ) || case
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

-- Server notification/receipt contexts also omit the private internal
-- reference for proof-only rows so it cannot leak into subscriber messages.
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
  ) || case
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
  ) || case
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

-- A v2 Admin queue keeps legacy evidence visible for old rows while stripping
-- the private synthetic fields from proof-only rows. The Worker should use this
-- version for the payment section.
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
    )
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

revoke all on function public.phase4_guard_payment_evidence_provenance()
  from public, anon, authenticated;
revoke all on function public.phase4_create_payment_request_v3(
  uuid, uuid, uuid, text, text, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_review_payment(uuid, uuid, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.phase4_student_billing_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_admin_operational_data_scoped_v2(
  uuid, text, text, integer, integer, text
) from public, anon, authenticated;

grant execute on function public.phase4_create_payment_request_v3(
  uuid, uuid, uuid, text, text, text, bigint, text
) to service_role;
grant execute on function public.phase4_admin_review_payment(uuid, uuid, jsonb, text, text)
  to service_role;
grant execute on function public.phase4_student_billing_snapshot(uuid)
  to service_role;
grant execute on function public.phase4_admin_operational_data_scoped_v2(
  uuid, text, text, integer, integer, text
) to service_role;

comment on function public.phase4_create_payment_request_v3(
  uuid, uuid, uuid, text, text, text, bigint, text
) is 'Creates an idempotent proof-only payment request. Students never supply payment date or transaction reference.';
comment on column public.payment_requests.paid_at
  is 'Immutable payment timestamp transcribed from the uploaded proof by the approving Founder reviewer.';

commit;
