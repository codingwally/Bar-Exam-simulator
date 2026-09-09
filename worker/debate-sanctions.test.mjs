import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSanctionPolicy, assertSanctionPolicyChange, appendSanction, applySanctions } from './debate-sanctions.mjs';
import { DEFAULT_RULES, tabulateBallots } from './debate-domain.mjs';

const warning = { id: 'conduct-warning', label: 'Conduct warning', description: 'The moderator records an established breach after ruling.', effect: 'warning' };
const deduction = { id: 'declared-deduction', label: 'Declared evidence sanction', description: 'After a manual ruling under the agreed evidence conditions, deduct one point.', effect: 'team_point_deduction', points: '1.00' };
const policy = [warning, deduction];
const code = expected => error => error.code === expected;
const ctx = (extra = {}) => ({ policy, judgingMode: 'aggregate', ruleVersion: 2, actorId: 'chief-one', officialIds: ['chief-one'], now: 100, id: 'record-one', ...extra });
const issue = (extra = {}) => ({ action: 'issue', sanctionId: deduction.id, target: { side: 'affirmative' }, reason: 'The panel ruled after reviewing the reported evidence.', confirmed: true, ...extra });
const raw = (extra = {}) => ({ status: 'DECIDED', winner: 'affirmative', complete: true, judgingMode: 'aggregate', requiredJudgeCount: 3, validJudgeCount: 3, missingJudgeIds: [], invalid: [], ballotSplit: { affirmative: 2, negative: 1, tiedScorecards: 0 }, teamScores: { affirmative: { numerator: 24001, denominator: 3, display: '80.00' }, negative: { numerator: 24000, denominator: 3, display: '80.00' } }, tied: false, ...extra });
const deepFreeze = value => { for (const child of Object.values(value || {})) if (child && typeof child === 'object') deepFreeze(child); return Object.freeze(value); };

test('default policy is empty; warnings are available in all three modes without point effects', () => {
  assert.deepEqual(validateSanctionPolicy(), []);
  for (const judgingMode of ['simple', 'majority', 'aggregate']) assert.deepEqual(validateSanctionPolicy([warning], { judgingMode }), [warning]);
  assert.throws(() => validateSanctionPolicy([{ ...warning, points: 1 }]), code('INVALID_SANCTION'));
  assert.throws(() => validateSanctionPolicy([{ ...warning, automaticOvertime: true }]), code('INVALID_SANCTION'));
});

test('fixed numeric declarations normalize exactly and reject majority/simple score changes', () => {
  const normalized = validateSanctionPolicy([{ ...deduction, points: 0.01 }], { judgingMode: 'aggregate' });
  assert.equal(normalized[0].points, '0.01'); assert.equal(normalized[0].pointsHundredths, 1);
  assert.deepEqual(validateSanctionPolicy(normalized, { judgingMode: 'aggregate' }), normalized);
  for (const judgingMode of ['simple', 'majority']) assert.throws(() => validateSanctionPolicy([deduction], { judgingMode }), code('SANCTION_MODE_UNSUPPORTED'));
  for (const points of [0, -1, NaN, Infinity, '', null, undefined, '0.001', '1e1', 100.01, Number.MAX_SAFE_INTEGER]) assert.throws(() => validateSanctionPolicy([{ ...deduction, points }], { judgingMode: 'aggregate' }), code('INVALID_SANCTION'));
  assert.throws(() => validateSanctionPolicy([{ ...deduction, pointsHundredths: 99 }], { judgingMode: 'aggregate' }), code('INVALID_SANCTION'));
  assert.throws(() => validateSanctionPolicy([warning, warning]), code('INVALID_SANCTION'));
});

test('the declared policy is immutable once rules lock, including time zero and text changes', () => {
  assert.equal(assertSanctionPolicyChange([], policy, { startedAt: null, judgingMode: 'aggregate' }).length, 2);
  for (const startedAt of [0, 50]) {
    assert.throws(() => assertSanctionPolicyChange([], policy, { startedAt, judgingMode: 'aggregate' }), code('SANCTION_POLICY_LOCKED'));
    assert.throws(() => assertSanctionPolicyChange(policy, [warning, { ...deduction, description: 'Different conditions' }], { startedAt, judgingMode: 'aggregate' }), code('SANCTION_POLICY_LOCKED'));
    assert.equal(assertSanctionPolicyChange(policy, [...policy].reverse(), { startedAt, judgingMode: 'aggregate' }).length, 2, 'Reordering already-declared rules does not change their effect');
  }
});

