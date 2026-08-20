import assert from 'node:assert/strict';
import test from 'node:test';
import commercialWorker from './commercial-entry.mjs';
import {
  AccessValidationError,
  accessDeniedError,
  normalizeAccessSnapshot,
} from './access-core.mjs';

test('ordinary commercial accounts preserve the required two-option state', () => {
  const access = normalizeAccessSnapshot({
    allowed: false,
    basis: 'plan_selection_required',
    termsRequired: false,
    profileCompleted: true,
    choiceRequired: true,
    role: 'student',
    accessMode: 'locked',
    accountLabel: 'Choose access',
    unlimited: false,
    dailyLimit: 5,
    completedToday: 0,
    reservedToday: 0,
    remainingToday: 0,
    checkoutOpen: true,
    priceCentavos: 14900,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: true,
    freeChoiceAvailable: true,
    freeGrades: { limit: 0, used: 0, remaining: 0 },
  });

  assert.equal(access.allowed, false);
  assert.equal(access.choiceRequired, true);
  assert.equal(access.freeChoiceAvailable, true);
  assert.equal(access.dailyLimit, 5);
  assert.equal(access.freeGrades.limit, 0);
  assert.equal(access.remainingToday, 0);

  assert.throws(
    () => { throw accessDeniedError(access); },
    (error) => (
      error instanceof AccessValidationError
      && error.code === 'ACCESS_CHOICE_REQUIRED'
      && /Free or ₱149 Early Access/.test(error.message)
    ),
  );
});

test('an explicitly selected Free account receives five daily submissions', () => {
  const access = normalizeAccessSnapshot({
    allowed: true,
    basis: 'daily_free',
    termsRequired: false,
    profileCompleted: true,
    choiceRequired: false,
    role: 'student',
    accessMode: 'free',
    accountLabel: 'Free',
    unlimited: false,
    dailyLimit: 5,
    completedToday: 0,
    reservedToday: 0,
    remainingToday: 5,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: true,
    freeChoiceAvailable: false,
    selectedChoice: 'free',
    freeGrades: { limit: 5, used: 0, remaining: 5 },
  });

  assert.equal(access.allowed, true);
  assert.equal(access.unlimited, false);
  assert.equal(access.choiceRequired, false);
  assert.equal(access.dailyLimit, 5);
  assert.equal(access.remainingToday, 5);
  assert.equal(access.selectedChoice, 'free');
});

test('the authenticated access-choice endpoint records permanent five-daily Free access', async () => {
  const originalFetch = globalThis.fetch;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const origin = 'https://duediligence.ph';
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/auth/v1/user')) {
      return Response.json({
        id: userId,
        email: 'student@example.com',
        user_metadata: { full_name: 'Student Test' },
      });
    }

    if (url.endsWith('/rest/v1/rpc/phase4_choose_launch_trial')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        p_user_id: userId,
        p_request_key: 'choice_request_20260818',
      });
      return Response.json({
        allowed: true,
        basis: 'daily_free',
        termsRequired: false,
        profileCompleted: true,
        choiceRequired: false,
        role: 'student',
        accessMode: 'free',
        accountLabel: 'Free',
        unlimited: false,
        dailyLimit: 5,
        completedToday: 0,
        reservedToday: 0,
        remainingToday: 5,
        commercialLaunchEnabled: true,
        mandatoryAccessChoiceEnabled: true,
        freeChoiceAvailable: false,
        selectedChoice: 'free',
        freeGrades: { limit: 5, used: 0, remaining: 5 },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await commercialWorker.fetch(new Request(
      'https://worker.example/access/choose',
      {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: 'Bearer verified-token',
          'Content-Type': 'application/json',
          'X-Request-ID': 'choice_request_20260818',
        },
        body: JSON.stringify({ choice: 'free' }),
      },
    ), {
      ALLOWED_ORIGIN: origin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.choice, 'free');
    assert.equal(payload.access.basis, 'daily_free');
    assert.equal(payload.access.dailyLimit, 5);
    assert.equal(payload.access.remainingToday, 5);
    assert.equal(payload.access.unlimited, false);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
