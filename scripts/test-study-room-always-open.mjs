import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Behavioral VM only: actual catalog/selection/join/create/switch/event code,
// no browser, Auth service, LiveKit transport, camera, microphone, or network.
const source = await readFile(new URL('../assets/study-room-live.js', import.meta.url), 'utf8');
const marker = '  global.DueDiligenceStudyRoom = Object.freeze({';
assert.equal(source.split(marker).length, 2, 'Unique non-production test-hook insertion point required.');
const noops = [
  'stopDeviceTest', 'bindRoomEvents', 'syncConnectionState', 'renderParticipants',
  'closePanel', 'installStudyRoomLayoutObserver', 'syncInteractiveControls',
  'syncBrandedBackdropState', 'startFocusClock', 'updateAudioPrompt',
  'removeLocalCameraPublishGuard', 'detachTracks', 'updateUnreadBadges',
];
const instrumented = source.replace(marker, `
  ${noops.map((name) => `${name} = () => {};`).join('\n  ')}
  studyRoomMediaOptions = () => ({});
  installLocalCameraPublishGuard = () => true;
  startRoomAudioFromGesture = async () => true;
  enableInitialMedia = async () => {};
  refreshDeviceLists = async () => {};
  destroyBackgroundController = async () => {};
  refreshRoomCatalog = async () => state.rooms;
  isLocalSourceEnabled = () => false;
  toast = (message) => global.__observations.toasts.push(message);
  global.__hooks = { state, normalizeRoomCatalog, activeRoom, selectedRoom,
    syncJoinButton, selectRoom, createRoomCard, renderRoomCatalog,
    renderRoomSelector, joinRoom, createRoomSlot, switchToRoom, bindControls };
${marker}`);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.focused = false;
    this.replacements = 0;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, enabled) => {
        if (enabled) this.classes.add(name); else this.classes.delete(name);
        return Boolean(enabled);
      },
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.replacements += 1; this.children = [...children]; }
  querySelectorAll(selector) {
    return selector === '[data-room-key]' ? this.children.filter((child) => child.dataset?.roomKey) : [];
  }
  querySelector(selector) {
    if (selector === 'small') return this.small ??= new Element('small');
    return null;
  }
  closest() { return null; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  addEventListener(type, callback) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(callback);
    this.listeners.set(type, handlers);
  }
  async emit(type, detail = {}) {
    // Disabled native buttons do not dispatch trusted user activation.
    if (this.disabled && ['click', 'dblclick'].includes(type)) return;
    const event = { detail: 1, target: this, currentTarget: this, preventDefault() {}, ...detail };
    await Promise.all((this.listeners.get(type) || []).map((callback) => callback(event)));
  }
}

function catalog(admin = false) {
  return Array.from({ length: 5 }, (_, index) => ({
    roomKey: String(index + 1), active: false, alwaysOpen: index < 4,
    adminOnly: index === 4, canCreate: admin, canJoin: index < 4 || admin,
    microphoneAllowed: index !== 0, participantCount: 0, capacity: 12,
  }));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ admin = false, rooms = catalog(admin), joinGate = null, signedIn = true } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const observations = { requests: [], connects: [], disconnects: 0, constructions: 0, toasts: [] };
  const document = {
    readyState: 'loading', body: new Element('body'), getElementById: get,
    createElement: (tag) => new Element(tag), querySelectorAll: () => [],
    addEventListener() {}, // Do not initialize Auth, media or timers.
  };
  class Room {
    constructor() {
      observations.constructions += 1;
      this.localParticipant = {};
      this.state = 'connected';
    }
    async connect(...args) { observations.connects.push(args); }
    async disconnect() { observations.disconnects += 1; }
  }
  const window = {
    document, location: { hostname: 'fixture.invalid', search: '' },
    DueDiligencePhase2Config: { workerUrl: 'https://study-room.fixture.invalid' },
    LivekitClient: { Room }, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, clearInterval() {}, clearTimeout() {},
    __observations: observations,
    async fetch(url, options) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://study-room.fixture.invalid');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer inert-session');
      const body = JSON.parse(options.body);
      observations.requests.push({ path: parsed.pathname, body });
      assert.ok(['/study-room/join', '/admin/study-room/rooms'].includes(parsed.pathname));
      if (parsed.pathname === '/study-room/join' && joinGate) await joinGate.promise;
      const data = parsed.pathname === '/study-room/join' ? {
        room_key: body.roomKey, server_url: 'wss://rtc.fixture.invalid',
        participant_token: 'inert-room-token', participant_name: 'VM participant',
        microphone_allowed: body.roomKey !== '1',
      } : {};
      return { ok: true, status: 200, json: async () => ({ ok: true, ...data }) };
    },
  };
  vm.runInNewContext(instrumented, { window, URL, URLSearchParams, console }, { timeout: 1_000 });
  const hooks = window.__hooks;
  hooks.state.isAdministrator = admin;
  hooks.state.session = signedIn ? { access_token: 'inert-session' } : null;
  hooks.state.rooms = hooks.normalizeRoomCatalog({ rooms });
  get('sr-nickname').value = 'VM participant';
  hooks.renderRoomCatalog();
  hooks.bindControls();
  return { ...hooks, get, observations, card: (key) => get('sr-room-card-grid').children.find((x) => x.dataset.roomKey === key) };
}

