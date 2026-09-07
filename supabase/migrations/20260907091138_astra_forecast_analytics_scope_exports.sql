-- Explicit owner-requested, immutable Forecast reporting scopes. No grading,
-- historical regrade, customer update, or email send occurs in this migration.
-- Requires 20260907060650 and 20260907064532; deploy before scope-export code.
begin;

create table public.dd2026_forecast_analytics_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  filter jsonb not null,
  manifest jsonb not null check (jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 1000),
  analytics jsonb not null,
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  template_version text not null default 'forecast-analytics-pdf-v1' check (template_version='forecast-analytics-pdf-v1'),
  created_at timestamptz not null default statement_timestamp(),
  pdf_hash text check (pdf_hash ~ '^[0-9a-f]{64}$'),
  file_name text,
  byte_count integer check (byte_count between 1 and 10485760),
  downloads integer not null default 0,
  email_status text not null default 'not_requested' check (email_status in ('not_requested','processing','provider_accepted','uncertain','failed')),
  recipient_hash text,
  email_requested_at timestamptz,
  email_retry_at timestamptz,
  email_executions integer not null default 0 check (email_executions between 0 and 3),
  email_lease uuid,
  email_lease_expires_at timestamptz,
  provider_id text,
  settled_lease uuid,
  unique(owner_id,scope_hash),
  unique(id,owner_id),
  check ((pdf_hash is null and file_name is null and byte_count is null)
    or (pdf_hash is not null and file_name is not null and byte_count is not null)),
  check ((email_status='processing')=(email_lease is not null and email_lease_expires_at is not null))
);
create table public.dd2026_forecast_analytics_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  scope_id uuid not null,
  primary key(owner_id,request_id),
  foreign key(scope_id,owner_id) references public.dd2026_forecast_analytics_exports(id,owner_id) on delete cascade
);
create index dd2026_forecast_analytics_email_rate on public.dd2026_forecast_analytics_exports(owner_id,email_requested_at) where email_requested_at is not null;
alter table public.dd2026_forecast_analytics_exports enable row level security;
alter table public.dd2026_forecast_analytics_exports force row level security;
alter table public.dd2026_forecast_analytics_requests enable row level security;
alter table public.dd2026_forecast_analytics_requests force row level security;
revoke all on public.dd2026_forecast_analytics_exports,public.dd2026_forecast_analytics_requests from public,anon,authenticated;
grant select,insert,update,delete on public.dd2026_forecast_analytics_exports to service_role;
grant select,insert on public.dd2026_forecast_analytics_requests to service_role;

create function public.dd2026_forecast_analytics_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.id,new.owner_id,new.filter,new.manifest,new.analytics,new.scope_hash,new.template_version,new.created_at)
      is distinct from (old.id,old.owner_id,old.filter,old.manifest,old.analytics,old.scope_hash,old.template_version,old.created_at)
    or (old.pdf_hash is not null and (new.pdf_hash,new.file_name,new.byte_count) is distinct from (old.pdf_hash,old.file_name,old.byte_count))
    or (old.recipient_hash is not null and new.recipient_hash is distinct from old.recipient_hash)
    or (old.email_requested_at is not null and new.email_requested_at is distinct from old.email_requested_at)
    or (old.email_status='provider_accepted' and (new.email_status,new.provider_id) is distinct from (old.email_status,old.provider_id)) then
    raise exception 'Saved analytics scope and accepted email identity are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger dd2026_forecast_analytics_immutable before update on public.dd2026_forecast_analytics_exports
for each row execute function public.dd2026_forecast_analytics_immutable();

