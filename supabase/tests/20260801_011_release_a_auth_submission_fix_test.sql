-- Release A onboarding regression test. Disposable staging only.
-- Every synthetic record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(8);

select has_function(
  'public',
  'complete_profile_onboarding',
  array['text','text','text','text','text','text'],
  'current profile-onboarding RPC exists'
);

select matches(
  pg_get_functiondef(
    'public.complete_profile_onboarding(text,text,text,text,text,text)'::regprocedure
  ),
  'platform_access_settings',
  'onboarding reads the authoritative current legal versions'
);

select ok(
  position(
    'terms-beta-v1-2026-08-15' in pg_get_functiondef(
      'public.complete_profile_onboarding(text,text,text,text,text,text)'::regprocedure
    )
  ) = 0,
  'onboarding no longer hardcodes the superseded Phase 1 terms version'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_profile_onboarding(text,text,text,text,text,text)',
    'execute'
  ),
  'authenticated users may execute profile onboarding'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.complete_profile_onboarding(text,text,text,text,text,text)',
    'execute'
  ),
  'anonymous users may not execute profile onboarding'
);

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
values (
  'a1000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'release-a-onboarding@example.invalid',
  '{}'::jsonb,
  '{"full_name":"Release A Synthetic Student"}'::jsonb,
  now(),
  now(),
  false,
  false
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $test$
    select public.accept_terms(
      'terms-beta-v2-2026-07-28',
      'privacy-beta-v2-2026-07-28',
      'release_a_staging_test'
    )
  $test$,
  'student can accept the current Phase 4 legal versions'
);

select lives_ok(
  $test$
    select public.complete_profile_onboarding(
      'Release A Synthetic Student',
      'Optional school',
      'not_yet_enrolled',
      '1',
      'terms-beta-v2-2026-07-28',
      'privacy-beta-v2-2026-07-28'
    )
  $test$,
  'onboarding accepts current legal versions and optional not-yet-enrolled fields'
);

select is(
  (
    select profile_completed_at is not null
    from public.profiles
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  true,
  'successful onboarding records profile completion'
);

select * from finish();
rollback;
