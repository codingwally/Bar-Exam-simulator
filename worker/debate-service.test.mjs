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
  const env = await setup({ limits: { maxParticipants: 10 }, adapters: { media: async job => { applied.push(job); return { status: 'ready', token: 'NEVER_STORE_THIS_TOKEN' }; } } });
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
});
