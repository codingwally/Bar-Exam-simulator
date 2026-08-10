-- Behavioral coverage for exact stable user-ID lookup in the authorized
-- administrator directory. All synthetic records roll back.
begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_function(
  'public', 'admin_user_directory',
  array['uuid','text','integer','integer','text','text'],
  'administrator directory function remains available'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_user_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ),
  true,
  'service role retains directory execution access'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_user_directory(uuid,text,integer,integer,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers remain unable to execute the directory directly'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('9f000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','uuid-student@example.invalid','{}','{"full_name":"UUID Student"}',
   now(),now(),false,false),
  ('9f000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','uuid-founder@example.invalid','{}','{"full_name":"UUID Founder"}',
   now(),now(),false,false);

update public.user_roles set role = 'founder_admin'
where user_id = '9f000000-0000-4000-8000-000000000002';

create temporary table uuid_directory_result as
select public.admin_user_directory(
  '9f000000-0000-4000-8000-000000000002',
  '9f000000-0000-4000-8000-000000000001',
  100,
  0,
  'directory_uuid_search_0001',
  'dashboard'
) as value;

select is(
  (select (value->>'total')::integer from uuid_directory_result),
  1,
  'exact UUID search returns one matching account'
);
select is(
  (select value->'items'->0->>'id' from uuid_directory_result),
  '9f000000-0000-4000-8000-000000000001',
  'exact UUID search returns the requested stable user ID'
);
select is(
  (select value->'items'->0->>'email' from uuid_directory_result),
  'uuid-student@example.invalid',
  'exact UUID search preserves permitted directory details'
);

select lives_ok(
  $$
    select public.admin_user_directory(
      '9f000000-0000-4000-8000-000000000002',
      'not-a-uuid',
      100,
      0,
      'directory_uuid_invalid_0002',
      'dashboard'
    )
  $$,
  'non-UUID search text remains safe and uses existing partial matching'
);

select * from finish();
rollback;
