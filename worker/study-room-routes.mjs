import {
  StudyRoomError,
  createStudyRoomJoinCredential,
  muteStudyRoomParticipant,
  removeStudyRoomParticipant,
  renameStudyRoomParticipant,
  studyRoomDescriptor,
} from './study-room-core.mjs';

const STUDY_ROOM_ADMIN_ROLES = new Set(['admin', 'founder_admin', 'super_admin']);

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

export function createStudyRoomHandlers(dependencies) {
  const {
    authenticate,
    authorizeAdmin,
    parseJson,
    rateLimit,
    respond,
    describeRoom = studyRoomDescriptor,
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
        maxParticipants: room.maxParticipants,
        recording: false,
      }, 200, origin, allowedOrigin);
    },

    async join(request, env, origin, allowedOrigin) {
      const { user } = await authorizedContext(request, env, 'join');
      const body = await parseJson(request, 4_096);
      const credential = await issueCredential(env, user, body?.nickname);
      return respond({
        ok: true,
        server_url: credential.serverUrl,
        participant_token: credential.participantToken,
        room_name: credential.roomName,
        participant_identity: credential.participantIdentity,
        participant_name: credential.participantName,
        focus_started_at: credential.focusStartedAt,
        expires_in_seconds: credential.expiresInSeconds,
        recording: false,
      }, 201, origin, allowedOrigin);
    },

    async moderate(request, env, origin, allowedOrigin) {
      const { user } = await authorizedContext(request, env, 'moderate');
      const body = await parseJson(request, 6_144);
      const operation = String(body?.operation || '').trim().toLowerCase();
      let result;
      if (operation === 'mute') {
        result = await muteParticipant(env, body?.participantIdentity, body?.trackSid);
      } else if (operation === 'rename') {
        result = await renameParticipant(env, user.id, body?.participantIdentity, body?.nickname);
      } else if (operation === 'remove') {
        result = await removeParticipant(env, body?.participantIdentity);
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
