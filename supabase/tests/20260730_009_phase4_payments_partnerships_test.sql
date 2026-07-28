-- Phase 4 Release 4 staging-only pgTAP suite.
-- Synthetic identities and records are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, pg_temp;
select plan(51);

select has_table('public','payment_requests','payment request table exists');
select has_table('public','payment_request_history','payment history exists');
select has_table('public','refund_requests','refund request table exists');
select has_table('public','refund_request_history','refund history exists');
select has_table('public','partnership_inquiries','partnership queue exists');
select has_table('public','partnership_inquiry_history','partnership history exists');
select has_table('public','outbound_notifications','notification queue exists');
select has_function('public','phase4_plan_catalog',array[]::text[]);
select has_function(
  'public','phase4_create_payment_request',
  array['uuid','text','numeric','text','date','text','text','text','text','text','integer','text','text']
);
select has_function('public','phase4_student_billing_snapshot',array['uuid']);
select has_function('public','phase4_create_refund_request',array['uuid','uuid','text','text']);
select has_function(
  'public','phase4_create_partnership_inquiry',
  array['uuid','text','text','text','text','text','boolean','text']
);
select has_function(
  'public','phase4_admin_execute_action',
  array['uuid','text','uuid','jsonb','text','text']
);
select has_function(
  'public','phase4_payment_proof_context',
  array['uuid','uuid','text','text']
);

