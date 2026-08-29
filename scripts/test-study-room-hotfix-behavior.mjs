import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [previewClient, liveClient] = await Promise.all([
  readFile(path.join(root, 'assets/study-room-preview.js'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.js'), 'utf8'),
]);

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeHTMLElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.queryChildren = new Map();
  }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
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

  querySelector(selector) {
    if (!this.queryChildren.has(selector)) {
      this.queryChildren.set(selector, new FakeHTMLElement(`${this.id}:${selector}`));
    }
    return this.queryChildren.get(selector);
  }

  querySelectorAll() {
    return [];
  }

  replaceChildren(...children) {
    this.children = [...children];
    if (!children.length) this.value = '';
  }

  append(child) {
    this.children.push(child);
    if (this.children.length === 1) this.value = child.value;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked = true;
  }

  pause() {}

  async play() {}

  scrollIntoView() {}
}

class FakeOption {
  constructor(label, value) {
    this.label = label;
    this.text = label;
    this.textContent = label;
    this.value = value;
  }
}

function createDocument() {
  const elements = new Map();
  const listeners = new Map();
  const studyRoomTriggers = [
    new FakeHTMLElement('desktop-study-room-trigger'),
    new FakeHTMLElement('spa-study-room'),
  ];
  elements.set('spa-study-room', studyRoomTriggers[1]);
  const document = {
    readyState: 'complete',
    activeElement: null,
    body: new FakeHTMLElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeHTMLElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '[data-study-room-trigger]') return studyRoomTriggers;
      return [];
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    emit(type, event) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    studyRoomTriggers,
  };
  return { document, elements };
}

function fireStudyRoomClick(document) {
  const trigger = new FakeHTMLElement('study-room-trigger');
  let closestCalls = 0;
  const event = {
    target: {
      closest(selector) {
        closestCalls += 1;
        return selector === '[data-study-room-trigger]' ? trigger : null;
      },
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  document.emit('click', event);
  assert.equal(event.defaultPrevented, true, 'Study Room navigation must be handled by the feature.');
  assert.ok(closestCalls >= 1, 'The delegated Study Room trigger must be evaluated.');
}

function createPreviewHarness({ role, open, settleAccess = true }) {
  const { document } = createDocument();
  document.getElementById('dd-study-room-overlay').hidden = true;
  document.getElementById('dd2-header-role-label').textContent = role;
  const openCalls = [];
  const assigned = [];
  const analytics = [];
  let currentAccess = settleAccess ? { role } : null;
  const window = {
    document,
    HTMLElement: FakeHTMLElement,
    location: {
      origin: 'https://duediligence.ph',
      assign(url) {
        assigned.push(url);
      },
    },
    open(...args) {
      openCalls.push(args);
      return open(...args);
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    addEventListener() {},
    DueDiligencePhase4: {
      getAccess: () => currentAccess,
      getSession: () => ({ access_token: 'signed-in-session', user: { id: 'tester-1' } }),
      refreshAccess: async () => currentAccess,
    },
    DueDiligenceAnalytics: {
      track(name, detail) {
        analytics.push({ name, detail });
      },
    },
  };
  vm.runInNewContext(previewClient, {
    window,
    URL,
    Set,
    Object,
    Array,
    String,
    Boolean,
  });
  const resolveAccess = () => {
    currentAccess = { role };
    document.emit('duediligence:access', { detail: { access: { role } } });
  };
  if (settleAccess) resolveAccess();
  return { window, document, openCalls, assigned, analytics, resolveAccess };
}

{
  const popup = { closed: false, opener: {}, focusCalls: 0, focus() { this.focusCalls += 1; } };
  const harness = createPreviewHarness({ role: 'Admin', open: () => popup });
  fireStudyRoomClick(harness.document);
  fireStudyRoomClick(harness.document);
  assert.equal(
    harness.openCalls.length,
    1,
    'Repeated admin clicks must reuse exactly one Study Room window.',
  );
  assert.equal(harness.openCalls[0][0], 'https://duediligence.ph/study-room/');
  assert.equal(harness.openCalls[0][1], 'DueDiligenceStudyRoom');
  assert.match(harness.openCalls[0][2], /popup=yes/);
  assert.match(harness.openCalls[0][2], /toolbar=no/);
  assert.match(harness.openCalls[0][2], /location=no/);
  assert.equal(harness.assigned.length, 0);
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  assert.equal(popup.opener, null);
  assert.equal(popup.focusCalls, 2);
  assert.deepEqual(harness.analytics.map(({ name }) => name), ['study_room_admin_window_opened']);
}

{
  const popup = { closed: false, opener: {}, focus() {} };
  const harness = createPreviewHarness({ role: 'admin', open: () => popup, settleAccess: false });
  for (const trigger of harness.document.studyRoomTriggers) {
    assert.equal(trigger.disabled, true, 'Study Room triggers must be disabled while account access is unresolved.');
    assert.equal(trigger.getAttribute('aria-busy'), 'true');
    assert.equal(trigger.getAttribute('aria-disabled'), 'true');
  }
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 0, 'An unresolved admin role must not race into a stale marketing or live-room route.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);

  harness.resolveAccess();
  for (const trigger of harness.document.studyRoomTriggers) {
    assert.equal(trigger.disabled, false, 'Study Room triggers must enable after verified access resolves.');
    assert.equal(trigger.getAttribute('aria-busy'), 'false');
    assert.equal(trigger.getAttribute('aria-disabled'), 'false');
  }
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1);
}

{
  const popup = { closed: false, opener: {}, focus() {} };
  const harness = createPreviewHarness({ role: 'Admin', open: () => popup, settleAccess: false });
  await eventually(
    () => harness.document.studyRoomTriggers.every((trigger) => !trigger.disabled),
    'A failed access refresh left Study Room permanently disabled.',
  );
  for (const trigger of harness.document.studyRoomTriggers) {
    assert.equal(trigger.disabled, false, 'A failed access refresh must not leave Study Room permanently disabled.');
  }
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'A signed-in Admin may fall through to the server-verified private room after an access refresh failure.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
}

for (const popupFailure of [
  { label: 'blocked', open: () => null },
  { label: 'throwing', open: () => { throw new Error('Popup unavailable'); } },
]) {
  const harness = createPreviewHarness({ role: 'administrator', open: popupFailure.open });
  assert.doesNotThrow(() => fireStudyRoomClick(harness.document), `${popupFailure.label} popups must not break navigation.`);
  assert.equal(harness.openCalls.length, 1);
  assert.deepEqual(harness.assigned, ['https://duediligence.ph/study-room/']);
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  assert.equal(
    harness.analytics.some(({ name }) => name === 'study_room_preview_opened'),
    false,
    'An admin must never be diverted to the marketing concept.',
  );
}

{
  const harness = createPreviewHarness({ role: 'member', open: () => ({}) });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 0, 'A non-admin must not open the private live room.');
  assert.equal(harness.assigned.length, 0);
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, false);
  assert.equal(harness.document.getElementById('dd-study-room-overlay').getAttribute('aria-hidden'), 'false');
  assert.equal(harness.document.body.classList.contains('dd-study-room-open'), true);
  assert.equal(harness.analytics.some(({ name }) => name === 'study_room_preview_opened'), true);
}

