-- Rollback-only production/staging proof for the September pricing cutover.
-- Run only after both reviewed migrations are present in the migration ledger.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';

do $september_pricing_schema_probe$
declare
  v_rpc regprocedure;
  v_qr_constraint text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260831100000'
         and migration_row.name = 'september_pricing_cutover'
         and 'sha256:0ba5e20831899ade5b30088bf5f618cf055539fc35037bb2ef075119725dd676'
           = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260831101000'
         and migration_row.name = 'proof_only_payment_evidence'
         and 'sha256:dcc4c2401d833a39ae7dbbe21e8a3205a8efdd283aa430b21618f63ac7397eac'
           = any(coalesce(migration_row.statements, array[]::text[]))
     ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_MIGRATION_LEDGER_MISMATCH';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'payment_requests'
      and column_row.column_name = 'payment_evidence_mode'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'payment_requests'
      and column_row.column_name = 'paid_at'
  ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_PAYMENT_PROVENANCE_COLUMNS_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.payment_requests'::regclass
      and trigger_row.tgname = 'phase4_guard_payment_evidence_provenance_trigger'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_PAYMENT_PROVENANCE_TRIGGER_MISSING';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
  into v_qr_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.pricing_payment_channel_versions'::regclass
    and constraint_row.conname = 'pricing_payment_channel_versions_qr_public_path_check';
  if v_qr_constraint is null
     or position('/pricing/legacy-149-qr.png' in v_qr_constraint) = 0
     or position('/assets/payments/' in v_qr_constraint) = 0 then
    raise exception 'SEPTEMBER_PRICING_PROBE_LEGACY_QR_CONSTRAINT_FAILED';
  end if;

  foreach v_rpc in array array[
    'public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)'::regprocedure,
    'public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text)'::regprocedure,
    'public.phase4_student_billing_snapshot(uuid)'::regprocedure,
    'public.phase4_admin_operational_data_scoped_v2(uuid,text,text,integer,integer,text)'::regprocedure,
    'public.phase4_claim_founding_beta(uuid,text)'::regprocedure
  ] loop
    if not has_function_privilege('service_role', v_rpc, 'EXECUTE')
       or has_function_privilege('anon', v_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', v_rpc, 'EXECUTE') then
      raise exception 'SEPTEMBER_PRICING_PROBE_RPC_PRIVILEGE_FAILED: %', v_rpc::text;
    end if;
  end loop;

  if pg_get_functiondef(
       'public.phase4_create_payment_request(uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text)'::regprocedure
     ) not like '%2026-09-14 00:00:00+08%'
     or pg_get_functiondef(
       'public.phase4_create_payment_request(uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text)'::regprocedure
     ) like '%2026-09-01 00:00:00+08%' then
    raise exception 'SEPTEMBER_PRICING_PROBE_COMPATIBILITY_CUTOFF_FAILED';
  end if;
end;
$september_pricing_schema_probe$;

do $september_pricing_cutover_probe$
declare
  v_before jsonb;
  v_old_at jsonb;
  v_new_before jsonb;
  v_at jsonb;
  v_after jsonb;
  v_features jsonb := jsonb_build_array(
    'Quick Drills & Doctrine Review',
    'Syllabus-Based Review',
    'Bar Question Practice',
    'Bar Exam Simulation',
    'Pedro — Private AI Study Assistant',
    'ALAC Grading, Model Answers & Legal Sources',
    'Saved Progress, Personal Analytics & PDF Exports',
    'Study Room Beta — Join Open Live Rooms'
  );
begin
  if not exists (
       select 1 from public.pricing_revisions r
       where r.id = 'a8310000-0000-4000-8000-000000000001'::uuid
         and r.state = 'published'
         and r.effective_at < '2026-09-14 00:00:00+08'::timestamptz
     )
     or not exists (
       select 1 from public.pricing_revisions r
       where r.id = 'a9140000-0000-4000-8000-000000000001'::uuid
         and r.state = 'scheduled'
         and r.effective_at = '2026-09-14 00:00:00+08'::timestamptz
     )
     or (
       select r.id
       from public.pricing_revisions r
       where r.state in ('published', 'scheduled')
         and r.effective_at <= clock_timestamp()
       order by r.effective_at desc, r.revision_number desc
       limit 1
      ) is distinct from 'a8310000-0000-4000-8000-000000000001'::uuid then
    raise exception 'SEPTEMBER_PRICING_PROBE_CANONICAL_REVISION_SELECTION_FAILED';
  end if;

  v_before := public.phase4_pricing_revision_snapshot(
    'a8310000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-13 23:59:59.999999+08'::timestamptz
  );
  v_old_at := public.phase4_pricing_revision_snapshot(
    'a8310000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-14 00:00:00+08'::timestamptz
  );
  v_new_before := public.phase4_pricing_revision_snapshot(
    'a9140000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-13 23:59:59.999999+08'::timestamptz
  );
  v_at := public.phase4_pricing_revision_snapshot(
    'a9140000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-14 00:00:00+08'::timestamptz
  );
  v_after := public.phase4_pricing_revision_snapshot(
    'a9140000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-14 00:00:00.000001+08'::timestamptz
  );

  if jsonb_array_length(v_before->'plans') <> 1
     or (v_before->'plans'->0->>'priceCentavos')::integer <> 14900
     or coalesce((v_before->'plans'->0->>'checkoutOpen')::boolean, false) is not true then
    raise exception 'SEPTEMBER_PRICING_PROBE_149_BEFORE_FAILED';
  end if;
  if jsonb_array_length(v_old_at->'plans') <> 0
     or jsonb_array_length(v_old_at->'paymentMethods') <> 0 then
    raise exception 'SEPTEMBER_PRICING_PROBE_149_AT_BOUNDARY_FAILED';
  end if;
  if jsonb_array_length(v_new_before->'plans') <> 0
     or jsonb_array_length(v_new_before->'paymentMethods') <> 0 then
    raise exception 'SEPTEMBER_PRICING_PROBE_199_BEFORE_BOUNDARY_FAILED';
  end if;
  if jsonb_array_length(v_at->'plans') <> 1
     or v_at->'plans'->0->>'name' <> 'Regular Subscription'
     or (v_at->'plans'->0->>'priceCentavos')::integer <> 19900
     or (v_at->'plans'->0->>'durationDays')::integer <> 30
     or v_at->'plans'->0->'features' is distinct from v_features
     or coalesce((v_at->'plans'->0->>'checkoutOpen')::boolean, false) is not true then
    raise exception 'SEPTEMBER_PRICING_PROBE_199_AT_BOUNDARY_FAILED';
  end if;
  if v_after->'plans' is distinct from v_at->'plans'
     or v_after->'paymentMethods' is distinct from v_at->'paymentMethods' then
    raise exception 'SEPTEMBER_PRICING_PROBE_199_AFTER_BOUNDARY_FAILED';
  end if;
  if jsonb_array_length(v_at->'paymentMethods') <> 1
     or v_at->'paymentMethods'->0->>'qrUrl'
       <> '/assets/payments/bpi-instapay-199-qr.png'
     or (v_at->'paymentMethods'->0->>'qrAmountCentavos')::integer <> 19900
     or coalesce(v_at->'paymentMethods'->0->>'accountName', '') <> ''
     or coalesce(v_at->'paymentMethods'->0->>'accountDetails', '') <> '' then
    raise exception 'SEPTEMBER_PRICING_PROBE_199_QR_FAILED';
  end if;

  if not exists (
    select 1
    from public.pricing_plan_versions p
    where p.id = 'a8300000-0000-4000-8000-000000000101'::uuid
      and p.price_centavos = 14900
      and p.fixed_ends_at = '2026-10-01 23:59:59+08'::timestamptz
  ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_LEGACY_SEED_CHANGED';
  end if;
end;
$september_pricing_cutover_probe$;

do $september_beta_probe$
declare
  v_now timestamptz := clock_timestamp();
  v_actor uuid;
  v_extended uuid := gen_random_uuid();
  v_disabled uuid := gen_random_uuid();
  v_revoked uuid := gen_random_uuid();
  v_later uuid := gen_random_uuid();
  v_nonexpiring uuid := gen_random_uuid();
  v_disabled_before jsonb;
  v_revoked_before jsonb;
  v_later_before jsonb;
  v_nonexpiring_before jsonb;
  v_result jsonb;
begin
  if exists (
    select 1
    from public.founding_beta_invites i
    where i.status <> 'revoked'
      and i.access_ends_at < '2026-10-01 00:00:00+08'::timestamptz
  ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_INVITE_END_FAILED';
  end if;
  if exists (
    select 1
    from public.free_beta_access b
    where b.access_program = 'founding_beta_2026'
      and b.enabled
      and b.expires_at is not null
      and not exists (
        select 1
        from public.founding_beta_invites invite_row
        where invite_row.claimed_user_id = b.user_id
          and invite_row.status = 'revoked'
      )
      and b.expires_at < '2026-10-01 00:00:00+08'::timestamptz
  ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_COHORT_END_FAILED';
  end if;
  if not private.phase4_founding_beta_claim_open(
       '2026-09-30 23:59:59.999999+08'::timestamptz
     )
     or private.phase4_founding_beta_claim_open(
       '2026-10-01 00:00:00+08'::timestamptz
     )
     or private.phase4_founding_beta_claim_open(
       '2026-10-01 00:00:00.000001+08'::timestamptz
     ) then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_BOUNDARY_GUARD_MISSING';
  end if;

  select role_row.user_id into v_actor
  from public.user_roles role_row
  where role_row.role::text in ('founder_admin', 'super_admin')
  order by case when role_row.role::text = 'founder_admin' then 0 else 1 end
  limit 1;
  if v_actor is null then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_ACTOR_REQUIRED';
  end if;

  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (v_extended, 'september-beta-extend@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_disabled, 'september-beta-disabled@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_revoked, 'september-beta-revoked@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_later, 'september-beta-later@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_nonexpiring, 'september-beta-nonexpiring@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now);

  insert into public.free_beta_access (
    user_id, enabled, expires_at, reason, created_by, updated_by, access_program
  ) values
  (v_extended, true, '2026-09-02 00:00:00+08', 'Rollback-only extension fixture.', v_actor, v_actor, 'founding_beta_2026'),
  (v_disabled, false, '2026-09-02 00:00:00+08', 'Rollback-only disabled fixture.', v_actor, v_actor, 'founding_beta_2026'),
  (v_revoked, true, '2026-09-02 00:00:00+08', 'Rollback-only revoked fixture.', v_actor, v_actor, 'founding_beta_2026'),
  (v_later, true, '2026-10-15 00:00:00+08', 'Rollback-only later fixture.', v_actor, v_actor, 'founding_beta_2026'),
  (v_nonexpiring, true, null, 'Rollback-only non-expiring fixture.', v_actor, v_actor, 'founding_beta_2026');

  insert into public.founding_beta_invites (
    email_hash, access_ends_at, status, claimed_user_id, updated_at
  ) values (
    encode(extensions.digest('september-beta-revoked-' || v_revoked::text, 'sha256'), 'hex'),
    '2026-09-02 00:00:00+08', 'revoked', v_revoked, v_now
  );

  select to_jsonb(b) into v_disabled_before from public.free_beta_access b where b.user_id = v_disabled;
  select to_jsonb(b) into v_revoked_before from public.free_beta_access b where b.user_id = v_revoked;
  select to_jsonb(b) into v_later_before from public.free_beta_access b where b.user_id = v_later;
  select to_jsonb(b) into v_nonexpiring_before from public.free_beta_access b where b.user_id = v_nonexpiring;

  v_result := private.phase4_extend_founding_beta_entitlements(
    '2026-10-01 00:00:00+08'::timestamptz
  );
  if (select b.expires_at from public.free_beta_access b where b.user_id = v_extended)
       <> '2026-10-01 00:00:00+08'::timestamptz
     or (v_result->>'entitlementsExtended')::integer <> 1 then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_EXTENSION_FIXTURE_FAILED';
  end if;
  if (select to_jsonb(b) from public.free_beta_access b where b.user_id = v_disabled)
       is distinct from v_disabled_before
     or (select to_jsonb(b) from public.free_beta_access b where b.user_id = v_revoked)
       is distinct from v_revoked_before
     or (select to_jsonb(b) from public.free_beta_access b where b.user_id = v_later)
       is distinct from v_later_before
     or (select to_jsonb(b) from public.free_beta_access b where b.user_id = v_nonexpiring)
       is distinct from v_nonexpiring_before then
    raise exception 'SEPTEMBER_PRICING_PROBE_BETA_PRESERVATION_FIXTURES_FAILED';
  end if;
end;
$september_beta_probe$;

do $september_payment_probe$
declare
  v_now timestamptz := clock_timestamp();
  v_paid_at timestamptz := date_trunc('second', clock_timestamp() - interval '2 days');
  v_second_paid_at timestamptz := date_trunc('second', clock_timestamp() - interval '1 day');
  v_actor uuid;
  v_user uuid := gen_random_uuid();
  v_nonexpiring_user uuid := gen_random_uuid();
  v_revision uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_channel uuid := gen_random_uuid();
  v_payment uuid;
  v_second_payment uuid;
  v_nonexpiring_payment uuid;
  v_nonexpiring_subscription uuid;
  v_result jsonb;
  v_access jsonb;
  v_billing jsonb;
  v_submitted_at timestamptz;
  v_first_expiry timestamptz;
  v_second_expiry timestamptz;
  v_missing_rejected boolean := false;
  v_future_rejected boolean := false;
  v_before_start_rejected boolean := false;
  v_after_submission_rejected boolean := false;
  v_immutable boolean := false;
begin
  select role_row.user_id into v_actor
  from public.user_roles role_row
  where role_row.role::text in ('founder_admin', 'super_admin')
  order by case when role_row.role::text = 'founder_admin' then 0 else 1 end
  limit 1;
  if v_actor is null then
    raise exception 'SEPTEMBER_PRICING_PROBE_FOUNDER_REQUIRED';
  end if;
  if exists (select 1 from public.pricing_revisions where state = 'draft') then
    raise exception 'SEPTEMBER_PRICING_PROBE_UNRESOLVED_PRICING_DRAFT';
  end if;

  insert into public.pricing_revisions (
    id, state, page_config, content_hash, created_at, updated_at
  ) values (
    v_revision,
    'draft',
    '{"page":{},"faqs":[]}'::jsonb,
    encode(extensions.digest(v_revision::text, 'sha256'), 'hex'),
    v_now,
    v_now
  );
  insert into public.pricing_plan_versions (
    id, revision_id, plan_code, name, price_centavos, currency,
    duration_days, entitlement_mode, description, features, cta_label,
    renewal_note, visible, display_starts_at, checkout_enabled,
    checkout_starts_at, sort_order, promotional, billing
  ) values (
    v_plan, v_revision, 'bar_access_30d', 'Rollback-only 30-day plan',
    19900, 'PHP', 30, 'rolling_days', 'Rollback-only evidence.',
    '[]'::jsonb, 'Choose plan', 'No automatic renewal.', true,
    v_now - interval '10 days', true, v_now - interval '10 days',
    1, false, 'manual'
  );
  insert into public.pricing_payment_channel_versions (
    id, revision_id, plan_version_id, channel_code, label,
    account_name, account_details, instructions, qr_public_path,
    amount_centavos, enabled, visible, sort_order
  ) values (
    v_channel, v_revision, v_plan, 'probe_instapay',
    'Rollback-only InstaPay', '', '', 'Rollback-only.',
    '/assets/payments/bpi-instapay-199-qr.png', 19900, true, true, 1
  );
  update public.pricing_revisions
  set state = 'published',
      effective_at = v_now - interval '1 second',
      published_at = v_now,
      updated_at = v_now,
      lock_version = lock_version + 1
  where id = v_revision;

  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (
    v_user, 'september-payment-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_nonexpiring_user, 'september-payment-probe-nonexpiring@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  );

  -- The Account screen uses this signal to route expired members back to the
  -- currently effective plan. It must come from the immutable pricing
  -- revision, not the retired Early Access compatibility setting.
  v_access := public.phase4_access_snapshot(v_user, false, null);
  if coalesce((v_access->>'checkoutOpen')::boolean, false) is not true
     or (v_access->>'priceCentavos')::integer <> 19900
     or v_access->>'pricingRevisionId' <> v_revision::text then
    raise exception 'SEPTEMBER_PRICING_PROBE_CURRENT_PLAN_ROUTING_FAILED';
  end if;

  v_result := public.phase4_create_payment_request_v3(
    v_user, v_plan, v_channel, 'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('a', 64)
  );
  v_payment := (v_result->>'id')::uuid;
  if v_result->>'paymentEvidenceMode' <> 'proof_only'
     or v_result ? 'transactionReference'
     or v_result ? 'paymentReference'
     or v_result ? 'verifiedPaidAtBy'
     or v_result::text like '%proof_sha256_%' then
    raise exception 'SEPTEMBER_PRICING_PROBE_PROOF_ONLY_RESPONSE_FAILED';
  end if;
  v_result := public.phase4_create_payment_request_v3(
    v_user, v_plan, v_channel, 'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('a', 64)
  );
  if coalesce((v_result->>'replayed')::boolean, false) is not true
     or (v_result->>'id')::uuid <> v_payment then
    raise exception 'SEPTEMBER_PRICING_PROBE_PROOF_ONLY_REPLAY_FAILED';
  end if;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_payment
  returning submitted_at into v_submitted_at;

  begin
    perform public.phase4_admin_review_payment(
      v_actor, v_payment, '{"status":"approved"}'::jsonb,
      'Rollback-only missing paid-at rejection.',
      'septemberprobemissingpaidat0001'
    );
  exception when others then
    if sqlerrm like '%verifiedPaidAt is required%' then
      v_missing_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_missing_rejected then
    raise exception 'SEPTEMBER_PRICING_PROBE_MISSING_PAID_AT_ACCEPTED';
  end if;

  begin
    perform public.phase4_admin_review_payment(
      v_actor, v_payment,
      jsonb_build_object(
        'status', 'approved',
        'verifiedPaidAt', to_char(
          (v_now + interval '1 day') at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      ),
      'Rollback-only future paid-at rejection.',
      'septemberprobefuturepaidat0001'
    );
  exception when others then
    if sqlerrm like '%cannot be in the future%' then
      v_future_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_future_rejected then
    raise exception 'SEPTEMBER_PRICING_PROBE_FUTURE_PAID_AT_ACCEPTED';
  end if;

  begin
    perform public.phase4_admin_review_payment(
      v_actor, v_payment,
      jsonb_build_object(
        'status', 'approved',
        'verifiedPaidAt', to_char(
          (v_submitted_at + interval '1 second') at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      ),
      'Rollback-only post-submission paid-at rejection.',
      'septemberprobeaftersubmission0001'
    );
  exception when others then
    if sqlerrm like '%cannot be after the proof submission time%' then
      v_after_submission_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_after_submission_rejected then
    raise exception 'SEPTEMBER_PRICING_PROBE_POST_SUBMISSION_PAID_AT_ACCEPTED';
  end if;

  begin
    perform public.phase4_admin_review_payment(
      v_actor, v_payment,
      jsonb_build_object(
        'status', 'approved',
        'verifiedPaidAt', to_char(
          (v_now - interval '11 days') at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      ),
      'Rollback-only pre-checkout paid-at rejection.',
      'septemberprobebeforestart0001'
    );
  exception when others then
    if sqlerrm like '%cannot precede the plan checkout start%' then
      v_before_start_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_before_start_rejected then
    raise exception 'SEPTEMBER_PRICING_PROBE_PRE_CHECKOUT_PAID_AT_ACCEPTED';
  end if;

  v_result := public.phase4_admin_review_payment(
    v_actor, v_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        v_paid_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only approval proves payment-time term calculation.',
    'septemberprobeapprovepaidat0001'
  );
  v_first_expiry := (v_result->>'purchasedEndsAt')::timestamptz;
  if (v_result->>'verifiedPaidAt')::timestamptz <> v_paid_at
     or (v_result->'subscription'->>'starts_at')::timestamptz <> v_paid_at
     or v_first_expiry <> v_paid_at + interval '30 days'
     or (v_result->>'purchasedStartsAt')::timestamptz <> v_paid_at then
    raise exception 'SEPTEMBER_PRICING_PROBE_APPROVAL_DELAY_SHIFTED_TERM';
  end if;
  v_billing := public.phase4_student_billing_snapshot(v_user);
  if v_billing::text like '%verifiedPaidAtBy%'
     or v_billing::text like '%' || v_actor::text || '%' then
    raise exception 'SEPTEMBER_PRICING_PROBE_STUDENT_REVIEWER_IDENTITY_LEAKED';
  end if;

  v_result := public.phase4_admin_review_payment(
    v_actor, v_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        v_paid_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only approval proves payment-time term calculation.',
    'septemberprobeapprovepaidat0001'
  );
  if coalesce((v_result->>'replayed')::boolean, false) is not true
     or (v_result->>'purchasedEndsAt')::timestamptz <> v_first_expiry
     or (
       select s.expires_at from public.subscriptions s
       where s.id = (v_result->'subscription'->>'id')::uuid
     ) is distinct from v_first_expiry then
    raise exception 'SEPTEMBER_PRICING_PROBE_APPROVAL_REPLAY_EXTENDED_TERM';
  end if;

  begin
    update public.payment_requests
    set paid_at = paid_at + interval '1 second'
    where id = v_payment;
  exception when others then
    if sqlerrm like '%Verified payment time is immutable%' then
      v_immutable := true;
    else
      raise;
    end if;
  end;
  if not v_immutable then
    raise exception 'SEPTEMBER_PRICING_PROBE_PAID_AT_MUTABLE';
  end if;

  v_result := public.phase4_create_payment_request_v3(
    v_user, v_plan, v_channel, 'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('b', 64)
  );
  v_second_payment := (v_result->>'id')::uuid;
  v_result := public.phase4_admin_review_payment(
    v_actor, v_second_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        v_second_paid_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only renewal proves finite access is not shortened.',
    'septemberproberenewalpaidat0001'
  );
  v_second_expiry := (v_result->>'purchasedEndsAt')::timestamptz;
  if v_second_expiry <> v_first_expiry + interval '30 days'
     or v_second_expiry <= v_first_expiry then
    raise exception 'SEPTEMBER_PRICING_PROBE_RENEWAL_NON_SHORTENING_FAILED';
  end if;

  insert into public.subscriptions (
    user_id, plan_code, status, starts_at, expires_at, source,
    created_by, updated_by, reason, pricing_revision_id,
    pricing_plan_version_id, term_duration_days, entitlement_mode
  ) values (
    v_nonexpiring_user, 'bar_access_30d', 'active', v_now - interval '1 year',
    null, 'admin_adjustment', v_actor, v_actor,
    'Rollback-only non-expiring access preservation.',
    v_revision, v_plan, 30, 'rolling_days'
  ) returning id into v_nonexpiring_subscription;
  v_result := public.phase4_create_payment_request_v3(
    v_nonexpiring_user, v_plan, v_channel, 'payment-proofs',
    v_nonexpiring_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('c', 64)
  );
  v_nonexpiring_payment := (v_result->>'id')::uuid;
  v_result := public.phase4_admin_review_payment(
    v_actor, v_nonexpiring_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        v_second_paid_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only approval preserves non-expiring access.',
    'septemberprobenonexpiring0001'
  );
  if (v_result->'subscription'->>'id')::uuid <> v_nonexpiring_subscription
     or v_result->'subscription'->>'expires_at' is not null then
    raise exception 'SEPTEMBER_PRICING_PROBE_NONEXPIRING_ACCESS_SHORTENED';
  end if;
end;
$september_payment_probe$;

rollback;
select 'SEPTEMBER_PRICING_RELEASE_PROBE_PASSED' as result;
