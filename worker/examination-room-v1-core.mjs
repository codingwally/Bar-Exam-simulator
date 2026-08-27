/**
 * Examination Room v1 domain core.
 *
 * This module is intentionally pure: it performs validation, normalization,
 * deterministic manifest construction, and safe error shaping only. Callers
 * provide identifiers, timestamps, entropy, and cryptographic hashes.
 */

export const SCHEMA_VERSIONS = Object.freeze({
  PUBLICATION: 'examination-room/publication/v1',
  SUBMISSION: 'examination-room/submission/v1',
  GRADING: 'examination-room/grading/v1',
  RESULT_RELEASE: 'examination-room/result-release/v1',
});

export const QUESTION_TYPES = Object.freeze({
  ESSAY: 'essay',
  MULTIPLE_CHOICE: 'multiple-choice',
  SHORT_ANSWER: 'short-answer',
});

export const QUESTION_TYPE_VALUES = Object.freeze(Object.values(QUESTION_TYPES));

export const GRADING_IDENTITY_MODES = Object.freeze({
  REAL_NAMES: 'real_names',
  ANONYMOUS: 'anonymous_grading',
});

export const DEFAULT_GRADING_IDENTITY_MODE = GRADING_IDENTITY_MODES.REAL_NAMES;

export const INTEGRITY_TIERS = Object.freeze({
  STANDARD: 'standard',
  FOCUS_MONITORING: 'focus_monitoring',
  RECORDED_PROCTORING: 'recorded_proctoring',
});

export const DEFAULT_INTEGRITY_TIER = INTEGRITY_TIERS.STANDARD;

export const GRADING_REVISION_STATUSES = Object.freeze({
  DRAFT: 'draft',
  FINAL: 'final',
});

export const ROOM_KEY = Object.freeze({
  PREFIX: 'ER1',
  ALPHABET: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  PAYLOAD_LENGTH: 8,
  DISPLAY_PATTERN: 'ER1-XXXX-XXXX-C',
});

export const LIMITS = Object.freeze({
  MAX_QUESTIONS: 200,
  MAX_TITLE_LENGTH: 200,
  MAX_SUBJECT_LENGTH: 160,
  MAX_YEAR_LEVEL_LENGTH: 64,
  MAX_INSTRUCTIONS_LENGTH: 20_000,
  MAX_PROMPT_LENGTH: 50_000,
  MAX_GRADING_GUIDANCE_LENGTH: 20_000,
  MAX_CHOICE_LENGTH: 1_000,
  MAX_CHOICES: 10,
  MAX_ACCEPTED_ANSWERS: 50,
  MAX_ACCEPTED_ANSWER_LENGTH: 2_000,
  MAX_ESSAY_ANSWER_LENGTH: 100_000,
  MAX_SHORT_ANSWER_LENGTH: 10_000,
  MAX_FEEDBACK_LENGTH: 20_000,
  MAX_POINTS_PER_QUESTION: 10_000,
  MAX_WORD_LIMIT: 100_000,
});

export const ERROR_CODES = Object.freeze({
  REQUEST_OBJECT_INVALID: 'EXAM_ROOM_V1_REQUEST_OBJECT_INVALID',
  REQUEST_FIELD_NOT_ALLOWED: 'EXAM_ROOM_V1_REQUEST_FIELD_NOT_ALLOWED',
  REQUEST_FIELD_ACCESSOR_NOT_ALLOWED: 'EXAM_ROOM_V1_REQUEST_FIELD_ACCESSOR_NOT_ALLOWED',
  TEXT_INVALID: 'EXAM_ROOM_V1_TEXT_INVALID',
  TEXT_TOO_LONG: 'EXAM_ROOM_V1_TEXT_TOO_LONG',
  IDENTIFIER_INVALID: 'EXAM_ROOM_V1_IDENTIFIER_INVALID',
  TIMESTAMP_INVALID: 'EXAM_ROOM_V1_TIMESTAMP_INVALID',
  QUESTION_TYPE_INVALID: 'EXAM_ROOM_V1_QUESTION_TYPE_INVALID',
  QUESTION_LIST_INVALID: 'EXAM_ROOM_V1_QUESTION_LIST_INVALID',
  QUESTION_NUMBER_INVALID: 'EXAM_ROOM_V1_QUESTION_NUMBER_INVALID',
  QUESTION_POINTS_INVALID: 'EXAM_ROOM_V1_QUESTION_POINTS_INVALID',
  QUESTION_FIELD_INVALID: 'EXAM_ROOM_V1_QUESTION_FIELD_INVALID',
  QUESTION_CHOICES_INVALID: 'EXAM_ROOM_V1_QUESTION_CHOICES_INVALID',
  QUESTION_CORRECT_OPTION_INVALID: 'EXAM_ROOM_V1_QUESTION_CORRECT_OPTION_INVALID',
  QUESTION_ACCEPTED_ANSWERS_INVALID: 'EXAM_ROOM_V1_QUESTION_ACCEPTED_ANSWERS_INVALID',
  DRAFT_DERIVED_VALUE_MISMATCH: 'EXAM_ROOM_V1_DRAFT_DERIVED_VALUE_MISMATCH',
  IDENTITY_MODE_INVALID: 'EXAM_ROOM_V1_IDENTITY_MODE_INVALID',
  INTEGRITY_TIER_INVALID: 'EXAM_ROOM_V1_INTEGRITY_TIER_INVALID',
  PRIVACY_NOTICE_VERSION_INVALID: 'EXAM_ROOM_V1_PRIVACY_NOTICE_VERSION_INVALID',
  PUBLICATION_NOT_READY: 'EXAM_ROOM_V1_PUBLICATION_NOT_READY',
  PUBLICATION_MANIFEST_INVALID: 'EXAM_ROOM_V1_PUBLICATION_MANIFEST_INVALID',
  PUBLICATION_HASH_INVALID: 'EXAM_ROOM_V1_PUBLICATION_HASH_INVALID',
  HASH_INPUT_INVALID: 'EXAM_ROOM_V1_HASH_INPUT_INVALID',
  ROOM_KEY_PAYLOAD_INVALID: 'EXAM_ROOM_V1_ROOM_KEY_PAYLOAD_INVALID',
  ROOM_KEY_FORMAT_INVALID: 'EXAM_ROOM_V1_ROOM_KEY_FORMAT_INVALID',
  ROOM_KEY_CHECKSUM_INVALID: 'EXAM_ROOM_V1_ROOM_KEY_CHECKSUM_INVALID',
  STUDENT_IDENTITY_INVALID: 'EXAM_ROOM_V1_STUDENT_IDENTITY_INVALID',
  STUDENT_SUBJECT_MISMATCH: 'EXAM_ROOM_V1_STUDENT_SUBJECT_MISMATCH',
  STUDENT_YEAR_LEVEL_MISMATCH: 'EXAM_ROOM_V1_STUDENT_YEAR_LEVEL_MISMATCH',
  PRIVACY_CONSENT_REQUIRED: 'EXAM_ROOM_V1_PRIVACY_CONSENT_REQUIRED',
  PRIVACY_CONSENT_VERSION_MISMATCH: 'EXAM_ROOM_V1_PRIVACY_CONSENT_VERSION_MISMATCH',
  RECORDING_CONSENT_REQUIRED: 'EXAM_ROOM_V1_RECORDING_CONSENT_REQUIRED',
  ANSWER_REVISION_INVALID: 'EXAM_ROOM_V1_ANSWER_REVISION_INVALID',
  ANSWER_QUESTION_NOT_FOUND: 'EXAM_ROOM_V1_ANSWER_QUESTION_NOT_FOUND',
  ANSWER_VALUE_INVALID: 'EXAM_ROOM_V1_ANSWER_VALUE_INVALID',
  IDEMPOTENCY_KEY_INVALID: 'EXAM_ROOM_V1_IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'EXAM_ROOM_V1_IDEMPOTENCY_KEY_REUSED',
  ANSWER_REVISION_CONFLICT: 'EXAM_ROOM_V1_ANSWER_REVISION_CONFLICT',
  ANSWER_BINDING_MISMATCH: 'EXAM_ROOM_V1_ANSWER_BINDING_MISMATCH',
  SUBMISSION_MANIFEST_INVALID: 'EXAM_ROOM_V1_SUBMISSION_MANIFEST_INVALID',
  SUBMISSION_ANSWER_MISSING: 'EXAM_ROOM_V1_SUBMISSION_ANSWER_MISSING',
  ANONYMOUS_CANDIDATE_ID_REQUIRED: 'EXAM_ROOM_V1_ANONYMOUS_CANDIDATE_ID_REQUIRED',
  ANONYMOUS_CANDIDATE_ID_INVALID: 'EXAM_ROOM_V1_ANONYMOUS_CANDIDATE_ID_INVALID',
  GRADING_REVISION_INVALID: 'EXAM_ROOM_V1_GRADING_REVISION_INVALID',
  GRADING_SCORE_INVALID: 'EXAM_ROOM_V1_GRADING_SCORE_INVALID',
  GRADING_SCORE_DUPLICATE: 'EXAM_ROOM_V1_GRADING_SCORE_DUPLICATE',
  GRADING_INCOMPLETE: 'EXAM_ROOM_V1_GRADING_INCOMPLETE',
  RESULT_REVISION_NOT_FOUND: 'EXAM_ROOM_V1_RESULT_REVISION_NOT_FOUND',
  RESULT_REVISION_NOT_FINAL: 'EXAM_ROOM_V1_RESULT_REVISION_NOT_FINAL',
  RESULT_REVISION_DUPLICATE: 'EXAM_ROOM_V1_RESULT_REVISION_DUPLICATE',
  INTERNAL_ERROR: 'EXAM_ROOM_V1_INTERNAL_ERROR',
});

