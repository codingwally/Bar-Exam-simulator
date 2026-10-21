import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

// This harness has no hosted client. SQL goes only to a fresh loopback service.
// Its in-memory simulated approval is test data, never owner authorization.
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const validateOnly = args.includes('--validate-only');
const positional = args.filter(arg => arg !== '--validate-only');
assert.ok(positional.length <= 2 && args.filter(arg => arg === '--validate-only').length <= 1);
const packageDir = path.resolve(positional[0] ?? path.join(here, 'fixtures/staging-application-envelope'));
const output = path.resolve(positional[1] ?? path.join(here, '../artifacts/debate-local-rehearsal/staging-application-envelope-ci'));
const originalDir = path.join(here, 'fixtures/current-staging-compatibility');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const required = ['binding.template.json', 'cutover-row-state-capture.sql', 'definition-index.json', 'executor-identity-capture.sql', 'forward.review.sql', 'inverse.review.sql'];
const manifestBytes = await fs.readFile(path.join(packageDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.fixturePurpose, 'DISPOSABLE_NATIVE_ENVELOPE_VERIFICATION_ONLY');
assert.equal(manifest.freezingDoesNotAuthorizeApplication, true);
assert.equal(manifest.authorization, 'REVIEW_ONLY_NOT_APPROVED');
assert.equal(manifest.targetProjectId, 'hlzqmreeoghbldnhlybr');
assert.equal(manifest.forbiddenProductionProjectId, 'hbllomlijfznnuudpdvr');
assert.deepEqual(Object.keys(manifest.files).sort(), required);
const files = new Map();
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.ok(required.includes(name));
  const bytes = await fs.readFile(path.join(packageDir, name));
  assert.equal(sha(bytes), expected, `Envelope input changed: ${name}`);
  files.set(name, bytes.toString('utf8'));
}
const originalManifestBytes = await fs.readFile(path.join(originalDir, 'manifest.json'));
assert.equal(sha(originalManifestBytes), manifest.testedPackageManifestSha256);
const originalManifest = JSON.parse(originalManifestBytes);
assert.equal(originalManifest.target, 'disposable-local-only');
assert.equal(originalManifest.database, 'duediligence_compatibility_fixture');
assert.equal(Object.keys(originalManifest.files).length, 19);
const originalFiles = new Map();
const testedSourceHashes = { 'scripts/fixtures/current-staging-compatibility/manifest.json': sha(originalManifestBytes) };
for (const [name, expected] of Object.entries(originalManifest.files)) {
  assert.match(name, /^[a-z][a-z0-9-]*\.(?:sql|json|mjs)$/);
  const bytes = await fs.readFile(path.join(originalDir, name));
  assert.equal(sha(bytes), expected, `Previously tested input changed: ${name}`);
  originalFiles.set(name, bytes.toString('utf8'));
  testedSourceHashes[`scripts/fixtures/current-staging-compatibility/${name}`] = expected;
}
const originalRunnerHash = sha(await fs.readFile(path.join(here, 'verify-current-staging-compatibility.mjs')));
assert.equal(originalRunnerHash, '0b49b81a269efb4af8b8bb330edd60fae559cf70aad68577e865f26b7a769bf4', 'Previously passed native harness changed');
testedSourceHashes['scripts/verify-current-staging-compatibility.mjs'] = originalRunnerHash;
assert.equal(Object.keys(testedSourceHashes).length, 21);
const templateBinding = JSON.parse(files.get('binding.template.json'));
assert.equal(templateBinding.status, 'REVIEW_ONLY_NOT_APPROVED');
assert.equal(templateBinding.testedPackageManifestSha256, sha(originalManifestBytes));
const index = JSON.parse(files.get('definition-index.json'));
const baseline = JSON.parse(originalFiles.get('baseline.json'));
const postimage = JSON.parse(originalFiles.get('postimage.json'));
const definitions = JSON.parse(originalFiles.get('target-definitions.json'));
const tableNames = JSON.parse(originalFiles.get('table-names.json'));
assert.equal(baseline.length, 48); assert.equal(postimage.length, 49); assert.equal(definitions.length, 6);
assert.equal(index.protected.length, 42); assert.equal(tableNames.length, 28);
for (const name of tableNames) assert.match(name, /^[a-z_]+$/);
assert.deepEqual(index.changed, definitions.map(d => ({ signature: d.signature, before: baseline.find(f => f.signature === d.signature), after: postimage.find(f => f.signature === d.signature) })));
assert.deepEqual(index.protected, baseline.filter(f => !definitions.some(d => d.signature === f.signature)));
assert.deepEqual(index.lease, postimage.find(f => f.name === 'apply_open_room_lease'));
assert.equal(index.trigger, originalManifest.newTrigger);

