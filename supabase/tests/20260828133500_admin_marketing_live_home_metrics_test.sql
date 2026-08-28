-- Home marketing reach and distinct-user live monitoring. Synthetic Auth,
-- telemetry, and session rows are rolled back.

begin;
set transaction isolation level repeatable read;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(23);

select has_function(
  'public', 'admin_marketing_summary_scoped_v1',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone',
        'timestamp with time zone', 'timestamp with time zone', 'text'],
  'scoped Home marketing summary exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'execute'
  ),
  'the Worker service role can execute the marketing summary'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'execute'
  ),
  false,
  'authenticated browser users cannot execute the marketing summary directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'execute'
  ),
  false,
  'anonymous users cannot execute the marketing summary'
);
select is(
  has_function_privilege(
    'public',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'execute'
  ),
  false,
  'PUBLIC cannot execute the marketing summary'
);
select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_marketing_summary_scoped_v1'
  ),
  'the marketing summary uses controlled definer privileges'
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
      and procedure.proname = 'admin_marketing_summary_scoped_v1'
  ),
  'the marketing summary pins an empty search_path'
);
select ok(
  (
    select pg_get_function_arguments(procedure.oid) like '%p_data_scope text'
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'admin_marketing_summary_scoped_v1'
  ),
  'the reporting scope is a mandatory final argument'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  ('e3300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-admin@example.invalid','{}','{}',now()-interval '100 days',now(),now(),false,false);

update public.user_roles
set role = 'super_admin'
where user_id = 'e3300000-0000-4000-8000-000000000001';

-- Capture environment totals before adding learner fixtures so assertions are
-- deterministic on local, preview, staging, and production-shaped databases.
create temporary table marketing_baseline (
  data_scope text primary key,
  payload jsonb not null
) on commit drop;
insert into marketing_baseline values
  ('regular', public.admin_marketing_summary_scoped_v1(
    'e3300000-0000-4000-8000-000000000001',
    now()-interval '30 days', now(),
    now()-interval '60 days', now()-interval '30 days', 'regular'
  )),
  ('internal_test', public.admin_marketing_summary_scoped_v1(
    'e3300000-0000-4000-8000-000000000001',
    now()-interval '30 days', now(),
    now()-interval '60 days', now()-interval '30 days', 'internal_test'
  ));

create temporary table live_baseline (
  data_scope text primary key,
  payload jsonb not null
) on commit drop;
insert into live_baseline values
  ('regular', public.admin_live_activity_scoped_v1(
    'e3300000-0000-4000-8000-000000000001', 10,
    'marketing_live_baseline_regular', 'regular'
  )),
  ('internal_test', public.admin_live_activity_scoped_v1(
    'e3300000-0000-4000-8000-000000000001', 10,
    'marketing_live_baseline_internal', 'internal_test'
  ));

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  ('e3300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-regular@example.invalid','{}','{}',now()-interval '2 days',now(),now(),false,false),
  ('e3300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-regular-two@example.invalid','{}','{}',now()-interval '2 days',now(),now(),false,false),
  ('e3300000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-internal@example.invalid','{}','{}',now()-interval '2 days',now(),now(),false,false),
  ('e3300000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-admin-viewer@example.invalid','{}','{}',now()-interval '2 days',now(),now(),false,false),
  ('e3300000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','home-previous@example.invalid','{}','{}',now()-interval '35 days',now(),now(),false,false);

update public.user_roles
set role = 'super_admin'
where user_id = 'e3300000-0000-4000-8000-000000000005';

insert into private.internal_test_accounts (
  user_id, email_at_classification, classification_source
) values (
  'e3300000-0000-4000-8000-000000000004',
  'home-internal@example.invalid',
  'marketing_live_test_fixture'
);

insert into public.forum_telemetry_events (
  user_id, event_type, created_at
)
values
  ('e3300000-0000-4000-8000-000000000002','quorum_opened',now()-interval '1 day'),
  ('e3300000-0000-4000-8000-000000000002','quorum_opened',now()-interval '12 hours'),
  ('e3300000-0000-4000-8000-000000000004','quorum_opened',now()-interval '1 day'),
  ('e3300000-0000-4000-8000-000000000005','quorum_opened',now()-interval '1 day'),
  ('e3300000-0000-4000-8000-000000000006','quorum_opened',now()-interval '35 days');

insert into public.usage_sessions (
  id, user_id, visitor_id, auth_state, started_at, last_seen_at,
  last_page_area, device_category
)
values
  ('e3310000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000002','e3320000-0000-4000-8000-000000000001','signed_in',now()-interval '20 minutes',now()-interval '1 minute','quorum','desktop'),
  ('e3310000-0000-4000-8000-000000000002','e3300000-0000-4000-8000-000000000002','e3320000-0000-4000-8000-000000000002','signed_in',now()-interval '20 minutes',now()-interval '2 minutes','home','mobile'),
  ('e3310000-0000-4000-8000-000000000003','e3300000-0000-4000-8000-000000000003','e3320000-0000-4000-8000-000000000003','signed_in',now()-interval '20 minutes',now()-interval '3 minutes','mock_bar','desktop'),
  ('e3310000-0000-4000-8000-000000000004','e3300000-0000-4000-8000-000000000004','e3320000-0000-4000-8000-000000000004','signed_in',now()-interval '20 minutes',now()-interval '4 minutes','lex-forum','desktop'),
  ('e3310000-0000-4000-8000-000000000005','e3300000-0000-4000-8000-000000000005','e3320000-0000-4000-8000-000000000005','signed_in',now()-interval '20 minutes',now()-interval '1 minute','home','desktop');

create temporary table marketing_results (
  data_scope text primary key,
  payload jsonb not null
) on commit drop;
insert into marketing_results values
  ('regular', public.admin_marketing_summary_scoped_v1(
    'e3300000-0000-4000-8000-000000000001',
    now()-interval '30 days', now(),
    now()-interval '60 days', now()-interval '30 days', 'regular'
  )),
  ('internal_test', public.admin_marketing_summary_scoped_v1(
    'e3300000-0000-4000-8000-000000000001',
    now()-interval '30 days', now(),
    now()-interval '60 days', now()-interval '30 days', 'internal_test'
  ));

select is(
  (select (payload->'current'->>'home_viewers')::integer from marketing_results where data_scope='regular'),
  (select (payload->'current'->>'home_viewers')::integer + 1 from marketing_baseline where data_scope='regular'),
  'Home viewers deduplicate repeat opens and exclude administrators and internal users'
);
select is(
  (select (payload->'current'->>'home_viewers')::integer from marketing_results where data_scope='internal_test'),
  (select (payload->'current'->>'home_viewers')::integer + 1 from marketing_baseline where data_scope='internal_test'),
  'the internal Home viewer count includes only classified non-administrator users'
);
select is(
  (select (payload->'previous'->>'home_viewers')::integer from marketing_results where data_scope='regular'),
  (select (payload->'previous'->>'home_viewers')::integer + 1 from marketing_baseline where data_scope='regular'),
  'the comparison period counts historical Home viewers separately'
);
select is(
  (select (payload->'current'->>'new_accounts')::integer from marketing_results where data_scope='regular'),
  (select (payload->'current'->>'new_accounts')::integer + 2 from marketing_baseline where data_scope='regular'),
  'new accounts are selected-period non-administrator regular Auth users'
);
select is(
  (select (payload->'current'->>'new_accounts')::integer from marketing_results where data_scope='internal_test'),
  (select (payload->'current'->>'new_accounts')::integer + 1 from marketing_baseline where data_scope='internal_test'),
  'new internal accounts exclude classified administrators'
);
select is(
  (select (payload->'previous'->>'new_accounts')::integer from marketing_results where data_scope='regular'),
  (select (payload->'previous'->>'new_accounts')::integer + 1 from marketing_baseline where data_scope='regular'),
  'comparison-period new accounts use the same definition'
);
select throws_ok(
  $$select public.admin_marketing_summary_scoped_v1(
    'e3300000-0000-4000-8000-000000000001',
    now()-interval '30 days', now(),
    now()-interval '60 days', now()-interval '30 days', 'all'
  )$$,
  'P0001', 'Valid data scope required',
  'the marketing summary rejects combined or unsupported scopes'
);

create temporary table live_results (
  data_scope text primary key,
  payload jsonb not null
) on commit drop;
insert into live_results values
  ('regular', public.admin_live_activity_scoped_v1(
    'e3300000-0000-4000-8000-000000000001', 10,
    'marketing_live_regular_0001', 'regular'
  )),
  ('internal_test', public.admin_live_activity_scoped_v1(
    'e3300000-0000-4000-8000-000000000001', 10,
    'marketing_live_internal_0001', 'internal_test'
  ));

select is(
  (select (payload->>'activeSignedInLast5Minutes')::integer from live_results where data_scope='regular'),
  (select (payload->>'activeSignedInLast5Minutes')::integer + 2 from live_baseline where data_scope='regular'),
  'active now counts distinct regular non-administrator users, not session rows'
);
select is(
  (select (payload->>'activeSignedInLast30Minutes')::integer from live_results where data_scope='regular'),
  (select (payload->>'activeSignedInLast30Minutes')::integer + 2 from live_baseline where data_scope='regular'),
  'recently active counts distinct regular non-administrator users'
);
select is(
  (select (payload->>'activeHomeLast5Minutes')::integer from live_results where data_scope='regular'),
  (select (payload->>'activeHomeLast5Minutes')::integer + 1 from live_baseline where data_scope='regular'),
  'active on Home recognizes current and legacy Home page-area names'
);
select is(
  (select (payload->>'activeHomeLast30Minutes')::integer from live_results where data_scope='internal_test'),
  (select (payload->>'activeHomeLast30Minutes')::integer + 1 from live_baseline where data_scope='internal_test'),
  'internal live Home activity excludes administrators in every scope'
);
select ok(
  (select payload->>'definition' from live_results where data_scope='regular')
    not like '%session records%',
  'the live definition does not mislabel session rows as people'
);
select ok(
  (select payload->>'definition' from live_results where data_scope='regular')
    like '%distinct signed-in non-administrator users%',
  'the live definition states the unit and exclusion clearly'
);
select is(
  (
    select (details->>'activeHome5Minutes')::integer
    from public.admin_audit_log
    where actor_user_id='e3300000-0000-4000-8000-000000000001'
      and target_resource_type='admin_live_activity_scoped_v1'
      and details->>'requestKey'='marketing_live_regular_0001'
  ),
  (select (payload->>'activeHomeLast5Minutes')::integer + 1 from live_baseline where data_scope='regular'),
  'the aggregate Home live view is recorded in the administrator audit log'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_live_activity_scoped_v1(uuid,integer,text,text)',
    'execute'
  ),
  false,
  'the revised live aggregate remains inaccessible to browser roles'
);
select * from finish();
rollback;
