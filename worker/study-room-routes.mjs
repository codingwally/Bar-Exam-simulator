import {
  StudyRoomError,
  createStudyRoom,
  createStudyRoomJoinCredential,
  listStudyRooms,
  muteStudyRoomParticipant,
  removeStudyRoomParticipant,
  renameStudyRoomParticipant,
  studyRoomDescriptor,
} from './study-room-core.mjs';

const STUDY_ROOM_ADMIN_ROLES = new Set(['admin', 'founder_admin', 'super_admin']);
const STUDY_ROOM_PRIVILEGED_MODERATOR_ROLES = new Set(['founder_admin', 'super_admin']);

function normalizedAdministratorRole(value) {
  return String(value || '').trim().toLowerCase();
}

function requireAuthorizedAdmin(authorization) {
  const role = normalizedAdministratorRole(authorization?.role);
  if (authorization?.authorized !== true || !STUDY_ROOM_ADMIN_ROLES.has(role)) {
    throw new StudyRoomError(
      'STUDY_ROOM_ADMIN_REQUIRED',
      'The live Study Room is currently limited to authorized administrators.',
      403,
      'The preview remains available from the Due Diligence home page.',
    );
  }
  return { ...authorization, role };
}

function requirePrivilegedModerator(authorization) {
  if (!STUDY_ROOM_PRIVILEGED_MODERATOR_ROLES.has(authorization?.role)) {
    throw new StudyRoomError(
      'STUDY_ROOM_MODERATION_FORBIDDEN',
      'Only a Founder or Super Admin can apply room-wide moderation.',
      403,
      'Use the local participant controls to mute or block someone only for yourself.',
    );
  }
}

function requestedRoomKey(body) {
  return body && Object.prototype.hasOwnProperty.call(body, 'roomKey')
    ? body.roomKey
    : '1';
}

export function createStudyRoomHandlers(dependencies) {
  const {
    authenticate,
    authorizeAdmin,
    parseJson,
    rateLimit,
    respond,
    describeRoom = studyRoomDescriptor,
    listRooms = listStudyRooms,
    createRoom = createStudyRoom,
    issueCredential = createStudyRoomJoinCredential,
    muteParticipant = muteStudyRoomParticipant,
    removeParticipant = removeStudyRoomParticipant,
    renameParticipant = renameStudyRoomParticipant,
  } = dependencies;

  async function authorizedContext(request, env, scope) {
    await rateLimit(request, env, scope);
    const user = await authenticate(request, env);
    if (!user) {
      throw new StudyRoomError(
        'STUDY_ROOM_SIGN_IN_REQUIRED',
        'Sign in before opening the Study Room.',
        401,
        'Return to Due Diligence, sign in, then open the Study Room again.',
      );
    }
    const authorization = requireAuthorizedAdmin(await authorizeAdmin(env, user));
    return { user, authorization };
  }

  return Object.freeze({
    async access(request, env, origin, allowedOrigin) {
      const { authorization } = await authorizedContext(request, env, 'access');
      const room = describeRoom(env);
      return respond({
        ok: true,
        allowed: true,
        role: authorization.role,
        roomName: room.roomName,
        maxRooms: room.maxRooms,
        maxParticipants: room.maxParticipants,
        recording: room.recording,
      }, 200, origin, allowedOrigin);
    },

    async rooms(request, env, origin, allowedOrigin) {
      const { authorization } = await authorizedContext(request, env, 'rooms');
      const body = await parseJson(request, 4_096);
      const operation = String(body?.operation || 'list').trim().toLowerCase();
      if (operation === 'list') {
        const catalog = await listRooms(env);
        return respond({
          ok: true,
          allowed: true,
          role: authorization.role,
          ...catalog,
        }, 200, origin, allowedOrigin);
      }
      if (operation === 'create') {
        const result = await createRoom(env, body?.roomKey);
        return respond({
          ok: true,
          created: result.created,
          room: result.room,
        }, result.created ? 201 : 200, origin, allowedOrigin);
      }
      throw new StudyRoomError(
        'STUDY_ROOM_OPERATION_UNSUPPORTED',
        'That Study Room operation is not available.',
        400,
      );
    },

    async join(request, env, origin, allowedOrigin) {
      const { user } = await authorizedContext(request, env, 'join');
      const body = await parseJson(request, 4_096);
      const credential = await issueCredential(
        env,
        user,
        requestedRoomKey(body),
        body?.nickname,
      );
      return respond({
        ok: true,
        server_url: credential.serverUrl,
        participant_token: credential.participantToken,
        room_key: credential.roomKey,
        room_label: credential.roomLabel,
        room_name: credential.roomName,
        participant_identity: credential.participantIdentity,
        participant_name: credential.participantName,
        focus_started_at: credential.focusStartedAt,
        expires_in_seconds: credential.expiresInSeconds,
        recording: false,
      }, 201, origin, allowedOrigin);
    },

    async moderate(request, env, origin, allowedOrigin) {
      const { user, authorization } = await authorizedContext(request, env, 'moderate');
      const body = await parseJson(request, 6_144);
      const operation = String(body?.operation || '').trim().toLowerCase();
      const roomKey = requestedRoomKey(body);
      let result;
      if (operation === 'mute') {
        requirePrivilegedModerator(authorization);
        result = await muteParticipant(env, roomKey, body?.participantIdentity, body?.trackSid);
      } else if (operation === 'rename') {
        result = await renameParticipant(
          env,
          user.id,
          roomKey,
          body?.participantIdentity,
          body?.nickname,
        );
      } else if (operation === 'remove') {
        requirePrivilegedModerator(authorization);
        result = await removeParticipant(env, roomKey, body?.participantIdentity);
      } else {
        throw new StudyRoomError(
          'STUDY_ROOM_OPERATION_UNSUPPORTED',
          'That Study Room moderation action is not available.',
          400,
        );
      }
      return respond({ ok: true, result }, 200, origin, allowedOrigin);
    },
  });
}
