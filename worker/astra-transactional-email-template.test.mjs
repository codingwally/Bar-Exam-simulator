import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import worker, { sendSecureNotification } from './index.mjs';
import { paymentEmailText, sendPaymentVerificationEmail } from './commercial-entry.mjs';
import { escapeTransactionalEmailHtml, renderTransactionalEmailHtml } from './transactional-email-template.mjs';

const originalFetch = globalThis.fetch;
const origin = 'https://duediligence.ph';
const userId = '91000000-0000-4000-8000-000000000001';
const hostileName = '<img src=x onerror="alert(1)"> & Synthetic Reviewer';
const captured = [];
const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: 'https://astra-email-render.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  GUEST_USAGE_HMAC_KEY: 'synthetic-email-rate-limit',
  OUTBOUND_EMAIL_MODE: 'enabled',
  PRIVATE_BETA_GATE_ENABLED: 'false',
  RESEND_API_KEY: 'synthetic-resend-key',
  SUPPORT_NOTIFICATION_EMAIL_MODE: 'enabled',
  SUPPORT_NOTIFICATION_EMAIL_FROM: 'Due Diligence Support <support@duediligence.ph>',
  SIGN_IN_NOTIFICATION_EMAIL_MODE: 'enabled',
  ADMIN_DIRECTORY_EMAIL_MODE: 'enabled',
  ADMIN_DIRECTORY_EMAIL_FROM: 'Due Diligence <reports@duediligence.ph>',
  ADMIN_DIRECTORY_RECIPIENTS_JSON: JSON.stringify({ wally: 'owner@example.invalid', gilmar: 'founder@example.invalid' }),
};

function request(path, body = {}, token = 'synthetic-normal-session') {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.231' },
    body: JSON.stringify(body),
  });
}

function mockTransport(extra = () => null) {
  const emails = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, email: 'member@example.invalid', created_at: '2026-01-01T00:00:00Z', user_metadata: { full_name: hostileName } });
    if (url === 'https://api.resend.com/emails') {
      emails.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return Response.json({ id: 'synthetic-email-only' });
    }
    const result = extra(url, init);
    assert.ok(result, `Unexpected request (never sent): ${url}`);
    return result;
  };
  return emails;
}

