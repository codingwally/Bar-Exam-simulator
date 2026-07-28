-- Due Diligence Phase 4, Release 4
-- Manual GCash/MariBank payments, private payment proofs, refunds,
-- partnership inquiries, and Founder-admin subscription operations.
--
-- This migration is additive and repeatable. It does not alter questions,
-- answers, grading prompts, scores, timer behavior, or existing identities.

begin;

-- ---------------------------------------------------------------------------
-- Payment, refund, partnership, and notification records
-- ---------------------------------------------------------------------------

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plan_catalog(plan_code),
  trusted_amount_php numeric(10,2) not null
    check (trusted_amount_php > 0 and trusted_amount_php <= 1000000),
  payment_method text not null check (payment_method in ('gcash', 'maribank')),
  payment_date date not null,
  transaction_reference text not null
    check (char_length(btrim(transaction_reference)) between 4 and 100),
  reference_normalized text generated always as
    (lower(btrim(transaction_reference))) stored,
  student_note text check (
    student_note is null or char_length(btrim(student_note)) between 1 and 2000
  ),
  proof_object_path text not null unique
    check (proof_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|pdf)$'),
  proof_original_name text not null
    check (char_length(proof_original_name) between 1 and 180),
  proof_mime_type text not null
    check (proof_mime_type in ('image/png', 'image/jpeg', 'application/pdf')),
  proof_size_bytes integer not null check (proof_size_bytes between 1 and 6291456),
  proof_sha256 text not null check (proof_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in (
    'pending', 'needs_information', 'approved', 'rejected',
    'refunded', 'cancelled'
  )),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (
    (reviewed_at is null and reviewed_by is null)
    or (reviewed_at is not null and reviewed_by is not null)
  )
);

create unique index if not exists payment_requests_method_reference_uidx
  on public.payment_requests (payment_method, reference_normalized);
create index if not exists payment_requests_user_time_idx
  on public.payment_requests (user_id, submitted_at desc);
create index if not exists payment_requests_queue_idx
  on public.payment_requests (status, submitted_at);

create table if not exists public.payment_request_history (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'submitted', 'needs_information', 'approved', 'rejected',
    'cancelled', 'refunded', 'proof_viewed'
  )),
  previous_status text,
  new_status text not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  constraint payment_request_history_metadata_safe check (
    not public.jsonb_has_forbidden_keys(
      metadata,
      array[
        'answer','answer_text','student_answer','email','password','token',
        'api_key','service_role_key','ip','ip_address','raw_ip',
        'proof','proof_bytes','attachment'
      ]
    )
  )
);

create index if not exists payment_request_history_payment_idx
  on public.payment_request_history (payment_request_id, occurred_at desc);

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_request_id uuid not null references public.payment_requests(id),
  subscription_id uuid references public.subscriptions(id),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  request_type text not null default 'student_request' check (request_type in (
    'student_request', 'verified_outage', 'founder_adjustment'
  )),
  paid_amount_php numeric(10,2) not null check (paid_amount_php > 0),
  suggested_refund_php numeric(10,2) not null check (
    suggested_refund_php >= 0 and suggested_refund_php <= paid_amount_php
  ),
  approved_refund_php numeric(10,2) check (
    approved_refund_php is null
    or (approved_refund_php >= 0 and approved_refund_php <= paid_amount_php)
  ),
  calculation_note text not null,
  status text not null default 'pending' check (status in (
    'pending', 'needs_information', 'approved', 'rejected', 'paid', 'cancelled'
  )),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create index if not exists refund_requests_user_time_idx
  on public.refund_requests (user_id, submitted_at desc);
create index if not exists refund_requests_queue_idx
  on public.refund_requests (status, submitted_at);

create table if not exists public.refund_request_history (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'submitted', 'needs_information', 'approved', 'rejected',
    'paid', 'cancelled', 'access_extended'
  )),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now()
);

create index if not exists refund_request_history_refund_idx
  on public.refund_request_history (refund_request_id, occurred_at desc);

