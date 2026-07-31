-- Private-beta admission structural and behavioral pgTAP suite.
-- Every synthetic identity and record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(60);

select has_table('public', 'private_beta_settings', 'private-beta settings exist');
select has_table('public', 'private_beta_acceptances', 'private-beta acceptances exist');
select has_table('public', 'private_beta_pending_tokens', 'consumed pending tokens exist');
select has_table('public', 'private_beta_admissions', 'private-beta admissions exist');
select has_table('public', 'private_beta_sessions', 'private-beta sessions exist');
select has_table('public', 'private_beta_code_attempts', 'private-beta rate records exist');

select has_function(
  'public',
  'private_beta_evaluate_code_attempt',
  array['text','text','boolean'],
  'durable two-scope code-attempt rate function exists'
);
select has_function(
  'public',
  'private_beta_complete_admission',
  array['uuid','text','text','text','boolean','boolean','boolean'],
  'transactional admission function exists'
);
select has_function(
  'public',
  'private_beta_access_snapshot',
  array['uuid','text'],
  'private-beta access snapshot exists'
);

select is(
  (select disclosure_version from public.private_beta_settings where singleton),
  'beta-disclosure-v1-2026-07-31',
  'approved provisional disclosure version is explicit'
);
select is(
  (select pending_token_minutes from public.private_beta_settings where singleton),
  15,
  'pending access-code flow lasts exactly 15 minutes'
);
select is(
  (select access_session_hours from public.private_beta_settings where singleton),
  12,
  'completed beta access lasts exactly 12 hours'
);
select is(
  (select flow_attempt_limit from public.private_beta_settings where singleton),
  5,
  'browser-flow verification permits five failed attempts per window'
);
select is(
  (select network_attempt_limit from public.private_beta_settings where singleton),
  20,
  'network verification permits twenty failed attempts per window'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_settings'::regclass),
  'settings have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_acceptances'::regclass),
  'acceptances have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_pending_tokens'::regclass),
  'consumed pending tokens have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_admissions'::regclass),
  'admissions have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_sessions'::regclass),
  'sessions have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.private_beta_code_attempts'::regclass),
  'rate records have RLS'
);

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_settings'::regclass),
  'settings force RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_acceptances'::regclass),
  'acceptances force RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_pending_tokens'::regclass),
  'consumed pending tokens force RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_admissions'::regclass),
  'admissions force RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_sessions'::regclass),
  'sessions force RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.private_beta_code_attempts'::regclass),
  'rate records force RLS'
);

select is(
  has_table_privilege('public', 'public.private_beta_settings', 'select'),
  false,
  'PUBLIC cannot read private-beta settings'
);
select is(
  has_table_privilege('anon', 'public.private_beta_acceptances', 'select'),
  false,
  'anon cannot read acceptance records'
);
select is(
  has_table_privilege('authenticated', 'public.private_beta_pending_tokens', 'select'),
  false,
  'authenticated clients cannot read or replay pending token references'
);
select is(
  has_table_privilege('authenticated', 'public.private_beta_admissions', 'select'),
  false,
  'authenticated clients cannot read admission records directly'
);
select is(
  has_table_privilege('authenticated', 'public.private_beta_sessions', 'insert'),
  false,
  'authenticated clients cannot create admission sessions'
);
select is(
  has_table_privilege('authenticated', 'public.private_beta_code_attempts', 'update'),
  false,
  'authenticated clients cannot alter rate limits'
);

select is(
  has_function_privilege(
    'service_role',
    'public.private_beta_evaluate_code_attempt(text,text,boolean)',
    'execute'
  ),
  true,
  'service role can evaluate a code attempt'
);
select is(
  has_function_privilege(
    'public',
    'public.private_beta_evaluate_code_attempt(text,text,boolean)',
    'execute'
  ),
  false,
  'PUBLIC cannot bypass the Worker to mutate durable rate limits'
);
select is(
  has_function_privilege(
    'service_role',
    'public.private_beta_complete_admission(uuid,text,text,text,boolean,boolean,boolean)',
    'execute'
  ),
  true,
  'service role can complete an admission'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.private_beta_complete_admission(uuid,text,text,text,boolean,boolean,boolean)',
    'execute'
  ),
  false,
  'authenticated clients cannot self-call admission'
);
select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and conname = 'user_roles_role_check'
  ) like '%beta_tester%',
  'role constraint explicitly supports beta_tester'
);

