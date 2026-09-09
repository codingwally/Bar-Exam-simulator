import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedDebateFixtureLifecycle } from './debate-hosted-fixtures.mjs';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { HOSTED_BUCKET } from './debate-hosted-cleanup.mjs';
import { createStudyRoomHandlers } from '../worker/study-room-routes.mjs';

const NOW = Date.parse('2026-09-09T14:00:00Z'), clone = value => structuredClone(value);
const reply = (body, status = 200, range = null) => ({ status,
  headers: { get: key => key === 'content-range' ? range : null }, json: async () => clone(body) });
function harness(overrides = {}) {
  let seed = 1, now = NOW, creates = 0, tokenVersion = 0;
  const users = new Map(), roles = new Map(), tokens = new Map(), refreshes = new Map(), registered = new Set(), revoked = new Set(), calls = [], checkpoints = [];
  const studyHandlers = createStudyRoomHandlers({ authenticate: async request => ({ id: tokens.get(request.headers.get('Authorization')?.slice(7)) }),
    authorizeAdmin: async () => null, authorizeMember: async (_env, user) => ({ allowed: users.has(user.id) && !revoked.has(user.id), basis: 'signed_in' }),
    rateLimit: async () => {}, readCatalog: async () => ({ schemaVersion: 1, maxRooms: 24,
      rooms: ['1', '2', '3', '4', '5', '6'].map(roomKey => ({ roomKey, label: `Room ${roomKey}`, audience: roomKey === '5' ? 'admin' : 'all', revision: 1, accessRevision: 1 })) }),
    describeRoom: () => ({ maxRooms: 24, maxParticipants: 100, recording: false }),
    respond: (body, status) => reply(body, status) });
  const bucket = { id: HOSTED_BUCKET.id, name: HOSTED_BUCKET.id, public: false, file_size_limit: HOSTED_BUCKET.fileSizeLimit, allowed_mime_types: [...HOSTED_BUCKET.allowedMimeTypes] };
  const config = { sourceSha: 'a'.repeat(40), ...FIXTURE_TARGET, serviceRoleKey: `sb_secret_${'s'.repeat(30)}`, publishableKey: `sb_publishable_${'p'.repeat(30)}`,
    random: size => Buffer.alloc(size, seed++), clock: () => now, pause: async () => {},
    verifySuppression: async () => ({ projectRef: FIXTURE_TARGET.projectRef, outboundEmailMode: 'suppressed' }),
    persist: async manifest => { const serialized = JSON.stringify(manifest); assert.ok(!serialized.includes('@') && !serialized.includes('sb_secret_'));
      for (const secret of [...tokens.keys(), ...refreshes.keys()]) assert.ok(!serialized.includes(secret));
      if (overrides.persistFailure) throw new Error('SAVE_FAILED'); checkpoints.push(clone(manifest)); },
    request: async (url, options = {}) => {
      const u = new URL(url), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
      assert.ok([FIXTURE_TARGET.supabaseUrl, FIXTURE_TARGET.workerUrl].includes(u.origin)); assert.equal(options.redirect, 'error');
      const call = { url: u, method, body, headers: options.headers }; calls.push(call);
      const injected = overrides.intercept?.(call, { users, roles, registered, revoked, calls, creates }); if (injected) return injected;
      if (u.pathname === `/storage/v1/bucket/${HOSTED_BUCKET.id}`) return reply(bucket);
      if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
        creates++; const id = `11111111-1111-4111-8111-${String(creates).padStart(12, '0')}`;
        const user = { id, email: body.email, created_at: new Date(now).toISOString(), role: 'authenticated', aud: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'], ...body.app_metadata }, user_metadata: body.user_metadata };
        users.set(id, user); roles.set(id, { user_id: id, role: 'student', assigned_by: null, updated_at: new Date(now).toISOString() });
        return reply({ user }, 201);
      }
      if (u.pathname === '/rest/v1/rpc/astra_register_staging_study_room_fixture') {
        assert.equal(body.p_label, 'student'); assert.ok(users.has(body.p_user_id)); registered.add(body.p_user_id);
        return reply({ registered: true, fixtureUserId: body.p_user_id, dataScope: 'internal_test', registrationVersion: 'astra-staging-study-room-v1' });
      }
      if (u.pathname === '/auth/v1/token') {
        const grant = u.searchParams.get('grant_type');
        const user = grant === 'password' ? [...users.values()].find(user => user.email === body.email) : users.get(refreshes.get(body.refresh_token));
        assert.ok(user && registered.has(user.id) && !revoked.has(user.id)); tokenVersion++;
        const access = `inert-access-${tokenVersion}-${user.id}-`.repeat(4), refresh = `inert-refresh-${tokenVersion}-${user.id}`;
        tokens.set(access, user.id); refreshes.set(refresh, user.id); user.last_sign_in_at ||= new Date(now).toISOString();
        return reply({ access_token: access, refresh_token: refresh, expires_at: Math.floor(now / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user });
      }
      const tokenId = tokens.get(options.headers.Authorization?.slice(7));
      if (u.pathname === '/auth/v1/user') return reply(users.has(tokenId) && !revoked.has(tokenId) ? { id: tokenId } : { code: 'session_not_found' }, users.has(tokenId) && !revoked.has(tokenId) ? 200 : 403);
      if (u.pathname === '/study-room/access') { if (method !== 'POST') return reply({ error: 'Method Not Allowed' }, 405);
        assert.deepEqual(body, {}); assert.ok(tokenId && !revoked.has(tokenId));
        return studyHandlers.access(new Request(url, { method, headers: options.headers, body: options.body }), {}, u.origin, u.origin); }
      if (u.pathname === '/auth/v1/logout') { assert.equal(u.searchParams.get('scope'), 'global'); revoked.add(tokenId); return reply(null, 204); }
      if (u.pathname === '/debate-room/events') return reply({ ok: false, error: { code: 'INVALID_SESSION' } }, revoked.has(tokenId) ? 401 : 200);
      if (u.pathname.startsWith('/auth/v1/admin/users/')) {
        const id = u.pathname.split('/').at(-1);
        if (method === 'GET') return reply(users.get(id) || null, users.has(id) ? 200 : 404);
        assert.equal(method, 'DELETE'); assert.ok(!roles.has(id)); users.delete(id); return reply(null, 204);
      }
      if (u.pathname.startsWith('/rest/v1/')) {
        const table = u.pathname.split('/').at(-1), id = u.searchParams.get('user_id')?.slice(3);
        if (method === 'DELETE') { assert.equal(table, 'user_roles'); const role = roles.get(id);
          assert.ok(role && Object.entries(role).every(([key, value]) => u.searchParams.get(key) === (value === null ? 'is.null' : `eq.${value}`)));
          roles.delete(id); return reply([role]); }
        assert.equal(method, 'GET'); let found = table === 'user_roles' && roles.has(id) ? [roles.get(id)] : [];
        found = overrides.rows?.(table, u.searchParams, found) || found;
        return reply(found, 200, found.length ? `0-${found.length - 1}/${found.length}` : '*/0');
      }
      throw new Error('UNEXPECTED_INERT_ROUTE');
    } };
  return { lifecycle: createHostedDebateFixtureLifecycle(config), users, roles, registered, revoked, calls, checkpoints, config,
    advance: milliseconds => { now += milliseconds; } };
}

test('eleven registered students are classified before signin, ten preview identities, no platform promotions', async () => {
  const h = harness(); const provisioned = await h.lifecycle.provision();
  assert.equal(Object.keys(provisioned.accounts).length, 11); assert.equal(provisioned.previewIds.length, 10);
  assert.ok(!provisioned.previewIds.includes(provisioned.excludedId)); assert.equal(h.registered.size, 11);
  assert.equal(h.calls.filter(c => c.url.pathname === '/study-room/access').length, 11);
  assert.ok([...h.roles.values()].every(role => role.role === 'student'));
  const cleanup = await h.lifecycle.cleanup(); assert.equal(cleanup.complete, true); assert.equal(h.users.size, 0); assert.equal(h.revoked.size, 11);
  assert.ok(h.lifecycle.snapshot().fixtures.every(f => f.oldSessionDenied && f.workerDeniedBeforeCleanup));
});
test('actual session material stays in memory, refreshes after an hour, and is revoked before Auth deletion', async () => {
  const h = harness(); await h.lifecycle.provision(); const before = await h.lifecycle.sessionFor('host');
  h.advance(3600001); const after = await h.lifecycle.sessionFor('host'); assert.notEqual(after.access_token, before.access_token);
  assert.equal(h.lifecycle.snapshot().fixtures.find(f => f.purpose === 'host').refreshCount, 1);
  await h.lifecycle.acceptBrowserSession('host', after); assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.calls.filter(c => c.url.searchParams.get('grant_type') === 'refresh_token').length, 11);
  assert.ok(!JSON.stringify(h.checkpoints).includes(after.refresh_token));
});
test('browser cannot replace a fixture session with another account or an unverified token', async () => {
  const h = harness(); await h.lifecycle.provision(); const observer = await h.lifecycle.sessionFor('observer'), host = await h.lifecycle.sessionFor('host');
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', observer), /HOSTED_SESSION_INVALID/);
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', { ...host, access_token: 'unknown'.repeat(20) }), /HOSTED_SESSION_ORDER_UNCONFIRMED/);
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', { ...host, expires_at: host.expires_at + 60, access_token: 'unknown'.repeat(20) }), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
});
test('lost refresh response is never retried during cleanup; valid prior access safely revokes the session', async () => {
  const h = harness({ intercept: call => call.url.searchParams.get('grant_type') === 'refresh_token' ? reply(null, 503) : null });
  await h.lifecycle.provision(); h.advance(3500000);
  await assert.rejects(h.lifecycle.sessionFor('host'));
  await assert.rejects(h.lifecycle.sessionFor('host'), /HOSTED_REFRESH_OUTCOME_UNKNOWN/);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token').length, 1);
  assert.equal(h.users.size, 0);
});

