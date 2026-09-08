-- Retain a late first proof for review without accepting an expired deal or
-- granting provisional access. Applied activation/evidence migrations stay intact.
begin;

create or replace function public.phase4_payment_offer_window(
  p_plan_id uuid, p_channel_id uuid, p_now timestamptz
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_plan public.pricing_plan_versions%rowtype;
  v_channel public.pricing_payment_channel_versions%rowtype;
  v_revision public.pricing_revisions%rowtype;
  v_from timestamptz;
  v_until timestamptz;
  v_next timestamptz;
begin
  select * into v_plan from public.pricing_plan_versions where id=p_plan_id;
  select * into v_revision from public.pricing_revisions where id=v_plan.revision_id;
  select * into v_channel from public.pricing_payment_channel_versions where id=p_channel_id;
  if v_plan.id is null or v_revision.id is null or v_channel.id is null
    or v_revision.state not in ('published','scheduled') or v_revision.effective_at > p_now
    or not v_plan.visible or not v_plan.checkout_enabled
    or v_channel.revision_id <> v_revision.id or not v_channel.enabled or not v_channel.visible
    or (v_channel.qr_asset_id is null and v_channel.qr_public_path is null)
    or (v_channel.plan_version_id is not null and v_channel.plan_version_id <> v_plan.id)
    or (v_channel.amount_centavos is not null and v_channel.amount_centavos <> v_plan.price_centavos)
  then return null; end if;
  select r.effective_at into v_next from public.pricing_revisions r
  where r.state in ('published','scheduled')
    and (r.effective_at,r.revision_number) > (v_revision.effective_at,v_revision.revision_number)
  order by r.effective_at,r.revision_number limit 1;
  v_from := greatest(v_revision.effective_at,
    coalesce(v_plan.display_starts_at,'-infinity'::timestamptz),
    coalesce(v_plan.checkout_starts_at,'-infinity'::timestamptz));
  v_until := least(coalesce(v_next,'infinity'::timestamptz),
    coalesce(v_plan.display_ends_at,'infinity'::timestamptz),
    coalesce(v_plan.checkout_ends_at,'infinity'::timestamptz));
  -- A revision superseded before opening (including equal-time precedence)
  -- never establishes an old offer. Future IDs cannot open checkout early.
  if v_from > p_now or v_until <= v_from then return null; end if;
  return jsonb_build_object('validFrom',case when isfinite(v_from) then v_from end,
    'validUntil',case when isfinite(v_until) then v_until end,
    'late',p_now >= v_until,'revisionId',v_revision.id);
end;
$$;

create or replace function public.phase4_payment_offer_review(p public.payment_requests)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce((select jsonb_build_object(
    'lateOfferProof',true,
    'offerReviewRequired',p.status in ('pending','needs_information'),
    'offerReviewReason','late_first_submission',
    'offerValidFrom',h.metadata->'offerReview'->'validFrom',
    'offerValidUntil',h.metadata->'offerReview'->'validUntil'
  ) from public.payment_request_history h where h.payment_request_id=p.id
    and h.action='submitted'
    and h.metadata->'offerReview'->>'reason'='late_first_submission'
  order by h.occurred_at,h.id limit 1),'{}'::jsonb);
$$;

-- Use guarded source substitutions to retain the already-reviewed activation,
-- renewal, evidence and invalidation implementation. Unexpected lineage fails.
do $late_intake$
declare
  v_definition text;
  v_original text;
  v_before text;
  v_after text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)'::regprocedure);
  v_definition := replace(v_definition,chr(13),'');
  if position('astra-late-proof-v3-compat-v1' in v_definition)>0 then
    if pg_catalog.to_regprocedure('public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)') is null then
      raise exception 'Historical proof v4 intake is missing';
    end if;
    return;
  end if;
  if pg_catalog.to_regprocedure('public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)') is not null
    and position('astra-late-proof-intake-v1' in pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)')))=0 then
    raise exception 'Payment v4 function already exists; review migration lineage';
  end if;
  v_original := v_definition;
  v_definition := replace(v_definition,'  v_prior_provisional boolean := false;',
    '  v_prior_provisional boolean := false;
  v_offer jsonb;
  v_late_review boolean := false; -- astra-late-proof-intake-v1');
  v_before := substring(v_definition from '  select r\.\* into v_revision[\s\S]+?  if p_proof_bucket');
  if v_before is null then raise exception 'Late proof intake pricing anchor changed'; end if;
  v_after := $new$  v_offer := public.phase4_payment_offer_window(p_plan_version_id,p_payment_channel_version_id,v_now);
  if v_offer is null then raise exception 'Selected pricing plan is not open for checkout'; end if;
  select * into v_plan from public.pricing_plan_versions where id=p_plan_version_id;
  select * into v_revision from public.pricing_revisions where id=v_plan.revision_id;
  select * into v_channel from public.pricing_payment_channel_versions where id=p_payment_channel_version_id;
  v_late_review := (v_offer->>'late')::boolean;

  if p_proof_bucket$new$;
  v_definition := replace(v_definition,v_before,v_after);
  v_before := '  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(''payment:'' || p_user_id::text, 0)
  );';
  if position(v_before in v_definition)=0 then raise exception 'Late proof lock anchor changed'; end if;
  v_definition := replace(v_definition,v_before,v_before || $new$
  -- Serialize the held-hash check across owners and channel selections.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payment-proof:' || lower(p_proof_sha256),0)
  );
