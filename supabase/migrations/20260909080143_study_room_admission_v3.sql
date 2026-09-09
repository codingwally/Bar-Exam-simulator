-- Local review draft. Do not apply to a hosted database without release approval.
-- Extends the supported persisted Study Room catalog; v1 functions remain intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table private.study_room_catalog drop constraint study_room_catalog_audience_check;
alter table private.study_room_catalog add constraint study_room_catalog_audience_check
  check (audience in ('all','paid','admin','approval'));
alter table private.study_room_catalog alter column audience set default 'all';

create table private.study_room_admissions (
  request_id uuid primary key default gen_random_uuid(),
  room_key smallint not null references private.study_room_catalog(room_key),
  access_revision integer not null check (access_revision > 0),
  user_id uuid references auth.users(id) on delete set null,
  identity text not null check (identity ~ '^sr_[A-Za-z0-9_-]{24}$'),
  nickname text not null check (char_length(nickname) between 2 and 32),
  requested boolean not null default true,
  status text not null check (status in ('pending','approved','denied','cancelled','expired','revoked')),
  version integer not null default 1 check (version > 0),
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  not_before timestamptz not null default statement_timestamp(),
  token_issued_at timestamptz,
  revoke_pending boolean not null default false,
  attempt_window timestamptz not null default clock_timestamp(),
  attempts integer not null default 1 check (attempts between 0 and 3),
  updated_at timestamptz not null default clock_timestamp(),
  unique(room_key,access_revision,identity)
);
create index study_room_admissions_queue on private.study_room_admissions(room_key,access_revision,status,requested_at);
alter table private.study_room_admissions enable row level security;
alter table private.study_room_admissions force row level security;
revoke all on private.study_room_admissions from public,anon,authenticated,service_role;

create table private.study_room_admission_commands (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  room_key smallint not null,
  input jsonb not null,
  result jsonb not null,
  happened_at timestamptz not null default clock_timestamp(),
  primary key(actor_user_id,command_id)
);
alter table private.study_room_admission_commands enable row level security;
alter table private.study_room_admission_commands force row level security;
revoke all on private.study_room_admission_commands from public,anon,authenticated,service_role;

create function private.study_room_admission_json(r private.study_room_admissions)
returns jsonb language sql stable security invoker set search_path=''
as $$ select case when r.request_id is null then null else jsonb_build_object(
  'requestId',r.request_id,'roomKey',r.room_key::text,'accessRevision',r.access_revision,
  'identity',r.identity,'nickname',r.nickname,'status',r.status,'version',r.version,
  'requestedAt',r.requested_at,'expiresAt',r.expires_at,'notBefore',r.not_before,'revokePending',r.revoke_pending) end $$;
revoke all on function private.study_room_admission_json(private.study_room_admissions) from public,anon,authenticated,service_role;

