import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';
import {
  buildPublicationVersion,
  buildSubmissionManifest,
  normalizeAnswerRevision,
} from './examination-room-v1-core.mjs';

const ORIGIN = 'https://duediligence.ph';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const EXAM_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ACTIVATION_ID = '55555555-5555-4555-8555-555555555555';
const ROTATED_ACTIVATION_ID = '55555555-5555-4555-9555-555555555556';
const SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const LEASE_ID = '77777777-7777-4777-8777-777777777777';
const REQUEST_ID = '88888888-8888-4888-8888-888888888888';
const OWNER_DATA_KEY = '0123456789abcdef0123456789abcdef';
const BACKUP_MASTER_KEY = 'abcdef0123456789abcdef0123456789';
const SCHEDULE_START = '2099-08-26T06:00:00.000Z';
const SCHEDULE_CLOSE = '2099-08-26T08:30:00.000Z';

function environment(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-value',
    EXAMINATION_ROOM_KEY_PEPPER: 'test-only-examination-room-pepper-32-byte-minimum',
    EXAMINATION_ROOM_OWNER_DATA_KEY_V1: OWNER_DATA_KEY,
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
    EXAMINATION_ROOM_ADMIN_EMAILS: JSON.stringify([
      'owner-one@duediligence.ph',
      'owner-two@duediligence.ph',
    ]),
    RESEND_API_KEY: 're_test_value',
    EXAMINATION_ROOM_ENABLED: 'true',
    OUTBOUND_EMAIL_MODE: 'suppressed',
    PRIVATE_BETA_GATE_ENABLED: 'false',
    PHASE4_ACCESS_ENFORCEMENT: 'false',
    ...overrides,
  };
}

function request(path, body, requestId = REQUEST_ID) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Authorization: 'Bearer owner-session',
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
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

function authenticatedOwner(url) {
  if (String(url).endsWith('/auth/v1/user')) {
    return jsonResponse({
      id: USER_ID,
      email: 'founder@duediligence.ph',
      user_metadata: {},
      app_metadata: {},
    });
  }
  if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
    return jsonResponse({ authorized: true, role: 'founder_admin', capabilities: ['role_admin'] });
  }
  return null;
}

