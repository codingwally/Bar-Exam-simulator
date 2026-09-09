import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './index.mjs';
import { createDebateIntegration } from './debate-integration.mjs';
import { createDebateDelivery } from './debate-delivery.mjs';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';
import { DEFAULT_RULES } from './debate-domain.mjs';
import { TokenVerifier } from 'livekit-server-sdk';

// All remote transports are replaced with bounded local responses. These tests
// exercise the production integration/service/adapter code, not hosted state.
const host = { id: '10000000-0000-4000-8000-000000000001', verified: true, displayName: 'Host' };
const person = n => ({ id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`, verified: true, displayName: `Member ${n}` });
const baseEnv = { SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'inert-service-secret', ALLOWED_ORIGIN: 'https://duediligence.ph' };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const stream = bytes => new Response(bytes).body;
const request = (path, { method = 'GET', body, headers = {} } = {}) => new Request(`https://worker.test/debate-room/${path}`, { method, headers: { Authorization: 'Bearer local-session', ...headers }, ...(body === undefined ? {} : { body, duplex: 'half' }) });
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const bodyOf = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };

function storageFixture() {
  const objects = new Map(), calls = []; let isPublic = false, hook = null;
  const fetcher = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://project.test', 'No fixture may reach a real provider');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer inert-service-secret');
    assert.equal(options.headers.apikey, 'inert-service-secret');
    calls.push({ path: url.pathname, method: options.method || 'GET' });
    await hook?.(url.pathname, options);
    if (url.pathname === '/storage/v1/bucket/debate-private-v3') return Response.json({ id: 'debate-private-v3', public: isPublic });
    if (options.method === 'POST' && url.pathname.startsWith('/storage/v1/object/')) {
      const key = url.pathname.replace('/storage/v1/object/debate-private-v3/', '');
      if (objects.has(key) && options.headers['x-upsert'] !== 'true') return Response.json({ error: 'duplicate' }, { status: 409 });
      objects.set(key, new Uint8Array(options.body)); return Response.json({ ok: true });
    }
    if (options.method === 'DELETE' && url.pathname === '/storage/v1/object/debate-private-v3') {
      for (const key of JSON.parse(options.body).prefixes) objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/storage/v1/object/authenticated/')) {
      const key = url.pathname.replace('/storage/v1/object/authenticated/debate-private-v3/', '');
      return objects.has(key) ? new Response(objects.get(key)) : Response.json({ error: 'missing' }, { status: 404 });
    }
    assert.fail(`Unexpected local fixture operation ${url.pathname}`);
  };
  return { objects, calls, fetcher, setPublic: value => { isPublic = value; }, setHook: value => { hook = value; } };
}

function rpcBridge(store, calls = []) {
  return async (name, p) => {
    calls.push({ name, args: structuredClone(p) });
    switch (name) {
      case 'debate_v3_read': return store.read(p.p_event_id);
      case 'debate_v3_list': return store.list(p.p_actor_id);
      case 'debate_v3_discover': return store.discover(p.p_limit, p.p_cursor);
      case 'debate_v3_receipt': return store.receipt(p.p_request);
      case 'debate_v3_rate_limit': return store.rateLimit(p.p_actor_id, p.p_action, p.p_now, p.p_limit, p.p_window_ms);
      case 'debate_v3_commit': return store.commit(p.p_request);
      case 'debate_v3_claim_jobs': return store.claimJobs(p.p_event_id, p.p_limit, p.p_now);
      case 'debate_v3_finish_job': return store.finishJob(p.p_request);
      case 'debate_v3_read_job': return store.readJob(p.p_job_id);
      case 'debate_v3_active_events': return store.activeEvents(p.p_limit, p.p_cursor, p.p_now);
      case 'debate_v3_expired_jobs': return store.expiredJobs(p.p_event_id, p.p_now);
      case 'debate_v3_reserve_upload': return store.reserveUpload(p.p_request);
      case 'debate_v3_read_upload': return store.readUpload(p.p_upload_id);
      case 'debate_v3_complete_upload': return store.completeUpload(p.p_request);
      case 'debate_v3_fail_upload': return store.failUpload(p.p_request);
      default: assert.fail(`Unexpected RPC ${name}`);
    }
  };
}

