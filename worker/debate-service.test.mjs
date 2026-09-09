import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateService } from './debate-service.mjs';
import { createMemoryDebateStoreForTests } from './debate-store.mjs';
import { createDebateRoutes } from './debate-routes.mjs';

const host = { id: 'host-account', displayName: 'Neutral official', email: 'host@example.test', verified: true };
const person = n => ({ id: `member-${n}`, displayName: `Member ${n}`, email: `m${n}@example.test`, verified: true });
function environment(options = {}) {
  let time = 1800000000000, sequence = 0, eventId;
  const store = createMemoryDebateStoreForTests();
  const service = createDebateService({ store, now: () => time, ...options });
  const command = async (name, payload = {}, actor = host, extra = {}) => {
    const event = eventId ? await store.read(eventId) : null;
    const result = await service.execute({ actor, eventId, command: name, payload, expectedRevision: event?.revision || 0, idempotencyKey: `test-${String(++sequence).padStart(8, '0')}`, ...extra });
    eventId ||= result.event.id; return result;
  };
  return { store, service, command, advance: ms => { time += ms; }, now: () => time, get eventId() { return eventId; } };
}
async function setup(options = {}) {
  const env = environment(options);
  await env.command('create_event', { title: 'Controlled rehearsal', rehearsal: true });
  for (let n = 1; n <= 7; n++) {
    const invitation = await env.command('create_invite', { role: n === 7 ? 'observer' : 'debater', boundAccountId: person(n).id });
    await env.command('claim_invite', { secret: invitation.receipt.result.secret }, person(n), { expectedRevision: undefined });
    await env.command('check_in', {}, person(n));
    await env.command('admit_member', { memberId: person(n).id });
  }
  const a = await env.command('confirm_roster', { name: 'Affirmative team', speakerIds: [1, 2, 3].map(n => person(n).id), captainId: person(1).id });
  const n = await env.command('confirm_roster', { name: 'Negative team', speakerIds: [4, 5, 6].map(n => person(n).id), captainId: person(4).id });
  const motion = await env.command('add_motion', { text: 'This house would publish open learning materials.' });
  const match = await env.command('create_match', { motionId: motion.receipt.result.motionId, teamIds: { affirmative: a.receipt.result.teamId, negative: n.receipt.result.teamId }, judgeIds: [host.id] });
  env.matchId = match.receipt.result.matchId;
  await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 1 }, person(1));
  await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 1 }, person(4));
  for (let i = 1; i <= 6; i++) await env.command('record_device_check', { matchId: env.matchId, microphone: true }, person(i));
  return env;
}
async function finishFlow(env) {
  await env.command('start_match', { matchId: env.matchId });
  for (;;) {
    const saved = await env.store.read(env.eventId), match = saved.matches[env.matchId];
    if (match.phase === 'deliberation') break;
    assert.equal(match.timer.state, 'READY');
    await env.command('claim_clock', { matchId: match.id, timerVersion: match.timer.version });
    let timer = (await env.store.read(env.eventId)).matches[match.id].timer;
    await env.command('timer', { matchId: match.id, type: 'START', timerVersion: timer.version });
    env.advance(timer.durationMs + 1000);
    timer = (await env.store.read(env.eventId)).matches[match.id].timer;
    await env.command('claim_clock', { matchId: match.id, timerVersion: timer.version });
    timer = (await env.store.read(env.eventId)).matches[match.id].timer;
    await env.command('finish_stage', { matchId: match.id, timerVersion: timer.version });
    await env.command('next_stage', { matchId: match.id });
  }
}
const card = () => ({ speakers: Object.fromEntries(['A1','A2','A3','N1','N2','N3'].map(seat => [seat, { evidence: seat[0] === 'A' ? 25 : 20, delivery: 30, questioning: 15, responding: 15 }])), closing: { affirmative: 15, negative: 12 } });
test('timekeeper clock delegation does not grant moderation, roster or decision authority', async () => {
  const env = await setup(), original = (await env.store.read(env.eventId)).matches[env.matchId];
  const created = await env.command('create_match', { teamIds: original.teamIds, motionId: original.motionId, judgeIds: [host.id], timekeeperId: person(7).id });
  const matchId = created.receipt.result.matchId;
  for (const actor of [person(1), person(4)]) await env.command('acknowledge_rules', { matchId, ruleVersion: 1 }, actor);
  for (let n = 1; n <= 6; n++) await env.command('record_device_check', { matchId, microphone: true }, person(n));
  for (const [command, payload] of [['start_match', {}], ['conclude_match', { kind: 'forfeit', winner: 'negative', reason: 'Unauthorized timekeeper decision', confirmed: true }], ['quiet_observers', { quiet: true, reason: 'Unauthorized moderation' }], ['grant_floor', { memberId: person(7).id }], ['record_device_check', { memberId: person(1).id, microphone: true }], ['substitute_speaker', { seat: 'A1', memberId: person(7).id, reason: 'Unauthorized roster edit' }]]) await assert.rejects(env.command(command, { matchId, ...payload }, person(7)), { code: 'FORBIDDEN' });
  await env.command('start_match', { matchId });
  const claimed = await env.command('claim_clock', { matchId, timerVersion: (await env.store.read(env.eventId)).matches[matchId].timer.version }, person(7));
  await env.command('timer', { matchId, timerVersion: claimed.receipt.result.timer.version, type: 'START' }, person(7));
  assert.equal((await env.store.read(env.eventId)).matches[matchId].timer.controllerId, person(7).id);
});

test('closing defaults follow actual captain seats and prestart rules export includes the complete named run', async () => {
  const env = await setup(), original = (await env.store.read(env.eventId)).matches[env.matchId];
  await env.command('confirm_roster', { teamId: original.teamIds.affirmative, name: 'A', speakerIds: [1,2,3].map(n => person(n).id), captainId: person(2).id });
  await env.command('confirm_roster', { teamId: original.teamIds.negative, name: 'N', speakerIds: [4,5,6].map(n => person(n).id), captainId: person(6).id });
  const created = await env.command('create_match', { teamIds: original.teamIds, motionId: original.motionId, judgeIds: [host.id] });
  const matchId = created.receipt.result.matchId, saved = (await env.store.read(env.eventId)).matches[matchId];
  assert.deepEqual(saved.closingSeats, { affirmative: 'A2', negative: 'N3' });
  const exported = await env.command('create_export', { matchId, kind: 'rules' });
  const document = (await env.store.readJob(exported.receipt.result.jobId)).payload.document;
  assert.equal(document.runOfShow.filter(stage => stage.id.startsWith('stage-')).length, 14);
  assert.deepEqual(document.runOfShow.filter(stage => stage.kind === 'rebuttal').map(stage => stage.speakerSeats), [['N3'], ['A2']]);
  assert.deepEqual((await env.store.read(env.eventId)).matches[matchId].runOfShow, [], 'Preview does not create timer attempts or mark the match started.');
  await assert.rejects(env.command('create_match', { teamIds: original.teamIds, judgeIds: [host.id], chiefId: person(7).id }), { code: 'ROLE_CONFLICT' });
});

