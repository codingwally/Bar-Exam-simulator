-- Due Diligence: activate the existing Premium plan and enforce examination
-- track access on the trusted backend. This migration does not alter lower-plan
-- prices, durations, genuine subscriptions, payments, attempts, or grades.

begin;

update public.plan_catalog
set display_name = 'Premium',
    price_php = 499.00,
    status = 'active',
    description = 'Complete Due Diligence access, including Subject Matter, Mock Bar access already included in paid tiers, and Premium-only Bar Feels.',
    features = '[
      "Everything in Standard",
      "All published Subject Matter practice categories",
      "Mock Bar access included by the paid-plan hierarchy",
      "Premium-only Bar Feels",
      "Private TXT and DOCX examination uploads",
      "AI and supported Human Examiner review routes"
    ]'::jsonb,
    duration_days = null,
    display_order = 30,
    promotional = false,
    checkout_enabled = true,
    note = 'Manual GCash or MariBank verification. An explicit expiration date is required before activation. No automatic renewal.',
    updated_at = now()
where plan_code = 'premium';

do $migration$
begin
  if not exists (
    select 1
    from public.plan_catalog
    where plan_code = 'premium'
      and display_name = 'Premium'
      and price_php = 499.00
      and status = 'active'
      and checkout_enabled
      and duration_days is null
  ) then
    raise exception 'PREMIUM_PLAN_BASELINE_MISMATCH';
  end if;
end;
$migration$;

alter table public.subscriptions
  drop constraint if exists subscriptions_premium_expiry_required_check;
alter table public.subscriptions
  add constraint subscriptions_premium_expiry_required_check check (
    plan_code <> 'premium'
    or status not in ('trialing', 'pending_payment', 'active', 'paused')
    or expires_at is not null
  );

create or replace function public.phase4_enforce_live_subscription_plan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('trialing', 'pending_payment', 'active', 'paused')
     and not exists (
       select 1
       from public.plan_catalog p
       where p.plan_code = new.plan_code
         and p.status = 'active'
         and p.checkout_enabled
         and (
           p.duration_days is not null
           or new.expires_at is not null
         )
     ) then
    raise exception 'Selected plan is not available for live subscription access';
  end if;
  return new;
end;
$$;

drop trigger if exists phase4_enforce_live_subscription_plan_trigger
  on public.subscriptions;
create trigger phase4_enforce_live_subscription_plan_trigger
before insert or update of plan_code, status, expires_at
on public.subscriptions
for each row execute function public.phase4_enforce_live_subscription_plan();

create or replace function public.phase4_create_payment_request(
  p_user_id uuid,
  p_plan_code text,
  p_amount_php numeric,
  p_payment_method text,
  p_payment_date date,
  p_transaction_reference text,
  p_student_note text,
  p_proof_object_path text,
  p_proof_original_name text,
  p_proof_mime_type text,
  p_proof_size_bytes integer,
  p_proof_sha256 text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.plan_catalog%rowtype;
  v_request public.payment_requests%rowtype;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Authenticated user required';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  select * into v_request
  from public.payment_requests
  where request_key = p_request_key;
  if found then
    if v_request.user_id <> p_user_id then
      raise exception 'Request key already used';
    end if;
    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'planCode', v_request.plan_code,
      'amountPhp', v_request.trusted_amount_php,
      'replayed', true
    );
  end if;

  select * into v_plan
  from public.plan_catalog
  where plan_code = lower(btrim(coalesce(p_plan_code, '')))
    and status = 'active'
    and checkout_enabled
  for share;
  if not found then
    raise exception 'Selected plan is not available for payment';
  end if;
  if round(coalesce(p_amount_php, 0), 2) <> v_plan.price_php then
    raise exception 'Payment amount must match the trusted plan price';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'payment:' || p_user_id::text || ':' || v_plan.plan_code,
    0
  ));
  select * into v_request
  from public.payment_requests
  where user_id = p_user_id
    and plan_code = v_plan.plan_code
    and status in ('pending', 'needs_information')
  order by submitted_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'planCode', v_request.plan_code,
      'amountPhp', v_request.trusted_amount_php,
      'amountCentavos', round(v_request.trusted_amount_php * 100)::integer,
      'submittedAt', v_request.submitted_at,
      'replayed', true
    );
  end if;
  if p_payment_method not in ('gcash', 'maribank') then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_date is null
     or p_payment_date < current_date - 31
     or p_payment_date > current_date + 1 then
    raise exception 'Payment date is outside the accepted range';
  end if;

  insert into public.payment_requests (
    user_id, plan_code, trusted_amount_php, payment_method, payment_date,
    transaction_reference, student_note, proof_object_path,
    proof_original_name, proof_mime_type, proof_size_bytes, proof_sha256,
    request_key
  )
  values (
    p_user_id, v_plan.plan_code, v_plan.price_php, p_payment_method,
    p_payment_date, btrim(p_transaction_reference),
    nullif(btrim(coalesce(p_student_note, '')), ''),
    p_proof_object_path, left(p_proof_original_name, 180),
    p_proof_mime_type, p_proof_size_bytes, lower(p_proof_sha256),
    p_request_key
  )
  returning * into v_request;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key
  )
  values (
    v_request.id, p_user_id, 'submitted', null, 'pending',
    'Student submitted payment for manual verification.',
    left(p_request_key, 96) || '_history'
  );

  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  )
  values (
    'payment_submitted', 'plansandpricing@duediligence.ph',
    'Due Diligence payment verification request',
    '/admin/payments?request=' || v_request.id::text,
    'payment_request', v_request.id
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'planCode', v_request.plan_code,
    'amountPhp', v_request.trusted_amount_php,
    'amountCentavos', round(v_request.trusted_amount_php * 100)::integer,
    'submittedAt', v_request.submitted_at,
    'replayed', false
  );
