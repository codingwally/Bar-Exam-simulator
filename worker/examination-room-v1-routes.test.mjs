import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
  buildPublicationVersion,
  buildSubmissionManifest,
  createRoomKey,
  normalizeAnswerRevision,
  normalizeRoomKey,
} from './examination-room-v1-core.mjs';
import {
  EXAMINATION_ROOM_V1_PATHS,
  ExaminationRoomV1RouteError,
  createExaminationRoomV1Handlers,
  professorDraftFromClientExam,
} from './examination-room-v1-routes.mjs';
import { ExaminationRoomMediaError } from './examination-room-media.mjs';

const IDS = Object.freeze({
  institution: '11111111-1111-4111-8111-111111111111',
  otherInstitution: '77777777-7777-4777-8777-777777777777',
  professor: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  exam: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  submission: '66666666-6666-4666-8666-666666666666',
  artifact: '88888888-8888-4888-8888-888888888888',
});

const ENV = Object.freeze({ EXAMINATION_ROOM_KEY_PEPPER: 'test-only-examination-room-pepper-32-bytes-minimum' });
const ORIGIN = 'https://duediligence.ph';
const REQUEST_KEY = '12345678-1234-4234-8234-1234567890ab';
const SESSION_TOKEN = `ers1_${'ab'.repeat(32)}`;
const ROOM_KEY = createRoomKey('ABCDEFGH');
const COMMUNITY_INSTITUTION_ID = 'ddc00000-0000-4000-8000-000000000001';

function clientExam(overrides = {}) {
  return {
    id: IDS.exam,
    title: 'Constitutional Law Midterm',
    subject: 'Constitutional Law',
    yearLevel: 'Second year',
    instructions: 'Answer completely using applicable Philippine law.',
    durationMinutes: 120,
    startsAt: '2026-08-26T02:00:00.000Z',
    gradingIdentity: 'real_names',
    integrityTier: 'standard',
    cameraRequired: false,
    microphoneRequired: false,
    privacyNoticeVersion: 'exam-room-v1',
    questions: [{
      id: 'q-1',
      type: 'essay',
      prompt: 'Explain the separation of powers and apply it to the stated facts.',
      points: 20,
      wordLimit: 800,
    }],
    roster: [{
      id: 'student-1',
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      email: 'maria@example.edu.ph',
      yearLevel: 'Second year',
      extraMinutes: 0,
    }],
    ...overrides,
  };
}

function publicationFixture(integrityTier = 'standard') {
  return buildPublicationVersion({
    examinationId: IDS.exam,
    version: 1,
    publishedAt: '2026-08-26T01:00:00.000Z',
    draft: {
      title: 'Constitutional Law Midterm',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      instructions: 'Answer completely.',
      identityMode: 'real_names',
      integrityTier,
      privacyNoticeVersion: 'exam-room-v1',
      questions: [{ type: 'essay', prompt: 'Explain separation of powers.', points: 20, wordLimit: 800 }],
    },
  }).manifest;
}

function identityFixture() {
  return {
    realName: 'Maria Theresa Dela Cruz',
    studentNumber: '2024-10001',
    subject: 'Constitutional Law',
    yearLevel: 'Second year',
  };
}

function mediaFixture(overrides = {}) {
  return {
    artifactId: IDS.artifact,
    artifactKind: 'camera_chunk',
    sourceMimeType: 'video/webm;codecs=vp8,opus',
    encryptedSizeBytes: 1_048_640,
    objectSha256: 'c'.repeat(64),
    capturedFrom: '2026-08-26T02:10:00.000Z',
    capturedTo: '2026-08-26T02:14:00.000Z',
    derivedKey: Buffer.alloc(32, 9).toString('base64'),
    ...overrides,
  };
}

function previewFixture(integrityTier = 'standard') {
  return {
    metadata: {
      examId: IDS.exam,
      examVersion: 'published-v1',
      title: 'Constitutional Law Midterm',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      durationMinutes: 120,
      startsAt: '2026-08-26T02:00:00.000Z',
      professor: 'Prof. Elena Villanueva',
      questionCount: 1,
      integrityTier,
      cameraRequired: integrityTier === 'recorded_proctoring',
      microphoneRequired: integrityTier === 'recorded_proctoring',
      privacyNoticeVersion: 'exam-room-v1',
      privacyController: 'The participating law school',
      retentionSummary: 'Records follow the school policy.',
      activationStatus: 'open',
      safeguards: ['Fullscreen is requested', 'Focus changes are recorded for review'],
      questions: [{ prompt: 'must never escape preview' }],
    },
    identity: {
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      yearLevel: 'Second year',
    },
    notice: {
      version: 'exam-room-v1',
      title: 'Examination privacy notice',
      body: 'The school processes identity, answers, and integrity signals for examination administration.',
      purposes: ['identity verification', 'examination administration'],
    },
  };
}

function answerRevisionFixture(publication = publicationFixture()) {
  return normalizeAnswerRevision({
    attemptId: IDS.session,
    questionNumber: 1,
    revision: 1,
    idempotencyKey: 'answer-revision-000000000001',
    answer: 'The doctrine allocates powers among the branches and preserves checks and balances.',
  }, { versionManifest: publication, publicationHash: 'a'.repeat(64) });
}

function submissionFixture(publication = publicationFixture()) {
  return buildSubmissionManifest({
    submissionId: IDS.submission,
    attemptId: IDS.session,
    idempotencyKey: 'submission-request-0000000001',
    submittedAt: '2026-08-26T03:00:00.000Z',
    versionManifest: publication,
    publicationHash: 'a'.repeat(64),
    studentIdentity: identityFixture(),
    privacyConsent: {
      noticeVersion: 'exam-room-v1',
      accepted: true,
      acceptedAt: '2026-08-26T01:55:00.000Z',
      recordingAccepted: false,
    },
    answerRevisions: [answerRevisionFixture(publication)],
  }).manifest;
}

