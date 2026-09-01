import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyUnlimitedFeatureAccessLive } from './verify-unlimited-feature-access-live.mjs';

const production = Object.freeze({
  siteUrl: 'https://duediligence.ph',
  workerUrl: 'https://duediligence-api.wallyesteban1993.workers.dev',
  allowedOrigin: 'https://duediligence.ph',
  releaseSha: '0123456789abcdef0123456789abcdef01234567',
});

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function successfulFetch(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/.well-known/duediligence-release.txt')) {
      return new Response(`${production.releaseSha}\n`, { status: 200 });
    }
    if (url === `${production.siteUrl}/?release=${production.releaseSha}`) {
      return new Response('<button id="spa-bar-forecast"></button><button id="spa-bar-feels"></button>', {
        status: 200,
      });
    }
    if (url.endsWith('/plans')) {
      return jsonResponse(200, {
        ok: true,
        plans: [{ id: 'bar_access_30d' }],
        pricing: {
          paymentMethods: [{
            enabled: true,
            visible: true,
            qrUrl: '/assets/payments/current-qr.png',
          }],
        },
      });
    }
    if (url.includes('/assets/payments/current-qr.png')) {
      return new Response('image', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.endsWith('/admin/dd2026/bar-forecast')) {
      return jsonResponse(401, {
        ok: false,
        error: { code: 'ADMIN_SIGN_IN_REQUIRED', message: 'Sign in.' },
      });
    }
    if (url.endsWith('/examinations/query')) {
      return jsonResponse(401, {
        ok: false,
        error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in.' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('live journey proves exact Pages SHA, payment reachability, and both signed-out boundaries', async () => {
  const calls = [];
  const result = await verifyUnlimitedFeatureAccessLive({
    ...production,
    fetchImpl: successfulFetch(calls),
  });
  assert.deepEqual(result, {
    ok: true,
    releaseSha: production.releaseSha,
    plansReachable: true,
    paymentQrReachable: true,
    forecastSignedOutDenied: true,
    barSimulationSignedOutDenied: true,
  });
  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.filter(({ init }) => init.method === 'POST').map(({ url }) => new URL(url).pathname),
    ['/plans', '/admin/dd2026/bar-forecast', '/examinations/query'],
  );
});

test('live journey refuses any non-production target before the first request', async () => {
  let called = false;
  await assert.rejects(
    verifyUnlimitedFeatureAccessLive({
      ...production,
      siteUrl: 'https://preview.invalid',
      fetchImpl: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    }),
    /restricted to the approved production targets/iu,
  );
  assert.equal(called, false);
});

test('live journey fails closed if either denial leaks protected material', async () => {
  const baseFetch = successfulFetch([]);
  await assert.rejects(
    verifyUnlimitedFeatureAccessLive({
      ...production,
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/examinations/query')) {
          return jsonResponse(401, {
            ok: false,
            error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in.' },
            questions: [{ id: 'must-not-leak' }],
          });
        }
        return baseFetch(input, init);
      },
    }),
    /must not expose protected questions/iu,
  );
});
