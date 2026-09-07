-- Founder-only invalidation of an approved payment proof.
--
-- The reversal is deliberately separate from payment approval and generic
-- subscription administration. It fails closed unless the subscription state
-- can be tied uniquely to the approved payment, preserves the proof and every
-- history row, and never replenishes the one-time introductory-token ledger.

begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_source_check;

alter table public.subscriptions
  add constraint subscriptions_source_check check (source in (
    'manual_payment', 'complimentary', 'admin_adjustment', 'migration',
    'invalidated_payment'
  )) not valid;

alter table public.subscriptions
  validate constraint subscriptions_source_check;

alter table public.subscriptions
  drop constraint if exists subscriptions_invalidated_payment_cancelled_check;

alter table public.subscriptions
  add constraint subscriptions_invalidated_payment_cancelled_check check (
    source <> 'invalidated_payment' or status = 'cancelled'
  ) not valid;

alter table public.subscriptions
  validate constraint subscriptions_invalidated_payment_cancelled_check;

create or replace function public.phase4_admin_invalidate_payment(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_inserted integer := 0;
  v_pair_count integer := 0;
  v_existing_action public.admin_action_requests%rowtype;
  v_payment public.payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_prior_subscription public.subscriptions%rowtype;
  v_approval_history public.subscription_history%rowtype;
  v_prior_snapshot jsonb;
  v_previous_payment jsonb;
  v_previous_subscription jsonb := '{}'::jsonb;
  v_previous_prior_subscription jsonb := '{}'::jsonb;
  v_access jsonb;
  v_result jsonb;
  v_prior_subscription_id uuid;
  v_receipt_status_before text;
  v_access_reversed boolean := false;
  v_prior_access_restored boolean := false;
  v_descendant_unwind_valid boolean := false;
  v_subscription_changed boolean := false;
  v_subscription_already_inactive boolean := false;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
     or p_request_key is null
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid invalidation reason and request key required';
  end if;

  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (
    p_request_key,
    p_actor_user_id,
    'payment_invalidate',
    p_payment_request_id::text
  ) on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select request.* into v_existing_action
    from public.admin_action_requests request
    where request.request_key = p_request_key;

    if v_existing_action.actor_user_id <> p_actor_user_id
       or v_existing_action.action <> 'payment_invalidate'
       or v_existing_action.target_resource_id <> p_payment_request_id::text then
      raise exception 'Request key conflict';
    end if;
    if v_existing_action.result is null then
      raise exception 'Action is already in progress';
    end if;
    return v_existing_action.result || jsonb_build_object('replayed', true);
  end if;

  select payment.* into v_payment
  from public.payment_requests payment
  where payment.id = p_payment_request_id
  for update;

  if v_payment.id is null then
    raise exception 'Payment request not found';
  end if;
  if v_payment.status <> 'approved' then
    raise exception 'Only an approved payment can be marked invalid';
  end if;
  if v_payment.subscriber_receipt_status = 'sending' then
    raise exception 'The subscriber receipt is currently being delivered. Wait for delivery to finish, then try again; nothing changed';
  end if;

  if exists (
    select 1
    from public.refund_requests refund
    where refund.payment_request_id = v_payment.id
      and refund.status in ('pending', 'needs_information', 'approved', 'paid')
  ) then
    raise exception 'This payment has an active refund workflow and cannot be invalidated automatically; nothing changed';
  end if;

  v_receipt_status_before := v_payment.subscriber_receipt_status;
  v_previous_payment := to_jsonb(v_payment) - array[
    'student_note', 'proof_object_path', 'proof_original_name', 'proof_sha256',
    'trusted_payment_account_details', 'transaction_reference',
    'reference_normalized'
  ];

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription:' || v_payment.user_id::text, 0)
  );
  -- The current generic Founder subscription manager uses this older lock
  -- family. Taking both locks keeps invalidation serialized with approval and
  -- with a concurrent Revoke/Restore operation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_payment.user_id::text, 499)
  );

  if v_payment.approved_entitlement_changed is distinct from false then
    if v_payment.subscription_id is null then
      raise exception 'Approved payment linkage is incomplete; nothing changed. Review Subscription history before manual recovery';
    end if;

    if (
      select count(*)
      from public.payment_request_history payment_history
      where payment_history.payment_request_id = v_payment.id
        and payment_history.action = 'approved'
    ) <> 1 then
      raise exception 'Approved payment linkage is ambiguous; nothing changed. Review Payment and Subscription history before manual recovery';
    end if;

    select count(*) into v_pair_count
    from public.payment_request_history payment_history
    join public.subscription_history subscription_history
      on subscription_history.subscription_id = v_payment.subscription_id
     and subscription_history.request_key = pg_catalog.regexp_replace(
       payment_history.request_key,
       '_payment$',
       '_subscription'
     )
    where payment_history.payment_request_id = v_payment.id
      and payment_history.action = 'approved'
      and payment_history.new_status = 'approved'
      and payment_history.previous_status in ('pending', 'needs_information')
      and payment_history.request_key ~ '_payment$'
      and subscription_history.user_id = v_payment.user_id
      and subscription_history.actor_user_id = payment_history.actor_user_id;

    if v_pair_count <> 1 then
      raise exception 'Approved payment linkage is ambiguous; nothing changed. Review Payment and Subscription history before manual recovery';
    end if;

    select subscription_history.* into v_approval_history
    from public.payment_request_history payment_history
    join public.subscription_history subscription_history
      on subscription_history.subscription_id = v_payment.subscription_id
     and subscription_history.request_key = pg_catalog.regexp_replace(
       payment_history.request_key,
       '_payment$',
       '_subscription'
     )
    where payment_history.payment_request_id = v_payment.id
      and payment_history.action = 'approved'
      and payment_history.new_status = 'approved'
      and payment_history.previous_status in ('pending', 'needs_information')
      and payment_history.request_key ~ '_payment$'
      and subscription_history.user_id = v_payment.user_id
      and subscription_history.actor_user_id = payment_history.actor_user_id;

    if v_approval_history.actor_user_id is distinct from v_payment.reviewed_by then
      raise exception 'Approved payment linkage is ambiguous; nothing changed. Review Payment and Subscription history before manual recovery';
    end if;
    if coalesce(v_approval_history.new_state->>'version', '') !~ '^[0-9]+$' then
      raise exception 'Approved payment linkage is ambiguous; nothing changed. Review Payment and Subscription history before manual recovery';
    end if;

    select subscription.* into v_subscription
    from public.subscriptions subscription
    where subscription.id = v_payment.subscription_id
      and subscription.user_id = v_payment.user_id
    for update;

    if v_subscription.id is null then
      raise exception 'The linked subscription is unavailable; nothing changed. Review Subscription history before manual recovery';
    end if;

    v_prior_snapshot := v_payment.approved_prior_subscription_state;

    if v_prior_snapshot is null then
      -- Legacy approvals did not persist a prior snapshot. Only an activation
      -- from an empty previous row, with no second subscription, is safe to
      -- void automatically. Extensions and replacements fail closed.
      if v_approval_history.action is distinct from 'activate'
         or v_approval_history.previous_state is distinct from '{}'::jsonb
         or v_approval_history.new_state->>'id' is distinct from v_subscription.id::text
         or v_approval_history.new_state->>'source' is distinct from 'manual_payment'
         or exists (
           select 1
           from public.subscriptions other_subscription
           where other_subscription.user_id = v_payment.user_id
             and other_subscription.id <> v_subscription.id
         ) then
        raise exception 'Legacy approved payment access cannot be reversed safely; nothing changed. Review Subscription history before manual recovery';
      end if;
    else
      if coalesce(v_prior_snapshot->>'snapshotVersion', '') <> '1'
         or coalesce(v_prior_snapshot->>'subscriptionId', '') !~ '^[0-9a-f-]{36}$'
         or coalesce(v_prior_snapshot->>'planCode', '') !~ '^[a-z][a-z0-9_]{2,63}$'
         or coalesce(v_prior_snapshot->>'status', '') not in ('trialing', 'pending_payment', 'active', 'paused')
         or coalesce(v_prior_snapshot->>'source', '') not in (
           'manual_payment', 'complimentary', 'admin_adjustment', 'migration'
         )
         or coalesce(v_prior_snapshot->>'pricingRevisionId', '') !~ '^([0-9a-f-]{36})?$'
         or coalesce(v_prior_snapshot->>'pricingPlanVersionId', '') !~ '^([0-9a-f-]{36})?$'
         or coalesce(v_prior_snapshot->>'termDurationDays', '') !~ '^([0-9]{1,3})?$'
         or coalesce(v_prior_snapshot->>'entitlementMode', '') !~ '^(fixed_end|rolling_days)?$' then
        raise exception 'Approved payment prior-access snapshot is invalid; nothing changed. Review Subscription history before manual recovery';
      end if;
      v_prior_subscription_id := (v_prior_snapshot->>'subscriptionId')::uuid;

      if v_prior_subscription_id = v_subscription.id then
        if v_approval_history.action not in ('extend', 'replace_plan')
           or v_approval_history.previous_state->>'id' is distinct from v_subscription.id::text
           or v_approval_history.previous_state->>'user_id' is distinct from v_payment.user_id::text
           or v_approval_history.new_state->>'id' is distinct from v_subscription.id::text
           or v_approval_history.new_state->>'user_id' is distinct from v_payment.user_id::text
           or coalesce(v_approval_history.previous_state->>'version', '') !~ '^[0-9]+$'
           or (case
             when v_approval_history.previous_state->>'version' ~ '^[0-9]+$'
             then (v_approval_history.new_state->>'version')::numeric
               <> (v_approval_history.previous_state->>'version')::numeric + 1
             else true
           end)
           or v_prior_snapshot->'subscriptionId'
             is distinct from v_approval_history.previous_state->'id'
           or v_prior_snapshot->'planCode'
             is distinct from v_approval_history.previous_state->'plan_code'
           or v_prior_snapshot->'status'
             is distinct from v_approval_history.previous_state->'status'
           or v_prior_snapshot->'startsAt'
             is distinct from v_approval_history.previous_state->'starts_at'
           or v_prior_snapshot->'expiresAt'
             is distinct from v_approval_history.previous_state->'expires_at'
           or v_prior_snapshot->'source'
             is distinct from v_approval_history.previous_state->'source'
           or v_prior_snapshot->'pricingRevisionId'
             is distinct from v_approval_history.previous_state->'pricing_revision_id'
           or v_prior_snapshot->'pricingPlanVersionId'
             is distinct from v_approval_history.previous_state->'pricing_plan_version_id'
           or v_prior_snapshot->'termDurationDays'
             is distinct from v_approval_history.previous_state->'term_duration_days'
           or v_prior_snapshot->'entitlementMode'
             is distinct from v_approval_history.previous_state->'entitlement_mode' then
          raise exception 'Approved payment prior-access snapshot does not match approval history; nothing changed. Review Subscription history before manual recovery';
        end if;
      elsif v_approval_history.action is distinct from 'activate'
         or v_approval_history.previous_state is distinct from '{}'::jsonb
         or v_approval_history.new_state->>'id' is distinct from v_subscription.id::text
         or v_approval_history.new_state->>'user_id' is distinct from v_payment.user_id::text
         or v_approval_history.new_state->>'source' is distinct from 'manual_payment'
         or (v_approval_history.new_state->>'version')::numeric <> 1 then
        raise exception 'Approved payment prior-access snapshot does not match approval history; nothing changed. Review Subscription history before manual recovery';
      end if;
    end if;

    -- Rolling renewals intentionally update the same subscription row. Permit
    -- an approved peer only when its uniquely paired subscription mutation is
    -- a versioned ancestor captured by this approval's previous_state. This is
    -- causal even when transaction timestamps tie or are reordered by locks.
    if exists (
      select 1
      from public.payment_requests other_payment
      left join lateral (
        select
          count(*) as approval_count,
          count(*) filter (
            where other_history.actor_user_id is not distinct from other_payment.reviewed_by
          ) as reviewer_approval_count
        from public.payment_request_history other_history
        where other_history.payment_request_id = other_payment.id
          and other_history.action = 'approved'
      ) other_approval on true
      left join lateral (
        select
          count(*) as pair_count,
          count(*) filter (
            where other_subscription_history.action in (
              'activate', 'extend', 'replace_plan'
            )
              and other_subscription_history.new_state->>'id' = v_subscription.id::text
              and other_subscription_history.new_state->>'version' ~ '^[0-9]+$'
              and v_approval_history.previous_state->>'version' ~ '^[0-9]+$'
              and case
                when other_subscription_history.new_state->>'version' ~ '^[0-9]+$'
                then (other_subscription_history.new_state->>'version')::numeric
                else null
              end <= case
                when v_approval_history.previous_state->>'version' ~ '^[0-9]+$'
                then (v_approval_history.previous_state->>'version')::numeric
                else null
              end
          ) as ancestor_pair_count
        from public.payment_request_history other_history
        join public.subscription_history other_subscription_history
          on other_subscription_history.subscription_id = v_subscription.id
         and other_subscription_history.user_id = v_payment.user_id
         and other_subscription_history.actor_user_id = other_history.actor_user_id
         and other_subscription_history.request_key = pg_catalog.regexp_replace(
           other_history.request_key,
           '_payment$',
           '_subscription'
         )
        where other_history.payment_request_id = other_payment.id
          and other_history.action = 'approved'
          and other_history.new_status = 'approved'
          and other_history.previous_status in ('pending', 'needs_information')
          and other_history.request_key ~ '_payment$'
      ) other_lineage on true
      where other_payment.id <> v_payment.id
        and other_payment.subscription_id = v_payment.subscription_id
        and other_payment.status = 'approved'
        and not (
          other_payment.user_id = v_payment.user_id
          and other_payment.approved_entitlement_changed is distinct from false
          and
          v_prior_subscription_id is not null
          and v_prior_subscription_id = v_subscription.id
          and v_approval_history.action in ('extend', 'replace_plan')
          and v_approval_history.previous_state->>'id' = v_subscription.id::text
          and v_approval_history.previous_state->>'version' ~ '^[0-9]+$'
          and other_approval.approval_count = 1
          and other_approval.reviewer_approval_count = 1
          and other_lineage.pair_count = 1
          and other_lineage.ancestor_pair_count = 1
        )
    ) then
      raise exception 'Another approved payment shares this subscription and is later or ambiguous; nothing changed. Review Subscription history before manual recovery';
    end if;

    if v_subscription.status in ('trialing', 'pending_payment', 'active', 'paused') then
      if to_jsonb(v_subscription) @> v_approval_history.new_state then
        if exists (
           select 1
           from public.subscription_history other_history
           where other_history.subscription_id = v_subscription.id
             and other_history.id <> v_approval_history.id
             and (
               coalesce(other_history.new_state->>'version', '') !~ '^[0-9]+$'
               or coalesce(v_approval_history.new_state->>'version', '') !~ '^[0-9]+$'
               or case
                 when other_history.new_state->>'version' ~ '^[0-9]+$'
                 then (other_history.new_state->>'version')::numeric
                 else null
               end >= case
                 when v_approval_history.new_state->>'version' ~ '^[0-9]+$'
                 then (v_approval_history.new_state->>'version')::numeric
                 else null
               end
             )
        ) then
          raise exception 'The linked subscription changed after approval; nothing changed. Review Subscription history before manual recovery';
        end if;
      elsif (to_jsonb(v_subscription) - array[
          'updated_at', 'updated_by', 'reason', 'version'
        ]) = (v_approval_history.new_state - array[
          'updated_at', 'updated_by', 'reason', 'version'
        ]) then
        -- A stack of rolling purchases can be unwound newest-to-oldest. Once a
        -- descendant is invalidated, its exact prior entitlement is restored
        -- with a new audit version, so full-row equality no longer holds. Only
        -- accept that state when every intervening version is a complete,
        -- paired approval+invalidation undo and no unrelated history exists.
        with valid_descendants as (
          select
            descendant_payment.id as payment_id,
            descendant_approval_history.id as approval_subscription_history_id,
            descendant_restore_history.id as restore_subscription_history_id,
            (descendant_approval_history.new_state->>'version')::numeric
              as approval_version,
            (descendant_restore_history.new_state->>'version')::numeric
              as restore_version
          from public.payment_requests descendant_payment
          join public.payment_request_history descendant_approval
            on descendant_approval.payment_request_id = descendant_payment.id
           and descendant_approval.action = 'approved'
           and descendant_approval.new_status = 'approved'
           and descendant_approval.previous_status in ('pending', 'needs_information')
           and descendant_approval.request_key ~ '_payment$'
          join public.subscription_history descendant_approval_history
            on descendant_approval_history.subscription_id = v_subscription.id
           and descendant_approval_history.user_id = v_payment.user_id
           and descendant_approval_history.actor_user_id = descendant_approval.actor_user_id
           and descendant_approval_history.request_key = pg_catalog.regexp_replace(
             descendant_approval.request_key,
             '_payment$',
             '_subscription'
           )
           and descendant_approval_history.action in ('extend', 'replace_plan')
          join public.payment_request_history descendant_rejection
            on descendant_rejection.payment_request_id = descendant_payment.id
           and descendant_rejection.action = 'rejected'
           and descendant_rejection.previous_status = 'approved'
           and descendant_rejection.new_status = 'rejected'
           and descendant_rejection.request_key ~ '_payment$'
           and descendant_rejection.metadata->>'postApprovalInvalidation' = 'true'
           and descendant_rejection.metadata->>'accessReversed' = 'true'
           and descendant_rejection.metadata->>'priorAccessRestored' = 'true'
           and descendant_rejection.metadata->>'subscriptionChanged' = 'true'
           and descendant_rejection.metadata->>'approvalHistoryRequestKey'
             = descendant_approval_history.request_key
           and descendant_rejection.metadata->>'subscriptionId' = v_subscription.id::text
          join public.subscription_history descendant_restore_history
            on descendant_restore_history.subscription_id = v_subscription.id
           and descendant_restore_history.user_id = v_payment.user_id
           and descendant_restore_history.actor_user_id = descendant_rejection.actor_user_id
           and descendant_restore_history.request_key = pg_catalog.regexp_replace(
             descendant_rejection.request_key,
             '_payment$',
             '_subscription_restore'
           )
           and descendant_restore_history.action = 'adjust'
          where descendant_payment.id <> v_payment.id
            and descendant_payment.user_id = v_payment.user_id
            and descendant_payment.subscription_id = v_subscription.id
            and descendant_payment.status = 'rejected'
            and descendant_payment.approved_entitlement_changed is true
            and descendant_payment.approved_prior_subscription_state
                  ->>'subscriptionId' = v_subscription.id::text
            and descendant_payment.reviewed_by = descendant_rejection.actor_user_id
            and (
              select count(*)
              from public.payment_request_history approval_count_history
              where approval_count_history.payment_request_id = descendant_payment.id
                and approval_count_history.action = 'approved'
            ) = 1
            and (
              select count(*)
              from public.payment_request_history rejection_count_history
              where rejection_count_history.payment_request_id = descendant_payment.id
                and rejection_count_history.action = 'rejected'
            ) = 1
            and (case
              when descendant_approval_history.previous_state->>'version' ~ '^[0-9]+$'
               and descendant_approval_history.new_state->>'version' ~ '^[0-9]+$'
               and descendant_restore_history.previous_state->>'version' ~ '^[0-9]+$'
               and descendant_restore_history.new_state->>'version' ~ '^[0-9]+$'
              then (descendant_approval_history.new_state->>'version')::numeric
                  = (descendant_approval_history.previous_state->>'version')::numeric + 1
                and (descendant_restore_history.new_state->>'version')::numeric
                  = (descendant_restore_history.previous_state->>'version')::numeric + 1
                and (descendant_approval_history.new_state->>'version')::numeric
                  > (v_approval_history.new_state->>'version')::numeric
              else false
            end)
            and descendant_approval_history.previous_state->>'id'
                  = v_subscription.id::text
            and descendant_approval_history.new_state->>'id'
                  = v_subscription.id::text
            and descendant_approval_history.previous_state->>'user_id'
                  = v_payment.user_id::text
            and descendant_approval_history.new_state->>'user_id'
                  = v_payment.user_id::text
            and descendant_restore_history.previous_state->>'id'
                  = v_subscription.id::text
            and descendant_restore_history.new_state->>'id'
                  = v_subscription.id::text
            and descendant_restore_history.previous_state->>'user_id'
                  = v_payment.user_id::text
            and descendant_restore_history.new_state->>'user_id'
                  = v_payment.user_id::text
            and (descendant_restore_history.previous_state - array[
              'updated_at', 'updated_by', 'reason', 'version'
            ]) is not distinct from (descendant_approval_history.new_state - array[
              'updated_at', 'updated_by', 'reason', 'version'
            ])
            and (descendant_restore_history.new_state - array[
              'updated_at', 'updated_by', 'reason', 'version'
            ]) is not distinct from (descendant_approval_history.previous_state - array[
              'updated_at', 'updated_by', 'reason', 'version'
            ])
        ), numbered_descendants as (
          select
            valid_descendant.*,
            row_number() over (
              order by valid_descendant.approval_version,
                valid_descendant.payment_id
            ) as approval_rank,
            count(*) over () as descendant_count
          from valid_descendants valid_descendant
        ), all_other_histories as (
          select
            other_history.*,
            case
              when other_history.new_state->>'version' ~ '^[0-9]+$'
              then (other_history.new_state->>'version')::numeric
              else null
            end as history_version
          from public.subscription_history other_history
          where other_history.subscription_id = v_subscription.id
            and other_history.id <> v_approval_history.id
        ), later_histories as (
          select other_history.*
          from all_other_histories other_history
          where other_history.history_version is null
             or other_history.history_version
                >= (v_approval_history.new_state->>'version')::numeric
        ), ordered_later_histories as (
          select
            later_history.*,
            row_number() over (
              order by later_history.history_version nulls last,
                later_history.id
            ) as history_rank,
            count(*) over () as history_count,
            lag(later_history.new_state) over (
              order by later_history.history_version nulls last,
                later_history.id
            ) as prior_new_state
          from later_histories later_history
        )
        select exists (select 1 from numbered_descendants)
          and not exists (
            select 1
            from all_other_histories other_history
            where other_history.history_version is null
          )
          and not exists (
            select 1
            from numbered_descendants descendant
            where descendant.approval_version <>
                    (v_approval_history.new_state->>'version')::numeric
                      + descendant.approval_rank
               or descendant.restore_version <>
                    (v_approval_history.new_state->>'version')::numeric
                      + (2 * descendant.descendant_count)
                      - descendant.approval_rank + 1
          )
          and (
            select count(*)
            from ordered_later_histories
          ) = 2 * (
            select count(*)
            from numbered_descendants
          )
          and (
            select count(distinct descendant.approval_subscription_history_id)
            from numbered_descendants descendant
          ) = (
            select count(*)
            from numbered_descendants
          )
          and (
            select count(distinct descendant.restore_subscription_history_id)
            from numbered_descendants descendant
          ) = (
            select count(*)
            from numbered_descendants
          )
          and not exists (
            select 1
            from ordered_later_histories later_history
            where later_history.history_version is null
               or later_history.history_version <>
                    (v_approval_history.new_state->>'version')::numeric
                      + later_history.history_rank
               or coalesce(
                    later_history.previous_state->>'version', ''
                  ) !~ '^[0-9]+$'
               or (case
                 when later_history.previous_state->>'version' ~ '^[0-9]+$'
                 then (later_history.previous_state->>'version')::numeric
                    <> later_history.history_version - 1
                 else true
               end)
               or later_history.previous_state is distinct from case
                 when later_history.history_rank = 1
                 then v_approval_history.new_state
                 else later_history.prior_new_state
               end
               or not exists (
                select 1
                from numbered_descendants descendant
                where descendant.approval_subscription_history_id = later_history.id
                   or descendant.restore_subscription_history_id = later_history.id
               )
          )
          and exists (
            select 1
            from ordered_later_histories final_history
            where final_history.history_rank = final_history.history_count
              and final_history.history_version = v_subscription.version
              and final_history.new_state = to_jsonb(v_subscription)
          )
        into v_descendant_unwind_valid;

        if not v_descendant_unwind_valid then
          raise exception 'The linked subscription changed after approval; nothing changed. Review Subscription history before manual recovery';
        end if;
      else
        raise exception 'The linked subscription changed after approval; nothing changed. Review Subscription history before manual recovery';
      end if;

      v_previous_subscription := to_jsonb(v_subscription);

      if v_prior_subscription_id = v_subscription.id then
        update public.subscriptions
        set plan_code = v_prior_snapshot->>'planCode',
            status = v_prior_snapshot->>'status',
            starts_at = nullif(v_prior_snapshot->>'startsAt', '')::timestamptz,
            expires_at = nullif(v_prior_snapshot->>'expiresAt', '')::timestamptz,
            source = v_prior_snapshot->>'source',
            pricing_revision_id = nullif(v_prior_snapshot->>'pricingRevisionId', '')::uuid,
            pricing_plan_version_id = nullif(v_prior_snapshot->>'pricingPlanVersionId', '')::uuid,
            term_duration_days = nullif(v_prior_snapshot->>'termDurationDays', '')::integer,
            entitlement_mode = nullif(v_prior_snapshot->>'entitlementMode', ''),
            updated_at = v_now,
            updated_by = p_actor_user_id,
            reason = btrim(p_reason),
            version = version + 1
        where id = v_subscription.id
        returning * into v_subscription;

        insert into public.subscription_history (
          subscription_id, user_id, actor_user_id, action,
          previous_state, new_state, reason, request_key
        ) values (
          v_subscription.id,
          v_subscription.user_id,
          p_actor_user_id,
          'adjust',
          v_previous_subscription,
          to_jsonb(v_subscription),
          btrim(p_reason),
          left(p_request_key, 96) || '_subscription_restore'
        );
        v_access_reversed := true;
        v_prior_access_restored := true;
        v_subscription_changed := true;

      elsif v_prior_subscription_id is not null then
        select prior_subscription.* into v_prior_subscription
        from public.subscriptions prior_subscription
        where prior_subscription.id = v_prior_subscription_id
          and prior_subscription.user_id = v_payment.user_id
        for update;

        if v_prior_subscription.id is null
           or v_prior_subscription.status <> 'cancelled'
           or v_prior_subscription.plan_code <> v_prior_snapshot->>'planCode'
           or v_prior_subscription.starts_at is distinct from nullif(v_prior_snapshot->>'startsAt', '')::timestamptz
           or v_prior_subscription.expires_at is distinct from nullif(v_prior_snapshot->>'expiresAt', '')::timestamptz
           or v_prior_subscription.source <> v_prior_snapshot->>'source'
           or v_prior_subscription.pricing_revision_id is distinct from nullif(v_prior_snapshot->>'pricingRevisionId', '')::uuid
           or v_prior_subscription.pricing_plan_version_id is distinct from nullif(v_prior_snapshot->>'pricingPlanVersionId', '')::uuid
           or v_prior_subscription.term_duration_days is distinct from nullif(v_prior_snapshot->>'termDurationDays', '')::integer
           or v_prior_subscription.entitlement_mode is distinct from nullif(v_prior_snapshot->>'entitlementMode', '')
           or v_prior_subscription.updated_at is distinct from v_payment.reviewed_at
           or v_prior_subscription.updated_by is distinct from v_payment.reviewed_by
           or v_prior_subscription.reason <> 'Replaced by approved versioned manual payment.'
           or exists (
             select 1
             from public.subscriptions other_subscription
             where other_subscription.user_id = v_payment.user_id
               and other_subscription.id not in (
                 v_subscription.id,
                 v_prior_subscription.id
               )
           ) then
          raise exception 'Prior subscription changed after approval; nothing changed. Review Subscription history before manual recovery';
        end if;

        v_previous_prior_subscription := to_jsonb(v_prior_subscription);

        update public.subscriptions
        set status = 'cancelled',
            source = 'invalidated_payment',
            updated_at = v_now,
            updated_by = p_actor_user_id,
            reason = btrim(p_reason),
            version = version + 1
        where id = v_subscription.id
        returning * into v_subscription;

        insert into public.subscription_history (
          subscription_id, user_id, actor_user_id, action,
          previous_state, new_state, reason, request_key
        ) values (
          v_subscription.id,
          v_subscription.user_id,
          p_actor_user_id,
          'cancel',
          v_previous_subscription,
          to_jsonb(v_subscription),
          btrim(p_reason),
          left(p_request_key, 96) || '_subscription_cancel'
        );

        update public.subscriptions
        set plan_code = v_prior_snapshot->>'planCode',
            status = v_prior_snapshot->>'status',
            starts_at = nullif(v_prior_snapshot->>'startsAt', '')::timestamptz,
            expires_at = nullif(v_prior_snapshot->>'expiresAt', '')::timestamptz,
            source = v_prior_snapshot->>'source',
            pricing_revision_id = nullif(v_prior_snapshot->>'pricingRevisionId', '')::uuid,
            pricing_plan_version_id = nullif(v_prior_snapshot->>'pricingPlanVersionId', '')::uuid,
            term_duration_days = nullif(v_prior_snapshot->>'termDurationDays', '')::integer,
            entitlement_mode = nullif(v_prior_snapshot->>'entitlementMode', ''),
            updated_at = v_now,
            updated_by = p_actor_user_id,
            reason = btrim(p_reason),
            version = version + 1
        where id = v_prior_subscription.id
        returning * into v_prior_subscription;

        insert into public.subscription_history (
          subscription_id, user_id, actor_user_id, action,
          previous_state, new_state, reason, request_key
        ) values (
          v_prior_subscription.id,
          v_prior_subscription.user_id,
          p_actor_user_id,
          'adjust',
          v_previous_prior_subscription,
          to_jsonb(v_prior_subscription),
          btrim(p_reason),
          left(p_request_key, 96) || '_prior_subscription_restore'
        );

        v_access_reversed := true;
        v_prior_access_restored := true;
        v_subscription_changed := true;

      else
        update public.subscriptions
        set status = 'cancelled',
            source = 'invalidated_payment',
            updated_at = v_now,
            updated_by = p_actor_user_id,
            reason = btrim(p_reason),
            version = version + 1
        where id = v_subscription.id
        returning * into v_subscription;

        insert into public.subscription_history (
          subscription_id, user_id, actor_user_id, action,
          previous_state, new_state, reason, request_key
        ) values (
          v_subscription.id,
          v_subscription.user_id,
          p_actor_user_id,
          'cancel',
          v_previous_subscription,
          to_jsonb(v_subscription),
          btrim(p_reason),
          left(p_request_key, 96) || '_subscription_cancel'
        );
        v_access_reversed := true;
        v_subscription_changed := true;
      end if;

    elsif v_prior_snapshot is not null then
      -- A later cancellation, expiration, refund, or adjustment must never be
      -- undone implicitly by proof invalidation.
      raise exception 'The linked subscription was changed after approval; nothing changed. Review Subscription history before manual recovery';
    else
      v_previous_subscription := to_jsonb(v_subscription);
      update public.subscriptions
      set status = 'cancelled',
          source = 'invalidated_payment',
          updated_at = v_now,
          updated_by = p_actor_user_id,
          reason = btrim(p_reason),
          version = version + 1
      where id = v_subscription.id
      returning * into v_subscription;

      insert into public.subscription_history (
        subscription_id, user_id, actor_user_id, action,
        previous_state, new_state, reason, request_key
      ) values (
        v_subscription.id,
        v_subscription.user_id,
        p_actor_user_id,
        'cancel',
        v_previous_subscription,
        to_jsonb(v_subscription),
        btrim(p_reason),
        left(p_request_key, 96) || '_subscription_invalidate'
      );
      v_subscription_already_inactive := true;
      v_subscription_changed := true;
    end if;
  end if;

  update public.payment_requests
  set status = 'rejected',
      reviewed_at = v_now,
      reviewed_by = p_actor_user_id,
      review_reason = btrim(p_reason),
      provisional_access_revoked_at = coalesce(provisional_access_revoked_at, v_now),
      subscriber_receipt_status = case
        when subscriber_receipt_status = 'sent' then 'sent'
        else 'suppressed'
      end,
      subscriber_receipt_error = case
        when subscriber_receipt_status = 'sent' then subscriber_receipt_error
        else null
      end,
      updated_at = v_now,
      version = version + 1
  where id = v_payment.id
  returning * into v_payment;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, metadata
  ) values (
    v_payment.id,
    p_actor_user_id,
    'rejected',
    v_previous_payment->>'status',
    'rejected',
    btrim(p_reason),
    left(p_request_key, 96) || '_payment',
    jsonb_build_object(
      'postApprovalInvalidation', true,
      'proofPreserved', true,
      'introductoryTokensPreserved', true,
      'subscriptionId', v_payment.subscription_id,
      'approvalHistoryRequestKey', v_approval_history.request_key,
      'subscriptionChanged', v_subscription_changed,
      'accessReversed', v_access_reversed,
      'priorAccessRestored', v_prior_access_restored,
      'subscriptionAlreadyInactive', v_subscription_already_inactive,
      'receiptStatusBefore', v_receipt_status_before,
      'receiptStatusAfter', v_payment.subscriber_receipt_status,
      'receiptAlreadySent', v_receipt_status_before = 'sent'
    )
  );

  -- This reads the post-reversal state and initializes, but never replenishes,
  -- the immutable one-time introductory grant/ledger if the user has not yet
  -- entered the introductory flow.
  v_access := public.phase4_access_snapshot(v_payment.user_id, false, null);

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'payment_invalidate',
    'targetUserId', v_payment.user_id,
    'payment', (
      to_jsonb(v_payment) - array[
        'student_note', 'proof_object_path', 'proof_original_name',
        'proof_sha256', 'trusted_payment_account_details',
        'transaction_reference', 'reference_normalized', 'payment_date',
        'paid_at', 'paid_at_verified_by', 'paid_at_verified_at',
        'paid_at_verification_source', 'payment_evidence_mode',
        'subscriber_receipt_provider_id', 'subscriber_receipt_error'
      ]
    ),
    'subscription', case
      when v_subscription.id is null then null
      else to_jsonb(v_subscription)
    end,
    'access', v_access,
    'subscriptionChanged', v_subscription_changed,
    'accessReversed', v_access_reversed,
    'priorAccessRestored', v_prior_access_restored,
    'subscriptionAlreadyInactive', v_subscription_already_inactive,
    'subscriberReceipt', jsonb_build_object(
      'status', v_payment.subscriber_receipt_status,
      'alreadySent', v_receipt_status_before = 'sent'
    ),
    'proofPreserved', true,
    'introductoryTokensPreserved', true,
    'requestKey', p_request_key,
    'replayed', false
  );

  update public.admin_action_requests
  set result = v_result,
      completed_at = v_now
  where request_key = p_request_key;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'payment_changed',
    v_payment.user_id,
    'payment_request',
    v_payment.id::text,
    btrim(p_reason),
    jsonb_build_object(
      'requestKey', p_request_key,
      'action', 'payment_invalidate',
      'previousStatus', v_previous_payment->>'status',
      'status', v_payment.status,
      'subscriptionId', v_payment.subscription_id,
      'subscriptionChanged', v_subscription_changed,
      'accessReversed', v_access_reversed,
      'priorAccessRestored', v_prior_access_restored,
      'receiptStatusBefore', v_receipt_status_before,
      'receiptStatusAfter', v_payment.subscriber_receipt_status,
      'receiptAlreadySent', v_receipt_status_before = 'sent',
      'proofPreserved', true,
      'introductoryTokensPreserved', true,
      'accessBasisAfter', v_access->>'basis',
      'introductoryTokensRemaining', v_access->'tokensRemaining'
    )
  );

  return v_result;
end;
$$;

revoke all on function public.phase4_admin_invalidate_payment(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.phase4_admin_invalidate_payment(
  uuid, uuid, text, text
) to service_role;

comment on function public.phase4_admin_invalidate_payment(
  uuid, uuid, text, text
) is 'Founder-only atomic invalidation of an approved payment and only its causally linked access; preserves proof, history, sent receipt state, and introductory-token consumption.';

commit;
