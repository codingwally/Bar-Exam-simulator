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
  isLocalSourceEnabled = () => false;
  toast = (message) => global.__observations.toasts.push(message);
  global.__hooks = { state, normalizeRoomCatalog, activeRoom, selectedRoom,
    syncJoinButton, selectRoom, createRoomCard, renderRoomCatalog,
    renderRoomSelector, joinRoom, createRoomSlot, switchToRoom, bindControls,
    openRoomEditor, closeRoomEditor, saveRoomConfiguration, reloadRoomEditor,
    refreshRoomCatalog, renderRoomAdministration };
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
    this.isConnected = true;
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
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : selector === '[data-room-key]' ? all.filter((child) => child.dataset?.roomKey) : [];
  }
  querySelector(selector) {
    if (selector === 'small') return this.small ??= new Element('small');
    if (selector === '.sr-room-card') return this.querySelectorAll('*').find((child) => String(child.className || '').split(' ').includes('sr-room-card')) || null;
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
  return Array.from({ length: 6 }, (_, index) => ({
    roomKey: String(index + 1), active: false, alwaysOpen: index !== 4,
    label: ['Library','Room 1','Room 2','Room 3','Inner Chamber','Room 4'][index],
    audience: index === 4 ? 'admin' : 'all', revision: 1, accessRevision: 1,
    adminOnly: index === 4, canCreate: admin, canJoin: index !== 4 || admin,
    microphoneAllowed: index !== 0, participantCount: 0, capacity: 12,
  }));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ admin = false, rooms = catalog(admin), joinGate = null, signedIn = true, mutationGate = null } = {}) {
  const transport = { rooms: structuredClone(rooms), failure: null, listFailure: false, malformed: false };
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
      assert.ok(['/study-room/join', '/study-room/rooms', '/admin/study-room/rooms'].includes(parsed.pathname));
      if (parsed.pathname === '/study-room/join' && joinGate) await joinGate.promise;
      let data = parsed.pathname === '/study-room/join' ? {
        room_key: body.roomKey, server_url: 'wss://rtc.fixture.invalid',
        participant_token: 'inert-room-token', participant_name: 'VM participant',
        microphone_allowed: body.roomKey !== '1',
      } : {};
      if (parsed.pathname === '/study-room/rooms') {
        if (transport.listFailure) return { ok:false, status:503, json:async()=>({ok:false,error:{code:'STUDY_ROOM_CATALOG_UNAVAILABLE'}}) };
        data = { rooms: structuredClone(transport.rooms), schemaVersion:1, maxRooms:24 };
      }
      if (parsed.pathname === '/admin/study-room/rooms') {
        if (mutationGate) await mutationGate.promise;
        if (transport.failure) return { ok:false, status:transport.failure.status||409, json:async()=>({ok:false,error:transport.failure}) };
        const old = transport.rooms.find((room)=>room.roomKey===body.roomKey);
        if (body.operation === 'create') old.active = true;
        else {
          const saved = {...(old || {active:false,alwaysOpen:true,canJoin:true,canCreate:admin,microphoneAllowed:true,participantCount:0,capacity:12}),
            roomKey:body.roomKey,label:body.label,audience:body.audience,revision:(old?.revision||0)+1,
            accessRevision:old ? old.accessRevision + (old.audience===body.audience?0:1) : 1};
          transport.rooms = [...transport.rooms.filter((room)=>room!==old),saved];
          data = {room:transport.malformed ? {...saved,roomKey:'24'} : saved};
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, ...data }) };
    },
  };
  vm.runInNewContext(instrumented, { window, URL, URLSearchParams, console }, { timeout: 1_000 });
  const hooks = window.__hooks;
  hooks.state.isAdministrator = admin;
  hooks.state.session = signedIn ? { access_token: 'inert-session' } : null;
  hooks.state.rooms = hooks.normalizeRoomCatalog({ rooms });
  hooks.state.roomCatalogLoaded = true;
  get('sr-nickname').value = 'VM participant';
  hooks.renderRoomCatalog();
  hooks.bindControls();
  return { ...hooks, get, observations, transport, card: (key) => get('sr-room-card-grid').querySelectorAll('[data-room-key]').find((x) => x.dataset.roomKey === key) };
}

async function settled(h) {
  for (let index = 0; index < 30; index += 1) {
    if (!h.state.joining && !h.state.roomMutationBusy) return;
    await new Promise(setImmediate);
  }
  assert.fail('VM join did not settle within bounded event-loop turns.');
}

