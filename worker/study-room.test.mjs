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

const fixedTimeOptions = (roomService) => ({
  roomService,
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

test('five trusted room keys preserve the production room as Library and reject raw names', () => {
  assert.equal(STUDY_ROOM_MAX_ROOMS, 5);
  assert.equal(resolveStudyRoomName({}), DEFAULT_STUDY_ROOM_NAME);
  assert.equal(resolveStudyRoomName(TEST_ENV), 'dd-admin-beta-test');
  assert.deepEqual(resolveStudyRoomSlot(TEST_ENV, 1), {
    roomKey: '1', roomName: 'dd-admin-beta-test', label: 'Library', kind: 'library',
    microphoneAllowed: false, adminOnly: false,
  });
  assert.deepEqual(resolveStudyRoomSlot(TEST_ENV, '5'), {
    roomKey: '5', roomName: 'dd-admin-beta-test-5', label: 'Inner Chamber', kind: 'inner-chamber',
    microphoneAllowed: true, adminOnly: true,
  });
  assert.equal(normalizeStudyRoomRoomKey(undefined, { defaultToFirst: true }), '1');
  assert.equal(normalizeStudyRoomRoomKey('', { defaultToFirst: true }), '1');
  for (const unsafe of ['0', '6', '../room', 'dd-admin-beta-test-2', '1?admin=true']) {
    assert.throws(() => resolveStudyRoomSlot(TEST_ENV, unsafe), (error) => (
      error instanceof StudyRoomError && error.code === 'STUDY_ROOM_ROOM_INVALID'
    ));
  }
  assert.throws(() => resolveStudyRoomName({ STUDY_ROOM_NAME: '../room?admin=true' }), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NOT_CONFIGURED'
  ));
  assert.throws(
    () => resolveStudyRoomSlot({ STUDY_ROOM_NAME: `r${'x'.repeat(78)}` }, '2'),
    (error) => error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NOT_CONFIGURED',
  );
});

test('room listing returns five policy-aware slots and ignores every untrusted LiveKit room', async () => {
  const roomService = createRoomServiceDouble([
    activeRoom('1', { numParticipants: 3 }),
    activeRoom('3', { numParticipants: 1, metadata: JSON.stringify({ email: 'private@example.com' }) }),
    { name: 'untrusted-room', maxParticipants: 999, numParticipants: 999 },
  ]);
  const catalog = await listStudyRooms(TEST_ENV, { roomService, isAdministrator: false });
  assert.equal(catalog.maxRooms, 5);
  assert.equal(catalog.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(catalog.recording, false);
  assert.deepEqual(catalog.rooms.map((room) => room.roomKey), ['1', '2', '3', '4', '5']);
  assert.deepEqual(catalog.rooms.map((room) => room.label), [
    'Library', 'Room 1', 'Room 2', 'Room 3', 'Inner Chamber',
  ]);
  assert.deepEqual(catalog.rooms.map((room) => room.active), [true, false, true, false, false]);
  assert.deepEqual(catalog.rooms.map((room) => room.participantCount), [3, 0, 1, 0, 0]);
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
    roomName('1'), roomName('2'), roomName('3'), roomName('4'), roomName('5'),
  ]]);
});

test('room listing fails closed on unsafe capacity or participant counts', async () => {
  await assert.rejects(
    listStudyRooms(TEST_ENV, {
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
      roomService: createRoomServiceDouble([activeRoom('2', {
        numParticipants: STUDY_ROOM_MAX_PARTICIPANTS + 1,
      })]),
    }),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_UNAVAILABLE'
      && error.status === 503,
  );
});

