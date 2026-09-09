import { DebateServiceError } from './debate-service.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Vary': 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff' } });
const statusFor = code => /AUTH_REQUIRED/.test(code) ? 401 : /FORBIDDEN|NOT_MEMBER|INVITE_INVALID/.test(code) ? 403 : /NOT_FOUND/.test(code) ? 404 : /CONFLICT|NOT_READY|LOCKED|CLOSED|AWAITING|PENDING|LIMIT|UNRESOLVED/.test(code) ? 409 : /UNAVAILABLE|UNCONFIGURED/.test(code) ? 503 : 400;
async function boundedText(request, maximum = 262144) {
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new DebateServiceError('PAYLOAD_TOO_LARGE', 'This action contains too much information.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Called after the existing Worker CORS/origin/CSRF handling; authenticate verifies identity. */
export function createDebateRoutes({ service, authenticate, prefix = '/debate-room' }) {
  return {
    async handle(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${prefix}/`)) return null;
      try {
        const actor = await authenticate(request);
        if (!actor?.id) throw new DebateServiceError('AUTH_REQUIRED', 'Sign in to continue to this debate.');
        const route = url.pathname.slice(prefix.length);
        if (request.method === 'GET' && route === '/events') return json(await service.list({ actor }));
        if (request.method === 'GET' && route === '/discover') return json(await service.discover({ actor, limit: url.searchParams.get('limit') || 20, cursor: url.searchParams.get('cursor') }));
        if (request.method === 'GET' && route === '/snapshot') return json(await service.snapshot({ actor, eventId: url.searchParams.get('eventId') }));
        if (request.method === 'GET' && route === '/messages') return json(await service.messages({ actor, eventId: url.searchParams.get('eventId'), matchId: url.searchParams.get('matchId'), channel: url.searchParams.get('channel') || 'public', before: url.searchParams.get('before'), limit: url.searchParams.get('limit') || 50 }));
        if (request.method !== 'POST' || !['/command', '/claim'].includes(route)) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'This debate action does not exist.' } }, 404);
        if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new DebateServiceError('INVALID_CONTENT_TYPE', 'Send this action as JSON.');
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > 262144) throw new DebateServiceError('PAYLOAD_TOO_LARGE', 'This action contains too much information.');
        const raw = await boundedText(request);
        let body; try { body = JSON.parse(raw); } catch { throw new DebateServiceError('INVALID_JSON', 'This action could not be read.'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new DebateServiceError('INVALID_PAYLOAD', 'Check the action details.');
        const input = route === '/claim' ? { ...body, command: 'claim_invite', payload: { secret: body.secret } } : body;
        return json(await service.execute({ actor, eventId: input.eventId, command: input.command, payload: input.payload || {}, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey }));
      } catch (error) {
        const known = Boolean(error?.code);
        const code = known ? error.code : 'SERVICE_UNAVAILABLE';
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : statusFor(code);
        return json({ ok: false, error: { code, message: known ? error.message : 'Debate Room is temporarily unavailable. Your last saved state is preserved.', ...(known && error.details ? { details: error.details } : {}) } }, status);
      }
    },
  };
}
