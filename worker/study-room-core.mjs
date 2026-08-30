import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';

export const DEFAULT_STUDY_ROOM_NAME = 'dd-study-room-v2';
export const STUDY_ROOM_TOKEN_TTL_SECONDS = 600;
export const STUDY_ROOM_MAX_PARTICIPANTS = 12;
export const STUDY_ROOM_MAX_ROOMS = 5;

export const STUDY_ROOM_SLOTS = Object.freeze([
  Object.freeze({ roomKey: '1', label: 'Library', kind: 'library', microphoneAllowed: false, adminOnly: false }),
  Object.freeze({ roomKey: '2', label: 'Room 1', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '3', label: 'Room 2', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '4', label: 'Room 3', kind: 'general', microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: '5', label: 'Inner Chamber', kind: 'inner-chamber', microphoneAllowed: true, adminOnly: true }),
]);

const STUDY_ROOM_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS = 2 * 60;
const STUDY_ROOM_METADATA_SCHEMA = 'duediligence-study-room-slot-v2';
const STUDY_ROOM_METADATA_MAX_BYTES = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROOM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/u;
const ROOM_KEY_PATTERN = /^[1-5]$/u;
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
      'Choose one of the five available Study Rooms.',
      400,
    );
  }
  return roomKey;
}

function configuredStudyRoomSlots(env) {
  const firstRoomName = resolveStudyRoomName(env);
  const slots = STUDY_ROOM_SLOTS.map((definition, index) => {
    const roomName = index === 0 ? firstRoomName : `${firstRoomName}-${definition.roomKey}`;
    if (!ROOM_NAME_PATTERN.test(roomName)) throw configurationError();
    return Object.freeze({
      ...definition,
      roomName,
    });
  });
  if (new Set(slots.map((slot) => slot.roomName)).size !== STUDY_ROOM_MAX_ROOMS) {
    throw configurationError();
  }
  return Object.freeze(slots);
}

export function resolveStudyRoomSlot(env, value, options = {}) {
  const roomKey = normalizeStudyRoomRoomKey(value, options);
  const slot = configuredStudyRoomSlots(env).find((candidate) => candidate.roomKey === roomKey);
  if (!slot) throw configurationError();
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
    roomSlots: configuredStudyRoomSlots(env),
    websocketUrl: websocketUrl.toString().replace(/\/$/u, ''),
    serviceUrl: serviceUrl.toString().replace(/\/$/u, ''),
  };
}

export function studyRoomDescriptor(env) {
  const configuration = safeLiveKitConfiguration(env);
  return Object.freeze({
    roomKey: '1',
    roomName: configuration.roomName,
    label: STUDY_ROOM_SLOTS[0].label,
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
    const existingRoom = listedRoomForSlot(existingRooms, slot);
    if (existingRoom) {
      return { room: requireConfiguredRoomCapacity(existingRoom), created: false };
    }

    try {
      return {
        room: requireConfiguredRoomCapacity(await service.createRoom(configuredRoomCreation(slot, options))),
        created: true,
      };
    } catch (creationError) {
      // A concurrent creator may have occupied this trusted slot after the list call.
      const racedRooms = await service.listRooms([slot.roomName]);
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
    canCreate: isAdministrator,
    canJoin: !slot.adminOnly || isAdministrator,
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
  const service = resolvedService(configuration, options);
  let slot;
  if (requestedRoomKey === undefined || requestedRoomKey === null || requestedRoomKey === '') {
    const listed = await listedConfiguredRooms(configuration, service);
    slot = listed.find(({ room }) => !room)?.slot || null;
    if (!slot) {
      throw new StudyRoomError(
        'STUDY_ROOM_ROOM_LIMIT_REACHED',
        'All five Study Rooms are already open.',
        409,
        'Join an open room or wait until one closes.',
      );
    }
  } else {
    slot = resolveStudyRoomSlot(env, requestedRoomKey);
  }
  const ensured = await ensureStudyRoom(service, slot, options);
  return Object.freeze({
    created: ensured.created,
    room: publicRoomDescriptor(slot, ensured.room, options),
  });
}

export async function createStudyRoomJoinCredential(env, user, roomKey, nickname, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey);
  const normalizedNickname = normalizeStudyRoomNickname(nickname);
  const identity = await participantIdentity(user?.id, configuration.apiSecret);
  const service = resolvedService(configuration, options);
  const isAdministrator = options.isAdministrator === true;
  if (slot.adminOnly && !isAdministrator) {
    throw new StudyRoomError(
      'STUDY_ROOM_ADMIN_ROOM_REQUIRED',
      'The Inner Chamber is available only to Due Diligence administrators.',
      403,
      'Choose Library, Room 1, Room 2, or Room 3.',
    );
  }
  const activeRooms = await liveKitCall('join_room_lookup', () => service.listRooms([slot.roomName]));
  const room = listedRoomForSlot(activeRooms, slot);
  if (!room) {
    throw new StudyRoomError(
      'STUDY_ROOM_ROOM_NOT_OPEN',
      `${slot.label} is not open yet.`,
      409,
      isAdministrator
        ? `Create ${slot.label}, then join it.`
        : 'Wait for an administrator to open the room, then refresh the lobby.',
    );
  }
  requireConfiguredRoomCapacity(room);

  const token = new AccessToken(configuration.apiKey, configuration.apiSecret, {
    identity,
    name: normalizedNickname,
    ttl: STUDY_ROOM_TOKEN_TTL_SECONDS,
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
  return {
    participantToken: await token.toJwt(),
    participantIdentity: identity,
    participantName: normalizedNickname,
    roomKey: slot.roomKey,
    roomLabel: slot.label,
    roomName: slot.roomName,
    roomKind: slot.kind,
    microphoneAllowed: slot.microphoneAllowed,
    administrator: isAdministrator,
    serverUrl: configuration.websocketUrl,
    focusStartedAt: focusStartedAtForRoom(room),
    expiresInSeconds: STUDY_ROOM_TOKEN_TTL_SECONDS,
  };
}

export async function muteStudyRoomParticipant(env, roomKey, identity, trackSid, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const slot = resolveStudyRoomSlot(env, roomKey);
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
  const slot = resolveStudyRoomSlot(env, roomKey);
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
  const slot = resolveStudyRoomSlot(env, roomKey);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  await liveKitCall('remove_participant', () => resolvedService(configuration, options)
    // On LiveKit Cloud, omitting revokeTokenTs applies the server's current
    // time with its documented one-minute buffer, including same-second tokens.
    .removeParticipant(slot.roomName, targetIdentity));
  return { action: 'removed', roomKey: slot.roomKey, participantIdentity: targetIdentity };
}
