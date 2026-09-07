import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  TARGET, probeSource, sanitizeForecastBrowserDiagnostics, forecastBrowserDiagnosticsSource,
  openForecastFromReadyLauncher, captureForecastFailureDiagnostics, forecastBootstrapState,
  waitForForecastBootstrap, canCaptureForecastFixtureScreenshot,
  seedColdFixtureStorage, coldFixtureInitSource,
  forecastReadCooldown, retryForecastRead, forecastCleanupScope,
} from './verify-astra-forecast-staging.mjs';

const secret = 'Bearer private-token private.person@example.invalid /proof/private-object.png 11111111-1111-4111-8111-111111111111';
const endpoint = `${TARGET.site}/admin/dd2026/bar-forecast`;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('supported API cleanup never claims protected Pulse or Auth-session absence', async () => {
  assert.deepEqual(forecastCleanupScope(), {
    cleanupScope: 'supported-api-owned-fixture-rows',
    pulseFixtureRows: 'not_independently_checked',
    authSessions: 'not_directly_exposed',
    independentDatabaseReadbackRequired: true,
    zeroResidueVerified: false,
  });
  const source = await readFile(new URL('./verify-astra-forecast-staging.mjs', import.meta.url), 'utf8');
  assert.match(source, /summary\.cleanupVerification = forecastCleanupScope\(\)/u);
  assert.doesNotMatch(JSON.stringify(forecastCleanupScope()), /@|Bearer|https?:|[a-f0-9]{8}-[a-f0-9]{4}-/iu);
});
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(predicate(), true, 'Bounded local diagnostic observation must settle');
}
function makeProbe(fetch, extras = {}) {
  const window = { fetch, ...extras };
  vm.runInNewContext(probeSource(), { window, TypeError, URL });
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

const expectedOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const differentOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const storageKey = `sb-${TARGET.ref}-auth-token`;
const storedFixture = (overrides = {}) => ({ access_token: secret, refresh_token: 'private-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: expectedOwner, email: secret }, ...overrides });
const goodBootstrap = (overrides = {}) => ({ probePresent: true, authReady: 'settled', expectedOriginMatch: true,
  sdkCreateClientPresent: true, sessionPresent: true, runtimeOwnerMatchesExpected: true,
  route: 'forecast', rootVisible: true, ...overrides });

test('bootstrap storage observation returns only valid shape, origin, expiry and owner booleans', () => {
  const stored = storedFixture();
  const window = { location: { origin: TARGET.site }, supabase: { createClient() {} },
    localStorage: { getItem: key => { assert.equal(key, storageKey); return JSON.stringify(stored); } },
    DueDiligencePhase2: { getSession: () => stored } };
  const safe = forecastBootstrapState(window, expectedOwner, TARGET.site, storageKey);
  assert.deepEqual(safe, { sessionPresent: true, sdkCreateClientPresent: true, expectedOriginMatch: true,
    runtimeOwnerMatchesExpected: true, authStorageReadable: true, authStoragePresent: true,
    authStorageValidSessionShape: true, authStorageOwnerMatchesExpected: true, authStorageNotExpired: true });
  assert.ok(Object.values(safe).every(value => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(safe), /private|aaaaaaaa|supabase|https:|sb-/);
  stored.user.id = differentOwner;
  const wrong = forecastBootstrapState(window, expectedOwner, TARGET.site, storageKey);
  assert.equal(wrong.authStorageOwnerMatchesExpected, false);
  assert.equal(wrong.runtimeOwnerMatchesExpected, false);
});

test('missing, malformed, inaccessible or expired stored sessions stay distinct without exposing values', () => {
  for (const [value, present, valid, unexpired] of [[null, false, false, null], [secret, true, false, null],
    [JSON.stringify(storedFixture({ refresh_token: null })), true, false, null],
    [JSON.stringify(storedFixture({ expires_at: 1 })), true, true, false]]) {
    const safe = forecastBootstrapState({ localStorage: { getItem: () => value } }, expectedOwner, TARGET.site, storageKey);
    assert.equal(safe.authStoragePresent, present); assert.equal(safe.authStorageValidSessionShape, valid);
    assert.equal(safe.authStorageNotExpired, unexpired); assert.equal(safe.sdkCreateClientPresent, false);
    assert.doesNotMatch(JSON.stringify(safe), /private|aaaaaaaa/);
  }
  const safe = forecastBootstrapState({ get localStorage() { throw new Error(secret); },
    DueDiligencePhase2: { getSession() { throw new Error(secret); } } }, expectedOwner, TARGET.site, storageKey);
  assert.equal(safe.authStorageReadable, false); assert.equal(safe.sessionPresent, false);
  assert.doesNotMatch(JSON.stringify(safe), /private|aaaaaaaa/);
});

test('actual browser-source diagnostic compares the expected fixture without returning its identity', () => {
  const stored = storedFixture();
  const window = { location: { origin: TARGET.site }, supabase: { createClient() {} },
    localStorage: { getItem: () => JSON.stringify(stored) }, DueDiligencePhase2: { getSession: () => stored },
    __astraForecastProbe: { authReady: 'settled', initialBootstrap: { authStoragePresent: true,
      authStorageValidSessionShape: true, authStorageOwnerMatchesExpected: true, authStorageNotExpired: true } } };
  const document = { getElementById: () => null, querySelector: () => null };
  const result = plain(vm.runInNewContext(forecastBrowserDiagnosticsSource({ expectedOwnerId: expectedOwner }),
    { window, document, location: { hash: '#bar-forecast-2026' } }));
  assert.equal(result.runtimeOwnerMatchesExpected, true); assert.equal(result.authStorageOwnerMatchesExpected, true);
  assert.equal(result.initialAuthStoragePresent, true); assert.equal(result.authStorageNotExpired, true);
  assert.doesNotMatch(JSON.stringify(result), /private|aaaaaaaa|https:|sb-/);
  assert.throws(() => forecastBrowserDiagnosticsSource({ expectedOwnerId: secret }));
  assert.throws(() => probeSource({ expectedOwnerId: secret }));
});

test('init probe captures injected storage before application startup without storing its raw values', () => {
  let stored = JSON.stringify(storedFixture());
  const window = { location: { origin: TARGET.site }, localStorage: { getItem: () => stored },
    fetch: async () => new Response('{}') };
  vm.runInNewContext(probeSource({ expectedOwnerId: expectedOwner }), { window, TypeError, URL });
  const initial = plain(window.__astraForecastProbe.initialBootstrap);
  assert.equal(initial.authStoragePresent, true); assert.equal(initial.authStorageOwnerMatchesExpected, true);
  stored = null;
  assert.equal(window.__astraForecastProbe.initialBootstrap.authStoragePresent, true, 'Keep initial evidence after the app clears storage.');
  assert.equal(forecastBootstrapState(window, expectedOwner, TARGET.site, storageKey).authStoragePresent, false);
  assert.doesNotMatch(JSON.stringify(initial), /private|aaaaaaaa|https:|sb-/);
});

test('only exact pinned Auth endpoint and HTTP-method operations are observed', async () => {
  const calls = [];
  const window = makeProbe(async (...args) => { calls.push(args); return new Response('{}'); });
  for (const [url, method] of [
    [`${TARGET.supabase}/auth/v1/token?grant_type=refresh_token`, 'POST'],
    [`${TARGET.supabase}/auth/v1/token?grant_type=password`, 'POST'],
    [`${TARGET.supabase}/auth/v1/user`, 'GET'], [`${TARGET.supabase}/auth/v1/logout?scope=local`, 'POST'],
    ['https://unrelated.invalid/auth/v1/user', 'GET'], [`${TARGET.supabase}/auth/v1/user`, 'PUT'],
    [`${TARGET.supabase}/auth/v1/token?grant_type=other-private-value`, 'POST'],
  ]) await window.fetch(url, { method, body: JSON.stringify({ refresh_token: secret }) });
  assert.equal(calls.length, 7, 'Observation does not create or suppress any request.');
  const safe = sanitizeForecastBrowserDiagnostics({ authOperations: window.__astraForecastProbe.authOperations });
  assert.equal(Object.keys(safe.authOperations).length, 4);
  assert.ok(Object.values(safe.authOperations).every(row => row.requested === 1 && row.responded === 1 && row.httpStatus === 200));
  assert.doesNotMatch(JSON.stringify(safe), /private|unrelated|refresh_token"/);
});

test('Auth error metadata preserves original response and exposes only fixed code or transport categories', async () => {
  for (const body of [{ error_code: 'refresh_token_already_used', msg: secret }, { code: 'bad_jwt', message: secret },
    { code: secret }, null]) {
    const response = new Response(body ? JSON.stringify(body) : secret, { status: 401 });
    const window = makeProbe(async () => response);
    assert.equal(await window.fetch(`${TARGET.supabase}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' }), response);
    await until(() => window.__astraForecastProbe.authOperations.token_refresh.errorCode !== null);
    const safe = sanitizeForecastBrowserDiagnostics({ authOperations: window.__astraForecastProbe.authOperations });
    assert.equal(safe.authOperations.token_refresh.httpStatus, 401);
    assert.equal(safe.authOperations.token_refresh.errorCode,
      body?.error_code || (body?.code === 'bad_jwt' ? 'bad_jwt' : body ? 'UNRECOGNIZED' : 'INVALID_JSON'));
    assert.doesNotMatch(JSON.stringify(safe), /private-token|private\.person|private-object|11111111/);
  }
  const original = new Error(secret); original.name = 'AbortError';
  const window = makeProbe(async () => { throw original; });
  await assert.rejects(window.fetch(`${TARGET.supabase}/auth/v1/user`), error => error === original);
  assert.equal(window.__astraForecastProbe.authOperations.user.transportError, 'ABORTED');
});

test('new diagnostic fields reject private strings, malformed booleans and unknown Auth metadata', () => {
  const safe = sanitizeForecastBrowserDiagnostics({ sdkCreateClientPresent: secret, expectedOriginMatch: secret,
    runtimeOwnerMatchesExpected: secret, authStorageReadable: secret, authStoragePresent: secret,
    authStorageValidSessionShape: secret, authStorageOwnerMatchesExpected: secret, authStorageNotExpired: secret,
    initialAuthStoragePresent: secret, initialAuthStorageValidSessionShape: secret,
    initialAuthStorageOwnerMatchesExpected: secret, initialAuthStorageNotExpired: secret,
    authOperations: { user: { requested: secret, responded: 1.5, httpStatus: '401', errorCode: secret, transportError: secret },
      [secret]: { url: secret } } });
  assert.equal(safe.sdkCreateClientPresent, null); assert.equal(safe.expectedOriginMatch, null);
  assert.equal(safe.authOperations.user.errorCode, 'UNRECOGNIZED');
  assert.equal(safe.authOperations.user.requested, null); assert.equal(safe.authOperations.user.responded, null);
  assert.equal(safe.authOperations.user.httpStatus, null); assert.equal(safe.authOperations.user.transportError, null);
  assert.doesNotMatch(JSON.stringify(safe), /private|11111111/);
  assert.deepEqual(sanitizeForecastBrowserDiagnostics(safe), safe);
});

test('cold bootstrap awaits actual readiness and returns a sanitized success checkpoint', async () => {
  let clock = 0; let reads = 0;
  const safe = await waitForForecastBootstrap({ now: () => clock, sleep: async ms => { clock += ms; },
    readDiagnostics: async () => ({ ...goodBootstrap({ authReady: ++reads < 3 ? 'pending' : 'settled' }), rawToken: secret }) });
  assert.equal(reads, 3); assert.equal(clock, 500); assert.equal(safe.runtimeOwnerMatchesExpected, true);
  assert.doesNotMatch(JSON.stringify(safe), /private/);
});

test('cold bootstrap fails precisely before picker for SDK, signed-out, owner, origin or rejected auth', async () => {
  const cases = [
    [{ sdkCreateClientPresent: false, sessionPresent: false }, 'SDK_UNAVAILABLE'],
    [{ sessionPresent: false }, 'SIGNED_OUT'], [{ runtimeOwnerMatchesExpected: false }, 'OWNER_MISMATCH'],
    [{ expectedOriginMatch: false }, 'ORIGIN_MISMATCH'], [{ authReady: 'rejected' }, 'AUTH_REJECTED'],
  ];
  for (const [changes, suffix] of cases) {
    let waits = 0;
    await assert.rejects(waitForForecastBootstrap({ readDiagnostics: async () => goodBootstrap(changes),
      sleep: async () => { waits++; } }), error => error.code === `ASTRA_FORECAST_BOOTSTRAP_${suffix}` && !error.message.includes(secret));
    assert.equal(waits, 0, 'A known terminal failure does not retry or wait for the picker.');
  }
});

test('unresolved cold bootstrap has one finite timeout and cannot manufacture readiness', async () => {
  let clock = 0; let reads = 0;
  await assert.rejects(waitForForecastBootstrap({ timeoutMs: 1000, now: () => clock,
    sleep: async ms => { clock += ms; }, readDiagnostics: async () => { reads++; return goodBootstrap({ authReady: 'pending' }); } }),
  error => error.code === 'ASTRA_FORECAST_BOOTSTRAP_TIMEOUT');
  assert.equal(reads, 4); assert.equal(clock, 1000);
  await assert.rejects(waitForForecastBootstrap({ timeoutMs: 35001 }));
});

test('hard bootstrap timeout bounds a never-resolving read and prevents late continuation', async () => {
  const pending = deferred(); let reads = 0; let sleeps = 0;
  const started = Date.now();
  await assert.rejects(waitForForecastBootstrap({ timeoutMs: 20,
    readDiagnostics: () => { reads++; return pending.promise; }, sleep: async () => { sleeps++; } }),
  error => error.code === 'ASTRA_FORECAST_BOOTSTRAP_TIMEOUT');
  assert.ok(Date.now() - started < 1000, 'A stuck browser read must not override the hard timeout.');
  pending.resolve(goodBootstrap({ authReady: 'pending' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reads, 1); assert.equal(sleeps, 0, 'Late read cannot restart the stopped polling loop.');
});

test('hard bootstrap timeout also bounds a never-resolving delay and stops late retries', async () => {
  const pending = deferred(); let reads = 0;
  await assert.rejects(waitForForecastBootstrap({ timeoutMs: 20,
    readDiagnostics: async () => { reads++; return goodBootstrap({ authReady: 'pending' }); }, sleep: () => pending.promise }),
  error => error.code === 'ASTRA_FORECAST_BOOTSTRAP_TIMEOUT');
  pending.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reads, 1);
});

test('failure screenshots require the expected signed-in owner on the actual isolated Forecast surface', () => {
  assert.equal(canCaptureForecastFixtureScreenshot(goodBootstrap()), true);
  for (const field of ['expectedOriginMatch', 'runtimeOwnerMatchesExpected', 'sessionPresent', 'rootVisible']) {
    for (const value of [false, null, secret]) assert.equal(canCaptureForecastFixtureScreenshot(goodBootstrap({ [field]: value })), false);
  }
  for (const route of ['home', 'pricing', 'other', secret]) assert.equal(canCaptureForecastFixtureScreenshot(goodBootstrap({ route })), false);
});

test('actual runner checkpoints cold auth and gates private screenshot before cleanup without warm navigation', async () => {
  const source = await readFile(new URL('./verify-astra-forecast-staging.mjs', import.meta.url), 'utf8');
  const start = source.slice(source.indexOf('  async function startBrowser(account)'), source.indexOf('  async function openSaved('));
  assert.match(start, /writeFile\(initPath, coldFixtureInitSource\(account\), \{ mode: 0o600 \}\)/);
  assert.match(start, /await browser\('--init-script', initPath, 'open', `\$\{TARGET.site\}\/#bar-forecast-2026`\)/);
  assert.doesNotMatch(start, /--state|browser\('reload'|setSession|signIn/);
  assert.match(start, /stage = `browser-bootstrap-\$\{account.kind\}`[\s\S]*waitForForecastBootstrap[\s\S]*summary.bootstrapCheckpoints.push/);
  assert.equal((start.match(/await browser\([^;]*'open'/g) || []).length, 1, 'One cold navigation, no warm-up or retry.');
  assert.match(source, /canCaptureForecastFixtureScreenshot\(summary.browserState\)[\s\S]*await screen\('failure-owned-forecast'\)/);
  assert.match(source, /skipped-no-verified-forecast-fixture/);
});

function fixtureStorageWindow({ origin = TARGET.site, existing = null } = {}) {
  const local = new Map(existing === null ? [] : [[storageKey, existing]]);
  const tab = new Map();
  const storage = values => ({ getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
  const window = { location: { origin }, localStorage: storage(local), sessionStorage: storage(tab),
    fetch: async () => new Response('{}') };
  window.top = window;
  return { window, local, tab };
}
function signedFixtureAccount(overrides = {}) {
  const claims = { sub: expectedOwner, iss: `${TARGET.supabase}/auth/v1`, role: 'authenticated' };
  const session = storedFixture({ access_token: `inert.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.not-a-real-signature`, ...overrides });
  return { id: expectedOwner, session };
}
const seedConfig = session => ({ origin: TARGET.site, storageKey, markerKey: '__astra_fixture_auth_import_once',
  sessionValue: JSON.stringify(session), ownerId: expectedOwner });

test('cold fixture import precedes initial diagnostics and application auth with one actual user state', () => {
  const account = signedFixtureAccount();
  const { window, local } = fixtureStorageWindow();
  vm.runInNewContext(coldFixtureInitSource(account), { window, TypeError, URL });
  assert.equal(window.__astraFixtureStorageImport, 'seeded');
  assert.deepEqual(JSON.parse(local.get(storageKey)), account.session);
  const initial = window.__astraForecastProbe.initialBootstrap;
  assert.equal(initial.authStoragePresent, true);
  assert.equal(initial.authStorageOwnerMatchesExpected, true);
  assert.equal(initial.authStorageNotExpired, true);
  assert.equal(window.DueDiligencePhase2, undefined, 'No application auth API or response is replaced.');
  assert.doesNotMatch(JSON.stringify(initial), /private|aaaaaaaa|inert\./);
});

test('first-document auth reproduction separates a late state import from pre-document restoration', () => {
  const account = signedFixtureAccount();
  const old = fixtureStorageWindow();
  vm.runInNewContext(probeSource({ expectedOwnerId: expectedOwner }), { window: old.window, TypeError, URL });
  const oldRuntimeSignedIn = Boolean(old.window.localStorage.getItem(storageKey));
  old.window.localStorage.setItem(storageKey, JSON.stringify(account.session));
  assert.equal(oldRuntimeSignedIn, false);
  assert.equal(old.window.__astraForecastProbe.initialBootstrap.authStoragePresent, false);
  assert.equal(Boolean(old.window.localStorage.getItem(storageKey)), true);
  const fixed = fixtureStorageWindow();
  vm.runInNewContext(coldFixtureInitSource(account), { window: fixed.window, TypeError, URL });
  assert.equal(Boolean(fixed.window.localStorage.getItem(storageKey)), true);
  assert.equal(fixed.window.__astraForecastProbe.initialBootstrap.authStoragePresent, true);
});

test('reload does not reset refreshed credentials and logout/storage loss cannot be concealed by reseeding', () => {
  const account = signedFixtureAccount();
  const { window } = fixtureStorageWindow();
  const source = coldFixtureInitSource(account);
  vm.runInNewContext(source, { window, TypeError, URL });
  const refreshed = JSON.stringify({ ...account.session, access_token: 'actual-refreshed-fixture-token' });
  window.localStorage.setItem(storageKey, refreshed);
  vm.runInNewContext(source, { window, TypeError, URL });
  assert.equal(window.__astraFixtureStorageImport, 'already_seeded');
  assert.equal(window.localStorage.getItem(storageKey), refreshed);
  window.localStorage.removeItem(storageKey);
  vm.runInNewContext(source, { window, TypeError, URL });
  assert.equal(window.__astraFixtureStorageImport, 'already_seeded');
  assert.equal(window.localStorage.getItem(storageKey), null);
  assert.equal(window.__astraForecastProbe.initialBootstrap.authStoragePresent, false);
});

test('existing same-owner state is preserved, then never reimported after it is cleared', () => {
  const account = signedFixtureAccount();
  const existing = JSON.stringify({ ...account.session, access_token: 'existing-session-not-overwritten' });
  const { window } = fixtureStorageWindow({ existing });
  const config = seedConfig(account.session);
  assert.equal(seedColdFixtureStorage(window, config), 'existing_owner_preserved');
  assert.equal(window.localStorage.getItem(storageKey), existing);
  window.localStorage.removeItem(storageKey);
  assert.equal(seedColdFixtureStorage(window, config), 'already_seeded');
  assert.equal(window.localStorage.getItem(storageKey), null);
});

test('malformed or another owner storage is never overwritten or passed as a successful restore', () => {
  const account = signedFixtureAccount();
  for (const existing of [secret, '', JSON.stringify(storedFixture({ user: { id: differentOwner } })),
    JSON.stringify(storedFixture({ refresh_token: null }))]) {
    const { window, tab } = fixtureStorageWindow({ existing });
    assert.equal(seedColdFixtureStorage(window, seedConfig(account.session)), 'storage_conflict');
    assert.equal(window.localStorage.getItem(storageKey), existing);
    assert.equal(tab.size, 0);
  }
});

test('private fixture credentials cannot be seeded into another origin, subframe, or inaccessible storage', () => {
  const config = seedConfig(signedFixtureAccount().session);
  for (const origin of ['https://duediligence.ph', TARGET.supabase, 'http://127.0.0.1:4179', 'null']) {
    const { window, local, tab } = fixtureStorageWindow({ origin });
    assert.equal(seedColdFixtureStorage(window, config), 'origin_skipped');
    assert.equal(local.size + tab.size, 0);
  }
  const framed = fixtureStorageWindow(); framed.window.top = {};
  assert.equal(seedColdFixtureStorage(framed.window, config), 'frame_skipped');
  assert.equal(framed.local.size + framed.tab.size, 0);
  const blocked = fixtureStorageWindow();
  Object.defineProperty(blocked.window, 'sessionStorage', { get() { throw new Error(secret); } });
  assert.equal(seedColdFixtureStorage(blocked.window, config), 'storage_unavailable');
  assert.equal(blocked.local.size, 0);
});

test('generated cold fixture script rejects service tokens, wrong owners/issuers and expired sessions', () => {
  const account = signedFixtureAccount();
  for (const changes of [{ sub: differentOwner }, { iss: 'https://duediligence.ph/auth/v1' }, { role: 'service_role' }]) {
    const claims = { sub: expectedOwner, iss: `${TARGET.supabase}/auth/v1`, role: 'authenticated', ...changes };
    const invalid = signedFixtureAccount({ access_token: `inert.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.not-real` });
    assert.throws(() => coldFixtureInitSource(invalid));
  }
  for (const changes of [{ expires_at: 1 }, { refresh_token: '' }, { access_token: secret }, { user: { id: differentOwner } }]) {
    assert.throws(() => coldFixtureInitSource({ ...account, session: { ...account.session, ...changes } }));
  }
});

test('rate cooldown honors seconds or dates without guessing an early missing-header reset', () => {
  const response = (value) => ({ headers: new Headers(value === null ? {} : { 'Retry-After': value }) });
  assert.equal(forecastReadCooldown(response('90'), { error: { retryAfterSeconds: 120 } }), 120000);
  assert.equal(forecastReadCooldown(response('Thu, 01 Jan 1970 00:02:00 GMT'), {}, 60000), 60000);
  assert.equal(forecastReadCooldown(response(null), {}), 600000);
  assert.equal(forecastReadCooldown(response('not a date'), { error: { retryAfterSeconds: 'private' } }), 600000);
});

test('rate-limited saved reads wait then return the real same-attempt response, never retrying a mutation', async () => {
  let now = 0, calls = 0; const waits = []; const observations = [];
  const saved = { response: { status: 200 }, body: { attempt: { id: expectedOwner, status: 'processing' } } };
  const result = await retryForecastRead({ operation: 'attempt', deadline: 200000, now: () => now,
    request: async () => ++calls === 1 ? { response: { status: 429, headers: new Headers({ 'Retry-After': '90' }) }, body: {} } : saved,
    sleep: async (ms) => { waits.push(ms); now += ms; }, onRateLimited: (value) => observations.push(value) });
  assert.equal(result, saved); assert.equal(calls, 2); assert.deepEqual(waits, [30000, 30000, 30000]);
  assert.deepEqual(observations, [{ operation: 'attempt', httpStatus: 429, retryAfterSeconds: 90 }]);
  for (const operation of ['submit_attempt', 'retry_attempt', 'start', 'result_pdf', 'email_result']) {
    await assert.rejects(retryForecastRead({ operation, deadline: 100, now: () => 0, request: async () => { throw new Error('must not run'); } }));
  }
});

test('saved-read cooldown cannot retry early beyond its deadline or continue a hung read', async () => {
  let calls = 0;
  await assert.rejects(retryForecastRead({ operation: 'history', deadline: 1000, now: () => 0,
    request: async () => { calls++; return { response: { status: 429, headers: new Headers({ 'Retry-After': '2' }) }, body: {} }; },
    sleep: async () => { throw new Error('must not wait early'); } }), { code: 'ASTRA_FORECAST_READ_TIMEOUT' });
  assert.equal(calls, 1);
  const read = deferred(); calls = 0;
  await assert.rejects(retryForecastRead({ operation: 'attempt', deadline: Date.now() + 20,
    request: async () => { calls++; return read.promise; } }), { code: 'ASTRA_FORECAST_READ_TIMEOUT' });
  read.resolve({ response: { status: 429, headers: new Headers({ 'Retry-After': '0' }) }, body: {} });
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(calls, 1);
});

test('saved reads do not reinterpret a403 or failed grading payload as a retryable quota', async () => {
  for (const status of [403, 404, 200]) {
    let calls = 0; const response = { response: { status }, body: { attempt: { status: 'failed' } } };
    assert.equal(await retryForecastRead({ operation: 'attempt', deadline: 1000, now: () => 0, request: async () => { calls++; return response; } }), response);
    assert.equal(calls, 1);
  }
});
