import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [previewClient, liveClient, liveHtml, liveKitUmd] = await Promise.all([
  readFile(path.join(root, 'assets/study-room-preview.js'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.js'), 'utf8'),
  readFile(path.join(root, 'study-room/index.html'), 'utf8'),
  readFile(path.join(root, 'worker/node_modules/livekit-client/dist/livekit-client.umd.js'), 'utf8'),
]);
const liveClientTestHooksMarker = 'global.DueDiligenceStudyRoom = Object.freeze({';
assert.ok(liveClient.includes(liveClientTestHooksMarker), 'Study Room test hooks marker is missing.');
const instrumentedLiveClient = liveClient.replace(
  liveClientTestHooksMarker,
  `global.__DueDiligenceStudyRoomTestHooks = {
    state,
    createPersonRow,
    moderateParticipant,
    createTile,
    buildMediaViews,
    bindRoomEvents,
    reconcileTile,
    calculateSquareGrid,
    renderParticipants,
    normalizeRoomCatalog,
    syncJoinButton,
    setParticipantBlocked,
    setParticipantVolume,
    syncSelfMediaState,
    testDevices,
    toggleLocalTrack,
    attachTrack,
    detachTracks,
    microphonePublicationIsLive,
    verifyMicrophoneTransport,
    startRoomAudioFromGesture,
    studyRoomMediaOptions,
    cameraPublishOptions,
    toggleBackdrop,
    openPanel,
    sendChatMessage,
    toggleRaiseHand,
    toggleScreenShare,
    toggleCompactView,
    disconnectConnectedRoom,
  };
  ${liveClientTestHooksMarker}`,
);

{
  const matches = [...liveHtml.matchAll(/<script\b[^>]*data-study-room-compat="own-property-20260909-1"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, 'Exactly one Study Room compatibility initializer must precede the SDK.');
  const compatibility = matches[0][1];
  const sdkScript = liveHtml.indexOf('<script src="../assets/vendor/livekit-client.umd.js');
  assert.ok(sdkScript > matches[0].index + matches[0][0].length,
    'The actual compatibility code must finish before the unchanged classic SDK script loads.');
  const nativeContext = vm.createContext({});
  const nativeHasOwn = vm.runInContext('Object.hasOwn', nativeContext);
  vm.runInContext(compatibility, nativeContext);
  assert.equal(vm.runInContext('Object.hasOwn', nativeContext), nativeHasOwn,
    'A native implementation must not be replaced.');
  const fallbackContext = vm.createContext({});
  vm.runInContext('delete Object.hasOwn', fallbackContext);
  vm.runInContext(compatibility, fallbackContext);
  const fallback = vm.runInContext('Object.hasOwn', fallbackContext);
  const descriptor = vm.runInContext('Object.getOwnPropertyDescriptor(Object, "hasOwn")', fallbackContext);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(fallback.length, 2);
  assert.equal(vm.runInContext('Object.hasOwn({ value: undefined }, "value")', fallbackContext), true);
  assert.equal(vm.runInContext('Object.hasOwn(Object.create({ inherited: 1 }), "inherited")', fallbackContext), false);
  assert.equal(vm.runInContext('Object.hasOwn({ hasOwnProperty: null }, "hasOwnProperty")', fallbackContext), true);
  assert.equal(vm.runInContext('Object.hasOwn(Object.assign(Object.create(null), { value: 1 }), "value")', fallbackContext), true);
  assert.equal(vm.runInContext('Object.hasOwn({}, "__proto__")', fallbackContext), false);
  assert.equal(vm.runInContext('Object.hasOwn("abc", 1)', fallbackContext), true);
  assert.equal(vm.runInContext('(() => { const key = Symbol(); return Object.hasOwn({ [key]: 1 }, key); })()', fallbackContext), true);
  for (const nullish of ['null', 'undefined']) {
    assert.throws(() => vm.runInContext(`Object.hasOwn(${nullish}, "value")`, fallbackContext),
      (error) => error?.name === 'TypeError');
  }
  vm.runInContext(compatibility, fallbackContext);
  assert.equal(vm.runInContext('Object.hasOwn', fallbackContext), fallback, 'Repeated loading must preserve the installed fallback.');

  // Execute the real installed/pinned UMD, not a fake SDK. Timers are inert and
  // every transport traps; Room construction never connects or captures media.
  const sdkPackage = JSON.parse(await readFile(path.join(root, 'worker/node_modules/livekit-client/package.json'), 'utf8'));
  assert.equal(sdkPackage.version, '2.22.1');
  for (const mode of ['native', 'missing', 'fallback']) {
    let networkCalls = 0;
    const sdkContext = vm.createContext({
      console: { log() {}, warn() {}, error() {}, debug() {} },
      setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      URL, URLSearchParams, TextEncoder, TextDecoder, ReadableStream, WritableStream,
      TransformStream, AbortController, DOMException, crypto: webcrypto,
      fetch() { networkCalls += 1; throw new Error('NETWORK_FORBIDDEN'); },
      WebSocket: class { constructor() { networkCalls += 1; throw new Error('WEBSOCKET_FORBIDDEN'); } },
    });
    if (mode !== 'native') vm.runInContext('Object.hasOwn = undefined', sdkContext);
    if (mode === 'fallback') vm.runInContext(compatibility, sdkContext);
    vm.runInContext(liveKitUmd, sdkContext, { timeout: 5000 });
    if (mode === 'missing') {
      assert.throws(() => vm.runInContext('new LivekitClient.Room()', sdkContext, { timeout: 5000 }),
        (error) => error?.name === 'TypeError' && /Object\.hasOwn/.test(error.message));
    } else {
      vm.runInContext('new LivekitClient.Room()', sdkContext, { timeout: 5000 });
    }
    assert.equal(networkCalls, 0, mode + ': SDK constructor must not use a transport.');
  }
  console.log('Study Room pre-SDK own-property compatibility: actual inline semantics and real LiveKit 2.22.1 Room constructor native/failure/fallback checks passed.');
}

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

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((listener) => listener !== handler));
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

function createPreviewHarness({ role, open, settleAccess = true, access: accessOverride = null, session: sessionOverride = { access_token: 'signed-in-session', user: { id: 'tester-1' } } }) {
  const { document } = createDocument();
  document.getElementById('dd-study-room-overlay').hidden = true;
  document.getElementById('dd2-header-role-label').textContent = role;
  const openCalls = [];
  const assigned = [];
  const analytics = [];
  const resolvedAccess = { role, ...(accessOverride || {}) };
  let currentAccess = settleAccess ? resolvedAccess : null;
  let currentSession = sessionOverride;
  let signInCalls = 0;
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
      getSession: () => currentSession,
      refreshAccess: async () => currentAccess,
    },
    DueDiligencePhase2: {
      openSignIn() { signInCalls += 1; },
    },
    DueDiligenceAnalytics: {
      track(name, detail) {
        analytics.push({ name, detail });
      },
    },
    DueDiligenceSubscriptionCta: {
      isAudienceEligible(value) {
        return value?.subscription_status !== 'active';
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
    currentAccess = resolvedAccess;
    document.emit('duediligence:access', { detail: { access: resolvedAccess } });
  };
  if (settleAccess) resolveAccess();
  return {
    window, document, openCalls, assigned, analytics, resolveAccess,
    get signInCalls() { return signInCalls; },
    setSession(value) {
      currentSession = value;
      document.emit('duediligence:session', { detail: { session: value, authenticated: Boolean(value?.access_token) } });
    },
  };
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
  assert.deepEqual(harness.analytics.map(({ name }) => name), ['study_room_window_opened']);
}

{
  const popup = { closed: false, opener: {}, focus() {} };
  const harness = createPreviewHarness({ role: 'admin', open: () => popup, settleAccess: false });
  for (const trigger of harness.document.studyRoomTriggers) {
    assert.equal(trigger.disabled, false, 'A real signed-in session must enable Study Room while subscription access is unresolved.');
    assert.equal(trigger.getAttribute('aria-busy'), 'false');
    assert.equal(trigger.getAttribute('aria-disabled'), 'false');
  }
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'Signed-in launch must not wait for subscription or role resolution.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);

  harness.resolveAccess();
  for (const trigger of harness.document.studyRoomTriggers) {
    assert.equal(trigger.disabled, false, 'Resolving subscription access must not disable Study Room.');
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
  assert.equal(harness.openCalls.length, 1, 'A signed-in member may open the server-verified room after an access refresh failure.');
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
  assert.equal(harness.openCalls.length, 1, 'A signed-in free member must open the live room.');
  assert.equal(harness.assigned.length, 0);
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  assert.equal(harness.document.body.classList.contains('dd-study-room-open'), false);
  assert.equal(harness.analytics.some(({ name }) => name === 'study_room_preview_opened'), false);
}

{
  const popup = { closed: false, opener: {}, focus() {} };
  const harness = createPreviewHarness({
    role: 'member',
    open: () => popup,
    access: {
      allowed: true,
      basis: 'paid_subscription',
      subscription_status: 'active',
      subscription: { status: 'active', planCode: 'bar_access_30d' },
    },
  });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'A paid member must open the live Study Room.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  assert.deepEqual(harness.analytics.map(({ name }) => name), ['study_room_window_opened']);
  assert.equal(harness.analytics[0].detail.audience, 'signed_in');
  assert.equal(
    harness.document.getElementById('dd-study-room-subscribe-note').textContent,
    'Available to all signed-in members, free and paid',
  );
}

{
  const popup = { closed: false, opener: {}, focus() {} };
  const harness = createPreviewHarness({
    role: 'member',
    open: () => popup,
    access: { allowed: true, basis: 'founding_beta' },
  });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'A Founding Beta tester must retain live Study Room access.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  assert.deepEqual(harness.analytics.map(({ name }) => name), ['study_room_window_opened']);
  assert.equal(harness.analytics[0].detail.audience, 'signed_in');
}

for (const value of [
  { allowed: false, remainingTokens: 0, basis: 'introductory' },
  { allowed: false, paidSubscriptionExpired: true, subscription: { status: 'expired' } },
]) {
  const popup = { closed: false, focus() {} };
  const harness = createPreviewHarness({ role: 'member', open: () => popup, access: value });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'Exhausted grading quota or an expired plan must not block Study Room.');
  harness.setSession(null);
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'Logout must prevent another live launch even while an old popup exists.');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, false);
  assert.equal(harness.document.getElementById('dd-study-room-subscribe').querySelector('span').textContent, 'Sign in to join');
  harness.document.emit('click', {
    target: { closest: (selector) => selector === '#dd-study-room-subscribe' ? {} : null },
  });
  assert.equal(harness.signInCalls, 1, 'The signed-out preview CTA must open the existing normal sign-in interface.');
  assert.equal(harness.openCalls.length, 1);
}