create table if not exists public.partnership_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  inquiry_type text not null check (inquiry_type in (
    'institutional_license', 'academic_partnership', 'content_collaboration',
    'technology_partnership', 'media', 'other'
  )),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 120),
  contact_email text not null check (
    char_length(contact_email) between 5 and 254
    and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  organization text check (
    organization is null or char_length(btrim(organization)) between 2 and 180
  ),
  message text not null check (char_length(btrim(message)) between 20 and 5000),
  consent boolean not null check (consent = true),
  contact_verified boolean not null default false,
  status text not null default 'new' check (status in (
    'new', 'reviewing', 'awaiting_reply', 'qualified', 'closed'
  )),
  assignee_user_id uuid references auth.users(id) on delete set null,
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists partnership_inquiries_queue_idx
  on public.partnership_inquiries (status, created_at);

create table if not exists public.partnership_inquiry_history (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.partnership_inquiries(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'submitted', 'status_changed', 'assigned', 'contact_verified', 'note_added'
  )),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  occurred_at timestamptz not null default now()
);

create table if not exists public.outbound_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in (
    'payment_submitted', 'refund_submitted', 'partnership_submitted',
    'provider_capacity'
  )),
  recipient_mailbox text not null check (recipient_mailbox in (
    'plansandpricing@duediligence.ph',
    'founders@duediligence.ph',
    'support@duediligence.ph'
  )),
  subject text not null check (char_length(subject) between 5 and 200),
  secure_admin_path text not null check (
    secure_admin_path ~ '^/admin/(payments|refunds|partnerships|reliability)(\?.*)?$'
  ),
  related_resource_type text not null,
  related_resource_id uuid not null,
  status text not null default 'queued' check (status in (
    'queued', 'sent', 'failed', 'suppressed'
  )),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now()
);

create index if not exists outbound_notifications_queue_idx
  on public.outbound_notifications (status, created_at);

-- The private bucket is deliberately not exposed by Storage policies.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  6291456,
  array['image/png', 'image/jpeg', 'application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Trusted Worker RPCs
-- ---------------------------------------------------------------------------

create or replace function public.phase4_plan_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'planCode', plan_code,
    'name', display_name,
    'pricePhp', price_php,
    'durationDays', duration_days,
    'features', features,
    'status', status,
    'displayOrder', display_order,
    'promotional', promotional,
    'checkoutEnabled', checkout_enabled,
    'description', description,
    'note', note
  ) order by display_order, plan_code), '[]'::jsonb)
  from public.plan_catalog
  where status in ('active', 'disabled');
$$;

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
      'id', v_request.id, 'status', v_request.status, 'replayed', true
    );
  end if;

  select * into v_plan
  from public.plan_catalog
  where plan_code = lower(btrim(coalesce(p_plan_code, '')))
  for share;
  if not found or v_plan.status <> 'active' or not v_plan.checkout_enabled
     or v_plan.duration_days <> 30 then
    raise exception 'Selected plan is not available for payment';
  end if;
  if round(coalesce(p_amount_php, 0), 2) <> v_plan.price_php then
    raise exception 'Payment amount must match the trusted plan price';
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

