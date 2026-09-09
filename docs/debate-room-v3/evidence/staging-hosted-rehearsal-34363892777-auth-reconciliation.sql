-- PREPARED FOR ROOT REVIEW; NOT EXECUTED BY THE AUTHOR.
-- Exact held host from completed failed run34363892777, sourcec03d122.
-- The executing client MUST pin project_id=hlzqmreeoghbldnhlybr. This database
-- has no immutable project-identity GUC; this comment is not a target proof.
-- PRECONDITION: root first completes separately reviewed competition cleanup
-- and its absence readback. This SQL will reject any remaining event/actor data.
-- The actual lifecycle globally signed out this host and observed Auth403 and
-- Worker401 before holding Auth deletion. Sessions and refresh rows must be zero.
-- One Auth DELETE only, with precisely five frozen default/identity cascades.
-- No session, refresh, Debate, Study, financial, Storage or audit DELETE here.
-- No credential retrieval, schema installation, new login or mutation retry.
-- Auth/default-row locks only; no table-wide Auth, Study or financial locks.
-- The completed runner and browser no longer possess live fixture sessions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

do $reconcile$
declare
  v_id constant uuid := '7ce735e9-228f-4cc6-a7e3-16e1081f7618';
  v_event constant text := 'de-4fb85fc5fbf904733a7a265eb9c7c08e';
  v_run constant text := 'dv3study-41e121b5';
  v_user record;
  v_scope record; v_count bigint; v_scopes integer := 0; v_expected integer;
  v_removed integer; v_hash text; v_audit_before bigint;
  v_affected constant regclass[] := array[
    'auth.users'::regclass,'auth.identities'::regclass,
    'public.profiles'::regclass,'public.forum_profile_settings'::regclass,
    'public.user_roles'::regclass,'private.internal_test_accounts'::regclass];
