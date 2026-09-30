/** Shared coordinator foundation only. No token issuer or provider is wired here. */
export const MEDIA_CAPACITY_LIMITS = Object.freeze({ hardCap: 100, reconnectReserve: 10, initialTokenSeconds: 30, proofFreshnessMs: 15000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT = /^p_[a-z0-9]{8,48}$/u;
const OPAQUE = /^[A-Za-z0-9:_-]{8,160}$/u;
const STATES = new Set(['reserved', 'issued', 'connected', 'uncertain', 'revoking', 'released']);
export class MediaCapacityError extends Error {
  constructor(code) { super(code); this.name = 'MediaCapacityError'; this.code = code; }
}
const need = (condition, code) => { if (!condition) throw new MediaCapacityError(code); };
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const exactKeys = (object, keys) => object && !Array.isArray(object) && typeof object === 'object' && Object.keys(object).every(key => keys.includes(key));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function validateCapacityReservation(value, projectId) {
  need(exactKeys(value, ['project_id','epoch_id','actor_id','scope_key','identity','room_name','event_key','session_key','state','version','replaces_epoch','reserved_seconds','reserved_bytes','created_at_ms','budget_deadline_ms','last_mint_at_ms','token_expires_at_ms','release_command_id','release_requested_at_ms','release_proof'])
    && value.project_id === projectId && UUID.test(value.epoch_id || '') && UUID.test(value.actor_id || '')
    && value.identity === `mc-${value.epoch_id}` && OPAQUE.test(value.room_name || '') && OPAQUE.test(value.scope_key || '')
    && STATES.has(value.state) && integer(value.version, 1) && integer(value.reserved_seconds, 10, 21600)
    && integer(value.reserved_bytes, 1) && integer(value.created_at_ms, 1) && integer(value.budget_deadline_ms, value.created_at_ms + 1), 'MEDIA_CAPACITY_RESPONSE_INVALID');
  if (value.release_proof != null) need(exactKeys(value.release_proof, ['releaseCommandId','projectId','roomName','identity','revocationAcknowledged','absent','cutoffSeconds','acknowledgedAtMs','observedAtMs'])
    && value.release_proof.projectId === projectId && value.release_proof.identity === value.identity
    && value.release_proof.roomName === value.room_name && value.release_proof.absent === true && value.release_proof.revocationAcknowledged === true, 'MEDIA_CAPACITY_RESPONSE_INVALID');
  return structuredClone(value);
}

/** All unreleased physical epochs consume seats, independent of TTL or client state. */
export function countPhysicalEpochs(reservations) {
  need(Array.isArray(reservations), 'MEDIA_CAPACITY_STATE_INVALID');
  const ids = new Set(); let count = 0;
  for (const row of reservations) {
    need(row && UUID.test(row.epoch_id || '') && STATES.has(row.state) && !ids.has(row.epoch_id), 'MEDIA_CAPACITY_STATE_INVALID');
    ids.add(row.epoch_id); if (row.state !== 'released') count++;
  }
  return count;
}

/** rpc is the existing server-only RPC transport for ONE authoritative database.
 * Never construct one independent coordinator per deployment/environment.
 * Authentication, room authorization and provider observations are the caller's
 * responsibilities. This adapter never claims a caller assertion proves LiveKit.
 */
export function createMediaCapacityStore({ rpc, projectId, coordinatorId }) {
  need(typeof rpc === 'function' && PROJECT.test(projectId || '') && UUID.test(coordinatorId || ''), 'MEDIA_CAPACITY_CONFIGURATION');
  const pending = new Map();
  async function call(operation, input) {
    const read = operation === 'read';
    need(exactKeys(input, read ? ['epochId'] : ['commandId', 'policyRevision', 'epochId', 'actorId', 'scopeKey', 'reservedSeconds', 'reservedBytes', 'replacesEpoch', 'expectedVersion', 'tokenExpiresAtMs', 'proof']), 'MEDIA_CAPACITY_INPUT');
    need(UUID.test(input.epochId || ''), 'MEDIA_CAPACITY_INPUT');
    if (!read) need(UUID.test(input.commandId || '') && integer(input.policyRevision, 1), 'MEDIA_CAPACITY_INPUT');
    const command = { operation, projectId, coordinatorId, ...structuredClone(input) };
    if (operation === 'reserve') need(UUID.test(input.actorId || '') && OPAQUE.test(input.scopeKey || '')
      && integer(input.reservedSeconds, 10, 21600) && integer(input.reservedBytes, 1)
      && (input.replacesEpoch === undefined || UUID.test(input.replacesEpoch)), 'MEDIA_CAPACITY_INPUT');
    else if (!read) need(integer(input.expectedVersion, 1), 'MEDIA_CAPACITY_INPUT');
    if (operation === 'mark_issued') need(integer(input.tokenExpiresAtMs, 1), 'MEDIA_CAPACITY_INPUT');
    if (operation === 'confirm_released') need(exactKeys(input.proof, ['releaseCommandId', 'projectId', 'roomName', 'identity', 'revocationAcknowledged', 'absent', 'cutoffSeconds', 'acknowledgedAtMs', 'observedAtMs'])
      && input.proof.projectId === projectId && UUID.test(input.proof.releaseCommandId || '')
      && OPAQUE.test(input.proof.roomName || '') && input.proof.identity === `mc-${input.epochId}`
      && input.proof.revocationAcknowledged === true && input.proof.absent === true
      && integer(input.proof.cutoffSeconds, 1) && integer(input.proof.acknowledgedAtMs, 1)
      && integer(input.proof.observedAtMs, input.proof.acknowledgedAtMs), 'MEDIA_CAPACITY_FENCE_UNCONFIRMED');
    const key = input.commandId, bytes = JSON.stringify(canonical(command));
    if (!read && pending.has(key)) {
      const previous = pending.get(key);
      need(previous.bytes === bytes, 'MEDIA_CAPACITY_IDEMPOTENCY_CONFLICT');
      if (previous.state === 'unknown') throw new MediaCapacityError('MEDIA_CAPACITY_OUTCOME_UNKNOWN');
      return previous.promise;
    }
    const entry = { bytes, state: 'requested' };
    const operationPromise = (async () => {
      let result;
      try { result = await rpc('media_capacity_command', { p_command: command }); }
      catch { if (!read) entry.state = 'unknown'; throw new MediaCapacityError('MEDIA_CAPACITY_OUTCOME_UNKNOWN'); }
      if (result?.ok === false && /^MEDIA_CAPACITY_[A-Z_]+$/u.test(result.error?.code || '')) {
        if (!read) pending.delete(key);
        throw new MediaCapacityError(result.error.code);
      }
      try {
        need(exactKeys(result, ['ok', 'projectId', 'coordinatorId', 'enabled', 'policyRevision', 'replayed', 'reservation'])
          && result.ok === true && result.projectId === projectId && result.coordinatorId === coordinatorId
          && typeof result.enabled === 'boolean' && integer(result.policyRevision, 1), 'MEDIA_CAPACITY_RESPONSE_INVALID');
        if (result.reservation !== null) {
          result.reservation = validateCapacityReservation(result.reservation, projectId);
          need(result.reservation.epoch_id === input.epochId, 'MEDIA_CAPACITY_RESPONSE_INVALID');
        } else need(read, 'MEDIA_CAPACITY_RESPONSE_INVALID');
      } catch (error) { if (!read) entry.state = 'unknown'; throw error; }
      if (!read) pending.delete(key);
      return structuredClone(result);
    })();
    entry.promise = operationPromise;
    if (!read) pending.set(key, entry);
    return operationPromise;
  }
  return Object.freeze({
    reserve: input => call('reserve', input), read: input => call('read', input),
    markIssued: input => call('mark_issued', input), markConnected: input => call('mark_connected', input),
    markUncertain: input => call('mark_uncertain', input), requestRelease: input => call('request_release', input),
    confirmReleased: input => call('confirm_released', input),
    // Unknown outcomes require explicit read-only reconciliation by the future
    // coordinator; constructing another client is not proof of safe retry.
    unresolvedCommands: () => [...pending].filter(([, value]) => value.state === 'unknown').map(([commandId]) => commandId),
  });
}
