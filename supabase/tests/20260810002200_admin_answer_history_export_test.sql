-- Founder-only answer-history export coverage. Synthetic identities, answers,
-- assessments, and audit records are rolled back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(38);

select has_function(
  'public', 'admin_export_answer_history',
  array['uuid','uuid','timestamptz','timestamptz','integer','text','text'],
  'answer-history export function exists'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_export_answer_history(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  true,
  'service role can execute the answer-history export'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_export_answer_history(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers cannot execute the export directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_export_answer_history(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
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
  ('a2200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-student-a@example.invalid','{}','{"full_name":"History Student A"}',
   now(),now(),false,false),
  ('a2200000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-student-b@example.invalid','{}','{"full_name":"History Student B"}',
   now(),now(),false,false),
  ('a2200000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-founder@example.invalid','{}','{"full_name":"History Founder"}',
   now(),now(),false,false),
  ('a2200000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-admin@example.invalid','{}','{"full_name":"History Admin"}',
   now(),now(),false,false),
  ('a2200000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','history-anonymous@example.invalid','{}','{}',
   now(),now(),false,true);

update public.user_roles set role = 'founder_admin'
where user_id = 'a2200000-0000-4000-8000-000000000003';
update public.user_roles set role = 'admin'
where user_id = 'a2200000-0000-4000-8000-000000000004';

insert into public.exam_attempts (
  id, user_id, request_key, question_bank_id, subject, answer_text, status,
  score, assessment, provider_model, timer_mode, elapsed_seconds,
  submission_reason, submitted_at, completed_at, updated_at
)
values
  ('a2210000-0000-4000-8000-000000000001',
   'a2200000-0000-4000-8000-000000000001',
   'answer_history_practice_a_0001', 'HIST-001', 'Civil Law',
   'PERSISTED_PRIVATE_MARKER practice answer', 'completed', 4.0,
   jsonb_build_object(
     'rationale', 'Persisted practice feedback',
     'legalExplanation', 'Persisted legal explanation',
     'modelAnswerALAC', jsonb_build_object(
       'answer', 'Yes.',
       'legalBasis', 'Persisted legal basis.',
       'application', 'Persisted application.',
       'conclusion', 'Persisted conclusion.'
     )
   ),
   'synthetic-practice-model', 'selfPaced', 180, 'manual',
   '2199-01-01 00:05:00+00'::timestamptz,
   '2199-01-01 00:06:00+00'::timestamptz, now()),
  ('a2210000-0000-4000-8000-000000000002',
   'a2200000-0000-4000-8000-000000000002',
   'answer_history_practice_b_0002', 'HIST-002', 'Labor Law',
   'Second student persisted answer', 'completed', 3.0, '{}'::jsonb, null,
   'none', 90, 'manual', '2199-01-01 00:04:00+00'::timestamptz,
   '2199-01-01 00:05:00+00'::timestamptz, now()),
  ('a2210000-0000-4000-8000-000000000003',
   'a2200000-0000-4000-8000-000000000005',
   'answer_history_anonymous_0003', 'HIST-003', 'Labor Law',
   'Anonymous answer must not export', 'completed', 3.0, null, null,
   'none', 90, 'manual', '2199-01-01 00:03:00+00'::timestamptz,
   '2199-01-01 00:04:00+00'::timestamptz, now()),
  ('a2210000-0000-4000-8000-000000000004',
   'a2200000-0000-4000-8000-000000000002',
   'answer_history_blank_0004', 'HIST-004', 'Labor Law',
   '', 'unanswered', null, null, null, 'strict', 720, 'strict_expiry',
   '2199-01-01 00:02:00+00'::timestamptz,
   '2199-01-01 00:03:00+00'::timestamptz, now());

create temporary table answer_history_question_fixture as
select
  v.id as version_id,
  v.label as version_label,
  v.version_number,
  vq.question_id,
  vq.prompt_snapshot,
  vq.model_answer_snapshot
from public.examination_versions v
join public.examination_version_questions vq on vq.version_id = v.id
where vq.model_answer_snapshot is not null
order by v.created_at, vq.ordinal
limit 1;

select is(
  (select count(*) from answer_history_question_fixture),
  1::bigint,
  'an immutable formal question/model-answer fixture is available'
);

insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, started_at, submitted_at,
  last_activity_at, last_heartbeat_at, active_tab_hash, tab_lease_until,
  elapsed_seconds, start_request_key, grading_entitlement_reserved,
  submission_reason, created_at, updated_at
)
select
  'a2220000-0000-4000-8000-000000000001',
  'a2200000-0000-4000-8000-000000000001',
  version_id, 'none', 'submitted', '2199-01-01 00:00:00+00'::timestamptz,
  '2199-01-01 00:06:00+00'::timestamptz,
  '2199-01-01 00:06:00+00'::timestamptz,
  '2199-01-01 00:06:00+00'::timestamptz,
  repeat('a', 64), '2199-01-01 00:07:00+00'::timestamptz,
  1080, 'answer_history_formal_a_0005', false, 'manual', now(), now()
from answer_history_question_fixture;

insert into public.examination_responses (
  attempt_id, question_id, answer_text, flagged, revision, activity_seconds,
  saved_at
)
select
  'a2220000-0000-4000-8000-000000000001', question_id,
  'Persisted formal examination answer', true, 2, 900,
  '2199-01-01 00:06:00+00'::timestamptz
from answer_history_question_fixture;

insert into public.examination_ai_assessments (
  id, attempt_id, question_id, score, assessment_json, grader_model,
  model_answer_hash, finalized_at
)
select
  'a2230000-0000-4000-8000-000000000001',
  'a2220000-0000-4000-8000-000000000001', question_id, 4.0,
  jsonb_build_object(
    'rationale', 'Persisted formal AI feedback',
    'legalExplanation', 'Persisted formal legal explanation',
    'modelAnswerALAC', jsonb_build_object(
      'answer', 'Generated formal answer.',
      'legalBasis', 'Generated formal legal basis.',
      'application', 'Generated formal application.',
      'conclusion', 'Generated formal conclusion.'
    )
  ),
  'synthetic-formal-model', repeat('b', 64),
  '2199-01-01 00:07:00+00'::timestamptz
from answer_history_question_fixture;

insert into public.examination_examiner_assignments (
  id, attempt_id, examiner_email, token_hash, status, expires_at,
  claimed_at, finalized_at, created_by, created_at, updated_at
)
values (
  'a2240000-0000-4000-8000-000000000001',
  'a2220000-0000-4000-8000-000000000001',
  'examiner@example.invalid', repeat('c', 64), 'finalized',
  now() + interval '1 day', now() - interval '3 minutes',
  now() - interval '1 minute',
  'a2200000-0000-4000-8000-000000000003', now() - interval '4 minutes', now()
);

insert into public.examination_examiner_reviews (
  assignment_id, question_id, score, comments, revision, saved_at, finalized_at
)
select
  'a2240000-0000-4000-8000-000000000001', question_id, 4.5,
  'Persisted human examiner feedback', 1,
  '2199-01-01 00:07:00+00'::timestamptz,
  '2199-01-01 00:07:00+00'::timestamptz
from answer_history_question_fixture;

select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000001', null,
      now() - interval '1 day', now() + interval '1 day', 5000,
      'Student must not export answer history.',
      'answer_history_student_denied_0006'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'students cannot export private answer history'
);
select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000004', null,
      now() - interval '1 day', now() + interval '1 day', 5000,
      'Ordinary admin must not export answer history.',
      'answer_history_admin_denied_0007'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'ordinary administrators cannot export private answer history'
);

create temporary table answer_history_all_result as
select public.admin_export_answer_history(
  'a2200000-0000-4000-8000-000000000003', null,
  '2199-01-01 00:00:00+00'::timestamptz,
  '2199-01-02 00:00:00+00'::timestamptz, 5000,
  'Authorized synthetic all-user answer-history export.',
  'answer_history_all_allowed_0008'
) as value;

select is(
  (select (value->>'total')::integer from answer_history_all_result),
  4,
  'all-user export returns every non-blank persisted answer fixture'
);
select is(
  (select value->>'scope' from answer_history_all_result),
  'all_users',
  'all-user export declares its scope'
);
select is(
  (select value->>'dateScope' from answer_history_all_result),
  'bounded_range',
  'supplied export dates declare a bounded range'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'userEmail' = 'history-student-a@example.invalid'),
  2::bigint,
  'export returns the exact Auth email on both student A records'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'userEmail' = 'history-student-b@example.invalid'),
  1::bigint,
  'all-user export includes another registered user'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'userEmail' = 'history-student-b@example.invalid'
      and item->>'feedbackStatus' = 'present_but_empty'
      and item->>'modelAnswerStatus' = 'not_persisted'
      and item->'modelAnswer' = 'null'::jsonb),
  1::bigint,
  'empty assessment objects are not mislabeled as available feedback or model answers'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'userId' = 'a2200000-0000-4000-8000-000000000005'
      and item->'userEmail' = 'null'::jsonb
      and item->>'emailStatus' = 'anonymous_no_registered_email'),
  1::bigint,
  'anonymous persisted answers are included without inventing a registered email'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'submittedAnswer' = ''),
  0::bigint,
  'blank unanswered records are excluded'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'practice'
      and item->>'userEmail' = 'history-student-a@example.invalid'
      and item->'questionText' = 'null'::jsonb
      and item->>'questionTextStatus' = 'unavailable_exact_historic_text'),
  1::bigint,
  'practice question text is explicitly unavailable instead of fabricated'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'practice'
      and item->>'userEmail' = 'history-student-a@example.invalid'
      and item->'suggestedAnswer' = 'null'::jsonb
      and item->>'suggestedAnswerStatus' = 'not_persisted_with_practice_attempt'),
  1::bigint,
  'practice suggested answer is null with explicit source status'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'practice'
      and item->>'feedbackText' like '%Persisted practice feedback%'
      and item->>'modelAnswerStatus' = 'available_generated_assessment'
      and item->>'modelAnswer' like '%Persisted legal basis%'),
  1::bigint,
  'practice assessment feedback and generated ALAC model answer are exported'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'formal_exam'
      and item->>'questionTextStatus' = 'available_exact_attempt_snapshot'
      and item->>'questionText' = (
        select prompt_snapshot from answer_history_question_fixture
      )),
  1::bigint,
  'formal exam export uses the immutable question snapshot'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'formal_exam'
      and item->>'suggestedAnswerStatus' = 'available_exact_attempt_snapshot'
      and item->>'suggestedAnswer' = (
        select model_answer_snapshot from answer_history_question_fixture
      )),
  1::bigint,
  'formal exam export uses the immutable source answer as its suggested answer'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'formal_exam'
      and item->>'modelAnswerStatus' = 'available_generated_assessment'
      and item->>'modelAnswerSource' = 'persisted_ai_assessment_model_answer_alac'
      and item->>'modelAnswer' like '%Generated formal legal basis%'),
  1::bigint,
  'formal generated model answer comes only from its persisted assessment'
);
select is(
  (select count(*) from answer_history_all_result,
    jsonb_array_elements(value->'items') item
    where item->>'recordSource' = 'formal_exam'
      and item->>'gradeSource' = 'human_and_ai'
      and (item->>'score')::numeric = 4.5
      and (item->>'aiScore')::numeric = 4.0
      and (item->>'humanScore')::numeric = 4.5
      and item->>'humanFeedback' = 'Persisted human examiner feedback'
      and item->>'providerOrGraderModel' = 'synthetic-formal-model'),
  1::bigint,
  'formal export distinguishes persisted AI and finalized human grading'
);

