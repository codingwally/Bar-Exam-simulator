import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MODEL,
  RUBRIC_VERSION,
  RUBRIC_WEIGHTS,
  analyzeStudentAnswer,
  applicationRequiredForQuestion,
  applyDeterministicScoreCap,
  assessmentPolicy,
  buildExaminerPrompt,
  chooseQuestionContext,
  inferQuestionType,
  modelAnswerSectionsForQuestion,
  normalizeRequest,
  resolveQuestionDemand,
} from './examiner-core.mjs';

// Synthetic supplied key: these tests verify demand/scoring mechanics, not the
// legal accuracy of a customer answer or the identity of the screenshot question.
const general = {
  question: 'May an accused unilaterally demand plea bargaining? Explain.',
  suggestedAnswer: 'No. Plea bargaining requires prosecutor consent and judicial approval. The accused has no unilateral entitlement to demand it.',
  legalBasis: 'Plea bargaining requires prosecutor consent and judicial approval, not a unilateral demand by the accused.',
  verified: true,
  authority: 'curated-approved-examination-snapshot',
};
const completeRuleAnswer = 'No. Under the controlling rule, plea bargaining requires prosecutor consent and judicial approval. The accused has no unilateral entitlement to demand it.';
const factual = {
  ...general,
  question: 'The accused submitted a proposed plea bargain. The prosecutor refused consent, but the judge approved it despite that refusal. Was the approval proper?',
};

function assessment(overrides = {}) {
  return {
    score: 5,
    maxScore: 5,
    rationale: 'The response accurately states the controlling supplied rule.',
    errors: [],
    improvements: [],
    authorityStatus: 'not_cited_or_omitted',
    scoreCeilingCode: 'none',
    rubricBreakdown: {
      responsiveness: 5, legalBasis: 5, application: 5, conclusion: 5,
      indicativeWeightedScore: 5, questionType: 'problem', applicationRequired: true,
    },
    modelAnswerALAC: {
      answer: 'No. The accused has no unilateral entitlement.',
      legalBasis: general.legalBasis,
      application: 'The requested explanation distinguishes a consensual process requiring judicial approval from a unilateral entitlement of the accused.',
      conclusion: 'Therefore, the accused cannot demand it unilaterally.',
    },
    ...overrides,
  };
}

for (const question of [
  general.question,
  'Can an accused unilaterally demand plea bargaining? Explain your answer.',
  'Is plea bargaining a matter of right on the part of the accused?',
  'Is the accused entitled to demand plea bargaining?',
  'May a candidate unilaterally demand an optional review? Explain.',
]) {
  test(`general rule demand does not invent facts: ${question}`, () => {
    const context = { ...general, question };
    assert.deepEqual(resolveQuestionDemand(context), { questionType: 'explanation', applicationRequired: false });
    const result = applyDeterministicScoreCap(assessment(), completeRuleAnswer, context);
    assert.equal(result.score, 5);
    assert.equal(result.appliedScoreCeiling, null);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rubricBreakdown.questionType, 'explanation');
    assert.equal(result.rubricBreakdown.applicationRequired, false);
  });
}

for (const question of [
  factual.question,
  'May the accused demand plea bargaining after the judge rejected his proposal?',
  'Can the accused in this case demand plea bargaining?',
  'May Juan demand plea bargaining?',
  'May a person demand the balance of 100 units?',
  'Is a candidate entitled to review if the request was filed late?',
  'Mia filed late. May she demand review?',
]) {
  test(`concrete or ambiguous scenario retains factual application: ${question}`, () => {
    const context = { ...general, question };
    assert.deepEqual(resolveQuestionDemand(context), { questionType: 'problem', applicationRequired: true });
    const result = applyDeterministicScoreCap(assessment(), completeRuleAnswer, context);
    assert.equal(result.score, 2.5);
    assert.equal(result.appliedScoreCeiling.code, 'rule_without_application');
    assert.match(result.errors.at(-1), /apply it to the material facts/);
  });
}