test('accepted judging rules remain immutable and live amendments block final ballots until both current captains accept', async () => {
  const env = await setup(); await finishFlow(env);
  const match = (await env.store.read(env.eventId)).matches[env.matchId];
  for (const rules of [{ judgingMode: 'simple' }, { rubric: { ...match.rules.rubric, weights: { ...match.rules.rubric.weights, evidence: 20, delivery: 35 } } }, { caseLabels: ['Changed necessity', 'Benefit', 'Practice'] }]) await assert.rejects(env.command('amend_rules', { matchId: env.matchId, rules, reason: 'Change after observing performances' }), { code: 'JUDGING_RULES_LOCKED' });
  const amend = async observerCameras => env.command('amend_rules', { matchId: env.matchId, rules: { observerCameras }, reason: 'Disclosed camera operating policy amendment' });
  const accept = async () => { const version = (await env.store.read(env.eventId)).matches[env.matchId].ruleVersion; for (const actor of [person(1), person(4)]) await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: version }, actor); };
  await amend(false); await assert.rejects(env.command('open_ballots', { matchId: env.matchId }), { code: 'RULES_ACKNOWLEDGMENT_REQUIRED' });
  await accept(); await env.command('open_ballots', { matchId: env.matchId }); await amend(true);
  await assert.rejects(env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), confirmed: true }), { code: 'RULES_ACKNOWLEDGMENT_REQUIRED' });
  await assert.rejects(env.command('close_ballots', { matchId: env.matchId }), { code: 'RULES_ACKNOWLEDGMENT_REQUIRED' });
  await accept(); await env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), confirmed: true }); await env.command('close_ballots', { matchId: env.matchId });
});

test('scheduled no-show grace requires explicit human findings and never treats prior attendance or disconnect as a no-show', async () => {
  const env = await setup(), original = (await env.store.read(env.eventId)).matches[env.matchId];
  await env.command('update_event', { scheduledAt: new Date(env.now()).toISOString() });
  const created = await env.command('create_match', { teamIds: original.teamIds, motionId: original.motionId, judgeIds: [host.id] });
  const matchId = created.receipt.result.matchId, payload = { matchId, memberId: person(2).id, reason: 'No arrival confirmed by moderator', confirmed: true };
  assert.equal(created.event.matches.find(m => m.id === matchId).checkIn.graceMs, 600000);
  await assert.rejects(env.command('record_no_show', payload), { code: 'NO_SHOW_GRACE_OPEN' });
  await env.command('check_in', { matchId }, person(1)); await env.command('check_in', { matchId, checkedIn: false }, person(1));
  env.advance(599999); await assert.rejects(env.command('record_no_show', payload), { code: 'NO_SHOW_GRACE_OPEN' }); env.advance(1);
  await assert.rejects(env.command('record_no_show', payload, person(7)), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('record_no_show', { ...payload, memberId: person(1).id }), { code: 'PARTICIPANT_ATTENDED' });
  const finding = await env.command('record_no_show', payload);
  assert.equal(finding.receipt.result.humanDecisionRequired, true); assert.equal((await env.store.read(env.eventId)).matches[matchId].phase, 'setup');
  await assert.rejects(env.command('update_match_schedule', { matchId, scheduledCheckInAt: new Date(env.now()+1000).toISOString() }), { code: 'SCHEDULE_LOCKED' });
  await env.command('check_in', { matchId }, person(2));
  await assert.rejects(env.command('conclude_match', { matchId, kind: 'forfeit', winner: 'negative', reason: 'Stale absence', confirmed: true, noShowFindingIds: [finding.receipt.result.findingId] }), { code: 'NO_SHOW_CHANGED' });
  const snapshot = await env.service.snapshot({ actor: host, eventId: env.eventId });
  assert.equal(snapshot.event.matches.find(m => m.id === matchId).checkIn.findings[0].status, 'ARRIVED_AFTER_FINDING');
});

test('declared sanctions keep raw ballots and awards intact, persist adjusted results, and require correction before reversal', async () => {
  const env = await setup();
  const policy = [{ id: 'misconduct', label: 'Declared serious breach', description: 'A separately documented occurrence confirmed by the moderator.', effect: 'team_point_deduction', points: '100.00' }];
  await assert.rejects(env.command('update_rules', { matchId: env.matchId, rules: { sanctions: policy } }), { code: 'SANCTION_MODE_UNSUPPORTED' });
  await env.command('update_rules', { matchId: env.matchId, rules: { judgingMode: 'aggregate', sanctions: policy } });
  for (const actor of [person(1), person(4)]) await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 2 }, actor);
  const issue = { matchId: env.matchId, action: 'issue', sanctionId: 'misconduct', target: { side: 'affirmative' }, reason: 'Explicit local test finding, never a provider event', confirmed: true, actorId: person(7).id, id: 'forged-id', at: 1 };
  await assert.rejects(env.command('record_sanction', issue), { code: 'SANCTION_RECORD_LOCKED' });
  await finishFlow(env);
  await assert.rejects(env.command('amend_rules', { matchId: env.matchId, rules: { sanctions: [] }, reason: 'Remove rule after play' }), { code: 'SANCTION_POLICY_LOCKED' });
  await assert.rejects(env.command('record_sanction', issue, person(7)), { code: 'FORBIDDEN' });
  const first = await env.command('record_sanction', issue, host, { idempotencyKey: 'sanction-once-12345' });
  const replay = await env.command('record_sanction', issue, host, { idempotencyKey: 'sanction-once-12345' });
  assert.equal(replay.receipt.id, first.receipt.id); assert.equal(first.receipt.result.record.actorId, host.id); assert.notEqual(first.receipt.result.record.id, 'forged-id');
  const second = await env.command('record_sanction', { ...issue, reason: 'A second separately documented local occurrence' });
  await env.command('open_ballots', { matchId: env.matchId }); await env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), confirmed: true });
  const rawBallots = structuredClone((await env.store.read(env.eventId)).matches[env.matchId].ballots);
  await env.command('close_ballots', { matchId: env.matchId }); await env.command('nominate_award', { matchId: env.matchId, nomineeId: 'A2', reason: 'Raw performance nomination unaffected by team sanctions' });
  const published = await env.command('publish_result', { matchId: env.matchId });
  const result = published.event.matches[0].resultVersions.at(-1);
  assert.equal(result.rawTally.winner, 'affirmative'); assert.equal(result.winner, 'negative'); assert.equal(result.adjustedTeamScores.affirmative.display, '-100.00'); assert.equal(result.adjustments.length, 2); assert.equal(result.awardBasis, 'raw_scorecards');
  assert.deepEqual((await env.store.read(env.eventId)).matches[env.matchId].ballots, rawBallots);
  await assert.rejects(env.command('record_sanction', { matchId: env.matchId, action: 'reverse', recordId: second.receipt.result.record.id, reason: 'Published record edit attempt', confirmed: true }), { code: 'SANCTION_RECORD_LOCKED' });
  env.advance(900000); const finalized = await env.command('finalize_result', { matchId: env.matchId });
  assert.equal(finalized.event.standings.rows.find(row => row.teamId === finalized.event.matches[0].teamIds.affirmative).meanScore.display, '-100.00');
  assert.equal(finalized.receipt.result.awards.bestDebater.winners[0], 'A2');
  const preserved = structuredClone((await env.store.read(env.eventId)).matches[env.matchId].resultVersions[0]);
  await env.command('correct_result', { matchId: env.matchId, reason: 'Review one disclosed sanction through a new result version' });
  await env.command('record_sanction', { matchId: env.matchId, action: 'reverse', recordId: second.receipt.result.record.id, reason: 'Evidence supports reversal of the second occurrence', confirmed: true });
  const historical = (await env.store.read(env.eventId)).matches[env.matchId].resultVersions[0];
  assert.deepEqual(historical.adjustedTeamScores, preserved.adjustedTeamScores); assert.deepEqual(historical.sanctions, preserved.sanctions); assert.equal(historical.state, 'SUPERSEDED');
});
const localVerifiedEvidence = async input => ({ verified: true, id: input.uploadId, mimeType: input.mimeType, size: input.size, digest: 'a'.repeat(64), storageKey: `evidence/${input.eventId}/${input.matchId}/${input.uploadId}.pdf` });
async function reserveLocalEvidence(env, actor, channel = 'public') {
  const reservation = await env.service.reserveEvidenceUpload({ actor, eventId: env.eventId, matchId: env.matchId, channel, mimeType: 'application/pdf' });
  const attachment = { uploadId: reservation.id, mimeType: 'application/pdf', size: 123 };
  await env.service.completeEvidenceUpload({ actor, eventId: env.eventId, matchId: env.matchId, reservationId: reservation.id, attachment });
  return { reservation, attachment };
}

