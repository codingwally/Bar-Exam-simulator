-- Focused structural, authorization, data-integrity, and privacy coverage for
-- the plain-language Admin business dashboard details. Every synthetic user,
-- answer, session, subscription, Quorum post, and audit record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(139);

-- -------------------------------------------------------------------------
-- Service-role-only database surface
-- -------------------------------------------------------------------------

select has_function(
  'public', 'admin_subscription_category', array['uuid'],
  'subscription-category helper exists'
);
select is(has_function_privilege(
  'service_role', 'public.admin_subscription_category(uuid)', 'execute'
), true, 'service role can classify subscriptions');
select is(has_function_privilege(
  'authenticated', 'public.admin_subscription_category(uuid)', 'execute'
), false, 'authenticated clients cannot classify subscriptions directly');
select is(has_function_privilege(
  'anon', 'public.admin_subscription_category(uuid)', 'execute'
), false, 'anonymous clients cannot classify subscriptions');
select is(has_function_privilege(
  'public', 'public.admin_subscription_category(uuid)', 'execute'
), false, 'PUBLIC cannot classify subscriptions');

select has_function(
  'public', 'admin_user_score_summary', array[]::text[],
  'user score summary helper exists'
);
select is(has_function_privilege(
  'service_role', 'public.admin_user_score_summary()', 'execute'
), true, 'service role can summarize scores');
select is(has_function_privilege(
  'authenticated', 'public.admin_user_score_summary()', 'execute'
), false, 'authenticated clients cannot summarize scores directly');
select is(has_function_privilege(
  'anon', 'public.admin_user_score_summary()', 'execute'
), false, 'anonymous clients cannot summarize scores');
select is(has_function_privilege(
  'public', 'public.admin_user_score_summary()', 'execute'
), false, 'PUBLIC cannot summarize scores');

select has_function(
  'public', 'admin_overview_engagement_metrics', array['uuid'],
  'Admin overview engagement helper exists'
);
select is(has_function_privilege(
  'service_role', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
), true, 'service role can read Admin overview engagement');
select is(has_function_privilege(
  'authenticated', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
), false, 'authenticated clients cannot read Admin overview engagement directly');
select is(has_function_privilege(
  'anon', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
), false, 'anonymous clients cannot read Admin overview engagement');
select is(has_function_privilege(
  'public', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
), false, 'PUBLIC cannot read Admin overview engagement');

select has_function(
  'public', 'admin_user_engagement_directory',
  array['uuid','text','integer','integer','text','text'],
  'auth-backed Admin user directory helper exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
  'execute'
), true, 'service role can read the auth-backed user directory');
select is(has_function_privilege(
  'authenticated',
  'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
  'execute'
), false, 'authenticated clients cannot read the user directory directly');
select is(has_function_privilege(
  'anon',
  'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
  'execute'
), false, 'anonymous clients cannot read the user directory');
select is(has_function_privilege(
  'public',
  'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
  'execute'
), false, 'PUBLIC cannot read the user directory');

select has_function(
  'public', 'admin_live_activity', array['uuid','integer','text'],
  'aggregate Admin activity helper exists'
);
select is(has_function_privilege(
  'service_role', 'public.admin_live_activity(uuid,integer,text)', 'execute'
), true, 'service role can read aggregate activity');
select is(has_function_privilege(
  'authenticated', 'public.admin_live_activity(uuid,integer,text)', 'execute'
), false, 'authenticated clients cannot read aggregate activity directly');
select is(has_function_privilege(
  'anon', 'public.admin_live_activity(uuid,integer,text)', 'execute'
), false, 'anonymous clients cannot read aggregate activity');
select is(has_function_privilege(
  'public', 'public.admin_live_activity(uuid,integer,text)', 'execute'
), false, 'PUBLIC cannot read aggregate activity');

select has_function(
  'public', 'admin_quorum_posts',
  array['uuid','text','text','integer','integer','text'],
  'founder Quorum moderation directory exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_quorum_posts(uuid,text,text,integer,integer,text)', 'execute'
), true, 'service role can invoke the founder-checked Quorum directory');
select is(has_function_privilege(
  'authenticated',
  'public.admin_quorum_posts(uuid,text,text,integer,integer,text)', 'execute'
), false, 'authenticated clients cannot read the Quorum directory directly');
select is(has_function_privilege(
  'anon',
  'public.admin_quorum_posts(uuid,text,text,integer,integer,text)', 'execute'
), false, 'anonymous clients cannot read the Quorum directory');
select is(has_function_privilege(
  'public',
  'public.admin_quorum_posts(uuid,text,text,integer,integer,text)', 'execute'
), false, 'PUBLIC cannot read the Quorum directory');

select has_function(
  'public', 'admin_preview_answer_history',
  array['uuid','uuid','timestamptz','timestamptz','text','text','integer','integer','text'],
  'founder answer-history preview exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_preview_answer_history(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
  'execute'
), true, 'service role can invoke the founder-checked answer preview');
select is(has_function_privilege(
  'authenticated',
  'public.admin_preview_answer_history(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
  'execute'
), false, 'authenticated clients cannot read answer previews directly');
select is(has_function_privilege(
  'anon',
  'public.admin_preview_answer_history(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
  'execute'
), false, 'anonymous clients cannot read answer previews');
select is(has_function_privilege(
  'public',
  'public.admin_preview_answer_history(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
  'execute'
), false, 'PUBLIC cannot read answer previews');