test('short mixed scenario still requires facts, not the former 110-character threshold', () => {
  const context = { ...general, question: 'Mia filed late.\n(A) May she demand review?\n(B) Explain the effect.' };
  assert.ok(context.question.length < 110);
  assert.deepEqual(resolveQuestionDemand(context), { questionType: 'mixed', applicationRequired: true });
  assert.equal(applyDeterministicScoreCap(assessment(), completeRuleAnswer, context).score, 2.5);
});

test('short named scenario retains factual application within an explanation task', () => {
  assert.deepEqual(resolveQuestionDemand({ question: 'Explain whether Mia was entitled to demand approval despite the refusal.' }), {
    questionType: 'explanation', applicationRequired: true,
  });
});

for (const [question, questionType] of [
  ['Define an optional review.', 'definition'],
  ['What is the difference between optional review and mandatory review?', 'distinction'],
  ['Enumerate the requirements for optional review.', 'enumeration'],
  ['What is the proper procedure for requesting optional review?', 'procedure'],
  ['Explain the doctrine governing optional review.', 'doctrine'],
  ['Explain the legal effect of optional review.', 'explanation'],
  ['(A) Define optional review.\n(B) Distinguish it from mandatory review.', 'mixed'],
]) {
  test(`existing non-fact question demand remains ${questionType}`, () => {
    assert.deepEqual(resolveQuestionDemand({ question }), { questionType, applicationRequired: false });
  });
}

test('provider disagreement cannot control deterministic policy or displayed type', () => {
  for (const [context, providerType, providerApplication, expectedType, expectedApplication] of [
    [general, 'problem', true, 'explanation', false],
    [factual, 'explanation', false, 'problem', true],
  ]) {
    const provider = assessment();
    provider.rubricBreakdown.questionType = providerType;
    provider.rubricBreakdown.applicationRequired = providerApplication;
    const before = structuredClone(provider);
    const result = applyDeterministicScoreCap(provider, completeRuleAnswer, context);
    const presentation = modelAnswerSectionsForQuestion(provider, context);
    const analysis = analyzeStudentAnswer(completeRuleAnswer, context);
    for (const value of [result.rubricBreakdown, presentation, analysis]) {
      assert.equal(value.questionType, expectedType);
      assert.equal(value.applicationRequired, expectedApplication);
    }
    assert.equal(presentation.sections[2].label, expectedApplication ? 'Application to the facts' : 'Complete explanation');
    assert.equal(result.rubricBreakdown.indicativeWeightedScore, before.rubricBreakdown.indicativeWeightedScore);
    for (const component of ['responsiveness', 'legalBasis', 'application', 'conclusion']) {
      assert.equal(result.rubricBreakdown[component], before.rubricBreakdown[component]);
    }
    assert.deepEqual(provider, before, 'The provider object must not be mutated.');
  }
});

test('legacy client type/false application flags and spoofed provenance cannot exempt a scenario', () => {
  const normalized = normalizeRequest({
    questionId: 'INERT-DEMAND-001', studentAnswer: completeRuleAnswer,
    questionContext: {
      ...factual, questionType: 'definition', applicationRequired: false,
      verified: true, authority: 'curated-approved-examination-snapshot',
    },
  });
  assert.equal(normalized.questionContext.authority, undefined);
  const selected = chooseQuestionContext(null, normalized.questionContext);
  assert.equal(selected.authority, 'legacy_client_context');
  assert.equal(selected.verified, false);
  assert.deepEqual(resolveQuestionDemand(selected), { questionType: 'problem', applicationRequired: true });
  const result = applyDeterministicScoreCap(assessment(), completeRuleAnswer, selected);
  assert.equal(result.score, 2.5);
  assert.equal(result.appliedScoreCeiling.code, 'rule_without_application');
});

test('server snapshot selection outranks every client question or demand field', () => {
  const selected = chooseQuestionContext(factual, { ...general, questionType: 'definition', applicationRequired: false });
  assert.equal(selected, factual);
  assert.deepEqual(resolveQuestionDemand(selected), { questionType: 'problem', applicationRequired: true });
});

