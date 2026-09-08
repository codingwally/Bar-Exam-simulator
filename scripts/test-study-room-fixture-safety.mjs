import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Load only the actual named fixture/HTTP functions. Do not import the smoke:
// that imports native RTC and its CLI can provision real staging accounts.
const source = await readFile(new URL('../worker/study-room-staging-positive-smoke.mjs', import.meta.url), 'utf8');
const names = ['fixtureIdentity', 'responseBody', 'safeRemoteCode', 'requestJson',
  'isRetryableSupabaseAdminFailure', 'requestSupabaseAdminJson', 'serviceHeaders',
  'createSyntheticUser', 'assignSyntheticRole', 'fixtureRows', 'deleteSyntheticUsers'];
function extract(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'mu'));
  assert.notEqual(start, -1, `Missing actual source function: ${name}`);
  const end = source.slice(start).search(/^\}/mu);
  assert.ok(end > 0);
  return source.slice(start, start + end + 1);
}
const definitions = names.map(extract).join('\n');
test('an early RTC timeout stays rejected without interrupting delayed HTTP cleanup', async () => {
  const makeWait = new Function('setTimeout', 'clearTimeout', `
    const RTC_TIMEOUT_MS = 30000;
    ${extract('waitForRoomEvent')}
    return waitForRoomEvent;
  `);
  let timeout;
  const wait = makeWait((callback) => { timeout = callback; return 1; }, () => {});
  const removed = [];
  const room = { on() {}, off(...args) { removed.push(args); } };
  const pending = wait(room, 'participantDisconnected', 'participant removal');
  timeout();
  let cleaned = false;
  await assert.rejects(async () => {
    try {
      await new Promise(setImmediate);
      throw new Error('HTTP request failed before awaiting RTC');
    } finally { cleaned = true; }
  }, /HTTP request failed/);
  assert.equal(cleaned, true);
  assert.equal(removed.length, 1);
  await assert.rejects(pending, /participant removal timed out/);
});

