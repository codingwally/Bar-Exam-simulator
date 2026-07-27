-- Integration security tests for an isolated Supabase test database.
--
-- Prerequisites:
--   1. Apply the repository migrations to a disposable local/test project.
--   2. Install pgTAP in that database.
--   3. Run with `supabase test db`.
--
-- This file is intentionally not run against production.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(58);

select has_column('public', 'profiles', 'school', 'profiles.school exists');
select has_column('public', 'profiles', 'enrollment_status', 'profiles.enrollment_status exists');
select has_column('public', 'profiles', 'year_level', 'profiles.year_level exists');
select has_column('public', 'profiles', 'profile_completed_at', 'profiles.profile_completed_at exists');
select has_column('public', 'profiles', 'updated_at', 'profiles.updated_at exists');

select has_table('public', 'terms_acceptances', 'terms_acceptances exists');
select has_table('public', 'marketing_consents', 'marketing_consents exists');
select has_table('public', 'user_roles', 'user_roles exists');
select has_table('public', 'usage_sessions', 'usage_sessions exists');
select has_table('public', 'usage_events', 'usage_events exists');
select has_table('public', 'user_entitlements', 'user_entitlements exists');
select has_table('public', 'admin_audit_log', 'admin_audit_log exists');
select has_table('public', 'question_corrections', 'Suggest a Correction/Better Answer storage exists');

select policies_are(
  'public',
  'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'profiles expose only own-row policies expected by Phase 1'
);

select policies_are(
  'public',
  'terms_acceptances',
  array['terms_acceptances_select_own'],
  'terms history is owner-readable and RPC-written'
);

select policies_are(
  'public',
  'marketing_consents',
  array['marketing_consents_select_own'],
  'marketing history is owner-readable and RPC-written'
);

select policies_are(
  'public',
  'user_roles',
  array['user_roles_select_own'],
  'students can read only their own role'
);

select policies_are(
  'public',
  'usage_sessions',
  array['usage_sessions_admin_select'],
  'usage sessions are admin-read-only'
);

select policies_are(
  'public',
  'usage_events',
  array['usage_events_admin_select'],
  'usage events are admin-read-only'
);

select policies_are(
  'public',
  'admin_audit_log',
  array['admin_audit_log_super_admin_select'],
  'audit records are super-admin-read-only'
);

select policies_are(
  'public',
  'question_corrections',
  array[]::text[],
  'Suggest a Correction/Better Answer has no direct browser policies'
);

select function_returns(
  'public',
  'current_user_role',
  array[]::text[],
  'text',
  'current_user_role returns a role'
);

select has_function(
  'public',
  'accept_terms',
  array['text', 'text', 'text'],
  'accept_terms RPC exists'
);

select has_function(
  'public',
  'record_marketing_consent',
  array['boolean', 'text', 'text'],
  'record_marketing_consent RPC exists'
);

select has_function(
  'public',
  'complete_profile_onboarding',
  array['text', 'text', 'text', 'text', 'text', 'text'],
  'complete_profile_onboarding RPC exists'
);

select has_function(
  'public',
  'assign_user_role',
  array['uuid', 'text', 'text'],
  'assign_user_role RPC exists'
);

select has_function(
  'public',
  'bootstrap_first_super_admin',
  array['uuid', 'text'],
  'service-only first-super-admin bootstrap exists'
);

select has_function(
  'public',
  'jsonb_has_forbidden_keys',
  array['jsonb', 'text[]'],
  'recursive analytics metadata validator exists'
);

select col_default_is(
  'public',
  'marketing_consents',
  'opted_in',
  'false',
  'marketing consent defaults to false'
);

select col_default_is(
  'public',
  'user_roles',
  'role',
  'student',
  'ordinary users default to student'
);

select isnt(
  has_table_privilege('authenticated', 'public.usage_events', 'INSERT'),
  true,
  'authenticated clients cannot write analytics'
);

select isnt(
  has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT'),
  true,
  'authenticated clients cannot write audit records'
);

select isnt(
  has_table_privilege('authenticated', 'public.user_roles', 'UPDATE'),
  true,
  'authenticated clients cannot assign roles directly'
);

select ok(
  has_table_privilege('service_role', 'public.usage_events', 'INSERT'),
  'trusted service-role operations can write analytics'
);

select ok(
  has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT'),
  'trusted service-role operations can append audit records'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'subscription_tier', 'UPDATE'),
  true,
  'students cannot change subscription_tier'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'subscription_status', 'UPDATE'),
  true,
  'students cannot change subscription_status'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  true,
  'students cannot change profile id'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE'),
  true,
  'students cannot change profile created_at'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'profile_completed_at', 'UPDATE'),
  true,
  'students cannot directly change profile_completed_at'
);

