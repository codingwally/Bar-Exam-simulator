import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/pedro-navigation.js', import.meta.url), 'utf8');

assert.match(source, /global\.DueDiligencePedroNavigation = Object\.freeze\(\{ open, restoreFromUrl, clearUrl \}\)/);
assert.match(source, /api\.request\('\/pedro\/query',[\s\S]*?operation: 'resolve_action',[\s\S]*?actionId: action\.id/);
assert.match(source, /navigation\.open\(destination\.feature, trigger \|\| null\)/);
assert.match(source, /openDoctrines[\s\S]*?detailId: action\.target\.contentId, routeDetail: false/);
assert.match(source, /openTargetedQuestion\(action\.target\)/);
assert.match(source, /opener\(action\.target\.subject, action\.target\.questionId\)/);
assert.match(source, /const OUTCOMES = Object\.freeze[\s\S]*?'opened'[\s\S]*?'busy'[\s\S]*?'terminal'[\s\S]*?'stale'[\s\S]*?'auth-required'[\s\S]*?'retryable'/);
assert.match(source, /getElementById\?\.\('public-navigation-status'\)/);
assert.match(source, /getElementById\?\.\('public-navigation-status-copy'\)/);
assert.match(source, /getElementById\?\.\('public-navigation-retry'\)/);
assert.match(source, /new global\.MutationObserver/);
assert.doesNotMatch(source, /['"]pedro-navigation-status['"]/);
assert.doesNotMatch(source, /provider|gemini/i);
assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(source, /location\.(?:assign|replace|reload)\s*\(|location\.href\s*=|window\.open\s*\(/);
assert.doesNotMatch(source, /target\.(?:url|href)|payload\.(?:url|href)/);

class FakeNode {
  constructor(tagName = '') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.onclick = null;
    this.listeners = new Map();
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index < 0) return null;
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    this.parentNode?.removeChild?.(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  click() {
    if (this.disabled) return;
    this.onclick?.({ target: this });
    for (const listener of this.listeners.get('click') || []) listener.call(this, { target: this });
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeNode('body');
    this.readyState = 'loading';
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  getElementById(id) {
    function find(node) {
      if (node.id === id) return node;
      for (const child of node.children || []) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    }
    return find(this.body);
  }
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node?.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

async function settle(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function assertOutcome(value, status) {
  assert.ok(value && typeof value === 'object', `Expected a structured ${status} outcome.`);
  assert.equal(value.status, status);
  assert.deepEqual(Object.keys(value), ['status']);
  assert.equal(Object.isFrozen(value), true);
}

const IDS = Object.freeze({
  doctrineAction: '123e4567-e89b-42d3-a456-426614174000',
  syllabusAction: '223e4567-e89b-42d3-a456-426614174001',
  mockAction: '323e4567-e89b-42d3-a456-426614174002',
  version: '423e4567-e89b-42d3-a456-426614174003',
  syllabusQuestion: '523e4567-e89b-42d3-a456-426614174004',
});

const LABELS = Object.freeze({
  doctrine: 'Open Doctrine Review',
  syllabus: 'Open Syllabus-Based Review',
  mock_bar: 'Open Bar Question Practice',
});

let activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
const historyCalls = [];
const requestCalls = [];
const publicCalls = [];
const doctrineCalls = [];
const syllabusCalls = [];
const mockCalls = [];
const windowListeners = new Map();
const fakeDocument = new FakeDocument();
const publicStatusRegion = new FakeNode('div');
publicStatusRegion.id = 'public-navigation-status';
publicStatusRegion.className = 'public-navigation-status';
publicStatusRegion.hidden = true;
publicStatusRegion.setAttribute('role', 'status');
publicStatusRegion.setAttribute('aria-live', 'polite');
const publicStatusCopy = new FakeNode('span');
publicStatusCopy.id = 'public-navigation-status-copy';
const publicStatusRetry = new FakeNode('button');
publicStatusRetry.id = 'public-navigation-retry';
publicStatusRetry.type = 'button';
publicStatusRetry.textContent = 'Try again';
publicStatusRetry.hidden = true;
publicStatusRegion.append(publicStatusCopy, publicStatusRetry);
fakeDocument.body.append(publicStatusRegion);

const manualTimers = [];
function controlledSetTimeout(callback, milliseconds) {
  const delay = Number(milliseconds) || 0;
  const token = {
    callback,
    delay,
    cleared: false,
    native: null,
    unref() {},
  };
  if (delay >= 1000) {
    manualTimers.push(token);
  } else if (delay === 0) {
    Promise.resolve().then(() => {
      if (!token.cleared) callback();
    });
  } else {
    token.native = setTimeout(() => {
      if (!token.cleared) callback();
    }, delay);
  }
  return token;
}

function controlledClearTimeout(token) {
  if (!token || typeof token !== 'object' || !Object.hasOwn(token, 'cleared')) {
    clearTimeout(token);
    return;
  }
  token.cleared = true;
  if (token.native) clearTimeout(token.native);
}

const mutationObservers = [];
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.connected = false;
    mutationObservers.push(this);
  }

  observe(target) {
    this.target = target;
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }
}

function flushMutationObservers() {
  for (const observer of mutationObservers) {
    if (observer.connected) observer.callback([], observer);
  }
}

let activeSession = { access_token: 'session-one', user: { id: 'member-one' } };
let requestHandler = async (_path, options) => {
  const { actionId } = options.body;
  if (actionId === IDS.doctrineAction) {
    return { ok: true, data: { action: { id: actionId, type: 'doctrine', target: { contentId: 'regalian-doctrine' } } } };
  }
  if (actionId === IDS.syllabusAction) {
    return {
      ok: true,
      data: { action: { id: actionId, type: 'syllabus', target: { versionId: IDS.version, questionId: IDS.syllabusQuestion } } },
    };
  }
  return {
    ok: true,
    data: { action: { id: actionId, type: 'mock_bar', target: { subject: 'Political Law', questionId: 'POL-2026-001' } } },
  };
};

const fakeLocation = {};
for (const key of ['href', 'origin', 'pathname', 'search', 'hash']) {
  Object.defineProperty(fakeLocation, key, { get: () => activeUrl[key] });
}

const fakeWindow = {
  document: fakeDocument,
  MutationObserver: FakeMutationObserver,
  navigator: { onLine: true },
  location: fakeLocation,
  history: {
    state: { kept: true },
    replaceState(state, _title, next) {
      const resolved = new URL(next, activeUrl);
      assert.equal(resolved.origin, 'https://duediligence.ph', 'Navigation state must remain same-origin.');
      this.state = state;
      activeUrl = resolved;
      historyCalls.push(resolved.href);
    },
  },
  setTimeout: controlledSetTimeout,
  clearTimeout: controlledClearTimeout,
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of windowListeners.get(event.type) || []) listener.call(fakeWindow, event);
  },
  DueDiligencePhase2: {
    getSession: () => activeSession,
    whenAuthReady: async () => true,
  },
  DueDiligencePhase4: {
    getSession: () => activeSession,
    async request(path, options) {
      requestCalls.push({ path, options });
      return requestHandler(path, options);
    },
  },
  DueDiligencePublicNavigation: {
    async open(feature, trigger) {
      publicCalls.push({ feature, trigger });
      return true;
    },
  },
  async openDoctrines(options) {
    doctrineCalls.push(options);
    return true;
  },
  DueDiligenceExaminations: {
    async openTargetedQuestion(target) {
      syllabusCalls.push(target);
      return true;
    },
  },
  async openQuorumMappedQuestion(subject, questionId) {
    mockCalls.push({ subject, questionId });
    return true;
  },
};
fakeWindow.window = fakeWindow;

const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  navigator: fakeWindow.navigator,
  URL,
  Object,
  Promise,
  Error,
  Set,
  WeakMap,
  Array,
  String,
  Number,
  Boolean,
  setTimeout,
  clearTimeout,
});
vm.runInContext(source, context, { filename: 'assets/pedro-navigation.js' });

const navigation = fakeWindow.DueDiligencePedroNavigation;
assert.ok(Object.isFrozen(navigation));
assert.deepEqual(Object.keys(navigation), ['open', 'restoreFromUrl', 'clearUrl']);
assert.equal(fakeDocument.getElementById('pedro-navigation-status'), null);
assert.equal(fakeDocument.getElementById('public-navigation-status'), publicStatusRegion);

const requestsBeforeInvalid = requestCalls.length;
assertOutcome(await navigation.open({ type: 'doctrine', label: LABELS.doctrine }), 'terminal');
assertOutcome(await navigation.open({ id: IDS.doctrineAction, type: 'external', label: 'Open website' }), 'terminal');
assertOutcome(
  await navigation.open({ id: IDS.doctrineAction, type: 'doctrine', label: LABELS.doctrine, href: 'https://evil.example' }),
  'terminal',
);
assert.equal(requestCalls.length, requestsBeforeInvalid, 'Invalid or expanded action objects must never reach the server.');
assert.equal(historyCalls.length, 0, 'Invalid actions must never navigate.');

const doctrineTrigger = new FakeNode('button');
assertOutcome(
  await navigation.open({ id: IDS.doctrineAction, type: 'doctrine', label: LABELS.doctrine }, doctrineTrigger),
  'opened',
);
assert.equal(requestCalls.at(-1).path, '/pedro/query');
assert.equal(requestCalls.at(-1).options.method, 'POST');
assert.deepEqual(
  JSON.parse(JSON.stringify(requestCalls.at(-1).options.body)),
  { operation: 'resolve_action', actionId: IDS.doctrineAction },
);
assert.deepEqual(publicCalls.at(-1), { feature: 'doctrines', trigger: doctrineTrigger });
assert.deepEqual(JSON.parse(JSON.stringify(doctrineCalls.at(-1))), {
  detailId: 'regalian-doctrine',
  routeDetail: false,
});
assert.equal(activeUrl.searchParams.get('kept'), 'yes');
assert.equal(activeUrl.searchParams.get('pedroAction'), IDS.doctrineAction);
assert.equal(activeUrl.hash, '#doctrines');
assert.equal(doctrineTrigger.disabled, false);
assert.equal(doctrineTrigger.getAttribute('aria-busy'), null);

assertOutcome(
  await navigation.open({ id: IDS.syllabusAction, type: 'syllabus', label: LABELS.syllabus }),
  'opened',
);
assert.deepEqual(publicCalls.at(-1), { feature: 'subject-matter', trigger: null });
assert.deepEqual(JSON.parse(JSON.stringify(syllabusCalls.at(-1))), {
  versionId: IDS.version,
  questionId: IDS.syllabusQuestion,
});
assert.equal(activeUrl.hash, '#subject-matter');

assertOutcome(await navigation.open({ id: IDS.mockAction, type: 'mock_bar', label: LABELS.mock_bar }), 'opened');
assert.deepEqual(publicCalls.at(-1), { feature: 'mock', trigger: null });
assert.deepEqual(mockCalls.at(-1), { subject: 'Political Law', questionId: 'POL-2026-001' });
assert.equal(activeUrl.hash, '#mock-bar');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.syllabusAction}#subject-matter`);
const syllabusBeforeRestore = syllabusCalls.length;
assertOutcome(await navigation.restoreFromUrl(), 'opened');
assert.equal(syllabusCalls.length, syllabusBeforeRestore + 1);
assert.equal(activeUrl.searchParams.get('pedroAction'), IDS.syllabusAction);

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.doctrineAction}#doctrines`);
requestHandler = async () => {
  const error = new Error('internal detail must not be shown');
  error.code = 'PEDRO_ACTION_NOT_FOUND';
  error.status = 404;
  throw error;
};
assertOutcome(await navigation.restoreFromUrl(), 'stale');
assert.equal(activeUrl.searchParams.has('pedroAction'), false, 'Stale action IDs must be cleared.');
assert.equal(activeUrl.searchParams.get('kept'), 'yes');
assert.equal(activeUrl.hash, '#doctrines');
let statusRegion = fakeDocument.getElementById('public-navigation-status');
let retryButton = fakeDocument.getElementById('public-navigation-retry');
let closeButton = fakeDocument.getElementById('pedro-navigation-dismiss');
assert.equal(statusRegion, publicStatusRegion, 'Pedro must reuse the one public navigation region.');
assert.equal(retryButton.hidden, true, 'Expired actions must not promise a retry.');
assert.equal(retryButton.disabled, true, 'A hidden Retry control must not be focusable.');
assert.equal(closeButton.hidden, false);
assert.equal(closeButton.disabled, false);
closeButton.onclick();
assert.equal(statusRegion.hidden, true, 'Close must dismiss the Pedro alert.');
assert.equal(fakeDocument.getElementById('pedro-navigation-dismiss'), null, 'Close must be removed after dismissal.');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.syllabusAction}#subject-matter`);
requestHandler = async () => {
  const error = new Error('private access detail');
  error.code = 'PEDRO_PAID_REQUIRED';
  error.status = 403;
  throw error;
};
assertOutcome(await navigation.restoreFromUrl(), 'terminal');
assert.equal(activeUrl.searchParams.has('pedroAction'), false, 'Access-denied action IDs must be cleared.');
publicStatusCopy.textContent = 'Opening Home…';
publicStatusRetry.hidden = true;
publicStatusRetry.disabled = false;
publicStatusRetry.onclick = null;
flushMutationObservers();
assert.equal(
  fakeDocument.getElementById('pedro-navigation-dismiss'),
  null,
  'Pedro Close must remove itself when the shared region is superseded.',
);
assert.equal(publicStatusCopy.textContent, 'Opening Home…');
assert.equal(publicStatusRetry.disabled, false, 'Pedro cleanup must not alter the next navigation owner’s Retry state.');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.syllabusAction}#subject-matter`);
requestHandler = async () => {
  const error = new Error('private active-attempt detail');
  error.code = 'PEDRO_ACTIVE_ATTEMPT';
  error.status = 409;
  throw error;
};
assertOutcome(await navigation.restoreFromUrl(), 'retryable');
assert.equal(activeUrl.searchParams.get('pedroAction'), IDS.syllabusAction, 'A recoverable active attempt must keep the opaque action ID.');
statusRegion = fakeDocument.getElementById('public-navigation-status');
assert.match(publicStatusCopy.textContent, /Finish or leave the current Syllabus-Based Review attempt/);
retryButton = fakeDocument.getElementById('public-navigation-retry');
assert.equal(retryButton.hidden, false);
assert.equal(retryButton.disabled, false);
assert.equal(fakeDocument.getElementById('pedro-navigation-dismiss').hidden, false);

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.doctrineAction}#doctrines`);
requestHandler = async () => {
  const error = new Error('private thread detail');
  error.code = 'PEDRO_THREAD_INVALID';
  error.status = 409;
  throw error;
};
assertOutcome(await navigation.restoreFromUrl(), 'terminal');
assert.equal(activeUrl.searchParams.has('pedroAction'), false, 'An invalid thread is terminal and must clear the stale action ID.');
const terminalTimer = manualTimers.findLast((timer) => timer.delay === 8000 && !timer.cleared);
assert.ok(terminalTimer, 'Terminal alerts must schedule a reasonable auto-clear timeout.');
terminalTimer.callback();
assert.equal(statusRegion.hidden, true, 'Terminal alerts must auto-clear.');
assert.equal(fakeDocument.getElementById('pedro-navigation-dismiss'), null);

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.mockAction}#mock-bar`);
requestHandler = async () => {
  const error = new Error('provider detail must not be shown');
  error.code = 'PEDRO_TIMEOUT';
  error.status = 503;
  throw error;
};
const mockBeforeRetry = mockCalls.length;
assertOutcome(await navigation.restoreFromUrl(), 'retryable');
assert.equal(activeUrl.searchParams.get('pedroAction'), IDS.mockAction, 'Transient failures must retain the opaque action ID.');
statusRegion = fakeDocument.getElementById('public-navigation-status');
assert.equal(statusRegion.getAttribute('role'), 'alert');
assert.doesNotMatch(publicStatusCopy.textContent, /provider|internal|gemini/i);
retryButton = fakeDocument.getElementById('public-navigation-retry');
assert.ok(retryButton && retryButton.hidden === false, 'Transient failures must expose a visible Retry control.');
requestHandler = async (_path, options) => ({
  ok: true,
  data: {
    action: {
      id: options.body.actionId,
      type: 'mock_bar',
      target: { subject: 'Political Law', questionId: 'POL-2026-001' },
    },
  },
});
await retryButton.onclick();
assert.equal(mockCalls.length, mockBeforeRetry + 1, 'Retry must reopen the same validated action.');

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
let releaseRequest;
requestHandler = (_path, options) => new Promise((resolve) => {
  releaseRequest = () => resolve({
    ok: true,
    data: { action: { id: options.body.actionId, type: 'doctrine', target: { contentId: 'regalian-doctrine' } } },
  });
});
const callsBeforeDuplicate = requestCalls.length;
const duplicateAction = { id: IDS.doctrineAction, type: 'doctrine', label: LABELS.doctrine };
const firstOpen = navigation.open(duplicateAction);
const duplicateOpen = navigation.open(duplicateAction);
await settle(2);
assert.equal(requestCalls.length, callsBeforeDuplicate + 1, 'Duplicate clicks must share one server resolution.');
releaseRequest();
assertOutcome(await firstOpen, 'opened');
assertOutcome(await duplicateOpen, 'opened');

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
let releaseBusy;
requestHandler = (_path, options) => new Promise((resolve) => {
  releaseBusy = () => resolve({
    ok: true,
    data: { action: { id: options.body.actionId, type: 'doctrine', target: { contentId: 'regalian-doctrine' } } },
  });
});
const busyOpen = navigation.open(duplicateAction);
await settle(2);
assertOutcome(
  await navigation.open({ id: IDS.syllabusAction, type: 'syllabus', label: LABELS.syllabus }),
  'busy',
);
assert.match(publicStatusCopy.textContent, /already opening/i);
assert.equal(fakeDocument.getElementById('public-navigation-retry').hidden, true);
releaseBusy();
assertOutcome(await busyOpen, 'opened');

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
let releaseStale;
requestHandler = (_path, options) => new Promise((resolve) => {
  releaseStale = () => resolve({
    ok: true,
    data: { action: { id: options.body.actionId, type: 'doctrine', target: { contentId: 'regalian-doctrine' } } },
  });
});
const publicBeforeAccountChange = publicCalls.length;
const staleOpen = navigation.open(duplicateAction);
await settle(2);
activeSession = { access_token: 'session-two', user: { id: 'member-two' } };
fakeWindow.dispatchEvent({ type: 'duediligence:session' });
releaseStale();
assertOutcome(await staleOpen, 'stale');
assert.equal(publicCalls.length, publicBeforeAccountChange, 'A response from the previous account must not dispatch.');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.syllabusAction}#subject-matter`);
activeSession = null;
fakeWindow.dispatchEvent({ type: 'duediligence:session' });
const requestsBeforeSignedOutRestore = requestCalls.length;
assertOutcome(await navigation.restoreFromUrl(), 'auth-required');
assert.equal(
  activeUrl.searchParams.get('pedroAction'),
  IDS.syllabusAction,
  'A valid signed-out deep link must remain intact through authentication.',
);
assert.equal(requestCalls.length, requestsBeforeSignedOutRestore, 'Signed-out restoration must not call the private resolver.');
assert.match(publicStatusCopy.textContent, /stay saved while you sign in/i);
assert.equal(publicStatusRetry.hidden, true, 'Authentication is not a retryable server failure.');
assert.equal(publicStatusRetry.disabled, true);

