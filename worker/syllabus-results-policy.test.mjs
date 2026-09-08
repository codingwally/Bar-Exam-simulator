import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  SYLLABUS_GRADING_POLICY_VERSION, withSyllabusGradingPolicy, resolveQuestionDemand,
  applyDeterministicScoreCap, analyzeStudentAnswer, buildExaminerPrompt, assessmentPolicy,
  modelAnswerSectionsForQuestion, modelAnswerQualityIssues, normalizeRequest, chooseQuestionContext,
  questionFromBankRow, DEFAULT_MODEL, RUBRIC_VERSION, RUBRIC_WEIGHTS,
} from './examiner-core.mjs';

// Synthetic reference: grading-mechanics evidence, not legal-score accuracy.
const reference = 'A conditional duty is an obligation that becomes enforceable only when a stated future event occurs.';
const base = { question: 'Define a conditional duty.', suggestedAnswer: reference,
  legalBasis: 'A conditional duty depends on a future event before performance becomes enforceable.',
  authority: 'curated-approved-examination-snapshot', verified: true };
const scoped = extra => withSyllabusGradingPolicy({ ...base, ...extra }, 'per_subject');
function assessment(extra = {}) {
  return { score: 4.5, maxScore: 5, rationale: 'The response accurately and completely defines the requested term.',
    strengths: ['Correct and complete definition.'], errors: [], improvements: [], legalExplanation: base.legalBasis,
    authorityStatus: 'not_cited_or_omitted', scoreCeilingCode: 'none', rubricVersion: RUBRIC_VERSION,
    rubricBreakdown: { responsiveness: 4.5, legalBasis: 4.5, application: 4.5, conclusion: 4.5,
      questionType: 'problem', applicationRequired: true, indicativeWeightedScore: 4.5 },
    modelAnswerALAC: { answer: reference,
      legalBasis: 'The supplied governing source defines a conditional duty as an obligation whose enforcement depends on a stated future event occurring.',
      application: reference,
      conclusion: 'Therefore, performance depends on occurrence of the stated future event.' }, ...extra };
}
test('only owner-authorized per_subject plus canonical authority constructs the versioned policy', () => {
  assert.equal(scoped().gradingPolicyVersion, SYLLABUS_GRADING_POLICY_VERSION);
  for (const track of [null, undefined, 'bar_feels', 'unknown', 'subject_matter', 'PER_SUBJECT']) {
    assert.equal(withSyllabusGradingPolicy(base, track), base);
    const attempted = withSyllabusGradingPolicy(scoped(), track);
    assert.equal(attempted.gradingTrack, undefined); assert.equal(attempted.gradingPolicyVersion, undefined);
  }
  for (const authority of [undefined, 'server_question_bank', 'legacy_client_context', 'provider']) {
    const context = withSyllabusGradingPolicy({ ...scoped(), authority }, 'per_subject');
    assert.equal(context.gradingPolicyVersion, undefined);
  }
  assert.equal(base.gradingPolicyVersion, undefined, 'Do not mutate the canonical input.');
});
test('client normalization and legacy provenance cannot enable the grading policy', () => {
  const input = normalizeRequest({ questionId: 'INERT-SYLLABUS-001', studentAnswer: reference,
    questionContext: { ...scoped({ question: 'What is a conditional duty?' }), track: 'per_subject' } });
  for (const field of ['gradingTrack', 'gradingPolicyVersion', 'track', 'authority']) assert.equal(input.questionContext[field], undefined);
  const legacy = chooseQuestionContext(null, input.questionContext);
  assert.equal(legacy.authority, 'legacy_client_context');
  assert.deepEqual(resolveQuestionDemand(legacy), { questionType: 'problem', applicationRequired: true });
});
for (const question of ['What is a conditional duty?', 'What are quasi-delicts?', 'What is negligence? Explain briefly.', 'What is criminal liability?']) {
  test(`fact-free Syllabus definition: ${question}`, () => {
    const context = scoped({ question });
    assert.deepEqual(resolveQuestionDemand(context), { questionType: 'definition', applicationRequired: false });
    assert.equal(analyzeStudentAnswer(reference, context).applicationRequired, false);
    const result = applyDeterministicScoreCap(assessment(), reference, context);
    assert.equal(result.score, 4.5); assert.equal(result.appliedScoreCeiling, null);
    assert.equal(result.rubricBreakdown.questionType, 'definition');
    assert.equal(result.rubricBreakdown.applicationRequired, false);
    assert.equal(modelAnswerSectionsForQuestion(result, context).sections[2].label, 'Elements and scope');
    const prompt = buildExaminerPrompt({ questionId: 'INERT-SYLLABUS-002', studentAnswer: reference, context, policy: assessmentPolicy(context) });
    const data = JSON.parse(prompt.match(/<UNTRUSTED_EXAM_DATA>\n([\s\S]*)\n<\/UNTRUSTED_EXAM_DATA>/)[1]);
    assert.equal(data.question, question); assert.equal(data.suggestedAnswer, reference);
    assert.equal(data.questionType, 'definition'); assert.equal(data.applicationRequired, false);
    assert.deepEqual(modelAnswerQualityIssues(result, context), []);
  });
}
test('default, unknown and other-track What-is behavior is unchanged', () => {
  for (const context of [base, { ...base, gradingTrack: 'per_subject' }, { ...base, gradingTrack: 'bar_feels', gradingPolicyVersion: SYLLABUS_GRADING_POLICY_VERSION },
    { ...base, gradingTrack: 'per_subject', gradingPolicyVersion: 'unknown' }, { ...scoped(), authority: 'legacy_client_context' }]) {
    const c = { ...context, question: 'What is a conditional duty?' };
    assert.deepEqual(resolveQuestionDemand(c), { questionType: 'problem', applicationRequired: true });
    assert.equal(applyDeterministicScoreCap(assessment(), reference, c).score, 2.5);
  }
});
for (const [question, type, application] of [
  ["What is A's liability after A sold the property?", 'problem', true],
  ['What is the liability of Maria?', 'problem', true],
  ['What is the liability of A?', 'problem', true],
  ['What is his liability?', 'problem', true],
  ['What is the penalty for B?', 'problem', true],
  ['What are their rights?', 'problem', true],
  ['What is the legal status of B?', 'problem', true],
  ['What is the liability of the accused?', 'problem', true],
  ['What is the penalty for theft?', 'problem', true],
  ['What is a conditional duty if the event already occurred?', 'problem', true],
  ['What is a duty? A refused performance. Is A liable?', 'problem', true],
  ['What is the proper remedy after A filed an untimely appeal?', 'procedure', true],
  ['What is the proper procedure for requesting review?', 'procedure', false],
  ['What is the difference between conditional and absolute duties?', 'distinction', false],
  ['What are the essential requisites of a conditional duty?', 'enumeration', false],
  ['(A) Define a conditional duty.\n(B) Explain its effect.', 'mixed', false],
]) test(`scope does not exempt facts or override existing task precedence: ${question}`, () => {
  assert.deepEqual(resolveQuestionDemand(scoped({ question })), { questionType: type, applicationRequired: application });
});

