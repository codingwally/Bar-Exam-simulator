import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import studyRoomWorker from './index.mjs';
import {
  DEFAULT_STUDY_ROOM_NAME,
  STUDY_ROOM_MAX_PARTICIPANTS,
  STUDY_ROOM_MAX_ROOMS,
  STUDY_ROOM_SLOTS,
  STUDY_ROOM_TOKEN_TTL_SECONDS,
  StudyRoomError,
  createStudyRoom,
  createStudyRoomJoinCredential,
  listStudyRooms,
  muteStudyRoomParticipant,
  normalizeStudyRoomNickname,
  normalizeStudyRoomRoomKey,
  removeStudyRoomParticipant,
  renameStudyRoomParticipant,
  resolveStudyRoomName,
  resolveStudyRoomSlot,
  studyRoomParticipantIdentity,
} from './study-room-core.mjs';
import { createStudyRoomHandlers } from './study-room-routes.mjs';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_NOW = new Date('2026-08-29T00:00:00.000Z');
const TEST_ENV = Object.freeze({
  STUDY_ROOM_ENABLED: 'true',
  STUDY_ROOM_NAME: 'dd-admin-beta-test',
  LIVEKIT_URL: 'wss://duediligence-test.livekit.cloud',
  LIVEKIT_API_KEY: 'test_livekit_key',
  LIVEKIT_API_SECRET: 'test_livekit_secret_with_sufficient_entropy',
});

function roomName(roomKey) {
  return roomKey === '1' ? TEST_ENV.STUDY_ROOM_NAME : `${TEST_ENV.STUDY_ROOM_NAME}-${roomKey}`;
}

function activeRoom(roomKey, overrides = {}) {
  return {
    name: roomName(roomKey),
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    numParticipants: 0,
    creationTime: 1_788_000_000n,
    ...overrides,
  };
}

function createRoomServiceDouble(initialRooms = []) {
  const calls = [];
  const rooms = [...initialRooms];
  return {
    calls,
    rooms,
    async listRooms(names = []) {
      calls.push(['listRooms', names]);
      return rooms.filter((room) => names.length === 0 || names.includes(room.name));
    },
    async createRoom(options) {
      calls.push(['createRoom', options]);
      if (rooms.some((room) => room.name === options.name)) throw new Error('already exists');
      const room = { ...options, creationTime: 1_788_000_000n, numParticipants: 0 };
      rooms.push(room);
      return room;
    },
    async mutePublishedTrack(...args) {
      calls.push(['mutePublishedTrack', ...args]);
      return {};
    },
    async updateParticipant(...args) {
      calls.push(['updateParticipant', ...args]);
      return {};
    },
    async removeParticipant(...args) {
      calls.push(['removeParticipant', ...args]);
    },
  };
}

const TEST_CATALOG = Object.freeze({ schemaVersion: 1, maxRooms: 24, rooms: STUDY_ROOM_SLOTS.map((room) => ({
  roomKey: room.roomKey, label: room.label, audience: room.adminOnly ? 'admin' : 'all', revision: 1, accessRevision: 1,
})) });
const fixedTimeOptions = (roomService) => ({
  roomService,
  catalog: TEST_CATALOG,
  getCatalog: async () => TEST_CATALOG,
  now: () => new Date(TEST_NOW),
});

test('nickname normalization is bounded and rejects impersonation, markup, and bidi controls', () => {
  assert.equal(normalizeStudyRoomNickname('  Dimasalang\n\tReader  '), 'Dimasalang Reader');
  assert.throws(() => normalizeStudyRoomNickname(''), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_REQUIRED'
  ));
  assert.throws(() => normalizeStudyRoomNickname('Admin'), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_RESERVED'
  ));
  assert.throws(() => normalizeStudyRoomNickname('<Dimasalang>'), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_INVALID'
  ));
  assert.throws(() => normalizeStudyRoomNickname('Dima\u202Esalang'), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_INVALID'
  ));
  for (const hiddenCharacter of ['\u200B', '\u200D', '\u2060', '\uFEFF']) {
    assert.throws(() => normalizeStudyRoomNickname(`Dima${hiddenCharacter}salang`), (error) => (
      error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_INVALID'
    ));
  }
  assert.throws(() => normalizeStudyRoomNickname('Founder Admin'), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_RESERVED'
  ));
  assert.throws(() => normalizeStudyRoomNickname('x'.repeat(33)), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NICKNAME_INVALID'
  ));
});

test('bounded catalog room keys preserve the production room as Library and reject raw names', () => {
  assert.equal(STUDY_ROOM_MAX_ROOMS, 24);
  assert.equal(resolveStudyRoomName({}), DEFAULT_STUDY_ROOM_NAME);
  assert.equal(resolveStudyRoomName(TEST_ENV), 'dd-admin-beta-test');
  assert.deepEqual(resolveStudyRoomSlot(TEST_ENV, 1, { catalog: TEST_CATALOG }), {
    roomKey: '1', roomName: 'dd-admin-beta-test', label: 'Library', kind: 'library',
    microphoneAllowed: false, adminOnly: false, audience: 'all', revision: 1, accessRevision: 1,
  });
  assert.deepEqual(resolveStudyRoomSlot(TEST_ENV, '5', { catalog: TEST_CATALOG }), {
    roomKey: '5', roomName: 'dd-admin-beta-test-5', label: 'Inner Chamber', kind: 'inner-chamber',
    microphoneAllowed: true, adminOnly: true, audience: 'admin', revision: 1, accessRevision: 1,
  });
  assert.equal(normalizeStudyRoomRoomKey(undefined, { defaultToFirst: true }), '1');
  assert.equal(normalizeStudyRoomRoomKey('', { defaultToFirst: true }), '1');
  for (const unsafe of ['0', '25', '../room', 'dd-admin-beta-test-2', '1?admin=true']) {
    assert.throws(() => resolveStudyRoomSlot(TEST_ENV, unsafe, { catalog: TEST_CATALOG }), (error) => (
      error instanceof StudyRoomError && error.code === 'STUDY_ROOM_ROOM_INVALID'
    ));
  }
  assert.throws(() => resolveStudyRoomName({ STUDY_ROOM_NAME: '../room?admin=true' }), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NOT_CONFIGURED'
  ));
  assert.throws(
    () => resolveStudyRoomSlot({ STUDY_ROOM_NAME: `r${'x'.repeat(78)}` }, '2', { catalog: TEST_CATALOG }),
    (error) => error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NOT_CONFIGURED',
  );
});

