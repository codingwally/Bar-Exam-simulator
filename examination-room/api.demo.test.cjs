'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function demoApi(onStorageWrite = null) {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); onStorageWrite?.(key, String(value)); },
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

function demoApiWithCrossTabTransports() {
  let storageListener = null;
  let broadcastListener = null;
  class FakeBroadcastChannel {
    addEventListener(type, listener) {
      if (type === 'message') broadcastListener = listener;
    }
    postMessage() {}
  }
  const values = new Map();
  const window = {
    location: { search: '?demo=1', hostname: '127.0.0.1' },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
    crypto: { randomUUID: crypto.randomUUID },
    addEventListener(type, listener) {
      if (type === 'storage') storageListener = listener;
    },
  };
  const sandbox = {
    window,
    globalThis: null,
    BroadcastChannel: FakeBroadcastChannel,
    URLSearchParams,
    structuredClone,
    crypto: window.crypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'view-models.js'), 'utf8'), sandbox, { filename: 'view-models.js' });
  window.ExaminationRoomV1ViewModels = sandbox.ExaminationRoomV1ViewModels;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), sandbox, { filename: 'api.js' });
  return {
    api: window.ExaminationRoomV1Api,
    broadcast(event) { broadcastListener({ data: event }); },
    storage(event) { storageListener({ key: 'duediligence.examination-room.v1.demo-event', newValue: JSON.stringify(event) }); },
    malformedStorage() { storageListener({ key: 'duediligence.examination-room.v1.demo-event', newValue: '{' }); },
  };
}

function liveApi(fetchImplementation, options = {}) {
  const window = {
    location: { search: '?live=1', hostname: 'duediligence.ph' },
    localStorage: new Map(),
    crypto: { randomUUID: crypto.randomUUID },
    addEventListener() {},
    AbortController,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    fetch: fetchImplementation,
    DueDiligencePhase2Config: {
      workerUrl: 'https://worker.example.test',
      supabase: { url: 'https://supabase.example.test', publishableKey: 'public-test-key' },
    },
    supabase: {
      createClient(...args) {
        if (typeof options.createClient === 'function') return options.createClient(...args);
        return {
          auth: {
            getSession: options.getSession || (async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })),
          },
        };
      },
    },
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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), sandbox, { filename: 'api.js' });
  return window.ExaminationRoomV1Api;
}

test('live API reuses an injected Admin auth client without constructing a duplicate', async () => {
  let createClientCalls = 0;
  let sharedSessionReads = 0;
  const api = liveApi(
    async () => ({ ok: true, json: async () => ({ ok: true }) }),
    {
      createClient() {
        createClientCalls += 1;
        throw new Error('A second Supabase client must not be constructed.');
      },
    },
  );
  const sharedClient = {
    auth: {
      async getSession() {
        sharedSessionReads += 1;
        return { data: { session: { access_token: 'shared-admin-token' } }, error: null };
      },
    },
  };
  api.authSession.client = sharedClient;

  const session = await api.authSession();
  await api.adminQuery('access');

  assert.equal(session.access_token, 'shared-admin-token');
  assert.equal(api.authSession.client, sharedClient);
  assert.equal(createClientCalls, 0);
  assert.equal(sharedSessionReads, 2);
});

test('live API requests time out and preserve caller cancellation through one combined signal', async () => {
  const pendingFetch = (_url, options) => new Promise((_resolve, reject) => {
    const cancel = () => reject(options.signal.reason || new Error('aborted'));
    if (options.signal.aborted) cancel();
    else options.signal.addEventListener('abort', cancel, { once: true });
  });
  const timeoutApi = liveApi(pendingFetch);
  await assert.rejects(
    timeoutApi.professorQuery('session', {}, { timeoutMs: 10 }),
    (error) => error.code === 'REQUEST_TIMEOUT' && error.status === 408,
  );

  let transportSignal = null;
  const cancelledApi = liveApi((_url, options) => {
    transportSignal = options.signal;
    return pendingFetch(_url, options);
  });
  const caller = new AbortController();
  const request = cancelledApi.professorQuery('session', {}, { signal: caller.signal, timeoutMs: 1000 });
  await new Promise((resolve) => setImmediate(resolve));
  caller.abort(new Error('caller stopped polling'));
  await assert.rejects(request, (error) => error.code === 'REQUEST_CANCELLED' && error.status === 499);
  assert.equal(caller.signal.aborted, true);
  assert.equal(transportSignal.aborted, true);
  assert.notEqual(transportSignal, caller.signal, 'the application deadline and caller signal are composed');
});

