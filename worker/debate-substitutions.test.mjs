import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';

const host = { id: 'substitution-host', displayName: 'Neutral judge' };
const person = n => ({ id: `substitution-person-${n}`, displayName: `Participant ${n}` });
async function setup({ participantCount = 8, reserveDevice = true } = {}) {
  let eventId, sequence = 0, time = 1800000000000;
  const store = createMemoryDebateStoreForTests(), service = createDebateService({ store, now: () => time });
  const command = async (name, payload = {}, actor = host) => {
    const event = eventId ? await store.read(eventId) : null;
    const response = await service.execute({ actor, eventId, command: name, payload, expectedRevision: event?.revision || 0, idempotencyKey: `substitution-${++sequence}` });
    eventId ||= response.event.id; return response;
  };
  await command('create_event', { title: 'Actual service substitution regression', rehearsal: true });
  for (let n = 1; n <= participantCount; n++) {
    const invitation = await command('create_invite', { role: 'observer', boundAccountId: person(n).id });
    await command('claim_invite', { secret: invitation.receipt.result.secret }, person(n));
    await command('check_in', {}, person(n)); await command('admit_member', { memberId: person(n).id });
  }
  const team = async (name, numbers) => (await command('confirm_roster', { name, speakerIds: numbers.map(n => person(n).id), captainId: person(numbers[0]).id })).receipt.result.teamId;
  const affirmative = await team('Affirmative', [1,2,3]), negative = await team('Negative', [4,5,6]);
  await command('assign_role', { memberId: person(7).id, roles: ['reserve'], teamId: affirmative, reason: 'Registered approved reserve.' });
  const motionId = (await command('add_motion', { text: 'This house would share educational resources.' })).receipt.result.motionId;
  const matchId = (await command('create_match', { teamIds: { affirmative, negative }, motionId, judgeIds: [host.id], rules: { correctionWindowMs: 0 } })).receipt.result.matchId;
  const acknowledge = async (id = matchId, version = 1, captains = [1,4]) => { for (const n of captains) await command('acknowledge_rules', { matchId: id, ruleVersion: version }, person(n)); };
  await acknowledge();
  for (let n = 1; n <= (reserveDevice ? 7 : 6); n++) await command('record_device_check', { matchId, microphone: true }, person(n));
  const savedMatch = async () => (await store.read(eventId)).matches[matchId];
  const clock = async type => {
    let match = await savedMatch(); await command('claim_clock', { matchId, timerVersion: match.timer.version });
    match = await savedMatch(); return command('timer', { matchId, type, timerVersion: match.timer.version });
  };
  const finishAndNext = async () => { await clock('START'); time += (await savedMatch()).timer.durationMs + 1000; await clock('FINISH'); await command('next_stage', { matchId }); };
  return { store, service, command, eventId, matchId, team, motionId, affirmative, negative, acknowledge, savedMatch, clock, finishAndNext, advance: ms => { time += ms; } };
}
const replacement = env => ({ matchId: env.matchId, seat: 'A1', memberId: person(7).id, reason: 'Approved registered reserve replaces the unavailable captain.' });

test('captain substitution archives old attributed drafts, resets acknowledgments and keeps three active speakers', async () => {
  const env = await setup();
  await env.command('save_draft', { matchId: env.matchId, notes: 'PRIVATE_ORIGINAL_SPEAKER_NOTES' });
  const before = await env.savedMatch(), originalTeam = (await env.store.read(env.eventId)).teams[env.affirmative];
  const response = await env.command('substitute_speaker', replacement(env)), after = await env.savedMatch();
  assert.equal(after.seats.A1, person(7).id); assert.equal(after.captains.affirmative, person(7).id);
  assert.deepEqual(Object.keys(after.seats), Object.keys(before.seats)); assert.equal(new Set(Object.values(after.seats)).size, 6);
  assert.deepEqual(after.rosterHistory[0].seats, before.seats); assert.deepEqual(after.rosterHistory[0].captains, before.captains);
  assert.deepEqual(after.draftHistory[0].drafts, before.drafts); assert.deepEqual(after.draftHistory[0].seats, before.seats);
  assert.deepEqual(after.drafts, {}); assert.equal(after.ruleVersion, 2); assert.deepEqual(after.acknowledgments, {});
  assert.equal(after.awardEligibilityReview, true); assert.equal(response.receipt.result.replayRequired, false);
  assert.equal(response.receipt.result.acknowledgmentsRequired, true);
  assert.deepEqual((await env.store.read(env.eventId)).teams[env.affirmative], originalTeam, 'per-match substitution does not rewrite the historical event roster');
  for (const actor of [host, person(7), person(8)]) {
    const snapshot = await env.service.snapshot({ actor, eventId: env.eventId });
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_ORIGINAL_SPEAKER_NOTES'), 'archived notes cannot be reassigned to a new person or another viewer');
  }
  await assert.rejects(env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 2 }, person(1)), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('start_match', { matchId: env.matchId }), { code: 'MATCH_NOT_READY' });
  await env.acknowledge(env.matchId, 2, [7,4]);
  await env.command('start_match', { matchId: env.matchId });
  assert.equal((await env.savedMatch()).phase, 'preparation');
});