create or replace function public.phase4_student_billing_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'planCode', p.plan_code,
        'amountPhp', p.trusted_amount_php,
        'method', p.payment_method,
        'paymentDate', p.payment_date,
        'reference', p.transaction_reference,
        'status', p.status,
        'submittedAt', p.submitted_at,
        'reviewedAt', p.reviewed_at,
        'reviewReason', p.review_reason
      ) order by p.submitted_at desc)
      from public.payment_requests p where p.user_id = p_user_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'paymentRequestId', r.payment_request_id,
        'status', r.status,
        'paidAmountPhp', r.paid_amount_php,
        'suggestedRefundPhp', r.suggested_refund_php,
        'approvedRefundPhp', r.approved_refund_php,
        'calculationNote', r.calculation_note,
        'submittedAt', r.submitted_at,
        'reviewReason', r.review_reason
      ) order by r.submitted_at desc)
      from public.refund_requests r where r.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.phase4_create_refund_request(
  p_user_id uuid,
  p_payment_request_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_suggested numeric(10,2);
  v_note text;
  v_refund public.refund_requests%rowtype;
  v_fraction numeric;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 2000 then
    raise exception 'Refund reason must be between 10 and 2000 characters';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;
  select * into v_refund from public.refund_requests where request_key = p_request_key;
  if found then
    if v_refund.user_id <> p_user_id then raise exception 'Request key already used'; end if;
    return jsonb_build_object('id', v_refund.id, 'status', v_refund.status, 'replayed', true);
  end if;

  select * into strict v_payment
  from public.payment_requests
  where id = p_payment_request_id and user_id = p_user_id and status = 'approved';
  if exists (
    select 1 from public.refund_requests
    where payment_request_id = p_payment_request_id
      and status in ('pending','needs_information','approved','paid')
  ) then
    raise exception 'A refund request already exists for this payment';
  end if;
  select * into v_subscription
  from public.subscriptions where id = v_payment.subscription_id;

  if v_subscription.starts_at is not null
     and clock_timestamp() <= v_subscription.starts_at + interval '5 days' then
    v_suggested := round(v_payment.trusted_amount_php * 0.80, 2);
    v_note := 'Within five calendar days of activation: suggested refund is 80% of the verified PHP payment.';
  else
    v_fraction := case
      when v_subscription.starts_at is null or v_subscription.expires_at is null then 0
      else greatest(0, least(1,
        extract(epoch from (v_subscription.expires_at - clock_timestamp()))
        / nullif(extract(epoch from (v_subscription.expires_at - v_subscription.starts_at)), 0)
      ))
    end;
    v_suggested := round(v_payment.trusted_amount_php * coalesce(v_fraction, 0), 2);
    v_note := 'Later request: suggested amount reflects unused subscription time; Founder review must document relevant consumption and statutory rights.';
  end if;

  insert into public.refund_requests (
    user_id, payment_request_id, subscription_id, reason, paid_amount_php,
    suggested_refund_php, calculation_note, request_key
  )
  values (
    p_user_id, v_payment.id, v_payment.subscription_id, btrim(p_reason),
    v_payment.trusted_amount_php, v_suggested, v_note, p_request_key
  )
  returning * into v_refund;

  insert into public.refund_request_history (
    refund_request_id, actor_user_id, action, previous_state, new_state,
    reason, request_key
  )
  values (
    v_refund.id, p_user_id, 'submitted', '{}'::jsonb,
    jsonb_build_object('status','pending','suggestedRefundPhp',v_suggested),
    'Student submitted refund request for Founder review.',
    left(p_request_key, 96) || '_history'
  );

  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  )
  values (
    'refund_submitted', 'plansandpricing@duediligence.ph',
    'Due Diligence refund review request',
    '/admin/refunds?request=' || v_refund.id::text,
    'refund_request', v_refund.id
  );

  return jsonb_build_object(
    'id', v_refund.id, 'status', v_refund.status,
    'suggestedRefundPhp', v_refund.suggested_refund_php,
    'calculationNote', v_refund.calculation_note, 'replayed', false
  );
end;
$$;

