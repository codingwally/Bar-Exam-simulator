import assert from 'node:assert/strict';
import test from 'node:test';
import { createDD2026Handlers } from './duediligence-2026-routes.mjs';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const examId = '123e4567-e89b-42d3-a456-426614174001';
const attemptId = '123e4567-e89b-42d3-a456-426614174002';
const questionId = '123e4567-e89b-42d3-a456-426614174003';
const requestKey = 'request_2026_abcdef123456';
const examRoom2Env = Object.freeze({
  EXAMINATION_ROOM_ENABLED: 'true',
  EXAMINATION_ROOM_2_ENABLED: 'true',
});

function request(body) {
  return new Request('https://worker.test/dd2026', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' },
    body: JSON.stringify(body),
  });
}

function harness(overrides = {}) {
  const rpcCalls = [];
  const examCalls = [];
  const deps = {
    corsHeaders: () => ({ 'Access-Control-Allow-Origin': 'https://duediligence.ph' }),
    dd2026Rpc: async (_env, name, body) => {
      rpcCalls.push({ name, body });
      if (name === 'dd2026_content_list') return overrides.contentList || { items: [], total: 0 };
      if (name === 'dd2026_content_get') return overrides.contentItem || {};
      if (name === 'dd2026_verdict_result') return overrides.verdictResult;
      return { stored: true };
    },
    deleteExamRoomSource: async () => true,
    enforceAdminRateLimit: async () => {},
    enforceDD2026RateLimit: async () => {},
    examRoomRpc: async (_env, name, body) => {
      examCalls.push({ name, body });
      if (name === 'exam_room_portal_snapshot') return overrides.portal || { roles: { professor: true }, classes: [] };
      return overrides.examResult || { ok: true };
    },
    jsonResponse: (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    parseBoundedJson: async (req) => req.json(),
    processExamRoomQueues: async () => ({ backupProcessed: 0, emailProcessed: 0 }),
    requireAdministrator: async () => ({ id: userId }),
    requireAuthenticatedUser: async () => ({ id: userId }),
    reserveCommercialSubmission: async () => ({
      reservationId: '623e4567-e89b-42d3-a456-426614174099',
      access: { allowed: true, accessMode: 'free', remainingToday: 4 },
    }),
    releaseCommercialSubmission: async () => {},
    resolveVerdictQuestion: overrides.resolveVerdictQuestion || (async () => null),
    structuredGemini: overrides.structuredGemini || (async () => ({
      model: 'gemini-test', result: { label: 'Affirmed!', feedback: 'Good.' },
    })),
    uploadExamRoomSource: async () => true,
  };
  return { handlers: createDD2026Handlers(deps), rpcCalls, examCalls };
}

test('content query strips hidden Bar Easy rubric and answer fields', async () => {
  const { handlers } = harness({
    contentList: {
      total: 1,
      items: [{ id: 'BE-001', contentType: 'bar_easy', payload: {
        prompt: 'Question', suggested_answer: 'Hidden', explanation: 'Hidden',
        required_concepts: ['Hidden'], source_url: 'https://example.test',
      } }],
    },
  });
  const response = await handlers.contentQuery(request({ contentType: 'bar_easy' }), {}, '', '');
  const body = await response.json();
  assert.equal(body.items[0].payload.prompt, 'Question');
  assert.equal(body.items[0].payload.source_url, 'https://example.test');
  assert.equal('suggested_answer' in body.items[0].payload, false);
  assert.equal('required_concepts' in body.items[0].payload, false);
});

test('Bar Easy raw answer and model rationale never enter persistence payloads or response echoes', async () => {
  const canary = 'CANARY_BAR_EASY_9d2f1a';
  const contentItem = { id: 'BE-001', title: 'Notice', contentType: 'bar_easy', aiPreparedBeta: true, payload: {
    prompt: 'Was notice required?', suggested_answer: 'Yes.', explanation: 'Due process.',
    required_concepts: ['notice'], accepted_paraphrases: [], modification_triggers: [], denial_triggers: [],
    source_title: 'Labor Code', source_citation: 'Art. 292', source_url: 'https://elibrary.judiciary.gov.ph/test',
  } };
  const { handlers, rpcCalls } = harness({ contentItem });
  const response = await handlers.barEasyGrade(request({
    contentId: 'BE-001', answer: canary, requestKey,
  }), {}, '', '');
  const serialized = JSON.stringify(await response.json());
  const persistence = rpcCalls.find((call) => call.name === 'dd2026_record_bar_easy_completion_commercial');
  assert.equal(JSON.stringify(persistence).includes(canary), false);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes('Due process.'), true);
});

test('Doctrine persistence contains only mastery result and no answer or rationale', async () => {
  const canary = 'CANARY_DOCTRINE_0aa991';
  const contentItem = { id: 'DOC-001', title: 'Tenure', contentType: 'doctrine', payload: {
    doctrine_title: 'Security of tenure', canonical_meaning: 'Lawful cause is required.',
    plain_language_meaning: 'A lawful reason is needed.', required_concepts: ['lawful cause'],
    accepted_paraphrases: [], material_contradictions: [], exceptions_or_limits: ['probation'],
    primary_authority: 'Constitution', citation: 'Art. XIII', source_url: 'https://elibrary.judiciary.gov.ph/test',
  } };
  const { handlers, rpcCalls } = harness({
    contentItem,
    structuredGemini: async () => ({ model: 'gemini-test', result: { result: 'thumbs_up', feedback: 'Captured.' } }),
  });
  const response = await handlers.doctrineGrade(request({
    contentId: 'DOC-001', answer: canary, requestKey,
  }), {}, '', '');
  const body = await response.json();
  const persistence = rpcCalls.find((call) => call.name === 'dd2026_record_doctrine_mastery_commercial');
  assert.equal(JSON.stringify(persistence).includes(canary), false);
  assert.equal(JSON.stringify(persistence).includes('Captured.'), false);
  assert.match(body.privacy, /answer text is not saved/i);
});