create temporary table answer_history_target_result as
select public.admin_export_answer_history(
  'a2200000-0000-4000-8000-000000000003',
  'a2200000-0000-4000-8000-000000000001',
  null, null, 5000,
  'Authorized synthetic single-user answer-history export.',
  'answer_history_target_allowed_0009'
) as value;

select is(
  (select (value->>'total')::integer from answer_history_target_result),
  2,
  'single-user export returns only that user practice and formal answers'
);
select is(
  (select value->>'scope' from answer_history_target_result),
  'single_user',
  'single-user export declares its scope'
);
select is(
  (select value->>'dateScope' from answer_history_target_result),
  'all_time',
  'two omitted dates request the complete all-time history'
);
select is(
  (select count(*) from answer_history_target_result,
    jsonb_array_elements(value->'items') item
    where item->>'userEmail' <> 'history-student-a@example.invalid'),
  0::bigint,
  'single-user export never includes another user'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'a2200000-0000-4000-8000-000000000003'
     and target_resource_type = 'answer_history_export'
     and details->>'requestKey' = 'answer_history_all_allowed_0008'),
  1::bigint,
  'successful all-user export creates one audit record'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'answer_history_export'
     and details::text like '%PERSISTED_PRIVATE_MARKER%'),
  0::bigint,
  'audit metadata never stores private question, answer, or feedback content'
);
select lives_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003', null,
      '2199-01-01 00:00:00+00'::timestamptz,
      '2199-01-02 00:00:00+00'::timestamptz, 5000,
      'Authorized synthetic all-user answer-history export.',
      'answer_history_all_allowed_0008'
    )
  $$,
  'retrying the same export request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'answer_history_export'
     and details->>'requestKey' = 'answer_history_all_allowed_0008'),
  1::bigint,
  'retrying the same request does not duplicate its audit record'
);
select lives_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003', null,
      null, null, 5000,
      'Authorized synthetic all-time all-user answer-history export.',
      'answer_history_all_time_0010'
    )
  $$,
  'both omitted dates support a true all-user all-time export'
);