for (const missingSession of [null, {}, { user: { id: 'tester-1' } }, { access_token: '' }]) {
  const harness = createPreviewHarness({ role: 'admin', open: () => ({}), session: missingSession });
  harness.setSession(missingSession);
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 0, 'Known settled signed-out state must retain the normal sign-in preview, not trust role/profile metadata.');
  harness.document.emit('duediligence:session', { detail: { authenticated: true } });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 0, 'An auth event without a real session must not fabricate live access.');
}

{
  const harness = createPreviewHarness({ role: 'member', open: () => ({}), settleAccess: false, session: null });
  assert.equal(harness.document.studyRoomTriggers.every((trigger) => !trigger.disabled), true,
    'Unknown Home Auth must not strand an explicit click; the dedicated room still verifies its own session.');
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1);
  assert.equal(harness.openCalls[0][0], 'https://duediligence.ph/study-room/');
  assert.equal(harness.document.getElementById('dd-study-room-overlay').hidden, true);
  harness.setSession({ access_token: 'new-inert-token', user: { id: 'tester-2' } });
  fireStudyRoomClick(harness.document);
  assert.equal(harness.openCalls.length, 1, 'A new signed-in member reuses the same room window while subscription access is still loading.');
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
      allowed: true, role: 'admin', administrator: true, canCreateRooms: true,
      maxRooms: 24, maxParticipants: 12, recording: false,
      rooms: [
        { roomKey: '1', label: 'Library', kind: 'library', microphoneAllowed: false, adminOnly: false, active: true, participantCount: 1, capacity: 12, focusStartedAt: '2026-08-29T00:00:00.000Z' },
        { roomKey: '2', label: 'Room 1', kind: 'general', microphoneAllowed: true, adminOnly: false, active: true, participantCount: 2, capacity: 12, focusStartedAt: '2026-08-29T00:15:00.000Z' },
        { roomKey: '3', label: 'Room 2', kind: 'general', microphoneAllowed: true, adminOnly: false, active: true, participantCount: 0, capacity: 12, focusStartedAt: '2026-08-29T00:30:00.000Z' },
        { roomKey: '4', label: 'Room 3', kind: 'general', microphoneAllowed: true, adminOnly: false, active: false, participantCount: 0, capacity: 12, focusStartedAt: null },
        { roomKey: '5', label: 'Inner Chamber', kind: 'inner-chamber', microphoneAllowed: true, adminOnly: true, active: false, participantCount: 0, capacity: 12, focusStartedAt: null },
        { roomKey: '6', label: 'Room 4', kind: 'general', microphoneAllowed: true, adminOnly: false, active: false, participantCount: 0, capacity: 12, focusStartedAt: null },
      ].map((room) => ({ ...room, audience: room.adminOnly ? 'admin' : 'all', revision: 1, accessRevision: 1,
        alwaysOpen: !room.adminOnly, canJoin: true, canCreate: room.adminOnly })),
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
      let processor = null;
      let mode = 'disabled';

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
        const mediaStreamTrack = {
          kind: 'video',
          readyState: 'live',
          enabled: true,
          muted: false,
          getSettings: () => ({ deviceId: activeDeviceId }),
        };
        processor = {
          mode,
          processedTrack: mediaStreamTrack,
          imagePath: undefined,
          blurRadius: undefined,
          async switchTo(nextOptions) {
            calls.push({ operation: 'processorSwitchTo', mode: nextOptions.mode });
            this.mode = nextOptions.mode;
            this.imagePath = nextOptions.imagePath;
            this.blurRadius = nextOptions.blurRadius;
            mode = nextOptions.mode;
          },
          async destroy() {
            calls.push({ operation: 'processorDestroy' });
          },
        };
        const track = {
          isMuted: false,
          mediaStreamTrack,
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
          return Object.freeze({
            status,
            supported: true,
            modern: true,
            enabled: status === 'enabled',
            mode,
            processorAttached: Boolean(processedTrack?.getProcessor?.()),
            fallbackRaw: false,
            error: '',
          });
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
        async switchBackground(request = { mode: 'disabled' }) {
          const nextMode = typeof request === 'string' ? request : request?.mode;
          calls.push({ operation: 'switchBackground', mode: nextMode });
          if (!processedTrack || !processor) {
            mode = nextMode || 'disabled';
            return this.snapshot();
          }
          await processor.switchTo({
            mode: nextMode || 'disabled',
            imagePath: request?.imagePath,
            blurRadius: request?.blurRadius,
          });
          notify(publication && !publication.isMuted ? 'enabled' : 'disabled');
          return this.snapshot();
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
          processor = null;
          mode = 'disabled';
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
  scheduleTimeout = () => 1,
  objectConstructor = Object,
  catalogResponse = roomCatalogResponse,
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
    if (requestPath.includes('/study-room/rooms') && body.operation === 'list') {
      return Promise.resolve(catalogResponse());
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
    setTimeout: scheduleTimeout,
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
    Object: objectConstructor,
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
    payload: { ok: true, allowed: true, role: 'admin', administrator: true, canCreateRooms: true, maxParticipants: 12, maxRooms: 24 },
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
  assert.equal(harness.hooks.state.rooms.length, 6, 'The prejoin lobby must retain the six canonical seeded rooms.');
  assert.deepEqual(Array.from(harness.hooks.state.rooms, ({ roomKey, audience, revision, accessRevision }) =>
    [roomKey, audience, revision, accessRevision]), [
    ['1', 'all', 1, 1], ['2', 'all', 1, 1], ['3', 'all', 1, 1],
    ['4', 'all', 1, 1], ['5', 'admin', 1, 1], ['6', 'all', 1, 1],
  ]);
  assert.equal(harness.hooks.state.selectedRoomKey, '1', 'The first open room should be selected by default.');
  const roomCards = harness.document.getElementById('sr-room-card-grid').children;
  assert.equal(roomCards.length, 6);
  assert.equal(harness.document.getElementById('sr-room-lobby-count').textContent, '5 rooms available');
  assert.equal(roomCards.flatMap(descendants).find(({ id }) => id === 'sr-create-room')?.dataset.roomKey, '5',
    'Only private Inner Chamber needs explicit creation; all five public seeds are always open.');
  assert.equal(roomCards.flatMap(descendants).filter((node) => node.className === 'sr-room-edit').length, 6,
    'An authenticated administrator must receive one edit control per canonical room.');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'off');
  assert.match(harness.document.getElementById('sr-branded-backdrop-copy').textContent, /real background/iu);
}

{
  let permissionCalls = 0;
  const harness = createLiveHarness({
    fetch: async () => response({
      ok: true,
      status: 200,
      payload: { ok: true, allowed: true, role: 'admin', administrator: true, canCreateRooms: true, maxParticipants: 12, maxRooms: 24 },
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
      payload: { ok: true, allowed: true, role: 'admin', administrator: true, canCreateRooms: true, maxParticipants: 12, maxRooms: 24 },
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
    () => harness.document.getElementById('sr-access-title').textContent === 'Study Room access unavailable',
    'Denied access did not reach the access-denial recovery state.',
  );
  assert.equal(harness.document.getElementById('sr-access-retry').hidden, true,
    'An explicit forbidden response must not offer an automatic retry loop.');
  assert.equal(enumerateCalls, 0, 'A denied visitor must not have devices enumerated.');
  assert.equal(permissionCalls, 0, 'A denied visitor must never receive a camera or microphone permission prompt.');
  assert.equal(harness.deviceChangeHandlers.length, 0, 'A denied visitor must not receive device-enumeration listeners.');
  assert.equal(harness.document.getElementById('sr-join-camera').getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-join-microphone').getAttribute('aria-pressed'), 'false');
}

const liveKitSources = {
  Microphone: 'microphone',
  Camera: 'camera',
  ScreenShare: 'screen_share',
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
    payload: { ok: true, allowed: true, role: 'admin', administrator: true, canCreateRooms: true, maxParticipants: 12, maxRooms: 24 },
  });
}

async function waitForAuthorizedPrejoin(harness) {
  await eventually(
    () => harness.document.getElementById('sr-prejoin-status').textContent.includes('available devices were detected'),
    'The authorized Study Room prejoin did not finish loading.',
  );
}

{
  // Use an isolated realm: never remove a method from Node's shared Object.
  const legacyObject = vm.runInNewContext('Object');
  Object.defineProperty(legacyObject, 'hasOwn', { value: undefined });
  assert.equal(legacyObject.hasOwn, undefined);
  assert.equal(typeof Object.hasOwn, 'function');
  let accessCalls = 0;
  let permissionCalls = 0;
  let freeCatalog;
  const h = createLiveHarness({
    objectConstructor: legacyObject,
    fetch: async (url) => {
      assert.equal(String(url), 'https://worker.example.test/study-room/access');
      accessCalls += 1;
      return response({ ok: true, status: 200, payload: {
        ok: true, allowed: true, role: 'member', administrator: false,
        canCreateRooms: false, maxParticipants: 12, maxRooms: 24,
      } });
    },
    catalogResponse: async () => {
      const payload = await roomCatalogResponse().json();
      freeCatalog = { ...payload, role: 'member', administrator: false, canCreateRooms: false,
        rooms: payload.rooms.map((room) => ({ ...room, canCreate: false,
          canJoin: room.roomKey !== '5' })) };
      return response({ ok: true, status: 200, payload: freeCatalog });
    },
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { permissionCalls += 1; throw new Error('No media in compatibility regression.'); },
  });
  await waitForAuthorizedPrejoin(h);
  await eventually(() => h.hooks.state.roomCatalogLoaded && !h.hooks.state.roomCatalogBusy,
    'A browser without Object.hasOwn must finish the actual six-room catalog refresh.');
  assert.equal(accessCalls, 1);
  assert.equal(permissionCalls, 0);
  assert.equal(h.hooks.state.isAdministrator, false);
  assert.deepEqual(Array.from(h.hooks.state.rooms, ({ roomKey, canJoin }) => [roomKey, canJoin]),
    [['1', true], ['2', true], ['3', true], ['4', true], ['5', false], ['6', true]]);
  assert.equal(h.document.getElementById('sr-room-card-grid').children.length, 6);
  assert.equal(h.document.getElementById('sr-room-lobby-count').textContent, '5 rooms available');
  assert.equal(h.document.getElementById('sr-room-admin-controls').hidden, true);
  assert.equal(h.document.getElementById('sr-room-add').disabled, true);
  assert.equal(h.document.getElementById('sr-room-card-grid').children.flatMap(descendants)
    .some((node) => node.className === 'sr-room-edit'), false);
  assert.equal(h.document.getElementById('sr-join').disabled, false);
  assert.equal(h.document.getElementById('sr-join').textContent, 'Join Library');
  // A real click reaches the existing visible SDK-load guard; no fake RTC is used.
  await h.document.getElementById('sr-join').emit('click');
  assert.match(h.document.getElementById('sr-prejoin-status').textContent, /secure video library could not load/);
  assert.equal(h.hooks.state.room, null);
  assert.equal(accessCalls, 1);
  h.hooks.state.selectedRoomKey = '5';
  h.hooks.syncJoinButton();
  assert.equal(h.document.getElementById('sr-join').disabled, true);
  assert.match(h.document.getElementById('sr-join').textContent, /Admin only/);

  const originalGuard = 'Object.prototype.hasOwnProperty.call(ROOM_AUDIENCES, audience)';
  const normalizationSource = h.hooks.normalizeRoomCatalog.toString();
  assert.ok(normalizationSource.includes(originalGuard));
  const oldNormalization = vm.runInNewContext(`(${normalizationSource.replace(originalGuard,
    'Object.hasOwn(ROOM_AUDIENCES, audience)')})`, {
    Object: legacyObject, state: h.hooks.state,
    ROOM_AUDIENCES: { admin: 'Admin only', paid: 'Paying users', all: 'All signed-in users' },
    validRoomKey: (key) => /^(?:[1-9]|1[0-9]|2[0-4])$/.test(key),
  });
  assert.throws(() => oldNormalization(freeCatalog),
    (error) => error?.name === 'TypeError' && /hasOwn/.test(error.message),
    'The pre-fix actual normalizer must reproduce the missing-method failure.');
  for (const audience of ['constructor', '__proto__', 'toString', '', null]) {
    const result = h.hooks.normalizeRoomCatalog({ rooms: [
      { ...freeCatalog.rooms[0], roomKey: '7', audience },
    ] });
    assert.equal(result.length, 0, 'The compatibility fallback must not admit inherited/unknown audiences.');
  }
  const privateRoom = h.hooks.normalizeRoomCatalog({ rooms: [
    { ...freeCatalog.rooms[4], audience: 'all', canJoin: true },
  ] })[0];
  assert.equal(privateRoom.audience, 'admin');
  assert.equal(privateRoom.canJoin, false, 'Inner Chamber remains restricted despite malformed public claims.');
  console.log('Study Room missing-Object.hasOwn regression: old normalizer fails; free six-seed initialization and restriction guards pass.');
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
  const speechPreset = { maxBitrate: 24_000, priority: 'high' };
  const lowVideoLayer = {
    resolution: { width: 320, height: 180, frameRate: 15 },
    encoding: { maxBitrate: 120_000, maxFramerate: 15 },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: {
      Track: { Source: liveKitSources },
      AudioPresets: { speech: speechPreset },
      VideoPresets: { h180: lowVideoLayer },
    },
  });
  const options = harness.hooks.studyRoomMediaOptions();
  assert.equal(options.adaptiveStream.pixelDensity, 1);
  assert.equal(options.adaptiveStream.pauseVideoInBackground, true);
  assert.equal(options.dynacast, true);
  assert.equal(options.audioCaptureDefaults.voiceIsolation, true);
  assert.equal(options.videoCaptureDefaults.resolution.width, 640);
  assert.equal(options.videoCaptureDefaults.resolution.height, 360);
  assert.equal(options.videoCaptureDefaults.resolution.frameRate, 15);
  assert.equal(options.publishDefaults.audioPreset, speechPreset);
  assert.equal(options.publishDefaults.dtx, false, 'Study microphones must keep sending RTP during quiet focus periods.');
  assert.equal(options.publishDefaults.red, true, 'Study microphones must retain redundant-audio resilience.');
  assert.equal(options.publishDefaults.videoCodec, 'vp8');
  assert.equal(options.publishDefaults.videoEncoding.maxBitrate, 450_000);
  assert.equal(options.publishDefaults.videoEncoding.maxFramerate, 15);
  assert.equal(options.publishDefaults.simulcast, true);

  const cameraOptions = harness.hooks.cameraPublishOptions();
  assert.equal(cameraOptions.source, liveKitSources.Camera);
  assert.equal(cameraOptions.simulcast, true);
  assert.equal(cameraOptions.videoEncoding.maxBitrate, 450_000);
}

{
  const publication = {
    source: liveKitSources.Microphone,
    isMuted: false,
    track: fakeLocalTrack('audio', 'microphone-selected'),
  };
  publication.track.mediaStreamTrack.muted = true;
  const localParticipant = {
    identity: 'local-admin-transient-browser-mute',
    name: 'Participant 919',
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
  };
  assert.equal(
    harness.hooks.microphonePublicationIsLive(publication),
    true,
    'A transient browser MediaStreamTrack.muted flag must not falsely turn off a published microphone.',
  );
  harness.hooks.syncSelfMediaState();
  assert.equal(harness.document.getElementById('sr-microphone-state').textContent, 'On');
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
    async publishTrack(track, publishOptions) {
      const publication = {
        source: publishOptions?.source || liveKitSources.Camera,
        isMuted: false,
        track,
        async mute() {
          this.isMuted = true;
          this.track.isMuted = true;
        },
      };
      publications.set(publication.source, publication);
      return publication;
    },
    async setCameraEnabled(enabled, options, publishOptions) {
      rawCameraCalls.push({ enabled, options, publishOptions });
      if (!enabled) return undefined;
      const track = fakeLocalTrack('video', selectedDeviceId(options));
      track.stop = () => {
        track.stopped = true;
        track.mediaStreamTrack.readyState = 'ended';
      };
      track.attach = () => new FakeHTMLElement('raw-camera-video', 'video');
      track.detach = (element) => element?.remove?.();
      return this.publishTrack(track, publishOptions);
    },
    async unpublishTrack(track) {
      const publication = publications.get(liveKitSources.Camera);
      if (publication?.track === track) publications.delete(liveKitSources.Camera);
      return publication;
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
  assert.equal(rawCameraCalls.length, 1, 'Background off must start processor-free camera only after explicit camera-on.');
  assert.equal(rawCameraCalls[0].options.deviceId.exact, 'camera-selected');
  assert.equal(harness.backgroundCalls.filter(({ operation }) => operation === 'createController').length, 0);
  const initialCameraTrack = publications.get(liveKitSources.Camera).track;
  assert.equal(initialCameraTrack.getProcessor?.(), undefined, 'Off must not attach even a disabled processor.');
  assert.equal(harness.hooks.state.userApprovedRawCameraTracks.has(initialCameraTrack), true);
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'true');
  assert.equal(harness.document.getElementById('sr-camera-state').textContent, 'On');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'off');
  assert.match(harness.document.getElementById('sr-branded-backdrop-copy').textContent, /real background/iu);
  assert.equal(harness.document.getElementById('sr-toggle-backdrop').disabled, false,
    'Processor-free camera startup must not falsely disable supported background effects.');
  assert.equal(harness.document.getElementById('sr-background-file').disabled, false,
    'No allocated controller is not evidence that custom backgrounds are unsupported.');

  const backdropButton = harness.document.getElementById('sr-toggle-backdrop');
  await backdropButton.emit('click');
  const cameraEnableCalls = harness.backgroundCalls.filter(({ operation }) => operation === 'enableCamera');
  assert.equal(backdropButton.getAttribute('aria-pressed'), 'true');
  assert.equal(cameraEnableCalls.length, 1, 'Applying a background must establish one protected camera lifecycle.');
  assert.equal(cameraEnableCalls[0].captureOptions.deviceId.exact, 'camera-selected');
  assert.equal(cameraEnableCalls[0].publishOptions.source, liveKitSources.Camera);
  const selectedBackgroundCalls = harness.backgroundCalls.filter(({ operation }) => operation === 'switchBackground');
  assert.equal(selectedBackgroundCalls.length, 2, 'Selection and protected publication both confirm the chosen effect.');
  assert.ok(selectedBackgroundCalls.every(({ mode }) => mode === 'virtual-background'));
  assert.ok(harness.backgroundCalls.findIndex(({ operation }) => operation === 'switchBackground')
    < harness.backgroundCalls.findIndex(({ operation }) => operation === 'enableCamera'),
  'The chosen effect must be configured before a protected publication is enabled.');
  assert.equal(initialCameraTrack.stopped, true, 'The raw stream must stop before protected video replaces it.');
  assert.equal(harness.hooks.state.userApprovedRawCameraTracks.has(initialCameraTrack), false);
  const protectedCameraTrack = publications.get(liveKitSources.Camera).track;
  const protectedCameraProcessor = protectedCameraTrack.getProcessor();
  assert.notEqual(protectedCameraTrack, initialCameraTrack);
  assert.equal(protectedCameraProcessor.mode, 'virtual-background');
  assert.equal(protectedCameraTrack.mediaStreamTrack, protectedCameraProcessor.processedTrack);
  assert.equal(rawCameraCalls.length, 1, 'Selecting the background must not publish another raw stream.');
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'true');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'enabled');
  assert.match(harness.document.getElementById('sr-branded-backdrop-copy').textContent, /background.*active/iu);

  await backdropButton.emit('click');
  assert.equal(backdropButton.getAttribute('aria-pressed'), 'false');
  assert.equal(
    harness.backgroundCalls.filter(({ operation }) => operation === 'enableCamera').length,
    1,
    'Background off must not create a second protected camera lifecycle.',
  );
  assert.equal(harness.backgroundCalls.filter(({ operation }) => operation === 'destroy').length, 1);
  assert.equal(harness.hooks.state.backgroundController, null, 'Off must release the background controller.');
  assert.equal(rawCameraCalls.length, 2, 'Explicit Background off resumes processor-free video when the camera was on.');
  const resumedRawTrack = publications.get(liveKitSources.Camera).track;
  assert.notEqual(resumedRawTrack, protectedCameraTrack);
  assert.equal(resumedRawTrack.getProcessor?.(), undefined);
  assert.equal(harness.hooks.state.userApprovedRawCameraTracks.has(resumedRawTrack), true);
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'true');

  await cameraButton.emit('click');
  assert.equal(
    harness.backgroundCalls.filter(({ operation }) => operation === 'destroy').length,
    1,
    'Turning raw camera off must not allocate or destroy a new background processor.',
  );
  assert.equal(harness.backgroundCalls.filter(({ operation }) => operation === 'disableCamera').length, 0);
  assert.equal(rawCameraCalls.length, 2);
  assert.equal(resumedRawTrack.stopped, true, 'Camera off must stop the raw capture track.');
  assert.equal(publications.has(liveKitSources.Camera), false, 'Camera off must remove the raw publication.');
  assert.equal(harness.hooks.state.userApprovedRawCameraTracks.size, 0);
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'false');
  assert.equal(harness.document.getElementById('sr-camera-state').textContent, 'Off');
  assert.equal(harness.document.getElementById('sr-branded-backdrop-status').dataset.backdropState, 'off');
}

