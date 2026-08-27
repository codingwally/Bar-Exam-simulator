import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXAMINATION_ROOM_MEDIA_LIMITS,
  ExaminationRoomMediaError,
  createExaminationRoomMediaControl,
  normalizeExaminationRoomMediaRequest,
  wrapExaminationRoomMediaKey,
} from './examination-room-media.mjs';

const IDS = Object.freeze({
  session: '11111111-1111-4111-8111-111111111111',
  artifact: '22222222-2222-4222-8222-222222222222',
  intent: '33333333-3333-4333-8333-333333333333',
  storedArtifact: '44444444-4444-4444-8444-444444444444',
});

const SESSION_HASH = 'a'.repeat(64);
const REQUEST_HASH = 'b'.repeat(64);
const OBJECT_HASH = 'c'.repeat(64);
const DERIVED_KEY = Buffer.alloc(32, 7).toString('base64');
const MASTER_KEY = Buffer.alloc(32, 11).toString('base64');

function preparePayload(overrides = {}) {
  return {
    artifactId: IDS.artifact,
    artifactKind: 'camera_chunk',
    sourceMimeType: 'video/webm;codecs=vp8,opus',
    encryptedSizeBytes: 6_291_456,
    objectSha256: OBJECT_HASH,
    capturedFrom: '2026-08-28T02:00:00.000Z',
    capturedTo: '2026-08-28T02:04:00.000Z',
    derivedKey: DERIVED_KEY,
    ...overrides,
  };
}

function completePayload(overrides = {}) {
  const { derivedKey: _derivedKey, ...payload } = preparePayload(overrides);
  return {
    ...payload,
    provider: 'google_drive',
    providerObjectId: 'driveObject_12345678',
    ...overrides,
  };
}

function request(operation, payload) {
  return {
    operation,
    sessionId: IDS.session,
    sessionTokenHash: SESSION_HASH,
    requestHash: REQUEST_HASH,
    payload,
  };
}

function environment(overrides = {}) {
  return {
    EXAMINATION_ROOM_MEDIA_MASTER_KEY_V1: MASTER_KEY,
    GOOGLE_OAUTH_CLIENT_ID: 'drive-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'drive-client-secret',
    EXAMINATION_ROOM_GOOGLE_DRIVE_REFRESH_TOKEN: 'recording-only-refresh-token',
    EXAMINATION_ROOM_GOOGLE_DRIVE_FOLDER_ID: 'DriveFolder_12345678',
    SUPABASE_URL: 'https://project-ref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    ...overrides,
  };
}

function deterministicBytes(length) {
  return Uint8Array.from({ length }, (_, index) => (index * 19 + 3) % 256);
}

test('media request validation bounds type, size, capture window, fields, and key material', () => {
  const result = normalizeExaminationRoomMediaRequest('prepare_upload', preparePayload());
  assert.equal(result.artifactKind, 'camera_chunk');
  assert.equal(result.sourceMimeType, 'video/webm;codecs=vp8,opus');
  assert.equal(result.encryptedSizeBytes, 6_291_456);

  for (const payload of [
    preparePayload({ unknown: true }),
    preparePayload({ artifactKind: 'answer_document' }),
    preparePayload({ sourceMimeType: 'application/pdf' }),
    preparePayload({ encryptedSizeBytes: EXAMINATION_ROOM_MEDIA_LIMITS.maximumEncryptedBytes + 1 }),
    preparePayload({ capturedTo: '2026-08-28T03:00:01.000Z' }),
  ]) {
    assert.throws(
      () => normalizeExaminationRoomMediaRequest('prepare_upload', payload),
      (error) => error instanceof ExaminationRoomMediaError && error.status === 400,
    );
  }
});

test('derived media keys are AES-GCM wrapped and no raw key is returned', async () => {
  const envelope = await wrapExaminationRoomMediaKey(environment(), {
    sessionId: IDS.session,
    artifactId: IDS.artifact,
    objectSha256: OBJECT_HASH,
    derivedKey: DERIVED_KEY,
  }, { randomBytes: deterministicBytes });

  assert.equal(envelope.algorithm, 'aes-256-gcm-v1');
  assert.equal(envelope.keyVersion, 1);
  assert.match(envelope.ciphertext, /^[A-Za-z0-9_-]+$/u);
  assert.equal(Buffer.from(envelope.ciphertext, 'base64url').byteLength, 48, '32-byte key plus 16-byte GCM tag');
  assert.equal(Buffer.from(envelope.iv, 'base64url').byteLength, 12);
  assert.match(envelope.aadSha256, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(envelope).includes(DERIVED_KEY), false);
  assert.equal(JSON.stringify(envelope).includes(MASTER_KEY), false);
});

