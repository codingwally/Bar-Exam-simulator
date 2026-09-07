import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AccessValidationError,
  accessDeniedError,
  normalizeAccessSnapshot,
} from './access-core.mjs';
import {
  PaymentValidationError,
  normalizePhase4AdminAction,
  normalizePaymentFields,
  normalizeRefundRequest,
} from './payment-core.mjs';

const salesCloseAt = '2026-10-01T00:00:00+08:00';

test('commercial study completion RPCs are allowed through the Worker storage boundary', async () => {
  const worker = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  for (const operation of [
    'dd2026_record_bar_easy_completion_commercial',
    'dd2026_record_doctrine_mastery_commercial',
  ]) {
    assert.match(worker, new RegExp(`'${operation}'`));
  }
});

test('normalizes the authoritative introductory-token response without exposing unknown fields or private schedule dates', () => {
  const normalized = normalizeAccessSnapshot({
    allowed: true,
    basis: 'introductory_tokens',
    termsRequired: false,
    role: 'student',
    accessMode: 'introductory',
    accountLabel: 'Introductory access',
    unlimited: false,
    tokenLimit: 5,
    tokensUsed: 2,
    tokensReserved: 1,
    tokensRemaining: 2,
    tokenGrantAt: '2026-08-21T00:00:00+08:00',
    tokenDisclosureVersion: 'trial-tokens-v1-2026-08-21',
    checkoutOpen: true,
    priceCentavos: 14900,
    regularPriceCentavos: 19900,
    renewalAt: '2026-10-01T00:00:00+08:00',
    manualRenewal: true,
    automaticRenewal: false,
    salesCloseAt,
    entitlementEndsAt: null,
    commercialLaunchEnabled: true,
    internalSecret: 'must-not-pass-through',
  });

  assert.equal(normalized.allowed, true);
  assert.equal(normalized.basis, 'introductory_tokens');
  assert.equal(normalized.accessMode, 'introductory');
  assert.equal(normalized.accountLabel, 'Introductory access');
  assert.equal(normalized.tokenLimit, 5);
  assert.equal(normalized.tokensUsed, 2);
  assert.equal(normalized.tokensReserved, 1);
  assert.equal(normalized.tokensRemaining, 2);
  assert.equal(normalized.resetAt, null);
  assert.equal(normalized.priceCentavos, 14900);
  assert.equal(normalized.regularPriceCentavos, 19900);
  assert.equal(normalized.renewalAt, null);
  assert.equal(normalized.salesCloseAt, null);
  assert.equal(normalized.manualRenewal, true);
  assert.equal(normalized.automaticRenewal, false);
  assert.deepEqual(normalized.freeGrades, { limit: 5, used: 2, remaining: 2 });
  assert.equal('internalSecret' in normalized, false);
});

test('normalizes unlimited Early Access with fixed entitlement metadata', () => {
  const normalized = normalizeAccessSnapshot({
    allowed: true,
    basis: 'early_access',
    role: 'student',
    accessMode: 'early_access',
    accountLabel: 'Early Access',
    unlimited: true,
    tokenLimit: 5,
    tokensUsed: 5,
    tokensReserved: 3,
    tokensRemaining: 0,
    checkoutOpen: false,
    priceCentavos: 14900,
    salesCloseAt,
    entitlementEndsAt: '2026-10-01T23:59:59+08:00',
    paymentState: 'verified',
    commercialLaunchEnabled: true,
    subscription: {
      id: '11111111-1111-4111-8111-111111111111',
      planCode: 'early_access_beta',
      status: 'active',
      source: 'manual_payment',
      startsAt: '2026-08-18T10:00:00+08:00',
      expiresAt: '2026-10-01T23:59:59+08:00',
    },
  });

  assert.equal(normalized.allowed, true);
  assert.equal(normalized.unlimited, true);
  assert.equal(normalized.accessMode, 'early_access');
  assert.equal(normalized.accountLabel, 'Early Access');
  assert.equal(normalized.entitlementEndsAt, '2026-10-01T23:59:59+08:00');
  assert.equal(normalized.paymentState, 'verified');
  assert.equal(normalized.subscription.planCode, 'early_access_beta');
});

