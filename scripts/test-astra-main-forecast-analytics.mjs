// Memory-only DOM and transport tests of the actual shipped functions. No live
// user, provider, Supabase, email, or result mutation is involved.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const forecastSource = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const loader = await readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUBJECT = 'Civil Law and Land Titles and Deeds';
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
class Node {
  constructor(tag = 'div', text = '') {
    this.tagName = tag; this.children = []; this._text = text; this.attrs = {}; this.dataset = {}; this.style = {};
    this.events = new Map(); this.isConnected = true; this.hidden = false;
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return [this._text, ...this.children.map((item) => item.textContent)].join(' '); }
  set innerHTML(value) { this.textContent = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] || null; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  click() { return this.events.get('click')?.(); }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  all(tag) { return this.children.flatMap((node) => [...(node.tagName === tag ? [node] : []), ...node.all(tag)]); }
}
function summary(overrides = {}) {
  return { completeOnly: true, completedAttempts: 40, pendingAttempts: 2, failedAttempts: 1,
    averagePercentage: 83.4, averageGrammarScore: 3.8, averageIssueSpottingScore: 4.1,
    bySubject: [{ subject: SUBJECT, completedAttempts: 40, averagePercentage: 83.4 }], trend: [], ...overrides };
}
function attempt(id = 'attempt-1', overrides = {}) {
  return { id, subject: SUBJECT, status: 'complete', resultRevision: 1,
    acceptedAt: '2026-09-07T01:00:00Z', completedAt: '2026-09-07T01:05:00Z', summary: { percentage: 80, totalScore: 80, maxScore: 100 }, ...overrides };
}
function payload(overrides = {}) { return { attempts: [attempt()], analytics: summary(), nextCursor: null, ...overrides }; }
function fixture() {
  const nodes = new Map();
  for (const id of ['analytics-body', 'analytics-forecast-body', 'analytics-practice-actions', 'analytics-tab-practice', 'analytics-tab-forecast']) {
    const node = new Node(id.includes('-tab-') ? 'button' : 'div'); node.id = id; nodes.set(id, node);
  }
  const tabs = [nodes.get('analytics-tab-practice'), nodes.get('analytics-tab-forecast')];
  tabs[0].dataset.analyticsTab = 'practice'; tabs[1].dataset.analyticsTab = 'forecast';
  const events = new Map(); const timers = new Map(); const calls = []; const storage = new Map(); let timerId = 0;
  const session = { access_token: 'synthetic', user: { id: OWNER } };
  const host = nodes.get('analytics-forecast-body');
  const location = { hash: '#verdict', href: 'https://example.test/#verdict' };
  const history = { state: {}, entries: [], pushState(value) { this.state = value; this.entries.push(value); },
    replaceState(value, _title, href) { this.state = value; location.href = href; } };
  const objectUrls = [];
  class TestURL extends URL { static createObjectURL(blob) { objectUrls.push(blob); return 'blob:local-synthetic'; } static revokeObjectURL() {} }
  const window = {
    location, history, crypto, URL: TestURL,
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: (id) => timers.delete(id),
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    DueDiligencePhase4: { getSession: () => session, request: async (path, options) => { calls.push({ path, ...options }); return payload(); } },
    DueDiligenceFeatureLoader: { loadForFeature: async () => true },
  };
  const document = { body: new Node('body'), createElement: (tag) => new Node(tag), createTextNode: (text) => new Node('#text', text),
    getElementById: (id) => nodes.get(id), querySelectorAll: (selector) => selector === '[data-analytics-tab]' ? tabs : [] };
  const context = vm.createContext({ window, document, console, AbortController, Intl, URL, location, history, Element: Node });
  vm.runInContext(forecastSource.replace('})(window);', `global.__forecast = {state, setOpeners(open, saved) { openForecast = open; openSavedForecast = saved; }}; })(window);`), context);
  return { window, document, context, nodes, tabs, location, history, host, session, calls, timers, storage, objectUrls,
    state: window.__forecast.state,
    emit(name, detail) { for (const fn of [...(events.get(name) || [])]) fn({ detail }); },
    mount() { return window.DueDiligenceBarForecast.mountAnalytics(host); },
    transport(fn) { window.DueDiligencePhase4.request = async (path, options) => { calls.push({ path, ...options }); return fn(options.body, options); }; },
  };
}
const button = (host, label) => host.all('button').find((node) => node.textContent.trim() === label);
const input = (host, label) => host.all('input').find((node) => node.getAttribute('aria-label') === label);
async function change(node, value) { node.value = value; node.events.get('change')(); await flush(); }

