-- Phase 4 Release 1 staging-only pgTAP suite.
-- Synthetic identities and records are rolled back.
begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(44);

-- This historical suite verifies the legacy trial/lifetime fallback. The
-- current product default is global Beta All Access; disable it transactionally
-- here so the original fallback assertions remain meaningful.
update public.platform_access_settings
set global_beta_all_access_enabled = false
where singleton = true;

-- Later Premium migrations intentionally activated checkout. Restore the
-- Release 1 catalog fixture inside this rolled-back historical suite so its
-- original assertions remain deterministic on the current schema.
update public.plan_catalog
set status = 'disabled',
    checkout_enabled = false
where plan_code = 'premium';

select has_table('public', 'platform_access_settings', 'access settings table exists');
select has_table('public', 'access_trials', 'trial table exists');
select has_table('public', 'lifetime_grade_usage', 'lifetime usage table exists');
select has_table('public', 'grade_reservations', 'grade reservations table exists');
select has_table('public', 'free_beta_access', 'Free Beta table exists');
select has_table('public', 'free_beta_access_history', 'Free Beta history exists');
select has_table('public', 'subscriptions', 'subscriptions table exists');
select has_table('public', 'subscription_history', 'subscription history exists');
select has_table('public', 'ai_improvement_consents', 'AI consent history exists');

select has_function(
  'public', 'phase4_access_snapshot', array['uuid','boolean','text'],
  'access snapshot function exists'
);
select has_function(
  'public', 'phase4_reserve_grade', array['uuid','text','text'],
  'grade reservation function exists'
);
select has_function(
  'public', 'phase4_finalize_grade', array['uuid','uuid'],
  'grade finalization function exists'
);
select has_function(
  'public', 'phase4_release_grade', array['uuid','uuid','text'],
  'grade release function exists'
);

select is(
  (select trial_duration_hours from public.platform_access_settings where singleton),
  72,
  'trial is exactly 72 hours'
);
select is(
  (select lifetime_free_grades from public.platform_access_settings where singleton),
  3,
  'every authenticated student receives three lifetime grades'
);
select is(
  (select status from public.plan_catalog where plan_code = 'early_access_beta'),
  'active',
  'Early Access Beta is active'
);
select is(
  (select price_php from public.plan_catalog where plan_code = 'early_access_beta'),
  149.00::numeric,
  'Early Access Beta price is PHP 149'
);
select is(
  (select status from public.plan_catalog where plan_code = 'standard'),
  'active',
  'Standard is active'
);
select is(
  (select price_php from public.plan_catalog where plan_code = 'standard'),
  249.00::numeric,
  'Standard price is PHP 249'
);
select is(
  (select status from public.plan_catalog where plan_code = 'premium'),
  'disabled',
  'Premium is disabled'
);
select is(
  (select checkout_enabled from public.plan_catalog where plan_code = 'premium'),
  false,
  'Premium cannot accept payment'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.access_trials'::regclass),
  'trials have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.grade_reservations'::regclass),
  'grade reservations have RLS'
);
select is(
  has_table_privilege('anon', 'public.access_trials', 'select'),
  false,
  'anon cannot read trial records'
);
select is(
  has_table_privilege('authenticated', 'public.access_trials', 'update'),
  false,
  'authenticated users cannot alter trial records'
);
select is(
  has_table_privilege('authenticated', 'public.lifetime_grade_usage', 'insert'),
  false,
  'authenticated users cannot create free-grade usage'
);
select is(
  has_table_privilege('authenticated', 'public.free_beta_access', 'select'),
  false,
  'authenticated users cannot read Free Beta administration records'
);
select is(
  has_function_privilege(
    'authenticated', 'public.phase4_reserve_grade(uuid,text,text)', 'execute'
  ),
  false,
  'browser roles cannot reserve grades directly'
);
select is(
  has_function_privilege(
    'service_role', 'public.phase4_reserve_grade(uuid,text,text)', 'execute'
  ),
  true,
  'Worker service role can reserve grades'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('96000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase4-student@example.invalid','{}','{"full_name":"Phase 4 Student"}',
   now(),now(),false,false),
  ('96000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase4-founder@example.invalid','{}','{"full_name":"Phase 4 Founder"}',
   now(),now(),false,false),
  ('96000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase4-second@example.invalid','{}','{"full_name":"Phase 4 Second"}',
   now(),now(),false,false);

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select id, 'terms-beta-v2-2026-07-28', 'privacy-beta-v2-2026-07-28', 'staging_test'
from auth.users where id::text like '96000000-%';

select is(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000001', false, null
  )->'trial'->>'startedAt'),
  null,
  'passive access check does not start a trial'
);
select is(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000001', false, null
  )->>'basis'),
  'lifetime_free',
  'eligible new student sees lifetime-free fallback before opening an exam'
);