create function public.dd2026_forecast_analytics_saved_classification(p_payload text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; v_unit text; v_name text; v_topic text;
begin
  begin v:=p_payload::jsonb; exception when invalid_text_representation then return null; end;
  if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'syllabus_unit_id') is distinct from 'string'
    or jsonb_typeof(v->'syllabus_unit') is distinct from 'string' then return null; end if;
  v_unit:=v->>'syllabus_unit_id'; v_name:=v->>'syllabus_unit'; v_topic:=v->>'syllabus_topic';
  if v_unit is null or v_unit !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' or v_name is null or length(btrim(v_name)) not between 1 and 240 then return null; end if;
  return jsonb_build_object('unitId',v_unit,'unit',v_name,'topic',case when jsonb_typeof(v->'syllabus_topic')='string' and length(btrim(v_topic)) between 1 and 500 then v_topic else null end);
end;
$$;

create function public.dd2026_forecast_analytics_classifications(p_actor_user_id uuid,p_subject text default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with completed as materialized (
    select * from public.dd2026_forecast_attempts where owner_id=p_actor_user_id
      and (p_subject is null or subject=p_subject) and (p_from is null or coalesce(completed_at,accepted_at)>=p_from)
      and (p_to is null or coalesce(completed_at,accepted_at)<p_to)
      and status='complete' and result_revision=1 and result->>'complete'='true' and (result->>'completedQuestionCount')::integer=20
  ), samples as materialized (
    select a.id attempt_id,a.subject,r->>'questionId' question_id,(r->>'score')::numeric score,
      public.dd2026_forecast_analytics_saved_classification(s->>'payloadCanonical') classification
    from completed a cross join lateral jsonb_array_elements(a.result->'results') r
    left join lateral (select q from jsonb_array_elements(a.snapshot->'rows') q where q->>'id'=r->>'questionId') saved(s) on true
  ), units as (
    select subject,classification->>'unitId' unit_id,classification->>'unit' unit,count(*) question_samples,
      count(distinct attempt_id) completed_attempts,round(avg(score),1) average_score
    from samples where classification is not null group by subject,classification->>'unitId',classification->>'unit'
  ), topics as (
    select subject,classification->>'unitId' unit_id,classification->>'topic' topic,count(*) question_samples,
      count(distinct attempt_id) completed_attempts,round(avg(score),1) average_score
    from samples where classification->>'topic' is not null group by subject,classification->>'unitId',classification->>'topic'
  ) select jsonb_build_object(
    'byUnit',(select coalesce(jsonb_agg(jsonb_build_object('subject',subject,'unitId',unit_id,'unit',unit,
      'questionSamples',question_samples,'completedAttempts',completed_attempts,'averageScore',average_score) order by subject,unit_id,unit),'[]'::jsonb) from units),
    'byTopic',(select coalesce(jsonb_agg(jsonb_build_object('subject',subject,'unitId',unit_id,'topic',topic,
      'questionSamples',question_samples,'completedAttempts',completed_attempts,'averageScore',average_score) order by subject,unit_id,topic),'[]'::jsonb) from topics),
    'classificationCoverage',(select jsonb_build_object('questionSamples',count(*),'completedAttempts',count(distinct attempt_id),
      'unitClassifiedQuestions',count(*) filter(where classification is not null),
      'unitUnknownQuestions',count(*) filter(where classification is null),
      'topicClassifiedQuestions',count(*) filter(where classification->>'topic' is not null),
      'topicUnknownQuestions',count(*) filter(where classification->>'topic' is null)) from samples));
$$;

-- Existing callers can retain the original history RPC. The new view explicitly
-- requests this projection; both its aggregates run at the same SQL snapshot.
create function public.dd2026_forecast_analytics_history(p_actor_user_id uuid,p_limit integer default 20,p_before timestamptz default null,p_subject text default null,p_complete_only boolean default false,p_before_id uuid default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with history as materialized (select public.dd2026_forecast_attempt_history(p_actor_user_id,p_limit,p_before,p_subject,p_complete_only,p_before_id,p_from,p_to) value)
  select case when value->>'ok'='false' then value else value || jsonb_build_object('analytics',value->'analytics'
    || public.dd2026_forecast_analytics_classifications(p_actor_user_id,p_subject,p_from,p_to)) end from history;
$$;

create function public.dd2026_forecast_analytics_email_public(p_scope_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',case when email_status='processing' and email_lease_expires_at<=statement_timestamp() then 'uncertain' else email_status end,
    'alreadyRequested',email_requested_at is not null,'providerAccepted',email_status='provider_accepted','deliveryConfirmed',false,
    'retryAllowed',(email_status in ('failed','uncertain') or (email_status='processing' and email_lease_expires_at<=statement_timestamp()))
      and email_executions<3 and email_requested_at>statement_timestamp()-interval '23 hours'
      and (email_retry_at is null or email_retry_at<=statement_timestamp()), 'retryAt',email_retry_at,'requestedAt',email_requested_at)
  from public.dd2026_forecast_analytics_exports where id=p_scope_id;
$$;

create function public.dd2026_forecast_analytics_get(p_actor_user_id uuid,p_scope_id uuid,p_with_answers boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_scope public.dd2026_forecast_analytics_exports%rowtype; v_attempts jsonb;
begin
  select * into v_scope from public.dd2026_forecast_analytics_exports where id=p_scope_id and owner_id=p_actor_user_id;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_NOT_FOUND','This saved analytics report is unavailable.',404); end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  if exists(select 1 from jsonb_array_elements(v_scope.manifest) m
    left join public.dd2026_forecast_attempts a on a.id=(m->>'attemptId')::uuid and a.owner_id=p_actor_user_id
    where a.id is null or a.status<>'complete' or a.result_revision<>(m->>'resultRevision')::integer
      or encode(sha256(convert_to(a.result::text,'UTF8')),'hex') is distinct from m->>'resultHash') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_CHANGED','A report in this saved scope changed or is unavailable. Create a new scope; no scores were substituted.',409);
  end if;
  if p_with_answers then
    select jsonb_agg(public.dd2026_forecast_attempt_public((m->>'attemptId')::uuid,true) order by n)
      into v_attempts from jsonb_array_elements(v_scope.manifest) with ordinality x(m,n);
  end if;
  return jsonb_build_object('ok',true,'scope',jsonb_build_object(
    'id',v_scope.id,'ownerId',v_scope.owner_id,'schemaVersion','forecast-analytics-scope-v1',
    'filter',v_scope.filter,'manifest',v_scope.manifest,'analytics',v_scope.analytics,'scopeHash',v_scope.scope_hash,
    'templateVersion',v_scope.template_version,'createdAt',v_scope.created_at),
    'attempts',v_attempts,'email',public.dd2026_forecast_analytics_email_public(p_scope_id));
end;
$$;

create function public.dd2026_forecast_analytics_snapshot(p_actor_user_id uuid,p_request_id uuid,p_subject text default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_filter jsonb; v_manifest jsonb; v_analytics jsonb; v_hash text; v_scope public.dd2026_forecast_analytics_exports%rowtype;
begin
  if p_actor_user_id is null or p_request_id is null or (p_from is not null and not isfinite(p_from))
    or (p_to is not null and not isfinite(p_to)) or (p_from is not null and p_to is not null and p_from>=p_to)
    or (p_subject is not null and p_subject not in ('Political and Public International Law','Commercial and Taxation Laws',
      'Civil Law and Land Titles and Deeds','Labor Law and Social Legislation','Criminal Law',
      'Remedial Law, Legal and Judicial Ethics, with Practical Exercises')) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_HISTORY_INVALID','Choose valid subject and date filters.',400);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  v_filter:=jsonb_build_object('subject',p_subject,'from',p_from,'to',p_to,'completeOnly',true,'timeZone','Asia/Manila');
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_scope/'||p_actor_user_id::text,0));
  select e.* into v_scope from public.dd2026_forecast_analytics_requests r
    join public.dd2026_forecast_analytics_exports e on e.id=r.scope_id and e.owner_id=r.owner_id
    where r.owner_id=p_actor_user_id and r.request_id=p_request_id;
  if found then
    if v_scope.filter<>v_filter then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_REQUEST_CONFLICT','This export request belongs to different filters. Create a new request.',409); end if;
    return public.dd2026_forecast_analytics_get(p_actor_user_id,v_scope.id,false);
  end if;
  -- ONE statement snapshot: canonical existing SQL aggregate plus the complete
  -- matching revision manifest. Neither depends on a history cursor/page.
  with completed as materialized (
    select a.* from public.dd2026_forecast_attempts a where owner_id=p_actor_user_id
      and (p_subject is null or subject=p_subject)
      and (p_from is null or coalesce(completed_at,accepted_at)>=p_from)
      and (p_to is null or coalesce(completed_at,accepted_at)<p_to)
      and status='complete' and result_revision=1 and result->>'complete'='true'
      and (result->>'completedQuestionCount')::integer=20
  ) select coalesce((select jsonb_agg(jsonb_build_object('attemptId',id,'resultRevision',result_revision,
      'resultHash',encode(sha256(convert_to(result::text,'UTF8')),'hex'),'subject',subject,
      'acceptedAt',accepted_at,'completedAt',completed_at,'summary',result->'summary') order by completed_at,id) from completed),'[]'::jsonb),
    public.dd2026_forecast_analytics_history(p_actor_user_id,1,null,p_subject,true,null,p_from,p_to)->'analytics'
    into v_manifest,v_analytics;
  if jsonb_array_length(v_manifest)=0 then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_EMPTY','No completed valid reports match these filters.',409); end if;
  if jsonb_array_length(v_manifest)>1000 then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_SIZE_LIMIT','Choose a narrower reporting period. No attempts were omitted.',413); end if;
  if (v_analytics->>'completedAttempts')::integer<>jsonb_array_length(v_manifest) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_CHANGED','The saved reporting scope could not be verified. Retry without changing your results.',409);
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('ownerId',p_actor_user_id,'filter',v_filter,
    'manifest',v_manifest,'analytics',v_analytics,'templateVersion','forecast-analytics-pdf-v1')::text,'UTF8')),'hex');
  insert into public.dd2026_forecast_analytics_exports(owner_id,filter,manifest,analytics,scope_hash)
    values(p_actor_user_id,v_filter,v_manifest,v_analytics,v_hash) on conflict(owner_id,scope_hash) do nothing;
  select * into v_scope from public.dd2026_forecast_analytics_exports where owner_id=p_actor_user_id and scope_hash=v_hash;
  insert into public.dd2026_forecast_analytics_requests(owner_id,request_id,scope_id) values(p_actor_user_id,p_request_id,v_scope.id);
  return public.dd2026_forecast_analytics_get(p_actor_user_id,v_scope.id,false);