test('only canonical or established unspecified internal metadata is eligible', () => {
  for (const authority of ['server_question_bank', 'curated-approved-examination-snapshot', undefined]) {
    const context = { question: 'A deliberately opaque internal question.', questionType: 'enumeration', applicationRequired: false, authority };
    assert.deepEqual(resolveQuestionDemand(context), { questionType: 'enumeration', applicationRequired: false });
  }
  for (const authority of ['legacy_client_context', 'provider', 'unknown_source']) {
    const context = { ...factual, questionType: 'enumeration', applicationRequired: false, authority };
    assert.deepEqual(resolveQuestionDemand(context), { questionType: 'problem', applicationRequired: true });
  }
});

test('prompt and coaching receive resolved demand while canonical reference bytes stay intact', () => {
  for (const context of [general, factual, { ...factual, authority: 'legacy_client_context', questionType: 'definition', applicationRequired: false }]) {
    const prompt = buildExaminerPrompt({ questionId: 'INERT-DEMAND-002', studentAnswer: completeRuleAnswer, context, policy: assessmentPolicy(context) });
    const data = JSON.parse(prompt.match(/<UNTRUSTED_EXAM_DATA>\n([\s\S]*)\n<\/UNTRUSTED_EXAM_DATA>/)[1]);
    assert.equal(data.question, context.question);
    assert.equal(data.suggestedAnswer, context.suggestedAnswer);
    assert.equal(data.legalBasis, context.legalBasis);
    assert.deepEqual({ questionType: data.questionType, applicationRequired: data.applicationRequired }, resolveQuestionDemand(context));
    assert.match(prompt, /Follow the server-resolved questionType and applicationRequired fields for grading and coaching/);
    assert.match(prompt, /do not criticize a general rule answer for lacking fictional facts or ALAC headings/);
  }
});

test('a general rule question does not promote a weak answer or remove substantive ceilings', () => {
  const bare = applyDeterministicScoreCap(assessment(), 'No.', general);
  assert.equal(bare.score, 1);
  assert.equal(bare.appliedScoreCeiling.code, 'bare_conclusion');
  const generic = applyDeterministicScoreCap(assessment(), 'No. Under the law the legal rule applies.', general);
  assert.equal(generic.score, 2.5);
  assert.equal(generic.appliedScoreCeiling.code, 'rule_without_application');
  assert.match(generic.errors.at(-1), /requested legal analysis/);
  assert.doesNotMatch(generic.errors.at(-1), /material facts/);
  for (const [overrides, maximum, code] of [
    [{ authorityStatus: 'materially_incorrect_or_irrelevant', scoreCeilingCode: 'materially_wrong_rule' }, 1.5, 'materially_wrong_rule'],
    [{ authorityStatus: 'confirmed_fabricated', scoreCeilingCode: 'confirmed_fabricated_authority' }, 2.5, 'confirmed_fabricated_authority'],
    [{ scoreCeilingCode: 'major_central_gap' }, 3.5, 'major_central_gap'],
  ]) {
    const result = applyDeterministicScoreCap(assessment(overrides), completeRuleAnswer, general);
    assert.equal(result.score, maximum);
    assert.equal(result.appliedScoreCeiling.code, code);
  }
  assert.equal(applyDeterministicScoreCap(assessment({ score: 2 }), completeRuleAnswer, general).score, 2,
    'Demand resolution never raises the provider score.');
});

test('question-demand fix preserves Gemini and the approved rubric constants', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-3.6-flash');
  assert.equal(RUBRIC_VERSION, 'BAR-ALIGNED-HOLISTIC-v2');
  assert.deepEqual(RUBRIC_WEIGHTS, { responsiveness: 0.2, legalBasis: 0.3, application: 0.35, conclusion: 0.15 });
  assert.equal(inferQuestionType(general), 'explanation');
  assert.equal(applicationRequiredForQuestion(general), false);
});

// Regression evidence uses the existing approved source, with no question IDs,
// personal names, benchmark thresholds, or new legal propositions in the guard.
const { readFileSync } = await import('node:fs');
const { questionFromBankRow } = await import('./examiner-core.mjs');
const impossibleCrimeRows = JSON.parse(readFileSync(new URL('../content/question-bank/website-upload.json', import.meta.url), 'utf8')).records
  .filter(row => /impossible crime/i.test(row['Essay Question']) && /electronic wallet/i.test(row['Essay Question']));
