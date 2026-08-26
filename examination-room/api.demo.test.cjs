'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function demoApi() {
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
    fs.readFileSync(path.join(__dirname, 'view-models.js'), 'utf8'),
    sandbox,
    { filename: 'view-models.js' },
  );
  window.ExaminationRoomV1ViewModels = sandbox.ExaminationRoomV1ViewModels;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'),
    sandbox,
    { filename: 'api.js' },
  );
  return window.ExaminationRoomV1Api;
}

test('demo student path withholds answer keys and releases only complete professor feedback', async () => {
  const api = demoApi();
  api.resetDemo();
  const sessionView = await api.professorQuery('session');
  const published = await api.professorCommand('publish', { exam: sessionView.exam }, 'publish-1');
  assert.equal(published.exam.status, 'awaiting_activation');
  const activation = await api.adminCommand('activate_exam', { examId: sessionView.exam.id }, 'activate-1');
  const emailedKey = await api.adminCommand('email_key', { examId: sessionView.exam.id }, 'email-key-1');
  assert.equal(emailedKey.roomKey, api.demoRoomKey);
  assert.equal(emailedKey.deliveryStatus, 'demo_delivered');
  await api.professorCommand('open_room', { examId: sessionView.exam.id, roomKey: activation.roomKey }, 'open-1');

  const identity = {
    fullName: 'Maria Theresa Dela Cruz',
    studentNumber: '2024-10001',
    subject: 'Constitutional Law',
    yearLevel: '2L',
  };
  const preview = await api.studentPreview({ roomKey: activation.roomKey, ...identity, identity });
  const consent = await api.studentConsent({
    roomKey: activation.roomKey,
    identity,
    noticeVersion: preview.metadata.noticeVersion,
    agreed: true,
  }, 'consent-1');
  const studentPayload = JSON.stringify(consent.exam);
  assert.equal(studentPayload.includes('correctOption'), false);
  assert.equal(studentPayload.includes('gradingGuidance'), false);
  assert.equal(studentPayload.includes('acceptedAnswers'), false);

  const attemptId = consent.session.id;
  const sessionToken = consent.session.id;
  const loaded = await api.loadExam({ attemptId, sessionToken });
  assert.equal(loaded.questions[3].type, 'multiple_choice');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.questions[3].options[1])), { id: 'option-2', label: 'Supreme Court' });
  assert.equal(JSON.stringify(loaded).includes('correctOption'), false);

  const answers = ['Essay one', 'Essay two', 'Short answer', 'option-2'];
  for (let index = 0; index < answers.length; index += 1) {
    await api.studentCommand('save_answer', {
      sessionId: attemptId,
      sessionToken,
      questionId: `q-${index + 1}`,
      answer: answers[index],
      flagged: false,
    }, `answer-${index + 1}`);
  }
  await api.studentCommand('submit', { sessionId: attemptId, sessionToken }, 'submit-1');

  const waiting = await api.getResult({ attemptId, sessionToken });
  assert.equal(waiting.released, false);
  assert.equal(waiting.questions.length, 0);

  const points = [26, 22, 18, 25];
  for (let index = 0; index < points.length; index += 1) {
    await api.professorCommand('save_grade', {
      examId: sessionView.exam.id,
      sessionId: attemptId,
      questionId: `q-${index + 1}`,
      points: points[index],
      feedback: `Professor feedback ${index + 1}`,
    }, `grade-${index + 1}`);
  }
  await api.professorCommand('release_results', {
    examId: sessionView.exam.id,
    sessionIds: [attemptId],
  }, 'release-1');

  const released = await api.getResult({ attemptId, sessionToken });
  assert.equal(released.released, true);
  assert.equal(released.totalScore, 91);
  assert.equal(released.totalPossible, 100);
  assert.equal(released.questions.length, 4);
  assert.equal(released.questions[3].feedback, 'Professor feedback 4');
  assert.equal(JSON.stringify(released).includes('correctOption'), false);
});
