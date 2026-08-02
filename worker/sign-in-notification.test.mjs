import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import worker from './index.mjs';

const originalFetch = globalThis.fetch;

function jwtForSession(sessionId, issuedAt = 1785632400) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: sessionId,
    iat: issuedAt,
  })}.signature`;
}

function signInRequest(sessionId) {
  const request = new Request('https://worker.example/auth/sign-in-notification', {
    method: 'POST',
    headers: {
      Origin: 'https://duediligence.ph',
      Authorization: `Bearer ${jwtForSession(sessionId)}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'en-PH,en;q=0.9',
      'Sec-CH-UA-Mobile': '?1',
    },
    body: '{}',
  });
  Object.defineProperty(request, 'cf', {
    value: { city: 'Manila', region: 'Metro Manila', country: 'PH' },
  });
  return request;
}

const env = {
  ALLOWED_ORIGIN: 'https://duediligence.ph',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  RESEND_API_KEY: 'test-resend-key',
  SIGN_IN_NOTIFICATION_EMAIL_MODE: 'enabled',
  SIGN_IN_NOTIFICATION_EMAIL_FROM: 'Due Diligence Sign-in Notice <support@duediligence.ph>',
  ADMIN_DIRECTORY_RECIPIENTS_JSON: JSON.stringify({
    wally: 'wallyesteban1993@gmail.com',
  }),
  PRIVATE_BETA_GATE_ENABLED: 'true',
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('successful sign-in emails only the approved owner with privacy-safe details', async () => {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://project.supabase.co/auth/v1/user') {
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'student@example.com',
        created_at: '2026-08-02T01:00:00.000Z',
        user_metadata: { full_name: 'Student One' },
        app_metadata: { provider: 'google' },
      });
    }
    if (url === 'https://api.resend.com/emails') {
      calls.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return Response.json({ id: 'email_sign_in_1' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const response = await worker.fetch(
    signInRequest('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    env,
    {},
  );
  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.to, ['wallyesteban1993@gmail.com']);
  assert.equal(calls[0].body.subject, 'Due Diligence user sign-in');
  assert.match(calls[0].headers.get('Idempotency-Key'), /^sign-in-[a-f0-9]{64}$/);
  assert.match(calls[0].body.text, /Name: Student One/);
  assert.match(calls[0].body.text, /Email: student@example\.com/);
  assert.match(calls[0].body.text, /Device type: Mobile phone/);
  assert.match(calls[0].body.text, /Browser: Safari 18/);
  assert.match(calls[0].body.text, /Operating system: iOS or iPadOS/);
  assert.match(calls[0].body.text, /Approximate location: Metro Manila, PH/);
  assert.doesNotMatch(calls[0].body.text, /Approximate location: Manila,/);
  assert.doesNotMatch(calls[0].body.text, /test-resend-key|test-service-role|signature/);
  assert.doesNotMatch(calls[0].body.text, /CF-Connecting-IP|\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});

test('one verified authentication session sends at most one notification per Worker isolate', async () => {
  let emailCount = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://project.supabase.co/auth/v1/user') {
      return Response.json({
        id: '22222222-2222-4222-8222-222222222222',
        email: 'returning@example.com',
        created_at: '2026-07-01T00:00:00.000Z',
      });
    }
    if (url === 'https://api.resend.com/emails') {
      emailCount += 1;
      return Response.json({ id: 'email_sign_in_deduped' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const first = await worker.fetch(signInRequest(sessionId), env, {});
  const second = await worker.fetch(signInRequest(sessionId), env, {});
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(emailCount, 1);
  assert.equal((await second.json()).notification, 'already_processed');
});

test('notification delivery failure never changes the successful sign-in session', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://project.supabase.co/auth/v1/user') {
      return Response.json({
        id: '33333333-3333-4333-8333-333333333333',
        email: 'student@example.com',
      });
    }
    if (url === 'https://api.resend.com/emails') {
      return Response.json({ message: 'temporary failure' }, { status: 503 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const response = await worker.fetch(
    signInRequest('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    env,
    {},
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, notification: 'failed' });
});

test('browser calls the notification only on an OAuth return and ignores delivery errors', async () => {
  const source = await readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
  assert.match(source, /query\.get\('auth'\) === 'callback' \|\| query\.has\('code'\)/);
  assert.match(source, /\/auth\/sign-in-notification/);
  assert.match(source, /state\.signInNotificationAttempted = true/);
  assert.match(source, /keepalive: true/);
  assert.match(source, /must never interrupt user authentication/);
  assert.match(source, /catch \{\s*\/\/ Owner notification is best-effort and must never interrupt user authentication\./);
});
