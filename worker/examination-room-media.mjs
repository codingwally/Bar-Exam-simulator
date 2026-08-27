const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SESSION_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_PROVIDER_OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,240}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MEDIA_BUCKET = 'examination-room-media';
const ENCRYPTED_CONTENT_TYPE = 'application/octet-stream';
const MEDIA_KEY_ALGORITHM = 'aes-256-gcm-v1';
const MEDIA_KEY_AAD_PREFIX = 'duediligence-examination-room-media-v1';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,trashed,appProperties';
const GOOGLE_DRIVE_FILE_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

const PREPARE_KEYS = new Set([
  'artifactId',
  'artifactKind',
  'sourceMimeType',
  'encryptedSizeBytes',
  'objectSha256',
  'capturedFrom',
  'capturedTo',
  'derivedKey',
]);
const COMPLETE_KEYS = new Set([
  'artifactId',
  'artifactKind',
  'sourceMimeType',
  'encryptedSizeBytes',
  'objectSha256',
  'capturedFrom',
  'capturedTo',
  'provider',
  'providerObjectId',
]);

export const EXAMINATION_ROOM_MEDIA_LIMITS = Object.freeze({
  maximumRequestBytes: 64 * 1024,
  maximumEncryptedBytes: 64 * 1024 * 1024,
  maximumCaptureWindowMs: 15 * 60 * 1000,
  supabaseTusChunkBytes: 6 * 1024 * 1024,
  defaultRetentionDays: 30,
  maximumRetentionDays: 365,
});

export const EXAMINATION_ROOM_MEDIA_ARTIFACT_KINDS = Object.freeze([
  'camera_chunk',
  'microphone_chunk',
  'screen_chunk',
  'still_image',
]);

export const EXAMINATION_ROOM_MEDIA_PROVIDERS = Object.freeze([
  'google_drive',
  'supabase_storage',
  'local_queue',
]);

const ARTIFACT_KINDS = new Set(EXAMINATION_ROOM_MEDIA_ARTIFACT_KINDS);
const PROVIDERS = new Set(EXAMINATION_ROOM_MEDIA_PROVIDERS);

export class ExaminationRoomMediaError extends Error {
  constructor(code, message, status = 400, recovery = '') {
    super(message);
    this.name = 'ExaminationRoomMediaError';
    this.code = code;
    this.status = status;
    this.recovery = recovery;
  }
}

function fail(code, message, status = 400, recovery = '') {
  throw new ExaminationRoomMediaError(code, message, status, recovery);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, label) {
  if (!isPlainRecord(value)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device, then retry the upload. The examination and submission remain available.',
    );
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  record(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(
        'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
        `The recording service received an unsupported ${label} field.`,
        400,
        'Keep the encrypted recording on this device, refresh the examination, and retry the upload.',
      );
    }
  }
}

function text(value, maximum, label, options = {}) {
  if (typeof value !== 'string') {
    fail(
      'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device, then retry the upload.',
    );
  }
  const normalized = value.normalize('NFC').trim();
  if ((!normalized && options.required !== false)
      || normalized.length > maximum
      || CONTROL_PATTERN.test(normalized)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device, correct the recording details, and retry the upload.',
    );
  }
  return normalized;
}

function uuid(value, label) {
  const normalized = text(value, 64, label).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
      `The recording service could not match ${label}.`,
      400,
      'Keep the encrypted recording on this device, refresh the examination, and retry the upload.',
    );
  }
  return normalized;
}

function sha256(value, label) {
  const normalized = text(value, 64, label).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_REQUEST_INVALID',
      `The recording service could not verify ${label}.`,
      400,
      'Re-encrypt that recording segment on this device, then retry the upload.',
    );
  }
  return normalized;
}

function positiveInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(
      'EXAM_ROOM_V1_MEDIA_SIZE_INVALID',
      `The encrypted ${label} is outside the supported size.`,
      400,
      `Keep the recording on this device and split it into segments no larger than ${Math.floor(maximum / (1024 * 1024))} MB.`,
    );
  }
  return number;
}