test('membership-neutral complete persisted 14-stage flow, privacy, polls and finalized result', async () => {
  const env = await setup();
  const before = await env.service.snapshot({ actor: person(7), eventId: env.eventId });
  assert.equal(before.event.motions.length, 0, 'private motion must not leak before release');
  await finishFlow(env);
  const saved = await env.store.read(env.eventId);
  assert.equal(saved.matches[env.matchId].attempts.filter(a => a.stageId.startsWith('stage-') && a.state === 'FINISHED').length, 14);
  await env.command('save_draft', { matchId: env.matchId, scorecard: card(), notes: 'private confidential draft' });
  const observer = await env.service.snapshot({ actor: person(7), eventId: env.eventId });
  assert.ok(!JSON.stringify(observer).includes('private confidential draft'));
  assert.equal(observer.event.matches[0].myDraft, undefined);
  await env.command('open_ballots', { matchId: env.matchId });
  await assert.rejects(env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), confirmed: true }, person(1)), { code: 'FORBIDDEN' });
  await env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), winner: 'negative', confirmed: true });
  await env.command('close_ballots', { matchId: env.matchId });
  await env.command('open_poll', { matchId: env.matchId });
  await assert.rejects(env.command('vote', { matchId: env.matchId, side: 'negative' }), { code: 'FORBIDDEN' });
  await env.command('vote', { matchId: env.matchId, side: 'negative' }, person(7));
  await env.command('withdraw_vote', { matchId: env.matchId }, person(7));
  await env.command('vote', { matchId: env.matchId, side: 'affirmative' }, person(7));
  await env.command('close_poll', { matchId: env.matchId });
  const poll = await env.command('publish_poll', { matchId: env.matchId });
  assert.equal(poll.receipt.result.result.validVotes, 1);
  assert.equal(poll.receipt.result.result.turnoutPercent, 100);
  await env.command('nominate_award', { matchId: env.matchId, nomineeId: 'A2', reason: 'Clear argument and responsive questions.' });
  const published = await env.command('publish_result', { matchId: env.matchId });
  assert.equal(published.event.matches[0].resultVersions[0].winner, 'affirmative', 'forged client winner is ignored');
  await assert.rejects(env.command('finalize_result', { matchId: env.matchId }), { code: 'CORRECTION_WINDOW_OPEN' });
  env.advance(900000);
  const final = await env.command('finalize_result', { matchId: env.matchId });
  assert.equal(final.event.matches[0].phase, 'final');
  assert.equal(final.event.matches[0].resultVersions[0].awards.bestDebater.winners[0], 'A2');
});

