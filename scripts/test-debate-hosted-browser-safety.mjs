import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCiExecution, hostedBrowserEnvironment, finalizeHostedBrowserShutdown, HOSTED_DEFAULT_TIMED_STAGES,
  assertHostedDefaultRunOfShow, assertHostedFinishedAttempt, assertHostedCorrectedAwards, assertHostedExportVersion,
  assertHostedNextMatchState, assertHostedPriorMatchPreserved, summarizeHostedBootstrap, summarizeHostedNavigation } from './test-debate-browser-hosted-organizer.mjs';
import { createRunOfShow, calculateAwards } from '../worker/debate-domain.mjs';

const seats = Object.fromEntries(['A1', 'A2', 'A3', 'N1', 'N2', 'N3'].map(seat => [seat, `inert-${seat}`]));

test('failed bootstrap diagnostics classify 403 without retaining credentials, private bodies or foreign URLs', () => {
  const origin = 'https://staging.invalid', secret = 'PRIVATE_SENTINEL_DO_NOT_STORE';
  const value = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 403, origin,
    contentType: `application/json; private=${secret}`, body: { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: secret }, private: secret },
    headers: { Authorization: `Bearer ${secret}`, Referer: `https://${secret}.invalid/#invite=${secret}`,
      Origin: `https://${secret}.invalid`, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Cookie: secret } });
  assert.equal(value.status, 403); assert.equal(value.errorCode, 'ORIGIN_NOT_ALLOWED'); assert.equal(value.ok, false);
  assert.deepEqual(value.request, { origin: 'OTHER', fetchSite: 'same-origin', fetchMode: 'cors', fetchDest: 'empty', referer: 'OTHER', authorizationPresent: true });
  assert.equal(value.contentType, 'application/json'); assert.equal(value.eventCount, null);
  assert.ok(!JSON.stringify(value).includes(secret));
  const unknown = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 403, origin,
    contentType: secret, body: { error: { code: secret } }, headers: { 'sec-fetch-site': secret, referer: secret } });
  assert.equal(unknown.errorCode, 'OTHER_ERROR'); assert.ok(!JSON.stringify(unknown).includes(secret));
  assert.equal(unknown.request.origin, 'ABSENT'); assert.equal(unknown.request.authorizationPresent, false);
});

test('bootstrap success and malformed response retain only bounded structural facts on the two fixed routes', () => {
  const origin = 'https://staging.invalid';
  for (const pathname of ['/debate-room/events', '/debate-room/discover']) {
    const result = summarizeHostedBootstrap({ pathname, status: 200, origin, contentType: 'Application/JSON; charset=utf-8',
      body: { ok: true, events: [{ title: 'PRIVATE_TITLE' }] }, headers: { origin, referer: `${origin}/debate-room/#invite=PRIVATE_INVITE` } });
    assert.equal(result.eventCount, 1); assert.equal(result.ok, true); assert.equal(result.errorCode, null);
    assert.equal(result.request.origin, 'same-origin'); assert.equal(result.request.referer, 'same-origin');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const malformed = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 502, origin, body: null });
  assert.equal(malformed.ok, null); assert.equal(malformed.contentType, 'ABSENT');
  assert.throws(() => summarizeHostedBootstrap({ pathname: '/auth/v1/token', status: 200, origin }));
});

test('navigation diagnostics describe owned-event reloads without recording invitation secrets or foreign paths', () => {
  const origin = 'https://staging.invalid', owned = 'de-' + 'a'.repeat(32);
  const result = summarizeHostedNavigation(`${origin}/debate-room/#event=${owned}&match=PRIVATE_MATCH&invite=PRIVATE_SECRET`, origin, owned);
  assert.deepEqual(result, { sameOrigin: true, path: '/debate-room/', hasEvent: true, matchesOwnedEvent: true, hasMatch: true, hasInvite: true });
  const other = summarizeHostedNavigation('https://PRIVATE_HOST.invalid/PRIVATE_PATH?PRIVATE_QUERY#event=PRIVATE_EVENT', origin, owned);
  assert.equal(other.path, 'OTHER'); assert.equal(other.sameOrigin, false); assert.equal(other.matchesOwnedEvent, false);
  assert.ok(!JSON.stringify([result, other]).includes('PRIVATE'));
  assert.deepEqual(summarizeHostedNavigation('not a URL', origin, owned), { validUrl: false });
});

