import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  TARGET, probeSource, sanitizeForecastBrowserDiagnostics, forecastBrowserDiagnosticsSource,
  openForecastFromReadyLauncher, captureForecastFailureDiagnostics,
} from './verify-astra-forecast-staging.mjs';

const secret = 'Bearer private-token private.person@example.invalid /proof/private-object.png 11111111-1111-4111-8111-111111111111';
const endpoint = `${TARGET.site}/admin/dd2026/bar-forecast`;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(predicate(), true, 'Bounded local diagnostic observation must settle');
}
function makeProbe(fetch, extras = {}) {
  const window = { fetch, ...extras };
  vm.runInNewContext(probeSource(), { window, TypeError });
  return window;
}

test('diagnostics project only enums, booleans, bounded counts and HTTP status', () => {
  const safe = sanitizeForecastBrowserDiagnostics({
    probePresent: true, sessionPresent: true, authReady: 'settled', route: 'forecast',
    rootVisible: true, pickerPresent: true, editorPresent: false, errorPresent: true, launcherReady: false,
    textContent: secret, token: secret, userId: secret,
    operations: { status: { requested: 1, responded: 1, httpStatus: 403, errorCode: 'BAR_FORECAST_ACCESS_REQUIRED',
      transportError: null, body: secret, url: secret }, [secret]: { requested: 2 } },
  });
  assert.equal(safe.operations.status.errorCode, 'BAR_FORECAST_ACCESS_REQUIRED');
  assert.equal(safe.operations.status.httpStatus, 403);
  assert.equal(safe.authReady, 'settled');
  assert.equal(Object.keys(safe.operations).length, 9);
  assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
  assert.deepEqual(sanitizeForecastBrowserDiagnostics(JSON.parse(JSON.stringify(safe))), safe, 'Revalidate the browser result at the Node boundary');
});

test('malformed marker values and unknown error strings cannot escape the projection', () => {
  for (const input of [null, [], secret, {}, {
    authReady: secret, route: secret, sessionPresent: secret, rootVisible: 1,
    operations: { start: { requested: secret, responded: -1, httpStatus: 900, errorCode: secret, transportError: secret } },
  }, { operations: { start: { requested: Infinity, responded: 0.5, httpStatus: '200', errorCode: { value: secret } } } }]) {
    const safe = sanitizeForecastBrowserDiagnostics(input);
    assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
    assert.ok(['unobserved', 'pending', 'settled', 'rejected'].includes(safe.authReady));
    assert.ok(['forecast', 'home', 'pricing', 'other'].includes(safe.route));
    assert.equal(safe.operations.start.requested, null);
    assert.equal(safe.operations.start.responded, null);
    assert.equal(safe.operations.start.httpStatus, null);
  }
});

test('browser diagnostic collection reads no DOM text, URLs, session values or IDs into its result', () => {
  const node = { hidden: false, getClientRects: () => [{}], closest: () => null,
    get textContent() { throw new Error('DOM text must never be read'); } };
  const document = { getElementById: () => node, querySelector: selector => selector.includes('current-answer') ? null : node };
  const window = { __astraForecastProbe: { authReady: 'pending', operations: { start: { requested: 1, responded: 0 } } },
    DueDiligencePhase2: { getSession: () => ({ access_token: secret, user: { id: secret, email: secret } }) } };
  const safe = plain(vm.runInNewContext(forecastBrowserDiagnosticsSource(), { window, document, location: { hash: '#bar-forecast-2026' } }));
  assert.equal(safe.sessionPresent, true); assert.equal(safe.pickerPresent, true); assert.equal(safe.editorPresent, false);
  assert.equal(safe.operations.start.requested, 1); assert.equal(safe.operations.start.responded, 0);
  assert.equal(safe.authReady, 'pending'); assert.equal(safe.route, 'forecast');
  assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
});

test('real status/start observations preserve transport and expose only allowlisted error codes', async () => {
  let calls = 0;
  const responses = [new Response(JSON.stringify({ authorized: true, token: secret }), { status: 200 }),
    new Response(JSON.stringify({ error: { code: 'BAR_FORECAST_CONTENT_INCOMPLETE', message: secret }, answers: [secret] }), { status: 409 })];
  const window = makeProbe(async () => responses[calls++]);
  for (const operation of ['status', 'start']) {
    const result = await window.fetch(endpoint, { body: JSON.stringify({ operation, ignoredPrivateAnswer: secret }) });
    assert.equal(result, responses[calls - 1], 'Observer must return the original response');
  }
  await until(() => window.__astraForecastProbe.operations.start.errorCode === 'BAR_FORECAST_CONTENT_INCOMPLETE');
  const safe = sanitizeForecastBrowserDiagnostics({ operations: window.__astraForecastProbe.operations });
  assert.deepEqual(safe.operations.status, { requested: 1, responded: 1, httpStatus: 200, errorCode: null, transportError: null });
  assert.deepEqual(safe.operations.start, { requested: 1, responded: 1, httpStatus: 409, errorCode: 'BAR_FORECAST_CONTENT_INCOMPLETE', transportError: null });
  assert.equal(calls, 2); assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
});