function instant(value, label) {
  const normalized = text(value, 40, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    fail(
      'EXAM_ROOM_V1_MEDIA_TIME_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device and retry from the current examination clock.',
    );
  }
  return parsed.toISOString();
}

function normalizeSharedMetadata(value, allowed, label) {
  assertOnlyKeys(value, allowed, label);
  const artifactId = uuid(value.artifactId, 'the recording segment identifier');
  const artifactKind = text(value.artifactKind, 40, 'the recording type').toLowerCase();
  if (!ARTIFACT_KINDS.has(artifactKind)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_KIND_INVALID',
      'The recording type is not supported.',
      400,
      'Keep the encrypted recording on this device and retry with the camera, microphone, screen, or still-image type.',
    );
  }
  const sourceMimeType = text(value.sourceMimeType, 160, 'the recording format').toLowerCase();
  if (!/^(?:audio|image|video)\/[a-z0-9.+-]{1,80}(?:\s*;\s*[a-z0-9.+_-]{1,40}=[a-z0-9.,+_-]{1,80}){0,4}$/u.test(sourceMimeType)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_TYPE_INVALID',
      'The recording format is not supported.',
      400,
      'Keep the encrypted recording on this device and retry with a browser camera, microphone, or image format.',
    );
  }
  const encryptedSizeBytes = positiveInteger(
    value.encryptedSizeBytes,
    1,
    EXAMINATION_ROOM_MEDIA_LIMITS.maximumEncryptedBytes,
    'recording segment',
  );
  const objectSha256 = sha256(value.objectSha256, 'the encrypted recording fingerprint');
  const capturedFrom = instant(value.capturedFrom, 'the recording start time');
  const capturedTo = instant(value.capturedTo, 'the recording end time');
  const captureWindow = Date.parse(capturedTo) - Date.parse(capturedFrom);
  if (captureWindow < 0 || captureWindow > EXAMINATION_ROOM_MEDIA_LIMITS.maximumCaptureWindowMs) {
    fail(
      'EXAM_ROOM_V1_MEDIA_TIME_INVALID',
      'The recording segment covers an unsupported time window.',
      400,
      'Keep the recording on this device and split it into shorter encrypted segments before retrying.',
    );
  }
  return {
    artifactId,
    artifactKind,
    sourceMimeType,
    encryptedSizeBytes,
    objectSha256,
    capturedFrom,
    capturedTo,
  };
}

export function normalizeExaminationRoomMediaRequest(operation, value) {
  const normalizedOperation = text(operation, 40, 'the recording action').toLowerCase();
  if (normalizedOperation === 'prepare_upload') {
    const shared = normalizeSharedMetadata(value, PREPARE_KEYS, 'recording request');
    return Object.freeze({
      operation: normalizedOperation,
      ...shared,
      derivedKey: text(value.derivedKey, 128, 'the derived recording key'),
    });
  }
  if (normalizedOperation === 'complete_upload') {
    const shared = normalizeSharedMetadata(value, COMPLETE_KEYS, 'recording completion');
    const provider = text(value.provider, 40, 'the recording storage provider').toLowerCase();
    if (!PROVIDERS.has(provider)) {
      fail(
        'EXAM_ROOM_V1_MEDIA_PROVIDER_INVALID',
        'The recording upload destination is not supported.',
        400,
        'Keep the encrypted recording on this device and request a new upload destination.',
      );
    }
    let providerObjectId = null;
    if (value.providerObjectId !== undefined && value.providerObjectId !== null && value.providerObjectId !== '') {
      providerObjectId = text(value.providerObjectId, 240, 'the stored recording identifier');
      if (!SAFE_PROVIDER_OBJECT_ID_PATTERN.test(providerObjectId)) {
        fail(
          'EXAM_ROOM_V1_MEDIA_PROVIDER_RESULT_INVALID',
          'The recording provider returned an invalid stored-object identifier.',
          400,
          'Keep the encrypted recording on this device and retry upload verification.',
        );
      }
    }
    if (provider === 'google_drive' && !providerObjectId) {
      fail(
        'EXAM_ROOM_V1_MEDIA_PROVIDER_RESULT_INVALID',
        'The recording provider did not return a stored-object identifier.',
        400,
        'Keep the encrypted recording on this device and retry the resumable upload status check.',
      );
    }
    return Object.freeze({
      operation: normalizedOperation,
      ...shared,
      provider,
      providerObjectId,
    });
  }
  fail(
    'EXAM_ROOM_V1_MEDIA_OPERATION_UNSUPPORTED',
    'That recording action is not available.',
    400,
    'Keep the encrypted recording on this device and request a new upload destination.',
  );
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function base64ToBytes(value, label) {
  const source = text(value, 256, label).replace(/^base64:/iu, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(source)) {
    fail(
      'EXAM_ROOM_V1_MEDIA_KEY_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device and create a new encrypted segment before retrying.',
    );
  }
  const normalized = source.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    fail(
      'EXAM_ROOM_V1_MEDIA_KEY_INVALID',
      `The recording service could not read ${label}.`,
      400,
      'Keep the encrypted recording on this device and create a new encrypted segment before retrying.',
    );
  }
}