select has_function(
  'public', 'admin_export_user_responses_with_identity',
  array['uuid','uuid','timestamptz','timestamptz','integer','text','text'],
  'single-user response export with identity exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), true, 'service role can invoke the founder-checked single-user export');
select is(has_function_privilege(
  'authenticated',
  'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'authenticated clients cannot invoke the single-user export directly');
select is(has_function_privilege(
  'anon',
  'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'anonymous clients cannot invoke the single-user export');
select is(has_function_privilege(
  'public',
  'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'PUBLIC cannot invoke the single-user export');

select has_function(
  'public', 'admin_prepare_user_directory_email_export',
  array['uuid','text','integer','text','text','text'],
  'founder user-list email preparation exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)',
  'execute'
), true, 'service role can invoke founder user-list email preparation');
select is(has_function_privilege(
  'authenticated',
  'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)',
  'execute'
), false, 'authenticated clients cannot prepare user-list email directly');
select is(has_function_privilege(
  'anon',
  'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)',
  'execute'
), false, 'anonymous clients cannot prepare user-list email');
select is(has_function_privilege(
  'public',
  'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)',
  'execute'
), false, 'PUBLIC cannot prepare user-list email');

select has_function(
  'public', 'admin_record_user_directory_email_delivery',
  array['uuid','text','text','text','text','integer','text','text'],
  'founder user-list delivery receipt exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)',
  'execute'
), true, 'service role can invoke founder user-list delivery receipts');
select is(has_function_privilege(
  'authenticated',
  'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)',
  'execute'
), false, 'authenticated clients cannot record user-list delivery directly');
select is(has_function_privilege(
  'anon',
  'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)',
  'execute'
), false, 'anonymous clients cannot record user-list delivery');
select is(has_function_privilege(
  'public',
  'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)',
  'execute'
), false, 'PUBLIC cannot record user-list delivery');

select has_function(
  'public', 'admin_export_answer_history_with_context',
  array['uuid','uuid','timestamptz','timestamptz','integer','text','text'],
  'complete answer-history export with bounded identity context exists'
);
select is(has_function_privilege(
  'service_role',
  'public.admin_export_answer_history_with_context(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), true, 'service role can invoke the contextual answer-history export');
select is(has_function_privilege(
  'authenticated',
  'public.admin_export_answer_history_with_context(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'authenticated clients cannot export contextual answer history directly');
select is(has_function_privilege(
  'anon',
  'public.admin_export_answer_history_with_context(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'anonymous clients cannot export contextual answer history');
select is(has_function_privilege(
  'public',
  'public.admin_export_answer_history_with_context(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
  'execute'
), false, 'PUBLIC cannot export contextual answer history');

select is(
  (
    select count(*)
    from pg_proc p
    where p.oid = any(array[
      'public.admin_subscription_category(uuid)'::regprocedure,
      'public.admin_user_score_summary()'::regprocedure,
      'public.admin_overview_engagement_metrics(uuid)'::regprocedure,
      'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)'::regprocedure,
      'public.admin_live_activity(uuid,integer,text)'::regprocedure,
      'public.admin_quorum_posts(uuid,text,text,integer,integer,text)'::regprocedure,
      'public.admin_preview_answer_history(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)'::regprocedure,
      'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)'::regprocedure,
      'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)'::regprocedure,
      'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)'::regprocedure,
      'public.admin_export_answer_history_with_context(uuid,uuid,timestamptz,timestamptz,integer,text,text)'::regprocedure
    ])
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where split_part(setting, '=', 1) = 'search_path'
          and replace(split_part(setting, '=', 2), '"', '') = ''
      )
  ),
  11::bigint,
  'all eleven privileged dashboard functions use an empty trusted search path'
);

-- -------------------------------------------------------------------------
-- Synthetic identities, roles, legal acceptance, and subscriptions
-- -------------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at, is_sso_user, is_anonymous
)
values
  ('d2300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-founder@example.invalid','{}','{"full_name":"Dashboard Founder"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-admin@example.invalid','{}','{"full_name":"Dashboard Admin"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-student@example.invalid','{}','{"full_name":"Dashboard Student"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-profileless@example.invalid','{}','{"full_name":"Auth Only Name"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-premium@example.invalid','{}','{"full_name":"Premium User"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-regular@example.invalid','{}','{"full_name":"Regular User"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-expired@example.invalid','{}','{"full_name":"Expired User"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-no-terms@example.invalid','{}','{"full_name":"No Terms User"}',
   now(),now(),now(),false,false),
  ('d2300000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dashboard-ended@example.invalid','{}','{"full_name":"Ended Session User"}',
   now(),now(),now(),false,false);

update public.user_roles set role = 'founder_admin'
where user_id = 'd2300000-0000-4000-8000-000000000001';
update public.user_roles set role = 'admin'
where user_id = 'd2300000-0000-4000-8000-000000000002';
update public.user_roles set role = 'beta_tester'
where user_id = 'd2300000-0000-4000-8000-000000000003';

delete from public.profiles
where id = 'd2300000-0000-4000-8000-000000000004';

update public.platform_access_settings
set global_beta_all_access_enabled = true,
    updated_at = now()
where singleton = true;

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select
  u.id, s.current_terms_version, s.current_privacy_version,
  'admin_dashboard_details_test'
from auth.users u
cross join public.platform_access_settings s
where s.singleton = true
  and u.id::text like 'd2300000-%'
  and u.id <> 'd2300000-0000-4000-8000-000000000008';

insert into public.subscriptions (
  id, user_id, plan_code, status, starts_at, expires_at, source,
  created_by, updated_by, reason
)
values
  ('d2310000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000001',
   'premium','active',now()-interval '1 day',now()+interval '30 days','complimentary',
   'd2300000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000001',
   'Synthetic founder precedence fixture'),
  ('d2310000-0000-4000-8000-000000000002','d2300000-0000-4000-8000-000000000005',
   'premium','active',now()-interval '1 day',now()+interval '30 days','complimentary',
   'd2300000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000001',
   'Synthetic Premium category fixture'),
  ('d2310000-0000-4000-8000-000000000003','d2300000-0000-4000-8000-000000000006',
   'standard','active',now()-interval '1 day',now()+interval '30 days','complimentary',
   'd2300000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000001',
   'Synthetic Regular category fixture'),
  ('d2310000-0000-4000-8000-000000000004','d2300000-0000-4000-8000-000000000007',
   'premium','expired',now()-interval '30 days',now()-interval '1 day','complimentary',
   'd2300000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000001',
   'Synthetic expired Premium fixture');

select is(
  public.admin_subscription_category('d2300000-0000-4000-8000-000000000001'),
  'Admin & Staff',
  'Admin and Staff classification takes precedence over an active Premium plan'
);
select is(
  public.admin_subscription_category('d2300000-0000-4000-8000-000000000005'),
  'Premium',
  'current active Premium plan takes precedence over global beta'
);
select is(
  public.admin_subscription_category('d2300000-0000-4000-8000-000000000006'),
  'Regular',
  'current active non-Premium plan is classified as Regular'
);
select is(
  public.admin_subscription_category('d2300000-0000-4000-8000-000000000007'),
  'Beta Tester',
  'expired Premium is not current and falls back to global Beta All Access'
);
select is(
  public.admin_subscription_category('d2300000-0000-4000-8000-000000000004'),
  'Beta Tester',
  'profile-less registered user receives the global Beta Tester classification'
);

select throws_ok(
  $$
    select public.admin_user_engagement_directory(
      'd2300000-0000-4000-8000-000000000003', null, 100, 0,
      'dashboard_student_denied_0001', 'dashboard'
    )
  $$,
  'P0001', 'Administrator authorization required',
  'students cannot read the exact-identity Admin directory'
);

insert into public.admin_capabilities (user_id, capability, granted_by, reason)
values (
  'd2300000-0000-4000-8000-000000000002',
  'learner_analytics_viewer',
  'd2300000-0000-4000-8000-000000000001',
  'Synthetic dashboard exact-identity authorization'
);

create temporary table dashboard_profileless_directory as
select public.admin_user_engagement_directory(
  'd2300000-0000-4000-8000-000000000002',
  'dashboard-profileless@example.invalid', 100, 0,
  'dashboard_profileless_allowed_0002', 'dashboard'
) as value;

select is(
  (select (value->>'total')::integer from dashboard_profileless_directory),
  1,
  'auth-backed directory finds the profile-less registered account'
);
select is(
  (select value->'items'->0->>'email' from dashboard_profileless_directory),
  'dashboard-profileless@example.invalid',
  'directory returns the exact Auth email for a profile-less account'
);
select is(
  (select value->'items'->0->>'display_name' from dashboard_profileless_directory),
  null,
  'directory does not invent a profile display name'
);
select is(
  (select (value->'items'->0->>'has_signed_in')::boolean
   from dashboard_profileless_directory),
  true,
  'directory reports the persisted Auth sign-in state'
);
select is(
  (select value->'items'->0->>'subscription_category'
   from dashboard_profileless_directory),
  'Beta Tester',
  'directory exposes the business-facing subscription category'
);
select is(
  (select (value->'items'->0->>'current_legal_accepted')::boolean
   from dashboard_profileless_directory),
  true,
  'directory verifies current legal acceptance'
);
select is(
  (select value->'items'->0->>'effective_access'
   from dashboard_profileless_directory),
  'Beta All Access',
  'directory reports real global Beta All Access for an eligible user'
);
select ok(
  (select not ((value->'items'->0) ?| array[
    'last_active_at','session_count','current_page_area','last_page_area',
    'device_category','active_5_minutes','active_30_minutes'
  ]) from dashboard_profileless_directory),
  'directory withholds unreliable person-level activity telemetry'
);

create temporary table dashboard_no_terms_directory as
select public.admin_user_engagement_directory(
  'd2300000-0000-4000-8000-000000000002',
  'dashboard-no-terms@example.invalid', 100, 0,
  'dashboard_no_terms_allowed_0003', 'dashboard'
) as value;
select is(
  (select value->'items'->0->>'effective_access' from dashboard_no_terms_directory),
  'Legal acceptance required',
  'global beta does not conceal a missing current legal acceptance'
);
select lives_ok(
  $$
    select public.admin_user_engagement_directory(
      'd2300000-0000-4000-8000-000000000002',
      'dashboard-profileless@example.invalid', 100, 0,
      'dashboard_profileless_allowed_0002', 'dashboard'
    )
  $$,
  'retrying the same directory request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000002'
     and target_resource_type = 'admin_user_engagement_directory_request'
     and details->>'requestKey' = 'dashboard_profileless_allowed_0002'),
  1::bigint,
  'directory retry keeps a single immutable preflight audit record'
);
select throws_ok(
  $$
    select public.admin_user_engagement_directory(
      'd2300000-0000-4000-8000-000000000002',
      'dashboard-regular@example.invalid', 100, 0,
      'dashboard_profileless_allowed_0002', 'dashboard'
    )
  $$,
  'P0001','Directory request key conflict',
  'directory request key cannot be reused for a different exact-email search'
);

-- -------------------------------------------------------------------------
-- Aggregate activity: no named identity claims, ended sessions excluded
-- -------------------------------------------------------------------------

create temporary table dashboard_live_baseline as
select public.admin_live_activity(
  'd2300000-0000-4000-8000-000000000002', 100,
  'dashboard_live_baseline_0004'
) as value;

insert into public.usage_sessions (
  id, user_id, anonymous_session_id, visitor_id, auth_state,
  started_at, last_seen_at, ended_at, source, metadata,
  device_category, landing_area, last_page_area, heartbeat_interval_seconds
)
values
  ('d2320000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000003',
   'd2330000-0000-4000-8000-000000000001','d2330000-0000-4000-8000-000000000001',
   'signed_in',now()-interval '2 minutes',now(),null,'web','{}',
   'mobile','mock_bar','mock_bar',90),
  ('d2320000-0000-4000-8000-000000000002','d2300000-0000-4000-8000-000000000009',
   'd2330000-0000-4000-8000-000000000002','d2330000-0000-4000-8000-000000000002',
   'signed_in',now()-interval '2 minutes',now(),now()-interval '1 minute','web','{}',
   'desktop','quorum','quorum',90);

create temporary table dashboard_live_after as
select public.admin_live_activity(
  'd2300000-0000-4000-8000-000000000002', 100,
  'dashboard_live_after_0005'
) as value;

select is(
  (select (a.value->>'activeSignedInLast5Minutes')::integer
     - (b.value->>'activeSignedInLast5Minutes')::integer
   from dashboard_live_after a cross join dashboard_live_baseline b),
  1,
  'only the active synthetic session increases the five-minute count'
);
select is(
  (select (a.value->>'activeSignedInLast30Minutes')::integer
     - (b.value->>'activeSignedInLast30Minutes')::integer
   from dashboard_live_after a cross join dashboard_live_baseline b),
  1,
  'ended synthetic session is excluded from the thirty-minute count'
);
select is(
  (select jsonb_array_length(value->'items') from dashboard_live_after),
  0,
  'aggregate activity never releases named identity rows'
);
select is(
  (select (details->>'identityRowsWithheld')::boolean
   from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000002'
     and target_resource_type = 'admin_live_activity'
     and details->>'requestKey' = 'dashboard_live_after_0005'),
  true,
  'activity audit explicitly records that identity rows were withheld'
);
select lives_ok(
  $$select public.admin_live_activity(
    'd2300000-0000-4000-8000-000000000002', 100,
    'dashboard_live_after_0005'
  )$$,
  'retrying the same activity request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000002'
     and target_resource_type = 'admin_live_activity'
     and details->>'requestKey' = 'dashboard_live_after_0005'),
  1::bigint,
  'activity retry keeps a single audit record'
);
select throws_ok(
  $$select public.admin_live_activity(
    'd2300000-0000-4000-8000-000000000002', 50,
    'dashboard_live_after_0005'
  )$$,
  'P0001',
  'Activity request key was already used for a different request',
  'activity request key cannot be reused for a different limit'
);

-- -------------------------------------------------------------------------
-- Persisted grading precedence and bounded answer-history preview
-- -------------------------------------------------------------------------

insert into public.exam_attempts (
  id, user_id, request_key, question_bank_id, subject, answer_text, status,
  score, assessment, provider_model, timer_mode, elapsed_seconds,
  submission_reason, submitted_at, completed_at, updated_at
)
values
  ('d2340000-0000-4000-8000-000000000001','d2300000-0000-4000-8000-000000000003',
   'dashboard_practice_answer_0006','DASH-PRACTICE-001','Civil Law',
   'First exact persisted practice answer.','completed',3.0,
   jsonb_build_object(
     'rationale','First persisted practice feedback.',
     'modelAnswerALAC',jsonb_build_object('answer','First generated model answer.')
   ),'synthetic-practice-model','selfPaced',120,'manual',
   '2199-01-02 00:00:00+00','2199-01-02 00:01:00+00',now()),
  ('d2340000-0000-4000-8000-000000000002','d2300000-0000-4000-8000-000000000003',
   'dashboard_practice_answer_0007','DASH-PRACTICE-002','Labor Law',
   'Second exact persisted practice answer.','completed',3.5,'{}',null,
   'none',90,'manual','2199-01-03 00:00:00+00','2199-01-03 00:01:00+00',now());

create temporary table dashboard_formal_question_fixture as
select
  v.id as version_id,
  vq.question_id,
  vq.prompt_snapshot,
  vq.model_answer_snapshot
from public.examination_versions v
join public.examination_version_questions vq on vq.version_id = v.id
where nullif(btrim(vq.prompt_snapshot), '') is not null
  and nullif(btrim(vq.model_answer_snapshot), '') is not null
order by v.created_at, vq.ordinal
limit 1;

select is(
  (select count(*) from dashboard_formal_question_fixture),
  1::bigint,
  'an immutable formal question and model-answer fixture is available'
);

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, submitted_at,
  last_activity_at, last_heartbeat_at, active_tab_hash, tab_lease_until,
  elapsed_seconds, start_request_key, grading_entitlement_reserved,
  submission_reason, created_at, updated_at
)
select
  'd2350000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  version_id,'none','submitted','2199-01-04 00:00:00+00',
  '2199-01-04 00:06:00+00','2199-01-04 00:06:00+00',
  '2199-01-04 00:06:00+00',repeat('a',64),
  '2199-01-04 00:07:00+00',1080,'dashboard_formal_answer_0008',false,
  'manual',now(),now()
from dashboard_formal_question_fixture;

insert into public.examination_responses (
  attempt_id, question_id, answer_text, flagged, revision,
  activity_seconds, saved_at
)
select
  'd2350000-0000-4000-8000-000000000001',question_id,
  'Exact persisted formal answer.',true,1,900,'2199-01-04 00:06:00+00'
from dashboard_formal_question_fixture;

insert into public.examination_ai_assessments (
  id, attempt_id, question_id, score, assessment_json, grader_model,
  model_answer_hash, finalized_at
)
select
  'd2360000-0000-4000-8000-000000000001',
  'd2350000-0000-4000-8000-000000000001',question_id,4.0,
  jsonb_build_object('rationale','Persisted formal AI feedback.'),
  'synthetic-formal-model',repeat('b',64),'2199-01-04 00:07:00+00'
from dashboard_formal_question_fixture;

insert into public.examination_examiner_assignments (
  id, attempt_id, examiner_email, token_hash, status, expires_at,
  claimed_at, created_by, created_at, updated_at
)
values (
  'd2370000-0000-4000-8000-000000000001',
  'd2350000-0000-4000-8000-000000000001',
  'dashboard-examiner@example.invalid',repeat('c',64),'claimed',
  '2200-01-01 00:00:00+00','2199-01-04 00:08:00+00',
  'd2300000-0000-4000-8000-000000000001',now(),now()
);

insert into public.examination_examiner_reviews (
  assignment_id, question_id, score, comments, revision, saved_at, finalized_at
)
select
  'd2370000-0000-4000-8000-000000000001',question_id,4.8,
  'Persisted draft human review.',1,'2199-01-04 00:09:00+00',null
from dashboard_formal_question_fixture;

select is(
  (select latest_score from public.admin_user_score_summary()
   where user_id = 'd2300000-0000-4000-8000-000000000003'),
  4.0::numeric,
  'unfinalized human review cannot override the latest finalized AI score'
);

update public.examination_examiner_reviews
set finalized_at = '2199-01-05 00:00:00+00'
where assignment_id = 'd2370000-0000-4000-8000-000000000001';
update public.examination_examiner_assignments
set status = 'finalized', finalized_at = '2199-01-05 00:00:00+00'
where id = 'd2370000-0000-4000-8000-000000000001';

select is(
  (select latest_score from public.admin_user_score_summary()
   where user_id = 'd2300000-0000-4000-8000-000000000003'),
  4.8::numeric,
  'finalized human review becomes the latest authoritative score'
);

select throws_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000002',null,null,null,null,'all',100,0,
    'dashboard_preview_admin_denied_0009'
  )$$,
  'P0001','Founder administrator authorization required',
  'ordinary administrators cannot preview private answer history'
);

create temporary table dashboard_preview_page_one as
select public.admin_preview_answer_history(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
  null,'all',1,0,'dashboard_preview_page_one_0010'
) as value;

select is(
  (select (value->>'total')::integer from dashboard_preview_page_one),
  3,
  'answer preview counts both persisted practice answers and the formal answer'
);
select is(
  (select jsonb_array_length(value->'items') from dashboard_preview_page_one),
  1,
  'answer preview respects the requested page size'
);
select is(
  (select (value->>'hasMore')::boolean from dashboard_preview_page_one),
  true,
  'answer preview reports another page'
);

create temporary table dashboard_preview_page_two as
select public.admin_preview_answer_history(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
  null,'all',1,1,'dashboard_preview_page_two_0011'
) as value;

select isnt(
  (select value->'items'->0->>'attemptId' from dashboard_preview_page_one),
  (select value->'items'->0->>'attemptId' from dashboard_preview_page_two),
  'adjacent answer-preview pages do not repeat the same record'
);

create temporary table dashboard_preview_formal as
select public.admin_preview_answer_history(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
  null,'formal_exam',100,0,'dashboard_preview_formal_0012'
) as value;

select is(
  (select value->'items'->0->>'questionText' from dashboard_preview_formal),
  (select prompt_snapshot from dashboard_formal_question_fixture),
  'formal preview uses the immutable question snapshot from the attempt version'
);
select is(
  (select value->'items'->0->>'modelAnswer' from dashboard_preview_formal),
  (select model_answer_snapshot from dashboard_formal_question_fixture),
  'formal preview uses the immutable model-answer snapshot from the attempt version'
);
select is(
  (select (value->'items'->0->>'score')::numeric from dashboard_preview_formal),
  4.8::numeric,
  'formal preview exposes the finalized human score'
);
select is(
  (select value->'items'->0->>'gradeSource' from dashboard_preview_formal),
  'human_and_ai',
  'formal preview distinguishes finalized human and persisted AI grading'
);
select is(
  (select value->'items'->0->>'userEmail' from dashboard_preview_formal),
  'dashboard-student@example.invalid',
  'formal preview includes the exact Auth email'
);
select is(
  (select value->'items'->0->>'subscriptionCategory' from dashboard_preview_formal),
  'Beta Tester',
  'formal preview includes the business-facing subscription category'
);

create temporary table dashboard_preview_practice as
select public.admin_preview_answer_history(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
  null,'practice',100,0,'dashboard_preview_practice_0013'
) as value;

select is(
  (select count(*) from dashboard_preview_practice,
   jsonb_array_elements(value->'items') item
   where item->'questionText' = 'null'::jsonb
     and item->>'questionTextStatus' = 'unavailable_exact_historic_text'),
  2::bigint,
  'practice preview never substitutes current-bank text for unavailable historic questions'
);
select is(
  (select count(*) from dashboard_preview_practice,
   jsonb_array_elements(value->'items') item
   where item->'suggestedAnswer' = 'null'::jsonb
     and item->>'suggestedAnswerStatus' = 'not_persisted_with_practice_attempt'),
  2::bigint,
  'practice preview clearly marks unavailable historic suggested answers'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'answer_history_preview'
     and details->>'requestKey' = 'dashboard_preview_page_one_0010'),
  1::bigint,
  'successful answer preview creates one audit record'
);
select lives_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000003',
    '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
    null,'all',1,0,'dashboard_preview_page_one_0010'
  )$$,
  'retrying the same answer-preview request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'answer_history_preview'
     and details->>'requestKey' = 'dashboard_preview_page_one_0010'),
  1::bigint,
  'answer-preview retry keeps a single audit record'
);
select throws_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000003',
    '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',
    null,'all',1,2,'dashboard_preview_page_one_0010'
  )$$,
  'P0001','Answer-history preview request key conflict',
  'answer-preview request key cannot be reused for a different page'
);
select throws_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000001',null,
    now()-interval '1 day',null,null,'all',100,0,
    'dashboard_preview_mixed_dates_0014'
  )$$,
  'P0001','Both preview dates must be supplied or both omitted',
  'answer preview rejects a mixed-null date range'
);
select throws_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000001',null,
    null,null,null,'unsupported',100,0,
    'dashboard_preview_bad_source_0015'
  )$$,
  'P0001','Valid answer-history record source required',
  'answer preview rejects an unsupported record source'
);
select throws_ok(
  $$select public.admin_preview_answer_history(
    'd2300000-0000-4000-8000-000000000001',null,
    null,null,null,'all',101,0,
    'dashboard_preview_bad_limit_0016'
  )$$,
  'P0001','Answer-history preview limit must be between 1 and 100',
  'answer preview enforces its maximum page size'
);