export const PUBLICATION_READINESS_CODES = Object.freeze({
  TITLE_REQUIRED: 'EXAM_ROOM_V1_READY_TITLE_REQUIRED',
  SUBJECT_REQUIRED: 'EXAM_ROOM_V1_READY_SUBJECT_REQUIRED',
  YEAR_LEVEL_REQUIRED: 'EXAM_ROOM_V1_READY_YEAR_LEVEL_REQUIRED',
  PRIVACY_NOTICE_REQUIRED: 'EXAM_ROOM_V1_READY_PRIVACY_NOTICE_REQUIRED',
  QUESTION_REQUIRED: 'EXAM_ROOM_V1_READY_QUESTION_REQUIRED',
  QUESTION_PROMPT_REQUIRED: 'EXAM_ROOM_V1_READY_QUESTION_PROMPT_REQUIRED',
  QUESTION_POINTS_REQUIRED: 'EXAM_ROOM_V1_READY_QUESTION_POINTS_REQUIRED',
  MULTIPLE_CHOICE_OPTIONS_REQUIRED: 'EXAM_ROOM_V1_READY_MC_OPTIONS_REQUIRED',
  MULTIPLE_CHOICE_OPTIONS_UNIQUE: 'EXAM_ROOM_V1_READY_MC_OPTIONS_UNIQUE',
  MULTIPLE_CHOICE_KEY_REQUIRED: 'EXAM_ROOM_V1_READY_MC_KEY_REQUIRED',
});

const QUESTION_INPUT_FIELDS = new Set([
  'number',
  'key',
  'type',
  'prompt',
  'points',
  'gradingGuidance',
  'wordLimit',
  'choices',
  'correctOptionIndex',
  'acceptedAnswers',
]);

const DRAFT_INPUT_FIELDS = new Set([
  'title',
  'subject',
  'yearLevel',
  'instructions',
  'identityMode',
  'integrityTier',
  'privacyNoticeVersion',
  'questions',
  'questionCount',
  'totalPoints',
]);

const FORBIDDEN_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const SINGLE_LINE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/u;
const NOTICE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ANONYMOUS_ID_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{5,63}$/u;

/** A domain error safe to expose through a route after calling toSafeError(). */
export class ExaminationRoomV1Error extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ExaminationRoomV1Error';
    this.code = code;
    if (details !== undefined) this.details = deepFreeze(cloneSafeDetails(details));
  }
}

function cloneSafeDetails(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(cloneSafeDetails);
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = cloneSafeDetails(item);
  return result;
}

function fail(code, message, details = undefined) {
  throw new ExaminationRoomV1Error(code, message, details);
}

export function isExaminationRoomV1Error(error) {
  return error instanceof ExaminationRoomV1Error && typeof error.code === 'string';
}

export function toSafeError(error) {
  if (isExaminationRoomV1Error(error)) {
    return deepFreeze({
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: cloneSafeDetails(error.details) }),
    });
  }

  return deepFreeze({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'We could not complete that action. Please try again; if it continues, contact support.',
  });
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertPlainRecord(value, field = 'request') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      ERROR_CODES.REQUEST_OBJECT_INVALID,
      `Provide ${field} as an object with named fields.`,
      { field },
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      ERROR_CODES.REQUEST_OBJECT_INVALID,
      `Provide ${field} as a plain object.`,
      { field },
    );
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      fail(
        ERROR_CODES.REQUEST_FIELD_NOT_ALLOWED,
        `Remove the unsupported field from ${field} and try again.`,
        { field },
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && (typeof descriptor.get === 'function' || typeof descriptor.set === 'function')) {
      fail(
        ERROR_CODES.REQUEST_FIELD_ACCESSOR_NOT_ALLOWED,
        `Replace the computed ${field}.${key} field with a regular value and try again.`,
        { field: `${field}.${key}` },
      );
    }
  }

  return value;
}

function assertAllowedFields(record, allowed, field) {
  assertPlainRecord(record, field);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(
        ERROR_CODES.REQUEST_FIELD_NOT_ALLOWED,
        `Remove the unsupported ${field}.${key} field and try again.`,
        { field: `${field}.${key}` },
      );
    }
  }
}

function assertArrayDataEntries(value, field) {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) {
      fail(
        ERROR_CODES.REQUEST_OBJECT_INVALID,
        `Fill or remove the empty item at ${field}[${index}] and try again.`,
        { field: `${field}[${index}]` },
      );
    }
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      fail(
        ERROR_CODES.REQUEST_FIELD_ACCESSOR_NOT_ALLOWED,
        `Replace the computed ${field}[${index}] item with a regular value and try again.`,
        { field: `${field}[${index}]` },
      );
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
      fail(
        ERROR_CODES.REQUEST_FIELD_NOT_ALLOWED,
        `Remove the unsupported property from ${field} and try again.`,
        { field },
      );
    }
  }
  return value;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertSafeText(value, field, maxLength) {
  if (typeof value !== 'string') {
    fail(ERROR_CODES.TEXT_INVALID, `Enter ${field} as text and try again.`, { field });
  }
  if (hasLoneSurrogate(value) || FORBIDDEN_TEXT.test(value)) {
    fail(
      ERROR_CODES.TEXT_INVALID,
      `Remove hidden or unsupported characters from ${field} and try again.`,
      { field },
    );
  }
  if (value.length > maxLength) {
    fail(
      ERROR_CODES.TEXT_TOO_LONG,
      `Shorten ${field} to ${maxLength.toLocaleString('en-US')} characters or fewer and try again.`,
      { field, maxLength },
    );
  }
}

function normalizeSingleLine(value, options) {
  const {
    field,
    maxLength,
    required = false,
    defaultValue = '',
    code = ERROR_CODES.TEXT_INVALID,
    label = field,
  } = options;

  if (value === undefined || value === null) {
    if (required) fail(code, `Enter ${label} and try again.`, { field });
    return defaultValue;
  }
  assertSafeText(value, field, maxLength);
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (required && normalized.length === 0) {
    fail(code, `Enter ${label} and try again.`, { field });
  }
  if (normalized.length > maxLength) {
    fail(
      ERROR_CODES.TEXT_TOO_LONG,
      `Shorten ${label} to ${maxLength.toLocaleString('en-US')} characters or fewer and try again.`,
      { field, maxLength },
    );
  }
  return normalized;
}

function normalizeFreeText(value, options) {
  const { field, maxLength, required = false, defaultValue = '' } = options;
  if (value === undefined || value === null) {
    if (required) fail(ERROR_CODES.TEXT_INVALID, `Enter ${field} and try again.`, { field });
    return defaultValue;
  }
  assertSafeText(value, field, maxLength);
  const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (required && normalized.length === 0) {
    fail(ERROR_CODES.TEXT_INVALID, `Enter ${field} and try again.`, { field });
  }
  return normalized;
}

function normalizeAnswerText(value, field, maxLength) {
  assertSafeText(value, field, maxLength);
  return value.normalize('NFC').replace(/\r\n?/gu, '\n');
}

function normalizeOpaqueId(value, field, label = field) {
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 128,
    required: true,
    code: ERROR_CODES.IDENTIFIER_INVALID,
    label,
  });
  if (!SINGLE_LINE_IDENTIFIER.test(normalized)) {
    fail(
      ERROR_CODES.IDENTIFIER_INVALID,
      `Use the ${label} generated for this action and try again.`,
      { field },
    );
  }
  return normalized;
}

function normalizeIdempotencyKey(value, field = 'idempotencyKey') {
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 128,
    required: true,
    code: ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
    label: 'request key',
  });
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    fail(
      ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
      'Create a new request key of 16 to 128 letters, numbers, dots, dashes, underscores, or colons and try again.',
      { field },
    );
  }
  return normalized;
}

function normalizePositiveInteger(value, field, code, options = {}) {
  const { min = 1, max = 1_000_000_000, label = field } = options;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(code, `Enter ${label} as a whole number from ${min} to ${max} and try again.`, { field, min, max });
  }
  return value;
}

function normalizePointValue(value, options) {
  const {
    field,
    allowZero = false,
    max = LIMITS.MAX_POINTS_PER_QUESTION,
    code = ERROR_CODES.QUESTION_POINTS_INVALID,
    label = 'points',
  } = options;
  const minimum = allowZero ? 0 : 0.01;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(code, `Enter ${label} as a number from ${minimum} to ${max} and try again.`, { field, minimum, max });
  }
  const hundredths = Math.round(value * 100);
  if (
    value < minimum ||
    value > max ||
    Math.abs(value - hundredths / 100) > Number.EPSILON * Math.max(1, Math.abs(value)) * 8
  ) {
    fail(
      code,
      `Enter ${label} from ${minimum} to ${max}, using no more than two decimal places, and try again.`,
      { field, minimum, max },
    );
  }
  return hundredths / 100;
}

function pointsToHundredths(value) {
  return Math.round(value * 100);
}

function hundredthsToPoints(value) {
  return value / 100;
}

export function normalizeIsoInstant(value, field = 'timestamp') {
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 24,
    required: true,
    code: ERROR_CODES.TIMESTAMP_INVALID,
    label: `${field} timestamp`,
  });
  const match = /^(2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/u.exec(normalized);
  if (!match) {
    fail(
      ERROR_CODES.TIMESTAMP_INVALID,
      `Use a complete UTC timestamp for ${field}, such as 2026-08-26T09:30:00.000Z, and try again.`,
      { field },
    );
  }
  const canonical = `${match[1]}.${match[2] ?? '000'}Z`;
  const date = new Date(canonical);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) {
    fail(
      ERROR_CODES.TIMESTAMP_INVALID,
      `Enter a real calendar date and time for ${field} and try again.`,
      { field },
    );
  }
  return canonical;
}

export function normalizeQuestionType(value, field = 'question.type') {
  if (typeof value !== 'string') {
    fail(
      ERROR_CODES.QUESTION_TYPE_INVALID,
      'Choose essay, multiple-choice, or short-answer for the question type.',
      { field },
    );
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/gu, '-');
  if (!QUESTION_TYPE_VALUES.includes(normalized)) {
    fail(
      ERROR_CODES.QUESTION_TYPE_INVALID,
      'Choose essay, multiple-choice, or short-answer for the question type.',
      { field },
    );
  }
  return normalized;
}