test('a manual sanction requires a current server-derived official, confirmation and reason', () => {
  assert.throws(() => appendSanction([], issue(), ctx({ officialIds: [] })), code('SANCTION_OFFICIAL_REQUIRED'));
  assert.throws(() => appendSanction([], issue(), ctx({ actorId: 'former-chief' })), code('SANCTION_OFFICIAL_REQUIRED'));
  assert.throws(() => appendSanction([], issue({ authorized: true }), ctx()), code('INVALID_SANCTION'));
  assert.throws(() => appendSanction([], issue({ confirmed: false }), ctx()), code('SANCTION_CONFIRMATION_REQUIRED'));
  assert.throws(() => appendSanction([], issue({ reason: '  ' }), ctx()), code('INVALID_SANCTION'));
  assert.throws(() => appendSanction([], issue({ sanctionId: 'undeclared' }), ctx()), code('SANCTION_UNDECLARED'));
  assert.throws(() => appendSanction([], issue({ points: 50 }), ctx()), code('INVALID_SANCTION'));
});

test('warnings can name a speaking seat, numeric deductions can only name one valid team', () => {
  const [record] = appendSanction([], issue({ sanctionId: warning.id, target: { seat: 'A2' } }), ctx());
  assert.deepEqual(record.target, { seat: 'A2' }); assert.equal(record.effect, 'warning'); assert.equal(record.pointsHundredths, undefined);
  for (const target of [{}, { side: 'other' }, { seat: 'A2' }, { side: 'affirmative', seat: 'A2' }, { side: 'affirmative', memberId: 'someone' }]) assert.throws(() => appendSanction([], issue({ target }), ctx()));
  assert.throws(() => appendSanction([], issue({ sanctionId: warning.id, target: { seat: 'A4' } }), ctx()), code('INVALID_SANCTION_TARGET'));
});

test('issues and reasoned reversals append new records without rewriting the original decision', () => {
  const records = deepFreeze(appendSanction([], issue(), ctx()));
  const reversed = appendSanction(records, { action: 'reverse', recordId: records[0].id, reason: 'The review established that the original sanction was mistaken.', confirmed: true }, ctx({ id: 'reversal-one', now: 101, actorId: 'new-chief', officialIds: ['new-chief'] }));
  assert.equal(records.length, 1); assert.equal(reversed.length, 2); assert.deepEqual(reversed[0], records[0]);
  assert.equal(reversed[1].actorId, 'new-chief'); assert.equal(reversed[1].recordId, 'record-one'); assert.equal(reversed[1].sanctionId, deduction.id);
  assert.throws(() => appendSanction(reversed, { action: 'reverse', recordId: 'record-one', reason: 'A second reversal', confirmed: true }, ctx({ id: 'reversal-two', now: 102 })), code('SANCTION_NOT_ACTIVE'));
  assert.throws(() => appendSanction(records, issue(), ctx()), code('DUPLICATE_SANCTION'));
  assert.deepEqual(applySanctions(raw(), reversed, policy).adjustedTally, raw());
});

test('exact thirds determine the adjusted winner even when both displayed raw team scores tie', () => {
  const tally = deepFreeze(raw()), records = deepFreeze(appendSanction([], issue(), ctx())), before = structuredClone(tally);
  const result = applySanctions(tally, records, policy);
  assert.deepEqual(tally, before); assert.deepEqual(result.rawTally, before); assert.equal(result.rawTally.winner, 'affirmative');
  assert.equal(result.adjustedTally.winner, 'negative'); assert.equal(result.adjustedTally.status, 'DECIDED');
  assert.deepEqual(result.adjustedTeamScores.affirmative, { numerator: 23701, denominator: 3, display: '79.00' });
  assert.deepEqual(result.adjustedTally.ballotSplit, tally.ballotSplit, 'Sanctions do not rewrite judge votes');
  assert.equal(result.adjustments[0].reason, records[0].reason); assert.equal(result.awardBasis, 'raw_scorecards');
  result.rawTally.ballotSplit.affirmative = 99; assert.equal(tally.ballotSplit.affirmative, 2, 'Returned copies cannot mutate saved raw decisions');
});

test('an adjustment-created tie is unresolved; no implicit tiebreak ballot or winner is invented', () => {
  const result = applySanctions(raw({ teamScores: { affirmative: { numerator: 8100, denominator: 1 }, negative: { numerator: 8000, denominator: 1 } } }), appendSanction([], issue(), ctx()), policy);
  assert.equal(result.rawTally.winner, 'affirmative'); assert.equal(result.adjustedTally.winner, null); assert.equal(result.adjustedTally.status, 'UNRESOLVED'); assert.equal(result.adjustedTally.tied, true);
});