test('expected revision, scoped payload idempotency and lost-response receipt semantics', async () => {
  const env = environment();
  const input = { actor: host, command: 'create_event', payload: { title: 'One' }, expectedRevision: 0, idempotencyKey: 'one-key-12345' };
  const first = await env.service.execute(input), second = await env.service.execute(input);
  assert.equal(first.receipt.id, second.receipt.id);
  await assert.rejects(env.service.execute({ ...input, payload: { title: 'Two' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  const edit = { actor: host, eventId: first.event.id, command: 'update_event', expectedRevision: 1, payload: { title: 'New' } };
  const attempts = await Promise.allSettled([env.service.execute({ ...edit, idempotencyKey: 'concurrent-a' }), env.service.execute({ ...edit, idempotencyKey: 'concurrent-b' })]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});

test('invite secrets hashed at rest, account bound, revocable and actor throttled', async () => {
  const env = environment(); await env.command('create_event', { title: 'Invites' });
  const invitation = await env.command('create_invite', { role: 'judge', boundAccountId: person(1).id });
  const secret = invitation.receipt.result.secret;
  assert.equal(secret.length, 12);
  assert.ok(!JSON.stringify(env.store.inspectForTests()).includes(secret));
  await assert.rejects(env.command('claim_invite', { secret }, person(2), { expectedRevision: undefined }), { code: 'INVITE_INVALID' });
  await env.command('revoke_invite', { inviteId: invitation.receipt.result.inviteId });
  await assert.rejects(env.command('claim_invite', { secret }, person(1), { expectedRevision: undefined }), { code: 'INVITE_INVALID' });
  for (let i = 0; i < 12; i++) await assert.rejects(env.command('claim_invite', { secret: 'INVALID12345' }, person(3), { expectedRevision: undefined }));
  await assert.rejects(env.command('claim_invite', { secret: 'INVALID12345' }, person(3), { expectedRevision: undefined }), { code: 'INVITE_RATE_LIMIT' });
});

test('private team messages and media grants enforce actual membership and safe pending state', async () => {
  const applied = [];
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => { applied.push(job); return { status: job.payload.action === 'leave' ? 'left' : 'ready', token: 'NEVER_STORE_THIS_TOKEN' }; } } });
  await env.command('start_match', { matchId: env.matchId });
  await env.command('send_message', { matchId: env.matchId, channel: 'team:affirmative', text: 'Private team strategy' }, person(1));
  const other = await env.service.snapshot({ actor: person(4), eventId: env.eventId });
  assert.ok(!JSON.stringify(other).includes('Private team strategy'));
  await assert.rejects(env.command('enter_space', { matchId: env.matchId, space: 'affirmative', deviceId: 'device-other' }, person(4)), { code: 'FORBIDDEN' });
  await env.command('enter_space', { matchId: env.matchId, space: 'affirmative', deviceId: 'device-a' }, person(1));
  await assert.rejects(env.service.authorizeMedia({ actor: person(1), eventId: env.eventId, matchId: env.matchId }), { code: 'MEDIA_PENDING' });
  await Promise.all([env.service.processOutbox({ eventId: env.eventId }), env.service.processOutbox({ eventId: env.eventId })]);
  assert.equal(applied.length, 1, 'one atomic job claim invokes adapter once');
  const permission = await env.service.authorizeMedia({ actor: person(1), eventId: env.eventId, matchId: env.matchId });
  assert.ok(permission.sources.includes('microphone'));
  assert.ok(!JSON.stringify(env.store.inspectForTests()).includes('NEVER_STORE_THIS_TOKEN'));
  await env.command('remove_member', { memberId: person(1).id });
  await assert.rejects(env.service.authorizeMedia({ actor: person(1), eventId: env.eventId, matchId: env.matchId }), { code: 'NOT_MEMBER' });
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(applied.at(-1).payload.action, 'leave');
});

test('route validates auth/body and cannot accept an actor supplied by client', async () => {
  const env = environment();
  const routes = createDebateRoutes({ service: env.service, authenticate: async req => req.headers.get('authorization') === 'valid' ? host : null });
  const denied = await routes.handle(new Request('https://example.test/debate-room/events'));
  assert.equal(denied.status, 401);
  const response = await routes.handle(new Request('https://example.test/debate-room/command', { method: 'POST', headers: { authorization: 'valid', 'content-type': 'application/json' }, body: JSON.stringify({ command: 'create_event', payload: { title: 'Authenticated' }, actor: person(1), expectedRevision: 0, idempotencyKey: 'route-test-12345' }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).event.ownerId, host.id);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal((await routes.handle(new Request('https://example.test/debate-room/discover'))).status, 401);
  const discovery = await routes.handle(new Request('https://example.test/debate-room/discover?limit=20', { headers: { authorization: 'valid' } }));
  assert.equal(discovery.status, 200); assert.equal(discovery.headers.get('cache-control'), 'no-store, private'); assert.deepEqual((await discovery.json()).events, []);
});

async function publishedMatch(env, finalize = true) {
  await finishFlow(env);
  await env.command('open_ballots', { matchId: env.matchId });
  await env.command('submit_ballot', { matchId: env.matchId, scorecard: card(), confirmed: true });
  await env.command('close_ballots', { matchId: env.matchId });
  await env.command('nominate_award', { matchId: env.matchId, nomineeId: 'A2', reason: 'Clear and responsive presentation.' });
  await env.command('publish_result', { matchId: env.matchId });
  if (finalize) { env.advance(900000); await env.command('finalize_result', { matchId: env.matchId }); }
}

test('pending private scorecard export reauthorizes after recusal and never calls renderer', async () => {
  let renders = 0;
  const env = await setup({ adapters: { export: async () => { renders++; return { status: 'completed' }; } } });
  await env.command('save_draft', { matchId: env.matchId, scorecard: card(), notes: 'private notes' });
  const queued = await env.command('create_export', { matchId: env.matchId, kind: 'scorecard' });
  await env.command('change_panel', { matchId: env.matchId, judgeIds: [person(7).id], reason: 'Declared conflict before start.' });
  const outcomes = await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(outcomes[0].status, 'failed');
  assert.equal(outcomes[0].error, 'FORBIDDEN');
  assert.equal(renders, 0);
  assert.equal((await env.store.readJob(queued.receipt.result.jobId)).status, 'failed');
});

test('downloads bind owner, current role, exact result, opaque storage path and expiry', async () => {
  const env = await setup({ adapters: { export: async job => ({ status: 'completed', downloadId: job.id, storageKey: `exports/${job.eventId}/${job.id}.pdf`, filename: 'authorized.pdf', mimeType: 'application/pdf' }) } });
  await publishedMatch(env);
  const queued = await env.command('create_export', { matchId: env.matchId, kind: 'result' }, person(7));
  await env.service.processOutbox({ eventId: env.eventId });
  const downloadId = queued.receipt.result.jobId;
  const authorized = await env.service.authorizeDownload({ actor: person(7), eventId: env.eventId, downloadId });
  assert.equal(authorized.storageKey, `exports/${env.eventId}/${downloadId}.pdf`);
  await assert.rejects(env.service.authorizeDownload({ actor: person(1), eventId: env.eventId, downloadId }), { code: 'FORBIDDEN' });
  await env.command('correct_result', { matchId: env.matchId, reason: 'Verified calculation correction.' });
  await assert.rejects(env.service.authorizeDownload({ actor: person(7), eventId: env.eventId, downloadId }), { code: 'RESULT_NOT_READY' });
});

test('mail recipient removal reauthorizes before delivery, and failed jobs keep result', async () => {
  let deliveries = 0;
  const env = await setup({ limits: { approvedRehearsalRecipientIds: [person(7).id] }, adapters: { mail: async () => { deliveries++; return { status: 'accepted', deliveryStatus: 'accepted_not_inbox_verified' }; } } });
  await publishedMatch(env);
  await env.command('send_results', { matchId: env.matchId, recipientIds: [person(7).id], confirmed: true, previewConfirmed: true });
  await env.command('remove_member', { memberId: person(7).id });
  const outcomes = await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(outcomes[0].status, 'failed');
  assert.equal(outcomes[0].error, 'NOT_MEMBER');
  assert.equal(deliveries, 0);
  assert.equal((await env.store.read(env.eventId)).matches[env.matchId].resultVersions.at(-1).state, 'FINAL');
});

test('simple ballot draft retains winner/reason and no invented numerical score', async () => {
  const env = await setup();
  await env.command('update_rules', { matchId: env.matchId, rules: { judgingMode: 'simple' } });
  await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 2 }, person(1));
  await env.command('acknowledge_rules', { matchId: env.matchId, ruleVersion: 2 }, person(4));
  await env.command('save_draft', { matchId: env.matchId, winner: 'negative', reason: 'More responsive answers.', notes: 'Private note', feedback: { negative: 'Clear responses.' } });
  await env.command('save_draft', { matchId: env.matchId, notes: 'Updated private note' });
  const draft = (await env.service.snapshot({ actor: host, eventId: env.eventId })).event.matches[0].myDraft;
  assert.equal(draft.winner, 'negative'); assert.equal(draft.reason, 'More responsive answers.'); assert.equal(draft.scorecard, null);
  await finishFlow(env); await env.command('open_ballots', { matchId: env.matchId });
  await env.command('submit_ballot', { matchId: env.matchId, confirmed: true });
  const ballot = (await env.store.read(env.eventId)).matches[env.matchId].ballots[`1:${host.id}`];
  assert.equal(ballot.winner, 'negative'); assert.equal(ballot.scorecard, null); assert.equal(ballot.feedback.negative, 'Clear responses.');
});

test('certificate uses confirmed participant and actual award; private evidence cannot be guessed', async () => {
  const env = await setup({ adapters: { validateEvidence: localVerifiedEvidence } });
  await env.command('start_match', { matchId: env.matchId });
  const { reservation, attachment } = await reserveLocalEvidence(env, person(1), 'team:affirmative');
  const file = await env.command('share_evidence', { matchId: env.matchId, channel: 'team:affirmative', title: 'Private study source', attachment }, person(1));
  const evidenceId = file.receipt.result.evidenceId;
  const access = await env.service.authorizeEvidence({ actor: person(1), eventId: env.eventId, matchId: env.matchId, evidenceId });
  assert.equal(access.attachmentId, reservation.id); assert.equal(access.digest, 'a'.repeat(64));
  await assert.rejects(env.service.authorizeEvidence({ actor: person(4), eventId: env.eventId, matchId: env.matchId, evidenceId }), { code: 'FORBIDDEN' });
  assert.ok(!JSON.stringify(await env.service.snapshot({ actor: person(1), eventId: env.eventId })).includes(access.storageKey));
  const completed = await setup(); await publishedMatch(completed);
  const certificate = await completed.service.authorizeDocument({ actor: host, eventId: completed.eventId, matchId: completed.matchId, kind: 'certificate', participantId: person(2).id, awardKey: 'bestDebater' });
  assert.equal(certificate.participant.id, person(2).id);
  assert.equal(certificate.certificateType, 'award');
  assert.deepEqual(certificate.participant.roles, ['debater']);
  assert.ok(certificate.participation.firstCheckedInAt);
  await assert.rejects(completed.service.authorizeDocument({ actor: host, eventId: completed.eventId, matchId: completed.matchId, kind: 'certificate', participantId: person(7).id }), { code: 'PARTICIPATION_UNCONFIRMED' });
  await assert.rejects(completed.command('check_in', { matchId: completed.matchId }, person(7)), { code: 'MATCH_ALREADY_CONCLUDED' });
  await assert.rejects(completed.service.authorizeDocument({ actor: host, eventId: completed.eventId, matchId: completed.matchId, kind: 'certificate', participantId: person(4).id, awardKey: 'bestDebater' }), { code: 'AWARD_UNCONFIRMED' });
});

test('durable job completion repairs a lost event projection without repeated external delivery', async () => {
  let renders = 0;
  const env = await setup({ adapters: { export: async job => { renders++; return { status: 'completed', downloadId: job.id, storageKey: `exports/${job.eventId}/${job.id}.pdf` }; } } });
  const queued = await env.command('create_export', { matchId: env.matchId, kind: 'rules' });
  const originalCommit = env.store.commit;
  env.store.commit = request => request.command === '__outbox_complete' ? Promise.reject(Object.assign(new Error('Injected unavailable projection'), { code: 'STORE_UNAVAILABLE' })) : originalCommit(request);
  await assert.rejects(env.service.processOutbox({ eventId: env.eventId }), { code: 'STORE_UNAVAILABLE' });
  assert.equal((await env.store.readJob(queued.receipt.result.jobId)).status, 'completed');
  assert.equal((await env.store.read(env.eventId)).jobs[queued.receipt.result.jobId].status, 'queued');
  env.store.commit = originalCommit;
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(renders, 1);
  assert.equal((await env.store.read(env.eventId)).jobs[queued.receipt.result.jobId].status, 'completed');
});

test('expired media keeps its capacity seat until authorized provider cleanup confirms', async () => {
  const actions = [];
  const env = await setup({ limits: { maxParticipants: 1 }, adapters: { media: async job => { actions.push(job.payload.action); return { status: job.payload.action === 'leave' ? 'left' : 'ready' }; } } });
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'one-device' }, person(1));
  await env.service.processOutbox({ eventId: env.eventId });
  env.advance(120001);
  await assert.rejects(env.command('enter_space', { matchId: env.matchId, deviceId: 'two-device' }, person(2)), { code: 'CAPACITY_LIMIT' });
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(actions.at(-1), 'leave');
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'two-device' }, person(2));
});

