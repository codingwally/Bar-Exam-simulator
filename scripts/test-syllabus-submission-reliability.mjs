import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const submittedAt = '2026-09-09T00:00:00Z';
const fixture = (id = 'A', track = 'per_subject') => ({
  examination: { track, subject: 'Civil Law' },
  attempt: { attemptId: id, status: 'in_progress', assisted: false },
  questions: [{ questionId: `question-${id}`, answerText: `Saved answer ${id}`, revision: 0 }],
});

function element() {
  return { isConnected: true, disabled: false, readOnly: false, textContent: '', className: '',
    dataset: {}, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key] ?? null; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    classList: { toggle() {}, remove() {} },
  };
}

// Execute the actual frontend and API identity wrapper. Only DOM, time and network
// are inert; each deferred response is supplied explicitly by the test.
function harness(storage = new Map()) {
  const calls = [];
  const memoryStorage = { getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  let owner = 'owner-A';
  let mounted;
  const document = {
    readyState: 'loading', visibilityState: 'visible', addEventListener() {},
    getElementById: (id) => id === 'dd-per-subject-app' || id === 'dd-bar-feels-app' ? mounted.root : null,
    querySelectorAll: (selector) => selector === '.dd-exam-status' ? [mounted.status] : [],
    body: { contains: (node) => node?.isConnected === true },
  };
  const window = {
    location: { hash: '#subject-matter' },
    DueDiligencePhase2Config: { workerUrl: 'https://inert.invalid' },
    DueDiligencePrivateWorkspace: { generation: () => 1, scopedKey: (_scope, key) => `${owner}:${key}` },
    DueDiligencePhase4: {
      getSession: () => ({ user: { id: owner }, access_token: 'inert-token' }),
      getAccess: () => ({}), canRevealSubjectReview: () => true,
      request(path, { body }) {
        return new Promise((resolve, reject) => calls.push({ path, body,
          resolve: (data) => resolve({ data }), reject }));
      },
    },
  };
  const marker = 'global.DueDiligenceExaminations = Object.freeze({';
  assert.ok(source.includes(marker));
  vm.runInNewContext(source.replace(marker, `global.__submissionTest = {
    state, submitCurrentSubjectAnswer, bindRoom, handleClick, saveCurrent, flushCurrentSave,
    heartbeat, toggleFlag, loadCompleteSubjectReview, releaseSubjectReviewPending,
    subjectAnswerLocked, syncSubjectSubmissionControls, resetForIdentityChange,
    readRecovery, restoreSubjectSubmissionRecovery
  };\n${marker}`), {
    window, document, console, URL, crypto: webcrypto, Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    sessionStorage: memoryStorage, localStorage: memoryStorage,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame() {},
  });
  const hooks = window.__submissionTest;
  function mount(active = fixture()) {
    if (mounted) for (const node of [mounted.button, mounted.editor, mounted.panel]) node.isConnected = false;
    const button = element();
    const editor = Object.assign(element(), { value: active.questions[0].answerText });
    const status = element();
    const flag = element();
    const skip = element();
    const restore = element();
    const panel = Object.assign(element(), { dataset: { attemptId: active.attempt.attemptId,
      questionId: active.questions[0].questionId }, querySelector: () => null, querySelectorAll: () => [] });
    const reveal = Object.assign(element(), { closest: () => panel });
    const nodes = { '#dd-answer-editor': editor, '[data-submit-current]': button,
      '#dd-word-count': element(), '#dd-save-state': element(),
      '#dd-subject-flag-button': flag, '[data-subject-skip]': skip, '[data-use-local-draft]': restore };
    let html = '';
    const root = { isConnected: true,
      querySelector: (selector) => html ? null : nodes[selector] || null,
      querySelectorAll: (selector) => selector === '#dd-subject-flag-button, [data-subject-skip], [data-use-local-draft]' ? [flag, skip, restore] : [],
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; button.isConnected = false; editor.isConnected = false; panel.isConnected = false; },
    };
    mounted = { root, button, editor, status, flag, skip, restore, panel, reveal };
    hooks.state.active = active;
    hooks.state.track = active.examination.track;
    hooks.state.screen = 'room';
    hooks.state.currentIndex = 0;
    hooks.state.verdictGeneration += 1;
    hooks.bindRoom(root);
    return mounted;
  }
  mount();
  const next = (operation) => {
    const call = calls.find((item) => !item.handled && item.body.operation === operation);
    assert.ok(call, `Expected pending ${operation}; got ${calls.map((item) => item.body.operation)}`);
    call.handled = true;
    return call;
  };
  async function acceptSave() {
    await turn();
    const save = next('save_response');
    save.resolve({ questionId: save.body.questionId, answerText: save.body.answerText,
      flagged: false, revision: save.body.expectedRevision + 1, savedAt: submittedAt });
    await turn();
  }
  async function acceptSubmission() {
    await acceptSave();
    const submit = next('submit_attempt');
    submit.resolve({ attemptId: submit.body.attemptId, status: 'submitted', submittedAt });
    await turn();
  }
  return { hooks, calls, next, mount, window, storage, acceptSave, acceptSubmission,
    get ui() { return mounted; }, changeOwner: () => { owner = 'owner-B'; } };
}

