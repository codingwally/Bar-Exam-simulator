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

test('demo owner preflight exposes the same four safe readiness checks', async () => {
  const result = await demoApi().adminQuery('preflight');
  assert.equal(result.ready, true);
  assert.deepEqual(Array.from(result.checks, (check) => check.id), [
    'owner_data_key',
    'owner_email_recipients',
    'key_email_delivery',
    'encrypted_recovery',
  ]);
  assert.equal(result.checks.every((check) => check.ok === true), true);
  for (const check of result.checks) {
    assert.equal(Object.prototype.hasOwnProperty.call(check, 'keyVersion'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(check, 'binding'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(check, 'recipients'), false);
  }
});

test('demo Professor can create another examination with a new durable identifier', async () => {
  const api = demoApi();
  api.resetDemo();
  const first = await api.professorQuery('session');
  const nextId = crypto.randomUUID();
  const saved = await api.professorCommand('save_draft', {
    exam: {
      ...first.exam,
      id: nextId,
      versionId: null,
      status: 'draft',
      title: 'Constitutional Law — Second Examination',
    },
  }, 'create-second-exam');
  const next = await api.professorQuery('session');

  assert.equal(saved.exam.id, nextId);
  assert.equal(saved.exam.status, 'draft');
  assert.equal(next.exam.id, nextId);
  assert.equal(next.exams.length, 2);
  assert.equal(next.exams.some((exam) => exam.id === first.exam.id), true);
  assert.equal(next.exams.some((exam) => exam.id === nextId), true);

  const reopenedFirst = await api.professorQuery('exam', { examId: first.exam.id });
  assert.equal(reopenedFirst.exam.id, first.exam.id);
  assert.equal(reopenedFirst.exam.title, first.exam.title);
  const reopenedSecond = await api.professorQuery('exam', { examId: nextId });
  assert.equal(reopenedSecond.exam.id, nextId);
  assert.equal(reopenedSecond.exam.title, 'Constitutional Law — Second Examination');
  assert.equal((await api.professorQuery('session')).exams.length, 2);
});

test('demo switching preserves each examination bundle and never duplicates an existing inactive exam', async () => {
  const api = demoApi();
  api.resetDemo();
  const first = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: first.exam }, 'publish-first-bundle');
  const firstActivation = await api.adminCommand(
    'activate_exam',
    { examId: first.exam.id },
    'activate-first-bundle',
  );

  const secondId = crypto.randomUUID();
  await api.professorCommand('save_draft', {
    exam: {
      ...first.exam,
      id: secondId,
      versionId: null,
      status: 'draft',
      title: 'Civil Law — Separate Final Examination',
    },
  }, 'create-second-bundle');

  const restoredFirst = await api.professorQuery('exam', { examId: first.exam.id });
  assert.equal(restoredFirst.exam.status, 'active');
  assert.equal(restoredFirst.activation.id, firstActivation.activation.id);
  const firstUpdatedTitle = 'Constitutional Law — Preserved and Revised';

  await api.professorQuery('exam', { examId: secondId });
  await api.professorCommand('save_draft', {
    exam: { ...restoredFirst.exam, title: firstUpdatedTitle },
  }, 'save-existing-inactive-first');

  const afterExistingSave = await api.professorQuery('session');
  assert.equal(afterExistingSave.exam.id, first.exam.id);
  assert.equal(afterExistingSave.exam.title, firstUpdatedTitle);
  assert.equal(afterExistingSave.exams.length, 2);
  assert.equal(new Set(afterExistingSave.exams.map((exam) => exam.id)).size, 2);

  const restoredSecond = await api.professorQuery('exam', { examId: secondId });
  assert.equal(restoredSecond.exam.title, 'Civil Law — Separate Final Examination');
  assert.equal(restoredSecond.activation, null);
  await assert.rejects(
    api.professorQuery('exam', { examId: crypto.randomUUID() }),
    (error) => error.code === 'EXAM_NOT_FOUND' && error.status === 404,
  );
});

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

test('demo import_grades accepts the Professor UI contract and commits the complete batch atomically', async () => {
  const api = demoApi();
  api.resetDemo();
  const sessionView = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: sessionView.exam }, 'publish-import');
  const activation = await api.adminCommand(
    'activate_exam',
    { examId: sessionView.exam.id },
    'activate-import',
  );
  await api.professorCommand(
    'open_room',
    { examId: sessionView.exam.id, roomKey: activation.roomKey },
    'open-import',
  );

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
  }, 'consent-import');
  for (let index = 0; index < sessionView.exam.questions.length; index += 1) {
    await api.studentCommand('save_answer', {
      sessionId: consent.session.id,
      sessionToken: consent.session.id,
      questionId: `q-${index + 1}`,
      answer: index === 3 ? 'option-2' : `Answer ${index + 1}`,
      flagged: false,
    }, `answer-import-${index + 1}`);
  }
  await api.studentCommand('submit', {
    sessionId: consent.session.id,
    sessionToken: consent.session.id,
  }, 'submit-import');

  const grades = [
    {
      sessionId: consent.session.id,
      questionId: 'q-1',
      points: 26,
      feedback: 'Strong offline analysis.',
    },
    {
      sessionId: consent.session.id,
      questionId: 'q-2',
      points: 22,
      feedback: 'Clear discussion of review standards.',
    },
  ];
  await assert.rejects(
    api.professorCommand('import_grades', {
      examId: sessionView.exam.id,
      grades: [...grades, { ...grades[1], questionId: 'q-3', points: 999 }],
    }, 'offline-import-invalid'),
    (error) => error.code === 'OFFLINE_GRADE_INVALID',
  );
  assert.equal((await api.professorQuery('grading')).gradeRevisions.length, 0);

  const imported = await api.professorCommand('import_grades', {
    examId: sessionView.exam.id,
    grades,
  }, 'offline-import-valid');
  assert.equal(imported.atomic, true);
  assert.equal(imported.importedCount, 2);
  assert.equal(imported.importedRevisionCount, 1);
  assert.equal(imported.receipts[0].questionCount, 2);
  const afterImport = await api.professorQuery('grading');
  assert.equal(afterImport.gradeRevisions.length, 2);
  assert.equal(afterImport.gradeRevisions.every((grade) => (
    grade.source === 'offline_grading_workspace'
  )), true);

  const duplicate = await api.professorCommand('import_grades', {
    examId: sessionView.exam.id,
    grades,
  }, 'offline-import-valid');
  assert.equal(duplicate.duplicate, true);
  assert.equal((await api.professorQuery('grading')).gradeRevisions.length, 2);
});

