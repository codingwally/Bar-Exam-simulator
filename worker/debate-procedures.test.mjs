import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';
import { requireResolvedFixture, transferFixtureToRematch } from './debate-fixtures.mjs';

const host = { id: 'official-host', displayName: 'Neutral chief' };
const person = n => ({ id: `participant-${n}`, displayName: `Person ${n}` });
async function setup({ fixtures = false } = {}) {
  let time = 1800000000000, serial = 0, eventId;
  const store = createMemoryDebateStoreForTests();
  const service = createDebateService({ store, now: () => time, limits: { maxParticipants: 10 }, adapters: { media: async job => ({ status: job.payload.action === 'leave' ? 'left' : 'ready' }) } });
  const command = async (command, payload = {}, actor = host) => {
    const saved = eventId ? await store.read(eventId) : null;
    const response = await service.execute({ actor, eventId, command, payload, expectedRevision: saved?.revision || 0, idempotencyKey: `procedure-${++serial}` });
    eventId ||= response.event.id; return response;
  };
  await command('create_event', { title: 'Procedural local test', rehearsal: true });
  for (let n = 1; n <= 8; n++) {
    const invite = await command('create_invite', { role: 'observer', boundAccountId: person(n).id });
    await command('claim_invite', { secret: invite.receipt.result.secret }, person(n));
    await command('check_in', {}, person(n)); await command('admit_member', { memberId: person(n).id });
  }
  const a = await command('confirm_roster', { name: 'Team A', speakerIds: [1,2,3].map(n => person(n).id), captainId: person(1).id });
  const n = await command('confirm_roster', { name: 'Team N', speakerIds: [4,5,6].map(n => person(n).id), captainId: person(4).id });
  const motion = await command('add_motion', { text: 'This house would share open learning materials.' });
  let fixtureId;
  if (fixtures) { await command('generate_fixtures', { method: 'round_robin', motionIds: [motion.receipt.result.motionId] }); await command('publish_fixtures', { confirmed: true }); fixtureId = (await store.read(eventId)).fixtures[0].id; }
  const created = await command('create_match', { fixtureId, motionId: motion.receipt.result.motionId, teamIds: { affirmative: a.receipt.result.teamId, negative: n.receipt.result.teamId }, judgeIds: [host.id,person(7).id], moderatorId: person(8).id, timekeeperId: host.id, evenPanelAccepted: true, rules: { judgingMode: 'simple' } });
  const env = { store, service, command, eventId, matchId: created.receipt.result.matchId, now: () => time, advance: ms => { time += ms; } };
  await ready(env, env.matchId); return env;
}
async function ready(env, matchId) {
  for (const n of [1,4]) await env.command('acknowledge_rules', { matchId, ruleVersion: 1 }, person(n));
  for (let n = 1; n <= 6; n++) await env.command('record_device_check', { matchId, microphone: true }, person(n));
}
async function finishStage(env, matchId = env.matchId) {
  let match = (await env.store.read(env.eventId)).matches[matchId];
  await env.command('claim_clock', { matchId, timerVersion: match.timer.version });
  match = (await env.store.read(env.eventId)).matches[matchId];
  await env.command('timer', { matchId, timerVersion: match.timer.version, type: 'START' });
  env.advance(match.timer.durationMs + 1);
  match = (await env.store.read(env.eventId)).matches[matchId];
  await env.command('claim_clock', { matchId, timerVersion: match.timer.version });
  match = (await env.store.read(env.eventId)).matches[matchId];
  await env.command('finish_stage', { matchId, timerVersion: match.timer.version });
  await env.command('next_stage', { matchId });
}
async function finishFlow(env, matchId = env.matchId) {
  await env.command('start_match', { matchId });
  while ((await env.store.read(env.eventId)).matches[matchId].phase !== 'deliberation') await finishStage(env, matchId);
}
async function closedBallots(env, winner = 'negative', matchId = env.matchId) {
  await env.command('open_ballots', { matchId });
  await env.command('submit_ballot', { matchId, winner: 'affirmative', reason: 'Supported clash assessment.', confirmed: true });
  await env.command('submit_ballot', { matchId, winner, reason: 'Independent assessment.', confirmed: true }, person(7));
  return env.command('close_ballots', { matchId });
}