test('one-click approval escrows and emails the key; reveal/resend preserve it and explicit email_key rotates it', async () => {
  const calls = [];
  const emails = [];
  const deliveryEvents = [];
  const deliveryEventsByRequestHash = new Map();
  const storedEnvelopes = [];
  let storedEnvelope = null;
  let activationCalls = 0;
  let resendProviderMode = 'sent';

  const fetchMock = async (url, options = {}) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_ensure_membership')) {
      return jsonResponse({ ok: true, duplicate: false, membershipId: '99999999-9999-4999-8999-999999999999' });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      activationCalls += 1;
      assert.equal(body.p_scope, 'admin');
      assert.equal(body.p_operation, 'email_key');
      assert.equal(body.p_payload.replaceCurrent, activationCalls > 1);
      assert.equal(body.p_payload.opensAt, SCHEDULE_START);
      assert.equal(body.p_payload.closesAt, SCHEDULE_CLOSE);
      assert.equal('roomKey' in body.p_payload, false);
      return jsonResponse({
        ok: true,
        activation: {
          id: activationCalls > 1 ? ROTATED_ACTIVATION_ID : ACTIVATION_ID,
          status: 'scheduled',
          opensAt: SCHEDULE_START,
          expiresAt: SCHEDULE_CLOSE,
        },
        professorEmail: 'professor@example.edu.ph',
        professorName: 'Prof. Elena Villanueva',
        examTitle: 'Constitutional Law Midterm',
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_query')) {
      if (body.p_operation === 'key_envelope') {
        return storedEnvelope
          ? jsonResponse({ ok: true, ...storedEnvelope })
          : jsonResponse({
            ok: false,
            error: {
              code: 'ROOM_KEY_NOT_RECOVERABLE',
              message: 'No envelope yet.',
              status: 409,
              recovery: 'Issue the key.',
            },
          });
      }
      if (body.p_operation === 'command_center') {
        assert.equal(body.p_exam_id, EXAM_ID);
        assert.deepEqual(body.p_payload, { limit: 1, offset: 0 });
        return jsonResponse({
          ok: true,
          exams: [{
            examId: EXAM_ID,
            title: 'Constitutional Law Midterm',
            professorName: 'Prof. Elena Villanueva',
            professorEmail: 'professor@example.edu.ph',
            activation: { id: ACTIVATION_ID, closesAt: '2026-08-27T06:00:00.000Z' },
          }],
        });
      }
      if (body.p_operation === 'exam_detail') {
        return jsonResponse({
          ok: true,
          bundle: {
            schemaVersion: 'examination-room/owner-bundle/v1',
            institutionId: INSTITUTION_ID,
            examId: EXAM_ID,
            currentPublishedVersionId: VERSION_ID,
            tables: {
              examVersions: [{
                id: VERSION_ID,
                publication_status: 'published',
                duration_seconds: 7_200,
                controls: { startsAt: SCHEDULE_START },
              }],
              examRoster: [{
                accommodations: { extraMinutes: 30 },
              }],
              roomActivations: [
                {
                  id: ACTIVATION_ID,
                  activation_status: 'revoked',
                  opens_at: '2026-08-26T06:00:00.000Z',
                  closes_at: '2026-08-27T06:00:00.000Z',
                  created_at: '2026-08-26T05:59:00.000Z',
                  deactivated_at: '2026-08-26T07:00:00.000Z',
                  deactivation_reason: 'Administrator issued a replacement room key.',
                },
                {
                  id: ROTATED_ACTIVATION_ID,
                  activation_status: 'scheduled',
                  opens_at: '2026-08-26T07:00:00.000Z',
                  closes_at: '2026-08-27T07:00:00.000Z',
                  created_at: '2026-08-26T07:00:00.000Z',
                },
              ],
              ownerKeyEnvelopes: storedEnvelopes.map((entry, index) => ({
                activation_id: entry.activationId,
                exam_id: entry.examId,
                institution_id: entry.institutionId,
                envelope_algorithm: entry.algorithm,
                key_version: entry.keyVersion,
                ciphertext_base64: entry.ciphertext,
                iv_base64: entry.iv,
                aad_sha256: entry.aadSha256,
                created_at: index === 0
                  ? '2026-08-26T05:59:01.000Z'
                  : '2026-08-26T07:00:01.000Z',
              })),
              emailDeliveryEvents: deliveryEvents.map((entry, index) => ({
                id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
                activation_id: entry.activationId,
                delivery_kind: entry.deliveryKind,
                provider_status: entry.providerStatus,
                professor_recipient: entry.professorRecipient,
                owner_copy_recipients: entry.ownerCopyRecipients,
                attempted_at: `2026-08-26T0${6 + index}:01:00.000Z`,
              })),
            },
          },
        });
      }
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_command')) {
      if (body.p_operation === 'store_key_envelope') {
        storedEnvelope = {
          activationId: body.p_payload.activationId,
          examId: body.p_exam_id,
          institutionId: body.p_institution_id,
          algorithm: body.p_payload.algorithm,
          keyVersion: body.p_payload.keyVersion,
          ciphertext: body.p_payload.ciphertext,
          iv: body.p_payload.iv,
          aadSha256: body.p_payload.aadSha256,
        };
        storedEnvelopes.push({ ...storedEnvelope });
        return jsonResponse({
          ok: true,
          activationId: body.p_payload.activationId,
          escrowed: true,
        });
      }
      if (body.p_operation === 'record_email_delivery') {
        const incoming = { ...body.p_payload };
        let persisted = deliveryEventsByRequestHash.get(incoming.requestHash);
        if (!persisted) {
          persisted = incoming;
          deliveryEventsByRequestHash.set(incoming.requestHash, persisted);
          deliveryEvents.push(persisted);
        } else if (['failed', 'not_configured'].includes(persisted.providerStatus)
            && incoming.providerStatus === 'sent') {
          persisted.providerStatus = incoming.providerStatus;
          persisted.providerId = incoming.providerId;
          persisted.safeErrorCode = incoming.safeErrorCode;
          persisted.attemptedAt = incoming.attemptedAt;
        }
        return jsonResponse({
          ok: true,
          recorded: true,
          requestHash: persisted.requestHash,
          providerStatus: persisted.providerStatus,
          providerId: persisted.providerId,
          safeErrorCode: persisted.safeErrorCode,
          attemptedAt: persisted.attemptedAt,
        });
      }
    }
    if (String(url) === 'https://api.resend.com/emails') {
      emails.push({ body, headers: options.headers });
      if (resendProviderMode === 'failed') {
        return jsonResponse({ message: 'provider unavailable' }, 503);
      }
      return jsonResponse({ id: `email-${emails.length}` });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const approvedResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'approve_and_email_key',
      idempotencyKey: REQUEST_ID,
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }),
    environment(),
    {},
  ));
  const approved = await approvedResponse.json();
  assert.equal(approvedResponse.status, 201);
  assert.match(approved.roomKey, /^ER1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]$/u);
  assert.equal(approved.deliveryStatus, 'sent');
  assert.deepEqual(approved.schedule, {
    opensAt: SCHEDULE_START,
    closesAt: SCHEDULE_CLOSE,
    durationSeconds: 7_200,
    maximumExtraMinutes: 30,
    scheduleSource: 'published_exam',
    maxSessions: null,
  });
  assert.deepEqual(approved.adminRecipients, [
    'owner-one@duediligence.ph',
    'owner-two@duediligence.ph',
  ]);
  assert.ok(storedEnvelope);
  assert.equal(storedEnvelope.ciphertext.includes(approved.roomKey), false);
  assert.deepEqual(emails[0].body.to, ['professor@example.edu.ph']);
  assert.deepEqual(emails[0].body.bcc, [
    'owner-one@duediligence.ph',
    'owner-two@duediligence.ph',
  ]);
  assert.match(emails[0].body.html, /https:\/\/duediligence\.ph\/assets\/brand\/logo1-master\.png/u);
  assert.match(emails[0].body.html, /Open Monitoring and Grading/u);
  assert.match(emails[0].body.text, /do not need to enter this key/u);
  assert.match(String(emails[0].headers['Idempotency-Key']), /^exam-room-key-[0-9a-f]{64}$/u);
  assert.equal(deliveryEvents[0].deliveryKind, 'activation_key');
  assert.equal(deliveryEvents[0].providerStatus, 'sent');
  const persistenceBodies = calls
    .filter((entry) => entry.url.includes('/rest/v1/rpc/'))
    .map((entry) => JSON.stringify(entry.body));
  assert.equal(persistenceBodies.some((serialized) => serialized.includes(approved.roomKey)), false);

  const revealedResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'reveal_key',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    environment(),
    {},
  ));
  const revealed = await revealedResponse.json();
  assert.equal(revealedResponse.status, 200);
  assert.equal(revealed.roomKey, approved.roomKey);
  assert.equal(emails.length, 1);

  const resentResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'resend_key',
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    environment(),
    {},
  ));
  const resent = await resentResponse.json();
  assert.equal(resentResponse.status, 200);
  assert.equal(resent.roomKey, approved.roomKey);
  assert.equal(resent.deliveryStatus, 'sent');
  assert.equal(activationCalls, 1);
  assert.equal(emails.length, 2);
  assert.equal(deliveryEvents[1].deliveryKind, 'key_resend');

  const missingOwnersResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'resend_key',
      idempotencyKey: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc'),
    environment({ EXAMINATION_ROOM_ADMIN_EMAILS: '[]' }),
    {},
  ));
  const missingOwners = await missingOwnersResponse.json();
  assert.equal(missingOwnersResponse.status, 200);
  assert.equal(missingOwners.roomKey, approved.roomKey);
  assert.equal(missingOwners.deliveryStatus, 'not_configured');
  assert.equal(missingOwners.deliverySafeErrorCode, 'owner_recipients_missing');
  assert.equal(missingOwners.delivery.professor.status, 'not_configured');
  assert.equal(missingOwners.delivery.owners.status, 'not_configured');
  assert.equal(missingOwners.delivery.providerAccepted, false);
  assert.equal(activationCalls, 1);
  assert.equal(emails.length, 2);
  assert.equal(deliveryEvents[2].providerStatus, 'not_configured');
  assert.equal(deliveryEvents[2].safeErrorCode, 'owner_recipients_missing');

  const rotatedResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'email_key',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    environment(),
    {},
  ));
  const rotated = await rotatedResponse.json();
  assert.equal(rotatedResponse.status, 200);
  assert.notEqual(rotated.roomKey, approved.roomKey);
  assert.equal(rotated.activation.id, ROTATED_ACTIVATION_ID);
  assert.equal(rotated.deliveryStatus, 'sent');
  assert.equal(activationCalls, 2);
  assert.equal(emails.length, 3);
  assert.equal(deliveryEvents[3].deliveryKind, 'key_rotation');

  const revealedRotatedResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'reveal_key',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    environment(),
    {},
  ));
  const revealedRotated = await revealedRotatedResponse.json();
  assert.equal(revealedRotatedResponse.status, 200);
  assert.equal(revealedRotated.roomKey, rotated.roomKey);

  const detailResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'exam_detail',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
    environment(),
    {},
  ));
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.keyHistory.length, 2);
  assert.equal(detail.latestKeyRecord.activationId, ROTATED_ACTIVATION_ID);
  assert.equal(detail.latestKeyRecord.roomKey, rotated.roomKey);
  assert.equal(detail.keyHistory[1].activationId, ACTIVATION_ID);
  assert.equal(detail.keyHistory[1].roomKey, approved.roomKey);
  assert.equal(detail.bundle.latestKeyRecord.activationId, ROTATED_ACTIVATION_ID);

  const historicalRevealResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'reveal_key',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        activationId: ACTIVATION_ID,
      },
    }, '12121212-1212-4212-8212-121212121212'),
    environment(),
    {},
  ));
  const historicalReveal = await historicalRevealResponse.json();
  assert.equal(historicalRevealResponse.status, 200);
  assert.equal(historicalReveal.activationId, ACTIVATION_ID);
  assert.equal(historicalReveal.roomKey, approved.roomKey);

  const retryRequestId = '93939393-9393-4393-8393-939393939393';
  const retryBody = {
    operation: 'resend_key',
    idempotencyKey: retryRequestId,
    payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
  };
  resendProviderMode = 'failed';
  const failedRetryResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', retryBody, retryRequestId),
    environment(),
    {},
  ));
  const failedRetry = await failedRetryResponse.json();
  assert.equal(failedRetryResponse.status, 200);
  assert.equal(failedRetry.deliveryStatus, 'failed');
  assert.equal(failedRetry.deliveryAttemptStatus, 'failed');
  assert.equal(failedRetry.deliverySafeErrorCode, 'provider_503');
  assert.equal(deliveryEvents.length, 5);
  assert.equal(deliveryEvents[4].providerStatus, 'failed');

  resendProviderMode = 'sent';
  const successfulRetryResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', retryBody, retryRequestId),
    environment(),
    {},
  ));
  const successfulRetry = await successfulRetryResponse.json();
  assert.equal(successfulRetryResponse.status, 200);
  assert.equal(successfulRetry.deliveryStatus, 'sent');
  assert.equal(successfulRetry.deliveryAttemptStatus, 'sent');
  assert.equal(deliveryEvents.length, 5);
  assert.equal(deliveryEvents[4].providerStatus, 'sent');
  assert.ok(deliveryEvents[4].providerId);
  const recordedProviderId = deliveryEvents[4].providerId;

  resendProviderMode = 'failed';
  const failedAfterSuccessResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', retryBody, retryRequestId),
    environment(),
    {},
  ));
  const failedAfterSuccess = await failedAfterSuccessResponse.json();
  assert.equal(failedAfterSuccessResponse.status, 200);
  assert.equal(failedAfterSuccess.deliveryStatus, 'sent');
  assert.equal(failedAfterSuccess.deliveryAttemptStatus, 'failed');
  assert.equal(failedAfterSuccess.deliverySafeErrorCode, null);
  assert.match(failedAfterSuccess.deliveryRecovery, /earlier successful delivery remains recorded/u);
  assert.equal(deliveryEvents.length, 5);
  assert.equal(deliveryEvents[4].providerStatus, 'sent');
  assert.equal(deliveryEvents[4].providerId, recordedProviderId);
  assert.equal(emails[3].headers['Idempotency-Key'], emails[4].headers['Idempotency-Key']);
  assert.equal(emails[4].headers['Idempotency-Key'], emails[5].headers['Idempotency-Key']);

  resendProviderMode = 'sent';
  const sharedOwnerRequestId = '74747474-7474-4474-8474-747474747474';
  const sharedOwnerResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'resend_key',
      idempotencyKey: sharedOwnerRequestId,
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, sharedOwnerRequestId),
    environment({ EXAMINATION_ROOM_ADMIN_EMAILS: '["professor@example.edu.ph"]' }),
    {},
  ));
  const sharedOwner = await sharedOwnerResponse.json();
  assert.equal(sharedOwnerResponse.status, 200);
  assert.equal(sharedOwner.deliveryStatus, 'sent');
  assert.deepEqual(sharedOwner.adminRecipients, ['professor@example.edu.ph']);
  assert.deepEqual(emails.at(-1).body.to, ['professor@example.edu.ph']);
  assert.equal(Object.hasOwn(emails.at(-1).body, 'bcc'), false, 'the same owner/creator address must not be duplicated as BCC');

  const fallbackOwnerRequestId = '75757575-7575-4575-8575-757575757575';
  const fallbackOwnerResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'resend_key',
      idempotencyKey: fallbackOwnerRequestId,
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, fallbackOwnerRequestId),
    environment({
      EXAMINATION_ROOM_ADMIN_EMAILS: undefined,
      ADMIN_EMAILS: '["legacy-owner@duediligence.ph"]',
    }),
    {},
  ));
  const fallbackOwner = await fallbackOwnerResponse.json();
  assert.equal(fallbackOwnerResponse.status, 200);
  assert.equal(fallbackOwner.deliveryStatus, 'sent');
  assert.deepEqual(fallbackOwner.adminRecipients, ['legacy-owner@duediligence.ph']);
  assert.deepEqual(emails.at(-1).body.bcc, ['legacy-owner@duediligence.ph']);
});

