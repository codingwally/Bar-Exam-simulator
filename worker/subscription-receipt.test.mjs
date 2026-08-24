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
    amountPhp: 149,
    paymentMethod: 'bpi_instapay',
    transactionReference: 'SAMPLE-REFERENCE',
    paymentDate: '2026-08-24',
    reviewedAt: '2026-08-24T01:30:00.000Z',
  },
  subscription: {
    expiresAt: '2026-10-01T15:59:59.000Z',
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
  assert.match(content.text, /₱149\.00/);
  assert.match(content.text, /SAMPLE-REFERENCE/);
  assert.match(content.text, /No automatic billing is scheduled/);
  assert.match(content.text, /does not renew automatically/);
  assert.match(content.text, /exact payment proof reviewed/i);
  assert.doesNotMatch(content.text, /next billing date|automatic renewal date/i);
  assert.match(content.html, /Electronic payment acknowledgment/);
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
        amountPhp: 149,
        paymentMethod: 'bpi_instapay',
        paymentDate: '2026-08-24',
        transactionReference: 'CANONICAL-REFERENCE',
        reviewedAt: '2026-08-24T01:30:00.000Z',
        proofObjectPath: 'member-id/payment-id.jpg',
        proofOriginalName: 'reviewed-proof.jpg',
        proofMimeType: 'image/jpeg',
        proofSizeBytes: proofBytes.length,
        user: { email: 'subscriber@example.test', displayName: 'Subscriber' },
        subscription: { expiresAt: '2026-10-01T15:59:59.000Z' },
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
    const completionCall = calls.find(({ target }) => target.endsWith('/rpc/phase4_complete_subscription_receipt'));
    assert.equal(completionCall.body.p_status, 'sent');
    assert.equal(completionCall.body.p_provider_id, 'email_live_contract_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
