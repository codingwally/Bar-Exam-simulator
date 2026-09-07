// Synthetic, memory-only DOM/transport edges. Execute the actual shipped lifecycle and render functions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

// The Pages contract runs these same behaviors against the sanitized shipped
// artifact, so a packaging regression cannot pass by testing source only.
const source = await readFile(
  process.env.BAR_FORECAST_ARTIFACT_PATH || new URL('../assets/bar-forecast.js', import.meta.url),
  'utf8',
);
const owner = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const subject = 'Civil Law and Land Titles and Deeds';
const answer = 'These exact original words contain the complete retained answer for review.';
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

class TinyNode {
  constructor(tag = 'div', text = '') {
    this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1;
    this.children = []; this.dataset = {}; this.attrs = new Map(); this.style = {}; this.events = new Map();
    this._text = text; this._html = ''; this.className = ''; this.hidden = false; this.isConnected = true;
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    if (tag === 'template') this.content = new TinyNode('fragment');
  }
  set textContent(value) { this._text = String(value); this.children = []; this._html = ''; }
  get textContent() { return this._text + this.children.map((child) => child.textContent || '').join(' '); }
  set innerText(value) { this.textContent = value; }
  get innerText() { return this.textContent; }
  set innerHTML(value) { this._html = String(value); this._text = ''; this.children = []; }
  get innerHTML() { return this._html || this._text; }
  get childNodes() { return this.children; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  append(...nodes) { this.children.push(...nodes.map((node) => typeof node === 'string' ? new TinyNode('#text', node) : node)); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  click() { return this.events.get('click')?.(); } remove() { this.isConnected = false; }
  focus() {} scrollIntoView() {} contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1))
      : selector.startsWith('#') ? node.id === selector.slice(1)
      : selector.startsWith('[data-') ? Object.hasOwn(node.dataset, selector.slice(6, -1).replace(/-([a-z])/gu, (_, c) => c.toUpperCase()))
      : node.tagName?.toLowerCase() === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function savedAttempt(overrides = {}) {
  const questions = Array.from({ length: 20 }, (_, i) => ({ id: `fixture-question-${i + 1}`, number: i + 1, prompt: `Is the stated legal condition established in question ${i + 1}? Explain the applicable facts.` }));
  return { id: attemptId, clientAttemptId: clientId, subject, setId: `sha256:${'a'.repeat(64)}`,
    status: 'pending', questionCount: 20, completedQuestionCount: 0,
    acceptedAt: '2026-09-07T01:00:00Z', updatedAt: '2026-09-07T01:00:00Z', retryAllowed: false,
    questions, answers: questions.map((q) => ({ questionId: q.id, answer })), result: null, ...overrides };
}
function completedAttempt(overrides = {}) {
  const value = savedAttempt(overrides);
  const results = value.questions.map((q) => ({ questionId: q.id, number: q.number, score: 4, maxScore: 5,
    userAnswer: value.answers.find((a) => a.questionId === q.id).answer, suggestedAnswer: 'The suggested legal answer explains the applicable requirement and the facts.',
    feedback: 'The governing legal basis is applied to these facts.', explanation: 'The reasoning states the applicable rule and connects the material facts.',
    mockBarCoaching: { strength: 'States the applicable rule.', priorityImprovement: 'Connect each material fact.', nextStep: 'Rewrite the application with specific facts.' },
    grammar: { score: 4, maxScore: 5, corrections: [] },
    issueSpotting: { score: 4, maxScore: 5, identified: [], missed: [], coaching: 'Identify the disputed legal requirement.' } }));
  const analytics = { questionCount: 20, averageScore: 4, issueSpottingAverage: 4, grammarAverage: 4, diagnosticMaxScore: 5,
    performanceBands: { strong: 20, developing: 0, needsFocus: 0 } };
  return { ...value, status: 'complete', completedQuestionCount: 20, resultRevision: 1,
    summary: { totalScore: 80, maxScore: 100, percentage: 80 },
    result: { attemptId: value.id, ownerId: owner, subject: value.subject, setId: value.setId,
      complete: true, questionCount: 20, completedQuestionCount: 20, totalScore: 80, maxScore: 100, results, analytics } };
}
function fixture({ storage = new Map() } = {}) {
  const timers = new Map(); const intervals = new Map(); const events = new Map(); const calls = []; let timerId = 0;
  const session = { access_token: 'synthetic-token', user: { id: owner } };
  const view = new TinyNode(); const body = new TinyNode('body');
  const location = { hash: '#bar-forecast-2026', pathname: '/', search: '' };
  const window = {
    crypto: webcrypto, AbortController, location, confirm: () => true, addEventListener: (name, fn) => events.set(name, fn),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++timerId; intervals.set(id, { fn, delay }); return id; }, clearInterval: (id) => intervals.delete(id),
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    DueDiligencePhase4: { getSession: () => session, ensureRequiredSetup: async () => true,
      openUnlimitedFeatureGate: () => {}, request: async (_route, options) => { calls.push(options); return { authorized: true, consentAccepted: true, attempt: savedAttempt() }; } },
    dispatchEvent: () => {}, getSelection: () => null,
  };
  const document = { body, activeElement: null, createElement: (tag) => new TinyNode(tag), createTextNode: (text) => new TinyNode('#text', text), querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({ window, document, console, Node: { ELEMENT_NODE: 1 }, Element: TinyNode,
    AbortController, Uint8Array, Intl, location, history: { back: () => {}, replaceState: () => {}, pushState: () => {} },
    requestAnimationFrame: () => {}, Event: class {}, CustomEvent: class {} });
  const end = '})(window);'; assert.equal(source.split(end).length - 1, 1);
  vm.runInContext(source.replace(end, `global.__durableTest = { state, submitForecast, sendForecastSubmission, persistForecastDraft, readForecastDrafts,
    restoreForecastDraft, adoptSavedAttempt, normalizedSavedAttempt, openSavedForecast, pollSavedForecast, stopForecastPolling,
    loadForecastHistory, renderForecastHistory, closeForecast, handleForecastAccessChange, handleForecastSessionChange,
    renderSavedForecastStatus, resetProtectedState, requestForecast, nullableMetric, retrySavedForecast,
    downloadSavedForecast, emailSavedForecast };\n${end}`), context);
  const hooks = window.__durableTest; const state = hooks.state; const attempt = savedAttempt();
  Object.assign(state, { ownerId: owner, isOpen: true, view: 'exam', viewNode: view, root: new TinyNode(), closeButton: new TinyNode('button'),
    clientAttemptId: clientId, subject, setId: attempt.setId, questions: attempt.questions, answers: new Map(attempt.answers.map((a) => [a.questionId, a.answer])), currentIndex: 19 });
  return { ...hooks, window, context, view, storage, timers, intervals, events, calls, session, location,
    fire: (delay) => { const found = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(found, `Expected ${delay}ms timer`); timers.delete(found[0]); found[1].fn(); } };
}

test('final editor is captured before completeness and the frozen 20-answer draft exists before transport', async () => {
  const c = fixture(); const pending = deferred();
  c.state.answers.set(c.state.questions[19].id, '');
  const editor = new TinyNode(); editor.innerText = answer;
  c.state.examRefs = { editor, jumpButtons: Array.from({ length: 20 }, () => new TinyNode()),
    flagIcons: Array.from({ length: 20 }, () => new TinyNode()) };
  for (const name of ['status', 'count', 'countWords', 'countCharacters', 'countWithoutSpaces', 'metaProgress', 'submit', 'flagQuestion', 'previous', 'next', 'showAll']) {
    c.state.examRefs[name] = new TinyNode();
  }
  c.window.DueDiligencePhase4.request = async (_route, { body }) => {
    const draft = c.readForecastDrafts()[clientId];
    assert.equal(draft.submission.answers.length, 20); assert.equal(draft.submission.answers[19].answer, answer);
    assert.equal(body.operation, 'submit_attempt'); assert.equal(body.clientAttemptId, clientId);
    assert.equal(Object.isFrozen(body), true); assert.equal(Object.isFrozen(body.answers), true);
    assert.equal(body.answers.length, 20);
    assert.deepEqual(JSON.parse(JSON.stringify(body)), JSON.parse(JSON.stringify(draft.submission)),
      'The exact persisted snapshot, not a later editor reconstruction, must be sent.');
    body.answers.forEach((row, index) => {
      assert.equal(Object.isFrozen(row), true);
      assert.equal(row.questionId, c.state.questions[index].id);
      assert.equal(row.answer, c.state.answers.get(row.questionId));
    });
    return pending.promise;
  };
  const request = c.submitForecast(); await flush();
  assert.equal(c.state.view, 'submitting'); assert.equal(c.state.acceptedAttempt, null);
  assert.doesNotMatch(c.view.textContent, /Your answers are saved/);
  pending.resolve({ attempt: savedAttempt() }); await request;
  assert.equal(c.state.acceptedAttempt.id, attemptId); assert.match(c.view.textContent, /Your answers are saved/);
  c.stopForecastPolling();
});

test('storage failure prevents unprotected submission and preserves editor answers', async () => {
  const c = fixture(); c.window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  await c.submitForecast(); assert.equal(c.calls.length, 0); assert.equal(c.state.view, 'exam');
  assert.equal(c.state.answers.size, 20); assert.equal(c.state.submissionSnapshot, null);
});

test('nineteen completed answers cannot start a submission or a grading request', async () => {
  const c = fixture(); c.state.answers.set(c.state.questions[19].id, '');
  await c.submitForecast();
  assert.equal(c.calls.length, 0); assert.equal(c.state.view, 'exam');
  assert.equal(c.state.submissionSnapshot, null); assert.equal(c.state.acceptedAttempt, null);
  assert.equal(c.state.answers.size, 20);
  assert.equal(c.state.answers.get(c.state.questions[0].id), answer);
});

test('private draft storage is owner-scoped and contains no session credentials', () => {
  const c = fixture(); assert.equal(c.persistForecastDraft(), true);
  assert.deepEqual([...c.storage.keys()], [`duediligence.private.${owner}.bar-forecast.drafts.v1`]);
  const serialized = [...c.storage.values()][0]; const stored = JSON.parse(serialized);
  assert.equal(stored.ownerId, owner); assert.equal(stored.drafts[clientId].answers.length, 20);
  assert.doesNotMatch(serialized, /synthetic-token|access_token|refresh_token|Authorization|Bearer /u);
  c.session.user.id = otherId;
  assert.equal(c.persistForecastDraft(), false, 'A stale owner may not write into the new owner scope.');
  assert.deepEqual([...c.storage.values()], [serialized], 'Rejected cross-owner writes preserve the original draft.');
});

test('lost acceptance acknowledgement retains one immutable id; retry and reload never create another submission', async () => {
  const c = fixture(); const sent = [];
  c.window.DueDiligencePhase4.request = async (_route, { body }) => { sent.push(JSON.parse(JSON.stringify(body))); throw new Error('Connection lost'); };
  await c.submitForecast(); assert.equal(c.state.view, 'unconfirmed'); assert.equal(c.state.results, null);
  c.state.answers.set(c.state.questions[0].id, 'An accidental later edit must not replace the submitted answer.');
  await c.sendForecastSubmission(); assert.deepEqual(sent[0], sent[1]);
  const reloaded = fixture({ storage: c.storage }); reloaded.restoreForecastDraft(clientId);
  assert.equal(reloaded.state.view, 'unconfirmed'); assert.equal(reloaded.state.submissionSnapshot.clientAttemptId, clientId);
  assert.equal(reloaded.state.submissionSnapshot.answers[0].answer, answer);
});

test('same-browser different owner cannot discover or restore another owner draft', () => {
  const c = fixture(); c.persistForecastDraft(); c.session.user.id = otherId; c.state.ownerId = otherId;
  assert.equal(Object.keys(c.readForecastDrafts()).length, 0); c.restoreForecastDraft(clientId);
  assert.equal(c.state.view, 'exam'); assert.equal(c.storage.size, 1);
});

test('completed canonical report clears unrelated markup and validates before mutating current results', () => {
  const c = fixture(); c.state.answerMarkup.set('fixture-question-1', '<b>UNRELATED PRIVATE DRAFT</b>');
  c.adoptSavedAttempt(completedAttempt()); c.renderSavedForecastStatus();
  assert.equal(c.state.answerMarkup.size, 0); assert.equal(c.state.results.totalScore, 80);
  assert.match(c.view.textContent, /80 \/ 100/); assert.doesNotMatch(c.view.textContent, /UNRELATED PRIVATE DRAFT/);
  const original = c.state.results; const broken = completedAttempt({ id: otherId }); broken.result.results[0].score = null;
  assert.throws(() => c.adoptSavedAttempt(broken), /integrity check/); assert.equal(c.state.results, original);
  const wrongOwner = completedAttempt({ id: otherId }); wrongOwner.result.ownerId = otherId;
  assert.throws(() => c.adoptSavedAttempt(wrongOwner), /identity check/);
});

test('missing or failed grades never render a zero final score', () => {
  const c = fixture(); c.adoptSavedAttempt(savedAttempt({ status: 'failed' })); c.renderSavedForecastStatus();
  assert.equal(c.state.results, null); assert.match(c.view.textContent, /No final score/);
  assert.doesNotMatch(c.view.textContent, /0 \/ 100|0%|Retry assessment/);
  assert.equal(c.nullableMetric(null, '%'), '—'); assert.equal(c.nullableMetric(0, '%'), '0%');
});

test('newer saved report wins when earlier transport resolves late for the same account', async () => {
  const c = fixture(); const first = deferred(); const second = deferred(); let n = 0;
  c.window.DueDiligencePhase4.request = () => (++n === 1 ? first : second).promise;
  const older = c.openSavedForecast(attemptId); const newer = c.openSavedForecast(otherId);
  second.resolve({ attempt: completedAttempt({ id: otherId }) }); await newer;
  first.resolve({ attempt: completedAttempt() }); await older;
  assert.equal(c.state.acceptedAttempt.id, otherId); assert.equal(c.state.view, 'results');
});

test('closing pending progress aborts the active request and retains accepted work for reload', async () => {
  const c = fixture(); c.adoptSavedAttempt(savedAttempt()); c.renderSavedForecastStatus();
  const pending = deferred(); let signal;
  c.window.DueDiligencePhase4.request = (_route, options) => { signal = options.signal; return pending.promise; };
  const polling = c.pollSavedForecast(attemptId); c.fire(5000); await flush();
  assert.equal(c.closeForecast({ restoreRoute: false }), true); assert.equal(signal.aborted, true); await flush();
  assert.equal(c.state.isOpen, false); assert.equal(c.timers.size, 0); assert.equal(c.intervals.size, 0);
  assert.equal(c.readForecastDrafts()[clientId].attemptId, attemptId);
  pending.resolve({ attempt: completedAttempt() }); await polling;
  assert.equal(c.state.results, null); assert.equal(c.view.textContent, '');
});

test('polling has a finite automatic budget and requires an explicit manual continuation', async () => {
  const c = fixture(); c.adoptSavedAttempt(savedAttempt()); c.renderSavedForecastStatus();
  const polling = c.pollSavedForecast(attemptId);
  for (let count = 0; count < 60; count++) { c.fire(5000); await flush(); }
  await polling; assert.equal(c.calls.length, 60); assert.equal(c.timers.size, 0);
  assert.equal(c.state.view, 'saved-status'); assert.match(c.view.textContent, /Automatic checking has paused/);
});

test('stopping an old poll cannot erase the newer poll cancellation handle', async () => {
  const c = fixture(); c.adoptSavedAttempt(savedAttempt()); c.renderSavedForecastStatus();
  const old = c.pollSavedForecast(attemptId); const newer = c.pollSavedForecast(attemptId); await flush();
  assert.equal(c.timers.size, 1); assert.equal(typeof c.state.pollResolve, 'function');
  c.stopForecastPolling(); await Promise.all([old, newer]); assert.equal(c.timers.size, 0);
});

test('same-owner explicit revocation clears protected UI while retaining the owner-scoped draft', () => {
  const c = fixture(); c.persistForecastDraft();
  c.handleForecastAccessChange({ detail: { allowed: false, unlimited: false, basis: 'paid_subscription_expired', role: 'student' } });
  assert.equal(c.state.isOpen, false); assert.equal(c.state.questions.length, 0); assert.equal(c.state.results, null);
  assert.equal(Object.keys(c.readForecastDrafts()).length, 1);
});

test('analytics use the full server aggregate, not one page or pending scores', async () => {
  const c = fixture(); c.window.DueDiligencePhase4.request = async (_route, { body }) => {
    assert.equal(body.operation, 'history'); assert.equal(body.completeOnly, true);
    return { attempts: [savedAttempt({ summary: { percentage: 0 } })], nextCursor: null,
      analytics: { completeOnly: true, completedAttempts: 42, averagePercentage: 82.3, averageGrammarScore: 4.1,
        averageIssueSpottingScore: 4.2, bySubject: [{ subject, completedAttempts: 42, averagePercentage: 82.3 }] } };
  };
  await c.loadForecastHistory('analytics'); assert.match(c.view.textContent, /82.3%/); assert.match(c.view.textContent, /42/);
  assert.doesNotMatch(c.view.textContent, /0%/);
});

test('history date filters are Philippine-day boundaries and pagination uses the server cursor', async () => {
  const c = fixture(); c.state.historyFrom = '2026-09-01'; c.state.historyTo = '2026-09-02';
  const before = { acceptedAt: '2026-09-02T00:00:00Z', id: attemptId };
  c.state.historyCursor = before;
  c.window.DueDiligencePhase4.request = async (_route, { body }) => {
    assert.equal(body.from, '2026-08-31T16:00:00.000Z'); assert.equal(body.to, '2026-09-02T16:00:00.000Z');
    assert.deepEqual(body.before, before); return { attempts: [], nextCursor: null };
  };
  await c.loadForecastHistory('history', true); assert.equal(c.state.historyCursor, null);
});

test('transport ignoring AbortSignal still reaches a finite unknown-acceptance state', async () => {
  const c = fixture(); c.window.DueDiligencePhase4.request = () => new Promise(() => {});
  const request = c.submitForecast(); await flush(); c.fire(25000); await request;
  assert.equal(c.state.view, 'unconfirmed'); assert.equal(c.state.acceptedAttempt, null);
  assert.equal(c.readForecastDrafts()[clientId].submission.clientAttemptId, clientId); assert.equal(c.timers.size, 0);
});

test('account switch cancels an old report while the new owner authorization completes', async () => {
  const c = fixture(); const old = deferred();
  c.window.DueDiligencePhase4.request = (_route, { body }) => body.operation === 'attempt'
    ? old.promise : Promise.resolve({ authorized: true, consentAccepted: true });
  const request = c.openSavedForecast(attemptId);
  c.session.user.id = otherId; c.handleForecastSessionChange(); await flush();
  assert.equal(c.state.ownerId, otherId); assert.equal(c.state.view, 'picker');
  old.resolve({ attempt: completedAttempt() }); await request;
  assert.equal(c.state.ownerId, otherId); assert.equal(c.state.results, null); assert.equal(c.state.view, 'picker');
});

test('an incorrect returned attempt identity cannot replace the selected saved report', async () => {
  const c = fixture(); c.window.DueDiligencePhase4.request = async () => ({ attempt: completedAttempt({ id: otherId }) });
  await c.openSavedForecast(attemptId); assert.equal(c.state.acceptedAttempt, null); assert.equal(c.state.view, 'saved-error');
  assert.doesNotMatch(c.view.textContent, /80 \/ 100/);
});

test('manual assessment retry uses the same server attempt and never sends mutable answers', async () => {
  const c = fixture(); c.adoptSavedAttempt(savedAttempt({ status: 'failed', retryAllowed: true }));
  c.window.DueDiligencePhase4.request = async (_route, { body }) => {
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { operation: 'retry_attempt', attemptId });
    return { attempt: savedAttempt() };
  };
  await c.retrySavedForecast(attemptId); assert.equal(c.state.acceptedAttempt.id, attemptId); c.stopForecastPolling();
});