test('closed checkout never invents a replacement price or entitlement expiry', () => {
  const normalized = normalizeAccessSnapshot({
    allowed: true,
    basis: 'introductory_tokens',
    accessMode: 'introductory',
    accountLabel: 'Introductory access',
    tokenLimit: 5,
    tokensUsed: 0,
    tokensReserved: 0,
    tokensRemaining: 5,
    checkoutOpen: false,
    priceCentavos: null,
    salesCloseAt,
    entitlementEndsAt: null,
    commercialLaunchEnabled: true,
  });

  assert.equal(normalized.checkoutOpen, false);
  assert.equal(normalized.priceCentavos, 0);
  assert.equal(normalized.entitlementEndsAt, null);
});

test('rejects absent access responses and clamps invalid quota counters', () => {
  assert.throws(
    () => normalizeAccessSnapshot(null),
    (error) => error instanceof AccessValidationError
      && error.code === 'ACCESS_UNAVAILABLE'
      && error.status === 503,
  );
  const normalized = normalizeAccessSnapshot({
    allowed: true,
    dailyLimit: 5,
    completedToday: -8,
    reservedToday: -2,
    remainingToday: 999,
  });
  assert.equal(normalized.completedToday, 0);
  assert.equal(normalized.reservedToday, 0);
  assert.equal(normalized.remainingToday, 5);
});

test('introductory exhaustion produces the permanent-token error, not a reset promise', () => {
  const error = accessDeniedError({
    accessMode: 'introductory',
    basis: 'trial_tokens_exhausted',
    tokenLimit: 5,
    tokensRemaining: 0,
  });
  assert.equal(error.code, 'INTRODUCTORY_TOKENS_EXHAUSTED');
  assert.equal(error.status, 403);
  assert.match(error.message, /five one-time practice tokens/i);
  assert.doesNotMatch(error.message, /midnight|daily|reset/i);
});

test('legal acceptance remains a higher-priority denial than introductory exhaustion', () => {
  const error = accessDeniedError({
    termsRequired: true,
    accessMode: 'introductory',
    basis: 'trial_tokens_exhausted',
    tokenLimit: 5,
  });
  assert.equal(error.code, 'LEGAL_ACCEPTANCE_REQUIRED');
  assert.match(error.message, /Terms of Use and Privacy Policy/i);
});

function validPayment(overrides = {}) {
  return {
    planVersionId: '22222222-2222-4222-8222-222222222222',
    paymentChannelVersionId: '33333333-3333-4333-8333-333333333333',
    // These retired customer-entered fields are deliberately present to prove
    // that the versioned checkout accepts only the selected plan/channel.
    paymentDate: '2026-08-18',
    paymentReference: 'COMMERCIAL-REF-0001',
    note: 'This must not cross the proof-only payment boundary.',
    ...overrides,
  };
}

