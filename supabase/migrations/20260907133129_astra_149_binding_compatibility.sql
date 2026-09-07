-- Preserve already-open 149 checkout bindings across the authorized term-only
-- Astra publication. This is NOT historical-price grace or proof review intake.
-- Original pricing/payment evidence stays immutable; the 720-hour activation
-- amendment is projected separately and recorded in each new submission audit.
-- First production publication requires two phases: install the compatible
-- functions before publishing the Astra clone, then drain pre-installation
-- queries/open transactions before an atomic publication plus binding assertion.
-- A single combined install/publication is not sufficient for an already
-- running old intake body that waits for the publication transaction to commit.
-- Existing staging publication may receive this bridge directly after its
-- active test journeys finish; that does not prove first-publication ordering.
-- Later historical-proof v4/window SQL must be reconciled with this authorized
-- source-binding interval before integration; its old clone-time cutoff is not
-- valid for payments collected through this bridge. No grace is introduced here.
begin;

create or replace function public.phase4_astra_149_binding_compatibility(p_now timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_live public.pricing_revisions%rowtype;
  v_source public.pricing_revisions%rowtype;
  v_old public.pricing_plan_versions%rowtype;
  v_new public.pricing_plan_versions%rowtype;
  v_left jsonb;
  v_right jsonb;
  v_until timestamptz;
begin
  if p_now is null or not pg_catalog.isfinite(p_now)
     or p_now < '2026-09-01 00:00:00+08'::timestamptz
     or p_now >= '2026-09-14 00:00:00+08'::timestamptz then return null; end if;
  select r.* into v_live from public.pricing_revisions r
  where r.state in ('published','scheduled') and r.effective_at <= p_now
  order by r.effective_at desc,r.revision_number desc limit 1;
  if v_live.id is distinct from 'a9070000-0000-4000-8000-000000000149'::uuid
     or v_live.state is distinct from 'published'
     or v_live.rollback_of_revision_id is not null then return null; end if;
  select r.* into v_source from public.pricing_revisions r where r.id=v_live.based_on_revision_id;
  if v_source.id is null or v_source.state is distinct from 'published'
     or v_source.effective_at is null or v_source.effective_at > p_now
     or (v_source.effective_at,v_source.revision_number) >= (v_live.effective_at,v_live.revision_number)
     or v_source.page_config is distinct from v_live.page_config
     or v_source.schema_version is distinct from v_live.schema_version
     or exists (select 1 from public.pricing_revisions r
       where r.state in ('published','scheduled')
         and (r.effective_at,r.revision_number) > (v_source.effective_at,v_source.revision_number)
         and (r.effective_at,r.revision_number) < (v_live.effective_at,v_live.revision_number))
  then return null; end if;

  select p.* into v_old from public.pricing_plan_versions p
  where p.revision_id=v_source.id and p.plan_code='early_access_beta';
  select p.* into v_new from public.pricing_plan_versions p
  where p.revision_id=v_live.id and p.plan_code='early_access_beta';
  if v_old.id is null or v_new.id is null
     or v_old.price_centavos is distinct from 14900 or v_new.price_centavos is distinct from 14900
     or v_old.currency is distinct from 'PHP' or v_new.currency is distinct from 'PHP'
     or v_old.entitlement_mode is distinct from 'fixed_end' or v_old.fixed_ends_at is null
     or v_new.entitlement_mode is distinct from 'rolling_days'
     or v_new.duration_days is distinct from 30 or v_new.fixed_ends_at is not null
     or not v_old.visible or not v_old.checkout_enabled
     or (v_old.display_starts_at is not null and p_now < v_old.display_starts_at)
     or (v_old.display_ends_at is not null and p_now >= v_old.display_ends_at)
     or (v_old.checkout_starts_at is not null and p_now < v_old.checkout_starts_at)
     or (v_old.checkout_ends_at is not null and p_now >= v_old.checkout_ends_at)
  then return null; end if;
  -- The source projection must not advertise another open plan whose old IDs
  -- this narrow bridge intentionally does not admit.
  if exists (select 1 from public.pricing_plan_versions p
    where p.revision_id=v_source.id and p.id<>v_old.id and p.visible and p.checkout_enabled
      and (p.display_starts_at is null or p_now>=p.display_starts_at)
      and (p.display_ends_at is null or p_now<p.display_ends_at)
      and (p.checkout_starts_at is null or p_now>=p.checkout_starts_at)
      and (p.checkout_ends_at is null or p_now<p.checkout_ends_at)) then return null; end if;

  -- Compare the WHOLE plan collection. Only this precise 149 activation
  -- amendment may differ; another same-price plan/publication is not an alias.
  select jsonb_agg((to_jsonb(p)-array['id','revision_id','created_at']) ||
    case when p.id=v_old.id then jsonb_build_object('duration_days',30,
      'entitlement_mode','rolling_days','fixed_ends_at',null) else '{}'::jsonb end
    order by p.plan_code) into v_left
  from public.pricing_plan_versions p where p.revision_id=v_source.id;
  select jsonb_agg(to_jsonb(p)-array['id','revision_id','created_at'] order by p.plan_code)
    into v_right from public.pricing_plan_versions p where p.revision_id=v_live.id;
  if v_left is distinct from v_right then return null; end if;

  -- Channel IDs are freshly generated by cloning. Compare their full content
  -- with plan associations represented by immutable stable code (NULL remains
  -- distinct from a plan-specific channel). Counts/multiplicity are preserved.
  select jsonb_agg(value order by value::text) into v_left from (
    select (to_jsonb(c)-array['id','revision_id','plan_version_id','created_at']) ||
      jsonb_build_object('associated_plan_code',p.plan_code) as value
    from public.pricing_payment_channel_versions c
    left join public.pricing_plan_versions p on p.id=c.plan_version_id and p.revision_id=c.revision_id
    where c.revision_id=v_source.id
  ) channels;
  select jsonb_agg(value order by value::text) into v_right from (
    select (to_jsonb(c)-array['id','revision_id','plan_version_id','created_at']) ||
      jsonb_build_object('associated_plan_code',p.plan_code) as value
    from public.pricing_payment_channel_versions c
    left join public.pricing_plan_versions p on p.id=c.plan_version_id and p.revision_id=c.revision_id
    where c.revision_id=v_live.id
  ) channels;
  if v_left is null or v_left is distinct from v_right
     or exists (select 1 from public.pricing_payment_channel_versions c
       where c.revision_id in (v_source.id,v_live.id) and c.plan_version_id is not null
         and not exists (select 1 from public.pricing_plan_versions p
           where p.id=c.plan_version_id and p.revision_id=c.revision_id))
     or not exists (select 1 from public.pricing_payment_channel_versions c
       where c.revision_id=v_source.id and c.enabled and c.visible
         and (c.plan_version_id is null or c.plan_version_id=v_old.id)
         and (c.amount_centavos is null or c.amount_centavos=14900)
         and (c.qr_asset_id is not null or c.qr_public_path is not null))
  then return null; end if;

  -- Retain the publication's hash as provenance. Do not recompute a historical
  -- JSON/timestamptz hash in the caller's timezone; equality above compares the
  -- actual immutable rows and associations in the same database snapshot.
  if v_live.content_hash is null then return null; end if;
  v_until := least('2026-09-14 00:00:00+08'::timestamptz,
    coalesce(v_old.display_ends_at,'infinity'::timestamptz),
    coalesce(v_old.checkout_ends_at,'infinity'::timestamptz),
    coalesce((select min(r.effective_at) from public.pricing_revisions r
      where r.state in ('published','scheduled') and r.effective_at>p_now),'infinity'::timestamptz));
  return jsonb_build_object('contract','astra-149-term-only-binding-v1',
    'sourceRevisionId',v_source.id,'sourcePlanVersionId',v_old.id,
    'effectiveTermsRevisionId',v_live.id,'effectivePlanVersionId',v_new.id,
    'effectiveFrom',v_live.effective_at,'validUntil',v_until,
    'durationDays',30,'entitlementMode','rolling_days','activationHours',720,
    'sourceContentHash',v_source.content_hash,'effectiveTermsContentHash',v_live.content_hash);
end;
$$;
revoke all on function public.phase4_astra_149_binding_compatibility(timestamptz)
  from public,anon,authenticated;
grant execute on function public.phase4_astra_149_binding_compatibility(timestamptz) to service_role;

create or replace function public.phase4_pricing_snapshot()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_revision_id uuid;
  v_compat jsonb;
  v_snapshot jsonb;
  v_plans jsonb;
begin
  v_compat := public.phase4_astra_149_binding_compatibility(v_now);
  if v_compat is not null then
    v_snapshot := public.phase4_pricing_revision_snapshot((v_compat->>'sourceRevisionId')::uuid,true,v_now);
    select jsonb_agg(case when p->>'versionId'=v_compat->>'sourcePlanVersionId'
      then p || jsonb_build_object('durationDays',30,'entitlementMode','rolling_days',
        'fixedEndsAt',null,'fixedEntitlementEndsAt',null,'effectiveTerms',v_compat)
      else p end order by ord) into v_plans
    from jsonb_array_elements(v_snapshot->'plans') with ordinality items(p,ord);
    -- This is explicitly an effective checkout projection, NOT the original
    -- immutable revision content. Never reuse its contentHash for altered JSON.
    return jsonb_set(jsonb_set(v_snapshot,'{plans}',v_plans),'{config,plans}',v_plans)
      || jsonb_build_object('contentHash',null,'bindingCompatibility',v_compat);
  end if;
  select r.id into v_revision_id from public.pricing_revisions r
  where r.state in ('published','scheduled') and r.effective_at<=v_now
  order by r.effective_at desc,r.revision_number desc limit 1;
  if v_revision_id is null then
    return jsonb_build_object('revisionId',null,'serverNow',v_now,'timezone','Asia/Manila',
      'page','{}'::jsonb,'plans','[]'::jsonb,'paymentMethods','[]'::jsonb,'faqs','[]'::jsonb);
  end if;
  return public.phase4_pricing_revision_snapshot(v_revision_id,true,v_now);
end;
$$;
revoke all on function public.phase4_pricing_snapshot() from public,anon,authenticated;
grant execute on function public.phase4_pricing_snapshot() to service_role;

-- Preserve each existing RPC's authentication, proof validation, deduplication,
-- replay-before-current-offer behavior, locks, notifications and entitlement
-- lifecycle. Only the exact source binding receives an additional resolution.
do $intake$
declare
  v_signature text;
  v_definition text;
  v_anchor text;
  v_history text;
begin
  foreach v_signature in array array[
    'public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)',
    'public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)'
  ] loop
    v_definition := replace(pg_catalog.pg_get_functiondef(v_signature::regprocedure),chr(13),'');
    if position('astra-149-binding-intake-v1' in v_definition)>0 then continue; end if;
    if position('phase4_payment_offer_window' in v_definition)>0
       or position('  v_prior_provisional boolean := false;' in v_definition)=0 then
      raise exception 'Unexpected payment intake lineage for the 149 binding bridge';
    end if;
    v_definition := replace(v_definition,'  v_prior_provisional boolean := false;',
      '  v_prior_provisional boolean := false;
  v_binding_compat jsonb; -- astra-149-binding-intake-v1');
    v_anchor := '  select p.* into v_plan
  from public.pricing_plan_versions p';
    if position(v_anchor in v_definition)=0 then raise exception 'Payment plan lookup anchor changed'; end if;
    v_definition := replace(v_definition,v_anchor,$new$  v_binding_compat := public.phase4_astra_149_binding_compatibility(v_now);
  if p_plan_version_id is not distinct from (v_binding_compat->>'sourcePlanVersionId')::uuid then
    select r.* into v_revision from public.pricing_revisions r
    where r.id=(v_binding_compat->>'sourceRevisionId')::uuid;
  else
    v_binding_compat := null;
  end if;
$new$ || v_anchor);
    v_history := substring(v_definition from '  insert into public\.payment_request_history[\s\S]+?  insert into public\.outbound_notifications');
    v_anchor := '      ''amountCentavos'', v_plan.price_centavos,';
    if v_history is null or position(v_anchor in v_history)=0 then
      raise exception 'Payment submission audit anchor changed';
    end if;
    v_definition := replace(v_definition,v_history,replace(v_history,v_anchor,v_anchor || '
      ''bindingCompatibility'',v_binding_compat,'));
    -- v3 already uses the activation projection; bring supported v2 responses
    -- into agreement without altering its original captured/payment evidence.
    if position('phase4_create_payment_request_v2(' in v_definition)>0 then
      v_definition := replace(v_definition,'''replayed'', true
    );','''replayed'', true
    ) || public.phase4_effective_payment_terms(v_request);');
      v_definition := replace(v_definition,'''replayed'', false
  );','''replayed'', false
  ) || public.phase4_effective_payment_terms(v_request);');
    end if;
    execute v_definition;
  end loop;
end;
$intake$;

revoke all on function public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)
  from public,anon,authenticated;
revoke all on function public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)
  from public,anon,authenticated;
grant execute on function public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text) to service_role;
grant execute on function public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text) to service_role;

comment on function public.phase4_astra_149_binding_compatibility(timestamptz) is
  'Service-only exact Astra direct-source 149 binding equivalence; never historical price grace. Ends no later than September 14 2026 00:00 Asia/Manila.';
commit;