test('room listing returns six seeded policy-aware slots and ignores every untrusted LiveKit room', async () => {
  const roomService = createRoomServiceDouble([
    activeRoom('1', { numParticipants: 3 }),
    activeRoom('3', { numParticipants: 1, metadata: JSON.stringify({ email: 'private@example.com' }) }),
    { name: 'untrusted-room', maxParticipants: 999, numParticipants: 999 },
  ]);
  const catalog = await listStudyRooms(TEST_ENV, { ...fixedTimeOptions(roomService), isAdministrator: false });
  assert.equal(catalog.maxRooms, 24);
  assert.equal(catalog.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(catalog.recording, false);
  assert.deepEqual(catalog.rooms.map((room) => room.roomKey), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(catalog.rooms.map((room) => room.label), [
    'Library', 'Room 1', 'Room 2', 'Room 3', 'Inner Chamber', 'Room 4',
  ]);
  assert.deepEqual(catalog.rooms.map((room) => room.active), [true, false, true, false, false, false]);
  assert.deepEqual(catalog.rooms.map((room) => room.alwaysOpen), [true, true, true, true, false, true]);
  assert.deepEqual(catalog.rooms.map((room) => room.participantCount), [3, 0, 1, 0, 0, 0]);
  assert.equal(catalog.rooms[0].microphoneAllowed, false);
  assert.equal(catalog.rooms[4].adminOnly, true);
  assert.equal(catalog.rooms[4].canJoin, false);
  assert.equal(catalog.rooms.every((room) => room.canCreate === false), true);
  assert.equal(catalog.rooms[0].focusStartedAt, '2026-08-29T10:40:00.000Z');
  assert.equal(catalog.rooms[1].focusStartedAt, null);
  assert.equal(JSON.stringify(catalog).includes('private@example.com'), false);
  assert.equal(JSON.stringify(catalog).includes('untrusted-room'), false);
  assert.equal(Object.hasOwn(catalog.rooms[0], 'roomName'), false);
  assert.deepEqual(roomService.calls[0], ['listRooms', [
    roomName('1'), roomName('2'), roomName('3'), roomName('4'), roomName('5'), roomName('6'),
  ]]);
  assert.equal(roomService.calls.some(([operation]) => operation === 'createRoom'), false);
  const administratorCatalog = await listStudyRooms(TEST_ENV, { ...fixedTimeOptions(roomService), isAdministrator: true });
  assert.deepEqual(administratorCatalog.rooms.map((room) => room.canCreate), [false, false, false, false, true, false]);
});

test('room listing fails closed on unsafe capacity or participant counts', async () => {
  await assert.rejects(
    listStudyRooms(TEST_ENV, {
      catalog: TEST_CATALOG,
      roomService: createRoomServiceDouble([activeRoom('2', {
        maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS + 1,
      })]),
    }),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_UNAVAILABLE'
      && error.status === 503,
  );
  await assert.rejects(
    listStudyRooms(TEST_ENV, {
      catalog: TEST_CATALOG,
      roomService: createRoomServiceDouble([activeRoom('2', {
        numParticipants: STUDY_ROOM_MAX_PARTICIPANTS + 1,
      })]),
    }),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_UNAVAILABLE'
      && error.status === 503,
  );
});

test('administrators can open only catalog slots with bounded policy metadata and no PII', async () => {
  const roomService = createRoomServiceDouble();
  const created = [];
  for (let index = 0; index < STUDY_ROOM_SLOTS.length; index += 1) {
    created.push(await createStudyRoom(TEST_ENV, undefined, {
      ...fixedTimeOptions(roomService), isAdministrator: true,
    }));
  }
  assert.deepEqual(created.map((result) => result.room.roomKey), ['1', '2', '3', '4', '5', '6']);
  assert.equal(created.every((result) => result.created), true);
  assert.equal(roomService.rooms.length, STUDY_ROOM_SLOTS.length);

  for (const [index, room] of roomService.rooms.entries()) {
    const metadataBytes = new TextEncoder().encode(room.metadata).byteLength;
    const metadata = JSON.parse(room.metadata);
    assert.ok(metadataBytes <= 512);
    assert.deepEqual(metadata, {
      schema: 'duediligence-study-room-slot-v2',
      roomKey: String(index + 1),
      label: STUDY_ROOM_SLOTS[index].label,
      kind: STUDY_ROOM_SLOTS[index].kind,
      microphoneAllowed: STUDY_ROOM_SLOTS[index].microphoneAllowed,
      adminOnly: STUDY_ROOM_SLOTS[index].adminOnly,
      createdAt: TEST_NOW.toISOString(),
    });
    assert.equal(room.metadata.includes(TEST_USER_ID), false);
    assert.equal(room.metadata.includes('private@example.com'), false);
  }

  await assert.rejects(
    createStudyRoom(TEST_ENV, undefined, { ...fixedTimeOptions(roomService), isAdministrator: true }),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ROOM_LIMIT_REACHED'
      && error.status === 409,
  );
  const idempotent = await createStudyRoom(TEST_ENV, '2', {
    ...fixedTimeOptions(roomService), isAdministrator: true,
  });
  assert.equal(idempotent.created, false);
  assert.equal(idempotent.room.roomKey, '2');
  assert.equal(roomService.rooms.length, STUDY_ROOM_SLOTS.length);
});

test('a concurrent create race recovers only the trusted capped slot', async () => {
  const calls = [];
  let listCount = 0;
  const roomService = {
    async listRooms(names) {
      listCount += 1;
      calls.push(['listRooms', names]);
      return listCount === 1 ? [] : [activeRoom('4')];
    },
    async createRoom(options) {
      calls.push(['createRoom', options]);
      throw new Error('already exists');
    },
  };
  const result = await createStudyRoom(TEST_ENV, '4', {
    ...fixedTimeOptions(roomService), isAdministrator: true,
  });
  assert.equal(result.created, false);
  assert.equal(result.room.roomKey, '4');
  assert.deepEqual(calls.map(([operation]) => operation), ['listRooms', 'createRoom', 'listRooms']);
  assert.equal(calls[0][1][0], roomName('4'));
  assert.equal(calls[1][1].name, roomName('4'));
  assert.equal(calls[2][1][0], roomName('4'));
});

test('general-room credential is active-room-bound, short-lived, chat-enabled, and screen-share capable', async () => {
  const roomService = createRoomServiceDouble([activeRoom('3')]);
  const credential = await createStudyRoomJoinCredential(
    TEST_ENV,
    { id: TEST_USER_ID, email: 'private@example.com' },
    '3',
    '  Dimasalang  ',
    { ...fixedTimeOptions(roomService), isAdministrator: false },
  );
  const claims = await new TokenVerifier(
    TEST_ENV.LIVEKIT_API_KEY,
    TEST_ENV.LIVEKIT_API_SECRET,
  ).verify(credential.participantToken);

  assert.match(credential.participantIdentity, /^sr_[A-Za-z0-9_-]{24}$/u);
  assert.equal(credential.participantIdentity.includes(TEST_USER_ID), false);
  assert.equal(credential.participantIdentity.includes('private'), false);
  assert.equal(claims.sub, credential.participantIdentity);
  assert.equal(claims.name, 'Dimasalang');
  assert.equal(claims.video.room, roomName('3'));
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, true);
  assert.equal(claims.video.canUpdateOwnMetadata, true);
  assert.deepEqual(claims.video.canPublishSources, [
    'camera', 'microphone', 'screen_share', 'screen_share_audio',
  ]);
  assert.notEqual(claims.video.roomAdmin, true);
  assert.equal(claims.metadata, undefined);
  assert.equal(claims.attributes, undefined);
  assert.equal(claims.roomConfig, undefined);
  assert.ok(Number(claims.exp) - Number(claims.nbf) <= STUDY_ROOM_TOKEN_TTL_SECONDS + 1);
  assert.ok(Number(claims.exp) - Number(claims.nbf) >= STUDY_ROOM_TOKEN_TTL_SECONDS - 1);
  assert.equal(credential.serverUrl, TEST_ENV.LIVEKIT_URL);
  assert.equal(credential.roomKey, '3');
  assert.equal(credential.roomLabel, 'Room 2');
  assert.equal(credential.roomName, roomName('3'));
  assert.equal(credential.roomKind, 'general');
  assert.equal(credential.microphoneAllowed, true);
  assert.equal(credential.focusStartedAt, '2026-08-29T10:40:00.000Z');
  assert.equal(credential.expiresInSeconds, STUDY_ROOM_TOKEN_TTL_SECONDS);

  assert.equal(roomService.calls.some(([operation]) => operation === 'createRoom'), false);
});

test('first Library join opens only its trusted capped room and never grants microphone publication', async () => {
  const roomService = createRoomServiceDouble();
  const library = await createStudyRoomJoinCredential(
    TEST_ENV, { id: TEST_USER_ID }, '1', 'Dimasalang', fixedTimeOptions(roomService),
  );
  const claims = await new TokenVerifier(
    TEST_ENV.LIVEKIT_API_KEY,
    TEST_ENV.LIVEKIT_API_SECRET,
  ).verify(library.participantToken);
  assert.equal(library.microphoneAllowed, false);
  assert.deepEqual(claims.video.canPublishSources, ['camera', 'screen_share']);
  assert.equal(claims.video.room, roomName('1'));
  assert.notEqual(claims.video.roomAdmin, true);
  assert.notEqual(claims.video.roomCreate, true);
  assert.deepEqual(roomService.calls.map(([operation]) => operation), ['listRooms', 'createRoom']);
  const created = roomService.rooms[0];
  assert.equal(created.name, roomName('1'));
  assert.equal(created.maxParticipants, 12);
  assert.equal(created.emptyTimeout, 600);
  assert.equal(created.departureTimeout, 120);
  const metadata = JSON.parse(created.metadata);
  assert.equal(metadata.adminOnly, false);
  assert.equal(metadata.microphoneAllowed, false);
  assert.equal(metadata.roomKey, '1');
  assert.equal(created.metadata.includes(TEST_USER_ID), false);
});

test('simultaneous member first joins converge on one public room and retain non-admin grants', async () => {
  for (const roomKey of ['2', '3', '4']) {
    const roomService = createRoomServiceDouble();
    const credentials = await Promise.all([TEST_USER_ID, SECOND_USER_ID].map((id) => (
      createStudyRoomJoinCredential(TEST_ENV, { id }, roomKey, 'Dimasalang', fixedTimeOptions(roomService))
    )));
    assert.equal(roomService.rooms.length, 1);
    assert.equal(roomService.rooms[0].name, roomName(roomKey));
    assert.equal(roomService.rooms[0].maxParticipants, 12);
    for (const credential of credentials) {
      const claims = await new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET)
        .verify(credential.participantToken);
      assert.equal(claims.video.room, roomName(roomKey));
      assert.equal(claims.video.roomJoin, true);
      assert.notEqual(claims.video.roomAdmin, true);
      assert.notEqual(claims.video.roomCreate, true);
      assert.equal(credential.administrator, false);
    }
    assert.equal(new Set(credentials.map((credential) => credential.participantIdentity)).size, 2);
  }
});

