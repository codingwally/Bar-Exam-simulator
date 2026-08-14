import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXAMINATION_LIMITS,
  ExaminationValidationError,
  examinationDatabaseError,
  extractUploadedQuestions,
  normalizeExaminationAdmin,
  normalizeExaminationCommand,
  normalizeExaminationQuery,
  normalizeUploadRequest,
  normalizedScore,
  safeUploadFileName,
  sanitizeSubjectMatterCatalog,
  sanitizeSubjectMatterSelection,
  validateUploadSignature,
} from './examinations-core.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_KEY = 'exam_test_request_123456789';
const TAB_TOKEN = 'tab_token_that_is_long_enough_for_a_secure_hash';

function throwsCode(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof ExaminationValidationError && error.code === code
  ));
}

test('examination limits enforce twenty-question and 1.5 MB boundaries', () => {
  assert.equal(EXAMINATION_LIMITS.maximumExamQuestions, 20);
  assert.equal(EXAMINATION_LIMITS.maximumUploadBytes, 1_500_000);
});

test('query operations normalize catalog and private assignment tokens', () => {
  assert.deepEqual(normalizeExaminationQuery({
    operation: 'catalog',
    track: 'per_subject',
  }), {
    operation: 'catalog',
    track: 'per_subject',
  });
  const token = 'secure_assignment_token_with_more_than_32_chars';
  assert.equal(normalizeExaminationQuery({
    operation: 'assignment',
    assignmentToken: token,
  }).assignmentToken, token);

  assert.deepEqual(normalizeExaminationQuery({
    operation: 'subject_catalog',
  }), { operation: 'subject_catalog' });
  assert.deepEqual(normalizeExaminationQuery({
    operation: 'subject_next',
    subject: 'Criminal Law I',
    yearLevel: 1,
    term: 1,
    resetCycle: true,
  }), {
    operation: 'subject_next',
    subject: 'Criminal Law I',
    yearLevel: 1,
    term: 1,
    resetCycle: true,
  });
  assert.deepEqual(normalizeExaminationQuery({
    operation: 'subject_performance',
    subject: 'Criminal Law I',
    limit: 25,
  }), {
    operation: 'subject_performance',
    subject: 'Criminal Law I',
    limit: 25,
  });
});

test('Subject Matter complete review reveal requires only a valid attempt identifier', () => {
  assert.deepEqual(normalizeExaminationCommand({
    operation: 'subject_reveal_review',
    attemptId: ATTEMPT_ID,
    questionId: QUESTION_ID,
    versionId: VERSION_ID,
    unexpected: 'ignored',
  }), {
    operation: 'subject_reveal_review',
    attemptId: ATTEMPT_ID,
  });

  throwsCode(() => normalizeExaminationCommand({
    operation: 'subject_reveal_review',
  }), 'INVALID_IDENTIFIER');
  throwsCode(() => normalizeExaminationCommand({
    operation: 'subject_reveal_review',
    attemptId: 'not-an-attempt-uuid',
  }), 'INVALID_IDENTIFIER');
  throwsCode(() => normalizeExaminationQuery({
    operation: 'subject_review_material',
    attemptId: ATTEMPT_ID,
  }), 'UNSUPPORTED_OPERATION');
});

test('Subject Matter responses remove confidential inventory counts recursively', () => {
  const catalog = {
    items: [{
      subject: 'Criminal Law I',
      courseCode: 'CRIMLAW1',
      completedCount: 3,
      questionCount: 55,
      nested: { bankSize: 55, totalQuestions: 55 },
    }],
    placementCount: 99,
  };
  const sanitizedCatalog = sanitizeSubjectMatterCatalog(catalog);
  assert.equal(sanitizedCatalog.items[0].subject, 'Criminal Law I');
  assert.equal(sanitizedCatalog.items[0].progressState, 'Ready for another review');
  assert.equal('completedCount' in sanitizedCatalog.items[0], false);
  assert.equal('questionCount' in sanitizedCatalog.items[0], false);
  assert.deepEqual(sanitizedCatalog.items[0].nested, {});
  assert.equal('placementCount' in sanitizedCatalog, false);
  assert.equal(catalog.items[0].questionCount, 55, 'sanitizing must not mutate the RPC result');

  const selection = sanitizeSubjectMatterSelection({
    exhausted: false,
    completedCount: 3,
    remainingQuestions: 52,
    setup: { versionId: VERSION_ID, questionCount: 1, inventoryCount: 55 },
  });
  assert.deepEqual(selection, {
    exhausted: false,
    setup: { versionId: VERSION_ID },
  });
});