test('media changes retire immutable epochs without losing older revocations or rotating on unrelated actions', async () => {
  const applied = [];
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => { applied.push(job); return { status: job.payload.action === 'leave' ? 'left' : 'ready' }; } } });
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'one-device' }, person(1));
  await env.service.processOutbox({ eventId: env.eventId });
  const initial = (await env.store.read(env.eventId)).media[person(1).id];
  await env.command('grant_floor', { matchId: env.matchId, memberId: person(7).id });
  await env.command('renew_media', { matchId: env.matchId, deviceId: 'one-device' }, person(1));
  assert.equal((await env.store.read(env.eventId)).media[person(1).id].identity, initial.identity);
  await env.command('grant_floor', { matchId: env.matchId, memberId: person(1).id });
  const pending = (await env.store.read(env.eventId)).media[person(1).id];
  assert.notEqual(pending.identity, initial.identity);
  await env.command('grant_floor', { matchId: env.matchId, memberId: person(1).id, granted: false });
  const latest = (await env.store.read(env.eventId)).media[person(1).id];
  assert.notEqual(latest.identity, pending.identity);
  assert.deepEqual(latest.revocations.map(s => s.identity), [initial.identity], 'Never-ready intermediate epochs cannot have credentials; preserve the prior actual live epoch.');
  await assert.rejects(env.command('cancel_job', { jobId: latest.operationId }), { code: 'FORBIDDEN' });
  await assert.rejects(env.service.authorizeMedia({ actor: person(1), eventId: env.eventId, matchId: env.matchId }), { code: 'MEDIA_PENDING' });
  const view = await env.service.snapshot({ actor: person(1), eventId: env.eventId });
  assert.equal(view.event.matches[0].myMedia.revocations, undefined);
  assert.deepEqual(view.event.matches[0].mediaParticipants, [{ userId: person(1).id, identity: latest.identity }]);
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(applied.length, 2, 'Superseded intermediate epoch never calls provider.');
  assert.deepEqual(applied[1].payload.session.revocations.map(s => s.identity), [initial.identity]);
  assert.deepEqual((await env.store.read(env.eventId)).media[person(1).id].revocations, []);
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'second-device', handoff: true }, person(1));
  assert.notEqual((await env.store.read(env.eventId)).media[person(1).id].identity, latest.identity, 'Same-room device handoff retires previous token.');
});

test('expired floor grants reconcile with server time while valid media leases keep their camera', async () => {
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => ({ status: job.payload.action === 'leave' ? 'left' : 'ready' }) } });
  await env.command('grant_floor', { matchId: env.matchId, memberId: person(7).id });
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'observer-device' }, person(7));
  await env.service.processOutbox({ eventId: env.eventId });
  const initial = (await env.store.read(env.eventId)).media[person(7).id];
  assert.deepEqual(initial.sources, ['camera', 'microphone']);
  for (let i = 0; i < 2; i++) { env.advance(100000); await env.command('renew_media', { matchId: env.matchId, deviceId: 'observer-device' }, person(7)); }
  env.advance(100001);
  await assert.rejects(env.service.authorizeMedia({ actor: person(7), eventId: env.eventId, matchId: env.matchId }), { code: 'MEDIA_PENDING' });
  await env.service.sweep();
  const current = await env.service.authorizeMedia({ actor: person(7), eventId: env.eventId, matchId: env.matchId });
  assert.notEqual(current.identity, initial.identity); assert.deepEqual(current.sources, ['camera']);
  env.advance(120001); await env.service.sweep();
  assert.equal((await env.store.read(env.eventId)).media[person(7).id].status, 'left');
  await assert.rejects(env.command('renew_media', { matchId: env.matchId, deviceId: 'observer-device' }, person(7)), { code: 'MEDIA_SESSION_CONFLICT' });
});

test('role removed during provider await cannot publish stale ready state or obtain a new credential', async () => {
  let began, release;
  const started = new Promise(resolve => { began = resolve; });
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => {
    if (job.payload.action === 'leave') return { status: 'left' };
    began(); await new Promise(resolve => { release = resolve; }); return { status: 'ready' };
  } } });
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'one-device' }, person(1));
  const processing = env.service.processOutbox({ eventId: env.eventId }); await started;
  await env.command('remove_member', { memberId: person(1).id }); release();
  const outcome = await processing;
  assert.equal(outcome[0].status, 'failed'); assert.equal(outcome[0].error, 'MEDIA_SESSION_CONFLICT');
  assert.equal((await env.store.read(env.eventId)).media[person(1).id].status, 'left', 'Just-in-time claim can immediately process the committed revocation.');
  await env.service.processOutbox({ eventId: env.eventId });
  assert.equal((await env.store.read(env.eventId)).media[person(1).id].status, 'left');
});

test('export scorecards include only named roster and the requesting judge private document', async () => {
  const env = await setup();
  const document = await env.service.authorizeDocument({ actor: host, eventId: env.eventId, matchId: env.matchId, kind: 'scorecard' });
  assert.equal(document.seats.A1, person(1).id);
  assert.equal(document.participants.find(p => p.id === person(1).id).displayName, person(1).displayName);
  assert.ok(document.teamRoster.some(t => t.name === 'Affirmative team'));
  assert.ok(!JSON.stringify(document).includes('@example.test'));
});