test('double clicks and input cannot change or resubmit the captured answer', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  assert.equal(h.ui.editor.readOnly, true);
  assert.equal(h.ui.flag.disabled, true);
  assert.equal(h.ui.skip.disabled, true);
  h.ui.editor.value = 'Changed while submitting';
  h.ui.editor.listeners.input();
  assert.equal(h.ui.editor.value, 'Saved answer A');
  assert.equal(h.hooks.state.active.questions[0].answerText, 'Saved answer A');
  assert.equal(h.ui.button.disabled, true);
  await h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSubmission();
  assert.equal(h.calls.filter((call) => call.body.operation === 'submit_attempt').length, 1);
  h.next('request_ai_grading').reject(new Error('Temporary grading failure'));
  await pending;
  assert.equal(h.ui.editor.readOnly, true, 'A submitted answer never becomes editable after grading failure.');
  assert.equal(h.ui.button.textContent, 'Retry assessment');
  assert.equal(h.hooks.state.active.attempt.assisted, false);
});

for (const phase of ['save', 'submit', 'grade']) {
  test(`a delayed ${phase} response for A never mutates or grades newly mounted B`, async () => {
    const h = harness();
    const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    if (phase !== 'save') await h.acceptSave();
    if (phase === 'grade') {
      h.next('submit_attempt').resolve({ attemptId: 'A', status: 'submitted', submittedAt });
      await turn();
    }
    const response = h.next(phase === 'save' ? 'save_response' : phase === 'submit' ? 'submit_attempt' : 'request_ai_grading');
    const b = fixture('B');
    const ui = h.mount(b);
    const before = JSON.stringify(b);
    response.resolve(phase === 'save'
      ? { questionId: 'question-A', answerText: 'Saved answer A', revision: 1, savedAt: submittedAt }
      : phase === 'submit' ? { attemptId: 'A', status: 'submitted', submittedAt } : { status: 'completed' });
    await pending;
    assert.equal(JSON.stringify(b), before);
    assert.equal(ui.status.textContent, '');
    assert.equal(ui.root.innerHTML, '');
    assert.ok(h.calls.every((call) => call.body.attemptId === 'A'));
    assert.equal(h.calls.some((call) => call.body.operation === 'verdict'), false);
  });
}

for (const stale of ['owner', 'route', 'screen']) {
  test(`a completed grade after ${stale} changes cannot reopen the old verdict`, async () => {
    const h = harness();
    const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    await h.acceptSubmission();
    if (stale === 'owner') h.changeOwner();
    if (stale === 'route') h.window.location.hash = '#home';
    if (stale === 'screen') h.hooks.state.screen = 'catalog';
    h.next('request_ai_grading').resolve({ status: 'completed' });
    await pending;
    assert.equal(h.calls.some((call) => call.body.operation === 'verdict'), false);
    assert.equal(h.ui.root.innerHTML, '');
  });
}

test('a failed save restores editing without issuing submission or grading', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  h.next('save_response').reject(new Error('Offline'));
  await pending;
  assert.equal(h.ui.editor.readOnly, false);
  assert.equal(h.ui.button.disabled, false);
  assert.equal(h.ui.flag.disabled, false);
  assert.equal(h.ui.skip.disabled, false);
  assert.deepEqual(h.calls.map((call) => call.body.operation), ['save_response']);
  assert.equal(h.hooks.state.active.questions[0].answerText, 'Saved answer A');
});