end;
$$;

create function public.dd2026_forecast_analytics_pdf_record(p_actor_user_id uuid,p_scope_id uuid,p_pdf_hash text,p_file_name text,p_byte_count integer,p_download boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_scope public.dd2026_forecast_analytics_exports%rowtype; v_verified jsonb;
begin
  v_verified:=public.dd2026_forecast_analytics_get(p_actor_user_id,p_scope_id,false);
  if v_verified->>'ok' is distinct from 'true' then return v_verified; end if;
  if p_pdf_hash is null or p_pdf_hash !~ '^[0-9a-f]{64}$' or p_byte_count is null or p_byte_count not between 1 and 10485760
    or p_file_name is distinct from ('duediligence-forecast-analytics-'||p_scope_id::text||'-v1.pdf') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_INVALID','The saved PDF metadata is invalid.',400);
  end if;
  select * into v_scope from public.dd2026_forecast_analytics_exports where id=p_scope_id and owner_id=p_actor_user_id for update;
  if v_scope.pdf_hash is not null and (v_scope.pdf_hash,v_scope.file_name,v_scope.byte_count) is distinct from (p_pdf_hash,p_file_name,p_byte_count) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The existing saved PDF has a different fingerprint. No email was sent.',409);
  end if;
  update public.dd2026_forecast_analytics_exports set pdf_hash=p_pdf_hash,file_name=p_file_name,byte_count=p_byte_count,
    downloads=downloads+case when p_download then 1 else 0 end where id=p_scope_id;
  return jsonb_build_object('ok',true,'pdfHash',p_pdf_hash,'email',public.dd2026_forecast_analytics_email_public(p_scope_id));
end;
$$;

-- Both explicit export types share one five-report quota and owner lock.
create function public.dd2026_forecast_email_quota_used(p_actor_user_id uuid)
returns bigint language sql stable security invoker set search_path='' as $$
  select (select count(*) from public.dd2026_forecast_result_exports where owner_id=p_actor_user_id and email_requested_at>statement_timestamp()-interval '24 hours')
    +(select count(*) from public.dd2026_forecast_analytics_exports where owner_id=p_actor_user_id and email_requested_at>statement_timestamp()-interval '24 hours');
$$;

create function public.dd2026_forecast_analytics_email_claim(p_actor_user_id uuid,p_scope_id uuid,p_recipient_email text,p_pdf_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_scope public.dd2026_forecast_analytics_exports%rowtype; v_hash text; v_verified jsonb; v_now timestamptz:=statement_timestamp();
begin
  if not private.dd2026_forecast_verified_owner_email(p_actor_user_id,p_recipient_email) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED','Verify your account email before emailing this report.',409);
  end if;
  v_verified:=public.dd2026_forecast_analytics_get(p_actor_user_id,p_scope_id,false);
  if v_verified->>'ok' is distinct from 'true' then return v_verified; end if;
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_email/'||p_actor_user_id::text,0));
  select * into v_scope from public.dd2026_forecast_analytics_exports where id=p_scope_id and owner_id=p_actor_user_id for update;
  if v_scope.pdf_hash is null or v_scope.pdf_hash is distinct from p_pdf_hash then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The saved PDF fingerprint changed.',409); end if;
  v_hash:=encode(sha256(convert_to(p_recipient_email,'UTF8')),'hex');
  if v_scope.recipient_hash is not null and v_scope.recipient_hash<>v_hash then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RECIPIENT_CHANGED','This report email was already requested for a different verified address. Download the PDF instead.',409);
  end if;
  if v_scope.email_status='provider_accepted' or (v_scope.email_status='processing' and v_scope.email_lease_expires_at>v_now) then
    return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_analytics_email_public(p_scope_id));
  end if;
  if v_scope.email_requested_at is not null and (v_scope.email_executions>=3 or v_scope.email_requested_at<=v_now-interval '23 hours') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RETRY_LIMIT','Email recovery needs support review. The saved PDF is still available.',409);
  end if;
  if v_scope.email_retry_at>v_now then return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_analytics_email_public(p_scope_id)); end if;
  if v_scope.email_requested_at is null and public.dd2026_forecast_email_quota_used(p_actor_user_id)>=5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RATE_LIMIT','You can email five saved reports in 24 hours. Download the PDF instead.',429);
  end if;
  update public.dd2026_forecast_analytics_exports set email_status='processing',recipient_hash=v_hash,
    email_requested_at=coalesce(email_requested_at,v_now),email_executions=email_executions+1,
    email_lease=gen_random_uuid(),email_lease_expires_at=v_now+interval '120 seconds',email_retry_at=null where id=p_scope_id returning * into v_scope;
  return jsonb_build_object('ok',true,'claimed',true,'leaseToken',v_scope.email_lease,
    'idempotencyKey','forecast-analytics/'||p_scope_id::text||'/v1','email',public.dd2026_forecast_analytics_email_public(p_scope_id));
