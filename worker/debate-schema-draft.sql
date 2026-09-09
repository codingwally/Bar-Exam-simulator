-- LOCAL ADDITIVE DRAFT: no Supabase CLI was available to allocate a migration filename.
-- Validate locally, then use `supabase migration new` in the release workflow.
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

alter table public.debate_v3_events enable row level security;
alter table public.debate_v3_receipts enable row level security;
alter table public.debate_v3_audit enable row level security;
alter table public.debate_v3_match_versions enable row level security;
alter table public.debate_v3_ballots enable row level security;
alter table public.debate_v3_votes enable row level security;
alter table public.debate_v3_outbox enable row level security;
alter table public.debate_v3_rate_limits enable row level security;

revoke all on public.debate_v3_events,public.debate_v3_receipts,public.debate_v3_audit,
  public.debate_v3_match_versions,public.debate_v3_ballots,public.debate_v3_votes,
  public.debate_v3_outbox,public.debate_v3_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on public.debate_v3_events,public.debate_v3_receipts,
  public.debate_v3_match_versions,public.debate_v3_ballots,public.debate_v3_votes,
  public.debate_v3_outbox,public.debate_v3_rate_limits to service_role;
grant select,insert on public.debate_v3_audit to service_role;

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

create or replace function public.debate_v3_commit(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_event_id text:=p_request->>'eventId'; v_actor_id text:=p_request->>'actorId';
  command_name text:=p_request->>'command'; expected bigint:=(p_request->>'expectedRevision')::bigint;
  clock_ms bigint:=(p_request->>'now')::bigint; next_revision bigint; previous public.debate_v3_events%rowtype;
  saved jsonb; next_state jsonb:=p_request->'state'; receipt jsonb; m record; b record; poll record; v record; job jsonb;
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
    if command_name not in ('claim_invite','__outbox_complete') and
      (not(previous.state->'members' ? v_actor_id) or coalesce((previous.state->'members'->v_actor_id->>'removed')::boolean,false)) then
      return jsonb_build_object('error',jsonb_build_object('code','NOT_MEMBER','message','An active event membership is required.'));
    end if;
  end if;
  if next_state->>'status'='live' and coalesce(previous.status,'')<>'live' and exists
    (select 1 from public.debate_v3_events where owner_id=next_state->>'ownerId' and id<>v_event_id and status='live') then
    return jsonb_build_object('error',jsonb_build_object('code','LIVE_EVENT_LIMIT','message','This account already hosts a live event.'));
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
        m.value-'drafts'-'messages'-'evidence'-'polls'-'deviceChecks'-'accommodations');
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
  for job in select value from jsonb_array_elements(coalesce(p_request->'jobs','[]'::jsonb)) loop
    insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,next_attempt_ms)
      values(job->>'id',v_event_id,job->>'actorId',job->>'type',job,clock_ms) on conflict(id) do nothing;
  end loop;
  update public.debate_v3_outbox set status='cancelled' where debate_v3_outbox.event_id=v_event_id
    and status in ('queued','failed') and id in (select jsonb_array_elements_text(coalesce(p_request->'cancelJobs','[]'::jsonb)));
  update public.debate_v3_outbox set status='queued',next_attempt_ms=clock_ms where debate_v3_outbox.event_id=v_event_id
    and status='failed' and id in (select jsonb_array_elements_text(coalesce(p_request->'retryJobs','[]'::jsonb)));
  return receipt;
end;
$$;

create or replace function public.debate_v3_claim_jobs(p_event_id text,p_limit integer,p_now bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.debate_v3_outbox%rowtype; output jsonb:='[]'::jsonb; claim text;
begin
  for candidate in select * from public.debate_v3_outbox where event_id=p_event_id
    and (status in ('queued','failed') or (status='running' and lease_until_ms<p_now))
    and next_attempt_ms<=p_now and attempts<10 order by next_attempt_ms,id
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
    next_attempt_ms=(p_request->>'now')::bigint+least(3600000,(1000*power(2,candidate.attempts))::bigint)
    where id=candidate.id;
  return jsonb_build_object('id',candidate.id,'status',p_request->>'status');
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
  select job||jsonb_build_object('status',status,'result',result,'error',error)
    from public.debate_v3_outbox where id=p_job_id;
$$;

revoke all on function public.debate_v3_read(text),public.debate_v3_list(text),public.debate_v3_receipt(jsonb),
  public.debate_v3_commit(jsonb),public.debate_v3_claim_jobs(text,integer,bigint),public.debate_v3_finish_job(jsonb),
  public.debate_v3_rate_limit(text,text,bigint,integer,bigint),public.debate_v3_read_job(text) from public,anon,authenticated;
grant execute on function public.debate_v3_read(text),public.debate_v3_list(text),public.debate_v3_receipt(jsonb),
  public.debate_v3_commit(jsonb),public.debate_v3_claim_jobs(text,integer,bigint),public.debate_v3_finish_job(jsonb),
  public.debate_v3_rate_limit(text,text,bigint,integer,bigint),public.debate_v3_read_job(text) to service_role;

comment on table public.debate_v3_events is 'Private service-role-only transactional Debate Room state; Worker commands authorize current verified actor, roles, phase, target and payload.';
comment on table public.debate_v3_match_versions is 'Immutable official match version history; no private drafts/chat/evidence copies.';
commit;