test('the request deadline includes a stalled authentication lookup', async () => {
  let fetchCalls = 0;
  const api = liveApi(
    async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ ok: true }) };
    },
    { getSession: () => new Promise(() => {}) },
  );
  await assert.rejects(
    api.professorQuery('session', {}, { timeoutMs: 10 }),
    (error) => error.code === 'REQUEST_TIMEOUT' && error.status === 408,
  );
  assert.equal(fetchCalls, 0, 'transport never starts after the authentication deadline expires');
});

test('assistant and Admin recovery operations receive bounded longer defaults without defeating explicit caller limits', async () => {
  const scheduled = [];
  let timerId = 0;
  const api = liveApi(
    async () => ({ ok: true, json: async () => ({ ok: true }) }),
    {
      setTimeout(_callback, delay) {
        scheduled.push(delay);
        timerId += 1;
        return timerId;
      },
      clearTimeout() {},
    },
  );
  await api.professorAssistant({ message: 'Review this draft.' }, 'assistant-request');
  await api.adminCommand('create_snapshot', { examId: 'exam-1' }, 'snapshot-request');
  await api.adminQuery('recovery_detail', { examId: 'exam-1', snapshotId: 'snapshot-1' });
  await api.studentPreview({ roomKey: 'ROOM-KEY' });
  await api.professorAssistant({ message: 'Use caller deadline.' }, 'assistant-short', { timeoutMs: 7000 });
  assert.deepEqual(scheduled, [60_000, 120_000, 120_000, 20_000, 7000]);
});

test('demo cross-tab storage and BroadcastChannel delivery is nonce-deduplicated with a bounded cache', () => {
  const transport = demoApiWithCrossTabTransports();
  const received = [];
  transport.api.subscribe((event) => received.push(event.nonce));
  const duplicate = { type: 'draft_saved', at: new Date().toISOString(), nonce: 'same-cross-tab-event' };
  transport.broadcast(duplicate);
  transport.storage(duplicate);
  assert.deepEqual(received, ['same-cross-tab-event']);
  assert.doesNotThrow(() => transport.malformedStorage());

  for (let index = 0; index < 300; index += 1) {
    transport.broadcast({ type: 'stress', nonce: `bounded-${index}`, at: new Date().toISOString() });
  }
  const afterUniqueEvents = received.length;
  transport.storage({ type: 'stress', nonce: 'bounded-299', at: new Date().toISOString() });
  assert.equal(received.length, afterUniqueEvents, 'a recent nonce remains deduplicated');
  transport.storage(duplicate);
  assert.equal(received.length, afterUniqueEvents + 1, 'the oldest nonce is eventually evicted from the bounded cache');
});

test('demo monitor and grading polling are read-only for the selected examination', async () => {
  const writes = [];
  const api = demoApi((key) => writes.push(key));
  api.resetDemo();
  writes.length = 0;
  const session = await api.professorQuery('session');
  await api.professorQuery('monitor', { examId: session.exam.id });
  await api.professorQuery('grading', { examId: session.exam.id });
  await api.professorQuery('grading', { examId: session.exam.id });
  assert.deepEqual(writes, []);
});

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