export function normalizeGradingIdentityMode(value = DEFAULT_GRADING_IDENTITY_MODE, field = 'identityMode') {
  if (value === undefined || value === null || value === '') return DEFAULT_GRADING_IDENTITY_MODE;
  if (typeof value !== 'string') {
    fail(
      ERROR_CODES.IDENTITY_MODE_INVALID,
      'Choose real-name grading or anonymous grading and try again.',
      { field },
    );
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!Object.values(GRADING_IDENTITY_MODES).includes(normalized)) {
    fail(
      ERROR_CODES.IDENTITY_MODE_INVALID,
      'Choose real-name grading or anonymous grading and try again.',
      { field },
    );
  }
  return normalized;
}

export function normalizeIntegrityTier(value = DEFAULT_INTEGRITY_TIER, field = 'integrityTier') {
  if (value === undefined || value === null || value === '') return DEFAULT_INTEGRITY_TIER;
  if (typeof value !== 'string') {
    fail(
      ERROR_CODES.INTEGRITY_TIER_INVALID,
      'Choose standard, focus monitoring, or recorded proctoring and try again.',
      { field },
    );
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!Object.values(INTEGRITY_TIERS).includes(normalized)) {
    fail(
      ERROR_CODES.INTEGRITY_TIER_INVALID,
      'Choose standard, focus monitoring, or recorded proctoring and try again.',
      { field },
    );
  }
  return normalized;
}

export function normalizePrivacyNoticeVersion(value, options = {}) {
  const { field = 'privacyNoticeVersion', required = true } = options;
  if ((value === undefined || value === null || value === '') && !required) return null;
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 64,
    required: true,
    code: ERROR_CODES.PRIVACY_NOTICE_VERSION_INVALID,
    label: 'privacy notice version',
  });
  if (!NOTICE_VERSION_PATTERN.test(normalized)) {
    fail(
      ERROR_CODES.PRIVACY_NOTICE_VERSION_INVALID,
      'Use the published privacy notice version shown for this examination and try again.',
      { field },
    );
  }
  return normalized;
}

