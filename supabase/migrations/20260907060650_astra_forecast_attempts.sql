-- Durable Forecast acceptance and serialized, fenced grading checkpoints.
-- New objects only. No legacy attempts, answers, grades, or entitlements change.
begin;

create table public.dd2026_forecast_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_attempt_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and jsonb_array_length(snapshot->'rows') = 20),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  subject text not null,
  set_id text not null check (set_id ~ '^sha256:[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','processing','retryable_failed','failed','complete')),
  accepted_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_claimed_at timestamptz,
  completed_at timestamptz,
  manual_retries integer not null default 0 check (manual_retries between 0 and 2),
  result_revision integer not null default 0 check (result_revision in (0,1)),
  result jsonb,
  unique(owner_id,client_attempt_id),
  check ((status = 'complete') = (result is not null and result_revision = 1 and completed_at is not null))
);
create index dd2026_forecast_attempt_owner_history on public.dd2026_forecast_attempts(owner_id,accepted_at desc,id desc);
create index dd2026_forecast_attempt_owner_analytics on public.dd2026_forecast_attempts(owner_id,subject,completed_at desc) where status='complete';
create index dd2026_forecast_attempt_work on public.dd2026_forecast_attempts(last_claimed_at,accepted_at) where status <> 'complete';

create table public.dd2026_forecast_batches (
  attempt_id uuid not null references public.dd2026_forecast_attempts(id) on delete cascade,
  batch_index integer not null check (batch_index between 0 and 4),
  status text not null default 'pending' check (status in ('pending','processing','retryable_failed','failed','complete')),
  executions integer not null default 0 check (executions between 0 and 6),
  lease_token uuid,
  lease_expires_at timestamptz,
  retry_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_error_code text,
  uncertain_outcomes integer not null default 0,
  result jsonb,
  primary key(attempt_id,batch_index),
  check ((status = 'processing') = (lease_token is not null and lease_expires_at is not null)),
  check ((status = 'complete') = (result is not null))
);

create table public.dd2026_forecast_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.dd2026_forecast_attempts(id) on delete cascade,
  batch_index integer,
  event_type text not null,
  happened_at timestamptz not null default statement_timestamp(),
  details jsonb not null default '{}'::jsonb
);
create index dd2026_forecast_batch_live_lease on public.dd2026_forecast_batches(lease_expires_at) where status='processing';
create index dd2026_forecast_attempt_event_history on public.dd2026_forecast_attempt_events(attempt_id,happened_at);

alter table public.dd2026_forecast_attempts enable row level security;
alter table public.dd2026_forecast_attempts force row level security;
alter table public.dd2026_forecast_batches enable row level security;
alter table public.dd2026_forecast_batches force row level security;
alter table public.dd2026_forecast_attempt_events enable row level security;
alter table public.dd2026_forecast_attempt_events force row level security;
revoke all on public.dd2026_forecast_attempts,public.dd2026_forecast_batches,public.dd2026_forecast_attempt_events from public,anon,authenticated;
grant select,insert,update,delete on public.dd2026_forecast_attempts,public.dd2026_forecast_batches,public.dd2026_forecast_attempt_events to service_role;

create function public.dd2026_forecast_attempt_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'dd2026_forecast_attempts' then
    if (new.id,new.owner_id,new.client_attempt_id,new.snapshot,new.payload_hash,new.subject,new.set_id,new.accepted_at)
      is distinct from (old.id,old.owner_id,old.client_attempt_id,old.snapshot,old.payload_hash,old.subject,old.set_id,old.accepted_at)
      or (old.status = 'complete' and new is distinct from old) then
      raise exception 'Accepted Forecast snapshots and completed results are immutable' using errcode = '23514';
    end if;
  elsif old.status = 'complete' and new is distinct from old then
    raise exception 'Completed Forecast checkpoints are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger dd2026_forecast_attempt_immutable before update on public.dd2026_forecast_attempts
for each row execute function public.dd2026_forecast_attempt_immutable();
create trigger dd2026_forecast_batch_immutable before update on public.dd2026_forecast_batches
for each row execute function public.dd2026_forecast_attempt_immutable();

create function public.dd2026_forecast_attempt_error(p_code text,p_message text,p_status integer)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('ok',false,'error',jsonb_build_object('code',p_code,'message',p_message,'status',p_status));
$$;

