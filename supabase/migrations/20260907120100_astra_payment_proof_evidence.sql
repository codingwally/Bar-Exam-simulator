-- Complete proof-only evidence without fabricating payment dates/references.
-- Backward compatible: legacy_fields RPCs and their reference index remain.
-- Historical synthetic values are preserved as immutable prior evidence.
begin;

alter table public.payment_requests
  alter column payment_date drop not null,
  alter column transaction_reference drop not null;

do $legacy_evidence$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.payment_requests'::regclass
      and conname='payment_requests_legacy_fields_required_check'
  ) then
    alter table public.payment_requests add constraint payment_requests_legacy_fields_required_check check (
      payment_evidence_mode='proof_only'
      or (payment_date is not null and transaction_reference is not null)
    ) not valid;
  end if;
end;
$legacy_evidence$;
alter table public.payment_requests validate constraint payment_requests_legacy_fields_required_check;

-- reference_normalized is generated from transaction_reference; once the
-- reference is correctly NULL it cannot serve as proof deduplication.
-- This index covers both historical synthetic rows and future null rows.
create unique index if not exists payment_requests_proof_only_method_sha_uidx
  on public.payment_requests(payment_method,proof_sha256)
  where payment_evidence_mode='proof_only';

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
    ) || public.phase4_effective_payment_terms(v_request);
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

  if p_proof_bucket is distinct from 'payment-proofs'
     or split_part(p_proof_path, '/', 1) <> p_user_id::text
     or p_proof_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|pdf)$'
     or p_proof_mime_type not in ('image/png', 'image/jpeg', 'application/pdf')
     or p_proof_size_bytes not between 1 and 6291456
     or lower(coalesce(p_proof_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Payment proof metadata is invalid';
  end if;

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
    ) || public.phase4_effective_payment_terms(v_request);
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
    null,
    null,
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
  ) || public.phase4_effective_payment_terms(v_request);
exception
  when unique_violation then
    if exists (
      select 1
      from public.payment_requests r
      where r.payment_method = v_channel.channel_code
        and r.payment_evidence_mode = 'proof_only'
        and r.proof_sha256 = lower(p_proof_sha256)
    ) then
      raise exception 'This payment proof has already been submitted';
    end if;
    raise;
end;
$$;

revoke all on function public.phase4_create_payment_request_v3(
  uuid,uuid,uuid,text,text,text,bigint,text
) from public,anon,authenticated;
grant execute on function public.phase4_create_payment_request_v3(
  uuid,uuid,uuid,text,text,text,bigint,text
) to service_role;

comment on column public.payment_requests.payment_date is
  'Customer-provided legacy payment date; NULL for newly accepted proof-only requests.';
comment on column public.payment_requests.transaction_reference is
  'Customer-provided legacy reference; NULL for new proof-only requests. Historical synthetic values are retained, not exposed as customer evidence.';

commit;
