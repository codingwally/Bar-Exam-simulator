import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const userId = '11111111-1111-4111-8111-111111111111';
const entryId = 'qe_aaaaaaaaaaaaaaaaaaaa';
const postId = '22222222-2222-4222-8222-222222222222';

const productionWrangler = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const stagingWrangler = readFileSync(new URL('./wrangler.staging.toml', import.meta.url), 'utf8');

const baseEnv = Object.freeze({
  ALLOWED_ORIGIN: origin,
  REQUIRE_AUTHENTICATED_SUBMISSIONS: 'true',
  GUEST_USAGE_HMAC_KEY: 'test-report-rate-key-with-at-least-32-bytes',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
  REPORT_EMAIL_MODE: 'enabled',
  REPORT_EMAIL_FROM: 'Due Diligence Reports <examinations@duediligence.ph>',
  REPORT_EMAIL_TO: 'support@duediligence.ph',
  RESEND_API_KEY: 'test-only-resend-key',
});

function post(path, body, ip) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: 'Bearer valid-report-session',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

function authResponse(target) {
  if (target.endsWith('/auth/v1/user')) {
    return Response.json({ id: userId, email: 'member@example.invalid' });
  }
  return null;
}

test('production routes reports to Support while staging suppresses outbound mail', () => {
  assert.match(productionWrangler, /REPORT_EMAIL_MODE\s*=\s*"enabled"/);
  assert.match(productionWrangler, /REPORT_EMAIL_TO\s*=\s*"support@duediligence\.ph"/);
  assert.match(stagingWrangler, /REPORT_EMAIL_MODE\s*=\s*"suppressed"/);
  assert.match(stagingWrangler, /REPORT_EMAIL_TO\s*=\s*"support@duediligence\.ph"/);
});

test('Support requests are stored first, then Support receives a privacy-safe notification', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    calls.push({ target, init });
    if (target.endsWith('/rest/v1/support_requests')) {
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      return Response.json({ id: 'email_support_001' });
    }
    throw new Error(`Unexpected report fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const message = 'The sign-in screen returned after I had already completed Google authentication.';
  const response = await worker.fetch(post('/support', {
    category: 'technical',
    message,
    replyEmail: 'student@example.com',
  }, '203.0.113.201'), baseEnv, {});
  assert.equal(response.status, 201);
  assert.match((await response.json()).message, /received/i);
  assert.equal(calls[0].target.endsWith('/rest/v1/support_requests'), true);
  assert.equal(calls[1].target, 'https://api.resend.com/emails');

  const email = JSON.parse(calls[1].init.body);
  assert.deepEqual(email.to, ['support@duediligence.ph']);
  assert.equal(Object.hasOwn(email, 'reply_to'), false);
  assert.match(email.subject, /Support request — technical/);
  assert.match(email.text, /protected Support queue/);
  assert.doesNotMatch(email.text, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(email.text, /student@example\.com/);
  assert.doesNotMatch(email.text, new RegExp(userId));
});

test('Quorum reports notify Support without exposing reporter or reported content', async (t) => {
  const originalFetch = globalThis.fetch;
  let email = null;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    if (target.endsWith('/rest/v1/rpc/forum_quorum_command')) {
      return Response.json({ reportId: 'qf_report_test', status: 'pending' });
    }
    if (target === 'https://api.resend.com/emails') {
      email = JSON.parse(init.body);
      return Response.json({ id: 'email_quorum_001' });
    }
    throw new Error(`Unexpected Quorum report fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const privateExplanation = 'This explanation must remain only in the protected moderation queue.';
  const response = await worker.fetch(post('/quorum/command', {
    operation: 'create_report',
    payload: {
      targetType: 'entry',
      targetId: entryId,
      category: 'spam',
      explanation: privateExplanation,
    },
  }, '203.0.113.202'), baseEnv, {});
  assert.equal(response.status, 201);
  assert.deepEqual(email.to, ['support@duediligence.ph']);
  assert.match(email.text, /Category: spam/);
  assert.match(email.text, /Target type: entry/);
  assert.doesNotMatch(email.text, new RegExp(privateExplanation));
  assert.doesNotMatch(email.text, new RegExp(userId));
  assert.doesNotMatch(email.text, new RegExp(entryId));
});

