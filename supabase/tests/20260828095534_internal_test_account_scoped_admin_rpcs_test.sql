-- Structural, security, seed-atomicity, historical-attribution, and scoped-RPC
-- contracts. All synthetic Auth users and activity are rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(66);

select has_schema('private', 'private reporting schema exists');
select has_table('private', 'internal_test_accounts', 'internal/test registry exists');
select col_is_pk(
  'private', 'internal_test_accounts', 'user_id',
  'registry is keyed by immutable Auth user id'
);
select has_column(
  'private', 'internal_test_accounts', 'email_at_classification',
  'registry retains the migration-time email only as evidence'
);
select has_column(
  'private', 'internal_test_accounts', 'classification_source',
  'registry records classification provenance'
);
select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'private'
      and class.relname = 'internal_test_accounts'
  ),
  'registry has forced row-level security'
);
select is(
  has_schema_privilege('anon', 'private', 'usage'), false,
  'anonymous clients cannot use the private schema'
);
select is(
  has_schema_privilege('authenticated', 'private', 'usage'), false,
  'authenticated clients cannot use the private schema'
);
select is(
  has_schema_privilege('service_role', 'private', 'usage'), false,
  'the service role cannot bypass public scoped RPCs through the private schema'
);
select is(
  has_table_privilege(
    'service_role', 'private.internal_test_accounts', 'select'
  ),
  false,
  'the service role cannot read the private registry directly'
);
select has_function(
  'private', 'seed_internal_test_accounts_20260828', array[]::text[],
  'atomic seven-account seed resolver exists'
);
select is(
  has_function_privilege(
    'service_role', 'private.seed_internal_test_accounts_20260828()', 'execute'
  ),
  false,
  'the one-shot seed resolver is not an API operation'
);
select has_function(
  'private', 'require_admin_data_scope', array['text'],
  'strict reporting-scope validator exists'
);
select has_function(
  'private', 'admin_usage_event_owner', array['uuid', 'uuid'],
  'effective event-owner resolver exists'
);
select throws_ok(
  $$select private.require_admin_data_scope('all')$$,
  'P0001', 'Valid data scope required',
  'unsupported scopes fail closed'
);
select is(
  private.require_admin_data_scope('regular'), 'regular',
  'regular is an accepted exact scope'
);
select is(
  private.require_admin_data_scope('internal_test'), 'internal_test',
  'internal_test is an accepted exact scope'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  (
    'f2800000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wallyesteban1993@gmail.com',
    '{}'::jsonb, '{"full_name":"Scoped Internal Owner"}'::jsonb,
    now(), now(), now(), false, false
  ),
  (
    'f2800000-0000-4000-8000-000000000099',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scoped-regular@example.invalid',
    '{}'::jsonb, '{"full_name":"Scoped Regular Learner"}'::jsonb,
    now(), now(), now(), false, false
  );

select throws_like(
  $$select private.seed_internal_test_accounts_20260828()$$,
  '%requires exactly one Auth identity for each approved email%',
  'a partial production allowlist fails before any classification write'
);
select is(
  (
    select count(*)
    from private.internal_test_accounts
    where classification_source = 'owner_allowlist_20260828'
  ),
  0::bigint,
  'the failed partial seed writes no allowlist row'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  ('f2800000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tc.mdppa@gmail.com','{}','{}',now(),now(),now(),false,false),
  ('f2800000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','orientalmindorodebsoc@gmail.com','{}','{}',now(),now(),now(),false,false),
  ('f2800000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gilmardecastro05@gmail.com','{}','{}',now(),now(),now(),false,false),
  ('f2800000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','titanpatrol6969@gmail.com','{}','{}',now(),now(),now(),false,false),
  ('f2800000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','support.duediligence@gmail.com','{}','{}',now(),now(),now(),false,false),
  ('f2800000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perezemricoluiz@gmail.com','{}','{}',now(),now(),now(),false,false);

select is(
  private.seed_internal_test_accounts_20260828(), 7,
  'the complete exact allowlist resolves and writes all seven ids atomically'
);
select is(
  (
    select count(*)
    from private.internal_test_accounts
    where classification_source = 'owner_allowlist_20260828'
  ),
  7::bigint,
  'exactly seven approved ids are classified'
);
select is(
  private.seed_internal_test_accounts_20260828(), 7,
  'the exact seed is safely repeatable'
);
select is(
  (
    select count(*)
    from private.internal_test_accounts
    where classification_source = 'owner_allowlist_20260828'
  ),
  7::bigint,
  'a repeated seed creates no duplicate classification'
);

update public.user_roles
set role = 'super_admin'
where user_id = 'f2800000-0000-4000-8000-000000000001';

select is(
  private.admin_reporting_scope_matches(
    'f2800000-0000-4000-8000-000000000001', 'internal_test'
  ),
  true,
  'an approved immutable id belongs to internal_test'
);
select is(
  private.admin_reporting_scope_matches(
    'f2800000-0000-4000-8000-000000000001', 'regular'
  ),
  false,
  'an approved immutable id is excluded from regular data'
);
select is(
  private.admin_reporting_scope_matches(
    'f2800000-0000-4000-8000-000000000099', 'regular'
  ),
  true,
  'an unclassified immutable id remains regular'
);
select is(
  private.admin_reporting_scope_matches(
    'f2800000-0000-4000-8000-000000000099', 'internal_test'
  ),
  false,
  'an unclassified immutable id is not internal_test'
);
select is(
  private.admin_learner_reporting_scope_matches(
    'f2800000-0000-4000-8000-000000000001', 'internal_test'
  ),
  true,
  'an explicitly classified internal id remains visible even when its role is super_admin'
);
select is(
  private.admin_usage_event_owner(
    'f2800000-0000-4000-8000-000000000099',
    'f2800000-0000-4000-8000-000000000001'
  ),
  'f2800000-0000-4000-8000-000000000099'::uuid,
  'an explicit event user takes precedence over the session user'
);
select is(
  private.admin_usage_event_owner(
    null,
    'f2800000-0000-4000-8000-000000000001'
  ),
  'f2800000-0000-4000-8000-000000000001'::uuid,
  'a null event user falls back to its immutable session user'
);
select is(
  private.admin_usage_event_owner(null, null), null::uuid,
  'a genuinely unattributed event stays unattributed'
);

insert into public.usage_sessions (
  id, user_id, visitor_id, auth_state, started_at, last_seen_at,
  device_category
)
values
  ('f2810000-0000-4000-8000-000000000001','f2800000-0000-4000-8000-000000000001','f2830000-0000-4000-8000-000000000001','signed_in',now()-interval '5 minutes',now(),'desktop'),
  ('f2810000-0000-4000-8000-000000000002','f2800000-0000-4000-8000-000000000099','f2830000-0000-4000-8000-000000000002','signed_in',now()-interval '5 minutes',now(),'desktop');

insert into public.usage_events (
  id, session_id, user_id, anonymous_session_id,
  event_key, event_type, occurred_at, page_area, metadata
)
values
  ('f2820000-0000-4000-8000-000000000001','f2810000-0000-4000-8000-000000000001',null,'f2830000-0000-4000-8000-000000000001','scoped_event_key_0001','page_view',now(),'admin-test','{}'),
  ('f2820000-0000-4000-8000-000000000002','f2810000-0000-4000-8000-000000000001','f2800000-0000-4000-8000-000000000099',null,'scoped_event_key_0002','page_view',now(),'admin-test','{}'),
  ('f2820000-0000-4000-8000-000000000003','f2810000-0000-4000-8000-000000000002',null,'f2830000-0000-4000-8000-000000000002','scoped_event_key_0003','page_view',now(),'admin-test','{}');

select is(
  (
    select count(*)
    from private.admin_scoped_usage_events('internal_test') event_row
    where event_row.id::text like 'f2820000-%'
  ),
  1::bigint,
  'internal usage includes a historical null-user event owned by an internal session'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_events('regular') event_row
    where event_row.id::text like 'f2820000-%'
  ),
  2::bigint,
  'regular usage keeps regular events, including explicit-user precedence'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_sessions('internal_test') session_row
    where session_row.id::text like 'f2810000-%'
  ),
  1::bigint,
  'internal sessions are partitioned by immutable owner id'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_sessions('regular') session_row
    where session_row.id::text like 'f2810000-%'
  ),
  1::bigint,
  'regular sessions exclude the approved internal owner'
);
select is(
  (
    select count(*) from private.admin_scoped_usage_events('internal_test') e
    where e.id::text like 'f2820000-%'
  ) + (
    select count(*) from private.admin_scoped_usage_events('regular') e
    where e.id::text like 'f2820000-%'
  ),
  3::bigint,
  'the two scopes are exhaustive for the synthetic historical events'
);

