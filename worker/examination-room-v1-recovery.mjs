const FORMAT = 'duediligence-examination-room-recovery-v1';
const FORMAT_VERSION = 1;
const OBJECT_PREFIX = 'examination-room-recovery/v1';
const OBJECT_CONTENT_TYPE = 'application/vnd.duediligence.examination-room-recovery+json';
const SUPABASE_STORAGE_BUCKET = 'examination-room-recovery';
const R2_REFERENCE_PREFIX = 'r2:EXAMINATION_ROOM_BACKUPS:';
const SUPABASE_REFERENCE_PREFIX = `supabase-storage:${SUPABASE_STORAGE_BUCKET}:`;
const DEFAULT_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_VERSION_PATTERN = /^v[1-9][0-9]{0,2}$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;
const HEX_PATTERN = /^[0-9a-f]{64}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_SCOPES = new Set(['exam_definition', 'answer_state', 'grading_state', 'full_recovery']);

export const EXAMINATION_ROOM_RECOVERY_FORMAT = FORMAT;
export const EXAMINATION_ROOM_RECOVERY_LIMITS = Object.freeze({
  maxObjectBytes: DEFAULT_MAX_OBJECT_BYTES,
  maxPlaintextBytes: DEFAULT_MAX_PLAINTEXT_BYTES,
  oversizeFallback: 'admin_examinations_export_all_json',
});

export const RECOVERY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'EXAM_ROOM_V1_RECOVERY_INVALID_INPUT',
  NOT_CONFIGURED: 'EXAM_ROOM_V1_RECOVERY_NOT_CONFIGURED',
  CRYPTO_UNAVAILABLE: 'EXAM_ROOM_V1_RECOVERY_CRYPTO_UNAVAILABLE',
  COMPRESSION_UNAVAILABLE: 'EXAM_ROOM_V1_RECOVERY_COMPRESSION_UNAVAILABLE',
  ENCRYPT_FAILED: 'EXAM_ROOM_V1_RECOVERY_ENCRYPT_FAILED',
  UPLOAD_FAILED: 'EXAM_ROOM_V1_RECOVERY_UPLOAD_FAILED',
  STORAGE_UNAVAILABLE: 'EXAM_ROOM_V1_RECOVERY_STORAGE_UNAVAILABLE',
  OBJECT_CONFLICT: 'EXAM_ROOM_V1_RECOVERY_OBJECT_CONFLICT',
  OBJECT_NOT_FOUND: 'EXAM_ROOM_V1_RECOVERY_OBJECT_NOT_FOUND',
  OBJECT_TOO_LARGE: 'EXAM_ROOM_V1_RECOVERY_OBJECT_TOO_LARGE',
  DOWNLOAD_FAILED: 'EXAM_ROOM_V1_RECOVERY_DOWNLOAD_FAILED',
  CHECKSUM_MISMATCH: 'EXAM_ROOM_V1_RECOVERY_CHECKSUM_MISMATCH',
  METADATA_MISMATCH: 'EXAM_ROOM_V1_RECOVERY_METADATA_MISMATCH',
  DECRYPT_FAILED: 'EXAM_ROOM_V1_RECOVERY_DECRYPT_FAILED',
  DECOMPRESSION_FAILED: 'EXAM_ROOM_V1_RECOVERY_DECOMPRESSION_FAILED',
  PAYLOAD_INVALID: 'EXAM_ROOM_V1_RECOVERY_PAYLOAD_INVALID',
});