end;
$$;

create function public.dd2026_forecast_analytics_email_settle(p_actor_user_id uuid,p_scope_id uuid,p_lease_token uuid,p_status text,p_provider_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_scope public.dd2026_forecast_analytics_exports%rowtype;
begin
  select * into v_scope from public.dd2026_forecast_analytics_exports where id=p_scope_id and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ANALYTICS_NOT_FOUND','The saved email request is unavailable.',404); end if;
  if v_scope.settled_lease=p_lease_token and v_scope.email_status=p_status and v_scope.provider_id is not distinct from p_provider_id then
    return jsonb_build_object('ok',true,'email',public.dd2026_forecast_analytics_email_public(p_scope_id));
  end if;
  if v_scope.email_status<>'processing' or v_scope.email_lease is distinct from p_lease_token or v_scope.email_lease_expires_at<=statement_timestamp() then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_LEASE_LOST','Another processor owns the email request.',409);
  end if;
  if p_status is null or p_status not in ('provider_accepted','uncertain','failed') or (p_status='provider_accepted' and (p_provider_id is null or length(p_provider_id) not between 1 and 200)) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_STATUS_INVALID','The email provider status is invalid.',400);
  end if;
  update public.dd2026_forecast_analytics_exports set email_status=p_status,provider_id=p_provider_id,settled_lease=p_lease_token,
    email_lease=null,email_lease_expires_at=null,email_retry_at=case when p_status='provider_accepted' then null else statement_timestamp()+interval '30 seconds' end where id=p_scope_id;
  return jsonb_build_object('ok',true,'email',public.dd2026_forecast_analytics_email_public(p_scope_id));
end;
$$;

-- Preserve every existing individual-report guard. Only the quota source changes.
create or replace function public.dd2026_forecast_result_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_recipient_email text,p_pdf_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_export public.dd2026_forecast_result_exports%rowtype; v_hash text; v_now timestamptz:=statement_timestamp();
begin
  if not private.dd2026_forecast_verified_owner_email(p_actor_user_id,p_recipient_email) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED','Verify your account email before emailing this report.',409);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_email/'||p_actor_user_id::text,0));
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved report can be emailed.',409); end if;
  if v_export.pdf_hash is distinct from p_pdf_hash then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The saved PDF fingerprint changed.',409); end if;
  v_hash:=encode(sha256(convert_to(p_recipient_email,'UTF8')),'hex');
  if v_export.recipient_hash is not null and v_export.recipient_hash<>v_hash then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RECIPIENT_CHANGED','This report email was already requested for a different verified address. Download the PDF instead.',409);
  end if;
  if v_export.email_status='provider_accepted' or (v_export.email_status='processing' and v_export.email_lease_expires_at>v_now) then
    return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
  end if;
  if v_export.email_requested_at is not null and (v_export.email_executions>=3 or v_export.email_requested_at<=v_now-interval '23 hours') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RETRY_LIMIT','Email recovery needs support review. The saved PDF is still available.',409);
  end if;
  if v_export.email_retry_at>v_now then return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision)); end if;
  if v_export.email_requested_at is null and public.dd2026_forecast_email_quota_used(p_actor_user_id)>=5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RATE_LIMIT','You can email five saved reports in 24 hours. Download the PDF instead.',429);
  end if;
  update public.dd2026_forecast_result_exports set email_status='processing',recipient_hash=v_hash,
    email_requested_at=coalesce(email_requested_at,v_now),email_executions=email_executions+1,
    email_lease=gen_random_uuid(),email_lease_expires_at=v_now+interval '120 seconds',email_retry_at=null
    where attempt_id=p_attempt_id and result_revision=p_result_revision returning * into v_export;
  return jsonb_build_object('ok',true,'claimed',true,'leaseToken',v_export.email_lease,
    'idempotencyKey','forecast-result/'||p_attempt_id::text||'/r'||p_result_revision::text,
    'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
end;
$$;

do $$ declare v_function regprocedure; begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'dd2026_forecast_analytics_%' or p.proname='dd2026_forecast_email_quota_used')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function);
    execute format('grant execute on function %s to service_role',v_function);
  end loop;
end $$;
commit;
