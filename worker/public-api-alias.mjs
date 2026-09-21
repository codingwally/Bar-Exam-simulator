const CANONICAL_ORIGIN = 'https://duediligence.ph';
const APPROVED_BROWSER_ORIGINS = new Set([
  CANONICAL_ORIGIN,
  'https://www.duediligence.ph',
]);

const UNAVAILABLE_BODY = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'APPLICATION_TEMPORARILY_UNAVAILABLE',
    message: 'Due Diligence is temporarily unavailable.',
    recovery: 'Wait briefly, then try again.',
  }),
});

function browserOrigin(request) {
  return String(request?.headers?.get('Origin') || '').trim();
}

function approvedBrowserOrigin(request) {
  const origin = browserOrigin(request);
  return APPROVED_BROWSER_ORIGINS.has(origin) ? origin : '';
}

function unavailableResponse(request) {
  const requestOrigin = approvedBrowserOrigin(request);
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': '5',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });

  if (requestOrigin) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
  }

  return new Response(JSON.stringify(UNAVAILABLE_BODY), {
    status: 503,
    headers,
  });
}

function normalizeRequestForApplication(request) {
  const origin = approvedBrowserOrigin(request);
  if (!origin || origin === CANONICAL_ORIGIN) {
    return { browserOrigin: origin, request };
  }

  const headers = new Headers(request.headers);
  headers.set('Origin', CANONICAL_ORIGIN);
  return {
    browserOrigin: origin,
    request: new Request(request, { headers }),
  };
}

function restoreBrowserCors(response, origin) {
  if (!origin || origin === CANONICAL_ORIGIN) return response;

  const headers = new Headers(response.headers);
  const upstreamAllowedOrigin = headers.get('Access-Control-Allow-Origin');
  if (upstreamAllowedOrigin === CANONICAL_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Vary', headers.get('Vary')?.includes('Origin')
    ? headers.get('Vary')
    : [headers.get('Vary'), 'Origin'].filter(Boolean).join(', '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
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
      const normalized = normalizeRequestForApplication(request);
      const response = await application.fetch(normalized.request);
      if (!(response instanceof Response)) {
        return unavailableResponse(request);
      }
      return restoreBrowserCors(response, normalized.browserOrigin);
    } catch {
      console.error('Public application forwarding failed.');
      return unavailableResponse(request);
    }
  },
};