const SAFE_ERRORS = Object.freeze({
  [RECOVERY_ERROR_CODES.INVALID_INPUT]: [
    'The recovery snapshot details are incomplete or invalid.',
    400,
    'Refresh the Examination Room command center and create the snapshot again.',
  ],
  [RECOVERY_ERROR_CODES.NOT_CONFIGURED]: [
    'Encrypted recovery storage is not configured.',
    503,
    'Ask the platform owner to finish the Examination Room backup setup, then retry this snapshot.',
  ],
  [RECOVERY_ERROR_CODES.CRYPTO_UNAVAILABLE]: [
    'The recovery snapshot could not use the required encryption service.',
    503,
    'Wait briefly and retry. If it continues, use the command center recovery report.',
  ],
  [RECOVERY_ERROR_CODES.COMPRESSION_UNAVAILABLE]: [
    'The recovery snapshot compression format is not available in this runtime.',
    503,
    'Retry after the Examination Room Worker has been updated.',
  ],
  [RECOVERY_ERROR_CODES.ENCRYPT_FAILED]: [
    'The recovery snapshot could not be encrypted.',
    503,
    'No unencrypted backup was stored. Retry from the command center.',
  ],
  [RECOVERY_ERROR_CODES.UPLOAD_FAILED]: [
    'The encrypted recovery snapshot could not be stored.',
    503,
    'The database copy remains unchanged. Retry the pending snapshot from the command center.',
  ],
  [RECOVERY_ERROR_CODES.STORAGE_UNAVAILABLE]: [
    'The private Examination Room recovery storage is temporarily unavailable.',
    503,
    'No database records were changed. Check the configured private storage and run Preflight again.',
  ],
  [RECOVERY_ERROR_CODES.OBJECT_CONFLICT]: [
    'A different recovery object already uses this immutable snapshot reference.',
    409,
    'Do not overwrite it. Verify the existing object and create a new snapshot if needed.',
  ],
  [RECOVERY_ERROR_CODES.OBJECT_NOT_FOUND]: [
    'The encrypted recovery object could not be found.',
    404,
    'Refresh backup status, then retry materialization or choose another available snapshot.',
  ],
  [RECOVERY_ERROR_CODES.OBJECT_TOO_LARGE]: [
    'The recovery checkpoint exceeds this Worker\'s protected-object limit.',
    413,
    'The live database record is unchanged. In Admin > Examination Room > Examinations, choose Export all JSON and retain that owner-only file offline. Automatic source-bound checkpoints continue for records that fit the configured limit.',
  ],
  [RECOVERY_ERROR_CODES.DOWNLOAD_FAILED]: [
    'The encrypted recovery object could not be downloaded.',
    503,
    'Wait briefly, then retry from the command center.',
  ],
  [RECOVERY_ERROR_CODES.CHECKSUM_MISMATCH]: [
    'Recovery snapshot integrity verification failed.',
    409,
    'Do not restore this object. Retain it for diagnosis and create a new verified snapshot.',
  ],
  [RECOVERY_ERROR_CODES.METADATA_MISMATCH]: [
    'The recovery object does not match the selected examination snapshot.',
    409,
    'Choose the snapshot listed for this exact examination and immutable version.',
  ],
  [RECOVERY_ERROR_CODES.DECRYPT_FAILED]: [
    'The recovery snapshot could not be authenticated and decrypted.',
    409,
    'Verify the configured backup-key version and object integrity before retrying.',
  ],
  [RECOVERY_ERROR_CODES.DECOMPRESSION_FAILED]: [
    'The decrypted recovery snapshot could not be decompressed.',
    409,
    'Do not restore this object. Create and verify a replacement snapshot.',
  ],
  [RECOVERY_ERROR_CODES.PAYLOAD_INVALID]: [
    'The recovery snapshot payload is not valid canonical Examination Room data.',
    409,
    'Do not restore it. Create a new snapshot and run verification again.',
  ],
});

export class ExaminationRoomRecoveryError extends Error {
  constructor(code, options = {}) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS[RECOVERY_ERROR_CODES.PAYLOAD_INVALID];
    super(options.message || safe[0]);
    this.name = 'ExaminationRoomRecoveryError';
    this.code = code;
    this.status = options.status || safe[1];
    this.recovery = options.recovery || safe[2];
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function recoveryError(code, cause) {
  return new ExaminationRoomRecoveryError(code, { cause });
}

function isRecoveryError(error) {
  return error instanceof ExaminationRoomRecoveryError;
}

export function toSafeRecoveryError(error) {
  const safe = isRecoveryError(error)
    ? error
    : recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID);
  return {
    ok: false,
    error: {
      code: safe.code,
      message: safe.message,
      status: safe.status,
      recovery: safe.recovery,
      ...(safe.details !== undefined ? { details: safe.details } : {}),
    },
  };
}

function objectTooLargeError(metadata, actualBytes, maximumBytes, stage) {
  return new ExaminationRoomRecoveryError(RECOVERY_ERROR_CODES.OBJECT_TOO_LARGE, {
    details: Object.freeze({
      actualBytes: Number.isSafeInteger(actualBytes) && actualBytes >= 0 ? actualBytes : null,
      maximumBytes,
      scope: metadata?.scope || null,
      stage,
      fallback: EXAMINATION_ROOM_RECOVERY_LIMITS.oversizeFallback,
    }),
  });
}

