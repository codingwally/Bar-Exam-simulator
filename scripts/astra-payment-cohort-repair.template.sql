-- OPERATOR-ONLY PREPARATION. This template is not a migration or an API.
-- Substitute the frozen private snapshot and its SHA256 only in a private copy.
-- Set astra.payment_repair_actor to a confirmed Founder UUID before running.
-- Apply the generic payment_term_repair_journal migration separately first.
-- This file deliberately ends in ROLLBACK. Review the dry-run summary before
-- explicitly changing only that final transaction boundary to COMMIT.
begin;
set local time zone 'UTC';
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Read-only structural preflight: no DDL is permitted in this private script.
do $astra_journal_guard$
declare
  v_table regclass := to_regclass('public.payment_term_repair_journal');
  v_columns text;
begin
  if v_table is null then raise exception 'ASTRA_REPAIR_JOURNAL_MIGRATION_REQUIRED'; end if;
  select string_agg(a.attname || ':' || format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text,',' order by a.attnum)
    into v_columns from pg_attribute a where a.attrelid=v_table and a.attnum>0 and not a.attisdropped;
  if v_columns is distinct from 'repair_key:text:true,payment_request_id:uuid:true,subscription_id:uuid:true,user_id:uuid:true,actor_user_id:uuid:true,reason:text:true,evidence_sha256:text:true,before_sha256:text:true,after_sha256:text:true,before_state:jsonb:true,after_state:jsonb:true,original_activation_at:timestamp with time zone:true,purchased_ends_at:timestamp with time zone:true,original_overall_ends_at:timestamp with time zone:true,corrected_overall_ends_at:timestamp with time zone:true,direction:text:true,applied_at:timestamp with time zone:true'
     or obj_description(v_table,'pg_class') is distinct from 'Astra payment term repair journal v1. Private operator evidence; no public API or policies; before/after hashes and causal recovery guards.'
     or not exists(select 1 from pg_class c where c.oid=v_table and c.relkind='r' and c.relrowsecurity)
     or exists(select 1 from pg_policy p where p.polrelid=v_table)
     or has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role',v_table,'UPDATE,DELETE')
     or not has_table_privilege('service_role',v_table,'SELECT')
     or not has_table_privilege('service_role',v_table,'INSERT')
     or (select count(*) from pg_constraint c where c.conrelid=v_table and c.contype='c' and c.convalidated)<>6
     or not exists(select 1 from pg_constraint c where c.conrelid=v_table and c.contype='p' and c.conkey=array[1,2]::smallint[])
     or not exists(select 1 from pg_constraint c where c.conrelid=v_table and c.contype='u' and c.conkey=array[1,3]::smallint[]) then
    raise exception 'ASTRA_REPAIR_JOURNAL_SCHEMA_OR_ACCESS_CHANGED';
  end if;
end;
$astra_journal_guard$;

