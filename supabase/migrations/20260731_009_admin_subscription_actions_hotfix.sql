-- Focused hotfix for Founder subscription controls.
-- Adds a founder-only, idempotent access-management RPC, audited history read,
-- and a database guard that prevents disabled plans from becoming live.

begin;

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
         and p.duration_days is not null
     ) then
    raise exception 'Selected plan is not available for live subscription access';
  end if;
  return new;
end;
$$;

drop trigger if exists phase4_enforce_live_subscription_plan_trigger
  on public.subscriptions;
create trigger phase4_enforce_live_subscription_plan_trigger
before insert or update of plan_code, status
on public.subscriptions
for each row execute function public.phase4_enforce_live_subscription_plan();

create or replace function public.phase4_admin_manage_access(
  p_actor_user_id uuid,
  p_action text,
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
  v_beta public.free_beta_access%rowtype;
  v_discount public.discount_codes%rowtype;
  v_assignment public.discount_assignments%rowtype;
  v_operation text;
  v_plan_code text;
  v_code text;
  v_now timestamptz := clock_timestamp();
  v_days integer;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_history_action text;
  v_audit_action text;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if p_target_user_id is null
     or not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target user not found';
  end if;
  if p_action not in ('subscription_change', 'free_beta_change', 'discount_assign') then
    raise exception 'Unsupported access-management action';
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
    p_request_key, p_actor_user_id, p_action, p_target_user_id::text
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select result into v_existing
    from public.admin_action_requests
    where request_key = p_request_key
      and actor_user_id = p_actor_user_id
      and action = p_action
      and target_resource_id = p_target_user_id::text;
    if not found then raise exception 'Request key conflict'; end if;
    if v_existing is null then raise exception 'Action is already in progress'; end if;
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text, 409));

  if p_action = 'subscription_change' then
    v_operation := lower(btrim(coalesce(p_payload->>'operation', '')));
    if v_operation not in (
      'activate', 'complimentary', 'pause', 'resume', 'cancel', 'extend',
      'replace_plan', 'set_start_date', 'set_expiration_date'
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
        and duration_days = 30
      for share;
      if not found then
        raise exception 'Selected plan is not available; Premium remains held in abeyance';
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
      ) values (
        p_target_user_id,
        v_plan.plan_code,
        'active',
        v_now,
        v_now + make_interval(days => v_plan.duration_days),
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
           or (v_subscription.expires_at is not null and v_subscription.expires_at <= v_now) then
          raise exception 'Only an unexpired paused subscription can be resumed';
        end if;
        update public.subscriptions
        set status = 'active', updated_at = v_now, updated_by = p_actor_user_id,
            reason = btrim(p_reason), version = version + 1
        where id = v_subscription.id returning * into v_subscription;
        v_history_action := 'resume';

      elsif v_operation = 'cancel' then
        if v_subscription.status not in ('trialing', 'pending_payment', 'active', 'paused') then
          raise exception 'Subscription is not cancellable';
        end if;
        update public.subscriptions
        set status = 'cancelled', updated_at = v_now, updated_by = p_actor_user_id,
            reason = btrim(p_reason), version = version + 1
        where id = v_subscription.id returning * into v_subscription;
        v_history_action := 'cancel';

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
          and duration_days = 30
        for share;
        if not found then
          raise exception 'Selected plan is not available; Premium remains held in abeyance';
        end if;
        update public.subscriptions
        set plan_code = v_plan.plan_code, updated_at = v_now,
            updated_by = p_actor_user_id, reason = btrim(p_reason),
            version = version + 1
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
    v_audit_action := 'subscription_changed';

  elsif p_action = 'free_beta_change' then
    if jsonb_typeof(p_payload->'enabled') <> 'boolean' then
      raise exception 'Free Beta state must be boolean';
    end if;
    select to_jsonb(b) into v_previous
    from public.free_beta_access b
    where b.user_id = p_target_user_id
    for update;
    v_expires_at := nullif(p_payload->>'expiresAt', '')::timestamptz;
    if coalesce((p_payload->>'enabled')::boolean, false)
       and v_expires_at is not null and v_expires_at <= v_now then
      raise exception 'Free Beta expiration must be in the future';
    end if;
    insert into public.free_beta_access (
      user_id, enabled, expires_at, reason, created_by, updated_by
    ) values (
      p_target_user_id,
      (p_payload->>'enabled')::boolean,
      case when (p_payload->>'enabled')::boolean then v_expires_at else null end,
      btrim(p_reason),
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (user_id) do update
    set enabled = excluded.enabled,
        expires_at = excluded.expires_at,
        reason = excluded.reason,
        updated_at = v_now,
        updated_by = p_actor_user_id
    returning * into v_beta;
    v_new := to_jsonb(v_beta);
    insert into public.free_beta_access_history (
      user_id, actor_user_id, previous_state, new_state, reason, request_key
    ) values (
      p_target_user_id, p_actor_user_id, coalesce(v_previous, '{}'::jsonb),
      v_new, btrim(p_reason), left(p_request_key, 96) || '_free_beta'
    );
    v_audit_action := 'subscription_changed';

  elsif p_action = 'discount_assign' then
    v_code := upper(btrim(coalesce(p_payload->>'code', '')));
    if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,39}$' then
      raise exception 'Invalid discount code';
    end if;
    select * into v_discount
    from public.discount_codes
    where code = v_code
      and state = 'active'
      and (starts_at is null or starts_at <= v_now)
      and (ends_at is null or ends_at > v_now)
    for update;
    if not found then raise exception 'Discount code is not active'; end if;
    if v_discount.plan_code is not null and not exists (
      select 1 from public.subscriptions s
      where s.user_id = p_target_user_id
        and s.plan_code = v_discount.plan_code
        and s.status in ('active', 'paused')
    ) then
      raise exception 'Discount code does not match the target subscription plan';
    end if;
    if v_discount.total_limit is not null and (
      select count(*) from public.discount_assignments a
      where a.discount_id = v_discount.id and a.revoked_at is null
    ) >= v_discount.total_limit and not exists (
      select 1 from public.discount_assignments a
      where a.discount_id = v_discount.id
        and a.user_id = p_target_user_id
        and a.revoked_at is null
    ) then
      raise exception 'Discount assignment limit has been reached';
    end if;
    select to_jsonb(a) into v_previous
    from public.discount_assignments a
    where a.discount_id = v_discount.id and a.user_id = p_target_user_id
    for update;
    if coalesce((v_previous->>'revoked_at') is null and v_previous <> '{}'::jsonb, false) then
      raise exception 'Discount is already assigned to this user';
    end if;
    insert into public.discount_assignments (
      discount_id, user_id, assigned_by, assigned_at, revoked_at, reason
    ) values (
      v_discount.id, p_target_user_id, p_actor_user_id, v_now, null, btrim(p_reason)
    )
    on conflict (discount_id, user_id) do update
    set assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at,
        revoked_at = null,
        reason = excluded.reason
    returning * into v_assignment;
    v_new := jsonb_build_object(
      'assignmentId', v_assignment.id,
      'discountId', v_discount.id,
      'code', v_discount.code,
      'assignedAt', v_assignment.assigned_at
    );
    v_audit_action := 'discount_changed';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id,
    target_resource_type, target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    v_audit_action,
    p_target_user_id,
    case when p_action = 'discount_assign'
      then 'discount_assignment' else 'subscription_access' end,
    p_target_user_id::text,
    btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'action', p_action,
      'operation', coalesce(v_operation, p_action),
      'previous', coalesce(v_previous, '{}'::jsonb),
      'new', coalesce(v_new, '{}'::jsonb)
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'action', p_action,
    'operation', coalesce(v_operation, p_action),
    'targetUserId', p_target_user_id,
    'result', coalesce(v_new, '{}'::jsonb),
    'requestKey', p_request_key,
    'replayed', false
  );
  update public.admin_action_requests
  set result = v_result, completed_at = v_now
  where request_key = p_request_key;
  return v_result;
