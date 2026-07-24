import assert from 'node:assert/strict';
import {
  LABOR_QA_HEADERS,
  filterPublicQuestions,
  laborQuestionFacets,
  normalizeLaborRows,
  sheetValuesToRows,
  validateEvaluationResult,
} from '../supabase/functions/labor-practice/contracts.mjs';

function row(values) {
  return LABOR_QA_HEADERS.map((header) => values[header] ?? '');
}

function approvedRow(overrides = {}) {
  return {
    'Question ID': 'LAB-001',
    Subject: 'Labor Law',
    Topic: 'Termination of Employment',
    'Bar Year': '2024',
    'Question No.': '1',
    Subpart: 'A',
    'Essay Question': 'Fixture question only. It is not legal content.',
    'Suggested Answer': 'Fixture canonical answer only. It is not legal content.',
    'Key Legal Concepts': 'Fixture concept; Fixture principle',
    'Legal Basis / Provision': 'Fixture provision.',
    'Controlling Doctrine': 'Fixture doctrine.',
    'Jurisprudence / Case': 'Fixture case.',
    'Citation / G.R. No.': 'Fixture citation.',
    Issue: 'Fixture issue.',
    'Application / Reasoning': 'Fixture application.',
    Conclusion: 'Fixture conclusion.',
    'Source Attribution': 'Fixture official source.',
    'Source URL': 'https://example.test/official-source',
    Difficulty: 'Medium',
    'Editorial Status': 'Approved',
    'Publication Ready?': 'Yes',
    Version: '2026.07.1',
    'Last Updated': '2026-07-25',
    'Assigned Reviewer': 'Fixture reviewer',
    Notes: '',
    ...overrides,
  };
}

function evaluation(overrides = {}) {
  return {
    questionId: 'LAB-001',
    databaseVersion: '2026.07.1',
    experimentalScore: 84,
    scoreLabel: 'Strong Match',
    issueRecognition: { score: 18, maxScore: 20, explanation: 'Fixture issue match.' },
    governingRule: { score: 25, maxScore: 30, explanation: 'Fixture governing-rule match.' },
    factualApplication: { score: 24, maxScore: 30, explanation: 'Fixture factual application.' },
    conclusion: { score: 17, maxScore: 20, explanation: 'Fixture conclusion.' },
    conceptsMatched: ['Fixture concept'],
    conceptsMissing: ['Fixture missing concept'],
    materialContradictions: [],
    conciseFeedback: 'Fixture educational feedback.',
    grammarReview: {
      correctedAnswerAmericanEnglish: 'Fixture corrected answer.',
      corrections: [],
      clarityNotes: [],
      affectedScore: false,
    },
    requiresHumanReview: false,
    ...overrides,
  };
}

const rows = sheetValuesToRows([
  LABOR_QA_HEADERS,
  row(approvedRow()),
  row(approvedRow({
    'Question ID': 'LAB-002',
    'Bar Year': '2025',
    'Question No.': '2',
    Subpart: 'B',
    Topic: 'Collective Bargaining',
    Difficulty: 'Hard',
    'Editorial Status': 'For Review',
    'Publication Ready?': 'No',
    Version: '2026.07.2',
  })),
  row(approvedRow({
    'Question ID': 'LAB-003',
    'Suggested Answer': '',
  })),
  row(approvedRow({
    'Question ID': 'LAB-001',
    'Question No.': '99',
  })),
]);

const released = normalizeLaborRows(rows);
assert.equal(released.questions.length, 1, 'Only publication-ready approved content may reach production learners.');
assert.equal(released.rejected.length, 2, 'Invalid and duplicate rows must be isolated without disabling valid records.');
assert.equal(released.questions[0].suggestedAnswer, approvedRow()['Suggested Answer'], 'Question IDs must retain their matching suggested answer.');
assert.deepEqual(released.questions[0].keyLegalConcepts, ['Fixture concept', 'Fixture principle']);

const preview = normalizeLaborRows(rows, { previewEnabled: true });
assert.equal(preview.questions.length, 2, 'Preview mode may include For Review records but never invalid records.');
assert.equal(preview.questions[1].preview, true, 'Preview records must be visibly marked.');

