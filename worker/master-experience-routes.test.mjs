import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const supabaseUrl = 'https://staging-test.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';
const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
};

function request(path, body, authorization = true) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.44',
      ...(authorization ? { Authorization: 'Bearer synthetic-user-access-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withFetchMock(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

function authResponse(url) {
  if (String(url).endsWith('/auth/v1/user')) {
    return Response.json({ id: userId, email: 'synthetic@example.com' });
  }
  return null;
}

test('private study annotation query binds the authenticated user server-side', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/study_annotation_query`);
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: userId,
      p_resource_type: 'subject_matter',
      p_resource_id: 'CIVPRO2-001',
    });
    return Response.json([{ resourceType: 'subject_matter', resourceId: 'CIVPRO2-001', revision: 3 }]);
  }, async () => {
    const response = await worker.fetch(request('/study/annotations/query', {
      resourceType: 'subject_matter', resourceId: 'CIVPRO2-001', userId: 'spoofed',
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.annotations[0].revision, 3);
  });
});

test('private study annotation command preserves revision-based conflict input', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/study_annotation_command`);
    const body = JSON.parse(options.body);
    assert.equal(body.p_user_id, userId);
    assert.equal(body.p_operation, 'save');
    assert.deepEqual(body.p_payload, {
      resourceType: 'doctrine', resourceId: 'stare-decisis',
      noteText: 'Compare the controlling facts.', selectedText: null,
      expectedRevision: 4,
    });
    return Response.json({ conflict: false, revision: 5 });
  }, async () => {
    const response = await worker.fetch(request('/study/annotations/command', {
      operation: 'save', resourceType: 'doctrine', resourceId: 'stare-decisis',
      noteText: 'Compare the controlling facts.', expectedRevision: 4,
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.revision, 5);
  });
});

test('study annotation routes reject unauthenticated access before database RPC', async () => {
  let rpcCalled = false;
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ message: 'invalid token' }, { status: 401 });
    rpcCalled = true;
    return Response.json({});
  }, async () => {
    const response = await worker.fetch(request('/study/annotations/query', {
      resourceType: 'doctrine', resourceId: 'stare-decisis',
    }, false), env);
    assert.equal(response.status, 401);
    assert.equal(rpcCalled, false);
  });
});