end;
$$;

create or replace function public.phase4_admin_subscription_audit(
  p_actor_user_id uuid,
  p_target_user_id uuid,
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
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_target_user_id is null
     or not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target user not found';
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
    p_request_key, p_actor_user_id, 'subscription_audit_view', p_target_user_id::text
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing
    from public.admin_action_requests
    where request_key = p_request_key
      and actor_user_id = p_actor_user_id
      and action = 'subscription_audit_view'
      and target_resource_id = p_target_user_id::text;
    if not found then raise exception 'Request key conflict'; end if;
    if v_existing is null then raise exception 'Action is already in progress'; end if;
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text, 410));

  v_result := jsonb_build_object(
    'targetUserId', p_target_user_id,
    'subscriptionHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', h.action,
        'planCode', h.new_state->>'plan_code',
        'status', h.new_state->>'status',
        'reason', h.reason,
        'occurredAt', h.occurred_at
      ) order by h.occurred_at desc), '[]'::jsonb)
      from public.subscription_history h
      where h.user_id = p_target_user_id
    ),
    'freeBetaHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'enabled', coalesce((h.new_state->>'enabled')::boolean, false),
        'reason', h.reason,
        'occurredAt', h.occurred_at
      ) order by h.occurred_at desc), '[]'::jsonb)
      from public.free_beta_access_history h
      where h.user_id = p_target_user_id
    ),
    'discountHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', d.code,
        'reason', a.reason,
        'occurredAt', a.assigned_at,
        'revokedAt', a.revoked_at
      ) order by a.assigned_at desc), '[]'::jsonb)
      from public.discount_assignments a
      join public.discount_codes d on d.id = a.discount_id
      where a.user_id = p_target_user_id
    ),
    'auditHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'actionType', a.action_type,
        'reason', a.reason,
        'occurredAt', a.occurred_at
      ) order by a.occurred_at desc), '[]'::jsonb)
      from public.admin_audit_log a
      where a.target_user_id = p_target_user_id
        and a.action_type in ('subscription_changed', 'discount_changed')
    ),
    'requestKey', p_request_key,
    'replayed', false
  );

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id,
    target_resource_type, target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'sensitive_data_viewed',
    p_target_user_id,
    'subscription_audit_history',
    p_target_user_id::text,
    btrim(p_reason),
    jsonb_build_object('requestKey', p_request_key, 'view', 'subscription_audit')
  );

  update public.admin_action_requests
  set result = v_result, completed_at = now()
  where request_key = p_request_key;
  return v_result;
end;
$$;

revoke all on function public.phase4_enforce_live_subscription_plan()
  from public, anon, authenticated;
revoke all on function public.phase4_admin_manage_access(
  uuid, text, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.phase4_admin_subscription_audit(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.phase4_admin_manage_access(
  uuid, text, uuid, uuid, jsonb, text, text
) to service_role;
grant execute on function public.phase4_admin_subscription_audit(
  uuid, uuid, text, text
) to service_role;

commit;