test('unknown operations/error codes and malformed error JSON remain private', async () => {
  const window = makeProbe(async (_url, options) => {
    const operation = JSON.parse(options.body).operation;
    return operation === 'start' ? new Response('not-json ' + secret, { status: 503 })
      : new Response(JSON.stringify({ error: { code: secret, message: secret } }), { status: 403 });
  });
  for (const operation of [secret, '__proto__', 'status', 'start']) await window.fetch(endpoint, { body: JSON.stringify({ operation }) });
  await until(() => window.__astraForecastProbe.operations.start.errorCode === 'INVALID_JSON'
    && window.__astraForecastProbe.operations.status.errorCode === 'UNRECOGNIZED');
  assert.deepEqual(Object.keys(window.__astraForecastProbe.counts).sort(), ['start', 'status']);
  assert.doesNotMatch(JSON.stringify(sanitizeForecastBrowserDiagnostics({ operations: window.__astraForecastProbe.operations })), /private-token|private\.person|private-object|11111111/);
});

test('network and abort errors keep exact thrown error but only fixed transport categories', async () => {
  for (const name of ['AbortError', 'TypeError', secret]) {
    const original = new Error(secret); original.name = name;
    const window = makeProbe(async () => { throw original; });
    await assert.rejects(window.fetch(endpoint, { body: '{"operation":"start"}' }), error => error === original);
    const safe = sanitizeForecastBrowserDiagnostics({ operations: window.__astraForecastProbe.operations });
    assert.equal(safe.operations.start.requested, 1); assert.equal(safe.operations.start.responded, 0);
    assert.equal(safe.operations.start.transportError, name === 'AbortError' ? 'ABORTED' : 'NETWORK_ERROR');
    assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
  }
});

test('auth readiness observes the actual promise without manufacturing a session', async () => {
  const pending = deferred(); let observations = 0;
  const window = makeProbe(async () => new Response('{}'), { DueDiligencePhase2: {
    whenAuthReady: () => { observations++; return pending.promise; },
  } });
  assert.equal(window.__astraForecastProbe.authReady, 'pending');
  await Promise.resolve(); assert.equal(observations, 1);
  pending.resolve(); await until(() => window.__astraForecastProbe.authReady === 'settled');
  assert.equal(window.DueDiligencePhase2.getSession, undefined);
});

test('Home launcher helper waits for readiness, clicks exactly once and awaits picker plus route', async () => {
  const ready = deferred(); const clicked = deferred(); const picker = deferred(); const events = [];
  const task = openForecastFromReadyLauncher({
    setStep: step => events.push(step), waitReady: () => ready.promise,
    clickLauncher: () => { events.push('click'); return clicked.promise; },
    waitPicker: () => { events.push('wait-picker'); return picker.promise; },
    readRoute: async () => { events.push('route'); return true; },
  });
  assert.deepEqual(events, ['home-ready']); ready.resolve(); await Promise.resolve();
  assert.deepEqual(events, ['home-ready', 'launcher-click', 'click']);
  clicked.resolve(); await Promise.resolve();
  assert.deepEqual(events, ['home-ready', 'launcher-click', 'click', 'picker', 'wait-picker']);
  picker.resolve(); await task;
  assert.equal(events.filter(value => value === 'click').length, 1); assert.equal(events.at(-1), 'route');
});

test('Home readiness failure never clicks; wrong route fails without navigation retry', async () => {
  let clicks = 0;
  const options = { waitReady: async () => {}, clickLauncher: async () => { clicks++; }, waitPicker: async () => {}, readRoute: async () => false };
  await assert.rejects(openForecastFromReadyLauncher({ ...options, waitReady: async () => { throw new Error('bounded wait expired'); } }), /bounded wait expired/);
  assert.equal(clicks, 0);
  await assert.rejects(openForecastFromReadyLauncher(options), /actual Forecast route/); assert.equal(clicks, 1);
});

test('failure diagnostic helper awaits sanitized persistence before returning for cleanup', async () => {
  const saved = deferred(); const events = [];
  const task = captureForecastFailureDiagnostics({
    readDiagnostics: async () => ({ sessionPresent: true, token: secret, operations: { start: { errorCode: secret } } }),
    saveDiagnostics: async safe => { events.push('saving'); assert.doesNotMatch(JSON.stringify(safe), /private-token|11111111/); await saved.promise; events.push('saved'); },
  }).then(() => events.push('cleanup-ready'));
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(events, ['saving']);
  saved.resolve(); await task; assert.deepEqual(events, ['saving', 'saved', 'cleanup-ready']);
});

test('runner retains three full journeys, separates entry stages and fixes all after-Close navigations', async () => {
  const source = await readFile(new URL('./verify-astra-forecast-staging.mjs', import.meta.url), 'utf8');
  assert.match(source, /stage = `journey-\$\{number\}-picker`[\s\S]*?stage = `journey-\$\{number\}-subject-start`[\s\S]*?stage = `journey-\$\{number\}-editor`/);
  assert.doesNotMatch(source, /await closeForecast\(\); await browser\('open'/);
  assert.equal((source.match(/await closeAndReopenForecast\(/g) || []).length, 3);
  assert.match(source, /for \(let number = 1; number <= 3; number\+\+\)/);
  assert.match(source, /await waitForRealReport\(journey.id\)/);
  assert.match(source, /assertControlledCoverage/);
  assert.match(source, /await browser\('reload'\); await browserWait/);
  assert.match(source, /const browserWait = async \(predicate, timeout = 35000\)/);
  const capture = source.indexOf('summary.browserState = await captureForecastFailureDiagnostics');
  const close = source.indexOf("try { await browser('close'); summary.browserSessionClosed", capture);
  assert.ok(capture > 0 && close > capture, 'Capture and persistence precede browser cleanup');
});