-- The retained single-user route now writes a complete immutable preflight
-- audit before calling the older response-export implementation.
create temporary table dashboard_legacy_export as
select public.admin_export_user_responses_with_identity(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',2000,
  'Authorized synthetic single-user response download.',
  'dashboard_legacy_export_0021'
) as value;

select is(
  (select value->'user'->>'email' from dashboard_legacy_export),
  'dashboard-student@example.invalid',
  'single-user response export attaches the exact target Auth email'
);
select is(
  (select value->'user'->>'subscriptionCategory' from dashboard_legacy_export),
  'Beta Tester',
  'single-user response export attaches the target subscription category'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'user_question_answer_export_request'
     and details->>'requestKey' = 'dashboard_legacy_export_0021'
     and char_length(details->>'requestFingerprint') = 64),
  1::bigint,
  'single-user response export writes one immutable preflight audit'
);
select lives_ok(
  $$select public.admin_export_user_responses_with_identity(
    'd2300000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000003',
    '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',2000,
    'Authorized synthetic single-user response download.',
    'dashboard_legacy_export_0021'
  )$$,
  'retrying the identical single-user export is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'user_question_answer_export_request'
     and details->>'requestKey' = 'dashboard_legacy_export_0021'),
  1::bigint,
  'single-user export retry keeps one preflight audit'
);
select throws_ok(
  $$select public.admin_export_user_responses_with_identity(
    'd2300000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000003',
    '2199-01-02 00:00:00+00','2199-01-06 00:00:00+00',2000,
    'Authorized synthetic single-user response download.',
    'dashboard_legacy_export_0021'
  )$$,
  'P0001','Question-and-answer export request key conflict',
  'single-user export key cannot be reused for a different date range'
);