create temporary table private_beta_rate_results (
  ordinal integer primary key,
  result jsonb not null
);
insert into private_beta_rate_results (ordinal, result)
select series, public.private_beta_evaluate_code_attempt(
  repeat('1', 64),
  repeat('9', 64),
  false
)
from generate_series(1, 5) series;

select is(
  (select (result->>'blocked')::boolean from private_beta_rate_results where ordinal = 1),
  false,
  'first failed access-code attempt is recorded without blocking the flow'
);
select is(
  (select (result->>'blocked')::boolean from private_beta_rate_results where ordinal = 5),
  true,
  'fifth failed access-code attempt blocks that browser flow'
);
select is(
  (
    public.private_beta_evaluate_code_attempt(
      repeat('1', 64),
      repeat('9', 64),
      true
    )->>'allowed'
  )::boolean,
  false,
  'a correct code cannot bypass an active browser-flow block'
);

create temporary table private_beta_network_results (
  ordinal integer primary key,
  result jsonb not null
);
insert into private_beta_network_results (ordinal, result)
select series, public.private_beta_evaluate_code_attempt(
  lpad(series::text, 64, '0'),
  repeat('2', 64),
  false
)
from generate_series(1, 20) series;

select is(
  (
    select (result->>'blocked')::boolean
    from private_beta_network_results
    where ordinal = 19
  ),
  false,
  'nineteen failed attempts across separate flows do not yet block the network'
);
select is(
  (
    select (result->>'blocked')::boolean
    from private_beta_network_results
    where ordinal = 20
  ),
  true,
  'twentieth failed attempt across separate flows blocks the network'
);
select is(
  (
    public.private_beta_evaluate_code_attempt(
      repeat('3', 64),
      repeat('2', 64),
      true
    )->>'allowed'
  )::boolean,
  false,
  'rotating browser flows cannot bypass an active network block'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    'a7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'private-beta-student@example.invalid',
    '{}',
    '{"full_name":"Private Beta Student"}',
    now(),
    now(),
    false,
    false
  ),
  (
    'a7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'private-beta-founder@example.invalid',
    '{}',
    '{"full_name":"Private Beta Founder"}',
    now(),
    now(),
    false,
    false
  );

update public.user_roles
set role = 'founder_admin'
where user_id = 'a7000000-0000-4000-8000-000000000002';

insert into public.free_beta_access (
  user_id, enabled, expires_at, reason, created_by, updated_by
)
values (
  'a7000000-0000-4000-8000-000000000002',
  true,
  null,
  'Existing indefinite founder beta access',
  'a7000000-0000-4000-8000-000000000002',
  'a7000000-0000-4000-8000-000000000002'
);

insert into public.examination_beta_access (
  user_id, enabled, expires_at, granted_by, reason
)
values (
  'a7000000-0000-4000-8000-000000000002',
  true,
  null,
  'a7000000-0000-4000-8000-000000000002',
  'Existing indefinite founder examination access'
);

create temporary table private_beta_admission_results (
  label text primary key,
  result jsonb not null
);
insert into private_beta_admission_results
values (
  'student',
  public.private_beta_complete_admission(
    'a7000000-0000-4000-8000-000000000001',
    'beta-disclosure-v1-2026-07-31',
    repeat('a', 64),
    repeat('b', 64),
    true,
    true,
    true
  )
);

select throws_ok(
  $$
    select public.private_beta_complete_admission(
      'a7000000-0000-4000-8000-000000000001',
      'beta-disclosure-v1-2026-07-31',
      repeat('a', 64),
      repeat('f', 64),
      true,
      true,
      true
    )
  $$,
  'P0001',
  'PRIVATE_BETA_FLOW_ALREADY_USED',
  'a pending disclosure and access-code token is one-use'
);
insert into private_beta_admission_results
values (
  'founder',
  public.private_beta_complete_admission(
    'a7000000-0000-4000-8000-000000000002',
    'beta-disclosure-v1-2026-07-31',
    repeat('c', 64),
    repeat('d', 64),
    true,
    true,
    true
  )
);

