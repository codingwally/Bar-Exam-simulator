const ALLOWED_ORIGIN = 'https://duediligence.ph';

const UNAVAILABLE_BODY = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'APPLICATION_TEMPORARILY_UNAVAILABLE',
    message: 'Due Diligence is temporarily unavailable.',
    recovery: 'Wait briefly, then try again.',
  }),
});

function unavailableResponse(request) {
  const requestOrigin = String(request?.headers?.get('Origin') || '').trim();
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': '5',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });

  if (requestOrigin === ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }

  return new Response(JSON.stringify(UNAVAILABLE_BODY), {
    status: 503,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const application = env?.DUE_DILIGENCE_APPLICATION;
    if (!application || typeof application.fetch !== 'function') {
      return unavailableResponse(request);
    }

    try {
      const response = await application.fetch(request);
      if (!(response instanceof Response)) {
        return unavailableResponse(request);
      }
      return response;
    } catch {
      console.error('Public application forwarding failed.');
      return unavailableResponse(request);
    }
  },
};
