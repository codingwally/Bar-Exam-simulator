import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';

const host = { id: 'roster-host', displayName: 'Neutral judge' }, person = n => ({ id: `roster-person-${n}`, displayName: `Person ${n}` });
async function setup(rules = {}) {
  let eventId, serial = 0;
  const store = createMemoryDebateStoreForTests(), service = createDebateService({ store, now: () => 1800000000000 });
  const command = async (command, payload = {}, actor = host) => {
    const event = eventId ? await store.read(eventId) : null;
    const response = await service.execute({ actor, eventId, command, payload, expectedRevision: event?.revision || 0, idempotencyKey: `roster-case-${++serial}` });
    eventId ||= response.event.id; return response;
  };
  await command('create_event', { title: 'Local roster integrity test', rehearsal: true });
  for (let n = 1; n <= 7; n++) {
    const invitation = await command('create_invite', { role: 'observer', boundAccountId: person(n).id });
    await command('claim_invite', { secret: invitation.receipt.result.secret }, person(n));
    await command('check_in', {}, person(n)); await command('admit_member', { memberId: person(n).id });
  }
  const a = await command('confirm_roster', { name: 'A team', speakerIds: [1,2,3].map(n => person(n).id), captainId: person(1).id });
  const n = await command('confirm_roster', { name: 'N team', speakerIds: [4,5,6].map(n => person(n).id), captainId: person(4).id });
  const motion = await command('add_motion', { text: 'This house would share learning resources.' });
  const match = await command('create_match', { teamIds: { affirmative: a.receipt.result.teamId, negative: n.receipt.result.teamId }, motionId: motion.receipt.result.motionId, judgeIds: [host.id], closingSeats: { affirmative: 'A2', negative: 'N1' }, rules });
  const matchId = match.receipt.result.matchId;
  for (const n of [1,4]) await command('acknowledge_rules', { matchId, ruleVersion: 1 }, person(n));
  for (let n = 1; n <= 6; n++) await command('record_device_check', { matchId, microphone: true }, person(n));
  return { service, store, command, eventId, matchId, teamId: a.receipt.result.teamId, otherTeamId: n.receipt.result.teamId };
}
const roster = env => ({ teamId: env.teamId, name: 'Revised A', school: 'Local affiliation', speakerIds: [2,1,7].map(n => person(n).id), captainId: person(2).id });

test('proposals require three distinct registered available speakers and a captain among them', async () => {
  const env = await setup(), valid = roster(env), before = (await env.store.read(env.eventId)).revision;
  await assert.rejects(env.command('propose_roster', { ...valid, speakerIds: [person(1).id,person(1).id,person(7).id] }, person(1)), { code: 'INVALID_ROSTER' });
  await assert.rejects(env.command('propose_roster', { ...valid, speakerIds: [person(2).id,person(1).id,'unregistered'] }, person(1)), { code: 'NOT_MEMBER' });
  await assert.rejects(env.command('propose_roster', { ...valid, captainId: person(3).id }, person(1)), { code: 'INVALID_ROSTER' });
  await assert.rejects(env.command('propose_roster', { ...valid, speakerIds: [person(2).id,person(1).id,person(4).id] }, person(1)), { code: 'ROLE_CONFLICT' });
  await assert.rejects(env.command('propose_roster', valid, person(2)), { code: 'FORBIDDEN' });
  assert.equal((await env.store.read(env.eventId)).revision, before);
  await env.command('propose_roster', valid, person(1));
  const saved = await env.store.read(env.eventId);
  assert.equal(saved.teams[env.teamId].proposal.name, valid.name); assert.equal(saved.teams[env.teamId].proposal.school, valid.school);
  assert.deepEqual(saved.teams[env.teamId].speakerIds, [1,2,3].map(n => person(n).id), 'a proposal is not a confirmed roster');
  assert.equal(saved.matches[env.matchId].captains.affirmative, person(1).id);
});

