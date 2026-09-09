-- Additive local candidate; synchronized to CLI-generated migration
-- 20260909080139_debate_room_v3.sql. No remote schema application is evidenced.
-- One Postgres event row serializes competition commands. Private data never has a
-- direct browser grant. Every function is SECURITY INVOKER, service_role only.
begin;

create table if not exists public.debate_v3_events (
  id text primary key check (length(id) between 8 and 128),
  owner_id text not null,
  revision bigint not null check (revision > 0),
  status text not null,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at_ms bigint not null,
  updated_at_ms bigint not null
);
create index if not exists debate_v3_events_owner_created on public.debate_v3_events(owner_id,created_at_ms);
create table if not exists public.debate_v3_receipts (
  actor_id text not null, command text not null, event_id text not null,
  idempotency_key text not null, payload_hash text not null,
  receipt jsonb not null, created_at_ms bigint not null,
  primary key(actor_id,command,event_id,idempotency_key)
);
create table if not exists public.debate_v3_audit (
  event_id text not null references public.debate_v3_events(id),
  revision bigint not null, actor_id text not null, command text not null,
  record jsonb not null, at_ms bigint not null,
  primary key(event_id,revision)
);
create table if not exists public.debate_v3_match_versions (
  event_id text not null references public.debate_v3_events(id), match_id text not null,
  event_revision bigint not null, record jsonb not null,
  primary key(event_id,match_id,event_revision)
);
create table if not exists public.debate_v3_ballots (
  event_id text not null references public.debate_v3_events(id), match_id text not null,
  round integer not null check(round > 0), judge_id text not null,
  ballot jsonb not null, event_revision bigint not null,
  primary key(event_id,match_id,round,judge_id)
);
create table if not exists public.debate_v3_votes (
  event_id text not null references public.debate_v3_events(id), match_id text not null,
  poll_id text not null, actor_id text not null, vote jsonb not null,
  event_revision bigint not null,
  primary key(event_id,match_id,poll_id,actor_id)
);
create table if not exists public.debate_v3_outbox (
  id text primary key, event_id text not null references public.debate_v3_events(id),
  actor_id text not null, type text not null, job jsonb not null,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  attempts integer not null default 0, next_attempt_ms bigint not null,
  claim_id text, lease_until_ms bigint, result jsonb, error text
);
create index if not exists debate_v3_outbox_pending on public.debate_v3_outbox(event_id,status,next_attempt_ms);
create table if not exists public.debate_v3_rate_limits (
  actor_id text not null, action text not null, bucket bigint not null, count integer not null,
  primary key(actor_id,action,bucket)
);
create table if not exists public.debate_v3_maintenance (
  name text primary key, event_cursor text
);
create table if not exists public.debate_v3_uploads (
  id text primary key, event_id text not null references public.debate_v3_events(id), actor_id text not null,
  match_id text not null, channel text not null, record jsonb not null,
  status text not null check(status in ('reserved','uploaded','retained','failed','deleted')),
  expires_at_ms bigint not null, cleanup_job_id text not null references public.debate_v3_outbox(id)
);
create index if not exists debate_v3_uploads_event_status on public.debate_v3_uploads(event_id,status);

alter table public.debate_v3_events enable row level security;
alter table public.debate_v3_receipts enable row level security;
alter table public.debate_v3_audit enable row level security;
alter table public.debate_v3_match_versions enable row level security;
alter table public.debate_v3_ballots enable row level security;
alter table public.debate_v3_votes enable row level security;
alter table public.debate_v3_outbox enable row level security;
alter table public.debate_v3_rate_limits enable row level security;
alter table public.debate_v3_maintenance enable row level security;
alter table public.debate_v3_uploads enable row level security;