function makeRequest(path, body, actor = 'professor') {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'X-Request-ID': REQUEST_KEY,
      ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function dependencyFixture(options = {}) {
  const calls = [];
  const managementCalls = [];
  const professorAccessCalls = [];
  const deliveries = [];
  const lifecycleQueryCalls = [];
  const lifecycleCommandCalls = [];
  const lifecycleGuardCalls = [];
  let uuidCounter = 0;
  const rpc = options.rpc || (async (_env, parameters) => ({ ok: true, parameters }));
  const dependencies = {
    parseJson: async (request, maximumBytes) => {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
        throw new ExaminationRoomV1RouteError('REQUEST_TOO_LARGE', 'The request is too large.', 413, 'Reduce the request and try again.');
      }
      return JSON.parse(raw);
    },
    respond: (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    authenticate: async (request) => {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/u, '');
      if (token === 'professor') return { id: IDS.professor, email: 'professor@example.edu.ph' };
      if (token === 'admin') return { id: IDS.admin, email: 'admin@example.edu.ph' };
      return null;
    },
    authorizeProfessor: options.authorizeProfessor || (async (_env, user) => ({
      authorized: true,
      creatorAuthorized: true,
      professorRoleSelected: user.id === IDS.professor,
      institutionId: IDS.institution,
      creatorWorkspaces: [{ institutionId: IDS.institution, active: true }],
      memberships: user.id === IDS.professor
        ? [{ institutionId: IDS.institution, staffRole: 'professor', active: true }]
        : [{ institutionId: IDS.institution, staffRole: 'admin', active: true }],
    })),
    authorizeAdmin: options.authorizeAdmin || (async (_env, user) => user.id === IDS.admin
      ? { authorized: true, role: 'founder_admin', capabilities: ['role_admin'], institutionId: IDS.institution, memberships: [{ institutionId: IDS.institution, staffRole: 'admin', active: true }] }
      : { authorized: false }),
    rateLimit: options.rateLimit || (async () => undefined),
    rpc: async (env, parameters) => {
      calls.push(structuredClone(parameters));
      return rpc(env, parameters);
    },
    manageStaff: async (env, parameters) => {
      managementCalls.push(structuredClone(parameters));
      return options.manageStaff ? options.manageStaff(env, parameters) : { ok: true, parameters };
    },
    professorAccess: async (env, parameters) => {
      professorAccessCalls.push(structuredClone(parameters));
      return options.professorAccess
        ? options.professorAccess(env, parameters)
        : { ok: true, professorRoleSelected: true, declarationOnFile: true, request: null };
    },
    hmacHex: async (key, value) => createHmac('sha256', key).update(value).digest('hex'),
    sha256Hex: async (value) => createHash('sha256').update(value).digest('hex'),
    randomBytes: options.randomBytes || ((length) => Uint8Array.from({ length }, (_, index) => (index * 13 + 7) % 224)),
    randomUUID: () => {
      uuidCounter += 1;
      return `77777777-7777-4777-8777-${String(uuidCounter).padStart(12, '0')}`;
    },
    now: () => '2026-08-26T04:00:00.000Z',
    sendRoomKeyEmail: async (_env, message) => {
      deliveries.push(structuredClone(message));
      return { status: 'sent' };
    },
    ...(typeof options.afterStudentCommand === 'function'
      ? { afterStudentCommand: options.afterStudentCommand }
      : {}),
    ...(typeof options.afterProfessorCommand === 'function'
      ? { afterProfessorCommand: options.afterProfessorCommand }
      : {}),
    ...(typeof options.examinationRoomAssistant === 'function'
      ? { examinationRoomAssistant: options.examinationRoomAssistant }
      : {}),
    ...(typeof options.examinationRoomMedia === 'function'
      ? { examinationRoomMedia: options.examinationRoomMedia }
      : {}),
    ...(typeof options.examLifecycleQuery === 'function'
      ? {
          examLifecycleQuery: async (env, parameters) => {
            lifecycleQueryCalls.push(structuredClone(parameters));
            return options.examLifecycleQuery(env, parameters);
          },
        }
      : {}),
    ...(typeof options.examLifecycleCommand === 'function'
      ? {
          examLifecycleCommand: async (env, parameters) => {
            lifecycleCommandCalls.push(structuredClone(parameters));
            return options.examLifecycleCommand(env, parameters);
          },
        }
      : {}),
    ...(typeof options.examLifecycleGuard === 'function'
      ? {
          examLifecycleGuard: async (env, examId) => {
            lifecycleGuardCalls.push(examId);
            return options.examLifecycleGuard(env, examId);
          },
        }
      : {}),
  };
  return {
    handlers: createExaminationRoomV1Handlers(dependencies),
    calls,
    managementCalls,
    professorAccessCalls,
    deliveries,
    lifecycleQueryCalls,
    lifecycleCommandCalls,
    lifecycleGuardCalls,
  };
}

async function json(response) {
  return response.json();
}

test('client professor draft normalizes familiar underscore question types and assigns numbering', () => {
  const draft = professorDraftFromClientExam(clientExam({
    questions: [{
      type: 'multiple_choice',
      prompt: 'Which court promulgates procedural rules?',
      points: 5,
      options: ['Supreme Court', 'Court of Appeals'],
      correctOption: 0,
    }],
  }));
  assert.equal(draft.identityMode, 'real_names');
  assert.equal(draft.questions[0].type, 'multiple-choice');
  assert.equal(draft.questions[0].number, 1);
  assert.equal(draft.questions[0].key, 'q001');
});

test('professor query requires verified sign-in', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }, null),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 401);
  assert.equal((await json(response)).error.code, 'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED');
  assert.equal(calls.length, 0);
});

test('any signed-in creator can hold a contextual assistant conversation without a Professor role or exam mutation', async () => {
  const assistantCalls = [];
  const rateLimitScopes = [];
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: false,
      creatorAuthorized: false,
      professorRoleSelected: false,
      institutionId: null,
      creatorWorkspaces: [],
      memberships: [],
    }),
    rateLimit: async (_request, _env, scope) => {
      rateLimitScopes.push(scope);
    },
    examinationRoomAssistant: async (_env, input, serverContext) => {
      assistantCalls.push({ input, serverContext });
      return {
        reply: `Your earlier concern about timing applies to ${input.examContext.title}. Keep the instructions explicit.`,
        suggestedActionIds: ['focus_instructions', 'open_review'],
      };
    },
  });
  const response = await handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Can you connect this to what I asked before?',
      history: [
        { role: 'user', content: 'I need a two-hour Constitutional Law exam.' },
        { role: 'assistant', content: 'I can review its instructions and settings.' },
      ],
      examContext: {
        examId: IDS.exam,
        status: 'draft',
        title: 'Constitutional Law Midterm',
        subject: 'Constitutional Law',
        durationMinutes: 120,
        questionCount: 1,
        questions: [{ number: 1, type: 'essay', prompt: 'Apply separation of powers.', points: 20 }],
        currentSection: 'instructions',
      },
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(EXAMINATION_ROOM_V1_PATHS['/examination-room/v1/professor/assistant'], 'professorAssistant');
  assert.equal(body.ok, true);
  assert.match(body.assistant.reply, /earlier concern about timing/u);
  assert.deepEqual(body.assistant.suggestedActionIds, ['focus_instructions', 'open_review']);
  assert.deepEqual(rateLimitScopes, ['professor_assistant']);
  assert.equal(assistantCalls.length, 1);
  assert.equal(assistantCalls[0].input.history.length, 2);
  assert.equal(assistantCalls[0].input.examContext.durationMinutes, 120);
  assert.equal(assistantCalls[0].serverContext.actorUserId, IDS.professor);
  assert.equal(calls.length, 0, 'assistant guidance must never mutate or query the examination store');
});

test('assistant rate limiting stops authentication and generation with recoverable guidance', async () => {
  let assistantCalls = 0;
  const { handlers, calls } = dependencyFixture({
    rateLimit: async () => {
      throw new ExaminationRoomV1RouteError(
        'EXAM_ROOM_V1_RATE_LIMITED',
        'Too many assistant messages.',
        429,
        'Wait a few minutes, then send the message once. Your examination remains unchanged.',
      );
    },
    examinationRoomAssistant: async () => {
      assistantCalls += 1;
      return { reply: 'Must not run.', suggestedActionIds: [] };
    },
  });
  const response = await handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Help with my exam.', history: [], examContext: {},
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const body = await json(response);
  assert.equal(response.status, 429);
  assert.equal(body.error.code, 'EXAM_ROOM_V1_RATE_LIMITED');
  assert.match(body.error.recovery, /remains unchanged/u);
  assert.equal(assistantCalls, 0);
  assert.equal(calls.length, 0);
});

test('assistant requires only sign-in and does not invoke generation for anonymous requests', async () => {
  let assistantCalls = 0;
  const { handlers, calls } = dependencyFixture({
    examinationRoomAssistant: async () => {
      assistantCalls += 1;
      return { reply: 'Must not run.', suggestedActionIds: [] };
    },
  });
  const response = await handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Help with my exam.', history: [], examContext: {},
    }, null),
    ENV, ORIGIN, ORIGIN,
  );
  const body = await json(response);
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED');
  assert.match(body.error.recovery, /Sign in through Due Diligence/u);
  assert.equal(assistantCalls, 0);
  assert.equal(calls.length, 0);
});

