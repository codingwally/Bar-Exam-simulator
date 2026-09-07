import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import coreWorker from './index.mjs';
import commercialWorker, {
  dispatchApprovedSubscriptionReceipt,
  drainSubscriptionReceiptQueue,
} from './commercial-entry.mjs';
import {
  sendSubscriptionReceiptEmail,
  subscriptionReceiptEmailStatus,
} from './subscription-receipt.mjs';

const paymentId = '11111111-1111-4111-8111-111111111111';
const env = {
  SUBSCRIPTION_RECEIPT_EMAIL_MODE: 'enabled',
  OUTBOUND_EMAIL_MODE: 'suppressed',
  PAYMENT_NOTIFICATION_EMAIL_MODE: 'suppressed',
  PAYMENT_NOTIFICATION_EMAIL_FROM: 'Due Diligence Payments <payments@example.test>',
  RESEND_API_KEY: 'fake-local-only',
  SUPABASE_URL: 'https://project.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-local-only',
};
const disabledModes = [undefined, null, true, false, 1, {}, ['enabled'], '', ' ', 'enable', 'invalid', 'suppressed', ' SUPPRESSED '];
const inaccessibleContext = new Proxy({}, { get: () => assert.fail('Disabled sender must not access private receipt context') });
const noTransport = () => assert.fail('No claim, proof download, provider send, or completion RPC is allowed');

test('receipt policy requires an explicit dedicated opt-in; general/verifier settings cannot enable it', () => {
  for (const mode of disabledModes) {
    assert.equal(subscriptionReceiptEmailStatus({ ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: mode,
      OUTBOUND_EMAIL_MODE: 'enabled', PAYMENT_NOTIFICATION_EMAIL_MODE: 'enabled' }), 'suppressed');
  }
  for (const mode of ['enabled', ' Enabled ', 'ENABLED']) {
    assert.equal(subscriptionReceiptEmailStatus({ ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: mode }), 'enabled');
  }
});

test('suppressed/missing/invalid dedicated mode stops dispatcher and sender before any private work', async (t) => {
  t.mock.method(globalThis, 'fetch', noTransport);
  for (const mode of disabledModes) {
    const settings = { ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: mode };
    assert.deepEqual(await sendSubscriptionReceiptEmail(settings, inaccessibleContext), { status: 'suppressed', providerId: null });
    assert.deepEqual(await dispatchApprovedSubscriptionReceipt(settings, paymentId), { status: 'suppressed', paymentRequestId: paymentId });
  }
});

test('enabled but missing/invalid transport configuration leaves the real queue untouched', async (t) => {
  t.mock.method(globalThis, 'fetch', noTransport);
  for (const overrides of [
    { RESEND_API_KEY: undefined }, { RESEND_API_KEY: null }, { RESEND_API_KEY: '' },
    { RESEND_API_KEY: '  ' }, { RESEND_API_KEY: {} },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: undefined }, { PAYMENT_NOTIFICATION_EMAIL_FROM: null },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: '' }, { PAYMENT_NOTIFICATION_EMAIL_FROM: '  ' },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: {} }, { PAYMENT_NOTIFICATION_EMAIL_FROM: 'sender@example.test\r\nBcc: other@example.test' },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: 'not-a-mailbox' }, { PAYMENT_NOTIFICATION_EMAIL_FROM: 'Name <invalid>' },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: 'Sender\u0000 <sender@example.test>' },
    { PAYMENT_NOTIFICATION_EMAIL_FROM: `${'x'.repeat(254)} <sender@example.test>` },
  ]) {
    const settings = { ...env, ...overrides };
    assert.equal(subscriptionReceiptEmailStatus(settings), 'not_configured');
    assert.deepEqual(await sendSubscriptionReceiptEmail(settings, inaccessibleContext), { status: 'not_configured', providerId: null });
    assert.deepEqual(await dispatchApprovedSubscriptionReceipt(settings, paymentId), { status: 'not_configured', paymentRequestId: paymentId });
  }
});

test('scheduled receipt drain stops on suppression or unavailable configuration without claiming any attempts', async (t) => {
  t.mock.method(globalThis, 'fetch', noTransport);
  assert.deepEqual(await drainSubscriptionReceiptQueue({ ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: 'suppressed' }, 10),
    [{ status: 'suppressed', paymentRequestId: null }]);
  assert.deepEqual(await drainSubscriptionReceiptQueue({ ...env, RESEND_API_KEY: '' }, 10),
    [{ status: 'not_configured', paymentRequestId: null }]);
});

