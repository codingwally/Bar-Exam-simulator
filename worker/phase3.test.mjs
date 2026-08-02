import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalyticsValidationError,
  analyticsRpcPayload,
  normalizeAnalyticsEvent,
} from './analytics-core.mjs';
import {
  ADMIN_DIRECTORY_EXPORT_MAX_BYTES,
  AdminValidationError,
  aggregateCsv,
  answerHistoryCsv,
  normalizeAnswerHistoryPreviewRequest,
  normalizeAnswerHistoryRequest,
  normalizeAdminAction,
  normalizeDashboardRequest,
  normalizeGlobalBetaChange,
  normalizeLiveActivityRequest,
  normalizeOperationalRequest,
  normalizeQuorumPostsRequest,
  normalizeUserDirectoryEmailExport,
  normalizeUserDirectoryRequest,
  normalizeUserResponseExport,
  resolveAdminDirectoryRecipient,
  safeCsvCell,
  subscriptionDirectoryCsv,
  userDirectoryCsv,
  userResponsesCsv,
  withUtf8Bom,
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
  assert.equal(safeCsvCell(' \t=IMPORTDATA("https://evil.invalid")').startsWith("\"' \t="), true);
  assert.equal(safeCsvCell('\u0007@SUM(1,1)').startsWith("\"'\u0007@"), true);
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

test('user directory requests are bounded and exports use the fixed secure limit', () => {
  const dashboard = normalizeUserDirectoryRequest({
    search: 'student@example.com',
    limit: 999,
    offset: 10,
    requestKey: 'directoryrequest0001',
  });
  assert.deepEqual(dashboard, {
    search: 'student@example.com',
    limit: 100,
    offset: 10,
    requestKey: 'directoryrequest0001',
    accessPurpose: 'dashboard',
  });
  const exported = normalizeUserDirectoryRequest({
    search: '',
    requestKey: 'directoryrequest0002',
  }, 'csv_export');
  assert.equal(exported.limit, 5000);
  assert.equal(exported.offset, 0);
  assert.throws(() => normalizeUserDirectoryRequest({
    requestKey: 'short',
  }), AdminValidationError);
});

test('user directory CSV includes full identity and remains spreadsheet-safe', () => {
  const csv = withUtf8Bom(userDirectoryCsv([{
    id: '30000000-0000-4000-8000-000000000001',
    display_name: '=HYPERLINK("https://invalid.example")',
    email: 'student.one@example.com',
    school: '\t=IMPORTDATA("https://invalid.example")',
    enrollment_status: 'enrolled',
    year_level: '1L',
    role: 'student',
    subscription_category: '+Beta Tester',
    subscription_plan: 'beta',
    subscription_status: 'active',
    beta_all_access_enabled: true,
    effective_access: 'Beta All Access',
    created_at: '2026-08-01T00:00:00Z',
    profile_completed_at: '2026-08-01T00:01:00Z',
    last_sign_in_at: '2026-08-01T00:01:30Z',
    last_active_at: '2026-08-01T00:02:00Z',
    active_in_last_5_minutes: true,
    active_in_last_30_minutes: true,
    current_page_area: 'mock_bar',
    current_device_category: 'mobile',
    session_count: 2,
    answered_question_count: 5,
    practice_answered_count: 3,
    examination_answered_count: 2,
    last_answered_at: '2026-08-01T00:02:30Z',
    graded_answer_count: 3,
    average_score: 4.1,
    latest_score: 4.5,
    last_graded_at: '2026-08-01T00:03:00Z',
    marketing_consent: false,
  }]));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1).split('\r\n')[0], [
    'User record ID', 'Name', 'Email', 'School', 'Enrollment status',
    'Year level', 'Admin access', 'Subscription category', 'Subscription plan',
    'Subscription status', 'Beta All Access', 'Effective access', 'Joined at',
    'Profile completed at', 'Last signed in', 'Questions answered', 'Practice questions answered',
    'Examination questions answered', 'Last answered at', 'Graded answers',
    'Average score', 'Latest score', 'Last graded at', 'Marketing consent',
  ].map((value) => `"${value}"`).join(','));
  assert.match(csv, /"student\.one@example\.com"/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\t=IMPORTDATA/);
  assert.match(csv, /"'\+Beta Tester"/);
});

