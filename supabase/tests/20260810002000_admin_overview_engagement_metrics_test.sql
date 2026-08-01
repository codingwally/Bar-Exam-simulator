-- Admin-only overview engagement, exact-email detail, and founder-email
-- export coverage. Synthetic data is rolled back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(40);

select has_function(
  'public', 'admin_user_answer_counts', array[]::text[],
  'private administrator answer-count helper exists'
);
select has_function(
  'public', 'admin_overview_engagement_metrics', array['uuid'],
  'administrator Overview engagement RPC exists'
);
select has_function(
  'public', 'admin_user_engagement_directory',
  array['uuid','text','integer','integer','text','text'],
  'administrator engagement directory exists'
);
select has_function(
  'public', 'admin_prepare_user_directory_email_export',
  array['uuid','text','integer','text','text','text'],
  'founder directory-email preparation RPC exists'
);
select has_function(
  'public', 'admin_record_user_directory_email_delivery',
  array['uuid','text','text','text','text','integer','text','text'],
  'founder directory-email delivery receipt RPC exists'
);

select is(
  has_function_privilege(
    'service_role', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
  ), true, 'service role can execute Overview engagement metrics'
);
select is(
  has_function_privilege(
    'authenticated', 'public.admin_overview_engagement_metrics(uuid)', 'execute'
  ), false, 'authenticated browsers cannot call Overview metrics directly'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ), true, 'service role can execute the engagement directory'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_user_engagement_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ), false, 'authenticated browsers cannot call the engagement directory directly'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_prepare_user_directory_email_export(uuid,text,integer,text,text,text)',
    'execute'
  ), false, 'authenticated browsers cannot prepare a founder email export directly'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_record_user_directory_email_delivery(uuid,text,text,text,text,integer,text,text)',
    'execute'
  ), false, 'authenticated browsers cannot record email delivery directly'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at, is_sso_user, is_anonymous
)
values
  ('9f000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','overview-student-a@example.invalid','{}','{"full_name":"Overview Student A"}',
   now(),now(),now(),false,false),
  ('9f000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','overview-student-b@example.invalid','{}','{"full_name":"Overview Student B"}',
   now(),now(),null,false,false),
  ('9f000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','overview-founder@example.invalid','{}','{"full_name":"Overview Founder"}',
   now(),now(),now(),false,false),
  ('9f000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','overview-admin@example.invalid','{}','{"full_name":"Overview Admin"}',
   now(),now(),now(),false,false),
  ('9f000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','overview-anonymous@example.invalid','{}','{}',
   now(),now(),now(),false,true);

update public.user_roles set role = 'founder_admin'
where user_id = '9f000000-0000-4000-8000-000000000003';
update public.user_roles set role = 'admin'
where user_id = '9f000000-0000-4000-8000-000000000004';

insert into public.exam_attempts (
  id, user_id, request_key, question_bank_id, subject, answer_text, status,
  score, timer_mode, elapsed_seconds, submission_reason, submitted_at,
  completed_at, updated_at
) values
  ('9f100000-0000-4000-8000-000000000001',
   '9f000000-0000-4000-8000-000000000001',
   'overview_practice_a_0001', 'OVR-001', 'Civil Law',
   'First persisted answer', 'completed', 4.0, 'selfPaced', 120,
   'manual', now() - interval '4 minutes', now() - interval '3 minutes', now()),
  ('9f100000-0000-4000-8000-000000000002',
   '9f000000-0000-4000-8000-000000000001',
   'overview_practice_a_0002', 'OVR-002', 'Civil Law',
   'Second persisted answer', 'failed', null, 'selfPaced', 180,
   'manual', now() - interval '3 minutes', now() - interval '2 minutes', now()),
  ('9f100000-0000-4000-8000-000000000003',
   '9f000000-0000-4000-8000-000000000002',
   'overview_practice_b_0003', 'OVR-003', 'Civil Law',
   '', 'unanswered', null, 'strict', 720,
   'strict_expiry', now(), now(), now()),
  ('9f100000-0000-4000-8000-000000000004',
   '9f000000-0000-4000-8000-000000000005',
   'overview_anonymous_0004', 'OVR-004', 'Civil Law',
   'Anonymous answer excluded', 'completed', 3.0, 'selfPaced', 90,
   'manual', now(), now(), now());

