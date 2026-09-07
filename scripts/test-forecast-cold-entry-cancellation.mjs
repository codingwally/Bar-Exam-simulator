import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Optional read-only red-baseline evidence. CI always exercises the working source.
const sourceRef = process.env.FORECAST_ENTRY_SOURCE_REF || '';
if (sourceRef) assert.match(sourceRef, /^[a-f0-9]{40}$/u);
const readSource = (relative) => (sourceRef
  ? execFileSync('git', ['show', `${sourceRef}:${relative}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(path.join(root, relative), 'utf8')).replaceAll('\r\n', '\n');
const landingSource = readSource('assets/private-beta-landing.js');
const forecastSource = readSource('assets/bar-forecast.js');

function extractFunction(source, name, { optional = false } = {}) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}`, 'mu'));
  if (optional && !match) return '';
  assert.ok(match, `Actual runtime function ${name} must be available.`);
  return match[0];
}

function extractState(source) {
  const match = source.match(/^  const state = \{[\s\S]*?^  \};/mu);
  assert.ok(match, 'Use the actual runtime state declaration, including cancellation generations.');
  return match[0];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flushMicrotasks(count = 32) {
  for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
}

async function settledWithoutReleasingFeature(promise) {
  let settled = false;
  let value;
  let failure;
  promise.then((result) => { settled = true; value = result; }, (error) => { settled = true; failure = error; });
  await flushMicrotasks(64);
  assert.equal(settled, true, 'Cancelled work must settle without awaiting any still-held new-owner feature load.');
  if (failure) throw failure;
  return value;
}

function createHarness({ hash = '#bar-forecast-2026', authReady = false } = {}) {
  const auth = deferred();
  if (authReady) auth.resolve();
  let owner = 'synthetic-owner-a';
  const session = () => owner ? { user: { id: owner }, access_token: 'synthetic-local-only' } : null;
  const listeners = new Map();
  const eventLog = [];
  const errors = [];
  const featureCalls = [];
  const featureQueues = new Map();
  const authorizationOwners = [];
  const historyEntries = [{ hash, search: '' }];
  let historyIndex = 0;

  class LocalElement {
    constructor(dataset = {}) {
      this.dataset = dataset;
      this.attributes = new Map();
      this.disabled = false;
      this.hidden = false;
      this.open = false;
      this.isConnected = true;
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener() {}
    querySelector() { return null; }
    replaceChildren() {}
    focus() {}
    close() { this.open = false; }
  }
  class LocalEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
  }
  const forecastControl = new LocalElement({ publicFeature: 'bar-forecast' });
  const homeControl = new LocalElement({ publicFeature: 'quorum' });
  const controls = [forecastControl, homeControl];
  const elements = Object.fromEntries([
    'private-beta-landing', 'site-header', 'authenticated-app-shell', 'private-beta-dialog',
  ].map((id) => [id, new LocalElement()]));
  elements['authenticated-app-shell'].hidden = true;
  const document = {
    activeElement: null,
    documentElement: { dataset: {} },
    body: new LocalElement(),
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      return selector === '[data-public-feature], [data-public-home]' ? controls : [];
    },
    addEventListener() {},
  };
  const location = {
    origin: 'https://fixture.invalid', pathname: '/', search: '', hash,
    get href() { return `${this.origin}${this.pathname}${this.search}${this.hash}`; },
  };
  const global = {
    DueDiligencePhase2: { whenAuthReady: () => auth.promise, getSession: session },
    DueDiligenceQuorum: { open: async () => true },
    DueDiligenceFeatureLoader: {
      async loadForFeature(feature, options) {
        featureCalls.push({ feature, options });
        const gate = featureQueues.get(feature)?.shift();
        return gate ? await gate.promise : true;
      },
    },
    sessionStorage: { getItem: () => '', removeItem() {} },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      eventLog.push({ type: event.type, hash: location.hash });
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
    setTimeout: () => 1,
    clearTimeout() {},
    toast(message) { errors.push(message); },
    confirm() { throw new Error('This no-answer navigation fixture must not require draft confirmation.'); },
  };
  const history = {
    state: {},
    pushState(state, _title, target) {
      const next = new URL(target, location.href);
      this.state = state;
      location.hash = next.hash;
      location.search = next.search;
      historyEntries.splice(++historyIndex, Infinity, { hash: next.hash, search: next.search });
      // The real browser does not dispatch popstate/hashchange for pushState.
    },
    replaceState(state, _title, target) {
      const next = new URL(target, location.href);
      this.state = state;
      location.hash = next.hash;
      location.search = next.search;
      historyEntries[historyIndex] = { hash: next.hash, search: next.search };
    },
    back() {
      assert.ok(historyIndex > 0, 'Back must have an actual earlier fixture history entry.');
      Object.assign(location, historyEntries[--historyIndex]);
      global.dispatchEvent(new LocalEvent('popstate'));
      global.dispatchEvent(new LocalEvent('hashchange'));
    },
  };

  // Only rendering, model-independent authorization response, and draft storage
  // are stubs. Opener, Close, history, outer entry and event handlers are source.
  const forecast = new Function('global', 'location', 'history', 'document', 'Element', 'Event', 'CustomEvent', 'authorized', `
    const ROUTE = '#bar-forecast-2026';
    ${extractState(forecastSource)}
    function runtimeSession() { return global.DueDiligencePhase2.getSession(); }
    function runtimeOwnerId() { return runtimeSession()?.user?.id || ''; }
    function ensureRoot() {
      state.root ||= { hidden: true };
      state.viewNode ||= { replaceChildren() {} };
    }
    function isolatePage() {}
    function renderAccessProgress() {}
    async function checkAuthorization() {
      state.ownerId = runtimeOwnerId(); state.view = 'picker'; authorized(state.ownerId);
      return true;
    }
    function openForecastSignIn() { throw new Error('Unexpected signed-out Forecast opener.'); }
    function stopForecastPolling() {}
    function abortRequest() {}
    function abortAuthorization() {}
    function resetProtectedState() { state.ownerId = ''; state.authorizationOwnerId = ''; }
    function captureAnswerFromEditor() { throw new Error('No answer content belongs in this fixture.'); }
    function persistForecastDraft() { return true; }
    ${['setForecastRoute', 'restoreForecastRoute', 'closeForecast', 'openForecast'].map((name) => extractFunction(forecastSource, name)).join('\n')}
    return { state, openForecast, closeForecast };
  `)(global, location, history, document, LocalElement, LocalEvent, LocalEvent, (value) => authorizationOwners.push(value));
  global.openBarForecast = forecast.openForecast;

  const landingFunctions = [
    'currentSession', 'setHidden', 'finishAuthEntryResolution', 'publishAccessState',
    'normalizedHash', 'applicationRouteRequested', 'requestedApplicationRoute',
    'activateApplicationRoute', 'showApplication', 'resetQuorumHomeLocation', 'openQuorumHome',
    'showPublicHomepage', 'normalizeSafeReturnHash', 'safeReturnHash',
    'syncAuthenticatedState', 'handleLandingSessionChange', 'loadFeature',
    'setPublicNavigationBusy', 'invokePublicOpener', 'openProtectedFeature',
    'runPublicNavigation', 'bindEvents', 'initialize',
  ];
  const landing = new Function('global', 'location', 'history', 'document', 'URL', 'URLSearchParams', 'Event', 'CustomEvent', 'requestAnimationFrame', 'errors', `
    const config = { features: { privateBetaGate: false } };
    const gateEnabled = false;
    const routineSessionRefreshReasons = new Set(['refresh', 'TOKEN_REFRESHED']);
    const publicHomepageHashes = new Set(['', 'public-platform', 'quorum', 'lex-forum', 'chamber/academy', 'chamber/commons', 'chamber/barbound']);
    const landing = document.getElementById('private-beta-landing');
    const siteHeader = document.getElementById('site-header');
    const appShell = document.getElementById('authenticated-app-shell');
    const dialog = document.getElementById('private-beta-dialog');
    const authBootstrap = null;
    const featureLabels = { 'bar-forecast': 'Forecast', quorum: 'Home' };
    ${extractState(landingSource)}
    function showLanding() {}
    function renderPublicRoute() {}
    function closePublicMenus() {}
    function handlePublicNavigation() {}
    function clearNavigationStatus() {}
    function showNavigationStatus() {}
    function reportNavigationError(message) { errors.push(message); }
    ${['cancelPublicNavigation', 'invalidateForecastEntry', 'reconcileForecastNavigationIntent'].map((name) => extractFunction(landingSource, name, { optional: true })).join('\n')}
    ${landingFunctions.map((name) => extractFunction(landingSource, name)).join('\n')}
    return { state, initialize, bindEvents, handleLandingSessionChange, activateApplicationRoute, openProtectedFeature, runPublicNavigation, openQuorumHome };
  `)(global, location, history, document, URL, URLSearchParams, LocalEvent, LocalEvent, (callback) => callback(), errors);

  return {
    auth, global, location, history, landing, forecast, controls, errors, eventLog,
    featureCalls, authorizationOwners,
    holdFeature(feature) {
      const gate = deferred();
      if (!featureQueues.has(feature)) featureQueues.set(feature, []);
      featureQueues.get(feature).push(gate);
      return gate;
    },
    sessionEvent(nextOwner, reason = 'TOKEN_REFRESHED') {
      owner = nextOwner;
      global.dispatchEvent(new LocalEvent('duediligence:session', { detail: { authenticated: Boolean(owner), reason } }));
    },
    routeEvent(nextHash, type = 'popstate') {
      location.hash = nextHash;
      global.dispatchEvent(new LocalEvent(type));
    },
    assertClosedAtHome() {
      assert.equal(location.hash, '#quorum', 'Home must retain its actual browser route.');
      assert.equal(forecast.state.root?.hidden, true, 'Closed Forecast must not reopen behind the Home hash.');
      assert.equal(forecast.state.isOpen, false);
      assert.equal(landing.state.publicNavigationBusy, false, 'A settled cancellation must release public navigation.');
      assert.ok(controls.every((control) => !control.disabled), 'Public launchers must be usable after cancellation.');
      assert.deepEqual(errors, [], 'Cancellation is not a user-visible navigation error.');
    },
  };
}