function keyBytes(value, label, invalidCode = 'EXAM_ROOM_V1_MEDIA_KEY_INVALID') {
  const source = text(value, 256, label);
  let bytes;
  if (/^hex:[0-9a-f]{64}$/iu.test(source)) {
    const hex = source.slice(4);
    bytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  } else if (/^[0-9a-f]{64}$/iu.test(source)) {
    bytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(source.slice(index * 2, index * 2 + 2), 16));
  } else if (new TextEncoder().encode(source).byteLength === 32) {
    bytes = new TextEncoder().encode(source);
  } else {
    bytes = base64ToBytes(source, label);
  }
  if (bytes.byteLength !== 32) {
    fail(
      invalidCode,
      `The recording service could not use ${label}.`,
      invalidCode.endsWith('NOT_CONFIGURED') ? 503 : 400,
      invalidCode.endsWith('NOT_CONFIGURED')
        ? 'Keep recordings encrypted on each device until the recording encryption key is configured.'
        : 'Keep the encrypted recording on this device and create a new encrypted segment before retrying.',
    );
  }
  return bytes;
}

async function digestHex(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomBytes(length, dependency) {
  const bytes = typeof dependency === 'function'
    ? dependency(length)
    : crypto.getRandomValues(new Uint8Array(length));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
    fail(
      'EXAM_ROOM_V1_MEDIA_CRYPTO_UNAVAILABLE',
      'The recording encryption service is temporarily unavailable.',
      503,
      'Keep recordings encrypted on this device and retry the upload later. The examination and submission remain available.',
    );
  }
  return bytes;
}