create function private.study_room_admission_v1(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='3s'
as $function$
declare
  v_actor uuid; v_operation text; v_key smallint; v_access integer; v_identity text;
  v_command_id uuid; v_target uuid; v_role text; v_admin boolean := false;
  v_now timestamptz := clock_timestamp(); v_presence timestamptz;
  v_catalog private.study_room_catalog%rowtype; v_row private.study_room_admissions%rowtype;
  v_receipt private.study_room_admission_commands%rowtype; v_result jsonb;
  v_expected integer; v_nickname text; v_target_identity text; v_revoke boolean := false; v_page integer; v_total integer;
begin
  if jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>8192 then
    raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID';
  end if;
  begin
    v_actor := (p_command->>'actor')::uuid;
    v_key := (p_command->>'roomKey')::smallint;
    v_access := (p_command->>'accessRevision')::integer;
    v_expected := (p_command->>'expectedVersion')::integer;
    v_command_id := (p_command->>'commandId')::uuid;
    v_target := (p_command->>'requestId')::uuid;
    v_page := coalesce((p_command->>'page')::integer,0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID';
  end;
  v_operation := p_command->>'operation'; v_identity := p_command->>'identity';
  if v_actor is null or v_key is null or v_key not between 1 and 24 or v_access is null
    or v_identity is null or v_identity !~ '^sr_[A-Za-z0-9_-]{24}$'
    or v_page not between 0 and 100000
    or v_operation is null or v_operation not in ('request','status','cancel','authorize','list','admit','deny','reinstate','revoke','confirm_revocation') then
    raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID';
  end if;
  if not exists(select 1 from auth.users where id=v_actor) then
    raise sqlstate '42501' using message='STUDY_ROOM_SIGN_IN_REQUIRED';
  end if;
  select role into v_role from public.user_roles where user_id=v_actor for share;
  if v_role in ('admin','founder_admin','super_admin') then
    v_admin := coalesce(public.admin_authorization_context(v_actor)->>'authorized'='true',false);
  end if;
  if v_command_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('study-room-command:'||v_actor::text||':'||v_command_id::text,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('study-room-admission:'||v_key::text,0));
  select * into v_catalog from private.study_room_catalog where room_key=v_key for share;
  if not found or v_catalog.access_revision<>v_access then
    raise sqlstate 'PT409' using message='STUDY_ROOM_CONFIG_CONFLICT';
  end if;
  if v_key=5 and not v_admin then raise sqlstate '42501' using message='STUDY_ROOM_ADMIN_ROOM_REQUIRED'; end if;
  -- Only the service transport calls this after the provider confirms removal.
  -- A failed provider call leaves the durable block in place across retries.
  if v_operation='confirm_revocation' then
    select * into v_receipt from private.study_room_admission_commands where actor_user_id=v_actor and command_id=v_command_id;
    if not found or v_receipt.room_key<>v_key or v_receipt.result->>'revokeRequired' is distinct from 'true' then
      raise sqlstate 'PT409' using message='STUDY_ROOM_ADMISSION_CONFLICT';
    end if;
    update private.study_room_admissions set revoke_pending=false
      where request_id=(v_receipt.result->'admission'->>'requestId')::uuid
      and version=(v_receipt.result->'admission'->>'version')::integer;
    return jsonb_build_object('ok',true);
  end if;
  if v_operation in ('list','admit','deny','reinstate','revoke') then
    begin v_presence := (p_command->'presence'->>'checkedAt')::timestamptz;
    exception when others then v_presence := null; end;
    if not v_admin or v_presence is null or v_presence<v_now-interval '10 seconds' or v_presence>v_now+interval '2 seconds'
      or p_command->'presence'->>'identity' is distinct from v_identity
      or p_command->'presence'->>'roomKey' is distinct from v_key::text
      or p_command->'presence'->>'accessRevision' is distinct from v_access::text then
      raise sqlstate '42501' using message='STUDY_ROOM_ADMIN_NOT_PRESENT';
    end if;
  end if;
  if v_operation not in ('status','list','authorize') then
    if v_command_id is null then raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID'; end if;
    select * into v_receipt from private.study_room_admission_commands where actor_user_id=v_actor and command_id=v_command_id;
    if found then
      if v_receipt.input is distinct from (p_command-'presence') then raise sqlstate 'PT409' using message='STUDY_ROOM_COMMAND_CONFLICT'; end if;
      return v_receipt.result;
    end if;
  end if;
  update private.study_room_admissions set status='expired',version=version+1,updated_at=v_now
    where room_key=v_key and access_revision=v_access and status in ('pending','approved') and expires_at<=v_now;
  if v_operation='list' then
    select count(*) into v_total from private.study_room_admissions where room_key=v_key and access_revision=v_access
      and (requested or status='revoked') and (revoke_pending or status in ('pending','approved','denied','revoked'));
    return jsonb_build_object('ok',true,'roomKey',v_key::text,'accessRevision',v_access,'page',v_page,'total',v_total,'hasMore',v_total>(v_page+1)*100,'queue',
      (select coalesce(jsonb_agg(private.study_room_admission_json(q) order by case when q.status='pending' then 0 when q.revoke_pending then 1 when q.status='approved' then 2 else 3 end,q.requested_at,q.request_id),'[]'::jsonb)
       from (select * from private.study_room_admissions where room_key=v_key and access_revision=v_access
         and (requested or status='revoked') and (revoke_pending or status in ('pending','approved','denied','revoked'))
         order by case when status='pending' then 0 when revoke_pending then 1 when status='approved' then 2 else 3 end,requested_at,request_id limit 100 offset v_page*100) q));
  end if;
  if v_operation in ('admit','deny','reinstate') then
    select * into v_row from private.study_room_admissions where request_id=v_target and room_key=v_key and access_revision=v_access for update;
    if not found or v_expected is null or v_expected<>v_row.version then raise sqlstate 'PT409' using message='STUDY_ROOM_ADMISSION_CONFLICT'; end if;
  elsif v_operation='revoke' then
    v_target_identity := p_command->>'targetIdentity';
    if v_target_identity is null or v_target_identity !~ '^sr_[A-Za-z0-9_-]{24}$' or v_target_identity=v_identity then
      raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID';
    end if;
    select * into v_row from private.study_room_admissions where room_key=v_key and access_revision=v_access and identity=v_target_identity for update;
    if not found then
      insert into private.study_room_admissions(room_key,access_revision,identity,nickname,requested,status,expires_at,attempts)
        values(v_key,v_access,v_target_identity,'Participant',false,'revoked',v_now,0) returning * into v_row;
    end if;
  else
    select * into v_row from private.study_room_admissions where room_key=v_key and access_revision=v_access and identity=v_identity for update;
    if found and v_row.user_id is null and v_row.status='cancelled' then
      update private.study_room_admissions set user_id=v_actor where request_id=v_row.request_id returning * into v_row;
    end if;
    if v_row.request_id is not null and (v_row.user_id is null or v_row.user_id<>v_actor) and v_row.status<>'revoked' then
      raise sqlstate '42501' using message='STUDY_ROOM_ADMISSION_FORBIDDEN';
    end if;
  end if;
  if v_operation='status' then return jsonb_build_object('ok',true,'admission',private.study_room_admission_json(v_row)); end if;
  if v_operation='authorize' then
    if v_row.revoke_pending or v_row.status='revoked' or v_row.status='denied' then return jsonb_build_object('ok',true,'allowed',false,'admission',private.study_room_admission_json(v_row)); end if;
    if v_catalog.audience<>'approval' or v_admin then
      if v_row.request_id is null then
        insert into private.study_room_admissions(room_key,access_revision,user_id,identity,nickname,requested,status,expires_at,attempts)
          values(v_key,v_access,v_actor,v_identity,coalesce(p_command->>'nickname','Participant'),false,'approved',v_now+interval '4 hours',0) returning * into v_row;
      elsif v_row.status<>'approved' then
        update private.study_room_admissions set status='approved',expires_at=v_now+interval '4 hours',version=version+1,user_id=v_actor where request_id=v_row.request_id returning * into v_row;
      end if;
    end if;
    if v_row.status is distinct from 'approved' or v_row.expires_at<=v_now or v_row.not_before>v_now
      or (v_expected is not null and v_expected<>v_row.version) then
      return jsonb_build_object('ok',true,'allowed',false,'admission',private.study_room_admission_json(v_row));
    end if;
    update private.study_room_admissions set token_issued_at=v_now where request_id=v_row.request_id;
    return jsonb_build_object('ok',true,'allowed',true,'admission',private.study_room_admission_json(v_row));
  elsif v_operation='request' then
    if v_catalog.audience<>'approval' or v_admin then raise sqlstate 'PT400' using message='STUDY_ROOM_APPROVAL_NOT_REQUIRED'; end if;
    if v_row.revoke_pending then raise sqlstate 'PT409' using message='STUDY_ROOM_REVOCATION_PENDING'; end if;
    v_nickname := p_command->>'nickname';
    if v_nickname is null or char_length(v_nickname) not between 2 and 32 or v_nickname ~ '[<>[:cntrl:]]' then raise sqlstate 'PT400' using message='STUDY_ROOM_ADMISSION_INVALID'; end if;
    if v_row.request_id is null or v_row.status in ('cancelled','expired') then
      if (select count(*) from private.study_room_admissions where room_key=v_key and access_revision=v_access and status='pending')>=50 then
        raise sqlstate 'PT429' using message='STUDY_ROOM_WAITING_CAPACITY';
      end if;
      if v_row.request_id is null then
        insert into private.study_room_admissions(room_key,access_revision,user_id,identity,nickname,status,expires_at)
          values(v_key,v_access,v_actor,v_identity,v_nickname,'pending',v_now+interval '15 minutes') returning * into v_row;
      else
        if v_row.attempt_window>v_now-interval '1 hour' and v_row.attempts>=3 then raise sqlstate 'PT429' using message='STUDY_ROOM_REQUEST_LIMIT'; end if;
        update private.study_room_admissions set status='pending',requested=true,nickname=v_nickname,requested_at=v_now,expires_at=v_now+interval '15 minutes',
          attempts=case when attempt_window<=v_now-interval '1 hour' then 1 else attempts+1 end,
          attempt_window=case when attempt_window<=v_now-interval '1 hour' then v_now else attempt_window end,
          version=version+1 where request_id=v_row.request_id returning * into v_row;
      end if;
    end if;
  elsif v_operation='admit' then
    if v_row.status<>'pending' then raise sqlstate 'PT409' using message='STUDY_ROOM_ADMISSION_CONFLICT'; end if;
    update private.study_room_admissions set status='approved',expires_at=v_now+interval '4 hours',version=version+1,updated_at=v_now where request_id=v_row.request_id returning * into v_row;
  elsif v_operation='reinstate' then
    if v_row.revoke_pending or v_row.status not in ('denied','revoked') then raise sqlstate 'PT409' using message='STUDY_ROOM_ADMISSION_CONFLICT'; end if;
    update private.study_room_admissions set status='cancelled',token_issued_at=null,version=version+1,updated_at=v_now where request_id=v_row.request_id returning * into v_row;
  elsif v_operation in ('cancel','deny','revoke') then
    if v_operation='deny' and v_row.status not in ('pending','approved') then raise sqlstate 'PT409' using message='STUDY_ROOM_ADMISSION_CONFLICT'; end if;
    if v_row.request_id is not null and (v_operation<>'cancel' or v_row.status in ('pending','approved','expired')) then
      v_revoke := v_operation='revoke' or v_row.token_issued_at is not null;
      update private.study_room_admissions set status=case v_operation when 'cancel' then 'cancelled' when 'deny' then 'denied' else 'revoked' end,
        version=version+1,updated_at=v_now,revoke_pending=v_revoke or revoke_pending,
        not_before=case when v_revoke then v_now+interval '61 seconds' else not_before end
        where request_id=v_row.request_id returning * into v_row;
    end if;
  end if;
  v_result := jsonb_build_object('ok',true,'admission',private.study_room_admission_json(v_row),
    'revokeRequired',v_revoke,'revokedAt',case when v_revoke then v_now else null end);
  insert into private.study_room_admission_commands(actor_user_id,command_id,room_key,input,result)
    values(v_actor,v_command_id,v_key,p_command-'presence',v_result);
  return v_result;
end;
$function$;

create function public.study_room_admission_v1(p_command jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select private.study_room_admission_v1(p_command) $$;
revoke all on function private.study_room_admission_v1(jsonb),public.study_room_admission_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.study_room_admission_v1(jsonb),public.study_room_admission_v1(jsonb) to service_role;

create function public.study_room_catalog_v2()
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.study_room_catalog_v1() $$;
revoke all on function public.study_room_catalog_v2() from public,anon,authenticated,service_role;
grant execute on function public.study_room_catalog_v2() to service_role;

create function private.study_room_configure_v2(
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
     or p_audience is null or p_audience not in ('admin','paid','all','approval')
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

create function public.study_room_configure_v2(
  p_actor_user_id uuid,p_operation text,p_room_key text,p_label text,
  p_audience text,p_expected_revision integer
)
returns jsonb language sql volatile security invoker set search_path = ''
as $function$
  select private.study_room_configure_v2(p_actor_user_id,p_operation,p_room_key,p_label,p_audience,p_expected_revision);
$function$;
revoke all on function private.study_room_configure_v2(uuid,text,text,text,text,integer),public.study_room_configure_v2(uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.study_room_configure_v2(uuid,text,text,text,text,integer),public.study_room_configure_v2(uuid,text,text,text,text,integer) to service_role;
commit;