test('assistant validates request and response boundaries without leaking provider failures', async () => {
  let assistantCalls = 0;
  const fixture = dependencyFixture({
    examinationRoomAssistant: async () => {
      assistantCalls += 1;
      throw Object.assign(new Error('gemini-canary raw provider failure with secret=topsecret123'), {
        model: 'model-canary',
        provider: 'provider-canary',
      });
    },
  });
  const invalidRequest = await fixture.handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Help with my exam.', history: [], examContext: {}, provider: 'client-provider-canary',
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const invalidBody = await json(invalidRequest);
  assert.equal(invalidRequest.status, 400);
  assert.equal(invalidBody.error.code, 'EXAM_ROOM_V1_ASSISTANT_REQUEST_INVALID');
  assert.equal(assistantCalls, 0);

  const failedResponse = await fixture.handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Help with my exam.', history: [], examContext: {},
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const failedBody = await json(failedResponse);
  assert.equal(failedResponse.status, 503);
  assert.equal(failedBody.error.code, 'EXAM_ROOM_V1_ASSISTANT_UNAVAILABLE');
  assert.match(failedBody.error.recovery, /examination remains unchanged/iu);
  assert.doesNotMatch(JSON.stringify(failedBody), /gemini|provider-canary|model-canary|topsecret123/iu);
  assert.equal(assistantCalls, 1);
});

test('assistant rejects unsafe generated actions and reports missing configuration without blocking editing', async () => {
  const unsafe = dependencyFixture({
    examinationRoomAssistant: async () => ({
      reply: 'I published the exam for you.',
      suggestedActionIds: ['publish_exam'],
    }),
  });
  const unsafeResponse = await unsafe.handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Publish it.', history: [], examContext: {},
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const unsafeBody = await json(unsafeResponse);
  assert.equal(unsafeResponse.status, 503);
  assert.equal(unsafeBody.error.code, 'EXAM_ROOM_V1_ASSISTANT_RESPONSE_INVALID');
  assert.match(unsafeBody.error.recovery, /remains unchanged/iu);

  const missing = dependencyFixture();
  const missingResponse = await missing.handlers.professorAssistant(
    makeRequest('/examination-room/v1/professor/assistant', {
      message: 'Review my instructions.', history: [], examContext: {},
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const missingBody = await json(missingResponse);
  assert.equal(missingResponse.status, 503);
  assert.equal(missingBody.error.code, 'EXAM_ROOM_V1_ASSISTANT_UNAVAILABLE');
  assert.match(missingBody.error.recovery, /Continue editing manually/u);
});

test('signed-in Professor profile can read role status and request protected school activation', async () => {
  const { handlers, professorAccessCalls } = dependencyFixture({
    professorAccess: async (_env, parameters) => parameters.operation === 'status'
      ? { ok: true, professorRoleSelected: true, declarationOnFile: true, request: null }
      : { ok: true, request: { id: '88888888-8888-4888-8888-888888888888', status: 'pending' } },
  });
  const statusResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'role_status', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(statusResponse.status, 200);
  assert.equal((await json(statusResponse)).professorRoleSelected, true);

  const requestResponse = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', { operation: 'request_access', payload: { institutionId: IDS.institution } }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(requestResponse.status, 201);
  assert.deepEqual(professorAccessCalls.map((call) => call.operation), ['status', 'request']);
  assert.equal(professorAccessCalls[1].actorUserId, IDS.professor);
  assert.equal(professorAccessCalls[1].payload.institutionId, IDS.institution);
});

test('any signed-in creator in an active workspace can open Professor data without selecting the Professor profile role', async () => {
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: true,
      creatorAuthorized: true,
      professorRoleSelected: false,
      institutionId: IDS.institution,
      creatorWorkspaces: [{ institutionId: IDS.institution, active: true }],
      memberships: [],
    }),
    authorizeAdmin: async () => ({ authorized: false }),
  });
  const response = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal((await json(response)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorUserId, IDS.professor);
  assert.equal(calls[0].institutionId, IDS.institution);
});

test('creator session annotates recoverable archived drafts so the switcher can hide them', async () => {
  const fixture = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'session'
      ? { ok: true, exams: [{ examId: IDS.exam, status: 'draft', title: 'Archived draft' }] }
      : { ok: true },
    examLifecycleQuery: async () => ({
      ok: true,
      items: [{
        examId: IDS.exam,
        deleted: true,
        deletedAt: '2026-08-26T04:00:00.000Z',
        deleteReason: 'Creator deleted an unpublished draft.',
        canRestore: false,
        needsNewKey: false,
      }],
    }),
  });
  const response = await fixture.handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.exams[0].lifecycleState, 'archived');
  assert.equal(body.exams[0].deletedAt, '2026-08-26T04:00:00.000Z');
  assert.equal(fixture.lifecycleQueryCalls.length, 1);
  assert.equal(fixture.lifecycleQueryCalls[0].actorUserId, IDS.professor);
});

test('any signed-in creator can archive a published exam or remove an unpublished draft without a role gate', async () => {
  const fixture = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: false,
      creatorAuthorized: false,
      professorRoleSelected: false,
      creatorWorkspaces: [],
      memberships: [],
    }),
    examLifecycleCommand: async (_env, parameters) => ({
      ok: true,
      examId: parameters.examId,
      recoverable: true,
      ...(parameters.operation === 'archive_exam' ? { archived: true } : { deleted: true }),
    }),
  });
  for (const operation of ['archive_exam', 'delete_draft']) {
    const response = await fixture.handlers.professorCommand(
      makeRequest('/examination-room/v1/professor/command', {
        operation,
        idempotencyKey: `${operation}:1234567890abcdef`,
        payload: { examId: IDS.exam },
      }),
      ENV, ORIGIN, ORIGIN,
    );
    assert.equal(response.status, 200);
    assert.equal((await json(response)).recoverable, true);
  }
  assert.deepEqual(fixture.lifecycleCommandCalls.map((call) => call.operation), ['archive_exam', 'delete_draft']);
  assert.equal(fixture.calls.length, 0, 'lifecycle commands must not fall through the base professor dispatcher');
});

test('multiple creator workspaces fall back to the active Due Diligence Community default', async () => {
  const communityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: true,
      creatorAuthorized: true,
      professorRoleSelected: false,
      institutionId: null,
      creatorWorkspaces: [
        { institutionId: IDS.institution, institutionCode: 'school-a', active: true },
        {
          institutionId: communityId,
          institutionCode: 'due-diligence-community',
          communityDefault: true,
          active: true,
        },
      ],
      memberships: [],
    }),
  });
  const response = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].institutionId, communityId);
});

test('signed-in creators fall back to the community workspace when creator context is missing or stale', async () => {
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: false,
      creatorAuthorized: false,
      professorRoleSelected: true,
      institutionId: null,
      creatorWorkspaces: [{ institutionId: IDS.institution, active: false }],
      memberships: [],
    }),
  });
  const defaultResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(defaultResponse.status, 200);
  assert.equal((await json(defaultResponse)).ok, true);

  const requestedResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', {
      operation: 'session', payload: { institutionId: IDS.institution },
    }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(requestedResponse.status, 200);
  assert.equal((await json(requestedResponse)).ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.institutionId), [
    COMMUNITY_INSTITUTION_ID,
    COMMUNITY_INSTITUTION_ID,
  ]);
});

