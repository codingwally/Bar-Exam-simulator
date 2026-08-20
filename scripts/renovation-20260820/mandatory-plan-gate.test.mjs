import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const phase4Source = readFileSync(
  new URL('../../assets/phase4-experience.js', import.meta.url),
  'utf8',
);
const featureLoaderSource = readFileSync(
  new URL('../../assets/feature-loader.js', import.meta.url),
  'utf8',
);
const phase2Source = readFileSync(
  new URL('../../assets/phase2-experience.js', import.meta.url),
  'utf8',
);

function fakeControl(id) {
  const attributes = new Map();
  return {
    id,
    hidden: false,
    disabled: false,
    style: {},
    classList: {
      contains: () => false,
      toggle() {},
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    toggleAttribute(name, force) {
      if (force) attributes.set(name, '');
      else attributes.delete(name);
    },
    focus() {},
  };
}

function phase4Harness(access, { authenticated = true } = {}) {
  const controls = new Map([
    ['dd2-native-close', fakeControl('dd2-native-close')],
    ['dd2-native-back', fakeControl('dd2-native-back')],
    ['dd2-native-view', fakeControl('dd2-native-view')],
  ]);
  const calls = {
    fetch: 0,
    openSignIn: [],
    openView: [],
    toasts: [],
  };
  const location = {
    hash: '#subject-matter',
    href: 'https://duediligence.test/#subject-matter',
    origin: 'https://duediligence.test',
    pathname: '/',
  };
  const document = {
    body: null,
    visibilityState: 'visible',
    addEventListener() {},
    getElementById(id) {
      return controls.get(id) || null;
    },
  };
  const listeners = new Map();
  const legacy = {
    getSession: () => (authenticated ? { access_token: 'test-access-token' } : null),
    openSignIn(options) {
      calls.openSignIn.push(options);
    },
    openView(view) {
      calls.openView.push(view);
    },
    refreshSession: async () => false,
  };
  const window = {
    DueDiligencePhase2: legacy,
    DueDiligencePhase2Config: { workerUrl: 'https://worker.test' },
    DueDiligencePrivateBeta: { accessHeaders: () => ({}) },
    document,
    location,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    dispatchEvent() {},
    toast(message, type) {
      calls.toasts.push({ message, type });
    },
  };

  const context = vm.createContext({
    window,
    document,
    location,
    URL,
    crypto: webcrypto,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    fetch: async () => {
      calls.fetch += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, access }),
      };
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    clearTimeout,
    FormData: class FormData {},
    MutationObserver: class MutationObserver {},
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    console,
  });

  vm.runInContext(phase4Source, context, {
    filename: 'assets/phase4-experience.js',
  });
  return { calls, controls, phase4: window.DueDiligencePhase4 };
}

function featureLoaderHarness({ access, ensureResult }) {
  const appendedAssets = [];
  const showPageCalls = [];
  const ensureCalls = [];

  function assetElement(tagName) {
    const listeners = new Map();
    return {
      tagName,
      dataset: {},
      addEventListener(type, callback) {
        listeners.set(type, callback);
      },
      dispatch(type) {
        listeners.get(type)?.();
      },
    };
  }

  function appendAsset(element) {
    appendedAssets.push(element.src || element.href || element.tagName);
    element.dispatch('load');
  }

  const document = {
    styleSheets: [],
    createElement: assetElement,
    head: { append: appendAsset },
    body: { append: appendAsset },
  };
  const location = { href: 'https://duediligence.test/' };
  const window = {
    DueDiligencePhase4: {
      getAccess: () => access,
      ensureProtectedAccess: async (routeHash) => {
        ensureCalls.push(routeHash);
        return ensureResult;
      },
    },
    showPage(...args) {
      showPageCalls.push(args);
      return 'protected-page-opened';
    },
    toast() {},
  };

  vm.runInNewContext(featureLoaderSource, {
    window,
    document,
    location,
    URL,
    console,
    Promise,
  }, { filename: 'assets/feature-loader.js' });

  return {
    appendedAssets,
    ensureCalls,
    loader: window.DueDiligenceFeatureLoader,
    showPage: window.showPage,
    showPageCalls,
  };
}

