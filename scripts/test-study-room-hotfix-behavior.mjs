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
const liveClientTestHooksMarker = 'global.DueDiligenceStudyRoom = Object.freeze({';
assert.ok(liveClient.includes(liveClientTestHooksMarker), 'Study Room test hooks marker is missing.');
const instrumentedLiveClient = liveClient.replace(
  liveClientTestHooksMarker,
  `global.__DueDiligenceStudyRoomTestHooks = {
    state,
    createPersonRow,
    renderParticipants,
    setParticipantBlocked,
    setParticipantVolume,
    syncSelfMediaState,
    testDevices,
    toggleLocalTrack,
  };
  ${liveClientTestHooksMarker}`,
);

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
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = String(tagName).toUpperCase();
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

  async emit(type, event = {}) {
    const payload = {
      target: this,
      currentTarget: this,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      await handler(payload);
    }
    return payload;
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

  append(...children) {
    this.children.push(...children);
    if (this.children.length === children.length && children.length === 1 && 'value' in children[0]) {
      this.value = children[0].value;
    }
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked = true;
  }

  remove() {
    this.removed = true;
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
    createElement(tagName) {
      return new FakeHTMLElement('', tagName);
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

function roomCatalogResponse() {
  return response({
    ok: true,
    status: 200,
    payload: {
      ok: true,
      rooms: [
        { roomKey: '1', active: true, participantCount: 1, capacity: 12, focusStartedAt: '2026-08-29T00:00:00.000Z' },
        { roomKey: '2', active: true, participantCount: 2, capacity: 12, focusStartedAt: '2026-08-29T00:15:00.000Z' },
        { roomKey: '3', active: true, participantCount: 0, capacity: 12, focusStartedAt: '2026-08-29T00:30:00.000Z' },
        { roomKey: '4', active: false, participantCount: 0, capacity: 12, focusStartedAt: null },
      ],
    },
  });
}

function createFakeMandatoryBackground(liveKit, calls) {
  const cameraSource = liveKit.Track?.Source?.Camera || 'camera';
  return Object.freeze({
    VERSION: 'study-room-mandatory-background-test-double-1',
    createController(options = {}) {
      calls.push({ operation: 'createController' });
      let status = 'disabled';
      let publication = null;
      let processedTrack = null;

      const notify = (nextStatus, error = '') => {
        status = nextStatus;
        options.onStateChange?.({
          status,
          supported: true,
          modern: true,
          enabled: status === 'enabled',
          error,
        });
      };
      const selectedId = (captureOptions = {}) => {
        const value = captureOptions?.deviceId;
        return String((value && typeof value === 'object' ? value.exact : value) || 'default-camera');
      };
      const createProcessedTrack = (deviceId) => {
        let activeDeviceId = deviceId;
        const processor = Object.freeze({
          mode: 'virtual-background',
          imagePath: '/assets/study-room/virtual-background-due-diligence-branded.webp',
        });
        const track = {
          isMuted: false,
          mediaStreamTrack: {
            kind: 'video',
            readyState: 'live',
            enabled: true,
            muted: false,
            getSettings: () => ({ deviceId: activeDeviceId }),
          },
          getProcessor: () => processor,
          attach: () => new FakeHTMLElement('protected-camera-video', 'video'),
          detach(element) {
            element?.remove?.();
          },
          setDeviceId(deviceIdValue) {
            activeDeviceId = deviceIdValue;
          },
        };
        return track;
      };
      const ensurePublication = (captureOptions) => {
        const participant = options.getLocalParticipant?.();
        assert.ok(participant, 'The mandatory background may publish only after a local participant exists.');
        if (!publication) {
          processedTrack = createProcessedTrack(selectedId(captureOptions));
          publication = {
            source: cameraSource,
            isMuted: false,
            track: processedTrack,
            async mute() {
              this.isMuted = true;
              this.track.isMuted = true;
            },
            async unmute() {
              this.isMuted = false;
              this.track.isMuted = false;
              this.track.mediaStreamTrack.readyState = 'live';
              this.track.mediaStreamTrack.enabled = true;
            },
          };
          participant.trackPublications?.set?.(cameraSource, publication);
        } else {
          processedTrack.setDeviceId(selectedId(captureOptions));
          publication.isMuted = false;
          processedTrack.isMuted = false;
          processedTrack.mediaStreamTrack.readyState = 'live';
          processedTrack.mediaStreamTrack.enabled = true;
        }
        return publication;
      };

      return Object.freeze({
        capabilities() {
          calls.push({ operation: 'capabilities' });
          return Object.freeze({ supported: true, modern: true });
        },
        snapshot() {
          return Object.freeze({ status, supported: true, modern: true, enabled: status === 'enabled', error: '' });
        },
        async enableCamera(captureOptions = {}, publishOptions = {}) {
          calls.push({ operation: 'enableCamera', captureOptions, publishOptions });
          notify('preparing');
          const activePublication = ensurePublication(captureOptions);
          notify('enabled');
          return Object.freeze({ enabled: true, publication: activePublication });
        },
        async disableCamera() {
          calls.push({ operation: 'disableCamera' });
          if (publication) await publication.mute();
          notify('disabled');
          return Object.freeze({ enabled: false, reason: 'user-disabled' });
        },
        async switchCamera(captureOptions = {}) {
          calls.push({ operation: 'switchCamera', captureOptions });
          notify('preparing');
          const activePublication = ensurePublication(captureOptions);
          notify('enabled');
          return Object.freeze({ enabled: true, publication: activePublication });
        },
        async destroy() {
          calls.push({ operation: 'destroy' });
          if (publication) await publication.mute();
          const participant = options.getLocalParticipant?.();
          if (participant?.trackPublications?.get?.(cameraSource) === publication) {
            participant.trackPublications.delete(cameraSource);
          }
          publication = null;
          processedTrack = null;
          notify('destroyed');
        },
      });
    },
  });
}

function createLiveHarness({
  fetch,
  enumerateDevices,
  getUserMedia,
  liveKit = {},
  AudioContext,
  MediaStream,
}) {
  const { document } = createDocument();
  const storage = new Map();
  const windowListeners = new Map();
  const deviceChangeHandlers = [];
  const backgroundCalls = [];
  const routedFetch = (url, options) => {
    const requestPath = String(url || '');
    let body = {};
    try {
      body = JSON.parse(String(options?.body || '{}'));
    } catch {
      body = {};
    }
    if (requestPath.includes('/admin/study-room/rooms') && body.operation === 'list') {
      return Promise.resolve(roomCatalogResponse());
    }
    return fetch(url, options);
  };
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
    fetch: routedFetch,
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
    LivekitClient: liveKit,
    DueDiligenceStudyRoomMandatoryBackground: createFakeMandatoryBackground(liveKit, backgroundCalls),
    AudioContext,
    MediaStream,
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
  vm.runInNewContext(instrumentedLiveClient, {
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
  return {
    window,
    document,
    deviceChangeHandlers,
    backgroundCalls,
    hooks: window.__DueDiligenceStudyRoomTestHooks,
  };
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
  assert.equal(harness.hooks.state.rooms.length, 4, 'The prejoin lobby must normalize exactly four room slots.');
  assert.equal(harness.hooks.state.selectedRoomKey, '1', 'The first open room should be selected by default.');
  const roomCards = harness.document.getElementById('sr-room-card-grid').children;
  assert.equal(roomCards.length, 4);
  assert.equal(harness.document.getElementById('sr-room-lobby-count').textContent, '3 of 4 rooms open');
  assert.equal(roomCards.find(({ id }) => id === 'sr-create-room')?.dataset.roomKey, '4');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'disabled');
  assert.match(harness.document.getElementById('sr-branded-backdrop-copy').textContent, /real background is never shared/iu);
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
      { kind: 'videoinput', deviceId: 'camera-2', label: '' },
      { kind: 'audioinput', deviceId: 'microphone-1', label: '' },
      { kind: 'audioinput', deviceId: 'microphone-2', label: '' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Speaker 1' },
      { kind: 'audiooutput', deviceId: 'speaker-usb', label: 'USB Study Headphones' },
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
  assert.deepEqual(
    harness.document.getElementById('sr-camera-select').children.map(({ label }) => label),
    ['System default camera', 'Alternate camera 2'],
  );
  assert.deepEqual(
    harness.document.getElementById('sr-microphone-select').children.map(({ label }) => label),
    ['System default microphone', 'Alternate microphone 2'],
  );
  assert.deepEqual(
    harness.document.getElementById('sr-speaker-select').children.map(({ label }) => label),
    ['System default speaker', 'USB Study Headphones'],
    'Meaningful browser/OS labels must remain unchanged.',
  );
  assert.equal(harness.document.getElementById('sr-live-camera-select').children[0].label, 'System default camera');
  assert.equal(harness.document.getElementById('sr-live-microphone-select').children[0].label, 'System default microphone');
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
      { kind: 'videoinput', deviceId: 'camera-1', label: 'Camera 1' },
      { kind: 'audioinput', deviceId: 'microphone-1', label: 'Microphone 1' },
      { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speaker 1' },
    ],
    getUserMedia: async () => {
      permissionCalls += 1;
      return { getTracks: () => [] };
    },
  });
  await eventually(
    () => harness.document.getElementById('sr-prejoin-status').textContent.includes('available devices were detected'),
    'Generic browser labels did not finish device discovery.',
  );
  assert.equal(permissionCalls, 0, 'Already-present browser labels must not trigger a second permission request.');
  assert.equal(harness.document.getElementById('sr-camera-select').children[0].label, 'System default camera');
  assert.equal(harness.document.getElementById('sr-microphone-select').children[0].label, 'System default microphone');
  assert.equal(harness.document.getElementById('sr-speaker-select').children[0].label, 'System default speaker');
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

const liveKitSources = {
  Microphone: 'microphone',
  Camera: 'camera',
};

const labeledDevices = [
  { kind: 'videoinput', deviceId: 'camera-selected', label: 'External Study Camera' },
  { kind: 'audioinput', deviceId: 'microphone-selected', label: 'USB Study Microphone' },
  { kind: 'audioinput', deviceId: 'microphone-default', label: 'Built-in Microphone' },
  { kind: 'audiooutput', deviceId: 'speaker-selected', label: 'Desk Speakers' },
];

function authorizedResponse() {
  return response({
    ok: true,
    status: 200,
    payload: { ok: true, allowed: true, role: 'admin', maxParticipants: 12 },
  });
}

async function waitForAuthorizedPrejoin(harness) {
  await eventually(
    () => harness.document.getElementById('sr-prejoin-status').textContent.includes('available devices were detected'),
    'The authorized Study Room prejoin did not finish loading.',
  );
}

function descendants(node) {
  return [node, ...(node?.children || []).flatMap(descendants)];
}

function descendantWithText(node, text) {
  return descendants(node).find((child) => child.textContent === text);
}

function descendantWithTitle(node, title) {
  return descendants(node).find((child) => child.title === title);
}

function selectedDeviceId(options) {
  const value = options?.deviceId;
  return value && typeof value === 'object' ? value.exact : value;
}

function fakeLocalTrack(kind, deviceId) {
  return {
    mediaStreamTrack: {
      kind,
      readyState: 'live',
      enabled: true,
      getSettings: () => ({ deviceId }),
    },
  };
}

{
  const microphoneCalls = [];
  const rawCameraCalls = [];
  const publications = new Map();
  const localParticipant = {
    identity: 'local-admin',
    name: 'Participant 101',
    isLocal: true,
    trackPublications: publications,
    getTrackPublication: (source) => publications.get(source) || null,
    async setMicrophoneEnabled(enabled, options) {
      microphoneCalls.push({ enabled, options });
      const publication = publications.get(liveKitSources.Microphone) || {
        source: liveKitSources.Microphone,
        isMuted: true,
        track: fakeLocalTrack('audio', 'microphone-selected'),
      };
      publication.isMuted = !enabled;
      publication.track.mediaStreamTrack.readyState = enabled ? 'live' : 'ended';
      publication.track.mediaStreamTrack.enabled = enabled;
      publications.set(liveKitSources.Microphone, publication);
    },
    async setCameraEnabled(enabled, options) {
      rawCameraCalls.push({ enabled, options });
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
  };
  harness.document.getElementById('sr-live-microphone-select').value = 'microphone-selected';
  harness.document.getElementById('sr-live-camera-select').value = 'camera-selected';
  harness.hooks.syncSelfMediaState();

  const microphoneButton = harness.document.getElementById('sr-toggle-microphone');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'false', 'A muted join must start with the microphone off.');
  assert.equal(microphoneButton.querySelector('span').textContent, 'Unmute');
  await microphoneButton.emit('click');
  assert.equal(microphoneCalls.length, 1);
  assert.equal(microphoneCalls[0].enabled, true, 'The first microphone click must publish/enable audio.');
  assert.equal(microphoneCalls[0].options.deviceId.exact, 'microphone-selected');
  assert.equal(selectedDeviceId(microphoneCalls[0].options), 'microphone-selected');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'true');
  assert.equal(microphoneButton.querySelector('span').textContent, 'Mute');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'On');

  await microphoneButton.emit('click');
  assert.equal(microphoneCalls.length, 2);
  assert.equal(microphoneCalls[1].enabled, false, 'The second microphone click must mute audio again.');
  assert.equal(selectedDeviceId(microphoneCalls[1].options), undefined, 'Muting must not reopen or switch the microphone device.');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'false');
  assert.equal(microphoneButton.querySelector('span').textContent, 'Unmute');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'Off');

  const cameraButton = harness.document.getElementById('sr-toggle-camera');
  await cameraButton.emit('click');
  const cameraEnableCalls = harness.backgroundCalls.filter(({ operation }) => operation === 'enableCamera');
  assert.equal(cameraEnableCalls.length, 1, 'Camera start must use the mandatory-background controller.');
  assert.equal(cameraEnableCalls[0].captureOptions.deviceId.exact, 'camera-selected');
  assert.equal(cameraEnableCalls[0].publishOptions.source, liveKitSources.Camera);
  assert.equal(rawCameraCalls.length, 0, 'The raw LiveKit camera shortcut must never bypass background processing.');
  assert.equal(publications.get(liveKitSources.Camera).track.getProcessor().mode, 'virtual-background');
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'true');
  assert.equal(harness.document.getElementById('sr-camera-state').textContent, 'On');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'enabled');
  assert.match(harness.document.getElementById('sr-branded-backdrop-copy').textContent, /backdrop is active/iu);

  await cameraButton.emit('click');
  assert.equal(
    harness.backgroundCalls.filter(({ operation }) => operation === 'disableCamera').length,
    1,
    'Stopping video must remain inside the mandatory-background controller.',
  );
  assert.equal(rawCameraCalls.length, 0);
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-camera-state').textContent, 'Off');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'disabled');
}

