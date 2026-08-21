import assert from 'node:assert/strict';
import test from 'node:test';
import commercialWorker from './commercial-entry.mjs';
import {
  AccessValidationError,
  accessDeniedError,
  normalizeAccessSnapshot,
} from './access-core.mjs';

test('ordinary commercial accounts receive five one-time introductory tokens automatically', () => {
  const access = normalizeAccessSnapshot({
    allowed: true,
    basis: 'introductory_tokens',
    termsRequired: false,
    profileCompleted: true,
    tokenAcknowledgementRequired: false,
    role: 'student',
    accessMode: 'introductory',
    accountLabel: 'Introductory access',
    unlimited: false,
    tokenLimit: 5,
    tokensUsed: 0,
    tokensReserved: 0,
    tokensRemaining: 5,
    checkoutOpen: true,
    priceCentavos: 14900,
    regularPriceCentavos: 19900,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: false,
  });

  assert.equal(access.allowed, true);
  assert.equal(access.choiceRequired, false);
  assert.equal(access.freeChoiceAvailable, false);
  assert.equal(access.tokenLimit, 5);
  assert.equal(access.tokensUsed, 0);
  assert.equal(access.tokensRemaining, 5);
  assert.equal(access.resetAt, null);
  assert.equal(access.dailyLimit, 5);
  assert.equal(access.remainingToday, 5);
});

test('used introductory tokens do not reset and require Early Access to continue', () => {
  const access = normalizeAccessSnapshot({
    allowed: false,
    basis: 'trial_tokens_exhausted',
    accessMode: 'introductory',
    accountLabel: 'Introductory access',
    tokenLimit: 5,
    tokensUsed: 5,
    tokensReserved: 0,
    tokensRemaining: 0,
    commercialLaunchEnabled: true,
  });

  assert.throws(
    () => { throw accessDeniedError(access); },
    (error) => (
      error instanceof AccessValidationError
      && error.code === 'INTRODUCTORY_TOKENS_EXHAUSTED'
      && /five one-time practice tokens/i.test(error.message)
      && !/midnight|daily|reset/i.test(error.message)
    ),
  );
});

test('the retired access-choice endpoint cannot create Free or resettable access', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error('The retired endpoint must not call an upstream service.');
  };

  try {
    const response = await commercialWorker.fetch(new Request(
      'https://worker.example/access/choose',
      {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          Authorization: 'Bearer verified-token',
          'Content-Type': 'application/json',
          'X-Request-ID': 'choice_request_20260821',
        },
        body: JSON.stringify({ choice: 'free' }),
      },
    ), {
      ALLOWED_ORIGIN: 'https://duediligence.ph',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    });

    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
