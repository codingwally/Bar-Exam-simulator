import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPROVED_PRODUCTION = Object.freeze({
  siteUrl: 'https://duediligence.ph',
  workerUrl: 'https://duediligence-api.wallyesteban1993.workers.dev',
  allowedOrigin: 'https://duediligence.ph',
});

function cleanOrigin(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function assertNoProtectedMaterial(payload, label) {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /"(?:questions|answers|results|suggestedAnswer|legalBasis|legal_basis|citations?|jurisprudence|payload|rubric)"/iu,
    `${label} must not expose protected questions, answers, or grading material.`,
  );
}

async function responseJson(response, label) {
  const value = await response.json().catch(() => null);
  assert.ok(value && typeof value === 'object', `${label} must return JSON.`);
  return value;
}

export async function verifyUnlimitedFeatureAccessLive({
  siteUrl,
  workerUrl,
  allowedOrigin,
  releaseSha,
  fetchImpl = globalThis.fetch,
} = {}) {
  const site = cleanOrigin(siteUrl);
  const worker = cleanOrigin(workerUrl);
  const origin = cleanOrigin(allowedOrigin);
  const sha = String(releaseSha || '').trim().toLowerCase();

  assert.deepEqual(
    { siteUrl: site, workerUrl: worker, allowedOrigin: origin },
    APPROVED_PRODUCTION,
    'The live access journey is restricted to the approved production targets.',
  );
  assert.match(sha, /^[0-9a-f]{40}$/u, 'The live access journey requires the exact release SHA.');
  assert.equal(typeof fetchImpl, 'function', 'A fetch implementation is required.');

  const releaseResponse = await fetchImpl(
    `${site}/.well-known/duediligence-release.txt?release=${sha}`,
    {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  assert.equal(releaseResponse.status, 200, 'The production release marker must be available.');
  assert.equal((await releaseResponse.text()).trim().toLowerCase(), sha);

  const homeResponse = await fetchImpl(`${site}/?release=${sha}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(homeResponse.status, 200, 'The production application shell must be available.');
  const home = await homeResponse.text();
  assert.match(home, /spa-bar-forecast/u, 'The Forecast launcher must remain in the public shell.');
  assert.match(home, /spa-bar-feels/u, 'The Bar Simulation launcher must remain in the public shell.');

  const plansResponse = await fetchImpl(`${worker}/plans`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const plans = await responseJson(plansResponse, 'Plans');
  assert.equal(plansResponse.status, 200, 'Plans and payment instructions must remain publicly reachable.');
  assert.equal(plans.ok, true);
  assert.ok(Array.isArray(plans.plans) && plans.plans.length > 0, 'At least one published plan is required.');
  const paymentMethods = Array.isArray(plans.pricing?.paymentMethods)
    ? plans.pricing.paymentMethods
    : [];
  const paymentMethod = paymentMethods.find((method) => (
    method?.enabled !== false
      && method?.visible !== false
      && (method?.qrUrl || method?.qrAsset?.assetId)
  ));
  assert.ok(paymentMethod, 'A published payment method with a QR image is required.');
  const qrPath = String(paymentMethod.qrUrl || `/pricing/assets/${paymentMethod.qrAsset.assetId}`);
  assert.match(
    qrPath,
    /^\/(?:assets\/payments\/[A-Za-z0-9._-]+|pricing\/assets\/[0-9a-f-]{36})$/iu,
    'The published QR must use an approved public path.',
  );
  const qrBase = qrPath.startsWith('/pricing/assets/') ? worker : site;
  const qrResponse = await fetchImpl(`${qrBase}${qrPath}?release=${sha}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', Origin: origin },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(qrResponse.status, 200, 'The published payment QR must be downloadable.');
  assert.match(qrResponse.headers.get('content-type') || '', /^image\/(?:png|jpeg|webp|svg\+xml)\b/iu);

  const forecastResponse = await fetchImpl(`${worker}/admin/dd2026/bar-forecast`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'status' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const forecast = await responseJson(forecastResponse, 'Forecast signed-out boundary');
  assert.equal(forecastResponse.status, 401, 'Forecast must reject a signed-out request.');
  assert.equal(forecast.ok, false);
  assert.match(String(forecast.error?.code || ''), /^[A-Z][A-Z0-9_]{2,63}$/u);
  assertNoProtectedMaterial(forecast, 'Forecast signed-out boundary');

  const barFeelsResponse = await fetchImpl(`${worker}/examinations/query`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'catalog', track: 'bar_feels' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const barFeels = await responseJson(barFeelsResponse, 'Bar Simulation signed-out boundary');
  assert.equal(barFeelsResponse.status, 401, 'Bar Simulation must reject a signed-out request.');
  assert.equal(barFeels.ok, false);
  assert.match(String(barFeels.error?.code || barFeels.code || ''), /^[A-Z][A-Z0-9_]{2,63}$/u);
  assertNoProtectedMaterial(barFeels, 'Bar Simulation signed-out boundary');

  return Object.freeze({
    ok: true,
    releaseSha: sha,
    plansReachable: true,
    paymentQrReachable: true,
    forecastSignedOutDenied: true,
    barSimulationSignedOutDenied: true,
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await verifyUnlimitedFeatureAccessLive({
    siteUrl: process.env.UNLIMITED_FEATURE_SITE_URL,
    workerUrl: process.env.UNLIMITED_FEATURE_WORKER_URL,
    allowedOrigin: process.env.UNLIMITED_FEATURE_ALLOWED_ORIGIN,
    releaseSha: process.env.UNLIMITED_FEATURE_RELEASE_SHA,
  });
  console.log(JSON.stringify(result));
}
