import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS,
  EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION,
  EXAM_ROOM_HANDOFF_MINIMUM_LEAD_MINUTES,
  normalizeExamClassResultsWorkbookRequest,
  normalizeExamResultPdfRequest,
  normalizeExamRoomCommand,
  normalizeExamRoomPaymentProofUpload,
  normalizeExamRoomQuery,
  normalizeModelAnswerUpload,
  normalizeQuestionUpload,
  normalizeQuestionUploadIntent,
  normalizeRosterUpload,
  normalizeRosterUploadIntent,
  sha256Hex,
} from './exam-room-2026-core.mjs';
import { rosterXlsxBase64 } from './exam-room-roster-template-test-helpers.mjs';
import { examRoom2026DatabaseError, verifiedAccessTokenContext } from './index.mjs';

const examId = '123e4567-e89b-42d3-a456-426614174001';
const versionId = '123e4567-e89b-42d3-a456-426614174002';
const attemptId = '123e4567-e89b-42d3-a456-426614174003';
const sessionId = '123e4567-e89b-42d3-a456-426614174004';
const questionId = '123e4567-e89b-42d3-a456-426614174005';
const operationId = '123e4567-e89b-42d3-a456-426614174006';
const requestKey = 'request_2026_abcdef123456';

function base64(value) {
  return Buffer.from(value, 'latin1').toString('base64');
}

function unsignedJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

test('pasted questions use the existing parser without requiring a file payload', async () => {
  const preview = await normalizeQuestionUpload({
    examId,
    questionCount: 2,
    sourceKind: 'paste',
    pastedText: '1. Explain due process.\n2. Discuss equal protection.',
  });
  assert.equal(preview.mimeType, 'text/plain');
  assert.equal(preview.fileName, 'pasted-questions.txt');
  assert.equal(preview.questions.length, 2);
  assert.equal(preview.extractionMode, 'parsed');
});

test('professors choose the exam length within the documented 1 to 200 beta limit', () => {
  assert.equal(normalizeExamRoomCommand({
    operation: 'create_exam',
    classroomId: examId,
    title: 'Flexible final',
    instructions: '',
    questionCount: 200,
    integrityPreset: 'standard',
    includeQuestionnaire: false,
  }).questionCount, 200);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'create_exam',
    classroomId: examId,
    title: 'Unsafe oversized exam',
    instructions: '',
    questionCount: 201,
    integrityPreset: 'standard',
    includeQuestionnaire: false,
  }));
});

test('Professor authoring revisions are scoped, versioned, and idempotent', () => {
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'professor_authoring_snapshot', examId,
  }), { operation: 'professor_authoring_snapshot', examId });

  const details = normalizeExamRoomCommand({
    operation: 'update_exam_details',
    examId,
    expectedRevision: 3,
    title: 'Revised Civil Law Final',
    instructions: 'Answer every question.',
    questionCount: 20,
    integrityPreset: 'standard',
    includeQuestionnaire: true,
    requestKey,
  });
  assert.equal(details.expectedRevision, 3);
  assert.equal(details.questionCount, 20);
  assert.equal(details.includeQuestionnaire, true);

  const revision = normalizeExamRoomCommand({
    operation: 'revise_draft_questions',
    examId,
    expectedRevision: 4,
    expectedQuestionVersionId: versionId,
    questions: [
      { ordinal: 1, prompt: 'Explain due process.', maximumPoints: 5 },
      { ordinal: 2, prompt: 'Explain due process.', maximumPoints: 5 },
    ],
    requestKey,
  });
  assert.equal(revision.expectedQuestionVersionId, versionId);
  assert.equal(revision.questions.length, 2);

  const opensAt = new Date(Date.now() + 90 * 60 * 1_000).toISOString();
  const hardClosesAt = new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString();
  const rules = normalizeExamRoomCommand({
    operation: 'save_rules_draft',
    examId,
    expectedRevision: 5,
    beadleEmail: 'Beadle@Example.edu',
    rules: {
      opensAt,
      hardClosesAt,
      durationMinutes: 120,
      lateAdmissionMinutes: 15,
      submissionGraceMinutes: 5,
      allowedMaterials: 'Codal only',
      navigationMode: 'free',
      integrityMode: 'record_only',
      fullscreenPolicy: 'requested',
      admissionMode: 'automatic',
      temporaryLeaveAcknowledgment: true,
      studentAccessCodeRequired: true,
      suggestedAnswerMode: 'none',
      aiGradingEnabled: false,
    },
    requestKey,
  });
  assert.equal(rules.beadleEmail, 'beadle@example.edu');
  assert.equal(rules.rules.studentAccessCodeRequired, true);

  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'reopen_exam_roster',
    examId,
    reason: 'Correct a student email before the examination opens.',
    requestKey,
  }), {
    operation: 'reopen_exam_roster',
    examId,
    reason: 'Correct a student email before the examination opens.',
    requestKey,
  });

  assert.throws(() => normalizeExamRoomCommand({ ...details, expectedRevision: 0 }));
  assert.throws(() => normalizeExamRoomCommand({
    ...rules,
    rules: { ...rules.rules, studentAccessCodeRequired: false },
  }));
});