create or replace function public.phase4_create_partnership_inquiry(
  p_user_id uuid,
  p_inquiry_type text,
  p_contact_name text,
  p_contact_email text,
  p_organization text,
  p_message text,
  p_consent boolean,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inquiry public.partnership_inquiries%rowtype;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;
  select * into v_inquiry
  from public.partnership_inquiries where request_key = p_request_key;
  if found then
    return jsonb_build_object('id',v_inquiry.id,'status',v_inquiry.status,'replayed',true);
  end if;

  insert into public.partnership_inquiries (
    user_id, inquiry_type, contact_name, contact_email, organization,
    message, consent, request_key
  )
  values (
    p_user_id, lower(btrim(p_inquiry_type)), btrim(p_contact_name),
    lower(btrim(p_contact_email)), nullif(btrim(coalesce(p_organization,'')),''),
    btrim(p_message), p_consent, p_request_key
  )
  returning * into v_inquiry;

  insert into public.partnership_inquiry_history (
    inquiry_id, actor_user_id, action, previous_state, new_state,
    reason, request_key
  )
  values (
    v_inquiry.id, p_user_id, 'submitted', '{}'::jsonb,
    jsonb_build_object('status','new'),
    'Partnership inquiry submitted with contact consent.',
    left(p_request_key, 96) || '_history'
  );

  insert into public.outbound_notifications (
    notification_type, recipient_mailbox, subject, secure_admin_path,
    related_resource_type, related_resource_id
  )
  values (
    'partnership_submitted', 'founders@duediligence.ph',
    'Due Diligence partnership inquiry',
    '/admin/partnerships?inquiry=' || v_inquiry.id::text,
    'partnership_inquiry', v_inquiry.id
  );

  return jsonb_build_object('id',v_inquiry.id,'status',v_inquiry.status,'replayed',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder/Super Admin operations
-- ---------------------------------------------------------------------------

create or replace function public.phase4_require_founder(p_actor_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.user_roles where user_id = p_actor_user_id;
  if v_role not in ('founder_admin','super_admin') then
    raise exception 'Founder administrator authorization required';
  end if;
  return v_role;
end;
$$;

create or replace function public.phase4_admin_operational_data(
  p_actor_user_id uuid,
  p_section text,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_limit integer := greatest(1, least(coalesce(p_limit,50),100));
  v_offset integer := greatest(0,coalesce(p_offset,0));
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if p_section = 'payments' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (select count(*) from public.payment_requests)
    ) into v_result
    from (
      select p.id, p.user_id, pr.display_name, p.plan_code,
        p.trusted_amount_php, p.payment_method, p.payment_date,
        p.transaction_reference, p.status, p.submitted_at, p.reviewed_at,
        p.review_reason, p.subscription_id
      from public.payment_requests p
      left join public.profiles pr on pr.id = p.user_id
      where v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or lower(p.transaction_reference) like '%'||v_search||'%'
         or p.id::text = v_search
      order by p.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'refunds' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (select count(*) from public.refund_requests)
    ) into v_result
    from (
      select r.id, r.user_id, pr.display_name, r.payment_request_id,
        r.status, r.paid_amount_php, r.suggested_refund_php,
        r.approved_refund_php, r.calculation_note, r.submitted_at,
        r.review_reason
      from public.refund_requests r
      left join public.profiles pr on pr.id = r.user_id
      where v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or r.id::text = v_search
      order by r.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'partnerships' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (select count(*) from public.partnership_inquiries)
    ) into v_result
    from (
      select i.id, i.inquiry_type, i.contact_name, i.contact_email,
        i.organization, i.message, i.consent, i.contact_verified,
        i.status, i.assignee_user_id, i.created_at, i.updated_at
      from public.partnership_inquiries i
      where v_search = ''
         or lower(i.contact_name) like '%'||v_search||'%'
         or lower(i.contact_email) like '%'||v_search||'%'
         or lower(coalesce(i.organization,'')) like '%'||v_search||'%'
      order by i.created_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'access' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (select count(*) from public.profiles)
    ) into v_result
    from (
      select p.id as user_id, p.display_name, p.created_at,
        coalesce(r.role,'student') as role,
        t.started_at as trial_started_at, t.expires_at as trial_expires_at,
        coalesce(g.successful_grades,0) as successful_grades,
        greatest(0,3-coalesce(g.successful_grades,0)) as free_grades_remaining,
        b.enabled as free_beta_enabled, b.expires_at as free_beta_expires_at,
        s.id as subscription_id, s.plan_code, s.status as subscription_status,
        s.starts_at, s.expires_at
      from public.profiles p
      left join public.user_roles r on r.user_id = p.id
      left join public.access_trials t on t.user_id = p.id
      left join public.lifetime_grade_usage g on g.user_id = p.id
      left join public.free_beta_access b on b.user_id = p.id
      left join lateral (
        select * from public.subscriptions x where x.user_id=p.id
        order by x.updated_at desc limit 1
      ) s on true
      where v_search = ''
         or lower(coalesce(p.display_name,'')) like '%'||v_search||'%'
         or p.id::text = v_search
      order by p.created_at desc limit v_limit offset v_offset
    ) q;
  else
    raise exception 'Unsupported Phase 4 administrator section';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type, target_resource_id,
    reason, details
  )
  values (
    p_actor_user_id, 'sensitive_data_viewed', 'phase4_admin_section', p_section,
    'Authorized Founder administration data view.',
    jsonb_build_object('section',p_section,'resultCount',jsonb_array_length(coalesce(v_result->'items','[]'::jsonb)))
  );
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'total',0));
end;
$$;

create or replace function public.phase4_admin_execute_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_id uuid,
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
  v_role text;
  v_payment public.payment_requests%rowtype;
  v_refund public.refund_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan public.plan_catalog%rowtype;
  v_inquiry public.partnership_inquiries%rowtype;
  v_target_user uuid;
  v_status text;
  v_previous jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_days integer;
  v_amount numeric(10,2);
