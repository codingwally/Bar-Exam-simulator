import assert from 'node:assert/strict';
import test from 'node:test';
import { countPhysicalEpochs, createMediaCapacityStore } from './media-capacity.mjs';

const projectId = 'p_capacitytest01', coordinatorId = '00000000-0000-4000-8000-000000000001';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { issuerId: 'production', product: 'study' };
const subject = { actorId: id(4), logicalSessionId: id(5) };
const input = () => ({ commandId: id(2), policyRevision: 1, epochId: id(3), ...subject, scopeKey: 'study-room-1', reservedSeconds: 600, reservedBytes: 1000000 });
const reservation = () => ({ project_id: projectId, epoch_id: id(3), actor_id: id(4), issuer_id: 'production', product: 'study', logical_session_id: id(5), event_key: 'study-event-1', session_key: 'study-session-1', identity: `mc-${id(3)}`, scope_key: 'study-room-1', room_name: 'study-room-1', state: 'reserved', version: 1, reserved_seconds: 600, reserved_bytes: 1000000, created_at_ms: 1000, budget_deadline_ms: 601000 });
const logicalSession = () => ({ project_id: projectId, logical_session_id: id(5), issuer_id: 'production', actor_id: id(4), product: 'study', event_key: 'study-event-1', session_key: 'study-session-1', state: 'open', version: 1, created_at_ms: 1000, funded_deadline_ms: 601000, allocated_seconds: 600, last_epoch_id: id(3) });
const response = row => ({ ok: true, projectId, coordinatorId, enabled: false, policyRevision: 1, replayed: false, reservation: row, logicalSession: logicalSession() });

test('every physical unreleased epoch counts despite expiry, uncertainty or repeated actor', () => {
  const rows = ['reserved','issued','connected','uncertain','revoking','released'].map((state, i) => ({ epoch_id: id(i + 10), actor_id: id(1), state, token_expires_at_ms: 1 }));
  assert.equal(countPhysicalEpochs(rows), 5);
  assert.throws(() => countPhysicalEpochs([...rows, rows[0]]), /STATE_INVALID/);
  assert.throws(() => countPhysicalEpochs([{ epoch_id: id(20), state: 'expired' }]), /STATE_INVALID/);
});

test('store sends only exact server-pinned project/coordinator and preserves disabled policy', async () => {
  const calls = [], store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async (...args) => { calls.push(args); return response(reservation()); } });
  const result = await store.reserve(input());
  assert.equal(result.enabled, false); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['media_capacity_command', { p_command: { operation: 'reserve', projectId, coordinatorId, ...binding, ...input() } }]);
  await assert.rejects(store.reserve({ ...input(), projectId: 'p_foreign0001' }), /INPUT/);
  await assert.rejects(store.reserve({ ...input(), reservedSeconds: 0 }), /INPUT/);
  await assert.rejects(store.reserve({ ...input(), reservedBytes: Number.MAX_SAFE_INTEGER + 1 }), /INPUT/);
  assert.equal(calls.length, 1);
});

test('parallel identical commands share one request and conflicting payloads cannot reuse its id', async () => {
  let resolve, count = 0;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: () => { count++; return new Promise(r => { resolve = r; }); } });
  const first = store.reserve(input()), second = store.reserve(input());
  await assert.rejects(store.reserve({ ...input(), reservedSeconds: 700 }), /IDEMPOTENCY_CONFLICT/);
  resolve(response(reservation()));
  assert.deepEqual(await first, await second); assert.equal(count, 1);
});

test('lost mutating response is held without retry; read-only reconciliation remains possible', async () => {
  let count = 0;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async (_name, { p_command: command }) => {
    count++; if (command.operation !== 'read') throw new Error('raw private transport content');
    return response(reservation());
  } });
  await assert.rejects(store.reserve(input()), error => error.code === 'MEDIA_CAPACITY_OUTCOME_UNKNOWN' && !error.message.includes('private'));
  await assert.rejects(store.reserve(input()), /OUTCOME_UNKNOWN/); assert.equal(count, 1);
  assert.deepEqual(store.unresolvedCommands(), [input().commandId]);
  assert.equal((await store.read({ epochId: id(3), ...subject })).reservation.epoch_id, id(3));
  assert.equal(count, 2); assert.equal(store.unresolvedCommands().length, 1, 'Readback alone does not silently clear uncertainty');
});

test('wrong project, identity, coordinator or partial responses never produce a usable reservation', async () => {
  for (const changed of [r => { r.projectId = 'p_foreign0001'; }, r => { r.coordinatorId = id(99); },
    r => { r.reservation.identity = `mc-${id(99)}`; }, r => { r.reservation.epoch_id = id(99); },
    r => { r.debugToken = 'unwanted'; }, r => { r.reservation.debugToken = 'unwanted'; }, r => { r.reservation.release_proof = { rawResponse: 'unwanted' }; }, r => { r.reservation = null; }]) {
    const value = response(reservation()); changed(value);
    const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => value });
    await assert.rejects(store.reserve(input()), /RESPONSE_INVALID/);
    assert.deepEqual(store.unresolvedCommands(), [input().commandId]);
  }
});

