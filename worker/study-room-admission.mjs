import { StudyRoomError, normalizeStudyRoomNickname, resolveStudyRoomSlot,
  studyRoomParticipantIdentity, requireStudyRoomAdministratorPresence,
  revokeStudyRoomParticipantToken } from './study-room-core.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_OPERATIONS = new Set(['list', 'admit', 'deny', 'reinstate', 'revoke']);
const MUTATIONS = new Set(['request', 'cancel', 'admit', 'deny', 'reinstate', 'revoke']);

export function createStudyRoomAdmission({ rpc,
  presence = requireStudyRoomAdministratorPresence,
  revokeToken = revokeStudyRoomParticipantToken } = {}) {
  async function call(env, payload) {
    if (typeof rpc !== 'function') throw new StudyRoomError('STUDY_ROOM_ADMISSION_UNAVAILABLE', 'Room admission is temporarily unavailable. Retry shortly.', 503);
    const result = await rpc(env, { p_command: payload });
    if (!result || result.ok !== true) throw new StudyRoomError('STUDY_ROOM_ADMISSION_UNAVAILABLE', 'The admission response could not be confirmed.', 503);
    return result;
  }
  async function command(env, user, body, options = {}) {
    const operation = String(body?.operation || 'status');
    if (!['request', 'status', 'cancel', ...ADMIN_OPERATIONS].includes(operation)) throw new StudyRoomError('STUDY_ROOM_OPERATION_UNSUPPORTED', 'That admission action is unavailable.', 400);
    const slot = resolveStudyRoomSlot(env, body?.roomKey, options);
    const identity = await studyRoomParticipantIdentity(env, user.id);
    if (slot.adminOnly && !options.isAdministrator) throw new StudyRoomError('STUDY_ROOM_ADMIN_ROOM_REQUIRED', 'This room is private to administrators.', 403);
    if (body?.accessRevision !== slot.accessRevision) throw new StudyRoomError('STUDY_ROOM_CONFIG_CONFLICT', 'Room access changed. Refresh the room list.', 409);
    if (MUTATIONS.has(operation) && !UUID.test(String(body?.commandId || ''))) throw new StudyRoomError('STUDY_ROOM_ADMISSION_INVALID', 'The admission request needs a valid retry identifier.', 400);
    const payload = { operation, actor: user.id, identity, roomKey: slot.roomKey,
      accessRevision: slot.accessRevision, commandId: body?.commandId || null };
    if (operation === 'request') payload.nickname = normalizeStudyRoomNickname(body?.nickname);
    if (ADMIN_OPERATIONS.has(operation)) {
      if (!options.isAdministrator) throw new StudyRoomError('STUDY_ROOM_ADMIN_REQUIRED', 'Only an administrator inside this room can manage admission.', 403);
      const confirmed = await presence(env, user.id, slot.roomKey, options);
      payload.presence = { identity: confirmed.identity, roomKey: slot.roomKey,
        accessRevision: slot.accessRevision, checkedAt: new Date().toISOString() };
      if (operation === 'list') {
        const page = body?.page ?? 0;
        if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new StudyRoomError('STUDY_ROOM_ADMISSION_INVALID', 'Choose a valid waiting-list page.', 400);
        payload.page = page;
      }
      if (operation !== 'list') {
        payload.requestId = body?.requestId;
        payload.expectedVersion = body?.expectedVersion;
        if (operation !== 'revoke' && (!UUID.test(String(payload.requestId || '')) || !Number.isSafeInteger(payload.expectedVersion))) {
          throw new StudyRoomError('STUDY_ROOM_ADMISSION_INVALID', 'Refresh the waiting list before making that decision.', 400);
        }
        if (operation === 'revoke') payload.targetIdentity = body?.participantIdentity;
      }
    }
    const result = await call(env, payload);
    // SQL denial comes first, so an outage can never mint a fresh credential
    // while provider removal is pending. The identical command safely retries
    // revocation even when its SQL receipt already exists.
    if (result.revokeRequired === true && result.admission?.identity) {
      await revokeToken(env, slot.roomKey, result.admission.identity, { ...options, revokedAt: result.revokedAt });
      await call(env, { ...payload, operation: 'confirm_revocation' });
    }
    return result;
  }
  async function authorize(env, user, slot, nickname, expectedVersion = null) {
    const identity = await studyRoomParticipantIdentity(env, user.id);
    const result = await call(env, { operation: 'authorize', actor: user.id, identity,
      roomKey: slot.roomKey, accessRevision: slot.accessRevision,
      nickname, expectedVersion });
    if (!result.allowed) {
      if (Date.parse(result.admission?.notBefore) > Date.now()) {
        throw new StudyRoomError('STUDY_ROOM_ADMISSION_COOLDOWN', 'Your previous room access is closing. Wait one minute, then retry entry.', 409);
      }
      throw new StudyRoomError('STUDY_ROOM_APPROVAL_REQUIRED', 'An administrator inside this room must admit you before you enter.', 403);
    }
    if (result.admission?.status !== 'approved' || !Number.isSafeInteger(result.admission?.version)
      || result.admission.version < 1 || !Number.isFinite(Date.parse(result.admission.expiresAt))
      || Date.parse(result.admission.expiresAt) <= Date.now()) {
      throw new StudyRoomError('STUDY_ROOM_ADMISSION_UNAVAILABLE', 'The admission response could not be confirmed. Retry shortly.', 503);
    }
    return result.admission;
  }
  return Object.freeze({ command, authorize });
}
