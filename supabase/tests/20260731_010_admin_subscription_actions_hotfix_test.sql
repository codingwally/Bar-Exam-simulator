-- Staging-only pgTAP coverage. All synthetic identities and records roll back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(35);

select has_function(
  'public', 'phase4_admin_manage_access',
  array['uuid','text','uuid','uuid','jsonb','text','text'],
  'focused access-management function exists'
);
select has_function(
  'public', 'phase4_admin_subscription_audit',
  array['uuid','uuid','text','text'],
  'audited subscription-history function exists'
);
select has_trigger(
  'public', 'subscriptions', 'phase4_enforce_live_subscription_plan_trigger',
  'live subscription plan guard is installed'
);
select is(
  has_function_privilege(
    'service_role',
    'public.phase4_admin_manage_access(uuid,text,uuid,uuid,jsonb,text,text)',
    'execute'
  ),
  true,
  'service role can execute focused access management'
);
select is(
  has_function_privilege(
    'anon',
    'public.phase4_admin_manage_access(uuid,text,uuid,uuid,jsonb,text,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute focused access management'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.phase4_admin_manage_access(uuid,text,uuid,uuid,jsonb,text,text)',
    'execute'
  ),
  false,
  'authenticated browser callers cannot execute focused access management'
);
select is(
  has_function_privilege(
    'service_role',
    'public.phase4_admin_subscription_audit(uuid,uuid,text,text)',
    'execute'
  ),
  true,
  'service role can execute audited history reads'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('9a000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hotfix-student@example.invalid','{}','{"full_name":"Hotfix Student"}',
   now(),now(),false,false),
  ('9a000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hotfix-founder@example.invalid','{}','{"full_name":"Hotfix Founder"}',
   now(),now(),false,false),
  ('9a000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hotfix-other@example.invalid','{}','{"full_name":"Hotfix Other"}',
   now(),now(),false,false);

update public.user_roles set role = 'founder_admin'
where user_id = '9a000000-0000-4000-8000-000000000002';

select throws_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000001',
      'subscription_change',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"operation":"activate","planCode":"standard"}',
      'Student must not activate access.',
      'hotfix_student_denied_0001'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'ordinary student cannot activate access'
);

create temporary table hotfix_activation as
select public.phase4_admin_manage_access(
  '9a000000-0000-4000-8000-000000000002',
  'subscription_change',
  '9a000000-0000-4000-8000-000000000001',
  null,
  '{"operation":"activate","planCode":"standard"}',
  'Verified synthetic activation in staging.',
  'hotfix_founder_activate_0002'
) as value;

select ok(
  (select (value->>'ok')::boolean from hotfix_activation),
  'Founder Admin can activate a subscription'
);
select is(
  (select status from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  'active',
  'activation stores active status'
);
select is(
  (select plan_code from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  'standard',
  'activation uses the server-verified Standard plan'
);
select is(
  (select round(extract(epoch from (expires_at - starts_at)) / 86400)::integer
   from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  30,
  'activation uses the trusted 30-day catalog duration'
);
select is(
  (select count(*) from public.subscription_history
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  1::bigint,
  'completed activation creates one immutable subscription-history row'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_user_id = '9a000000-0000-4000-8000-000000000001'
     and action_type = 'subscription_changed'),
  1::bigint,
  'completed activation creates one administrator audit row'
);

select is(
  (
    public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'subscription_change',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"operation":"activate","planCode":"standard"}',
      'Verified synthetic activation in staging.',
      'hotfix_founder_activate_0002'
    )->>'replayed'
  )::boolean,
  true,
  'duplicate request key returns the stored result'
);
select is(
  (select count(*) from public.subscription_history
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  1::bigint,
  'duplicate request does not create a second history row'
);

select throws_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'subscription_change',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"operation":"activate","planCode":"premium"}',
      'Premium must remain unavailable.',
      'hotfix_premium_denied_0003'
    )
  $$,
  'P0001',
  'Selected plan is not available; Premium remains held in abeyance',
  'dedicated RPC cannot activate Premium'
);
select is(
  (select plan_code from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'
     and status = 'active'),
  'standard',
  'failed Premium action leaves the existing plan unchanged'
);

select throws_ok(
  $$
    select public.phase4_admin_execute_action(
      '9a000000-0000-4000-8000-000000000002',
      'subscription_change',
      (select id from public.subscriptions
       where user_id = '9a000000-0000-4000-8000-000000000001'
       order by created_at desc limit 1),
      jsonb_build_object(
        'userId','9a000000-0000-4000-8000-000000000001',
        'operation','replace_plan',
        'planCode','premium'
      ),
      'Legacy path must also reject Premium.',
      'hotfix_legacy_premium_0004'
    )
  $$,
  'P0001',
  'Selected plan is not available for live subscription access',
  'database trigger blocks Premium through the legacy RPC'
);

select throws_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'subscription_change',
      '9a000000-0000-4000-8000-000000000003',
      (select id from public.subscriptions
       where user_id = '9a000000-0000-4000-8000-000000000001'
       order by created_at desc limit 1),
      '{"operation":"pause"}',
      'Cross-user mutation must fail.',
      'hotfix_cross_user_denied_0005'
    )
  $$,
  'P0001',
  'Subscription does not belong to target user',
  'subscription ID cannot be used against another user'
);

