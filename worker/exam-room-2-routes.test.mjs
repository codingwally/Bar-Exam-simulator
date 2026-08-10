import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createDD2026Handlers } from './duediligence-2026-routes.mjs';
import { sha256Hex } from './exam-room-2026-core.mjs';
import { encryptStudentExamCode } from './exam-room-student-code-envelope.mjs';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const examId = '123e4567-e89b-42d3-a456-426614174001';
const versionId = '123e4567-e89b-42d3-a456-426614174002';
const attemptId = '123e4567-e89b-42d3-a456-426614174003';
const sessionId = '123e4567-e89b-42d3-a456-426614174004';
const questionId = '123e4567-e89b-42d3-a456-426614174005';
const operationId = '123e4567-e89b-42d3-a456-426614174006';
const beadleId = '123e4567-e89b-42d3-a456-426614174007';
const leaveId = '123e4567-e89b-42d3-a456-426614174008';
const grantId = '123e4567-e89b-42d3-a456-426614174009';
const authSessionId = '123e4567-e89b-42d3-a456-426614174010';
const publicationId = '123e4567-e89b-42d3-a456-426614174011';
const requestKey = 'request_2026_abcdef123456';
const v2Env = Object.freeze({
  EXAMINATION_ROOM_ENABLED: 'true',
  EXAMINATION_ROOM_2_ENABLED: 'true',
  EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v1',
  EXAM_ROOM_STUDENT_CODE_KEY_V1: Buffer.alloc(32, 17).toString('base64url'),
});

function request(body) {
  return new Request('https://worker.test/exam-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' },
    body: JSON.stringify(body),
  });
}

function harness(overrides = {}) {
  const calls = [];
  const adminCalls = [];
  const uploads = [];
  const deletions = [];
  const rateModes = [];
  const rawHandlers = createDD2026Handlers({
    corsHeaders: () => ({}),
    dd2026Rpc: async () => ({}),
    deleteExamRoomSource: async (_env, path) => { deletions.push(path); return true; },
    enforceAdminRateLimit: async () => {},
    enforceDD2026RateLimit: async () => {},
    enforceExamRoomRateLimit: async (_request, _env, _userId, mode) => rateModes.push(mode),
    examRoomRpc: async (_env, name, body) => {
      calls.push({ name, body });
      if (name === 'exam_room_exam_access_v3') {
        return overrides.access ?? {
          canUploadQuestions: true,
          canManageRoster: true,
          storagePrefix: examId,
        };
      }
      if (overrides.rpc) return overrides.rpc(name, body);
      return overrides.result ?? { ok: true };
    },
    jsonResponse: (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    parseBoundedJson: async (input) => input.json(),
    processExamRoomQueues: async () => ({}),
    requireAdministrator: async () => {
      adminCalls.push(true);
      if (overrides.adminError) throw overrides.adminError;
      return overrides.admin ?? { id: userId };
    },
    requireAuthenticatedUser: async () => overrides.user ?? ({ id: userId }),
    resolveVerdictQuestion: async () => null,
    structuredGemini: async () => ({}),
    uploadExamRoomSource: async (_env, path, bytes, mimeType) => {
      uploads.push({ path, bytes, mimeType });
      return true;
    },
  });
  const handlers = new Proxy(rawHandlers, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      return (input, env, ...args) => value(
        input,
        env && Object.keys(env).length ? env : v2Env,
        ...args,
      );
    },
  });
  return { handlers, rawHandlers, calls, uploads, deletions, rateModes, adminCalls };
}

test('Admin issues one scoped room key through a hashed, projected contract', async () => {
  const activationKey = 'professor-room-key-plain-secret';
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const activationId = '123e4567-e89b-42d3-a456-426614174011';
  const issued = harness({
    rpc: async (name) => name === 'exam_room_issue_professor_activation'
      ? {
        ok: true,
        activationId,
        status: 'issued',
        createdAt: '2026-08-10T02:00:00Z',
        expiresAt,
        tokenHash: 'must-not-project',
        activationKey: 'must-not-project',
      }
      : { ok: true },
  });
  const response = await issued.handlers.examCommand(request({
    operation: 'issue_activation',
    targetEmail: 'Professor@Example.edu',
    activationKey,
    roomTitle: 'Civil Law Final Examination Room',
    schoolName: 'Due Diligence College of Law',
    academicTerm: 'First Semester 2026-2027',
    expiresAt,
    reason: 'Initial beta room invitation for the assigned Professor.',
  }), {}, '', '', {});
  const call = issued.calls.at(-1);
  const payload = await response.json();

  assert.equal(issued.adminCalls.length, 1);
  assert.equal(call.name, 'exam_room_issue_professor_activation');
  assert.equal(call.body.p_actor_user_id, userId);
  assert.equal(call.body.p_target_email, 'professor@example.edu');
  assert.equal(call.body.p_room_title, 'Civil Law Final Examination Room');
  assert.equal(call.body.p_school_name, 'Due Diligence College of Law');
  assert.equal(call.body.p_academic_term, 'First Semester 2026-2027');
  assert.equal(call.body.p_expires_at, expiresAt);
  assert.match(call.body.p_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(call.body).includes(activationKey), false);
  assert.deepEqual(payload.result, {
    ok: true,
    activationId,
    status: 'issued',
    createdAt: '2026-08-10T02:00:00Z',
    expiresAt,
    targetEmail: 'professor@example.edu',
    roomTitle: 'Civil Law Final Examination Room',
    schoolName: 'Due Diligence College of Law',
    academicTerm: 'First Semester 2026-2027',
  });
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
  assert.equal(JSON.stringify(payload).includes(activationKey), false);

  const denied = harness({ adminError: new Error('ADMIN_REQUIRED') });
  await assert.rejects(
    denied.handlers.examCommand(request({
      operation: 'issue_activation',
      targetEmail: 'professor@example.edu',
      activationKey,
      roomTitle: 'Civil Law Final Examination Room',
      schoolName: 'Due Diligence College of Law',
      academicTerm: 'First Semester 2026-2027',
      expiresAt,
      reason: 'Initial beta room invitation for the assigned Professor.',
    }), {}, '', '', {}),
    /ADMIN_REQUIRED/,
  );
  assert.equal(denied.calls.length, 0);
});

test('Professor invitation ledger is Admin-only and never returns credentials', async () => {
  const activationId = '123e4567-e89b-42d3-a456-426614174011';
  const ledger = harness({
    rpc: async (name) => name === 'exam_room_admin_professor_activation_ledger'
      ? {
        ok: true,
        status: 'all',
        total: 1,
        limit: 200,
        offset: 0,
        activations: [{
          activationId,
          roomTitle: 'Civil Law Final Examination Room',
          schoolName: 'Due Diligence College of Law',
          academicTerm: 'First Semester 2026-2027',
          targetEmail: 'professor@example.edu',
          status: 'redeemed',
          createdAt: '2026-08-10T02:00:00Z',
          expiresAt: '2026-08-11T02:00:00Z',
          issuedByUserId: userId,
          issuedByEmail: 'admin@example.edu',
          redeemedByUserId: beadleId,
          redeemedByEmail: 'professor@example.edu',
          redeemedAt: '2026-08-10T02:10:00Z',
          failedAttempts: 0,
          classroomId: examId,
          tokenHash: 'must-not-project',
          activationKey: 'must-not-project',
          internalMetadata: { token: 'must-not-project' },
        }],
      }
      : { ok: true },
  });
  const response = await ledger.handlers.examQuery(request({
    operation: 'activation_ledger', status: 'all', limit: 200, offset: 0,
  }), {}, '', '');
  const payload = await response.json();
  const call = ledger.calls.at(-1);

  assert.equal(ledger.adminCalls.length, 1);
  assert.equal(call.name, 'exam_room_admin_professor_activation_ledger');
  assert.deepEqual(call.body, {
    p_actor_user_id: userId,
    p_status: 'all',
    p_limit: 200,
    p_offset: 0,
  });
  assert.equal(payload.result.offset, 0);
  assert.equal(payload.result.activations.length, 1);
  assert.equal(payload.result.activations[0].activationId, activationId);
  assert.equal(payload.result.activations[0].redeemedByEmail, 'professor@example.edu');
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);

  const denied = harness({
    adminError: new Error('ADMIN_REQUIRED'),
  });
  await assert.rejects(
    denied.handlers.examQuery(request({
      operation: 'activation_ledger', status: 'all', limit: 200, offset: 0,
    }), {}, '', ''),
    /ADMIN_REQUIRED/,
  );
  assert.equal(denied.calls.length, 0);
});

test('Admin revokes a room key idempotently without exposing invitation secrets', async () => {
  const activationId = '123e4567-e89b-42d3-a456-426614174011';
  const revoked = harness({
    rpc: async (name) => name === 'exam_room_admin_revoke_professor_activation'
      ? {
        ok: true,
        activationId,
        status: 'revoked',
        revokedAt: '2026-08-10T03:00:00Z',
        idempotent: false,
        tokenHash: 'must-not-project',
      }
      : { ok: true },
  });
  const response = await revoked.handlers.examCommand(request({
    operation: 'revoke_activation',
    activationId,
    reason: 'The room invitation was replaced before the Professor used it.',
    requestKey,
  }), {}, '', '', {});
  const payload = await response.json();
  const call = revoked.calls.at(-1);

  assert.equal(revoked.adminCalls.length, 1);
  assert.equal(call.name, 'exam_room_admin_revoke_professor_activation');
  assert.deepEqual(call.body, {
    p_actor_user_id: userId,
    p_activation_id: activationId,
    p_reason: 'The room invitation was replaced before the Professor used it.',
    p_request_key: requestKey,
  });
  assert.deepEqual(payload.result, {
    ok: true,
    activationId,
    status: 'revoked',
    revokedAt: '2026-08-10T03:00:00Z',
    idempotent: false,
  });
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
});

