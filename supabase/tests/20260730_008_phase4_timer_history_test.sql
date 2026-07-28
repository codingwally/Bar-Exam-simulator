begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_column('public', 'exam_attempts', 'timer_mode', 'attempt records timer mode');
select has_column('public', 'exam_attempts', 'elapsed_seconds', 'attempt records elapsed seconds');
select has_column('public', 'exam_attempts', 'submission_reason', 'attempt records submission reason');
select has_column('public', 'exam_attempts', 'expired', 'attempt records expiration');
select has_function(
  'public',
  'phase4_prepare_exam_attempt_v2',
  array['uuid','uuid','text','text','text','text','text','integer','text','boolean']
);
select has_function(
  'public',
  'phase4_record_unanswered_attempt',
  array['uuid','text','text','text','integer']
);
select has_function(
  'public',
  'phase4_exam_history',
  array['uuid','integer','integer']
);
select is(
  has_function_privilege(
    'authenticated',
    'public.phase4_record_unanswered_attempt(uuid,text,text,text,integer)',
    'execute'
  ),
  false,
  'students cannot forge unanswered attempts through direct RPC'
);
select is(
  has_function_privilege(
    'service_role',
    'public.phase4_record_unanswered_attempt(uuid,text,text,text,integer)',
    'execute'
  ),
  true,
  'Worker service role may record a verified unanswered attempt'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.phase4_exam_history(uuid,integer,integer)',
    'execute'
  ),
  false,
  'students cannot request arbitrary user history through direct RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('98000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release3-student@example.invalid','{}','{"full_name":"Release 3 Student"}',
   now(),now(),false,false),
  ('98000000-0000-4000-8000-000000000002','00000000-0000-0000-8000-000000000000',
   'authenticated','authenticated','release3-founder@example.invalid','{}','{"full_name":"Release 3 Founder"}',
   now(),now(),false,false),
  ('98000000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000',
   'authenticated','authenticated','release3-other@example.invalid','{}','{"full_name":"Release 3 Other"}',
   now(),now(),false,false);

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select id, 'terms-beta-v2-2026-07-28', 'privacy-beta-v2-2026-07-28', 'staging_release3'
from auth.users where id::text like '98000000-%';

insert into public.free_beta_access (
  user_id, enabled, reason, created_by, updated_by
)
values (
  '98000000-0000-4000-8000-000000000001', true,
  'Release 3 staging timer validation.',
  '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000002'
);

create temporary table release3_reservation as
select public.phase4_reserve_grade_v2(
  '98000000-0000-4000-8000-000000000001',
  'release3_grade_request_0001',
  'LAB-001'
) as value;

create temporary table release3_attempt as
select public.phase4_prepare_exam_attempt_v2(
  '98000000-0000-4000-8000-000000000001',
  (select (value->>'reservationId')::uuid from release3_reservation),
  'release3_grade_request_0001',
  'LAB-001',
  'Labor Law',
  'Answer: Yes. Legal Basis: The controlling doctrine applies. Application: The material facts satisfy the rule. Conclusion: Therefore, relief should be granted.',
  'selfPaced',
  187,
  'manual',
  false
) as value;

select is((select value->>'status' from release3_attempt), 'grading', 'timed attempt enters grading');
select is(
  (select timer_mode from public.exam_attempts where request_key = 'release3_grade_request_0001'),
  'selfPaced',
  'timer mode is preserved'
);
select is(
  (select elapsed_seconds from public.exam_attempts where request_key = 'release3_grade_request_0001'),
  187,
  'elapsed seconds are preserved'
);
select is(
  (select submission_reason from public.exam_attempts where request_key = 'release3_grade_request_0001'),
  'manual',
  'manual submission reason is preserved'
);
select is(
  (select expired from public.exam_attempts where request_key = 'release3_grade_request_0001'),
  false,
  'manual submission is not marked expired'
);

create temporary table release3_unanswered as
select public.phase4_record_unanswered_attempt(
  '98000000-0000-4000-8000-000000000001',
  'release3_unanswered_0001',
  'LAB-002',
  'Labor Law',
  720
) as value;

select is((select value->>'status' from release3_unanswered), 'unanswered', 'blank expiration is unanswered');
select is(
  (select answer_text from public.exam_attempts where request_key = 'release3_unanswered_0001'),
  '',
  'blank expiration stores no fabricated answer'
);
select is(
  (select timer_mode from public.exam_attempts where request_key = 'release3_unanswered_0001'),
  'strict',
  'blank expiration records Strict Scrutiny'
);
select is(
  (select expired from public.exam_attempts where request_key = 'release3_unanswered_0001'),
  true,
  'blank expiration records expiration'
);
select is(
  (select successful_grades from public.lifetime_grade_usage
   where user_id = '98000000-0000-4000-8000-000000000001'),
  0,
  'blank expiration consumes no AI grade'
);

select public.phase4_record_unanswered_attempt(
  '98000000-0000-4000-8000-000000000001',
  'release3_unanswered_0001',
  'LAB-002',
  'Labor Law',
  720
);
select is(
  (select count(*) from public.exam_attempts where request_key = 'release3_unanswered_0001'),
  1::bigint,
  'blank expiration replay is idempotent'
);

insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status,
  timer_mode, elapsed_seconds, submission_reason, expired
)
values (
  '98000000-0000-4000-8000-000000000003',
  'release3_other_history_0002',
  'LAB-003', 'Labor Law', 'Private answer belonging to another student.', 'failed',
  'none', 45, 'manual', false
);

select is(
  jsonb_array_length((
    public.phase4_exam_history(
      '98000000-0000-4000-8000-000000000001',
      100,
      0
    )->'items'
  )),
  2,
  'history returns only the requested user attempts'
);
select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.phase4_exam_history(
        '98000000-0000-4000-8000-000000000001',
        100,
        0
      )->'items'
    ) item
    where item->>'questionId' = 'LAB-003'
  ),
  0::bigint,
  'another student history is not included'
);
select throws_ok(
  $$
    select public.phase4_record_unanswered_attempt(
      '98000000-0000-4000-8000-000000000001',
      'release3_invalid_time_0003',
      'LAB-004',
      'Labor Law',
      719
    )
  $$,
  'P0001',
  'Invalid unanswered attempt',
  'untrusted early expiration is rejected'
);
select throws_ok(
  $$
    select public.phase4_prepare_exam_attempt_v2(
      '98000000-0000-4000-8000-000000000001',
      (select (value->>'reservationId')::uuid from release3_reservation),
      'release3_grade_request_0001',
      'LAB-001',
      'Labor Law',
      'Answer: Yes.',
      'strict',
      25,
      'strict_expiry',
      false
    )
  $$,
  'P0001',
  'Invalid expiration provenance',
  'strict expiration cannot be forged without expired state'
);

select * from finish();
rollback;