async function fixture(serviceOptions = {}) {
  const store = createMemoryDebateStoreForTests(), storage = storageFixture(), rpcCalls = [];
  const service = createDebateService({ store, ...serviceOptions }); let actor = host, sequence = 0, eventId;
  const command = async (command, payload = {}, current = host) => {
    const saved = eventId ? await store.read(eventId) : null;
    const result = await service.execute({ actor: current, eventId, command, payload, expectedRevision: saved?.revision || 0, idempotencyKey: `boundary-${++sequence}-local` });
    eventId ||= result.event.id; return result;
  };
  await command('create_event', { title: 'Local boundary rehearsal', rehearsal: true });
  for (let n = 1; n <= 6; n++) {
    const invitation = await command('create_invite', { role: 'debater', boundAccountId: person(n).id });
    await command('claim_invite', { secret: invitation.receipt.result.secret }, person(n));
    await command('check_in', {}, person(n)); await command('admit_member', { memberId: person(n).id });
  }
  const affirmative = (await command('confirm_roster', { name: 'Affirmative', speakerIds: [1,2,3].map(n => person(n).id), captainId: person(1).id })).receipt.result.teamId;
  const negative = (await command('confirm_roster', { name: 'Negative', speakerIds: [4,5,6].map(n => person(n).id), captainId: person(4).id })).receipt.result.teamId;
  const motionId = (await command('add_motion', { text: 'This house would publish learning materials.' })).receipt.result.motionId;
  const matchId = (await command('create_match', { motionId, teamIds: { affirmative, negative }, judgeIds: [host.id] })).receipt.result.matchId;
  const integration = createDebateIntegration({ env: { ...baseEnv, DEBATE_ROOM_ENABLED: 'true' }, authenticate: async () => actor, rpc: rpcBridge(store, rpcCalls), fetcher: storage.fetcher });
  return { store, storage, service, command, integration, eventId, matchId, rpcCalls, setActor: value => { actor = value; } };
}

test('release flags default closed, preview is exact authenticated account, and client actor cannot bypass it', async () => {
  let calls = 0, actor = null;
  const integration = createDebateIntegration({ env: { ...baseEnv, DEBATE_PREVIEW_ACTOR_IDS: host.id }, authenticate: async () => actor,
    rpc: async () => { calls++; return []; }, fetcher: async () => assert.fail('No external action may occur') });
  assert.equal((await bodyOf(await integration.handle(new Request('https://worker.test/debate-room/access')))).enabled, false);
  await bodyOf(await integration.handle(request('events')), 401); assert.equal(calls, 0);
  actor = person(1); await bodyOf(await integration.handle(post('command', { actor: host, command: 'create_event' })), 403); assert.equal(calls, 0);
  actor = host; assert.equal((await bodyOf(await integration.handle(request('access')))).enabled, true);
  assert.deepEqual((await bodyOf(await integration.handle(request('events')))).events, []);
  assert.equal(calls, 1);
});

test('authenticated request identity replaces forged command actor and flags do not authorize a stranger', async () => {
  const store = createMemoryDebateStoreForTests(), calls = [];
  const integration = createDebateIntegration({ env: { ...baseEnv, DEBATE_ROOM_ENABLED: 'true' }, authenticate: async () => host, rpc: rpcBridge(store, calls), fetcher: async () => assert.fail('No provider call') });
  const result = await bodyOf(await integration.handle(post('command', { actor: person(1), command: 'create_event', payload: { title: 'Actor-bound event' }, expectedRevision: 0, idempotencyKey: 'actor-bound-local' })));
  assert.equal((await store.read(result.event.id)).ownerId, host.id);
  assert.equal(calls.find(c => c.name === 'debate_v3_commit').args.p_request.actorId, host.id);
});

test('outbox/media JSON limits reject before saved-state lookup and cancel oversized streams', async () => {
  let calls = 0, cancelled = false;
  const integration = createDebateIntegration({ env: { DEBATE_ROOM_ENABLED: 'true' }, authenticate: async () => host, rpc: async () => { calls++; }, fetcher: async () => assert.fail('No provider call') });
  const input = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12001)); }, cancel() { cancelled = true; } });
  await bodyOf(await integration.handle(request('outbox', { method: 'POST', body: input, headers: { 'Content-Type': 'application/json' } })), 413);
  assert.equal(cancelled, true); assert.equal(calls, 0);
  await bodyOf(await integration.handle(request('media', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })), 400);
  assert.equal(calls, 0);
  cancelled = false;
  const largeCommand = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(262145)); }, cancel() { cancelled = true; } });
  const rejected = await bodyOf(await integration.handle(request('command', { method: 'POST', body: largeCommand, headers: { 'Content-Type': 'application/json' } })), 400);
  assert.equal(rejected.error.code, 'PAYLOAD_TOO_LARGE'); assert.equal(cancelled, true); assert.equal(calls, 0);
});

test('hosted RPC failure returns a safe unavailable response without credential or database detail', async () => {
  const integration = createDebateIntegration({ env: { ...baseEnv, DEBATE_ROOM_ENABLED: 'true' }, authenticate: async () => host,
    rpc: async () => { throw new Error(`Internal database connection ${baseEnv.SUPABASE_SERVICE_ROLE_KEY}`); }, fetcher: async () => assert.fail('No provider operation') });
  const result = await bodyOf(await integration.handle(request('events')), 503);
  assert.equal(result.error.code, 'STORE_UNAVAILABLE'); assert.ok(!JSON.stringify(result).includes(baseEnv.SUPABASE_SERVICE_ROLE_KEY)); assert.ok(!JSON.stringify(result).includes('Internal database connection'));
});

