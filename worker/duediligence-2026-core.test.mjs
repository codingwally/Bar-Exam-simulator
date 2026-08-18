import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAR_EASY_RESPONSE_SCHEMA,
  DD2026_DEFAULT_FLAGS,
  DD2026ValidationError,
  DOCTRINE_RESPONSE_SCHEMA,
  barEasyPersistencePayload,
  buildBarEasyPrompt,
  buildDoctrinePrompt,
  doctrinePersistencePayload,
  formulaNeutralizedCell,
  normalizeBarEasyRequest,
  normalizeDoctrineRequest,
  publicContentItem,
  unicodeLength,
  validateBarEasyResult,
  validateDoctrineResult,
} from './duediligence-2026-core.mjs';
import {
  backupRowValues,
  normalizeExamRoomCommand,
  normalizeExamRoomQuery,
  normalizeQuestionUpload,
  normalizeRosterUpload,
  sanitizeIntegrityMetadata,
} from './exam-room-2026-core.mjs';

const requestKey = 'request_2026_abcdef123456';
const examId = '123e4567-e89b-42d3-a456-426614174000';

test('safe default feature flags preserve the human-review publication gate', () => {
  assert.equal(DD2026_DEFAULT_FLAGS.CONTENT_HUMAN_REVIEW_REQUIRED, false);
  assert.equal(DD2026_DEFAULT_FLAGS.AI_PREPARED_BETA_BADGE, false);
  assert.equal(DD2026_DEFAULT_FLAGS.EXAMINATION_ROOM_2_ENABLED, false);
});

function base64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('Unicode limits count code points without truncating input', () => {
  assert.equal(unicodeLength('A😀B'), 3);
  const answer = '😀'.repeat(5_000);
  assert.equal(normalizeBarEasyRequest({ contentId: 'BE-001', answer, requestKey }).answer, answer);
  assert.throws(
    () => normalizeBarEasyRequest({ contentId: 'BE-001', answer: `${answer}x`, requestKey }),
    (error) => error instanceof DD2026ValidationError
      && error.code === 'FIELD_TOO_LONG'
      && /Nothing was truncated/.test(error.message),
  );
  const doctrine = '⚖'.repeat(3_000);
  assert.equal(normalizeDoctrineRequest({ contentId: 'DOC-001', answer: doctrine, requestKey }).answer, doctrine);
});

test('study schemas and result validators accept only settled enums', () => {
  assert.deepEqual(BAR_EASY_RESPONSE_SCHEMA.properties.label.enum, [
    'Affirmed!', 'Affirmed with modification', 'Denied',
  ]);
  assert.deepEqual(DOCTRINE_RESPONSE_SCHEMA.properties.result.enum, ['thumbs_up', 'thumbs_down']);
  assert.equal(validateBarEasyResult({ label: 'Affirmed!', feedback: 'Good.' }).label, 'Affirmed!');
  assert.equal(validateDoctrineResult({ result: 'thumbs_down', feedback: 'Review the limit.' }).result, 'thumbs_down');
  assert.throws(() => validateBarEasyResult({ label: 'Passed', feedback: 'No.' }));
  assert.throws(() => validateDoctrineResult({ result: 'maybe', feedback: 'No.' }));
});

test('catalog redaction withholds study answers until submission', () => {
  const bar = publicContentItem({
    contentType: 'bar_easy',
    payload: {
      prompt: 'Question', suggested_answer: 'Secret answer', explanation: 'Secret rationale',
      required_concepts: ['secret'], source_url: 'https://example.test',
    },
  });
  assert.equal(bar.payload.prompt, 'Question');
  assert.equal(bar.payload.source_url, 'https://example.test');
  assert.equal('suggested_answer' in bar.payload, false);
  assert.equal('explanation' in bar.payload, false);
  assert.equal('required_concepts' in bar.payload, false);
});

test('prompts treat student text as data and persistence payloads omit it', () => {
  const canary = 'CANARY_DO_NOT_PERSIST_7f2c9d';
  const barContent = {
    payload: {
      prompt: 'Is dismissal valid?', suggested_answer: 'No.', explanation: 'Due process is required.',
      required_concepts: ['notice'], accepted_paraphrases: ['hearing'],
      modification_triggers: ['missing notice'], denial_triggers: ['opposite rule'],
      source_title: 'Labor Code', source_citation: 'Art. 292',
    },
  };
  const doctrineContent = {
    payload: {
      doctrine_title: 'Security of tenure', canonical_meaning: 'A worker may be dismissed only for lawful cause.',
      plain_language_meaning: 'There must be a lawful reason.', required_concepts: ['lawful cause'],
      accepted_paraphrases: [], material_contradictions: [], exceptions_or_limits: [],
      primary_authority: 'Constitution', citation: 'Art. XIII',
    },
  };
  assert.match(buildBarEasyPrompt(barContent, canary), /untrusted data/i);
  assert.match(buildDoctrinePrompt(doctrineContent, canary), /only legal source of truth/i);
  const normalizedBar = normalizeBarEasyRequest({ contentId: 'BE-001', answer: canary, requestKey });
  const normalizedDoctrine = normalizeDoctrineRequest({ contentId: 'DOC-001', answer: canary, requestKey });
  const barPayload = JSON.stringify(barEasyPersistencePayload(examId, 'BE-001', normalizedBar, 'test-model'));
  const doctrinePayload = JSON.stringify(doctrinePersistencePayload(
    examId, 'DOC-001', normalizedDoctrine, { result: 'thumbs_up' }, 'test-model',
  ));
  assert.equal(barPayload.includes(canary), false);
  assert.equal(doctrinePayload.includes(canary), false);
  assert.equal(barPayload.includes('feedback'), false);
  assert.equal(doctrinePayload.includes('feedback'), false);
});