-- Email export preparation is durable before delivery and receipts are bound
-- to the exact prepared request.
select throws_ok(
  $$select public.admin_record_user_directory_email_delivery(
    'd2300000-0000-4000-8000-000000000001','wally','sent',
    'provider-before-prepare',null,1,
    'Authorized synthetic founder user-list email.',
    'dashboard_email_unprepared_0022'
  )$$,
  'P0001','Matching prepared directory email request required',
  'a delivery receipt cannot exist without a matching prepared request'
);

create temporary table dashboard_email_prepare as
select public.admin_prepare_user_directory_email_export(
  'd2300000-0000-4000-8000-000000000001',
  'dashboard-student@example.invalid',100,'wally',
  'Authorized synthetic founder user-list email.',
  'dashboard_email_prepared_0023'
) as value;

select is(
  (select (value->>'alreadyPrepared')::boolean from dashboard_email_prepare),
  false,
  'first email-export request is newly prepared'
);
select is(
  (select (value->>'total')::integer from dashboard_email_prepare),
  1,
  'prepared email export contains only the exact filtered user'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'admin_user_directory_email_request'
     and details->>'requestKey' = 'dashboard_email_prepared_0023'
     and details->>'deliveryState' = 'prepared'
     and char_length(details->>'requestFingerprint') = 64),
  1::bigint,
  'email request is durably prepared with an immutable fingerprint before send'
);

