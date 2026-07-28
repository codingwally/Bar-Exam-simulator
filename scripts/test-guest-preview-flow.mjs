import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const index = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const experience = await fs.readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const worker = await fs.readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

{
  const calls = [];
  const storage = new Map();
  const context = {
    onboardingStage: 'signIn',
    sessionStorage: {
      setItem(key, value) { storage.set(key, value); },
    },
    GUEST_PROMPT_SESSION_KEY: 'guest-prompt',
    safeStorageSet(target, key, value) {
      target.setItem(key, value);
      return true;
    },
    closeModal(id) { calls.push(['close', id]); },
    showSubjectSelection() { calls.push(['subjects']); },
  };
  vm.runInNewContext(
    `${between(index, 'function continueAsGuest()', 'function completeOnboardingSignIn()')}
     continueAsGuest();`,
    context,
  );
  assert.equal(storage.get('guest-prompt'), 'dismissed');
  assert.deepEqual(calls, [
    ['close', 'signin-prompt-modal'],
    ['subjects'],
  ]);
}

for (const mode of ['strict', 'selfPaced', 'none']) {
  const calls = [];
  const answerBox = { focus() { calls.push(['focus']); } };
  const context = {
    selectedSessionMode: null,
    examMode: 'none',
    examStage: 'modeSelection',
    currentSubj: 'Political Law',
    currentIdx: 0,
    BAR_QUESTIONS: { 'Political Law': [{ id: 'POL-2024-Q01' }] },
    localStorage: {},
    safeStorageSet() { return true; },
    closeModal(id) { calls.push(['close', id]); },
    setWorkspaceLocked(value) { calls.push(['locked', value]); },
    renderMainWrite() { calls.push(['render']); },
    sessionController: {
      beginSession(selectedMode, questionId) {
        calls.push(['session', selectedMode, questionId]);
      },
      snapshot() { return {}; },
    },
    questionStartTs: null,
    updateSessionClock() {},
    document: {
      getElementById(id) {
        return id === 'answer-box' ? answerBox : null;
      },
    },
    requestAnimationFrame(callback) { callback(); },
  };
  vm.runInNewContext(
    `${between(index, 'function chooseSessionMode(mode)', 'function setWorkspaceLocked(locked)')}
     chooseSessionMode(${JSON.stringify(mode)});`,
    context,
  );
  assert.equal(context.examStage, 'answering', `${mode} must enter answering stage`);
  assert.equal(context.selectedSessionMode, mode);
  assert.ok(calls.some(([name, value]) => name === 'locked' && value === false));
  assert.ok(calls.some(([name, value]) => name === 'session' && value === mode));
  assert.ok(calls.some(([name]) => name === 'focus'));
}

