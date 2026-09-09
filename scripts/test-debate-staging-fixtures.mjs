import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStudyDebateFixtureLifecycle, studyDebateFixtureIdentity, FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { withStudyDebateStagingAccounts } from './run-debate-staging-auth.mjs';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const clone = value => structuredClone(value);
function response(body, status = 200, range = null) { return { status,
  headers: { get: key => key === 'content-range' ? range : null }, json: async () => clone(body) }; }
function harness(overrides = {}) {
  const calls = [], checkpoints = [], users = new Map(), roles = new Map(), registered = new Set(), tokens = new Map();
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
        assert.equal(method, 'GET'); assert.ok(tokens.has(options.headers.Authorization.slice(7)));
        return response({ ok: true, allowed: true, role: 'student', administrator: false, canCreateRooms: false, recording: false });
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
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 6);
  assert.ok(h.calls.every(c => !/invite|signup|recover|storage|livekit|join/u.test(c.url.pathname)));
  const cleaned = await h.actual.cleanup(); assert.equal(cleaned.complete, true);
  assert.equal(h.users.size, 0); assert.equal(h.roles.size, 0);
  assert.equal(h.actual.snapshot().fixtures.every(r => r.oldSessionDenied), true);
  assert.equal((await h.actual.cleanup()).complete, true, 'Repeated cleanup performs no new deletions');
});
test('intent persistence failure prevents every remote mutation', async () => {
  const h = harness({ persistFailure: true }); await assert.rejects(h.actual.provision(), /SAVE_FAILED/); assert.equal(h.calls.length, 0);
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
