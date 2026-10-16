import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clockRequestFacts, clockResponseFacts, recordClockDiagnostic,
  recordClockRequest, recordClockResponse } from './debate-clock-diagnostics.mjs';
import { createTimer, claimTimerLease, renewTimerLease, applyTimerCommand } from '../worker/debate-domain.mjs';

const secret = 'PRIVATE_SENTINEL';
const digest = value => createHash('sha256').update(value).digest('hex');
const input = { command: 'renew_clock', eventId: 'inert-event', expectedRevision: 4, idempotencyKey: secret,
  payload: { matchId: 'inert-match', timerVersion: 7, text: secret } };
// Actor-facing snapshots contain an array; the internal persisted map does not
// represent the data actually observed by either browser or HTTP harness.
const event = { id: input.eventId, revision: 4, matches: [{ id: input.payload.matchId, motion: secret,
  timer: { version: 7, state: 'RUNNING', startedAtServerMs: 100, elapsedBeforeRunMs: 0,
    leaseExpiresAtServerMs: 30100, controllerId: secret, stageAttemptId: secret } }] };
const observation = (requestId, requestedAt) => ({ requestId, requestedAt, actorId: secret,
  eventId: input.eventId, matchId: input.payload.matchId, private: secret });
const noPrivateData = value => assert.ok(!JSON.stringify(value).includes(secret));

test('clock diagnostics correlate an exact retry without retaining private keys or payloads', () => {
  const first = clockRequestFacts({ input, event, ...observation(1, 1000) });
  const retry = clockRequestFacts({ input: structuredClone(input), event, ...observation(2, 6000) });
  assert.equal(first.idempotencyKeySha256, digest(secret));
  assert.equal(first.idempotencyKeySha256, retry.idempotencyKeySha256);
  assert.equal(first.actorSha256, digest(secret));
  assert.equal(first.eventSha256, digest(event.id));
  assert.equal(first.matchSha256, digest(input.payload.matchId));
  assert.deepEqual(first.before, { revision: 4, version: 7, state: 'RUNNING', startedAtServerMs: 100,
    elapsedBeforeRunMs: 0, leaseExpiresAtServerMs: 30100,
    stageAttemptSha256: digest(secret), controllerSha256: digest(secret) });
  const failed = clockResponseFacts({ request: first, matchId: input.payload.matchId, status: 503, receivedAt: 6351,
    body: { ok: false, error: { code: 'STORE_UNAVAILABLE', message: secret }, private: secret } });
  assert.equal(failed.latencyMs, 5351); assert.equal(failed.errorCode, 'STORE_UNAVAILABLE');
  assert.equal(failed.outcome, 'RESPONSE'); assert.equal(failed.after, null);
  const recovered = clockResponseFacts({ request: retry, matchId: input.payload.matchId, status: 200, receivedAt: 6500,
    body: { ok: true, event, receipt: { id: secret, committedAt: 1000, result: secret } } });
  assert.equal(recovered.committedAt, 1000); assert.equal(recovered.after.startedAtServerMs, 100);
  assert.equal(recovered.receiptSha256, digest(secret));
  noPrivateData([first, retry, failed, recovered]);
});

test('actual clock commands and timer actions are recognized without classifying unrelated commands', () => {
  for (const command of ['claim_clock', 'renew_clock', 'timer', 'finish_stage', 'next_stage', 'return_stage']) {
    const facts = clockRequestFacts({ input: { ...input, command }, event });
    assert.equal(facts.command, command); assert.equal(facts.timerAction, null);
  }
  for (const type of ['START', 'PAUSE', 'TECHNICAL_PAUSE', 'RESUME', 'FINISH', 'RESET', 'SET_DURATION', 'EDIT_DURATION']) {
    const facts = clockRequestFacts({ input: { ...input, command: 'timer', payload: { ...input.payload, type: type.toLowerCase() } }, event });
    assert.equal(facts.command, 'timer'); assert.equal(facts.timerAction, type);
  }
  for (const command of [undefined, secret, 'start_clock', 'pause_clock', 'send_message', 'save_draft'])
    assert.equal(clockRequestFacts({ input: { ...input, command }, event }), null);
  const unknown = clockRequestFacts({ input: { ...input, command: 'timer', payload: { ...input.payload, type: secret } }, event });
  assert.equal(unknown.timerAction, null); noPrivateData(unknown);
});