test('acknowledged SQL rejection is surfaced distinctly from an unknown mutation', async () => {
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => ({ ok: false, error: { code: 'MEDIA_CAPACITY_PROJECT_LIMIT' } }) });
  await assert.rejects(store.reserve(input()), /PROJECT_LIMIT/);
  assert.deepEqual(store.unresolvedCommands(), []);
});

test('release proof must bind exact epoch/project/room, positive revocation and subsequent absence', async () => {
  let calls = 0;
  const row = reservation(); row.state = 'released'; row.version = 3;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => { calls++; return response(row); } });
  const proof = { releaseCommandId: id(21), projectId, roomName: row.room_name, identity: row.identity, revocationAcknowledged: true, absent: true, cutoffSeconds: 10, acknowledgedAtMs: 10000, observedAtMs: 11000 };
  const command = { commandId: id(22), policyRevision: 1, epochId: row.epoch_id, ...subject, expectedVersion: 2, proof };
  for (const bad of [{ ...proof, absent: false }, { ...proof, revocationAcknowledged: false }, { ...proof, identity: `mc-${id(99)}` }, { ...proof, projectId: 'p_foreign0001' }, { ...proof, observedAtMs: 9999 }, { ...proof, rawResponse: 'no' }]) {
    await assert.rejects(store.confirmReleased({ ...command, proof: bad }), /FENCE_UNCONFIRMED/);
  }
  assert.equal(calls, 0);
  assert.equal((await store.confirmReleased(command)).reservation.state, 'released');
  assert.equal(calls, 1);
});

test('issuer and product are server bindings and cannot be selected by individual commands', async () => {
  for (const bad of [{}, { issuerId: 'unknown', product: 'study' }, { issuerId: 'production', product: 'other' }]) {
    assert.throws(() => createMediaCapacityStore({ projectId, coordinatorId, rpc: async () => {}, ...bad }), /CONFIGURATION/);
  }
  let calls = 0;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => { calls++; return response(reservation()); } });
  for (const extra of [{ issuerId: 'staging' }, { product: 'debate' }, { fundedDeadlineMs: 999999 }, { logicalSessionId: 'not-a-uuid' }]) {
    await assert.rejects(store.reserve({ ...input(), ...extra }), /INPUT/);
  }
  assert.equal(calls, 0);
});

test('every response must match exact logical issuer, account, product and immutable funded interval', async () => {
  const mutations = [
    r => { r.logicalSession.issuer_id = 'staging'; }, r => { r.reservation.issuer_id = 'staging'; },
    r => { r.logicalSession.actor_id = id(99); }, r => { r.reservation.actor_id = id(99); },
    r => { r.logicalSession.product = 'debate'; }, r => { r.reservation.product = 'debate'; },
    r => { r.logicalSession.logical_session_id = id(99); }, r => { r.reservation.logical_session_id = id(99); },
    r => { r.logicalSession.funded_deadline_ms += 1000; }, r => { r.reservation.budget_deadline_ms += 1000; },
    r => { r.logicalSession.event_key = 'other-event'; }, r => { r.logicalSession.session_key = 'other-session'; },
    r => { r.logicalSession.allocated_seconds += 1; }, r => { r.logicalSession.rawProviderResponse = 'forbidden'; },
    r => { r.logicalSession = null; }, r => { delete r.logicalSession; },
  ];
  for (const change of mutations) {
    const value = response(reservation()); change(value);
    const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => value });
    await assert.rejects(store.reserve(input()), /RESPONSE_INVALID/);
    assert.deepEqual(store.unresolvedCommands(), [input().commandId]);
  }
});

test('scoped read may inspect a retired predecessor without presenting it as the current epoch', async () => {
  const value = response(reservation()); value.reservation.state = 'released';
  value.logicalSession.last_epoch_id = id(6); value.logicalSession.version = 2;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async () => value });
  const saved = await store.read({ epochId: id(3), ...subject });
  assert.equal(saved.reservation.state, 'released');
  assert.equal(saved.logicalSession.last_epoch_id, id(6));
  assert.equal(saved.logicalSession.funded_deadline_ms, 601000);
  assert.equal(saved.reservation.budget_deadline_ms, 601000);
});

test('lost logical close cannot silently replay or release uncertainty through a read', async () => {
  let writes = 0;
  const store = createMediaCapacityStore({ projectId, coordinatorId, ...binding, rpc: async (_name, { p_command }) => {
    if (p_command.operation === 'close_session') { writes++; throw new Error('inert lost response'); }
    const value = response(reservation()); value.reservation.state = 'released'; value.logicalSession.state = 'closed'; return value;
  } });
  const close = { commandId: id(80), policyRevision: 1, epochId: id(3), ...subject, expectedVersion: 3 };
  await assert.rejects(store.closeSession(close), /OUTCOME_UNKNOWN/);
  assert.equal((await store.read({ epochId: id(3), ...subject })).logicalSession.state, 'closed');
  await assert.rejects(store.closeSession(close), /OUTCOME_UNKNOWN/);
  assert.equal(writes, 1); assert.deepEqual(store.unresolvedCommands(), [id(80)]);
});
