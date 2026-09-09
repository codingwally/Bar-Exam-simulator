import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedDebateFixtureLifecycle } from './debate-hosted-fixtures.mjs';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { HOSTED_BUCKET, hostedHash } from './debate-hosted-cleanup.mjs';
import { createStudyRoomHandlers } from '../worker/study-room-routes.mjs';
import { createDebateService } from '../worker/debate-service.mjs';
import { createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';

const NOW = Date.parse('2026-09-09T14:00:00Z'), clone = value => structuredClone(value);
// Inert JWT-shaped fixtures only. The injected Auth route is the explicit
// identity oracle; these strings are not signed tokens or hosted evidence.
const inertAccess = (id, exp, nonce = 'inert', claims = {}) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: `${FIXTURE_TARGET.supabaseUrl}/auth/v1`, sub: id, exp, nonce, ...claims })).toString('base64url'),
  Buffer.from('not-a-real-signature-' + nonce).toString('base64url'),
].join('.');
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
      if (u.pathname === '/rest/v1/rpc/astra_staging_debate_cleanup_v1') {
        const counts = Object.fromEntries(['events','uploads','outbox','receipts','audit','match_versions','ballots','votes','rate_limits'].map(table => [table, 0]));
        const snapshot = { version: 1, manifestSha256: hostedHash(body.p_manifest), snapshotSha256: hostedHash(counts), counts, storageKeys: [] };
        assert.equal(body.p_manifest.fixtures.length, 11); assert.ok(body.p_manifest.fixtures.every(f => revoked.has(f.id)));
        if (!body.p_expected) return reply({ status: 'CAPTURED', snapshot });
        assert.deepEqual(body.p_expected, snapshot); return reply({ status: 'DELETED_ATOMICALLY', snapshot, deletedCounts: counts });
      }
      if (u.pathname === '/auth/v1/token') {
        const grant = u.searchParams.get('grant_type');
        const user = grant === 'password' ? [...users.values()].find(user => user.email === body.email) : users.get(refreshes.get(body.refresh_token));
        assert.ok(user && registered.has(user.id) && !revoked.has(user.id)); tokenVersion++;
        const access = inertAccess(user.id, Math.floor(now / 1000) + 3600, String(tokenVersion)), refresh = String(tokenVersion).padStart(12, 'r');
        tokens.set(access, user.id); refreshes.set(refresh, user.id); user.last_sign_in_at ||= new Date(now).toISOString();
        const session = { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer', user };
        return reply(overrides.session?.(session, { grant, user, now, tokenVersion }) || session);
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
  return { lifecycle: createHostedDebateFixtureLifecycle(config), users, roles, tokens, registered, revoked, calls, checkpoints, config,
    advance: milliseconds => { now += milliseconds; } };
}

test('an actual service-generated default event ID is recorded and read without changing UUID actor or export-job domains', async () => {
  let row;
  const h = harness({ rows: (table, query, found) => table === 'debate_v3_events' && query.get('id') === `eq.${row?.id}` ? [row] : found });
  await h.lifecycle.provision();
  const host = (await h.lifecycle.sessionFor('host')).user, title = `Hosted Debate ${h.lifecycle.snapshot().runTag} main`;
  const idempotencyKey = '11111111-1111-4111-8111-000000000077';
  await h.lifecycle.recordEventIntent({ title, idempotencyKey });
  const store = createMemoryDebateStoreForTests(), service = createDebateService({ store, now: () => NOW });
  const created = await service.execute({ actor: { id: host.id, verified: true }, command: 'create_event',
    payload: { title, rehearsal: true, visibility: 'unlisted' }, expectedRevision: 0, idempotencyKey });
  const state = await store.read(created.event.id);
  assert.match(state.id, /^de-[a-f0-9]{32}$/u);
  row = { id: state.id, owner_id: state.ownerId, revision: state.revision, state };
  await h.lifecycle.recordEvent({ id: state.id, title });
  assert.equal(h.lifecycle.snapshot().eventIntents[0].creationState, 'EXACT_OWNED_EVENT_CONFIRMED');
  assert.deepEqual(await h.lifecycle.readEvent(state.id), state);
  await assert.rejects(h.lifecycle.readStoredExport({ eventId: state.id, jobId: state.id, format: 'pdf' }), /HOSTED_EXPORT_SCOPE/);
  const confirmed = clone(h.lifecycle.snapshot().eventIntents);
  for (const id of [host.id, 'de-' + 'a'.repeat(31), 'de-' + 'a'.repeat(33), 'de-' + 'A'.repeat(32), state.id + '/escape', null]) {
    const before = h.calls.length;
    await assert.rejects(h.lifecycle.recordEvent({ id, title }), /HOSTED_EVENT_UNDECLARED/);
    assert.equal(h.calls.length, before); assert.deepEqual(h.lifecycle.snapshot().eventIntents, confirmed);
  }
  row.owner_id = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(h.lifecycle.readEvent(state.id), /HOSTED_EVENT_OWNERSHIP/);
});

test('eleven registered students are classified before signin, ten preview identities, no platform promotions', async () => {
  const h = harness(); const provisioned = await h.lifecycle.provision();
  assert.equal(Object.keys(provisioned.accounts).length, 11); assert.equal(provisioned.previewIds.length, 10);
  assert.ok(!provisioned.previewIds.includes(provisioned.excludedId)); assert.equal(h.registered.size, 11);
  const session = await h.lifecycle.sessionFor('host');
  assert.equal(session.refresh_token.length, 12); assert.equal(session.expires_at, Math.floor(NOW / 1000) + 3600);
  assert.equal(h.calls.filter(c => c.url.pathname === '/study-room/access').length, 11);
  assert.ok([...h.roles.values()].every(role => role.role === 'student'));
  const cleanup = await h.lifecycle.cleanup(); assert.equal(cleanup.complete, true); assert.equal(h.users.size, 0); assert.equal(h.revoked.size, 11);
  assert.ok(h.lifecycle.snapshot().fixtures.every(f => f.oldSessionDenied && f.workerDeniedBeforeCleanup));
  assert.equal(h.lifecycle.snapshot().atomicCleanupHelperVerified, true);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/astra_staging_debate_cleanup_v1')).length, 2);
});
test('actual session material stays in memory, refreshes after an hour, and is revoked before Auth deletion', async () => {
  const h = harness(); await h.lifecycle.provision(); const before = await h.lifecycle.sessionFor('host');
  h.advance(3600001); const after = await h.lifecycle.sessionFor('host'); assert.notEqual(after.access_token, before.access_token);
  assert.equal(h.lifecycle.snapshot().fixtures.find(f => f.purpose === 'host').refreshCount, 1);
  await h.lifecycle.acceptBrowserSession('host', after); assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.calls.filter(c => c.url.searchParams.get('grant_type') === 'refresh_token').length, 11);
  assert.ok(!JSON.stringify(h.checkpoints).includes(after.refresh_token));
});

