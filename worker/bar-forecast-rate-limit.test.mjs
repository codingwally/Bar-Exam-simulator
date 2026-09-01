import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';

const ORIGIN = 'https://duediligence.ph';
const ENV = Object.freeze({
  ALLOWED_ORIGIN: ORIGIN,
  GUEST_USAGE_HMAC_KEY: 'bar-forecast-rate-limit-contract-key',
});
const AUTH_ENV = Object.freeze({
  ...ENV,
  SUPABASE_SERVICE_ROLE_KEY: 'bar-forecast-rate-limit-test-service-role',
  SUPABASE_URL: 'https://test.supabase.co',
});

function request(pathname, ip, token = '') {
  return new Request(`${ORIGIN}${pathname}`, {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': ip,
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ operation: 'status' }),
  });
}

async function responseCode(response) {
  return (await response.json())?.error?.code || '';
}

test('Forecast enforces a separate 180-request signed-out network ceiling', async () => {
  const originalDateNow = Date.now;
  const startedAt = Date.parse('2026-09-01T00:00:00.000Z');
  let now = startedAt;
  Date.now = () => now;
  try {
    const forecastIp = '203.0.113.10';
    for (let count = 1; count <= 180; count += 1) {
      const response = await worker.fetch(
        request('/admin/dd2026/bar-forecast', forecastIp),
        ENV,
        {},
      );
      assert.equal(response.status, 401, `Forecast request ${count} must pass its rate limiter.`);
    }

    const forecastLimited = await worker.fetch(
      request('/admin/dd2026/bar-forecast', forecastIp),
      ENV,
      {},
    );
    assert.equal(forecastLimited.status, 429);
    assert.equal(await responseCode(forecastLimited), 'RATE_LIMITED');
    assert.equal(forecastLimited.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.equal(forecastLimited.headers.get('Pragma'), 'no-cache');

    const genericAfterForecastLimit = await worker.fetch(
      request('/admin/session', forecastIp),
      ENV,
      {},
    );
    assert.equal(genericAfterForecastLimit.status, 401, 'Forecast exhaustion must not consume generic admin capacity.');

    now = startedAt + (10 * 60 * 1000) - 1;
    const immediatelyBeforeBoundary = await worker.fetch(
      request('/admin/dd2026/bar-forecast', forecastIp),
      ENV,
      {},
    );
    assert.equal(immediatelyBeforeBoundary.status, 429, 'Forecast capacity must remain exhausted at 9:59.999.');
    assert.equal(await responseCode(immediatelyBeforeBoundary), 'RATE_LIMITED');

    now = startedAt + (10 * 60 * 1000);
    const exactBoundaryReset = await worker.fetch(
      request('/admin/dd2026/bar-forecast', forecastIp),
      ENV,
      {},
    );
    assert.equal(exactBoundaryReset.status, 401, 'Forecast capacity must reset at exactly ten minutes.');

    const genericIp = '203.0.113.11';
    for (let count = 1; count <= 90; count += 1) {
      const response = await worker.fetch(request('/admin/session', genericIp), ENV, {});
      assert.equal(response.status, 401, `Generic admin request ${count} must pass its rate limiter.`);
    }
    const genericLimited = await worker.fetch(request('/admin/session', genericIp), ENV, {});
    assert.equal(genericLimited.status, 429);
    assert.equal(await responseCode(genericLimited), 'RATE_LIMITED');

    const forecastAfterGenericLimit = await worker.fetch(
      request('/admin/dd2026/bar-forecast', genericIp),
      ENV,
      {},
    );
    assert.equal(forecastAfterGenericLimit.status, 401, 'Generic admin exhaustion must not consume Forecast capacity.');
  } finally {
    Date.now = originalDateNow;
  }
});

test('Forecast enforces 30 requests per verified user across networks without consuming another user capacity', async () => {
  const originalDateNow = Date.now;
  const originalFetch = globalThis.fetch;
  const startedAt = Date.parse('2026-09-01T01:00:00.000Z');
  const firstUserId = '11111111-1111-4111-8111-111111111111';
  const secondUserId = '22222222-2222-4222-8222-222222222222';
  const tokenUsers = new Map([
    ['Bearer first-user-token', firstUserId],
    ['Bearer second-user-token', secondUserId],
  ]);
  Date.now = () => startedAt;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      const userId = tokenUsers.get(new Headers(init.headers).get('Authorization'));
      assert.ok(userId, 'The limiter test sent an unexpected bearer token for verification.');
      return Response.json({ id: userId });
    }
    if (target.endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return Response.json({ authorized: true, role: 'admin' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json({
        allowed: true,
        unlimited: true,
        role: 'admin',
        basis: 'introductory_tokens',
        termsRequired: false,
        reauthenticationRequired: false,
        profileCompleted: true,
        tokenAcknowledgementRequired: false,
        paidSubscriptionExpired: false,
        commercialLaunchEnabled: true,
      });
    }
    if (target.endsWith('/rest/v1/rpc/dd2026_bar_forecast_consent_status')) {
      return Response.json({ consentAccepted: false });
    }
    throw new Error(`Unexpected Forecast limiter test request: ${target}`);
  };

  try {
    const forecastIp = '203.0.113.12';
    for (let count = 1; count <= 30; count += 1) {
      const response = await worker.fetch(
        request('/admin/dd2026/bar-forecast', forecastIp, 'first-user-token'),
        AUTH_ENV,
        {},
      );
      assert.equal(response.status, 200, `Verified-user request ${count} must pass its rate limiter.`);
    }

    const firstUserLimited = await worker.fetch(
      request('/admin/dd2026/bar-forecast', '203.0.113.13', 'first-user-token'),
      AUTH_ENV,
      {},
    );
    assert.equal(firstUserLimited.status, 429, 'The verified user must be limited on request 31.');
    assert.equal(await responseCode(firstUserLimited), 'RATE_LIMITED');

    const secondUserStillAvailable = await worker.fetch(
      request('/admin/dd2026/bar-forecast', forecastIp, 'second-user-token'),
      AUTH_ENV,
      {},
    );
    assert.equal(
      secondUserStillAvailable.status,
      200,
      'One verified user exhausting capacity must not consume another verified user capacity.',
    );
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});
