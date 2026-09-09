-- STAGING ONLY. Deliberately outside supabase/migrations and production discovery.
-- Apply manually to project_id=hlzqmreeoghbldnhlybr after exact-source CI review.
-- The coordinator pins the real project. A payload ref is a context guard, not
-- immutable database identity; this database exposes no trustworthy project GUC.
-- No Auth, Study, billing, registry or Storage row is changed by this helper.
begin;
do $guard$
begin
  if current_user <> 'postgres' or to_regclass('private.internal_test_accounts') is null
     or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'HOSTED_CLEANUP_INSTALL_PREREQUISITE';
  end if;
  if exists(select 1 from pg_proc where proname='astra_staging_debate_cleanup_v1'
    and pronamespace in ('public'::regnamespace,'private'::regnamespace)) then
    raise exception 'HOSTED_CLEANUP_ALREADY_INSTALLED_REVIEW_REQUIRED';
  end if;
end;
$guard$;

create function private.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
set lock_timeout = '5s' set statement_timeout = '20s'
as $function$
declare
  v_fixture jsonb; v_row jsonb; v_job jsonb; v_event jsonb; v_member record;
  v_user auth.users%rowtype; v_registry private.internal_test_accounts%rowtype;
  v_actors text[]; v_events text[]; v_host text; v_title text; v_run text;
  v_table text; v_actor_column text; v_where text; v_keys text[] := '{}'; v_key text;
  v_data jsonb := '{}'; v_rows jsonb; v_counts jsonb := '{}'; v_snapshot jsonb;
  v_count integer; v_removed integer; v_window bigint; v_created_ms bigint;
  v_tables constant text[] := array['events','uploads','outbox','receipts','audit','match_versions','ballots','votes','rate_limits'];
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'HOSTED_CLEANUP_SERVICE_ROLE_ONLY';
  end if;
  if jsonb_typeof(p_manifest) is distinct from 'object'
     or p_manifest - array['projectRef','runTag','fixtures','events'] <> '{}'::jsonb
     or p_manifest->>'projectRef' is distinct from 'hlzqmreeoghbldnhlybr'
     or coalesce(p_manifest->>'runTag','') !~ '^dv3host-[a-f0-9]{16}$'
     or jsonb_typeof(p_manifest->'fixtures') is distinct from 'array'
     or jsonb_array_length(p_manifest->'fixtures') not between 1 and 11
     or jsonb_typeof(p_manifest->'events') is distinct from 'array'
     or jsonb_array_length(p_manifest->'events') > 2 then
    raise exception 'HOSTED_CLEANUP_MANIFEST_SCOPE';
  end if;
  select array_agg(f->>'id' order by f->>'id') into v_actors from jsonb_array_elements(p_manifest->'fixtures') f;
  select coalesce(array_agg(e->>'id' order by e->>'id'),'{}') into v_events from jsonb_array_elements(p_manifest->'events') e;
  if cardinality(v_actors) <> (select count(distinct f->>'id') from jsonb_array_elements(p_manifest->'fixtures') f)
     or cardinality(v_actors) <> (select count(distinct f->>'purpose') from jsonb_array_elements(p_manifest->'fixtures') f)
     or cardinality(v_actors) <> (select count(distinct f->>'runId') from jsonb_array_elements(p_manifest->'fixtures') f)
     or cardinality(v_events) <> (select count(distinct e->>'id') from jsonb_array_elements(p_manifest->'events') e) then
    raise exception 'HOSTED_CLEANUP_DUPLICATE_IDENTITY';
  end if;
  -- Exact Auth row locks protect FK-backed session/promotion/billing inserts
  -- during this transaction. The live runner separately proves JWT denial.
  for v_fixture in select f from jsonb_array_elements(p_manifest->'fixtures') f order by f->>'id' loop
    if v_fixture - array['id','runId','purpose','createdAt'] <> '{}'::jsonb
       or coalesce(v_fixture->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
       or coalesce(v_fixture->>'runId','') !~ '^dv3study-[a-f0-9]{8}$'
       or coalesce(v_fixture->>'purpose','') not in ('host','A1','A2','A3','N1','N2','N3','judge2','judge3','observer','excluded')
       or v_fixture->>'createdAt' is null then raise exception 'HOSTED_CLEANUP_FIXTURE_SCOPE'; end if;
    v_run := v_fixture->>'runId';
    select * into v_user from auth.users where id=(v_fixture->>'id')::uuid for update;
    if not found then raise exception 'HOSTED_CLEANUP_AUTH_MISSING'; end if;
    if v_user.email is distinct from 'dd-study-room-student-'||v_run||'@example.com'
       or v_user.created_at is distinct from (v_fixture->>'createdAt')::timestamptz
       or v_user.aud is distinct from 'authenticated' or v_user.role is distinct from 'authenticated'
       or coalesce(v_user.is_super_admin,false) or coalesce(v_user.is_anonymous,false) or coalesce(v_user.is_sso_user,false)
       or v_user.deleted_at is not null or v_user.email_confirmed_at is null
       or v_user.raw_user_meta_data->>'full_name' is distinct from 'Synthetic Study Room student'
       or v_user.raw_app_meta_data is distinct from jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
         'astra_staging_study_room_fixture',jsonb_build_object('version',1,'runId',v_run,'label','student')) then
      raise exception 'HOSTED_CLEANUP_AUTH_OWNERSHIP';
    end if;
    select * into v_registry from private.internal_test_accounts where user_id=v_user.id for update;
    if not found or v_registry.email_at_classification is distinct from v_user.email
       or v_registry.classification_source is distinct from 'astra_study_room_staging_v1:'||v_run||':student' then
      raise exception 'HOSTED_CLEANUP_CLASSIFICATION';
    end if;
    perform 1 from public.user_roles where user_id=v_user.id and role::text='student' and assigned_by is null for update;
    if not found or exists(select 1 from public.user_roles where assigned_by=v_user.id)
       or exists(select 1 from auth.sessions where user_id=v_user.id)
       or exists(select 1 from auth.refresh_tokens where user_id=v_user.id::text and not coalesce(revoked,false)) then
      raise exception 'HOSTED_CLEANUP_SESSION_OR_ROLE';
    end if;
    foreach v_table in array array['payment_requests','subscriptions','free_beta_access','admin_capabilities',
      'examination_beta_access','examination_participants','examination_attempts_multi','grade_reservations','subscription_history','refund_requests'] loop
      execute format('select count(*) from public.%I where user_id=$1',v_table) into v_count using v_user.id;
      if v_count <> 0 then raise exception 'HOSTED_CLEANUP_FINANCIAL_OR_PRIVILEGED_DATA'; end if;
    end loop;
    foreach v_table in array array['payment_request_history','refund_request_history','subscription_history'] loop
      execute format('select count(*) from public.%I where actor_user_id=$1',v_table) into v_count using v_user.id;
      if v_count <> 0 then raise exception 'HOSTED_CLEANUP_FINANCIAL_HISTORY'; end if;
    end loop;
    if exists(select 1 from public.examination_definitions where created_by=v_user.id) then raise exception 'HOSTED_CLEANUP_EXAMINATION_OWNER'; end if;
    if v_fixture->>'purpose'='host' then v_host := v_user.id::text; end if;
  end loop;
  for v_event in select e from jsonb_array_elements(p_manifest->'events') e loop
    if v_event - array['id','title'] <> '{}'::jsonb
       or coalesce(v_event->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
       or coalesce(v_event->>'title','') not in ('Hosted Debate '||(p_manifest->>'runTag')||' main','Hosted Debate '||(p_manifest->>'runTag')||' isolation') then
      raise exception 'HOSTED_CLEANUP_EVENT_INTENT';
    end if;
  end loop;
  -- Short staging-Debate-only write locks prevent INSERT phantoms in receipts
  -- and rate limits (which intentionally have no event FK). Never lock Study,
  -- financial or Auth tables as a whole. Lock timeout refuses busy staging.
  lock table public.debate_v3_events,public.debate_v3_uploads,public.debate_v3_outbox,
    public.debate_v3_receipts,public.debate_v3_audit,public.debate_v3_match_versions,
    public.debate_v3_ballots,public.debate_v3_votes,public.debate_v3_rate_limits in share row exclusive mode;
  foreach v_table in array v_tables loop
    v_actor_column := case when v_table='ballots' then 'judge_id' else 'actor_id' end;
    v_where := case when v_table='events' then 'id=any($1) or owner_id=any($2) or state->''members'' ?| $2'
      when v_table='match_versions' then 'event_id=any($1)'
      when v_table='rate_limits' then 'actor_id=any($2)'
      else format('event_id=any($1) or %I=any($2)',v_actor_column) end;
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t where %s','debate_v3_'||v_table,v_where)
      into v_rows using v_events,v_actors;
    v_count := jsonb_array_length(v_rows);
    if v_count > 1000 then raise exception 'HOSTED_CLEANUP_ROW_BOUND'; end if;
    v_data := v_data || jsonb_build_object(v_table,v_rows); v_counts := v_counts || jsonb_build_object(v_table,v_count);
  end loop;
  if jsonb_array_length(v_data->'events') <> cardinality(v_events) then raise exception 'HOSTED_CLEANUP_FOREIGN_EVENT'; end if;
  for v_row in select r from jsonb_array_elements(v_data->'events') r loop
    select e->>'title' into v_title from jsonb_array_elements(p_manifest->'events') e where e->>'id'=v_row->>'id';
    if v_title is null or v_host is null or v_row->>'owner_id' is distinct from v_host
       or v_row->'state'->>'ownerId' is distinct from v_host or v_row->'state'->>'id' is distinct from v_row->>'id'
       or v_row->'state'->>'title' is distinct from v_title or v_row->'state'->'rehearsal' is distinct from 'true'::jsonb
       or v_row->'state'->>'visibility' is distinct from 'unlisted' or v_row->'state'->'revision' is distinct from v_row->'revision'
       or jsonb_typeof(v_row->'state'->'members') is distinct from 'object'
       or coalesce(v_row->'state'->'media','{}'::jsonb) <> '{}'::jsonb then raise exception 'HOSTED_CLEANUP_EVENT_OWNERSHIP'; end if;
    if v_row->'state'->'members'='{}'::jsonb then raise exception 'HOSTED_CLEANUP_EVENT_MEMBERS'; end if;
    for v_member in select * from jsonb_each(v_row->'state'->'members') loop
      if not(v_member.key=any(v_actors)) or v_member.value->>'id' is distinct from v_member.key then raise exception 'HOSTED_CLEANUP_EVENT_MEMBERS'; end if;
    end loop;
  end loop;
  foreach v_table in array array['uploads','outbox','receipts','audit','match_versions','ballots','votes'] loop
    for v_row in select r from jsonb_array_elements(v_data->v_table) r loop
      if not coalesce(v_row->>'event_id'=any(v_events),false)
         or (v_row ? 'actor_id' and not coalesce(v_row->>'actor_id'=any(v_actors),false))
         or (v_row ? 'judge_id' and not coalesce(v_row->>'judge_id'=any(v_actors),false)) then raise exception 'HOSTED_CLEANUP_FOREIGN_CHILD'; end if;
    end loop;
  end loop;
  for v_row in select r from jsonb_array_elements(v_data->'outbox') r loop
    v_job := v_row->'job';
    if v_row->>'type' not in ('export','delete_evidence','delete_export') or v_row->>'status'='running'
       or v_job->>'type' is distinct from v_row->>'type'
       or v_job->>'id' is distinct from v_row->>'id' or v_job->>'eventId' is distinct from v_row->>'event_id'
       or v_job->>'actorId' is distinct from v_row->>'actor_id' then raise exception 'HOSTED_CLEANUP_JOB_SCOPE'; end if;
    if v_row->>'type'='export' then
      if coalesce(v_job->'payload'->>'format','') not in ('pdf','csv') then raise exception 'HOSTED_CLEANUP_EXPORT_SCOPE'; end if;
      v_key := 'exports/'||(v_row->>'event_id')||'/'||(v_row->>'id')||'.'||(v_job->'payload'->>'format');
      if v_row->'result'->>'storageKey' is not null and v_row->'result'->>'storageKey'<>v_key then raise exception 'HOSTED_CLEANUP_EXPORT_SCOPE'; end if;
    else v_key := v_job->'payload'->>'storageKey'; end if;
    if v_key is null or v_key !~ '^(exports|evidence)/[a-f0-9-]{36}/([a-zA-Z0-9:_-]{8,160}/)?[a-zA-Z0-9_-]{8,160}\.(pdf|csv|png|jpg)$'
       or not(starts_with(v_key,'exports/'||(v_row->>'event_id')||'/') or starts_with(v_key,'evidence/'||(v_row->>'event_id')||'/')) then
      raise exception 'HOSTED_CLEANUP_STORAGE_KEY';
    end if;
    v_keys := array_append(v_keys,v_key);
  end loop;
  for v_row in select r from jsonb_array_elements(v_data->'uploads') r loop
    if v_row->'record'->>'id' is distinct from v_row->>'id' or v_row->'record'->>'eventId' is distinct from v_row->>'event_id'
       or v_row->'record'->>'actorId' is distinct from v_row->>'actor_id' or v_row->'record'->>'matchId' is distinct from v_row->>'match_id'
       or not coalesce(v_row->'record'->>'storageKey'=any(v_keys),false)
       or not exists(select 1 from jsonb_array_elements(v_data->'outbox') j where j->>'id'=v_row->>'cleanup_job_id'
         and j->>'type'='delete_evidence' and j->'job'->'payload'->>'uploadId'=v_row->>'id'
         and j->'job'->'payload'->>'storageKey'=v_row->'record'->>'storageKey') then raise exception 'HOSTED_CLEANUP_UPLOAD_SCOPE'; end if;
  end loop;
  select coalesce(array_agg(distinct k order by k),'{}') into v_keys from unnest(v_keys) k;
  for v_row in select r from jsonb_array_elements(v_data->'rate_limits') r loop
    v_window := case v_row->>'action' when 'discover_events' then 60000 when 'claim_invite' then 60000
      when 'join_public_event' then 60000 when 'reserve_upload' then 3600000 else null end;
    select (extract(epoch from (f->>'createdAt')::timestamptz)*1000)::bigint into v_created_ms
      from jsonb_array_elements(p_manifest->'fixtures') f where f->>'id'=v_row->>'actor_id';
    if v_window is null or v_created_ms is null or (v_row->>'count')::integer not between 1 and 10000
       or (v_row->>'bucket')::bigint < floor(v_created_ms::numeric/v_window)-1
       or (v_row->>'bucket')::bigint > floor(extract(epoch from clock_timestamp())*1000/v_window)+1 then raise exception 'HOSTED_CLEANUP_RATE_SCOPE'; end if;
  end loop;
  -- Native PostgreSQL jsonb text canonicalization is used in both phases; no
  -- cross-runtime JSON serialization is trusted for an atomic comparison.
  v_snapshot := jsonb_build_object('version',1,'manifestSha256',encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex'),
    'snapshotSha256',encode(sha256(convert_to(v_data::text,'UTF8')),'hex'),'counts',v_counts,'storageKeys',to_jsonb(v_keys));
  if p_expected is null then return jsonb_build_object('status','CAPTURED','snapshot',v_snapshot); end if;
  if p_expected is distinct from v_snapshot then raise exception 'HOSTED_CLEANUP_SNAPSHOT_CHANGED'; end if;
  if cardinality(v_keys)>0 then
    perform 1 from storage.buckets where id='debate-private-v3' and name=id and public=false and file_size_limit=10485760
      and (select array_agg(m order by m) from unnest(allowed_mime_types) m)=array['application/pdf','image/jpeg','image/png','text/csv'] for update;
    if not found then raise exception 'HOSTED_CLEANUP_BUCKET_CONTRACT'; end if;
    if exists(select 1 from storage.objects where bucket_id='debate-private-v3' and name=any(v_keys)) then raise exception 'HOSTED_CLEANUP_STORAGE_REMAINS'; end if;
  end if;
  foreach v_table in array array['uploads','outbox','receipts','audit','match_versions','ballots','votes','events','rate_limits'] loop
    -- Bind the complete frozen records; never widen DELETE to an actor or event
    -- predicate. All table writes remain fenced until the transaction commits.
    execute format('delete from public.%I t using jsonb_array_elements($1) s where to_jsonb(t)=s.value','debate_v3_'||v_table)
      using v_data->v_table;
    get diagnostics v_removed = row_count;
    if v_removed <> (v_counts->>v_table)::integer then raise exception 'HOSTED_CLEANUP_DELETE_COUNT'; end if;
  end loop;
  return jsonb_build_object('status','DELETED_ATOMICALLY','snapshot',v_snapshot,'deletedCounts',v_counts);
end;
$function$;

create function public.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
set lock_timeout = '5s' set statement_timeout = '20s'
as $function$
  select private.astra_staging_debate_cleanup_v1(p_manifest,p_expected);
$function$;
revoke all on function private.astra_staging_debate_cleanup_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.astra_staging_debate_cleanup_v1(jsonb,jsonb) to service_role;
grant execute on function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) to service_role;
commit;