for (const key of ['1', '2', '3', '4', '6']) {
  test(`empty public room ${key} joins normally without any admin create`, async () => {
    const h = harness();
    assert.equal(h.state.rooms.length, 6);
    assert.equal(h.get('sr-room-lobby-count').textContent, '5 rooms available');
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
  assert.deepEqual(h.get('sr-room-selector-menu').children.map((x) => x.dataset.roomKey), ['1', '2', '3', '4', '6']);
  h.state.selectedRoomKey = '5';
  h.syncJoinButton();
  assert.equal(h.get('sr-join').disabled, true);
  await h.joinRoom();
  await h.switchToRoom('5');
  assert.ok(h.observations.requests.every((request)=>request.path==='/study-room/rooms'));
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
  assert.equal(h.observations.requests.filter((request)=>request.path!=='/study-room/rooms').length, 1);
});

test('administrator must still create an inactive private room before joining', async () => {
  const h = harness({ admin: true });
  h.selectRoom('5');
  assert.match(h.get('sr-join').textContent, /^Create and join/);
  await h.joinRoom();
  assert.deepEqual(h.observations.requests.map((x) => x.path), ['/admin/study-room/rooms', '/study-room/rooms', '/study-room/join']);
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

test('missing administrator catalog cannot invent even private room creation', async () => {
  const h = harness({ admin: true, rooms: [] });
  h.state.roomCatalogLoaded = false;h.renderRoomCatalog();
  assert.equal(h.state.rooms.length,0);
  assert.equal(h.get('sr-room-lobby-count').textContent, '0 rooms available');
  assert.equal(h.get('sr-room-add').disabled,true);
  assert.equal(h.openRoomEditor(),false);
  assert.equal(h.selectRoom('5'),false);
  assert.equal(await h.createRoomSlot('5'),false);
  await h.joinRoom();
  assert.equal(h.observations.requests.length, 0);
  assert.equal(h.observations.constructions, 0);
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

const mutations = (h) => h.observations.requests.filter((request)=>request.path==='/admin/study-room/rooms');

test('ordinary and missing-session users cannot open or submit the room editor', async()=>{
  for(const options of [{admin:false},{admin:true,signedIn:false}]){
    const h=harness(options);
    assert.equal(h.get('sr-room-admin-controls').hidden,true);
    assert.equal(h.openRoomEditor(),false);
    await h.get('sr-room-add').emit('click');await h.get('sr-room-editor').emit('submit');
    assert.equal(mutations(h).length,0);
  }
});
test('only canonical dynamic rooms are rendered and renamed labels reach cards, join and selector',async()=>{
  const rows=catalog();rows.push({...rows[1],roomKey:'24',label:'Reading Circle'});
  const h=harness({rooms:rows});assert.equal(h.state.rooms.length,7);assert.ok(h.card('24'));assert.equal(h.card('7'),undefined);
  assert.match(h.card('24').getAttribute('aria-label'),/^Reading Circle,/);
  h.selectRoom('24');assert.equal(h.get('sr-join').textContent,'Join Reading Circle');
  assert.ok(h.get('sr-room-selector-menu').children.some((node)=>node.textContent==='Reading Circle · 0'));
  await h.joinRoom();assert.equal(h.observations.requests[0].body.roomKey,'24');
});
test('unknown or denied paid eligibility never becomes membership and Inner Chamber stays admin-only',()=>{
  const rows=catalog();rows[1]={...rows[1],audience:'paid'};delete rows[1].canJoin;
  rows[4]={...rows[4],audience:'all',adminOnly:false,canJoin:true,alwaysOpen:true};
  const h=harness({rooms:rows});assert.equal(h.card('2').disabled,true);
  assert.match(h.card('2').getAttribute('aria-label'),/Paying users · Access unavailable/);
  assert.equal(h.state.rooms[4].audience,'admin');assert.equal(h.card('5').disabled,true);
  assert.equal(h.state.rooms[4].alwaysOpen,false);assert.equal(h.selectRoom('5'),false);
});
test('paid room membership comes only from explicit server canJoin and does not claim a paid account status',()=>{
  const rows=catalog();rows[1]={...rows[1],audience:'paid',canJoin:true};
  const h=harness({rooms:rows});assert.equal(h.card('2').disabled,false);
  assert.equal(h.state.rooms[1].audience,'paid');assert.equal(h.selectRoom('2'),true);
  assert.equal(h.state.access,null);
});
test('malformed keys, revisions, names and audiences do not create trusted catalog entries',()=>{
  const h=harness();const row=catalog()[1];
  for(const delta of [{roomKey:'0'},{roomKey:'25'},{roomKey:'01'},{audience:'unknown'},{revision:0},{revision:'1'},
    {accessRevision:0},{label:'<img src=x>'},{label:'A'},{label:'Room\nName'},{label:'x'.repeat(65)}]){
    assert.equal(h.normalizeRoomCatalog({rooms:[{...row,...delta}]}).length,0);
  }
});
test('admin edit control opens named form and Cancel restores without a request',async()=>{
  const h=harness({admin:true});const wrapper=h.get('sr-room-card-grid').children[1],edit=wrapper.children[1];
  assert.equal(edit.getAttribute('aria-label'),'Edit Room 1');await edit.emit('click');
  assert.equal(h.state.roomEditor.roomKey,'2');assert.equal(h.get('sr-room-editor').hidden,false);
  assert.equal(h.get('sr-room-label').focused,true);assert.equal(h.get('sr-room-label').value,'Room 1');
  h.get('sr-room-label').value='Unsaved name';await h.get('sr-room-cancel').emit('click');
  assert.equal(h.state.roomEditor,null);assert.equal(h.get('sr-room-editor').hidden,true);assert.equal(mutations(h).length,0);
});
test('admin rename and access save uses exact row revision then confirmed canonical refresh',async()=>{
  const h=harness({admin:true});h.openRoomEditor('2');h.get('sr-room-label').value=' Reading Circle ';h.get('sr-room-audience').value='paid';
  await h.get('sr-room-editor').emit('submit');
  assert.deepEqual(mutations(h)[0].body,{operation:'update',roomKey:'2',label:'Reading Circle',audience:'paid',expectedRevision:1});
  assert.equal(h.state.roomEditor,null);assert.equal(h.state.rooms[1].label,'Reading Circle');
  assert.equal(h.state.rooms[1].revision,2);assert.equal(h.state.rooms[1].accessRevision,2);
  assert.deepEqual(h.observations.requests.map((request)=>request.path),['/admin/study-room/rooms','/study-room/rooms']);
  assert.match(h.get('sr-room-admin-status').textContent,/Reading Circle saved/);
  assert.equal(h.observations.connects.length,0);
});
test('Inner Chamber edit locks audience and rejects scripted broadening before transport',async()=>{
  const h=harness({admin:true});h.openRoomEditor('5');assert.equal(h.get('sr-room-audience').disabled,true);
  assert.equal(h.get('sr-room-fixed-audience').hidden,false);h.get('sr-room-audience').value='all';
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(mutations(h).length,0);
  h.get('sr-room-audience').value='admin';h.get('sr-room-label').value='Inner Chamber';
  assert.equal(await h.saveRoomConfiguration(),true);assert.equal(mutations(h)[0].body.audience,'admin');
});
test('bounded validation refuses invalid input without changing current catalog',async()=>{
  const h=harness({admin:true});h.openRoomEditor('2');
  for(const label of ['', 'A', '<script>', 'Room\nName', 'Room/Name', 'A'.repeat(65), 'Room\u202ename']){
    h.get('sr-room-label').value=label;assert.equal(await h.saveRoomConfiguration(),false);
  }
  h.get('sr-room-label').value='Reading Room';h.get('sr-room-audience').value='subscriber';
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(mutations(h).length,0);
  assert.equal(h.state.rooms[1].label,'Room 1');
});
test('add uses one vacant physical key and cannot duplicate during an in-flight save',async()=>{
  const gate=deferred();const h=harness({admin:true,mutationGate:gate});h.openRoomEditor();
  assert.equal(h.state.roomEditor.roomKey,'7');assert.equal(h.get('sr-room-audience').value,'admin');
  h.get('sr-room-label').value='Small Group';const saving=h.saveRoomConfiguration();
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(h.openRoomEditor(),false);
  assert.equal(h.state.rooms.some((room)=>room.roomKey==='7'),false);assert.equal(mutations(h).length,1);
  assert.equal(mutations(h)[0].body.expectedRevision,0);gate.resolve();assert.equal(await saving,true);
  assert.equal(h.state.rooms.find((room)=>room.roomKey==='7').label,'Small Group');assert.equal(h.state.roomEditor,null);
});
test('conflict preserves draft and old revision until explicit reload replaces it',async()=>{
  const h=harness({admin:true});h.openRoomEditor('2');h.get('sr-room-label').value='My draft';h.get('sr-room-audience').value='paid';
  h.transport.failure={code:'STUDY_ROOM_CONFIG_CONFLICT',message:'Internal SQL text must not appear'};
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(h.get('sr-room-label').value,'My draft');
  assert.equal(h.state.roomEditor.revision,1);assert.equal(h.get('sr-room-save').disabled,true);
  assert.doesNotMatch(h.get('sr-room-editor-status').textContent,/Internal SQL/);
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(mutations(h).length,1);
  h.transport.failure=null;h.transport.rooms[1]={...h.transport.rooms[1],label:'Other admin name',revision:2};
  await h.get('sr-room-reload').emit('click');assert.equal(h.get('sr-room-label').value,'Other admin name');
  assert.equal(h.state.roomEditor.revision,2);assert.equal(h.get('sr-room-save').disabled,false);assert.equal(mutations(h).length,1);
});
test('occupied audience change shows safe error and keeps the exact draft',async()=>{
  const h=harness({admin:true});h.openRoomEditor('2');h.get('sr-room-audience').value='paid';
  h.transport.failure={code:'STUDY_ROOM_ROOM_NOT_EMPTY'};assert.equal(await h.saveRoomConfiguration(),false);
  assert.equal(h.get('sr-room-audience').value,'paid');assert.equal(h.get('sr-room-save').disabled,false);
  assert.match(h.get('sr-room-editor-status').textContent,/while people are in this room/);
  assert.equal(h.state.rooms[1].audience,'all');assert.equal(mutations(h).length,1);
});
test('unknown add response retains exact slot, blocks another write, and resolves through read-only catalog',async()=>{
  const h=harness({admin:true});h.openRoomEditor();h.get('sr-room-label').value='Quiet Group';h.transport.malformed=true;
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(h.state.roomEditor.roomKey,'7');
  assert.equal(h.state.roomEditor.needsReload,true);assert.equal(h.get('sr-room-label').value,'Quiet Group');
  assert.equal(h.get('sr-room-add').disabled,true);assert.equal(h.openRoomEditor(),false);
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(mutations(h).length,1);
  assert.equal(await h.reloadRoomEditor(),true);assert.equal(h.state.roomEditor,null);
  assert.equal(mutations(h).length,1);assert.equal(h.state.rooms.filter((room)=>room.roomKey==='7').length,1);
});
test('accepted save with unavailable refresh never fabricates success or permits blind retry',async()=>{
  const h=harness({admin:true});h.openRoomEditor('2');h.get('sr-room-label').value='Reading Circle';h.transport.listFailure=true;
  assert.equal(await h.saveRoomConfiguration(),false);assert.equal(h.state.rooms[1].label,'Room 1');
  assert.equal(h.get('sr-room-label').value,'Reading Circle');assert.equal(h.state.roomEditor.needsReload,true);
  assert.equal(h.get('sr-room-save').disabled,true);assert.doesNotMatch(h.get('sr-room-admin-status').textContent,/saved/);
  assert.equal(mutations(h).length,1);
});
test('late response after signed-in session change does not adopt old room configuration',async()=>{
  const gate=deferred();const h=harness({admin:true,mutationGate:gate});h.openRoomEditor('2');h.get('sr-room-label').value='Reading Circle';
  const saving=h.saveRoomConfiguration();h.state.session={access_token:'different-inert-session'};h.state.isAdministrator=false;
  gate.resolve();assert.equal(await saving,false);assert.equal(h.state.rooms[1].label,'Room 1');
  assert.equal(h.state.roomEditor,null);assert.equal(h.get('sr-room-admin-controls').hidden,true);
  assert.equal(h.observations.requests.length,1);
});
test('catalog capacity caps at24 and no add slot is guessed beyond current canonical keys',()=>{
  const rows=catalog(true);for(let key=7;key<=24;key++)rows.push({...rows[1],roomKey:String(key),label:`Study Room ${key}`});
  const h=harness({admin:true,rooms:rows});assert.equal(h.state.rooms.length,24);assert.equal(h.get('sr-room-add').disabled,true);
  assert.equal(h.openRoomEditor(),false);assert.equal(mutations(h).length,0);
});