test('media identity roster reveals only the viewer authorized current space and removes revoked peers', async () => {
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => ({ status: job.payload.action === 'leave' ? 'left' : 'ready' }) } });
  await env.command('start_match', { matchId: env.matchId });
  for (const n of [1, 2, 4]) await env.command('enter_space', { matchId: env.matchId, space: n === 4 ? 'negative' : 'affirmative', deviceId: `device-${n}` }, person(n));
  await env.service.processOutbox({ eventId: env.eventId });
  const roster = async actor => (await env.service.snapshot({ actor, eventId: env.eventId })).event.matches[0].mediaParticipants;
  assert.deepEqual((await roster(person(1))).map(p => p.userId), [person(1).id, person(2).id]);
  assert.deepEqual((await roster(person(4))).map(p => p.userId), [person(4).id]);
  assert.deepEqual(await roster(host), [], 'Organizer in main cannot inspect private media identities.');
  await env.command('remove_member', { memberId: person(2).id });
  assert.deepEqual((await roster(person(1))).map(p => p.userId), [person(1).id]);
});

test('public discovery and join require identity and current visibility, with host-admission privacy', async () => {
  const env = await setup(), visitor = person(101);
  assert.deepEqual((await env.service.discover({ actor: visitor })).events, []);
  await env.command('update_event', { visibility: 'public' });
  assert.deepEqual((await env.service.discover({ actor: visitor })).events, [], 'Rehearsals never appear in public discovery.');
  const publicEnv = environment(); await publicEnv.command('create_event', { title: 'Public learning debate', visibility: 'public' });
  await publicEnv.command('add_motion', { text: 'Confidential future motion.' });
  await assert.rejects(publicEnv.service.discover({ actor: null }), { code: 'AUTH_REQUIRED' });
  const discover = await publicEnv.service.discover({ actor: visitor });
  assert.deepEqual(Object.keys(discover.events[0]).sort(), ['description', 'id', 'language', 'scheduledAt', 'status', 'timezone', 'title']);
  assert.ok(!JSON.stringify(discover).includes('Confidential')); assert.ok(!JSON.stringify(discover).includes(host.id));
  const joined = await publicEnv.command('join_public_event', { roles: ['host'], admitted: true }, visitor, { expectedRevision: undefined });
  assert.equal(joined.event.awaitingAdmission, true); assert.deepEqual(joined.event.members[0].roles, ['observer']);
  assert.equal(joined.event.members.length, 1); assert.deepEqual(joined.event.motions, []); assert.deepEqual(joined.event.matches, []); assert.deepEqual(joined.event.invites, []);
  await assert.rejects(publicEnv.command('add_motion', { text: 'Intrusion' }, visitor), { code: 'FORBIDDEN' });
  await publicEnv.command('check_in', {}, visitor);
  await publicEnv.command('admit_member', { memberId: visitor.id });
  const admitted = await publicEnv.service.snapshot({ actor: visitor, eventId: publicEnv.eventId });
  assert.equal(admitted.event.awaitingAdmission, undefined); assert.ok(admitted.event.members.some(p => p.id === host.id));
  await publicEnv.command('remove_member', { memberId: visitor.id });
  await assert.rejects(publicEnv.command('join_public_event', {}, visitor, { expectedRevision: undefined }), { code: 'FORBIDDEN' });
  await publicEnv.command('update_event', { visibility: 'unlisted' });
  await assert.rejects(publicEnv.command('join_public_event', {}, person(102), { expectedRevision: undefined }), { code: 'PUBLIC_EVENT_UNAVAILABLE' });
  assert.deepEqual((await publicEnv.service.discover({ actor: person(102) })).events, []);
});

test('revoked admission removes private channels and denies old document downloads or ballot mutation', async () => {
  const env = await setup();
  await env.command('send_message', { matchId: env.matchId, channel: 'team:affirmative', text: 'Private strategy' }, person(1));
  await env.command('admit_member', { memberId: person(1).id, admitted: false });
  const waiting = await env.service.snapshot({ actor: person(1), eventId: env.eventId });
  assert.equal(waiting.event.awaitingAdmission, true); assert.deepEqual(waiting.event.matches, []);
  assert.ok(!JSON.stringify(waiting).includes('Private strategy'));
  await assert.rejects(env.service.authorizeDocument({ actor: person(1), eventId: env.eventId, matchId: env.matchId, kind: 'rules' }), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('send_message', { matchId: env.matchId, channel: 'team:affirmative', text: 'Blocked' }, person(1)), { code: 'FORBIDDEN' });
});

test('stage start waits for provider permission confirmation; timer ticks do not rotate stable camera', async () => {
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => ({ status: job.payload.action === 'leave' ? 'left' : 'ready' }) } });
  await env.command('start_match', { matchId: env.matchId });
  await env.command('enter_space', { matchId: env.matchId, deviceId: 'one-device' }, person(1));
  await env.command('claim_clock', { matchId: env.matchId });
  const timer = (await env.store.read(env.eventId)).matches[env.matchId].timer;
  await assert.rejects(env.command('timer', { matchId: env.matchId, type: 'START', timerVersion: timer.version }), { code: 'MEDIA_PENDING' });
  await env.service.processOutbox({ eventId: env.eventId });
  const identity = (await env.store.read(env.eventId)).media[person(1).id].identity;
  await env.command('timer', { matchId: env.matchId, type: 'START', timerVersion: timer.version });
  env.advance(1000);
  const running = (await env.store.read(env.eventId)).matches[env.matchId].timer;
  await env.command('timer', { matchId: env.matchId, type: 'PAUSE', timerVersion: running.version });
  assert.equal((await env.store.read(env.eventId)).media[person(1).id].identity, identity);
});

test('create and update validate schedule/timezone and never silently change started rehearsal provenance', async () => {
  for (const scheduledAt of ['not-a-date', '2026-02-30T12:00:00Z', '2026-09-09T12:00', 12345]) {
    await assert.rejects(environment().command('create_event', { title: 'Invalid calendar', scheduledAt }), { code: 'INVALID_SCHEDULE' });
  }
  await assert.rejects(environment().command('create_event', { title: 'Invalid zone', timezone: 'Mars/Olympus' }), { code: 'INVALID_TIMEZONE' });
  const env = await setup();
  await env.command('update_event', { scheduledAt: '2026-09-10T16:00:00+08:00', timezone: 'Asia/Tokyo', rehearsal: false });
  let saved = await env.store.read(env.eventId);
  assert.equal(saved.scheduledAt, '2026-09-10T08:00:00.000Z'); assert.equal(saved.timezone, 'Asia/Tokyo'); assert.equal(saved.rehearsal, false);
  await env.command('start_match', { matchId: env.matchId });
  await assert.rejects(env.command('update_event', { timezone: 'Asia/Manila' }), { code: 'EVENT_SETTINGS_LOCKED' });
  await assert.rejects(env.command('update_event', { rehearsal: true }), { code: 'EVENT_SETTINGS_LOCKED' });
  await env.command('update_event', { title: 'Rename only', timezone: 'Asia/Tokyo', rehearsal: false });
  saved = await env.store.read(env.eventId); assert.equal(saved.title, 'Rename only'); assert.equal(saved.rehearsal, false);
});

