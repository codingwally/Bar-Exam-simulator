import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import { createRoomKey } from './examination-room-v1-core.mjs';

const ORIGIN = 'https://duediligence.ph';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTITUTION_ID = '77777777-7777-4777-8777-777777777777';
const ROOM_KEY = createRoomKey('ABCDEFGH');

function env() {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-value',
    EXAMINATION_ROOM_KEY_PEPPER: 'test-only-examination-room-pepper-32-byte-minimum',
    EXAMINATION_ROOM_ENABLED: 'true',
    PRIVATE_BETA_GATE_ENABLED: 'false',
    PHASE4_ACCESS_ENFORCEMENT: 'false',
    OUTBOUND_EMAIL_MODE: 'suppressed',
  };
}

function request(path, body, authorization = 'Bearer professor-session') {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'X-Request-ID': '12345678-1234-4234-8234-1234567890ab',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withMockFetch(implementation, work) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

test('registered professor session route verifies the bearer token and greenfield staff context', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        profileRole: 'professor',
        professorRoleSelected: true,
        institutionId: INSTITUTION_ID,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'professor', active: true }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      return jsonResponse({ ok: true, professor: { authorized: true, displayName: 'Prof. Elena Villanueva' }, exam: null });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.professor.authorized, true);
  assert.equal(result.professor.displayName, 'Prof. Elena Villanueva');
  const persistenceCall = calls.find((entry) => entry.url.endsWith('/examination_room_v1_api'));
  assert.equal(persistenceCall.body.p_scope, 'professor');
  assert.equal(persistenceCall.body.p_actor_user_id, USER_ID);
  assert.equal(persistenceCall.body.p_institution_id, INSTITUTION_ID);
});

test('Professor authorization fails closed when staff context omits the active membership flag', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        profileRole: 'professor',
        professorRoleSelected: true,
        institutionId: INSTITUTION_ID,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'professor' }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return jsonResponse({ authorized: false, role: null, capabilities: [] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 403);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_PROFESSOR_FORBIDDEN');
  assert.equal(calls.some((entry) => entry.url.endsWith('/examination_room_v1_api')), false);
});

test('Professor signup role status reaches the service-only approval bridge', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_professor_access')) {
      return jsonResponse({
        ok: true,
        profileRole: 'professor',
        professorRoleSelected: true,
        declarationOnFile: true,
        activeAssignment: false,
        request: { id: '33333333-3333-4333-8333-333333333333', status: 'pending' },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/query', { operation: 'role_status', payload: {} }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.professorRoleSelected, true);
  const bridgeCall = calls.find((entry) => entry.url.endsWith('/examination_room_v1_professor_access'));
  assert.equal(bridgeCall.body.p_operation, 'status');
  assert.equal(bridgeCall.body.p_actor_user_id, USER_ID);
});

test('global Role admin bootstrap reaches the allowlisted staff-management RPC', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'founder@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({ authorized: false, memberships: [] });
    }
    if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return jsonResponse({ authorized: true, role: 'founder_admin', capabilities: ['role_admin'] });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_manage_staff')) {
      return jsonResponse({
        ok: true,
        duplicate: false,
        institution: { id: INSTITUTION_ID, code: 'sample-law', profileSchoolId: 'sample-law-school', name: 'Sample Law School' },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'bootstrap_institution',
      payload: { institutionName: 'Sample Law School', institutionCode: 'sample-law' },
    }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.institution.id, INSTITUTION_ID);
  const managementCall = calls.find((entry) => entry.url.endsWith('/examination_room_v1_manage_staff'));
  assert.equal(managementCall.body.p_operation, 'bootstrap_institution');
  assert.equal(managementCall.body.p_payload.profileSchoolId, 'sample-law-school');
});

test('institution administrator authorization fails closed when staff context omits the active flag', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'admin@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        institutionId: INSTITUTION_ID,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'admin' }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return jsonResponse({ authorized: true, role: 'founder_admin', capabilities: ['role_admin'] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', { operation: 'overview', payload: { institutionId: INSTITUTION_ID } }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 403);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_INSTITUTION_ADMIN_REQUIRED');
  assert.equal(calls.some((entry) => entry.url.endsWith('/examination_room_v1_api')), false);
});

