/** Builds review-only SQL. Never connects to or changes a hosted database. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDebateService } from '../worker/debate-service.mjs';
import { createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORICAL_PROBE_BASE = 'docs/debate-room-v3/evidence/staging-dml-rollback-probe';
export const PROBE_BASE = `${HISTORICAL_PROBE_BASE}-service-398557be`;
const HISTORICAL_FIXTURE_SHA256 = '02be235d5758910ab4c2382ca815b582fd04ee666217b08a5648ed325152bcfb';
const ACTOR = '10000000-0000-4000-8000-000000009909';
const OUTSIDER = '10000000-0000-4000-8000-000000009908';
const NOW = 1800000000000;
const EXPECTED = { debate: '89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c', study: '5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637' };
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const read = relative => readFile(path.join(ROOT, relative), 'utf8');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const setting = key => `current_setting('debate_dml_probe.${key}')`;
const value = key => `${setting(key)}::jsonb`;
const save = (key, expression) => `SELECT set_config('debate_dml_probe.${key}', (${expression})::text, true);`;
const assertion = (name, condition) => `SELECT ${quote(name)} AS check_name, 1 / CASE WHEN (${condition}) THEN 1 ELSE 0 END AS passed;`;
const extraction = (source, delimiter) => {
  const token = `$${delimiter}$`; const first = source.indexOf(token); const last = source.indexOf(token, first + token.length);
  assert.ok(first >= 0 && last > first, `Missing ${delimiter} evidence`); return JSON.parse(source.slice(first + token.length, last));
};

export async function captureFixture() {
  const store = createMemoryDebateStoreForTests(), envelopes = [];
  const commit = store.commit;
  store.commit = async request => { envelopes.push(structuredClone(request)); return commit(request); };
  const service = createDebateService({ store, now: () => NOW });
  const actor = { id: ACTOR, displayName: 'Synthetic rollback-only owner' };
  const inputs = [
    { actor, command: 'create_event', payload: { title: 'Synthetic DML rollback-only Debate probe', rehearsal: true, visibility: 'unlisted' }, expectedRevision: 0, idempotencyKey: 'dml-rollback-probe-create-0001' },
    { actor, command: 'update_event', payload: { title: 'Synthetic DML rollback-only update' }, expectedRevision: 1, idempotencyKey: 'dml-rollback-probe-update-0002' },
  ];
  const created = await service.execute(inputs[0]); inputs[1].eventId = created.event.id;
  await service.execute(inputs[1]);
  return { kind: 'REAL_SERVICE_GENERATED_SYNTHETIC_ENVELOPES', actorId: ACTOR, now: NOW,
    sourceHashLf: hash((await read('worker/debate-service.mjs')).replaceAll('\r\n', '\n')), inputs, envelopes };
}

function normalizedEnvelope(envelope) {
  const copy = structuredClone(envelope); copy.receipt.id = 'NORMALIZED_RANDOM_RECEIPT'; copy.audit.correlationId = 'NORMALIZED_RANDOM_RECEIPT';
  return JSON.parse(JSON.stringify(copy));
}

export function validateCapturedFixture(fixture, fresh) {
  assert.equal(fixture.sourceHashLf, fresh.sourceHashLf, 'The captured service source must still match');
  assert.deepEqual(fixture.inputs, fresh.inputs);
  assert.deepEqual(fixture.envelopes.map(normalizedEnvelope), fresh.envelopes.map(normalizedEnvelope), 'Frozen envelopes must match actual current service output');
}

function functions(sql) {
  return [...sql.matchAll(/create(?: or replace)? function\s+(\w+)\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+(\$\w*\$)([\s\S]*?)\5;/gi)].map(match => {
    const [, schema, name, argumentsText, header, , body] = match;
    const types = argumentsText.trim() ? argumentsText.split(',').map(arg => arg.trim().replace(/\s+default\s+[\s\S]+$/i, '').split(/\s+/).slice(1).join(' ')).join(',') : '';
    return { schema, name, signature: `${schema}.${name}(${types})`, body_md5: hash(body, 'md5'),
      language: /\blanguage\s+(\w+)/i.exec(header)[1].toLowerCase(), security_definer: /security\s+definer/i.test(header),
      volatility: /\bimmutable\b/i.test(header) ? 'i' : /\bstable\b/i.test(header) ? 's' : 'v',
      settings: ['search_path=""', ...(/set\s+lock_timeout\s*=\s*'3s'/i.test(header) ? ['lock_timeout=3s'] : [])],
      service_execute: name !== 'study_room_admission_json' };
  });
}

const tableShapes = {
  debate_v3_events: 'id:text owner_id:text revision:bigint status:text state:jsonb created_at_ms:bigint updated_at_ms:bigint',
  debate_v3_receipts: 'actor_id:text command:text event_id:text idempotency_key:text payload_hash:text receipt:jsonb created_at_ms:bigint',
  debate_v3_audit: 'event_id:text revision:bigint actor_id:text command:text record:jsonb at_ms:bigint',
  debate_v3_match_versions: 'event_id:text match_id:text event_revision:bigint record:jsonb',
  debate_v3_ballots: 'event_id:text match_id:text round:integer judge_id:text ballot:jsonb event_revision:bigint',
  debate_v3_votes: 'event_id:text match_id:text poll_id:text actor_id:text vote:jsonb event_revision:bigint',
  debate_v3_outbox: 'id:text event_id:text actor_id:text type:text job:jsonb status:text attempts:integer next_attempt_ms:bigint claim_id:text? lease_until_ms:bigint? result:jsonb? error:text?',
  debate_v3_rate_limits: 'actor_id:text action:text bucket:bigint count:integer',
  debate_v3_maintenance: 'name:text event_cursor:text?',
  debate_v3_uploads: 'id:text event_id:text actor_id:text match_id:text channel:text record:jsonb status:text expires_at_ms:bigint cleanup_job_id:text',
};

const studyShapes = {
  study_room_admissions: 'request_id:uuid room_key:smallint access_revision:integer user_id:uuid? identity:text nickname:text requested:boolean status:text version:integer requested_at:timestamp_with_time_zone expires_at:timestamp_with_time_zone not_before:timestamp_with_time_zone token_issued_at:timestamp_with_time_zone? revoke_pending:boolean attempt_window:timestamp_with_time_zone attempts:integer updated_at:timestamp_with_time_zone',
  study_room_admission_commands: 'actor_user_id:uuid command_id:uuid room_key:smallint input:jsonb result:jsonb happened_at:timestamp_with_time_zone',
};

const primaryKeys = {
  debate_v3_events: ['id'], debate_v3_receipts: ['actor_id','command','event_id','idempotency_key'], debate_v3_audit: ['event_id','revision'],
  debate_v3_match_versions: ['event_id','match_id','event_revision'], debate_v3_ballots: ['event_id','match_id','round','judge_id'],
  debate_v3_votes: ['event_id','match_id','poll_id','actor_id'], debate_v3_outbox: ['id'], debate_v3_rate_limits: ['actor_id','action','bucket'],
  debate_v3_maintenance: ['name'], debate_v3_uploads: ['id'], study_room_admissions: ['request_id'], study_room_admission_commands: ['actor_user_id','command_id'],
};

const catalogHash = `(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY room_key),'[]'::jsonb)::text) FROM private.study_room_catalog c)`;
const auditHash = `(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY room_key,revision),'[]'::jsonb)::text) FROM private.study_room_catalog_audit c)`;
const ledgerHash = `(SELECT md5(coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]'::jsonb)::text) FROM supabase_migrations.schema_migrations)`;
const admissionHash = `(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY request_id),'[]'::jsonb)::text) FROM private.study_room_admissions c)`;
const commandHash = `(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor_user_id,command_id),'[]'::jsonb)::text) FROM private.study_room_admission_commands c)`;
const metadataHashes = { catalog: catalogHash, catalog_audit: auditHash, ledger: ledgerHash, admissions: admissionHash, admission_commands: commandHash };

export function executableStatements(sql) {
  // Restricted lexer: discard comments and quoted values before checking statement verbs.
  const text = sql.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");
  assert.ok(!/\$\w*\$|\/\*/.test(text), 'No anonymous blocks, dollar bodies, or block comments in this DML artifact');
  const statements = text.split(';').map(part => part.trim()).filter(Boolean);
  for (const statement of statements) assert.match(statement, /^(?:BEGIN\b|SET LOCAL\b|SELECT\b|INSERT INTO public\.debate_v3_outbox\b|DELETE FROM public\.debate_v3_(?:events|receipts|audit|outbox)\b|ROLLBACK\b)/i);
  assert.equal(statements.filter(statement => /^BEGIN\b/i.test(statement)).length, 1);
  assert.equal(statements.filter(statement => /^ROLLBACK\b/i.test(statement)).length, 1);
  assert.ok(!/\b(?:COMMIT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO|CALL|COPY|EXECUTE)\b/i.test(text));
  return statements;
}

