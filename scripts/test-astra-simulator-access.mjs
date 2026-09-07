import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(path.resolve(process.argv[2] || '.', 'assets/examinations.js'), 'utf8');
const paid = { allowed: true, unlimited: true, basis: 'paid_subscription' };
const denied = { allowed: false, unlimited: false, basis: 'subscription_required' };
const result = (answer) => ({ attempt: { counts: { total: 1 } }, results: [
  { ordinal: 1, questionId: 'synthetic-question', answerText: answer, prompt: 'Synthetic prompt', aiScore: 4,
    aiAssessment: { rationale: 'Synthetic coaching.', performanceLabel: 'Practice assessment' } },
] });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ abortSupport = true } = {}) {
  const footer = { textContent: '' };
  const clock = { classList: { toggle: () => {} } };
  const value = { textContent: '' };
  const root = { innerHTML: '', querySelector: (s) => s === '[data-current-word-status]' ? footer : null,
    querySelectorAll: () => [] };
  const storage = new Map();
  const listeners = new Map();
  const calls = [];
  const session = { user: { id: 'synthetic-owner' }, access_token: 'synthetic-test-only' };
  const window = {
    location: { hash: '#bar-feels' },
    ...(abortSupport ? { AbortController } : {}),
    DueDiligencePhase2Config: { workerUrl: 'https://example.invalid' },
    DueDiligencePrivateWorkspace: { generation: () => 1, scopedKey: (_, key) => `owner:${key}` },
    DueDiligencePhase4: { getSession: () => session, request: async (route, options) => {
      calls.push({ route, ...options }); return { data: result('Saved answer') };
    } },
    showPage: () => {},
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const document = {
    readyState: 'loading', addEventListener: () => {}, querySelectorAll: () => [],
    getElementById: (id) => id === 'dd-room-clock' ? clock : id === 'dd-room-clock-value' ? value : root,
  };
  const context = vm.createContext({ window, document, console, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => {},
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } });
  const end = '\n}(window));';
  assert.equal(source.split(end).length - 1, 1);
  vm.runInContext(source.replace(end, '\n  global.__astraTest = { state, api, syncSimulatorAccessUi, simulatorAccessAllowed, updateClockNode, tickClock, showTrackPage };' + end), context);
  window.__astraTest.state.track = 'bar_feels';
  return { window, root, footer, value, storage, listeners, calls, session, ...window.__astraTest };
}
function active(c) {
  c.state.active = { examination: { track: 'bar_feels' }, attempt: { attemptId: 'synthetic-attempt', timerMode: 'strict' },
    questions: [{ questionId: 'synthetic-question', answerText: 'My exact unsent answer.\n\nSecond paragraph.', revision: 2 }] };
  c.state.screen = 'room'; c.state.currentIndex = 0;
}

test('same-owner revocation preserves exact draft before clearing private state and stopping pending requests', async () => {
  const c = fixture(); active(c);
  c.state.catalog = [{ private: true }]; c.state.history = [{ private: true }]; c.state.setup = { private: true };
  const pending = deferred();
  let signal;
  c.window.DueDiligencePhase4.request = (_, options) => { signal = options.signal; return pending.promise; };
  const request = c.api('/examinations/query', { operation: 'resume' });
  const rejected = assert.rejects(request, (error) => error.code === 'STALE_IDENTITY' || error.code === 'STALE_EXAMINATION_REQUEST');
  c.syncSimulatorAccessUi(denied);
  assert.equal(signal.aborted, true);
  assert.equal(c.state.active, null); assert.equal(c.state.setup, null);
  assert.equal(c.state.catalog.length, 0); assert.equal(c.state.history.length, 0);
  assert.equal(c.state.requestControllers.size, 0); assert.equal(c.state.screen, 'access');
  assert.match(c.root.innerHTML, /Subscribe to continue/); assert.match(c.root.innerHTML, /href="#pricing"/);
  const retained = JSON.parse([...c.storage.values()][0]);
  assert.equal(retained.ownerUserId, 'synthetic-owner');
  assert.equal(retained.questions[0].answerText, 'My exact unsent answer.\n\nSecond paragraph.');
  pending.resolve({ data: { private: 'must not render' } });
  await rejected;
});

test('network uncertainty does not revoke access or destroy the active draft', () => {
  const c = fixture(); active(c); const original = c.state.active;
  for (const snapshot of [null, undefined, {}, { allowed: false }, { basis: 'network_error' }]) c.syncSimulatorAccessUi(snapshot);
  assert.equal(c.state.active, original); assert.equal(c.state.screen, 'room'); assert.equal(c.storage.size, 0);
});

test('resolved failed, rejected, expired and historical-only snapshots cannot retain Simulator access', () => {
  for (const basis of ['historical_owner', 'free_trial', 'payment_rejected', 'payment_required', 'subscription_expired']) {
    const c = fixture(); active(c); c.syncSimulatorAccessUi({ ...paid, basis });
    assert.equal(c.state.active, null, basis); assert.equal(c.state.simulationAccessRevoked, true, basis);
  }
});