create temporary table dashboard_email_prepare_retry as
select public.admin_prepare_user_directory_email_export(
  'd2300000-0000-4000-8000-000000000001',
  'dashboard-student@example.invalid',100,'wally',
  'Authorized synthetic founder user-list email.',
  'dashboard_email_prepared_0023'
) as value;

select is(
  (select (value->>'alreadyPrepared')::boolean
   from dashboard_email_prepare_retry),
  true,
  'identical email-export replay is marked already prepared'
);
select is(
  (select jsonb_array_length(value->'items')
   from dashboard_email_prepare_retry),
  0,
  'identical prepared replay returns no attachment rows to prevent a duplicate send'
);
select throws_ok(
  $$select public.admin_prepare_user_directory_email_export(
    'd2300000-0000-4000-8000-000000000001',
    'dashboard-student@example.invalid',100,'gilmar',
    'Authorized synthetic founder user-list email.',
    'dashboard_email_prepared_0023'
  )$$,
  'P0001','Directory email request key conflict',
  'prepared email request key cannot be reused for another recipient'
);

create temporary table dashboard_email_receipt as
select public.admin_record_user_directory_email_delivery(
  'd2300000-0000-4000-8000-000000000001','wally','sent',
  'provider-message-0023',null,1,
  'Authorized synthetic founder user-list email.',
  'dashboard_email_prepared_0023'
) as value;