test('a signed-in user without role, license, or assignment can create, save, publish, and request the key', async () => {
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: false,
      creatorAuthorized: false,
      professorRoleSelected: false,
      institutionId: null,
      creatorWorkspaces: [],
      memberships: [],
    }),
  });

  const saveResponse = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'save_draft',
      payload: { exam: clientExam() },
      idempotencyKey: REQUEST_KEY,
    }),
    ENV, ORIGIN, ORIGIN,
  );
  const publishResponse = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: { exam: clientExam({ roster: undefined }) },
      idempotencyKey: `${REQUEST_KEY}-publish`,
    }),
    ENV, ORIGIN, ORIGIN,
  );

  assert.equal(saveResponse.status, 200);
  assert.equal(publishResponse.status, 201);
  assert.deepEqual(calls.map((call) => call.operation), ['save_draft', 'publish']);
  assert.deepEqual(calls.map((call) => call.institutionId), [
    COMMUNITY_INSTITUTION_ID,
    COMMUNITY_INSTITUTION_ID,
  ]);
});

test('administrator is allowed into professor routes only as an authorized testing role', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].actorUserId, IDS.admin);
  assert.equal(calls[0].scope, 'professor');
});

test('a stale requested workspace never blocks a signed-in creator or inherits an admin membership', async () => {
  const authorization = {
    authorized: true,
    globalAuthorized: true,
    role: 'founder_admin',
    capabilities: ['role_admin'],
    institutionId: IDS.institution,
    memberships: [
      { institutionId: IDS.institution, staffRole: 'admin', active: true },
      { institutionId: IDS.otherInstitution, staffRole: 'professor', active: true },
    ],
  };
  const { handlers, calls, managementCalls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: true,
      creatorAuthorized: true,
      professorRoleSelected: false,
      institutionId: IDS.institution,
      creatorWorkspaces: [{ institutionId: IDS.institution, active: true }],
      memberships: [],
    }),
    authorizeAdmin: async () => authorization,
  });

  const adminResponse = await handlers.adminQuery(
    makeRequest('/examination-room/v1/admin/query', {
      operation: 'overview', payload: { institutionId: IDS.otherInstitution },
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(adminResponse.status, 403);
  assert.equal((await json(adminResponse)).error.code, 'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN');

  const testingResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', {
      operation: 'session', payload: { institutionId: IDS.otherInstitution },
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(testingResponse.status, 200);
  assert.equal((await json(testingResponse)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].institutionId, COMMUNITY_INSTITUTION_ID);
  assert.equal(managementCalls.length, 0);
});

test('save draft sends canonical questions and roster through the professor-only store contract', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'save_draft', payload: { exam: clientExam() }, idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.exam.questions[0].type, 'essay');
  assert.equal(calls[0].payload.exam.roster[0].fullName, 'Maria Theresa Dela Cruz');
  assert.match(calls[0].payload.requestHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(calls[0]), new RegExp(REQUEST_KEY, 'u'));
});

test('publish fails with field-level readiness guidance before persistence', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: { exam: clientExam({ title: '', questions: [] }) },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_PUBLICATION_NOT_READY');
  assert.ok(result.error.details.issues.length >= 2);
  assert.equal(calls.length, 0);
});

test('publish accepts recorded proctoring now that encrypted media degrades independently', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: {
        exam: clientExam({
          integrityTier: 'recorded_proctoring',
          cameraRequired: true,
          microphoneRequired: true,
        }),
      },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'publish');
  assert.equal(calls[0].payload.exam.integrityTier, 'recorded_proctoring');
  assert.equal(calls[0].payload.exam.cameraRequired, true);
  assert.equal(calls[0].payload.exam.microphoneRequired, true);
});

test('professor opens the latest approved activation without entering or persisting a room key', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'open_room', payload: { examId: IDS.exam }, idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['examId', 'openedAt', 'requestHash']);
  assert.equal('roomKeyHash' in calls[0].payload, false);
});

test('key-only admission is the default and publishing requires no roster', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: { exam: clientExam({ roster: undefined, admissionMode: undefined, allowedEmails: undefined }) },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.exam.admissionMode, 'key_only');
  assert.deepEqual(calls[0].payload.exam.allowedEmails, []);
  assert.deepEqual(calls[0].payload.exam.roster, []);
});

test('a successful publication hands the persisted request to the owner-notification hook', async () => {
  const handoffs = [];
  const executionContext = { waitUntil() {} };
  const publicationManifest = publicationFixture();
  const { handlers } = dependencyFixture({
    rpc: async (_env, parameters) => ({
      ok: true,
      examId: IDS.exam,
      version: 1,
      publicationHash: 'a'.repeat(64),
      publicationManifest,
      parameters,
    }),
    afterProfessorCommand: (details) => handoffs.push(details),
  });

  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: { exam: clientExam({ roster: undefined, admissionMode: undefined, allowedEmails: undefined }) },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN, executionContext,
  );

  assert.equal(response.status, 201);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].operation, 'publish');
  assert.equal(handoffs[0].result.examId, IDS.exam);
  assert.equal(handoffs[0].result.publicationHash, 'a'.repeat(64));
  assert.deepEqual(handoffs[0].result.publicationManifest, publicationManifest);
  assert.equal(handoffs[0].executionContext, executionContext);
});

test('optional email admission normalizes and deduplicates the creator list', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'save_draft',
      payload: {
        exam: clientExam({
          roster: undefined,
          admissionMode: 'email_allowlist',
          allowedEmails: [' First.Student@Example.COM ', 'first.student@example.com', 'second@example.com'],
        }),
      },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].payload.exam.admissionMode, 'email_allowlist');
  assert.deepEqual(calls[0].payload.exam.allowedEmails, [
    'first.student@example.com',
    'second@example.com',
  ]);
});

test('email allowlist mode explains how to recover when no email is entered', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'publish',
      payload: { exam: clientExam({ roster: undefined, admissionMode: 'email_allowlist', allowedEmails: [] }) },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_ALLOWED_EMAIL_REQUIRED');
  assert.match(result.error.recovery, /Anyone with the key/iu);
  assert.equal(calls.length, 0);
});

test('creator can revoke a monitored session with an idempotent auditable command', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'revoke_session',
      payload: { examId: IDS.exam, sessionId: IDS.session, reason: 'Removed after identity review.' },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].operation, 'revoke_session');
  assert.equal(calls[0].payload.sessionId, IDS.session);
  assert.equal(calls[0].payload.reason, 'Removed after identity review.');
  assert.match(calls[0].payload.requestHash, /^[0-9a-f]{64}$/u);
});

test('student preview exposes only operational metadata and never questions or policy-gating fields', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'preview' ? { ok: true, ...previewFixture() } : { ok: true },
  });
  const response = await handlers.studentPreview(
    makeRequest('/examination-room/v1/student/preview', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 200);
  assert.equal(result.metadata.title, 'Constitutional Law Midterm');
  assert.equal(result.metadata.examVersion, 'published-v1');
  assert.equal('questions' in result.metadata, false);
  assert.equal('notice' in result, false);
  assert.equal('privacyNoticeVersion' in result.metadata, false);
  assert.equal('privacyController' in result.metadata, false);
  assert.equal('retentionSummary' in result.metadata, false);
  assert.match(calls[0].payload.roomKeyHash, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(calls[0]).includes(ROOM_KEY), false);
});

test('student preview rejects a blocked examination before admitting a new student', async () => {
  const fixture = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'preview'
      ? { ok: true, ...previewFixture() }
      : { ok: true },
    examLifecycleGuard: async () => ({
      ok: false,
      error: {
        code: 'EXAMINATION_BLOCKED',
        message: 'This examination is temporarily blocked by the administrator.',
        status: 409,
        recovery: 'Wait for the administrator to reopen admission, then enter the same key again.',
      },
    }),
  });
  const response = await fixture.handlers.studentPreview(
    makeRequest('/examination-room/v1/student/preview', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAMINATION_BLOCKED');
  assert.match(result.error.recovery, /same key again/i);
  assert.deepEqual(fixture.lifecycleGuardCalls, [IDS.exam]);
});