test('enabled production exception preserves canonical receipt, exact proof, idempotency and durable completion', async (t) => {
  const calls = [];
  let receiptState = 'pending';
  let receiptAttempts = 0;
  const proof = new TextEncoder().encode('original reviewed proof');
  const payment = {
    id: paymentId, status: 'approved', planVersionId: paymentId, planCode: 'early_access_beta',
    planName: 'Owner current plan', amountCentavos: 14900, durationDays: 30, entitlementMode: 'rolling_days',
    activatedAt: '2026-09-07T06:00:00Z', reviewedAt: '2026-09-07T06:00:00Z',
    purchasedStartsAt: '2026-10-07T06:00:00Z', purchasedEndsAt: '2026-11-06T06:00:00Z',
    paymentMethod: 'bpi_instapay', proofObjectPath: 'test-owner/test-proof.jpg',
    proofOriginalName: 'original-proof.jpg', proofMimeType: 'image/jpeg', proofSizeBytes: proof.length,
    user: { id: '22222222-2222-4222-8222-222222222222', email: 'payment-owner@example.test', displayName: 'Owner' },
    subscription: { startsAt: '2026-08-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' },
  };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ target, body, headers: options.headers });
    if (target.endsWith('/rpc/phase4_claim_subscription_receipt')) {
      assert.equal(body.p_payment_request_id, paymentId);
      if (receiptState !== 'pending') return Response.json(null);
      receiptState = 'sending'; receiptAttempts += 1;
      return Response.json(payment);
    }
    if (target.includes('/storage/v1/object/payment-proofs/')) return new Response(proof);
    if (target === 'https://api.resend.com/emails') return Response.json({ id: 'fake-provider-accepted' });
    if (target.endsWith('/rpc/phase4_complete_subscription_receipt')) {
      assert.equal(body.p_payment_request_id, paymentId);
      assert.equal(body.p_status, 'sent'); assert.equal(body.p_provider_id, 'fake-provider-accepted');
      receiptState = body.p_status; return Response.json(null);
    }
    if (target.endsWith('/rpc/phase4_subscription_receipt_context')) return Response.json({ receiptStatus: receiptState });
    assert.fail(`Unexpected mocked route: ${target}`);
  });
  // Repeated suppression cannot burn retries or remove the pending item.
  for (let index = 0; index < 3; index += 1) {
    await dispatchApprovedSubscriptionReceipt({ ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: 'suppressed' }, paymentId);
  }
  assert.equal(receiptState, 'pending'); assert.equal(receiptAttempts, 0); assert.equal(calls.length, 0);
  assert.deepEqual(await dispatchApprovedSubscriptionReceipt(env, paymentId), { status: 'sent', paymentRequestId: paymentId });
  assert.equal(receiptState, 'sent'); assert.equal(receiptAttempts, 1);
  const email = calls.find((call) => call.target === 'https://api.resend.com/emails');
  assert.deepEqual(email.body.to, ['payment-owner@example.test']);
  assert.equal(email.headers['Idempotency-Key'], `subscription-receipt-${paymentId}`);
  assert.equal(email.body.attachments[0].content, Buffer.from(proof).toString('base64'));
  for (const content of [email.body.text, email.body.html]) {
    assert.match(content, /₱149\.00/); assert.match(content, /Owner current plan/);
    assert.match(content, /30 days from access start/);
    assert.match(content, /November 6, 2026 at 2:00 PM/);
    assert.doesNotMatch(content, /2027|Verified payment time/);
  }
  await dispatchApprovedSubscriptionReceipt(env, paymentId);
  assert.equal(receiptAttempts, 1); assert.equal(calls.filter((call) => call.target === 'https://api.resend.com/emails').length, 1);
});

test('approval wrapper preserves approved core response while receipt suppression leaves queue untouched', async (t) => {
  t.mock.method(globalThis, 'fetch', noTransport);
  let coreCalls = 0;
  t.mock.method(coreWorker, 'fetch', async () => {
    coreCalls += 1;
    return Response.json({ ok: true, data: { payment: { id: paymentId, status: 'approved' }, subscription: { status: 'active' } } });
  });
  const request = new Request('https://worker.example.test/admin/phase4-action', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'payment_review', targetId: paymentId, payload: { status: 'approved' } }) });
  const response = await commercialWorker.fetch(request, { ...env, SUBSCRIPTION_RECEIPT_EMAIL_MODE: 'suppressed' }, {});
  const body = await response.json();
  assert.equal(coreCalls, 1); assert.equal(response.status, 200);
  assert.equal(body.data.payment.status, 'approved'); assert.equal(body.data.subscription.status, 'active');
  assert.deepEqual(body.data.subscriberReceipt, { status: 'suppressed' });
});

test('rejected core authorization does not enter receipt dispatch even when delivery is enabled', async (t) => {
  t.mock.method(globalThis, 'fetch', noTransport);
  t.mock.method(coreWorker, 'fetch', async () => Response.json({ ok: false, error: { code: 'ADMIN_REQUIRED' } }, { status: 403 }));
  const response = await commercialWorker.fetch(new Request('https://worker.example.test/admin/phase4-action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'payment_review', targetId: paymentId, payload: { status: 'approved' } }),
  }), env, {});
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'ADMIN_REQUIRED');
});

test('production explicitly preserves receipts and staging explicitly suppresses them independently of general outbound mode', () => {
  const production = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const staging = readFileSync(new URL('./wrangler.staging.toml', import.meta.url), 'utf8');
  assert.match(production, /^SUBSCRIPTION_RECEIPT_EMAIL_MODE = "enabled"$/m);
  assert.match(production, /^OUTBOUND_EMAIL_MODE = "suppressed"$/m);
  assert.match(production, /^PAYMENT_NOTIFICATION_EMAIL_MODE = "enabled"$/m);
  assert.match(staging, /^SUBSCRIPTION_RECEIPT_EMAIL_MODE = "suppressed"$/m);
  assert.match(staging, /^OUTBOUND_EMAIL_MODE = "suppressed"$/m);
});
