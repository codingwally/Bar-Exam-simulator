import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';
import { generateElimination } from './debate-domain.mjs';
import { markFixtureCorrection } from './debate-fixtures.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const host = { id: 'fixture-host', displayName: 'Fixture official', verified: true };
const actor = n => ({ id: `fixture-person-${n}`, displayName: `Fixture speaker ${n}`, verified: true });
async function setup(teamCount = 4, rehearsal = true) {
  const store = createMemoryDebateStoreForTests(); let time = 1800000000000, eventId, sequence = 0;
  const service = createDebateService({ store, now: () => time });
  const command = async (name, payload = {}, person = host, extra = {}) => {
    const event = eventId ? await store.read(eventId) : null;
    const result = await service.execute({ actor: person, eventId, command: name, payload, expectedRevision: event?.revision || 0, idempotencyKey: `fixture-test-${++sequence}`, ...extra });
    eventId ||= result.event.id; return result;
  };
  await command('create_event', { title: 'Fixture integration', rehearsal });
  const teamIds = [], motionIds = [];
  for (let n = 1; n <= teamCount * 3; n++) {
    const invite = await command('create_invite', { role: 'debater', boundAccountId: actor(n).id });
    await command('claim_invite', { secret: invite.receipt.result.secret }, actor(n), { expectedRevision: undefined });
    await command('check_in', {}, actor(n)); await command('admit_member', { memberId: actor(n).id });
  }
  for (let team = 0; team < teamCount; team++) {
    const teamMembers = [1,2,3].map(offset => actor(team * 3 + offset).id);
    teamIds.push((await command('confirm_roster', { name: `Team ${team + 1}`, speakerIds: teamMembers, captainId: teamMembers[0] })).receipt.result.teamId);
  }
  for (let i = 0; i < 5; i++) motionIds.push((await command('add_motion', { title: `Motion ${i + 1}`, text: `Prepared discussion motion ${i + 1}.` })).receipt.result.motionId);
  const env = { command, service, store, teamIds, motionIds, get eventId() { return eventId; }, read: () => store.read(eventId), advance: ms => { time += ms; } };
  env.generate = async (method = 'elimination') => { await command('generate_fixtures', { method, teamIds, motionIds, motionReusePolicy: 'cycle' }); return command('publish_fixtures', { confirmed: true }); };
  env.bind = async fixtureId => (await command('create_match', { fixtureId, judgeIds: [host.id] })).receipt.result.matchId;
  env.ready = async matchId => {
    const match = (await env.read()).matches[matchId];
    for (const captain of Object.values(match.captains)) await command('acknowledge_rules', { matchId, ruleVersion: match.ruleVersion }, { id: captain, verified: true });
    for (const memberId of Object.values(match.seats)) await command('record_device_check', { matchId, memberId, microphone: false, accommodation: 'Software-only fixture integration; no real microphone test is claimed.' });
  };
  env.forfeit = async (matchId, winner = 'affirmative') => {
    await command('conclude_match', { matchId, kind: 'forfeit', winner, confirmed: true, reason: 'Explicit synthetic fixture forfeit test.' });
    await command('publish_result', { matchId }); env.advance(900000); return command('finalize_result', { matchId });
  };
  return env;
}

test('five-team round-robin yields10 fixtures; motion membership and fixture publication require real event records', async () => {
  const env = await setup(5); await env.generate('round_robin'); const saved = await env.read();
  assert.equal(saved.fixtures.length, 10); assert.equal(saved.fixtureDraft.idleSlots.length, 5);
  assert.equal(saved.fixtures.every(f => env.motionIds.includes(f.motionId)), true);
  await assert.rejects(env.command('generate_fixtures', { method: 'round_robin', motionIds: ['other-event-motion'] }), { code: 'MOTION_NOT_FOUND' });
});

