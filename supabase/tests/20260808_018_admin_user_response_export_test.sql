-- Staging-only pgTAP coverage. Synthetic identities and responses roll back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_function(
  'public', 'admin_export_user_responses',
  array['uuid','uuid','timestamptz','timestamptz','integer','text','text'],
  'founder user-response export function exists'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_export_user_responses(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  true,
  'service role can execute the export'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_export_user_responses(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browser callers cannot execute the export directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_export_user_responses(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute the export'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('9d000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','export-student-a@example.invalid','{}','{"full_name":"Export Student A"}',
   now(),now(),false,false),
  ('9d000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','export-founder@example.invalid','{}','{"full_name":"Export Founder"}',
   now(),now(),false,false),
  ('9d000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','export-admin@example.invalid','{}','{"full_name":"Export Admin"}',
   now(),now(),false,false),
  ('9d000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','export-student-b@example.invalid','{}','{"full_name":"Export Student B"}',
   now(),now(),false,false);

update public.user_roles set role = 'founder_admin'
where user_id = '9d000000-0000-4000-8000-000000000002';
update public.user_roles set role = 'admin'
where user_id = '9d000000-0000-4000-8000-000000000003';

insert into public.exam_attempts (
  id, user_id, request_key, question_bank_id, subject, answer_text, status,
  score, timer_mode, elapsed_seconds, submission_reason, submitted_at,
  completed_at, updated_at
) values
  ('9d100000-0000-4000-8000-000000000001',
   '9d000000-0000-4000-8000-000000000001',
   'admin_export_practice_a_0001', 'LAB-001', 'Labor Law',
   '=Synthetic practice answer', 'completed', 4.0, 'selfPaced', 300,
   'manual', now() - interval '2 minutes', now() - interval '1 minute', now()),
  ('9d100000-0000-4000-8000-000000000002',
   '9d000000-0000-4000-8000-000000000004',
   'admin_export_practice_b_0002', 'LAB-002', 'Labor Law',
   'Other user private answer', 'completed', 3.0, 'selfPaced', 200,
   'manual', now() - interval '2 minutes', now() - interval '1 minute', now());

create temporary table export_question_fixture as
select v.id as version_id, vq.question_id, vq.prompt_snapshot
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
  '9d200000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000001',
  version_id, 'none', 'submitted', now() - interval '10 minutes',
  now() - interval '1 minute', now() - interval '1 minute',
  now() - interval '1 minute', repeat('a', 64), now() + interval '1 minute',
  540, 'admin_export_formal_a_0003', false, 'manual', now(), now()
from export_question_fixture;

insert into public.examination_responses (
  attempt_id, question_id, answer_text, saved_at
)
select
  '9d200000-0000-4000-8000-000000000001', question_id,
  '@Synthetic formal answer', now()
from export_question_fixture;

select throws_ok(
  $$
    select public.admin_export_user_responses(
      '9d000000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000001',
      now() - interval '1 day', now() + interval '1 day', 2000,
      'Student must not export responses.', 'admin_export_student_denied_0004'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'student cannot export private responses'
);
select throws_ok(
  $$
    select public.admin_export_user_responses(
      '9d000000-0000-4000-8000-000000000003',
      '9d000000-0000-4000-8000-000000000001',
      now() - interval '1 day', now() + interval '1 day', 2000,
      'Ordinary admin must not export responses.', 'admin_export_admin_denied_0005'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'ordinary admin cannot export private responses'
);

create temporary table export_result as
select public.admin_export_user_responses(
  '9d000000-0000-4000-8000-000000000002',
  '9d000000-0000-4000-8000-000000000001',
  now() - interval '1 day', now() + interval '1 day', 2000,
  'Authorized synthetic founder response export.',
  'admin_export_founder_allowed_0006'
) as value;

select is((select (value->>'total')::integer from export_result), 2,
  'founder export returns both response systems for the target user');
select is(
  (select count(*) from export_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'practice'),
  1::bigint,
  'practice response is included'
);
select is(
  (select count(*) from export_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'formal_exam'
      and item->>'questionProvenance' = 'immutable_exam_snapshot'
      and item->>'questionText' = (select prompt_snapshot from export_question_fixture)),
  1::bigint,
  'formal response uses the immutable saved prompt'
);
select is(
  (select count(*) from export_result,
    jsonb_array_elements(value->'items') item
    where item->>'studentAnswer' = 'Other user private answer'),
  0::bigint,
  'target export never includes another user response'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = '9d000000-0000-4000-8000-000000000002'
     and target_user_id = '9d000000-0000-4000-8000-000000000001'
     and target_resource_type = 'user_question_answer_export'),
  1::bigint,
  'export creates one targeted audit record'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'user_question_answer_export'
     and details::text ~* 'synthetic.*answer'),
  0::bigint,
  'audit metadata never stores question or answer content'
);

select lives_ok(
  $$
    select public.admin_export_user_responses(
      '9d000000-0000-4000-8000-000000000002',
      '9d000000-0000-4000-8000-000000000001',
      now() - interval '1 day', now() + interval '1 day', 2000,
      'Authorized synthetic founder response export.',
      'admin_export_founder_allowed_0006'
    )
  $$,
  'retrying the same export request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'user_question_answer_export'
     and details->>'requestKey' = 'admin_export_founder_allowed_0006'),
  1::bigint,
  'retrying the same request does not duplicate its audit record'
);
select throws_ok(
  $$
    select public.admin_export_user_responses(
      '9d000000-0000-4000-8000-000000000002',
      '9d000000-0000-4000-8000-000000000001',
      now() - interval '367 days', now(), 2000,
      'Invalid oversized export window.', 'admin_export_window_denied_0007'
    )
  $$,
  'P0001',
  'Valid export window of at most 366 days required',
  'export window is bounded'
);

select * from finish();
rollback;
