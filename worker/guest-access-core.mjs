export const GUEST_GRADE_LIMIT = 3;
export const GUEST_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const GUEST_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const encoder = new TextEncoder();

export class GuestAccessError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'GuestAccessError';
    this.code = code;
    this.status = status;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeUserAgent(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(chrome|crios|firefox|fxios|edg|version)\/[\d.]+/g, '$1/major')
    .replace(/\b(windows nt|android|cpu (?:iphone )?os|mac os x) [\d_\.]+/g, '$1/major')
    .slice(0, 320);
}

export function requireGuestHeaders(request) {
  const deviceId = String(request.headers.get('X-Guest-Device-ID') || '').trim();
  const requestId = String(request.headers.get('X-Request-ID') || '').trim();
  if (!GUEST_DEVICE_ID_PATTERN.test(deviceId)) {
    throw new GuestAccessError(
      'GUEST_ID_REQUIRED',
      'Guest access could not be verified. Refresh the page and try again.',
      400,
    );
  }
  if (!GUEST_REQUEST_ID_PATTERN.test(requestId)) {
    throw new GuestAccessError(
      'REQUEST_ID_REQUIRED',
      'This grading request could not be verified. Please try again.',
      400,
    );
  }
  return { deviceId, requestId };
}

export async function hmacHex(secret, value) {
  if (!secret) {
    throw new GuestAccessError(
      'GUEST_ACCESS_NOT_CONFIGURED',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export async function deriveGuestHashes(request, secret, deviceId) {
  const trustedIp = String(request.headers.get('CF-Connecting-IP') || 'unavailable');
  const normalizedAgent = normalizeUserAgent(request.headers.get('User-Agent'));
  const [deviceHash, recoveryHash] = await Promise.all([
    hmacHex(secret, `device\0${deviceId}`),
    hmacHex(secret, `recovery\0${trustedIp}\0${normalizedAgent}`),
  ]);
  return { deviceHash, recoveryHash };
}

export function normalizeReservationResponse(value) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || typeof row.allowed !== 'boolean') {
    throw new GuestAccessError(
      'GUEST_ACCESS_UNAVAILABLE',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  return {
    allowed: row.allowed,
    reason: String(row.reason || ''),
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    remaining: Math.max(0, Math.min(GUEST_GRADE_LIMIT, Number(row.remaining) || 0)),
    consumed: Math.max(0, Math.min(GUEST_GRADE_LIMIT, Number(row.consumed) || 0)),
  };
}

export function publicGuestUsage(value) {
  return {
    limit: GUEST_GRADE_LIMIT,
    remaining: Math.max(0, Math.min(GUEST_GRADE_LIMIT, Number(value?.remaining) || 0)),
    completed: Math.max(0, Math.min(GUEST_GRADE_LIMIT, Number(value?.consumed) || 0)),
  };
}
