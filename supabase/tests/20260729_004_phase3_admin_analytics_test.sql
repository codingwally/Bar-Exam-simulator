begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

select has_table('public', 'admin_capabilities', 'capability table exists');
select has_table('public', 'support_request_history', 'support history exists');
select has_table('public', 'question_correction_history', 'correction history exists');
select has_table('public', 'entitlement_history', 'entitlement history exists');
select has_table('public', 'plan_catalog', 'draft plan catalog exists');
select has_table('public', 'discount_codes', 'discount codes exist');
select has_table('public', 'discount_assignments', 'discount assignments exist');
select has_table('public', 'account_recovery_cases', 'recovery cases exist');
select has_table('public', 'account_recovery_audit', 'restricted recovery audit exists');
select has_table('public', 'website_controls', 'website controls exist');
select has_table('public', 'website_control_history', 'website control history exists');
select has_table('public', 'admin_action_requests', 'admin idempotency records exist');

select ok((select relrowsecurity from pg_class where oid = 'public.admin_capabilities'::regclass), 'capabilities use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.account_recovery_audit'::regclass), 'recovery audit uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.admin_action_requests'::regclass), 'admin action requests use RLS');

select ok(not has_table_privilege('anon', 'public.usage_events', 'select'), 'anon cannot read raw events');
select ok(not has_table_privilege('authenticated', 'public.usage_events', 'select'), 'authenticated cannot read raw events');
select ok(not has_table_privilege('authenticated', 'public.usage_sessions', 'select'), 'authenticated cannot read raw sessions');
select ok(not has_table_privilege('authenticated', 'public.admin_audit_log', 'select'), 'authenticated cannot read raw audit');
select ok(not has_table_privilege('authenticated', 'public.account_recovery_audit', 'select'), 'authenticated cannot read recovery emails');
select ok(not has_table_privilege('anon', 'public.admin_capabilities', 'insert'), 'anon cannot grant capabilities');
select ok(not has_table_privilege('authenticated', 'public.user_entitlements', 'update'), 'authenticated cannot mutate entitlements');

select ok(has_table_privilege('anon', 'public.subjects', 'select'), 'public subjects remain readable');
select ok(has_table_privilege('anon', 'public.questions', 'select'), 'public questions remain readable');

select has_function('public', 'record_usage_event', array[
  'uuid','uuid','uuid','text','text','text','text','text','text','integer',
  'integer','text','text','numeric','text','text','text','text','text','text','jsonb'
], 'privacy-safe event writer exists');
select has_function('public', 'admin_dashboard_snapshot', array[
  'uuid','timestamp with time zone','timestamp with time zone',
  'timestamp with time zone','timestamp with time zone'
], 'aggregate dashboard function exists');
select has_function('public', 'admin_execute_action', array[
  'uuid','text','uuid','jsonb','text','text'
], 'audited admin mutation function exists');
select ok(not has_function_privilege('authenticated',
  'public.admin_dashboard_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz)', 'execute'),
  'browser roles cannot execute aggregate function directly');
select ok(has_function_privilege('service_role',
  'public.admin_dashboard_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz)', 'execute'),
  'service role may execute aggregate function');

select is((select count(*) from public.plan_catalog), 3::bigint, 'three draft planning plans exist');
select is((select count(*) from public.plan_catalog where status = 'draft'), 3::bigint, 'all planning plans remain draft');
select is((select price_php from public.plan_catalog where plan_code = 'early_access_beta'), 149.00::numeric, 'beta planning price preserved');
select is((select price_php from public.plan_catalog where plan_code = 'standard'), 249.00::numeric, 'standard planning price preserved');
select is((select price_php from public.plan_catalog where plan_code = 'premium'), 499.00::numeric, 'premium planning price preserved');

select throws_ok(
  $$insert into public.discount_codes(code,state,discount_type,discount_value)
    values ('BADPCT','draft','percentage',101)$$,
  '23514', null, 'percentage discount above 100 is rejected'
);
select throws_ok(
  $$insert into public.website_controls(control_key,value)
    values ('announcement_text','{"nested":{"api_key":"forbidden"}}')$$,
  '23514', null, 'nested website secret is rejected'
);
select ok(
  (
    select pg_get_constraintdef(oid) ilike '%transfer_enabled = false%'
    from pg_constraint
    where conrelid = 'public.account_recovery_cases'::regclass
      and pg_get_constraintdef(oid) ilike '%transfer_enabled%'
    limit 1
  ),
  'recovery transfer is structurally disabled'
);
select throws_ok(
  $$select public.record_usage_event(
      gen_random_uuid(),gen_random_uuid(),null,repeat('a',20),'page_view',
      null,null,'home',null,null,null,null,null,null,'desktop',null,null,null,null,'home',
      '{"nested":{"answer_text":"forbidden"}}'::jsonb
    )$$,
  'P0001', 'Sensitive analytics metadata is forbidden', 'nested answer metadata is rejected'
);
select throws_ok(
  $$select public.record_usage_event(
      gen_random_uuid(),gen_random_uuid(),null,repeat('a',20),'unknown_event',
      null,null,'home',null,null,null,null,null,null,'desktop',null,null,null,null,'home','{}'
    )$$,
  'P0001', 'Unsupported analytics event type', 'unknown event type is rejected'
);
select throws_ok(
  $$select public.record_usage_event(
      gen_random_uuid(),gen_random_uuid(),null,repeat('a',20),'grading_success',
      null,null,'home',null,null,null,null,null,5.01,'desktop',null,null,null,null,'home','{}'
    )$$,
  'P0001', 'Invalid score', 'scores with more than one decimal are rejected'
);

select is(
  (select heartbeat_interval_seconds from public.usage_sessions limit 1),
  null::smallint,
  'structural test does not fabricate a session'
);
select is((select count(*) from public.discount_codes), 0::bigint, 'no active discount was fabricated');
select is((select count(*) from public.account_recovery_cases), 0::bigint, 'no recovery case was fabricated');
select is((select count(*) from public.website_controls), 0::bigint, 'no website control was fabricated');
select is((select count(*) from public.admin_capabilities), 0::bigint, 'no founder capability was seeded');
select is((select count(*) from public.user_roles where role = 'super_admin'), 0::bigint, 'staging has no fabricated Super Admin');

select * from finish();
rollback;
