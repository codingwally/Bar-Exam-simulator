import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RULES, DebateDomainError, SEATS, validateRules, toHundredths, formatRatio, rubricFingerprint,
  createRunOfShow, defaultScheduleDuration, validateClosingSeats, createTimer, timerElapsed, timerDisplay,
  claimTimerLease, renewTimerLease, applyTimerCommand, crossedWarningCues, createStageAttempt, recordStageAttempt,
  abandonStageAttempt, normalizeScorecard, scoreScorecard, tabulateBallots, resolveOfficialResult,
  calculateAwards, calculateNominationAward, calculateTournamentAwards, audienceEligibleAccountIds,
  calculateAudienceResult, generateRoundRobin, generateElimination, calculateStandings, canAdvanceResult, applyFixtureResult,
} from './debate-domain.mjs';

const copy = (v) => structuredClone(v);
const throwsCode = (fn, code) => assert.throws(fn, (error) => error instanceof DebateDomainError && error.code === code);
function marks(total) { const result = {}; for (const [key, max] of Object.entries({ evidence: 25, delivery: 30, questioning: 15, responding: 15 })) { result[key] = Math.min(max, total); total -= result[key]; } assert.ok(Math.abs(total) < 0.000001); return result; }
function card(affirmative = 90, negative = 80) {
  const speakers = {}, closing = { affirmative: Math.min(15, affirmative), negative: Math.min(15, negative) };
  for (const seat of SEATS) speakers[seat] = marks(seat.startsWith('A') ? affirmative - closing.affirmative : negative - closing.negative);
  return { speakers, closing };
}
function ballots(pairs = [[90, 80]]) { return pairs.map(([a, n], i) => ({ judgeId: `j${i + 1}`, scorecard: card(a, n) })); }
const judgeIds = (items) => items.map((b) => b.judgeId);
const names = { A1: 'p1', A2: 'p2', A3: 'p3', N1: 'p4', N2: 'p5', N3: 'p6' };
function controlled(durationMs = 300000, at = 1000) {
  return claimTimerLease(createTimer({ matchId: 'm1', stageAttemptId: 'a1', durationMs }, at), { actorId: 'controller', expectedVersion: 1, authorized: true }, at);
}
function command(timer, type, at, extra = {}) { return applyTimerCommand(timer, { type, actorId: 'controller', expectedVersion: timer.version, ...extra }, at); }
function renew(timer, at) { return claimTimerLease(timer, { actorId: 'controller', expectedVersion: timer.version, authorized: true }, at); }
function finalMatch(id, a, n, winner, extra = {}) { return { id, affirmativeTeamId: a, negativeTeamId: n, winnerTeamId: winner, status: 'FINAL', resultKind: 'normal', ...extra }; }
const scorePair = (a, n) => ({ affirmative: { numerator: a * 100, denominator: 1 }, negative: { numerator: n * 100, denominator: 1 } });

test('V3 defaults are immutable JSON-safe copies and preserve explicit product defaults', () => {
  assert.equal(DEFAULT_RULES.judgingMode, 'majority'); assert.equal(DEFAULT_RULES.timezone, 'Asia/Manila');
  assert.equal(DEFAULT_RULES.preparationMs, 900000); assert.equal(DEFAULT_RULES.correctionWindowMs, 900000);
  assert.equal(DEFAULT_RULES.maxConcurrentHostedEvents, 1); assert.equal(DEFAULT_RULES.maxEventsPerHour, 3);
  assert.equal(DEFAULT_RULES.warningSound, false); assert.equal(DEFAULT_RULES.recording, false);
  const rules = validateRules(); assert.deepEqual(rules.rubric.weightsHundredths, { evidence: 2500, delivery: 3000, questioning: 1500, responding: 1500, closing: 1500 });
  assert.ok(Object.isFrozen(rules.rubric.weights)); assert.doesNotThrow(() => JSON.stringify(rules));
  assert.throws(() => { rules.rubric.weights.evidence = 9; }, TypeError); assert.equal(validateRules().rubric.weights.evidence, 25);
});
test('rules validate timings, booleans, timezone, edition, case labels and separately authorized recording', () => {
  for (const [input, code] of [[{ constructiveMs: -1 }, 'INVALID_NUMBER'], [{ constructiveMs: 0.5 }, 'INVALID_NUMBER'], [{ judgingMode: 'AI' }, 'INVALID_JUDGING_MODE'], [{ timezone: 'Moon/Sea' }, 'INVALID_TIMEZONE'], [{ recording: true }, 'RECORDING_OUT_OF_SCOPE'], [{ caseLabels: ['a'] }, 'INVALID_CASE_LABELS'], [{ closingBreakEnabled: 'yes' }, 'INVALID_RULES'], [{ controllerRenewMs: 30000 }, 'INVALID_NUMBER']]) throwsCode(() => validateRules(input), code);
  assert.equal(validateRules({ constructiveMs: 0, preparationMs: 0 }).constructiveMs, 0);
  assert.equal(validateRules({ language: 'Filipino — 中文', caseLabels: ['Pangangailangan', 'Pakinabang', 'Praktikalidad'] }).language, 'Filipino — 中文');
});
test('custom rubric supports exact decimal weights, disabled criteria and matching help, rejects formulas', () => {
  const rules = validateRules({ rubric: { weights: { evidence: 30.25, delivery: 24.75, questioning: 15, responding: 15, closing: 15 } } });
  assert.equal(rules.rubric.weightsHundredths.evidence, 3025); assert.equal(rules.rubric.customized, true);
  throwsCode(() => validateRules({ rubric: { weights: { evidence: 26 } } }), 'INVALID_RUBRIC_TOTAL');
  throwsCode(() => validateRules({ rubric: { labels: { evidence: 'Accuracy' } } }), 'RUBRIC_HELP_REQUIRED');
  throwsCode(() => validateRules({ rubric: { formula: 'return 100' } }), 'INVALID_AGGREGATION');
  throwsCode(() => validateRules({ rubric: { weights: { charm: 10 } } }), 'INVALID_RUBRIC');
  assert.notEqual(rubricFingerprint(rules), rubricFingerprint());
});
test('all 14 alternating stages, six question/answer pairs, negative then affirmative closing and distinct phases', () => {
  const stages = createRunOfShow(); const speeches = stages.filter((s) => s.id.startsWith('stage-'));
  assert.equal(stages.length, 17); assert.equal(speeches.length, 14); assert.equal(stages[0].id, 'preparation'); assert.equal(stages.at(-1).id, 'deliberation');
  assert.deepEqual(speeches.map((s) => s.speakerSeats), [['A1'], ['N1','A1'], ['N1'], ['A1','N1'], ['A2'], ['N2','A2'], ['N2'], ['A2','N2'], ['A3'], ['N3','A3'], ['N3'], ['A3','N3'], ['N1'], ['A1']]);
  assert.equal(stages[13].id, 'closing-break'); assert.equal(stages.at(-3).side, 'negative');
  const custom = createRunOfShow({ preparationMs: 0, closingBreakEnabled: false }, { affirmative: 'A3', negative: 'N2' });
  assert.equal(custom.length, 15); assert.deepEqual(custom[12].speakerSeats, ['N2']); assert.deepEqual(custom[13].speakerSeats, ['A3']);
  throwsCode(() => validateClosingSeats({ affirmative: 'A4', negative: 'N1' }), 'INVALID_CLOSING_SEAT');
  throwsCode(() => validateClosingSeats({ affirmative: 'N1', negative: 'N2' }), 'INVALID_CLOSING_SEAT');
});
test('default 58-minute speaking block plus 5-minute break and 15-minute initial prep excludes transitions and judging', () => {
  const duration = defaultScheduleDuration(); assert.equal(duration.speakingMs / 60000, 58); assert.equal((duration.speakingMs + duration.breakMs) / 60000, 63);
  assert.equal((duration.speakingMs + duration.breakMs + duration.preparationMs) / 60000, 78); assert.ok(duration.excludes.includes('judging'));
});

