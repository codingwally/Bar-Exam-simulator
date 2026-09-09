import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, SEATS, createRunOfShow, tabulateBallots, rubricFingerprint, calculateAwards } from './debate-domain.mjs';
import { captureTournamentMatch, calculateEventTournamentAwards } from './debate-tournament.mjs';
import { appendSanction, applySanctions } from './debate-sanctions.mjs';

const clone = value => structuredClone(value);
const players = ['person-1','person-2','person-3','person-4','person-5','person-6'];
const defaultSeats = Object.fromEntries(SEATS.map((seat, i) => [seat, players[i]]));
function fixture(id, { seats = defaultSeats, judges = ['judge-1'], percents = {}, closing = { affirmative: 80, negative: 40 }, rules = DEFAULT_RULES, nomineeId = 'A1' } = {}) {
  const match = { id, rules: clone(rules), ruleVersion: 1, ballotRound: 1, judgeIds: [...judges], seats: clone(seats), closingSeats: { affirmative: 'A1', negative: 'N1' },
    ballots: {}, nominations: {}, attempts: [], protests: [], resultVersions: [], sanctions: [] };
  for (const judgeId of judges) {
    const scores = typeof percents === 'function' ? percents(judgeId) : percents;
    const scorecard = { speakers: Object.fromEntries(SEATS.map(seat => [seat, Object.fromEntries(['evidence','delivery','questioning','responding'].map(key => [key, rules.rubric.weights[key] * (scores[seats[seat]] ?? 10) / 100]))])),
      closing: Object.fromEntries(['affirmative','negative'].map(side => [side, rules.rubric.weights.closing * closing[side] / 100])), tieBreakSide: 'affirmative', tieBreakReason: 'Reasoned equal-score fixture choice.' };
    match.ballots[`1:${judgeId}`] = { id: `${id}-${judgeId}`, round: 1, judgeId, submittedAt: 100, scorecard, reason: 'PRIVATE_BALLOT_REASON', notes: 'PRIVATE_NOTES', feedback: 'PRIVATE_FEEDBACK' };
    match.nominations[judgeId] = { judgeId, nomineeId: typeof nomineeId === 'function' ? nomineeId(judgeId) : nomineeId, reason: 'PRIVATE_NOMINATION_REASON' };
  }
  for (const stage of createRunOfShow(rules, match.closingSeats).filter(stage => stage.id.startsWith('stage-'))) match.attempts.push({ id: `${id}-${stage.id}`, stageId: stage.id, state: 'FINISHED', speakerIds: stage.speakerSeats.map(seat => seats[seat]) });
  const tally = tabulateBallots(Object.values(match.ballots), match.rules, match.judgeIds);
  match.resultVersions.push({ id: `${id}-result-1`, revision: 1, ruleVersion: 1, state: 'FINAL', resultKind: 'normal', ...tally, ...applySanctions(tally, [], rules.sanctions), sanctions: [], finalizedAt: 1000 });
  return match;
}
function pin(match) { const captured = captureTournamentMatch(match); assert.equal(captured.eligible, true, JSON.stringify(captured)); match.resultVersions.at(-1).tournamentRecord = captured.record; return match; }
function event(matches, extra = {}) { return { id: 'event-1', members: Object.fromEntries(players.map((id, i) => [id, { id, displayName: `Speaker ${i + 1}`, email: `private-${i}@example.test` }])), matches: Object.fromEntries(matches.map(m => [m.id, m])), rehearsal: false, ...extra }; }
const groupOf = matches => calculateEventTournamentAwards(event(matches)).comparableGroups[0];
function sanctionedFixture(id, { rawTie = false } = {}) {
  const rules = { ...clone(DEFAULT_RULES), judgingMode: 'aggregate', sanctions: [{ id: 'breach', label: 'Declared breach', description: 'An explicit local adjudicated occurrence.', effect: 'team_point_deduction', points: '10.00' }] };
  const match = fixture(id, { rules, ...(rawTie ? { closing: { affirmative: 50, negative: 50 } } : {}) });
  match.sanctions = appendSanction([], { action: 'issue', sanctionId: 'breach', target: { side: 'affirmative' }, reason: 'PRIVATE_PINNED_SANCTION_REASON', confirmed: true }, { policy: rules.sanctions, judgingMode: 'aggregate', ruleVersion: 1, actorId: 'official-1', officialIds: ['official-1'], now: 200, id: `${id}-sanction-1` });
  const adjusted = applySanctions(tabulateBallots(Object.values(match.ballots), rules, match.judgeIds), match.sanctions, rules.sanctions);
  Object.assign(match.resultVersions[0], adjusted.adjustedTally, adjusted, { sanctions: clone(match.sanctions) });
  return match;
}

