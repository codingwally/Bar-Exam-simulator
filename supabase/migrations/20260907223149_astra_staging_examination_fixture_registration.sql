-- Optional STAGING infrastructure only; not part of the production product bundle.
-- The caller/deployment coordinator pins the real project. No SQL project GUC is
-- an identity proof. The existing Forecast registrar and audit schema are unchanged.
begin;
do $install_examination_registrar$
declare
  v_target record;
  v_oid oid;
  v_body text;
  v_private text := $private_sql$
create or replace function private.astra_register_staging_examination_fixture(
  p_user_id uuid, p_suite text, p_run_id text, p_label text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_user auth.users%rowtype;
  v_classification private.internal_test_accounts%rowtype;
  v_email text;
  v_name text;
  v_source text;
  v_role text;
begin
  if p_user_id is null or p_suite is null or p_run_id is null or p_label is null then
    raise exception 'Staging examination fixture identity is invalid';
  end if;
  if p_suite = 'examinations-api' and p_run_id ~ '^[a-z0-9]{8,12}-[a-f0-9]{8}$'
     and p_label in ('admin','student-a','student-b') then
    v_email := 'dd-exam-' || p_label || '-' || p_run_id || '@example.com';
    v_name := 'Synthetic ' || p_label;
  elsif p_suite = 'examinations-ui' and p_run_id ~ '^ui-[a-z0-9]{8,12}-[a-f0-9]{8}$'
     and p_label = 'ui-examinee' then
    v_email := 'dd-ui-' || substring(p_run_id from 4) || '@example.com';
    v_name := 'Synthetic Staging UI Examinee';
  else
    raise exception 'Staging examination fixture identity is invalid';
  end if;
  v_source := 'astra_examinations_staging_v1:' || p_suite || ':' || p_run_id || ':' || p_label;
  -- The existing Auth and role row locks fence FK-backed session, billing and
  -- promotion changes while registration commits. No multi-backend proof claimed.
  select * into v_user from auth.users where id=p_user_id for update;
  if not found then raise exception 'Staging examination fixture Auth account is missing'; end if;
  if v_user.email is distinct from v_email
     or v_user.aud is distinct from 'authenticated' or v_user.role is distinct from 'authenticated'
     or coalesce(v_user.is_super_admin,false) or coalesce(v_user.is_anonymous,false)
     or coalesce(v_user.is_sso_user,false) or v_user.deleted_at is not null
     or v_user.email_confirmed_at is null or v_user.created_at is null
     or v_user.created_at < clock_timestamp()-interval '15 minutes'
     or v_user.created_at > clock_timestamp()+interval '1 minute'
     or v_user.raw_app_meta_data->'astra_staging_examination_fixture' is distinct from
       jsonb_build_object('version',1,'suite',p_suite,'runId',p_run_id,'label',p_label)
     or v_user.raw_app_meta_data->>'provider' is distinct from 'email'
     or v_user.raw_app_meta_data->'providers' is distinct from '["email"]'::jsonb
     or v_user.raw_app_meta_data - array['provider','providers','astra_staging_examination_fixture'] is distinct from '{}'::jsonb
     -- Editable full_name preserves the existing honest fixture label. It is not
     -- authorization; the separate exact admin-written marker above is required.
     or v_user.raw_user_meta_data->>'full_name' is distinct from v_name then
    raise exception 'Staging examination fixture trusted identity does not match';
  end if;
  select role::text into v_role from public.user_roles where user_id=p_user_id for update;
  if v_role is distinct from 'student'
     or exists(select 1 from public.admin_capabilities where user_id=p_user_id)
     or exists(select 1 from public.subscriptions where user_id=p_user_id)
     or exists(select 1 from public.payment_requests where user_id=p_user_id)
     or exists(select 1 from public.free_beta_access where user_id=p_user_id)
     or exists(select 1 from public.examination_beta_access where user_id=p_user_id)
     or exists(select 1 from public.examination_participants where user_id=p_user_id)
     or exists(select 1 from public.examination_attempts_multi where user_id=p_user_id)
     or exists(select 1 from public.examination_definitions where created_by=p_user_id) then
    raise exception 'Staging examination fixture must have no privileged or billing state';
  end if;
  if v_user.last_sign_in_at is not null
     or exists(select 1 from auth.sessions where user_id=p_user_id)
     or exists(select 1 from auth.refresh_tokens where user_id=p_user_id::text) then
    raise exception 'Staging examination fixture registration must precede sign-in';
  end if;
  select * into v_classification from private.internal_test_accounts where user_id=p_user_id for update;
  if found then
    if v_classification.email_at_classification is distinct from v_email
       or v_classification.classification_source is distinct from v_source then
      raise exception 'Staging examination fixture classification conflicts with existing evidence';
    end if;
    return jsonb_build_object('registered',true,'fixtureUserId',p_user_id,'dataScope','internal_test',
      'registrationVersion','astra-staging-examination-v1','replayed',true);
  end if;
  if exists(select 1 from private.internal_test_accounts where email_at_classification=v_email) then
    raise exception 'Staging examination fixture classification conflicts with existing evidence';
  end if;
  insert into private.internal_test_accounts(user_id,email_at_classification,classification_source)
    values(p_user_id,v_email,v_source);
  return jsonb_build_object('registered',true,'fixtureUserId',p_user_id,'dataScope','internal_test',
    'registrationVersion','astra-staging-examination-v1','replayed',false);
end;
$function$;
$private_sql$;
  v_public text := $public_sql$
create or replace function public.astra_register_staging_examination_fixture(
  p_user_id uuid, p_suite text, p_run_id text, p_label text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $function$
  select private.astra_register_staging_examination_fixture(p_user_id,p_suite,p_run_id,p_label);
$function$;
$public_sql$;
begin
  if current_user <> 'postgres' or to_regclass('private.internal_test_accounts') is null
     or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'Staging examination registration prerequisite missing';
  end if;
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) g(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) a(privilege)
       where has_table_privilege(g.role_name,'private.internal_test_accounts',a.privilege))
     or exists(select 1 from unnest(array['anon','authenticated','service_role']) g(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) a(privilege)
       where has_any_column_privilege(g.role_name,'private.internal_test_accounts',a.privilege))
     or not exists(select 1 from pg_class where oid='private.internal_test_accounts'::regclass
       and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)='postgres') then
    raise exception 'Staging examination registry protection changed';
  end if;
  -- Compare the exact embedded body and every relevant execution attribute before
  -- replacing either helper. This permits an exact replay, never unknown drift.
  for v_target in select * from (values
    ('private.astra_register_staging_examination_fixture(uuid,text,text,text)',true,'plpgsql',v_private),
    ('public.astra_register_staging_examination_fixture(uuid,text,text,text)',false,'sql',v_public)
  ) t(signature,definer,language_name,definition) loop
    v_oid := to_regprocedure(v_target.signature);
    v_body := split_part(v_target.definition,'$function$',2);
    if v_oid is not null and not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=v_oid and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef=v_target.definer and p.provolatile='v' and l.lanname=v_target.language_name
      and p.prokind='f' and not p.proretset and p.prorettype='jsonb'::regtype
      and not p.proisstrict and not p.proleakproof and p.proparallel='u' and p.prosupport=0
      and p.pronargdefaults=0 and p.provariadic=0
      and p.proargnames=array['p_user_id','p_suite','p_run_id','p_label']
      and p.proconfig=array['search_path=""']
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      and replace(p.prosrc,chr(13)||chr(10),chr(10))=replace(v_body,chr(13)||chr(10),chr(10))) then
      raise exception 'Staging examination registration function collision or drift';
    end if;
  end loop;
  execute v_private;
  execute v_public;
  revoke all on function private.astra_register_staging_examination_fixture(uuid,text,text,text) from public,anon,authenticated,service_role;
  revoke all on function public.astra_register_staging_examination_fixture(uuid,text,text,text) from public,anon,authenticated,service_role;
  grant execute on function private.astra_register_staging_examination_fixture(uuid,text,text,text) to service_role;
  grant execute on function public.astra_register_staging_examination_fixture(uuid,text,text,text) to service_role;
end;
$install_examination_registrar$;
commit;
