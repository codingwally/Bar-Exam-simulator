-- Global Beta All Access structural, authorization, and fallback coverage.
-- Every synthetic identity and mutation is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(60);

select has_table(
  'public', 'global_beta_all_access_history',
  'global Beta All Access history exists'
);
select has_column(
  'public', 'platform_access_settings', 'global_beta_all_access_enabled',
  'global Beta All Access setting exists'
);
select has_function(
  'public', 'phase4_global_beta_identity_eligible', array['uuid'],
  'global beta identity helper exists'
);
select has_function(
  'public', 'phase4_has_current_legal_acceptance', array['uuid'],
  'current legal acceptance helper exists'
);
select has_function(
  'public', 'phase4_global_beta_effective', array['uuid'],
  'effective global access helper exists'
);
select has_function(
  'public', 'phase4_global_beta_public_policy', array[]::text[],
  'minimal public-policy backend RPC exists'
);
select has_function(
  'public', 'phase4_global_beta_policy_snapshot', array['uuid'],
  'administrator policy snapshot exists'
);
select has_function(
  'public', 'phase4_admin_set_global_beta_all_access',
  array['uuid','boolean','text','text'],
  'founder policy mutation exists'
);

select is(
  has_function_privilege(
    'public', 'public.phase4_global_beta_identity_eligible(uuid)', 'execute'
  ), false,
  'PUBLIC cannot call the identity entitlement helper'
);
select is(
  has_function_privilege(
    'authenticated', 'public.phase4_global_beta_identity_eligible(uuid)', 'execute'
  ), false,
  'authenticated clients cannot self-call the identity entitlement helper'
);
select is(
  has_function_privilege(
    'service_role', 'public.phase4_global_beta_identity_eligible(uuid)', 'execute'
  ), true,
  'service role can evaluate global identity eligibility'
);
select is(
  has_function_privilege(
    'public', 'public.phase4_global_beta_public_policy()', 'execute'
  ), false,
  'PUBLIC cannot call the backend policy helper directly'
);
select is(
  has_function_privilege(
    'service_role', 'public.phase4_global_beta_public_policy()', 'execute'
  ), true,
  'service role can read the minimal global policy'
);
select is(
  has_function_privilege(
    'public',
    'public.phase4_admin_set_global_beta_all_access(uuid,boolean,text,text)',
    'execute'
  ), false,
  'PUBLIC cannot mutate global Beta All Access'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.phase4_admin_set_global_beta_all_access(uuid,boolean,text,text)',
    'execute'
  ), false,
  'authenticated clients cannot mutate global Beta All Access'
);
select is(
  has_function_privilege(
    'service_role',
    'public.phase4_admin_set_global_beta_all_access(uuid,boolean,text,text)',
    'execute'
  ), true,
  'service role can invoke the founder-checked policy mutation'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.global_beta_all_access_history'::regclass
  ),
  'global policy history has RLS'
);
select ok(
  (
    select relforcerowsecurity
    from pg_class
    where oid = 'public.global_beta_all_access_history'::regclass
  ),
  'global policy history forces RLS'
);
select is(
  has_table_privilege(
    'authenticated', 'public.global_beta_all_access_history', 'select'
  ), false,
  'authenticated clients cannot read global policy history'
);
select is(
  (
    select global_beta_all_access_enabled
    from public.platform_access_settings
    where singleton = true
  ), true,
  'global Beta All Access is default-on'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at, is_sso_user, is_anonymous
)
values
  ('b2100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','global-founder@example.invalid','{}','{"full_name":"Global Founder"}',
   now(),now(),now(),false,false),
  ('b2100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','global-admin@example.invalid','{}','{"full_name":"Global Admin"}',
   now(),now(),now(),false,false),
  ('b2100000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','global-student@example.invalid','{}','{"full_name":"Global Student"}',
   now(),now(),now(),false,false),
  ('b2100000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','global-no-terms@example.invalid','{}','{"full_name":"Global No Terms"}',
   now(),now(),now(),false,false),
  ('b2100000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',null,'{}','{}',
   now(),now(),now(),false,true);

update public.user_roles
set role = 'founder_admin'
where user_id = 'b2100000-0000-4000-8000-000000000001';
update public.user_roles
set role = 'admin'
where user_id = 'b2100000-0000-4000-8000-000000000002';

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select
  u.id,
  s.current_terms_version,
  s.current_privacy_version,
  'global_beta_test'
from auth.users u
cross join public.platform_access_settings s
where s.singleton = true
  and u.id in (
    'b2100000-0000-4000-8000-000000000001'::uuid,
    'b2100000-0000-4000-8000-000000000002'::uuid,
    'b2100000-0000-4000-8000-000000000003'::uuid
  );