test('main Forecast pane reads full saved aggregate, not page average; no exam or storage mutation', async () => {
  const c = fixture(); const workspaceController = new AbortController();
  Object.assign(c.state, { requestController: workspaceController, answers: new Map([['draft', 'Keep these exact words']]), view: 'exam', workspaceGeneration: 9 });
  await c.mount().refresh();
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].body.operation, 'history');
  assert.equal(c.calls[0].body.completeOnly, true); assert.equal(c.calls[0].body.limit, 20);
  assert.match(c.host.textContent, /83\.4%/); assert.match(c.host.textContent, /40/);
  assert.match(c.host.textContent, /80 \/ 100 points/); assert.match(c.host.textContent, /2 pending · 1 need attention/);
  assert.equal(c.state.requestController, workspaceController); assert.equal(workspaceController.signal.aborted, false);
  assert.equal(c.state.answers.get('draft'), 'Keep these exact words'); assert.equal(c.state.workspaceGeneration, 9);
  assert.equal(c.storage.size, 0); assert.equal(c.timers.size, 0);
});

test('unfinished results are separately labeled and never displayed as a zero grade', async () => {
  const c = fixture(); c.transport(() => payload({ attempts: [attempt(), attempt('pending', { status: 'processing', summary: null })] }));
  await c.mount().refresh();
  const checkbox = c.host.all('input').find((node) => node.type === 'checkbox'); checkbox.checked = true;
  checkbox.events.get('change')(); await flush();
  assert.equal(c.calls.at(-1).body.completeOnly, false);
  assert.match(c.host.textContent, /Pending or incomplete — excluded from averages/);
  assert.match(c.host.textContent, /Assessing · No final score/);
  assert.doesNotMatch(c.host.textContent, /Assessing · 0/); assert.match(c.host.textContent, /83\.4%/);
});

test('subject and Philippine-day filters reach the server before paging; cursor retry deduplicates attempts', async () => {
  const c = fixture(); const cursor = { acceptedAt: '2026-09-07T01:00:00Z', id: 'attempt-1' };
  c.transport((body) => payload({ attempts: body.before ? [attempt(), attempt('attempt-2')] : [attempt()], nextCursor: body.before ? null : cursor }));
  await c.mount().refresh(); await change(c.host.all('select')[0], SUBJECT);
  await change(input(c.host, 'From date, Philippine time'), '2026-09-06');
  await change(input(c.host, 'Through date, Philippine time'), '2026-09-07');
  await button(c.host, 'Load more').click(); await flush();
  const last = c.calls.at(-1).body;
  assert.equal(last.subject, SUBJECT); assert.equal(last.from, '2026-09-05T16:00:00.000Z'); assert.equal(last.to, '2026-09-07T16:00:00.000Z');
  assert.equal(last.before.id, cursor.id); assert.equal(last.completeOnly, true);
  assert.equal(c.host.all('article').length, 2); assert.match(c.host.textContent, /83\.4%/);
  const count = c.calls.length;
  await change(input(c.host, 'From date, Philippine time'), '2026-09-09');
  assert.equal(c.calls.length, count); assert.match(c.host.textContent, /on or after the start date/);
});

test('obsolete filters, tab departure, and ignored cancellation cannot display a stale response', async () => {
  const c = fixture(); const old = deferred(); c.transport(() => old.promise);
  const api = c.mount(); const opening = api.refresh();
  c.transport(() => payload({ analytics: summary({ averagePercentage: 91.7 }) }));
  await api.refresh(); old.resolve(payload({ analytics: summary({ averagePercentage: 12.3 }) })); await opening;
  assert.match(c.host.textContent, /91\.7%/); assert.doesNotMatch(c.host.textContent, /12\.3%/);
  const later = deferred(); c.transport(() => later.promise); const request = api.refresh();
  api.setActive(false); assert.equal(c.calls.at(-1).signal.aborted, true);
  later.resolve(payload({ analytics: summary({ averagePercentage: 22.2 }) })); await request;
  assert.doesNotMatch(c.host.textContent, /22\.2%/);
});