test('Professor redemption returns only the one room opened by the key', async () => {
  const activationKey = 'professor-room-key-plain-secret';
  const redeemed = harness({
    rpc: async (name) => name === 'exam_room_redeem_professor_activation'
      ? {
        ok: true,
        role: 'professor',
        activationId: operationId,
        classroomId: examId,
        roomTitle: 'Civil Law Final Examination Room',
        schoolName: 'Due Diligence College of Law',
        academicTerm: 'First Semester 2026-2027',
        status: 'redeemed',
        redeemedAt: '2026-08-10T02:10:00Z',
        tokenHash: 'must-not-project',
      }
      : { ok: true },
  });
  const response = await redeemed.handlers.examCommand(request({
    operation: 'redeem_activation', activationKey,
  }), {}, '', '', {});
  const call = redeemed.calls.at(-1);
  const payload = await response.json();

  assert.equal(redeemed.adminCalls.length, 0);
  assert.equal(call.name, 'exam_room_redeem_professor_activation');
  assert.match(call.body.p_token_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_rate_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(call.body).includes(activationKey), false);
  assert.equal(payload.result.classroomId, examId);
  assert.equal(payload.result.roomTitle, 'Civil Law Final Examination Room');
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);

  const failed = harness({
    rpc: async () => ({
      ok: false,
      code: 'PRIVATE_DATABASE_REASON',
      lockedUntil: '2026-08-10T02:15:00Z',
      tokenHash: 'must-not-project',
    }),
  });
  const failedResponse = await failed.handlers.examCommand(request({
    operation: 'redeem_activation', activationKey,
  }), {}, '', '', {});
  assert.deepEqual((await failedResponse.json()).result, {
    ok: false,
    code: 'ACTIVATION_UNAVAILABLE',
    lockedUntil: '2026-08-10T02:15:00Z',
  });
});

test('question upload authorizes ownership before decoding or parsing the source', async () => {
  const { handlers, calls, uploads } = harness({ access: { canUploadQuestions: false } });
  await assert.rejects(handlers.questionUpload(request({
    examId,
    questionCount: 1,
    fileName: 'questions.txt',
    mimeType: 'text/plain',
    base64: 'this-is-not-base64',
  }), {}, '', ''), (error) => error.code === 'EXAM_ROOM_PROFESSOR_REQUIRED');
  assert.equal(calls[0].name, 'exam_room_exam_access_v3');
  assert.equal(uploads.length, 0);
});

test('model-answer upload is unavailable before parsing, storage, or registration', async () => {
  const payload = {
    examId,
    fileName: 'model-answer.txt',
    mimeType: 'text/plain',
    base64: Buffer.from('Private model answer.').toString('base64'),
    requestKey,
  };
  const blocked = harness();
  await assert.rejects(
    blocked.handlers.modelAnswerUpload(request(payload), {}, '', ''),
    (error) => error.code === 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE'
      && error.status === 400
      && error.message === 'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.',
  );
  assert.equal(blocked.calls.length, 0);
  assert.equal(blocked.uploads.length, 0);
  assert.equal(blocked.deletions.length, 0);
});

test('v2 exam, preflight, Beadle, and incident queries use scoped database RPCs', async () => {
  const cases = [
    ['exam_intent', 'exam_room_exam_access_v3'],
    ['preflight', 'exam_room_student_waiting_room_v4'],
    ['beadle_portal', 'exam_room_beadle_portal_v5'],
    ['incident_summary', 'exam_room_incident_summary_v2'],
  ];
  for (const [operation, expectedRpc] of cases) {
    const { handlers, calls, rateModes } = harness();
    await handlers.examQuery(request({ operation, examId }), {}, '', '');
    assert.equal(calls.at(-1).name, expectedRpc);
    assert.equal(rateModes.at(-1), 'read');
  }
  const deviceInstanceHash = 'f'.repeat(64);
  const { handlers, calls } = harness();
  await handlers.examQuery(request({
    operation: 'preflight',
    examId,
    deviceInstanceHash,
    studentKey: 'student-exam-code-secret',
  }), {}, '', '');
  assert.equal(calls.at(-1).body.p_device_instance_hash, deviceInstanceHash);
  assert.match(calls.at(-1).body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.match(calls.at(-1).body.p_rate_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls.at(-1)).includes('student-exam-code-secret'), false);
});

test('Professor authoring snapshot is owner-scoped and defensively projected', async () => {
  const snapshot = harness({
    rpc: async (name) => name === 'exam_room_professor_authoring_snapshot_v2'
      ? {
        ok: true,
        examId,
        workspaceRevision: 7,
        status: 'confirmed',
        published: false,
        details: {
          title: 'Civil Law Final',
          instructions: 'Answer every question.',
          questionCount: 2,
          integrityPreset: 'standard',
          includeQuestionnaire: true,
          internalExamId: 'must-not-project',
        },
        questions: {
          questionVersionId: versionId,
          versionNumber: 2,
          sourceFileName: 'questions.docx',
          rows: [
            { questionId, ordinal: 1, prompt: 'Explain due process.', maximumPoints: 5, promptHash: 'must-not-project' },
          ],
          objectPath: 'must-not-project',
        },
        rulesDraft: {
          beadleEmail: 'beadle@example.edu',
          rules: { opensAt: '2026-08-11T01:00:00.000Z', studentAccessCodeRequired: true, secret: 'must-not-project' },
          rawCredential: 'must-not-project',
        },
        capabilities: {
          canEditDetails: true,
          canEditQuestions: true,
          canEditRules: true,
          canReschedulePublication: true,
          admin: true,
        },
        blockers: { rescheduleBlocker: null },
        handoff: { rosterCount: 10, studentAccessReady: false, rawCode: 'must-not-project' },
        storagePrefix: 'must-not-project',
      }
      : { ok: true },
  });
  const response = await snapshot.handlers.examQuery(request({
    operation: 'professor_authoring_snapshot', examId,
  }), {}, '', '');
  const payload = await response.json();
  const call = snapshot.calls.at(-1);
  assert.equal(call.name, 'exam_room_professor_authoring_snapshot_v2');
  assert.deepEqual(call.body, { p_professor_user_id: userId, p_exam_public_id: examId });
  assert.equal(payload.result.examId, examId);
  assert.equal(payload.result.workspaceRevision, 7);
  assert.equal(payload.result.details.title, 'Civil Law Final');
  assert.equal(payload.result.questions.rows[0].prompt, 'Explain due process.');
  assert.equal(payload.result.rulesDraft.beadleEmail, 'beadle@example.edu');
  assert.equal(payload.result.capabilities.canEditQuestions, true);
  assert.equal(payload.result.capabilities.canReschedulePublication, true);
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
});

test('Professor schedule correction binds the current publication and preserves only safe result fields', async () => {
  const opensAt = new Date(Date.now() + 90 * 60 * 1_000).toISOString();
  const hardClosesAt = new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString();
  const flow = harness({ result: {
    ok: true,
    examId,
    publicationId: versionId,
    publicationNumber: 2,
    workspaceRevision: 9,
    opensAt,
    hardClosesAt,
    durationMinutes: 120,
    lateAdmissionMinutes: 15,
    submissionGraceMinutes: 5,
    preserved: {
      questions: true,
      classList: true,
      beadleAccess: true,
      studentExamCode: true,
      gradingAccess: true,
      tokenHash: 'must-not-project',
    },
    backupOutboxId: 'must-not-project',
  } });
  const response = await flow.handlers.examCommand(request({
    operation: 'reschedule_publication',
    examId,
    expectedPublicationId: publicationId,
    expectedWorkspaceRevision: 8,
    opensAt,
    hardClosesAt,
    durationMinutes: 120,
    lateAdmissionMinutes: 15,
    submissionGraceMinutes: 5,
    reason: 'The class needs a corrected examination schedule.',
    requestKey,
  }), {}, '', '', {});
  const payload = await response.json();
  const call = flow.calls.at(-1);
  assert.equal(call.name, 'exam_room_reschedule_publication_v1');
  assert.deepEqual(call.body, {
    p_professor_user_id: userId,
    p_exam_public_id: examId,
    p_expected_publication_id: publicationId,
    p_expected_workspace_revision: 8,
    p_opens_at: opensAt,
    p_hard_closes_at: hardClosesAt,
    p_duration_minutes: 120,
    p_late_admission_minutes: 15,
    p_submission_grace_minutes: 5,
    p_reason: 'The class needs a corrected examination schedule.',
    p_request_key: requestKey,
  });
  assert.equal(payload.result.publicationId, versionId);
  assert.equal(payload.result.preserved.studentExamCode, true);
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
});