function assertBranded(message) {
  assert.match(message.html, /<!doctype html>/);
  assert.match(message.html, /https:\/\/duediligence\.ph\/assets\/brand\/logo1-master\.png/);
  assert.match(message.html, /#002147/);
  assert.match(message.html, /#c5a059/);
  assert.match(message.html, /#fffdf8/);
  assert.match(message.html, /name="viewport"/);
  assert.doesNotMatch(message.html, /<script|<form|<iframe|<img src=x|javascript:/i);
  assert.doesNotMatch(message.html, /synthetic-service-role|synthetic-resend-key/);
}

test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(async () => {
  // Optional private render artifacts contain synthetic fixtures only. No sends.
  if (!process.env.ASTRA_EMAIL_RENDER_DIRECTORY) return;
  await mkdir(process.env.ASTRA_EMAIL_RENDER_DIRECTORY, { recursive: true });
  for (const sample of captured) {
    await writeFile(join(process.env.ASTRA_EMAIL_RENDER_DIRECTORY, `${sample.name}.html`), sample.message.html);
    await writeFile(join(process.env.ASTRA_EMAIL_RENDER_DIRECTORY, `${sample.name}.txt`), sample.message.text);
  }
});

test('renderer escapes every untrusted field and never auto-links message text', () => {
  assert.equal(escapeTransactionalEmailHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  const html = renderTransactionalEmailHtml({ heading: hostileName, text: `${hostileName}\nhttps://attacker.invalid/?secret=1`, adminPath: '/admin/' });
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp;/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/duediligence\.ph\/admin\/"/);
  assert.doesNotMatch(html, /href="https:\/\/attacker/);
});

test('only exact existing protected review routes become clickable', () => {
  for (const path of ['//attacker.invalid', 'https://attacker.invalid', '/admin/?redirect=https://attacker.invalid', '/admin/../logout', '/admin/%2e%2e/logout', '/admin/payments?request=x', '/admin/\n', '/admin/" onclick="bad']) {
    assert.doesNotMatch(renderTransactionalEmailHtml({ text: 'Internal', adminPath: path }), /<a /, path);
  }
  assert.match(renderTransactionalEmailHtml({ text: 'Proof', adminPath: `/admin/payments?request=${userId}` }), /Open authorized review/);
});

test('proof HTML preserves canonical plaintext, all five verifiers, original attachment and dedupe', async () => {
  const emails = mockTransport();
  const proof = { bytes: new TextEncoder().encode('synthetic-proof-only'), hash: 'a'.repeat(64), name: 'proof.png', type: 'image/png', size: 20 };
  const context = {
    recipients: [1, 2, 3, 4, 5].map((number) => `verifier${number}@example.invalid`),
    user: { id: userId, email: 'member@example.invalid', displayName: hostileName },
    payment: { id: userId, status: 'pending', planName: 'Regular Subscription', planCode: 'early_access_beta', amountCentavos: 14900, durationDays: 30, entitlementMode: 'rolling_days', paymentChannelLabel: 'BPI InstaPay', submittedAt: '2026-09-07T01:00:00Z', provisionalAccessExpiresAt: '2026-09-08T01:00:00Z' },
    fields: {}, proof,
  };
  const result = await sendPaymentVerificationEmail({ ...env, PAYMENT_NOTIFICATION_EMAIL_MODE: 'enabled' }, context);
  assert.equal(result.status, 'sent');
  const message = emails[0].body;
  assertBranded(message);
  assert.equal(message.text, paymentEmailText({ ...context, proofHash: proof.hash }));
  assert.match(message.html, /₱149\.00/);
  assert.match(message.html, /30 days from access start after approval, or after existing finite access/);
  assert.deepEqual(message.to, [context.recipients[0]]);
  assert.deepEqual(message.bcc, context.recipients.slice(1));
  assert.equal(message.reply_to, context.user.email);
  assert.equal(message.attachments[0].content, Buffer.from(proof.bytes).toString('base64'));
  assert.equal(emails[0].headers.get('Idempotency-Key'), `payment-verification-${userId}`);
  captured.push({ name: 'proof', message });
});

test('actual Support route adds HTML without exposing private customer message or address', async () => {
  let stored = false;
  const emails = mockTransport((url) => {
    if (url.endsWith('/rest/v1/support_requests')) { stored = true; return new Response(null, { status: 201 }); }
  });
  const response = await worker.fetch(request('/support', { category: 'technical', message: 'Private original customer narrative must remain in protected storage.', replyEmail: 'member@example.invalid' }), env);
  assert.equal(response.status, 201);
  assert.ok(stored);
  assert.equal(emails.length, 1);
  const message = emails[0].body;
  assertBranded(message);
  assert.deepEqual(message.to, ['support@duediligence.ph']);
  assert.equal(message.reply_to, undefined);
  assert.doesNotMatch(message.html, /member@example\.invalid|Private original customer narrative/);
  assert.equal(message.text, 'A Support request was submitted.\nCategory: technical\nMember identity, contact information, and message remain in the protected Support queue.\n\nAuthorized review: https://duediligence.ph/admin/');
  captured.push({ name: 'support', message });
});

test('actual sign-in route escapes identity, keeps privacy minimization and owner-only recipient', async () => {
  const emails = mockTransport((url) => url.endsWith('/rest/v1/rpc/record_user_sign_in_event') ? Response.json({ recorded: true }) : null);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none' })}.${encode({ sub: userId, session_id: '12f57cd6-a9a2-4b8d-9411-d292dc21dc67', iat: 1785632400 })}.signature`;
  const response = await worker.fetch(request('/auth/sign-in-notification', {}, token), env);
  assert.equal(response.status, 202);
  const message = emails[0].body;
  assertBranded(message);
  assert.deepEqual(message.to, ['owner@example.invalid']);
  assert.match(message.text, /<img src=x onerror="alert\(1\)"> & Synthetic Reviewer/);
  assert.match(message.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; Synthetic Reviewer/);
  assert.doesNotMatch(message.html, /192\.0\.2\.231|\.signature|<a /);
  assert.match(emails[0].headers.get('Idempotency-Key'), /^sign-in-[a-f0-9]{64}$/);
  captured.push({ name: 'sign-in', message });
});

test('actual Founder export keeps CSV private attachment rather than inlining directory rows', async () => {
  const emails = mockTransport((url) => {
    if (url.endsWith('/rest/v1/rpc/admin_prepare_user_directory_email_export_scoped_v1')) return Response.json({ total: 1, tooMany: false, items: [{ id: userId, display_name: hostileName, email: 'private-row@example.invalid', answered_question_count: 4 }] });
    if (url.endsWith('/rest/v1/rpc/admin_record_user_directory_email_delivery')) return Response.json({ recorded: true, status: 'sent' });
  });
  const response = await worker.fetch(request('/admin/user-directory/email', { recipientKey: 'gilmar', search: '', reason: 'Synthetic Founder export presentation verification', requestKey: 'astraemailtemplate0001', confirmed: true }), env);
  assert.equal(response.status, 200);
  const message = emails[0].body;
  assertBranded(message);
  assert.deepEqual(message.to, ['founder@example.invalid']);
  assert.equal(message.text, 'An authorized Founder requested the attached private user-directory export.\nRows exported: 1.\nIt contains personal information. Store it securely and do not forward it.');
  assert.doesNotMatch(message.html, /private-row@example\.invalid|Synthetic Reviewer|<a /);
  assert.match(Buffer.from(message.attachments[0].content, 'base64').toString(), /private-row@example\.invalid/);
  assert.equal(emails[0].headers.get('Idempotency-Key'), 'admin-directory-astraemailtemplate0001');
  captured.push({ name: 'directory', message });
});

test('suppressed proof and operations modes never fetch or introduce new notifications', async () => {
  globalThis.fetch = () => { assert.fail('Suppressed email must not fetch'); };
  assert.equal((await sendPaymentVerificationEmail({ PAYMENT_NOTIFICATION_EMAIL_MODE: 'suppressed' }, {})).status, 'suppressed');
  assert.equal((await sendSecureNotification({ OUTBOUND_EMAIL_MODE: 'suppressed', WEB3FORMS_ACCESS_KEY: 'synthetic' }, { mailbox: 'operations@example.invalid', subject: 'Synthetic', adminPath: '/admin/' })).status, 'suppressed');
});

test('refund/partnership Web3Forms contract remains unchanged without invented HTML fields', async () => {
  let payload;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.web3forms.com/submit');
    payload = JSON.parse(init.body);
    return Response.json({ success: true });
  };
  await sendSecureNotification({ OUTBOUND_EMAIL_MODE: 'enabled', WEB3FORMS_ACCESS_KEY: 'synthetic' }, { mailbox: 'refunds@example.invalid', subject: 'Synthetic review', adminPath: '/admin/refunds?request=synthetic' });
  assert.deepEqual(Object.keys(payload), ['access_key', 'from_name', 'subject', 'email', 'message']);
  assert.equal(payload.email, 'refunds@example.invalid');
  assert.equal(payload.message, 'A new production request is ready for authorized review: https://duediligence.ph/admin/refunds?request=synthetic');
});