const publicQuestion = filterPublicQuestions(released.questions, { barYear: '2024', topic: 'Termination of Employment' })[0];
assert.equal(publicQuestion.questionId, 'LAB-001');
assert.equal('suggestedAnswer' in publicQuestion, false, 'Answer keys must not be exposed by the listing endpoint.');
assert.equal('legalBasis' in publicQuestion, false, 'Legal-basis records must not be exposed by the listing endpoint.');
assert.equal(publicQuestion.subpart, 'A', 'Student navigation receives the Sheet subpart metadata.');
assert.deepEqual(laborQuestionFacets(preview.questions).barYears, [2024, 2025]);

const aliasedRows = sheetValuesToRows([
  ['ID', 'Bar Subject', 'Exam Year', 'Item No.', 'Part', 'Full Question', 'Answer Key', 'Status', 'Publication Status', 'Last Reviewed'],
  ['LAB-010', 'Labor Law and Social Legislation', '2019', '10', 'C', 'Aliased fixture question.', 'Aliased fixture answer.', 'Published', 'Published', '2026-07-25'],
]);
const aliased = normalizeLaborRows(aliasedRows);
assert.equal(aliased.questions.length, 1, 'Common Sheet header variants must be normalized rather than discarded.');
assert.equal(aliased.questions[0].databaseVersion, '2026-07-25', 'Last-updated data supplies a deterministic version when no Version column exists.');
assert.equal(aliased.questions[0].questionNumber, '10');
assert.equal(aliased.questions[0].subpart, 'C');

const sortRows = normalizeLaborRows(sheetValuesToRows([
  LABOR_QA_HEADERS,
  row(approvedRow({ 'Question ID': 'LAB-020', 'Bar Year': '2025', 'Question No.': '2', Subpart: 'B' })),
  row(approvedRow({ 'Question ID': 'LAB-021', 'Bar Year': '2019', 'Question No.': '10', Subpart: 'A' })),
  row(approvedRow({ 'Question ID': 'LAB-022', 'Bar Year': '2025', 'Question No.': '2', Subpart: 'A' })),
])).questions;
assert.deepEqual(sortRows.map((question) => question.questionId), ['LAB-021', 'LAB-022', 'LAB-020'], 'Rows sort by year, question number, then subpart.');

const validated = validateEvaluationResult(evaluation(), { questionId: 'LAB-001', databaseVersion: '2026.07.1' });
assert.equal(validated.experimentalScore, 84, 'The total must be an explicit numeric sum of four components.');
assert.equal(validated.scoreLabel, 'Substantial Match', 'The server must recalculate score labels rather than trusting a model label.');
assert.equal(validated.grammarReview.affectedScore, false, 'Writing review must not affect legal scoring.');

assert.throws(
  () => validateEvaluationResult(evaluation({ experimentalScore: 83 }), { questionId: 'LAB-001', databaseVersion: '2026.07.1' }),
  /does not equal/,
  'A mismatched total must never be saved.',
);
assert.throws(
  () => validateEvaluationResult(evaluation({ databaseVersion: 'wrong-version' }), { questionId: 'LAB-001', databaseVersion: '2026.07.1' }),
  /does not match/,
  'A result cannot be attached to a different canonical version.',
);
assert.throws(
  () => validateEvaluationResult(evaluation({ grammarReview: { ...evaluation().grammarReview, affectedScore: true } }), { questionId: 'LAB-001', databaseVersion: '2026.07.1' }),
  /did not affect/,
  'Grammar feedback must explicitly declare a zero scoring effect.',
);

const clamped = validateEvaluationResult(evaluation({
  experimentalScore: 100,
  issueRecognition: { score: 99, maxScore: 20, explanation: 'Fixture clamp.' },
  governingRule: { score: 99, maxScore: 30, explanation: 'Fixture clamp.' },
  factualApplication: { score: 99, maxScore: 30, explanation: 'Fixture clamp.' },
  conclusion: { score: 99, maxScore: 20, explanation: 'Fixture clamp.' },
}), { questionId: 'LAB-001', databaseVersion: '2026.07.1' });
assert.equal(clamped.experimentalScore, 100, 'Component values are clamped before the explicit sum is accepted.');

console.log('Labor practice contracts passed.');