test('Professor revision and Beadle roster-reopen commands use exact scoped RPCs', async () => {
  const base = { examId, expectedRevision: 4, requestKey };
  const cases = [
    [{
      operation: 'update_exam_details',
      ...base,
      title: 'Revised Civil Law Final',
      instructions: 'Answer every question.',
      questionCount: 2,
      integrityPreset: 'standard',
      includeQuestionnaire: true,
    }, 'exam_room_update_details_v1'],
    [{
      operation: 'revise_draft_questions',
      ...base,
      expectedQuestionVersionId: versionId,
      questions: [
        { ordinal: 1, prompt: 'Question one', maximumPoints: 5 },
        { ordinal: 2, prompt: 'Question two', maximumPoints: 5 },
      ],
    }, 'exam_room_revise_draft_questions_v1'],
    [{
      operation: 'save_rules_draft',
      ...base,
      beadleEmail: 'beadle@example.edu',
      rules: {
        opensAt: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
        hardClosesAt: new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString(),
        durationMinutes: 120,
        studentAccessCodeRequired: true,
      },
    }, 'exam_room_save_rules_draft_v1'],
    [{
      operation: 'reopen_exam_roster',
      examId,
      reason: 'Correct the official class list before opening.',
      requestKey,
    }, 'exam_room_reopen_roster_v1'],
  ];
  for (const [body, expectedRpc] of cases) {
    const flow = harness({ result: {
      ok: true, examId, status: 'confirmed', workspaceRevision: 5,
      internalExamId: 'must-not-project', tokenHash: 'must-not-project',
    } });
    const response = await flow.handlers.examCommand(request(body), {}, '', '', {});
    const payload = await response.json();
    const call = flow.calls.at(-1);
    assert.equal(call.name, expectedRpc);
    assert.equal(call.body.p_exam_public_id, examId);
    assert.equal(payload.result.examId, examId);
    assert.equal(payload.result.workspaceRevision, 5);
    assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
  }
});

test('the scoped Beadle portal decrypts only the active envelope and never projects its internals', async () => {
  const studentKey = 'student-exam-access-code-secret';
  const tokenHash = await sha256Hex(studentKey);
  const envelope = await encryptStudentExamCode(v2Env, { examId, tokenHash, studentKey });
  const flow = harness({
    rpc: async (name) => name === 'exam_room_beadle_portal_v5'
      ? {
        ok: true,
        examId,
        studentAccessReady: true,
        studentCodeRecoverable: true,
        activeStudentCodeEnvelope: { examId, tokenHash, ...envelope },
      }
      : { ok: true },
  });
  const response = await flow.handlers.examQuery(request({
    operation: 'beadle_portal', examId,
  }), {}, '', '');
  const payload = await response.json();
  assert.equal(flow.calls.at(-1).name, 'exam_room_beadle_portal_v5');
  assert.equal(payload.result.activeStudentExamCode, studentKey);
  assert.equal(payload.result.studentCodeRecoverable, true);
  assert.equal(payload.result.activeStudentCodeEnvelope, undefined);
  assert.equal(JSON.stringify(payload).includes(envelope.ciphertext), false);
  assert.equal(JSON.stringify(payload).includes(tokenHash), false);
});

test('a legacy hash-only active code remains valid but is explicitly non-recoverable', async () => {
  const flow = harness({
    rpc: async (name) => name === 'exam_room_beadle_portal_v5'
      ? {
        ok: true,
        examId,
        studentAccessReady: true,
        studentCodeRecoverable: false,
        activeStudentCodeEnvelope: null,
      }
      : { ok: true },
  });
  const response = await flow.handlers.examQuery(request({
    operation: 'beadle_portal', examId,
  }), {}, '', '');
  const payload = await response.json();
  assert.equal(payload.result.activeStudentExamCode, null);
  assert.equal(payload.result.studentCodeRecoverable, false);
  assert.equal(payload.result.studentCodeRecoveryCode, 'LEGACY_STUDENT_CODE_NOT_RECOVERABLE');
});

test('Beadle recovery fails closed without its key while the rest of the portal remains usable', async () => {
  const studentKey = 'student-exam-access-code-secret';
  const tokenHash = await sha256Hex(studentKey);
  const envelope = await encryptStudentExamCode(v2Env, { examId, tokenHash, studentKey });
  const flow = harness({
    rpc: async (name) => name === 'exam_room_beadle_portal_v5'
      ? {
        ok: true,
        examId,
        title: 'Civil Law Final',
        studentAccessReady: true,
        studentCodeRecoverable: true,
        activeStudentCodeEnvelope: { examId, tokenHash, ...envelope },
      }
      : { ok: true },
  });
  const response = await flow.rawHandlers.examQuery(request({
    operation: 'beadle_portal', examId,
  }), {
    EXAMINATION_ROOM_ENABLED: 'true',
    EXAMINATION_ROOM_2_ENABLED: 'true',
    EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v1',
  }, '', '');
  const payload = await response.json();
  assert.equal(payload.result.title, 'Civil Law Final');
  assert.equal(payload.result.activeStudentExamCode, null);
  assert.equal(payload.result.studentCodeRecoverable, false);
  assert.equal(payload.result.studentCodeRecoveryCode, 'STUDENT_CODE_KEY_UNAVAILABLE');
  assert.equal(JSON.stringify(payload).includes(envelope.ciphertext), false);
});

test('grading model-answer query is credentialed and projects only safe owner-grading fields', async () => {
  const gradingKey = 'professor-grading-key-secret';
  const privatePath = `${examId}/model-answers/${'a'.repeat(64)}/answer.txt`;
  const pasted = harness({
    rpc: async (name) => name === 'exam_room_grading_model_answer_v2'
      ? {
        ok: true,
        examId,
        available: true,
        mode: 'paste',
        answerText: 'Private professor model answer.',
        contentHash: 'b'.repeat(64),
        objectPath: privatePath,
        sourceId: operationId,
      }
      : { ok: true },
  });
  const pasteResponse = await pasted.handlers.examQuery(request({
    operation: 'grading_model_answer', examId, gradingKey,
  }), {}, '', '');
  const pastePayload = await pasteResponse.json();
  const call = pasted.calls.at(-1);
  assert.equal(call.name, 'exam_room_grading_model_answer_v2');
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(call.body).includes(gradingKey), false);
  assert.deepEqual(pastePayload.result, {
    ok: true,
    examId,
    available: true,
    mode: 'paste',
    answerText: 'Private professor model answer.',
    contentHash: 'b'.repeat(64),
  });
  assert.equal(JSON.stringify(pastePayload).includes(privatePath), false);

  const uploaded = harness({
    rpc: async (name) => name === 'exam_room_grading_model_answer_v2'
      ? {
        ok: true,
        available: false,
        mode: 'upload',
        code: 'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
        safeFileName: 'answer.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        contentHash: 'c'.repeat(64),
        objectPath: privatePath,
      }
      : { ok: true },
  });
  const uploadResponse = await uploaded.handlers.examQuery(request({
    operation: 'grading_model_answer', examId, gradingKey,
  }), {}, '', '');
  const uploadPayload = await uploadResponse.json();
  assert.deepEqual(uploadPayload.result, {
    ok: true,
    examId,
    available: false,
    mode: 'upload',
    code: 'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
    safeFileName: 'answer.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    contentHash: 'c'.repeat(64),
  });
  assert.equal(JSON.stringify(uploadPayload).includes(privatePath), false);
});

test('v2 owner monitor is grading-key authenticated and projects bounded reopen eligibility only', async () => {
  const gradingKey = 'professor-grading-key-secret';
  const candidateNumber = '0007';
  const monitor = harness({
    rpc: async (name) => name === 'exam_room_live_status_v2'
      ? {
        ok: true,
        examId,
        title: 'Civil Law Final',
        status: 'closed',
        opensAt: '2026-08-10T01:00:00Z',
        hardClosesAt: '2026-08-10T04:00:00Z',
        serverNow: '2026-08-10T04:15:00Z',
        reopenMaximumMinutes: 240,
        accessCodeRequired: false,
        candidates: [{
          candidateNumber,
          attemptId,
          state: 'submitted',
          startedAt: '2026-08-10T01:00:00Z',
          serverDeadline: '2026-08-10T04:00:00Z',
          submittedAt: '2026-08-10T03:59:00Z',
          generation: 1,
          latestReceiptId: operationId,
          priorReceiptId: null,
          activeReopeningId: null,
          canReopenSubmission: true,
          reopenBlockedReason: null,
          answerSnapshot: 'must-not-project',
          email: 'must-not-project',
        }],
        answers: 'must-not-project',
      }
      : { ok: true },
  });
  const response = await monitor.handlers.examQuery(request({
    operation: 'live_status_v2', examId, gradingKey,
  }), {}, '', '');
  const payload = await response.json();
  const call = monitor.calls.at(-1);
  assert.equal(call.name, 'exam_room_live_status_v2');
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_rate_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(call.body).includes(gradingKey), false);
  assert.equal(payload.result.candidates[0].canReopenSubmission, true);
  assert.equal(payload.result.candidates[0].generation, 1);
  assert.equal(payload.result.accessCodeRequired, false);
  assert.equal(JSON.stringify(payload).includes('must-not-project'), false);
});

test('legacy portal merges safe Beadle assignments for the role landing page', async () => {
  const assignment = {
    examId,
    title: 'Civil Law Final',
    status: 'scheduled',
    role: 'beadle',
  };
  const { handlers, calls } = harness({
    rpc: async (name) => {
      if (name === 'exam_room_portal_snapshot') {
        return { roles: { student: true }, classes: [], studentExams: [] };
      }
      if (name === 'exam_room_beadle_portal_v3') {
        return { ok: true, assignments: [assignment], canViewAnswers: false };
      }
      return { ok: true };
    },
  });
  const response = await handlers.examQuery(request({ operation: 'portal' }), {}, '', '');
  const payload = await response.json();
  assert.deepEqual(calls.map((entry) => entry.name), [
    'exam_room_portal_snapshot',
    'exam_room_beadle_portal_v3',
  ]);
  assert.equal(payload.result.roles.beadle, true);
  assert.deepEqual(payload.result.beadleExams, [assignment]);
  assert.deepEqual(payload.result.beadleAssignments, [assignment]);
});