{
  const microphoneCalls = [];
  const switchCalls = [];
  const discardedTracks = [];
  const publications = new Map();
  const makeStatsTrack = (deviceId, progressing) => {
    let sample = 0;
    const track = fakeLocalTrack('audio', deviceId);
    track.getSenderStats = async () => {
      sample += 1;
      return {
        bytesSent: progressing && sample > 1 ? 320 : 0,
        packetsSent: progressing && sample > 1 ? 2 : 0,
      };
    };
    track.stop = () => {
      track.stopped = true;
    };
    return track;
  };
  const localParticipant = {
    identity: 'local-admin-stalled-transport',
    name: 'Participant 929',
    isLocal: true,
    trackPublications: publications,
    getTrackPublication: (source) => publications.get(source) || null,
    async setMicrophoneEnabled(enabled, captureOptions, publishOptions) {
      microphoneCalls.push({ enabled, captureOptions, publishOptions });
      const track = makeStatsTrack(
        microphoneCalls.length === 1 ? 'microphone-selected' : 'microphone-default',
        microphoneCalls.length > 1,
      );
      const publication = {
        source: liveKitSources.Microphone,
        isMuted: !enabled,
        track,
      };
      publications.set(liveKitSources.Microphone, publication);
      return publication;
    },
    async unpublishTrack(track) {
      discardedTracks.push(track);
      if (publications.get(liveKitSources.Microphone)?.track === track) {
        publications.delete(liveKitSources.Microphone);
      }
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: {
      Track: { Source: liveKitSources },
      AudioPresets: { speech: { maxBitrate: 24_000 } },
    },
    scheduleTimeout(callback) {
      callback();
      return 1;
    },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant,
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    getActiveDevice: () => 'microphone-selected',
    async switchActiveDevice(kind, deviceId, exact) {
      switchCalls.push({ kind, deviceId, exact });
      return true;
    },
  };
  harness.document.getElementById('sr-live-microphone-select').value = 'microphone-selected';

  await harness.document.getElementById('sr-toggle-microphone').emit('click');
  assert.equal(microphoneCalls.length, 2, 'A microphone with stalled outbound RTP must receive exactly one safe retry.');
  assert.equal(microphoneCalls[0].captureOptions.deviceId.exact, 'microphone-selected');
  assert.equal(selectedDeviceId(microphoneCalls[1].captureOptions), undefined);
  assert.equal(microphoneCalls[1].publishOptions.dtx, false);
  assert.equal(microphoneCalls[1].publishOptions.red, true);
  assert.equal(discardedTracks.length, 1);
  assert.equal(discardedTracks[0].stopped, true);
  assert.deepEqual(switchCalls, [{ kind: 'audioinput', deviceId: 'default', exact: false }]);
  assert.equal(harness.hooks.state.microphoneTransport, 'sending');
  assert.match(harness.document.getElementById('sr-live-media-status').textContent, /sending audio to the room/iu);
  assert.equal(harness.document.getElementById('sr-toggle-microphone').getAttribute('aria-pressed'), 'true');
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
  harness.hooks.state.isAdministrator = false;
  harness.hooks.renderParticipants();
  assert.equal(remoteAudioTrack.attachedElements.length, 1);
  assert.equal(remoteAudioTrack.attachedElements[0].volume, 1);

  let row = harness.hooks.createPersonRow(remoteParticipant);
  assert.equal(
    descendantWithText(row, 'Mute for room'),
    undefined,
    'Ordinary members must not expose room-wide administrator controls.',
  );
  assert.equal(descendantWithText(row, 'Remove'), undefined);
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
    requests.some((url) => String(url).includes('/study-room/moderate')),
    false,
    'Mute-for-me, volume, and block controls must remain local and reversible.',
  );
}