test('diagnostics retain actual domain rejection codes without copying exception details', () => {
  const ready = createTimer({ matchId: 'inert-match', stageAttemptId: 'inert-attempt', durationMs: 60000 }, 0);
  const claimed = claimTimerLease(ready, { actorId: 'inert-controller', expectedVersion: 1, authorized: true }, 100);
  const running = applyTimerCommand(claimed, { actorId: 'inert-controller', expectedVersion: 2, type: 'START' }, 200);
  const command = { actorId: 'inert-controller', expectedVersion: running.version };
  const failures = [
    ['STALE_VERSION', () => renewTimerLease(running, { ...command, expectedVersion: 1 }, 250)],
    ['CONTROLLER_REQUIRED', () => claimTimerLease(ready, { ...command, expectedVersion: 1, authorized: false }, 250)],
    ['CONTROLLER_LEASE_ACTIVE', () => claimTimerLease(running, { ...command, actorId: 'inert-other', authorized: true }, 250)],
    ['CONTROLLER_LEASE_REQUIRED', () => renewTimerLease(running, command, 30100)],
    ['INVALID_TIMER', () => renewTimerLease({ ...running, state: secret }, command, 250)],
    ['INVALID_TIMER_TRANSITION', () => applyTimerCommand(running, { ...command, type: 'START' }, 250)],
    ['UNKNOWN_TIMER_COMMAND', () => applyTimerCommand(running, { ...command, type: secret }, 250)],
    ['CONFIRMATION_REQUIRED', () => applyTimerCommand(running, { ...command, type: 'RESET', confirmed: false }, 250)],
  ];
  const request = clockRequestFacts({ input, event, ...observation(1, 1000) });
  for (const [expectedCode, reject] of failures) {
    assert.throws(reject, error => {
      assert.equal(error.code, expectedCode);
      const facts = clockResponseFacts({ request, status: 409, receivedAt: 2000,
        body: { ok: false, error: { code: error.code, message: secret, details: secret } } });
      assert.equal(facts.errorCode, expectedCode); assert.equal(facts.ok, false); noPrivateData(facts);
      return true;
    });
  }
});

test('foreign events, missing event identities and absent matches never produce timer evidence', () => {
  for (const foreign of [{ ...event, id: 'different-event' }, { ...event, matches: [] },
    { ...event, matches: { [input.payload.matchId]: event.matches[0] } }]) {
    assert.equal(clockRequestFacts({ input, event: foreign }).before, null);
    const request = clockRequestFacts({ input, event });
    assert.equal(clockResponseFacts({ request, body: { event: foreign }, matchId: input.payload.matchId }).after, null);
  }
  const request = clockRequestFacts({ input, event });
  const anotherMatch = { ...event.matches[0], id: 'inert-other-match' };
  assert.equal(clockResponseFacts({ request, body: { event: { ...event, matches: [...event.matches, anotherMatch] } },
    matchId: anotherMatch.id }).after, null, 'A real timer from another match cannot satisfy this request');
  for (const id of [undefined, null, '', secret.repeat(301)]) {
    const unidentifiedInput = { ...input, eventId: id }, unidentifiedEvent = { ...event, id };
    const request = clockRequestFacts({ input: unidentifiedInput, event: unidentifiedEvent });
    assert.equal(request.eventSha256, null);
    assert.equal(request.before, null, 'An absent or invalid identity cannot establish a before snapshot');
    assert.equal(clockResponseFacts({ request, body: { event: unidentifiedEvent }, matchId: input.payload.matchId }).after,
      null, 'Two absent hashes are not proof that a response belongs to the requested event');
  }
});

test('unknown response fields and invalid scalar values are reduced to bounded classifications', () => {
  const request = clockRequestFacts({ input, event, ...observation(1, 1000) });
  for (const body of [null, { error: { code: secret, message: secret }, private: secret,
    event: { id: event.id, revision: secret, matches: [{ id: input.payload.matchId, private: secret,
      timer: { state: secret, version: -1, startedAtServerMs: 1.5, elapsedBeforeRunMs: Number.MAX_SAFE_INTEGER + 1,
        leaseExpiresAtServerMs: secret, controllerId: secret.repeat(301), stageAttemptId: secret.repeat(301) } }] },
    ok: secret, receipt: { id: secret.repeat(301), committedAt: secret, result: secret } }]) {
    const facts = clockResponseFacts({ request, matchId: input.payload.matchId, status: 502, receivedAt: 2000, body });
    noPrivateData(facts); assert.equal(facts.errorCode, body ? 'OTHER_ERROR' : null);
    assert.equal(facts.outcome, body ? 'RESPONSE' : 'UNREADABLE_RESPONSE');
    assert.equal(facts.ok, null); assert.equal(facts.receiptSha256, null); assert.equal(facts.committedAt, null);
    if (body) assert.ok(Object.values(facts.after).every(value => value === null));
  }
  for (const status of [-1, 0, 200.5, 600, secret])
    assert.equal(clockResponseFacts({ request, status, receivedAt: 2000 }).status, null);
  assert.equal(clockResponseFacts({ request, status: 200, receivedAt: 999 }).latencyMs, null);
  const malformed = clockRequestFacts({ input: { ...input, expectedRevision: -1, idempotencyKey: 'x'.repeat(129),
    payload: { ...input.payload, timerVersion: 1.5 } }, requestId: -1, requestedAt: secret });
  for (const name of ['expectedRevision', 'idempotencyKeySha256', 'timerVersion', 'requestId', 'requestedAt'])
    assert.equal(malformed[name], null);
});