test('subscription CSV is decision-ready, minimized, and spreadsheet-safe', () => {
  const csv = subscriptionDirectoryCsv([{
    id: '30000000-0000-4000-8000-000000000001',
    display_name: '=HYPERLINK("https://invalid.example")',
    email: '+student.one@example.com',
    role: 'student',
    subscription_category: '@Beta Tester',
    subscription_plan: '-beta',
    subscription_status: 'active',
    beta_all_access_enabled: true,
    effective_access: 'Beta All Access',
    subscription_starts_at: '2026-08-01T00:00:00Z',
    subscription_expires_at: null,
    last_sign_in_at: '2026-08-01T00:01:30Z',
    answered_question_count: 5,
    school: 'Must not be exported',
    enrollment_status: 'Must not be exported',
    marketing_consent: true,
  }]);
  const header = csv.split('\r\n')[0];
  assert.equal(header, [
    'User record ID', 'Name', 'Email', 'Admin access', 'Subscription category',
    'Subscription plan', 'Subscription status', 'Beta All Access',
    'Current access', 'Subscription starts at', 'Subscription expires at',
    'Last signed in', 'Questions answered',
  ].map((value) => `"${value}"`).join(','));
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\+student\.one@example\.com"/);
  assert.match(csv, /"'@Beta Tester"/);
  assert.match(csv, /"'-beta"/);
  assert.doesNotMatch(csv, /School|Enrollment status|Marketing consent|Must not be exported/);
});

test('live activity and Quorum post requests are bounded and reject unsupported input', () => {
  assert.deepEqual(normalizeLiveActivityRequest({
    limit: 999,
    requestKey: 'liveactivitykey0001',
  }), {
    limit: 100,
    requestKey: 'liveactivitykey0001',
  });
  assert.throws(() => normalizeLiveActivityRequest({
    limit: 10,
    requestKey: 'liveactivitykey0002',
    email: 'not-accepted@example.com',
  }), AdminValidationError);
  assert.throws(() => normalizeLiveActivityRequest({
    requestKey: 'short',
  }), AdminValidationError);

  assert.deepEqual(normalizeQuorumPostsRequest({
    search: ' admissions ',
    status: 'VISIBLE',
    limit: 999,
    offset: -4,
    requestKey: 'quorumpostskey0001',
  }), {
    search: 'admissions',
    status: 'visible',
    limit: 100,
    offset: 0,
    requestKey: 'quorumpostskey0001',
  });
  assert.throws(() => normalizeQuorumPostsRequest({
    status: 'unreviewed',
    requestKey: 'quorumpostskey0002',
  }), AdminValidationError);
  assert.throws(() => normalizeQuorumPostsRequest({
    status: 'all',
    requestKey: 'quorumpostskey0003',
    actorUserId: 'not-client-controlled',
  }), AdminValidationError);
});

test('global Beta All Access changes require an exact boolean and confirmation', () => {
  const change = normalizeGlobalBetaChange({
    enabled: false,
    reason: 'Founder approved fallback testing',
    requestKey: 'globalbetachange0001',
    confirmed: true,
  });
  assert.equal(change.enabled, false);
  assert.throws(() => normalizeGlobalBetaChange({
    ...change,
    enabled: 'false',
  }), AdminValidationError);
  assert.throws(() => normalizeGlobalBetaChange({
    ...change,
    confirmed: false,
  }), AdminValidationError);
});