$new$);
  v_before := '  if exists (
    select 1
    from public.payment_requests r
    where r.user_id = p_user_id
      and r.status in (''pending'', ''needs_information'')';
  if position(v_before in v_definition)=0 then raise exception 'Late proof intake duplicate anchor changed'; end if;
  v_definition := replace(v_definition,v_before,$new$  if exists (
    select 1 from public.payment_requests r
    where r.proof_sha256=lower(p_proof_sha256)
      and (v_late_review or public.phase4_payment_offer_review(r)->>'lateOfferProof'='true')
  ) then raise exception 'This payment proof has already been submitted'; end if;
$new$ || v_before);
  v_definition := replace(v_definition,'    user_id, plan_code, trusted_amount_php, payment_method, payment_date,',
    '    status, user_id, plan_code, trusted_amount_php, payment_method, payment_date,');
  v_definition := replace(v_definition,'    p_user_id, v_plan.plan_code, v_plan.price_centavos / 100.0,',
    '    case when v_late_review then ''needs_information'' else ''pending'' end,
    p_user_id, v_plan.plan_code, v_plan.price_centavos / 100.0,');
  v_definition := replace(v_definition,'case when v_prior_provisional then null else',
    'case when v_prior_provisional or v_late_review then null else');
  v_definition := replace(v_definition,'    ''submitted'',
    null,
    ''pending'',
    ''Student submitted payment proof for manual verification.'',',
    '    ''submitted'',
    null,
    v_request.status,
    case when v_late_review then ''Late payment proof retained for offer review; no provisional or paid access granted.''
      else ''Student submitted payment proof for manual verification.'' end,');
  v_definition := replace(v_definition,'      ''amountCentavos'', v_plan.price_centavos,',
    '      ''amountCentavos'', v_plan.price_centavos,
      ''offerReview'',case when v_late_review then v_offer || jsonb_build_object(
        ''reason'',''late_first_submission'',''receivedAt'',v_now,
        ''activeRevisionId'',(select r.id from public.pricing_revisions r
          where r.state in (''published'',''scheduled'') and r.effective_at<=v_now
          order by r.effective_at desc,r.revision_number desc limit 1)) else null end,');
  if position('status, user_id' in v_definition)=0 or position('v_request.status,' in v_definition)=0
    or position('''offerReview'',case' in v_definition)=0 then raise exception 'Late proof intake insert anchor changed'; end if;
  -- Explicit protocol boundary: old Workers keep v3 current-only behavior.
  -- v4 deliberately retains the existing deterministic request/storage keys.
  execute replace(v_definition,'phase4_create_payment_request_v3(', 'phase4_create_payment_request_v4(');
  v_before := '  if v_request.id is not null then';
  if position(v_before in v_original)=0 then raise exception 'Payment v3 replay anchor changed'; end if;
  v_original := replace(v_original,v_before,v_before || $new$
    -- astra-late-proof-v3-compat-v1: an old client must not display a
    -- review-only hold as the unconditional provisional-success screen.
    if public.phase4_payment_offer_review(v_request)->>'lateOfferProof'='true' then
      raise exception 'PAYMENT_PROOF_SAVED_FOR_REVIEW: This payment proof has already been submitted and is saved for historical offer review';
    end if;
$new$);
  v_before := '  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(''payment:'' || p_user_id::text, 0)
  );';
  if position(v_before in v_original)=0 then raise exception 'Payment v3 hash lock anchor changed'; end if;
  v_original := replace(v_original,v_before,v_before || $new$
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payment-proof:' || lower(p_proof_sha256),0)
  );
  if exists (select 1 from public.payment_requests r where r.proof_sha256=lower(p_proof_sha256)
    and public.phase4_payment_offer_review(r)->>'lateOfferProof'='true') then
    raise exception 'PAYMENT_PROOF_SAVED_FOR_REVIEW: This payment proof has already been submitted and is saved for historical offer review';
  end if;
$new$);
  execute v_original;
end;
$late_intake$;

-- Legacy fields remain supported, but a held proof cannot acquire provisional
-- access by changing evidence mode, reference, channel or owner before cutover.
do $legacy_hold_guard$
declare v_definition text; v_before text;
begin
  v_definition := replace(pg_catalog.pg_get_functiondef(
    'public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)'::regprocedure),chr(13),'');
  if position('astra-legacy-held-proof-v1' in v_definition)>0 then return; end if;
  v_before := '  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(''payment:'' || p_user_id::text, 0)
  );';
  if position(v_before in v_definition)=0 then raise exception 'Legacy held proof lock anchor changed'; end if;
  execute replace(v_definition,v_before,v_before || $new$
  -- astra-legacy-held-proof-v1
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payment-proof:' || lower(p_proof_sha256),0)
  );
  if exists (select 1 from public.payment_requests r where r.proof_sha256=lower(p_proof_sha256)
    and public.phase4_payment_offer_review(r)->>'lateOfferProof'='true') then
    raise exception 'PAYMENT_PROOF_SAVED_FOR_REVIEW: This payment proof has already been submitted and is saved for historical offer review';
  end if;
$new$);
end;
$legacy_hold_guard$;

do $late_projection$
declare v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.phase4_effective_payment_terms(public.payment_requests)'::regprocedure);
  v_definition := replace(v_definition,chr(13),'');
  if position('phase4_payment_offer_review' in v_definition)>0 then return; end if;
  if position('  );' in v_definition)=0 then raise exception 'Late proof projection anchor changed'; end if;
  execute replace(v_definition,'  );','  ) || public.phase4_payment_offer_review(p);');
end;
$late_projection$;

do $late_approval$
declare v_definition text; v_before text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text)'::regprocedure);
  v_definition := replace(v_definition,chr(13),'');
  if position('astra-late-proof-approval-v1' in v_definition)>0 then return; end if;
  v_definition := replace(v_definition,'  v_term_start timestamptz;',
    '  v_term_start timestamptz;
  v_offer_review jsonb; -- astra-late-proof-approval-v1
  v_offer_window jsonb;
  v_offer_disposition text;');
  v_before := '    return v_existing_action.result || jsonb_build_object(''replayed'', true);';
  if position(v_before in v_definition)=0 then raise exception 'Late approval replay anchor changed'; end if;
  v_definition := replace(v_definition,v_before,$new$    if v_existing_action.result->>'offerReviewDisposition'
       is distinct from nullif(p_payload->>'offerReviewDisposition','') then
      raise exception 'Request key conflicts with the original payment decision';
    end if;
    if v_existing_action.result->>'offerReviewDisposition'='honor_verified_offer'
      and ((v_existing_action.result->>'verifiedPaidAt')::timestamptz
        is distinct from nullif(p_payload->>'verifiedPaidAt','')::timestamptz
        or v_existing_action.result->'payment'->>'review_reason' is distinct from btrim(p_reason)) then
      raise exception 'Request key conflicts with the original payment decision';
    end if;
$new$ || v_before);
  v_before := '  v_previous_payment := to_jsonb(v_payment) - array[';
  if position(v_before in v_definition)=0 then raise exception 'Late approval guard anchor changed'; end if;
  v_definition := replace(v_definition,v_before,$new$  v_offer_review := public.phase4_payment_offer_review(v_payment);
  v_offer_disposition := nullif(p_payload->>'offerReviewDisposition','');
  if v_offer_disposition is not null and (v_status<>'approved'
      or v_offer_review->>'lateOfferProof' is distinct from 'true'
      or v_offer_disposition<>'honor_verified_offer') then
    raise exception 'Invalid historical offer review disposition';
  end if;
  if v_status='approved' and v_offer_review->>'lateOfferProof'='true' then
    if v_offer_disposition is distinct from 'honor_verified_offer' then
      raise exception 'Historical offer review requires an explicit verified disposition';
    end if;
    if nullif(p_payload->>'verifiedPaidAt','') is null then
      raise exception 'Historical offer review requires verifiedPaidAt from the actual proof';
    end if;
    v_offer_window := public.phase4_payment_offer_window(v_payment.pricing_plan_version_id,
      v_payment.pricing_payment_channel_version_id,v_now);
    if v_offer_window is null
      or v_offer_window->'validFrom' is distinct from v_offer_review->'offerValidFrom'
      or v_offer_window->'validUntil' is distinct from v_offer_review->'offerValidUntil'
      or v_offer_window->>'validUntil' is null then
      raise exception 'Historical offer evidence changed; keep the proof under review';
    end if;
  end if;
$new$ || v_before);
  v_before := '    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(''subscription:'' || v_payment.user_id::text, 0)
    );';
  if position(v_before in v_definition)=0 then raise exception 'Late approval timestamp anchor changed'; end if;
  v_definition := replace(v_definition,v_before,$new$    if v_offer_review->>'lateOfferProof'='true' and (
      v_paid_at is null
      or (v_offer_window->>'validFrom' is not null and v_paid_at<(v_offer_window->>'validFrom')::timestamptz)
      or v_paid_at >= (v_offer_window->>'validUntil')::timestamptz
    ) then raise exception 'Verified payment time is outside the historical offer window'; end if;

$new$ || v_before);
  v_definition := replace(v_definition,'      ''verifiedPaidAt'', v_payment.paid_at,',
    '      ''offerReviewDisposition'', v_offer_disposition,
      ''verifiedPaidAt'', v_payment.paid_at,');
  v_definition := replace(v_definition,'    ''action'', ''payment_review'',',
    '    ''action'', ''payment_review'',
    ''offerReviewDisposition'', v_offer_disposition,');
  execute v_definition;
end;
$late_approval$;

revoke all on function public.phase4_payment_offer_window(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.phase4_payment_offer_review(public.payment_requests) from public,anon,authenticated;
grant execute on function public.phase4_payment_offer_window(uuid,uuid,timestamptz) to service_role;
grant execute on function public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text) to service_role;
grant execute on function public.phase4_payment_offer_review(public.payment_requests) to service_role;
commit;