{
  let enumerateCalls = 0;
  const microphoneCalls = [];
  const switchCalls = [];
  let roomDefaultDevice = 'microphone-selected';
  const publications = new Map();
  const localParticipant = {
    identity: 'local-admin-stale-device',
    name: 'Participant 303',
    isLocal: true,
    trackPublications: publications,
    getTrackPublication: (source) => publications.get(source) || null,
    async setMicrophoneEnabled(enabled, options) {
      microphoneCalls.push({ enabled, options });
      if (microphoneCalls.length === 1) {
        const error = new Error('Selected microphone is busy');
        error.name = 'NotReadableError';
        throw error;
      }
      if (roomDefaultDevice !== 'default') {
        const error = new Error('Room retained the stale exact microphone default');
        error.name = 'NotReadableError';
        throw error;
      }
      publications.set(liveKitSources.Microphone, {
        source: liveKitSources.Microphone,
        isMuted: !enabled,
        track: fakeLocalTrack('audio', 'microphone-default'),
      });
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => {
      enumerateCalls += 1;
      return labeledDevices;
    },
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  const enumerationsBeforeToggle = enumerateCalls;
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    getActiveDevice: () => roomDefaultDevice,
    async switchActiveDevice(kind, deviceId, exact) {
      switchCalls.push({ kind, deviceId, exact });
      roomDefaultDevice = deviceId;
      return true;
    },
  };
  harness.document.getElementById('sr-live-microphone-select').value = 'microphone-selected';

  const microphoneButton = harness.document.getElementById('sr-toggle-microphone');
  await microphoneButton.emit('click');
  assert.equal(microphoneCalls.length, 2, 'A stale or busy selected microphone must receive one safe default-device retry.');
  assert.equal(selectedDeviceId(microphoneCalls[0].options), 'microphone-selected');
  assert.equal(selectedDeviceId(microphoneCalls[1].options), undefined, 'The retry must use the system-default microphone.');
  assert.deepEqual(
    switchCalls,
    [{ kind: 'audioinput', deviceId: 'default', exact: false }],
    'The retry must clear a stale exact Room default even before a publication exists.',
  );
  assert.ok(enumerateCalls > enumerationsBeforeToggle, 'Device choices must refresh before retrying the default microphone.');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'true');
  assert.equal(microphoneButton.querySelector('span').textContent, 'Mute');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'On');
}

