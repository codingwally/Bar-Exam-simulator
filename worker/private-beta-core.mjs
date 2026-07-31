const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const PRIVATE_BETA_PENDING_SECONDS = 15 * 60;
export const PRIVATE_BETA_ACCESS_SECONDS = 12 * 60 * 60;

export class PrivateBetaError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PrivateBetaError';
    this.code = code;
    this.status = status;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  const normalized = String(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  let binary;
  try {
    binary = atob(`${normalized}${padding}`);
  } catch {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonSegment(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJsonSegment(value) {
  try {
    return JSON.parse(textDecoder.decode(base64UrlToBytes(value)));
  } catch (error) {
    if (error instanceof PrivateBetaError) throw error;
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
}

function randomIdentifier(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function importHmacKey(secret) {
  const normalized = String(secret || '');
  if (normalized.length < 32) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_NOT_CONFIGURED',
      'Private-beta access is temporarily unavailable.',
      503,
    );
  }
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(normalized),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function hmacBytes(secret, value) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(String(value)),
  );
  return new Uint8Array(signature);
}

export async function hmacHex(secret, value) {
  const bytes = await hmacBytes(secret, value);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function constantTimeHexEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  const length = Math.max(a.length, b.length, 64);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    difference |= aCode ^ bCode;
  }
  return difference === 0;
}

export async function verifyPrivateBetaAccessCode(
  submittedCode,
  {
    verifier,
    pepper,
  } = {},
) {
  const normalized = String(submittedCode ?? '').trim();
  if (!normalized || normalized.length > 256) return false;
  if (!/^[0-9a-f]{64}$/i.test(String(verifier || ''))) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_NOT_CONFIGURED',
      'Private-beta access is temporarily unavailable.',
      503,
    );
  }
  const candidate = await hmacHex(pepper, normalized);
  return constantTimeHexEqual(candidate, verifier);
}

export function validatePrivateBetaAcknowledgements(value) {
  return Boolean(
    value
    && value.aiLimitations === true
    && value.educationalOnly === true
    && value.termsAndPrivacy === true,
  );
}

export async function createPrivateBetaToken(
  {
    type,
    subject = null,
    disclosureVersion,
    lifetimeSeconds,
  },
  signingKey,
  options = {},
) {
  if (!['pending', 'access'].includes(type)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  const expectedLifetime = type === 'pending'
    ? PRIVATE_BETA_PENDING_SECONDS
    : PRIVATE_BETA_ACCESS_SECONDS;
  if (lifetimeSeconds !== expectedLifetime) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_POLICY_INVALID',
      'Private-beta access is temporarily unavailable.',
      503,
    );
  }
  const version = String(disclosureVersion || '').trim();
  if (!/^beta-disclosure-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(version)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_DISCLOSURE_INVALID',
      'The current Beta Disclosure could not be verified.',
      503,
    );
  }
  if (type === 'access' && !/^[0-9a-f-]{36}$/i.test(String(subject || ''))) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  const issuedAt = Math.floor(Number(options.nowMs ?? Date.now()) / 1000);
  const payload = {
    v: 1,
    typ: `dd-private-beta-${type}`,
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
    jti: randomIdentifier(),
    disclosureVersion: version,
    ...(type === 'access' ? { sub: String(subject) } : {}),
  };
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: 'dd-private-beta-v1',
  };
  const unsigned = `${jsonSegment(header)}.${jsonSegment(payload)}`;
  const signature = bytesToBase64Url(await hmacBytes(signingKey, unsigned));
  return {
    token: `${unsigned}.${signature}`,
    payload,
  };
}

export async function verifyPrivateBetaToken(
  token,
  signingKey,
  {
    expectedType,
    expectedSubject = null,
    disclosureVersion,
    nowMs = Date.now(),
  } = {},
) {
  const segments = String(token || '').split('.');
  if (segments.length !== 3) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  const [encodedHeader, encodedPayload, submittedSignature] = segments;
  const expectedSignature = bytesToBase64Url(
    await hmacBytes(signingKey, `${encodedHeader}.${encodedPayload}`),
  );
  if (!constantTimeHexEqual(
    await sha256Hex(submittedSignature),
    await sha256Hex(expectedSignature),
  )) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }

  const header = decodeJsonSegment(encodedHeader);
  const payload = decodeJsonSegment(encodedPayload);
  if (header?.alg !== 'HS256'
      || header?.typ !== 'JWT'
      || header?.kid !== 'dd-private-beta-v1'
      || payload?.v !== 1) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }

  const type = String(expectedType || '');
  const maximumLifetime = type === 'pending'
    ? PRIVATE_BETA_PENDING_SECONDS
    : type === 'access'
      ? PRIVATE_BETA_ACCESS_SECONDS
      : 0;
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const issuedAt = Number(payload?.iat);
  const expiresAt = Number(payload?.exp);
  if (!maximumLifetime
      || payload?.typ !== `dd-private-beta-${type}`
      || !Number.isInteger(issuedAt)
      || !Number.isInteger(expiresAt)
      || expiresAt <= issuedAt
      || expiresAt - issuedAt !== maximumLifetime
      || issuedAt > nowSeconds + 60
      || expiresAt <= nowSeconds
      || !/^[A-Za-z0-9_-]{24,64}$/.test(String(payload?.jti || ''))
      || payload?.disclosureVersion !== disclosureVersion) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_EXPIRED',
      'Private-beta access must be verified again.',
      401,
    );
  }
  if (type === 'access' && String(payload?.sub || '') !== String(expectedSubject || '')) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_TOKEN_INVALID',
      'Private-beta access must be verified again.',
      401,
    );
  }
  return payload;
}
