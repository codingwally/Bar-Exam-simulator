import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const supabaseUrl = 'https://support-routing-test.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';
const postId = '22222222-2222-4222-8222-222222222222';
const entryId = 'qe_aaaaaaaaaaaaaaaaaaaa';

const baseEnv = Object.freeze({
  ALLOWED_ORIGIN: origin,
  OUTBOUND_EMAIL_MODE: 'enabled',
  PRIVATE_BETA_GATE_ENABLED: 'false',
  REQUIRE_AUTHENTICATED_SUBMISSIONS: 'true',
  GUEST_USAGE_HMAC_KEY: 'test-only-support-rate-key',
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
  SUPPORT_NOTIFICATION_EMAIL_MODE: 'enabled',
  SUPPORT_NOTIFICATION_EMAIL_FROM: 'Due Diligence Support <support@duediligence.ph>',
  RESEND_API_KEY: 'test-only-resend-key',
});

function authenticatedRequest(path, body, ip) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: 'Bearer verified-support-session',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

function verifiedUserResponse() {
  return Response.json({ id: userId, email: 'member@example.com' });
}

function assertSupportEmail(request) {
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer test-only-resend-key');
  assert.deepEqual(request.body.to, ['support@duediligence.ph']);
  assert.equal(
    request.body.from,
    'Due Diligence Support <support@duediligence.ph>',
  );
  assert.match(request.body.text, /authorized review/i);
  assert.equal(request.body.reply_to, 'member@example.com');
}

test('Support requests are stored before an email is sent only to support@duediligence.ph', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return verifiedUserResponse();
    if (target === `${supabaseUrl}/rest/v1/support_requests`) {
      calls.push({ kind: 'storage', body: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      calls.push({ kind: 'email', url: target, init, body: JSON.parse(init.body) });
      return Response.json({ id: 'email_support_1' });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(authenticatedRequest('/support', {
      category: 'technical',
      message: 'The signed-in page remains stuck after I submit the support form.',
      replyEmail: 'member@example.com',
    }, '192.0.2.11'), baseEnv);
    assert.equal(response.status, 201);
    assert.deepEqual(calls.map((call) => call.kind), ['storage', 'email']);
    assertSupportEmail(calls[1]);
    assert.equal(calls[1].body.subject, 'Due Diligence Support request');
    assert.match(calls[1].body.text, /signed-in page remains stuck/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Answer-correction reports are stored before an email is sent only to support@duediligence.ph', async () => {
  const originalFetch = globalThis.fetch;
  const bankUrl = `${origin}/content/question-bank/support-routing-test.json`;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return verifiedUserResponse();
    if (target === bankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => ({
          'Question ID': index === 0 ? 'CIV-2024-Q01' : `TEST-${String(index).padStart(3, '0')}`,
          Subject: 'Civil Law',
          'Essay Question': index === 0 ? 'Was the contract valid?' : `Question ${index}`,
          'Suggested Answer': 'No. The contract was void.',
          'Legal Basis / Provision': 'Civil Code, Article 1409',
          'Source URL': 'https://elibrary.judiciary.gov.ph/',
        })),
      });
    }
    if (target === `${supabaseUrl}/rest/v1/question_corrections`) {
      calls.push({ kind: 'storage', body: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      calls.push({ kind: 'email', url: target, init, body: JSON.parse(init.body) });
      return Response.json({ id: 'email_correction_1' });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(authenticatedRequest('/corrections', {
      questionId: 'CIV-2024-Q01',
      subject: 'Civil Law',
      correctionType: 'suggested_answer',
      proposedCorrection: 'The suggested answer should identify absolute simulation.',
      explanation: 'Article 1409 more precisely supports the stated conclusion.',
      sourceUrls: ['https://elibrary.judiciary.gov.ph/'],
    }, '192.0.2.12'), { ...baseEnv, WEBSITE_BANK_URL: bankUrl });
    assert.equal(response.status, 201);
    assert.deepEqual(calls.map((call) => call.kind), ['storage', 'email']);
    assertSupportEmail(calls[1]);
    assert.equal(calls[1].body.subject, 'Due Diligence answer correction report');
    assert.match(calls[1].body.text, /CIV-2024-Q01/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Legacy and current Quorum report routes email only support@duediligence.ph', async () => {
  const originalFetch = globalThis.fetch;
  const emailCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return verifiedUserResponse();
    if (target.endsWith('/rest/v1/rpc/forum_create_report')) {
      return Response.json({ id: '33333333-3333-4333-8333-333333333333' });
    }
    if (target.endsWith('/rest/v1/rpc/forum_quorum_command_v2')) {
      return Response.json({ reportId: 'qx_bbbbbbbbbbbbbbbbbbbb' });
    }
    if (target === 'https://api.resend.com/emails') {
      emailCalls.push({ url: target, init, body: JSON.parse(init.body) });
      return Response.json({ id: `email_quorum_${emailCalls.length}` });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const legacyResponse = await worker.fetch(authenticatedRequest('/forum/reports', {
      targetType: 'post',
      targetId: postId,
      category: 'misinformation',
      explanation: 'The cited rule appears inaccurate and should be reviewed.',
    }, '192.0.2.13'), baseEnv);
    assert.equal(legacyResponse.status, 201);

    const quorumResponse = await worker.fetch(authenticatedRequest('/quorum/command', {
      operation: 'create_report',
      payload: {
        targetType: 'entry',
        targetId: entryId,
        category: 'misinformation',
        explanation: 'The legal claim appears inaccurate and should be reviewed.',
      },
    }, '192.0.2.14'), baseEnv);
    assert.equal(quorumResponse.status, 201);

    assert.equal(emailCalls.length, 2);
    for (const emailCall of emailCalls) {
      assertSupportEmail(emailCall);
      assert.equal(emailCall.body.subject, 'Due Diligence Community report');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A transient email-provider failure does not discard a stored Support request', async () => {
  const originalFetch = globalThis.fetch;
  let stored = false;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return verifiedUserResponse();
    if (target === `${supabaseUrl}/rest/v1/support_requests`) {
      stored = true;
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      return Response.json({ message: 'temporary provider failure' }, { status: 503 });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(authenticatedRequest('/support', {
      category: 'account',
      message: 'My account page remains unavailable after I sign in successfully.',
      replyEmail: 'member@example.com',
    }, '192.0.2.15'), baseEnv);
    const payload = await response.json();
    assert.equal(stored, true);
    assert.equal(response.status, 201);
    assert.equal(payload.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