test('demo Examination Assistant answers a contextual follow-up from the live draft', async () => {
  const assistantApi = demoApi();
  const result = await assistantApi.professorAssistant({
    message: 'Which question currently carries the most weight, and how many points is it?',
    history: [
      { role: 'user', text: 'Are my point totals balanced?' },
      { role: 'assistant', text: 'The current examination totals 100 points.' },
    ],
    examContext: {
      title: 'Constitutional Law — Midterm Examination',
      subject: 'Constitutional Law',
      totalPoints: 100,
      reviewIssues: [],
      questions: [
        { number: 1, points: 30, prompt: 'Analyze the separation of powers.' },
        { number: 2, points: 25, prompt: 'Discuss judicial review.' },
      ],
    },
  });

  assert.match(result.assistant.reply, /Question 1 carries the most weight at 30 points/);
  assert.match(result.assistant.reply, /Analyze the separation of powers/);

  const followUp = await assistantApi.professorAssistant({
    message: 'How many points lower is Question 3?',
    history: [
      { role: 'user', text: 'Which question carries the most weight?' },
      { role: 'assistant', text: result.assistant.reply },
    ],
    examContext: {
      totalPoints: 100,
      questions: [
        { number: 1, points: 30, prompt: 'Analyze the separation of powers.' },
        { number: 3, points: 20, prompt: 'State the requisites of judicial inquiry.' },
      ],
    },
  });
  assert.match(followUp.assistant.reply, /Question 3 is worth 20 points/);
  assert.match(followUp.assistant.reply, /10 points lower than Question 1 at 30 points/);
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

test('demo creator can delete any selected draft and reach a genuine empty overview', async () => {
  const api = demoApi();
  api.resetDemo();
  const first = await api.professorQuery('session');
  const secondId = crypto.randomUUID();
  await api.professorCommand('save_draft', {
    exam: {
      ...first.exam,
      id: secondId,
      versionId: null,
      status: 'draft',
      title: 'Civil Law — Practice Examination',
      publishedAt: null,
    },
  }, 'create-overview-second');

  const removedFirst = await api.professorCommand('delete_draft', { examId: first.exam.id }, 'delete-overview-first');
  assert.equal(removedFirst.deleted, true);
  assert.equal(removedFirst.recoverable, true);
  let session = await api.professorQuery('session');
  assert.deepEqual(Array.from(session.exams, (exam) => exam.id), [secondId]);

  const removedSecond = await api.professorCommand('delete_draft', { examId: secondId }, 'delete-overview-second');
  assert.equal(removedSecond.deleted, true);
  session = await api.professorQuery('session');
  assert.equal(session.exams.length, 0);
});

test('demo published examination uses recoverable archive instead of draft deletion', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  const published = await api.professorCommand('publish', { exam: creator.exam }, 'publish-for-overview-delete');
  assert.equal(published.exam.status, 'awaiting_activation');

  await assert.rejects(
    api.professorCommand('delete_draft', { examId: creator.exam.id }, 'reject-published-draft-delete'),
    (error) => error.code === 'DRAFT_DELETE_STATE_INVALID' && error.status === 409,
  );
  const archived = await api.professorCommand('archive_exam', { examId: creator.exam.id }, 'archive-published-overview');
  assert.equal(archived.archived, true);
  assert.equal(archived.recoverable, true);
  assert.equal((await api.professorQuery('session')).exams.length, 0);
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
  await api.studentPreview({ roomKey: activation.roomKey, ...identity, identity });
  const started = await api.studentBegin({
    roomKey: activation.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'1'.repeat(64)}`,
  }, 'student-begin-1');
  const studentPayload = JSON.stringify(started.exam);
  assert.equal(studentPayload.includes('correctOption'), false);
  assert.equal(studentPayload.includes('gradingGuidance'), false);
  assert.equal(studentPayload.includes('acceptedAnswers'), false);

  const attemptId = started.session.id;
  const sessionToken = started.session.id;
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
  const resultRelease = await api.professorCommand('release_results', {
    examId: sessionView.exam.id,
    sessionIds: [attemptId],
  }, 'release-1');
  assert.equal(resultRelease.release.delivery.status, 'skipped');
  assert.equal(resultRelease.release.delivery.skippedCount, 1);
  assert.equal(resultRelease.release.delivery.outcomes[0].safeErrorCode, 'recipient_missing');
  assert.equal(resultRelease.release.delivery.retrySafe, true);

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
  await api.studentPreview({ roomKey: activation.roomKey, ...identity, identity });
  const started = await api.studentBegin({
    roomKey: activation.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'2'.repeat(64)}`,
  }, 'student-begin-import');
  for (let index = 0; index < sessionView.exam.questions.length; index += 1) {
    await api.studentCommand('save_answer', {
      sessionId: started.session.id,
      sessionToken: started.session.id,
      questionId: `q-${index + 1}`,
      answer: index === 3 ? 'option-2' : `Answer ${index + 1}`,
      flagged: false,
    }, `answer-import-${index + 1}`);
  }
  await api.studentCommand('submit', {
    sessionId: started.session.id,
    sessionToken: started.session.id,
  }, 'submit-import');

  const grades = [
    {
      sessionId: started.session.id,
      questionId: 'q-1',
      points: 26,
      feedback: 'Strong offline analysis.',
    },
    {
      sessionId: started.session.id,
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
  let sessionView = await api.professorQuery('session');
  const optionalRosterStudent = {
    id: 's-1',
    fullName: 'Maria Theresa Dela Cruz',
    studentNumber: '2024-10001',
    email: 'maria.delacruz@law.example.edu.ph',
    subject: 'Constitutional Law',
    yearLevel: '2L',
    extraMinutes: 0,
  };
  await api.professorCommand('save_draft', {
    exam: { ...sessionView.exam, roster: [optionalRosterStudent] },
  }, 'save-optional-owner-roster');
  sessionView = await api.professorQuery('session');
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
  await api.studentPreview({ roomKey: api.demoRoomKey, ...identity, identity });
  const started = await api.studentBegin({
    roomKey: api.demoRoomKey,
    identity,
    attemptBindingId: `attempt-binding:${'3'.repeat(64)}`,
  }, 'owner-controls-begin');
  for (const question of sessionView.exam.questions) {
    await api.studentCommand('save_answer', {
      sessionId: started.session.id,
      sessionToken: started.session.id,
      questionId: question.id,
      answer: question.type === 'multiple_choice' ? 'option-2' : `Answer for ${question.id}`,
      flagged: false,
    }, `owner-controls-answer-${question.id}`);
  }
  const submitted = await api.studentCommand('submit', {
    sessionId: started.session.id,
    sessionToken: started.session.id,
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

test('default key-only admission publishes without a roster and registers any keyed student', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  assert.equal(creator.exam.admissionMode, 'key_only');
  assert.equal(creator.exam.roster.length, 0);

  const published = await api.professorCommand('publish', { exam: creator.exam }, 'open-publish-0001');
  assert.equal(published.exam.status, 'awaiting_activation');
  const activation = await api.adminCommand('activate_exam', { examId: creator.exam.id }, 'open-activate-0001');
  assert.equal((await api.professorQuery('session')).activation.id, activation.activation.id);
  await api.professorCommand('open_room', { examId: creator.exam.id }, 'open-room-without-key-0001');

  const identity = {
    fullName: 'Friend Practice Student',
    studentNumber: 'FRIEND-0001',
    email: 'friend@example.com',
    subject: creator.exam.subject,
    yearLevel: 'Second year',
  };
  const preview = await api.studentPreview({ roomKey: activation.roomKey, identity });
  assert.equal(preview.identity.fullName, identity.fullName);
  const started = await api.studentBegin({
    roomKey: activation.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'4'.repeat(64)}`,
  }, 'open-begin-0001');
  assert.equal(started.session.fullName, identity.fullName);
  const after = await api.professorQuery('monitor', { examId: creator.exam.id });
  assert.equal(after.exam.roster.length, 1);
  assert.equal(after.sessions.length, 1);
});

test('optional email allowlist accepts only normalized listed emails', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  const exam = {
    ...creator.exam,
    admissionMode: 'email_allowlist',
    allowedEmails: ['  ALLOWED.Student@Example.COM ', 'allowed.student@example.com'],
  };
  const published = await api.professorCommand('publish', { exam }, 'allowlist-publish-0001');
  assert.deepEqual(Array.from(published.exam.allowedEmails), ['allowed.student@example.com']);
  const activation = await api.adminCommand('activate_exam', { examId: exam.id }, 'allowlist-activate-0001');
  await api.professorCommand('open_room', { examId: exam.id }, 'allowlist-open-0001');

  const baseIdentity = {
    fullName: 'Allowed Student',
    studentNumber: 'ALLOW-0001',
    subject: exam.subject,
    yearLevel: 'Second year',
  };
  await assert.rejects(
    api.studentPreview({ roomKey: activation.roomKey, identity: baseIdentity }),
    (error) => error.code === 'STUDENT_EMAIL_REQUIRED',
  );
  await assert.rejects(
    api.studentPreview({ roomKey: activation.roomKey, identity: { ...baseIdentity, email: 'other@example.com' } }),
    (error) => error.code === 'STUDENT_EMAIL_NOT_ALLOWED',
  );
  const preview = await api.studentPreview({
    roomKey: activation.roomKey,
    identity: { ...baseIdentity, email: 'Allowed.Student@Example.com' },
  });
  assert.equal(preview.identity.email, 'allowed.student@example.com');
});

test('admin key approval is idempotent across one hundred identical retries', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: creator.exam }, 'idempotent-publish-0001');
  const results = [];
  for (let index = 0; index < 100; index += 1) {
    results.push(await api.adminCommand('activate_exam', { examId: creator.exam.id }, 'same-admin-approval-0001'));
  }
  assert.equal(new Set(results.map((result) => result.activation.id)).size, 1);
  assert.equal(new Set(results.map((result) => result.roomKey)).size, 1);
  assert.equal(results.slice(1).every((result) => result.duplicate === true), true);
});

test('creator can revoke a live student and the same identity cannot re-enter that activation', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: creator.exam }, 'revoke-publish-0001');
  const activation = await api.adminCommand('activate_exam', { examId: creator.exam.id }, 'revoke-activate-0001');
  await api.professorCommand('open_room', { examId: creator.exam.id }, 'revoke-open-0001');
  const identity = {
    fullName: 'Blocked Student',
    studentNumber: 'BLOCK-0001',
    subject: creator.exam.subject,
    yearLevel: 'Second year',
  };
  await api.studentPreview({ roomKey: activation.roomKey, identity });
  const started = await api.studentBegin({
    roomKey: activation.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'5'.repeat(64)}`,
  }, 'revoke-begin-0001');
  await api.professorCommand('revoke_session', {
    examId: creator.exam.id,
    sessionId: started.session.id,
    reason: 'Creator ended this practice session.',
  }, 'revoke-session-0001');
  await assert.rejects(
    api.studentQuery('resume', { sessionId: started.session.id, sessionToken: started.session.id }),
    (error) => error.code === 'SESSION_REVOKED',
  );
  await assert.rejects(
    api.studentBegin({
      roomKey: activation.roomKey,
      identity,
      attemptBindingId: `attempt-binding:${'5'.repeat(64)}`,
    }, 'revoke-begin-again-0001'),
    (error) => ['STUDENT_BLOCKED', 'SESSION_REVOKED'].includes(error.code),
  );
});

test('demo Admin lifecycle preserves examination evidence and reopens with one idempotent replacement key', async () => {
  const api = demoApi();
  api.resetDemo();
  const creator = await api.professorQuery('session');
  await api.professorCommand('publish', { exam: creator.exam }, 'lifecycle-publish-0001');
  const firstActivation = await api.adminCommand('activate_exam', { examId: creator.exam.id }, 'lifecycle-activate-0001');
  await api.professorCommand('open_room', { examId: creator.exam.id }, 'lifecycle-open-0001');

  const identity = {
    fullName: 'Lifecycle Test Student',
    studentNumber: 'LIFECYCLE-0001',
    subject: creator.exam.subject,
    yearLevel: 'Second year',
  };
  await api.studentPreview({ roomKey: firstActivation.roomKey, identity });
  const firstSession = await api.studentBegin({
    roomKey: firstActivation.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'6'.repeat(64)}`,
  }, 'lifecycle-begin-0001');
  await api.studentCommand('save_answer', {
    sessionId: firstSession.session.id,
    sessionToken: firstSession.session.id,
    questionId: creator.exam.questions[0].id,
    answer: 'A preserved lifecycle answer.',
    flagged: false,
  }, 'lifecycle-answer-0001');

  const blockPayload = {
    examId: creator.exam.id,
    reason: 'Owner temporarily blocked new admission for a lifecycle check.',
  };
  const blocked = await api.adminCommand('block_exam', blockPayload, 'lifecycle-block-0001');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.existingAnswersPreserved, true);
  assert.equal((await api.adminCommand('block_exam', blockPayload, 'lifecycle-block-0001')).duplicate, true);
  await assert.rejects(
    api.studentPreview({ roomKey: firstActivation.roomKey, identity }),
    (error) => error.code === 'EXAMINATION_BLOCKED' && error.status === 409,
  );

  const unblocked = await api.adminCommand('unblock_exam', {
    examId: creator.exam.id,
    reason: 'Owner completed the lifecycle check and restored admission.',
  }, 'lifecycle-unblock-0001');
  assert.equal(unblocked.blocked, false);
  assert.equal((await api.studentPreview({ roomKey: firstActivation.roomKey, identity })).ok, true);

  const archived = await api.adminCommand('archive_exam', {
    examId: creator.exam.id,
    reason: 'Owner archived the room while preserving its complete examination evidence.',
  }, 'lifecycle-archive-0001');
  assert.equal(archived.archived, true);
  assert.equal(archived.recoverable, true);
  const archivedDetail = await api.adminQuery('exam_detail', { examId: creator.exam.id });
  assert.equal(archivedDetail.exam.lifecycleState, 'archived');
  assert.equal(archivedDetail.questions.length, creator.exam.questions.length);
  assert.equal(archivedDetail.answerRevisions.length, 1);
  assert.equal(archivedDetail.sessions[0].status, 'expired');
  assert.equal((await api.professorQuery('session')).exams.some((exam) => exam.id === creator.exam.id), false);
  await assert.rejects(
    api.studentPreview({ roomKey: firstActivation.roomKey, identity }),
    (error) => error.code === 'EXAMINATION_ARCHIVED' && error.status === 409,
  );

  const restored = await api.adminCommand('restore_exam', {
    examId: creator.exam.id,
    reason: 'Owner restored the archived examination for another approved sitting.',
  }, 'lifecycle-restore-0001');
  assert.equal(restored.restored, true);
  assert.equal(restored.status, 'closed');
  assert.equal(restored.needsNewKey, true);

  const reopenPayload = {
    examId: creator.exam.id,
    reason: 'Owner reopened the preserved examination and issued one replacement key.',
  };
  const reopened = await api.adminCommand('reopen_exam', reopenPayload, 'lifecycle-reopen-0001');
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.activationCommitted, true);
  assert.equal(reopened.keyIssuanceStatus, 'active');
  assert.equal(reopened.keyEscrow.status, 'escrowed');
  assert.equal(reopened.deliveryAudit.status, 'recorded');
  assert.equal(reopened.recoveryRequired, false);
  assert.notEqual(reopened.roomKey, firstActivation.roomKey);
  const duplicateReopen = await api.adminCommand('reopen_exam', reopenPayload, 'lifecycle-reopen-0001');
  assert.equal(duplicateReopen.duplicate, true);
  assert.equal(duplicateReopen.roomKey, reopened.roomKey);
  assert.equal(duplicateReopen.activation.id, reopened.activation.id);
  const revealed = await api.adminCommand('reveal_key', { examId: creator.exam.id }, 'lifecycle-reveal-0001');
  assert.equal(revealed.roomKey, reopened.roomKey);
  const resent = await api.adminCommand('resend_key', { examId: creator.exam.id }, 'lifecycle-resend-0001');
  assert.equal(resent.roomKey, reopened.roomKey);
  assert.equal(resent.deliveryAudit.status, 'recorded');

  await assert.rejects(
    api.studentPreview({ roomKey: firstActivation.roomKey, identity }),
    (error) => error.code === 'ROOM_KEY_INVALID',
  );
  const reopenedPreview = await api.studentPreview({ roomKey: reopened.roomKey, identity });
  assert.equal(reopenedPreview.ok, true);
  const secondSession = await api.studentBegin({
    roomKey: reopened.roomKey,
    identity,
    attemptBindingId: `attempt-binding:${'7'.repeat(64)}`,
  }, 'lifecycle-begin-0002');
  assert.notEqual(secondSession.session.id, firstSession.session.id);
  assert.equal(secondSession.session.activationId, reopened.activation.id);

  const reopenedDetail = await api.adminQuery('exam_detail', { examId: creator.exam.id });
  assert.equal(reopenedDetail.questions.length, creator.exam.questions.length);
  assert.equal(reopenedDetail.answerRevisions.length, 1);
  assert.equal(reopenedDetail.sessions.length, 2);
  assert.equal(reopenedDetail.keyHistory[0].roomKey, reopened.roomKey);
  assert.equal(reopenedDetail.keyHistory.some((entry) => entry.activationId === firstActivation.activation.id), true);

  const audit = await api.adminQuery('audit_log', { examId: creator.exam.id, limit: 100, offset: 0 });
  const lifecycleEvents = new Set(audit.items.map((entry) => entry.type));
  for (const operation of ['reopen_exam', 'block_exam', 'unblock_exam', 'archive_exam', 'restore_exam']) {
    assert.equal(lifecycleEvents.has(`owner_${operation}`), true);
  }
});
