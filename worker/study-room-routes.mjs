import {
  StudyRoomError,
  createStudyRoom,
  configureStudyRoom,
  createStudyRoomJoinCredential,
  listStudyRooms,
  normalizeStudyRoomCatalog,
  muteStudyRoomParticipant,
  removeStudyRoomParticipant,
  renameStudyRoomParticipant,
  studyRoomDescriptor,
} from './study-room-core.mjs';
import { createStudyRoomAdmission } from './study-room-admission.mjs';

const STUDY_ROOM_ADMIN_ROLES = new Set(['admin', 'founder_admin', 'super_admin']);
const STUDY_ROOM_MEMBER_ACCESS_BASIS = 'signed_in';

function normalizedAdministratorRole(value) {
  return String(value || '').trim().toLowerCase();
}

function authorizedAdministrator(authorization) {
  const role = normalizedAdministratorRole(authorization?.role);
  return authorization?.authorized === true && STUDY_ROOM_ADMIN_ROLES.has(role)
    ? { ...authorization, role }
    : null;
}

function authorizedSignedInMember(access) {
  const basis = String(access?.basis || '').trim().toLowerCase();
  return access?.allowed === true && basis === STUDY_ROOM_MEMBER_ACCESS_BASIS
    ? access
    : null;
}

function requireAdministrator(context) {
  if (context?.isAdministrator === true) return context.authorization;
  throw new StudyRoomError(
    'STUDY_ROOM_ADMIN_REQUIRED',
    'Only a Due Diligence administrator can use this Study Room control.',
    403,
    'Choose an available public room from the lobby.',
  );
}

function requirePrivilegedModerator(authorization) {
  if (!STUDY_ROOM_ADMIN_ROLES.has(authorization?.role)) {
    throw new StudyRoomError(
      'STUDY_ROOM_MODERATION_FORBIDDEN',
      'Only a Due Diligence administrator can apply room-wide moderation.',
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
    readCatalog,
    configureCatalog,
    verifyPaidMembership,
    admissionRpc,
    admissionPresence,
    admissionRevokeToken,
    describeRoom = studyRoomDescriptor,
    listRooms = listStudyRooms,
    createRoom = createStudyRoom,
    configureRoom = configureStudyRoom,
    issueCredential = createStudyRoomJoinCredential,
    muteParticipant = muteStudyRoomParticipant,
    removeParticipant = removeStudyRoomParticipant,
    renameParticipant = renameStudyRoomParticipant,
  } = dependencies;
  const admission = createStudyRoomAdmission({ rpc: admissionRpc,
    presence: admissionPresence, revokeToken: admissionRevokeToken });

  async function currentCatalog(env) {
    if (typeof readCatalog !== 'function') {
      throw new StudyRoomError('STUDY_ROOM_CATALOG_UNAVAILABLE', 'The Study Room catalog is unavailable.', 503);
    }
    return normalizeStudyRoomCatalog(await readCatalog(env));
  }

  async function roomOptions(env, context, catalog, checkPaid = false) {
    const paid = async () => typeof verifyPaidMembership === 'function'
      && await verifyPaidMembership(env, context.user) === true;
    return {
      catalog,
      getCatalog: () => currentCatalog(env),
      isAdministrator: context.isAdministrator,
      isPaidMember: !context.isAdministrator && checkPaid ? await paid() : false,
      verifyPaidMembership: paid,
      ...(typeof admissionRpc === 'function' ? { authorizeAdmission: (slot, nickname, version) =>
        admission.authorize(env, context.user, slot, nickname, version) } : {}),
      configureCatalog: (body) => {
        if (typeof configureCatalog !== 'function') throw new StudyRoomError('STUDY_ROOM_CATALOG_UNAVAILABLE', 'Room configuration is unavailable.', 503);
        return configureCatalog(env, body);
      },
    };
  }

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
    const memberAccess = authorizedSignedInMember(await authorizeMember(env, user));
    if (!memberAccess) {
      throw new StudyRoomError(
        'STUDY_ROOM_ACCOUNT_UNAVAILABLE',
        'This account cannot enter the Study Room.',
        403,
        'Sign in with an active Due Diligence account and try again.',
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
    async admission(request, env, origin, allowedOrigin) {
      const context = await authorizedContext(request, env, 'admission');
      const body = await parseJson(request, 4096);
      const result = await admission.command(env, context.user, body,
        await roomOptions(env, context, await currentCatalog(env)));
      return respond(result, 200, origin, allowedOrigin);
    },
    async access(request, env, origin, allowedOrigin) {
      const context = await authorizedContext(request, env, 'access');
      const room = describeRoom(env, { catalog: await currentCatalog(env) });
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
        const current = await currentCatalog(env);
        const catalog = await listRooms(env, await roomOptions(env, context, current,
          current.rooms.some((room) => room.audience === 'paid')));
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
        const result = await createRoom(env, body?.roomKey, await roomOptions(env, context, await currentCatalog(env)));
        return respond({
          ok: true,
          created: result.created,
          room: result.room,
        }, result.created ? 201 : 200, origin, allowedOrigin);
      }
      if (operation === 'add' || operation === 'update') {
        requireAdministrator(context);
        if (!administratorOnlyRequest(request)) {
          throw new StudyRoomError('STUDY_ROOM_ADMIN_REQUIRED', 'Use the administrator room configuration endpoint.', 403);
        }
        const result = await configureRoom(env, context.user, { ...body, operation },
          await roomOptions(env, context, await currentCatalog(env)));
        return respond(result, 200, origin, allowedOrigin);
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
      const catalog = await currentCatalog(env);
      const credential = await issueCredential(
        env,
        context.user,
        requestedRoomKey(body),
        body?.nickname,
        await roomOptions(env, context, catalog,
          catalog.rooms.some((room) => room.roomKey === String(requestedRoomKey(body)) && room.audience === 'paid')),
      );
      return respond({
        ok: true,
        server_url: credential.serverUrl,
        participant_token: credential.participantToken,
        room_key: credential.roomKey,
        room_label: credential.roomLabel,
        room_name: credential.roomName,
        room_kind: credential.roomKind,
        room_revision: credential.revision,
        access_revision: credential.accessRevision,
        audience: credential.audience,
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
      const options = await roomOptions(env, context, await currentCatalog(env));
      let result;
      if (operation === 'mute') {
        requirePrivilegedModerator(context.authorization);
        result = await muteParticipant(env, roomKey, body?.participantIdentity, body?.trackSid, options);
      } else if (operation === 'rename') {
        result = await renameParticipant(
          env,
          context.user.id,
          roomKey,
          body?.participantIdentity,
          body?.nickname,
          options,
        );
      } else if (operation === 'remove') {
        requirePrivilegedModerator(context.authorization);
        if (typeof admissionRpc === 'function') {
          const slot = options.catalog.rooms.find((room) => room.roomKey === String(roomKey));
          await admission.command(env, context.user, { operation: 'revoke', roomKey,
            accessRevision: slot?.accessRevision, participantIdentity: body?.participantIdentity,
            commandId: body?.commandId }, options);
          result = { action: 'removed', roomKey, participantIdentity: body?.participantIdentity };
        } else {
        result = await removeParticipant(env, roomKey, body?.participantIdentity, options);
        }
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
