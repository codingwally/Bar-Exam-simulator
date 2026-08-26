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
  ExaminationRoomV1RouteError,
  createExaminationRoomV1Handlers,
  professorDraftFromClientExam,
} from './examination-room-v1-routes.mjs';

const IDS = Object.freeze({
  institution: '11111111-1111-4111-8111-111111111111',
  otherInstitution: '77777777-7777-4777-8777-777777777777',
  professor: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  exam: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  submission: '66666666-6666-4666-8666-666666666666',
});

const ENV = Object.freeze({ EXAMINATION_ROOM_KEY_PEPPER: 'test-only-examination-room-pepper-32-bytes-minimum' });
const ORIGIN = 'https://duediligence.ph';
const REQUEST_KEY = '12345678-1234-4234-8234-1234567890ab';
const SESSION_TOKEN = `ers1_${'ab'.repeat(32)}`;
const ROOM_KEY = createRoomKey('ABCDEFGH');

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

function previewFixture(integrityTier = 'standard') {
  return {
    metadata: {
      examId: IDS.exam,
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
    authorizeProfessor: options.authorizeProfessor || (async (_env, user) => user.id === IDS.professor
      ? { authorized: true, professorRoleSelected: true, institutionId: IDS.institution, memberships: [{ institutionId: IDS.institution, staffRole: 'professor', active: true }] }
      : { authorized: false, professorRoleSelected: false }),
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
    randomBytes: (length) => Uint8Array.from({ length }, (_, index) => (index * 13 + 7) % 224),
    randomUUID: () => {
      uuidCounter += 1;
      return `77777777-7777-4777-8777-${String(uuidCounter).padStart(12, '0')}`;
    },
    now: () => '2026-08-26T04:00:00.000Z',
    sendRoomKeyEmail: async (_env, message) => {
      deliveries.push(structuredClone(message));
      return { status: 'sent' };
    },
  };
  return { handlers: createExaminationRoomV1Handlers(dependencies), calls, managementCalls, professorAccessCalls, deliveries };
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

test('active membership alone cannot open Professor data for a non-Professor profile', async () => {
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: false,
      professorRoleSelected: false,
      institutionId: IDS.institution,
      memberships: [{ institutionId: IDS.institution, staffRole: 'professor', active: true }],
    }),
    authorizeAdmin: async () => ({ authorized: false }),
  });
  const response = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  const body = await json(response);
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'EXAM_ROOM_V1_PROFESSOR_ROLE_REQUIRED');
  assert.equal(calls.length, 0);
});