{
  let playCalls = 0;
  let startAudioCalls = 0;
  const remoteAudioTrack = {
    attach() {
      const element = new FakeHTMLElement('autoplay-recovery-audio', 'audio');
      element.play = async () => {
        playCalls += 1;
        if (playCalls === 1) throw new Error('Browser autoplay blocked');
      };
      return element;
    },
    detach() {},
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  const prompt = harness.document.getElementById('sr-audio-prompt');
  prompt.hidden = true;
  harness.hooks.state.room = {
    localParticipant: {
      identity: 'local-admin-audio-recovery',
      trackPublications: new Map(),
      getTrackPublication: () => null,
    },
    remoteParticipants: new Map(),
    connectionState: 'connected',
    canPlaybackAudio: true,
    async startAudio() {
      startAudioCalls += 1;
    },
  };
  harness.hooks.attachTrack(
    remoteAudioTrack,
    harness.document.getElementById('sr-audio-bin'),
    'audio',
  );
  await eventually(() => prompt.hidden === false, 'A blocked remote audio element did not expose the recovery prompt.');
  await prompt.emit('click');
  assert.equal(startAudioCalls, 1);
  assert.equal(playCalls, 2, 'The recovery gesture must retry each attached remote audio element.');
  assert.equal(prompt.hidden, true);
  assert.equal(harness.hooks.state.audioPlaybackBlocked, false);
}

{
  let cameraAttachCount = 0;
  let cameraDetachCount = 0;
  let screenAttachCount = 0;
  let screenDetachCount = 0;
  const makeVideoTrack = (kind) => ({
    mediaStreamTrack: {
      readyState: 'live',
      enabled: true,
      muted: false,
      getSettings: () => ({ deviceId: `${kind}-device` }),
    },
    attach() {
      if (kind === 'camera') cameraAttachCount += 1;
      else screenAttachCount += 1;
      return new FakeHTMLElement(`${kind}-video`, 'video');
    },
    detach(element) {
      if (kind === 'camera') cameraDetachCount += 1;
      else screenDetachCount += 1;
      element?.remove?.();
    },
  });
  const cameraTrack = makeVideoTrack('camera');
  const screenTrack = makeVideoTrack('screen');
  const cameraPublication = {
    source: liveKitSources.Camera,
    trackSid: 'camera-publication',
    isMuted: false,
    track: cameraTrack,
  };
  const screenPublication = {
    source: liveKitSources.ScreenShare,
    trackSid: 'screen-publication',
    isMuted: true,
    track: screenTrack,
  };
  const publications = new Map([
    [liveKitSources.Camera, cameraPublication],
    [liveKitSources.ScreenShare, screenPublication],
  ]);
  const localParticipant = {
    identity: 'local-self-view',
    name: 'Participant 505',
    isLocal: true,
    attributes: {},
    trackPublications: publications,
    getTrackPublication: (source) => publications.get(source) || null,
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
    state: 'connected',
    canPlaybackAudio: true,
  };
  harness.hooks.state.backdropEnabled = false;
  harness.hooks.state.userApprovedRawCameraTracks.add(cameraTrack);

  harness.hooks.renderParticipants();
  const participantGrid = harness.document.getElementById('sr-participant-grid');
  let gridReplaceChildrenCount = 0;
  const originalReplaceChildren = participantGrid.replaceChildren.bind(participantGrid);
  participantGrid.replaceChildren = (...children) => {
    gridReplaceChildrenCount += 1;
    return originalReplaceChildren(...children);
  };
  let tiles = harness.document.getElementById('sr-participant-grid').children;
  assert.equal(tiles.length, 1, 'The local camera must create one self-view tile.');
  assert.equal(tiles[0].dataset.trackSource, liveKitSources.Camera);
  assert.equal(tiles[0].dataset.mediaVisible, 'true', 'An approved raw local camera must be visible to its owner.');
  assert.equal(cameraAttachCount, 1);

  localParticipant.name = 'Participant 506';
  harness.hooks.renderParticipants();
  tiles = harness.document.getElementById('sr-participant-grid').children;
  assert.equal(gridReplaceChildrenCount, 0, 'A metadata-only rerender must not replace the stable tile DOM tree.');
  assert.equal(cameraAttachCount, 1, 'A metadata-only rerender must preserve the attached local video element.');
  assert.equal(cameraDetachCount, 0, 'A metadata-only rerender must not detach the local video element.');

  screenPublication.isMuted = false;
  harness.hooks.renderParticipants();
  tiles = harness.document.getElementById('sr-participant-grid').children;
  assert.equal(tiles.length, 2, 'A presenter camera and shared screen must render as separate media views.');
  assert.equal(tiles[0].dataset.trackSource, liveKitSources.ScreenShare);
  assert.equal(tiles[1].dataset.trackSource, liveKitSources.Camera);
  assert.equal(harness.document.getElementById('sr-participant-grid').dataset.presenting, 'true');
  assert.equal(cameraAttachCount, 1, 'Starting a screen share must not remount the presenter camera.');
  assert.equal(screenAttachCount, 1);

  const makeRemoteParticipant = (identity) => {
    const remoteCameraPublication = {
      source: liveKitSources.Camera,
      trackSid: `${identity}-camera-publication`,
      isMuted: false,
      track: makeVideoTrack('camera'),
    };
    return {
      identity,
      name: identity,
      isLocal: false,
      attributes: {},
      trackPublications: new Map([[liveKitSources.Camera, remoteCameraPublication]]),
      getTrackPublication: (source) => source === liveKitSources.Camera ? remoteCameraPublication : null,
    };
  };
  const pinnedRemote = makeRemoteParticipant('pinned-remote');
  const activeRemote = makeRemoteParticipant('active-remote');
  harness.hooks.state.pinnedParticipantIdentity = pinnedRemote.identity;
  harness.hooks.state.activeSpeakers.add(activeRemote.identity);
  const presentationViews = harness.hooks.buildMediaViews([localParticipant, pinnedRemote, activeRemote]);
  const companionViews = presentationViews.filter((view) => view.isCompanion);
  assert.equal(companionViews.length, 2, 'Presentation mode must keep exactly two camera companions.');
  assert.ok(
    companionViews.some((view) => view.participant.isLocal),
    'The local self-view must remain one of the two companions even when different remote participants are pinned and active.',
  );
  assert.ok(
    companionViews.some((view) => view.participant.identity === pinnedRemote.identity),
    'The remaining companion must respect a manual pin, not the current speaker.',
  );
  harness.hooks.state.layoutMode = 'spotlight';
  harness.hooks.state.pinnedTrackKey = `${pinnedRemote.identity}:${liveKitSources.Camera}`;
  const spotlightViews = harness.hooks.buildMediaViews([localParticipant, pinnedRemote, activeRemote]);
  assert.equal(spotlightViews[0].key, harness.hooks.state.pinnedTrackKey, 'Spotlight must put the pinned camera first even while a screen is shared.');
  harness.hooks.state.layoutMode = 'auto';
  harness.hooks.state.pinnedTrackKey = '';
  harness.hooks.state.room.remoteParticipants = new Map([
    [pinnedRemote.identity, pinnedRemote],
    [activeRemote.identity, activeRemote],
  ]);
  harness.hooks.state.pinnedParticipantIdentity = '';
  harness.hooks.state.activeSpeakers = new Set([activeRemote.identity]);
  harness.hooks.renderParticipants();
  let stableCompanion = harness.document.getElementById('sr-participant-grid').children.find((tile) => (
    String(tile.className).includes('is-companion') && !String(tile.className).includes('is-self')
  ));
  assert.equal(stableCompanion?.dataset.participantIdentity, pinnedRemote.identity,
    'An unpinned companion must follow participant insertion order, not the current speaker.');
  const cameraAttachmentsBeforeSpeakerChange = cameraAttachCount;
  harness.hooks.state.activeSpeakers = new Set([pinnedRemote.identity]);
  harness.hooks.renderParticipants();
  stableCompanion = harness.document.getElementById('sr-participant-grid').children.find((tile) => (
    String(tile.className).includes('is-companion') && !String(tile.className).includes('is-self')
  ));
  assert.equal(stableCompanion?.dataset.participantIdentity, pinnedRemote.identity, 'Changing the active speaker must leave the companion unchanged.');
  assert.equal(
    cameraAttachCount,
    cameraAttachmentsBeforeSpeakerChange,
    'Changing the active speaker must not remount any camera track.',
  );
  assert.equal(cameraDetachCount, 0, 'Changing the active speaker must not detach camera tracks.');

  const eventHandlers = new Map();
  harness.window.LivekitClient.RoomEvent = { ActiveSpeakersChanged: 'active-speakers',
    TrackMuted: 'track-muted', TrackUnmuted: 'track-unmuted' };
  harness.hooks.state.room.on = (name, callback) => {
    const handlers = eventHandlers.get(name) || [];
    handlers.push(callback); eventHandlers.set(name, handlers);
  };
  harness.hooks.bindRoomEvents(harness.hooks.state.room);
  assert.equal(eventHandlers.get('active-speakers')?.length, 1);
  const speakersChanged = eventHandlers.get('active-speakers')[0];
  publications.set(liveKitSources.Microphone, { source: liveKitSources.Microphone, isMuted: false,
    track: { isMuted: false, mediaStreamTrack: { readyState: 'live', enabled: true, muted: false } } });
  const mediaKeys = () => Array.from(participantGrid.children, (tile) => tile.dataset.mediaKey);
  const companionKeys = () => Array.from(participantGrid.children)
    .filter((tile) => String(tile.className).includes('is-companion')).map((tile) => tile.dataset.mediaKey);
  let layoutRequests = 0;
  let domCreations = 0;
  const previousRaf = harness.window.requestAnimationFrame;
  const previousCreateElement = harness.document.createElement.bind(harness.document);
  harness.window.requestAnimationFrame = () => { layoutRequests += 1; return 1; };
  harness.document.createElement = (...args) => { domCreations += 1; return previousCreateElement(...args); };
  for (const layout of ['auto', 'tiled', 'spotlight']) {
    for (const presenting of [false, true]) {
      const scenario = `${layout}, presenting=${presenting}`;
      harness.hooks.state.layoutMode = layout;
      harness.hooks.state.pinnedTrackKey = '';
      harness.hooks.state.pinnedParticipantIdentity = '';
      harness.hooks.state.activeSpeakers.clear();
      screenPublication.isMuted = !presenting;
      harness.hooks.renderParticipants();
      const originalOrder = mediaKeys();
      const originalCompanions = companionKeys();
      const originalTiles = [...participantGrid.children];
      const originalCounts = { grid: gridReplaceChildrenCount, layout: layoutRequests, dom: domCreations,
        attach: cameraAttachCount, detach: cameraDetachCount, screenAttach: screenAttachCount, screenDetach: screenDetachCount };
      for (const speakers of [[activeRemote], [pinnedRemote], [localParticipant], [],
        [activeRemote, pinnedRemote], [pinnedRemote, activeRemote], [activeRemote], [], [localParticipant]]) {
        speakersChanged(speakers);
        assert.deepEqual(mediaKeys(), originalOrder, `Speaker events must not reorder tiles (${scenario}).`);
        assert.deepEqual(companionKeys(), originalCompanions, `Speaker events must not switch screen companions (${scenario}).`);
        assert.ok(participantGrid.children.every((tile, index) => tile === originalTiles[index]),
          `Speaker events must preserve every tile object (${scenario}).`);
        for (const tile of participantGrid.children) {
          assert.equal(tile.classList.contains('is-speaking'), speakers.some((speaker) => speaker.identity === tile.dataset.participantIdentity),
            `Speaking CSS must reflect the actual event without rebuilding (${scenario}).`);
        }
      }
      assert.deepEqual({ grid: gridReplaceChildrenCount, layout: layoutRequests, dom: domCreations,
        attach: cameraAttachCount, detach: cameraDetachCount, screenAttach: screenAttachCount, screenDetach: screenDetachCount },
      originalCounts, `Speaker events must do zero grid replacement, layout scheduling, DOM creation, or track remounting (${scenario}).`);
      assert.equal(harness.hooks.state.microphoneTransport, 'sending',
        `Speaking updates must retain the local microphone transport indicator (${scenario}).`);

      const firstRemoteCamera = pinnedRemote.getTrackPublication(liveKitSources.Camera);
      for (const muted of [true, false, true, false]) {
        firstRemoteCamera.isMuted = muted;
        for (const callback of eventHandlers.get(muted ? 'track-muted' : 'track-unmuted')) callback();
        assert.deepEqual(mediaKeys(), originalOrder, `Camera mute/unmute must preserve tile order (${scenario}).`);
        assert.deepEqual(companionKeys(), originalCompanions, `Camera mute/unmute must preserve companion identities (${scenario}).`);
      }
      const manualPin = participantGrid.children.find((tile) => tile.dataset.participantIdentity === activeRemote.identity).__srPin;
      const pinBaseline = { attach: cameraAttachCount, detach: cameraDetachCount };
      await manualPin.emit('click');
      const pinnedKey = `${activeRemote.identity}:${liveKitSources.Camera}`;
      const pinPosition = layout === 'auto' && presenting ? 1 : 0;
      assert.equal(mediaKeys()[pinPosition], pinnedKey, `An explicit manual pin moves the tile to the first camera position (${scenario}).`);
      if (pinPosition === 1) assert.equal(mediaKeys()[0], `${localParticipant.identity}:${liveKitSources.ScreenShare}`,
        'Auto presentation must preserve the shared-screen cell while promoting the pinned camera companion.');
      assert.deepEqual(mediaKeys().filter((key) => key !== pinnedKey), originalOrder.filter((key) => key !== pinnedKey),
        `Manual pinning must preserve the relative order of all other tiles (${scenario}).`);
      const manuallyPinnedOrder = mediaKeys();
      const manuallyPinnedCompanions = companionKeys();
      speakersChanged([pinnedRemote]);
      speakersChanged([localParticipant]);
      assert.deepEqual(mediaKeys(), manuallyPinnedOrder, `Talking cannot displace a manual pin (${scenario}).`);
      assert.deepEqual(companionKeys(), manuallyPinnedCompanions, `Talking cannot switch a pinned companion (${scenario}).`);
      await manualPin.emit('click');
      assert.deepEqual(mediaKeys(), originalOrder, `Unpin restores the stable insertion order (${scenario}).`);
      assert.deepEqual(companionKeys(), originalCompanions, `Unpin restores stable companions (${scenario}).`);
      assert.deepEqual({ attach: cameraAttachCount, detach: cameraDetachCount }, pinBaseline,
        `Pin/unpin must not remount or detach camera tracks (${scenario}).`);
    }
  }
  const currentRoom = harness.hooks.state.room;
  const currentSpeakers = harness.hooks.state.activeSpeakers;
  const staleCounts = { grid: gridReplaceChildrenCount, layout: layoutRequests, dom: domCreations };
  harness.hooks.state.room = { ...currentRoom };
  speakersChanged([activeRemote]);
  assert.equal(harness.hooks.state.activeSpeakers, currentSpeakers, 'A stale room speaker event must not change the current room.');
  assert.deepEqual({ grid: gridReplaceChildrenCount, layout: layoutRequests, dom: domCreations }, staleCounts);
  harness.hooks.state.room = currentRoom;
  publications.delete(liveKitSources.Microphone);
  harness.window.requestAnimationFrame = previousRaf;
  harness.document.createElement = previousCreateElement;
  harness.hooks.state.layoutMode = 'auto';
  screenPublication.isMuted = false;
  harness.hooks.state.room.remoteParticipants.clear();
  harness.hooks.state.activeSpeakers.clear();
  harness.hooks.renderParticipants();
  harness.hooks.state.pinnedParticipantIdentity = '';
  harness.hooks.state.activeSpeakers.clear();

  const cameraDetachCountBeforeStoppingShare = cameraDetachCount;
  const screenDetachCountBeforeStoppingShare = screenDetachCount;
  screenPublication.isMuted = true;
  harness.hooks.renderParticipants();
  tiles = harness.document.getElementById('sr-participant-grid').children;
  assert.equal(tiles.length, 1, 'Stopping a screen share must remove only the shared-screen view.');
  assert.equal(tiles[0].dataset.trackSource, liveKitSources.Camera);
  assert.equal(screenDetachCount, screenDetachCountBeforeStoppingShare + 1);
  assert.equal(
    cameraDetachCount,
    cameraDetachCountBeforeStoppingShare,
    'Stopping a screen share must preserve the self camera attachment.',
  );

  await harness.hooks.toggleCompactView();
  assert.equal(harness.hooks.state.compactMode, true, 'Compact view must provide an in-page fallback when native PiP is unavailable.');
  assert.equal(harness.document.body.classList.contains('sr-compact-mode'), true);
  await harness.hooks.toggleCompactView();
  assert.equal(harness.hooks.state.compactMode, false);
  assert.equal(harness.document.body.classList.contains('sr-compact-mode'), false);

  for (const viewport of [
    [1440, 760],
    [900, 760],
    [640, 520],
    [390, 620],
    [320, 460],
  ]) {
    const layout = harness.hooks.calculateSquareGrid(4, viewport[0], viewport[1], 10);
    assert.ok(layout.columns * layout.rows >= 4);
    assert.ok(layout.size >= 88, `Square layout failed at ${viewport.join('x')}.`);
  }
}

// Real receiver code, inert transport and deterministic timers. No SDK events
// are synthesized to rescue a stalled element: the receiver must recover itself.
{
  const timers = new Map();
  const clearedTimers = [];
  let timerId = 0;
  let attachCalls = 0;
  let detachCalls = 0;
  let playCalls = 0;
  let playMode = 'resolve-without-data';
  const deferredPlays = [];
  const shareTrack = {
    streamState: 'active',
    mediaStreamTrack: { kind: 'video', readyState: 'live', enabled: true },
    attach() {
      attachCalls += 1;
      const element = new FakeHTMLElement('receiver-share', 'video');
      element.readyState = 0;
      element.videoWidth = 0;
      element.videoHeight = 0;
      element.paused = true;
      element.play = () => {
        playCalls += 1;
        if (playMode === 'reject') return Promise.reject(new Error('transient playback error'));
        if (playMode === 'defer') return new Promise((resolve, reject) => deferredPlays.push({ resolve, reject }));
        if (playMode === 'playing') {
          element.readyState = 2;
          element.videoWidth = 1280;
          element.videoHeight = 720;
          element.paused = false;
        }
        return Promise.resolve();
      };
      return element;
    },
    detach() { detachCalls += 1; },
  };
  const publication = { source: liveKitSources.ScreenShare, track: shareTrack, isMuted: false };
  const remote = {
    identity: 'screen-recovery-remote', name: 'Remote', isLocal: false, attributes: {},
    trackPublications: new Map([[liveKitSources.ScreenShare, publication]]),
    getTrackPublication(source) { return this.trackPublications.get(source); },
  };
  const local = {
    identity: 'screen-recovery-local', name: 'Local', isLocal: true, attributes: {},
    trackPublications: new Map(), getTrackPublication() { return null; },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(), enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Camera capture is forbidden in receiver tests.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.window.setTimeout = (callback, delay) => {
    const id = ++timerId; timers.set(id, { callback, delay }); return id;
  };
  harness.window.clearTimeout = (id) => {
    if (timers.has(id)) clearedTimers.push(timers.get(id).callback);
    timers.delete(id);
  };
  const settle = async () => { for (let count = 0; count < 6; count += 1) await Promise.resolve(); };
  const runTimer = async () => {
    const [id, timer] = timers.entries().next().value || [];
    assert.ok(timer, 'A bounded same-element recovery timer must exist.');
    timers.delete(id); timer.callback(); await settle();
  };
  const room = { localParticipant: local, remoteParticipants: new Map([[remote.identity, remote]]), state: 'connected' };
  harness.hooks.state.room = room;
  const grid = harness.document.getElementById('sr-participant-grid');
  const shareTile = () => grid.children.find((tile) => tile.dataset.trackSource === liveKitSources.ScreenShare);
  const shareVideo = () => descendants(shareTile()).find((node) => node.tagName === 'VIDEO');
  const fallback = () => descendants(shareTile()).find((node) => node.dataset.srVideoFallback === 'true');
  harness.hooks.renderParticipants();
  await settle();
  const originalTile = shareTile();
  const originalVideo = shareVideo();
  assert.notEqual(originalTile.dataset.videoState, 'live', 'Resolving play() without decoded data must not falsely report live video.');
  assert.equal(originalVideo.hidden, false, 'Pending remote video must remain visible to adaptive streaming.');
  assert.equal(timers.size, 1, 'A pending play promise/data arrival must have one bounded watchdog.');
  await originalVideo.emit('stalled');
  assert.equal(originalVideo.hidden, false, 'A transient stall must not hide the SDK-observed element.');
  for (let count = 0; count < 5; count += 1) harness.hooks.renderParticipants();
  assert.equal(shareTile(), originalTile, 'Unrelated room renders must preserve a recovering tile.');
  assert.equal(shareVideo(), originalVideo, 'Unrelated room renders must preserve the same video element.');
  assert.equal(attachCalls, 1);
  assert.equal(detachCalls, 0);
  playMode = 'playing';
  await runTimer();
  assert.equal(originalTile.dataset.videoState, 'live', 'A retry must restore playback without another SDK event.');
  assert.equal(fallback().hidden, true);
  assert.equal(timers.size, 0, 'Decoded playback must cancel its recovery watchdog.');
  const stablePlayCalls = playCalls;
  await originalVideo.emit('stalled');
  assert.equal(fallback().hidden, true, 'A static shared screen with a decoded frame must not be blanked on stalled.');
  assert.equal(timers.size, 0);
  assert.equal(playCalls, stablePlayCalls);

  shareTrack.streamState = 'paused';
  harness.hooks.renderParticipants();
  assert.equal(shareTile(), originalTile, 'An actual SDK track.streamState pause must preserve the tile.');
  assert.equal(shareVideo(), originalVideo, 'Pausing must preserve the visibility observer that can resume the subscription.');
  assert.equal(originalVideo.hidden, false);
  assert.equal(originalTile.dataset.mediaVisible, 'false');
  shareTrack.streamState = 'active';
  harness.hooks.renderParticipants();
  await settle();
  assert.equal(shareVideo(), originalVideo);
  assert.equal(detachCalls, 0);

  originalVideo.readyState = 0; originalVideo.videoWidth = 0; originalVideo.videoHeight = 0;
  originalVideo.paused = true; playMode = 'reject';
  await originalVideo.emit('emptied');
  await settle();
  const beforeRetries = playCalls;
  for (let count = 0; count < 3; count += 1) await runTimer();
  assert.equal(playCalls - beforeRetries, 3, 'One incident must have exactly three automatic retry attempts.');
  assert.equal(timers.size, 0, 'Persistent failures must stop retrying instead of looping.');
  assert.equal(originalVideo.hidden, false, 'Even exhausted retries must not deadlock adaptive visibility.');
  for (let count = 0; count < 8; count += 1) {
    await originalVideo.emit('stalled'); harness.hooks.renderParticipants();
  }
  assert.equal(timers.size, 0, 'Repeated stalled and room events must not reset an exhausted incident.');
  const retry = descendants(fallback()).find((node) => node.dataset.srVideoRetry === 'true');
  assert.ok(retry && !retry.hidden, 'Exhaustion must offer an explicit, bounded Retry video control.');
  playMode = 'defer';
  await retry.emit('click'); await settle();
  assert.equal(deferredPlays.length, 1);
  originalVideo.readyState = 2; originalVideo.videoWidth = 1280; originalVideo.videoHeight = 720; originalVideo.paused = false;
  await originalVideo.emit('playing');
  deferredPlays[0].reject(new Error('older play request failed after recovery'));
  await settle();
  assert.equal(originalTile.dataset.videoState, 'live', 'A stale play rejection cannot blank a newer decoded frame.');
  assert.equal(fallback().hidden, true);

  originalVideo.readyState = 0; originalVideo.paused = true; playMode = 'defer';
  await originalVideo.emit('emptied');
  const staleTimer = timers.values().next().value.callback;
  publication.isMuted = true;
  harness.hooks.renderParticipants();
  const callsBeforeRemoval = playCalls;
  staleTimer(); await settle();
  for (const callback of clearedTimers) callback();
  await originalVideo.emit('playing'); await settle();
  assert.equal(playCalls, callsBeforeRemoval, 'Detached/stale timers must not play a removed screen share.');
  assert.equal(timers.size, 0);
  assert.equal([...originalVideo.listeners.values()].flat().length, 0, 'Detach must remove owned video event listeners.');
  assert.equal(shareTile(), undefined);

  publication.isMuted = false; shareTrack.streamState = 'paused'; playMode = 'playing';
  harness.hooks.renderParticipants(); await settle();
  const initiallyPausedVideo = shareVideo();
  assert.ok(initiallyPausedVideo, 'An initially paused remote publication still needs an observed video element to resume.');
  assert.equal(initiallyPausedVideo.hidden, false);
  shareTrack.streamState = 'active'; harness.hooks.renderParticipants(); await settle();
  assert.equal(shareVideo(), initiallyPausedVideo);
  assert.equal(shareTile().dataset.videoState, 'live');

  initiallyPausedVideo.readyState = 0; initiallyPausedVideo.paused = true; playMode = 'reject';
  await initiallyPausedVideo.emit('emptied');
  const beforeBlock = playCalls;
  harness.hooks.state.blockedParticipants.add(remote.identity);
  harness.hooks.renderParticipants();
  for (const callback of clearedTimers) callback();
  await settle();
  assert.equal(playCalls, beforeBlock);
  assert.equal(timers.size, 0, 'Blocking a participant must cancel their video recovery.');
  harness.hooks.state.blockedParticipants.clear();
  harness.hooks.renderParticipants(); await settle();
  const beforeLeave = playCalls;
  const leaveTimer = timers.values().next().value?.callback;
  harness.hooks.detachTracks(); harness.hooks.state.room = null;
  leaveTimer?.(); await settle();
  assert.equal(playCalls, beforeLeave);
  assert.equal(timers.size, 0, 'Leaving must cancel all video recovery timers.');
  console.log('Study Room receiver recovery: pending data, stalled static frame, finite playback retries, paused attach/resume, stable nodes, stale work and teardown passed.');
}

{
  const shareAudioSource = 'screen_share_audio';
  const sources = { ...liveKitSources, ScreenShareAudio: shareAudioSource };
  const attachCounts = new Map();
  const detachCounts = new Map();
  const volumeBySource = new Map();
  let shareAudioAllowed = false;
  let delayedAudio = false;
  const deferredAudio = [];
  const makeAudioTrack = (source) => ({
    attach() {
      attachCounts.set(source, (attachCounts.get(source) || 0) + 1);
      const audio = new FakeHTMLElement(source, 'audio');
      audio.play = () => {
        if (source === shareAudioSource && delayedAudio) {
          return new Promise((resolve, reject) => deferredAudio.push({ resolve, reject }));
        }
        return source !== shareAudioSource || shareAudioAllowed
          ? Promise.resolve() : Promise.reject(new Error('User gesture required for shared audio'));
      };
      return audio;
    },
    detach() { detachCounts.set(source, (detachCounts.get(source) || 0) + 1); },
  });
  const microphone = { source: sources.Microphone, isMuted: false, track: makeAudioTrack(sources.Microphone) };
  const sharedAudio = { source: shareAudioSource, isMuted: false, track: makeAudioTrack(shareAudioSource) };
  const remote = {
    identity: 'shared-audio-remote', name: 'Remote', isLocal: false, attributes: {},
    trackPublications: new Map([[sources.Microphone, microphone], [shareAudioSource, sharedAudio]]),
    getTrackPublication(source) { return this.trackPublications.get(source); },
    setVolume(value, source = sources.Microphone) { volumeBySource.set(source, value); },
  };
  const local = {
    identity: 'shared-audio-local', name: 'Local', isLocal: true, attributes: {},
    trackPublications: new Map([[shareAudioSource, sharedAudio]]),
    getTrackPublication(source) { return this.trackPublications.get(source); },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(), enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('No real microphone or camera may be captured.'); },
    liveKit: { Track: { Source: sources } },
  });
  await waitForAuthorizedPrejoin(harness);
  const settle = async () => { for (let count = 0; count < 6; count += 1) await Promise.resolve(); };
  harness.hooks.state.room = { localParticipant: local,
    remoteParticipants: new Map([[remote.identity, remote]]), state: 'connected', canPlaybackAudio: true,
    async startAudio() {},
  };
  harness.hooks.renderParticipants(); await settle();
  const audioEntries = () => harness.hooks.state.attachedTracks.filter((entry) => entry.kind === 'audio');
  assert.deepEqual(Array.from(audioEntries(), (entry) => entry.key).sort(),
    [`audio:${remote.identity}`, `audio:${remote.identity}:screen_share_audio`],
    'Receiver must attach remote microphone and shared-video audio independently, never local loopback.');
  assert.equal(harness.hooks.state.audioPlaybackBlocked, true,
    'Successful microphone playback must not hide a blocked shared-audio track.');
  assert.equal(harness.document.getElementById('sr-audio-prompt').hidden, false);
  assert.equal(await harness.hooks.startRoomAudioFromGesture(), false);
  assert.equal(harness.hooks.state.audioPlaybackBlocked, true);
  shareAudioAllowed = true;
  assert.equal(await harness.hooks.startRoomAudioFromGesture(), true);
  assert.equal(harness.hooks.state.audioPlaybackBlocked, false);
  assert.equal(harness.document.getElementById('sr-audio-prompt').hidden, true);
  for (let count = 0; count < 4; count += 1) harness.hooks.renderParticipants();
  assert.equal(attachCounts.get(sources.Microphone), 1);
  assert.equal(attachCounts.get(shareAudioSource), 1, 'Room rerenders must not duplicate shared audio playback.');
  harness.hooks.setParticipantVolume(remote, 31);
  assert.equal(volumeBySource.get(sources.Microphone), 0.31);
  assert.equal(volumeBySource.get(shareAudioSource), 0.31, 'The existing participant volume must also govern shared video audio.');
  const microphoneEntry = audioEntries().find((entry) => entry.key === `audio:${remote.identity}`);
  sharedAudio.isMuted = true; harness.hooks.renderParticipants();
  assert.equal(audioEntries().length, 1);
  assert.equal(audioEntries()[0], microphoneEntry, 'Stopping shared audio must preserve the microphone attachment.');
  assert.equal(detachCounts.get(shareAudioSource), 1);
  sharedAudio.isMuted = false; harness.hooks.renderParticipants(); await settle();
  assert.equal(audioEntries().length, 2);
  assert.equal(attachCounts.get(sources.Microphone), 1);
  remote.trackPublications.delete(shareAudioSource); harness.hooks.renderParticipants();
  assert.equal(audioEntries().length, 1);
  assert.equal(audioEntries()[0], microphoneEntry);
  remote.trackPublications.set(shareAudioSource, sharedAudio); harness.hooks.renderParticipants(); await settle();
  harness.hooks.state.localMutedParticipants.add(remote.identity); harness.hooks.renderParticipants();
  assert.equal(audioEntries().length, 0, 'Mute for me must silence microphone and shared audio.');
  harness.hooks.state.localMutedParticipants.clear(); harness.hooks.renderParticipants(); await settle();
  harness.hooks.state.blockedParticipants.add(remote.identity); harness.hooks.renderParticipants();
  assert.equal(audioEntries().length, 0, 'Local blocking must silence both audio sources.');
  delayedAudio = true;
  harness.hooks.state.blockedParticipants.clear(); harness.hooks.renderParticipants(); await settle();
  assert.equal(deferredAudio.length, 1);
  remote.trackPublications.delete(shareAudioSource); harness.hooks.renderParticipants();
  deferredAudio[0].reject(new Error('old removed share audio playback rejected'));
  await settle();
  assert.equal(harness.hooks.state.audioPlaybackBlocked, false, 'A removed audio element cannot re-open the current audio prompt.');
  harness.hooks.detachTracks();
  assert.equal(audioEntries().length, 0);
  console.log('Study Room shared audio: dual-source playback, no loopback/duplicates, gesture gating, volume, selective unpublish, local mute/block and stale-promise cleanup passed.');
}