test('administrators can open only five slots with bounded policy metadata and no PII', async () => {
  const roomService = createRoomServiceDouble();
  const created = [];
  for (let index = 0; index < STUDY_ROOM_MAX_ROOMS; index += 1) {
    created.push(await createStudyRoom(TEST_ENV, undefined, {
      ...fixedTimeOptions(roomService), isAdministrator: true,
    }));
  }
  assert.deepEqual(created.map((result) => result.room.roomKey), ['1', '2', '3', '4', '5']);
  assert.equal(created.every((result) => result.created), true);
  assert.equal(roomService.rooms.length, STUDY_ROOM_MAX_ROOMS);

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
  assert.equal(roomService.rooms.length, STUDY_ROOM_MAX_ROOMS);
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

test('Library never grants microphone publication and inactive rooms never auto-create', async () => {
  const roomService = createRoomServiceDouble([activeRoom('1')]);
  const library = await createStudyRoomJoinCredential(
    TEST_ENV, { id: TEST_USER_ID }, '1', 'Dimasalang', fixedTimeOptions(roomService),
  );
  const claims = await new TokenVerifier(
    TEST_ENV.LIVEKIT_API_KEY,
    TEST_ENV.LIVEKIT_API_SECRET,
  ).verify(library.participantToken);
  assert.equal(library.microphoneAllowed, false);
  assert.deepEqual(claims.video.canPublishSources, ['camera', 'screen_share']);

  await assert.rejects(
    createStudyRoomJoinCredential(
      TEST_ENV, { id: TEST_USER_ID }, '2', 'Dimasalang', fixedTimeOptions(roomService),
    ),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ROOM_NOT_OPEN'
      && error.status === 409,
  );
  assert.equal(roomService.calls.some(([operation]) => operation === 'createRoom'), false);
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

  await muteStudyRoomParticipant(TEST_ENV, '2', identity, 'TR_audio123', { roomService });
  assert.deepEqual(roomService.calls.at(-1), [
    'mutePublishedTrack', roomName('2'), identity, 'TR_audio123', true,
  ]);

  const renamed = await renameStudyRoomParticipant(
    TEST_ENV, TEST_USER_ID, '4', identity, 'Dimasalang', { roomService },
  );
  assert.equal(renamed.roomKey, '4');
  assert.deepEqual(roomService.calls.at(-1), [
    'updateParticipant', roomName('4'), identity, { name: 'Dimasalang' },
  ]);

  await removeStudyRoomParticipant(TEST_ENV, '3', identity, { roomService });
  assert.deepEqual(roomService.calls.at(-1), ['removeParticipant', roomName('3'), identity]);

  const otherIdentity = await studyRoomParticipantIdentity(TEST_ENV, SECOND_USER_ID);
  await assert.rejects(
    renameStudyRoomParticipant(
      TEST_ENV, TEST_USER_ID, '1', otherIdentity, 'Dimasalang', { roomService },
    ),
    (error) => error instanceof StudyRoomError && error.code === 'STUDY_ROOM_RENAME_FORBIDDEN',
  );
  await assert.rejects(
    muteStudyRoomParticipant(TEST_ENV, roomName('2'), identity, 'TR_audio123', { roomService }),
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
  assert.match(logText, /join_room_lookup/u);
  assert.match(logText, /502/u);
});

function routeHarness({ role = 'admin', authorized = true, memberAllowed = false, body = {} } = {}) {
  const calls = [];
  const user = { id: TEST_USER_ID };
  const catalog = {
    maxRooms: STUDY_ROOM_MAX_ROOMS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    recording: false,
    rooms: [{ roomKey: '1', label: 'Library', active: false, microphoneAllowed: false }],
  };
  const handlers = createStudyRoomHandlers({
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
      return { allowed: memberAllowed };
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

test('admin, founder_admin, and super_admin can create and enter all five rooms', async () => {
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
        && error.code === 'STUDY_ROOM_SUBSCRIPTION_REQUIRED'
        && error.status === 403,
    );
  }
});

test('paid members can list and join open public rooms but cannot create rooms', async () => {
  const listed = routeHarness({
    role: 'member',
    authorized: false,
    memberAllowed: true,
    body: { operation: 'list' },
  });
  const access = await listed.handlers.access(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(access.body.allowed, true);
  assert.equal(access.body.role, 'member');
  assert.equal(access.body.administrator, false);
  assert.equal(access.body.canCreateRooms, false);

  const rooms = await listed.handlers.rooms(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(rooms.body.role, 'member');
  assert.deepEqual(listed.calls.find(([operation]) => operation === 'listRooms')[2], {
    isAdministrator: false,
  });

  const joined = routeHarness({
    role: 'member',
    authorized: false,
    memberAllowed: true,
    body: { roomKey: '2', nickname: 'Participant 12' },
  });
  const join = await joined.handlers.join(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(join.body.room_key, '2');
  assert.equal(join.body.administrator, false);
  assert.deepEqual(joined.calls.find(([operation]) => operation === 'issueCredential').at(-1), {
    isAdministrator: false,
  });

  const create = routeHarness({
    role: 'member',
    authorized: false,
    memberAllowed: true,
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
  assert.deepEqual(createCall[3], { isAdministrator: true });
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
  assert.deepEqual(credentialCall.slice(2), [
    { id: TEST_USER_ID }, '4', 'Dimasalang', { isAdministrator: true },
  ]);

  const identity = 'sr_abcdefghijklmnopqrstuvwx';
  const rename = routeHarness({
    role: 'admin',
    body: { operation: 'rename', roomKey: '3', participantIdentity: identity, nickname: 'Dimasalang' },
  });
  const renamed = await rename.handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(renamed.status, 200);
  assert.deepEqual(rename.calls.find(([operation]) => operation === 'renameParticipant').slice(2), [
    TEST_USER_ID, '3', identity, 'Dimasalang',
  ]);
});

test('room-wide mute and removal require founder or super-admin while muted=false never unmutes', async () => {
  const identity = 'sr_abcdefghijklmnopqrstuvwx';
  for (const operation of ['mute', 'remove']) {
    const admin = routeHarness({
      role: 'admin',
      body: {
        operation,
        roomKey: '2',
        participantIdentity: identity,
        trackSid: 'TR_audio123',
        muted: false,
      },
    });
    await assert.rejects(
      admin.handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', ''),
      (error) => error instanceof StudyRoomError
        && error.code === 'STUDY_ROOM_MODERATION_FORBIDDEN'
        && error.status === 403,
    );
    assert.equal(admin.calls.some(([name]) => name === 'muteParticipant' || name === 'removeParticipant'), false);
  }

  for (const role of ['founder_admin', 'super_admin']) {
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
    assert.deepEqual(privileged.calls.find(([operation]) => operation === 'muteParticipant').slice(2), [
      '2', identity, 'TR_audio123',
    ]);
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
    rateLimit: async () => {},
    authenticate: async () => ({ id: TEST_USER_ID }),
    authorizeAdmin: async () => ({ authorized: false, role: 'admin' }),
    authorizeMember: async () => ({ allowed: false }),
  });
  await assert.rejects(
    handlers.access(new Request('https://worker.test'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_SUBSCRIPTION_REQUIRED'
      && error.status === 403,
  );
});

test('production Worker route re-verifies Supabase admin authorization and returns no-store five-room access data', async () => {
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
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production Worker falls through an expected admin denial to paid-member Study Room access', async () => {
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
    if (url.pathname === '/rest/v1/rpc/phase4_access_snapshot') {
      return Response.json({
        allowed: true,
        basis: 'founding_beta',
        commercialLaunchEnabled: true,
        termsRequired: false,
        reauthenticationRequired: false,
        paidSubscriptionExpired: false,
        role: 'student',
      });
    }
    throw new Error(`Unexpected upstream call: ${url.pathname}`);
  };

  try {
    const response = await studyRoomWorker.fetch(new Request(
      'https://worker.example/study-room/access',
      {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          Authorization: 'Bearer opaque-member-session',
          'CF-Connecting-IP': '203.0.113.9',
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
    assert.equal(body.role, 'member');
    assert.equal(body.administrator, false);
    assert.equal(body.canCreateRooms, false);
    assert.equal(body.maxRooms, STUDY_ROOM_MAX_ROOMS);
    assert.deepEqual(upstreamCalls, [
      ['/auth/v1/user', 'GET'],
      ['/rest/v1/rpc/admin_authorization_context', 'POST'],
      ['/rest/v1/rpc/phase4_access_snapshot', 'POST'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