function normalizeQuestion(rawQuestion, index) {
  const field = `questions[${index}]`;
  assertAllowedFields(rawQuestion, QUESTION_INPUT_FIELDS, field);

  const number = index + 1;
  const key = `q${String(number).padStart(3, '0')}`;
  if (hasOwn(rawQuestion, 'number') && rawQuestion.number !== number) {
    fail(
      ERROR_CODES.QUESTION_NUMBER_INVALID,
      `Remove the custom number from question ${number}; question numbers are assigned from their order.`,
      { field: `${field}.number`, questionNumber: number },
    );
  }
  if (hasOwn(rawQuestion, 'key') && rawQuestion.key !== key) {
    fail(
      ERROR_CODES.QUESTION_NUMBER_INVALID,
      `Remove the custom key from question ${number}; question keys are assigned from their order.`,
      { field: `${field}.key`, questionNumber: number },
    );
  }

  const type = normalizeQuestionType(rawQuestion.type, `${field}.type`);
  const prompt = normalizeFreeText(rawQuestion.prompt, {
    field: `${field}.prompt`,
    maxLength: LIMITS.MAX_PROMPT_LENGTH,
  });
  const points = rawQuestion.points === undefined || rawQuestion.points === null
    ? 0
    : normalizePointValue(rawQuestion.points, {
      field: `${field}.points`,
      allowZero: true,
    });
  const gradingGuidance = normalizeFreeText(rawQuestion.gradingGuidance, {
    field: `${field}.gradingGuidance`,
    maxLength: LIMITS.MAX_GRADING_GUIDANCE_LENGTH,
  });

  let wordLimit = null;
  let choices = [];
  let correctOptionIndex = null;
  let acceptedAnswers = [];

  if (type === QUESTION_TYPES.ESSAY) {
    if (rawQuestion.wordLimit !== undefined && rawQuestion.wordLimit !== null) {
      wordLimit = normalizePositiveInteger(
        rawQuestion.wordLimit,
        `${field}.wordLimit`,
        ERROR_CODES.QUESTION_FIELD_INVALID,
        { min: 1, max: LIMITS.MAX_WORD_LIMIT, label: 'the essay word limit' },
      );
    }
    if (hasOwn(rawQuestion, 'choices') && (!Array.isArray(rawQuestion.choices) || rawQuestion.choices.length !== 0)) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove answer choices from essay question ${number} and try again.`,
        { field: `${field}.choices`, questionNumber: number },
      );
    }
    if (hasOwn(rawQuestion, 'correctOptionIndex') && rawQuestion.correctOptionIndex !== null) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove the correct-option field from essay question ${number} and try again.`,
        { field: `${field}.correctOptionIndex`, questionNumber: number },
      );
    }
    if (hasOwn(rawQuestion, 'acceptedAnswers') && (!Array.isArray(rawQuestion.acceptedAnswers) || rawQuestion.acceptedAnswers.length !== 0)) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove accepted answers from essay question ${number} and try again.`,
        { field: `${field}.acceptedAnswers`, questionNumber: number },
      );
    }
  }

  if (type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    if (rawQuestion.wordLimit !== undefined && rawQuestion.wordLimit !== null) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove the word limit from multiple-choice question ${number} and try again.`,
        { field: `${field}.wordLimit`, questionNumber: number },
      );
    }
    if (rawQuestion.choices !== undefined) {
      if (!Array.isArray(rawQuestion.choices) || rawQuestion.choices.length > LIMITS.MAX_CHOICES) {
        fail(
          ERROR_CODES.QUESTION_CHOICES_INVALID,
          `Provide no more than ${LIMITS.MAX_CHOICES} answer choices for question ${number}.`,
          { field: `${field}.choices`, questionNumber: number },
        );
      }
      assertArrayDataEntries(rawQuestion.choices, `${field}.choices`);
      choices = rawQuestion.choices.map((choice, choiceIndex) => normalizeSingleLine(choice, {
        field: `${field}.choices[${choiceIndex}]`,
        maxLength: LIMITS.MAX_CHOICE_LENGTH,
      }));
    }
    if (rawQuestion.correctOptionIndex !== undefined && rawQuestion.correctOptionIndex !== null) {
      correctOptionIndex = normalizePositiveInteger(
        rawQuestion.correctOptionIndex,
        `${field}.correctOptionIndex`,
        ERROR_CODES.QUESTION_CORRECT_OPTION_INVALID,
        { min: 0, max: LIMITS.MAX_CHOICES - 1, label: 'the zero-based correct option number' },
      );
    }
    if (hasOwn(rawQuestion, 'acceptedAnswers') && (!Array.isArray(rawQuestion.acceptedAnswers) || rawQuestion.acceptedAnswers.length !== 0)) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove accepted answers from multiple-choice question ${number} and try again.`,
        { field: `${field}.acceptedAnswers`, questionNumber: number },
      );
    }
  }

  if (type === QUESTION_TYPES.SHORT_ANSWER) {
    if (rawQuestion.wordLimit !== undefined && rawQuestion.wordLimit !== null) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove the word limit from short-answer question ${number} and try again.`,
        { field: `${field}.wordLimit`, questionNumber: number },
      );
    }
    if (hasOwn(rawQuestion, 'choices') && (!Array.isArray(rawQuestion.choices) || rawQuestion.choices.length !== 0)) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove answer choices from short-answer question ${number} and try again.`,
        { field: `${field}.choices`, questionNumber: number },
      );
    }
    if (hasOwn(rawQuestion, 'correctOptionIndex') && rawQuestion.correctOptionIndex !== null) {
      fail(
        ERROR_CODES.QUESTION_FIELD_INVALID,
        `Remove the correct-option field from short-answer question ${number} and try again.`,
        { field: `${field}.correctOptionIndex`, questionNumber: number },
      );
    }
    if (rawQuestion.acceptedAnswers !== undefined) {
      if (!Array.isArray(rawQuestion.acceptedAnswers) || rawQuestion.acceptedAnswers.length > LIMITS.MAX_ACCEPTED_ANSWERS) {
        fail(
          ERROR_CODES.QUESTION_ACCEPTED_ANSWERS_INVALID,
          `Provide no more than ${LIMITS.MAX_ACCEPTED_ANSWERS} accepted answers for question ${number}.`,
          { field: `${field}.acceptedAnswers`, questionNumber: number },
        );
      }
      assertArrayDataEntries(rawQuestion.acceptedAnswers, `${field}.acceptedAnswers`);
      const seen = new Set();
      acceptedAnswers = [];
      for (let answerIndex = 0; answerIndex < rawQuestion.acceptedAnswers.length; answerIndex += 1) {
        const answer = normalizeSingleLine(rawQuestion.acceptedAnswers[answerIndex], {
          field: `${field}.acceptedAnswers[${answerIndex}]`,
          maxLength: LIMITS.MAX_ACCEPTED_ANSWER_LENGTH,
        });
        if (answer.length === 0) continue;
        const comparable = canonicalComparable(answer);
        if (!seen.has(comparable)) {
          seen.add(comparable);
          acceptedAnswers.push(answer);
        }
      }
    }
  }

  return deepFreeze({
    number,
    key,
    type,
    prompt,
    points,
    gradingGuidance,
    wordLimit,
    choices,
    correctOptionIndex,
    acceptedAnswers,
  });
}

export function normalizeProfessorDraft(input) {
  assertAllowedFields(input, DRAFT_INPUT_FIELDS, 'draft');

  const title = normalizeSingleLine(input.title, {
    field: 'draft.title',
    maxLength: LIMITS.MAX_TITLE_LENGTH,
  });
  const subject = normalizeSingleLine(input.subject, {
    field: 'draft.subject',
    maxLength: LIMITS.MAX_SUBJECT_LENGTH,
  });
  const yearLevel = normalizeSingleLine(input.yearLevel, {
    field: 'draft.yearLevel',
    maxLength: LIMITS.MAX_YEAR_LEVEL_LENGTH,
  });
  const instructions = normalizeFreeText(input.instructions, {
    field: 'draft.instructions',
    maxLength: LIMITS.MAX_INSTRUCTIONS_LENGTH,
  });
  const identityMode = normalizeGradingIdentityMode(input.identityMode, 'draft.identityMode');
  const integrityTier = normalizeIntegrityTier(input.integrityTier, 'draft.integrityTier');
  const privacyNoticeVersion = normalizePrivacyNoticeVersion(input.privacyNoticeVersion, {
    field: 'draft.privacyNoticeVersion',
    required: false,
  }) || 'exam-room-direct-entry-v1';

  if (input.questions !== undefined && !Array.isArray(input.questions)) {
    fail(
      ERROR_CODES.QUESTION_LIST_INVALID,
      'Provide the examination questions as a list and try again.',
      { field: 'draft.questions' },
    );
  }
  const rawQuestions = input.questions ?? [];
  if (rawQuestions.length > LIMITS.MAX_QUESTIONS) {
    fail(
      ERROR_CODES.QUESTION_LIST_INVALID,
      `Reduce the examination to ${LIMITS.MAX_QUESTIONS} questions or fewer and try again.`,
      { field: 'draft.questions', maxQuestions: LIMITS.MAX_QUESTIONS },
    );
  }
  assertArrayDataEntries(rawQuestions, 'draft.questions');
  const questions = rawQuestions.map(normalizeQuestion);
  const totalHundredths = questions.reduce((total, question) => total + pointsToHundredths(question.points), 0);
  const totalPoints = hundredthsToPoints(totalHundredths);

  if (hasOwn(input, 'questionCount') && input.questionCount !== questions.length) {
    fail(
      ERROR_CODES.DRAFT_DERIVED_VALUE_MISMATCH,
      'Refresh the draft so its question count can be recalculated and try again.',
      { field: 'draft.questionCount' },
    );
  }
  if (hasOwn(input, 'totalPoints') && input.totalPoints !== totalPoints) {
    fail(
      ERROR_CODES.DRAFT_DERIVED_VALUE_MISMATCH,
      'Refresh the draft so its point total can be recalculated and try again.',
      { field: 'draft.totalPoints' },
    );
  }

  return deepFreeze({
    title,
    subject,
    yearLevel,
    instructions,
    identityMode,
    integrityTier,
    privacyNoticeVersion,
    questions,
    questionCount: questions.length,
    totalPoints,
  });
}

function readinessIssue(code, message, field, questionNumber = undefined) {
  return deepFreeze({ code, message, field, ...(questionNumber === undefined ? {} : { questionNumber }) });
}

export function getPublicationReadiness(input) {
  const draft = normalizeProfessorDraft(input);
  const issues = [];

  if (!draft.title) {
    issues.push(readinessIssue(
      PUBLICATION_READINESS_CODES.TITLE_REQUIRED,
      'Add an examination title before publishing.',
      'title',
    ));
  }
  if (!draft.subject) {
    issues.push(readinessIssue(
      PUBLICATION_READINESS_CODES.SUBJECT_REQUIRED,
      'Add the subject before publishing.',
      'subject',
    ));
  }
  if (!draft.yearLevel) {
    issues.push(readinessIssue(
      PUBLICATION_READINESS_CODES.YEAR_LEVEL_REQUIRED,
      'Add the intended year level before publishing.',
      'yearLevel',
    ));
  }
  if (draft.questions.length === 0) {
    issues.push(readinessIssue(
      PUBLICATION_READINESS_CODES.QUESTION_REQUIRED,
      'Add at least one question before publishing.',
      'questions',
    ));
  }

  for (const question of draft.questions) {
    const prefix = `questions[${question.number - 1}]`;
    if (!question.prompt) {
      issues.push(readinessIssue(
        PUBLICATION_READINESS_CODES.QUESTION_PROMPT_REQUIRED,
        `Add the prompt for question ${question.number} before publishing.`,
        `${prefix}.prompt`,
        question.number,
      ));
    }
    if (question.points <= 0) {
      issues.push(readinessIssue(
        PUBLICATION_READINESS_CODES.QUESTION_POINTS_REQUIRED,
        `Assign more than zero points to question ${question.number} before publishing.`,
        `${prefix}.points`,
        question.number,
      ));
    }
    if (question.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
      const nonemptyChoices = question.choices.filter(Boolean);
      if (question.choices.length < 2 || nonemptyChoices.length !== question.choices.length) {
        issues.push(readinessIssue(
          PUBLICATION_READINESS_CODES.MULTIPLE_CHOICE_OPTIONS_REQUIRED,
          `Add at least two complete answer choices to question ${question.number}.`,
          `${prefix}.choices`,
          question.number,
        ));
      }
      const comparable = nonemptyChoices.map(canonicalComparable);
      if (new Set(comparable).size !== comparable.length) {
        issues.push(readinessIssue(
          PUBLICATION_READINESS_CODES.MULTIPLE_CHOICE_OPTIONS_UNIQUE,
          `Make every answer choice for question ${question.number} different.`,
          `${prefix}.choices`,
          question.number,
        ));
      }
      if (
        question.correctOptionIndex === null ||
        question.correctOptionIndex >= question.choices.length ||
        !question.choices[question.correctOptionIndex]
      ) {
        issues.push(readinessIssue(
          PUBLICATION_READINESS_CODES.MULTIPLE_CHOICE_KEY_REQUIRED,
          `Choose the correct answer for question ${question.number} before publishing.`,
          `${prefix}.correctOptionIndex`,
          question.number,
        ));
      }
    }
  }

  return deepFreeze({ ready: issues.length === 0, issues, draft });
}

function normalizeSha256Hash(value, field = 'publicationHash') {
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 64,
    required: true,
    code: ERROR_CODES.PUBLICATION_HASH_INVALID,
    label: 'published examination fingerprint',
  });
  if (!SHA256_PATTERN.test(normalized)) {
    fail(
      ERROR_CODES.PUBLICATION_HASH_INVALID,
      'Use the complete SHA-256 fingerprint for the published examination and try again.',
      { field },
    );
  }
  return normalized.toLowerCase();
}

export function buildPublicationVersion(input) {
  const allowed = new Set(['examinationId', 'version', 'publishedAt', 'draft']);
  assertAllowedFields(input, allowed, 'publication');
  const examinationId = normalizeOpaqueId(input.examinationId, 'publication.examinationId', 'examination identifier');
  const version = normalizePositiveInteger(
    input.version,
    'publication.version',
    ERROR_CODES.PUBLICATION_MANIFEST_INVALID,
    { min: 1, max: 1_000_000, label: 'the publication version' },
  );
  const publishedAt = normalizeIsoInstant(input.publishedAt, 'publication.publishedAt');
  const readiness = getPublicationReadiness(input.draft);
  if (!readiness.ready) {
    fail(
      ERROR_CODES.PUBLICATION_NOT_READY,
      'Finish the listed examination details before publishing.',
      { issues: readiness.issues },
    );
  }
  const draft = readiness.draft;
  const manifest = deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.PUBLICATION,
    examinationId,
    version,
    publishedAt,
    title: draft.title,
    subject: draft.subject,
    yearLevel: draft.yearLevel,
    instructions: draft.instructions,
    identityMode: draft.identityMode,
    integrityTier: draft.integrityTier,
    privacyNoticeVersion: draft.privacyNoticeVersion,
    questions: draft.questions.map((question) => ({ ...question })),
    questionCount: draft.questionCount,
    totalPoints: draft.totalPoints,
  });
  return deepFreeze({ manifest, hashInput: canonicalizeForHash(manifest) });
}

export function normalizePublicationManifest(input) {
  const allowed = new Set([
    'schemaVersion',
    'examinationId',
    'version',
    'publishedAt',
    'title',
    'subject',
    'yearLevel',
    'instructions',
    'identityMode',
    'integrityTier',
    'privacyNoticeVersion',
    'questions',
    'questionCount',
    'totalPoints',
  ]);
  assertAllowedFields(input, allowed, 'publicationManifest');
  if (input.schemaVersion !== SCHEMA_VERSIONS.PUBLICATION) {
    fail(
      ERROR_CODES.PUBLICATION_MANIFEST_INVALID,
      'Reload the published examination because its version format is not supported.',
      { field: 'publicationManifest.schemaVersion' },
    );
  }
  const rebuilt = buildPublicationVersion({
    examinationId: input.examinationId,
    version: input.version,
    publishedAt: input.publishedAt,
    draft: {
      title: input.title,
      subject: input.subject,
      yearLevel: input.yearLevel,
      instructions: input.instructions,
      identityMode: input.identityMode,
      integrityTier: input.integrityTier,
      privacyNoticeVersion: input.privacyNoticeVersion,
      questions: input.questions,
      questionCount: input.questionCount,
      totalPoints: input.totalPoints,
    },
  });
  return rebuilt.manifest;
}

export function buildStudentExaminationView(input) {
  const manifest = normalizePublicationManifest(input);
  return deepFreeze({
    schemaVersion: manifest.schemaVersion,
    examinationId: manifest.examinationId,
    version: manifest.version,
    title: manifest.title,
    subject: manifest.subject,
    yearLevel: manifest.yearLevel,
    instructions: manifest.instructions,
    identityMode: manifest.identityMode,
    integrityTier: manifest.integrityTier,
    privacyNoticeVersion: manifest.privacyNoticeVersion,
    questions: manifest.questions.map((question) => ({
      number: question.number,
      key: question.key,
      type: question.type,
      prompt: question.prompt,
      points: question.points,
      wordLimit: question.wordLimit,
      choices: [...question.choices],
    })),
    questionCount: manifest.questionCount,
    totalPoints: manifest.totalPoints,
  });
}

export function canonicalizeForHash(value) {
  const ancestors = new Set();

  function visit(item, field) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        fail(ERROR_CODES.HASH_INPUT_INVALID, `Replace the invalid number at ${field} and try again.`, { field });
      }
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item !== 'object') {
      fail(
        ERROR_CODES.HASH_INPUT_INVALID,
        `Replace the unsupported value at ${field} with text, a number, a boolean, a list, an object, or null.`,
        { field },
      );
    }
    if (ancestors.has(item)) {
      fail(ERROR_CODES.HASH_INPUT_INVALID, `Remove the circular reference at ${field} and try again.`, { field });
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        assertArrayDataEntries(item, field);
        return item.map((entry, index) => visit(entry, `${field}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        fail(ERROR_CODES.HASH_INPUT_INVALID, `Replace ${field} with a plain object and try again.`, { field });
      }
      const output = {};
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== 'string') {
          fail(ERROR_CODES.HASH_INPUT_INVALID, `Remove the unsupported field from ${field} and try again.`, { field });
        }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
          fail(ERROR_CODES.HASH_INPUT_INVALID, `Replace the computed field ${field}.${key} and try again.`, { field: `${field}.${key}` });
        }
      }
      for (const key of Object.keys(item).sort()) output[key] = visit(item[key], `${field}.${key}`);
      return output;
    } finally {
      ancestors.delete(item);
    }
  }

  return JSON.stringify(visit(value, 'hashInput'));
}