test('C01 countdown supports 5:00, 3:00, 0:01, 0:00, ceiling fractions and more than an hour', () => {
  for (const [ms, text] of [[300000, '05:00'], [180000, '03:00'], [1000, '00:01'], [0, 'Overtime +00:00'], [3661000, '1:01:01']]) assert.equal(timerDisplay(controlled(ms), 1000).text, text);
  const running = command(controlled(1000), 'START', 1000); assert.equal(timerDisplay(running, 1001).text, '00:01');
  throwsCode(() => controlled(-1), 'INVALID_NUMBER'); throwsCode(() => controlled(NaN), 'INVALID_NUMBER');
});
test('C02 exact zero and endless red overtime do not change timer state or emit other product actions', () => {
  const running = command(controlled(1000), 'START', 1000), before = copy(running);
  assert.equal(timerDisplay(running, 2000).text, 'Overtime +00:00'); assert.equal(timerDisplay(running, 2999).text, 'Overtime +00:00');
  assert.equal(timerDisplay(running, 3000).text, 'Overtime +00:01'); assert.equal(timerDisplay(running, 3663000).text, 'Overtime +1:01:01');
  assert.equal(timerDisplay(running, 3000).state, 'RUNNING'); assert.deepEqual(running, before); assert.ok(!('mute' in running));
  const zero = command(controlled(0), 'START', 1000); assert.equal(timerDisplay(zero, 1000).text, 'Overtime +00:00');
});
test('C03 pause/resume before and after zero freeze elapsed without restarting', () => {
  let timer = command(controlled(5000), 'START', 1000); timer = command(timer, 'PAUSE', 3000);
  assert.equal(timerElapsed(timer, 10000), 2000); assert.equal(timerDisplay(timer, 10000).text, '00:03');
  timer = command(timer, 'RESUME', 11000); timer = command(timer, 'PAUSE', 17000);
  assert.equal(timerElapsed(timer, 999999), 8000); assert.equal(timerDisplay(timer, 999999).text, 'Overtime +00:03'); assert.match(timerDisplay(timer, 999999).statusText, /Paused/);
});
test('C03 reset is explicit, duration edit requires pause and reason, completed timer cannot reset', () => {
  let timer = command(controlled(1000), 'START', 1000);
  throwsCode(() => command(timer, 'RESET', 1500), 'CONFIRMATION_REQUIRED');
  throwsCode(() => command(timer, 'SET_DURATION', 1500, { durationMs: 2000, reason: 'Correction' }), 'INVALID_TIMER_TRANSITION');
  timer = command(timer, 'PAUSE', 1600); throwsCode(() => command(timer, 'SET_DURATION', 1700, { durationMs: 2000 }), 'INVALID_TEXT');
  timer = command(timer, 'SET_DURATION', 1700, { durationMs: 2000, reason: 'Accepted accommodation' }); assert.equal(timer.elapsedBeforeRunMs, 600); assert.equal(timer.state, 'PAUSED');
  timer = command(timer, 'RESET', 1800, { confirmed: true, reason: 'Agreed repeat' }); assert.equal(timer.state, 'READY'); assert.equal(timer.elapsedBeforeRunMs, 0);
  timer = command(timer, 'START', 1900); timer = command(timer, 'FINISH', 2100); throwsCode(() => command(timer, 'RESET', 2200, { confirmed: true, reason: 'Repeat' }), 'INVALID_TIMER_TRANSITION');
});
test('C04 authoritative elapsed survives late join, refresh, sleeping tab and backward clock samples', () => {
  const timer = command(controlled(300000), 'START', 1000), restored = JSON.parse(JSON.stringify(timer));
  assert.equal(timerElapsed(restored, 500), 0); assert.equal(timerElapsed(restored, 120001000), 120000000);
  assert.deepEqual(timerDisplay(restored, 314500), timerDisplay(timer, 314500));
});
test('C04 controller death expires control while clock continues; authorized successor adopts same state', () => {
  let timer = command(controlled(300000), 'START', 1000);
  throwsCode(() => command(timer, 'PAUSE', 31000), 'CONTROLLER_LEASE_REQUIRED'); assert.equal(timerElapsed(timer, 31000), 30000);
  timer = claimTimerLease(timer, { actorId: 'successor', expectedVersion: timer.version, authorized: true }, 32000);
  timer = applyTimerCommand(timer, { actorId: 'successor', type: 'PAUSE', expectedVersion: timer.version }, 33000); assert.equal(timer.elapsedBeforeRunMs, 32000);
});
test('C05 versions serialize concurrent/replayed commands and reject forged/expired/observer controllers', () => {
  const ready = controlled(), first = command(ready, 'START', 1001);
  throwsCode(() => applyTimerCommand(first, { type: 'START', actorId: 'controller', expectedVersion: ready.version }, 1001), 'STALE_VERSION');
  throwsCode(() => command(first, 'PAUSE', 1002, { actorId: 'observer' }), 'CONTROLLER_LEASE_REQUIRED');
  throwsCode(() => claimTimerLease(first, { actorId: 'observer', authorized: false, expectedVersion: first.version }, 32000), 'CONTROLLER_REQUIRED');
  throwsCode(() => claimTimerLease(first, { actorId: 'other', authorized: true, expectedVersion: first.version }, 1002), 'CONTROLLER_LEASE_ACTIVE');
  throwsCode(() => claimTimerLease(first, { actorId: 'other', authorized: true, takeover: true, expectedVersion: first.version }, 1002), 'INVALID_TEXT');
  const taken = claimTimerLease(first, { actorId: 'other', authorized: true, takeover: true, reason: 'Chief takeover', expectedVersion: first.version }, 1002); assert.equal(taken.startedAtServerMs, first.startedAtServerMs);
  const renewed = renewTimerLease(first, { actorId: 'controller', expectedVersion: first.version }, 11000); assert.equal(renewed.leaseExpiresAtServerMs, 41000);
});
test('C05 warning crossings fire only once and never replay for reconnect/late join/another attempt', () => {
  const before = { stageAttemptId: 'a1', state: 'RUNNING', remainingMs: 60001 }, after = { ...before, remainingMs: 60000 };
  assert.deepEqual(crossedWarningCues(before, after), [60000]); assert.deepEqual(crossedWarningCues(before, after, { previouslyFired: [60000] }), []);
  assert.deepEqual(crossedWarningCues(null, after), []); assert.deepEqual(crossedWarningCues(before, after, { synchronized: false }), []);
  assert.deepEqual(crossedWarningCues(before, { ...after, stageAttemptId: 'a2' }), []); assert.deepEqual(crossedWarningCues({ ...before, remainingMs: 1 }, { ...after, remainingMs: 0 }), [0]);
});
test('B05 next and repeat load READY, preserve completed attempts and prevent duplicate active attempts', () => {
  const stages = createRunOfShow({ preparationMs: 0, closingBreakEnabled: false });
  let state = createStageAttempt({ matchId: 'm1', stage: stages[0], actorId: 'host' }, 1000); const original = copy(state.attempt);
  throwsCode(() => createStageAttempt({ matchId: 'm1', stage: stages[1], attempts: state.attempts, actorId: 'host' }, 1001), 'ACTIVE_ATTEMPT_EXISTS');
  state.timer = claimTimerLease(state.timer, { actorId: 'controller', authorized: true, expectedVersion: 1 }, 1000);
  state.timer = command(state.timer, 'START', 1000); state.timer = renew(state.timer, 302000); state.timer = command(state.timer, 'FINISH', 302000);
  const history = recordStageAttempt(state.attempts, state.timer, 302000); assert.equal(history[0].overtimeMs, 1000); assert.deepEqual(state.attempt, original);
  throwsCode(() => recordStageAttempt(history, state.timer, 302001), 'IMMUTABLE_ATTEMPT');
  const next = createStageAttempt({ matchId: 'm1', stage: stages[1], attempts: history, actorId: 'host' }, 303000); assert.equal(next.timer.state, 'READY'); assert.equal(next.timer.durationMs, 180000); assert.deepEqual(next.attempt.speakerSeats, ['N1', 'A1']);
  const abandoned = abandonStageAttempt(next.attempts, next.attempt.id, { actorId: 'host', reason: 'Return to earlier speech', confirmed: true }, 304000);
  throwsCode(() => createStageAttempt({ matchId: 'm1', stage: stages[0], attempts: abandoned, actorId: 'host' }, 305000), 'INVALID_TEXT');
  const repeat = createStageAttempt({ matchId: 'm1', stage: stages[0], attempts: abandoned, actorId: 'host', reason: 'Audio recovery' }, 305000);
  assert.equal(repeat.attempt.number, 2); assert.equal(repeat.attempts.length, 3); assert.deepEqual(repeat.attempts[0], history[0]); assert.equal(repeat.timer.state, 'READY');
});
test('B05 skipping requires incident and confirmation; untimed deliberation does not fabricate a clock', () => {
  const phase = createRunOfShow().at(-1); throwsCode(() => createStageAttempt({ matchId: 'm', stage: phase, actorId: 'h' }, 0), 'UNTIMED_STAGE');
  const state = createStageAttempt({ matchId: 'm', stage: createRunOfShow()[0], actorId: 'h' }, 0);
  throwsCode(() => abandonStageAttempt(state.attempts, state.attempt.id, { actorId: 'h', reason: 'No prep', skipped: true }, 1), 'CONFIRMATION_REQUIRED');
  const result = abandonStageAttempt(state.attempts, state.attempt.id, { actorId: 'h', reason: 'Prepared motion', skipped: true, confirmed: true }, 1); assert.equal(result[0].status, 'SKIPPED');
});

