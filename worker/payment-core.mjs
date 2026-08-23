export const PAYMENT_LIMITS = Object.freeze({
  maxProofBytes: 6 * 1024 * 1024,
  maxReferenceLength: 100,
  maxNoteLength: 2000,
  maxRefundReasonLength: 2000,
});

export const PAYMENT_MIME_EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
});

export class PaymentValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PaymentValidationError';
    this.code = code;
    this.status = status;
  }
}

function text(value, maximum, label, minimum = 1) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PaymentValidationError(
      'INVALID_PAYMENT',
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

export function normalizePaymentFields(fields) {
  const planCode = text(fields?.planCode, 64, 'Plan', 3).toLowerCase();
  if (planCode !== 'early_access_beta') {
    throw new PaymentValidationError(
      'PLAN_UNAVAILABLE',
      'Only the Early Access plan is available for new checkout.',
    );
  }
  const paymentMethod = text(fields?.paymentMethod, 24, 'Payment method', 3).toLowerCase();
  if (!['gotyme_instapay', 'bpi_instapay'].includes(paymentMethod)) {
    throw new PaymentValidationError(
      'INVALID_PAYMENT_METHOD',
      'Select the InstaPay payment channel shown at checkout.',
    );
  }
  const amountPhp = Number(fields?.amountPhp);
  if (!Number.isFinite(amountPhp)
      || Math.round(amountPhp * 100) !== 14900
      || Math.round(amountPhp * 100) !== amountPhp * 100) {
    throw new PaymentValidationError(
      'INVALID_PAYMENT_AMOUNT',
      'Early Access requires the exact one-time payment of ₱149.00.',
    );
  }
  const paymentDate = text(fields?.paymentDate, 10, 'Payment date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
      || Number.isNaN(Date.parse(`${paymentDate}T00:00:00Z`))) {
    throw new PaymentValidationError('INVALID_PAYMENT_DATE', 'Enter a valid payment date.');
  }
  const transactionReference = text(
    fields?.transactionReference,
    PAYMENT_LIMITS.maxReferenceLength,
    'Transaction reference',
    4,
  );
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._:/#-]{3,99}$/u.test(transactionReference)) {
    throw new PaymentValidationError(
      'INVALID_PAYMENT_REFERENCE',
      'Enter the reference exactly as shown by the payment channel.',
    );
  }
  const noteRaw = String(fields?.note ?? '').trim();
  if (noteRaw.length > PAYMENT_LIMITS.maxNoteLength) {
    throw new PaymentValidationError('INVALID_PAYMENT_NOTE', 'The optional note is too long.');
  }
  return {
    planCode,
    amountPhp,
    paymentMethod,
    paymentDate,
    transactionReference,
    note: noteRaw || null,
  };
}

export function proofExtension(name, mimeType) {
  const expected = PAYMENT_MIME_EXTENSIONS[mimeType];
  if (!expected) {
    throw new PaymentValidationError(
      'UNSAFE_PROOF_FILE',
      'Upload a PNG, JPEG, or PDF payment proof.',
      415,
    );
  }
  const extension = String(name || '').trim().toLowerCase().split('.').pop();
  const extensionMatches = expected === 'jpg'
    ? ['jpg', 'jpeg'].includes(extension)
    : extension === expected;
  if (!extensionMatches) {
    throw new PaymentValidationError(
      'UNSAFE_PROOF_FILE',
      'The proof filename does not match its file type.',
      415,
    );
  }
  return expected;
}

export function validateProofSignature(bytes, mimeType) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.length || data.length > PAYMENT_LIMITS.maxProofBytes) {
    throw new PaymentValidationError(
      'UNSAFE_PROOF_FILE',
      data.length ? 'Payment proof exceeds the 6 MiB limit.' : 'Payment proof is empty.',
      data.length ? 413 : 400,
    );
  }
  const matches = mimeType === 'image/png'
    ? data.length >= 8
      && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => data[index] === value)
    : mimeType === 'image/jpeg'
      ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : mimeType === 'application/pdf'
        ? data.length >= 5 && String.fromCharCode(...data.slice(0, 5)) === '%PDF-'
        : false;
  if (!matches) {
    throw new PaymentValidationError(
      'UNSAFE_PROOF_FILE',
      'The uploaded proof does not match its declared file type.',
      415,
    );
  }
  if (mimeType === 'application/pdf') {
    const inspectableNames = new TextDecoder('latin1')
      .decode(data)
      .replace(/#([0-9a-f]{2})/gi, (_match, encoded) => (
        String.fromCharCode(Number.parseInt(encoded, 16))
      ));
    if (/\/(?:Encrypt|JavaScript|JS|OpenAction|AA|Launch|RichMedia|EmbeddedFile|SubmitForm|ImportData)\b/i
      .test(inspectableNames)) {
      throw new PaymentValidationError(
        'UNSAFE_PROOF_FILE',
        'Upload an unencrypted, inactive PDF payment proof.',
        415,
      );
    }
  }
  return data;
}

