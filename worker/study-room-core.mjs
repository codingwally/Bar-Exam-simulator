import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';

export const DEFAULT_STUDY_ROOM_NAME = 'dd-study-room-v2';
export const STUDY_ROOM_TOKEN_TTL_SECONDS = 600;
export const STUDY_ROOM_MAX_PARTICIPANTS = 12;
export const STUDY_ROOM_MAX_ROOMS = 24;

export const STUDY_ROOM_SLOTS = Object.freeze([
  Object.freeze({ roomKey: '1', label: 'Library', kind: 'library', microphoneAllowed: false, adminOnly: false }),
  Object.freeze({ roomKey: '2', label: 'Room 1', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '3', label: 'Room 2', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '4', label: 'Room 3', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '5', label: 'Inner Chamber', kind: 'inner-chamber', microphoneAllowed: true, adminOnly: true }),
  Object.freeze({ roomKey: '6', label: 'Room 4', kind: 'general', microphoneAllowed: true, adminOnly: false }),
]);

const STUDY_ROOM_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS = 2 * 60;
const STUDY_ROOM_METADATA_SCHEMA = 'duediligence-study-room-slot-v2';
const STUDY_ROOM_METADATA_MAX_BYTES = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROOM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/u;
const ROOM_KEY_PATTERN = /^(?:[1-9]|1[0-9]|2[0-4])$/u;
const PARTICIPANT_ID_PATTERN = /^sr_[A-Za-z0-9_-]{24}$/u;
const TRACK_SID_PATTERN = /^TR_[A-Za-z0-9_-]{4,128}$/u;
const DISALLOWED_NICKNAME_CHARACTERS = /[\p{Cc}\p{Cf}<>]/u;
const DISALLOWED_NICKNAME_FORMATTING = /[\p{Cf}<>]/u;
const RESERVED_NICKNAME_WORDS = /\b(?:admin|administrator|founder|moderator|staff|support)\b|\bdue\s+diligence\b/iu;
const RESERVED_NICKNAMES = new Set([
  'admin',
  'administrator',
  'due diligence',
  'due diligence admin',
  'due diligence moderator',
  'due diligence support',
  'founder',
  'moderator',
  'staff',
  'support',
]);

export class StudyRoomError extends Error {
  constructor(code, message, status = 400, recovery = '') {
    super(message);
    this.name = 'StudyRoomError';
    this.code = code;
    this.status = status;
    this.recovery = recovery;
  }
}

function configurationError() {
  return new StudyRoomError(
    'STUDY_ROOM_NOT_CONFIGURED',
    'The Study Room media service is not configured.',
    503,
    'Contact support and include the time this message appeared.',
  );
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function resolveStudyRoomName(env) {
  const roomName = String(env?.STUDY_ROOM_NAME || DEFAULT_STUDY_ROOM_NAME).trim();
  if (!ROOM_NAME_PATTERN.test(roomName)) throw configurationError();
  return roomName;
}

export function normalizeStudyRoomRoomKey(value, options = {}) {
  const fallback = options.defaultToFirst === true && (value === undefined || value === null || value === '')
    ? '1'
    : '';
  const roomKey = String(fallback || value || '').trim();
  if (!ROOM_KEY_PATTERN.test(roomKey)) {
    throw new StudyRoomError(
      'STUDY_ROOM_ROOM_INVALID',
      'Choose an available Study Room from the current catalog.',
      400,
    );
  }
  return roomKey;
}

function catalogError() {
  return new StudyRoomError('STUDY_ROOM_CATALOG_UNAVAILABLE', 'The Study Room catalog is unavailable. Refresh before joining.', 503);
}

export function normalizeStudyRoomLabel(value) {
  if (typeof value !== 'string' || value.length > 128
    || !/^[A-Za-z0-9 .,\u0027()&_-]*$/u.test(value)) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_INVALID', 'Use a room name with 2 to 64 plain text characters.', 400);
  }
  const label = value.replace(/^ +| +$/gu, '');
  if (label.length < 2 || label.length > 64 || !/^[A-Za-z0-9]/u.test(label)) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_INVALID', 'Use a room name with 2 to 64 plain text characters.', 400);
  }
  return label;
}