async function settled(h) {
  for (let index = 0; index < 30; index += 1) {
    if (!h.state.joining && !h.state.roomMutationBusy) return;
    await new Promise(setImmediate);
  }
  assert.fail('VM join did not settle within bounded event-loop turns.');
}

for (const key of ['1', '2', '3', '4']) {
  test(`empty public room ${key} joins normally without any admin create`, async () => {
    const h = harness();
    assert.equal(h.state.rooms.length, 5);
    assert.equal(h.get('sr-room-lobby-count').textContent, '4 rooms available');
    assert.equal(h.activeRoom(key)?.roomKey, key);
    assert.equal(h.selectRoom(key), true);
    assert.equal(h.get('sr-join').disabled, false);
    await h.joinRoom();
    assert.deepEqual(h.observations.requests.map((x) => x.path), ['/study-room/join']);
    assert.equal(h.observations.connects.length, 1);
    assert.equal(h.state.currentRoomKey, key);
    assert.equal(h.state.currentRoomMicrophoneAllowed, key !== '1');
  });
}

test('first select preserves card identity, focus and listeners for native double-click', async () => {
  const h = harness();
  const button = h.card('3');
  const replacements = h.get('sr-room-card-grid').replacements;
  button.focus();
  await button.emit('click');
  assert.equal(h.card('3'), button);
  assert.equal(h.get('sr-room-card-grid').replacements, replacements);
  assert.equal(button.focused, true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(h.card('2').getAttribute('aria-pressed'), 'false');
  assert.equal(h.observations.requests.length, 0);
  await button.emit('click', { detail: 2 });
  await button.emit('dblclick', { detail: 2 });
  await settled(h);
  assert.equal(h.state.currentRoomKey, '3');
  assert.equal(h.observations.connects.length, 1);
});

test('repeated double-click while join is pending and after connection never duplicates', async () => {
  const gate = deferred();
  const h = harness({ joinGate: gate });
  const button = h.card('2');
  await button.emit('dblclick', { detail: 2 });
  assert.equal(h.state.joining, true);
  await button.emit('dblclick', { detail: 2 });
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 1);
  gate.resolve();
  await settled(h);
  await button.emit('dblclick', { detail: 2 });
  assert.equal(h.observations.constructions, 1);
  assert.equal(h.observations.connects.length, 1);
});

test('mobile single tap selects, then explicit Join connects the selected room once', async () => {
  const h = harness();
  await h.card('4').emit('click', { detail: 1, pointerType: 'touch' });
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.get('sr-join').disabled, false);
  await h.get('sr-join').emit('click', { detail: 1, pointerType: 'touch' });
  assert.equal(h.state.currentRoomKey, '4');
  assert.equal(h.observations.connects.length, 1);
});

test('native button Enter activation (click detail zero) selects and joins', async () => {
  const h = harness();
  const button = h.card('2');
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.type, 'button');
  // VM supplies the browser-generated activation event, not a physical keypress.
  await button.emit('click', { detail: 0 });
  await settled(h);
  assert.equal(h.state.currentRoomKey, '2');
  assert.equal(h.observations.connects.length, 1);
});

test('private room stays unselectable, unjoinable and absent from member switch menu', async () => {
  const h = harness();
  assert.equal(h.card('5').disabled, true);
  assert.equal(h.activeRoom('5'), null);
  assert.equal(h.selectRoom('5'), false);
  assert.deepEqual(h.get('sr-room-selector-menu').children.map((x) => x.dataset.roomKey), ['1', '2', '3', '4']);
  h.state.selectedRoomKey = '5';
  h.syncJoinButton();
  assert.equal(h.get('sr-join').disabled, true);
  await h.joinRoom();
  await h.switchToRoom('5');
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.observations.constructions, 0);
});