test('captain invitation is explicit, neutral, room-scoped and visible without leaking private text', async () => {
  const env = await setup(), matchId = env.matchId;
  await env.command('start_match', { matchId });
  await assert.rejects(env.command('enter_space', { matchId, space: 'affirmative', deviceId: 'moderator-device' }, person(8)), { code: 'FORBIDDEN' });
  const payload = { matchId, space: 'affirmative', moderatorId: person(8).id, reason: 'Please clarify the announced preparation rule.', confirmed: true };
  await assert.rejects(env.command('invite_private_room', payload), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('invite_private_room', payload, person(4)), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('invite_private_room', { ...payload, moderatorId: person(2).id }, person(1)), { code: 'ROLE_CONFLICT' });
  await assert.rejects(env.command('invite_private_room', { ...payload, confirmed: false }, person(1)), { code: 'CONFIRMATION_REQUIRED' });
  const invitation = await env.command('invite_private_room', payload, person(1));
  assert.equal(invitation.event.matches[0].privateRoomInvitations[0].status, 'ACTIVE');
  await env.command('send_message', { matchId, channel: 'team:affirmative', text: 'Private case theory remains private.' }, person(1));
  const moderator = await env.service.snapshot({ actor: person(8), eventId: env.eventId });
  assert.ok(!JSON.stringify(moderator).includes('Private case theory'));
  assert.equal(moderator.event.matches[0].privateRoomInvitations[0].reason, payload.reason);
  await env.command('enter_space', { matchId, space: 'affirmative', deviceId: 'moderator-device' }, person(8));
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal((await env.service.authorizeMedia({ actor: person(8), eventId: env.eventId, matchId, deviceId: 'moderator-device' })).space, 'affirmative');
  await assert.rejects(env.command('enter_space', { matchId, space: 'negative', deviceId: 'moderator-device' }, person(8)), { code: 'FORBIDDEN' });
});

test('revoking a moderator invitation denies credentials immediately and queues durable provider removal', async () => {
  const env = await setup(), matchId = env.matchId;
  await env.command('start_match', { matchId });
  const invited = await env.command('invite_private_room', { matchId, space: 'affirmative', reason: 'Resolve preparation timing.', confirmed: true }, person(1));
  await env.command('enter_space', { matchId, space: 'affirmative', deviceId: 'device' }, person(8)); await env.service.processOutbox({ eventId: env.eventId });
  const invitationId = invited.receipt.result.invitation.id;
  await assert.rejects(env.command('revoke_private_room_invitation', { matchId, invitationId, reason: 'Other team cannot revoke.' }, person(4)), { code: 'FORBIDDEN' });
  const revoked = await env.command('revoke_private_room_invitation', { matchId, invitationId, reason: 'Clarification completed.' }, person(1));
  assert.equal(revoked.event.matches[0].privateRoomInvitations[0].status, 'REVOKED');
  assert.equal((await env.store.read(env.eventId)).media[person(8).id].desiredAction, 'leave');
  await assert.rejects(env.service.authorizeMedia({ actor: person(8), eventId: env.eventId, matchId, deviceId: 'device' }), { code: 'FORBIDDEN' });
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal((await env.store.read(env.eventId)).media[person(8).id].status, 'left');
});

test('private invitations expire with the exact attempt and judges can invite during untimed deliberation', async () => {
  const env = await setup(), matchId = env.matchId;
  await env.command('start_match', { matchId });
  await env.command('invite_private_room', { matchId, space: 'affirmative', reason: 'First preparation only.', confirmed: true }, person(1));
  await finishStage(env);
  assert.equal((await env.service.snapshot({ actor: person(8), eventId: env.eventId })).event.matches[0].privateRoomInvitations[0].status, 'EXPIRED');
  await assert.rejects(env.command('enter_space', { matchId, space: 'affirmative', deviceId: 'device' }, person(8)), { code: 'FORBIDDEN' });
  while ((await env.store.read(env.eventId)).matches[matchId].phase !== 'deliberation') await finishStage(env);
  await assert.rejects(env.command('enter_space', { matchId, space: 'judges', deviceId: 'device' }, person(8)), { code: 'FORBIDDEN' });
  const invited = await env.command('invite_private_room', { matchId, space: 'judges', reason: 'Explain the published procedural deadline.', confirmed: true }, person(7));
  assert.equal(invited.event.matches[0].privateRoomInvitations.at(-1).status, 'ACTIVE');
  await env.command('enter_space', { matchId, space: 'judges', deviceId: 'device' }, person(8));
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal((await env.service.authorizeMedia({ actor: person(8), eventId: env.eventId, matchId, deviceId: 'device' })).space, 'judges');
});