test('Professor schedule corrections allow immediate opening with bounded rules and current publication scope', () => {
  const opensAt = new Date(Date.now() + 90 * 60 * 1_000).toISOString();
  const hardClosesAt = new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString();
  const normalized = normalizeExamRoomCommand({
    operation: 'reschedule_publication',
    examId,
    expectedPublicationId: versionId,
    expectedWorkspaceRevision: 8,
    opensAt,
    hardClosesAt,
    durationMinutes: 120,
    lateAdmissionMinutes: 15,
    submissionGraceMinutes: 5,
    reason: 'The class needs a corrected examination schedule.',
    requestKey,
  });
  assert.equal(normalized.expectedPublicationId, versionId);
  assert.equal(normalized.expectedWorkspaceRevision, 8);
  assert.equal(normalized.durationMinutes, 120);
  assert.equal(normalized.lateAdmissionMinutes, 15);
  assert.equal(normalized.submissionGraceMinutes, 5);

  const immediate = normalizeExamRoomCommand({
    ...normalized,
    opensAt: new Date(Date.now() - 60 * 1_000).toISOString(),
  });
  assert.equal(immediate.expectedPublicationId, versionId);
});

test('past-exam removal accepts only a validated exam and idempotency key', () => {
  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'dismiss_past_exam',
    examId,
    requestKey,
  }), {
    operation: 'dismiss_past_exam',
    examId,
    requestKey,
  });
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'dismiss_past_exam',
    examId,
    requestKey: 'short',
  }));
});

test('Admin room invitations require complete room details and a bounded expiry', () => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'issue_activation',
    targetEmail: 'Professor@Example.edu',
    activationKey: 'professor-room-key-secret',
    roomTitle: 'Civil Law Final Examination Room',
    schoolName: 'Due Diligence College of Law',
    academicTerm: 'First Semester 2026-2027',
    expiresAt,
    reason: 'Initial beta room invitation for this Professor.',
  }), {
    operation: 'issue_activation',
    targetEmail: 'professor@example.edu',
    activationKey: 'professor-room-key-secret',
    roomTitle: 'Civil Law Final Examination Room',
    schoolName: 'Due Diligence College of Law',
    academicTerm: 'First Semester 2026-2027',
    expiresAt,
    reason: 'Initial beta room invitation for this Professor.',
  });
  for (const field of ['roomTitle', 'schoolName', 'academicTerm']) {
    const payload = {
      operation: 'issue_activation',
      targetEmail: 'professor@example.edu',
      activationKey: 'professor-room-key-secret',
      roomTitle: 'Civil Law Final Examination Room',
      schoolName: 'Due Diligence College of Law',
      academicTerm: 'First Semester 2026-2027',
      expiresAt,
      reason: 'Initial beta room invitation for this Professor.',
    };
    delete payload[field];
    assert.throws(() => normalizeExamRoomCommand(payload));
  }
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'issue_activation',
    targetEmail: 'professor@example.edu',
    activationKey: 'professor-room-key-secret',
    roomTitle: 'Civil Law Final Examination Room',
    schoolName: 'Due Diligence College of Law',
    academicTerm: 'First Semester 2026-2027',
    expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000).toISOString(),
    reason: 'Initial beta room invitation for this Professor.',
  }), /no more than seven days/i);
});

test('room requests are bounded to the supported essay workflow and exact recipients', () => {
  const examinationDate = new Date(Date.now() + 24 * 60 * 60 * 1_000)
    .toISOString().slice(0, 10);
  const normalized = normalizeExamRoomCommand({
    operation: 'submit_room_request',
    professorName: 'Professor Maria Santos',
    schoolName: 'Due Diligence College of Law',
    courseSubject: 'Labor Law',
    examinationTitle: 'Labor Law Midterm Examination',
    examinationDate,
    startTime: '09:30',
    timeZone: 'Asia/Manila',
    expectedDurationMinutes: 120,
    estimatedStudentCount: 45,
    examinationType: 'essay',
    quotationRecipient: 'beadle',
    beadleName: 'Juan Dela Cruz',
    beadleEmail: 'BEADLE@example.edu',
    notes: 'Please prepare one secure Examination Room.',
    requestKey,
  });
  assert.equal(normalized.examinationType, 'essay');
  assert.equal(normalized.quotationRecipient, 'beadle');
  assert.equal(normalized.beadleEmail, 'beadle@example.edu');
  assert.throws(() => normalizeExamRoomCommand({
    ...normalized,
    operation: 'submit_room_request',
    examinationType: 'multiple_choice',
  }));
  assert.throws(() => normalizeExamRoomCommand({
    ...normalized,
    operation: 'submit_room_request',
    quotationRecipient: 'beadle',
    beadleEmail: null,
  }));
});

test('payment proof uploads verify extension, signature, size, and active PDF safety', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const normalized = normalizeExamRoomPaymentProofUpload({
    requestId: examId,
    fileName: 'official-receipt.png',
    mimeType: 'image/png',
    dataBase64: png.toString('base64'),
    requestKey,
  });
  assert.equal(normalized.fileName, 'official-receipt.png');
  assert.equal(normalized.bytes.length, png.length);
  assert.throws(() => normalizeExamRoomPaymentProofUpload({
    requestId: examId,
    fileName: 'renamed.jpg',
    mimeType: 'image/jpeg',
    dataBase64: png.toString('base64'),
    requestKey,
  }), (error) => error?.code === 'INVALID_PAYMENT_PROOF');
  assert.throws(() => normalizeExamRoomPaymentProofUpload({
    requestId: examId,
    fileName: 'active.pdf',
    mimeType: 'application/pdf',
    dataBase64: Buffer.from('%PDF-1.7\n/JavaScript /OpenAction\n%%EOF', 'latin1').toString('base64'),
    requestKey,
  }), (error) => error?.code === 'INVALID_PAYMENT_PROOF');
});

