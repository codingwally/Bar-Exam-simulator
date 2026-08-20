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
  normalizePaymentFields,
  normalizeRefundRequest,
} from './payment-core.mjs';

const resetAt = '2026-08-19T00:00:00+08:00';
const salesCloseAt = '2026-09-01T23:59:59+08:00';

test('commercial study completion RPCs are allowed through the Worker storage boundary', async () => {
  const worker = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  for (const operation of [
    'dd2026_record_bar_easy_completion_commercial',
    'dd2026_record_doctrine_mastery_commercial',
  ]) {
    assert.match(worker, new RegExp(`'${operation}'`));
  }
});

test('normalizes the authoritative Free access response without exposing unknown fields', () => {
  const normalized = normalizeAccessSnapshot({
    allowed: true,
    basis: 'daily_free',
    termsRequired: false,
    role: 'student',
    accessMode: 'free',
    accountLabel: 'Free Trial',
    unlimited: false,
    dailyLimit: 5,
    completedToday: 2,
    reservedToday: 1,
    remainingToday: 2,
    resetAt,
    checkoutOpen: true,
    priceCentavos: 14900,
    salesCloseAt,
    entitlementEndsAt: null,
    commercialLaunchEnabled: true,
    internalSecret: 'must-not-pass-through',
  });

  assert.deepEqual(normalized, {
    allowed: true,
    basis: 'daily_free',
    termsRequired: false,
    profileCompleted: true,
    choiceRequired: false,
    paymentRequired: false,
    planSelectionRequired: false,
    role: 'student',
    accessMode: 'free',
    accountLabel: 'Free',
    unlimited: false,
    dailyLimit: 5,
    completedToday: 2,
    reservedToday: 1,
    remainingToday: 2,
    resetAt,
    checkoutOpen: true,
    priceCentavos: 14900,
    salesCloseAt,
    entitlementEndsAt: null,
    paymentState: null,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: false,
    freeChoiceAvailable: false,
    selectedChoice: null,
    choiceRecordedAt: null,
    trialAvailable: false,
    trialEndsAt: null,
    globalBeta: { enabled: false, eligible: false, active: false, expiresAt: null },
    trial: { startedAt: null, expiresAt: null, active: false, program: null },
    freeGrades: { limit: 5, used: 2, remaining: 2 },
    freeBeta: { enabled: false, expiresAt: null, active: false, program: null },
    subscription: null,
  });
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
    dailyLimit: 5,
    completedToday: 5,
    reservedToday: 3,
    remainingToday: 0,
    resetAt,
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
    basis: 'daily_free',
    accessMode: 'free',
    accountLabel: 'Free Trial',
    dailyLimit: 5,
    completedToday: 0,
    reservedToday: 0,
    remainingToday: 5,
    resetAt,
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

test('daily exhaustion produces the commercial reset error, not a generic paywall error', () => {
  const error = accessDeniedError({
    accessMode: 'free',
    basis: 'daily_limit_reached',
    dailyLimit: 5,
    remainingToday: 0,
    resetAt,
  });
  assert.equal(error.code, 'DAILY_LIMIT_REACHED');
  assert.equal(error.status, 403);
  assert.match(error.message, /five|5/i);
  assert.match(error.message, /Philippine midnight/i);
});

test('legal acceptance remains a higher-priority denial than daily exhaustion', () => {
  const error = accessDeniedError({
    termsRequired: true,
    accessMode: 'free',
    basis: 'daily_limit_reached',
    dailyLimit: 5,
  });
  assert.equal(error.code, 'LEGAL_ACCEPTANCE_REQUIRED');
  assert.match(error.message, /Terms of Use and Privacy Policy/i);
});

function validPayment(overrides = {}) {
  return {
    planCode: 'early_access_beta',
    amountPhp: 149,
    paymentMethod: 'gotyme_instapay',
    paymentDate: '2026-08-18',
    transactionReference: 'COMMERCIAL-REF-0001',
    note: 'One-time Early Access payment proof.',
    ...overrides,
  };
}

test('accepts only the approved ₱149 one-time Early Access payment', () => {
  const normalized = normalizePaymentFields(validPayment());
  assert.deepEqual(normalized, {
    planCode: 'early_access_beta',
    amountPhp: 149,
    paymentMethod: 'gotyme_instapay',
    paymentDate: '2026-08-18',
    transactionReference: 'COMMERCIAL-REF-0001',
    note: 'One-time Early Access payment proof.',
  });
  assert.equal('pricePhp' in normalized, false);
  assert.equal('subscriptionDays' in normalized, false);
});

test('rejects an unapproved payment channel', () => {
  assert.throws(
    () => normalizePaymentFields(validPayment({ paymentMethod: 'cash' })),
    (error) => error instanceof PaymentValidationError
      && error.code === 'INVALID_PAYMENT_METHOD',
  );
});

for (const retiredPlan of ['standard', 'premium']) {
  test(`rejects retired ${retiredPlan} checkout submissions`, () => {
    assert.throws(
      () => normalizePaymentFields(validPayment({ planCode: retiredPlan })),
      (error) => error instanceof PaymentValidationError
        && error.code === 'PLAN_UNAVAILABLE',
    );
  });
}

test('rejects a client-supplied amount other than exactly ₱149', () => {
  for (const amountPhp of [0, 148.99, 149.01, 249, Number.NaN]) {
    assert.throws(
      () => normalizePaymentFields(validPayment({ amountPhp })),
      (error) => error instanceof PaymentValidationError
        && error.code === 'INVALID_PAYMENT_AMOUNT',
      `amount ${String(amountPhp)} must be rejected`,
    );
  }
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