exception
  when unique_violation then
    if exists (
      select 1 from public.payment_requests
      where payment_method = p_payment_method
        and reference_normalized = lower(btrim(p_transaction_reference))
    ) then
      raise exception 'This transaction reference has already been submitted for this payment channel';
    end if;
    raise;
end;
$$;

create or replace function public.phase4_admin_manage_subscription(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_subscription_id uuid,
  p_payload jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_existing jsonb;
  v_result jsonb;
  v_previous jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_subscription public.subscriptions%rowtype;
  v_plan public.plan_catalog%rowtype;
  v_operation text;
  v_plan_code text;
  v_now timestamptz := now();
  v_days integer;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_history_action text;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_target_user_id is null
     or not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target user not found';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Action payload must be an object';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'A reason of 5 to 1000 characters is required';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (
    p_request_key, p_actor_user_id, 'subscription_change', p_target_user_id::text
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing
    from public.admin_action_requests
    where request_key = p_request_key
      and actor_user_id = p_actor_user_id
      and action = 'subscription_change'
      and target_resource_id = p_target_user_id::text;
    if not found then raise exception 'Request key conflict'; end if;
    if v_existing is null then raise exception 'Action is already in progress'; end if;
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text, 499));
  v_operation := lower(btrim(coalesce(p_payload->>'operation', '')));
  if v_operation not in (
    'activate', 'complimentary', 'pause', 'resume', 'cancel', 'expire',
    'restore', 'extend', 'replace_plan', 'set_start_date',
    'set_expiration_date'
  ) then
    raise exception 'Unsupported subscription operation';
  end if;

  if p_subscription_id is not null then
    select * into v_subscription
    from public.subscriptions
    where id = p_subscription_id and user_id = p_target_user_id
    for update;
    if not found then raise exception 'Subscription does not belong to target user'; end if;
    v_previous := to_jsonb(v_subscription);
  end if;

  if v_operation in ('activate', 'complimentary') then
    v_plan_code := lower(btrim(coalesce(p_payload->>'planCode', '')));
    select * into v_plan
    from public.plan_catalog
    where plan_code = v_plan_code
      and status = 'active'
      and checkout_enabled
    for share;
    if not found then raise exception 'Selected plan is not available'; end if;

    if v_plan.duration_days is null then
      v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
      if v_expires_at is null or v_expires_at <= v_now then
        raise exception 'Premium activation requires an explicit future expiration';
      end if;
    else
      v_expires_at := v_now + make_interval(days => v_plan.duration_days);
    end if;

    update public.subscriptions
    set status = 'cancelled',
        updated_at = v_now,
        updated_by = p_actor_user_id,
        reason = 'Replaced by audited Founder access action.',
        version = version + 1
    where user_id = p_target_user_id
      and status in ('trialing', 'pending_payment', 'active', 'paused');

    insert into public.subscriptions (
      user_id, plan_code, status, starts_at, expires_at, source,
      created_by, updated_by, reason
    )
    values (
      p_target_user_id,
      v_plan.plan_code,
      'active',
      v_now,
      v_expires_at,
      case when v_operation = 'complimentary'
        then 'complimentary' else 'admin_adjustment' end,
      p_actor_user_id,
      p_actor_user_id,
      btrim(p_reason)
    )
    returning * into v_subscription;
    v_history_action := case when v_operation = 'complimentary'
      then 'create' else 'activate' end;
  else
    if p_subscription_id is null or v_subscription.id is null then
      raise exception 'Existing subscription required';
    end if;

    if v_operation = 'pause' then
      if v_subscription.status <> 'active' then
        raise exception 'Only an active subscription can be paused';
      end if;
      update public.subscriptions
      set status = 'paused', updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'pause';

    elsif v_operation = 'resume' then
      if v_subscription.status <> 'paused'
         or v_subscription.expires_at is null
         or v_subscription.expires_at <= v_now then
        raise exception 'Only an unexpired paused subscription can be resumed';
      end if;
      update public.subscriptions
      set status = 'active', updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'resume';

    elsif v_operation = 'cancel' then
      if v_subscription.status not in ('trialing', 'pending_payment', 'active', 'paused') then
        raise exception 'Subscription is not revocable';
      end if;
      update public.subscriptions
      set status = 'cancelled', updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'cancel';

    elsif v_operation = 'expire' then
      if v_subscription.status not in ('trialing', 'pending_payment', 'active', 'paused') then
        raise exception 'Subscription is not expirable';
      end if;
      update public.subscriptions
      set status = 'expired',
          expires_at = greatest(coalesce(starts_at, created_at) + interval '1 second', v_now),
          updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'expire';

    elsif v_operation = 'restore' then
      if v_subscription.status not in ('cancelled', 'expired') then
        raise exception 'Only revoked or expired access can be restored';
      end if;
      v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
      if v_expires_at is null or v_expires_at <= v_now then
        raise exception 'Restoration requires an explicit future expiration';
      end if;
      update public.subscriptions
      set status = 'cancelled',
          updated_at = v_now,
          updated_by = p_actor_user_id,
          reason = 'Replaced by audited restoration.',
          version = version + 1
      where user_id = p_target_user_id
        and id <> v_subscription.id
        and status in ('trialing', 'pending_payment', 'active', 'paused');
      update public.subscriptions
      set status = 'active',
          starts_at = least(coalesce(starts_at, v_now), v_now),
          expires_at = v_expires_at,
          updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'resume';

    elsif v_operation = 'extend' then
      if v_subscription.status not in ('active', 'paused') then
        raise exception 'Only active or paused access can be extended';
      end if;
      v_days := nullif(p_payload->>'durationDays', '')::integer;
      if v_days not between 1 and 366 then
        raise exception 'Extension days must be between 1 and 366';
      end if;
      update public.subscriptions
      set expires_at = greatest(coalesce(expires_at, v_now), v_now)
            + make_interval(days => v_days),
          updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'extend';

    elsif v_operation = 'replace_plan' then
      if v_subscription.status not in ('active', 'paused') then
        raise exception 'Only active or paused access can change plan';
      end if;
      v_plan_code := lower(btrim(coalesce(p_payload->>'planCode', '')));
      select * into v_plan
      from public.plan_catalog
      where plan_code = v_plan_code
        and status = 'active'
        and checkout_enabled
      for share;
      if not found then raise exception 'Selected plan is not available'; end if;
      if v_plan.duration_days is null then
        v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
        if v_expires_at is null or v_expires_at <= v_now then
          raise exception 'Premium plan changes require an explicit future expiration';
        end if;
      else
        v_expires_at := coalesce(
          v_subscription.expires_at,
          v_now + make_interval(days => v_plan.duration_days)
        );
      end if;
      update public.subscriptions
      set plan_code = v_plan.plan_code,
          expires_at = v_expires_at,
          updated_at = v_now, updated_by = p_actor_user_id,
          reason = btrim(p_reason), version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'replace_plan';

    elsif v_operation = 'set_start_date' then
      if v_subscription.status not in ('trialing', 'pending_payment', 'active', 'paused') then
        raise exception 'Subscription start date cannot be changed in its current state';
      end if;
      v_starts_at := nullif(p_payload->>'startsAt', '')::timestamptz;
      if v_starts_at is null
         or (v_subscription.expires_at is not null and v_starts_at >= v_subscription.expires_at) then
        raise exception 'Start date must precede expiration';
      end if;
      update public.subscriptions
      set starts_at = v_starts_at, updated_at = v_now,
          updated_by = p_actor_user_id, reason = btrim(p_reason),
          version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'adjust';

    elsif v_operation = 'set_expiration_date' then
      if v_subscription.status not in ('trialing', 'pending_payment', 'active', 'paused') then
        raise exception 'Subscription expiration cannot be changed in its current state';
      end if;
      v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
      if v_expires_at is null or v_expires_at <= v_now
         or (v_subscription.starts_at is not null and v_expires_at <= v_subscription.starts_at) then
        raise exception 'Expiration must be in the future and after the start date';
      end if;
      update public.subscriptions
      set expires_at = v_expires_at, updated_at = v_now,
          updated_by = p_actor_user_id, reason = btrim(p_reason),
          version = version + 1
      where id = v_subscription.id returning * into v_subscription;
      v_history_action := 'adjust';
    end if;
  end if;

  v_new := to_jsonb(v_subscription);
  insert into public.subscription_history (
    subscription_id, user_id, actor_user_id, action,
    previous_state, new_state, reason, request_key
  ) values (
    v_subscription.id, p_target_user_id, p_actor_user_id, v_history_action,
    v_previous, v_new, btrim(p_reason), left(p_request_key, 96) || '_subscription'
  );

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id,
    target_resource_type, target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'subscription_changed',
    p_target_user_id,
    'subscription_access',
    p_target_user_id::text,
    btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'action', 'subscription_change',
      'operation', v_operation,
      'previous', v_previous,
      'new', v_new
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'subscription_change',
    'operation', v_operation,
    'targetUserId', p_target_user_id,
    'result', v_new,
    'requestKey', p_request_key,
    'replayed', false
  );
  update public.admin_action_requests
  set result = v_result, completed_at = v_now
  where request_key = p_request_key;
  return v_result;
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_existing jsonb;
  v_result jsonb;
  v_payment public.payment_requests%rowtype;
  v_plan public.plan_catalog%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_status text;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_previous jsonb;
  v_new jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'A reason of 5 to 1000 characters is required';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;

  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (
    p_request_key, p_actor_user_id, 'payment_review', p_payment_request_id::text
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing
    from public.admin_action_requests
    where request_key = p_request_key
      and actor_user_id = p_actor_user_id
      and action = 'payment_review'
      and target_resource_id = p_payment_request_id::text;
    if not found then raise exception 'Request key conflict'; end if;
    if v_existing is null then raise exception 'Action is already in progress'; end if;
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  select * into v_payment
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'Payment request not found'; end if;

  v_status := lower(btrim(coalesce(p_payload->>'status', '')));
  if v_status not in ('needs_information', 'approved', 'rejected') then
    raise exception 'Invalid payment review status';
  end if;
  if v_payment.status not in ('pending', 'needs_information') then
    raise exception 'Payment request is no longer reviewable';
  end if;
  v_previous := to_jsonb(v_payment) - array[
    'student_note','proof_object_path','proof_original_name','proof_sha256'
  ];

  if v_status = 'approved' then
    select * into v_plan
    from public.plan_catalog
    where plan_code = v_payment.plan_code
      and status = 'active'
      and checkout_enabled
      and price_php = v_payment.trusted_amount_php
    for share;
    if not found then raise exception 'Trusted payment plan is not active'; end if;

    if v_plan.duration_days is null then
      v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
      if v_expires_at is null or v_expires_at <= v_now then
        raise exception 'Premium payment approval requires an explicit future expiration';
      end if;
    else
      v_expires_at := v_now + make_interval(days => v_plan.duration_days);
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_payment.user_id::text, 500));
    update public.subscriptions
    set status = 'cancelled',
        updated_at = v_now,
        updated_by = p_actor_user_id,
        reason = 'Replaced by newly approved manual payment.',
        version = version + 1
    where user_id = v_payment.user_id
      and status in ('trialing', 'pending_payment', 'active', 'paused');

    insert into public.subscriptions (
      user_id, plan_code, status, starts_at, expires_at, source,
      created_by, updated_by, reason
    ) values (
      v_payment.user_id, v_plan.plan_code, 'active', v_now,
      v_expires_at, 'manual_payment',
      p_actor_user_id, p_actor_user_id, btrim(p_reason)
    )
    returning * into v_subscription;

    insert into public.subscription_history (
      subscription_id, user_id, actor_user_id, action,
      previous_state, new_state, reason, request_key
    ) values (
      v_subscription.id, v_subscription.user_id, p_actor_user_id, 'activate',
      '{}'::jsonb, to_jsonb(v_subscription), btrim(p_reason),
      left(p_request_key, 96) || '_subscription'
    );
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
      updated_at = v_now,
      version = version + 1
  where id = v_payment.id
  returning * into v_payment;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key
  ) values (
    v_payment.id, p_actor_user_id, v_status, v_previous->>'status', v_status,
    btrim(p_reason), left(p_request_key, 96) || '_payment'
  );

  v_new := to_jsonb(v_payment) - array[
    'student_note','proof_object_path','proof_original_name','proof_sha256'
  ];
  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'payment_changed', v_payment.user_id,
    'payment_request', v_payment.id::text, btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'previous', v_previous,
      'new', v_new,
      'subscriptionSource', case when v_status = 'approved' then 'manual_payment' else null end
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'payment_review',
    'targetUserId', v_payment.user_id,
    'payment', v_new,
    'subscription', case when v_subscription.id is null then null else to_jsonb(v_subscription) end,
    'requestKey', p_request_key,
    'replayed', false
  );
  update public.admin_action_requests
  set result = v_result, completed_at = v_now
  where request_key = p_request_key;
  return v_result;
