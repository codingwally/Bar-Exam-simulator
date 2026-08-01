-- Structural and behavioral coverage for exact-email administrator directory
-- and identity-aware founder response export. Synthetic data rolls back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_function(
  'public', 'admin_user_directory',
  array['uuid','text','integer','integer','text','text'],
  'administrator exact-email directory exists'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_user_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ),
  true,
  'service role can execute the directory RPC'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_user_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers cannot execute the directory directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_user_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute the directory'
);
select has_function(
  'public', 'admin_export_user_responses_with_identity',
  array['uuid','uuid','timestamptz','timestamptz','integer','text','text'],
  'identity-aware founder response export exists'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  true,
  'service role can execute the identity-aware export'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers cannot execute the identity-aware export directly'
);
select is(
  has_function_privilege(
    'anon',
    'public.admin_export_user_responses_with_identity(uuid,uuid,timestamptz,timestamptz,integer,text,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute the identity-aware export'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('9e000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','directory-student@example.invalid','{}','{"full_name":"Directory Student"}',
   now(),now(),false,false),
  ('9e000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','directory-founder@example.invalid','{}','{"full_name":"Directory Founder"}',
   now(),now(),false,false),
  ('9e000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','directory-admin@example.invalid','{}','{"full_name":"Directory Admin"}',
   now(),now(),false,false),
  ('9e000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','directory-incomplete@example.invalid','{}','{"full_name":"Incomplete User"}',
   now(),now(),false,false);

update public.user_roles set role = 'founder_admin'
where user_id = '9e000000-0000-4000-8000-000000000002';
update public.user_roles set role = 'admin'
where user_id = '9e000000-0000-4000-8000-000000000003';
delete from public.profiles
where id = '9e000000-0000-4000-8000-000000000004';

select throws_ok(
  $$
    select public.admin_user_directory(
      '9e000000-0000-4000-8000-000000000001', null, 100, 0,
      'directory_student_denied_0001', 'dashboard'
    )
  $$,
  'P0001',
  'Administrator authorization required',
  'students cannot read the administrator directory'
);
select throws_ok(
  $$
    select public.admin_user_directory(
      '9e000000-0000-4000-8000-000000000003', null, 100, 0,
      'directory_admin_denied_0002', 'dashboard'
    )
  $$,
  'P0001',
  'Learner analytics capability required',
  'ordinary admins without the exact capability cannot read full emails'
);

insert into public.admin_capabilities(user_id, capability, granted_by, reason)
values (
  '9e000000-0000-4000-8000-000000000003',
  'learner_analytics_viewer',
  '9e000000-0000-4000-8000-000000000002',
  'Synthetic exact-email directory authorization'
);

create temporary table directory_result as
select public.admin_user_directory(
  '9e000000-0000-4000-8000-000000000003',
  'directory-student@example.invalid', 100, 0,
  'directory_admin_allowed_0003', 'dashboard'
) as value;

select is(
  (select (value->>'total')::integer from directory_result),
  1,
  'authorized exact-email search returns only the matching account'
);
select is(
  (select value->'items'->0->>'email' from directory_result),
  'directory-student@example.invalid',
  'authorized directory returns the complete email address'
);
select ok(
  (select not (value->'items'->0 ? 'masked_email') from directory_result),
  'directory does not substitute the legacy masked-email field'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = '9e000000-0000-4000-8000-000000000003'
     and target_resource_type = 'admin_user_directory'
     and details->>'requestKey' = 'directory_admin_allowed_0003'),
  1::bigint,
  'full-email directory access creates one audit record'
);
select is(
  (select count(*) from public.admin_audit_log
   where target_resource_type = 'admin_user_directory'
     and details::text ~* 'directory-student@example.invalid'),
  0::bigint,
  'directory audit metadata does not store an email or search value'
);

select lives_ok(
  $$
    select public.admin_user_directory(
      '9e000000-0000-4000-8000-000000000003',
      'directory-student@example.invalid', 100, 0,
      'directory_admin_allowed_0003', 'dashboard'
    )
  $$,
  'retrying the same directory request is safe'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = '9e000000-0000-4000-8000-000000000003'
     and target_resource_type = 'admin_user_directory'
     and details->>'requestKey' = 'directory_admin_allowed_0003'),
  1::bigint,
  'retrying the same directory request does not duplicate its audit record'
);
select throws_ok(
  $$
    select public.admin_user_directory(
      '9e000000-0000-4000-8000-000000000002', null, 100, 0,
      'directory_bad_purpose_0004', 'unsupported'
    )
  $$,
  'P0001',
  'Valid directory access purpose required',
  'directory access purpose is allowlisted'
);

create temporary table incomplete_result as
select public.admin_user_directory(
  '9e000000-0000-4000-8000-000000000002',
  'directory-incomplete@example.invalid', 100, 0,
  'directory_incomplete_0005', 'dashboard'
) as value;
select is(
  (select value->'items'->0->>'email' from incomplete_result),
  'directory-incomplete@example.invalid',
  'registered auth users remain visible even when onboarding has no profile row'
);
select is(
  (select value->'items'->0->>'display_name' from incomplete_result),
  null,
  'incomplete accounts safely retain a missing display name'
);

select throws_ok(
  $$
    select public.admin_export_user_responses_with_identity(
      '9e000000-0000-4000-8000-000000000003',
      '9e000000-0000-4000-8000-000000000001',
      now() - interval '1 day', now() + interval '1 day', 2000,
      'Ordinary admin must not export private responses.',
      'directory_response_denied_0006'
    )
  $$,
  'P0001',
  'Founder administrator authorization required',
  'ordinary administrators cannot use the founder response export wrapper'
);

create temporary table identity_export_result as
select public.admin_export_user_responses_with_identity(
  '9e000000-0000-4000-8000-000000000002',
  '9e000000-0000-4000-8000-000000000001',
  now() - interval '1 day', now() + interval '1 day', 2000,
  'Authorized synthetic founder identity export.',
  'directory_response_allowed_0007'
) as value;
select is(
  (select value->'user'->>'email' from identity_export_result),
  'directory-student@example.invalid',
  'founder response export includes the server-derived exact email'
);
select is(
  (select value->'user'->>'displayName' from identity_export_result),
  'Directory Student',
  'founder response export includes the server-derived display name'
);
select is(
  (select (value->>'total')::integer from identity_export_result),
  0,
  'identity wrapper preserves the underlying response result'
);
select is(
  (select count(*) from public.admin_audit_log
   where actor_user_id = '9e000000-0000-4000-8000-000000000002'
     and target_user_id = '9e000000-0000-4000-8000-000000000001'
     and target_resource_type = 'user_question_answer_export'),
  1::bigint,
  'identity-aware response export preserves the existing targeted audit'
);

select * from finish();
rollback;