{
  const microphoneCalls = [];
  const switchCalls = [];
  let activeDevice = 'microphone-selected';
  const track = fakeLocalTrack('audio', activeDevice);
  track.mediaStreamTrack.readyState = 'ended';
  track.mediaStreamTrack.enabled = false;
  track.mediaStreamTrack.getSettings = () => ({
    deviceId: activeDevice === 'default' ? 'microphone-default' : activeDevice,
  });
  const publication = {
    source: liveKitSources.Microphone,
    isMuted: true,
    track,
  };
  const publications = new Map([[liveKitSources.Microphone, publication]]);
  const localParticipant = {
    identity: 'local-admin-muted-stale-device',
    name: 'Participant 313',
    isLocal: true,
    trackPublications: publications,
    getTrackPublication: (source) => publications.get(source) || null,
    async setMicrophoneEnabled(enabled, options) {
      microphoneCalls.push({ enabled, options });
      if (microphoneCalls.length === 1) {
        const error = new Error('Muted selected microphone cannot restart');
        error.name = 'NotReadableError';
        throw error;
      }
      publication.isMuted = !enabled;
      track.mediaStreamTrack.readyState = enabled ? 'live' : 'ended';
      track.mediaStreamTrack.enabled = enabled;
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    getActiveDevice: () => activeDevice,
    async switchActiveDevice(kind, deviceId, exact) {
      switchCalls.push({ kind, deviceId, exact });
      activeDevice = deviceId;
      return true;
    },
  };
  harness.document.getElementById('sr-live-microphone-select').value = 'microphone-selected';

  await harness.document.getElementById('sr-toggle-microphone').emit('click');
  assert.equal(microphoneCalls.length, 2, 'A muted stale publication must retry once after switching its pending device.');
  assert.deepEqual(
    switchCalls,
    [{ kind: 'audioinput', deviceId: 'default', exact: false }],
    'The retry must override the stale publication with the system-default input.',
  );
  assert.equal(selectedDeviceId(microphoneCalls[1].options), undefined);
  assert.equal(harness.document.getElementById('sr-live-microphone-select').value, 'microphone-default');
  assert.equal(harness.document.getElementById('sr-toggle-microphone').getAttribute('aria-pressed'), 'true');
}

{
  let enumerateCalls = 0;
  let microphoneCalls = 0;
  const localParticipant = {
    identity: 'local-admin-permission-denied',
    name: 'Participant 404',
    isLocal: true,
    trackPublications: new Map(),
    getTrackPublication: () => null,
    async setMicrophoneEnabled() {
      microphoneCalls += 1;
      const error = new Error('Microphone permission denied');
      error.name = 'NotAllowedError';
      throw error;
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => {
      enumerateCalls += 1;
      return labeledDevices;
    },
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
  };
  harness.document.getElementById('sr-live-microphone-select').value = 'microphone-selected';

  const microphoneButton = harness.document.getElementById('sr-toggle-microphone');
  await microphoneButton.emit('click');
  assert.equal(microphoneCalls, 1, 'Permission denial must not trigger a second microphone permission request.');
  assert.ok(enumerateCalls >= 1, 'The existing device list may be refreshed without reprompting for permission.');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'false');
  assert.equal(microphoneButton.querySelector('span').textContent, 'Unmute');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'Off');
  assert.match(harness.document.getElementById('sr-toast').textContent, /permission/iu);
  assert.equal(microphoneButton.disabled, false);
}