test('confirming a changed setup roster updates all seats/captains, preserves the actual closer and resets stale readiness', async () => {
  const env = await setup(), matchId = env.matchId;
  await env.command('save_draft', { matchId, notes: 'Private old participant assessment.' });
  const response = await env.command('confirm_roster', roster(env));
  const saved = await env.store.read(env.eventId), match = saved.matches[matchId];
  assert.deepEqual([match.seats.A1,match.seats.A2,match.seats.A3], [2,1,7].map(n => person(n).id));
  assert.equal(match.captains.affirmative, person(2).id); assert.equal(match.closingSeats.affirmative, 'A1', 'the same retained participant remains the closing speaker after reorder');
  assert.equal(match.ruleVersion, 2); assert.deepEqual(match.acknowledgments, {}); assert.deepEqual(match.deviceChecks, {}); assert.deepEqual(match.drafts, {});
  assert.equal(match.draftHistory[0].drafts[host.id].notes, 'Private old participant assessment.');
  assert.equal(response.receipt.result.acknowledgmentsRequired, true); assert.deepEqual(response.receipt.result.updatedMatchIds, [matchId]);
  assert.equal(saved.members[person(3).id].teamId, null); assert.equal(saved.members[person(7).id].teamId, env.teamId);
  assert.ok(!JSON.stringify(response.event).includes('Private old participant assessment.'));
  await assert.rejects(env.command('start_match', { matchId }), { code: 'MATCH_NOT_READY' });
  await assert.rejects(env.command('acknowledge_rules', { matchId, ruleVersion: 2 }, person(1)), { code: 'FORBIDDEN' });
  for (const n of [2,4]) await env.command('acknowledge_rules', { matchId, ruleVersion: 2 }, person(n));
  for (const n of [1,2,7,4,5,6]) await env.command('record_device_check', { matchId, microphone: true }, person(n));
  assert.equal((await env.command('start_match', { matchId })).event.matches[0].phase, 'preparation');
});

test('roster changes cannot rewrite an in-progress match, while a pending proposal remains reviewable', async () => {
  const env = await setup(), matchId = env.matchId; await env.command('start_match', { matchId });
  const original = await env.store.read(env.eventId);
  await assert.rejects(env.command('confirm_roster', roster(env)), { code: 'ROSTER_LOCKED' });
  await env.command('propose_roster', roster(env), person(1));
  const saved = await env.store.read(env.eventId);
  assert.deepEqual(saved.matches[matchId].seats, original.matches[matchId].seats);
  assert.deepEqual(saved.matches[matchId].acknowledgments, original.matches[matchId].acknowledgments);
  assert.equal(saved.teams[env.teamId].proposal.captainId, person(2).id);
  await env.command('confirm_roster', { teamId: env.teamId, name: 'Clarified team name', speakerIds: original.teams[env.teamId].speakerIds, captainId: original.teams[env.teamId].captainId });
  assert.equal((await env.store.read(env.eventId)).matches[matchId].ruleVersion, 1, 'metadata-only edit must not reset the active timer or accepted seats');
});

test('a roster update cannot place an assigned judge into a speaking seat or leave partial membership changes', async () => {
  const env = await setup(), before = await env.store.read(env.eventId);
  await assert.rejects(env.command('confirm_roster', { ...roster(env), speakerIds: [person(1).id,person(2).id,host.id] }), { code: 'ROLE_CONFLICT' });
  const after = await env.store.read(env.eventId);
  assert.deepEqual(after, before);
});

test('later event roster changes preserve all locked historical match identities and their final result', async () => {
  const env = await setup({ correctionWindowMs: 0 }), matchId = env.matchId;
  await env.command('start_match', { matchId });
  await env.command('conclude_match', { matchId, kind: 'cancelled', reason: 'Recorded local test cancellation.', confirmed: true });
  await env.command('publish_result', { matchId }); await env.command('finalize_result', { matchId });
  const historical = (await env.store.read(env.eventId)).matches[matchId];
  const changed = await env.command('confirm_roster', roster(env));
  const saved = await env.store.read(env.eventId);
  assert.deepEqual(saved.matches[matchId], historical);
  assert.deepEqual(changed.receipt.result.updatedMatchIds, []);
  const next = await env.command('create_match', { teamIds: historical.teamIds, motionId: historical.motionId, judgeIds: [host.id] });
  const future = next.event.matches.find(match => match.id === next.receipt.result.matchId);
  assert.deepEqual([future.seats.A1,future.seats.A2,future.seats.A3], [2,1,7].map(n => person(n).id));
});