const makeActualFunctions = new Function('assert', 'randomBytes', 'fetch', 'persist', 'setTimeout', `
  const REQUEST_TIMEOUT_MS = 45000;
  const SUPABASE_ADMIN_MAX_ATTEMPTS = 4;
  const SUPABASE_ADMIN_RETRY_BASE_MS = 350;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  let fixtureManifest = {fixtures: []};
  const fixtureSessions = new Map();
  async function persistFixtureManifest() { await persist(structuredClone(fixtureManifest)); }
  ${definitions}
  return { ${names.join(',')}, fixtureSessions,
    setManifest(value) { fixtureManifest = value; } };
`);
const configuration = Object.freeze({
  supabaseUrl: 'https://fixture.invalid', publishableKey: 'inert-publishable', serviceRoleKey: 'inert-service',
});
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const audit = '33333333-3333-4333-8333-333333333333';
const runId = 'mtfixture-0123abcd';
const token = 'inert-only-token-'.repeat(8);
const clone = (value) => structuredClone(value);
function response(body, status = 200, range = null) {
  return { status, headers: { get(name) { return name === 'content-type' ? 'application/json' : name === 'content-range' ? range : null; } },
    async json() { return clone(body); } };
}
function harness(options = {}) {
  const calls = [];
  const checkpoints = [];
  let user = null;
  let role = null;
  const actual = makeActualFunctions(assert, randomBytes, async (url, request = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, configuration.supabaseUrl, 'No request may leave the inert fixture origin.');
    const method = request.method || 'GET';
    const body = request.body ? JSON.parse(request.body) : null;
    const call = { path: u.pathname, query: u.searchParams, method, body, headers: request.headers };
    calls.push(call);
    if (options.intercept) {
      const intercepted = options.intercept(call, { user, role, calls, checkpoints });
      if (intercepted) return intercepted;
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      assert.equal(checkpoints.at(-1).fixtures[0].creationState, 'requested');
      user = { id: owner, email: body.email, app_metadata: body.app_metadata, user_metadata: body.user_metadata };
      role = { user_id: owner, role: 'student', assigned_by: null,
        created_at: '2026-09-08T00:00:00+00:00', updated_at: '2026-09-08T00:00:00+00:00' };
      return response({ user });
    }
    if (u.pathname.endsWith('/rpc/astra_register_staging_study_room_fixture')) {
      assert.equal(checkpoints.at(-1).fixtures[0].registrationState, 'requested');
      assert.equal(body.p_user_id, owner);
      return response({ registered: true, fixtureUserId: owner, dataScope: 'internal_test', registrationVersion: 'astra-staging-study-room-v1' });
    }
    if (u.pathname === '/auth/v1/token') {
      assert.equal(checkpoints.at(-1).fixtures[0].registrationState, 'confirmed');
      assert.equal(checkpoints.at(-1).fixtures[0].signInState, 'requested');
      return response({ access_token: token, user: { id: owner } });
    }
    if (u.pathname === '/auth/v1/logout') {
      assert.equal(u.searchParams.get('scope'), 'global');
      return response(null, 204);
    }
    if (u.pathname === `/auth/v1/admin/users/${owner}`) {
      if (method === 'GET') return response(user, user ? 200 : 404);
      assert.equal(method, 'DELETE');
      assert.equal(checkpoints.at(-1).fixtures[0].signOutState, 'confirmed');
      assert.deepEqual(checkpoints.at(-1).fixtures[0].retainedAuditIds, [audit]);
      assert.equal(role, null, 'Role must be removed before the exact Auth cascade.');
      assert.equal(request.headers['Content-Type'], undefined, 'Bodyless DELETE must not declare JSON.');
      user = null;
      return response(null, 204);
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      if (table === 'user_roles' && method === 'DELETE') {
        assert.equal(checkpoints.at(-1).fixtures[0].cleanupState, 'role_delete_requested');
        const keys = [...u.searchParams.keys()].sort();
        assert.deepEqual(keys, Object.keys(role).sort(), 'Every captured role scalar must participate in CAS.');
        if (options.driftBeforeRoleDelete) role.updated_at = '2026-09-08T00:01:00+00:00';
        const matches = Object.entries(role).every(([key, value]) => u.searchParams.get(key) === (value === null ? 'is.null' : `eq.${String(value)}`));
        const rows = matches ? [clone(role)] : [];
        if (matches) role = null;
        return response(rows);
      }
      if (method !== 'GET') throw new Error(`Unexpected inert method ${method}`);
      assert.equal(u.searchParams.get('limit'), '101');
      assert.equal(request.headers.Prefer, 'count=exact');
      let rows = [];
      if (table === 'user_roles' && u.searchParams.has('user_id')) rows = role ? [role] : [];
      if (table === 'examination_audit_log') rows = [{ id: audit, actor_user_id: owner }];
      if (options.rows) rows = options.rows(table, u.searchParams, clone(rows));
      const range = options.range ? options.range(table, rows) : (rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0');
      return response(rows, 200, range);
    }
    throw new Error('Unexpected inert request path');
  }, async (manifest) => {
    checkpoints.push(manifest);
    if (options.persistFailure) throw new Error('Inert persistence failure');
    assert.equal(JSON.stringify(manifest).includes(token), false, 'Tokens must stay out of persisted manifests.');
    assert.equal(JSON.stringify(manifest).includes('password'), false, 'Passwords must stay out of persisted manifests.');
  }, (callback) => { callback(); return 0; });
  const manifest = { fixtures: [] };
  actual.setManifest(manifest);
  return { actual, calls, checkpoints, manifest,
    provision() { return actual.createSyntheticUser(configuration, 'student', runId, manifest.fixtures); },
    cleanup() { return actual.deleteSyntheticUsers(configuration, manifest.fixtures); },
  };
}
const deletes = (h) => h.calls.filter((c) => c.method === 'DELETE');

