import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist.`);
  const parameterStart = source.indexOf('(', match.index);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const openingBrace = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`Could not extract ${name}().`);
}

const root = new URL('../', import.meta.url);
const [html, landing, loader, home, examinations, study, shellCss, phase2Css, homeCss, examinationsCss, studyCss] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/lex-forum.js', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('assets/phase2.css', root), 'utf8'),
  readFile(new URL('assets/lex-forum.css', root), 'utf8'),
  readFile(new URL('assets/examinations.css', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
]);

assert.doesNotMatch(
  html,
  /escapeAttribute\(/,
  'The public startup path must not call an undefined HTML-attribute escaping helper.',
);
assert.match(
  html,
  /function showPage\(page, el, options = \{\}\)[\s\S]*?page !== 'mock' && examStage === 'subjectLoading'[\s\S]*?invalidateSubjectSelectionRequest\(\{ resetSelectionState: true \}\)/,
  'Leaving Bar Question Practice must invalidate any pending subject request.',
);

// Deep-linked Home controls must open the true Home feed and remove stale view parameters.
const resetContext = vm.createContext({
  URL,
  location: {
    href: 'https://duediligence.ph/?quorumView=unanswered#quorum',
    pathname: '/',
    search: '?quorumView=unanswered',
    hash: '#quorum',
  },
  history: {
    state: {},
    pushed: null,
    pushState(state, _title, url) { this.state = state; this.pushed = url; },
  },
  state: { publicNavigationVersion: 0, publicNavigationBusy: false, navigationStatusTimer: null },
  setPublicNavigationBusy() {},
  clearNavigationStatus() {},
  showNavigationStatus() {},
  global: { setTimeout: () => null },
  openQuorumHome: async () => true,
  openProtectedFeature: async () => true,
  reportNavigationError() {},
  featureLabels: { quorum: 'Home' },
});
vm.runInContext(
  `${extractNamedFunction(landing, 'resetQuorumHomeLocation')}\n`
  + `${extractNamedFunction(landing, 'runPublicNavigation')}`,
  resetContext,
);
await vm.runInContext("runPublicNavigation('quorum')", resetContext);
assert.equal(resetContext.history.pushed, '/#quorum');
assert.match(landing, /DueDiligenceQuorum\?\.open\?\.\([\s\S]*?\{ forceHome: true, isCurrent \}/);
assert.match(home, /const forceHome = options\.forceHome === true \|\|/);
assert.match(home, /options\.forceHome === true[\s\S]*?setView\('home', \{ route: false \}\)/);
assert.match(landing, /if \(opened !== true\) \{[\s\S]*?return false;[\s\S]*?feature === 'quorum'[\s\S]*?resetQuorumHomeLocation\(\)/);
let quorumOpenOptions = null;
const quorumHomeContext = vm.createContext({
  state: { forecastEntryVersion: 0, sessionOwnerVersion: 0 },
  currentSession: () => ({ access_token: 'test-token' }),
  loadFeature: async () => true,
  showApplication() {},
  document: { getElementById: () => ({ id: 'spa-community' }) },
  global: {
    DueDiligencePhase2: { whenAuthReady: async () => {} },
    DueDiligencePhase4: {},
    DueDiligenceQuorum: {
      open: async (_trigger, options) => { quorumOpenOptions = options; return true; },
    },
  },
});
vm.runInContext(extractNamedFunction(landing, 'openProtectedFeature'), quorumHomeContext);
assert.equal(await vm.runInContext("openProtectedFeature('quorum')", quorumHomeContext), true);
assert.equal(quorumOpenOptions?.forceHome, true, 'Home must explicitly reset the community view to the feed.');

// Mock navigation has already completed the authoritative access check, so the
// page-router guard must not start a second asynchronous check and return false.
let mockPageOptions = null;
const mockNavigationState = {};
const mockNavigationContext = vm.createContext({
  state: mockNavigationState,
  currentSession: () => ({ access_token: 'test-token' }),
  loadFeature: async () => true,
  showApplication() {},
  document: { getElementById: () => ({ id: 'spa-mock' }) },
  global: {
    DueDiligencePhase2: { whenAuthReady: async () => {} },
    DueDiligencePhase4: { ensureProtectedAccess: async () => true },
    showPage(_page, _trigger, options) {
      mockPageOptions = options;
      return options?.accessVerified === true;
    },
  },
});
vm.runInContext(extractNamedFunction(landing, 'openProtectedFeature'), mockNavigationContext);
assert.equal(await vm.runInContext("openProtectedFeature('mock')", mockNavigationContext), true);
assert.equal(mockPageOptions?.accessVerified, true,
  'Mock navigation must identify its completed access check to the page router.');
assert.equal(mockNavigationState.lastActivatedHash, 'mock-bar');

let guardedOriginalCalls = 0;
let guardedAccessChecks = 0;
const guardedPageContext = vm.createContext({
  protectedPageRoutes: { mock: '#mock-bar' },
  ensureProtectedAccess: async () => { guardedAccessChecks += 1; return true; },
  global: {
    showPage() { guardedOriginalCalls += 1; return true; },
    DueDiligencePhase4: { getAccess: () => null },
    DueDiligencePublicNavigation: {},
  },
});
vm.runInContext(extractNamedFunction(loader, 'installPageRouterGuard'), guardedPageContext);
vm.runInContext('installPageRouterGuard()', guardedPageContext);
assert.equal(
  vm.runInContext("global.showPage('mock', {}, { accessVerified: true })", guardedPageContext),
  true,
  'An access-verified Mock route must preserve the synchronous page-router result.',
);
assert.equal(guardedOriginalCalls, 1);
assert.equal(guardedAccessChecks, 0, 'An access-verified route must not repeat the access check.');

// Busy navigation is inert even when the trigger is an anchor, and stale BarFeels is not success.
assert.match(landing, /event\.preventDefault\(\);\s*if \(feature\.disabled \|\| feature\.getAttribute\('aria-busy'\) === 'true'\) return;/);
assert.match(landing, /control\.setAttribute\('aria-disabled', 'true'\)/);
assert.match(landing, /document\.querySelectorAll\('\[data-public-feature\], \[data-public-home\]'\)/);
assert.match(landing, /state\.publicNavigationBusy \|\| home\.getAttribute\('aria-disabled'\) === 'true'/);
assert.match(landing, /if \(state\.publicNavigationBusy\) return false/);
assert.match(landing, /showNavigationStatus\(`Opening \$\{label\}…`\)/);
assert.match(landing, /showNavigationStatus\(`\$\{label\} opened\.`,'?\s*'success'\)|showNavigationStatus\(`\$\{label\} opened\.`\s*,\s*'success'\)/);
assert.match(landing, /classList\.toggle\('dd2-sr-only', kind === 'loading' \|\| kind === 'success'\)/);
assert.match(landing, /classList\.remove\('is-success', 'is-loading', 'dd2-sr-only'\)/);
assert.match(phase2Css, /\.dd2-sr-only\s*\{[\s\S]*?width:\s*1px\s*!important;[\s\S]*?overflow:\s*hidden\s*!important;[\s\S]*?white-space:\s*nowrap\s*!important;/,
  'Routine navigation feedback must remain live for assistive technology without covering the current page.');
assert.match(landing, /if \(outcome\?\.status === 'stale'\) return false;/);
assert.match(landing, /outcome == null/);
assert.match(html, /const opened = await request;[\s\S]*?return \{ status: 'stale' \};[\s\S]*?if \(opened !== true\)/);
let preventedBusyAnchor = 0;
let navigatedBusyAnchor = 0;
const busyFeatureAnchor = {
  disabled: false,
  dataset: { publicFeature: 'bar-easy' },
  getAttribute(name) { return name === 'aria-busy' ? 'true' : null; },
};
const busyAnchorContext = vm.createContext({
  global: {},
  closePublicMenus() {},
  runPublicNavigation() { navigatedBusyAnchor += 1; },
});
vm.runInContext(extractNamedFunction(landing, 'handlePublicNavigation'), busyAnchorContext);
const handlePublicNavigation = vm.runInContext('handlePublicNavigation', busyAnchorContext);
await handlePublicNavigation({
  defaultPrevented: false,
  preventDefault() { preventedBusyAnchor += 1; },
  target: {
    closest(selector) { return selector === '[data-public-feature]' ? busyFeatureAnchor : null; },
  },
});
assert.equal(preventedBusyAnchor, 1, 'A busy anchor must have its native navigation cancelled.');
assert.equal(navigatedBusyAnchor, 0, 'A busy anchor must not start a second feature navigation.');

// A rejected retry must leave a live, enabled retry control with the new error.
const status = {
  hidden: true,
  role: '',
  classList: { add() {}, remove() {} },
  setAttribute(name, value) { if (name === 'role') this.role = value; },
};
const statusCopy = { textContent: '' };
const retryButton = {
  hidden: true,
  disabled: false,
  onclick: null,
  setAttribute() {},
  removeAttribute() {},
};
const retryContext = vm.createContext({
  navigationStatus: status,
  navigationStatusCopy: statusCopy,
  navigationRetry: retryButton,
  global: { toast() {} },
});
vm.runInContext(extractNamedFunction(landing, 'reportNavigationError'), retryContext);
const reportNavigationError = vm.runInContext('reportNavigationError', retryContext);
reportNavigationError('First failure', async () => { throw new Error('Second failure'); });
await retryButton.onclick();
assert.equal(retryButton.disabled, false);
assert.equal(retryButton.hidden, false);
assert.equal(typeof retryButton.onclick, 'function');
assert.equal(statusCopy.textContent, 'Second failure');
assert.equal(status.role, 'alert');

// A successful retry must replace the stale error with success and retire Retry.
const successfulStatusClasses = new Set();
const successfulStatus = {
  hidden: true,
  role: '',
  classList: {
    add(...names) { names.forEach((name) => successfulStatusClasses.add(name)); },
    remove(...names) { names.forEach((name) => successfulStatusClasses.delete(name)); },
    toggle(name, force) {
      if (force === true) successfulStatusClasses.add(name);
      else if (force === false) successfulStatusClasses.delete(name);
    },
  },
  setAttribute(name, value) { if (name === 'role') this.role = value; },
};
const successfulStatusCopy = { textContent: '' };
const successfulRetryButton = {
  hidden: true,
  disabled: false,
  onclick: null,
  setAttribute() {},
  removeAttribute() {},
};
const successfulRetryContext = vm.createContext({
  navigationStatus: successfulStatus,
  navigationStatusCopy: successfulStatusCopy,
  navigationRetry: successfulRetryButton,
  state: { publicNavigationBusy: false, publicNavigationVersion: 0, navigationStatusTimer: null },
  featureLabels: { mock: 'Bar Question Practice' },
  currentSession: () => ({ access_token: 'test-token' }),
  openQuorumHome: async () => false,
  openProtectedFeature: async () => true,
  resetQuorumHomeLocation() {},
  setPublicNavigationBusy() {},
  global: { clearTimeout() {}, setTimeout: () => 1, toast() {} },
});
vm.runInContext([
  extractNamedFunction(landing, 'clearNavigationStatus'),
  extractNamedFunction(landing, 'showNavigationStatus'),
  extractNamedFunction(landing, 'reportNavigationError'),
  extractNamedFunction(landing, 'runPublicNavigation'),
].join('\n'), successfulRetryContext);
vm.runInContext(
  "reportNavigationError('First failure', () => runPublicNavigation('mock'))",
  successfulRetryContext,
);
await successfulRetryButton.onclick();
assert.equal(successfulStatusCopy.textContent, 'Bar Question Practice opened.');
assert.equal(successfulStatusClasses.has('is-success'), true);
assert.equal(successfulStatusClasses.has('is-error'), false);
assert.equal(successfulStatusClasses.has('dd2-sr-only'), true,
  'Successful navigation is announced without showing a floating confirmation tab.');
assert.equal(successfulRetryButton.hidden, true);
assert.equal(successfulRetryButton.onclick, null);
assert.equal(successfulRetryButton.disabled, false);

const showNavigationStatus = vm.runInContext('showNavigationStatus', successfulRetryContext);
const reportSuccessfulNavigationError = vm.runInContext('reportNavigationError', successfulRetryContext);
showNavigationStatus('Opening Doctrine Review…', 'loading');
assert.equal(successfulStatusClasses.has('dd2-sr-only'), true,
  'Routine loading feedback must be assistive-only.');
assert.equal(successfulStatus.role, 'status');
assert.equal(successfulStatus.hidden, false, 'The live region must remain exposed to assistive technology.');
showNavigationStatus('Sign in to continue to Doctrine Review.', 'info');
assert.equal(successfulStatusClasses.has('dd2-sr-only'), false,
  'Sign-in guidance must remain visibly actionable.');
assert.equal(successfulStatus.hidden, false);
reportSuccessfulNavigationError('Doctrine Review could not be opened.', null);
assert.equal(successfulStatusClasses.has('dd2-sr-only'), false,
  'Navigation errors and recovery must remain visible.');
assert.equal(successfulStatusClasses.has('is-error'), true);
assert.equal(successfulStatus.role, 'alert');

// Failed lazy assets must be evicted so the next click performs a real network retry.
assert.match(loader, /loadedStyles\.get\(href\) === pending[\s\S]*?loadedStyles\.delete\(href\)/);
assert.match(loader, /loadedScripts\.get\(src\) === pending[\s\S]*?loadedScripts\.delete\(src\)/);
assert.match(loader, /featurePromises\.delete\(group\)/);

// Exercise the real loader with controlled native events and a deterministic
// clock. No network, real credentials, or live subscriptions are involved.
async function flushLoaderMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function createLoaderHarness({ allowed = true, existingStyles = [] } = {}) {
  const nodes = [];
  const timers = new Map();
  let now = 0;
  let timerSequence = 0;
  let accessChecks = 0;
  const append = (node) => {
    node.connected = true;
    nodes.push(node);
  };
  const document = {
    readyState: 'loading',
    activeElement: null,
    head: { append },
    body: { append },
    get styleSheets() {
      return existingStyles.map((href) => ({ href })).concat(nodes
        .filter((node) => node.rel === 'stylesheet' && node.connected && node.loaded)
        .map((node) => ({ href: node.href })));
    },
    createElement(tagName) {
      const listeners = new Map();
      return {
        tagName,
        dataset: {},
        connected: false,
        loaded: false,
        listeners,
        addEventListener(name, callback, options) { listeners.set(name, { callback, options }); },
        removeEventListener(name, callback) {
          if (listeners.get(name)?.callback === callback) listeners.delete(name);
        },
        remove() { this.connected = false; },
        emit(name) {
          if (name === 'load') this.loaded = true;
          const listener = listeners.get(name);
          if (listener?.options?.once) listeners.delete(name);
          listener?.callback();
        },
      };
    },
  };
  const window = {
    addEventListener() {},
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    DueDiligencePhase4: {
      getAccess: () => ({ allowed, unlimited: allowed }),
      ensureProtectedAccess: async () => { accessChecks += 1; return allowed; },
      ensureUnlimitedFeatureAccess: async () => { accessChecks += 1; return allowed; },
    },
  };
  vm.runInNewContext(loader, {
    window, document, URL,
    Date: { now: () => now },
    location: { href: 'https://duediligence.ph/?source=home#subject-matter' },
  }, { filename: 'assets/feature-loader.js' });
  return {
    api: window.DueDiligenceFeatureLoader,
    nodes,
    timers,
    styles: () => nodes.filter((node) => node.rel === 'stylesheet'),
    scripts: () => nodes.filter((node) => node.tagName === 'script'),
    accessChecks: () => accessChecks,
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        timer.callback();
        await flushLoaderMicrotasks();
      }
      now = until;
      await flushLoaderMicrotasks();
    },
  };
}

async function completeExaminationScripts(harness) {
  await flushLoaderMicrotasks();
  assert.equal(harness.scripts().length, 1, 'Scripts must start sequentially after all styles are ready.');
  harness.scripts()[0].emit('load');
  await flushLoaderMicrotasks();
  assert.equal(harness.scripts().length, 2);
  harness.scripts()[1].emit('load');
  await flushLoaderMicrotasks();
}

// A native stylesheet error gets exactly one automatic cache-busted retry,
// shared by concurrent opens. Existing version keys and the origin are retained.
const recoveredLoader = createLoaderHarness();
const recoveredOpen = recoveredLoader.api.loadForFeature('subject-matter');
const concurrentOpen = recoveredLoader.api.loadForFeature('bar-feels');
await flushLoaderMicrotasks();
assert.equal(recoveredLoader.styles().length, 2);
const [failedStyle, siblingStyle] = recoveredLoader.styles();
const originalStyleUrl = new URL(failedStyle.href, 'https://duediligence.ph/');
failedStyle.emit('error');
siblingStyle.emit('load');
await flushLoaderMicrotasks();
assert.equal(recoveredLoader.styles().length, 3, 'Concurrent routes must share the one automatic retry.');
assert.equal(failedStyle.connected, false);
assert.equal(failedStyle.listeners.size, 0, 'Failed stylesheet handlers must be removed.');
assert.equal(siblingStyle.listeners.size, 0, 'Successful stylesheet handlers must be removed.');
assert.equal(recoveredLoader.scripts().length, 0, 'A successful sibling must not bypass the failed stylesheet.');
const retryStyle = recoveredLoader.styles()[2];
const retryStyleUrl = new URL(retryStyle.href);
assert.equal(retryStyleUrl.origin, originalStyleUrl.origin);
assert.equal(retryStyleUrl.pathname, originalStyleUrl.pathname);
assert.equal(retryStyleUrl.hash, originalStyleUrl.hash);
assert.ok(retryStyleUrl.searchParams.get('_dd_style_retry'));
retryStyleUrl.searchParams.delete('_dd_style_retry');
assert.equal(retryStyleUrl.href, originalStyleUrl.href, 'Retry must preserve every existing asset version parameter.');
retryStyle.emit('load');
await completeExaminationScripts(recoveredLoader);
assert.equal(await recoveredOpen, true);
assert.equal(await concurrentOpen, true);
assert.equal(recoveredLoader.timers.size, 0);
assert.equal(retryStyle.listeners.size, 0);
assert.equal(await recoveredLoader.api.loadForFeature('subject-matter'), true);
assert.equal(recoveredLoader.styles().length, 3, 'Successful styles must remain reusable.');
assert.equal(recoveredLoader.scripts().length, 2, 'A repeated open must not execute scripts again.');

// Terminal failure is bounded, user-facing copy is concise, and explicit retry
// reuses the successful sibling without retaining the rejected group promise.
const failedLoader = createLoaderHarness();
const failedOpen = failedLoader.api.loadForFeature('subject-matter').catch((error) => error);
const sharedFailure = failedLoader.api.loadForFeature('bar-feels').catch((error) => error);
await flushLoaderMicrotasks();
failedLoader.styles()[0].emit('error');
failedLoader.styles()[1].emit('load');
await flushLoaderMicrotasks();
failedLoader.styles()[2].emit('error');
const terminalError = await failedOpen;
assert.equal(await sharedFailure, terminalError, 'Concurrent opens must observe the same terminal error.');
assert.equal(terminalError.message, 'This page could not finish loading. Please try again.');
assert.equal(terminalError.asset, failedLoader.styles()[0].href, 'Diagnostics retain the canonical asset separately.');
assert.doesNotMatch(terminalError.message, /assets\/|\?/);
assert.match(terminalError.cause.message, /failed/);
assert.equal(failedLoader.styles().length, 3);
assert.equal(failedLoader.timers.size, 0);
assert.equal(failedLoader.scripts().length, 0);
assert.equal(failedLoader.styles().filter((node) => node.connected).length, 1);
const manualOpen = failedLoader.api.loadForFeature('subject-matter');
await flushLoaderMicrotasks();
assert.equal(failedLoader.styles().length, 4, 'Manual retry loads only the failed style, not successful siblings.');
assert.equal(failedLoader.styles()[3].href, failedLoader.styles()[0].href, 'Manual retry starts with the canonical URL.');
failedLoader.styles()[3].emit('load');
await completeExaminationScripts(failedLoader);
assert.equal(await manualOpen, true);

// Missing browser events cannot leave navigation pending indefinitely. Even a
// queued late callback from a removed element must not settle its replacement.
const timedLoader = createLoaderHarness();
let timedOutcome = 'pending';
const timedOpen = timedLoader.api.loadForFeature('subject-matter').then(
  () => { timedOutcome = 'resolved'; },
  (error) => { timedOutcome = 'rejected'; return error; },
);
await flushLoaderMicrotasks();
const timedStyle = timedLoader.styles()[0];
const staleLoad = timedStyle.listeners.get('load').callback;
const staleError = timedStyle.listeners.get('error').callback;
timedLoader.styles()[1].emit('load');
await timedLoader.advance(9999);
assert.equal(timedLoader.styles().length, 2);
assert.equal(timedOutcome, 'pending');
await timedLoader.advance(1);
assert.equal(timedLoader.styles().length, 3);
assert.equal(timedStyle.connected, false);
assert.equal(timedStyle.listeners.size, 0);
staleLoad();
staleError();
await flushLoaderMicrotasks();
assert.equal(timedOutcome, 'pending');
assert.equal(timedLoader.scripts().length, 0, 'A late event must never start scripts before the replacement CSS loads.');
await timedLoader.advance(10000);
const timeoutError = await timedOpen;
assert.equal(timedOutcome, 'rejected');
assert.match(timeoutError.cause.message, /timed out/);
assert.equal(timedLoader.styles().length, 3, 'Two timeouts must not start a third automatic attempt.');
assert.equal(timedLoader.timers.size, 0);
assert.equal(timedLoader.styles()[2].listeners.size, 0);
assert.equal(timedLoader.styles()[2].connected, false);
await timedLoader.advance(60000);
assert.equal(timedLoader.styles().length, 3, 'No background retry loop may survive terminal failure.');
const afterTimeoutOpen = timedLoader.api.loadForFeature('subject-matter');
await flushLoaderMicrotasks();
assert.equal(timedLoader.styles().length, 4);
timedLoader.styles()[3].emit('load');
await completeExaminationScripts(timedLoader);
assert.equal(await afterTimeoutOpen, true, 'Manual recovery must work after a timeout too.');

const timeoutRecovery = createLoaderHarness();
const timeoutRecoveryOpen = timeoutRecovery.api.loadForFeature('subject-matter');
await flushLoaderMicrotasks();
timeoutRecovery.styles()[1].emit('load');
await timeoutRecovery.advance(10000);
timeoutRecovery.styles()[2].emit('load');
await completeExaminationScripts(timeoutRecovery);
assert.equal(await timeoutRecoveryOpen, true, 'A timed-out canonical request can recover automatically.');
assert.equal(timeoutRecovery.timers.size, 0);

// Simultaneous groups share their common stylesheet and script; no duplicate
// initialization is introduced by the stylesheet recovery mechanism.
const crossGroupLoader = createLoaderHarness();
const examinationGroup = crossGroupLoader.api.loadForFeature('subject-matter');
const contentGroup = crossGroupLoader.api.loadForFeature('bar-easy');
await flushLoaderMicrotasks();
assert.equal(crossGroupLoader.styles().length, 3, 'The study workspace stylesheet must be shared between groups.');
crossGroupLoader.styles().forEach((node) => node.emit('load'));
await flushLoaderMicrotasks();
assert.equal(crossGroupLoader.scripts().length, 1, 'The common workspace script must be requested only once.');
crossGroupLoader.scripts()[0].emit('load');
await flushLoaderMicrotasks();
assert.equal(crossGroupLoader.scripts().length, 3);
crossGroupLoader.scripts().slice(1).forEach((node) => node.emit('load'));
assert.equal(await examinationGroup, true);
assert.equal(await contentGroup, true);
assert.equal(crossGroupLoader.timers.size, 0);

const scriptFailureLoader = createLoaderHarness();
const scriptFailure = scriptFailureLoader.api.loadForFeature('subject-matter').catch((error) => error);
await flushLoaderMicrotasks();
scriptFailureLoader.styles().forEach((node) => node.emit('load'));
await flushLoaderMicrotasks();
scriptFailureLoader.scripts()[0].emit('error');
assert.match((await scriptFailure).message, /Unable to load assets\/study-workspace\.js/);
await scriptFailureLoader.advance(60000);
assert.equal(scriptFailureLoader.scripts().length, 1, 'Script failures must never trigger automatic script retries.');

const preloadedLoader = createLoaderHarness({ existingStyles: [failedStyle.href, siblingStyle.href] });
const preloadedOpen = preloadedLoader.api.loadForFeature('subject-matter');
await completeExaminationScripts(preloadedLoader);
assert.equal(await preloadedOpen, true);
assert.equal(preloadedLoader.styles().length, 0, 'Already available canonical styles must not be fetched again.');
assert.equal(preloadedLoader.timers.size, 0);

const deniedLoader = createLoaderHarness({ allowed: false });
assert.equal(await deniedLoader.api.loadForFeature('subject-matter'), false);
assert.equal(await deniedLoader.api.loadForFeature('bar-feels'), false);
assert.equal(deniedLoader.accessChecks(), 2);
assert.equal(deniedLoader.nodes.length, 0, 'Denied access must not load or retry any feature assets.');
assert.equal(deniedLoader.timers.size, 0);

// Home and Study Circles: pending/error truth, stable routing, validation, and create-once recovery.
assert.match(home, /Loading unanswered questions…/);
assert.match(home, /This is not an empty result\./);
assert.match(home, /requestSequence !== state\.sidebarRequestSequence/);
assert.match(home, /const form = document\.createElement\('form'\)/);
assert.match(home, /name\.minLength = 3/);
assert.match(home, /description\.minLength = 10/);
assert.match(home, /rules\.minLength = 10/);
assert.match(home, /Nothing will be created again; use Open created circle to retry\./);
assert.match(home, /const circle = await query\('circle', \{ circleId \}, \{ signal: controller\.signal \}\);[\s\S]*?state\.view = 'circle'/);

// Syllabus search is explicitly resettable and performance failures remain actionable.
assert.match(examinations, /data-subject-search-clear/);
assert.match(examinations, /function clearSubjectFilter\(trigger = null\)/);
assert.match(examinations, /document\.addEventListener\('search', handleInput, true\)/);
assert.match(examinations, /subjectPerformanceFailureMessage\(error\)/);
assert.match(examinations, /function isCurrentSubjectPerformanceRequest\(request\)/);
assert.match(examinations, /if \(!isCurrentSubjectPerformanceRequest\(performanceRequest\)\) return false;/);
assert.match(examinations, /Your saved answers and scores are unchanged/);
assert.match(examinations, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);

// Quick Drill and Doctrine inputs preserve work through failures and expose inline states.
for (const kind of ['easy', 'doctrine']) {
  assert.match(study, new RegExp(`id="dd26-${kind}-status"`));
  assert.match(study, new RegExp(`setAnswerStatus\\('${kind}'.*Nothing was cleared`, 's'));
}
assert.match(study, /answer\.dataset\.requestKey/);
assert.match(study, /function canCommitAnswerRequest\(request\)/);
assert.match(study, /if \(!canCommitAnswerRequest\(gradingRequest\)\) return;/);
assert.match(study, /setAnswerFlowBusy\('easy', true\)/);
assert.match(study, /setAnswerFlowBusy\('doctrine', true\)/);
assert.match(study, /if \(state\.busy \|\| !state\.filtered\.length\) return;/);

// Truthful exits, typography tokens, and minimum control sizing.
assert.match(html, /subject-selection-back[\s\S]*?>Back to Home<\/button>/);
assert.match(html, /modal-back[^>]*>Back to Home<\/button>/);
assert.match(html, /--serif-brand:'Cinzel'/);
assert.match(html, /--serif-display:'Fraunces'/);
assert.match(shellCss, /qfs-practice-rail button \{[\s\S]*?min-height:\s*44px/);
assert.match(shellCss, /quorum-nav-link,[\s\S]*?min-height:\s*48px/);
assert.match(shellCss, /\.quorum-entry-action \{[\s\S]*?font:\s*700 14px/);
assert.match(shellCss, /\.quorum-entry-legal \{[\s\S]*?font:\s*400 13px/);
assert.match(shellCss, /@media \(max-width: 560px\)[\s\S]*?\.quorum-entry-visual \{[\s\S]*?min-height:\s*max\(420px, 52svh\)/);
assert.match(shellCss, /@media \(max-width: 560px\)[\s\S]*?\.quorum-signin-intro-still img \{[\s\S]*?top:\s*28%/);
assert.match(homeCss, /lex-action\.quorum-icon-button \{[\s\S]*?min-height:\s*44px/);
assert.match(examinationsCss, /\.dd-subject-search-clear \{[\s\S]*?min-height:\s*48px/);
assert.match(studyCss, /\.dd26-answer-status\.is-error/);

console.log('Public Release 1 reliability checks passed.');
