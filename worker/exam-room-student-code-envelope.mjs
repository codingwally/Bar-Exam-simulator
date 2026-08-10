const ALGORITHM = 'A256GCM';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class ExamRoomStudentCodeEnvelopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamRoomStudentCodeEnvelopeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExamRoomStudentCodeEnvelopeError(code, message);
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value, label, expectedLength = null) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !BASE64URL.test(normalized)) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', `${label} is invalid.`);
  }
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  let binary;
  try {
    binary = atob(normalized.replace(/-/g, '+').replace(/_/g, '/') + padding);
  } catch {
    fail('STUDENT_CODE_ENVELOPE_INVALID', `${label} is invalid.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedLength !== null && bytes.length !== expectedLength) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', `${label} has an invalid length.`);
  }
  if (encodeBase64Url(bytes) !== normalized) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', `${label} is not canonical base64url.`);
  }
  return bytes;
}

function normalizedContext({ examId, tokenHash, keyId }) {
  const normalizedExamId = String(examId ?? '').trim().toLowerCase();
  const normalizedTokenHash = String(tokenHash ?? '').trim().toLowerCase();
  const normalizedKeyId = String(keyId ?? '').trim();
  if (!UUID.test(normalizedExamId) || !SHA256.test(normalizedTokenHash)
      || !KEY_ID.test(normalizedKeyId)) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', 'The student-code encryption context is invalid.');
  }
  return { examId: normalizedExamId, tokenHash: normalizedTokenHash, keyId: normalizedKeyId };
}

function keyEnvironmentName(keyId) {
  return `EXAM_ROOM_STUDENT_CODE_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function activeKeyId(env) {
  const value = String(env?.EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID ?? 'v1').trim();
  if (!KEY_ID.test(value)) {
    fail('STUDENT_CODE_KEY_UNAVAILABLE', 'The active student-code encryption key identifier is invalid.');
  }
  return value;
}

async function encryptionKey(env, keyId, usages) {
  const encoded = env?.[keyEnvironmentName(keyId)];
  if (!encoded) {
    fail('STUDENT_CODE_KEY_UNAVAILABLE', 'The requested student-code encryption key is unavailable.');
  }
  const bytes = decodeBase64Url(encoded, 'Student-code encryption key', KEY_BYTES);
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usages);
}

function additionalData(context) {
  return new TextEncoder().encode(
    `duediligence.exam-room.student-code|${context.keyId}|${context.examId}|${context.tokenHash}`,
  );
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function encryptStudentExamCode(env, { examId, tokenHash, studentKey }) {
  const keyId = activeKeyId(env);
  const context = normalizedContext({ examId, tokenHash, keyId });
  const plaintext = String(studentKey ?? '');
  const plaintextLength = Array.from(plaintext).length;
  if (plaintextLength < 12 || plaintextLength > 512) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', 'The student exam code length is invalid.');
  }
  if (await sha256Hex(plaintext) !== context.tokenHash) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', 'The student exam code does not match its digest.');
  }
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await encryptionKey(env, keyId, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: nonce,
    additionalData: additionalData(context),
    tagLength: 128,
  }, key, new TextEncoder().encode(plaintext));
  return {
    algorithm: ALGORITHM,
    keyId,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptStudentExamCode(env, {
  examId,
  tokenHash,
  algorithm,
  keyId,
  nonce,
  ciphertext,
}) {
  if (algorithm !== ALGORITHM) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', 'The student-code encryption algorithm is unsupported.');
  }
  const context = normalizedContext({ examId, tokenHash, keyId });
  const iv = decodeBase64Url(nonce, 'Student-code nonce', NONCE_BYTES);
  const encrypted = decodeBase64Url(ciphertext, 'Student-code ciphertext');
  if (encrypted.length < 28 || encrypted.length > 2_064) {
    fail('STUDENT_CODE_ENVELOPE_INVALID', 'The student-code ciphertext length is invalid.');
  }
  const key = await encryptionKey(env, keyId, ['decrypt']);
  let plaintextBytes;
  try {
    plaintextBytes = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(context),
      tagLength: 128,
    }, key, encrypted);
  } catch {
    fail('STUDENT_CODE_DECRYPTION_FAILED', 'The active student exam code could not be decrypted.');
  }
  let plaintext;
  try {
    plaintext = new TextDecoder('utf-8', { fatal: true }).decode(plaintextBytes);
  } catch {
    fail('STUDENT_CODE_DECRYPTION_FAILED', 'The active student exam code is not valid text.');
  }
  const plaintextLength = Array.from(plaintext).length;
  if (plaintextLength < 12 || plaintextLength > 512
      || await sha256Hex(plaintext) !== context.tokenHash) {
    fail('STUDENT_CODE_DECRYPTION_FAILED', 'The active student exam code failed verification.');
  }
  return plaintext;
}

export const STUDENT_CODE_ENVELOPE_ALGORITHM = ALGORITHM;