export function normalizeStudyRoomCatalog(value) {
  if (value?.schemaVersion !== 1 || value?.maxRooms !== STUDY_ROOM_MAX_ROOMS
    || !Array.isArray(value.rooms) || value.rooms.length < 6 || value.rooms.length > STUDY_ROOM_MAX_ROOMS) throw catalogError();
  const seen = new Set();
  const rooms = value.rooms.map((row) => {
    if (typeof row?.roomKey !== 'string' || !ROOM_KEY_PATTERN.test(row.roomKey)
      || seen.has(row.roomKey) || !['admin', 'paid', 'all', 'approval'].includes(row.audience)
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 2_147_483_646
      || !Number.isSafeInteger(row.accessRevision) || row.accessRevision < 1 || row.accessRevision > row.revision
      || (row.roomKey === '5' && row.audience !== 'admin')) throw catalogError();
    let label;
    try { label = normalizeStudyRoomLabel(row.label); } catch { throw catalogError(); }
    if (label !== row.label) throw catalogError();
    seen.add(row.roomKey);
    return Object.freeze({ roomKey: row.roomKey, label, audience: row.audience,
      revision: row.revision, accessRevision: row.accessRevision });
  });
  if (['1', '2', '3', '4', '5', '6'].some((key) => !seen.has(key))) throw catalogError();
  rooms.sort((a, b) => Number(a.roomKey) - Number(b.roomKey));
  return Object.freeze({ schemaVersion: 1, maxRooms: STUDY_ROOM_MAX_ROOMS, rooms: Object.freeze(rooms) });
}

export function currentPaidStudyRoomMembership(rows, userId, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > 1 || !Number.isFinite(now)) throw catalogError();
  if (!rows.length) return false;
  const row = rows[0];
  if (!UUID_PATTERN.test(String(row?.id || '')) || row.user_id !== userId) throw catalogError();
  return row.status === 'active' && ['manual_payment', 'admin_adjustment', 'migration'].includes(row.source)
    && typeof row.starts_at === 'string' && Number.isFinite(Date.parse(row.starts_at)) && Date.parse(row.starts_at) <= now
    && (row.expires_at === null || (typeof row.expires_at === 'string'
      && Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > now));
}

function configuredStudyRoomSlots(env, catalog) {
  const firstRoomName = resolveStudyRoomName(env);
  const slots = normalizeStudyRoomCatalog(catalog).rooms.map((definition) => {
    const originalName = definition.roomKey === '1' ? firstRoomName : `${firstRoomName}-${definition.roomKey}`;
    const roomName = definition.accessRevision === 1 ? originalName : `${originalName}-a${definition.accessRevision}`;
    if (!ROOM_NAME_PATTERN.test(roomName)) throw configurationError();
    return Object.freeze({
      ...definition,
      kind: definition.roomKey === '1' ? 'library' : definition.roomKey === '5' ? 'inner-chamber' : 'general',
      microphoneAllowed: definition.roomKey !== '1',
      adminOnly: definition.audience === 'admin',
      roomName,
    });
  });
  if (new Set(slots.map((slot) => slot.roomName)).size !== slots.length) {
    throw configurationError();
  }
  return Object.freeze(slots);
}

export function resolveStudyRoomSlot(env, value, options = {}) {
  const roomKey = normalizeStudyRoomRoomKey(value, options);
  const slot = configuredStudyRoomSlots(env, options.catalog).find((candidate) => candidate.roomKey === roomKey);
  if (!slot) throw new StudyRoomError('STUDY_ROOM_ROOM_INVALID', 'That room is not in the current catalog.', 400);
  return slot;
}