test('create_match binds exact published fixture once; forged pairing/motion and bye matches are denied', async () => {
  const env = await setup(5); await env.generate(); const fixtures = (await env.read()).fixtures;
  const bye = fixtures.find(f => f.status === 'BYE'), scheduled = fixtures.find(f => f.status === 'SCHEDULED'), pending = fixtures.find(f => f.status === 'AWAITING_PREDECESSORS');
  assert.equal(fixtures.filter(f => f.status === 'BYE').length, 3);
  const byeResolved = fixtures.find(f => f.round === 2 && f.affirmativeTeamId && f.negativeTeamId);
  assert.equal(byeResolved.status, 'SCHEDULED');
  await env.bind(byeResolved.id);
  await assert.rejects(env.bind(bye.id), { code: 'FIXTURE_IS_BYE' });
  await assert.rejects(env.bind(pending.id), { code: 'FIXTURE_PREDECESSORS_PENDING' });
  await assert.rejects(env.command('create_match', { fixtureId: scheduled.id, teamIds: { affirmative: 'forged-team' }, judgeIds: [host.id] }), { code: 'FIXTURE_ASSIGNMENT_CONFLICT' });
  await assert.rejects(env.command('create_match', { fixtureId: scheduled.id, motionId: env.motionIds.find(m => m !== scheduled.motionId), judgeIds: [host.id] }), { code: 'FIXTURE_ASSIGNMENT_CONFLICT' });
  const matchId = await env.bind(scheduled.id), saved = await env.read();
  assert.equal(saved.matches[matchId].fixtureId, scheduled.id); assert.equal(saved.fixtures.find(f => f.id === scheduled.id).matchId, matchId);
  await assert.rejects(env.bind(scheduled.id), { code: 'FIXTURE_ALREADY_BOUND' });
  await env.command('generate_fixtures', { method: 'elimination', teamIds: env.teamIds, motionIds: env.motionIds });
  await assert.rejects(env.command('publish_fixtures', { confirmed: true }), { code: 'FIXTURES_LOCKED' });
});

test('sides draw keeps bound fixture consistent and started/provisional/final lifecycle cannot be overwritten', async () => {
  const env = await setup(); await env.generate(); const fixture = (await env.read()).fixtures.find(f => f.status === 'SCHEDULED'), matchId = await env.bind(fixture.id);
  await env.command('draw_sides', { matchId, swap: true }); await env.ready(matchId); await env.command('start_match', { matchId });
  let saved = await env.read(), bound = saved.fixtures.find(f => f.id === fixture.id);
  assert.equal(bound.status, 'LIVE'); assert.equal(bound.affirmativeTeamId, saved.matches[matchId].teamIds.affirmative); assert.ok(bound.startedAt);
  await env.command('conclude_match', { matchId, kind: 'forfeit', winner: 'affirmative', confirmed: true, reason: 'Controlled exceptional conclusion.' });
  await env.command('publish_result', { matchId }); assert.equal((await env.read()).fixtures.find(f => f.id === fixture.id).status, 'PROVISIONAL');
  await assert.rejects(env.command('advance_match', { matchId }), { code: 'RESULT_UNRESOLVED' });
  env.advance(900000); await env.command('finalize_result', { matchId }); bound = (await env.read()).fixtures.find(f => f.id === fixture.id);
  assert.equal(bound.status, 'FINAL'); assert.equal(bound.resultKind, 'forfeit'); assert.ok(bound.resultId); assert.equal(bound.winnerTeamId, saved.matches[matchId].teamIds.affirmative);
});

