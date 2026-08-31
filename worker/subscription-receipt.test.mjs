import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sendSubscriptionReceiptEmail,
  subscriptionReceiptContent,
} from './subscription-receipt.mjs';
import { dispatchApprovedSubscriptionReceipt } from './commercial-entry.mjs';

const fixture = {
  sample: true,
  sampleKey: 'owner-preview-20260824',
  user: {
    email: 'owner@example.test',
    displayName: 'Owner Preview',
  },
  payment: {
    id: '00000000-0000-4000-8000-000000000123',
    planVersionId: '11111111-1111-4111-8111-111111111111',
    planCode: 'bar_access_30d',
    planName: 'Regular Subscription',
    amountCentavos: 19900,
    durationDays: 30,
    paymentMethod: 'bpi_instapay',
    transactionReference: 'RETIRED-CUSTOMER-REFERENCE',
    paymentDate: '2026-09-14',
    verifiedPaidAt: '2026-09-14T01:15:00+08:00',
    purchasedStartsAt: '2026-09-14T01:15:00+08:00',
    purchasedEndsAt: '2026-10-14T01:15:00+08:00',
    reviewedAt: '2026-08-24T01:30:00.000Z',
  },
  subscription: {
    startsAt: '2026-09-13T17:15:00.000Z',
    expiresAt: '2026-10-13T17:15:00.000Z',
  },
  proof: {
    name: 'sample-payment-proof.png',
    type: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  },
};

test('receipt copy uses only truthful payment and access facts', () => {
  const content = subscriptionReceiptContent(fixture);
  assert.match(content.subject, /^\[SAMPLE\]/);
  assert.match(content.text, /SAMPLE ONLY/);
  assert.match(content.text, /₱199\.00/);
  assert.match(content.text, /Regular Subscription/);
  assert.match(content.text, /30 days from verified payment/i);
  assert.match(content.text, /Verified payment time:/);
  assert.doesNotMatch(content.text, /RETIRED-CUSTOMER-REFERENCE/);
  assert.match(content.text, /No automatic billing is scheduled/);
  assert.match(content.text, /does not renew automatically/);
  assert.match(content.text, /exact payment proof reviewed/i);
  assert.doesNotMatch(content.text, /next billing date|automatic renewal date/i);
  assert.match(content.html, /Electronic payment acknowledgment/);
});

test('legacy fixed-end receipt compatibility remains intact', () => {
  const content = subscriptionReceiptContent({
    ...fixture,
    sample: false,
    payment: {
      id: '00000000-0000-4000-8000-000000000149',
      planCode: 'early_access_beta',
      paymentMethod: 'bpi_instapay',
      reviewedAt: '2026-08-24T01:30:00.000Z',
    },
    subscription: {
      expiresAt: '2026-10-01T15:59:59.000Z',
    },
  });

  assert.match(content.text, /₱149\.00/);
  assert.match(content.text, /Early Access/);
  assert.match(content.text, /Term: Access through October 1, 2026 at 11:59 PM/);
  assert.match(content.text, /DD-EA-/);
});

