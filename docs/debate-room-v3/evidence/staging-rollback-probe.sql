-- REVIEW ARTIFACT ONLY: root must authorize before hosted execution.
-- Fixed external target: Supabase hlzqmreeoghbldnhlybr; SQL cannot prove project identity.
-- Debate source SHA256: 89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c
-- Study source SHA256: 5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637
-- Both candidate outer BEGIN/COMMIT pairs are removed; body bytes otherwise unchanged.
-- Send as ONE batch/connection. Never execute selected fragments or commit manually.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '10s';

DO $probe_preconditions$
DECLARE x jsonb; target oid; observed jsonb; expected jsonb; role_name text; permission text;
BEGIN
  IF current_user <> 'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'PROBE_PRECONDITION_ROLE_OR_PG17';
  END IF;
  IF EXISTS (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('public','private') and (c.relname like 'debate_v3_%' or c.relname like 'study_room_admission%' or c.relname in ('study_room_catalog_v2','study_room_configure_v2'))))
    OR EXISTS (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where (n.nspname in ('public','private') and (t.typname like 'debate_v3_%' or t.typname like 'study_room_admission%' or t.typname in ('study_room_catalog_v2','study_room_configure_v2'))))
    OR EXISTS (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in ('public','private') and (p.proname like 'debate_v3_%' or p.proname like 'study_room_admission%' or p.proname in ('study_room_catalog_v2','study_room_configure_v2')))) THEN
    RAISE EXCEPTION 'PROBE_CANDIDATE_OBJECT_COLLISION';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'PROBE_MIGRATION_LEDGER_MISSING'; END IF;
  IF EXISTS (select 1 from supabase_migrations.schema_migrations where version in ('20260909080139','20260909080143')) THEN
    RAISE EXCEPTION 'PROBE_CANDIDATE_MIGRATION_ALREADY_RECORDED';
  END IF;
  IF NOT EXISTS (select 1 from supabase_migrations.schema_migrations where version='20260908151514' and name='astra_study_room_persisted_catalog') THEN
    RAISE EXCEPTION 'PROBE_STUDY_LEDGER_DRIFT';
  END IF;
  IF to_regnamespace('private') IS NULL OR NOT has_schema_privilege('service_role','private','USAGE')
    OR has_schema_privilege('anon','private','USAGE') OR has_schema_privilege('authenticated','private','USAGE')
    OR NOT has_schema_privilege('postgres','private','CREATE') OR NOT has_schema_privilege('postgres','public','CREATE') THEN
    RAISE EXCEPTION 'PROBE_SCHEMA_PRIVILEGE_DRIFT';
  END IF;
  IF NOT EXISTS(select 1 from pg_roles where rolname='postgres' and rolbypassrls)
    OR NOT EXISTS(select 1 from pg_roles where rolname='service_role' and rolbypassrls)
    OR EXISTS(select 1 from pg_roles where rolname in ('anon','authenticated') and rolbypassrls)
    OR (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))<>3 THEN
    RAISE EXCEPTION 'PROBE_ROLE_DRIFT';
  END IF;
  FOR x IN SELECT value FROM jsonb_array_elements($expected_columns$[{"schema":"auth","table_name":"users","column_name":"id","type":"uuid","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog","column_name":"room_key","type":"smallint","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog","column_name":"label","type":"text","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog","column_name":"audience","type":"text","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog","column_name":"revision","type":"integer","not_null":true,"default_expression":"1"},{"schema":"private","table_name":"study_room_catalog","column_name":"access_revision","type":"integer","not_null":true,"default_expression":"1"},{"schema":"private","table_name":"study_room_catalog","column_name":"created_at","type":"timestamp with time zone","not_null":true,"default_expression":"now()"},{"schema":"private","table_name":"study_room_catalog","column_name":"updated_at","type":"timestamp with time zone","not_null":true,"default_expression":"now()"},{"schema":"private","table_name":"study_room_catalog","column_name":"created_by","type":"uuid","not_null":false,"default_expression":null},{"schema":"private","table_name":"study_room_catalog","column_name":"updated_by","type":"uuid","not_null":false,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"room_key","type":"smallint","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"revision","type":"integer","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"operation","type":"text","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"actor_user_id","type":"uuid","not_null":false,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"before_value","type":"jsonb","not_null":false,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"after_value","type":"jsonb","not_null":true,"default_expression":null},{"schema":"private","table_name":"study_room_catalog_audit","column_name":"happened_at","type":"timestamp with time zone","not_null":true,"default_expression":"now()"},{"schema":"public","table_name":"user_roles","column_name":"user_id","type":"uuid","not_null":true,"default_expression":null},{"schema":"public","table_name":"user_roles","column_name":"role","type":"text","not_null":true,"default_expression":"'student'::text"}]$expected_columns$::jsonb) LOOP
    SELECT jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default_expression',pg_get_expr(d.adbin,d.adrelid))
    INTO observed FROM pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname=x->>'schema' and c.relname=x->>'table_name' and a.attname=x->>'column_name' and a.attnum>0 and not a.attisdropped;
    IF observed IS DISTINCT FROM (x-'schema'-'table_name'-'column_name') THEN RAISE EXCEPTION 'PROBE_REQUIRED_COLUMN_DRIFT'; END IF;
  END LOOP;
  IF (select count(*) from pg_attribute where attrelid='private.study_room_catalog'::regclass and attnum>0 and not attisdropped)<>9
    OR (select count(*) from pg_attribute where attrelid='private.study_room_catalog_audit'::regclass and attnum>0 and not attisdropped)<>7 THEN
    RAISE EXCEPTION 'PROBE_STUDY_COLUMN_COUNT_DRIFT';
  END IF;
  FOR x IN SELECT value FROM jsonb_array_elements($expected_constraints$[{"name":"users_pkey","type":"p","table":"users","schema":"auth","validated":true,"definition":"PRIMARY KEY (id)"},{"name":"user_roles_pkey","type":"p","table":"user_roles","schema":"public","validated":true,"definition":"PRIMARY KEY (user_id)"},{"name":"user_roles_role_check","type":"c","table":"user_roles","schema":"public","validated":true,"definition":"CHECK ((role = ANY (ARRAY['student'::text, 'beta_tester'::text, 'admin'::text, 'founder_admin'::text, 'super_admin'::text])))"},{"name":"study_room_catalog_audience_check","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK ((audience = ANY (ARRAY['admin'::text, 'paid'::text, 'all'::text])))"},{"name":"study_room_catalog_check","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK (((access_revision >= 1) AND (access_revision <= revision)))"},{"name":"study_room_catalog_created_by_fkey","type":"f","table":"study_room_catalog","schema":"private","validated":true,"definition":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL"},{"name":"study_room_catalog_label_check","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK ((((char_length(label) >= 2) AND (char_length(label) <= 64)) AND (label = btrim(label)) AND (label ~ '^[A-Za-z0-9][A-Za-z0-9 .,''()&_\\-]*$'::text)))"},{"name":"study_room_catalog_pkey","type":"p","table":"study_room_catalog","schema":"private","validated":true,"definition":"PRIMARY KEY (room_key)"},{"name":"study_room_catalog_revision_check","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK (((revision >= 1) AND (revision <= 2147483646)))"},{"name":"study_room_catalog_room_key_check","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK (((room_key >= 1) AND (room_key <= 24)))"},{"name":"study_room_catalog_updated_by_fkey","type":"f","table":"study_room_catalog","schema":"private","validated":true,"definition":"FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL"},{"name":"study_room_inner_chamber_admin","type":"c","table":"study_room_catalog","schema":"private","validated":true,"definition":"CHECK (((room_key <> 5) OR (audience = 'admin'::text)))"},{"name":"study_room_catalog_audit_actor_user_id_fkey","type":"f","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL"},{"name":"study_room_catalog_audit_after_value_check","type":"c","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"CHECK ((jsonb_typeof(after_value) = 'object'::text))"},{"name":"study_room_catalog_audit_before_value_check","type":"c","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"CHECK (((before_value IS NULL) OR (jsonb_typeof(before_value) = 'object'::text)))"},{"name":"study_room_catalog_audit_operation_check","type":"c","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"CHECK ((operation = ANY (ARRAY['add'::text, 'update'::text])))"},{"name":"study_room_catalog_audit_pkey","type":"p","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"PRIMARY KEY (room_key, revision)"},{"name":"study_room_catalog_audit_revision_check","type":"c","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"CHECK ((revision > 0))"},{"name":"study_room_catalog_audit_room_key_fkey","type":"f","table":"study_room_catalog_audit","schema":"private","validated":true,"definition":"FOREIGN KEY (room_key) REFERENCES private.study_room_catalog(room_key)"}]$expected_constraints$::jsonb) LOOP
    SELECT jsonb_build_object('type',con.contype,'validated',con.convalidated,'definition',pg_get_constraintdef(con.oid))
    INTO observed FROM pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=x->>'schema' and c.relname=x->>'table' and con.conname=x->>'name';
    IF observed IS DISTINCT FROM (x-'schema'-'table'-'name') THEN RAISE EXCEPTION 'PROBE_REQUIRED_CONSTRAINT_DRIFT'; END IF;
  END LOOP;
  -- NOT NULL is already checked via pg_attribute; PG18 additionally catalogs it.
  IF (select count(*) from pg_constraint where conrelid='private.study_room_catalog'::regclass and contype<>'n')<>9
    OR (select count(*) from pg_constraint where conrelid='private.study_room_catalog_audit'::regclass and contype<>'n')<>7 THEN
    RAISE EXCEPTION 'PROBE_STUDY_CONSTRAINT_COUNT_DRIFT';
  END IF;
  FOR x IN SELECT value FROM jsonb_array_elements($expected_functions$[{"schema":"private","name":"study_room_catalog_v1","arguments":"","result":"jsonb","owner":"postgres","security_definer":true,"volatility":"s","settings":["search_path=\"\""],"anon_execute":false,"authenticated_execute":false,"service_execute":true,"definition_md5":"8cc1fd64fd2c6638350619f8981e0852"},{"schema":"private","name":"study_room_configure_v1","arguments":"p_actor_user_id uuid, p_operation text, p_room_key text, p_label text, p_audience text, p_expected_revision integer","result":"jsonb","owner":"postgres","security_definer":true,"volatility":"v","settings":["search_path=\"\"","lock_timeout=3s"],"anon_execute":false,"authenticated_execute":false,"service_execute":true,"definition_md5":"c36dec5163003b107063b904be081502"},{"schema":"public","name":"admin_authorization_context","arguments":"p_actor_user_id uuid","result":"jsonb","owner":"postgres","security_definer":true,"volatility":"s","settings":["search_path=public, pg_temp"],"anon_execute":false,"authenticated_execute":false,"service_execute":true,"definition_md5":"51ea270969dd6283a3e29b8fbff10561"},{"schema":"public","name":"study_room_catalog_v1","arguments":"","result":"jsonb","owner":"postgres","security_definer":false,"volatility":"s","settings":["search_path=\"\""],"anon_execute":false,"authenticated_execute":false,"service_execute":true,"definition_md5":"9346b52ec25cdb9e9aadf8a28f96bc99"},{"schema":"public","name":"study_room_configure_v1","arguments":"p_actor_user_id uuid, p_operation text, p_room_key text, p_label text, p_audience text, p_expected_revision integer","result":"jsonb","owner":"postgres","security_definer":false,"volatility":"v","settings":["search_path=\"\""],"anon_execute":false,"authenticated_execute":false,"service_execute":true,"definition_md5":"75afec464e3b1158fa69390751468a92"}]$expected_functions$::jsonb) LOOP
    SELECT p.oid INTO target FROM pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=x->>'schema' and p.proname=x->>'name' and pg_get_function_identity_arguments(p.oid)=x->>'arguments';
    IF target IS NULL THEN RAISE EXCEPTION 'PROBE_REQUIRED_FUNCTION_MISSING'; END IF;
    SELECT jsonb_build_object('result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,
      'settings',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'definition_md5',md5(pg_get_functiondef(p.oid))) INTO observed FROM pg_proc p where p.oid=target;
    IF observed IS DISTINCT FROM (x-'schema'-'name'-'arguments') THEN RAISE EXCEPTION 'PROBE_REQUIRED_FUNCTION_DRIFT'; END IF;
  END LOOP;
  IF EXISTS(select 1 from pg_class where oid in ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass)
    and (not relrowsecurity or not relforcerowsecurity or pg_get_userbyid(relowner)<>'postgres'))
    OR EXISTS(select 1 from pg_policy where polrelid in ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass))
    OR EXISTS(select 1 from pg_trigger where tgrelid in ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass) and not tgisinternal) THEN
    RAISE EXCEPTION 'PROBE_STUDY_PROTECTION_DRIFT';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(role_name,'private.study_room_catalog',permission) OR has_table_privilege(role_name,'private.study_room_catalog_audit',permission) THEN
        RAISE EXCEPTION 'PROBE_STUDY_DIRECT_GRANT_DRIFT';
      END IF;
    END LOOP;
  END LOOP;
  -- Require the exact observed permissive public defaults; the candidate must narrow them.
  IF (select count(*) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    where pg_get_userbyid(d.defaclrole)='postgres' and (n.nspname in ('public','private') or d.defaclnamespace=0))<>3
    OR EXISTS(select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace,
      lateral aclexplode(d.defaclacl) a where pg_get_userbyid(d.defaclrole)='postgres' and n.nspname='public' and d.defaclobjtype in ('r','f')
      and (a.grantee not in (select oid from pg_roles where rolname in ('postgres','anon','authenticated','service_role')) or a.is_grantable)) THEN
    RAISE EXCEPTION 'PROBE_DEFAULT_ACL_SCOPE_DRIFT';
  END IF;
  FOR role_name IN select unnest(array['anon','authenticated','service_role']) LOOP
    FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF NOT EXISTS(select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace,
        lateral aclexplode(d.defaclacl) a where pg_get_userbyid(d.defaclrole)='postgres' and n.nspname='public' and d.defaclobjtype='r'
        and a.grantee=(select oid from pg_roles where rolname=role_name) and a.privilege_type=permission) THEN RAISE EXCEPTION 'PROBE_HOSTED_DEFAULT_ACL_DRIFT'; END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('debate_probe.catalog_hash',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key),'[]'::jsonb)::text) from private.study_room_catalog c),true);
  PERFORM set_config('debate_probe.catalog_audit_hash',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key,revision),'[]'::jsonb)::text) from private.study_room_catalog_audit c),true);
  PERFORM set_config('debate_probe.migration_hash',(select md5(coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]'::jsonb)::text) from supabase_migrations.schema_migrations),true);
END;
$probe_preconditions$;
SELECT jsonb_build_object('checkpoint','PRECONDITIONS_VERIFIED','catalogHash',current_setting('debate_probe.catalog_hash'),'catalogAuditHash',current_setting('debate_probe.catalog_audit_hash'),'migrationLedgerHash',current_setting('debate_probe.migration_hash')) AS rollback_probe;

-- BEGIN VERIFIED DEBATE BODY
-- Additive local candidate; synchronized to CLI-generated migration
-- 20260909080139_debate_room_v3.sql. No remote schema application is evidenced.
-- One Postgres event row serializes competition commands. Private data never has a
-- direct browser grant. Every function is SECURITY INVOKER, service_role only.

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
-- END VERIFIED DEBATE BODY
-- BEGIN VERIFIED STUDY BODY
-- Local review draft. Do not apply to a hosted database without release approval.
-- Extends the supported persisted Study Room catalog; v1 functions remain intact.
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
-- END VERIFIED STUDY BODY

DO $probe_installed_acl$
DECLARE t record; func_row record; role_name text; permission text; expected boolean; count_tables integer:=0;
BEGIN
  FOR t IN select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'debate_v3_%' and c.relkind='r' LOOP
    count_tables:=count_tables+1;
    IF NOT t.relrowsecurity OR t.relforcerowsecurity THEN RAISE EXCEPTION 'PROBE_DEBATE_RLS_MISMATCH'; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        expected:=role_name='service_role' and (permission in ('SELECT','INSERT','DELETE') or (permission='UPDATE' and t.relname<>'debate_v3_audit'));
        IF has_table_privilege(role_name,t.oid,permission) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PROBE_DEBATE_PRIVILEGE_MISMATCH'; END IF;
      END LOOP;
      FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        expected:=role_name='service_role' and (permission in ('SELECT','INSERT') or (permission='UPDATE' and t.relname<>'debate_v3_audit'));
        IF has_any_column_privilege(role_name,t.oid,permission) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PROBE_DEBATE_COLUMN_PRIVILEGE_MISMATCH'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF count_tables<>10 THEN RAISE EXCEPTION 'PROBE_DEBATE_TABLE_COUNT'; END IF;
  IF (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'debate_v3_%')<>16 THEN RAISE EXCEPTION 'PROBE_DEBATE_FUNCTION_COUNT'; END IF;
  FOR func_row IN select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'debate_v3_%' LOOP
    IF func_row.prosecdef OR pg_get_userbyid(func_row.proowner)<>'postgres' OR func_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon',func_row.oid,'EXECUTE') OR has_function_privilege('authenticated',func_row.oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',func_row.oid,'EXECUTE') THEN RAISE EXCEPTION 'PROBE_DEBATE_FUNCTION_PERMISSION'; END IF;
  END LOOP;
  FOR t IN select c.oid,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.oid in ('private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass) LOOP
    IF NOT t.relrowsecurity OR NOT t.relforcerowsecurity THEN RAISE EXCEPTION 'PROBE_STUDY_ADMISSION_RLS'; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(role_name,t.oid,permission) THEN RAISE EXCEPTION 'PROBE_STUDY_ADMISSION_DIRECT_PERMISSION'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like 'study_room_admission%' or p.proname in ('study_room_catalog_v2','study_room_configure_v2')))<>6 THEN RAISE EXCEPTION 'PROBE_STUDY_FUNCTION_COUNT'; END IF;
  FOR func_row IN select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like 'study_room_admission%' or p.proname in ('study_room_catalog_v2','study_room_configure_v2')) LOOP
    IF pg_get_userbyid(func_row.proowner)<>'postgres' OR NOT ('search_path=""'=ANY(func_row.proconfig))
      OR func_row.prosecdef IS DISTINCT FROM (func_row.nspname='private' and func_row.proname in ('study_room_admission_v1','study_room_configure_v2'))
      OR has_function_privilege('anon',func_row.oid,'EXECUTE') OR has_function_privilege('authenticated',func_row.oid,'EXECUTE')
      OR has_function_privilege('service_role',func_row.oid,'EXECUTE') IS DISTINCT FROM (func_row.proname<>'study_room_admission_json') THEN RAISE EXCEPTION 'PROBE_STUDY_FUNCTION_PERMISSION'; END IF;
  END LOOP;