test('an actual tied reconsideration creates a clean linked rematch, preserves original ballots and blocks forged finalization', async () => {
  const env = await setup({ fixtures: true }), matchId = env.matchId;
  await assert.rejects(env.command('create_rematch', { matchId, confirmed: true, reason: 'Not played.' }), { code: 'REMATCH_NOT_READY' });
  await finishFlow(env); await closedBallots(env);
  await assert.rejects(env.command('create_rematch', { matchId, confirmed: true, reason: 'Only first round.' }), { code: 'REMATCH_NOT_READY' });
  await env.command('reconsider_ballots', { matchId, reason: 'Same panel reconsiders the exact tie.' }); await closedBallots(env);
  const before = (await env.store.read(env.eventId)).matches[matchId];
  const created = await env.command('create_rematch', { matchId, confirmed: true, reason: 'The one permitted reconsideration remained tied.' });
  const nextId = created.receipt.result.matchId, saved = await env.store.read(env.eventId), source = saved.matches[matchId], rematch = saved.matches[nextId], fixture = saved.fixtures[0];
  assert.equal(source.phase, 'unresolved'); assert.equal(source.resultVersions.at(-1).winner, null); assert.equal(source.rematchId, nextId);
  assert.deepEqual(source.ballots, before.ballots); assert.deepEqual(source.attempts, before.attempts);
  assert.equal(rematch.rematchOf, matchId); assert.equal(rematch.phase, 'setup'); assert.equal(rematch.rulesLockedAt, null);
  assert.deepEqual(rematch.ballots, {}); assert.deepEqual(rematch.attempts, []); assert.deepEqual(rematch.acknowledgments, {}); assert.deepEqual(rematch.deviceChecks, {});
  assert.equal(fixture.matchId, nextId); assert.equal(fixture.status, 'SCHEDULED'); assert.equal(fixture.winnerTeamId, null); assert.equal(fixture.rematchHistory[0].matchId, matchId);
  assert.equal(source.originalFixtureId, fixture.id); assert.equal(source.fixtureId, null); assert.equal(rematch.fixtureId, fixture.id);
  await assert.rejects(env.command('create_rematch', { matchId, confirmed: true, reason: 'Duplicate.' }), { code: 'REMATCH_NOT_READY' });
  await assert.rejects(env.command('return_stage', { matchId, stageIndex: 0, reason: 'Tamper original.' }), { code: 'REMATCH_SOURCE_LOCKED' });
  await assert.rejects(env.command('finalize_result', { matchId }), { code: 'REMATCH_SOURCE_LOCKED' });
  await assert.rejects(env.command('start_match', { matchId: nextId }), { code: 'MATCH_NOT_READY' });
  await ready(env, nextId); await finishFlow(env, nextId); await closedBallots(env, 'affirmative', nextId);
  await env.command('publish_result', { matchId: nextId }); env.advance(900000); await env.command('finalize_result', { matchId: nextId });
  const completed = await env.store.read(env.eventId);
  assert.equal(completed.fixtures[0].status, 'FINAL'); assert.equal(completed.fixtures[0].winnerTeamId, rematch.teamIds.affirmative);
  assert.equal(completed.matches[matchId].resultVersions.at(-1).winner, null, 'the original tie is never overwritten');
});