const delimiter = '$review_binding$';
const bindingParts = new Map();
for (const phase of ['forward', 'inverse']) {
  const sql = files.get(`${phase}.review.sql`);
  const parts = sql.split(delimiter);
  assert.equal(parts.length, 3, `${phase}: exactly one explicit binding delimiter pair required`);
  assert.deepEqual(JSON.parse(parts[1]), templateBinding);
  bindingParts.set(phase, parts);
  // Independently bind executable body bytes to the previously passed package.
  const executed = [...sql.matchAll(/^  EXECUTE '((?:[^']|'')*)';$/gm)].map(m => m[1].replaceAll("''", "'"));
  assert.equal(executed.length, phase === 'forward' ? 8 : 6);
  for (const d of definitions) {
    const expected = (phase === 'forward' ? postimage : baseline).find(f => f.signature === d.signature).definitionSha256;
    assert.equal(executed.filter(body => sha(body) === expected).length, 1, `${phase}: exact ${d.signature}`);
  }
  if (phase === 'forward') {
    assert.equal(executed.filter(body => sha(body) === index.lease.definitionSha256).length, 1);
    assert.equal(executed.filter(body => body === index.trigger).length, 1);
  }
}
if (validateOnly) {
  console.log(JSON.stringify({ status: 'INPUT_HASHES_AND_DEFINITION_BYTES_VALID_ONLY', sqlExecuted: false, hostedExecuted: false, authorizationGranted: false, envelopeManifestSha256: sha(manifestBytes), envelopeInputs: files.size, testedSourceInputs: Object.keys(testedSourceHashes).length }));
  process.exit(0);
}

assert.equal(process.platform, 'linux', 'Execution requires the dedicated disposable Linux job');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.STAGING_ENVELOPE_SQL_CI, '1');
const expectedEnv = { PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'fixture_bootstrap', PGDATABASE: 'duediligence_compatibility_fixture', PGPASSWORD: 'isolated_compatibility_only' };
for (const [key, value] of Object.entries(expectedEnv)) assert.equal(process.env[key], value, key);
for (const key of Object.keys(process.env).filter(key => key.startsWith('PG'))) assert.ok(key in expectedEnv, `Unexpected PostgreSQL environment: ${key}`);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'duediligence-envelope-'));
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(env, expectedEnv, { HOME: scratch, PGPASSFILE: path.join(scratch, 'absent-pgpass'), PGSERVICEFILE: path.join(scratch, 'absent-pgservice'), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000' });
await fs.mkdir(output, { recursive: true });
let candidate = null;
try { candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = {
  kind: 'ISOLATED_STAGING_APPLICATION_ENVELOPE', status: 'RUNNING', startedAt: new Date().toISOString(), candidate,
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))), envelopeManifestSha256: sha(manifestBytes),
  originalReviewManifestSha256: manifest.originalReviewManifestSha256, envelopeInputHashes: manifest.files, testedSourceHashes,
  sqlExecuted: false, hostedExecuted: false, providerCalls: 0, productionDeployed: false, authorizationGranted: false,
  simulatedBindingsOnly: true, boundSqlPersisted: false, checks: [], expectedErrors: [], bindingInjections: [], faultInjections: [], phases: [],
  limitations: [
    'Local simulated approval is synthetic test data. It is not owner approval, release permission, or evidence of a real ingress pause and drain.',
    'PostgreSQL cannot authenticate a Supabase project from a JSON assertion. Hosted execution needs independently verified structured project binding and authorization.',
    'No hosted SQL, migration tool, Worker, authentication service, browser, email provider, payment, storage, or production deployment is exercised.',
    'Only the new envelope is exercised here. Earlier behavioral and concurrency results apply only while all 21 previously tested source inputs retain their hashes.',
    'External Auth/Profile/role tables are minimal synthetic projections. Actual Study and Debate tables and hosted role memberships are not reproduced.',
    'The late-failure probe uses an outer transaction around the exact bound envelope; its injected exception verifies rollback before commit, not failure after commit.',
    'The two repeat-expiry probes insert a reported in-memory delay immediately before the repeat return guard. Frozen inputs and function bodies remain unchanged; ordinary application and repeat probes execute the exact template.',
    'Local psql deadlines and termination do not establish the supported hosted migration executor deadline or cancellation behavior.',
  ],
};
const check = (name, condition = true) => { assert.ok(condition, name); report.checks.push({ name, passed: true }); };