{
  const boundEvents = [];
  const handlers = new Map();
  const answerBox = {
    dataset: {},
    addEventListener(name, handler) {
      boundEvents.push(name);
      handlers.set(name, handler);
    },
  };
  const context = {
    currentIdx: 0,
    currentQuestionIndex: -1,
    window: {
      DueDiligencePhase2: {
        getSession() { return null; },
      },
    },
    document: {
      getElementById(id) {
        return id === 'answer-box' ? answerBox : null;
      },
    },
  };
  vm.runInNewContext(
    `${between(index, 'function applyExamEnhancements()', '/* ---------- Exam-integrity security lockdown ---------- */')}
     applyExamEnhancements();
     applyExamEnhancements();`,
    context,
  );
  assert.equal(answerBox.dataset.integrityBound, '1');
  assert.equal(answerBox.dataset.locked, undefined);
  assert.deepEqual(boundEvents, ['copy', 'cut', 'drop', 'dragstart', 'paste']);
  let prevented = 0;
  handlers.get('paste')({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0, 'Guest paste-backed and accessibility-assisted input must remain usable');
  context.window.DueDiligencePhase2.getSession = () => ({ access_token: 'verified' });
  handlers.get('paste')({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1, 'Signed-in exam-integrity paste protection must remain active');
}

{
  const calls = [];
  let observerCallback;
  const investorModal = {
    open: true,
    classList: {
      contains(name) {
        return name === 'open' && investorModal.open;
      },
    },
  };
  const context = {
    state: {
      investorGateObserver: null,
      reminderResolve: null,
    },
    document: {
      getElementById(id) {
        return id === 'investor-modal' ? investorModal : null;
      },
    },
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {
        calls.push('observe');
      }
      disconnect() {
        calls.push('disconnect');
      }
    },
    setOverlay() {
      calls.push('close-reminder');
    },
    showEntry(options) {
      calls.push(['entry', options.completed]);
    },
  };
  vm.runInNewContext(
    `${between(experience, 'function requireSignInForGuestLimit()', 'function initials()')}
     requireSignInForGuestLimit();`,
    context,
  );
  assert.deepEqual(calls, ['observe'], 'Patron modal must retain first-load priority');
  investorModal.open = false;
  observerCallback();
  assert.deepEqual(calls, [
    'observe',
    'disconnect',
    'close-reminder',
    ['entry', true],
  ], 'Exhausted guest sign-in prompt must follow immediately after the Patron modal closes');
}

{
  const wordCount = { textContent: '' };
  const submit = { disabled: true };
  let draftsSaved = 0;
  const context = {
    currentSubj: 'Political Law',
    currentIdx: 0,
    userAnswers: {},
    saveDraftForCurrentQuestion() { draftsSaved += 1; },
    document: {
      getElementById(id) {
        if (id === 'word-count') return wordCount;
        if (id === 'submit-btn') return submit;
        return null;
      },
    },
  };
  const countWords = between(index, 'function countWords(str)', 'function handleInput(el)');
  const handleInput = between(index, 'function handleInput(el)', 'function prevQuestion()');
  vm.runInNewContext(
    `${countWords}
     ${handleInput}
     handleInput({ value: 'A legally meaningful guest answer.' });`,
    context,
  );
  assert.equal(context.userAnswers['Political Law-0'], 'A legally meaningful guest answer.');
  assert.equal(wordCount.textContent, '5 words');
  assert.equal(submit.disabled, false);
  assert.equal(draftsSaved, 1);
}

{
  let resolveAccess;
  const accessPromise = new Promise((resolve) => { resolveAccess = resolve; });
  let accessChecks = 0;
  let fetchCalls = 0;
  const controlStates = [];
  const toasts = [];
  const context = {
    gradingInProgress: false,
    gradingAccessCheckInProgress: false,
    examStage: 'answering',
    currentSubj: 'Political Law',
    currentIdx: 0,
    BAR_QUESTIONS: {
      'Political Law': [{
        id: 'POL-2024-Q01',
        text: 'Question',
      }],
    },
    userAnswers: {
      'Political Law-0': 'Original answer with legal basis and application.',
    },
    window: {
      DueDiligencePhase2: {
        beforeGrade() {
          accessChecks += 1;
          return accessPromise;
        },
      },
    },
    saveDraftForCurrentQuestion() {},
    setQuestionControlsDisabled(value) { controlStates.push(value); },
    toast(message) { toasts.push(message); },
    fetch() {
      fetchCalls += 1;
      throw new Error('Grading must not start after the visible answer changes');
    },
  };
  vm.runInNewContext(
    between(index, 'async function evaluateAnswer()', 'function renderResultHTML(key)'),
    context,
  );
  const firstAttempt = context.evaluateAnswer();
  const duplicateAttempt = context.evaluateAnswer();
  context.userAnswers['Political Law-0'] = 'Edited answer while status is pending.';
  resolveAccess(true);
  await Promise.all([firstAttempt, duplicateAttempt]);
  assert.equal(accessChecks, 1, 'A double click must create only one access check');
  assert.equal(fetchCalls, 0, 'A changed answer must not be graded or consume quota');
  assert.deepEqual(controlStates, [true, false]);
  assert.equal(context.gradingAccessCheckInProgress, false);
  assert.ok(toasts.some((message) => message.includes('changed while access was being checked')));
}

{
  const answer = 'Draft preserved for exhausted guest.';
  const controlStates = [];
  let fetchCalls = 0;
  const context = {
    gradingInProgress: false,
    gradingAccessCheckInProgress: false,
    examStage: 'answering',
    currentSubj: 'Political Law',
    currentIdx: 0,
    BAR_QUESTIONS: {
      'Political Law': [{ id: 'POL-2024-Q01', text: 'Question' }],
    },
    userAnswers: { 'Political Law-0': answer },
    window: {
      DueDiligencePhase2: {
        async beforeGrade() { return false; },
      },
    },
    saveDraftForCurrentQuestion() {},
    setQuestionControlsDisabled(value) { controlStates.push(value); },
    toast() {},
    fetch() { fetchCalls += 1; },
  };
  vm.runInNewContext(
    between(index, 'async function evaluateAnswer()', 'function renderResultHTML(key)'),
    context,
  );
  await context.evaluateAnswer();
  assert.equal(context.userAnswers['Political Law-0'], answer);
  assert.deepEqual(controlStates, [true, false]);
  assert.equal(fetchCalls, 0);
}

async function reconcileScenario({ session = null, responses }) {
  const state = {
    session,
    user: session?.user || null,
    profile: session ? {} : null,
    admin: session ? {} : null,
    guestUsage: null,
  };
  let promptCount = 0;
  let syncCount = 0;
  let fetchCount = 0;
  const context = {
    state,
    config: {
      workerUrl: 'https://worker.example',
      guest: { gradeLimit: 3 },
    },
    fetch: async () => {
      const response = responses[fetchCount];
      fetchCount += 1;
      if (response instanceof Error) throw response;
      return Response.json(response.body, { status: response.status || 200 });
    },
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    guestDeviceId() { return 'device_123456789012345678901234567890'; },
    syncAuthUi() { syncCount += 1; },
    requireSignInForGuestLimit() { promptCount += 1; },
  };
  vm.runInNewContext(
    between(experience, 'async function requestGuestAccessStatus(headers)', 'function firstPatronWelcome()'),
    context,
  );
  const result = await context.reconcileGuestAccess({ promptWhenExhausted: true });
  return {
    result,
    state,
    promptCount,
    syncCount,
    fetchCount,
  };
}

for (const completed of [0, 1, 2, 3]) {
  const result = await reconcileScenario({
    responses: [{
      body: {
        ok: true,
        access: {
          signedIn: false,
          guest: { limit: 3, completed, remaining: 3 - completed },
        },
      },
    }],
  });
  assert.equal(result.result.known, true);
  assert.equal(result.result.exhausted, completed === 3);
  assert.equal(result.state.guestUsage.completed, completed);
  assert.equal(result.state.guestUsage.remaining, 3 - completed);
  assert.equal(result.promptCount, completed === 3 ? 1 : 0);
}

{
  const result = await reconcileScenario({
    session: { access_token: 'expired', user: { id: 'user' } },
    responses: [
      {
        status: 401,
        body: {
          ok: false,
          error: { code: 'INVALID_SESSION', message: 'Expired' },
        },
      },
      {
        body: {
          ok: true,
          access: {
            signedIn: false,
            guest: { limit: 3, completed: 1, remaining: 2 },
          },
        },
      },
    ],
  });
  assert.equal(result.fetchCount, 2);
  assert.equal(result.state.session, null);
  assert.equal(result.state.user, null);
  assert.equal(result.state.guestUsage.completed, 1);
  assert.equal(result.state.guestUsage.remaining, 2);
}

{
  const result = await reconcileScenario({
    responses: [new Error('offline')],
  });
  assert.equal(result.result.known, false);
  assert.equal(result.result.signedIn, false);
  assert.equal(result.result.exhausted, false);
  assert.equal(result.promptCount, 0);
}

{
  let abortCallback;
  let rejectFetch;
  let aborted = false;
  class FakeAbortController {
    constructor() {
      this.signal = {};
    }

    abort() {
      aborted = true;
      rejectFetch?.(new Error('aborted'));
    }
  }
  const context = {
    state: {
      session: null,
      user: null,
      profile: null,
      admin: null,
      guestUsage: null,
    },
    config: {
      workerUrl: 'https://worker.example',
      guest: { gradeLimit: 3 },
    },
    fetch: async () => new Promise((resolve, reject) => {
      rejectFetch = reject;
    }),
    AbortController: FakeAbortController,
    setTimeout(callback) {
      abortCallback = callback;
      return 1;
    },
    clearTimeout() {},
    guestDeviceId() { return 'device_123456789012345678901234567890'; },
    syncAuthUi() {},
    requireSignInForGuestLimit() {},
  };
  vm.runInNewContext(
    between(experience, 'async function requestGuestAccessStatus(headers)', 'function firstPatronWelcome()'),
    context,
  );
  const reconciliation = context.reconcileGuestAccess({ promptWhenExhausted: true });
  await Promise.resolve();
  abortCallback();
  const result = await reconciliation;
  assert.equal(aborted, true);
  assert.equal(result.known, false);
  assert.equal(result.exhausted, false);
}

for (const subject of [
  'Political Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Mercantile Law',
  'Criminal Law',
  'Remedial Law',
  'Legal Ethics',
]) {
  assert.ok(index.includes(`"${subject}"`), `${subject} must remain selectable`);
}

assert.match(index, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
assert.doesNotMatch(index, /dataset\.locked/);
assert.match(index, /saveDraftForCurrentQuestion\(\);\s*const mayContinue = await window\.DueDiligencePhase2\.beforeGrade\(\)/);
assert.match(index, /let gradingAccessCheckInProgress = false;/);
assert.match(index, /if \(gradingInProgress \|\| gradingAccessCheckInProgress \|\| examStage !== 'answering'\) return;/);
assert.match(index, /finally \{\s*gradingAccessCheckInProgress = false;/);
assert.match(experience, /requestGuestAccessStatus/);
assert.match(experience, /\/guest-access/);
assert.match(experience, /controller\.abort\(\), 6_000/);
assert.match(experience, /error\?\.code !== 'INVALID_SESSION'/);
assert.match(experience, /reconcileGuestAccess\(\{ promptWhenExhausted: true \}\)/);
assert.match(experience, /if \(access\.exhausted\) return false;/);
assert.match(
  experience,
  /await firstPatronWelcome\(\);\s*await reconcileGuestAccess\(\{ promptWhenExhausted: true \}\)/,
  'First-load Patron welcome must open before an exhausted-guest sign-in gate',
);
assert.match(experience, /setOverlay\(false, 'dd2-guest-reminder'\)/);
assert.match(experience, /showEntry\(\{ completed: true \}\)/);
assert.match(worker, /pathname === '\/guest-access'/);
assert.ok(
  worker.indexOf('reserveGradeAccess(request, env)') < worker.indexOf('callGemini(env'),
  'The authoritative guest reservation must remain before Gemini',
);
assert.match(worker, /await releaseGradeAccess\(gradeAccess, env\)/);
assert.match(worker, /if \(authenticatedUser\) \{\s*return \{ signedIn: true/);

console.log('Guest preview answer-entry and authoritative access-flow tests passed.');
