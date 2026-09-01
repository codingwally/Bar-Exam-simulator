-- Transactional pgTAP coverage for Bar Forecast paid, Founding Beta, and admin access.

begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function(
  'public',
  'dd2026_bar_forecast_access_allowed',
  array['uuid'],
  'the read-only Bar Forecast entitlement helper exists'
);
select function_privs_are(
  'public',
  'dd2026_bar_forecast_access_allowed',
  array['uuid'],
  'authenticated',
  array[]::text[],
  'browser clients cannot execute the entitlement helper'
);
select is(
  (select enabled from public.dd2026_feature_flags where flag_key = 'BAR_FORECAST_ENABLED'),
  true,
  'Bar Forecast is enabled for eligible members'
);
select is(
  (select enabled from public.dd2026_feature_flags where flag_key = 'BAR_FORECAST_ADMIN_ONLY'),
  false,
  'Bar Forecast is no longer administrator-only'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.email,
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from (values
  ('bf260000-0000-4000-8000-000000000001'::uuid, 'forecast-member-admin@example.invalid'),
  ('bf260000-0000-4000-8000-000000000002'::uuid, 'forecast-member-paid@example.invalid'),
  ('bf260000-0000-4000-8000-000000000003'::uuid, 'forecast-member-beta@example.invalid'),
  ('bf260000-0000-4000-8000-000000000004'::uuid, 'forecast-member-comp@example.invalid'),
  ('bf260000-0000-4000-8000-000000000005'::uuid, 'forecast-member-expired@example.invalid'),
  ('bf260000-0000-4000-8000-000000000006'::uuid, 'forecast-member-free@example.invalid')
) fixture(id, email);

update public.user_roles
set role = 'admin'
where user_id = 'bf260000-0000-4000-8000-000000000001';

insert into public.subscriptions (
  user_id, plan_code, status, starts_at, expires_at, source, reason
) values
('bf260000-0000-4000-8000-000000000002', 'early_access_beta', 'active',
  now() - interval '1 day', now() + interval '1 day', 'manual_payment',
  'pgTAP active paid Forecast member.'),
('bf260000-0000-4000-8000-000000000004', 'early_access_beta', 'active',
  now() - interval '1 day', now() + interval '1 day', 'complimentary',
  'pgTAP complimentary non-paid member.'),
('bf260000-0000-4000-8000-000000000005', 'early_access_beta', 'active',
  now() - interval '2 days', now() - interval '1 day', 'manual_payment',
  'pgTAP expired paid member.');

insert into public.free_beta_access (
  user_id, enabled, expires_at, reason, created_by, updated_by, access_program
) values (
  'bf260000-0000-4000-8000-000000000003',
  true,
  now() + interval '1 day',
  'pgTAP active Founding Beta member.',
  'bf260000-0000-4000-8000-000000000001',
  'bf260000-0000-4000-8000-000000000001',
  'founding_beta_2026'
);

select ok(
  public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000001'),
  'an ordinary administrator is eligible'
);
select ok(
  public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000002'),
  'an active manually paid member is eligible'
);
select ok(
  public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000003'),
  'an active Founding Beta member is eligible'
);
select ok(
  not public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000004'),
  'a complimentary subscription is not treated as paid'
);
select ok(
  not public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000005'),
  'an expired paid subscription is ineligible'
);
select ok(
  not public.dd2026_bar_forecast_access_allowed('bf260000-0000-4000-8000-000000000006'),
  'an ordinary free account is ineligible'
);
select ok(
  not public.dd2026_bar_forecast_access_allowed(null),
  'a null actor is ineligible'
);

select is(
  public.dd2026_bar_forecast_consent_status(
    'bf260000-0000-4000-8000-000000000002', '2026-09-01'
  ) ->> 'consentAccepted',
  'false',
  'an eligible paid member can check consent status'
);
select is(
  public.dd2026_bar_forecast_accept_consent(
    'bf260000-0000-4000-8000-000000000002', '2026-09-01'
  ) ->> 'consentAccepted',
  'true',
  'an eligible paid member can record consent'
);
select throws_ok(
  $$select public.dd2026_bar_forecast_consent_status(
    'bf260000-0000-4000-8000-000000000004', '2026-09-01'
  )$$,
  'P0001',
  'DD2026_BAR_FORECAST_ACCESS_REQUIRED',
  'a complimentary subscription is rejected by the consent RPC'
);
select throws_ok(
  $$select public.dd2026_bar_forecast_admin_list(
    'bf260000-0000-4000-8000-000000000006',
    'Political and Public International Law',
    '2026-09-01'
  )$$,
  'P0001',
  'DD2026_BAR_FORECAST_ACCESS_REQUIRED',
  'an ordinary free account is rejected before content retrieval'
);

select ok(
  position(
    'phase4_access_snapshot'
    in pg_get_functiondef('public.dd2026_bar_forecast_access_allowed(uuid)'::regprocedure)
  ) = 0,
  'the stable entitlement helper does not invoke the mutating access snapshot'
);

select * from finish();
rollback;
