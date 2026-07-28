begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select has_table('public', 'exam_attempts', 'exam attempt table exists');
select has_table('public', 'provider_incidents', 'provider incident table exists');
select has_column('public', 'grade_reservations', 'exam_attempt_id', 'reservation links to attempt');
select has_function('public', 'phase4_reserve_grade_v2', array['uuid','text','text']);
select has_function('public', 'phase4_prepare_exam_attempt', array['uuid','uuid','text','text','text','text']);
select has_function('public', 'phase4_mark_exam_capacity', array['uuid','uuid','text']);
select has_function('public', 'phase4_complete_exam_attempt', array['uuid','uuid','numeric','jsonb','text']);
select has_function('public', 'phase4_finalize_exam_grade', array['uuid','uuid','uuid','numeric','jsonb','text']);
select has_function('public', 'phase4_fail_exam_attempt', array['uuid','uuid','text']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.exam_attempts'::regclass),
  'exam attempts have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.provider_incidents'::regclass),
  'provider incidents have RLS'
);
select is(
  has_table_privilege('anon', 'public.exam_attempts', 'select'),
  false,
  'anonymous users cannot read attempts'
);
select is(
  has_table_privilege('authenticated', 'public.exam_attempts', 'select'),
  true,
  'authenticated users may read only their RLS-filtered history'
);
select is(
  has_table_privilege('authenticated', 'public.exam_attempts', 'insert'),
  false,
  'authenticated users cannot create attempts directly'
);
select is(
  has_table_privilege('authenticated', 'public.provider_incidents', 'select'),
  false,
  'provider incidents remain backend-only'
);
select is(
  has_table_privilege('service_role', 'public.exam_attempts', 'insert'),
  true,
  'Worker service role can preserve attempts'
);
select throws_ok(
  $$
    insert into public.provider_incidents (
      incident_key, category, safe_message, metadata
    )
    values (
      'unsafe_nested_test', 'unavailable', 'Safe public message.',
      '{"nested":{"student_answer":"must not be stored"}}'::jsonb
    )
  $$,
  '23514',
  null,
  'nested answer content is rejected from incident metadata'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('97000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release2-student@example.invalid','{}','{"full_name":"Release 2 Student"}',
   now(),now(),false,false),
  ('97000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release2-founder@example.invalid','{}','{"full_name":"Release 2 Founder"}',
   now(),now(),false,false),
  ('97000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','release2-other@example.invalid','{}','{"full_name":"Release 2 Other"}',
   now(),now(),false,false);

insert into public.terms_acceptances (
  user_id, terms_version, privacy_version, acceptance_source
)
select id, 'terms-beta-v2-2026-07-28', 'privacy-beta-v2-2026-07-28', 'staging_release2'
from auth.users where id::text like '97000000-%';

insert into public.free_beta_access (
  user_id, enabled, reason, created_by, updated_by
)
values (
  '97000000-0000-4000-8000-000000000001', true,
  'Release 2 staging reliability validation.',
  '97000000-0000-4000-8000-000000000002',
  '97000000-0000-4000-8000-000000000002'
);

create temporary table release2_reservation as
select public.phase4_reserve_grade_v2(
  '97000000-0000-4000-8000-000000000001',
  'release2_grade_request_0001',
  'LAB-001'
) as value;

select is((select (value->>'allowed')::boolean from release2_reservation), true, 'grade is reserved');
select ok(
  (select value->>'reservationId' from release2_reservation) is not null,
  'reservation ID is returned'
);

create temporary table release2_attempt as
select public.phase4_prepare_exam_attempt(
  '97000000-0000-4000-8000-000000000001',
  (select (value->>'reservationId')::uuid from release2_reservation),
  'release2_grade_request_0001',
  'LAB-001',
  'Labor Law',
  'Answer: Yes. Legal Basis: The controlling Labor Code doctrine applies. Application: The exact facts satisfy the stated elements because the employer made continued employment objectively intolerable. Conclusion: Therefore, the employee was constructively dismissed.'
) as value;

select is((select value->>'status' from release2_attempt), 'grading', 'attempt enters grading state');
select is(
  (select count(*) from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  1::bigint,
  'one attempt is stored'
);
select matches(
  (select answer_text from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  '^Answer:',
  'the private attempt preserves the answer'
);

select public.phase4_mark_exam_capacity(
  '97000000-0000-4000-8000-000000000001',
  (select (value->>'attemptId')::uuid from release2_attempt),
  'rate_limit'
);
select is(
  (select status from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  'capacity',
  'capacity status is recorded'
);
select is(
  (select status from public.provider_incidents where incident_key = 'ai_grading_rate_limit'),
  'open',
  'Founder-visible incident opens'
);

select public.phase4_release_grade(
  '97000000-0000-4000-8000-000000000001',
  (select (value->>'reservationId')::uuid from release2_reservation),
  'provider_rate_limit'
);
create temporary table release2_retry as
select public.phase4_reserve_grade_v2(
  '97000000-0000-4000-8000-000000000001',
  'release2_grade_request_0001',
  'LAB-001'
) as value;
select is((select (value->>'allowed')::boolean from release2_retry), true, 'capacity retry is allowed');
select is((select (value->>'replayed')::boolean from release2_retry), true, 'capacity retry is idempotent');

select public.phase4_prepare_exam_attempt(
  '97000000-0000-4000-8000-000000000001',
  (select (value->>'reservationId')::uuid from release2_retry),
  'release2_grade_request_0001',
  'LAB-001',
  'Labor Law',
  'Answer: Yes. Legal Basis: The controlling Labor Code doctrine applies. Application: The exact facts satisfy the stated elements because the employer made continued employment objectively intolerable. Conclusion: Therefore, the employee was constructively dismissed.'
);
select is(
  (select count(*) from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  1::bigint,
  'retry does not duplicate the attempt'
);

select public.phase4_finalize_exam_grade(
  '97000000-0000-4000-8000-000000000001',
  (select (value->>'reservationId')::uuid from release2_retry),
  (select (value->>'attemptId')::uuid from release2_attempt),
  4.2,
  '{"score":4.2,"modelAnswerALAC":{"answer":"Yes","legalBasis":"Rule","application":"Facts","conclusion":"Therefore, yes."}}'::jsonb,
  'staging-model'
);
select is(
  (select status from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  'completed',
  'successful retry completes the attempt'
);
select is(
  (select score from public.exam_attempts where request_key = 'release2_grade_request_0001'),
  4.2::numeric,
  'one-decimal score is preserved'
);
select is(
  (select successful_grades from public.lifetime_grade_usage
   where user_id = '97000000-0000-4000-8000-000000000001'),
  1,
  'only the successful grade is consumed'
);
select is(
  (select status from public.provider_incidents where incident_key = 'ai_grading_rate_limit'),
  'resolved',
  'capacity incident resolves automatically after recovery'
);
select is(
  position('answer' in lower(
    (select metadata::text from public.provider_incidents
     where incident_key = 'ai_grading_rate_limit')
  )),
  0,
  'incident metadata stores no answer'
);

insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status
)
values (
  '97000000-0000-4000-8000-000000000003',
  'release2_other_request_0002',
  'LAB-002', 'Labor Law', 'Other student private answer.', 'failed'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select is(
  (select count(*) from public.exam_attempts),
  1::bigint,
  'student history exposes only the signed-in user attempt'
);
select throws_ok(
  $$
    insert into public.exam_attempts (
      user_id, request_key, question_bank_id, subject, answer_text, status
    )
    values (
      '97000000-0000-4000-8000-000000000001',
      'release2_browser_insert_0003',
      'LAB-003', 'Labor Law', 'Browser-forged answer.', 'completed'
    )
  $$,
  '42501',
  null,
  'student cannot forge an attempt'
);
reset role;

select * from finish();
rollback;