select is(
  (select public from storage.buckets where id='payment-proofs'),
  false,
  'payment proof bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id='payment-proofs'),
  6291456::bigint,
  'private proof bucket enforces six MiB maximum'
);
select is(
  (select allowed_mime_types from storage.buckets where id='payment-proofs'),
  array['image/png','image/jpeg','application/pdf']::text[],
  'private proof bucket allows only PNG, JPEG, and PDF'
);
select is(
  has_table_privilege('anon','public.payment_requests','select'),
  false,
  'anonymous users cannot read payments'
);
select is(
  has_table_privilege('authenticated','public.payment_requests','insert'),
  false,
  'authenticated users cannot forge payments directly'
);
select is(
  has_table_privilege('authenticated','public.refund_requests','select'),
  false,
  'authenticated users cannot read refund records directly'
);
select is(
  has_table_privilege('authenticated','public.partnership_inquiries','select'),
  false,
  'authenticated users cannot enumerate partnership contacts'
);
select is(
  has_function_privilege('authenticated','public.phase4_create_payment_request(uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text)','execute'),
  false,
  'browser roles cannot bypass Worker payment validation'
);
select is(
  has_function_privilege('service_role','public.phase4_create_payment_request(uuid,text,numeric,text,date,text,text,text,text,text,integer,text,text)','execute'),
  true,
  'Worker service role can create validated payment requests'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('99000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release4-student@example.invalid','{}','{"full_name":"Release 4 Student"}',
   now(),now(),false,false),
  ('99000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release4-founder@example.invalid','{}','{"full_name":"Release 4 Founder"}',
   now(),now(),false,false),
  ('99000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release4-other@example.invalid','{}','{"full_name":"Release 4 Other"}',
   now(),now(),false,false);

update public.user_roles set role='founder_admin'
where user_id='99000000-0000-4000-8000-000000000002';

select is(
  (public.phase4_plan_catalog()->0->>'pricePhp')::numeric,
  149.00::numeric,
  'trusted catalog exposes PHP 149 Early Access first'
);
select is(
  (select value->>'checkoutEnabled' from jsonb_array_elements(public.phase4_plan_catalog()) value
   where value->>'planCode'='premium'),
  'false',
  'Premium is visible but checkout-disabled'
);

select throws_ok(
  $$
    select public.phase4_create_payment_request(
      '99000000-0000-4000-8000-000000000001','premium',499,'gcash',
      current_date,'PREMIUM-REF',null,
      '99000000-0000-4000-8000-000000000001/99000000-0000-4000-8000-000000000111.png',
      'proof.png','image/png',100,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'release4_premium_payment_0001'
    )
  $$,
  'P0001',
  'Selected plan is not available for payment',
  'disabled Premium cannot accept a payment'
);
select throws_ok(
  $$
    select public.phase4_create_payment_request(
      '99000000-0000-4000-8000-000000000001','standard',1,'gcash',
      current_date,'WRONG-AMOUNT',null,
      '99000000-0000-4000-8000-000000000001/99000000-0000-4000-8000-000000000112.png',
      'proof.png','image/png',100,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'release4_wrong_amount_0002'
    )
  $$,
  'P0001',
  'Payment amount must match the trusted plan price',
  'client-selected price is rejected'
);

create temporary table release4_payment as
select public.phase4_create_payment_request(
  '99000000-0000-4000-8000-000000000001','standard',249,'gcash',
  current_date,'GCASH-UNIQUE-REF-001','Synthetic staging note',
  '99000000-0000-4000-8000-000000000001/99000000-0000-4000-8000-000000000113.png',
  'proof.png','image/png',512,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'release4_valid_payment_0003'
) as value;

select is((select value->>'status' from release4_payment),'pending','valid payment is pending');
select is(
  (select count(*) from public.payment_requests where transaction_reference='GCASH-UNIQUE-REF-001'),
  1::bigint,
  'one payment record is stored'
);
select is(
  (select count(*) from public.outbound_notifications where notification_type='payment_submitted'),
  1::bigint,
  'payment creates a secure notification queue item'
);
select is(
  (select secure_admin_path from public.outbound_notifications where notification_type='payment_submitted'),
  '/admin/payments?request='||(select (value->>'id') from release4_payment),
  'payment notification contains only a secure admin path'
);
select is(
  (public.phase4_create_payment_request(
    '99000000-0000-4000-8000-000000000001','standard',249,'gcash',
    current_date,'GCASH-UNIQUE-REF-001','Synthetic staging note',
    '99000000-0000-4000-8000-000000000001/99000000-0000-4000-8000-000000000113.png',
    'proof.png','image/png',512,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'release4_valid_payment_0003'
  )->>'replayed')::boolean,
  true,
  'same request key replays safely without duplication'
);
select throws_ok(
  $$
    select public.phase4_create_payment_request(
      '99000000-0000-4000-8000-000000000003','early_access_beta',149,'gcash',
      current_date,' gcash-unique-ref-001 ',null,
      '99000000-0000-4000-8000-000000000003/99000000-0000-4000-8000-000000000114.jpg',
      'proof.jpg','image/jpeg',513,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'release4_duplicate_ref_0004'
    )
  $$,
  'P0001',
  'This transaction reference has already been submitted for this payment channel',
  'duplicate channel reference is rejected case-insensitively'
);

select throws_ok(
  $$
    select public.phase4_admin_execute_action(
      '99000000-0000-4000-8000-000000000001','payment_review',
      ((select value->>'id' from release4_payment))::uuid,
      '{"status":"approved"}','Student must not approve payment',
      'release4_student_approval_0005'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'ordinary student cannot approve a payment'
);

select lives_ok(
  $$
    select public.phase4_admin_execute_action(
      '99000000-0000-4000-8000-000000000002','payment_review',
      ((select value->>'id' from release4_payment))::uuid,
      '{"status":"approved"}','Verified synthetic payment in staging.',
      'release4_founder_approval_0006'
    )
  $$,
  'Founder may approve a verified payment'
);
select is(
  (select status from public.payment_requests where id=((select value->>'id' from release4_payment))::uuid),
  'approved',
  'approved payment state is stored'
);
select is(
  (select status from public.subscriptions where user_id='99000000-0000-4000-8000-000000000001'),
  'active',
  'approval transactionally activates subscription'
);
select is(
  (select plan_code from public.subscriptions where user_id='99000000-0000-4000-8000-000000000001'),
  'standard',
  'approval activates the exact selected plan'
);
select is(
  (select round(extract(epoch from (expires_at-starts_at))/86400)::integer
   from public.subscriptions where user_id='99000000-0000-4000-8000-000000000001'),
  30,
  'approved subscription is exactly 30 calendar days'
);
select throws_ok(
  $$
    select public.phase4_admin_execute_action(
      '99000000-0000-4000-8000-000000000002','payment_review',
      ((select value->>'id' from release4_payment))::uuid,
      '{"status":"approved"}','Attempted approval replay must fail.',
      'release4_founder_approval_0007'
    )
  $$,
  'P0001',
  'Payment request is no longer reviewable',
  'approval replay is rejected'
);

select lives_ok(
  $$
    select public.phase4_payment_proof_context(
      '99000000-0000-4000-8000-000000000002',
      ((select value->>'id' from release4_payment))::uuid,
      'Reviewing verified synthetic proof.',
      'release4_proof_read_0008'
    )
  $$,
  'Founder receives audited private-proof context'
);
select throws_ok(
  $$
    select public.phase4_payment_proof_context(
      '99000000-0000-4000-8000-000000000001',
      ((select value->>'id' from release4_payment))::uuid,
      'Student attempts private proof read.',
      'release4_bad_proof_read_0009'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'student cannot obtain payment proof context'
);

create temporary table release4_refund as
select public.phase4_create_refund_request(
  '99000000-0000-4000-8000-000000000001',
  ((select value->>'id' from release4_payment))::uuid,
  'I am requesting cancellation within the five-day review period.',
  'release4_refund_request_0010'
) as value;
select is(
  (select value->>'suggestedRefundPhp' from release4_refund)::numeric,
  199.20::numeric,
  'five-day cancellation suggests an 80 percent refund'
);
select is(
  (select status from public.refund_requests where id=((select value->>'id' from release4_refund))::uuid),
  'pending',
  'refund request awaits Founder review'
);

create temporary table release4_partnership as
select public.phase4_create_partnership_inquiry(
  null,'institutional_license','Dean Synthetic','dean@example.invalid',
  'Synthetic College of Law',
  'We are evaluating an institutional license for our law students.',
  true,'release4_partnership_0011'
) as value;
select is((select value->>'status' from release4_partnership),'new','native partnership form queues inquiry');
select is(
  (select recipient_mailbox from public.outbound_notifications where notification_type='partnership_submitted'),
  'founders@duediligence.ph',
  'partnership notification targets verified Founder mailbox'
);
select is(
  (select count(*) from public.outbound_notifications
   where notification_type='partnership_submitted'
     and secure_admin_path like '/admin/partnerships%'),
  1::bigint,
  'partnership notification uses a secure native administration link'
);

select throws_ok(
  $$
    insert into public.payment_request_history(
      payment_request_id,actor_user_id,action,previous_status,new_status,
      reason,request_key,metadata
    ) values(
      ((select value->>'id' from release4_payment))::uuid,
      '99000000-0000-4000-8000-000000000002','proof_viewed','approved','approved',
      'Unsafe nested metadata must be rejected.','release4_unsafe_metadata_0012',
      '{"nested":{"proof_bytes":"secret"}}'
    )
  $$,
  '23514',
  null,
  'recursive metadata guard rejects embedded proof content'
);

select is(
  (public.phase4_student_billing_snapshot('99000000-0000-4000-8000-000000000001')
    ->'payments'->0->>'status'),
  'approved',
  'student billing snapshot returns only the student payment status'
);
select is(
  jsonb_array_length(
    public.phase4_student_billing_snapshot('99000000-0000-4000-8000-000000000003')
    ->'payments'
  ),
  0,
  'another student receives no cross-user payment records'
);
select is(
  (select count(*) from pg_policies where schemaname='storage'
    and tablename='objects' and (qual ilike '%payment-proofs%' or with_check ilike '%payment-proofs%')),
  0::bigint,
  'private payment bucket has no browser policy'
);

select * from finish();
rollback;