requestHandler = async (_path, options) => ({
  ok: true,
  data: {
    action: {
      id: options.body.actionId,
      type: 'syllabus',
      target: { versionId: IDS.version, questionId: IDS.syllabusQuestion },
    },
  },
});
const syllabusBeforeSignInResume = syllabusCalls.length;
activeSession = { access_token: 'session-three', user: { id: 'member-three' } };
fakeWindow.dispatchEvent({ type: 'duediligence:session' });
await settle(30);
assert.equal(
  syllabusCalls.length,
  syllabusBeforeSignInResume + 1,
  'The preserved deep link must resume automatically after the authenticated session arrives.',
);
assert.equal(activeUrl.searchParams.get('pedroAction'), IDS.syllabusAction);

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
requestHandler = async (_path, options) => ({
  ok: true,
  data: {
    action: {
      id: options.body.actionId,
      type: 'doctrine',
      target: { contentId: 'regalian-doctrine', url: 'https://evil.example/redirect' },
    },
  },
});
const publicBeforeInjectedUrl = publicCalls.length;
const historyBeforeInjectedUrl = historyCalls.length;
assertOutcome(await navigation.open(duplicateAction), 'retryable');
assert.equal(publicCalls.length, publicBeforeInjectedUrl, 'Expanded server targets must fail before public navigation.');
assert.equal(historyCalls.length, historyBeforeInjectedUrl, 'A server-provided URL must never become navigation state.');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.doctrineAction}#mock-bar`);
requestHandler = async (_path, options) => ({
  ok: true,
  data: {
    action: {
      id: options.body.actionId,
      type: 'doctrine',
      target: { contentId: 'regalian-doctrine' },
    },
  },
});
const callsBeforeMismatchedHash = requestCalls.length;
assertOutcome(await navigation.restoreFromUrl(), 'terminal');
assert.equal(requestCalls.length, callsBeforeMismatchedHash + 1, 'The server must resolve the opaque action before its type is trusted.');
assert.equal(activeUrl.searchParams.has('pedroAction'), false);

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
requestHandler = async () => {
  const error = new Error('expired private session detail');
  error.code = 'AUTHENTICATION_REQUIRED';
  error.status = 401;
  throw error;
};
assertOutcome(await navigation.open(duplicateAction), 'auth-required');
assert.equal(
  activeUrl.searchParams.get('pedroAction'),
  IDS.doctrineAction,
  'An action must stay resumable if authentication expires during resolution.',
);
assert.doesNotMatch(publicStatusCopy.textContent, /expired private session detail/i);
assert.equal(publicStatusRetry.hidden, true);
assert.equal(publicStatusRetry.disabled, true);