test('Professor invitation ledger and revocation inputs are tightly bounded', () => {
  assert.deepEqual(normalizeExamRoomQuery({ operation: 'activation_ledger' }), {
    operation: 'activation_ledger', status: 'all', limit: 200, offset: 0,
  });
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'activation_ledger', status: 'redeemed', limit: 25, offset: 50,
  }), {
    operation: 'activation_ledger', status: 'redeemed', limit: 25, offset: 50,
  });
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'activation_ledger', status: 'unknown', limit: 25,
  }));
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'activation_ledger', status: 'all', limit: 201,
  }));
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'activation_ledger', status: 'all', limit: 200, offset: -1,
  }));
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'activation_ledger', status: 'all', limit: 200, offset: 100_001,
  }));
  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'revoke_activation',
    activationId: operationId,
    reason: 'The Professor invitation was replaced.',
    requestKey,
  }), {
    operation: 'revoke_activation',
    activationId: operationId,
    reason: 'The Professor invitation was replaced.',
    requestKey,
  });
});

test('upload intent validates extension and MIME before decoding content', () => {
  assert.throws(() => normalizeQuestionUploadIntent({
    examId,
    questionCount: 1,
    fileName: 'questions.pdf',
    mimeType: 'text/plain',
    base64: 'not-decoded-at-intent-stage',
  }), (error) => error.code === 'FILE_TYPE_MISMATCH');
});

test('safe PDF acceptance requires manual construction and never pretends to extract text', async () => {
  const pdf = '%PDF-1.7\n1 0 obj\n<</Type /Page>>\nendobj\n%%EOF\n';
  const preview = await normalizeQuestionUpload({
    examId,
    questionCount: 1,
    sourceKind: 'file',
    fileName: 'questions.pdf',
    mimeType: 'application/pdf',
    base64: base64(pdf),
  });
  assert.equal(preview.pageCount, 1);
  assert.equal(preview.extractionMode, 'manual_required');
  assert.deepEqual(preview.questions, []);
  assert.match(preview.warnings.join(' '), /text extraction is not enabled/i);
  assert.match(preview.warnings.join(' '), /Detected 0 questions/i);
});

test('PDF validation rejects spoofed, encrypted, and active files', async () => {
  const upload = (pdf) => normalizeQuestionUpload({
    examId,
    questionCount: 1,
    fileName: 'questions.pdf',
    mimeType: 'application/pdf',
    base64: base64(pdf),
  });
  await assert.rejects(upload('not a pdf\n%%EOF\n'), (error) => error.code === 'INVALID_PDF_SIGNATURE');
  await assert.rejects(
    upload('%PDF-1.7\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF\n'),
    (error) => error.code === 'ENCRYPTED_PDF_REJECTED',
  );
  await assert.rejects(
    upload('%PDF-1.7\n1 0 obj<</OpenAction 2 0 R>>endobj\n%%EOF\n'),
    (error) => error.code === 'ACTIVE_PDF_REJECTED',
  );
  await assert.rejects(
    upload('%PDF-1.7\n1 0 obj<</Java#53cript 2 0 R>>endobj\n%%EOF\n'),
    (error) => error.code === 'ACTIVE_PDF_REJECTED',
  );
  await assert.rejects(
    upload('%PDF-1.7\n1 0 obj<</Type /ObjStm /N 1 /First 8>>stream\nunsafe\nendstream\nendobj\n%%EOF\n'),
    (error) => error.code === 'ACTIVE_PDF_REJECTED',
  );
  await assert.rejects(
    upload(`%PDF-1.7\n${Array.from({ length: 51 }, (_entry, index) => (
      `${index + 1} 0 obj<</Type /Page>>endobj`
    )).join('\n')}\n%%EOF\n`),
    (error) => error.code === 'PDF_PAGE_LIMIT_EXCEEDED',
  );
});

test('dormant model-answer parser validates files without exposing or parsing legal content', async () => {
  const source = await normalizeModelAnswerUpload({
    examId,
    fileName: 'model-answer.txt',
    mimeType: 'text/plain',
    base64: Buffer.from('Private professor model answer.', 'utf8').toString('base64'),
    requestKey,
  });
  assert.equal(source.fileName, 'model-answer.txt');
  assert.match(source.contentHash, /^[0-9a-f]{64}$/);
  assert.equal('questions' in source, false);
});

test('answer operations carry local journal identity, version, epoch, sequence, and digest', async () => {
  const answerText = 'The search was unreasonable.';
  const contentHash = await sha256Hex(answerText);
  const normalized = normalizeExamRoomCommand({
    operation: 'save_answer_operation',
    operationId,
    examId,
    examVersionId: versionId,
    attemptId,
    sessionId,
    sessionEpoch: 2,
    questionId,
    localSequence: 19,
    expectedRevision: 4,
    answerText,
    contentHash,
    clientSavedAt: '2026-08-09T10:00:00+08:00',
    outageEvidence: { clientReportedOffline: true, offlineSeconds: 30 },
  });
  assert.deepEqual({
    operationId: normalized.operationId,
    examId: normalized.examId,
    examVersionId: normalized.examVersionId,
    sessionEpoch: normalized.sessionEpoch,
    localSequence: normalized.localSequence,
    expectedRevision: normalized.expectedRevision,
    contentHash: normalized.contentHash,
    outageEvidence: normalized.outageEvidence,
  }, {
    operationId,
    examId,
    examVersionId: versionId,
    sessionEpoch: 2,
    localSequence: 19,
    expectedRevision: 4,
    contentHash,
    outageEvidence: { clientReportedOffline: true, offlineSeconds: 30 },
  });
});