test('advancement can update only its saved fixture; dependent pairing waits for all finalized winners', async () => {
  const env = await setup(); await env.generate(); const scheduled = (await env.read()).fixtures.filter(f => f.round === 1), final = (await env.read()).fixtures.find(f => f.round === 2);
  const a = await env.bind(scheduled[0].id), b = await env.bind(scheduled[1].id);
  await env.forfeit(a); await assert.rejects(env.command('advance_match', { matchId: a, fixtureId: scheduled[1].id }), { code: 'FIXTURE_BINDING_CONFLICT' });
  await env.command('advance_match', { matchId: a }); await assert.rejects(env.bind(final.id), { code: 'FIXTURE_PREDECESSORS_PENDING' });
  await env.forfeit(b); await env.command('advance_match', { matchId: b });
  const finalId = await env.bind(final.id), saved = await env.read();
  assert.deepEqual(new Set(Object.values(saved.matches[finalId].teamIds)), new Set(scheduled.map(f => saved.fixtures.find(row => row.id === f.id).winnerTeamId)));
});

test('double forfeit has no winner or invented score and cannot fill an elimination slot', async () => {
  const env = await setup(); await env.generate(); const first = (await env.read()).fixtures[0], matchId = await env.bind(first.id);
  await env.command('conclude_match', { matchId, kind: 'double_forfeit', confirmed: true, reason: 'Both teams explicitly forfeited in this test.' });
  await env.command('publish_result', { matchId }); env.advance(900000); await env.command('finalize_result', { matchId });
  const result = (await env.read()).matches[matchId].resultVersions.at(-1);
  assert.equal(result.winner, null); assert.equal(result.teamScores, null); assert.equal(result.awards.status, 'UNAVAILABLE');
  await assert.rejects(env.command('advance_match', { matchId }), { code: 'RESULT_UNRESOLVED' });
});

async function preparedFinal(env, start = false) {
  await env.generate(); const rows = (await env.read()).fixtures, semis = rows.filter(f => f.round === 1), last = rows.find(f => f.round === 2), ids = [];
  for (const semi of semis) { const matchId = await env.bind(semi.id); ids.push(matchId); await env.forfeit(matchId); await env.command('advance_match', { matchId }); }
  const finalId = await env.bind(last.id); await env.ready(finalId); if (start) await env.command('start_match', { matchId: finalId });
  return { sourceId: ids[0], sourceFixtureId: semis[0].id, finalId, finalFixtureId: last.id };
}

test('corrected predecessor blocks an unstarted bound match until explicit rebind and fresh acknowledgments', async () => {
  const env = await setup(), ids = await preparedFinal(env), original = (await env.read()).matches[ids.finalId];
  await env.command('correct_result', { matchId: ids.sourceId, reason: 'Recorded predecessor result correction.' });
  await assert.rejects(env.command('start_match', { matchId: ids.finalId }), { code: 'FIXTURE_REVIEW_REQUIRED' });
  await assert.rejects(env.command('resolve_fixture_review', { fixtureId: ids.finalFixtureId, resolution: 'rebind_unstarted', reason: 'Review before source is resolved.' }), { code: 'FIXTURE_PREDECESSORS_PENDING' });
  await env.forfeit(ids.sourceId, 'negative'); await env.command('advance_match', { matchId: ids.sourceId });
  await env.command('resolve_fixture_review', { fixtureId: ids.finalFixtureId, resolution: 'rebind_unstarted', reason: 'Apply corrected finalists before any speaking starts.' });
  const revised = (await env.read()).matches[ids.finalId];
  assert.notDeepEqual(revised.teamIds, original.teamIds); assert.equal(revised.ruleVersion, original.ruleVersion + 1); assert.deepEqual(revised.acknowledgments, {}); assert.equal(revised.requiresReview, false);
  await assert.rejects(env.command('start_match', { matchId: ids.finalId }), { code: 'MATCH_NOT_READY' });
  await env.ready(ids.finalId); await env.command('start_match', { matchId: ids.finalId });
});