test('unchanged current cold route completes after auth without cancelling its own intent', async () => {
  const h = createHarness();
  const startup = h.landing.initialize();
  h.auth.resolve();
  await startup;
  assert.equal(h.location.hash, '#bar-forecast-2026');
  assert.equal(h.forecast.state.root.hidden, false);
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
  assert.equal(h.landing.state.lastActivatedHash, 'bar-forecast-2026');
  assert.deepEqual(h.errors, []);
});

test('cold bootstrap delayed on auth cannot reopen Forecast after session-open, Close, then slower Home', async () => {
  const h = createHarness();
  const home = h.holdFeature('quorum');
  const startup = h.landing.initialize();
  // Phase2 actually publishes the initial session before its whenAuthReady resolves.
  h.sessionEvent('synthetic-owner-a', 'INITIAL_SESSION');
  await flushMicrotasks();
  assert.equal(h.forecast.state.root.hidden, false);
  assert.equal(h.authorizationOwners.length, 1);
  assert.equal(h.forecast.closeForecast(), true);
  assert.equal(h.forecast.state.root.hidden, true);
  h.auth.resolve();
  await startup;
  await flushMicrotasks();
  home.resolve(true);
  await flushMicrotasks();
  h.assertClosedAtHome();
  assert.equal(h.authorizationOwners.length, 1, 'Abandoned bootstrap must not start a second authorization.');
});