{
  const switchCalls = [];
  let activeDevice = 'microphone-selected';
  const track = fakeLocalTrack('audio', activeDevice);
  track.mediaStreamTrack.getSettings = () => ({ deviceId: activeDevice });
  const publication = {
    source: liveKitSources.Microphone,
    isMuted: false,
    track,
  };
  const localParticipant = {
    identity: 'local-admin-live-switch-rollback',
    name: 'Participant 454',
    isLocal: true,
    trackPublications: new Map([[liveKitSources.Microphone, publication]]),
    getTrackPublication: (source) => source === liveKitSources.Microphone ? publication : null,
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    getActiveDevice: () => activeDevice,
    async switchActiveDevice(kind, deviceId, exact) {
      switchCalls.push({ kind, deviceId, exact });
      if (switchCalls.length === 1) {
        track.mediaStreamTrack.readyState = 'ended';
        track.mediaStreamTrack.enabled = false;
        const error = new Error('Replacement microphone cannot start');
        error.name = 'NotReadableError';
        throw error;
      }
      activeDevice = deviceId;
      track.mediaStreamTrack.readyState = 'live';
      track.mediaStreamTrack.enabled = true;
      return true;
    },
  };
  harness.hooks.syncSelfMediaState();
  const liveMicrophoneSelect = harness.document.getElementById('sr-live-microphone-select');
  liveMicrophoneSelect.value = 'microphone-default';

  await liveMicrophoneSelect.emit('change');
  assert.deepEqual(switchCalls, [
    { kind: 'audioinput', deviceId: 'microphone-default', exact: true },
    { kind: 'audioinput', deviceId: 'microphone-selected', exact: true },
  ]);
  assert.equal(liveMicrophoneSelect.value, 'microphone-selected');
  assert.equal(harness.document.getElementById('sr-toggle-microphone').getAttribute('aria-pressed'), 'true');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'On');
  assert.match(harness.document.getElementById('sr-toast').textContent, /previous device is still active/iu);
}