export async function wrapExaminationRoomMediaKey(env, context, dependencies = {}) {
  const sessionId = uuid(context.sessionId, 'the examination session');
  const artifactId = uuid(context.artifactId, 'the recording segment');
  const objectSha256 = sha256(context.objectSha256, 'the encrypted recording fingerprint');
  const masterSource = String(env?.EXAMINATION_ROOM_MEDIA_MASTER_KEY_V1 || '').trim();
  if (!masterSource) {
    fail(
      'EXAM_ROOM_V1_MEDIA_KEY_NOT_CONFIGURED',
      'Recorded-media key protection is not configured.',
      503,
      'Keep recordings encrypted on this device until the media encryption key is configured. The examination and submission remain available.',
    );
  }
  const masterBytes = keyBytes(
    masterSource,
    'the recording master key',
    'EXAM_ROOM_V1_MEDIA_KEY_NOT_CONFIGURED',
  );
  const derivedBytes = keyBytes(context.derivedKey, 'the derived recording key');
  const aad = new TextEncoder().encode(
    `${MEDIA_KEY_AAD_PREFIX}\0${sessionId}\0${artifactId}\0${objectSha256}`,
  );
  const iv = randomBytes(12, dependencies.randomBytes);
  let ciphertext;
  try {
    const key = await crypto.subtle.importKey('raw', masterBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      key,
      derivedBytes,
    ));
  } catch (error) {
    if (error instanceof ExaminationRoomMediaError) throw error;
    fail(
      'EXAM_ROOM_V1_MEDIA_CRYPTO_UNAVAILABLE',
      'The recording key could not be protected for upload.',
      503,
      'Keep the encrypted recording on this device and retry later. The examination and submission remain available.',
    );
  } finally {
    masterBytes.fill(0);
    derivedBytes.fill(0);
  }
  return Object.freeze({
    algorithm: MEDIA_KEY_ALGORITHM,
    keyVersion: 1,
    ciphertext: bytesToBase64Url(ciphertext),
    iv: bytesToBase64Url(iv),
    aadSha256: await digestHex(aad),
    keyReference: `media-intent-v1:${artifactId}`,
  });
}

function nowInstant(deps) {
  const value = typeof deps.now === 'function' ? deps.now() : new Date().toISOString();
  return new Date(value).toISOString();
}