{
  let endedAttachCount = 0;
  const endedTrack = {
    mediaStreamTrack: {
      kind: 'video',
      readyState: 'ended',
      enabled: true,
      muted: false,
    },
    attach() {
      endedAttachCount += 1;
      return new FakeHTMLElement('ended-video', 'video');
    },
    detach() {},
  };
  const remotePublication = {
    source: liveKitSources.Camera,
    isMuted: false,
    track: endedTrack,
  };
  const remoteParticipant = {
    identity: 'remote-ended-track',
    name: 'Remote ended track',
    isLocal: false,
    attributes: {},
    trackPublications: new Map([[liveKitSources.Camera, remotePublication]]),
    getTrackPublication: (source) => source === liveKitSources.Camera ? remotePublication : null,
  };
  const localParticipant = {
    identity: 'local-ended-track',
    name: 'Local participant',
    isLocal: true,
    attributes: {},
    trackPublications: new Map(),
    getTrackPublication: () => null,
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
    remoteParticipants: new Map([[remoteParticipant.identity, remoteParticipant]]),
    state: 'connected',
    canPlaybackAudio: true,
  };
  harness.hooks.renderParticipants();
  const tile = harness.document.getElementById('sr-participant-grid').children.find(
    (candidate) => candidate.dataset.participantIdentity === remoteParticipant.identity,
  );
  assert.equal(endedAttachCount, 0, 'An ended remote video track must not be attached to the DOM.');
  assert.equal(tile?.dataset.mediaVisible, 'false', 'An ended remote video track must render as unavailable.');
  assert.equal(
    tile?.children.some((child) => child.tagName === 'VIDEO'),
    false,
    'An ended remote video track must show a placeholder instead of a stale video element.',
  );
}

