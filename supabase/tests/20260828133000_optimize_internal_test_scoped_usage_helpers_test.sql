-- Regression coverage for the set-based internal/test usage partition.
-- Synthetic Auth, usage, and registry rows are always rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(20);

select ok(
  position(
    'admin_learner_reporting_scope_matches'
    in pg_get_functiondef('private.admin_scoped_usage_events(text)'::regprocedure)
  ) = 0,
  'event scope does not perform the row-by-row learner classifier'
);
select ok(
  position(
    'admin_learner_reporting_scope_matches'
    in pg_get_functiondef('private.admin_scoped_usage_sessions(text)'::regprocedure)
  ) = 0,
  'session scope does not perform the row-by-row learner classifier'
);
select ok(
  position(
    'join private.internal_test_accounts'
    in lower(pg_get_functiondef('private.admin_scoped_usage_events(text)'::regprocedure))
  ) > 0,
  'event scope joins the immutable internal/test registry directly'
);
select ok(
  position(
    'join public.user_roles'
    in lower(pg_get_functiondef('private.admin_scoped_usage_events(text)'::regprocedure))
  ) > 0,
  'event scope applies the established non-admin learner rule set-wise'
);
select ok(
  position(
    'join private.internal_test_accounts'
    in lower(pg_get_functiondef('private.admin_scoped_usage_sessions(text)'::regprocedure))
  ) > 0,
  'session scope joins the immutable internal/test registry directly'
);
select ok(
  position(
    'join public.user_roles'
    in lower(pg_get_functiondef('private.admin_scoped_usage_sessions(text)'::regprocedure))
  ) > 0,
  'session scope applies the established non-admin learner rule set-wise'
);
select is(
  has_function_privilege(
    'service_role', 'private.admin_scoped_usage_events(text)', 'execute'
  ),
  false,
  'the service role still cannot execute the private event helper'
);
select is(
  has_function_privilege(
    'service_role', 'private.admin_scoped_usage_sessions(text)', 'execute'
  ),
  false,
  'the service role still cannot execute the private session helper'
);
select ok(
  (
    select count(*) = 2
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'private'
      and function_row.proname in (
        'admin_scoped_usage_events',
        'admin_scoped_usage_sessions'
      )
      and function_row.prosecdef
      and 'search_path=""' = any(function_row.proconfig)
  ),
  'both helpers preserve SECURITY DEFINER with an empty search path'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous
)
values
  (
    'f2900000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scope-performance-admin@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), now(), false, false
  ),
  (
    'f2900000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scope-performance-internal@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), now(), false, false
  ),
  (
    'f2900000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scope-performance-regular@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id in (
  'f2900000-0000-4000-8000-000000000001',
  'f2900000-0000-4000-8000-000000000002'
);

insert into private.internal_test_accounts (
  user_id, email_at_classification, classification_source
)
values (
  'f2900000-0000-4000-8000-000000000002',
  'scope-performance-internal@example.invalid',
  'scoped_helper_performance_regression'
);

insert into public.usage_sessions (
  id, user_id, anonymous_session_id, visitor_id, auth_state,
  started_at, last_seen_at, device_category
)
values
  (
    'f2910000-0000-4000-8000-000000000001',
    'f2900000-0000-4000-8000-000000000002', null,
    'f2940000-0000-4000-8000-000000000001', 'signed_in',
    now() - interval '10 minutes', now(), 'desktop'
  ),
  (
    'f2910000-0000-4000-8000-000000000002',
    'f2900000-0000-4000-8000-000000000003', null,
    'f2940000-0000-4000-8000-000000000002', 'signed_in',
    now() - interval '10 minutes', now(), 'desktop'
  ),
  (
    'f2910000-0000-4000-8000-000000000003',
    'f2900000-0000-4000-8000-000000000001', null,
    'f2940000-0000-4000-8000-000000000003', 'signed_in',
    now() - interval '10 minutes', now(), 'desktop'
  ),
  (
    'f2910000-0000-4000-8000-000000000004',
    null, 'f2930000-0000-4000-8000-000000000004',
    'f2940000-0000-4000-8000-000000000004', 'guest',
    now() - interval '10 minutes', now(), 'mobile'
  );