test('cold bootstrap delayed on feature load is cancelled by Close even if auth already resolved', async () => {
  const h = createHarness({ authReady: true });
  const staleLoad = h.holdFeature('bar-forecast');
  const startup = h.landing.initialize();
  await flushMicrotasks();
  assert.equal(h.featureCalls.filter(({ feature }) => feature === 'bar-forecast').length, 1);
  await h.landing.activateApplicationRoute(h.location.hash);
  assert.equal(h.forecast.state.root.hidden, false);
  h.forecast.closeForecast();
  staleLoad.resolve(true);
  await startup;
  await flushMicrotasks();
  h.assertClosedAtHome();
  assert.equal(h.authorizationOwners.length, 1);
});

test('Close invalidates synchronously before the route restoration event', async () => {
  const h = createHarness({ authReady: true });
  await h.landing.initialize();
  h.eventLog.length = 0;
  h.forecast.closeForecast();
  await flushMicrotasks();
  assert.equal(h.eventLog[0]?.type, 'duediligence:bar-forecast-closed');
  assert.equal(h.eventLog[0]?.hash, '#bar-forecast-2026', 'Intent must be cancelled before history restoration.');
  assert.ok(h.eventLog.some(({ type }) => type === 'popstate'));
  h.assertClosedAtHome();
});