{
  let attachErrorCount = 0;
  let playErrorCount = 0;
  const makeParticipant = (identity, track) => {
    const publication = {
      source: liveKitSources.Camera,
      isMuted: false,
      track,
    };
    return {
      identity,
      name: identity,
      isLocal: false,
      attributes: {},
      trackPublications: new Map([[liveKitSources.Camera, publication]]),
      getTrackPublication: (source) => source === liveKitSources.Camera ? publication : null,
    };
  };
  const attachErrorTrack = {
    mediaStreamTrack: { kind: 'video', readyState: 'live', enabled: true },
    attach() {
      attachErrorCount += 1;
      throw new Error('video element could not be created');
    },
    detach() {},
  };
  const playErrorTrack = {
    mediaStreamTrack: { kind: 'video', readyState: 'live', enabled: true },
    attach() {
      const element = new FakeHTMLElement('play-error-video', 'video');
      element.play = async () => {
        playErrorCount += 1;
        throw new Error('video playback failed');
      };
      return element;
    },
    detach(element) {
      element?.remove?.();
    },
  };
  const attachErrorParticipant = makeParticipant('remote-attach-error', attachErrorTrack);
  const playErrorParticipant = makeParticipant('remote-play-error', playErrorTrack);
  const localParticipant = {
    identity: 'local-video-errors',
    name: 'Local participant',
    isLocal: true,
    attributes: {},
    trackPublications: new Map(),
    getTrackPublication: () => null,
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
    remoteParticipants: new Map([
      [attachErrorParticipant.identity, attachErrorParticipant],
      [playErrorParticipant.identity, playErrorParticipant],
    ]),
    state: 'connected',
    canPlaybackAudio: true,
  };
  assert.doesNotThrow(() => harness.hooks.renderParticipants(), 'A video attach exception must not break participant rendering.');
  const attachErrorTile = harness.document.getElementById('sr-participant-grid').children.find(
    (candidate) => candidate.dataset.participantIdentity === attachErrorParticipant.identity,
  );
  assert.equal(attachErrorCount, 1);
  assert.equal(attachErrorTile?.dataset.mediaVisible, 'false');
  assert.equal(
    descendants(attachErrorTile).some((child) => child.textContent === 'Video unavailable — reconnecting'),
    true,
    'A video attach exception must show a recoverable placeholder.',
  );

  const playErrorTile = harness.document.getElementById('sr-participant-grid').children.find(
    (candidate) => candidate.dataset.participantIdentity === playErrorParticipant.identity,
  );
  const playErrorVideo = descendants(playErrorTile).find((child) => child.tagName === 'VIDEO');
  await eventually(() => playErrorCount === 1 && playErrorTile?.dataset.videoState === 'unavailable', 'A rejected video play promise did not expose the recovery state.');
  assert.equal(playErrorVideo.hidden, false, 'A rejected play must retain adaptive-stream visibility behind the fallback.');
  const fallback = descendants(playErrorTile).find((child) => child.dataset.srVideoFallback === 'true');
  assert.equal(fallback.hidden, false);

  playErrorVideo.play = async () => {};
  playErrorVideo.readyState = 2;
  playErrorVideo.videoWidth = 640;
  playErrorVideo.videoHeight = 360;
  playErrorVideo.paused = false;
  await playErrorVideo.emit('playing');
  assert.equal(playErrorVideo.hidden, false, 'A later playing event must restore the video element.');
  assert.equal(fallback.hidden, true, 'A recovered video must hide its fallback placeholder.');
  assert.equal(playErrorTile.dataset.videoState, 'live');
}