END;
$probe_installed_acl$;

SET LOCAL ROLE anon;
DO $probe_anon_denials$
BEGIN
  IF current_user<>'anon' THEN RAISE EXCEPTION 'PROBE_ROLE_NOT_SET'; END IF;
  BEGIN PERFORM 1 FROM public.debate_v3_events; RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.debate_v3_read('rollback-only-event'); RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.study_room_catalog_v2(); RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$probe_anon_denials$;
SET LOCAL ROLE authenticated;
DO $probe_authenticated_denials$
BEGIN
  IF current_user<>'authenticated' THEN RAISE EXCEPTION 'PROBE_ROLE_NOT_SET'; END IF;
  BEGIN PERFORM 1 FROM public.debate_v3_events; RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.debate_v3_read('rollback-only-event'); RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.study_room_admission_v1('{}'::jsonb); RAISE EXCEPTION 'PROBE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$probe_authenticated_denials$;
SET LOCAL ROLE service_role;
DO $probe_service_transactions$
DECLARE
  create_request jsonb := $service_envelope${"eventId":"de-c510a0243ce05d3a962f3d6f3eb6ee89","actorId":"rollback-only-debate-probe-owner","command":"create_event","idempotencyKey":"rollback-probe-create-0001","payloadHash":"7cbc4e945a6bcdee25f7e4ab6ef9c229cabe284135d8c77207b8221464bd82b6","expectedRevision":0,"now":1800000000000,"state":{"id":"de-c510a0243ce05d3a962f3d6f3eb6ee89","revision":0,"ownerId":"rollback-only-debate-probe-owner","title":"Synthetic rollback-only Debate probe","description":"","timezone":"Asia/Manila","language":"English","scheduledAt":null,"visibility":"unlisted","rehearsal":true,"status":"draft","createdAt":1800000000000,"updatedAt":1800000000000,"members":{"rollback-only-debate-probe-owner":{"id":"rollback-only-debate-probe-owner","displayName":"Synthetic rollback-only owner","roles":["host"],"teamId":null,"admitted":true,"checkedIn":true,"removed":false,"conflictDeclarations":[]}},"teams":{},"motions":{},"matches":{},"invites":{},"media":{},"jobs":{},"fixtures":[],"activeMatchId":null,"retention":{"operationalDays":30,"chatDays":30,"evidenceDays":90,"officialDays":365,"approved":false,"hold":false,"nextCleanupAt":null},"contact":null},"receipt":{"id":"88c2890a-13db-4141-845a-0ed6f9d15d7e","eventId":"de-c510a0243ce05d3a962f3d6f3eb6ee89","command":"create_event","committedAt":1800000000000,"result":{"eventId":"de-c510a0243ce05d3a962f3d6f3eb6ee89"}},"audit":{"actorId":"rollback-only-debate-probe-owner","command":"create_event","at":1800000000000,"matchId":null,"correlationId":"88c2890a-13db-4141-845a-0ed6f9d15d7e"},"jobs":[],"cancelJobs":[],"retryJobs":[],"consumeUploads":[]}$service_envelope$::jsonb;
  update_request jsonb := $service_envelope${"eventId":"de-c510a0243ce05d3a962f3d6f3eb6ee89","actorId":"rollback-only-debate-probe-owner","command":"update_event","idempotencyKey":"rollback-probe-update-0002","payloadHash":"dc9f6db66f9affcf17752a6cdd27f91f12eccd3895068e976105e342fd5b2660","expectedRevision":1,"now":1800000000000,"state":{"id":"de-c510a0243ce05d3a962f3d6f3eb6ee89","revision":1,"ownerId":"rollback-only-debate-probe-owner","title":"Synthetic rollback-only update","description":"","timezone":"Asia/Manila","language":"English","scheduledAt":null,"visibility":"unlisted","rehearsal":true,"status":"draft","createdAt":1800000000000,"updatedAt":1800000000000,"members":{"rollback-only-debate-probe-owner":{"id":"rollback-only-debate-probe-owner","displayName":"Synthetic rollback-only owner","roles":["host"],"teamId":null,"admitted":true,"checkedIn":true,"removed":false,"conflictDeclarations":[]}},"teams":{},"motions":{},"matches":{},"invites":{},"media":{},"jobs":{},"fixtures":[],"activeMatchId":null,"retention":{"operationalDays":30,"chatDays":30,"evidenceDays":90,"officialDays":365,"approved":false,"hold":false,"nextCleanupAt":null},"contact":null},"receipt":{"id":"7523f229-57e8-4aeb-ad19-e48bee854598","eventId":"de-c510a0243ce05d3a962f3d6f3eb6ee89","command":"update_event","committedAt":1800000000000,"result":{"saved":true}},"audit":{"actorId":"rollback-only-debate-probe-owner","command":"update_event","at":1800000000000,"matchId":null,"correlationId":"7523f229-57e8-4aeb-ad19-e48bee854598"},"jobs":[],"cancelJobs":[],"retryJobs":[],"consumeUploads":[]}$service_envelope$::jsonb;
  receipt jsonb; replay jsonb; rejected jsonb; changed jsonb; event_key text; actor_key text; before_audit jsonb; after_audit jsonb; existing_catalog jsonb;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'PROBE_ROLE_NOT_SET'; END IF;
  event_key:=create_request->>'eventId'; actor_key:=create_request->>'actorId';
  IF actor_key<>'rollback-only-debate-probe-owner' OR create_request->'state'->>'rehearsal'<>'true' OR update_request->>'eventId'<>event_key
    OR exists(select 1 from public.debate_v3_events) THEN RAISE EXCEPTION 'PROBE_SYNTHETIC_SCOPE'; END IF;
  receipt:=public.debate_v3_commit(create_request);
  IF receipt ? 'error' OR receipt->>'revision'<>'1' THEN RAISE EXCEPTION 'PROBE_REAL_CREATE_FAILED'; END IF;
  replay:=public.debate_v3_commit(create_request);
  IF replay IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'PROBE_IDEMPOTENT_RECEIPT_FAILED'; END IF;
  rejected:=public.debate_v3_commit(jsonb_set(create_request,'{payloadHash}',to_jsonb(repeat('f',64))));
  IF rejected->'error'->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'PROBE_CONFLICTING_REPLAY_FAILED'; END IF;
  rejected:=public.debate_v3_commit(jsonb_set(update_request,'{expectedRevision}','0'::jsonb));
  IF rejected->'error'->>'code' IS DISTINCT FROM 'REVISION_CONFLICT' THEN RAISE EXCEPTION 'PROBE_STALE_REVISION_FAILED'; END IF;
  changed:=jsonb_set(update_request,'{state,ownerId}','"rollback-only-forged-owner"'::jsonb);
  rejected:=public.debate_v3_commit(changed);
  IF rejected->'error'->>'code' IS DISTINCT FROM 'FORBIDDEN' THEN RAISE EXCEPTION 'PROBE_OWNER_IMMUTABILITY_FAILED'; END IF;
  receipt:=public.debate_v3_commit(update_request);
  IF receipt ? 'error' OR receipt->>'revision'<>'2' OR public.debate_v3_read(event_key)->>'revision'<>'2' THEN RAISE EXCEPTION 'PROBE_REAL_UPDATE_FAILED'; END IF;
  SELECT jsonb_agg(to_jsonb(a) order by revision) INTO before_audit FROM public.debate_v3_audit a where event_id=event_key;
  IF jsonb_array_length(before_audit)<>2 THEN RAISE EXCEPTION 'PROBE_APPEND_AUDIT_FAILED'; END IF;
  BEGIN UPDATE public.debate_v3_audit SET record='{"tampered":true}'::jsonb WHERE event_id=event_key; RAISE EXCEPTION 'PROBE_AUDIT_UPDATE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE TABLE public.debate_v3_audit; RAISE EXCEPTION 'PROBE_AUDIT_TRUNCATE_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT jsonb_agg(to_jsonb(a) order by revision) INTO after_audit FROM public.debate_v3_audit a where event_id=event_key;
  IF after_audit IS DISTINCT FROM before_audit THEN RAISE EXCEPTION 'PROBE_AUDIT_CHANGED'; END IF;
  -- No Auth/account mutation and no provider/media/outbox creation.
  existing_catalog:=public.study_room_catalog_v1();
  IF existing_catalog IS DISTINCT FROM public.study_room_catalog_v2() THEN RAISE EXCEPTION 'PROBE_STUDY_V2_READ_PARITY'; END IF;
  BEGIN PERFORM public.study_room_admission_v1('{}'::jsonb); RAISE EXCEPTION 'PROBE_ADMISSION_INVALID_EXPECTED_PT400'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  BEGIN PERFORM public.study_room_configure_v2(null,'update','2','Probe must never update','approval',1); RAISE EXCEPTION 'PROBE_STUDY_CONFIG_EXPECTED_42501'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Exact just-created synthetic rows only; verifies intentional DELETE grants.
  DELETE FROM public.debate_v3_receipts WHERE event_id=event_key AND actor_id=actor_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROBE_SERVICE_RECEIPT_DELETE_FAILED'; END IF;
  DELETE FROM public.debate_v3_audit WHERE event_id=event_key AND actor_id=actor_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROBE_SERVICE_AUDIT_DELETE_FAILED'; END IF;
  DELETE FROM public.debate_v3_events WHERE id=event_key AND owner_id=actor_key;
  IF NOT FOUND OR EXISTS(select 1 from public.debate_v3_events) OR EXISTS(select 1 from public.debate_v3_audit)
    OR EXISTS(select 1 from public.debate_v3_receipts) OR EXISTS(select 1 from public.debate_v3_outbox) THEN RAISE EXCEPTION 'PROBE_SYNTHETIC_DELETE_FAILED'; END IF;