test('D01 70/75/80 plus closing 12 equals exactly 87; closing counted once and all-max is100', () => {
  const input = card(); [70, 75, 80].forEach((total, i) => { input.speakers[`A${i + 1}`] = marks(total); }); input.closing.affirmative = 12;
  const result = scoreScorecard(input); assert.deepEqual(result.teams.affirmative, { numerator: 26100, denominator: 3, display: '87.00' });
  assert.equal(scoreScorecard(card(100, 100)).teams.affirmative.display, '100.00'); assert.equal(scoreScorecard(card(0, 0)).teams.negative.display, '0.00');
});
test('D01 decimal comparisons use exact hundredths rational truth before identical display rounding', () => {
  const input = card(85, 85); input.speakers.A1.responding = 0.01;
  const result = scoreScorecard(input); assert.equal(result.teams.affirmative.display, '85.00'); assert.equal(result.teams.negative.display, '85.00'); assert.equal(result.winner, 'affirmative');
  assert.equal(toHundredths('0.01'), 1); assert.equal(toHundredths('25.30'), 2530);
  assert.equal(formatRatio({ numerator: 1, denominator: 200 }), '0.01'); assert.equal(formatRatio({ numerator: 1, denominator: 3 }), '0.33');
  for (const value of [-1, Infinity, NaN, '0.001', '1e2', '0x20', true]) throwsCode(() => toHundredths(value), 'INVALID_SCORE');
});
test('D01 rubric maxima, disabled categories, two-decimal marks and exact denominator adapt to saved version', () => {
  const rules = validateRules({ rubric: { weights: { evidence: 30, delivery: 40, questioning: 0, responding: 10, closing: 20 } } });
  const input = { speakers: Object.fromEntries(SEATS.map((seat) => [seat, { evidence: 30, delivery: 40, responding: 10 }])), closing: { affirmative: 20, negative: 19.99 } };
  const result = scoreScorecard(input, rules); assert.equal(result.teams.affirmative.display, '100.00'); assert.equal(result.normalized.speakers.A1.questioning, 0);
  input.speakers.A1.questioning = 1; throwsCode(() => scoreScorecard(input, rules), 'DISABLED_CRITERION');
  throwsCode(() => scoreScorecard({ ...card(), closing: { affirmative: 16, negative: 10 } }), 'SCORE_OUT_OF_RANGE');
  const extra = card(); extra.speakers.A4 = marks(50); throwsCode(() => scoreScorecard(extra), 'INVALID_SCORE_SEAT');
});
test('D02 majority versus aggregate specified counterexample gives A2–1 versus negative aggregate win', () => {
  const input = ballots([[90,89],[90,89],[60,100]]), judges = judgeIds(input);
  const majority = tabulateBallots(input, DEFAULT_RULES, judges), aggregate = tabulateBallots(input, { judgingMode: 'aggregate' }, judges);
  assert.equal(majority.winner, 'affirmative'); assert.deepEqual(majority.ballotSplit, { affirmative: 2, negative: 1, tiedScorecards: 0 });
  assert.equal(aggregate.winner, 'negative'); assert.equal(aggregate.teamScores.affirmative.display, '80.00'); assert.equal(aggregate.teamScores.negative.display, '92.67');
});
test('D02 forged client totals ignored, contradictory chosen winner rejected', () => {
  const input = ballots(); input[0].teamTotals = { affirmative: 0, negative: 100000 }; assert.equal(tabulateBallots(input, DEFAULT_RULES, ['j1']).winner, 'affirmative');
  input[0].winner = 'negative'; const result = tabulateBallots(input, DEFAULT_RULES, ['j1']); assert.equal(result.status, 'AWAITING_BALLOTS'); assert.equal(result.invalid[0].code, 'CONTRADICTORY_BALLOT');
});
test('D03 incomplete remains distinct from explicit zero; normalized durable draft roundtrip preserves null', () => {
  const input = card(0, 0); input.speakers.A1.evidence = null;
  const draft = normalizeScorecard(input, DEFAULT_RULES, { allowIncomplete: true }); assert.equal(draft.complete, false); assert.deepEqual(draft.missing, ['A1.evidence']); assert.equal(draft.speakers.A1.delivery, 0);
  const restored = JSON.parse(JSON.stringify(draft)); assert.equal(normalizeScorecard(restored, DEFAULT_RULES, { allowIncomplete: true }).speakers.A1.evidence, null);
  throwsCode(() => scoreScorecard(input), 'INCOMPLETE_SCORECARD'); restored.speakers.A1.evidence = 0; assert.equal(scoreScorecard(restored).complete, true);
});
test('D04 duplicate/unassigned/recused ballots rejected and chief receives no extra ballot', () => {
  const input = ballots(); throwsCode(() => tabulateBallots([...input, ...input], DEFAULT_RULES, ['j1']), 'DUPLICATE_ID');
  throwsCode(() => tabulateBallots(input, DEFAULT_RULES, ['another']), 'INELIGIBLE_JUDGE');
  throwsCode(() => tabulateBallots([], DEFAULT_RULES, []), 'INVALID_LIST');
  input[0].role = 'chief'; const result = tabulateBallots(input, DEFAULT_RULES, ['j1']); assert.equal(result.requiredJudgeCount, 1); assert.equal(result.ballotSplit.affirmative, 1);
});
test('D05 required panel stays incomplete, partial tally is absent, blank judge is never zero', () => {
  const result = tabulateBallots(ballots(), DEFAULT_RULES, ['j1', 'j2', 'j3']); assert.equal(result.status, 'AWAITING_BALLOTS'); assert.equal(result.winner, null);
  assert.deepEqual(result.missingJudgeIds, ['j2','j3']); assert.equal(result.ballotSplit, null); assert.equal(result.teamScores, null);
});
test('D05 tied scorecard needs reasoned choice without changing scores', () => {
  const input = ballots([[90,90]]); assert.equal(tabulateBallots(input, DEFAULT_RULES, ['j1']).invalid[0].code, 'TIE_BREAK_REQUIRED');
  input[0].scorecard.tieBreakSide = 'negative'; assert.equal(tabulateBallots(input, DEFAULT_RULES, ['j1']).invalid[0].code, 'TIE_BREAK_REASON_REQUIRED');
  input[0].scorecard.tieBreakReason = 'Comparative clash resolution under the accepted rubric'; const result = tabulateBallots(input, DEFAULT_RULES, ['j1']); assert.equal(result.winner, 'negative'); assert.equal(result.teamScores.affirmative.display, '90.00');
});
test('D05 aggregate allows tied judge scores and requires all complete scorecards', () => {
  const input = ballots([[90,90],[91,90]]); assert.equal(tabulateBallots(input, { judgingMode: 'aggregate' }, ['j1','j2']).winner, 'affirmative');
  assert.equal(tabulateBallots(input.slice(0,1), { judgingMode: 'aggregate' }, ['j1','j2']).status, 'AWAITING_BALLOTS');
});
test('D05 tied panel permits one same-panel reconsideration then eligible observed predeclared tiebreak or rematch', () => {
  const input = ballots([[90,80],[80,90]]), args = { ballots: input, activeJudgeIds: ['j1','j2'] };
  assert.equal(resolveOfficialResult(args).nextAction, 'same_panel_reconsideration'); assert.equal(resolveOfficialResult({ ...args, reconsiderationRound: 1 }).nextAction, 'schedule_tie_resolution');
  throwsCode(() => resolveOfficialResult({ ...args, reconsiderationRound: 2 }), 'INVALID_NUMBER');
  const tiebreakJudge = { id: 't1', predeclared: true, eligible: true, observedRequired: true }, tiebreakBallot = { judgeId: 't1', scorecard: card(90,80) };
  assert.equal(resolveOfficialResult({ ...args, reconsiderationRound: 1, tiebreakJudge }).nextAction, 'await_predeclared_tiebreak');
  const result = resolveOfficialResult({ ...args, reconsiderationRound: 1, tiebreakJudge, tiebreakBallot }); assert.equal(result.winner, 'affirmative'); assert.equal(result.originalPanelTie, true); assert.equal(result.ballotSplit.affirmative, 1);
  throwsCode(() => resolveOfficialResult({ ...args, reconsiderationRound: 1, tiebreakJudge: { ...tiebreakJudge, observedRequired: false }, tiebreakBallot }), 'INELIGIBLE_TIEBREAK_JUDGE');
});
test('D05 simple one-judge match works without invented scores and host is not implicitly a judge', () => {
  const result = tabulateBallots([{ judgeId: 'neutral', winner: 'negative' }], { judgingMode: 'simple' }, ['neutral']); assert.equal(result.winner, 'negative'); assert.equal(result.teamScores, null);
  throwsCode(() => tabulateBallots([{ judgeId: 'host', winner: 'negative' }], { judgingMode: 'simple' }, ['neutral']), 'INELIGIBLE_JUDGE');
  throwsCode(() => scoreScorecard(card(), { judgingMode: 'simple' }), 'SCORES_UNAVAILABLE');
});
test('D09 score awards use individual equal opportunity, questioning not response, and only closing speakers', () => {
  const input = ballots(), score = input[0].scorecard; score.speakers.A2 = marks(85); score.speakers.N2 = { evidence: 25, delivery: 25, questioning: 15, responding: 0 }; score.closing.negative = 14; score.closing.affirmative = 10;
  const result = calculateAwards({ ballots: input, activeJudgeIds: ['j1'], closingSeats: { affirmative: 'A3', negative: 'N1' }, matchStatus: 'FINAL' });
  assert.deepEqual(result.bestSpeaker.winners, ['A2']); assert.equal(result.bestSpeaker.candidates[0].display, '100.00');
  assert.ok(result.bestInterpellator.winners.includes('N2')); assert.deepEqual(result.bestRebuttalSpeaker.winners, ['N1']); assert.deepEqual(result.bestRebuttalSpeaker.candidates.map((c) => c.id).sort(), ['A3','N1']);
});
test('D09 score ties become disclosed co-awards and nonfinal/forfeit matches create no awards', () => {
  const result = calculateAwards({ ballots: ballots(), activeJudgeIds: ['j1'], matchStatus: 'FINAL' }); assert.equal(result.bestSpeaker.status, 'COAWARD'); assert.deepEqual(result.bestSpeaker.winners, ['A1','A2','A3']);
  for (const matchStatus of ['PROVISIONAL', 'FORFEIT', 'CANCELLED', 'DRAFT']) assert.equal(calculateAwards({ ballots: ballots(), activeJudgeIds: ['j1'], matchStatus }).status, 'UNAVAILABLE');
  assert.equal(calculateAwards({ ballots: ballots(), activeJudgeIds: ['j1'] }).status, 'UNAVAILABLE');
});
test('D09 Best Debater reasoned nominations have one top-only runoff then co-awards', () => {
  const nominations = [{ judgeId: 'j1', nomineeId: 'A1', reason: 'Comparative analysis' }, { judgeId: 'j2', nomineeId: 'N2', reason: 'Responsive advocacy' }], args = { nominations, activeJudgeIds: ['j1','j2'] };
  assert.equal(calculateNominationAward(args).status, 'RUNOFF_REQUIRED');
  assert.equal(calculateNominationAward({ ...args, runoff: nominations }).status, 'COAWARD'); assert.deepEqual(calculateNominationAward({ ...args, runoff: nominations }).winners, ['A1','N2']);
  const won = calculateNominationAward({ ...args, runoff: nominations.map((n) => ({ ...n, nomineeId: 'A1' })) }); assert.deepEqual(won.winners, ['A1']);
  throwsCode(() => calculateNominationAward({ ...args, runoff: [{ ...nominations[0], nomineeId: 'A3' }, nominations[1]] }), 'INELIGIBLE_NOMINATION');
  throwsCode(() => calculateNominationAward({ ...args, nominations: [{ ...nominations[0], reason: '' }, nominations[1]] }), 'INVALID_TEXT');
  assert.equal(calculateNominationAward({ ...args, nominations: nominations.slice(0,1) }).status, 'AWAITING_NOMINATIONS');
});
test('D09 simple mode allows nomination award but explains unavailable score-derived awards', () => {
  const result = calculateAwards({ rules: { judgingMode: 'simple' }, ballots: [{ judgeId: 'j1', winner: 'affirmative' }], activeJudgeIds: ['j1'], nominations: [{ judgeId: 'j1', nomineeId: 'N3', reason: 'Reasoned advocacy' }], matchStatus: 'FINAL' });
  assert.equal(result.bestSpeaker.status, 'UNAVAILABLE'); assert.deepEqual(result.bestDebater.winners, ['N3']);
  assert.equal(calculateAwards({ rules: { judgingMode: 'simple' }, ballots: [], activeJudgeIds: ['j1'], nominations: [{ judgeId: 'j1', nomineeId: 'N3', reason: 'Reasoned advocacy' }], matchStatus: 'FINAL' }).status, 'UNAVAILABLE');
});
test('D09 tournament scores average each match before matches so larger panel adds no extra weight', () => {
  const m1 = { id: 'm1', matchStatus: 'FINAL', ballots: ballots([[100,80]]), activeJudgeIds: ['j1'], seatParticipantIds: names };
  const m2 = { id: 'm2', matchStatus: 'FINAL', ballots: ballots([[80,70],[80,70],[80,70]]), activeJudgeIds: ['j1','j2','j3'], seatParticipantIds: names };
  const result = calculateTournamentAwards({ matches: [m1,m2] }); const award = result.comparableGroups[0].bestSpeaker;
  assert.deepEqual(award.winners, ['p1','p2','p3']); assert.equal(award.candidates[0].display, '88.24'); assert.equal(award.eligibility[0].matchCount, 2);
  const one = calculateTournamentAwards({ matches: [m1] }); assert.equal(one.comparableGroups[0].bestSpeaker.status, 'UNAVAILABLE');
});
test('D09 tournament incomparable rubrics remain separate and byes/forfeits produce no scores', () => {
  const a = { id: 'm1', matchStatus: 'FINAL', ballots: ballots(), activeJudgeIds: ['j1'], seatParticipantIds: names };
  const b = { ...a, id: 'm2', rules: { rubric: { labels: { evidence: 'Evidence quality' }, help: { evidence: 'Evaluate relevant, supported evidence.' } } } };
  const result = calculateTournamentAwards({ matches: [a,b,{...a,id:'m3',resultKind:'forfeit'}] }); assert.equal(result.nonComparableRubrics, true); assert.equal(result.comparableGroups.length, 2); assert.equal(result.comparableGroups[0].matchIds.length, 1);
});
test('D09 tournament Best Debater uses per-match nomination share,minimum matches and independent reasoned choices', () => {
  const a = { id:'m1', matchStatus:'FINAL', ballots:ballots(), activeJudgeIds:['j1'], seatParticipantIds:names, nominations:[{judgeId:'j1',nomineeId:'A1',reason:'Analysis'}] };
  const b = { ...a,id:'m2',ballots:ballots([[90,80],[90,80],[90,80]]),activeJudgeIds:['j1','j2','j3'],nominations:[{judgeId:'j1',nomineeId:'A1',reason:'Analysis'},{judgeId:'j2',nomineeId:'A2',reason:'Questions'},{judgeId:'j3',nomineeId:'A2',reason:'Clarity'}] };
  const result=calculateTournamentAwards({matches:[a,b]}).comparableGroups[0].bestDebater;assert.deepEqual(result.winners,['p1']);assert.equal(result.candidates[0].display,'66.67');assert.equal(result.eligibility[0].matchCount,2);
  assert.equal(calculateTournamentAwards({matches:[a]}).comparableGroups[0].bestDebater.status,'UNAVAILABLE');
  assert.equal(calculateTournamentAwards({matches:[a,{...b,nominations:[]}]}).comparableGroups[0].bestDebater.status,'AWAITING_NOMINATIONS');
});
test('D09 tournament nomination tie requires full eligible observed runoff panel then co-awards', () => {
  const nominations=[{judgeId:'j1',nomineeId:'A1',reason:'Analysis'},{judgeId:'j2',nomineeId:'N2',reason:'Questions'}];
  const a={id:'m1',matchStatus:'FINAL',ballots:ballots([[90,80],[90,80]]),activeJudgeIds:['j1','j2'],seatParticipantIds:names,nominations},b={...a,id:'m2'};
  const pending=calculateTournamentAwards({matches:[a,b]}).comparableGroups[0];assert.equal(pending.bestDebater.status,'RUNOFF_REQUIRED');assert.deepEqual(pending.bestDebater.eligibleRunoffJudgeIds,['j1','j2']);
  const runoff={rubric:pending.rubric,activeJudgeIds:['j1','j2'],nominations:[{judgeId:'j1',nomineeId:'p1',reason:'Analysis'},{judgeId:'j2',nomineeId:'p5',reason:'Questions'}]};
  const result=calculateTournamentAwards({matches:[a,b],nominationRunoffs:[runoff]}).comparableGroups[0].bestDebater;assert.equal(result.status,'COAWARD');assert.deepEqual(result.winners,['p1','p5']);
  throwsCode(()=>calculateTournamentAwards({matches:[a,b],nominationRunoffs:[{...runoff,activeJudgeIds:['j1']}]}),'INVALID_RUNOFF_PANEL');
});