function normalizeRoomKeyCharacters(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100 || hasLoneSurrogate(value)) {
    fail(
      ERROR_CODES.ROOM_KEY_FORMAT_INVALID,
      `Enter the room key in ${ROOM_KEY.DISPLAY_PATTERN} format and try again.`,
      { field },
    );
  }
  return value.normalize('NFKC').toUpperCase().replace(/[\s-]+/gu, '');
}

export function computeRoomKeyChecksum(payload) {
  const compact = normalizeRoomKeyCharacters(payload, 'roomKeyPayload');
  const payloadPattern = new RegExp(`^[${ROOM_KEY.ALPHABET}]{${ROOM_KEY.PAYLOAD_LENGTH}}$`, 'u');
  if (!payloadPattern.test(compact)) {
    fail(
      ERROR_CODES.ROOM_KEY_PAYLOAD_INVALID,
      `Use exactly ${ROOM_KEY.PAYLOAD_LENGTH} unambiguous room-key characters supplied by the administrator.`,
      { field: 'roomKeyPayload', expectedLength: ROOM_KEY.PAYLOAD_LENGTH },
    );
  }
  let checksum = 17;
  for (let index = 0; index < compact.length; index += 1) {
    checksum = (checksum + ROOM_KEY.ALPHABET.indexOf(compact[index]) * (index + 1)) % ROOM_KEY.ALPHABET.length;
  }
  return ROOM_KEY.ALPHABET[checksum];
}

export function createRoomKey(payload) {
  const compact = normalizeRoomKeyCharacters(payload, 'roomKeyPayload');
  const checksum = computeRoomKeyChecksum(compact);
  return `${ROOM_KEY.PREFIX}-${compact.slice(0, 4)}-${compact.slice(4)}-${checksum}`;
}

export function normalizeRoomKey(value) {
  const compact = normalizeRoomKeyCharacters(value, 'roomKey');
  const fullPattern = new RegExp(
    `^${ROOM_KEY.PREFIX}([${ROOM_KEY.ALPHABET}]{${ROOM_KEY.PAYLOAD_LENGTH}})([${ROOM_KEY.ALPHABET}])$`,
    'u',
  );
  const match = fullPattern.exec(compact);
  if (!match) {
    fail(
      ERROR_CODES.ROOM_KEY_FORMAT_INVALID,
      `Enter the room key in ${ROOM_KEY.DISPLAY_PATTERN} format. The letters I and O are not used.`,
      { field: 'roomKey' },
    );
  }
  const [, payload, suppliedChecksum] = match;
  const expectedChecksum = computeRoomKeyChecksum(payload);
  if (suppliedChecksum !== expectedChecksum) {
    fail(
      ERROR_CODES.ROOM_KEY_CHECKSUM_INVALID,
      'Check the room key for a mistyped character and try again.',
      { field: 'roomKey' },
    );
  }
  return `${ROOM_KEY.PREFIX}-${payload.slice(0, 4)}-${payload.slice(4)}-${expectedChecksum}`;
}

export function isValidRoomKey(value) {
  try {
    normalizeRoomKey(value);
    return true;
  } catch (error) {
    if (isExaminationRoomV1Error(error)) return false;
    throw error;
  }
}

export function normalizeStudentIdentity(input) {
  const allowed = new Set(['realName', 'studentNumber', 'subject', 'yearLevel']);
  assertAllowedFields(input, allowed, 'studentIdentity');
  const realName = normalizeSingleLine(input.realName, {
    field: 'studentIdentity.realName',
    maxLength: 200,
    required: true,
    code: ERROR_CODES.STUDENT_IDENTITY_INVALID,
    label: 'the student’s complete real name',
  });
  if (realName.length < 2 || !/\p{L}/u.test(realName)) {
    fail(
      ERROR_CODES.STUDENT_IDENTITY_INVALID,
      'Enter the student’s complete real name and try again.',
      { field: 'studentIdentity.realName' },
    );
  }
  const studentNumber = normalizeSingleLine(input.studentNumber, {
    field: 'studentIdentity.studentNumber',
    maxLength: 64,
    required: true,
    code: ERROR_CODES.STUDENT_IDENTITY_INVALID,
    label: 'the student number',
  }).toUpperCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{1,63}$/u.test(studentNumber)) {
    fail(
      ERROR_CODES.STUDENT_IDENTITY_INVALID,
      'Enter the student number using letters, numbers, spaces, dots, slashes, underscores, or dashes.',
      { field: 'studentIdentity.studentNumber' },
    );
  }
  const subject = normalizeSingleLine(input.subject, {
    field: 'studentIdentity.subject',
    maxLength: LIMITS.MAX_SUBJECT_LENGTH,
    required: true,
    code: ERROR_CODES.STUDENT_IDENTITY_INVALID,
    label: 'the student’s subject',
  });
  const yearLevel = normalizeSingleLine(input.yearLevel, {
    field: 'studentIdentity.yearLevel',
    maxLength: LIMITS.MAX_YEAR_LEVEL_LENGTH,
    required: true,
    code: ERROR_CODES.STUDENT_IDENTITY_INVALID,
    label: 'the student’s year level',
  });
  return deepFreeze({ realName, studentNumber, subject, yearLevel });
}

function canonicalComparable(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

export function validatePrivacyConsent(input, context) {
  const allowedInput = new Set(['noticeVersion', 'accepted', 'acceptedAt', 'recordingAccepted']);
  const allowedContext = new Set(['requiredNoticeVersion', 'integrityTier']);
  assertAllowedFields(input, allowedInput, 'privacyConsent');
  assertAllowedFields(context, allowedContext, 'privacyConsentContext');
  const requiredNoticeVersion = normalizePrivacyNoticeVersion(context.requiredNoticeVersion, {
    field: 'privacyConsentContext.requiredNoticeVersion',
  });
  const integrityTier = normalizeIntegrityTier(context.integrityTier, 'privacyConsentContext.integrityTier');
  if (input.accepted !== true) {
    fail(
      ERROR_CODES.PRIVACY_CONSENT_REQUIRED,
      'Read and accept the privacy notice before entering or submitting the examination.',
      { field: 'privacyConsent.accepted' },
    );
  }
  const noticeVersion = normalizePrivacyNoticeVersion(input.noticeVersion, {
    field: 'privacyConsent.noticeVersion',
  });
  if (noticeVersion !== requiredNoticeVersion) {
    fail(
      ERROR_CODES.PRIVACY_CONSENT_VERSION_MISMATCH,
      'Review and accept the current privacy notice before continuing.',
      { field: 'privacyConsent.noticeVersion', requiredNoticeVersion },
    );
  }
  if (integrityTier === INTEGRITY_TIERS.RECORDED_PROCTORING && input.recordingAccepted !== true) {
    fail(
      ERROR_CODES.RECORDING_CONSENT_REQUIRED,
      'Accept the recorded-proctoring notice to take this examination, or ask the professor for another arrangement.',
      { field: 'privacyConsent.recordingAccepted' },
    );
  }
  const acceptedAt = normalizeIsoInstant(input.acceptedAt, 'privacyConsent.acceptedAt');
  return deepFreeze({
    noticeVersion,
    accepted: true,
    acceptedAt,
    recordingAccepted: integrityTier === INTEGRITY_TIERS.RECORDED_PROCTORING,
  });
}

function normalizeAnonymousCandidateId(value, field = 'anonymousCandidateId') {
  const normalized = normalizeSingleLine(value, {
    field,
    maxLength: 64,
    required: true,
    code: ERROR_CODES.ANONYMOUS_CANDIDATE_ID_INVALID,
    label: 'anonymous candidate identifier',
  }).toUpperCase();
  if (!ANONYMOUS_ID_PATTERN.test(normalized)) {
    fail(
      ERROR_CODES.ANONYMOUS_CANDIDATE_ID_INVALID,
      'Use the anonymous candidate identifier generated for this examination and try again.',
      { field },
    );
  }
  return normalized;
}

export function buildGradingIdentity(input) {
  const allowed = new Set(['identityMode', 'studentIdentity', 'anonymousCandidateId']);
  assertAllowedFields(input, allowed, 'gradingIdentityRequest');
  const identityMode = normalizeGradingIdentityMode(input.identityMode, 'gradingIdentityRequest.identityMode');
  const studentIdentity = normalizeStudentIdentity(input.studentIdentity);
  if (identityMode === GRADING_IDENTITY_MODES.ANONYMOUS) {
    if (input.anonymousCandidateId === undefined || input.anonymousCandidateId === null || input.anonymousCandidateId === '') {
      fail(
        ERROR_CODES.ANONYMOUS_CANDIDATE_ID_REQUIRED,
        'Generate an anonymous candidate identifier before starting anonymous grading.',
        { field: 'gradingIdentityRequest.anonymousCandidateId' },
      );
    }
    return deepFreeze({
      mode: identityMode,
      anonymousCandidateId: normalizeAnonymousCandidateId(
        input.anonymousCandidateId,
        'gradingIdentityRequest.anonymousCandidateId',
      ),
    });
  }
  return deepFreeze({
    mode: identityMode,
    displayName: studentIdentity.realName,
    studentNumber: studentIdentity.studentNumber,
  });
}

function normalizeAnswerValue(value, question, field) {
  if (value === null || value === undefined) return null;
  if (question.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= question.choices.length) {
      fail(
        ERROR_CODES.ANSWER_VALUE_INVALID,
        `Choose one of the listed answers for question ${question.number} and try again.`,
        { field, questionNumber: question.number },
      );
    }
    return value;
  }
  if (typeof value !== 'string') {
    fail(
      ERROR_CODES.ANSWER_VALUE_INVALID,
      `Enter the answer to question ${question.number} as text and try again.`,
      { field, questionNumber: question.number },
    );
  }
  const maximum = question.type === QUESTION_TYPES.ESSAY
    ? LIMITS.MAX_ESSAY_ANSWER_LENGTH
    : LIMITS.MAX_SHORT_ANSWER_LENGTH;
  return normalizeAnswerText(value, field, maximum);
}