test('first join race recovery rejects malformed lists, wrong rooms and wrong capacity', async () => {
  for (const scenario of ['malformed-list', 'wrong-room', 'wrong-capacity', 'create-failure']) {
    let creates = 0;
    let lists = 0;
    const roomService = {
      async listRooms(names) {
        assert.deepEqual(names, [roomName('2')]);
        lists += 1;
        if (scenario === 'malformed-list') return {};
        if (lists === 1) return [];
        if (scenario === 'wrong-room') return [activeRoom('3')];
        if (scenario === 'wrong-capacity') return [activeRoom('2', { maxParticipants: 13 })];
        return [];
      },
      async createRoom(options) {
        creates += 1;
        assert.equal(options.name, roomName('2'));
        if (scenario === 'wrong-room') return activeRoom('3');
        throw new Error('already exists or unavailable');
      },
    };
    await assert.rejects(createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, '2',
      'Dimasalang', fixedTimeOptions(roomService)), (error) => (
      error instanceof StudyRoomError && error.code === 'STUDY_ROOM_UNAVAILABLE' && error.status === 503
    ), scenario);
    assert.equal(creates, scenario === 'malformed-list' ? 0 : 1);
  }
});

test('Inner Chamber rejects members and accepts administrators only after it is open', async () => {
  const roomService = createRoomServiceDouble([activeRoom('5')]);
  await assert.rejects(
    createStudyRoomJoinCredential(
      TEST_ENV, { id: TEST_USER_ID }, '5', 'Dimasalang', fixedTimeOptions(roomService),
    ),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ADMIN_ROOM_REQUIRED'
      && error.status === 403,
  );
  const credential = await createStudyRoomJoinCredential(
    TEST_ENV,
    { id: TEST_USER_ID },
    '5',
    'Dimasalang',
    { ...fixedTimeOptions(roomService), isAdministrator: true },
  );
  assert.equal(credential.roomLabel, 'Inner Chamber');
  assert.equal(credential.administrator, true);
  const absent = createRoomServiceDouble();
  await assert.rejects(createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, '5',
    'Dimasalang', { ...fixedTimeOptions(absent), isAdministrator: true }), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_ROOM_NOT_OPEN' && error.status === 409
  ));
  assert.equal(absent.calls.some(([operation]) => operation === 'createRoom'), false);
});

