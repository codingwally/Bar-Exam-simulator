-- REVIEW ONLY / NOT APPLIED. Staging project hlzqmreeoghbldnhlybr only.
-- Production hbllomlijfznnuudpdvr is forbidden. This SQL cannot authenticate a Supabase project.
-- Executor must send this exact query only through the fixed project_id structured request.
-- Default binding raises before any DDL. This new envelope has NOT been executed in PostgreSQL.
-- One DO statement is atomic. There is no internal COMMIT, row backfill or persistent helper object.
DO $staging_compatibility_review$
DECLARE
  binding constant jsonb := $review_binding${"status":"REVIEW_ONLY_NOT_APPROVED","targetProjectId":"hlzqmreeoghbldnhlybr","productionProjectIdForbidden":"hbllomlijfznnuudpdvr","nativeRunId":39426693601,"testedSourceHead":"70dce183f020c6fc52d98662e99184e03d885d92","finalVerifiedSourceHead":"c5359908af2bfcb145b40362f563eea02efe85f8","finalNativeRunId":39427673315,"testedPackageManifestSha256":"ac5be7b2899a7a48bf573ef03ec02d515477d9e12961cbc58b3640f03a3cfd11","targetAcknowledgment":null,"releaseAuthorizationEvidenceSha256":null,"currentCaptureEvidenceSha256":null,"cutover":{"status":"PAUSE_AND_DRAIN_NOT_ESTABLISHED","methodDescription":null,"pauseEvidenceSha256":null,"drainEvidenceSha256":null,"allowedAfterUtc":null,"expiresAtUtc":null,"originalRowState":null,"writesNeverResumed":false,"inverseAuthorizationEvidenceSha256":null}}$review_binding$::jsonb;
  actual jsonb;
  before_rows jsonb;
  after_rows jsonb;
BEGIN
  IF binding->>'status' IS DISTINCT FROM 'APPROVED_STAGING_ONLY'
     OR binding->>'targetProjectId' IS DISTINCT FROM 'hlzqmreeoghbldnhlybr'
     OR binding->>'targetAcknowledgment' IS DISTINCT FROM 'STAGING ONLY hlzqmreeoghbldnhlybr; PRODUCTION hbllomlijfznnuudpdvr FORBIDDEN'
  THEN RAISE EXCEPTION 'REVIEW_ONLY_STAGING_RELEASE_NOT_APPROVED'; END IF;
  IF coalesce(binding->>'releaseAuthorizationEvidenceSha256','') !~ '^[0-9a-f]{64}$'
     OR coalesce(binding->>'currentCaptureEvidenceSha256','') !~ '^[0-9a-f]{64}$'
     OR binding#>>'{cutover,status}' IS DISTINCT FROM 'INGRESS_PAUSED_AND_INFLIGHT_DRAINED'
     OR coalesce(binding#>>'{cutover,pauseEvidenceSha256}','') !~ '^[0-9a-f]{64}$'
     OR coalesce(binding#>>'{cutover,drainEvidenceSha256}','') !~ '^[0-9a-f]{64}$'
     OR length(coalesce(binding#>>'{cutover,methodDescription}','')) < 40
     OR binding#>>'{cutover,allowedAfterUtc}' IS NULL
     OR binding#>>'{cutover,expiresAtUtc}' IS NULL
     OR coalesce(binding#>>'{cutover,allowedAfterUtc}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     OR coalesce(binding#>>'{cutover,expiresAtUtc}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     OR clock_timestamp() < (binding#>>'{cutover,allowedAfterUtc}')::timestamptz
     OR clock_timestamp() >= (binding#>>'{cutover,expiresAtUtc}')::timestamptz
     OR (binding#>>'{cutover,expiresAtUtc}')::timestamptz-(binding#>>'{cutover,allowedAfterUtc}')::timestamptz > interval '15 minutes'
     OR jsonb_typeof(binding#>'{cutover,originalRowState}') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'ENFORCED_CURRENT_CUTOVER_EVIDENCE_REQUIRED'; END IF;
  IF binding#>>'{cutover,writesNeverResumed}' IS DISTINCT FROM 'true'
     OR coalesce(binding#>>'{cutover,inverseAuthorizationEvidenceSha256}','') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'INVERSE_FORBIDDEN_AFTER_WRITES_RESUMED_OR_WITHOUT_SEPARATE_AUTHORIZATION'; END IF;

  SELECT to_jsonb(s)-'captured_at' INTO actual FROM (SELECT clock_timestamp() AS captured_at, current_database() AS database_name, current_user AS current_user_name, session_user AS session_user_name, current_setting('role') AS configured_role, current_setting('transaction_isolation') AS transaction_isolation, pg_get_userbyid(d.datdba) AS database_owner, jsonb_build_object('superuser',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDatabase',r.rolcreatedb,'canLogin',r.rolcanlogin,'replication',r.rolreplication,'bypassRls',r.rolbypassrls) AS current_role_flags FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()) s;
  IF actual IS DISTINCT FROM $expected_identity${"database_name":"postgres","current_user_name":"postgres","session_user_name":"postgres","configured_role":"none","transaction_isolation":"read committed","database_owner":"postgres","current_role_flags":{"inherit":true,"canLogin":true,"bypassRls":true,"superuser":false,"createRole":true,"replication":true,"createDatabase":true}}$expected_identity$::jsonb THEN RAISE EXCEPTION 'STAGING_EXECUTOR_IDENTITY_MISMATCH'; END IF;
  IF current_setting('transaction_read_only') IS DISTINCT FROM 'off' THEN RAISE EXCEPTION 'MIGRATION_TRANSACTION_REQUIRED'; END IF;
  -- Independent SQL identity checks supplement, but cannot replace, the executor project binding.
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('role')<>'none' OR current_setting('transaction_isolation')<>'read committed'
  THEN RAISE EXCEPTION 'UNEXPECTED_MIGRATION_ROLE_OR_DATABASE'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('TimeZone','UTC',true);
  PERFORM set_config('DateStyle','ISO, YMD',true);
  PERFORM set_config('IntervalStyle','postgres',true);
  PERFORM set_config('extra_float_digits','3',true);
  PERFORM set_config('bytea_output','hex',true);
  IF NOT pg_try_advisory_xact_lock(176018,61018) THEN RAISE EXCEPTION 'COMPATIBILITY_UPDATE_BUSY'; END IF;
  -- All application ingress and pre-existing invocations must already be paused and drained.
  -- These locks fence table writes during this transaction; they do not establish that pause.
  LOCK TABLE examination_room_v1."answer_revisions", examination_room_v1."audit_events", examination_room_v1."email_delivery_events", examination_room_v1."exam_roster", examination_room_v1."exam_versions", examination_room_v1."exams", examination_room_v1."grade_revision_items", examination_room_v1."grade_revisions", examination_room_v1."institutions", examination_room_v1."media_upload_intents", examination_room_v1."owner_identity_corrections", examination_room_v1."owner_key_envelopes", examination_room_v1."privacy_acceptances", examination_room_v1."privacy_notice_versions", examination_room_v1."proctoring_artifacts", examination_room_v1."proctoring_incidents", examination_room_v1."professor_access_requests", examination_room_v1."questions", examination_room_v1."recovery_snapshots", examination_room_v1."result_email_delivery_events", examination_room_v1."result_releases", examination_room_v1."room_activations", examination_room_v1."staff_memberships", examination_room_v1."student_identities", examination_room_v1."student_sessions", examination_room_v1."submission_answers", examination_room_v1."submission_receipts", examination_room_v1."submissions" IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM examination_room_v1.student_sessions)
     OR EXISTS (SELECT 1 FROM examination_room_v1.exam_roster)
  THEN RAISE EXCEPTION 'NONEMPTY_STUDENT_CUTOVER_REQUIRES_NEW_REVIEW'; END IF;
  SELECT to_jsonb(s)-'captured_at'-'server_version' INTO actual FROM (SELECT clock_timestamp() AS captured_at, current_setting('server_version') AS server_version,
 current_setting('server_version_num') AS server_version_num,
 current_setting('default_transaction_isolation') AS default_transaction_isolation,
 current_setting('server_encoding') AS server_encoding,
 (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text) ORDER BY n.nspname) FROM pg_namespace n WHERE n.nspname IN ('examination_room_v1','public','auth','extensions')) AS schemas,
 (SELECT jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'inherit',rolinherit,'bypass_rls',rolbypassrls,'can_login',rolcanlogin) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','service_role','anon','authenticated')) AS roles,
 (SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('pgcrypto','plpgsql')) AS extensions,
 (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped AND ((n.nspname='auth' AND c.relname='users' AND a.attname IN ('id','email')) OR (n.nspname='public' AND c.relname='profiles' AND a.attname IN ('id','law_school_id','law_school_other','school')) OR (n.nspname='public' AND c.relname='user_roles' AND a.attname IN ('user_id','role')))) AS external_authorization_columns) s;
  IF actual IS DISTINCT FROM $expected_runtime${"server_version_num":"170006","default_transaction_isolation":"read committed","server_encoding":"UTF8","schemas":[{"acl":"{supabase_admin=UC/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_auth_admin=UC/supabase_admin,dashboard_user=UC/supabase_admin,postgres=U/supabase_admin}","owner":"supabase_admin","schema":"auth"},{"acl":"{postgres=UC/postgres,service_role=U/postgres}","owner":"postgres","schema":"examination_room_v1"},{"acl":"{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=U/postgres,dashboard_user=UC/postgres}","owner":"postgres","schema":"extensions"},{"acl":"{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,postgres=U/pg_database_owner,anon=U/pg_database_owner,authenticated=U/pg_database_owner,service_role=U/pg_database_owner}","owner":"pg_database_owner","schema":"public"}],"roles":[{"role":"anon","inherit":true,"can_login":false,"superuser":false,"bypass_rls":false},{"role":"authenticated","inherit":true,"can_login":false,"superuser":false,"bypass_rls":false},{"role":"postgres","inherit":true,"can_login":true,"superuser":false,"bypass_rls":true},{"role":"service_role","inherit":true,"can_login":false,"superuser":false,"bypass_rls":true}],"extensions":[{"name":"pgcrypto","schema":"extensions","version":"1.3"},{"name":"plpgsql","schema":"pg_catalog","version":"1.0"}],"external_authorization_columns":[{"kind":"r","type":"uuid","table":"users","column":"id","schema":"auth"},{"kind":"r","type":"character varying(255)","table":"users","column":"email","schema":"auth"},{"kind":"r","type":"uuid","table":"profiles","column":"id","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"school","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"law_school_id","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"law_school_other","schema":"public"},{"kind":"r","type":"uuid","table":"user_roles","column":"user_id","schema":"public"},{"kind":"r","type":"text","table":"user_roles","column":"role","schema":"public"}]}$expected_runtime$::jsonb THEN RAISE EXCEPTION 'STAGING_RUNTIME_OR_AUTHORIZATION_METADATA_CHANGED'; END IF;
  SELECT to_jsonb(s)-'captured_at' INTO actual FROM (SELECT clock_timestamp() AS captured_at,
 jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY n.nspname,c.relname,a.attnum) AS external_authorization_columns
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE a.attnum>0 AND NOT a.attisdropped AND ((n.nspname='auth' AND c.relname='users' AND a.attname IN ('id','email','raw_user_meta_data')) OR (n.nspname='public' AND c.relname='profiles' AND a.attname IN ('id','display_name','law_school_id','law_school_other','school')) OR (n.nspname='public' AND c.relname='user_roles' AND a.attname IN ('user_id','role')))) s;
  IF actual IS DISTINCT FROM $expected_external${"external_authorization_columns":[{"kind":"r","type":"uuid","table":"users","column":"id","schema":"auth"},{"kind":"r","type":"character varying(255)","table":"users","column":"email","schema":"auth"},{"kind":"r","type":"jsonb","table":"users","column":"raw_user_meta_data","schema":"auth"},{"kind":"r","type":"uuid","table":"profiles","column":"id","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"display_name","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"school","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"law_school_id","schema":"public"},{"kind":"r","type":"text","table":"profiles","column":"law_school_other","schema":"public"},{"kind":"r","type":"uuid","table":"user_roles","column":"user_id","schema":"public"},{"kind":"r","type":"text","table":"user_roles","column":"role","schema":"public"}]}$expected_external$::jsonb THEN RAISE EXCEPTION 'EXTERNAL_AUTHORIZATION_COLUMNS_CHANGED'; END IF;
  SELECT to_jsonb(s)-'captured_at' INTO actual FROM (SELECT clock_timestamp() AS captured_at,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1' AND c.relkind IN ('r','p','v')) AS relations,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='examination_room_v1' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped) AS columns,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1') AS constraints,
(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='examination_room_v1') AS indexes,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1' AND NOT t.tgisinternal) AS triggers,
(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='examination_room_v1') AS policies) s;
  -- The new lease trigger is checked separately by full definition, function and enabled state.
  actual := jsonb_set(actual,'{triggers}',coalesce((SELECT jsonb_agg(t ORDER BY t->>'table',t->>'name') FROM jsonb_array_elements(actual->'triggers') t WHERE NOT (t->>'table'='student_sessions' AND t->>'name'='student_sessions_open_room_lease')),'[]'::jsonb));
  IF actual IS DISTINCT FROM $expected_schema${"relations":[{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"answer_revisions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"audit_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"email_delivery_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exam_roster","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exam_versions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exams","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"grade_revision_items","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"grade_revisions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"institutions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres}","rls":true,"kind":"r","owner":"postgres","table":"media_upload_intents","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"owner_identity_corrections","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"owner_key_envelopes","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"privacy_acceptances","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"privacy_notice_versions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"proctoring_artifacts","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"proctoring_incidents","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"professor_access_requests","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"questions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"recovery_snapshots","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"result_email_delivery_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"result_releases","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"room_activations","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"staff_memberships","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"student_identities","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"student_sessions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submission_answers","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submission_receipts","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submissions","force_rls":true}],"columns":[{"type":"uuid","table":"answer_revisions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"answer_revisions","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"answer_revisions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"answer_revisions","column":"question_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"integer","table":"answer_revisions","column":"revision_number","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"answer_revisions","column":"client_revision_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"answer_revisions","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"answer_revisions","column":"answer_format","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"jsonb","table":"answer_revisions","column":"answer_payload","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"answer_revisions","column":"answer_sha256","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"boolean","table":"answer_revisions","column":"is_flagged","default":"false","identity":"","not_null":true,"position":11,"generated":""},{"type":"integer","table":"answer_revisions","column":"word_count","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"answer_revisions","column":"source","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"answer_revisions","column":"saved_at","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"answer_revisions","column":"received_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"audit_events","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"audit_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"audit_events","column":"exam_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"uuid","table":"audit_events","column":"session_id","default":null,"identity":"","not_null":false,"position":4,"generated":""},{"type":"uuid","table":"audit_events","column":"actor_user_id","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"audit_events","column":"actor_role","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"audit_events","column":"event_type","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"audit_events","column":"subject_type","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"audit_events","column":"subject_id","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"uuid","table":"audit_events","column":"correlation_id","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"audit_events","column":"request_hash","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"audit_events","column":"ip_hash","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"audit_events","column":"user_agent_hash","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"jsonb","table":"audit_events","column":"event_data","default":"'{}'::jsonb","identity":"","not_null":true,"position":14,"generated":""},{"type":"text","table":"audit_events","column":"previous_event_hash","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"text","table":"audit_events","column":"event_hash","default":null,"identity":"","not_null":true,"position":16,"generated":""},{"type":"timestamp with time zone","table":"audit_events","column":"occurred_at","default":null,"identity":"","not_null":true,"position":17,"generated":""},{"type":"timestamp with time zone","table":"audit_events","column":"recorded_at","default":"now()","identity":"","not_null":true,"position":18,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"activation_id","default":null,"identity":"","not_null":false,"position":4,"generated":""},{"type":"text","table":"email_delivery_events","column":"request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"email_delivery_events","column":"delivery_kind","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"email_delivery_events","column":"professor_recipient","default":null,"identity":"","not_null":false,"position":7,"generated":""},{"type":"jsonb","table":"email_delivery_events","column":"owner_copy_recipients","default":"'[]'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"email_delivery_events","column":"provider_status","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"email_delivery_events","column":"provider_id","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"text","table":"email_delivery_events","column":"safe_error_code","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"attempted_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"email_delivery_events","column":"attempted_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"exam_roster","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exam_roster","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exam_roster","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"exam_roster","column":"student_identity_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exam_roster","column":"grading_alias","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"exam_roster","column":"roster_status","default":"'eligible'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"exam_roster","column":"accommodations","default":"'{}'::jsonb","identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"exam_roster","column":"added_by_user_id","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"exam_roster","column":"created_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"exam_roster","column":"updated_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"exam_versions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exam_versions","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exam_versions","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"exam_versions","column":"version_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exam_versions","column":"title_snapshot","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"exam_versions","column":"instructions","default":"''::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"integer","table":"exam_versions","column":"duration_seconds","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"boolean","table":"exam_versions","column":"anonymous_grading_snapshot","default":"false","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"exam_versions","column":"privacy_notice_version_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"jsonb","table":"exam_versions","column":"controls","default":"'{}'::jsonb","identity":"","not_null":true,"position":10,"generated":""},{"type":"jsonb","table":"exam_versions","column":"publication_manifest","default":"'{}'::jsonb","identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"exam_versions","column":"content_sha256","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"exam_versions","column":"publication_status","default":"'building'::text","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"exam_versions","column":"published_by_user_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"exam_versions","column":"published_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"timestamp with time zone","table":"exam_versions","column":"created_at","default":"now()","identity":"","not_null":true,"position":16,"generated":""},{"type":"text","table":"exam_versions","column":"admission_mode_snapshot","default":"'key_only'::text","identity":"","not_null":true,"position":17,"generated":""},{"type":"text[]","table":"exam_versions","column":"allowed_emails_snapshot","default":"'{}'::text[]","identity":"","not_null":true,"position":18,"generated":""},{"type":"uuid","table":"exams","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exams","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exams","column":"owner_user_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"exams","column":"title","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exams","column":"description","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"exams","column":"status","default":"'draft'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"boolean","table":"exams","column":"anonymous_grading","default":"false","identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"exams","column":"current_published_version_id","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"created_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"updated_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"closed_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"archived_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"exams","column":"admission_mode","default":"'key_only'::text","identity":"","not_null":true,"position":13,"generated":""},{"type":"text[]","table":"exams","column":"allowed_emails","default":"'{}'::text[]","identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"blocked_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"uuid","table":"exams","column":"blocked_by_user_id","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"text","table":"exams","column":"block_reason","default":null,"identity":"","not_null":false,"position":17,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"deleted_at","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"uuid","table":"exams","column":"deleted_by_user_id","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"text","table":"exams","column":"delete_reason","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"text","table":"exams","column":"lifecycle_prior_status","default":null,"identity":"","not_null":false,"position":21,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"grade_revision_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"question_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"numeric(12,2)","table":"grade_revision_items","column":"score","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"numeric(12,2)","table":"grade_revision_items","column":"maximum_score","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"grade_revision_items","column":"feedback","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"jsonb","table":"grade_revision_items","column":"rubric_marks","default":"'{}'::jsonb","identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"grade_revision_items","column":"created_at","default":"now()","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"grade_revisions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"grade_revisions","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"grade_revisions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"grade_revisions","column":"revision_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"grade_revisions","column":"client_revision_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"grade_revisions","column":"manifest_sha256","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"grade_revisions","column":"grading_manifest","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"grade_revisions","column":"grader_user_id","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"grade_revisions","column":"source","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"grade_revisions","column":"grade_status","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"integer","table":"grade_revisions","column":"item_count","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"numeric(12,2)","table":"grade_revisions","column":"total_score","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"numeric(12,2)","table":"grade_revisions","column":"maximum_score","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"grade_revisions","column":"general_feedback","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"text","table":"grade_revisions","column":"private_notes","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"jsonb","table":"grade_revisions","column":"rubric_snapshot","default":"'{}'::jsonb","identity":"","not_null":true,"position":16,"generated":""},{"type":"timestamp with time zone","table":"grade_revisions","column":"created_at","default":"now()","identity":"","not_null":true,"position":17,"generated":""},{"type":"uuid","table":"institutions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"text","table":"institutions","column":"institution_code","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"institutions","column":"profile_school_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"institutions","column":"institution_name","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"institutions","column":"institution_status","default":"'active'::text","identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"institutions","column":"bootstrap_request_hash","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"institutions","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"institutions","column":"created_at","default":"now()","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"client_artifact_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"media_upload_intents","column":"request_hash","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"media_upload_intents","column":"artifact_kind","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"media_upload_intents","column":"source_mime_type","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"bigint","table":"media_upload_intents","column":"encrypted_size_bytes","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"media_upload_intents","column":"object_sha256","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"captured_from","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"captured_to","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"retention_until","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"media_upload_intents","column":"provider","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"media_upload_intents","column":"provider_object_reference","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_algorithm","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"smallint","table":"media_upload_intents","column":"wrapped_key_version","default":null,"identity":"","not_null":true,"position":15,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_ciphertext","default":null,"identity":"","not_null":true,"position":16,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_iv","default":null,"identity":"","not_null":true,"position":17,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_aad_sha256","default":null,"identity":"","not_null":true,"position":18,"generated":""},{"type":"text","table":"media_upload_intents","column":"intent_status","default":"'prepared'::text","identity":"","not_null":true,"position":19,"generated":""},{"type":"text","table":"media_upload_intents","column":"completion_request_hash","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"jsonb","table":"media_upload_intents","column":"provider_result","default":"'{}'::jsonb","identity":"","not_null":true,"position":21,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"artifact_id","default":null,"identity":"","not_null":false,"position":22,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"prepared_at","default":"now()","identity":"","not_null":true,"position":23,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"completed_at","default":null,"identity":"","not_null":false,"position":24,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"created_at","default":"now()","identity":"","not_null":true,"position":25,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"updated_at","default":"now()","identity":"","not_null":true,"position":26,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"student_identity_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"owner_identity_corrections","column":"request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"jsonb","table":"owner_identity_corrections","column":"before_record","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"owner_identity_corrections","column":"after_record","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"owner_identity_corrections","column":"reason","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"corrected_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"owner_identity_corrections","column":"corrected_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"activation_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"envelope_algorithm","default":"'aes-256-gcm-v1'::text","identity":"","not_null":true,"position":4,"generated":""},{"type":"integer","table":"owner_key_envelopes","column":"key_version","default":"1","identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"ciphertext_base64","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"iv_base64","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"aad_sha256","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"owner_key_envelopes","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"notice_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"roster_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"session_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"client_event_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"privacy_acceptances","column":"decision","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"prior_acceptance_id","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"jsonb","table":"privacy_acceptances","column":"accepted_features","default":"'{}'::jsonb","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"privacy_acceptances","column":"evidence_sha256","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"privacy_acceptances","column":"capture_method","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"privacy_acceptances","column":"recorded_at","default":"now()","identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"privacy_acceptances","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"notice_code","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"privacy_notice_versions","column":"version_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"title","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"notice_body","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"body_sha256","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"jsonb","table":"privacy_notice_versions","column":"processing_purposes","default":"'[]'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"privacy_notice_versions","column":"effective_at","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"privacy_notice_versions","column":"created_at","default":"now()","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"incident_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"artifact_kind","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"encrypted_object_reference","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"object_sha256","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"encryption_key_reference","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"captured_from","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"captured_to","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"retention_until","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"artifact_status","default":"'available'::text","identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"created_at","default":"now()","identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"updated_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"client_event_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"proctoring_incidents","column":"incident_kind","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"proctoring_incidents","column":"source","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"proctoring_incidents","column":"severity","default":"'info'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"occurred_at","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"integer","table":"proctoring_incidents","column":"duration_ms","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"jsonb","table":"proctoring_incidents","column":"details","default":"'{}'::jsonb","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"proctoring_incidents","column":"review_status","default":"'unreviewed'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"reviewed_by_user_id","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"reviewed_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"proctoring_incidents","column":"review_notes","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"created_at","default":"now()","identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"updated_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"user_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"professor_access_requests","column":"email_normalized","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"professor_access_requests","column":"display_name","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"professor_access_requests","column":"claimed_school_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"professor_access_requests","column":"claimed_school_name","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"requested_institution_id","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"professor_access_requests","column":"request_status","default":"'pending'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"requested_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"reviewed_by_user_id","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"reviewed_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"text","table":"professor_access_requests","column":"review_reason","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"assigned_institution_id","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"approved_membership_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"updated_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"questions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"questions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"integer","table":"questions","column":"position","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"questions","column":"question_key","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"questions","column":"question_kind","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"questions","column":"prompt","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"numeric(10,2)","table":"questions","column":"points","default":"0","identity":"","not_null":true,"position":7,"generated":""},{"type":"jsonb","table":"questions","column":"configuration","default":"'{}'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"questions","column":"content_sha256","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"questions","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"recovery_snapshots","column":"snapshot_sequence","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_scope","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"recovery_snapshots","column":"request_hash","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"recovery_snapshots","column":"encrypted_object_reference","default":null,"identity":"","not_null":false,"position":7,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_sha256","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"recovery_snapshots","column":"encryption_key_reference","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"bigint","table":"recovery_snapshots","column":"record_count","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_status","default":"'pending'::text","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"created_by_user_id","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"retention_until","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"restored_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"restored_by_user_id","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"updated_at","default":"now()","identity":"","not_null":true,"position":17,"generated":""},{"type":"text","table":"recovery_snapshots","column":"source_kind","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_session_id","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_submission_id","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_grade_revision_id","default":null,"identity":"","not_null":false,"position":21,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_result_release_id","default":null,"identity":"","not_null":false,"position":22,"generated":""},{"type":"integer","table":"recovery_snapshots","column":"materialization_attempts","default":"0","identity":"","not_null":true,"position":23,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"lease_id","default":null,"identity":"","not_null":false,"position":24,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"lease_expires_at","default":null,"identity":"","not_null":false,"position":25,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"next_retry_at","default":null,"identity":"","not_null":false,"position":26,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"available_at","default":null,"identity":"","not_null":false,"position":27,"generated":""},{"type":"text","table":"recovery_snapshots","column":"last_error_code","default":null,"identity":"","not_null":false,"position":28,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"last_error_at","default":null,"identity":"","not_null":false,"position":29,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"verified_at","default":null,"identity":"","not_null":false,"position":30,"generated":""},{"type":"bigint","table":"recovery_snapshots","column":"restored_record_count","default":"0","identity":"","not_null":true,"position":31,"generated":""},{"type":"text","table":"recovery_snapshots","column":"restore_verification_sha256","default":null,"identity":"","not_null":false,"position":32,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"release_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"student_session_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"batch_request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"recipient_email","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"recipient_name","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"exam_title","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"subject_name","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"numeric(10,2)","table":"result_email_delivery_events","column":"total_score","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"numeric(10,2)","table":"result_email_delivery_events","column":"maximum_score","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"released_at","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"delivery_status","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"provider_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"safe_error_code","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"integer","table":"result_email_delivery_events","column":"attempt_count","default":"0","identity":"","not_null":true,"position":16,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"claim_token","default":null,"identity":"","not_null":false,"position":17,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"lease_expires_at","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"attempted_at","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"completed_at","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"created_at","default":"now()","identity":"","not_null":true,"position":21,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"updated_at","default":"now()","identity":"","not_null":true,"position":22,"generated":""},{"type":"uuid","table":"result_releases","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"result_releases","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"result_releases","column":"grade_revision_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"result_releases","column":"release_action","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"result_releases","column":"supersedes_release_id","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"result_releases","column":"channel","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"result_releases","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"result_releases","column":"delivery_reference_hash","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"result_releases","column":"manifest_sha256","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"jsonb","table":"result_releases","column":"release_manifest","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"text","table":"result_releases","column":"reason","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"result_releases","column":"performed_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"result_releases","column":"occurred_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"result_releases","column":"batch_request_hash","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"uuid","table":"room_activations","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"room_activations","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"room_activations","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"room_activations","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"room_activations","column":"key_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"room_activations","column":"key_hash_algorithm","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"room_activations","column":"request_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"room_activations","column":"activation_status","default":"'scheduled'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"opens_at","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"closes_at","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"integer","table":"room_activations","column":"max_sessions","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"room_activations","column":"activated_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"deactivated_at","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"uuid","table":"room_activations","column":"deactivated_by_user_id","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"text","table":"room_activations","column":"deactivation_reason","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"uuid","table":"staff_memberships","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"staff_memberships","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"staff_memberships","column":"user_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"staff_memberships","column":"staff_role","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"staff_memberships","column":"display_name","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"staff_memberships","column":"email_normalized","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"staff_memberships","column":"membership_status","default":"'active'::text","identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"staff_memberships","column":"grant_reason","default":"'Institution examination access approved.'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"staff_memberships","column":"granted_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"granted_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"staff_memberships","column":"revoked_by_user_id","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"revoked_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"staff_memberships","column":"revocation_reason","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"updated_at","default":"now()","identity":"","not_null":true,"position":14,"generated":""},{"type":"uuid","table":"student_identities","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"student_identities","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"student_identities","column":"auth_user_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"student_identities","column":"external_student_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"student_identities","column":"full_name","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"student_identities","column":"email_normalized","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"student_identities","column":"identity_status","default":"'active'::text","identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"verified_at","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"student_identities","column":"verification_method","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"updated_at","default":"now()","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"student_sessions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"student_sessions","column":"activation_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"student_sessions","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"student_sessions","column":"institution_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"student_sessions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"student_sessions","column":"roster_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"student_sessions","column":"session_token_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"student_sessions","column":"consent_request_hash","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"student_sessions","column":"client_instance_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"student_sessions","column":"session_status","default":"'created'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"identity_verified_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"text","table":"student_sessions","column":"identity_verification_method","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"started_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"last_heartbeat_at","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"lease_expires_at","default":null,"identity":"","not_null":true,"position":15,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"ended_at","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"jsonb","table":"student_sessions","column":"session_metadata","default":"'{}'::jsonb","identity":"","not_null":true,"position":17,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"created_at","default":"now()","identity":"","not_null":true,"position":18,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"updated_at","default":"now()","identity":"","not_null":true,"position":19,"generated":""},{"type":"uuid","table":"submission_answers","column":"submission_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submission_answers","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submission_answers","column":"question_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"submission_answers","column":"answer_revision_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"timestamp with time zone","table":"submission_answers","column":"created_at","default":"now()","identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"submission_receipts","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submission_receipts","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submission_receipts","column":"receipt_code","default":"gen_random_uuid()","identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"submission_receipts","column":"receipt_sha256","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"jsonb","table":"submission_receipts","column":"receipt_payload","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"timestamp with time zone","table":"submission_receipts","column":"issued_at","default":"now()","identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"submissions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submissions","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submissions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"submissions","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"submissions","column":"manifest_sha256","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"jsonb","table":"submissions","column":"submission_manifest","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"integer","table":"submissions","column":"answer_count","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"submitted_at_client","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"received_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"submissions","column":"submission_status","default":"'accepted'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"submissions","column":"status_reason","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"submissions","column":"status_changed_by_user_id","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"updated_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""}],"constraints":[{"kind":"c","name":"answer_revisions_answer_format_check","table":"answer_revisions","definition":"CHECK (answer_format = ANY (ARRAY['rich_text'::text, 'plain_text'::text, 'choice'::text, 'boolean'::text, 'file_reference'::text]))"},{"kind":"c","name":"answer_revisions_answer_payload_check","table":"answer_revisions","definition":"CHECK (jsonb_typeof(answer_payload) = 'object'::text)"},{"kind":"c","name":"answer_revisions_answer_sha256_check","table":"answer_revisions","definition":"CHECK (answer_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"answer_revisions_clock_skew_check","table":"answer_revisions","definition":"CHECK (saved_at <= (received_at + '24:00:00'::interval))"},{"kind":"u","name":"answer_revisions_id_session_question_key","table":"answer_revisions","definition":"UNIQUE (id, session_id, question_id)"},{"kind":"c","name":"answer_revisions_idempotency_key_hash_check","table":"answer_revisions","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"answer_revisions_idempotency_key_hash_key","table":"answer_revisions","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"p","name":"answer_revisions_pkey","table":"answer_revisions","definition":"PRIMARY KEY (id)"},{"kind":"f","name":"answer_revisions_question_version_fk","table":"answer_revisions","definition":"FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"answer_revisions_revision_number_check","table":"answer_revisions","definition":"CHECK (revision_number > 0)"},{"kind":"u","name":"answer_revisions_session_client_key","table":"answer_revisions","definition":"UNIQUE (session_id, client_revision_id)"},{"kind":"u","name":"answer_revisions_session_question_number_key","table":"answer_revisions","definition":"UNIQUE (session_id, question_id, revision_number)"},{"kind":"f","name":"answer_revisions_session_version_fk","table":"answer_revisions","definition":"FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"answer_revisions_source_check","table":"answer_revisions","definition":"CHECK (source = ANY (ARRAY['autosave'::text, 'manual_save'::text, 'recovery'::text, 'submission'::text]))"},{"kind":"c","name":"answer_revisions_word_count_check","table":"answer_revisions","definition":"CHECK (word_count IS NULL OR word_count >= 0)"},{"kind":"c","name":"audit_events_actor_role_check","table":"audit_events","definition":"CHECK (actor_role = ANY (ARRAY['professor'::text, 'admin'::text, 'student'::text, 'system'::text, 'service'::text]))"},{"kind":"c","name":"audit_events_event_data_check","table":"audit_events","definition":"CHECK (jsonb_typeof(event_data) = 'object'::text AND event_data::text !~* '\"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)\"[[:space:]]*:'::text)"},{"kind":"c","name":"audit_events_event_hash_check","table":"audit_events","definition":"CHECK (event_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"audit_events_event_type_check","table":"audit_events","definition":"CHECK (length(btrim(event_type)) >= 1 AND length(btrim(event_type)) <= 120)"},{"kind":"f","name":"audit_events_exam_institution_fk","table":"audit_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"audit_events_institution_hash_key","table":"audit_events","definition":"UNIQUE (institution_id, event_hash)"},{"kind":"f","name":"audit_events_institution_id_fkey","table":"audit_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"u","name":"audit_events_institution_request_key","table":"audit_events","definition":"UNIQUE (institution_id, request_hash)"},{"kind":"c","name":"audit_events_ip_hash_check","table":"audit_events","definition":"CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"audit_events_pkey","table":"audit_events","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"audit_events_previous_event_hash_check","table":"audit_events","definition":"CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"audit_events_previous_hash_fk","table":"audit_events","definition":"FOREIGN KEY (institution_id, previous_event_hash) REFERENCES examination_room_v1.audit_events(institution_id, event_hash) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED"},{"kind":"c","name":"audit_events_request_hash_check","table":"audit_events","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"audit_events_session_context_fk","table":"audit_events","definition":"FOREIGN KEY (session_id, institution_id, exam_id) REFERENCES examination_room_v1.student_sessions(id, institution_id, exam_id) ON DELETE RESTRICT"},{"kind":"f","name":"audit_events_session_id_fkey","table":"audit_events","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"audit_events_session_requires_exam_check","table":"audit_events","definition":"CHECK (session_id IS NULL OR exam_id IS NOT NULL)"},{"kind":"c","name":"audit_events_subject_type_check","table":"audit_events","definition":"CHECK (length(btrim(subject_type)) >= 1 AND length(btrim(subject_type)) <= 80)"},{"kind":"c","name":"audit_events_user_agent_hash_check","table":"audit_events","definition":"CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"email_delivery_events_activation_id_fkey","table":"email_delivery_events","definition":"FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT"},{"kind":"c","name":"email_delivery_events_delivery_kind_check","table":"email_delivery_events","definition":"CHECK (delivery_kind = ANY (ARRAY['activation_key'::text, 'key_resend'::text, 'key_rotation'::text]))"},{"kind":"f","name":"email_delivery_events_exam_scope_fk","table":"email_delivery_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"email_delivery_events_institution_id_fkey","table":"email_delivery_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"email_delivery_events_owner_copy_recipients_check","table":"email_delivery_events","definition":"CHECK (jsonb_typeof(owner_copy_recipients) = 'array'::text)"},{"kind":"p","name":"email_delivery_events_pkey","table":"email_delivery_events","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"email_delivery_events_professor_recipient_check","table":"email_delivery_events","definition":"CHECK (professor_recipient IS NULL OR professor_recipient = lower(btrim(professor_recipient)) AND POSITION(('@'::text) IN (professor_recipient)) > 1 AND length(professor_recipient) >= 3 AND length(professor_recipient) <= 320)"},{"kind":"c","name":"email_delivery_events_provider_id_check","table":"email_delivery_events","definition":"CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240)"},{"kind":"c","name":"email_delivery_events_provider_status_check","table":"email_delivery_events","definition":"CHECK (provider_status = ANY (ARRAY['sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text]))"},{"kind":"c","name":"email_delivery_events_request_hash_check","table":"email_delivery_events","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"email_delivery_events_request_hash_key","table":"email_delivery_events","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"email_delivery_events_safe_error_code_check","table":"email_delivery_events","definition":"CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text)"},{"kind":"c","name":"exam_roster_accommodations_check","table":"exam_roster","definition":"CHECK (jsonb_typeof(accommodations) = 'object'::text)"},{"kind":"f","name":"exam_roster_exam_institution_fk","table":"exam_roster","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"exam_roster_exam_student_key","table":"exam_roster","definition":"UNIQUE (exam_id, student_identity_id)"},{"kind":"c","name":"exam_roster_grading_alias_check","table":"exam_roster","definition":"CHECK (grading_alias IS NULL OR length(btrim(grading_alias)) >= 1 AND length(btrim(grading_alias)) <= 80)"},{"kind":"u","name":"exam_roster_id_exam_institution_key","table":"exam_roster","definition":"UNIQUE (id, exam_id, institution_id)"},{"kind":"u","name":"exam_roster_id_exam_key","table":"exam_roster","definition":"UNIQUE (id, exam_id)"},{"kind":"f","name":"exam_roster_identity_institution_fk","table":"exam_roster","definition":"FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT"},{"kind":"p","name":"exam_roster_pkey","table":"exam_roster","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exam_roster_roster_status_check","table":"exam_roster","definition":"CHECK (roster_status = ANY (ARRAY['invited'::text, 'eligible'::text, 'withdrawn'::text, 'completed'::text]))"},{"kind":"c","name":"exam_versions_admission_mode_check","table":"exam_versions","definition":"CHECK (admission_mode_snapshot = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]))"},{"kind":"c","name":"exam_versions_allowed_emails_check","table":"exam_versions","definition":"CHECK (examination_room_v1.valid_allowed_emails(allowed_emails_snapshot))"},{"kind":"c","name":"exam_versions_content_sha256_check","table":"exam_versions","definition":"CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"exam_versions_controls_check","table":"exam_versions","definition":"CHECK (jsonb_typeof(controls) = 'object'::text)"},{"kind":"c","name":"exam_versions_duration_seconds_check","table":"exam_versions","definition":"CHECK (duration_seconds >= 60 AND duration_seconds <= 86400)"},{"kind":"f","name":"exam_versions_exam_institution_fk","table":"exam_versions","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"exam_versions_exam_version_key","table":"exam_versions","definition":"UNIQUE (exam_id, version_number)"},{"kind":"u","name":"exam_versions_id_exam_institution_key","table":"exam_versions","definition":"UNIQUE (id, exam_id, institution_id)"},{"kind":"u","name":"exam_versions_id_exam_key","table":"exam_versions","definition":"UNIQUE (id, exam_id)"},{"kind":"u","name":"exam_versions_id_notice_key","table":"exam_versions","definition":"UNIQUE (id, privacy_notice_version_id)"},{"kind":"f","name":"exam_versions_notice_institution_fk","table":"exam_versions","definition":"FOREIGN KEY (privacy_notice_version_id, institution_id) REFERENCES examination_room_v1.privacy_notice_versions(id, institution_id) ON DELETE RESTRICT"},{"kind":"p","name":"exam_versions_pkey","table":"exam_versions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exam_versions_publication_manifest_check","table":"exam_versions","definition":"CHECK (jsonb_typeof(publication_manifest) = 'object'::text)"},{"kind":"c","name":"exam_versions_publication_state_check","table":"exam_versions","definition":"CHECK (publication_status = 'building'::text AND published_by_user_id IS NULL AND published_at IS NULL AND publication_manifest = '{}'::jsonb OR publication_status = 'published'::text AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL AND published_at >= created_at AND (publication_manifest ->> 'schemaVersion'::text) = 'examination-room/publication/v1'::text)"},{"kind":"c","name":"exam_versions_publication_status_check","table":"exam_versions","definition":"CHECK (publication_status = ANY (ARRAY['building'::text, 'published'::text]))"},{"kind":"c","name":"exam_versions_title_snapshot_check","table":"exam_versions","definition":"CHECK (length(btrim(title_snapshot)) >= 1 AND length(btrim(title_snapshot)) <= 300)"},{"kind":"c","name":"exam_versions_version_number_check","table":"exam_versions","definition":"CHECK (version_number > 0)"},{"kind":"c","name":"exams_admission_mode_check","table":"exams","definition":"CHECK (admission_mode = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]))"},{"kind":"c","name":"exams_allowed_emails_check","table":"exams","definition":"CHECK (examination_room_v1.valid_allowed_emails(allowed_emails))"},{"kind":"c","name":"exams_block_state_check","table":"exams","definition":"CHECK (blocked_at IS NULL AND blocked_by_user_id IS NULL AND block_reason IS NULL OR blocked_at IS NOT NULL AND blocked_by_user_id IS NOT NULL AND NULLIF(btrim(block_reason), ''::text) IS NOT NULL)"},{"kind":"f","name":"exams_current_published_version_fk","table":"exams","definition":"FOREIGN KEY (current_published_version_id, id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED"},{"kind":"c","name":"exams_delete_state_check","table":"exams","definition":"CHECK (deleted_at IS NULL AND deleted_by_user_id IS NULL AND delete_reason IS NULL OR deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL AND NULLIF(btrim(delete_reason), ''::text) IS NOT NULL)"},{"kind":"u","name":"exams_id_institution_key","table":"exams","definition":"UNIQUE (id, institution_id)"},{"kind":"f","name":"exams_institution_id_fkey","table":"exams","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"exams_lifecycle_prior_status_check","table":"exams","definition":"CHECK (lifecycle_prior_status IS NULL OR (lifecycle_prior_status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text])))"},{"kind":"c","name":"exams_lifecycle_timestamps_check","table":"exams","definition":"CHECK ((closed_at IS NULL OR closed_at >= created_at) AND (archived_at IS NULL OR archived_at >= created_at))"},{"kind":"p","name":"exams_pkey","table":"exams","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exams_publish_state_check","table":"exams","definition":"CHECK (status = 'draft'::text AND current_published_version_id IS NULL OR status <> 'draft'::text AND current_published_version_id IS NOT NULL)"},{"kind":"c","name":"exams_status_check","table":"exams","definition":"CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text]))"},{"kind":"c","name":"exams_title_check","table":"exams","definition":"CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 300)"},{"kind":"c","name":"grade_revision_items_check","table":"grade_revision_items","definition":"CHECK (maximum_score >= 0::numeric AND score <= maximum_score)"},{"kind":"p","name":"grade_revision_items_pkey","table":"grade_revision_items","definition":"PRIMARY KEY (grade_revision_id, question_id)"},{"kind":"f","name":"grade_revision_items_question_version_fk","table":"grade_revision_items","definition":"FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"grade_revision_items_revision_version_fk","table":"grade_revision_items","definition":"FOREIGN KEY (grade_revision_id, exam_version_id) REFERENCES examination_room_v1.grade_revisions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"grade_revision_items_rubric_marks_check","table":"grade_revision_items","definition":"CHECK (jsonb_typeof(rubric_marks) = 'object'::text)"},{"kind":"c","name":"grade_revision_items_score_check","table":"grade_revision_items","definition":"CHECK (score >= 0::numeric)"},{"kind":"c","name":"grade_revisions_check","table":"grade_revisions","definition":"CHECK (maximum_score >= 0::numeric AND total_score <= maximum_score)"},{"kind":"c","name":"grade_revisions_grade_status_check","table":"grade_revisions","definition":"CHECK (grade_status = ANY (ARRAY['draft'::text, 'final'::text, 'corrected'::text]))"},{"kind":"c","name":"grade_revisions_grading_manifest_check","table":"grade_revisions","definition":"CHECK (jsonb_typeof(grading_manifest) = 'object'::text AND (grading_manifest ->> 'schemaVersion'::text) = 'examination-room/grading/v1'::text)"},{"kind":"u","name":"grade_revisions_id_submission_key","table":"grade_revisions","definition":"UNIQUE (id, submission_id)"},{"kind":"u","name":"grade_revisions_id_version_key","table":"grade_revisions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"grade_revisions_item_count_check","table":"grade_revisions","definition":"CHECK (item_count >= 0)"},{"kind":"c","name":"grade_revisions_manifest_sha256_check","table":"grade_revisions","definition":"CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"grade_revisions_pkey","table":"grade_revisions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"grade_revisions_revision_number_check","table":"grade_revisions","definition":"CHECK (revision_number > 0)"},{"kind":"c","name":"grade_revisions_rubric_snapshot_check","table":"grade_revisions","definition":"CHECK (jsonb_typeof(rubric_snapshot) = 'object'::text)"},{"kind":"c","name":"grade_revisions_source_check","table":"grade_revisions","definition":"CHECK (source = ANY (ARRAY['online'::text, 'offline_import'::text, 'recovery'::text]))"},{"kind":"u","name":"grade_revisions_submission_client_key","table":"grade_revisions","definition":"UNIQUE (submission_id, client_revision_id)"},{"kind":"u","name":"grade_revisions_submission_revision_key","table":"grade_revisions","definition":"UNIQUE (submission_id, revision_number)"},{"kind":"f","name":"grade_revisions_submission_version_fk","table":"grade_revisions","definition":"FOREIGN KEY (submission_id, exam_version_id) REFERENCES examination_room_v1.submissions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"grade_revisions_total_score_check","table":"grade_revisions","definition":"CHECK (total_score >= 0::numeric)"},{"kind":"c","name":"institutions_bootstrap_request_hash_check","table":"institutions","definition":"CHECK (bootstrap_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"institutions_bootstrap_request_hash_key","table":"institutions","definition":"UNIQUE (bootstrap_request_hash)"},{"kind":"c","name":"institutions_institution_code_check","table":"institutions","definition":"CHECK (institution_code = lower(btrim(institution_code)) AND institution_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text)"},{"kind":"u","name":"institutions_institution_code_key","table":"institutions","definition":"UNIQUE (institution_code)"},{"kind":"c","name":"institutions_institution_name_check","table":"institutions","definition":"CHECK (length(btrim(institution_name)) >= 2 AND length(btrim(institution_name)) <= 240)"},{"kind":"c","name":"institutions_institution_status_check","table":"institutions","definition":"CHECK (institution_status = ANY (ARRAY['active'::text, 'suspended'::text]))"},{"kind":"p","name":"institutions_pkey","table":"institutions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"institutions_profile_school_id_check","table":"institutions","definition":"CHECK (profile_school_id = lower(btrim(profile_school_id)) AND profile_school_id ~ '^[a-z0-9][a-z0-9-]{1,179}$'::text)"},{"kind":"u","name":"institutions_profile_school_id_key","table":"institutions","definition":"UNIQUE (profile_school_id)"},{"kind":"f","name":"media_upload_intents_artifact_id_fkey","table":"media_upload_intents","definition":"FOREIGN KEY (artifact_id) REFERENCES examination_room_v1.proctoring_artifacts(id) ON DELETE RESTRICT"},{"kind":"c","name":"media_upload_intents_artifact_kind_check","table":"media_upload_intents","definition":"CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]))"},{"kind":"c","name":"media_upload_intents_capture_window_check","table":"media_upload_intents","definition":"CHECK (captured_to >= captured_from AND captured_to <= (captured_from + '00:15:00'::interval) AND retention_until > captured_to)"},{"kind":"c","name":"media_upload_intents_completion_request_hash_check","table":"media_upload_intents","definition":"CHECK (completion_request_hash IS NULL OR completion_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"media_upload_intents_encrypted_size_bytes_check","table":"media_upload_intents","definition":"CHECK (encrypted_size_bytes >= 1 AND encrypted_size_bytes <= 67108864)"},{"kind":"c","name":"media_upload_intents_intent_status_check","table":"media_upload_intents","definition":"CHECK (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text, 'completed'::text]))"},{"kind":"c","name":"media_upload_intents_object_sha256_check","table":"media_upload_intents","definition":"CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"media_upload_intents_pkey","table":"media_upload_intents","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"media_upload_intents_provider_check","table":"media_upload_intents","definition":"CHECK (provider = ANY (ARRAY['google_drive'::text, 'supabase_storage'::text, 'local_queue'::text]))"},{"kind":"c","name":"media_upload_intents_provider_object_reference_check","table":"media_upload_intents","definition":"CHECK (length(btrim(provider_object_reference)) >= 8 AND length(btrim(provider_object_reference)) <= 1024 AND provider_object_reference !~* '(token|secret|authorization|credential|password)='::text AND provider_object_reference !~* '^https?://'::text)"},{"kind":"c","name":"media_upload_intents_provider_result_check","table":"media_upload_intents","definition":"CHECK (jsonb_typeof(provider_result) = 'object'::text AND provider_result::text !~* '\"(url|token|secret|authorization|credential|password|accessToken|refreshToken|signedUrl)\"[[:space:]]*:'::text)"},{"kind":"c","name":"media_upload_intents_request_hash_check","table":"media_upload_intents","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"media_upload_intents_session_artifact_key","table":"media_upload_intents","definition":"UNIQUE (session_id, client_artifact_id)"},{"kind":"f","name":"media_upload_intents_session_id_fkey","table":"media_upload_intents","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"u","name":"media_upload_intents_session_request_key","table":"media_upload_intents","definition":"UNIQUE (session_id, request_hash)"},{"kind":"c","name":"media_upload_intents_source_mime_type_check","table":"media_upload_intents","definition":"CHECK (length(btrim(source_mime_type)) >= 3 AND length(btrim(source_mime_type)) <= 160)"},{"kind":"c","name":"media_upload_intents_status_check","table":"media_upload_intents","definition":"CHECK (intent_status = 'completed'::text AND artifact_id IS NOT NULL AND completion_request_hash IS NOT NULL AND completed_at IS NOT NULL OR intent_status <> 'completed'::text AND artifact_id IS NULL AND completed_at IS NULL)"},{"kind":"c","name":"media_upload_intents_wrapped_key_aad_sha256_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_aad_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_algorithm_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_algorithm = 'aes-256-gcm-v1'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_ciphertext_check","table":"media_upload_intents","definition":"CHECK (length(wrapped_key_ciphertext) >= 43 AND length(wrapped_key_ciphertext) <= 128 AND wrapped_key_ciphertext ~ '^[A-Za-z0-9_-]+$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_iv_check","table":"media_upload_intents","definition":"CHECK (length(wrapped_key_iv) >= 16 AND length(wrapped_key_iv) <= 32 AND wrapped_key_iv ~ '^[A-Za-z0-9_-]+$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_version_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_version = 1)"},{"kind":"c","name":"owner_identity_corrections_after_record_check","table":"owner_identity_corrections","definition":"CHECK (jsonb_typeof(after_record) = 'object'::text)"},{"kind":"c","name":"owner_identity_corrections_before_record_check","table":"owner_identity_corrections","definition":"CHECK (jsonb_typeof(before_record) = 'object'::text)"},{"kind":"f","name":"owner_identity_corrections_exam_scope_fk","table":"owner_identity_corrections","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"owner_identity_corrections_identity_scope_fk","table":"owner_identity_corrections","definition":"FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"owner_identity_corrections_institution_id_fkey","table":"owner_identity_corrections","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"owner_identity_corrections_pkey","table":"owner_identity_corrections","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"owner_identity_corrections_reason_check","table":"owner_identity_corrections","definition":"CHECK (length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 1000)"},{"kind":"c","name":"owner_identity_corrections_request_hash_check","table":"owner_identity_corrections","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"owner_identity_corrections_request_hash_key","table":"owner_identity_corrections","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"owner_key_envelopes_aad_sha256_check","table":"owner_key_envelopes","definition":"CHECK (aad_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"owner_key_envelopes_activation_id_fkey","table":"owner_key_envelopes","definition":"FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT"},{"kind":"c","name":"owner_key_envelopes_ciphertext_base64_check","table":"owner_key_envelopes","definition":"CHECK (length(ciphertext_base64) >= 24 AND length(ciphertext_base64) <= 4096)"},{"kind":"c","name":"owner_key_envelopes_envelope_algorithm_check","table":"owner_key_envelopes","definition":"CHECK (envelope_algorithm = 'aes-256-gcm-v1'::text)"},{"kind":"f","name":"owner_key_envelopes_exam_scope_fk","table":"owner_key_envelopes","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"owner_key_envelopes_iv_base64_check","table":"owner_key_envelopes","definition":"CHECK (length(iv_base64) >= 16 AND length(iv_base64) <= 64)"},{"kind":"c","name":"owner_key_envelopes_key_version_check","table":"owner_key_envelopes","definition":"CHECK (key_version > 0)"},{"kind":"p","name":"owner_key_envelopes_pkey","table":"owner_key_envelopes","definition":"PRIMARY KEY (activation_id)"},{"kind":"c","name":"privacy_acceptances_accepted_features_check","table":"privacy_acceptances","definition":"CHECK (jsonb_typeof(accepted_features) = 'object'::text)"},{"kind":"c","name":"privacy_acceptances_capture_method_check","table":"privacy_acceptances","definition":"CHECK (capture_method = ANY (ARRAY['checkbox'::text, 'signed_notice'::text, 'admin_recorded'::text]))"},{"kind":"c","name":"privacy_acceptances_decision_check","table":"privacy_acceptances","definition":"CHECK (decision = ANY (ARRAY['accepted'::text, 'withdrawn'::text]))"},{"kind":"c","name":"privacy_acceptances_evidence_sha256_check","table":"privacy_acceptances","definition":"CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"privacy_acceptances_id_subject_key","table":"privacy_acceptances","definition":"UNIQUE (id, roster_id, notice_version_id, session_id, exam_version_id)"},{"kind":"f","name":"privacy_acceptances_notice_version_id_fkey","table":"privacy_acceptances","definition":"FOREIGN KEY (notice_version_id) REFERENCES examination_room_v1.privacy_notice_versions(id) ON DELETE RESTRICT"},{"kind":"p","name":"privacy_acceptances_pkey","table":"privacy_acceptances","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"privacy_acceptances_prior_required_check","table":"privacy_acceptances","definition":"CHECK (decision = 'accepted'::text AND prior_acceptance_id IS NULL OR decision = 'withdrawn'::text AND prior_acceptance_id IS NOT NULL)"},{"kind":"f","name":"privacy_acceptances_prior_same_subject_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (prior_acceptance_id, roster_id, notice_version_id, session_id, exam_version_id) REFERENCES examination_room_v1.privacy_acceptances(id, roster_id, notice_version_id, session_id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"privacy_acceptances_roster_id_fkey","table":"privacy_acceptances","definition":"FOREIGN KEY (roster_id) REFERENCES examination_room_v1.exam_roster(id) ON DELETE RESTRICT"},{"kind":"u","name":"privacy_acceptances_session_event_key","table":"privacy_acceptances","definition":"UNIQUE (session_id, client_event_id)"},{"kind":"f","name":"privacy_acceptances_session_roster_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (session_id, roster_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, roster_id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"privacy_acceptances_version_notice_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (exam_version_id, notice_version_id) REFERENCES examination_room_v1.exam_versions(id, privacy_notice_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"privacy_notice_versions_body_sha256_check","table":"privacy_notice_versions","definition":"CHECK (body_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"privacy_notice_versions_id_institution_key","table":"privacy_notice_versions","definition":"UNIQUE (id, institution_id)"},{"kind":"u","name":"privacy_notice_versions_institution_code_version_key","table":"privacy_notice_versions","definition":"UNIQUE (institution_id, notice_code, version_number)"},{"kind":"f","name":"privacy_notice_versions_institution_id_fkey","table":"privacy_notice_versions","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"privacy_notice_versions_notice_body_check","table":"privacy_notice_versions","definition":"CHECK (length(btrim(notice_body)) > 0)"},{"kind":"c","name":"privacy_notice_versions_notice_code_check","table":"privacy_notice_versions","definition":"CHECK (notice_code = lower(btrim(notice_code)) AND notice_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text)"},{"kind":"p","name":"privacy_notice_versions_pkey","table":"privacy_notice_versions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"privacy_notice_versions_processing_purposes_check","table":"privacy_notice_versions","definition":"CHECK (jsonb_typeof(processing_purposes) = 'array'::text)"},{"kind":"c","name":"privacy_notice_versions_title_check","table":"privacy_notice_versions","definition":"CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 240)"},{"kind":"c","name":"privacy_notice_versions_version_number_check","table":"privacy_notice_versions","definition":"CHECK (version_number > 0)"},{"kind":"c","name":"proctoring_artifacts_artifact_kind_check","table":"proctoring_artifacts","definition":"CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]))"},{"kind":"c","name":"proctoring_artifacts_artifact_status_check","table":"proctoring_artifacts","definition":"CHECK (artifact_status = ANY (ARRAY['uploading'::text, 'available'::text, 'quarantined'::text, 'deleted'::text]))"},{"kind":"c","name":"proctoring_artifacts_capture_window_check","table":"proctoring_artifacts","definition":"CHECK (captured_to >= captured_from)"},{"kind":"c","name":"proctoring_artifacts_encrypted_object_reference_check","table":"proctoring_artifacts","definition":"CHECK (length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024)"},{"kind":"c","name":"proctoring_artifacts_encryption_key_reference_check","table":"proctoring_artifacts","definition":"CHECK (length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512)"},{"kind":"f","name":"proctoring_artifacts_incident_session_fk","table":"proctoring_artifacts","definition":"FOREIGN KEY (incident_id, session_id) REFERENCES examination_room_v1.proctoring_incidents(id, session_id) ON DELETE RESTRICT"},{"kind":"u","name":"proctoring_artifacts_object_reference_key","table":"proctoring_artifacts","definition":"UNIQUE (encrypted_object_reference)"},{"kind":"c","name":"proctoring_artifacts_object_sha256_check","table":"proctoring_artifacts","definition":"CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"proctoring_artifacts_pkey","table":"proctoring_artifacts","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"proctoring_artifacts_retention_check","table":"proctoring_artifacts","definition":"CHECK (retention_until > captured_to)"},{"kind":"f","name":"proctoring_artifacts_session_id_fkey","table":"proctoring_artifacts","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"proctoring_incidents_details_check","table":"proctoring_incidents","definition":"CHECK (jsonb_typeof(details) = 'object'::text AND details::text !~* '\"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)\"[[:space:]]*:'::text)"},{"kind":"c","name":"proctoring_incidents_duration_ms_check","table":"proctoring_incidents","definition":"CHECK (duration_ms IS NULL OR duration_ms >= 0)"},{"kind":"u","name":"proctoring_incidents_id_session_key","table":"proctoring_incidents","definition":"UNIQUE (id, session_id)"},{"kind":"c","name":"proctoring_incidents_incident_kind_check","table":"proctoring_incidents","definition":"CHECK (incident_kind = ANY (ARRAY['focus_lost'::text, 'fullscreen_exit'::text, 'camera_interrupted'::text, 'microphone_interrupted'::text, 'network_disconnected'::text, 'device_changed'::text, 'clock_anomaly'::text, 'other'::text]))"},{"kind":"p","name":"proctoring_incidents_pkey","table":"proctoring_incidents","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"proctoring_incidents_review_check","table":"proctoring_incidents","definition":"CHECK (review_status = 'unreviewed'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL OR review_status <> 'unreviewed'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)"},{"kind":"c","name":"proctoring_incidents_review_status_check","table":"proctoring_incidents","definition":"CHECK (review_status = ANY (ARRAY['unreviewed'::text, 'benign'::text, 'escalated'::text, 'dismissed'::text]))"},{"kind":"u","name":"proctoring_incidents_session_event_key","table":"proctoring_incidents","definition":"UNIQUE (session_id, client_event_id)"},{"kind":"f","name":"proctoring_incidents_session_id_fkey","table":"proctoring_incidents","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"proctoring_incidents_severity_check","table":"proctoring_incidents","definition":"CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))"},{"kind":"c","name":"proctoring_incidents_source_check","table":"proctoring_incidents","definition":"CHECK (source = ANY (ARRAY['browser_signal'::text, 'proctor_report'::text, 'system_rule'::text, 'student_report'::text]))"},{"kind":"f","name":"professor_access_requests_approved_membership_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (approved_membership_id) REFERENCES examination_room_v1.staff_memberships(id) ON DELETE RESTRICT"},{"kind":"f","name":"professor_access_requests_assigned_institution_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (assigned_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"professor_access_requests_claimed_school_id_check","table":"professor_access_requests","definition":"CHECK (claimed_school_id = lower(btrim(claimed_school_id)) AND length(claimed_school_id) >= 1 AND length(claimed_school_id) <= 180)"},{"kind":"c","name":"professor_access_requests_claimed_school_name_check","table":"professor_access_requests","definition":"CHECK (length(btrim(claimed_school_name)) >= 2 AND length(btrim(claimed_school_name)) <= 240)"},{"kind":"c","name":"professor_access_requests_display_name_check","table":"professor_access_requests","definition":"CHECK (length(btrim(display_name)) >= 2 AND length(btrim(display_name)) <= 240)"},{"kind":"c","name":"professor_access_requests_email_normalized_check","table":"professor_access_requests","definition":"CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"p","name":"professor_access_requests_pkey","table":"professor_access_requests","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"professor_access_requests_request_status_check","table":"professor_access_requests","definition":"CHECK (request_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))"},{"kind":"f","name":"professor_access_requests_requested_institution_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (requested_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"professor_access_requests_review_check","table":"professor_access_requests","definition":"CHECK (request_status = 'pending'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'rejected'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NULL OR request_status = 'cancelled'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'approved'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NOT NULL)"},{"kind":"c","name":"professor_access_requests_review_reason_check","table":"professor_access_requests","definition":"CHECK (review_reason IS NULL OR length(btrim(review_reason)) >= 5 AND length(btrim(review_reason)) <= 1000)"},{"kind":"c","name":"questions_configuration_check","table":"questions","definition":"CHECK (jsonb_typeof(configuration) = 'object'::text)"},{"kind":"c","name":"questions_content_sha256_check","table":"questions","definition":"CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"questions_exam_version_id_fkey","table":"questions","definition":"FOREIGN KEY (exam_version_id) REFERENCES examination_room_v1.exam_versions(id) ON DELETE RESTRICT"},{"kind":"u","name":"questions_id_version_key","table":"questions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"p","name":"questions_pkey","table":"questions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"questions_points_check","table":"questions","definition":"CHECK (points >= 0::numeric)"},{"kind":"c","name":"questions_position_check","table":"questions","definition":"CHECK (\"position\" > 0)"},{"kind":"c","name":"questions_prompt_check","table":"questions","definition":"CHECK (length(btrim(prompt)) > 0)"},{"kind":"c","name":"questions_question_key_check","table":"questions","definition":"CHECK (question_key ~ '^q[0-9]{3}$'::text)"},{"kind":"c","name":"questions_question_kind_check","table":"questions","definition":"CHECK (question_kind = ANY (ARRAY['essay'::text, 'short_answer'::text, 'multiple_choice'::text, 'true_false'::text, 'file_upload'::text]))"},{"kind":"u","name":"questions_version_key_key","table":"questions","definition":"UNIQUE (exam_version_id, question_key)"},{"kind":"u","name":"questions_version_position_key","table":"questions","definition":"UNIQUE (exam_version_id, \"position\")"},{"kind":"c","name":"recovery_snapshots_encrypted_object_reference_check","table":"recovery_snapshots","definition":"CHECK (encrypted_object_reference IS NULL OR length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024)"},{"kind":"c","name":"recovery_snapshots_encryption_key_reference_check","table":"recovery_snapshots","definition":"CHECK (encryption_key_reference IS NULL OR length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512)"},{"kind":"u","name":"recovery_snapshots_exam_sequence_key","table":"recovery_snapshots","definition":"UNIQUE (exam_id, snapshot_sequence)"},{"kind":"c","name":"recovery_snapshots_last_error_code_check","table":"recovery_snapshots","definition":"CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{2,100}$'::text)"},{"kind":"c","name":"recovery_snapshots_lease_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status = 'materializing'::text AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL OR snapshot_status <> 'materializing'::text AND lease_id IS NULL AND lease_expires_at IS NULL)"},{"kind":"c","name":"recovery_snapshots_materialization_attempts_check","table":"recovery_snapshots","definition":"CHECK (materialization_attempts >= 0)"},{"kind":"c","name":"recovery_snapshots_materialization_check","table":"recovery_snapshots","definition":"CHECK ((snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'failed'::text])) AND encrypted_object_reference IS NULL AND snapshot_sha256 IS NULL AND encryption_key_reference IS NULL AND available_at IS NULL OR (snapshot_status = ANY (ARRAY['available'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text])) AND encrypted_object_reference IS NOT NULL AND snapshot_sha256 IS NOT NULL AND encryption_key_reference IS NOT NULL AND available_at IS NOT NULL)"},{"kind":"u","name":"recovery_snapshots_object_reference_key","table":"recovery_snapshots","definition":"UNIQUE (encrypted_object_reference)"},{"kind":"p","name":"recovery_snapshots_pkey","table":"recovery_snapshots","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"recovery_snapshots_record_count_check","table":"recovery_snapshots","definition":"CHECK (record_count >= 0)"},{"kind":"c","name":"recovery_snapshots_request_hash_check","table":"recovery_snapshots","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"recovery_snapshots_request_hash_key","table":"recovery_snapshots","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"recovery_snapshots_restore_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status <> 'restored'::text AND restored_at IS NULL AND restored_by_user_id IS NULL OR snapshot_status = 'restored'::text AND restored_at IS NOT NULL AND restored_by_user_id IS NOT NULL)"},{"kind":"c","name":"recovery_snapshots_restore_verification_sha256_check","table":"recovery_snapshots","definition":"CHECK (restore_verification_sha256 IS NULL OR restore_verification_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"recovery_snapshots_restored_record_count_check","table":"recovery_snapshots","definition":"CHECK (restored_record_count >= 0)"},{"kind":"c","name":"recovery_snapshots_retention_check","table":"recovery_snapshots","definition":"CHECK (retention_until > created_at)"},{"kind":"c","name":"recovery_snapshots_snapshot_scope_check","table":"recovery_snapshots","definition":"CHECK (snapshot_scope = ANY (ARRAY['exam_definition'::text, 'answer_state'::text, 'grading_state'::text, 'full_recovery'::text]))"},{"kind":"c","name":"recovery_snapshots_snapshot_sequence_check","table":"recovery_snapshots","definition":"CHECK (snapshot_sequence > 0)"},{"kind":"c","name":"recovery_snapshots_snapshot_sha256_check","table":"recovery_snapshots","definition":"CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"recovery_snapshots_snapshot_status_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'available'::text, 'failed'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text]))"},{"kind":"f","name":"recovery_snapshots_source_grade_revision_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_grade_revision_id) REFERENCES examination_room_v1.grade_revisions(id) ON DELETE RESTRICT"},{"kind":"c","name":"recovery_snapshots_source_kind_check","table":"recovery_snapshots","definition":"CHECK (source_kind IS NULL OR (source_kind = ANY (ARRAY['publication'::text, 'submission'::text, 'grade_revision'::text, 'result_release'::text, 'manual'::text])))"},{"kind":"f","name":"recovery_snapshots_source_result_release_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_result_release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_source_session_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_source_submission_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_version_exam_fk","table":"recovery_snapshots","definition":"FOREIGN KEY (exam_version_id, exam_id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT"},{"kind":"u","name":"result_email_delivery_batch_release_unique","table":"result_email_delivery_events","definition":"UNIQUE (batch_request_hash, release_id)"},{"kind":"c","name":"result_email_delivery_claim_shape","table":"result_email_delivery_events","definition":"CHECK (delivery_status = 'pending'::text AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL OR delivery_status <> 'pending'::text AND claim_token IS NULL AND lease_expires_at IS NULL)"},{"kind":"c","name":"result_email_delivery_events_attempt_count_check","table":"result_email_delivery_events","definition":"CHECK (attempt_count >= 0)"},{"kind":"c","name":"result_email_delivery_events_batch_request_hash_check","table":"result_email_delivery_events","definition":"CHECK (batch_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_email_delivery_events_check","table":"result_email_delivery_events","definition":"CHECK (maximum_score >= total_score)"},{"kind":"c","name":"result_email_delivery_events_delivery_status_check","table":"result_email_delivery_events","definition":"CHECK (delivery_status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text, 'skipped'::text]))"},{"kind":"c","name":"result_email_delivery_events_exam_title_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(exam_title)) >= 1 AND length(btrim(exam_title)) <= 300)"},{"kind":"f","name":"result_email_delivery_events_institution_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"result_email_delivery_events_pkey","table":"result_email_delivery_events","definition":"PRIMARY KEY (release_id)"},{"kind":"c","name":"result_email_delivery_events_provider_id_check","table":"result_email_delivery_events","definition":"CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240)"},{"kind":"c","name":"result_email_delivery_events_recipient_email_check","table":"result_email_delivery_events","definition":"CHECK (recipient_email IS NULL OR recipient_email = lower(btrim(recipient_email)) AND POSITION(('@'::text) IN (recipient_email)) > 1 AND length(recipient_email) >= 3 AND length(recipient_email) <= 320)"},{"kind":"c","name":"result_email_delivery_events_recipient_name_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(recipient_name)) >= 1 AND length(btrim(recipient_name)) <= 240)"},{"kind":"f","name":"result_email_delivery_events_release_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT"},{"kind":"c","name":"result_email_delivery_events_safe_error_code_check","table":"result_email_delivery_events","definition":"CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text)"},{"kind":"f","name":"result_email_delivery_events_student_session_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (student_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"result_email_delivery_events_subject_name_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(subject_name)) >= 1 AND length(btrim(subject_name)) <= 200)"},{"kind":"c","name":"result_email_delivery_events_total_score_check","table":"result_email_delivery_events","definition":"CHECK (total_score >= 0::numeric)"},{"kind":"f","name":"result_email_delivery_exam_scope_fk","table":"result_email_delivery_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"result_releases_action_check","table":"result_releases","definition":"CHECK (release_action = 'release'::text AND grade_revision_id IS NOT NULL AND supersedes_release_id IS NULL AND manifest_sha256 IS NOT NULL AND release_manifest IS NOT NULL OR release_action = 'revoke'::text AND grade_revision_id IS NULL AND supersedes_release_id IS NOT NULL AND reason IS NOT NULL AND manifest_sha256 IS NULL AND release_manifest IS NULL)"},{"kind":"c","name":"result_releases_batch_request_hash_check","table":"result_releases","definition":"CHECK (batch_request_hash IS NULL OR batch_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_releases_channel_check","table":"result_releases","definition":"CHECK (channel = ANY (ARRAY['student_portal'::text, 'email_notice'::text, 'offline_export'::text]))"},{"kind":"c","name":"result_releases_delivery_reference_hash_check","table":"result_releases","definition":"CHECK (delivery_reference_hash IS NULL OR delivery_reference_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"result_releases_grade_same_submission_fk","table":"result_releases","definition":"FOREIGN KEY (grade_revision_id, submission_id) REFERENCES examination_room_v1.grade_revisions(id, submission_id) ON DELETE RESTRICT"},{"kind":"u","name":"result_releases_id_submission_key","table":"result_releases","definition":"UNIQUE (id, submission_id)"},{"kind":"u","name":"result_releases_idempotency_hash_key","table":"result_releases","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"c","name":"result_releases_idempotency_key_hash_check","table":"result_releases","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_releases_manifest_sha256_check","table":"result_releases","definition":"CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"result_releases_pkey","table":"result_releases","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"result_releases_release_action_check","table":"result_releases","definition":"CHECK (release_action = ANY (ARRAY['release'::text, 'revoke'::text]))"},{"kind":"c","name":"result_releases_release_manifest_check","table":"result_releases","definition":"CHECK (release_manifest IS NULL OR jsonb_typeof(release_manifest) = 'object'::text AND (release_manifest ->> 'schemaVersion'::text) = 'examination-room/result-release/v1'::text)"},{"kind":"f","name":"result_releases_submission_id_fkey","table":"result_releases","definition":"FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"f","name":"result_releases_supersedes_same_submission_fk","table":"result_releases","definition":"FOREIGN KEY (supersedes_release_id, submission_id) REFERENCES examination_room_v1.result_releases(id, submission_id) ON DELETE RESTRICT"},{"kind":"c","name":"room_activations_activation_status_check","table":"room_activations","definition":"CHECK (activation_status = ANY (ARRAY['scheduled'::text, 'open'::text, 'closed'::text, 'revoked'::text]))"},{"kind":"c","name":"room_activations_deactivation_check","table":"room_activations","definition":"CHECK (deactivated_at IS NULL AND deactivated_by_user_id IS NULL OR deactivated_at IS NOT NULL AND deactivated_by_user_id IS NOT NULL AND deactivated_at >= created_at)"},{"kind":"u","name":"room_activations_id_exam_version_key","table":"room_activations","definition":"UNIQUE (id, exam_id, exam_version_id, institution_id)"},{"kind":"c","name":"room_activations_key_hash_algorithm_check","table":"room_activations","definition":"CHECK (key_hash_algorithm = ANY (ARRAY['hmac-sha256-v1'::text, 'argon2id-v1'::text]))"},{"kind":"c","name":"room_activations_key_hash_format_check","table":"room_activations","definition":"CHECK (key_hash_algorithm = 'hmac-sha256-v1'::text AND key_hash ~ '^[0-9a-f]{64}$'::text OR key_hash_algorithm = 'argon2id-v1'::text AND key_hash ~~ '$argon2id$%'::text AND length(key_hash) >= 40 AND length(key_hash) <= 255)"},{"kind":"u","name":"room_activations_key_hash_key","table":"room_activations","definition":"UNIQUE (key_hash)"},{"kind":"c","name":"room_activations_max_sessions_check","table":"room_activations","definition":"CHECK (max_sessions IS NULL OR max_sessions > 0)"},{"kind":"p","name":"room_activations_pkey","table":"room_activations","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"room_activations_request_hash_check","table":"room_activations","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"room_activations_request_hash_key","table":"room_activations","definition":"UNIQUE (request_hash)"},{"kind":"f","name":"room_activations_version_exam_fk","table":"room_activations","definition":"FOREIGN KEY (exam_version_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_versions(id, exam_id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"room_activations_window_check","table":"room_activations","definition":"CHECK (closes_at > opens_at)"},{"kind":"c","name":"staff_memberships_display_name_check","table":"staff_memberships","definition":"CHECK (display_name IS NULL OR length(btrim(display_name)) >= 1 AND length(btrim(display_name)) <= 240)"},{"kind":"c","name":"staff_memberships_email_normalized_check","table":"staff_memberships","definition":"CHECK (email_normalized IS NULL OR email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"c","name":"staff_memberships_grant_reason_check","table":"staff_memberships","definition":"CHECK (length(btrim(grant_reason)) >= 5 AND length(btrim(grant_reason)) <= 1000)"},{"kind":"f","name":"staff_memberships_institution_id_fkey","table":"staff_memberships","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"staff_memberships_membership_status_check","table":"staff_memberships","definition":"CHECK (membership_status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text]))"},{"kind":"p","name":"staff_memberships_pkey","table":"staff_memberships","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"staff_memberships_revocation_check","table":"staff_memberships","definition":"CHECK (membership_status <> 'revoked'::text AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL OR membership_status = 'revoked'::text AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)"},{"kind":"c","name":"staff_memberships_staff_role_check","table":"staff_memberships","definition":"CHECK (staff_role = ANY (ARRAY['professor'::text, 'admin'::text]))"},{"kind":"c","name":"student_identities_email_normalized_check","table":"student_identities","definition":"CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"u","name":"student_identities_external_key","table":"student_identities","definition":"UNIQUE (institution_id, external_student_id)"},{"kind":"c","name":"student_identities_external_student_id_check","table":"student_identities","definition":"CHECK (length(btrim(external_student_id)) >= 1 AND length(btrim(external_student_id)) <= 128)"},{"kind":"c","name":"student_identities_full_name_check","table":"student_identities","definition":"CHECK (length(btrim(full_name)) >= 1 AND length(btrim(full_name)) <= 240)"},{"kind":"u","name":"student_identities_id_institution_key","table":"student_identities","definition":"UNIQUE (id, institution_id)"},{"kind":"c","name":"student_identities_identity_status_check","table":"student_identities","definition":"CHECK (identity_status = ANY (ARRAY['active'::text, 'inactive'::text, 'merged'::text]))"},{"kind":"f","name":"student_identities_institution_id_fkey","table":"student_identities","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"student_identities_pkey","table":"student_identities","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"student_identities_verification_method_check","table":"student_identities","definition":"CHECK (verification_method IS NULL OR (verification_method = ANY (ARRAY['institution_sso'::text, 'registrar_import'::text, 'admin_review'::text])))"},{"kind":"f","name":"student_sessions_activation_fk","table":"student_sessions","definition":"FOREIGN KEY (activation_id, exam_id, exam_version_id, institution_id) REFERENCES examination_room_v1.room_activations(id, exam_id, exam_version_id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"student_sessions_activation_roster_key","table":"student_sessions","definition":"UNIQUE (activation_id, roster_id)"},{"kind":"c","name":"student_sessions_consent_request_hash_check","table":"student_sessions","definition":"CHECK (consent_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"student_sessions_consent_request_hash_key","table":"student_sessions","definition":"UNIQUE (consent_request_hash)"},{"kind":"u","name":"student_sessions_id_institution_exam_key","table":"student_sessions","definition":"UNIQUE (id, institution_id, exam_id)"},{"kind":"u","name":"student_sessions_id_roster_key","table":"student_sessions","definition":"UNIQUE (id, roster_id)"},{"kind":"u","name":"student_sessions_id_roster_version_key","table":"student_sessions","definition":"UNIQUE (id, roster_id, exam_version_id)"},{"kind":"u","name":"student_sessions_id_version_key","table":"student_sessions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"student_sessions_identity_verification_method_check","table":"student_sessions","definition":"CHECK (identity_verification_method IS NULL OR (identity_verification_method = ANY (ARRAY['signed_in_account'::text, 'room_key_roster_match'::text, 'admin_override'::text])))"},{"kind":"p","name":"student_sessions_pkey","table":"student_sessions","definition":"PRIMARY KEY (id)"},{"kind":"f","name":"student_sessions_roster_fk","table":"student_sessions","definition":"FOREIGN KEY (roster_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_roster(id, exam_id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"student_sessions_session_metadata_check","table":"student_sessions","definition":"CHECK (jsonb_typeof(session_metadata) = 'object'::text)"},{"kind":"c","name":"student_sessions_session_status_check","table":"student_sessions","definition":"CHECK (session_status = ANY (ARRAY['created'::text, 'active'::text, 'submitted'::text, 'expired'::text, 'revoked'::text]))"},{"kind":"c","name":"student_sessions_session_token_hash_check","table":"student_sessions","definition":"CHECK (session_token_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"student_sessions_timestamps_check","table":"student_sessions","definition":"CHECK (lease_expires_at > started_at AND (last_heartbeat_at IS NULL OR last_heartbeat_at >= started_at) AND (ended_at IS NULL OR ended_at >= started_at))"},{"kind":"u","name":"student_sessions_token_hash_key","table":"student_sessions","definition":"UNIQUE (session_token_hash)"},{"kind":"p","name":"submission_answers_pkey","table":"submission_answers","definition":"PRIMARY KEY (submission_id, question_id)"},{"kind":"u","name":"submission_answers_revision_key","table":"submission_answers","definition":"UNIQUE (answer_revision_id)"},{"kind":"f","name":"submission_answers_revision_session_question_fk","table":"submission_answers","definition":"FOREIGN KEY (answer_revision_id, session_id, question_id) REFERENCES examination_room_v1.answer_revisions(id, session_id, question_id) ON DELETE RESTRICT"},{"kind":"f","name":"submission_answers_submission_session_fk","table":"submission_answers","definition":"FOREIGN KEY (submission_id, session_id) REFERENCES examination_room_v1.submissions(id, session_id) ON DELETE RESTRICT"},{"kind":"p","name":"submission_receipts_pkey","table":"submission_receipts","definition":"PRIMARY KEY (id)"},{"kind":"u","name":"submission_receipts_receipt_code_key","table":"submission_receipts","definition":"UNIQUE (receipt_code)"},{"kind":"c","name":"submission_receipts_receipt_payload_check","table":"submission_receipts","definition":"CHECK (jsonb_typeof(receipt_payload) = 'object'::text)"},{"kind":"c","name":"submission_receipts_receipt_sha256_check","table":"submission_receipts","definition":"CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"submission_receipts_submission_id_fkey","table":"submission_receipts","definition":"FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"u","name":"submission_receipts_submission_id_key","table":"submission_receipts","definition":"UNIQUE (submission_id)"},{"kind":"c","name":"submissions_answer_count_check","table":"submissions","definition":"CHECK (answer_count >= 0)"},{"kind":"c","name":"submissions_clock_skew_check","table":"submissions","definition":"CHECK (submitted_at_client <= (received_at + '24:00:00'::interval))"},{"kind":"u","name":"submissions_id_session_key","table":"submissions","definition":"UNIQUE (id, session_id)"},{"kind":"u","name":"submissions_id_version_key","table":"submissions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"submissions_idempotency_key_hash_check","table":"submissions","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"submissions_idempotency_key_hash_key","table":"submissions","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"c","name":"submissions_manifest_sha256_check","table":"submissions","definition":"CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"submissions_pkey","table":"submissions","definition":"PRIMARY KEY (id)"},{"kind":"u","name":"submissions_session_key","table":"submissions","definition":"UNIQUE (session_id)"},{"kind":"f","name":"submissions_session_version_fk","table":"submissions","definition":"FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"submissions_status_reason_check","table":"submissions","definition":"CHECK (submission_status = 'accepted'::text AND status_reason IS NULL OR submission_status <> 'accepted'::text AND status_reason IS NOT NULL)"},{"kind":"c","name":"submissions_submission_manifest_check","table":"submissions","definition":"CHECK (jsonb_typeof(submission_manifest) = 'object'::text AND (submission_manifest ->> 'schemaVersion'::text) = 'examination-room/submission/v1'::text)"},{"kind":"c","name":"submissions_submission_status_check","table":"submissions","definition":"CHECK (submission_status = ANY (ARRAY['accepted'::text, 'under_review'::text, 'voided'::text]))"}],"indexes":[{"name":"answer_revisions_id_session_question_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_id_session_question_key ON examination_room_v1.answer_revisions USING btree (id, session_id, question_id)"},{"name":"answer_revisions_idempotency_key_hash_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_idempotency_key_hash_key ON examination_room_v1.answer_revisions USING btree (idempotency_key_hash)"},{"name":"answer_revisions_latest_idx","table":"answer_revisions","definition":"CREATE INDEX answer_revisions_latest_idx ON examination_room_v1.answer_revisions USING btree (session_id, question_id, revision_number DESC)"},{"name":"answer_revisions_pkey","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_pkey ON examination_room_v1.answer_revisions USING btree (id)"},{"name":"answer_revisions_session_client_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_session_client_key ON examination_room_v1.answer_revisions USING btree (session_id, client_revision_id)"},{"name":"answer_revisions_session_question_number_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_session_question_number_key ON examination_room_v1.answer_revisions USING btree (session_id, question_id, revision_number)"},{"name":"audit_events_exam_idx","table":"audit_events","definition":"CREATE INDEX audit_events_exam_idx ON examination_room_v1.audit_events USING btree (exam_id, occurred_at DESC) WHERE (exam_id IS NOT NULL)"},{"name":"audit_events_institution_hash_key","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_institution_hash_key ON examination_room_v1.audit_events USING btree (institution_id, event_hash)"},{"name":"audit_events_institution_idx","table":"audit_events","definition":"CREATE INDEX audit_events_institution_idx ON examination_room_v1.audit_events USING btree (institution_id, recorded_at DESC)"},{"name":"audit_events_institution_request_key","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_institution_request_key ON examination_room_v1.audit_events USING btree (institution_id, request_hash)"},{"name":"audit_events_pkey","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_pkey ON examination_room_v1.audit_events USING btree (id)"},{"name":"audit_events_session_idx","table":"audit_events","definition":"CREATE INDEX audit_events_session_idx ON examination_room_v1.audit_events USING btree (session_id, occurred_at DESC) WHERE (session_id IS NOT NULL)"},{"name":"email_delivery_events_exam_time_idx","table":"email_delivery_events","definition":"CREATE INDEX email_delivery_events_exam_time_idx ON examination_room_v1.email_delivery_events USING btree (exam_id, attempted_at DESC)"},{"name":"email_delivery_events_pkey","table":"email_delivery_events","definition":"CREATE UNIQUE INDEX email_delivery_events_pkey ON examination_room_v1.email_delivery_events USING btree (id)"},{"name":"email_delivery_events_request_hash_key","table":"email_delivery_events","definition":"CREATE UNIQUE INDEX email_delivery_events_request_hash_key ON examination_room_v1.email_delivery_events USING btree (request_hash)"},{"name":"exam_roster_exam_student_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_exam_student_key ON examination_room_v1.exam_roster USING btree (exam_id, student_identity_id)"},{"name":"exam_roster_grading_alias_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_grading_alias_key ON examination_room_v1.exam_roster USING btree (exam_id, grading_alias) WHERE (grading_alias IS NOT NULL)"},{"name":"exam_roster_id_exam_institution_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_id_exam_institution_key ON examination_room_v1.exam_roster USING btree (id, exam_id, institution_id)"},{"name":"exam_roster_id_exam_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_id_exam_key ON examination_room_v1.exam_roster USING btree (id, exam_id)"},{"name":"exam_roster_pkey","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_pkey ON examination_room_v1.exam_roster USING btree (id)"},{"name":"exam_roster_status_idx","table":"exam_roster","definition":"CREATE INDEX exam_roster_status_idx ON examination_room_v1.exam_roster USING btree (exam_id, roster_status)"},{"name":"exam_versions_exam_version_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_exam_version_key ON examination_room_v1.exam_versions USING btree (exam_id, version_number)"},{"name":"exam_versions_id_exam_institution_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_exam_institution_key ON examination_room_v1.exam_versions USING btree (id, exam_id, institution_id)"},{"name":"exam_versions_id_exam_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_exam_key ON examination_room_v1.exam_versions USING btree (id, exam_id)"},{"name":"exam_versions_id_notice_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_notice_key ON examination_room_v1.exam_versions USING btree (id, privacy_notice_version_id)"},{"name":"exam_versions_pkey","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_pkey ON examination_room_v1.exam_versions USING btree (id)"},{"name":"exam_versions_published_idx","table":"exam_versions","definition":"CREATE INDEX exam_versions_published_idx ON examination_room_v1.exam_versions USING btree (exam_id, published_at DESC)"},{"name":"exams_admin_lifecycle_idx","table":"exams","definition":"CREATE INDEX exams_admin_lifecycle_idx ON examination_room_v1.exams USING btree (institution_id, deleted_at, blocked_at, updated_at DESC)"},{"name":"exams_id_institution_key","table":"exams","definition":"CREATE UNIQUE INDEX exams_id_institution_key ON examination_room_v1.exams USING btree (id, institution_id)"},{"name":"exams_owner_active_lifecycle_idx","table":"exams","definition":"CREATE INDEX exams_owner_active_lifecycle_idx ON examination_room_v1.exams USING btree (owner_user_id, updated_at DESC) WHERE (deleted_at IS NULL)"},{"name":"exams_owner_status_idx","table":"exams","definition":"CREATE INDEX exams_owner_status_idx ON examination_room_v1.exams USING btree (institution_id, owner_user_id, status)"},{"name":"exams_pkey","table":"exams","definition":"CREATE UNIQUE INDEX exams_pkey ON examination_room_v1.exams USING btree (id)"},{"name":"grade_revision_items_pkey","table":"grade_revision_items","definition":"CREATE UNIQUE INDEX grade_revision_items_pkey ON examination_room_v1.grade_revision_items USING btree (grade_revision_id, question_id)"},{"name":"grade_revisions_id_submission_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_id_submission_key ON examination_room_v1.grade_revisions USING btree (id, submission_id)"},{"name":"grade_revisions_id_version_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_id_version_key ON examination_room_v1.grade_revisions USING btree (id, exam_version_id)"},{"name":"grade_revisions_latest_idx","table":"grade_revisions","definition":"CREATE INDEX grade_revisions_latest_idx ON examination_room_v1.grade_revisions USING btree (submission_id, revision_number DESC)"},{"name":"grade_revisions_pkey","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_pkey ON examination_room_v1.grade_revisions USING btree (id)"},{"name":"grade_revisions_submission_client_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_submission_client_key ON examination_room_v1.grade_revisions USING btree (submission_id, client_revision_id)"},{"name":"grade_revisions_submission_revision_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_submission_revision_key ON examination_room_v1.grade_revisions USING btree (submission_id, revision_number)"},{"name":"institutions_bootstrap_request_hash_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_bootstrap_request_hash_key ON examination_room_v1.institutions USING btree (bootstrap_request_hash)"},{"name":"institutions_institution_code_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_institution_code_key ON examination_room_v1.institutions USING btree (institution_code)"},{"name":"institutions_pkey","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_pkey ON examination_room_v1.institutions USING btree (id)"},{"name":"institutions_profile_school_id_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_profile_school_id_key ON examination_room_v1.institutions USING btree (profile_school_id)"},{"name":"media_upload_intents_pending_idx","table":"media_upload_intents","definition":"CREATE INDEX media_upload_intents_pending_idx ON examination_room_v1.media_upload_intents USING btree (intent_status, updated_at) WHERE (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text]))"},{"name":"media_upload_intents_pkey","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_pkey ON examination_room_v1.media_upload_intents USING btree (id)"},{"name":"media_upload_intents_session_artifact_key","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_session_artifact_key ON examination_room_v1.media_upload_intents USING btree (session_id, client_artifact_id)"},{"name":"media_upload_intents_session_request_key","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_session_request_key ON examination_room_v1.media_upload_intents USING btree (session_id, request_hash)"},{"name":"media_upload_intents_session_status_idx","table":"media_upload_intents","definition":"CREATE INDEX media_upload_intents_session_status_idx ON examination_room_v1.media_upload_intents USING btree (session_id, intent_status, prepared_at DESC)"},{"name":"owner_identity_corrections_pkey","table":"owner_identity_corrections","definition":"CREATE UNIQUE INDEX owner_identity_corrections_pkey ON examination_room_v1.owner_identity_corrections USING btree (id)"},{"name":"owner_identity_corrections_request_hash_key","table":"owner_identity_corrections","definition":"CREATE UNIQUE INDEX owner_identity_corrections_request_hash_key ON examination_room_v1.owner_identity_corrections USING btree (request_hash)"},{"name":"owner_key_envelopes_pkey","table":"owner_key_envelopes","definition":"CREATE UNIQUE INDEX owner_key_envelopes_pkey ON examination_room_v1.owner_key_envelopes USING btree (activation_id)"},{"name":"privacy_acceptances_id_subject_key","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_id_subject_key ON examination_room_v1.privacy_acceptances USING btree (id, roster_id, notice_version_id, session_id, exam_version_id)"},{"name":"privacy_acceptances_one_withdrawal_idx","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_one_withdrawal_idx ON examination_room_v1.privacy_acceptances USING btree (prior_acceptance_id) WHERE (decision = 'withdrawn'::text)"},{"name":"privacy_acceptances_pkey","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_pkey ON examination_room_v1.privacy_acceptances USING btree (id)"},{"name":"privacy_acceptances_roster_notice_idx","table":"privacy_acceptances","definition":"CREATE INDEX privacy_acceptances_roster_notice_idx ON examination_room_v1.privacy_acceptances USING btree (roster_id, notice_version_id, recorded_at DESC)"},{"name":"privacy_acceptances_session_event_key","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_session_event_key ON examination_room_v1.privacy_acceptances USING btree (session_id, client_event_id)"},{"name":"privacy_notice_versions_id_institution_key","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_id_institution_key ON examination_room_v1.privacy_notice_versions USING btree (id, institution_id)"},{"name":"privacy_notice_versions_institution_code_version_key","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_institution_code_version_key ON examination_room_v1.privacy_notice_versions USING btree (institution_id, notice_code, version_number)"},{"name":"privacy_notice_versions_pkey","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_pkey ON examination_room_v1.privacy_notice_versions USING btree (id)"},{"name":"proctoring_artifacts_object_reference_key","table":"proctoring_artifacts","definition":"CREATE UNIQUE INDEX proctoring_artifacts_object_reference_key ON examination_room_v1.proctoring_artifacts USING btree (encrypted_object_reference)"},{"name":"proctoring_artifacts_pkey","table":"proctoring_artifacts","definition":"CREATE UNIQUE INDEX proctoring_artifacts_pkey ON examination_room_v1.proctoring_artifacts USING btree (id)"},{"name":"proctoring_artifacts_session_idx","table":"proctoring_artifacts","definition":"CREATE INDEX proctoring_artifacts_session_idx ON examination_room_v1.proctoring_artifacts USING btree (session_id, artifact_kind, captured_from)"},{"name":"proctoring_incidents_id_session_key","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_id_session_key ON examination_room_v1.proctoring_incidents USING btree (id, session_id)"},{"name":"proctoring_incidents_pkey","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_pkey ON examination_room_v1.proctoring_incidents USING btree (id)"},{"name":"proctoring_incidents_review_idx","table":"proctoring_incidents","definition":"CREATE INDEX proctoring_incidents_review_idx ON examination_room_v1.proctoring_incidents USING btree (session_id, review_status, occurred_at DESC)"},{"name":"proctoring_incidents_session_event_key","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_session_event_key ON examination_room_v1.proctoring_incidents USING btree (session_id, client_event_id)"},{"name":"professor_access_requests_one_pending_per_user","table":"professor_access_requests","definition":"CREATE UNIQUE INDEX professor_access_requests_one_pending_per_user ON examination_room_v1.professor_access_requests USING btree (user_id) WHERE (request_status = 'pending'::text)"},{"name":"professor_access_requests_pkey","table":"professor_access_requests","definition":"CREATE UNIQUE INDEX professor_access_requests_pkey ON examination_room_v1.professor_access_requests USING btree (id)"},{"name":"professor_access_requests_school_queue","table":"professor_access_requests","definition":"CREATE INDEX professor_access_requests_school_queue ON examination_room_v1.professor_access_requests USING btree (requested_institution_id, request_status, requested_at)"},{"name":"questions_id_version_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_id_version_key ON examination_room_v1.questions USING btree (id, exam_version_id)"},{"name":"questions_pkey","table":"questions","definition":"CREATE UNIQUE INDEX questions_pkey ON examination_room_v1.questions USING btree (id)"},{"name":"questions_version_key_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_version_key_key ON examination_room_v1.questions USING btree (exam_version_id, question_key)"},{"name":"questions_version_position_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_version_position_key ON examination_room_v1.questions USING btree (exam_version_id, \"position\")"},{"name":"recovery_snapshots_exam_sequence_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_exam_sequence_key ON examination_room_v1.recovery_snapshots USING btree (exam_id, snapshot_sequence)"},{"name":"recovery_snapshots_object_reference_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_object_reference_key ON examination_room_v1.recovery_snapshots USING btree (encrypted_object_reference)"},{"name":"recovery_snapshots_pkey","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_pkey ON examination_room_v1.recovery_snapshots USING btree (id)"},{"name":"recovery_snapshots_request_hash_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_request_hash_key ON examination_room_v1.recovery_snapshots USING btree (request_hash)"},{"name":"recovery_snapshots_status_idx","table":"recovery_snapshots","definition":"CREATE INDEX recovery_snapshots_status_idx ON examination_room_v1.recovery_snapshots USING btree (exam_id, snapshot_status, created_at DESC)"},{"name":"result_email_delivery_batch_release_unique","table":"result_email_delivery_events","definition":"CREATE UNIQUE INDEX result_email_delivery_batch_release_unique ON examination_room_v1.result_email_delivery_events USING btree (batch_request_hash, release_id)"},{"name":"result_email_delivery_events_pkey","table":"result_email_delivery_events","definition":"CREATE UNIQUE INDEX result_email_delivery_events_pkey ON examination_room_v1.result_email_delivery_events USING btree (release_id)"},{"name":"result_email_delivery_exam_time_idx","table":"result_email_delivery_events","definition":"CREATE INDEX result_email_delivery_exam_time_idx ON examination_room_v1.result_email_delivery_events USING btree (exam_id, released_at DESC, release_id)"},{"name":"result_email_delivery_retry_idx","table":"result_email_delivery_events","definition":"CREATE INDEX result_email_delivery_retry_idx ON examination_room_v1.result_email_delivery_events USING btree (lease_expires_at, updated_at) WHERE (delivery_status = ANY (ARRAY['pending'::text, 'failed'::text, 'not_configured'::text, 'suppressed'::text]))"},{"name":"result_releases_batch_request_idx","table":"result_releases","definition":"CREATE INDEX result_releases_batch_request_idx ON examination_room_v1.result_releases USING btree (batch_request_hash, occurred_at, id) WHERE (batch_request_hash IS NOT NULL)"},{"name":"result_releases_id_submission_key","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_id_submission_key ON examination_room_v1.result_releases USING btree (id, submission_id)"},{"name":"result_releases_idempotency_hash_key","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_idempotency_hash_key ON examination_room_v1.result_releases USING btree (idempotency_key_hash)"},{"name":"result_releases_one_revocation_per_release_idx","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_one_revocation_per_release_idx ON examination_room_v1.result_releases USING btree (supersedes_release_id) WHERE (release_action = 'revoke'::text)"},{"name":"result_releases_pkey","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_pkey ON examination_room_v1.result_releases USING btree (id)"},{"name":"result_releases_submission_idx","table":"result_releases","definition":"CREATE INDEX result_releases_submission_idx ON examination_room_v1.result_releases USING btree (submission_id, occurred_at DESC)"},{"name":"room_activations_id_exam_version_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_id_exam_version_key ON examination_room_v1.room_activations USING btree (id, exam_id, exam_version_id, institution_id)"},{"name":"room_activations_key_hash_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_key_hash_key ON examination_room_v1.room_activations USING btree (key_hash)"},{"name":"room_activations_pkey","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_pkey ON examination_room_v1.room_activations USING btree (id)"},{"name":"room_activations_request_hash_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_request_hash_key ON examination_room_v1.room_activations USING btree (request_hash)"},{"name":"room_activations_window_idx","table":"room_activations","definition":"CREATE INDEX room_activations_window_idx ON examination_room_v1.room_activations USING btree (exam_id, activation_status, opens_at, closes_at)"},{"name":"staff_memberships_active_user_idx","table":"staff_memberships","definition":"CREATE INDEX staff_memberships_active_user_idx ON examination_room_v1.staff_memberships USING btree (user_id, institution_id, staff_role) WHERE (membership_status = 'active'::text)"},{"name":"staff_memberships_one_active_role_idx","table":"staff_memberships","definition":"CREATE UNIQUE INDEX staff_memberships_one_active_role_idx ON examination_room_v1.staff_memberships USING btree (institution_id, user_id, staff_role) WHERE (membership_status = 'active'::text)"},{"name":"staff_memberships_pkey","table":"staff_memberships","definition":"CREATE UNIQUE INDEX staff_memberships_pkey ON examination_room_v1.staff_memberships USING btree (id)"},{"name":"student_identities_email_idx","table":"student_identities","definition":"CREATE INDEX student_identities_email_idx ON examination_room_v1.student_identities USING btree (institution_id, email_normalized)"},{"name":"student_identities_external_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_external_key ON examination_room_v1.student_identities USING btree (institution_id, external_student_id)"},{"name":"student_identities_id_institution_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_id_institution_key ON examination_room_v1.student_identities USING btree (id, institution_id)"},{"name":"student_identities_institution_auth_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_institution_auth_key ON examination_room_v1.student_identities USING btree (institution_id, auth_user_id) WHERE (auth_user_id IS NOT NULL)"},{"name":"student_identities_pkey","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_pkey ON examination_room_v1.student_identities USING btree (id)"},{"name":"student_sessions_activation_roster_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_activation_roster_key ON examination_room_v1.student_sessions USING btree (activation_id, roster_id)"},{"name":"student_sessions_consent_request_hash_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_consent_request_hash_key ON examination_room_v1.student_sessions USING btree (consent_request_hash)"},{"name":"student_sessions_heartbeat_idx","table":"student_sessions","definition":"CREATE INDEX student_sessions_heartbeat_idx ON examination_room_v1.student_sessions USING btree (activation_id, session_status, last_heartbeat_at)"},{"name":"student_sessions_id_institution_exam_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_institution_exam_key ON examination_room_v1.student_sessions USING btree (id, institution_id, exam_id)"},{"name":"student_sessions_id_roster_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_roster_key ON examination_room_v1.student_sessions USING btree (id, roster_id)"},{"name":"student_sessions_id_roster_version_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_roster_version_key ON examination_room_v1.student_sessions USING btree (id, roster_id, exam_version_id)"},{"name":"student_sessions_id_version_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_version_key ON examination_room_v1.student_sessions USING btree (id, exam_version_id)"},{"name":"student_sessions_one_open_per_roster_idx","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_one_open_per_roster_idx ON examination_room_v1.student_sessions USING btree (activation_id, roster_id) WHERE (session_status = ANY (ARRAY['created'::text, 'active'::text]))"},{"name":"student_sessions_pkey","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_pkey ON examination_room_v1.student_sessions USING btree (id)"},{"name":"student_sessions_token_hash_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_token_hash_key ON examination_room_v1.student_sessions USING btree (session_token_hash)"},{"name":"submission_answers_pkey","table":"submission_answers","definition":"CREATE UNIQUE INDEX submission_answers_pkey ON examination_room_v1.submission_answers USING btree (submission_id, question_id)"},{"name":"submission_answers_revision_key","table":"submission_answers","definition":"CREATE UNIQUE INDEX submission_answers_revision_key ON examination_room_v1.submission_answers USING btree (answer_revision_id)"},{"name":"submission_receipts_pkey","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_pkey ON examination_room_v1.submission_receipts USING btree (id)"},{"name":"submission_receipts_receipt_code_key","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_receipt_code_key ON examination_room_v1.submission_receipts USING btree (receipt_code)"},{"name":"submission_receipts_submission_id_key","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_submission_id_key ON examination_room_v1.submission_receipts USING btree (submission_id)"},{"name":"submissions_id_session_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_id_session_key ON examination_room_v1.submissions USING btree (id, session_id)"},{"name":"submissions_id_version_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_id_version_key ON examination_room_v1.submissions USING btree (id, exam_version_id)"},{"name":"submissions_idempotency_key_hash_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_idempotency_key_hash_key ON examination_room_v1.submissions USING btree (idempotency_key_hash)"},{"name":"submissions_pkey","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_pkey ON examination_room_v1.submissions USING btree (id)"},{"name":"submissions_session_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_session_key ON examination_room_v1.submissions USING btree (session_id)"},{"name":"submissions_status_received_idx","table":"submissions","definition":"CREATE INDEX submissions_status_received_idx ON examination_room_v1.submissions USING btree (submission_status, received_at DESC)"}],"triggers":[{"name":"answer_revisions_immutable","table":"answer_revisions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER answer_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.answer_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"audit_events_immutable","table":"audit_events","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER audit_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.audit_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"email_delivery_events_immutable","table":"email_delivery_events","enabled":"O","function":"examination_room_v1.protect_email_delivery_event()","definition":"CREATE TRIGGER email_delivery_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.email_delivery_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_email_delivery_event()"},{"name":"exam_roster_binding_locked","table":"exam_roster","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER exam_roster_binding_locked BEFORE UPDATE OF id, exam_id, institution_id, student_identity_id, created_at ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"exam_roster_touch_updated_at","table":"exam_roster","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER exam_roster_touch_updated_at BEFORE UPDATE ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"exam_versions_immutable","table":"exam_versions","enabled":"O","function":"examination_room_v1.seal_exam_version()","definition":"CREATE TRIGGER exam_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.exam_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.seal_exam_version()"},{"name":"exams_current_version_must_be_published","table":"exams","enabled":"O","function":"examination_room_v1.ensure_exam_current_version_published()","definition":"CREATE TRIGGER exams_current_version_must_be_published BEFORE INSERT OR UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_exam_current_version_published()"},{"name":"exams_identity_locked","table":"exams","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER exams_identity_locked BEFORE UPDATE OF id, institution_id, created_at ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"exams_owner_must_be_authorized","table":"exams","enabled":"O","function":"examination_room_v1.validate_exam_owner()","definition":"CREATE TRIGGER exams_owner_must_be_authorized BEFORE INSERT OR UPDATE OF institution_id, owner_user_id ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_exam_owner()"},{"name":"exams_touch_updated_at","table":"exams","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER exams_touch_updated_at BEFORE UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"grade_revision_items_immutable","table":"grade_revision_items","enabled":"O","function":"examination_room_v1.protect_grade_revision_item_set()","definition":"CREATE TRIGGER grade_revision_items_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.grade_revision_items FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_grade_revision_item_set()"},{"name":"grade_revisions_immutable","table":"grade_revisions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER grade_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"grade_revisions_queue_recovery","table":"grade_revisions","enabled":"O","function":"examination_room_v1.queue_grading_snapshot()","definition":"CREATE TRIGGER grade_revisions_queue_recovery AFTER INSERT ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot()"},{"name":"institutions_immutable","table":"institutions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER institutions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.institutions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"media_upload_intents_no_delete","table":"media_upload_intents","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER media_upload_intents_no_delete BEFORE DELETE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"media_upload_intents_touch_updated_at","table":"media_upload_intents","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER media_upload_intents_touch_updated_at BEFORE UPDATE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"owner_identity_corrections_immutable","table":"owner_identity_corrections","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER owner_identity_corrections_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_identity_corrections FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"owner_key_envelopes_immutable","table":"owner_key_envelopes","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER owner_key_envelopes_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_key_envelopes FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_acceptances_immutable","table":"privacy_acceptances","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER privacy_acceptances_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_acceptances_validate","table":"privacy_acceptances","enabled":"O","function":"examination_room_v1.validate_privacy_acceptance()","definition":"CREATE TRIGGER privacy_acceptances_validate BEFORE INSERT ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_privacy_acceptance()"},{"name":"privacy_notice_versions_immutable","table":"privacy_notice_versions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER privacy_notice_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_notice_versions_minimal_warning","table":"privacy_notice_versions","enabled":"O","function":"examination_room_v1.normalize_default_student_warning()","definition":"CREATE TRIGGER privacy_notice_versions_minimal_warning BEFORE INSERT ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.normalize_default_student_warning()"},{"name":"proctoring_artifacts_evidence_locked","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER proctoring_artifacts_evidence_locked BEFORE UPDATE OF id, session_id, incident_id, artifact_kind, encrypted_object_reference, object_sha256, encryption_key_reference, captured_from, captured_to, retention_until, created_at ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"proctoring_artifacts_no_delete","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER proctoring_artifacts_no_delete BEFORE DELETE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"proctoring_artifacts_touch_updated_at","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER proctoring_artifacts_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"proctoring_incidents_evidence_locked","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER proctoring_incidents_evidence_locked BEFORE UPDATE OF id, session_id, client_event_id, incident_kind, source, severity, occurred_at, duration_ms, details, created_at ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"proctoring_incidents_no_delete","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER proctoring_incidents_no_delete BEFORE DELETE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"proctoring_incidents_touch_updated_at","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER proctoring_incidents_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"professor_access_requests_history_locked","table":"professor_access_requests","enabled":"O","function":"examination_room_v1.protect_professor_access_request_history()","definition":"CREATE TRIGGER professor_access_requests_history_locked BEFORE INSERT OR UPDATE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_professor_access_request_history()"},{"name":"professor_access_requests_no_delete","table":"professor_access_requests","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER professor_access_requests_no_delete BEFORE DELETE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"questions_immutable","table":"questions","enabled":"O","function":"examination_room_v1.protect_published_question()","definition":"CREATE TRIGGER questions_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.questions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_published_question()"},{"name":"recovery_snapshots_bind_source","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.set_snapshot_source()","definition":"CREATE TRIGGER recovery_snapshots_bind_source BEFORE INSERT ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.set_snapshot_source()"},{"name":"recovery_snapshots_evidence_locked","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.protect_recovery_snapshot()","definition":"CREATE TRIGGER recovery_snapshots_evidence_locked BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_recovery_snapshot()"},{"name":"recovery_snapshots_no_delete","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER recovery_snapshots_no_delete BEFORE DELETE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"recovery_snapshots_touch_updated_at","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER recovery_snapshots_touch_updated_at BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"result_releases_immutable","table":"result_releases","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER result_releases_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"result_releases_queue_recovery","table":"result_releases","enabled":"O","function":"examination_room_v1.queue_grading_snapshot()","definition":"CREATE TRIGGER result_releases_queue_recovery AFTER INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot()"},{"name":"result_releases_validate_grade","table":"result_releases","enabled":"O","function":"examination_room_v1.ensure_releasable_grade()","definition":"CREATE TRIGGER result_releases_validate_grade BEFORE INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_releasable_grade()"},{"name":"room_activations_no_delete","table":"room_activations","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER room_activations_no_delete BEFORE DELETE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"room_activations_validate","table":"room_activations","enabled":"O","function":"examination_room_v1.validate_room_activation()","definition":"CREATE TRIGGER room_activations_validate BEFORE INSERT OR UPDATE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_room_activation()"},{"name":"staff_memberships_history_locked","table":"staff_memberships","enabled":"O","function":"examination_room_v1.protect_staff_membership_history()","definition":"CREATE TRIGGER staff_memberships_history_locked BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_staff_membership_history()"},{"name":"staff_memberships_no_delete","table":"staff_memberships","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER staff_memberships_no_delete BEFORE DELETE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"staff_memberships_touch_updated_at","table":"staff_memberships","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER staff_memberships_touch_updated_at BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"student_identities_touch_updated_at","table":"student_identities","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER student_identities_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_identities FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"student_sessions_binding_locked","table":"student_sessions","enabled":"O","function":"examination_room_v1.protect_student_session_binding()","definition":"CREATE TRIGGER student_sessions_binding_locked BEFORE UPDATE OF id, activation_id, exam_id, institution_id, exam_version_id, roster_id, session_token_hash, consent_request_hash, client_instance_id, started_at, created_at ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_student_session_binding()"},{"name":"student_sessions_no_delete","table":"student_sessions","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER student_sessions_no_delete BEFORE DELETE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"student_sessions_touch_updated_at","table":"student_sessions","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER student_sessions_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"submission_answers_immutable","table":"submission_answers","enabled":"O","function":"examination_room_v1.protect_submission_answer_set()","definition":"CREATE TRIGGER submission_answers_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.submission_answers FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_submission_answer_set()"},{"name":"submission_receipts_immutable","table":"submission_receipts","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER submission_receipts_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"submission_receipts_validate","table":"submission_receipts","enabled":"O","function":"examination_room_v1.validate_submission_receipt()","definition":"CREATE TRIGGER submission_receipts_validate BEFORE INSERT ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_submission_receipt()"},{"name":"submissions_evidence_locked","table":"submissions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER submissions_evidence_locked BEFORE UPDATE OF id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256, submission_manifest, answer_count, submitted_at_client, received_at ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"submissions_no_delete","table":"submissions","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER submissions_no_delete BEFORE DELETE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"submissions_touch_updated_at","table":"submissions","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER submissions_touch_updated_at BEFORE UPDATE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"}],"policies":null}$expected_schema$::jsonb THEN RAISE EXCEPTION 'STAGING_SCHEMA_CHANGED'; END IF;
  SELECT state INTO before_rows FROM (SELECT jsonb_object_agg(table_name, state ORDER BY table_name COLLATE "C") FROM (
  SELECT 'answer_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."answer_revisions" t
  UNION ALL
  SELECT 'audit_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."audit_events" t
  UNION ALL
  SELECT 'email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."email_delivery_events" t
  UNION ALL
  SELECT 'exam_roster' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_roster" t
  UNION ALL
  SELECT 'exam_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_versions" t
  UNION ALL
  SELECT 'exams' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exams" t
  UNION ALL
  SELECT 'grade_revision_items' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revision_items" t
  UNION ALL
  SELECT 'grade_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revisions" t
  UNION ALL
  SELECT 'institutions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."institutions" t
  UNION ALL
  SELECT 'media_upload_intents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."media_upload_intents" t
  UNION ALL
  SELECT 'owner_identity_corrections' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_identity_corrections" t
  UNION ALL
  SELECT 'owner_key_envelopes' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_key_envelopes" t
  UNION ALL
  SELECT 'privacy_acceptances' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_acceptances" t
  UNION ALL
  SELECT 'privacy_notice_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_notice_versions" t
  UNION ALL
  SELECT 'proctoring_artifacts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_artifacts" t
  UNION ALL
  SELECT 'proctoring_incidents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_incidents" t
  UNION ALL
  SELECT 'professor_access_requests' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."professor_access_requests" t
  UNION ALL
  SELECT 'questions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."questions" t
  UNION ALL
  SELECT 'recovery_snapshots' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."recovery_snapshots" t
  UNION ALL
  SELECT 'result_email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_email_delivery_events" t
  UNION ALL
  SELECT 'result_releases' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_releases" t
  UNION ALL
  SELECT 'room_activations' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."room_activations" t
  UNION ALL
  SELECT 'staff_memberships' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."staff_memberships" t
  UNION ALL
  SELECT 'student_identities' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_identities" t
  UNION ALL
  SELECT 'student_sessions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_sessions" t
  UNION ALL
  SELECT 'submission_answers' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_answers" t
  UNION ALL
  SELECT 'submission_receipts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_receipts" t
  UNION ALL
  SELECT 'submissions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submissions" t
) all_tables) AS rows(state);
  IF before_rows IS DISTINCT FROM binding#>'{cutover,originalRowState}' THEN RAISE EXCEPTION 'STAGING_DATA_CHANGED_SINCE_CUTOVER_SNAPSHOT'; END IF;
  IF clock_timestamp() >= (binding#>>'{cutover,expiresAtUtc}')::timestamptz THEN RAISE EXCEPTION 'CUTOVER_WINDOW_EXPIRED_BEFORE_CHANGE'; END IF;
  IF (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7276e6df45b37831883ca9a28bc3b0731de3b4a312369d1104c81da1ecf513dd' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6657d93aede10f8a3b4e9d38d389d54dc6ef72f3bc1191d2dcb7f6c0856f9125' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_error(text,text,integer,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='92d7ff0cb2d931bbd072df5d349a616965ea7383625ad6d59fd39eca77b137e4' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63b3bc300c697d001bd2e0fdb51e673c598db03d0b654e2551fd098c42d50d0a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='75e15930ec34a9683791d53eaa380645bffe48c33ee9c5cd1ada618930c5e294' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a6025f0b8a979c2ef01c9d20849de06661a0f664c88e88e319c8de1762be5d78' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='95da22913df65a696f4bd8b003fb286b61df3c8cd1b01fe7144888a6c713c3ca' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c066ab9b3d82c6e34af8897d35f8b97e3ce9af656512c073aac7a9b980f50840' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_record_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,timestamp with time zone,jsonb,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='07190f7fcffa5d8b24ba4165d4c9ad7d09ce506e255712ef15f33f0f3986d4a1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='538afa7098e32587f056d5dc62a9acaa9aee027c0d3430a73acb236cf3d2b9bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_replay(uuid,text,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9f9ad9f65d49b2f89b1239ce8bb4fdce661805ebe3295ac9821ae9bb7c5cbf63' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f4fd12d2421e2dce70147e3c0886370ab8a581ac44068364effc9b72da1e305e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b2f4901d8f02d6bcae1814a117491da061e94c131432e87f82b150e442bda046' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='78c5e72a4ea24b569eea5153ff1e954162427e869fef50cd045ae2b37b909e19' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.build_publication_manifest(uuid,timestamp with time zone)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4a3647c6606454793e632d63db70eaef5fbe86700db343f9874fba5885430cc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7df2a2721f3fc16a452479e80ae22367ddf8fcc8b995b319c6e0ed97589c67fc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_authorized(uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a473426aa5bf9c2f559d2b509f47f9c082f8b3fed33845b7a0c1260426f4f5b0' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8aec9542309e1c01b3edc0ea7c7087b73aeeff740b7ee1dff68b3d59abbc9d4c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='feb9f9e6e2458b3efe6fb1b4e0d562a2793df99a203618ca0f7b21574bf59e39' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8f1e280682d1249ab23ad729ff4e8b30a85e9f1e683c4cad4fb7a31fe6b51bdc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_exam_current_version_published()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e505d487c7d1ccda4e782b2ffad6d1d19a1d127699632c076af304b55e18bc4c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ae68b6fb25772eca4ac8a3305a54dd785919c2723ab561b97e6a8dfa3a8b87a0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_releasable_grade()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d92c026833a7acbbe1cdaa44e9a0088fecafd35f47560fd37ec77ff6987fd21' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4317f150df2c8cc4eb03433a257996abe5c47d70852e5ce0d14e3248e3788768' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.grader_safe_submission_manifest(jsonb,boolean,text,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6de4e7c72329e22dc48a5093cbf3220eeb852e06efc22911a25fbfd5e39a4fb3' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='109b502d1dec6f856243dd1b4c8198f75938edade5f842ce6c8bda0cbea510d8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.json_rows(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='599e4c83c981a0d4e8c68acf89d3fcceb7af630b6d5c01a8e087e78765d01357' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='917518f0cefe5e2d13674efa53ae121fcb869304a7c28c7cbb7de6652d3f40f8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.jsonb_sha256(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f9bce66b9a8f68ce44485ad0b86468d446e2998162927dde38265939a3a15875' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='55d8de4f9ad53e6ead49dd9ffca9ffe0e997ba74226413a2e32d3682bcd1518f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.lock_request(uuid,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='465ef70b0cc6f0b854ddd204231b538b16bb9a8fbadd1126598af1250452ebc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0331f880070fc45f1cc378816cee90d46b53d87db2d793b2f3abe6fe5eaadd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.next_snapshot_sequence(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='bf75198d14a274d23d6a50068655085fad79caad79bd0f1a248c5b7c0d80baa7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='df2db1d17d7b8f8b45c74e89c6c0374807110419117e28a0b41eeabc15e0c46f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalize_default_student_warning()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9e2d022da93519b500aada19a4beb3bd692e13fa2c9c49985d02d16f3ff420e7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7fd42c9b5bb0973d808316fa72c35f1a363cbfd0f2498cd2e21f5f26082e2a08' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='34198a6304ef9c1f6f92fd4114a00e1d27208c26241fac8149e2a0a5c41c5275' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d98533d6b194a90694557a31238ab59ce33df632cf7cffb136cb8a9317695222' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_authorized(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4bb04bfa47a9fa50ec42f2ebb9c47d2af81a9474cc3355fbc5281d231209a474' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3574c6b327c5378c12f4d953c4862be199eddbe1e7b86b2b3669fac4a2d93205' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6b13cb369cdb1c3fb4c6369447dcc1225c5e70a06665aa99291487b99027710d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c19e0e2777efd12e3b3f8199f69d53d598796e16da53f2acb25afbb504a4cabb' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ca2e687d64c72872aad61523a4fbefe825cbbaad9acd69c9980e0daef12f940a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e2fda112c6566c56c3f524594b1660b72c1327318f58e937eb33dd8a1326fcd0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d9fe43b12f40a6d3debafbe4c21e1e270b12b8ac5b0fed8e0e4d717da60ef2a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fa24e3d243a8d71fd5f22e698b0354c78eb8cac75633c5b84a8bd42159641346' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_payload(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='399b06154a8fbaea7081f9116f8cd1d736f6e014aaef12819e9b8ed4e5a1f3df' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a500a81d55b0d81f5718b52c38f90aea86cd58a8fac4d58afb52a7671352bd39' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='263b9b20e8132ccaf946045a6512d813365dd42107296c5b0b2e20302a17a397' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7d60faf31d196c7387604eec0077b8d05055f5f5e959b5bf1fb77042041ba7a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_delete()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c697643b94d1eb985d076daf1f510834e8be39373aae23b659d9778e7e9f3dbf' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2babad1f225eb542c30e632b215bed9bdaf3fe2fb931d6f6c61011306f1489a2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_mutation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='184d4deaa5678a07c26415a01f0ebae0a8b5e160c67245d8be1959cb5e0c5f69' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af664f1ce37de88d7994bbb4e7e67db2eebfabd3e0f5dc73a4d7dc002791a692' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_email_delivery_event()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6c37b44db201da9c2740622b36fedc144e1d891e80e2c8bb1444f7f7cf53a72d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3ef1a89d75c15671527f4e0fa8bb38925364131becd594241024e16546bc3c51' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_grade_revision_item_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e0cd8fd5c9b2c5e0e3756040a60f74b07644c1f6d9cf26c8f7be5167df524b4d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b05845daaa070a8696fd2572605107762b6919ddf06da59e32626136e159487b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_professor_access_request_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6cc89d9726b20f9920a250d59640d6bde0834b78ef83a44b75e02a0c0b1b9d6d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='659f2beff2f8ba1f6773f650eb120cc515b8ccbc9b4ada30516537da883318d1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_published_question()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4773e7cfc9cad7b2e5fc853a70c6bddab5f9f00922f9119f6cf45073bf03a4ff' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='191a7975701371fa890ee878aa5816bba36b9e02cf797a3ec4864739149c08f2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_recovery_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1fde5878173075071ed8ccd74b1792d9c043c7bdf7055701ce8f7070c1f97739' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f2259c5dd84c19500d3b98dcf478a0ce1fa80686382d3e4350847618cfa0fe6d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_staff_membership_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a79aaa26edbe8c60d215554e8f7c7a26c4cedc3a6d953dcde8507dfa78c75da5' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e7263f3cbf7811cd6e13e2f5225dafb6baa00d6d126c7cf849742dcf67fa9b96' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_student_session_binding()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='802b52b6d076c21d36d830a92740fa683af36302809384a6ed0da06de574f40e' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7030894f8c4692b5adb5605d2f9068538ff4814a9d4a041f3bcde091d25f2fed' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_submission_answer_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='90466c13788a7d464d08d67d6a3a5b68210883140ab2e57a335f6750d790716c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c950ba3d5ce84b1590b6be154013ca5abe8c6b12dd9eeea54fbeeee028908f2e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.queue_grading_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e555ae1bbd482820fe834c4ff0806f6fdb52d2b296f593431b5f756168de4d74' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07758f4327ded35900e2ef3f8b932474d52163e28a546e6a8be450bc08ccc0a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c30d7b63e3cec523180fab0d22603d5c49161d430a4d00f88f319e4f181213b1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97b566674e6da2b08c522f738b88065650f71c41289730d95aca342a6fccb4ef' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.seal_exam_version()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='eb8234aad39b21203994085df20faf3c1744071e8bd05384620593bb51074415' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c9c148a6d6182da7e5f8b8cde3c66de4a4358efbd7332b1e1c9d689a7f77ec71' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.set_snapshot_source()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e861a27c7fe71fe2e37b185cab513947d06ea09138801009864a8d5418502f58' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5af1c9a737d4a8115e0ab67c3eee489cfe400ed0f7905ab941f34feedccf508e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.touch_updated_at()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='354fd59c57b17c349514d24ce4a8e4fa8d3d177fb99291c64992d24d617f0e3a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='92fa7c305a8b856faea0575b27eaa33c1e39952cf9fe87b4c0cbf7d7eab556bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.uuid_from_hash(text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d0d7dc854b466854f2c982e528e7e65a9de4ee33b4c7dea229a5ee737fcf64bb' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66a736cf40ccbfc250f8446fbdd7de911585bb37f4da459125b74a2ad2b6e2b1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e7be18f5b1812c66834c764b2c65b466b6ebc372b09a888b3b7dc79f76078566' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ba3b55cad702ac3f3fa66745c7815eec5f43444f758d9738284208d082cf6b6a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_exam_owner()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f86d20fc206e887476f2363856d60d7c84cff4950362c185be6b434a7f7ca058' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4c0f0147ebb06f4e457ed09c2f0cea9d1fdd2799d48d1b23037213804672ffc4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_privacy_acceptance()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='277bca90bee4d10f74b5475c143c36ab7c81fa5c0b6f708d5bfbcb1d7c38051c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea0070f61cc42e6de2d0eace5f2708617191d2f0c16086e8b4b73ee9f9439671' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_room_activation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8f96672da3ed19d205bd697b255bc8e29b74080a90c4278fa8ca67a91fbed880' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e46e006a39104dd3b5b8045fecd747243d9e366eed30046d5f13643be751762b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_submission_receipt()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8a7c5d74463a6c9fe4555b42c271d524ecbead0f59bc613feef222af9f5534a9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5aa6cbbae171e04b1a28bf94961759513c804d4fa60db267e03a30c85e7f33bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9fc7ecec84dcada0860b443b3190cbc4bc93c8b6f1642dcb2e077249357b06ad' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7e4a95085b4db167e38fbddc3c02b0edd61502c80c287c7c68fe2cf404f0d23e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5be56ab90978ae40cdd821a7577bbe3ce977f9d6766c95fac4f111c4fbc9677b' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2913cd1f0af99c9a7999ceb93666e3ebacaed79333d33fb3e4e6049eb75c260c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND to_regprocedure('examination_room_v1.apply_open_room_lease()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease')
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='examination_room_v1' OR (ns.nspname='public' AND p.proname IN ('examination_room_v1_api','examination_room_v1_lifecycle_guard')))=48) THEN
    IF clock_timestamp() >= (binding#>>'{cutover,expiresAtUtc}')::timestamptz THEN RAISE EXCEPTION 'CUTOVER_WINDOW_EXPIRED_BEFORE_ENVELOPE_RETURN'; END IF;
    RETURN;
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7276e6df45b37831883ca9a28bc3b0731de3b4a312369d1104c81da1ecf513dd' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6657d93aede10f8a3b4e9d38d389d54dc6ef72f3bc1191d2dcb7f6c0856f9125' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_error(text,text,integer,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='92d7ff0cb2d931bbd072df5d349a616965ea7383625ad6d59fd39eca77b137e4' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63b3bc300c697d001bd2e0fdb51e673c598db03d0b654e2551fd098c42d50d0a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5113e63f861843751dd22a8639604daf5b1b02a073df718aa91e24b7428c7493' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bee4776a358980d92785303cae1b1205010745c278b429ff1a15c2dbd3a330ce' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f68eb2a60edd19af46c61ad8fabc8b3bc4084b795622d874841ab38dad3e97ce' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='429f80a433e1bdfdec1fe7044f86bf82db0c1e1794e3abce68b7099cd183f5b4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_record_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,timestamp with time zone,jsonb,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='07190f7fcffa5d8b24ba4165d4c9ad7d09ce506e255712ef15f33f0f3986d4a1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='538afa7098e32587f056d5dc62a9acaa9aee027c0d3430a73acb236cf3d2b9bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_replay(uuid,text,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9f9ad9f65d49b2f89b1239ce8bb4fdce661805ebe3295ac9821ae9bb7c5cbf63' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f4fd12d2421e2dce70147e3c0886370ab8a581ac44068364effc9b72da1e305e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d9bb3bddf9c530971a3d437cc4123ab25939d9ec1800bac91b1bb6436ae27232' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='208cb22b1c0f242a2909c17ac52823834f095455c0cb7b17e3f396bd47584ef2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.build_publication_manifest(uuid,timestamp with time zone)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4a3647c6606454793e632d63db70eaef5fbe86700db343f9874fba5885430cc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7df2a2721f3fc16a452479e80ae22367ddf8fcc8b995b319c6e0ed97589c67fc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_authorized(uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a473426aa5bf9c2f559d2b509f47f9c082f8b3fed33845b7a0c1260426f4f5b0' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8aec9542309e1c01b3edc0ea7c7087b73aeeff740b7ee1dff68b3d59abbc9d4c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='feb9f9e6e2458b3efe6fb1b4e0d562a2793df99a203618ca0f7b21574bf59e39' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8f1e280682d1249ab23ad729ff4e8b30a85e9f1e683c4cad4fb7a31fe6b51bdc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_exam_current_version_published()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e505d487c7d1ccda4e782b2ffad6d1d19a1d127699632c076af304b55e18bc4c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ae68b6fb25772eca4ac8a3305a54dd785919c2723ab561b97e6a8dfa3a8b87a0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_releasable_grade()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d92c026833a7acbbe1cdaa44e9a0088fecafd35f47560fd37ec77ff6987fd21' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4317f150df2c8cc4eb03433a257996abe5c47d70852e5ce0d14e3248e3788768' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.grader_safe_submission_manifest(jsonb,boolean,text,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6de4e7c72329e22dc48a5093cbf3220eeb852e06efc22911a25fbfd5e39a4fb3' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='109b502d1dec6f856243dd1b4c8198f75938edade5f842ce6c8bda0cbea510d8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.json_rows(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='599e4c83c981a0d4e8c68acf89d3fcceb7af630b6d5c01a8e087e78765d01357' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='917518f0cefe5e2d13674efa53ae121fcb869304a7c28c7cbb7de6652d3f40f8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.jsonb_sha256(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f9bce66b9a8f68ce44485ad0b86468d446e2998162927dde38265939a3a15875' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='55d8de4f9ad53e6ead49dd9ffca9ffe0e997ba74226413a2e32d3682bcd1518f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.lock_request(uuid,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='465ef70b0cc6f0b854ddd204231b538b16bb9a8fbadd1126598af1250452ebc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0331f880070fc45f1cc378816cee90d46b53d87db2d793b2f3abe6fe5eaadd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.next_snapshot_sequence(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='bf75198d14a274d23d6a50068655085fad79caad79bd0f1a248c5b7c0d80baa7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='df2db1d17d7b8f8b45c74e89c6c0374807110419117e28a0b41eeabc15e0c46f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalize_default_student_warning()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9e2d022da93519b500aada19a4beb3bd692e13fa2c9c49985d02d16f3ff420e7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7fd42c9b5bb0973d808316fa72c35f1a363cbfd0f2498cd2e21f5f26082e2a08' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='34198a6304ef9c1f6f92fd4114a00e1d27208c26241fac8149e2a0a5c41c5275' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d98533d6b194a90694557a31238ab59ce33df632cf7cffb136cb8a9317695222' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_authorized(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4bb04bfa47a9fa50ec42f2ebb9c47d2af81a9474cc3355fbc5281d231209a474' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3574c6b327c5378c12f4d953c4862be199eddbe1e7b86b2b3669fac4a2d93205' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6b13cb369cdb1c3fb4c6369447dcc1225c5e70a06665aa99291487b99027710d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c19e0e2777efd12e3b3f8199f69d53d598796e16da53f2acb25afbb504a4cabb' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ca2e687d64c72872aad61523a4fbefe825cbbaad9acd69c9980e0daef12f940a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e2fda112c6566c56c3f524594b1660b72c1327318f58e937eb33dd8a1326fcd0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d9fe43b12f40a6d3debafbe4c21e1e270b12b8ac5b0fed8e0e4d717da60ef2a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fa24e3d243a8d71fd5f22e698b0354c78eb8cac75633c5b84a8bd42159641346' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_payload(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='399b06154a8fbaea7081f9116f8cd1d736f6e014aaef12819e9b8ed4e5a1f3df' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a500a81d55b0d81f5718b52c38f90aea86cd58a8fac4d58afb52a7671352bd39' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d4bb7260b80243609f4209ac647be2fb19773913b739da4944f46f7e9fabfde2' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f549672b37b6e9b79199217fcbc5a296d1a887584cb6a0033740687676292436' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_delete()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c697643b94d1eb985d076daf1f510834e8be39373aae23b659d9778e7e9f3dbf' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2babad1f225eb542c30e632b215bed9bdaf3fe2fb931d6f6c61011306f1489a2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_mutation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='184d4deaa5678a07c26415a01f0ebae0a8b5e160c67245d8be1959cb5e0c5f69' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af664f1ce37de88d7994bbb4e7e67db2eebfabd3e0f5dc73a4d7dc002791a692' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_email_delivery_event()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6c37b44db201da9c2740622b36fedc144e1d891e80e2c8bb1444f7f7cf53a72d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3ef1a89d75c15671527f4e0fa8bb38925364131becd594241024e16546bc3c51' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_grade_revision_item_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e0cd8fd5c9b2c5e0e3756040a60f74b07644c1f6d9cf26c8f7be5167df524b4d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b05845daaa070a8696fd2572605107762b6919ddf06da59e32626136e159487b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_professor_access_request_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6cc89d9726b20f9920a250d59640d6bde0834b78ef83a44b75e02a0c0b1b9d6d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='659f2beff2f8ba1f6773f650eb120cc515b8ccbc9b4ada30516537da883318d1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_published_question()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4773e7cfc9cad7b2e5fc853a70c6bddab5f9f00922f9119f6cf45073bf03a4ff' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='191a7975701371fa890ee878aa5816bba36b9e02cf797a3ec4864739149c08f2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_recovery_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1fde5878173075071ed8ccd74b1792d9c043c7bdf7055701ce8f7070c1f97739' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f2259c5dd84c19500d3b98dcf478a0ce1fa80686382d3e4350847618cfa0fe6d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_staff_membership_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a79aaa26edbe8c60d215554e8f7c7a26c4cedc3a6d953dcde8507dfa78c75da5' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e7263f3cbf7811cd6e13e2f5225dafb6baa00d6d126c7cf849742dcf67fa9b96' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_student_session_binding()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='802b52b6d076c21d36d830a92740fa683af36302809384a6ed0da06de574f40e' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7030894f8c4692b5adb5605d2f9068538ff4814a9d4a041f3bcde091d25f2fed' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_submission_answer_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='90466c13788a7d464d08d67d6a3a5b68210883140ab2e57a335f6750d790716c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c950ba3d5ce84b1590b6be154013ca5abe8c6b12dd9eeea54fbeeee028908f2e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.queue_grading_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e555ae1bbd482820fe834c4ff0806f6fdb52d2b296f593431b5f756168de4d74' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07758f4327ded35900e2ef3f8b932474d52163e28a546e6a8be450bc08ccc0a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='3e33651ef89d43e27b5a69783034e7351614bbbf560136f7318cff59c49ec4b9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f3a32fc71102eac5c83553d83c97238928c5ea603a6097b7a057c4d45eb0dfb6' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.seal_exam_version()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='eb8234aad39b21203994085df20faf3c1744071e8bd05384620593bb51074415' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c9c148a6d6182da7e5f8b8cde3c66de4a4358efbd7332b1e1c9d689a7f77ec71' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.set_snapshot_source()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e861a27c7fe71fe2e37b185cab513947d06ea09138801009864a8d5418502f58' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5af1c9a737d4a8115e0ab67c3eee489cfe400ed0f7905ab941f34feedccf508e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.touch_updated_at()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='354fd59c57b17c349514d24ce4a8e4fa8d3d177fb99291c64992d24d617f0e3a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='92fa7c305a8b856faea0575b27eaa33c1e39952cf9fe87b4c0cbf7d7eab556bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.uuid_from_hash(text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d0d7dc854b466854f2c982e528e7e65a9de4ee33b4c7dea229a5ee737fcf64bb' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66a736cf40ccbfc250f8446fbdd7de911585bb37f4da459125b74a2ad2b6e2b1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e7be18f5b1812c66834c764b2c65b466b6ebc372b09a888b3b7dc79f76078566' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ba3b55cad702ac3f3fa66745c7815eec5f43444f758d9738284208d082cf6b6a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_exam_owner()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f86d20fc206e887476f2363856d60d7c84cff4950362c185be6b434a7f7ca058' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4c0f0147ebb06f4e457ed09c2f0cea9d1fdd2799d48d1b23037213804672ffc4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_privacy_acceptance()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='277bca90bee4d10f74b5475c143c36ab7c81fa5c0b6f708d5bfbcb1d7c38051c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea0070f61cc42e6de2d0eace5f2708617191d2f0c16086e8b4b73ee9f9439671' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_room_activation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8f96672da3ed19d205bd697b255bc8e29b74080a90c4278fa8ca67a91fbed880' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e46e006a39104dd3b5b8045fecd747243d9e366eed30046d5f13643be751762b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_submission_receipt()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8a7c5d74463a6c9fe4555b42c271d524ecbead0f59bc613feef222af9f5534a9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5aa6cbbae171e04b1a28bf94961759513c804d4fa60db267e03a30c85e7f33bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8bbcaebcee32d2faca6f6c3e029b8480e8ac8af5c9ab0e8e72715c7a0050ede7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c0c64ae2a57554badd6bb2ba8046dde8ea4ee58c01ea200e50333c2dbf1fdae1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5be56ab90978ae40cdd821a7577bbe3ce977f9d6766c95fac4f111c4fbc9677b' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2913cd1f0af99c9a7999ceb93666e3ebacaed79333d33fb3e4e6049eb75c260c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.apply_open_room_lease()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f724efdff5bd3cde6cdd051a90931905049582cc52c6a47d3bd7ed6cd8a6e216' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='96f1008c13e0a2eca0fbbdd0bd11dd6f8ff8c9e48e892f7df3f0aeac6bdf3b9d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease' AND tgenabled='O' AND NOT tgisinternal AND pg_get_triggerdef(oid)='CREATE TRIGGER student_sessions_open_room_lease BEFORE INSERT ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.apply_open_room_lease()')
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='examination_room_v1' OR (ns.nspname='public' AND p.proname IN ('examination_room_v1_api','examination_room_v1_lifecycle_guard')))=49) THEN RAISE EXCEPTION 'UNKNOWN_OR_PARTIAL_PACKAGE_PREIMAGE'; END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_student(p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  institution_id uuid;
  exam_id uuid;
  exam_version_id uuid;
  activation_id uuid;
  roster_id uuid;
  student_identity_id uuid;
  session_id uuid;
  submission_id uuid;
  question_id uuid;
  answer_revision_id uuid;
  notice_version_id uuid;
  activation_status text;
  session_status text;
  notice_code text;
  full_name text;
  student_number text;
  grading_alias text;
  subject_name text;
  year_level text;
  professor_name text;
  request_hash text;
  audit_request_hash text;
  session_token_hash text;
  stored_token_hash text;
  publication_hash text;
  integrity_tier text;
  controls_payload jsonb;
  publication_manifest jsonb;
  submission_manifest jsonb;
  response jsonb;
  replay jsonb;
  answer_item jsonb;
  answer_selection jsonb;
  result_manifest jsonb;
  lifecycle_result jsonb;
  activation_opens_at timestamptz;
  activation_closes_at timestamptz;
  lease_expires_at timestamptz;
  occurred_at timestamptz;
  duration_seconds integer;
  extra_minutes integer;
  maximum_sessions integer;
  next_revision integer;
  expected_count integer;
  matched_count integer;
  affected_count integer;
  recording_required boolean;
  recording_accepted boolean;
  accepted_at timestamptz;
  accepted_features jsonb;
  expected_question_type text;
begin
  if p_operation in (''preview'', ''consent'') then
    select
      a.id,
      a.institution_id,
      a.exam_id,
      a.exam_version_id,
      a.activation_status,
      a.opens_at,
      a.closes_at,
      a.max_sessions,
      v.controls,
      v.publication_manifest,
      v.content_sha256,
      v.duration_seconds,
      v.privacy_notice_version_id,
      n.notice_code,
      er.id,
      er.student_identity_id,
      si.full_name,
      si.external_student_id,
      er.grading_alias,
      er.accommodations ->> ''subject'',
      er.accommodations ->> ''yearLevel'',
      coalesce((er.accommodations ->> ''extraMinutes'')::integer, 0),
      sm.display_name
    into
      activation_id,
      institution_id,
      exam_id,
      exam_version_id,
      activation_status,
      activation_opens_at,
      activation_closes_at,
      maximum_sessions,
      controls_payload,
      publication_manifest,
      publication_hash,
      duration_seconds,
      notice_version_id,
      notice_code,
      roster_id,
      student_identity_id,
      full_name,
      student_number,
      grading_alias,
      subject_name,
      year_level,
      extra_minutes,
      professor_name
    from examination_room_v1.room_activations a
    join examination_room_v1.exam_versions v on v.id = a.exam_version_id
    join examination_room_v1.exams e on e.id = a.exam_id
    join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
    join examination_room_v1.exam_roster er on er.exam_id = a.exam_id and er.roster_status in (''invited'', ''eligible'', ''completed'')
    join examination_room_v1.student_identities si on si.id = er.student_identity_id and si.identity_status = ''active''
    left join lateral (
      select m.display_name
      from examination_room_v1.staff_memberships m
      where m.institution_id = a.institution_id
        and m.user_id = e.owner_user_id
        and m.membership_status = ''active''
      order by (m.staff_role = ''professor'') desc, m.granted_at desc
      limit 1
    ) sm on true
    where a.key_hash = p_payload ->> ''roomKeyHash''
      and a.activation_status in (''scheduled'', ''open'')
      and a.closes_at > clock_timestamp()
      and upper(si.external_student_id) = upper(p_payload #>> ''{identity,studentNumber}'')
      and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> ''{identity,realName}''))
      and lower(btrim(er.accommodations ->> ''subject'')) = lower(btrim(p_payload #>> ''{identity,subject}''))
      and lower(btrim(er.accommodations ->> ''yearLevel'')) = lower(btrim(p_payload #>> ''{identity,yearLevel}''))
    order by a.created_at desc
    limit 1;

    if activation_id is null then
      if exists (
        select 1
        from examination_room_v1.room_activations a
        where a.key_hash = p_payload ->> ''roomKeyHash''
          and a.activation_status in (''scheduled'', ''open'')
          and a.closes_at > clock_timestamp()
      ) then
        return examination_room_v1.api_error(
          ''STUDENT_IDENTITY_INVALID'', ''The entered identity does not exactly match the examination roster.'', 400,
          ''Use the complete registered name, student number, subject, and year level.''
        );
      end if;
      return examination_room_v1.api_error(
        ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
        ''Copy the complete current key from the administrator message and try again.''
      );
    end if;

    lifecycle_result := public.examination_room_v1_lifecycle_guard(exam_id);
    if lifecycle_result ->> ''ok'' <> ''true'' then
      return lifecycle_result;
    end if;

    if p_operation = ''preview'' then
      select jsonb_build_object(
        ''ok'', true,
        ''metadata'', jsonb_build_object(
          ''examId'', e.id,
          ''title'', e.title,
          ''subject'', subject_name,
          ''yearLevel'', year_level,
          ''durationMinutes'', duration_seconds / 60,
          ''startsAt'', controls_payload -> ''startsAt'',
          ''professor'', coalesce(professor_name, ''Professor''),
          ''questionCount'', jsonb_array_length(publication_manifest -> ''questions''),
          ''integrityTier'', coalesce(controls_payload ->> ''integrityTier'', ''standard''),
          ''cameraRequired'', coalesce((controls_payload ->> ''cameraRequired'')::boolean, false),
          ''microphoneRequired'', coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false),
          ''privacyNoticeVersion'', notice_code,
          ''privacyController'', coalesce(controls_payload ->> ''privacyController'', ''''),
          ''retentionSummary'', coalesce(controls_payload ->> ''retentionSummary'', ''''),
          ''activationStatus'', activation_status,
          ''safeguards'', jsonb_build_array(
            ''Fullscreen may be requested by the examination settings.'',
            ''Focus and connection changes are recorded for professor review.'',
            ''Browser signals are review evidence, not automatic proof of misconduct.''
          )
        ),
        ''identity'', jsonb_build_object(
          ''fullName'', full_name,
          ''studentNumber'', student_number,
          ''yearLevel'', year_level
        ),
        ''notice'', jsonb_build_object(
          ''version'', n.notice_code,
          ''title'', n.title,
          ''body'', n.notice_body,
          ''purposes'', n.processing_purposes
        )
      )
      into response
      from examination_room_v1.exams e
      join examination_room_v1.privacy_notice_versions n on n.id = notice_version_id
      where e.id = exam_id;
      return response;
    end if;

    -- Consent creation and capacity checks serialize on the chosen activation;
    -- read-only previews never take this shared hot-row lock.
    perform 1
    from examination_room_v1.room_activations a
    where a.id = activation_id
    for update;
    perform 1
    from examination_room_v1.exam_roster er
    where er.id = roster_id
    for update;

    request_hash := p_payload ->> ''requestHash'';
    session_token_hash := p_payload ->> ''sessionTokenHash'';
    recording_required := coalesce(controls_payload ->> ''integrityTier'', ''standard'') = ''recorded_proctoring''
      or coalesce((controls_payload ->> ''cameraRequired'')::boolean, false)
      or coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false);
    recording_accepted := coalesce((p_payload #>> ''{consent,recordingAccepted}'')::boolean, false);

    if activation_status <> ''open'' or clock_timestamp() < activation_opens_at then
      return examination_room_v1.api_error(
        ''ROOM_NOT_OPEN'', ''The professor has not opened this examination room yet.'', 409,
        ''Wait for the professor to open the room, then choose Agree and begin again.''
      );
    end if;
    if p_payload #>> ''{consent,noticeVersion}'' <> notice_code
       or not coalesce((p_payload #>> ''{consent,accepted}'')::boolean, false) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_VERSION_MISMATCH'', ''Consent must accept the exact current privacy notice.'', 412,
        ''Review the current notice shown on screen and agree again.''
      );
    end if;
    if recording_required and not recording_accepted then
      return examination_room_v1.api_error(
        ''RECORDING_CONSENT_REQUIRED'', ''This examination requires separate recording consent.'', 412,
        ''Agree to recording or ask the professor for another permitted arrangement.''
      );
    end if;

    replay := examination_room_v1.api_replay(institution_id, request_hash, ''student.consent'');
    if replay is not null then
      if replay ->> ''ok'' = ''false'' then return replay; end if;
      select s.id, s.session_token_hash
      into session_id, stored_token_hash
      from examination_room_v1.student_sessions s
      where s.consent_request_hash = request_hash
        and s.activation_id = activation_id
        and s.roster_id = roster_id
      for update;
      if session_id is null then
        return examination_room_v1.api_error(
          ''CONSENT_REPLAY_INVALID'', ''The prior consent receipt cannot be recovered.'', 409,
          ''Return to the join page and create a new consent request.''
        );
      end if;
      if stored_token_hash <> session_token_hash then
        update examination_room_v1.student_sessions s
        set session_token_hash = session_token_hash
        where s.id = session_id;
      end if;
      select v.publication_manifest, v.content_sha256
      into publication_manifest, publication_hash
      from examination_room_v1.student_sessions s
      join examination_room_v1.exam_versions v on v.id = s.exam_version_id
      where s.id = session_id;
      replay := replay || jsonb_build_object(
        ''publicationManifest'', publication_manifest,
        ''publicationHash'', publication_hash
      );
      return replay;
    end if;

    if maximum_sessions is not null
       and (select count(*) from examination_room_v1.student_sessions s where s.activation_id = activation_id) >= maximum_sessions then
      return examination_room_v1.api_error(
        ''ROOM_SESSION_LIMIT_REACHED'', ''This room has reached its configured session limit.'', 409,
        ''Ask the professor or administrator to review the room capacity.''
      );
    end if;
    if exists (
      select 1 from examination_room_v1.student_sessions s
      where s.activation_id = activation_id and s.roster_id = roster_id
    ) then
      return examination_room_v1.api_error(
        ''SESSION_ALREADY_EXISTS'', ''A session already exists for this student and room.'', 409,
        ''Resume the existing session with its issued session token.''
      );
    end if;

    session_id := gen_random_uuid();
    lease_expires_at := least(
      activation_closes_at,
      clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
    );
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id, session_status,
      identity_verified_at, identity_verification_method, started_at,
      last_heartbeat_at, lease_expires_at, session_metadata
    ) values (
      session_id,
      activation_id,
      exam_id,
      institution_id,
      exam_version_id,
      roster_id,
      session_token_hash,
      request_hash,
      (p_payload ->> ''clientInstanceId'')::uuid,
      ''active'',
      clock_timestamp(),
      ''room_key_roster_match'',
      clock_timestamp(),
      clock_timestamp(),
      lease_expires_at,
      jsonb_build_object(''connected'', true, ''currentQuestion'', 1)
    );

    insert into examination_room_v1.privacy_acceptances (
      notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
      decision, accepted_features, evidence_sha256, capture_method, recorded_at
    ) values (
      notice_version_id,
      roster_id,
      session_id,
      exam_version_id,
      (p_payload ->> ''clientEventId'')::uuid,
      ''accepted'',
      jsonb_build_object(
        ''recordingAccepted'', recording_accepted,
        ''cameraRequired'', coalesce((controls_payload ->> ''cameraRequired'')::boolean, false),
        ''microphoneRequired'', coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false),
        ''integrityTier'', coalesce(controls_payload ->> ''integrityTier'', ''standard'')
      ),
      request_hash,
      ''checkbox'',
      (p_payload #>> ''{consent,acceptedAt}'')::timestamptz
    );

    response := jsonb_build_object(
      ''ok'', true,
      ''session'', jsonb_build_object(
        ''id'', session_id,
        ''status'', ''active'',
        ''startedAt'', clock_timestamp(),
        ''leaseExpiresAt'', lease_expires_at,
        ''anonymousCandidateId'', grading_alias
      ),
      ''publicationManifest'', publication_manifest,
      ''publicationHash'', publication_hash
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.consent'',
      ''student_session'', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  session_id := nullif(p_payload ->> ''sessionId'', '''')::uuid;
  session_token_hash := p_payload ->> ''sessionTokenHash'';
  select
    s.institution_id,
    s.exam_id,
    s.exam_version_id,
    s.activation_id,
    s.roster_id,
    er.student_identity_id,
    s.session_status,
    s.lease_expires_at,
    a.activation_status,
    a.opens_at,
    a.closes_at,
    v.controls,
    v.publication_manifest,
    v.content_sha256,
    v.privacy_notice_version_id,
    n.notice_code,
    si.full_name,
    si.external_student_id,
    er.grading_alias,
    er.accommodations ->> ''subject'',
    er.accommodations ->> ''yearLevel''
  into
    institution_id,
    exam_id,
    exam_version_id,
    activation_id,
    roster_id,
    student_identity_id,
    session_status,
    lease_expires_at,
    activation_status,
    activation_opens_at,
    activation_closes_at,
    controls_payload,
    publication_manifest,
    publication_hash,
    notice_version_id,
    notice_code,
    full_name,
    student_number,
    grading_alias,
    subject_name,
    year_level
  from examination_room_v1.student_sessions s
  join examination_room_v1.room_activations a on a.id = s.activation_id
  join examination_room_v1.exam_versions v on v.id = s.exam_version_id
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  join examination_room_v1.exam_roster er on er.id = s.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update of s;

  if institution_id is null then
    return examination_room_v1.api_error(
      ''SESSION_INVALID'', ''The examination session could not be verified.'', 401,
      ''Return to the join page and enter the same room key and student details.''
    );
  end if;

  if p_operation = ''result'' and session_status = ''revoked'' then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This examination credential has been revoked.'', 401,
      ''Ask the examination administrator to review access to the released result.''
    );
  end if;

  if p_operation in (''resume'', ''session_context'') then
    select jsonb_build_object(
      ''ok'', true,
      ''session'', jsonb_build_object(
        ''id'', s.id,
        ''status'', s.session_status,
        ''startedAt'', s.started_at,
        ''lastHeartbeatAt'', s.last_heartbeat_at,
        ''leaseExpiresAt'', s.lease_expires_at,
        ''submittedAt'', s.ended_at
      ),
      ''publicationManifest'', publication_manifest,
      ''publicationHash'', publication_hash,
      ''studentIdentity'', jsonb_build_object(
        ''realName'', full_name,
        ''studentNumber'', student_number,
        ''subject'', subject_name,
        ''yearLevel'', year_level
      ),
      ''privacyConsent'', consent.item,
      ''answerRevisions'', coalesce(answers.items, ''[]''::jsonb),
      ''nextRevisionByQuestion'', coalesce(answers.next_revisions, ''{}''::jsonb),
      ''anonymousCandidateId'', grading_alias
    )
    into response
    from examination_room_v1.student_sessions s
    left join lateral (
      select jsonb_build_object(
        ''noticeVersion'', notice_code,
        ''accepted'', true,
        ''acceptedAt'', to_char(pa.recorded_at at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),
        ''recordingAccepted'', coalesce((pa.accepted_features ->> ''recordingAccepted'')::boolean, false)
      ) as item
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = s.id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawal
          where withdrawal.prior_acceptance_id = pa.id and withdrawal.decision = ''withdrawn''
        )
      order by pa.recorded_at desc
      limit 1
    ) consent on true
    left join lateral (
      with latest as (
        select distinct on (ar.question_id)
          ar.question_id,
          ar.answer_payload,
          ar.idempotency_key_hash,
          ar.revision_number
        from examination_room_v1.answer_revisions ar
        where ar.session_id = s.id
        order by ar.question_id, ar.revision_number desc
      ), next_values as (
        select q.question_key, coalesce(max(ar.revision_number), 0) + 1 as next_revision
        from examination_room_v1.questions q
        left join examination_room_v1.answer_revisions ar
          on ar.question_id = q.id and ar.session_id = s.id
        where q.exam_version_id = s.exam_version_id
        group by q.question_key
      )
      select
        coalesce((
          select jsonb_agg(
            latest.answer_payload || jsonb_build_object(''idempotencyKey'', latest.idempotency_key_hash)
            order by q.position
          )
          from latest
          join examination_room_v1.questions q on q.id = latest.question_id
        ), ''[]''::jsonb) as items,
        coalesce((select jsonb_object_agg(next_values.question_key, next_values.next_revision) from next_values), ''{}''::jsonb) as next_revisions
    ) answers on true
    where s.id = session_id;

    if p_operation = ''session_context'' and response -> ''privacyConsent'' = ''null''::jsonb then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;
    return response;
  end if;

  if p_operation = ''result'' then
    select rr.release_manifest
    into result_manifest
    from examination_room_v1.submissions sub
    join examination_room_v1.result_releases rr
      on rr.submission_id = sub.id and rr.release_action = ''release''
    where sub.session_id = session_id
      and not exists (
        select 1 from examination_room_v1.result_releases revoked
        where revoked.supersedes_release_id = rr.id and revoked.release_action = ''revoke''
      )
    order by rr.occurred_at desc
    limit 1;

    if result_manifest is null then
      return jsonb_build_object(''ok'', true, ''available'', false, ''status'', ''awaiting_release'');
    end if;
    return jsonb_build_object(
      ''ok'', true,
      ''available'', true,
      ''releasedAt'', result_manifest -> ''releasedAt'',
      ''result'', result_manifest -> ''result''
    );
  end if;

  if p_operation in (''heartbeat'', ''record_event'', ''save_answer'', ''submit'')
     and not exists (
       select 1
       from examination_room_v1.privacy_acceptances pa
       where pa.session_id = session_id
         and pa.notice_version_id = notice_version_id
         and pa.decision = ''accepted''
         and not exists (
           select 1
           from examination_room_v1.privacy_acceptances withdrawn
           where withdrawn.prior_acceptance_id = pa.id
             and withdrawn.decision = ''withdrawn''
         )
     ) then
    return examination_room_v1.api_error(
      ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
      ''Return to the join page and review the current notice.''
    );
  end if;

  request_hash := p_payload ->> ''requestHash'';
  audit_request_hash := case
    when p_operation = ''submit'' then
      encode(extensions.digest(request_hash || '':student.submit'', ''sha256''), ''hex'')
    else request_hash
  end;

  replay := examination_room_v1.api_replay(
    institution_id,
    audit_request_hash,
    ''student.'' || p_operation
  );

  if replay is null
     and p_operation = ''submit''
     and exists (
       select 1
       from examination_room_v1.audit_events legacy
       where legacy.institution_id = institution_id
         and legacy.request_hash = request_hash
         and legacy.event_type = ''student.submit''
     ) then
    replay := examination_room_v1.api_replay(
      institution_id,
      request_hash,
      ''student.submit''
    );
  end if;

  if replay is not null then
    if p_operation = ''submit'' and replay ->> ''ok'' = ''true'' then
      return jsonb_set(replay, ''{duplicate}'', ''true''::jsonb, true);
    end if;
    return replay;
  end if;

  if session_status not in (''created'', ''active'')
     or lease_expires_at <= clock_timestamp()
     or activation_status <> ''open''
     or clock_timestamp() > activation_closes_at then
    return examination_room_v1.api_error(
      ''SESSION_NOT_ACTIVE'', ''This examination session is no longer active.'', 409,
      ''Reconnect or ask the professor to review the session. Server-backed answers remain preserved.''
    );
  end if;

  occurred_at := coalesce((p_payload ->> ''occurredAt'')::timestamptz, clock_timestamp());

  if p_operation = ''heartbeat'' then
    update examination_room_v1.student_sessions s
    set last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), occurred_at),
        session_metadata = s.session_metadata || jsonb_build_object(
          ''connected'', coalesce((p_payload ->> ''connected'')::boolean, true),
          ''currentQuestion'', coalesce((p_payload ->> ''currentQuestion'')::integer, 1)
        )
    where s.id = session_id;
    response := jsonb_build_object(
      ''ok'', true,
      ''sessionId'', session_id,
      ''receivedAt'', clock_timestamp(),
      ''connected'', coalesce((p_payload ->> ''connected'')::boolean, true)
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.heartbeat'',
      ''student_session'', session_id, request_hash, occurred_at, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''record_event'' then
    insert into examination_room_v1.proctoring_incidents (
      session_id, client_event_id, incident_kind, source, severity,
      occurred_at, duration_ms, details
    ) values (
      session_id,
      (p_payload ->> ''clientEventId'')::uuid,
      p_payload ->> ''incidentKind'',
      ''browser_signal'',
      coalesce(p_payload ->> ''severity'', ''info''),
      occurred_at,
      nullif(p_payload ->> ''durationMs'', '''')::integer,
      coalesce(p_payload -> ''details'', ''{}''::jsonb)
    )
    returning id into answer_revision_id;
    response := jsonb_build_object(''ok'', true, ''incidentId'', answer_revision_id, ''recordedAt'', clock_timestamp());
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.record_event'',
      ''proctoring_incident'', answer_revision_id, request_hash, occurred_at, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''save_answer'' then
    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = ''withdrawn''
        )
    ) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;

    answer_item := p_payload -> ''answerRevision'';
    select q.id, coalesce(q.configuration ->> ''type'', replace(q.question_kind, ''_'', ''-''))
    into question_id, expected_question_type
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and q.position = (answer_item ->> ''questionNumber'')::integer
      and q.question_key = answer_item ->> ''questionKey'';
    if question_id is null
       or (answer_item ->> ''attemptId'')::uuid <> session_id
       or (answer_item ->> ''examinationId'')::uuid <> exam_id
       or coalesce((answer_item ->> ''examinationVersion'')::integer, -1) <> (publication_manifest ->> ''version'')::integer
       or answer_item ->> ''questionType'' <> expected_question_type
       or answer_item ->> ''publicationHash'' <> publication_hash then
      return examination_room_v1.api_error(
        ''ANSWER_BINDING_MISMATCH'', ''The answer does not belong to this exact examination session and version.'', 409,
        ''Refresh the examination. Your other saved answers remain preserved.''
      );
    end if;
    select coalesce(max(ar.revision_number), 0) + 1
    into next_revision
    from examination_room_v1.answer_revisions ar
    where ar.session_id = session_id and ar.question_id = question_id;
    if (answer_item ->> ''revision'')::integer <> next_revision then
      return examination_room_v1.api_error(
        ''ANSWER_REVISION_CONFLICT'', ''A newer answer revision already exists for this question.'', 409,
        ''Refresh the saved answer state, then save again.''
      );
    end if;

    answer_revision_id := gen_random_uuid();
    insert into examination_room_v1.answer_revisions (
      id, session_id, exam_version_id, question_id, revision_number,
      client_revision_id, idempotency_key_hash, answer_format, answer_payload,
      answer_sha256, is_flagged, source, saved_at
    ) values (
      answer_revision_id,
      session_id,
      exam_version_id,
      question_id,
      next_revision,
      (p_payload ->> ''clientEventId'')::uuid,
      request_hash,
      case
        when answer_item ->> ''questionType'' = ''multiple-choice'' then ''choice''
        when answer_item ->> ''questionType'' = ''true-false'' then ''boolean''
        else ''plain_text''
      end,
      answer_item,
      p_payload ->> ''answerHash'',
      coalesce((p_payload ->> ''flagged'')::boolean, false),
      coalesce(p_payload ->> ''source'', ''autosave''),
      (p_payload ->> ''savedAt'')::timestamptz
    );
    response := jsonb_build_object(
      ''ok'', true,
      ''revision'', jsonb_build_object(
        ''id'', answer_revision_id,
        ''questionKey'', answer_item ->> ''questionKey'',
        ''revision'', next_revision,
        ''savedAt'', p_payload -> ''savedAt'',
        ''flagged'', coalesce((p_payload ->> ''flagged'')::boolean, false)
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.save_answer'',
      ''answer_revision'', answer_revision_id, request_hash,
      (p_payload ->> ''savedAt'')::timestamptz, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''submit'' then
    submission_manifest := p_payload -> ''submissionManifest'';

    select pa.recorded_at, pa.accepted_features
    into accepted_at, accepted_features
    from examination_room_v1.privacy_acceptances pa
    where pa.session_id = session_id
      and pa.notice_version_id = notice_version_id
      and pa.decision = ''accepted''
      and not exists (
        select 1
        from examination_room_v1.privacy_acceptances withdrawn
        where withdrawn.prior_acceptance_id = pa.id
          and withdrawn.decision = ''withdrawn''
      )
    order by pa.recorded_at desc
    limit 1;

    if coalesce(submission_manifest ->> ''schemaVersion'', '''') <> ''examination-room/submission/v1''
       or (submission_manifest ->> ''attemptId'')::uuid <> session_id
       or (submission_manifest ->> ''examinationId'')::uuid <> exam_id
       or coalesce((submission_manifest ->> ''examinationVersion'')::integer, -1) <> (publication_manifest ->> ''version'')::integer
       or submission_manifest ->> ''publicationHash'' <> publication_hash
       or submission_manifest ->> ''identityMode'' <> coalesce(controls_payload ->> ''identityMode'', ''real_names'')
       or submission_manifest -> ''studentIdentity'' is distinct from jsonb_build_object(
         ''realName'', full_name,
         ''studentNumber'', student_number,
         ''subject'', subject_name,
         ''yearLevel'', year_level
       )
       or submission_manifest -> ''gradingIdentity'' is distinct from (case
         when coalesce(controls_payload ->> ''identityMode'', ''real_names'') = ''anonymous_grading'' then
           jsonb_build_object(''mode'', ''anonymous_grading'', ''anonymousCandidateId'', grading_alias)
         else
           jsonb_build_object(''mode'', ''real_names'', ''displayName'', full_name, ''studentNumber'', student_number)
       end)
       or submission_manifest #>> ''{privacyConsent,noticeVersion}'' <> notice_code
       or not coalesce((submission_manifest #>> ''{privacyConsent,accepted}'')::boolean, false) then
      return examination_room_v1.api_error(
        ''SUBMISSION_BINDING_MISMATCH'', ''The submission does not match this exact session, publication, and consent.'', 409,
        ''Reconnect to the examination and submit the server-backed answers again.''
      );
    end if;

    if submission_manifest -> ''privacyConsent'' is distinct from jsonb_build_object(
         ''noticeVersion'', notice_code,
         ''accepted'', true,
         ''acceptedAt'', to_char(accepted_at at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),
         ''recordingAccepted'', coalesce((accepted_features ->> ''recordingAccepted'')::boolean, false)
       ) then
      return examination_room_v1.api_error(
        ''SUBMISSION_CONSENT_MISMATCH'', ''The submission consent evidence does not match the immutable server receipt.'', 409,
        ''Reconnect to the examination and submit the server-backed consent receipt again.''
      );
    end if;

    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = ''withdrawn''
        )
    ) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;

    expected_count := jsonb_array_length(coalesce(p_payload -> ''answerSelections'', ''[]''::jsonb));
    if expected_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
       or expected_count <> jsonb_array_length(coalesce(submission_manifest -> ''questions'', ''[]''::jsonb))
       or coalesce((submission_manifest ->> ''questionCount'')::integer, -1) <> expected_count
       or coalesce((submission_manifest ->> ''maxPoints'')::numeric, -1) <>
          (select coalesce(sum(q.points), 0) from examination_room_v1.questions q where q.exam_version_id = exam_version_id) then
      return examination_room_v1.api_error(
        ''SUBMISSION_ANSWER_MISSING'', ''Every question must have one saved answer revision before submission.'', 400,
        ''Return to the listed question, save an answer, then submit again.''
      );
    end if;

    select count(*)::integer
    into matched_count
    from jsonb_array_elements(p_payload -> ''answerSelections'') selected(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (selected.value ->> ''questionNumber'')::integer
     and q.question_key = selected.value ->> ''questionKey''
    join examination_room_v1.answer_revisions ar
      on ar.session_id = session_id
     and ar.question_id = q.id
     and ar.revision_number = (selected.value ->> ''revision'')::integer
    join lateral (
      select manifest_question.value
      from jsonb_array_elements(submission_manifest -> ''questions'') manifest_question(value)
      where (manifest_question.value ->> ''questionNumber'')::integer = q.position
        and manifest_question.value ->> ''questionKey'' = q.question_key
        and (manifest_question.value ->> ''revision'')::integer = ar.revision_number
        and manifest_question.value -> ''answer'' = ar.answer_payload -> ''answer''
    ) bound on true;

    if matched_count <> expected_count then
      return examination_room_v1.api_error(
        ''ANSWER_BINDING_MISMATCH'', ''One or more submitted answers does not match its saved server revision.'', 409,
        ''Refresh the saved-answer state and submit again.''
      );
    end if;

    submission_id := (submission_manifest ->> ''submissionId'')::uuid;
    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      submission_id,
      session_id,
      exam_version_id,
      request_hash,
      p_payload ->> ''manifestHash'',
      submission_manifest,
      expected_count,
      (submission_manifest ->> ''submittedAt'')::timestamptz
    );

    for answer_selection in select value from jsonb_array_elements(p_payload -> ''answerSelections'')
    loop
      select q.id, ar.id
      into question_id, answer_revision_id
      from examination_room_v1.questions q
      join examination_room_v1.answer_revisions ar
        on ar.question_id = q.id
       and ar.session_id = session_id
       and ar.revision_number = (answer_selection ->> ''revision'')::integer
      where q.exam_version_id = exam_version_id
        and q.position = (answer_selection ->> ''questionNumber'')::integer
        and q.question_key = answer_selection ->> ''questionKey'';
      insert into examination_room_v1.submission_answers (
        submission_id, session_id, question_id, answer_revision_id
      ) values (
        submission_id, session_id, question_id, answer_revision_id
      );
    end loop;

    insert into examination_room_v1.submission_receipts (
      submission_id, receipt_sha256, receipt_payload
    ) values (
      submission_id,
      p_payload ->> ''manifestHash'',
      jsonb_build_object(
        ''schemaVersion'', ''examination-room/submission-receipt/v1'',
        ''submissionId'', submission_id,
        ''manifestHash'', p_payload ->> ''manifestHash'',
        ''answerCount'', expected_count,
        ''receivedAt'', clock_timestamp()
      )
    ) returning id into answer_revision_id;

    update examination_room_v1.student_sessions s
    set session_status = ''submitted'', ended_at = clock_timestamp()
    where s.id = session_id;
    update examination_room_v1.exam_roster er
    set roster_status = ''completed''
    where er.id = roster_id;

    insert into examination_room_v1.recovery_snapshots (
      exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, retention_until
    ) values (
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      ''answer_state'',
      request_hash,
      expected_count,
      ''pending'',
      clock_timestamp() + interval ''365 days''
    );

    response := jsonb_build_object(
      ''ok'', true,
      ''submission'', jsonb_build_object(
        ''id'', submission_id,
        ''status'', ''accepted'',
        ''receiptId'', answer_revision_id,
        ''receivedAt'', clock_timestamp()
      ),
      ''duplicate'', false
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.submit'',
      ''submission'', submission_id, audit_request_hash,
      (submission_manifest ->> ''submittedAt'')::timestamptz, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''The student operation is not implemented.'', 400,
    ''Refresh the examination and try a listed action.''
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.prepare_student_admission(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  activation_row examination_room_v1.room_activations%rowtype;
  exam_owner_id uuid;
  student_identity_id uuid;
  roster_id uuid;
  full_name text := btrim(coalesce(p_payload #>> ''{identity,realName}'', ''''));
  student_number text := upper(btrim(coalesce(p_payload #>> ''{identity,studentNumber}'', '''')));
  entered_subject text := btrim(coalesce(p_payload #>> ''{identity,subject}'', ''''));
  entered_year_level text := btrim(coalesce(p_payload #>> ''{identity,yearLevel}'', ''''));
  student_email text := nullif(lower(btrim(coalesce(p_payload #>> ''{identity,email}'', ''''))), '''');
  canonical_subject text;
  canonical_year_level text;
  admission_mode text;
  allowed_emails text[];
  use_anonymous_grading boolean;
  lifecycle_result jsonb;
begin
  select activation.* into activation_row
  from examination_room_v1.room_activations activation
  where activation.key_hash = p_payload ->> ''roomKeyHash''
  order by activation.created_at desc, activation.id desc
  limit 1;

  if activation_row.id is null then
    return examination_room_v1.api_error(
      ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
      ''Copy the complete current key from the Professor message and try again.''
    );
  end if;

  lifecycle_result := public.examination_room_v1_lifecycle_guard(activation_row.exam_id);
  if lifecycle_result ->> ''ok'' <> ''true'' then
    return lifecycle_result;
  end if;

  if activation_row.activation_status not in (''scheduled'', ''open'')
     or activation_row.closes_at <= clock_timestamp() then
    return examination_room_v1.api_error(
      ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
      ''Copy the complete current key from the Professor message and try again.''
    );
  end if;

  if activation_row.activation_status = ''scheduled'' then
    update examination_room_v1.room_activations activation
    set activation_status = ''open'',
        opens_at = least(activation.opens_at, clock_timestamp()),
        deactivated_at = null,
        deactivated_by_user_id = null,
        deactivation_reason = null
    where activation.id = activation_row.id
      and activation.activation_status = ''scheduled''
      and activation.closes_at > clock_timestamp()
    returning activation.* into activation_row;

    if not found then
      select activation.* into activation_row
      from examination_room_v1.room_activations activation
      where activation.key_hash = p_payload ->> ''roomKeyHash''
        and activation.activation_status = ''open''
        and activation.closes_at > clock_timestamp();
    end if;
    if activation_row.id is null then
      return examination_room_v1.api_error(
        ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
        ''Copy the complete current key from the Professor message and try again.''
      );
    end if;
  end if;

  if length(full_name) not between 2 and 240
     or full_name !~ ''[[:alpha:]]''
     or length(student_number) not between 2 and 128
     or length(entered_subject) not between 1 and 160
     or length(entered_year_level) not between 1 and 64 then
    return examination_room_v1.api_error(
      ''STUDENT_IDENTITY_INVALID'', ''Complete the student name, student number, subject, and year level.'', 400,
      ''Correct the four student details, then try again with the same key.''
    );
  end if;
  if student_email is not null and (
    length(student_email) not between 3 and 320
    or student_email !~ ''^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$''
  ) then
    return examination_room_v1.api_error(
      ''STUDENT_EMAIL_INVALID'', ''Enter a valid student email or leave it blank.'', 400,
      ''Correct the email, then try again.''
    );
  end if;

  select
    exam.owner_user_id,
    exam.anonymous_grading,
    version.admission_mode_snapshot,
    version.allowed_emails_snapshot,
    coalesce(version.controls ->> ''subject'', ''''),
    coalesce(version.controls ->> ''yearLevel'', '''')
  into
    exam_owner_id,
    use_anonymous_grading,
    admission_mode,
    allowed_emails,
    canonical_subject,
    canonical_year_level
  from examination_room_v1.exams exam
  join examination_room_v1.exam_versions version on version.id = activation_row.exam_version_id
  where exam.id = activation_row.exam_id
    and exam.institution_id = activation_row.institution_id;

  if admission_mode = ''email_allowlist''
     and (student_email is null or not (student_email = any(allowed_emails))) then
    return examination_room_v1.api_error(
      ''STUDENT_EMAIL_NOT_ALLOWED'', ''This email is not included in the examination access list.'', 403,
      ''Check the email spelling or ask the Professor to update the optional email list.''
    );
  end if;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
    where session.activation_id = activation_row.id
      and session.session_status = ''revoked''
      and (
        identity.external_student_id = student_number
        or (
          student_email is not null
          and identity.email_normalized = student_email
        )
      )
  ) then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This entry was removed from the current examination room.'', 403,
      ''Ask the Professor before trying to enter this activation again.''
    );
  end if;

  insert into examination_room_v1.student_identities (
    institution_id, external_student_id, full_name, email_normalized,
    identity_status, verified_at, verification_method
  ) values (
    activation_row.institution_id,
    student_number,
    full_name,
    student_email,
    ''active'',
    null,
    null
  )
  on conflict (institution_id, external_student_id) do update
  set full_name = excluded.full_name,
      email_normalized = coalesce(excluded.email_normalized, examination_room_v1.student_identities.email_normalized),
      identity_status = ''active'',
      updated_at = clock_timestamp()
  returning id into student_identity_id;

  roster_id := gen_random_uuid();
  insert into examination_room_v1.exam_roster (
    id, exam_id, institution_id, student_identity_id, grading_alias,
    roster_status, accommodations, added_by_user_id
  ) values (
    roster_id,
    activation_row.exam_id,
    activation_row.institution_id,
    student_identity_id,
    case when use_anonymous_grading
      then ''CAND-'' || upper(substr(replace(roster_id::text, ''-'', ''''), 1, 8))
      else null end,
    ''eligible'',
    jsonb_build_object(
      ''subject'', canonical_subject,
      ''yearLevel'', canonical_year_level,
      ''enteredSubject'', entered_subject,
      ''enteredYearLevel'', entered_year_level,
      ''admissionSource'', ''room_key_self_entry'',
      ''extraMinutes'', 0
    ),
    exam_owner_id
  )
  on conflict on constraint exam_roster_exam_student_key do update
  set roster_status = case
        when examination_room_v1.exam_roster.roster_status = ''completed'' then ''completed''
        else ''eligible''
      end,
      grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
      accommodations = jsonb_build_object(
        ''subject'', canonical_subject,
        ''yearLevel'', canonical_year_level,
        ''enteredSubject'', entered_subject,
        ''enteredYearLevel'', entered_year_level,
        ''admissionSource'', ''room_key_self_entry'',
        ''extraMinutes'', coalesce(
          examination_room_v1.exam_roster.accommodations -> ''extraMinutes'',
          ''0''::jsonb
        )
      ),
      updated_at = clock_timestamp()
  returning id into roster_id;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    where session.activation_id = activation_row.id
      and session.roster_id = roster_id
      and session.session_status = ''revoked''
  ) then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This entry was removed from the current examination room.'', 403,
      ''Ask the Professor before trying to enter this activation again.''
    );
  end if;

  return jsonb_build_object(
    ''ok'', true,
    ''identity'', jsonb_strip_nulls(jsonb_build_object(
      ''realName'', full_name,
      ''studentNumber'', student_number,
      ''subject'', canonical_subject,
      ''yearLevel'', canonical_year_level,
      ''email'', student_email
    ))
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.recover_existing_student_session(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
declare
  v_session_id uuid;
  v_exam_id uuid;
  v_exam_version_id uuid;
  v_institution_id uuid;
  v_roster_id uuid;
  v_session_status text;
  v_started_at timestamptz;
  v_lease_expires_at timestamptz;
  v_publication_manifest jsonb;
  v_publication_hash text;
  v_grading_alias text;
  v_request_hash text := p_payload ->> ''requestHash'';
  v_session_token_hash text := p_payload ->> ''sessionTokenHash'';
  v_client_event_id uuid := nullif(p_payload ->> ''clientEventId'', '''')::uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from ''object''
     or coalesce(p_payload ->> ''roomKeyHash'', '''') !~ ''^[0-9a-f]{64}$''
     or coalesce(v_request_hash, '''') !~ ''^[0-9a-f]{64}$''
     or coalesce(v_session_token_hash, '''') !~ ''^[0-9a-f]{64}$'' then
    return examination_room_v1.api_error(
      ''SESSION_RECOVERY_INVALID'',
      ''The saved examination could not be reconnected safely.'',
      400,
      ''Return to the join page, enter the same room key and student details, then try again.''
    );
  end if;

  select
    s.id,
    s.exam_id,
    s.exam_version_id,
    s.institution_id,
    s.roster_id,
    s.session_status,
    s.started_at,
    s.lease_expires_at,
    v.publication_manifest,
    v.content_sha256,
    er.grading_alias
  into
    v_session_id,
    v_exam_id,
    v_exam_version_id,
    v_institution_id,
    v_roster_id,
    v_session_status,
    v_started_at,
    v_lease_expires_at,
    v_publication_manifest,
    v_publication_hash,
    v_grading_alias
  from examination_room_v1.room_activations a
  join examination_room_v1.student_sessions s
    on s.activation_id = a.id
  join examination_room_v1.exam_roster er
    on er.id = s.roster_id
   and er.exam_id = s.exam_id
   and er.institution_id = s.institution_id
  join examination_room_v1.student_identities si
    on si.id = er.student_identity_id
  join examination_room_v1.exam_versions v
    on v.id = s.exam_version_id
  where a.key_hash = p_payload ->> ''roomKeyHash''
    and a.activation_status = ''open''
    and a.closes_at > clock_timestamp()
    and s.session_status in (''created'', ''active'')
    and upper(si.external_student_id) = upper(p_payload #>> ''{identity,studentNumber}'')
    and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> ''{identity,realName}''))
    and lower(btrim(er.accommodations ->> ''subject'')) = lower(btrim(p_payload #>> ''{identity,subject}''))
    and lower(btrim(er.accommodations ->> ''yearLevel'')) = lower(btrim(p_payload #>> ''{identity,yearLevel}''))
    and not exists (
      select 1
      from examination_room_v1.submissions sub
      where sub.session_id = s.id
    )
  order by s.started_at desc
  limit 1
  for update of s;

  if v_session_id is null then
    return examination_room_v1.api_error(
      ''SESSION_ALREADY_EXISTS'',
      ''A session already exists for this student and room, but it could not be safely resumed.'',
      409,
      ''Use the same room key and exact student details. If this continues, ask the professor to review the session.''
    );
  end if;

  update examination_room_v1.student_sessions s
  set session_token_hash = v_session_token_hash,
      last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), clock_timestamp()),
      updated_at = clock_timestamp()
  where s.id = v_session_id;

  v_response := jsonb_build_object(
    ''ok'', true,
    ''resumed'', true,
    ''session'', jsonb_build_object(
      ''id'', v_session_id,
      ''status'', v_session_status,
      ''startedAt'', v_started_at,
      ''leaseExpiresAt'', v_lease_expires_at,
      ''anonymousCandidateId'', v_grading_alias
    ),
    ''publicationManifest'', v_publication_manifest,
    ''publicationHash'', v_publication_hash
  );

  perform examination_room_v1.api_record_audit(
    v_institution_id,
    v_exam_id,
    v_session_id,
    null,
    ''student'',
    ''student.session_recovered'',
    ''student_session'',
    v_session_id,
    v_request_hash,
    clock_timestamp(),
    v_response,
    v_client_event_id
  );

  return v_response;
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION public.examination_room_v1_api(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb DEFAULT ''{}''::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, ''{}''::jsonb);
  exam_id uuid;
  admission_result jsonb;
  student_result jsonb;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> ''student'' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> ''object'' then
    return examination_room_v1.api_error(
      ''INVALID_REQUEST'', ''Scope, operation, an object payload, and workspace for creator views are required.'', 400,
      ''Refresh Examination Room and try again.''
    );
  end if;

  if safe_payload::text ~* ''"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'' then
    return examination_room_v1.api_error(
      ''RAW_SECRET_REJECTED'', ''Only one-way hashes or opaque identifiers may reach examination persistence.'', 400,
      ''Refresh the page and repeat the action without raw credentials.''
    );
  end if;

  if not (
    (p_scope = ''professor'' and p_operation in (
      ''session'', ''exam'', ''monitor'', ''grading'', ''grading_context'', ''release_context'',
      ''save_draft'', ''publish'', ''open_room'', ''close_room'', ''revoke_session'',
      ''save_grade'', ''release_results''
    ))
    or (p_scope = ''student'' and p_operation in (
      ''preview'', ''consent'', ''resume'', ''result'', ''session_context'', ''save_answer'',
      ''record_event'', ''heartbeat'', ''submission_intent'', ''submit''
    ))
    or (p_scope = ''admin'' and p_operation in (
      ''overview'', ''activate_exam'', ''email_key'', ''revoke_key'', ''create_snapshot''
    ))
  ) then
    return examination_room_v1.api_error(
      ''UNKNOWN_OPERATION'', ''The requested Examination Room operation is not registered.'', 400,
      ''Refresh Examination Room and choose a listed action.''
    );
  end if;

  if p_scope = ''professor'' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        ''CREATOR_WORKSPACE_REQUIRED'', ''A verified account and active law-school workspace are required.'', 403,
        ''Sign in, choose an active workspace, then retry.''
      );
    end if;
    if p_operation in (''monitor'', ''grading'') then
      exam_id := nullif(safe_payload ->> ''examId'', '''')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    if p_operation = ''revoke_session'' then
      return examination_room_v1.creator_revoke_session(
        p_actor_user_id, p_institution_id, safe_payload
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = ''admin'' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = ''active''
       ) then
      return examination_room_v1.api_error(
        ''PLATFORM_OWNER_REQUIRED'', ''Only a Founder or Super Admin may use examination administration.'', 403,
        ''Sign in with a platform-owner account.''
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;

  if p_operation in (''preview'', ''consent'') then
    admission_result := examination_room_v1.prepare_student_admission(safe_payload);
    if admission_result ->> ''ok'' = ''false'' then return admission_result; end if;
    safe_payload := jsonb_set(
      safe_payload,
      ''{identity}'',
      admission_result -> ''identity'',
      true
    );
  end if;

  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = ''consent''
     and student_result #>> ''{error,code}'' = ''SESSION_ALREADY_EXISTS'' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;

  return student_result;
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      ''INVALID_REQUEST'', ''A supplied identifier, number, or timestamp is invalid.'', 400,
      ''Refresh the page, correct the highlighted value, and try again.''
    );
  when unique_violation then
    return examination_room_v1.api_error(
      ''PERSISTENCE_CONFLICT'', ''A newer or duplicate record already exists for this action.'', 409,
      ''Refresh the current server-backed state, then repeat the action only if still needed.''
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      ''PERSISTENCE_STATE_INVALID'', ''The action does not match the current immutable examination state.'', 409,
      ''Refresh the examination and retry from the latest saved state.''
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      ''IMMUTABLE_RECORD_SEALED'', ''That evidence record is already sealed and cannot be changed.'', 409,
      ''Refresh the view and create a new revision instead of overwriting sealed evidence.''
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      ''RETRY_REQUIRED'', ''Another examination action completed at the same time.'', 409,
      ''Refresh the current state and retry the action once.''
    );
  when others then
    return examination_room_v1.api_error(
      ''PERSISTENCE_INTERNAL_ERROR'', ''The database could not complete the examination action safely.'', 500,
      ''Your prior server-backed work is preserved. Try again; if it continues, contact support.''
    );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_professor(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  actor_is_admin boolean;
  actor_name text;
  actor_email text;
  exam_id uuid;
  exam_owner_id uuid;
  version_id uuid;
  version_number integer;
  notice_id uuid;
  request_hash text;
  requested_at timestamptz;
  exam_payload jsonb;
  draft_payload jsonb;
  controls_payload jsonb;
  publication_bundle jsonb;
  publication_hash text;
  response jsonb;
  replay jsonb;
  roster_item jsonb;
  student_identity_id uuid;
  roster_row_id uuid;
  use_anonymous_grading boolean;
  question_count integer;
  roster_count integer;
  submission_id uuid;
  student_session_id uuid;
  exam_version_id uuid;
  grading_manifest jsonb;
  release_manifest jsonb;
  expected_result jsonb;
  release_item jsonb;
  score_item jsonb;
  grade_revision_id uuid;
  grade_revision_number integer;
  question_id uuid;
  score_count integer;
  distinct_score_count integer;
  total_score numeric(12, 2);
  maximum_score numeric(12, 2);
  event_time timestamptz;
  room_activation_status text;
begin
  actor_is_admin := examination_room_v1.owner_authorized(p_actor_user_id);

  select
    coalesce(
      nullif(btrim(membership.display_name), ''''),
      nullif(btrim(profile.display_name), ''''),
      nullif(btrim(auth_user.raw_user_meta_data ->> ''full_name''), ''''),
      nullif(btrim(auth_user.raw_user_meta_data ->> ''name''), ''''),
      nullif(pg_catalog.split_part(lower(auth_user.email), ''@'', 1), ''''),
      ''Examination creator''
    ),
    coalesce(membership.email_normalized, lower(auth_user.email))
  into actor_name, actor_email
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  left join lateral (
    select row_value.display_name, row_value.email_normalized
    from examination_room_v1.staff_memberships row_value
    where row_value.institution_id = p_institution_id
      and row_value.user_id = p_actor_user_id
      and row_value.membership_status = ''active''
    order by (row_value.staff_role = ''admin'') desc, row_value.granted_at desc
    limit 1
  ) membership on true
  where auth_user.id = p_actor_user_id;

  if p_operation = ''session'' then
    select jsonb_build_object(
      ''ok'', true,
      ''professor'', jsonb_build_object(
        ''id'', p_actor_user_id,
        ''authorized'', true,
        ''displayName'', coalesce(actor_name, ''Professor''),
        ''email'', actor_email,
        ''institutionId'', p_institution_id,
        ''adminTesting'', actor_is_admin
      ),
      ''exam'', coalesce(exams.items -> 0, ''null''::jsonb),
      ''exams'', exams.items
    )
    into response
    from lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          ''id'', e.id,
          ''title'', e.title,
          ''status'', e.status,
          ''anonymousGrading'', e.anonymous_grading,
          ''currentVersionId'', e.current_published_version_id,
          ''admissionMode'', e.admission_mode,
          ''allowedEmails'', to_jsonb(e.allowed_emails),
          ''activation'', (
            select jsonb_build_object(
              ''id'', activation.id,
              ''status'', activation.activation_status,
              ''opensAt'', activation.opens_at,
              ''closesAt'', activation.closes_at,
              ''expiresAt'', activation.closes_at,
              ''maxSessions'', activation.max_sessions,
              ''createdAt'', activation.created_at
            )
            from examination_room_v1.room_activations activation
            where activation.exam_id = e.id
            order by activation.created_at desc, activation.id desc
            limit 1
          ),
          ''updatedAt'', e.updated_at
        ) order by e.updated_at desc
      ), ''[]''::jsonb) as items
      from examination_room_v1.exams e
      where e.institution_id = p_institution_id
        and (actor_is_admin or e.owner_user_id = p_actor_user_id)
    ) exams;
    return response;
  end if;

  if p_operation in (''exam'', ''monitor'', ''grading'', ''grading_context'') then
    exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
  end if;

  if p_operation = ''release_context'' then
    exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
  end if;

  if p_operation in (''exam'', ''monitor'', ''grading'', ''grading_context'', ''release_context'', ''open_room'', ''close_room'', ''save_grade'', ''release_results'') then
    if exam_id is null then
      exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id;

    if exam_owner_id is null then
      return examination_room_v1.api_error(
        ''EXAM_NOT_FOUND'', ''The examination does not exist in this institution.'', 404,
        ''Return to the Examination Room list and choose an available examination.''
      );
    end if;

    if not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        ''FORBIDDEN'', ''Only the examination owner or an administrator may access this examination.'', 403,
        ''Choose an examination assigned to your account.''
      );
    end if;
  end if;

  if p_operation = ''exam'' then
    select coalesce(
      (
        select v.id
        from examination_room_v1.exam_versions v
        where v.exam_id = exam_id
        order by (v.publication_status = ''building'') desc, v.version_number desc
        limit 1
      ),
      e.current_published_version_id
    )
    into version_id
    from examination_room_v1.exams e
    where e.id = exam_id;

    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', e.id,
        ''examId'', e.id,
        ''title'', e.title,
        ''description'', e.description,
        ''status'', e.status,
        ''anonymousGrading'', e.anonymous_grading,
        ''admissionMode'', e.admission_mode,
        ''allowedEmails'', to_jsonb(e.allowed_emails),
        ''currentPublishedVersionId'', e.current_published_version_id,
        ''versionId'', v.id,
        ''version'', v.version_number,
        ''publicationStatus'', v.publication_status,
        ''instructions'', v.instructions,
        ''durationMinutes'', v.duration_seconds / 60,
        ''controls'', v.controls,
        ''questions'', coalesce(q.items, ''[]''::jsonb),
        ''roster'', coalesce(r.items, ''[]''::jsonb)
      ),
      ''publicationManifest'', case when v.publication_status = ''published'' then v.publication_manifest else null end
    )
    into response
    from examination_room_v1.exams e
    left join examination_room_v1.exam_versions v on v.id = version_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          ''questionNumber'', q.position,
          ''questionKey'', q.question_key,
          ''questionKind'', q.question_kind,
          ''type'', coalesce(q.configuration ->> ''type'', replace(q.question_kind, ''_'', ''-'')),
          ''prompt'', q.prompt,
          ''points'', q.points,
          ''gradingGuidance'', coalesce(q.configuration ->> ''gradingGuidance'', ''''),
          ''wordLimit'', q.configuration -> ''wordLimit'',
          ''choices'', coalesce(q.configuration -> ''choices'', ''[]''::jsonb),
          ''correctOptionIndex'', q.configuration -> ''correctOptionIndex'',
          ''acceptedAnswers'', coalesce(q.configuration -> ''acceptedAnswers'', ''[]''::jsonb)
        ) order by q.position
      ) as items
      from examination_room_v1.questions q
      where q.exam_version_id = v.id
    ) q on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          ''id'', er.id,
          ''fullName'', si.full_name,
          ''studentNumber'', si.external_student_id,
          ''email'', si.email_normalized,
          ''yearLevel'', er.accommodations ->> ''yearLevel'',
          ''subject'', er.accommodations ->> ''subject'',
          ''extraMinutes'', coalesce((er.accommodations ->> ''extraMinutes'')::integer, 0),
          ''status'', er.roster_status,
          ''gradingAlias'', er.grading_alias
        ) order by si.full_name
      ) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      where er.exam_id = e.id
    ) r on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''monitor'' then
    select jsonb_build_object(
      ''ok'', true,
      ''examId'', e.id,
      ''title'', e.title,
      ''status'', e.status,
      ''activation'', a.item,
      ''students'', coalesce(s.items, ''[]''::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        ''id'', ra.id,
        ''status'', ra.activation_status,
        ''opensAt'', ra.opens_at,
        ''closesAt'', ra.closes_at,
        ''maxSessions'', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        ''sessionId'', ss.id,
        ''fullName'', si.full_name,
        ''studentNumber'', si.external_student_id,
        ''gradingAlias'', case when e.anonymous_grading then null else er.grading_alias end,
        ''status'', ss.session_status,
        ''startedAt'', ss.started_at,
        ''lastHeartbeatAt'', ss.last_heartbeat_at,
        ''currentQuestion'', ss.session_metadata -> ''currentQuestion'',
        ''connected'', coalesce((ss.session_metadata ->> ''connected'')::boolean, false),
        ''incidentCount'', (select count(*) from examination_room_v1.proctoring_incidents pi where pi.session_id = ss.id),
        ''submitted'', exists (select 1 from examination_room_v1.submissions sub where sub.session_id = ss.id)
      ) order by si.full_name) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join examination_room_v1.student_sessions ss on ss.roster_id = er.id
      where er.exam_id = e.id
        and ss.id is not null
    ) s on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''grading'' then
    select jsonb_build_object(
      ''ok'', true,
      ''examId'', e.id,
      ''title'', e.title,
      ''students'', coalesce(g.items, ''[]''::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        ''sessionId'', case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end,
        ''submissionId'', sub.id,
        ''displayName'', case when e.anonymous_grading then er.grading_alias else si.full_name end,
        ''studentNumber'', case when e.anonymous_grading then null else si.external_student_id end,
        ''submittedAt'', sub.received_at,
        ''submissionStatus'', sub.submission_status,
        ''latestGrade'', gr.grading_manifest,
        ''released'', exists (
          select 1 from examination_room_v1.result_releases rr
          where rr.submission_id = sub.id
            and rr.release_action = ''release''
            and not exists (
              select 1 from examination_room_v1.result_releases rv
              where rv.supersedes_release_id = rr.id and rv.release_action = ''revoke''
            )
        )
      ) order by sub.received_at) as items
      from examination_room_v1.submissions sub
      join examination_room_v1.student_sessions ss on ss.id = sub.session_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join lateral (
        select grades.grading_manifest
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = e.id
    ) g on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''grading_context'' then
    select
      sub.id,
      sub.exam_version_id,
      examination_room_v1.grader_safe_submission_manifest(
        sub.submission_manifest,
        e.anonymous_grading,
        er.grading_alias,
        examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
      ) || jsonb_build_object(''idempotencyKey'', sub.idempotency_key_hash)
    into submission_id, exam_version_id, draft_payload
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    join examination_room_v1.exam_roster er on er.id = ss.roster_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> ''sessionId'')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> ''sessionId'')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id;

    if submission_id is null then
      return examination_room_v1.api_error(
        ''SUBMISSION_NOT_FOUND'', ''The student has not submitted this examination.'', 409,
        ''Refresh grading after the student submits.''
      );
    end if;

    select q.position
    into question_count
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and (
        q.question_key = p_payload ->> ''questionReference''
        or q.position::text = p_payload ->> ''questionReference''
        or ''q-'' || q.position::text = p_payload ->> ''questionReference''
      );

    if question_count is null then
      return examination_room_v1.api_error(
        ''QUESTION_NOT_FOUND'', ''That question is not part of the submitted examination version.'', 409,
        ''Refresh grading and choose a listed question.''
      );
    end if;

    select jsonb_build_object(
      ''ok'', true,
      ''publicationManifest'', v.publication_manifest,
      ''submissionManifest'', draft_payload,
      ''questionNumber'', question_count,
      ''scores'', coalesce(gr.scores, ''[]''::jsonb),
      ''nextRevision'', coalesce(gr.revision_number, 0) + 1,
      ''overallFeedback'', coalesce(gr.general_feedback, '''')
    )
    into response
    from examination_room_v1.exam_versions v
    left join lateral (
      select
        grades.revision_number,
        grades.general_feedback,
        (
          select jsonb_agg(jsonb_build_object(
            ''questionNumber'', q.position,
            ''pointsAwarded'', item.score,
            ''feedback'', coalesce(item.feedback, '''')
          ) order by q.position)
          from examination_room_v1.grade_revision_items item
          join examination_room_v1.questions q on q.id = item.question_id
          where item.grade_revision_id = grades.id
        ) as scores
      from examination_room_v1.grade_revisions grades
      where grades.submission_id = submission_id
      order by grades.revision_number desc
      limit 1
    ) gr on true
    where v.id = exam_version_id;
    return response;
  end if;

  if p_operation = ''release_context'' then
    if jsonb_typeof(p_payload -> ''sessionIds'') <> ''array''
       or jsonb_array_length(p_payload -> ''sessionIds'') = 0 then
      return examination_room_v1.api_error(
        ''RESULT_RECIPIENT_REQUIRED'', ''Select at least one submitted student.'', 400,
        ''Select the intended students, then release again.''
      );
    end if;

    select jsonb_build_object(''ok'', true, ''entries'', coalesce(jsonb_agg(entry.item order by entry.session_id), ''[]''::jsonb))
    into response
    from (
      select
        case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end as session_id,
        jsonb_build_object(
          ''sessionId'', case
            when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
            else ss.id
          end,
          ''nextRevision'', coalesce(gr.revision_number, 0) + 1,
          ''submissionManifest'', examination_room_v1.grader_safe_submission_manifest(
            sub.submission_manifest,
            e.anonymous_grading,
            er.grading_alias,
            examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          ) || jsonb_build_object(''idempotencyKey'', sub.idempotency_key_hash),
          ''scores'', coalesce(gr.scores, ''[]''::jsonb),
          ''overallFeedback'', coalesce(gr.general_feedback, '''')
        ) as item
      from jsonb_array_elements_text(p_payload -> ''sessionIds'') requested(session_id)
      join examination_room_v1.student_sessions ss on true
      join examination_room_v1.submissions sub on sub.session_id = ss.id and sub.submission_status = ''accepted''
      join examination_room_v1.exams e on e.id = ss.exam_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      left join lateral (
        select
          grades.revision_number,
          grades.general_feedback,
          (
            select jsonb_agg(jsonb_build_object(
              ''questionNumber'', q.position,
              ''pointsAwarded'', item.score,
              ''feedback'', coalesce(item.feedback, '''')
            ) order by q.position)
            from examination_room_v1.grade_revision_items item
            join examination_room_v1.questions q on q.id = item.question_id
            where item.grade_revision_id = grades.id
          ) as scores
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and (
          (not e.anonymous_grading and ss.id = requested.session_id::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = requested.session_id::uuid
          )
        )
    ) entry;

    if jsonb_array_length(response -> ''entries'') <> jsonb_array_length(p_payload -> ''sessionIds'') then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''One or more selected students does not have an accepted submission.'', 409,
        ''Refresh grading, review the selected students, then release again.''
      );
    end if;
    return response;
  end if;

  if p_operation in (''save_draft'', ''publish'') then
    request_hash := p_payload ->> ''requestHash'';
    requested_at := coalesce((p_payload ->> ''requestedAt'')::timestamptz, clock_timestamp());
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.'' || p_operation);
    if replay is not null then
      if p_operation = ''publish'' and replay ->> ''ok'' = ''true'' then
        select v.publication_manifest
        into publication_bundle
        from examination_room_v1.exam_versions v
        where v.id = (replay ->> ''versionId'')::uuid
          and v.exam_id = (replay ->> ''examId'')::uuid
          and v.institution_id = p_institution_id
          and v.publication_status = ''published'';
        replay := replay || jsonb_build_object(''publicationManifest'', publication_bundle);
      end if;
      return replay;
    end if;

    exam_payload := p_payload -> ''exam'';
    draft_payload := p_payload -> ''draft'';
    if jsonb_typeof(exam_payload) <> ''object'' or jsonb_typeof(draft_payload) <> ''object'' then
      return examination_room_v1.api_error(
        ''EXAM_PAYLOAD_INVALID'', ''The normalized examination draft is missing.'', 400,
        ''Refresh the creator and save the examination again.''
      );
    end if;

    exam_id := nullif(exam_payload ->> ''examId'', '''')::uuid;
    if exam_id is null then
      exam_id := gen_random_uuid();
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id
    for update;

    if exam_owner_id is not null and not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        ''FORBIDDEN'', ''Only the examination owner or an administrator may change this examination.'', 403,
        ''Choose an examination assigned to your account.''
      );
    end if;

    select n.id
    into notice_id
    from examination_room_v1.privacy_notice_versions n
    where n.institution_id = p_institution_id
      and n.notice_code = lower(exam_payload ->> ''privacyNoticeVersion'')
      and n.effective_at <= requested_at
    order by n.version_number desc
    limit 1;

    if notice_id is null then
      return examination_room_v1.api_error(
        ''PRIVACY_NOTICE_NOT_CONFIGURED'',
        ''The selected privacy notice has not been approved for this institution.'',
        409,
        ''Ask the administrator to publish the exact privacy notice version, then save or publish again.''
      );
    end if;

    if p_operation = ''publish''
       and jsonb_array_length(coalesce(exam_payload -> ''questions'', ''[]''::jsonb)) = 0 then
      return examination_room_v1.api_error(
        ''PUBLICATION_NOT_READY'', ''Publishing requires at least one question.'', 409,
        ''Add at least one complete question, then publish again.''
      );
    end if;
    if p_operation = ''publish''
       and coalesce(exam_payload ->> ''admissionMode'', ''key_only'') = ''email_allowlist''
       and cardinality(examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')) = 0 then
      return examination_room_v1.api_error(
        ''ALLOWED_EMAIL_REQUIRED'', ''Add at least one email or use key-only admission.'', 409,
        ''Add one email per line, or choose Anyone with the key, then publish again.''
      );
    end if;

    use_anonymous_grading := coalesce(exam_payload ->> ''identityMode'', ''real_names'') = ''anonymous_grading'';
    controls_payload := jsonb_build_object(
      ''subject'', coalesce(exam_payload ->> ''subject'', ''''),
      ''yearLevel'', coalesce(exam_payload ->> ''yearLevel'', ''''),
      ''jurisdiction'', coalesce(exam_payload ->> ''jurisdiction'', ''Philippines''),
      ''startsAt'', exam_payload -> ''startsAt'',
      ''lateSubmissions'', coalesce(exam_payload ->> ''lateSubmissions'', ''not_allowed''),
      ''navigation'', coalesce(exam_payload ->> ''navigation'', ''free''),
      ''identityMode'', coalesce(exam_payload ->> ''identityMode'', ''real_names''),
      ''integrityTier'', coalesce(exam_payload ->> ''integrityTier'', ''standard''),
      ''cameraRequired'', coalesce((exam_payload ->> ''cameraRequired'')::boolean, false),
      ''microphoneRequired'', coalesce((exam_payload ->> ''microphoneRequired'')::boolean, false),
      ''privacyNoticeVersion'', lower(exam_payload ->> ''privacyNoticeVersion''),
      ''privacyController'', coalesce(exam_payload ->> ''privacyController'', ''''),
      ''retentionSummary'', coalesce(exam_payload ->> ''retentionSummary'', ''''),
      ''sourceFileName'', exam_payload -> ''sourceFileName'',
      ''sourceFileSize'', exam_payload -> ''sourceFileSize'',
      ''admissionMode'', coalesce(exam_payload ->> ''admissionMode'', ''key_only'')
    );

    if exam_owner_id is null then
      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading,
        admission_mode, allowed_emails
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> ''title'',
        nullif(exam_payload ->> ''instructions'', ''''),
        ''draft'',
        use_anonymous_grading,
        coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
        examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      );
    else
      update examination_room_v1.exams e
      set title = exam_payload ->> ''title'',
          description = nullif(exam_payload ->> ''instructions'', ''''),
          admission_mode = coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
          allowed_emails = examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      where e.id = exam_id;
    end if;

    select v.id, v.version_number
    into version_id, version_number
    from examination_room_v1.exam_versions v
    where v.exam_id = exam_id
      and v.publication_status = ''building''
    order by v.version_number desc
    limit 1
    for update;

    if version_id is null then
      select coalesce(max(v.version_number), 0) + 1
      into version_number
      from examination_room_v1.exam_versions v
      where v.exam_id = exam_id;
      version_id := gen_random_uuid();
      insert into examination_room_v1.exam_versions (
        id, exam_id, institution_id, version_number, title_snapshot, instructions,
        duration_seconds, anonymous_grading_snapshot, privacy_notice_version_id,
        controls, content_sha256, admission_mode_snapshot, allowed_emails_snapshot
      ) values (
        version_id,
        exam_id,
        p_institution_id,
        version_number,
        exam_payload ->> ''title'',
        coalesce(exam_payload ->> ''instructions'', ''''),
        greatest(60, least(86400, coalesce((exam_payload ->> ''durationMinutes'')::integer, 120) * 60)),
        use_anonymous_grading,
        notice_id,
        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload),
        coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
        examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      );
    else
      update examination_room_v1.exam_versions v
      set title_snapshot = exam_payload ->> ''title'',
          instructions = coalesce(exam_payload ->> ''instructions'', ''''),
          duration_seconds = greatest(60, least(86400, coalesce((exam_payload ->> ''durationMinutes'')::integer, 120) * 60)),
          anonymous_grading_snapshot = use_anonymous_grading,
          privacy_notice_version_id = notice_id,
          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload),
          admission_mode_snapshot = coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
          allowed_emails_snapshot = examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      where v.id = version_id;
      delete from examination_room_v1.questions q where q.exam_version_id = version_id;
    end if;

    insert into examination_room_v1.questions (
      exam_version_id, position, question_key, question_kind, prompt, points, configuration, content_sha256
    )
    select
      version_id,
      coalesce((item.value ->> ''questionNumber'')::integer, item.ordinality::integer),
      item.value ->> ''questionKey'',
      item.value ->> ''questionKind'',
      item.value ->> ''prompt'',
      coalesce((item.value ->> ''points'')::numeric, 0),
      jsonb_build_object(
        ''type'', coalesce(item.value ->> ''type'', replace(item.value ->> ''questionKind'', ''_'', ''-'')),
        ''gradingGuidance'', coalesce(item.value ->> ''gradingGuidance'', ''''),
        ''wordLimit'', item.value -> ''wordLimit'',
        ''choices'', coalesce(item.value -> ''choices'', ''[]''::jsonb),
        ''correctOptionIndex'', item.value -> ''correctOptionIndex'',
        ''acceptedAnswers'', coalesce(item.value -> ''acceptedAnswers'', ''[]''::jsonb)
      ),
      examination_room_v1.jsonb_sha256(item.value)
    from jsonb_array_elements(coalesce(exam_payload -> ''questions'', ''[]''::jsonb)) with ordinality item(value, ordinality);

    update examination_room_v1.exam_roster er
    set roster_status = ''withdrawn''
    from examination_room_v1.student_identities si
    where er.exam_id = exam_id
      and er.student_identity_id = si.id
      and er.roster_status in (''invited'', ''eligible'')
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(exam_payload -> ''roster'', ''[]''::jsonb)) incoming(value)
        where upper(incoming.value ->> ''studentNumber'') = si.external_student_id
      );

    for roster_item in
      select value from jsonb_array_elements(coalesce(exam_payload -> ''roster'', ''[]''::jsonb))
    loop
      insert into examination_room_v1.student_identities (
        institution_id, external_student_id, full_name, email_normalized,
        identity_status, verified_at, verification_method
      ) values (
        p_institution_id,
        upper(roster_item ->> ''studentNumber''),
        roster_item ->> ''fullName'',
        lower(roster_item ->> ''email''),
        ''active'',
        requested_at,
        ''registrar_import''
      )
      on conflict (institution_id, external_student_id) do update
      set full_name = excluded.full_name,
          email_normalized = excluded.email_normalized,
          identity_status = ''active'',
          verified_at = excluded.verified_at,
          verification_method = excluded.verification_method
      returning id into student_identity_id;

      roster_row_id := gen_random_uuid();
      insert into examination_room_v1.exam_roster (
        id, exam_id, institution_id, student_identity_id, grading_alias,
        roster_status, accommodations, added_by_user_id
      ) values (
        roster_row_id,
        exam_id,
        p_institution_id,
        student_identity_id,
        case when use_anonymous_grading then ''CAND-'' || upper(substr(replace(roster_row_id::text, ''-'', ''''), 1, 8)) else null end,
        ''eligible'',
        jsonb_build_object(
          ''clientId'', roster_item -> ''clientId'',
          ''subject'', roster_item ->> ''subject'',
          ''yearLevel'', roster_item ->> ''yearLevel'',
          ''extraMinutes'', coalesce((roster_item ->> ''extraMinutes'')::integer, 0)
        ),
        p_actor_user_id
      )
      on conflict on constraint exam_roster_exam_student_key do update
      set roster_status = ''eligible'',
          grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
          accommodations = excluded.accommodations;
    end loop;

    select count(*) into question_count
    from examination_room_v1.questions q where q.exam_version_id = version_id;
    select count(*) into roster_count
    from examination_room_v1.exam_roster er
    where er.exam_id = exam_id and er.roster_status in (''invited'', ''eligible'');

    if p_operation = ''publish'' then
      if question_count = 0 then
        return examination_room_v1.api_error(
          ''PUBLICATION_NOT_READY'', ''Publishing requires at least one question.'', 409,
          ''Add at least one complete question, then publish again.''
        );
      end if;

      publication_bundle := examination_room_v1.build_publication_manifest(version_id, requested_at);
      publication_hash := examination_room_v1.jsonb_sha256(publication_bundle);
      update examination_room_v1.exam_versions v
      set publication_manifest = publication_bundle,
          content_sha256 = publication_hash,
          publication_status = ''published'',
          published_by_user_id = p_actor_user_id,
          published_at = requested_at
      where v.id = version_id;

      update examination_room_v1.exams e
      set status = ''published'',
          anonymous_grading = use_anonymous_grading,
          current_published_version_id = version_id,
          closed_at = null
      where e.id = exam_id;

      insert into examination_room_v1.recovery_snapshots (
        exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
        record_count, snapshot_status, created_by_user_id, retention_until
      ) values (
        exam_id,
        version_id,
        examination_room_v1.next_snapshot_sequence(exam_id),
        ''exam_definition'',
        request_hash,
        question_count + roster_count,
        ''pending'',
        p_actor_user_id,
        requested_at + interval ''365 days''
      );

      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''versionId'', version_id,
        ''version'', version_number,
        ''status'', ''published'',
        ''publicationHash'', publication_hash,
        ''publicationManifest'', publication_bundle
      );
    else
      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''versionId'', version_id,
        ''version'', version_number,
        ''status'', ''draft'',
        ''questionCount'', question_count,
        ''rosterCount'', roster_count
      );
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.'' || p_operation, ''exam'', exam_id, request_hash,
      requested_at, response, null
    );
    return response;
  end if;

  if p_operation in (''open_room'', ''close_room'') then
    request_hash := p_payload ->> ''requestHash'';
    event_time := coalesce(
      (p_payload ->> case when p_operation = ''open_room'' then ''openedAt'' else ''closedAt'' end)::timestamptz,
      clock_timestamp()
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.'' || p_operation);
    if replay is not null then return replay; end if;

    if p_operation = ''open_room'' then
      select a.id, a.activation_status
      into version_id, room_activation_status
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in (''scheduled'', ''open'')
        and a.closes_at > event_time
      order by (a.activation_status = ''scheduled'') desc, a.created_at desc, a.id desc
      limit 1
      for update;

      if version_id is null then
        return examination_room_v1.api_error(
          ''ROOM_ACTIVATION_NOT_FOUND'', ''The administrator has not approved and generated a student key yet.'', 409,
          ''Request a key, then wait for the administrator to approve this examination.''
        );
      end if;

      if room_activation_status = ''scheduled'' then
        update examination_room_v1.room_activations a
        set activation_status = ''open'',
            opens_at = least(a.opens_at, event_time, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where a.id = version_id;
      end if;
      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''activationId'', version_id,
        ''activation'', jsonb_build_object(''id'', version_id, ''status'', ''open''),
        ''status'', ''open''
      );
    else
      update examination_room_v1.room_activations a
      set activation_status = ''closed'',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = ''Professor closed the examination room.''
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in (''scheduled'', ''open'');

      update examination_room_v1.student_sessions s
      set session_status = ''expired'', ended_at = coalesce(s.ended_at, event_time)
      where s.exam_id = exam_id
        and s.institution_id = p_institution_id
        and s.session_status in (''created'', ''active'');

      update examination_room_v1.exams e
      set status = ''closed'', closed_at = event_time
      where e.id = exam_id and e.status in (''published'', ''closed'');
      response := jsonb_build_object(''ok'', true, ''examId'', exam_id, ''status'', ''closed'');
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.'' || p_operation, ''exam'', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = ''save_grade'' then
    request_hash := p_payload ->> ''requestHash'';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.save_grade'');
    if replay is not null then return replay; end if;
    grading_manifest := p_payload -> ''gradingManifest'';

    select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash'', ss.id
    into submission_id, exam_version_id, publication_hash, student_session_id
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> ''sessionId'')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> ''sessionId'')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id
      and sub.submission_status = ''accepted''
    for update of sub;

    if submission_id is null then
      return examination_room_v1.api_error(
        ''SUBMISSION_NOT_FOUND'', ''The student has no accepted submission to grade.'', 409,
        ''Refresh grading after the student submits.''
      );
    end if;

    if jsonb_typeof(grading_manifest) is distinct from ''object''
       or coalesce(grading_manifest ->> ''schemaVersion'', '''') <> ''examination-room/grading/v1''
       or grading_manifest ->> ''submissionId'' is null
       or (grading_manifest ->> ''submissionId'')::uuid <> submission_id
       or grading_manifest ->> ''publicationHash'' <> publication_hash
       or grading_manifest ->> ''graderId'' is null
       or (grading_manifest ->> ''graderId'')::uuid <> p_actor_user_id
       or coalesce(grading_manifest ->> ''status'', '''') <> ''draft'' then
      return examination_room_v1.api_error(
        ''GRADING_MANIFEST_INVALID'', ''The grading evidence is not bound to this submission and signed-in professor.'', 409,
        ''Refresh grading, review the scores, then save again.''
      );
    end if;

    grade_revision_number := (grading_manifest ->> ''revision'')::integer;
    if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
      return examination_room_v1.api_error(
        ''GRADE_REVISION_CONFLICT'', ''A newer grading revision already exists.'', 409,
        ''Refresh the grading view, review the latest scores, then save again.''
      );
    end if;

    score_count := jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb));
    total_score := coalesce((grading_manifest ->> ''totalPointsAwarded'')::numeric, 0);
    maximum_score := coalesce((grading_manifest ->> ''maxPoints'')::numeric, 0);
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> ''pointsAwarded'')::numeric), 0),
      coalesce(sum(q.points), 0)
    into question_count, distinct_score_count, total_score, maximum_score
    from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> ''questionNumber'')::integer
     and q.question_key = score.value ->> ''questionKey''
     and q.points = (score.value ->> ''maxPoints'')::numeric
    where (score.value ->> ''pointsAwarded'')::numeric between 0 and q.points;

    if question_count <> score_count
       or distinct_score_count <> score_count
       or coalesce((grading_manifest ->> ''scoreCount'')::integer, -1) <> score_count
       or total_score <> coalesce((grading_manifest ->> ''totalPointsAwarded'')::numeric, 0)
       or maximum_score <> coalesce((grading_manifest ->> ''maxPoints'')::numeric, 0) then
      return examination_room_v1.api_error(
        ''GRADING_MANIFEST_INVALID'', ''The grading manifest does not match this examination version.'', 409,
        ''Refresh grading, review the scores, then save again.''
      );
    end if;
    grade_revision_id := (grading_manifest ->> ''revisionId'')::uuid;
    insert into examination_room_v1.grade_revisions (
      id, submission_id, exam_version_id, revision_number, client_revision_id,
      manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
      item_count, total_score, maximum_score, general_feedback
    ) values (
      grade_revision_id,
      submission_id,
      exam_version_id,
      grade_revision_number,
      (p_payload ->> ''clientRevisionId'')::uuid,
      p_payload ->> ''gradingHash'',
      grading_manifest,
      p_actor_user_id,
      ''online'',
      grading_manifest ->> ''status'',
      score_count,
      total_score,
      maximum_score,
      grading_manifest ->> ''overallFeedback''
    );

    for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb))
    loop
      select q.id into question_id
      from examination_room_v1.questions q
      where q.exam_version_id = exam_version_id
        and q.position = (score_item ->> ''questionNumber'')::integer
        and q.question_key = score_item ->> ''questionKey'';
      insert into examination_room_v1.grade_revision_items (
        grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
      ) values (
        grade_revision_id,
        exam_version_id,
        question_id,
        (score_item ->> ''pointsAwarded'')::numeric,
        (score_item ->> ''maxPoints'')::numeric,
        score_item ->> ''feedback''
      );
    end loop;

    response := jsonb_build_object(
      ''ok'', true,
      ''revision'', jsonb_build_object(
        ''id'', grade_revision_id,
        ''revision'', grade_revision_number,
        ''status'', grading_manifest ->> ''status'',
        ''totalPointsAwarded'', total_score,
        ''maxPoints'', maximum_score
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, student_session_id, p_actor_user_id, ''professor'',
      ''professor.save_grade'', ''grade_revision'', grade_revision_id, request_hash,
      clock_timestamp(), response, (p_payload ->> ''clientRevisionId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''release_results'' then
    request_hash := p_payload ->> ''requestHash'';
    perform set_config(''examination_room_v1.release_batch_request_hash'', request_hash, true);
    perform set_config(
      ''examination_room_v1.release_batch_count'',
      coalesce(jsonb_array_length(p_payload -> ''releases''), 0)::text,
      true
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.release_results'');
    if replay is not null then return replay; end if;

    if jsonb_typeof(p_payload -> ''releases'') <> ''array''
       or jsonb_typeof(p_payload -> ''sessionIds'') <> ''array''
       or jsonb_array_length(p_payload -> ''releases'') = 0
       or jsonb_array_length(p_payload -> ''releases'') <> jsonb_array_length(p_payload -> ''sessionIds'')
       or (
         select count(distinct item.value ->> ''sessionId'')
         from jsonb_array_elements(p_payload -> ''releases'') item(value)
       ) <> jsonb_array_length(p_payload -> ''releases'')
       or exists (
         select 1
         from jsonb_array_elements(p_payload -> ''releases'') item(value)
         where not exists (
           select 1
           from jsonb_array_elements_text(p_payload -> ''sessionIds'') selected(value)
           where selected.value = item.value ->> ''sessionId''
         )
       ) then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''The release set does not match the selected students.'', 409,
        ''Refresh grading, review the recipient list, then release again.''
      );
    end if;

    -- Validate and lock the complete batch before the first append-only write.
    for release_item in select value from jsonb_array_elements(p_payload -> ''releases'')
    loop
      grading_manifest := release_item -> ''gradingManifest'';
      release_manifest := release_item -> ''releaseManifest'';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash''
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> ''sessionId'')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> ''sessionId'')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = ''accepted''
      for update of sub;

      if submission_id is null
         or coalesce(grading_manifest ->> ''schemaVersion'', '''') <> ''examination-room/grading/v1''
         or coalesce(grading_manifest ->> ''status'', '''') <> ''final''
         or grading_manifest ->> ''submissionId'' is null
         or (grading_manifest ->> ''submissionId'')::uuid <> submission_id
         or grading_manifest ->> ''graderId'' is null
         or (grading_manifest ->> ''graderId'')::uuid <> p_actor_user_id
         or grading_manifest ->> ''publicationHash'' <> publication_hash
         or coalesce(release_manifest ->> ''schemaVersion'', '''') <> ''examination-room/result-release/v1''
         or release_manifest ->> ''submissionId'' is null
         or (release_manifest ->> ''submissionId'')::uuid <> submission_id
         or release_manifest ->> ''publicationHash'' <> publication_hash
         or release_manifest ->> ''selectedRevisionId'' is null
         or (release_manifest ->> ''selectedRevisionId'')::uuid <> (grading_manifest ->> ''revisionId'')::uuid
         or coalesce((release_manifest ->> ''selectedRevision'')::integer, -1) <> (grading_manifest ->> ''revision'')::integer
         or release_manifest ->> ''releasedBy'' is null
         or (release_manifest ->> ''releasedBy'')::uuid <> p_actor_user_id
         or (release_manifest ->> ''releasedAt'')::timestamptz < (grading_manifest ->> ''gradedAt'')::timestamptz then
        return examination_room_v1.api_error(
          ''GRADING_CONTEXT_INVALID'', ''A selected student has invalid release or grading evidence.'', 409,
          ''Refresh grading and review the recipient list.''
        );
      end if;

      grade_revision_number := (grading_manifest ->> ''revision'')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          ''GRADE_REVISION_CONFLICT'', ''A selected submission changed after release preparation.'', 409,
          ''Refresh grading, review the latest scores, then release again.''
        );
      end if;

      score_count := jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb));
      select
        count(*)::integer,
        count(distinct q.id)::integer,
        coalesce(sum((score.value ->> ''pointsAwarded'')::numeric), 0),
        coalesce(sum(q.points), 0)
      into question_count, distinct_score_count, total_score, maximum_score
      from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)) score(value)
      join examination_room_v1.questions q
        on q.exam_version_id = exam_version_id
       and q.position = (score.value ->> ''questionNumber'')::integer
       and q.question_key = score.value ->> ''questionKey''
       and q.points = (score.value ->> ''maxPoints'')::numeric
      where (score.value ->> ''pointsAwarded'')::numeric between 0 and q.points;

      if question_count <> score_count
         or distinct_score_count <> score_count
         or question_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
         or coalesce((grading_manifest ->> ''scoreCount'')::integer, -1) <> score_count
         or total_score <> (grading_manifest ->> ''totalPointsAwarded'')::numeric
         or maximum_score <> (grading_manifest ->> ''maxPoints'')::numeric then
        return examination_room_v1.api_error(
          ''GRADING_INCOMPLETE'', ''Every question must have a valid final score before release.'', 409,
          ''Score every question, review the totals, then release again.''
        );
      end if;

      expected_result := jsonb_build_object(
        ''gradedAt'', grading_manifest -> ''gradedAt'',
        ''scores'', grading_manifest -> ''scores'',
        ''totalPointsAwarded'', grading_manifest -> ''totalPointsAwarded'',
        ''maxPoints'', grading_manifest -> ''maxPoints'',
        ''overallFeedback'', grading_manifest -> ''overallFeedback''
      );
      if release_manifest -> ''result'' is distinct from expected_result then
        return examination_room_v1.api_error(
          ''RESULT_RELEASE_MISMATCH'', ''The student-facing result does not exactly match the final grade revision.'', 409,
          ''Refresh grading, review the final scores, then release again.''
        );
      end if;
    end loop;

    score_count := 0;

    for release_item in select value from jsonb_array_elements(coalesce(p_payload -> ''releases'', ''[]''::jsonb))
    loop
      grading_manifest := release_item -> ''gradingManifest'';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash''
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> ''sessionId'')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> ''sessionId'')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = ''accepted''
      for update of sub;

      if submission_id is null then
        return examination_room_v1.api_error(
          ''GRADING_CONTEXT_INVALID'', ''A selected student has no accepted submission.'', 409,
          ''Refresh grading and review the recipient list.''
        );
      end if;

      grade_revision_number := (grading_manifest ->> ''revision'')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          ''GRADE_REVISION_CONFLICT'', ''A selected submission changed after release preparation.'', 409,
          ''Refresh grading, review the latest scores, then release again.''
        );
      end if;

      grade_revision_id := (grading_manifest ->> ''revisionId'')::uuid;
      insert into examination_room_v1.grade_revisions (
        id, submission_id, exam_version_id, revision_number, client_revision_id,
        manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
        item_count, total_score, maximum_score, general_feedback
      ) values (
        grade_revision_id,
        submission_id,
        exam_version_id,
        grade_revision_number,
        examination_room_v1.uuid_from_hash(release_item ->> ''releaseRequestHash''),
        release_item ->> ''gradingHash'',
        grading_manifest,
        p_actor_user_id,
        ''online'',
        ''final'',
        jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)),
        (grading_manifest ->> ''totalPointsAwarded'')::numeric,
        (grading_manifest ->> ''maxPoints'')::numeric,
        grading_manifest ->> ''overallFeedback''
      );

      for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb))
      loop
        select q.id into question_id
        from examination_room_v1.questions q
        where q.exam_version_id = exam_version_id
          and q.position = (score_item ->> ''questionNumber'')::integer
          and q.question_key = score_item ->> ''questionKey'';
        insert into examination_room_v1.grade_revision_items (
          grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
        ) values (
          grade_revision_id,
          exam_version_id,
          question_id,
          (score_item ->> ''pointsAwarded'')::numeric,
          (score_item ->> ''maxPoints'')::numeric,
          score_item ->> ''feedback''
        );
      end loop;

      insert into examination_room_v1.result_releases (
        id, submission_id, grade_revision_id, release_action, channel,
        idempotency_key_hash, batch_request_hash, manifest_sha256, release_manifest,
        performed_by_user_id, occurred_at
      ) values (
        ((release_item -> ''releaseManifest'') ->> ''releaseId'')::uuid,
        submission_id,
        grade_revision_id,
        ''release'',
        ''student_portal'',
        release_item ->> ''releaseRequestHash'',
        request_hash,
        release_item ->> ''releaseHash'',
        release_item -> ''releaseManifest'',
        p_actor_user_id,
        (((release_item -> ''releaseManifest'') ->> ''releasedAt''))::timestamptz
      );
      score_count := score_count + 1;
    end loop;

    if score_count <> jsonb_array_length(coalesce(p_payload -> ''sessionIds'', ''[]''::jsonb)) then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''The release set does not match the selected students.'', 409,
        ''Refresh grading, review the recipient list, then release again.''
      );
    end if;

    response := jsonb_build_object(''ok'', true, ''released'', score_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.release_results'', ''exam'', exam_id, request_hash,
      clock_timestamp(), response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''The professor operation is not implemented.'', 400,
    ''Refresh Examination Room and try a listed action.''
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_professor_view(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  target_exam examination_room_v1.exams%rowtype;
  response jsonb;
begin
  select exam.* into target_exam
  from examination_room_v1.exams exam
  where exam.id = p_exam_id
    and exam.institution_id = p_institution_id;

  if target_exam.id is null then
    return examination_room_v1.api_error(
      ''EXAM_NOT_FOUND'', ''The examination does not exist in this workspace.'', 404,
      ''Return to the Examination Room list and choose an available examination.''
    );
  end if;
  if target_exam.owner_user_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      ''FORBIDDEN'', ''Only the examination creator or a platform owner may open this examination.'', 403,
      ''Choose an examination created by your signed-in account.''
    );
  end if;

  if p_operation = ''monitor'' then
    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', exam.id,
        ''examId'', exam.id,
        ''title'', exam.title,
        ''description'', exam.description,
        ''status'', exam.status,
        ''anonymousGrading'', exam.anonymous_grading,
        ''currentPublishedVersionId'', exam.current_published_version_id
      ),
      ''activation'', (
        select jsonb_build_object(
          ''id'', activation.id,
          ''status'', activation.activation_status,
          ''opensAt'', activation.opens_at,
          ''closesAt'', activation.closes_at,
          ''expiresAt'', activation.closes_at,
          ''maxSessions'', activation.max_sessions,
          ''createdAt'', activation.created_at
        )
        from examination_room_v1.room_activations activation
        where activation.exam_id = exam.id
        order by activation.created_at desc, activation.id desc
        limit 1
      ),
      ''sessions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', session.id,
          ''sessionId'', session.id,
          ''examId'', session.exam_id,
          ''fullName'', identity.full_name,
          ''studentNumber'', identity.external_student_id,
          ''yearLevel'', roster.accommodations ->> ''yearLevel'',
          ''subject'', roster.accommodations ->> ''subject'',
          ''status'', session.session_status,
          ''connected'', coalesce((session.session_metadata ->> ''connected'')::boolean, false),
          ''currentQuestion'', session.session_metadata -> ''currentQuestion'',
          ''consentVersion'', (
            select notice.notice_code
            from examination_room_v1.privacy_acceptances acceptance
            join examination_room_v1.privacy_notice_versions notice
              on notice.id = acceptance.notice_version_id
            where acceptance.session_id = session.id
              and acceptance.decision = ''accepted''
            order by acceptance.recorded_at desc, acceptance.id desc
            limit 1
          ),
          ''startedAt'', session.started_at,
          ''lastSeenAt'', coalesce(session.last_heartbeat_at, session.updated_at, session.started_at),
          ''endedAt'', session.ended_at
        ) order by identity.full_name, session.started_at, session.id)
        from examination_room_v1.student_sessions session
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''submissions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', submission.id,
          ''submissionId'', submission.id,
          ''sessionId'', submission.session_id,
          ''status'', submission.submission_status,
          ''submissionStatus'', submission.submission_status,
          ''submittedAt'', submission.received_at,
          ''receivedAt'', submission.received_at,
          ''receiptCode'', receipt.receipt_code,
          ''receiptId'', receipt.id,
          ''answerCount'', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''incidents'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', incident.id,
          ''sessionId'', incident.session_id,
          ''type'', incident.incident_kind,
          ''severity'', incident.severity,
          ''occurredAt'', incident.occurred_at,
          ''durationMs'', incident.duration_ms,
          ''details'', incident.details,
          ''reviewStatus'', incident.review_status
        ) order by incident.occurred_at, incident.id)
        from examination_room_v1.proctoring_incidents incident
        join examination_room_v1.student_sessions session on session.id = incident.session_id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''generatedAt'', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  if p_operation = ''grading'' then
    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', exam.id,
        ''examId'', exam.id,
        ''title'', exam.title,
        ''description'', exam.description,
        ''status'', exam.status,
        ''anonymousGrading'', exam.anonymous_grading,
        ''currentPublishedVersionId'', exam.current_published_version_id
      ),
      ''sessions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          -- This view is already limited to the exact exam creator or a
          -- Founder/Super Admin. Return both real and grading identities so
          -- the Professor-controlled UI may mask or reveal them at any time.
          ''fullName'', identity.full_name,
          ''studentNumber'', identity.external_student_id,
          ''realFullName'', identity.full_name,
          ''realStudentNumber'', identity.external_student_id,
          ''yearLevel'', roster.accommodations ->> ''yearLevel'',
          ''subject'', roster.accommodations ->> ''subject'',
          ''gradingAlias'', roster.grading_alias,
          ''identityMode'', case when exam.anonymous_grading then ''anonymous_grading'' else ''real_names'' end,
          ''status'', session.session_status,
          ''submittedAt'', submission.received_at
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''submissions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', submission.id,
          ''submissionId'', submission.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''status'', submission.submission_status,
          ''submissionStatus'', submission.submission_status,
          ''submittedAt'', submission.received_at,
          ''receivedAt'', submission.received_at,
          ''receiptCode'', receipt.receipt_code,
          ''receiptId'', receipt.id,
          ''answerCount'', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''answerRevisions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', answer.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''questionId'', question.question_key,
          ''questionNumber'', question.position,
          ''revision'', answer.revision_number,
          ''answer'', answer.answer_payload -> ''answer'',
          ''flagged'', answer.is_flagged,
          ''contentHash'', answer.answer_sha256,
          ''savedAt'', answer.saved_at,
          ''at'', answer.saved_at,
          ''source'', answer.source
        ) order by submission.received_at, question.position, answer.revision_number, answer.id)
        from examination_room_v1.submission_answers selected_answer
        join examination_room_v1.submissions submission on submission.id = selected_answer.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.answer_revisions answer on answer.id = selected_answer.answer_revision_id
        join examination_room_v1.questions question on question.id = selected_answer.question_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''gradeRevisions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', grade.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''questionId'', question.question_key,
          ''questionNumber'', question.position,
          ''points'', item.score,
          ''feedback'', coalesce(item.feedback, ''''),
          ''revision'', grade.revision_number,
          ''status'', grade.grade_status,
          ''source'', grade.source,
          ''at'', grade.created_at,
          ''gradedAt'', grade.grading_manifest -> ''gradedAt''
        ) order by submission.received_at, grade.revision_number, question.position, grade.id)
        from examination_room_v1.grade_revisions grade
        join examination_room_v1.grade_revision_items item on item.grade_revision_id = grade.id
        join examination_room_v1.questions question on question.id = item.question_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''releases'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', release.id,
          ''sessionIds'', jsonb_build_array(case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end),
          ''releasedAt'', release.occurred_at,
          ''at'', release.occurred_at,
          ''status'', ''released'',
          ''channel'', release.channel
        ) order by release.occurred_at, release.id)
        from examination_room_v1.result_releases release
        join examination_room_v1.submissions submission on submission.id = release.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and release.release_action = ''release''
          and not exists (
            select 1
            from examination_room_v1.result_releases revoked
            where revoked.supersedes_release_id = release.id
              and revoked.release_action = ''revoke''
          )
      ), ''[]''::jsonb),
      ''generatedAt'', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''That examination creator view is unavailable.'', 400,
    ''Refresh Examination Room and choose Monitor or Grade.''
  );
end;
$function$
';
  DROP TRIGGER student_sessions_open_room_lease ON examination_room_v1.student_sessions;
  DROP FUNCTION examination_room_v1.apply_open_room_lease();
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7276e6df45b37831883ca9a28bc3b0731de3b4a312369d1104c81da1ecf513dd' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6657d93aede10f8a3b4e9d38d389d54dc6ef72f3bc1191d2dcb7f6c0856f9125' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_error(text,text,integer,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='92d7ff0cb2d931bbd072df5d349a616965ea7383625ad6d59fd39eca77b137e4' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63b3bc300c697d001bd2e0fdb51e673c598db03d0b654e2551fd098c42d50d0a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='75e15930ec34a9683791d53eaa380645bffe48c33ee9c5cd1ada618930c5e294' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a6025f0b8a979c2ef01c9d20849de06661a0f664c88e88e319c8de1762be5d78' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='95da22913df65a696f4bd8b003fb286b61df3c8cd1b01fe7144888a6c713c3ca' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c066ab9b3d82c6e34af8897d35f8b97e3ce9af656512c073aac7a9b980f50840' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_record_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,timestamp with time zone,jsonb,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='07190f7fcffa5d8b24ba4165d4c9ad7d09ce506e255712ef15f33f0f3986d4a1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='538afa7098e32587f056d5dc62a9acaa9aee027c0d3430a73acb236cf3d2b9bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_replay(uuid,text,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9f9ad9f65d49b2f89b1239ce8bb4fdce661805ebe3295ac9821ae9bb7c5cbf63' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f4fd12d2421e2dce70147e3c0886370ab8a581ac44068364effc9b72da1e305e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b2f4901d8f02d6bcae1814a117491da061e94c131432e87f82b150e442bda046' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='78c5e72a4ea24b569eea5153ff1e954162427e869fef50cd045ae2b37b909e19' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.build_publication_manifest(uuid,timestamp with time zone)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4a3647c6606454793e632d63db70eaef5fbe86700db343f9874fba5885430cc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7df2a2721f3fc16a452479e80ae22367ddf8fcc8b995b319c6e0ed97589c67fc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_authorized(uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a473426aa5bf9c2f559d2b509f47f9c082f8b3fed33845b7a0c1260426f4f5b0' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8aec9542309e1c01b3edc0ea7c7087b73aeeff740b7ee1dff68b3d59abbc9d4c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='feb9f9e6e2458b3efe6fb1b4e0d562a2793df99a203618ca0f7b21574bf59e39' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8f1e280682d1249ab23ad729ff4e8b30a85e9f1e683c4cad4fb7a31fe6b51bdc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_exam_current_version_published()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e505d487c7d1ccda4e782b2ffad6d1d19a1d127699632c076af304b55e18bc4c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ae68b6fb25772eca4ac8a3305a54dd785919c2723ab561b97e6a8dfa3a8b87a0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_releasable_grade()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d92c026833a7acbbe1cdaa44e9a0088fecafd35f47560fd37ec77ff6987fd21' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4317f150df2c8cc4eb03433a257996abe5c47d70852e5ce0d14e3248e3788768' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.grader_safe_submission_manifest(jsonb,boolean,text,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6de4e7c72329e22dc48a5093cbf3220eeb852e06efc22911a25fbfd5e39a4fb3' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='109b502d1dec6f856243dd1b4c8198f75938edade5f842ce6c8bda0cbea510d8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.json_rows(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='599e4c83c981a0d4e8c68acf89d3fcceb7af630b6d5c01a8e087e78765d01357' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='917518f0cefe5e2d13674efa53ae121fcb869304a7c28c7cbb7de6652d3f40f8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.jsonb_sha256(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f9bce66b9a8f68ce44485ad0b86468d446e2998162927dde38265939a3a15875' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='55d8de4f9ad53e6ead49dd9ffca9ffe0e997ba74226413a2e32d3682bcd1518f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.lock_request(uuid,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='465ef70b0cc6f0b854ddd204231b538b16bb9a8fbadd1126598af1250452ebc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0331f880070fc45f1cc378816cee90d46b53d87db2d793b2f3abe6fe5eaadd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.next_snapshot_sequence(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='bf75198d14a274d23d6a50068655085fad79caad79bd0f1a248c5b7c0d80baa7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='df2db1d17d7b8f8b45c74e89c6c0374807110419117e28a0b41eeabc15e0c46f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalize_default_student_warning()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9e2d022da93519b500aada19a4beb3bd692e13fa2c9c49985d02d16f3ff420e7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7fd42c9b5bb0973d808316fa72c35f1a363cbfd0f2498cd2e21f5f26082e2a08' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='34198a6304ef9c1f6f92fd4114a00e1d27208c26241fac8149e2a0a5c41c5275' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d98533d6b194a90694557a31238ab59ce33df632cf7cffb136cb8a9317695222' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_authorized(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4bb04bfa47a9fa50ec42f2ebb9c47d2af81a9474cc3355fbc5281d231209a474' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3574c6b327c5378c12f4d953c4862be199eddbe1e7b86b2b3669fac4a2d93205' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6b13cb369cdb1c3fb4c6369447dcc1225c5e70a06665aa99291487b99027710d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c19e0e2777efd12e3b3f8199f69d53d598796e16da53f2acb25afbb504a4cabb' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ca2e687d64c72872aad61523a4fbefe825cbbaad9acd69c9980e0daef12f940a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e2fda112c6566c56c3f524594b1660b72c1327318f58e937eb33dd8a1326fcd0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d9fe43b12f40a6d3debafbe4c21e1e270b12b8ac5b0fed8e0e4d717da60ef2a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fa24e3d243a8d71fd5f22e698b0354c78eb8cac75633c5b84a8bd42159641346' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_payload(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='399b06154a8fbaea7081f9116f8cd1d736f6e014aaef12819e9b8ed4e5a1f3df' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a500a81d55b0d81f5718b52c38f90aea86cd58a8fac4d58afb52a7671352bd39' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='263b9b20e8132ccaf946045a6512d813365dd42107296c5b0b2e20302a17a397' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7d60faf31d196c7387604eec0077b8d05055f5f5e959b5bf1fb77042041ba7a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_delete()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c697643b94d1eb985d076daf1f510834e8be39373aae23b659d9778e7e9f3dbf' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2babad1f225eb542c30e632b215bed9bdaf3fe2fb931d6f6c61011306f1489a2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_mutation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='184d4deaa5678a07c26415a01f0ebae0a8b5e160c67245d8be1959cb5e0c5f69' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af664f1ce37de88d7994bbb4e7e67db2eebfabd3e0f5dc73a4d7dc002791a692' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_email_delivery_event()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6c37b44db201da9c2740622b36fedc144e1d891e80e2c8bb1444f7f7cf53a72d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3ef1a89d75c15671527f4e0fa8bb38925364131becd594241024e16546bc3c51' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_grade_revision_item_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e0cd8fd5c9b2c5e0e3756040a60f74b07644c1f6d9cf26c8f7be5167df524b4d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b05845daaa070a8696fd2572605107762b6919ddf06da59e32626136e159487b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_professor_access_request_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6cc89d9726b20f9920a250d59640d6bde0834b78ef83a44b75e02a0c0b1b9d6d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='659f2beff2f8ba1f6773f650eb120cc515b8ccbc9b4ada30516537da883318d1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_published_question()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4773e7cfc9cad7b2e5fc853a70c6bddab5f9f00922f9119f6cf45073bf03a4ff' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='191a7975701371fa890ee878aa5816bba36b9e02cf797a3ec4864739149c08f2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_recovery_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1fde5878173075071ed8ccd74b1792d9c043c7bdf7055701ce8f7070c1f97739' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f2259c5dd84c19500d3b98dcf478a0ce1fa80686382d3e4350847618cfa0fe6d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_staff_membership_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a79aaa26edbe8c60d215554e8f7c7a26c4cedc3a6d953dcde8507dfa78c75da5' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e7263f3cbf7811cd6e13e2f5225dafb6baa00d6d126c7cf849742dcf67fa9b96' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_student_session_binding()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='802b52b6d076c21d36d830a92740fa683af36302809384a6ed0da06de574f40e' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7030894f8c4692b5adb5605d2f9068538ff4814a9d4a041f3bcde091d25f2fed' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_submission_answer_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='90466c13788a7d464d08d67d6a3a5b68210883140ab2e57a335f6750d790716c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c950ba3d5ce84b1590b6be154013ca5abe8c6b12dd9eeea54fbeeee028908f2e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.queue_grading_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e555ae1bbd482820fe834c4ff0806f6fdb52d2b296f593431b5f756168de4d74' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07758f4327ded35900e2ef3f8b932474d52163e28a546e6a8be450bc08ccc0a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c30d7b63e3cec523180fab0d22603d5c49161d430a4d00f88f319e4f181213b1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97b566674e6da2b08c522f738b88065650f71c41289730d95aca342a6fccb4ef' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.seal_exam_version()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='eb8234aad39b21203994085df20faf3c1744071e8bd05384620593bb51074415' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c9c148a6d6182da7e5f8b8cde3c66de4a4358efbd7332b1e1c9d689a7f77ec71' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.set_snapshot_source()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e861a27c7fe71fe2e37b185cab513947d06ea09138801009864a8d5418502f58' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5af1c9a737d4a8115e0ab67c3eee489cfe400ed0f7905ab941f34feedccf508e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.touch_updated_at()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='354fd59c57b17c349514d24ce4a8e4fa8d3d177fb99291c64992d24d617f0e3a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='92fa7c305a8b856faea0575b27eaa33c1e39952cf9fe87b4c0cbf7d7eab556bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.uuid_from_hash(text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d0d7dc854b466854f2c982e528e7e65a9de4ee33b4c7dea229a5ee737fcf64bb' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66a736cf40ccbfc250f8446fbdd7de911585bb37f4da459125b74a2ad2b6e2b1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e7be18f5b1812c66834c764b2c65b466b6ebc372b09a888b3b7dc79f76078566' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ba3b55cad702ac3f3fa66745c7815eec5f43444f758d9738284208d082cf6b6a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_exam_owner()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f86d20fc206e887476f2363856d60d7c84cff4950362c185be6b434a7f7ca058' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4c0f0147ebb06f4e457ed09c2f0cea9d1fdd2799d48d1b23037213804672ffc4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_privacy_acceptance()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='277bca90bee4d10f74b5475c143c36ab7c81fa5c0b6f708d5bfbcb1d7c38051c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea0070f61cc42e6de2d0eace5f2708617191d2f0c16086e8b4b73ee9f9439671' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_room_activation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8f96672da3ed19d205bd697b255bc8e29b74080a90c4278fa8ca67a91fbed880' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e46e006a39104dd3b5b8045fecd747243d9e366eed30046d5f13643be751762b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_submission_receipt()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8a7c5d74463a6c9fe4555b42c271d524ecbead0f59bc613feef222af9f5534a9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5aa6cbbae171e04b1a28bf94961759513c804d4fa60db267e03a30c85e7f33bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9fc7ecec84dcada0860b443b3190cbc4bc93c8b6f1642dcb2e077249357b06ad' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7e4a95085b4db167e38fbddc3c02b0edd61502c80c287c7c68fe2cf404f0d23e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5be56ab90978ae40cdd821a7577bbe3ce977f9d6766c95fac4f111c4fbc9677b' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2913cd1f0af99c9a7999ceb93666e3ebacaed79333d33fb3e4e6049eb75c260c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
    AND to_regprocedure('examination_room_v1.apply_open_room_lease()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease')
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='examination_room_v1' OR (ns.nspname='public' AND p.proname IN ('examination_room_v1_api','examination_room_v1_lifecycle_guard')))=48) THEN RAISE EXCEPTION 'PACKAGE_POSTIMAGE_MISMATCH'; END IF;
  SELECT to_jsonb(s)-'captured_at' INTO actual FROM (SELECT clock_timestamp() AS captured_at,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1' AND c.relkind IN ('r','p','v')) AS relations,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='examination_room_v1' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped) AS columns,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1') AS constraints,
(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='examination_room_v1') AS indexes,
(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='examination_room_v1' AND NOT t.tgisinternal) AS triggers,
(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='examination_room_v1') AS policies) s;
  -- The new lease trigger is checked separately by full definition, function and enabled state.
  actual := jsonb_set(actual,'{triggers}',coalesce((SELECT jsonb_agg(t ORDER BY t->>'table',t->>'name') FROM jsonb_array_elements(actual->'triggers') t WHERE NOT (t->>'table'='student_sessions' AND t->>'name'='student_sessions_open_room_lease')),'[]'::jsonb));
  IF actual IS DISTINCT FROM $expected_schema${"relations":[{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"answer_revisions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"audit_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"email_delivery_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exam_roster","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exam_versions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"exams","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"grade_revision_items","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"grade_revisions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"institutions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres}","rls":true,"kind":"r","owner":"postgres","table":"media_upload_intents","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"owner_identity_corrections","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"owner_key_envelopes","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"privacy_acceptances","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"privacy_notice_versions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"proctoring_artifacts","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"proctoring_incidents","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"professor_access_requests","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"questions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"recovery_snapshots","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"result_email_delivery_events","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"result_releases","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"room_activations","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"staff_memberships","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"student_identities","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"student_sessions","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submission_answers","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submission_receipts","force_rls":true},{"acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true,"kind":"r","owner":"postgres","table":"submissions","force_rls":true}],"columns":[{"type":"uuid","table":"answer_revisions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"answer_revisions","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"answer_revisions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"answer_revisions","column":"question_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"integer","table":"answer_revisions","column":"revision_number","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"answer_revisions","column":"client_revision_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"answer_revisions","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"answer_revisions","column":"answer_format","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"jsonb","table":"answer_revisions","column":"answer_payload","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"answer_revisions","column":"answer_sha256","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"boolean","table":"answer_revisions","column":"is_flagged","default":"false","identity":"","not_null":true,"position":11,"generated":""},{"type":"integer","table":"answer_revisions","column":"word_count","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"answer_revisions","column":"source","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"answer_revisions","column":"saved_at","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"answer_revisions","column":"received_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"audit_events","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"audit_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"audit_events","column":"exam_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"uuid","table":"audit_events","column":"session_id","default":null,"identity":"","not_null":false,"position":4,"generated":""},{"type":"uuid","table":"audit_events","column":"actor_user_id","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"audit_events","column":"actor_role","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"audit_events","column":"event_type","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"audit_events","column":"subject_type","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"audit_events","column":"subject_id","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"uuid","table":"audit_events","column":"correlation_id","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"audit_events","column":"request_hash","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"audit_events","column":"ip_hash","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"audit_events","column":"user_agent_hash","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"jsonb","table":"audit_events","column":"event_data","default":"'{}'::jsonb","identity":"","not_null":true,"position":14,"generated":""},{"type":"text","table":"audit_events","column":"previous_event_hash","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"text","table":"audit_events","column":"event_hash","default":null,"identity":"","not_null":true,"position":16,"generated":""},{"type":"timestamp with time zone","table":"audit_events","column":"occurred_at","default":null,"identity":"","not_null":true,"position":17,"generated":""},{"type":"timestamp with time zone","table":"audit_events","column":"recorded_at","default":"now()","identity":"","not_null":true,"position":18,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"activation_id","default":null,"identity":"","not_null":false,"position":4,"generated":""},{"type":"text","table":"email_delivery_events","column":"request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"email_delivery_events","column":"delivery_kind","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"email_delivery_events","column":"professor_recipient","default":null,"identity":"","not_null":false,"position":7,"generated":""},{"type":"jsonb","table":"email_delivery_events","column":"owner_copy_recipients","default":"'[]'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"email_delivery_events","column":"provider_status","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"email_delivery_events","column":"provider_id","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"text","table":"email_delivery_events","column":"safe_error_code","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"email_delivery_events","column":"attempted_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"email_delivery_events","column":"attempted_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"exam_roster","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exam_roster","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exam_roster","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"exam_roster","column":"student_identity_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exam_roster","column":"grading_alias","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"exam_roster","column":"roster_status","default":"'eligible'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"exam_roster","column":"accommodations","default":"'{}'::jsonb","identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"exam_roster","column":"added_by_user_id","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"exam_roster","column":"created_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"exam_roster","column":"updated_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"exam_versions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exam_versions","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exam_versions","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"exam_versions","column":"version_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exam_versions","column":"title_snapshot","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"exam_versions","column":"instructions","default":"''::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"integer","table":"exam_versions","column":"duration_seconds","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"boolean","table":"exam_versions","column":"anonymous_grading_snapshot","default":"false","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"exam_versions","column":"privacy_notice_version_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"jsonb","table":"exam_versions","column":"controls","default":"'{}'::jsonb","identity":"","not_null":true,"position":10,"generated":""},{"type":"jsonb","table":"exam_versions","column":"publication_manifest","default":"'{}'::jsonb","identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"exam_versions","column":"content_sha256","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"exam_versions","column":"publication_status","default":"'building'::text","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"exam_versions","column":"published_by_user_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"exam_versions","column":"published_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"timestamp with time zone","table":"exam_versions","column":"created_at","default":"now()","identity":"","not_null":true,"position":16,"generated":""},{"type":"text","table":"exam_versions","column":"admission_mode_snapshot","default":"'key_only'::text","identity":"","not_null":true,"position":17,"generated":""},{"type":"text[]","table":"exam_versions","column":"allowed_emails_snapshot","default":"'{}'::text[]","identity":"","not_null":true,"position":18,"generated":""},{"type":"uuid","table":"exams","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"exams","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"exams","column":"owner_user_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"exams","column":"title","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"exams","column":"description","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"exams","column":"status","default":"'draft'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"boolean","table":"exams","column":"anonymous_grading","default":"false","identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"exams","column":"current_published_version_id","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"created_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"updated_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"closed_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"archived_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"exams","column":"admission_mode","default":"'key_only'::text","identity":"","not_null":true,"position":13,"generated":""},{"type":"text[]","table":"exams","column":"allowed_emails","default":"'{}'::text[]","identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"blocked_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"uuid","table":"exams","column":"blocked_by_user_id","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"text","table":"exams","column":"block_reason","default":null,"identity":"","not_null":false,"position":17,"generated":""},{"type":"timestamp with time zone","table":"exams","column":"deleted_at","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"uuid","table":"exams","column":"deleted_by_user_id","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"text","table":"exams","column":"delete_reason","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"text","table":"exams","column":"lifecycle_prior_status","default":null,"identity":"","not_null":false,"position":21,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"grade_revision_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"grade_revision_items","column":"question_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"numeric(12,2)","table":"grade_revision_items","column":"score","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"numeric(12,2)","table":"grade_revision_items","column":"maximum_score","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"grade_revision_items","column":"feedback","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"jsonb","table":"grade_revision_items","column":"rubric_marks","default":"'{}'::jsonb","identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"grade_revision_items","column":"created_at","default":"now()","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"grade_revisions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"grade_revisions","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"grade_revisions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"grade_revisions","column":"revision_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"grade_revisions","column":"client_revision_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"grade_revisions","column":"manifest_sha256","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"grade_revisions","column":"grading_manifest","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"grade_revisions","column":"grader_user_id","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"grade_revisions","column":"source","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"grade_revisions","column":"grade_status","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"integer","table":"grade_revisions","column":"item_count","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"numeric(12,2)","table":"grade_revisions","column":"total_score","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"numeric(12,2)","table":"grade_revisions","column":"maximum_score","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"grade_revisions","column":"general_feedback","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"text","table":"grade_revisions","column":"private_notes","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"jsonb","table":"grade_revisions","column":"rubric_snapshot","default":"'{}'::jsonb","identity":"","not_null":true,"position":16,"generated":""},{"type":"timestamp with time zone","table":"grade_revisions","column":"created_at","default":"now()","identity":"","not_null":true,"position":17,"generated":""},{"type":"uuid","table":"institutions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"text","table":"institutions","column":"institution_code","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"institutions","column":"profile_school_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"institutions","column":"institution_name","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"institutions","column":"institution_status","default":"'active'::text","identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"institutions","column":"bootstrap_request_hash","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"institutions","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"institutions","column":"created_at","default":"now()","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"client_artifact_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"media_upload_intents","column":"request_hash","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"media_upload_intents","column":"artifact_kind","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"media_upload_intents","column":"source_mime_type","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"bigint","table":"media_upload_intents","column":"encrypted_size_bytes","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"media_upload_intents","column":"object_sha256","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"captured_from","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"captured_to","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"retention_until","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"text","table":"media_upload_intents","column":"provider","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"media_upload_intents","column":"provider_object_reference","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_algorithm","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"smallint","table":"media_upload_intents","column":"wrapped_key_version","default":null,"identity":"","not_null":true,"position":15,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_ciphertext","default":null,"identity":"","not_null":true,"position":16,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_iv","default":null,"identity":"","not_null":true,"position":17,"generated":""},{"type":"text","table":"media_upload_intents","column":"wrapped_key_aad_sha256","default":null,"identity":"","not_null":true,"position":18,"generated":""},{"type":"text","table":"media_upload_intents","column":"intent_status","default":"'prepared'::text","identity":"","not_null":true,"position":19,"generated":""},{"type":"text","table":"media_upload_intents","column":"completion_request_hash","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"jsonb","table":"media_upload_intents","column":"provider_result","default":"'{}'::jsonb","identity":"","not_null":true,"position":21,"generated":""},{"type":"uuid","table":"media_upload_intents","column":"artifact_id","default":null,"identity":"","not_null":false,"position":22,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"prepared_at","default":"now()","identity":"","not_null":true,"position":23,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"completed_at","default":null,"identity":"","not_null":false,"position":24,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"created_at","default":"now()","identity":"","not_null":true,"position":25,"generated":""},{"type":"timestamp with time zone","table":"media_upload_intents","column":"updated_at","default":"now()","identity":"","not_null":true,"position":26,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"student_identity_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"owner_identity_corrections","column":"request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"jsonb","table":"owner_identity_corrections","column":"before_record","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"jsonb","table":"owner_identity_corrections","column":"after_record","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"owner_identity_corrections","column":"reason","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"owner_identity_corrections","column":"corrected_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"owner_identity_corrections","column":"corrected_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"activation_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"envelope_algorithm","default":"'aes-256-gcm-v1'::text","identity":"","not_null":true,"position":4,"generated":""},{"type":"integer","table":"owner_key_envelopes","column":"key_version","default":"1","identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"ciphertext_base64","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"iv_base64","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"owner_key_envelopes","column":"aad_sha256","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"owner_key_envelopes","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"owner_key_envelopes","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"notice_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"roster_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"session_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"client_event_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"privacy_acceptances","column":"decision","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"uuid","table":"privacy_acceptances","column":"prior_acceptance_id","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"jsonb","table":"privacy_acceptances","column":"accepted_features","default":"'{}'::jsonb","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"privacy_acceptances","column":"evidence_sha256","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"privacy_acceptances","column":"capture_method","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"privacy_acceptances","column":"recorded_at","default":"now()","identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"privacy_acceptances","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"notice_code","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"privacy_notice_versions","column":"version_number","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"title","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"notice_body","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"privacy_notice_versions","column":"body_sha256","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"jsonb","table":"privacy_notice_versions","column":"processing_purposes","default":"'[]'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"privacy_notice_versions","column":"effective_at","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"uuid","table":"privacy_notice_versions","column":"created_by_user_id","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"privacy_notice_versions","column":"created_at","default":"now()","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"proctoring_artifacts","column":"incident_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"artifact_kind","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"encrypted_object_reference","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"object_sha256","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"encryption_key_reference","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"captured_from","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"captured_to","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"retention_until","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"proctoring_artifacts","column":"artifact_status","default":"'available'::text","identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"created_at","default":"now()","identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"proctoring_artifacts","column":"updated_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"client_event_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"proctoring_incidents","column":"incident_kind","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"proctoring_incidents","column":"source","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"proctoring_incidents","column":"severity","default":"'info'::text","identity":"","not_null":true,"position":6,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"occurred_at","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"integer","table":"proctoring_incidents","column":"duration_ms","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"jsonb","table":"proctoring_incidents","column":"details","default":"'{}'::jsonb","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"proctoring_incidents","column":"review_status","default":"'unreviewed'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"proctoring_incidents","column":"reviewed_by_user_id","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"reviewed_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"proctoring_incidents","column":"review_notes","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"created_at","default":"now()","identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"proctoring_incidents","column":"updated_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"user_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"text","table":"professor_access_requests","column":"email_normalized","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"professor_access_requests","column":"display_name","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"professor_access_requests","column":"claimed_school_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"professor_access_requests","column":"claimed_school_name","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"requested_institution_id","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"professor_access_requests","column":"request_status","default":"'pending'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"requested_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"reviewed_by_user_id","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"reviewed_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"text","table":"professor_access_requests","column":"review_reason","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"assigned_institution_id","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"uuid","table":"professor_access_requests","column":"approved_membership_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"professor_access_requests","column":"updated_at","default":"now()","identity":"","not_null":true,"position":15,"generated":""},{"type":"uuid","table":"questions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"questions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"integer","table":"questions","column":"position","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"questions","column":"question_key","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"questions","column":"question_kind","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"questions","column":"prompt","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"numeric(10,2)","table":"questions","column":"points","default":"0","identity":"","not_null":true,"position":7,"generated":""},{"type":"jsonb","table":"questions","column":"configuration","default":"'{}'::jsonb","identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"questions","column":"content_sha256","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"questions","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"integer","table":"recovery_snapshots","column":"snapshot_sequence","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_scope","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"recovery_snapshots","column":"request_hash","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"recovery_snapshots","column":"encrypted_object_reference","default":null,"identity":"","not_null":false,"position":7,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_sha256","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"recovery_snapshots","column":"encryption_key_reference","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"bigint","table":"recovery_snapshots","column":"record_count","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"recovery_snapshots","column":"snapshot_status","default":"'pending'::text","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"created_by_user_id","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"retention_until","default":null,"identity":"","not_null":true,"position":14,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"restored_at","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"restored_by_user_id","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"updated_at","default":"now()","identity":"","not_null":true,"position":17,"generated":""},{"type":"text","table":"recovery_snapshots","column":"source_kind","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_session_id","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_submission_id","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_grade_revision_id","default":null,"identity":"","not_null":false,"position":21,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"source_result_release_id","default":null,"identity":"","not_null":false,"position":22,"generated":""},{"type":"integer","table":"recovery_snapshots","column":"materialization_attempts","default":"0","identity":"","not_null":true,"position":23,"generated":""},{"type":"uuid","table":"recovery_snapshots","column":"lease_id","default":null,"identity":"","not_null":false,"position":24,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"lease_expires_at","default":null,"identity":"","not_null":false,"position":25,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"next_retry_at","default":null,"identity":"","not_null":false,"position":26,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"available_at","default":null,"identity":"","not_null":false,"position":27,"generated":""},{"type":"text","table":"recovery_snapshots","column":"last_error_code","default":null,"identity":"","not_null":false,"position":28,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"last_error_at","default":null,"identity":"","not_null":false,"position":29,"generated":""},{"type":"timestamp with time zone","table":"recovery_snapshots","column":"verified_at","default":null,"identity":"","not_null":false,"position":30,"generated":""},{"type":"bigint","table":"recovery_snapshots","column":"restored_record_count","default":"0","identity":"","not_null":true,"position":31,"generated":""},{"type":"text","table":"recovery_snapshots","column":"restore_verification_sha256","default":null,"identity":"","not_null":false,"position":32,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"release_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"student_session_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"batch_request_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"recipient_email","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"recipient_name","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"exam_title","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"subject_name","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"numeric(10,2)","table":"result_email_delivery_events","column":"total_score","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"numeric(10,2)","table":"result_email_delivery_events","column":"maximum_score","default":null,"identity":"","not_null":true,"position":11,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"released_at","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"delivery_status","default":null,"identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"provider_id","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"text","table":"result_email_delivery_events","column":"safe_error_code","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"integer","table":"result_email_delivery_events","column":"attempt_count","default":"0","identity":"","not_null":true,"position":16,"generated":""},{"type":"uuid","table":"result_email_delivery_events","column":"claim_token","default":null,"identity":"","not_null":false,"position":17,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"lease_expires_at","default":null,"identity":"","not_null":false,"position":18,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"attempted_at","default":null,"identity":"","not_null":false,"position":19,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"completed_at","default":null,"identity":"","not_null":false,"position":20,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"created_at","default":"now()","identity":"","not_null":true,"position":21,"generated":""},{"type":"timestamp with time zone","table":"result_email_delivery_events","column":"updated_at","default":"now()","identity":"","not_null":true,"position":22,"generated":""},{"type":"uuid","table":"result_releases","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"result_releases","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"result_releases","column":"grade_revision_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"result_releases","column":"release_action","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"result_releases","column":"supersedes_release_id","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"result_releases","column":"channel","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"result_releases","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"result_releases","column":"delivery_reference_hash","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"result_releases","column":"manifest_sha256","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"jsonb","table":"result_releases","column":"release_manifest","default":null,"identity":"","not_null":false,"position":10,"generated":""},{"type":"text","table":"result_releases","column":"reason","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"result_releases","column":"performed_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"result_releases","column":"occurred_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"text","table":"result_releases","column":"batch_request_hash","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"uuid","table":"room_activations","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"room_activations","column":"exam_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"room_activations","column":"institution_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"room_activations","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"room_activations","column":"key_hash","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"room_activations","column":"key_hash_algorithm","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"room_activations","column":"request_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"room_activations","column":"activation_status","default":"'scheduled'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"opens_at","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"closes_at","default":null,"identity":"","not_null":true,"position":10,"generated":""},{"type":"integer","table":"room_activations","column":"max_sessions","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"room_activations","column":"activated_by_user_id","default":null,"identity":"","not_null":true,"position":12,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"created_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"room_activations","column":"deactivated_at","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"uuid","table":"room_activations","column":"deactivated_by_user_id","default":null,"identity":"","not_null":false,"position":15,"generated":""},{"type":"text","table":"room_activations","column":"deactivation_reason","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"uuid","table":"staff_memberships","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"staff_memberships","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"staff_memberships","column":"user_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"staff_memberships","column":"staff_role","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"staff_memberships","column":"display_name","default":null,"identity":"","not_null":false,"position":5,"generated":""},{"type":"text","table":"staff_memberships","column":"email_normalized","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"staff_memberships","column":"membership_status","default":"'active'::text","identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"staff_memberships","column":"grant_reason","default":"'Institution examination access approved.'::text","identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"staff_memberships","column":"granted_by_user_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"granted_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"uuid","table":"staff_memberships","column":"revoked_by_user_id","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"revoked_at","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"text","table":"staff_memberships","column":"revocation_reason","default":null,"identity":"","not_null":false,"position":13,"generated":""},{"type":"timestamp with time zone","table":"staff_memberships","column":"updated_at","default":"now()","identity":"","not_null":true,"position":14,"generated":""},{"type":"uuid","table":"student_identities","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"student_identities","column":"institution_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"student_identities","column":"auth_user_id","default":null,"identity":"","not_null":false,"position":3,"generated":""},{"type":"text","table":"student_identities","column":"external_student_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"student_identities","column":"full_name","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"text","table":"student_identities","column":"email_normalized","default":null,"identity":"","not_null":false,"position":6,"generated":""},{"type":"text","table":"student_identities","column":"identity_status","default":"'active'::text","identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"verified_at","default":null,"identity":"","not_null":false,"position":8,"generated":""},{"type":"text","table":"student_identities","column":"verification_method","default":null,"identity":"","not_null":false,"position":9,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"created_at","default":"now()","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"student_identities","column":"updated_at","default":"now()","identity":"","not_null":true,"position":11,"generated":""},{"type":"uuid","table":"student_sessions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"student_sessions","column":"activation_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"student_sessions","column":"exam_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"student_sessions","column":"institution_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"uuid","table":"student_sessions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"student_sessions","column":"roster_id","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"text","table":"student_sessions","column":"session_token_hash","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"text","table":"student_sessions","column":"consent_request_hash","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"uuid","table":"student_sessions","column":"client_instance_id","default":null,"identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"student_sessions","column":"session_status","default":"'created'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"identity_verified_at","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"text","table":"student_sessions","column":"identity_verification_method","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"started_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"last_heartbeat_at","default":null,"identity":"","not_null":false,"position":14,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"lease_expires_at","default":null,"identity":"","not_null":true,"position":15,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"ended_at","default":null,"identity":"","not_null":false,"position":16,"generated":""},{"type":"jsonb","table":"student_sessions","column":"session_metadata","default":"'{}'::jsonb","identity":"","not_null":true,"position":17,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"created_at","default":"now()","identity":"","not_null":true,"position":18,"generated":""},{"type":"timestamp with time zone","table":"student_sessions","column":"updated_at","default":"now()","identity":"","not_null":true,"position":19,"generated":""},{"type":"uuid","table":"submission_answers","column":"submission_id","default":null,"identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submission_answers","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submission_answers","column":"question_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"uuid","table":"submission_answers","column":"answer_revision_id","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"timestamp with time zone","table":"submission_answers","column":"created_at","default":"now()","identity":"","not_null":true,"position":5,"generated":""},{"type":"uuid","table":"submission_receipts","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submission_receipts","column":"submission_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submission_receipts","column":"receipt_code","default":"gen_random_uuid()","identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"submission_receipts","column":"receipt_sha256","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"jsonb","table":"submission_receipts","column":"receipt_payload","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"timestamp with time zone","table":"submission_receipts","column":"issued_at","default":"now()","identity":"","not_null":true,"position":6,"generated":""},{"type":"uuid","table":"submissions","column":"id","default":"gen_random_uuid()","identity":"","not_null":true,"position":1,"generated":""},{"type":"uuid","table":"submissions","column":"session_id","default":null,"identity":"","not_null":true,"position":2,"generated":""},{"type":"uuid","table":"submissions","column":"exam_version_id","default":null,"identity":"","not_null":true,"position":3,"generated":""},{"type":"text","table":"submissions","column":"idempotency_key_hash","default":null,"identity":"","not_null":true,"position":4,"generated":""},{"type":"text","table":"submissions","column":"manifest_sha256","default":null,"identity":"","not_null":true,"position":5,"generated":""},{"type":"jsonb","table":"submissions","column":"submission_manifest","default":null,"identity":"","not_null":true,"position":6,"generated":""},{"type":"integer","table":"submissions","column":"answer_count","default":null,"identity":"","not_null":true,"position":7,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"submitted_at_client","default":null,"identity":"","not_null":true,"position":8,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"received_at","default":"now()","identity":"","not_null":true,"position":9,"generated":""},{"type":"text","table":"submissions","column":"submission_status","default":"'accepted'::text","identity":"","not_null":true,"position":10,"generated":""},{"type":"text","table":"submissions","column":"status_reason","default":null,"identity":"","not_null":false,"position":11,"generated":""},{"type":"uuid","table":"submissions","column":"status_changed_by_user_id","default":null,"identity":"","not_null":false,"position":12,"generated":""},{"type":"timestamp with time zone","table":"submissions","column":"updated_at","default":"now()","identity":"","not_null":true,"position":13,"generated":""}],"constraints":[{"kind":"c","name":"answer_revisions_answer_format_check","table":"answer_revisions","definition":"CHECK (answer_format = ANY (ARRAY['rich_text'::text, 'plain_text'::text, 'choice'::text, 'boolean'::text, 'file_reference'::text]))"},{"kind":"c","name":"answer_revisions_answer_payload_check","table":"answer_revisions","definition":"CHECK (jsonb_typeof(answer_payload) = 'object'::text)"},{"kind":"c","name":"answer_revisions_answer_sha256_check","table":"answer_revisions","definition":"CHECK (answer_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"answer_revisions_clock_skew_check","table":"answer_revisions","definition":"CHECK (saved_at <= (received_at + '24:00:00'::interval))"},{"kind":"u","name":"answer_revisions_id_session_question_key","table":"answer_revisions","definition":"UNIQUE (id, session_id, question_id)"},{"kind":"c","name":"answer_revisions_idempotency_key_hash_check","table":"answer_revisions","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"answer_revisions_idempotency_key_hash_key","table":"answer_revisions","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"p","name":"answer_revisions_pkey","table":"answer_revisions","definition":"PRIMARY KEY (id)"},{"kind":"f","name":"answer_revisions_question_version_fk","table":"answer_revisions","definition":"FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"answer_revisions_revision_number_check","table":"answer_revisions","definition":"CHECK (revision_number > 0)"},{"kind":"u","name":"answer_revisions_session_client_key","table":"answer_revisions","definition":"UNIQUE (session_id, client_revision_id)"},{"kind":"u","name":"answer_revisions_session_question_number_key","table":"answer_revisions","definition":"UNIQUE (session_id, question_id, revision_number)"},{"kind":"f","name":"answer_revisions_session_version_fk","table":"answer_revisions","definition":"FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"answer_revisions_source_check","table":"answer_revisions","definition":"CHECK (source = ANY (ARRAY['autosave'::text, 'manual_save'::text, 'recovery'::text, 'submission'::text]))"},{"kind":"c","name":"answer_revisions_word_count_check","table":"answer_revisions","definition":"CHECK (word_count IS NULL OR word_count >= 0)"},{"kind":"c","name":"audit_events_actor_role_check","table":"audit_events","definition":"CHECK (actor_role = ANY (ARRAY['professor'::text, 'admin'::text, 'student'::text, 'system'::text, 'service'::text]))"},{"kind":"c","name":"audit_events_event_data_check","table":"audit_events","definition":"CHECK (jsonb_typeof(event_data) = 'object'::text AND event_data::text !~* '\"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)\"[[:space:]]*:'::text)"},{"kind":"c","name":"audit_events_event_hash_check","table":"audit_events","definition":"CHECK (event_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"audit_events_event_type_check","table":"audit_events","definition":"CHECK (length(btrim(event_type)) >= 1 AND length(btrim(event_type)) <= 120)"},{"kind":"f","name":"audit_events_exam_institution_fk","table":"audit_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"audit_events_institution_hash_key","table":"audit_events","definition":"UNIQUE (institution_id, event_hash)"},{"kind":"f","name":"audit_events_institution_id_fkey","table":"audit_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"u","name":"audit_events_institution_request_key","table":"audit_events","definition":"UNIQUE (institution_id, request_hash)"},{"kind":"c","name":"audit_events_ip_hash_check","table":"audit_events","definition":"CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"audit_events_pkey","table":"audit_events","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"audit_events_previous_event_hash_check","table":"audit_events","definition":"CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"audit_events_previous_hash_fk","table":"audit_events","definition":"FOREIGN KEY (institution_id, previous_event_hash) REFERENCES examination_room_v1.audit_events(institution_id, event_hash) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED"},{"kind":"c","name":"audit_events_request_hash_check","table":"audit_events","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"audit_events_session_context_fk","table":"audit_events","definition":"FOREIGN KEY (session_id, institution_id, exam_id) REFERENCES examination_room_v1.student_sessions(id, institution_id, exam_id) ON DELETE RESTRICT"},{"kind":"f","name":"audit_events_session_id_fkey","table":"audit_events","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"audit_events_session_requires_exam_check","table":"audit_events","definition":"CHECK (session_id IS NULL OR exam_id IS NOT NULL)"},{"kind":"c","name":"audit_events_subject_type_check","table":"audit_events","definition":"CHECK (length(btrim(subject_type)) >= 1 AND length(btrim(subject_type)) <= 80)"},{"kind":"c","name":"audit_events_user_agent_hash_check","table":"audit_events","definition":"CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"email_delivery_events_activation_id_fkey","table":"email_delivery_events","definition":"FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT"},{"kind":"c","name":"email_delivery_events_delivery_kind_check","table":"email_delivery_events","definition":"CHECK (delivery_kind = ANY (ARRAY['activation_key'::text, 'key_resend'::text, 'key_rotation'::text]))"},{"kind":"f","name":"email_delivery_events_exam_scope_fk","table":"email_delivery_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"email_delivery_events_institution_id_fkey","table":"email_delivery_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"email_delivery_events_owner_copy_recipients_check","table":"email_delivery_events","definition":"CHECK (jsonb_typeof(owner_copy_recipients) = 'array'::text)"},{"kind":"p","name":"email_delivery_events_pkey","table":"email_delivery_events","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"email_delivery_events_professor_recipient_check","table":"email_delivery_events","definition":"CHECK (professor_recipient IS NULL OR professor_recipient = lower(btrim(professor_recipient)) AND POSITION(('@'::text) IN (professor_recipient)) > 1 AND length(professor_recipient) >= 3 AND length(professor_recipient) <= 320)"},{"kind":"c","name":"email_delivery_events_provider_id_check","table":"email_delivery_events","definition":"CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240)"},{"kind":"c","name":"email_delivery_events_provider_status_check","table":"email_delivery_events","definition":"CHECK (provider_status = ANY (ARRAY['sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text]))"},{"kind":"c","name":"email_delivery_events_request_hash_check","table":"email_delivery_events","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"email_delivery_events_request_hash_key","table":"email_delivery_events","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"email_delivery_events_safe_error_code_check","table":"email_delivery_events","definition":"CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text)"},{"kind":"c","name":"exam_roster_accommodations_check","table":"exam_roster","definition":"CHECK (jsonb_typeof(accommodations) = 'object'::text)"},{"kind":"f","name":"exam_roster_exam_institution_fk","table":"exam_roster","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"exam_roster_exam_student_key","table":"exam_roster","definition":"UNIQUE (exam_id, student_identity_id)"},{"kind":"c","name":"exam_roster_grading_alias_check","table":"exam_roster","definition":"CHECK (grading_alias IS NULL OR length(btrim(grading_alias)) >= 1 AND length(btrim(grading_alias)) <= 80)"},{"kind":"u","name":"exam_roster_id_exam_institution_key","table":"exam_roster","definition":"UNIQUE (id, exam_id, institution_id)"},{"kind":"u","name":"exam_roster_id_exam_key","table":"exam_roster","definition":"UNIQUE (id, exam_id)"},{"kind":"f","name":"exam_roster_identity_institution_fk","table":"exam_roster","definition":"FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT"},{"kind":"p","name":"exam_roster_pkey","table":"exam_roster","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exam_roster_roster_status_check","table":"exam_roster","definition":"CHECK (roster_status = ANY (ARRAY['invited'::text, 'eligible'::text, 'withdrawn'::text, 'completed'::text]))"},{"kind":"c","name":"exam_versions_admission_mode_check","table":"exam_versions","definition":"CHECK (admission_mode_snapshot = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]))"},{"kind":"c","name":"exam_versions_allowed_emails_check","table":"exam_versions","definition":"CHECK (examination_room_v1.valid_allowed_emails(allowed_emails_snapshot))"},{"kind":"c","name":"exam_versions_content_sha256_check","table":"exam_versions","definition":"CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"exam_versions_controls_check","table":"exam_versions","definition":"CHECK (jsonb_typeof(controls) = 'object'::text)"},{"kind":"c","name":"exam_versions_duration_seconds_check","table":"exam_versions","definition":"CHECK (duration_seconds >= 60 AND duration_seconds <= 86400)"},{"kind":"f","name":"exam_versions_exam_institution_fk","table":"exam_versions","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"exam_versions_exam_version_key","table":"exam_versions","definition":"UNIQUE (exam_id, version_number)"},{"kind":"u","name":"exam_versions_id_exam_institution_key","table":"exam_versions","definition":"UNIQUE (id, exam_id, institution_id)"},{"kind":"u","name":"exam_versions_id_exam_key","table":"exam_versions","definition":"UNIQUE (id, exam_id)"},{"kind":"u","name":"exam_versions_id_notice_key","table":"exam_versions","definition":"UNIQUE (id, privacy_notice_version_id)"},{"kind":"f","name":"exam_versions_notice_institution_fk","table":"exam_versions","definition":"FOREIGN KEY (privacy_notice_version_id, institution_id) REFERENCES examination_room_v1.privacy_notice_versions(id, institution_id) ON DELETE RESTRICT"},{"kind":"p","name":"exam_versions_pkey","table":"exam_versions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exam_versions_publication_manifest_check","table":"exam_versions","definition":"CHECK (jsonb_typeof(publication_manifest) = 'object'::text)"},{"kind":"c","name":"exam_versions_publication_state_check","table":"exam_versions","definition":"CHECK (publication_status = 'building'::text AND published_by_user_id IS NULL AND published_at IS NULL AND publication_manifest = '{}'::jsonb OR publication_status = 'published'::text AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL AND published_at >= created_at AND (publication_manifest ->> 'schemaVersion'::text) = 'examination-room/publication/v1'::text)"},{"kind":"c","name":"exam_versions_publication_status_check","table":"exam_versions","definition":"CHECK (publication_status = ANY (ARRAY['building'::text, 'published'::text]))"},{"kind":"c","name":"exam_versions_title_snapshot_check","table":"exam_versions","definition":"CHECK (length(btrim(title_snapshot)) >= 1 AND length(btrim(title_snapshot)) <= 300)"},{"kind":"c","name":"exam_versions_version_number_check","table":"exam_versions","definition":"CHECK (version_number > 0)"},{"kind":"c","name":"exams_admission_mode_check","table":"exams","definition":"CHECK (admission_mode = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]))"},{"kind":"c","name":"exams_allowed_emails_check","table":"exams","definition":"CHECK (examination_room_v1.valid_allowed_emails(allowed_emails))"},{"kind":"c","name":"exams_block_state_check","table":"exams","definition":"CHECK (blocked_at IS NULL AND blocked_by_user_id IS NULL AND block_reason IS NULL OR blocked_at IS NOT NULL AND blocked_by_user_id IS NOT NULL AND NULLIF(btrim(block_reason), ''::text) IS NOT NULL)"},{"kind":"f","name":"exams_current_published_version_fk","table":"exams","definition":"FOREIGN KEY (current_published_version_id, id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED"},{"kind":"c","name":"exams_delete_state_check","table":"exams","definition":"CHECK (deleted_at IS NULL AND deleted_by_user_id IS NULL AND delete_reason IS NULL OR deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL AND NULLIF(btrim(delete_reason), ''::text) IS NOT NULL)"},{"kind":"u","name":"exams_id_institution_key","table":"exams","definition":"UNIQUE (id, institution_id)"},{"kind":"f","name":"exams_institution_id_fkey","table":"exams","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"exams_lifecycle_prior_status_check","table":"exams","definition":"CHECK (lifecycle_prior_status IS NULL OR (lifecycle_prior_status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text])))"},{"kind":"c","name":"exams_lifecycle_timestamps_check","table":"exams","definition":"CHECK ((closed_at IS NULL OR closed_at >= created_at) AND (archived_at IS NULL OR archived_at >= created_at))"},{"kind":"p","name":"exams_pkey","table":"exams","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"exams_publish_state_check","table":"exams","definition":"CHECK (status = 'draft'::text AND current_published_version_id IS NULL OR status <> 'draft'::text AND current_published_version_id IS NOT NULL)"},{"kind":"c","name":"exams_status_check","table":"exams","definition":"CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text]))"},{"kind":"c","name":"exams_title_check","table":"exams","definition":"CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 300)"},{"kind":"c","name":"grade_revision_items_check","table":"grade_revision_items","definition":"CHECK (maximum_score >= 0::numeric AND score <= maximum_score)"},{"kind":"p","name":"grade_revision_items_pkey","table":"grade_revision_items","definition":"PRIMARY KEY (grade_revision_id, question_id)"},{"kind":"f","name":"grade_revision_items_question_version_fk","table":"grade_revision_items","definition":"FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"grade_revision_items_revision_version_fk","table":"grade_revision_items","definition":"FOREIGN KEY (grade_revision_id, exam_version_id) REFERENCES examination_room_v1.grade_revisions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"grade_revision_items_rubric_marks_check","table":"grade_revision_items","definition":"CHECK (jsonb_typeof(rubric_marks) = 'object'::text)"},{"kind":"c","name":"grade_revision_items_score_check","table":"grade_revision_items","definition":"CHECK (score >= 0::numeric)"},{"kind":"c","name":"grade_revisions_check","table":"grade_revisions","definition":"CHECK (maximum_score >= 0::numeric AND total_score <= maximum_score)"},{"kind":"c","name":"grade_revisions_grade_status_check","table":"grade_revisions","definition":"CHECK (grade_status = ANY (ARRAY['draft'::text, 'final'::text, 'corrected'::text]))"},{"kind":"c","name":"grade_revisions_grading_manifest_check","table":"grade_revisions","definition":"CHECK (jsonb_typeof(grading_manifest) = 'object'::text AND (grading_manifest ->> 'schemaVersion'::text) = 'examination-room/grading/v1'::text)"},{"kind":"u","name":"grade_revisions_id_submission_key","table":"grade_revisions","definition":"UNIQUE (id, submission_id)"},{"kind":"u","name":"grade_revisions_id_version_key","table":"grade_revisions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"grade_revisions_item_count_check","table":"grade_revisions","definition":"CHECK (item_count >= 0)"},{"kind":"c","name":"grade_revisions_manifest_sha256_check","table":"grade_revisions","definition":"CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"grade_revisions_pkey","table":"grade_revisions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"grade_revisions_revision_number_check","table":"grade_revisions","definition":"CHECK (revision_number > 0)"},{"kind":"c","name":"grade_revisions_rubric_snapshot_check","table":"grade_revisions","definition":"CHECK (jsonb_typeof(rubric_snapshot) = 'object'::text)"},{"kind":"c","name":"grade_revisions_source_check","table":"grade_revisions","definition":"CHECK (source = ANY (ARRAY['online'::text, 'offline_import'::text, 'recovery'::text]))"},{"kind":"u","name":"grade_revisions_submission_client_key","table":"grade_revisions","definition":"UNIQUE (submission_id, client_revision_id)"},{"kind":"u","name":"grade_revisions_submission_revision_key","table":"grade_revisions","definition":"UNIQUE (submission_id, revision_number)"},{"kind":"f","name":"grade_revisions_submission_version_fk","table":"grade_revisions","definition":"FOREIGN KEY (submission_id, exam_version_id) REFERENCES examination_room_v1.submissions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"grade_revisions_total_score_check","table":"grade_revisions","definition":"CHECK (total_score >= 0::numeric)"},{"kind":"c","name":"institutions_bootstrap_request_hash_check","table":"institutions","definition":"CHECK (bootstrap_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"institutions_bootstrap_request_hash_key","table":"institutions","definition":"UNIQUE (bootstrap_request_hash)"},{"kind":"c","name":"institutions_institution_code_check","table":"institutions","definition":"CHECK (institution_code = lower(btrim(institution_code)) AND institution_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text)"},{"kind":"u","name":"institutions_institution_code_key","table":"institutions","definition":"UNIQUE (institution_code)"},{"kind":"c","name":"institutions_institution_name_check","table":"institutions","definition":"CHECK (length(btrim(institution_name)) >= 2 AND length(btrim(institution_name)) <= 240)"},{"kind":"c","name":"institutions_institution_status_check","table":"institutions","definition":"CHECK (institution_status = ANY (ARRAY['active'::text, 'suspended'::text]))"},{"kind":"p","name":"institutions_pkey","table":"institutions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"institutions_profile_school_id_check","table":"institutions","definition":"CHECK (profile_school_id = lower(btrim(profile_school_id)) AND profile_school_id ~ '^[a-z0-9][a-z0-9-]{1,179}$'::text)"},{"kind":"u","name":"institutions_profile_school_id_key","table":"institutions","definition":"UNIQUE (profile_school_id)"},{"kind":"f","name":"media_upload_intents_artifact_id_fkey","table":"media_upload_intents","definition":"FOREIGN KEY (artifact_id) REFERENCES examination_room_v1.proctoring_artifacts(id) ON DELETE RESTRICT"},{"kind":"c","name":"media_upload_intents_artifact_kind_check","table":"media_upload_intents","definition":"CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]))"},{"kind":"c","name":"media_upload_intents_capture_window_check","table":"media_upload_intents","definition":"CHECK (captured_to >= captured_from AND captured_to <= (captured_from + '00:15:00'::interval) AND retention_until > captured_to)"},{"kind":"c","name":"media_upload_intents_completion_request_hash_check","table":"media_upload_intents","definition":"CHECK (completion_request_hash IS NULL OR completion_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"media_upload_intents_encrypted_size_bytes_check","table":"media_upload_intents","definition":"CHECK (encrypted_size_bytes >= 1 AND encrypted_size_bytes <= 67108864)"},{"kind":"c","name":"media_upload_intents_intent_status_check","table":"media_upload_intents","definition":"CHECK (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text, 'completed'::text]))"},{"kind":"c","name":"media_upload_intents_object_sha256_check","table":"media_upload_intents","definition":"CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"media_upload_intents_pkey","table":"media_upload_intents","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"media_upload_intents_provider_check","table":"media_upload_intents","definition":"CHECK (provider = ANY (ARRAY['google_drive'::text, 'supabase_storage'::text, 'local_queue'::text]))"},{"kind":"c","name":"media_upload_intents_provider_object_reference_check","table":"media_upload_intents","definition":"CHECK (length(btrim(provider_object_reference)) >= 8 AND length(btrim(provider_object_reference)) <= 1024 AND provider_object_reference !~* '(token|secret|authorization|credential|password)='::text AND provider_object_reference !~* '^https?://'::text)"},{"kind":"c","name":"media_upload_intents_provider_result_check","table":"media_upload_intents","definition":"CHECK (jsonb_typeof(provider_result) = 'object'::text AND provider_result::text !~* '\"(url|token|secret|authorization|credential|password|accessToken|refreshToken|signedUrl)\"[[:space:]]*:'::text)"},{"kind":"c","name":"media_upload_intents_request_hash_check","table":"media_upload_intents","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"media_upload_intents_session_artifact_key","table":"media_upload_intents","definition":"UNIQUE (session_id, client_artifact_id)"},{"kind":"f","name":"media_upload_intents_session_id_fkey","table":"media_upload_intents","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"u","name":"media_upload_intents_session_request_key","table":"media_upload_intents","definition":"UNIQUE (session_id, request_hash)"},{"kind":"c","name":"media_upload_intents_source_mime_type_check","table":"media_upload_intents","definition":"CHECK (length(btrim(source_mime_type)) >= 3 AND length(btrim(source_mime_type)) <= 160)"},{"kind":"c","name":"media_upload_intents_status_check","table":"media_upload_intents","definition":"CHECK (intent_status = 'completed'::text AND artifact_id IS NOT NULL AND completion_request_hash IS NOT NULL AND completed_at IS NOT NULL OR intent_status <> 'completed'::text AND artifact_id IS NULL AND completed_at IS NULL)"},{"kind":"c","name":"media_upload_intents_wrapped_key_aad_sha256_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_aad_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_algorithm_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_algorithm = 'aes-256-gcm-v1'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_ciphertext_check","table":"media_upload_intents","definition":"CHECK (length(wrapped_key_ciphertext) >= 43 AND length(wrapped_key_ciphertext) <= 128 AND wrapped_key_ciphertext ~ '^[A-Za-z0-9_-]+$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_iv_check","table":"media_upload_intents","definition":"CHECK (length(wrapped_key_iv) >= 16 AND length(wrapped_key_iv) <= 32 AND wrapped_key_iv ~ '^[A-Za-z0-9_-]+$'::text)"},{"kind":"c","name":"media_upload_intents_wrapped_key_version_check","table":"media_upload_intents","definition":"CHECK (wrapped_key_version = 1)"},{"kind":"c","name":"owner_identity_corrections_after_record_check","table":"owner_identity_corrections","definition":"CHECK (jsonb_typeof(after_record) = 'object'::text)"},{"kind":"c","name":"owner_identity_corrections_before_record_check","table":"owner_identity_corrections","definition":"CHECK (jsonb_typeof(before_record) = 'object'::text)"},{"kind":"f","name":"owner_identity_corrections_exam_scope_fk","table":"owner_identity_corrections","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"owner_identity_corrections_identity_scope_fk","table":"owner_identity_corrections","definition":"FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT"},{"kind":"f","name":"owner_identity_corrections_institution_id_fkey","table":"owner_identity_corrections","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"owner_identity_corrections_pkey","table":"owner_identity_corrections","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"owner_identity_corrections_reason_check","table":"owner_identity_corrections","definition":"CHECK (length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 1000)"},{"kind":"c","name":"owner_identity_corrections_request_hash_check","table":"owner_identity_corrections","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"owner_identity_corrections_request_hash_key","table":"owner_identity_corrections","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"owner_key_envelopes_aad_sha256_check","table":"owner_key_envelopes","definition":"CHECK (aad_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"owner_key_envelopes_activation_id_fkey","table":"owner_key_envelopes","definition":"FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT"},{"kind":"c","name":"owner_key_envelopes_ciphertext_base64_check","table":"owner_key_envelopes","definition":"CHECK (length(ciphertext_base64) >= 24 AND length(ciphertext_base64) <= 4096)"},{"kind":"c","name":"owner_key_envelopes_envelope_algorithm_check","table":"owner_key_envelopes","definition":"CHECK (envelope_algorithm = 'aes-256-gcm-v1'::text)"},{"kind":"f","name":"owner_key_envelopes_exam_scope_fk","table":"owner_key_envelopes","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"owner_key_envelopes_iv_base64_check","table":"owner_key_envelopes","definition":"CHECK (length(iv_base64) >= 16 AND length(iv_base64) <= 64)"},{"kind":"c","name":"owner_key_envelopes_key_version_check","table":"owner_key_envelopes","definition":"CHECK (key_version > 0)"},{"kind":"p","name":"owner_key_envelopes_pkey","table":"owner_key_envelopes","definition":"PRIMARY KEY (activation_id)"},{"kind":"c","name":"privacy_acceptances_accepted_features_check","table":"privacy_acceptances","definition":"CHECK (jsonb_typeof(accepted_features) = 'object'::text)"},{"kind":"c","name":"privacy_acceptances_capture_method_check","table":"privacy_acceptances","definition":"CHECK (capture_method = ANY (ARRAY['checkbox'::text, 'signed_notice'::text, 'admin_recorded'::text]))"},{"kind":"c","name":"privacy_acceptances_decision_check","table":"privacy_acceptances","definition":"CHECK (decision = ANY (ARRAY['accepted'::text, 'withdrawn'::text]))"},{"kind":"c","name":"privacy_acceptances_evidence_sha256_check","table":"privacy_acceptances","definition":"CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"privacy_acceptances_id_subject_key","table":"privacy_acceptances","definition":"UNIQUE (id, roster_id, notice_version_id, session_id, exam_version_id)"},{"kind":"f","name":"privacy_acceptances_notice_version_id_fkey","table":"privacy_acceptances","definition":"FOREIGN KEY (notice_version_id) REFERENCES examination_room_v1.privacy_notice_versions(id) ON DELETE RESTRICT"},{"kind":"p","name":"privacy_acceptances_pkey","table":"privacy_acceptances","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"privacy_acceptances_prior_required_check","table":"privacy_acceptances","definition":"CHECK (decision = 'accepted'::text AND prior_acceptance_id IS NULL OR decision = 'withdrawn'::text AND prior_acceptance_id IS NOT NULL)"},{"kind":"f","name":"privacy_acceptances_prior_same_subject_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (prior_acceptance_id, roster_id, notice_version_id, session_id, exam_version_id) REFERENCES examination_room_v1.privacy_acceptances(id, roster_id, notice_version_id, session_id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"privacy_acceptances_roster_id_fkey","table":"privacy_acceptances","definition":"FOREIGN KEY (roster_id) REFERENCES examination_room_v1.exam_roster(id) ON DELETE RESTRICT"},{"kind":"u","name":"privacy_acceptances_session_event_key","table":"privacy_acceptances","definition":"UNIQUE (session_id, client_event_id)"},{"kind":"f","name":"privacy_acceptances_session_roster_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (session_id, roster_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, roster_id, exam_version_id) ON DELETE RESTRICT"},{"kind":"f","name":"privacy_acceptances_version_notice_fk","table":"privacy_acceptances","definition":"FOREIGN KEY (exam_version_id, notice_version_id) REFERENCES examination_room_v1.exam_versions(id, privacy_notice_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"privacy_notice_versions_body_sha256_check","table":"privacy_notice_versions","definition":"CHECK (body_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"privacy_notice_versions_id_institution_key","table":"privacy_notice_versions","definition":"UNIQUE (id, institution_id)"},{"kind":"u","name":"privacy_notice_versions_institution_code_version_key","table":"privacy_notice_versions","definition":"UNIQUE (institution_id, notice_code, version_number)"},{"kind":"f","name":"privacy_notice_versions_institution_id_fkey","table":"privacy_notice_versions","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"privacy_notice_versions_notice_body_check","table":"privacy_notice_versions","definition":"CHECK (length(btrim(notice_body)) > 0)"},{"kind":"c","name":"privacy_notice_versions_notice_code_check","table":"privacy_notice_versions","definition":"CHECK (notice_code = lower(btrim(notice_code)) AND notice_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text)"},{"kind":"p","name":"privacy_notice_versions_pkey","table":"privacy_notice_versions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"privacy_notice_versions_processing_purposes_check","table":"privacy_notice_versions","definition":"CHECK (jsonb_typeof(processing_purposes) = 'array'::text)"},{"kind":"c","name":"privacy_notice_versions_title_check","table":"privacy_notice_versions","definition":"CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 240)"},{"kind":"c","name":"privacy_notice_versions_version_number_check","table":"privacy_notice_versions","definition":"CHECK (version_number > 0)"},{"kind":"c","name":"proctoring_artifacts_artifact_kind_check","table":"proctoring_artifacts","definition":"CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]))"},{"kind":"c","name":"proctoring_artifacts_artifact_status_check","table":"proctoring_artifacts","definition":"CHECK (artifact_status = ANY (ARRAY['uploading'::text, 'available'::text, 'quarantined'::text, 'deleted'::text]))"},{"kind":"c","name":"proctoring_artifacts_capture_window_check","table":"proctoring_artifacts","definition":"CHECK (captured_to >= captured_from)"},{"kind":"c","name":"proctoring_artifacts_encrypted_object_reference_check","table":"proctoring_artifacts","definition":"CHECK (length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024)"},{"kind":"c","name":"proctoring_artifacts_encryption_key_reference_check","table":"proctoring_artifacts","definition":"CHECK (length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512)"},{"kind":"f","name":"proctoring_artifacts_incident_session_fk","table":"proctoring_artifacts","definition":"FOREIGN KEY (incident_id, session_id) REFERENCES examination_room_v1.proctoring_incidents(id, session_id) ON DELETE RESTRICT"},{"kind":"u","name":"proctoring_artifacts_object_reference_key","table":"proctoring_artifacts","definition":"UNIQUE (encrypted_object_reference)"},{"kind":"c","name":"proctoring_artifacts_object_sha256_check","table":"proctoring_artifacts","definition":"CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"proctoring_artifacts_pkey","table":"proctoring_artifacts","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"proctoring_artifacts_retention_check","table":"proctoring_artifacts","definition":"CHECK (retention_until > captured_to)"},{"kind":"f","name":"proctoring_artifacts_session_id_fkey","table":"proctoring_artifacts","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"proctoring_incidents_details_check","table":"proctoring_incidents","definition":"CHECK (jsonb_typeof(details) = 'object'::text AND details::text !~* '\"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)\"[[:space:]]*:'::text)"},{"kind":"c","name":"proctoring_incidents_duration_ms_check","table":"proctoring_incidents","definition":"CHECK (duration_ms IS NULL OR duration_ms >= 0)"},{"kind":"u","name":"proctoring_incidents_id_session_key","table":"proctoring_incidents","definition":"UNIQUE (id, session_id)"},{"kind":"c","name":"proctoring_incidents_incident_kind_check","table":"proctoring_incidents","definition":"CHECK (incident_kind = ANY (ARRAY['focus_lost'::text, 'fullscreen_exit'::text, 'camera_interrupted'::text, 'microphone_interrupted'::text, 'network_disconnected'::text, 'device_changed'::text, 'clock_anomaly'::text, 'other'::text]))"},{"kind":"p","name":"proctoring_incidents_pkey","table":"proctoring_incidents","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"proctoring_incidents_review_check","table":"proctoring_incidents","definition":"CHECK (review_status = 'unreviewed'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL OR review_status <> 'unreviewed'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)"},{"kind":"c","name":"proctoring_incidents_review_status_check","table":"proctoring_incidents","definition":"CHECK (review_status = ANY (ARRAY['unreviewed'::text, 'benign'::text, 'escalated'::text, 'dismissed'::text]))"},{"kind":"u","name":"proctoring_incidents_session_event_key","table":"proctoring_incidents","definition":"UNIQUE (session_id, client_event_id)"},{"kind":"f","name":"proctoring_incidents_session_id_fkey","table":"proctoring_incidents","definition":"FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"proctoring_incidents_severity_check","table":"proctoring_incidents","definition":"CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))"},{"kind":"c","name":"proctoring_incidents_source_check","table":"proctoring_incidents","definition":"CHECK (source = ANY (ARRAY['browser_signal'::text, 'proctor_report'::text, 'system_rule'::text, 'student_report'::text]))"},{"kind":"f","name":"professor_access_requests_approved_membership_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (approved_membership_id) REFERENCES examination_room_v1.staff_memberships(id) ON DELETE RESTRICT"},{"kind":"f","name":"professor_access_requests_assigned_institution_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (assigned_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"professor_access_requests_claimed_school_id_check","table":"professor_access_requests","definition":"CHECK (claimed_school_id = lower(btrim(claimed_school_id)) AND length(claimed_school_id) >= 1 AND length(claimed_school_id) <= 180)"},{"kind":"c","name":"professor_access_requests_claimed_school_name_check","table":"professor_access_requests","definition":"CHECK (length(btrim(claimed_school_name)) >= 2 AND length(btrim(claimed_school_name)) <= 240)"},{"kind":"c","name":"professor_access_requests_display_name_check","table":"professor_access_requests","definition":"CHECK (length(btrim(display_name)) >= 2 AND length(btrim(display_name)) <= 240)"},{"kind":"c","name":"professor_access_requests_email_normalized_check","table":"professor_access_requests","definition":"CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"p","name":"professor_access_requests_pkey","table":"professor_access_requests","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"professor_access_requests_request_status_check","table":"professor_access_requests","definition":"CHECK (request_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))"},{"kind":"f","name":"professor_access_requests_requested_institution_id_fkey","table":"professor_access_requests","definition":"FOREIGN KEY (requested_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"professor_access_requests_review_check","table":"professor_access_requests","definition":"CHECK (request_status = 'pending'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'rejected'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NULL OR request_status = 'cancelled'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'approved'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NOT NULL)"},{"kind":"c","name":"professor_access_requests_review_reason_check","table":"professor_access_requests","definition":"CHECK (review_reason IS NULL OR length(btrim(review_reason)) >= 5 AND length(btrim(review_reason)) <= 1000)"},{"kind":"c","name":"questions_configuration_check","table":"questions","definition":"CHECK (jsonb_typeof(configuration) = 'object'::text)"},{"kind":"c","name":"questions_content_sha256_check","table":"questions","definition":"CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"questions_exam_version_id_fkey","table":"questions","definition":"FOREIGN KEY (exam_version_id) REFERENCES examination_room_v1.exam_versions(id) ON DELETE RESTRICT"},{"kind":"u","name":"questions_id_version_key","table":"questions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"p","name":"questions_pkey","table":"questions","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"questions_points_check","table":"questions","definition":"CHECK (points >= 0::numeric)"},{"kind":"c","name":"questions_position_check","table":"questions","definition":"CHECK (\"position\" > 0)"},{"kind":"c","name":"questions_prompt_check","table":"questions","definition":"CHECK (length(btrim(prompt)) > 0)"},{"kind":"c","name":"questions_question_key_check","table":"questions","definition":"CHECK (question_key ~ '^q[0-9]{3}$'::text)"},{"kind":"c","name":"questions_question_kind_check","table":"questions","definition":"CHECK (question_kind = ANY (ARRAY['essay'::text, 'short_answer'::text, 'multiple_choice'::text, 'true_false'::text, 'file_upload'::text]))"},{"kind":"u","name":"questions_version_key_key","table":"questions","definition":"UNIQUE (exam_version_id, question_key)"},{"kind":"u","name":"questions_version_position_key","table":"questions","definition":"UNIQUE (exam_version_id, \"position\")"},{"kind":"c","name":"recovery_snapshots_encrypted_object_reference_check","table":"recovery_snapshots","definition":"CHECK (encrypted_object_reference IS NULL OR length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024)"},{"kind":"c","name":"recovery_snapshots_encryption_key_reference_check","table":"recovery_snapshots","definition":"CHECK (encryption_key_reference IS NULL OR length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512)"},{"kind":"u","name":"recovery_snapshots_exam_sequence_key","table":"recovery_snapshots","definition":"UNIQUE (exam_id, snapshot_sequence)"},{"kind":"c","name":"recovery_snapshots_last_error_code_check","table":"recovery_snapshots","definition":"CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{2,100}$'::text)"},{"kind":"c","name":"recovery_snapshots_lease_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status = 'materializing'::text AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL OR snapshot_status <> 'materializing'::text AND lease_id IS NULL AND lease_expires_at IS NULL)"},{"kind":"c","name":"recovery_snapshots_materialization_attempts_check","table":"recovery_snapshots","definition":"CHECK (materialization_attempts >= 0)"},{"kind":"c","name":"recovery_snapshots_materialization_check","table":"recovery_snapshots","definition":"CHECK ((snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'failed'::text])) AND encrypted_object_reference IS NULL AND snapshot_sha256 IS NULL AND encryption_key_reference IS NULL AND available_at IS NULL OR (snapshot_status = ANY (ARRAY['available'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text])) AND encrypted_object_reference IS NOT NULL AND snapshot_sha256 IS NOT NULL AND encryption_key_reference IS NOT NULL AND available_at IS NOT NULL)"},{"kind":"u","name":"recovery_snapshots_object_reference_key","table":"recovery_snapshots","definition":"UNIQUE (encrypted_object_reference)"},{"kind":"p","name":"recovery_snapshots_pkey","table":"recovery_snapshots","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"recovery_snapshots_record_count_check","table":"recovery_snapshots","definition":"CHECK (record_count >= 0)"},{"kind":"c","name":"recovery_snapshots_request_hash_check","table":"recovery_snapshots","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"recovery_snapshots_request_hash_key","table":"recovery_snapshots","definition":"UNIQUE (request_hash)"},{"kind":"c","name":"recovery_snapshots_restore_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status <> 'restored'::text AND restored_at IS NULL AND restored_by_user_id IS NULL OR snapshot_status = 'restored'::text AND restored_at IS NOT NULL AND restored_by_user_id IS NOT NULL)"},{"kind":"c","name":"recovery_snapshots_restore_verification_sha256_check","table":"recovery_snapshots","definition":"CHECK (restore_verification_sha256 IS NULL OR restore_verification_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"recovery_snapshots_restored_record_count_check","table":"recovery_snapshots","definition":"CHECK (restored_record_count >= 0)"},{"kind":"c","name":"recovery_snapshots_retention_check","table":"recovery_snapshots","definition":"CHECK (retention_until > created_at)"},{"kind":"c","name":"recovery_snapshots_snapshot_scope_check","table":"recovery_snapshots","definition":"CHECK (snapshot_scope = ANY (ARRAY['exam_definition'::text, 'answer_state'::text, 'grading_state'::text, 'full_recovery'::text]))"},{"kind":"c","name":"recovery_snapshots_snapshot_sequence_check","table":"recovery_snapshots","definition":"CHECK (snapshot_sequence > 0)"},{"kind":"c","name":"recovery_snapshots_snapshot_sha256_check","table":"recovery_snapshots","definition":"CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"recovery_snapshots_snapshot_status_check","table":"recovery_snapshots","definition":"CHECK (snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'available'::text, 'failed'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text]))"},{"kind":"f","name":"recovery_snapshots_source_grade_revision_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_grade_revision_id) REFERENCES examination_room_v1.grade_revisions(id) ON DELETE RESTRICT"},{"kind":"c","name":"recovery_snapshots_source_kind_check","table":"recovery_snapshots","definition":"CHECK (source_kind IS NULL OR (source_kind = ANY (ARRAY['publication'::text, 'submission'::text, 'grade_revision'::text, 'result_release'::text, 'manual'::text])))"},{"kind":"f","name":"recovery_snapshots_source_result_release_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_result_release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_source_session_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_source_submission_id_fkey","table":"recovery_snapshots","definition":"FOREIGN KEY (source_submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"f","name":"recovery_snapshots_version_exam_fk","table":"recovery_snapshots","definition":"FOREIGN KEY (exam_version_id, exam_id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT"},{"kind":"u","name":"result_email_delivery_batch_release_unique","table":"result_email_delivery_events","definition":"UNIQUE (batch_request_hash, release_id)"},{"kind":"c","name":"result_email_delivery_claim_shape","table":"result_email_delivery_events","definition":"CHECK (delivery_status = 'pending'::text AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL OR delivery_status <> 'pending'::text AND claim_token IS NULL AND lease_expires_at IS NULL)"},{"kind":"c","name":"result_email_delivery_events_attempt_count_check","table":"result_email_delivery_events","definition":"CHECK (attempt_count >= 0)"},{"kind":"c","name":"result_email_delivery_events_batch_request_hash_check","table":"result_email_delivery_events","definition":"CHECK (batch_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_email_delivery_events_check","table":"result_email_delivery_events","definition":"CHECK (maximum_score >= total_score)"},{"kind":"c","name":"result_email_delivery_events_delivery_status_check","table":"result_email_delivery_events","definition":"CHECK (delivery_status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text, 'skipped'::text]))"},{"kind":"c","name":"result_email_delivery_events_exam_title_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(exam_title)) >= 1 AND length(btrim(exam_title)) <= 300)"},{"kind":"f","name":"result_email_delivery_events_institution_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"result_email_delivery_events_pkey","table":"result_email_delivery_events","definition":"PRIMARY KEY (release_id)"},{"kind":"c","name":"result_email_delivery_events_provider_id_check","table":"result_email_delivery_events","definition":"CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240)"},{"kind":"c","name":"result_email_delivery_events_recipient_email_check","table":"result_email_delivery_events","definition":"CHECK (recipient_email IS NULL OR recipient_email = lower(btrim(recipient_email)) AND POSITION(('@'::text) IN (recipient_email)) > 1 AND length(recipient_email) >= 3 AND length(recipient_email) <= 320)"},{"kind":"c","name":"result_email_delivery_events_recipient_name_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(recipient_name)) >= 1 AND length(btrim(recipient_name)) <= 240)"},{"kind":"f","name":"result_email_delivery_events_release_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT"},{"kind":"c","name":"result_email_delivery_events_safe_error_code_check","table":"result_email_delivery_events","definition":"CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text)"},{"kind":"f","name":"result_email_delivery_events_student_session_id_fkey","table":"result_email_delivery_events","definition":"FOREIGN KEY (student_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT"},{"kind":"c","name":"result_email_delivery_events_subject_name_check","table":"result_email_delivery_events","definition":"CHECK (length(btrim(subject_name)) >= 1 AND length(btrim(subject_name)) <= 200)"},{"kind":"c","name":"result_email_delivery_events_total_score_check","table":"result_email_delivery_events","definition":"CHECK (total_score >= 0::numeric)"},{"kind":"f","name":"result_email_delivery_exam_scope_fk","table":"result_email_delivery_events","definition":"FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"result_releases_action_check","table":"result_releases","definition":"CHECK (release_action = 'release'::text AND grade_revision_id IS NOT NULL AND supersedes_release_id IS NULL AND manifest_sha256 IS NOT NULL AND release_manifest IS NOT NULL OR release_action = 'revoke'::text AND grade_revision_id IS NULL AND supersedes_release_id IS NOT NULL AND reason IS NOT NULL AND manifest_sha256 IS NULL AND release_manifest IS NULL)"},{"kind":"c","name":"result_releases_batch_request_hash_check","table":"result_releases","definition":"CHECK (batch_request_hash IS NULL OR batch_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_releases_channel_check","table":"result_releases","definition":"CHECK (channel = ANY (ARRAY['student_portal'::text, 'email_notice'::text, 'offline_export'::text]))"},{"kind":"c","name":"result_releases_delivery_reference_hash_check","table":"result_releases","definition":"CHECK (delivery_reference_hash IS NULL OR delivery_reference_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"result_releases_grade_same_submission_fk","table":"result_releases","definition":"FOREIGN KEY (grade_revision_id, submission_id) REFERENCES examination_room_v1.grade_revisions(id, submission_id) ON DELETE RESTRICT"},{"kind":"u","name":"result_releases_id_submission_key","table":"result_releases","definition":"UNIQUE (id, submission_id)"},{"kind":"u","name":"result_releases_idempotency_hash_key","table":"result_releases","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"c","name":"result_releases_idempotency_key_hash_check","table":"result_releases","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"result_releases_manifest_sha256_check","table":"result_releases","definition":"CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"result_releases_pkey","table":"result_releases","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"result_releases_release_action_check","table":"result_releases","definition":"CHECK (release_action = ANY (ARRAY['release'::text, 'revoke'::text]))"},{"kind":"c","name":"result_releases_release_manifest_check","table":"result_releases","definition":"CHECK (release_manifest IS NULL OR jsonb_typeof(release_manifest) = 'object'::text AND (release_manifest ->> 'schemaVersion'::text) = 'examination-room/result-release/v1'::text)"},{"kind":"f","name":"result_releases_submission_id_fkey","table":"result_releases","definition":"FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"f","name":"result_releases_supersedes_same_submission_fk","table":"result_releases","definition":"FOREIGN KEY (supersedes_release_id, submission_id) REFERENCES examination_room_v1.result_releases(id, submission_id) ON DELETE RESTRICT"},{"kind":"c","name":"room_activations_activation_status_check","table":"room_activations","definition":"CHECK (activation_status = ANY (ARRAY['scheduled'::text, 'open'::text, 'closed'::text, 'revoked'::text]))"},{"kind":"c","name":"room_activations_deactivation_check","table":"room_activations","definition":"CHECK (deactivated_at IS NULL AND deactivated_by_user_id IS NULL OR deactivated_at IS NOT NULL AND deactivated_by_user_id IS NOT NULL AND deactivated_at >= created_at)"},{"kind":"u","name":"room_activations_id_exam_version_key","table":"room_activations","definition":"UNIQUE (id, exam_id, exam_version_id, institution_id)"},{"kind":"c","name":"room_activations_key_hash_algorithm_check","table":"room_activations","definition":"CHECK (key_hash_algorithm = ANY (ARRAY['hmac-sha256-v1'::text, 'argon2id-v1'::text]))"},{"kind":"c","name":"room_activations_key_hash_format_check","table":"room_activations","definition":"CHECK (key_hash_algorithm = 'hmac-sha256-v1'::text AND key_hash ~ '^[0-9a-f]{64}$'::text OR key_hash_algorithm = 'argon2id-v1'::text AND key_hash ~~ '$argon2id$%'::text AND length(key_hash) >= 40 AND length(key_hash) <= 255)"},{"kind":"u","name":"room_activations_key_hash_key","table":"room_activations","definition":"UNIQUE (key_hash)"},{"kind":"c","name":"room_activations_max_sessions_check","table":"room_activations","definition":"CHECK (max_sessions IS NULL OR max_sessions > 0)"},{"kind":"p","name":"room_activations_pkey","table":"room_activations","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"room_activations_request_hash_check","table":"room_activations","definition":"CHECK (request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"room_activations_request_hash_key","table":"room_activations","definition":"UNIQUE (request_hash)"},{"kind":"f","name":"room_activations_version_exam_fk","table":"room_activations","definition":"FOREIGN KEY (exam_version_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_versions(id, exam_id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"room_activations_window_check","table":"room_activations","definition":"CHECK (closes_at > opens_at)"},{"kind":"c","name":"staff_memberships_display_name_check","table":"staff_memberships","definition":"CHECK (display_name IS NULL OR length(btrim(display_name)) >= 1 AND length(btrim(display_name)) <= 240)"},{"kind":"c","name":"staff_memberships_email_normalized_check","table":"staff_memberships","definition":"CHECK (email_normalized IS NULL OR email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"c","name":"staff_memberships_grant_reason_check","table":"staff_memberships","definition":"CHECK (length(btrim(grant_reason)) >= 5 AND length(btrim(grant_reason)) <= 1000)"},{"kind":"f","name":"staff_memberships_institution_id_fkey","table":"staff_memberships","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"c","name":"staff_memberships_membership_status_check","table":"staff_memberships","definition":"CHECK (membership_status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text]))"},{"kind":"p","name":"staff_memberships_pkey","table":"staff_memberships","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"staff_memberships_revocation_check","table":"staff_memberships","definition":"CHECK (membership_status <> 'revoked'::text AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL OR membership_status = 'revoked'::text AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)"},{"kind":"c","name":"staff_memberships_staff_role_check","table":"staff_memberships","definition":"CHECK (staff_role = ANY (ARRAY['professor'::text, 'admin'::text]))"},{"kind":"c","name":"student_identities_email_normalized_check","table":"student_identities","definition":"CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1)"},{"kind":"u","name":"student_identities_external_key","table":"student_identities","definition":"UNIQUE (institution_id, external_student_id)"},{"kind":"c","name":"student_identities_external_student_id_check","table":"student_identities","definition":"CHECK (length(btrim(external_student_id)) >= 1 AND length(btrim(external_student_id)) <= 128)"},{"kind":"c","name":"student_identities_full_name_check","table":"student_identities","definition":"CHECK (length(btrim(full_name)) >= 1 AND length(btrim(full_name)) <= 240)"},{"kind":"u","name":"student_identities_id_institution_key","table":"student_identities","definition":"UNIQUE (id, institution_id)"},{"kind":"c","name":"student_identities_identity_status_check","table":"student_identities","definition":"CHECK (identity_status = ANY (ARRAY['active'::text, 'inactive'::text, 'merged'::text]))"},{"kind":"f","name":"student_identities_institution_id_fkey","table":"student_identities","definition":"FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT"},{"kind":"p","name":"student_identities_pkey","table":"student_identities","definition":"PRIMARY KEY (id)"},{"kind":"c","name":"student_identities_verification_method_check","table":"student_identities","definition":"CHECK (verification_method IS NULL OR (verification_method = ANY (ARRAY['institution_sso'::text, 'registrar_import'::text, 'admin_review'::text])))"},{"kind":"f","name":"student_sessions_activation_fk","table":"student_sessions","definition":"FOREIGN KEY (activation_id, exam_id, exam_version_id, institution_id) REFERENCES examination_room_v1.room_activations(id, exam_id, exam_version_id, institution_id) ON DELETE RESTRICT"},{"kind":"u","name":"student_sessions_activation_roster_key","table":"student_sessions","definition":"UNIQUE (activation_id, roster_id)"},{"kind":"c","name":"student_sessions_consent_request_hash_check","table":"student_sessions","definition":"CHECK (consent_request_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"student_sessions_consent_request_hash_key","table":"student_sessions","definition":"UNIQUE (consent_request_hash)"},{"kind":"u","name":"student_sessions_id_institution_exam_key","table":"student_sessions","definition":"UNIQUE (id, institution_id, exam_id)"},{"kind":"u","name":"student_sessions_id_roster_key","table":"student_sessions","definition":"UNIQUE (id, roster_id)"},{"kind":"u","name":"student_sessions_id_roster_version_key","table":"student_sessions","definition":"UNIQUE (id, roster_id, exam_version_id)"},{"kind":"u","name":"student_sessions_id_version_key","table":"student_sessions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"student_sessions_identity_verification_method_check","table":"student_sessions","definition":"CHECK (identity_verification_method IS NULL OR (identity_verification_method = ANY (ARRAY['signed_in_account'::text, 'room_key_roster_match'::text, 'admin_override'::text])))"},{"kind":"p","name":"student_sessions_pkey","table":"student_sessions","definition":"PRIMARY KEY (id)"},{"kind":"f","name":"student_sessions_roster_fk","table":"student_sessions","definition":"FOREIGN KEY (roster_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_roster(id, exam_id, institution_id) ON DELETE RESTRICT"},{"kind":"c","name":"student_sessions_session_metadata_check","table":"student_sessions","definition":"CHECK (jsonb_typeof(session_metadata) = 'object'::text)"},{"kind":"c","name":"student_sessions_session_status_check","table":"student_sessions","definition":"CHECK (session_status = ANY (ARRAY['created'::text, 'active'::text, 'submitted'::text, 'expired'::text, 'revoked'::text]))"},{"kind":"c","name":"student_sessions_session_token_hash_check","table":"student_sessions","definition":"CHECK (session_token_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"c","name":"student_sessions_timestamps_check","table":"student_sessions","definition":"CHECK (lease_expires_at > started_at AND (last_heartbeat_at IS NULL OR last_heartbeat_at >= started_at) AND (ended_at IS NULL OR ended_at >= started_at))"},{"kind":"u","name":"student_sessions_token_hash_key","table":"student_sessions","definition":"UNIQUE (session_token_hash)"},{"kind":"p","name":"submission_answers_pkey","table":"submission_answers","definition":"PRIMARY KEY (submission_id, question_id)"},{"kind":"u","name":"submission_answers_revision_key","table":"submission_answers","definition":"UNIQUE (answer_revision_id)"},{"kind":"f","name":"submission_answers_revision_session_question_fk","table":"submission_answers","definition":"FOREIGN KEY (answer_revision_id, session_id, question_id) REFERENCES examination_room_v1.answer_revisions(id, session_id, question_id) ON DELETE RESTRICT"},{"kind":"f","name":"submission_answers_submission_session_fk","table":"submission_answers","definition":"FOREIGN KEY (submission_id, session_id) REFERENCES examination_room_v1.submissions(id, session_id) ON DELETE RESTRICT"},{"kind":"p","name":"submission_receipts_pkey","table":"submission_receipts","definition":"PRIMARY KEY (id)"},{"kind":"u","name":"submission_receipts_receipt_code_key","table":"submission_receipts","definition":"UNIQUE (receipt_code)"},{"kind":"c","name":"submission_receipts_receipt_payload_check","table":"submission_receipts","definition":"CHECK (jsonb_typeof(receipt_payload) = 'object'::text)"},{"kind":"c","name":"submission_receipts_receipt_sha256_check","table":"submission_receipts","definition":"CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"f","name":"submission_receipts_submission_id_fkey","table":"submission_receipts","definition":"FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT"},{"kind":"u","name":"submission_receipts_submission_id_key","table":"submission_receipts","definition":"UNIQUE (submission_id)"},{"kind":"c","name":"submissions_answer_count_check","table":"submissions","definition":"CHECK (answer_count >= 0)"},{"kind":"c","name":"submissions_clock_skew_check","table":"submissions","definition":"CHECK (submitted_at_client <= (received_at + '24:00:00'::interval))"},{"kind":"u","name":"submissions_id_session_key","table":"submissions","definition":"UNIQUE (id, session_id)"},{"kind":"u","name":"submissions_id_version_key","table":"submissions","definition":"UNIQUE (id, exam_version_id)"},{"kind":"c","name":"submissions_idempotency_key_hash_check","table":"submissions","definition":"CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text)"},{"kind":"u","name":"submissions_idempotency_key_hash_key","table":"submissions","definition":"UNIQUE (idempotency_key_hash)"},{"kind":"c","name":"submissions_manifest_sha256_check","table":"submissions","definition":"CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)"},{"kind":"p","name":"submissions_pkey","table":"submissions","definition":"PRIMARY KEY (id)"},{"kind":"u","name":"submissions_session_key","table":"submissions","definition":"UNIQUE (session_id)"},{"kind":"f","name":"submissions_session_version_fk","table":"submissions","definition":"FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT"},{"kind":"c","name":"submissions_status_reason_check","table":"submissions","definition":"CHECK (submission_status = 'accepted'::text AND status_reason IS NULL OR submission_status <> 'accepted'::text AND status_reason IS NOT NULL)"},{"kind":"c","name":"submissions_submission_manifest_check","table":"submissions","definition":"CHECK (jsonb_typeof(submission_manifest) = 'object'::text AND (submission_manifest ->> 'schemaVersion'::text) = 'examination-room/submission/v1'::text)"},{"kind":"c","name":"submissions_submission_status_check","table":"submissions","definition":"CHECK (submission_status = ANY (ARRAY['accepted'::text, 'under_review'::text, 'voided'::text]))"}],"indexes":[{"name":"answer_revisions_id_session_question_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_id_session_question_key ON examination_room_v1.answer_revisions USING btree (id, session_id, question_id)"},{"name":"answer_revisions_idempotency_key_hash_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_idempotency_key_hash_key ON examination_room_v1.answer_revisions USING btree (idempotency_key_hash)"},{"name":"answer_revisions_latest_idx","table":"answer_revisions","definition":"CREATE INDEX answer_revisions_latest_idx ON examination_room_v1.answer_revisions USING btree (session_id, question_id, revision_number DESC)"},{"name":"answer_revisions_pkey","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_pkey ON examination_room_v1.answer_revisions USING btree (id)"},{"name":"answer_revisions_session_client_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_session_client_key ON examination_room_v1.answer_revisions USING btree (session_id, client_revision_id)"},{"name":"answer_revisions_session_question_number_key","table":"answer_revisions","definition":"CREATE UNIQUE INDEX answer_revisions_session_question_number_key ON examination_room_v1.answer_revisions USING btree (session_id, question_id, revision_number)"},{"name":"audit_events_exam_idx","table":"audit_events","definition":"CREATE INDEX audit_events_exam_idx ON examination_room_v1.audit_events USING btree (exam_id, occurred_at DESC) WHERE (exam_id IS NOT NULL)"},{"name":"audit_events_institution_hash_key","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_institution_hash_key ON examination_room_v1.audit_events USING btree (institution_id, event_hash)"},{"name":"audit_events_institution_idx","table":"audit_events","definition":"CREATE INDEX audit_events_institution_idx ON examination_room_v1.audit_events USING btree (institution_id, recorded_at DESC)"},{"name":"audit_events_institution_request_key","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_institution_request_key ON examination_room_v1.audit_events USING btree (institution_id, request_hash)"},{"name":"audit_events_pkey","table":"audit_events","definition":"CREATE UNIQUE INDEX audit_events_pkey ON examination_room_v1.audit_events USING btree (id)"},{"name":"audit_events_session_idx","table":"audit_events","definition":"CREATE INDEX audit_events_session_idx ON examination_room_v1.audit_events USING btree (session_id, occurred_at DESC) WHERE (session_id IS NOT NULL)"},{"name":"email_delivery_events_exam_time_idx","table":"email_delivery_events","definition":"CREATE INDEX email_delivery_events_exam_time_idx ON examination_room_v1.email_delivery_events USING btree (exam_id, attempted_at DESC)"},{"name":"email_delivery_events_pkey","table":"email_delivery_events","definition":"CREATE UNIQUE INDEX email_delivery_events_pkey ON examination_room_v1.email_delivery_events USING btree (id)"},{"name":"email_delivery_events_request_hash_key","table":"email_delivery_events","definition":"CREATE UNIQUE INDEX email_delivery_events_request_hash_key ON examination_room_v1.email_delivery_events USING btree (request_hash)"},{"name":"exam_roster_exam_student_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_exam_student_key ON examination_room_v1.exam_roster USING btree (exam_id, student_identity_id)"},{"name":"exam_roster_grading_alias_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_grading_alias_key ON examination_room_v1.exam_roster USING btree (exam_id, grading_alias) WHERE (grading_alias IS NOT NULL)"},{"name":"exam_roster_id_exam_institution_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_id_exam_institution_key ON examination_room_v1.exam_roster USING btree (id, exam_id, institution_id)"},{"name":"exam_roster_id_exam_key","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_id_exam_key ON examination_room_v1.exam_roster USING btree (id, exam_id)"},{"name":"exam_roster_pkey","table":"exam_roster","definition":"CREATE UNIQUE INDEX exam_roster_pkey ON examination_room_v1.exam_roster USING btree (id)"},{"name":"exam_roster_status_idx","table":"exam_roster","definition":"CREATE INDEX exam_roster_status_idx ON examination_room_v1.exam_roster USING btree (exam_id, roster_status)"},{"name":"exam_versions_exam_version_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_exam_version_key ON examination_room_v1.exam_versions USING btree (exam_id, version_number)"},{"name":"exam_versions_id_exam_institution_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_exam_institution_key ON examination_room_v1.exam_versions USING btree (id, exam_id, institution_id)"},{"name":"exam_versions_id_exam_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_exam_key ON examination_room_v1.exam_versions USING btree (id, exam_id)"},{"name":"exam_versions_id_notice_key","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_id_notice_key ON examination_room_v1.exam_versions USING btree (id, privacy_notice_version_id)"},{"name":"exam_versions_pkey","table":"exam_versions","definition":"CREATE UNIQUE INDEX exam_versions_pkey ON examination_room_v1.exam_versions USING btree (id)"},{"name":"exam_versions_published_idx","table":"exam_versions","definition":"CREATE INDEX exam_versions_published_idx ON examination_room_v1.exam_versions USING btree (exam_id, published_at DESC)"},{"name":"exams_admin_lifecycle_idx","table":"exams","definition":"CREATE INDEX exams_admin_lifecycle_idx ON examination_room_v1.exams USING btree (institution_id, deleted_at, blocked_at, updated_at DESC)"},{"name":"exams_id_institution_key","table":"exams","definition":"CREATE UNIQUE INDEX exams_id_institution_key ON examination_room_v1.exams USING btree (id, institution_id)"},{"name":"exams_owner_active_lifecycle_idx","table":"exams","definition":"CREATE INDEX exams_owner_active_lifecycle_idx ON examination_room_v1.exams USING btree (owner_user_id, updated_at DESC) WHERE (deleted_at IS NULL)"},{"name":"exams_owner_status_idx","table":"exams","definition":"CREATE INDEX exams_owner_status_idx ON examination_room_v1.exams USING btree (institution_id, owner_user_id, status)"},{"name":"exams_pkey","table":"exams","definition":"CREATE UNIQUE INDEX exams_pkey ON examination_room_v1.exams USING btree (id)"},{"name":"grade_revision_items_pkey","table":"grade_revision_items","definition":"CREATE UNIQUE INDEX grade_revision_items_pkey ON examination_room_v1.grade_revision_items USING btree (grade_revision_id, question_id)"},{"name":"grade_revisions_id_submission_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_id_submission_key ON examination_room_v1.grade_revisions USING btree (id, submission_id)"},{"name":"grade_revisions_id_version_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_id_version_key ON examination_room_v1.grade_revisions USING btree (id, exam_version_id)"},{"name":"grade_revisions_latest_idx","table":"grade_revisions","definition":"CREATE INDEX grade_revisions_latest_idx ON examination_room_v1.grade_revisions USING btree (submission_id, revision_number DESC)"},{"name":"grade_revisions_pkey","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_pkey ON examination_room_v1.grade_revisions USING btree (id)"},{"name":"grade_revisions_submission_client_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_submission_client_key ON examination_room_v1.grade_revisions USING btree (submission_id, client_revision_id)"},{"name":"grade_revisions_submission_revision_key","table":"grade_revisions","definition":"CREATE UNIQUE INDEX grade_revisions_submission_revision_key ON examination_room_v1.grade_revisions USING btree (submission_id, revision_number)"},{"name":"institutions_bootstrap_request_hash_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_bootstrap_request_hash_key ON examination_room_v1.institutions USING btree (bootstrap_request_hash)"},{"name":"institutions_institution_code_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_institution_code_key ON examination_room_v1.institutions USING btree (institution_code)"},{"name":"institutions_pkey","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_pkey ON examination_room_v1.institutions USING btree (id)"},{"name":"institutions_profile_school_id_key","table":"institutions","definition":"CREATE UNIQUE INDEX institutions_profile_school_id_key ON examination_room_v1.institutions USING btree (profile_school_id)"},{"name":"media_upload_intents_pending_idx","table":"media_upload_intents","definition":"CREATE INDEX media_upload_intents_pending_idx ON examination_room_v1.media_upload_intents USING btree (intent_status, updated_at) WHERE (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text]))"},{"name":"media_upload_intents_pkey","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_pkey ON examination_room_v1.media_upload_intents USING btree (id)"},{"name":"media_upload_intents_session_artifact_key","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_session_artifact_key ON examination_room_v1.media_upload_intents USING btree (session_id, client_artifact_id)"},{"name":"media_upload_intents_session_request_key","table":"media_upload_intents","definition":"CREATE UNIQUE INDEX media_upload_intents_session_request_key ON examination_room_v1.media_upload_intents USING btree (session_id, request_hash)"},{"name":"media_upload_intents_session_status_idx","table":"media_upload_intents","definition":"CREATE INDEX media_upload_intents_session_status_idx ON examination_room_v1.media_upload_intents USING btree (session_id, intent_status, prepared_at DESC)"},{"name":"owner_identity_corrections_pkey","table":"owner_identity_corrections","definition":"CREATE UNIQUE INDEX owner_identity_corrections_pkey ON examination_room_v1.owner_identity_corrections USING btree (id)"},{"name":"owner_identity_corrections_request_hash_key","table":"owner_identity_corrections","definition":"CREATE UNIQUE INDEX owner_identity_corrections_request_hash_key ON examination_room_v1.owner_identity_corrections USING btree (request_hash)"},{"name":"owner_key_envelopes_pkey","table":"owner_key_envelopes","definition":"CREATE UNIQUE INDEX owner_key_envelopes_pkey ON examination_room_v1.owner_key_envelopes USING btree (activation_id)"},{"name":"privacy_acceptances_id_subject_key","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_id_subject_key ON examination_room_v1.privacy_acceptances USING btree (id, roster_id, notice_version_id, session_id, exam_version_id)"},{"name":"privacy_acceptances_one_withdrawal_idx","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_one_withdrawal_idx ON examination_room_v1.privacy_acceptances USING btree (prior_acceptance_id) WHERE (decision = 'withdrawn'::text)"},{"name":"privacy_acceptances_pkey","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_pkey ON examination_room_v1.privacy_acceptances USING btree (id)"},{"name":"privacy_acceptances_roster_notice_idx","table":"privacy_acceptances","definition":"CREATE INDEX privacy_acceptances_roster_notice_idx ON examination_room_v1.privacy_acceptances USING btree (roster_id, notice_version_id, recorded_at DESC)"},{"name":"privacy_acceptances_session_event_key","table":"privacy_acceptances","definition":"CREATE UNIQUE INDEX privacy_acceptances_session_event_key ON examination_room_v1.privacy_acceptances USING btree (session_id, client_event_id)"},{"name":"privacy_notice_versions_id_institution_key","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_id_institution_key ON examination_room_v1.privacy_notice_versions USING btree (id, institution_id)"},{"name":"privacy_notice_versions_institution_code_version_key","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_institution_code_version_key ON examination_room_v1.privacy_notice_versions USING btree (institution_id, notice_code, version_number)"},{"name":"privacy_notice_versions_pkey","table":"privacy_notice_versions","definition":"CREATE UNIQUE INDEX privacy_notice_versions_pkey ON examination_room_v1.privacy_notice_versions USING btree (id)"},{"name":"proctoring_artifacts_object_reference_key","table":"proctoring_artifacts","definition":"CREATE UNIQUE INDEX proctoring_artifacts_object_reference_key ON examination_room_v1.proctoring_artifacts USING btree (encrypted_object_reference)"},{"name":"proctoring_artifacts_pkey","table":"proctoring_artifacts","definition":"CREATE UNIQUE INDEX proctoring_artifacts_pkey ON examination_room_v1.proctoring_artifacts USING btree (id)"},{"name":"proctoring_artifacts_session_idx","table":"proctoring_artifacts","definition":"CREATE INDEX proctoring_artifacts_session_idx ON examination_room_v1.proctoring_artifacts USING btree (session_id, artifact_kind, captured_from)"},{"name":"proctoring_incidents_id_session_key","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_id_session_key ON examination_room_v1.proctoring_incidents USING btree (id, session_id)"},{"name":"proctoring_incidents_pkey","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_pkey ON examination_room_v1.proctoring_incidents USING btree (id)"},{"name":"proctoring_incidents_review_idx","table":"proctoring_incidents","definition":"CREATE INDEX proctoring_incidents_review_idx ON examination_room_v1.proctoring_incidents USING btree (session_id, review_status, occurred_at DESC)"},{"name":"proctoring_incidents_session_event_key","table":"proctoring_incidents","definition":"CREATE UNIQUE INDEX proctoring_incidents_session_event_key ON examination_room_v1.proctoring_incidents USING btree (session_id, client_event_id)"},{"name":"professor_access_requests_one_pending_per_user","table":"professor_access_requests","definition":"CREATE UNIQUE INDEX professor_access_requests_one_pending_per_user ON examination_room_v1.professor_access_requests USING btree (user_id) WHERE (request_status = 'pending'::text)"},{"name":"professor_access_requests_pkey","table":"professor_access_requests","definition":"CREATE UNIQUE INDEX professor_access_requests_pkey ON examination_room_v1.professor_access_requests USING btree (id)"},{"name":"professor_access_requests_school_queue","table":"professor_access_requests","definition":"CREATE INDEX professor_access_requests_school_queue ON examination_room_v1.professor_access_requests USING btree (requested_institution_id, request_status, requested_at)"},{"name":"questions_id_version_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_id_version_key ON examination_room_v1.questions USING btree (id, exam_version_id)"},{"name":"questions_pkey","table":"questions","definition":"CREATE UNIQUE INDEX questions_pkey ON examination_room_v1.questions USING btree (id)"},{"name":"questions_version_key_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_version_key_key ON examination_room_v1.questions USING btree (exam_version_id, question_key)"},{"name":"questions_version_position_key","table":"questions","definition":"CREATE UNIQUE INDEX questions_version_position_key ON examination_room_v1.questions USING btree (exam_version_id, \"position\")"},{"name":"recovery_snapshots_exam_sequence_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_exam_sequence_key ON examination_room_v1.recovery_snapshots USING btree (exam_id, snapshot_sequence)"},{"name":"recovery_snapshots_object_reference_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_object_reference_key ON examination_room_v1.recovery_snapshots USING btree (encrypted_object_reference)"},{"name":"recovery_snapshots_pkey","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_pkey ON examination_room_v1.recovery_snapshots USING btree (id)"},{"name":"recovery_snapshots_request_hash_key","table":"recovery_snapshots","definition":"CREATE UNIQUE INDEX recovery_snapshots_request_hash_key ON examination_room_v1.recovery_snapshots USING btree (request_hash)"},{"name":"recovery_snapshots_status_idx","table":"recovery_snapshots","definition":"CREATE INDEX recovery_snapshots_status_idx ON examination_room_v1.recovery_snapshots USING btree (exam_id, snapshot_status, created_at DESC)"},{"name":"result_email_delivery_batch_release_unique","table":"result_email_delivery_events","definition":"CREATE UNIQUE INDEX result_email_delivery_batch_release_unique ON examination_room_v1.result_email_delivery_events USING btree (batch_request_hash, release_id)"},{"name":"result_email_delivery_events_pkey","table":"result_email_delivery_events","definition":"CREATE UNIQUE INDEX result_email_delivery_events_pkey ON examination_room_v1.result_email_delivery_events USING btree (release_id)"},{"name":"result_email_delivery_exam_time_idx","table":"result_email_delivery_events","definition":"CREATE INDEX result_email_delivery_exam_time_idx ON examination_room_v1.result_email_delivery_events USING btree (exam_id, released_at DESC, release_id)"},{"name":"result_email_delivery_retry_idx","table":"result_email_delivery_events","definition":"CREATE INDEX result_email_delivery_retry_idx ON examination_room_v1.result_email_delivery_events USING btree (lease_expires_at, updated_at) WHERE (delivery_status = ANY (ARRAY['pending'::text, 'failed'::text, 'not_configured'::text, 'suppressed'::text]))"},{"name":"result_releases_batch_request_idx","table":"result_releases","definition":"CREATE INDEX result_releases_batch_request_idx ON examination_room_v1.result_releases USING btree (batch_request_hash, occurred_at, id) WHERE (batch_request_hash IS NOT NULL)"},{"name":"result_releases_id_submission_key","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_id_submission_key ON examination_room_v1.result_releases USING btree (id, submission_id)"},{"name":"result_releases_idempotency_hash_key","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_idempotency_hash_key ON examination_room_v1.result_releases USING btree (idempotency_key_hash)"},{"name":"result_releases_one_revocation_per_release_idx","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_one_revocation_per_release_idx ON examination_room_v1.result_releases USING btree (supersedes_release_id) WHERE (release_action = 'revoke'::text)"},{"name":"result_releases_pkey","table":"result_releases","definition":"CREATE UNIQUE INDEX result_releases_pkey ON examination_room_v1.result_releases USING btree (id)"},{"name":"result_releases_submission_idx","table":"result_releases","definition":"CREATE INDEX result_releases_submission_idx ON examination_room_v1.result_releases USING btree (submission_id, occurred_at DESC)"},{"name":"room_activations_id_exam_version_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_id_exam_version_key ON examination_room_v1.room_activations USING btree (id, exam_id, exam_version_id, institution_id)"},{"name":"room_activations_key_hash_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_key_hash_key ON examination_room_v1.room_activations USING btree (key_hash)"},{"name":"room_activations_pkey","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_pkey ON examination_room_v1.room_activations USING btree (id)"},{"name":"room_activations_request_hash_key","table":"room_activations","definition":"CREATE UNIQUE INDEX room_activations_request_hash_key ON examination_room_v1.room_activations USING btree (request_hash)"},{"name":"room_activations_window_idx","table":"room_activations","definition":"CREATE INDEX room_activations_window_idx ON examination_room_v1.room_activations USING btree (exam_id, activation_status, opens_at, closes_at)"},{"name":"staff_memberships_active_user_idx","table":"staff_memberships","definition":"CREATE INDEX staff_memberships_active_user_idx ON examination_room_v1.staff_memberships USING btree (user_id, institution_id, staff_role) WHERE (membership_status = 'active'::text)"},{"name":"staff_memberships_one_active_role_idx","table":"staff_memberships","definition":"CREATE UNIQUE INDEX staff_memberships_one_active_role_idx ON examination_room_v1.staff_memberships USING btree (institution_id, user_id, staff_role) WHERE (membership_status = 'active'::text)"},{"name":"staff_memberships_pkey","table":"staff_memberships","definition":"CREATE UNIQUE INDEX staff_memberships_pkey ON examination_room_v1.staff_memberships USING btree (id)"},{"name":"student_identities_email_idx","table":"student_identities","definition":"CREATE INDEX student_identities_email_idx ON examination_room_v1.student_identities USING btree (institution_id, email_normalized)"},{"name":"student_identities_external_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_external_key ON examination_room_v1.student_identities USING btree (institution_id, external_student_id)"},{"name":"student_identities_id_institution_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_id_institution_key ON examination_room_v1.student_identities USING btree (id, institution_id)"},{"name":"student_identities_institution_auth_key","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_institution_auth_key ON examination_room_v1.student_identities USING btree (institution_id, auth_user_id) WHERE (auth_user_id IS NOT NULL)"},{"name":"student_identities_pkey","table":"student_identities","definition":"CREATE UNIQUE INDEX student_identities_pkey ON examination_room_v1.student_identities USING btree (id)"},{"name":"student_sessions_activation_roster_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_activation_roster_key ON examination_room_v1.student_sessions USING btree (activation_id, roster_id)"},{"name":"student_sessions_consent_request_hash_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_consent_request_hash_key ON examination_room_v1.student_sessions USING btree (consent_request_hash)"},{"name":"student_sessions_heartbeat_idx","table":"student_sessions","definition":"CREATE INDEX student_sessions_heartbeat_idx ON examination_room_v1.student_sessions USING btree (activation_id, session_status, last_heartbeat_at)"},{"name":"student_sessions_id_institution_exam_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_institution_exam_key ON examination_room_v1.student_sessions USING btree (id, institution_id, exam_id)"},{"name":"student_sessions_id_roster_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_roster_key ON examination_room_v1.student_sessions USING btree (id, roster_id)"},{"name":"student_sessions_id_roster_version_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_roster_version_key ON examination_room_v1.student_sessions USING btree (id, roster_id, exam_version_id)"},{"name":"student_sessions_id_version_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_id_version_key ON examination_room_v1.student_sessions USING btree (id, exam_version_id)"},{"name":"student_sessions_one_open_per_roster_idx","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_one_open_per_roster_idx ON examination_room_v1.student_sessions USING btree (activation_id, roster_id) WHERE (session_status = ANY (ARRAY['created'::text, 'active'::text]))"},{"name":"student_sessions_pkey","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_pkey ON examination_room_v1.student_sessions USING btree (id)"},{"name":"student_sessions_token_hash_key","table":"student_sessions","definition":"CREATE UNIQUE INDEX student_sessions_token_hash_key ON examination_room_v1.student_sessions USING btree (session_token_hash)"},{"name":"submission_answers_pkey","table":"submission_answers","definition":"CREATE UNIQUE INDEX submission_answers_pkey ON examination_room_v1.submission_answers USING btree (submission_id, question_id)"},{"name":"submission_answers_revision_key","table":"submission_answers","definition":"CREATE UNIQUE INDEX submission_answers_revision_key ON examination_room_v1.submission_answers USING btree (answer_revision_id)"},{"name":"submission_receipts_pkey","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_pkey ON examination_room_v1.submission_receipts USING btree (id)"},{"name":"submission_receipts_receipt_code_key","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_receipt_code_key ON examination_room_v1.submission_receipts USING btree (receipt_code)"},{"name":"submission_receipts_submission_id_key","table":"submission_receipts","definition":"CREATE UNIQUE INDEX submission_receipts_submission_id_key ON examination_room_v1.submission_receipts USING btree (submission_id)"},{"name":"submissions_id_session_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_id_session_key ON examination_room_v1.submissions USING btree (id, session_id)"},{"name":"submissions_id_version_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_id_version_key ON examination_room_v1.submissions USING btree (id, exam_version_id)"},{"name":"submissions_idempotency_key_hash_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_idempotency_key_hash_key ON examination_room_v1.submissions USING btree (idempotency_key_hash)"},{"name":"submissions_pkey","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_pkey ON examination_room_v1.submissions USING btree (id)"},{"name":"submissions_session_key","table":"submissions","definition":"CREATE UNIQUE INDEX submissions_session_key ON examination_room_v1.submissions USING btree (session_id)"},{"name":"submissions_status_received_idx","table":"submissions","definition":"CREATE INDEX submissions_status_received_idx ON examination_room_v1.submissions USING btree (submission_status, received_at DESC)"}],"triggers":[{"name":"answer_revisions_immutable","table":"answer_revisions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER answer_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.answer_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"audit_events_immutable","table":"audit_events","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER audit_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.audit_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"email_delivery_events_immutable","table":"email_delivery_events","enabled":"O","function":"examination_room_v1.protect_email_delivery_event()","definition":"CREATE TRIGGER email_delivery_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.email_delivery_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_email_delivery_event()"},{"name":"exam_roster_binding_locked","table":"exam_roster","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER exam_roster_binding_locked BEFORE UPDATE OF id, exam_id, institution_id, student_identity_id, created_at ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"exam_roster_touch_updated_at","table":"exam_roster","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER exam_roster_touch_updated_at BEFORE UPDATE ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"exam_versions_immutable","table":"exam_versions","enabled":"O","function":"examination_room_v1.seal_exam_version()","definition":"CREATE TRIGGER exam_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.exam_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.seal_exam_version()"},{"name":"exams_current_version_must_be_published","table":"exams","enabled":"O","function":"examination_room_v1.ensure_exam_current_version_published()","definition":"CREATE TRIGGER exams_current_version_must_be_published BEFORE INSERT OR UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_exam_current_version_published()"},{"name":"exams_identity_locked","table":"exams","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER exams_identity_locked BEFORE UPDATE OF id, institution_id, created_at ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"exams_owner_must_be_authorized","table":"exams","enabled":"O","function":"examination_room_v1.validate_exam_owner()","definition":"CREATE TRIGGER exams_owner_must_be_authorized BEFORE INSERT OR UPDATE OF institution_id, owner_user_id ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_exam_owner()"},{"name":"exams_touch_updated_at","table":"exams","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER exams_touch_updated_at BEFORE UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"grade_revision_items_immutable","table":"grade_revision_items","enabled":"O","function":"examination_room_v1.protect_grade_revision_item_set()","definition":"CREATE TRIGGER grade_revision_items_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.grade_revision_items FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_grade_revision_item_set()"},{"name":"grade_revisions_immutable","table":"grade_revisions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER grade_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"grade_revisions_queue_recovery","table":"grade_revisions","enabled":"O","function":"examination_room_v1.queue_grading_snapshot()","definition":"CREATE TRIGGER grade_revisions_queue_recovery AFTER INSERT ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot()"},{"name":"institutions_immutable","table":"institutions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER institutions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.institutions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"media_upload_intents_no_delete","table":"media_upload_intents","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER media_upload_intents_no_delete BEFORE DELETE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"media_upload_intents_touch_updated_at","table":"media_upload_intents","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER media_upload_intents_touch_updated_at BEFORE UPDATE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"owner_identity_corrections_immutable","table":"owner_identity_corrections","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER owner_identity_corrections_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_identity_corrections FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"owner_key_envelopes_immutable","table":"owner_key_envelopes","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER owner_key_envelopes_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_key_envelopes FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_acceptances_immutable","table":"privacy_acceptances","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER privacy_acceptances_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_acceptances_validate","table":"privacy_acceptances","enabled":"O","function":"examination_room_v1.validate_privacy_acceptance()","definition":"CREATE TRIGGER privacy_acceptances_validate BEFORE INSERT ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_privacy_acceptance()"},{"name":"privacy_notice_versions_immutable","table":"privacy_notice_versions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER privacy_notice_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"privacy_notice_versions_minimal_warning","table":"privacy_notice_versions","enabled":"O","function":"examination_room_v1.normalize_default_student_warning()","definition":"CREATE TRIGGER privacy_notice_versions_minimal_warning BEFORE INSERT ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.normalize_default_student_warning()"},{"name":"proctoring_artifacts_evidence_locked","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER proctoring_artifacts_evidence_locked BEFORE UPDATE OF id, session_id, incident_id, artifact_kind, encrypted_object_reference, object_sha256, encryption_key_reference, captured_from, captured_to, retention_until, created_at ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"proctoring_artifacts_no_delete","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER proctoring_artifacts_no_delete BEFORE DELETE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"proctoring_artifacts_touch_updated_at","table":"proctoring_artifacts","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER proctoring_artifacts_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"proctoring_incidents_evidence_locked","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER proctoring_incidents_evidence_locked BEFORE UPDATE OF id, session_id, client_event_id, incident_kind, source, severity, occurred_at, duration_ms, details, created_at ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"proctoring_incidents_no_delete","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER proctoring_incidents_no_delete BEFORE DELETE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"proctoring_incidents_touch_updated_at","table":"proctoring_incidents","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER proctoring_incidents_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"professor_access_requests_history_locked","table":"professor_access_requests","enabled":"O","function":"examination_room_v1.protect_professor_access_request_history()","definition":"CREATE TRIGGER professor_access_requests_history_locked BEFORE INSERT OR UPDATE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_professor_access_request_history()"},{"name":"professor_access_requests_no_delete","table":"professor_access_requests","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER professor_access_requests_no_delete BEFORE DELETE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"questions_immutable","table":"questions","enabled":"O","function":"examination_room_v1.protect_published_question()","definition":"CREATE TRIGGER questions_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.questions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_published_question()"},{"name":"recovery_snapshots_bind_source","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.set_snapshot_source()","definition":"CREATE TRIGGER recovery_snapshots_bind_source BEFORE INSERT ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.set_snapshot_source()"},{"name":"recovery_snapshots_evidence_locked","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.protect_recovery_snapshot()","definition":"CREATE TRIGGER recovery_snapshots_evidence_locked BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_recovery_snapshot()"},{"name":"recovery_snapshots_no_delete","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER recovery_snapshots_no_delete BEFORE DELETE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"recovery_snapshots_touch_updated_at","table":"recovery_snapshots","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER recovery_snapshots_touch_updated_at BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"result_releases_immutable","table":"result_releases","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER result_releases_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"result_releases_queue_recovery","table":"result_releases","enabled":"O","function":"examination_room_v1.queue_grading_snapshot()","definition":"CREATE TRIGGER result_releases_queue_recovery AFTER INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot()"},{"name":"result_releases_validate_grade","table":"result_releases","enabled":"O","function":"examination_room_v1.ensure_releasable_grade()","definition":"CREATE TRIGGER result_releases_validate_grade BEFORE INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_releasable_grade()"},{"name":"room_activations_no_delete","table":"room_activations","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER room_activations_no_delete BEFORE DELETE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"room_activations_validate","table":"room_activations","enabled":"O","function":"examination_room_v1.validate_room_activation()","definition":"CREATE TRIGGER room_activations_validate BEFORE INSERT OR UPDATE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_room_activation()"},{"name":"staff_memberships_history_locked","table":"staff_memberships","enabled":"O","function":"examination_room_v1.protect_staff_membership_history()","definition":"CREATE TRIGGER staff_memberships_history_locked BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_staff_membership_history()"},{"name":"staff_memberships_no_delete","table":"staff_memberships","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER staff_memberships_no_delete BEFORE DELETE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"staff_memberships_touch_updated_at","table":"staff_memberships","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER staff_memberships_touch_updated_at BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"student_identities_touch_updated_at","table":"student_identities","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER student_identities_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_identities FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"student_sessions_binding_locked","table":"student_sessions","enabled":"O","function":"examination_room_v1.protect_student_session_binding()","definition":"CREATE TRIGGER student_sessions_binding_locked BEFORE UPDATE OF id, activation_id, exam_id, institution_id, exam_version_id, roster_id, session_token_hash, consent_request_hash, client_instance_id, started_at, created_at ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_student_session_binding()"},{"name":"student_sessions_no_delete","table":"student_sessions","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER student_sessions_no_delete BEFORE DELETE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"student_sessions_touch_updated_at","table":"student_sessions","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER student_sessions_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"},{"name":"submission_answers_immutable","table":"submission_answers","enabled":"O","function":"examination_room_v1.protect_submission_answer_set()","definition":"CREATE TRIGGER submission_answers_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.submission_answers FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_submission_answer_set()"},{"name":"submission_receipts_immutable","table":"submission_receipts","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER submission_receipts_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"submission_receipts_validate","table":"submission_receipts","enabled":"O","function":"examination_room_v1.validate_submission_receipt()","definition":"CREATE TRIGGER submission_receipts_validate BEFORE INSERT ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_submission_receipt()"},{"name":"submissions_evidence_locked","table":"submissions","enabled":"O","function":"examination_room_v1.prevent_mutation()","definition":"CREATE TRIGGER submissions_evidence_locked BEFORE UPDATE OF id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256, submission_manifest, answer_count, submitted_at_client, received_at ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation()"},{"name":"submissions_no_delete","table":"submissions","enabled":"O","function":"examination_room_v1.prevent_delete()","definition":"CREATE TRIGGER submissions_no_delete BEFORE DELETE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete()"},{"name":"submissions_touch_updated_at","table":"submissions","enabled":"O","function":"examination_room_v1.touch_updated_at()","definition":"CREATE TRIGGER submissions_touch_updated_at BEFORE UPDATE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at()"}],"policies":null}$expected_schema$::jsonb THEN RAISE EXCEPTION 'STAGING_SCHEMA_CHANGED'; END IF;
  SELECT state INTO after_rows FROM (SELECT jsonb_object_agg(table_name, state ORDER BY table_name COLLATE "C") FROM (
  SELECT 'answer_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."answer_revisions" t
  UNION ALL
  SELECT 'audit_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."audit_events" t
  UNION ALL
  SELECT 'email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."email_delivery_events" t
  UNION ALL
  SELECT 'exam_roster' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_roster" t
  UNION ALL
  SELECT 'exam_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_versions" t
  UNION ALL
  SELECT 'exams' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exams" t
  UNION ALL
  SELECT 'grade_revision_items' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revision_items" t
  UNION ALL
  SELECT 'grade_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revisions" t
  UNION ALL
  SELECT 'institutions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."institutions" t
  UNION ALL
  SELECT 'media_upload_intents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."media_upload_intents" t
  UNION ALL
  SELECT 'owner_identity_corrections' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_identity_corrections" t
  UNION ALL
  SELECT 'owner_key_envelopes' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_key_envelopes" t
  UNION ALL
  SELECT 'privacy_acceptances' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_acceptances" t
  UNION ALL
  SELECT 'privacy_notice_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_notice_versions" t
  UNION ALL
  SELECT 'proctoring_artifacts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_artifacts" t
  UNION ALL
  SELECT 'proctoring_incidents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_incidents" t
  UNION ALL
  SELECT 'professor_access_requests' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."professor_access_requests" t
  UNION ALL
  SELECT 'questions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."questions" t
  UNION ALL
  SELECT 'recovery_snapshots' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."recovery_snapshots" t
  UNION ALL
  SELECT 'result_email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_email_delivery_events" t
  UNION ALL
  SELECT 'result_releases' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_releases" t
  UNION ALL
  SELECT 'room_activations' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."room_activations" t
  UNION ALL
  SELECT 'staff_memberships' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."staff_memberships" t
  UNION ALL
  SELECT 'student_identities' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_identities" t
  UNION ALL
  SELECT 'student_sessions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_sessions" t
  UNION ALL
  SELECT 'submission_answers' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_answers" t
  UNION ALL
  SELECT 'submission_receipts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_receipts" t
  UNION ALL
  SELECT 'submissions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submissions" t
) all_tables) AS rows(state);
  IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'APPLICATION_ROWS_CHANGED_DURING_MIGRATION'; END IF;
  IF clock_timestamp() >= (binding#>>'{cutover,expiresAtUtc}')::timestamptz THEN RAISE EXCEPTION 'CUTOVER_WINDOW_EXPIRED_BEFORE_ENVELOPE_RETURN'; END IF;
END;
$staging_compatibility_review$;