{
  let microphoneCalls = 0;
  const endedTrack = fakeLocalTrack('audio', 'microphone-selected');
  endedTrack.mediaStreamTrack.readyState = 'ended';
  endedTrack.mediaStreamTrack.enabled = false;
  const publication = {
    source: liveKitSources.Microphone,
    isMuted: false,
    track: endedTrack,
  };
  const localParticipant = {
    identity: 'local-admin-ended-microphone',
    name: 'Participant 505',
    isLocal: true,
    isMicrophoneEnabled: true,
    trackPublications: new Map([[liveKitSources.Microphone, publication]]),
    getTrackPublication: (source) => source === liveKitSources.Microphone ? publication : null,
    async setMicrophoneEnabled() {
      microphoneCalls += 1;
      // Simulate metadata saying "unmuted" while capture never becomes live.
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    getActiveDevice: () => 'microphone-selected',
  };
  harness.hooks.syncSelfMediaState();
  const microphoneButton = harness.document.getElementById('sr-toggle-microphone');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'Off');

  await microphoneButton.emit('click');
  assert.equal(microphoneCalls, 2, 'An ended track may receive one default-device retry, but no false success.');
  assert.equal(microphoneButton.getAttribute('aria-pressed'), 'false');
  assert.match(harness.document.getElementById('sr-toast').textContent, /microphone/iu);
  assert.doesNotMatch(harness.document.getElementById('sr-toast').textContent, /others can hear/iu);
}

class FakeMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

{
  const mediaCalls = [];
  const audioTrack = { kind: 'audio', stopped: false, stop() { this.stopped = true; } };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async (constraints) => {
      mediaCalls.push(constraints);
      const wantsVideo = Boolean(constraints.video);
      const wantsAudio = Boolean(constraints.audio);
      if (wantsVideo) {
        const error = new Error('Camera is already in use');
        error.name = 'NotReadableError';
        throw error;
      }
      if (wantsAudio) return new FakeMediaStream([audioTrack]);
      return new FakeMediaStream();
    },
    liveKit: { Track: { Source: liveKitSources } },
    MediaStream: FakeMediaStream,
  });
  await waitForAuthorizedPrejoin(harness);
  harness.document.getElementById('sr-camera-select').value = 'camera-selected';
  harness.document.getElementById('sr-microphone-select').value = 'microphone-selected';

  const testButton = harness.document.getElementById('sr-test-devices');
  await testButton.emit('click');
  const cameraOnly = mediaCalls.find((constraints) => constraints.video && constraints.audio === false);
  const microphoneOnly = mediaCalls.find((constraints) => constraints.video === false && constraints.audio);
  assert.ok(cameraOnly, 'A failed combined device test must retry the selected camera separately.');
  assert.ok(microphoneOnly, 'A failed combined device test must retry the selected microphone separately.');
  assert.equal(cameraOnly.video.deviceId.exact, 'camera-selected');
  assert.equal(microphoneOnly.audio.deviceId.exact, 'microphone-selected');
  assert.equal(harness.hooks.state.previewStream.getAudioTracks().length, 1);
  assert.equal(harness.hooks.state.previewStream.getVideoTracks().length, 0);
  assert.equal(harness.document.getElementById('sr-local-preview').hidden, true);
  assert.equal(harness.document.getElementById('sr-camera-placeholder').hidden, false);
  assert.equal(testButton.querySelector('span').textContent, 'Stop device test');
  assert.match(harness.document.getElementById('sr-prejoin-status').textContent, /microphone/iu);
  assert.match(harness.document.getElementById('sr-prejoin-status').textContent, /camera/iu);

  await testButton.emit('click');
  assert.equal(audioTrack.stopped, true, 'Stopping the partial device test must stop its microphone track.');
  assert.equal(harness.hooks.state.previewStream, null);
  assert.match(harness.document.getElementById('sr-prejoin-status').textContent, /off/iu);
}