test('publication rules use safe defaults and institutional AI grading remains fail-closed', () => {
  const publish = normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    studentKey: 'student-access-code-secret',
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      durationMinutes: 120,
      allowedMaterials: 'Codal only',
    },
  });
  assert.equal(publish.rules.navigationMode, 'free');
  assert.equal(publish.rules.integrityMode, 'record_only');
  assert.equal(publish.rules.admissionMode, 'automatic');
  assert.equal(publish.rules.studentAccessCodeRequired, true);
  assert.equal(publish.studentKey, 'student-access-code-secret');
  assert.equal(publish.rules.aiGradingEnabled, false);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      aiGradingEnabled: true,
    },
  }), (error) => error.code === 'AI_GRADING_UNAVAILABLE');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      navigationMode: 'one_way',
    },
  }), (error) => error.code === 'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE'
    && error.status === 400
    && error.message === 'One-way navigation is unavailable until durable server-side progress enforcement is enabled. Choose free navigation.');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    rules: {
      opensAt: '2026-08-10T01:00:00Z',
      hardClosesAt: '2026-08-10T04:00:00Z',
      suggestedAnswerMode: 'upload',
      suggestedAnswerObjectPath: `${examId}/model-answers/${'a'.repeat(64)}/answer.pdf`,
    },
  }), (error) => error.code === 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE'
    && error.status === 400
    && error.message === 'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.');
});

test('class handoff keeps Beadle and student credentials distinct and freezes code protection', () => {
  const opensAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const hardClosesAt = new Date(Date.now() + 3 * 60 * 60 * 1_000).toISOString();
  const beadleExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const publish = normalizeExamRoomCommand({
    operation: 'publish_for_beadle',
    examId,
    expectedRevision: 7,
    gradingKey: 'professor-grading-key-secret',
    beadleEmail: 'Beadle@Example.edu',
    beadleInvitationKey: 'beadle-invitation-key-secret',
    beadleExpiresAt,
    reason: 'Prepare and confirm the official class roster.',
    requestKey,
    rules: {
      opensAt,
      hardClosesAt,
      durationMinutes: 120,
      studentAccessCodeRequired: true,
    },
  });
  assert.equal(publish.beadleEmail, 'beadle@example.edu');
  assert.equal(publish.expectedRevision, 7);
  assert.equal(publish.rules.studentAccessCodeRequired, true);
  assert.equal(publish.beadleInvitationKey, 'beadle-invitation-key-secret');
  assert.equal(normalizeExamRoomCommand({
    operation: 'issue_student_access',
    examId,
    studentKey: 'student-exam-code-secret',
    requestKey,
  }).studentKey, 'student-exam-code-secret');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'publish_for_beadle',
    examId,
    expectedRevision: 7,
    gradingKey: 'professor-grading-key-secret',
    beadleEmail: 'beadle@example.edu',
    beadleInvitationKey: 'beadle-invitation-key-secret',
    beadleExpiresAt,
    reason: 'Prepare and confirm the official class roster.',
    requestKey,
    rules: {
      opensAt,
      hardClosesAt,
      studentAccessCodeRequired: false,
    },
  }), (error) => error.code === 'EXAM_ROOM_STUDENT_ACCESS_POLICY_REQUIRED');
});

test('class handoff allows an examination to open immediately', () => {
  assert.equal(EXAM_ROOM_HANDOFF_MINIMUM_LEAD_MINUTES, 0);
  const opensAt = new Date(Date.now() - 60 * 1_000).toISOString();
  const hardClosesAt = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
  const normalized = normalizeExamRoomCommand({
    operation: 'publish_for_beadle',
    examId,
    expectedRevision: 7,
    gradingKey: 'professor-grading-key-secret',
    beadleEmail: 'beadle@example.edu',
    beadleInvitationKey: 'beadle-invitation-key-secret',
    beadleExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    reason: 'Prepare and confirm the official class roster.',
    requestKey,
    rules: {
      opensAt,
      hardClosesAt,
      durationMinutes: 120,
      studentAccessCodeRequired: true,
    },
  });
  assert.equal(normalized.rules.opensAt, opensAt);

  const databaseError = examRoom2026DatabaseError({
    message: 'EXAM_ROOM_HANDOFF_TIME_REQUIRED private database timing detail',
  });
  assert.equal(databaseError.code, 'EXAM_ROOM_HANDOFF_TIME_REQUIRED');
  assert.equal(databaseError.status, 409);
  assert.equal(
    databaseError.message,
    'Choose a valid examination opening time and try again.',
  );
  assert.equal(databaseError.message.includes('private database timing detail'), false);
});

test('Professor result PDF request is candidate-scoped and allows only three packages', () => {
  const result = normalizeExamResultPdfRequest({
    examId,
    attemptId,
    scope: 'grades_comments',
    gradingKey: 'professor-grading-key-secret',
    requestKey,
  });
  assert.deepEqual(result, {
    examId,
    attemptId,
    scope: 'grades_comments',
    gradingKey: 'professor-grading-key-secret',
    requestKey,
  });
  assert.equal(normalizeExamResultPdfRequest({
    examId, attemptId, scope: 'grades_comments', requestKey,
  }).gradingKey, null, 'remembered Professor access does not require the raw key on another device');
  assert.throws(() => normalizeExamResultPdfRequest({
    examId,
    attemptId,
    scope: 'all_database_evidence',
    gradingKey: 'professor-grading-key-secret',
    requestKey,
  }), (error) => error.code === 'INVALID_REQUEST');
});

test('Professor class workbook permits a roster-only offline export but not an empty final export', () => {
  assert.deepEqual(normalizeExamClassResultsWorkbookRequest({
    examId, attemptIds: [], scope: 'offline_grading', requestKey,
  }), { examId, attemptIds: [], scope: 'offline_grading', requestKey });
  assert.throws(() => normalizeExamClassResultsWorkbookRequest({
    examId, attemptIds: [], scope: 'class_results', requestKey,
  }), (error) => error.code === 'INVALID_REQUEST');
});