function response({ ok, status, payload }) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function createLiveHarness({ fetch, enumerateDevices, getUserMedia }) {
  const { document } = createDocument();
  const storage = new Map();
  const windowListeners = new Map();
  const deviceChangeHandlers = [];
  const window = {
    document,
    location: {
      hostname: 'duediligence.ph',
      origin: 'https://duediligence.ph',
      search: '',
      replace() {},
    },
    navigator: {
      mediaDevices: {
        enumerateDevices,
        getUserMedia,
        addEventListener(type, handler) {
          if (type === 'devicechange') deviceChangeHandlers.push(handler);
        },
      },
    },
    DueDiligencePhase2Config: {
      workerUrl: 'https://worker.example.test',
      supabase: {
        url: 'https://project.supabase.co',
        publishableKey: 'public-test-key',
      },
    },
    DueDiligenceAuthSessionStorage: {
      prepare: () => ({
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      }),
    },
    supabase: {
      createClient: () => ({
        auth: {
          async getSession() {
            return { data: { session: { access_token: 'admin-session-token' } }, error: null };
          },
          onAuthStateChange() {},
        },
      }),
    },
    fetch,
    crypto: {
      getRandomValues(array) {
        array.fill(7);
        return array;
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    sessionStorage: null,
    LivekitClient: {},
    addEventListener(type, handler) {
      const handlers = windowListeners.get(type) || [];
      handlers.push(handler);
      windowListeners.set(type, handlers);
    },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    close() {},
    closed: false,
  };
  vm.runInNewContext(liveClient, {
    window,
    Option: FakeOption,
    URLSearchParams,
    Uint8Array,
    Intl,
    Date,
    Math,
    Map,
    Set,
    WeakMap,
    Array,
    Object,
    String,
    Boolean,
    Number,
    RegExp,
    Error,
    JSON,
    Promise,
  });
  return { window, document, deviceChangeHandlers };
}

async function eventually(check, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

{
  let resolveAccess;
  let accessRequested = false;
  let enumerateCalls = 0;
  let permissionGranted = false;
  let permissionCalls = 0;
  const stoppedTracks = [];
  const harness = createLiveHarness({
    fetch: async () => {
      accessRequested = true;
      return new Promise((resolve) => { resolveAccess = resolve; });
    },
    enumerateDevices: async () => {
      enumerateCalls += 1;
      return [
        { kind: 'videoinput', deviceId: 'camera-1', label: permissionGranted ? 'Integrated HD Camera' : '' },
        { kind: 'audioinput', deviceId: 'microphone-1', label: permissionGranted ? 'Laptop Array Microphone' : '' },
        { kind: 'audiooutput', deviceId: 'speaker-1', label: permissionGranted ? 'Laptop Speakers' : '' },
      ];
    },
    getUserMedia: async (constraints) => {
      permissionCalls += 1;
      assert.equal(constraints.video, true);
      assert.equal(constraints.audio, true);
      permissionGranted = true;
      return {
        getTracks: () => ['video', 'audio'].map((kind) => ({
          stop() {
            stoppedTracks.push(kind);
          },
        })),
      };
    },
  });

  await eventually(() => accessRequested, 'The access check did not start.');
  assert.equal(enumerateCalls, 0, 'Devices must not be enumerated before admin access is verified.');
  assert.equal(permissionCalls, 0, 'Media permission must not be requested before admin access is verified.');

  resolveAccess(response({
    ok: true,
    status: 200,
    payload: { ok: true, allowed: true, role: 'admin', maxParticipants: 12 },
  }));
  await eventually(
    () => harness.document.getElementById('sr-prejoin-status').textContent.includes('available devices were detected'),
    'Automatic device discovery did not complete.',
  );

  assert.equal(permissionCalls, 1, 'Automatic discovery should use one combined permission request when both devices exist.');
  assert.equal(harness.deviceChangeHandlers.length, 1, 'Authorized admins must receive automatic hot-plug refreshes.');
  assert.ok(enumerateCalls >= 2, 'Device names must be refreshed after permission is granted.');
  assert.deepEqual(stoppedTracks.sort(), ['audio', 'video'], 'All temporary permission tracks must stop immediately.');
  assert.equal(harness.document.getElementById('sr-camera-select').children[0].label, 'Integrated HD Camera');
  assert.equal(harness.document.getElementById('sr-microphone-select').children[0].label, 'Laptop Array Microphone');
  assert.equal(harness.document.getElementById('sr-speaker-select').children[0].label, 'Laptop Speakers');
  assert.equal(harness.document.getElementById('sr-live-camera-select').children[0].label, 'Integrated HD Camera');
  assert.equal(harness.document.getElementById('sr-live-microphone-select').children[0].label, 'Laptop Array Microphone');
  assert.equal(harness.document.getElementById('sr-join-camera').getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-join-microphone').getAttribute('aria-pressed'), 'false');
}

{
  let permissionCalls = 0;
  const harness = createLiveHarness({
    fetch: async () => response({
      ok: true,
      status: 200,
      payload: { ok: true, allowed: true, role: 'admin', maxParticipants: 12 },
    }),
    enumerateDevices: async () => [
      { kind: 'videoinput', deviceId: 'camera-1', label: '' },
      { kind: 'audioinput', deviceId: 'microphone-1', label: '' },
    ],
    getUserMedia: async () => {
      permissionCalls += 1;
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    },
  });
  await eventually(
    () => harness.document.getElementById('sr-prejoin-status').textContent.includes('Allow device permission'),
    'Permission denial did not produce a safe recovery message.',
  );
  assert.equal(permissionCalls, 1);
  assert.equal(harness.deviceChangeHandlers.length, 1);
  assert.equal(harness.document.getElementById('sr-join-camera').getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-join-microphone').getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-prejoin').hidden, false);
}

{
  let enumerateCalls = 0;
  let permissionCalls = 0;
  const harness = createLiveHarness({
    fetch: async () => response({
      ok: false,
      status: 403,
      payload: { ok: false, error: { code: 'STUDY_ROOM_ADMIN_REQUIRED', message: 'Admin access required.' } },
    }),
    enumerateDevices: async () => {
      enumerateCalls += 1;
      return [];
    },
    getUserMedia: async () => {
      permissionCalls += 1;
      return { getTracks: () => [] };
    },
  });
  await eventually(
    () => harness.document.getElementById('sr-access-title').textContent === 'The live room is still private',
    'Denied access did not reach the private-room recovery state.',
  );
  assert.equal(enumerateCalls, 0, 'A denied visitor must not have devices enumerated.');
  assert.equal(permissionCalls, 0, 'A denied visitor must never receive a camera or microphone permission prompt.');
  assert.equal(harness.deviceChangeHandlers.length, 0, 'A denied visitor must not receive device-enumeration listeners.');
  assert.equal(harness.document.getElementById('sr-join-camera').getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-join-microphone').getAttribute('aria-pressed'), 'false');
}

console.log('Study Room admin-window and automatic-device behavioral tests passed.');
