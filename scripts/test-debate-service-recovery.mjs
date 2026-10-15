/** Local fault injection only: real service/RPC adapter, synthetic memory persistence and time. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from '../worker/debate-service.mjs';
import { createDebateStore, createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';
import { timerDisplay } from '../worker/debate-domain.mjs';

const host = { id: 'recovery-host', displayName: 'Synthetic official', email: 'host@example.test', verified: true };
const person = n => ({ id: `recovery-member-${n}`, displayName: `Synthetic member ${n}`, email: `member-${n}@example.test`, verified: true });
const timekeeper = person(7);

async function runningClock() {
  let time = 1800000000000, sequence = 0, eventId, matchId, fault = null, failFinalRead = false;
  const memory = createMemoryDebateStoreForTests();
  const renewalAttempts = [], renewalReceipts = [];
  const store = createDebateStore({ rpc: async (name, args) => {
    if (name === 'debate_v3_receipt') return memory.receipt(args.p_request);
    if (name === 'debate_v3_rate_limit') return memory.rateLimit(args.p_actor_id, args.p_action, args.p_now, args.p_limit, args.p_window_ms);
    if (name === 'debate_v3_read') {
      if (failFinalRead) { failFinalRead = false; throw new Error('Synthetic final-read failure'); }
      return memory.read(args.p_event_id);
    }
    if (name === 'debate_v3_commit') {
      const request = args.p_request;
      if (request.command !== 'renew_clock') return memory.commit(request);
      renewalAttempts.push(structuredClone(request));
      const currentFault = fault; fault = null;
      if (currentFault === 'before-commit') throw new Error('Synthetic pre-commit failure');
      const receipt = await memory.commit(request);
      renewalReceipts.push(structuredClone(receipt));
      if (currentFault === 'commit-response') throw new Error('Synthetic lost commit response');
      if (currentFault === 'final-read') failFinalRead = true;
      return receipt;
    }
    throw new Error(`Unexpected local test RPC: ${name}`);
  } });
  const service = createDebateService({ store, now: () => time });
  async function envelope(command, payload = {}, actor = host) {
    const event = eventId ? await memory.read(eventId) : null;
    return { actor, eventId, command, payload, expectedRevision: event?.revision || 0, idempotencyKey: `recovery-${String(++sequence).padStart(8, '0')}` };
  }
  async function command(name, payload = {}, actor = host) {
    const result = await service.execute(await envelope(name, payload, actor));
    eventId ||= result.event.id;
    return result;
  }
  const saved = () => memory.read(eventId);
  async function clockCommand(name, payload = {}, actor = host) {
    const timer = (await saved()).matches[matchId].timer;
    return command(name, { matchId, timerVersion: timer.version, ...payload }, actor);
  }

  await command('create_event', { title: 'Synthetic clock recovery', rehearsal: true });
  for (let n = 1; n <= 7; n++) {
    const invite = await command('create_invite', { role: n === 7 ? 'observer' : 'debater', boundAccountId: person(n).id });
    await command('claim_invite', { secret: invite.receipt.result.secret }, person(n));
    await command('check_in', {}, person(n));
    await command('admit_member', { memberId: person(n).id });
  }
  const affirmative = await command('confirm_roster', { name: 'Synthetic affirmative', speakerIds: [1, 2, 3].map(n => person(n).id), captainId: person(1).id });
  const negative = await command('confirm_roster', { name: 'Synthetic negative', speakerIds: [4, 5, 6].map(n => person(n).id), captainId: person(4).id });
  const motion = await command('add_motion', { text: 'This house would publish open learning materials.' });
  const match = await command('create_match', { motionId: motion.receipt.result.motionId,
    teamIds: { affirmative: affirmative.receipt.result.teamId, negative: negative.receipt.result.teamId }, judgeIds: [host.id], timekeeperId: timekeeper.id });
  matchId = match.receipt.result.matchId;
  for (const n of [1, 4]) await command('acknowledge_rules', { matchId, ruleVersion: 1 }, person(n));
  for (let n = 1; n <= 6; n++) await command('record_device_check', { matchId, microphone: false, camera: false,
    memberId: person(n).id, accommodation: 'Synthetic service test only; no physical devices or media are connected.' });
  for (let n = 1; n <= 6; n++) await command('check_in', { matchId }, person(n));
  await command('start_match', { matchId });
  await clockCommand('claim_clock');
  await clockCommand('timer', { type: 'START' });
  time += 10000;
  return { service, store, memory, saved, command, clockCommand, envelope, renewalAttempts, renewalReceipts,
    matchId, now: () => time, advance: ms => { time += ms; }, arm: mode => { fault = mode; } };
}

function assertRunningAttemptPreserved(env, before, after) {
  const original = before.matches[env.matchId], current = after.matches[env.matchId];
  for (const key of ['state', 'startedAtServerMs', 'elapsedBeforeRunMs', 'durationMs', 'stageAttemptId']) {
    assert.equal(current.timer[key], original.timer[key], `Recovery preserves timer ${key}`);
  }
  assert.equal(current.timer.state, 'RUNNING');
  assert.equal(current.currentStageIndex, original.currentStageIndex);
  assert.equal(current.phase, original.phase);
  assert.deepEqual(current.attempts, original.attempts, 'Recovery does not create, reset or edit a stage attempt');
  assert.deepEqual(current.runOfShow, original.runOfShow);
  const display = timerDisplay(current.timer, env.now());
  assert.equal(display.elapsedMs, original.timer.elapsedBeforeRunMs + env.now() - original.timer.startedAtServerMs);
  assert.equal(display.remainingMs, original.timer.durationMs - display.elapsedMs);
}

function renewalHistory(env) {
  return env.memory.inspectForTests().history.filter(entry => entry.audit.command === 'renew_clock');
}

for (const mode of ['before-commit', 'commit-response', 'final-read']) {
  test(`${mode}: identical renewal recovers one receipt and effect without resetting the running stage`, async () => {
    const env = await runningClock(), before = await env.saved(), beforeTimer = before.matches[env.matchId].timer;
    const input = await env.envelope('renew_clock', { matchId: env.matchId, timerVersion: beforeTimer.version });
    const unchangedInput = structuredClone(input), firstAttemptAt = env.now();
    env.arm(mode);
    await assert.rejects(env.service.execute(input), { code: 'STORE_UNAVAILABLE' });
    const afterFailure = await env.saved(), alreadyCommitted = mode !== 'before-commit';
    assert.equal(afterFailure.revision, before.revision + Number(alreadyCommitted));
    assert.equal(afterFailure.matches[env.matchId].timer.version, beforeTimer.version + Number(alreadyCommitted));
    assert.equal(renewalHistory(env).length, Number(alreadyCommitted));
    if (!alreadyCommitted) assert.deepEqual(afterFailure, before, 'A pre-commit failure has no durable effect');
    const receiptQuery = env.renewalAttempts[0];
    const savedReceipt = await env.store.receipt(receiptQuery);
    assert.deepEqual(savedReceipt, alreadyCommitted ? env.renewalReceipts[0] : null);

    // A failed pre-commit action must still hold the lease when it is first applied.
    // A committed action must remain recoverable even after its lease has expired.
    env.advance(alreadyCommitted ? 35000 : 5000);
    const appliedAt = alreadyCommitted ? firstAttemptAt : env.now();
    if (alreadyCommitted) assert.ok(env.now() > afterFailure.matches[env.matchId].timer.leaseExpiresAtServerMs);
    const recovered = await env.service.execute(input);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.receipt.committedAt, appliedAt);
    assert.equal(recovered.receipt.revision, before.revision + 1);
    assert.deepEqual(recovered.receipt, env.renewalReceipts[0]);
    assert.deepEqual(recovered.receipt, await env.store.receipt(receiptQuery));
    if (alreadyCommitted) assert.deepEqual(recovered.receipt, savedReceipt, 'A delayed retry returns the original receipt');
    const recoveredState = await env.saved();
    assert.equal(recoveredState.revision, before.revision + 1);
    assert.equal(recoveredState.matches[env.matchId].timer.version, beforeTimer.version + 1);
    assert.equal(recoveredState.matches[env.matchId].timer.leaseExpiresAtServerMs, appliedAt + 30000);
    assertRunningAttemptPreserved(env, before, recoveredState);
    assert.equal(renewalHistory(env).length, 1);
    assert.equal(env.renewalReceipts.length, 1);
    assert.equal(env.renewalAttempts.length, alreadyCommitted ? 1 : 2);

    env.advance(1000);
    const replay = await env.service.execute(input);
    assert.deepEqual(replay.receipt, recovered.receipt);
    assert.deepEqual(await env.saved(), recoveredState, 'Repeated receipt recovery cannot extend the lease again');
    assertRunningAttemptPreserved(env, before, await env.saved());
    assert.equal(renewalHistory(env).length, 1);
    assert.deepEqual(input, unchangedInput, 'The caller reuses the entire original envelope');
  });
}

test('an uncommitted renewal cannot revive an expired controller; elapsed time continues until an explicit claim', async () => {
  const env = await runningClock(), before = await env.saved(), timer = before.matches[env.matchId].timer;
  const input = await env.envelope('renew_clock', { matchId: env.matchId, timerVersion: timer.version });
  env.arm('before-commit');
  await assert.rejects(env.service.execute(input), { code: 'STORE_UNAVAILABLE' });
  env.advance(timer.durationMs + 1000);
  await assert.rejects(env.service.execute(input), { code: 'CONTROLLER_LEASE_REQUIRED' });
  for (const [name, payload] of [['renew_clock', {}], ['timer', { type: 'PAUSE' }], ['finish_stage', {}]]) {
    await assert.rejects(env.clockCommand(name, payload), { code: 'CONTROLLER_LEASE_REQUIRED' });
  }
  assert.deepEqual(await env.saved(), before);
  assertRunningAttemptPreserved(env, before, await env.saved());
  assert.equal(timerDisplay((await env.saved()).matches[env.matchId].timer, env.now()).overtime, true, 'Loss of the lease does not stop the clock or automatically advance the stage');
  assert.equal(await env.store.receipt(env.renewalAttempts[0]), null);
  assert.equal(renewalHistory(env).length, 0);
  const claim = await env.clockCommand('claim_clock', {}, timekeeper);
  assert.equal(claim.receipt.result.timer.controllerId, timekeeper.id);
  assertRunningAttemptPreserved(env, before, await env.saved());
});

test('a lost renewal receipt can be recovered after takeover without restoring the previous controller', async () => {
  const env = await runningClock(), before = await env.saved(), timer = before.matches[env.matchId].timer;
  const input = await env.envelope('renew_clock', { matchId: env.matchId, timerVersion: timer.version });
  env.arm('commit-response');
  await assert.rejects(env.service.execute(input), { code: 'STORE_UNAVAILABLE' });
  const originalReceipt = env.renewalReceipts[0];
  env.advance(1000);
  await assert.rejects(env.clockCommand('claim_clock', {}, timekeeper), { code: 'CONTROLLER_LEASE_ACTIVE' });
  await env.clockCommand('claim_clock', { takeover: true, reason: 'Explicit synthetic controller handoff.' }, timekeeper);
  const afterTakeover = await env.saved();
  assert.equal(afterTakeover.matches[env.matchId].timer.controllerId, timekeeper.id);
  const recovered = await env.service.execute(input);
  assert.deepEqual(recovered.receipt, originalReceipt);
  assert.equal(recovered.event.revision, afterTakeover.revision, 'Recovery returns current state with the historical receipt');
  assert.equal(recovered.event.matches.find(match => match.id === env.matchId).timer.controllerId, timekeeper.id);
  assert.deepEqual(await env.saved(), afterTakeover, 'Receipt lookup cannot undo a controller handoff');
  for (const [name, payload] of [['renew_clock', {}], ['timer', { type: 'PAUSE' }], ['finish_stage', {}]]) {
    await assert.rejects(env.clockCommand(name, payload), { code: 'CONTROLLER_LEASE_REQUIRED' });
  }
  assert.deepEqual(await env.saved(), afterTakeover, 'The previous controller is denied even with the current revision and timer version');
  assertRunningAttemptPreserved(env, before, afterTakeover);
  assert.equal(renewalHistory(env).length, 1);
  assert.equal(env.renewalAttempts.length, 1);
});