select isnt(
  has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE'),
  true,
  'students cannot directly change profile updated_at'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
  'students may update display_name'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'school', 'UPDATE'),
  'students may update school'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'enrollment_status', 'UPDATE'),
  'students may update enrollment_status'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'year_level', 'UPDATE'),
  'students may update year_level'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('profiles'),
        ('subjects'),
        ('questions'),
        ('submissions'),
        ('grading_results'),
        ('calibration_examples'),
        ('question_corrections')
    ) core(table_name)
    cross join (
      values ('INSERT'), ('UPDATE'), ('DELETE')
    ) operation(privilege_name)
    where has_table_privilege(
      'anon',
      format('public.%I', core.table_name),
      operation.privilege_name
    )
  ),
  'anon has no write privilege on any core table'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('profiles'),
        ('subjects'),
        ('questions'),
        ('submissions'),
        ('grading_results'),
        ('calibration_examples'),
        ('question_corrections')
    ) core(table_name)
    cross join (
      values ('UPDATE'), ('DELETE')
    ) operation(privilege_name)
    where has_table_privilege(
      'authenticated',
      format('public.%I', core.table_name),
      operation.privilege_name
    )
  ),
  'authenticated has no broad UPDATE or DELETE privilege on core tables'
);

select ok(
  has_table_privilege('authenticated', 'public.submissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.question_corrections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.subjects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.questions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.grading_results', 'INSERT')
  and not has_table_privilege('authenticated', 'public.calibration_examples', 'INSERT'),
  'authenticated INSERT is limited to submissions; corrections require the Worker'
);

select ok(
  has_table_privilege('anon', 'public.subjects', 'SELECT')
  and has_table_privilege('anon', 'public.questions', 'SELECT')
  and not has_table_privilege('anon', 'public.profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.submissions', 'SELECT')
  and not has_table_privilege('anon', 'public.grading_results', 'SELECT')
  and not has_table_privilege('anon', 'public.calibration_examples', 'SELECT')
  and not has_table_privilege('anon', 'public.question_corrections', 'SELECT'),
  'anon SELECT is limited to public subjects and questions'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  and has_table_privilege('authenticated', 'public.subjects', 'SELECT')
  and has_table_privilege('authenticated', 'public.questions', 'SELECT')
  and has_table_privilege('authenticated', 'public.submissions', 'SELECT')
  and has_table_privilege('authenticated', 'public.grading_results', 'SELECT')
  and not has_table_privilege('authenticated', 'public.question_corrections', 'SELECT')
  and not has_table_privilege('authenticated', 'public.calibration_examples', 'SELECT'),
  'authenticated SELECT excludes backend-only calibration examples'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('profiles'),
        ('subjects'),
        ('questions'),
        ('submissions'),
        ('grading_results'),
        ('calibration_examples'),
        ('question_corrections')
    ) core(table_name)
    where not has_table_privilege(
      'service_role',
      format('public.%I', core.table_name),
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'service role retains operational access to all core tables'
);

select isnt(
  has_function_privilege(
    'authenticated',
    'public.bootstrap_first_super_admin(uuid, text)',
    'EXECUTE'
  ),
  true,
  'authenticated users cannot execute the super-admin bootstrap'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_first_super_admin(uuid, text)',
    'EXECUTE'
  ),
  'service role can execute the one-time super-admin bootstrap'
);

select isnt(
  has_function_privilege(
    'authenticated',
    'public.jsonb_has_forbidden_keys(jsonb, text[])',
    'EXECUTE'
  ),
  true,
  'browser clients cannot execute the internal metadata validator'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.jsonb_has_forbidden_keys(jsonb, text[])',
    'EXECUTE'
  ),
  'trusted service role can satisfy recursive metadata constraints'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(
      coalesce(c.relacl, acldefault('r', c.relowner))
    ) acl
    where n.nspname = 'public'
      and c.relname in (
        'profiles',
        'subjects',
        'questions',
        'submissions',
        'grading_results',
        'calibration_examples',
        'question_corrections'
      )
      and acl.grantee = 0
  ),
  'no PUBLIC grants remain on any core table'
);

select policies_are(
  'public',
  'submissions',
  array['submissions_insert_own', 'submissions_select_own'],
  'submissions retain only owner-scoped policies'
);

select policies_are(
  'public',
  'grading_results',
  array['grading_results_select_own'],
  'grading results retain only owner-scoped read policy'
);

do $phase1_structural_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%'
       or v_result ilike 'not ok%' then
      raise exception 'PHASE1_STRUCTURAL_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$phase1_structural_finish$;
rollback;