create function public.dd2026_forecast_attempt_public(p_attempt_id uuid,p_with_answers boolean default true)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',a.id,'clientAttemptId',a.client_attempt_id,'subject',a.subject,'setId',a.set_id,
    'schemaVersion',a.snapshot->>'schemaVersion','contentVersion',a.snapshot->>'contentVersion',
    'rubricVersion',a.snapshot->>'rubricVersion','status',a.status,
    'acceptedAt',a.accepted_at,'updatedAt',a.updated_at,'completedAt',a.completed_at,
    'resultRevision',a.result_revision,'questionCount',20,
    'completedQuestionCount',(select count(*)*4 from public.dd2026_forecast_batches b where b.attempt_id=a.id and b.status='complete'),
    'retryAt',(select min(b.retry_at) from public.dd2026_forecast_batches b where b.attempt_id=a.id and b.status='retryable_failed'),
    'retryAllowed',a.status='failed' and a.manual_retries<2,
    'summary',a.result->'summary',
    'result',case when p_with_answers and a.status='complete' then a.result else null end,
    'questions',case when p_with_answers then (
      select jsonb_agg(jsonb_build_object('id',r->>'id','number',r->'number','prompt',r->>'prompt') order by n)
      from jsonb_array_elements(a.snapshot->'rows') with ordinality x(r,n)) else null end,
    'answers',case when p_with_answers then (
      select jsonb_agg(jsonb_build_object('questionId',r->>'id','answer',r->>'userAnswer') order by n)
      from jsonb_array_elements(a.snapshot->'rows') with ordinality x(r,n)) else null end
  ) from public.dd2026_forecast_attempts a where a.id=p_attempt_id;
$$;

create function public.dd2026_forecast_attempt_accept(p_actor_user_id uuid,p_client_attempt_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_attempt public.dd2026_forecast_attempts%rowtype;
  v_hash text;
  v_row jsonb;
  v_index integer := 0;
begin
  if p_actor_user_id is null or not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403);
  end if;
  if not exists(select 1 from public.dd2026_bar_forecast_consents where user_id=p_actor_user_id and consent_version='2026-09-01') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_CONSENT_REQUIRED','Accept the current Forecast consent first.',409);
  end if;
  if p_client_attempt_id is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->>'schemaVersion' is distinct from 'forecast-attempt-v1'
    or p_snapshot->>'contentVersion' is distinct from '2026.3'
    or p_snapshot->>'consentVersion' is distinct from '2026-09-01'
    or coalesce(p_snapshot->>'rubricVersion','')='' or coalesce(p_snapshot->>'subject','')=''
    or coalesce(p_snapshot->>'setId','') !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(p_snapshot->'rows') is distinct from 'array'
    or octet_length(p_snapshot::text)>2000000 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_INVALID','The complete Forecast snapshot is required.',400);
  end if;
  if jsonb_array_length(p_snapshot->'rows')<>20 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANSWERS_INCOMPLETE','All 20 answers must be saved together.',400);
  end if;
  for v_row in select value from jsonb_array_elements(p_snapshot->'rows') loop
    v_index := v_index+1;
    if v_row->'number' is distinct from to_jsonb(v_index)
      or v_row->>'subject' is distinct from p_snapshot->>'subject'
      or coalesce(v_row->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9-]{2,79}$'
      or jsonb_typeof(v_row->'userAnswer') is distinct from 'string'
      or length(v_row->>'userAnswer') not between 1 and 6000
      or coalesce(length(v_row->>'prompt'),0)<20
      or coalesce(length(v_row->>'suggestedAnswer'),0)<20
      or coalesce(length(v_row->>'legalBasis'),0)<20
      or coalesce(v_row->>'checksum','') !~ '^[0-9a-f]{64}$' then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_INVALID','The ordered Forecast snapshot is invalid.',400);
    end if;
  end loop;
  if (select count(distinct r->>'id') from jsonb_array_elements(p_snapshot->'rows') r)<>20 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_INVALID','The Forecast snapshot contains duplicate questions.',400);
  end if;
  v_hash := encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  -- Serialize this short acceptance transaction to enforce both queue caps even
  -- when concurrent requests reach different Worker instances.
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_accept_v1',0));
  select * into v_attempt from public.dd2026_forecast_attempts where owner_id=p_actor_user_id and client_attempt_id=p_client_attempt_id for update;
  if found then
    if v_attempt.payload_hash<>v_hash or v_attempt.snapshot<>p_snapshot then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_CONFLICT','This submission was already accepted with different answers. Open its saved report.',409);
    end if;
    return jsonb_build_object('ok',true,'alreadyAccepted',true,'attempt',public.dd2026_forecast_attempt_public(v_attempt.id));
  end if;
  if (select count(*) from public.dd2026_forecast_attempts where owner_id=p_actor_user_id and status in ('pending','processing','retryable_failed'))>=3 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_QUEUE_BUSY','You already have three saved Forecasts awaiting assessment. Open one to check its progress.',429);
  end if;
  if (select count(*) from public.dd2026_forecast_attempts where status in ('pending','processing','retryable_failed'))>=250 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_QUEUE_BUSY','Forecast assessment is temporarily full. Your local answers remain available; please try again shortly.',503);
  end if;
  insert into public.dd2026_forecast_attempts(owner_id,client_attempt_id,snapshot,payload_hash,subject,set_id)
    values(p_actor_user_id,p_client_attempt_id,p_snapshot,v_hash,p_snapshot->>'subject',p_snapshot->>'setId')
    on conflict(owner_id,client_attempt_id) do nothing returning * into v_attempt;
  if not found then
    select * into v_attempt from public.dd2026_forecast_attempts where owner_id=p_actor_user_id and client_attempt_id=p_client_attempt_id for update;
    if v_attempt.payload_hash<>v_hash or v_attempt.snapshot<>p_snapshot then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_CONFLICT','This submission was already accepted with different answers. Open its saved report.',409);
    end if;
    return jsonb_build_object('ok',true,'alreadyAccepted',true,'attempt',public.dd2026_forecast_attempt_public(v_attempt.id));
  end if;
  insert into public.dd2026_forecast_batches(attempt_id,batch_index) select v_attempt.id,n from generate_series(0,4) n;
  insert into public.dd2026_forecast_attempt_events(attempt_id,event_type) values(v_attempt.id,'accepted');
  return jsonb_build_object('ok',true,'alreadyAccepted',false,'attempt',public.dd2026_forecast_attempt_public(v_attempt.id));