test('real signing is short lived and actor/device/permission bound; disabled cleanup and concurrent role change return no token', async () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => assert.fail('Signing must not contact a provider');
  try {
    const f = await fixture({ limits: { maxParticipants: 8 }, adapters: { media: async () => ({ status: 'ready' }) } });
    await f.command('enter_space', { matchId: f.matchId, deviceId: 'device-local', space: 'main' }, person(1));
    await f.service.processOutbox({ eventId: f.eventId });
    const env = { ...baseEnv, DEBATE_ROOM_ENABLED: 'true', DEBATE_MEDIA_ENABLED: 'true', DEBATE_SWEEPER_ENABLED: 'true', DEBATE_APPROVED_MAX_PARTICIPANTS: '8',
      LIVEKIT_URL: 'wss://inert-boundary.livekit.cloud', LIVEKIT_API_KEY: 'inert-api-key', LIVEKIT_API_SECRET: 'inert-signing-secret-only-used-locally' };
    const query = { eventId: f.eventId, matchId: f.matchId, deviceId: 'device-local' };
    const integration = createDebateIntegration({ env, authenticate: async () => person(1), rpc: rpcBridge(f.store), fetcher: async () => assert.fail('No storage operation') });
    const result = await bodyOf(await integration.handle(post('media', query)));
    const decoded = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(result.credential.token);
    assert.equal(decoded.sub, result.credential.identity); assert.equal(decoded.video.room, result.credential.roomName);
    assert.deepEqual(decoded.video.canPublishSources, ['camera']); assert.equal(decoded.video.canPublishData, false); assert.equal(decoded.video.canUpdateOwnMetadata, false);
    assert.ok(decoded.exp - decoded.nbf <= 30); assert.ok(result.credential.expiresAt <= result.event.matches[0].myMedia.expiresAt);
    await bodyOf(await integration.handle(post('media', { ...query, deviceId: 'other-device' })), 409);
    const disabled = createDebateIntegration({ env: { ...env, DEBATE_SWEEPER_ENABLED: 'false' }, authenticate: async () => person(1), rpc: rpcBridge(f.store) });
    const denied = await bodyOf(await disabled.handle(post('media', query)), 503); assert.equal(denied.credential, undefined);
    let claimed = false, authorizationReads = 0; const bridge = rpcBridge(f.store);
    const racing = createDebateIntegration({ env, authenticate: async () => person(1), rpc: async (name, params) => {
      if (name === 'debate_v3_claim_jobs') claimed = true;
      if (claimed && name === 'debate_v3_read' && ++authorizationReads === 2) await f.command('grant_floor', { matchId: f.matchId, memberId: person(1).id, granted: true });
      return bridge(name, params);
    } });
    const stale = await bodyOf(await racing.handle(post('media', query)), 409); assert.equal(stale.credential, undefined); assert.equal(authorizationReads, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test('private export download binds owner and current membership, headers, and post-fetch revocation', async () => {
  const f = await fixture(); f.setActor(person(1));
  const queued = await f.command('create_export', { matchId: f.matchId, kind: 'rules' }, person(1));
  await bodyOf(await f.integration.handle(post('outbox', { eventId: f.eventId })));
  const downloadId = queued.receipt.result.jobId;
  assert.equal((await f.store.readJob(downloadId)).status, 'completed');
  const path = `download?eventId=${f.eventId}&downloadId=${downloadId}`;
  const response = await f.integration.handle(request(path)); assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  assert.match(response.headers.get('Vary'), /Authorization/); assert.equal(new TextDecoder().decode((await response.bytes()).slice(0, 5)), '%PDF-');
  f.setActor(person(2)); const before = f.storage.calls.length;
  await bodyOf(await f.integration.handle(request(path)), 403); assert.equal(f.storage.calls.length, before);
  f.setActor(person(1)); let revoked = false;
  f.storage.setHook(async path => { if (path.includes('/object/authenticated/') && !revoked) { revoked = true; await f.command('remove_member', { memberId: person(1).id }); } });
  await bodyOf(await f.integration.handle(request(path)), 403);
  assert.equal(revoked, true);
});

test('evidence upload cannot cross private team channel, binds actor rate budget, and verifies hosted bytes', async () => {
  const f = await fixture(); f.setActor(person(1));
  const path = channel => `evidence/upload?eventId=${f.eventId}&matchId=${f.matchId}&channel=${encodeURIComponent(channel)}`;
  const uploadRequest = channel => request(path(channel), { method: 'POST', body: png, headers: { 'Content-Type': 'image/png', 'X-Debate-Filename': 'local.png' } });
  await bodyOf(await f.integration.handle(uploadRequest('team:negative')), 403); assert.equal(f.storage.calls.length, 0);
  const { attachment } = await bodyOf(await f.integration.handle(uploadRequest('team:affirmative')));
  const rate = f.rpcCalls.find(c => c.name === 'debate_v3_rate_limit'); assert.equal(rate.args.p_actor_id, person(1).id); assert.equal(rate.args.p_limit, 20);
  const delivery = createDebateDelivery(baseEnv, f.storage);
  const input = { ...attachment, actorId: person(1).id, eventId: f.eventId, matchId: f.matchId, channel: 'team:affirmative' };
  const verified = await delivery.validateEvidence(input); assert.equal(verified.verified, true);
  for (const changed of [{ actorId: person(2).id }, { eventId: 'another-event' }, { matchId: 'another-match' }, { channel: 'public' }, { mimeType: 'application/pdf' }, { size: 999 }, { uploadId: attachment.uploadId + '.extra' }]) {
    await assert.rejects(delivery.validateEvidence({ ...input, ...changed }), { code: 'UPLOAD_INVALID' });
  }
  f.storage.objects.set(verified.storageKey, Uint8Array.from([...png.slice(0, -1), 9]));
  await assert.rejects(delivery.validateEvidence(input), { code: 'UPLOAD_CHANGED' });
  await assert.rejects(delivery.downloadEvidence(verified), { code: 'UPLOAD_CHANGED' });
});

test('revocation during upload leaves a durable cleanup job that succeeds even after the uploader is removed', async () => {
  const f = await fixture(); f.setActor(person(1)); let removed = false;
  f.storage.setHook(async (path, options) => { if (options.method === 'POST' && path.includes('/object/') && !removed) { removed = true; await f.command('remove_member', { memberId: person(1).id }); } });
  const response = await f.integration.handle(request(`evidence/upload?eventId=${f.eventId}&matchId=${f.matchId}`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } }));
  await bodyOf(response, 403); assert.equal(removed, true); assert.equal(f.storage.objects.size, 1);
  const reservationId = [...f.storage.objects.keys()][0].split('/').at(-1).replace(/\.png$/, '');
  const failed = await f.store.readUpload(reservationId); assert.equal(failed.status, 'failed');
  assert.equal((await f.store.readJob(failed.cleanupJobId)).status, 'queued');
  f.setActor(host); await bodyOf(await f.integration.handle(post('outbox', { eventId: f.eventId })));
  assert.equal(f.storage.objects.size, 0); assert.equal((await f.store.readUpload(reservationId)).status, 'deleted');
  assert.equal((await f.store.readJob(failed.cleanupJobId)).status, 'completed');
});

test('attaching evidence atomically retains the file and its authorized download rejects subsequent byte changes', async () => {
  const f = await fixture(); f.setActor(person(1));
  const { attachment } = await bodyOf(await f.integration.handle(request(`evidence/upload?eventId=${f.eventId}&matchId=${f.matchId}`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } })));
  const uploaded = await bodyOf(await f.integration.handle(post('command', { command: 'share_evidence', eventId: f.eventId, expectedRevision: (await f.store.read(f.eventId)).revision,
    idempotencyKey: 'evidence-retention-local', payload: { matchId: f.matchId, title: 'Local attachment', channel: 'public', attachment } })));
  const evidenceId = uploaded.receipt.result.evidenceId, saved = (await f.store.read(f.eventId)).matches[f.matchId].evidence.find(item => item.id === evidenceId);
  const reservation = await f.store.readUpload(saved.attachment.id); assert.equal(reservation.status, 'retained'); assert.equal((await f.store.readJob(reservation.cleanupJobId)).status, 'cancelled');
  const path = `evidence/download?eventId=${f.eventId}&matchId=${f.matchId}&evidenceId=${evidenceId}`;
  const response = await f.integration.handle(request(path)); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  f.storage.objects.set(saved.storageKey, Uint8Array.from([...png.slice(0, -1), 99]));
  const changed = await bodyOf(await f.integration.handle(request(path)), 409); assert.equal(changed.error.code, 'UPLOAD_CHANGED');
});