{
  const mediaCalls = [];
  const cameraTrack = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
  const audioTrack = { kind: 'audio', stopped: false, stop() { this.stopped = true; } };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async (constraints) => {
      mediaCalls.push(constraints);
      if (constraints.video && constraints.audio) {
        const error = new Error('Combined selection is stale');
        error.name = 'NotReadableError';
        throw error;
      }
      if (constraints.video) return new FakeMediaStream([cameraTrack]);
      if (constraints.audio?.deviceId?.exact) {
        const error = new Error('Selected microphone disconnected');
        error.name = 'NotFoundError';
        throw error;
      }
      if (constraints.audio) return new FakeMediaStream([audioTrack]);
      return new FakeMediaStream();
    },
    liveKit: { Track: { Source: liveKitSources } },
    MediaStream: FakeMediaStream,
  });
  await waitForAuthorizedPrejoin(harness);
  harness.document.getElementById('sr-camera-select').value = 'camera-selected';
  harness.document.getElementById('sr-microphone-select').value = 'microphone-selected';

  await harness.document.getElementById('sr-test-devices').emit('click');
  assert.ok(
    mediaCalls.some((constraints) => constraints.video === false && constraints.audio === true),
    'A stale selected microphone must receive one test with the system-default input.',
  );
  assert.equal(harness.hooks.state.previewStream.getAudioTracks().length, 1);
  assert.equal(harness.hooks.state.previewStream.getVideoTracks().length, 1);
  assert.match(harness.document.getElementById('sr-prejoin-status').textContent, /camera and microphone are working/iu);

  await harness.document.getElementById('sr-test-devices').emit('click');
  assert.equal(cameraTrack.stopped, true);
  assert.equal(audioTrack.stopped, true);
}

{
  let permissionCalls = 0;
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => {
      permissionCalls += 1;
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    },
    liveKit: { Track: { Source: liveKitSources } },
    MediaStream: FakeMediaStream,
  });
  await waitForAuthorizedPrejoin(harness);
  await harness.document.getElementById('sr-test-devices').emit('click');
  assert.equal(permissionCalls, 1, 'A denied device test must not repeatedly reprompt the user.');
  const status = harness.document.getElementById('sr-prejoin-status');
  assert.match(status.textContent, /permission/iu);
  assert.match(status.textContent, /join with both off/iu);
  assert.equal(status.classList.contains('is-error'), true);
  assert.equal(harness.document.getElementById('sr-test-devices').disabled, false);
}