test('legacy forum reports also notify Support without exposing protected details', async (t) => {
  const originalFetch = globalThis.fetch;
  let email = null;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    if (target.endsWith('/rest/v1/rpc/forum_create_report')) {
      return Response.json({ id: '33333333-3333-4333-8333-333333333333', status: 'pending' });
    }
    if (target === 'https://api.resend.com/emails') {
      email = JSON.parse(init.body);
      return Response.json({ id: 'email_legacy_forum_001' });
    }
    throw new Error(`Unexpected legacy forum report fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const privateExplanation = 'Keep this moderator-only explanation out of email.';
  const response = await worker.fetch(post('/forum/reports', {
    targetType: 'post',
    targetId: postId,
    category: 'misinformation',
    explanation: privateExplanation,
  }, '203.0.113.205'), baseEnv, {});
  assert.equal(response.status, 201);
  assert.deepEqual(email.to, ['support@duediligence.ph']);
  assert.match(email.text, /Category: misinformation/);
  assert.match(email.text, /Target type: post/);
  assert.doesNotMatch(email.text, new RegExp(privateExplanation));
  assert.doesNotMatch(email.text, new RegExp(userId));
  assert.doesNotMatch(email.text, new RegExp(postId));
});

test('failed Support storage never attempts an email notification', async (t) => {
  const originalFetch = globalThis.fetch;
  let outboundEmailCalls = 0;
  globalThis.fetch = async (input) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    if (target.endsWith('/rest/v1/support_requests')) {
      return Response.json({ message: 'storage unavailable' }, { status: 503 });
    }
    if (target === 'https://api.resend.com/emails') {
      outboundEmailCalls += 1;
      return Response.json({ id: 'unexpected' });
    }
    throw new Error(`Unexpected storage-failure fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(post('/support', {
    category: 'technical',
    message: 'This request must not be announced before it is stored.',
    replyEmail: '',
  }, '203.0.113.206'), baseEnv, {});
  assert.equal(response.status, 502);
  assert.equal(outboundEmailCalls, 0);
});

test('email-provider failure never loses an already stored Support request', async (t) => {
  const originalFetch = globalThis.fetch;
  let stored = false;
  globalThis.fetch = async (input) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    if (target.endsWith('/rest/v1/support_requests')) {
      stored = true;
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      return Response.json({ message: 'provider unavailable' }, { status: 503 });
    }
    throw new Error(`Unexpected failure-path fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(post('/support', {
    category: 'account',
    message: 'I need help understanding which Google account is attached to my profile.',
    replyEmail: '',
  }, '203.0.113.203'), baseEnv, {});
  assert.equal(stored, true);
  assert.equal(response.status, 201);
});

test('staging suppression stores the report without making an outbound email call', async (t) => {
  const originalFetch = globalThis.fetch;
  let outboundEmailCalls = 0;
  globalThis.fetch = async (input) => {
    const target = String(input);
    const auth = authResponse(target);
    if (auth) return auth;
    if (target.endsWith('/rest/v1/support_requests')) {
      return new Response(null, { status: 201 });
    }
    if (target === 'https://api.resend.com/emails') {
      outboundEmailCalls += 1;
      return Response.json({ id: 'unexpected' });
    }
    throw new Error(`Unexpected suppressed-path fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(post('/support', {
    category: 'other',
    message: 'This staging request should be stored without sending any external notification.',
    replyEmail: '',
  }, '203.0.113.204'), {
    ...baseEnv,
    REPORT_EMAIL_MODE: 'suppressed',
  }, {});
  assert.equal(response.status, 201);
  assert.equal(outboundEmailCalls, 0);
});