do $astra_repair$
declare
  v_snapshot_text text := $astra_snapshot$__ASTRA_COHORT_SNAPSHOT_JSON__$astra_snapshot$;
  v_snapshot jsonb := v_snapshot_text::jsonb;
  v_evidence_sha text := '__ASTRA_COHORT_SNAPSHOT_SHA256__';
  v_key constant text := 'astra_20260907_paid149_exact720_v1';
  v_reason constant text := 'Correct paid term to original approval plus 720 hours while preserving any longer existing access.';
  v_actor uuid := nullif(current_setting('astra.payment_repair_actor',true),'')::uuid;
  v_now timestamptz;
  v_row jsonb;
  v_payment public.payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_expected_payment public.payment_requests%rowtype;
  v_expected_subscription public.subscriptions%rowtype;
  v_journal public.payment_term_repair_journal%rowtype;
  v_plan public.pricing_plan_versions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_ph jsonb;
  v_sh jsonb;
  v_complete_sh jsonb;
  v_anchor timestamptz;
  v_end timestamptz;
  v_overall_end timestamptz;
  v_direction text;
  v_extend integer := 0;
  v_preserve integer := 0;
  v_replayed integer := 0;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'ASTRA_REPAIR_ACTOR_REQUIRED'; end if;
  perform public.phase4_require_founder(v_actor);
  if v_evidence_sha !~ '^[a-f0-9]{64}$'
     or v_evidence_sha is distinct from encode(sha256(convert_to(v_snapshot_text,'UTF8')),'hex')
     or jsonb_typeof(v_snapshot->'rows') <> 'array'
     or jsonb_array_length(v_snapshot->'rows') <> 6
     or (select count(distinct x->>'payment_id') from jsonb_array_elements(v_snapshot->'rows') x) <> 6
     or (select count(distinct x->>'subscription_id') from jsonb_array_elements(v_snapshot->'rows') x) <> 6
     or (select count(distinct x->>'user_id') from jsonb_array_elements(v_snapshot->'rows') x) <> 6 then
    raise exception 'ASTRA_REPAIR_FROZEN_SCOPE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  -- Payment review/refund lock a payment before its subscription. Use that
  -- order for all six rows, then both subscription-manager lock families.
  perform p.id from public.payment_requests p
    where p.id in (select (x->>'payment_id')::uuid from jsonb_array_elements(v_snapshot->'rows') x)
    order by p.id for update;
  for v_row in select x from jsonb_array_elements(v_snapshot->'rows') x order by x->>'user_id' loop
    perform pg_advisory_xact_lock(hashtextextended('subscription:' || (v_row->>'user_id'),0));
    perform pg_advisory_xact_lock(hashtextextended(v_row->>'user_id',499));
  end loop;
  perform s.id from public.subscriptions s
    where s.id in (select (x->>'subscription_id')::uuid from jsonb_array_elements(v_snapshot->'rows') x)
    order by s.id for update;
  -- Also serialize with pricing publication while selecting the authorized clone.
  perform pg_advisory_xact_lock(hashtextextended('pricing-publication',0));
  select p.* into v_plan from public.pricing_plan_versions p
    join public.pricing_revisions r on r.id=p.revision_id
    where r.id='a9070000-0000-4000-8000-000000000149'::uuid
      and r.state='published' and r.effective_at<=clock_timestamp()
      and p.plan_code='early_access_beta' and p.price_centavos=14900 and p.currency='PHP'
      and p.entitlement_mode='rolling_days' and p.duration_days=30 and p.fixed_ends_at is null;
  if v_plan.id is null or (select count(*) from public.pricing_plan_versions p
    where p.revision_id=v_plan.revision_id and p.plan_code='early_access_beta') <> 1 then
    raise exception 'ASTRA_REPAIR_ROLLING149_CLONE_REQUIRED';
  end if;
  if exists(select 1 from public.payment_term_repair_journal j where j.repair_key=v_key
    and j.payment_request_id not in (select (x->>'payment_id')::uuid from jsonb_array_elements(v_snapshot->'rows') x)) then
    raise exception 'ASTRA_REPAIR_JOURNAL_SCOPE_CHANGED';
  end if;
  if (select count(*) from public.payment_term_repair_journal where repair_key=v_key) not in (0,6) then
    raise exception 'ASTRA_REPAIR_PARTIAL_JOURNAL';
  end if;
  v_now := clock_timestamp();
  for v_row in select x from jsonb_array_elements(v_snapshot->'rows') x order by x->>'payment_id' loop
    v_count := v_count+1;
    select p.* into v_payment from public.payment_requests p where p.id=(v_row->>'payment_id')::uuid;
    select s.* into v_subscription from public.subscriptions s where s.id=(v_row->>'subscription_id')::uuid;
    if v_payment.id is null or v_subscription.id is null then raise exception 'ASTRA_REPAIR_ROW_MISSING'; end if;
    select jsonb_agg(to_jsonb(h) order by h.id) into v_ph from public.payment_request_history h
      where h.payment_request_id=v_payment.id and h.action='approved';
    select jsonb_agg(to_jsonb(h) order by h.id) into v_sh from public.subscription_history h
      where h.subscription_id=v_subscription.id and h.user_id=v_payment.user_id
        and h.actor_user_id=v_payment.reviewed_by
        and h.request_key=regexp_replace((v_ph->0)->>'request_key','_payment$','_subscription');
    select jsonb_agg(to_jsonb(h) order by h.id) into v_complete_sh from public.subscription_history h
      where h.subscription_id=v_subscription.id;
    v_before := jsonb_build_object('payment',to_jsonb(v_payment),'subscription',to_jsonb(v_subscription),
      'approvalPaymentHistory',v_ph,'approvalSubscriptionHistory',v_sh,'subscriptionHistory',v_complete_sh);
    select j.* into v_journal from public.payment_term_repair_journal j
      where j.repair_key=v_key and j.payment_request_id=v_payment.id;
    if v_journal.payment_request_id is not null then
      if v_journal.evidence_sha256 is distinct from v_evidence_sha
         or v_journal.after_state is distinct from v_before
         or v_journal.after_sha256 is distinct from encode(sha256(convert_to(v_before::text,'UTF8')),'hex')
         or v_journal.before_sha256 is distinct from encode(sha256(convert_to(v_journal.before_state::text,'UTF8')),'hex') then
        raise exception 'ASTRA_REPAIR_REPLAY_STATE_CHANGED';
      end if;
      if exists(select 1 from public.payment_requests p where p.id<>v_payment.id and p.subscription_id=v_subscription.id and p.status='approved')
         or exists(select 1 from public.refund_requests r where r.payment_request_id=v_payment.id and r.status in('pending','needs_information','approved','paid')) then
        raise exception 'ASTRA_REPAIR_REPLAY_HAS_LATER_WORKFLOW';
      end if;
      v_replayed := v_replayed+1;
      if v_journal.direction='extend' then v_extend:=v_extend+1; else v_preserve:=v_preserve+1; end if;
      continue;
    end if;
    select * into v_expected_payment from jsonb_populate_record(null::public.payment_requests,v_row->'payment_before');
    select * into v_expected_subscription from jsonb_populate_record(null::public.subscriptions,v_row->'subscription_before');
    if to_jsonb(v_payment) is distinct from to_jsonb(v_expected_payment)
       or to_jsonb(v_subscription) is distinct from to_jsonb(v_expected_subscription)
       or v_ph is distinct from v_row->'approval_payment_history'
       or v_sh is distinct from v_row->'approval_subscription_history'
       or v_complete_sh is distinct from v_row->'complete_subscription_history' then
      raise exception 'ASTRA_REPAIR_FROZEN_STATE_CHANGED';
    end if;
    if v_payment.user_id is distinct from (v_row->>'user_id')::uuid
       or v_subscription.user_id is distinct from v_payment.user_id
       or v_payment.subscription_id is distinct from v_subscription.id
       or v_payment.status<>'approved' or v_payment.plan_code<>'early_access_beta'
       or v_payment.trusted_amount_php<>149 or v_payment.trusted_amount_centavos<>14900
       or v_payment.trusted_currency<>'PHP' or v_payment.payment_evidence_mode<>'proof_only'
       or v_payment.trusted_entitlement_mode<>'fixed_end' or v_payment.version<>2
       or v_payment.submitted_at<'2026-09-01 00:00:00+08'::timestamptz
       or v_payment.reviewed_at is null or v_payment.reviewed_by is null
       or v_payment.approved_activation_at is not null or v_payment.approved_entitlement_mode is not null
       or v_payment.approved_duration_days is not null or v_payment.approved_entitlement_changed is distinct from true
       or v_payment.approved_prior_subscription_state is not null or v_payment.approved_prior_expires_at is not null
       or v_payment.paid_at is not null or v_payment.paid_at_verified_by is not null
       or v_payment.paid_at_verified_at is not null or v_payment.paid_at_verification_source is not null
       or v_payment.subscriber_receipt_status<>'sent' or v_payment.subscriber_receipt_attempts<>1
       or v_subscription.status<>'active' or v_subscription.source<>'manual_payment' or v_subscription.version<>1
       or v_subscription.expires_at is distinct from '2026-10-01 23:59:59+08'::timestamptz
       or v_payment.approved_entitlement_ends_at is distinct from v_subscription.expires_at
       or jsonb_array_length(v_ph) is distinct from 1 or jsonb_array_length(v_sh) is distinct from 1
       or jsonb_array_length(v_complete_sh) is distinct from 1
       or (v_ph->0)->>'previous_status' not in('pending','needs_information')
       or (v_ph->0)->>'new_status'<>'approved' or ((v_ph->0)->>'request_key') !~ '_payment$'
       or ((v_ph->0)->>'actor_user_id')::uuid is distinct from v_payment.reviewed_by
       or (v_sh->0)->>'action'<>'activate' or (v_sh->0)->'previous_state' is distinct from '{}'::jsonb
       or (v_sh->0)->'new_state' is distinct from to_jsonb(v_subscription) then
      raise exception 'ASTRA_REPAIR_CAUSAL_SCOPE_INVALID';
    end if;
    if exists(select 1 from public.payment_requests p where p.id<>v_payment.id and p.subscription_id=v_subscription.id and p.status='approved')
       or exists(select 1 from public.refund_requests r where r.payment_request_id=v_payment.id and r.status in('pending','needs_information','approved','paid'))
       or exists(select 1 from public.subscriptions s where s.user_id=v_payment.user_id and s.id<>v_subscription.id) then
      raise exception 'ASTRA_REPAIR_OTHER_ENTITLEMENT_OR_REFUND';
    end if;
    v_anchor := v_payment.reviewed_at;
    if v_anchor is distinct from (v_row->>'original_activation_anchor')::timestamptz
       or not isfinite(v_anchor) then raise exception 'ASTRA_REPAIR_ANCHOR_CHANGED'; end if;
    v_end := public.phase4_exact_payment_term_end(v_anchor,30);
    v_overall_end := greatest(v_subscription.expires_at,v_end);
    v_direction := case when v_end>v_subscription.expires_at then 'extend' else 'preserve_longer' end;
    if v_end is distinct from (v_row->>'corrected_purchased_end')::timestamptz
       or v_direction is distinct from v_row->>'proposed_direction'
       or v_end=v_subscription.expires_at then raise exception 'ASTRA_REPAIR_EXPECTED_DIRECTION_CHANGED'; end if;
    update public.payment_requests set approved_activation_at=v_anchor,
      approved_entitlement_starts_at=v_anchor,approved_entitlement_ends_at=v_end,
      approved_entitlement_mode='rolling_days',approved_duration_days=30,
      updated_at=v_now,version=version+1 where id=v_payment.id returning * into v_payment;
    -- Keep the historical overall/provisional start; actual paid activation and
    -- the exact purchased segment are recorded separately on the payment.
    update public.subscriptions set expires_at=v_overall_end,
      pricing_revision_id=v_plan.revision_id,pricing_plan_version_id=v_plan.id,
      entitlement_mode='rolling_days',term_duration_days=30,
      updated_at=v_now,updated_by=v_actor,reason=v_reason,version=version+1
      where id=v_subscription.id returning * into v_subscription;
    insert into public.subscription_history(subscription_id,user_id,actor_user_id,action,previous_state,new_state,reason,request_key)
      values(v_subscription.id,v_subscription.user_id,v_actor,'adjust',v_before->'subscription',to_jsonb(v_subscription),v_reason,
        v_key || '_' || replace(v_payment.id::text,'-','') || '_subscription');
    select jsonb_agg(to_jsonb(h) order by h.id) into v_complete_sh from public.subscription_history h where h.subscription_id=v_subscription.id;
    v_after := jsonb_build_object('payment',to_jsonb(v_payment),'subscription',to_jsonb(v_subscription),
      'approvalPaymentHistory',v_ph,'approvalSubscriptionHistory',v_sh,'subscriptionHistory',v_complete_sh);
    if ((v_after->'payment')-array['approved_activation_at','approved_entitlement_starts_at','approved_entitlement_ends_at',
      'approved_entitlement_mode','approved_duration_days','updated_at','version']) is distinct from
      ((v_before->'payment')-array['approved_activation_at','approved_entitlement_starts_at','approved_entitlement_ends_at',
      'approved_entitlement_mode','approved_duration_days','updated_at','version'])
      or extract(epoch from v_payment.approved_entitlement_ends_at-v_payment.approved_entitlement_starts_at)<>2592000
      or v_subscription.expires_at<(v_before->'subscription'->>'expires_at')::timestamptz then
      raise exception 'ASTRA_REPAIR_POSTCONDITION_FAILED';
    end if;
    insert into public.payment_term_repair_journal(repair_key,payment_request_id,subscription_id,user_id,actor_user_id,reason,
      evidence_sha256,before_sha256,after_sha256,before_state,after_state,original_activation_at,purchased_ends_at,
      original_overall_ends_at,corrected_overall_ends_at,direction,applied_at)
      values(v_key,v_payment.id,v_subscription.id,v_payment.user_id,v_actor,v_reason,v_evidence_sha,
        encode(sha256(convert_to(v_before::text,'UTF8')),'hex'),encode(sha256(convert_to(v_after::text,'UTF8')),'hex'),
        v_before,v_after,v_anchor,v_end,(v_before->'subscription'->>'expires_at')::timestamptz,v_overall_end,v_direction,v_now);
    insert into public.admin_audit_log(actor_user_id,action_type,target_user_id,target_resource_type,target_resource_id,reason,details)
      values(v_actor,'payment_changed',v_payment.user_id,'payment_request',v_payment.id::text,v_reason,
        jsonb_build_object('action','paid_term_causal_repair','repairKey',v_key,'direction',v_direction,
          'originalActivationAt',v_anchor,'purchasedEndsAt',v_end,'overallEndsAt',v_overall_end,
          'sentReceiptPreserved',true,'proofPreserved',true,'evidenceSha256',v_evidence_sha));
    if v_direction='extend' then v_extend:=v_extend+1; else v_preserve:=v_preserve+1; end if;
  end loop;
  if v_count<>6 or v_extend<>4 or v_preserve<>2 or v_replayed not in(0,6) then
    raise exception 'ASTRA_REPAIR_TOTALS_INVALID';
  end if;
  raise notice 'Astra repair verified: 6 accounts, 4 extensions, 2 longer grants preserved, % replayed; no receipt resend.',v_replayed;
end;
$astra_repair$;

select count(*)::integer as journal_rows,
  count(*) filter(where direction='extend')::integer as extended,
  count(*) filter(where direction='preserve_longer')::integer as preserved_longer,
  count(*) filter(where purchased_ends_at-original_activation_at=interval '720 hours')::integer as exact_720_hour_terms,
  count(*) filter(where corrected_overall_ends_at<original_overall_ends_at)::integer as shortened,
  bool_and(before_state->'payment'->'subscriber_receipt_status'=after_state->'payment'->'subscriber_receipt_status') as sent_receipt_state_preserved
from public.payment_term_repair_journal where repair_key='astra_20260907_paid149_exact720_v1';
ROLLBACK;