select is(
  (select (value->>'alreadyRecorded')::boolean from dashboard_email_receipt),
  false,
  'first matching email delivery receipt is newly recorded'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'admin_user_directory_email_delivery'
     and details->>'requestKey' = 'dashboard_email_prepared_0023'
     and char_length(details->>'preparedRequestFingerprint') = 64
     and char_length(details->>'deliveryFingerprint') = 64),
  1::bigint,
  'email delivery receipt is bound to its prepared request fingerprint'
);

create temporary table dashboard_email_receipt_retry as
select public.admin_record_user_directory_email_delivery(
  'd2300000-0000-4000-8000-000000000001','wally','sent',
  'provider-message-0023',null,1,
  'Authorized synthetic founder user-list email.',
  'dashboard_email_prepared_0023'
) as value;
select is(
  (select (value->>'alreadyRecorded')::boolean
   from dashboard_email_receipt_retry),
  true,
  'identical delivery receipt replay is idempotent'
);
select throws_ok(
  $$select public.admin_record_user_directory_email_delivery(
    'd2300000-0000-4000-8000-000000000001','wally','failed',
    null,'provider_failed',1,
    'Authorized synthetic founder user-list email.',
    'dashboard_email_prepared_0023'
  )$$,
  'P0001','Directory email delivery receipt conflict',
  'delivery receipt cannot be rewritten with a conflicting outcome'
);