test('owner approval converts a blank published schedule into a fresh 24-hour key window', async () => {
  let activationCalls = 0;
  let activationPayload = null;
  const beforeRequest = Date.now();
  const response = await withMockFetch(async (url, options = {}) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_ensure_membership')) {
      return jsonResponse({ ok: true });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_query')) {
      assert.equal(body.p_operation, 'exam_detail');
      return jsonResponse({
        ok: true,
        bundle: {
          institutionId: INSTITUTION_ID,
          examId: EXAM_ID,
          currentPublishedVersionId: VERSION_ID,
          tables: {
            examVersions: [{
              id: VERSION_ID,
              publication_status: 'published',
              duration_seconds: 7_200,
              controls: {},
            }],
            examRoster: [],
          },
        },
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      activationCalls += 1;
      activationPayload = body.p_payload;
      return jsonResponse({
        ok: false,
        error: {
          code: 'EXPECTED_ACTIVATION_STOP',
          message: 'The test stops after verifying the generated activation window.',
          status: 409,
          recovery: 'No recovery is required in this test.',
        },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'approve_and_email_key',
      idempotencyKey: '45454545-4545-4545-8545-454545454545',
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID },
    }, '45454545-4545-4545-8545-454545454545'),
    environment(),
    {},
  ));
  const afterRequest = Date.now();
  const result = await response.json();
  const opens = Date.parse(activationPayload?.opensAt || '');
  const closes = Date.parse(activationPayload?.closesAt || '');
  assert.equal(response.status, 409);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_EXPECTED_ACTIVATION_STOP');
  assert.equal(activationCalls, 1);
  assert.equal(activationPayload.replaceCurrent, false);
  assert.ok(Number.isFinite(opens));
  assert.ok(Number.isFinite(closes));
  assert.ok(opens >= beforeRequest - 1_000);
  assert.ok(opens <= afterRequest + 1_000);
  assert.equal(closes - opens, 24 * 60 * 60 * 1_000);
});

function bytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('Unsupported fake R2 value');
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
  }

  record(value) {
    if (!value) return null;
    return {
      key: value.key,
      size: value.bytes.byteLength,
      etag: value.etag,
      uploaded: value.uploaded,
      customMetadata: { ...value.customMetadata },
      httpMetadata: { ...value.httpMetadata },
    };
  }

  async head(key) {
    return this.record(this.objects.get(key));
  }

  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
    const record = {
      key,
      bytes: bytes(value),
      etag: `etag-${this.objects.size + 1}`,
      uploaded: new Date('2026-08-26T06:01:00.000Z'),
      customMetadata: { ...(options.customMetadata || {}) },
      httpMetadata: { ...(options.httpMetadata || {}) },
    };
    this.objects.set(key, record);
    return this.record(record);
  }

  async get(key) {
    const record = this.objects.get(key);
    if (!record) return null;
    return {
      ...this.record(record),
      arrayBuffer: async () => record.bytes.slice().buffer,
    };
  }
}

test('scheduled recovery materializes to R2; owner download verifies data; restore remains explicitly verification-only', async () => {
  const bucket = new FakeR2();
  const snapshotPayload = {
    schemaVersion: 'examination-room/recovery-bundle/v1',
    snapshot: {
      id: SNAPSHOT_ID,
      snapshot_sequence: 3,
      snapshot_scope: 'full_recovery',
      record_count: 4,
      created_at: '2026-08-26T06:00:00.000Z',
      materialization_attempts: 1,
    },
    institutionId: INSTITUTION_ID,
    examId: EXAM_ID,
    examVersionId: VERSION_ID,
    scope: 'full_recovery',
    sourceKind: 'manual',
    bundle: { tables: { questions: [{ id: 'question-1', prompt: 'Discuss due process.' }] } },
  };
  let claimCount = 0;
  let completed = null;
  let ownerQueryMode = false;
  const verifiedSnapshots = [];

  const fetchMock = async (url, options = {}) => {
    const authorized = ownerQueryMode ? authenticatedOwner(url) : null;
    if (authorized) return authorized;
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      claimCount += 1;
      return jsonResponse(claimCount === 1
        ? { ok: true, job: { snapshotId: SNAPSHOT_ID, leaseId: LEASE_ID, payload: snapshotPayload } }
        : { ok: true, job: null });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_complete_recovery_snapshot')) {
      completed = body;
      return jsonResponse({ ok: true, snapshotId: SNAPSHOT_ID, status: 'available' });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_query')) {
      assert.equal(body.p_operation, 'recovery_detail');
      assert.equal(body.p_payload.snapshotId, SNAPSHOT_ID);
      assert.equal(body.p_payload.offset, 0);
      return jsonResponse({
        ok: true,
        snapshots: [{
          id: SNAPSHOT_ID,
          exam_id: EXAM_ID,
          snapshot_status: 'available',
          encrypted_object_reference: completed.p_object_reference,
          snapshot_sha256: completed.p_snapshot_sha256,
        }],
        total: 1,
        hasMore: false,
        nextOffset: null,
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_verify_recovery_snapshot')) {
      verifiedSnapshots.push(body);
      return jsonResponse({
        ok: true,
        snapshotId: body.p_snapshot_id,
        verified: true,
        verifiedAt: '2026-08-26T06:02:00.000Z',
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const recoveryEnv = environment({
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: BACKUP_MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  });
  const scheduled = [];
  await withMockFetch(fetchMock, async () => {
    worker.scheduled({}, recoveryEnv, { waitUntil: (promise) => scheduled.push(promise) });
    await Promise.all(scheduled);
  });
  assert.equal(claimCount, 1);
  assert.ok(completed);
  assert.equal(bucket.objects.size, 1);
  assert.match(completed.p_snapshot_sha256, /^[0-9a-f]{64}$/u);

  ownerQueryMode = true;
  const downloadResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'recovery_detail',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        snapshotId: SNAPSHOT_ID,
        includeBundle: true,
      },
    }),
    recoveryEnv,
    {},
  ));
  const download = await downloadResponse.json();
  assert.equal(downloadResponse.status, 200);
  assert.equal(download.verified, true);
  assert.deepEqual(download.bundle, snapshotPayload);
  assert.equal(download.verifiedAt, '2026-08-26T06:02:00.000Z');

  const verifyResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'recovery_detail',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        snapshotId: SNAPSHOT_ID,
        verify: true,
      },
    }, 'abababab-abab-4bab-8bab-abababababab'),
    recoveryEnv,
    {},
  ));
  const verified = await verifyResponse.json();
  assert.equal(verifyResponse.status, 200);
  assert.equal(verified.verificationStatus, 'verified');
  assert.deepEqual(verified.bundle, snapshotPayload);

  const restoreResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'restore_snapshot',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        snapshotId: SNAPSHOT_ID,
      },
    }, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    recoveryEnv,
    {},
  ));
  const restore = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200);
  assert.equal(restore.status, 'verification_only');
  assert.equal(restore.restored, false);
  assert.match(restore.message, /No live database rows were overwritten/u);
  assert.equal(verifiedSnapshots.length, 3);
  assert.equal(verifiedSnapshots.every((entry) => (
    entry.p_snapshot_id === SNAPSHOT_ID
      && entry.p_snapshot_sha256 === completed.p_snapshot_sha256
  )), true);
});

test('an oversized scheduled checkpoint records the bounded failure without writing a partial R2 object', async () => {
  const bucket = new FakeR2();
  let claimCount = 0;
  let failed = null;
  const snapshotPayload = {
    schemaVersion: 'examination-room/recovery-bundle/v1',
    snapshot: {
      id: SNAPSHOT_ID,
      snapshot_sequence: 4,
      snapshot_scope: 'full_recovery',
      record_count: 1,
      created_at: '2026-08-26T06:00:00.000Z',
      materialization_attempts: 1,
    },
    institutionId: INSTITUTION_ID,
    examId: EXAM_ID,
    examVersionId: VERSION_ID,
    scope: 'full_recovery',
    sourceKind: 'manual',
    bundle: { oversized: 'x'.repeat(8 * 1024 * 1024) },
  };
  const fetchMock = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      claimCount += 1;
      return jsonResponse(claimCount === 1
        ? { ok: true, job: { snapshotId: SNAPSHOT_ID, leaseId: LEASE_ID, payload: snapshotPayload } }
        : { ok: true, job: null });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_fail_recovery_snapshot')) {
      failed = body;
      return jsonResponse({ ok: true, snapshotId: SNAPSHOT_ID, status: 'failed' });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const scheduled = [];
  await withMockFetch(fetchMock, async () => {
    worker.scheduled({}, environment({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: BACKUP_MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: bucket,
    }), { waitUntil: (promise) => scheduled.push(promise) });
    await Promise.all(scheduled);
  });
  assert.equal(claimCount, 1);
  assert.ok(failed);
  assert.equal(failed.p_snapshot_id, SNAPSHOT_ID);
  assert.equal(failed.p_error_code, 'EXAM_ROOM_V1_RECOVERY_OBJECT_TOO_LARGE');
  assert.equal(bucket.objects.size, 0);
});

