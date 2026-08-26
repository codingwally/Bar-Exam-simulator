-- Staging-only behavioral regression coverage. Every fixture is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(11);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('9e000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-owner@example.invalid','{}','{"full_name":"History Owner"}',
   now(),now(),false,false),
  ('9e000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-other@example.invalid','{}','{"full_name":"History Other"}',
   now(),now(),false,false),
  ('9e000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-anonymous@example.invalid','{}','{}',
   now(),now(),false,true),
  ('9e000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-admin@example.invalid','{}','{"full_name":"History Admin"}',
   now(),now(),false,false);

insert into public.examination_definitions (
  id, track, assessment_kind, title, subject, test_only, status, created_by
)
values
  ('9e100000-0000-4000-8000-000000000001', 'per_subject', 'system_test',
   'Historical access subject fixture', 'Civil Law', true, 'draft',
   '9e000000-0000-4000-8000-000000000001'),
  ('9e100000-0000-4000-8000-000000000002', 'bar_feels', 'system_test',
   'Historical access bar fixture', null, true, 'draft',
   '9e000000-0000-4000-8000-000000000001');

insert into public.examination_versions (
  id, exam_id, version_number, label, duration_seconds, default_timer_mode,
  allowed_timer_modes, grading_route, answer_release_rule, instructions,
  question_count, status, created_by
)
values
  ('9e200000-0000-4000-8000-000000000001',
   '9e100000-0000-4000-8000-000000000001', 1, 'Subject fixture v1', 60, 'none',
   '["none"]'::jsonb, 'ai', 'after_ai', '', 0, 'draft',
   '9e000000-0000-4000-8000-000000000001'),
  ('9e200000-0000-4000-8000-000000000002',
   '9e100000-0000-4000-8000-000000000002', 1, 'Bar fixture v1', 60, 'none',
   '["none"]'::jsonb, 'ai', 'after_ai', '', 0, 'draft',
   '9e000000-0000-4000-8000-000000000001');

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, submitted_at,
  last_activity_at, last_heartbeat_at, active_tab_hash, tab_lease_until,
  elapsed_seconds, start_request_key, grading_entitlement_reserved,
  submission_reason, created_at, updated_at
)
values
  ('9e300000-0000-4000-8000-000000000001',
   '9e000000-0000-4000-8000-000000000001',
   '9e200000-0000-4000-8000-000000000001', 'none', 'submitted',
   now() - interval '10 minutes', now() - interval '1 minute',
   now() - interval '1 minute', now() - interval '1 minute', repeat('a', 64),
   now() + interval '1 minute', 540, 'history_owner_subject_0001', false,
   'manual', now(), now()),
  ('9e300000-0000-4000-8000-000000000002',
   '9e000000-0000-4000-8000-000000000002',
   '9e200000-0000-4000-8000-000000000001', 'none', 'submitted',
   now() - interval '10 minutes', now() - interval '1 minute',
   now() - interval '1 minute', now() - interval '1 minute', repeat('b', 64),
   now() + interval '1 minute', 540, 'history_other_subject_0002', false,
   'manual', now(), now());

select is(
  public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', null, null,
    '9e300000-0000-4000-8000-000000000001', true
  )->>'basis',
  'historical_owner',
  'an owner can open one explicitly owned historical attempt'
);

select is(
  public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', 'per_subject', null, null, true
  )->>'track',
  'per_subject',
  'track history is allowed only when the owner attempted that same track'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', null, null,
    '9e300000-0000-4000-8000-000000000002', true
  )$$,
  'P0001', 'EXAM_ATTEMPT_NOT_FOUND',
  'another user cannot open an attempt they do not own'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', 'bar_feels', null, null, true
  )$$,
  'P0001', 'EXAM_ACCESS_REQUIRED',
  'an owner cannot use one track attempt to unlock another track'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', null, null, null, true
  )$$,
  'P0001', 'EXAM_ACCESS_REQUIRED',
  'a historical request without an attempt or track is never unscoped'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000002', 'bar_feels', null, null, true
  )$$,
  'P0001', 'EXAM_ACCESS_REQUIRED',
  'a user with no attempt in the requested track is denied'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000003', 'per_subject', null, null, true
  )$$,
  'P0001', 'EXAM_ACCESS_REQUIRED',
  'an anonymous identity is denied before history lookup'
);

select throws_ok(
  $$select public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000001', 'unknown_track', null, null, true
  )$$,
  'P0001', 'EXAM_ACCESS_REQUIRED',
  'an invalid track is denied'
);

update public.user_roles
set role = 'founder_admin'
where user_id = '9e000000-0000-4000-8000-000000000004';

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select
  '9e000000-0000-4000-8000-000000000004',
  current_terms_version,
  current_privacy_version,
  'historical-access-regression-test'
from public.platform_access_settings
where singleton = true;

select is(
  public.examination_authorize_access(
    '9e000000-0000-4000-8000-000000000004', 'per_subject', null, null, false
  )->>'basis',
  'founder_admin',
  'current valid entitlement still falls through to the normal resolver'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure_record
    cross join lateral aclexplode(coalesce(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) privilege_record
    where procedure_record.oid =
      'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)'::regprocedure
      and privilege_record.grantee = 0
      and privilege_record.privilege_type = 'EXECUTE'
  ),
  'only the Worker service role can invoke the authorization resolver'
);

select ok(
  position('v_track is null and exists' in pg_get_functiondef(
    'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)'::regprocedure
  )) = 0,
  'the deployed resolver contains no null-track historical grant branch'
);

select * from finish();
rollback;