test('confirmed evidence deletion is a completed durable outcome, never a false retry failure', async () => {
  const removed = [];
  const env = await setup({ adapters: {
    validateEvidence: localVerifiedEvidence,
    delete_evidence: async job => { removed.push(job.payload.storageKey); return { status: 'deleted' }; },
  } });
  const { attachment } = await reserveLocalEvidence(env, person(1));
  await env.command('share_evidence', { matchId: env.matchId, channel: 'public', title: 'Local evidence', attachment }, person(1));
  await env.command('end_event'); env.advance(91 * 86400000);
  await env.command('set_retention', { approved: true }, { ...host, platformOperator: true });
  await env.command('cleanup_records', {}, { ...host, platformOperator: true });
  const outcome = await env.service.processOutbox({ eventId: env.eventId });
  assert.equal(outcome[0].status, 'completed'); assert.equal(outcome[0].error, null); assert.equal(removed.length, 1);
  await env.service.processOutbox({ eventId: env.eventId }); assert.equal(removed.length, 1);
});

test('contacts are validated and private to admitted members; retention capability uses trusted actor and capacity', async () => {
  const env = await setup({ limits: { maxParticipants: 12 } });
  await env.command('update_event', { contact: { name: 'Contact desk', email: 'DESK@example.test', url: 'https://example.test/contact' } });
  const memberView = await env.service.snapshot({ actor: person(7), eventId: env.eventId });
  assert.equal(memberView.event.contact.email, 'desk@example.test'); assert.equal(memberView.event.canManageRetention, false); assert.equal(memberView.event.maxMediaParticipants, 12);
  assert.equal((await env.service.snapshot({ actor: { ...host, platformOperator: true }, eventId: env.eventId })).event.canManageRetention, true);
  await assert.rejects(env.command('update_event', { contact: { url: 'https://user:secret@example.test' } }), { code: 'INVALID_CONTACT' });
  await assert.rejects(env.command('update_event', { contact: { email: 'invalid' } }), { code: 'INVALID_EMAIL' });
  await env.command('admit_member', { memberId: person(7).id, admitted: false });
  assert.equal((await env.service.snapshot({ actor: person(7), eventId: env.eventId })).event.contact, undefined);
});

test('event end immediately expires unused invitations and cannot silently restart speaking', async () => {
  const env = await setup(), unused = await env.command('create_invite', { role: 'observer' });
  await env.command('end_event'); const ended = (await env.store.read(env.eventId)).endsAt; env.advance(10000);
  await env.command('end_event'); assert.equal((await env.store.read(env.eventId)).endsAt, ended);
  await assert.rejects(env.command('claim_invite', { secret: unused.receipt.result.secret }, person(99)), { code: 'INVITE_INVALID' });
  await assert.rejects(env.command('create_invite', { role: 'observer' }), { code: 'EVENT_ENDED' });
  await assert.rejects(env.command('start_match'), { code: 'EVENT_ENDED' });
  await assert.rejects(env.command('create_match', {}), { code: 'EVENT_ENDED' });
});

test('authorized paginated history keeps channel privacy and quiet observers retain technical help', async () => {
  const env = await setup();
  for (let i = 0; i < 5; i++) { await env.command('send_message', { matchId: env.matchId, text: `Message ${i}` }, person(7)); env.advance(11000); }
  await env.command('send_message', { matchId: env.matchId, channel: 'team:affirmative', text: 'Team private' }, person(1));
  const newest = await env.service.messages({ actor: person(7), eventId: env.eventId, matchId: env.matchId, limit: 2 });
  assert.deepEqual(newest.messages.map(m => m.text), ['Message 3','Message 4']); assert.ok(newest.nextCursor);
  const older = await env.service.messages({ actor: person(7), eventId: env.eventId, matchId: env.matchId, limit: 2, before: newest.nextCursor });
  assert.deepEqual(older.messages.map(m => m.text), ['Message 1','Message 2']);
  await assert.rejects(env.service.messages({ actor: person(7), eventId: env.eventId, matchId: env.matchId, channel: 'team:affirmative' }), { code: 'FORBIDDEN' });
  await assert.rejects(env.service.messages({ actor: person(7), eventId: env.eventId, matchId: env.matchId, before: 'unknown' }), { code: 'INVALID_CURSOR' });
  await assert.rejects(env.command('quiet_observers', { quiet: true, reason: 'Quiet round' }, person(7)), { code: 'FORBIDDEN' });
  assert.equal((await env.command('quiet_observers', { quiet: true, reason: 'Quiet round' })).event.matches[0].quietObservers, true);
  await assert.rejects(env.command('send_message', { text: 'Public disruption' }, person(7)), { code: 'FORBIDDEN' });
  await env.command('send_message', { channel: 'technical', text: 'Need audio help' }, person(7));
});

test('expired exports and all four retention categories require approval, honor holds and retry storage cleanup', async () => {
  const removed = []; let failDeletion = true;
  const env = await setup({ adapters: { export: async job => ({ status: 'ready', downloadId: job.id }), delete_export: async job => { if (failDeletion) throw new Error('Local storage unavailable'); removed.push(job.payload.storageKey); return { status: 'deleted' }; } } });
  await env.command('save_draft', { scorecard: card(), notes: 'Expiry private notes' });
  await env.command('send_message', { text: 'Expiry private chat', channel: 'judges' });
  const output = await env.command('create_export', { kind: 'scorecard' }), jobId = output.receipt.result.jobId;
  await env.service.processOutbox({ eventId: env.eventId });
  await env.command('end_event'); env.advance(8 * 86400000);
  await assert.rejects(env.command('cleanup_records', {}, { ...host, platformOperator: true }), { code: 'RETENTION_UNAPPROVED' });
  await env.command('set_retention', { approved: true, hold: true, reason: 'Local retention test hold', operationalDays: 1, chatDays: 1, evidenceDays: 1, officialDays: 1 }, { ...host, platformOperator: true });
  await assert.rejects(env.command('cleanup_records', {}, { ...host, platformOperator: true }), { code: 'RETENTION_HOLD' });
  assert.ok((await env.store.readJob(jobId)).payload.document.draft.notes);
  await env.command('set_retention', { hold: false, reason: 'Local hold released' }, { ...host, platformOperator: true });
  const sweep = await env.service.sweep(); assert.ok(sweep.outcomes.length);
  const saved = await env.store.read(env.eventId), expired = await env.store.readJob(jobId);
  assert.deepEqual(Object.keys(saved.retention.purged).sort(), ['chat','evidence','official','operational']);
  assert.equal(saved.matches[env.matchId].messages.length, 0); assert.deepEqual(saved.matches[env.matchId].drafts, {});
  assert.equal(expired.payload.document, undefined); assert.ok(expired.payload.retentionPurgedAt); assert.equal(expired.status, 'cancelled');
  assert.equal(removed.length, 0); failDeletion = false; env.advance(3000); await env.service.sweep(); assert.equal(removed.length, 1);
  await assert.rejects(env.service.authorizeDownload({ actor: host, eventId: env.eventId, downloadId: jobId }), { code: 'FORBIDDEN' });
  await assert.rejects(env.command('send_message', { text: 'Cannot revive expired records' }), { code: 'EVENT_ENDED' });
});

test('outbox claims one job at a time and leaves later work unclaimed after its deadline', async () => {
  let env, calls = 0;
  env = await setup({ adapters: { export: async job => { calls++; env.advance(46000); return { status: 'ready', downloadId: job.id }; } } });
  await env.command('create_export', { kind: 'rules' }); const second = await env.command('create_export', { kind: 'rules' });
  await env.service.processOutbox({ eventId: env.eventId, limit: 20, deadlineAt: env.now() + 45000 });
  assert.equal(calls, 1); assert.equal((await env.store.readJob(second.receipt.result.jobId)).status, 'queued');
});

