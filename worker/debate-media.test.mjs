import test from 'node:test';
import assert from 'node:assert/strict';
import { jwtVerify } from 'jose';
import { createDebateMediaAdapter } from './debate-media.mjs';

// Deterministic local doubles only: never read process.env or call a provider.
const env = { DEBATE_MEDIA_ENABLED: 'true', LIVEKIT_URL: 'wss://test-only.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'local-test-only-secret-at-least-32-bytes' };
const makeSession = (overrides = {}) => {
  const epochId = crypto.randomUUID();
  return { epochId, identity: `dd-debate-${epochId}`, eventId: 'test-event', matchId: 'test-match', userId: 'test-actor',
    roomName: 'dd-debate-test-event-test-match-main', space: 'main', sources: ['camera'], revocations: [],
    maxParticipants: 10, expiresAt: Date.now() + 120000, status: 'ready', deviceId: 'test-device', operationId: 'test-operation', ...overrides };
};
const makeJob = (session, action = 'join') => ({ id: session.operationId, eventId: session.eventId, claimId: 'test-claim', type: 'media', payload: { action, session } });
function provider(overrides = {}) {
  const calls = [];
  return { calls, service: {
    async removeParticipant(...args) { calls.push(['remove', ...args]); },
    async listRooms(names) { calls.push(['list', names]); return [{ name: names[0], maxParticipants: 10 }]; },
    async createRoom(input) { calls.push(['create', input]); return input; },
    async updateParticipant() { assert.fail('Existing grants must never be mutated.'); }, ...overrides,
  } };
}

test('configuration rejects disabled, unverified, credential-bearing or path-bearing URLs before provider calls', async () => {
  for (const override of [{ DEBATE_MEDIA_ENABLED: 'false' }, { LIVEKIT_URL: 'wss://self-host.example' },
    { LIVEKIT_URL: 'wss://test-only.livekit.cloud.evil.test' }, { LIVEKIT_URL: 'wss://name:secret@test-only.livekit.cloud' },
    { LIVEKIT_URL: 'wss://test-only.livekit.cloud/path' }, { LIVEKIT_URL: 'wss://test-only.livekit.cloud?token=secret' },
    { LIVEKIT_URL: 'wss://test-only.livekit.cloud#fragment' }, { LIVEKIT_URL: 'wss://test-only.livekit.cloud:444' }]) {
    const p = provider(), adapter = createDebateMediaAdapter({ ...env, ...override }, { service: p.service, authorizeJob: async () => {} });
    await assert.rejects(adapter.apply(makeJob(makeSession()))); assert.equal(p.calls.length, 0);
  }
});

test('apply requires current durable authorization and never issues credentials or updates participant grants', async () => {
  const p = provider(), session = makeSession();
  await assert.rejects(createDebateMediaAdapter(env, { service: p.service }).apply(makeJob(session)), { code: 'DEBATE_MEDIA_PENDING' });
  let checks = 0;
  const result = await createDebateMediaAdapter(env, { service: p.service, authorizeJob: async () => { checks++; } }).apply(makeJob(session));
  assert.equal(result.status, 'ready'); assert.equal(result.token, undefined); assert.ok(checks >= 3);
  assert.deepEqual(p.calls.map(c => c[0]), ['list']);
});

test('same-room device/permission epoch retires every ancestor with explicit strict-second revocation', async () => {
  const p = provider(), previous = makeSession(), session = makeSession({ revocations: [{ identity: previous.identity, roomName: previous.roomName }] });
  const time = 1800000000123, adapter = createDebateMediaAdapter(env, { service: p.service, now: () => time, authorizeJob: async () => {} });
  await adapter.apply(makeJob(session, 'permissions'));
  assert.equal(p.calls[0][0], 'remove'); assert.equal(p.calls[0][2], previous.identity);
  assert.equal(p.calls[0][3].revokeTokenTs, 1800000001n);
  assert.ok(BigInt(Math.floor(time / 1000)) < p.calls[0][3].revokeTokenTs, 'Token minted this second is revoked.');
  assert.ok(!p.calls.some(c => c[0] === 'remove' && c[2] === session.identity));
  await adapter.apply(makeJob(session, 'permissions'));
  assert.ok(!p.calls.some(c => c[0] === 'remove' && c[2] === session.identity), 'Duplicate job cannot remove current epoch.');
});

test('failed or absent revocation never confirms transfer or creates the next room', async () => {
  for (const code of ['not_found', 'unavailable']) {
    const p = provider({ async removeParticipant() { throw Object.assign(new Error('Local injected provider failure'), { code, status: code === 'not_found' ? 404 : 503 }); } });
    const previous = makeSession(), session = makeSession({ revocations: [previous] });
    await assert.rejects(createDebateMediaAdapter(env, { service: p.service, authorizeJob: async () => {} }).apply(makeJob(session)));
    assert.equal(p.calls.length, 0);
  }
});

test('stale late room response is rejected after current authorization changes', async () => {
  let release, current = true, called;
  const started = new Promise(resolve => { called = resolve; });
  const p = provider({ async listRooms(names) { called(); return new Promise(resolve => { release = () => resolve([{ name: names[0], maxParticipants: 10 }]); }); } });
  const adapter = createDebateMediaAdapter(env, { service: p.service, authorizeJob: async () => { if (!current) throw Object.assign(new Error('Stale'), { code: 'MEDIA_SESSION_CONFLICT' }); } });
  const operation = adapter.apply(makeJob(makeSession())); await started; current = false; release();
  await assert.rejects(operation, { code: 'MEDIA_SESSION_CONFLICT' }); assert.equal(p.calls.length, 0);
});

test('leave removes ancestors plus current identity; no room grant/create follows', async () => {
  const p = provider(), old = makeSession(), session = makeSession({ revocations: [old, old] });
  const result = await createDebateMediaAdapter(env, { service: p.service, authorizeJob: async () => {} }).apply(makeJob(session, 'leave'));
  assert.equal(result.status, 'left'); assert.equal(p.calls.length, 2); assert.ok(p.calls.every(c => c[0] === 'remove'));
});

test('disabling new media still revokes an existing epoch, while credentials and joins remain closed', async () => {
  const p = provider(), configuration = { ...env }, session = makeSession();
  const adapter = createDebateMediaAdapter(configuration, { service: p.service, authorizeJob: async () => {} });
  await adapter.apply(makeJob(session)); configuration.DEBATE_MEDIA_ENABLED = 'false'; p.calls.length = 0;
  await assert.rejects(adapter.credential(session), { code: 'DEBATE_MEDIA_UNAVAILABLE' });
  await assert.rejects(adapter.apply(makeJob(makeSession())), { code: 'DEBATE_MEDIA_UNAVAILABLE' });
  assert.equal((await adapter.apply(makeJob(session, 'leave'))).status, 'left');
  assert.deepEqual(p.calls.map(call => call[0]), ['remove']);
  assert.equal(p.calls[0][2], session.identity);
  configuration.LIVEKIT_URL = 'wss://unverified.example';
  await assert.rejects(adapter.apply(makeJob(session, 'leave')), { code: 'DEBATE_REVOCATION_UNVERIFIED' });
});

test('credential JWT uses only approved sources and a deadline bounded by current lease and 30 seconds', async () => {
  const session = makeSession({ expiresAt: Date.now() + 9100, sources: ['camera', 'microphone'] });
  const result = await createDebateMediaAdapter(env).credential(session);
  const { payload } = await jwtVerify(result.token, new TextEncoder().encode(env.LIVEKIT_API_SECRET), { issuer: env.LIVEKIT_API_KEY });
  assert.equal(payload.sub, session.identity); assert.ok(payload.exp * 1000 <= session.expiresAt); assert.ok(payload.exp - payload.nbf <= 30);
  assert.deepEqual(payload.video.canPublishSources, ['camera', 'microphone']); assert.equal(payload.video.canPublishData, false);
  assert.equal(payload.video.canUpdateOwnMetadata, false); assert.equal(payload.video.roomAdmin, undefined); assert.equal(payload.video.room, session.roomName);
  assert.equal(result.expiresAt, payload.exp * 1000); assert.equal(result.url, env.LIVEKIT_URL);
});

test('unready, expired, pending-revocation, reused or forged session epochs cannot mint a JWT', async () => {
  for (const changes of [{ status: 'pending' }, { status: 'failed' }, { expiresAt: Date.now() - 1 },
    { revocations: [makeSession()] }, { identity: 'dd-debate-stable-account' }, { sources: ['camera', 'admin'] }, { operationId: '' }]) {
    await assert.rejects(createDebateMediaAdapter(env).credential(makeSession(changes)), { code: 'DEBATE_MEDIA_PENDING' });
  }
});

test('lease expiring during asynchronous signing fails closed', async () => {
  const start = Date.now(), session = makeSession({ expiresAt: start + 10000 }); let reads = 0;
  const adapter = createDebateMediaAdapter(env, { now: () => ++reads < 3 ? start : start + 11000 });
  await assert.rejects(adapter.credential(session), { code: 'DEBATE_MEDIA_PENDING' });
});

test('unconfirmed room capacity and self-revoking epoch reject readiness', async () => {
  const session = makeSession(), p = provider({ async listRooms(names) { return [{ name: names[0], maxParticipants: 0 }]; } });
  const adapter = createDebateMediaAdapter(env, { service: p.service, authorizeJob: async () => {} });
  await assert.rejects(adapter.apply(makeJob(session)), { code: 'DEBATE_CAPACITY_UNCONFIRMED' });
  session.revocations = [{ identity: session.identity, roomName: session.roomName }];
  await assert.rejects(adapter.apply(makeJob(session)), { code: 'DEBATE_MEDIA_PENDING' });
});