test('SDK expiry metadata cannot extend the server-authenticated JWT expiry', async () => {
  const h = harness({ session: session => ({ ...session, expires_at: Math.floor(NOW / 1000) + 99999 }) });
  await h.lifecycle.provision(); const session = await h.lifecycle.sessionFor('host');
  assert.equal(session.expires_at, Math.floor(NOW / 1000) + 3600);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
});

for (const [name, change] of [
  ['empty refresh token', session => ({ ...session, refresh_token: '' })],
  ['absent refresh token', session => { const next = { ...session }; delete next.refresh_token; return next; }],
  ['invalid expires_in', session => ({ ...session, expires_in: '3600' })],
  ['invalid expires_at', session => ({ ...session, expires_at: null })],
  ['wrong response user', session => ({ ...session, user: { id: '22222222-2222-4222-8222-222222222222' } })],
]) test(`received bearer survives ${name} metadata rejection solely for verified cleanup`, async () => {
  const h = harness({ session: change });
  await assert.rejects(h.lifecycle.provision(), /HOSTED_SESSION_INVALID/);
  const record = h.lifecycle.snapshot().fixtures[0]; assert.equal(record.signInState, 'response_received');
  await assert.rejects(h.lifecycle.sessionFor('host'), /HOSTED_SESSION_UNAVAILABLE/);
  assert.equal((await h.lifecycle.cleanup()).complete, true); assert.equal(h.users.size, 0); assert.equal(h.revoked.size, 1);
  const logout = h.calls.find(call => call.url.pathname === '/auth/v1/logout');
  assert.ok(logout && h.tokens.has(logout.headers.Authorization.slice(7)));
  assert.equal(h.calls.filter(call => call.url.pathname === '/auth/v1/token').length, 1);
  assert.equal(h.lifecycle.snapshot().immediateLogoutFencingVerified, false);
});

