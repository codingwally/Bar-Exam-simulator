-- Persisted Study Room metadata only. No LiveKit calls, account/billing grants,
-- existing-row adoption, global flags, or changes to existing routines.
-- Access-generation 1 preserves all existing trusted physical room identities.
-- A changed audience advances the generation; old JWTs are NOT revoked and can
-- address only the old, unlisted generation until their existing expiry.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $catalog_prerequisites$
declare v_oid oid;
begin
  if current_user <> 'postgres' or to_regnamespace('private') is null
     or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'STUDY_ROOM_CATALOG_PREREQUISITE';
  end if;
  if to_regclass('private.study_room_catalog') is not null
     or to_regclass('private.study_room_catalog_audit') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','private')
         and p.proname in ('study_room_catalog_v1','study_room_configure_v1')) then
    -- Refuse partial/existing/unknown installations, never overwrite an object.
    raise exception 'STUDY_ROOM_CATALOG_ALREADY_EXISTS';
  end if;
  v_oid := to_regprocedure('public.admin_authorization_context(uuid)');
  if v_oid is null or not exists (select 1 from pg_proc p where p.oid=v_oid
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s'
      and p.proconfig=array['search_path=public, pg_temp']
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      and encode(sha256(convert_to(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),'UTF8')),'hex')=
        '56834a7e84a3d9345447132ad56579d121761ca748e4075ff5904587c1a2c3a9') then
    raise exception 'STUDY_ROOM_ADMIN_PREREQUISITE_DRIFT';
  end if;
end;
$catalog_prerequisites$;

create table private.study_room_catalog (
  room_key smallint primary key check (room_key between 1 and 24),
  label text not null check (char_length(label) between 2 and 64
    and label=btrim(label) and label ~ '^[A-Za-z0-9][A-Za-z0-9 .,''()&_\-]*$'),
  audience text not null check (audience in ('admin','paid','all')),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  access_revision integer not null default 1 check (access_revision between 1 and revision),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint study_room_inner_chamber_admin check (room_key<>5 or audience='admin')
);
alter table private.study_room_catalog enable row level security;
alter table private.study_room_catalog force row level security;
revoke all on table private.study_room_catalog from public,anon,authenticated,service_role;

-- Separate private audit avoids expanding existing administrative action enums
-- or invoking unrelated outbound/financial audit trigger paths.
create table private.study_room_catalog_audit (
  room_key smallint not null references private.study_room_catalog(room_key),
  revision integer not null check (revision>0),
  operation text not null check (operation in ('add','update')),
  actor_user_id uuid references auth.users(id) on delete set null,
  before_value jsonb check (before_value is null or jsonb_typeof(before_value)='object'),
  after_value jsonb not null check (jsonb_typeof(after_value)='object'),
  happened_at timestamptz not null default now(),
  primary key (room_key,revision)
);
alter table private.study_room_catalog_audit enable row level security;
alter table private.study_room_catalog_audit force row level security;
revoke all on table private.study_room_catalog_audit from public,anon,authenticated,service_role;

insert into private.study_room_catalog(room_key,label,audience) values
  (1,'Library','all'),(2,'Room 1','all'),(3,'Room 2','all'),
  (4,'Room 3','all'),(5,'Inner Chamber','admin'),(6,'Room 4','all');

create function private.study_room_catalog_v1()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object('schemaVersion',1,'maxRooms',24,'rooms',
    coalesce(jsonb_agg(jsonb_build_object('roomKey',r.room_key::text,'label',r.label,
      'audience',r.audience,'revision',r.revision,'accessRevision',r.access_revision)
      order by r.room_key),'[]'::jsonb))
  from private.study_room_catalog r;
$function$;

create function private.study_room_configure_v1(
  p_actor_user_id uuid,p_operation text,p_room_key text,p_label text,
  p_audience text,p_expected_revision integer
)
returns jsonb language plpgsql volatile security definer
set search_path = '' set lock_timeout = '3s'
as $function$
declare
  v_role text;
  v_authorization jsonb;
  v_key smallint;
  v_label text;
  v_before private.study_room_catalog%rowtype;
  v_after private.study_room_catalog%rowtype;
