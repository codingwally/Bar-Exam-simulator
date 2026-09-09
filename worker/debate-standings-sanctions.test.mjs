import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStandings, normalizeScorecard } from './debate-domain.mjs';

const ratio = (numerator, denominator = 1) => ({ numerator, denominator });
function match(id, affirmativeTeamId, negativeTeamId, winnerTeamId, a, n, extra = {}) {
  return { id, affirmativeTeamId, negativeTeamId, winnerTeamId, status: 'FINAL', resultKind: 'normal', rubricId: 'same-rules', teamScores: { affirmative: a, negative: n }, ...extra };
}
const cycle = (a, b, c) => [match('ab', 'a', 'b', 'a', a, b), match('bc', 'b', 'c', 'b', b, c), match('ca', 'c', 'a', 'c', c, a)];

test('disclosed negative final team totals retain exact signed means and official standings order', () => {
  const matches = cycle(ratio(-100), ratio(-200), ratio(-300)), before = structuredClone(matches);
  const result = calculateStandings(['c', 'b', 'a'], matches);
  assert.deepEqual(result.rows.map(row => [row.teamId, row.meanScore.display, row.wins, row.rank]), [['a', '-1.00', 1, 1], ['b', '-2.00', 1, 2], ['c', '-3.00', 1, 3]]);
  assert.deepEqual(matches, before); assert.equal(result.rulesApplied[0].comparableScoreApplied, true);
});

test('standings compare signed thirds exactly, even when display rounding shows equal scores', () => {
  const result = calculateStandings(['b', 'c', 'a'], cycle(ratio(-301, 3), ratio(-302, 3), ratio(-300, 3)));
  assert.deepEqual(result.rows.map(row => row.teamId), ['c', 'a', 'b']);
  assert.equal(result.rows[0].meanScore.display, '-1.00'); assert.equal(result.rows[1].meanScore.display, '-1.00');
  assert.equal(result.rows[1].meanScore.numerator, -301); assert.equal(result.rows[1].meanScore.denominator, 3);
  assert.deepEqual(result.tiedGroups, [], 'Rounded text cannot manufacture a qualification tie');
});

test('signed positive and negative final scores cancel without an artificial negative zero', () => {
  const matches = [match('one', 'a', 'b', 'a', ratio(-1, 3), ratio(100)), match('two', 'a', 'b', 'b', ratio(1, 3), ratio(100))];
  const a = calculateStandings(['a', 'b'], matches).rows.find(row => row.teamId === 'a');
  assert.deepEqual(a.meanScore, { numerator: 0, denominator: 1, display: '0.00' });
});

test('official wins and complete mutual results still precede adjusted comparable scores', () => {
  const moreWins = calculateStandings(['a', 'b'], [match('one', 'a', 'b', 'a', ratio(-10000), ratio(10000))]);
  assert.equal(moreWins.rows[0].teamId, 'a');
  const matches = [match('ab', 'a', 'b', 'a', ratio(-10000), ratio(10000)), match('bc', 'b', 'c', 'b', ratio(10000), ratio(-20000))];
  const mutual = calculateStandings(['a', 'b', 'c'], matches);
  assert.equal(mutual.rows[0].teamId, 'a'); assert.equal(mutual.rows[1].teamId, 'b');
});

test('mixed rubrics and provisional results cannot become comparable because signed scoring exists', () => {
  const matches = cycle(ratio(-100), ratio(-200), ratio(-300)); matches[0].rubricId = 'different-rubric';
  const result = calculateStandings(['a', 'b', 'c'], matches, { qualifyingPlaces: 1 });
  assert.equal(result.rulesApplied[0].comparableScoreApplied, false); assert.equal(result.unresolvedQualification, true);
  assert.equal(result.rows.find(row => row.teamId === 'a').meanScore, null);
  const ignored = calculateStandings(['a', 'b'], [match('provisional', 'a', 'b', 'a', ratio(-100), ratio(100), { status: 'PROVISIONAL_PUBLISHED' })]);
  assert.ok(ignored.rows.every(row => row.played === 0 && row.meanScore === null));
});

test('invalid ratios and raw negative judge marks remain rejected', () => {
  for (const invalid of [ratio(NaN), ratio(-1.5), ratio(Number.MIN_SAFE_INTEGER - 1), ratio(-1, 0), ratio(-1, 0.5), null]) assert.throws(() => calculateStandings(['a', 'b'], [match('bad', 'a', 'b', 'a', invalid, ratio(1))]), error => error.code === 'INVALID_NUMBER');
  assert.throws(() => normalizeScorecard({ speakers: { A1: { evidence: -1 } } }), error => error.code === 'INVALID_SCORE');
});
