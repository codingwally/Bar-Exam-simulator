import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const phase2Source = await readFile(
  new URL('../assets/phase2-experience.js', import.meta.url),
  'utf8',
);
const examinationsSource = await readFile(
  new URL('../assets/examinations.js', import.meta.url),
  'utf8',
);

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

function fakeElement(id = '') {
  return {
    id,
    classList: new FakeClassList(),
    dataset: {},
    hidden: false,
    disabled: false,
    isConnected: true,
    textContent: '',
    className: '',
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    focus() {
      document.activeElement = this;
    },
    querySelector() {
      return null;
    },
  };
}

const windowListeners = new Map();
const documentListeners = new Map();
const body = fakeElement('body');
const focusOrigin = fakeElement('focus-origin');
focusOrigin.offsetParent = {};
const hiddenFocusOrigin = fakeElement('hidden-focus-origin');
hiddenFocusOrigin.offsetParent = null;
hiddenFocusOrigin.getClientRects = () => [];
const menuButton = fakeElement('site-menu-toggle');
menuButton.offsetParent = {};
const googleButton = fakeElement('dd2-google-signin');
const closeButton = fakeElement('dd2-entry-close');
const overlay = fakeElement('dd2-entry-overlay');
overlay.setAttribute('aria-hidden', 'true');
overlay.querySelector = () => googleButton;

const elements = new Map([
  ['dd2-entry-overlay', overlay],
  ['dd2-entry-close', closeButton],
  ['dd2-google-signin', googleButton],
  ['site-menu-toggle', menuButton],
]);

const document = {
  readyState: 'loading',
  body,
  activeElement: focusOrigin,
  cookie: '',
  addEventListener(type, callback) {
    const callbacks = documentListeners.get(type) || [];
    callbacks.push(callback);
    documentListeners.set(type, callbacks);
  },
  getElementById(id) {
    return elements.get(id) || null;
  },
  querySelector(selector) {
    if (selector === '.dd2-overlay.is-open') {
      return overlay.classList.contains('is-open') ? overlay : null;
    }
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

const location = {
  hash: '',
  href: 'https://example.test/',
  pathname: '/',
  search: '',
};
const history = {
  state: null,
  replaceState() {},
};
const storage = new Map();
const sessionStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

const window = {
  DueDiligencePhase2Config: {
    guest: {},
    legal: {},
    features: {},
  },
  document,
  location,
  history,
  addEventListener(type, callback) {
    const callbacks = windowListeners.get(type) || [];
    callbacks.push(callback);
    windowListeners.set(type, callbacks);
  },
  dispatchEvent() {},
  syncModalIsolation() {},
};

const context = vm.createContext({
  window,
  document,
  location,
  history,
  sessionStorage,
  localStorage: sessionStorage,
  navigator: { onLine: true },
  crypto: webcrypto,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  requestAnimationFrame: (callback) => callback(),
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  CustomEvent: class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  },
});

vm.runInContext(phase2Source, context, {
  filename: 'assets/phase2-experience.js',
});
await window.DueDiligencePhase2.initialize();

const dispatchPopstate = () => {
  for (const callback of windowListeners.get('popstate') || []) callback({ type: 'popstate' });
};

window.DueDiligencePhase2.openSignIn({ routeBound: true });
assert.equal(overlay.classList.contains('is-open'), true);
assert.equal(overlay.dataset.routeBound, 'true');
assert.equal(body.classList.contains('dd2-locked'), true);

location.hash = '';
dispatchPopstate();
assert.equal(
  overlay.classList.contains('is-open'),
  false,
  'Back navigation away from a protected route must dismiss its authentication entry.',
);
assert.equal(body.classList.contains('dd2-locked'), false);
assert.equal(document.activeElement, focusOrigin);

location.hash = '#subject-matter';
dispatchPopstate();
assert.equal(
  overlay.classList.contains('is-open'),
  true,
  'Forward navigation back to a protected route must restore authentication entry.',
);
assert.equal(body.classList.contains('dd2-locked'), true);

location.hash = '';
dispatchPopstate();
window.DueDiligencePhase2.openSignIn({ allowDismiss: true });
dispatchPopstate();
assert.equal(
  overlay.classList.contains('is-open'),
  true,
  'History navigation must not dismiss an authentication entry unrelated to a protected route.',
);

document.activeElement = hiddenFocusOrigin;
window.DueDiligencePhase2.openSignIn({ routeBound: true });
location.hash = '';
dispatchPopstate();
assert.equal(
  document.activeElement,
  menuButton,
  'Closing a route-bound entry after its mobile navigation trigger is hidden must restore focus to the visible menu control.',
);

assert.match(
  examinationsSource,
  /openSignIn\?\.\(\{\s*routeBound:\s*true\s*\}\)/,
  'The protected examination catalog must identify its authentication entry as route-bound.',
);
assert.match(
  html,
  /assets\/phase2-experience\.js\?v=auth-admission-20260801-1/,
  'The route-overlay fix must ship behind a fresh browser cache key.',
);
assert.match(
  html,
  /assets\/examinations\.js\?v=qa-cycle-20260731-1/,
  'The protected examination-route fix must ship behind a fresh browser cache key.',
);

console.log('Authentication route-overlay behavioral regression passed.');
