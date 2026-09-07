import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDeterministicScoreCap } from './examiner-core.mjs';

// Pure production-function tests: no provider calls, customer records or rubric changes.
const explanationContext = {
  question: 'Explain whether bad intent alone creates criminal liability.',
  questionType: 'explanation',
  applicationRequired: false,
  suggestedAnswer: 'No. Criminal liability requires the elements of the offense or another statutory basis; intent alone is insufficient.',
  legalBasis: 'Revised Penal Code.',
  verified: true,
};
const soundAnswer = 'No. Bad intent alone does not create criminal liability. The prosecution must establish every statutory element; an intention without the required overt act is insufficient. Therefore mere intention does not make a person liable.';
const intentOnlyAnswer = 'Yes. Harry is liable for an impossible crime. A person who acts with bad intent is criminally liable even when no property is actually taken. Harry wanted to steal money and opened the empty electronic wallet, showing bad intent. Therefore, bad intent alone makes him liable for an impossible crime.';
const problemContext = {
  question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
  suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
  legalBasis: 'Revised Penal Code, Article 4(2).',
  verified: true,
};

function assessment(overrides = {}) {
  return {
    score: 4.5,
    maxScore: 5,
    assessmentType: 'question_bank',
    rationale: 'The answer meaningfully addresses the requested legal analysis.',
    errors: [],
    authorityStatus: 'not_cited_or_omitted',
    scoreCeilingCode: 'none',
    rubricBreakdown: {
      responsiveness: 5, legalBasis: 4.5, application: 4.5, conclusion: 5,
      questionType: 'explanation', applicationRequired: false,
    },
    ...overrides,
  };
}

for (const finding of [
  'The legal basis is not wrong. The answer correctly performs the legal analysis.',
  'The legal basis is not materially incorrect.',
  'There is no incorrect legal basis in the answer.',
  'The doctrine is neither wrong nor irrelevant.',
  'The rule is not inapplicable to these facts.',
  'The authority is not unrelated to the question.',
  'The governing rule is not shown to be wrong.',
  "The legal basis isn't wrong.",
  'The legal basis isn’t wrong.',
  'The legal basis in Art. 4 is not wrong.',
  'The legal basis is not an incorrect rule.',
]) {
  test(`negated wrong-rule finding does not cap: ${finding}`, () => {
    const result = applyDeterministicScoreCap(assessment({ rationale: finding }), soundAnswer, explanationContext);
    assert.equal(result.score, 4.5);
    assert.equal(result.appliedScoreCeiling, null);
  });
}

for (const field of ['rationale', 'legalExplanation', 'errors']) {
  test(`negation is checked consistently in ${field}`, () => {
    const value = 'The legal basis is not wrong.';
    const result = applyDeterministicScoreCap(assessment({ [field]: field === 'errors' ? [value] : value }), soundAnswer, explanationContext);
    assert.equal(result.score, 4.5);
  });
}

for (const finding of [
  'The legal basis is materially wrong.',
  'The answer relies on an incorrect doctrine.',
  'The legal basis in Art. 4 is wrong.',
  'The legal basis is not only wrong but unrelated to the question.',
  'The first legal basis is not wrong. The second statute is inapplicable.',
  'The first legal basis is not wrong, but the second doctrine is materially incorrect.',
  'The rule is not wrong; however, the cited authority is irrelevant.',
  'The first rule is not wrong, and the second statute is inapplicable.',
]) {
  test(`affirmative wrong-rule finding retains cap: ${finding}`, () => {
    const result = applyDeterministicScoreCap(assessment({ rationale: finding }), soundAnswer, explanationContext);
    assert.equal(result.score, 1.5);
    assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  });
}

test('an independent affirmative error is not masked by negated rationale', () => {
  const result = applyDeterministicScoreCap(assessment({
    rationale: 'The first legal basis is not wrong.',
    errors: ['The second governing rule is incorrect.'],
  }), soundAnswer, explanationContext);
  assert.equal(result.score, 1.5);
});

function weakRuleAssessment(overrides = {}) {
  return assessment({
    score: 3,
    rubricBreakdown: {
      responsiveness: 5, legalBasis: 2, application: 2.5, conclusion: 4,
      questionType: 'problem', applicationRequired: true,
    },
    ...overrides,
  });
}

test('affirmative bad-intent-only rule cannot escape existing low-rule safeguard', () => {
  const result = applyDeterministicScoreCap(weakRuleAssessment(), intentOnlyAnswer, problemContext);
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});

for (const answer of [
  soundAnswer,
  'No. It is not true that bad intent alone makes a person criminally liable. The governing law requires the elements of an offense. Mere intention without the necessary statutory elements is insufficient.',
  'No. The proposition that bad intent alone makes a person criminally liable is incorrect. Criminal liability requires proof of every element of the offense, rather than intention without a statutory basis.',
  'No. I reject the assertion that bad intent alone makes a person criminally liable. The statutory elements of an offense must be established; an intention without the required overt act is insufficient.',
  'No. The prosecutor argued, "bad intent alone makes a person criminally liable." That proposition is rejected because criminal liability requires every statutory element of an offense; mere intention is insufficient.',
  "No. The theory was 'bad intent alone makes a person criminally liable.' That proposition is rejected because criminal liability requires every statutory element of an offense; mere intention is insufficient.",
  'No. Bad intent alone is not sufficient to create criminal liability. The prosecution must prove the statutory elements of an offense; an intention without the required overt act is insufficient.',
]) {
  test(`rejected or quoted intent-only claim is not affirmative: ${answer.slice(0, 85)}`, () => {
    const result = applyDeterministicScoreCap(weakRuleAssessment(), answer, explanationContext);
    assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  });
}

test('does not broaden legal-basis threshold from 2 to 2.5', () => {
  const input = weakRuleAssessment();
  input.rubricBreakdown.legalBasis = 2.5;
  const result = applyDeterministicScoreCap(input, intentOnlyAnswer, problemContext);
  assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});

test('does not broaden application threshold beyond 2.5', () => {
  const input = weakRuleAssessment();
  input.rubricBreakdown.application = 3;
  const result = applyDeterministicScoreCap(input, intentOnlyAnswer, problemContext);
  assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});

test('low component values alone do not create a wrong-rule finding', () => {
  const result = applyDeterministicScoreCap(weakRuleAssessment(), soundAnswer, explanationContext);
  assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});

test('explicit authoritative score-ceiling codes remain authoritative', () => {
  const result = applyDeterministicScoreCap(assessment({
    rationale: 'One legal basis is not wrong.',
    scoreCeilingCode: 'materially_wrong_rule',
  }), soundAnswer, explanationContext);
  assert.equal(result.score, 1.5);
});