test('student preview carries optional student.email only as normalized admission identity', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'preview' ? { ok: true, ...previewFixture() } : { ok: true },
  });
  const response = await handlers.studentPreview(
    makeRequest('/examination-room/v1/student/preview', {
      roomKey: ROOM_KEY,
      student: {
        fullName: 'Maria Theresa Dela Cruz',
        studentNumber: '2024-10001',
        subject: 'Constitutional Law',
        yearLevel: 'Second year',
        email: ' Maria.Student@Example.COM ',
      },
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].payload.identity.email, 'maria.student@example.com');
  assert.equal(JSON.stringify(await json(response)).includes('maria.student@example.com'), false);
});

test('invalid room key is rejected before any database lookup', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.studentPreview(
    makeRequest('/examination-room/v1/student/preview', {
      roomKey: 'ER1-AAAA-AAAA-A',
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('direct Begin opens recorded proctoring without policy or device-permission gating', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'preview') return { ok: true, ...previewFixture('recorded_proctoring') };
      if (parameters.operation === 'consent') return { ok: true, session: { id: IDS.session } };
      return { ok: true };
    },
  });
  const response = await handlers.studentBegin(
    makeRequest('/examination-room/v1/student/begin', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
      attemptBindingId: `attempt-binding:${'a'.repeat(64)}`,
      noticeVersion: 'stale-legacy-value', agreed: false, recordingAccepted: false,
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 201);
  assert.equal(result.session.id, IDS.session);
  assert.equal(EXAMINATION_ROOM_V1_PATHS['/examination-room/v1/student/begin'], 'studentBegin');
  assert.equal(EXAMINATION_ROOM_V1_PATHS['/examination-room/v1/student/consent'], 'studentBegin');
  const sessionCall = calls.find((entry) => entry.operation === 'consent');
  assert.equal(sessionCall.payload.technicalBindingId, `attempt-binding:${'a'.repeat(64)}`);
  assert.equal(sessionCall.payload.consent.noticeVersion, 'exam-room-v1');
  assert.equal(sessionCall.payload.consent.accepted, true);
  assert.equal(sessionCall.payload.consent.recordingAccepted, true);
  assert.doesNotMatch(JSON.stringify(sessionCall), /stale-legacy-value/u);
});

test('direct Begin returns a bearer session token once and persists only its HMAC', async () => {
  const publication = publicationFixture();
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'preview') return { ok: true, ...previewFixture() };
      if (parameters.operation === 'consent') {
        return { ok: true, session: { id: IDS.session }, publicationManifest: publication };
      }
      return { ok: true };
    },
  });
  const response = await handlers.studentBegin(
    makeRequest('/examination-room/v1/student/begin', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
      attemptBindingId: `attempt-binding:${'b'.repeat(64)}`,
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 201);
  assert.match(result.sessionToken, SESSION_TOKEN_PATTERN_FOR_TEST());
  const sessionCall = calls.find((entry) => entry.operation === 'consent');
  assert.match(sessionCall.payload.sessionTokenHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(sessionCall), new RegExp(result.sessionToken, 'u'));
  assert.equal(result.exam.questions[0].gradingGuidance, undefined);
  assert.equal('publicationManifest' in result, false);
});

test('direct Begin converts legacy database gate failures into neutral recovery guidance', async () => {
  const { handlers } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'preview') return { ok: true, ...previewFixture() };
      if (parameters.operation === 'consent') {
        return {
          ok: false,
          error: {
            code: 'PRIVACY_CONSENT_VERSION_MISMATCH',
            message: 'Legacy agreement text must match.',
            status: 412,
            recovery: 'Review the notice and agree again.',
          },
        };
      }
      return { ok: true };
    },
  });
  const response = await handlers.studentBegin(
    makeRequest('/examination-room/v1/student/begin', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
      attemptBindingId: `attempt-binding:${'c'.repeat(64)}`,
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_SESSION_BINDING_INVALID');
  assert.match(result.error.recovery, /Begin examination again/u);
  assert.doesNotMatch(JSON.stringify(result), /agree|consent|privacy|notice|acceptance|policy/iu);
});

function SESSION_TOKEN_PATTERN_FOR_TEST() {
  return /^ers1_[0-9a-f]{64}$/u;
}

test('student resume requires the separately issued session token', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.studentQuery(
    makeRequest('/examination-room/v1/student/query', {
      operation: 'resume', payload: { sessionId: IDS.session },
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('student resume strips the full publication manifest and returns only the student-safe view', async () => {
  const publication = publicationFixture();
  const { handlers } = dependencyFixture({
    rpc: async () => ({ ok: true, publicationManifest: publication, session: { id: IDS.session } }),
  });
  const response = await handlers.studentQuery(
    makeRequest('/examination-room/v1/student/query', {
      operation: 'resume', payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN },
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 200);
  assert.equal('publicationManifest' in result, false);
  assert.equal('gradingGuidance' in result.exam.questions[0], false);
  assert.equal('correctOptionIndex' in result.exam.questions[0], false);
});

test('student media prepare reuses hashed session authentication and never forwards raw credentials', async () => {
  const mediaCalls = [];
  const rateLimitCalls = [];
  const { handlers, calls } = dependencyFixture({
    rateLimit: async (_request, _env, scope, context) => rateLimitCalls.push({ scope, context }),
    rpc: async (_env, parameters) => parameters.operation === 'session_context'
      ? { ok: true, session: { id: IDS.session, status: 'active' } }
      : { ok: true },
    examinationRoomMedia: async (_env, input) => {
      mediaCalls.push(structuredClone(input));
      return {
        artifactId: IDS.artifact,
        intentId: '99999999-9999-4999-8999-999999999999',
        state: 'upload_ready',
        provider: 'google_drive',
        providerResult: { status: 'upload_session_created' },
        upload: { protocol: 'google_drive_resumable', method: 'PUT', url: 'https://www.googleapis.com/upload/session' },
        retryable: true,
        canContinueExam: true,
        submissionBlocked: false,
        recovery: 'Retry separately.',
      };
    },
  });

  const response = await handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture() },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);

  assert.equal(response.status, 200);
  assert.equal(EXAMINATION_ROOM_V1_PATHS['/examination-room/v1/student/media'], 'studentMedia');
  assert.equal(result.recording.state, 'upload_ready');
  assert.equal(result.recording.submissionBlocked, false);
  assert.equal(rateLimitCalls[0].scope, 'student_media');
  assert.deepEqual(Object.keys(rateLimitCalls[0].context.payload), ['sessionId']);
  assert.equal(calls[0].operation, 'session_context');
  assert.equal(mediaCalls.length, 1);
  assert.match(mediaCalls[0].sessionTokenHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(SESSION_TOKEN, 'u'));
  assert.doesNotMatch(JSON.stringify(mediaCalls), new RegExp(SESSION_TOKEN, 'u'));
  assert.doesNotMatch(JSON.stringify(mediaCalls), new RegExp(REQUEST_KEY, 'u'));
});

test('student media has no role check and completion remains available after answers submit', async () => {
  const mediaCalls = [];
  const { handlers } = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'session_context'
      ? { ok: true, session: { id: IDS.session, status: 'submitted' } }
      : { ok: true },
    examinationRoomMedia: async (_env, input) => {
      mediaCalls.push(structuredClone(input));
      return {
        artifactId: IDS.artifact,
        artifactRecordId: '99999999-9999-4999-8999-999999999999',
        state: 'completed',
        provider: 'google_drive',
        providerResult: { status: 'verified', objectId: 'DriveObject_12345678', sizeBytes: 1_048_640 },
        upload: null,
        retryable: false,
        canContinueExam: true,
        submissionBlocked: false,
        recovery: 'Registered.',
      };
    },
  });
  const { derivedKey: _derivedKey, ...artifact } = mediaFixture();
  const response = await handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'complete_upload',
      payload: {
        sessionId: IDS.session,
        sessionToken: SESSION_TOKEN,
        ...artifact,
        provider: 'google_drive',
        providerObjectId: 'DriveObject_12345678',
      },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );

  assert.equal(response.status, 200);
  assert.equal((await json(response)).recording.state, 'completed');
  assert.equal(mediaCalls.length, 1);
  assert.equal(mediaCalls[0].operation, 'complete_upload');
});