test('an explicit rejected submit restores editing, but never starts grading', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSave();
  h.next('submit_attempt').reject(Object.assign(new Error('Second tab owns the lease'), { code: 'EXAM_SECOND_TAB_BLOCKED' }));
  await pending;
  assert.equal(h.hooks.state.active.attempt.subjectSubmissionUnconfirmed, false);
  assert.equal(h.ui.editor.readOnly, false);
  assert.equal(h.ui.button.disabled, false);
  assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
});

test('lost submission response uses readback only until the exact attempt is confirmed', async () => {
  const h = harness();
  let pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSave();
  h.next('submit_attempt').reject(new Error('Connection lost after send'));
  await pending;
  assert.equal(h.ui.editor.readOnly, true);
  assert.equal(h.ui.button.textContent, 'Check submission status');
  assert.ok([...h.storage.values()].some((value) => value.includes('"subjectSubmissionUnconfirmed":true')));
  pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  h.next('resume').resolve(fixture());
  await pending;
  assert.equal(h.ui.editor.readOnly, true);
  assert.equal(h.calls.filter((call) => call.body.operation === 'submit_attempt').length, 1);
  assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
  pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  const recovered = fixture();
  Object.assign(recovered.attempt, { status: 'submitted', submittedAt, assisted: false });
  h.next('resume').resolve(recovered);
  await turn();
  h.next('request_ai_grading').resolve({ status: 'completed' });
  await turn();
  h.next('verdict').resolve({ attempt: recovered.attempt, results: [] });
  await pending;
  assert.equal(h.calls.filter((call) => call.body.operation === 'submit_attempt').length, 1);
  assert.equal(h.hooks.state.active.attempt.assisted, false);
  assert.equal(h.hooks.state.active.attempt.subjectSubmissionUnconfirmed, false);
});

test('mismatched receipt remains unconfirmed and never starts grading', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSave();
  h.next('submit_attempt').resolve({ attemptId: 'B', status: 'submitted', submittedAt });
  await pending;
  assert.equal(h.hooks.state.active.attempt.subjectSubmissionUnconfirmed, true);
  assert.equal(h.ui.editor.readOnly, true);
  assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
});

for (const reload of [false, true]) {
  test(`request lost before arrival replays one identical payload after exact readback; reload=${reload}`, async () => {
    let h = harness();
    let pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    await h.acceptSave();
    const original = h.next('submit_attempt');
    const payload = JSON.stringify(original.body);
    original.reject(new Error('Request never arrived'));
    await pending;
    const frozen = h.hooks.state.active.attempt.subjectSubmissionRecovery;
    if (reload) {
      h = harness(h.storage);
      // A changed sessionStorage tab token must not change the retained request hash.
      h.storage.set('duediligence.examinations.tab-token.v1', 'new-tab-token-that-must-not-replace-original-token');
      h.hooks.restoreSubjectSubmissionRecovery(h.hooks.state.active, h.hooks.readRecovery());
      h.hooks.syncSubjectSubmissionControls();
      assert.equal(h.ui.editor.readOnly, true);
      assert.equal(JSON.stringify(h.hooks.state.active.attempt.subjectSubmissionRecovery), JSON.stringify(frozen));
    }
    const callCount = h.calls.length;
    pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    await h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    assert.equal(h.calls.length, callCount + 1, 'Repeated click cannot start a second readback.');
    const recovered = fixture();
    Object.assign(recovered.questions[0], frozen.snapshot);
    h.next('resume').resolve(recovered);
    await turn();
    const replay = h.next('submit_attempt');
    assert.equal(JSON.stringify(replay.body), payload, 'Retain all normalized payload fields including tabToken.');
    await h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    assert.equal(h.calls.length, callCount + 2, 'Only one replay is allowed per explicit click.');
    assert.equal(h.calls.slice(callCount).some((call) => call.body.operation === 'save_response'), false);
    assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
    replay.resolve({ attemptId: 'A', status: 'submitted', submittedAt, replayed: true });
    await turn();
    h.next('request_ai_grading').reject(new Error('Temporary grading failure'));
    await pending;
    assert.equal(h.ui.button.textContent, 'Retry assessment');
    assert.equal(h.ui.editor.readOnly, true);
    assert.equal(h.hooks.state.active.attempt.assisted, false);
  });
}