test('independent hosted timetable rejects reordered stages, reversed question pairs and redistributed durations even with the same total', () => {
  assertHostedDefaultRunOfShow(createRunOfShow());
  assert.equal(HOSTED_DEFAULT_TIMED_STAGES.length, 16);
  assert.equal(HOSTED_DEFAULT_TIMED_STAGES.reduce((sum, stage) => sum + stage.durationMs, 0), 4680000);
  for (const change of [
    stages => { [stages[1], stages[3]] = [stages[3], stages[1]]; },
    stages => stages[2].speakerSeats.reverse(),
    stages => { stages[1].durationMs += 1000; stages[2].durationMs -= 1000; },
    stages => { [stages[14].speakerSeats, stages[15].speakerSeats] = [stages[15].speakerSeats, stages[14].speakerSeats]; },
    stages => { stages.at(-1).durationMs = 0; },
  ]) { const stages = structuredClone(createRunOfShow()); change(stages); assert.throws(() => assertHostedDefaultRunOfShow(stages)); }
});

function finishedAttempt(index) {
  const stage = HOSTED_DEFAULT_TIMED_STAGES[index], start = 1800000000000, adjustments = [{ type: 'START', at: start, durationMs: stage.durationMs }];
  if (index === 1) adjustments.push({ type: 'PAUSE', at: start + 1234, durationMs: stage.durationMs },
    { type: 'RESUME', at: start + 6234, durationMs: stage.durationMs });
  const elapsedMs = stage.durationMs + 1100, finishedAt = start + elapsedMs + (index === 1 ? 5000 : 0);
  adjustments.push({ type: 'FINISH', at: finishedAt, durationMs: stage.durationMs });
  return { id: `inert-attempt-${index}`, stageId: stage.id, stageIndex: index, number: 1, ruleVersion: 1,
    state: 'FINISHED', speakerSeats: [...stage.speakerSeats], speakerIds: stage.speakerSeats.map(seat => seats[seat]),
    createdAt: start - 10, elapsedMs, overtimeMs: 1100, finishedAt, adjustments };
}

test('hosted persisted attempt proof uses acknowledged timestamps and excludes paused time', () => {
  for (let index = 0; index < 16; index++) {
    const attempt = finishedAttempt(index), evidence = assertHostedFinishedAttempt(attempt, index, seats);
    assert.equal(evidence.elapsedMs, HOSTED_DEFAULT_TIMED_STAGES[index].durationMs + 1100);
    assert.equal(evidence.finishedAt - evidence.startedAt - evidence.elapsedMs, index === 1 ? 5000 : 0);
  }
  for (const change of [
    attempt => { attempt.elapsedMs += 5000; attempt.overtimeMs += 5000; },
    attempt => { attempt.adjustments[0].durationMs = 1; },
    attempt => { attempt.speakerIds = ['inert-N1']; },
    attempt => { attempt.adjustments[1].type = 'RESET'; },
    attempt => { attempt.finishedAt += 1; },
    attempt => { attempt.elapsedMs = 299999; },
  ]) { const attempt = finishedAttempt(1); change(attempt); assert.throws(() => assertHostedFinishedAttempt(attempt, 1, seats)); }
});

test('corrected full scorecard awards match exact independent winners and closing eligibility', () => {
  const speakers = Object.fromEntries(Object.keys(seats).map(seat => [seat,
    { evidence: seat[0] === 'N' ? 20 : seat === 'A1' ? 24 : 25, delivery: 30, questioning: 15, responding: 15 }]));
  const final = { id: 'inert-final-corrected', state: 'FINAL', winner: 'affirmative', awards: calculateAwards({
    ballots: [{ judgeId: 'inert-judge', scorecard: { speakers, closing: { affirmative: 15, negative: 12 } } }],
    activeJudgeIds: ['inert-judge'], nominations: [{ judgeId: 'inert-judge', nomineeId: 'A2', reason: 'Synthetic nomination.' }], matchStatus: 'FINAL' }) };
  assertHostedCorrectedAwards(final);
  for (const name of ['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker', 'bestDebater']) {
    const wrong = structuredClone(final); wrong.awards[name].winners = ['N3']; assert.throws(() => assertHostedCorrectedAwards(wrong));
  }
  const wrong = structuredClone(final); wrong.awards.bestRebuttalSpeaker.candidates.push({ id: 'A2' });
  assert.throws(() => assertHostedCorrectedAwards(wrong));
});

test('hosted exports reject the superseded result version and do not invent result linkage for rules or private scorecards', () => {
  const final = { id: 'inert-final-corrected' };
  for (const kind of ['result', 'event_report', 'csv', 'certificate']) {
    assertHostedExportVersion(kind, { type: 'export', resultVersion: final.id }, final);
    for (const resultVersion of [undefined, null, 'inert-superseded'])
      assert.throws(() => assertHostedExportVersion(kind, { type: 'export', resultVersion }, final));
  }
  for (const kind of ['rules', 'scorecard']) {
    assertHostedExportVersion(kind, { type: 'export' }, final);
    assert.throws(() => assertHostedExportVersion(kind, { type: 'export', resultVersion: final.id }, final));
  }
});