test('D07 eligibility snapshot excludes all match officials/competitors but ignores payment and camera status', () => {
  const members = [
    { accountId:'free', checkedIn:true, signedIn:true, roles:['observer'], paid:false, camera:false },
    { accountId:'paid', checkedIn:true, signedIn:true, roles:['observer'], paid:true },
    ...['judge','host','chief_adjudicator','debater','coach','reserve','moderator','timekeeper'].map((role) => ({ accountId:role, checkedIn:true, signedIn:true, roles:['observer',role] })),
    { accountId:'late', checkedIn:false, signedIn:true, roles:['observer'] }, { accountId:'guest', checkedIn:true, signedIn:false, roles:['observer'] },
  ]; assert.deepEqual(audienceEligibleAccountIds(members), ['free','paid']);
});
test('D07 one current vote, revision/withdrawal, invalidated roles, late arrivals, privacy and no vote state', () => {
  const args = { eligibleAccountIds: ['a','b'], votes: [{ accountId:'a', choice:'affirmative' },{accountId:'b',choice:'negative'}] };
  assert.equal(calculateAudienceResult(args).status, 'TIE'); assert.equal(calculateAudienceResult(args).winner, null);
  const revised = calculateAudienceResult({ ...args, votes: [{ accountId:'a', choice:'negative' },{accountId:'b',choice:'negative'}] }); assert.equal(revised.validVotes, 2); assert.equal(revised.counts.negative, 2);
  const removed = calculateAudienceResult({ ...args, votes: [{accountId:'a',choice:'affirmative',withdrawn:true},{accountId:'b',choice:'negative',invalidated:true},{accountId:'late',choice:'affirmative'}] });
  assert.equal(removed.validVotes, 0); assert.equal(removed.status, 'NO_VOTES'); assert.equal(removed.choicePercentages.affirmative, null); assert.equal(removed.winner, null);
  throwsCode(() => calculateAudienceResult({ ...args, votes: [args.votes[0],args.votes[0]] }), 'DUPLICATE_ID');
  const hidden = calculateAudienceResult({ ...args, published:false }); assert.equal(hidden.counts, null); assert.equal(hidden.validVotes, null);
  const empty = calculateAudienceResult({eligibleAccountIds:[],votes:[]}); assert.equal(empty.turnoutPercent,null); assert.equal(empty.officialOutcomeEffect,'none');
});
test('D08 31/19 of 60 means 50 valid,62/38 percent choice,83.33 percent turnout', () => {
  const eligibleAccountIds = Array.from({length:60},(_,i)=>`o${i}`), votes=eligibleAccountIds.slice(0,50).map((accountId,i)=>({accountId,choice:i<31?'affirmative':'negative'}));
  const result=calculateAudienceResult({eligibleAccountIds,votes}); assert.equal(result.validVotes,50); assert.deepEqual(result.choicePercentages,{affirmative:62,negative:38}); assert.equal(result.turnoutPercent,83.33); assert.equal(result.officialOutcomeEffect,'none');
});

