-- Rollback-only live verification for the Founder-managed Plans & Pricing
-- database contract. Run only after the reviewed migration has committed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pricing_schema_probe$
declare
  v_rpc regprocedure;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260830054727'
         and migration_row.name = 'admin_pricing_revisions'
         and 'sha256:efea920365df3d647053a4b33c806efc520b84ca7778c7b5cf0f6d165a6dfbaf'
           = any(coalesce(migration_row.statements, array[]::text[]))
     ) then
    raise exception 'ADMIN_PRICING_PROBE_MIGRATION_LEDGER_MISMATCH';
  end if;

  if (
    select count(*)
    from (values
      (to_regclass('public.pricing_revisions')),
      (to_regclass('public.pricing_assets')),
      (to_regclass('public.pricing_plan_versions')),
      (to_regclass('public.pricing_payment_channel_versions')),
      (to_regclass('public.pricing_publication_events'))
    ) required_table(oid)
    where oid is not null
  ) <> 5 then
    raise exception 'ADMIN_PRICING_PROBE_TABLES_MISSING';
  end if;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace_row on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'public'
      and relation.relname in (
        'pricing_revisions',
        'pricing_assets',
        'pricing_plan_versions',
        'pricing_payment_channel_versions',
        'pricing_publication_events'
      )
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then
    raise exception 'ADMIN_PRICING_PROBE_RLS_NOT_FORCED';
  end if;

  if exists (
    select 1
    from (values
      ('pricing_revisions'),
      ('pricing_assets'),
      ('pricing_plan_versions'),
      ('pricing_payment_channel_versions'),
      ('pricing_publication_events')
    ) protected_table(name)
    where has_table_privilege(
      'service_role',
      'public.' || protected_table.name,
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ) then
    raise exception 'ADMIN_PRICING_PROBE_DIRECT_SERVICE_TABLE_ACCESS';
  end if;

  foreach v_rpc in array array[
    'public.phase4_pricing_snapshot()'::regprocedure,
    'public.phase4_admin_pricing_snapshot(uuid)'::regprocedure,
    'public.phase4_admin_pricing_action(uuid,text,text,integer,uuid,uuid,timestamptz,jsonb,text,boolean)'::regprocedure,
    'public.phase4_admin_register_pricing_asset(uuid,text,text,text,text,bigint,integer,integer,text)'::regprocedure,
    'public.phase4_admin_pricing_asset(uuid,uuid)'::regprocedure,
    'public.phase4_pricing_public_asset(uuid)'::regprocedure,
    'public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)'::regprocedure,
    'public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text)'::regprocedure,
    'public.phase4_create_refund_request(uuid,uuid,text,text)'::regprocedure,
    'public.phase4_student_billing_snapshot(uuid)'::regprocedure,
    'public.phase4_payment_notification_context(uuid)'::regprocedure,
    'public.phase4_subscription_receipt_context(uuid)'::regprocedure,
    'public.phase4_plan_catalog()'::regprocedure,
    'public.phase4_access_snapshot(uuid,boolean,text)'::regprocedure
  ] loop
    if not has_function_privilege('service_role', v_rpc, 'EXECUTE')
       or has_function_privilege('anon', v_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', v_rpc, 'EXECUTE') then
      raise exception 'ADMIN_PRICING_PROBE_RPC_PRIVILEGE_FAILED: %', v_rpc::text;
    end if;
    if not exists (
      select 1
      from pg_proc function_row
      where function_row.oid = v_rpc
        and function_row.prosecdef
        and function_row.proconfig = array['search_path=""']::text[]
    ) then
      raise exception 'ADMIN_PRICING_PROBE_RPC_HARDENING_FAILED: %', v_rpc::text;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.subscriptions'::regclass
      and trigger_row.tgname = 'phase4_enforce_live_subscription_plan_trigger'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'ADMIN_PRICING_PROBE_SUBSCRIPTION_TRIGGER_MISSING';
  end if;
end
$pricing_schema_probe$;

do $pricing_cutover_probe$
declare
  v_seed constant uuid := 'a8300000-0000-4000-8000-000000000001'::uuid;
  v_snapshot jsonb;
  v_plan jsonb;
begin
  v_snapshot := public.phase4_pricing_revision_snapshot(
    v_seed,
    true,
    '2026-08-31 23:59:59+08'::timestamptz
  );
  select value into v_plan
  from jsonb_array_elements(v_snapshot->'plans') plan_row(value)
  where value->>'planCode' = 'early_access_beta';
  if v_plan is null
     or (v_plan->>'priceCentavos')::integer <> 14900
     or coalesce((v_plan->>'checkoutOpen')::boolean, false) is not true then
    raise exception 'ADMIN_PRICING_PROBE_LEGACY_CUTOFF_FAILED';
  end if;

  v_snapshot := public.phase4_pricing_revision_snapshot(
    v_seed,
    true,
    '2026-09-01 12:00:00+08'::timestamptz
  );
  if exists (
    select 1 from jsonb_array_elements(v_snapshot->'plans') plan_row(value)
    where value->>'planCode' = 'early_access_beta'
  ) then
    raise exception 'ADMIN_PRICING_PROBE_LEGACY_VISIBLE_AFTER_CUTOFF';
  end if;
  select value into v_plan
  from jsonb_array_elements(v_snapshot->'plans') plan_row(value)
  where value->>'planCode' = 'bar_access_30d';
  if v_plan is null
     or (v_plan->>'priceCentavos')::integer <> 19900
     or (v_plan->>'durationDays')::integer <> 30
     or v_plan->>'status' <> 'upcoming'
     or coalesce((v_plan->>'checkoutOpen')::boolean, false) then
    raise exception 'ADMIN_PRICING_PROBE_SEPTEMBER_FIRST_FAILED';
  end if;

  v_snapshot := public.phase4_pricing_revision_snapshot(
    v_seed,
    true,
    '2026-09-02 00:00:00+08'::timestamptz
  );
  select value into v_plan
  from jsonb_array_elements(v_snapshot->'plans') plan_row(value)
  where value->>'planCode' = 'bar_access_30d';
  if v_plan is null
     or v_plan->>'status' <> 'payment_channel_required'
     or coalesce((v_plan->>'checkoutOpen')::boolean, false)
     or jsonb_array_length(v_snapshot->'paymentMethods') <> 0 then
    raise exception 'ADMIN_PRICING_PROBE_NO_QR_FAIL_CLOSED_FAILED';
  end if;
end
$pricing_cutover_probe$;

do $pricing_admin_payment_probe$
declare
  v_seed constant uuid := 'a8300000-0000-4000-8000-000000000001'::uuid;
  v_actor uuid;
  v_user uuid := gen_random_uuid();
  v_result jsonb;
  v_config jsonb;
  v_draft uuid;
  v_live uuid;
  v_lock integer;
  v_plan uuid;
  v_channel uuid;
  v_payment uuid;
  v_subscription uuid;
  v_current_subscription uuid;
  v_first_expiry timestamptz;
  v_second_expiry timestamptz;
  v_current_expiry timestamptz;
  v_invalid_method_rejected boolean := false;
begin
  select role_row.user_id into v_actor
  from public.user_roles role_row
  where role_row.role::text in ('founder_admin', 'super_admin')
  order by case role_row.role::text when 'super_admin' then 1 else 2 end,
    role_row.user_id
  limit 1;
  if v_actor is null then
    raise exception 'ADMIN_PRICING_PROBE_FOUNDER_MISSING';
  end if;

  v_result := public.phase4_admin_pricing_snapshot(v_actor);
  if jsonb_typeof(v_result) is distinct from 'object'
     or v_result->'live'->>'revisionId' is distinct from v_seed::text then
    raise exception 'ADMIN_PRICING_PROBE_ADMIN_SNAPSHOT_FAILED';
  end if;

  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'create_draft',
    'pricingprobecreatedraft0001',
    null,
    null,
    v_seed,
    null,
    null,
    'Rollback-only pricing release probe draft.',
    false
  );
  v_draft := (v_result->>'revisionId')::uuid;
  v_lock := (v_result->>'lockVersion')::integer;
  v_config := v_result->'snapshot';
  -- The real 199-peso checkout starts on September 2. This rollback-only copy
  -- opens it now so submission, approval, and renewal can be exercised before
  -- the calendar cutover without changing the published seed.
  v_config := jsonb_set(
    v_config,
    '{plans}',
    (
      select jsonb_agg(
        case when value->>'planCode' = 'bar_access_30d'
          then value || jsonb_build_object(
            'displayStartsAt', null,
            'checkoutStartsAt', null,
            'checkoutEnabled', true
          )
          else value
        end
        order by coalesce((value->>'sortOrder')::integer, 0), value->>'planCode'
      )
      from jsonb_array_elements(v_config->'plans') plan_row(value)
    ),
    true
  );
  v_config := jsonb_set(
    v_config,
    '{paymentMethods}',
    coalesce(v_config->'paymentMethods', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'channelCode', 'probe_bpi_199',
        'planCode', 'bar_access_30d',
        'label', 'Rollback-only BPI 199 probe',
        'accountName', 'Due Diligence',
        'accountDetails', 'Rollback-only release verification',
        'instructions', 'Use the exact amount.',
        'qrUrl', '/assets/payments/bpi-instapay-149.png',
        'qrAmountMode', 'exact',
        'qrAmountCentavos', 19900,
        'enabled', true,
        'visible', true,
        'sortOrder', 2
      ),
      jsonb_build_object(
        'channelCode', 'probe_future_bank',
        'planCode', 'bar_access_30d',
        'label', 'Disabled future bank',
        'accountName', '',
        'accountDetails', '',
        'instructions', '',
        'qrAmountMode', 'exact',
        'qrAmountCentavos', 19900,
        'enabled', false,
        'visible', false,
        'sortOrder', 3
      )
    ),
    true
  );

  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'publish',
    'pricingprobepublish000001',
    v_lock,
    v_draft,
    v_seed,
    null,
    v_config,
    'Rollback-only publish verifies the Admin pricing contract.',
    true
  );
  v_live := (v_result->>'revisionId')::uuid;
  if v_result->>'state' <> 'published' then
    raise exception 'ADMIN_PRICING_PROBE_PUBLISH_FAILED';
  end if;

  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'publish',
    'pricingprobepublish000001',
    v_lock,
    v_draft,
    v_seed,
    null,
    v_config,
    'Rollback-only publish verifies the Admin pricing contract.',
    true
  );
  if coalesce((v_result->>'replayed')::boolean, false) is not true
     or v_result->>'revisionId' is distinct from v_live::text then
    raise exception 'ADMIN_PRICING_PROBE_PUBLISH_REPLAY_FAILED';
  end if;

  v_result := public.phase4_pricing_snapshot();
  select (value->>'versionId')::uuid into v_plan
  from jsonb_array_elements(v_result->'plans') plan_row(value)
  where value->>'planCode' = 'bar_access_30d';
  select (value->>'versionId')::uuid into v_channel
  from jsonb_array_elements(v_result->'paymentMethods') method_row(value)
  where value->>'channelCode' = 'probe_bpi_199';
  if v_plan is null or v_channel is null
     or exists (
       select 1
       from jsonb_array_elements(v_result->'paymentMethods') method_row(value)
       where value->>'channelCode' = 'probe_future_bank'
     ) then
    raise exception 'ADMIN_PRICING_PROBE_PUBLIC_METHOD_FILTER_FAILED';
  end if;

  insert into auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    v_user,
    'pricing-release-probe@example.invalid',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

  v_result := public.phase4_create_payment_request_v2(
    v_user,
    v_plan,
    v_channel,
    (clock_timestamp() at time zone 'Asia/Manila')::date,
    'PRICING-PROBE-199-FIRST',
    'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png',
    256,
    repeat('a', 64)
  );
  v_payment := (v_result->>'id')::uuid;
  if (v_result->>'amountCentavos')::integer <> 19900
     or (v_result->>'durationDays')::integer <> 30
     or v_result->>'entitlementMode' <> 'rolling_days' then
    raise exception 'ADMIN_PRICING_PROBE_PAYMENT_CAPTURE_FAILED';
  end if;

  -- Make the first plan version stale, then verify the accepted request still
  -- replays and remains approvable from its immutable evidence.
  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'create_draft',
    'pricingprobecreatedraft0002',
    null,
    null,
    v_live,
    null,
    null,
    'Rollback-only stale-plan verification draft.',
    false
  );
  v_draft := (v_result->>'revisionId')::uuid;
  v_lock := (v_result->>'lockVersion')::integer;
  v_config := v_result->'snapshot';
  v_config := jsonb_set(
    v_config,
    '{paymentMethods}',
    (
      select jsonb_agg(
        case when value->>'channelCode' = 'probe_future_bank'
          then value || '{"enabled":true,"visible":true}'::jsonb
          else value
        end
        order by coalesce((value->>'sortOrder')::integer, 0), value->>'channelCode'
      )
      from jsonb_array_elements(v_config->'paymentMethods') method_row(value)
    ),
    true
  );
  begin
    perform public.phase4_admin_pricing_action(
      v_actor,
      'save_draft',
      'pricingprobeinvalidqr0001',
      v_lock,
      v_draft,
      v_live,
      null,
      v_config,
      'Enabled payment methods must include a QR.',
      false
    );
  exception when others then
    if lower(sqlerrm) like '%qr%required%'
       or lower(sqlerrm) like '%check constraint%' then
      v_invalid_method_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_invalid_method_rejected then
    raise exception 'ADMIN_PRICING_PROBE_ENABLED_METHOD_WITHOUT_QR_ACCEPTED';
  end if;

  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'publish',
    'pricingprobepublish000002',
    v_lock,
    v_draft,
    v_live,
    null,
    null,
    'Rollback-only publication makes the first plan version stale.',
    true
  );
  v_live := (v_result->>'revisionId')::uuid;

  v_result := public.phase4_create_payment_request_v2(
    v_user,
    v_plan,
    v_channel,
    (clock_timestamp() at time zone 'Asia/Manila')::date,
    'PRICING-PROBE-199-FIRST',
    'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png',
    256,
    repeat('a', 64)
  );
  if coalesce((v_result->>'replayed')::boolean, false) is not true
     or v_result->>'id' is distinct from v_payment::text then
    raise exception 'ADMIN_PRICING_PROBE_STALE_PAYMENT_REPLAY_FAILED';
  end if;

  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_payment,
    '{"status":"approved"}'::jsonb,
    'Rollback-only approval verifies a thirty-day subscription.',
    'pricingprobeapprove000001'
  );
  v_subscription := (v_result->'subscription'->>'id')::uuid;
  v_first_expiry := (v_result->'subscription'->>'expires_at')::timestamptz;
  if v_subscription is null
     or v_first_expiry not between clock_timestamp() + interval '29 days 23 hours'
       and clock_timestamp() + interval '30 days 1 hour' then
    raise exception 'ADMIN_PRICING_PROBE_FIRST_THIRTY_DAY_TERM_FAILED';
  end if;

  v_result := public.phase4_pricing_snapshot();
  select (value->>'versionId')::uuid into v_plan
  from jsonb_array_elements(v_result->'plans') plan_row(value)
  where value->>'planCode' = 'bar_access_30d';
  select (value->>'versionId')::uuid into v_channel
  from jsonb_array_elements(v_result->'paymentMethods') method_row(value)
  where value->>'channelCode' = 'probe_bpi_199';

  v_result := public.phase4_create_payment_request_v2(
    v_user,
    v_plan,
    v_channel,
    (clock_timestamp() at time zone 'Asia/Manila')::date,
    'PRICING-PROBE-199-RENEWAL',
    'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png',
    256,
    repeat('b', 64)
  );
  v_payment := (v_result->>'id')::uuid;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_payment,
    '{"status":"approved"}'::jsonb,
    'Rollback-only approval verifies a thirty-day renewal extension.',
    'pricingprobeapprove000002'
  );
  v_second_expiry := (v_result->'subscription'->>'expires_at')::timestamptz;
  if (v_result->'subscription'->>'id')::uuid <> v_subscription
     or v_second_expiry not between v_first_expiry + interval '29 days 23 hours'
       and v_first_expiry + interval '30 days 1 hour' then
    raise exception 'ADMIN_PRICING_PROBE_RENEWAL_EXTENSION_FAILED';
  end if;

  -- A later entitlement may replace the subscription referenced by this old
  -- payment. Its refund must still be recorded without touching current access.
  update public.subscriptions
  set status = 'cancelled',
      updated_at = clock_timestamp(),
      updated_by = v_actor,
      reason = 'Rollback-only probe replaces the purchased subscription.',
      version = version + 1
  where id = v_subscription;
  v_current_expiry := clock_timestamp() + interval '90 days';
  insert into public.subscriptions (
    user_id, plan_code, status, starts_at, expires_at, source,
    created_by, updated_by, reason
  ) values (
    v_user, 'bar_access_30d', 'active', clock_timestamp(), v_current_expiry,
    'admin_adjustment', v_actor, v_actor,
    'Rollback-only stronger current entitlement for refund safety verification.'
  ) returning id into v_current_subscription;

  v_result := public.phase4_create_refund_request(
    v_user,
    v_payment,
    'Rollback-only refund verifies that later current access remains untouched.',
    'pricingproberefundunsafe0001'
  );
  if coalesce((v_result->>'accessAutomaticallyChanged')::boolean, true)
     or not exists (
       select 1 from public.subscriptions current_subscription
       where current_subscription.id = v_current_subscription
         and current_subscription.user_id = v_user
         and current_subscription.status = 'active'
         and current_subscription.expires_at is not distinct from v_current_expiry
     )
     or not exists (
       select 1 from public.subscriptions purchased_subscription
       where purchased_subscription.id = v_subscription
         and purchased_subscription.status = 'cancelled'
     )
     or not exists (
       select 1 from public.refund_requests refund_row
       where refund_row.id = (v_result->>'id')::uuid
         and refund_row.status = 'pending'
         and refund_row.calculation_note like '%Founder review is required%'
     ) then
    raise exception 'ADMIN_PRICING_PROBE_UNSAFE_REFUND_CHANGED_CURRENT_ACCESS';
  end if;

  v_result := public.phase4_admin_pricing_action(
    v_actor,
    'rollback',
    'pricingproberollback000001',
    null,
    v_live,
    v_seed,
    null,
    null,
    'Rollback-only release probe verifies publication rollback.',
    true
  );
  if v_result->>'state' <> 'published'
     or v_result->'snapshot'->>'rollbackOfRevisionId' is distinct from v_seed::text then
    raise exception 'ADMIN_PRICING_PROBE_ROLLBACK_FAILED';
  end if;
end
$pricing_admin_payment_probe$;

rollback;
select 'ADMIN_PRICING_RELEASE_PROBE_PASSED' as result;