export function normalizeAnswerRevision(input, context) {
  const inputFields = new Set([
    'attemptId',
    'questionNumber',
    'revision',
    'idempotencyKey',
    'answer',
    'questionKey',
    'questionType',
    'examinationId',
    'examinationVersion',
    'publicationHash',
    'idempotencyInput',
  ]);
  const contextFields = new Set(['versionManifest', 'publicationHash']);
  assertAllowedFields(input, inputFields, 'answerRevision');
  assertAllowedFields(context, contextFields, 'answerRevisionContext');
  const manifest = normalizePublicationManifest(context.versionManifest);
  const publicationHash = normalizeSha256Hash(context.publicationHash, 'answerRevisionContext.publicationHash');
  const attemptId = normalizeOpaqueId(input.attemptId, 'answerRevision.attemptId', 'attempt identifier');
  const questionNumber = normalizePositiveInteger(
    input.questionNumber,
    'answerRevision.questionNumber',
    ERROR_CODES.ANSWER_REVISION_INVALID,
    { min: 1, max: LIMITS.MAX_QUESTIONS, label: 'the question number' },
  );
  const question = manifest.questions.find((candidate) => candidate.number === questionNumber);
  if (!question) {
    fail(
      ERROR_CODES.ANSWER_QUESTION_NOT_FOUND,
      'Reload the examination and choose an available question before saving the answer.',
      { field: 'answerRevision.questionNumber', questionNumber },
    );
  }
  const revision = normalizePositiveInteger(
    input.revision,
    'answerRevision.revision',
    ERROR_CODES.ANSWER_REVISION_INVALID,
    { min: 1, max: 1_000_000_000, label: 'the answer revision' },
  );
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, 'answerRevision.idempotencyKey');
  const answer = normalizeAnswerValue(input.answer, question, 'answerRevision.answer');
  const payload = {
    attemptId,
    examinationId: manifest.examinationId,
    examinationVersion: manifest.version,
    publicationHash,
    questionNumber,
    questionKey: question.key,
    questionType: question.type,
    revision,
    idempotencyKey,
    answer,
  };
  const idempotencyInput = canonicalizeForHash({
    attemptId,
    examinationId: manifest.examinationId,
    examinationVersion: manifest.version,
    publicationHash,
    questionNumber,
    questionKey: question.key,
    questionType: question.type,
    revision,
    answer,
  });

  const derivedChecks = {
    questionKey: payload.questionKey,
    questionType: payload.questionType,
    examinationId: payload.examinationId,
    examinationVersion: payload.examinationVersion,
    publicationHash: payload.publicationHash,
    idempotencyInput,
  };
  for (const [key, expected] of Object.entries(derivedChecks)) {
    if (hasOwn(input, key) && input[key] !== expected) {
      fail(
        ERROR_CODES.ANSWER_BINDING_MISMATCH,
        'Reload the examination before saving this answer because its version details changed.',
        { field: `answerRevision.${key}`, questionNumber },
      );
    }
  }
  return deepFreeze({ ...payload, idempotencyInput });
}

function hasCompleteAnswer(answerRevision) {
  if (answerRevision.questionType === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return Number.isSafeInteger(answerRevision.answer);
  }
  return typeof answerRevision.answer === 'string' && answerRevision.answer.trim().length > 0;
}

export function buildSubmissionManifest(input) {
  const allowed = new Set([
    'submissionId',
    'attemptId',
    'idempotencyKey',
    'submittedAt',
    'versionManifest',
    'publicationHash',
    'studentIdentity',
    'privacyConsent',
    'answerRevisions',
    'anonymousCandidateId',
  ]);
  assertAllowedFields(input, allowed, 'submission');
  const versionManifest = normalizePublicationManifest(input.versionManifest);
  const publicationHash = normalizeSha256Hash(input.publicationHash, 'submission.publicationHash');
  const submissionId = normalizeOpaqueId(input.submissionId, 'submission.submissionId', 'submission identifier');
  const attemptId = normalizeOpaqueId(input.attemptId, 'submission.attemptId', 'attempt identifier');
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, 'submission.idempotencyKey');
  const submittedAt = normalizeIsoInstant(input.submittedAt, 'submission.submittedAt');
  const studentIdentity = normalizeStudentIdentity(input.studentIdentity);

  if (canonicalComparable(studentIdentity.subject) !== canonicalComparable(versionManifest.subject)) {
    fail(
      ERROR_CODES.STUDENT_SUBJECT_MISMATCH,
      'Confirm the examination subject in the student details and try again.',
      { field: 'submission.studentIdentity.subject' },
    );
  }
  if (canonicalComparable(studentIdentity.yearLevel) !== canonicalComparable(versionManifest.yearLevel)) {
    fail(
      ERROR_CODES.STUDENT_YEAR_LEVEL_MISMATCH,
      'Confirm the examination year level in the student details and try again.',
      { field: 'submission.studentIdentity.yearLevel' },
    );
  }

  const privacyConsent = validatePrivacyConsent(input.privacyConsent, {
    requiredNoticeVersion: versionManifest.privacyNoticeVersion,
    integrityTier: versionManifest.integrityTier,
  });
  const gradingIdentity = buildGradingIdentity({
    identityMode: versionManifest.identityMode,
    studentIdentity,
    anonymousCandidateId: input.anonymousCandidateId,
  });

  if (!Array.isArray(input.answerRevisions)) {
    fail(
      ERROR_CODES.ANSWER_REVISION_INVALID,
      'Provide the saved answer revisions as a list and try again.',
      { field: 'submission.answerRevisions' },
    );
  }
  assertArrayDataEntries(input.answerRevisions, 'submission.answerRevisions');
  const idempotencyInputs = new Map();
  const revisionsByQuestion = new Map();
  for (let index = 0; index < input.answerRevisions.length; index += 1) {
    const revision = normalizeAnswerRevision(input.answerRevisions[index], {
      versionManifest,
      publicationHash,
    });
    if (revision.attemptId !== attemptId) {
      fail(
        ERROR_CODES.ANSWER_BINDING_MISMATCH,
        'Reload this examination attempt before submitting because an answer belongs to another attempt.',
        { field: `submission.answerRevisions[${index}].attemptId`, questionNumber: revision.questionNumber },
      );
    }
    const priorIdempotencyInput = idempotencyInputs.get(revision.idempotencyKey);
    if (priorIdempotencyInput !== undefined && priorIdempotencyInput !== revision.idempotencyInput) {
      fail(
        ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
        'Save the changed answer with a new request key and try again.',
        { field: `submission.answerRevisions[${index}].idempotencyKey` },
      );
    }
    idempotencyInputs.set(revision.idempotencyKey, revision.idempotencyInput);

    let questionRevisions = revisionsByQuestion.get(revision.questionNumber);
    if (!questionRevisions) {
      questionRevisions = new Map();
      revisionsByQuestion.set(revision.questionNumber, questionRevisions);
    }
    const priorRevision = questionRevisions.get(revision.revision);
    if (priorRevision && priorRevision.idempotencyInput !== revision.idempotencyInput) {
      fail(
        ERROR_CODES.ANSWER_REVISION_CONFLICT,
        `Save question ${revision.questionNumber} again so it has a new revision number.`,
        { field: `submission.answerRevisions[${index}].revision`, questionNumber: revision.questionNumber },
      );
    }
    if (!priorRevision) questionRevisions.set(revision.revision, revision);
  }

  const questions = versionManifest.questions.map((question) => {
    const revisions = revisionsByQuestion.get(question.number);
    let selected = null;
    if (revisions) {
      for (const candidate of revisions.values()) {
        if (!selected || candidate.revision > selected.revision) selected = candidate;
      }
    }
    if (!selected || !hasCompleteAnswer(selected)) {
      fail(
        ERROR_CODES.SUBMISSION_ANSWER_MISSING,
        `Answer question ${question.number} before submitting the examination.`,
        { field: 'submission.answerRevisions', questionNumber: question.number },
      );
    }
    return {
      questionNumber: question.number,
      questionKey: question.key,
      type: question.type,
      prompt: question.prompt,
      choices: [...question.choices],
      maxPoints: question.points,
      revision: selected.revision,
      answer: selected.answer,
    };
  });

  const manifest = deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.SUBMISSION,
    submissionId,
    attemptId,
    idempotencyKey,
    examinationId: versionManifest.examinationId,
    examinationVersion: versionManifest.version,
    publicationHash,
    submittedAt,
    title: versionManifest.title,
    subject: versionManifest.subject,
    yearLevel: versionManifest.yearLevel,
    identityMode: versionManifest.identityMode,
    integrityTier: versionManifest.integrityTier,
    privacyNoticeVersion: versionManifest.privacyNoticeVersion,
    privacyConsent,
    studentIdentity,
    gradingIdentity,
    questions,
    questionCount: questions.length,
    maxPoints: versionManifest.totalPoints,
  });
  return deepFreeze({ manifest, hashInput: canonicalizeForHash(manifest) });
}