test('owner change immediately clears old history and ignores its in-flight response; sign-out makes no request', async () => {
  const c = fixture(); const api = c.mount(); await api.refresh();
  const stale = deferred(); c.transport(() => stale.promise); const request = api.refresh();
  c.transport(() => payload({ attempts: [], analytics: summary({ completedAttempts: 0, averagePercentage: null }) }));
  c.session.user.id = OTHER; c.emit('duediligence:session');
  assert.doesNotMatch(c.host.textContent, /83\.4%/);
  stale.resolve(payload({ analytics: summary({ averagePercentage: 11.1 }) })); await request; await flush();
  assert.doesNotMatch(c.host.textContent, /11\.1%|83\.4%/);
  const before = c.calls.length; c.session.access_token = ''; c.emit('duediligence:session'); await flush();
  assert.equal(c.calls.length, before); assert.match(c.host.textContent, /Sign in to see your private saved/);
});

test('history transport ignoring abort still times out visibly and manual refresh recovers', async () => {
  const c = fixture(); c.transport(() => new Promise(() => {})); const api = c.mount(); const pending = api.refresh();
  const timeout = [...c.timers.values()].find((item) => item.delay === 25000); assert.ok(timeout); timeout.fn(); await pending;
  assert.match(c.host.textContent, /could not be loaded/); assert.equal(c.calls.at(-1).signal.aborted, true);
  c.transport(() => payload()); await api.refresh(); assert.match(c.host.textContent, /83\.4%/);
});

test('routine access events cannot form a reload loop; explicit revocation clears results', async () => {
  const c = fixture(); await c.mount().refresh(); const count = c.calls.length;
  for (let i = 0; i < 5; i++) c.emit('duediligence:access', { allowed: true, unlimited: true, basis: 'paid_subscription', role: 'member' });
  assert.equal(c.calls.length, count);
  c.emit('duediligence:access', { allowed: false, unlimited: false, basis: 'payment_required', role: 'member' });
  assert.doesNotMatch(c.host.textContent, /83\.4%/); assert.match(c.host.textContent, /Forecast access changed/);
  assert.equal(c.calls.length, count);
});

test('report actions use the exact saved attempt viewer and require same owner after authorization', async () => {
  const c = fixture(); const opened = [];
  c.window.__forecast.setOpeners(async () => { c.state.isOpen = true; c.state.ownerId = OWNER; c.state.consentAccepted = true; }, async (id) => { opened.push(id); });
  await c.mount().refresh(); await button(c.host, 'Open report').click();
  assert.deepEqual(opened, ['attempt-1']); assert.equal(c.calls.length, 1);
  c.state.isOpen = false;
  c.window.__forecast.setOpeners(async () => { c.session.user.id = OTHER; c.state.isOpen = true; }, async (id) => { opened.push(id); });
  await button(c.host, 'Open report').click(); assert.equal(opened.length, 1);
});

test('empty, zero, and insufficient samples stay distinct; server errors do not leak response text', async () => {
  const c = fixture(); c.transport(() => payload({ attempts: [], analytics: summary({ completedAttempts: 0, averagePercentage: null, bySubject: [] }) }));
  const api = c.mount(); await api.refresh(); assert.match(c.host.textContent, /Complete an assessment/); assert.match(c.host.textContent, /No saved attempts match/);
  c.transport(() => payload({ analytics: summary({ completedAttempts: 1, averagePercentage: 0 }) }));
  await api.refresh(); assert.match(c.host.textContent, /0%/); assert.match(c.host.textContent, /more results are needed for a score trend/);
  c.transport(() => { throw new Error('synthetic secret response must not reach UI'); });
  await api.refresh(); assert.doesNotMatch(c.host.textContent, /synthetic secret/); assert.match(c.host.textContent, /Refresh to retry/);
});

