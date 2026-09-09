-- PREPARED FOR ROOT REVIEW; NOT EXECUTED BY THE AUTHOR.
-- One failed, completed CI run only: 34358904483, source 1a0a30f00ab3ca441c9ba73df3605f11ecbc9b9f.
-- The executing client MUST pin project_id=hlzqmreeoghbldnhlybr. This database
-- has no immutable project-identity GUC; this comment is not a target proof.
-- DML transaction only. No function/schema installation, no new login, no
-- credential retrieval, no Storage object deletion, and no mutation retry.
-- The received old bearer was not retained. Its denial and immediate global
-- logout fencing remain UNVERIFIED even after this exact database cleanup.
-- Auth/default-row locks only; no table-wide Auth, Study or financial locks.
-- The completed runner no longer possesses its ephemeral password/session.
-- No Debate event was created, and this fixture was never added to preview.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

do $reconcile$
declare
  v_id constant uuid := 'f341af43-15d0-4177-916a-53a8e1a297fc';
  v_session constant uuid := 'd8a175f5-51f3-4499-acb9-efc8b7d1b607';
  v_run constant text := 'dv3study-0eabb144';
  v_user auth.users%rowtype;
  v_scope record; v_count bigint; v_scopes integer := 0; v_expected integer;
  v_removed integer; v_hash text; v_audit_before bigint;
  v_affected constant regclass[] := array[
    'auth.users'::regclass,'auth.identities'::regclass,'auth.sessions'::regclass,
    'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass,
    'public.profiles'::regclass,'public.forum_profile_settings'::regclass,
    'public.user_roles'::regclass,'private.internal_test_accounts'::regclass];
begin
  if current_user <> 'postgres' then raise exception 'RECONCILE_OPERATOR_MISMATCH'; end if;
  select * into v_user from auth.users where id=v_id for update;
  if not found or v_user.email is distinct from 'dd-study-room-student-'||v_run||'@example.com'
    or v_user.created_at is distinct from '2026-09-09T13:45:32.485184Z'::timestamptz
    or v_user.last_sign_in_at is distinct from '2026-09-09T13:45:34.902721Z'::timestamptz
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
    ('public','profiles','id','b249001c7f290e94f95105ceb6fd42f45682faa734575237063dfeb32840dce8'),
    ('public','forum_profile_settings','user_id','bb714afef68ef1f6dfc450226ab07d93b3acb6ada04c01313d6eed830627ca6a'),
    ('public','user_roles','user_id','c57c2309d920fe51895e0d65659f4d3b7248dc4cc8bd33469e63464bb5f13d89'),
    ('private','internal_test_accounts','user_id','4bd6cc16cc51a6c7e2af074be7e05584959cd261532f5997cab17e96b78e6f2e')
  ) expected(schema_name,table_name,column_name,row_hash) loop
    execute format('select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') from %I.%I t where %I=$1 for update',
      v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_hash using v_id;
    if v_hash is distinct from v_scope.row_hash then raise exception 'RECONCILE_DEFAULT_ROW_DRIFT'; end if;
  end loop;
  perform 1 from auth.identities where user_id=v_id and id='b8b92059-872b-470b-a582-6a4addfafab3'
    and provider='email' and provider_id=v_id::text and identity_data->>'sub'=v_id::text
    and identity_data->>'email'=v_user.email
    and created_at='2026-09-09T13:45:32.587244Z'::timestamptz
    and updated_at=created_at for update;
  if not found then raise exception 'RECONCILE_IDENTITY_DRIFT'; end if;
  perform 1 from auth.sessions where user_id=v_id and id=v_session and aal::text='aal1'
    and factor_id is null and oauth_client_id is null and not_after is null and refreshed_at is null
    and created_at='2026-09-09T13:45:34.903433Z'::timestamptz and updated_at=created_at for update;
  if not found then raise exception 'RECONCILE_SESSION_DRIFT'; end if;
  perform 1 from auth.refresh_tokens where id=1926 and user_id=v_id::text and session_id=v_session
    and revoked=false and length(token)=12 and coalesce(parent,'')=''
    and created_at='2026-09-09T13:45:34.916588Z'::timestamptz and updated_at=created_at for update;
  if not found or (select count(*) from auth.refresh_tokens where user_id=v_id::text or session_id=v_session)<>1 then
    raise exception 'RECONCILE_REFRESH_DRIFT';
  end if;
  perform 1 from auth.mfa_amr_claims where id='5ff6ebcb-627c-4153-86a4-45e2daff4e62'
    and session_id=v_session and authentication_method='password'
    and created_at='2026-09-09T13:45:34.933086Z'::timestamptz and updated_at=created_at for update;
  if not found or (select count(*) from auth.mfa_amr_claims where session_id=v_session)<>1 then
    raise exception 'RECONCILE_AMR_DRIFT';
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
      (('auth','identities','user_id'),('auth','sessions','user_id'),('public','profiles','id'),
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
  if exists(select 1 from storage.objects where position(v_id::text in name)>0 or position(v_run in name)>0)
    or exists(select 1 from storage.s3_multipart_uploads where position(v_id::text in key)>0 or position(v_run in key)>0)
    or exists(select 1 from storage.s3_multipart_uploads_parts where position(v_id::text in key)>0 or position(v_run in key)>0) then
    raise exception 'RECONCILE_STORAGE_PATH_REFERENCE';
  end if;
  select count(*) into v_audit_before from auth.audit_log_entries where position(v_id::text in payload::text)>0;

  -- Explicitly destroy this one refresh credential and its owning Auth session
  -- before Auth user deletion. The password AMR claim alone cascades here.
  delete from auth.refresh_tokens where id=1926 and user_id=v_id::text and session_id=v_session
    and revoked=false and length(token)=12 and coalesce(parent,'')=''
    and created_at='2026-09-09T13:45:34.916588Z'::timestamptz and updated_at=created_at;
  get diagnostics v_removed = row_count;
  if v_removed<>1 then raise exception 'RECONCILE_REFRESH_DELETE_COUNT'; end if;
  delete from auth.sessions where id=v_session and user_id=v_id
    and created_at='2026-09-09T13:45:34.903433Z'::timestamptz and updated_at=created_at;
  get diagnostics v_removed = row_count;
  if v_removed<>1 or exists(select 1 from auth.mfa_amr_claims where session_id=v_session)
    or exists(select 1 from auth.refresh_tokens where user_id=v_id::text or session_id=v_session)
    or exists(select 1 from auth.sessions where user_id=v_id) then raise exception 'RECONCILE_SESSION_DELETE_COUNT'; end if;

  -- Only the exact frozen default rows and email identity may cascade.
  delete from auth.users where id=v_id and created_at=v_user.created_at
    and email=v_user.email and raw_app_meta_data=v_user.raw_app_meta_data
    and last_sign_in_at=v_user.last_sign_in_at;
  get diagnostics v_removed = row_count;
  if v_removed<>1 or exists(select 1 from auth.users where id=v_id)
    or exists(select 1 from auth.identities where user_id=v_id)
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