function safeLiveKitConfiguration(env) {
  if (String(env?.STUDY_ROOM_ENABLED || '').trim().toLowerCase() !== 'true') {
    throw new StudyRoomError(
      'STUDY_ROOM_DISABLED',
      'The Study Room is temporarily closed.',
      503,
      'Return to Due Diligence and try again after the test room reopens.',
    );
  }
  const apiKey = String(env?.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env?.LIVEKIT_API_SECRET || '').trim();
  const rawUrl = String(env?.LIVEKIT_URL || '').trim();
  if (!apiKey || !apiSecret || !rawUrl) throw configurationError();

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw configurationError();
  }
  if (!['https:', 'wss:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !parsed.hostname
      || (parsed.pathname && parsed.pathname !== '/')) {
    throw configurationError();
  }

  const websocketUrl = new URL(parsed);
  websocketUrl.protocol = 'wss:';
  websocketUrl.pathname = '';
  const serviceUrl = new URL(parsed);
  serviceUrl.protocol = 'https:';
  serviceUrl.pathname = '';
  return {
    apiKey,
    apiSecret,
    roomName: resolveStudyRoomName(env),
    websocketUrl: websocketUrl.toString().replace(/\/$/u, ''),
    serviceUrl: serviceUrl.toString().replace(/\/$/u, ''),
  };
}

export function studyRoomDescriptor(env, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, '1', options);
  return Object.freeze({
    roomKey: '1',
    roomName: configuration.roomName,
    label: slot.label,
    maxRooms: STUDY_ROOM_MAX_ROOMS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    recording: false,
  });
}

export function normalizeStudyRoomNickname(value) {
  const normalizedValue = String(value || '').normalize('NFC');
  if (DISALLOWED_NICKNAME_FORMATTING.test(normalizedValue)) {
    throw new StudyRoomError(
      'STUDY_ROOM_NICKNAME_INVALID',
      'Use a simple nickname without hidden formatting or markup.',
      400,
    );
  }
  const nickname = normalizedValue.replace(/\s+/gu, ' ').trim();
  if (!nickname) {
    throw new StudyRoomError('STUDY_ROOM_NICKNAME_REQUIRED', 'Choose a nickname before entering the Study Room.', 400);
  }
  if (DISALLOWED_NICKNAME_CHARACTERS.test(nickname)) {
    throw new StudyRoomError(
      'STUDY_ROOM_NICKNAME_INVALID',
      'Use a simple nickname without hidden formatting or markup.',
      400,
    );
  }
  const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(nickname)].length
    : [...nickname].length;
  if (graphemes < 2 || graphemes > 32) {
    throw new StudyRoomError('STUDY_ROOM_NICKNAME_INVALID', 'Your nickname must contain 2 to 32 characters.', 400);
  }
  if (RESERVED_NICKNAMES.has(nickname.toLocaleLowerCase('en'))
      || RESERVED_NICKNAME_WORDS.test(nickname)) {
    throw new StudyRoomError(
      'STUDY_ROOM_NICKNAME_RESERVED',
      'That nickname is reserved for official Due Diligence notices.',
      400,
    );
  }
  return nickname;
}

async function participantIdentity(userId, apiSecret) {
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedUserId)) {
    throw new StudyRoomError('STUDY_ROOM_IDENTITY_INVALID', 'Your signed-in account could not be verified.', 401);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`duediligence-study-room-v1\0${normalizedUserId}`),
  );
  return `sr_${base64Url(new Uint8Array(digest)).slice(0, 24)}`;
}

export async function studyRoomParticipantIdentity(env, userId) {
  const { apiSecret } = safeLiveKitConfiguration(env);
  return participantIdentity(userId, apiSecret);
}

export function validateStudyRoomParticipantIdentity(value) {
  const identity = String(value || '').trim();
  if (!PARTICIPANT_ID_PATTERN.test(identity)) {
    throw new StudyRoomError('STUDY_ROOM_PARTICIPANT_INVALID', 'That Study Room participant is not valid.', 400);
  }
  return identity;
}

export function validateStudyRoomTrackSid(value) {
  const sid = String(value || '').trim();
  if (!TRACK_SID_PATTERN.test(sid)) {
    throw new StudyRoomError('STUDY_ROOM_TRACK_INVALID', 'That Study Room audio track is not valid.', 400);
  }
  return sid;
}

