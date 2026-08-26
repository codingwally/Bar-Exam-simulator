import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  EXAMINATION_ROOM_RECOVERY_FORMAT,
  EXAMINATION_ROOM_RECOVERY_LIMITS,
  RECOVERY_ERROR_CODES,
  createExaminationRoomRecovery,
  toSafeRecoveryError,
} from './examination-room-v1-recovery.mjs';

const IDS = Object.freeze({
  institution: '10000000-0000-4000-8000-000000000001',
  exam: '10000000-0000-4000-8000-000000000002',
  version: '10000000-0000-4000-8000-000000000003',
  snapshot: '10000000-0000-4000-8000-000000000004',
});

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

const MASTER_KEY = base64Url(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const WRONG_MASTER_KEY = base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index));

function bytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('Unsupported fake R2 value');
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
    this.putCalls = 0;
    this.getCalls = 0;
    this.headCalls = 0;
  }

  object(record) {
    if (!record) return null;
    return {
      key: record.key,
      size: record.bytes.byteLength,
      etag: record.etag,
      uploaded: record.uploaded,
      customMetadata: { ...record.customMetadata },
      httpMetadata: { ...record.httpMetadata },
    };
  }

  async put(key, value, options = {}) {
    this.putCalls += 1;
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
    const body = bytes(value);
    const record = {
      key,
      bytes: body,
      etag: `fake-etag-${this.putCalls}`,
      uploaded: new Date('2026-08-26T06:01:00.000Z'),
      customMetadata: { ...(options.customMetadata || {}) },
      httpMetadata: { ...(options.httpMetadata || {}) },
    };
    this.objects.set(key, record);
    return this.object(record);
  }

  async head(key) {
    this.headCalls += 1;
    return this.object(this.objects.get(key));
  }

  async get(key) {
    this.getCalls += 1;
    const record = this.objects.get(key);
    if (!record) return null;
    return {
      ...this.object(record),
      arrayBuffer: async () => record.bytes.slice().buffer,
    };
  }

  tamper(key) {
    const record = this.objects.get(key);
    if (!record) throw new Error('missing fake object');
    const altered = record.bytes.slice();
    altered[altered.length - 1] ^= 1;
    record.bytes = altered;
  }
}

function metadata(overrides = {}) {
  return {
    snapshotId: IDS.snapshot,
    institutionId: IDS.institution,
    examId: IDS.exam,
    examVersionId: IDS.version,
    sequence: 7,
    scope: 'full_recovery',
    recordCount: 4,
    createdAt: '2026-08-26T06:00:00.000Z',
    ...overrides,
  };
}

function payload() {
  return {
    sessions: [{ id: 'session-1', student: { studentNumber: '2026-001', fullName: 'Andrea Reyes' } }],
    questions: [
      { id: 'q-2', position: 2, prompt: 'Discuss due process.' },
      { id: 'q-1', position: 1, prompt: 'Discuss equal protection.' },
    ],
    answers: { 'q-2': 'Answer two', 'q-1': 'Answer one' },
    grades: [{ questionId: 'q-1', points: 8.5, feedback: 'Clear analysis.' }],
  };
}

function recovery(options = {}) {
  return createExaminationRoomRecovery({
    crypto: webcrypto,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream,
    ...options,
  });
}

test('materialize, head, retrieve, and verify round-trip canonical encrypted snapshot data', async () => {
  const bucket = new FakeR2();
  const env = {
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  };
  const service = recovery();
  const original = payload();
  const descriptor = await service.materialize(env, { metadata: metadata(), payload: original });

  assert.equal(descriptor.format, EXAMINATION_ROOM_RECOVERY_FORMAT);
  assert.equal(descriptor.keyVersion, 'v1');
  assert.equal(descriptor.duplicate, false);
  assert.match(descriptor.snapshotSha256, /^[0-9a-f]{64}$/u);
  assert.match(descriptor.contentSha256, /^[0-9a-f]{64}$/u);
  assert.match(descriptor.aadSha256, /^[0-9a-f]{64}$/u);
  assert.match(descriptor.objectKey, /examination-room-recovery\/v1/u);
  assert.equal(descriptor.encryptionKeyReference, 'worker-secret:EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1');
  assert.equal(bucket.putCalls, 1);

  const storedHead = await service.head(env, descriptor);
  assert.equal(storedHead.objectKey, descriptor.objectKey);
  assert.equal(storedHead.customMetadata.snapshotId, IDS.snapshot);
  assert.equal(storedHead.customMetadata.objectSha256, descriptor.snapshotSha256);

  const recovered = await service.retrieve(env, descriptor);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.verified, true);
  assert.deepEqual(recovered.payload, original);
  assert.deepEqual(recovered.metadata, metadata());
  assert.equal(recovered.descriptor.snapshotSha256, descriptor.snapshotSha256);

  const verification = await service.verify(env, descriptor);
  assert.equal(verification.verified, true);
  assert.equal('payload' in verification, false);
});