test('missing membership activity fails closed for default and explicitly requested institutions', async () => {
  const { handlers, calls } = dependencyFixture({
    authorizeProfessor: async () => ({
      authorized: true,
      professorRoleSelected: true,
      institutionId: null,
      memberships: [{ institutionId: IDS.institution, staffRole: 'professor' }],
    }),
  });
  const defaultResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(defaultResponse.status, 403);
  assert.equal((await json(defaultResponse)).error.code, 'EXAM_ROOM_V1_INSTITUTION_REQUIRED');

  const requestedResponse = await handlers.professorQuery(
    makeRequest('/examination-room/v1/professor/query', {
      operation: 'session', payload: { institutionId: IDS.institution },
    }),
    ENV, ORIGIN, ORIGIN,
  );
  assert.equal(requestedResponse.status, 403);
  assert.equal((await json(requestedResponse)).error.code, 'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN');
  assert.equal(calls.length, 0);
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

test('mixed-role administrator cannot cross the institution boundary through a Professor-only membership', async () => {
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
    authorizeProfessor: async () => ({ authorized: false, professorRoleSelected: false }),
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
  assert.equal(testingResponse.status, 403);
  assert.equal((await json(testingResponse)).error.code, 'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN');
  assert.equal(calls.length, 0);
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

test('publish fails closed when recorded proctoring has no complete media pipeline', async () => {
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
  const result = await json(response);
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_RECORDED_PROCTORING_NOT_CONFIGURED');
  assert.match(result.error.recovery, /encrypted media upload/iu);
  assert.equal(calls.length, 0);
});

test('professor opens a room with an HMAC only; the raw room key never reaches persistence', async () => {
  const { handlers, calls } = dependencyFixture();
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'open_room', payload: { examId: IDS.exam, roomKey: ROOM_KEY }, idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  assert.match(calls[0].payload.roomKeyHash, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(calls[0]).includes(ROOM_KEY), false);
});

test('student preview exposes metadata and notice but never questions', async () => {
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
  assert.equal('questions' in result.metadata, false);
  assert.equal(result.notice.version, 'exam-room-v1');
  assert.match(calls[0].payload.roomKeyHash, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(calls[0]).includes(ROOM_KEY), false);
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

test('recorded proctoring consent is version-bound and explicitly recording-bound', async () => {
  const { handlers, calls } = dependencyFixture({
    rpc: async (_env, parameters) => parameters.operation === 'preview'
      ? { ok: true, ...previewFixture('recorded_proctoring') }
      : { ok: true },
  });
  const response = await handlers.studentConsent(
    makeRequest('/examination-room/v1/student/consent', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
      noticeVersion: 'exam-room-v1', agreed: true, recordingAccepted: false,
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 412);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_RECORDING_CONSENT_REQUIRED');
  assert.equal(calls.length, 1);
});

test('consent returns a bearer session token once and persists only its HMAC', async () => {
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
  const response = await handlers.studentConsent(
    makeRequest('/examination-room/v1/student/consent', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
      noticeVersion: 'exam-room-v1', agreed: true, recordingAccepted: false,
      idempotencyKey: REQUEST_KEY,
    }, null), ENV, ORIGIN, ORIGIN,
  );
  const result = await json(response);
  assert.equal(response.status, 201);
  assert.match(result.sessionToken, SESSION_TOKEN_PATTERN_FOR_TEST());
  const consentCall = calls.find((entry) => entry.operation === 'consent');
  assert.match(consentCall.payload.sessionTokenHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(consentCall), new RegExp(result.sessionToken, 'u'));
  assert.equal(result.exam.questions[0].gradingGuidance, undefined);
  assert.equal('publicationManifest' in result, false);
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
  const saveCall = calls.find((entry) => entry.operation === 'save_grade');
  assert.equal(saveCall.payload.gradingManifest.scores[0].pointsAwarded, 16);
  assert.equal('idempotencyKey' in saveCall.payload.gradingManifest, false);
  assert.match(saveCall.payload.gradingHash, /^[0-9a-f]{64}$/u);
});

test('result release finalizes every selected score and gives each release a distinct idempotency hash', async () => {
  const publication = publicationFixture();
  const submission = submissionFixture(publication);
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
  });
  const response = await handlers.professorCommand(
    makeRequest('/examination-room/v1/professor/command', {
      operation: 'release_results',
      payload: { examId: IDS.exam, sessionIds: [IDS.session] },
      idempotencyKey: REQUEST_KEY,
    }), ENV, ORIGIN, ORIGIN,
  );
  assert.equal(response.status, 200);
  const releaseCall = calls.find((entry) => entry.operation === 'release_results');
  assert.equal(releaseCall.payload.releases.length, 1);
  assert.equal(releaseCall.payload.releases[0].gradingManifest.status, 'final');
  assert.equal(releaseCall.payload.releases[0].releaseManifest.result.totalPointsAwarded, 18);
  assert.match(releaseCall.payload.releases[0].releaseRequestHash, /^[0-9a-f]{64}$/u);
  assert.equal('idempotencyKey' in releaseCall.payload.releases[0].gradingManifest, false);
  assert.equal('idempotencyKey' in releaseCall.payload.releases[0].releaseManifest, false);
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