test('question upload preserves all 35 questions and stores only in the owning professor namespace', async () => {
  const source = Array.from({ length: 35 }, (_, index) => `Question ${index + 1}. Apply the law to scenario ${index + 1}.`).join('\n');
  const uploaded = [];
  const h = harness({ portal: {
    roles: { professor: true },
    classes: [{ exams: [{ examId }] }],
  } });
  h.handlers = createDD2026Handlers({
    corsHeaders: () => ({}), dd2026Rpc: async () => ({}), deleteExamRoomSource: async () => true,
    enforceAdminRateLimit: async () => {}, enforceDD2026RateLimit: async () => {},
    examRoomRpc: async (_env, name) => name === 'exam_room_exam_access_v3'
      ? { canUploadQuestions: true, storagePrefix: examId }
      : {},
    jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
    parseBoundedJson: async (req) => req.json(), processExamRoomQueues: async () => {},
    requireAdministrator: async () => ({ id: userId }), requireAuthenticatedUser: async () => ({ id: userId }),
    resolveVerdictQuestion: async () => null,
    structuredGemini: async () => ({}),
    uploadExamRoomSource: async (_env, path, bytes) => uploaded.push({ path, size: bytes.length }),
  });
  const response = await h.handlers.questionUpload(request({
    examId, questionCount: 35, fileName: 'final.txt', mimeType: 'text/plain',
    base64: Buffer.from(source).toString('base64'),
  }), examRoom2Env, '', '');
  const body = await response.json();
  assert.equal(body.preview.questions.length, 35);
  assert.match(uploaded[0].path, new RegExp(`^${examId}/[0-9a-f]{64}/`));
});

test('scheduled exam credentials are irreversibly hashed before database RPC', async () => {
  const { handlers, examCalls } = harness();
  const studentKey = 'Student-Exam-Key-Secret';
  const gradingKey = 'Professor-Grading-Key-Secret';
  await handlers.examCommand(request({
    operation: 'schedule_exam', examId,
    opensAt: '2026-08-04T01:00:00Z', hardClosesAt: '2026-08-04T03:00:00Z',
    durationMinutes: 60, studentKey, gradingKey,
  }), {}, '', '', { waitUntil() {} });
  const call = examCalls.find((entry) => entry.name === 'exam_room_schedule_exam');
  const serialized = JSON.stringify(call.body);
  assert.equal(serialized.includes(studentKey), false);
  assert.equal(serialized.includes(gradingKey), false);
  assert.match(call.body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
});

test('live monitoring uses the owning-professor credential without exposing it', async () => {
  const { handlers, examCalls } = harness();
  const gradingKey = 'Professor-Live-Monitor-Key';
  await handlers.examQuery(request({
    operation: 'live_status', examId, gradingKey,
  }), {}, '', '');
  const call = examCalls.find((entry) => entry.name === 'exam_room_live_status');
  assert.ok(call);
  assert.equal(JSON.stringify(call.body).includes(gradingKey), false);
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_rate_key_hash, /^[0-9a-f]{64}$/);
});

test('answer save forwards exact text and explicit revision without truncation', async () => {
  const answer = 'A'.repeat(20_000);
  const { handlers, examCalls } = harness();
  await handlers.examCommand(request({
    operation: 'save_answer', attemptId, questionId, answerText: answer, expectedRevision: 3,
  }), {}, '', '', { waitUntil() {} });
  const call = examCalls.find((entry) => entry.name === 'exam_room_save_answer');
  assert.equal(call.body.p_answer_text, answer);
  assert.equal(call.body.p_expected_revision, 3);
});

test('Verdict PDF response is private, no-store, and server-derived', async () => {
  const { handlers } = harness({
    verdictResult: {
      subject: 'Labor Law', barYear: 2024, questionNumber: '18', question: 'Question?',
      suggestedAnswer: 'Suggested.', userAnswer: 'Student.', feedback: { coachingTips: ['Apply facts.'] },
      score: 4.2, gradedAt: '2026-08-04T00:00:00Z',
    },
  });
  const response = await handlers.verdictPdf(request({
    gradingResultId: userId, selectionKind: 'entire_result', selectedIds: [], requestKey,
  }), {}, 'https://duediligence.ph', 'https://duediligence.ph');
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Cache-Control'), /private/);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-');
});

test('Phase 4 Verdict export resolves question and suggested answer from the server bank', async () => {
  let resolvedQuestionId = null;
  const { handlers } = harness({
    verdictResult: {
      sourceType: 'phase4_exam_attempt', questionBankId: 'REM-2024-Q18',
      subject: 'Remedial Law', barYear: 2024, question: null, suggestedAnswer: null,
      userAnswer: 'Student answer.', feedback: { coachingTips: ['Apply facts.'] },
      score: 3.8, gradedAt: '2026-08-04T00:00:00Z',
    },
    resolveVerdictQuestion: async (id) => {
      resolvedQuestionId = id;
      return { question: 'Canonical server question?', suggestedAnswer: 'Canonical server answer.' };
    },
  });
  const response = await handlers.verdictPdf(request({
    gradingResultId: attemptId, selectionKind: 'entire_result', selectedIds: [], requestKey,
  }), {}, 'https://duediligence.ph', 'https://duediligence.ph');
  assert.equal(resolvedQuestionId, 'REM-2024-Q18');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
});