create temporary table overview_question_fixture as
select v.id as version_id, vq.question_id
from public.examination_versions v
join public.examination_version_questions vq on vq.version_id = v.id
order by v.created_at, vq.ordinal
limit 1;

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, submitted_at,
  last_activity_at, last_heartbeat_at, active_tab_hash, tab_lease_until,
  elapsed_seconds, start_request_key, grading_entitlement_reserved,
  submission_reason, created_at, updated_at
)
select
  '9f200000-0000-4000-8000-000000000001',
  '9f000000-0000-4000-8000-000000000001',
  version_id, 'none', 'submitted', now() - interval '10 minutes', now(),
  now(), now(), repeat('b', 64), now() + interval '1 minute',
  600, 'overview_formal_a_0005', false, 'manual', now(), now()
from overview_question_fixture;

insert into public.examination_responses (
  attempt_id, question_id, answer_text, saved_at
)
select
  '9f200000-0000-4000-8000-000000000001', question_id,
  'Persisted formal answer', now()
from overview_question_fixture;

select throws_ok(
  $$ select public.admin_overview_engagement_metrics(
    '9f000000-0000-4000-8000-000000000004'
  ) $$,
  'P0001', 'Analytics capability required',
  'ordinary admin without analytics capability cannot read Overview metrics'
);

insert into public.admin_capabilities(user_id, capability, granted_by, reason)
values (
  '9f000000-0000-4000-8000-000000000004',
  'analytics_viewer',
  '9f000000-0000-4000-8000-000000000003',
  'Synthetic Overview analytics authorization'
);

select throws_ok(
  $$ select public.admin_user_engagement_directory(
    '9f000000-0000-4000-8000-000000000004', null, 100, 0,
    'overview_directory_denied_0006', 'dashboard'
  ) $$,
  'P0001', 'Learner analytics capability required',
  'analytics-only admin cannot read exact-email engagement details'
);

insert into public.admin_capabilities(user_id, capability, granted_by, reason)
values (
  '9f000000-0000-4000-8000-000000000004',
  'learner_analytics_viewer',
  '9f000000-0000-4000-8000-000000000003',
  'Synthetic exact-email engagement authorization'
);

create temporary table overview_metrics_result as
select public.admin_overview_engagement_metrics(
  '9f000000-0000-4000-8000-000000000004'
) as value;

select is(
  (select (value->>'signedInAccounts')::bigint from overview_metrics_result),
  (select count(*) from auth.users
   where coalesce(is_anonymous, false) = false and last_sign_in_at is not null),
  'signed-in account total matches non-anonymous Auth records that signed in'
);
select is(
  (select (value->>'usersWithAnswers')::bigint from overview_metrics_result),
  (select count(*) from public.admin_user_answer_counts()),
  'users-with-answers aggregate matches the per-user source'
);
select is(
  (select (value->>'questionsAnswered')::bigint from overview_metrics_result),
  (select coalesce(sum(answered_question_count), 0)::bigint from public.admin_user_answer_counts()),
  'answered-question aggregate matches the per-user source'
);
select is(
  (select (value->>'practiceQuestionsAnswered')::bigint from overview_metrics_result),
  (select coalesce(sum(practice_answered), 0)::bigint from public.admin_user_answer_counts()),
  'practice-answer aggregate matches the per-user source'
);
select is(
  (select (value->>'examinationQuestionsAnswered')::bigint from overview_metrics_result),
  (select coalesce(sum(examination_answered), 0)::bigint from public.admin_user_answer_counts()),
  'formal-examination aggregate matches the per-user source'
);
select is(
  (select value->>'scope' from overview_metrics_result),
  'all_time',
  'Overview engagement metrics explicitly declare their all-time scope'
);

create temporary table overview_student_a as
select public.admin_user_engagement_directory(
  '9f000000-0000-4000-8000-000000000004',
  'overview-student-a@example.invalid', 100, 0,
  'overview_directory_allowed_0007', 'dashboard'
) as value;

select is(
  (select value->'items'->0->>'email' from overview_student_a),
  'overview-student-a@example.invalid',
  'engagement detail returns the authorized exact email'
);
select is(
  (select (value->'items'->0->>'answered_question_count')::integer from overview_student_a),
  3,
  'per-user detail counts two practice answers and one formal answer'
);
select is(
  (select (value->'items'->0->>'practice_answered_count')::integer from overview_student_a),
  2,
  'per-user detail separates practice answers'
);
select is(
  (select (value->'items'->0->>'examination_answered_count')::integer from overview_student_a),
  1,
  'per-user detail separates formal-examination answers'
);
select is(
  (select (value->'items'->0->>'has_signed_in')::boolean from overview_student_a),
  true,
  'per-user detail identifies an account that has signed in'
);

