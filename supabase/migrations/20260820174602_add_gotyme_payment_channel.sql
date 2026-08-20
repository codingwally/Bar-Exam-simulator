begin;

alter table public.payment_requests
  drop constraint if exists payment_requests_payment_method_gotyme_check;

alter table public.payment_requests
  add constraint payment_requests_payment_method_gotyme_check
  check (payment_method in ('gcash', 'maribank', 'bpi_instapay', 'gotyme_instapay'))
  not valid;

alter table public.payment_requests
  validate constraint payment_requests_payment_method_gotyme_check;

alter table public.payment_requests
  drop constraint payment_requests_payment_method_check;

alter table public.payment_requests
  rename constraint payment_requests_payment_method_gotyme_check
  to payment_requests_payment_method_check;

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
  v_now timestamptz := clock_timestamp();
  v_settings public.platform_access_settings%rowtype;
  v_request public.payment_requests%rowtype;
  v_prior_provisional boolean := false;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'Authenticated user required'; end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'Valid request key required'; end if;
  if lower(btrim(coalesce(p_plan_code, ''))) <> 'early_access_beta'
     or round(coalesce(p_amount_php, 0), 2) <> 149.00 then
    raise exception 'Only the ₱149 Early Access offer is available';
  end if;

  select * into strict v_settings from public.platform_access_settings where singleton = true;
  if not v_settings.commercial_launch_enabled
     or not v_settings.public_pricing_enabled
     or v_now > v_settings.early_access_sales_close_at
     or not exists (
       select 1 from public.plan_catalog where plan_code = 'early_access_beta'
         and status = 'active' and checkout_enabled and price_php = 149.00
     ) then
    raise exception 'Early Access checkout is closed';
  end if;

  select * into v_request from public.payment_requests where request_key = p_request_key;
  if found then
    if v_request.user_id <> p_user_id then raise exception 'Request key already used'; end if;
    return jsonb_build_object(
      'id', v_request.id, 'status', v_request.status,
      'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
      'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_user_id::text, 0));
  select * into v_request
  from public.payment_requests
  where user_id = p_user_id and plan_code = 'early_access_beta'
    and provisional_access_started_at is not null
  order by submitted_at desc limit 1;
  if found then
    v_prior_provisional := true;
    if v_request.status in ('pending','needs_information','approved') then
      return jsonb_build_object(
        'id', v_request.id, 'status', v_request.status,
        'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
        'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
        'provisionalAccessRevokedAt', v_request.provisional_access_revoked_at,
        'replayed', true,
        'provisionalGrantReused', true
      );
    end if;
  end if;

  if p_payment_method not in ('bpi_instapay', 'gotyme_instapay') then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_date is null or p_payment_date < current_date - 31 or p_payment_date > current_date + 1 then
    raise exception 'Payment date is outside the accepted range';
  end if;

  insert into public.payment_requests (
    user_id, plan_code, trusted_amount_php, payment_method, payment_date,
    transaction_reference, student_note, proof_object_path, proof_original_name,
    proof_mime_type, proof_size_bytes, proof_sha256, request_key,
    provisional_access_started_at, provisional_access_expires_at
  ) values (
    p_user_id, 'early_access_beta', 149.00, p_payment_method, p_payment_date,
    btrim(p_transaction_reference), nullif(btrim(coalesce(p_student_note, '')), ''),
    p_proof_object_path, left(p_proof_original_name, 180), p_proof_mime_type,
    p_proof_size_bytes, lower(p_proof_sha256), p_request_key,
    case when v_prior_provisional then null else v_now end,
    case when v_prior_provisional then null else v_now + interval '24 hours' end
  ) returning * into v_request;

  insert into public.payment_request_history (
    payment_request_id, actor_user_id, action, previous_status, new_status,
    reason, request_key, metadata
  ) values (
    v_request.id, p_user_id, 'submitted', null, 'pending',
    'Student submitted Early Access payment for manual verification.',
    left(p_request_key, 96) || '_history',
    jsonb_build_object('provisionalAccessExpiresAt', v_request.provisional_access_expires_at)
  );
  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  ) values (
    'payment_submitted', 'premium@duediligence.ph',
    'Due Diligence Early Access verification request',
    '/admin/payments?request=' || v_request.id::text,
    'payment_request', v_request.id
  );

  return jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'planCode', v_request.plan_code, 'amountPhp', v_request.trusted_amount_php,
    'amountCentavos', 14900, 'submittedAt', v_request.submitted_at,
    'provisionalAccessExpiresAt', v_request.provisional_access_expires_at,
    'provisionalGrantReused', v_prior_provisional,
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

revoke all on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) from public, anon, authenticated;

grant execute on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) to service_role;

commit;