function runtimeFrom(dependencies = {}) {
  const fetchImplementation = dependencies.fetch || globalThis.fetch;
  const runtime = {
    crypto: dependencies.crypto || globalThis.crypto,
    TextEncoder: dependencies.TextEncoder || globalThis.TextEncoder,
    TextDecoder: dependencies.TextDecoder || globalThis.TextDecoder,
    CompressionStream: dependencies.CompressionStream || globalThis.CompressionStream,
    DecompressionStream: dependencies.DecompressionStream || globalThis.DecompressionStream,
    Blob: dependencies.Blob || globalThis.Blob,
    Response: dependencies.Response || globalThis.Response,
    btoa: dependencies.btoa || globalThis.btoa,
    atob: dependencies.atob || globalThis.atob,
    fetch: typeof fetchImplementation === 'function'
      ? (...args) => Reflect.apply(fetchImplementation, globalThis, args)
      : fetchImplementation,
  };
  if (!runtime.crypto?.subtle || typeof runtime.crypto.getRandomValues !== 'function') {
    throw recoveryError(RECOVERY_ERROR_CODES.CRYPTO_UNAVAILABLE);
  }
  if (!runtime.TextEncoder || !runtime.TextDecoder || !runtime.btoa || !runtime.atob) {
    throw recoveryError(RECOVERY_ERROR_CODES.CRYPTO_UNAVAILABLE);
  }
  return runtime;
}

function positiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function bytesToBase64Url(bytes, runtime) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return runtime.btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function base64ToBytes(value, runtime) {
  const text = String(value || '').trim();
  if (!text || !BASE64_PATTERN.test(text)) throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID);
  const normalized = text.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    const binary = runtime.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (cause) {
    throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID, cause);
  }
}

function hexToBytes(value) {
  const text = String(value || '').trim();
  if (!HEX_PATTERN.test(text)) throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(text.slice(index * 2, index * 2 + 2), 16));
}

function masterKeyBytes(secret, runtime) {
  const source = String(secret || '').trim();
  if (!source) throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  let bytes;
  if (source.startsWith('hex:')) {
    bytes = hexToBytes(source.slice(4));
  } else if (source.startsWith('base64:')) {
    bytes = base64ToBytes(source.slice(7), runtime);
  } else if (source.startsWith('base64url:')) {
    bytes = base64ToBytes(source.slice(10), runtime);
  } else if (source.startsWith('raw:')) {
    bytes = new runtime.TextEncoder().encode(source.slice(4));
  } else if (HEX_PATTERN.test(source)) {
    bytes = hexToBytes(source);
  } else if (new runtime.TextEncoder().encode(source).byteLength === 32) {
    bytes = new runtime.TextEncoder().encode(source);
  } else if (BASE64_PATTERN.test(source)) {
    bytes = base64ToBytes(source, runtime);
  } else {
    bytes = new runtime.TextEncoder().encode(source);
  }
  if (bytes.byteLength !== 32) throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  return bytes;
}

function keyVersionSecret(env, keyVersion, runtime) {
  const normalized = String(keyVersion || 'v1').trim().toLowerCase();
  if (!KEY_VERSION_PATTERN.test(normalized)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  const variable = `EXAMINATION_ROOM_BACKUP_MASTER_KEY_${normalized.toUpperCase()}`;
  return { keyVersion: normalized, variable, bytes: masterKeyBytes(env?.[variable], runtime) };
}

function canonicalJson(value) {
  const seen = new Set();
  let nodes = 0;
  function normalize(entry, depth) {
    nodes += 1;
    if (nodes > 1_000_000 || depth > 80) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
      return Object.is(entry, -0) ? 0 : entry;
    }
    if (typeof entry !== 'object') throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
    if (seen.has(entry)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
    seen.add(entry);
    let normalized;
    if (Array.isArray(entry)) {
      normalized = entry.map((item) => normalize(item, depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        seen.delete(entry);
        throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
      }
      normalized = {};
      for (const key of Object.keys(entry).sort()) normalized[key] = normalize(entry[key], depth + 1);
    }
    seen.delete(entry);
    return normalized;
  }
  return JSON.stringify(normalize(value, 0));
}

function uuid(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT, new TypeError(label));
  return normalized;
}

function instant(value) {
  const parsed = new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  return parsed.toISOString();
}

function normalizeMetadata(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sequence = Number(source.sequence);
  const recordCount = Number(source.recordCount);
  const scope = String(source.scope || '').trim();
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 2_147_483_647) {
    throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  }
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) {
    throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  }
  if (!ALLOWED_SCOPES.has(scope)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  return Object.freeze({
    snapshotId: uuid(source.snapshotId, 'snapshotId'),
    institutionId: uuid(source.institutionId, 'institutionId'),
    examId: uuid(source.examId, 'examId'),
    examVersionId: uuid(source.examVersionId, 'examVersionId'),
    sequence,
    scope,
    recordCount,
    createdAt: instant(source.createdAt),
  });
}

