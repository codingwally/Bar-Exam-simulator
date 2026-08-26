import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  containsInternalEditorialBlock,
  sanitizeLearnerFacingPayload,
  stripInternalEditorialBlocks,
} from './internal-editorial-content.mjs';
import {
  assessmentPolicy,
  buildExaminerPrompt,
  normalizeRequest,
  questionFromBankRow,
} from './examiner-core.mjs';
import {
  buildSubjectMatterTeachingPrompt,
  fallbackSubjectMatterTeachingExplanation,
  publicSubjectMatterReviewPayload,
  sanitizeSubjectMatterRevealRecord,
  validateSubjectMatterTeachingExplanation,
} from './subject-matter-review.mjs';
import {
  parseSubjectMatterSource,
  subjectMatterReleaseSnapshotCsv,
} from './release-content-core.mjs';
import { SUBJECT_MATTER_RELEASE_VALUES } from './subject-matter-release-snapshot.mjs';

const headers = SUBJECT_MATTER_RELEASE_VALUES[0];
const clepValues = SUBJECT_MATTER_RELEASE_VALUES.find((row) => row[0] === 'CLEP-STG-013');
const clep = Object.fromEntries(headers.map((header, index) => [header, clepValues[index]]));
const exactRubric = 'Rubric (6 points): neutral tone; chronology; open questions; corroboration; preserved uncertainty; supervisor review.';

test('removes the exact CLEP-STG-013 internal rubric block', () => {
  assert.match(clep['Suggested Answer'], new RegExp(exactRubric.replace(/[()]/gu, '\\$&'), 'u'));
  assert.equal(containsInternalEditorialBlock(clep['Suggested Answer']), true);

  const cleaned = stripInternalEditorialBlocks(clep['Suggested Answer']);
  assert.match(cleaned, /MODEL WORK PRODUCT/u);
  assert.match(cleaned, /reasonable inquiry before an objective assessment\./u);
  assert.doesNotMatch(cleaned, /Rubric|neutral tone|corroboration|supervisor review\.$/iu);
  assert.equal(containsInternalEditorialBlock(cleaned), false);
});

test('removes inline and Performance rubric blocks while retaining later learner text', () => {
  const inline = stripInternalEditorialBlocks(
    'Application: The facts satisfy the rule. Suggested rubric: issue 30%; rule 30%; application 40%.\n\nConclusion: Relief should be granted.',
  );
  assert.equal(inline, 'Application: The facts satisfy the rule.\n\nConclusion: Relief should be granted.');

  const performance = stripInternalEditorialBlocks(
    'Reflection: The student identified one improvement.\n\nPerformance rubric (10 points): chronology—2; evidence—3; ethics—5.\n\nThis simulation does not authorize legal practice.',
  );
  assert.equal(
    performance,
    'Reflection: The student identified one improvement.\n\nThis simulation does not authorize legal practice.',
  );
});

test('scrubs alternate and nested system-authored fields without rewriting learner answers or prompts', () => {
  const studentAnswer = `The source itself says ${exactRubric} I challenge that wording.`;
  const questionText = `A document contains the words ${exactRubric} What follows?`;
  const payload = sanitizeLearnerFacingPayload({
    attemptId: 'attempt-Rubric (6 points): metadata-must-stay',
    metadata: { note: exactRubric },
    student_answer: studentAnswer,
    question_text: questionText,
    result: {
      suggested_answer: `Approved answer.\n\n${exactRubric}`,
      model_answer: `Model answer.\n\nPerformance rubric (10 points): hidden.`,
      legalReview: {
        controllingLawAndDoctrine: `The statute controls.\n\n${exactRubric}`,
      },
      assessment: {
        rationale: `The reasoning is sound.\n\n${exactRubric}`,
        modelAnswerALAC: {
          application: 'The facts satisfy the rule. Rubric (2 points): internal only.',
        },
        studentAnswer,
      },
    },
  });

  assert.equal(payload.attemptId, 'attempt-Rubric (6 points): metadata-must-stay');
  assert.equal(payload.metadata.note, '');
  assert.equal(payload.student_answer, studentAnswer);
  assert.equal(payload.question_text, questionText);
  assert.equal(payload.result.suggested_answer, 'Approved answer.');
  assert.equal(payload.result.model_answer, 'Model answer.');
  assert.equal(payload.result.legalReview.controllingLawAndDoctrine, 'The statute controls.');
  assert.equal(payload.result.assessment.rationale, 'The reasoning is sound.');
  assert.equal(payload.result.assessment.modelAnswerALAC.application, 'The facts satisfy the rule.');
  assert.equal(payload.result.assessment.studentAnswer, studentAnswer);
});