test('repeated joins only inspect an existing slot and never repair a wrong capacity', async () => {
  const roomService = createRoomServiceDouble([activeRoom('2')]);
  await createStudyRoomJoinCredential(
    TEST_ENV, { id: TEST_USER_ID }, '2', 'Dimasalang', fixedTimeOptions(roomService),
  );
  await createStudyRoomJoinCredential(
    TEST_ENV, { id: TEST_USER_ID }, '2', 'Dimasalang', fixedTimeOptions(roomService),
  );
  assert.equal(roomService.calls.filter(([operation]) => operation === 'createRoom').length, 0);

  const wrongCapacity = createRoomServiceDouble([activeRoom('2', {
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS + 1,
  })]);
  await assert.rejects(
    createStudyRoomJoinCredential(
      TEST_ENV,
      { id: TEST_USER_ID },
      '2',
      'Dimasalang',
      fixedTimeOptions(wrongCapacity),
    ),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_UNAVAILABLE'
      && error.status === 503,
  );
});

test('room-wide moderation is key-bound while nickname changes remain self-only', async () => {
  const roomService = createRoomServiceDouble();
  const identity = await studyRoomParticipantIdentity(TEST_ENV, TEST_USER_ID);

  await muteStudyRoomParticipant(TEST_ENV, '2', identity, 'TR_audio123', fixedTimeOptions(roomService));
  assert.deepEqual(roomService.calls.at(-1), [
    'mutePublishedTrack', roomName('2'), identity, 'TR_audio123', true,
  ]);

  const renamed = await renameStudyRoomParticipant(
    TEST_ENV, TEST_USER_ID, '4', identity, 'Dimasalang', fixedTimeOptions(roomService),
  );
  assert.equal(renamed.roomKey, '4');
  assert.deepEqual(roomService.calls.at(-1), [
    'updateParticipant', roomName('4'), identity, { name: 'Dimasalang' },
  ]);

  await removeStudyRoomParticipant(TEST_ENV, '3', identity, fixedTimeOptions(roomService));
  assert.deepEqual(roomService.calls.at(-1), ['removeParticipant', roomName('3'), identity]);

  const otherIdentity = await studyRoomParticipantIdentity(TEST_ENV, SECOND_USER_ID);
  await assert.rejects(
    renameStudyRoomParticipant(
      TEST_ENV, TEST_USER_ID, '1', otherIdentity, 'Dimasalang', fixedTimeOptions(roomService),
    ),
    (error) => error instanceof StudyRoomError && error.code === 'STUDY_ROOM_RENAME_FORBIDDEN',
  );
  await assert.rejects(
    muteStudyRoomParticipant(TEST_ENV, roomName('2'), identity, 'TR_audio123', fixedTimeOptions(roomService)),
    (error) => error instanceof StudyRoomError && error.code === 'STUDY_ROOM_ROOM_INVALID',
  );
});

test('upstream LiveKit failures expose only a stable safe error', async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await assert.rejects(
      createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, '1', 'Dimasalang', {
        ...fixedTimeOptions(null),
        roomService: {
          async listRooms() {
            throw Object.assign(new Error('upstream leaked secret test_livekit_secret'), { status: 502 });
          },
        },
      }),
      (error) => error instanceof StudyRoomError
        && error.code === 'STUDY_ROOM_UNAVAILABLE'
        && error.status === 503
        && error.message === 'The Study Room media service is temporarily unavailable.',
    );
  } finally {
    console.error = originalConsoleError;
  }
  const logText = JSON.stringify(logged);
  assert.equal(logText.includes('upstream leaked secret'), false);
  assert.equal(logText.includes(TEST_ENV.LIVEKIT_API_SECRET), false);
  assert.match(logText, /ensure_room/u);
  assert.match(logText, /502/u);
});

