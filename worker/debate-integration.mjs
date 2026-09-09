import { createDebateStore } from './debate-store.mjs';
import { createDebateService } from './debate-service.mjs';
import { createDebateRoutes } from './debate-routes.mjs';
import { createDebateMediaAdapter } from './debate-media.mjs';
import { createDebateDelivery, DebateDeliveryError } from './debate-delivery.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Vary: 'Origin, Authorization, Cookie', 'X-Content-Type-Options': 'nosniff' } });
const ids = value => String(value || '').split(',').map(id => id.trim()).filter(Boolean);
const fail = (code, message, status = 400) => { throw new DebateDeliveryError(code, message, status); };
async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('INVALID_CONTENT_TYPE', 'Send this action as JSON.');
  const reader = request.body?.getReader(); if (!reader) fail('INVALID_PAYLOAD', 'This action needs its event details.');
  const chunks = []; let length = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 12000) { await reader.cancel(); fail('PAYLOAD_TOO_LARGE', 'This action is too large.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('INVALID_JSON', 'This action could not be read.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PAYLOAD', 'Check this action.'); return value;
}

/** Invoked only after the main Worker's origin check. No billing/token subsystem is used. */
export function createDebateIntegration({ env, authenticate, rpc, context, fetcher = fetch }) {
  const store = createDebateStore({ rpc }), delivery = createDebateDelivery(env, { fetcher });
  let service;
  const media = createDebateMediaAdapter({ ...env, DEBATE_MEDIA_ENABLED: env.DEBATE_SWEEPER_ENABLED === 'true' ? env.DEBATE_MEDIA_ENABLED : 'false' }, { authorizeJob: job => service.authorizeMediaJob(job) });
  const approvedCapacity = Number(env.DEBATE_APPROVED_MAX_PARTICIPANTS);
  service = createDebateService({ store, adapters: { media: media.apply, export: delivery.export, mail: delivery.mail, validateEvidence: delivery.validateEvidence, delete_evidence: delivery.delete_evidence, delete_export: delivery.delete_export, sealInvitation: delivery.sealInvitation, invitation_mail: delivery.invitation_mail, recipientEmail: delivery.recipientEmail }, limits: { maxParticipants: Number.isInteger(approvedCapacity) && approvedCapacity > 0 && approvedCapacity <= 100 ? approvedCapacity : 0, approvedRehearsalRecipientIds: ids(env.DEBATE_APPROVED_REHEARSAL_RECIPIENT_IDS), approvedRehearsalRecipientEmails: ids(env.DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS).map(email => email.toLowerCase()) } });
  const previewIds = ids(env.DEBATE_PREVIEW_ACTOR_IDS);
  const operatorIds = ids(env.DEBATE_PLATFORM_OPERATOR_IDS).filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  const publiclyEnabled = env.DEBATE_ROOM_ENABLED === 'true';
  async function actorFor(request) {
    const actor = await authenticate(request);
    if (!actor?.id) fail('AUTH_REQUIRED', 'Sign in to use Debate Room.', 401);
    if (!publiclyEnabled && !previewIds.includes(actor.id)) fail('DEBATE_PREVIEW_RESTRICTED', 'Debate Room is awaiting its release checks. This preview is restricted.', 403);
    // Only the server's explicit account list can grant retention operations.
    // Browser roles and an injected actor's extra properties cannot grant it.
    return { ...actor, platformOperator: operatorIds.includes(actor.id) };
  }
  const routes = createDebateRoutes({ service, authenticate: actorFor });
  function schedule(eventId) {
    const operation = service.processOutbox({ eventId, limit: 3 }).catch(() => {});
    if (context?.waitUntil) context.waitUntil(operation);
    return operation;
  }
  const fileResponse = (bytes, meta) => new Response(bytes, { headers: { 'Content-Type': meta.mimeType, 'Content-Disposition': `attachment; filename="${String(meta.filename || 'debate-file').replace(/[^a-zA-Z0-9._ -]/g, '_')}"`, 'X-Debate-Filename': String(meta.filename || 'debate-file').replace(/[^a-zA-Z0-9._ -]/g, '_'), 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Authorization, Cookie' } });
  return {
    async sweep() {
      if (env.DEBATE_SWEEPER_ENABLED !== 'true') return { disabled: true };
      let cursor = null, pages = 0, deferredEvents = 0, deadlineReached = false; const outcomes = []; const started = Date.now(), deadlineAt = started + 45000;
      do {
        const page = await service.sweep({ limit: 20, cursor, jobsPerEvent: 3, deadlineAt });
        outcomes.push(...page.outcomes); cursor = page.nextCursor; deferredEvents += page.deferredEvents || 0; deadlineReached ||= page.deadlineReached === true; pages++;
      } while (cursor && pages < 5 && Date.now() < deadlineAt && !deadlineReached);
      return { outcomes, nextCursor: cursor, backlog: Boolean(cursor) || deferredEvents > 0 || deadlineReached, deadlineReached, deferredEvents, durationMs: Date.now() - started };
    },
    async handle(request) {
      const url = new URL(request.url), route = url.pathname.replace(/\/+$/, '');
      try {
        if (route === '/debate-room/access' && ['POST','GET'].includes(request.method)) {
          if (publiclyEnabled) return json({ ok: true, enabled: true, signInRequired: true });
          if (!request.headers.get('Authorization')) return json({ ok: true, enabled: false, signInRequired: true });
          const actor = await authenticate(request); return json({ ok: true, enabled: Boolean(actor?.id && previewIds.includes(actor.id)), preview: true, signInRequired: true });
        }
        if (['/debate-room/media','/debate-room/outbox','/debate-room/download','/debate-room/evidence/upload','/debate-room/evidence/download'].includes(route)) {
          const actor = await actorFor(request);
          if (route === '/debate-room/download' && request.method === 'GET') {
            const input = { actor, eventId: url.searchParams.get('eventId'), downloadId: url.searchParams.get('downloadId') }, meta = await service.authorizeDownload(input), bytes = await delivery.download(meta.storageKey);
            await service.authorizeDownload(input); return fileResponse(bytes, meta);
          }
          if (route === '/debate-room/evidence/download' && request.method === 'GET') {
            const input = { actor, eventId: url.searchParams.get('eventId'), matchId: url.searchParams.get('matchId'), evidenceId: url.searchParams.get('evidenceId') }, meta = await service.authorizeEvidence(input), bytes = await delivery.downloadEvidence(meta);
            await service.authorizeEvidence(input); return fileResponse(bytes, meta);
          }
          if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Use the expected method for this action.', 405);
          if (route === '/debate-room/evidence/upload') {
            const input = { actor, eventId: url.searchParams.get('eventId'), matchId: url.searchParams.get('matchId'), channel: url.searchParams.get('channel') || 'public' };
            const mimeType = request.headers.get('Content-Type');
            const reservation = await service.reserveEvidenceUpload({ ...input, mimeType });
            try {
              const attachment = await delivery.upload({ actorId: actor.id, eventId: input.eventId, matchId: input.matchId, channel: input.channel, body: request.body, mimeType, name: request.headers.get('X-Debate-Filename'), reservation });
              await service.completeEvidenceUpload({ actor, eventId: input.eventId, matchId: input.matchId, reservationId: reservation.id, attachment });
              return json({ ok: true, attachment });
            } catch (error) {
              // Reservation already durably scheduled expiry cleanup. Advancing
              // it is best-effort; losing this response cannot orphan the file.
              await service.failEvidenceUpload({ actor, eventId: input.eventId, reservationId: reservation.id }).catch(() => {});
              throw error;
            }
          }
          const input = await readJson(request); await service.snapshot({ actor, eventId: input.eventId });
          if (route === '/debate-room/outbox') { await service.processOutbox({ eventId: input.eventId, limit: 3 }); return json(await service.snapshot({ actor, eventId: input.eventId })); }
          await service.processOutbox({ eventId: input.eventId, limit: 5 });
          const query = { actor, eventId: input.eventId, matchId: input.matchId, deviceId: input.deviceId }, session = await service.authorizeMedia(query), credential = await media.credential(session), current = await service.authorizeMedia(query);
          if (current.identity !== session.identity || current.epochId !== session.epochId || current.deviceId !== session.deviceId || credential.expiresAt > current.expiresAt || current.revocations.length || current.operationId !== session.operationId || current.roomName !== session.roomName || JSON.stringify(current.sources) !== JSON.stringify(session.sources)) fail('MEDIA_SESSION_CONFLICT', 'Your media role changed. Rejoin using the current permission.', 409);
          return json({ ...(await service.snapshot({ actor, eventId: input.eventId })), credential, serverNow: Date.now() });
        }
        const response = await routes.handle(request);
        if (response?.ok) {
          const body = await response.clone().json().catch(() => null);
          if (body?.event?.id && body.event.outbox?.some(job => job.status === 'queued')) { const run = schedule(body.event.id); if (!context?.waitUntil) await run; }
        }
        return response;
      } catch (error) {
        const status = error.status || (/AUTH_REQUIRED/.test(error.code) ? 401 : /FORBIDDEN|NOT_MEMBER/.test(error.code) ? 403 : /CONFLICT|EXPIRED|PENDING/.test(error.code) ? 409 : 503);
        return json({ ok: false, error: { code: error.code || 'DEBATE_UNAVAILABLE', message: error.code ? error.message : 'Debate Room is temporarily unavailable. Your last saved event is preserved.' } }, status);
      }
    },
  };
}
