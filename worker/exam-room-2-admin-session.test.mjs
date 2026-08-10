import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const userId = '91000000-0000-4000-8000-000000000001';
const sessionId = '123e4567-e89b-42d3-a456-426614174010';
const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: 'https://exam-room-admin-session.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  EXAMINATION_ROOM_ENABLED: 'true',
  EXAMINATION_ROOM_2_ENABLED: 'true',
};

function unsignedJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

async function sessionSnapshot(claims) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (url.endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return Response.json({ authorized: true, role: 'super_admin', capabilities: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/session', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${unsignedJwt(claims)}`,
      },
      body: '{}',
    }), env);
    assert.equal(response.status, 200);
    return response.json();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Admin session exposes only a safe fresh-AAL2 Examination Room capability snapshot', async () => {
  const now = Math.floor(Date.now() / 1_000);
  const payload = await sessionSnapshot({
    aal: 'aal2',
    session_id: sessionId,
    iat: now,
    amr: [
      { method: 'oauth', timestamp: now - 90 },
      { method: 'totp', timestamp: now - 30 },
      { method: 'token_refresh', timestamp: now },
    ],
  });
  assert.deepEqual({
    featureEnabled: payload.examinationRoomBreakGlass.featureEnabled,
    adminAuthorized: payload.examinationRoomBreakGlass.adminAuthorized,
    authenticationLevel: payload.examinationRoomBreakGlass.authenticationLevel,
    freshAal2: payload.examinationRoomBreakGlass.freshAal2,
    canIssue: payload.examinationRoomBreakGlass.canIssue,
  }, {
    featureEnabled: true,
    adminAuthorized: true,
    authenticationLevel: 'aal2',
    freshAal2: true,
    canIssue: true,
  });
  assert.equal(JSON.stringify(payload).includes(sessionId), false);
  assert.equal(JSON.stringify(payload).includes('totp'), false);
  assert.match(payload.examinationRoomBreakGlass.stepUpExpiresAt, /^\d{4}-/);
});

test('a refreshed AAL2 JWT without a fresh supported MFA AMR event remains fail-closed', async () => {
  const now = Math.floor(Date.now() / 1_000);
  const payload = await sessionSnapshot({
    aal: 'aal2',
    session_id: sessionId,
    iat: now,
    amr: [
      { method: 'password', timestamp: now },
      { method: 'oauth', timestamp: now },
      { method: 'token_refresh', timestamp: now },
      { method: 'future_unknown_mfa', timestamp: now },
    ],
  });
  assert.equal(payload.examinationRoomBreakGlass.authenticationLevel, 'aal2');
  assert.equal(payload.examinationRoomBreakGlass.freshAal2, false);
  assert.equal(payload.examinationRoomBreakGlass.canIssue, false);
  assert.equal(payload.examinationRoomBreakGlass.stepUpExpiresAt, null);
});