function routeHarness({
  role = 'admin',
  authorized = true,
  memberAllowed = false,
  memberAccess = null,
  body = {},
} = {}) {
  const calls = [];
  const user = { id: TEST_USER_ID };
  const catalog = {
    maxRooms: STUDY_ROOM_MAX_ROOMS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    recording: false,
    rooms: [{ roomKey: '1', label: 'Library', active: false, microphoneAllowed: false }],
  };
  const handlers = createStudyRoomHandlers({
    readCatalog: async () => TEST_CATALOG,
    rateLimit: async (_request, _env, scope) => calls.push(['rateLimit', scope]),
    authenticate: async () => {
      calls.push(['authenticate']);
      return user;
    },
    authorizeAdmin: async (_env, receivedUser) => {
      calls.push(['authorizeAdmin', receivedUser.id]);
      return { authorized, role };
    },
    authorizeMember: async (_env, receivedUser) => {
      calls.push(['authorizeMember', receivedUser.id]);
      return memberAccess || {
        allowed: memberAllowed,
        basis: memberAllowed ? 'signed_in' : 'none',
      };
    },
    parseJson: async (_request, maximumBytes) => {
      calls.push(['parseJson', maximumBytes]);
      return body;
    },
    describeRoom: () => ({
      roomName: TEST_ENV.STUDY_ROOM_NAME,
      maxRooms: STUDY_ROOM_MAX_ROOMS,
      maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
      recording: false,
    }),
    listRooms: async (...args) => {
      calls.push(['listRooms', ...args]);
      return catalog;
    },
    createRoom: async (...args) => {
      calls.push(['createRoom', ...args]);
      return {
        created: true,
        room: {
          roomKey: String(args[1] || '1'),
          label: STUDY_ROOM_SLOTS[Number(args[1] || '1') - 1].label,
          active: true,
        },
      };
    },
    issueCredential: async (...args) => {
      calls.push(['issueCredential', ...args]);
      return {
        serverUrl: TEST_ENV.LIVEKIT_URL,
        participantToken: 'opaque-token',
        roomKey: String(args[2]),
        roomLabel: STUDY_ROOM_SLOTS[Number(args[2]) - 1].label,
        roomName: roomName(String(args[2])),
        roomKind: STUDY_ROOM_SLOTS[Number(args[2]) - 1].kind,
        microphoneAllowed: STUDY_ROOM_SLOTS[Number(args[2]) - 1].microphoneAllowed,
        administrator: args[4]?.isAdministrator === true,
        participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
        participantName: 'Dimasalang',
        focusStartedAt: '2026-08-29T10:40:00.000Z',
        expiresInSeconds: STUDY_ROOM_TOKEN_TTL_SECONDS,
      };
    },
    muteParticipant: async (...args) => {
      calls.push(['muteParticipant', ...args]);
      return { action: 'muted', roomKey: String(args[1]) };
    },
    removeParticipant: async (...args) => {
      calls.push(['removeParticipant', ...args]);
      return { action: 'removed', roomKey: String(args[1]) };
    },
    renameParticipant: async (...args) => {
      calls.push(['renameParticipant', ...args]);
      return { action: 'renamed', roomKey: String(args[2]) };
    },
    respond: (responseBody, status) => ({ body: responseBody, status }),
  });
  return { calls, catalog, handlers };
}

test('admin, founder_admin, and super_admin can create and enter all configured rooms', async () => {
  for (const role of ['admin', 'founder_admin', 'super_admin']) {
    const { handlers } = routeHarness({ role, body: { operation: 'list' } });
    const access = await handlers.access(new Request('https://worker.test'), TEST_ENV, '', '');
    assert.equal(access.status, 200);
    assert.equal(access.body.role, role);
    assert.equal(access.body.administrator, true);
    assert.equal(access.body.canCreateRooms, true);
    assert.equal(access.body.maxRooms, STUDY_ROOM_MAX_ROOMS);
    const rooms = await handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', '');
    assert.equal(rooms.status, 200);
    assert.equal(rooms.body.role, role);
    assert.equal(rooms.body.maxRooms, STUDY_ROOM_MAX_ROOMS);
  }

  for (const role of ['', 'member', 'moderator', 'support', 'founder-admin', 'Founder Admin']) {
    const { handlers } = routeHarness({ role, memberAllowed: false });
    await assert.rejects(
      handlers.access(new Request('https://worker.test'), TEST_ENV, '', ''),
      (error) => error instanceof StudyRoomError
        && error.code === 'STUDY_ROOM_ACCOUNT_UNAVAILABLE'
        && error.status === 403,
    );
  }
});