test('proof-only checkout accepts only the published plan and payment-channel selection', () => {
  const normalized = normalizePaymentFields(validPayment());
  assert.deepEqual(normalized, {
    planVersionId: '22222222-2222-4222-8222-222222222222',
    paymentChannelVersionId: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal('paymentDate' in normalized, false);
  assert.equal('paymentReference' in normalized, false);
  assert.equal('transactionReference' in normalized, false);
  assert.equal('note' in normalized, false);
  assert.equal('amountPhp' in normalized, false);
  assert.equal('planCode' in normalized, false);
  assert.equal('paymentMethod' in normalized, false);
});

test('rejects a malformed payment-channel version', () => {
  assert.throws(
    () => normalizePaymentFields(validPayment({ paymentChannelVersionId: 'cash' })),
    (error) => error instanceof PaymentValidationError
      && ['INVALID_PAYMENT', 'INVALID_PAYMENT_METHOD'].includes(error.code),
  );
});

test('rejects a malformed plan version and leaves plan availability to the database', () => {
  assert.throws(
    () => normalizePaymentFields(validPayment({ planVersionId: 'premium' })),
    (error) => error instanceof PaymentValidationError
      && ['INVALID_PAYMENT', 'PLAN_UNAVAILABLE'].includes(error.code),
  );
});

test('ignores every client-supplied price and plan label', () => {
  for (const amountPhp of [0, 148.99, 149.01, 199, 249, Number.NaN]) {
    const normalized = normalizePaymentFields(validPayment({
      amountPhp,
      planCode: 'early_access_beta',
      paymentMethod: 'cash',
    }));
    assert.equal('amountPhp' in normalized, false);
    assert.equal('planCode' in normalized, false);
    assert.equal('paymentMethod' in normalized, false);
  }
});

test('reviewer payment decision normalizes the exact verified payment timestamp', () => {
  const normalized = normalizePhase4AdminAction({
    action: 'payment_review',
    targetId: '44444444-4444-4444-8444-444444444444',
    reason: 'Verified against the private payment proof.',
    requestKey: 'payment_review_test_0001',
    payload: {
      status: 'approved',
      verifiedPaidAt: '2026-09-14T00:15:00+08:00',
      paymentDate: '2026-09-14',
      transactionReference: 'CUSTOMER-FIELD-MUST-NOT-PASS',
    },
  });

  assert.deepEqual(normalized.payload, {
    status: 'approved',
    verifiedPaidAt: '2026-09-13T16:15:00.000Z',
  });
  assert.equal('paymentDate' in normalized.payload, false);
  assert.equal('transactionReference' in normalized.payload, false);
});

test('reviewer payment decision rejects an invalid verified payment timestamp', () => {
  assert.throws(
    () => normalizePhase4AdminAction({
      action: 'payment_review',
      targetId: '44444444-4444-4444-8444-444444444444',
      reason: 'Verified against the private payment proof.',
      requestKey: 'payment_review_test_0002',
      payload: {
        status: 'approved',
        verifiedPaidAt: 'not-a-date',
      },
    }),
    (error) => error instanceof PaymentValidationError
      && error.code === 'INVALID_ADMIN_ACTION',
  );
});

test('approved-payment invalidation strips every client-supplied mutation field', () => {
  const normalized = normalizePhase4AdminAction({
    action: 'payment_invalidate',
    targetId: '44444444-4444-4444-8444-444444444444',
    reason: 'The reviewed proof is not a valid payment record.',
    requestKey: 'payment_invalidation_test_0001',
    payload: {
      status: 'rejected',
      userId: '55555555-5555-4555-8555-555555555555',
      subscriptionId: '66666666-6666-4666-8666-666666666666',
      verifiedPaidAt: '2026-09-01T00:00:00.000Z',
      amountPhp: 0,
      studentEmail: 'untrusted@example.invalid',
    },
  });

  assert.equal(normalized.action, 'payment_invalidate');
  assert.deepEqual(normalized.payload, {});
});

test('refund normalization accepts only a selected payment and a substantive reason', () => {
  const normalized = normalizeRefundRequest({
    paymentRequestId: '22222222-2222-4222-8222-222222222222',
    reason: 'I am requesting cancellation within the approved seven-day period.',
  });
  assert.deepEqual(normalized, {
    paymentRequestId: '22222222-2222-4222-8222-222222222222',
    reason: 'I am requesting cancellation within the approved seven-day period.',
  });
  assert.throws(
    () => normalizeRefundRequest({ paymentRequestId: 'not-a-uuid', reason: 'Valid reason text.' }),
    (error) => error instanceof PaymentValidationError,
  );
});
