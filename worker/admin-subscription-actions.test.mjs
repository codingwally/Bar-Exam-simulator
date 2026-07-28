import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  normalizePhase4AdminAction,
  PaymentValidationError,
} from './payment-core.mjs';

const origin = 'https://duediligence.ph';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const subscriptionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env = Object.freeze({
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-placeholder',
});

function actionPayload(overrides = {}) {
  return {
    action: 'subscription_change',
    targetId,
    payload: {
      operation: 'replace_plan',
      userId: targetId,
      subscriptionId,
      planCode: 'standard',
      displayName: '<script>untrusted</script>',
      pricePhp: 1,
    },
    reason: 'Verified synthetic administrator test.',
    requestKey: 'admin_subscription_test_0001',
    ...overrides,
  };
}

function actionRequest(body, token = 'verified-admin-token', ip = '203.0.113.171') {
  const headers = {
    Origin: origin,
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://worker.example/admin/phase4-action', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('subscription action normalization strips presentation fields and client prices', () => {
  const normalized = normalizePhase4AdminAction(actionPayload());
  assert.deepEqual(normalized.payload, {
    operation: 'replace_plan',
    userId: targetId,
    subscriptionId,
    planCode: 'standard',
    durationDays: null,
    startsAt: null,
    expiresAt: null,
  });
  assert.equal('pricePhp' in normalized.payload, false);
  assert.equal('displayName' in normalized.payload, false);
});

test('Premium and cross-user subscription mutations are rejected before storage', () => {
  assert.throws(
    () => normalizePhase4AdminAction(actionPayload({
      payload: {
        operation: 'replace_plan',
        userId: targetId,
        subscriptionId,
        planCode: 'premium',
      },
    })),
    (error) => error instanceof PaymentValidationError && error.code === 'PLAN_UNAVAILABLE',
  );
  assert.throws(
    () => normalizePhase4AdminAction(actionPayload({
      payload: {
        operation: 'replace_plan',
        userId: actorId,
        subscriptionId,
        planCode: 'standard',
      },
    })),
    PaymentValidationError,
  );
});

test('authenticated founder action uses the dedicated transactional RPC', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: actorId });
    if (target.endsWith('/rest/v1/rpc/phase4_admin_manage_access')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_actor_user_id, actorId);
      assert.equal(body.p_target_user_id, targetId);
      assert.equal(body.p_subscription_id, subscriptionId);
      assert.equal(body.p_payload.planCode, 'standard');
      assert.equal('pricePhp' in body.p_payload, false);
      return Response.json({
        ok: true,
        action: 'subscription_change',
        targetUserId: targetId,
        replayed: false,
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const response = await worker.fetch(actionRequest(actionPayload()), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(calls.filter((url) => url.includes('phase4_admin_manage_access')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('student and anonymous callers receive backend authorization denials', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: actorId });
    if (target.endsWith('/rest/v1/rpc/phase4_admin_manage_access')) {
      return Response.json(
        { message: 'Founder administrator authorization required' },
        { status: 400 },
      );
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const studentResponse = await worker.fetch(
      actionRequest(actionPayload(), 'verified-student-token', '203.0.113.172'),
      env,
    );
    const studentPayload = await studentResponse.json();
    assert.equal(studentResponse.status, 403);
    assert.equal(studentPayload.error.code, 'ADMIN_FORBIDDEN');

    const anonymousResponse = await worker.fetch(
      actionRequest(actionPayload(), null, '203.0.113.173'),
      env,
    );
    const anonymousPayload = await anonymousResponse.json();
    assert.equal(anonymousResponse.status, 401);
    assert.equal(anonymousPayload.error.code, 'ADMIN_SIGN_IN_REQUIRED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('audit-history control uses the audited founder-only history RPC', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: actorId });
    if (target.endsWith('/rest/v1/rpc/phase4_admin_subscription_audit')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_target_user_id, targetId);
      assert.equal(body.p_reason, 'Reviewing the verified access history.');
      return Response.json({
        targetUserId: targetId,
        subscriptionHistory: [],
        freeBetaHistory: [],
        discountHistory: [],
        auditHistory: [],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const response = await worker.fetch(actionRequest({
      action: 'subscription_audit_view',
      targetId,
      payload: { ignored: true },
      reason: 'Reviewing the verified access history.',
      requestKey: 'admin_subscription_audit_0002',
    }, 'verified-founder-token', '203.0.113.174'), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.targetUserId, targetId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