test('retention operators require the explicit server account list as well as organizer authority', async () => {
  const f = await fixture();
  const configured = allowed => createDebateIntegration({ env: { ...baseEnv, DEBATE_ROOM_ENABLED: 'true', DEBATE_PLATFORM_OPERATOR_IDS: allowed ? host.id : '' },
    authenticate: async () => ({ ...host, platformOperator: true }), rpc: rpcBridge(f.store), fetcher: async () => assert.fail('No provider operation') });
  const action = async () => post('command', { actor: { ...host, platformOperator: true }, eventId: f.eventId, command: 'set_retention', expectedRevision: (await f.store.read(f.eventId)).revision,
    idempotencyKey: 'retention-local-only', payload: { approved: true, chatDays: 45 } });
  await bodyOf(await configured(false).handle(await action()), 403);
  await bodyOf(await configured(true).handle(await action()));
  const retained = (await f.store.read(f.eventId)).retention; assert.equal(retained.approved, true); assert.equal(retained.chatDays, 45);
});

test('new scheduler instances resume a durable cursor beyond the first 100 persistent active events', async () => {
  const store = createMemoryDebateStoreForTests();
  const service = createDebateService({ store });
  const created = await service.execute({ actor: host, command: 'create_event', payload: { title: 'Scheduler schema fixture', rehearsal: true }, expectedRevision: 0, idempotencyKey: 'scheduler-schema-local' });
  const template = await store.read(created.event.id);
  for (let n = 0; n < 101; n++) {
    const eventId = `persistent-${String(n).padStart(4, '0')}`;
    // Deliberately unresolved media keeps every fixture active across sweeps;
    // this tests scheduling fairness independently of provider reconciliation.
    // Preserve the real create_event shape, including the retention policy that
    // active-event discovery and maintenance now inspect before media work.
    await store.commit({ eventId, actorId: `actor-${n}`, expectedRevision: 0, command: 'fixture', idempotencyKey: `fixture-${n}`, payloadHash: `${n}`, now: Date.now(),
      state: { ...structuredClone(template), id: eventId, ownerId: `actor-${n}`, members: { [`actor-${n}`]: { ...template.members[host.id], id: `actor-${n}` } }, createdAt: Date.now(), matches: {}, media: { unresolved: { status: 'ready' } }, jobs: {} }, receipt: { id: `receipt-${n}` }, jobs: [] });
  }
  const fresh = () => createDebateIntegration({ env: { DEBATE_SWEEPER_ENABLED: 'true' }, authenticate: async () => null, rpc: rpcBridge(store), fetcher: async () => assert.fail('No provider operation') });
  const first = await fresh().sweep(), second = await fresh().sweep();
  assert.equal(first.outcomes.length, 100); assert.equal(first.backlog, true);
  assert.equal(new Set([...first.outcomes, ...second.outcomes].map(item => item.eventId)).size, 101);
  assert.equal(second.backlog, false);
  for (const outcome of [...first.outcomes, ...second.outcomes]) { assert.equal(outcome.error, undefined, `Maintenance failed for ${outcome.eventId}`); assert.deepEqual(outcome.outcomes, []); }
  const nextCycle = await fresh().sweep(); assert.equal(nextCycle.outcomes.length, 100); assert.equal(nextCycle.backlog, true, 'Unresolved events remain active; fairness must come from the durable cursor, not removal.');
});

