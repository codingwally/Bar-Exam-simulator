import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';

const ORIGIN = 'https://duediligence.ph';
const ENV = Object.freeze({
  ALLOWED_ORIGIN: ORIGIN,
  GUEST_USAGE_HMAC_KEY: 'bar-forecast-rate-limit-contract-key',
});

function request(pathname, ip) {
  return new Request(`${ORIGIN}${pathname}`, {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': ip,
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    },
    body: JSON.stringify({ operation: 'status' }),
  });
}

async function responseCode(response) {
  return (await response.json())?.error?.code || '';
}

test('Forecast enforces 90 per ten minutes and remains isolated from generic admin traffic', async () => {
  const originalDateNow = Date.now;
  const startedAt = Date.parse('2026-09-01T00:00:00.000Z');
  let now = startedAt;
  Date.now = () => now;
  try {
    const forecastIp = '203.0.113.10';
    for (let count = 1; count <= 90; count += 1) {
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