end;
$$;

create or replace function public.phase4_admin_premium_access(
  p_actor_user_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if v_status not in ('all', 'active', 'pending', 'expired', 'suspended', 'revoked', 'beta') then
    raise exception 'Unsupported Premium access filter';
  end if;

  with latest_subscription as (
    select distinct on (s.user_id)
      s.*
    from public.subscriptions s
    order by s.user_id, s.updated_at desc, s.created_at desc
  ),
  rows as (
    select
      p.id as user_id,
      p.display_name,
      p.created_at,
      coalesce(r.role, 'student') as role,
      t.started_at as trial_started_at,
      t.expires_at as trial_expires_at,
      coalesce(g.successful_grades, 0) as successful_grades,
      greatest(0, 3 - coalesce(g.successful_grades, 0)) as free_grades_remaining,
      b.enabled as free_beta_enabled,
      b.expires_at as free_beta_expires_at,
      s.id as subscription_id,
      s.plan_code,
      s.status as subscription_status,
      s.source as subscription_source,
      s.starts_at,
      s.expires_at,
      exists (
        select 1
        from public.payment_requests pay
        where pay.user_id = p.id
          and pay.plan_code = 'premium'
          and pay.status in ('pending', 'needs_information')
      ) as premium_payment_pending,
      case
        when s.plan_code = 'premium'
          and s.source = 'complimentary'
          and s.status = 'active'
          and s.starts_at <= now()
          and s.expires_at > now() then 'beta'
        when s.plan_code = 'premium'
          and s.status = 'active'
          and s.starts_at <= now()
          and s.expires_at > now() then 'active'
        when exists (
          select 1 from public.payment_requests pay
          where pay.user_id = p.id and pay.plan_code = 'premium'
            and pay.status in ('pending', 'needs_information')
        ) then 'pending'
        when s.plan_code = 'premium'
          and (s.status = 'expired' or s.expires_at <= now()) then 'expired'
        when s.plan_code = 'premium' and s.status = 'paused' then 'suspended'
        when s.plan_code = 'premium' and s.status in ('cancelled', 'refunded') then 'revoked'
        else 'none'
      end as premium_state
    from public.profiles p
    left join public.user_roles r on r.user_id = p.id
    left join public.access_trials t on t.user_id = p.id
    left join public.lifetime_grade_usage g on g.user_id = p.id
    left join public.free_beta_access b on b.user_id = p.id
    left join latest_subscription s on s.user_id = p.id
    where v_search = ''
       or lower(coalesce(p.display_name, '')) like '%' || v_search || '%'
       or p.id::text = v_search
  ),
  filtered as (
    select *
    from rows
    where v_status = 'all' or premium_state = v_status
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (
        select * from filtered
        order by created_at desc
        limit v_limit offset v_offset
      ) q
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'premiumSummary', jsonb_build_object(
      'active', (select count(*) from rows where premium_state = 'active'),
      'pending', (select count(*) from rows where premium_state = 'pending'),
      'expired', (select count(*) from rows where premium_state = 'expired'),
      'suspended', (select count(*) from rows where premium_state = 'suspended'),
      'revoked', (select count(*) from rows where premium_state = 'revoked'),
      'beta', (select count(*) from rows where premium_state = 'beta')
    ),
    'filter', v_status
  )
  into v_result;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type, target_resource_id,
    reason, details
  ) values (
    p_actor_user_id, 'sensitive_data_viewed', 'premium_access', v_status,
    'Authorized Founder Premium access view.',
    jsonb_build_object(
      'filter', v_status,
      'resultCount', jsonb_array_length(coalesce(v_result->'items', '[]'::jsonb))
    )
  );
  return v_result;