test('a slow scheduler page cannot start later jobs and reports deferred events even at the final cursor', async () => {
  const originalNow = Date.now; let time = originalNow(), calls = 0; Date.now = () => time;
  try {
    const integration = createDebateIntegration({ env: { DEBATE_SWEEPER_ENABLED: 'true' }, authenticate: async () => null,
      rpc: async (name, args) => { assert.equal(name, 'debate_v3_active_events'); assert.equal(args.p_now, time); calls++; time += 45001; return { eventIds: ['deferred-event-one', 'deferred-event-two'], nextCursor: null }; },
      fetcher: async () => assert.fail('No delivery may start after the shared deadline') });
    const result = await integration.sweep(); assert.equal(calls, 1); assert.equal(result.deadlineReached, true); assert.equal(result.deferredEvents, 2);
    assert.equal(result.nextCursor, null); assert.equal(result.backlog, true); assert.deepEqual(result.outcomes, []);
  } finally { Date.now = originalNow; }
});

test('private storage is rechecked on read and successful empty delete responses are accepted', async () => {
  const f = storageFixture(), delivery = createDebateDelivery(baseEnv, f);
  const attachment = await delivery.upload({ actorId: host.id, eventId: 'event-local-only', matchId: 'match-local-only', body: stream(png), mimeType: 'image/png', name: '../test.png' });
  const meta = await delivery.validateEvidence({ ...attachment, actorId: host.id, eventId: 'event-local-only', matchId: 'match-local-only' });
  f.setPublic(true); await assert.rejects(delivery.download(meta.storageKey), { code: 'PRIVATE_STORAGE_UNCONFIRMED' });
  f.setPublic(false); assert.deepEqual(await delivery.delete_evidence({ eventId: 'event-local-only', payload: { storageKey: meta.storageKey } }), { status: 'deleted' });
  assert.equal(f.objects.size, 0);
  await assert.rejects(delivery.delete_evidence({ eventId: 'another-event', payload: { storageKey: meta.storageKey } }), { code: 'INVALID_FILE_KEY' });
});