test('student access code is optional but its publication requirement is explicit and frozen', () => {
  const opensAt = '2026-08-10T01:00:00Z';
  const hardClosesAt = '2026-08-10T04:00:00Z';
  const noCodeSchedule = normalizeExamRoomCommand({
    operation: 'schedule_exam',
    examId,
    opensAt,
    hardClosesAt,
    durationMinutes: 120,
    studentKey: null,
    gradingKey: 'professor-grading-key-secret',
  });
  assert.equal(noCodeSchedule.studentKey, null);
  assert.equal(normalizeExamRoomCommand({
    operation: 'start_attempt', examId, studentKey: '',
  }).studentKey, null);

  const noCodePublication = normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    rules: { opensAt, hardClosesAt, studentAccessCodeRequired: false },
  });
  assert.equal(noCodePublication.rules.studentAccessCodeRequired, false);
  assert.equal(noCodePublication.studentKey, null);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'publish_exam',
    examId,
    requestKey,
    rules: { opensAt, hardClosesAt, studentAccessCodeRequired: true },
  }), (error) => error.code === 'EXAM_ROOM_PUBLICATION_CREDENTIAL_INVALID');

  const replacement = normalizeExamRoomCommand({
    operation: 'replace_publication',
    examId,
    expectedPublicationId: versionId,
    replacementQuestionVersionId: operationId,
    requestKey,
    reason: 'Corrected a material pre-start question error.',
    studentKey: null,
    gradingKey: 'new-professor-grading-secret',
    rules: { opensAt, hardClosesAt, studentAccessCodeRequired: false },
  });
  assert.equal(replacement.studentKey, null);
  assert.equal(replacement.expectedPublicationId, versionId);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'replace_publication',
    examId,
    expectedPublicationId: versionId,
    replacementQuestionVersionId: operationId,
    requestKey,
    reason: 'Corrected a material pre-start question error.',
    studentKey: null,
    gradingKey: 'new-professor-grading-secret',
    rules: { opensAt, hardClosesAt, studentAccessCodeRequired: true },
  }), (error) => error.code === 'EXAM_ROOM_REPLACEMENT_CREDENTIAL_INVALID');
});

test('reopen and candidate-scoped break-glass requests have bounded exact scopes', () => {
  const newDeadline = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
  const grantId = '123e4567-e89b-42d3-a456-426614174009';
  const candidateNumber = '0007';
  const reopened = normalizeExamRoomCommand({
    operation: 'reopen_submission',
    attemptId,
    newDeadline,
    reason: 'Candidate-specific reopening after a documented outage.',
    requestKey,
    gradingKey: 'professor-grading-key-secret',
  });
  assert.equal(reopened.attemptId, attemptId);
  assert.equal(reopened.breakGlassGrantId, null);

  const issued = normalizeExamRoomCommand({
    operation: 'issue_break_glass',
    examId,
    attemptId,
    candidateNumber,
    caseReference: 'DD-BG-2026-0001',
    reason: 'Review the sealed evidence for this candidate-specific dispute.',
    expiresAt,
    requestKey,
  });
  assert.equal(issued.candidateNumber, candidateNumber);
  assert.equal(normalizeExamRoomQuery({
    operation: 'break_glass_view',
    grantId,
    examId,
    attemptId,
    candidateNumber,
    caseReference: 'DD-BG-2026-0001',
    requestKey,
  }).grantId, grantId);
  assert.equal(normalizeExamRoomCommand({
    operation: 'close_break_glass', grantId, examId, attemptId, candidateNumber,
    reason: 'The exact candidate-scoped review is complete.', requestKey,
  }).examId, examId);
  assert.equal(normalizeExamRoomCommand({
    operation: 'record_break_glass_review', grantId, examId, attemptId, candidateNumber,
    outcome: 'no_issue', notes: 'No further candidate-specific issue was identified.', requestKey,
  }).attemptId, attemptId);
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'close_break_glass', grantId,
    reason: 'The review is complete.', requestKey,
  }));
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'issue_break_glass',
    examId,
    attemptId,
    candidateNumber,
    reason: 'Review the sealed evidence for this candidate-specific dispute.',
    expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1_000).toISOString(),
    requestKey,
  }));
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'break_glass_view',
    grantId,
    examId,
    candidateNumber,
    requestKey,
  }));
});

test('verified token context uses AMR authentication time and never JWT issue time as step-up proof', () => {
  const session = '123e4567-e89b-42d3-a456-426614174010';
  const now = Math.floor(Date.now() / 1_000);
  const context = verifiedAccessTokenContext(`Bearer ${unsignedJwt({
    aal: 'aal2',
    session_id: session,
    iat: now,
    amr: [
      { method: 'oauth', timestamp: now - 120 },
      { method: 'totp', timestamp: now - 30 },
      { method: 'token_refresh', timestamp: now },
    ],
  })}`);
  assert.deepEqual(context, {
    authenticationLevel: 'aal2',
    authenticationSessionId: session,
    stepUpAuthenticatedAt: now - 30,
  });
  for (const method of ['totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn']) {
    assert.equal(verifiedAccessTokenContext(`Bearer ${unsignedJwt({
      aal: 'aal2', session_id: session, amr: [{ method, timestamp: now - 5 }],
    })}`).stepUpAuthenticatedAt, now - 5);
  }
  for (const method of ['otp', 'phone', 'webauthn', 'password', 'oauth', 'future_mfa']) {
    assert.equal(verifiedAccessTokenContext(`Bearer ${unsignedJwt({
      aal: 'aal2', session_id: session, amr: [{ method, timestamp: now }],
    })}`).stepUpAuthenticatedAt, null);
  }
  assert.equal(verifiedAccessTokenContext(`Bearer ${unsignedJwt({
    aal: 'aal2', session_id: session, amr: [{ method: 'mfa/totp', timestamp: String(now) }],
  })}`).stepUpAuthenticatedAt, null);
  assert.equal(verifiedAccessTokenContext(`Bearer ${unsignedJwt({
    aal: 'aal2', session_id: session, iat: now,
    amr: [
      { method: 'password', timestamp: now },
      { method: 'oauth', timestamp: now },
      { method: 'token_refresh', timestamp: now },
      { method: 'unknown', timestamp: now },
    ],
  })}`).stepUpAuthenticatedAt, null);
});