test('start attempt requires a version, timer, request key, and tab token', () => {
  const result = normalizeExaminationCommand({
    operation: 'start_attempt',
    versionId: VERSION_ID,
    timerMode: 'strict',
    requestKey: REQUEST_KEY,
    tabToken: TAB_TOKEN,
  });
  assert.equal(result.versionId, VERSION_ID);
  assert.equal(result.timerMode, 'strict');
  assert.equal(result.requestKey, REQUEST_KEY);
  throwsCode(() => normalizeExaminationCommand({
    operation: 'start_attempt',
    versionId: VERSION_ID,
    timerMode: 'strict',
    requestKey: REQUEST_KEY,
    tabToken: 'short',
  }), 'TAB_TOKEN_REQUIRED');
});

test('save response preserves ALAC text and clamps only at the documented maximum', () => {
  const answerText = 'I. ANSWER\nYes.\n\nII. LEGAL BASIS\nArticle X.\n\nIII. APPLICATION\nThe facts satisfy the rule.\n\nIV. CONCLUSION\nTherefore, yes.';
  const result = normalizeExaminationCommand({
    operation: 'save_response',
    attemptId: ATTEMPT_ID,
    questionId: QUESTION_ID,
    tabToken: TAB_TOKEN,
    answerText,
    expectedRevision: 2,
    flagged: true,
  });
  assert.equal(result.answerText, answerText);
  assert.equal(result.expectedRevision, 2);
  assert.equal(result.flagged, true);
});

test('manual submission requires explicit review confirmation', () => {
  throwsCode(() => normalizeExaminationCommand({
    operation: 'submit_attempt',
    attemptId: ATTEMPT_ID,
    tabToken: TAB_TOKEN,
    requestKey: REQUEST_KEY,
    confirmed: false,
  }), 'REVIEW_CONFIRMATION_REQUIRED');
  assert.equal(normalizeExaminationCommand({
    operation: 'submit_attempt',
    attemptId: ATTEMPT_ID,
    tabToken: TAB_TOKEN,
    requestKey: REQUEST_KEY,
    confirmed: true,
  }).confirmed, true);
});

test('human examiner assignment validates email and secure token', () => {
  const result = normalizeExaminationCommand({
    operation: 'create_examiner_assignment',
    attemptId: ATTEMPT_ID,
    examinerEmail: 'examiner@example.test',
    assignmentToken: 'assignment_token_that_is_longer_than_thirty_two_chars',
    requestKey: REQUEST_KEY,
  });
  assert.equal(result.examinerEmail, 'examiner@example.test');
  throwsCode(() => normalizeExaminationCommand({
    operation: 'create_examiner_assignment',
    attemptId: ATTEMPT_ID,
    examinerEmail: 'not-an-email',
    assignmentToken: 'assignment_token_that_is_longer_than_thirty_two_chars',
    requestKey: REQUEST_KEY,
  }), 'INVALID_EXAMINER_EMAIL');
});

test('human review accepts one-decimal 0.0 to 5.0 scores only', () => {
  for (const score of [0, 0.1, 3.8, 4.2, 5]) {
    assert.equal(normalizedScore(score), score);
  }
  assert.equal(normalizedScore(3.75), 3.8);
  for (const score of [-0.1, 5.1, Number.NaN]) {
    throwsCode(() => normalizedScore(score), 'INVALID_EXAMINER_SCORE');
  }
});

test('administrator create and publish commands require audited inputs', () => {
  const result = normalizeExaminationAdmin({
    operation: 'create_exam',
    track: 'per_subject',
    assessmentKind: 'system_test',
    title: 'Criminal Law I Controlled System Test',
    subject: 'Criminal Law I',
    yearLevel: 1,
    testOnly: true,
    reason: 'Controlled staging test.',
    requestKey: REQUEST_KEY,
  });
  assert.equal(result.testOnly, true);
  assert.equal(result.track, 'per_subject');
  throwsCode(() => normalizeExaminationAdmin({
    operation: 'publish_version',
    versionId: VERSION_ID,
    reason: 'x',
    requestKey: REQUEST_KEY,
  }), 'REASON_REQUIRED');
});