export function normalizeRefundRequest(payload) {
  const paymentRequestId = text(payload?.paymentRequestId, 36, 'Payment request', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentRequestId)) {
    throw new PaymentValidationError('INVALID_REFUND', 'Select a valid approved payment.');
  }
  const reason = text(
    payload?.reason,
    PAYMENT_LIMITS.maxRefundReasonLength,
    'Refund reason',
    10,
  );
  return { paymentRequestId, reason };
}

export function normalizePartnershipRequest(payload) {
  const allowedTypes = new Set([
    'institutional_license', 'academic_partnership', 'content_collaboration',
    'technology_partnership', 'media', 'other',
  ]);
  const inquiryType = text(payload?.inquiryType, 40, 'Inquiry type', 3).toLowerCase();
  if (!allowedTypes.has(inquiryType)) {
    throw new PaymentValidationError('INVALID_PARTNERSHIP', 'Select a valid inquiry type.');
  }
  const contactName = text(payload?.contactName, 120, 'Name', 2);
  const contactEmail = text(payload?.contactEmail, 254, 'Email', 5).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new PaymentValidationError('INVALID_PARTNERSHIP', 'Enter a valid contact email.');
  }
  const organizationRaw = String(payload?.organization ?? '').trim();
  if (organizationRaw.length > 180 || (organizationRaw && organizationRaw.length < 2)) {
    throw new PaymentValidationError('INVALID_PARTNERSHIP', 'Organization must be 2 to 180 characters.');
  }
  const message = text(payload?.message, 5000, 'Message', 20);
  if (payload?.consent !== true) {
    throw new PaymentValidationError(
      'PARTNERSHIP_CONSENT_REQUIRED',
      'Consent is required so the founders may respond to this inquiry.',
    );
  }
  return {
    inquiryType,
    contactName,
    contactEmail,
    organization: organizationRaw || null,
    message,
    consent: true,
  };
}

export function normalizePhase4AdminRequest(payload) {
  const section = String(payload?.section || '').trim().toLowerCase();
  if (!['payments', 'refunds', 'partnerships', 'access', 'introductory_access'].includes(section)) {
    throw new PaymentValidationError('INVALID_ADMIN_REQUEST', 'Unsupported Phase 4 admin section.');
  }
  const premiumStatus = String(payload?.premiumStatus || 'all').trim().toLowerCase();
  if (!['all', 'active', 'pending', 'expired', 'suspended', 'revoked', 'beta'].includes(
    premiumStatus,
  )) {
    throw new PaymentValidationError(
      'INVALID_ADMIN_REQUEST',
      'Select a valid Premium access filter.',
    );
  }
  return {
    section,
    search: String(payload?.search || '').trim().slice(0, 200),
    limit: Math.max(1, Math.min(100, Number(payload?.limit) || 50)),
    offset: Math.max(0, Number(payload?.offset) || 0),
    premiumStatus,
  };
}

