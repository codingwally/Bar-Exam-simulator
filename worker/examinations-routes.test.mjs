import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const supabaseUrl = 'https://staging-test.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';

const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
};
let requestCounter = 0;

function request(path, body, authorization = true) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `192.0.2.${++requestCounter}`,
      ...(authorization ? { Authorization: 'Bearer synthetic-user-access-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withFetchMock(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function authResponse(url) {
  if (String(url).endsWith('/auth/v1/user')) {
    return Response.json({ id: userId, email: 'synthetic@example.com' });
  }
  return null;
}

test('authenticated examination catalog reaches only the allowlisted RPC', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    if (String(url) === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.equal(payload.p_user_id, userId);
      assert.equal(payload.p_track, 'per_subject');
      assert.equal(payload.p_version_id, null);
      assert.equal(payload.p_attempt_id, null);
      assert.equal(payload.p_allow_historical, false);
      return Response.json({ allowed: true, basis: 'standard_access' });
    }
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_query`);
    assert.equal(payload.p_user_id, userId);
    assert.equal(payload.p_operation, 'catalog');
    assert.equal(payload.p_payload.track, 'per_subject');
    return Response.json({ betaAccess: true, items: [] });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'per_subject',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.items, []);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  });
});

test('examination query rejects a missing authenticated session before database access', async () => {
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return Response.json({ message: 'invalid token' }, { status: 401 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'per_subject',
    }, false), env);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'AUTHENTICATION_REQUIRED');
  });
});

test('start attempt preserves server response and returns HTTP 201', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    const payload = JSON.parse(options.body);
    if (String(url) === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.equal(payload.p_user_id, userId);
      assert.equal(payload.p_track, null);
      assert.equal(payload.p_version_id, versionId);
      assert.equal(payload.p_attempt_id, null);
      assert.equal(payload.p_allow_historical, false);
      return Response.json({ allowed: true, basis: 'standard_access' });
    }
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_command`);
    assert.equal(payload.p_operation, 'start_attempt');
    assert.equal(payload.p_payload.versionId, versionId);
    return Response.json({
      attempt: {
        attemptId,
        versionId,
        status: 'in_progress',
        timerMode: 'strict',
        remainingSeconds: 3600,
      },
      examination: { track: 'per_subject', questionCount: 1 },
      questions: [],
      resumed: false,
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'start_attempt',
      versionId,
      timerMode: 'strict',
      requestKey: 'start_1234567890abcdef',
      tabToken: 'tab-token-1234567890abcdef1234567890abcdef',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data.attempt.attemptId, attemptId);
    assert.equal(body.data.attempt.remainingSeconds, 3600);
  });
});

test('secure examiner assignment query does not require a student bearer token', async () => {
  await withFetchMock(async (url, options) => {
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_query`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.p_user_id, null);
    assert.equal(payload.p_operation, 'assignment');
    return Response.json({
      assignment: { assignmentId: 'ASSIGNMENT-TEST', status: 'pending' },
      questions: [],
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'assignment',
      assignmentToken: 'assignment-token-1234567890abcdef1234567890abcdef',
    }, false), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.assignment.status, 'pending');
  });
});

test('database access denials return safe HTTP 403 without SQL details', async () => {
  await withFetchMock(async (url) => {
    const auth = authResponse(url);
    if (auth) return auth;
    return Response.json({
      code: 'P0001',
      message: 'EXAM_BETA_ACCESS_REQUIRED: internal table detail must stay private',
    }, { status: 400 });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'bar_feels',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'EXAM_BETA_ACCESS_REQUIRED');
    assert.doesNotMatch(body.error.message, /internal table detail/i);
  });
});