end;
$$;

create or replace function public.phase4_user_subscription_status(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'subscription', (
      select jsonb_build_object(
        'id', s.id,
        'planCode', s.plan_code,
        'status', case
          when s.status = 'active' and s.expires_at is not null and s.expires_at <= now()
            then 'expired'
          else s.status
        end,
        'source', s.source,
        'startsAt', s.starts_at,
        'expiresAt', s.expires_at
      )
      from public.subscriptions s
      where s.user_id = p_user_id
      order by s.updated_at desc, s.created_at desc
      limit 1
    ),
    'pendingPayment', (
      select jsonb_build_object(
        'id', p.id,
        'planCode', p.plan_code,
        'amountPhp', p.trusted_amount_php,
        'status', p.status,
        'submittedAt', p.submitted_at
      )
      from public.payment_requests p
      where p.user_id = p_user_id
        and p.status in ('pending', 'needs_information')
      order by p.submitted_at desc
      limit 1
    ),
    'examinationBeta', (
      select jsonb_build_object(
        'enabled', b.enabled,
        'expiresAt', b.expires_at,
        'active', b.enabled and (b.expires_at is null or b.expires_at > now())
      )
      from public.examination_beta_access b
      where b.user_id = p_user_id
    )
  )
  where exists (select 1 from auth.users where id = p_user_id);