test('R2 verification reports a self-resolving not-configured error', async () => {
  const response = await withMockFetch(async (url, options = {}) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_query')) {
      return jsonResponse({
        ok: true,
        snapshots: [{
          id: SNAPSHOT_ID,
          encrypted_object_reference: `r2:EXAMINATION_ROOM_BACKUPS:examination-room-recovery/v1/${INSTITUTION_ID}/${EXAM_ID}/0000000003-${SNAPSHOT_ID}/snapshot.ddbackup`,
          snapshot_sha256: 'a'.repeat(64),
        }],
      });
    }
    throw new Error(`Unexpected fetch ${url} ${options.body || ''}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'recovery_detail',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        snapshotId: SNAPSHOT_ID,
        verify: true,
      },
    }),
    environment({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: undefined,
      EXAMINATION_ROOM_BACKUPS: undefined,
      EXAMINATION_ROOM_RECOVERY_MODE: 'r2',
    }),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_RECOVERY_NOT_CONFIGURED');
  assert.match(result.error.recovery, /finish the Examination Room backup setup/u);
});

test('owner runtime preflight checks both encryption keys, owner recipients, scoped mail, and live R2 availability without exposing secrets', async () => {
  const bucket = new FakeR2();
  const readyResponse = await withMockFetch(async (url) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'preflight',
      payload: {},
    }),
    environment({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: BACKUP_MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: bucket,
    }),
    {},
  ));
  const ready = await readyResponse.json();
  assert.equal(readyResponse.status, 200);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.checks.map((check) => check.id), [
    'owner_data_key',
    'owner_email_recipients',
    'key_email_delivery',
    'encrypted_recovery',
  ]);
  assert.equal(ready.checks.every((check) => check.ok), true);
  const recoveryCheck = ready.checks.find((check) => check.id === 'encrypted_recovery');
  assert.equal(recoveryCheck.recoveryMode, 'free_bounded_source_snapshots');
  assert.equal(recoveryCheck.maxObjectBytes, 8 * 1024 * 1024);
  assert.equal(recoveryCheck.maxPlaintextBytes, 8 * 1024 * 1024);
  assert.equal(recoveryCheck.oversizeFallback, 'admin_examinations_export_all_json');
  assert.equal(JSON.stringify(ready).includes(OWNER_DATA_KEY), false);
  assert.equal(JSON.stringify(ready).includes(BACKUP_MASTER_KEY), false);
  assert.equal(bucket.objects.size, 0);

  const brokenResponse = await withMockFetch(async (url) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'preflight',
      payload: {},
    }, '56565656-5656-4656-8656-565656565656'),
    environment({
      EXAMINATION_ROOM_OWNER_DATA_KEY_V1: 'short',
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: undefined,
      EXAMINATION_ROOM_BACKUPS: undefined,
      EXAMINATION_ROOM_ADMIN_EMAILS: '["not-an-email"]',
    }),
    {},
  ));
  const broken = await brokenResponse.json();
  assert.equal(brokenResponse.status, 200);
  assert.equal(broken.ready, false);
  assert.equal(broken.checks.find((check) => check.id === 'owner_data_key').ok, false);
  assert.equal(broken.checks.find((check) => check.id === 'owner_email_recipients').code, 'EXAM_ROOM_V1_OWNER_EMAILS_INVALID');
  assert.equal(broken.checks.find((check) => check.id === 'encrypted_recovery').code, 'EXAM_ROOM_V1_RECOVERY_NOT_CONFIGURED');
});

test('owner authorization outage is distinct from an ordinary-admin denial', async () => {
  const response = await withMockFetch(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({
        id: USER_ID,
        email: 'founder@duediligence.ph',
        user_metadata: {},
        app_metadata: {},
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/admin_authorization_context')) {
      return jsonResponse({ message: 'temporary database outage' }, 503);
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/admin/query', {
      operation: 'command_center',
      payload: {},
    }),
    environment(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_OWNER_AUTHORIZATION_UNAVAILABLE');
  assert.match(result.error.recovery, /No Examination Room data was changed/u);
});

test('owner no-code correction and room commands validate and forward only their exact safe payloads', async () => {
  const studentIdentityId = '91919191-9191-4191-8191-919191919191';
  const submissionId = '92929292-9292-4292-8292-929292929292';
  const commandBodies = [];
  const fetchMock = async (url, options = {}) => {
    const authorized = authenticatedOwner(url);
    if (authorized) return authorized;
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_owner_command')) {
      commandBodies.push(body);
      return jsonResponse({ ok: true, operation: body.p_operation });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const commands = [
    {
      operation: 'correct_student_identity',
      requestId: '31313131-3131-4131-8131-313131313131',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        studentIdentityId,
        fullName: '  Maria   Theresa Dela Cruz  ',
        studentNumber: '2026-10001',
        email: 'MARIA@EXAMPLE.EDU.PH',
        reason: 'Corrected against the registrar record.',
      },
    },
    {
      operation: 'set_submission_status',
      requestId: '32323232-3232-4232-8232-323232323232',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        submissionId,
        status: 'UNDER_REVIEW',
        reason: 'Professor requested a documented review.',
      },
    },
    {
      operation: 'correct_student_identity',
      requestId: '32323232-3232-4232-8232-323232323233',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        studentIdentityId,
        clearEmail: true,
        reason: 'Removed an email that did not belong to this student.',
      },
    },
    {
      operation: 'room_control',
      requestId: '33323232-3232-4232-8232-323232323234',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        action: 'close',
        reason: 'Scheduled examination window completed.',
      },
    },
  ];
  for (const command of commands) {
    const response = await withMockFetch(fetchMock, () => worker.fetch(
      request('/examination-room/v1/admin/command', {
        operation: command.operation,
        idempotencyKey: command.requestId,
        payload: command.payload,
      }, command.requestId),
      environment(),
      {},
    ));
    assert.equal(response.status, 200);
  }
  assert.equal(commandBodies.length, 4);
  assert.equal(commandBodies[0].p_payload.fullName, 'Maria Theresa Dela Cruz');
  assert.equal(commandBodies[0].p_payload.email, 'maria@example.edu.ph');
  assert.equal(commandBodies[1].p_payload.status, 'under_review');
  assert.equal(commandBodies[2].p_payload.clearEmail, true);
  assert.equal(Object.hasOwn(commandBodies[2].p_payload, 'email'), false);
  assert.equal(commandBodies[3].p_payload.action, 'close');
  assert.equal(commandBodies.every((body) => /^[0-9a-f]{64}$/u.test(body.p_payload.requestHash)), true);

  const invalidResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'set_submission_status',
      idempotencyKey: '34343434-3434-4434-8434-343434343434',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        submissionId,
        status: 'deleted',
        reason: 'This status is intentionally unsupported.',
      },
    }, '34343434-3434-4434-8434-343434343434'),
    environment(),
    {},
  ));
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.error.code, 'EXAM_ROOM_V1_SUBMISSION_STATUS_INVALID');
  assert.equal(commandBodies.length, 4);

  const conflictingEmailResponse = await withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/admin/command', {
      operation: 'correct_student_identity',
      idempotencyKey: '35353535-3535-4535-8535-353535353535',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        studentIdentityId,
        email: 'student@example.edu.ph',
        clearEmail: true,
        reason: 'This conflicting action is intentionally invalid.',
      },
    }, '35353535-3535-4535-8535-353535353535'),
    environment(),
    {},
  ));
  const conflictingEmail = await conflictingEmailResponse.json();
  assert.equal(conflictingEmailResponse.status, 400);
  assert.equal(conflictingEmail.error.code, 'EXAM_ROOM_V1_STUDENT_EMAIL_ACTION_CONFLICT');
  assert.equal(commandBodies.length, 4);
});

test('Professor import_grades accepts the exact UI entries and prepares one atomic grading revision per session', async () => {
  const calls = [];
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const publication = buildPublicationVersion({
    examinationId: EXAM_ID,
    version: 1,
    publishedAt: '2026-08-26T01:00:00.000Z',
    draft: {
      title: 'Constitutional Law Midterm',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      instructions: 'Answer completely.',
      identityMode: 'real_names',
      integrityTier: 'standard',
      privacyNoticeVersion: 'exam-room-v1',
      questions: [
        { type: 'essay', prompt: 'Explain separation of powers.', points: 20, wordLimit: 800 },
        { type: 'essay', prompt: 'Explain judicial review.', points: 20, wordLimit: 800 },
      ],
    },
  }).manifest;
  const answers = [1, 2].map((questionNumber) => normalizeAnswerRevision({
    attemptId: sessionId,
    questionNumber,
    revision: 1,
    idempotencyKey: `answer-revision-${questionNumber.toString().padStart(18, '0')}`,
    answer: `Student answer ${questionNumber}.`,
  }, { versionManifest: publication, publicationHash: 'a'.repeat(64) }));
  const submission = buildSubmissionManifest({
    submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    attemptId: sessionId,
    idempotencyKey: 'submission-request-0000000001',
    submittedAt: '2026-08-26T03:00:00.000Z',
    versionManifest: publication,
    publicationHash: 'a'.repeat(64),
    studentIdentity: {
      realName: 'Maria Theresa Dela Cruz',
      studentNumber: '2024-10001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    },
    privacyConsent: {
      noticeVersion: 'exam-room-v1',
      accepted: true,
      acceptedAt: '2026-08-26T01:55:00.000Z',
      recordingAccepted: false,
    },
    answerRevisions: answers,
  }).manifest;
  const uiGrades = [
    { sessionId, questionId: 'q-1', points: 16, feedback: 'Clear analysis.' },
    { sessionId, questionId: 'q-2', points: 15.5, feedback: 'Accurate rule and application.' },
  ];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_grading_contexts')) {
      assert.equal(body.p_actor_user_id, USER_ID);
      assert.equal(body.p_institution_id, INSTITUTION_ID);
      assert.equal(body.p_exam_id, EXAM_ID);
      assert.deepEqual(body.p_payload.requests, [{
        sessionId,
        questionReferences: ['q-1', 'q-2'],
      }]);
      return jsonResponse({
        ok: true,
        contexts: [{
          sessionId,
          publicationManifest: publication,
          submissionManifest: submission,
          scores: [],
          nextRevision: 1,
          overallFeedback: '',
        }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_import_grades')) {
      assert.deepEqual(Object.keys(body).sort(), [
        'p_actor_user_id', 'p_exam_id', 'p_institution_id', 'p_payload',
      ]);
      assert.equal(body.p_actor_user_id, USER_ID);
      assert.equal(body.p_institution_id, INSTITUTION_ID);
      assert.equal(body.p_exam_id, EXAM_ID);
      assert.equal(body.p_payload.grades.length, 1);
      const prepared = body.p_payload.grades[0];
      assert.equal(prepared.examId, EXAM_ID);
      assert.equal(prepared.sessionId, sessionId);
      assert.match(prepared.requestHash, /^[0-9a-f]{64}$/u);
      assert.match(prepared.clientRevisionId, /^[0-9a-f-]{36}$/u);
      assert.match(prepared.gradingHash, /^[0-9a-f]{64}$/u);
      assert.equal(prepared.gradingManifest.status, 'draft');
      assert.equal(prepared.gradingManifest.revision, 1);
      assert.equal(prepared.gradingManifest.scores.length, 2);
      assert.deepEqual(
        prepared.gradingManifest.scores.map((score) => [score.questionNumber, score.pointsAwarded]),
        [[1, 16], [2, 15.5]],
      );
      assert.equal('idempotencyKey' in prepared.gradingManifest, false);
      assert.match(body.p_payload.requestHash, /^[0-9a-f]{64}$/u);
      return jsonResponse({ ok: true, importedCount: 1, atomic: true, receipts: [{ sessionId }] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/command', {
      operation: 'import_grades',
      idempotencyKey: REQUEST_ID,
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        grades: uiGrades,
      },
    }),
    environment(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.importedCount, 2);
  assert.equal(result.importedRevisionCount, 1);
  assert.equal(result.atomic, true);
  assert.equal(calls.filter((entry) => entry.url.includes('/rest/v1/rpc/')).length, 2);
  assert.equal(calls.length, 3);
});

test('Professor import authenticates before reading an oversized body and never performs the former unbounded clone parse', async () => {
  let externalCalls = 0;
  const oversized = new Request('https://worker.example/examination-room/v1/professor/command', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Content-Length': '99999999',
    },
    body: '{',
  });
  const response = await withMockFetch(async (url) => {
    externalCalls += 1;
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(oversized, environment(), {}));
  const result = await response.json();
  assert.equal(response.status, 401);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED');
  assert.equal(externalCalls, 0);
});

test('Professor import rejects a client-forged prepared manifest and hash before any grading RPC', async () => {
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    throw new Error(`Unexpected fetch ${url} ${options.body || ''}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/command', {
      operation: 'import_grades',
      idempotencyKey: '61616161-6161-4161-8161-616161616161',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        grades: [{
          examId: EXAM_ID,
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          requestHash: 'a'.repeat(64),
          clientRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          gradingManifest: { status: 'final', scores: [] },
          gradingHash: 'b'.repeat(64),
        }],
      },
    }, '61616161-6161-4161-8161-616161616161'),
    environment(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'EXAM_ROOM_V1_OFFLINE_GRADE_BATCH_INVALID');
  assert.deepEqual(calls, ['https://project.supabase.co/auth/v1/user']);
});

