import {
  AccessToken,
  RoomConfiguration,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';

export const DEFAULT_STUDY_ROOM_NAME = 'dd-study-room-admin-beta-v1';
export const STUDY_ROOM_TOKEN_TTL_SECONDS = 600;
export const STUDY_ROOM_MAX_PARTICIPANTS = 12;

const STUDY_ROOM_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS = 2 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROOM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/u;
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

function safeLiveKitConfiguration(env) {
  if (String(env?.STUDY_ROOM_ENABLED || '').trim().toLowerCase() !== 'true') {
    throw new StudyRoomError(
      'STUDY_ROOM_DISABLED',
      'The Study Room admin beta is temporarily closed.',
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

export function studyRoomDescriptor(env) {
  const configuration = safeLiveKitConfiguration(env);
  return Object.freeze({
    roomName: configuration.roomName,
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

async function ensureStudyRoom(service, roomName) {
  return liveKitCall('ensure_room', async () => {
    const existingRooms = await service.listRooms([roomName]);
    const existingRoom = Array.isArray(existingRooms)
      ? existingRooms.find((room) => room?.name === roomName)
      : null;
    if (existingRoom) return requireConfiguredRoomCapacity(existingRoom);

    try {
      return requireConfiguredRoomCapacity(await service.createRoom({
        name: roomName,
        emptyTimeout: STUDY_ROOM_EMPTY_TIMEOUT_SECONDS,
        departureTimeout: STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS,
        maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
      }));
    } catch (creationError) {
      // A concurrent first join may have created the fixed room after the list call.
      const racedRooms = await service.listRooms([roomName]);
      const racedRoom = Array.isArray(racedRooms)
        ? racedRooms.find((room) => room?.name === roomName)
        : null;
      if (racedRoom) return requireConfiguredRoomCapacity(racedRoom);
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

export async function createStudyRoomJoinCredential(env, user, nickname, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const normalizedNickname = normalizeStudyRoomNickname(nickname);
  const identity = await participantIdentity(user?.id, configuration.apiSecret);
  const service = resolvedService(configuration, options);

  const room = await ensureStudyRoom(service, configuration.roomName);

  const token = new AccessToken(configuration.apiKey, configuration.apiSecret, {
    identity,
    name: normalizedNickname,
    ttl: STUDY_ROOM_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    room: configuration.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
  });
  // If the explicitly-created room expires before this short-lived token is
  // used, LiveKit applies the same cap while automatically recreating it.
  token.roomConfig = new RoomConfiguration({
    name: configuration.roomName,
    emptyTimeout: STUDY_ROOM_EMPTY_TIMEOUT_SECONDS,
    departureTimeout: STUDY_ROOM_DEPARTURE_TIMEOUT_SECONDS,
    maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
  });
  return {
    participantToken: await token.toJwt(),
    participantIdentity: identity,
    participantName: normalizedNickname,
    roomName: configuration.roomName,
    serverUrl: configuration.websocketUrl,
    focusStartedAt: focusStartedAtForRoom(room),
    expiresInSeconds: STUDY_ROOM_TOKEN_TTL_SECONDS,
  };
}

export async function muteStudyRoomParticipant(env, identity, trackSid, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  const targetTrackSid = validateStudyRoomTrackSid(trackSid);
  await liveKitCall('mute_participant', () => resolvedService(configuration, options)
    .mutePublishedTrack(configuration.roomName, targetIdentity, targetTrackSid, true));
  return { action: 'muted', participantIdentity: targetIdentity, trackSid: targetTrackSid };
}

export async function renameStudyRoomParticipant(env, userId, identity, nickname, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  const ownIdentity = await participantIdentity(userId, configuration.apiSecret);
  if (targetIdentity !== ownIdentity) {
    throw new StudyRoomError('STUDY_ROOM_RENAME_FORBIDDEN', 'You can change only your own Study Room nickname.', 403);
  }
  const participantName = normalizeStudyRoomNickname(nickname);
  await liveKitCall('rename_participant', () => resolvedService(configuration, options)
    .updateParticipant(configuration.roomName, targetIdentity, { name: participantName }));
  return { action: 'renamed', participantIdentity: targetIdentity, participantName };
}

export async function removeStudyRoomParticipant(env, identity, options = {}) {
  const configuration = safeLiveKitConfiguration(env);
  const targetIdentity = validateStudyRoomParticipantIdentity(identity);
  await liveKitCall('remove_participant', () => resolvedService(configuration, options)
    // On LiveKit Cloud, omitting revokeTokenTs applies the server's current
    // time with its documented one-minute buffer, including same-second tokens.
    .removeParticipant(configuration.roomName, targetIdentity));
  return { action: 'removed', participantIdentity: targetIdentity };
}
