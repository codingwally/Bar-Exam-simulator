import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const userId = 'b3000000-0000-4000-8000-000000000001';
const attemptId = 'b3000000-0000-4000-8000-000000000002';

function env() {
  return {
    ALLOWED_ORIGIN: origin,
    PHASE4_ACCESS_ENFORCEMENT: 'true',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    GEMINI_API_KEY: 'test-gemini-key',
  };
}

function request(path, body) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: 'Bearer verified-session',
      'Content-Type': 'application/json',
      'X-Request-ID': 'release3_timer_request_0001',
    },
    body: JSON.stringify(body),
  });
}

function access() {
  return {
    allowed: true,
    basis: 'free_beta',
    termsRequired: false,
    role: 'student',
    trial: null,
    freeGrades: { limit: 3, used: 0, remaining: 3 },
    freeBeta: { enabled: true, active: true, expiresAt: null },
    subscription: null,
  };
}

test('blank Strict expiration records unanswered without Gemini or grade reservation', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      calls.push('access');
      return Response.json(access());
    }
    if (target.endsWith('/rest/v1/rpc/phase4_record_unanswered_attempt')) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_question_bank_id, 'LAB-001');
      assert.equal(payload.p_elapsed_seconds, 720);
      calls.push('unanswered');
      return Response.json({ attemptId, status: 'unanswered', replayed: false });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(request('/exam/unanswered', {
      questionId: 'LAB-001',
      subject: 'Labor Law',
      elapsedSeconds: 720,
      requestId: 'release3_blank_expiry_0001',
    }), env());
    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.equal(payload.attempt.status, 'unanswered');
    assert.equal(payload.attempt.expired, true);
    assert.deepEqual(calls, ['access', 'unanswered']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('history endpoint returns only the authenticated user RPC result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_exam_history')) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_user_id, userId);
      assert.equal(payload.p_limit, 25);
      return Response.json({
        items: [{
          id: attemptId,
          questionId: 'LAB-001',
          status: 'unanswered',
          answerText: '',
        }],
        limit: 25,
        offset: 0,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(request('/exam/history', {
      limit: 25,
      offset: 0,
    }), env());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.history.items[0].id, attemptId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unanswered endpoint rejects an early or forged expiration', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await worker.fetch(request('/exam/unanswered', {
      questionId: 'LAB-001',
      subject: 'Labor Law',
      elapsedSeconds: 719,
      requestId: 'release3_early_expiry_0002',
    }), env());
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'INVALID_TIMER_STATE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