test('replacement questions are staged against the exact current publication', () => {
  const normalized = normalizeExamRoomCommand({
    operation: 'confirm_replacement_questions',
    examId,
    expectedPublicationId: versionId,
    requestKey,
    objectPath: `${examId}/${'a'.repeat(64)}/replacement.txt`,
    fileName: 'replacement.txt',
    mimeType: 'text/plain',
    sizeBytes: 100,
    pageCount: null,
    contentHash: 'a'.repeat(64),
    questionCount: 1,
    questions: [{ ordinal: 1, prompt: 'State the corrected rule.', maximumPoints: 5 }],
    warnings: [],
  });
  assert.equal(normalized.expectedPublicationId, versionId);
  assert.equal(normalized.questions.length, 1);
  assert.throws(() => normalizeExamRoomCommand({
    ...normalized,
    expectedPublicationId: null,
  }));
});

test('accommodation payload contains operational fields and excludes diagnosis data', () => {
  const normalized = normalizeExamRoomCommand({
    operation: 'set_accommodation',
    examId,
    candidateNumber: '0007',
    accommodation: {
      extraMinutes: 30,
      breakMinutes: 15,
      fullscreenExempt: true,
      integrityExempt: true,
      assistiveTechnology: true,
      permittedAids: 'Screen reader',
      operationalNote: 'Seat near a power outlet.',
    },
    reason: 'Approved operational accommodation',
    requestKey,
  });
  assert.equal(normalized.accommodation.extraMinutes, 30);
  assert.equal(normalized.accommodation.fullscreenExempt, true);
  assert.equal('diagnosis' in normalized.accommodation, false);
});

test('roster display name is optional and leading-zero identifiers are preserved', async () => {
  const csv = 'Email,Student Number,Candidate Number\nana@example.edu,000012,0007\n';
  const parsed = await normalizeRosterUpload({
    classroomId: examId,
    fileName: 'class.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  });
  assert.equal(parsed.rows[0].displayName, null);
  assert.equal(parsed.rows[0].studentNumber, '000012');
  assert.equal(parsed.rows[0].candidateNumber, '0007');
});

test('exam-scoped roster upload requires the official three-column XLSX template', async () => {
  const parsed = await normalizeRosterUpload({
    examId,
    fileName: 'official-class-list.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: rosterXlsxBase64([
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS,
      ['ana@example.edu', '000012', 'Cruz, Ana, M.'],
    ]),
  });
  assert.deepEqual(parsed.rows[0], {
    email: 'ana@example.edu',
    studentNumber: '000012',
    candidateNumber: '000012',
    displayName: 'Cruz, Ana, M.',
  });
  assert.equal(parsed.templateVersion, EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION);
  assert.match(parsed.sourceHash, /^[0-9a-f]{64}$/);

  const csv = 'Email Address,Student Number,Student Name (Last Name, First Name, Middle Initial)\nana@example.edu,000012,"Cruz, Ana, M."\n';
  await assert.rejects(normalizeRosterUpload({
    examId,
    fileName: 'class-list.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  }), (error) => error.code === 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED'
    && error.status === 400
    && error.message === 'Use the official Beadle class-list template. Do not add, remove, or rename columns.');

  for (const headers of [
    EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS.slice(0, 2),
    [...EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS, 'Section'],
    ['Student Number', EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS[0], EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS[2]],
    ['Email', EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS[1], EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS[2]],
  ]) {
    await assert.rejects(normalizeRosterUpload({
      examId,
      fileName: 'class-list.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: rosterXlsxBase64([headers, ['ana@example.edu', '000012', 'Cruz, Ana, M.']]),
    }), (error) => error.code === 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED'
      && error.status === 400);
  }
});

test('the published t=str template parses its exact headers and ignores blank formatted rows', async () => {
  const template = readFileSync(new URL(
    '../assets/examination-room-beadle-class-list-template.xlsx',
    import.meta.url,
  ));
  await assert.rejects(normalizeRosterUpload({
    examId,
    fileName: 'examination-room-beadle-class-list-template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: template.toString('base64'),
  }), (error) => error.code === 'ROSTER_EMPTY'
    && error.message === 'The class list contains no student rows.');
});

test('official exam roster requires a student name and import receipt', async () => {
  await assert.rejects(normalizeRosterUpload({
    examId,
    fileName: 'class-list.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: rosterXlsxBase64([
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS,
      ['ana@example.edu', '000012', ''],
    ]),
  }), (error) => error.code === 'ROSTER_NAME_REQUIRED');

  const row = {
    email: 'ana@example.edu',
    studentNumber: '000012',
    candidateNumber: '000012',
    displayName: 'Cruz, Ana, M.',
  };
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'import_exam_roster',
    examId,
    rows: [row],
    sourceHash: 'd'.repeat(64),
    requestKey,
  }), (error) => error.code === 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'import_exam_roster',
    examId,
    rows: [row],
    sourceHash: 'd'.repeat(64),
    requestKey,
    templateReceiptId: versionId,
    templateVersion: 'legacy-template',
  }), (error) => error.code === 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED');
});