select ok(
  public.phase4_global_beta_identity_eligible(
    'b2100000-0000-4000-8000-000000000003'
  ),
  'existing non-anonymous signed-in student is globally eligible'
);
select ok(
  public.phase4_global_beta_identity_eligible(
    'b2100000-0000-4000-8000-000000000004'
  ),
  'global identity eligibility does not silently replace legal acceptance'
);
select is(
  public.phase4_global_beta_identity_eligible(
    'b2100000-0000-4000-8000-000000000005'
  ), false,
  'anonymous auth identity is excluded'
);
select is(
  public.phase4_global_beta_identity_eligible(
    'b2100000-0000-4000-8000-000000000099'
  ), false,
  'unknown identity is excluded'
);
select ok(
  public.phase4_global_beta_effective(
    'b2100000-0000-4000-8000-000000000003'
  ),
  'current legal acceptance activates global access'
);
select is(
  public.phase4_global_beta_effective(
    'b2100000-0000-4000-8000-000000000004'
  ), false,
  'missing current legal acceptance does not activate product access'
);
select is(
  (
    public.phase4_access_snapshot(
      'b2100000-0000-4000-8000-000000000003',
      true,
      'global_beta_no_trial_0001'
    )->>'allowed'
  )::boolean,
  true,
  'global beta student receives simulator access'
);
select is(
  public.phase4_access_snapshot(
    'b2100000-0000-4000-8000-000000000003', false, null
  )->>'basis',
  'free_beta',
  'global beta uses the safe existing grading reservation basis'
);
select is(
  (
    public.phase4_access_snapshot(
      'b2100000-0000-4000-8000-000000000003', false, null
    )#>>'{globalBeta,active}'
  )::boolean,
  true,
  'access snapshot truthfully marks global Beta All Access active'
);
select is(
  (
    select count(*)
    from public.access_trials
    where user_id = 'b2100000-0000-4000-8000-000000000003'
  ), 0::bigint,
  'global beta access does not create misleading 72-hour trial rows'
);
select is(
  (
    public.phase4_access_snapshot(
      'b2100000-0000-4000-8000-000000000004', false, null
    )->>'allowed'
  )::boolean,
  false,
  'student missing legal acceptance remains locked'
);
select is(
  (
    public.phase4_access_snapshot(
      'b2100000-0000-4000-8000-000000000004', false, null
    )->>'termsRequired'
  )::boolean,
  true,
  'locked student receives the exact legal-acceptance requirement'
);
select is(
  public.examination_authorize_access(
    'b2100000-0000-4000-8000-000000000003',
    'per_subject', null, null, false
  )->>'basis',
  'global_beta_all_access',
  'global beta unlocks per-subject examinations'
);
select is(
  public.examination_authorize_access(
    'b2100000-0000-4000-8000-000000000003',
    'bar_feels', null, null, false
  )->>'basis',
  'global_beta_all_access',
  'global beta unlocks Premium Bar Feels'
);
select ok(
  public.examination_has_beta_access(
    'b2100000-0000-4000-8000-000000000003'
  ),
  'internal examination catalog recognizes global beta'
);
select is(
  (
    public.phase4_user_subscription_status(
      'b2100000-0000-4000-8000-000000000003'
    )#>>'{globalBeta,active}'
  )::boolean,
  true,
  'account status truthfully reports global beta active'
);
select is(
  (
    public.phase4_user_subscription_status(
      'b2100000-0000-4000-8000-000000000003'
    )#>>'{examinationBeta,active}'
  )::boolean,
  true,
  'client Premium navigation receives effective examination access'
);
select is(
  (
    public.private_beta_access_snapshot(
      'b2100000-0000-4000-8000-000000000003', null
    )->>'allowed'
  )::boolean,
  true,
  'global user bypasses the obsolete 12-hour admission token'
);
select is(
  public.private_beta_access_snapshot(
    'b2100000-0000-4000-8000-000000000003', null
  )->>'expiresAt',
  null,
  'global private-beta admission has no expiry'
);
select is(
  (
    select count(*)
    from jsonb_object_keys(public.phase4_global_beta_public_policy())
  ), 1::bigint,
  'public bootstrap policy exposes only the global boolean'
);
select is(
  (
    public.phase4_global_beta_policy_snapshot(
      'b2100000-0000-4000-8000-000000000002'
    )->>'enabled'
  )::boolean,
  true,
  'authorized administrator can see truthful global status'
);
select ok(
  (
    public.phase4_global_beta_policy_snapshot(
      'b2100000-0000-4000-8000-000000000002'
    )->>'signedInAccountCount'
  )::bigint >= 4,
  'administrator snapshot includes all-time signed-in account coverage'
);

select throws_ok(
  $$select public.phase4_admin_set_global_beta_all_access(
    'b2100000-0000-4000-8000-000000000002', false,
    'Admin must not change global access.', 'global_beta_admin_denied_0001'
  )$$,
  'Founder administrator authorization required',
  'ordinary administrator cannot change global Beta All Access'
);

