import assert from 'node:assert/strict';

const workerUrl = String(process.env.STUDY_ROOM_WORKER_URL || '').trim().replace(/\/+$/u, '');
const allowedOrigin = String(process.env.STUDY_ROOM_ALLOWED_ORIGIN || '').trim();
assert.match(workerUrl, /^https:\/\/[A-Za-z0-9.-]+$/u, 'A secure Study Room Worker URL is required.');
assert.match(allowedOrigin, /^https:\/\/[A-Za-z0-9.-]+$/u, 'A secure allowed origin is required.');

const endpoint = `${workerUrl}/study-room/access`;

const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: {
    Origin: allowedOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
  cache: 'no-store',
});
assert.equal(preflight.status, 204, 'Study Room CORS preflight must succeed.');
assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/u);
assert.match(preflight.headers.get('access-control-allow-headers') || '', /Authorization/iu);

const unauthenticated = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Origin: allowedOrigin,
    'Content-Type': 'application/json',
  },
  body: '{}',
  cache: 'no-store',
});
const unauthenticatedPayload = await unauthenticated.json();
assert.equal(unauthenticated.status, 401, 'The live Study Room must reject signed-out users.');
assert.equal(unauthenticatedPayload?.ok, false);
assert.equal(unauthenticatedPayload?.error?.code, 'STUDY_ROOM_SIGN_IN_REQUIRED');
assert.match(unauthenticated.headers.get('cache-control') || '', /no-store/iu);
assert.equal(unauthenticated.headers.get('access-control-allow-origin'), allowedOrigin);
assert.doesNotMatch(JSON.stringify(unauthenticatedPayload), /participant_token|LIVEKIT_API_SECRET/iu);

for (const path of ['/study-room/rooms', '/study-room/join', '/study-room/moderate']) {
  const response = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  const payload = await response.json();
  assert.equal(response.status, 401, `${path} must reject signed-out users.`);
  assert.equal(payload?.error?.code, 'STUDY_ROOM_SIGN_IN_REQUIRED');
  assert.match(response.headers.get('cache-control') || '', /no-store/iu);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
}

const wrongOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Origin: 'https://not-duediligence.invalid',
    'Content-Type': 'application/json',
  },
  body: '{}',
  cache: 'no-store',
});
const wrongOriginPayload = await wrongOrigin.json();
assert.equal(wrongOrigin.status, 403, 'The live Study Room must reject a foreign browser origin.');
assert.equal(wrongOriginPayload?.error?.code, 'ORIGIN_NOT_ALLOWED');

const plans = await fetch(`${workerUrl}/plans`, {
  method: 'POST',
  headers: {
    Origin: allowedOrigin,
    'Content-Type': 'application/json',
  },
  body: '{}',
  cache: 'no-store',
});
const plansPayload = await plans.json();
assert.equal(plans.status, 200, 'Plans & Pricing must remain available after the Worker release.');
assert.equal(plansPayload?.ok, true);
assert.ok(
  plansPayload.plans?.some((plan) => plan?.planCode === 'early_access_beta'),
  'The Early Access plan must remain present.',
);

console.log('Deployed Study Room access controls and Plans & Pricing smoke checks passed.');