{
  let disconnectCalls = 0;
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.hooks.state.room = {
    localParticipant: {
      identity: 'local-background-click',
      name: 'Local participant',
      isLocal: true,
      trackPublications: new Map(),
      getTrackPublication: () => null,
    },
    remoteParticipants: new Map(),
    state: 'connected',
    disconnect() {
      disconnectCalls += 1;
    },
  };
  harness.document.emit('click', { target: harness.document.body });
  assert.equal(disconnectCalls, 0, 'Clicking the live-room background must not disconnect the room.');
  assert.equal(harness.hooks.state.room !== null, true, 'Clicking the live-room background must keep the room active.');
}

{
  let detachCalls = 0;
  let disconnectCalls = 0;
  const localVideoTrack = {
    mediaStreamTrack: { kind: 'video', readyState: 'live', enabled: true },
    attach: () => new FakeHTMLElement('leave-video', 'video'),
    detach() {
      detachCalls += 1;
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Automatic permission should not be needed for labeled devices.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  const localParticipant = {
    identity: 'local-explicit-leave',
    name: 'Local participant',
    isLocal: true,
    trackPublications: new Map(),
    getTrackPublication: () => null,
  };
  const room = {
    localParticipant,
    remoteParticipants: new Map(),
    state: 'connected',
    async disconnect() {
      disconnectCalls += 1;
    },
  };
  harness.hooks.state.room = room;
  harness.hooks.attachTrack(
    localVideoTrack,
    harness.document.getElementById('sr-participant-grid'),
    'video',
    true,
    'local-explicit-leave:camera',
  );
  harness.hooks.state.currentRoomKey = '1';
  harness.hooks.state.currentRoomMicrophoneAllowed = false;
  harness.document.body.classList.add('sr-in-call');
  await harness.hooks.disconnectConnectedRoom();
  assert.equal(detachCalls, 1, 'Explicit room teardown must detach attached video elements.');
  assert.equal(disconnectCalls, 1, 'Explicit room teardown must disconnect the LiveKit room exactly once.');
  assert.equal(harness.hooks.state.room, null, 'Explicit room teardown must clear the active room state.');
  assert.equal(harness.hooks.state.attachedTracks.length, 0, 'Explicit room teardown must clear attached media bookkeeping.');
  assert.equal(harness.document.body.classList.contains('sr-in-call'), false, 'Explicit room teardown must leave the call UI.');
}

let moderationCases = 0;
function moderationResponse(body) {
  return response({ ok: true, status: 200, payload: { ok: true, result: {
    action: body.operation === 'mute' ? 'muted' : 'removed',
    roomKey: body.roomKey, participantIdentity: body.participantIdentity,
    ...(body.operation === 'mute' ? { trackSid: body.trackSid } : {}),
  } } });
}

async function createModeratorHarness({ respond = moderationResponse, confirm = () => true } = {}) {
  const requests = [];
  const confirmations = [];
  const harness = createLiveHarness({
    fetch: async (url, options) => {
      if (String(url).endsWith('/study-room/moderate')) {
        const body = JSON.parse(options.body);
        assert.equal(url, 'https://worker.example.test/study-room/moderate');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer admin-session-token');
        assert.equal(options.cache, 'no-store');
        requests.push(body);
        return respond(body);
      }
      return authorizedResponse();
    },
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('No real media in moderator VM tests.'); },
    liveKit: { Track: { Source: liveKitSources } },
  });
  await waitForAuthorizedPrejoin(harness);
  const publication = { source: liveKitSources.Microphone, trackSid: 'TR_inert_microphone', isMuted: false };
  const participant = {
    identity: 'sr_inert_remote_participant', name: 'VM study partner', isLocal: false,
    trackPublications: new Map([[liveKitSources.Microphone, publication]]),
    getTrackPublication(source) { return this.trackPublications.get(source) || null; },
  };
  const localParticipant = {
    identity: 'sr_inert_local_admin', name: 'VM moderator', isLocal: true,
    trackPublications: new Map(), getTrackPublication: () => null,
  };
  const room = { localParticipant, remoteParticipants: new Map([[participant.identity, participant]]), state: 'connected' };
  const state = harness.hooks.state;
  state.room = room;
  state.currentRoomKey = '2';
  state.isAdministrator = true;
  harness.window.confirm = (copy) => { confirmations.push(copy); return confirm(copy); };
  const toastNode = harness.document.getElementById('sr-toast');
  toastNode.textContent = '';
  return { ...harness, state, room, participant, publication, localParticipant, requests, confirmations, toastNode };
}

for (const operation of ['mute', 'remove']) {
  const h = await createModeratorHarness();
  const row = h.hooks.createPersonRow(h.participant);
  const button = descendantWithText(row, operation === 'mute' ? 'Mute for room' : 'Remove');
  assert.equal(button.disabled, false);
  await button.emit('click');
  assert.deepEqual(h.requests, [{ operation, roomKey: '2', participantIdentity: h.participant.identity,
    ...(operation === 'mute' ? { trackSid: 'TR_inert_microphone' } : {}) }]);
  assert.equal(h.confirmations.length, operation === 'remove' ? 1 : 0);
  if (operation === 'remove') assert.match(h.confirmations[0], /They can rejoin; this is not a permanent block/);
  assert.equal(h.toastNode.textContent, operation === 'mute' ? 'Microphone muted for the room.' : 'Removed from the room. They can rejoin.');
  assert.equal(h.publication.isMuted, false, 'Server acknowledgement must not forge a local LiveKit track event.');
  assert.equal(h.room.remoteParticipants.get(h.participant.identity), h.participant, 'Removal awaits authoritative RTC state.');
  assert.equal(h.state.pendingModeration.size, 0);
  assert.equal(h.state.blockedParticipants.size, 0, 'Admin removal must not claim permanent/local blocking.');
  moderationCases += 1;
}

{
  const h = await createModeratorHarness({ confirm: () => false });
  await descendantWithText(h.hooks.createPersonRow(h.participant), 'Remove').emit('click');
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.pendingModeration.size, 0);
  assert.equal(h.toastNode.textContent, '');
  moderationCases += 1;
}