test('receipt dispatch attaches the exact reviewed bytes once', async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ id: 'email_receipt_test_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await sendSubscriptionReceiptEmail({
      PAYMENT_NOTIFICATION_EMAIL_FROM: 'Due Diligence <payments@example.test>',
      RESEND_API_KEY: 'test-only-key',
    }, fixture);
    assert.deepEqual(result, { status: 'sent', providerId: 'email_receipt_test_123' });
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.deepEqual(request.body.to, ['owner@example.test']);
    assert.equal(request.body.attachments.length, 1);
    assert.equal(request.body.attachments[0].filename, 'sample-payment-proof.png');
    assert.equal(request.body.attachments[0].content, 'iVBORw0KGgo=');
    assert.match(String(request.headers['Idempotency-Key']), /subscription-receipt-sample-owner-preview-20260824/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('receipt dispatch refuses missing recipients and invalid attachments', async () => {
  const invalidRecipient = await sendSubscriptionReceiptEmail({
    PAYMENT_NOTIFICATION_EMAIL_FROM: 'Due Diligence <payments@example.test>',
    RESEND_API_KEY: 'test-only-key',
  }, { ...fixture, user: { email: 'invalid' } });
  assert.equal(invalidRecipient.safeErrorCode, 'recipient_missing');

  const invalidProof = await sendSubscriptionReceiptEmail({
    PAYMENT_NOTIFICATION_EMAIL_FROM: 'Due Diligence <payments@example.test>',
    RESEND_API_KEY: 'test-only-key',
  }, { ...fixture, proof: { name: 'proof.svg', type: 'image/svg+xml', bytes: [1] } });
  assert.equal(invalidProof.safeErrorCode, 'proof_type_invalid');
});

test('approved payment queue reads the canonical proof and completes durably', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const proofBytes = new TextEncoder().encode('canonical-proof');
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ target, body, headers: options.headers });
    if (target.endsWith('/rpc/phase4_claim_subscription_receipt')) {
      return Response.json({
        id: '00000000-0000-4000-8000-000000000123',
        status: 'approved',
        planVersionId: '11111111-1111-4111-8111-111111111111',
        planCode: 'bar_access_30d',
        planName: 'Regular Subscription',
        amountCentavos: 19900,
        durationDays: 30,
        paymentMethod: 'bpi_instapay',
        paymentDate: '2026-09-14',
        transactionReference: 'RETIRED-CANONICAL-REFERENCE',
        verifiedPaidAt: '2026-09-14T01:15:00+08:00',
        purchasedStartsAt: '2026-09-14T01:15:00+08:00',
        purchasedEndsAt: '2026-10-14T01:15:00+08:00',
        reviewedAt: '2026-08-24T01:30:00.000Z',
        proofObjectPath: 'member-id/payment-id.jpg',
        proofOriginalName: 'reviewed-proof.jpg',
        proofMimeType: 'image/jpeg',
        proofSizeBytes: proofBytes.length,
        user: { email: 'subscriber@example.test', displayName: 'Subscriber' },
        subscription: {
          startsAt: '2026-09-13T17:15:00.000Z',
          expiresAt: '2026-10-13T17:15:00.000Z',
        },
      });
    }
    if (target.includes('/storage/v1/object/payment-proofs/')) {
      return new Response(proofBytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (target === 'https://api.resend.com/emails') {
      return Response.json({ id: 'email_live_contract_123' });
    }
    if (target.endsWith('/rpc/phase4_complete_subscription_receipt')) {
      return Response.json(null);
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const result = await dispatchApprovedSubscriptionReceipt({
      SUPABASE_URL: 'https://project.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
      PAYMENT_NOTIFICATION_EMAIL_FROM: 'Due Diligence <payments@example.test>',
      RESEND_API_KEY: 'resend-test-key',
    }, '00000000-0000-4000-8000-000000000123');
    assert.deepEqual(result, {
      status: 'sent',
      paymentRequestId: '00000000-0000-4000-8000-000000000123',
    });
    const storageCall = calls.find(({ target }) => target.includes('/storage/v1/object/payment-proofs/'));
    assert.match(storageCall.target, /payment-proofs\/member-id\/payment-id\.jpg$/);
    const resendCall = calls.find(({ target }) => target === 'https://api.resend.com/emails');
    assert.deepEqual(resendCall.body.to, ['subscriber@example.test']);
    assert.equal(resendCall.body.attachments[0].filename, 'reviewed-proof.jpg');
    assert.match(resendCall.body.text, /₱199\.00/);
    assert.match(resendCall.body.text, /30 days from verified payment/i);
    assert.match(resendCall.body.text, /Verified payment time:/);
    assert.doesNotMatch(resendCall.body.text, /RETIRED-CANONICAL-REFERENCE/);
    const completionCall = calls.find(({ target }) => target.endsWith('/rpc/phase4_complete_subscription_receipt'));
    assert.equal(completionCall.body.p_status, 'sent');
    assert.equal(completionCall.body.p_provider_id, 'email_live_contract_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