test('attempt query never exposes an already-active device session credential', async () => {
  const { handlers, calls } = harness({
    rpc: async (name) => ['exam_room_attempt_view', 'exam_room_attempt_view_v2'].includes(name)
      ? {
        ok: true,
        attemptId,
        examId,
        examVersionId: versionId,
        sessionId,
        sessionEpoch: 7,
        questions: [],
      }
      : { ok: true },
  });
  const response = await handlers.examQuery(request({
    operation: 'attempt', attemptId,
  }), {}, '', '');
  const payload = await response.json();
  assert.equal(payload.result.sessionId, undefined);
  assert.equal(payload.result.sessionEpoch, undefined);
  assert.equal(payload.result.sessionRequired, true);
  assert.equal(payload.result.attemptId, attemptId);

  const scoped = await handlers.examQuery(request({
    operation: 'attempt', attemptId, sessionId, sessionEpoch: 7,
  }), {}, '', '');
  const scopedPayload = await scoped.json();
  assert.equal(calls.at(-1).name, 'exam_room_attempt_view_v2');
  assert.equal(calls.at(-1).body.p_session_public_id, sessionId);
  assert.equal(calls.at(-1).body.p_session_epoch, 7);
  assert.equal(scopedPayload.result.sessionId, undefined);
  assert.equal(scopedPayload.result.sessionEpoch, undefined);
});

test('submitted candidates can retrieve a minimal receipt status without answer content', async () => {
  const receipt = {
    ok: true,
    attemptId,
    examId,
    examVersionId: versionId,
    status: 'submitted',
    submittedAt: '2026-08-09T04:00:00Z',
    generation: 1,
    receiptId: operationId,
    receivedAt: '2026-08-09T04:00:00Z',
    snapshotHash: 'a'.repeat(64),
    answerSetHash: 'b'.repeat(64),
    lateRecoveryEvidenceCount: 1,
    serverNow: '2026-08-09T04:01:00Z',
  };
  const { handlers, calls } = harness({
    rpc: async (name) => name === 'exam_room_submission_status_v2' ? receipt : { ok: true },
  });
  const response = await handlers.examQuery(request({
    operation: 'submission_status', attemptId,
  }), {}, '', '');
  const payload = await response.json();
  assert.equal(calls.at(-1).name, 'exam_room_submission_status_v2');
  assert.deepEqual(payload.result, receipt);
  assert.equal('questions' in payload.result, false);
  assert.equal('answers' in payload.result, false);
});

test('feature snapshot exposes the effective fail-closed Examination Room 2.0 flag', async () => {
  const disabled = harness();
  const disabledResponse = await disabled.rawHandlers.features(
    request({}),
    {},
    '',
    '',
  );
  const disabledPayload = await disabledResponse.json();
  assert.equal(disabledPayload.flags.EXAMINATION_ROOM_ENABLED, true);
  assert.equal(disabledPayload.flags.EXAMINATION_ROOM_2_ENABLED, false);

  const enabled = harness();
  const enabledResponse = await enabled.rawHandlers.features(request({}), v2Env, '', '');
  const enabledPayload = await enabledResponse.json();
  assert.equal(enabledPayload.flags.EXAMINATION_ROOM_ENABLED, true);
  assert.equal(enabledPayload.flags.EXAMINATION_ROOM_2_ENABLED, true);

  const baseDisabled = harness();
  const baseDisabledResponse = await baseDisabled.rawHandlers.features(request({}), {
    EXAMINATION_ROOM_ENABLED: 'false',
    EXAMINATION_ROOM_2_ENABLED: 'true',
  }, '', '');
  const baseDisabledPayload = await baseDisabledResponse.json();
  assert.equal(baseDisabledPayload.flags.EXAMINATION_ROOM_ENABLED, false);
  assert.equal(baseDisabledPayload.flags.EXAMINATION_ROOM_2_ENABLED, false);
});

