import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import worker from './index.mjs';
import {
  STUDY_ROOM_SLOTS, StudyRoomError, configureStudyRoom, createStudyRoomJoinCredential,
  currentPaidStudyRoomMembership, listStudyRooms, normalizeStudyRoomCatalog,
  normalizeStudyRoomLabel, resolveStudyRoomSlot,
} from './study-room-core.mjs';

// Inert transport and media doubles only. No Auth, payment, DB or LiveKit calls.
const owner = '11111111-1111-4111-8111-111111111111';
const subscriptionId = '22222222-2222-4222-8222-222222222222';
const env = { STUDY_ROOM_ENABLED: 'true', STUDY_ROOM_NAME: 'catalog-inert',
  LIVEKIT_URL: 'wss://catalog-inert.livekit.cloud', LIVEKIT_API_KEY: 'inert-api-key',
  LIVEKIT_API_SECRET: 'inert-secret-of-sufficient-length',
  SUPABASE_URL: 'https://catalog-inert.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'inert-service-key',
  ALLOWED_ORIGIN: 'https://duediligence.ph', GUEST_USAGE_HMAC_KEY: 'inert-rate-key' };
const catalog = () => ({ schemaVersion: 1, maxRooms: 24, rooms: STUDY_ROOM_SLOTS.map((r) => ({
  roomKey: r.roomKey, label: r.label, audience: r.adminOnly ? 'admin' : 'all', revision: 1, accessRevision: 1,
})) });
const errorCode = (code) => (error) => error instanceof StudyRoomError && error.code === code;
function service(c = catalog(), participants = 0) {
  const calls = [];
  return { calls,
    async listRooms(names) {
      calls.push(['list', names]);
      return names.map((name) => ({ name, maxParticipants: 12, numParticipants: participants, creationTime: 1_788_000_000n }));
    },
    async createRoom(body) { calls.push(['create', body]); return { ...body, numParticipants: 0 }; },
  };
}
function options(c = catalog(), extras = {}) {
  return { catalog: c, getCatalog: async () => c, roomService: service(c), ...extras };
}

test('catalog is authoritative, bounded, immutable and never falls back to built-in public access', () => {
  const good = catalog();
  assert.equal(normalizeStudyRoomCatalog(good).rooms.length, 6);
  for (let key = 7; key <= 24; key++) good.rooms.push({ roomKey: String(key), label: `Room ${key}`, audience: 'paid', revision: 2, accessRevision: 1 });
  assert.equal(normalizeStudyRoomCatalog(good).rooms.length, 24);
  assert.equal(Object.isFrozen(normalizeStudyRoomCatalog(good).rooms[0]), true);
  for (const change of [
    (c) => { c.schemaVersion = 2; }, (c) => { c.maxRooms = 25; },
    (c) => c.rooms.pop(), (c) => c.rooms.push(c.rooms[0]),
    (c) => { c.rooms[0].roomKey = '01'; }, (c) => { c.rooms[0].roomKey = '25'; },
    (c) => { c.rooms[0].roomKey = '../room'; }, (c) => { c.rooms[4].audience = 'all'; },
    (c) => { c.rooms[1].audience = 'trial'; }, (c) => { c.rooms[1].revision = '1'; },
    (c) => { c.rooms[1].revision = 0; }, (c) => { c.rooms[1].accessRevision = 2; },
    (c) => { c.rooms[1].revision = 2_147_483_647; },
    (c) => { c.rooms[1].label = '<script>'; }, (c) => { c.rooms[1].label = ' padded '; },
  ]) {
    const bad = catalog(); change(bad);
    assert.throws(() => normalizeStudyRoomCatalog(bad), errorCode('STUDY_ROOM_CATALOG_UNAVAILABLE'));
  }
  for (const absent of [null, undefined, {}, { rooms: [] }]) {
    assert.throws(() => resolveStudyRoomSlot(env, '1', { catalog: absent }), errorCode('STUDY_ROOM_CATALOG_UNAVAILABLE'));
  }
});

test('labels use exactly the SQL lexical contract and never carry policy or physical identity', () => {
  assert.equal(normalizeStudyRoomLabel("  Room 4 - O'Brien (A&B),_1.  "), "Room 4 - O'Brien (A&B),_1.");
  assert.equal(normalizeStudyRoomLabel('A  B'), 'A  B');
  for (const label of ['', 'A', 'A'.repeat(65), ' '.repeat(128) + 'AB', '\nAB', '\tAB', 'AB\u202e', 'AB/../', '<AB>', 'ÁB', '-AB']) {
    assert.throws(() => normalizeStudyRoomLabel(label), errorCode('STUDY_ROOM_CONFIG_INVALID'));
  }
});