select is(
  (select (result->>'admitted')::boolean from private_beta_admission_results where label = 'student'),
  true,
  'ordinary student admission completes transactionally'
);
select is(
  (
    select role
    from public.user_roles
    where user_id = 'a7000000-0000-4000-8000-000000000001'
  ),
  'beta_tester',
  'ordinary admitted student receives beta_tester role'
);
select is(
  (
    select count(*)
    from public.terms_acceptances t
    join public.platform_access_settings s on s.singleton
    where t.user_id = 'a7000000-0000-4000-8000-000000000001'
      and t.terms_version = s.current_terms_version
      and t.privacy_version = s.current_privacy_version
      and t.acceptance_source = 'private_beta_admission'
  ),
  1::bigint,
  'final admission records current Terms and Privacy acceptance'
);
select ok(
  (
    select enabled and expires_at > now()
    from public.free_beta_access
    where user_id = 'a7000000-0000-4000-8000-000000000001'
  ),
  'admitted student receives temporary Free Beta access'
);
select ok(
  (
    select enabled and expires_at > now()
    from public.examination_beta_access
    where user_id = 'a7000000-0000-4000-8000-000000000001'
  ),
  'admitted student receives Subject Matter and Bar Feels beta access'
);
select is(
  (
    select expires_at - issued_at
    from public.private_beta_sessions
    where user_id = 'a7000000-0000-4000-8000-000000000001'
  ),
  interval '12 hours',
  'stored admission session has a 12-hour absolute lifetime'
);
select is(
  (
    select access_expires_at - admitted_at
    from public.private_beta_admissions
    where user_id = 'a7000000-0000-4000-8000-000000000001'
  ),
  interval '12 hours',
  'stored admission itself has a 12-hour absolute lifetime'
);
select is(
  (
    public.private_beta_access_snapshot(
      'a7000000-0000-4000-8000-000000000001',
      repeat('b', 64)
    )->>'allowed'
  )::boolean,
  true,
  'matching user-bound session authorizes private-beta access'
);
select is(
  (
    public.private_beta_access_snapshot(
      'a7000000-0000-4000-8000-000000000001',
      repeat('e', 64)
    )->>'allowed'
  )::boolean,
  false,
  'unknown session reference cannot authorize access'
);
select is(
  (
    select role
    from public.user_roles
    where user_id = 'a7000000-0000-4000-8000-000000000002'
  ),
  'founder_admin',
  'founder role remains unchanged'
);
select is(
  (select result->>'admissionKind' from private_beta_admission_results where label = 'founder'),
  'founder',
  'founder admission is resolved server-side'
);
select ok(
  (
    select enabled
      and expires_at is null
      and reason = 'Existing indefinite founder beta access'
    from public.free_beta_access
    where user_id = 'a7000000-0000-4000-8000-000000000002'
  ),
  'private-beta admission never shortens existing indefinite founder beta access'
);
select ok(
  (
    select enabled
      and expires_at is null
      and reason = 'Existing indefinite founder examination access'
      and granted_by = 'a7000000-0000-4000-8000-000000000002'
    from public.examination_beta_access
    where user_id = 'a7000000-0000-4000-8000-000000000002'
  ),
  'private-beta admission never shortens existing indefinite examination access'
);
select is(
  (
    public.private_beta_access_snapshot(
      'a7000000-0000-4000-8000-000000000002',
      repeat('d', 64)
    )->>'allowed'
  )::boolean,
  true,
  'founder retains private-beta application access'
);
select is(
  (
    public.phase4_access_snapshot(
      'a7000000-0000-4000-8000-000000000001',
      false,
      null
    )->>'basis'
  ),
  'free_beta',
  'admitted beta tester bypasses the lifetime-grade restriction'
);
select is(
  (
    public.examination_authorize_access(
      'a7000000-0000-4000-8000-000000000001',
      'bar_feels',
      null,
      null,
      false
    )->>'basis'
  ),
  'examination_beta',
  'admitted beta tester enters the existing Bar Feels beta flow'
);

select * from finish();
rollback;