test('Professor import of more than 50 student sessions uses one batched context RPC and one atomic save RPC', async () => {
  const publication = buildPublicationVersion({
    examinationId: EXAM_ID,
    version: 2,
    publishedAt: '2026-08-26T01:00:00.000Z',
    draft: {
      title: 'Commercial Scale Import Test',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      instructions: 'Answer completely.',
      identityMode: 'real_names',
      integrityTier: 'standard',
      privacyNoticeVersion: 'exam-room-v1',
      questions: [
        { type: 'essay', prompt: 'Explain judicial review.', points: 10, wordLimit: 500 },
      ],
    },
  }).manifest;
  const sessions = Array.from({ length: 60 }, (_, index) => {
    const suffix = (index + 1).toString(16).padStart(12, '0');
    const sessionId = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
    const answer = normalizeAnswerRevision({
      attemptId: sessionId,
      questionNumber: 1,
      revision: 1,
      idempotencyKey: `scaled-answer-revision-${String(index + 1).padStart(12, '0')}`,
      answer: `Student answer ${index + 1}.`,
    }, { versionManifest: publication, publicationHash: 'a'.repeat(64) });
    const submission = buildSubmissionManifest({
      submissionId: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
      attemptId: sessionId,
      idempotencyKey: `scaled-submission-${String(index + 1).padStart(16, '0')}`,
      submittedAt: '2026-08-26T03:00:00.000Z',
      versionManifest: publication,
      publicationHash: 'a'.repeat(64),
      studentIdentity: {
        realName: `Student ${index + 1}`,
        studentNumber: `2026-${String(index + 1).padStart(5, '0')}`,
        subject: 'Constitutional Law',
        yearLevel: 'Second year',
      },
      privacyConsent: {
        noticeVersion: 'exam-room-v1',
        accepted: true,
        acceptedAt: '2026-08-26T01:55:00.000Z',
        recordingAccepted: false,
      },
      answerRevisions: [answer],
    }).manifest;
    return { sessionId, submission };
  });
  const uiGrades = sessions.map(({ sessionId }, index) => ({
    sessionId,
    questionId: 'q-1',
    points: 8 + (index % 3) * 0.5,
    feedback: `Scaled feedback ${index + 1}.`,
  }));
  const calls = [];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_grading_contexts')) {
      assert.equal(body.p_payload.requests.length, 60);
      return jsonResponse({
        ok: true,
        contexts: sessions.map(({ sessionId, submission }) => ({
          sessionId,
          publicationManifest: publication,
          submissionManifest: submission,
          scores: [],
          nextRevision: 1,
          overallFeedback: '',
        })),
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_import_grades')) {
      assert.equal(body.p_payload.grades.length, 60);
      assert.equal(body.p_payload.grades.every((grade) => grade.examId === EXAM_ID), true);
      return jsonResponse({ ok: true, importedCount: 60, receipts: [] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/command', {
      operation: 'import_grades',
      idempotencyKey: '70707070-7070-4070-8070-707070707070',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        grades: uiGrades,
      },
    }, '70707070-7070-4070-8070-707070707070'),
    environment(),
    {},
  ));
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.importedCount, 60);
  assert.equal(result.importedRevisionCount, 60);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((entry) => entry.url.includes('/rest/v1/rpc/')).length, 2);
});