test('declared adjusted winner reversals remain eligible and tournament awards continue using raw cards', () => {
  const one = sanctionedFixture('adjusted-one'), two = sanctionedFixture('adjusted-two');
  assert.equal(one.resultVersions[0].rawTally.winner, 'affirmative'); assert.equal(one.resultVersions[0].winner, 'negative');
  const raw = clone(one.ballots), first = pin(one), second = pin(two);
  assert.equal(first.resultVersions[0].tournamentRecord.officialDecision.winner, 'negative');
  assert.equal(first.resultVersions[0].tournamentRecord.sanctions.length, 1); assert.deepEqual(one.ballots, raw);
  const awards = calculateEventTournamentAwards(event([first, second]));
  assert.equal(awards.sourceResults.length, 2); assert.equal(awards.comparableGroups.length, 1);
  assert.equal(awards.comparableGroups[0].bestSpeaker.candidates.every(candidate => candidate.display === '10.00'), true);
  assert.deepEqual(awards.comparableGroups[0].bestDebater.winners, ['person-1']);
  assert.equal(JSON.stringify(awards).includes('PRIVATE_PINNED_SANCTION_REASON'), false);
});

test('a raw aggregate tie resolved by a declared deduction qualifies for raw performance awards', () => {
  const one = sanctionedFixture('tied-one', { rawTie: true }), two = sanctionedFixture('tied-two', { rawTie: true });
  assert.equal(one.resultVersions[0].rawTally.winner, null); assert.equal(one.resultVersions[0].winner, 'negative');
  const perMatch = calculateAwards({ ...one, ballots: Object.values(one.ballots), activeJudgeIds: one.judgeIds, nominations: Object.values(one.nominations), matchStatus: 'FINAL' });
  assert.equal(perMatch.status, 'AVAILABLE'); assert.equal(perMatch.bestSpeaker.status, 'COAWARD');
  const awards = calculateEventTournamentAwards(event([pin(one), pin(two)]));
  assert.equal(awards.sourceResults.length, 2); assert.equal(awards.comparableGroups[0].bestSpeaker.status, 'COAWARD');
  assert.equal(awards.comparableGroups[0].bestSpeaker.eligibility.every(entry => entry.matchCount === 2), true);
  assert.equal(calculateAwards({ ...one, ballots: Object.values(one.ballots), activeJudgeIds: one.judgeIds, matchStatus: 'FINAL', sanctions: [] }).status, 'UNAVAILABLE', 'No invented official winner may resolve a raw tie without a real declared adjustment.');
});

test('forged final winner, raw score, adjustment amount or sanction history cannot create a pinned award record', () => {
  for (const mutate of [
    match => { match.resultVersions[0].winner = 'affirmative'; },
    match => { match.resultVersions[0].rawTally.teamScores.affirmative.numerator++; },
    match => { match.resultVersions[0].adjustedTeamScores.affirmative.numerator++; },
    match => { match.resultVersions[0].sanctions = []; },
    match => { match.resultVersions[0].adjustments = []; },
    match => { match.sanctions[0].pointsHundredths = 999; match.resultVersions[0].sanctions = clone(match.sanctions); },
  ]) { const match = sanctionedFixture('tampered'); mutate(match); assert.equal(captureTournamentMatch(match).eligible, false); }
});