test('institution administrator cannot target a school where the account is only an active Professor', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'admin@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        institutionId: null,
        memberships: [
          { institutionId: INSTITUTION_ID, staffRole: 'admin', active: true },
          { institutionId: OTHER_INSTITUTION_ID, staffRole: 'professor', active: true },
        ],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return jsonResponse({ authorized: true, role: 'founder_admin', capabilities: ['role_admin'] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'overview', payload: { institutionId: OTHER_INSTITUTION_ID },
    }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 403);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN');
  assert.equal(calls.some((entry) => entry.url.endsWith('/examination_room_v1_api')), false);
});

test('whole-feature kill switch fails closed before any external request', async () => {
  let called = false;
  const disabled = { ...env(), EXAMINATION_ROOM_ENABLED: 'false' };
  const response = await withMockFetch(async () => {
    called = true;
    throw new Error('must not be called');
  }, () => worker.fetch(
    request('/examination-room/v1/professor/query', { operation: 'role_status', payload: {} }),
    disabled,
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_DISABLED');
  assert.equal(called, false);
});

test('student preview sends only a room-key HMAC to the service-only dispatcher', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      return jsonResponse({
        ok: true,
        metadata: {
          examId: '44444444-4444-4444-8444-444444444444',
          title: 'Constitutional Law Midterm',
          subject: 'Constitutional Law',
          yearLevel: 'Second year',
          durationMinutes: 120,
          startsAt: '2026-08-26T02:00:00.000Z',
          professor: 'Prof. Elena Villanueva',
          questionCount: 1,
          integrityTier: 'standard',
          privacyNoticeVersion: 'exam-room-v1',
          activationStatus: 'open',
        },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/student/preview', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    }, null),
    env(),
    {},
  ));
  assert.equal(response.status, 200);
  const persistenceCall = calls.find((entry) => entry.url.endsWith('/examination_room_v1_api'));
  const serialized = JSON.stringify(persistenceCall.body);
  assert.equal(serialized.includes(ROOM_KEY), false);
  assert.match(persistenceCall.body.p_payload.roomKeyHash, /^[0-9a-f]{64}$/u);
  assert.equal(persistenceCall.body.p_institution_id, null);
});

test('database authorization denials are exposed as controlled 403 responses', async () => {
  const response = await withMockFetch(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        profileRole: 'professor',
        professorRoleSelected: true,
        institutionId: INSTITUTION_ID,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'professor', active: true }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      return jsonResponse({
        ok: false,
        errorCode: 'FORBIDDEN',
        message: 'An active institution staff authorization is required.',
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/query', { operation: 'session', payload: {} }),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 403);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_FORBIDDEN');
  assert.match(result.error.recovery, /authorized institution account/u);
});

test('database status and recovery guidance survive the service-only adapter', async () => {
  const response = await withMockFetch(async (url) => {
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      return jsonResponse({
        ok: false,
        errorCode: 'ROOM_NOT_OPEN',
        message: 'The professor has not opened this examination room yet.',
        error: {
          code: 'ROOM_NOT_OPEN',
          message: 'The professor has not opened this examination room yet.',
          status: 409,
          recovery: 'Wait for the professor to open the room, then choose Agree and begin again.',
        },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/student/preview', {
      roomKey: ROOM_KEY,
      fullName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    }, null),
    env(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_ROOM_NOT_OPEN');
  assert.match(result.error.recovery, /Wait for the professor to open the room/u);
});

test('invalid student key fails before any external request', async () => {
  let called = false;
  const response = await withMockFetch(async () => {
    called = true;
    throw new Error('must not be called');
  }, () => worker.fetch(
    request('/examination-room/v1/student/preview', {
      roomKey: 'ER1-AAAA-AAAA-A',
      fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001',
      subject: 'Constitutional Law', yearLevel: 'Second year',
    }, null),
    env(),
    {},
  ));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