test('actual fixture identity is exact and rejects unknown labels/run prefixes', () => {
  const h = harness();
  assert.equal(h.actual.fixtureIdentity('student', runId).email, `dd-study-room-student-${runId}@example.com`);
  assert.throws(() => h.actual.fixtureIdentity('customer', runId));
  assert.throws(() => h.actual.fixtureIdentity('student', 'wild-prefix'));
});
test('actual creation records intent then trusted registration before normal sign-in', async () => {
  const h = harness();
  const result = await h.provision();
  assert.equal(result.id, owner);
  assert.deepEqual(h.calls.map((c) => c.path), ['/auth/v1/admin/users', '/rest/v1/rpc/astra_register_staging_study_room_fixture', '/auth/v1/token']);
  assert.deepEqual(h.calls[0].body.app_metadata.astra_staging_study_room_fixture, { version: 1, runId, label: 'student' });
  assert.equal(h.manifest.fixtures[0].signInState, 'confirmed');
});
test('persistence failure occurs before any Auth mutation', async () => {
  const h = harness({ persistFailure: true });
  await assert.rejects(h.provision());
  assert.equal(h.calls.length, 0);
});
for (const [label, path] of [['create', '/auth/v1/admin/users'], ['registration', '/rest/v1/rpc/astra_register_staging_study_room_fixture'], ['sign-in', '/auth/v1/token']]) {
  test(`unknown ${label} response is single-shot and held without deletion`, async () => {
    const h = harness({ intercept: (c) => c.path === path && c.method === 'POST' ? response({ code: 'INERT_UNKNOWN' }, 503) : null });
    await assert.rejects(h.provision());
    assert.equal(h.calls.filter((c) => c.path === path && c.method === 'POST').length, 1);
    const errors = await h.cleanup();
    assert.equal(errors.length, 1);
    assert.equal(h.manifest.fixtures[0].cleanupState, 'held');
    assert.equal(deletes(h).length, 0);
  });
}
for (const invalid of [null, { registered: true, fixtureUserId: other, dataScope: 'internal_test', registrationVersion: 'astra-staging-study-room-v1' },
  { registered: true, fixtureUserId: owner, dataScope: 'regular', registrationVersion: 'astra-staging-study-room-v1' }]) {
  test(`wrong registration acknowledgment refuses sign-in (${JSON.stringify(invalid)})`, async () => {
    const h = harness({ intercept: (c) => c.path.includes('/rpc/') ? response(invalid) : null });
    await assert.rejects(h.provision());
    assert.equal(h.calls.some((c) => c.path === '/auth/v1/token'), false);
  });
}
test('session belonging to another owner is not retained', async () => {
  const h = harness({ intercept: (c) => c.path === '/auth/v1/token' ? response({ access_token: token, user: { id: other } }) : null });
  await assert.rejects(h.provision());
  assert.equal(h.actual.fixtureSessions.size, 0);
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).length, 0);
});
test('normal cleanup confirms global logout, exact role CAS and Auth absence while retaining audit IDs', async () => {
  const h = harness();
  await h.provision();
  assert.deepEqual(await h.cleanup(), []);
  assert.equal(h.manifest.fixtures[0].cleanupState, 'auth_deleted_verified');
  assert.deepEqual(h.manifest.fixtures[0].retainedAuditIds, [audit]);
  assert.equal(h.actual.fixtureSessions.size, 0);
  const logout = h.calls.findIndex((c) => c.path === '/auth/v1/logout');
  assert.ok(h.calls.findIndex((c) => c.method === 'DELETE') > logout);
  assert.deepEqual(deletes(h).map((c) => c.path), ['/rest/v1/user_roles', `/auth/v1/admin/users/${owner}`]);
});
test('unknown global logout holds before any deletion', async () => {
  const h = harness({ intercept: (c) => c.path === '/auth/v1/logout' ? response({ code: 'INERT_UNKNOWN' }, 503) : null });
  await h.provision();
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).length, 0);
  assert.equal(h.manifest.fixtures[0].signOutState, 'requested');
});
test('unknown Auth delete is never retried; prior exact intent and audit IDs remain', async () => {
  const h = harness({ intercept: (c) => c.method === 'DELETE' && c.path.startsWith('/auth/') ? response({ code: 'INERT_UNKNOWN' }, 503) : null });
  await h.provision();
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).filter((c) => c.path.startsWith('/auth/')).length, 1);
  assert.ok(h.checkpoints.some((m) => m.fixtures[0]?.cleanupState === 'auth_delete_requested'));
  assert.deepEqual(h.manifest.fixtures[0].retainedAuditIds, [audit]);
  assert.equal(h.manifest.fixtures[0].cleanupState, 'held');
});
test('role timestamp drift cannot pass full-row delete CAS or reach Auth delete', async () => {
  const h = harness({ driftBeforeRoleDelete: true });
  await h.provision();
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).filter((c) => c.path.startsWith('/auth/')).length, 0);
});
for (const table of ['payment_requests', 'subscriptions', 'free_beta_access', 'admin_capabilities', 'examination_beta_access', 'examination_participants', 'examination_attempts_multi', 'grade_reservations', 'subscription_history', 'refund_requests']) {
  test(`unexpected ${table} holds before deletion`, async () => {
    const h = harness({ rows: (name, _query, rows) => name === table ? [{ user_id: owner }] : rows });
    await h.provision();
    assert.equal((await h.cleanup()).length, 1);
    assert.equal(deletes(h).length, 0);
  });
}
for (const table of ['payment_request_history', 'refund_request_history', 'subscription_history']) {
  test(`cross-owner financial actor in ${table} holds before deletion`, async () => {
    const h = harness({ rows: (name, query, rows) => name === table && query.has('actor_user_id')
      ? [{ id: audit, user_id: other, actor_user_id: owner }] : rows });
    await h.provision();
    assert.equal((await h.cleanup()).length, 1);
    assert.equal(deletes(h).length, 0);
  });
}
test('remaining assigned-by descendant holds the ancestor before role deletion', async () => {
  const h = harness({ rows: (table, query, rows) => table === 'user_roles' && query.has('assigned_by') ? [{ user_id: other, assigned_by: owner }] : rows });
  await h.provision();
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).length, 0);
});
for (const range of [null, '', '*/1', '0-0/*', 'nonsense', '0-0/9007199254740991']) {
  test(`actual count parser rejects incomplete or malformed range ${String(range)}`, async () => {
    const h = harness({ range: () => range });
    await assert.rejects(h.actual.fixtureRows(configuration, 'payment_requests', owner));
  });
}
test('actual count parser accepts exact zero and refuses bounded overflow', async () => {
  const h = harness();
  assert.deepEqual(await h.actual.fixtureRows(configuration, 'payment_requests', owner), []);
  const overflow = harness({ rows: () => Array.from({ length: 101 }, () => ({ user_id: owner })) });
  await assert.rejects(overflow.actual.fixtureRows(configuration, 'payment_requests', owner));
});
test('unknown role payload shape is held before any delete', async () => {
  const h = harness({ rows: (table, query, rows) => table === 'user_roles' && query.has('user_id') ? rows.map((r) => ({ ...r, unexpected: { nested: true } })) : rows });
  await h.provision();
  assert.equal((await h.cleanup()).length, 1);
  assert.equal(deletes(h).length, 0);
});
test('source retains exact-run manifests and excludes stale sweeps / token persistence', () => {
  assert.doesNotMatch(source, /listStaleSyntheticAdministrators\(/u);
  assert.match(source, /cleanupScope: "exact-current-run-only"/u);
  assert.match(source, /independentDatabaseReadbackRequired: true/u);
  assert.match(extract('createSyntheticUser'), /createdUsers\.push\(cleanupRecord\);\s+await persistFixtureManifest\(\)/u);
  assert.doesNotMatch(extract('createSyntheticUser'), /cleanupRecord\.token/u);
  assert.match(source, /flag: "wx", mode: 0o600/u);
  assert.doesNotMatch(extract('deleteSyntheticUsers'), /method: "DELETE"[\s\S]*examination_audit_log/u);
});

// Exercise the actual first-join orchestration without importing native RTC,
// loading credentials, provisioning accounts, or making a network request.
const smokeSlots = [
  { roomKey: '1', label: 'Library', kind: 'library', microphoneAllowed: false, adminOnly: false },
  { roomKey: '2', label: 'Room 1', kind: 'general', microphoneAllowed: true, adminOnly: false },
  { roomKey: '3', label: 'Room 2', kind: 'general', microphoneAllowed: true, adminOnly: false },
  { roomKey: '4', label: 'Room 3', kind: 'general', microphoneAllowed: true, adminOnly: false },
  { roomKey: '5', label: 'Inner Chamber', kind: 'inner-chamber', microphoneAllowed: true, adminOnly: true },
];
const publicProofFactory = new Function('assert', 'workerPost', 'validateJoinResponse', `
  const STUDY_ROOM_SLOTS = ${JSON.stringify(smokeSlots)};
  const STUDY_ROOM_MAX_ROOMS = 5, STUDY_ROOM_MAX_PARTICIPANTS = 12;
  const APPROVED_STAGING_ROOMS = ['inert-private-room-name'];
  ${['assertPlainObject', 'approvedRoomKey', 'validatePublicRoomDescriptor', 'validateRoomCatalog', 'provePublicFirstJoins'].map(extract).join('\n')}
  return { provePublicFirstJoins, validateRoomCatalog };
`);
function firstJoinHarness({ initiallyActive = [], listCreates = false, alteredDescriptor = null } = {}) {
  const calls = [];
  const active = new Set(initiallyActive);
  const catalog = () => ({ ok: true, allowed: true, role: 'member', administrator: false,
    canCreateRooms: false, maxRooms: 5, maxParticipants: 12, recording: false,
    rooms: smokeSlots.map((slot) => ({ ...slot, alwaysOpen: !slot.adminOnly, canCreate: false,
      canJoin: !slot.adminOnly, capacity: 12, active: active.has(slot.roomKey), participantCount: 0,
      focusStartedAt: active.has(slot.roomKey) ? '2026-09-08T00:00:00Z' : null,
      ...(alteredDescriptor && slot.roomKey === '1' ? alteredDescriptor : {}) })) });
  const actual = publicProofFactory(assert, async (_configuration, path, accessToken, body) => {
    assert.equal(accessToken, 'inert-student'); calls.push({ path, body: clone(body) });
    if (path === '/study-room/rooms') {
      assert.equal(body.operation, 'list', 'The first-join proof must never request administrator creation.');
      if (listCreates && calls.length === 2) active.add('2');
      return { body: catalog() };
    }
    assert.equal(path, '/study-room/join');
    assert.ok(['1', '2', '3', '4'].includes(body.roomKey), 'The private room is not auto-created.');
    active.add(body.roomKey);
    return { body: { room_key: body.roomKey, administrator: false } };
  }, (body, nickname, issuer, roomKey) => {
    assert.equal(nickname, 'Participant #404'); assert.equal(issuer, 'inert-issuer');
    assert.equal(body.room_key, roomKey); return body;
  });
  return { calls, actual, catalog,
    run: () => actual.provePublicFirstJoins({ liveKitApiKey: 'inert-issuer' }, { token: 'inert-student' }) };
}
test('actual smoke joins all four initially inactive public rooms as a free student without admin create', async () => {
  const h = firstJoinHarness();
  assert.equal((await h.run()).length, 4);
  assert.deepEqual(h.calls.filter((call) => call.path.endsWith('/join')).map((call) => call.body.roomKey), ['1', '2', '3', '4']);
  assert.equal(h.calls.length, 10);
  assert.equal(h.calls.filter((call) => call.path.endsWith('/rooms')).length, 6);
  assert.equal(h.calls.some((call) => call.path.startsWith('/admin/') || call.body.operation === 'create'), false);
});
test('first-join proof holds pre-existing public sessions and rejects list-triggered activation', async () => {
  const occupied = firstJoinHarness({ initiallyActive: ['2'] });
  await assert.rejects(occupied.run(), /initially inactive/);
  assert.equal(occupied.calls.length, 1);
  const changing = firstJoinHarness({ listCreates: true });
  await assert.rejects(changing.run());
  assert.equal(changing.calls.length, 2);
  assert.equal(changing.calls.some((call) => call.path.endsWith('/join')), false);
});
test('always-open catalog keeps private Inner Chamber protected and active physically truthful', async () => {
  const h = firstJoinHarness({ initiallyActive: ['5'] });
  assert.equal((await h.run()).length, 4);
  assert.equal(h.catalog().rooms[4].alwaysOpen, false);
  assert.equal(h.catalog().rooms[4].canJoin, false);
  for (const alteredDescriptor of [{ alwaysOpen: false }, { canCreate: true }, { capacity: 13 }]) {
    const invalid = firstJoinHarness({ alteredDescriptor });
    await assert.rejects(invalid.run());
    assert.equal(invalid.calls.length, 1);
  }
});
test('stage orchestration proves free first-join before admin creation and ordinary-admin mute/removal', () => {
  const main = extract('runPositiveSmoke');
  assert.ok(main.indexOf('provePublicFirstJoins(configuration, student)') < main.indexOf('"five_room_catalog_and_creation"'));
  assert.match(main, /const moderation = await workerPost\(\s*configuration,\s*"\/study-room\/moderate",\s*secondaryAdmin\.token/u);
  assert.match(main, /const removal = await workerPost\(configuration, "\/study-room\/moderate", secondaryAdmin\.token/u);
  assert.match(main, /await removedParticipant;/u);
  assert.match(main, /memberInnerDenied\.body\?\.error\?\.code, "STUDY_ROOM_ADMIN_ROOM_REQUIRED"/u);
});