function normalizeSubmissionQuestion(input, index) {
  const allowed = new Set([
    'questionNumber',
    'questionKey',
    'type',
    'prompt',
    'choices',
    'maxPoints',
    'revision',
    'answer',
  ]);
  const field = `submissionManifest.questions[${index}]`;
  assertAllowedFields(input, allowed, field);
  const number = index + 1;
  if (input.questionNumber !== number || input.questionKey !== `q${String(number).padStart(3, '0')}`) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its question order is invalid.',
      { field, questionNumber: number },
    );
  }
  const type = normalizeQuestionType(input.type, `${field}.type`);
  const prompt = normalizeFreeText(input.prompt, {
    field: `${field}.prompt`,
    maxLength: LIMITS.MAX_PROMPT_LENGTH,
    required: true,
  });
  const maxPoints = normalizePointValue(input.maxPoints, {
    field: `${field}.maxPoints`,
    code: ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
    label: 'maximum points',
  });
  const revision = normalizePositiveInteger(
    input.revision,
    `${field}.revision`,
    ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
    { label: 'the answer revision' },
  );
  let choices = [];
  if (!Array.isArray(input.choices) || input.choices.length > LIMITS.MAX_CHOICES) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      `Reload question ${number} because its answer choices are invalid.`,
      { field: `${field}.choices`, questionNumber: number },
    );
  }
  assertArrayDataEntries(input.choices, `${field}.choices`);
  choices = input.choices.map((choice, choiceIndex) => normalizeSingleLine(choice, {
    field: `${field}.choices[${choiceIndex}]`,
    maxLength: LIMITS.MAX_CHOICE_LENGTH,
  }));
  if (type !== QUESTION_TYPES.MULTIPLE_CHOICE && choices.length > 0) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      `Reload question ${number} because its answer choices do not match its type.`,
      { field: `${field}.choices`, questionNumber: number },
    );
  }
  const questionShape = { number, type, choices };
  const answer = normalizeAnswerValue(input.answer, questionShape, `${field}.answer`);
  if (!hasCompleteAnswer({ questionType: type, answer })) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      `Reload the submission because question ${number} has no final answer.`,
      { field: `${field}.answer`, questionNumber: number },
    );
  }
  return deepFreeze({
    questionNumber: number,
    questionKey: `q${String(number).padStart(3, '0')}`,
    type,
    prompt,
    choices,
    maxPoints,
    revision,
    answer,
  });
}

function normalizeStoredGradingIdentity(input, identityMode, studentIdentity) {
  const allowed = identityMode === GRADING_IDENTITY_MODES.ANONYMOUS
    ? new Set(['mode', 'anonymousCandidateId'])
    : new Set(['mode', 'displayName', 'studentNumber']);
  assertAllowedFields(input, allowed, 'submissionManifest.gradingIdentity');
  if (input.mode !== identityMode) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its grading identity setting does not match the examination.',
      { field: 'submissionManifest.gradingIdentity.mode' },
    );
  }
  if (identityMode === GRADING_IDENTITY_MODES.ANONYMOUS) {
    return deepFreeze({
      mode: identityMode,
      anonymousCandidateId: normalizeAnonymousCandidateId(
        input.anonymousCandidateId,
        'submissionManifest.gradingIdentity.anonymousCandidateId',
      ),
    });
  }
  if (input.displayName !== studentIdentity.realName || input.studentNumber !== studentIdentity.studentNumber) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its real-name grading details do not match the student details.',
      { field: 'submissionManifest.gradingIdentity' },
    );
  }
  return deepFreeze({
    mode: identityMode,
    displayName: studentIdentity.realName,
    studentNumber: studentIdentity.studentNumber,
  });
}

export function normalizeSubmissionManifest(input) {
  const allowed = new Set([
    'schemaVersion',
    'submissionId',
    'attemptId',
    'idempotencyKey',
    'examinationId',
    'examinationVersion',
    'publicationHash',
    'submittedAt',
    'title',
    'subject',
    'yearLevel',
    'identityMode',
    'integrityTier',
    'privacyNoticeVersion',
    'privacyConsent',
    'studentIdentity',
    'gradingIdentity',
    'questions',
    'questionCount',
    'maxPoints',
  ]);
  assertAllowedFields(input, allowed, 'submissionManifest');
  if (input.schemaVersion !== SCHEMA_VERSIONS.SUBMISSION) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its version format is not supported.',
      { field: 'submissionManifest.schemaVersion' },
    );
  }
  const submissionId = normalizeOpaqueId(input.submissionId, 'submissionManifest.submissionId', 'submission identifier');
  const attemptId = normalizeOpaqueId(input.attemptId, 'submissionManifest.attemptId', 'attempt identifier');
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, 'submissionManifest.idempotencyKey');
  const examinationId = normalizeOpaqueId(input.examinationId, 'submissionManifest.examinationId', 'examination identifier');
  const examinationVersion = normalizePositiveInteger(
    input.examinationVersion,
    'submissionManifest.examinationVersion',
    ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
    { max: 1_000_000, label: 'the examination version' },
  );
  const publicationHash = normalizeSha256Hash(input.publicationHash, 'submissionManifest.publicationHash');
  const submittedAt = normalizeIsoInstant(input.submittedAt, 'submissionManifest.submittedAt');
  const title = normalizeSingleLine(input.title, {
    field: 'submissionManifest.title',
    maxLength: LIMITS.MAX_TITLE_LENGTH,
    required: true,
  });
  const subject = normalizeSingleLine(input.subject, {
    field: 'submissionManifest.subject',
    maxLength: LIMITS.MAX_SUBJECT_LENGTH,
    required: true,
  });
  const yearLevel = normalizeSingleLine(input.yearLevel, {
    field: 'submissionManifest.yearLevel',
    maxLength: LIMITS.MAX_YEAR_LEVEL_LENGTH,
    required: true,
  });
  const identityMode = normalizeGradingIdentityMode(input.identityMode, 'submissionManifest.identityMode');
  const integrityTier = normalizeIntegrityTier(input.integrityTier, 'submissionManifest.integrityTier');
  const privacyNoticeVersion = normalizePrivacyNoticeVersion(input.privacyNoticeVersion, {
    field: 'submissionManifest.privacyNoticeVersion',
  });
  const privacyConsent = validatePrivacyConsent(input.privacyConsent, {
    requiredNoticeVersion: privacyNoticeVersion,
    integrityTier,
  });
  const studentIdentity = normalizeStudentIdentity(input.studentIdentity);
  if (
    canonicalComparable(studentIdentity.subject) !== canonicalComparable(subject) ||
    canonicalComparable(studentIdentity.yearLevel) !== canonicalComparable(yearLevel)
  ) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its subject or year level does not match the student details.',
      { field: 'submissionManifest.studentIdentity' },
    );
  }
  const gradingIdentity = normalizeStoredGradingIdentity(input.gradingIdentity, identityMode, studentIdentity);
  if (!Array.isArray(input.questions) || input.questions.length === 0 || input.questions.length > LIMITS.MAX_QUESTIONS) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission because its question list is incomplete.',
      { field: 'submissionManifest.questions' },
    );
  }
  assertArrayDataEntries(input.questions, 'submissionManifest.questions');
  const questions = input.questions.map(normalizeSubmissionQuestion);
  const maxPoints = hundredthsToPoints(
    questions.reduce((total, question) => total + pointsToHundredths(question.maxPoints), 0),
  );
  if (input.questionCount !== questions.length || input.maxPoints !== maxPoints) {
    fail(
      ERROR_CODES.SUBMISSION_MANIFEST_INVALID,
      'Reload the submission so its question and point totals can be recalculated.',
      { field: 'submissionManifest.questionCount' },
    );
  }
  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.SUBMISSION,
    submissionId,
    attemptId,
    idempotencyKey,
    examinationId,
    examinationVersion,
    publicationHash,
    submittedAt,
    title,
    subject,
    yearLevel,
    identityMode,
    integrityTier,
    privacyNoticeVersion,
    privacyConsent,
    studentIdentity,
    gradingIdentity,
    questions,
    questionCount: questions.length,
    maxPoints,
  });
}

export function buildGraderSubmissionView(input) {
  const manifest = normalizeSubmissionManifest(input);
  return deepFreeze({
    submissionId: manifest.submissionId,
    examinationId: manifest.examinationId,
    examinationVersion: manifest.examinationVersion,
    publicationHash: manifest.publicationHash,
    submittedAt: manifest.submittedAt,
    title: manifest.title,
    subject: manifest.subject,
    yearLevel: manifest.yearLevel,
    gradingIdentity: manifest.gradingIdentity,
    questions: manifest.questions.map((question) => ({ ...question, choices: [...question.choices] })),
    questionCount: manifest.questionCount,
    maxPoints: manifest.maxPoints,
  });
}

function normalizeGradingStatus(value, field) {
  if (typeof value !== 'string') {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Choose draft or final for the grading revision and try again.',
      { field },
    );
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!Object.values(GRADING_REVISION_STATUSES).includes(normalized)) {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Choose draft or final for the grading revision and try again.',
      { field },
    );
  }
  return normalized;
}

