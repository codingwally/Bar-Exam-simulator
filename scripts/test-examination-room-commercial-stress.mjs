import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

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

const EXAM_COUNT = 100;
const STUDENTS_PER_EXAM = 30;
const api = createDemoApi();
const startedAt = performance.now();
let flowChecks = 0;
let keyApprovals = 0;
let studentAdmissions = 0;
let answerSaves = 0;
let submissions = 0;
let gradeSaves = 0;
let releases = 0;

for (let examIndex = 1; examIndex <= EXAM_COUNT; examIndex += 1) {
  api.resetDemo();
  const initial = await api.professorQuery('session');
  const examId = crypto.randomUUID();
  const exam = {
    ...initial.exam,
    id: examId,
    versionId: crypto.randomUUID(),
    status: 'draft',
    title: `Commercial stress examination ${examIndex}`,
    admissionMode: 'key_only',
    allowedEmails: [],
    roster: [],
  };

  const saved = await api.professorCommand('save_draft', { exam }, `stress-save-${examIndex}`);
  assert.equal(saved.exam.id, examId);
  flowChecks += 1;

  const published = await api.professorCommand('publish', { exam: saved.exam }, `stress-publish-${examIndex}`);
  assert.equal(published.exam.status, 'awaiting_activation');
  assert.equal(published.exam.roster.length, 0);
  flowChecks += 1;

  const approvalRequestId = `stress-approve-${String(examIndex).padStart(4, '0')}`;
  const approved = await api.adminCommand('activate_exam', { examId }, approvalRequestId);
  const replayedApproval = await api.adminCommand('activate_exam', { examId }, approvalRequestId);
  assert.equal(replayedApproval.duplicate, true);
  assert.equal(replayedApproval.activation.id, approved.activation.id);
  assert.equal(replayedApproval.roomKey, approved.roomKey);
  keyApprovals += 1;
  flowChecks += 1;

  const creatorSession = await api.professorQuery('session');
  assert.equal(creatorSession.activation.id, approved.activation.id);
  await api.professorCommand('open_room', { examId }, `stress-open-${examIndex}`);
  flowChecks += 1;

  const sessionIds = [];
  for (let studentIndex = 1; studentIndex <= STUDENTS_PER_EXAM; studentIndex += 1) {
    const identity = {
      fullName: `Stress Student ${examIndex}-${studentIndex}`,
      studentNumber: `E${String(examIndex).padStart(3, '0')}-S${String(studentIndex).padStart(3, '0')}`,
      email: `student.${examIndex}.${studentIndex}@example.test`,
      subject: exam.subject,
      yearLevel: exam.yearLevel,
    };
    const preview = await api.studentPreview({ roomKey: approved.roomKey, identity });
    const consent = await api.studentConsent({
      roomKey: approved.roomKey,
      identity,
      noticeVersion: preview.metadata.noticeVersion,
      agreed: true,
    }, `stress-consent-${examIndex}-${studentIndex}`);
    sessionIds.push(consent.session.id);
    studentAdmissions += 1;

    for (const question of exam.questions) {
      await api.studentCommand('save_answer', {
        sessionId: consent.session.id,
        sessionToken: consent.session.id,
        questionId: question.id,
        answer: question.type === 'multiple_choice'
          ? 'option-2'
          : `Complete stress answer for ${question.id}, exam ${examIndex}, student ${studentIndex}.`,
        flagged: false,
      }, `stress-answer-${examIndex}-${studentIndex}-${question.id}`);
      answerSaves += 1;
    }

    await api.studentCommand('submit', {
      sessionId: consent.session.id,
      sessionToken: consent.session.id,
    }, `stress-submit-${examIndex}-${studentIndex}`);
    submissions += 1;

    for (const question of exam.questions) {
      await api.professorCommand('save_grade', {
        examId,
        sessionId: consent.session.id,
        questionId: question.id,
        points: question.points,
        feedback: `Verified stress grade for ${question.id}.`,
      }, `stress-grade-${examIndex}-${studentIndex}-${question.id}`);
      gradeSaves += 1;
    }
  }

  const released = await api.professorCommand('release_results', {
    examId,
    sessionIds,
  }, `stress-release-${examIndex}`);
  assert.equal(released.release.sessionIds.length, STUDENTS_PER_EXAM);
  releases += 1;

  const monitor = await api.professorQuery('monitor', { examId });
  assert.equal(monitor.sessions.length, STUDENTS_PER_EXAM);
  assert.equal(monitor.submissions.length, STUDENTS_PER_EXAM);
  assert.equal(monitor.exam.roster.length, STUDENTS_PER_EXAM);
  flowChecks += 1;

  const result = await api.getResult({
    attemptId: sessionIds[sessionIds.length - 1],
    sessionToken: sessionIds[sessionIds.length - 1],
  });
  assert.equal(result.released, true);
  assert.equal(result.totalScore, 100);
}

const durationMs = Math.round(performance.now() - startedAt);
const expectedQuestionOperations = EXAM_COUNT * STUDENTS_PER_EXAM * 4;
assert.equal(flowChecks, 500);
assert.equal(keyApprovals, 100);
assert.equal(studentAdmissions, 3_000);
assert.equal(answerSaves, expectedQuestionOperations);
assert.equal(submissions, 3_000);
assert.equal(gradeSaves, expectedQuestionOperations);
assert.equal(releases, 100);

console.log(JSON.stringify({
  ok: true,
  exams: EXAM_COUNT,
  examineesPerExam: STUDENTS_PER_EXAM,
  examineeJourneys: studentAdmissions,
  flowChecks,
  keyApprovals,
  answerSaves,
  submissions,
  gradeSaves,
  releases,
  durationMs,
}, null, 2));