begin
  if p_actor_user_id is null then
    raise sqlstate '42501' using message='STUDY_ROOM_ADMIN_REQUIRED';
  end if;
  -- Lock the authoritative role before checking it. A concurrent demotion cannot
  -- commit between this fresh role check and the metadata/audit transaction.
  select role into v_role from public.user_roles
    where user_id=p_actor_user_id for share;
  if v_role is null or v_role not in ('admin','founder_admin','super_admin') then
    raise sqlstate '42501' using message='STUDY_ROOM_ADMIN_REQUIRED';
  end if;
  v_authorization := public.admin_authorization_context(p_actor_user_id);
  if v_authorization->>'authorized' is distinct from 'true'
     or v_authorization->>'role' is distinct from v_role then
    raise sqlstate '42501' using message='STUDY_ROOM_ADMIN_REQUIRED';
  end if;
  if p_operation is null or p_operation not in ('add','update')
     or p_room_key is null or p_room_key !~ '^([1-9]|1[0-9]|2[0-4])$'
     or p_label is null or char_length(p_label)>128
     or p_audience is null or p_audience not in ('admin','paid','all')
     or p_expected_revision is null or p_expected_revision<0 then
    raise sqlstate 'PT400' using message='STUDY_ROOM_CONFIG_INVALID';
  end if;
  v_key := p_room_key::smallint;
  v_label := btrim(p_label);
  if char_length(v_label) not between 2 and 64
     or v_label !~ '^[A-Za-z0-9][A-Za-z0-9 .,''()&_\-]*$'
     or (v_key=5 and p_audience<>'admin')
     or (p_operation='add' and (v_key<7 or p_expected_revision<>0))
     or (p_operation='update' and p_expected_revision<1) then
    raise sqlstate 'PT400' using message='STUDY_ROOM_CONFIG_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('duediligence.study_room.catalog.v1',0));
  select * into v_before from private.study_room_catalog where room_key=v_key for update;
  if p_operation='add' then
    if found then raise sqlstate 'PT409' using message='STUDY_ROOM_CONFIG_CONFLICT'; end if;
    insert into private.study_room_catalog(room_key,label,audience,created_by,updated_by)
      values(v_key,v_label,p_audience,p_actor_user_id,p_actor_user_id) returning * into v_after;
  else
    if not found or v_before.revision<>p_expected_revision then
      raise sqlstate 'PT409' using message='STUDY_ROOM_CONFIG_CONFLICT';
    end if;
    if v_before.label=v_label and v_before.audience=p_audience then
      v_after := v_before;
    else
      if v_before.revision>=2147483646 then
        raise sqlstate 'PT409' using message='STUDY_ROOM_CONFIG_CONFLICT';
      end if;
      update private.study_room_catalog set label=v_label,audience=p_audience,
        revision=revision+1,
        access_revision=access_revision+case when audience is distinct from p_audience then 1 else 0 end,
        updated_at=clock_timestamp(),updated_by=p_actor_user_id
        where room_key=v_key and revision=p_expected_revision returning * into v_after;
      if not found then raise sqlstate 'PT409' using message='STUDY_ROOM_CONFIG_CONFLICT'; end if;
    end if;
  end if;
  if p_operation='add' or v_after.revision<>v_before.revision then
    insert into private.study_room_catalog_audit(room_key,revision,operation,actor_user_id,before_value,after_value)
      values(v_key,v_after.revision,p_operation,p_actor_user_id,
        case when p_operation='add' then null else to_jsonb(v_before) end,to_jsonb(v_after));
  end if;
  return jsonb_build_object('ok',true,'room',jsonb_build_object('roomKey',v_after.room_key::text,
    'label',v_after.label,'audience',v_after.audience,'revision',v_after.revision,
    'accessRevision',v_after.access_revision));
end;
$function$;

create function public.study_room_catalog_v1()
returns jsonb language sql stable security invoker set search_path = ''
as $function$ select private.study_room_catalog_v1(); $function$;

create function public.study_room_configure_v1(
  p_actor_user_id uuid,p_operation text,p_room_key text,p_label text,
  p_audience text,p_expected_revision integer
)
returns jsonb language sql volatile security invoker set search_path = ''
as $function$
  select private.study_room_configure_v1(p_actor_user_id,p_operation,p_room_key,p_label,p_audience,p_expected_revision);
$function$;

revoke all on function private.study_room_catalog_v1(), public.study_room_catalog_v1(),
  private.study_room_configure_v1(uuid,text,text,text,text,integer),
  public.study_room_configure_v1(uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.study_room_catalog_v1(), public.study_room_catalog_v1(),
  private.study_room_configure_v1(uuid,text,text,text,text,integer),
  public.study_room_configure_v1(uuid,text,text,text,text,integer) to service_role;

comment on table private.study_room_catalog is
  'Study Room metadata only. Service RPCs only; no deletes. Key 1 stays silent by trusted runtime identity, key 5 stays admin-only. Audience generations do not revoke old JWTs.';
comment on function public.study_room_configure_v1(uuid,text,text,text,text,integer) is
  'Service transport only; verifies current admin role independently. Explicit key and revision prevent lost updates/duplicate add retries. Worker verifies current generation empty before audience changes.';
commit;