test('preflight validates the backup master key and confirms the private R2 bucket is reachable without writing', async () => {
  const bucket = new FakeR2();
  const result = await recovery().preflight({
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  });
  assert.deepEqual(result, {
    ok: true,
    keyVersion: 'v1',
    storageStatus: 'available',
    binding: 'EXAMINATION_ROOM_BACKUPS',
    storageProvider: 'cloudflare_r2',
    recoveryMode: 'free_bounded_source_snapshots',
    maxObjectBytes: 8 * 1024 * 1024,
    maxPlaintextBytes: 8 * 1024 * 1024,
    oversizeFallback: 'admin_examinations_export_all_json',
  });
  assert.equal(bucket.headCalls, 1);
  assert.equal(bucket.getCalls, 0);
  assert.equal(bucket.putCalls, 0);
});

test('private Supabase Storage fallback materializes, deduplicates, retrieves, and verifies encrypted snapshots', async () => {
  const stored = new Map();
  let bucketChecks = 0;
  let uploads = 0;
  const storageFetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers || {});
    assert.equal(headers.get('apikey'), 'service-role-test-key');
    assert.equal(headers.get('authorization'), 'Bearer service-role-test-key');
    if (url.pathname === '/storage/v1/bucket/examination-room-recovery') {
      bucketChecks += 1;
      return Response.json({ id: 'examination-room-recovery', public: false });
    }
    const authenticatedPrefix = '/storage/v1/object/authenticated/examination-room-recovery/';
    const uploadPrefix = '/storage/v1/object/examination-room-recovery/';
    if (url.pathname.startsWith(authenticatedPrefix)) {
      const objectKey = decodeURIComponent(url.pathname.slice(authenticatedPrefix.length));
      const body = stored.get(objectKey);
      if (!body) return Response.json({ message: 'not found' }, { status: 400 });
      return new Response(body.slice(), {
        status: 200,
        headers: { etag: 'supabase-etag-1', 'last-modified': 'Wed, 26 Aug 2026 06:01:00 GMT' },
      });
    }
    if (url.pathname.startsWith(uploadPrefix) && init.method === 'POST') {
      const objectKey = decodeURIComponent(url.pathname.slice(uploadPrefix.length));
      if (stored.has(objectKey)) return Response.json({ message: 'Asset Already Exists' }, { status: 400 });
      uploads += 1;
      stored.set(objectKey, bytes(init.body));
      return Response.json({ Key: `examination-room-recovery/${objectKey}` }, { headers: { etag: 'supabase-etag-1' } });
    }
    return Response.json({ message: 'unexpected route' }, { status: 500 });
  };
  const env = {
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_RECOVERY_MODE: 'supabase_storage',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  };
  const service = recovery({ fetch: storageFetch });
  const preflight = await service.preflight(env);
  assert.equal(preflight.storageProvider, 'supabase_storage');
  assert.equal(preflight.binding, 'SUPABASE_STORAGE:examination-room-recovery');
  assert.equal(preflight.recoveryMode, 'supabase_storage_free_bounded_source_snapshots');
  assert.equal(bucketChecks, 1);

  const first = await service.materialize(env, { metadata: metadata(), payload: payload() });
  assert.match(first.encryptedObjectReference, /^supabase-storage:examination-room-recovery:/u);
  assert.equal(first.duplicate, false);
  assert.equal(uploads, 1);
  const repeated = await service.materialize(env, { metadata: metadata(), payload: payload() });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.snapshotSha256, first.snapshotSha256);
  assert.equal(uploads, 1);

  const recovered = await service.retrieve(env, first);
  assert.deepEqual(recovered.payload, payload());
  assert.equal(recovered.descriptor.encryptedObjectReference, first.encryptedObjectReference);

  const altered = stored.get(first.objectKey).slice();
  altered[altered.length - 1] ^= 1;
  stored.set(first.objectKey, altered);
  await assert.rejects(
    service.verify(env, first),
    (error) => error.code === RECOVERY_ERROR_CODES.CHECKSUM_MISMATCH,
  );
});

test('preflight distinguishes an unavailable R2 bucket from missing configuration', async () => {
  const unavailableBucket = new FakeR2();
  unavailableBucket.head = async () => { throw new Error('simulated R2 outage'); };
  await assert.rejects(
    recovery().preflight({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: unavailableBucket,
    }),
    (error) => error.code === RECOVERY_ERROR_CODES.STORAGE_UNAVAILABLE
      && !String(error.message).includes(MASTER_KEY),
  );
  await assert.rejects(
    recovery().preflight({ EXAMINATION_ROOM_BACKUPS: new FakeR2() }),
    (error) => error.code === RECOVERY_ERROR_CODES.NOT_CONFIGURED,
  );
});

