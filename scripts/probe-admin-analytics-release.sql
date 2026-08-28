\set ON_ERROR_STOP on

-- Exercise the exact database contracts required by the Admin analytics
-- Worker before cutover. Each RPC/scope pair is its own SQL statement so it
-- receives the same independent eight-second budget used by PostgREST. The
-- audited live-activity and recent-sign-in calls are all rolled back.
begin;

with eligible_actor as materialized (
  select role_row.user_id
  from public.user_roles role_row
  where role_row.role::text in ('admin', 'founder_admin', 'super_admin')
    and public.admin_has_capability(role_row.user_id, 'analytics_viewer')
    and public.admin_has_capability(role_row.user_id, 'learner_analytics_viewer')
  order by case role_row.role::text
    when 'super_admin' then 1
    when 'founder_admin' then 2
    else 3
  end, role_row.user_id
  limit 1
)
select
  exists(select 1 from eligible_actor) as admin_analytics_probe_actor_ready,
  coalesce((select user_id::text from eligible_actor), '') as admin_analytics_probe_actor
\gset

\if :admin_analytics_probe_actor_ready
  \echo 'Authorized Admin analytics release-probe actor selected.'
\else
  \echo 'Admin analytics release probe requires an authorized analytics administrator.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_dashboard_snapshot_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    now() - interval '30 days', now(),
    now() - interval '60 days', now() - interval '30 days',
    'regular'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object',
  false
) as admin_analytics_dashboard_regular_ready
from response
\gset
\if :admin_analytics_dashboard_regular_ready
  \echo 'Regular Admin dashboard live probe passed.'
\else
  \echo 'Regular Admin dashboard live probe returned a non-object payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_dashboard_snapshot_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    now() - interval '30 days', now(),
    now() - interval '60 days', now() - interval '30 days',
    'internal_test'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object',
  false
) as admin_analytics_dashboard_internal_ready
from response
\gset
\if :admin_analytics_dashboard_internal_ready
  \echo 'Internal-test Admin dashboard live probe passed.'
\else
  \echo 'Internal-test Admin dashboard live probe returned a non-object payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_marketing_summary_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    now() - interval '30 days', now(),
    now() - interval '60 days', now() - interval '30 days',
    'regular'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and payload->'current' ? 'home_viewers'
    and payload->'current' ? 'new_accounts',
  false
) as admin_analytics_marketing_regular_ready
from response
\gset
\if :admin_analytics_marketing_regular_ready
  \echo 'Regular Admin marketing-summary live probe passed.'
\else
  \echo 'Regular Admin marketing-summary live probe returned an incomplete payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_marketing_summary_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    now() - interval '30 days', now(),
    now() - interval '60 days', now() - interval '30 days',
    'internal_test'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and payload->'current' ? 'home_viewers'
    and payload->'current' ? 'new_accounts',
  false
) as admin_analytics_marketing_internal_ready
from response
\gset
\if :admin_analytics_marketing_internal_ready
  \echo 'Internal-test Admin marketing-summary live probe passed.'
\else
  \echo 'Internal-test Admin marketing-summary live probe returned an incomplete payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_live_activity_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    100,
    'admin_analytics_release_probe_regular',
    'regular'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and payload ? 'activeSignedInLast5Minutes'
    and payload ? 'activeSignedInLast30Minutes'
    and payload ? 'activeHomeLast5Minutes'
    and payload ? 'activeHomeLast30Minutes',
  false
) as admin_analytics_live_regular_ready
from response
\gset
\if :admin_analytics_live_regular_ready
  \echo 'Regular Admin live-activity probe passed.'
\else
  \echo 'Regular Admin live-activity probe returned an incomplete payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_live_activity_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    100,
    'admin_analytics_release_probe_internal',
    'internal_test'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and payload ? 'activeSignedInLast5Minutes'
    and payload ? 'activeSignedInLast30Minutes'
    and payload ? 'activeHomeLast5Minutes'
    and payload ? 'activeHomeLast30Minutes',
  false
) as admin_analytics_live_internal_ready
from response
\gset
\if :admin_analytics_live_internal_ready
  \echo 'Internal-test Admin live-activity probe passed.'
\else
  \echo 'Internal-test Admin live-activity probe returned an incomplete payload.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_recent_sign_in_directory_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    25,
    'admin_recent_signins_release_regular',
    'regular'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'items') = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(payload->'items') = 'array'
          then payload->'items'
          else '[]'::jsonb
        end
      ) item
      where item->>'role' in ('admin', 'founder_admin', 'super_admin')
    ),
  false
) as admin_analytics_recent_signins_regular_ready
from response
\gset
\if :admin_analytics_recent_signins_regular_ready
  \echo 'Regular recent learner-sign-in live probe passed.'
\else
  \echo 'Regular recent learner-sign-in probe was incomplete or exposed an administrator row.'
  \quit 3
\endif

set local statement_timeout = '8s';
with response as materialized (
  select public.admin_recent_sign_in_directory_scoped_v1(
    :'admin_analytics_probe_actor'::uuid,
    25,
    'admin_recent_signins_release_internal',
    'internal_test'
  ) as payload
)
select coalesce(
  jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'items') = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(payload->'items') = 'array'
          then payload->'items'
          else '[]'::jsonb
        end
      ) item
      where item->>'role' in ('admin', 'founder_admin', 'super_admin')
    ),
  false
) as admin_analytics_recent_signins_internal_ready
from response
\gset
\if :admin_analytics_recent_signins_internal_ready
  \echo 'Internal-test recent learner-sign-in live probe passed.'
\else
  \echo 'Internal-test recent learner-sign-in probe was incomplete or exposed an administrator row.'
  \quit 3
\endif

rollback;