test('feature admission recognizes paid, beta, admin and unexpired provisional without expanding other roles', () => {
  const c = fixture();
  for (const basis of ['paid_subscription', 'early_access', 'founding_beta']) assert.equal(c.simulatorAccessAllowed({ ...paid, basis }), true);
  for (const role of ['admin', 'founder_admin', 'super_admin']) assert.equal(c.simulatorAccessAllowed({ ...denied, role }), true);
  assert.equal(c.simulatorAccessAllowed({ ...denied, role: 'student' }), false);
  assert.equal(c.simulatorAccessAllowed({ ...paid, basis: 'provisional_payment', entitlementEndsAt: new Date(Date.now() + 60000).toISOString() }), true);
  for (const end of [null, 'invalid', new Date(Date.now() - 1000).toISOString()]) {
    assert.equal(c.simulatorAccessAllowed({ ...paid, basis: 'provisional_payment', entitlementEndsAt: end }), false);
  }
  for (const gate of [{ termsRequired: true }, { reauthenticationRequired: true }, { commercialLaunchEnabled: true, profileCompleted: false }]) {
    assert.equal(c.simulatorAccessAllowed({ ...paid, ...gate }), false);
  }
});

test('per_subject draft and historical result flow are not revoked by Simulator restrictions', () => {
  const c = fixture(); active(c); c.state.track = 'per_subject'; c.state.active.examination.track = 'per_subject';
  const original = c.state.active; c.syncSimulatorAccessUi(denied);
  assert.equal(c.state.active, original); assert.equal(c.state.screen, 'room');
});

test('overlapping verdict requests render only the newest result for the same owner', async () => {
  const c = fixture(); const first = deferred(); const second = deferred(); let count = 0;
  c.window.DueDiligencePhase4.request = () => (++count === 1 ? first : second).promise;
  const older = c.window.DueDiligenceExaminations.openVerdict('older');
  const newer = c.window.DueDiligenceExaminations.openVerdict('newer');
  second.resolve({ data: result('NEWEST PRIVATE ANSWER') }); await newer;
  assert.match(c.root.innerHTML, /NEWEST PRIVATE ANSWER/);
  first.resolve({ data: result('STALE PRIVATE ANSWER') }); await older;
  assert.match(c.root.innerHTML, /NEWEST PRIVATE ANSWER/); assert.doesNotMatch(c.root.innerHTML, /STALE PRIVATE ANSWER/);
});

test('navigation away ignores an outstanding verdict and leaves the new route untouched', async () => {
  const c = fixture(); const pending = deferred(); c.window.DueDiligencePhase4.request = () => pending.promise;
  const request = c.window.DueDiligenceExaminations.openVerdict('old-route');
  c.window.location.hash = '#pricing'; c.root.innerHTML = 'Current route';
  pending.resolve({ data: result('OLD ROUTE PRIVATE ANSWER') }); await request;
  assert.equal(c.root.innerHTML, 'Current route');
});

test('revocation during verdict retrieval cannot repaint answers after a late response', async () => {
  const c = fixture(); const pending = deferred(); c.window.DueDiligencePhase4.request = () => pending.promise;
  const request = c.window.DueDiligenceExaminations.openVerdict('revoked');
  c.syncSimulatorAccessUi(denied); const gate = c.root.innerHTML;
  pending.resolve({ data: result('REVOKED PRIVATE ANSWER') }); await request;
  assert.equal(c.root.innerHTML, gate); assert.doesNotMatch(c.root.innerHTML, /REVOKED PRIVATE ANSWER/);
});

test('caller cancellation is relayed and the controller is removed after completion', async () => {
  const c = fixture(); const outer = new AbortController(); let captured;
  c.window.DueDiligencePhase4.request = async (_, options) => { captured = options.signal;
    outer.abort(); assert.equal(captured.aborted, true); throw new Error('Synthetic cancelled request'); };
  await assert.rejects(c.api('/examinations/query', {}, { signal: outer.signal }), /Synthetic cancelled/);
  assert.equal(c.state.requestControllers.size, 0);
});

test('generation fencing still protects browsers without AbortController', async () => {
  const c = fixture({ abortSupport: false }); const pending = deferred();
  c.window.DueDiligencePhase4.request = () => pending.promise;
  const request = c.api('/examinations/query'); const rejected = assert.rejects(request, (e) => e.code === 'STALE_IDENTITY');
  c.syncSimulatorAccessUi(denied); pending.resolve({ data: result('STALE') }); await rejected;
});

test('header and footer use one live timer and advisory zero never submits or removes the answer', () => {
  const c = fixture(); active(c); c.state.clientRemaining = 2;
  c.updateClockNode(); assert.match(c.footer.textContent, new RegExp(`${c.value.textContent} remaining`));
  c.tickClock(); assert.match(c.footer.textContent, new RegExp(`${c.value.textContent} remaining`));
  c.tickClock(); assert.equal(c.state.clientRemaining, 0); assert.match(c.footer.textContent, new RegExp(`${c.value.textContent} remaining`));
  assert.equal(c.state.active.questions[0].answerText, 'My exact unsent answer.\n\nSecond paragraph.');
  assert.equal(c.state.screen, 'room'); assert.equal(c.calls.length, 0); assert.equal(c.storage.size, 1);
});
