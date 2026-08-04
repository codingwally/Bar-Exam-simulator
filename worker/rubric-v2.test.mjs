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
  assert.match(prompt, /essential elements, exceptions, qualifications, voting thresholds/i);
  assert.match(prompt, /correct conclusion reached only through a materially wrong/i);
  assert.match(prompt, /self-disclaimer is reliable confirmation/i);
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


test('common distinction and enumeration phrasing does not invent factual application', () => {
  const distinction = { question: 'What is the difference between mala in se and mala prohibita?' };
  const enumeration = { question: 'What are the essential elements of a valid contract?' };
  assert.equal(inferQuestionType(distinction), 'distinction');
  assert.equal(applicationRequiredForQuestion(distinction), false);
  assert.equal(inferQuestionType(enumeration), 'enumeration');
  assert.equal(applicationRequiredForQuestion(enumeration), false);
});

test('an expressly test-only nonexistent authority is deterministically treated as confirmed fabrication', () => {
  const answer = 'No. Double insurance requires the same insured person, subject, interest, and risk. The same rule was supposedly announced in the explicitly test-only and nonexistent case of Santos v. Omega Assurance, G.R. No. TEST-ONLY-000. Here, the insured interests differ. Therefore, there is no double insurance.';
  const result = applyDeterministicScoreCap(assessment(4.5, {
    authorityStatus: 'minor_imprecision',
    scoreCeilingCode: 'none',
    errors: ['The answer includes an unverified or nonexistent test-case citation.'],
  }), answer, {
    question: 'Do the two policies constitute double insurance?',
    suggestedAnswer: 'No. Double insurance requires identity of the insured person, subject matter, interest, and risk. The insured interests differ.',
    legalBasis: 'Insurance Code, Section 95.',
    verified: true,
  });
  assert.equal(result.score, 2.5);
  assert.equal(result.authorityStatus, 'confirmed_fabricated');
  assert.equal(result.appliedScoreCeiling.code, 'confirmed_fabricated_authority');
});

test('an omitted outcome-determinative majority requirement triggers the 3.5 central-gap ceiling', () => {
  const answer = 'No. Congress, not the President acting alone, grants tax exemptions. The President issued the exemption by proclamation, so the proclamation is unconstitutional.';
  const result = applyDeterministicScoreCap(assessment(4.5, {
    errors: ['Failed to mention the requirement for a majority of all members of Congress for tax exemption laws.'],
  }), answer, {
    question: 'May the President grant tax exemptions through a proclamation supported only by a congressional resolution?',
    suggestedAnswer: 'No. A tax exemption law requires the concurrence of a majority of all members of Congress, and a presidential proclamation cannot substitute for that law.',
    legalBasis: '1987 Constitution, Article VI, Section 28(4).',
    verified: true,
  });
  assert.equal(result.score, 3.5);
  assert.equal(result.appliedScoreCeiling.code, 'major_central_gap');
});

test('a correct conclusion resting solely on a legally insufficient central rule is capped at 1.5', () => {
  const answer = 'Yes. A person with bad intent is criminally liable even when no property is taken. Harry wanted to steal money and opened the wallet, so bad intent alone makes him liable for an impossible crime.';
  const result = applyDeterministicScoreCap(assessment(3, {
    rationale: "The student correctly answers 'Yes' but provides an oversimplified legal basis ('bad intent alone') without addressing the controlling elements of an impossible crime.",
    errors: [
      "Relies on 'bad intent alone' as the legal basis instead of legal impossibility or Article 4(2) of the RPC.",
      'Omits the core doctrine of factual impossibility where accomplishment is inherently impossible.',
    ],
    rubricBreakdown: {
      responsiveness: 5,
      legalBasis: 2,
      application: 2.5,
      conclusion: 4,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), answer, {
    question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
    suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
    legalBasis: 'Revised Penal Code, Article 4(2).',
    verified: true,
  });
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling.code, 'materially_wrong_rule');
});

test('low component scores alone do not create a central-rule ceiling without an explicit substantive finding', () => {
  const answer = 'Yes. An impossible crime may arise where the intended offense cannot be accomplished. The wallet was empty, so no money could be taken.';
  const result = applyDeterministicScoreCap(assessment(2.5, {
    rationale: 'The answer identifies the doctrine but would benefit from a more complete statement of its elements.',
    errors: ['The rule is incomplete but not materially wrong.'],
    rubricBreakdown: {
      responsiveness: 4,
      legalBasis: 2.5,
      application: 2.5,
      conclusion: 3,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), answer, {
    question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
    suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
    legalBasis: 'Revised Penal Code, Article 4(2).',
    verified: true,
  });
  assert.equal(result.score, 2.5);
  assert.equal(result.appliedScoreCeiling, null);
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