function objectKeyFor(metadata) {
  return `${OBJECT_PREFIX}/${metadata.institutionId}/${metadata.examId}/${String(metadata.sequence).padStart(10, '0')}-${metadata.snapshotId}/snapshot.ddbackup`;
}

function validObjectKey(value) {
  const key = String(value || '').trim();
  const escapedPrefix = OBJECT_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const uuidPart = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const pattern = new RegExp(`^${escapedPrefix}/${uuidPart}/${uuidPart}/[0-9]{10}-${uuidPart}/snapshot\\.ddbackup$`, 'u');
  if (!pattern.test(key)) throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  return key;
}

async function sha256Hex(bytes, runtime) {
  let digest;
  try {
    digest = await runtime.crypto.subtle.digest('SHA-256', bytes);
  } catch (cause) {
    throw recoveryError(RECOVERY_ERROR_CODES.CRYPTO_UNAVAILABLE, cause);
  }
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveSnapshotKey(masterBytes, metadata, keyVersion, runtime) {
  const encoder = new runtime.TextEncoder();
  const saltText = `${FORMAT}\0${metadata.institutionId}\0${metadata.examId}\0${metadata.examVersionId}\0${metadata.snapshotId}`;
  const infoText = `${FORMAT}\0${keyVersion}\0${metadata.scope}\0${metadata.sequence}`;
  try {
    const material = await runtime.crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, ['deriveKey']);
    return await runtime.crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(saltText), info: encoder.encode(infoText) },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch (cause) {
    throw recoveryError(RECOVERY_ERROR_CODES.CRYPTO_UNAVAILABLE, cause);
  }
}

async function transformBytes(bytes, constructor, format, runtime, failureCode) {
  if (!constructor || !runtime.Blob || !runtime.Response) {
    throw recoveryError(RECOVERY_ERROR_CODES.COMPRESSION_UNAVAILABLE);
  }
  try {
    const transformed = new runtime.Blob([bytes]).stream().pipeThrough(new constructor(format));
    return new Uint8Array(await new runtime.Response(transformed).arrayBuffer());
  } catch (cause) {
    throw recoveryError(failureCode, cause);
  }
}

async function compress(bytes, runtime) {
  if (!runtime.CompressionStream) return { encoding: 'identity', bytes };
  return {
    encoding: 'gzip',
    bytes: await transformBytes(
      bytes,
      runtime.CompressionStream,
      'gzip',
      runtime,
      RECOVERY_ERROR_CODES.COMPRESSION_UNAVAILABLE,
    ),
  };
}

async function decompress(bytes, encoding, runtime) {
  if (encoding === 'identity') return bytes;
  if (encoding !== 'gzip') throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID);
  return transformBytes(
    bytes,
    runtime.DecompressionStream,
    'gzip',
    runtime,
    RECOVERY_ERROR_CODES.DECOMPRESSION_FAILED,
  );
}

function authMetadata({ metadata, objectKey, keyVersion, encoding, contentSha256 }) {
  return {
    algorithm: 'AES-256-GCM',
    contentSha256,
    encoding,
    format: FORMAT,
    keyVersion,
    metadata,
    objectKey,
    version: FORMAT_VERSION,
  };
}

function storageMetadataMatches(object, expected) {
  const stored = object?.customMetadata || {};
  return stored.format === FORMAT
    && stored.snapshotId === expected.metadata.snapshotId
    && stored.keyVersion === expected.keyVersion
    && stored.contentSha256 === expected.contentSha256
    && stored.aadSha256 === expected.aadSha256
    && stored.scope === expected.metadata.scope
    && stored.examVersionId === expected.metadata.examVersionId;
}