test('successful result release schedules an immediate recovery drain with the cron drain remaining as fallback', async () => {
  const sessionId = 'abababab-abab-4bab-8bab-abababababab';
  const publication = buildPublicationVersion({
    examinationId: EXAM_ID,
    version: 3,
    publishedAt: '2026-08-26T01:00:00.000Z',
    draft: {
      title: 'Result Release Recovery Test',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      instructions: 'Answer completely.',
      identityMode: 'real_names',
      integrityTier: 'standard',
      privacyNoticeVersion: 'exam-room-v1',
      questions: [{ type: 'essay', prompt: 'Discuss due process.', points: 10, wordLimit: 500 }],
    },
  }).manifest;
  const answer = normalizeAnswerRevision({
    attemptId: sessionId,
    questionNumber: 1,
    revision: 1,
    idempotencyKey: 'release-answer-revision-000001',
    answer: 'The student response.',
  }, { versionManifest: publication, publicationHash: 'a'.repeat(64) });
  const submission = buildSubmissionManifest({
    submissionId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    attemptId: sessionId,
    idempotencyKey: 'release-submission-request-0001',
    submittedAt: '2026-08-26T03:00:00.000Z',
    versionManifest: publication,
    publicationHash: 'a'.repeat(64),
    studentIdentity: {
      realName: 'Andrea Reyes',
      studentNumber: '2026-00001',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    },
    privacyConsent: {
      noticeVersion: 'exam-room-v1',
      accepted: true,
      acceptedAt: '2026-08-26T01:55:00.000Z',
      recordingAccepted: false,
    },
    answerRevisions: [answer],
  }).manifest;
  const calls = [];
  const scheduled = [];
  const response = await withMockFetch(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        professorRoleSelected: true,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'professor', active: true }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      if (body.p_operation === 'release_context') {
        return jsonResponse({
          ok: true,
          entries: [{
            sessionId,
            submissionManifest: submission,
            scores: [{ questionNumber: 1, pointsAwarded: 8, feedback: 'Sound analysis.' }],
            overallFeedback: 'Passed.',
            nextRevision: 2,
          }],
        });
      }
      assert.equal(body.p_operation, 'release_results');
      assert.equal(body.p_payload.releases.length, 1);
      assert.equal(body.p_payload.releases[0].sessionId, sessionId);
      return jsonResponse({ ok: true, releasedCount: 1 });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      return jsonResponse({ ok: true, job: null });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, () => worker.fetch(
    request('/examination-room/v1/professor/command', {
      operation: 'release_results',
      idempotencyKey: '78787878-7878-4878-8878-787878787878',
      payload: {
        institutionId: INSTITUTION_ID,
        examId: EXAM_ID,
        sessionIds: [sessionId],
      },
    }, '78787878-7878-4878-8878-787878787878'),
    environment(),
    { waitUntil: (promise) => scheduled.push(promise) },
  ));
  assert.equal(response.status, 200);
  assert.equal(scheduled.length, 1);
  await Promise.all(scheduled);
  assert.equal(calls.filter((entry) => entry.url.endsWith('/examination_room_v1_claim_recovery_snapshot')).length, 1);
});