test('already-started downstream match retains participants and attempts during correction and explicit human review', async () => {
  const env = await setup(), ids = await preparedFinal(env, true), original = (await env.read()).matches[ids.finalId];
  await env.command('correct_result', { matchId: ids.sourceId, reason: 'Correct a predecessor after downstream play began.' });
  await env.forfeit(ids.sourceId, 'negative'); await env.command('advance_match', { matchId: ids.sourceId });
  const flagged = (await env.read()).matches[ids.finalId];
  assert.equal(flagged.requiresReview, true); assert.deepEqual(flagged.seats, original.seats); assert.deepEqual(flagged.attempts, original.attempts);
  await assert.rejects(env.command('resolve_fixture_review', { fixtureId: ids.finalFixtureId, resolution: 'rebind_unstarted', reason: 'Invalid attempt to replace live speakers.' }), { code: 'INVALID_FIXTURE_RESOLUTION' });
  await env.command('resolve_fixture_review', { fixtureId: ids.finalFixtureId, resolution: 'retain_played', reason: 'Official records retain the already-started matchup; no participant or result is rewritten.' });
  const saved = await env.read(); assert.deepEqual(saved.matches[ids.finalId].seats, original.seats); assert.equal(saved.matches[ids.finalId].requiresReview, false); assert.equal(saved.fixtures.find(f => f.id === ids.finalFixtureId).reviewHistory.length, 1);
});

test('correction marks the complete descendant chain while preserving started results', () => {
  const fixtures = generateElimination(['t1','t2','t3','t4','t5','t6','t7','t8']).fixtures;
  const semifinal = fixtures.find(f => f.affirmativeSource === fixtures[0].id || f.negativeSource === fixtures[0].id), final = fixtures.at(-1);
  semifinal.status = 'FINAL'; semifinal.startedAt = 100; semifinal.winnerTeamId = 't1'; final.status = 'LIVE'; final.startedAt = 200;
  const original = structuredClone(fixtures), result = markFixtureCorrection(fixtures, fixtures[0].id, { resultId: 'result-1', resultRevision: 1, at: 300, actorId: host.id, reason: 'Correction.' });
  assert.equal(result.affectedFixtureIds.includes(semifinal.id), true); assert.equal(result.affectedFixtureIds.includes(final.id), true);
  assert.equal(result.fixtures.find(f => f.id === semifinal.id).winnerTeamId, 't1'); assert.equal(result.fixtures.find(f => f.id === final.id).status, 'LIVE'); assert.deepEqual(fixtures, original);
});