test('PDF and email are explicit completed-report actions; provider acceptance never claims delivery', async () => {
  const c = fixture(); c.adoptSavedAttempt(completedAttempt()); c.renderSavedForecastStatus();
  assert.equal(c.calls.length, 0); assert.match(c.view.textContent, /Download PDF/); assert.match(c.view.textContent, /Email to me/);
  c.window.DueDiligencePhase4.request = async (_route, { body }) => {
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { operation: 'email_result', attemptId });
    return { ok: true, email: { status: 'provider_accepted' } };
  };
  const trigger = new TinyNode('button'); const status = new TinyNode();
  await c.emailSavedForecast(trigger, status); assert.equal(trigger.disabled, true);
  assert.match(status.textContent, /not yet confirmed/); assert.doesNotMatch(status.textContent, /successfully delivered/);
  c.window.DueDiligencePhase2Config = { workerUrl: 'https://synthetic.example.invalid' };
  c.window.URL = { createObjectURL: () => 'blob:synthetic-only', revokeObjectURL: () => {} };
  c.window.fetch = async (url, options) => {
    assert.equal(url, 'https://synthetic.example.invalid/admin/dd2026/bar-forecast');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.deepEqual(JSON.parse(options.body), { operation: 'result_pdf', attemptId });
    return new Response(new Blob(['%PDF-synthetic-only']), { headers: { 'Content-Type': 'application/pdf' } });
  };
  await c.downloadSavedForecast(trigger, status); assert.equal(status.textContent, 'Saved report downloaded.');
});
