import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPROVED_TARGETS = Object.freeze({
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev':
    'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
  'https://duediligence-api.wallyesteban1993.workers.dev': 'https://duediligence.ph',
});

function cleanOrigin(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function assertNoForecastContent(payload) {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /"(?:questions|answers|results|suggestedAnswer|legalBasis|legal_basis|citations?|jurisprudence|payload|prediction_score|source_links|controlling_doctrine|rubric)"/iu,
    'The signed-out Forecast response must not expose protected content or grading data.',
  );
}

function assertExactDeniedPayload(payload, expectedCode) {
  assertNoForecastContent(payload);
  assert.equal(payload && typeof payload, 'object');
  assert.deepEqual(Object.keys(payload).sort(), ['error', 'ok']);
  assert.equal(payload.ok, false);
  assert.equal(payload.error && typeof payload.error, 'object');
  assert.deepEqual(Object.keys(payload.error).sort(), ['code', 'message']);
  assert.equal(payload.error.code, expectedCode);
  assert.equal(typeof payload.error.message, 'string');
  assert.ok(payload.error.message.length > 0 && payload.error.message.length <= 240);
}

export async function verifyAdminBarForecastDeployment({
  workerUrl,
  allowedOrigin,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = cleanOrigin(workerUrl);
  const origin = cleanOrigin(allowedOrigin);
  assert.equal(
    APPROVED_TARGETS[baseUrl],
    origin,
    'The Forecast deployment smoke is restricted to the approved staging or production pair.',
  );
  assert.equal(typeof fetchImpl, 'function', 'A fetch implementation is required.');

  const endpoint = `${baseUrl}/admin/dd2026/bar-forecast`;
  const preflight = await fetchImpl(endpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(preflight.status, 204, 'Forecast CORS preflight must succeed.');
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/iu);
  const allowedHeaders = preflight.headers.get('access-control-allow-headers') || '';
  assert.match(allowedHeaders, /Authorization/iu);
  assert.match(allowedHeaders, /Content-Type/iu);

  const unauthenticated = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'status' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const unauthenticatedPayload = await unauthenticated.json();
  assert.equal(unauthenticated.status, 401, 'The live Forecast must reject signed-out users.');
  assertExactDeniedPayload(unauthenticatedPayload, 'ADMIN_SIGN_IN_REQUIRED');
  assert.match(unauthenticated.headers.get('cache-control') || '', /private/iu);
  assert.match(unauthenticated.headers.get('cache-control') || '', /no-store/iu);
  assert.equal(unauthenticated.headers.get('pragma'), 'no-cache');
  assert.equal(unauthenticated.headers.get('access-control-allow-origin'), origin);
  assert.equal(unauthenticated.headers.get('x-content-type-options'), 'nosniff');

  const wrongOrigin = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Origin: 'https://not-duediligence.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation: 'status' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const wrongOriginPayload = await wrongOrigin.json();
  assert.equal(wrongOrigin.status, 403, 'The live Forecast must reject a foreign browser origin.');
  assertExactDeniedPayload(wrongOriginPayload, 'ORIGIN_NOT_ALLOWED');
  assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), origin);
  assert.match(wrongOrigin.headers.get('cache-control') || '', /private/iu);
  assert.match(wrongOrigin.headers.get('cache-control') || '', /no-store/iu);
  assert.equal(wrongOrigin.headers.get('pragma'), 'no-cache');
  assert.equal(wrongOrigin.headers.get('x-content-type-options'), 'nosniff');

  return Object.freeze({
    ok: true,
    endpoint,
    accessPolicy: 'paid-founding-beta-admin',
    verifiedBoundary: 'signed-out-and-origin',
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await verifyAdminBarForecastDeployment({
    workerUrl: process.env.ADMIN_BAR_FORECAST_WORKER_URL,
    allowedOrigin: process.env.ADMIN_BAR_FORECAST_ALLOWED_ORIGIN,
  });
  console.log(JSON.stringify(result));
}
