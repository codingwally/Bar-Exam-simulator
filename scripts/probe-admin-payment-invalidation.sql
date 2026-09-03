-- Rollback-only staging/production proof for approved-payment invalidation.
-- It creates isolated synthetic commercial records and never touches any
-- examination, question, answer, grading, or simulator table.

\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $payment_invalidation_probe$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_paid_at timestamptz := pg_catalog.date_trunc(
    'second',
    pg_catalog.clock_timestamp() - interval '2 days'
  );
  v_actor uuid;
  v_user uuid := gen_random_uuid();
  v_independent_user uuid := gen_random_uuid();
  v_renewal_user uuid := gen_random_uuid();
  v_fixed_user uuid := gen_random_uuid();
  v_unsafe_user uuid := gen_random_uuid();
  v_sending_user uuid := gen_random_uuid();
  v_revision uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_fixed_plan uuid := gen_random_uuid();
  v_channel uuid := gen_random_uuid();
  v_fixed_channel uuid := gen_random_uuid();
  v_payment uuid;
  v_independent_payment uuid;
  v_renewal_first_payment uuid;
  v_renewal_payment uuid;
  v_renewal_third_payment uuid;
  v_fixed_payment uuid;
  v_unsafe_payment uuid;
  v_sending_payment uuid;
  v_subscription uuid;
  v_independent_subscription uuid;
  v_renewal_subscription uuid;
  v_fixed_prior_subscription uuid;
  v_fixed_purchased_subscription uuid;
  v_unsafe_subscription uuid;
  v_sending_subscription uuid;
  v_proof_path text;
  v_paid_at_before timestamptz;
  v_sent_at timestamptz := v_now - interval '1 minute';
  v_independent_before jsonb;
  v_renewal_before jsonb;
  v_renewal_second_before jsonb;
  v_fixed_prior_before jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_unsafe_blocked boolean := false;
  v_earlier_payment_blocked boolean := false;
  v_middle_payment_blocked boolean := false;
  v_stacked_history_blocked boolean := false;
  v_stacked_tamper_blocked boolean := false;
  v_sending_blocked boolean := false;