END;
$probe_service_transactions$;
SET LOCAL ROLE postgres;

DO $probe_existing_preservation$
DECLARE x jsonb; observed text;
BEGIN
  FOR x IN SELECT value FROM jsonb_array_elements($old_functions$[{"schema":"private","name":"study_room_catalog_v1","arguments":"","definition_md5":"8cc1fd64fd2c6638350619f8981e0852"},{"schema":"private","name":"study_room_configure_v1","arguments":"p_actor_user_id uuid, p_operation text, p_room_key text, p_label text, p_audience text, p_expected_revision integer","definition_md5":"c36dec5163003b107063b904be081502"},{"schema":"public","name":"admin_authorization_context","arguments":"p_actor_user_id uuid","definition_md5":"51ea270969dd6283a3e29b8fbff10561"},{"schema":"public","name":"study_room_catalog_v1","arguments":"","definition_md5":"9346b52ec25cdb9e9aadf8a28f96bc99"},{"schema":"public","name":"study_room_configure_v1","arguments":"p_actor_user_id uuid, p_operation text, p_room_key text, p_label text, p_audience text, p_expected_revision integer","definition_md5":"75afec464e3b1158fa69390751468a92"}]$old_functions$::jsonb) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO observed FROM pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=x->>'schema' and p.proname=x->>'name' and pg_get_function_identity_arguments(p.oid)=x->>'arguments';
    IF observed IS DISTINCT FROM x->>'definition_md5' THEN RAISE EXCEPTION 'PROBE_EXISTING_FUNCTION_CHANGED'; END IF;
  END LOOP;
  IF (select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key),'[]'::jsonb)::text) from private.study_room_catalog c) IS DISTINCT FROM current_setting('debate_probe.catalog_hash')
    OR (select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key,revision),'[]'::jsonb)::text) from private.study_room_catalog_audit c) IS DISTINCT FROM current_setting('debate_probe.catalog_audit_hash')
    OR (select md5(coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]'::jsonb)::text) from supabase_migrations.schema_migrations) IS DISTINCT FROM current_setting('debate_probe.migration_hash') THEN
    RAISE EXCEPTION 'PROBE_EXISTING_ROWS_OR_LEDGER_CHANGED';
  END IF;
END;
$probe_existing_preservation$;
SELECT jsonb_build_object('checkpoint','TRANSACTIONAL_CHECKS_PASSED','rollbackPending',true,'businessRecordsReturned',false,'authAccountsCreated',0,'providerCalls',0) AS rollback_probe;
ROLLBACK;

-- Independent readback is still required by the release coordinator.
DO $probe_after_rollback$
BEGIN
  IF EXISTS (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('public','private') and (c.relname like 'debate_v3_%' or c.relname like 'study_room_admission%' or c.relname in ('study_room_catalog_v2','study_room_configure_v2'))))
    OR EXISTS (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where (n.nspname in ('public','private') and (t.typname like 'debate_v3_%' or t.typname like 'study_room_admission%' or t.typname in ('study_room_catalog_v2','study_room_configure_v2'))))
    OR EXISTS (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname in ('public','private') and (p.proname like 'debate_v3_%' or p.proname like 'study_room_admission%' or p.proname in ('study_room_catalog_v2','study_room_configure_v2'))))
    OR EXISTS(select 1 from supabase_migrations.schema_migrations where version in ('20260909080139','20260909080143')) THEN RAISE EXCEPTION 'PROBE_ROLLBACK_OBJECTS_REMAIN'; END IF;
  IF EXISTS(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where a.attrelid='private.study_room_catalog'::regclass and a.attname='audience')
    OR (select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.study_room_catalog'::regclass and conname='study_room_catalog_audience_check')
      IS DISTINCT FROM $original_audience$CHECK ((audience = ANY (ARRAY['admin'::text, 'paid'::text, 'all'::text])))$original_audience$ THEN RAISE EXCEPTION 'PROBE_ROLLBACK_STUDY_METADATA_CHANGED'; END IF;
END;
$probe_after_rollback$;
SELECT jsonb_build_object('status','ROLLBACK_COMPLETED_OBJECTS_ABSENT','hostedApplication',false,'independentReadbackRequired',true,
  'catalogHash',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key),'[]'::jsonb)::text) from private.study_room_catalog c),
  'catalogAuditHash',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by room_key,revision),'[]'::jsonb)::text) from private.study_room_catalog_audit c),
  'migrationLedgerHash',(select md5(coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]'::jsonb)::text) from supabase_migrations.schema_migrations)) AS rollback_probe;