test('pinned sanction decisions survive later mutable changes but reject changed published or pinned decisions', () => {
  const one = pin(sanctionedFixture('frozen-one')), two = pin(sanctionedFixture('frozen-two'));
  one.sanctions = []; one.rules.sanctions = []; one.ballots = {};
  assert.equal(calculateEventTournamentAwards(event([one, two])).sourceResults.length, 2, 'Current mutable match fields do not replace the finalized award record.');
  const changed = clone(one); changed.resultVersions[0].tournamentRecord.officialDecision.winner = 'affirmative';
  const summary = calculateEventTournamentAwards(event([changed, two]));
  assert.equal(summary.sourceResults.length, 1); assert.equal(summary.exclusions[0].reason, 'FINAL_TALLY_MISMATCH');
  const published = clone(two); published.resultVersions[0].adjustments = [];
  assert.equal(calculateEventTournamentAwards(event([published])).exclusions[0].reason, 'FINAL_ADJUSTMENT_MISMATCH');
});

test('final capture pins accepted identities, rules, round and all14 completed stages without private notes', () => {
  const match = fixture('one'), captured = captureTournamentMatch(match);
  assert.equal(captured.eligible, true); assert.equal(captured.record.completedStages.length, 14);
  assert.equal(captured.record.resultId, 'one-result-1'); assert.equal(captured.record.seatParticipantIds.A1, 'person-1');
  assert.equal(Object.isFrozen(captured.record.ballots[0].scorecard), true);
  assert.equal(JSON.stringify(captured.record).includes('PRIVATE_NOTES'), false);
  assert.equal(JSON.stringify(captured.record).includes('PRIVATE_BALLOT_REASON'), false);
  match.seats.A1 = 'changed'; match.ballots['1:judge-1'].scorecard.speakers.A1.evidence = 0;
  assert.equal(captured.record.seatParticipantIds.A1, 'person-1'); assert.notEqual(captured.record.ballots[0].scorecard.speakers.A1.evidence, 0);
});

test('participant identity survives side and seat changes, with each match weighted once across unequal panels', () => {
  const one = pin(fixture('one', { percents: { 'person-1': 100 } }));
  const changed = { A1: players[3], A2: players[4], A3: players[5], N1: players[1], N2: players[0], N3: players[2] };
  const two = pin(fixture('two', { seats: changed, judges: ['judge-1','judge-2','judge-3'], percents: { 'person-1': 20 }, nomineeId: 'N2' }));
  const result = groupOf([one, two]);
  assert.equal(result.bestSpeaker.candidates.find(c => c.id === 'person-1').display, '60.00');
  assert.equal(result.bestInterpellator.candidates.find(c => c.id === 'person-1').display, '60.00');
  assert.deepEqual(result.bestSpeaker.winners, ['person-1']); assert.deepEqual(result.bestDebater.winners, ['person-1']);
  assert.deepEqual(result.bestSpeaker.winnerParticipants, [{ id: 'person-1', displayName: 'Speaker 1' }]);
  assert.equal(result.bestSpeaker.eligibility.find(e => e.id === 'person-1').matchCount, 2);
  assert.equal(result.bestRebuttalSpeaker.eligibility.find(e => e.id === 'person-1').eligible, false);
  assert.equal(result.bestRebuttalSpeaker.eligibility.find(e => e.id === 'person-1').matchCount, 1);
});

test('all four tournament awards enforce minimum2; one final match cannot be silently promoted', () => {
  const result = groupOf([pin(fixture('one'))]);
  for (const name of ['bestSpeaker','bestInterpellator','bestRebuttalSpeaker','bestDebater']) {
    assert.equal(result[name].status, 'UNAVAILABLE'); assert.equal(result[name].eligibility.every(e => !e.eligible), true);
  }
  assert.throws(() => calculateEventTournamentAwards(event([]), { minimumMatches: 1 }), e => e.code === 'INVALID_MINIMUM_MATCHES');
});

test('closing award includes only actual closing performances with at least2 comparable appearances', () => {
  const group = groupOf([pin(fixture('one')), pin(fixture('two'))]);
  assert.deepEqual(group.bestRebuttalSpeaker.winners, ['person-1']);
  assert.equal(group.bestRebuttalSpeaker.eligibility.find(e => e.id === 'person-2').matchCount, 0);
  assert.equal(group.bestRebuttalSpeaker.eligibility.find(e => e.id === 'person-2').eligible, false);
});