begin
  select role_row.user_id into v_actor
  from public.user_roles role_row
  where role_row.role::text in ('founder_admin', 'super_admin')
  order by case when role_row.role::text = 'founder_admin' then 0 else 1 end
  limit 1;
  if v_actor is null then
    raise exception 'PAYMENT_INVALIDATION_PROBE_FOUNDER_REQUIRED';
  end if;
  if exists (select 1 from public.pricing_revisions where state = 'draft') then
    raise exception 'PAYMENT_INVALIDATION_PROBE_UNRESOLVED_PRICING_DRAFT';
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
    duration_days, entitlement_mode, fixed_ends_at, description, features, cta_label,
    renewal_note, visible, display_starts_at, checkout_enabled,
    checkout_starts_at, sort_order, promotional, billing
  ) values (
    v_plan,
    v_revision,
    'bar_access_30d',
    'Rollback-only invalidation plan',
    19900,
    'PHP',
    30,
    'rolling_days',
    null,
    'Rollback-only invalidation evidence.',
    '[]'::jsonb,
    'Choose plan',
    'No automatic renewal.',
    true,
    v_now - interval '10 days',
    true,
    v_now - interval '10 days',
    1,
    false,
    'manual'
  ), (
    v_fixed_plan,
    v_revision,
    'early_access_beta',
    'Rollback-only fixed invalidation plan',
    14900,
    'PHP',
    null,
    'fixed_end',
    v_now + interval '60 days',
    'Rollback-only fixed replacement evidence.',
    '[]'::jsonb,
    'Choose plan',
    'No automatic renewal.',
    true,
    v_now - interval '10 days',
    true,
    v_now - interval '10 days',
    2,
    false,
    'manual'
  );

  insert into public.pricing_payment_channel_versions (
    id, revision_id, plan_version_id, channel_code, label,
    account_name, account_details, instructions, qr_public_path,
    amount_centavos, enabled, visible, sort_order
  ) values (
    v_channel,
    v_revision,
    v_plan,
    'invalidation_probe',
    'Rollback-only InstaPay',
    '',
    '',
    'Rollback-only.',
    '/assets/payments/bpi-instapay-199-qr.png',
    19900,
    true,
    true,
    1
  ), (
    v_fixed_channel,
    v_revision,
    v_fixed_plan,
    'invalidation_fixed_probe',
    'Rollback-only fixed InstaPay',
    '',
    '',
    'Rollback-only.',
    '/assets/payments/bpi-instapay-199-qr.png',
    14900,
    true,
    true,
    2
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
    v_user, 'payment-invalidation-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_independent_user, 'payment-invalidation-independent@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_renewal_user, 'payment-invalidation-renewal@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_fixed_user, 'payment-invalidation-fixed@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_unsafe_user, 'payment-invalidation-unsafe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  ),
  (
    v_sending_user, 'payment-invalidation-sending@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, v_now, v_now
  );

  perform public.phase4_access_snapshot(v_user, false, null);

  v_result := public.phase4_create_payment_request_v3(
    v_user,
    v_plan,
    v_channel,
    'payment-proofs',
    v_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png',
    512,
    repeat('a', 64)
  );
  v_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_payment;

  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        v_paid_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only approved payment for invalidation.',
    'paymentinvalidationprobeapproval0001'
  );
  v_subscription := (v_result->'subscription'->>'id')::uuid;

  select proof_object_path, paid_at
  into v_proof_path, v_paid_at_before
  from public.payment_requests
  where id = v_payment;

  update public.payment_requests
  set subscriber_receipt_status = 'sent',
      subscriber_receipt_attempts = 1,
      subscriber_receipt_provider_id = 'rollback-only-provider-id',
      subscriber_receipt_sent_at = v_sent_at
  where id = v_payment;

  -- Viewing an approved proof appends a proof_viewed row whose new_status is
  -- still approved. It is audit evidence, not a second approval, and must not
  -- make the unique approval/subscription lineage look ambiguous.
  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, occurred_at, metadata
  ) values (
    v_payment,
    v_actor,
    'proof_viewed',
    'approved',
    'approved',
    'Rollback-only approved proof-view audit evidence.',
    'paymentinvalidationprobeproofview0001',
    v_now,
    '{}'::jsonb
  );

  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_payment,
    'Rollback-only proof is invalid and linked access must be cancelled.',
    'paymentinvalidationprobeaction0001'
  );

  if v_result->>'action' <> 'payment_invalidate'
     or coalesce((v_result->>'accessReversed')::boolean, false) is not true
     or coalesce((v_result->>'proofPreserved')::boolean, false) is not true
     or coalesce((v_result->>'introductoryTokensPreserved')::boolean, false) is not true
     or (v_result->'access'->>'tokensRemaining')::integer <> 5 then
    raise exception 'PAYMENT_INVALIDATION_PROBE_RESULT_FAILED';
  end if;

  if not exists (
    select 1
    from public.payment_requests payment
    where payment.id = v_payment
      and payment.status = 'rejected'
      and payment.subscription_id = v_subscription
      and payment.proof_object_path = v_proof_path
      and payment.paid_at = v_paid_at_before
      and payment.subscriber_receipt_status = 'sent'
      and payment.subscriber_receipt_provider_id = 'rollback-only-provider-id'
      and payment.subscriber_receipt_sent_at = v_sent_at
  ) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_PAYMENT_OR_RECEIPT_PRESERVATION_FAILED';
  end if;

  if not exists (
    select 1
    from public.subscriptions subscription
    where subscription.id = v_subscription
      and subscription.status = 'cancelled'
      and subscription.source = 'invalidated_payment'
  ) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_SUBSCRIPTION_REVERSAL_FAILED';
  end if;

  if (select count(*) from public.introductory_token_grants where user_id = v_user) <> 1
     or (select token_limit from public.introductory_token_grants where user_id = v_user) <> 5
     or (select count(*) from public.payment_request_history
         where payment_request_id = v_payment and new_status = 'rejected') <> 1
     or (select count(*) from public.subscription_history
         where subscription_id = v_subscription and action = 'cancel') <> 1
     or not exists (
       select 1 from public.admin_audit_log audit
       where audit.target_resource_type = 'payment_request'
         and audit.target_resource_id = v_payment::text
         and audit.details->>'action' = 'payment_invalidate'
     ) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_APPEND_ONLY_AUDIT_FAILED';
  end if;

  v_replay := public.phase4_admin_invalidate_payment(
    v_actor,
    v_payment,
    'Rollback-only proof is invalid and linked access must be cancelled.',
    'paymentinvalidationprobeaction0001'
  );
  if coalesce((v_replay->>'replayed')::boolean, false) is not true
     or (select count(*) from public.payment_request_history
         where payment_request_id = v_payment and new_status = 'rejected') <> 1 then
    raise exception 'PAYMENT_INVALIDATION_PROBE_IDEMPOTENCY_FAILED';
  end if;

  insert into public.subscriptions (
    user_id, plan_code, status, starts_at, expires_at, source,
    created_by, updated_by, reason, pricing_revision_id,
    pricing_plan_version_id, term_duration_days, entitlement_mode
  ) values (
    v_independent_user,
    'bar_access_30d',
    'active',
    v_now - interval '1 year',
    null,
    'admin_adjustment',
    v_actor,
    v_actor,
    'Rollback-only independent non-expiring access.',
    v_revision,
    v_plan,
    30,
    'rolling_days'
  ) returning id into v_independent_subscription;
  select to_jsonb(subscription) into v_independent_before
  from public.subscriptions subscription
  where subscription.id = v_independent_subscription;

  v_result := public.phase4_create_payment_request_v3(
    v_independent_user, v_plan, v_channel, 'payment-proofs',
    v_independent_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('b', 64)
  );
  v_independent_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_independent_payment;
  perform public.phase4_admin_review_payment(
    v_actor,
    v_independent_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(v_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'Rollback-only approval must preserve independent stronger access.',
    'paymentinvalidationindependentapproval0001'
  );
  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_independent_payment,
    'Rollback-only invalid proof must not cancel independent stronger access.',
    'paymentinvalidationindependentaction0001'
  );
  if coalesce((v_result->>'accessReversed')::boolean, false) is true
     or (select to_jsonb(subscription) from public.subscriptions subscription
         where subscription.id = v_independent_subscription) is distinct from v_independent_before then
    raise exception 'PAYMENT_INVALIDATION_PROBE_INDEPENDENT_ACCESS_CHANGED';
  end if;

  -- Three rolling purchases intentionally share one subscription. An older
  -- purchase cannot be reversed while a later renewal remains approved. The
  -- stack can then be removed only newest-to-oldest, restoring each exact
  -- server-captured prior snapshot.
  v_result := public.phase4_create_payment_request_v3(
    v_renewal_user, v_plan, v_channel, 'payment-proofs',
    v_renewal_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('e', 64)
  );
  v_renewal_first_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '2 days'
  where id = v_renewal_first_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_renewal_first_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(v_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'Rollback-only first approval for renewal reversal.',
    'paymentinvalidationrenewalapproval0001'
  );
  v_renewal_subscription := (v_result->'subscription'->>'id')::uuid;
  select to_jsonb(subscription) into v_renewal_before
  from public.subscriptions subscription
  where subscription.id = v_renewal_subscription;

  v_result := public.phase4_create_payment_request_v3(
    v_renewal_user, v_plan, v_channel, 'payment-proofs',
    v_renewal_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('f', 64)
  );
  v_renewal_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_renewal_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_renewal_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char((v_paid_at + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'Rollback-only latest renewal approval for exact reversal.',
    'paymentinvalidationrenewalapproval0002'
  );
  if (v_result->'subscription'->>'id')::uuid <> v_renewal_subscription then
    raise exception 'PAYMENT_INVALIDATION_PROBE_RENEWAL_DID_NOT_SHARE_SUBSCRIPTION';
  end if;
  select to_jsonb(subscription) into v_renewal_second_before
  from public.subscriptions subscription
  where subscription.id = v_renewal_subscription;

  begin
    perform public.phase4_admin_invalidate_payment(
      v_actor,
      v_renewal_first_payment,
      'Rollback-only older purchase must remain protected by its later renewal.',
      'paymentinvalidationrenewaloldaction0001'
    );
  exception when others then
    if sqlerrm like '%later or ambiguous%' then
      v_earlier_payment_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_earlier_payment_blocked
     or (select status from public.payment_requests
         where id = v_renewal_first_payment) <> 'approved'
     or (select status from public.payment_requests
         where id = v_renewal_payment) <> 'approved' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_EARLIER_RENEWAL_NOT_BLOCKED';
  end if;

  v_result := public.phase4_create_payment_request_v3(
    v_renewal_user, v_plan, v_channel, 'payment-proofs',
    v_renewal_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('1', 64)
  );
  v_renewal_third_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '12 hours'
  where id = v_renewal_third_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_renewal_third_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(
        (v_paid_at + interval '36 hours') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    ),
    'Rollback-only third renewal approval for LIFO reversal.',
    'paymentinvalidationrenewalapproval0003'
  );
  if (v_result->'subscription'->>'id')::uuid <> v_renewal_subscription then
    raise exception 'PAYMENT_INVALIDATION_PROBE_THIRD_RENEWAL_DID_NOT_SHARE_SUBSCRIPTION';
  end if;

  begin
    perform public.phase4_admin_invalidate_payment(
      v_actor,
      v_renewal_payment,
      'Rollback-only middle purchase must remain protected by its later renewal.',
      'paymentinvalidationrenewalmiddle0001'
    );
  exception when others then
    if sqlerrm like '%later or ambiguous%' then
      v_middle_payment_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_middle_payment_blocked
     or (select status from public.payment_requests
         where id = v_renewal_payment) <> 'approved'
     or (select status from public.payment_requests
         where id = v_renewal_third_payment) <> 'approved' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_MIDDLE_RENEWAL_NOT_BLOCKED';
  end if;

  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_renewal_third_payment,
    'Rollback-only third invalid renewal must restore the second purchase.',
    'paymentinvalidationrenewalaction0003'
  );
  if coalesce((v_result->>'accessReversed')::boolean, false) is not true
     or coalesce((v_result->>'priorAccessRestored')::boolean, false) is not true
     or (select status from public.payment_requests
         where id = v_renewal_payment) <> 'approved'
     or (select status from public.payment_requests
         where id = v_renewal_third_payment) <> 'rejected'
     or (select to_jsonb(subscription) - array['updated_at', 'updated_by', 'reason', 'version']
         from public.subscriptions subscription
         where subscription.id = v_renewal_subscription)
        is distinct from
        (v_renewal_second_before - array['updated_at', 'updated_by', 'reason', 'version']) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_THIRD_RENEWAL_RESTORE_FAILED';
  end if;

  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_renewal_payment,
    'Rollback-only latest invalid renewal must restore prior paid access.',
    'paymentinvalidationrenewalaction0002'
  );
  if coalesce((v_result->>'accessReversed')::boolean, false) is not true
     or coalesce((v_result->>'priorAccessRestored')::boolean, false) is not true
     or (select status from public.payment_requests
         where id = v_renewal_first_payment) <> 'approved'
     or (select status from public.payment_requests
         where id = v_renewal_payment) <> 'rejected'
     or (select status from public.payment_requests
         where id = v_renewal_third_payment) <> 'rejected'
     or (select to_jsonb(subscription) - array['updated_at', 'updated_by', 'reason', 'version']
         from public.subscriptions subscription
         where subscription.id = v_renewal_subscription)
        is distinct from
        (v_renewal_before - array['updated_at', 'updated_by', 'reason', 'version']) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_LATEST_RENEWAL_RESTORE_FAILED';
  end if;

  -- A later history row that is not one of the uniquely paired descendant
  -- approval/restoration rows must also make the older reversal fail closed.
  -- The outer exception block rolls this synthetic row back before continuing.
  begin
    insert into public.subscription_history (
      subscription_id, user_id, actor_user_id, action,
      previous_state, new_state, reason, request_key
    )
    select
      subscription.id,
      subscription.user_id,
      v_actor,
      'adjust',
      to_jsonb(subscription),
      to_jsonb(subscription),
      'Rollback-only unrelated stacked history evidence.',
      'paymentinvalidationrenewalbogushistory0001'
    from public.subscriptions subscription
    where subscription.id = v_renewal_subscription;

    begin
      perform public.phase4_admin_invalidate_payment(
        v_actor,
        v_renewal_first_payment,
        'Rollback-only unrelated stacked history must fail closed.',
        'paymentinvalidationrenewalhistory0001'
      );
      raise exception 'PAYMENT_INVALIDATION_PROBE_STACKED_HISTORY_NOT_BLOCKED';
    exception when others then
      if sqlerrm like '%changed after approval%' then
        raise exception 'PAYMENT_INVALIDATION_PROBE_EXPECTED_STACKED_HISTORY_BLOCK';
      else
        raise;
      end if;
    end;
  exception when others then
    if sqlerrm = 'PAYMENT_INVALIDATION_PROBE_EXPECTED_STACKED_HISTORY_BLOCK' then
      v_stacked_history_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_stacked_history_blocked
     or (select status from public.payment_requests
         where id = v_renewal_first_payment) <> 'approved'
     or (select status from public.subscriptions
         where id = v_renewal_subscription) <> 'active' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_STACKED_HISTORY_NOT_ATOMIC';
  end if;

  -- Even after valid descendant approvals have been unwound, an unlogged
  -- version change must make the older invalidation fail closed atomically.
  update public.subscriptions
  set version = version + 1
  where id = v_renewal_subscription;
  begin
    perform public.phase4_admin_invalidate_payment(
      v_actor,
      v_renewal_first_payment,
      'Rollback-only unlogged stacked change must fail closed.',
      'paymentinvalidationrenewaltamper0001'
    );
  exception when others then
    if sqlerrm like '%changed after approval%' then
      v_stacked_tamper_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_stacked_tamper_blocked
     or (select status from public.payment_requests
         where id = v_renewal_first_payment) <> 'approved'
     or (select status from public.subscriptions
         where id = v_renewal_subscription) <> 'active' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_STACKED_TAMPER_NOT_ATOMIC';
  end if;
  update public.subscriptions
  set version = version - 1
  where id = v_renewal_subscription;

  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_renewal_first_payment,
    'Rollback-only earlier invalid purchase must unwind after its renewal.',
    'paymentinvalidationrenewaloldaction0002'
  );
  if coalesce((v_result->>'accessReversed')::boolean, false) is not true
     or (v_result->'access'->>'tokensRemaining')::integer <> 5
     or coalesce((v_result->'access'->>'unlimited')::boolean, false) is true
     or coalesce((v_result->'access'->>'paymentRequired')::boolean, false) is true
     or (v_result->'access'->'subscription') is distinct from 'null'::jsonb
     or (select status from public.payment_requests
         where id = v_renewal_first_payment) <> 'rejected'
     or (select status from public.payment_requests
         where id = v_renewal_payment) <> 'rejected'
     or (select status from public.payment_requests
         where id = v_renewal_third_payment) <> 'rejected'
     or (select status from public.subscriptions
         where id = v_renewal_subscription) <> 'cancelled'
     or (select source from public.subscriptions
         where id = v_renewal_subscription) <> 'invalidated_payment' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_STACKED_RENEWAL_UNWIND_FAILED';
  end if;

  -- A fixed-end approval can replace an existing live row. Invalidation must
  -- cancel only the purchased row and restore the exact prior row with an
  -- action accepted by the canonical subscription-history constraint.
  insert into public.subscriptions (
    user_id, plan_code, status, starts_at, expires_at, source,
    created_by, updated_by, reason, pricing_revision_id,
    pricing_plan_version_id, term_duration_days, entitlement_mode
  ) values (
    v_fixed_user,
    'bar_access_30d',
    'active',
    v_now - interval '5 days',
    v_now + interval '10 days',
    'admin_adjustment',
    v_actor,
    v_actor,
    'Rollback-only prior access for fixed replacement.',
    v_revision,
    v_plan,
    30,
    'rolling_days'
  ) returning id into v_fixed_prior_subscription;
  select to_jsonb(subscription) into v_fixed_prior_before
  from public.subscriptions subscription
  where subscription.id = v_fixed_prior_subscription;

  v_result := public.phase4_create_payment_request_v3(
    v_fixed_user, v_fixed_plan, v_fixed_channel, 'payment-proofs',
    v_fixed_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('1', 64)
  );
  v_fixed_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_fixed_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_fixed_payment,
    jsonb_build_object('status', 'approved'),
    'Rollback-only fixed approval that replaces prior access.',
    'paymentinvalidationfixedapproval0001'
  );
  v_fixed_purchased_subscription := (v_result->'subscription'->>'id')::uuid;
  if v_fixed_purchased_subscription = v_fixed_prior_subscription
     or (select status from public.subscriptions
         where id = v_fixed_prior_subscription) <> 'cancelled' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_FIXED_REPLACEMENT_NOT_CREATED';
  end if;

  v_result := public.phase4_admin_invalidate_payment(
    v_actor,
    v_fixed_payment,
    'Rollback-only invalid fixed proof must restore exact prior access.',
    'paymentinvalidationfixedaction0001'
  );
  if coalesce((v_result->>'accessReversed')::boolean, false) is not true
     or coalesce((v_result->>'priorAccessRestored')::boolean, false) is not true
     or (select status from public.payment_requests
         where id = v_fixed_payment) <> 'rejected'
     or (select status from public.subscriptions
         where id = v_fixed_purchased_subscription) <> 'cancelled'
     or (select source from public.subscriptions
         where id = v_fixed_purchased_subscription) <> 'invalidated_payment'
     or (select to_jsonb(subscription) - array['updated_at', 'updated_by', 'reason', 'version']
         from public.subscriptions subscription
         where subscription.id = v_fixed_prior_subscription)
        is distinct from
        (v_fixed_prior_before - array['updated_at', 'updated_by', 'reason', 'version'])
     or not exists (
       select 1
       from public.subscription_history history
       where history.subscription_id = v_fixed_prior_subscription
         and history.action = 'adjust'
         and history.request_key = 'paymentinvalidationfixedaction0001_prior_subscription_restore'
     ) then
    raise exception 'PAYMENT_INVALIDATION_PROBE_FIXED_PRIOR_RESTORE_FAILED';
  end if;

  v_result := public.phase4_create_payment_request_v3(
    v_unsafe_user, v_plan, v_channel, 'payment-proofs',
    v_unsafe_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('c', 64)
  );
  v_unsafe_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_unsafe_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_unsafe_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(v_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'Rollback-only approval for changed-linkage refusal.',
    'paymentinvalidationunsafeapproval0001'
  );
  v_unsafe_subscription := (v_result->'subscription'->>'id')::uuid;
  update public.subscriptions
  set reason = 'Rollback-only later subscription change.',
      updated_at = v_now,
      version = version + 1
  where id = v_unsafe_subscription;

  begin
    perform public.phase4_admin_invalidate_payment(
      v_actor,
      v_unsafe_payment,
      'Rollback-only changed access must fail closed.',
      'paymentinvalidationunsafeaction0001'
    );
  exception when others then
    if sqlerrm like '%changed after approval%' then
      v_unsafe_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_unsafe_blocked
     or (select status from public.payment_requests where id = v_unsafe_payment) <> 'approved'
     or (select status from public.subscriptions where id = v_unsafe_subscription) <> 'active' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_UNSAFE_CHANGE_NOT_ATOMIC';
  end if;

  v_result := public.phase4_create_payment_request_v3(
    v_sending_user, v_plan, v_channel, 'payment-proofs',
    v_sending_user::text || '/' || gen_random_uuid()::text || '.png',
    'image/png', 512, repeat('d', 64)
  );
  v_sending_payment := (v_result->>'id')::uuid;
  update public.payment_requests
  set submitted_at = v_now - interval '1 day'
  where id = v_sending_payment;
  v_result := public.phase4_admin_review_payment(
    v_actor,
    v_sending_payment,
    jsonb_build_object(
      'status', 'approved',
      'verifiedPaidAt', to_char(v_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'Rollback-only approval for receipt-delivery refusal.',
    'paymentinvalidationsendingapproval0001'
  );
  v_sending_subscription := (v_result->'subscription'->>'id')::uuid;
  update public.payment_requests
  set subscriber_receipt_status = 'sending',
      subscriber_receipt_last_attempt_at = v_now
  where id = v_sending_payment;

  begin
    perform public.phase4_admin_invalidate_payment(
      v_actor,
      v_sending_payment,
      'Rollback-only in-flight receipt must fail closed.',
      'paymentinvalidationsendingaction0001'
    );
  exception when others then
    if sqlerrm like '%currently being delivered%' then
      v_sending_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_sending_blocked
     or (select status from public.payment_requests where id = v_sending_payment) <> 'approved'
     or (select subscriber_receipt_status from public.payment_requests
         where id = v_sending_payment) <> 'sending'
     or (select status from public.subscriptions where id = v_sending_subscription) <> 'active' then
    raise exception 'PAYMENT_INVALIDATION_PROBE_IN_FLIGHT_RECEIPT_NOT_ATOMIC';
  end if;
end;
$payment_invalidation_probe$;

rollback;
select 'ADMIN_PAYMENT_INVALIDATION_PROBE_PASSED' as result;