function descriptorFrom(object, expected, storage, duplicate = false) {
  const stored = object?.customMetadata || {};
  const snapshotSha256 = stored.objectSha256 || expected.objectSha256;
  if (!SHA256_PATTERN.test(String(snapshotSha256 || ''))) {
    throw recoveryError(RECOVERY_ERROR_CODES.METADATA_MISMATCH);
  }
  return Object.freeze({
    format: FORMAT,
    encryptedObjectReference: `${storage.referencePrefix}${expected.objectKey}`,
    objectKey: expected.objectKey,
    snapshotSha256,
    contentSha256: expected.contentSha256,
    aadSha256: expected.aadSha256,
    encryptionKeyReference: `worker-secret:EXAMINATION_ROOM_BACKUP_MASTER_KEY_${expected.keyVersion.toUpperCase()}`,
    keyVersion: expected.keyVersion,
    encoding: expected.encoding,
    metadata: expected.metadata,
    size: Number(object?.size || expected.size || 0),
    etag: object?.etag || null,
    uploadedAt: object?.uploaded instanceof Date ? object.uploaded.toISOString() : null,
    duplicate,
  });
}

function supabaseStoragePath(value) {
  return String(value || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function supabaseStorageConfiguration(env, runtime) {
  const baseUrl = String(env?.SUPABASE_URL || '').trim().replace(/\/+$/u, '');
  const serviceKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!baseUrl || !/^https:\/\/[^/]+$/u.test(baseUrl) || !serviceKey || typeof runtime.fetch !== 'function') {
    throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  }
  const headers = Object.freeze({
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
  });
  const bucketPath = encodeURIComponent(SUPABASE_STORAGE_BUCKET);
  return Object.freeze({ baseUrl, headers, bucketPath });
}

async function supabaseStorageObject(response, runtime, fallbackMetadata = {}) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let envelope = null;
  try {
    envelope = JSON.parse(new runtime.TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    envelope = null;
  }
  const objectSha256 = await sha256Hex(bytes, runtime);
  const metadata = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
    ? envelope.metadata
    : null;
  const customMetadata = {
    ...fallbackMetadata,
    ...(envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? {
      aadSha256: String(envelope.aadSha256 || ''),
      contentSha256: String(envelope.contentSha256 || ''),
      encoding: String(envelope.encoding || ''),
      examVersionId: String(metadata?.examVersionId || ''),
      format: String(envelope.format || ''),
      keyVersion: String(envelope.keyVersion || ''),
      objectSha256,
      scope: String(metadata?.scope || ''),
      snapshotId: String(metadata?.snapshotId || ''),
    } : { objectSha256 }),
  };
  const uploadedHeader = response.headers?.get?.('last-modified');
  const uploaded = uploadedHeader && Number.isFinite(Date.parse(uploadedHeader))
    ? new Date(uploadedHeader)
    : null;
  return Object.freeze({
    size: bytes.byteLength,
    etag: response.headers?.get?.('etag') || null,
    uploaded,
    customMetadata: Object.freeze(customMetadata),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

function createSupabaseStorageBinding(env, runtime) {
  const configuration = supabaseStorageConfiguration(env, runtime);
  const objectUrl = (objectKey, authenticated = true) => `${configuration.baseUrl}/storage/v1/object/${authenticated ? 'authenticated/' : ''}${configuration.bucketPath}/${supabaseStoragePath(objectKey)}`;
  const bucketUrl = `${configuration.baseUrl}/storage/v1/bucket/${configuration.bucketPath}`;
  const bucketReady = async () => {
    const response = await runtime.fetch(bucketUrl, { headers: configuration.headers });
    if (!response.ok) throw new TypeError(`private storage unavailable (${response.status})`);
    const body = await response.json().catch(() => null);
    if (!body || body.id !== SUPABASE_STORAGE_BUCKET || body.public === true) {
      throw new TypeError('private storage configuration mismatch');
    }
  };
  const read = async (objectKey) => {
    const response = await runtime.fetch(objectUrl(objectKey), { headers: configuration.headers });
    if (response.status === 400 || response.status === 404) {
      await bucketReady();
      return null;
    }
    if (!response.ok) throw new TypeError(`private object read failed (${response.status})`);
    return supabaseStorageObject(response, runtime);
  };
  return Object.freeze({
    head: read,
    get: read,
    async put(objectKey, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const response = await runtime.fetch(objectUrl(objectKey, false), {
        method: 'POST',
        headers: {
          ...configuration.headers,
          'cache-control': options?.httpMetadata?.cacheControl || 'no-store',
          'content-type': options?.httpMetadata?.contentType || OBJECT_CONTENT_TYPE,
          'x-upsert': 'false',
        },
        body: bytes,
      });
      if ([400, 409, 412].includes(response.status)) return null;
      if (!response.ok) throw new TypeError(`private object upload failed (${response.status})`);
      return Object.freeze({
        size: bytes.byteLength,
        etag: response.headers?.get?.('etag') || null,
        uploaded: new Date(),
        customMetadata: Object.freeze({ ...(options.customMetadata || {}) }),
      });
    },
  });
}

function recoveryStorage(env, operations, runtime) {
  const requestedMode = String(env?.EXAMINATION_ROOM_RECOVERY_MODE || 'auto').trim().toLowerCase();
  if (!['auto', 'r2', 'supabase_storage'].includes(requestedMode)) {
    throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  }
  const r2 = env?.EXAMINATION_ROOM_BACKUPS;
  const r2Ready = r2 && operations.every((operation) => typeof r2[operation] === 'function');
  if (requestedMode !== 'supabase_storage' && r2Ready) {
    return Object.freeze({
      binding: r2,
      name: 'EXAMINATION_ROOM_BACKUPS',
      provider: 'cloudflare_r2',
      referencePrefix: R2_REFERENCE_PREFIX,
      recoveryMode: 'free_bounded_source_snapshots',
    });
  }
  if (requestedMode === 'r2') throw recoveryError(RECOVERY_ERROR_CODES.NOT_CONFIGURED);
  const binding = createSupabaseStorageBinding(env, runtime);
  return Object.freeze({
    binding,
    name: `SUPABASE_STORAGE:${SUPABASE_STORAGE_BUCKET}`,
    provider: 'supabase_storage',
    referencePrefix: SUPABASE_REFERENCE_PREFIX,
    recoveryMode: 'supabase_storage_free_bounded_source_snapshots',
  });
}

async function readObjectBytes(object, maximum, metadata = null) {
  if (Number.isFinite(Number(object?.size)) && Number(object.size) > maximum) {
    throw objectTooLargeError(metadata, Number(object.size), maximum, 'stored_object');
  }
  if (!object || typeof object.arrayBuffer !== 'function') {
    throw recoveryError(RECOVERY_ERROR_CODES.DOWNLOAD_FAILED);
  }
  let bytes;
  try {
    bytes = new Uint8Array(await object.arrayBuffer());
  } catch (cause) {
    throw recoveryError(RECOVERY_ERROR_CODES.DOWNLOAD_FAILED, cause);
  }
  if (bytes.byteLength > maximum) {
    throw objectTooLargeError(metadata, bytes.byteLength, maximum, 'stored_object');
  }
  return bytes;
}

function expectedReference(input) {
  if (typeof input === 'string') return { objectKey: validObjectKey(input) };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
  }
  return {
    objectKey: validObjectKey(input.objectKey),
    snapshotSha256: input.snapshotSha256 == null ? null : String(input.snapshotSha256).toLowerCase(),
    metadata: input.metadata == null ? null : normalizeMetadata(input.metadata),
  };
}

export function createExaminationRoomRecovery(dependencies = {}) {
  const runtime = runtimeFrom(dependencies);
  const maxObjectBytes = positiveLimit(dependencies.maxObjectBytes, DEFAULT_MAX_OBJECT_BYTES);
  const maxPlaintextBytes = positiveLimit(dependencies.maxPlaintextBytes, DEFAULT_MAX_PLAINTEXT_BYTES);

  async function preflight(env) {
    const keyMaterial = keyVersionSecret(env, 'v1', runtime);
    const storage = recoveryStorage(env, ['head', 'get', 'put'], runtime);
    try {
      await storage.binding.head(`${OBJECT_PREFIX}/.preflight`);
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.STORAGE_UNAVAILABLE, cause);
    }
    return Object.freeze({
      ok: true,
      keyVersion: keyMaterial.keyVersion,
      storageStatus: 'available',
      binding: storage.name,
      storageProvider: storage.provider,
      recoveryMode: storage.recoveryMode,
      maxObjectBytes,
      maxPlaintextBytes,
      oversizeFallback: EXAMINATION_ROOM_RECOVERY_LIMITS.oversizeFallback,
    });
  }

  async function materialize(env, request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !('payload' in request)) {
      throw recoveryError(RECOVERY_ERROR_CODES.INVALID_INPUT);
    }
    const metadata = normalizeMetadata(request.metadata || request);
    const keyMaterial = keyVersionSecret(env, request.keyVersion || 'v1', runtime);
    const storage = recoveryStorage(env, ['head', 'put'], runtime);
    const binding = storage.binding;
    const objectKey = objectKeyFor(metadata);
    const encoder = new runtime.TextEncoder();
    const canonicalPayload = canonicalJson(request.payload);
    const plaintext = encoder.encode(canonicalPayload);
    if (plaintext.byteLength > maxPlaintextBytes) {
      throw objectTooLargeError(metadata, plaintext.byteLength, maxPlaintextBytes, 'canonical_plaintext');
    }
    const contentSha256 = await sha256Hex(plaintext, runtime);
    const compressed = await compress(plaintext, runtime);
    const authenticated = authMetadata({
      metadata,
      objectKey,
      keyVersion: keyMaterial.keyVersion,
      encoding: compressed.encoding,
      contentSha256,
    });
    const additionalData = encoder.encode(canonicalJson(authenticated));
    const aadSha256 = await sha256Hex(additionalData, runtime);
    const expected = {
      metadata,
      objectKey,
      keyVersion: keyMaterial.keyVersion,
      encoding: compressed.encoding,
      contentSha256,
      aadSha256,
    };

    let existing;
    try {
      existing = await binding.head(objectKey);
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.UPLOAD_FAILED, cause);
    }
    if (existing) {
      if (!storageMetadataMatches(existing, expected)) throw recoveryError(RECOVERY_ERROR_CODES.OBJECT_CONFLICT);
      return descriptorFrom(existing, expected, storage, true);
    }

    const key = await deriveSnapshotKey(keyMaterial.bytes, metadata, keyMaterial.keyVersion, runtime);
    const iv = new Uint8Array(12);
    runtime.crypto.getRandomValues(iv);
    let ciphertext;
    try {
      ciphertext = new Uint8Array(await runtime.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        key,
        compressed.bytes,
      ));
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.ENCRYPT_FAILED, cause);
    }

    const envelope = {
      ...authenticated,
      aadSha256,
      ciphertext: bytesToBase64Url(ciphertext, runtime),
      iv: bytesToBase64Url(iv, runtime),
    };
    const objectBytes = encoder.encode(canonicalJson(envelope));
    if (objectBytes.byteLength > maxObjectBytes) {
      throw objectTooLargeError(metadata, objectBytes.byteLength, maxObjectBytes, 'encrypted_object');
    }
    const objectSha256 = await sha256Hex(objectBytes, runtime);
    expected.objectSha256 = objectSha256;
    expected.size = objectBytes.byteLength;
    const customMetadata = {
      aadSha256,
      contentSha256,
      encoding: compressed.encoding,
      examVersionId: metadata.examVersionId,
      format: FORMAT,
      keyVersion: keyMaterial.keyVersion,
      objectSha256,
      recordCount: String(metadata.recordCount),
      scope: metadata.scope,
      snapshotId: metadata.snapshotId,
    };

    let stored;
    try {
      stored = await binding.put(objectKey, objectBytes, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: OBJECT_CONTENT_TYPE, cacheControl: 'no-store' },
        customMetadata,
      });
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.UPLOAD_FAILED, cause);
    }
    if (!stored) {
      let raced;
      try {
        raced = await binding.head(objectKey);
      } catch (cause) {
        throw recoveryError(RECOVERY_ERROR_CODES.UPLOAD_FAILED, cause);
      }
      if (!raced || !storageMetadataMatches(raced, expected)) {
        throw recoveryError(RECOVERY_ERROR_CODES.OBJECT_CONFLICT);
      }
      return descriptorFrom(raced, expected, storage, true);
    }
    return descriptorFrom(stored, expected, storage, false);
  }

  async function head(env, input) {
    const reference = expectedReference(input);
    const storage = recoveryStorage(env, ['head'], runtime);
    const binding = storage.binding;
    let object;
    try {
      object = await binding.head(reference.objectKey);
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.DOWNLOAD_FAILED, cause);
    }
    if (!object) throw recoveryError(RECOVERY_ERROR_CODES.OBJECT_NOT_FOUND);
    return Object.freeze({
      objectKey: reference.objectKey,
      size: Number(object.size || 0),
      etag: object.etag || null,
      uploadedAt: object.uploaded instanceof Date ? object.uploaded.toISOString() : null,
      customMetadata: Object.freeze({ ...(object.customMetadata || {}) }),
    });
  }

  async function retrieve(env, input) {
    const reference = expectedReference(input);
    const storage = recoveryStorage(env, ['get'], runtime);
    const binding = storage.binding;
    let object;
    try {
      object = await binding.get(reference.objectKey);
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.DOWNLOAD_FAILED, cause);
    }
    if (!object) throw recoveryError(RECOVERY_ERROR_CODES.OBJECT_NOT_FOUND);
    const objectBytes = await readObjectBytes(object, maxObjectBytes, reference.metadata);
    const objectSha256 = await sha256Hex(objectBytes, runtime);
    const metadataObjectSha = String(object.customMetadata?.objectSha256 || '').toLowerCase();
    if ((reference.snapshotSha256 && reference.snapshotSha256 !== objectSha256)
        || (metadataObjectSha && metadataObjectSha !== objectSha256)) {
      throw recoveryError(RECOVERY_ERROR_CODES.CHECKSUM_MISMATCH);
    }

    let envelope;
    try {
      envelope = JSON.parse(new runtime.TextDecoder('utf-8', { fatal: true }).decode(objectBytes));
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID, cause);
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || envelope.format !== FORMAT || envelope.version !== FORMAT_VERSION
        || envelope.algorithm !== 'AES-256-GCM' || envelope.objectKey !== reference.objectKey) {
      throw recoveryError(RECOVERY_ERROR_CODES.METADATA_MISMATCH);
    }

    const metadata = normalizeMetadata(envelope.metadata);
    if (reference.metadata && canonicalJson(reference.metadata) !== canonicalJson(metadata)) {
      throw recoveryError(RECOVERY_ERROR_CODES.METADATA_MISMATCH);
    }
    const keyMaterial = keyVersionSecret(env, envelope.keyVersion, runtime);
    const contentSha256 = String(envelope.contentSha256 || '').toLowerCase();
    if (!SHA256_PATTERN.test(contentSha256)) throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID);
    const authenticated = authMetadata({
      metadata,
      objectKey: reference.objectKey,
      keyVersion: keyMaterial.keyVersion,
      encoding: envelope.encoding,
      contentSha256,
    });
    const additionalData = new runtime.TextEncoder().encode(canonicalJson(authenticated));
    const aadSha256 = await sha256Hex(additionalData, runtime);
    if (aadSha256 !== String(envelope.aadSha256 || '').toLowerCase()
        || (object.customMetadata?.aadSha256 && object.customMetadata.aadSha256 !== aadSha256)) {
      throw recoveryError(RECOVERY_ERROR_CODES.METADATA_MISMATCH);
    }
    const iv = base64ToBytes(envelope.iv, runtime);
    const ciphertext = base64ToBytes(envelope.ciphertext, runtime);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID);
    }
    const key = await deriveSnapshotKey(keyMaterial.bytes, metadata, keyMaterial.keyVersion, runtime);
    let compressed;
    try {
      compressed = new Uint8Array(await runtime.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        key,
        ciphertext,
      ));
    } catch (cause) {
      throw recoveryError(RECOVERY_ERROR_CODES.DECRYPT_FAILED, cause);
    }
    const plaintext = await decompress(compressed, envelope.encoding, runtime);
    if (plaintext.byteLength > maxPlaintextBytes) {
      throw objectTooLargeError(metadata, plaintext.byteLength, maxPlaintextBytes, 'decrypted_plaintext');
    }
    if (await sha256Hex(plaintext, runtime) !== contentSha256) {
      throw recoveryError(RECOVERY_ERROR_CODES.CHECKSUM_MISMATCH);
    }
    let payload;
    let canonical;
    try {
      canonical = new runtime.TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      payload = JSON.parse(canonical);
      if (canonicalJson(payload) !== canonical) throw new TypeError('non-canonical payload');
    } catch (cause) {
      if (isRecoveryError(cause)) throw cause;
      throw recoveryError(RECOVERY_ERROR_CODES.PAYLOAD_INVALID, cause);
    }
    return Object.freeze({
      ok: true,
      verified: true,
      descriptor: Object.freeze({
        format: FORMAT,
        encryptedObjectReference: `${storage.referencePrefix}${reference.objectKey}`,
        objectKey: reference.objectKey,
        snapshotSha256: objectSha256,
        contentSha256,
        aadSha256,
        encryptionKeyReference: `worker-secret:EXAMINATION_ROOM_BACKUP_MASTER_KEY_${keyMaterial.keyVersion.toUpperCase()}`,
        keyVersion: keyMaterial.keyVersion,
        encoding: envelope.encoding,
        metadata,
        size: objectBytes.byteLength,
        etag: object.etag || null,
      }),
      metadata,
      payload,
    });
  }

  async function verify(env, input) {
    const recovered = await retrieve(env, input);
    return Object.freeze({
      ok: true,
      verified: true,
      descriptor: recovered.descriptor,
      metadata: recovered.metadata,
    });
  }

  return Object.freeze({
    preflight,
    materialize,
    createMaterializedSnapshot: materialize,
    retrieve,
    decrypt: retrieve,
    verify,
    head,
  });
}