-- Remove inherited/default grants before rebuilding the intended privileges.
-- GRANT is additive: the audit's restricted grant alone cannot remove UPDATE/TRUNCATE.
revoke all on public.debate_v3_events,public.debate_v3_receipts,public.debate_v3_audit,
  public.debate_v3_match_versions,public.debate_v3_ballots,public.debate_v3_votes,
  public.debate_v3_outbox,public.debate_v3_rate_limits,public.debate_v3_maintenance,public.debate_v3_uploads from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.debate_v3_events,public.debate_v3_receipts,
  public.debate_v3_match_versions,public.debate_v3_ballots,public.debate_v3_votes,
  public.debate_v3_outbox,public.debate_v3_rate_limits,public.debate_v3_maintenance,public.debate_v3_uploads to service_role;
grant select,insert,delete on public.debate_v3_audit to service_role;

create or replace function public.debate_v3_read(p_event_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select state from public.debate_v3_events where id=p_event_id;
$$;
create or replace function public.debate_v3_list(p_actor_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(state order by updated_at_ms desc),'[]'::jsonb)
  from (select state,updated_at_ms from public.debate_v3_events
    where state->'members' ? p_actor_id
    and coalesce((state->'members'->p_actor_id->>'removed')::boolean,false)=false
    order by updated_at_ms desc limit 100) e;
$$;
create or replace function public.debate_v3_receipt(p_request jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare previous public.debate_v3_receipts%rowtype;
begin
  select * into previous from public.debate_v3_receipts
    where actor_id=p_request->>'actorId' and command=p_request->>'command'
      and event_id=p_request->>'eventId' and idempotency_key=p_request->>'idempotencyKey';
  if not found then return null; end if;
  if previous.payload_hash<>p_request->>'payloadHash' then
    return jsonb_build_object('error',jsonb_build_object('code','IDEMPOTENCY_CONFLICT','message','This action key was used with different details.'));
  end if;
  return previous.receipt;
end;
$$;

create or replace function public.debate_v3_job_expiry(p_state jsonb,p_job jsonb) returns bigint
language sql immutable security invoker set search_path='' as $$
  select least((p_job->>'createdAt')::bigint + case when p_job->>'type' in ('export','invitation_mail') then 7 else (p_state->'retention'->>'operationalDays')::bigint end * 86400000,
    case when p_state->>'endsAt' is not null and p_job->'payload' ? 'document' then (p_state->>'endsAt')::bigint +
      case when p_job->'payload'->'document'->>'kind'='scorecard' then (p_state->'retention'->>'chatDays')::bigint else (p_state->'retention'->>'officialDays')::bigint end * 86400000 else null end);
$$;

create or replace function public.debate_v3_commit(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_event_id text:=p_request->>'eventId'; v_actor_id text:=p_request->>'actorId';
  command_name text:=p_request->>'command'; expected bigint:=(p_request->>'expectedRevision')::bigint;
  clock_ms bigint:=(p_request->>'now')::bigint; next_revision bigint; previous public.debate_v3_events%rowtype;
  saved jsonb; next_state jsonb:=p_request->'state'; receipt jsonb; m record; b record; poll record; v record; job_item jsonb; category text;
begin
  if expected<0 or jsonb_typeof(next_state)<>'object' or next_state->>'id'<>v_event_id
    or length(p_request->>'idempotencyKey') not between 8 and 128
    or (p_request->>'payloadHash') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error',jsonb_build_object('code','INVALID_COMMIT','message','Invalid saved action.'));
  end if;
  -- Lock the logical receipt first; identical retries return the original receipt.
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id||':'||command_name||':'||v_event_id||':'||(p_request->>'idempotencyKey'),0));
  saved:=public.debate_v3_receipt(p_request); if saved is not null then return saved; end if;
  -- Per-owner lock makes create/hour and simultaneous hosted-event limits atomic.
  perform pg_advisory_xact_lock(hashtextextended('debate-owner:'||(next_state->>'ownerId'),0));
  select * into previous from public.debate_v3_events where id=v_event_id for update;
  if coalesce(previous.revision,0)<>expected then
    return jsonb_build_object('error',jsonb_build_object('code','REVISION_CONFLICT','message','The saved event changed.','details',jsonb_build_object('revision',coalesce(previous.revision,0))));
  end if;
  if previous.id is null then
    if command_name<>'create_event' or next_state->>'ownerId'<>v_actor_id or expected<>0 then
      return jsonb_build_object('error',jsonb_build_object('code','FORBIDDEN','message','Only authenticated event creation can create this record.'));
    end if;
    if (select count(*) from public.debate_v3_events where owner_id=v_actor_id and created_at_ms>clock_ms-3600000)>=3 then
      return jsonb_build_object('error',jsonb_build_object('code','EVENT_CREATION_LIMIT','message','The event creation limit has been reached.'));
    end if;
  else
    if previous.owner_id<>next_state->>'ownerId' then
      return jsonb_build_object('error',jsonb_build_object('code','FORBIDDEN','message','Event ownership cannot be rewritten.'));
    end if;
    if command_name='join_public_event' and (previous.state->>'visibility'<>'public' or coalesce((previous.state->>'rehearsal')::boolean,false)
      or previous.status='completed' or coalesce((previous.state->'members'->v_actor_id->>'removed')::boolean,false)) then
      return jsonb_build_object('error',jsonb_build_object('code','PUBLIC_EVENT_UNAVAILABLE','message','This event is not open for public admission.'));
    end if;
    if command_name='join_public_event' and not(previous.state->'members' ? v_actor_id) and
      (next_state->'members'->v_actor_id->'roles'<>'["observer"]'::jsonb or coalesce((next_state->'members'->v_actor_id->>'admitted')::boolean,true)) then
      return jsonb_build_object('error',jsonb_build_object('code','FORBIDDEN','message','Public entry requires observer admission.'));
    end if;
    if command_name not in ('claim_invite','join_public_event','__outbox_complete') and
      (not(previous.state->'members' ? v_actor_id) or coalesce((previous.state->'members'->v_actor_id->>'removed')::boolean,false)) then
      return jsonb_build_object('error',jsonb_build_object('code','NOT_MEMBER','message','An active event membership is required.'));
    end if;
  end if;
  if next_state->>'status'='live' and coalesce(previous.status,'')<>'live' and exists
    (select 1 from public.debate_v3_events where owner_id=next_state->>'ownerId' and id<>v_event_id and status='live') then
    return jsonb_build_object('error',jsonb_build_object('code','LIVE_EVENT_LIMIT','message','This account already hosts a live event.'));
  end if;
  for job_item in select value from jsonb_array_elements(coalesce(p_request->'cancelJobs','[]'::jsonb)) loop
    perform 1 from public.debate_v3_outbox where id=trim(both '"' from job_item::text)
      and debate_v3_outbox.event_id=v_event_id and status in ('queued','failed') for update;
    if not found then return jsonb_build_object('error',jsonb_build_object('code','JOB_ALREADY_RUNNING','message','This delivery has already started and cannot be cancelled.')); end if;
  end loop;
  for job_item in select value from jsonb_array_elements(coalesce(p_request->'retryJobs','[]'::jsonb)) loop
    perform 1 from public.debate_v3_outbox where id=trim(both '"' from job_item::text)
      and debate_v3_outbox.event_id=v_event_id and status='failed' for update;
    if not found then return jsonb_build_object('error',jsonb_build_object('code','JOB_NOT_READY','message','This delivery is not waiting for retry.')); end if;
  end loop;
  for job_item in select value from jsonb_array_elements(coalesce(p_request->'consumeUploads','[]'::jsonb)) loop
    perform 1 from public.debate_v3_uploads where id=trim(both '"' from job_item::text) and event_id=v_event_id
      and actor_id=v_actor_id and status='uploaded' and expires_at_ms>clock_ms for update;
    if not found then return jsonb_build_object('error',jsonb_build_object('code','UPLOAD_UNAVAILABLE','message','This upload is unavailable or already used.')); end if;
  end loop;
  if p_request->'retentionCleanup' is not null and p_request->'retentionCleanup'<>'null'::jsonb then
    if command_name not in ('cleanup_records','__retention_cleanup') or not coalesce((previous.state->'retention'->>'approved')::boolean,false)
      or coalesce((previous.state->'retention'->>'hold')::boolean,false) then
      return jsonb_build_object('error',jsonb_build_object('code','RETENTION_HOLD','message','Cleanup requires an approved policy without a hold.'));
    end if;
    for category in select jsonb_array_elements_text(p_request->'retentionCleanup'->'categories') loop
      if category not in ('operational','chat','evidence','official') or previous.state->>'endsAt' is null
        or clock_ms<(previous.state->>'endsAt')::bigint+(previous.state->'retention'->>(category||'Days'))::bigint*86400000 then
        return jsonb_build_object('error',jsonb_build_object('code','RETENTION_NOT_DUE','message','These records have not reached their approved retention period.'));
      end if;
    end loop;
    for job_item in select value from jsonb_array_elements(p_request->'retentionCleanup'->'jobIds') loop
      perform 1 from public.debate_v3_outbox o where o.id=trim(both '"' from job_item::text) and o.event_id=v_event_id
        and (o.type in ('export','mail','invitation_mail') or o.status in ('completed','cancelled')) and not(o.job->'payload' ? 'retentionPurgedAt')
        and (o.status<>'running' or o.lease_until_ms<clock_ms-60000) and public.debate_v3_job_expiry(previous.state,o.job)<=clock_ms for update;
      if not found then return jsonb_build_object('error',jsonb_build_object('code','JOB_ALREADY_RUNNING','message','This delivery is still active or not due for cleanup.')); end if;
    end loop;
  end if;
  next_revision:=expected+1;
  next_state:=jsonb_set(next_state,'{revision}',to_jsonb(next_revision));
  if octet_length(next_state::text)>8388608 then return jsonb_build_object('error',jsonb_build_object('code','EVENT_STORAGE_LIMIT','message','This event has reached its safe record-size limit.')); end if;
  insert into public.debate_v3_events(id,owner_id,revision,status,state,created_at_ms,updated_at_ms)
    values(v_event_id,next_state->>'ownerId',next_revision,next_state->>'status',next_state,(next_state->>'createdAt')::bigint,clock_ms)
    on conflict(id) do update set revision=excluded.revision,status=excluded.status,state=excluded.state,updated_at_ms=excluded.updated_at_ms;
  receipt:=jsonb_set(p_request->'receipt','{revision}',to_jsonb(next_revision));
  insert into public.debate_v3_receipts values(v_actor_id,command_name,v_event_id,p_request->>'idempotencyKey',p_request->>'payloadHash',receipt,clock_ms);
  insert into public.debate_v3_audit values(v_event_id,next_revision,v_actor_id,command_name,p_request->'audit',clock_ms);
  for m in select key,value from jsonb_each(coalesce(next_state->'matches','{}'::jsonb)) loop
    if m.value is distinct from previous.state->'matches'->m.key then
      -- Immutable official-history projection deliberately excludes drafts, messages,
      -- polls' voter identities and evidence to permit their shorter retention periods.
      insert into public.debate_v3_match_versions values(v_event_id,m.key,next_revision,
        m.value-'drafts'-'draftHistory'-'messages'-'evidence'-'polls'-'deviceChecks'-'accommodations');
    end if;
    for b in select key,value from jsonb_each(coalesce(m.value->'ballots','{}'::jsonb)) loop
      insert into public.debate_v3_ballots values(v_event_id,m.key,(b.value->>'round')::integer,b.value->>'judgeId',b.value,next_revision)
        on conflict(event_id,match_id,round,judge_id) do update set ballot=excluded.ballot,event_revision=excluded.event_revision;
    end loop;
    for poll in select key,value from jsonb_each(coalesce(m.value->'polls','{}'::jsonb)) loop
      for v in select key,value from jsonb_each(coalesce(poll.value->'votes','{}'::jsonb)) loop
        insert into public.debate_v3_votes values(v_event_id,m.key,poll.key,v.key,v.value,next_revision)
          on conflict(event_id,match_id,poll_id,actor_id) do update set vote=excluded.vote,event_revision=excluded.event_revision;
      end loop;
    end loop;
  end loop;
  for job_item in select value from jsonb_array_elements(coalesce(p_request->'jobs','[]'::jsonb)) loop
    insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,next_attempt_ms)
      values(job_item->>'id',v_event_id,job_item->>'actorId',job_item->>'type',job_item,clock_ms) on conflict(id) do nothing;
  end loop;
  update public.debate_v3_outbox set status='cancelled' where debate_v3_outbox.event_id=v_event_id
    and status in ('queued','failed') and id in (select jsonb_array_elements_text(coalesce(p_request->'cancelJobs','[]'::jsonb)));
  update public.debate_v3_outbox set status='queued',next_attempt_ms=clock_ms where debate_v3_outbox.event_id=v_event_id
    and status='failed' and id in (select jsonb_array_elements_text(coalesce(p_request->'retryJobs','[]'::jsonb)));
  update public.debate_v3_uploads set status='retained' where event_id=v_event_id and actor_id=v_actor_id
    and id in (select jsonb_array_elements_text(coalesce(p_request->'consumeUploads','[]'::jsonb)));
  if p_request->'retentionCleanup' is not null and p_request->'retentionCleanup'<>'null'::jsonb then
    delete from public.debate_v3_uploads where event_id=v_event_id and status in ('retained','deleted')
      and cleanup_job_id in (select jsonb_array_elements_text(p_request->'retentionCleanup'->'jobIds'));
    update public.debate_v3_outbox o set status='cancelled',result=null,error=null,actor_id='RETENTION_REDACTED',
      job=jsonb_set(jsonb_set(o.job,'{actorId}','"RETENTION_REDACTED"'::jsonb),'{payload}',jsonb_build_object('retentionPurgedAt',clock_ms,'format',o.job->'payload'->'format'))
      where o.event_id=v_event_id and o.id in (select jsonb_array_elements_text(p_request->'retentionCleanup'->'jobIds'));
    delete from public.debate_v3_receipts where event_id=v_event_id and created_at_ms<clock_ms-(previous.state->'retention'->>'operationalDays')::bigint*86400000;
    if p_request->'retentionCleanup'->'categories' ? 'operational' then
      delete from public.debate_v3_votes where event_id=v_event_id;
      update public.debate_v3_match_versions set record=record-'incidents'-'privateRoomInvitations'-'floorGrants'-'presenterId' where event_id=v_event_id;
      delete from public.debate_v3_uploads where event_id=v_event_id and status='deleted';
    end if;
    if p_request->'retentionCleanup'->'categories' ? 'chat' then
      update public.debate_v3_match_versions set record=record-'drafts'-'draftHistory'-'messages' where event_id=v_event_id;
    end if;
    if p_request->'retentionCleanup'->'categories' ? 'evidence' then
      -- The object deletion jobs retain only private storage bindings until confirmed.
      delete from public.debate_v3_uploads where event_id=v_event_id and status in ('retained','deleted');
    end if;
    if p_request->'retentionCleanup'->'categories' ? 'official' then
      -- Event command history proves accepted rules, decisions, corrections and
      -- sanctions. Its official-record deadline is anchored to the event end;
      -- operational receipt cleanup must never erase this audit early.
      delete from public.debate_v3_audit where event_id=v_event_id and revision<next_revision;
      delete from public.debate_v3_ballots where event_id=v_event_id;
      delete from public.debate_v3_votes where event_id=v_event_id;
      delete from public.debate_v3_match_versions where event_id=v_event_id;
    end if;
  end if;
  return receipt;