test('Google Drive is primary and returns only a direct resumable upload session', async () => {
  const fetchCalls = [];
  const rpcCalls = [];
  const fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'short-lived-access-token' });
    }
    return new Response(null, {
      status: 200,
      headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=direct-browser-session' },
    });
  };
  const mediaRpc = async (_env, call) => {
    rpcCalls.push(structuredClone(call));
    return { ok: true, intentId: IDS.intent, duplicate: false };
  };
  const control = createExaminationRoomMediaControl({
    fetch,
    mediaRpc,
    randomBytes: deterministicBytes,
    now: () => '2026-08-28T02:05:00.000Z',
  });

  const result = await control(environment(), request('prepare_upload', preparePayload()));

  assert.equal(result.state, 'upload_ready');
  assert.equal(result.provider, 'google_drive');
  assert.equal(result.upload.protocol, 'google_drive_resumable');
  assert.equal(result.upload.method, 'PUT');
  assert.match(result.upload.url, /^https:\/\/www\.googleapis\.com\/upload\//u);
  assert.equal(result.canContinueExam, true);
  assert.equal(result.submissionBlocked, false);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].init.body.get('refresh_token'), 'recording-only-refresh-token');
  assert.equal(fetchCalls[1].init.headers['X-Upload-Content-Length'], String(preparePayload().encryptedSizeBytes));
  assert.equal(fetchCalls.every((call) => !(call.init.body instanceof Blob)), true, 'Worker never proxies media bytes');
  assert.equal(rpcCalls.length, 1);
  const persisted = JSON.stringify(rpcCalls[0]);
  assert.doesNotMatch(persisted, /short-lived-access-token|recording-only-refresh-token|drive-client-secret/u);
  assert.equal(persisted.includes(DERIVED_KEY), false);
  assert.equal(rpcCalls[0].payload.provider, 'google_drive');
  assert.equal(rpcCalls[0].payload.keyEnvelope.algorithm, 'aes-256-gcm-v1');
});