test('student media rejects invalid credentials, insecure key transport, and invalid metadata before storage', async () => {
  let mediaCalls = 0;
  const { handlers, calls } = dependencyFixture({
    examinationRoomMedia: async () => {
      mediaCalls += 1;
      return {};
    },
  });

  const invalidToken = await handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: 'invalid', ...mediaFixture() },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(invalidToken.status, 401);

  const insecure = new Request('http://worker.example/examination-room/v1/student/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': REQUEST_KEY },
    body: JSON.stringify({
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture() },
    }),
  });
  const insecureResponse = await handlers.studentMedia(insecure, ENV, ORIGIN, ORIGIN);
  assert.equal(insecureResponse.status, 400);
  assert.equal((await json(insecureResponse)).error.code, 'EXAM_ROOM_V1_MEDIA_TLS_REQUIRED');

  const invalidMetadata = await handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture({ encryptedSizeBytes: 0 }) },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(invalidMetadata.status, 400);
  assert.equal((await json(invalidMetadata)).error.code, 'EXAM_ROOM_V1_MEDIA_SIZE_INVALID');
  assert.equal(mediaCalls, 0);
  assert.equal(calls.length, 0);
});

test('student media storage and dependency failures degrade to a recoverable local queue', async () => {
  const unavailable = dependencyFixture();
  const response = await unavailable.handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture() },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 200);
  assert.equal(result.recording.state, 'local_queue');
  assert.equal(result.recording.canContinueExam, true);
  assert.equal(result.recording.submissionBlocked, false);

  const failing = dependencyFixture({
    examinationRoomMedia: async () => { throw new Error('provider details must not escape'); },
  });
  const failingResponse = await failing.handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture() },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const failingResult = await json(failingResponse);
  assert.equal(failingResponse.status, 200);
  assert.equal(failingResult.recording.providerResult.status, 'control_plane_temporarily_unavailable');
  assert.doesNotMatch(JSON.stringify(failingResult), /provider details must not escape/u);
});

test('student media maps client-correctable control errors without leaking internals', async () => {
  const { handlers } = dependencyFixture({
    examinationRoomMedia: async () => {
      throw new ExaminationRoomMediaError(
        'EXAM_ROOM_V1_MEDIA_KEY_INVALID',
        'The recording key is invalid.',
        400,
        'Create a new encrypted segment and retry.',
      );
    },
  });
  const response = await handlers.studentMedia(
    makeRequest('/examination-room/v1/student/media', {
      operation: 'prepare_upload',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, ...mediaFixture() },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_MEDIA_KEY_INVALID');
  assert.match(result.error.recovery, /new encrypted segment/iu);
});

test('answer saves are core-validated, append-only commands with hashed credentials', async () => {
  const publication = publicationFixture();
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'session_context') {
        return { ok: true, publicationManifest: publication, publicationHash: 'a'.repeat(64) };
      }
      if (parameters.operation === 'save_answer') return { ok: true, revision: { revision: 1 } };
      return { ok: true };
    },
  });
  const response = await handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'save_answer',
      payload: {
        sessionId: IDS.session, sessionToken: SESSION_TOKEN,
        questionId: 'q-1', revision: 1,
        answer: 'Checks and balances restrain each branch.', flagged: true,
      },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  const saveCall = calls.find((entry) => entry.operation === 'save_answer');
  assert.equal(saveCall.payload.answerRevision.questionNumber, 1);
  assert.equal(saveCall.payload.answerRevision.questionKey, 'q001');
  assert.equal(saveCall.payload.answerRevision.revision, 1);
  assert.equal(saveCall.payload.flagged, true);
  assert.doesNotMatch(JSON.stringify(saveCall), new RegExp(SESSION_TOKEN, 'u'));
  assert.doesNotMatch(JSON.stringify(saveCall), new RegExp(REQUEST_KEY, 'u'));
});

test('submission freezes latest revisions into a manifest and keeps retries idempotent by hash', async () => {
  const publication = publicationFixture();
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'session_context') {
        return {
          ok: true,
          publicationManifest: publication,
          publicationHash: 'a'.repeat(64),
          studentIdentity: identityFixture(),
          privacyConsent: {
            noticeVersion: 'exam-room-v1', accepted: true,
            acceptedAt: '2026-08-26T01:55:00.000Z', recordingAccepted: false,
          },
          answerRevisions: [answerRevisionFixture(publication)],
        };
      }
      if (parameters.operation === 'submit') return { ok: true, submission: { id: IDS.submission }, duplicate: false };
      return { ok: true };
    },
  });
  const response = await handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'submit',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 201);
  const submitCall = calls.find((entry) => entry.operation === 'submit');
  assert.equal(submitCall.payload.submissionManifest.questionCount, 1);
  assert.equal(submitCall.payload.answerSelections[0].revision, 1);
  assert.match(submitCall.payload.manifestHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submitCall), new RegExp(REQUEST_KEY, 'u'));
});

test('a 100-student submission burst hands every accepted submission to immediate recovery without waiting for cron', async () => {
  const publication = publicationFixture();
  const recoveryHandoffs = [];
  const contexts = Array.from({ length: 100 }, () => ({ marker: Symbol('execution-context') }));
  const { handlers } = dependencyFixture({
    afterStudentCommand: (details) => recoveryHandoffs.push(details),
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'session_context') {
        return {
          ok: true,
          publicationManifest: publication,
          publicationHash: 'a'.repeat(64),
          studentIdentity: identityFixture(),
          privacyConsent: {
            noticeVersion: 'exam-room-v1', accepted: true,
            acceptedAt: '2026-08-26T01:55:00.000Z', recordingAccepted: false,
          },
          answerRevisions: [answerRevisionFixture(publication)],
        };
      }
      if (parameters.operation === 'submit') {
        return { ok: true, submission: { id: IDS.submission }, duplicate: false };
      }
      return { ok: true };
    },
  });

  const responses = await Promise.all(contexts.map((executionContext) => handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'submit',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN },
      idempotencyKey: REQUEST_KEY,
    }, null),
    ENV,
    ORIGIN,
    ORIGIN,
    executionContext,
  )));

  assert.equal(responses.every((response) => response.status === 201), true);
  assert.equal(recoveryHandoffs.length, 100);
  assert.equal(recoveryHandoffs.every((entry) => entry.operation === 'submit'), true);
  assert.deepEqual(recoveryHandoffs.map((entry) => entry.executionContext), contexts);
});