test('concurrent session requests share one refresh and stale browser storage cannot replace the newer session', async () => {
  const h = harness(); await h.lifecycle.provision(); const old = await h.lifecycle.sessionFor('host');
  h.advance(3600001);
  const [first, second] = await Promise.all([h.lifecycle.sessionFor('host'), h.lifecycle.sessionFor('host')]);
  assert.equal(first.access_token, second.access_token);
  assert.equal(h.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token').length, 1);
  assert.equal(await h.lifecycle.acceptBrowserSession('host', old), false);
  assert.equal((await h.lifecycle.sessionFor('host')).access_token, first.access_token);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
});

test('closing browser storage cannot resolve an unknown SDK refresh or allow its refresh token to be retried', async () => {
  const h = harness(); await h.lifecycle.provision(); const old = await h.lifecycle.sessionFor('host');
  await h.lifecycle.recordBrowserRefreshIntent('host');
  assert.equal(await h.lifecycle.acceptBrowserSession('host', old), false);
  assert.equal(h.lifecycle.snapshot().fixtures[0].refreshState, 'requested');
  h.advance(3500000); await assert.rejects(h.lifecycle.sessionFor('host'), /HOSTED_REFRESH_OUTCOME_UNKNOWN/);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token').length, 0);
});
test('registration failure cleans the known account without pretending a session existed', async () => {
  const h = harness({ intercept: call => call.url.pathname.endsWith('/astra_register_staging_study_room_fixture') ? reply(null, 503) : null });
  await assert.rejects(h.lifecycle.provision()); assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.users.size, 0); assert.equal(h.calls.filter(c => c.url.pathname === '/auth/v1/logout').length, 0);
});
test('failure creating the next actor cleans every earlier known account while preserving unknown creation', async () => {
  const h = harness({ intercept: (call, state) => call.url.pathname === '/auth/v1/admin/users' && call.method === 'POST' && state.creates === 1 ? reply(null, 503) : null });
  await assert.rejects(h.lifecycle.provision()); assert.equal((await h.lifecycle.cleanup()).complete, false);
  assert.equal(h.users.size, 0); assert.equal(h.lifecycle.snapshot().fixtures[1].cleanupState, 'held');
});
test('fixture-only preparation records a missing immediate fence but safely deletes accounts with no Debate data', async () => {
  const h = harness({ intercept: call => call.url.pathname === '/debate-room/events' ? reply({ ok: true }, 200) : null });
  await h.lifecycle.provision(); const result = await h.lifecycle.cleanup(); assert.equal(result.complete, true);
  assert.equal(result.fixtureFencingVerified, false); assert.equal(h.lifecycle.snapshot().immediateLogoutFencingVerified, false);
  assert.equal(h.users.size, 0); assert.ok(h.lifecycle.snapshot().fixtures.every(record => record.oldSessionDenied && record.immediateFenceWorkerStatus === 200));
});
test('missing immediate fence holds an event-intent run before event or Auth deletion', async () => {
  const h = harness({ intercept: call => call.url.pathname === '/debate-room/events' ? reply({ ok: true }, 200) : null });
  const { runTag } = await h.lifecycle.provision(); await h.lifecycle.recordEventIntent({ title: `Hosted Debate ${runTag} main`, idempotencyKey: 'abcd1234' });
  assert.equal((await h.lifecycle.cleanup()).complete, false); assert.equal(h.users.size, 11);
  assert.ok(!h.calls.some(call => call.method === 'DELETE'));
});
test('billing rows or trusted identity drift hold only the affected Auth identity', async () => {
  for (const kind of ['billing', 'identity']) {
    const h = harness({ rows: (table, params, existing) => kind === 'billing' && table === 'payment_requests' && params.get('user_id')?.endsWith('000000000001') ? [{ id: 'unexpected' }] : existing });
    await h.lifecycle.provision(); if (kind === 'identity') [...h.users.values()][0].app_metadata.astra_staging_study_room_fixture.runId = 'foreign';
    assert.equal((await h.lifecycle.cleanup()).complete, false); assert.equal(h.users.size, 1);
  }
});
test('event intents are bounded and declared before any event can be recorded or read', async () => {
  const h = harness(); const { runTag } = await h.lifecycle.provision();
  await assert.rejects(h.lifecycle.recordEventIntent({ title: 'unowned title', idempotencyKey: 'abcd1234' }), /HOSTED_EVENT_INTENT_INVALID/);
  await h.lifecycle.recordEventIntent({ title: `Hosted Debate ${runTag} main`, idempotencyKey: 'abcd1234' });
  await assert.rejects(h.lifecycle.recordEventIntent({ title: `Hosted Debate ${runTag} main`, idempotencyKey: 'different123' }), /HOSTED_EVENT_INTENT_CONFLICT/);
  await assert.rejects(h.lifecycle.readEvent('missing-id'), /HOSTED_EVENT_UNDECLARED/);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
});
