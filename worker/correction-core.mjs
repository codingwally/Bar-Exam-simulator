export const CORRECTION_TYPES = Object.freeze([
  'question_text',
  'suggested_answer',
  'legal_basis',
  'source',
  'other',
]);

export const CORRECTION_LIMITS = Object.freeze({
  requestBytes: 16_000,
  questionId: 120,
  subject: 120,
  proposedCorrection: 6_000,
  explanation: 3_000,
  sourceUrl: 500,
  sourceCount: 5,
});

const ALLOWED_FIELDS = new Set([
  'questionId',
  'subject',
  'correctionType',
  'proposedCorrection',
  'explanation',
  'sourceUrls',
]);

export class CorrectionValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CorrectionValidationError';
    this.code = code;
  }
}

function requiredText(value, field, minimum, maximum) {
  if (typeof value !== 'string') {
    throw new CorrectionValidationError('INVALID_CORRECTION', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new CorrectionValidationError(
      'INVALID_CORRECTION',
      `${field} must contain ${minimum} to ${maximum} characters.`,
    );
  }
  return normalized;
}

function normalizeSourceUrls(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'Supporting sources must be a list of URLs.');
  }
  if (value.length > CORRECTION_LIMITS.sourceCount) {
    throw new CorrectionValidationError(
      'INVALID_CORRECTION',
      `Provide no more than ${CORRECTION_LIMITS.sourceCount} supporting source URLs.`,
    );
  }

  const normalized = [];
  for (const source of value) {
    if (typeof source !== 'string' || source.trim().length === 0) {
      throw new CorrectionValidationError('INVALID_CORRECTION', 'Each supporting source must be a URL.');
    }
    const raw = source.trim();
    if (raw.length > CORRECTION_LIMITS.sourceUrl) {
      throw new CorrectionValidationError('INVALID_CORRECTION', 'A supporting source URL is too long.');
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new CorrectionValidationError('INVALID_CORRECTION', 'A supporting source URL is malformed.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new CorrectionValidationError(
        'INVALID_CORRECTION',
        'Supporting sources must use http:// or https:// without embedded credentials.',
      );
    }
    if (!normalized.includes(url.href)) normalized.push(url.href);
  }
  return normalized;
}

export function normalizeCorrectionRequest(payload, trustedQuestion) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'The correction request must be an object.');
  }

  const unexpected = Object.keys(payload).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'The correction request contains unsupported fields.');
  }

  const questionId = requiredText(payload.questionId, 'Question ID', 2, CORRECTION_LIMITS.questionId);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(questionId)) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'Question ID has an invalid format.');
  }
  if (!trustedQuestion || String(trustedQuestion['Question ID'] || '').trim() !== questionId) {
    throw new CorrectionValidationError('QUESTION_NOT_FOUND', 'The selected question is unavailable.');
  }

  const trustedSubject = requiredText(
    trustedQuestion.Subject,
    'Question subject',
    2,
    CORRECTION_LIMITS.subject,
  );
  const submittedSubject = requiredText(payload.subject, 'Subject', 2, CORRECTION_LIMITS.subject);
  if (submittedSubject !== trustedSubject) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'The question subject does not match.');
  }

  if (typeof payload.correctionType !== 'string' || !CORRECTION_TYPES.includes(payload.correctionType)) {
    throw new CorrectionValidationError('INVALID_CORRECTION', 'Select a supported correction type.');
  }

  return Object.freeze({
    questionId,
    subject: trustedSubject,
    correctionType: payload.correctionType,
    proposedCorrection: requiredText(
      payload.proposedCorrection,
      'Proposed correction or better answer',
      10,
      CORRECTION_LIMITS.proposedCorrection,
    ),
    explanation: requiredText(
      payload.explanation,
      'Explanation',
      10,
      CORRECTION_LIMITS.explanation,
    ),
    sourceUrls: normalizeSourceUrls(payload.sourceUrls),
  });
}

export function correctionInsertRecord(correction) {
  return Object.freeze({
    question_bank_id: correction.questionId,
    subject: correction.subject,
    correction_type: correction.correctionType,
    proposed_correction: correction.proposedCorrection,
    explanation: correction.explanation,
    source_urls: correction.sourceUrls,
    user_id: null,
  });
}