test('organizers cannot cancel committed evidence/export lifecycle deletion or strand retained private objects', async () => {
  const deleted = [];
  const env = await setup({ adapters: { validateEvidence: localVerifiedEvidence, export: async job => ({ status: 'ready', downloadId: job.id }), delete_evidence: async job => { deleted.push(job.type); return { status: 'deleted' }; }, delete_export: async job => { deleted.push(job.type); return { status: 'deleted' }; } } });
  const { attachment } = await reserveLocalEvidence(env, person(1)); await env.command('share_evidence', { title: 'Retained evidence', attachment }, person(1));
  const orphan = await env.service.reserveEvidenceUpload({ actor: person(1), eventId: env.eventId, matchId: env.matchId, channel: 'public', mimeType: 'application/pdf' });
  await assert.rejects(env.command('cancel_job', { jobId: orphan.cleanupJobId }), { code: 'FORBIDDEN' });
  await env.command('create_export', { kind: 'rules' }); await env.service.processOutbox({ eventId: env.eventId });
  await env.command('end_event'); await env.command('set_retention', { approved: true, evidenceDays: 1 }, { ...host, platformOperator: true }); env.advance(8 * 86400000);
  await env.command('cleanup_records', {}, { ...host, platformOperator: true });
  const jobs = (await env.store.read(env.eventId)).jobs;
  for (const job of Object.values(jobs).filter(job => ['delete_evidence','delete_export'].includes(job.type))) {
    await assert.rejects(env.command('cancel_job', { jobId: job.id }), { code: 'FORBIDDEN' });
    assert.equal((await env.store.readJob(job.id)).status, 'queued');
  }
  await env.service.processOutbox({ eventId: env.eventId }); assert.ok(deleted.includes('delete_evidence')); assert.ok(deleted.includes('delete_export'));
});

test('per-recipient job labels are visible to organizer/creator and absent from other participant snapshots', async () => {
  const env = await setup({ limits: { approvedRehearsalRecipientEmails: ['target@example.test'] }, adapters: { sealInvitation: async () => 'v1.opaque-local-ciphertext' } });
  const invite = (await env.command('create_invite', { role: 'observer', boundEmail: 'target@example.test' })).receipt.result;
  const sent = await env.command('send_invitation', { inviteId: invite.inviteId, recipientEmail: 'target@example.test', secret: invite.secret, previewConfirmed: true, confirmed: true });
  assert.equal(sent.event.outbox.find(job => job.id === sent.receipt.result.jobId).recipientLabel, 'target@example.test');
  assert.ok(!JSON.stringify(await env.service.snapshot({ actor: person(7), eventId: env.eventId })).includes('target@example.test'));
});

test('observer camera policy edits immediately replace provider epochs while preserving microphone permissions', async () => {
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => ({ status: job.payload.action === 'leave' ? 'left' : 'ready' }) } });
  await env.command('grant_floor', { memberId: person(7).id });
  await env.command('enter_space', { deviceId: 'observer-camera' }, person(7)); await env.service.processOutbox({ eventId: env.eventId });
  const before = (await env.store.read(env.eventId)).media[person(7).id]; assert.deepEqual(before.sources, ['camera','microphone']);
  await env.command('update_rules', { rules: { observerCameras: false } });
  const after = (await env.store.read(env.eventId)).media[person(7).id];
  assert.notEqual(after.identity, before.identity); assert.equal(after.status, 'pending'); assert.deepEqual(after.sources, ['microphone']); assert.equal(after.revocations[0].identity, before.identity);
  await assert.rejects(env.service.authorizeMedia({ actor: person(7), eventId: env.eventId, matchId: env.matchId, deviceId: 'observer-camera' }), { code: 'MEDIA_PENDING' });
});

test('abandoned uploads survive actor removal and expire through retryable private cleanup', async () => {
  let calls = 0;
  const env = await setup({ adapters: { delete_evidence: async () => { if (++calls === 1) throw new Error('Injected storage outage'); return { status: 'deleted' }; } } });
  const reservation = await env.service.reserveEvidenceUpload({ actor: person(1), eventId: env.eventId, matchId: env.matchId, channel: 'public', mimeType: 'application/pdf' });
  assert.equal((await env.store.readUpload(reservation.id)).status, 'reserved');
  assert.equal((await env.store.readJob(reservation.cleanupJobId)).status, 'queued');
  await env.service.processOutbox({ eventId: env.eventId }); assert.equal(calls, 0, 'No cleanup while upload reservation remains valid.');
  await env.command('remove_member', { memberId: person(1).id }); env.advance(1800001);
  await env.service.sweep(); assert.equal(calls, 1); assert.equal((await env.store.readJob(reservation.cleanupJobId)).status, 'failed');
  env.advance(2001); await env.service.sweep(); assert.equal(calls, 2); assert.equal((await env.store.readUpload(reservation.id)).status, 'deleted');
});

test('sharing atomically retains only the matching completed upload and cancels orphan cleanup', async () => {
  const deleted = [], env = await setup({ adapters: { validateEvidence: localVerifiedEvidence, delete_evidence: async job => { deleted.push(job.payload.storageKey); return { status: 'deleted' }; } } });
  const { reservation, attachment } = await reserveLocalEvidence(env, person(1), 'team:affirmative');
  await assert.rejects(env.command('share_evidence', { matchId: env.matchId, title: 'Wrong audience', channel: 'public', attachment }, person(1)), { code: 'UPLOAD_UNAVAILABLE' });
  await env.command('share_evidence', { matchId: env.matchId, title: 'Team source', channel: 'team:affirmative', attachment }, person(1));
  assert.equal((await env.store.readUpload(reservation.id)).status, 'retained'); assert.equal((await env.store.readJob(reservation.cleanupJobId)).status, 'cancelled');
  await assert.rejects(env.command('share_evidence', { matchId: env.matchId, title: 'Duplicate', channel: 'team:affirmative', attachment }, person(1)), { code: 'UPLOAD_UNAVAILABLE' });
  env.advance(1800001); await env.service.sweep(); assert.equal(deleted.length, 0);
});

test('upload completion rechecks authorization after awaited byte verification; failure queues immediate cleanup', async () => {
  let revoke = false;
  const env = await setup({ adapters: { validateEvidence: async input => { if (revoke) await env.command('admit_member', { memberId: person(1).id, admitted: false }); return localVerifiedEvidence(input); }, delete_evidence: async () => ({ status: 'deleted' }) } });
  const actor = person(1), reservation = await env.service.reserveEvidenceUpload({ actor, eventId: env.eventId, matchId: env.matchId, channel: 'public', mimeType: 'application/pdf' });
  revoke = true;
  await assert.rejects(env.service.completeEvidenceUpload({ actor, eventId: env.eventId, matchId: env.matchId, reservationId: reservation.id, attachment: { uploadId: reservation.id, mimeType: 'application/pdf', size: 123 } }), { code: 'FORBIDDEN' });
  await env.service.failEvidenceUpload({ actor, eventId: env.eventId, reservationId: reservation.id });
  await env.service.processOutbox({ eventId: env.eventId }); assert.equal((await env.store.readUpload(reservation.id)).status, 'deleted');
});