test('mail verifies current active account email, uses immutable idempotency, and retains acceptance reference', async () => {
  const now = 1800000000000, calls = []; let active = true;
  const env = { ...baseEnv, OUTBOUND_EMAIL_MODE: 'enabled', DEBATE_RESULTS_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'inert-resend-key', DEBATE_RESULTS_EMAIL_FROM: 'Debate <test@example.test>' };
  const delivery = createDebateDelivery(env, { now: () => now, fetcher: async (input, options) => {
    const url = new URL(String(input)); calls.push({ url: url.href, options }); assert.equal(options.redirect, 'error');
    if (url.origin === 'https://project.test' && url.pathname === `/auth/v1/admin/users/${person(1).id}`) return Response.json({ id: person(1).id, email: 'current@example.test', email_confirmed_at: new Date(now - 1000).toISOString(), is_anonymous: false, ...(active ? {} : { banned_until: new Date(now + 60000).toISOString() }) });
    assert.equal(url.href, 'https://api.resend.com/emails'); const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, ['current@example.test']); assert.match(payload.subject, /^\[Rehearsal\]/); assert.equal(options.headers['Idempotency-Key'], 'debate-result/mail-local-job');
    assert.match(payload.text, /Sign in to view current records/); assert.equal(payload.attachments.length, 1);
    return Response.json({ id: 'provider-local-receipt' });
  } });
  const document = { eventId: 'event-local-only', matchId: 'match-local-only', createdFor: person(1).id, eventTitle: 'Local event', matchTitle: 'Match', rehearsal: true, kind: 'result', rules: DEFAULT_RULES, rulesVersion: 1, resultVersion: 'result-local-only', resultRevision: 1, result: { state: 'FINAL', winner: 'affirmative', resultKind: 'normal', judgingMode: 'majority', publishedAt: now - 1000, finalizedAt: now, awards: { status: 'UNAVAILABLE' } } };
  const job = { id: 'mail-local-job', createdAt: now, payload: { recipientId: person(1).id, recipientEmail: 'forged@example.test', document, rehearsal: true } };
  const sent = await delivery.mail(job); assert.equal(sent.status, 'accepted'); assert.equal(sent.deliveryStatus, 'accepted_not_delivery_confirmed'); assert.equal(sent.providerId, 'provider-local-receipt');
  active = false; await assert.rejects(delivery.mail(job), { code: 'EMAIL_VERIFICATION_REQUIRED' }); assert.equal(calls.filter(c => c.url === 'https://api.resend.com/emails').length, 1);
  await assert.rejects(delivery.mail({ ...job, createdAt: now - 23 * 3600000 }), { code: 'EMAIL_RECONCILIATION_REQUIRED' });
});

test('bound-account invitation lookup fails closed on malformed verification or restriction fields', async () => {
  const now = 1800000000000; let record = { id: person(1).id, email: 'Current@Example.test', email_confirmed_at: new Date(now - 1000).toISOString(), is_anonymous: false };
  const valid = { ...record }, calls = [];
  const delivery = createDebateDelivery(baseEnv, { now: () => now, fetcher: async (input, options) => {
    assert.equal(String(input), `https://project.test/auth/v1/admin/users/${person(1).id}`); assert.equal(options.headers.Authorization, 'Bearer inert-service-secret'); calls.push(input); return Response.json(record);
  } });
  assert.equal(await delivery.recipientEmail(person(1).id), 'current@example.test');
  for (const changed of [{ id: person(2).id }, { email_confirmed_at: null }, { email_confirmed_at: 0 }, { email_confirmed_at: 'invalid' }, { is_anonymous: true }, { is_anonymous: 0 }, { banned_until: 'invalid' }, { banned_until: false }, { banned_until: new Date(now + 1000).toISOString() }, { deleted_at: new Date(now).toISOString() }]) {
    record = { ...valid, ...changed }; await assert.rejects(delivery.recipientEmail(person(1).id), { code: 'EMAIL_VERIFICATION_REQUIRED' });
  }
  assert.equal(calls.length, 11);
});