test('request recording exists before a response and completes the same entry on an exact retry', () => {
  const report = {}, first = observation(1, 1000);
  recordClockRequest(report, first, input, event);
  assert.equal(report.clockDiagnostics.length, 1);
  assert.strictEqual(report.clockDiagnostics[0], first.clockDiagnostic);
  assert.equal(first.clockDiagnostic.response, null); assert.equal(first.clockDiagnostic.transportFailure, null);
  recordClockResponse(first, { status: 503, receivedAt: 6351,
    body: { ok: false, error: { code: 'STORE_UNAVAILABLE', message: secret } } });
  assert.equal(report.clockDiagnostics[0].response.latencyMs, 5351);
  assert.equal(report.clockDiagnostics[0].response.errorCode, 'STORE_UNAVAILABLE');
  const retry = observation(2, 6500), renewed = structuredClone(event);
  renewed.revision++; renewed.matches[0].timer.version++; renewed.matches[0].timer.leaseExpiresAtServerMs = 31000;
  recordClockRequest(report, retry, structuredClone(input), event);
  recordClockResponse(retry, { status: 200, receivedAt: 6700,
    body: { ok: true, event: renewed, receipt: { id: secret, committedAt: 1000, result: secret } } });
  assert.equal(report.clockDiagnostics.length, 2);
  assert.equal(report.clockDiagnostics[0].idempotencyKeySha256, report.clockDiagnostics[1].idempotencyKeySha256);
  assert.equal(report.clockDiagnostics[0].response.status, 503);
  assert.equal(report.clockDiagnostics[1].response.committedAt, 1000);
  assert.equal(report.clockDiagnostics[1].response.after.version, 8);
  assert.equal(report.clockDiagnostics[1].response.after.startedAtServerMs, 100);
  assert.equal(report.clockDiagnostics[1].response.latencyMs, 200);
  assert.equal(report.clockDiagnostics[1].transportFailure, null);
  noPrivateData(report);
});

test('transport failure, an unreadable response and a response lost entirely retain separate evidence', () => {
  const report = {}, failed = observation(1, 1000), lost = observation(2, 2000);
  recordClockRequest(report, failed, input, event);
  recordClockResponse(failed, { status: 200, body: null, receivedAt: 1200 });
  recordClockResponse(failed, { receivedAt: 1300, transportFailed: true, error: { message: secret }, url: secret });
  assert.equal(failed.clockDiagnostic.response.outcome, 'UNREADABLE_RESPONSE');
  assert.equal(failed.clockDiagnostic.response.status, 200);
  assert.equal(failed.clockDiagnostic.transportFailure.outcome, 'TRANSPORT_FAILED');
  assert.equal(failed.clockDiagnostic.transportFailure.status, null);
  assert.equal(failed.clockDiagnostic.transportFailure.latencyMs, 300);
  recordClockRequest(report, lost, input, event);
  assert.equal(report.clockDiagnostics[1].requestId, 2);
  assert.equal(report.clockDiagnostics[1].response, null);
  assert.equal(report.clockDiagnostics[1].transportFailure, null);
  const unrelated = observation(3, 3000);
  recordClockRequest(report, unrelated, { ...input, command: 'send_message' }, event);
  recordClockResponse(unrelated, { status: 200, receivedAt: 3100, body: { private: secret } });
  recordClockResponse(undefined, { transportFailed: true });
  assert.equal(unrelated.clockDiagnostic, undefined); assert.equal(report.clockDiagnostics.length, 2);
  noPrivateData(report);
});

test('diagnostic storage is bounded, counts evictions and rejects invalid retention limits', () => {
  const report = {};
  for (let requestId = 1; requestId <= 5; requestId++) recordClockDiagnostic(report, { requestId }, 3);
  assert.deepEqual(report.clockDiagnostics.map(v => v.requestId), [3, 4, 5]);
  assert.equal(report.clockDiagnosticsDropped, 2);
  for (const limit of [-1, 0, 1.5, 2049, Infinity])
    assert.throws(() => recordClockDiagnostic(report, {}, limit), /CLOCK_DIAGNOSTIC_LIMIT/);
  assert.deepEqual(report.clockDiagnostics.map(value => value.requestId), [3, 4, 5]);
});

test('a late response to an evicted request cannot change retained entries or grow the ring', () => {
  const report = {}, evicted = observation(1, 1000);
  recordClockRequest(report, evicted, input, event);
  for (let requestId = 2; requestId <= 2050; requestId++)
    recordClockRequest(report, observation(requestId, 1000 + requestId), input, event);
  assert.equal(report.clockDiagnostics.length, 2048); assert.equal(report.clockDiagnosticsDropped, 2);
  assert.equal(report.clockDiagnostics[0].requestId, 3); assert.equal(report.clockDiagnostics.at(-1).requestId, 2050);
  const retained = structuredClone(report);
  recordClockResponse(evicted, { status: 503, receivedAt: 4000,
    body: { error: { code: 'STORE_UNAVAILABLE', message: secret } } });
  assert.equal(evicted.clockDiagnostic.response.status, 503);
  assert.deepEqual(report, retained); noPrivateData(report);
});