test('professor grade save creates an append-only grading revision without persisting raw idempotency', async () => {
  const publication = publicationFixture();
  const submission = submissionFixture(publication);
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'grading_context') {
        return {
          ok: true,
          publicationManifest: publication,
          submissionManifest: submission,
          questionNumber: 1,
          scores: [],
          nextRevision: 1,
        };
      }
      if (parameters.operation === 'save_grade') return { ok: true, revision: { revision: 1 } };
      return { ok: true };
    },
  });
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'save_grade',
      payload: { examId: IDS.exam, sessionId: IDS.session, questionId: 'q-1', points: 16, feedback: 'Clear analysis.' },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  const responseBody = await json(response);
  assert.equal(responseBody.grade.sessionId, IDS.session);
  assert.equal(responseBody.grade.questionId, 'q001');
  assert.equal(responseBody.grade.points, 16);
  assert.equal(responseBody.grade.feedback, 'Clear analysis.');
  assert.deepEqual(responseBody.revision, responseBody.grade);
  const saveCall = calls.find((entry) => entry.operation === 'save_grade');
  assert.equal(saveCall.payload.gradingManifest.scores[0].pointsAwarded, 16);
  assert.equal('idempotencyKey' in saveCall.payload.gradingManifest, false);
  assert.match(saveCall.payload.gradingHash, /^[0-9a-f]{64}$/u);
});

test('result release finalizes every selected score and gives each release a distinct idempotency hash', async () => {
  const publication = publicationFixture();
  const submission = submissionFixture(publication);
  const handoffs = [];
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => {
      if (parameters.operation === 'release_context') {
        return {
          ok: true,
          entries: [{
            sessionId: IDS.session,
            nextRevision: 2,
            submissionManifest: submission,
            scores: [{ questionNumber: 1, pointsAwarded: 18, feedback: 'Sound legal analysis.' }],
            overallFeedback: 'Well organized.',
          }],
        };
      }
      if (parameters.operation === 'release_results') return { ok: true, released: 1 };
      return { ok: true };
    },
    afterProfessorCommand: async (details) => {
      handoffs.push(structuredClone(details));
      return {
        resultDelivery: {
          status: 'sent', total: 1, acceptedCount: 1, failedCount: 0, skippedCount: 0,
          outcomes: [{ sessionId: IDS.session, status: 'sent', providerId: 'result-email-1' }],
        },
      };
    },
  });
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'release_results',
      payload: { examId: IDS.exam, sessionIds: [IDS.session] },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  const responseBody = await json(response);
  assert.equal(responseBody.release.examId, IDS.exam);
  assert.deepEqual(responseBody.release.sessionIds, [IDS.session]);
  assert.equal(responseBody.release.status, 'released');
  assert.equal(responseBody.release.releasedAt, '2026-08-26T04:00:00.000Z');
  assert.equal(responseBody.release.delivery.status, 'sent');
  assert.equal(responseBody.release.delivery.outcomes[0].providerId, 'result-email-1');
  const releaseCall = calls.find((entry) => entry.operation === 'release_results');
  assert.equal(releaseCall.payload.releases.length, 1);
  assert.equal(releaseCall.payload.releases[0].gradingManifest.status, 'final');
  assert.equal(releaseCall.payload.releases[0].releaseManifest.result.totalPointsAwarded, 18);
  assert.match(releaseCall.payload.releases[0].releaseRequestHash, /^[0-9a-f]{64}$/u);
  assert.equal('idempotencyKey' in releaseCall.payload.releases[0].gradingManifest, false);
  assert.equal('idempotencyKey' in releaseCall.payload.releases[0].releaseManifest, false);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].actorUserId, IDS.professor);
  assert.equal(handoffs[0].institutionId, IDS.institution);
  assert.equal(handoffs[0].requestHash.length, 64);
  assert.deepEqual(handoffs[0].resultEmailItems, [{
    releaseId: releaseCall.payload.releases[0].releaseManifest.releaseId,
    sessionId: IDS.session,
    releaseRequestHash: releaseCall.payload.releases[0].releaseRequestHash,
  }]);

  const replayResponse = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'release_results',
      payload: { examId: IDS.exam, sessionIds: [IDS.session] },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(replayResponse.status, 200);
  const releaseCalls = calls.filter((entry) => entry.operation === 'release_results');
  assert.equal(releaseCalls.length, 2);
  assert.equal(
    releaseCalls[0].payload.releases[0].releaseManifest.releaseId,
    releaseCalls[1].payload.releases[0].releaseManifest.releaseId,
  );
  assert.equal(
    releaseCalls[0].payload.releases[0].gradingManifest.revisionId,
    releaseCalls[1].payload.releases[0].gradingManifest.revisionId,
  );
});

test('heartbeat and ordinary integrity signals contain no bearer credential in persistence payloads', async () => {
  const { handlers, calls } = dependencyFixture();
  const heartbeatResponse = await handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'heartbeat',
      payload: { sessionId: IDS.session, sessionToken: SESSION_TOKEN, connected: true, currentQuestion: 1 },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const eventResponse = await handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'record_event',
      payload: {
        sessionId: IDS.session,
        sessionToken: SESSION_TOKEN,
        type: 'focus_lost',
        severity: 'review',
        details: { visibilityState: 'hidden' },
      },
      idempotencyKey: '12345678-1234-4234-8234-1234567890ac',
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(heartbeatResponse.status, 200);
  assert.equal(eventResponse.status, 200);
  const eventCall = calls.find((entry) => entry.operation === 'record_event');
  assert.equal(eventCall.payload.incidentKind, 'focus_lost');
  assert.equal(eventCall.payload.severity, 'warning');
  assert.equal(JSON.stringify(calls).includes(SESSION_TOKEN), false);
});

test('admin activation generates a checksum-valid key but persists only the HMAC verifier', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async () => ({ ok: true, activation: { id: '88888888-8888-4888-8888-888888888888' } }),
  });
  const response = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'activate_exam', payload: { examId: IDS.exam }, idempotencyKey: REQUEST_KEY,
    }, 'admin'), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 201);
  assert.equal(normalizeRoomKey(result.roomKey), result.roomKey);
  assert.match(calls[0].payload.roomKeyHash, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(calls[0]).includes(result.roomKey), false);
});

test('admin key generation remains bounded even at the highest random byte value', async () => {
  let samplingAttempts = 0;
  const { handlers, calls } = dependencyFixture({
    randomBytes: (length) => {
      samplingAttempts += 1;
      return new Uint8Array(length).fill(255);
    },
  });
  const response = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'activate_exam', payload: { examId: IDS.exam }, idempotencyKey: REQUEST_KEY,
    }, 'admin'), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 201);
  assert.equal(normalizeRoomKey(result.roomKey), result.roomKey);
  assert.equal(samplingAttempts, 1, 'the 32-character alphabet accepts every byte without recursion');
  assert.equal(calls.length, 1);
});

test('100 repeated admin approval requests preserve one idempotency hash and never persist raw keys', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async () => ({ ok: true, duplicate: true, activation: { id: '88888888-8888-4888-8888-888888888888', status: 'scheduled' } }),
  });
  for (let index = 0; index < 100; index += 1) {
    const response = await handlers.adminCommand(
      makeRequest('/examination-room/v1/admin/command', {
        operation: 'activate_exam', payload: { examId: IDS.exam }, idempotencyKey: REQUEST_KEY,
      }, 'admin'), ENV, ORIGIN, ORIGIN,
    );
    assert.equal(response.status, 201);
    const result = await json(response);
    assert.equal(JSON.stringify(calls[index]).includes(result.roomKey), false);
  }
  assert.equal(calls.length, 100);
  assert.equal(new Set(calls.map((call) => call.payload.requestHash)).size, 1);
  assert.equal(calls.every((call) => /^[0-9a-f]{64}$/u.test(call.payload.roomKeyHash)), true);
});