export function normalizePhase4AdminAction(payload) {
  const action = String(payload?.action || '').trim();
  const allowed = new Set([
    'payment_review', 'refund_review', 'subscription_change',
    'free_beta_change', 'partnership_update', 'provider_incident_clear',
    'role_change', 'discount_assign', 'subscription_audit_view',
  ]);
  if (!allowed.has(action)) {
    throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Unsupported Phase 4 admin action.');
  }
  const targetId = String(payload?.targetId || '').trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(targetId)) {
    throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'A valid target is required.');
  }
  const reason = text(payload?.reason, 1000, 'Reason', 5);
  const requestKey = text(payload?.requestKey, 128, 'Request key', 16);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'A valid request key is required.');
  }
  const rawActionPayload = payload?.payload && typeof payload.payload === 'object'
    && !Array.isArray(payload.payload) ? payload.payload : {};
  let actionPayload = rawActionPayload;

  if (action === 'payment_review') {
    const status = String(rawActionPayload.status || '').trim().toLowerCase();
    if (!['needs_information', 'approved', 'rejected'].includes(status)) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Select a valid payment decision.');
    }
    let expiresAt = null;
    if (rawActionPayload.expiresAt) {
      const date = new Date(String(rawActionPayload.expiresAt));
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        throw new PaymentValidationError(
          'INVALID_ADMIN_ACTION',
          'Premium payment approval requires a future expiration.',
        );
      }
      expiresAt = date.toISOString();
    }
    actionPayload = { status, expiresAt };
  } else if (action === 'subscription_change') {
    const operation = String(rawActionPayload.operation || '').trim().toLowerCase();
    const allowedOperations = new Set([
      'activate', 'complimentary', 'pause', 'resume', 'cancel', 'extend',
      'expire', 'restore', 'replace_plan', 'set_start_date',
      'set_expiration_date',
    ]);
    if (!allowedOperations.has(operation)) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Select a valid subscription operation.');
    }
    const suppliedUserId = String(rawActionPayload.userId || targetId).trim();
    if (suppliedUserId !== targetId) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'The target user does not match the subscription action.');
    }
    const subscriptionId = rawActionPayload.subscriptionId == null
      || rawActionPayload.subscriptionId === ''
      ? null : String(rawActionPayload.subscriptionId).trim();
    if (subscriptionId && !uuidPattern.test(subscriptionId)) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'The subscription identifier is invalid.');
    }
    if (!['activate', 'complimentary'].includes(operation) && !subscriptionId) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'An existing subscription is required for this action.');
    }

    let planCode = null;
    if (['activate', 'complimentary', 'replace_plan'].includes(operation)) {
      planCode = String(rawActionPayload.planCode || '').trim().toLowerCase();
      if (!['early_access_beta', 'standard', 'premium'].includes(planCode)) {
        throw new PaymentValidationError(
          'PLAN_UNAVAILABLE',
          'Select an active Early Access Beta, Standard, or Premium plan.',
        );
      }
    }

    let durationDays = null;
    if (operation === 'extend') {
      durationDays = Number(rawActionPayload.durationDays);
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) {
        throw new PaymentValidationError(
          'INVALID_ADMIN_ACTION',
          'Extension days must be a whole number from 1 to 366.',
        );
      }
    }

    let startsAt = null;
    let expiresAt = null;
    if (operation === 'set_start_date') {
      const date = new Date(String(rawActionPayload.startsAt || ''));
      if (!Number.isFinite(date.getTime())) {
        throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Select a valid subscription start date.');
      }
      startsAt = date.toISOString();
    }
    if (
      operation === 'set_expiration_date'
      || operation === 'restore'
      || (
        ['activate', 'complimentary', 'replace_plan'].includes(operation)
        && planCode === 'premium'
      )
    ) {
      const date = new Date(String(rawActionPayload.expiresAt || ''));
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        throw new PaymentValidationError(
          'INVALID_ADMIN_ACTION',
          'Select a future subscription expiration date.',
        );
      }
      expiresAt = date.toISOString();
    }
    actionPayload = {
      operation,
      userId: targetId,
      subscriptionId,
      planCode,
      durationDays,
      startsAt,
      expiresAt,
    };
  } else if (action === 'free_beta_change') {
    if (typeof rawActionPayload.enabled !== 'boolean') {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Free Beta state must be enabled or disabled.');
    }
    let expiresAt = null;
    if (rawActionPayload.expiresAt) {
      const date = new Date(String(rawActionPayload.expiresAt));
      if (!Number.isFinite(date.getTime())) {
        throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Free Beta expiration is invalid.');
      }
      expiresAt = date.toISOString();
    }
    actionPayload = { enabled: rawActionPayload.enabled, expiresAt };
  } else if (action === 'discount_assign') {
    const code = String(rawActionPayload.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
      throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'Enter a valid active discount code.');
    }
    actionPayload = { code };
  } else if (action === 'subscription_audit_view') {
    actionPayload = {};
  }

  if (JSON.stringify(actionPayload).length > 16_000) {
    throw new PaymentValidationError('INVALID_ADMIN_ACTION', 'The action payload is too large.');
  }
  return { action, targetId, reason, requestKey, payload: actionPayload };
}