function nextMatch(started = false) {
  const next = { id: 'inert-next', motionId: 'inert-new-private-motion', phase: 'setup', rulesLockedAt: null, timer: null,
    drafts: {}, ballots: {}, polls: {}, nominations: {}, ballotHistory: [], resultVersions: [], messages: [], evidence: [],
    incidents: [], protests: [], ballotRound: 1, ballotState: 'DRAFT', activePollId: null, runOfShow: [], attempts: [], acknowledgments: {} };
  if (started) Object.assign(next, { phase: 'preparation', currentStageIndex: 0, motionReleasedAt: 2000,
    runOfShow: createRunOfShow(), attempts: [{ id: 'inert-next-attempt', stageId: 'preparation', state: 'READY', adjustments: [] }],
    timer: { matchId: next.id, stageAttemptId: 'inert-next-attempt', state: 'READY', durationMs: 900000,
      elapsedBeforeRunMs: 0, startedAtServerMs: null, controllerId: null } });
  return next;
}

test('next match must have a different private motion and empty competitive records before and after its READY start', () => {
  const prior = { id: 'inert-first', motionId: 'inert-first-motion', motionReleasedAt: 1000, attempts: [{ id: 'inert-first-attempt' }] };
  for (const started of [false, true]) {
    assertHostedNextMatchState(nextMatch(started), prior, 'inert-new-private-motion', { started });
    for (const change of [
      next => { next.motionId = prior.motionId; }, next => { next.ballots.current = { winner: 'affirmative' }; },
      next => { next.drafts.judge = { private: 'inert draft' }; }, next => { next.resultVersions.push({ id: 'inert-old' }); },
      next => { next.polls.old = { votes: 1 }; }, next => { next.messages.push({ id: 'inert-old-message' }); },
    ]) { const next = nextMatch(started); change(next); assert.throws(() => assertHostedNextMatchState(next, prior, 'inert-new-private-motion', { started })); }
  }
  const next = nextMatch(true); next.timer.elapsedBeforeRunMs = 1;
  assert.throws(() => assertHostedNextMatchState(next, prior, 'inert-new-private-motion', { started: true }));
});

test('next-match isolation compares the entire previous match including timer, ballot history, private drafts and polls', () => {
  const before = { timer: { elapsedBeforeRunMs: 301100 }, ballots: { current: { winner: 'affirmative' } },
    ballotHistory: [{ round: 1 }], drafts: { judge: { notes: 'inert-private-note' } }, polls: { first: { votes: 1 } },
    rules: { constructiveMs: 300000 }, attempts: [{ id: 'inert-attempt' }], resultVersions: [{ id: 'inert-final' }] };
  assertHostedPriorMatchPreserved(before, structuredClone(before));
  for (const key of Object.keys(before)) { const after = structuredClone(before); delete after[key]; assert.throws(() => assertHostedPriorMatchPreserved(before, after)); }
});

test('hosted browser cannot launch on the desktop or without the dedicated CI opt-in', () => {
  for (const configuration of [
    { platform: 'win32', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_SYNTHETIC_BROWSER_CI: '1' } }
  ]) assert.throws(() => assertCiExecution(configuration));
  assert.doesNotThrow(() => assertCiExecution({ platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } }));
});

test('late session observation and browser errors change a provisional PASS to FAIL after shutdown', () => {
  for (const kind of ['pageErrors', 'unexpectedNetwork', 'consoleErrors']) {
    const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [] };
    report[kind].push({ messageSha256: 'a'.repeat(64) }); finalizeHostedBrowserShutdown(report);
    assert.equal(report.status, 'FAIL'); assert.equal(report.shutdownObservationsVerified, false);
  }
  const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [{ expectedResourceRejection: true }] };
  finalizeHostedBrowserShutdown(report); assert.equal(report.status, 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
  assert.equal(report.shutdownObservationsVerified, true);
});
test('browser and read-only git subprocesses receive no account, cloud or Supabase secrets', () => {
  const env = { PATH: '/inert/bin', HOME: '/inert/home', TMPDIR: '/inert/tmp', LANG: 'C.UTF-8',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'secret-service', CLOUDFLARE_API_TOKEN: 'secret-cloud', GITHUB_TOKEN: 'secret-github',
    DEBATE_STAGING_ALLOWED_BEARER: 'secret-bearer', NODE_OPTIONS: '--require=untrusted', HTTPS_PROXY: 'https://untrusted.invalid' };
  assert.deepEqual(hostedBrowserEnvironment(env), { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: env.LANG });
  assert.ok(!JSON.stringify(hostedBrowserEnvironment(env)).includes('secret'));
});
