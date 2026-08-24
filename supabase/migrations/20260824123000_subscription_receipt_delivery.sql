-- Durable subscriber receipt delivery after an administrator approves payment.
-- This migration is additive. It does not change payment review, pricing, or access rules.

begin;

alter table public.payment_requests
  add column if not exists subscriber_receipt_status text,
  add column if not exists subscriber_receipt_attempts integer,
  add column if not exists subscriber_receipt_provider_id text,
  add column if not exists subscriber_receipt_error text,
  add column if not exists subscriber_receipt_last_attempt_at timestamptz,
  add column if not exists subscriber_receipt_sent_at timestamptz;

-- Existing approved/rejected records must not be emailed merely because this
-- queue was installed. Existing requests that remain reviewable can enter the
-- queue only after a future, explicit approval.
update public.payment_requests
set subscriber_receipt_status = coalesce(
      subscriber_receipt_status,
      case when status in ('pending', 'needs_information') then 'pending' else 'suppressed' end
    ),
    subscriber_receipt_attempts = coalesce(subscriber_receipt_attempts, 0);

alter table public.payment_requests
  alter column subscriber_receipt_status set default 'pending',
  alter column subscriber_receipt_status set not null,
  alter column subscriber_receipt_attempts set default 0,
  alter column subscriber_receipt_attempts set not null;

alter table public.payment_requests
  drop constraint if exists payment_requests_subscriber_receipt_status_check;
alter table public.payment_requests
  add constraint payment_requests_subscriber_receipt_status_check
    check (subscriber_receipt_status in ('pending','sending','sent','failed','suppressed'));

create index if not exists payment_requests_subscriber_receipt_queue_idx
  on public.payment_requests (
    subscriber_receipt_status,
    subscriber_receipt_last_attempt_at,
    reviewed_at
  )
  where status = 'approved'
    and subscriber_receipt_status in ('pending','failed','sending');

create or replace function public.phase4_subscription_receipt_context(
  p_payment_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'submittedAt', p.submitted_at,
    'reviewedAt', p.reviewed_at,
    'amountPhp', p.trusted_amount_php,
    'paymentMethod', p.payment_method,
    'paymentDate', p.payment_date,
    'transactionReference', p.transaction_reference,
    'proofObjectPath', p.proof_object_path,
    'proofOriginalName', p.proof_original_name,
    'proofMimeType', p.proof_mime_type,
    'proofSizeBytes', p.proof_size_bytes,
    'proofSha256', p.proof_sha256,
    'receiptStatus', p.subscriber_receipt_status,
    'receiptAttempts', p.subscriber_receipt_attempts,
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'displayName', coalesce(
        pr.display_name,
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name'
      )
    ),
    'subscription', case when s.id is null then null else jsonb_build_object(
      'id', s.id,
      'planCode', s.plan_code,
      'status', s.status,
      'startsAt', s.starts_at,
      'expiresAt', s.expires_at
    ) end
  )
  from public.payment_requests p
  join auth.users u on u.id = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  left join public.subscriptions s on s.id = p.subscription_id
  where p.id = p_payment_request_id;
$$;

create or replace function public.phase4_claim_subscription_receipt(
  p_payment_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.payment_requests
  where status = 'approved'
    and (p_payment_request_id is null or id = p_payment_request_id)
    and (
      subscriber_receipt_status in ('pending','failed')
      or (
        subscriber_receipt_status = 'sending'
        and subscriber_receipt_last_attempt_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and subscriber_receipt_attempts < 8
    and (
      subscriber_receipt_status = 'sending'
      or subscriber_receipt_last_attempt_at is null
      or subscriber_receipt_last_attempt_at < clock_timestamp()
        - make_interval(mins => least(60, greatest(1, subscriber_receipt_attempts * 2)))
    )
  order by reviewed_at nulls last, submitted_at
  for update skip locked
  limit 1;

  if v_id is null then return null; end if;

  update public.payment_requests
  set subscriber_receipt_status = 'sending',
      subscriber_receipt_attempts = subscriber_receipt_attempts + 1,
      subscriber_receipt_last_attempt_at = clock_timestamp(),
      subscriber_receipt_error = null
  where id = v_id;

  return public.phase4_subscription_receipt_context(v_id);
end;
$$;

create or replace function public.phase4_complete_subscription_receipt(
  p_payment_request_id uuid,
  p_status text,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent','failed','suppressed') then
    raise exception 'Invalid subscriber receipt status';
  end if;

  update public.payment_requests
  set subscriber_receipt_status = p_status,
      subscriber_receipt_provider_id = case when p_status = 'sent'
        then left(nullif(btrim(coalesce(p_provider_id, '')), ''), 180) else null end,
      subscriber_receipt_error = case when p_status = 'failed'
        then left(coalesce(nullif(btrim(p_error), ''), 'delivery_failed'), 500) else null end,
      subscriber_receipt_sent_at = case when p_status = 'sent'
        then coalesce(subscriber_receipt_sent_at, clock_timestamp())
        else subscriber_receipt_sent_at end
  where id = p_payment_request_id;
end;
$$;

revoke all on function public.phase4_subscription_receipt_context(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_claim_subscription_receipt(uuid)
  from public, anon, authenticated;
revoke all on function public.phase4_complete_subscription_receipt(uuid,text,text,text)
  from public, anon, authenticated;

grant execute on function public.phase4_subscription_receipt_context(uuid)
  to service_role;
grant execute on function public.phase4_claim_subscription_receipt(uuid)
  to service_role;
grant execute on function public.phase4_complete_subscription_receipt(uuid,text,text,text)
  to service_role;

comment on column public.payment_requests.subscriber_receipt_status is
  'Durable delivery state for the subscriber electronic receipt sent only after payment approval.';
comment on function public.phase4_claim_subscription_receipt(uuid) is
  'Service-role-only, retry-safe claim for one approved subscriber receipt.';

commit;
