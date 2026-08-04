import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RUBRIC_VERSION,
  RUBRIC_WEIGHTS,
  applicationRequiredForQuestion,
  applyDeterministicScoreCap,
  assessmentPolicy,
  buildExaminerPrompt,
  inferQuestionType,
  usesBarAlignedRubric,
  validateExaminerResult,
} from './examiner-core.mjs';

const context = {
  subject: 'Remedial Law',
  question: 'Counsel allowed a nonlawyer employee to prepare an appellate brief, sign counsel’s name, and file it before counsel reviewed it. Was the delegation proper?',
  suggestedAnswer: 'No. A lawyer must personally supervise legal work and cannot permit a nonlawyer to exercise professional judgment or sign pleadings in the lawyer’s name. Because the employee prepared, signed, and filed the brief before counsel reviewed it, the delegation was improper.',
  legalBasis: 'A lawyer must personally supervise delegated legal work and remains responsible for work performed by a nonlawyer assistant.',
  verified: true,
};

function assessment(score = 5, overrides = {}) {
  return {
    score,
    maxScore: 5,
    percentagePointValue: score,
    tier: '5.0',
    performanceLabel: 'Excellent answer',
    assessmentType: 'question_bank',
    label: 'Verified question-bank assessment',
    rationale: 'The answer is legally correct and meaningfully reasoned.',
    strengths: ['Correct doctrine', 'Meaningful application'],
    errors: [],
    improvements: [],
    legalExplanation: 'A lawyer must personally supervise delegated legal work.',
    modelAnswerALAC: {
      answer: 'No. The delegation was improper.',
      legalBasis: 'A lawyer must personally supervise delegated legal work.',
      application: 'The employee prepared, signed, and filed the brief before counsel reviewed it.',
      conclusion: 'Therefore, the delegation was improper.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    authorityStatus: 'not_cited_or_omitted',
    scoreCeilingCode: 'none',
    rubricBreakdown: {
      responsiveness: 5,
      legalBasis: 5,
      application: 5,
      conclusion: 5,
      questionType: 'problem',
      applicationRequired: true,
    },
    rubricVersion: RUBRIC_VERSION,
    ...overrides,
  };
}

test('rubric v2 is the default essay backbone and Bar Easy is expressly exempt', () => {
  assert.equal(RUBRIC_VERSION, 'BAR-ALIGNED-HOLISTIC-v2');
  assert.deepEqual(RUBRIC_WEIGHTS, {
    responsiveness: 0.20,
    legalBasis: 0.30,
    application: 0.35,
    conclusion: 0.15,
  });
  for (const feature of ['', 'mock_bar', 'subject_matter', 'bar_feels', 'future_exam']) {
    assert.equal(usesBarAlignedRubric(feature), true, feature || 'default');
  }
  assert.equal(usesBarAlignedRubric('bar_easy'), false);
  assert.equal(usesBarAlignedRubric('Bar Easy'), false);
  assert.throws(
    () => buildExaminerPrompt({
      questionId: 'BE-001', studentAnswer: 'Test', context, policy: assessmentPolicy(context), examFeature: 'bar_easy',
    }),
    /dedicated coaching rubric/i,
  );
});

test('prompt locks the approved substance-first and citation-neutral policy', () => {
  const prompt = buildExaminerPrompt({
    questionId: 'REM-TEST',
    studentAnswer: 'No. The delegation was improper.',
    context,
    policy: assessmentPolicy(context),
  });
  assert.match(prompt, /responsiveness\/direct answer 20%/i);
  assert.match(prompt, /legal basis 30%/i);
  assert.match(prompt, /application or requested legal analysis 35%/i);
  assert.match(prompt, /conclusion\/coherence 15%/i);
  assert.match(prompt, /not a mandatory format for the student's answer/i);
  assert.match(prompt, /exact article numbers[\s\S]*are not required for full credit/i);
  assert.match(prompt, /“Under the law”[\s\S]*not by itself a sufficient legal basis/i);
  assert.match(prompt, /Unverified is not fabricated/i);
  assert.match(prompt, /Grammar, spelling, and style are ordinarily coaching feedback only/i);
  assert.match(prompt, /legally defensible alternative answers/i);
});

test('a legally sound narrative without headings or exact citations may retain 5.0', () => {
  const answer = 'No. A lawyer must personally supervise delegated legal work and cannot allow a nonlawyer to exercise professional judgment or sign pleadings in the lawyer’s name. The employee prepared the brief, signed counsel’s name, and filed it before counsel reviewed it, so the required prior supervision was absent. The delegation was therefore improper.';
  const result = applyDeterministicScoreCap(assessment(5), answer, context);
  assert.equal(result.score, 5);
  assert.equal(result.appliedScoreCeiling, null);
});

test('minor grammar does not reduce a comprehensible legally sound answer', () => {
  const answer = 'No. Lawyer must supervise delegated legal work. Employee prepare and sign the brief before lawyer reviewed it, so prior supervision was absent and delegation was improper.';
  const result = applyDeterministicScoreCap(assessment(4.6), answer, context);
  assert.equal(result.score, 4.6);
});

test('generic invocation of law without factual application remains capped', () => {
  const answer = 'No. Under the law and jurisprudence, the delegation was improper.';
  const result = applyDeterministicScoreCap(assessment(5), answer, context);
  assert.equal(result.score, 2.5);
  assert.equal(result.appliedScoreCeiling.code, 'rule_without_application');
});

test('definition and explanation questions do not invent a factual-application requirement', () => {
  const definitionContext = {
    subject: 'Criminal Law',
    question: 'Define mala in se and mala prohibita and distinguish them.',
    suggestedAnswer: 'Mala in se acts are inherently immoral; mala prohibita acts are prohibited by statute. Criminal intent is generally relevant to mala in se but not ordinarily to mala prohibita.',
    legalBasis: 'The distinction concerns inherent wrongfulness, statutory prohibition, and the relevance of criminal intent.',
    verified: true,
  };
  assert.equal(inferQuestionType(definitionContext), 'definition');
  assert.equal(applicationRequiredForQuestion(definitionContext), false);
  const answer = 'Mala in se is inherently wrong, while mala prohibita is wrong because a statute prohibits it. Criminal intent is generally material to the former but ordinarily not required for the latter.';
  const result = applyDeterministicScoreCap(assessment(4.8), answer, definitionContext);
  assert.equal(result.score, 4.8);
});

test('an unverified authority never triggers the fabrication ceiling', () => {
  const unverified = assessment(4.4, {
    authorityStatus: 'unverified',
    errors: ['The cited case could not be verified from the currently available sources.'],
  });
  const answer = 'No. A lawyer must supervise delegated legal work. Here, the employee prepared, signed, and filed the brief before counsel reviewed it, so the delegation was improper.';
  const result = applyDeterministicScoreCap(unverified, answer, context);
  assert.equal(result.score, 4.4);
  assert.equal(result.appliedScoreCeiling, null);
});

test('confirmed fabrication and materially wrong central rules retain strict ceilings', () => {
  const answer = 'No. A lawyer must supervise delegated legal work. Here, the employee prepared, signed, and filed the brief before counsel reviewed it, so the delegation was improper.';
  const fabricated = applyDeterministicScoreCap(assessment(4.8, {
    authorityStatus: 'confirmed_fabricated',
    scoreCeilingCode: 'confirmed_fabricated_authority',
  }), answer, context);
  assert.equal(fabricated.score, 2.5);
  assert.equal(fabricated.appliedScoreCeiling.code, 'confirmed_fabricated_authority');

  const wrongRule = applyDeterministicScoreCap(assessment(4.8, {
    authorityStatus: 'materially_incorrect_or_irrelevant',
    scoreCeilingCode: 'materially_wrong_rule',
  }), answer, context);
  assert.equal(wrongRule.score, 1.5);
  assert.equal(wrongRule.appliedScoreCeiling.code, 'materially_wrong_rule');
});

test('major central gaps use the approved 3.5 ceiling without word-matching the model answer', () => {
  const answer = 'No. A lawyer must supervise delegated legal work. Here, the employee prepared and filed the brief before counsel reviewed it, so supervision was absent.';
  const result = applyDeterministicScoreCap(assessment(4.5, {
    scoreCeilingCode: 'major_central_gap',
  }), answer, context);
  assert.equal(result.score, 3.5);
  assert.equal(result.appliedScoreCeiling.code, 'major_central_gap');
});

test('validated results preserve the auditable rubric breakdown and weighted reference', () => {
  const result = validateExaminerResult(assessment(4.6, {
    rubricBreakdown: {
      responsiveness: 5,
      legalBasis: 4.5,
      application: 4.4,
      conclusion: 4.8,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), assessmentPolicy(context));
  assert.equal(result.rubricVersion, RUBRIC_VERSION);
  assert.equal(result.rubricBreakdown.indicativeWeightedScore, 4.6);
  assert.equal(result.authorityStatus, 'not_cited_or_omitted');
  assert.equal(result.scoreCeilingCode, 'none');
});