const unresolvedChoiceSnapshot = Object.freeze({
  allowed: true,
  basis: 'plan_selection_required',
  choiceRequired: true,
  planSelectionRequired: true,
  commercialLaunchEnabled: true,
  profileCompleted: true,
  termsRequired: false,
});

test('an unresolved mandatory choice outranks a contradictory allowed flag', async () => {
  const { phase4 } = phase4Harness(unresolvedChoiceSnapshot);

  const allowed = await phase4.ensureProtectedAccess('#subject-matter');

  assert.equal(
    allowed,
    false,
    'protected UI must remain closed until the authenticated user explicitly chooses a plan',
  );
});

test('the mandatory plan choice hides and disables every native dismissal control', async () => {
  const { calls, controls, phase4 } = phase4Harness(unresolvedChoiceSnapshot);

  await phase4.ensureProtectedAccess('#subject-matter');

  assert.ok(calls.openView.includes('pricing'), 'the unresolved choice must open the plan view');
  for (const id of ['dd2-native-close', 'dd2-native-back']) {
    const control = controls.get(id);
    assert.equal(control.hidden, true, `${id} must be hidden while plan choice is mandatory`);
    assert.equal(control.disabled, true, `${id} must be disabled while plan choice is mandatory`);
    assert.equal(control.getAttribute('aria-hidden'), 'true', `${id} must be hidden from assistive technology`);
  }
  assert.equal(
    controls.get('dd2-native-view').getAttribute('data-access-choice-required'),
    '',
    'the plan view must expose its mandatory state',
  );
});

test('backdrop, Escape, and browser history cannot dismiss the mandatory plan choice', () => {
  assert.match(
    phase2Source,
    /function mandatoryAccessChoiceOpen\(\)[\s\S]*data-access-choice-required/,
  );
  assert.match(
    phase2Source,
    /function closeNativeView\(\)\s*\{\s*if \(mandatoryAccessChoiceOpen\(\)\)/,
  );
  assert.match(
    phase2Source,
    /addEventListener\('popstate',[\s\S]*if \(mandatoryAccessChoiceOpen\(\)\)[\s\S]*renderNativeView\('pricing'/,
  );
  assert.match(
    phase2Source,
    /event\.target === event\.currentTarget && state\.nativeView\) closeNativeView\(\)/,
  );
});

test('a completed choice with allowed access can enter protected UI', async () => {
  const { phase4 } = phase4Harness({
    allowed: true,
    basis: 'daily_free',
    choiceRequired: false,
    planSelectionRequired: false,
    commercialLaunchEnabled: true,
    profileCompleted: true,
    termsRequired: false,
  });

  assert.equal(await phase4.ensureProtectedAccess('#subject-matter'), true);
});

test('the page router cannot open from a stale cached allowed flag while choice is unresolved', async () => {
  const harness = featureLoaderHarness({
    access: unresolvedChoiceSnapshot,
    ensureResult: false,
  });

  harness.showPage('mock', null);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    harness.showPageCalls.length,
    0,
    'a cached allowed flag must not bypass the mandatory-choice decision',
  );
});

test('protected feature assets are not loaded until the access gate succeeds', async () => {
  const harness = featureLoaderHarness({
    access: unresolvedChoiceSnapshot,
    ensureResult: false,
  });
  const assetsBeforeAttempt = harness.appendedAssets.length;

  const loaded = await harness.loader.loadForFeature('subject-matter');

  assert.equal(loaded, false);
  assert.deepEqual(harness.ensureCalls, ['#subject-matter']);
  assert.equal(
    harness.appendedAssets.length,
    assetsBeforeAttempt,
    'protected scripts and styles must remain unloaded behind the plan gate',
  );
});
