-- Optional STAGING infrastructure, installed separately from the product bundle.
-- There is no trusted SQL project-ref setting. The coordinator must select the
-- staging project, and the CI caller remains hard-pinned to that project's URL.
-- This does not enable a production fixture mode, grant access, or change roles.
begin;

-- Refuse unknown name collisions or broadened registry permissions. An exact
-- existing installation may be replayed; LF/CRLF normalization is ONLY for the
-- installed-definition comparison, not a license to replace different code.
do $registration_prerequisites$
declare v_target record; v_oid oid;
begin
  if current_user <> 'postgres'
     or to_regclass('private.internal_test_accounts') is null
     or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'Staging registration deployment prerequisite missing';
  end if;
  if exists(select 1
       from unnest(array['anon','authenticated','service_role']) as grantee(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as permission(privilege)
       where has_table_privilege(grantee.role_name,'private.internal_test_accounts',permission.privilege))
     or exists(select 1
       from unnest(array['anon','authenticated','service_role']) as grantee(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as permission(privilege)
       where has_any_column_privilege(grantee.role_name,'private.internal_test_accounts',permission.privilege))
     or not exists(select 1 from pg_class where oid='private.internal_test_accounts'::regclass
       and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)='postgres') then
    raise exception 'Staging registration registry protection changed';
  end if;
  for v_target in select * from (values
    ('private.astra_register_staging_forecast_fixture(uuid,text,text)',true,
      '293d6d0d4a11d07e97b33aa3d74fef3a0936f3b22bc383679d1bf611e2f0704e'),
    ('public.astra_register_staging_forecast_fixture(uuid,text,text)',false,
      'e0e9a72790932bf77cd241153b5a95d8f173d82c4e0d2e4075bcc139d689b381')
  ) t(signature,definer,definition_hash) loop
    v_oid:=to_regprocedure(v_target.signature);
    if v_oid is not null and not exists(select 1 from pg_proc p where p.oid=v_oid
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef=v_target.definer
      and p.provolatile='v' and p.proconfig=array['search_path=""']
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      and encode(sha256(convert_to(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),'UTF8')),'hex')=v_target.definition_hash) then
      raise exception 'Staging registration function collision or drift';
    end if;
  end loop;
end;
$registration_prerequisites$;

create or replace function private.astra_register_staging_forecast_fixture(
  p_user_id uuid, p_fixture_prefix text, p_fixture_kind text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user auth.users%rowtype;
  v_classification private.internal_test_accounts%rowtype;
  v_email text;
  v_source text;
  v_role text;
begin
  if p_user_id is null or p_fixture_prefix is null
     or p_fixture_prefix !~ '^astra-durable-[0-9]{13}-[a-f0-9]{8}$'
     or p_fixture_kind is null or p_fixture_kind not in ('member','other','unpaid') then
    raise exception 'Staging fixture identity is invalid';
  end if;
  v_email := p_fixture_prefix || '-' || p_fixture_kind || '@example.com';
  v_source := 'astra_durable_staging_v1:' || p_fixture_prefix || ':' || p_fixture_kind;

  -- Also serializes registration of the same account. The parent Auth row lock
  -- fences concurrent FK-backed session/billing inserts and role changes until
  -- classification commits. No concurrent-connection proof is claimed here.
  select * into v_user from auth.users where id=p_user_id for update;
  if not found then raise exception 'Staging fixture Auth account is missing'; end if;
  if v_user.email is distinct from v_email
     or v_user.aud is distinct from 'authenticated' or v_user.role is distinct from 'authenticated'
     or coalesce(v_user.is_super_admin,false) or coalesce(v_user.is_anonymous,false)
     or coalesce(v_user.is_sso_user,false) or v_user.deleted_at is not null
     or v_user.email_confirmed_at is null or v_user.created_at is null
     or v_user.created_at < clock_timestamp()-interval '15 minutes'
     or v_user.created_at > clock_timestamp()+interval '1 minute'
     or v_user.raw_app_meta_data->'astra_staging_fixture' is distinct from
       jsonb_build_object('version',1,'prefix',p_fixture_prefix,'kind',p_fixture_kind)
     or v_user.raw_app_meta_data->>'provider' is distinct from 'email'
     or v_user.raw_app_meta_data->'providers' is distinct from '["email"]'::jsonb
     or v_user.raw_app_meta_data - array['provider','providers','astra_staging_fixture'] is distinct from '{}'::jsonb
     -- These editable markers are only the existing cleanup contract. The
     -- independent admin-written app_metadata marker above is mandatory.
     or v_user.raw_user_meta_data->>'astra_fixture_prefix' is distinct from p_fixture_prefix
     or v_user.raw_user_meta_data->>'internal_test' is distinct from 'true' then
    raise exception 'Staging fixture trusted identity does not match';
  end if;

  select role::text into v_role from public.user_roles where user_id=p_user_id for update;
  if v_role is distinct from 'student'
     or exists(select 1 from public.admin_capabilities where user_id=p_user_id)
     or exists(select 1 from public.subscriptions where user_id=p_user_id)
     or exists(select 1 from public.payment_requests where user_id=p_user_id)
     or exists(select 1 from public.free_beta_access where user_id=p_user_id) then
    raise exception 'Staging fixture must have no privileged or billing state';
  end if;
  if v_user.last_sign_in_at is not null
     or exists(select 1 from auth.sessions where user_id=p_user_id)
     or exists(select 1 from auth.refresh_tokens where user_id=p_user_id::text) then
    raise exception 'Staging fixture registration must precede sign-in';
  end if;

  select * into v_classification from private.internal_test_accounts
    where user_id=p_user_id for update;
  if found then
    if v_classification.email_at_classification is distinct from v_email
       or v_classification.classification_source is distinct from v_source then
      raise exception 'Staging fixture classification conflicts with existing evidence';
    end if;
    return jsonb_build_object('registered',true,'fixtureUserId',p_user_id,
      'dataScope','internal_test','registrationVersion','astra-staging-forecast-v1','replayed',true);
  end if;
  if exists(select 1 from private.internal_test_accounts where email_at_classification=v_email) then
    raise exception 'Staging fixture classification conflicts with existing evidence';
  end if;
  insert into private.internal_test_accounts(user_id,email_at_classification,classification_source)
    values(p_user_id,v_email,v_source);
  return jsonb_build_object('registered',true,'fixtureUserId',p_user_id,
    'dataScope','internal_test','registrationVersion','astra-staging-forecast-v1','replayed',false);
end;
$function$;

create or replace function public.astra_register_staging_forecast_fixture(
  p_user_id uuid, p_fixture_prefix text, p_fixture_kind text
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.astra_register_staging_forecast_fixture(p_user_id,p_fixture_prefix,p_fixture_kind);
$function$;

revoke all on function private.astra_register_staging_forecast_fixture(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.astra_register_staging_forecast_fixture(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.astra_register_staging_forecast_fixture(uuid,text,text) to service_role;
grant execute on function public.astra_register_staging_forecast_fixture(uuid,text,text) to service_role;
-- No schema exposure, schema grant, table grant, policy, or role change.
comment on function public.astra_register_staging_forecast_fixture(uuid,text,text) is
  'Service-only pre-sign-in registration of freshly admin-created Astra durable staging fixtures. Does not prove database project identity or grant product access.';
commit;