{
  const requests = [];
  const volumeCalls = [];
  const subscriptionCalls = [];
  let audioAttachCount = 0;
  const remoteAudioTrack = {
    attachedElements: [],
    attach() {
      audioAttachCount += 1;
      const element = new FakeHTMLElement(`remote-audio-${audioAttachCount}`, 'audio');
      element.volume = 1;
      this.attachedElements.push(element);
      return element;
    },
    detach(element) {
      this.attachedElements = this.attachedElements.filter((candidate) => candidate !== element);
      element.remove();
    },
  };
  const microphonePublication = {
    source: liveKitSources.Microphone,
    trackSid: 'remote-microphone-track',
    isMuted: false,
    track: remoteAudioTrack,
    async setSubscribed(value) {
      subscriptionCalls.push(value);
    },
  };
  const remoteParticipant = {
    identity: 'remote-study-partner',
    name: 'Study Partner',
    isLocal: false,
    trackPublications: new Map([['microphone', microphonePublication]]),
    getTrackPublication: (source) => source === liveKitSources.Microphone ? microphonePublication : null,
    setVolume(value) {
      volumeCalls.push(value);
      remoteAudioTrack.attachedElements.forEach((element) => {
        element.volume = value;
      });
    },
  };
  const localParticipant = {
    identity: 'local-admin',
    name: 'Participant 202',
    isLocal: true,
    trackPublications: new Map(),
    getTrackPublication: () => null,
  };
  const harness = createLiveHarness({
    fetch: async (url) => {
      requests.push(url);
      return authorizedResponse();
    },
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map([[remoteParticipant.identity, remoteParticipant]]),
    connectionState: 'connected',
    canPlaybackAudio: true,
  };
  harness.hooks.renderParticipants();
  assert.equal(remoteAudioTrack.attachedElements.length, 1);
  assert.equal(remoteAudioTrack.attachedElements[0].volume, 1);

  let row = harness.hooks.createPersonRow(remoteParticipant);
  assert.equal(
    descendantWithText(row, 'Mute for room'),
    undefined,
    'Remote-participant controls must not expose irreversible room-wide muting.',
  );
  const slider = descendants(row).find((child) => child.type === 'range');
  slider.value = '42';
  await slider.emit('input');
  assert.equal(volumeCalls.at(-1), 0.42);
  assert.equal(harness.hooks.state.participantVolumes.get(remoteParticipant.identity), 42);

  await descendantWithTitle(row, 'Mute for me').emit('click');
  assert.equal(volumeCalls.at(-1), 0);
  assert.equal(harness.hooks.state.localMutedParticipants.has(remoteParticipant.identity), true);
  assert.equal(remoteAudioTrack.attachedElements.length, 0, 'Mute for me must detach that participant’s audio.');
  const attachCountWhileMuted = audioAttachCount;
  harness.hooks.renderParticipants();
  assert.equal(audioAttachCount, attachCountWhileMuted, 'A participant rerender must not reattach locally muted audio.');
  row = harness.hooks.createPersonRow(remoteParticipant);
  await descendantWithTitle(row, 'Hear again').emit('click');
  assert.equal(volumeCalls.at(-1), 0.42, 'Hear again must restore the participant’s prior local volume.');
  assert.equal(harness.hooks.state.localMutedParticipants.has(remoteParticipant.identity), false);
  assert.equal(remoteAudioTrack.attachedElements.length, 1);
  assert.equal(remoteAudioTrack.attachedElements[0].volume, 0.42);

  row = harness.hooks.createPersonRow(remoteParticipant);
  await descendantWithTitle(row, 'Block locally').emit('click');
  assert.equal(subscriptionCalls.at(-1), false);
  assert.equal(harness.hooks.state.blockedParticipants.has(remoteParticipant.identity), true);
  row = harness.hooks.createPersonRow(remoteParticipant);
  await descendantWithTitle(row, 'Unblock').emit('click');
  assert.equal(subscriptionCalls.at(-1), true);
  assert.equal(harness.hooks.state.blockedParticipants.has(remoteParticipant.identity), false);

  row = harness.hooks.createPersonRow(remoteParticipant);
  const zeroSlider = descendants(row).find((child) => child.type === 'range');
  zeroSlider.value = '0';
  await zeroSlider.emit('input');
  harness.hooks.renderParticipants();
  assert.equal(volumeCalls.at(-1), 0, 'A saved 0% volume must be reapplied after audio elements are recreated.');
  assert.equal(remoteAudioTrack.attachedElements[0].volume, 0);

  assert.equal(
    requests.some((url) => String(url).includes('/admin/study-room/moderate')),
    false,
    'Mute-for-me, volume, and block controls must remain local and reversible.',
  );
}

console.log('Study Room admin-window, device, microphone, and local-control behavioral tests passed.');
