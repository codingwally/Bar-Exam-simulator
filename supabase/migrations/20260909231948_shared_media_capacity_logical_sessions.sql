-- Inactive capacity-only successor. No issuer integration, policy seed or provider calls.
-- Existing foundation state is deliberately unsupported: install only before bootstrap.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table private.media_capacity_policies,private.media_capacity_scopes,private.media_capacity_epochs,private.media_capacity_commands in access exclusive mode;
do $$ begin
  if exists(select 1 from private.media_capacity_policies) or exists(select 1 from private.media_capacity_scopes)
    or exists(select 1 from private.media_capacity_epochs) or exists(select 1 from private.media_capacity_commands) then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_UPGRADE_REQUIRES_EMPTY_FOUNDATION';
  end if;
end $$;
alter table private.media_capacity_scopes add column issuer_id text not null check(issuer_id in ('production','staging'));
create table private.media_capacity_logical_sessions (
  project_id text not null references private.media_capacity_policies(project_id),
  logical_session_id uuid not null, issuer_id text not null check(issuer_id in ('production','staging')),
  actor_id uuid not null, product text not null check(product in ('study','debate')),
  event_key text not null check(event_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  session_key text not null check(session_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  state text not null default 'open' check(state in ('open','closed')),
  version bigint not null default 1 check(version>0),
  created_at_ms bigint not null, funded_deadline_ms bigint not null,
  allocated_seconds integer not null check(allocated_seconds between 10 and 21600), last_epoch_id uuid not null,
  primary key(project_id,logical_session_id),
  check(funded_deadline_ms=created_at_ms+allocated_seconds::bigint*1000)
);
create unique index media_capacity_one_logical_device on private.media_capacity_logical_sessions(project_id,issuer_id,product,session_key,actor_id) where state='open';
alter table private.media_capacity_epochs
  add column issuer_id text not null check(issuer_id in ('production','staging')),
  add column product text not null check(product in ('study','debate')),
  add column logical_session_id uuid not null,
  add foreign key(project_id,logical_session_id) references private.media_capacity_logical_sessions(project_id,logical_session_id);
alter table private.media_capacity_logical_sessions enable row level security;
revoke all on private.media_capacity_logical_sessions from public,anon,authenticated,service_role;

create or replace function private.media_capacity_command(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $$
declare
  p private.media_capacity_policies%rowtype; s private.media_capacity_scopes%rowtype;
  e private.media_capacity_epochs%rowtype; prior private.media_capacity_epochs%rowtype;
  saved private.media_capacity_commands%rowtype; proof jsonb;
  logical private.media_capacity_logical_sessions%rowtype; logical_id uuid; actor uuid;
  issuer text:=p_command->>'issuerId'; product_name text:=p_command->>'product'; new_logical boolean;
  project text:=p_command->>'projectId'; operation text:=p_command->>'operation';
  epoch uuid; v_command_id uuid; clock_ms bigint; occupied bigint;
  seconds integer; bytes bigint; replacing uuid; expected_version bigint; cutoff bigint;
begin
  if p_command is null or jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>8192
    or project is null or project!~'^p_[a-z0-9]{8,48}$'
    or operation is null or operation not in ('read','reserve','mark_issued','mark_connected','mark_uncertain','request_release','confirm_released','close_session')
    or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('operation','projectId','coordinatorId','issuerId','product','logicalSessionId','commandId','policyRevision','epochId','actorId','scopeKey','reservedSeconds','reservedBytes','replacesEpoch','expectedVersion','tokenExpiresAtMs','proof')) then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT';
  end if;
  if issuer is null or issuer not in ('production','staging') or product_name is null or product_name not in ('study','debate') then raise exception using errcode='P0001',message='MEDIA_CAPACITY_ISSUER_REQUIRED'; end if;
  logical_id:=(p_command->>'logicalSessionId')::uuid; actor:=(p_command->>'actorId')::uuid;
  if logical_id is null or actor is null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT'; end if;
  epoch:=(p_command->>'epochId')::uuid;
  if epoch is null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT'; end if;
  -- Every writer takes this lock first. No provider I/O occurs in this transaction.
  select * into p from private.media_capacity_policies where project_id=project for update;
  if not found or p.coordinator_id is distinct from (p_command->>'coordinatorId')::uuid then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_PROJECT_MISMATCH';
  end if;
  clock_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  select * into e from private.media_capacity_epochs where project_id=project and epoch_id=epoch;
  select * into logical from private.media_capacity_logical_sessions where project_id=project and logical_session_id=logical_id;
  if (logical.logical_session_id is not null and (logical.issuer_id is distinct from issuer or logical.actor_id is distinct from actor or logical.product is distinct from product_name))
    or (e.epoch_id is not null and (e.issuer_id is distinct from issuer or e.actor_id is distinct from actor or e.product is distinct from product_name or e.logical_session_id is distinct from logical_id)) then
    raise exception using errcode='P0001',message='MEDIA_CAPACITY_SUBJECT_MISMATCH';
  end if;
  if operation<>'read' then
    v_command_id:=(p_command->>'commandId')::uuid;
    if v_command_id is null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_INPUT'; end if;
    select * into saved from private.media_capacity_commands c where c.project_id=project and c.command_id=v_command_id;
    if found then
      if saved.input is distinct from p_command then raise exception using errcode='P0001',message='MEDIA_CAPACITY_IDEMPOTENCY_CONFLICT'; end if;
      -- Return CURRENT epoch and policy, never an obsolete usable grant snapshot.
      return jsonb_build_object('ok',true,'projectId',project,'coordinatorId',p.coordinator_id,'enabled',p.enabled,'policyRevision',p.revision,'replayed',true,'reservation',case when e.epoch_id is null then null else to_jsonb(e) end,'logicalSession',case when logical.logical_session_id is null then null else to_jsonb(logical) end);
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
    if s.issuer_id is distinct from issuer or s.product is distinct from product_name then raise exception using errcode='P0001',message='MEDIA_CAPACITY_SUBJECT_MISMATCH'; end if;
    seconds:=(p_command->>'reservedSeconds')::integer; bytes:=(p_command->>'reservedBytes')::bigint;
    if seconds is null or seconds<10 or seconds>s.max_seconds or bytes is null or bytes<1 or bytes>9007199254740991 then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_INVALID';
    end if;
    replacing:=(p_command->>'replacesEpoch')::uuid;
    new_logical:=logical.logical_session_id is null;
    if new_logical then
      if replacing is not null then raise exception using errcode='P0001',message='MEDIA_CAPACITY_REPLACEMENT_INVALID'; end if;
      if exists(select 1 from private.media_capacity_logical_sessions x where x.project_id=project and x.issuer_id=issuer
        and x.product=product_name and x.session_key=s.session_key and x.actor_id=actor and x.state='open') then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_HANDOFF_REQUIRED';
      end if;
      if clock_ms+seconds::bigint*1000>p.budget_valid_until_ms then raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_INVALID'; end if;
      if seconds>p.budget_seconds-p.debited_seconds then raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_LIMIT'; end if;
    else
      if logical.state<>'open' or logical.event_key is distinct from s.event_key or logical.session_key is distinct from s.session_key
        or logical.allocated_seconds is distinct from seconds or logical.funded_deadline_ms<=clock_ms
        or logical.funded_deadline_ms>p.budget_valid_until_ms then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_LOGICAL_BINDING';
      end if;
      select * into prior from private.media_capacity_epochs x where x.project_id=project and x.epoch_id=replacing;
      -- Sequential reuse only: no guessed overlap, no TTL credit, no bypass via another logical id.
      if replacing is null or prior.epoch_id is null or logical.last_epoch_id is distinct from replacing
        or prior.logical_session_id is distinct from logical_id or prior.actor_id is distinct from actor
        or prior.issuer_id is distinct from issuer or prior.product is distinct from product_name
        or prior.state<>'released' or prior.release_proof is null
        or exists(select 1 from private.media_capacity_epochs x where x.project_id=project and x.logical_session_id=logical_id and x.state<>'released') then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_PREDECESSOR_UNFENCED';
      end if;
    end if;
    -- Bytes remain a conservative per-physical debit; no unmeasured byte credit.
    if bytes>p.budget_bytes-p.debited_bytes then raise exception using errcode='P0001',message='MEDIA_CAPACITY_BUDGET_LIMIT'; end if;
    select count(*)+p.external_occupancy into occupied from private.media_capacity_epochs x where x.project_id=project and x.state<>'released';
    if occupied>=p.hard_cap-p.reconnect_reserve then raise exception using errcode='P0001',message='MEDIA_CAPACITY_PROJECT_LIMIT'; end if;
    if (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.room_name=s.room_name and x.state<>'released')+s.external_occupancy>=s.room_cap
      or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=s.session_key and x.state<>'released')+
        (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=s.session_key) >=
        (select min(session_cap) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=s.session_key)
      or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=s.event_key and x.state<>'released')+
        (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=s.event_key) >=
        (select min(event_cap) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=s.event_key) then
      raise exception using errcode='P0001',message='MEDIA_CAPACITY_ROOM_LIMIT';
    end if;
    if new_logical then
      insert into private.media_capacity_logical_sessions(project_id,logical_session_id,issuer_id,actor_id,product,event_key,session_key,created_at_ms,funded_deadline_ms,allocated_seconds,last_epoch_id)
        values(project,logical_id,issuer,actor,product_name,s.event_key,s.session_key,clock_ms,clock_ms+seconds::bigint*1000,seconds,epoch) returning * into logical;
    else
      update private.media_capacity_logical_sessions set last_epoch_id=epoch,version=version+1 where project_id=project and logical_session_id=logical_id returning * into logical;
    end if;
    insert into private.media_capacity_epochs(project_id,epoch_id,actor_id,scope_key,identity,room_name,event_key,session_key,replaces_epoch,reserved_seconds,reserved_bytes,created_at_ms,budget_deadline_ms,issuer_id,product,logical_session_id)
      values(project,epoch,actor,s.scope_key,'mc-'||epoch::text,s.room_name,s.event_key,s.session_key,replacing,seconds,bytes,clock_ms,logical.funded_deadline_ms,issuer,product_name,logical_id) returning * into e;
    -- One immutable logical time debit, no refund; every new physical epoch still debits bytes.
    update private.media_capacity_policies set debited_seconds=debited_seconds+(case when new_logical then seconds else 0 end),debited_bytes=debited_bytes+bytes where project_id=project;
  elsif operation<>'read' then
    expected_version:=(p_command->>'expectedVersion')::bigint;
    if logical.logical_session_id is null or e.epoch_id is null or expected_version is distinct from e.version then raise exception using errcode='P0001',message='MEDIA_CAPACITY_VERSION_CONFLICT'; end if;
    if operation in ('mark_issued','mark_connected') then
      select * into s from private.media_capacity_scopes where project_id=project and scope_key=e.scope_key;
      if logical.state<>'open' or logical.last_epoch_id is distinct from epoch or logical.funded_deadline_ms is distinct from e.budget_deadline_ms then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      if not found or not s.enabled or s.issuer_id is distinct from issuer or s.product is distinct from product_name or s.room_name is distinct from e.room_name or s.event_key is distinct from e.event_key or s.session_key is distinct from e.session_key then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      if not p.enabled or p.inventory_valid_until_ms<=clock_ms or p.budget_valid_until_ms<=clock_ms or e.state not in ('reserved','issued','connected') or e.budget_deadline_ms<=clock_ms then raise exception using errcode='P0001',message='MEDIA_CAPACITY_GRANT_CLOSED'; end if;
      -- The epoch is already counted: use >, not >=. A new policy/inventory
      -- observation can invalidate a reserved grant before asynchronous signing.
      if (select coalesce(sum(x.external_occupancy),0) from private.media_capacity_scopes x where x.project_id=project)>p.external_occupancy
        or exists(select 1 from private.media_capacity_epochs x where x.project_id=project and x.state<>'released' and x.budget_deadline_ms<=clock_ms)
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.state<>'released')+p.external_occupancy>p.hard_cap
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.room_name=e.room_name and x.state<>'released')+s.external_occupancy>s.room_cap
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=e.session_key and x.state<>'released')+
          (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=e.session_key)>
          (select min(session_cap) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.session_key=e.session_key)
        or (select count(*) from private.media_capacity_epochs x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=e.event_key and x.state<>'released')+
          (select sum(external_occupancy) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=e.event_key)>
          (select min(event_cap) from private.media_capacity_scopes x where x.project_id=project and x.issuer_id=issuer and x.product=product_name and x.event_key=e.event_key) then
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
    elsif operation='close_session' then
      if logical.state<>'open' or logical.last_epoch_id is distinct from epoch
        or exists(select 1 from private.media_capacity_epochs x where x.project_id=project and x.logical_session_id=logical_id and x.state<>'released') then
        raise exception using errcode='P0001',message='MEDIA_CAPACITY_PREDECESSOR_UNFENCED';
      end if;
      update private.media_capacity_logical_sessions set state='closed',version=version+1 where project_id=project and logical_session_id=logical_id returning * into logical;
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
  return jsonb_build_object('ok',true,'projectId',project,'coordinatorId',p.coordinator_id,'enabled',p.enabled,'policyRevision',p.revision,'replayed',false,'reservation',case when e.epoch_id is null then null else to_jsonb(e) end,'logicalSession',case when logical.logical_session_id is null then null else to_jsonb(logical) end);
exception
  when sqlstate 'P0001' then
    if sqlerrm!~'^MEDIA_CAPACITY_[A-Z_]+$' then raise; end if;
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code',sqlerrm));
  when data_exception then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','MEDIA_CAPACITY_INPUT'));
end;
$$;

-- Existing public invoker wrapper retains its10s configured bound and delegates
-- to this same function. Old unqualified command shapes now fail closed.
revoke all on function private.media_capacity_command(jsonb) from public,anon,authenticated;
revoke all on function public.media_capacity_command(jsonb) from public,anon,authenticated;
grant execute on function private.media_capacity_command(jsonb),public.media_capacity_command(jsonb) to service_role;
commit;