-- Complete answer-history enrichment joins only identities represented by the
-- returned rows; it does not load or append the unrelated user directory.
create temporary table dashboard_contextual_history as
select public.admin_export_answer_history_with_context(
  'd2300000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000003',
  '2199-01-01 00:00:00+00','2199-01-06 00:00:00+00',5000,
  'Authorized synthetic contextual answer-history download.',
  'dashboard_contextual_history_0024'
) as value;

select is(
  (select (value->>'total')::integer from dashboard_contextual_history),
  3,
  'contextual answer-history export returns all three target-user answers'
);
select is(
  (select count(*) from dashboard_contextual_history,
   jsonb_array_elements(value->'items') item
   where item->>'userId' = 'd2300000-0000-4000-8000-000000000003'),
  3::bigint,
  'contextual answer-history rows remain scoped to the requested user'
);
select is(
  (select count(*) from dashboard_contextual_history,
   jsonb_array_elements(value->'items') item
   where item->>'userEmail' = 'dashboard-student@example.invalid'),
  3::bigint,
  'contextual answer-history enriches only returned rows with exact Auth email'
);
select is(
  (select count(*) from dashboard_contextual_history,
   jsonb_array_elements(value->'items') item
   where item->>'userEmail' in (
     'dashboard-founder@example.invalid','dashboard-admin@example.invalid'
   )),
  0::bigint,
  'contextual answer-history never appends unrelated administrator identities'
);
select is(
  (select count(*) from dashboard_contextual_history,
   jsonb_array_elements(value->'items') item
   where item->>'subscriptionCategory' = 'Beta Tester'),
  3::bigint,
  'contextual answer-history adds the target business subscription category'
);
select is(
  (select count(*) from dashboard_contextual_history,
   jsonb_array_elements(value->'items') item
   where item ?| array[
     'last_active_at','session_count','current_page_area','device_category'
   ]),
  0::bigint,
  'contextual answer-history does not add unreliable activity telemetry'
);