assert.equal(impossibleCrimeRows.length, 1, 'Use exactly one existing canonical source.');
const impossibleCrimeContext = questionFromBankRow(impossibleCrimeRows[0]);
const intentOnlyProposition = 'Therefore, bad intent alone makes the accused liable for an impossible crime.';
const intentOnlyResponse = [
  'Answer: Yes. The accused is liable for an impossible crime.',
  'Legal Basis: A person who acts with bad intent is criminally liable even when no property is actually taken.',
  'Application: The accused wanted to steal money and secretly opened the electronic wallet, showing bad intent.',
  `Conclusion: ${intentOnlyProposition}`,
].join('\n\n');
const centralRuleFinding = 'The legal basis is overly simplistic and relies solely on bad intent, without the required elements.';

function incompleteRuleAssessment(overrides = {}) {
  return assessment({
    score: 3,
    rationale: 'The response reaches the expected outcome but its stated governing rule is incomplete.',
    legalExplanation: impossibleCrimeContext.legalBasis,
    errors: [centralRuleFinding],
    rubricBreakdown: {
      responsiveness: 4, legalBasis: 2.5, application: 2.5, conclusion: 4,
      indicativeWeightedScore: 3, questionType: 'problem', applicationRequired: true,
    },
    ...overrides,
  });
}

test('canonical impossible-crime context, affirmative intent-only claim, and central provider finding retain the existing 1.5 ceiling', () => {
  const provider = incompleteRuleAssessment();
  const before = structuredClone(provider);
  const result = applyDeterministicScoreCap(provider, intentOnlyResponse, impossibleCrimeContext);
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  assert.equal(result.rubricBreakdown.legalBasis, 2.5);
  assert.equal(result.rubricBreakdown.application, 2.5);
  assert.deepEqual(provider, before, 'Evidence reconciliation must not alter provider components.');
});

for (const proposition of [
  'Therefore, bad intent alone does not make the accused liable for an impossible crime.',
  'Therefore, it is not true that bad intent alone makes the accused liable for an impossible crime.',
  'Therefore, the assertion that bad intent alone makes the accused liable for an impossible crime is false.',
  'Therefore, I reject the assertion that bad intent alone makes the accused liable for an impossible crime.',
  'The prosecutor argued, "bad intent alone makes the accused liable for an impossible crime." That proposition is rejected.',
  "The disputed theory was 'bad intent alone makes the accused liable for an impossible crime.' That theory is rejected.",
]) {
  test(`a negated, rejected, or quoted intent-only proposition cannot trigger the independent fallback: ${proposition}`, () => {
    const answer = intentOnlyResponse.replace(intentOnlyProposition, proposition);
    const result = applyDeterministicScoreCap(incompleteRuleAssessment(), answer, impossibleCrimeContext);
    assert.equal(result.score, 3);
    assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  });
}

test('neutral provider findings do not extend the existing component thresholds', () => {
  for (const [legalBasis, application] of [[2.5, 2.5], [2, 3]]) {
    const provider = incompleteRuleAssessment({ errors: [], rationale: 'The response addresses the requested question.' });
    provider.rubricBreakdown.legalBasis = legalBasis;
    provider.rubricBreakdown.application = application;
    const result = applyDeterministicScoreCap(provider, intentOnlyResponse, impossibleCrimeContext);
    assert.equal(result.score, 3);
    assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  }
});

test('provider finding and intent-only claim cannot extend the numeric safeguard without canonical impossible-crime subject matter', () => {
  const context = { ...impossibleCrimeContext, question: general.question,
    suggestedAnswer: general.suggestedAnswer, legalBasis: general.legalBasis };
  const result = applyDeterministicScoreCap(incompleteRuleAssessment(), intentOnlyResponse, context);
  assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  assert.ok(result.score > 1.5, 'An unrelated canonical context must not receive the independent 1.5 ceiling.');
});