test('F03 five-team round robin gives ten unique pairings and five non-winning idle slots', () => {
  const teams=['t1','t2','t3','t4','t5'], result=generateRoundRobin(teams,{motionIds:['m1','m2','m3','m4','m5'],motionReusePolicy:'cycle'});
  assert.equal(result.fixtures.length,10); assert.equal(result.idleSlots.length,5); assert.equal(new Set(result.fixtures.map((m)=>[m.affirmativeTeamId,m.negativeTeamId].sort().join(':'))).size,10);
  for(const team of teams){assert.equal(result.fixtures.filter((m)=>[m.affirmativeTeamId,m.negativeTeamId].includes(team)).length,4);assert.equal(result.idleSlots.filter((m)=>m.teamId===team).length,1);}
  assert.ok(result.idleSlots.every((s)=>s.win===false));assert.equal(result.fixtures[5].motionId,'m1');assert.equal(result.needsReview,true);
});
test('F03 even round robin schedules every pair once without idle, validates duplicate teams and explicit motion reuse', () => {
  assert.equal(generateRoundRobin(['a','b','c','d']).fixtures.length,6);assert.equal(generateRoundRobin(['a','b','c','d']).idleSlots.length,0);
  const result=generateRoundRobin(['a','b','c'],{motionIds:['m1']});assert.equal(result.fixtures[1].motionId,null);
  throwsCode(()=>generateRoundRobin(['a','a']),'DUPLICATE_ID');throwsCode(()=>generateRoundRobin(['a']),'INVALID_LIST');
});
test('F03 seeded five-team elimination gives eight slots,three disclosed byes,no invented speech scores', () => {
  const result=generateElimination(['t1','t2','t3','t4','t5']);assert.equal(result.bracketSize,8);assert.equal(result.fixtures.length,7);assert.equal(result.byes.length,3);
  assert.deepEqual(result.byes.map((b)=>b.teamId).sort(),['t1','t2','t3']);assert.ok(result.byes.every((b)=>b.speechScore===null&&b.ballotScore===null));assert.equal(result.needsReview,true);
  assert.equal(result.fixtures.at(-1).status,'AWAITING_PREDECESSORS');assert.equal(result.fixtures.at(-1).winnerTeamId,null);
  assert.equal(result.fixtures.find(f=>f.round===2&&f.affirmativeTeamId&&f.negativeTeamId).status,'SCHEDULED','two disclosed byes resolve their next pairing without a fictional match');
  const six=generateElimination(['1','2','3','4','5','6']);assert.equal(six.byes.length,2);assert.equal(generateElimination(['a','b']).byes.length,0);
});
test('F03 recorded random bracket requires exact logged outcome actor/time/reroll and never invents randomness', () => {
  const draw={actorId:'host',atMs:10,reroll:1,teamOrder:['b','a','c']};const result=generateElimination(['a','b','c'],{seedOrder:draw.teamOrder,randomDraw:draw});assert.equal(result.method,'recorded_random');assert.deepEqual(result.draw,draw);
  throwsCode(()=>generateElimination(['a','b','c'],{randomDraw:draw}),'INVALID_DRAW');throwsCode(()=>generateElimination(['a','b'],{seedOrder:['a','z']}),'INVALID_SEEDS');
});
test('F03 provisional/unresolved/double-forfeit cannot advance; finalized correction flags started downstream matches', () => {
  const bracket=generateElimination(['a','b','c','d']), match=bracket.fixtures[0];assert.equal(canAdvanceResult({status:'PROVISIONAL',winnerTeamId:match.affirmativeTeamId}),false);
  throwsCode(()=>applyFixtureResult(bracket.fixtures,match.id,{status:'PROVISIONAL',winnerTeamId:match.affirmativeTeamId}),'RESULT_NOT_FINAL');
  const advanced=applyFixtureResult(bracket.fixtures,match.id,{status:'FINAL',winnerTeamId:match.affirmativeTeamId,revision:1});const final=advanced.fixtures.at(-1);assert.equal(final.affirmativeTeamId,match.affirmativeTeamId);
  final.status='LIVE';const corrected=applyFixtureResult(advanced.fixtures,match.id,{status:'FINAL',winnerTeamId:match.negativeTeamId,revision:2});assert.deepEqual(corrected.downstreamReviewMatchIds,[final.id]);assert.equal(corrected.fixtures.at(-1).affirmativeTeamId,match.affirmativeTeamId);assert.equal(corrected.fixtures.at(-1).requiresReview,true);
  assert.equal(canAdvanceResult({status:'FINAL',winnerTeamId:'a',resultKind:'double_forfeit'}),false);
});
test('F03 correcting an earlier finalized winner flags all dependent downstream results without rewriting them', () => {
  const fixtures=[{id:'quarter',affirmativeTeamId:'a',negativeTeamId:'b',status:'FINAL',winnerTeamId:'a'},
    {id:'semi',affirmativeSource:'quarter',affirmativeTeamId:'a',negativeTeamId:'c',status:'FINAL',winnerTeamId:'a'},
    {id:'final',affirmativeSource:'semi',affirmativeTeamId:'a',negativeTeamId:'d',status:'LIVE'}];
  const result=applyFixtureResult(fixtures,'quarter',{status:'FINAL',winnerTeamId:'b',revision:2});
  assert.deepEqual(result.downstreamReviewMatchIds,['semi','final']);assert.equal(result.fixtures[1].winnerTeamId,'a');assert.equal(result.fixtures[2].affirmativeTeamId,'a');assert.equal(result.fixtures[2].requiresReview,true);assert.equal(fixtures[2].requiresReview,undefined);
});
test('F03 standings prioritize official wins then complete mutual mini-league over larger aggregate score', () => {
  const matches=[finalMatch('1','a','b','a',{teamScores:scorePair(80,90),rubricId:'r'}),finalMatch('2','b','c','b',{teamScores:scorePair(100,70),rubricId:'r'}),finalMatch('3','c','a','c',{teamScores:scorePair(100,80),rubricId:'r'}),finalMatch('4','a','d','a'),finalMatch('5','b','d','b')];
  const result=calculateStandings(['a','b','c','d'],matches);assert.equal(result.rows[0].teamId,'a');assert.equal(result.rows[0].wins,2);assert.equal(result.rows[1].teamId,'b');assert.equal(result.rulesApplied[0].miniLeagueApplied,true);
});
test('F03 tied mini-league uses mean valid comparable match scores, not panel size/raw sums', () => {
  const matches=[finalMatch('1','a','b','a',{teamScores:scorePair(80,70),rubricId:'r'}),finalMatch('2','b','c','b',{teamScores:scorePair(100,80),rubricId:'r'}),finalMatch('3','c','a','c',{teamScores:scorePair(85,75),rubricId:'r'})];
  const result=calculateStandings(['a','b','c'],matches);assert.deepEqual(result.rows.map((r)=>r.teamId),['b','c','a']);assert.equal(result.rows[0].meanScore.display,'85.00');
});
test('F03 unresolved qualifying ties stay explicit; incomparable rubrics never ranked by deceptive averages', () => {
  const result=calculateStandings(['a','b','c'],[],{qualifyingPlaces:2});assert.equal(result.unresolvedQualification,true);assert.equal(result.nextAction,'schedule_tie_resolution');assert.deepEqual(result.rows.map((r)=>r.rank),[1,1,1]);
  const matches=[finalMatch('1','a','c','a',{teamScores:scorePair(99,50),rubricId:'r1'}),finalMatch('2','b','c','b',{teamScores:scorePair(50,49),rubricId:'r2'})];
  const mixed=calculateStandings(['a','b','c'],matches,{qualifyingPlaces:1});assert.equal(mixed.rulesApplied[0].comparableScoreApplied,false);assert.equal(mixed.unresolvedQualification,true);
});
test('F03 forfeits are wins without scores; double-forfeit awards no win;byes/provisional/cancelled excluded', () => {
  const matches=[finalMatch('1','a','b','a',{resultKind:'forfeit'}),finalMatch('2','a','c',null,{resultKind:'double_forfeit'}),{...finalMatch('3','b','c','b'),status:'PROVISIONAL'},finalMatch('4','b','c','b',{resultKind:'bye'}),finalMatch('5','b','c','b',{resultKind:'cancelled'})];
  const result=calculateStandings(['a','b','c'],matches);assert.equal(result.rows[0].wins,1);assert.ok(result.rows.every((r)=>r.scoredMatches===0));assert.equal(result.rows.find((r)=>r.teamId==='b').wins,0);
  throwsCode(()=>calculateStandings(['a','b'],[finalMatch('1','a','b','a',{resultKind:'double_forfeit'})]),'INVALID_FORFEIT');
});