test('invitation delivery encrypts secrets, binds recipient and expiry, defaults off, and preserves retry idempotency', async () => {
  let now = 1800000000000, uncertain = false; const calls = [], code = '23456789ABCD';
  const env = { ...baseEnv, OUTBOUND_EMAIL_MODE: 'enabled', DEBATE_INVITATION_EMAIL_MODE: 'enabled', DEBATE_INVITATION_EMAIL_FROM: 'Debate <test@example.test>',
    RESEND_API_KEY: 'inert-resend-key', DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS: 'approved@example.test' };
  const fetcher = async (input, options) => {
    assert.equal(String(input), 'https://api.resend.com/emails'); assert.equal(options.redirect, 'error');
    const payload = JSON.parse(options.body); calls.push({ key: options.headers['Idempotency-Key'], payload });
    assert.deepEqual(payload.to, ['approved@example.test']); assert.match(payload.subject, /^\[Rehearsal\]/);
    assert.ok(payload.text.includes(`#event=event-local-only&invite=${code}`));
    if (uncertain) throw new Error('Simulated lost provider response');
    return Response.json({ id: 'invitation-provider-receipt' });
  };
  const delivery = createDebateDelivery(env, { fetcher, now: () => now });
  const input = { eventId: 'event-local-only', inviteId: 'invite-local-only', recipientEmail: 'approved@example.test', secret: code, expiresAt: now + 3600000 };
  const sealedInvitation = await delivery.sealInvitation(input), second = await delivery.sealInvitation(input);
  assert.notEqual(sealedInvitation, second); assert.ok(!sealedInvitation.includes(code)); assert.match(sealedInvitation, /^v1\./);
  const inviteDigest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))).toString('hex');
  const job = { id: 'invitation-local-job', eventId: input.eventId, createdAt: now, payload: { inviteId: input.inviteId, recipientEmail: input.recipientEmail,
    sealedInvitation, inviteDigest, expiresAt: input.expiresAt, eventTitle: 'Local test event', rehearsal: true } };
  assert.ok(!JSON.stringify(job).includes(code), 'Durable job contains encrypted secret only');
  for (const suppressed of [{ ...env, OUTBOUND_EMAIL_MODE: 'suppressed' }, { ...env, DEBATE_INVITATION_EMAIL_MODE: undefined }]) {
    await assert.rejects(createDebateDelivery(suppressed, { fetcher, now: () => now }).invitation_mail(job), { code: 'EMAIL_DISABLED' });
  }
  for (const patch of [{ recipientEmail: 'other@example.test' }, { inviteId: 'different-invite' }, { expiresAt: input.expiresAt + 1000 }, { inviteDigest: '0'.repeat(64) }, { sealedInvitation: sealedInvitation.replace(/^v1\./, 'v2.') }]) {
    await assert.rejects(delivery.invitation_mail({ ...job, payload: { ...job.payload, ...patch } }), { code: 'INVITATION_INVALID' });
  }
  await assert.rejects(createDebateDelivery({ ...env, DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS: '' }, { fetcher, now: () => now }).invitation_mail(job), { code: 'REHEARSAL_RECIPIENT_UNAPPROVED' });
  assert.equal(calls.length, 0);
  uncertain = true; await assert.rejects(delivery.invitation_mail(job), { code: 'EMAIL_ACCEPTANCE_UNCONFIRMED' });
  uncertain = false; const result = await delivery.invitation_mail(job);
  assert.deepEqual(result, { status: 'accepted', deliveryStatus: 'accepted_not_delivery_confirmed', providerId: 'invitation-provider-receipt' });
  assert.deepEqual(calls.map(item => item.key), ['debate-invitation/invitation-local-job', 'debate-invitation/invitation-local-job']);
  now = input.expiresAt; await assert.rejects(delivery.invitation_mail(job), { code: 'INVITATION_INVALID' }); assert.equal(calls.length, 2);
});

test('invitation HTTP preview and explicit send persist one encrypted recipient job; retries and revoked invitations cannot resend', async () => {
  const f = await fixture(), calls = [], recipientEmail = 'approved@example.test';
  const env = { ...baseEnv, DEBATE_ROOM_ENABLED: 'true', OUTBOUND_EMAIL_MODE: 'enabled', DEBATE_INVITATION_EMAIL_MODE: 'enabled',
    DEBATE_INVITATION_EMAIL_FROM: 'Debate <test@example.test>', RESEND_API_KEY: 'inert-test-key', DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS: recipientEmail };
  const fetcher = async (input, options) => { assert.equal(String(input), 'https://api.resend.com/emails'); const body = JSON.parse(options.body); assert.deepEqual(body.to, [recipientEmail]); calls.push(body); return Response.json({ id: `invitation-local-receipt-${calls.length}` }); };
  const integration = createDebateIntegration({ env, authenticate: async () => host, rpc: rpcBridge(f.store), fetcher });
  const invitation = (await f.command('create_invite', { role: 'observer', boundEmail: recipientEmail })).receipt.result;
  const action = async (command, payload, key) => ({ command, payload, eventId: f.eventId, expectedRevision: (await f.store.read(f.eventId)).revision, idempotencyKey: key });
  await bodyOf(await integration.handle(post('command', await action('send_invitation', { inviteId: invitation.inviteId, secret: invitation.secret, recipientEmail }, 'invite-missing-confirm'))), 400);
  assert.equal(calls.length, 0);
  const preview = await bodyOf(await integration.handle(post('command', await action('preview_invitation_mail', { inviteId: invitation.inviteId, recipientEmail }, 'invite-preview-local'))));
  assert.equal(preview.receipt.result.recipientEmail, recipientEmail); assert.equal(preview.receipt.result.role, 'observer'); assert.equal(calls.length, 0);
  const sendBody = await action('send_invitation', { inviteId: invitation.inviteId, recipientEmail, secret: invitation.secret, confirmed: true, previewConfirmed: true }, 'invite-send-local');
  const sent = await bodyOf(await integration.handle(post('command', sendBody))); const jobId = sent.receipt.result.jobId;
  assert.equal(calls.length, 1); assert.equal((await f.store.readJob(jobId)).result.providerId, 'invitation-local-receipt-1');
  assert.ok(!JSON.stringify(f.store.inspectForTests()).includes(invitation.secret), 'Stored jobs, snapshots and audit history contain no plaintext invitation secret');
  assert.ok(!JSON.stringify(sent).includes(invitation.secret));
  const duplicate = await bodyOf(await integration.handle(post('command', sendBody))); assert.equal(duplicate.receipt.result.jobId, jobId); assert.equal(calls.length, 1);
  const delivery = createDebateDelivery(env, { fetcher });
  const service = createDebateService({ store: f.store, adapters: delivery, limits: { approvedRehearsalRecipientEmails: [recipientEmail] } });
  const queued = await service.execute({ actor: host, ...await action('send_invitation', sendBody.payload, 'invite-delayed-local') });
  await f.command('revoke_invite', { inviteId: invitation.inviteId });
  await service.processOutbox({ eventId: f.eventId }); assert.equal(calls.length, 1);
  assert.equal((await f.store.readJob(queued.receipt.result.jobId)).status, 'failed');
});