test('actual service finalization pins tournament records privately and recorded runoff publishes named aggregates', async () => {
  const env = await setup(2, false), matchIds = [];
  for (let number = 0; number < 2; number++) {
    const made = await env.command('create_match', { title: `Scored tournament match ${number + 1}`, motionId: env.motionIds[number], teamIds: { affirmative: env.teamIds[0], negative: env.teamIds[1] }, judgeIds: [host.id] });
    const matchId = made.receipt.result.matchId; matchIds.push(matchId); await env.ready(matchId); await env.command('start_match', { matchId });
    for (;;) {
      let match = (await env.read()).matches[matchId]; if (match.phase === 'deliberation') break;
      await env.command('claim_clock', { matchId, timerVersion: match.timer.version }); match = (await env.read()).matches[matchId];
      await env.command('timer', { matchId, type: 'START', timerVersion: match.timer.version }); env.advance(match.timer.durationMs + 1);
      match = (await env.read()).matches[matchId]; await env.command('claim_clock', { matchId, timerVersion: match.timer.version });
      match = (await env.read()).matches[matchId]; await env.command('finish_stage', { matchId, timerVersion: match.timer.version }); await env.command('next_stage', { matchId });
    }
    const scorecard = { speakers: Object.fromEntries(['A1','A2','A3','N1','N2','N3'].map(seat => [seat, { evidence: seat[0] === 'A' ? 25 : 20, delivery: 30, questioning: 15, responding: 15 }])), closing: { affirmative: 15, negative: 12 } };
    await env.command('open_ballots', { matchId }); await env.command('submit_ballot', { matchId, scorecard, confirmed: true }); await env.command('close_ballots', { matchId });
    await env.command('nominate_award', { matchId, nomineeId: number ? 'A2' : 'A1', reason: 'PRIVATE_TOURNAMENT_REASON' });
    await env.command('publish_result', { matchId }); env.advance(900000); await env.command('finalize_result', { matchId });
    const pinned = (await env.read()).matches[matchId].resultVersions.at(-1).tournamentRecord;
    assert.ok(pinned); assert.equal(pinned.completedStages.length, 14);
  }
  const publicView = await env.service.snapshot({ actor: actor(1), eventId: env.eventId }), group = publicView.event.eventAwards.comparableGroups[0];
  assert.equal(group.bestDebater.status, 'RUNOFF_REQUIRED'); assert.equal(JSON.stringify(publicView).includes('PRIVATE_TOURNAMENT_REASON'), false); assert.equal(JSON.stringify(publicView).includes('tournamentRecord'), false);
  await assert.rejects(env.command('nominate_tournament_award', { rubric: group.rubric, nomineeId: actor(1).id, reason: 'I choose myself.', confirmed: true }, actor(1)), { code: 'FORBIDDEN' });
  await env.command('nominate_tournament_award', { rubric: group.rubric, nomineeId: actor(1).id, reason: 'Eligible judge confirmed the finalist.', confirmed: true });
  const finalView = await env.service.snapshot({ actor: actor(1), eventId: env.eventId });
  assert.equal(finalView.event.eventAwards.comparableGroups[0].bestDebater.status, 'AWARDED'); assert.deepEqual(finalView.event.eventAwards.comparableGroups[0].bestDebater.winners, [actor(1).id]);
  assert.equal(finalView.event.eventAwards.comparableGroups[0].bestSpeaker.eligibility.every(row => row.matchCount === 2), true);
  const artifactDir = fileURLToPath(new URL('../artifacts/debate-local-rehearsal/', import.meta.url)); await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, 'debate-tournament-service-integration.json'), JSON.stringify({ environment: 'Actual service commands using explicit test MemoryStore; not SQL evidence.', eventId: env.eventId, eventAwards: finalView.event.eventAwards, commands: { matchNomination: { command: 'nominate_award', payload: { matchId: matchIds[0], nomineeId: 'A1', reason: 'Reasoned choice', runoff: true } }, tournamentRunoff: { command: 'nominate_tournament_award', payload: { rubric: group.rubric, nomineeId: actor(1).id, reason: 'Reasoned choice', confirmed: true } } } }, null, 2));
  await env.command('correct_result', { matchId: matchIds[0], reason: 'Reopen one performance for a real correction.' });
  const after = (await env.service.snapshot({ actor: actor(1), eventId: env.eventId })).event.eventAwards;
  assert.equal(after.sourceResults.length, 1); assert.equal(after.invalidatedRunoffs[0].reason, 'SOURCE_RESULTS_CHANGED'); assert.equal(after.comparableGroups[0].bestSpeaker.status, 'UNAVAILABLE');
});

async function finishSpeaking(env, matchId, { stopBeforeDeliberation = false } = {}) {
  await env.ready(matchId); await env.command('start_match', { matchId });
  for (;;) {
    let match = (await env.read()).matches[matchId]; if (match.phase === 'deliberation') break;
    await env.command('claim_clock', { matchId, timerVersion: match.timer.version }); match = (await env.read()).matches[matchId];
    await env.command('timer', { matchId, type: 'START', timerVersion: match.timer.version }); env.advance(match.timer.durationMs + 1);
    match = (await env.read()).matches[matchId]; await env.command('claim_clock', { matchId, timerVersion: match.timer.version }); match = (await env.read()).matches[matchId];
    await env.command('finish_stage', { matchId, timerVersion: match.timer.version });
    if (stopBeforeDeliberation && match.runOfShow[match.currentStageIndex].id === 'stage-14') break;
    await env.command('next_stage', { matchId });
  }
}
const manualMatch = async env => (await env.command('create_match', { motionId: env.motionIds[0], teamIds: { affirmative: env.teamIds[0], negative: env.teamIds[1] }, judgeIds: [host.id] })).receipt.result.matchId;