create temporary table expected_scoped_rpcs (
  function_name text primary key
) on commit drop;
insert into expected_scoped_rpcs(function_name)
values
  ('admin_dashboard_snapshot_scoped_v1'),
  ('admin_overview_engagement_metrics_scoped_v1'),
  ('admin_live_activity_scoped_v1'),
  ('admin_user_monitoring_directory_scoped_v1'),
  ('admin_prepare_user_directory_email_export_scoped_v1'),
  ('admin_recent_sign_in_directory_scoped_v1'),
  ('admin_recent_user_activity_directory_scoped_v1'),
  ('admin_preview_answer_history_by_feature_scoped_v1'),
  ('admin_export_answer_history_scoped_v1'),
  ('phase4_admin_operational_data_scoped_v1');

select is(
  (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected
      on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  10::bigint,
  'all ten explicit public scoped RPC names exist'
);
select is(
  (
    select max(overload_count)
    from (
      select count(*)::integer as overload_count
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      join expected_scoped_rpcs expected
        on expected.function_name = procedure.proname
      where namespace.nspname = 'public'
      group by procedure.proname
    ) overloads
  ),
  1,
  'each scoped RPC name has exactly one signature'
);
select ok(
  (
    select bool_and(has_function_privilege('service_role', procedure.oid, 'execute'))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'the Worker service role can execute every public scoped RPC'
);
select ok(
  (
    select bool_and(not has_function_privilege('authenticated', procedure.oid, 'execute'))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'authenticated browser users cannot execute any scoped RPC'
);
select ok(
  (
    select bool_and(not has_function_privilege('anon', procedure.oid, 'execute'))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'anonymous browser users cannot execute any scoped RPC'
);
select ok(
  (
    select bool_and(not has_function_privilege('public', procedure.oid, 'execute'))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'PUBLIC cannot execute any scoped RPC'
);
select ok(
  (
    select bool_and(procedure.prosecdef)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'all public scoped RPCs use controlled definer privileges'
);
select ok(
  (
    select bool_and(exists (
      select 1
      from unnest(coalesce(procedure.proconfig, '{}'::text[])) setting
      where setting in ('search_path=', 'search_path=""')
    ))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'all public scoped RPCs pin an empty search_path'
);
select ok(
  (
    select bool_and(procedure.pronargdefaults = 0)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'scoped RPCs have no default-argument ambiguity'
);
select ok(
  (
    select bool_and(
      pg_get_function_arguments(procedure.oid) like '%p_data_scope text'
    )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join expected_scoped_rpcs expected on expected.function_name = procedure.proname
    where namespace.nspname = 'public'
  ),
  'every public scoped RPC requires p_data_scope as its final argument'
);
select ok(
  (
    select bool_and(not has_function_privilege('service_role', procedure.oid, 'execute'))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like '%_scoped_v1'
  ),
  'private scoped implementation functions are not executable through the API role'
);
select ok(
  position(
    'legacy_formal_exam'
    in pg_get_functiondef(
      'public.admin_preview_answer_history_by_feature_scoped_v1(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text,text)'::regprocedure
    )
  ) > 0,
  'the scoped answer preview preserves the legacy formal-exam route'
);

select lives_ok(
  $$
    select public.admin_recent_sign_in_directory_scoped_v1(
      'f2800000-0000-4000-8000-000000000001',
      5,
      'scope_recent_key_0001',
      'regular'
    )
  $$,
  'a founder can read the regular recent-sign-in scope'
);
select throws_ok(
  $$
    select public.admin_recent_sign_in_directory_scoped_v1(
      'f2800000-0000-4000-8000-000000000001',
      5,
      'scope_recent_key_0001',
      'internal_test'
    )
  $$,
  'P0001', 'Recent-sign-in request key conflict',
  'an audit key cannot be replayed with a different data scope'
);
select is(
  (
    select details->>'dataScope'
    from public.admin_audit_log
    where actor_user_id = 'f2800000-0000-4000-8000-000000000001'
      and target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and details->>'requestKey' = 'scope_recent_key_0001'
  ),
  'regular',
  'the sensitive-view audit records the selected data scope'
);

select lives_ok(
  $$
    select public.admin_export_answer_history_scoped_v1(
      'f2800000-0000-4000-8000-000000000001',
      'f2800000-0000-4000-8000-000000000099',
      null,
      null,
      10,
      'Scoped export regression coverage',
      'scope_export_key_0001',
      'regular'
    )
  $$,
  'the scoped answer-history export passes scope through every helper layer'
);

select lives_ok(
  $$
    select public.admin_dashboard_snapshot_scoped_v1(
      'f2800000-0000-4000-8000-000000000001',
      now() - interval '1 day',
      now(),
      now() - interval '2 days',
      now() - interval '1 day',
      'internal_test'
    )
  $$,
  'the scoped dashboard snapshot executes against current staging schema'
);
select lives_ok(
  $$select public.admin_overview_engagement_metrics_scoped_v1(
    'f2800000-0000-4000-8000-000000000001', 'internal_test'
  )$$,
  'the scoped engagement overview executes against current staging schema'
);
select lives_ok(
  $$select public.admin_live_activity_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    10,
    'scope_live_key_0001',
    'regular'
  )$$,
  'the scoped live-activity summary executes against current staging schema'
);
select lives_ok(
  $$select public.admin_user_monitoring_directory_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    '',
    10,
    0,
    'scope_monitor_key_0001',
    'dashboard',
    'regular'
  )$$,
  'the scoped user-monitoring directory executes against current staging schema'
);
select lives_ok(
  $$select public.admin_prepare_user_directory_email_export_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    '',
    10,
    'wally',
    'Scoped directory export regression coverage',
    'scope_email_key_0001',
    'regular'
  )$$,
  'the scoped directory email preparation executes without sending mail'
);
select lives_ok(
  $$select public.admin_recent_user_activity_directory_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    '',
    now() - interval '1 day',
    now(),
    10,
    0,
    'scope_recent_use_key_0001',
    'regular'
  )$$,
  'the scoped recent-user activity directory executes against current staging schema'
);
select lives_ok(
  $$select public.admin_preview_answer_history_by_feature_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    'f2800000-0000-4000-8000-000000000099',
    null,
    null,
    '',
    'all',
    10,
    0,
    'scope_preview_key_0001',
    'regular'
  )$$,
  'the scoped answer-history preview executes through source enrichment'
);
select lives_ok(
  $$select public.phase4_admin_operational_data_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    'payments', '', 10, 0, 'regular'
  )$$,
  'the scoped payment ledger executes against current staging schema'
);
select lives_ok(
  $$select public.phase4_admin_operational_data_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    'refunds', '', 10, 0, 'regular'
  )$$,
  'the scoped refund ledger executes against current staging schema'
);
select lives_ok(
  $$select public.phase4_admin_operational_data_scoped_v1(
    'f2800000-0000-4000-8000-000000000001',
    'partnerships', '', 10, 0, 'regular'
  )$$,
  'the scoped partnership ledger executes against current staging schema'
);

create temporary table scoped_rpc_results (
  result_name text primary key,
  payload jsonb not null
) on commit drop;
select lives_ok(
  $$
    insert into scoped_rpc_results(result_name, payload)
    values (
      'internal_access',
      public.phase4_admin_operational_data_scoped_v1(
        'f2800000-0000-4000-8000-000000000001',
        'access', '', 100, 0, 'internal_test'
      )
    )
  $$,
  'the founder can read the internal_test access ledger separately'
);
select ok(
  not exists (
    select 1
    from scoped_rpc_results result
    cross join lateral jsonb_array_elements(result.payload->'items') item
    where result.result_name = 'internal_access'
      and not private.admin_reporting_scope_matches(
        (item->>'user_id')::uuid,
        'internal_test'
      )
  ),
  'every returned internal access row belongs to an explicitly classified id'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.phase4_admin_operational_data_scoped_v1(
        'f2800000-0000-4000-8000-000000000001',
        'access', '', 100, 0, 'regular'
      )->'items'
    ) item
    join private.internal_test_accounts classified
      on classified.user_id = (item->>'user_id')::uuid
  ),
  'the regular access ledger returns no classified internal id'
);
select is(
  (
    public.phase4_admin_operational_data_scoped_v1(
      'f2800000-0000-4000-8000-000000000001',
      'access',
      'f2800000-0000-4000-8000-000000000099',
      100,
      0,
      'regular'
    )->>'total'
  )::integer,
  1,
  'phase4 totals apply the same search and data-scope predicates as their items'
);

select * from finish();
rollback;