select lives_ok(
  format(
    $sql$
      select public.phase4_admin_manage_access(
        '9a000000-0000-4000-8000-000000000002',
        'subscription_change',
        '9a000000-0000-4000-8000-000000000001',
        %L::uuid,
        '{"operation":"pause"}',
        'Verified synthetic pause in staging.',
        'hotfix_pause_0006'
      )
    $sql$,
    (select id from public.subscriptions
     where user_id = '9a000000-0000-4000-8000-000000000001'
     order by created_at desc limit 1)
  ),
  'Founder Admin can pause active access'
);
select is(
  (select status from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'
   order by created_at desc limit 1),
  'paused',
  'pause updates the current row'
);

select lives_ok(
  format(
    $sql$
      select public.phase4_admin_manage_access(
        '9a000000-0000-4000-8000-000000000002',
        'subscription_change',
        '9a000000-0000-4000-8000-000000000001',
        %L::uuid,
        '{"operation":"resume"}',
        'Verified synthetic resume in staging.',
        'hotfix_resume_0007'
      )
    $sql$,
    (select id from public.subscriptions
     where user_id = '9a000000-0000-4000-8000-000000000001'
     order by created_at desc limit 1)
  ),
  'Founder Admin can resume paused access'
);
select is(
  (select status from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'
   order by created_at desc limit 1),
  'active',
  'resume restores active status'
);

insert into public.discount_codes (
  code, state, discount_type, discount_value, plan_code,
  starts_at, ends_at, total_limit, per_user_limit, internal_note, updated_by
) values (
  'HOTFIX25', 'active', 'percentage', 25, 'standard',
  now() - interval '1 day', now() + interval '1 day', 10, 1,
  'Synthetic staging-only discount.', '9a000000-0000-4000-8000-000000000002'
);

select lives_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'discount_assign',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"code":"HOTFIX25"}',
      'Verified synthetic discount assignment.',
      'hotfix_discount_assign_0008'
    )
  $$,
  'Founder Admin can apply a server-verified active discount'
);
select is(
  (select count(*) from public.discount_assignments a
   join public.discount_codes d on d.id = a.discount_id
   where a.user_id = '9a000000-0000-4000-8000-000000000001'
     and d.code = 'HOTFIX25' and a.revoked_at is null),
  1::bigint,
  'discount assignment is stored once'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_user_id = '9a000000-0000-4000-8000-000000000001'
     and action_type = 'discount_changed'),
  1::bigint,
  'discount assignment creates an immutable audit row'
);
select throws_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'discount_assign',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"code":"HOTFIX25"}',
      'Duplicate discount must not create partial state.',
      'hotfix_discount_duplicate_0009'
    )
  $$,
  'P0001',
  'Discount is already assigned to this user',
  'duplicate active discount assignment is rejected'
);
select is(
  (select count(*) from public.discount_assignments a
   join public.discount_codes d on d.id = a.discount_id
   where a.user_id = '9a000000-0000-4000-8000-000000000001'
     and d.code = 'HOTFIX25'),
  1::bigint,
  'failed duplicate action creates no partial assignment'
);

select lives_ok(
  $$
    select public.phase4_admin_subscription_audit(
      '9a000000-0000-4000-8000-000000000002',
      '9a000000-0000-4000-8000-000000000001',
      'Reviewing synthetic access history.',
      'hotfix_audit_view_0010'
    )
  $$,
  'Founder Admin can load audited access history'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_user_id = '9a000000-0000-4000-8000-000000000001'
     and action_type = 'sensitive_data_viewed'
     and target_resource_type = 'subscription_audit_history'),
  1::bigint,
  'history read creates an immutable sensitive-read audit row'
);
select throws_ok(
  $$
    select public.phase4_admin_manage_access(
      '9a000000-0000-4000-8000-000000000002',
      'free_beta_change',
      '9a000000-0000-4000-8000-000000000001',
      null,
      '{"enabled":true}',
      'bad',
      'hotfix_missing_reason_0011'
    )
  $$,
  'P0001',
  'A reason of 5 to 1000 characters is required',
  'access mutation requires a meaningful administrative reason'
);
select is(
  (select count(*) from public.free_beta_access
   where user_id = '9a000000-0000-4000-8000-000000000001'),
  0::bigint,
  'failed reason validation creates no partial Free Beta state'
);
select is(
  (select count(*) from public.admin_action_requests
   where request_key = 'hotfix_missing_reason_0011'),
  0::bigint,
  'failed mutation leaves no incomplete idempotency record'
);
select is(
  (select count(*) from public.subscriptions
   where user_id = '9a000000-0000-4000-8000-000000000001'
     and status = 'active'),
  1::bigint,
  'one live subscription remains after all rejected actions'
);

select jsonb_build_object(
  'planned', 35,
  'finishDiagnostics', coalesce(
    (select jsonb_agg(diagnostic) from finish() diagnostic),
    '[]'::jsonb
  ),
  'syntheticUsersBeforeRollback', (
    select count(*) from auth.users
    where id::text like '9a000000-0000-4000-8000-%'
  )
) as hotfix_test_summary;
rollback;
