import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from './index.mjs';
import {
  AccessValidationError,
  accessDeniedError,
  normalizeAccessSnapshot,
} from './access-core.mjs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260827003000_paid_subscription_expiry_access.sql',
  import.meta.url,
), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const accountFrontend = readFileSync(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');

const origin = 'https://duediligence.ph';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function assertInOrder(source, markers, message) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${marker}`);
    assert.ok(next > cursor, `${message}: ${marker} is out of order`);
    cursor = next;
  }
}

function expiredAccess(overrides = {}) {
  return {
    allowed: false,
    basis: 'paid_subscription_expired',
    termsRequired: false,
    reauthenticationRequired: false,
    profileCompleted: true,
    tokenAcknowledgementRequired: false,
    choiceRequired: false,
    planSelectionRequired: false,
    paymentRequired: true,
    paidSubscriptionExpired: true,
    introductoryTokensEligible: false,
    role: 'student',
    accessMode: 'payment_required',
    accountLabel: 'Paid Bar access expired',
    unlimited: false,
    tokenLimit: 0,
    tokensUsed: 0,
    tokensReserved: 0,
    tokensRemaining: 0,
    checkoutOpen: true,
    priceCentavos: 14900,
    commercialLaunchEnabled: true,
    entitlementEndsAt: '2026-08-26T23:59:59+08:00',
    subscription: {
      id: '11111111-1111-4111-8111-111111111111',
      planCode: 'early_access_beta',
      status: 'expired',
      source: 'manual_payment',
      startsAt: '2026-07-26T00:00:00+08:00',
      expiresAt: '2026-08-26T23:59:59+08:00',
    },
    ...overrides,
  };
}

test('database access snapshot treats expired paid history as a permanent payment boundary', () => {
  assert.match(migration, /create index if not exists subscriptions_paid_expiry_lookup_idx/);
  assert.match(migration, /create or replace function public\.phase4_access_snapshot\(/);
  assert.match(migration, /source in \('manual_payment', 'admin_adjustment', 'migration'\)/);
  assert.match(migration, /expires_at is not null and expires_at <= v_now/);
  assert.match(migration, /p_activate_trial and v_introductory_tokens_eligible/);
  assert.match(migration, /if v_introductory_tokens_eligible then[\s\S]*insert into public\.introductory_token_grants/);
  assert.match(migration, /'paidSubscriptionExpired', v_basis = 'paid_subscription_expired'/);
  assert.match(migration, /'introductoryTokensEligible', v_introductory_tokens_eligible/);
  assert.match(migration, /'paymentRequired', v_basis in \('trial_tokens_exhausted', 'paid_subscription_expired'\)/);
  assert.match(migration, /when v_introductory_tokens_eligible then v_grant\.token_limit else 0 end/);
  assert.match(migration, /elsif not v_introductory_tokens_eligible\s+and v_subscription\.id is null\s+and v_payment\.id is null then/);
  assert.doesNotMatch(migration, /^\s*(?:drop\s+table|truncate)\b/gmi);
  assertInOrder(migration, [
    'elsif not v_introductory_tokens_eligible',
    'elsif not v_profile_complete',
    'elsif v_subscription.id is not null then',
    'elsif v_payment.id is not null then',
    'elsif v_remaining > 0 then',
  ], 'paid expiry must precede setup/token fallback while its guard preserves current paid access');
});

test('Worker normalizes paid expiry without reviving or advertising trial tokens', () => {
  const normalized = normalizeAccessSnapshot(expiredAccess({
    // Even a stale or compromised client-visible counter cannot revive access.
    tokenLimit: 5,
    tokensRemaining: 5,
    tokenGrantAt: '2026-08-01T00:00:00+08:00',
    tokenAcknowledgedAt: '2026-08-01T00:01:00+08:00',
    tokenAcknowledgementRequired: true,
    freeGrades: { limit: 5, used: 0, remaining: 5 },
  }));

  assert.equal(normalized.allowed, false);
  assert.equal(normalized.paymentRequired, true);
  assert.equal(normalized.paidSubscriptionExpired, true);
  assert.equal(normalized.introductoryTokensEligible, false);
  assert.equal(normalized.tokenLimit, 0);
  assert.equal(normalized.tokensRemaining, 0);
  assert.equal(normalized.tokenGrantAt, null);
  assert.equal(normalized.tokenAcknowledgedAt, null);
  assert.equal(normalized.tokenAcknowledgementRequired, false);
  assert.deepEqual(normalized.freeGrades, { limit: 0, used: 0, remaining: 0 });
  assert.equal(normalized.subscription.status, 'expired');

  const error = accessDeniedError(normalized);
  assert.ok(error instanceof AccessValidationError);
  assert.equal(error.code, 'PAID_SUBSCRIPTION_EXPIRED');
  assert.equal(error.status, 403);
  assert.match(error.message, /renew Early Access/i);
  assert.match(error.message, /Home and Examination Room remain available/i);
  assert.doesNotMatch(error.message, /five|trial token/i);
});

test('closed renewal checkout returns a working Support recovery instead of a dead payment CTA', () => {
  const normalized = normalizeAccessSnapshot(expiredAccess({ checkoutOpen: false }));
  const error = accessDeniedError(normalized);
  assert.equal(error.code, 'PAID_SUBSCRIPTION_EXPIRED');
  assert.match(error.message, /Open Support for renewal assistance/i);
  assert.doesNotMatch(error.message, /Renew Early Access to continue/i);
});

test('protected Bar question route trusts the backend expiry denial and makes no content call', async () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    upstreamCalls.push(target);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_activate_trial, true);
      return Response.json(expiredAccess());
    }
    throw new Error(`Expired access must not reach another upstream service: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'paid_expiry_test_20260827',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        requestId: 'paid_expiry_test_20260827',
      }),
    }), {
      ALLOWED_ORIGIN: origin,
      PHASE4_ACCESS_ENFORCEMENT: 'true',
      BAR_QUESTION_PRACTICE_RANDOMIZATION_V2_ENABLED: 'true',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, 'PAID_SUBSCRIPTION_EXPIRED');
    assert.match(payload.error.message, /renew Early Access/i);
    assert.equal(upstreamCalls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('access status returns a recoverable paid-expiry state with the expired subscription receipt', async () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    upstreamCalls.push(target);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(expiredAccess());
    }
    if (target.endsWith('/rest/v1/rpc/phase4_user_subscription_status')) {
      return Response.json({
        subscription: expiredAccess().subscription,
        pendingPayment: null,
      });
    }
    throw new Error(`Unexpected access-status upstream service: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/access', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
      },
      body: '{}',
    }), {
      ALLOWED_ORIGIN: origin,
      PHASE4_ACCESS_ENFORCEMENT: 'true',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.access.allowed, false);
    assert.equal(payload.access.basis, 'paid_subscription_expired');
    assert.equal(payload.access.paymentRequired, true);
    assert.equal(payload.access.tokensRemaining, 0);
    assert.equal(payload.access.subscription.status, 'expired');
    assert.equal(payload.access.subscriptionState.subscription.status, 'expired');
    assert.equal(upstreamCalls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser expiry recovery is explicit while Home and Examination Room stay outside the Bar gate', () => {
  const protectedRoutes = frontend.slice(
    frontend.indexOf('const PROTECTED_ROUTES'),
    frontend.indexOf('const state ='),
  );
  assert.match(frontend, /function paidSubscriptionExpired\(/);
  assert.match(frontend, /Renew Bar access/);
  assert.match(frontend, /Home and Examination Room remain available/);
  assert.match(frontend, /PAID_SUBSCRIPTION_EXPIRED/);
  assert.match(frontend, /paidSubscriptionExpired\(access\) && access\?\.checkoutOpen !== true/);
  assert.match(frontend, /legacy\.openView\?\.\(recoveryView/);
  assert.match(frontend, /recoveryView === 'support' \? 'dd2-support-category'/);
  assert.doesNotMatch(protectedRoutes, /['"](?:home|quorum|examination-room)['"]/);
  assert.match(frontend, /else if \(paymentRequired\(access\) && isProtectedRoute/);
  assert.match(accountFrontend, /Paid Bar access expired/);
  assert.match(accountFrontend, /Home and Examination Room remain available/);
  assert.match(accountFrontend, /original five-token allowance does not reset/);
  assert.match(accountFrontend, /Renew Early Access — ₱149/);
  assert.doesNotMatch(
    accountFrontend.slice(
      accountFrontend.indexOf('if (paidExpired) {', accountFrontend.indexOf('function accessSummaryMarkup')),
      accountFrontend.indexOf('const label = access?.accountLabel', accountFrontend.indexOf('function accessSummaryMarkup')),
    ),
    /of 5 one-time practice tokens remain/,
    'The expired-paid profile state must not advertise a revived token allowance.',
  );
});