test('a fresh explicit Forecast reopen after Close succeeds with a new public intent', async () => {
  const h = createHarness({ authReady: true });
  await h.landing.initialize();
  h.forecast.closeForecast();
  await flushMicrotasks();
  h.assertClosedAtHome();
  assert.equal(await h.landing.runPublicNavigation('bar-forecast', h.controls[0]), true);
  assert.equal(h.location.hash, '#bar-forecast-2026');
  assert.equal(h.forecast.state.root.hidden, false);
  assert.equal(h.authorizationOwners.length, 2);
  assert.equal(h.landing.state.publicNavigationBusy, false);
  assert.ok(h.controls.every((control) => !control.disabled));
  assert.deepEqual(h.errors, []);
});

test('routine same-owner token refresh does not cancel a valid delayed cold entry', async () => {
  const h = createHarness();
  h.landing.bindEvents();
  h.sessionEvent('synthetic-owner-a');
  const pending = h.landing.openProtectedFeature('bar-forecast');
  h.sessionEvent('synthetic-owner-a');
  h.auth.resolve();
  assert.equal(await pending, true);
  assert.equal(h.forecast.state.root.hidden, false);
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
});

test('A to B to A invalidates delayed auth work even when the final owner string matches', async () => {
  const h = createHarness({ hash: '#pricing' });
  h.landing.bindEvents();
  h.sessionEvent('synthetic-owner-a');
  await flushMicrotasks();
  h.location.hash = '#bar-forecast-2026';
  const pending = h.landing.openProtectedFeature('bar-forecast');
  const ownerBLoad = h.holdFeature('bar-forecast');
  h.sessionEvent('synthetic-owner-b');
  const freshOwnerALoad = h.holdFeature('bar-forecast');
  h.sessionEvent('synthetic-owner-a');
  h.auth.resolve();
  assert.equal(await settledWithoutReleasingFeature(pending), false);
  assert.equal(h.forecast.state.isOpen, false);
  assert.deepEqual(h.authorizationOwners, []);
  assert.equal(h.featureCalls.length, 2, 'Only the two real owner-change route activations may load; abandoned bootstrap must not.');
  ownerBLoad.resolve(true);
  freshOwnerALoad.resolve(true);
  await flushMicrotasks();
  assert.equal(h.forecast.state.root.hidden, false, 'A fresh current-owner route activation remains allowed.');
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
});

test('A to B to A also fences a delayed actual route-activation feature load', async () => {
  const h = createHarness({ hash: '#pricing', authReady: true });
  h.landing.bindEvents();
  h.sessionEvent('synthetic-owner-a');
  await flushMicrotasks();
  h.location.hash = '#bar-forecast-2026';
  const staleLoad = h.holdFeature('bar-forecast');
  const pending = h.landing.activateApplicationRoute(h.location.hash);
  const ownerBLoad = h.holdFeature('bar-forecast');
  h.sessionEvent('synthetic-owner-b');
  const freshOwnerALoad = h.holdFeature('bar-forecast');
  h.sessionEvent('synthetic-owner-a');
  staleLoad.resolve(true);
  await pending;
  assert.equal(h.forecast.state.isOpen, false);
  assert.deepEqual(h.authorizationOwners, []);
  assert.notEqual(h.landing.state.lastActivatedHash, 'bar-forecast-2026');
  ownerBLoad.resolve(true);
  freshOwnerALoad.resolve(true);
  await flushMicrotasks();
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
});