test('first-use consent and setup errors provide one explicit existing Forecast action; retry can recover saved data', async () => {
  for (const code of ['BAR_FORECAST_CONSENT_REQUIRED', 'BAR_FORECAST_SETUP_REQUIRED']) {
    const c = fixture(); let opens = 0;
    c.window.__forecast.setOpeners(async () => { opens++; }, async () => {});
    c.transport(() => { throw Object.assign(new Error('untrusted server text'), { code, status: 409 }); });
    const api = c.mount(); await api.refresh();
    assert.equal(opens, 0); assert.equal(c.calls.length, 1);
    const action = button(c.host, 'Open Bar Forecast'); assert.ok(action);
    assert.doesNotMatch(c.host.textContent, /untrusted server text/);
    await action.click(); assert.equal(opens, 1); assert.equal(c.calls.length, 1);
    for (let i = 0; i < 5; i++) c.emit('duediligence:session');
    assert.equal(c.calls.length, 1); assert.equal(opens, 1);
    c.transport(() => payload()); await api.refresh();
    assert.match(c.host.textContent, /83\.4%/); assert.equal(button(c.host, 'Open Bar Forecast'), undefined);
  }
});

test('entitlement denial opens the established subscription gate only on click, and stale-owner controls cannot open it', async () => {
  const c = fixture(); const gates = [];
  c.window.DueDiligencePhase4.openUnlimitedFeatureGate = (...args) => { gates.push(args); return true; };
  c.transport(() => { throw Object.assign(new Error('not entitled'), { code: 'BAR_FORECAST_ACCESS_REQUIRED', status: 403 }); });
  await c.mount().refresh(); assert.equal(gates.length, 0);
  const action = button(c.host, 'Subscribe to access'); assert.ok(action); await action.click();
  assert.equal(gates.length, 1); assert.equal(gates[0][0], '#bar-forecast-2026');
  assert.equal(gates[0][1].backgroundHash, '#verdict'); assert.equal(gates[0][1].featureId, 'bar-forecast');
  c.session.user.id = OTHER; c.emit('duediligence:session'); await action.click();
  assert.equal(gates.length, 1); await flush();
});

function installMain(c) {
  const from = html.indexOf('const verdictDashboard ='); const to = html.indexOf('function analyticsFeatureLabel', from);
  assert.ok(from > 0 && to > from);
  const loadFrom = html.indexOf('async function loadVerdictDashboard()'); const loadTo = html.indexOf("window.addEventListener('duediligence:auxiliary-diagnostics-updated'", loadFrom);
  Object.assign(c.context, { analyticsGradedRecords: (records) => records, verdictLocalRecords: () => [], syncAnalyticsDataStatus() {},
    analyticsDisplayRecord: (row) => row, analyticsRecordKey: (row) => row.id, renderVerdictDashboard: () => {}, toast() {},
    verdictRequest: async () => ({ items: [] }) });
  vm.runInContext(html.slice(from, to) + html.slice(loadFrom, loadTo)
    + '\nwindow.__main = {mainAnalyticsTabs, verdictDashboard, selectMainAnalyticsTab, loadVerdictDashboard};', c.context);
  return c.window.__main;
}