test('access generation preserves all original physical names and label-only identity', () => {
  const c = catalog();
  for (let key = 1; key <= 6; key++) {
    assert.equal(resolveStudyRoomSlot(env, String(key), { catalog: c }).roomName, `catalog-inert${key === 1 ? '' : `-${key}`}`);
  }
  c.rooms[0] = { ...c.rooms[0], label: 'Silent Reading', revision: 2 };
  const renamed = resolveStudyRoomSlot(env, '1', { catalog: c });
  assert.equal(renamed.roomName, 'catalog-inert'); assert.equal(renamed.microphoneAllowed, false);
  c.rooms[0] = { ...c.rooms[0], revision: 3, accessRevision: 2, audience: 'paid' };
  assert.equal(resolveStudyRoomSlot(env, '1', { catalog: c }).roomName, 'catalog-inert-a2');
  assert.equal(resolveStudyRoomSlot(env, '1', { catalog: c }).microphoneAllowed, false);
});

test('paid source and exact start/expiry boundaries exclude complimentary and provisional access', () => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  const row = { id: subscriptionId, user_id: owner, status: 'active', source: 'manual_payment',
    starts_at: new Date(now).toISOString(), expires_at: new Date(now + 1).toISOString() };
  for (const source of ['manual_payment', 'admin_adjustment', 'migration']) {
    assert.equal(currentPaidStudyRoomMembership([{ ...row, source }], owner, now), true);
  }
  assert.equal(currentPaidStudyRoomMembership([{ ...row, expires_at: null }], owner, now), true);
  assert.equal(currentPaidStudyRoomMembership([], owner, now), false);
  for (const change of [
    ...['complimentary', 'founding_beta', 'free_beta', 'provisional_payment', 'trial'].map(source => ({ source })),
    ...['paused', 'cancelled', 'expired', 'trialing'].map(status => ({ status })),
    { starts_at: null }, { starts_at: 'invalid' }, { starts_at: new Date(now + 1).toISOString() },
    { expires_at: new Date(now).toISOString() }, { expires_at: 'invalid' }, { expires_at: undefined },
  ]) assert.equal(currentPaidStudyRoomMembership([{ ...row, ...change }], owner, now), false);
  assert.throws(() => currentPaidStudyRoomMembership([{ ...row, user_id: subscriptionId }], owner, now));
  assert.throws(() => currentPaidStudyRoomMembership([row, row], owner, now));
});

for (const audience of ['all', 'paid', 'admin']) {
  for (const actor of ['free', 'paid', 'admin']) {
    test(`${audience} room allows exactly ${actor}'s current server-verified entitlement`, async () => {
      const c = catalog(); c.rooms[1].audience = audience;
      const allowed = audience === 'all' || actor === 'admin' || (audience === 'paid' && actor === 'paid');
      const opt = options(c, { isAdministrator: actor === 'admin', isPaidMember: actor === 'paid', verifyPaidMembership: async () => actor === 'paid' });
      const listed = await listStudyRooms(env, opt);
      assert.equal(listed.rooms[1].canJoin, allowed);
      const pending = createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', opt);
      if (!allowed) {
        await assert.rejects(pending, errorCode(audience === 'admin' ? 'STUDY_ROOM_ADMIN_ROOM_REQUIRED' : 'STUDY_ROOM_PAID_ROOM_REQUIRED'));
        assert.equal(opt.roomService.calls.length, 1, 'Denied join does not make another media call');
      } else {
        const credential = await pending;
        const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(credential.participantToken);
        assert.equal(claims.video.room, 'catalog-inert-2');
        assert.notEqual(claims.video.roomAdmin, true); assert.notEqual(claims.video.roomCreate, true);
      }
    });
  }
}

test('in-flight audience change denies token response; old issued token cannot address the new generation', async () => {
  const c = catalog();
  const before = await createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', options(c));
  const changed = structuredClone(c); changed.rooms[1] = { ...changed.rooms[1], audience: 'paid', revision: 2, accessRevision: 2 };
  await assert.rejects(createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', options(c, {
    getCatalog: async () => changed,
  })), errorCode('STUDY_ROOM_CONFIG_CONFLICT'));
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(before.participantToken);
  assert.equal(claims.video.room, 'catalog-inert-2', 'Old token is not claimed revoked');
  assert.equal(resolveStudyRoomSlot(env, '2', { catalog: changed }).roomName, 'catalog-inert-2-a2');
  assert.notEqual(claims.video.room, resolveStudyRoomSlot(env, '2', { catalog: changed }).roomName);
});