function studyRoomService(configuration) {
  return new RoomServiceClient(
    configuration.serviceUrl,
    configuration.apiKey,
    configuration.apiSecret,
  );
}

function safeServiceStatus(error) {
  const value = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : null;
}

async function liveKitCall(operation, callback) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof StudyRoomError) throw error;
    console.error('Study Room media service request failed', {
      operation,
      status: safeServiceStatus(error),
    });
    throw new StudyRoomError(
      'STUDY_ROOM_UNAVAILABLE',
      'The Study Room media service is temporarily unavailable.',
      503,
      'Wait briefly, then try opening the Study Room again.',
    );
  }
}

function resolvedService(configuration, options) {
  return options?.roomService || studyRoomService(configuration);
}

function requireConfiguredRoomCapacity(room) {
  const configuredMaximum = Number(room?.maxParticipants);
  if (!Number.isSafeInteger(configuredMaximum)
      || configuredMaximum !== STUDY_ROOM_MAX_PARTICIPANTS) {
    throw new StudyRoomError(
      'STUDY_ROOM_UNAVAILABLE',
      'The Study Room media service is temporarily unavailable.',
      503,
      'Wait briefly, then try opening the Study Room again.',
    );
  }
  return room;
}

function roomMetadataForSlot(slot, options = {}) {
  const current = typeof options.now === 'function' ? options.now() : new Date();
  const createdAt = current instanceof Date ? current : new Date(current);
  if (!Number.isFinite(createdAt.getTime())) throw configurationError();
  const metadata = JSON.stringify({
    schema: STUDY_ROOM_METADATA_SCHEMA,
    roomKey: slot.roomKey,
    label: slot.label,
    kind: slot.kind,
    microphoneAllowed: slot.microphoneAllowed,
    adminOnly: slot.adminOnly,
    createdAt: createdAt.toISOString(),
  });
  if (new TextEncoder().encode(metadata).byteLength > STUDY_ROOM_METADATA_MAX_BYTES) {
    throw configurationError();
  }
  return metadata;
}

function configuredRoomCreation(slot, options = {}) {
  return {
    name: slot.roomName,
    emptyTimeout: STUDY_ROOM_EMPTY_TIMEOUT_SECONDS,
    departureTimeout: STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    metadata: options.roomMetadata || roomMetadataForSlot(slot, options),
  };
}

function listedRoomForSlot(rooms, slot) {
  return Array.isArray(rooms)
    ? rooms.find((room) => room?.name === slot.roomName) || null
    : null;
}

async function ensureStudyRoom(service, slot, options = {}) {
  return liveKitCall('ensure_room', async () => {
    const existingRooms = await service.listRooms([slot.roomName]);
    if (!Array.isArray(existingRooms)) throw new Error('Unexpected LiveKit room list response');
    const existingRoom = listedRoomForSlot(existingRooms, slot);
    if (existingRoom) {
      return { room: requireConfiguredRoomCapacity(existingRoom), created: false };
    }

    try {
      const createdRoom = await service.createRoom(configuredRoomCreation(slot, options));
      if (createdRoom?.name !== slot.roomName) throw new Error('Unexpected LiveKit room creation response');
      return {
        room: requireConfiguredRoomCapacity(createdRoom),
        created: true,
      };
    } catch (creationError) {
      // A concurrent creator may have occupied this trusted slot after the list call.
      const racedRooms = await service.listRooms([slot.roomName]);
      if (!Array.isArray(racedRooms)) throw new Error('Unexpected LiveKit room list response');
      const racedRoom = listedRoomForSlot(racedRooms, slot);
      if (racedRoom) {
        return { room: requireConfiguredRoomCapacity(racedRoom), created: false };
      }
      throw creationError;
    }
  });
}