for (const mismatch of ['answerText', 'revision', 'flagged', 'questionId', 'status']) {
  test(`uncertain submission never replays when saved ${mismatch} changed`, async () => {
    const h = harness();
    let pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    await h.acceptSave();
    h.next('submit_attempt').reject(new Error('Connection lost'));
    await pending;
    const recovered = fixture();
    Object.assign(recovered.questions[0], h.hooks.state.active.attempt.subjectSubmissionRecovery.snapshot);
    if (mismatch === 'status') recovered.attempt.status = 'cancelled';
    else recovered.questions[0][mismatch] = { answerText: 'Changed server answer', revision: 99,
      flagged: true, questionId: 'different-question' }[mismatch];
    pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
    h.next('resume').resolve(recovered);
    await pending;
    assert.equal(h.calls.filter((call) => call.body.operation === 'submit_attempt').length, 1);
    assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
    assert.equal(h.ui.editor.readOnly, true);
    assert.match(h.ui.status.textContent, /saved answer or attempt status changed/i);
  });
}

test('an explicit same-request replay still obeys the server second-tab rejection', async () => {
  const h = harness();
  let pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSave();
  h.next('submit_attempt').reject(new Error('Lost response'));
  await pending;
  const recovered = fixture();
  Object.assign(recovered.questions[0], h.hooks.state.active.attempt.subjectSubmissionRecovery.snapshot);
  pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  h.next('resume').resolve(recovered);
  await turn();
  h.next('submit_attempt').reject(Object.assign(new Error('Second tab owns the lease'), { code: 'EXAM_SECOND_TAB_BLOCKED' }));
  await pending;
  assert.equal(h.ui.editor.readOnly, true);
  assert.equal(h.hooks.state.active.attempt.subjectSubmissionUnconfirmed, true);
  assert.equal(h.calls.some((call) => call.body.operation === 'request_ai_grading'), false);
});

test('late save A finally cannot clear B save ownership or pending revision', async () => {
  const h = harness();
  const savingA = h.hooks.saveCurrent();
  const responseA = h.next('save_response');
  h.mount(fixture('B'));
  const savingB = h.hooks.saveCurrent();
  const responseB = h.next('save_response');
  const requestB = h.hooks.state.subjectSaveRequest;
  h.hooks.state.pendingSave = true;
  responseA.resolve({ questionId: 'question-A', answerText: 'Saved answer A', revision: 1, savedAt: submittedAt });
  assert.equal(await savingA, false);
  assert.equal(h.hooks.state.saveInFlight, true);
  assert.equal(h.hooks.state.subjectSaveRequest, requestB);
  assert.equal(h.hooks.state.pendingSave, true);
  responseB.resolve({ questionId: 'question-B', answerText: 'Saved answer B', revision: 1, savedAt: submittedAt });
  assert.equal(await savingB, true);
  assert.equal(h.hooks.state.saveInFlight, false);
  assert.equal(h.hooks.state.subjectSaveRequest, null);
});

test('post-submission Reveal preserves unassisted status while grading is pending', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.acceptSubmission();
  const reveal = h.hooks.loadCompleteSubjectReview(h.ui.reveal);
  h.next('subject_reveal_review').resolve({ attemptId: 'A', questionId: 'question-A', assisted: false,
    assistanceKnown: true, reviewMaterialRevealedAt: submittedAt, suggestedAnswer: 'Approved answer' });
  await reveal;
  assert.equal(h.hooks.state.active.attempt.assisted, false);
  assert.equal(h.ui.button.disabled, true);
  assert.equal(h.ui.editor.readOnly, true);
  h.next('request_ai_grading').reject(new Error('Temporary grading failure'));
  await pending;
});

test('recovery is rehydrated during ordinary attempt activation', () => {
  assert.match(source, /function activateAttempt\(active\)[\s\S]*?restoreSubjectSubmissionRecovery\(state\.active, recovery\)/);
});

