begin;

create extension if not exists pgtap;
select plan(33);

select has_table('public', 'guest_grading_usage', 'guest usage table exists');
select has_table('public', 'guest_grading_devices', 'guest device alias table exists');
select has_table('public', 'guest_grading_reservations', 'guest reservations table exists');
select has_table('public', 'support_requests', 'support requests table exists');

select has_function(
  'public',
  'reserve_guest_grade',
  array['text', 'text', 'text', 'smallint', 'integer'],
  'reservation RPC exists'
);
select has_function(
  'public',
  'finalize_guest_grade',
  array['uuid', 'smallint'],
  'finalization RPC exists'
);
select has_function(
  'public',
  'release_guest_grade',
  array['uuid'],
  'release RPC exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.guest_grading_usage'::regclass),
  'guest usage has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guest_grading_devices'::regclass),
  'guest device aliases have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guest_grading_reservations'::regclass),
  'guest reservations have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_requests'::regclass),
  'support requests have RLS'
);

select is(
  has_table_privilege('anon', 'public.guest_grading_usage', 'select'),
  false,
  'anon cannot read guest usage'
);
select is(
  has_table_privilege('authenticated', 'public.guest_grading_usage', 'insert'),
  false,
  'authenticated cannot insert guest usage'
);
select is(
  has_table_privilege('anon', 'public.guest_grading_devices', 'select'),
  false,
  'anon cannot read device hashes'
);
select is(
  has_table_privilege('authenticated', 'public.guest_grading_reservations', 'update'),
  false,
  'authenticated cannot update reservations'
);
select is(
  has_table_privilege('anon', 'public.support_requests', 'insert'),
  false,
  'anon cannot insert support directly'
);
select is(
  has_table_privilege('authenticated', 'public.support_requests', 'select'),
  false,
  'authenticated cannot read support requests'
);
select is(
  has_table_privilege('service_role', 'public.guest_grading_usage', 'insert'),
  true,
  'service role can maintain guest usage'
);
select is(
  has_table_privilege('service_role', 'public.support_requests', 'insert'),
  true,
  'service role can store native support requests'
);

select is(
  has_function_privilege(
    'anon',
    'public.reserve_guest_grade(text,text,text,smallint,integer)',
    'execute'
  ),
  false,
  'anon cannot execute reserve RPC'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.finalize_guest_grade(uuid,smallint)',
    'execute'
  ),
  false,
  'authenticated cannot execute finalize RPC'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reserve_guest_grade(text,text,text,smallint,integer)',
    'execute'
  ),
  true,
  'service role can reserve guest grades'
);

create temporary table phase2_results (step integer, result jsonb);

insert into phase2_results
select 1, public.reserve_guest_grade(
  repeat('a', 64),
  repeat('b', 64),
  'phase2_test_request_0001',
  3::smallint,
  120
);

select ok(
  (select (result->>'allowed')::boolean from phase2_results where step = 1),
  'first guest reservation is allowed'
);

insert into phase2_results
select 2, public.finalize_guest_grade(
  (select (result->>'reservation_id')::uuid from phase2_results where step = 1),
  3::smallint
);

select is(
  (select (result->>'consumed')::integer from phase2_results where step = 2),
  1,
  'first successful grade is consumed atomically'
);

insert into phase2_results
select 3, public.reserve_guest_grade(
  repeat('a', 64),
  repeat('b', 64),
  'phase2_test_request_0002',
  3::smallint,
  120
);
insert into phase2_results
select 4, public.finalize_guest_grade(
  (select (result->>'reservation_id')::uuid from phase2_results where step = 3),
  3::smallint
);
insert into phase2_results
select 5, public.reserve_guest_grade(
  repeat('a', 64),
  repeat('b', 64),
  'phase2_test_request_0003',
  3::smallint,
  120
);
insert into phase2_results
select 6, public.finalize_guest_grade(
  (select (result->>'reservation_id')::uuid from phase2_results where step = 5),
  3::smallint
);

select is(
  (select (result->>'remaining')::integer from phase2_results where step = 6),
  0,
  'third successful grade returns zero remaining'
);

insert into phase2_results
select 7, public.reserve_guest_grade(
  repeat('a', 64),
  repeat('b', 64),
  'phase2_test_request_0004',
  3::smallint,
  120
);

select is(
  (select result->>'reason' from phase2_results where step = 7),
  'limit_reached',
  'fourth guest reservation is blocked'
);

insert into phase2_results
select 8, public.reserve_guest_grade(
  repeat('c', 64),
  repeat('b', 64),
  'phase2_test_request_0005',
  3::smallint,
  120
);

select is(
  (select result->>'reason' from phase2_results where step = 8),
  'limit_reached',
  'a replacement device ID recovers the single matching quota'
);

insert into phase2_results
select 9, public.reserve_guest_grade(
  repeat('d', 64),
  repeat('e', 64),
  'phase2_test_request_0006',
  3::smallint,
  120
);
select public.release_guest_grade(
  (select (result->>'reservation_id')::uuid from phase2_results where step = 9)
);
insert into phase2_results
select 10, public.reserve_guest_grade(
  repeat('d', 64),
  repeat('e', 64),
  'phase2_test_request_0007',
  3::smallint,
  120
);

select ok(
  (select (result->>'allowed')::boolean from phase2_results where step = 10),
  'released provider-failure reservation does not consume quota'
);

select is(
  (
    select successful_grades
    from public.guest_grading_usage usage
    join public.guest_grading_devices device on device.usage_id = usage.id
    where device.device_hash = repeat('d', 64)
  ),
  0::smallint,
  'reservation alone never increments the successful grade counter'
);

select throws_ok(
  $$select public.reserve_guest_grade(
      repeat('x', 64),
      repeat('f', 64),
      'phase2_test_request_0008',
      3::smallint,
      120
    )$$,
  'P0001',
  'Invalid guest reservation input',
  'non-hex identity hashes are rejected'
);

select throws_ok(
  $$insert into public.support_requests(category, message, status)
    values ('exam_answer', repeat('x', 30), 'new')$$,
  '23514',
  null,
  'unsupported support categories are rejected'
);

select is(
  (select count(*) from public.guest_grading_usage where recovery_hash = repeat('b', 64)),
  1::bigint,
  'recovery attaches an alias without duplicating the authoritative counter'
);

select is(
  (select count(*) from public.guest_grading_devices where usage_id = (
    select id from public.guest_grading_usage where recovery_hash = repeat('b', 64)
  )),
  2::bigint,
  'local-state loss creates a second alias for the same guest usage row'
);

select * from finish();
rollback;
