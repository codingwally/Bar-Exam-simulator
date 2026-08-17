-- Behavioral Phase 1 security tests for disposable staging only.
-- All synthetic users and records are rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(53);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values
  (
    '10000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'synthetic-a@example.invalid',
    '{}'::jsonb,
    '{"full_name":"Synthetic Student A"}'::jsonb,
    now(),
    now(),
    false,
    false
  ),
  (
    '10000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'synthetic-b@example.invalid',
    '{}'::jsonb,
    '{"full_name":"Synthetic Student B"}'::jsonb,
    now(),
    now(),
    false,
    false
  );

select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'new Auth user A automatically receives a profile'
);
select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'new Auth user B automatically receives a profile'
);
select is(
  (select role from public.user_roles where user_id = '10000000-0000-4000-8000-000000000001'),
  'student',
  'new Auth user A receives the student role'
);
select is(
  (select role from public.user_roles where user_id = '10000000-0000-4000-8000-000000000002'),
  'student',
  'new Auth user B receives the student role'
);

insert into public.subjects (id, name, sort_order)
values ('20000000-0000-4000-8000-000000000001', 'Synthetic Labor Law', 1);

insert into public.questions (
  id,
  subject_id,
  bar_year,
  question_no,
  prompt_text
)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  2026,
  1,
  'Synthetic staging-only question.'
);

insert into public.submissions (
  id,
  user_id,
  question_id,
  answer_text,
  word_count,
  time_spent_seconds
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Synthetic answer A.',
    3,
    60
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    'Synthetic answer B.',
    3,
    90
  );