insert into public.usage_events (
  id, session_id, user_id, anonymous_session_id,
  event_type, occurred_at, page_area, metadata
)
values
  (
    'f2920000-0000-4000-8000-000000000001',
    'f2910000-0000-4000-8000-000000000001', null,
    'f2930000-0000-4000-8000-000000000001',
    'page_view', now(), 'scope-test', '{}'::jsonb
  ),
  (
    'f2920000-0000-4000-8000-000000000002',
    'f2910000-0000-4000-8000-000000000001',
    'f2900000-0000-4000-8000-000000000003', null,
    'page_view', now(), 'scope-test', '{}'::jsonb
  ),
  (
    'f2920000-0000-4000-8000-000000000003',
    'f2910000-0000-4000-8000-000000000002', null,
    'f2930000-0000-4000-8000-000000000003',
    'page_view', now(), 'scope-test', '{}'::jsonb
  ),
  (
    'f2920000-0000-4000-8000-000000000004',
    'f2910000-0000-4000-8000-000000000003', null,
    'f2930000-0000-4000-8000-000000000005',
    'page_view', now(), 'scope-test', '{}'::jsonb
  ),
  (
    'f2920000-0000-4000-8000-000000000005',
    'f2910000-0000-4000-8000-000000000004', null,
    'f2930000-0000-4000-8000-000000000004',
    'page_view', now(), 'scope-test', '{}'::jsonb
  ),
  (
    'f2920000-0000-4000-8000-000000000006',
    'f2910000-0000-4000-8000-000000000002',
    'f2900000-0000-4000-8000-000000000002', null,
    'page_view', now(), 'scope-test', '{}'::jsonb
  );

select is(
  (
    select count(*)
    from private.admin_scoped_usage_sessions('internal_test') row_value
    where row_value.id::text like 'f2910000-%'
  ),
  1::bigint,
  'internal sessions include the classified owner even when that owner is an admin'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_sessions('regular') row_value
    where row_value.id::text like 'f2910000-%'
  ),
  2::bigint,
  'regular sessions include the learner and guest but exclude admins'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_events('internal_test') row_value
    where row_value.id::text like 'f2920000-%'
  ),
  2::bigint,
  'internal events use the effective immutable owner and retain classified admins'
);
select is(
  (
    select count(*)
    from private.admin_scoped_usage_events('regular') row_value
    where row_value.id::text like 'f2920000-%'
  ),
  3::bigint,
  'regular events include learner and unattributed activity but exclude admins'
);
select ok(
  exists (
    select 1 from private.admin_scoped_usage_events('regular')
    where id = 'f2920000-0000-4000-8000-000000000002'
  ) and not exists (
    select 1 from private.admin_scoped_usage_events('internal_test')
    where id = 'f2920000-0000-4000-8000-000000000002'
  ),
  'an explicit regular event owner overrides its internal session owner'
);
select ok(
  exists (
    select 1 from private.admin_scoped_usage_events('internal_test')
    where id = 'f2920000-0000-4000-8000-000000000001'
  ),
  'a null event owner falls back to the internal session owner'
);
select ok(
  exists (
    select 1 from private.admin_scoped_usage_events('internal_test')
    where id = 'f2920000-0000-4000-8000-000000000006'
  ),
  'an explicit internal event owner overrides its regular session owner'
);
select ok(
  not exists (
    select 1 from private.admin_scoped_usage_events('regular')
    where id = 'f2920000-0000-4000-8000-000000000004'
  ) and not exists (
    select 1 from private.admin_scoped_usage_events('internal_test')
    where id = 'f2920000-0000-4000-8000-000000000004'
  ),
  'an unclassified admin event is excluded from learner reporting scopes'
);
select throws_ok(
  $$select count(*) from private.admin_scoped_usage_events('all')$$,
  'P0001', 'Valid data scope required',
  'event scope still rejects unsupported scopes before returning data'
);
select throws_ok(
  $$select count(*) from private.admin_scoped_usage_sessions('all')$$,
  'P0001', 'Valid data scope required',
  'session scope still rejects unsupported scopes before returning data'
);

-- Production had about 18,000 events when the original row-by-row helpers
-- crossed the REST role's eight-second statement timeout. Keep a comparable
-- cardinality in the regression without retaining any synthetic rows.
insert into public.usage_events (
  id, session_id, user_id, anonymous_session_id,
  event_type, occurred_at, page_area, metadata
)
select
  (
    substr(event_hash, 1, 8) || '-' || substr(event_hash, 9, 4) || '-4' ||
    substr(event_hash, 14, 3) || '-8' || substr(event_hash, 18, 3) || '-' ||
    substr(event_hash, 21, 12)
  )::uuid,
  'f2910000-0000-4000-8000-000000000002'::uuid,
  'f2900000-0000-4000-8000-000000000003'::uuid,
  null,
  'page_view',
  now() - ((series_value % 3600)::text || ' seconds')::interval,
  'scope-performance',
  '{}'::jsonb
from generate_series(1, 20000) series_value
cross join lateral (
  select md5('scoped-helper-performance-' || series_value::text) as event_hash
) hash_value;

set local statement_timeout = '8s';
select lives_ok(
  $$
    select public.admin_dashboard_snapshot_scoped_v1(
      'f2900000-0000-4000-8000-000000000001',
      now() - interval '30 days',
      now(),
      now() - interval '60 days',
      now() - interval '30 days',
      'regular'
    )
  $$,
  'the scoped dashboard stays within the REST role timeout at production-like cardinality'
);
set local statement_timeout = '2min';

select * from finish();
rollback;