end;
$$;

create or replace function public.debate_v3_claim_jobs(p_event_id text,p_limit integer,p_now bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.debate_v3_outbox%rowtype; output jsonb:='[]'::jsonb; claim text;
begin
  for candidate in select * from public.debate_v3_outbox where event_id=p_event_id
    and (status in ('queued','failed') or (status='running' and lease_until_ms<p_now))
    and next_attempt_ms<=p_now and (attempts<10 or type in ('media','delete_evidence','delete_export')) order by next_attempt_ms,id
    limit greatest(1,least(20,p_limit)) for update skip locked loop
    claim:=gen_random_uuid()::text;
    update public.debate_v3_outbox set status='running',attempts=attempts+1,claim_id=claim,lease_until_ms=p_now+60000 where id=candidate.id;
    output:=output||jsonb_build_array(candidate.job||jsonb_build_object('claimId',claim,'attempts',candidate.attempts+1));
  end loop;
  return output;
end;
$$;
create or replace function public.debate_v3_finish_job(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.debate_v3_outbox%rowtype;
begin
  select * into candidate from public.debate_v3_outbox where id=p_request->>'jobId' for update;
  if not found or candidate.status<>'running' or candidate.claim_id<>p_request->>'claimId' then
    return jsonb_build_object('error',jsonb_build_object('code','JOB_LEASE_CONFLICT','message','This delivery lease is no longer current.'));
  end if;
  if p_request->>'status' not in ('completed','failed') then
    return jsonb_build_object('error',jsonb_build_object('code','INVALID_JOB_STATE','message','Invalid delivery outcome.'));
  end if;
  update public.debate_v3_outbox set status=p_request->>'status',result=p_request->'result',error=p_request->>'error',
    next_attempt_ms=(p_request->>'now')::bigint+least(case when candidate.type in ('media','delete_evidence','delete_export') then 60000 else 3600000 end,(1000*power(2,least(16,candidate.attempts)))::bigint)
    where id=candidate.id;
  if candidate.type='delete_evidence' and p_request->>'status'='completed' then
    update public.debate_v3_uploads set status='deleted' where id=candidate.job->'payload'->>'uploadId' and status<>'retained';
  end if;
  return jsonb_build_object('id',candidate.id,'status',p_request->>'status');
end;
$$;

create or replace function public.debate_v3_reserve_upload(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare upload_id text:=p_request->>'id'; cleanup_id text:='upload-cleanup:'||(p_request->>'id'); e jsonb; job jsonb;
begin
  select state into e from public.debate_v3_events where id=p_request->>'eventId' for share;
  if e is null or e->>'status'='completed' or not(e->'matches' ? (p_request->>'matchId'))
    or not coalesce((e->'members'->(p_request->>'actorId')->>'admitted')::boolean,false)
    or coalesce((e->'members'->(p_request->>'actorId')->>'removed')::boolean,false) then
    return jsonb_build_object('error',jsonb_build_object('code','FORBIDDEN','message','This upload is no longer authorized.'));
  end if;
  job:=jsonb_build_object('id',cleanup_id,'eventId',p_request->>'eventId','matchId',p_request->>'matchId','actorId',p_request->>'actorId',
    'type','delete_evidence','createdAt',(p_request->>'createdAt')::bigint,'payload',jsonb_build_object('uploadId',upload_id,'matchId',p_request->>'matchId','storageKey',p_request->>'storageKey'));
  insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,next_attempt_ms) values(cleanup_id,p_request->>'eventId',p_request->>'actorId','delete_evidence',job,(p_request->>'expiresAt')::bigint);
  insert into public.debate_v3_uploads values(upload_id,p_request->>'eventId',p_request->>'actorId',p_request->>'matchId',p_request->>'channel',p_request,'reserved',(p_request->>'expiresAt')::bigint,cleanup_id);
  return p_request||jsonb_build_object('status','reserved','cleanupJobId',cleanup_id);
end;
$$;
create or replace function public.debate_v3_read_upload(p_upload_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select record||jsonb_build_object('status',status,'cleanupJobId',cleanup_job_id) from public.debate_v3_uploads where id=p_upload_id;
$$;
create or replace function public.debate_v3_complete_upload(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uploaded public.debate_v3_uploads%rowtype;
begin
  select * into uploaded from public.debate_v3_uploads where id=p_request->>'id' for update;
  if not found or uploaded.actor_id<>p_request->>'actorId' or uploaded.event_id<>p_request->>'eventId' or uploaded.status not in ('reserved','uploaded')
    or uploaded.expires_at_ms<=(p_request->>'now')::bigint then
    return jsonb_build_object('error',jsonb_build_object('code','UPLOAD_UNAVAILABLE','message','This upload has expired or is unavailable.'));
  end if;
  update public.debate_v3_uploads set status='uploaded',record=record||jsonb_build_object('metadata',p_request->'metadata') where id=uploaded.id;
  return jsonb_build_object('uploaded',true,'id',uploaded.id);
end;
$$;
create or replace function public.debate_v3_fail_upload(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uploaded public.debate_v3_uploads%rowtype;
begin
  -- Match the outbox-before-upload lock order used by share/cleanup completion.
  perform 1 from public.debate_v3_outbox where id='upload-cleanup:'||(p_request->>'id') for update;
  select * into uploaded from public.debate_v3_uploads where id=p_request->>'id' for update;
  if not found or uploaded.actor_id<>p_request->>'actorId' or uploaded.event_id<>p_request->>'eventId' then
    return jsonb_build_object('error',jsonb_build_object('code','FORBIDDEN','message','This upload is unavailable.'));
  end if;
  if uploaded.status='retained' then return jsonb_build_object('retained',true); end if;
  update public.debate_v3_uploads set status='failed' where id=uploaded.id;
  update public.debate_v3_outbox set status=case when status='running' then status else 'queued' end,next_attempt_ms=(p_request->>'now')::bigint
    where id=uploaded.cleanup_job_id;
  return jsonb_build_object('cleanupQueued',true);
end;
$$;
create or replace function public.debate_v3_rate_limit(p_actor_id text,p_action text,p_now bigint,p_limit integer,p_window_ms bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare bucket_id bigint; current_count integer;
begin
  if p_limit not between 1 and 1000 or p_window_ms not between 1000 and 3600000 then return false; end if;
  bucket_id:=p_now/p_window_ms;
  insert into public.debate_v3_rate_limits values(p_actor_id,p_action,bucket_id,1)
    on conflict(actor_id,action,bucket) do update set count=debate_v3_rate_limits.count+1 returning count into current_count;
  delete from public.debate_v3_rate_limits where bucket<bucket_id-2 and action=p_action;
  return current_count<=p_limit;
end;
$$;

create or replace function public.debate_v3_read_job(p_job_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select job||jsonb_build_object('status',status,'result',result,'error',error,'claimId',claim_id,'leaseUntil',lease_until_ms)
    from public.debate_v3_outbox where id=p_job_id;
$$;
create or replace function public.debate_v3_expired_jobs(p_event_id text,p_now bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(job order by id),'[]'::jsonb) from (
    select o.id,o.job from public.debate_v3_outbox o join public.debate_v3_events e on e.id=o.event_id
    where e.id=p_event_id and coalesce((e.state->'retention'->>'approved')::boolean,false) and not coalesce((e.state->'retention'->>'hold')::boolean,false)
      and (o.type in ('export','mail','invitation_mail') or o.status in ('completed','cancelled')) and not(o.job->'payload' ? 'retentionPurgedAt')
      and (o.status<>'running' or o.lease_until_ms<p_now-60000) and public.debate_v3_job_expiry(e.state,o.job)<=p_now
    order by o.id limit 100
  ) due;
$$;

-- Internal scheduled sweep discovers opaque event IDs only. No client grants.
create or replace function public.debate_v3_discover(p_limit integer default 20,p_cursor text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  with available as (
    select id,jsonb_build_object('id',id,'title',state->'title','description',state->'description','scheduledAt',state->'scheduledAt',
      'timezone',state->'timezone','language',state->'language','status',status) as metadata
    from public.debate_v3_events where state->>'visibility'='public' and coalesce((state->>'rehearsal')::boolean,false)=false
      and status<>'completed' and (p_cursor is null or id>p_cursor)
    order by id limit greatest(1,least(100,p_limit))+1
  ), page as (select id,metadata from available order by id limit greatest(1,least(100,p_limit)))
  select jsonb_build_object('events',coalesce((select jsonb_agg(metadata order by id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from available)>(select count(*) from page) then (select max(id) from page) else null end);
$$;

create or replace function public.debate_v3_active_events(p_limit integer default 20,p_cursor text default null,p_now bigint default floor(extract(epoch from clock_timestamp())*1000)::bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare start_cursor text; batch jsonb; continuation text; pass integer;
begin
  insert into public.debate_v3_maintenance(name,event_cursor) values('outbox-sweep',null) on conflict(name) do nothing;
  select event_cursor into start_cursor from public.debate_v3_maintenance where name='outbox-sweep' for update;
  -- Stored cursor is authoritative. Caller cursor remains a continuation hint
  -- for compatibility; an older concurrent invocation cannot rewind the sweep.
  for pass in 1..2 loop
    with active as (
      select e.id from public.debate_v3_events e where (start_cursor is null or e.id>start_cursor) and (
        (coalesce((e.state->'retention'->>'approved')::boolean,false) and not coalesce((e.state->'retention'->>'hold')::boolean,false) and (e.state->'retention'->>'nextCleanupAt')::bigint<=p_now)
        or (coalesce((e.state->'retention'->>'approved')::boolean,false) and not coalesce((e.state->'retention'->>'hold')::boolean,false) and exists(select 1 from public.debate_v3_outbox o where o.event_id=e.id and o.status in ('completed','cancelled') and not (o.job->'payload' ? 'retentionPurgedAt') and public.debate_v3_job_expiry(e.state,o.job)<=p_now))
        or exists(select 1 from jsonb_each(coalesce(e.state->'media','{}'::jsonb)) m where m.value->>'status'<>'left')
        or exists(select 1 from public.debate_v3_outbox o where o.event_id=e.id and o.status in ('queued','failed','running') and (o.attempts<10 or o.type in ('media','delete_evidence','delete_export'))))
      order by e.id limit greatest(1,least(100,p_limit))+1
    ), page as (select id from active order by id limit greatest(1,least(100,p_limit)))
    select coalesce((select jsonb_agg(id order by id) from page),'[]'::jsonb),
      case when (select count(*) from active)>(select count(*) from page) then (select max(id) from page) else null end into batch,continuation;
    exit when jsonb_array_length(batch)>0 or start_cursor is null;
    start_cursor:=null;
  end loop;
  update public.debate_v3_maintenance set event_cursor=continuation where name='outbox-sweep';
  return jsonb_build_object('eventIds',batch,'nextCursor',continuation);
end;
$$;

revoke all on function public.debate_v3_read(text),public.debate_v3_list(text),public.debate_v3_receipt(jsonb),
  public.debate_v3_commit(jsonb),public.debate_v3_claim_jobs(text,integer,bigint),public.debate_v3_finish_job(jsonb),
  public.debate_v3_rate_limit(text,text,bigint,integer,bigint),public.debate_v3_read_job(text),public.debate_v3_active_events(integer,text,bigint),public.debate_v3_discover(integer,text),public.debate_v3_job_expiry(jsonb,jsonb),public.debate_v3_expired_jobs(text,bigint),
  public.debate_v3_reserve_upload(jsonb),public.debate_v3_read_upload(text),public.debate_v3_complete_upload(jsonb),public.debate_v3_fail_upload(jsonb) from public,anon,authenticated;
grant execute on function public.debate_v3_read(text),public.debate_v3_list(text),public.debate_v3_receipt(jsonb),
  public.debate_v3_commit(jsonb),public.debate_v3_claim_jobs(text,integer,bigint),public.debate_v3_finish_job(jsonb),
  public.debate_v3_rate_limit(text,text,bigint,integer,bigint),public.debate_v3_read_job(text),public.debate_v3_active_events(integer,text,bigint),public.debate_v3_discover(integer,text),public.debate_v3_job_expiry(jsonb,jsonb),public.debate_v3_expired_jobs(text,bigint),
  public.debate_v3_reserve_upload(jsonb),public.debate_v3_read_upload(text),public.debate_v3_complete_upload(jsonb),public.debate_v3_fail_upload(jsonb) to service_role;

comment on table public.debate_v3_events is 'Private service-role-only transactional Debate Room state; Worker commands authorize current verified actor, roles, phase, target and payload.';
comment on table public.debate_v3_match_versions is 'Immutable official match version history; no private drafts/chat/evidence copies.';
commit;