insert into public.grading_results (
  id,
  submission_id,
  overall_score,
  passed
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    4,
    true
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    2,
    false
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'student can read only their own profile'
);
select lives_ok(
  $test$
    update public.profiles
    set display_name = 'Updated Student A',
        school = 'Synthetic Law School',
        enrollment_status = 'enrolled',
        year_level = '4'
    where id = '10000000-0000-4000-8000-000000000001'
  $test$,
  'student can update approved onboarding fields'
);
select throws_ok(
  $test$
    update public.profiles
    set subscription_tier = 'premium'
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    update public.profiles
    set subscription_status = 'active'
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    update public.profiles
    set id = '10000000-0000-4000-8000-000000000099'
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    update public.profiles
    set created_at = now()
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    update public.profiles
    set profile_completed_at = now()
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    update public.profiles
    set updated_at = now()
    where id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select is(
  (
    select count(*)
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'student cannot read another profile'
);
select is(
  (select count(*) from public.user_roles),
  1::bigint,
  'student can read only their own role'
);
select throws_ok(
  $test$
    update public.user_roles
    set role = 'super_admin'
    where user_id = '10000000-0000-4000-8000-000000000001'
  $test$
);
select is(
  (select count(*) from public.submissions),
  1::bigint,
  'student sees only their own submission'
);
select is(
  (
    select count(*)
    from public.submissions
    where id = '40000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'student cannot read another submission'
);
select is(
  (select count(*) from public.grading_results),
  1::bigint,
  'student sees only their own grading result'
);
select is(
  (
    select count(*)
    from public.grading_results
    where id = '50000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'student cannot read another grading result'
);
select throws_ok(
  $test$
    select count(*) from public.question_corrections
  $test$
);
select throws_ok(
  $test$
    update public.question_corrections
    set status = 'accepted'
  $test$
);
select throws_ok(
  $test$
    delete from public.question_corrections
  $test$
);
select throws_ok(
  $test$
    insert into public.question_corrections (
      question_bank_id,
      subject,
      correction_type,
      proposed_correction,
      explanation,
      user_id,
      source_urls
    )
    values (
      'LAB-001',
      'Labor Law',
      'suggested_answer',
      'A browser must not write this proposed correction.',
      'Suggest a Correction/Better Answer must pass through the Worker.',
      '10000000-0000-4000-8000-000000000001',
      array['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345']
    )
  $test$
);
select throws_ok(
  $test$
    select public.complete_profile_onboarding(
      'Updated Student A',
      'Synthetic Law School',
      'enrolled',
      '4'
    )
  $test$
);
select lives_ok(
  $test$select public.accept_terms()$test$,
  'student can accept the approved Terms and Privacy versions'
);
select lives_ok(
  $test$
    select public.complete_profile_onboarding(
      'Updated Student A',
      'Synthetic Law School',
      'enrolled',
      '4'
    )
  $test$,
  'onboarding completes after approved Terms acceptance'
);
select is(
  (
    select count(*)
    from public.terms_acceptances
    where terms_version = 'terms-beta-v1-2026-08-15'
      and privacy_version = 'privacy-beta-v1-2026-08-15'
      and accepted_at is not null
  ),
  1::bigint,
  'Terms acceptance is versioned and timestamped'
);
select lives_ok(
  $test$select public.record_marketing_consent()$test$,
  'a stale default marketing-consent call is safely absorbed'
);
select lives_ok(
  $test$select public.record_marketing_consent(true)$test$,
  'a stale marketing opt-in call is safely absorbed'
);
select lives_ok(
  $test$select public.record_marketing_consent(false)$test$,
  'a stale marketing withdrawal call is safely absorbed'
);
select is(
  (select count(*) from public.marketing_consents),
  0::bigint,
  'retired marketing-consent calls create no rows'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.record_marketing_consent(boolean,text,text)',
    'EXECUTE'
  ),
  'the compatibility tombstone remains callable by stale authenticated clients'
);
select throws_ok(
  $test$
    insert into public.usage_events (
      session_id,
      user_id,
      event_type
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'question_viewed'
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.admin_audit_log (
      actor_user_id,
      action_type
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'security_setting_changed'
    )
  $test$
);
select throws_ok(
  $test$
    select public.assign_user_role(
      '10000000-0000-4000-8000-000000000001',
      'admin',
      'Unauthorized self-promotion attempt'
    )
  $test$
);

reset role;
set local role service_role;
update public.user_roles
set role = 'admin'
where user_id = '10000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $test$
    select public.assign_user_role(
      '10000000-0000-4000-8000-000000000002',
      'super_admin',
      'Unauthorized admin self-promotion attempt'
    )
  $test$
);

reset role;
set local role service_role;

select lives_ok(
  $test$
    insert into public.question_corrections (
      id,
      question_bank_id,
      subject,
      correction_type,
      proposed_correction,
      explanation,
      source_urls
    )
    values (
      '51000000-0000-4000-8000-000000000001',
      'LAB-001',
      'Labor Law',
      'legal_basis',
      'The legal basis should identify the controlling Labor Code provision.',
      'The proposed citation is more specific and remains subject to editorial review.',
      array['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345']
    )
  $test$,
  'trusted backend can store Suggest a Correction/Better Answer'
);
select lives_ok(
  $test$
    insert into public.usage_sessions (
      id,
      user_id,
      auth_state,
      last_seen_at
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'signed_in',
      now()
    )
  $test$,
  'trusted backend can write usage sessions'
);
select lives_ok(
  $test$
    insert into public.usage_events (
      id,
      session_id,
      user_id,
      event_type,
      subject,
      question_id
    )
    values (
      '70000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'answer_submitted',
      'Labor Law',
      'SYN-001'
    )
  $test$,
  'trusted backend can write usage events without answer text'
);
select lives_ok(
  $test$
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_resource_type,
      target_resource_id
    )
    values (
      '10000000-0000-4000-8000-000000000002',
      'security_setting_changed',
      'synthetic_test',
      'phase-1'
    )
  $test$,
  'trusted backend can append an audit record'
);
select throws_ok(
  $test$
    insert into public.usage_events (
      session_id,
      user_id,
      event_type,
      metadata
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'answer_submitted',
      '{"answer_text":"must not be stored"}'::jsonb
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.usage_events (
      session_id,
      user_id,
      event_type,
      metadata
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'question_viewed',
      '{"raw_ip":"192.0.2.1"}'::jsonb
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.usage_sessions (
      id,
      user_id,
      auth_state,
      metadata
    )
    values (
      '60000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      'signed_in',
      '{"context":{"ip":"192.0.2.1"}}'::jsonb
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.usage_events (
      session_id,
      user_id,
      event_type,
      metadata
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'answer_submitted',
      '{"payload":{"student_answer":"must not be stored"}}'::jsonb
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.usage_events (
      session_id,
      user_id,
      event_type,
      metadata
    )
    values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'question_viewed',
      '{"items":[{"raw_ip":"192.0.2.2"}]}'::jsonb
    )
  $test$
);
select throws_ok(
  $test$
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      details
    )
    values (
      '10000000-0000-4000-8000-000000000002',
      'security_setting_changed',
      '{"context":{"email":"private@example.invalid"}}'::jsonb
    )
  $test$
);
select is(
  (
    select count(*)
    from public.usage_sessions
    where ended_at is null
      and last_seen_at >= now() - interval '5 minutes'
  ),
  1::bigint,
  'active viewers use the approved five-minute heartbeat'
);

reset role;
set local role service_role;
select is(
  (select count(*) from public.admin_audit_log),
  1::bigint,
  'only the trusted audit record was stored'
);
select is(
  (select count(*) from public.user_roles where role = 'super_admin'),
  0::bigint,
  'no founder or super-admin role is seeded'
);
select is(
  (
    select count(*)
    from public.usage_events
    where public.jsonb_has_forbidden_keys(
      metadata,
      array[
        'answer', 'answer_text', 'student_answer', 'submission_text',
        'raw_answer', 'email', 'password', 'token', 'api_key',
        'service_role_key', 'ip', 'ip_address', 'raw_ip'
      ]
    )
  ),
  0::bigint,
  'analytics recursively excludes answer, personal, secret, and IP fields'
);

set local role anon;
select throws_ok(
  $test$
    insert into public.profiles (id, display_name)
    values (
      '10000000-0000-4000-8000-000000000099',
      'Unauthorized anonymous profile'
    )
  $test$
);
select throws_ok(
  $test$
    update public.subjects
    set sort_order = 99
    where id = '20000000-0000-4000-8000-000000000001'
  $test$
);
select throws_ok(
  $test$
    delete from public.questions
    where id = '30000000-0000-4000-8000-000000000001'
  $test$
);

reset role;
do $phase1_behavioral_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%'
       or v_result ilike 'not ok%' then
      raise exception 'PHASE1_BEHAVIORAL_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$phase1_behavioral_finish$;
rollback;