test('question preview supports a professor-selected 35-question exam without a 20-item cap', async () => {
  const source = Array.from({ length: 35 }, (_, index) => (
    `Question ${index + 1}. Explain the legal consequence in scenario ${index + 1}.`
  )).join('\n');
  const preview = await normalizeQuestionUpload({
    examId,
    questionCount: 35,
    fileName: 'final-exam.txt',
    mimeType: 'text/plain',
    base64: base64(source),
  });
  assert.equal(preview.questions.length, 35);
  assert.equal(preview.questions[34].ordinal, 35);
  assert.deepEqual(preview.warnings, []);
  assert.match(preview.contentHash, /^[0-9a-f]{64}$/);
});

test('question preview reports count mismatches instead of silently truncating', async () => {
  const source = Array.from({ length: 8 }, (_, index) => `Question ${index + 1}. Prompt ${index + 1} is complete.`).join('\n');
  const preview = await normalizeQuestionUpload({
    examId,
    questionCount: 7,
    fileName: 'midterm.txt',
    mimeType: 'text/plain',
    base64: base64(source),
  });
  assert.equal(preview.questions.length, 8);
  assert.match(preview.warnings[0], /Detected 8 questions/);
});

test('CSV roster parsing validates required columns and maximum count', async () => {
  const csv = 'Email,Student Number,Candidate Number,Display Name\nana@example.edu,2026-001,C-001,Ana Cruz\n';
  const parsed = await normalizeRosterUpload({
    classroomId: examId,
    fileName: 'class.csv',
    mimeType: 'text/csv',
    base64: base64(csv),
  });
  assert.deepEqual(parsed.rows[0], {
    email: 'ana@example.edu', studentNumber: '2026-001', candidateNumber: 'C-001', displayName: 'Ana Cruz',
  });
  assert.match(parsed.sourceHash, /^[0-9a-f]{64}$/);
});

test('server validators enforce 20,000-character answers and 5,000-character comments', () => {
  const answer = 'a'.repeat(20_000);
  const normalized = normalizeExamRoomCommand({
    operation: 'save_answer', attemptId: examId, questionId: examId,
    answerText: answer, expectedRevision: 0,
  });
  assert.equal(normalized.answerText.length, 20_000);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'save_answer', attemptId: examId, questionId: examId,
    answerText: `${answer}x`, expectedRevision: 0,
  }), /Nothing was truncated/);

  const comment = 'c'.repeat(5_000);
  const normalizedGrade = normalizeExamRoomCommand({
    operation: 'save_grade', examId, attemptId: examId, questionId: examId,
    score: 5, comment, gradeState: 'draft', expectedRevision: 0,
    changeReason: 'Initial grading review',
  });
  assert.equal(normalizedGrade.comment.length, 5_000);
  assert.equal(normalizedGrade.gradingKey, null);
});

test('Examination Room presets and incident names match the database contract', () => {
  assert.equal(normalizeExamRoomCommand({
    operation: 'create_exam', classroomId: examId, title: 'Open-book midterm',
    instructions: '', questionCount: 7, integrityPreset: 'open_book',
    includeQuestionnaire: false,
  }).integrityPreset, 'open_book');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'create_exam', classroomId: examId, title: 'Legacy preset',
    instructions: '', questionCount: 7, integrityPreset: 'custom',
    includeQuestionnaire: false,
  }));
  for (const eventType of ['visibility_exit', 'focus_exit', 'context_menu_attempt']) {
    assert.equal(normalizeExamRoomCommand({
      operation: 'integrity_event', attemptId: examId, eventType, details: {},
    }).eventType, eventType);
  }
});

test('live monitoring requires an exam and professor grading key', () => {
  const normalized = normalizeExamRoomQuery({
    operation: 'live_status', examId, gradingKey: 'Professor-Grading-Key-Secret',
  });
  assert.equal(normalized.operation, 'live_status');
  assert.equal(normalized.examId, examId);
  assert.equal(normalized.gradingKey, 'Professor-Grading-Key-Secret');
});

test('integrity metadata rejects forbidden keys recursively', () => {
  assert.deepEqual(sanitizeIntegrityMetadata({ reason: 'fullscreen_exit', count: 1 }), {
    reason: 'fullscreen_exit', count: 1,
  });
  assert.throws(
    () => sanitizeIntegrityMetadata({ nested: [{ student_answer: 'secret' }] }),
    (error) => error.code === 'INTEGRITY_DETAILS_SENSITIVE',
  );
  assert.throws(
    () => sanitizeIntegrityMetadata({ nested: { studentAnswer: 'secret' } }),
    (error) => error.code === 'INTEGRITY_DETAILS_SENSITIVE',
  );
});

test('Google backup cells are neutralized against spreadsheet formulas', () => {
  assert.equal(formulaNeutralizedCell('=IMPORTXML("https://evil.test")'), "'=IMPORTXML(\"https://evil.test\")");
  const rows = backupRowValues({
    id: examId,
    sequence_number: 1,
    event_type: 'answer_saved',
    payload_hash: 'a'.repeat(64),
    created_at: '2026-08-04T00:00:00Z',
    payload: { note: '+SUM(1,1)' },
  });
  assert.equal(rows.some(([, value]) => value === "'+SUM(1,1)"), true);
});