test('the versioned master key may use explicit hex encoding', async () => {
  const bucket = new FakeR2();
  const env = {
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: `hex:${'ab'.repeat(32)}`,
    EXAMINATION_ROOM_BACKUPS: bucket,
  };
  const service = recovery();
  const descriptor = await service.createMaterializedSnapshot(env, {
    metadata: metadata(),
    payload: { value: true },
  });
  const recovered = await service.decrypt(env, descriptor);
  assert.deepEqual(recovered.payload, { value: true });
});

test('a different versioned master key cannot authenticate or decrypt the object', async () => {
  const bucket = new FakeR2();
  const service = recovery();
  const descriptor = await service.materialize({
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  }, { metadata: metadata(), payload: payload() });

  await assert.rejects(
    service.retrieve({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: WRONG_MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: bucket,
    }, descriptor),
    (error) => error.code === RECOVERY_ERROR_CODES.DECRYPT_FAILED
      && !String(error.message).includes(MASTER_KEY),
  );
});

test('altered R2 bytes fail checksum verification before restore data is returned', async () => {
  const bucket = new FakeR2();
  const env = {
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  };
  const service = recovery();
  const descriptor = await service.materialize(env, { metadata: metadata(), payload: payload() });
  bucket.tamper(descriptor.objectKey);

  await assert.rejects(
    service.retrieve(env, descriptor),
    (error) => error.code === RECOVERY_ERROR_CODES.CHECKSUM_MISMATCH,
  );
});

test('materialization is idempotent and refuses a different payload at the immutable object key', async () => {
  const bucket = new FakeR2();
  const env = {
    EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
    EXAMINATION_ROOM_BACKUPS: bucket,
  };
  const service = recovery();
  const first = await service.materialize(env, { metadata: metadata(), payload: payload() });
  const repeated = await service.materialize(env, { metadata: metadata(), payload: payload() });

  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.snapshotSha256, first.snapshotSha256);
  assert.equal(bucket.putCalls, 1);
  assert.equal(bucket.objects.size, 1);

  await assert.rejects(
    service.materialize(env, {
      metadata: metadata(),
      payload: { ...payload(), answers: { 'q-1': 'A different immutable answer' } },
    }),
    (error) => error.code === RECOVERY_ERROR_CODES.OBJECT_CONFLICT,
  );
  assert.equal(bucket.putCalls, 1);
});

test('oversized Free-plan recovery fails before R2 writes and points to the existing owner JSON export instead of nonexistent chunks', async () => {
  const bucket = new FakeR2();
  let rejected;
  await assert.rejects(
    recovery().materialize({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: bucket,
    }, {
      metadata: metadata(),
      payload: { oversized: 'x'.repeat(8 * 1024 * 1024) },
    }),
    (error) => {
      rejected = error;
      return error.code === RECOVERY_ERROR_CODES.OBJECT_TOO_LARGE
        && /Admin > Examination Room > Examinations/u.test(error.recovery)
        && /Export all JSON/u.test(error.recovery)
        && !/chunks?/iu.test(error.recovery);
    },
  );
  assert.equal(rejected.details.maximumBytes, EXAMINATION_ROOM_RECOVERY_LIMITS.maxPlaintextBytes);
  assert.ok(rejected.details.actualBytes > rejected.details.maximumBytes);
  assert.equal(rejected.details.scope, 'full_recovery');
  assert.equal(rejected.details.stage, 'canonical_plaintext');
  assert.equal(rejected.details.fallback, 'admin_examinations_export_all_json');
  assert.deepEqual(toSafeRecoveryError(rejected).error.details, rejected.details);
  assert.equal(bucket.headCalls, 0);
  assert.equal(bucket.putCalls, 0);
});

test('missing configuration and invalid metadata return stable, non-secret safe errors', async () => {
  const service = recovery();
  let missing;
  try {
    await service.materialize({ EXAMINATION_ROOM_BACKUPS: new FakeR2() }, {
      metadata: metadata(),
      payload: payload(),
    });
  } catch (error) {
    missing = error;
  }
  assert.equal(missing.code, RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  const safe = toSafeRecoveryError(missing);
  assert.equal(safe.ok, false);
  assert.equal(safe.error.code, RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  assert.equal(JSON.stringify(safe).includes(MASTER_KEY), false);

  await assert.rejects(
    service.materialize({
      EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1: MASTER_KEY,
      EXAMINATION_ROOM_BACKUPS: new FakeR2(),
    }, {
      metadata: metadata({ scope: 'everything', sequence: 0 }),
      payload: payload(),
    }),
    (error) => error.code === RECOVERY_ERROR_CODES.INVALID_INPUT,
  );
});