test('signed-in members can list and join public slots without the privileged create endpoint', async () => {
  const listed = routeHarness({
    role: 'member',
    authorized: false,
    memberAccess: { allowed: true, basis: 'signed_in' },
    body: { operation: 'list' },
  });
  const access = await listed.handlers.access(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(access.body.allowed, true);
  assert.equal(access.body.role, 'member');
  assert.equal(access.body.administrator, false);
  assert.equal(access.body.canCreateRooms, false);

  const rooms = await listed.handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(rooms.body.role, 'member');
  assert.equal(listed.calls.find(([operation]) => operation === 'listRooms')[2].isAdministrator, false);
  assert.deepEqual(listed.calls.find(([operation]) => operation === 'listRooms')[2].catalog, TEST_CATALOG);

  const joined = routeHarness({
    role: 'member',
    authorized: false,
    memberAccess: { allowed: true, basis: 'signed_in' },
    body: { roomKey: '2', nickname: 'Participant 12' },
  });
  const join = await joined.handlers.join(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(join.body.room_key, '2');
  assert.equal(join.body.administrator, false);
  assert.equal(joined.calls.find(([operation]) => operation === 'issueCredential').at(-1).isAdministrator, false);

  const create = routeHarness({
    role: 'member',
    authorized: false,
    memberAccess: { allowed: true, basis: 'signed_in' },
    body: { operation: 'create', roomKey: '2' },
  });
  await assert.rejects(
    create.handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ADMIN_REQUIRED'
      && error.status === 403,
  );
  assert.equal(create.calls.some(([operation]) => operation === 'createRoom'), false);
});

test('free, paid, expired-paid and exhausted-credit members share non-administrator room grants', async () => {
  for (const commercialState of ['free', 'paid', 'early_access', 'paid_subscription_expired', 'credits_exhausted', 'beta_expired']) {
    const memberAccess = { allowed: true, basis: 'signed_in', commercialState };
    const listed = routeHarness({ role: 'student', authorized: false, memberAccess, body: { operation: 'list' } });
    const rooms = await listed.handlers.rooms(new Request('https://worker.test/study-room/rooms'), TEST_ENV, '', '');
    assert.equal(rooms.status, 200, commercialState);
    assert.equal(rooms.body.administrator, false);
    assert.equal(rooms.body.canCreateRooms, false);
    const joined = routeHarness({ role: 'student', authorized: false, memberAccess,
      body: { roomKey: '2', nickname: 'Participant 12' } });
    const join = await joined.handlers.join(new Request('https://worker.test/study-room/join'), TEST_ENV, '', '');
    assert.equal(join.status, 201, commercialState);
    assert.equal(join.body.administrator, false);
    assert.equal(joined.calls.find(([name]) => name === 'issueCredential').at(-1).isAdministrator, false);
  }
});

test('all moderation remains administrator-only, including a signed-in member nickname change', async () => {
  const moderated = routeHarness({
    role: 'member',
    authorized: false,
    memberAccess: { allowed: true, basis: 'signed_in' },
    body: {
      operation: 'rename',
      roomKey: '2',
      participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
      nickname: 'Dimasalang',
    },
  });
  await assert.rejects(
    moderated.handlers.moderate(new Request('https://worker.test/study-room/moderate'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ADMIN_REQUIRED'
      && error.status === 403,
  );
  assert.equal(moderated.calls.some(([operation]) => operation === 'parseJson'), false);
  assert.equal(moderated.calls.some(([operation]) => operation === 'renameParticipant'), false);
});

test('room creation is authenticated, bounded, idempotent-status aware, and ignores raw name fields', async () => {
  const { calls, handlers } = routeHarness({
    role: 'admin',
    body: { operation: 'create', roomKey: '4', roomName: '../untrusted' },
  });
  const response = await handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(response.status, 201);
  assert.equal(response.body.created, true);
  assert.equal(response.body.room.roomKey, '4');
  assert.deepEqual(calls.slice(0, 4), [
    ['rateLimit', 'rooms'],
    ['authenticate'],
    ['authorizeAdmin', TEST_USER_ID],
    ['parseJson', 4_096],
  ]);
  const createCall = calls.find(([operation]) => operation === 'createRoom');
  assert.equal(createCall[1], TEST_ENV);
  assert.equal(createCall[2], '4');
  assert.equal(createCall[3].isAdministrator, true);
  assert.deepEqual(createCall[3].catalog, TEST_CATALOG);
  assert.equal(createCall.includes('../untrusted'), false);

  const unsupported = routeHarness({ body: { operation: 'delete-all' } });
  await assert.rejects(
    unsupported.handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_OPERATION_UNSUPPORTED',
  );
});

test('join and rename are room-key aware with a slot-one compatibility bridge', async () => {
  const legacy = routeHarness({ body: { nickname: 'Dimasalang' } });
  const legacyJoin = await legacy.handlers.join(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(legacyJoin.body.room_key, '1');
  assert.equal(legacy.calls.find(([operation]) => operation === 'issueCredential')[3], '1');

  const selected = routeHarness({ body: { roomKey: '4', nickname: 'Dimasalang' } });
  const selectedJoin = await selected.handlers.join(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(selectedJoin.body.room_key, '4');
  assert.equal(selectedJoin.body.room_label, 'Room 3');
  const credentialCall = selected.calls.find(([operation]) => operation === 'issueCredential');
  assert.deepEqual(credentialCall.slice(2, 5), [
    { id: TEST_USER_ID }, '4', 'Dimasalang',
  ]);
  assert.equal(credentialCall[5].isAdministrator, true);
  assert.deepEqual(credentialCall[5].catalog, TEST_CATALOG);

  const identity = 'sr_abcdefghijklmnopqrstuvwx';
  const rename = routeHarness({
    role: 'admin',
    body: { operation: 'rename', roomKey: '3', participantIdentity: identity, nickname: 'Dimasalang' },
  });
  const renamed = await rename.handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(renamed.status, 200);
  assert.deepEqual(rename.calls.find(([operation]) => operation === 'renameParticipant').slice(2, 6), [
    TEST_USER_ID, '3', identity, 'Dimasalang',
  ]);
});

test('room-wide mute and removal allow verified administrators only while muted=false never unmutes', async () => {
  const identity = 'sr_abcdefghijklmnopqrstuvwx';
  for (const operation of ['mute', 'remove']) {
    const member = routeHarness({
      role: 'student', authorized: false, memberAllowed: true,
      body: {
        operation,
        roomKey: '2',
        participantIdentity: identity,
        trackSid: 'TR_audio123',
        muted: false,
      },
    });
    await assert.rejects(
      member.handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', ''),
      (error) => error instanceof StudyRoomError
        && error.code === 'STUDY_ROOM_ADMIN_REQUIRED'
        && error.status === 403,
    );
    assert.equal(member.calls.some(([name]) => name === 'muteParticipant' || name === 'removeParticipant'), false);
  }

  for (const role of ['admin', 'founder_admin', 'super_admin']) {
    const privileged = routeHarness({
      role,
      body: {
        operation: 'mute',
        roomKey: '2',
        participantIdentity: identity,
        trackSid: 'TR_audio123',
        muted: false,
      },
    });
    const response = await privileged.handlers.moderate(
      new Request('https://worker.test'), TEST_ENV, '', '',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(privileged.calls.find(([operation]) => operation === 'muteParticipant').slice(2, 5), [
      '2', identity, 'TR_audio123',
    ]);
    const remove = routeHarness({ role, body: { operation: 'remove', roomKey: '3', participantIdentity: identity } });
    const removed = await remove.handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', '');
    assert.equal(removed.status, 200);
    assert.deepEqual(remove.calls.find(([operation]) => operation === 'removeParticipant').slice(2, 4), ['3', identity]);
    assert.deepEqual(remove.calls.find(([operation]) => operation === 'removeParticipant').at(-1).catalog, TEST_CATALOG);
  }
});

test('access, rooms, join, and moderation rate-limit and re-authorize before payload handling', async () => {
  const cases = [
    ['access', {}, 'access', 'admin'],
    ['rooms', { operation: 'list' }, 'rooms', 'admin'],
    ['join', { roomKey: '2', nickname: 'Dimasalang' }, 'join', 'admin'],
    ['moderate', {
      operation: 'rename',
      roomKey: '2',
      participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
      nickname: 'Dimasalang',
    }, 'moderate', 'admin'],
  ];
  for (const [handlerName, body, expectedScope, role] of cases) {
    const { calls, handlers } = routeHarness({ body, role });
    await handlers[handlerName](new Request('https://worker.test'), TEST_ENV, '', '');
    assert.deepEqual(calls.slice(0, 3), [
      ['rateLimit', expectedScope],
      ['authenticate'],
      ['authorizeAdmin', TEST_USER_ID],
    ]);
  }

  const handlers = createStudyRoomHandlers({
    readCatalog: async () => TEST_CATALOG,
    rateLimit: async () => {},
    authenticate: async () => ({ id: TEST_USER_ID }),
    authorizeAdmin: async () => ({ authorized: false, role: 'admin' }),
    authorizeMember: async () => ({ allowed: false }),
  });
  await assert.rejects(
    handlers.access(new Request('https://worker.test'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ACCOUNT_UNAVAILABLE'
      && error.status === 403,
  );
});

test('production Worker route re-verifies Supabase admin authorization and returns no-store catalog-bound access data', async () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    upstreamCalls.push([url.pathname, init.method || 'GET']);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({
        id: TEST_USER_ID,
        email: 'admin@example.com',
        user_metadata: { full_name: 'Admin Tester' },
        app_metadata: { provider: 'email' },
      });
    }
    if (url.pathname === '/rest/v1/rpc/study_room_catalog_v1') return Response.json(TEST_CATALOG);
    if (url.pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role: 'founder_admin' });
    }
    throw new Error(`Unexpected upstream call: ${url.pathname}`);
  };

  try {
    const response = await studyRoomWorker.fetch(new Request(
      'https://worker.example/admin/study-room/access',
      {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          Authorization: 'Bearer opaque-test-session',
          'CF-Connecting-IP': '203.0.113.8',
        },
      },
    ), {
      ...TEST_ENV,
      ALLOWED_ORIGIN: 'https://duediligence.ph',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test_service_role',
      GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key',
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.allowed, true);
    assert.equal(body.role, 'founder_admin');
    assert.equal(body.administrator, true);
    assert.equal(body.canCreateRooms, true);
    assert.equal(body.maxRooms, STUDY_ROOM_MAX_ROOMS);
    assert.deepEqual(upstreamCalls, [
      ['/auth/v1/user', 'GET'],
      ['/rest/v1/rpc/admin_authorization_context', 'POST'],
      ['/rest/v1/rpc/study_room_catalog_v1', 'POST'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production Worker gives all active signed-in accounts access and room-scoped tokens without a billing RPC', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const state of ['free', 'paid', 'early_access', 'paid_subscription_expired', 'credits_exhausted', 'beta_expired']) {
      for (const [pathname, payload, expectedStatus] of [
        ['/study-room/access', {}, 200],
        ['/study-room/rooms', { operation: 'list' }, 200],
        ['/study-room/join', { roomKey: '2', nickname: 'Participant 12' }, 201],
      ]) {
        const calls = [];
        globalThis.fetch = async (input, init = {}) => {
          const url = new URL(String(input));
          calls.push([url.pathname, init.method || 'GET']);
          if (url.pathname === '/auth/v1/user') return Response.json({
            id: TEST_USER_ID, email: 'member@example.com', is_anonymous: false,
            user_metadata: { full_name: 'Member Tester', commercialState: state },
            app_metadata: { provider: 'email' },
          });
          if (url.pathname === '/rest/v1/rpc/study_room_catalog_v1') return Response.json(TEST_CATALOG);
          if (url.pathname === '/rest/v1/rpc/admin_authorization_context') return Response.json(
            { message: 'Administrator authorization required' }, { status: 403 });
          if (url.pathname === '/twirp/livekit.RoomService/ListRooms') return Response.json({
            rooms: [],
          });
          if (url.pathname === '/twirp/livekit.RoomService/CreateRoom') {
            const creation = JSON.parse(init.body);
            assert.equal(creation.name, roomName('2'));
            assert.equal(creation.maxParticipants, 12);
            assert.equal(creation.emptyTimeout, 600);
            assert.equal(creation.departureTimeout, 120);
            assert.equal(JSON.parse(creation.metadata).adminOnly, false);
            return Response.json({ ...creation, numParticipants: 0, creationTime: '1788000000' });
          }
          throw new Error('Unexpected upstream: ' + url.pathname);
        };
        const response = await studyRoomWorker.fetch(new Request('https://worker.example' + pathname, {
          method: 'POST', headers: { Origin: 'https://duediligence.ph', Authorization: 'Bearer opaque-' + state,
            'CF-Connecting-IP': '203.0.113.31', 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }), { ...TEST_ENV, ALLOWED_ORIGIN: 'https://duediligence.ph', SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'test_service_role', GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key' });
        const body = await response.json();
        assert.equal(response.status, expectedStatus, state + pathname);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(body.administrator, false);
        assert.deepEqual(calls.slice(0, 2), [
          ['/auth/v1/user', 'GET'],
          ['/rest/v1/rpc/admin_authorization_context', 'POST'],
        ]);
        assert.equal(calls.some(([p]) => p.includes('access_snapshot') || p.includes('reserve')), false);
        if (pathname.endsWith('/join')) {
          assert.deepEqual(calls.slice(2), [
            ['/rest/v1/rpc/study_room_catalog_v1', 'POST'],
            ['/twirp/livekit.RoomService/ListRooms', 'POST'],
            ['/twirp/livekit.RoomService/CreateRoom', 'POST'],
            ['/rest/v1/rpc/study_room_catalog_v1', 'POST'],
          ]);
          const claims = await new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET)
            .verify(body.participant_token);
          assert.equal(claims.video.room, roomName('2'));
          assert.equal(claims.video.roomJoin, true);
          assert.notEqual(claims.video.roomAdmin, true);
          assert.notEqual(claims.video.roomCreate, true);
          assert.deepEqual(claims.video.canPublishSources, ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
          assert.equal(body.recording, false);
        } else {
          assert.equal(body.role, 'member'); assert.equal(body.canCreateRooms, false);
          assert.equal(calls.some(([path]) => path.endsWith('/CreateRoom')), false);
          if (pathname.endsWith('/rooms')) {
            assert.deepEqual(body.rooms.map((room) => room.alwaysOpen), [true, true, true, true, false, true]);
            assert.equal(body.rooms.every((room) => room.active === false), true);
          }
        }
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('production Study Room rejects anonymous, banned, deleted and invalid active-account responses before authorization or LiveKit', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const restriction of [
      { is_anonymous: true }, { is_anonymous: 'false' }, { banned_until: '2999-01-01T00:00:00Z' },
      { banned_until: 'invalid' }, { deleted_at: '2026-01-01T00:00:00Z' }, { id: 'invalid-user-id' },
    ]) {
      const calls = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input)); calls.push(url.pathname);
        assert.equal(url.pathname, '/auth/v1/user');
        return Response.json({ id: TEST_USER_ID, email: 'member@example.com',
          app_metadata: { provider: 'email' }, ...restriction });
      };
      const response = await studyRoomWorker.fetch(new Request('https://worker.example/study-room/join', {
        method: 'POST', headers: { Origin: 'https://duediligence.ph', Authorization: 'Bearer restricted-session',
          'CF-Connecting-IP': '203.0.113.32', 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey: '2', nickname: 'Participant 12' }),
      }), { ...TEST_ENV, ALLOWED_ORIGIN: 'https://duediligence.ph', SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test_service_role', GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key' });
      assert.equal(response.status, 403);
      const body = await response.json(); assert.equal(body.error.code, 'STUDY_ROOM_ACCOUNT_UNAVAILABLE');
      assert.deepEqual(calls, ['/auth/v1/user']);
      assert.equal('participant_token' in body, false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Study Room fails closed on signed-out, invalid, missing and unavailable Auth responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const item of [
      { token: null, status: 401, calls: 0 },
      { token: 'Basic invalid', status: 401, calls: 0 },
      { token: 'Bearer invalid', remoteStatus: 401, status: 401 },
      { token: 'Bearer missing', remoteBody: {}, status: 503 },
      { token: 'Bearer unavailable', remoteStatus: 503, status: 503 },
    ]) {
      const calls = [];
      globalThis.fetch = async (input) => {
        calls.push(new URL(String(input)).pathname);
        assert.equal(calls.at(-1), '/auth/v1/user');
        return Response.json(item.remoteBody || {}, { status: item.remoteStatus || 200 });
      };
      const response = await studyRoomWorker.fetch(new Request('https://worker.example/study-room/access', {
        method: 'POST', headers: { Origin: 'https://duediligence.ph', 'CF-Connecting-IP': '203.0.113.33',
          ...(item.token ? { Authorization: item.token } : {}) },
      }), { ...TEST_ENV, ALLOWED_ORIGIN: 'https://duediligence.ph', SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test_service_role', GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key' });
      assert.equal(response.status, item.status);
      if (item.calls !== undefined) assert.equal(calls.length, item.calls);
      assert.equal('participant_token' in await response.json(), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('active free members cannot create rooms, moderate, or use any legacy admin endpoint', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [pathname, payload] of [
      ['/study-room/rooms', { operation: 'create', roomKey: '2' }],
      ...['mute', 'remove', 'rename'].map(operation => ['/study-room/moderate', { operation, roomKey: '2' }]),
      ...['access', 'rooms', 'join', 'moderate'].map(operation => ['/admin/study-room/' + operation, {}]),
      ['/study-room/join', { roomKey: '5', nickname: 'Participant 12' }],
    ]) {
      const calls = [];
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname; calls.push(pathname);
        if (pathname === '/rest/v1/rpc/study_room_catalog_v1') return Response.json(TEST_CATALOG);
        if (pathname === '/auth/v1/user') return Response.json({ id: TEST_USER_ID, is_anonymous: false,
          user_metadata: { role: 'super_admin', administrator: true }, app_metadata: { provider: 'email' } });
        if (pathname === '/rest/v1/rpc/admin_authorization_context') return Response.json(
          { message: 'Administrator authorization required' }, { status: 403 });
        throw new Error('Unexpected privileged call: ' + pathname);
      };
      const response = await studyRoomWorker.fetch(new Request('https://worker.example' + pathname, {
        method: 'POST', headers: { Origin: 'https://duediligence.ph', Authorization: 'Bearer free-member',
          'CF-Connecting-IP': '203.0.113.34', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }), { ...TEST_ENV, ALLOWED_ORIGIN: 'https://duediligence.ph', SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test_service_role', GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key' });
      assert.equal(response.status, 403, pathname);
      assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/rpc/admin_authorization_context',
        ...(pathname === '/study-room/join' ? ['/rest/v1/rpc/study_room_catalog_v1'] : [])]);
      assert.equal('participant_token' in await response.json(), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy admin Study Room aliases remain administrator-only', async () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    upstreamCalls.push([url.pathname, init.method || 'GET']);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({
        id: TEST_USER_ID,
        email: 'member@example.com',
        user_metadata: { full_name: 'Member Tester' },
        app_metadata: { provider: 'email' },
      });
    }
    if (url.pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json(
        { message: 'Administrator authorization required' },
        { status: 403 },
      );
    }
    throw new Error(`Unexpected upstream call: ${url.pathname}`);
  };

  try {
    const response = await studyRoomWorker.fetch(new Request(
      'https://worker.example/admin/study-room/access',
      {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          Authorization: 'Bearer opaque-member-session',
          'CF-Connecting-IP': '203.0.113.10',
        },
      },
    ), {
      ...TEST_ENV,
      ALLOWED_ORIGIN: 'https://duediligence.ph',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test_service_role',
      GUEST_USAGE_HMAC_KEY: 'test_rate_limit_key',
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'STUDY_ROOM_ADMIN_REQUIRED');
    assert.deepEqual(upstreamCalls, [
      ['/auth/v1/user', 'GET'],
      ['/rest/v1/rpc/admin_authorization_context', 'POST'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