test('declared deductions disclose negative totals rather than silently clamping at zero', () => {
  const result = applySanctions(raw({ teamScores: { affirmative: { numerator: 1, denominator: 3 }, negative: { numerator: 0, denominator: 1 } } }), appendSanction([], issue(), ctx()), policy);
  assert.deepEqual(result.adjustedTeamScores.affirmative, { numerator: -299, denominator: 3, display: '-1.00' }); assert.equal(result.adjustedTally.winner, 'negative');
  const tiny = [{ ...deduction, points: '0.01' }];
  const positiveFraction = raw({ teamScores: { affirmative: { numerator: 5, denominator: 3 }, negative: { numerator: 0, denominator: 1 } } });
  assert.equal(applySanctions(positiveFraction, appendSanction([], issue(), ctx({ policy: tiny })), tiny).adjustedTeamScores.affirmative.display, '0.01');
});

test('warnings leave actual majority and simple ballots unchanged, including unresolved decisions', () => {
  const records = appendSanction([], issue({ sanctionId: warning.id, target: { side: 'negative' } }), ctx({ policy: [warning], judgingMode: 'simple' }));
  const simple = tabulateBallots([{ judgeId: 'judge', winner: 'affirmative' }], { ...DEFAULT_RULES, judgingMode: 'simple' }, ['judge']);
  assert.deepEqual(applySanctions(simple, records, [warning]).adjustedTally, simple);
  const majority = raw({ judgingMode: 'majority', status: 'UNRESOLVED', winner: null, tied: true });
  assert.deepEqual(applySanctions(majority, records, [warning]).adjustedTally, majority);
  assert.equal(applySanctions(simple, records, [warning]).adjustedTeamScores, null);
});

test('numeric sanctions reject incomplete ballots and invalid raw arithmetic', () => {
  const records = appendSanction([], issue(), ctx());
  assert.throws(() => applySanctions(raw({ status: 'AWAITING_BALLOTS', complete: false }), records, policy), code('SANCTION_BALLOTS_INCOMPLETE'));
  for (const ratio of [null, { numerator: NaN, denominator: 1 }, { numerator: -1, denominator: 1 }, { numerator: 1, denominator: 0 }, { numerator: 1.5, denominator: 3 }]) assert.throws(() => applySanctions(raw({ teamScores: { affirmative: ratio, negative: { numerator: 0, denominator: 1 } } }), records, policy), code('INVALID_SANCTION_TALLY'));
  assert.throws(() => applySanctions(raw({ teamScores: { affirmative: { numerator: 1, denominator: Number.MAX_SAFE_INTEGER }, negative: { numerator: 0, denominator: 1 } } }), records, policy), code('SANCTION_ARITHMETIC_LIMIT'));
});

test('tampered, duplicated and out-of-order persisted adjustments fail closed', () => {
  const records = appendSanction([], issue(), ctx());
  assert.throws(() => applySanctions(raw(), [...records, ...records], policy), code('DUPLICATE_SANCTION'));
  assert.throws(() => applySanctions(raw(), [{ ...records[0], pointsHundredths: 9999 }], policy), code('INVALID_SANCTION'));
  assert.throws(() => applySanctions(raw(), [{ ...records[0], sanctionId: 'nonexistent' }], policy), code('SANCTION_UNDECLARED'));
  assert.throws(() => appendSanction(records, issue(), ctx({ id: 'earlier', now: 99 })), code('INVALID_SANCTION'));
  assert.throws(() => appendSanction(records, { action: 'reverse', recordId: 'record-one', target: { side: 'negative' }, reason: 'Changed target', confirmed: true }, ctx({ id: 'reverse' })), code('INVALID_SANCTION'));
});

test('all raw scorecards and their genuine tabulation survive a disclosed aggregate deduction', () => {
  const card = { speakers: {}, closing: { affirmative: 12, negative: 12 } };
  for (const seat of ['A1', 'A2', 'A3', 'N1', 'N2', 'N3']) card.speakers[seat] = { evidence: seat === 'A1' ? 20.01 : 20, delivery: 24, questioning: 12, responding: 12 };
  const ballots = deepFreeze([{ judgeId: 'judge', card }]), rules = { ...DEFAULT_RULES, judgingMode: 'aggregate' }, before = structuredClone(ballots);
  // Full ballots use the scorecard property accepted by the actual domain.
  const fullBallots = [{ judgeId: 'judge', scorecard: ballots[0].card }];
  const tally = tabulateBallots(fullBallots, rules, ['judge']); assert.equal(tally.complete, true);
  const result = applySanctions(tally, appendSanction([], issue(), ctx()), policy);
  assert.deepEqual(ballots, before); assert.deepEqual(tabulateBallots(fullBallots, rules, ['judge']), tally); assert.deepEqual(result.rawTally, tally);
  assert.equal(result.adjustedTally.winner, 'negative'); assert.equal(result.awardBasis, 'raw_scorecards');
});