test('export cleanup requires the exact event and source job and accepts idempotent empty storage responses', async () => {
  const f = storageFixture(), delivery = createDebateDelivery(baseEnv, f), storageKey = 'exports/event-local-only/source-job-local.pdf';
  f.objects.set(storageKey, new TextEncoder().encode('%PDF-local'));
  const job = { eventId: 'event-local-only', payload: { sourceJobId: 'source-job-local', storageKey } };
  await assert.rejects(delivery.delete_export({ ...job, eventId: 'another-event' }), { code: 'INVALID_FILE_KEY' });
  await assert.rejects(delivery.delete_export({ ...job, payload: { ...job.payload, sourceJobId: 'another-job' } }), { code: 'INVALID_FILE_KEY' }); assert.equal(f.calls.length, 0);
  assert.deepEqual(await delivery.delete_export(job), { status: 'deleted' }); assert.deepEqual(await delivery.delete_export(job), { status: 'deleted' }); assert.equal(f.objects.size, 0);
});

test('main Worker applies origin first, verifies the current account each request, and bypasses no billing guard', async () => {
  const oldFetch = globalThis.fetch; let unavailable = false, authCalls = 0, rpcCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://project.test');
    if (url.pathname === '/auth/v1/user') { authCalls++; return Response.json({ ...host, is_anonymous: false, ...(unavailable ? { deleted_at: new Date().toISOString() } : {}) }); }
    assert.equal(url.pathname, '/rest/v1/rpc/debate_v3_list'); assert.equal(JSON.parse(options.body).p_actor_id, host.id); rpcCalls++; return Response.json([]);
  };
  const env = { ...baseEnv, DEBATE_ROOM_ENABLED: 'true' };
  try {
    const wrongOrigin = new Request('https://worker.test/debate-room/events', { headers: { Origin: 'https://attacker.test', Authorization: 'Bearer local-session' } });
    assert.equal((await worker.fetch(wrongOrigin, env)).status, 403); assert.equal(authCalls, 0);
    const incoming = () => request('events', { headers: { Origin: baseEnv.ALLOWED_ORIGIN } });
    assert.equal((await worker.fetch(incoming(), env)).status, 200);
    assert.equal((await worker.fetch(incoming(), env)).status, 200); assert.equal(authCalls, 2); assert.equal(rpcCalls, 2);
    unavailable = true; assert.equal((await worker.fetch(incoming(), env)).status, 403); assert.equal(authCalls, 3); assert.equal(rpcCalls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test('minute scheduler is separately gated, held by waitUntil, and calls only the Debate scheduler RPC', async () => {
  const oldFetch = globalThis.fetch, calls = [], pending = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input)); calls.push(url.pathname); assert.equal(url.origin, 'https://project.test');
    assert.equal(url.pathname, '/rest/v1/rpc/debate_v3_active_events'); assert.equal(JSON.parse(options.body).p_limit, 20);
    return Response.json({ eventIds: [], nextCursor: null });
  };
  try {
    assert.deepEqual(await worker.scheduled({ cron: '* * * * *' }, baseEnv), { disabled: true }); assert.equal(calls.length, 0);
    worker.scheduled({ cron: '* * * * *' }, { ...baseEnv, DEBATE_SWEEPER_ENABLED: 'true' }, { waitUntil: p => pending.push(p) });
    assert.equal(pending.length, 1); const result = await pending[0]; assert.equal(result.backlog, false); assert.equal(calls.length, 1);
    const configuration = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
    assert.match(configuration, /crons\s*=\s*\["\*\/2 \* \* \* \*", "\* \* \* \* \*"\]/);
  } finally { globalThis.fetch = oldFetch; }
});