test('result release sends one branded student email and a retry reuses durable provider acceptance', async () => {
  const sessionId = 'acacacac-acac-4cac-8cac-acacacacacac';
  const requestKey = '79797979-7979-4979-8979-797979797979';
  const claimToken = 'dededede-dede-4ede-8ede-dededededede';
  const studentEmail = 'andrea.reyes@example.edu.ph';
  const publication = buildPublicationVersion({
    examinationId: EXAM_ID,
    version: 4,
    publishedAt: '2026-08-26T01:00:00.000Z',
    draft: {
      title: 'Result Email Test',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
      instructions: 'Answer completely.',
      identityMode: 'real_names',
      integrityTier: 'standard',
      privacyNoticeVersion: 'exam-room-v1',
      questions: [{ type: 'essay', prompt: 'Discuss equal protection.', points: 10, wordLimit: 500 }],
    },
  }).manifest;
  const answer = normalizeAnswerRevision({
    attemptId: sessionId,
    questionNumber: 1,
    revision: 1,
    idempotencyKey: 'result-email-answer-revision-0001',
    answer: 'The student response.',
  }, { versionManifest: publication, publicationHash: 'a'.repeat(64) });
  const submission = buildSubmissionManifest({
    submissionId: 'cececece-cece-4ece-8ece-cececececece',
    attemptId: sessionId,
    idempotencyKey: 'result-email-submission-request-1',
    submittedAt: '2026-08-26T03:00:00.000Z',
    versionManifest: publication,
    publicationHash: 'a'.repeat(64),
    studentIdentity: {
      realName: 'Andrea Reyes',
      studentNumber: '2026-00002',
      subject: 'Constitutional Law',
      yearLevel: 'Second year',
    },
    privacyConsent: {
      noticeVersion: 'exam-room-v1',
      accepted: true,
      acceptedAt: '2026-08-26T01:55:00.000Z',
      recordingAccepted: false,
    },
    answerRevisions: [answer],
  }).manifest;
  const providerMessages = [];
  const scheduled = [];
  const releaseIds = [];
  let claimCalls = 0;
  let completionCalls = 0;

  const fetchMock = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ id: USER_ID, email: 'professor@example.edu.ph', user_metadata: {}, app_metadata: {} });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_staff_context')) {
      return jsonResponse({
        authorized: true,
        professorRoleSelected: false,
        memberships: [{ institutionId: INSTITUTION_ID, staffRole: 'professor', active: true }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_api')) {
      if (body.p_operation === 'release_context') {
        return jsonResponse({
          ok: true,
          entries: [{
            sessionId,
            submissionManifest: submission,
            scores: [{ questionNumber: 1, pointsAwarded: 9, feedback: 'Excellent analysis.' }],
            overallFeedback: 'Passed with distinction.',
            nextRevision: 3,
          }],
        });
      }
      assert.equal(body.p_operation, 'release_results');
      releaseIds.push(body.p_payload.releases[0].releaseManifest.releaseId);
      return jsonResponse({ ok: true, releasedCount: 1 });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_claim_result_email_deliveries')) {
      claimCalls += 1;
      assert.equal(body.p_actor_user_id, USER_ID);
      assert.equal(body.p_institution_id, INSTITUTION_ID);
      assert.equal(body.p_exam_id, EXAM_ID);
      assert.match(body.p_request_hash, /^[0-9a-f]{64}$/u);
      assert.equal(body.p_items.length, 1);
      assert.equal(body.p_items[0].releaseId, releaseIds.at(-1));
      return jsonResponse({
        ok: true,
        claimToken,
        items: [{
          releaseId: body.p_items[0].releaseId,
          sessionId,
          recipient: studentEmail,
          studentName: 'Andrea Reyes',
          examTitle: 'Result Email Test',
          subject: 'Constitutional Law',
          totalScore: 9,
          maximumScore: 10,
          releasedAt: '2026-08-26T04:00:00.000Z',
          status: claimCalls === 1 ? 'pending' : 'sent',
          providerId: claimCalls === 1 ? null : 'result-provider-1',
          safeErrorCode: null,
          attemptCount: 1,
          shouldSend: claimCalls === 1,
        }],
      });
    }
    if (String(url) === 'https://api.resend.com/emails/batch') {
      providerMessages.push({ body, headers: options.headers });
      return jsonResponse({ data: [{ id: 'result-provider-1' }] });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_complete_result_email_deliveries')) {
      completionCalls += 1;
      assert.equal(body.p_claim_token, claimToken);
      assert.deepEqual(body.p_outcomes, [{
        releaseId: releaseIds.at(-1),
        status: 'sent',
        providerId: 'result-provider-1',
        safeErrorCode: null,
      }]);
      return jsonResponse({
        ok: true,
        items: [{
          releaseId: releaseIds.at(-1),
          sessionId,
          recipient: studentEmail,
          status: 'sent',
          providerId: 'result-provider-1',
          safeErrorCode: null,
          attemptCount: 1,
        }],
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      return jsonResponse({ ok: true, job: null });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const release = () => withMockFetch(fetchMock, () => worker.fetch(
    request('/examination-room/v1/professor/command', {
      operation: 'release_results',
      idempotencyKey: requestKey,
      payload: { institutionId: INSTITUTION_ID, examId: EXAM_ID, sessionIds: [sessionId] },
    }, requestKey),
    environment(),
    { waitUntil: (promise) => scheduled.push(promise) },
  ));

  const firstResponse = await release();
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(first.release.delivery.status, 'sent');
  assert.equal(first.release.delivery.acceptedCount, 1);
  assert.equal(first.release.delivery.outcomes[0].providerId, 'result-provider-1');
  assert.equal(first.release.delivery.persistenceStatus, 'recorded');
  assert.equal(providerMessages.length, 1);
  assert.equal(providerMessages[0].body.length, 1);
  assert.deepEqual(providerMessages[0].body[0].to, [studentEmail]);
  assert.match(providerMessages[0].body[0].html, /assets\/brand\/logo1-master\.png/u);
  assert.doesNotMatch(providerMessages[0].body[0].html, /ER1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]/u);
  assert.match(String(providerMessages[0].headers['Idempotency-Key']), /^exam-room-results-[0-9a-f]{64}-001$/u);

  const replayResponse = await release();
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.release.delivery.status, 'sent');
  assert.equal(replay.release.delivery.outcomes[0].providerId, 'result-provider-1');
  assert.equal(providerMessages.length, 1);
  assert.equal(completionCalls, 1);
  assert.equal(claimCalls, 2);
  assert.equal(releaseIds[0], releaseIds[1]);
  await Promise.all(scheduled);
});