function retentionUntil(env, capturedTo) {
  const configured = Number(env?.EXAMINATION_ROOM_MEDIA_RETENTION_DAYS);
  const days = Number.isSafeInteger(configured)
    && configured >= 1
    && configured <= EXAMINATION_ROOM_MEDIA_LIMITS.maximumRetentionDays
    ? configured
    : EXAMINATION_ROOM_MEDIA_LIMITS.defaultRetentionDays;
  return new Date(Date.parse(capturedTo) + days * 86_400_000).toISOString();
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeHttpsUrl(value, allowedHost, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL invalid`);
  }
  if (url.protocol !== 'https:' || !allowedHost(url.hostname)) {
    throw new Error(`${label} URL invalid`);
  }
  return url.toString();
}

function configuredValue(env, key) {
  return typeof env?.[key] === 'string' ? env[key].trim() : '';
}

async function googleAccessToken(env, fetchImpl) {
  const clientId = configuredValue(env, 'GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = configuredValue(env, 'GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = configuredValue(env, 'EXAMINATION_ROOM_GOOGLE_DRIVE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('drive_not_configured');
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const result = await responseJson(response);
  const accessToken = typeof result?.access_token === 'string' ? result.access_token.trim() : '';
  if (!response.ok || !accessToken) throw new Error('drive_token_unavailable');
  return accessToken;
}

function driveFileName(context) {
  const extension = context.artifactKind === 'still_image' ? 'image' : 'segment';
  return `duediligence-er-${context.sessionId}-${context.artifactId}-${extension}.enc`;
}

async function createGoogleDriveUpload(env, context, fetchImpl, now) {
  const accessToken = await googleAccessToken(env, fetchImpl);
  const folderId = configuredValue(env, 'EXAMINATION_ROOM_GOOGLE_DRIVE_FOLDER_ID');
  if (folderId && !SAFE_PROVIDER_OBJECT_ID_PATTERN.test(folderId)) throw new Error('drive_folder_invalid');
  const metadata = {
    name: driveFileName(context),
    appProperties: {
      ddArtifactId: context.artifactId,
      ddSessionId: context.sessionId,
      ddObjectSha256: context.objectSha256,
    },
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const response = await fetchImpl(GOOGLE_DRIVE_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': ENCRYPTED_CONTENT_TYPE,
      'X-Upload-Content-Length': String(context.encryptedSizeBytes),
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error('drive_upload_session_unavailable');
  const uploadUrl = safeHttpsUrl(
    response.headers.get('Location'),
    (hostname) => hostname === 'googleapis.com' || hostname.endsWith('.googleapis.com'),
    'Drive resumable upload',
  );
  return Object.freeze({
    provider: 'google_drive',
    objectReference: `google-drive-pending:${context.artifactId}`,
    upload: Object.freeze({
      protocol: 'google_drive_resumable',
      method: 'PUT',
      url: uploadUrl,
      headers: Object.freeze({ 'Content-Type': ENCRYPTED_CONTENT_TYPE }),
      expiresAt: new Date(Date.parse(now) + 6 * 86_400_000).toISOString(),
    }),
  });
}

function supabaseBaseUrl(env) {
  const raw = configuredValue(env, 'SUPABASE_URL');
  const serviceRole = configuredValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!raw || !serviceRole) throw new Error('supabase_storage_not_configured');
  const base = new URL(raw);
  if (base.protocol !== 'https:') throw new Error('supabase_storage_not_configured');
  return { baseUrl: base.origin, serviceRole };
}

function encodedStoragePath(value) {
  return String(value).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function supabaseObjectPath(context) {
  return `sessions/${context.sessionId}/${context.artifactKind}/${context.artifactId}.enc`;
}

function supabaseDirectStorageOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (url.hostname.endsWith('.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/u, '.storage.supabase.co');
  }
  return url.origin;
}

async function createSupabaseUpload(env, context, fetchImpl, now) {
  const { baseUrl, serviceRole } = supabaseBaseUrl(env);
  const objectPath = supabaseObjectPath(context);
  const endpoint = `${baseUrl}/storage/v1/object/upload/sign/${MEDIA_BUCKET}/${encodedStoragePath(objectPath)}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const result = await responseJson(response);
  if (!response.ok || typeof result?.url !== 'string') throw new Error('supabase_signed_upload_unavailable');
  const signedUrl = safeHttpsUrl(
    result.url.startsWith('http')
      ? result.url
      : `${baseUrl}/storage/v1${result.url.startsWith('/') ? '' : '/'}${result.url}`,
    (hostname) => hostname === new URL(baseUrl).hostname,
    'Supabase signed upload',
  );
  const token = new URL(signedUrl).searchParams.get('token');
  if (!token) throw new Error('supabase_signed_upload_unavailable');
  return Object.freeze({
    provider: 'supabase_storage',
    objectReference: `supabase-storage:${MEDIA_BUCKET}:${objectPath}`,
    upload: Object.freeze({
      protocol: 'supabase_signed_upload',
      method: 'PUT',
      url: signedUrl,
      headers: Object.freeze({
        'Content-Type': ENCRYPTED_CONTENT_TYPE,
        'Cache-Control': 'max-age=0',
      }),
      expiresAt: new Date(Date.parse(now) + 110 * 60_000).toISOString(),
      resumable: Object.freeze({
        endpoint: `${supabaseDirectStorageOrigin(baseUrl)}/storage/v1/upload/resumable`,
        headers: Object.freeze({ 'x-signature': token }),
        metadata: Object.freeze({
          bucketName: MEDIA_BUCKET,
          objectName: objectPath,
          contentType: ENCRYPTED_CONTENT_TYPE,
          cacheControl: '0',
        }),
        chunkSizeBytes: EXAMINATION_ROOM_MEDIA_LIMITS.supabaseTusChunkBytes,
      }),
    }),
  });
}

function localQueue(context, reason = 'storage_temporarily_unavailable') {
  return Object.freeze({
    artifactId: context.artifactId,
    state: 'local_queue',
    provider: null,
    providerResult: Object.freeze({ status: reason }),
    upload: null,
    retryable: true,
    canContinueExam: true,
    submissionBlocked: false,
    recovery: 'The encrypted recording remains queued on this device. Continue the examination or submit normally; upload retries run separately.',
  });
}

function ensureRpcResult(result) {
  if (!isPlainRecord(result) || result.ok === false) throw new Error('media_metadata_unavailable');
  return result;
}

async function reserveIntent(env, dependencies, context, input, destination, envelope) {
  return ensureRpcResult(await dependencies.mediaRpc(env, {
    operation: 'reserve',
    payload: {
      sessionId: context.sessionId,
      sessionTokenHash: context.sessionTokenHash,
      clientArtifactId: input.artifactId,
      requestHash: context.requestHash,
      artifactKind: input.artifactKind,
      sourceMimeType: input.sourceMimeType,
      encryptedSizeBytes: input.encryptedSizeBytes,
      objectSha256: input.objectSha256,
      capturedFrom: input.capturedFrom,
      capturedTo: input.capturedTo,
      retentionUntil: retentionUntil(env, input.capturedTo),
      provider: destination.provider,
      providerObjectReference: destination.objectReference,
      keyEnvelope: envelope,
    },
  }));
}

async function prepareUpload(env, dependencies, context, input) {
  let envelope;
  try {
    envelope = await wrapExaminationRoomMediaKey(env, {
      sessionId: context.sessionId,
      artifactId: input.artifactId,
      objectSha256: input.objectSha256,
      derivedKey: input.derivedKey,
    }, { randomBytes: dependencies.randomBytes });
  } catch (error) {
    if (error instanceof ExaminationRoomMediaError && error.status === 400) throw error;
    return localQueue(input, 'encryption_temporarily_unavailable');
  }

  const now = nowInstant(dependencies);
  let destination;
  try {
    destination = await createGoogleDriveUpload(env, { ...context, ...input }, dependencies.fetch, now);
  } catch {
    try {
      destination = await createSupabaseUpload(env, { ...context, ...input }, dependencies.fetch, now);
    } catch {
      destination = Object.freeze({
        provider: 'local_queue',
        objectReference: `local-queue:${context.sessionId}:${input.artifactId}`,
        upload: null,
      });
    }
  }

  let intent;
  try {
    intent = await reserveIntent(env, dependencies, context, input, destination, envelope);
  } catch {
    return localQueue(input, 'control_plane_temporarily_unavailable');
  }
  if (destination.provider === 'local_queue') {
    return Object.freeze({
      ...localQueue(input),
      intentId: intent.intentId || null,
      duplicate: intent.duplicate === true,
    });
  }
  return Object.freeze({
    artifactId: input.artifactId,
    intentId: intent.intentId || null,
    state: 'upload_ready',
    provider: destination.provider,
    providerResult: Object.freeze({ status: 'upload_session_created' }),
    upload: destination.upload,
    duplicate: intent.duplicate === true,
    retryable: true,
    canContinueExam: true,
    submissionBlocked: false,
    recovery: 'Upload runs separately from answers. If it is interrupted, keep the encrypted segment on this device and request another upload session.',
  });
}

async function verifyGoogleDriveUpload(env, dependencies, context, input) {
  const accessToken = await googleAccessToken(env, dependencies.fetch);
  const endpoint = `${GOOGLE_DRIVE_FILE_ENDPOINT}/${encodeURIComponent(input.providerObjectId)}?fields=id,name,size,trashed,appProperties`;
  const response = await dependencies.fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await responseJson(response);
  const sizeBytes = Number(result?.size);
  if (!response.ok
      || result?.trashed === true
      || result?.id !== input.providerObjectId
      || sizeBytes !== input.encryptedSizeBytes
      || result?.appProperties?.ddArtifactId !== input.artifactId
      || result?.appProperties?.ddSessionId !== context.sessionId
      || result?.appProperties?.ddObjectSha256 !== input.objectSha256) {
    throw new Error('drive_upload_not_verified');
  }
  return Object.freeze({
    objectReference: `google-drive:${input.providerObjectId}`,
    result: Object.freeze({
      status: 'verified',
      objectId: input.providerObjectId,
      sizeBytes,
      contentHashVerified: false,
    }),
  });
}

async function verifySupabaseUpload(env, dependencies, context, input) {
  const { baseUrl, serviceRole } = supabaseBaseUrl(env);
  const objectPath = supabaseObjectPath({ ...context, ...input });
  const endpoint = `${baseUrl}/storage/v1/object/authenticated/${MEDIA_BUCKET}/${encodedStoragePath(objectPath)}`;
  const response = await dependencies.fetch(endpoint, {
    method: 'HEAD',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  });
  const sizeBytes = Number(response.headers.get('Content-Length'));
  if (!response.ok || sizeBytes !== input.encryptedSizeBytes) throw new Error('supabase_upload_not_verified');
  return Object.freeze({
    objectReference: `supabase-storage:${MEDIA_BUCKET}:${objectPath}`,
    result: Object.freeze({
      status: 'verified',
      objectId: objectPath,
      sizeBytes,
      contentHashVerified: false,
    }),
  });
}

async function completeUpload(env, dependencies, context, input) {
  if (input.provider === 'local_queue') return localQueue(input, 'upload_not_started');
  let verified;
  try {
    verified = input.provider === 'google_drive'
      ? await verifyGoogleDriveUpload(env, dependencies, context, input)
      : await verifySupabaseUpload(env, dependencies, context, input);
  } catch {
    return localQueue(input, 'upload_verification_pending');
  }
  let persisted;
  try {
    persisted = ensureRpcResult(await dependencies.mediaRpc(env, {
      operation: 'complete',
      payload: {
        sessionId: context.sessionId,
        sessionTokenHash: context.sessionTokenHash,
        clientArtifactId: input.artifactId,
        requestHash: context.requestHash,
        provider: input.provider,
        providerObjectReference: verified.objectReference,
        objectSha256: input.objectSha256,
        encryptedSizeBytes: input.encryptedSizeBytes,
        providerVerified: true,
        providerResult: verified.result,
        completedAt: nowInstant(dependencies),
      },
    }));
  } catch {
    return localQueue(input, 'completion_registration_pending');
  }
  return Object.freeze({
    artifactId: input.artifactId,
    artifactRecordId: persisted.artifactId || null,
    state: 'completed',
    provider: input.provider,
    providerResult: verified.result,
    upload: null,
    duplicate: persisted.duplicate === true,
    retryable: false,
    canContinueExam: true,
    submissionBlocked: false,
    recovery: 'The encrypted recording segment is registered. No examination answer or submission state was changed.',
  });
}

export function createExaminationRoomMediaControl(dependencies) {
  if (!isPlainRecord(dependencies)
      || typeof dependencies.fetch !== 'function'
      || typeof dependencies.mediaRpc !== 'function') {
    throw new TypeError('createExaminationRoomMediaControl requires fetch and mediaRpc');
  }
  if (dependencies.randomBytes !== undefined && typeof dependencies.randomBytes !== 'function') {
    throw new TypeError('createExaminationRoomMediaControl randomBytes must be a function when provided');
  }
  if (dependencies.now !== undefined && typeof dependencies.now !== 'function') {
    throw new TypeError('createExaminationRoomMediaControl now must be a function when provided');
  }
  return async function examinationRoomMediaControl(env, request) {
    const source = record(request, 'the recording control request');
    const sessionId = uuid(source.sessionId, 'the examination session');
    const sessionTokenHash = sha256(source.sessionTokenHash, 'the examination session credential');
    if (!SESSION_HASH_PATTERN.test(sessionTokenHash)) {
      fail(
        'EXAM_ROOM_V1_SESSION_INVALID',
        'The examination session could not be verified.',
        401,
        'Return to the examination and resume with the same session. Encrypted recordings stay queued on this device.',
      );
    }
    const requestHash = sha256(source.requestHash, 'the recording request identifier');
    const input = normalizeExaminationRoomMediaRequest(source.operation, source.payload);
    const context = Object.freeze({ sessionId, sessionTokenHash, requestHash });
    return input.operation === 'prepare_upload'
      ? prepareUpload(env, dependencies, context, input)
      : completeUpload(env, dependencies, context, input);
  };
}