test('fixture rematch transfer preserves downstream blockage without advancing any participant', () => {
  const source = { id: 'old', fixtureId: 'semi', teamIds: { affirmative: 'a', negative: 'b' }, motionId: 'motion', resultVersions: [{ id: 'tied', revision: 1 }] };
  const rematch = { id: 'new', teamIds: source.teamIds, motionId: 'new-motion' };
  const event = { fixtures: [{ id: 'semi', status: 'PROVISIONAL', matchId: 'old', affirmativeTeamId: 'a', negativeTeamId: 'b', motionId: 'motion', startedAt: 10 }, { id: 'final', status: 'AWAITING_PREDECESSORS', affirmativeTeamId: null, negativeTeamId: 'c', affirmativeSource: 'semi' }] };
  const fixture = transferFixtureToRematch(event, source, rematch, { at: 20, actorId: 'host', reason: 'Recorded tie remains.' });
  assert.equal(event.fixtures[0].matchId, 'old'); assert.equal(fixture.rematchHistory[0].startedAt, 10);
  assert.equal(fixture.status, 'SCHEDULED'); assert.equal(fixture.winnerTeamId, null);
  const next = { fixtures: [fixture, event.fixtures[1]] };
  assert.throws(() => requireResolvedFixture(next, next.fixtures[1]), { code: 'FIXTURE_PREDECESSORS_PENDING' });
});

test('a stage transition revokes an unexpired invited moderator session and cannot revive an old invitation', async () => {
  const env = await setup(), matchId = env.matchId;
  await env.command('update_rules', { matchId, rules: { preparationMs: 1000 } });
  for (const n of [1,4]) await env.command('acknowledge_rules', { matchId, ruleVersion: 2 }, person(n));
  await env.command('start_match', { matchId });
  await env.command('invite_private_room', { matchId, space: 'affirmative', reason: 'Clarification in this preparation attempt only.', confirmed: true }, person(1));
  await env.command('enter_space', { matchId, space: 'affirmative', deviceId: 'device' }, person(8)); await env.service.processOutbox({ eventId: env.eventId });
  const expiry = (await env.store.read(env.eventId)).media[person(8).id].expiresAt;
  await finishStage(env);
  const saved = await env.store.read(env.eventId);
  assert.ok(env.now() < expiry, 'the permission was revoked by phase, not merely by lease expiry');
  assert.equal(saved.media[person(8).id].desiredAction, 'leave');
  await assert.rejects(env.service.authorizeMedia({ actor: person(8), eventId: env.eventId, matchId, deviceId: 'device' }), { code: 'FORBIDDEN' });
  await env.command('return_stage', { matchId, stageIndex: 0, reason: 'Recorded replay creates a new preparation attempt.' });
  assert.equal((await env.service.snapshot({ actor: person(8), eventId: env.eventId })).event.matches[0].privateRoomInvitations[0].status, 'EXPIRED');
});

test('the disclosed default has no predeclared tiebreak adjudicator and rejects hidden configuration', async () => {
  const env = await setup(), matchId = env.matchId, before = await env.store.read(env.eventId), match = before.matches[matchId];
  assert.equal((await env.service.snapshot({ actor: host, eventId: env.eventId })).event.matches[0].tieResolution.predeclaredTiebreakJudge, null);
  for (const hidden of [{ tiebreakJudge: { id: person(8).id, observed: true } }, { tiebreakJudgeId: person(8).id }, { predeclaredTiebreakJudge: person(8).id }]) {
    await assert.rejects(env.command('create_match', { teamIds: match.teamIds, motionId: match.motionId, judgeIds: match.judgeIds, ...hidden }), { code: 'TIEBREAK_CONFIGURATION_UNSUPPORTED' });
    await assert.rejects(env.command('create_match', { teamIds: match.teamIds, motionId: match.motionId, judgeIds: match.judgeIds, rules: hidden }), { code: 'TIEBREAK_CONFIGURATION_UNSUPPORTED' });
    await assert.rejects(env.command('update_rules', { matchId, ...hidden }), { code: 'TIEBREAK_CONFIGURATION_UNSUPPORTED' });
    await assert.rejects(env.command('update_rules', { matchId, rules: hidden }), { code: 'TIEBREAK_CONFIGURATION_UNSUPPORTED' });
  }
  assert.equal((await env.store.read(env.eventId)).revision, before.revision);
  assert.equal(Object.keys((await env.store.read(env.eventId)).matches).length, 1);
});