test('custom rubrics remain separate, with saved labels and scoring denominators', () => {
  const custom = clone(DEFAULT_RULES); custom.rubric.weights.evidence = 20; custom.rubric.weights.delivery = 35;
  const result = calculateEventTournamentAwards(event([pin(fixture('one')), pin(fixture('two')), pin(fixture('three', { rules: custom })), pin(fixture('four', { rules: custom }))]));
  assert.equal(result.nonComparableRubrics, true); assert.equal(result.comparableGroups.length, 2);
  assert.equal(result.comparableGroups.every(g => g.matchIds.length === 2), true);
  assert.notEqual(result.comparableGroups[0].rubric, result.comparableGroups[1].rubric);
});

test('rehearsal results never feed real awards; optional preview remains explicitly marked', () => {
  const input = event([pin(fixture('one')), pin(fixture('two'))], { rehearsal: true });
  assert.equal(calculateEventTournamentAwards(input).status, 'REHEARSAL_EXCLUDED');
  assert.deepEqual(calculateEventTournamentAwards(input).comparableGroups, []);
  const preview = calculateEventTournamentAwards(input, { includeRehearsal: true });
  assert.equal(preview.scope, 'REHEARSAL'); assert.equal(preview.realCompetitionEligible, false);
  assert.equal(preview.comparableGroups[0].bestSpeaker.scope, 'REHEARSAL');
});

test('forfeits, byes, unfinished, replayed, disputed and substitution-review performances are excluded', () => {
  for (const kind of ['forfeit','double_forfeit','bye','withdrawn','cancelled','postponed','unresolved']) {
    const match = fixture(`kind-${kind}`); match.resultVersions[0].resultKind = kind;
    assert.equal(captureTournamentMatch(match).reason, 'NOT_PLAYED_SCORED_RESULT');
  }
  const unfinished = fixture('unfinished'); unfinished.attempts[0].state = 'ABANDONED'; assert.equal(captureTournamentMatch(unfinished).reason, 'STAGES_INCOMPLETE');
  const replay = fixture('replay'); replay.attempts.push({ ...replay.attempts[0], id: 'replayed', state: 'READY' }); assert.equal(captureTournamentMatch(replay).reason, 'STAGES_INCOMPLETE');
  const changed = fixture('changed'); changed.attempts[0].speakerIds = ['reserve']; assert.equal(captureTournamentMatch(changed).reason, 'SPEAKER_ATTRIBUTION_UNCONFIRMED');
  const disputed = pin(fixture('disputed')); disputed.protests.push({ state: 'OPEN' }); assert.equal(calculateEventTournamentAwards(event([disputed])).exclusions[0].reason, 'PROTEST_UNRESOLVED');
  const substitution = fixture('substitution'); substitution.awardEligibilityReview = true; assert.equal(captureTournamentMatch(substitution).reason, 'ELIGIBILITY_REVIEW_REQUIRED');
});

test('incomplete cards, wrong rounds, conflicting judges and contradictory finalized winners are rejected', () => {
  const missing = fixture('missing'); delete missing.ballots['1:judge-1'].scorecard.speakers.A1.evidence; assert.equal(captureTournamentMatch(missing).eligible, false);
  const round = fixture('round'); round.ballotRound = 2; assert.equal(captureTournamentMatch(round).reason, 'FINAL_TALLY_MISMATCH');
  const conflicting = fixture('conflict'); conflicting.judgeIds = ['person-1']; assert.equal(captureTournamentMatch(conflicting).eligible, false);
  const wrong = fixture('wrong'); wrong.resultVersions[0].winner = 'negative'; assert.equal(captureTournamentMatch(wrong).reason, 'FINAL_TALLY_MISMATCH');
});

test('simple matches cannot create fabricated numeric tournament awards', () => {
  const match = fixture('simple'); match.rules.judgingMode = 'simple'; assert.equal(captureTournamentMatch(match).reason, 'SIMPLE_MATCH_UNSCORED');
});