const negated = [
  ['rationale', 'No fabricated citation appears in the answer.'],
  ['rationale', 'No citation is fabricated.'],
  ['rationale', 'The response does not rely on a fabricated authority.'],
  ['rationale', 'A fabricated authority was not cited.'],
  ['rationale', 'The response correctly rejects the wrong rule that every duty is immediately enforceable.'],
  ['rationale', 'The response avoids the wrong rule that every duty is immediately enforceable.'],
  ['rationale', 'No governing rule is wrong.'],
  ['rationale', 'The governing rule is not materially wrong.'],
  ['rationale', 'The legal basis in Art. 4 is not wrong.'],
  ['rationale', 'There is no evidence that the governing rule is wrong.'],
  ['rationale', 'Not every governing rule is wrong.'],
  ['rationale', 'The claim that the governing rule is wrong is rejected.'],
  ['rationale', 'It is false that the governing rule is wrong.'],
  ['rationale', 'The false claim that the authority is fabricated is rejected.'],
  ['rationale', 'The earlier reviewer claimed that the governing rule is wrong.'],
  ['rationale', 'The earlier reviewer found that the governing rule is wrong.'],
  ['rationale', 'The critic said, "The governing rule is wrong."'],
  ['rationale', "The critic quoted 'the governing rule is wrong'."],
  ['errors', 'The response does not omit any material qualification.'],
  ['errors', 'The response omits no material qualification.'],
  ['errors', 'The response did not fail to state the essential requirement.'],
  ['errors', 'The earlier evaluator claimed that the response omits a material qualification.'],
  ['errors', 'The claim that the response omits a material qualification is false.'],
];
for (const [field, finding] of negated) test(`Syllabus text-derived ceiling requires an adopted finding: ${finding}`, () => {
  const provider = assessment({ [field]: field === 'errors' ? [finding] : finding }), original = structuredClone(provider);
  const result = applyDeterministicScoreCap(provider, reference, scoped());
  assert.equal(result.score, 4.5); assert.equal(result.appliedScoreCeiling, null);
  assert.equal(result.authorityStatus, 'not_cited_or_omitted'); assert.deepEqual(provider, original);
  assert.deepEqual(result.errors, original.errors); assert.equal(result.rationale, original.rationale);
});
for (const [finding, field, score, code] of [
  ['The response relies on a fabricated authority.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['The response claimed a fabricated authority.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['The student explicitly asserted a fabricated authority.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['No fabricated citation appears in the first paragraph; however, the second citation is fabricated.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['The first citation is unverified, but the second citation is fabricated.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['The critic said "no fabricated authority"; the response uses an invented citation.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['Do not overlook that the response relies on a fabricated authority.', 'rationale', 2.5, 'confirmed_fabricated_authority'],
  ['The response relies on an incorrect rule.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The student asserted an incorrect rule.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The answer wrongly claimed an incorrect doctrine.', 'rationale', 1.5, 'materially_wrong_rule'],
  ["The cited 'Rule X' is incorrect.", 'rationale', 1.5, 'materially_wrong_rule'],
  ['The cited "Rule X" is incorrect.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The legal basis in Art. 4 is wrong.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The legal basis in Sec. 5 is incorrect.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The first rule is not wrong, and the second statute is inapplicable.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The legal basis is not only wrong but unrelated to the question.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response rejects the wrong rule, but the second doctrine is incorrect.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response does not reject the wrong rule.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response correctly rejects the wrong rule and the second rule is wrong.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response correctly rejects the wrong rule and then relies on an incorrect doctrine.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response correctly rejects the wrong rule and omits an essential requirement.', 'errors', 3.5, 'major_central_gap'],
  ['The earlier reviewer claimed the rule was incorrect; however, the answer relies on an incorrect doctrine.', 'rationale', 1.5, 'materially_wrong_rule'],
  ['The response does not omit a qualification, but the answer omits an essential requirement.', 'errors', 3.5, 'major_central_gap'],
  ['The answer omitted the "material exception".', 'errors', 3.5, 'major_central_gap'],
  ["The answer omitted the 'material exception'.", 'errors', 3.5, 'major_central_gap'],
  ['The response not only omits the material exception but also omits an essential requirement.', 'errors', 3.5, 'major_central_gap'],
  ['The earlier reviewer said "the response omits a material qualification"; the answer omits a procedural prerequisite.', 'errors', 3.5, 'major_central_gap'],
]) test(`independent affirmative Syllabus finding retains existing ceiling: ${finding}`, () => {
  const result = applyDeterministicScoreCap(assessment({ [field]: field === 'errors' ? [finding] : finding }), reference, scoped());
  assert.equal(result.score, score); assert.equal(result.appliedScoreCeiling?.code, code);
});
test('negated rationale does not hide an independent affirmative error', () => {
  const result = applyDeterministicScoreCap(assessment({ rationale: 'The rule is not wrong.', errors: ['The second governing rule is incorrect.'] }), reference, scoped());
  assert.equal(result.score, 1.5);
});
test('existing structured hard signals, thresholds and lower scores stay authoritative', () => {
  for (const [extra, score, code] of [
    [{ authorityStatus: 'confirmed_fabricated' }, 2.5, 'confirmed_fabricated_authority'],
    [{ authorityStatus: 'materially_incorrect_or_irrelevant' }, 1.5, 'materially_wrong_rule'],
    [{ scoreCeilingCode: 'major_central_gap' }, 3.5, 'major_central_gap'],
    [{ scoreCeilingCode: 'confirmed_fabricated_authority' }, 2.5, 'confirmed_fabricated_authority'],
    [{ scoreCeilingCode: 'materially_wrong_rule' }, 1.5, 'materially_wrong_rule'],
  ]) {
    const result = applyDeterministicScoreCap(assessment({ rationale: 'No fabricated citation appears and no rule is wrong.', ...extra }), reference, scoped());
    assert.equal(result.score, score); assert.equal(result.appliedScoreCeiling?.code, code);
    for (const low of [0.5, 1, 1.5]) assert.equal(applyDeterministicScoreCap(assessment({ ...extra, score: low }), reference, scoped()).score, low);
  }
  assert.equal(applyDeterministicScoreCap(assessment(), 'No.', scoped()).score, 1);
  assert.equal(DEFAULT_MODEL, 'gemini-3.6-flash'); assert.equal(RUBRIC_VERSION, 'BAR-ALIGNED-HOLISTIC-v2');
  assert.deepEqual(RUBRIC_WEIGHTS, { responsiveness: 0.2, legalBasis: 0.3, application: 0.35, conclusion: 0.15 });
});
test('legacy text-inferred behavior is untouched without trusted Syllabus opt-in', () => {
  for (const [finding, score] of [['No fabricated citation appears in the answer.', 2.5], ['The response correctly rejects the wrong rule.', 1.5]]) {
    assert.equal(applyDeterministicScoreCap(assessment({ rationale: finding }), reference, base).score, score);
    assert.equal(applyDeterministicScoreCap(assessment({ rationale: finding }), reference, withSyllabusGradingPolicy(base, 'bar_feels')).score, score);
  }
});

const impossibleRows = JSON.parse(readFileSync(new URL('../content/question-bank/website-upload.json', import.meta.url), 'utf8')).records
  .filter(row => /impossible crime/i.test(row['Essay Question']) && /electronic wallet/i.test(row['Essay Question']));
assert.equal(impossibleRows.length, 1);
const impossible = { ...questionFromBankRow(impossibleRows[0]), authority: 'curated-approved-examination-snapshot' };
const intentOnly = 'Answer: Yes. The accused is liable for an impossible crime.\nLegal Basis: A person who acts with bad intent is criminally liable even when no property is actually taken.\nApplication: The accused wanted to steal money and secretly opened the electronic wallet, showing bad intent.\nConclusion: Therefore, bad intent alone makes the accused liable for an impossible crime.';
test('canonical impossible-crime corroboration and component thresholds are unchanged with the scoped policy', () => {
  const findings = ['The legal basis is overly simplistic and relies solely on bad intent, without the required elements.',
    'The governing rule is not legally insufficient.', 'The earlier reviewer claimed that the legal basis is overly simplistic.',
    'The first rule is not vague, but the governing rule relies solely on bad intent.'];
  for (const finding of findings) for (const [legalBasis, application] of [[2, 2.5], [2.5, 2.5], [2, 3]]) {
    const provider = assessment({ score: 3, rationale: finding, legalExplanation: impossible.legalBasis,
      rubricBreakdown: { responsiveness: 4, legalBasis, application, conclusion: 4, questionType: 'problem', applicationRequired: true } });
    for (const answer of [intentOnly, intentOnly.replace('bad intent alone makes', 'bad intent alone does not make'),
      intentOnly.replace('Therefore, bad intent alone makes the accused liable for an impossible crime.', 'The prosecutor said, "bad intent alone makes the accused liable for an impossible crime." That proposition is rejected.')]) {
      const original = applyDeterministicScoreCap(provider, answer, impossible);
      const result = applyDeterministicScoreCap(provider, answer, withSyllabusGradingPolicy(impossible, 'per_subject'));
      assert.equal(result.score, original.score); assert.deepEqual(result.appliedScoreCeiling, original.appliedScoreCeiling);
      assert.equal(result.rubricBreakdown.legalBasis, legalBasis); assert.equal(result.rubricBreakdown.application, application);
    }
  }
});