test('email key rotates the verifier and exposes plaintext only to the authorized mail boundary', async () => {
  const { handlers, calls, deliveries } = dependencyFixture({
    rpc: async () => ({
      ok: true,
      professorEmail: 'professor@example.edu.ph',
      professorName: 'Prof. Elena Villanueva',
      examTitle: 'Constitutional Law Midterm',
      activation: { expiresAt: '2026-08-27T04:00:00.000Z' },
    }),
  });
  const response = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'email_key', payload: { examId: IDS.exam }, idempotencyKey: REQUEST_KEY,
    }, 'admin'), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 200);
  assert.equal(result.deliveryStatus, 'sent');
  assert.equal(deliveries[0].roomKey, result.roomKey);
  assert.equal(JSON.stringify(calls[0]).includes(result.roomKey), false);
});

test('global role administrator can bootstrap the first institution without a circular membership dependency', async () => {
  const { handlers, managementCalls } = dependencyFixture({
    authorizeAdmin: async (_env, user) => user.id === IDS.admin
      ? {
          authorized: false,
          globalAuthorized: true,
          canBootstrap: true,
          role: 'founder_admin',
          capabilities: ['role_admin'],
          memberships: [],
        }
      : { authorized: false },
    manageStaff: async (_env, parameters) => ({
      ok: true,
      institution: { id: IDS.institution, code: 'sample-law', name: 'Sample Law School' },
      membershipId: '99999999-9999-4999-8999-999999999999',
      parameters,
    }),
  });

  const accessResponse = await handlers.adminQuery(
    makeRequest('/examination-room/v1/admin/query', { operation: 'access', payload: {} }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(accessResponse.status, 200);
  assert.equal(managementCalls[0].operation, 'access');
  assert.equal(managementCalls[0].institutionId, null);

  const bootstrapResponse = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'bootstrap_institution',
      payload: { institutionName: 'Sample Law School', institutionCode: 'Sample-Law' },
      idempotencyKey: REQUEST_KEY,
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(bootstrapResponse.status, 201);
  assert.equal(managementCalls[1].operation, 'bootstrap_institution');
  assert.equal(managementCalls[1].institutionId, null);
  assert.equal(managementCalls[1].payload.institutionCode, 'sample-law');
  assert.match(managementCalls[1].payload.requestHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(managementCalls[1]), new RegExp(REQUEST_KEY, 'u'));
});

test('institution admin assigns and revokes signed-in staff through the protected management RPC', async () => {
  const membershipId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { handlers, managementCalls } = dependencyFixture({
    manageStaff: async (_env, parameters) => ({
      ok: true,
      ...(parameters.operation === 'assign_staff'
        ? { membership: { id: membershipId, status: 'active' } }
        : { membershipId, status: 'revoked' }),
    }),
  });
  const assignResponse = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'assign_staff',
      payload: {
        institutionId: IDS.institution,
        email: 'Professor@Example.edu.ph',
        displayName: 'Prof. Elena Villanueva',
        staffRole: 'professor',
        reason: 'Assigned by the law school for the Constitutional Law examination.',
      },
      idempotencyKey: REQUEST_KEY,
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(assignResponse.status, 200);
  assert.equal(managementCalls[0].institutionId, IDS.institution);
  assert.equal(managementCalls[0].payload.email, 'professor@example.edu.ph');
  assert.equal(managementCalls[0].payload.staffRole, 'professor');

  const revokeResponse = await handlers.adminCommand(
    makeRequest('/examination-room/v1/admin/command', {
      operation: 'revoke_staff',
      payload: {
        institutionId: IDS.institution,
        membershipId,
        reason: 'The professor assignment ended after the examination period.',
      },
      idempotencyKey: '12345678-1234-4234-8234-1234567890ad',
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(revokeResponse.status, 200);
  assert.equal(managementCalls[1].operation, 'revoke_staff');
  assert.equal(managementCalls[1].payload.membershipId, membershipId);
});

test('staff directory remains institution-bound', async () => {
  const { handlers, managementCalls } = dependencyFixture({
    manageStaff: async () => ({ ok: true, institution: { id: IDS.institution }, staff: [] }),
  });
  const response = await handlers.adminQuery(
    makeRequest('/examination-room/v1/admin/query', {
      operation: 'staff_directory', payload: { institutionId: IDS.institution },
    }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.equal(managementCalls[0].operation, 'directory');
  assert.equal(managementCalls[0].institutionId, IDS.institution);
});

test('ordinary admin without role_admin capability is denied', async () => {
  const fixture = dependencyFixture();
  const base = fixture.handlers;
  const deniedHandlers = createExaminationRoomV1Handlers({
    parseJson: async (request) => request.json(),
    respond: (body, status) => new Response(JSON.stringify(body), { status }),
    authenticate: async () => ({ id: IDS.admin }),
    authorizeProfessor: async () => ({ authorized: false }),
    authorizeAdmin: async () => ({ authorized: true, role: 'admin', capabilities: [], institutionId: IDS.institution }),
    rateLimit: async () => undefined,
    rpc: async () => ({ ok: true }),
    manageStaff: async () => ({ ok: true }),
    professorAccess: async () => ({ ok: true }),
    hmacHex: async (key, value) => createHmac('sha256', key).update(value).digest('hex'),
    randomBytes: (length) => new Uint8Array(length),
    randomUUID: () => IDS.exam,
    now: () => '2026-08-26T04:00:00.000Z',
  });
  assert.ok(base);
  const response = await deniedHandlers.adminQuery(
    makeRequest('/examination-room/v1/admin/query', { operation: 'overview', payload: {} }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error.code, 'EXAM_ROOM_V1_ADMIN_FORBIDDEN');
});

test('admin overview is institution-bound and professor document import fails with a usable fallback', async () => {
  const { handlers, calls } = dependencyFixture();
  const overview = await handlers.adminQuery(
    makeRequest('/examination-room/v1/admin/query', { operation: 'overview', payload: {} }, 'admin'),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(overview.status, 200);
  assert.equal(calls[0].institutionId, IDS.institution);

  const importResponse = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'import_document',
      payload: { examId: IDS.exam, fileName: 'exam.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: 'QQ==' },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(importResponse);
  assert.equal(importResponse.status, 503);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_IMPORT_UNAVAILABLE');
  assert.match(result.error.recovery, /Paste the questions|TXT/u);
});

test('secret-looking fields are rejected from integrity event details', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.studentCommand(
    makeRequest('/examination-room/v1/student/command', {
      operation: 'record_event',
      payload: {
        sessionId: IDS.session,
        sessionToken: SESSION_TOKEN,
        type: 'focus_lost',
        details: { roomKey: ROOM_KEY },
      },
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, 'EXAM_ROOM_V1_SECRET_FIELD_REJECTED');
  assert.equal(calls.length, 0);
});

test('rate limit failures are returned with recovery guidance and prevent persistence', async () => {
  const { handlers, calls } = dependencyFixture({
    rateLimit: async () => {
      throw new ExaminationRoomV1RouteError(
        'EXAM_ROOM_V1_RATE_LIMITED',
        'Too many join attempts.',
        429,
        'Wait ten minutes, then copy the key and try once more.',
      );
    },
  });
  const response = await handlers.studentPreview(
    makeRequest('/examination-room/v1/student/preview', {}, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 429);
  assert.match(result.error.recovery, /Wait ten minutes/u);
  assert.equal(calls.length, 0);
});