$$;

create or replace function public.examination_authorize_access(
  p_user_id uuid,
  p_track text default null,
  p_version_id uuid default null,
  p_attempt_id uuid default null,
  p_allow_historical boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_role text;
  v_source text;
  v_access jsonb;
  v_basis text := 'locked';
  v_allowed boolean := false;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if p_attempt_id is not null then
    select d.track
    into v_track
    from public.examination_attempts_multi a
    join public.examination_versions ev on ev.id = a.version_id
    join public.examination_definitions d on d.id = ev.exam_id
    where a.id = p_attempt_id
      and a.user_id = p_user_id;
    if v_track is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if p_allow_historical then
      return jsonb_build_object(
        'allowed', true,
        'basis', 'historical_owner',
        'track', v_track
      );
    end if;
  elsif p_version_id is not null then
    select d.track
    into v_track
    from public.examination_versions ev
    join public.examination_definitions d on d.id = ev.exam_id
    where ev.id = p_version_id;
    if v_track is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
  elsif p_allow_historical and exists (
    select 1 from public.examination_attempts_multi
    where user_id = p_user_id
  ) then
    return jsonb_build_object(
      'allowed', true,
      'basis', 'historical_owner',
      'track', null
    );
  elsif p_allow_historical and v_track is null then
    v_access := public.phase4_access_snapshot(p_user_id, false, null);
    if coalesce((v_access->>'allowed')::boolean, false) then
      return jsonb_build_object(
        'allowed', true,
        'basis', coalesce(v_access->>'basis', 'current_access'),
        'track', null
      );
    end if;
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if v_track not in ('per_subject', 'bar_feels') then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  select coalesce(role, 'student')
  into v_role
  from public.user_roles
  where user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  if v_role in ('super_admin', 'founder_admin') then
    v_allowed := true;
    v_basis := v_role;
  elsif exists (
    select 1
    from public.examination_beta_access
    where user_id = p_user_id
      and enabled
      and (expires_at is null or expires_at > now())
  ) then
    v_allowed := true;
    v_basis := 'examination_beta';
  elsif v_track = 'bar_feels' then
    select s.source
    into v_source
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.plan_code = 'premium'
      and s.status = 'active'
      and s.starts_at <= now()
      and s.expires_at is not null
      and s.expires_at > now()
    order by s.updated_at desc
    limit 1;
    if v_source is not null then
      v_access := public.phase4_access_snapshot(p_user_id, false, null);
      if coalesce((v_access->>'allowed')::boolean, false) then
        v_allowed := true;
        v_basis := case when v_source = 'complimentary'
          then 'premium_beta' else 'premium_paid' end;
      else
        raise exception 'EXAM_ACCESS_REQUIRED';
      end if;
    end if;
  else
    v_access := public.phase4_access_snapshot(p_user_id, false, null);
    v_allowed := coalesce((v_access->>'allowed')::boolean, false);
    v_basis := coalesce(v_access->>'basis', 'locked');
  end if;

  if not v_allowed then
    if v_track = 'bar_feels' then raise exception 'EXAM_PREMIUM_REQUIRED'; end if;
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'basis', v_basis,
    'track', v_track
  );
