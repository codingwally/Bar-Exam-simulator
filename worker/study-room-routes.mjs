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
const STUDY_ROOM_TEST_ACCESS_BASIS = 'founding_beta';

function normalizedAdministratorRole(value) {
  return String(value || '').trim().toLowerCase();
}

function authorizedAdministrator(authorization) {
  const role = normalizedAdministratorRole(authorization?.role);
  return authorization?.authorized === true && STUDY_ROOM_ADMIN_ROLES.has(role)
    ? { ...authorization, role }
    : null;
}

function authorizedTestMember(access) {
  const basis = String(access?.basis || '').trim().toLowerCase();
  return access?.allowed === true && basis === STUDY_ROOM_TEST_ACCESS_BASIS
    ? access
    : null;
}

function requireAdministrator(context) {
  if (context?.isAdministrator === true) return context.authorization;
  throw new StudyRoomError(
    'STUDY_ROOM_ADMIN_REQUIRED',
    'Only a Due Diligence administrator can open a Study Room.',
    403,
    'Join a room after an administrator opens it.',
  );
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

function administratorOnlyRequest(request) {
  try {
    return /^\/admin\/study-room(?:\/|$)/u.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

export function createStudyRoomHandlers(dependencies) {
  const {
    authenticate,
    authorizeAdmin,
    authorizeMember,
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
    const authorization = authorizedAdministrator(await authorizeAdmin(env, user));
    if (authorization) {
      return {
        user,
        authorization,
        memberAccess: null,
        role: authorization.role,
        isAdministrator: true,
      };
    }
    if (administratorOnlyRequest(request)) {
      throw new StudyRoomError(
        'STUDY_ROOM_ADMIN_REQUIRED',
        'Only a Due Diligence administrator can use this Study Room endpoint.',
        403,
        'Open the Study Room from the signed-in website instead.',
      );
    }
    const memberAccess = authorizedTestMember(await authorizeMember(env, user));
    if (!memberAccess) {
      throw new StudyRoomError(
        'STUDY_ROOM_PRIVATE_TEST_REQUIRED',
        'The Study Room is currently limited to authorized testers.',
        403,
        'This account is not yet eligible while testing continues.',
      );
    }
    return {
      user,
      authorization: null,
      memberAccess,
      role: 'member',
      isAdministrator: false,
    };
  }

  return Object.freeze({
    async access(request, env, origin, allowedOrigin) {
      const context = await authorizedContext(request, env, 'access');
      const room = describeRoom(env);
      return respond({
        ok: true,
        allowed: true,
        role: context.role,
        administrator: context.isAdministrator,
        canCreateRooms: context.isAdministrator,
        maxRooms: room.maxRooms,
        maxParticipants: room.maxParticipants,
        recording: room.recording,
      }, 200, origin, allowedOrigin);
    },

    async rooms(request, env, origin, allowedOrigin) {
      const context = await authorizedContext(request, env, 'rooms');
      const body = await parseJson(request, 4_096);
      const operation = String(body?.operation || 'list').trim().toLowerCase();
      if (operation === 'list') {
        const catalog = await listRooms(env, { isAdministrator: context.isAdministrator });
        return respond({
          ok: true,
          allowed: true,
          role: context.role,
          administrator: context.isAdministrator,
          canCreateRooms: context.isAdministrator,
          ...catalog,
        }, 200, origin, allowedOrigin);
      }
      if (operation === 'create') {
        requireAdministrator(context);
        const result = await createRoom(env, body?.roomKey, { isAdministrator: true });
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
      const context = await authorizedContext(request, env, 'join');
      const body = await parseJson(request, 4_096);
      const credential = await issueCredential(
        env,
        context.user,
        requestedRoomKey(body),
        body?.nickname,
        { isAdministrator: context.isAdministrator },
      );
      return respond({
        ok: true,
        server_url: credential.serverUrl,
        participant_token: credential.participantToken,
        room_key: credential.roomKey,
        room_label: credential.roomLabel,
        room_name: credential.roomName,
        room_kind: credential.roomKind,
        microphone_allowed: credential.microphoneAllowed,
        administrator: credential.administrator,
        participant_identity: credential.participantIdentity,
        participant_name: credential.participantName,
        focus_started_at: credential.focusStartedAt,
        expires_in_seconds: credential.expiresInSeconds,
        recording: false,
      }, 201, origin, allowedOrigin);
    },

    async moderate(request, env, origin, allowedOrigin) {
      const context = await authorizedContext(request, env, 'moderate');
      requireAdministrator(context);
      const body = await parseJson(request, 6_144);
      const operation = String(body?.operation || '').trim().toLowerCase();
      const roomKey = requestedRoomKey(body);
      let result;
      if (operation === 'mute') {
        requirePrivilegedModerator(context.authorization);
        result = await muteParticipant(env, roomKey, body?.participantIdentity, body?.trackSid);
      } else if (operation === 'rename') {
        result = await renameParticipant(
          env,
          context.user.id,
          roomKey,
          body?.participantIdentity,
          body?.nickname,
        );
      } else if (operation === 'remove') {
        requirePrivilegedModerator(context.authorization);
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
