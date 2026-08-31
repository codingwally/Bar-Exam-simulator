import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyAdminBarForecastDeployment } from './verify-admin-bar-forecast-deployment.mjs';

const STAGING_URL = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      pragma: 'no-cache',
      ...headers,
    },
  });
}

function happyFetch(calls) {
  return async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (init.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': STAGING_URL,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type',
        },
      });
    }
    if (init.headers?.Origin === 'https://not-duediligence.invalid') {
      return jsonResponse(403, {
        ok: false,
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This grading origin is not allowed.' },
      }, {
        'access-control-allow-origin': STAGING_URL,
        'x-content-type-options': 'nosniff',
      });
    }
    return jsonResponse(401, {
      ok: false,
      error: { code: 'ADMIN_SIGN_IN_REQUIRED', message: 'Administrator sign-in is required.' },
    }, {
      'access-control-allow-origin': STAGING_URL,
      'x-content-type-options': 'nosniff',
    });
  };
}

test('live Forecast smoke proves CORS, signed-out denial, foreign-origin denial, and no content leak', async () => {
  const calls = [];
  const result = await verifyAdminBarForecastDeployment({
    workerUrl: STAGING_URL,
    allowedOrigin: STAGING_URL,
    fetchImpl: happyFetch(calls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.boundary, 'admin-only');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ init }) => init.method), ['OPTIONS', 'POST', 'POST']);
});

test('live Forecast smoke fails closed if a signed-out response leaks Forecast questions', async () => {
  const fetchImpl = happyFetch([]);
  let call = 0;
  await assert.rejects(
    verifyAdminBarForecastDeployment({
      workerUrl: STAGING_URL,
      allowedOrigin: STAGING_URL,
      fetchImpl: async (...args) => {
        call += 1;
        if (call !== 2) return fetchImpl(...args);
        return jsonResponse(401, {
          ok: false,
          error: { code: 'ADMIN_SIGN_IN_REQUIRED' },
          questions: [{ id: 'must-not-leak' }],
        }, {
          'access-control-allow-origin': STAGING_URL,
          'x-content-type-options': 'nosniff',
        });
      },
    }),
    /must not expose protected content/iu,
  );
});

test('live Forecast smoke fails closed on any unexpected denial-response field', async () => {
  const fetchImpl = happyFetch([]);
  let call = 0;
  await assert.rejects(
    verifyAdminBarForecastDeployment({
      workerUrl: STAGING_URL,
      allowedOrigin: STAGING_URL,
      fetchImpl: async (...args) => {
        call += 1;
        if (call !== 2) return fetchImpl(...args);
        return jsonResponse(401, {
          ok: false,
          error: {
            code: 'ADMIN_SIGN_IN_REQUIRED',
            message: 'Administrator sign-in is required.',
          },
          requestMetadata: 'must-not-be-added',
        }, {
          'access-control-allow-origin': STAGING_URL,
          'x-content-type-options': 'nosniff',
        });
      },
    }),
  );
});

test('live Forecast smoke refuses an unapproved target pair before making a request', async () => {
  let called = false;
  await assert.rejects(
    verifyAdminBarForecastDeployment({
      workerUrl: 'https://example.invalid',
      allowedOrigin: STAGING_URL,
      fetchImpl: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    }),
    /restricted to the approved staging or production pair/iu,
  );
  assert.equal(called, false);
});