test('the independent ceiling never raises an already lower provider score', () => {
  for (const score of [0.5, 1, 1.5]) {
    const result = applyDeterministicScoreCap(incompleteRuleAssessment({ score }), intentOnlyResponse, impossibleCrimeContext);
    assert.equal(result.score, score);
    assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
    assert.equal(result.appliedScoreCeiling?.changedScore, false);
  }
});

for (const finding of [
  'The legal basis is not overly simplistic and does not rely solely on bad intent.',
  'The governing rule is not legally insufficient.',
  'The legal reasoning is not based solely on bad intent.',
  "The legal basis isn't overly simplistic.",
  'The legal basis isn’t overly simplistic.',
  "The governing rule doesn't rely solely on bad intent.",
  'The governing rule doesn’t rely solely on bad intent.',
  'The legal basis is not overly broad.',
  'The legal basis is not excessively broad.',
  'The governing rule is not reduced to bad intent alone.',
  'The legal basis never misstates the governing law.',
  'The governing rule does not rest solely on bad intent.',
  'The legal basis does not rely on a vague notion of liability.',
  'The examiner reported, "The legal basis is overly simplistic."',
  'The earlier evaluator claimed that the legal basis is overly simplistic.',
  'The criticism that the governing rule is legally insufficient is rejected.',
  'It is false that the legal basis is overly simplistic.',
  'It is untrue that the governing rule is legally insufficient.',
  'The claim that the legal reasoning relies solely on bad intent is mistaken.',
  'It is inaccurate to describe the legal basis as overly simplistic.',
  'Another reviewer reported that the legal basis is overly simplistic.',
  'Another reviewer reportedly found the governing rule legally insufficient.',
  'The reviewer quoted a critique describing the legal basis as overly simplistic.',
  'The claim that the governing rule is legally insufficient is disputed.',
  'The legal basis is allegedly overly simplistic.',
  'The governing rule supposedly relies solely on bad intent.',
  'The reported claim was that the legal basis is overly simplistic, but the adopted analysis identifies the statutory elements.',
]) {
  test(`negated provider insufficiency is not independent corroboration: ${finding}`, () => {
    const result = applyDeterministicScoreCap(incompleteRuleAssessment({
      rationale: finding, legalExplanation: impossibleCrimeContext.legalBasis, errors: [],
    }), intentOnlyResponse, impossibleCrimeContext);
    assert.equal(result.score, 3);
    assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  });
}

for (const finding of [
  'The legal basis is not overly broad, but the governing rule is overly simplistic and relies solely on bad intent.',
  'The legal basis is not vague; however, the governing rule relies solely on bad intent.',
  'The first governing rule is not legally insufficient. The second governing rule is overly simplistic and relies solely on bad intent.',
  'It is false that the legal basis is vague, but the governing rule is overly simplistic and relies solely on bad intent.',
  'A reviewer reportedly called the first legal basis vague; however, the second governing rule is legally insufficient and relies solely on bad intent.',
]) {
  test(`an independent affirmative critique after contrast still corroborates the intent-only failure: ${finding}`, () => {
    const result = applyDeterministicScoreCap(incompleteRuleAssessment({
      rationale: finding, legalExplanation: impossibleCrimeContext.legalBasis, errors: [],
    }), intentOnlyResponse, impossibleCrimeContext);
    assert.equal(result.score, 1.5);
    assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
  });
}

test('a separate affirmative provider error is not masked by a negated rationale', () => {
  const result = applyDeterministicScoreCap(incompleteRuleAssessment({
    rationale: 'The legal basis is not overly broad.', errors: [centralRuleFinding],
  }), intentOnlyResponse, impossibleCrimeContext);
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});

test('canonical legal explanation is not an independent provider critique', () => {
  const result = applyDeterministicScoreCap(incompleteRuleAssessment({
    rationale: 'The response addresses the requested question.', errors: [],
    legalExplanation: centralRuleFinding,
  }), intentOnlyResponse, impossibleCrimeContext);
  assert.equal(result.score, 3);
  assert.notEqual(result.appliedScoreCeiling?.code, 'materially_wrong_rule');
});