test('only latest finalized version is counted; correction immediately removes superseded performance', () => {
  const one = pin(fixture('one')), two = pin(fixture('two'));
  one.resultVersions[0].state = 'SUPERSEDED'; one.resultVersions.push({ id: 'one-result-2', revision: 2, state: 'PROVISIONAL_PUBLISHED', ruleVersion: 1 });
  const result = calculateEventTournamentAwards(event([one, two]));
  assert.equal(result.sourceResults.length, 1); assert.equal(result.exclusions[0].reason, 'RESULT_NOT_FINAL');
  assert.equal(result.comparableGroups[0].bestSpeaker.status, 'UNAVAILABLE');
});

test('frozen score records survive later mutable match data and expose only aggregate named output', () => {
  const one = pin(fixture('one')), two = pin(fixture('two'));
  one.rules.rubric.weights.evidence = 0; one.seats.A1 = 'mutated'; one.ballots = {}; one.nominations = {};
  const result = calculateEventTournamentAwards(event([one, two])), serialized = JSON.stringify(result);
  assert.equal(result.sourceResults.length, 2);
  for (const secret of ['PRIVATE_NOTES','PRIVATE_FEEDBACK','PRIVATE_BALLOT_REASON','PRIVATE_NOMINATION_REASON','private-0@example.test','scorecard','submittedAt']) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(result.comparableGroups[0].bestSpeaker.eligibility.find(e => e.id === 'person-1').matchCount, 2);
});

test('missing frozen records are explicit verification gaps, never reconstructed from current live data', () => {
  const result = calculateEventTournamentAwards(event([fixture('unpinned')]));
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.exclusions[0].reason, 'FINAL_RECORD_NOT_FROZEN');
});

test('tournament Best Debater ties require one eligible-panel runoff and persistent tie is coaward', () => {
  const config = { judges: ['judge-1','judge-2'], nomineeId: judge => judge === 'judge-1' ? 'A1' : 'A2' };
  const input = event([pin(fixture('one', config)), pin(fixture('two', config))]);
  const first = calculateEventTournamentAwards(input).comparableGroups[0];
  assert.equal(first.bestDebater.status, 'RUNOFF_REQUIRED'); assert.deepEqual(first.bestDebater.topCandidateIds, ['person-1','person-2']);
  const runoff = { rubric: first.rubric, resultIds: first.sourceResults.map(r => r.resultId), activeJudgeIds: ['judge-1','judge-2'], nominations: [{ judgeId: 'judge-1', nomineeId: 'person-1', reason: 'First reason.' }, { judgeId: 'judge-2', nomineeId: 'person-2', reason: 'Second reason.' }] };
  const result = calculateEventTournamentAwards(input, { nominationRunoffs: [runoff] });
  assert.equal(result.comparableGroups[0].bestDebater.status, 'COAWARD'); assert.deepEqual(result.comparableGroups[0].bestDebater.winners, ['person-1','person-2']);
  const stale = calculateEventTournamentAwards(input, { nominationRunoffs: [{ ...runoff, resultIds: ['old-result'] }] });
  assert.equal(stale.invalidatedRunoffs[0].reason, 'SOURCE_RESULTS_CHANGED'); assert.equal(stale.comparableGroups[0].bestDebater.status, 'RUNOFF_REQUIRED');
  assert.throws(() => calculateEventTournamentAwards(input, { nominationRunoffs: [{ ...runoff, activeJudgeIds: ['judge-1'], nominations: runoff.nominations.slice(0,1) }] }), e => e.code === 'INVALID_RUNOFF_PANEL');
});

test('per-match nomination share averages once before tournament comparison', () => {
  const one = pin(fixture('one', { judges: ['judge-1'], nomineeId: 'A1' }));
  const two = pin(fixture('two', { judges: ['judge-1','judge-2','judge-3'], nomineeId: 'A2' }));
  const result = groupOf([one, two]).bestDebater;
  assert.equal(result.status, 'RUNOFF_REQUIRED'); assert.equal(result.candidates.find(c => c.id === 'person-1').display, '50.00'); assert.equal(result.candidates.find(c => c.id === 'person-2').display, '50.00');
});

test('missing nominations preserve numeric awards while Best Debater awaits completed judge input', () => {
  const one = fixture('one'); one.nominations = {}; const result = groupOf([pin(one), pin(fixture('two'))]);
  assert.equal(result.bestDebater.status, 'AWAITING_NOMINATIONS'); assert.equal(result.bestSpeaker.status, 'COAWARD');
});