begin
  v_role := public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'A reason of 5 to 1000 characters is required';
  end if;
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;
  if exists (
    select 1 from public.admin_audit_log
    where details->>'requestKey' = p_request_key
  ) then
    return jsonb_build_object('replayed',true,'requestKey',p_request_key);
  end if;

  if p_action = 'payment_review' then
    select * into strict v_payment from public.payment_requests
    where id = p_target_id for update;
    v_status := lower(btrim(coalesce(p_payload->>'status','')));
    if v_status not in ('needs_information','approved','rejected') then
      raise exception 'Invalid payment review status';
    end if;
    if v_payment.status not in ('pending','needs_information') then
      raise exception 'Payment request is no longer reviewable';
    end if;
    v_previous := to_jsonb(v_payment) - array[
      'student_note','proof_object_path','proof_original_name','proof_sha256'
    ];

    if v_status = 'approved' then
      select * into strict v_plan from public.plan_catalog
      where plan_code=v_payment.plan_code and status='active'
        and checkout_enabled and price_php=v_payment.trusted_amount_php
        and duration_days=30 for share;
      update public.subscriptions
      set status='cancelled', updated_at=v_now, updated_by=p_actor_user_id,
          reason='Replaced by newly approved manual payment.', version=version+1
      where user_id=v_payment.user_id and status in ('trialing','pending_payment','active','paused');
      insert into public.subscriptions (
        user_id, plan_code, status, starts_at, expires_at, source,
        created_by, updated_by, reason
      )
      values (
        v_payment.user_id, v_plan.plan_code, 'active', v_now,
        v_now + make_interval(days=>v_plan.duration_days), 'manual_payment',
        p_actor_user_id, p_actor_user_id, btrim(p_reason)
      ) returning * into v_subscription;
      insert into public.subscription_history (
        subscription_id,user_id,actor_user_id,action,previous_state,new_state,
        reason,request_key
      ) values (
        v_subscription.id,v_subscription.user_id,p_actor_user_id,'activate',
        '{}'::jsonb,to_jsonb(v_subscription),btrim(p_reason),left(p_request_key,96)||'_subscription'
      );
    end if;

    update public.payment_requests
    set status=v_status, reviewed_at=v_now, reviewed_by=p_actor_user_id,
        review_reason=btrim(p_reason),
        subscription_id=case when v_status='approved' then v_subscription.id else subscription_id end,
        updated_at=v_now, version=version+1
    where id=v_payment.id returning * into v_payment;
    insert into public.payment_request_history (
      payment_request_id,actor_user_id,action,previous_status,new_status,
      reason,request_key
    ) values (
      v_payment.id,p_actor_user_id,v_status,v_previous->>'status',v_status,
      btrim(p_reason),left(p_request_key,96)||'_payment'
    );
    v_target_user := v_payment.user_id;
    v_new := to_jsonb(v_payment) - array[
      'student_note','proof_object_path','proof_original_name','proof_sha256'
    ];

  elsif p_action = 'refund_review' then
    select * into strict v_refund from public.refund_requests
    where id=p_target_id for update;
    v_status := lower(btrim(coalesce(p_payload->>'status','')));
    if v_status not in ('needs_information','approved','rejected','paid') then
      raise exception 'Invalid refund review status';
    end if;
    if v_refund.status not in ('pending','needs_information','approved') then
      raise exception 'Refund request is no longer reviewable';
    end if;
    if v_status='paid' and v_refund.status<>'approved' then
      raise exception 'Refund must be approved before it is marked paid';
    end if;
    v_amount := case when v_status in ('approved','paid')
      then round(coalesce((p_payload->>'approvedRefundPhp')::numeric,v_refund.approved_refund_php,v_refund.suggested_refund_php),2)
      else v_refund.approved_refund_php end;
    if v_amount is not null and (v_amount<0 or v_amount>v_refund.paid_amount_php) then
      raise exception 'Refund amount is outside the verified payment amount';
    end if;
    v_previous := to_jsonb(v_refund);
    update public.refund_requests set
      status=v_status, approved_refund_php=v_amount, reviewed_at=v_now,
      reviewed_by=p_actor_user_id, review_reason=btrim(p_reason),
      updated_at=v_now, version=version+1
    where id=v_refund.id returning * into v_refund;
    if v_status='paid' then
      update public.payment_requests set status='refunded',updated_at=v_now,
        version=version+1 where id=v_refund.payment_request_id;
      update public.subscriptions set status='refunded',updated_at=v_now,
        updated_by=p_actor_user_id,reason=btrim(p_reason),version=version+1
        where id=v_refund.subscription_id and status in ('active','paused');
    end if;
    insert into public.refund_request_history (
      refund_request_id,actor_user_id,action,previous_state,new_state,
      reason,request_key
    ) values (
      v_refund.id,p_actor_user_id,v_status,v_previous,to_jsonb(v_refund),
      btrim(p_reason),left(p_request_key,96)||'_refund'
    );
    v_target_user:=v_refund.user_id; v_new:=to_jsonb(v_refund);

  elsif p_action = 'subscription_change' then
    v_target_user := nullif(p_payload->>'userId','')::uuid;
    if v_target_user is null then raise exception 'Target user required'; end if;
    v_status := lower(btrim(coalesce(p_payload->>'operation','')));
    select * into v_subscription from public.subscriptions
      where id=p_target_id and user_id=v_target_user for update;
    v_previous := coalesce(to_jsonb(v_subscription),'{}'::jsonb);
    if v_status='complimentary' then
      select * into strict v_plan from public.plan_catalog
        where plan_code=lower(btrim(p_payload->>'planCode')) and status='active';
      v_days:=greatest(1,least(coalesce((p_payload->>'durationDays')::integer,v_plan.duration_days,30),366));
      update public.subscriptions set status='cancelled',updated_at=v_now,
        updated_by=p_actor_user_id,reason='Replaced by complimentary access.',
        version=version+1
      where user_id=v_target_user and status in ('trialing','pending_payment','active','paused');
      insert into public.subscriptions (
        user_id,plan_code,status,starts_at,expires_at,source,
        created_by,updated_by,reason
      ) values (
        v_target_user,v_plan.plan_code,'active',v_now,v_now+make_interval(days=>v_days),
        'complimentary',p_actor_user_id,p_actor_user_id,btrim(p_reason)
      ) returning * into v_subscription;
    else
      if not found then raise exception 'Subscription not found'; end if;
      if v_status='pause' then
        update public.subscriptions set status='paused',updated_at=v_now,updated_by=p_actor_user_id,
          reason=btrim(p_reason),version=version+1 where id=v_subscription.id returning * into v_subscription;
      elsif v_status='resume' then
        update public.subscriptions set status='active',updated_at=v_now,updated_by=p_actor_user_id,
          reason=btrim(p_reason),version=version+1 where id=v_subscription.id returning * into v_subscription;
      elsif v_status='cancel' then
        update public.subscriptions set status='cancelled',updated_at=v_now,updated_by=p_actor_user_id,
          reason=btrim(p_reason),version=version+1 where id=v_subscription.id returning * into v_subscription;
      elsif v_status='extend' then
        v_days:=greatest(1,least((p_payload->>'durationDays')::integer,366));
        update public.subscriptions
        set expires_at=greatest(coalesce(expires_at,v_now),v_now)+make_interval(days=>v_days),
          updated_at=v_now,updated_by=p_actor_user_id,reason=btrim(p_reason),version=version+1
        where id=v_subscription.id returning * into v_subscription;
      elsif v_status='replace_plan' then
        select * into strict v_plan from public.plan_catalog
          where plan_code=lower(btrim(p_payload->>'planCode')) and status in ('active','disabled');
        update public.subscriptions set plan_code=v_plan.plan_code,updated_at=v_now,
          updated_by=p_actor_user_id,reason=btrim(p_reason),version=version+1
        where id=v_subscription.id returning * into v_subscription;
      elsif v_status='set_dates' then
        update public.subscriptions
        set starts_at=(p_payload->>'startsAt')::timestamptz,
          expires_at=(p_payload->>'expiresAt')::timestamptz,
          updated_at=v_now,updated_by=p_actor_user_id,reason=btrim(p_reason),version=version+1
        where id=v_subscription.id returning * into v_subscription;
      else raise exception 'Unsupported subscription operation';
      end if;
    end if;
    insert into public.subscription_history (
      subscription_id,user_id,actor_user_id,action,previous_state,new_state,
      reason,request_key
    ) values (
      v_subscription.id,v_target_user,p_actor_user_id,
      case v_status when 'complimentary' then 'create'
        when 'set_dates' then 'adjust' when 'replace_plan' then 'replace_plan'
        else v_status end,
      v_previous,to_jsonb(v_subscription),btrim(p_reason),left(p_request_key,96)||'_subscription'
    );
    v_new:=to_jsonb(v_subscription);

  elsif p_action = 'free_beta_change' then
    v_target_user := p_target_id;
    if not exists(select 1 from auth.users where id=v_target_user) then
      raise exception 'Target user not found';
    end if;
    select to_jsonb(b) into v_previous from public.free_beta_access b where user_id=v_target_user;
    insert into public.free_beta_access (
      user_id,enabled,expires_at,reason,created_by,updated_by
    ) values (
      v_target_user,coalesce((p_payload->>'enabled')::boolean,false),
      nullif(p_payload->>'expiresAt','')::timestamptz,btrim(p_reason),
      p_actor_user_id,p_actor_user_id
    ) on conflict(user_id) do update set
      enabled=excluded.enabled,expires_at=excluded.expires_at,
      reason=excluded.reason,updated_at=v_now,updated_by=p_actor_user_id;
    select to_jsonb(b) into strict v_new
    from public.free_beta_access b where b.user_id=v_target_user;
    insert into public.free_beta_access_history (
      user_id,actor_user_id,previous_state,new_state,reason,request_key
    ) values (
      v_target_user,p_actor_user_id,coalesce(v_previous,'{}'::jsonb),
      v_new,btrim(p_reason),left(p_request_key,96)||'_beta'
    );

  elsif p_action = 'partnership_update' then
    select * into strict v_inquiry from public.partnership_inquiries
      where id=p_target_id for update;
    v_previous:=to_jsonb(v_inquiry);
    v_status:=lower(btrim(coalesce(p_payload->>'status',v_inquiry.status)));
    if v_status not in ('new','reviewing','awaiting_reply','qualified','closed') then
      raise exception 'Invalid partnership status';
    end if;
    update public.partnership_inquiries set
      status=v_status,
      contact_verified=coalesce((p_payload->>'contactVerified')::boolean,contact_verified),
      assignee_user_id=coalesce(nullif(p_payload->>'assigneeUserId','')::uuid,assignee_user_id),
      updated_at=v_now,
      closed_at=case when v_status='closed' then v_now else null end
    where id=v_inquiry.id returning * into v_inquiry;
    insert into public.partnership_inquiry_history (
      inquiry_id,actor_user_id,action,previous_state,new_state,reason,request_key
    ) values (
      v_inquiry.id,p_actor_user_id,'status_changed',v_previous,to_jsonb(v_inquiry),
      btrim(p_reason),left(p_request_key,96)||'_partnership'
    );
    v_new:=to_jsonb(v_inquiry);

  elsif p_action = 'provider_incident_clear' then
    update public.provider_incidents set
      status='resolved',resolved_at=v_now,resolution='Manually cleared by Founder administrator.'
    where id=p_target_id and status='open';
    if not found then raise exception 'Open provider incident not found'; end if;
    v_new:=jsonb_build_object('status','resolved');

  elsif p_action = 'role_change' then
    if v_role<>'super_admin' then
      raise exception 'Super administrator authorization required';
    end if;
    v_target_user:=p_target_id;
    if v_target_user=p_actor_user_id then raise exception 'Self-directed role changes are not allowed'; end if;
    v_status:=lower(btrim(p_payload->>'role'));
    if v_status not in ('student','admin','founder_admin') then raise exception 'Invalid assignable role'; end if;
    if exists(select 1 from public.user_roles where user_id=v_target_user and role='super_admin') then
      raise exception 'The Super Admin role cannot be changed';
    end if;
    select jsonb_build_object('role',role) into v_previous
      from public.user_roles where user_id=v_target_user;
    insert into public.user_roles(user_id,role,assigned_by,updated_at)
    values(v_target_user,v_status,p_actor_user_id,v_now)
    on conflict(user_id) do update set role=excluded.role,assigned_by=excluded.assigned_by,updated_at=v_now;
    v_new:=jsonb_build_object('role',v_status);
  else
    raise exception 'Unsupported Phase 4 administrator action';
  end if;

  insert into public.admin_audit_log (
    actor_user_id,action_type,target_user_id,target_resource_type,
    target_resource_id,reason,details
  ) values (
    p_actor_user_id,
    case
      when p_action='payment_review' then 'payment_changed'
      when p_action='refund_review' then 'refund_changed'
      when p_action='partnership_update' then 'partnership_changed'
      when p_action='role_change' then 'administrator_role_changed'
      when p_action='provider_incident_clear' then 'provider_incident_changed'
      else 'subscription_changed'
    end,
    v_target_user,p_action,coalesce(p_target_id::text,v_target_user::text),
    btrim(p_reason),
    jsonb_build_object(
      'requestKey',p_request_key,
      'previous',coalesce(v_previous,'{}'::jsonb),
      'new',coalesce(v_new,'{}'::jsonb)
    )
  );
  return jsonb_build_object('ok',true,'action',p_action,'requestKey',p_request_key,'data',v_new);