test('restricted active room cannot disconnect or switch an existing connection', async () => {
  const rooms = catalog();
  rooms[4].active = true;
  rooms[4].alwaysOpen = true;
  const h = harness({ rooms });
  h.selectRoom('2');
  await h.joinRoom();
  const connection = h.state.room;
  const selected = h.state.selectedRoomKey;
  assert.equal(h.state.rooms[4].alwaysOpen, false, 'adminOnly cannot become always-open via response flag.');
  await h.switchToRoom('5');
  assert.equal(h.state.room, connection);
  assert.equal(h.state.selectedRoomKey, selected);
  assert.equal(h.state.currentRoomKey, '2');
  assert.equal(h.observations.disconnects, 0);
  assert.equal(h.observations.requests.length, 1);
});

test('administrator must still create an inactive private room before joining', async () => {
  const h = harness({ admin: true });
  h.selectRoom('5');
  assert.match(h.get('sr-join').textContent, /^Create and join/);
  await h.joinRoom();
  assert.deepEqual(h.observations.requests.map((x) => x.path), ['/admin/study-room/rooms', '/study-room/join']);
  assert.equal(h.state.currentRoomKey, '5');
});

test('inactive room without explicit create permission remains closed even for administrator', async () => {
  const rooms = catalog(true);
  rooms[4].canCreate = false;
  const h = harness({ admin: true, rooms });
  h.selectRoom('5');
  assert.equal(h.get('sr-join').disabled, true);
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 0);
});

test('public administrator join never creates a room and Library selection disables microphone', async () => {
  const h = harness({ admin: true });
  h.state.joinWithMicrophone = true;
  h.selectRoom('1');
  assert.equal(h.state.joinWithMicrophone, false);
  assert.equal(h.get('sr-join-microphone').disabled, true);
  await h.joinRoom();
  assert.deepEqual(h.observations.requests.map((x) => x.path), ['/study-room/join']);
});

test('missing catalog never invents always-open availability or normal-user create authority', async () => {
  const h = harness({ rooms: [] });
  assert.ok(h.state.rooms.every((room) => room.alwaysOpen === false && room.canCreate === false));
  assert.equal(h.get('sr-room-lobby-count').textContent, '0 rooms available');
  h.selectRoom('2');
  assert.equal(h.get('sr-join').disabled, true);
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 0);
});

test('missing administrator catalog cannot create public rooms but preserves private creation', async () => {
  const h = harness({ admin: true, rooms: [] });
  assert.ok(h.state.rooms.every((room) => room.alwaysOpen === false && room.active === false));
  assert.equal(h.get('sr-room-lobby-count').textContent, '0 rooms available');
  for (const key of ['1', '2', '3', '4']) {
    assert.equal(h.state.rooms.find((room) => room.roomKey === key).canCreate, false);
    h.selectRoom(key);
    assert.equal(h.get('sr-join').disabled, true);
    assert.doesNotMatch(h.get('sr-join').textContent, /Create and join/);
    await h.joinRoom();
    await h.card(key).emit('dblclick', { detail: 2 });
    await settled(h);
  }
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.observations.constructions, 0);
  assert.equal(h.state.rooms[4].canCreate, true);
  assert.equal(h.state.rooms[4].adminOnly, true);
  h.selectRoom('5');
  assert.equal(h.get('sr-join').disabled, false);
  assert.match(h.get('sr-join').textContent, /^Create and join Inner Chamber/);
  await h.joinRoom();
  assert.deepEqual(h.observations.requests.map((request) => request.path), ['/admin/study-room/rooms', '/study-room/join']);
  assert.ok(h.observations.requests.every((request) => request.body.roomKey === '5'));
  assert.equal(h.state.currentRoomKey, '5');
});

test('missing session cannot reach even the inert Worker endpoint', async () => {
  const h = harness({ signedIn: false });
  h.selectRoom('2');
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.observations.connects.length, 0);
  assert.equal(h.state.room, null);
});

test('an explicitly restricted room cannot invoke administrator create before denial', async () => {
  const rooms = catalog(true);
  rooms[4].canJoin = false;
  const h = harness({ admin: true, rooms });
  h.state.selectedRoomKey = '5';
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.observations.connects.length, 0);
});