end;
$$;

create function public.dd2026_forecast_attempt_get(p_actor_user_id uuid,p_attempt_id uuid default null,p_client_attempt_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_attempt_id is null and p_client_attempt_id is not null then
    select id into p_attempt_id from public.dd2026_forecast_attempts where owner_id=p_actor_user_id and client_attempt_id=p_client_attempt_id;
  end if;
  if not exists(select 1 from public.dd2026_forecast_attempts where id=p_attempt_id and owner_id=p_actor_user_id) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','That saved Forecast is unavailable.',404);
  end if;
  return jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id));
end;
$$;

create function public.dd2026_forecast_attempt_history(p_actor_user_id uuid,p_limit integer default 20,p_before timestamptz default null,p_subject text default null,p_complete_only boolean default false,p_before_id uuid default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_items jsonb; v_analytics jsonb;
begin
  if p_actor_user_id is null or p_limit is null or p_limit not between 1 and 100 or (p_from is not null and p_to is not null and p_from>=p_to) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_HISTORY_INVALID','The history request is invalid.',400);
  end if;
  select coalesce(jsonb_agg(public.dd2026_forecast_attempt_public(a.id,false) order by a.accepted_at desc,a.id desc),'[]'::jsonb)
    into v_items from (
      select id,accepted_at from public.dd2026_forecast_attempts
      where owner_id=p_actor_user_id and (p_before is null
        or (p_before_id is null and accepted_at<p_before)
        or (p_before_id is not null and (accepted_at,id)<(p_before,p_before_id)))
        and (p_subject is null or subject=p_subject)
        and (p_from is null or coalesce(completed_at,accepted_at)>=p_from)
        and (p_to is null or coalesce(completed_at,accepted_at)<p_to)
        and (not p_complete_only or status='complete')
      order by accepted_at desc,id desc limit p_limit
    ) a;
  -- Aggregate the full matching owner history, never a cursor page. Pending or
  -- failed work is counted but never silently converted to a zero grade.
  with matching as materialized (
    select * from public.dd2026_forecast_attempts where owner_id=p_actor_user_id
      and (p_subject is null or subject=p_subject)
      and (p_from is null or coalesce(completed_at,accepted_at)>=p_from)
      and (p_to is null or coalesce(completed_at,accepted_at)<p_to)
  ), completed as materialized (
    select id,subject,completed_at,(result->>'percentage')::numeric percentage,
      (result#>>'{analytics,grammarAverage}')::numeric grammar_score,
      (result#>>'{analytics,issueSpottingAverage}')::numeric issue_score
    from matching where status='complete' and result_revision=1
      and result->>'complete'='true' and (result->>'completedQuestionCount')::integer=20
  ), subjects as (
    select subject,count(*) completed_count,round(avg(percentage),1) percentage,
      round(avg(grammar_score),1) grammar_score,round(avg(issue_score),1) issue_score
    from completed group by subject
  ), recent as (
    select * from completed order by completed_at desc,id desc limit 100
  ) select jsonb_build_object('completeOnly',true,
    'completedAttempts',(select count(*) from completed),
    'pendingAttempts',(select count(*) from matching where status in ('pending','processing','retryable_failed')),
    'failedAttempts',(select count(*) from matching where status='failed'),
    'averagePercentage',(select round(avg(percentage),1) from completed),
    'averageGrammarScore',(select round(avg(grammar_score),1) from completed),
    'averageIssueSpottingScore',(select round(avg(issue_score),1) from completed),
    'bySubject',(select coalesce(jsonb_agg(jsonb_build_object('subject',subject,'completedAttempts',completed_count,
      'averagePercentage',percentage,'averageGrammarScore',grammar_score,'averageIssueSpottingScore',issue_score) order by subject),'[]'::jsonb) from subjects),
    'trend',(select coalesce(jsonb_agg(jsonb_build_object('attemptId',id,'subject',subject,'completedAt',completed_at,
      'percentage',percentage,'grammarScore',grammar_score,'issueSpottingScore',issue_score) order by completed_at,id),'[]'::jsonb) from recent),
    'trendLimit',100,'from',p_from,'to',p_to)
    into v_analytics;
  return jsonb_build_object('ok',true,'attempts',v_items,'analytics',v_analytics,
    'nextBefore',case when jsonb_array_length(v_items)=p_limit then v_items->(p_limit-1)->>'acceptedAt' else null end,
    'nextCursor',case when jsonb_array_length(v_items)=p_limit then jsonb_build_object(
      'acceptedAt',v_items->(p_limit-1)->>'acceptedAt','id',v_items->(p_limit-1)->>'id') else null end);
end;
$$;

create function public.dd2026_forecast_attempt_claim(p_attempt_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_a public.dd2026_forecast_attempts%rowtype;
  v_b public.dd2026_forecast_batches%rowtype;
  v_rows jsonb;
  v_now timestamptz := statement_timestamp();
begin
  -- One live provider batch across overlapping scheduled/legacy handlers. The
  -- transaction lock only covers claiming; the durable lease covers model time.
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_claim_v1',0));
  if exists(select 1 from public.dd2026_forecast_batches where status='processing' and lease_expires_at>v_now) then
    return jsonb_build_object('ok',true,'claimed',false,'busy',true);
  end if;
  select a.* into v_a from public.dd2026_forecast_attempts a
  where (p_attempt_id is null or a.id=p_attempt_id) and a.status in ('pending','processing','retryable_failed')
    and not exists(select 1 from public.dd2026_forecast_batches f where f.attempt_id=a.id and f.status='failed')
    and (
      not exists(select 1 from public.dd2026_forecast_batches b where b.attempt_id=a.id and b.status<>'complete')
      or exists(select 1 from public.dd2026_forecast_batches b where b.attempt_id=a.id and b.status<>'complete'
        and not exists(select 1 from public.dd2026_forecast_batches earlier where earlier.attempt_id=a.id and earlier.batch_index<b.batch_index and earlier.status<>'complete')
        and ((b.status in ('pending','retryable_failed') and b.retry_at<=v_now)
          or (b.status='processing' and b.lease_expires_at<=v_now)))
    ) order by a.last_claimed_at nulls first,a.accepted_at,a.id for update of a skip locked limit 1;
  if not found then return jsonb_build_object('ok',true,'claimed',false); end if;
  update public.dd2026_forecast_attempts set last_claimed_at=v_now,updated_at=v_now where id=v_a.id;
  select * into v_b from public.dd2026_forecast_batches where attempt_id=v_a.id and status<>'complete' order by batch_index limit 1 for update;
  if not found then
    return jsonb_build_object('ok',true,'claimed',false,'readyToFinalize',true,'attemptId',v_a.id);
  end if;
  if v_b.status='processing' then
    insert into public.dd2026_forecast_attempt_events(attempt_id,batch_index,event_type,details)
      values(v_a.id,v_b.batch_index,'lease_expired_uncertain',jsonb_build_object('execution',v_b.executions));
  end if;
  if v_b.executions>=4+v_a.manual_retries then
    update public.dd2026_forecast_batches set status='failed',lease_token=null,lease_expires_at=null,
      last_error_code='BAR_FORECAST_RETRY_LIMIT',updated_at=v_now,
      uncertain_outcomes=uncertain_outcomes+case when v_b.status='processing' then 1 else 0 end
      where attempt_id=v_a.id and batch_index=v_b.batch_index;
    update public.dd2026_forecast_attempts set status='failed',updated_at=v_now where id=v_a.id;
    insert into public.dd2026_forecast_attempt_events(attempt_id,batch_index,event_type) values(v_a.id,v_b.batch_index,'retry_limit');
    return jsonb_build_object('ok',true,'claimed',false,'attemptId',v_a.id,'exhausted',true);
  end if;
  update public.dd2026_forecast_batches set status='processing',executions=executions+1,
    lease_token=gen_random_uuid(),lease_expires_at=v_now+interval '600 seconds',updated_at=v_now,
    uncertain_outcomes=uncertain_outcomes+case when v_b.status='processing' then 1 else 0 end
    where attempt_id=v_a.id and batch_index=v_b.batch_index returning * into v_b;
  update public.dd2026_forecast_attempts set status='processing' where id=v_a.id;
  select jsonb_agg(r order by n) into v_rows from jsonb_array_elements(v_a.snapshot->'rows') with ordinality x(r,n)
    where n>v_b.batch_index*4 and n<=(v_b.batch_index+1)*4;
  insert into public.dd2026_forecast_attempt_events(attempt_id,batch_index,event_type,details)
    values(v_a.id,v_b.batch_index,'claimed',jsonb_build_object('execution',v_b.executions));
  return jsonb_build_object('ok',true,'claimed',true,'attemptId',v_a.id,'ownerId',v_a.owner_id,
    'batchIndex',v_b.batch_index,'execution',v_b.executions,'leaseToken',v_b.lease_token,
    'leaseExpiresAt',v_b.lease_expires_at,'rows',v_rows);
end;
$$;

create function public.dd2026_forecast_batch_valid(p_result jsonb,p_rows jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_row jsonb; v_grade jsonb; v_correction jsonb; v_issue jsonb;
begin
  if jsonb_typeof(p_result->'results') is distinct from 'array' or jsonb_typeof(p_rows) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_result->'results')<>4 or jsonb_array_length(p_rows)<>4 then return false; end if;
  if (select count(distinct r->>'questionId') from jsonb_array_elements(p_result->'results') r)<>4 then return false; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    select r into v_grade from jsonb_array_elements(p_result->'results') r where r->>'questionId'=v_row->>'id';
    if v_grade is null or jsonb_typeof(v_grade->'score') is distinct from 'number'
      or (v_grade->>'score')::numeric not between 0 and 5
      or (v_grade->>'score')::numeric*10<>trunc((v_grade->>'score')::numeric*10)
      or jsonb_typeof(v_grade#>'{grammar,score}') is distinct from 'number'
      or (v_grade#>>'{grammar,score}')::numeric not between 0 and 5
      or (v_grade#>>'{grammar,score}')::numeric*10<>trunc((v_grade#>>'{grammar,score}')::numeric*10)
      or jsonb_typeof(v_grade#>'{issueSpotting,score}') is distinct from 'number'
      or (v_grade#>>'{issueSpotting,score}')::numeric not between 0 and 5
      or (v_grade#>>'{issueSpotting,score}')::numeric*10<>trunc((v_grade#>>'{issueSpotting,score}')::numeric*10)
      or jsonb_typeof(v_grade#>'{grammar,corrections}') is distinct from 'array'
      or jsonb_typeof(v_grade#>'{issueSpotting,identified}') is distinct from 'array'
      or jsonb_typeof(v_grade#>'{issueSpotting,missed}') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_grade#>'{grammar,corrections}')>5
      or jsonb_array_length(v_grade#>'{issueSpotting,identified}')>5
      or jsonb_array_length(v_grade#>'{issueSpotting,missed}')>5 then return false; end if;
    if (select count(distinct lower(i#>>'{}')) from jsonb_array_elements((v_grade#>'{issueSpotting,identified}')||(v_grade#>'{issueSpotting,missed}')) i)
      <>jsonb_array_length(v_grade#>'{issueSpotting,identified}')+jsonb_array_length(v_grade#>'{issueSpotting,missed}') then return false; end if;
    for v_correction in select value from jsonb_array_elements(v_grade#>'{grammar,corrections}') loop
      if coalesce(v_correction->>'original','')='' or position(v_correction->>'original' in v_row->>'userAnswer')=0
        or coalesce(v_correction->>'category','') not in ('punctuation','capitalization','agreement','spelling','sentence_structure','wordiness','professional_tone') then return false; end if;
    end loop;
    for v_issue in select value from jsonb_array_elements((v_grade#>'{issueSpotting,identified}')||(v_grade#>'{issueSpotting,missed}')) loop
      if jsonb_typeof(v_issue)<>'string' or length(v_issue#>>'{}')<8
        or (position(v_issue#>>'{}' in v_row->>'prompt')=0 and position(v_issue#>>'{}' in v_row->>'suggestedAnswer')=0) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.dd2026_forecast_attempt_checkpoint(p_attempt_id uuid,p_batch_index integer,p_lease_token uuid,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_a public.dd2026_forecast_attempts%rowtype; v_b public.dd2026_forecast_batches%rowtype; v_rows jsonb; v_count integer;
begin
  select * into v_a from public.dd2026_forecast_attempts where id=p_attempt_id for update;
  select * into v_b from public.dd2026_forecast_batches where attempt_id=p_attempt_id and batch_index=p_batch_index for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','The processing claim is unavailable.',404); end if;
  if v_b.status='complete' and v_b.result=p_result then
    select count(*) into v_count from public.dd2026_forecast_batches where attempt_id=p_attempt_id and status='complete';
    return jsonb_build_object('ok',true,'accepted',true,'alreadySaved',true,'readyToFinalize',v_count=5,
      'completedQuestionCount',v_count*4,'attemptId',p_attempt_id);
  end if;
  if v_b.status<>'processing' or v_b.lease_token is distinct from p_lease_token or v_b.lease_expires_at<=statement_timestamp() then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_LEASE_LOST','Another processor owns this saved assessment.',409);
  end if;
  select jsonb_agg(r order by n) into v_rows from jsonb_array_elements(v_a.snapshot->'rows') with ordinality x(r,n)
    where n>p_batch_index*4 and n<=(p_batch_index+1)*4;
  if not public.dd2026_forecast_batch_valid(p_result,v_rows) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_GRADING_INVALID','The assessment did not contain four valid ordered results.',502);
  end if;
  update public.dd2026_forecast_batches set result=p_result,status='complete',lease_token=null,lease_expires_at=null,last_error_code=null,updated_at=statement_timestamp()
    where attempt_id=p_attempt_id and batch_index=p_batch_index;
  select count(*) into v_count from public.dd2026_forecast_batches where attempt_id=p_attempt_id and status='complete';
  update public.dd2026_forecast_attempts set updated_at=statement_timestamp() where id=p_attempt_id;
  insert into public.dd2026_forecast_attempt_events(attempt_id,batch_index,event_type) values(p_attempt_id,p_batch_index,'checkpoint_saved');
  return jsonb_build_object('ok',true,'accepted',true,'readyToFinalize',v_count=5,'completedQuestionCount',v_count*4,'attemptId',p_attempt_id);
end;
$$;

create function public.dd2026_forecast_attempt_fail(p_attempt_id uuid,p_batch_index integer,p_lease_token uuid,p_error_code text,p_retryable boolean,p_outcome_uncertain boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_a public.dd2026_forecast_attempts%rowtype; v_b public.dd2026_forecast_batches%rowtype; v_status text; v_delay integer;
begin
  select * into v_a from public.dd2026_forecast_attempts where id=p_attempt_id for update;
  select * into v_b from public.dd2026_forecast_batches where attempt_id=p_attempt_id and batch_index=p_batch_index for update;
  if not found or v_b.status<>'processing' or v_b.lease_token is distinct from p_lease_token or v_b.lease_expires_at<=statement_timestamp() then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_LEASE_LOST','Another processor owns this saved assessment.',409);
  end if;
  v_status := case when p_retryable and v_b.executions<4+v_a.manual_retries then 'retryable_failed' else 'failed' end;
  v_delay := case v_b.executions when 1 then 30 when 2 then 120 else 300 end;
  update public.dd2026_forecast_batches set status=v_status,lease_token=null,lease_expires_at=null,
    retry_at=statement_timestamp()+make_interval(secs=>v_delay),
    last_error_code=left(regexp_replace(coalesce(p_error_code,'BAR_FORECAST_PROCESSING_FAILED'),'[^A-Z0-9_]','_','g'),80),
    uncertain_outcomes=uncertain_outcomes+case when p_outcome_uncertain then 1 else 0 end,updated_at=statement_timestamp()
    where attempt_id=p_attempt_id and batch_index=p_batch_index;
  update public.dd2026_forecast_attempts set status=v_status,updated_at=statement_timestamp() where id=p_attempt_id;
  insert into public.dd2026_forecast_attempt_events(attempt_id,batch_index,event_type,details)
    values(p_attempt_id,p_batch_index,'processing_failed',jsonb_build_object('retryable',v_status='retryable_failed','outcomeUncertain',p_outcome_uncertain));
  return jsonb_build_object('ok',true,'status',v_status,'retryAfterSeconds',case when v_status='retryable_failed' then v_delay else null end);
end;
$$;

-- Private processor read; never expose this RPC response from a user route.
create function public.dd2026_forecast_attempt_internal(p_attempt_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('ok',true,'status',a.status,'ownerId',a.owner_id,'snapshot',a.snapshot,'acceptedAt',a.accepted_at,
    'publicAttempt',jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(a.id)),
    'batches',(select jsonb_agg(jsonb_build_object('batchIndex',b.batch_index,'status',b.status,'result',b.result) order by b.batch_index)
      from public.dd2026_forecast_batches b where b.attempt_id=a.id))
    from public.dd2026_forecast_attempts a where a.id=p_attempt_id;
$$;

-- Deterministic finalization errors are terminal, not another provider retry.
-- No caller-supplied details are logged; all completed batches remain immutable.
create function public.dd2026_forecast_attempt_finalization_error(p_attempt_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_a public.dd2026_forecast_attempts%rowtype;
begin
  select * into v_a from public.dd2026_forecast_attempts where id=p_attempt_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','The saved Forecast is unavailable.',404); end if;
  if v_a.status='complete' then return jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id)); end if;
  if (select count(*) from public.dd2026_forecast_batches where attempt_id=p_attempt_id and status='complete')<>5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_RESULT_INCOMPLETE','All 20 saved assessments are required.',409);
  end if;
  if v_a.status<>'failed' then
    update public.dd2026_forecast_attempts set status='failed',updated_at=statement_timestamp() where id=p_attempt_id;
    insert into public.dd2026_forecast_attempt_events(attempt_id,event_type,details)
      values(p_attempt_id,'finalization_failed',jsonb_build_object('code','BAR_FORECAST_GRADING_INVALID'));
  end if;
  return public.dd2026_forecast_attempt_error('BAR_FORECAST_GRADING_INVALID','Your answers remain saved. Use the available manual retry or contact support.',502);
end;
$$;

create function public.dd2026_forecast_attempt_finalize(p_attempt_id uuid,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_a public.dd2026_forecast_attempts%rowtype; v_row jsonb; v_grade jsonb; v_saved jsonb;
  v_number integer:=0; v_total numeric:=0; v_grammar numeric:=0; v_issues numeric:=0;
  v_strong integer:=0; v_developing integer:=0; v_focus integer:=0; v_analytics jsonb;
begin
  select * into v_a from public.dd2026_forecast_attempts where id=p_attempt_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','The saved Forecast is unavailable.',404); end if;
  if v_a.status='complete' then
    if v_a.result is distinct from p_result then return public.dd2026_forecast_attempt_error('BAR_FORECAST_RESULT_CONFLICT','The completed result cannot be replaced.',409); end if;
    return jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id));
  end if;
  if (select count(*) from public.dd2026_forecast_batches where attempt_id=p_attempt_id and status='complete')<>5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_RESULT_INCOMPLETE','All 20 saved assessments are required.',409);
  end if;
  if v_a.status='failed' then return public.dd2026_forecast_attempt_finalization_error(p_attempt_id); end if;
  if p_result->'complete' is distinct from 'true'::jsonb
    or p_result->>'schemaVersion' is distinct from 'forecast-attempt-v1'
    or p_result->>'attemptId' is distinct from p_attempt_id::text
    or p_result->>'ownerId' is distinct from v_a.owner_id::text
    or p_result->'resultRevision' is distinct from '1'::jsonb
    or p_result->>'setId' is distinct from v_a.set_id
    or p_result->>'subject' is distinct from v_a.subject
    or p_result->>'rubricVersion' is distinct from v_a.snapshot->>'rubricVersion'
    or p_result->>'contentVersion' is distinct from v_a.snapshot->>'contentVersion'
    or jsonb_typeof(p_result->'results') is distinct from 'array' then
    return public.dd2026_forecast_attempt_finalization_error(p_attempt_id);
  end if;
  if jsonb_array_length(p_result->'results')<>20 then return public.dd2026_forecast_attempt_finalization_error(p_attempt_id); end if;
  for v_row in select value from jsonb_array_elements(v_a.snapshot->'rows') loop
    v_grade := p_result->'results'->v_number;
    select g into v_saved from public.dd2026_forecast_batches b,
      jsonb_array_elements(b.result->'results') g where b.attempt_id=p_attempt_id and g->>'questionId'=v_row->>'id';
    if v_grade->>'questionId' is distinct from v_row->>'id'
      or v_grade->'number' is distinct from v_row->'number'
      or v_grade->>'userAnswer' is distinct from v_row->>'userAnswer'
      or v_grade->>'question' is distinct from v_row->>'prompt'
      or v_grade->>'suggestedAnswer' is distinct from v_row->>'suggestedAnswer'
      or v_grade->>'legalBasis' is distinct from v_row->>'legalBasis'
      or v_grade->>'jurisprudence' is distinct from v_row->>'jurisprudence'
      or v_grade->>'citation' is distinct from v_row->>'citation'
      or v_grade->'score' is distinct from v_saved->'score'
      or v_grade->'maxScore' is distinct from '5'::jsonb
      or v_grade#>'{grammar,score}' is distinct from v_saved#>'{grammar,score}'
      or v_grade#>'{grammar,corrections}' is distinct from v_saved#>'{grammar,corrections}'
      or v_grade#>'{issueSpotting,score}' is distinct from v_saved#>'{issueSpotting,score}'
      or v_grade#>'{issueSpotting,identified}' is distinct from v_saved#>'{issueSpotting,identified}'
      or v_grade#>'{issueSpotting,missed}' is distinct from v_saved#>'{issueSpotting,missed}'
      or coalesce(v_grade->>'feedback','')='' or coalesce(v_grade->>'explanation','')=''
      or coalesce(v_grade#>>'{mockBarCoaching,strength}','')=''
      or coalesce(v_grade#>>'{mockBarCoaching,priorityImprovement}','')=''
      or coalesce(v_grade#>>'{mockBarCoaching,nextStep}','')='' then
      return public.dd2026_forecast_attempt_finalization_error(p_attempt_id);
    end if;
    v_total:=v_total+(v_grade->>'score')::numeric;
    v_grammar:=v_grammar+(v_saved#>>'{grammar,score}')::numeric;
    v_issues:=v_issues+(v_saved#>>'{issueSpotting,score}')::numeric;
    if (v_grade->>'score')::numeric>=4 then v_strong:=v_strong+1;
    elsif (v_grade->>'score')::numeric>=2.5 then v_developing:=v_developing+1;
    else v_focus:=v_focus+1; end if;
    v_number:=v_number+1;
  end loop;
  v_analytics:=jsonb_build_object('questionCount',20,'averageScore',round(v_total/20,1),
    'grammarAverage',round(v_grammar/20,1),'issueSpottingAverage',round(v_issues/20,1),
    'diagnosticMaxScore',5,'performanceBands',jsonb_build_object('strong',v_strong,'developing',v_developing,'needsFocus',v_focus));
  if p_result->'totalScore' is distinct from to_jsonb(v_total) or p_result->'maxScore' is distinct from '100'::jsonb
    or p_result->'percentage' is distinct from to_jsonb(v_total)
    or p_result#>'{summary,totalScore}' is distinct from to_jsonb(v_total)
    or p_result#>'{summary,maxScore}' is distinct from '100'::jsonb
    or p_result#>'{summary,percentage}' is distinct from to_jsonb(v_total)
    or p_result#>'{summary,completedQuestionCount}' is distinct from '20'::jsonb
    or p_result#>'{summary,questionCount}' is distinct from '20'::jsonb
    or p_result->'analytics' is distinct from v_analytics
    or p_result->'completedQuestionCount' is distinct from '20'::jsonb
    or p_result->'questionCount' is distinct from '20'::jsonb then
    return public.dd2026_forecast_attempt_finalization_error(p_attempt_id);
  end if;
  update public.dd2026_forecast_attempts set status='complete',result=p_result,result_revision=1,
    completed_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_attempt_id;
  insert into public.dd2026_forecast_attempt_events(attempt_id,event_type) values(p_attempt_id,'completed');
  return jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id));
end;
$$;

create function public.dd2026_forecast_attempt_retry(p_actor_user_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_a public.dd2026_forecast_attempts%rowtype;
begin
  select * into v_a from public.dd2026_forecast_attempts where id=p_attempt_id and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','That saved Forecast is unavailable.',404); end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  if v_a.status<>'failed' then return jsonb_build_object('ok',true,'alreadyScheduled',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id)); end if;
  if v_a.manual_retries>=2 then return public.dd2026_forecast_attempt_error('BAR_FORECAST_RETRY_LIMIT','Your answers remain saved. Further recovery needs support review.',409); end if;
  update public.dd2026_forecast_attempts set status='pending',manual_retries=manual_retries+1,updated_at=statement_timestamp() where id=p_attempt_id;
  update public.dd2026_forecast_batches set status='pending',retry_at=statement_timestamp(),updated_at=statement_timestamp()
    where attempt_id=p_attempt_id and status='failed';
  insert into public.dd2026_forecast_attempt_events(attempt_id,event_type) values(p_attempt_id,'manual_retry');
  return jsonb_build_object('ok',true,'attempt',public.dd2026_forecast_attempt_public(p_attempt_id));
end;
$$;

-- Function EXECUTE is PUBLIC by default: revoke each newly created boundary.
do $$ declare v_function regprocedure; begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'dd2026_forecast_attempt_immutable','dd2026_forecast_attempt_error','dd2026_forecast_attempt_public',
      'dd2026_forecast_attempt_accept','dd2026_forecast_attempt_get','dd2026_forecast_attempt_history',
      'dd2026_forecast_attempt_claim','dd2026_forecast_batch_valid','dd2026_forecast_attempt_checkpoint',
      'dd2026_forecast_attempt_fail','dd2026_forecast_attempt_internal','dd2026_forecast_attempt_finalize',
      'dd2026_forecast_attempt_finalization_error','dd2026_forecast_attempt_retry')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function);
    execute format('grant execute on function %s to service_role',v_function);
  end loop;
end $$;

commit;