activeUrl = new URL(`https://duediligence.ph/?pedroAction=${IDS.doctrineAction}&pedroAction=${IDS.mockAction}#doctrines`);
const requestsBeforeMalformedUrl = requestCalls.length;
assertOutcome(await navigation.restoreFromUrl(), 'terminal');
assert.equal(activeUrl.searchParams.has('pedroAction'), false);
assert.equal(requestCalls.length, requestsBeforeMalformedUrl, 'Malformed duplicate action parameters must never reach the resolver.');

activeUrl = new URL('https://duediligence.ph/?kept=yes#quorum');
assertOutcome(await navigation.restoreFromUrl(), 'stale');

activeUrl = new URL(`https://duediligence.ph/?kept=yes&pedroAction=${IDS.doctrineAction}#doctrines`);
navigation.clearUrl();
assert.equal(activeUrl.searchParams.has('pedroAction'), false);
assert.equal(activeUrl.searchParams.get('kept'), 'yes');
assert.equal(activeUrl.hash, '#doctrines');
assert.ok(historyCalls.every((href) => href.startsWith('https://duediligence.ph/')));
assert.equal(
  fakeDocument.body.children.filter((node) => node.id === 'public-navigation-status').length,
  1,
  'Pedro must never create a second fixed navigation banner.',
);

console.log('Pedro navigation contract and safety regressions passed.');