export async function buildProbe() {
  const debate = await read('worker/debate-schema-draft.sql'), study = await read('worker/study-room-admission-schema-draft.sql');
  assert.equal(hash(debate), EXPECTED.debate); assert.equal(hash(study), EXPECTED.study);
  const old = await read('docs/debate-room-v3/evidence/staging-rollback-probe.sql');
  const fixture = JSON.parse(await read(`${PROBE_BASE}.fixtures.json`));
  const fresh = await captureFixture();
  validateCapturedFixture(fixture, fresh);
  // Preserve the earlier executed evidence. This successor proves the current
  // wording-only service change reproduces the same complete commit envelopes.
  const historicalBytes = await read(`${HISTORICAL_PROBE_BASE}.fixtures.json`);
  assert.equal(hash(historicalBytes), HISTORICAL_FIXTURE_SHA256, 'Historical fixture bytes must remain unchanged');
  const historical = JSON.parse(historicalBytes);
  assert.deepEqual(historical.inputs, fresh.inputs);
  assert.deepEqual(historical.envelopes.map(normalizedEnvelope), fresh.envelopes.map(normalizedEnvelope), 'This successor is limited to unchanged service commit envelopes');
  const [create, update] = fixture.envelopes, eventId = create.eventId, jobId = `${eventId}:rollback-only-job`;
  const allFunctions = [...functions(debate), ...functions(study)]; assert.equal(allFunctions.length, 22);
  const oldFunctions = extraction(old, 'expected_functions');
  const columns = extraction(old, 'expected_columns').map(column => column.table_name === 'study_room_catalog' && column.column_name === 'audience' ? { ...column, default_expression: "'all'::text" } : column);
  const constraints = extraction(old, 'expected_constraints').map(constraint => constraint.name === 'study_room_catalog_audience_check' ? { ...constraint, definition: "CHECK ((audience = ANY (ARRAY['all'::text, 'paid'::text, 'admin'::text, 'approval'::text])))" } : constraint);
  const sql = [
    '-- REVIEW-ONLY DML transaction. Target must be independently pinned to hlzqmreeoghbldnhlybr.',
    `-- Exact already-installed source hashes: Debate ${EXPECTED.debate}; Study ${EXPECTED.study}.`,
    `-- Current service source (LF SHA256): ${fresh.sourceHashLf}; actual generated fixture: ${PROBE_BASE}.fixtures.json.`,
    '-- No schema changes, Auth accounts, real email, provider calls or business-record output.',
    '-- Submit the ENTIRE file as one batch on one connection. Never execute fragments.',
    '-- A failed assertion aborts the transaction. Confirm rollback/connection closure and independent readback.',
    'BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '30s';", "SET LOCAL idle_in_transaction_session_timeout = '10s';",
    assertion('ROLE_AND_PG17', "current_user='postgres' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999"),
    assertion('ROLE_RLS_ATTRIBUTES', "(SELECT count(*) FROM pg_roles WHERE rolname IN ('postgres','service_role') AND rolbypassrls)=2 AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated') AND NOT rolbypassrls)=2"),
    assertion('EXISTING_STUDY_MIGRATION_ID', "EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260908151514' AND name='astra_study_room_persisted_catalog')"),
    assertion('PRIVATE_SCHEMA_GRANTS', "has_schema_privilege('service_role','private','USAGE') AND NOT has_schema_privilege('anon','private','USAGE') AND NOT has_schema_privilege('authenticated','private','USAGE')"),
    assertion('NO_REAL_ACCOUNT_OR_PROBE_COLLISION', `NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN (${quote(ACTOR)}::uuid,${quote(OUTSIDER)}::uuid)) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_events WHERE id=${quote(eventId)} OR owner_id IN (${quote(ACTOR)},${quote(OUTSIDER)})) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)} OR actor_id IN (${quote(ACTOR)},${quote(OUTSIDER)})) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_outbox WHERE id=${quote(jobId)} OR event_id=${quote(eventId)})`),
    assertion('EXISTING_COLUMNS_UNCHANGED', `NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${json(columns)}) x WHERE (SELECT jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default_expression',pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=x->>'schema' AND c.relname=x->>'table_name' AND a.attname=x->>'column_name' AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM (x-'schema'-'table_name'-'column_name'))`),
    assertion('EXISTING_CONSTRAINTS_UNCHANGED', `NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${json(constraints)}) x WHERE (SELECT jsonb_build_object('type',con.contype,'validated',con.convalidated,'definition',pg_get_constraintdef(con.oid)) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=x->>'schema' AND c.relname=x->>'table' AND con.conname=x->>'name') IS DISTINCT FROM (x-'schema'-'table'-'name'))`),
    assertion('EXISTING_FUNCTION_FINGERPRINTS', `NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${json(oldFunctions)}) x WHERE (SELECT jsonb_build_object('result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'definition_md5',md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=x->>'schema' AND p.proname=x->>'name' AND pg_get_function_identity_arguments(p.oid)=x->>'arguments') IS DISTINCT FROM (x-'schema'-'name'-'arguments'))`),
    assertion('EXACT_INSTALLED_FUNCTION_BODIES', `NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${json(allFunctions)}) x WHERE (SELECT jsonb_build_object('body_md5',md5(p.prosrc),'language',l.lanname,'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(x->>'signature') AND pg_get_userbyid(p.proowner)='postgres' AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) IS DISTINCT FROM (x-'schema'-'name'-'signature'))`),
    assertion('EXACT_FUNCTION_COUNTS', "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'debate_v3_%')=16 AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'study_room_admission%' OR p.proname IN ('study_room_catalog_v2','study_room_configure_v2')))=6"),
  ];
  for (const [table, shape] of Object.entries({ ...tableShapes, ...studyShapes })) {
    const schema = table.startsWith('study_') ? 'private' : 'public';
    const expectedColumns = shape.split(' ').map(column => { const [name, type] = column.split(':'); return { name, type: type.replace('?', '').replaceAll('_', ' '), not_null: !type.endsWith('?') }; });
    sql.push(assertion(`SHAPE_${table}`, `(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=${quote(`${schema}.${table}`)}::regclass AND a.attnum>0 AND NOT a.attisdropped)=${json(expectedColumns)}`));
    sql.push(assertion(`PRIMARY_KEY_${table}`, `(SELECT jsonb_agg(a.attname ORDER BY key_column.ordinality) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY key_column(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key_column.attnum WHERE c.conrelid=${quote(`${schema}.${table}`)}::regclass AND c.contype='p' AND c.convalidated)=${json(primaryKeys[table])}`));
  }
  sql.push(
    assertion('EXACT_TABLE_RLS_NO_USER_TRIGGERS', "(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%' AND c.relkind='r')=10 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%' AND c.relkind='r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'postgres')) AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%' AND NOT t.tgisinternal) AND NOT EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%')"),
    assertion('TABLE_GRANTS_AND_AUDIT_NEGATIVE_PRIVILEGES', "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) permission WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%' AND c.relkind='r' AND has_table_privilege(r,c.oid,permission) IS DISTINCT FROM (r='service_role' AND (permission IN ('SELECT','INSERT','DELETE') OR (permission='UPDATE' AND c.relname<>'debate_v3_audit'))))"),
    assertion('COLUMN_GRANTS_AND_AUDIT_NEGATIVE_PRIVILEGES', "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) permission WHERE n.nspname='public' AND c.relname LIKE 'debate_v3_%' AND c.relkind='r' AND has_any_column_privilege(r,c.oid,permission) IS DISTINCT FROM (r='service_role' AND (permission IN ('SELECT','INSERT') OR (permission='UPDATE' AND c.relname<>'debate_v3_audit'))))"),
    assertion('STUDY_PRIVATE_TABLE_PROTECTIONS', "(SELECT count(*) FROM pg_class WHERE oid IN ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass,'private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass) AND relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner)='postgres')=4 AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) permission WHERE c.oid IN ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass,'private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass) AND has_table_privilege(r,c.oid,permission))"),
    assertion('STUDY_NO_COLUMN_GRANTS_OR_USER_TRIGGERS', "NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) permission WHERE c.oid IN ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass,'private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass) AND has_any_column_privilege(r,c.oid,permission)) AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass,'private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass) AND NOT tgisinternal) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass,'private.study_room_admissions'::regclass,'private.study_room_admission_commands'::regclass))"),
    assertion('ALL_CANDIDATE_CONSTRAINTS_VALIDATED', "NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE ((n.nspname='public' AND t.relname LIKE 'debate_v3_%') OR (n.nspname='private' AND t.relname IN ('study_room_admissions','study_room_admission_commands'))) AND NOT c.convalidated)"),
    ...Object.entries(metadataHashes).map(([name, expression]) => save(`${name}_before`, expression)),
    save('create', json(create)), save('update', json(update)), 'SET LOCAL ROLE service_role;',
    assertion('SERVICE_ROLE_ACTIVE', "current_user='service_role'"),
    save('receipt', `public.debate_v3_commit(${value('create')})`),
    assertion('REAL_SERVICE_CREATE', `NOT (${value('receipt')} ? 'error') AND ${value('receipt')}->>'revision'='1'`),
    save('replay', `public.debate_v3_commit(${value('create')})`),
    assertion('EXACT_IDEMPOTENT_REPLAY', `${value('replay')}=${value('receipt')}`),
    save('rejected', `public.debate_v3_commit(jsonb_set(${value('create')},'{payloadHash}',to_jsonb(repeat('f',64))))`),
    assertion('CONFLICTING_REPLAY', `${value('rejected')}->'error'->>'code'='IDEMPOTENCY_CONFLICT'`),
    save('rejected', `public.debate_v3_commit(jsonb_set(${value('update')},'{expectedRevision}','0'::jsonb))`),
    assertion('STALE_REVISION', `${value('rejected')}->'error'->>'code'='REVISION_CONFLICT'`),
    save('rejected', `public.debate_v3_commit(jsonb_set(${value('update')},'{state,ownerId}',${json(OUTSIDER)}))`),
    assertion('OWNER_IMMUTABLE', `${value('rejected')}->'error'->>'code'='FORBIDDEN'`),
    save('rejected', `public.debate_v3_commit(jsonb_set(${value('update')},'{actorId}',${json(OUTSIDER)}))`),
    assertion('NONMEMBER_REJECTED', `${value('rejected')}->'error'->>'code'='NOT_MEMBER'`),
    save('updated', `public.debate_v3_commit(${value('update')})`),
    assertion('REAL_SERVICE_UPDATE_AND_READ', `NOT (${value('updated')} ? 'error') AND ${value('updated')}->>'revision'='2' AND public.debate_v3_read(${quote(eventId)})->>'revision'='2' AND public.debate_v3_read(${quote(eventId)})->>'title'=${quote(update.state.title)}`),
    assertion('ACTOR_LIST_ISOLATION', `jsonb_array_length(public.debate_v3_list(${quote(ACTOR)}))=1 AND public.debate_v3_list(${quote(OUTSIDER)})='[]'::jsonb`),
    assertion('EXACT_APPEND_AUDIT', `(SELECT count(*) FROM public.debate_v3_audit WHERE event_id=${quote(eventId)} AND actor_id=${quote(ACTOR)})=2 AND (SELECT count(*) FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)} AND actor_id=${quote(ACTOR)})=2`),
    '-- This inert outbox row is a SQL fixture, not a service-generated delivery or provider call.',
    `INSERT INTO public.debate_v3_outbox(id,event_id,actor_id,type,job,next_attempt_ms) VALUES(${quote(jobId)},${quote(eventId)},${quote(ACTOR)},'synthetic_probe',${json({ id: jobId, eventId, actorId: ACTOR, type: 'synthetic_probe', createdAt: NOW, payload: { rollbackOnly: true } })},${NOW});`,
    save('first_claim', `public.debate_v3_claim_jobs(${quote(eventId)},1,${NOW})`),
    assertion('FIRST_JOB_CLAIM', `jsonb_array_length(${value('first_claim')})=1 AND ${value('first_claim')}->0->>'id'=${quote(jobId)} AND ${value('first_claim')}->0->>'attempts'='1' AND length(${value('first_claim')}->0->>'claimId')=36`),
    save('active_claim', `public.debate_v3_claim_jobs(${quote(eventId)},1,${NOW + 1})`),
    assertion('ACTIVE_JOB_LEASE_NOT_RECLAIMED', `${value('active_claim')}='[]'::jsonb`),
    save('second_claim', `public.debate_v3_claim_jobs(${quote(eventId)},1,${NOW + 60001})`),
    assertion('EXPIRED_JOB_RECLAIMED', `jsonb_array_length(${value('second_claim')})=1 AND ${value('second_claim')}->0->>'attempts'='2' AND ${value('second_claim')}->0->>'claimId'<>${value('first_claim')}->0->>'claimId'`),
    save('rejected', `public.debate_v3_finish_job(jsonb_build_object('jobId',${quote(jobId)},'claimId',${value('first_claim')}->0->>'claimId','status','completed','now',${NOW + 60002},'result',jsonb_build_object('synthetic',true)))`),
    assertion('STALE_JOB_COMPLETION_REJECTED', `${value('rejected')}->'error'->>'code'='JOB_LEASE_CONFLICT' AND public.debate_v3_read_job(${quote(jobId)})->>'status'='running'`),
    save('finished', `public.debate_v3_finish_job(jsonb_build_object('jobId',${quote(jobId)},'claimId',${value('second_claim')}->0->>'claimId','status','completed','now',${NOW + 60003},'result',jsonb_build_object('synthetic',true)))`),
    assertion('CURRENT_JOB_COMPLETION', `${value('finished')}->>'status'='completed' AND public.debate_v3_read_job(${quote(jobId)})->>'status'='completed'`),
    assertion('STUDY_CATALOG_V1_V2_READ_PARITY', 'public.study_room_catalog_v1() IS NOT DISTINCT FROM public.study_room_catalog_v2()'),
    `DELETE FROM public.debate_v3_outbox WHERE id=${quote(jobId)} AND event_id=${quote(eventId)} AND actor_id=${quote(ACTOR)};`,
    `DELETE FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)} AND actor_id=${quote(ACTOR)};`,
    `DELETE FROM public.debate_v3_audit WHERE event_id=${quote(eventId)} AND actor_id=${quote(ACTOR)};`,
    `DELETE FROM public.debate_v3_events WHERE id=${quote(eventId)} AND owner_id=${quote(ACTOR)};`,
    assertion('SCOPED_DELETE_COMPLETES', `public.debate_v3_read(${quote(eventId)}) IS NULL AND NOT EXISTS(SELECT 1 FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)}) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_audit WHERE event_id=${quote(eventId)}) AND public.debate_v3_read_job(${quote(jobId)}) IS NULL`),
    '-- Recreate an actual event/receipt/audit sentinel and leave it present until ROLLBACK.',
    save('sentinel', `public.debate_v3_commit(${value('create')})`),
    assertion('ROLLBACK_SENTINEL_PRESENT', `${value('sentinel')}->>'revision'='1' AND public.debate_v3_read(${quote(eventId)}) IS NOT NULL AND EXISTS(SELECT 1 FROM public.debate_v3_audit WHERE event_id=${quote(eventId)}) AND EXISTS(SELECT 1 FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)})`),
    'SET LOCAL ROLE postgres;',
    ...Object.entries(metadataHashes).map(([name, expression]) => assertion(`UNCHANGED_${name.toUpperCase()}`, `${expression}=${setting(`${name}_before`)}`)),
    "SELECT jsonb_build_object('checkpoint','DML_CHECKS_PASSED_ROLLBACK_PENDING','rollbackPending',true,'authAccountsCreated',0,'providerCalls',0,'actualPermissionErrorProbes',false,'nativeConcurrentConnections',false) AS rollback_probe;",
    'ROLLBACK;',
  );
  const absence = `NOT EXISTS(SELECT 1 FROM public.debate_v3_events WHERE id=${quote(eventId)} OR owner_id IN (${quote(ACTOR)},${quote(OUTSIDER)})) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_receipts WHERE event_id=${quote(eventId)} OR actor_id IN (${quote(ACTOR)},${quote(OUTSIDER)})) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_audit WHERE event_id=${quote(eventId)}) AND NOT EXISTS(SELECT 1 FROM public.debate_v3_outbox WHERE id=${quote(jobId)} OR event_id=${quote(eventId)})`;
  const readback = [
    '-- Run independently after the full batch, including after any timeout/error. Read-only.',
    assertion('POST_ROLLBACK_PROBE_ROWS_ABSENT', absence),
    `SELECT jsonb_build_object('checkpoint','DML_ROLLBACK_ROWS_ABSENT','targetProjectMustBeVerifiedExternally','hlzqmreeoghbldnhlybr','eventId',${quote(eventId)},'actorId',${quote(ACTOR)},'providerCalls',0,'actualPermissionErrorProbes',false,'nativeConcurrentConnections',false,${Object.entries(metadataHashes).map(([name, expression]) => `${quote(`${name}Hash`)},${expression}`).join(',')},'debateFunctionCount',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'debate_v3_%')) AS rollback_probe;`,
  ].join('\n');
  sql.push(readback);
  const output = sql.join('\n\n') + '\n'; const statements = executableStatements(output);
  return { sql: output, readback: readback + '\n', manifest: { kind: 'PREPARED_NOT_EXECUTED_DML_ROLLBACK_PROBE', targetProject: 'hlzqmreeoghbldnhlybr', sourceHashes: { ...EXPECTED, serviceLf: fresh.sourceHashLf }, sqlSha256: hash(output), readbackSha256: hash(readback + '\n'), fixtureSha256: hash(await read(`${PROBE_BASE}.fixtures.json`)),
    predecessor: { fixturePath: `${HISTORICAL_PROBE_BASE}.fixtures.json`, fixtureSha256: HISTORICAL_FIXTURE_SHA256, serviceSourceHashLf: historical.sourceHashLf, normalizedActualEnvelopesIdentical: true, envelopeCount: fresh.envelopes.length, normalization: ['Random receipt.id', 'Matching audit.correlationId'], historicalHostedEvidenceReusedForCurrentExecutionClaim: false },
    eventId, actorId: ACTOR, outsiderActorId: OUTSIDER, jobId, statements: statements.length, assertions: statements.filter(statement => /^SELECT '' AS check_name/i.test(statement)).length, functionBodies: allFunctions.length,
    claims: { generatedFromActualService: true, localSqlExecuted: false, hostedSqlExecuted: false, schemaInstallRollback: false, authAccountsCreated: false, providerCalls: false, actualPermissionErrorProbes: false, nativeConcurrentConnections: false } } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--capture-fixtures')) {
    await writeFile(path.join(ROOT, `${PROBE_BASE}.fixtures.json`), JSON.stringify(await captureFixture(), null, 2) + '\n');
  }
  const result = await buildProbe();
  await writeFile(path.join(ROOT, `${PROBE_BASE}.sql`), result.sql);
  await writeFile(path.join(ROOT, `${PROBE_BASE}.readback.sql`), result.readback);
  await writeFile(path.join(ROOT, `${PROBE_BASE}.manifest.json`), JSON.stringify(result.manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result.manifest, null, 2) + '\n');
}
