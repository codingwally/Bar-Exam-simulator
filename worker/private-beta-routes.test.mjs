import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import { hmacHex } from './private-beta-core.mjs';

const origin = 'https://duediligence.ph';
const workerUrl = 'https://worker.example';
const supabaseUrl = 'https://project.example.supabase.co';
const userId = '10000000-0000-4000-8000-000000000001';
const disclosureVersion = 'beta-disclosure-v1-2026-07-31';
const testCode = 'test-private-beta-code';
const codePepper = 'test-private-beta-code-pepper-with-32-bytes-minimum';
const signingKey = 'test-private-beta-flow-key-with-at-least-32-bytes';
const serviceRolePlaceholder = ['test', 'service-role', 'placeholder'].join('-');

function request(path, body, headers = {}) {
  return new Request(`${workerUrl}${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-DD-Beta-Flow-ID': 'private-beta-test-flow-000001',
      ...headers,
    },
    body: JSON.stringify(body || {}),
  });
}

async function responseJson(response) {
  return {
    status: response.status,
    body: await response.json(),
  };
}

function acknowledgements() {
  return {
    aiLimitations: true,
    educationalOnly: true,
    termsAndPrivacy: true,
  };
}

test('private-beta flow is server verified, user bound, and gates existing routes', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    calls.push(target);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: userId, email: 'beta@example.invalid' });
    }
    if (target.endsWith('/rest/v1/rpc/private_beta_evaluate_code_attempt')) {
      const payload = JSON.parse(String(init.body || '{}'));
      return Response.json({
        allowed: payload.p_code_valid === true,
        blocked: false,
      });
    }
    if (target.endsWith('/rest/v1/rpc/private_beta_complete_admission')) {
      return Response.json({
        admitted: true,
        admissionKind: 'beta_tester',
        disclosureVersion,
      });
    }
    if (target.endsWith('/rest/v1/rpc/private_beta_access_snapshot')) {
      return Response.json({
        allowed: true,
        admissionKind: 'beta_tester',
        disclosureVersion,
        expiresAt: '2026-07-31T20:00:00.000Z',
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json({
        allowed: true,
        basis: 'free_beta',
        termsRequired: false,
        role: 'beta_tester',
        trial: { active: false },
        freeGrades: { limit: 3, used: 0, remaining: 3 },
        freeBeta: { enabled: true, active: true },
        subscription: null,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_user_subscription_status')) {
      return Response.json({
        subscription: null,
        pendingPayment: null,
        examinationBeta: { active: true },
      });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const env = {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'true',
    PRIVATE_BETA_DISCLOSURE_VERSION: disclosureVersion,
    PRIVATE_BETA_ACCESS_CODE_VERIFIER: await hmacHex(codePepper, testCode),
    PRIVATE_BETA_ACCESS_CODE_PEPPER: codePepper,
    PRIVATE_BETA_FLOW_SIGNING_KEY: signingKey,
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    PUBLIC_PRICING_ENABLED: 'false',
  };

  const verified = await responseJson(await worker.fetch(request(
    '/beta/access/verify',
    {
      disclosureVersion,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
      accessCode: testCode,
    },
  ), env, {}));
  assert.equal(verified.status, 200);
  assert.equal(verified.body.ok, true);
  assert.equal(typeof verified.body.pending.token, 'string');
  assert.equal(JSON.stringify(verified.body).includes(testCode), false);

  const completed = await responseJson(await worker.fetch(request(
    '/beta/access/complete',
    {
      pendingToken: verified.body.pending.token,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
    },
    { Authorization: 'Bearer valid-supabase-session' },
  ), env, {}));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.access.allowed, true);
  assert.equal(completed.body.access.admissionKind, 'beta_tester');
  assert.equal(typeof completed.body.access.token, 'string');

  const status = await responseJson(await worker.fetch(request(
    '/beta/access/status',
    {},
    {
      Authorization: 'Bearer valid-supabase-session',
      'X-DD-Beta-Access': completed.body.access.token,
    },
  ), env, {}));
  assert.equal(status.status, 200);
  assert.equal(status.body.access.allowed, true);

  const blocked = await responseJson(await worker.fetch(request(
    '/access',
    {},
    { Authorization: 'Bearer valid-supabase-session' },
  ), env, {}));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PRIVATE_BETA_ADMISSION_REQUIRED');

  const allowed = await responseJson(await worker.fetch(request(
    '/access',
    {},
    {
      Authorization: 'Bearer valid-supabase-session',
      'X-DD-Beta-Access': completed.body.access.token,
    },
  ), env, {}));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(allowed.body.access.allowed, true);
  assert.equal(allowed.body.access.role, 'beta_tester');

  assert.equal(calls.some((target) => target.endsWith('/rest/v1/rpc/private_beta_complete_admission')), true);
  assert.equal(calls.some((target) => target.endsWith('/rest/v1/rpc/private_beta_access_snapshot')), true);
});

test('global Beta All Access bypasses expiring admission tokens for permanent users', async (t) => {
  const originalFetch = globalThis.fetch;
  const privateSnapshots = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: userId, email: 'permanent@example.invalid' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_global_beta_public_policy')) {
      return Response.json({
        enabled: true,
        commercialLaunchEnabled: false,
        legal: {
          termsVersion: 'terms-beta-v2-2026-07-28',
          privacyVersion: 'privacy-beta-v2-2026-07-28',
        },
      });
    }
    if (target.endsWith('/rest/v1/rpc/private_beta_access_snapshot')) {
      const payload = JSON.parse(String(init.body || '{}'));
      privateSnapshots.push(payload);
      return Response.json({
        allowed: true,
        admissionKind: 'global_beta_all_access',
        disclosureVersion,
        expiresAt: null,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json({
        allowed: true,
        basis: 'free_beta',
        termsRequired: false,
        role: 'student',
        globalBeta: { enabled: true, eligible: true, active: true, expiresAt: null },
        trial: { active: false },
        freeGrades: { limit: 3, used: 3, remaining: 0 },
        freeBeta: { enabled: true, active: true, expiresAt: null },
        subscription: null,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_user_subscription_status')) {
      return Response.json({
        globalBeta: { enabled: true, active: true, expiresAt: null },
        subscription: null,
        pendingPayment: null,
      });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const env = {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'true',
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    PUBLIC_PRICING_ENABLED: 'false',
  };

  const policy = await responseJson(await worker.fetch(request(
    '/beta/access/policy',
    {},
  ), env, {}));
  assert.equal(policy.status, 200);
  assert.deepEqual(policy.body.policy, {
    enabled: true,
    commercialLaunchEnabled: false,
    legal: {
      termsVersion: 'terms-beta-v2-2026-07-28',
      privacyVersion: 'privacy-beta-v2-2026-07-28',
    },
  });

  const status = await responseJson(await worker.fetch(request(
    '/beta/access/status',
    {},
    { Authorization: 'Bearer valid-supabase-session' },
  ), env, {}));
  assert.equal(status.status, 200);
  assert.equal(status.body.access.admissionKind, 'global_beta_all_access');
  assert.equal(status.body.access.expiresAt, null);

  const access = await responseJson(await worker.fetch(request(
    '/access',
    {},
    { Authorization: 'Bearer valid-supabase-session' },
  ), env, {}));
  assert.equal(access.status, 200);
  assert.equal(access.body.access.globalBeta.active, true);
  assert.equal(access.body.access.subscriptionState.globalBeta.active, true);
  assert.equal(privateSnapshots.length >= 2, true);
  assert.equal(privateSnapshots.every((entry) => entry.p_access_jti_hash === null), true);
});

test('current legal acceptance is user-bound, server-versioned, and verified before success', async (t) => {
  const originalFetch = globalThis.fetch;
  const acceptanceCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: userId, email: 'acceptance@example.invalid' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_accept_current_terms_for_user')) {
      acceptanceCalls.push(JSON.parse(String(init.body || '{}')));
      return Response.json({
        recorded: true,
        termsVersion: 'terms-commercial-v1-2026-08-18',
        privacyVersion: 'privacy-commercial-v1-2026-08-18',
        acceptedAt: '2026-08-18T07:00:00.000Z',
      });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const env = {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'true',
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
  };

  const denied = await responseJson(await worker.fetch(request(
    '/beta/access/accept-terms',
    {},
  ), env, {}));
  assert.equal(denied.status, 401);
  assert.equal(acceptanceCalls.length, 0);

  const accepted = await responseJson(await worker.fetch(request(
    '/beta/access/accept-terms',
    {},
    { Authorization: 'Bearer valid-supabase-session' },
  ), env, {}));
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body.acceptance, {
    recorded: true,
    termsVersion: 'terms-commercial-v1-2026-08-18',
    privacyVersion: 'privacy-commercial-v1-2026-08-18',
    acceptedAt: '2026-08-18T07:00:00.000Z',
  });
  assert.deepEqual(acceptanceCalls, [{
    p_user_id: userId,
    p_acceptance_source: 'web_authenticated_acceptance',
  }]);
  assert.equal(JSON.stringify(acceptanceCalls).includes('terms-commercial'), false);
});

test('invalid access code returns a generic response without echoing input', async (t) => {
  const originalFetch = globalThis.fetch;
  const rateSubjects = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith('/rest/v1/rpc/private_beta_evaluate_code_attempt')) {
      rateSubjects.push(JSON.parse(String(init.body || '{}')));
      return Response.json({ allowed: false, blocked: false });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const env = {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'true',
    PRIVATE_BETA_DISCLOSURE_VERSION: disclosureVersion,
    PRIVATE_BETA_ACCESS_CODE_VERIFIER: await hmacHex(codePepper, testCode),
    PRIVATE_BETA_ACCESS_CODE_PEPPER: codePepper,
    PRIVATE_BETA_FLOW_SIGNING_KEY: signingKey,
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
  };
  const submitted = 'definitely-not-valid';
  const missingFlow = await responseJson(await worker.fetch(request(
    '/beta/access/verify',
    {
      disclosureVersion,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
      accessCode: submitted,
    },
    { 'X-DD-Beta-Flow-ID': '' },
  ), env, {}));
  assert.equal(missingFlow.status, 401);
  assert.equal(missingFlow.body.error.code, 'PRIVATE_BETA_ACCESS_DENIED');
  assert.equal(rateSubjects.length, 0);

  const result = await responseJson(await worker.fetch(request(
    '/beta/access/verify',
    {
      disclosureVersion,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
      accessCode: submitted,
    },
    {
      'CF-Connecting-IP': '203.0.113.10',
      'User-Agent': 'PrivateBetaTest/one',
      'X-DD-Beta-Flow-ID': 'private-beta-test-flow-000001',
    },
  ), env, {}));
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'PRIVATE_BETA_ACCESS_DENIED');
  assert.equal(JSON.stringify(result.body).includes(submitted), false);
  assert.equal(result.body.error.message.includes(testCode), false);

  const second = await responseJson(await worker.fetch(request(
    '/beta/access/verify',
    {
      disclosureVersion,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
      accessCode: submitted,
    },
    {
      'CF-Connecting-IP': '203.0.113.10',
      'User-Agent': 'PrivateBetaTest/two',
      'X-DD-Beta-Flow-ID': 'private-beta-test-flow-000002',
    },
  ), env, {}));
  assert.equal(second.status, 401);
  assert.equal(rateSubjects.length, 2);
  assert.equal(
    rateSubjects[0].p_network_hash,
    rateSubjects[1].p_network_hash,
    'rotating browser flow or User-Agent cannot bypass the durable network limiter',
  );
  assert.notEqual(
    rateSubjects[0].p_flow_hash,
    rateSubjects[1].p_flow_hash,
    'separate browser flows keep independent lower-threshold counters',
  );
  assert.equal(rateSubjects.every((entry) => entry.p_code_valid === false), true);
});

test('gate remains inert unless explicitly enabled', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: userId, email: 'beta@example.invalid' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json({
        allowed: true,
        basis: 'free_beta',
        termsRequired: false,
        role: 'student',
        trial: { active: false },
        freeGrades: { limit: 3, used: 0, remaining: 3 },
        freeBeta: { enabled: true, active: true },
        subscription: null,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_user_subscription_status')) {
      return Response.json({});
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const disabledAdmission = await responseJson(await worker.fetch(request(
    '/beta/access/verify',
    {
      disclosureVersion,
      disclosureEndReached: true,
      acknowledgements: acknowledgements(),
      accessCode: testCode,
    },
  ), {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'false',
  }, {}));
  assert.equal(disabledAdmission.status, 404);
  assert.equal(disabledAdmission.body.error.code, 'NOT_FOUND');

  const result = await responseJson(await worker.fetch(request(
    '/access',
    {},
    { Authorization: 'Bearer valid-supabase-session' },
  ), {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'false',
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    PUBLIC_PRICING_ENABLED: 'false',
  }, {}));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('secure human-examiner capability routes remain usable while student routes stay gated', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (target.endsWith('/rest/v1/rpc/examination_query')) {
      const payload = JSON.parse(String(init.body || '{}'));
      assert.equal(payload.p_user_id, null);
      assert.equal(payload.p_operation, 'assignment');
      return Response.json({
        assignment: { assignmentId: 'ASSIGNMENT-TEST', status: 'pending' },
        questions: [],
      });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const env = {
    ALLOWED_ORIGIN: origin,
    PRIVATE_BETA_GATE_ENABLED: 'true',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    GUEST_USAGE_HMAC_KEY: 'test-private-beta-rate-key-with-at-least-32-bytes',
  };

  const examiner = await responseJson(await worker.fetch(request(
    '/examinations/query',
    {
      operation: 'assignment',
      assignmentToken: 'assignment-token-1234567890abcdef1234567890abcdef',
    },
  ), env, {}));
  assert.equal(examiner.status, 200);
  assert.equal(examiner.body.data.assignment.status, 'pending');

  const student = await responseJson(await worker.fetch(request(
    '/examinations/query',
    { operation: 'catalog', track: 'per_subject' },
  ), env, {}));
  assert.equal(student.status, 401);
  assert.equal(student.body.error.code, 'AUTHENTICATION_REQUIRED');
});