test('private directory email export accepts only allowlisted founder keys', () => {
  const request = normalizeUserDirectoryEmailExport({
    recipientKey: 'gilmar',
    search: '',
    reason: 'Founder requested private user directory',
    requestKey: 'directoryemail0001',
    confirmed: true,
  });
  assert.equal(request.limit, 5000);
  assert.equal(request.recipientKey, 'gilmar');
  const configured = JSON.stringify({ gilmar: 'Founder.Personal@example.com' });
  assert.equal(
    resolveAdminDirectoryRecipient(configured, request.recipientKey),
    'founder.personal@example.com',
  );
  assert.equal(resolveAdminDirectoryRecipient(configured, 'unknown'), null);
  assert.equal(ADMIN_DIRECTORY_EXPORT_MAX_BYTES, 5 * 1024 * 1024);
});

test('answer-history export is bounded and its CSV preserves provenance fields', () => {
  const request = normalizeAnswerHistoryRequest({
    from: '2026-01-01T00:00:00Z',
    to: '2026-08-01T00:00:00Z',
    reason: 'Founder requested answer history',
    requestKey: 'answerhistory00001',
    confirmed: true,
  }, 'csv_export');
  assert.equal(request.targetUserId, null);
  assert.equal(request.limit, 5000);
  assert.equal(request.confirmed, true);
  const allTime = normalizeAnswerHistoryRequest({
    reason: 'Founder requested complete answer history',
    requestKey: 'answerhistory00003',
    confirmed: true,
  }, 'csv_export');
  assert.equal(allTime.from, null);
  assert.equal(allTime.to, null);
  assert.throws(() => normalizeAnswerHistoryRequest({
    from: '2026-01-01T00:00:00Z',
    to: null,
    reason: 'Founder requested answer history',
    requestKey: 'answerhistory00004',
    confirmed: true,
  }, 'csv_export'), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryRequest({
    reason: 'Founder requested complete answer history',
    requestKey: 'answerhistory00005',
  }, 'csv_export'), AdminValidationError);
  const csv = answerHistoryCsv([{
    recordSource: 'formal_examination',
    userDisplayName: '@Student One',
    userEmail: 'student@example.com',
    subscriptionCategory: '-Beta Tester',
    questionText: '=FORMULA()',
    submittedAnswer: '+answer',
    suggestedAnswerStatus: 'available',
    modelAnswerStatus: 'available',
  }]);
  assert.match(csv, /"User email"/);
  assert.match(csv, /"Name"/);
  assert.match(csv, /"Subscription category"/);
  assert.match(csv, /"Suggested answer availability"/);
  assert.match(csv, /"Model answer availability"/);
  assert.match(csv, /"'@Student One"/);
  assert.match(csv, /"'-Beta Tester"/);
  assert.match(csv, /"'=FORMULA\(\)"/);
  assert.match(csv, /"'\+answer"/);
});

test('answer-history preview strictly validates filters and pagination', () => {
  const request = normalizeAnswerHistoryPreviewRequest({
    targetUserId: '30000000-0000-4000-8000-000000000001',
    from: '2026-07-01T00:00:00Z',
    to: '2026-08-01T00:00:00Z',
    search: 'student@example.com',
    recordSource: 'formal_exam',
    limit: 50,
    offset: 100,
    requestKey: 'answerpreview000001',
  });
  assert.deepEqual(request, {
    targetUserId: '30000000-0000-4000-8000-000000000001',
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-08-01T00:00:00.000Z',
    search: 'student@example.com',
    recordSource: 'formal_exam',
    limit: 50,
    offset: 100,
    requestKey: 'answerpreview000001',
  });
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    recordSource: 'examination',
    requestKey: 'answerpreview000002',
  }), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    limit: 101,
    requestKey: 'answerpreview000003',
  }), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    limit: '100',
    requestKey: 'answerpreview000004',
  }), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    search: 'x'.repeat(181),
    requestKey: 'answerpreview000005',
  }), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    search: 'student\u0000email',
    requestKey: 'answerpreview000007',
  }), AdminValidationError);
  assert.throws(() => normalizeAnswerHistoryPreviewRequest({
    offset: -1,
    requestKey: 'answerpreview000006',
  }), AdminValidationError);
});