-- -------------------------------------------------------------------------
-- Founder-only Quorum directory, exact author identity, and idempotency
-- -------------------------------------------------------------------------

insert into public.forum_posts (
  id, author_user_id, body, entry_type, subject, category,
  moderation_status, created_at, updated_at
)
values
  ('d2380000-0000-4000-8000-000000000001',
   'd2300000-0000-4000-8000-000000000003',
   'D230 Quorum unreported visible discussion for the dashboard contract.',
   'ask_community','Civil Law','law_school_life','visible',
   now()-interval '1 minute',now()-interval '1 minute'),
  ('d2380000-0000-4000-8000-000000000002',
   'd2300000-0000-4000-8000-000000000003',
   'D230 Quorum hidden discussion for the dashboard contract.',
   'student_support',null,'student_support','hidden',
   now()-interval '2 minutes',now()-interval '2 minutes');

select throws_ok(
  $$select public.admin_quorum_posts(
    'd2300000-0000-4000-8000-000000000002',
    'D230 Quorum','all',100,0,'dashboard_quorum_admin_denied_0017'
  )$$,
  'P0001','Founder administrator authorization required',
  'ordinary administrators cannot open the founder Quorum directory'
);

create temporary table dashboard_quorum_exact as
select public.admin_quorum_posts(
  'd2300000-0000-4000-8000-000000000001',
  'unreported visible discussion','all',100,0,
  'dashboard_quorum_exact_0018'
) as value;

select is(
  (select (value->>'total')::integer from dashboard_quorum_exact),
  1,
  'founder Quorum directory includes an unreported post'
);
select is(
  (select value->'items'->0->>'author_email' from dashboard_quorum_exact),
  'dashboard-student@example.invalid',
  'Quorum directory returns the exact Auth email for the author'
);
select is(
  (select value->'items'->0->>'author_name' from dashboard_quorum_exact),
  'Dashboard Student',
  'Quorum directory returns the persisted author display name'
);
select is(
  (select (value->'items'->0->>'report_count')::integer
   from dashboard_quorum_exact),
  0,
  'unreported Quorum post is visible with an exact zero report count'
);

create temporary table dashboard_quorum_page as
select public.admin_quorum_posts(
  'd2300000-0000-4000-8000-000000000001',
  'D230 Quorum','all',1,0,'dashboard_quorum_page_0019'
) as value;
select is(
  (select (value->>'total')::integer from dashboard_quorum_page),
  2,
  'Quorum all-status search counts both visible and hidden posts'
);
select is(
  (select (value->>'hasMore')::boolean from dashboard_quorum_page),
  true,
  'Quorum directory reports another page when the result exceeds its limit'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'admin_quorum_posts'
     and details->>'requestKey' = 'dashboard_quorum_page_0019'),
  1::bigint,
  'successful Quorum directory request creates one audit record'
);
select lives_ok(
  $$select public.admin_quorum_posts(
    'd2300000-0000-4000-8000-000000000001',
    'D230 Quorum','all',1,0,'dashboard_quorum_page_0019'
  )$$,
  'retrying the same Quorum directory request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'd2300000-0000-4000-8000-000000000001'
     and target_resource_type = 'admin_quorum_posts'
     and details->>'requestKey' = 'dashboard_quorum_page_0019'),
  1::bigint,
  'Quorum retry keeps a single audit record'
);
select throws_ok(
  $$select public.admin_quorum_posts(
    'd2300000-0000-4000-8000-000000000001',
    'D230 Quorum','hidden',1,0,'dashboard_quorum_page_0019'
  )$$,
  'P0001','Quorum request key was already used for a different request',
  'Quorum request key cannot be reused for a different status'
);
select throws_ok(
  $$select public.admin_quorum_posts(
    'd2300000-0000-4000-8000-000000000001',
    null,'unsupported',100,0,'dashboard_quorum_bad_status_0020'
  )$$,
  'P0001','Valid Quorum status required',
  'Quorum directory rejects an unsupported status filter'
);

select * from finish();
rollback;
