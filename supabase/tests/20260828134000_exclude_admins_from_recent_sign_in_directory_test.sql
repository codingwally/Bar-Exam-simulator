-- Recent learner sign-ins must exclude privileged roles before ordering and
-- limiting while retaining authorization, scope, audit, and grant contracts.

begin;
set transaction isolation level repeatable read;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(19);

select has_function(
  'public', 'admin_recent_sign_in_directory_scoped_v1',
  array['uuid', 'integer', 'text', 'text'],
  'the scoped recent learner sign-in directory exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'execute'
  ),
  'the Worker service role can execute the directory'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browser users cannot execute the directory directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'execute'
  ),
  false,
  'anonymous users cannot execute the directory'
);
select is(
  has_function_privilege(
    'public',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'execute'
  ),
  false,
  'PUBLIC cannot execute the directory'
);
select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_recent_sign_in_directory_scoped_v1'
  ),
  'the directory retains controlled definer privileges'
);
select ok(
  (
    select exists (
      select 1
      from unnest(coalesce(procedure.proconfig, '{}'::text[])) setting
      where setting in ('search_path=', 'search_path=""')
    )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_recent_sign_in_directory_scoped_v1'
  ),
  'the directory pins an empty search_path'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  ('e3400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-actor@example.invalid','{}','{}',now(),now(),now(),false,false),
  ('e3400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-regular-one@example.invalid','{}','{}',now(),now(),'2099-01-02 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-regular-two@example.invalid','{}','{}',now(),now(),'2099-01-01 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-admin@example.invalid','{}','{}',now(),now(),'2099-01-12 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-founder@example.invalid','{}','{}',now(),now(),'2099-01-11 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-super@example.invalid','{}','{}',now(),now(),'2099-01-10 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-internal@example.invalid','{}','{}',now(),now(),'2099-02-01 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-internal-admin@example.invalid','{}','{}',now(),now(),'2099-02-02 00:00:00+00',false,false),
  ('e3400000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recent-non-admin-actor@example.invalid','{}','{}',now(),now(),now(),false,false);

update public.user_roles set role = 'super_admin'
where user_id = 'e3400000-0000-4000-8000-000000000001';
update public.user_roles set role = 'admin'
where user_id = 'e3400000-0000-4000-8000-000000000004';
update public.user_roles set role = 'founder_admin'
where user_id = 'e3400000-0000-4000-8000-000000000005';
update public.user_roles set role = 'super_admin'
where user_id = 'e3400000-0000-4000-8000-000000000006';
update public.user_roles set role = 'admin'
where user_id = 'e3400000-0000-4000-8000-000000000008';

insert into private.internal_test_accounts (
  user_id, email_at_classification, classification_source
)
values
  ('e3400000-0000-4000-8000-000000000007','recent-internal@example.invalid','recent_sign_in_regression'),
  ('e3400000-0000-4000-8000-000000000008','recent-internal-admin@example.invalid','recent_sign_in_regression');

select throws_ok(
  $$select public.admin_recent_sign_in_directory_scoped_v1(
    'e3400000-0000-4000-8000-000000000009', 2,
    'recent_auth_denied_0001', 'regular'
  )$$,
  'P0001', 'Administrator authorization required',
  'a non-administrator cannot read recent learner sign-ins'
);

create temporary table recent_results (
  data_scope text primary key,
  payload jsonb not null
) on commit drop;

insert into recent_results values
  ('regular', public.admin_recent_sign_in_directory_scoped_v1(
    'e3400000-0000-4000-8000-000000000001', 2,
    'recent_regular_key_0001', 'regular'
  )),
  ('internal_test', public.admin_recent_sign_in_directory_scoped_v1(
    'e3400000-0000-4000-8000-000000000001', 1,
    'recent_internal_key_01', 'internal_test'
  ));

select is(
  (select payload->>'dataScope' from recent_results where data_scope = 'regular'),
  'regular',
  'the regular response reports its exact scope'
);
select is(
  (select payload->>'total' from recent_results where data_scope = 'regular'),
  '2',
  'the regular limit is filled by learners after privileged rows are filtered'
);
select is(
  (select payload->'items'->0->>'id' from recent_results where data_scope = 'regular'),
  'e3400000-0000-4000-8000-000000000002',
  'the newest regular learner remains first despite newer administrator sign-ins'
);
select is(
  (select payload->'items'->1->>'id' from recent_results where data_scope = 'regular'),
  'e3400000-0000-4000-8000-000000000003',
  'administrator rows do not consume the regular learner limit'
);
select is(
  (
    select count(*)
    from recent_results result
    cross join lateral jsonb_array_elements(result.payload->'items') item
    where result.data_scope = 'regular'
      and item->>'role' in ('admin', 'founder_admin', 'super_admin')
  ),
  0::bigint,
  'admin, founder_admin, and super_admin are absent from regular learner results'
);
select is(
  (select payload->>'dataScope' from recent_results where data_scope = 'internal_test'),
  'internal_test',
  'the internal response reports its exact scope'
);
select is(
  (select payload->'items'->0->>'id' from recent_results where data_scope = 'internal_test'),
  'e3400000-0000-4000-8000-000000000007',
  'the classified internal learner remains visible while its newer admin is excluded'
);

select lives_ok(
  $$select public.admin_recent_sign_in_directory_scoped_v1(
    'e3400000-0000-4000-8000-000000000001', 2,
    'recent_regular_key_0001', 'regular'
  )$$,
  'an identical audited request is idempotent'
);
select is(
  (
    select count(*)
    from public.admin_audit_log
    where actor_user_id = 'e3400000-0000-4000-8000-000000000001'
      and target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and details->>'requestKey' = 'recent_regular_key_0001'
  ),
  1::bigint,
  'an idempotent replay creates exactly one audit record'
);
select is(
  (
    select details->>'resultCount'
    from public.admin_audit_log
    where actor_user_id = 'e3400000-0000-4000-8000-000000000001'
      and target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and details->>'requestKey' = 'recent_regular_key_0001'
  ),
  '2',
  'the audit records the learner-only result count'
);
select throws_ok(
  $$select public.admin_recent_sign_in_directory_scoped_v1(
    'e3400000-0000-4000-8000-000000000001', 2,
    'recent_regular_key_0001', 'internal_test'
  )$$,
  'P0001', 'Recent-sign-in request key conflict',
  'an audit key cannot be replayed with a different scope'
);

select * from finish(true);
rollback;
