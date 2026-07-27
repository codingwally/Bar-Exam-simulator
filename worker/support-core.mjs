export const SUPPORT_LIMITS = Object.freeze({
  requestBytes: 12_000,
  messageMin: 20,
  messageMax: 4_000,
  emailMax: 254,
});

export const SUPPORT_CATEGORIES = new Set([
  'technical',
  'account',
  'content',
  'accessibility',
  'other',
]);

export class SupportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupportValidationError';
    this.code = 'INVALID_SUPPORT_REQUEST';
  }
}

function cleanText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

export function normalizeSupportRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SupportValidationError('Enter a support message and try again.');
  }
  const allowed = new Set(['category', 'message', 'replyEmail']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new SupportValidationError('The support request contains unsupported fields.');
  }
  const category = cleanText(payload.category).toLowerCase();
  const message = cleanText(payload.message);
  const replyEmail = cleanText(payload.replyEmail).toLowerCase();
  if (!SUPPORT_CATEGORIES.has(category)) {
    throw new SupportValidationError('Choose a support category.');
  }
  if (message.length < SUPPORT_LIMITS.messageMin || message.length > SUPPORT_LIMITS.messageMax) {
    throw new SupportValidationError(
      `Support messages must contain ${SUPPORT_LIMITS.messageMin} to ${SUPPORT_LIMITS.messageMax} characters.`,
    );
  }
  if (/\b(?:answer|legal basis|application|conclusion)\s*:/i.test(message) && message.length > 600) {
    throw new SupportValidationError('Do not submit examination answers through Support.');
  }
  if (replyEmail) {
    if (replyEmail.length > SUPPORT_LIMITS.emailMax
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)) {
      throw new SupportValidationError('Enter a valid reply email or leave it blank.');
    }
  }
  return { category, message, replyEmail: replyEmail || null };
}

export function supportInsertRecord(request) {
  return {
    category: request.category,
    message: request.message,
    reply_email: request.replyEmail,
    status: 'new',
  };
}