test('catalog disappearance, label race and paid expiry are checked before issuing a credential', async () => {
  const c = catalog();
  await assert.rejects(createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', options(c, { getCatalog: async () => null })), errorCode('STUDY_ROOM_CATALOG_UNAVAILABLE'));
  const changed = structuredClone(c); changed.rooms[1].label = 'New name'; changed.rooms[1].revision++;
  await assert.rejects(createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', options(c, { getCatalog: async () => changed })), errorCode('STUDY_ROOM_CONFIG_CONFLICT'));
  c.rooms[1].audience = 'paid';
  await assert.rejects(createStudyRoomJoinCredential(env, { id: owner }, '2', 'Reader', options(c, {
    isPaidMember: true, verifyPaidMembership: async () => false,
  })), errorCode('STUDY_ROOM_PAID_ROOM_REQUIRED'));
});

function configOptions(c, extras = {}) {
  const calls = [];
  const opt = options(c, { isAdministrator: true, configureCatalog: async (body) => {
    calls.push(body);
    const prior = c.rooms.find(r => r.roomKey === body.p_room_key);
    const changed = !prior || prior.label !== body.p_label || prior.audience !== body.p_audience;
    return { ok: true, room: { roomKey: body.p_room_key, label: body.p_label, audience: body.p_audience,
      revision: prior ? prior.revision + Number(changed) : 1,
      accessRevision: prior ? prior.accessRevision + Number(prior.audience !== body.p_audience) : 1 } };
  }, ...extras });
  return { opt, calls };
}
const update = { operation: 'update', roomKey: '2', label: 'Room 1', audience: 'paid', expectedRevision: 1 };

test('empty audience update rotates generation; active label-only update preserves it; identical update is idempotent', async () => {
  const c = catalog();
  const { opt, calls } = configOptions(c);
  const result = await configureStudyRoom(env, { id: owner }, update, opt);
  assert.equal(result.room.accessRevision, 2); assert.equal(result.room.revision, 2);
  assert.equal(calls[0].p_actor_user_id, owner);
  const active = configOptions(c, { roomService: service(c, 3) });
  const renamed = await configureStudyRoom(env, { id: owner }, { ...update, label: 'Reading Partners', audience: 'all' }, active.opt);
  assert.equal(renamed.room.accessRevision, 1); assert.equal(renamed.room.revision, 2);
  assert.equal(active.opt.roomService.calls.length, 0);
  const same = await configureStudyRoom(env, { id: owner }, { ...update, audience: 'all' }, opt);
  assert.equal(same.room.revision, 1);
});

test('audience update refuses active, malformed or wrong-capacity rooms before any SQL mutation', async () => {
  for (const response of [[{ name: 'catalog-inert-2', maxParticipants: 12, numParticipants: 1 }],
    null, [{ name: 'other', maxParticipants: 12, numParticipants: 0 }],
    [{ name: 'catalog-inert-2', maxParticipants: 99, numParticipants: 0 }]]) {
    const h = configOptions(catalog(), { roomService: { listRooms: async () => response } });
    await assert.rejects(configureStudyRoom(env, { id: owner }, update, h.opt));
    assert.equal(h.calls.length, 0);
  }
});

test('add is explicit-key only, role-bound, revision-checked and never retries unknown mutation', async () => {
  for (const body of [{ ...update, expectedRevision: 0 }, { ...update, roomKey: '5' },
    { ...update, operation: 'add', roomKey: '6', expectedRevision: 0 },
    { ...update, operation: 'add', roomKey: '25', expectedRevision: 0 },
    { ...update, operation: 'add', roomKey: '7', expectedRevision: 1 }]) {
    const h = configOptions(catalog());
    await assert.rejects(configureStudyRoom(env, { id: owner }, body, h.opt)); assert.equal(h.calls.length, 0);
  }
  const h = configOptions(catalog());
  await assert.rejects(configureStudyRoom(env, { id: owner }, update, { ...h.opt, isAdministrator: false }));
  const added = await configureStudyRoom(env, { id: owner }, { ...update, operation: 'add', roomKey: '7', expectedRevision: 0 }, h.opt);
  assert.equal(added.room.roomKey, '7'); assert.equal(added.room.accessRevision, 1);
  let attempts = 0;
  await assert.rejects(configureStudyRoom(env, { id: owner }, update, { ...h.opt,
    configureCatalog: async () => { attempts++; throw new Error('uncertain transport'); } }));
  assert.equal(attempts, 1);
});

test('configuration refuses an unaddressable generation before persisting the catalog', async () => {
  const c = catalog(); const h = configOptions(c);
  const longEnv = { ...env, STUDY_ROOM_NAME: 'r'.repeat(77) };
  assert.equal(resolveStudyRoomSlot(longEnv, '2', { catalog: c }).roomName.length, 79);
  await assert.rejects(configureStudyRoom(longEnv, { id: owner }, update, h.opt), errorCode('STUDY_ROOM_NOT_CONFIGURED'));
  assert.equal(h.calls.length, 0); assert.equal(h.opt.roomService.calls.length, 0);
});

let requestId = 80;
async function withWorker({ admin = false, c = catalog(), paidRows = [], mutate = null, onCall = () => {} }, path, body) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); onCall(url, init);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, is_anonymous: false,
      user_metadata: { role: 'admin', paid: true }, app_metadata: { provider: 'email' } });
    if (url.pathname === '/rest/v1/rpc/admin_authorization_context') return Response.json({ authorized: admin, role: admin ? 'admin' : 'student' });
    if (url.pathname.startsWith('/rest/v1/')) {
      assert.equal(init.headers.Authorization, 'Bearer inert-service-key');
      if (url.pathname.endsWith('/study_room_catalog_v2')) return Response.json(c);
      if (url.pathname.endsWith('/study_room_admission_v1')) {
        const command=JSON.parse(init.body).p_command;
        assert.equal(command.actor,owner); assert.equal(command.operation,'authorize');
        return Response.json({ok:true,allowed:true,admission:{status:'approved',version:1,expiresAt:new Date(Date.now()+600000).toISOString()}});
      }
      if (url.pathname.endsWith('/study_room_configure_v2')) return mutate(JSON.parse(init.body));
      if (url.pathname === '/rest/v1/subscriptions') {
        assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
        assert.equal(url.searchParams.get('status'), 'eq.active');
        assert.equal(url.searchParams.get('source'), 'in.(manual_payment,admin_adjustment,migration)');
        assert.equal(url.searchParams.get('limit'), '1');
        assert.match(url.searchParams.get('or'), /^\(expires_at\.is\.null,expires_at\.gt\.\d{4}-/);
        return Response.json(paidRows);
      }
    }
    if (url.pathname.endsWith('/ListRooms')) return Response.json({ rooms: [{ name: 'catalog-inert-2', maxParticipants: 12, numParticipants: 0 }] });
    throw new Error('Unexpected inert endpoint');
  };
  try {
    return await worker.fetch(new Request('https://worker.inert' + path, { method: 'POST',
      headers: { Origin: 'https://duediligence.ph', Authorization: 'Bearer inert-user',
        'CF-Connecting-IP': `203.0.113.${requestId++}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  } finally { globalThis.fetch = previous; }
}

test('actual Worker uses current paid rows, not user claims, broad Beta flags or provisional proof', async () => {
  const c = catalog(); c.rooms[1].audience = 'paid';
  const good = { id: subscriptionId, user_id: owner, status: 'active', source: 'manual_payment', starts_at: '2020-01-01T00:00:00Z', expires_at: null };
  for (const rows of [[], [{ ...good, source: 'complimentary' }], [good]]) {
    const calls = [];
    const response = await withWorker({ c, paidRows: rows, onCall: u => calls.push(u.pathname) }, '/study-room/join', { roomKey: '2', nickname: 'Reader', paid: true });
    const allowed = rows[0]?.source === 'manual_payment';
    assert.equal(response.status, allowed ? 201 : 403);
    assert.equal(calls.filter(p => p === '/rest/v1/subscriptions').length, allowed ? 2 : 1);
    assert.equal(calls.some(p => /phase4|payment|reserve/.test(p)), false);
    const result = await response.json(); assert.equal('participant_token' in result, allowed);
  }
});

test('actual Worker fails closed on absent catalog and does not expose raw database errors', async () => {
  const absent = await withWorker({ c: null }, '/study-room/access', {});
  assert.equal(absent.status, 503);
  for (const [code, status] of [['PT409', 409], ['PT400', 400], ['42501', 403], ['XX000', 503]]) {
    const response = await withWorker({ admin: true, mutate: () => Response.json({ code, message: 'secret database details' }, { status: 400 }) },
      '/admin/study-room/rooms', { ...update, audience: 'all', label: 'New label' });
    assert.equal(response.status, status);
    assert.equal((await response.text()).includes('secret database details'), false);
  }
});

test('actual Worker add/update require normal verified administrator and exact administrator route', async () => {
  for (const [admin, path] of [[false, '/admin/study-room/rooms'], [false, '/study-room/rooms'], [true, '/study-room/rooms']]) {
    let writes = 0;
    const response = await withWorker({ admin, mutate: () => { writes++; return Response.json({}); } }, path, update);
    assert.equal(response.status, 403); assert.equal(writes, 0);
  }
  let capture;
  const response = await withWorker({ admin: true, mutate: body => {
    capture = body;
    return Response.json({ ok: true, room: { roomKey: '7', label: 'New room', audience: 'paid', revision: 1, accessRevision: 1 } });
  } }, '/admin/study-room/rooms', { operation: 'add', roomKey: '7', label: 'New room', audience: 'paid', expectedRevision: 0,
    p_actor_user_id: subscriptionId, roomName: '../untrusted', accessRevision: 999 });
  assert.equal(response.status, 200);
  assert.deepEqual(capture, { p_actor_user_id: owner, p_operation: 'add', p_room_key: '7', p_label: 'New room', p_audience: 'paid', p_expected_revision: 0 });
});