end;
$$;

create or replace function public.examination_has_beta_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.examination_is_admin(p_user_id)
    or exists (
      select 1 from public.examination_beta_access
      where user_id = p_user_id
        and enabled
        and (expires_at is null or expires_at > now())
    )
    or (
      exists (
        select 1
        from public.platform_access_settings s
        where exists (
          select 1
          from public.terms_acceptances t
          where t.user_id = p_user_id
            and t.terms_version = s.current_terms_version
            and t.privacy_version = s.current_privacy_version
        )
      )
      and (
        exists (
          select 1 from public.free_beta_access b
          where b.user_id = p_user_id
            and b.enabled
            and (b.expires_at is null or b.expires_at > now())
        )
        or exists (
          select 1 from public.subscriptions s
          where s.user_id = p_user_id
            and s.status = 'active'
            and s.starts_at <= now()
            and (s.expires_at is null or s.expires_at > now())
        )
        or exists (
          select 1 from public.access_trials t
          where t.user_id = p_user_id and t.expires_at > now()
        )
        or coalesce((
          select g.successful_grades
          from public.lifetime_grade_usage g
          where g.user_id = p_user_id
        ), 0) < coalesce((
          select s.lifetime_free_grades
          from public.platform_access_settings s
          where s.singleton = true
        ), 3)
      )
    )
    or exists (
      select 1
      from public.examination_attempts_multi a
      where a.user_id = p_user_id
    );
$$;

revoke all on function public.phase4_enforce_live_subscription_plan()
  from public, anon, authenticated;
revoke all on function public.phase4_create_payment_request(
  uuid, text, numeric, text, date, text, text, text, text, text,
  integer, text, text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_manage_subscription(
  uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_review_payment(
  uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_premium_access(
  uuid, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.phase4_user_subscription_status(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function public.examination_has_beta_access(uuid)
  from public, anon, authenticated;

grant execute on function public.phase4_create_payment_request(
  uuid, text, numeric, text, date, text, text, text, text, text,
  integer, text, text
) to service_role;
grant execute on function public.phase4_admin_manage_subscription(
  uuid, uuid, uuid, jsonb, text, text
) to service_role;
grant execute on function public.phase4_admin_review_payment(
  uuid, uuid, jsonb, text, text
) to service_role;
grant execute on function public.phase4_admin_premium_access(
  uuid, text, text, integer, integer
) to service_role;
grant execute on function public.phase4_user_subscription_status(uuid)
  to service_role;
grant execute on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) to service_role;
grant execute on function public.examination_has_beta_access(uuid)
  to service_role;

commit;
