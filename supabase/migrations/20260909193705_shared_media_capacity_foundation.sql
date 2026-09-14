-- Foundation only: no policy or scope rows are installed, no token issuer is
-- changed, and enabled defaults false. One authoritative DB per LiveKit project.
-- The coordinator UUID is an application binding, NOT proof of hosted DB identity.
-- Future reviewed integration must bind actual project/DB/issuers and authenticate
-- users, authorize scopes, validate provider observations and reconcile occupancy.
begin;
create schema if not exists private;

create table private.media_capacity_policies (
  project_id text primary key check(project_id ~ '^p_[a-z0-9]{8,48}$'),
  coordinator_id uuid not null unique,
  revision bigint not null default 1 check(revision>0),
  enabled boolean not null default false,
  hard_cap integer not null default 100 check(hard_cap between 1 and 100),
  reconnect_reserve integer not null default 10 check(reconnect_reserve>=0 and reconnect_reserve<hard_cap),
  external_occupancy integer not null default 100 check(external_occupancy between 0 and 100),
  inventory_valid_until_ms bigint not null default 0,
  budget_valid_until_ms bigint not null default 0,
  budget_seconds bigint not null default 0 check(budget_seconds between 0 and 9007199254740991),
  budget_bytes bigint not null default 0 check(budget_bytes between 0 and 9007199254740991),
  debited_seconds bigint not null default 0 check(debited_seconds>=0 and debited_seconds<=budget_seconds),
  debited_bytes bigint not null default 0 check(debited_bytes>=0 and debited_bytes<=budget_bytes)
);
create table private.media_capacity_scopes (
  project_id text not null references private.media_capacity_policies(project_id),
  scope_key text not null check(scope_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  product text not null check(product in ('study','debate')),
  room_name text not null check(room_name ~ '^[A-Za-z0-9:_-]{8,160}$'),
  event_key text not null check(event_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  session_key text not null check(session_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  enabled boolean not null default false,
  room_cap integer not null check(room_cap between 1 and 100),
  session_cap integer not null check(session_cap between 1 and 100),
  event_cap integer not null check(event_cap between 1 and 100),
  external_occupancy integer not null default 0 check(external_occupancy between 0 and 100),
  max_seconds integer not null default 7200 check(max_seconds between 10 and 21600),
  primary key(project_id,scope_key), unique(project_id,room_name),
  check(product<>'study' or room_cap<=12)
);
create table private.media_capacity_epochs (
  project_id text not null,
  epoch_id uuid not null,
  actor_id uuid not null,
  scope_key text not null,
  identity text not null,
  room_name text not null,
  event_key text not null,
  session_key text not null,
  state text not null default 'reserved' check(state in ('reserved','issued','connected','uncertain','revoking','released')),
  version bigint not null default 1,
  replaces_epoch uuid,
  reserved_seconds integer not null check(reserved_seconds between 10 and 21600),
  reserved_bytes bigint not null check(reserved_bytes between 1 and 9007199254740991),
  created_at_ms bigint not null,
  budget_deadline_ms bigint not null,
  last_mint_at_ms bigint,
  token_expires_at_ms bigint,
  release_command_id uuid,
  release_requested_at_ms bigint,
  release_proof jsonb,
  primary key(project_id,epoch_id),
  foreign key(project_id,scope_key) references private.media_capacity_scopes(project_id,scope_key),
  foreign key(project_id,replaces_epoch) references private.media_capacity_epochs(project_id,epoch_id),
  unique(project_id,identity),
  check(identity='mc-'||epoch_id::text), check(budget_deadline_ms>created_at_ms)
);
create index media_capacity_unreleased on private.media_capacity_epochs(project_id,state) where state<>'released';
create unique index media_capacity_one_replacement on private.media_capacity_epochs(project_id,replaces_epoch) where replaces_epoch is not null and state<>'released';
create table private.media_capacity_commands (
  project_id text not null references private.media_capacity_policies(project_id),
  command_id uuid not null,
  epoch_id uuid not null,
  input jsonb not null,
  created_at_ms bigint not null,
  primary key(project_id,command_id)
);
alter table private.media_capacity_policies enable row level security;
alter table private.media_capacity_scopes enable row level security;
alter table private.media_capacity_epochs enable row level security;
alter table private.media_capacity_commands enable row level security;
revoke all on private.media_capacity_policies,private.media_capacity_scopes,private.media_capacity_epochs,private.media_capacity_commands from public,anon,authenticated,service_role;

create function private.media_capacity_command(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $$
declare
  p private.media_capacity_policies%rowtype; s private.media_capacity_scopes%rowtype;
  e private.media_capacity_epochs%rowtype; prior private.media_capacity_epochs%rowtype;
  saved private.media_capacity_commands%rowtype; proof jsonb;
  project text:=p_command->>'projectId'; operation text:=p_command->>'operation';
  epoch uuid; v_command_id uuid; clock_ms bigint; occupied bigint; actor_epochs bigint;
  seconds integer; bytes bigint; replacing uuid; expected_version bigint; cutoff bigint;
begin
  if p_command is null or jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>8192
    or project is null or project!~'^p_[a-z0-9]{8,48}$'
    or operation is null or operation not in ('read','reserve','mark_issued','mark_connected','mark_uncertain','request_release','confirm_released')
    or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('operation','projectId','coordinatorId','commandId','policyRevision','epochId','actorId','scopeKey','reservedSeconds','reservedBytes','replacesEpoch','expectedVersion','tokenExpiresAtMs','proof')) then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT';
  end if;
  epoch:=(p_command->>'epochId')::uuid;
  if epoch is null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT'; end if;
  -- Every writer takes this lock first. No provider I/O occurs in this transaction.
  select * into p from private.media_capacity_policies where project_id=project for update;
  if not found or p.coordinator_id is distinct from (p_command->>'coordinatorId')::uuid then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_PROJECT_MISMATCH';
  end if;
  clock_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  select * into e from private.media_capacity_epochs where project_id=project and epoch_id=epoch;
  if operation<>'read' then
    v_command_id:=(p_command->>'commandId')::uuid;
    if v_command_id is null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT'; end if;
    select * into saved from private.media_capacity_commands c where c.project_id=project and c.command_id=v_command_id;
    if found then
      if saved.input is distinct from p_command then raise exception using errcode='P0001',message='MEDIA_CAPACITY_IDEMPOTENCY_CONFLICT'; end if;
      -- Return CURRENT epoch and policy, never an obsolete usable grant snapshot.
      return jsonb_build_object('ok',true,'projectId',project,'coordinatorId',p.coordinator_id,'enabled',p.enabled,'policyRevision',p.revision,'replayed',true,'reservation',case when e.epoch_id is null then null else to_jsonb(e) end);
    end if;
    if (p_command->>'policyRevision')::bigint is distinct from p.revision then raise exception using errcode='P0001',message='MEDIA_CAPACITY_POLICY_CHANGED'; end if;
  end if;
  if operation='reserve' then
    if not p.enabled then raise exception using errcode='P0001',message='MEDIA_CAPACITY_DISABLED'; end if;
    if p.inventory_valid_until_ms<=clock_ms then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INVENTORY_STALE'; end if;
    if (select coalesce(sum(x.external_occupancy),0) from private.media_capacity_scopes x where x.project_id=project)>p.external_occupancy then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_INVENTORY_INVALID';
    end if;
    if p.budget_valid_until_ms<=clock_ms or exists(select 1 from private.media_capacity_epochs x where x.project_id=project and x.state<>'released' and x.budget_deadline_ms<=clock_ms) then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_RECONCILIATION_REQUIRED';
    end if;
    if e.epoch_id is not null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_EPOCH_EXISTS'; end if;
    select * into s from private.media_capacity_scopes where project_id=project and scope_key=p_command->>'scopeKey';
    if not found or not s.enabled then raise exception using errcode='P0001',message='MEDIA_CAPACITY_SCOPE_DISABLED'; end if;
    seconds:=(p_command->>'reservedSeconds')::integer; bytes:=(p_command->>'reservedBytes')::bigint;
    if seconds is null or seconds<10 or seconds>s.max_seconds or bytes is null or bytes<1 or bytes>9007199254740991
      or clock_ms+seconds::bigint*1000>p.budget_valid_until_ms or (p_command->>'actorId')::uuid is null then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_INVALID';
    end if;
    if seconds>p.budget_seconds-p.debited_seconds or bytes>p.budget_bytes-p.debited_bytes then raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_LIMIT'; end if;
    select count(*) into actor_epochs from private.media_capacity_epochs x where x.project_id=project and x.actor_id=(p_command->>'actorId')::uuid and x.state<>'released';
    replacing:=(p_command->>'replacesEpoch')::uuid;
    if replacing is not null then
      select * into prior from private.media_capacity_epochs x where x.project_id=project and x.epoch_id=replacing;
      if prior.epoch_id is null or prior.actor_id is distinct from (p_command->>'actorId')::uuid or prior.state not in ('issued','connected','uncertain','revoking') or actor_epochs<>1 then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_REPLACEMENT_INVALID';
      end if;
    elsif actor_epochs<>0 then raise exception using errcode='P0001',message='MEDIA_CAPACITY_HANDOFF_REQUIRED'; end if;
    select count(*)+p.external_occupancy into occupied from private.media_capacity_epochs x where x.project_id=project and x.state<>'released';
    if occupied>=p.hard_cap-(case when replacing is null then p.reconnect_reserve else 0 end) then raise exception using errcode='P0001',message='MEDIA_CAPACITY_PROJECT_LIMIT'; end if;
    if (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.room_name=s.room_name and x.state<>'released')+s.external_occupancy>=s.room_cap
      or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.session_key=s.session_key and x.state<>'released')+
        (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.session_key=s.session_key) >=
        (select min(session_cap) from private.media_capacity_scopes x where x.project_id=project and x.session_key=s.session_key)
      or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.event_key=s.event_key and x.state<>'released')+
        (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.event_key=s.event_key) >=
        (select min(event_cap) from private.media_capacity_scopes x where x.project_id=project and x.event_key=s.event_key) then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_ROOM_LIMIT';
    end if;
    insert into private.media_capacity_epochs(project_id,epoch_id,actor_id,scope_key,identity,room_name,event_key,session_key,replaces_epoch,reserved_seconds,reserved_bytes,created_at_ms,budget_deadline_ms)
      values(project,epoch,(p_command->>'actorId')::uuid,s.scope_key,'mc-'||epoch::text,s.room_name,s.event_key,s.session_key,replacing,seconds,bytes,clock_ms,clock_ms+seconds::bigint*1000) returning * into e;
    -- Admission budgets are conservatively debited without automatic refunds.
    update private.media_capacity_policies set debited_seconds=debited_seconds+seconds,debited_bytes=debited_bytes+bytes where project_id=project;
  elsif operation<>'read' then
    expected_version:=(p_command->>'expectedVersion')::bigint;
    if e.epoch_id is null or expected_version is distinct from e.version then raise exception using errcode='P0001',message='MEDIA_CAPACITY_VERSION_CONFLICT'; end if;
    if operation in ('mark_issued','mark_connected') then
      select * into s from private.media_capacity_scopes where project_id=project and scope_key=e.scope_key;
      if not found or not s.enabled or s.room_name is distinct from e.room_name or s.event_key is distinct from e.event_key or s.session_key is distinct from e.session_key then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      if not p.enabled or p.inventory_valid_until_ms<=clock_ms or p.budget_valid_until_ms<=clock_ms or e.state not in ('reserved','issued','connected') or e.budget_deadline_ms<=clock_ms then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      -- The epoch is already counted: use >, not >=. A new policy/inventory
      -- observation can invalidate a reserved grant before asynchronous signing.
      if (select coalesce(sum(x.external_occupancy),0) from private.media_capacity_scopes x where x.project_id=project)>p.external_occupancy
        or exists(select 1 from private.media_capacity_epochs x where x.project_id=project and x.state<>'released' and x.budget_deadline_ms<=clock_ms)
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.state<>'released')+p.external_occupancy>p.hard_cap
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.room_name=e.room_name and x.state<>'released')+s.external_occupancy>s.room_cap
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.session_key=e.session_key and x.state<>'released')+
          (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.session_key=e.session_key)>
          (select min(session_cap) from private.media_capacity_scopes x where x.project_id=project and x.session_key=e.session_key)
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.event_key=e.event_key and x.state<>'released')+
          (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.event_key=e.event_key)>
          (select min(event_cap) from private.media_capacity_scopes x where x.project_id=project and x.event_key=e.event_key) then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED';
      end if;
      if operation='mark_issued' then
        if (p_command->>'tokenExpiresAtMs')::bigint is null or (p_command->>'tokenExpiresAtMs')::bigint<=clock_ms or (p_command->>'tokenExpiresAtMs')::bigint>least(clock_ms+30000,e.budget_deadline_ms,p.budget_valid_until_ms) then raise exception using errcode='P0001',message='MEDIA_CAPACITY_TOKEN_DEADLINE'; end if;
        e.last_mint_at_ms:=clock_ms; e.token_expires_at_ms:=(p_command->>'tokenExpiresAtMs')::bigint;
        if e.state<>'connected' then e.state:='issued'; end if;
      else
        if e.state<>'issued' then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
        e.state:='connected';
      end if;
    elsif operation='mark_uncertain' then
      if e.state='released' then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      e.state:='uncertain';
    elsif operation='request_release' then
      if e.state in ('released','revoking') or e.release_command_id is not null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_RELEASE_ALREADY_REQUESTED'; end if;
      e.state:='revoking'; e.release_command_id:=v_command_id; e.release_requested_at_ms:=clock_ms;
    elsif operation='confirm_released' then
      proof:=p_command->'proof'; cutoff:=(proof->>'cutoffSeconds')::bigint;
      if e.state not in ('revoking','uncertain') or e.release_command_id is null or proof is null or jsonb_typeof(proof)<>'object'
        or exists(select 1 from jsonb_object_keys(proof) k where k not in ('releaseCommandId','projectId','roomName','identity','revocationAcknowledged','absent','cutoffSeconds','acknowledgedAtMs','observedAtMs'))
        or (proof->>'releaseCommandId')::uuid is distinct from e.release_command_id or proof->>'projectId' is distinct from project
        or proof->>'roomName' is distinct from e.room_name or proof->>'identity' is distinct from e.identity
        or proof->'revocationAcknowledged' is distinct from 'true'::jsonb or proof->'absent' is distinct from 'true'::jsonb
        or cutoff is null or cutoff<=greatest(e.release_requested_at_ms,coalesce(e.last_mint_at_ms,0))/1000
        or cutoff*1000>clock_ms+2000
        or (proof->>'acknowledgedAtMs')::bigint is null or (proof->>'acknowledgedAtMs')::bigint<e.release_requested_at_ms
        or abs(cutoff*1000-(proof->>'acknowledgedAtMs')::bigint)>60000
        or (proof->>'observedAtMs')::bigint is null or (proof->>'observedAtMs')::bigint<(proof->>'acknowledgedAtMs')::bigint
        or (proof->>'observedAtMs')::bigint>clock_ms or (proof->>'observedAtMs')::bigint<clock_ms-15000 then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_FENCE_UNCONFIRMED';
      end if;
      -- The authorized coordinator attests provider evidence. SQL validates its
      -- exact binding/freshness; it does NOT independently contact LiveKit.
      e.state:='released'; e.release_proof:=proof;
    end if;
    e.version:=e.version+1;
    update private.media_capacity_epochs set state=e.state,version=e.version,last_mint_at_ms=e.last_mint_at_ms,token_expires_at_ms=e.token_expires_at_ms,
      release_command_id=e.release_command_id,release_requested_at_ms=e.release_requested_at_ms,release_proof=e.release_proof where project_id=project and epoch_id=epoch;
  end if;
  if operation<>'read' then insert into private.media_capacity_commands values(project,v_command_id,epoch,p_command,clock_ms); end if;
  return jsonb_build_object('ok',true,'projectId',project,'coordinatorId',p.coordinator_id,'enabled',p.enabled,'policyRevision',p.revision,'replayed',false,'reservation',case when e.epoch_id is null then null else to_jsonb(e) end);
exception
  when sqlstate 'P0001' then
    if sqlerrm!~'^MEDIA_CAPACITY_[A-Z_]+$' then raise; end if;
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code',sqlerrm));
  when data_exception then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','MEDIA_CAPACITY_INPUT'));
end;
$$;
create function public.media_capacity_command(p_command jsonb) returns jsonb
language sql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s'
as $$ select private.media_capacity_command(p_command); $$;
revoke all on function private.media_capacity_command(jsonb),public.media_capacity_command(jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.media_capacity_command(jsonb),public.media_capacity_command(jsonb) to service_role;
comment on function public.media_capacity_command(jsonb) is 'Disabled, unintegrated shared media reservation foundation. Server-only trusted coordinator; provider proof is externally validated. No billing or token issuance guarantee.';
commit;