function focusStartedAtForRoom(room) {
  const creationSeconds = Number(room?.creationTime);
  const creationMilliseconds = creationSeconds * 1000;
  if (Number.isSafeInteger(creationSeconds)
      && creationSeconds > 0
      && Number.isFinite(creationMilliseconds)) {
    const createdAt = new Date(creationMilliseconds);
    if (Number.isFinite(createdAt.getTime())) return createdAt.toISOString();
  }
  return new Date().toISOString();
}

function participantCountForRoom(room) {
  const count = Number(room?.numParticipants ?? 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > STUDY_ROOM_MAX_PARTICIPANTS) {
    throw new StudyRoomError(
      'STUDY_ROOM_UNAVAILABLE',
      'The Study Room media service is temporarily unavailable.',
      503,
      'Wait briefly, then try opening the Study Room again.',
    );
  }
  return count;
}

function publicRoomDescriptor(slot, room = null, options = {}) {
  const isAdministrator = options.isAdministrator === true;
  const access = Object.freeze({
    kind: slot.kind,
    microphoneAllowed: slot.microphoneAllowed,
    adminOnly: slot.adminOnly,
    audience: slot.audience,
    revision: slot.revision,
    accessRevision: slot.accessRevision,
    alwaysOpen: !slot.adminOnly,
    canCreate: slot.adminOnly && isAdministrator,
    requiresApproval: slot.audience === 'approval' && !isAdministrator,
    canJoin: isAdministrator || ['all', 'approval'].includes(slot.audience) || (slot.audience === 'paid' && options.isPaidMember === true),
  });
  if (!room) {
    return Object.freeze({
      roomKey: slot.roomKey,
      label: slot.label,
      ...access,
      active: false,
      participantCount: 0,
      capacity: STUDY_ROOM_MAX_PARTICIPANTS,
      focusStartedAt: null,
    });
  }
  requireConfiguredRoomCapacity(room);
  return Object.freeze({
    roomKey: slot.roomKey,
    label: slot.label,
    ...access,
    active: true,
    participantCount: participantCountForRoom(room),
    capacity: STUDY_ROOM_MAX_PARTICIPANTS,
    focusStartedAt: focusStartedAtForRoom(room),
  });
}

async function listedConfiguredRooms(configuration, service) {
  return liveKitCall('list_rooms', async () => {
    const names = configuration.roomSlots.map((slot) => slot.roomName);
    const rooms = await service.listRooms(names);
    if (!Array.isArray(rooms)) throw new Error('Unexpected LiveKit room list response');
    return configuration.roomSlots.map((slot) => ({
      slot,
      room: listedRoomForSlot(rooms, slot),
    }));
  });
}

export async function listStudyRooms(env, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  configuration.roomSlots = configuredStudyRoomSlots(env, options.catalog);
  const service = resolvedService(configuration, options);
  const listed = await listedConfiguredRooms(configuration, service);
  return Object.freeze({
    maxRooms: STUDY_ROOM_MAX_ROOMS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    recording: false,
    rooms: Object.freeze(listed.map(({ slot, room }) => publicRoomDescriptor(slot, room, options))),
  });
}

export async function createStudyRoom(env, requestedRoomKey, options = {}) {
  if (options.isAdministrator !== true) {
    throw new StudyRoomError(
      'STUDY_ROOM_CREATE_FORBIDDEN',
      'Only a Due Diligence administrator can open a Study Room.',
      403,
      'Join a room after an administrator opens it.',
    );
  }
  const configuration = safeLiveKitConfiguration(env);
  configuration.roomSlots = configuredStudyRoomSlots(env, options.catalog);
  const service = resolvedService(configuration, options);
  let slot;
  if (requestedRoomKey === undefined || requestedRoomKey === null || requestedRoomKey === '') {
    const listed = await listedConfiguredRooms(configuration, service);
    slot = listed.find(({ room }) => !room)?.slot || null;
    if (!slot) {
      throw new StudyRoomError(
        'STUDY_ROOM_ROOM_LIMIT_REACHED',
        'All configured Study Rooms are already open.',
        409,
        'Join an open room or wait until one closes.',
      );
    }
  } else {
    slot = resolveStudyRoomSlot(env, requestedRoomKey, options);
  }
  const ensured = await ensureStudyRoom(service, slot, options);
  return Object.freeze({
    created: ensured.created,
    room: publicRoomDescriptor(slot, ensured.room, options),
  });
}