test('user response export validates target, reason, request key, and bounded dates', () => {
  const normalized = normalizeUserResponseExport({
    targetUserId: '30000000-0000-4000-8000-000000000001',
    reason: 'Founder quality review',
    requestKey: 'responseexportkey0001',
    from: '2026-01-01T00:00:00Z',
    to: '2026-08-01T00:00:00Z',
  });
  assert.equal(normalized.limit, 2000);
  assert.throws(() => normalizeUserResponseExport({
    ...normalized,
    reason: 'no',
  }), AdminValidationError);
  assert.throws(() => normalizeUserResponseExport({
    ...normalized,
    to: '2027-08-02T00:00:00Z',
  }), AdminValidationError);
});

test('targeted response CSV includes server identity and neutralizes every spreadsheet formula cell', () => {
  const csv = userResponsesCsv([{
    recordSource: 'practice',
    userId: '30000000-0000-4000-8000-000000000001',
    attemptId: '40000000-0000-4000-8000-000000000001',
    examTitle: 'Mock Bar',
    subject: 'Labor Law',
    questionId: 'LAB-001',
    questionText: '=WEBSERVICE("https://invalid.example")',
    questionProvenance: 'current_published_bank',
    studentAnswer: '+SUM(1,1)',
    status: 'completed',
    score: 4.2,
    timerMode: 'selfPaced',
    elapsedSeconds: 12,
    submittedAt: '2026-08-01T00:00:00Z',
    completedAt: '2026-08-01T00:01:00Z',
  }], { email: 'student.one@example.com', displayName: 'Student One' });
  assert.match(csv, /^"User email","Name"/);
  assert.match(csv, /"student\.one@example\.com","Student One"/);
  assert.match(csv, /"'=WEBSERVICE/);
  assert.match(csv, /"'\+SUM/);
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

test('protected Admin console remains reachable independently of the private-beta gate', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return Response.json({ role: 'founder_admin', displayName: 'Founder Admin' });
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
    }), { ...workerEnv, PRIVATE_BETA_GATE_ENABLED: 'true' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).role, 'founder_admin');
    assert.equal(calls.some((url) => url.endsWith('/private_beta_access_snapshot')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authorized Students directory returns full emails through the protected RPC', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_user_engagement_directory')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        tooMany: false,
        items: [{
          id: '30000000-0000-4000-8000-000000000001',
          display_name: 'Student One',
          email: 'student.one@example.com',
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-directory', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        search: 'student.one@example.com',
        limit: 100,
        offset: 0,
        requestKey: 'directoryrequest0003',
      }),
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_actor_user_id, '91000000-0000-4000-8000-000000000001');
    assert.equal(rpcBody.p_access_purpose, 'dashboard');
    assert.equal(rpcBody.p_search, 'student.one@example.com');
    const body = await response.json();
    assert.equal(body.data.items[0].email, 'student.one@example.com');
    assert.equal(JSON.stringify(rpcBody).includes('service-role'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authorized Students CSV is complete, private, BOM-prefixed, and spreadsheet-safe', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_user_engagement_directory')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        total: 1,
        limit: 5000,
        offset: 0,
        hasMore: false,
        tooMany: false,
        items: [{
          id: '30000000-0000-4000-8000-000000000001',
          display_name: 'Student One',
          email: 'student.one@example.com',
          school: ' \t=IMPORTDATA("https://invalid.example")',
          role: 'student',
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-directory/export', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({ search: '', requestKey: 'directoryrequest0004' }),
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_access_purpose, 'csv_export');
    assert.equal(rpcBody.p_limit, 5000);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Pragma'), 'no-cache');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    assert.match(csv, /"student\.one@example\.com"/);
    assert.match(csv, /"' \t=IMPORTDATA/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Subscriptions CSV uses the protected directory and exports only subscription fields', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_user_engagement_directory')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        total: 1,
        limit: 5000,
        offset: 0,
        hasMore: false,
        tooMany: false,
        items: [{
          id: '30000000-0000-4000-8000-000000000001',
          display_name: '=Student One',
          email: '+student.one@example.com',
          role: 'student',
          subscription_category: '@Beta Tester',
          subscription_plan: '-beta',
          subscription_status: 'active',
          beta_all_access_enabled: true,
          effective_access: 'Beta All Access',
          subscription_starts_at: '2026-08-01T00:00:00Z',
          subscription_expires_at: null,
          last_sign_in_at: '2026-08-01T00:01:30Z',
          answered_question_count: 5,
          school: 'Must not be exported',
          marketing_consent: true,
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/subscriptions/export', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({ search: 'student', requestKey: 'subscriptionexport001' }),
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_access_purpose, 'csv_export');
    assert.equal(rpcBody.p_search, 'student');
    assert.equal(rpcBody.p_limit, 5000);
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="due-diligence-subscriptions.csv"');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Pragma'), 'no-cache');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    assert.match(csv, /"Subscription category"/);
    assert.match(csv, /"'=Student One"/);
    assert.match(csv, /"'\+student\.one@example\.com"/);
    assert.match(csv, /"'@Beta Tester"/);
    assert.match(csv, /"'-beta"/);
    assert.doesNotMatch(csv, /School|Marketing consent|Must not be exported/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Students CSV refuses to silently truncate more than 5,000 matches', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_user_engagement_directory')) {
      return Response.json({
        total: 5001,
        limit: 5000,
        offset: 0,
        hasMore: true,
        tooMany: true,
        items: [],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-directory/export', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({ search: '', requestKey: 'directoryrequest0005' }),
    }), workerEnv);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, 'ADMIN_EXPORT_TOO_LARGE');
    assert.match(body.error.message, /Narrow the search/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('founder user-response export enriches saved answer evidence without broad directory lookups', async () => {
  const originalFetch = globalThis.fetch;
  const targetUserId = '30000000-0000-4000-8000-000000000001';
  let rpcBody;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_export_answer_history_with_sources')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        total: 2,
        tooMany: false,
        items: [{
          recordSource: 'practice',
          userId: targetUserId,
          userDisplayName: 'Student One',
          userEmail: 'student.one@example.com',
          subscriptionCategory: 'Beta Tester',
          attemptId: '40000000-0000-4000-8000-000000000001',
          examTitle: 'Mock Bar',
          subject: 'Labor Law',
          questionId: 'LAB-001',
          questionText: null,
          questionTextSource: 'external_question_bank_not_persisted',
          questionTextStatus: 'unavailable_exact_historic_text',
          submittedAnswer: '+SUM(1,1)',
          answerStatus: 'completed',
          score: 4.2,
          suggestedAnswer: null,
          suggestedAnswerStatus: 'not_persisted_with_practice_attempt',
          timerMode: 'selfPaced',
          elapsedSeconds: 60,
          submittedAt: '2026-08-01T00:00:00Z',
          completedAt: '2026-08-01T00:01:00Z',
          resultSources: [{ title: 'Saved result authority', url: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69528' }],
        }, {
          recordSource: 'formal_exam',
          userId: targetUserId,
          userDisplayName: 'Student One',
          userEmail: 'student.one@example.com',
          subscriptionCategory: 'Beta Tester',
          attemptId: '50000000-0000-4000-8000-000000000001',
          examTitle: 'Civil Law Midterm',
          subject: 'Civil Law',
          questionId: 'CIV-001',
          questionText: '=Exact immutable prompt snapshot',
          questionTextSource: 'immutable_exam_snapshot',
          questionTextStatus: 'available',
          submittedAnswer: '@answer',
          answerStatus: 'submitted',
          score: null,
          modelAnswer: '+Exact immutable model answer snapshot',
          modelAnswerSource: 'immutable_exam_snapshot',
          modelAnswerStatus: 'available',
          timerMode: 'strict',
          elapsedSeconds: 1200,
          submittedAt: '2026-08-01T00:02:00Z',
          completedAt: '2026-08-01T00:02:00Z',
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-responses/export', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        targetUserId,
        reason: 'Authorized founder quality review',
        requestKey: 'responseexportkey0002',
        from: '2026-01-01T00:00:00Z',
        to: '2026-08-02T00:00:00Z',
      }),
    }), { ...workerEnv, WEBSITE_BANK_URL: 'https://bank.example/website-bank.json' });
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_target_user_id, targetUserId);
    assert.equal(rpcBody.p_actor_user_id, '91000000-0000-4000-8000-000000000001');
    assert.equal(rpcBody.p_limit, 2000);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Disposition'), new RegExp(targetUserId));
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    assert.match(csv, /"Name","User email"/);
    assert.match(csv, /"Student One","student\.one@example\.com"/);
    assert.match(csv, /available_current_published_record/);
    assert.match(csv, /current_published_question_bank/);
    assert.match(csv, /immutable_exam_snapshot/);
    assert.match(csv, /"'\+SUM/);
    assert.match(csv, /"'=Exact immutable prompt snapshot"/);
    assert.match(csv, /"'@answer/);
    assert.match(csv, /"'\+Exact immutable model answer snapshot"/);
    assert.match(csv, /A, an extremely talented digital artist/);
    assert.match(csv, /A was constructively dismissed/);
    assert.match(csv, /elibrary\.judiciary\.gov\.ph/);
    assert.equal(calls.some((url) => url === 'https://bank.example/website-bank.json'), true);
    assert.equal(calls.some((url) => url.includes('admin_user_engagement_directory')), false);
    assert.equal(calls.some((url) => url.includes('admin_user_directory')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('admin dashboard includes all-time signed-in and answer engagement metrics', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_dashboard_snapshot')) {
      return Response.json({ meta: { freshness: 'current' } });
    }
    if (url.endsWith('/rest/v1/rpc/admin_overview_engagement_metrics')) {
      return Response.json({
        scope: 'all_time',
        signedInAccounts: 27,
        usersWithAnswers: 8,
        questionsAnswered: 41,
      });
    }
    if (url.endsWith('/rest/v1/rpc/phase4_global_beta_policy_snapshot')) {
      return Response.json({
        enabled: true,
        scope: 'all_current_and_future_signed_in_users',
        expiresAt: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/dashboard', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        from: '2026-07-01T00:00:00Z',
        to: '2026-08-01T00:00:00Z',
        previousFrom: '2026-06-01T00:00:00Z',
        previousTo: '2026-07-01T00:00:00Z',
      }),
    }), workerEnv);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.engagement.signedInAccounts, 27);
    assert.equal(body.report.engagement.questionsAnswered, 41);
    assert.equal(body.report.betaAllAccess.enabled, true);
    assert.equal(calls.some((url) => url.endsWith('/admin_overview_engagement_metrics')), true);
    assert.equal(calls.some((url) => url.endsWith('/phase4_global_beta_policy_snapshot')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('global Beta All Access admin status and change use dedicated founder RPCs', async () => {
  const originalFetch = globalThis.fetch;
  const rpcBodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/phase4_global_beta_policy_snapshot')) {
      rpcBodies.push({ operation: 'status', ...JSON.parse(init.body) });
      return Response.json({ enabled: true, expiresAt: null, version: 1 });
    }
    if (url.endsWith('/rest/v1/rpc/phase4_admin_set_global_beta_all_access')) {
      rpcBodies.push({ operation: 'change', ...JSON.parse(init.body) });
      return Response.json({ enabled: false, changed: true, replayed: false, version: 2 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const env = { ...workerEnv, PRIVATE_BETA_GATE_ENABLED: 'true' };
  try {
    const status = await worker.fetch(new Request('https://worker.example/admin/global-beta', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: '{}',
    }), env);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).policy.enabled, true);

    const changed = await worker.fetch(new Request('https://worker.example/admin/global-beta/change', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        enabled: false,
        reason: 'Founder approved fallback testing',
        requestKey: 'globalbetachange0002',
        confirmed: true,
      }),
    }), env);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).policy.enabled, false);
    assert.equal(rpcBodies[1].p_enabled, false);
    assert.equal(rpcBodies[1].p_request_key, 'globalbetachange0002');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual founder directory email sends one private CSV attachment and records delivery', async () => {
  const originalFetch = globalThis.fetch;
  let emailRequest;
  let deliveryReceipt;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_prepare_user_directory_email_export')) {
      return Response.json({
        total: 1,
        tooMany: false,
        items: [{
          id: '30000000-0000-4000-8000-000000000001',
          display_name: 'Student One',
          email: 'student.one@example.com',
          answered_question_count: 4,
        }],
      });
    }
    if (url === 'https://api.resend.com/emails') {
      emailRequest = {
        headers: init.headers,
        body: JSON.parse(init.body),
      };
      return Response.json({ id: 'email-provider-id-1' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_record_user_directory_email_delivery')) {
      deliveryReceipt = JSON.parse(init.body);
      return Response.json({ recorded: true, status: 'sent' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-directory/email', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        recipientKey: 'gilmar',
        search: '',
        reason: 'Founder requested private user directory',
        requestKey: 'directoryemail0002',
        confirmed: true,
      }),
    }), {
      ...workerEnv,
      ADMIN_DIRECTORY_EMAIL_MODE: 'enabled',
      ADMIN_DIRECTORY_EMAIL_FROM: 'Due Diligence <reports@duediligence.ph>',
      ADMIN_DIRECTORY_RECIPIENTS_JSON: JSON.stringify({
        gilmar: 'founder.personal@example.com',
      }),
      RESEND_API_KEY: 'synthetic-resend-key',
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.delivery, {
      status: 'sent',
      recipientKey: 'gilmar',
      resultCount: 1,
    });
    assert.deepEqual(emailRequest.body.to, ['founder.personal@example.com']);
    assert.equal(emailRequest.body.attachments.length, 1);
    assert.equal(emailRequest.headers['Idempotency-Key'], 'admin-directory-directoryemail0002');
    const csv = new TextDecoder().decode(Uint8Array.from(
      atob(emailRequest.body.attachments[0].content),
      (character) => character.charCodeAt(0),
    ));
    assert.match(csv, /student\.one@example\.com/);
    assert.equal(deliveryReceipt.p_status, 'sent');
    assert.equal(deliveryReceipt.p_recipient_key, 'gilmar');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('replayed founder directory email request returns 409 without sending or recording delivery again', async () => {
  const originalFetch = globalThis.fetch;
  let emailSendCount = 0;
  let deliveryRecordCount = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_prepare_user_directory_email_export')) {
      return Response.json({
        alreadyPrepared: true,
        total: 1,
        tooMany: false,
        items: [{
          id: '30000000-0000-4000-8000-000000000001',
          email: 'student.one@example.com',
        }],
      });
    }
    if (url === 'https://api.resend.com/emails') {
      emailSendCount += 1;
      return Response.json({ id: 'must-not-be-sent' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_record_user_directory_email_delivery')) {
      deliveryRecordCount += 1;
      return Response.json({ recorded: true, status: 'sent' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/user-directory/email', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        recipientKey: 'gilmar',
        search: '',
        reason: 'Founder requested private user directory',
        requestKey: 'directoryemail0003',
        confirmed: true,
      }),
    }), {
      ...workerEnv,
      ADMIN_DIRECTORY_EMAIL_MODE: 'enabled',
      ADMIN_DIRECTORY_EMAIL_FROM: 'Due Diligence <reports@duediligence.ph>',
      ADMIN_DIRECTORY_RECIPIENTS_JSON: JSON.stringify({
        gilmar: 'founder.personal@example.com',
      }),
      RESEND_API_KEY: 'synthetic-resend-key',
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'ADMIN_EXPORT_ALREADY_PROCESSED');
    assert.match(body.error.message, /already processed/i);
    assert.equal(emailSendCount, 0);
    assert.equal(deliveryRecordCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('founder answer-history preview shows current approved practice content and saved links', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_preview_answer_history_with_sources')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        scope: 'all_users',
        dateScope: 'all_time',
        total: 102,
        limit: 2,
        offset: 100,
        hasMore: false,
        items: [{
          recordSource: 'practice',
          userDisplayName: 'Student One',
          userEmail: 'student.one@example.com',
          subscriptionCategory: 'Beta Tester',
          questionId: 'LAB-001',
          questionText: null,
          questionTextSource: 'external_question_bank_not_persisted',
          questionTextStatus: 'unavailable_exact_historic_text',
          submittedAnswer: 'Persisted answer',
          suggestedAnswer: null,
          suggestedAnswerStatus: 'not_persisted_with_practice_attempt',
          resultSources: [{ title: 'Saved result authority', url: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69528' }],
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/answer-history', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        targetUserId: null,
        from: null,
        to: null,
        search: 'student',
        recordSource: 'practice',
        limit: 2,
        offset: 100,
      }),
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_search, 'student');
    assert.equal(rpcBody.p_record_source, 'practice');
    assert.equal(rpcBody.p_limit, 2);
    assert.equal(rpcBody.p_offset, 100);
    assert.match(rpcBody.p_request_key, /^[A-Za-z0-9_-]{16,128}$/);
    const body = await response.json();
    assert.equal(body.data.total, 102);
    assert.equal(body.data.offset, 100);
    assert.equal(body.data.hasMore, false);
    assert.match(body.data.items[0].questionText, /extremely talented digital artist/);
    assert.equal(
      body.data.items[0].questionTextStatus,
      'available_current_published_record',
    );
    assert.match(body.data.items[0].suggestedAnswer, /constructively dismissed/);
    assert.equal(body.data.items[0].displaySourceLinks[0].url, 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69528');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('answer-history preview rejects unsupported filters before storage access', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/answer-history', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({ recordSource: 'raw_table' }),
    }), workerEnv);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_ADMIN_REQUEST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('founder answer-history export includes approved practice context and source links', async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '91000000-0000-4000-8000-000000000001' });
    }
    if (url.endsWith('/rest/v1/rpc/admin_export_answer_history_with_sources')) {
      rpcBody = JSON.parse(init.body);
      return Response.json({
        scope: 'all_users',
        total: 1,
        tooMany: false,
        items: [{
          recordSource: 'practice',
          userDisplayName: '=Student One',
          userEmail: 'student.one@example.com',
          subscriptionCategory: '@Beta Tester',
          questionId: 'LAB-001',
          questionText: null,
          questionTextSource: 'external_question_bank_not_persisted',
          questionTextStatus: 'unavailable_exact_historic_text',
          submittedAnswer: '+ANSWER',
          score: 4,
          suggestedAnswer: null,
          suggestedAnswerStatus: 'not_persisted_with_practice_attempt',
          modelAnswer: null,
          modelAnswerStatus: 'not_applicable_to_practice_attempt',
          resultSources: [{ title: 'Saved result authority', url: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69528' }],
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/admin/answer-history/export', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-user-token',
      },
      body: JSON.stringify({
        from: null,
        to: null,
        reason: 'Founder requested answer history',
        requestKey: 'answerhistory00002',
        confirmed: true,
      }),
    }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_target_user_id, null);
    assert.equal(rpcBody.p_from, null);
    assert.equal(rpcBody.p_to, null);
    assert.equal(rpcBody.p_limit, 5000);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    assert.match(csv, /student\.one@example\.com/);
    assert.match(csv, /"'=Student One"/);
    assert.match(csv, /"'@Beta Tester"/);
    assert.match(csv, /"'\+ANSWER"/);
    assert.match(csv, /available_current_published_record/);
    assert.match(csv, /current_published_question_bank/);
    assert.match(csv, /extremely talented digital artist/);
    assert.match(csv, /elibrary\.judiciary\.gov\.ph/);
    assert.equal(calls.some((url) => url.includes('admin_user_engagement_directory')), false);
    assert.equal(calls.some((url) => url.includes('admin_user_directory')), false);
    assert.equal(calls.some((url) => url.includes('question-bank')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