test('demo owner controls correct identity, change submission status, and control the room idempotently', async () => {
  const api = demoApi();
  api.resetDemo();
  const sessionView = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: sessionView.exam }, 'publish-owner-controls');
  await api.adminCommand('activate_exam', { examId: sessionView.exam.id }, 'activate-owner-controls');

  const correctionPayload = {
    examId: sessionView.exam.id,
    studentIdentityId: 's-1',
    fullName: 'Maria Theresa Santos',
    studentNumber: '2026-90001',
    email: 'maria.santos@law.example.edu.ph',
    reason: 'Owner verified the corrected school record.',
  };
  const correction = await api.adminCommand('correct_student_identity', correctionPayload, 'owner-identity-0001');
  assert.equal(correction.corrected, true);
  const duplicateCorrection = await api.adminCommand('correct_student_identity', correctionPayload, 'owner-identity-0001');
  assert.equal(duplicateCorrection.duplicate, true);
  const correctedStudent = (await api.professorQuery('session')).exam.roster.find((student) => student.id === 's-1');
  assert.equal(correctedStudent.fullName, 'Maria Theresa Santos');
  assert.equal(correctedStudent.studentNumber, '2026-90001');

  const opened = await api.adminCommand('room_control', {
    examId: sessionView.exam.id,
    action: 'open',
    reason: 'Owner opened the scheduled room.',
  }, 'owner-room-open-0001');
  assert.equal(opened.status, 'open');
  assert.equal((await api.adminCommand('room_control', {
    examId: sessionView.exam.id,
    action: 'open',
    reason: 'Owner opened the scheduled room.',
  }, 'owner-room-open-0001')).duplicate, true);

  const identity = {
    fullName: 'Maria Theresa Santos',
    studentNumber: '2026-90001',
    subject: 'Constitutional Law',
    yearLevel: '2L',
  };
  const preview = await api.studentPreview({ roomKey: api.demoRoomKey, ...identity, identity });
  const consent = await api.studentConsent({
    roomKey: api.demoRoomKey,
    identity,
    noticeVersion: preview.metadata.noticeVersion,
    agreed: true,
  }, 'owner-controls-consent');
  for (const question of sessionView.exam.questions) {
    await api.studentCommand('save_answer', {
      sessionId: consent.session.id,
      sessionToken: consent.session.id,
      questionId: question.id,
      answer: question.type === 'multiple_choice' ? 'option-2' : `Answer for ${question.id}`,
      flagged: false,
    }, `owner-controls-answer-${question.id}`);
  }
  const submitted = await api.studentCommand('submit', {
    sessionId: consent.session.id,
    sessionToken: consent.session.id,
  }, 'owner-controls-submit');

  const statusPayload = {
    examId: sessionView.exam.id,
    submissionId: submitted.submission.id,
    status: 'voided',
    reason: 'Owner verified that this submission requires exclusion from ordinary grading.',
  };
  const changed = await api.adminCommand('set_submission_status', statusPayload, 'owner-submission-0001');
  assert.equal(changed.status, 'voided');
  assert.equal((await api.adminCommand('set_submission_status', statusPayload, 'owner-submission-0001')).duplicate, true);
  assert.equal((await api.professorQuery('monitor')).submissions[0].status, 'voided');

  const closed = await api.adminCommand('room_control', {
    examId: sessionView.exam.id,
    action: 'close',
    reason: 'Owner closed the room after receipt verification.',
  }, 'owner-room-close-0001');
  assert.equal(closed.status, 'closed');
  assert.equal((await api.professorQuery('exam')).activation.status, 'closed');

  const firstAuditPage = await api.adminQuery('audit_log', {
    examId: sessionView.exam.id,
    limit: 2,
    offset: 0,
  });
  assert.equal(firstAuditPage.items.length, 2);
  assert.equal(firstAuditPage.total > firstAuditPage.items.length, true);
  assert.equal(firstAuditPage.hasMore, true);
  const secondAuditPage = await api.adminQuery('audit_log', {
    examId: sessionView.exam.id,
    limit: 2,
    offset: firstAuditPage.nextOffset,
  });
  assert.equal(secondAuditPage.offset, 2);
  assert.notEqual(secondAuditPage.items[0].requestId, firstAuditPage.items[0].requestId);
});