select ok(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000001', true, 'phase4_first_exam_0001'
  )->'trial'->>'active')::boolean,
  'first protected exam opening starts the trial'
);
select is(
  (
    select round(extract(epoch from (expires_at - started_at)) / 3600)::integer
    from public.access_trials
    where user_id = '96000000-0000-4000-8000-000000000001'
  ),
  72,
  'stored trial duration is exactly 72 hours'
);

create temporary table original_trial as
select started_at, expires_at
from public.access_trials
where user_id = '96000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000001', true, 'phase4_second_exam_0002'
  )$$,
  'repeated exam opening is idempotent'
);
select is(
  (
    select count(*)
    from public.access_trials t, original_trial o
    where t.user_id = '96000000-0000-4000-8000-000000000001'
      and t.started_at = o.started_at
      and t.expires_at = o.expires_at
  ),
  1::bigint,
  'trial timestamps cannot be restarted'
);

update public.access_trials
set started_at = now() - interval '73 hours',
    expires_at = now() - interval '1 hour'
where user_id = '96000000-0000-4000-8000-000000000001';
insert into public.lifetime_grade_usage(user_id, successful_grades)
values ('96000000-0000-4000-8000-000000000001', 2)
on conflict (user_id) do update set successful_grades = 2;

create temporary table reservation_one as
select public.phase4_reserve_grade(
  '96000000-0000-4000-8000-000000000001',
  'phase4_reservation_0001',
  'LAB-001'
) as value;

select ok(
  (select (value->>'allowed')::boolean from reservation_one),
  'last lifetime grade can be reserved'
);
select is(
  (
    public.phase4_reserve_grade(
      '96000000-0000-4000-8000-000000000001',
      'phase4_reservation_0002',
      'LAB-002'
    )->>'allowed'
  )::boolean,
  false,
  'concurrent request cannot bypass the last lifetime grade'
);

select lives_ok(
  $$
    select public.phase4_finalize_grade(
      '96000000-0000-4000-8000-000000000001',
      ((select value->>'reservationId' from reservation_one))::uuid
    )
  $$,
  'successful grade finalizes transactionally'
);
select is(
  (
    select successful_grades from public.lifetime_grade_usage
    where user_id = '96000000-0000-4000-8000-000000000001'
  ),
  3,
  'third successful grade is consumed exactly once'
);
select is(
  (
    public.phase4_finalize_grade(
      '96000000-0000-4000-8000-000000000001',
      ((select value->>'reservationId' from reservation_one))::uuid
    )->>'replayed'
  )::boolean,
  true,
  'finalization retry is idempotent'
);
select is(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000001', false, null
  )->>'allowed')::boolean,
  false,
  'expired trial plus three grades locks ordinary access'
);

update public.user_roles set role = 'founder_admin'
where user_id = '96000000-0000-4000-8000-000000000002';
select is(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000002', false, null
  )->>'basis'),
  'founder_admin',
  'Founder Admin has highest non-Super access precedence'
);
select is(
  (public.admin_authorization_context(
    '96000000-0000-4000-8000-000000000002'
  )->>'role_label'),
  'Founder Admin',
  'Founder Admin receives full administration context'
);

insert into public.free_beta_access (
  user_id, enabled, reason, created_by, updated_by
)
values (
  '96000000-0000-4000-8000-000000000003', true,
  'Synthetic Free Beta staging verification',
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000002'
);
select is(
  (public.phase4_access_snapshot(
    '96000000-0000-4000-8000-000000000003', false, null
  )->>'basis'),
  'free_beta',
  'Free Beta override precedes trial and free grades'
);

select * from finish();
rollback;
