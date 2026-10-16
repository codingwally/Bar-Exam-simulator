import { createHash } from 'node:crypto';

const clockCommands = new Set(['claim_clock', 'renew_clock', 'timer', 'finish_stage', 'next_stage', 'return_stage']);
const timerActions = new Set(['START', 'PAUSE', 'TECHNICAL_PAUSE', 'RESUME', 'FINISH', 'RESET', 'SET_DURATION', 'EDIT_DURATION']);
const states = new Set(['READY', 'RUNNING', 'PAUSED', 'FINISHED']);
const errors = new Set(['STORE_UNAVAILABLE', 'REVISION_CONFLICT', 'STALE_VERSION',
  'CONTROLLER_REQUIRED', 'CONTROLLER_LEASE_ACTIVE', 'CONTROLLER_LEASE_REQUIRED', 'CLOCK_NOT_READY',
  'INVALID_TIMER', 'INVALID_TIMER_TRANSITION', 'UNKNOWN_TIMER_COMMAND', 'CONFIRMATION_REQUIRED',
  'STAGE_NOT_READY', 'INVALID_STAGE', 'MEDIA_PENDING', 'RULES_NOT_ACKNOWLEDGED', 'MATCH_NOT_LIVE',
  'FORBIDDEN', 'AUTH_REQUIRED', 'SIGN_IN_REQUIRED', 'INVALID_TOKEN', 'NOT_MEMBER', 'EVENT_NOT_FOUND',
  'MATCH_NOT_FOUND', 'RATE_LIMITED', 'IDEMPOTENCY_CONFLICT', 'DEBATE_UNAVAILABLE']);
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const hash = value => typeof value === 'string' && value.length > 0 && value.length <= 300
  ? createHash('sha256').update(value).digest('hex') : null;

// Only bounded structural facts are saved. Never save a key, payload, receipt
// result, token, private match content or provider exception in this diagnostic.
function timerFacts(event, matchId) {
  const timer = typeof matchId === 'string' && Array.isArray(event?.matches)
    ? event.matches.find(match => match?.id === matchId)?.timer : null;
  return timer ? { revision: number(event.revision), version: number(timer.version),
    state: states.has(timer.state) ? timer.state : null, startedAtServerMs: number(timer.startedAtServerMs),
    elapsedBeforeRunMs: number(timer.elapsedBeforeRunMs), leaseExpiresAtServerMs: number(timer.leaseExpiresAtServerMs),
    stageAttemptSha256: hash(timer.stageAttemptId), controllerSha256: hash(timer.controllerId) } : null;
}

export function clockRequestFacts({ input, event, actorId, requestId, requestedAt }) {
  if (!clockCommands.has(input?.command)) return null;
  const type = typeof input.payload?.type === 'string' ? input.payload.type.toUpperCase() : null;
  return { requestId: number(requestId), requestedAt: number(requestedAt), command: input.command,
    actorSha256: hash(actorId), eventSha256: hash(input.eventId), matchSha256: hash(input.payload?.matchId),
    timerAction: timerActions.has(type) ? type : null,
    expectedRevision: number(input.expectedRevision), timerVersion: number(input.payload?.timerVersion),
    idempotencyKeySha256: typeof input.idempotencyKey === 'string' && input.idempotencyKey.length <= 128 ? hash(input.idempotencyKey) : null,
    before: hash(input.eventId) && event?.id === input.eventId ? timerFacts(event, input.payload?.matchId) : null };
}

export function clockResponseFacts({ request, body, matchId, status, receivedAt, transportFailed = false }) {
  const validStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  return { receivedAt: number(receivedAt),
    latencyMs: number(receivedAt) !== null && number(request?.requestedAt) !== null ? number(receivedAt - request.requestedAt) : null, status: validStatus,
    outcome: transportFailed ? 'TRANSPORT_FAILED' : body == null ? 'UNREADABLE_RESPONSE' : 'RESPONSE',
    ok: typeof body?.ok === 'boolean' ? body.ok : null,
    errorCode: body?.error?.code == null ? null : errors.has(body.error.code) ? body.error.code : 'OTHER_ERROR',
    receiptSha256: hash(body?.receipt?.id), committedAt: number(body?.receipt?.committedAt),
    after: request?.eventSha256 && hash(body?.event?.id) === request.eventSha256
      && request?.matchSha256 && hash(matchId) === request.matchSha256 ? timerFacts(body?.event, matchId) : null };
}

export function recordClockDiagnostic(report, value, limit = 2048) {
  if (!value) return;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2048) throw new Error('CLOCK_DIAGNOSTIC_LIMIT');
  report.clockDiagnostics ||= [];
  while (report.clockDiagnostics.length >= limit) {
    report.clockDiagnostics.shift();
    report.clockDiagnosticsDropped = (report.clockDiagnosticsDropped || 0) + 1;
  }
  report.clockDiagnostics.push(value);
}

// The harnesses pass their existing request observations. Capture before sending
// and complete the same entry later, so a timeout still leaves request evidence.
export function recordClockRequest(report, observation, input, event) {
  const facts = clockRequestFacts({ input, event, ...observation });
  if (!facts) return;
  observation.clockDiagnostic = { ...facts, response: null, transportFailure: null };
  recordClockDiagnostic(report, observation.clockDiagnostic);
}

export function recordClockResponse(observation, result) {
  if (!observation?.clockDiagnostic) return;
  const destination = result.transportFailed ? 'transportFailure' : 'response';
  observation.clockDiagnostic[destination] = clockResponseFacts({ ...result,
    request: observation.clockDiagnostic, matchId: observation.matchId });
}
