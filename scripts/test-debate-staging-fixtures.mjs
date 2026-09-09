import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStudyDebateFixtureLifecycle, studyDebateFixtureIdentity, FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { withStudyDebateStagingAccounts, runRestrictedStaging, verifyRestrictedStagingPreflight,
  executeRestrictedStagingChild } from './run-debate-staging-auth.mjs';
import { CRITICAL_SOURCES, CRITICAL_ASSETS, REQUIRED_SUITE_GROUPS, hash, parseBase, buildConfig,
  sanitizeBaseline } from './debate-staging-release.mjs';
import { createStudyRoomHandlers } from '../worker/study-room-routes.mjs';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const clone = value => structuredClone(value);
function response(body, status = 200, range = null) { return { status,
  headers: { get: key => key === 'content-range' ? range : null }, json: async () => clone(body) }; }
function harness(overrides = {}) {
  const calls = [], checkpoints = [], users = new Map(), roles = new Map(), registered = new Set(), tokens = new Map();
  const studyHandlers = createStudyRoomHandlers({
    authenticate: async request => ({ id: tokens.get(request.headers.get('Authorization')?.slice(7)) }),
    authorizeAdmin: async () => null,
    authorizeMember: async (_env, user) => ({ allowed: users.has(user.id), basis: 'signed_in' }),
    rateLimit: async () => {}, readCatalog: async () => ({ schemaVersion: 1, maxRooms: 24,
      rooms: ['1','2','3','4','5','6'].map(roomKey => ({ roomKey, label: 'Room ' + roomKey,
        audience: roomKey === '5' ? 'admin' : 'all', revision: 1, accessRevision: 1 })) }),
    describeRoom: () => ({ maxRooms: 24, maxParticipants: 100, recording: false }),
    respond: (body, status) => response(body, status),
  });
  let seed = 1;
  const config = { sourceSha: 'a'.repeat(40), ...FIXTURE_TARGET, serviceRoleKey: `sb_secret_${'s'.repeat(30)}`,
    publishableKey: `sb_publishable_${'p'.repeat(30)}`, clock: () => NOW,
    random: size => Buffer.alloc(size, seed++),
    verifySuppression: async () => overrides.suppression || { projectRef: FIXTURE_TARGET.projectRef, outboundEmailMode: 'suppressed' },
    persist: async manifest => { if (overrides.persistFailure) throw new Error('SAVE_FAILED');
      const serialized = JSON.stringify(manifest);
      assert.ok(!serialized.includes('@') && !serialized.includes('password') && !serialized.includes('sb_secret_'));
      for (const token of tokens.keys()) assert.ok(!serialized.includes(token));
      checkpoints.push(clone(manifest)); },
    request: async (url, options = {}) => {
      const u = new URL(url), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
      assert.ok([FIXTURE_TARGET.supabaseUrl, FIXTURE_TARGET.workerUrl].includes(u.origin));
      assert.equal(options.redirect, 'error');
      const call = { url: u, method, body, headers: options.headers }; calls.push(call);
      if (overrides.intercept) { const result = overrides.intercept(call, { users, roles, calls, registered, checkpoints }); if (result) return result; }
      if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
        assert.equal(checkpoints.at(-1).fixtures.at(-1).creationState, 'requested');
        const id = `${String(users.size + 1).repeat(8)}-1111-4111-8111-111111111111`;
        const user = { id, email: body.email, created_at: new Date(NOW).toISOString(), role: 'authenticated', aud: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'], ...body.app_metadata }, user_metadata: body.user_metadata };
        users.set(id, user); roles.set(id, { user_id: id, role: 'student', assigned_by: null, updated_at: new Date(NOW).toISOString() });
        return response({ user }, 201);
      }
      if (u.pathname === '/rest/v1/rpc/astra_register_staging_study_room_fixture') {
        assert.ok(users.has(body.p_user_id)); assert.equal(body.p_label, 'student');
        assert.equal(checkpoints.at(-1).fixtures.at(-1).registrationState, 'requested'); registered.add(body.p_user_id);
        return response({ registered: true, fixtureUserId: body.p_user_id, dataScope: 'internal_test', registrationVersion: 'astra-staging-study-room-v1' });
      }
      if (u.pathname === '/auth/v1/token') {
        const user = [...users.values()].find(row => row.email === body.email); assert.ok(registered.has(user.id));
        assert.equal(u.searchParams.get('grant_type'), 'password');
        const token = `synthetic-test-${user.id}-`.repeat(4); tokens.set(token, user.id);
        return response({ access_token: token, refresh_token: 'never-stored-or-used', user });
      }
      if (u.pathname === '/auth/v1/user') {
        const id = tokens.get(options.headers.Authorization?.slice(7));
        return users.has(id) ? response({ id }) : response({ code: 'user_not_found' }, 401);
      }
      if (u.pathname === '/study-room/access') {
        if (method !== 'POST') return response({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
        assert.equal(options.headers.Origin, FIXTURE_TARGET.workerUrl);
        assert.equal(options.headers['Content-Type'], 'application/json'); assert.deepEqual(body, {});
        assert.equal(checkpoints.at(-1).fixtures.at(-1).studyAccess, 'requested');
        assert.ok(tokens.has(options.headers.Authorization.slice(7)));
        return studyHandlers.access(new Request(url, options), {}, FIXTURE_TARGET.workerUrl, FIXTURE_TARGET.workerUrl);
      }
      if (u.pathname === '/auth/v1/logout') { assert.equal(u.searchParams.get('scope'), 'global'); return response(null, 204); }
      if (u.pathname.startsWith('/auth/v1/admin/users/')) {
        const id = u.pathname.split('/').at(-1);
        if (method === 'GET') return response(users.get(id) || null, users.has(id) ? 200 : 404);
        assert.equal(method, 'DELETE'); assert.ok(!roles.has(id));
        const saved = checkpoints.at(-1).fixtures.find(row => row.id === id);
        assert.equal(saved.cleanupState, 'auth_delete_requested');
        assert.ok(['confirmed', 'not_needed_no_signin_requested'].includes(saved.signOutState));
        users.delete(id); return response(null, 204);
      }
      if (u.pathname.startsWith('/rest/v1/')) {
        const table = u.pathname.slice('/rest/v1/'.length);
        const id = u.searchParams.get('user_id')?.slice(3);
        if (method === 'DELETE') {
          assert.equal(table, 'user_roles'); const role = roles.get(id);
          assert.deepEqual([...u.searchParams.keys()].sort(), Object.keys(role).sort());
          const matches = Object.entries(role).every(([key, value]) => u.searchParams.get(key) === (value === null ? 'is.null' : `eq.${value}`));
          if (overrides.roleCasFailure) return response([]);
          assert.ok(matches); roles.delete(id); return response([role]);
        }
        assert.equal(method, 'GET'); assert.equal(u.searchParams.get('limit'), '101'); assert.equal(options.headers.Prefer, 'count=exact');
        let found = table === 'user_roles' && id && roles.has(id) ? [roles.get(id)] : [];
        if (overrides.rows) found = overrides.rows(table, u.searchParams, found);
        return response(found, 200, overrides.incompleteTable === table ? '0-0/2' : (found.length ? `0-${found.length - 1}/${found.length}` : '*/0'));
      }
      throw new Error('Unexpected synthetic transport');
    } };
  return { config, actual: createStudyDebateFixtureLifecycle(config), calls, checkpoints, users, roles };
}

test('fixed project, existing student fixture contract and required suppression gate', async () => {
  assert.equal(studyDebateFixtureIdentity('dv3study-1234abcd').fullName, 'Synthetic Study Room student');
  assert.throws(() => studyDebateFixtureIdentity('another-1234abcd'), /FIXTURE_RUN_ID_INVALID/);
  const h = harness(); assert.throws(() => createStudyDebateFixtureLifecycle({ ...h.config, supabaseUrl: 'https://production.invalid' }), /FIXTURE_TARGET_INVALID/);
  const bad = harness({ suppression: { projectRef: FIXTURE_TARGET.projectRef, outboundEmailMode: 'live' } });
  await assert.rejects(bad.actual.provision(), /FIXTURE_SUPPRESSION_REQUIRED/); assert.equal(bad.calls.length, 0);
});
test('two distinct real Study labels register before signin and pass access before callback', async () => {
  const h = harness(), accounts = await h.actual.provision();
  assert.notEqual(accounts.allowed.id, accounts.excluded.id);
  assert.equal(h.calls.filter(c => c.url.pathname === '/study-room/access').length, 2);
  assert.equal(h.actual.snapshot().fixtures.every(r => r.studyAccess === 'PASS_STUDENT_ACCESS_NO_JOIN'), true);
  assert.equal(h.actual.snapshot().fixtures.every(r => r.studyAccessRole === 'member'), true);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 8);
  assert.ok(h.calls.every(c => !/invite|signup|recover|storage|livekit|join/u.test(c.url.pathname)));
  const cleaned = await h.actual.cleanup(); assert.equal(cleaned.complete, true);
  assert.equal(h.users.size, 0); assert.equal(h.roles.size, 0);
  assert.equal(h.actual.snapshot().fixtures.every(r => r.oldSessionDenied), true);
  assert.equal((await h.actual.cleanup()).complete, true, 'Repeated cleanup performs no new deletions');
});
test('intent persistence failure prevents every remote mutation', async () => {
  const h = harness({ persistFailure: true }); await assert.rejects(h.actual.provision(), /SAVE_FAILED/); assert.equal(h.calls.length, 0);
});
test('a rejected Study access request cleans its registered signed-in fixture before a second account is created', async () => {
  const h = harness({ intercept: c => c.url.pathname === '/study-room/access' ? response({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405) : null });
  await assert.rejects(h.actual.provision(), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal(h.actual.snapshot().fixtures.length, 1);
  assert.equal(h.actual.snapshot().fixtures[0].studyAccess, 'requested');
  assert.equal((await h.actual.cleanup()).complete, true);
  assert.equal(h.users.size, 0); assert.equal(h.roles.size, 0);
  assert.equal(h.actual.snapshot().fixtures[0].oldSessionDenied, true);
});
for (const route of ['/auth/v1/admin/users', '/auth/v1/token']) {
  test(`uncertain ${route} is single-shot and held, never blindly retried`, async () => {
    const h = harness({ intercept: c => c.method === 'POST' && c.url.pathname === route ? response(null, 503) : null });
    await assert.rejects(h.actual.provision(), /FIXTURE_REMOTE_CONTRACT/);
    const cleaned = await h.actual.cleanup(); assert.equal(cleaned.complete, false);
    assert.equal(h.calls.filter(c => c.method === 'POST' && c.url.pathname === route).length, 1);
    assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
  });
}
test('known UUID after registrar failure is cleaned without sign-in or pretending logout occurred', async () => {
  const h = harness({ intercept: c => c.url.pathname === '/rest/v1/rpc/astra_register_staging_study_room_fixture' ? response(null, 503) : null });
  await assert.rejects(h.actual.provision(), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.actual.cleanup()).complete, true); assert.equal(h.users.size, 0);
  assert.equal(h.calls.some(c => c.url.pathname === '/auth/v1/token' || c.url.pathname === '/auth/v1/logout'), false);
  assert.equal(h.actual.snapshot().fixtures[0].signOutState, 'not_needed_no_signin_requested');
  assert.equal(h.actual.snapshot().fixtures[0].registrationState, 'requested');
  assert.equal(h.actual.snapshot().fixtures[0].oldSessionDenied, null);
});
test('known UUID before registrar request is cleaned if verified identity has no sign-in', async () => {
  let failOnce = true;
  const h = harness({ intercept: c => {
    if (failOnce && c.url.pathname.startsWith('/auth/v1/admin/users/') && c.method === 'GET') {
      failOnce = false; return response(null, 503);
    }
    return null;
  } });
  await assert.rejects(h.actual.provision(), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.actual.cleanup()).complete, true); assert.equal(h.users.size, 0);
  assert.equal(h.actual.snapshot().fixtures[0].registrationState, 'not_started');
});
test('first fully signed-in fixture cleans even when second create outcome is unknown', async () => {
  const h = harness({ intercept: (c, state) => c.url.pathname === '/auth/v1/admin/users' && c.method === 'POST' && state.users.size === 1 ? response(null, 503) : null });
  await assert.rejects(h.actual.provision(), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.actual.cleanup()).complete, false); assert.equal(h.users.size, 0);
  const records = h.actual.snapshot().fixtures;
  assert.equal(records[0].cleanupState, 'auth_deleted_verified'); assert.equal(records[1].cleanupState, 'held');
});
test('failure after confirmed registration but before login dispatch cleans without a session', async () => {
  const h = harness(); let failOnce = true;
  const actual = createStudyDebateFixtureLifecycle({ ...h.config, persist: async manifest => {
    if (failOnce && manifest.fixtures[0]?.registrationState === 'confirmed' && manifest.fixtures[0]?.signInState === 'requested') {
      failOnce = false; throw new Error('INERT_PERSISTENCE_FAILURE');
    }
    return h.config.persist(manifest);
  } });
  await assert.rejects(actual.provision(), /INERT_PERSISTENCE_FAILURE/);
  assert.equal((await actual.cleanup()).complete, true); assert.equal(h.users.size, 0);
  assert.equal(actual.snapshot().fixtures[0].signInNotDispatchedConfirmed, true);
  assert.equal(h.calls.some(c => c.url.pathname === '/auth/v1/token'), false);
});
test('unexpected sign-in blocks the no-signin cleanup branch', async () => {
  const h = harness({ intercept: (c, state) => {
    if (c.url.pathname === '/rest/v1/rpc/astra_register_staging_study_room_fixture') {
      state.users.get(c.body.p_user_id).last_sign_in_at = new Date(NOW).toISOString(); return response(null, 503);
    }
    return null;
  } });
  await assert.rejects(h.actual.provision()); assert.equal((await h.actual.cleanup()).complete, false);
  assert.equal(h.calls.some(c => c.method === 'DELETE'), false);
});
test('trusted metadata drift prevents deletion of that account while cleanup continues for other run', async () => {
  const h = harness(), accounts = await h.actual.provision();
  h.users.get(accounts.allowed.id).app_metadata.astra_staging_study_room_fixture.runId = 'foreign-run';
  const result = await h.actual.cleanup(); assert.equal(result.complete, false);
  assert.equal(h.users.size, 1); assert.equal(h.users.has(accounts.allowed.id), true);
  assert.equal(result.failures[0].code, 'FIXTURE_IDENTITY_DRIFT');
});
for (const table of ['payment_requests', 'debate_v3_receipts', 'debate_v3_events']) {
  test(`unexpected ${table} is held without Auth deletion`, async () => {
    const h = harness({ rows: (name, query, found) => name === table ? [{ id: 'owned-unexpected-row' }] : found });
    await h.actual.provision(); assert.equal((await h.actual.cleanup()).complete, false);
    assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
  });
}
test('foreign event membership is detected even when fixture owns no event', async () => {
  const h = harness({ rows: (table, query, found) => table === 'debate_v3_events' && query.has('state') ? [{ id: 'foreign-event' }] : found });
  await h.actual.provision(); assert.equal((await h.actual.cleanup()).complete, false);
  assert.equal(h.users.size, 2);
});
test('incomplete exact-user discovery and role compare-and-swap drift stop Auth cascade', async () => {
  for (const options of [{ incompleteTable: 'payment_requests' }, { roleCasFailure: true }]) {
    const h = harness(options); await h.actual.provision(); assert.equal((await h.actual.cleanup()).complete, false);
    assert.equal(h.users.size, 2); assert.equal(h.calls.some(c => c.method === 'DELETE' && c.url.pathname.startsWith('/auth/')), false);
  }
});
test('deleted-user session must actually fail validation; logout response alone is not proof', async () => {
  const h = harness({ intercept: (c, state) => c.url.pathname === '/auth/v1/user' && !state.users.size ? response({ id: 'stale' }) : null });
  await h.actual.provision(); assert.equal((await h.actual.cleanup()).complete, false);
  assert.ok(h.actual.snapshot().fixtures.some(r => r.cleanupState === 'held'));
});
test('coordinator finally cleans both accounts after callback failure and keeps secrets off disk', async () => {
  const h = harness(), directory = await mkdtemp(path.join(tmpdir(), 'debate-auth-inert-'));
  try {
    const file = path.join(directory, 'manifest.json');
    // The harness observes coordinator checkpoints through its own persist hook.
    const original = h.config.request;
    h.config.request = async (...args) => {
      h.checkpoints.push(JSON.parse(await readFile(file, 'utf8'))); return original(...args);
    };
    await assert.rejects(withStudyDebateStagingAccounts({ ...h.config, manifestPath: file,
      run: async accounts => { assert.notEqual(accounts.allowed.id, accounts.excluded.id); throw new Error('CALLBACK_FAILED'); } }), /CALLBACK_FAILED/);
    const saved = JSON.parse(await readFile(file, 'utf8')); assert.equal(saved.cleanupComplete, true);
    assert.equal(h.users.size, 0); assert.ok(!JSON.stringify(saved).includes('@'));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('debate-auth-inert-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function driverFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'debate-driver-inert-'));
  const put = async (file, value) => { const full = path.join(root, file); await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, typeof value === 'object' ? JSON.stringify(value) : value); };
  const baseSource = await readFile(new URL('../worker/wrangler.staging.toml', import.meta.url), 'utf8');
  const policy = JSON.parse(await readFile(new URL('../worker/debate-staging-policy.json', import.meta.url), 'utf8'));
  for (const file of CRITICAL_SOURCES) await put(file, `inert source ${file}`);
  await put(policy.baseConfig, baseSource); await put('worker/debate-staging-policy.json', policy);
  const base = parseBase(baseSource), versionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const observability = { enabled: true, head_sampling_rate: 1, redact_query_string: false,
    logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
    traces: { enabled: false, persist: true, head_sampling_rate: 1 } };
  const raw = { deployments: { deployments: [{ id: 'inert-deployment', versions: [{ version_id: versionId, percentage: 100 }] }] },
    settings: { bindings: [...Object.entries(base.vars).map(([name, text]) => ({ name, type: 'plain_text', text })),
      ...policy.requiredSecretNames.map(name => ({ name, type: 'secret_text' }))], compatibility_date: base.compatibilityDate,
      compatibility_flags: base.compatibilityFlags, placement: { mode: 'targeted', target: [10] },
      observability }, scriptSettings: { observability },
    version: { id: versionId, resources: { script_runtime: {} } },
    schedules: { schedules: base.crons.map(cron => ({ cron })) }, subdomain: { enabled: true, previews_enabled: true },
    service: { default_environment: { environment: 'production', script: {
      placement_mode: 'targeted', placement: { mode: 'targeted', target: [{ region: 'gcp:us-east4' }] }
    } } } };
  const baseline = sanitizeBaseline(raw, base), sourceHashes = {}, migrationHashes = {};
  for (const file of CRITICAL_SOURCES) sourceHashes[file] = hash(await readFile(path.join(root, file)));
  for (const file of policy.migrations) migrationHashes[file] = sourceHashes[file];
  const candidate = 'a'.repeat(40), baseSha = 'b'.repeat(40);
  const proof = { passed: true, evidenceReference: 'inert-proof', artifactSha256: 'c'.repeat(64) };
  const review = { candidateSha: candidate, baseSha, approvedPaths: ['assets/debate-room.js'], studyRoomPreserved: true,
    recoveryPreserved: true, retiredRuntimeAbsent: true, evidenceReferences: ['inert-source-review'], approvalReference: 'controlled-testing',
    databaseProof: { schemaVersion: 2, projectRef: FIXTURE_TARGET.projectRef, evidenceReference: 'inert-database-review', reviewedBy: 'inert',
      verifiedAt: new Date(NOW).toISOString(), migrationHashes,
      localInstallationRollback: { ...proof, engine: 'inert-only', adaptations: [], migrationHashes },
      hostedApplication: { ...proof, migrationHashes }, hostedDmlRollback: proof, hostedPrivilegesAndPreservation: proof,
      hostedInstallationRollback: { status: 'NOT_RUN', reason: 'inert-test-contract' }, fullAcceptance: false } };
  const suite = { head: candidate, status: 'PASS_LOCAL_SUITE', gitStatus: '', changedDuringRun: [], sourceHashes,
    groups: REQUIRED_SUITE_GROUPS.map(name => ({ name, status: 'PASS', exitCode: 0 })) };
  await put('artifacts/suite/report.json', suite);
  for (const file of CRITICAL_ASSETS) {
    let body;
    if (file === 'assets/phase2-config.js') body = `${FIXTURE_TARGET.supabaseUrl} ${FIXTURE_TARGET.workerUrl} sb_publishable_${'p'.repeat(30)}`;
    else if (file === 'assets/debate-domain.js') body = await readFile(path.join(root, 'worker/debate-domain.mjs'));
    else if (file === 'assets/debate-sanctions.js') body = await readFile(path.join(root, 'worker/debate-sanctions.mjs'));
    else body = await readFile(path.join(root, file));
    const full = path.join(root, '.staging-dist', file); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, body);
  }
  const wranglerFile = 'artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler/bin/wrangler.js';
  await put(wranglerFile, '// inert fixture, never executed');
  await put('artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler/package.json', {
    name: 'wrangler', version: '4.114.0', bin: { wrangler: 'bin/wrangler.js' } });
  const env = { DEBATE_CANDIDATE_SHA: candidate, DEBATE_EXPECTED_BASELINE_SHA256: baseline.fingerprint,
    DEBATE_EXPECTED_VERSION_ID: versionId, DEBATE_RELEASE_REVIEW: JSON.stringify(review), DEBATE_LOCAL_SUITE_REPORT: 'artifacts/suite/report.json',
    CLOUDFLARE_ACCOUNT_ID: 'd'.repeat(32), CLOUDFLARE_API_TOKEN: 'inert-cloudflare-token',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'s'.repeat(30)}`, STAGING_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(30)}` };
  const calls = [], fetcher = async (url, options) => { calls.push(url); const u = new URL(url);
    if (url === `${FIXTURE_TARGET.supabaseUrl}/auth/v1/settings`) {
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { apikey: env.STAGING_SUPABASE_PUBLISHABLE_KEY });
      return response({ external: { email: true } });
    }
    assert.equal(u.origin, 'https://api.cloudflare.com');
    const prefix = `/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/duediligence-examinations-staging`;
    if (u.pathname === `/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/services/duediligence-examinations-staging`) {
      const result = response({ success: true, result: raw.service }); result.ok = true; return result;
    }
    assert.ok(u.pathname.startsWith(prefix));
    const byPath = { '/deployments': raw.deployments, '/settings': raw.settings, '/script-settings': raw.scriptSettings,
      [`/versions/${versionId}`]: raw.version, '/schedules': raw.schedules, '/subdomain': raw.subdomain };
    const result = response({ success: true, result: byPath[u.pathname.slice(prefix.length)] }); result.ok = true; return result;
  };
  const git = async args => args[0] === 'rev-parse' ? candidate : args[0] === 'diff' ? 'assets/debate-room.js' : '';
  const dispose = async () => { assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('debate-driver-inert-')); await rm(root, { recursive: true, force: true }); };
  return { root, put, base, policy, baseline, candidate, env, review, suite, fetcher, git, calls, dispose, wranglerFile };
}
test('actual driver static preflight verifies complete source, proof, artifact and pinned tool before accounts', async () => {
  const f = await driverFixture();
  try {
    const checked = await verifyRestrictedStagingPreflight({ ...f, mode: 'deploy' });
    assert.equal(checked.evidence.status, 'PASS_STATIC_GATES_BEFORE_ACCOUNT_CREATION');
    assert.equal(checked.wrangler.version, '4.114.0'); assert.equal(f.calls.length, 9);
    assert.deepEqual(f.calls.filter(url => url.includes('/auth/')), [`${FIXTURE_TARGET.supabaseUrl}/auth/v1/settings`]);
    assert.equal(checked.evidence.publicKeyValidation.status, 'PASS_FIXED_STAGING_AUTH_SETTINGS');
    assert.equal(checked.evidence.publicKeyValidation.userRecordsRead, false);
  } finally { await f.dispose(); }
});
test('actual static preflight refuses absent hosted proof, source drift and persistent bearer input before any Auth call', async () => {
  const f = await driverFixture();
  try {
    const invalidProof = clone(f.review); invalidProof.databaseProof.hostedApplication.passed = false;
    for (const env of [{ ...f.env, DEBATE_RELEASE_REVIEW: JSON.stringify(invalidProof) },
      { ...f.env, DEBATE_STAGING_ALLOWED_BEARER: 'persistent-bearer' }]) {
      await assert.rejects(verifyRestrictedStagingPreflight({ ...f, env, mode: 'deploy' }));
    }
    await f.put('assets/debate-room.js', 'changed-after-tested');
    await assert.rejects(verifyRestrictedStagingPreflight({ ...f, mode: 'deploy' }), /SOURCE_DRIFT|Source changed/);
    assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});
test('actual static preflight refuses wrong Wrangler version and stale remote version', async () => {
  const f = await driverFixture();
  try {
    await f.put('artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler/package.json', {
      name: 'wrangler', version: '999.0.0', bin: { wrangler: 'bin/wrangler.js' } });
    await assert.rejects(verifyRestrictedStagingPreflight({ ...f, mode: 'deploy' }), /WRANGLER_VERSION_INVALID/);
    await assert.rejects(verifyRestrictedStagingPreflight({ ...f, mode: 'prepare-auth', env: {
      ...f.env, DEBATE_EXPECTED_VERSION_ID: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } }), /exact reviewed active Worker version/);
  } finally { await f.dispose(); }
});
test('wrong-project or rejected publishable key stops before fixture creation or Cloudflare reads', async () => {
  const f = await driverFixture(); let fixturesStarted = false;
  try {
    for (const status of [401, 403, 404]) {
      const settingsCalls = [];
      const fetcher = async (url, options) => {
        settingsCalls.push(url); assert.equal(url, `${FIXTURE_TARGET.supabaseUrl}/auth/v1/settings`);
        assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); return response({ message: 'not echoed' }, status);
      };
      await assert.rejects(runRestrictedStaging({ mode: 'prepare-auth', env: f.env, root: f.root, fetcher,
        preflight: input => verifyRestrictedStagingPreflight({ ...input, git: f.git }),
        withAccounts: async () => { fixturesStarted = true; throw new Error('MUST_NOT_RUN'); } }),
      { code: 'STAGING_PUBLISHABLE_KEY_REJECTED' });
      assert.equal(settingsCalls.length, 1);
    }
    assert.equal(fixturesStarted, false); assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});
test('unavailable email provider or malformed settings stop before fixture creation', async () => {
  const f = await driverFixture(); let fixturesStarted = false;
  try {
    for (const settings of [null, [], {}, { external: { email: false } }, { external: { email: 'true' } }]) {
      await assert.rejects(runRestrictedStaging({ mode: 'prepare-auth', env: f.env, root: f.root,
        fetcher: async url => { assert.equal(url, `${FIXTURE_TARGET.supabaseUrl}/auth/v1/settings`); return response(settings); },
        preflight: input => verifyRestrictedStagingPreflight({ ...input, git: f.git }),
        withAccounts: async () => { fixturesStarted = true; throw new Error('MUST_NOT_RUN'); } }),
      { code: 'STAGING_AUTH_EMAIL_PROVIDER_UNAVAILABLE' });
    }
    assert.equal(fixturesStarted, false); assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});
async function exerciseDriver({ mode, failAt = null, configDrift = false }) {
  const f = await driverFixture(), stages = [], tokens = { allowed: 'allowed-inert-token-'.repeat(8), excluded: 'excluded-inert-token-'.repeat(8) };
  const ids = { allowed: '11111111-1111-4111-8111-111111111111', excluded: '22222222-2222-4222-8222-222222222222' };
  let cleaned = false, fixtureStarted = false;
  const checked = await verifyRestrictedStagingPreflight({ ...f, mode });
  const options = { mode, env: { ...f.env, NODE_OPTIONS: '--must-never-inherit', UNRELATED_SECRET: 'must-never-inherit' }, root: f.root,
    preflight: async () => checked,
    fetcher: async (url, options) => {
      if (url.startsWith('https://api.cloudflare.com')) return f.fetcher(url, options);
      assert.equal(url, `${FIXTURE_TARGET.supabaseUrl}/auth/v1/user`);
      const purpose = Object.keys(tokens).find(p => options.headers.Authorization === `Bearer ${tokens[p]}`);
      assert.ok(purpose); const result = response({ id: ids[purpose] }); result.ok = true; return result;
    },
    withAccounts: async config => {
      fixtureStarted = true; assert.equal(config.serviceRoleKey, f.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
      const suppression = await config.verifySuppression(); assert.equal(suppression.outboundEmailMode, 'suppressed');
      try { await config.run(Object.fromEntries(Object.keys(ids).map(p => [p, { id: ids[p], token: tokens[p] }]))); }
      finally { cleaned = true; await writeFile(config.manifestPath, JSON.stringify({ cleanupComplete: true })); }
      return { cleanup: { complete: true } };
    },
    child: async call => {
      stages.push(call.label);
      if (['prepare', 'postflight'].includes(call.label)) assert.equal(call.env.DEBATE_PREVIEW_ACTOR_IDS, ids.allowed);
      if (['prepare', 'smoke'].includes(call.label)) {
        assert.equal(call.env.DEBATE_STAGING_ALLOWED_BEARER, tokens.allowed); assert.equal(call.env.DEBATE_STAGING_DENIED_BEARER, tokens.excluded);
      } else {
        assert.equal(call.env.DEBATE_STAGING_ALLOWED_BEARER, undefined); assert.equal(call.env.DEBATE_STAGING_DENIED_BEARER, undefined);
      }
      if (call.label === 'smoke') assert.equal(call.env.CLOUDFLARE_API_TOKEN, undefined);
      assert.equal(call.env.STAGING_SUPABASE_SERVICE_ROLE_KEY, undefined);
      assert.equal(call.env.NODE_OPTIONS, undefined); assert.equal(call.env.UNRELATED_SECRET, undefined);
      const output = path.join(f.root, 'artifacts/debate-local-rehearsal/staging-release');
      if (call.label === 'prepare') {
        assert.equal(call.args[1], 'prepare');
        const config = buildConfig(f.base, f.policy, ids.allowed, output, f.root);
        await writeFile(config.filename, configDrift ? config.text + '\nDEBATE_ROOM_ENABLED = "true"' : config.text);
        await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ candidateSha: f.candidate,
          configHash: config.hash, baselineFingerprint: f.baseline.fingerprint, previousVersionId: f.baseline.state.versionId, publicLaunch: false }));
      }
      if (call.label === 'deploy') {
        assert.deepEqual(call.args.slice(1, 4), ['deploy', '--keep-vars', '--config']);
        assert.equal(call.args[4], path.join(output, 'wrangler.debate-staging.toml'));
      }
      if (call.label === 'postflight') await writeFile(path.join(output, 'deployed-baseline.json'), JSON.stringify({
        state: { versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, fingerprint: 'f'.repeat(64) }));
      return { label: call.label, status: call.label === failAt ? 'FAIL' : 'PASS', exitCode: call.label === failAt ? 1 : 0,
        rawOutputStored: false, stdoutSha256: hash('inert'), stderrSha256: hash('inert') };
    } };
  let value, error;
  try { value = await runRestrictedStaging(options); } catch (caught) { error = caught; }
  const output = path.join(f.root, 'artifacts/debate-local-rehearsal/staging-release');
  const { readdir } = await import('node:fs/promises');
  const reportFile = (await readdir(output)).find(file => file.endsWith('-driver.json'));
  const raw = await readFile(path.join(output, reportFile), 'utf8');
  for (const token of Object.values(tokens)) assert.equal(raw.includes(token), false);
  assert.equal(raw.includes(f.env.CLOUDFLARE_API_TOKEN), false);
  return { f, stages, value, error, report: JSON.parse(raw), cleaned, fixtureStarted };
}
test('prepare-auth creates and cleans fixtures without deploying or checking undeployed Debate APIs', async () => {
  const run = await exerciseDriver({ mode: 'prepare-auth' });
  try { assert.equal(run.error, undefined); assert.deepEqual(run.stages, ['prepare']); assert.equal(run.cleaned, true);
    assert.equal(run.value.deploymentState, 'NOT_REQUESTED'); assert.equal(run.value.status, 'PASS_STAGING_AUTH_PREPARATION_ONLY');
  } finally { await run.f.dispose(); }
});
test('deploy driver uses only fresh allowed UUID and exact generated config, then records hosted version and cleanup', async () => {
  const run = await exerciseDriver({ mode: 'deploy' });
  try { assert.equal(run.error, undefined); assert.deepEqual(run.stages, ['prepare', 'deploy', 'postflight', 'smoke']);
    assert.equal(run.cleaned, true); assert.equal(run.value.status, 'PASS_STAGING_ASSETS_AND_AUTH_ONLY');
    assert.equal(run.value.publicLaunch, false); assert.equal(run.value.fullAcceptance, false);
  } finally { await run.f.dispose(); }
});
for (const failAt of ['prepare', 'deploy', 'postflight', 'smoke']) test(`driver ${failAt} failure preserves exact deployment uncertainty and runs finally cleanup`, async () => {
  const run = await exerciseDriver({ mode: 'deploy', failAt });
  try { assert.ok(run.error); assert.equal(run.cleaned, true); assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED');
    assert.equal(run.report.status, 'FAIL_RESTRICTED_STAGING'); assert.equal(run.stages.at(-1), failAt);
    if (failAt === 'prepare') assert.equal(run.report.deploymentState, 'NOT_REQUESTED');
    if (failAt === 'deploy') assert.equal(run.report.deploymentState, 'REQUESTED_OUTCOME_UNCONFIRMED');
    if (failAt === 'postflight') assert.equal(run.report.deploymentState, 'CLI_RETURNED_SUCCESS_PENDING_POSTFLIGHT');
    if (failAt === 'smoke') assert.equal(run.report.deploymentState, 'VERSION_AND_PRESERVATION_VERIFIED');
  } finally { await run.f.dispose(); }
});
test('modified prepared configuration stops before Wrangler and still cleans fixtures', async () => {
  const run = await exerciseDriver({ mode: 'deploy', configDrift: true });
  try { assert.equal(run.error?.code, 'PREPARED_CONFIG_DRIFT'); assert.equal(run.cleaned, true);
    assert.deepEqual(run.stages, ['prepare']); assert.equal(run.report.deploymentState, 'NOT_REQUESTED');
  } finally { await run.f.dispose(); }
});
test('child process failure is reduced to status/hashes and never emits credential-like output', async () => {
  const result = await executeRestrictedStagingChild({ label: 'prepare', cwd: tmpdir(), env: {}, args: ['-e',
    'process.stdout.write("inert-sensitive-output");process.stderr.write("inert-sensitive-error");process.exit(7);'] });
  assert.equal(result.exitCode, 7); assert.equal(result.status, 'FAIL'); assert.equal(result.rawOutputStored, false);
  assert.equal(JSON.stringify(result).includes('inert-sensitive'), false);
});
