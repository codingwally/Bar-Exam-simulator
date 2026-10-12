const ALLOWED_ORIGIN = 'https://duediligence.ph';
const APPROVED_BROWSER_ORIGINS = new Set([
  ALLOWED_ORIGIN,
  'https://www.duediligence.ph',
]);
const ALLOWED_METHODS = Object.freeze(['GET', 'POST', 'OPTIONS']);
const ALLOWED_REQUEST_HEADERS = Object.freeze([
  'Content-Type',
  'Authorization',
  'X-Guest-Device-ID',
  'X-Request-ID',
  'X-DD-Session-ID',
  'X-DD-Visitor-ID',
  'X-DD-Event-Key',
  'X-DD-Page-Area',
  'X-DD-Beta-Access',
  'X-DD-Beta-Flow-ID',
  'X-Debate-Filename',
]);
const ALLOWED_REQUEST_HEADER_SET = new Set(ALLOWED_REQUEST_HEADERS.map((header) => header.toLowerCase()));

const UNAVAILABLE_BODY = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'APPLICATION_TEMPORARILY_UNAVAILABLE',
    message: 'Due Diligence is temporarily unavailable.',
    recovery: 'Wait briefly, then try again.',
  }),
});

function approvedBrowserOrigin(request) {
  const origin = String(request?.headers?.get('Origin') || '').trim();
  return APPROVED_BROWSER_ORIGINS.has(origin) ? origin : '';
}

function preflightResponse(request) {
  const origin = approvedBrowserOrigin(request);
  if (!origin) {
    return new Response(null, {
      status: 403,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      },
    });
  }

  const requestedMethod = String(
    request.headers.get('Access-Control-Request-Method') || '',
  ).trim().toUpperCase();
  if (requestedMethod && !ALLOWED_METHODS.includes(requestedMethod)) {
    return new Response(null, {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      },
    });
  }

  const requestedHeaders = String(
    request.headers.get('Access-Control-Request-Headers') || '',
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_REQUEST_HEADER_SET.has(header))) {
    return new Response(null, {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      },
    });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
      'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS.join(', '),
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store, max-age=0',
      Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    },
  });
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return preflightResponse(request);
    }

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