test('Supabase private signed upload and TUS metadata are the automatic fallback', async () => {
  const fetchCalls = [];
  const rpcCalls = [];
  const fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({}, { status: 503 });
    if (String(url).includes('/storage/v1/object/upload/sign/')) {
      return Response.json({
        url: '/object/upload/sign/examination-room-media/sessions/path.enc?token=signed-upload-token',
      });
    }
    throw new Error('unexpected fetch');
  };
  const mediaRpc = async (_env, call) => {
    rpcCalls.push(structuredClone(call));
    return { ok: true, intentId: IDS.intent };
  };
  const control = createExaminationRoomMediaControl({
    fetch,
    mediaRpc,
    randomBytes: deterministicBytes,
    now: () => '2026-08-28T02:05:00.000Z',
  });

  const result = await control(environment(), request('prepare_upload', preparePayload()));

  assert.equal(result.state, 'upload_ready');
  assert.equal(result.provider, 'supabase_storage');
  assert.equal(result.upload.protocol, 'supabase_signed_upload');
  assert.equal(result.upload.method, 'PUT');
  assert.match(result.upload.url, /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/upload\/sign\//u);
  assert.equal(result.upload.resumable.endpoint, 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(result.upload.resumable.headers['x-signature'], 'signed-upload-token');
  assert.equal(result.upload.resumable.chunkSizeBytes, 6 * 1024 * 1024);
  assert.equal(rpcCalls[0].payload.providerObjectReference.startsWith('supabase-storage:examination-room-media:'), true);
  assert.doesNotMatch(JSON.stringify(rpcCalls), /signed-upload-token|service-role-secret/u);
});

test('all storage, key-service, and metadata outages degrade only recording to the local queue', async () => {
  const failingFetch = async () => { throw new Error('provider down'); };
  const failingRpc = async () => { throw new Error('database down'); };

  const noProviders = createExaminationRoomMediaControl({
    fetch: failingFetch,
    mediaRpc: async () => ({ ok: true, intentId: IDS.intent }),
    randomBytes: deterministicBytes,
  });
  const noMetadata = createExaminationRoomMediaControl({
    fetch: failingFetch,
    mediaRpc: failingRpc,
    randomBytes: deterministicBytes,
  });
  const noMasterKey = createExaminationRoomMediaControl({
    fetch: failingFetch,
    mediaRpc: failingRpc,
    randomBytes: deterministicBytes,
  });

  for (const [control, env] of [
    [noProviders, environment()],
    [noMetadata, environment()],
    [noMasterKey, environment({ EXAMINATION_ROOM_MEDIA_MASTER_KEY_V1: '' })],
  ]) {
    const result = await control(env, request('prepare_upload', preparePayload()));
    assert.equal(result.state, 'local_queue');
    assert.equal(result.retryable, true);
    assert.equal(result.canContinueExam, true);
    assert.equal(result.submissionBlocked, false);
    assert.match(result.recovery, /submit normally/iu);
  }
});

test('Drive completion verifies metadata without downloading media and registers idempotently', async () => {
  const fetchCalls = [];
  const rpcCalls = [];
  const payload = completePayload();
  const fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'short-lived-access-token' });
    }
    return Response.json({
      id: payload.providerObjectId,
      name: 'encrypted-segment.enc',
      size: String(payload.encryptedSizeBytes),
      trashed: false,
      appProperties: {
        ddArtifactId: payload.artifactId,
        ddSessionId: IDS.session,
        ddObjectSha256: payload.objectSha256,
      },
    });
  };
  const mediaRpc = async (_env, call) => {
    rpcCalls.push(structuredClone(call));
    return { ok: true, artifactId: IDS.storedArtifact, duplicate: true };
  };
  const control = createExaminationRoomMediaControl({ fetch, mediaRpc, now: () => '2026-08-28T02:06:00.000Z' });

  const result = await control(environment(), request('complete_upload', payload));

  assert.equal(result.state, 'completed');
  assert.equal(result.artifactRecordId, IDS.storedArtifact);
  assert.equal(result.duplicate, true);
  assert.equal(result.providerResult.status, 'verified');
  assert.equal(result.providerResult.contentHashVerified, false);
  assert.deepEqual(fetchCalls.map((call) => call.init.method), ['POST', 'GET']);
  assert.equal(fetchCalls.some((call) => call.init.method === 'GET' && call.init.body !== undefined), false);
  assert.equal(rpcCalls[0].operation, 'complete');
  assert.equal(rpcCalls[0].payload.providerVerified, true);
  assert.doesNotMatch(JSON.stringify(rpcCalls[0]), /short-lived-access-token/u);
});

test('Supabase completion verifies the deterministic private object without proxying it', async () => {
  const rpcCalls = [];
  const { derivedKey: _derivedKey, ...artifact } = preparePayload();
  const control = createExaminationRoomMediaControl({
    fetch: async (url, init) => {
      assert.match(String(url), /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/authenticated\/examination-room-media\//u);
      assert.equal(init.method, 'HEAD');
      assert.equal(init.body, undefined);
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(artifact.encryptedSizeBytes) },
      });
    },
    mediaRpc: async (_env, call) => {
      rpcCalls.push(structuredClone(call));
      return { ok: true, artifactId: IDS.storedArtifact, duplicate: false };
    },
    now: () => '2026-08-28T02:06:00.000Z',
  });

  const result = await control(environment(), request('complete_upload', {
    ...artifact,
    provider: 'supabase_storage',
    providerObjectId: null,
  }));

  assert.equal(result.state, 'completed');
  assert.equal(result.provider, 'supabase_storage');
  assert.match(result.providerResult.objectId, /^sessions\//u);
  assert.equal(rpcCalls[0].payload.providerObjectReference.startsWith('supabase-storage:examination-room-media:'), true);
  assert.equal(rpcCalls[0].payload.providerResult.contentHashVerified, false);
});

test('completion verification failures remain recoverable and never register an artifact', async () => {
  let rpcCalls = 0;
  const control = createExaminationRoomMediaControl({
    fetch: async (url) => String(url) === 'https://oauth2.googleapis.com/token'
      ? Response.json({ access_token: 'token' })
      : Response.json({ id: 'wrong-object', size: '1', appProperties: {} }),
    mediaRpc: async () => {
      rpcCalls += 1;
      return { ok: true };
    },
  });

  const result = await control(environment(), request('complete_upload', completePayload()));
  assert.equal(result.state, 'local_queue');
  assert.equal(result.providerResult.status, 'upload_verification_pending');
  assert.equal(result.submissionBlocked, false);
  assert.equal(rpcCalls, 0);
});