export function buildGradingRevision(input, context) {
  const allowedInput = new Set([
    'revisionId',
    'revision',
    'status',
    'graderId',
    'gradedAt',
    'idempotencyKey',
    'scores',
    'overallFeedback',
  ]);
  const allowedContext = new Set(['submissionManifest']);
  assertAllowedFields(input, allowedInput, 'gradingRevision');
  assertAllowedFields(context, allowedContext, 'gradingRevisionContext');
  const submission = normalizeSubmissionManifest(context.submissionManifest);
  const revisionId = normalizeOpaqueId(input.revisionId, 'gradingRevision.revisionId', 'grading revision identifier');
  const revision = normalizePositiveInteger(
    input.revision,
    'gradingRevision.revision',
    ERROR_CODES.GRADING_REVISION_INVALID,
    { label: 'the grading revision' },
  );
  const status = normalizeGradingStatus(input.status, 'gradingRevision.status');
  const graderId = normalizeOpaqueId(input.graderId, 'gradingRevision.graderId', 'grader identifier');
  const gradedAt = normalizeIsoInstant(input.gradedAt, 'gradingRevision.gradedAt');
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, 'gradingRevision.idempotencyKey');
  const overallFeedback = normalizeFreeText(input.overallFeedback, {
    field: 'gradingRevision.overallFeedback',
    maxLength: LIMITS.MAX_FEEDBACK_LENGTH,
  });
  if (!Array.isArray(input.scores) || input.scores.length > submission.questionCount) {
    fail(
      ERROR_CODES.GRADING_SCORE_INVALID,
      'Provide one score entry for each graded question and try again.',
      { field: 'gradingRevision.scores' },
    );
  }
  assertArrayDataEntries(input.scores, 'gradingRevision.scores');
  const seen = new Set();
  const scores = input.scores.map((rawScore, index) => {
    const field = `gradingRevision.scores[${index}]`;
    const allowed = new Set(['questionNumber', 'pointsAwarded', 'feedback']);
    assertAllowedFields(rawScore, allowed, field);
    const questionNumber = normalizePositiveInteger(
      rawScore.questionNumber,
      `${field}.questionNumber`,
      ERROR_CODES.GRADING_SCORE_INVALID,
      { min: 1, max: submission.questionCount, label: 'the scored question number' },
    );
    if (seen.has(questionNumber)) {
      fail(
        ERROR_CODES.GRADING_SCORE_DUPLICATE,
        `Keep only one score for question ${questionNumber} in this grading revision.`,
        { field: `${field}.questionNumber`, questionNumber },
      );
    }
    seen.add(questionNumber);
    const question = submission.questions[questionNumber - 1];
    const pointsAwarded = normalizePointValue(rawScore.pointsAwarded, {
      field: `${field}.pointsAwarded`,
      allowZero: true,
      max: question.maxPoints,
      code: ERROR_CODES.GRADING_SCORE_INVALID,
      label: `points awarded for question ${questionNumber}`,
    });
    const feedback = normalizeFreeText(rawScore.feedback, {
      field: `${field}.feedback`,
      maxLength: LIMITS.MAX_FEEDBACK_LENGTH,
    });
    return { questionNumber, questionKey: question.questionKey, pointsAwarded, maxPoints: question.maxPoints, feedback };
  }).sort((left, right) => left.questionNumber - right.questionNumber);

  if (status === GRADING_REVISION_STATUSES.FINAL && scores.length !== submission.questionCount) {
    const missingQuestionNumbers = submission.questions
      .filter((question) => !seen.has(question.questionNumber))
      .map((question) => question.questionNumber);
    fail(
      ERROR_CODES.GRADING_INCOMPLETE,
      'Score every question before marking this grading revision final.',
      { field: 'gradingRevision.scores', missingQuestionNumbers },
    );
  }

  const totalPointsAwarded = hundredthsToPoints(
    scores.reduce((total, score) => total + pointsToHundredths(score.pointsAwarded), 0),
  );
  const manifest = deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.GRADING,
    revisionId,
    submissionId: submission.submissionId,
    publicationHash: submission.publicationHash,
    revision,
    status,
    graderId,
    gradedAt,
    idempotencyKey,
    scores,
    scoreCount: scores.length,
    totalPointsAwarded,
    maxPoints: submission.maxPoints,
    overallFeedback,
  });
  return deepFreeze({ manifest, hashInput: canonicalizeForHash(manifest) });
}

export function normalizeGradingRevisionManifest(input, context) {
  const allowed = new Set([
    'schemaVersion',
    'revisionId',
    'submissionId',
    'publicationHash',
    'revision',
    'status',
    'graderId',
    'gradedAt',
    'idempotencyKey',
    'scores',
    'scoreCount',
    'totalPointsAwarded',
    'maxPoints',
    'overallFeedback',
  ]);
  assertAllowedFields(input, allowed, 'gradingRevisionManifest');
  const allowedContext = new Set(['submissionManifest']);
  assertAllowedFields(context, allowedContext, 'gradingRevisionManifestContext');
  if (input.schemaVersion !== SCHEMA_VERSIONS.GRADING) {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Reload the grading revision because its version format is not supported.',
      { field: 'gradingRevisionManifest.schemaVersion' },
    );
  }
  const submission = normalizeSubmissionManifest(context.submissionManifest);
  const publicationHash = normalizeSha256Hash(
    input.publicationHash,
    'gradingRevisionManifest.publicationHash',
  );
  if (input.submissionId !== submission.submissionId || publicationHash !== submission.publicationHash) {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Open the matching submission before using this grading revision.',
      { field: 'gradingRevisionManifest.submissionId' },
    );
  }
  if (!Array.isArray(input.scores)) {
    fail(
      ERROR_CODES.GRADING_SCORE_INVALID,
      'Reload the grading revision because its scores are invalid.',
      { field: 'gradingRevisionManifest.scores' },
    );
  }
  assertArrayDataEntries(input.scores, 'gradingRevisionManifest.scores');
  const scoreFields = new Set(['questionNumber', 'questionKey', 'pointsAwarded', 'maxPoints', 'feedback']);
  const scores = input.scores.map((score, index) => {
    assertAllowedFields(score, scoreFields, `gradingRevisionManifest.scores[${index}]`);
    return {
      questionNumber: score.questionNumber,
      pointsAwarded: score.pointsAwarded,
      feedback: score.feedback,
    };
  });
  const rebuilt = buildGradingRevision({
    revisionId: input.revisionId,
    revision: input.revision,
    status: input.status,
    graderId: input.graderId,
    gradedAt: input.gradedAt,
    idempotencyKey: input.idempotencyKey,
    scores,
    overallFeedback: input.overallFeedback,
  }, { submissionManifest: submission });
  if (
    input.scoreCount !== rebuilt.manifest.scoreCount ||
    input.totalPointsAwarded !== rebuilt.manifest.totalPointsAwarded ||
    input.maxPoints !== rebuilt.manifest.maxPoints
  ) {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Reload the grading revision so its score totals can be recalculated.',
      { field: 'gradingRevisionManifest.totalPointsAwarded' },
    );
  }
  for (let index = 0; index < input.scores.length; index += 1) {
    const score = input.scores[index];
    const rebuiltScore = rebuilt.manifest.scores[index];
    if (score.questionKey !== rebuiltScore.questionKey || score.maxPoints !== rebuiltScore.maxPoints) {
      fail(
        ERROR_CODES.GRADING_REVISION_INVALID,
        `Reload the grading revision because the score for question ${rebuiltScore.questionNumber} is out of date.`,
        { field: `gradingRevisionManifest.scores[${index}]`, questionNumber: rebuiltScore.questionNumber },
      );
    }
  }
  return rebuilt.manifest;
}

export function buildResultRelease(input, context) {
  const allowedInput = new Set([
    'releaseId',
    'selectedRevisionId',
    'releasedAt',
    'releasedBy',
    'idempotencyKey',
  ]);
  const allowedContext = new Set(['submissionManifest', 'gradingRevisions']);
  assertAllowedFields(input, allowedInput, 'resultRelease');
  assertAllowedFields(context, allowedContext, 'resultReleaseContext');
  const submission = normalizeSubmissionManifest(context.submissionManifest);
  if (!Array.isArray(context.gradingRevisions)) {
    fail(
      ERROR_CODES.GRADING_REVISION_INVALID,
      'Provide the available grading revisions as a list and try again.',
      { field: 'resultReleaseContext.gradingRevisions' },
    );
  }
  assertArrayDataEntries(context.gradingRevisions, 'resultReleaseContext.gradingRevisions');
  const seenIds = new Set();
  const seenNumbers = new Set();
  const revisions = context.gradingRevisions.map((entry, index) => {
    let rawManifest = entry;
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      assertPlainRecord(entry, `resultReleaseContext.gradingRevisions[${index}]`);
      if (hasOwn(entry, 'manifest')) {
        assertAllowedFields(
          entry,
          new Set(['manifest', 'hashInput']),
          `resultReleaseContext.gradingRevisions[${index}]`,
        );
        rawManifest = entry.manifest;
      }
    }
    const revision = normalizeGradingRevisionManifest(rawManifest, { submissionManifest: submission });
    if (seenIds.has(revision.revisionId) || seenNumbers.has(revision.revision)) {
      fail(
        ERROR_CODES.RESULT_REVISION_DUPLICATE,
        'Keep only one copy of each grading revision before selecting the result to release.',
        { field: `resultReleaseContext.gradingRevisions[${index}]` },
      );
    }
    seenIds.add(revision.revisionId);
    seenNumbers.add(revision.revision);
    return revision;
  });
  const releaseId = normalizeOpaqueId(input.releaseId, 'resultRelease.releaseId', 'result release identifier');
  const selectedRevisionId = normalizeOpaqueId(
    input.selectedRevisionId,
    'resultRelease.selectedRevisionId',
    'selected grading revision identifier',
  );
  const selected = revisions.find((revision) => revision.revisionId === selectedRevisionId);
  if (!selected) {
    fail(
      ERROR_CODES.RESULT_REVISION_NOT_FOUND,
      'Choose one of the available grading revisions before releasing the result.',
      { field: 'resultRelease.selectedRevisionId' },
    );
  }
  if (selected.status !== GRADING_REVISION_STATUSES.FINAL) {
    fail(
      ERROR_CODES.RESULT_REVISION_NOT_FINAL,
      'Mark the selected grading revision final before releasing the result.',
      { field: 'resultRelease.selectedRevisionId', selectedRevisionId },
    );
  }
  const releasedAt = normalizeIsoInstant(input.releasedAt, 'resultRelease.releasedAt');
  const releasedBy = normalizeOpaqueId(input.releasedBy, 'resultRelease.releasedBy', 'releasing administrator identifier');
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, 'resultRelease.idempotencyKey');
  const manifest = deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.RESULT_RELEASE,
    releaseId,
    submissionId: submission.submissionId,
    publicationHash: submission.publicationHash,
    selectedRevisionId: selected.revisionId,
    selectedRevision: selected.revision,
    releasedAt,
    releasedBy,
    idempotencyKey,
    result: {
      gradedAt: selected.gradedAt,
      scores: selected.scores.map((score) => ({ ...score })),
      totalPointsAwarded: selected.totalPointsAwarded,
      maxPoints: selected.maxPoints,
      overallFeedback: selected.overallFeedback,
    },
  });
  return deepFreeze({ manifest, hashInput: canonicalizeForHash(manifest) });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