test('v2 operations and exam-scoped uploads require both rollout flags', async () => {
  const legacyOnlyEnv = { EXAMINATION_ROOM_ENABLED: 'true' };
  const blocked = harness();
  await assert.rejects(
    blocked.rawHandlers.examQuery(request({ operation: 'preflight', examId }), {
      EXAMINATION_ROOM_ENABLED: 'false',
      EXAMINATION_ROOM_2_ENABLED: 'true',
    }, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_DISABLED' && error.status === 404,
  );
  await assert.rejects(
    blocked.rawHandlers.examQuery(request({ operation: 'preflight', examId }), legacyOnlyEnv, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED' && error.status === 404,
  );
  await assert.rejects(
    blocked.rawHandlers.examQuery(request({
      operation: 'live_status_v2', examId, gradingKey: 'professor-grading-key-secret',
    }), legacyOnlyEnv, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED' && error.status === 404,
  );
  await assert.rejects(
    blocked.rawHandlers.examCommand(request({
      operation: 'publish_exam',
      examId,
      requestKey,
      rules: {
        opensAt: '2026-08-10T01:00:00Z',
        hardClosesAt: '2026-08-10T04:00:00Z',
      },
    }), legacyOnlyEnv, '', '', {}),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED',
  );
  await assert.rejects(
    blocked.rawHandlers.questionUpload(request({
      examId,
      questionCount: 1,
      fileName: 'questions.txt',
      mimeType: 'text/plain',
      base64: Buffer.from('Question 1. Explain due process.').toString('base64'),
    }), legacyOnlyEnv, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED',
  );
  await assert.rejects(
    blocked.rawHandlers.rosterUpload(request({
      examId,
      fileName: 'roster.csv',
      mimeType: 'text/csv',
      base64: Buffer.from('Email,Student Number,Candidate Number\nana@example.edu,01,001\n').toString('base64'),
    }), legacyOnlyEnv, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED',
  );
  assert.equal(blocked.calls.length, 0);
  assert.equal(blocked.uploads.length, 0);
  assert.equal(blocked.rateModes.length, 0);
});

test('legacy portal remains available while free classroom creation fails closed', async () => {
  const legacyOnlyEnv = { EXAMINATION_ROOM_ENABLED: 'true' };
  const legacy = harness({
    rpc: async (name) => name === 'exam_room_portal_snapshot'
      ? { roles: { professor: true }, classes: [] }
      : { ok: true },
  });
  const response = await legacy.rawHandlers.examQuery(
    request({ operation: 'portal' }),
    legacyOnlyEnv,
    '',
    '',
  );
  const payload = await response.json();
  assert.equal(payload.result.roles.professor, true);
  assert.deepEqual(legacy.calls.map((entry) => entry.name), ['exam_room_portal_snapshot']);

  await assert.rejects(
    legacy.rawHandlers.examCommand(request({
      operation: 'create_classroom',
      title: 'Legacy Evidence Class',
      schoolName: 'Legacy School',
      academicTerm: 'First Semester',
    }), legacyOnlyEnv, '', '', {}),
    (error) => error.code === 'EXAMINATION_ROOM_2_DISABLED' && error.status === 404,
  );
  await assert.rejects(
    legacy.rawHandlers.examCommand(request({
      operation: 'create_classroom',
      title: 'Legacy Evidence Class',
      schoolName: 'Legacy School',
      academicTerm: 'First Semester',
    }), v2Env, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_ROOM_KEY_REQUIRED' && error.status === 403,
  );
  assert.equal(legacy.calls.length, 1);
});

test('production and staging explicitly enable the owner-approved beta-wide release', () => {
  const production = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const staging = readFileSync(new URL('./wrangler.staging.toml', import.meta.url), 'utf8');
  assert.match(production, /^EXAMINATION_ROOM_2_ENABLED = "true"$/m);
  assert.match(staging, /^EXAMINATION_ROOM_2_ENABLED = "true"$/m);
});

test('retired broad dispute operations fail closed before any database RPC', async () => {
  const disputeId = versionId;
  const disputeKey = 'separate-dispute-review-secret';
  const queryHarness = harness();
  await assert.rejects(
    queryHarness.handlers.examQuery(request({
      operation: 'dispute_view', disputeId, disputeKey,
    }), {}, '', ''),
    (error) => error.code === 'EXAM_ROOM_DISPUTE_UNAVAILABLE' && error.status === 403,
  );
  assert.equal(queryHarness.calls.length, 0);

  const commandHarness = harness();
  await assert.rejects(
    commandHarness.handlers.examCommand(request({
      operation: 'open_dispute',
      examId,
      caseReference: 'CASE-2026-001',
      reason: 'Authorized dispute evidence review requested.',
      accessMode: 'read_only',
      disputeKey,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_DISPUTE_UNAVAILABLE',
  );
  await assert.rejects(
    commandHarness.handlers.examCommand(request({
      operation: 'admin_correct_grade',
      disputeId,
      attemptId,
      questionId,
      score: 10,
      comment: 'Reviewed correction.',
      reason: 'Correction supported by the sealed evidence.',
      disputeKey,
    }), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_DISPUTE_UNAVAILABLE',
  );
  await assert.rejects(
    commandHarness.handlers.examCommand(request({
      operation: 'close_dispute',
      disputeId,
      reason: 'Closed because broad dispute access is retired.',
    }), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_DISPUTE_UNAVAILABLE',
  );
  assert.equal(commandHarness.calls.length, 0);
});

test('server-side Examination Room feature flag blocks queries and mutations before authorization', async () => {
  const { handlers, calls } = harness();
  await assert.rejects(
    handlers.examQuery(request({ operation: 'portal' }), {
      EXAMINATION_ROOM_ENABLED: 'false',
    }, '', ''),
    (error) => error.code === 'EXAMINATION_ROOM_DISABLED' && error.status === 404,
  );
  await assert.rejects(
    handlers.examCommand(request({
      operation: 'start_attempt',
      examId,
      studentKey: 'student-access-key',
    }), { EXAMINATION_ROOM_ENABLED: 'false' }, '', '', {}),
    (error) => error.code === 'EXAMINATION_ROOM_DISABLED',
  );
  assert.equal(calls.length, 0);
});

test('exam-scoped roster upload authorizes before parsing and uses the Beadle-safe validator', async () => {
  const invalid = harness({ access: { canManageRoster: false } });
  await assert.rejects(invalid.handlers.rosterUpload(request({
    examId,
    fileName: 'exam.csv',
    mimeType: 'text/csv',
    base64: 'not-valid-base64',
  }), {}, '', ''), (error) => error.code === 'EXAM_ROOM_OPERATOR_REQUIRED');
  assert.deepEqual(invalid.calls.map((entry) => entry.name), ['exam_room_exam_access_v3']);

  const csv = 'Email,Student Number,Candidate Number\nana@example.edu,000012,0007\n';
  const valid = harness({
    access: { canManageRoster: true },
    rpc: async () => ({ ok: true, errors: [], warnings: [] }),
  });
  const response = await valid.handlers.rosterUpload(request({
    examId,
    fileName: 'exam.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  }), {}, '', '');
  assert.equal(response.status, 200);
  const validation = valid.calls.find(
    (entry) => entry.name === 'exam_room_validate_exam_roster_v2',
  );
  assert.equal(validation.body.p_actor_user_id, userId);
  assert.equal(validation.body.p_exam_public_id, examId);
  assert.equal(validation.body.p_rows[0].candidateNumber, '0007');

  const rowError = harness({
    access: { canManageRoster: true },
    rpc: async () => ({
      ok: false,
      errors: [{ row: 1, field: 'email', code: 'DUPLICATE_EMAIL' }],
      warnings: [],
    }),
  });
  const editableResponse = await rowError.handlers.rosterUpload(request({
    examId,
    fileName: 'exam.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  }), {}, '', '');
  const editablePayload = await editableResponse.json();
  assert.equal(editableResponse.status, 200);
  assert.equal(editablePayload.ok, true);
  assert.equal(editablePayload.validation.ok, false);
  assert.equal(editablePayload.validation.errors[0].field, 'email');
});

test('legacy classroom roster upload also proves professor ownership before XLSX or CSV parsing', async () => {
  const denied = harness({ rpc: async () => ({ roles: { professor: false }, classes: [] }) });
  await assert.rejects(denied.handlers.rosterUpload(request({
    classroomId: versionId,
    fileName: 'class.csv',
    mimeType: 'text/csv',
    base64: 'not-valid-base64',
  }), {}, '', ''), (error) => error.code === 'EXAM_ROOM_PROFESSOR_REQUIRED');
  assert.deepEqual(denied.calls.map((entry) => entry.name), ['exam_room_portal_snapshot']);

  const csv = 'Email,Student Number,Candidate Number\nana@example.edu,000012,0007\n';
  const allowed = harness({
    rpc: async (name) => name === 'exam_room_portal_snapshot'
      ? { roles: { professor: true }, classes: [{ classroomId: versionId }] }
      : { ok: true, errors: [], warnings: [] },
  });
  const response = await allowed.handlers.rosterUpload(request({
    classroomId: versionId,
    fileName: 'class.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  }), {}, '', '');
  assert.equal(response.status, 200);
  assert.deepEqual(allowed.calls.map((entry) => entry.name), [
    'exam_room_portal_snapshot',
    'exam_room_validate_roster',
  ]);
});

test('exam-scoped roster commands map validation, import, and single-row correction RPCs', async () => {
  const row = {
    email: 'ana@example.edu',
    studentNumber: '000012',
    candidateNumber: '0007',
  };
  const { handlers, calls } = harness();
  await handlers.examCommand(request({
    operation: 'validate_exam_roster', examId, rows: [row],
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'import_exam_roster', examId, rows: [row],
    requestKey, sourceHash: 'd'.repeat(64),
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'upsert_exam_roster_row', examId, row,
    reason: 'Corrected candidate assignment.', requestKey,
  }), {}, '', '', {});
  assert.deepEqual(calls.map((entry) => entry.name), [
    'exam_room_validate_exam_roster_v2',
    'exam_room_import_exam_roster_v2',
    'exam_room_upsert_roster_row_v2',
  ]);
  assert.equal(calls[2].body.p_row.displayName, null);
});

test('Beadle invitation and revocation credentials are server-hashed and account scoped', async () => {
  const invitationKey = 'beadle-invitation-key-secret';
  const { handlers, calls } = harness();
  await handlers.examCommand(request({
    operation: 'invite_beadle',
    examId,
    targetEmail: 'beadle@example.edu',
    invitationKey,
    expiresAt: '2026-08-10T10:00:00Z',
    reason: 'Class examination logistics.',
    requestKey,
  }), {}, '', '', {});
  const invitation = calls.find((entry) => entry.name === 'exam_room_issue_beadle_invitation_v2');
  assert.equal(JSON.stringify(invitation.body).includes(invitationKey), false);
  assert.match(invitation.body.p_token_hash, /^[0-9a-f]{64}$/);

  await handlers.examCommand(request({
    operation: 'revoke_beadle',
    examId,
    beadleUserId: beadleId,
    reason: 'Delegation ended after roster preparation.',
    requestKey,
  }), {}, '', '', {});
  const revoke = calls.find((entry) => entry.name === 'exam_room_revoke_beadle_assignment_v2');
  assert.equal(revoke.body.p_beadle_user_id, beadleId);
});

test('publication completion returns only the new one-time Beadle key and defers student access', async () => {
  const beadleInvitationKey = 'beadle-invitation-key-secret';
  const gradingKey = 'professor-grading-key-secret';
  const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString();
  const flow = harness({
    result: {
      ok: true,
      examId,
      status: 'published_for_class_preparation',
      studentAccessReady: false,
    },
  });
  const response = await flow.handlers.examCommand(request({
    operation: 'publish_for_beadle',
    examId,
    expectedRevision: 7,
    gradingKey,
    beadleEmail: 'Beadle@Example.edu',
    beadleInvitationKey,
    beadleExpiresAt: expiresAt,
    reason: 'Prepare and confirm the official class roster.',
    requestKey,
    rules: {
      opensAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString(),
      hardClosesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000 + 2 * 60 * 60 * 1_000).toISOString(),
      durationMinutes: 120,
      studentAccessCodeRequired: true,
    },
  }), {}, '', '', {});
  const payload = await response.json();
  const call = flow.calls.at(-1);
  assert.equal(call.name, 'exam_room_publish_for_beadle_v4');
  assert.equal(call.body.p_expected_revision, 7);
  assert.equal(call.body.p_beadle_email, 'beadle@example.edu');
  assert.match(call.body.p_beadle_token_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(call.body.p_beadle_token_hash, call.body.p_grading_key_hash);
  assert.equal(JSON.stringify(call.body).includes(beadleInvitationKey), false);
  assert.equal(JSON.stringify(call.body).includes(gradingKey), false);
  assert.equal(payload.result.oneTimeBeadleKey, beadleInvitationKey);
  assert.equal(payload.result.oneTimeOnly, true);
  assert.equal(payload.result.studentAccessReady, false);
});

test('assigned Beadle issues an encrypted-at-rest student code recoverable on refresh', async () => {
  const studentKey = 'student-exam-access-code-secret';
  const flow = harness({
    result: {
      ok: true,
      examId,
      issued: true,
      rotated: false,
      studentAccessReady: true,
      rosterLocked: true,
    },
  });
  const response = await flow.handlers.examCommand(request({
    operation: 'issue_student_access',
    examId,
    studentKey,
    requestKey,
  }), {}, '', '', {});
  const payload = await response.json();
  const call = flow.calls.at(-1);
  assert.equal(call.name, 'exam_room_issue_student_access_v4');
  assert.equal(call.body.p_beadle_user_id, userId);
  assert.match(call.body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(call.body.p_code_algorithm, 'A256GCM');
  assert.equal(call.body.p_code_key_id, 'v1');
  assert.match(call.body.p_code_nonce, /^[A-Za-z0-9_-]{16}$/);
  assert.match(call.body.p_code_ciphertext, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(call.body).includes(studentKey), false);
  assert.equal(payload.result.oneTimeStudentAccessCode, studentKey);
  assert.equal(payload.result.activeStudentExamCode, studentKey);
  assert.equal(payload.result.oneTimeOnly, false);
  assert.equal(payload.result.studentCodeRecoverable, true);
  assert.equal(payload.result.rosterLocked, true);
});

test('student code issuance fails before its database mutation when the envelope key is absent', async () => {
  const flow = harness();
  await assert.rejects(flow.rawHandlers.examCommand(request({
    operation: 'issue_student_access',
    examId,
    studentKey: 'student-exam-access-code-secret',
    requestKey,
  }), {
    EXAMINATION_ROOM_ENABLED: 'true',
    EXAMINATION_ROOM_2_ENABLED: 'true',
    EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v1',
  }, '', '', {}), (error) => (
    error.code === 'EXAM_ROOM_STUDENT_CODE_RECOVERY_UNAVAILABLE'
      && error.status === 503
  ));
  assert.equal(flow.calls.length, 0);
});

test('Professor result PDF is private, candidate-scoped, and has no release side effect', async () => {
  const gradingKey = 'professor-grading-key-secret';
  const exportId = '123e4567-e89b-42d3-a456-426614174012';
  const flow = harness({
    rpc: async (name, body) => {
      if (name === 'exam_room_prepare_result_export_v3') {
        return {
          ok: true,
          exportId,
          examId,
          examTitle: 'Civil Law Final Examination',
          candidateNumber: '0012',
          scope: body.p_export_scope,
          submittedAt: '2026-08-10T04:00:00Z',
          generatedAt: '2026-08-10T05:00:00Z',
          questionCount: 1,
          questions: [{
            ordinal: 1,
            score: 8,
            maximumPoints: 10,
            comment: 'Apply the controlling rule before the conclusion.',
          }],
          totals: { score: 8, maximumPoints: 10 },
        };
      }
      if (name === 'exam_room_complete_result_export_v3') {
        return { ok: true, exportId, completed: true, outputBytes: body.p_output_bytes };
      }
      return { ok: true };
    },
  });
  const response = await flow.handlers.examResultPdf(request({
    examId,
    attemptId,
    scope: 'grades_comments',
    gradingKey,
    requestKey,
  }), {}, '', '');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.match(response.headers.get('Content-Disposition'), /grades-comments\.pdf"$/);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '%PDF');
  assert.deepEqual(flow.calls.map((entry) => entry.name), [
    'exam_room_prepare_result_export_v3',
    'exam_room_complete_result_export_v3',
  ]);
  assert.match(flow.calls[0].body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.match(flow.calls[1].body.p_output_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(flow.calls).includes(gradingKey), false);
  assert.equal(flow.calls.some((entry) => entry.name === 'exam_room_release_results'), false);
});

test('answer operation verifies content hash at the edge and forwards journal concurrency fields', async () => {
  const answerText = 'Stonehill requires particularity.';
  const contentHash = await sha256Hex(answerText);
  const { handlers, calls, rateModes } = harness();
  const payload = {
    operation: 'save_answer_operation',
    operationId,
    examId,
    examVersionId: versionId,
    attemptId,
    sessionId,
    sessionEpoch: 3,
    questionId,
    localSequence: 9,
    expectedRevision: 2,
    answerText,
    contentHash,
    clientSavedAt: '2026-08-09T02:00:00Z',
    outageEvidence: { clientReportedOffline: true, offlineSeconds: 30 },
  };
  await handlers.examCommand(request(payload), {}, '', '', {});
  const save = calls.find((entry) => entry.name === 'exam_room_save_answer_operation_v2');
  assert.deepEqual({
    operationId: save.body.p_operation_id,
    epoch: save.body.p_session_epoch,
    sequence: save.body.p_local_sequence,
    revision: save.body.p_base_revision,
    hash: save.body.p_content_hash,
    outageEvidence: save.body.p_outage_evidence,
  }, {
    operationId,
    epoch: 3,
    sequence: 9,
    revision: 2,
    hash: contentHash,
    outageEvidence: { clientReportedOffline: true, offlineSeconds: 30 },
  });
  assert.equal(rateModes.at(-1), 'sync');

  const invalid = harness();
  await assert.rejects(
    invalid.handlers.examCommand(request({ ...payload, contentHash: 'a'.repeat(64) }), {}, '', '', {}),
    (error) => error.code === 'ANSWER_HASH_MISMATCH',
  );
  assert.equal(invalid.calls.some((entry) => entry.name === 'exam_room_save_answer_operation_v2'), false);
});

test('v2 heartbeat is bound to the active session epoch while legacy routing remains available', async () => {
  const { handlers, calls } = harness();
  await handlers.examCommand(request({
    operation: 'heartbeat_v2', attemptId, sessionId, sessionEpoch: 8,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'heartbeat', attemptId,
  }), {}, '', '', {});
  assert.deepEqual(calls.map((entry) => entry.name), [
    'exam_room_heartbeat_v2',
    'exam_room_heartbeat',
  ]);
  assert.equal(calls[0].body.p_session_public_id, sessionId);
  assert.equal(calls[0].body.p_session_epoch, 8);
});

test('publication, admission, accommodation, and verification map to fail-closed v2 RPCs', async () => {
  const { handlers, calls } = harness();
  await handlers.examCommand(request({
    operation: 'publish_exam',
    examId,
    studentKey: 'student-access-code-secret',
    requestKey,
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      durationMinutes: 120,
      admissionMode: 'beadle_approval',
    },
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'set_candidate_admission',
    examId,
    candidateNumber: '0007',
    decision: 'admit',
    reason: 'Physical verification completed.',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'set_accommodation',
    examId,
    candidateNumber: '0007',
    accommodation: { extraMinutes: 30, assistiveTechnology: true },
    reason: 'Approved examination accommodation.',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'record_candidate_verification',
    examId,
    candidateNumber: '0007',
    method: 'physical',
    outcome: 'verified',
    note: '',
    requestKey,
  }), {}, '', '', {});
  assert.deepEqual(calls.filter((entry) => entry.name.endsWith('_v2')).map((entry) => entry.name), [
    'exam_room_publish_exam_v2',
    'exam_room_admit_candidate_v2',
    'exam_room_set_accommodation_v2',
    'exam_room_record_verification_v2',
  ]);
  assert.match(calls[0].body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls[0].body).includes('student-access-code-secret'), false);
});

test('one-way navigation is rejected before publication reaches storage', async () => {
  const { handlers, calls, rateModes } = harness();
  await assert.rejects(
    handlers.examCommand(request({
      operation: 'publish_exam',
      examId,
      requestKey,
      rules: {
        opensAt: '2026-08-10T01:00:00Z',
        hardClosesAt: '2026-08-10T04:00:00Z',
        durationMinutes: 120,
        navigationMode: 'one_way',
      },
    }), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE'
      && error.status === 400,
  );
  assert.equal(calls.length, 0);
  assert.equal(rateModes.length, 0);
});

test('submission generation, operator transfer, erratum, leave, and incidents use stable v2 contracts', async () => {
  const { handlers, calls } = harness();
  await handlers.examCommand(request({
    operation: 'submit_attempt_generation',
    attemptId,
    sessionId,
    sessionEpoch: 2,
    answerSetHash: 'b'.repeat(64),
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'transfer_session',
    attemptId,
    expectedEpoch: 2,
    deviceInstanceHash: 'c'.repeat(64),
    reason: 'Beadle approved transfer after physical verification.',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'issue_erratum',
    examId,
    erratumType: 'clarification',
    body: 'In Question 1, read 2025 as 2026.',
    affectedQuestionIds: [questionId],
    effectiveAt: '2026-08-09T03:00:00Z',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'start_leave',
    attemptId,
    sessionId,
    sessionEpoch: 2,
    reasonCode: 'comfort_room',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'acknowledge_leave',
    attemptId,
    leaveId,
    action: 'acknowledge',
    note: '',
    requestKey,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'record_integrity_event',
    attemptId,
    sessionId,
    sessionEpoch: 2,
    clientEventId: operationId,
    eventType: 'fullscreen_exit',
    details: { fullscreen: false },
    clientOccurredAt: '2026-08-09T03:20:00Z',
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'record_technical_incident',
    attemptId,
    sessionId,
    sessionEpoch: 2,
    clientEventId: operationId,
    eventType: 'connectivity_lost',
    details: { durationSeconds: 30 },
    clientOccurredAt: '2026-08-09T03:30:00Z',
  }), {}, '', '', {});
  assert.deepEqual(calls.map((entry) => entry.name), [
    'exam_room_submit_attempt_generation_v2',
    'exam_room_transfer_session_v2',
    'exam_room_issue_erratum_v2',
    'exam_room_start_temporary_leave_v2',
    'exam_room_acknowledge_temporary_leave_v2',
    'exam_room_record_integrity_event_v2',
    'exam_room_record_technical_incident_v2',
  ]);
  assert.equal(calls[1].body.p_actor_user_id, userId);
  assert.deepEqual(calls[2].body.p_affected_question_ids, [questionId]);
  assert.equal(calls[5].body.p_session_epoch, 2);
});

test('optional student access uses an unreturnable schedule placeholder and no start code for roster-only exams', async () => {
  const gradingKey = 'professor-grading-key-secret';
  const studentKey = 'student-access-code-secret';
  const { handlers, calls } = harness();
  const schedule = {
    operation: 'schedule_exam',
    examId,
    opensAt: '2026-08-10T01:00:00Z',
    hardClosesAt: '2026-08-10T04:00:00Z',
    durationMinutes: 120,
    gradingKey,
  };
  await handlers.examCommand(request({ ...schedule, studentKey: null }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'publish_exam',
    examId,
    studentKey: null,
    requestKey,
    rules: {
      opensAt: schedule.opensAt,
      hardClosesAt: schedule.hardClosesAt,
      durationMinutes: schedule.durationMinutes,
      studentAccessCodeRequired: false,
    },
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'start_attempt', examId, studentKey: null,
  }), {}, '', '', {});
  await handlers.examCommand(request({
    operation: 'start_attempt', examId, studentKey,
  }), {}, '', '', {});
  assert.match(calls[0].body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.match(calls[0].body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(calls[1].name, 'exam_room_publish_exam_v2');
  assert.equal(calls[1].body.p_student_key_hash, null);
  assert.equal(calls[2].name, 'exam_room_start_attempt_v4');
  assert.equal(calls[2].body.p_student_key_hash, null);
  assert.equal(calls[3].name, 'exam_room_start_attempt_v4');
  assert.match(calls[3].body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls).includes(studentKey), false);
  assert.equal(JSON.stringify(calls).includes(gradingKey), false);
});

test('replacement questions are staged and a true new version is bound to credential rotation', async () => {
  const replacementQuestionVersionId = operationId;
  const studentKey = 'replacement-student-code';
  const gradingKey = 'replacement-grading-key';
  const result = {
    ok: true,
    examId,
    publicationId: questionId,
    publicationNumber: 2,
    supersedesPublicationId: versionId,
    replacementQuestionVersionId,
    publishedAt: '2026-08-10T00:00:00Z',
    snapshotHash: 'a'.repeat(64),
    questionCount: 1,
    accessCodeRequired: true,
    credentialsRotated: true,
    questionVersionChanged: true,
    notificationQueued: true,
    notificationStatus: 'queued',
    notificationCount: 1,
    gradingKeyHash: 'do-not-project',
  };
  const stagedResult = {
    ok: true,
    examId,
    expectedPublicationId: versionId,
    replacementQuestionVersionId,
    sourceVersion: 2,
    questionVersionNumber: 2,
    questionCount: 1,
    snapshotHash: 'b'.repeat(64),
    staged: true,
  };
  const replacement = harness({
    access: {
      canUploadQuestions: false,
      canUploadReplacementQuestions: true,
      canStageReplacementQuestions: true,
      storagePrefix: examId,
    },
    rpc: async (name) => name === 'exam_room_confirm_replacement_questions_v2'
      ? stagedResult
      : name === 'exam_room_replace_publication_v2'
        ? result
        : { ok: true },
  });
  const upload = await replacement.handlers.questionUpload(request({
    examId,
    questionCount: 1,
    fileName: 'replacement.txt',
    mimeType: 'text/plain',
    base64: Buffer.from('1. State the corrected rule.').toString('base64'),
  }), {}, '', '');
  const preview = (await upload.json()).preview;
  const confirmRequest = {
    operation: 'confirm_replacement_questions',
    examId,
    expectedPublicationId: versionId,
    requestKey,
    objectPath: preview.objectPath,
    fileName: preview.fileName,
    mimeType: preview.mimeType,
    sizeBytes: preview.sizeBytes,
    pageCount: preview.pageCount,
    contentHash: preview.contentHash,
    questionCount: 1,
    questions: preview.questions,
    warnings: preview.warnings,
  };
  const confirmResponse = await replacement.handlers.examCommand(request(confirmRequest), {}, '', '', {});
  const confirmReplay = await replacement.handlers.examCommand(request(confirmRequest), {}, '', '', {});
  assert.deepEqual((await confirmResponse.json()).result, stagedResult);
  assert.deepEqual((await confirmReplay.json()).result, stagedResult);
  const confirmCalls = replacement.calls.filter(
    (entry) => entry.name === 'exam_room_confirm_replacement_questions_v2',
  );
  assert.equal(confirmCalls.length, 2);
  assert.deepEqual(confirmCalls[0].body, confirmCalls[1].body);

  const queued = [];
  const replaceRequest = {
    operation: 'replace_publication',
    examId,
    expectedPublicationId: versionId,
    replacementQuestionVersionId,
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      studentAccessCodeRequired: true,
    },
    studentKey,
    gradingKey,
    reason: 'Corrected a material question before any candidate started.',
    requestKey,
  };
  const replaceResponse = await replacement.handlers.examCommand(
    request(replaceRequest), {}, '', '', { waitUntil: (promise) => queued.push(promise) },
  );
  const replaceReplay = await replacement.handlers.examCommand(
    request(replaceRequest), {}, '', '', { waitUntil: (promise) => queued.push(promise) },
  );
  const replacePayload = await replaceResponse.json();
  assert.deepEqual(await replaceReplay.json(), replacePayload);
  const replaceCalls = replacement.calls.filter(
    (entry) => entry.name === 'exam_room_replace_publication_v2',
  );
  assert.equal(replaceCalls.length, 2);
  assert.deepEqual(replaceCalls[0].body, replaceCalls[1].body);
  const call = replaceCalls[0];
  assert.equal(call.body.p_replacement_question_version_id, replacementQuestionVersionId);
  assert.match(call.body.p_student_key_hash, /^[0-9a-f]{64}$/);
  assert.match(call.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(call.body).includes(studentKey), false);
  assert.equal(JSON.stringify(call.body).includes(gradingKey), false);
  assert.equal(replacePayload.result.gradingKeyHash, undefined);
  assert.equal(replacePayload.result.questionVersionChanged, true);
  assert.equal(queued.length, 2);
  await Promise.all(queued);
});

test('Professor and Admin reopening use distinct credentialed authority paths and safe results', async () => {
  const newDeadline = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const gradingKey = 'professor-grading-key-secret';
  const result = {
    ok: true,
    attemptId,
    reopeningId: operationId,
    generation: 2,
    priorGeneration: 1,
    priorReceiptId: questionId,
    priorSnapshotHash: 'a'.repeat(64),
    serverDeadline: newDeadline,
    expiresAt: newDeadline,
    requiresNewSession: true,
    authority: 'owner_professor',
    notificationStatus: 'queued',
    notificationCount: 1,
    answerSnapshot: 'must-not-project',
  };
  const owner = harness({ result });
  const queued = [];
  const ownerResponse = await owner.handlers.examCommand(request({
    operation: 'reopen_submission',
    attemptId,
    newDeadline,
    reason: 'Documented candidate outage warrants a bounded reopening.',
    gradingKey,
    requestKey,
  }), {}, '', '', { waitUntil: (promise) => queued.push(promise) });
  const ownerReplay = await owner.handlers.examCommand(request({
    operation: 'reopen_submission',
    attemptId,
    newDeadline,
    reason: 'Documented candidate outage warrants a bounded reopening.',
    gradingKey,
    requestKey,
  }), {}, '', '', { waitUntil: (promise) => queued.push(promise) });
  const ownerCall = owner.calls.at(-1);
  assert.equal(owner.calls.length, 2);
  assert.deepEqual(owner.calls[0].body, owner.calls[1].body);
  assert.equal(ownerCall.name, 'exam_room_reopen_submission_generation_v2');
  assert.match(ownerCall.body.p_grading_key_hash, /^[0-9a-f]{64}$/);
  assert.match(ownerCall.body.p_rate_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(ownerCall.body.p_admin_break_glass_grant_public_id, null);
  assert.equal(ownerCall.body.p_verified_aal, null);
  const ownerBody = await ownerResponse.json();
  assert.deepEqual(await ownerReplay.json(), ownerBody);
  assert.equal(ownerBody.result.answerSnapshot, undefined);
  assert.equal(ownerBody.result.notificationStatus, 'queued');
  assert.equal(ownerBody.result.notificationCount, 1);
  assert.equal(queued.length, 2);

  const now = Math.floor(Date.now() / 1_000);
  const admin = harness({
    user: {
      id: userId,
      authenticationLevel: 'aal2',
      authenticationSessionId: authSessionId,
      stepUpAuthenticatedAt: now,
    },
    result: { ...result, authority: 'admin_break_glass' },
  });
  await admin.handlers.examCommand(request({
    operation: 'reopen_submission',
    attemptId,
    newDeadline,
    reason: 'Candidate-scoped Admin review authorizes a bounded reopening.',
    breakGlassGrantId: grantId,
    requestKey,
  }), {}, '', '', {});
  const adminCall = admin.calls.at(-1);
  assert.equal(adminCall.body.p_grading_key_hash, null);
  assert.equal(adminCall.body.p_rate_key_hash, null);
  assert.equal(adminCall.body.p_admin_break_glass_grant_public_id, grantId);
  assert.equal(adminCall.body.p_verified_aal, 'aal2');
  assert.equal(adminCall.body.p_verified_session_id, authSessionId);
  assert.match(adminCall.body.p_verified_authentication_at, /^\d{4}-/);
});

test('break-glass ignores forged client AAL and requires a fresh verified AMR-backed session before RPC', async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const issue = {
    operation: 'issue_break_glass',
    examId,
    attemptId,
    candidateNumber: '0007',
    caseReference: 'DD-BG-2026-0001',
    reason: 'Candidate-specific review after a documented examination dispute.',
    expiresAt,
    requestKey,
    aal: 'aal2',
    freshAal2: true,
  };
  const forged = harness({ user: { id: userId, authenticationLevel: 'aal1' } });
  await assert.rejects(
    forged.handlers.examCommand(request(issue), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_AAL2_REQUIRED' && error.status === 403,
  );
  await assert.rejects(
    forged.handlers.examQuery(request({
      operation: 'break_glass_view', grantId, examId, attemptId,
      candidateNumber: '0007', requestKey, aal: 'aal2', freshAal2: true,
    }), {}, '', ''),
    (error) => error.code === 'EXAM_ROOM_AAL2_REQUIRED' && error.status === 403,
  );
  assert.equal(forged.calls.length, 0);

  const missingAmr = harness({
    user: { id: userId, authenticationLevel: 'aal2', authenticationSessionId: authSessionId },
  });
  await assert.rejects(
    missingAmr.handlers.examCommand(request(issue), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_FRESH_AAL2_REQUIRED',
  );
  assert.equal(missingAmr.calls.length, 0);

  const stale = harness({
    user: {
      id: userId,
      authenticationLevel: 'aal2',
      authenticationSessionId: authSessionId,
      stepUpAuthenticatedAt: Math.floor(Date.now() / 1_000) - 16 * 60,
    },
  });
  await assert.rejects(
    stale.handlers.examCommand(request(issue), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_FRESH_AAL2_REQUIRED',
  );
  assert.equal(stale.calls.length, 0);

  const future = harness({
    user: {
      id: userId,
      authenticationLevel: 'aal2',
      authenticationSessionId: authSessionId,
      stepUpAuthenticatedAt: Math.floor(Date.now() / 1_000) + 2 * 60,
    },
  });
  await assert.rejects(
    future.handlers.examCommand(request(issue), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_FRESH_AAL2_REQUIRED',
  );
  assert.equal(future.calls.length, 0);
});

test('fresh global-Admin break-glass is candidate-scoped, idempotent, and safely projected', async () => {
  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const candidateNumber = '0007';
  const issueResult = {
    ok: true,
    grantId,
    examId,
    attemptId,
    candidateNumber,
    caseReference: 'DD-BG-2026-0001',
    issuedAt: new Date().toISOString(),
    expiresAt,
    scope: 'candidate_evidence',
    requiresPostReview: true,
    secretGrantToken: 'must-not-project',
  };
  const evidenceResult = {
    ...issueResult,
    evidence: {
      exam: {
        title: 'Civil Law Final',
        status: 'closed',
        publicationId: versionId,
        publicationNumber: 1,
        questions: [{
          id: questionId,
          ordinal: 1,
          prompt: 'Discuss due process.',
          maximumPoints: 5,
          promptHash: 'b'.repeat(64),
        }],
        allCandidates: ['must-not-project'],
      },
      attempt: { status: 'submitted', startedAt: '2026-08-10T01:00:00Z' },
      submissionHistory: [{
        generation: 1,
        receiptId: operationId,
        receivedAt: '2026-08-10T03:00:00Z',
        snapshotHash: 'a'.repeat(64),
        automatic: false,
        answerSnapshot: [{ questionId, answerText: 'Scoped answer.', revision: 2 }],
      }],
      answerOperations: [{
        operationId,
        questionId,
        sessionEpoch: 1,
        localSequence: 2,
        baseRevision: 1,
        answerText: 'Scoped operation answer.',
        contentHash: 'c'.repeat(64),
        disposition: 'applied',
        resultingRevision: 2,
        clientSavedAt: '2026-08-10T02:59:58Z',
        serverReceivedAt: '2026-08-10T02:59:59Z',
        serverSecret: 'must-not-project',
      }],
      conflictBranches: [{
        operationId,
        questionId,
        baseRevision: 1,
        serverRevision: 2,
        incomingAnswerText: 'Incoming scoped answer.',
        incomingContentHash: 'd'.repeat(64),
        serverAnswerText: 'Server scoped answer.',
        serverContentHash: 'e'.repeat(64),
        branchReason: 'stale_base_revision',
        clientSavedAt: '2026-08-10T02:59:58Z',
        preservedAt: '2026-08-10T03:00:00Z',
      }],
      sessions: [{
        sessionId,
        epoch: 1,
        status: 'closed',
        openedAt: '2026-08-10T01:00:00Z',
        lastSeenAt: '2026-08-10T03:00:00Z',
        endedAt: '2026-08-10T03:00:01Z',
        endReason: 'submitted',
        deviceHash: 'must-not-project',
      }],
      sessionEvents: [{
        eventType: 'session_opened',
        epoch: 1,
        metadata: { safeReason: 'candidate_started', accessToken: 'must-not-project' },
        occurredAt: '2026-08-10T01:00:00Z',
      }],
      integrityEvents: [{
        eventType: 'network_gap',
        severity: 'info',
        details: { durationSeconds: 4, studentAnswer: 'must-not-project' },
        occurredAt: '2026-08-10T02:00:00Z',
      }],
      incidentGroups: [],
      temporaryLeaves: [{
        leaveId: versionId,
        status: 'returned',
        startedAt: '2026-08-10T02:10:00Z',
        acknowledgedAt: '2026-08-10T02:11:00Z',
        returnedAt: '2026-08-10T02:15:00Z',
      }],
      deadlineExtensions: [{
        previousDeadline: '2026-08-10T03:00:00Z',
        newDeadline: '2026-08-10T03:15:00Z',
        extensionMinutes: 15,
        extensionType: 'technical',
        reason: 'Documented outage.',
        grantedAt: '2026-08-10T02:30:00Z',
      }],
      grades: [{
        questionId,
        score: 4,
        maximumPoints: 5,
        comment: 'Candidate-scoped grade comment.',
        gradeState: 'final',
        revision: 2,
        gradedAt: '2026-08-10T05:00:00Z',
      }],
      gradeHistory: [{
        questionId,
        revision: 1,
        score: 3,
        maximumPoints: 5,
        comment: 'Prior candidate-scoped comment.',
        gradeState: 'draft',
        changeReason: 'Professor review.',
        changedAt: '2026-08-10T04:00:00Z',
      }],
      anotherCandidateAnswers: ['must-not-project'],
    },
  };
  const freshUser = {
    id: userId,
    authenticationLevel: 'aal2',
    authenticationSessionId: authSessionId,
    stepUpAuthenticatedAt: now,
  };
  const scoped = harness({
    user: freshUser,
    rpc: async (name) => name === 'exam_room_issue_admin_break_glass_v2'
      ? issueResult
      : name === 'exam_room_admin_break_glass_evidence_v2'
        ? evidenceResult
        : name === 'exam_room_close_admin_break_glass_v2'
          ? {
            ok: true, grantId, examId, attemptId, candidateNumber,
            closedAt: new Date().toISOString(), requiresPostReview: true,
          }
          : {
            ok: true, grantId, examId, attemptId, candidateNumber,
            outcome: 'no_issue', reviewedAt: new Date().toISOString(),
          },
  });
  const issuePayload = {
    operation: 'issue_break_glass', examId, attemptId, candidateNumber,
    caseReference: 'DD-BG-2026-0001',
    reason: 'Candidate-specific review after a documented examination dispute.',
    expiresAt, requestKey,
  };
  const first = await scoped.handlers.examCommand(request(issuePayload), {}, '', '', {});
  const second = await scoped.handlers.examCommand(request(issuePayload), {}, '', '', {});
  assert.deepEqual(await first.json(), await second.json());
  const issueCalls = scoped.calls.filter((entry) => entry.name === 'exam_room_issue_admin_break_glass_v2');
  assert.equal(issueCalls.length, 2);
  assert.equal(issueCalls[0].body.p_request_key, requestKey);
  assert.equal(issueCalls[0].body.p_case_reference, 'DD-BG-2026-0001');
  assert.equal(issueCalls[0].body.p_verified_aal, 'aal2');
  assert.equal(issueCalls[0].body.p_verified_session_id, authSessionId);
  const viewResponse = await scoped.handlers.examQuery(request({
    operation: 'break_glass_view', grantId, examId, attemptId, candidateNumber, requestKey,
  }), {}, '', '');
  const view = (await viewResponse.json()).result;
  assert.equal(JSON.stringify(view).includes('must-not-project'), false);
  assert.equal(view.evidence.exam.questions[0].questionId, questionId);
  assert.equal(view.evidence.submissionHistory[0].answerSnapshot[0].answerText, 'Scoped answer.');
  assert.equal(view.evidence.answerOperations[0].disposition, 'applied');
  assert.equal(view.evidence.answerOperations[0].serverReceivedAt, '2026-08-10T02:59:59Z');
  assert.equal(view.evidence.conflictBranches[0].incomingAnswerText, 'Incoming scoped answer.');
  assert.equal(view.evidence.sessions[0].endedAt, '2026-08-10T03:00:01Z');
  assert.equal(view.evidence.sessionEvents[0].metadata.safeReason, 'candidate_started');
  assert.equal(view.evidence.sessionEvents[0].metadata.accessToken, undefined);
  assert.equal(view.evidence.integrityEvents[0].details.durationSeconds, 4);
  assert.equal(view.evidence.deadlineExtensions[0].newDeadline, '2026-08-10T03:15:00Z');
  assert.equal(view.evidence.grades[0].comment, 'Candidate-scoped grade comment.');
  assert.equal(view.evidence.gradeHistory[0].changeReason, 'Professor review.');
  assert.equal(view.evidence.sessions[0].deviceHash, undefined);

  await scoped.handlers.examCommand(request({
    operation: 'close_break_glass', grantId, examId, attemptId, candidateNumber,
    reason: 'Candidate-scoped evidence review is complete.', requestKey,
  }), {}, '', '', {});
  await scoped.handlers.examCommand(request({
    operation: 'record_break_glass_review', grantId, examId, attemptId, candidateNumber,
    outcome: 'no_issue',
    notes: 'Review completed with no further issue identified.', requestKey,
  }), {}, '', '', {});
  assert.deepEqual(scoped.calls.slice(-2).map((entry) => entry.name), [
    'exam_room_close_admin_break_glass_v2',
    'exam_room_record_admin_break_glass_review_v2',
  ]);
  for (const call of scoped.calls.slice(-2)) {
    assert.equal(call.body.p_exam_public_id, examId);
    assert.equal(call.body.p_attempt_public_id, attemptId);
    assert.equal(call.body.p_candidate_number, candidateNumber);
    assert.equal(call.body.p_verified_aal, 'aal2');
    assert.equal(call.body.p_verified_session_id, authSessionId);
  }

  const mismatch = harness({
    user: freshUser,
    rpc: async () => ({ ...evidenceResult, candidateNumber: '0008' }),
  });
  await assert.rejects(
    mismatch.handlers.examQuery(request({
      operation: 'break_glass_view', grantId, examId, attemptId, candidateNumber, requestKey,
    }), {}, '', ''),
    (error) => error.code === 'EXAM_ROOM_SCOPE_MISMATCH' && error.status === 403,
  );
  const closeMismatch = harness({
    user: freshUser,
    rpc: async () => ({
      ok: true, grantId, examId, attemptId, candidateNumber: '0008',
      closedAt: new Date().toISOString(), requiresPostReview: true,
    }),
  });
  await assert.rejects(
    closeMismatch.handlers.examCommand(request({
      operation: 'close_break_glass', grantId, examId, attemptId, candidateNumber,
      reason: 'Candidate-scoped evidence review is complete.', requestKey,
    }), {}, '', '', {}),
    (error) => error.code === 'EXAM_ROOM_SCOPE_MISMATCH' && error.status === 403,
  );
});