export async function configureStudyRoom(env, user, body, options = {}) {
  if (options.isAdministrator !== true) {
    throw new StudyRoomError('STUDY_ROOM_ADMIN_REQUIRED', 'Only an administrator can configure rooms.', 403);
  }
  const operation = body?.operation;
  const roomKey = normalizeStudyRoomRoomKey(body?.roomKey);
  const label = normalizeStudyRoomLabel(body?.label);
  const audience = body?.audience;
  const expectedRevision = body?.expectedRevision;
  if (!['add', 'update'].includes(operation) || !['admin', 'paid', 'all', 'approval'].includes(audience)
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2_147_483_646
    || (roomKey === '5' && audience !== 'admin') || (operation === 'add' && Number(roomKey) < 7)) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_INVALID', 'Refresh the room configuration and check its name and access choice.', 400);
  }
  const catalog = normalizeStudyRoomCatalog(options.catalog);
  const current = catalog.rooms.find((room) => room.roomKey === roomKey);
  if ((operation === 'add' && (current || expectedRevision !== 0))
    || (operation === 'update' && (!current || current.revision !== expectedRevision))) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_CONFLICT', 'This room changed. Reload the catalog before saving.', 409);
  }
  const changed = !current || current.label !== label || current.audience !== audience;
  if (changed && current?.revision >= 2_147_483_646) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_CONFLICT', 'This room cannot accept another revision. Contact support.', 409);
  }
  const expectedRoom = { roomKey, label, audience,
    revision: current ? current.revision + Number(changed) : 1,
    accessRevision: current ? current.accessRevision + Number(current.audience !== audience) : 1 };
  // Refuse a configuration that the current trusted base name cannot address.
  // This is checked before persistence, not after leaving an unusable catalog.
  configuredStudyRoomSlots(env, { ...catalog, rooms: [
    ...catalog.rooms.filter((room) => room.roomKey !== roomKey), expectedRoom,
  ] });
  if (current && current.audience !== audience) {
    const configuration = safeLiveKitConfiguration(env);
    const slot = resolveStudyRoomSlot(env, roomKey, { catalog });
    const rooms = await liveKitCall('configure_room_lookup', () => resolvedService(configuration, options).listRooms([slot.roomName]));
    if (!Array.isArray(rooms) || rooms.some((room) => room?.name !== slot.roomName) || rooms.length > 1) throw catalogError();
    if (rooms.length && participantCountForRoom(requireConfiguredRoomCapacity(rooms[0])) !== 0) {
      throw new StudyRoomError('STUDY_ROOM_ROOM_NOT_EMPTY', 'Everyone must leave the current room before its access can change.', 409);
    }
  }
  if (typeof options.configureCatalog !== 'function') throw catalogError();
  const result = await options.configureCatalog({ p_actor_user_id: user.id, p_operation: operation,
    p_room_key: roomKey, p_label: label, p_audience: audience, p_expected_revision: expectedRevision });
  const room = result?.room;
  if (result?.ok !== true || room?.roomKey !== roomKey || room.label !== label || room.audience !== audience
    || room.revision !== expectedRoom.revision || room.accessRevision !== expectedRoom.accessRevision) throw catalogError();
  return Object.freeze({ ok: true, room: Object.freeze({ roomKey, label, audience,
    revision: room.revision, accessRevision: room.accessRevision }) });
}

