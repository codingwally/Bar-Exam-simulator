import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import studyRoomWorker from './index.mjs';
import {
  DEFAULT_STUDY_ROOM_NAME,
  STUDY_ROOM_MAX_PARTICIPANTS,
  STUDY_ROOM_TOKEN_TTL_SECONDS,
  StudyRoomError,
  createStudyRoomJoinCredential,
  muteStudyRoomParticipant,
  normalizeStudyRoomNickname,
  removeStudyRoomParticipant,
  resolveStudyRoomName,
  studyRoomParticipantIdentity,
} from './study-room-core.mjs';
import { createStudyRoomHandlers } from './study-room-routes.mjs';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ENV = Object.freeze({
  STUDY_ROOM_ENABLED: 'true',
  STUDY_ROOM_NAME: 'dd-admin-beta-test',
  LIVEKIT_URL: 'wss://duediligence-test.livekit.cloud',
  LIVEKIT_API_KEY: 'test_livekit_key',
  LIVEKIT_API_SECRET: 'test_livekit_secret_with_sufficient_entropy',
});

function createRoomServiceDouble(initialRooms = []) {
  const calls = [];
  const rooms = [...initialRooms];
  return {
    calls,
    async listRooms(names) {
      calls.push(['listRooms', names]);
      return rooms.filter((room) => names.includes(room.name));
    },
    async createRoom(options) {
      calls.push(['createRoom', options]);
      const room = { ...options, creationTime: 1_788_000_000n };
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

test('room name is fixed by trusted environment configuration and rejects unsafe values', () => {
  assert.equal(resolveStudyRoomName({}), DEFAULT_STUDY_ROOM_NAME);
  assert.equal(resolveStudyRoomName(TEST_ENV), 'dd-admin-beta-test');
  assert.throws(() => resolveStudyRoomName({ STUDY_ROOM_NAME: '../room?admin=true' }), (error) => (
    error instanceof StudyRoomError && error.code === 'STUDY_ROOM_NOT_CONFIGURED'
  ));
});

test('join credential is opaque, short-lived, non-admin, data-disabled, and camera/microphone only', async () => {
  const roomService = createRoomServiceDouble();
  const credential = await createStudyRoomJoinCredential(
    TEST_ENV,
    { id: TEST_USER_ID, email: 'private@example.com' },
    '  Dimasalang  ',
    { roomService },
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
  assert.equal(claims.video.room, TEST_ENV.STUDY_ROOM_NAME);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, false);
  assert.deepEqual(claims.video.canPublishSources, ['camera', 'microphone']);
  assert.notEqual(claims.video.roomAdmin, true);
  assert.equal(claims.metadata, undefined);
  assert.equal(claims.attributes, undefined);
  assert.equal(claims.roomConfig.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(claims.roomConfig.name, TEST_ENV.STUDY_ROOM_NAME);
  assert.ok(Number(claims.exp) - Number(claims.nbf) <= STUDY_ROOM_TOKEN_TTL_SECONDS + 1);
  assert.ok(Number(claims.exp) - Number(claims.nbf) >= STUDY_ROOM_TOKEN_TTL_SECONDS - 1);
  assert.equal(credential.serverUrl, TEST_ENV.LIVEKIT_URL);
  assert.equal(credential.roomName, TEST_ENV.STUDY_ROOM_NAME);
  assert.equal(credential.focusStartedAt, '2026-08-29T10:40:00.000Z');
  assert.equal(credential.expiresInSeconds, STUDY_ROOM_TOKEN_TTL_SECONDS);

  const createCall = roomService.calls.find(([operation]) => operation === 'createRoom');
  assert.deepEqual(createCall, ['createRoom', {
    name: TEST_ENV.STUDY_ROOM_NAME,
    emptyTimeout: 600,
    departureTimeout: 120,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
  }]);
});

test('fixed room setup is idempotent for repeated joins and enforces the 12-person cap', async () => {
  const roomService = createRoomServiceDouble();
  await createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, 'Dimasalang', { roomService });
  await createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, 'Dimasalang', { roomService });
  assert.equal(roomService.calls.filter(([operation]) => operation === 'createRoom').length, 1);

  const wrongCapacity = createRoomServiceDouble([{
    name: TEST_ENV.STUDY_ROOM_NAME,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS + 1,
  }]);
  await assert.rejects(
    createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, 'Dimasalang', {
      roomService: wrongCapacity,
    }),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_UNAVAILABLE'
      && error.status === 503,
  );
});

test('concurrent first-room creation race is recovered only after the capped room exists', async () => {
  const calls = [];
  let listCount = 0;
  const roomService = {
    async listRooms() {
      listCount += 1;
      calls.push('listRooms');
      return listCount === 1 ? [] : [{
        name: TEST_ENV.STUDY_ROOM_NAME,
        maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
      }];
    },
    async createRoom() {
      calls.push('createRoom');
      throw new Error('already exists');
    },
  };
  const result = await createStudyRoomJoinCredential(
    TEST_ENV,
    { id: TEST_USER_ID },
    'Dimasalang',
    { roomService },
  );
  assert.equal(result.roomName, TEST_ENV.STUDY_ROOM_NAME);
  assert.deepEqual(calls, ['listRooms', 'createRoom', 'listRooms']);
});

test('server moderation can only mute, never remotely unmute, and removal revokes the issued token', async () => {
  const roomService = createRoomServiceDouble();
  const identity = await studyRoomParticipantIdentity(TEST_ENV, TEST_USER_ID);

  await muteStudyRoomParticipant(TEST_ENV, identity, 'TR_audio123', { roomService });
  assert.deepEqual(roomService.calls.at(-1), [
    'mutePublishedTrack',
    TEST_ENV.STUDY_ROOM_NAME,
    identity,
    'TR_audio123',
    true,
  ]);

  await removeStudyRoomParticipant(TEST_ENV, identity, { roomService });
  assert.deepEqual(roomService.calls.at(-1), [
    'removeParticipant',
    TEST_ENV.STUDY_ROOM_NAME,
    identity,
  ]);
});

test('upstream LiveKit failures expose only a stable safe error', async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await assert.rejects(
      createStudyRoomJoinCredential(TEST_ENV, { id: TEST_USER_ID }, 'Dimasalang', {
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

function routeHarness({ role = 'admin', authorized = true, body = {} } = {}) {
  const calls = [];
  const user = { id: TEST_USER_ID };
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
    parseJson: async (_request, maximumBytes) => {
      calls.push(['parseJson', maximumBytes]);
      return body;
    },
    describeRoom: () => ({
      roomName: TEST_ENV.STUDY_ROOM_NAME,
      maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    }),
    issueCredential: async () => ({
      serverUrl: TEST_ENV.LIVEKIT_URL,
      participantToken: 'opaque-token',
      roomName: TEST_ENV.STUDY_ROOM_NAME,
      participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
      participantName: 'Dimasalang',
      focusStartedAt: '2026-08-29T10:40:00.000Z',
      expiresInSeconds: STUDY_ROOM_TOKEN_TTL_SECONDS,
    }),
    muteParticipant: async (...args) => {
      calls.push(['muteParticipant', ...args]);
      return { action: 'muted' };
    },
    removeParticipant: async (...args) => {
      calls.push(['removeParticipant', ...args]);
      return { action: 'removed' };
    },
    renameParticipant: async (...args) => {
      calls.push(['renameParticipant', ...args]);
      return { action: 'renamed' };
    },
    respond: (responseBody, status) => ({ body: responseBody, status }),
  });
  return { calls, handlers };
}

test('only explicit admin, founder_admin, and super_admin roles pass every route authorization gate', async () => {
  for (const role of ['admin', 'founder_admin', 'super_admin']) {
    const { handlers } = routeHarness({ role });
    const response = await handlers.access(new Request('https://worker.test'), TEST_ENV, '', '');
    assert.equal(response.status, 200);
    assert.equal(response.body.role, role);
  }

  for (const role of ['', 'member', 'moderator', 'support', 'founder-admin', 'Founder Admin']) {
    const { handlers } = routeHarness({ role });
    await assert.rejects(
      handlers.access(new Request('https://worker.test'), TEST_ENV, '', ''),
      (error) => error instanceof StudyRoomError
        && error.code === 'STUDY_ROOM_ADMIN_REQUIRED'
        && error.status === 403,
    );
  }
});

test('moderation request is bounded and a client muted=false field cannot cause remote unmute', async () => {
  const body = {
    operation: 'mute',
    participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
    trackSid: 'TR_audio123',
    muted: false,
  };
  const { calls, handlers } = routeHarness({ body });
  const response = await handlers.moderate(new Request('https://worker.test'), TEST_ENV, '', '');
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(([operation]) => operation === 'parseJson'), ['parseJson', 6_144]);
  assert.deepEqual(calls.find(([operation]) => operation === 'muteParticipant'), [
    'muteParticipant',
    TEST_ENV,
    body.participantIdentity,
    body.trackSid,
  ]);
});

test('access, join, and moderation each rate-limit and re-authorize before handling payloads', async () => {
  const cases = [
    ['access', {}, 'access'],
    ['join', { nickname: 'Dimasalang' }, 'join'],
    ['moderate', {
      operation: 'remove',
      participantIdentity: 'sr_abcdefghijklmnopqrstuvwx',
    }, 'moderate'],
  ];
  for (const [handlerName, body, expectedScope] of cases) {
    const { calls, handlers } = routeHarness({ body });
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
  });
  await assert.rejects(
    handlers.access(new Request('https://worker.test'), TEST_ENV, '', ''),
    (error) => error instanceof StudyRoomError
      && error.code === 'STUDY_ROOM_ADMIN_REQUIRED'
      && error.status === 403,
  );
});

test('production Worker route re-verifies Supabase admin authorization and returns no-store access data', async () => {
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
    assert.equal(body.roomName, TEST_ENV.STUDY_ROOM_NAME);
    assert.deepEqual(upstreamCalls, [
      ['/auth/v1/user', 'GET'],
      ['/rest/v1/rpc/admin_authorization_context', 'POST'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
