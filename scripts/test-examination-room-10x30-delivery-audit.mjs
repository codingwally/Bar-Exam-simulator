import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  buildExaminationRoomKeyEmail,
  deliverExaminationRoomPublicationRequestEmail,
  deliverExaminationRoomResultReleaseEmails,
} from '../worker/examination-room-email.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

function loadOfflineGradingCore() {
  const sandbox = {
    module: { exports: {} },
    exports: {},
    Buffer,
    TextDecoder,
    TextEncoder,
    crypto: crypto.webcrypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(repositoryRoot, 'examination-room', 'offline-grading-core.js'), 'utf8'),
    sandbox,
    { filename: 'offline-grading-core.js' },
  );
  return sandbox.module.exports;
}

const offlineGradingCore = loadOfflineGradingCore();

const EXAM_COUNT = 10;
const STUDENTS_PER_EXAM = 30;
const KEY_ONLY_EXAMS = 8;
const QUESTIONS_PER_EXAM = 4;
const AUDIT_FORMAT = 'duediligence-examination-room-10x30-audit-v1';

function argument(name, fallback = '') {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function safeRunId() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

const outputDirectory = path.resolve(argument(
  '--output',
  path.join(os.tmpdir(), `duediligence-examination-room-10x30-${safeRunId()}`),
));
const auditRecipient = String(process.env.EXAMINATION_ROOM_AUDIT_RECIPIENT || '').trim().toLowerCase();
assert.match(
  auditRecipient,
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
  'Set EXAMINATION_ROOM_AUDIT_RECIPIENT to the approved single email sink. It is used only in memory and is never written to audit artifacts.',
);

function createDemoApi() {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const window = {
    location: { search: '?demo=1', hostname: '127.0.0.1' },
    localStorage,
    crypto: { randomUUID: crypto.randomUUID },
    addEventListener() {},
  };
  const sandbox = {
    window,
    globalThis: null,
    BroadcastChannel: undefined,
    URLSearchParams,
    structuredClone,
    crypto: window.crypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(repositoryRoot, 'examination-room', 'view-models.js'), 'utf8'),
    sandbox,
    { filename: 'view-models.js' },
  );
  window.ExaminationRoomV1ViewModels = sandbox.ExaminationRoomV1ViewModels;
  vm.runInNewContext(
    fs.readFileSync(path.join(repositoryRoot, 'examination-room', 'api.js'), 'utf8'),
    sandbox,
    { filename: 'api.js' },
  );
  return window.ExaminationRoomV1Api;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`, 'utf8');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relativeOutputPath(filePath) {
  return path.relative(outputDirectory, filePath).replace(/\\/gu, '/');
}

function outputFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? outputFiles(entryPath) : [entryPath];
  });
}

function resultRows(exam, grading, resultBySession) {
  const latestGrades = new Map();
  for (const grade of grading.gradeRevisions) {
    latestGrades.set(`${grade.sessionId}:${grade.questionId}`, grade);
  }
  return [
    ['exam_id', 'exam_title', 'student_session_id', 'student_name', 'student_number', 'status', 'score', 'maximum', 'released_at'],
    ...grading.sessions.map((session) => {
      const score = exam.questions.reduce(
        (total, question) => total + Number(latestGrades.get(`${session.id}:${question.id}`)?.points || 0),
        0,
      );
      const result = resultBySession.get(session.id);
      return [
        exam.id,
        exam.title,
        session.id,
        session.fullName,
        session.studentNumber,
        result?.released === true ? 'released' : 'awaiting_grade',
        score,
        exam.questions.reduce((total, question) => total + Number(question.points || 0), 0),
        result?.releasedAt || '',
      ];
    }),
  ];
}

async function mockEmailAudit(representativeResultRelease) {
  const accepted = [];
  const mockProvider = async (url, options = {}) => {
    const payload = JSON.parse(String(options.body || '{}'));
    const messages = Array.isArray(payload) ? payload : [payload];
    assert.ok(messages.length > 0, 'Every mock provider request must contain at least one email.');
    const type = String(options.headers?.['X-Audit-Email-Type'] || 'publication_request');
    const responseEntries = messages.map((message) => {
      const recipients = [message.to, message.bcc].flat().filter(Boolean);
      assert.ok(recipients.includes(auditRecipient), 'Every mock email type must use the approved audit sink.');
      const providerId = `mock_${type}_${String(accepted.length + 1).padStart(2, '0')}`;
      accepted.push({
        type,
        providerId,
        subject: String(message.subject || '').slice(0, 200),
        logoPresent: String(message.html || '').includes('/assets/brand/logo1-master.png'),
        transport: Array.isArray(payload) ? 'mock_resend_batch' : 'mock_resend_single',
        evidenceLevel: 'mock_transport_only',
      });
      return { id: providerId };
    });
    assert.equal(
      url,
      Array.isArray(payload) ? 'https://api.resend.com/emails/batch' : 'https://api.resend.com/emails',
    );
    return new Response(JSON.stringify(Array.isArray(payload) ? { data: responseEntries } : responseEntries[0]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const publication = await deliverExaminationRoomPublicationRequestEmail({
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Examination Room Audit <audit@duediligence.ph>',
    EXAMINATION_ROOM_PUBLIC_ORIGIN: 'https://duediligence.ph',
    RESEND_API_KEY: 'audit-placeholder-never-sent',
  }, {
    recipients: [auditRecipient],
    idempotencyHash: crypto.createHash('sha256').update('10x30-publication-request').digest('hex'),
    examId: crypto.randomUUID(),
    version: 1,
    publishedAt: new Date().toISOString(),
    examTitle: 'Commercial readiness audit examination',
    subject: 'Constitutional Law',
    questionCount: QUESTIONS_PER_EXAM,
  }, async (url, options) => mockProvider(url, {
    ...options,
    headers: { ...options.headers, 'X-Audit-Email-Type': 'publication_request' },
  }));
  assert.equal(publication.status, 'sent');
  assert.equal(publication.providerId, 'mock_publication_request_01');

  for (const [type, roomKey] of [
    ['key_approval', 'DD26-AUDT-0001'],
    ['key_resend', 'DD26-AUDT-0001'],
    ['key_rotation', 'DD26-AUDT-0002'],
  ]) {
    const email = buildExaminationRoomKeyEmail({
      EXAMINATION_ROOM_PUBLIC_ORIGIN: 'https://duediligence.ph',
    }, {
      professorName: 'Audit creator',
      examTitle: 'Commercial readiness audit examination',
      roomKey,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const response = await mockProvider('https://api.resend.com/emails', {
      headers: { 'X-Audit-Email-Type': type },
      body: JSON.stringify({
        from: 'Examination Room Audit <audit@duediligence.ph>',
        to: [auditRecipient],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    assert.equal(response.ok, true);
  }

  assert.ok(representativeResultRelease, 'The 10x30 journey must provide one released result for mock delivery.');
  const resultRelease = await deliverExaminationRoomResultReleaseEmails({
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Examination Room Audit <audit@duediligence.ph>',
    EXAMINATION_ROOM_PUBLIC_ORIGIN: 'https://duediligence.ph',
    RESEND_API_KEY: 'audit-placeholder-never-sent',
  }, {
    recipients: [{ ...representativeResultRelease, recipient: auditRecipient }],
    idempotencyHash: crypto.createHash('sha256').update('10x30-result-release').digest('hex'),
  }, async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails/batch');
    assert.equal(options.method, 'POST');
    assert.match(String(options.headers?.['Idempotency-Key'] || ''), /^exam-room-results-[0-9a-f]{64}-001$/u);
    const payload = JSON.parse(String(options.body || '[]'));
    assert.equal(payload.length, 1);
    assert.deepEqual(payload[0].tags, [
      { name: 'product', value: 'examination-room' },
      { name: 'message_type', value: 'result-release' },
    ]);
    return mockProvider(url, {
      ...options,
      headers: { ...options.headers, 'X-Audit-Email-Type': 'result_release' },
    });
  });
  const resultReleaseProviderAcceptanceIds = resultRelease.outcomes
    .map((outcome) => outcome.providerId)
    .filter(Boolean);
  assert.equal(resultRelease.status, 'sent');
  assert.equal(resultRelease.acceptedCount, 1);
  assert.equal(resultRelease.failedCount, 0);
  assert.equal(resultRelease.skippedCount, 0);
  assert.equal(resultRelease.outcomes.length, 1);
  assert.equal(resultReleaseProviderAcceptanceIds.length, 1);
  assert.equal(resultReleaseProviderAcceptanceIds[0], 'mock_result_release_05');
  assert.equal(accepted.filter((entry) => entry.type === 'result_release').length, 1);

  return {
    sink: 'redacted',
    sinkConfigured: true,
    realProviderContacted: false,
    evidenceLevel: 'template_and_mock_transport_only',
    accepted,
    resultReleaseEmail: {
      implemented: true,
      attempted: true,
      transport: 'mock_resend_batch',
      status: resultRelease.status,
      acceptedCount: resultRelease.acceptedCount,
      providerAcceptanceIds: resultReleaseProviderAcceptanceIds,
      providerId: resultReleaseProviderAcceptanceIds[0],
      retrySafe: resultRelease.retrySafe,
      blocker: null,
    },
  };
}

const api = createDemoApi();
const startedAt = new Date().toISOString();
const started = performance.now();
const artifactFiles = [];
const examEvidence = [];
let representativeResultRelease = null;
const totals = {
  exams: 0,
  keyOnlyExams: 0,
  emailAllowlistExams: 0,
  students: 0,
  allowlistRejections: 0,
  approvalReplays: 0,
  automaticCreatorAccessSignals: 0,
  answerSaves: 0,
  submissions: 0,
  gradeSaves: 0,
  releaseBatches: 0,
  releasedResults: 0,
  verifiedResultViews: 0,
};

fs.mkdirSync(outputDirectory, { recursive: true });

for (let examIndex = 1; examIndex <= EXAM_COUNT; examIndex += 1) {
  api.resetDemo();
  const initial = await api.professorQuery('session');
  const examId = crypto.randomUUID();
  const admissionMode = examIndex <= KEY_ONLY_EXAMS ? 'key_only' : 'email_allowlist';
  const allowedEmails = Array.from({ length: STUDENTS_PER_EXAM }, (_, studentOffset) => (
    `audit.exam${String(examIndex).padStart(2, '0')}.student${String(studentOffset + 1).padStart(2, '0')}@example.test`
  ));
  const exam = {
    ...initial.exam,
    id: examId,
    versionId: crypto.randomUUID(),
    status: 'draft',
    title: `Commercial audit examination ${String(examIndex).padStart(2, '0')}`,
    admissionMode,
    allowedEmails: admissionMode === 'email_allowlist' ? allowedEmails : [],
    roster: [],
  };

  const saved = await api.professorCommand('save_draft', { exam }, `audit-save-${examIndex}`);
  assert.equal(saved.exam.id, examId);
  const versioned = await api.professorCommand('save_draft', {
    exam: { ...saved.exam, versionId: exam.versionId },
  }, `audit-version-${examIndex}`);
  assert.equal(versioned.exam.versionId, exam.versionId);
  const published = await api.professorCommand('publish', { exam: versioned.exam }, `audit-publish-${examIndex}`);
  assert.equal(published.exam.status, 'awaiting_activation');
  assert.equal(published.exam.roster.length, 0);

  const approvalRequestId = `audit-approve-${String(examIndex).padStart(4, '0')}`;
  const approved = await api.adminCommand('activate_exam', { examId }, approvalRequestId);
  const replayedApproval = await api.adminCommand('activate_exam', { examId }, approvalRequestId);
  assert.equal(replayedApproval.duplicate, true);
  assert.equal(replayedApproval.activation.id, approved.activation.id);
  assert.equal(replayedApproval.roomKey, approved.roomKey);
  totals.approvalReplays += 1;

  const creatorSession = await api.professorQuery('session');
  assert.equal(creatorSession.activation.id, approved.activation.id);
  assert.ok(['active', 'scheduled', 'open'].includes(creatorSession.activation.status));
  totals.automaticCreatorAccessSignals += 1;
  await api.professorCommand('open_room', { examId }, `audit-open-${examIndex}`);

  if (admissionMode === 'email_allowlist') {
    await assert.rejects(
      api.studentPreview({
        roomKey: approved.roomKey,
        identity: {
          fullName: 'Rejected outsider',
          studentNumber: `OUT-${examIndex}`,
          email: `outsider.exam${examIndex}@example.test`,
          subject: exam.subject,
          yearLevel: exam.yearLevel,
        },
      }),
      (error) => error?.code === 'STUDENT_EMAIL_NOT_ALLOWED',
    );
    totals.allowlistRejections += 1;
  }

  const sessionIds = [];
  for (let studentIndex = 1; studentIndex <= STUDENTS_PER_EXAM; studentIndex += 1) {
    const identity = {
      fullName: `Audit Student ${examIndex}-${studentIndex}`,
      studentNumber: `E${String(examIndex).padStart(2, '0')}-S${String(studentIndex).padStart(2, '0')}`,
      email: admissionMode === 'email_allowlist' ? allowedEmails[studentIndex - 1] : '',
      subject: exam.subject,
      yearLevel: exam.yearLevel,
    };
    const preview = await api.studentPreview({ roomKey: approved.roomKey, identity });
    const consent = await api.studentConsent({
      roomKey: approved.roomKey,
      identity,
      noticeVersion: preview.metadata.noticeVersion,
      agreed: true,
    }, `audit-consent-${examIndex}-${studentIndex}`);
    sessionIds.push(consent.session.id);
    totals.students += 1;

    for (const question of exam.questions) {
      await api.studentCommand('save_answer', {
        sessionId: consent.session.id,
        sessionToken: consent.session.id,
        questionId: question.id,
        answer: question.type === 'multiple_choice'
          ? 'option-2'
          : `Complete audit answer for exam ${examIndex}, student ${studentIndex}, question ${question.id}.`,
        flagged: false,
      }, `audit-answer-${examIndex}-${studentIndex}-${question.id}`);
      totals.answerSaves += 1;
    }

    await api.studentCommand('submit', {
      sessionId: consent.session.id,
      sessionToken: consent.session.id,
    }, `audit-submit-${examIndex}-${studentIndex}`);
    totals.submissions += 1;

    for (const question of exam.questions) {
      await api.professorCommand('save_grade', {
        examId,
        sessionId: consent.session.id,
        questionId: question.id,
        points: question.points,
        feedback: `Commercial audit feedback for ${question.id}.`,
      }, `audit-grade-${examIndex}-${studentIndex}-${question.id}`);
      totals.gradeSaves += 1;
    }
  }

  const released = await api.professorCommand('release_results', {
    examId,
    sessionIds,
  }, `audit-release-${examIndex}`);
  assert.equal(released.release.sessionIds.length, STUDENTS_PER_EXAM);
  totals.releaseBatches += 1;
  totals.releasedResults += released.release.sessionIds.length;

  const monitor = await api.professorQuery('monitor', { examId });
  const grading = await api.professorQuery('grading', { examId });
  assert.equal(monitor.sessions.length, STUDENTS_PER_EXAM);
  assert.equal(monitor.submissions.length, STUDENTS_PER_EXAM);
  assert.equal(grading.gradeRevisions.length, STUDENTS_PER_EXAM * QUESTIONS_PER_EXAM);

  const resultBySession = new Map();
  for (const sessionId of sessionIds) {
    const result = await api.getResult({ attemptId: sessionId, sessionToken: sessionId });
    assert.equal(result.released, true);
    assert.equal(result.totalScore, 100);
    resultBySession.set(sessionId, result);
    totals.verifiedResultViews += 1;
  }

  if (!representativeResultRelease) {
    const representativeSessionId = sessionIds[0];
    const representativeSession = grading.sessions.find((session) => session.id === representativeSessionId);
    const representativeResult = resultBySession.get(representativeSessionId);
    assert.ok(representativeSession);
    assert.ok(representativeResult);
    representativeResultRelease = {
      sessionId: representativeSessionId,
      releaseId: released.release.id,
      studentName: representativeSession.fullName,
      examTitle: grading.exam.title,
      subject: grading.exam.subject,
      totalScore: representativeResult.totalScore,
      maximumScore: representativeResult.totalPossible,
      releasedAt: representativeResult.releasedAt,
    };
  }

  const examFolder = path.join(outputDirectory, `exam-${String(examIndex).padStart(2, '0')}`);
  const monitorPath = path.join(examFolder, 'professor-monitor-snapshot.json');
  writeJson(monitorPath, {
    generatedAt: new Date().toISOString(),
    exam: monitor.exam,
    activation: monitor.activation,
    sessions: monitor.sessions,
    submissions: monitor.submissions,
    incidents: monitor.incidents,
    note: 'Monitor download intentionally excludes raw room keys and student answers.',
  });
  artifactFiles.push(monitorPath);

  const offlinePayload = {
    format: offlineGradingCore.FORMAT,
    exportedAt: new Date().toISOString(),
    exam: {
      id: grading.exam.id,
      versionId: grading.exam.versionId,
      title: grading.exam.title,
      questions: grading.exam.questions,
    },
    sessions: grading.sessions,
    submissions: grading.submissions,
    answerRevisions: grading.answerRevisions,
    gradeRevisions: grading.gradeRevisions,
    privacy: 'Synthetic commercial-readiness audit data.',
  };
  const ephemeralPassphrase = crypto.randomBytes(24).toString('base64url');
  const wrapper = await offlineGradingCore.encryptPayload(offlinePayload, ephemeralPassphrase, crypto.webcrypto);
  const decrypted = await offlineGradingCore.decryptWrapper(wrapper, ephemeralPassphrase, crypto.webcrypto);
  assert.equal(decrypted.exam.id, examId);
  assert.equal(decrypted.sessions.length, STUDENTS_PER_EXAM);
  const offlinePath = path.join(examFolder, 'professor-offline-grading.ddgrade.json');
  writeJson(offlinePath, wrapper);
  artifactFiles.push(offlinePath);

  const gradebookPath = path.join(examFolder, 'professor-gradebook.csv');
  writeCsv(gradebookPath, resultRows(grading.exam, grading, resultBySession));
  artifactFiles.push(gradebookPath);

  const adminPath = path.join(examFolder, 'admin-full-examination-export.json');
  writeJson(adminPath, {
    generatedAt: new Date().toISOString(),
    exam: grading.exam,
    activation: monitor.activation,
    students: grading.sessions,
    sessions: grading.sessions,
    submissions: grading.submissions,
    answers: grading.answerRevisions,
    grades: grading.gradeRevisions,
    releases: grading.releases,
  });
  artifactFiles.push(adminPath);

  examEvidence.push({
    examIndex,
    examId,
    admissionMode,
    configuredAllowedEmails: admissionMode === 'email_allowlist' ? STUDENTS_PER_EXAM : 0,
    allowlistOutsiderRejected: admissionMode === 'email_allowlist',
    studentsAdmitted: sessionIds.length,
    answersSaved: grading.answerRevisions.length,
    submissions: grading.submissions.length,
    gradesSaved: grading.gradeRevisions.length,
    releasedResults: released.release.sessionIds.length,
    resultViewsVerified: resultBySession.size,
    resultScore: 100,
    automaticCreatorAccessAfterApproval: true,
    approvalIdempotencyReplayVerified: true,
    offlinePackageRoundTripVerified: true,
    files: [monitorPath, offlinePath, gradebookPath, adminPath].map(relativeOutputPath),
  });

  totals.exams += 1;
  if (admissionMode === 'key_only') totals.keyOnlyExams += 1;
  else totals.emailAllowlistExams += 1;
}

assert.deepEqual(totals, {
  exams: 10,
  keyOnlyExams: 8,
  emailAllowlistExams: 2,
  students: 300,
  allowlistRejections: 2,
  approvalReplays: 10,
  automaticCreatorAccessSignals: 10,
  answerSaves: 1_200,
  submissions: 300,
  gradeSaves: 1_200,
  releaseBatches: 10,
  releasedResults: 300,
  verifiedResultViews: 300,
});

const emailEvidence = await mockEmailAudit(representativeResultRelease);
const emailEvidencePath = path.join(outputDirectory, 'email-evidence.json');
writeJson(emailEvidencePath, emailEvidence);
artifactFiles.push(emailEvidencePath);

const artifacts = artifactFiles
  .map((filePath) => ({
    file: relativeOutputPath(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  }))
  .sort((left, right) => left.file.localeCompare(right.file));
const manifestPath = path.join(outputDirectory, 'artifact-manifest.json');
writeJson(manifestPath, { format: AUDIT_FORMAT, artifacts });
const checksumsPath = path.join(outputDirectory, 'checksums.sha256');
fs.writeFileSync(
  checksumsPath,
  `${artifacts.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
  'utf8',
);

const resultEmailGap = !(
  emailEvidence.resultReleaseEmail.implemented === true
  && emailEvidence.resultReleaseEmail.attempted === true
  && emailEvidence.resultReleaseEmail.transport === 'mock_resend_batch'
  && emailEvidence.resultReleaseEmail.status === 'sent'
  && emailEvidence.resultReleaseEmail.providerAcceptanceIds.length === 1
);
const report = {
  format: AUDIT_FORMAT,
  status: resultEmailGap ? 'journey_pass_with_email_gap' : 'pass',
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: Math.round(performance.now() - started),
  scope: {
    exams: EXAM_COUNT,
    studentsPerExam: STUDENTS_PER_EXAM,
    keyOnlyExams: [1, 2, 3, 4, 5, 6, 7, 8],
    emailAllowlistExams: [9, 10],
  },
  totals,
  assertions: {
    exactScale: totals.exams === 10 && totals.students === 300,
    admissionModes: totals.keyOnlyExams === 8 && totals.emailAllowlistExams === 2,
    idempotentApproval: totals.approvalReplays === 10,
    automaticCreatorAccess: totals.automaticCreatorAccessSignals === 10,
    answerSubmissionGradingRelease: totals.verifiedResultViews === 300,
    allowlistEnforced: totals.allowlistRejections === 2,
    downloadableArtifactsChecksummed: artifacts.length === 41,
    realEmailDeliveryProven: false,
    resultReleaseEmailImplemented: !resultEmailGap,
    resultReleaseEmailMockAccepted: !resultEmailGap,
    runtimeSinkPersisted: false,
  },
  emailEvidence,
  realDelivery: {
    attemptedByHarness: false,
    providerAcceptanceIds: [],
    reason: 'This deterministic harness never reads deployment credentials or contacts a live email provider.',
  },
  exams: examEvidence,
  artifactManifest: relativeOutputPath(manifestPath),
  checksumFile: relativeOutputPath(checksumsPath),
  privacy: 'The approved audit sink remained memory-only and is redacted from every generated artifact.',
};
const reportPath = path.join(outputDirectory, 'audit-report.json');
writeJson(reportPath, report);
const leakedSinkFiles = outputFiles(outputDirectory).filter((filePath) => (
  fs.readFileSync(filePath).toString('utf8').toLowerCase().includes(auditRecipient)
));
assert.deepEqual(
  leakedSinkFiles,
  [],
  'The runtime audit sink must not be persisted in any generated artifact.',
);
const reportChecksumPath = path.join(outputDirectory, 'audit-report.sha256');
fs.writeFileSync(reportChecksumPath, `${sha256File(reportPath)}  audit-report.json\n`, 'utf8');

console.log(JSON.stringify({
  ok: !resultEmailGap,
  status: report.status,
  outputDirectory,
  totals,
  artifactCount: artifacts.length,
  mockEmailProviderAcceptances: emailEvidence.accepted.map(({ type, providerId }) => ({ type, providerId })),
  realProviderAcceptanceIds: [],
  blockers: resultEmailGap ? [emailEvidence.resultReleaseEmail.blocker] : [],
}, null, 2));