export async function createStudyRoomJoinCredential(env, user, roomKey, nickname, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const normalizedNickname = normalizeStudyRoomNickname(nickname);
  const identity = await participantIdentity(user?.id, configuration.apiSecret);
  const service = resolvedService(configuration, options);
  const isAdministrator = options.isAdministrator === true;
  if (slot.adminOnly && !isAdministrator) {
    throw new StudyRoomError(
      'STUDY_ROOM_ADMIN_ROOM_REQUIRED',
      'This room is available only to Due Diligence administrators.',
      403,
      'Choose an available room from the current catalog.',
    );
  }
  if (slot.audience === 'paid' && !isAdministrator && options.isPaidMember !== true) {
    throw new StudyRoomError('STUDY_ROOM_PAID_ROOM_REQUIRED', 'This room requires a current paid membership.', 403);
  }
  if (slot.audience === 'approval') requireStudyRoomTokenRevocation(env);
  let admission = null;
  if (typeof options.authorizeAdmission === 'function') {
    admission = await options.authorizeAdmission(slot, normalizedNickname);
    if (!Number.isSafeInteger(admission?.version) || admission.version < 1
      || !Number.isFinite(Date.parse(admission?.expiresAt)) || Date.parse(admission.expiresAt) <= Date.now()) {
      throw new StudyRoomError('STUDY_ROOM_ADMISSION_UNAVAILABLE', 'Room admission could not be confirmed.', 503);
    }
  } else if (slot.audience === 'approval') {
    throw new StudyRoomError('STUDY_ROOM_ADMISSION_UNAVAILABLE', 'Room admission is temporarily unavailable.', 503);
  }
  let room;
  if (slot.adminOnly) {
    const activeRooms = await liveKitCall('join_room_lookup', () => service.listRooms([slot.roomName]));
    room = listedRoomForSlot(activeRooms, slot);
    if (!room) {
      throw new StudyRoomError(
        'STUDY_ROOM_ROOM_NOT_OPEN',
        `${slot.label} is not open yet.`,
        409,
        `Create ${slot.label}, then join it.`,
      );
    }
  } else {
    // Public slots are always available. Only a real join creates the transient
    // media room; concurrent first joiners converge on the same trusted name.
    ({ room } = await ensureStudyRoom(service, slot, options));
  }
  requireConfiguredRoomCapacity(room);

  const token = new AccessToken(configuration.apiKey, configuration.apiSecret, {
    identity,
    name: normalizedNickname,
    ttl: admission ? Math.max(1, Math.min(STUDY_ROOM_TOKEN_TTL_SECONDS,
      Math.floor((Date.parse(admission.expiresAt) - Date.now()) / 1000))) : STUDY_ROOM_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    room: slot.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    canPublishSources: slot.microphoneAllowed
      ? [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ]
      : [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
  });
  const participantToken = await token.toJwt();
  if (admission) await options.authorizeAdmission(slot, normalizedNickname, admission.version);
  if (slot.audience === 'paid' && !isAdministrator
    && (typeof options.verifyPaidMembership !== 'function' || await options.verifyPaidMembership() !== true)) {
    throw new StudyRoomError('STUDY_ROOM_PAID_ROOM_REQUIRED', 'This room requires a current paid membership.', 403);
  }
  // Check after asynchronous media lookup and signing. Audience changes move to
  // a new physical generation: old issued tokens are not represented as revoked.
  if (typeof options.getCatalog !== 'function') throw catalogError();
  const latest = resolveStudyRoomSlot(env, roomKey, { catalog: await options.getCatalog() });
  if (latest.revision !== slot.revision || latest.accessRevision !== slot.accessRevision
    || latest.audience !== slot.audience || latest.label !== slot.label) {
    throw new StudyRoomError('STUDY_ROOM_CONFIG_CONFLICT', 'This room changed. Refresh the catalog before joining.', 409);
  }
  return {
    participantToken,
    participantIdentity: identity,
    participantName: normalizedNickname,
    roomKey: slot.roomKey,
    roomLabel: slot.label,
    roomName: slot.roomName,
    roomKind: slot.kind,
    revision: slot.revision,
    accessRevision: slot.accessRevision,
    audience: slot.audience,
    microphoneAllowed: slot.microphoneAllowed,
    administrator: isAdministrator,
    serverUrl: configuration.websocketUrl,
    focusStartedAt: focusStartedAtForRoom(room),
    expiresInSeconds: STUDY_ROOM_TOKEN_TTL_SECONDS,
  };
}

export function requireStudyRoomTokenRevocation(env) {
  const configuration = safeLiveKitConfiguration(env);
  if (!new URL(configuration.websocketUrl).hostname.endsWith('.livekit.cloud')) {
    throw new StudyRoomError('STUDY_ROOM_REVOCATION_UNAVAILABLE', 'Approval rooms require verified token revocation support.', 503);
  }
}

export async function requireStudyRoomAdministratorPresence(env, userId, roomKey, options = {}) {
  if (options.isAdministrator !== true) throw new StudyRoomError('STUDY_ROOM_ADMIN_REQUIRED', 'Only an administrator can manage admission.', 403);
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const identity = await participantIdentity(userId, configuration.apiSecret);
  let participant;
  try { participant = await resolvedService(configuration, options).getParticipant(slot.roomName, identity); }
  catch { throw new StudyRoomError('STUDY_ROOM_ADMIN_NOT_PRESENT', 'Enter this room before managing its waiting list.', 403); }
  // LiveKit ACTIVE is enum 2. A joining/disconnected participant is not inside.
  if (participant?.identity !== identity || ![2, 'ACTIVE'].includes(participant?.state)) {
    throw new StudyRoomError('STUDY_ROOM_ADMIN_NOT_PRESENT', 'Enter this room before managing its waiting list.', 403);
  }
  return { identity, roomName: slot.roomName };
}

export async function revokeStudyRoomParticipantToken(env, roomKey, identity, options = {}) {
  requireStudyRoomTokenRevocation(env);
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  // Explicit cutoff also revokes an identity that already left. LiveKit Cloud
  // applies the documented one-minute buffer; never mint around that cutoff.
  const cutoff = options.revokedAt == null ? Date.now() : Date.parse(options.revokedAt);
  if (!Number.isFinite(cutoff) || cutoff > Date.now() + 2000) {
    throw new StudyRoomError('STUDY_ROOM_ADMISSION_INVALID', 'The room revocation could not be confirmed.', 503);
  }
  await liveKitCall('revoke_admission', () => resolvedService(configuration, options)
    .removeParticipant(slot.roomName, targetIdentity, { revokeTokenTs: BigInt(Math.floor(cutoff / 1000)) }));
}

export async function muteStudyRoomParticipant(env, roomKey, identity, trackSid, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  const targetTrackSid = validateStudyRoomTrackSid(trackSid);
  await liveKitCall('mute_participant', () => resolvedService(configuration, options)
    .mutePublishedTrack(slot.roomName, targetIdentity, targetTrackSid, true));
  return {
    action: 'muted',
    roomKey: slot.roomKey,
    participantIdentity: targetIdentity,
    trackSid: targetTrackSid,
  };
}

export async function renameStudyRoomParticipant(env, userId, roomKey, identity, nickname, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  const ownIdentity = await participantIdentity(userId, configuration.apiSecret);
  if (targetIdentity !== ownIdentity) {
    throw new StudyRoomError('STUDY_ROOM_RENAME_FORBIDDEN', 'You can change only your own Study Room nickname.', 403);
  }
  const participantName = normalizeStudyRoomNickname(nickname);
  await liveKitCall('rename_participant', () => resolvedService(configuration, options)
    .updateParticipant(slot.roomName, targetIdentity, { name: participantName }));
  return {
    action: 'renamed',
    roomKey: slot.roomKey,
    participantIdentity: targetIdentity,
    participantName,
  };
}

export async function removeStudyRoomParticipant(env, roomKey, identity, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey, options);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  await liveKitCall('remove_participant', () => resolvedService(configuration, options)
    // On LiveKit Cloud, omitting revokeTokenTs applies the server's current
    // time with its documented one-minute buffer, including same-second tokens.
    .removeParticipant(slot.roomName, targetIdentity));
  return { action: 'removed', roomKey: slot.roomKey, participantIdentity: targetIdentity };
}