end;
$$;

create or replace function public.phase4_payment_proof_context(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_requests%rowtype;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 1000
     or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'A valid reason and request key are required';
  end if;
  select * into strict v_payment from public.payment_requests
    where id=p_payment_request_id;
  insert into public.payment_request_history (
    payment_request_id,actor_user_id,action,previous_status,new_status,
    reason,request_key
  ) values (
    v_payment.id,p_actor_user_id,'proof_viewed',v_payment.status,v_payment.status,
    btrim(p_reason),p_request_key
  );
  insert into public.admin_audit_log (
    actor_user_id,action_type,target_user_id,target_resource_type,
    target_resource_id,reason,details
  ) values (
    p_actor_user_id,'sensitive_data_viewed',v_payment.user_id,'payment_proof',
    v_payment.id::text,btrim(p_reason),jsonb_build_object('requestKey',p_request_key)
  );
  return jsonb_build_object(
    'bucket','payment-proofs','objectPath',v_payment.proof_object_path,
    'mimeType',v_payment.proof_mime_type,'sizeBytes',v_payment.proof_size_bytes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit vocabulary and least-privilege grants
-- ---------------------------------------------------------------------------

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_type_check;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_type_check check (action_type in (
    'administrator_role_assigned','administrator_role_removed',
    'administrator_role_changed','capability_granted','capability_revoked',
    'user_account_status_changed','subscription_changed','discount_changed',
    'support_case_changed','correction_reviewed','account_recovery_changed',
    'email_searched','email_revealed','aggregate_exported',
    'website_control_changed','content_management_action',
    'security_setting_changed','payment_changed','refund_changed',
    'partnership_changed','provider_incident_changed','sensitive_data_viewed'
  ));

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payment_requests','payment_request_history','refund_requests',
    'refund_request_history','partnership_inquiries',
    'partnership_inquiry_history','outbound_notifications'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public, anon, authenticated',v_table);
    execute format('grant select,insert,update,delete on public.%I to service_role',v_table);
  end loop;
end
$$;

-- Storage access remains service-role-only through the Worker. No browser
-- policy is created for the private payment-proofs bucket.

revoke all on function public.phase4_plan_catalog() from public,anon,authenticated;
revoke all on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) from public,anon,authenticated;
revoke all on function public.phase4_student_billing_snapshot(uuid)
  from public,anon,authenticated;
revoke all on function public.phase4_create_refund_request(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.phase4_create_partnership_inquiry(
  uuid,text,text,text,text,text,boolean,text
) from public,anon,authenticated;
revoke all on function public.phase4_require_founder(uuid)
  from public,anon,authenticated;
revoke all on function public.phase4_admin_operational_data(
  uuid,text,text,integer,integer
) from public,anon,authenticated;
revoke all on function public.phase4_admin_execute_action(
  uuid,text,uuid,jsonb,text,text
) from public,anon,authenticated;
revoke all on function public.phase4_payment_proof_context(uuid,uuid,text,text)
  from public,anon,authenticated;

grant execute on function public.phase4_plan_catalog() to service_role;
grant execute on function public.phase4_create_payment_request(
  uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text
) to service_role;
grant execute on function public.phase4_student_billing_snapshot(uuid) to service_role;
grant execute on function public.phase4_create_refund_request(uuid,uuid,text,text) to service_role;
grant execute on function public.phase4_create_partnership_inquiry(
  uuid,text,text,text,text,text,boolean,text
) to service_role;
grant execute on function public.phase4_require_founder(uuid) to service_role;
grant execute on function public.phase4_admin_operational_data(
  uuid,text,text,integer,integer
) to service_role;
grant execute on function public.phase4_admin_execute_action(
  uuid,text,uuid,jsonb,text,text
) to service_role;
grant execute on function public.phase4_payment_proof_context(uuid,uuid,text,text)
  to service_role;

commit;