begin
  if current_user <> 'postgres' then raise exception 'RECONCILE_OPERATOR_MISMATCH'; end if;
  -- Read only noncredential ownership fields, then retain the exact Auth row lock.
  select id,email,created_at,last_sign_in_at,aud,role,is_super_admin,is_anonymous,
    is_sso_user,deleted_at,email_confirmed_at,raw_user_meta_data,raw_app_meta_data
    into v_user from auth.users where id=v_id for update;
  if not found or v_user.email is distinct from 'dd-study-room-student-'||v_run||'@example.com'
    or v_user.created_at is distinct from '2026-09-09T14:30:56.87231Z'::timestamptz
    or v_user.last_sign_in_at is distinct from '2026-09-09T14:31:07.791946Z'::timestamptz
    or v_user.aud is distinct from 'authenticated' or v_user.role is distinct from 'authenticated'
    or coalesce(v_user.is_super_admin,false) or coalesce(v_user.is_anonymous,false) or coalesce(v_user.is_sso_user,false)
    or v_user.deleted_at is not null or v_user.email_confirmed_at is null
    or v_user.raw_user_meta_data->>'full_name' is distinct from 'Synthetic Study Room student'
    or v_user.raw_app_meta_data is distinct from jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
      'astra_staging_study_room_fixture',jsonb_build_object('version',1,'runId',v_run,'label','student')) then
    raise exception 'RECONCILE_AUTH_OWNERSHIP_DRIFT';
  end if;

  -- Freeze precisely the five expected rows that Auth user deletion cascades.
  -- Hashes are native PostgreSQL JSON of default profile/role/registry rows;
  -- no password, bearer, refresh-token or signing material is hashed/emitted.
  for v_scope in select * from (values
    ('public','profiles','id','072bfa6e1bd616bf85749dc0893324d5894d8f38f337a93e83ba296e07173bf6'),
    ('public','forum_profile_settings','user_id','34e43839ad4c2b0c34c568810dbe156c63828275aed5b4235be2932df5f0f6b8'),
    ('public','user_roles','user_id','6192434e0fceaf4a1a64f0fe4eb55bc33602936be1e99b8429875328f36784b1'),
    ('private','internal_test_accounts','user_id','9eed1b63e3bbf432257b42a076a906b1467d1b7aabe5a96dd69a7930a2804c3f')
  ) expected(schema_name,table_name,column_name,row_hash) loop
    execute format('select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') from %I.%I t where %I=$1 for update',
      v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_hash using v_id;
    if v_hash is distinct from v_scope.row_hash then raise exception 'RECONCILE_DEFAULT_ROW_DRIFT'; end if;
  end loop;
  perform 1 from auth.identities where user_id=v_id and id='59ca7f36-784f-4e30-9cb7-2878e4fa0a6e'
    and provider='email' and provider_id=v_id::text and identity_data->>'sub'=v_id::text
    and identity_data->>'email'=v_user.email
    and created_at='2026-09-09T14:30:56.948304Z'::timestamptz
    and updated_at=created_at for update;
  if not found then raise exception 'RECONCILE_IDENTITY_DRIFT'; end if;
  perform 1 from private.internal_test_accounts where user_id=v_id
    and email_at_classification=v_user.email
    and classification_source='astra_study_room_staging_v1:'||v_run||':student' for update;
  if not found then raise exception 'RECONCILE_CLASSIFICATION_DRIFT'; end if;
  perform 1 from public.user_roles where user_id=v_id and role::text='student'
    and assigned_by is null for update;
  if not found or exists(select 1 from public.user_roles where assigned_by=v_id) then
    raise exception 'RECONCILE_ROLE_DRIFT';
  end if;
  if exists(select 1 from auth.sessions where user_id=v_id)
    or exists(select 1 from auth.refresh_tokens where user_id=v_id::text) then
    raise exception 'RECONCILE_SESSION_OR_REFRESH_REAPPEARED';
  end if;

  -- This is an Auth-only follow-up. The exact generated event and all seven
  -- event child tables, including actorless match versions, must be absent.
  if exists(select 1 from public.debate_v3_events where id=v_event or owner_id=v_id::text)
    or exists(select 1 from public.debate_v3_receipts where event_id=v_event or actor_id=v_id::text)
    or exists(select 1 from public.debate_v3_audit where event_id=v_event or actor_id=v_id::text)
    or exists(select 1 from public.debate_v3_match_versions where event_id=v_event)
    or exists(select 1 from public.debate_v3_ballots where event_id=v_event or judge_id=v_id::text)
    or exists(select 1 from public.debate_v3_votes where event_id=v_event or actor_id=v_id::text)
    or exists(select 1 from public.debate_v3_outbox where event_id=v_event or actor_id=v_id::text)
    or exists(select 1 from public.debate_v3_uploads where event_id=v_event or actor_id=v_id::text)
    or exists(select 1 from public.debate_v3_rate_limits where actor_id=v_id::text) then
    raise exception 'RECONCILE_COMPETITION_CLEANUP_REQUIRED';
  end if;

  -- Every direct Auth FK was inspected, including NO ACTION, SET NULL and
  -- CASCADE references. All financial/privileged/audit/room data must be zero.
  for v_scope in
    select n.nspname schema_name,c.relname table_name,a.attname column_name,fk.confdeltype,
      cardinality(fk.conkey) source_columns,cardinality(fk.confkey) target_columns
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum=fk.conkey[1]
    where fk.contype='f' and fk.confrelid='auth.users'::regclass
    order by n.nspname,c.relname,a.attname
  loop
    v_scopes := v_scopes+1;
    if v_scope.source_columns<>1 or v_scope.target_columns<>1 then raise exception 'RECONCILE_FK_SHAPE_DRIFT'; end if;
    v_expected := case when (v_scope.schema_name,v_scope.table_name,v_scope.column_name) in
      (('auth','identities','user_id'),('public','profiles','id'),
       ('public','forum_profile_settings','user_id'),('public','user_roles','user_id'),('private','internal_test_accounts','user_id'))
      then 1 else 0 end;
    execute format('select count(*) from %I.%I where %I=$1',v_scope.schema_name,v_scope.table_name,v_scope.column_name)
      into v_count using v_id;
    if v_count<>v_expected or (v_expected=1 and v_scope.confdeltype<>'c') then raise exception 'RECONCILE_UNEXPECTED_AUTH_REFERENCE'; end if;
  end loop;
  if v_scopes<>257 then raise exception 'RECONCILE_AUTH_FK_CATALOG_DRIFT'; end if;
  if (select count(*) from pg_constraint where contype='f' and confrelid='auth.sessions'::regclass)<>2
    or not exists(select 1 from pg_constraint where conname='refresh_tokens_session_id_fkey' and conrelid='auth.refresh_tokens'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c')
    or not exists(select 1 from pg_constraint where conname='mfa_amr_claims_session_id_fkey' and conrelid='auth.mfa_amr_claims'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c')
    or exists(select 1 from pg_constraint where contype='f' and confrelid=any(array[
      'auth.identities'::regclass,'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass,
      'public.profiles'::regclass,'public.forum_profile_settings'::regclass,
      'public.user_roles'::regclass,'private.internal_test_accounts'::regclass])) then
    raise exception 'RECONCILE_TRANSITIVE_CASCADE_DRIFT';
  end if;
  if exists(select 1 from pg_trigger where tgrelid=any(v_affected) and not tgisinternal and (tgtype & 8)<>0)
    or exists(select 1 from pg_rewrite where ev_class=any(v_affected) and ev_type in ('2','3','4')) then
    raise exception 'RECONCILE_DELETE_HOOK_DRIFT';
  end if;

  -- Inspect non-FK exact UUID references too. No customer row content is read
  -- into the receipt. This covers private Study rows and Storage ownership.
  v_scopes := 0;
  for v_scope in
    select n.nspname schema_name,c.relname table_name,a.attname column_name,a.atttypid
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where n.nspname in ('public','private','storage','auth') and c.relkind in ('r','p')
      and (a.atttypid='uuid'::regtype or (a.atttypid in ('text'::regtype,'varchar'::regtype)
        and a.attname in ('user_id','owner_id','actor_id','judge_id','identity')))
      and not exists(select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid=c.oid
        and a.attnum=any(fk.conkey) and fk.confrelid='auth.users'::regclass)
      and not (n.nspname='auth' and c.relname in ('users','identities','sessions','refresh_tokens','mfa_amr_claims'))
    order by n.nspname,c.relname,a.attname
  loop
    v_scopes := v_scopes+1;
    execute format('select count(*) from %I.%I where %I=$1::%s',v_scope.schema_name,v_scope.table_name,v_scope.column_name,
      case when v_scope.atttypid='uuid'::regtype then 'uuid' else 'text' end) into v_count using v_id::text;
    if v_count<>0 then raise exception 'RECONCILE_NON_FK_REFERENCE'; end if;
  end loop;
  for v_scope in
    select table_schema schema_name,table_name,column_name from information_schema.columns
    where ((table_schema='private' and table_name like 'study_room_%')
      or (table_schema='public' and table_name like 'debate_v3_%')) and data_type='jsonb'
  loop
    v_scopes := v_scopes+1;
    execute format('select count(*) from %I.%I where position($1 in %I::text)>0',
      v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_count using v_id::text;
    if v_count<>0 then raise exception 'RECONCILE_ROOM_JSON_REFERENCE'; end if;
  end loop;
  if v_scopes<>481 then raise exception 'RECONCILE_NON_FK_CATALOG_DRIFT'; end if;
  if exists(select 1 from storage.objects where position(v_id::text in name)>0 or position(v_run in name)>0 or position(v_event in name)>0)
    or exists(select 1 from storage.s3_multipart_uploads where position(v_id::text in key)>0 or position(v_run in key)>0 or position(v_event in key)>0)
    or exists(select 1 from storage.s3_multipart_uploads_parts where position(v_id::text in key)>0 or position(v_run in key)>0 or position(v_event in key)>0) then
    raise exception 'RECONCILE_STORAGE_PATH_REFERENCE';
  end if;
  select count(*) into v_audit_before from auth.audit_log_entries where position(v_id::text in payload::text)>0;

  if v_audit_before<>0 then raise exception 'RECONCILE_AUTH_AUDIT_DRIFT'; end if;
  -- Recheck lifecycle preconditions immediately before the only DELETE.
  if exists(select 1 from auth.sessions where user_id=v_id)
    or exists(select 1 from auth.refresh_tokens where user_id=v_id::text) then
    raise exception 'RECONCILE_SESSION_OR_REFRESH_REAPPEARED';
  end if;

  -- Only the exact frozen default rows and email identity may cascade.
  delete from auth.users where id=v_id and created_at=v_user.created_at
    and email=v_user.email and raw_app_meta_data=v_user.raw_app_meta_data
    and last_sign_in_at=v_user.last_sign_in_at;
  get diagnostics v_removed = row_count;
  if v_removed<>1 or exists(select 1 from auth.users where id=v_id)
    or exists(select 1 from auth.identities where user_id=v_id)
    or exists(select 1 from auth.sessions where user_id=v_id)
    or exists(select 1 from auth.refresh_tokens where user_id=v_id::text)
    or exists(select 1 from public.profiles where id=v_id)
    or exists(select 1 from public.forum_profile_settings where user_id=v_id)
    or exists(select 1 from public.user_roles where user_id=v_id)
    or exists(select 1 from private.internal_test_accounts where user_id=v_id)
    or (select count(*) from auth.audit_log_entries where position(v_id::text in payload::text)>0)<>v_audit_before then
    raise exception 'RECONCILE_AUTH_DELETE_OR_AUDIT_PRESERVATION';
  end if;
end;
$reconcile$;
commit;

-- Run a separate exact-ID read-only verification after an acknowledged commit.
-- An unknown response requires read-only reconciliation, never a blind retry.