test('Subject Matter validation, prompt, fallback, and public output all exclude editorial rubrics', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const questionId = '22222222-2222-4222-8222-222222222222';
  const material = sanitizeSubjectMatterRevealRecord({
    status: 'available',
    attemptId,
    questionId,
    prompt: clep['Essay Question'],
    suggestedAnswer: clep['Suggested Answer'],
    legalBasis: clep['Legal Basis / Provision'],
    governingProvision: clep['Legal Basis / Provision'],
    doctrine: clep['Controlling Doctrine'],
    jurisprudence: [],
    citation: clep['Citation / G.R. No.'],
    sources: ['https://lawphil.net/courts/rules/rc_138-a_2020.html'],
    assisted: false,
    assistanceKnown: true,
    reviewMaterialRevealedAt: '2026-08-26T00:00:00.000Z',
  }, attemptId);

  assert.doesNotMatch(material.suggestedAnswer, /Rubric|neutral tone|corroboration/iu);
  const prompt = buildSubjectMatterTeachingPrompt({
    ...material,
    legalBasis: `${material.legalBasis}\n\n${exactRubric}`,
  });
  assert.doesNotMatch(prompt, /Rubric \(6 points\)|neutral tone; chronology|open questions; corroboration/iu);

  const fallback = fallbackSubjectMatterTeachingExplanation({
    ...material,
    suggestedAnswer: `${material.suggestedAnswer}\n\n${exactRubric}`,
  });
  assert.equal(containsInternalEditorialBlock(fallback), false);

  const explanation = validateSubjectMatterTeachingExplanation({
    directAnswer: 'The student must verify the chronology before giving advice.',
    controllingLawAndElements: 'Rule 138-A and the CPRA require competent supervised inquiry.',
    applicationToFacts: `The three competing dates require corroboration before advice.\n\n${exactRubric}`,
    materialExceptionsOrLimits: 'No additional material exception appears in the approved source.',
    finalConclusion: 'The uncertainty must remain documented for supervisor review.',
  }, material);
  const learnerPayload = publicSubjectMatterReviewPayload(material, explanation);
  assert.equal(containsInternalEditorialBlock(learnerPayload), false);
  assert.doesNotMatch(JSON.stringify(learnerPayload), /Rubric \(6 points\)|neutral tone/iu);
});

test('examiner context and prompt remove the source rubric but preserve the learner answer', () => {
  const context = questionFromBankRow(clep);
  assert.doesNotMatch(context.suggestedAnswer, /Rubric|neutral tone|corroboration/iu);

  const studentAnswer = `The phrase ${exactRubric} appears in the document.`;
  const normalized = normalizeRequest({
    questionId: 'CLEP-STG-013',
    studentAnswer,
    questionContext: {
      question: clep['Essay Question'],
      suggestedAnswer: clep['Suggested Answer'],
      legalBasis: `${clep['Legal Basis / Provision']}\n\n${exactRubric}`,
    },
  });
  assert.equal(normalized.studentAnswer, studentAnswer);
  assert.doesNotMatch(normalized.questionContext.suggestedAnswer, /neutral tone|corroboration/iu);
  assert.doesNotMatch(normalized.questionContext.legalBasis, /Rubric \(6 points\)|neutral tone/iu);

  const prompt = buildExaminerPrompt({
    questionId: 'CLEP-STG-013',
    studentAnswer: 'The work product should preserve uncertainty and seek corroboration.',
    context: {
      ...context,
      suggestedAnswer: clep['Suggested Answer'],
      legalBasis: `${context.legalBasis}\n\n${exactRubric}`,
    },
    policy: assessmentPolicy(context),
  });
  assert.doesNotMatch(prompt, /neutral tone; chronology; open questions/iu);
  assert.doesNotMatch(prompt, /Rubric \(6 points\)/iu);
});

test('versioned release ingestion strips editorial rubrics before rows can be staged', async () => {
  const source = await parseSubjectMatterSource(subjectMatterReleaseSnapshotCsv());
  const ingested = source.rows.find((row) => row.questionId === 'CLEP-STG-013');
  assert.ok(ingested);
  assert.doesNotMatch(ingested.suggestedAnswer, /Rubric|neutral tone|corroboration/iu);
  assert.doesNotMatch(JSON.stringify(ingested.alac), /Rubric|neutral tone|corroboration/iu);
});

test('learner response routes apply the nested scrubber before serialization', () => {
  const source = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(source, /query\.operation === 'subject_performance'[\s\S]*?data: sanitizeLearnerFacingPayload\(result\)/u);
  assert.match(source, /\['verdict', 'history'\]\.includes\(query\.operation\)[\s\S]*?sanitizeLearnerFacingPayload\(result\)/u);
  assert.match(source, /async function handleExamHistory[\s\S]*?history: sanitizeLearnerFacingPayload\(result\)/u);
});

test('a reveal record containing only an editorial rubric fails closed', () => {
  assert.throws(() => sanitizeSubjectMatterRevealRecord({
    status: 'available',
    attemptId: '11111111-1111-4111-8111-111111111111',
    questionId: '22222222-2222-4222-8222-222222222222',
    prompt: 'A sufficiently long learner-facing question remains available for review.',
    suggestedAnswer: exactRubric,
    legalBasis: 'A sufficiently complete approved legal basis remains available.',
    governingProvision: '',
    doctrine: '',
    jurisprudence: [],
    citation: '',
    sources: ['https://lawphil.net/courts/rules/rc_138-a_2020.html'],
    assisted: false,
    assistanceKnown: true,
    reviewMaterialRevealedAt: null,
  }, '11111111-1111-4111-8111-111111111111'), /not available/i);
});