test('exam-scoped roster operations preserve legacy classroom operations', async () => {
  const csv = 'Email,Student Number,Candidate Number\nana@example.edu,000012,0007\n';
  const intent = normalizeRosterUploadIntent({
    examId,
    fileName: 'exam.csv',
    mimeType: 'text/csv',
    base64: Buffer.from(csv).toString('base64'),
  });
  assert.equal(intent.examId, examId);
  assert.equal(intent.classroomId, null);
  assert.throws(() => normalizeRosterUploadIntent({
    examId,
    classroomId: versionId,
    fileName: 'ambiguous.csv',
    mimeType: 'text/csv',
  }), (error) => error.code === 'INVALID_ROSTER_SCOPE');

  const row = {
    email: 'ana@example.edu',
    studentNumber: '000012',
    candidateNumber: '000012',
    displayName: 'Cruz, Ana, M.',
  };
  assert.equal(normalizeExamRoomCommand({
    operation: 'validate_exam_roster',
    examId,
    rows: [row],
  }).examId, examId);
  assert.equal(normalizeExamRoomCommand({
    operation: 'import_exam_roster',
    examId,
    rows: [row],
    sourceHash: 'd'.repeat(64),
    requestKey,
    templateReceiptId: versionId,
    templateVersion: EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION,
  }).sourceHash, 'd'.repeat(64));
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'upsert_exam_roster_row',
    examId,
    row,
    reason: 'Corrected candidate assignment.',
    requestKey,
  }), (error) => error.code === 'INVALID_REQUEST');
});

test('v2 portal query contracts require their examination scope', () => {
  assert.equal(normalizeExamRoomQuery({ operation: 'exam_intent', examId }).examId, examId);
  assert.deepEqual(normalizeExamRoomQuery({ operation: 'preflight', examId }), {
    operation: 'preflight', examId, studentKey: null, deviceInstanceHash: null,
  });
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'preflight',
    examId,
    deviceInstanceHash: 'e'.repeat(64),
    studentKey: 'student-exam-code-secret',
  }), {
    operation: 'preflight',
    examId,
    studentKey: 'student-exam-code-secret',
    deviceInstanceHash: 'e'.repeat(64),
  });
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'beadle_student_entry',
    examId,
    deviceInstanceHash: 'f'.repeat(64),
  }), {
    operation: 'beadle_student_entry',
    examId,
    deviceInstanceHash: 'f'.repeat(64),
  });
  assert.equal(normalizeExamRoomQuery({ operation: 'beadle_portal' }).examId, null);
  const attempt = normalizeExamRoomQuery({
    operation: 'attempt', attemptId, sessionId, sessionEpoch: 2,
  });
  assert.equal(attempt.sessionId, sessionId);
  assert.equal(attempt.sessionEpoch, 2);
  assert.throws(() => normalizeExamRoomQuery({
    operation: 'attempt', attemptId, sessionId,
  }), (error) => error.code === 'SESSION_SCOPE_REQUIRED');
  assert.equal(normalizeExamRoomQuery({
    operation: 'submission_status', attemptId,
  }).attemptId, attemptId);
  assert.throws(() => normalizeExamRoomQuery({ operation: 'incident_summary' }));
  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'start_beadle_attempt',
    examId,
  }), {
    operation: 'start_beadle_attempt',
    examId,
  });
});

test('expired or revoked Beadle handoff maps to a terminal authorization error', () => {
  const error = examRoom2026DatabaseError({
    message: 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED private database detail',
  });
  assert.equal(error.code, 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED');
  assert.equal(error.status, 403);
  assert.doesNotMatch(error.message, /private database detail/);
});

test('grading model-answer retrieval accepts a remembered exam-scoped grading membership', () => {
  const gradingKey = 'professor-grading-key-secret';
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'live_status_v2', examId, gradingKey,
  }), {
    operation: 'live_status_v2', examId, gradingKey,
  });
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'grading_model_answer', examId, gradingKey,
  }), {
    operation: 'grading_model_answer', examId, gradingKey,
  });
  assert.deepEqual(normalizeExamRoomQuery({
    operation: 'grading_model_answer', examId,
  }), {
    operation: 'grading_model_answer', examId, gradingKey: null,
  });
  assert.deepEqual(normalizeExamRoomQuery({ operation: 'live_status_v2', examId }), {
    operation: 'live_status_v2', examId, gradingKey: null,
  });
  assert.equal(normalizeExamRoomCommand({
    operation: 'release_results', examId, requestKey, includeQuestionnaire: true,
  }).gradingKey, null);
});

test('session transfer verification failures map to a safe actionable conflict', () => {
  const error = examRoom2026DatabaseError({
    message: 'EXAM_ROOM_RECENT_VERIFICATION_REQUIRED internal detail must not escape',
  });
  assert.equal(error.code, 'EXAM_ROOM_RECENT_VERIFICATION_REQUIRED');
  assert.equal(error.status, 409);
  assert.match(error.message, /fresh physical or institutional identity verification/i);
  assert.equal(error.message.includes('internal detail'), false);
});

test('database one-way navigation denial maps to the same safe Worker contract', () => {
  const error = examRoom2026DatabaseError({
    message: 'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE internal database detail',
  });
  assert.equal(error.code, 'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE');
  assert.equal(error.status, 400);
  assert.equal(
    error.message,
    'One-way navigation is unavailable until durable server-side progress enforcement is enabled. Choose free navigation.',
  );
  assert.equal(error.message.includes('internal database detail'), false);
});