create temporary table global_beta_off_result as
select public.phase4_admin_set_global_beta_all_access(
  'b2100000-0000-4000-8000-000000000001',
  false,
  'Verify reversible legacy fallback in the global beta suite.',
  'global_beta_disable_0001'
) as value;

select is(
  (select (value->>'changed')::boolean from global_beta_off_result), true,
  'founder can disable global Beta All Access'
);
select is(
  (select (value->>'enabled')::boolean from global_beta_off_result), false,
  'founder result reports disabled state truthfully'
);
select is(
  (
    select count(*) from public.global_beta_all_access_history
    where request_key = 'global_beta_disable_0001'
  ), 1::bigint,
  'global policy change creates one immutable history row'
);
select is(
  (
    select count(*) from public.admin_audit_log
    where actor_user_id = 'b2100000-0000-4000-8000-000000000001'
      and action_type = 'security_setting_changed'
      and target_resource_type = 'global_beta_all_access_policy'
      and details->>'requestKey' = 'global_beta_disable_0001'
  ), 1::bigint,
  'global policy change creates one privacy-safe administrator audit row'
);
select is(
  (
    public.phase4_admin_set_global_beta_all_access(
      'b2100000-0000-4000-8000-000000000001',
      false,
      'Verify reversible legacy fallback in the global beta suite.',
      'global_beta_disable_0001'
    )->>'replayed'
  )::boolean,
  true,
  'same founder request replays idempotently'
);
select throws_ok(
  $$select public.phase4_admin_set_global_beta_all_access(
    'b2100000-0000-4000-8000-000000000001', false,
    'A changed reason must not replay an earlier request.',
    'global_beta_disable_0001'
  )$$,
  'Request key conflicts with a different Beta All Access change',
  'request key cannot replay with a different reason'
);
select is(
  (
    select count(*) from public.global_beta_all_access_history
    where request_key = 'global_beta_disable_0001'
  ), 1::bigint,
  'idempotent replay does not duplicate policy history'
);
select throws_ok(
  $$select public.phase4_admin_set_global_beta_all_access(
    'b2100000-0000-4000-8000-000000000001', true,
    'Conflicting use of the same request key must fail.',
    'global_beta_disable_0001'
  )$$,
  'Request key conflicts with a different Beta All Access change',
  'request key cannot be reused for a conflicting state'
);
select is(
  public.phase4_global_beta_identity_eligible(
    'b2100000-0000-4000-8000-000000000003'
  ), false,
  'disabling global policy immediately restores legacy identity rules'
);
select is(
  (
    public.private_beta_access_snapshot(
      'b2100000-0000-4000-8000-000000000003', null
    )->>'allowed'
  )::boolean,
  false,
  'global-off restores the timed private-beta admission requirement'
);
select throws_ok(
  $$select public.examination_authorize_access(
    'b2100000-0000-4000-8000-000000000003',
    'bar_feels', null, null, false
  )$$,
  'EXAM_PREMIUM_REQUIRED',
  'global-off restores Premium Bar Feels enforcement'
);
select is(
  (
    public.phase4_access_snapshot(
      'b2100000-0000-4000-8000-000000000003', false, null
    )#>>'{globalBeta,active}'
  )::boolean,
  false,
  'global-off snapshot no longer claims Beta All Access'
);

select is(
  (
    public.phase4_admin_set_global_beta_all_access(
      'b2100000-0000-4000-8000-000000000001',
      true,
      'Restore default global access after fallback verification.',
      'global_beta_enable_0002'
    )->>'enabled'
  )::boolean,
  true,
  'founder can restore global Beta All Access'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at, is_sso_user, is_anonymous
)
values (
  'b2100000-0000-4000-8000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','global-future@example.invalid','{}',
  '{"full_name":"Global Future User"}',now(),now(),now(),false,false
);
insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select
  'b2100000-0000-4000-8000-000000000006',
  current_terms_version,
  current_privacy_version,
  'global_beta_future_test'
from public.platform_access_settings
where singleton = true;

select ok(
  public.phase4_global_beta_effective(
    'b2100000-0000-4000-8000-000000000006'
  ),
  'future signed-in user automatically receives global access'
);
select is(
  public.examination_authorize_access(
    'b2100000-0000-4000-8000-000000000006',
    'bar_feels', null, null, false
  )->>'basis',
  'global_beta_all_access',
  'future user receives every examination track without a per-user grant'
);
select throws_ok(
  $$select public.phase4_access_snapshot(
    'b2100000-0000-4000-8000-000000000005', false, null
  )$$,
  'Authenticated user required',
  'anonymous auth identities cannot receive simulator access'
);
select is(
  (
    select count(*) from public.access_trials
    where user_id in (
      'b2100000-0000-4000-8000-000000000003',
      'b2100000-0000-4000-8000-000000000006'
    )
  ), 0::bigint,
  'global access remains non-expiring without hidden trial rows'
);

select * from finish();
rollback;