test('main tabs are real panels, preserve practice state, hide only practice reset, and support keyboard/back', async () => {
  const c = fixture(); const main = installMain(c); main.verdictDashboard.filters.subject = 'Existing filter';
  await main.selectMainAnalyticsTab('forecast');
  assert.match(c.host.textContent, /83\.4%/); assert.equal(c.nodes.get('analytics-body').hidden, true);
  assert.equal(c.nodes.get('analytics-practice-actions').hidden, true); assert.equal(c.tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(c.history.state.dueDiligenceAnalyticsTab, 'forecast');
  c.tabs[1].events.get('keydown')({ key: 'ArrowLeft', preventDefault() {} }); await flush();
  assert.equal(c.tabs[0].focused, true); assert.equal(c.nodes.get('analytics-body').hidden, false);
  assert.equal(c.nodes.get('analytics-practice-actions').hidden, false); assert.equal(main.verdictDashboard.filters.subject, 'Existing filter');
  c.history.state = { dueDiligenceAnalyticsTab: 'forecast' }; c.emit('popstate'); await flush();
  assert.equal(main.mainAnalyticsTabs.selected, 'forecast'); assert.match(c.host.textContent, /83\.4%/);
  assert.match(html, /id="analytics-forecast-body" role="tabpanel" aria-labelledby="analytics-tab-forecast"/);
  assert.match(html, /#analytics-practice-actions\[hidden\]\{display:none/);
});

test('normal Analytics discards an old account load and clears old records, filters and selection immediately', async () => {
  const c = fixture(); const main = installMain(c); const stale = deferred();
  main.verdictDashboard.active = [{ id: 'old-owner' }]; main.verdictDashboard.selected.add('old-owner');
  main.verdictDashboard.filters.subject = 'Old subject';
  c.context.verdictRequest = () => stale.promise; const loading = main.loadVerdictDashboard();
  c.context.verdictRequest = async () => ({ items: [{ id: 'new-owner' }] });
  c.session.user.id = OTHER; c.emit('duediligence:session');
  assert.equal(main.verdictDashboard.active.length, 0); assert.equal(main.verdictDashboard.selected.size, 0);
  assert.equal(main.verdictDashboard.filters.subject, '');
  stale.resolve({ items: [{ id: 'old-owner' }] }); await loading; await flush();
  assert.deepEqual(Array.from(main.verdictDashboard.active, (row) => row.id), ['new-owner']);
});

test('delayed lazy bundle load cannot mount on another account or after leaving the Forecast tab', async () => {
  const c = fixture(); const main = installMain(c); const delayed = deferred();
  c.window.DueDiligenceFeatureLoader.loadForFeature = () => delayed.promise;
  const opening = main.selectMainAnalyticsTab('forecast');
  await main.selectMainAnalyticsTab('practice'); delayed.resolve(true); await opening;
  assert.equal(main.mainAnalyticsTabs.forecast, null); assert.equal(c.calls.length, 0);
});

test('Forecast and loader cache identities advance together; other analytics remain routed unchanged', () => {
  assert.match(loader, /bar-forecast\.js\?[^']*analytics=astra-main-forecast-20260907-r1/);
  assert.match(html, /feature-loader\.js\?[^"\n]*analytics=astra-main-forecast-20260907-r1/);
  assert.match(loader, /bar-forecast\.js\?[^']*scope=astra-forecast-analytics-export-20260907-r1/);
  assert.match(html, /feature-loader\.js\?[^"\n]*scope=astra-forecast-analytics-export-20260907-r1/);
  assert.match(html, /analytics: 'verdict'/);
  assert.match(html, /function openAnalytics\(\)[\s\S]*selectMainAnalyticsTab\(history\.state\?\.dueDiligenceAnalyticsTab/);
});

const SCOPE_ID = '33333333-3333-4333-8333-333333333333';
function scopePayload(overrides = {}) {
  const items = [attempt(OTHER)];
  return { scope: { id: SCOPE_ID, ownerId: OWNER, schemaVersion: 'forecast-analytics-scope-v1', createdAt: '2026-09-07T03:00:00Z',
    filter: { subject: null, from: null, to: null, completeOnly: true, timeZone: 'Asia/Manila' },
    manifest: items.map((row) => ({ ...row, attemptId: row.id })), analytics: summary({ completedAttempts: 1, averagePercentage: 80,
      bySubject: [{ subject: SUBJECT, completedAttempts: 1, averagePercentage: 80 }] }),
    ...overrides }, email: { status: 'not_requested', alreadyRequested: false } };
}
test('an unsupported AbortController runtime fails closed without transport, auth loops or protected output', async () => {
  const c = fixture(); c.context.AbortController = undefined;
  await c.mount().refresh();
  assert.equal(c.calls.length, 0); assert.match(c.host.textContent, /could not be loaded/);
  assert.doesNotMatch(c.host.textContent, /83\.4%/); assert.equal(c.timers.size, 0);
});
test('saved unit/topic sample sizes and unknown buckets are shown without estimating time or adding diagnostics', async () => {
  const c = fixture(); c.transport(() => payload({ analytics: summary({ byUnit: [{ subject: SUBJECT, unit: 'Saved unit', averageScore: 4, questionSamples: 18, completedAttempts: 2 }],
    byTopic: [{ subject: SUBJECT, topic: 'Saved topic', averageScore: 3.8, questionSamples: 6, completedAttempts: 2 }],
    classificationCoverage: { unitUnknownQuestions: 2, topicUnknownQuestions: 4 } }) }));
  await c.mount().refresh(); assert.equal(c.calls[0].body.includeClassifications, true);
  assert.match(c.host.textContent, /18 graded answers across 2 complete attempts/); assert.match(c.host.textContent, /2 answers have unknown unit classification; 4 have unknown topic classification/);
  assert.match(c.host.textContent, /Active writing time was not recorded/); assert.doesNotMatch(c.host.textContent, /Topic classifications.*not recorded/);
});
test('period email is explicit, captures the whole server scope rather than a page and pins the visible metrics to that exact scope', async () => {
  const c = fixture(); const saved = scopePayload();
  c.transport((body) => body.operation === 'history' ? payload()
    : body.operation === 'analytics_snapshot' ? saved : { email: { status: 'provider_accepted', alreadyRequested: true } });
  const api = c.mount(); await api.refresh(); assert.equal(c.calls.length, 1);
  await button(c.host, 'Email period report').click();
  assert.deepEqual(c.calls.map((row) => row.body.operation), ['history', 'analytics_snapshot', 'analytics_email']);
  const capture = c.calls[1].body; assert.match(capture.requestId, /^[a-f0-9-]{36}$/u);
  assert.equal(capture.before, undefined); assert.equal(capture.limit, undefined); assert.equal(capture.recipient, undefined);
  assert.equal(c.calls[2].body.scopeId, SCOPE_ID); assert.match(c.host.textContent, /Saved snapshot:/);
  assert.match(c.host.textContent, /80%/); assert.doesNotMatch(c.host.textContent, /83\.4%/);
  assert.equal(button(c.host, 'Email period report').disabled, true); assert.match(c.location.href, /forecastAnalytics=/u);
  assert.equal(c.storage.size, 0); assert.equal(c.state.acceptedAttempt, null);
  await button(c.host, 'Refresh').click(); assert.equal(c.calls.at(-1).body.operation, 'history'); assert.doesNotMatch(c.location.href, /forecastAnalytics=/u);
});
test('lost scope-creation acknowledgement keeps the same request key and does not send email prematurely', async () => {
  const c = fixture(); let captureCount = 0; const captures = [];
  c.transport((body) => {
    if (body.operation === 'history') return payload();
    if (body.operation === 'analytics_snapshot') { captures.push(body.requestId); if (++captureCount === 1) throw new Error('synthetic lost ack'); return scopePayload(); }
    return { email: { status: 'processing', alreadyRequested: true } };
  });
  await c.mount().refresh(); await button(c.host, 'Email period report').click();
  assert.equal(c.calls.some((row) => row.body.operation === 'analytics_email'), false);
  await button(c.host, 'Email period report').click(); assert.equal(captures.length, 2); assert.equal(captures[0], captures[1]);
  assert.equal(c.calls.filter((row) => row.body.operation === 'analytics_email').length, 1);
});
test('a saved scope link loads the exact owner-bound snapshot and never recaptures or emails automatically', async () => {
  const c = fixture(); c.location.href = `https://example.test/?forecastAnalytics=${SCOPE_ID}#verdict`;
  c.transport(() => scopePayload()); const api = c.mount(); await api.refresh();
  assert.equal(c.calls[0].body.operation, 'analytics_report'); assert.equal(c.calls[0].body.scopeId, SCOPE_ID);
  assert.match(c.host.textContent, /Saved snapshot:/); await api.setActive(false); await api.setActive(true);
  assert.equal(c.calls.length, 2); assert.equal(c.calls[1].body.operation, 'analytics_report');
  c.transport(() => scopePayload({ ownerId: OWNER })); c.session.user.id = OTHER; c.emit('duediligence:session'); await flush();
  assert.doesNotMatch(c.host.textContent, /80%/); assert.match(c.host.textContent, /could not be opened for your account/);
  for (const query of [`forecastAnalytics=${SCOPE_ID}&forecastAnalytics=${SCOPE_ID}`, 'forecastAnalytics=invalid']) {
    const invalid = fixture(); invalid.location.href = `https://example.test/?${query}#verdict`; await invalid.mount().refresh();
    assert.equal(invalid.calls.length, 0); assert.match(invalid.host.textContent, /could not be opened/);
  }
});
test('a saved scope deep link selects the main Forecast tab without a decorative redirect', async () => {
  const c = fixture(); c.location.href = `https://example.test/?forecastAnalytics=${SCOPE_ID}#verdict`; c.transport(() => scopePayload());
  const main = installMain(c); c.emit('popstate'); await flush();
  assert.equal(main.mainAnalyticsTabs.selected, 'forecast'); assert.equal(c.calls[0].body.operation, 'analytics_report');
});
test('back navigation into a different saved scope reuses the pane but not its previous scope', async () => {
  const c = fixture(); c.location.href = `https://example.test/?forecastAnalytics=${SCOPE_ID}#verdict`;
  c.transport((body) => scopePayload({ id: body.scopeId })); const api = c.mount(); await api.refresh();
  await api.setActive(false); c.location.href = `https://example.test/?forecastAnalytics=${OTHER}#verdict`; await api.setActive(true);
  assert.equal(c.calls.at(-1).body.operation, 'analytics_report'); assert.equal(c.calls.at(-1).body.scopeId, OTHER);
  c.location.href = `https://example.test/?forecastAnalytics=${SCOPE_ID}#verdict`; await api.setActive(true);
  assert.equal(c.calls.at(-1).body.scopeId, SCOPE_ID); assert.equal(c.calls.some((row) => row.body.operation === 'analytics_snapshot'), false);
});
test('owner/filter changes discard an in-flight scope before any email; no stale snapshot becomes visible', async () => {
  for (const type of ['owner', 'filter']) {
    const c = fixture(); const pending = deferred();
    c.transport((body) => body.operation === 'history' ? payload() : pending.promise);
    await c.mount().refresh(); const saving = button(c.host, 'Email period report').click(); await flush();
    if (type === 'owner') { c.session.user.id = OTHER; c.emit('duediligence:session'); }
    else await change(c.host.all('select')[0], SUBJECT);
    pending.resolve(scopePayload()); await saving; await flush();
    assert.equal(c.calls.some((row) => row.body.operation === 'analytics_email'), false); assert.doesNotMatch(c.host.textContent, /Saved snapshot:/);
  }
});
test('period PDF authenticates once for the frozen scope, guards binary response and downloads all reports without draft mutation', async () => {
  const c = fixture(); c.window.DueDiligencePhase2Config = { workerUrl: 'https://api.example.test' }; const fetches = [];
  c.window.fetch = async (url, options) => { fetches.push({ url, options }); return new Response('%PDF-test-complete', { headers: { 'Content-Type': 'application/pdf' } }); };
  c.transport((body) => body.operation === 'history' ? payload() : scopePayload());
  c.state.answers.set('private-draft', 'Keep me'); await c.mount().refresh(); await button(c.host, 'Download period PDF').click();
  assert.equal(fetches.length, 1); assert.deepEqual(JSON.parse(fetches[0].options.body), { operation: 'analytics_pdf', scopeId: SCOPE_ID });
  assert.equal(fetches[0].options.headers.Authorization, 'Bearer synthetic'); assert.equal(c.objectUrls.length, 1);
  assert.equal(c.document.body.all('a')[0].download, `duediligence-forecast-analytics-${SCOPE_ID}-v1.pdf`);
  assert.match(c.host.textContent, /Complete saved report downloaded/); assert.equal(c.state.answers.get('private-draft'), 'Keep me'); assert.equal(c.storage.size, 0);
});
test('period PDF fetch ignoring cancellation times out and cannot create a late download', async () => {
  const c = fixture(); c.window.DueDiligencePhase2Config = { workerUrl: 'https://api.example.test' }; const delayed = deferred();
  c.window.fetch = () => delayed.promise; c.transport((body) => body.operation === 'history' ? payload() : scopePayload());
  await c.mount().refresh(); const downloading = button(c.host, 'Download period PDF').click(); await flush();
  const timer = [...c.timers.values()].find((row) => row.delay === 90000); assert.ok(timer); timer.fn(); await downloading;
  assert.match(c.host.textContent, /Choose a narrower period/); delayed.resolve(new Response('%PDF-late', { headers: { 'Content-Type': 'application/pdf' } })); await flush();
  assert.equal(c.objectUrls.length, 0); assert.equal(c.timers.size, 0);
});
test('only explicit scope email has the longer finite deadline; timeout retains its exact scope without auto resend', async () => {
  const c = fixture(); c.transport((body) => body.operation === 'history' ? payload() : body.operation === 'analytics_snapshot' ? scopePayload() : new Promise(() => {}));
  await c.mount().refresh(); const emailing = button(c.host, 'Email period report').click(); await flush();
  const timer = [...c.timers.values()].find((row) => row.delay === 90000); assert.ok(timer); timer.fn(); await emailing;
  assert.match(c.host.textContent, /Check your inbox/); assert.match(c.location.href, new RegExp(SCOPE_ID, 'u'));
  assert.equal(c.calls.filter((row) => row.body.operation === 'analytics_email').length, 1); assert.equal(c.timers.size, 0);
});

test('Google and session return preserve only one exact Forecast scope/attempt UUID on its known local route', async () => {
  const source = await readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
  const extract = (name) => { const match = new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'mu').exec(source); assert.ok(match); return match[0]; };
  for (const [search, hash, expected] of [
    [`?forecastAnalytics=${SCOPE_ID}&redirect=https://evil.test&token=private`, '#verdict', `/?forecastAnalytics=${SCOPE_ID}#verdict`],
    [`?forecastAttempt=${SCOPE_ID}&redirect=https://evil.test`, '#bar-forecast-2026', `/?forecastAttempt=${SCOPE_ID}#bar-forecast-2026`],
    [`?forecastAnalytics=${SCOPE_ID}&forecastAnalytics=${SCOPE_ID}`, '#verdict', '/#verdict'],
    [`?forecastAnalytics=${SCOPE_ID}&forecastAttempt=${OTHER}`, '#verdict', '/#verdict'],
    [`?forecastAnalytics=${SCOPE_ID}&forecastAttempt=${OTHER}`, '#bar-forecast-2026', '/#bar-forecast-2026'],
    ['?forecastAnalytics=https://evil.test', '#verdict', '/#verdict'],
    [`?forecastAnalytics=${SCOPE_ID}`, '#quorum', '/#quorum'],
    [`?forecastAttempt=${SCOPE_ID}`, '#verdict', '/#verdict'],
  ]) {
    let stored = '', destination = '';
    const location = { origin: 'https://duediligence.ph', pathname: '/', search };
    const context = vm.createContext({ URL, URLSearchParams, location, state: { authReturnPending: true }, authReturnStorageKey: 'auth',
      safeSessionWrite: (_key, value) => { stored = value; }, safeSessionRead: () => stored, safeSessionRemove: () => { stored = ''; },
      history: { state: {}, replaceState: (_state, _title, value) => { destination = value; } }, global: { dispatchEvent() {} }, PopStateEvent: class {} });
    vm.runInContext(['safeReturnHash', 'forecastAuthReturnSearch', 'rememberAuthReturn', 'restoreAuthDestination'].map(extract).join('\n'), context);
    context.hash = hash; vm.runInContext('rememberAuthReturn(hash)', context); location.search = '';
    vm.runInContext('restoreAuthDestination()', context); assert.equal(destination, expected); assert.equal(stored, '');
    for (const unsafe of [`https://evil.test/?forecastAnalytics=${SCOPE_ID}#verdict`, `https://duediligence.ph/admin/?forecastAnalytics=${SCOPE_ID}#verdict`]) {
      context.unsafe = unsafe; assert.equal(vm.runInContext('forecastAuthReturnSearch(unsafe)', context), '');
    }
  }
  assert.match(html, /phase2-experience\.js\?[^"\n]*scope=astra-forecast-analytics-export-20260907-r1/);
});