test('Reveal cannot race an unconfirmed submission or re-enable its busy button', async () => {
  const h = harness();
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  await h.hooks.loadCompleteSubjectReview(h.ui.reveal);
  h.hooks.releaseSubjectReviewPending(h.ui.panel);
  assert.equal(h.ui.button.disabled, true);
  assert.equal(h.calls.some((call) => call.body.operation === 'subject_reveal_review'), false);
  h.next('save_response').reject(new Error('Offline'));
  await pending;
});

test('a late Reveal for detached A cannot mark B assisted or unlock its submission', async () => {
  const h = harness();
  const reveal = h.hooks.loadCompleteSubjectReview(h.ui.reveal);
  const response = h.next('subject_reveal_review');
  const b = fixture('B');
  const ui = h.mount(b);
  const pending = h.hooks.submitCurrentSubjectAnswer(ui.button);
  response.resolve({ attemptId: 'A', questionId: 'question-A', assisted: true, assistanceKnown: true,
    reviewMaterialRevealedAt: submittedAt, suggestedAnswer: 'Authorized material for A' });
  await reveal;
  assert.equal(b.attempt.assisted, false);
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.editor.readOnly, true);
  h.next('save_response').reject(new Error('Offline'));
  await pending;
});

test('a stale heartbeat cannot replace the Syllabus submission surface', async () => {
  const h = harness();
  const heartbeat = h.hooks.heartbeat(false);
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  h.next('heartbeat').resolve({ status: 'submitted', submittedAt, attemptId: 'A' });
  await heartbeat;
  assert.equal(h.ui.root.innerHTML, '');
  h.next('save_response').reject(new Error('Offline'));
  await pending;
});

test('a flag response started earlier cannot replace a now-busy submission surface', async () => {
  const h = harness();
  const flag = h.hooks.toggleFlag();
  await h.acceptSave();
  const response = h.next('flag_response');
  const pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  response.resolve({ flagged: true, revision: 2, savedAt: submittedAt });
  await flag;
  assert.equal(h.ui.root.innerHTML, '');
  assert.equal(h.ui.button.disabled, true);
  assert.equal(h.ui.editor.readOnly, true);
  h.next('save_response').reject(new Error('Revision conflict'));
  await pending;
});

test('the single-flight guard is Syllabus-only', async () => {
  const h = harness();
  h.mount(fixture('simulation', 'bar_feels'));
  await h.hooks.submitCurrentSubjectAnswer(h.ui.button);
  assert.equal(h.calls.length, 0);
  assert.equal(h.ui.editor.readOnly, false);
  h.ui.editor.value = 'Simulation still editable';
  h.ui.editor.listeners.input();
  assert.equal(h.hooks.state.active.questions[0].answerText, 'Simulation still editable');
});

for (const phase of ['pending', 'submitted', 'unconfirmed']) {
  test(`Restore local draft cannot bypass the ${phase} submission lock`, async () => {
    const h = harness();
    const question = h.hooks.state.active.questions[0];
    question.localRecoveryText = 'Different retained draft';
    question.localRecoveryHtml = '<p>Different retained draft</p>';
    let pending;
    if (phase === 'submitted') {
      Object.assign(h.hooks.state.active.attempt, { status: 'submitted', submittedAt });
    } else {
      pending = h.hooks.submitCurrentSubjectAnswer(h.ui.button);
      if (phase === 'unconfirmed') {
        await h.acceptSave();
        h.next('submit_attempt').reject(new Error('Lost response'));
        await pending;
      }
    }
    h.hooks.syncSubjectSubmissionControls();
    assert.equal(h.ui.restore.disabled, true);
    const before = JSON.stringify(question);
    const callCount = h.calls.length;
    h.hooks.handleClick({ target: { closest: (selector) => selector === '[data-use-local-draft]' ? h.ui.restore : null } });
    assert.equal(JSON.stringify(question), before, 'Do not replace the captured answer or discard the retained draft.');
    assert.equal(h.ui.root.innerHTML, '', 'Do not rerender and detach the active submission button.');
    assert.equal(h.calls.length, callCount);
    if (phase === 'pending') {
      h.next('save_response').reject(new Error('Offline'));
      await pending;
      assert.equal(h.ui.restore.disabled, false, 'Confirmed pre-submit failure restores access to the local draft.');
    }
  });
}