test('a received credential is retained before a failed Auth readback and requalified by read-only cleanup', async () => {
  let failed = false;
  const h = harness({ intercept: call => {
    if (!failed && call.url.pathname === '/auth/v1/user') { failed = true; return reply(null, 503); }
    return null;
  } });
  await assert.rejects(h.lifecycle.provision(), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal(h.lifecycle.snapshot().fixtures[0].signInState, 'response_received');
  assert.equal((await h.lifecycle.cleanup()).complete, true); assert.equal(h.users.size, 0);
  assert.equal(h.calls.filter(call => call.url.pathname === '/auth/v1/token').length, 1);
});

for (const claims of [{ iss: 'https://foreign.invalid/auth/v1' }, { sub: '22222222-2222-4222-8222-222222222222' }, { exp: 'invalid' }]) {
  test(`wrong JWT ${Object.keys(claims)[0]} cannot qualify for active use or authorize logout`, async () => {
    const h = harness({ session: (session, { user, now }) => ({ ...session,
      access_token: inertAccess(user.id, Math.floor(now / 1000) + 3600, 'foreign', claims) }) });
    await assert.rejects(h.lifecycle.provision(), /HOSTED_SESSION_INVALID/);
    assert.equal((await h.lifecycle.cleanup()).complete, false); assert.equal(h.users.size, 1);
    assert.equal(h.calls.filter(call => call.url.pathname === '/auth/v1/logout').length, 0);
    assert.equal(h.calls.filter(call => call.method === 'DELETE').length, 0);
  });
}

test('live Auth identity mismatch cannot qualify even a matching JWT-shaped credential for cleanup', async () => {
  const h = harness({ intercept: call => call.url.pathname === '/auth/v1/user'
    ? reply({ id: '22222222-2222-4222-8222-222222222222' }) : null });
  await assert.rejects(h.lifecycle.provision(), /FIXTURE_SESSION_IDENTITY/);
  assert.equal((await h.lifecycle.cleanup()).complete, false); assert.equal(h.users.size, 1);
  assert.equal(h.calls.filter(call => call.url.pathname === '/auth/v1/logout').length, 0);
});

test('malformed received refresh metadata retains the new verified logout bearer without retrying the consumed refresh token', async () => {
  const h = harness({ session: (session, { grant }) => grant === 'refresh_token' ? { ...session, refresh_token: '' } : session });
  await h.lifecycle.provision(); const original = await h.lifecycle.sessionFor('host'); h.advance(3500000);
  await assert.rejects(h.lifecycle.sessionFor('host'), /HOSTED_SESSION_INVALID/);
  await assert.rejects(h.lifecycle.sessionFor('host'), /HOSTED_REFRESH_OUTCOME_UNKNOWN/);
  const received = [...h.tokens.entries()].filter(([, id]) => id === original.user.id).at(-1)[0];
  assert.notEqual(received, original.access_token);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.ok(h.calls.some(call => call.url.pathname === '/auth/v1/logout' && call.headers.Authorization === `Bearer ${received}`));
  assert.equal(h.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token').length, 1);
});

test('cleanup can requalify a received refresh bearer after an interrupted identity read when the old bearer has expired', async () => {
  let interruptNextUser = false;
  const h = harness({ session: (session, { grant }) => { if (grant === 'refresh_token') interruptNextUser = true; return session; },
    intercept: call => { if (interruptNextUser && call.url.pathname === '/auth/v1/user') { interruptNextUser = false; return reply(null, 503); } return null; } });
  await h.lifecycle.provision(); const original = await h.lifecycle.sessionFor('host'); h.advance(3600001);
  await assert.rejects(h.lifecycle.sessionFor('host'), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.calls.filter(call => call.url.searchParams.get('grant_type') === 'refresh_token' && call.body.refresh_token === original.refresh_token).length, 1);
});
test('browser cannot replace a fixture session with another account or an unverified token', async () => {
  const h = harness(); await h.lifecycle.provision(); const observer = await h.lifecycle.sessionFor('observer'), host = await h.lifecycle.sessionFor('host');
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', observer), /HOSTED_SESSION_INVALID/);
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', { ...host, access_token: inertAccess(host.user.id, host.expires_at, 'unknown') }), /HOSTED_SESSION_ORDER_UNCONFIRMED/);
  await assert.rejects(h.lifecycle.acceptBrowserSession('host', { ...host, expires_at: host.expires_at + 60, access_token: inertAccess(host.user.id, host.expires_at + 60, 'unknown') }), /FIXTURE_REMOTE_CONTRACT/);
  assert.equal((await h.lifecycle.sessionFor('host')).access_token, host.access_token);
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

test('missing actual helper cannot pass preparation even though exact empty Auth fixtures can be cleaned', async () => {
  const h = harness({ intercept: call => call.url.pathname.endsWith('/astra_staging_debate_cleanup_v1') ? reply(null, 404) : null });
  await h.lifecycle.provision(); const result = await h.lifecycle.cleanup();
  assert.equal(result.complete, true); assert.equal(h.users.size, 0);
  assert.equal(h.lifecycle.snapshot().atomicCleanupHelperVerified, false);
  assert.equal(h.lifecycle.snapshot().dataCleanup.failureCode, 'FIXTURE_REMOTE_CONTRACT');
});

test('an unconfirmed empty delete response never becomes actual helper verification from absence alone', async () => {
  const h = harness({ intercept: call => call.url.pathname.endsWith('/astra_staging_debate_cleanup_v1') && call.body.p_expected ? reply(null, 503) : null });
  await h.lifecycle.provision(); assert.equal((await h.lifecycle.cleanup()).complete, true);
  assert.equal(h.lifecycle.snapshot().atomicCleanupHelperVerified, false);
  assert.equal(h.lifecycle.snapshot().dataCleanup.atomic.state, 'ABSENCE_RECONCILED_AFTER_UNCERTAIN_RESPONSE');
  assert.equal(h.users.size, 0);
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
