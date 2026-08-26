import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../assets/pedro.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../assets/pedro.css', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(source, /global\.DueDiligencePedro = Object\.freeze\(\{ mount, unmount, refresh, reset \}\)/);
assert.match(source, /post\('\/pedro\/query', \{[\s\S]*?operation: 'bootstrap',[\s\S]*?limit: inboxLimit/);
assert.match(source, /post\('\/pedro\/message', \{[\s\S]*?message: pending\.message,[\s\S]*?requestKey: pending\.requestKey/);
assert.match(source, /global\.DueDiligencePedroNavigation[\s\S]*?navigation\.open\(normalized, trigger\)/);
assert.match(source, /global\.DueDiligencePhase4\?\.request[\s\S]*?global\.DueDiligencePhase2\?\.request/);
assert.match(source, /new AbortController\(\)/);
assert.match(source, /request\.generation === state\.generation/);
assert.match(source, /request\.ownerId === currentUserId\(\)/);
assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(source, /error\?\.message|String\(error\.message|console\.|global\.toast/);
assert.doesNotMatch(source, /setAttribute\(['"]href|\.href\s*=|location\./);
assert.doesNotMatch(styles, /(^|\n)\.pedro-[^{]+\{/m, 'Pedro selectors must remain scoped to Home.');
assert.match(styles, /#page-community \.pedro-inbox/);
assert.match(styles, /var\(--home-navy\)/);
assert.match(styles, /min-height:\s*44px/);
assert.doesNotMatch(styles, /font-size:\s*(?:[0-9]|1[01])px/);
assert.match(styles, /#page-community \.pedro-thread\s*\{[\s\S]*?max-height:\s*min\([^}]+overflow-y:\s*auto/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

const homeToolsMarkup = indexSource.match(
  /<details\b[^>]*\bid=["']quorum-home-tools-menu["'][^>]*>[\s\S]*?<\/details>/i,
)?.[0] || '';
assert.match(homeToolsMarkup, /<summary>\s*Home tools\s*<\/summary>/i);
assert.match(homeToolsMarkup, /<button\b[^>]*\bdata-quorum-view=["']pedro["'][^>]*>\s*Pedro\s*<\/button>/i);
assert.doesNotMatch(homeToolsMarkup, /\bhidden\b/i, 'The public Home tools menu must not hide Pedro.');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    const values = this.values();
    names.forEach((name) => values.add(name));
    this.owner.className = [...values].join(' ');
  }

  contains(name) {
    return this.values().has(name);
  }
}

class FakeNode {
  constructor(tagName = '', nodeType = 1) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = nodeType;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.nodeType === 11) {
        this.append(...node.children);
        node.children = [];
        continue;
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children.forEach((node) => { node.parentNode = null; });
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
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

  querySelectorAll(selector) {
    const classNames = String(selector)
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^\.[a-z0-9_-]+$/i.test(part))
      .map((part) => part.slice(1));
    return findAll(this, (node) => classNames.some((className) => node.classList?.contains(className)));
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return !event.defaultPrevented;
  }

  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }

  focus() {
    fakeDocument.activeElement = this;
  }

  scrollTo(options) {
    this.scrollTop = typeof options === 'number' ? options : Number(options?.top || 0);
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  createDocumentFragment() {
    return new FakeNode('', 11);
  }
}

function textOf(node) {
  return `${node?.textContent || ''}${(node?.children || []).map(textOf).join('')}`;
}

function findAll(node, predicate, output = []) {
  if (predicate(node)) output.push(node);
  for (const child of node?.children || []) findAll(child, predicate, output);
  return output;
}

function byClass(node, className) {
  return findAll(node, (item) => item.classList?.contains(className));
}

function byTag(node, tagName) {
  return findAll(node, (item) => item.tagName === tagName.toUpperCase());
}

function buttonWithText(node, label) {
  return byTag(node, 'button').find((button) => textOf(button) === label);
}

async function settle(rounds = 5) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

const fakeDocument = new FakeDocument();
const windowListeners = new Map();
let activeSession = { access_token: 'signed-token', user: { id: 'member-one' } };
let requestHandler = async () => ({ ok: true, data: { threadId: 'thread_one', messages: [] } });
let navigationHandler = async () => ({ status: 'opened' });
const requests = [];
const navigationCalls = [];

const fakeWindow = {
  document: fakeDocument,
  navigator: { onLine: true },
  crypto: webcrypto,
  Intl,
  Date,
  AbortController,
  Math,
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of windowListeners.get(event.type) || []) listener.call(fakeWindow, event);
  },
  DueDiligencePhase4: {
    getSession: () => activeSession,
    request(path, options) {
      requests.push({ path, options });
      return requestHandler(path, options);
    },
  },
  DueDiligencePedroNavigation: {
    async open(action, trigger) {
      navigationCalls.push({ action, trigger });
      return navigationHandler(action, trigger);
    },
  },
};
fakeWindow.window = fakeWindow;

const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  navigator: fakeWindow.navigator,
  crypto: webcrypto,
  Intl,
  Date,
  AbortController,
  Math,
  console,
  setTimeout,
  clearTimeout,
});
vm.runInContext(source, context, { filename: 'assets/pedro.js' });

const Pedro = fakeWindow.DueDiligencePedro;
assert.ok(Object.isFrozen(Pedro));
assert.deepEqual(Object.keys(Pedro), ['mount', 'unmount', 'refresh', 'reset']);

const container = new FakeNode('div');
let resolveInitialInbox;
requestHandler = () => new Promise((resolve) => { resolveInitialInbox = resolve; });
const mountPromise = Pedro.mount({ container });

assert.equal(container.getAttribute('aria-busy'), 'true');
assert.match(textOf(container), /Loading your Pedro inbox/);
assert.equal(byTag(container, 'textarea')[0].disabled, true);
assert.equal(byClass(container, 'pedro-message--loading').length, 2);
assert.equal(requests[0].path, '/pedro/query');
assert.equal(requests[0].options.method, 'POST');
assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options.body)), { operation: 'bootstrap', limit: 50 });
assert.ok(requests[0].options.signal instanceof AbortSignal);

resolveInitialInbox({ ok: true, data: { threadId: 'thread_one', messages: [] } });
assert.equal(await mountPromise, true);
assert.equal(container.getAttribute('aria-busy'), 'false');
assert.equal(container.children[0].dataset.state, 'empty');
assert.match(textOf(container), /Start with one focused question/);
assert.match(textOf(container), /replies only here on DueDiligence\.ph/);
assert.ok(buttonWithText(container, 'Review a doctrine'));
assert.ok(buttonWithText(container, 'Find a syllabus topic'));
assert.ok(buttonWithText(container, 'Find a practice question'));
assert.equal(byTag(container, 'textarea')[0].maxLength, 1000);
assert.equal(byClass(container, 'pedro-thread')[0].getAttribute('aria-live'), null);
assert.equal(byClass(container, 'pedro-status')[0].getAttribute('aria-live'), 'polite');

buttonWithText(container, 'Review a doctrine').click();
await settle();
assert.equal(navigationCalls.length, 0);
assert.equal(byTag(container, 'textarea')[0].value, 'I want to review a doctrine.');
assert.match(textOf(container), /study question is ready to send/i);

const actionId = '123e4567-e89b-42d3-a456-426614174000';
const leakedDetail = `${['Gem', 'ini'].join('')} RESOURCE_EXHAUSTED model-id`;
requestHandler = async (path) => {
  assert.equal(path, '/pedro/query');
  return {
    ok: true,
    data: {
      threadId: 'thread_one',
      messages: [
        {
          id: 'welcome',
          role: 'pedro',
          text: 'Let us work through the issue carefully.',
          createdAt: '2026-08-27T08:00:00.000Z',
          actions: [{
            type: 'doctrine',
            label: 'Open the doctrine',
            id: actionId,
            subject: 'Civil Law',
            href: 'https://untrusted.example',
            selector: '#untrusted',
          }],
        },
        {
          id: 'internal-detail',
          role: 'pedro',
          text: leakedDetail,
          actions: [],
        },
      ],
    },
  };
};
assert.equal(await Pedro.refresh(), true);
assert.equal(container.children[0].dataset.state, 'populated');
assert.doesNotMatch(textOf(container), new RegExp(leakedDetail, 'i'));
buttonWithText(container, 'Open the doctrine').click();
await settle();
const dispatchedAction = navigationCalls.at(-1).action;
assert.deepEqual(
  JSON.parse(JSON.stringify(dispatchedAction)),
  { type: 'doctrine', label: 'Open the doctrine', id: actionId, subject: 'Civil Law' },
);
assert.equal('href' in dispatchedAction, false);
assert.equal('selector' in dispatchedAction, false);
assert.match(textOf(byClass(container, 'pedro-status')[0]), /Study feature opened/);

let resolveActionNavigation;
navigationHandler = () => new Promise((resolve) => { resolveActionNavigation = resolve; });
const busySuggestionProbe = new FakeNode('button');
busySuggestionProbe.className = 'lex-button pedro-suggestion';
const busyRetryProbe = new FakeNode('button');
busyRetryProbe.className = 'lex-button pedro-retry';
container.children[0].append(busySuggestionProbe, busyRetryProbe);
buttonWithText(container, 'Open the doctrine').click();
await settle();
assert.equal(container.getAttribute('aria-busy'), 'true');
assert.equal(byTag(container, 'textarea')[0].disabled, true);
assert.ok(byClass(container, 'pedro-action').length > 0);
assert.ok(
  findAll(
    container,
    (node) => ['pedro-action', 'pedro-suggestion', 'pedro-retry']
      .some((className) => node.classList?.contains(className)),
  ).every((control) => control.disabled),
  'Every rendered Pedro action, suggestion, and retry control must be disabled while an action is opening.',
);
resolveActionNavigation({ status: 'opened' });
await settle(8);
assert.equal(container.getAttribute('aria-busy'), 'false');
assert.ok(byClass(container, 'pedro-action').every((control) => !control.disabled));
busySuggestionProbe.remove();
busyRetryProbe.remove();

let messageAttempt = 0;
let rejectFirstSend;
let resolveRetry;
requestHandler = (path) => {
  assert.equal(path, '/pedro/message');
  messageAttempt += 1;
  if (messageAttempt === 1) {
    return new Promise((resolve, reject) => {
      rejectFirstSend = () => {
        const error = new Error(leakedDetail);
        error.code = 'REQUEST_FAILED';
        reject(error);
      };
    });
  }
  return new Promise((resolve) => {
    resolveRetry = () => resolve({
      ok: true,
      data: {
        message: {
          id: 'reply-one',
          role: 'pedro',
          text: 'A good first step is to identify the controlling doctrine.',
          actions: [],
          createdAt: '2026-08-27T08:05:00.000Z',
        },
      },
    });
  });
};

const input = byTag(container, 'textarea')[0];
const form = byTag(container, 'form')[0];
input.value = 'How should I begin this analysis?';
input.dispatchEvent({ type: 'input' });
form.dispatchEvent({ type: 'submit' });
form.dispatchEvent({ type: 'submit' });
await settle();

const firstMessageCall = requests.filter((request) => request.path === '/pedro/message')[0];
assert.equal(firstMessageCall.options.method, 'POST');
assert.equal(
  requests.filter((request) => request.path === '/pedro/message').length,
  1,
  'Repeated submit events while sending must produce one request.',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(firstMessageCall.options.body.message)),
  'How should I begin this analysis?',
);
assert.match(firstMessageCall.options.body.requestKey, /^pedro_[a-z0-9]+$/i);
assert.equal(container.getAttribute('aria-busy'), 'true');
assert.equal(input.disabled, true);
assert.ok(
  findAll(
    container,
    (node) => ['pedro-action', 'pedro-suggestion', 'pedro-retry']
      .some((className) => node.classList?.contains(className)),
  ).every((control) => control.disabled),
  'Every rendered Pedro action, suggestion, and retry control must be disabled while sending.',
);
rejectFirstSend();
await settle(8);
assert.equal(input.value, 'How should I begin this analysis?', 'A failed send must preserve the draft.');
assert.match(textOf(container), /Nothing was cleared/);
assert.doesNotMatch(textOf(container), new RegExp(leakedDetail, 'i'));

const messageRetry = buttonWithText(container, 'Try sending again');
assert.ok(messageRetry);
messageRetry.click();
await settle();
assert.equal(container.children[0].dataset.state, 'retrying');
assert.match(textOf(container), /Trying again/);
assert.equal(container.getAttribute('aria-busy'), 'true');
assert.ok(
  findAll(
    container,
    (node) => ['pedro-action', 'pedro-suggestion', 'pedro-retry']
      .some((className) => node.classList?.contains(className)),
  ).every((control) => control.disabled),
  'No Pedro control may remain enabled during a retry send.',
);
resolveRetry();
await settle(8);
const messageCalls = requests.filter((request) => request.path === '/pedro/message');
assert.equal(messageCalls.length, 2);
assert.equal(
  messageCalls[0].options.body.requestKey,
  messageCalls[1].options.body.requestKey,
  'A retry must reuse the original request key.',
);
assert.equal(input.value, '', 'The draft may clear only after an accepted reply.');
assert.equal(byClass(container, 'pedro-message--user').length, 1);
assert.equal(
  byClass(container, 'pedro-message--pedro').filter((node) => textOf(node).includes('controlling doctrine')).length,
  1,
  'A successful retry must append exactly one reply.',
);

const longInboxMessages = Array.from({ length: 50 }, (_, index) => ({
  id: `history-${index + 1}`,
  role: index % 2 === 0 ? 'user' : 'pedro',
  text: `Saved study message ${index + 1}.`,
  actions: index === 49
    ? [{ type: 'doctrine', label: 'Open saved doctrine', id: actionId, subject: 'Civil Law' }]
    : [],
  createdAt: `2026-08-27T08:${String(index).padStart(2, '0')}:00.000Z`,
}));
requestHandler = async (path) => {
  assert.equal(path, '/pedro/query');
  return { ok: true, data: { threadId: 'thread_long', messages: longInboxMessages } };
};
assert.equal(await Pedro.refresh(), true);
assert.equal(byClass(container, 'pedro-message').length, 50);
const longThread = byClass(container, 'pedro-thread')[0];
const jumpToLatest = buttonWithText(container, 'Jump to latest');
assert.equal(longThread.getAttribute('aria-live'), null, 'The full 50-message history must not be a live region.');
assert.ok(jumpToLatest);
longThread.scrollHeight = 2400;
longThread.clientHeight = 420;
longThread.scrollTop = 0;
longThread.dispatchEvent({ type: 'scroll' });
assert.equal(jumpToLatest.hidden, false, 'Jump to latest must appear when a long inbox is scrolled away from the end.');
jumpToLatest.click();
assert.equal(longThread.scrollTop, longThread.scrollHeight);
assert.equal(jumpToLatest.hidden, true);

let resolveLoggedOutAction;
navigationHandler = () => new Promise((resolve) => { resolveLoggedOutAction = resolve; });
buttonWithText(container, 'Open saved doctrine').click();
await settle();
assert.equal(container.getAttribute('aria-busy'), 'true');
activeSession = null;
fakeWindow.dispatchEvent({ type: 'duediligence:session', detail: { authenticated: false } });
await settle();
assert.match(textOf(container), /Sign in to use Pedro/);
resolveLoggedOutAction({ status: 'opened' });
await settle(8);
assert.match(textOf(container), /Sign in to use Pedro/);
assert.doesNotMatch(
  textOf(byClass(container, 'pedro-status')[0]),
  /Study feature opened/,
  'A navigation callback owned by the logged-out account must not repaint Pedro.',
);

activeSession = { access_token: 'signed-token', user: { id: 'member-one' } };
requestHandler = async (path) => {
  assert.equal(path, '/pedro/query');
  return { ok: true, data: { threadId: 'thread_owner_one', messages: longInboxMessages } };
};
fakeWindow.dispatchEvent({ type: 'duediligence:session', detail: { authenticated: true } });
await settle(8);
assert.ok(buttonWithText(container, 'Open saved doctrine'));

let resolvePreviousAccountAction;
navigationHandler = () => new Promise((resolve) => { resolvePreviousAccountAction = resolve; });
buttonWithText(container, 'Open saved doctrine').click();
await settle();
assert.equal(container.getAttribute('aria-busy'), 'true');
activeSession = { access_token: 'other-token', user: { id: 'member-two' } };
requestHandler = async (path) => {
  assert.equal(path, '/pedro/query');
  return {
    ok: true,
    data: {
      threadId: 'thread_owner_two',
      messages: [{
        id: 'owner-two-message',
        role: 'pedro',
        text: 'This is the current account inbox.',
        actions: [{ type: 'doctrine', label: 'Open current doctrine', id: actionId, subject: 'Civil Law' }],
      }],
    },
  };
};
fakeWindow.dispatchEvent({ type: 'duediligence:session', detail: { authenticated: true } });
await settle(8);
assert.match(textOf(container), /This is the current account inbox/);
resolvePreviousAccountAction({ status: 'opened' });
await settle(8);
assert.match(textOf(container), /This is the current account inbox/);
assert.doesNotMatch(
  textOf(byClass(container, 'pedro-status')[0]),
  /Study feature opened/,
  'A navigation callback owned by a previous account must not repaint the current account.',
);

navigationHandler = async () => true;
buttonWithText(container, 'Open current doctrine').click();
await settle(8);
assert.doesNotMatch(textOf(byClass(container, 'pedro-status')[0]), /Study feature opened/);
assert.match(textOf(container), /That study feature could not be opened/);
const actionRetry = buttonWithText(container, 'Try again');
assert.ok(actionRetry, 'A legacy boolean navigation result must be treated as retryable, not as success.');

let resolveStructuredRetry;
navigationHandler = () => new Promise((resolve) => { resolveStructuredRetry = resolve; });
actionRetry.click();
await settle();
assert.equal(container.getAttribute('aria-busy'), 'true');
assert.ok(
  findAll(
    container,
    (node) => ['pedro-action', 'pedro-suggestion', 'pedro-retry']
      .some((className) => node.classList?.contains(className)),
  ).every((control) => control.disabled),
  'All Pedro controls, including the visible action retry, must be disabled during navigation.',
);
resolveStructuredRetry({ status: 'opened' });
await settle(8);
assert.match(textOf(byClass(container, 'pedro-status')[0]), /Study feature opened/);
assert.equal(byClass(container, 'pedro-error').length, 0, 'A successful structured retry must clear its stale error panel.');

const requestCountBeforeOffline = requests.length;
fakeWindow.navigator.onLine = false;
assert.equal(await Pedro.refresh(), false);
assert.equal(requests.length, requestCountBeforeOffline, 'Offline refresh must not call the Worker.');
assert.match(textOf(container), /You are offline/);
fakeWindow.navigator.onLine = true;

let resolveStaleInbox;
requestHandler = () => new Promise((resolve) => { resolveStaleInbox = resolve; });
const staleRefresh = Pedro.refresh();
assert.equal(container.getAttribute('aria-busy'), 'true');
Pedro.unmount();
assert.equal(container.children.length, 0);
assert.equal(container.getAttribute('aria-busy'), 'false');
resolveStaleInbox({
  ok: true,
  data: {
    threadId: 'thread_stale',
    messages: [{ id: 'stale', role: 'pedro', text: 'This must not render.', actions: [] }],
  },
});
assert.equal(await staleRefresh, false);
assert.equal(container.children.length, 0, 'A late response must not repaint an unmounted Home view.');

requestHandler = async () => ({ ok: true, data: { threadId: 'thread_two', messages: [] } });
activeSession = { access_token: 'other-token', user: { id: 'member-two' } };
assert.equal(await Pedro.mount({ container }), true);
assert.doesNotMatch(textOf(container), /How should I begin this analysis/);
fakeWindow.dispatchEvent({ type: 'duediligence:session', detail: { authenticated: false } });
await settle();
assert.match(textOf(container), /Sign in to use Pedro/);

Pedro.reset();
Pedro.unmount();
console.log('Pedro frontend contract, privacy, accessibility, retry, and stale-response tests passed.');