function start(sql, { name = 'envelope-native', bootstrap = false, database = 'postgres', setupRole = false, fixture = false, expectedCode, expectedMessage, keepOpen = false } = {}) {
  assert.match(name, /^[a-zA-Z0-9_-]{1,60}$/);
  assert.ok(['postgres', 'template1', 'unused_bootstrap_database', 'duediligence_compatibility_fixture'].includes(database));
  const connection = { ...env, PGDATABASE: database, PGUSER: bootstrap ? 'fixture_bootstrap' : 'postgres', PGPASSWORD: bootstrap ? expectedEnv.PGPASSWORD : 'isolated_envelope_role_only', PGAPPNAME: name };
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env: connection, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', killed = false, inputError = null;
  const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 45000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 2000000) { killed = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 2000000) { killed = true; child.kill('SIGKILL'); } });
    child.stdin.on('error', error => { inputError = error.code ?? 'STDIN_ERROR'; });
    child.on('error', error => { clearTimeout(timer); reject(new Error('PSQL_START_FAILED', { cause: error })); });
    child.on('close', code => {
      clearTimeout(timer);
      const sqlState = /ERROR:\s+([A-Z0-9]{5}):/.exec(stderr)?.[1] ?? null;
      // Preserve the actual error while excluding SQL context (which may contain
      // the in-memory simulated binding) from logs and evidence artifacts.
      const diagnostic = stderr.split('\n').filter(line => /^(ERROR|DETAIL|HINT|LOCATION):/.test(line)).join('\n').slice(0, 2000);
      if (killed) return reject(Object.assign(new Error('NATIVE_SQL_LIMIT_EXCEEDED'), { applicationName: name, sqlState, diagnostic }));
      if (expectedCode) {
        if (code === 0 || sqlState !== expectedCode || (expectedMessage && !diagnostic.includes(expectedMessage))) return reject(Object.assign(new Error('EXPECTED_SQL_DENIAL_MISMATCH'), { applicationName: name, sqlState, diagnostic }));
        report.expectedErrors.push({ name, sqlState, expectedMessage: expectedMessage ?? null, diagnostic, diagnosticSha256: sha(stderr) });
        return resolve(sqlState);
      }
      if (code !== 0) return reject(Object.assign(new Error('NATIVE_SQL_FAILED'), { applicationName: name, sqlState, diagnostic }));
      if (inputError) return reject(Object.assign(new Error('PSQL_INPUT_FAILED'), { applicationName: name, diagnostic: inputError }));
      resolve(stdout.trim());
    });
  });
  // A lock holder can stay open while another connection verifies NOWAIT.
  // Install an immediate rejection handler so an early SQL exit is not unhandled.
  done.catch(() => {});
  const prefix = (fixture ? "SET duediligence.compatibility_fixture='isolated-current-capture-20261018';\n" : '') + (setupRole ? 'SET ROLE postgres;\n' : '');
  if (keepOpen) child.stdin.write(prefix + sql + '\n'); else child.stdin.end(prefix + sql);
  return { done, finish: () => { if (!child.stdin.destroyed) child.stdin.end('ROLLBACK;\n'); } };
}
const run = (sql, options) => start(sql, options).done;
const canonicalSettings = "SET TIME ZONE 'UTC'; SET DateStyle='ISO, YMD'; SET IntervalStyle='postgres'; SET extra_float_digits=3; SET bytea_output='hex';\n";
const normalize = rows => rows.map(({ signature, ...rest }) => rest).sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`, 'en'));
const catalogSql = "SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text) ORDER BY n.nspname,p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='examination_room_v1' OR (n.nspname='public' AND p.proname IN ('examination_room_v1_api','examination_room_v1_lifecycle_guard'));";
const shapeMatch = originalFiles.get('verify-current-schema.sql').match(/  SELECT jsonb_build_object\([\s\S]*?\n  \) INTO actual;/);
assert.ok(shapeMatch, 'Exact captured schema query must be available');
const shapeSql = shapeMatch[0].replace(/ INTO actual;$/, ';');
const externalSql = `SELECT jsonb_build_object(
  'rows', (SELECT jsonb_object_agg(name,state) FROM (${['auth.users', 'public.profiles', 'public.user_roles'].map(relation => `SELECT '${relation}' AS name,jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state FROM ${relation} t`).join(' UNION ALL ')}) x),
  'columns', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped AND ((n.nspname='auth' AND c.relname='users') OR (n.nspname='public' AND c.relname IN ('profiles','user_roles')))),
  'roles', (SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDatabase',rolcreatedb,'canLogin',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls) ORDER BY rolname) FROM pg_roles)
);`;
const rowState = async () => {
  const captured = await run(files.get('cutover-row-state-capture.sql'), { name: 'envelope-row-state' });
  const separator = captured.indexOf('|');
  assert.ok(separator > 0 && !captured.includes('\n'), 'Read-only row capture must return exactly one record');
  const state = JSON.parse(captured.slice(separator + 1));
  assert.deepEqual(Object.keys(state).sort(), tableNames);
  return state;
};
let referenceRows, referenceShape, referenceExternal;
async function verifyUnchanged(expected, label) {
  assert.deepEqual(normalize(JSON.parse(await run(catalogSql))), normalize(expected), `${label}: exact function catalog`);
  const shape = JSON.parse(await run(shapeSql));
  const leaseTriggers = shape.triggers.filter(t => t.name === 'student_sessions_open_room_lease');
  assert.equal(leaseTriggers.length, expected.length === 49 ? 1 : 0, `${label}: exact new trigger count`);
  if (leaseTriggers.length) {
    assert.deepEqual(leaseTriggers[0], { table: 'student_sessions', name: 'student_sessions_open_room_lease', enabled: 'O', definition: index.trigger, function: index.lease.signature });
    shape.triggers = shape.triggers.filter(t => t.name !== 'student_sessions_open_room_lease');
  }
  assert.deepEqual(shape, referenceShape, `${label}: schema outside allowed new trigger`);
  assert.deepEqual(await rowState(), referenceRows, `${label}: all 28 target table counts and digests`);
  assert.deepEqual(JSON.parse(await run(canonicalSettings + externalSql)), referenceExternal, `${label}: external rows, columns and roles`);
  check(label);
}
function simulatedBinding(overrides = {}) {
  const now = Date.now();
  const binding = structuredClone(templateBinding);
  Object.assign(binding, {
    status: 'APPROVED_STAGING_ONLY', targetAcknowledgment: 'STAGING ONLY hlzqmreeoghbldnhlybr; PRODUCTION hbllomlijfznnuudpdvr FORBIDDEN',
    releaseAuthorizationEvidenceSha256: sha('SYNTHETIC LOCAL TEST ONLY; NO OWNER AUTHORIZATION'),
    currentCaptureEvidenceSha256: sha(JSON.stringify(referenceRows)),
  });
  Object.assign(binding.cutover, {
    status: 'INGRESS_PAUSED_AND_INFLIGHT_DRAINED',
    methodDescription: 'SYNTHETIC LOCAL TEST ONLY: fresh isolated container with no hosted ingress; not actual release authorization or cutover evidence.',
    pauseEvidenceSha256: sha('SIMULATED LOCAL PAUSE ONLY'), drainEvidenceSha256: sha('SIMULATED LOCAL DRAIN ONLY'),
    allowedAfterUtc: new Date(now - 60000).toISOString(), expiresAtUtc: new Date(now + 8 * 60000).toISOString(),
    originalRowState: referenceRows, writesNeverResumed: true,
    inverseAuthorizationEvidenceSha256: sha('SIMULATED LOCAL INVERSE ONLY; NO OWNER AUTHORIZATION'),
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'cutover') Object.assign(binding.cutover, value); else binding[key] = value;
  }
  return binding;
}
function bind(phase, binding, name) {
  const parts = bindingParts.get(phase);
  const json = JSON.stringify(binding);
  assert.ok(!json.includes(delimiter));
  report.bindingInjections.push({ name, phase, delimiter, replacements: 1, simulationOnly: true, authorizationGranted: false, bindingSha256: sha(json), templateSha256: manifest.files[`${phase}.review.sql`] });
  // Only the explicitly delimited JSON is replaced; all SQL/body bytes remain exact.
  return parts[0] + delimiter + json + delimiter + parts[2];
}
async function deny(name, { phase = 'forward', binding, prefix = '', suffix = '', expectedCode = 'P0001', expectedMessage, expected = baseline, faultInjection, ...connection } = {}) {
  const sql = binding === null ? files.get(`${phase}.review.sql`) : bind(phase, binding ?? simulatedBinding(), name);
  if (faultInjection) report.faultInjections.push({ name, phase, kind: faultInjection, simulationOnly: true, frozenInputChanged: false, templateSha256: manifest.files[`${phase}.review.sql`], prefixSha256: sha(prefix), suffixSha256: sha(suffix) });
  await run(prefix + sql + suffix, { name, expectedCode, expectedMessage, ...connection });
  await verifyUnchanged(expected, `${name}: rejection preserves catalog and rows`);
}
async function apply(phase, expected, name) {
  await run(bind(phase, simulatedBinding(), name), { name });
  await verifyUnchanged(expected, `${name}: exact package and unchanged rows`);
  report.phases.push({ name, passed: true });
}
async function repeatExpiry(phase, expected) {
  const name = `envelope-${phase}-repeat-expiry`;
  const binding = simulatedBinding({ cutover: { expiresAtUtc: new Date(Date.now() + 8000).toISOString() } });
  const sql = bind(phase, binding, name);
  const anchor = "    IF clock_timestamp() >= (binding#>>'{cutover,expiresAtUtc}')::timestamptz THEN RAISE EXCEPTION 'CUTOVER_WINDOW_EXPIRED_BEFORE_ENVELOPE_RETURN'; END IF;\n    RETURN;";
  assert.equal(sql.split(anchor).length, 2, 'The repeat expiry guard must occur exactly once');
  const delay = "    PERFORM pg_sleep(greatest(0, extract(epoch FROM ((binding#>>'{cutover,expiresAtUtc}')::timestamptz - clock_timestamp()))) + 0.1);\n";
  // This isolated fault injection changes only test-process memory. No bound
  // SQL, simulated approval, or injected SQL is written to disk or uploaded.
  const delayed = sql.replace(anchor, () => delay + anchor);
  report.faultInjections.push({ name, phase, kind: 'IN_MEMORY_DELAY_AT_EXACT_REPEAT_EXPIRY_GUARD', simulationOnly: true, frozenInputChanged: false, functionBodiesChanged: false, replacements: 1, templateSha256: manifest.files[`${phase}.review.sql`], injectedFragmentSha256: sha(delay), boundDelayedSqlSha256: sha(delayed), maximumPlannedDelayMs: 8100 });
  await run(delayed, { name, expectedCode: 'P0001', expectedMessage: 'CUTOVER_WINDOW_EXPIRED_BEFORE_ENVELOPE_RETURN' });
  await verifyUnchanged(expected, `${name}: final repeat guard rejects after expiry without changes`);
}
async function contention(kind) {
  const name = `envelope-${kind}-holder`;
  const lock = kind === 'table' ? 'LOCK TABLE examination_room_v1.institutions IN ACCESS SHARE MODE;' : 'SELECT pg_advisory_xact_lock(176018,61018);';
  const holder = start(`BEGIN; ${lock}`, { name, keepOpen: true });
  try {
    const predicate = kind === 'table' ? "l.locktype='relation' AND l.relation='examination_room_v1.institutions'::regclass AND l.mode='AccessShareLock'" : "l.locktype='advisory' AND l.classid=176018 AND l.objid=61018";
    const observer = `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='${name}' AND l.granted AND ${predicate});`;
    let held = false;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await run(observer, { name: 'envelope-lock-observer', bootstrap: true }) === 't') { held = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(held, `${kind}: separate connection must hold the actual lock`);
    const started = Date.now();
    await deny(`envelope-${kind}-contention`, { expectedCode: kind === 'table' ? '55P03' : 'P0001', expectedMessage: kind === 'table' ? undefined : 'COMPATIBILITY_UPDATE_BUSY' });
    check(`${kind}: actual overlapping connection rejected within bounded time`, Date.now() - started < 10000);
  } finally {
    holder.finish();
    await holder.done;
  }
}

try {
  const server = JSON.parse(await run("SELECT jsonb_build_object('version',current_setting('server_version_num'),'database',current_database(),'user',current_user,'address',inet_server_addr()::text);", { bootstrap: true, database: expectedEnv.PGDATABASE }));
  // inet_server_addr reports the container-side bridge interface after Docker
  // port forwarding. The client is fixed to loopback by the checks above.
  check('Fresh loopback PostgreSQL 17.6 bootstrap', server.version === '170006' && server.database === expectedEnv.PGDATABASE && server.user === 'fixture_bootstrap');
  report.server = server; report.sqlExecuted = true;
  await run(originalFiles.get('current-schema.sql'), { name: 'envelope-provision', bootstrap: true, database: expectedEnv.PGDATABASE, fixture: true });
  await run(originalFiles.get('verify-current-schema.sql'), { name: 'envelope-verify-original', bootstrap: true, setupRole: true, database: expectedEnv.PGDATABASE, fixture: true });
  check('Original fixture imported and verified without changes');
  await run(`DO $$ BEGIN
    IF current_database()<>'postgres' OR current_user<>'fixture_bootstrap' OR session_user<>'fixture_bootstrap'
       OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'fixture_bootstrap'
       OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('examination_room_v1','auth','extensions'))
       OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
       OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
       OR EXISTS(SELECT 1 FROM pg_database WHERE datname='unused_bootstrap_database')
       OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())
    THEN RAISE EXCEPTION 'DISPOSABLE_DEFAULT_DATABASE_NOT_EMPTY_OR_SAFE'; END IF;
  END $$;`, { name: 'envelope-check-empty-default', bootstrap: true });
  await run(`ALTER DATABASE postgres RENAME TO unused_bootstrap_database;
    ALTER DATABASE duediligence_compatibility_fixture RENAME TO postgres;
    ALTER ROLE postgres WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS LOGIN PASSWORD 'isolated_envelope_role_only';`, { name: 'envelope-set-local-identity', bootstrap: true, database: 'template1' });
  const identity = await run(files.get('executor-identity-capture.sql'), { name: 'envelope-captured-identity' });
  report.executorIdentityResultSha256 = sha(identity);
  const who = JSON.parse(await run("SELECT jsonb_build_object('database',current_database(),'current',current_user,'session',session_user,'role',current_setting('role'),'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user));"));
  assert.deepEqual(who, { database: 'postgres', current: 'postgres', session: 'postgres', role: 'none', superuser: false });
  check('Envelope authenticates directly as captured non-superuser postgres');
  await run(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('72000000-0000-0000-0000-000000000001','envelope-fixture@example.invalid','{"synthetic":true}');
    INSERT INTO public.profiles(id,display_name,school,law_school_id) VALUES ('72000000-0000-0000-0000-000000000001','Envelope fixture','Synthetic school','envelope-fixture');
    INSERT INTO public.user_roles(user_id,role) VALUES ('72000000-0000-0000-0000-000000000001','synthetic-envelope');
    INSERT INTO examination_room_v1.institutions(id,institution_code,profile_school_id,institution_name,bootstrap_request_hash,created_by_user_id)
    VALUES ('72000000-0000-0000-0000-000000000002','envelope-fixture','envelope-fixture','Synthetic envelope fixture',repeat('a',64),'72000000-0000-0000-0000-000000000001');`, { name: 'envelope-synthetic-sentinels' });
  referenceRows = await rowState();
  referenceShape = JSON.parse(await run(shapeSql));
  referenceExternal = JSON.parse(await run(canonicalSettings + externalSql));
  report.syntheticBaselineRowsSha256 = sha(JSON.stringify(referenceRows));
  report.syntheticExternalBaselineSha256 = sha(JSON.stringify(referenceExternal));
  await verifyUnchanged(baseline, 'Initial exact captured catalog and nonempty synthetic sentinels');
  for (const phase of ['forward', 'inverse']) await deny(`envelope-default-${phase}`, { phase, binding: null, expectedMessage: 'REVIEW_ONLY_STAGING_RELEASE_NOT_APPROVED' });
  await deny('envelope-wrong-project', { binding: simulatedBinding({ targetProjectId: manifest.forbiddenProductionProjectId }), expectedMessage: 'REVIEW_ONLY_STAGING_RELEASE_NOT_APPROVED' });
  await deny('envelope-expired', { binding: simulatedBinding({ cutover: { allowedAfterUtc: new Date(Date.now()-120000).toISOString(), expiresAtUtc: new Date(Date.now()-60000).toISOString() } }), expectedMessage: 'ENFORCED_CURRENT_CUTOVER_EVIDENCE_REQUIRED' });
  await deny('envelope-incomplete-cutover', { binding: simulatedBinding({ cutover: { pauseEvidenceSha256: null } }), expectedMessage: 'ENFORCED_CURRENT_CUTOVER_EVIDENCE_REQUIRED' });
  await deny('envelope-no-row-snapshot', { binding: simulatedBinding({ cutover: { originalRowState: null } }), expectedMessage: 'ENFORCED_CURRENT_CUTOVER_EVIDENCE_REQUIRED' });
  await deny('envelope-wrong-session', { bootstrap: true, expectedMessage: 'STAGING_EXECUTOR_IDENTITY_MISMATCH' });
  await deny('envelope-wrong-configured-role', { prefix: 'SET ROLE postgres;\n', expectedMessage: 'STAGING_EXECUTOR_IDENTITY_MISMATCH' });
  await deny('envelope-wrong-database', { database: 'unused_bootstrap_database', expectedMessage: 'STAGING_EXECUTOR_IDENTITY_MISMATCH' });
  await deny('envelope-protected-function-drift', { prefix: "BEGIN; ALTER FUNCTION examination_room_v1.api_error(text,text,integer,text) SET work_mem='4MB';\n", suffix: '\nCOMMIT;', expectedMessage: 'UNKNOWN_OR_PARTIAL_PACKAGE_PREIMAGE' });
  await deny('envelope-partial-package', { prefix: `BEGIN; ${definitions[0].after};\n`, suffix: '\nCOMMIT;', expectedMessage: 'UNKNOWN_OR_PARTIAL_PACKAGE_PREIMAGE' });
  await deny('envelope-schema-drift', { prefix: 'BEGIN; ALTER TABLE examination_room_v1.institutions ADD COLUMN synthetic_drift text;\n', suffix: '\nCOMMIT;', expectedMessage: 'STAGING_SCHEMA_CHANGED' });
  await deny('envelope-data-drift', { prefix: "BEGIN; INSERT INTO examination_room_v1.institutions(id,institution_code,profile_school_id,institution_name,bootstrap_request_hash,created_by_user_id) VALUES ('72000000-0000-0000-0000-000000000003','envelope-drift','envelope-drift','Synthetic drift',repeat('b',64),'72000000-0000-0000-0000-000000000001');\n", suffix: '\nCOMMIT;', expectedMessage: 'STAGING_DATA_CHANGED_SINCE_CUTOVER_SNAPSHOT' });
  await deny('envelope-late-forward-rollback', { prefix: 'BEGIN;\n', suffix: "\nDO $$ BEGIN RAISE EXCEPTION 'TEST_FORCED_FAILURE_AFTER_EXACT_FORWARD'; END $$; COMMIT;", faultInjection: 'OUTER_TRANSACTION_FAILURE_AFTER_EXACT_ENVELOPE', expectedMessage: 'TEST_FORCED_FAILURE_AFTER_EXACT_FORWARD' });
  await contention('table');
  await contention('advisory');
  await apply('forward', postimage, 'envelope-forward');
  await apply('forward', postimage, 'envelope-forward-repeat');
  await repeatExpiry('forward', postimage);
  await deny('envelope-inverse-writes-resumed', { phase: 'inverse', binding: simulatedBinding({ cutover: { writesNeverResumed: false } }), expected: postimage, expectedMessage: 'INVERSE_FORBIDDEN_AFTER_WRITES_RESUMED_OR_WITHOUT_SEPARATE_AUTHORIZATION' });
  await deny('envelope-inverse-no-authorization', { phase: 'inverse', binding: simulatedBinding({ cutover: { inverseAuthorizationEvidenceSha256: null } }), expected: postimage, expectedMessage: 'INVERSE_FORBIDDEN_AFTER_WRITES_RESUMED_OR_WITHOUT_SEPARATE_AUTHORIZATION' });
  await deny('envelope-late-inverse-rollback', { phase: 'inverse', prefix: 'BEGIN;\n', suffix: "\nDO $$ BEGIN RAISE EXCEPTION 'TEST_FORCED_FAILURE_AFTER_EXACT_INVERSE'; END $$; COMMIT;", faultInjection: 'OUTER_TRANSACTION_FAILURE_AFTER_EXACT_ENVELOPE', expected: postimage, expectedMessage: 'TEST_FORCED_FAILURE_AFTER_EXACT_INVERSE' });
  await apply('inverse', baseline, 'envelope-inverse');
  await apply('inverse', baseline, 'envelope-inverse-repeat');
  await repeatExpiry('inverse', baseline);
  report.status = 'PASS_SCOPED_NATIVE_ENVELOPE_CHECKS';
} catch (error) {
  report.status = 'FAIL';
  report.error = { name: error.name, message: error.message, sqlState: error.sqlState ?? null, applicationName: error.applicationName ?? null, diagnostic: error.diagnostic ?? null };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, expectedErrors: report.expectedErrors.length, phases: report.phases.length, hostedExecuted: false, authorizationGranted: false, error: report.error ?? null }));
}