for (const failure of ['503', 'missing-result', 'wrong-action', 'wrong-room', 'wrong-participant', 'wrong-track']) {
  const h = await createModeratorHarness({ respond: (body) => {
    if (failure === '503') return response({ ok: false, status: 503, payload: { ok: false, error: { message: 'DO_NOT_DISPLAY_PRIVATE_SERVER_BODY' } } });
    const result = { action: 'muted', roomKey: body.roomKey, participantIdentity: body.participantIdentity, trackSid: body.trackSid };
    if (failure === 'wrong-action') result.action = 'removed';
    if (failure === 'wrong-room') result.roomKey = '3';
    if (failure === 'wrong-participant') result.participantIdentity = 'different-participant';
    if (failure === 'wrong-track') result.trackSid = 'different-track';
    return response({ ok: true, status: 200, payload: { ok: true, ...(failure === 'missing-result' ? {} : { result }) } });
  } });
  await h.hooks.moderateParticipant(h.participant, 'mute');
  assert.equal(h.requests.length, 1, failure);
  assert.equal(h.toastNode.textContent, 'Could not confirm the microphone mute. Check the participant before retrying.', failure);
  assert.doesNotMatch(h.toastNode.textContent, /DO_NOT_DISPLAY_PRIVATE_SERVER_BODY/);
  assert.equal(h.publication.isMuted, false);
  assert.equal(h.room.remoteParticipants.get(h.participant.identity), h.participant);
  assert.equal(h.state.pendingModeration.size, 0);
  assert.equal(descendantWithText(h.hooks.createPersonRow(h.participant), 'Mute for room').disabled, false,
    'Uncertain response clears local pending state but does not automatically resend.');
  moderationCases += 1;
}

for (const microphoneState of ['absent', 'missing-track-sid', 'muted']) {
  const h = await createModeratorHarness();
  if (microphoneState === 'absent') h.participant.trackPublications.clear();
  if (microphoneState === 'missing-track-sid') delete h.publication.trackSid;
  if (microphoneState === 'muted') h.publication.isMuted = true;
  assert.equal(descendantWithText(h.hooks.createPersonRow(h.participant), 'Mute for room').disabled, true);
  await h.hooks.moderateParticipant(h.participant, 'mute');
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.pendingModeration.size, 0);
  moderationCases += 1;
}

{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = await createModeratorHarness({ respond: async (body) => { await gate; return moderationResponse(body); } });
  const first = h.hooks.moderateParticipant(h.participant, 'mute');
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.pendingModeration.size, 1);
  const pendingRow = h.hooks.createPersonRow(h.participant);
  assert.equal(descendantWithText(pendingRow, 'Mute for room').disabled, true);
  assert.equal(descendantWithText(pendingRow, 'Remove').disabled, true);
  assert.equal(h.toastNode.textContent, '', 'No optimistic success before server acknowledgement.');
  assert.equal(h.publication.isMuted, false);
  await h.hooks.moderateParticipant(h.participant, 'mute');
  await h.hooks.moderateParticipant(h.participant, 'remove');
  assert.equal(h.requests.length, 1, 'Dedupe covers both actions for the same room/participant.');
  assert.equal(h.confirmations.length, 0);
  release();
  await first;
  assert.equal(h.state.pendingModeration.size, 0);
  moderationCases += 1;
}

for (const stale of ['room', 'room-key', 'session']) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = await createModeratorHarness({ respond: async (body) => { await gate; return moderationResponse(body); } });
  const first = h.hooks.moderateParticipant(h.participant, 'mute');
  if (stale === 'room') h.state.room = { ...h.room, remoteParticipants: new Map() };
  if (stale === 'room-key') h.state.currentRoomKey = '3';
  if (stale === 'session') h.state.session = { access_token: 'different-inert-session' };
  h.toastNode.textContent = 'New context';
  release();
  await first;
  assert.equal(h.toastNode.textContent, 'New context', 'Late moderation must not notify a different room/session.');
  assert.equal(h.state.pendingModeration.size, 0);
  assert.equal(h.publication.isMuted, false);
  moderationCases += 1;
}

for (const guard of ['member', 'self', 'missing-room', 'replaced-participant', 'unsupported-action']) {
  const h = await createModeratorHarness();
  if (guard === 'member') h.state.isAdministrator = false;
  if (guard === 'missing-room') h.state.room = null;
  if (guard === 'replaced-participant') h.room.remoteParticipants.set(h.participant.identity, { ...h.participant });
  const target = guard === 'self' ? h.localParticipant : h.participant;
  if (guard === 'member' || guard === 'self') {
    const row = h.hooks.createPersonRow(target);
    assert.equal(descendantWithText(row, 'Mute for room'), undefined);
    assert.equal(descendantWithText(row, 'Remove'), undefined);
  }
  await h.hooks.moderateParticipant(target, guard === 'unsupported-action' ? 'unmute' : 'mute');
  assert.equal(h.requests.length, 0, guard);
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.state.pendingModeration.size, 0);
  moderationCases += 1;
}

{
  const h = await createModeratorHarness();
  h.window.confirm = () => { h.state.session = null; return true; };
  await h.hooks.moderateParticipant(h.participant, 'remove');
  assert.equal(h.requests.length, 0, 'Session must be rechecked after the blocking confirmation prompt.');
  moderationCases += 1;
}

console.log(`Study Room administrator moderation: ${moderationCases} inert actual-function cases passed.`);
console.log('Study Room admin-window, device, microphone, and local-control behavioral tests passed.');
