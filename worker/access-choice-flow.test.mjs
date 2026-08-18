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
    dailyLimit: 0,
    completedToday: 5,
    reservedToday: 0,
    remainingToday: 0,
    checkoutOpen: true,
    priceCentavos: 14900,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: true,
    trialAvailable: true,
    trialEndsAt: '2026-09-01T15:59:59Z',
    trial: {
      active: false,
      program: null,
      startedAt: null,
      expiresAt: null,
    },
    freeGrades: { limit: 0, used: 0, remaining: 0 },
  });

  assert.equal(access.allowed, false);
  assert.equal(access.choiceRequired, true);
  assert.equal(access.trialAvailable, true);
  assert.equal(access.dailyLimit, 0);
  assert.equal(access.freeGrades.limit, 0);
  assert.equal(access.remainingToday, 0);

  assert.throws(
    () => { throw accessDeniedError(access); },
    (error) => (
      error instanceof AccessValidationError
      && error.code === 'ACCESS_CHOICE_REQUIRED'
      && /Free Trial or ₱149 Early Access/.test(error.message)
    ),
  );
});

test('an active launch trial is unlimited and no longer requires a choice', () => {
  const access = normalizeAccessSnapshot({
    allowed: true,
    basis: 'launch_trial',
    termsRequired: false,
    profileCompleted: true,
    choiceRequired: false,
    role: 'student',
    accessMode: 'trial',
    accountLabel: 'Free Trial',
    unlimited: true,
    dailyLimit: 0,
    remainingToday: 0,
    commercialLaunchEnabled: true,
    mandatoryAccessChoiceEnabled: true,
    trialAvailable: false,
    trialEndsAt: '2026-09-01T15:59:59Z',
    trial: {
      active: true,
      program: 'commercial_launch_2026',
      startedAt: '2026-08-18T00:00:00Z',
      expiresAt: '2026-09-01T15:59:59Z',
    },
    freeGrades: { limit: 0, used: 0, remaining: 0 },
  });

  assert.equal(access.allowed, true);
  assert.equal(access.unlimited, true);
  assert.equal(access.choiceRequired, false);
  assert.equal(access.trial.active, true);
  assert.equal(access.trial.program, 'commercial_launch_2026');
});

test('the authenticated access-choice endpoint starts the Free Trial', async () => {
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
        basis: 'launch_trial',
        termsRequired: false,
        profileCompleted: true,
        choiceRequired: false,
        role: 'student',
        accessMode: 'trial',
        accountLabel: 'Free Trial',
        unlimited: true,
        dailyLimit: 0,
        remainingToday: 0,
        commercialLaunchEnabled: true,
        mandatoryAccessChoiceEnabled: true,
        trialAvailable: false,
        trialEndsAt: '2026-09-01T15:59:59Z',
        trial: {
          active: true,
          program: 'commercial_launch_2026',
          expiresAt: '2026-09-01T15:59:59Z',
        },
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
        body: JSON.stringify({ choice: 'free_trial' }),
      },
    ), {
      ALLOWED_ORIGIN: origin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.choice, 'free_trial');
    assert.equal(payload.access.basis, 'launch_trial');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