test('administrator question sets reject duplicates and more than twenty', () => {
  throwsCode(() => normalizeExaminationAdmin({
    operation: 'set_questions',
    versionId: VERSION_ID,
    questionIds: [QUESTION_ID, QUESTION_ID],
    reason: 'Duplicate negative test.',
    requestKey: REQUEST_KEY,
  }), 'DUPLICATE_QUESTION');
  throwsCode(() => normalizeExaminationAdmin({
    operation: 'set_questions',
    versionId: VERSION_ID,
    questionIds: Array.from({ length: 21 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    )),
    reason: 'Question maximum negative test.',
    requestKey: REQUEST_KEY,
  }), 'INVALID_QUESTION_SET');
});

test('safe upload filenames remove traversal and control characters', () => {
  assert.equal(safeUploadFileName('../../My Exam?.DOCX'), '..-..-My-Exam.docx');
  assert.equal(safeUploadFileName('  \u0000  '), 'uploaded-examination.txt');
});

test('plain-text upload validates MIME, signature, size, and request key', () => {
  const source = new TextEncoder().encode(
    '1. Explain whether the accused may invoke mistake of fact.\n\n2. Discuss the elements of self-defense.',
  );
  const result = normalizeUploadRequest({
    fileName: 'Controlled Test.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(source).toString('base64'),
    title: 'Controlled Uploaded Examination',
    timerMode: 'strict',
    durationSeconds: 600,
    gradingRoute: 'human',
    requestKey: REQUEST_KEY,
  });
  assert.equal(result.bytes.length, source.length);
  assert.equal(result.gradingRoute, 'human');
});

test('binary bytes are rejected when declared as plain text', () => {
  throwsCode(
    () => validateUploadSignature(Uint8Array.from([65, 0, 66]), 'text/plain'),
    'INVALID_TEXT_FILE',
  );
});

test('DOCX requires a ZIP signature before parsing', () => {
  throwsCode(
    () => validateUploadSignature(
      Uint8Array.from([0x41, 0x42, 0x43]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    'INVALID_DOCX_SIGNATURE',
  );
});

test('plain-text parser extracts numbered questions in order', async () => {
  const questions = await extractUploadedQuestions(
    new TextEncoder().encode(
      'Question 1. Explain the constitutional issue using the given facts.\n\nQuestion 2. Resolve the statutory construction issue and explain.',
    ),
    'text/plain',
  );
  assert.equal(questions.length, 2);
  assert.equal(questions[0].ordinal, 1);
  assert.match(questions[1].prompt, /statutory construction/i);
});

test('plain-text parser caps extracted questions at twenty', async () => {
  const source = Array.from(
    { length: 25 },
    (_, index) => `${index + 1}. Explain legal issue number ${index + 1} with complete legal basis and application.`,
  ).join('\n\n');
  const questions = await extractUploadedQuestions(new TextEncoder().encode(source), 'text/plain');
  assert.equal(questions.length, 20);
});

test('database errors map to safe examination errors without SQL details', () => {
  const error = examinationDatabaseError({
    message: 'duplicate key EXAM_SECOND_TAB_BLOCKED internal_schema.secret',
  });
  assert.equal(error.code, 'EXAM_SECOND_TAB_BLOCKED');
  assert.doesNotMatch(error.message, /internal_schema|duplicate key/i);
});

test('beta and administrator database denials map to HTTP 403', () => {
  for (const code of ['EXAM_BETA_ACCESS_REQUIRED', 'EXAM_ADMIN_REQUIRED']) {
    const result = examinationDatabaseError(new Error(`database detail: ${code}`));
    assert.equal(result.code, code);
    assert.equal(result.status, 403);
    assert.doesNotMatch(result.message, /database detail/i);
  }
});

test('unsupported database failures remain available to the Worker generic wrapper', () => {
  const original = { message: 'unexpected connection failure' };
  const error = examinationDatabaseError(original);
  assert.equal(error, original);
});

test('uploaded examination confirmation remains private and human/provisional only', () => {
  const result = normalizeExaminationCommand({
    operation: 'confirm_upload',
    uploadId: VERSION_ID,
    title: 'Private Uploaded Examination',
    timerMode: 'none',
    durationSeconds: 14_400,
    gradingRoute: 'provisional',
    requestKey: REQUEST_KEY,
  });
  assert.equal(result.gradingRoute, 'provisional');
  assert.equal(result.timerMode, 'none');
});

test('beta and participant access commands require UUID identities', () => {
  for (const operation of ['set_beta_access', 'set_participant']) {
    const value = {
      operation,
      userId: USER_ID,
      enabled: true,
      reason: 'Authorized controlled beta test.',
      requestKey: REQUEST_KEY,
    };
    if (operation === 'set_participant') value.versionId = VERSION_ID;
    assert.equal(normalizeExaminationAdmin(value).userId, USER_ID);
  }
});