test('a paused active replaced speaker gets a new READY attempt with no transferred time or completion', async () => {
  const env = await setup(); await env.command('start_match', { matchId: env.matchId }); await env.finishAndNext();
  await env.clock('START'); env.advance(3000); await env.clock('PAUSE');
  await env.command('grant_floor', { matchId: env.matchId, memberId: person(1).id });
  await env.command('assign_presenter', { matchId: env.matchId, memberId: person(1).id });
  const before = await env.savedMatch(), original = before.attempts.at(-1), completedPrep = before.attempts[0];
  const response = await env.command('substitute_speaker', replacement(env)), after = await env.savedMatch();
  const abandoned = after.attempts.find(attempt => attempt.id === original.id), replay = after.attempts.at(-1);
  assert.equal(abandoned.state, 'ABANDONED'); assert.equal(abandoned.elapsedMs, 3000);
  assert.deepEqual(abandoned.speakerIds, [person(1).id]); assert.ok(abandoned.abandonReason.includes('Approved substitution'));
  assert.deepEqual(after.attempts[0], completedPrep);
  assert.notEqual(replay.id, original.id); assert.equal(replay.stageId, original.stageId); assert.equal(replay.number, original.number + 1);
  assert.deepEqual(replay.speakerIds, [person(7).id]); assert.equal(replay.state, 'READY');
  assert.equal(after.timer.elapsedBeforeRunMs, 0); assert.equal(after.timer.durationMs, before.timer.durationMs);
  assert.equal(after.timer.controllerId, null); assert.equal(after.timer.state, 'READY');
  assert.equal(after.floorGrants[person(1).id], undefined); assert.equal(after.presenterId, null);
  assert.equal(response.receipt.result.replayRequired, true); assert.equal(response.receipt.result.replayAttemptId, replay.id);
  await assert.rejects(env.clock('START'), { code: 'RULES_ACKNOWLEDGMENT_REQUIRED' });
  await env.acknowledge(env.matchId, 2, [7,4]); await env.clock('START');
  assert.equal((await env.savedMatch()).timer.state, 'RUNNING');
});

test('completed speech attribution remains with the original person when a later stage is substituted', async () => {
  const env = await setup(); await env.command('start_match', { matchId: env.matchId });
  await env.finishAndNext(); await env.finishAndNext();
  const before = await env.savedMatch(), constructive = before.attempts.find(attempt => attempt.stageId === 'stage-01');
  assert.equal(constructive.state, 'FINISHED'); assert.deepEqual(constructive.speakerIds, [person(1).id]);
  await env.command('substitute_speaker', replacement(env));
  const after = await env.savedMatch();
  assert.deepEqual(after.attempts.find(attempt => attempt.id === constructive.id), constructive);
  assert.equal(after.attempts.filter(attempt => attempt.state === 'FINISHED' && attempt.speakerIds.includes(person(7).id)).length, 0);
  assert.equal(after.awardEligibilityReview, true, 'a substitute does not inherit a completed opportunity or a speech award score');
});

test('substitution requires a ready reserve and authorized actor, and invalid captain choice is atomic', async () => {
  const env = await setup({ reserveDevice: false });
  await assert.rejects(env.command('substitute_speaker', replacement(env), person(1)), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('substitute_speaker', { ...replacement(env), memberId: person(4).id }), { code: 'ROLE_CONFLICT' });
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'RESERVE_NOT_READY' });
  await env.command('record_device_check', { matchId: env.matchId, microphone: true }, person(7));
  const before = await env.store.read(env.eventId);
  await assert.rejects(env.command('substitute_speaker', { ...replacement(env), captainId: person(4).id }), { code: 'INVALID_CAPTAIN' });
  assert.deepEqual(await env.store.read(env.eventId), before);
  const response = await env.command('substitute_speaker', { ...replacement(env), captainId: person(2).id });
  assert.equal(response.receipt.result.captainId, person(2).id);
});

test('a reserve assigned to a separate active match cannot be substituted into this match', async () => {
  const env = await setup({ participantCount: 13 });
  const affirmative = await env.team('Second affirmative', [8,9,10]), negative = await env.team('Second negative', [11,12,13]);
  const secondId = (await env.command('create_match', { teamIds: { affirmative, negative }, motionId: env.motionId, judgeIds: [person(7).id] })).receipt.result.matchId;
  await env.acknowledge(secondId, 1, [8,11]);
  for (let n = 8; n <= 13; n++) await env.command('record_device_check', { matchId: secondId, microphone: true }, person(n));
  await env.command('start_match', { matchId: secondId });
  const before = await env.store.read(env.eventId);
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'ROLE_CONFLICT' });
  assert.deepEqual(await env.store.read(env.eventId), before, 'overlap rejection does not leave partial seats, captain or draft mutations');
});

test('running clocks and ended or adjudicating matches cannot silently reassign completed records', async () => {
  const env = await setup(); await env.command('start_match', { matchId: env.matchId }); await env.clock('START');
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'CLOCK_NOT_READY' });
  await env.clock('PAUSE');
  await env.command('conclude_match', { matchId: env.matchId, kind: 'cancelled', reason: 'Officially cancelled before completion.', confirmed: true });
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'SUBSTITUTION_NOT_READY' });
  await env.command('publish_result', { matchId: env.matchId });
  const provisional = await env.store.read(env.eventId);
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'SUBSTITUTION_NOT_READY' });
  assert.deepEqual(await env.store.read(env.eventId), provisional);
  await env.command('finalize_result', { matchId: env.matchId });
  const final = await env.store.read(env.eventId);
  await assert.rejects(env.command('substitute_speaker', replacement(env)), { code: 'SUBSTITUTION_NOT_READY' });
  assert.deepEqual(await env.store.read(env.eventId), final);
});