create temporary table overview_student_b as
select public.admin_user_engagement_directory(
  '9f000000-0000-4000-8000-000000000004',
  'overview-student-b@example.invalid', 100, 0,
  'overview_directory_zero_0008', 'dashboard'
) as value;

select is(
  (select (value->'items'->0->>'answered_question_count')::integer from overview_student_b),
  0,
  'blank practice records do not count as answered questions'
);
select is(
  (select (value->'items'->0->>'has_signed_in')::boolean from overview_student_b),
  false,
  'per-user detail distinguishes an account that has not signed in'
);
select is(
  (select count(*) from public.admin_user_answer_counts()
   where user_id = '9f000000-0000-4000-8000-000000000005'),
  0::bigint,
  'anonymous-user answers are excluded from administrator account totals'
);
select throws_ok(
  $$ select public.admin_overview_engagement_metrics(
    '9f000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'Administrator authorization required',
  'students cannot read Overview engagement metrics'
);

create temporary table founder_email_prepare as
select public.admin_prepare_user_directory_email_export(
  '9f000000-0000-4000-8000-000000000003',
  'overview-student-a@example.invalid', 5000, 'gilmar',
  'Authorized synthetic founder directory delivery.',
  'overview_email_prepare_0009'
) as value;

select is(
  (select value->>'recipientKey' from founder_email_prepare),
  'gilmar',
  'founder email preparation returns only the approved opaque recipient key'
);
select is(
  (select (value->>'total')::integer from founder_email_prepare),
  1,
  'founder email preparation includes the one matching user'
);
select is(
  (select (value->'items'->0->>'answered_question_count')::integer
   from founder_email_prepare),
  3,
  'founder email preparation includes the matching per-user answer count'
);
select throws_ok(
  $$ select public.admin_prepare_user_directory_email_export(
    '9f000000-0000-4000-8000-000000000004', null, 5000, 'gilmar',
    'Ordinary admin must not email a private directory.',
    'overview_email_admin_denied_0010'
  ) $$,
  'P0001', 'Founder administrator authorization required',
  'ordinary admins cannot prepare founder-personal-email exports'
);
select throws_ok(
  $$ select public.admin_prepare_user_directory_email_export(
    '9f000000-0000-4000-8000-000000000003', null, 5000, 'arbitrary',
    'Unknown recipients must be rejected.',
    'overview_email_recipient_denied_0011'
  ) $$,
  'P0001', 'Approved founder recipient required',
  'recipient keys are allowlisted in the database'
);

select lives_ok(
  $$ select public.admin_record_user_directory_email_delivery(
    '9f000000-0000-4000-8000-000000000003', 'gilmar', 'sent',
    'provider-safe-id', null, 1,
    'Authorized synthetic founder directory delivery.',
    'overview_email_prepare_0009'
  ) $$,
  'founder can record a privacy-safe successful delivery receipt'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = '9f000000-0000-4000-8000-000000000003'
     and target_resource_type = 'admin_user_directory_email_delivery'
     and details->>'requestKey' = 'overview_email_prepare_0009'),
  1::bigint,
  'email delivery creates one audit receipt'
);
select is(
  (select details->>'recipientKey' from public.admin_audit_log
   where target_resource_type = 'admin_user_directory_email_delivery'
     and details->>'requestKey' = 'overview_email_prepare_0009'),
  'gilmar',
  'delivery audit stores only the opaque recipient key'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'admin_user_directory_email_delivery'
     and details::text ~* '@|overview-student|persisted.*answer'),
  0::bigint,
  'delivery audit stores no address, student identity, CSV, or answer content'
);
select lives_ok(
  $$ select public.admin_record_user_directory_email_delivery(
    '9f000000-0000-4000-8000-000000000003', 'gilmar', 'sent',
    'provider-safe-id', null, 1,
    'Authorized synthetic founder directory delivery.',
    'overview_email_prepare_0009'
  ) $$,
  'retrying the same delivery receipt is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'admin_user_directory_email_delivery'
     and details->>'requestKey' = 'overview_email_prepare_0009'),
  1::bigint,
  'retrying the same delivery receipt remains idempotent'
);
select throws_ok(
  $$ select public.admin_record_user_directory_email_delivery(
    '9f000000-0000-4000-8000-000000000004', 'gilmar', 'sent',
    'provider-safe-id', null, 1,
    'Ordinary admin must not record founder delivery.',
    'overview_email_admin_denied_0012'
  ) $$,
  'P0001', 'Founder administrator authorization required',
  'ordinary admins cannot record founder-personal-email delivery'
);

select * from finish();
rollback;