test('database model-answer upload denial maps to the stable unavailable contract', () => {
  const error = examRoom2026DatabaseError({
    message: 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE internal database detail',
  });
  assert.equal(error.code, 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE');
  assert.equal(error.status, 400);
  assert.equal(
    error.message,
    'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.',
  );
  assert.equal(error.message.includes('internal database detail'), false);
});

test('replacement, reopening, and break-glass database denials map without leaking internals', () => {
  const cases = [
    ['EXAM_ROOM_STUDENT_ACCESS_CODE_MISMATCH', 409, /does not match/i],
    ['EXAM_ROOM_REPLACEMENT_QUESTION_VERSION_INVALID', 409, /stage and confirm/i],
    ['EXAM_ROOM_RESCHEDULE_INVALID', 400, /valid opening/i],
    ['EXAM_ROOM_RESCHEDULE_NOT_ALLOWED', 409, /before any student starts/i],
    ['EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST', 409, /student has already started/i],
    ['EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON', 409, /current Beadle assignment period/i],
    ['EXAM_ROOM_REOPEN_GRADING_ALREADY_STARTED', 409, /grading has started/i],
    ['EXAM_ROOM_FRESH_AAL2_REQUIRED', 403, /fresh multi-factor/i],
    ['EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID', 403, /does not match/i],
  ];
  for (const [code, status, message] of cases) {
    const error = examRoom2026DatabaseError({ message: `${code} private database detail` });
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.match(error.message, message);
    assert.equal(error.message.includes('private database detail'), false);
  }
});

test('room-key database denials map to stable, plain-language contracts', () => {
  const cases = [
    ['EXAM_ROOM_ACTIVATION_INVALID', 400, /room details/i],
    ['EXAM_ROOM_ROOM_KEY_REQUIRED', 403, /one-time Professor key/i],
    ['EXAM_ROOM_ACTIVATION_LEDGER_INVALID', 400, /list limit/i],
    ['EXAM_ROOM_ACTIVATION_REVOKE_INVALID', 400, /documented reason/i],
    ['EXAM_ROOM_ACTIVATION_NOT_REVOCABLE', 409, /no longer be revoked/i],
    ['EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT', 409, /cannot be bound/i],
    ['EXAM_ROOM_ONE_EXAM_LIMIT', 409, /already has its examination/i],
  ];
  for (const [code, status, message] of cases) {
    const error = examRoom2026DatabaseError({ message: `${code} private database detail` });
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.match(error.message, message);
    assert.equal(error.message.includes('private database detail'), false);
  }
});

test('official roster-template receipt failures map to safe actionable contracts', () => {
  const expected = [
    ['EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED', 400],
    ['EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID', 403],
    ['EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED', 409],
    ['EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED', 409],
    ['EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH', 409],
  ];
  for (const [code, status] of expected) {
    const error = examRoom2026DatabaseError({ message: `${code}: private database detail` });
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.message.includes('private database detail'), false);
    assert.match(error.message, /template|class list/i);
  }
});

test('technical incident metadata must be an object and cannot carry recovery email data', () => {
  const base = {
    operation: 'record_technical_incident',
    attemptId,
    sessionId,
    sessionEpoch: 1,
    clientEventId: operationId,
    eventType: 'device_problem',
    clientOccurredAt: '2026-08-09T02:00:00Z',
  };
  assert.throws(() => normalizeExamRoomCommand({ ...base, details: ['unsafe'] }));
  assert.throws(
    () => normalizeExamRoomCommand({ ...base, details: { recoveryEmail: 'student@example.edu' } }),
    (error) => error.code === 'INTEGRITY_DETAILS_SENSITIVE',
  );
  assert.throws(
    () => normalizeExamRoomCommand({ ...base, details: { 'student-answer-copy': 'secret' } }),
    (error) => error.code === 'INTEGRITY_DETAILS_SENSITIVE',
  );
  assert.throws(
    () => normalizeExamRoomCommand({
      ...base,
      details: Object.fromEntries(Array.from({ length: 20 }, (_entry, index) => [
        `detail${index}`,
        'x'.repeat(500),
      ])),
    }),
    (error) => error.code === 'INTEGRITY_DETAILS_INVALID',
  );
});

test('published integrity signals require a device-bound session and idempotent event identity', () => {
  const normalized = normalizeExamRoomCommand({
    operation: 'record_integrity_event',
    attemptId,
    sessionId,
    sessionEpoch: 4,
    clientEventId: operationId,
    eventType: 'fullscreen_exit',
    details: { fullscreen: false },
    clientOccurredAt: '2026-08-09T02:00:00Z',
  });
  assert.equal(normalized.sessionId, sessionId);
  assert.equal(normalized.sessionEpoch, 4);
  assert.equal(normalized.clientEventId, operationId);
  assert.equal(normalized.eventType, 'fullscreen_exit');
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'record_integrity_event',
    attemptId,
    sessionEpoch: 4,
    clientEventId: operationId,
    eventType: 'fullscreen_exit',
    details: {},
    clientOccurredAt: '2026-08-09T02:00:00Z',
  }));
});

test('v2 heartbeat requires the active session identifier and epoch', () => {
  assert.deepEqual(normalizeExamRoomCommand({
    operation: 'heartbeat_v2', attemptId, sessionId, sessionEpoch: 4,
  }), {
    operation: 'heartbeat_v2', attemptId, sessionId, sessionEpoch: 4,
  });
  assert.throws(() => normalizeExamRoomCommand({
    operation: 'heartbeat_v2', attemptId, sessionEpoch: 4,
  }));
  assert.equal(normalizeExamRoomCommand({
    operation: 'heartbeat', attemptId,
  }).attemptId, attemptId, 'Legacy heartbeat remains normalized for pre-v2 attempts.');
});