test('paired popstate and hashchange for one navigation open the current Forecast only once', async () => {
  const h = createHarness({ hash: '#quorum', authReady: true });
  await h.landing.initialize();
  const load = h.holdFeature('bar-forecast');
  h.routeEvent('#bar-forecast-2026', 'popstate');
  h.routeEvent('#bar-forecast-2026', 'hashchange');
  await flushMicrotasks();
  load.resolve(true);
  await flushMicrotasks();
  assert.equal(h.forecast.state.root.hidden, false);
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
  assert.equal(h.featureCalls.filter(({ feature }) => feature === 'bar-forecast').length, 1);
  assert.equal(h.landing.state.publicNavigationBusy, false);
  assert.deepEqual(h.errors, []);
});

test('a superseded slow Home cannot clear the newer Forecast busy ownership or rewrite its route', async () => {
  const h = createHarness({ hash: '#quorum', authReady: true });
  await h.landing.initialize();
  const oldHomeLoad = h.holdFeature('quorum');
  const oldHome = h.landing.runPublicNavigation('quorum');
  await flushMicrotasks();
  const forecastLoad = h.holdFeature('bar-forecast');
  h.routeEvent('#bar-forecast-2026');
  await flushMicrotasks();
  oldHomeLoad.resolve(true);
  assert.equal(await oldHome, false);
  assert.equal(h.location.hash, '#bar-forecast-2026');
  assert.equal(h.landing.state.publicNavigationFeature, 'bar-forecast');
  assert.equal(h.landing.state.publicNavigationBusy, true);
  assert.ok(h.controls.every((control) => control.disabled), 'Old Home finally must not unlock another intent.');
  forecastLoad.resolve(true);
  await flushMicrotasks();
  assert.equal(h.forecast.state.root.hidden, false);
  assert.deepEqual(h.authorizationOwners, ['synthetic-owner-a']);
  assert.equal(h.landing.state.publicNavigationBusy, false);
  assert.deepEqual(h.errors, []);
});

test('old Home promise cleanup cannot erase a newer Home promise after an intervening Forecast intent', async () => {
  const h = createHarness({ hash: '#quorum', authReady: true });
  await h.landing.initialize();
  const oldHomeLoad = h.holdFeature('quorum');
  const oldHome = h.landing.runPublicNavigation('quorum');
  await flushMicrotasks();
  const forecastLoad = h.holdFeature('bar-forecast');
  h.routeEvent('#bar-forecast-2026');
  await flushMicrotasks();
  const newHomeLoad = h.holdFeature('quorum');
  h.routeEvent('#quorum');
  await flushMicrotasks();
  const newHome = h.landing.state.quorumHomePromise;
  assert.ok(newHome, 'The newest Home owns an actual pending promise.');
  oldHomeLoad.resolve(true);
  assert.equal(await oldHome, false);
  forecastLoad.resolve(true);
  await flushMicrotasks();
  assert.equal(h.landing.state.quorumHomePromise, newHome, 'Earlier finally must leave the newer Home promise intact.');
  assert.equal(h.landing.state.publicNavigationFeature, 'quorum');
  assert.equal(h.landing.state.publicNavigationBusy, true);
  assert.ok(h.controls.every((control) => control.disabled));
  assert.deepEqual(h.authorizationOwners, []);
  newHomeLoad.resolve(true);
  await newHome;
  await flushMicrotasks();
  assert.equal(h.location.hash, '#quorum');
  assert.equal(h.forecast.state.isOpen, false);
  assert.equal(h.landing.state.quorumHomePromise, null);
  assert.equal(h.landing.state.publicNavigationBusy, false);
  assert.ok(h.controls.every((control) => !control.disabled));
  assert.deepEqual(h.errors, []);
});