test('normal conclusion cannot fabricate an unstarted performance or reuse an earlier finished replay attempt', async () => {
  const env = await setup(2), matchId = await manualMatch(env);
  await assert.rejects(env.command('conclude_match', { matchId, kind: 'normal' }), { code: 'STAGES_INCOMPLETE' });
  await finishSpeaking(env, matchId, { stopBeforeDeliberation: true });
  await env.command('return_stage', { matchId, stageIndex: 1, reason: 'Replay the first constructive after an interruption.' });
  await assert.rejects(env.command('conclude_match', { matchId, kind: 'normal' }), { code: 'STAGES_INCOMPLETE' });
});

test('missing nominations and required runoff cannot be frozen incomplete; candidate privacy and one-round coaward hold', async () => {
  const env = await setup(2), matchId = await manualMatch(env), panel = [host, actor(30), actor(31)];
  for (const judge of panel.slice(1)) { const invite = await env.command('create_invite', { role: 'judge', boundAccountId: judge.id }); await env.command('claim_invite', { secret: invite.receipt.result.secret }, judge, { expectedRevision: undefined }); await env.command('check_in', {}, judge); await env.command('admit_member', { memberId: judge.id }); }
  await env.command('change_panel', { matchId, judgeIds: panel.map(p => p.id), reason: 'Declared three-judge panel before start.' });
  await finishSpeaking(env, matchId);
  const scorecard = { speakers: Object.fromEntries(['A1','A2','A3','N1','N2','N3'].map(seat => [seat, { evidence: seat[0] === 'A' ? 25 : 20, delivery: 30, questioning: 15, responding: 15 }])), closing: { affirmative: 15, negative: 12 } };
  await env.command('open_ballots', { matchId }); for (const judge of panel) await env.command('submit_ballot', { matchId, scorecard, confirmed: true }, judge);
  await env.command('close_ballots', { matchId }); await env.command('publish_result', { matchId }); env.advance(900000);
  await assert.rejects(env.command('finalize_result', { matchId }), { code: 'NOMINATIONS_NOT_READY' });
  await env.command('nominate_award', { matchId, nomineeId: 'A1', reason: 'PRIVATE_FIRST_NOMINATION' }, panel[0]);
  const early = (await env.service.snapshot({ actor: panel[1], eventId: env.eventId })).event.matches.find(m => m.id === matchId);
  assert.deepEqual(early.nominationStatus.candidates, []); assert.equal(early.nominationStatus.missingJudgeCount, 2); assert.equal(JSON.stringify(early).includes('PRIVATE_FIRST_NOMINATION'), false);
  await env.command('nominate_award', { matchId, nomineeId: 'A2', reason: 'Second independent nomination.' }, panel[1]); await env.command('nominate_award', { matchId, nomineeId: 'A3', reason: 'Third independent nomination.' }, panel[2]);
  await assert.rejects(env.command('finalize_result', { matchId }), { code: 'NOMINATIONS_NOT_READY' });
  for (let i = 0; i < panel.length; i++) await env.command('nominate_award', { matchId, nomineeId: `A${i + 1}`, reason: 'Reasoned top-candidate runoff.', runoff: true }, panel[i]);
  await assert.rejects(env.command('nominate_award', { matchId, nomineeId: 'A2', reason: 'Attempt to change initial vote after runoff.' }), { code: 'NOMINATIONS_LOCKED' });
  await assert.rejects(env.command('nominate_award', { matchId, nomineeId: 'A1', reason: 'Attempted second runoff vote.', runoff: true }), { code: 'NOMINATION_ALREADY_SUBMITTED' });
  const result = await env.command('finalize_result', { matchId });
  assert.equal(result.receipt.result.awards.bestDebater.status, 'COAWARD'); assert.deepEqual(result.receipt.result.awards.bestDebater.winners, ['A1','A2','A3']);
});