create temporary table answer_history_too_many as
select public.admin_export_answer_history(
  'a2200000-0000-4000-8000-000000000003',
  'a2200000-0000-4000-8000-000000000001',
  '2199-01-01 00:00:00+00'::timestamptz,
  '2199-01-02 00:00:00+00'::timestamptz, 1,
  'Synthetic bounded answer-history export.',
  'answer_history_too_many_0011'
) as value;

select is(
  (select (value->>'tooMany')::boolean from answer_history_too_many),
  true,
  'oversized result is explicitly reported instead of silently truncated'
);
select is(
  (select jsonb_array_length(value->'items') from answer_history_too_many),
  0,
  'oversized export does not release a partial private dataset'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'answer_history_export'
     and details->>'requestKey' = 'answer_history_too_many_0011'
     and (details->>'tooMany')::boolean = true
     and (details->>'resultCount')::integer = 2),
  1::bigint,
  'oversized private export scans are audited before returning'
);
select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003',
      'a2200000-0000-4000-8000-000000000002',
      '2199-01-01 00:00:00+00'::timestamptz,
      '2199-01-02 00:00:00+00'::timestamptz, 5000,
      'Authorized synthetic all-user answer-history export.',
      'answer_history_all_allowed_0008'
    )
  $$,
  'P0001',
  'Export request key conflict',
  'a request key cannot be replayed with a different target or scope'
);
select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003', null,
      now() - interval '1 day', null, 5000,
      'Invalid mixed-null export window.',
      'answer_history_mixed_date_denied_0012'
    )
  $$,
  'P0001',
  'Both export dates must be supplied or both omitted',
  'a mixed-null export range is rejected'
);
select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003', null,
      now() - interval '367 days', now(), 5000,
      'Invalid oversized export window.',
      'answer_history_window_denied_0013'
    )
  $$,
  'P0001',
  'Valid export window of at most 366 days required',
  'export window is bounded'
);
select throws_ok(
  $$
    select public.admin_export_answer_history(
      'a2200000-0000-4000-8000-000000000003', null,
      now() - interval '1 day', now(), 5001,
      'Invalid oversized row limit.',
      'answer_history_limit_denied_0014'
    )
  $$,
  'P0001',
  'Valid export row limit required',
  'export row limit is bounded'
);

select * from finish();
rollback;
