-- Forward reconciliation only. The applied bridge and historical-proof SQL
-- remain immutable. Install BOTH before this migration in either order.
-- Source IDs were publicly retained by the exact term-only Astra bridge until
-- the first continuous public-binding interval, not merely clone time.
-- No customer rows, captured evidence, prior review windows or grants change.
begin;

do $required_lineage$
begin
  if pg_catalog.to_regprocedure('public.phase4_astra_149_binding_compatibility(timestamptz)') is null
    or pg_catalog.to_regprocedure('public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)') is null then
    raise exception 'Install the reviewed 149 binding bridge and historical-proof v4 before reconciliation';
  end if;
  if (select provolatile from pg_catalog.pg_proc where oid='public.phase4_astra_149_binding_compatibility(timestamptz)'::regprocedure)
       is distinct from 's'::"char"
    or (select provolatile from pg_catalog.pg_proc where oid='public.phase4_pricing_snapshot()'::regprocedure)
       is distinct from 's'::"char"
    or position('astra-149-term-only-binding-v1' in pg_catalog.pg_get_functiondef(
      'public.phase4_astra_149_binding_compatibility(timestamptz)'::regprocedure))=0 then
    raise exception 'The reviewed stable 149 binding bridge is required';
  end if;
end;
$required_lineage$;

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
  v_next_id uuid;
  v_binding jsonb;
  v_other_plan_opens timestamptz;
begin
  if p_now is null or not pg_catalog.isfinite(p_now) then return null; end if;
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
  select r.effective_at,r.id into v_next,v_next_id from public.pricing_revisions r
  where r.state in ('published','scheduled')
    and (r.effective_at,r.revision_number) > (v_revision.effective_at,v_revision.revision_number)
  order by r.effective_at,r.revision_number limit 1;
  v_from := greatest(v_revision.effective_at,
    coalesce(v_plan.display_starts_at,'-infinity'::timestamptz),
    coalesce(v_plan.checkout_starts_at,'-infinity'::timestamptz));
  v_until := least(coalesce(v_next,'infinity'::timestamptz),
    coalesce(v_plan.display_ends_at,'infinity'::timestamptz),
    coalesce(v_plan.checkout_ends_at,'infinity'::timestamptz));

  -- astra-late-149-binding-window-v1: evaluate the existing exact-equivalence
  -- helper AT the internal clone publication, even when review is after cutoff.
  -- It checks direct provenance, complete plan/channel multisets, QR, beneficiary,
  -- association, authored copy and bounds. No other same-price revision aliases.
  if v_next_id='a9070000-0000-4000-8000-000000000149'::uuid and v_next<=p_now then
    v_binding := public.phase4_astra_149_binding_compatibility(v_next);
    if v_binding->>'sourceRevisionId'=v_revision.id::text
      and v_binding->>'sourcePlanVersionId'=v_plan.id::text
      and v_binding->>'effectiveTermsRevisionId'=v_next_id::text
      and v_binding->>'validUntil' is not null then
      v_until := least((v_binding->>'validUntil')::timestamptz,
        '2026-09-14 00:00:00+08'::timestamptz,
        coalesce(v_plan.display_ends_at,'infinity'::timestamptz),
        coalesce(v_plan.checkout_ends_at,'infinity'::timestamptz));
      -- The original bridge also disappears when another unchanged plan first
      -- becomes visible AND checkout-enabled within BOTH authored time windows.
      -- Its helper at clone time cannot predict this time-varying predicate.
      -- Cap the FIRST continuous interval at that first nonempty overlap.
      select min(greatest(period.opens_at,v_next)) into v_other_plan_opens
      from (
        select greatest(coalesce(p.display_starts_at,'-infinity'::timestamptz),
                        coalesce(p.checkout_starts_at,'-infinity'::timestamptz)) as opens_at,
               least(coalesce(p.display_ends_at,'infinity'::timestamptz),
                     coalesce(p.checkout_ends_at,'infinity'::timestamptz)) as closes_at
        from public.pricing_plan_versions p
        where p.revision_id=v_revision.id and p.id<>v_plan.id
          and p.visible and p.checkout_enabled
      ) period
      where period.opens_at < period.closes_at
        and period.closes_at > v_next and period.opens_at < v_until;
      v_until := least(v_until,coalesce(v_other_plan_opens,'infinity'::timestamptz));
      -- Preserve the helper's original upper-bound provenance separately. A
      -- later reappearance of source IDs is not merged into this interval: v4
      -- keeps such proofs under review until disjoint intervals are supported.
      v_binding := v_binding || jsonb_build_object(
        'sourceBindingInterval','first_continuous',
        'sourceBindingValidUntil',v_until);
    else
      v_binding := null;
    end if;
  end if;
  if v_from > p_now or v_until <= v_from then return null; end if;
  return jsonb_build_object('validFrom',case when isfinite(v_from) then v_from end,
    'validUntil',case when isfinite(v_until) then v_until end,
    'late',p_now >= v_until,'revisionId',v_revision.id)
    || case when v_binding is not null then jsonb_build_object('bindingCompatibility',v_binding)
      else '{}'::jsonb end;
end;
$$;

do $v4_lineage$
declare v_definition text; v_anchor text; v_history text;
begin
  v_definition := replace(pg_catalog.pg_get_functiondef(
    'public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)'::regprocedure),chr(13),'');
  if position('astra-late-149-binding-v4-v1' in v_definition)>0 then return; end if;
  if position('astra-late-proof-intake-v1' in v_definition)=0
    or position('payment-proof:' in v_definition)=0
    or position('public.phase4_payment_offer_review(r)' in v_definition)=0 then
    raise exception 'Unexpected historical-proof v4 lineage';
  end if;
  -- Bridge-before-late carries this variable/audit key but loses its resolution
  -- when old v4 replaces the pricing block. Late-before-bridge has neither.
  if position('  v_binding_compat jsonb;' in v_definition)=0 then
    v_anchor := '  v_offer jsonb;';
    if position(v_anchor in v_definition)=0 then raise exception 'Historical-proof variable anchor changed'; end if;
    v_definition := replace(v_definition,v_anchor,v_anchor || '
  v_binding_compat jsonb;');
  end if;
  v_anchor := '  v_late_review := (v_offer->>''late'')::boolean;';
  if position(v_anchor in v_definition)=0 then raise exception 'Historical-proof offer anchor changed'; end if;
  v_definition := replace(v_definition,v_anchor,v_anchor || '
  v_binding_compat := v_offer->''bindingCompatibility''; -- astra-late-149-binding-v4-v1');
  v_history := substring(v_definition from '  insert into public\.payment_request_history[\s\S]+?  insert into public\.outbound_notifications');
  v_anchor := '      ''amountCentavos'', v_plan.price_centavos,';
  if v_history is null or position(v_anchor in v_history)=0 then
    raise exception 'Historical-proof submission audit anchor changed';
  end if;
  if position('''bindingCompatibility'',v_binding_compat,' in v_history)=0 then
    v_definition := replace(v_definition,v_history,replace(v_history,v_anchor,v_anchor || '
      ''bindingCompatibility'',v_binding_compat,'));
  end if;
  execute v_definition;
end;
$v4_lineage$;

revoke all on function public.phase4_payment_offer_window(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.phase4_payment_offer_window(uuid,uuid,timestamptz) to service_role;
grant execute on function public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text) to service_role;
commit;
