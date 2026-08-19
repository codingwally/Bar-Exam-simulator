import applicationWorker from './commercial-entry.mjs';

const PASSWORD_HASH_FALLBACK = '47774b9663224515a9e6a10a81c45e30655bcfa3a1073175e0e46798de2aa672';
const TOKEN_HEADER = 'X-DD-Maintenance-Access';
const TOKEN_AUDIENCE = 'duediligence-maintenance-v1';
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attemptWindows = new Map();

function clean(value, maximum = 400) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function maintenanceEnabled(env) {
  return String(env?.MAINTENANCE_MODE ?? 'true').trim().toLowerCase() !== 'false';
}

function allowedOrigin(env) {
  return clean(env?.ALLOWED_ORIGIN || 'https://duediligence.ph', 300);
}

function corsHeaders(origin, env) {
  const approved = allowedOrigin(env);
  return {
    'Access-Control-Allow-Origin': origin === approved ? origin : approved,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
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
      TOKEN_HEADER,
    ].join(', '),
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...extraHeaders,
    },
  });
}

function assertApprovedOrigin(request, env) {
  const origin = clean(request.headers.get('Origin'), 300);
  if (origin !== allowedOrigin(env)) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: {
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'This maintenance request did not come from the approved Due Diligence site.',
        },
      }, 403, origin, env),
    };
  }
  return { ok: true, origin };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeTextEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function signingKey(env) {
  const secret = clean(env?.MAINTENANCE_SIGNING_KEY, 1024);
  if (secret.length < 32) return null;
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function issueToken(env) {
  const key = await signingKey(env);
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const configuredTtl = Number(env?.MAINTENANCE_TOKEN_TTL_SECONDS);
  const ttl = Number.isFinite(configuredTtl)
    ? Math.min(Math.max(Math.floor(configuredTtl), 300), 30 * 24 * 60 * 60)
    : DEFAULT_TOKEN_TTL_SECONDS;
  const payload = {
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + ttl,
    nonce: crypto.randomUUID(),
  };
  const encoded = encodeJson(payload);
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encoded),
  ));
  return {
    token: `${encoded}.${bytesToBase64Url(signature)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

async function verifyToken(env, value) {
  const token = clean(value, 4096);
  const [encoded, signaturePart, extra] = token.split('.');
  if (!encoded || !signaturePart || extra) return null;
  const key = await signingKey(env);
  if (!key) return null;

  let payload;
  let signature;
  try {
    payload = decodeJson(encoded);
    signature = base64UrlToBytes(signaturePart);
  } catch {
    return null;
  }

  const validSignature = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(encoded),
  ).catch(() => false);
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature
      || payload?.aud !== TOKEN_AUDIENCE
      || !Number.isInteger(payload?.iat)
      || !Number.isInteger(payload?.exp)
      || payload.exp <= now
      || payload.iat > now + 60
      || payload.exp - payload.iat > 30 * 24 * 60 * 60) {
    return null;
  }
  return payload;
}

function enforceAttemptLimit(request) {
  const now = Date.now();
  const key = clean(request.headers.get('CF-Connecting-IP') || 'unavailable', 120);
  const current = attemptWindows.get(key);
  if (!current || now - current.startedAt >= ATTEMPT_WINDOW_MS) {
    attemptWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (attemptWindows.size > 1000) {
    for (const [entryKey, entry] of attemptWindows) {
      if (now - entry.startedAt >= ATTEMPT_WINDOW_MS) attemptWindows.delete(entryKey);
    }
  }
  return current.count <= MAX_ATTEMPTS_PER_WINDOW;
}

function clearAttemptWindow(request) {
  const key = clean(request.headers.get('CF-Connecting-IP') || 'unavailable', 120);
  attemptWindows.delete(key);
}

async function handleUnlock(request, env) {
  const originCheck = assertApprovedOrigin(request, env);
  if (!originCheck.ok) return originCheck.response;
  const origin = originCheck.origin;
  if (request.method !== 'POST') {
    return jsonResponse({
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted.' },
    }, 405, origin, env);
  }
  if (!enforceAttemptLimit(request)) {
    return jsonResponse({
      ok: false,
      error: {
        code: 'MAINTENANCE_RATE_LIMITED',
        message: 'Too many password attempts. Wait a few minutes and try again.',
      },
    }, 429, origin, env, { 'Retry-After': '600' });
  }

  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? '').trim();
  if (!password || password.length > 64) {
    return jsonResponse({
      ok: false,
      error: { code: 'MAINTENANCE_PASSWORD_REQUIRED', message: 'Enter the maintenance password.' },
    }, 400, origin, env);
  }

  const expected = clean(env?.MAINTENANCE_PASSWORD_HASH || PASSWORD_HASH_FALLBACK, 128)
    .toLowerCase();
  const actual = await sha256Hex(password);
  if (!constantTimeTextEqual(actual, expected)) {
    return jsonResponse({
      ok: false,
      error: { code: 'MAINTENANCE_PASSWORD_INVALID', message: 'The maintenance password is incorrect.' },
    }, 401, origin, env);
  }

  const issued = await issueToken(env);
  if (!issued) {
    return jsonResponse({
      ok: false,
      error: {
        code: 'MAINTENANCE_NOT_CONFIGURED',
        message: 'Maintenance access is temporarily unavailable.',
      },
    }, 503, origin, env);
  }
  clearAttemptWindow(request);
  return jsonResponse({ ok: true, ...issued }, 200, origin, env);
}

async function handleStatus(request, env) {
  const originCheck = assertApprovedOrigin(request, env);
  if (!originCheck.ok) return originCheck.response;
  const origin = originCheck.origin;
  if (request.method !== 'POST') {
    return jsonResponse({
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted.' },
    }, 405, origin, env);
  }

  const payload = await verifyToken(env, request.headers.get(TOKEN_HEADER));
  if (!payload) {
    return jsonResponse({
      ok: false,
      error: {
        code: 'MAINTENANCE_ACCESS_REQUIRED',
        message: 'Enter the maintenance password to continue.',
      },
    }, 401, origin, env);
  }
  return jsonResponse({
    ok: true,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }, 200, origin, env);
}

function lockedResponse(request, env) {
  const origin = clean(request.headers.get('Origin'), 300);
  return jsonResponse({
    ok: false,
    maintenance: true,
    error: {
      code: 'MAINTENANCE_MODE',
      message: 'Due Diligence is under maintenance. Enter the maintenance password on the website to continue.',
    },
  }, 503, origin, env, { 'Retry-After': '300' });
}

async function fetchWithMaintenance(request, env, ctx) {
  if (!maintenanceEnabled(env)) return applicationWorker.fetch(request, env, ctx);

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const origin = clean(request.headers.get('Origin'), 300);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (pathname === '/maintenance/unlock') return handleUnlock(request, env);
  if (pathname === '/maintenance/status') return handleStatus(request, env);

  const payload = await verifyToken(env, request.headers.get(TOKEN_HEADER));
  if (!payload) return lockedResponse(request, env);

  const headers = new Headers(request.headers);
  headers.delete(TOKEN_HEADER);
  return applicationWorker.fetch(new Request(request, { headers }), env, ctx);
}

export default {
  fetch: fetchWithMaintenance,
  scheduled(controller, env, ctx) {
    return applicationWorker.scheduled?.(controller, env, ctx);
  },
};
