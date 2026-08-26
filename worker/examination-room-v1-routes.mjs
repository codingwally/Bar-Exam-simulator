import {
  ERROR_CODES,
  GRADING_REVISION_STATUSES,
  ROOM_KEY,
  buildGradingRevision,
  buildResultRelease,
  buildStudentExaminationView,
  buildSubmissionManifest,
  createRoomKey,
  getPublicationReadiness,
  isExaminationRoomV1Error,
  normalizeAnswerRevision,
  normalizeProfessorDraft,
  normalizePublicationManifest,
  normalizeRoomKey,
  normalizeStudentIdentity,
  toSafeError,
  validatePrivacyConsent,
} from './examination-room-v1-core.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const INSTITUTION_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/u;
const SESSION_TOKEN_PATTERN = /^ers1_[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_ROSTER_SIZE = 5_000;
const MAX_EVENT_DETAILS_BYTES = 8_000;

const PROFESSOR_QUERY_OPERATIONS = new Set(['role_status', 'session', 'exam', 'monitor', 'grading']);
const PROFESSOR_COMMAND_OPERATIONS = new Set([
  'request_access',
  'save_draft',
  'publish',
  'import_document',
  'open_room',
  'close_room',
  'save_grade',
  'release_results',
]);
const STUDENT_QUERY_OPERATIONS = new Set(['resume', 'result']);
const STUDENT_COMMAND_OPERATIONS = new Set(['save_answer', 'record_event', 'heartbeat', 'submit']);
const ADMIN_QUERY_OPERATIONS = new Set(['access', 'overview', 'staff_directory']);
const ADMIN_COMMAND_OPERATIONS = new Set([
  'bootstrap_institution',
  'assign_staff',
  'revoke_staff',
  'reject_professor_request',
  'activate_exam',
  'email_key',
  'revoke_key',
  'create_snapshot',
]);

const RECOVERY_BY_CODE = Object.freeze({
  [ERROR_CODES.PUBLICATION_NOT_READY]: 'Open Review items, complete every listed field, then publish again.',
  [ERROR_CODES.ROOM_KEY_FORMAT_INVALID]: 'Copy the complete current key from the administrator message and try again.',
  [ERROR_CODES.ROOM_KEY_CHECKSUM_INVALID]: 'Check the key for a mistyped character, then try again.',
  [ERROR_CODES.STUDENT_IDENTITY_INVALID]: 'Use the complete registered name and the student number shown on the school record.',
  [ERROR_CODES.STUDENT_SUBJECT_MISMATCH]: 'Use the subject shown by the professor, then try again.',
  [ERROR_CODES.STUDENT_YEAR_LEVEL_MISMATCH]: 'Use the year level on the examination roster, then try again.',
  [ERROR_CODES.PRIVACY_CONSENT_REQUIRED]: 'Read the notice, choose Agree and begin, then continue.',
  [ERROR_CODES.PRIVACY_CONSENT_VERSION_MISMATCH]: 'Review the current notice shown on screen and agree again.',
  [ERROR_CODES.RECORDING_CONSENT_REQUIRED]: 'Agree to recording or ask the professor for another permitted arrangement.',
  [ERROR_CODES.SUBMISSION_ANSWER_MISSING]: 'Return to the listed question, enter an answer, wait for Saved, then submit again.',
  [ERROR_CODES.GRADING_INCOMPLETE]: 'Score every question before releasing this result.',
});

export class ExaminationRoomV1RouteError extends Error {
  constructor(code, message, status = 400, recovery = '', details = undefined) {
    super(message);
    this.name = 'ExaminationRoomV1RouteError';
    this.code = code;
    this.status = status;
    this.recovery = recovery;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, status = 400, recovery = '', details = undefined) {
  throw new ExaminationRoomV1RouteError(code, message, status, recovery, details);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecord(value, field = 'request') {
  if (!isPlainRecord(value)) {
    fail(
      'EXAM_ROOM_V1_REQUEST_INVALID',
      `Provide ${field} as an object with named fields.`,
      400,
      'Refresh the page and try the action again.',
    );
  }
  return value;
}

function cleanText(value, maximum, field, options = {}) {
  const { required = false, singleLine = true } = options;
  if (value === undefined || value === null) {
    if (required) fail('EXAM_ROOM_V1_FIELD_REQUIRED', `Enter ${field} and try again.`, 400, `Complete ${field}, then retry.`);
    return '';
  }
  if (typeof value !== 'string') {
    fail('EXAM_ROOM_V1_FIELD_INVALID', `Enter ${field} as text and try again.`, 400, `Correct ${field}, then retry.`);
  }
  const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n');
  const cleaned = singleLine ? normalized.replace(/\s+/gu, ' ').trim() : normalized.trim();
  if (required && !cleaned) {
    fail('EXAM_ROOM_V1_FIELD_REQUIRED', `Enter ${field} and try again.`, 400, `Complete ${field}, then retry.`);
  }
  if (cleaned.length > maximum) {
    fail(
      'EXAM_ROOM_V1_FIELD_TOO_LONG',
      `${field} is too long. Shorten it to ${maximum.toLocaleString('en-US')} characters or fewer.`,
      400,
      `Shorten ${field}, then retry.`,
    );
  }
  if (/\p{C}/u.test(cleaned.replace(/\n|\t/gu, ''))) {
    fail('EXAM_ROOM_V1_FIELD_INVALID', `Remove hidden characters from ${field} and try again.`, 400, `Correct ${field}, then retry.`);
  }
  return cleaned;
}

function uuid(value, field) {
  const normalized = cleanText(value, 64, field, { required: true }).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    fail('EXAM_ROOM_V1_IDENTIFIER_INVALID', `Reload the page because ${field} is invalid.`, 400, 'Refresh the page, then try again.');
  }
  return normalized;
}

function profileSchoolId(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
  if (!/^[a-z0-9][a-z0-9-]{1,179}$/u.test(normalized)) {
    fail(
      'EXAM_ROOM_V1_INSTITUTION_PROFILE_ID_INVALID',
      'The law-school name could not be matched to Professor account profiles.',
      400,
      'Use the complete law-school name shown in the Professor account setup list, then try again.',
    );
  }
  return normalized;
}

function requestKey(value) {
  const normalized = cleanText(value, 128, 'request key', { required: true });
  if (!REQUEST_KEY_PATTERN.test(normalized)) {
    fail(
      'EXAM_ROOM_V1_REQUEST_KEY_INVALID',
      'Refresh the page so a new request key can be created.',
      400,
      'Refresh the page, then repeat the action once.',
    );
  }
  return normalized;
}

function positiveInteger(value, field, minimum, maximum, fallback = undefined) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail(
      'EXAM_ROOM_V1_NUMBER_INVALID',
      `Enter ${field} as a whole number from ${minimum} to ${maximum}.`,
      400,
      `Correct ${field}, then try again.`,
    );
  }
  return candidate;
}

function booleanValue(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function isoInstant(value, field, options = {}) {
  const { required = true } = options;
  if ((value === undefined || value === null || value === '') && !required) return null;
  const normalized = cleanText(value, 40, field, { required: true });
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    fail('EXAM_ROOM_V1_TIME_INVALID', `Enter a valid date and time for ${field}.`, 400, `Correct ${field}, then try again.`);
  }
  return date.toISOString();
}

function normalizedQuestionInput(question, index) {
  plainRecord(question, `question ${index + 1}`);
  const type = String(question.type || 'essay').trim().toLowerCase().replace(/[\s_]+/gu, '-');
  const choices = Array.isArray(question.choices)
    ? question.choices
    : Array.isArray(question.options)
      ? question.options
      : [];
  const coreQuestion = {
    type,
    prompt: question.prompt ?? '',
    points: question.points ?? 0,
    gradingGuidance: question.gradingGuidance ?? '',
  };
  if (type === 'essay') {
    if (Number.isSafeInteger(question.wordLimit) && question.wordLimit > 0) coreQuestion.wordLimit = question.wordLimit;
  } else if (type === 'multiple-choice') {
    coreQuestion.choices = choices;
    coreQuestion.correctOptionIndex = question.correctOptionIndex ?? question.correctOption ?? null;
  } else if (type === 'short-answer') {
    coreQuestion.acceptedAnswers = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
  }
  return coreQuestion;
}

export function professorDraftFromClientExam(rawExam) {
  const exam = plainRecord(rawExam, 'examination');
  const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
  return normalizeProfessorDraft({
    title: exam.title ?? '',
    subject: exam.subject ?? '',
    yearLevel: exam.yearLevel ?? '',
    instructions: exam.instructions ?? '',
    identityMode: exam.identityMode ?? exam.gradingIdentity ?? 'real_names',
    integrityTier: exam.integrityTier ?? 'standard',
    privacyNoticeVersion: exam.privacyNoticeVersion ?? null,
    questions: rawQuestions.map(normalizedQuestionInput),
  });
}

function normalizeRoster(rawRoster, subject, defaultYearLevel) {
  if (rawRoster === undefined || rawRoster === null) return [];
  if (!Array.isArray(rawRoster) || rawRoster.length > MAX_ROSTER_SIZE) {
    fail(
      'EXAM_ROOM_V1_ROSTER_INVALID',
      `Provide a roster with no more than ${MAX_ROSTER_SIZE.toLocaleString('en-US')} students.`,
      400,
      'Correct the roster, then try again.',
    );
  }
  const seen = new Set();
  return rawRoster.map((entry, index) => {
    plainRecord(entry, `roster student ${index + 1}`);
    const studentNumber = cleanText(entry.studentNumber, 64, `student number for roster row ${index + 1}`, { required: true }).toUpperCase();
    if (seen.has(studentNumber)) {
      fail(
        'EXAM_ROOM_V1_ROSTER_DUPLICATE',
        `Student number ${studentNumber} appears more than once in the roster.`,
        400,
        'Keep one roster row for that student, then try again.',
      );
    }
    seen.add(studentNumber);
    const fullName = cleanText(entry.fullName ?? entry.realName, 240, `full name for roster row ${index + 1}`, { required: true });
    const email = cleanText(entry.email, 320, `email for roster row ${index + 1}`, { required: true }).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      fail('EXAM_ROOM_V1_ROSTER_EMAIL_INVALID', `Enter a valid email for ${fullName}.`, 400, 'Correct the roster email, then try again.');
    }
    return {
      clientId: cleanText(entry.id, 128, `roster row ${index + 1} identifier`) || null,
      fullName,
      studentNumber,
      email,
      subject,
      yearLevel: cleanText(entry.yearLevel ?? defaultYearLevel, 64, `year level for ${fullName}`, { required: true }),
      extraMinutes: positiveInteger(entry.extraMinutes, `extra minutes for ${fullName}`, 0, 1_440, 0),
    };
  });
}

function persistenceQuestion(question) {
  return {
    questionNumber: question.number,
    questionKey: question.key,
    questionKind: question.type.replaceAll('-', '_'),
    type: question.type,
    prompt: question.prompt,
    points: question.points,
    gradingGuidance: question.gradingGuidance,
    wordLimit: question.wordLimit,
    choices: question.choices,
    correctOptionIndex: question.correctOptionIndex,
    acceptedAnswers: question.acceptedAnswers,
  };
}

function persistenceDraft(draft) {
  return {
    title: draft.title,
    subject: draft.subject,
    yearLevel: draft.yearLevel,
    instructions: draft.instructions,
    identityMode: draft.identityMode,
    integrityTier: draft.integrityTier,
    privacyNoticeVersion: draft.privacyNoticeVersion,
    questions: draft.questions.map(persistenceQuestion),
    questionCount: draft.questionCount,
    totalPoints: draft.totalPoints,
  };
}

function operationalExam(rawExam, draft) {
  const exam = plainRecord(rawExam, 'examination');
  const startsAt = isoInstant(exam.startsAt, 'the examination start', { required: false });
  return {
    examId: exam.id ? uuid(exam.id, 'the examination identifier') : null,
    title: draft.title,
    subject: draft.subject,
    yearLevel: draft.yearLevel,
    instructions: draft.instructions,
    jurisdiction: cleanText(exam.jurisdiction ?? 'Philippines', 120, 'jurisdiction'),
    durationMinutes: positiveInteger(exam.durationMinutes, 'duration', 1, 1_440, 120),
    startsAt,
    lateSubmissions: ['not_allowed', 'professor_review'].includes(exam.lateSubmissions)
      ? exam.lateSubmissions
      : 'not_allowed',
    navigation: ['free', 'sequential'].includes(exam.navigation) ? exam.navigation : 'free',
    identityMode: draft.identityMode,
    integrityTier: draft.integrityTier,
    cameraRequired: booleanValue(exam.cameraRequired),
    microphoneRequired: booleanValue(exam.microphoneRequired),
    privacyNoticeVersion: draft.privacyNoticeVersion,
    privacyController: cleanText(exam.privacyController, 1_000, 'privacy controller'),
    retentionSummary: cleanText(exam.retentionSummary, 2_000, 'retention summary'),
    sourceFileName: cleanText(exam.sourceFileName, 255, 'source file name'),
    sourceFileSize: exam.sourceFileSize == null
      ? null
      : positiveInteger(exam.sourceFileSize, 'source file size', 0, MAX_DOCUMENT_BYTES),
    questions: draft.questions.map(persistenceQuestion),
    roster: normalizeRoster(exam.roster, draft.subject, draft.yearLevel),
  };
}

function studentIdentityFromPayload(payload) {
  const source = isPlainRecord(payload.identity) ? payload.identity : payload;
  return normalizeStudentIdentity({
    realName: source.realName ?? source.fullName,
    studentNumber: source.studentNumber,
    subject: source.subject ?? payload.subject,
    yearLevel: source.yearLevel ?? payload.yearLevel,
  });
}

function publicPreview(metadata) {
  const source = plainRecord(metadata, 'examination preview');
  return {
    examId: uuid(source.examId, 'the examination identifier'),
    title: cleanText(source.title, 300, 'examination title', { required: true }),
    subject: cleanText(source.subject, 160, 'subject', { required: true }),
    yearLevel: cleanText(source.yearLevel, 64, 'year level', { required: true }),
    durationMinutes: positiveInteger(source.durationMinutes, 'duration', 1, 1_440),
    startsAt: isoInstant(source.startsAt, 'the examination start', { required: false }),
    professor: cleanText(source.professor, 240, 'professor'),
    questionCount: positiveInteger(source.questionCount, 'question count', 1, 200),
    integrityTier: ['standard', 'focus_monitoring', 'recorded_proctoring'].includes(source.integrityTier)
      ? source.integrityTier
      : 'standard',
    cameraRequired: booleanValue(source.cameraRequired),
    microphoneRequired: booleanValue(source.microphoneRequired),
    privacyNoticeVersion: cleanText(source.privacyNoticeVersion, 64, 'privacy notice version', { required: true }),
    privacyController: cleanText(source.privacyController, 1_000, 'privacy controller'),
    retentionSummary: cleanText(source.retentionSummary, 2_000, 'retention summary'),
    activationStatus: ['scheduled', 'open'].includes(source.activationStatus) ? source.activationStatus : 'open',
    safeguards: Array.isArray(source.safeguards)
      ? source.safeguards.slice(0, 12).map((item) => cleanText(item, 240, 'safeguard')).filter(Boolean)
      : [],
  };
}

function safeEventDetails(value, field = 'details', depth = 0) {
  if (depth > 5) fail('EXAM_ROOM_V1_EVENT_INVALID', 'The event details are too deeply nested.', 400, 'Refresh the examination and continue.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry, index) => safeEventDetails(entry, `${field}[${index}]`, depth + 1));
  if (!isPlainRecord(value)) {
    fail('EXAM_ROOM_V1_EVENT_INVALID', 'The event details are invalid.', 400, 'Refresh the examination and continue.');
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:^|_)(?:key|token|secret|password|authorization)(?:$|_)/iu.test(key) || /room.?key|session.?token/iu.test(key)) {
      fail(
        'EXAM_ROOM_V1_SECRET_FIELD_REJECTED',
        'Sensitive credentials cannot be included in examination event details.',
        400,
        'Refresh the examination and continue; saved answers are unaffected.',
      );
    }
    result[cleanText(key, 80, field, { required: true })] = safeEventDetails(entry, `${field}.${key}`, depth + 1);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_EVENT_DETAILS_BYTES) {
    fail('EXAM_ROOM_V1_EVENT_TOO_LARGE', 'The event details are too large.', 413, 'Refresh the examination and continue; saved answers are unaffected.');
  }
  return result;
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uuidFromHash(hash) {
  const normalized = String(hash || '').toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) fail('EXAM_ROOM_V1_CRYPTO_UNAVAILABLE', 'A secure request identifier could not be created.', 503, 'Wait briefly, then try again.');
  const compact = normalized.slice(0, 32).split('');
  compact[12] = '4';
  compact[16] = ['8', '9', 'a', 'b'][Number.parseInt(compact[16], 16) % 4];
  const value = compact.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertNoPlainSecret(value, secrets, path = 'payload') {
  if (typeof value === 'string') {
    if (secrets.some((secret) => secret && value.includes(secret))) {
      fail('EXAM_ROOM_V1_INTERNAL_SECRET_LEAK', 'The secure request could not be completed.', 500, 'Try again. If it continues, contact support.');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPlainSecret(entry, secrets, `${path}[${index}]`));
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, entry] of Object.entries(value)) assertNoPlainSecret(entry, secrets, `${path}.${key}`);
  }
}

function domainRouteError(error) {
  if (!isExaminationRoomV1Error(error)) return null;
  const safe = toSafeError(error);
  const conflictCodes = new Set([
    ERROR_CODES.PUBLICATION_NOT_READY,
    ERROR_CODES.ANSWER_REVISION_CONFLICT,
    ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
    ERROR_CODES.ANSWER_BINDING_MISMATCH,
  ]);
  const preconditionCodes = new Set([
    ERROR_CODES.PRIVACY_CONSENT_REQUIRED,
    ERROR_CODES.PRIVACY_CONSENT_VERSION_MISMATCH,
    ERROR_CODES.RECORDING_CONSENT_REQUIRED,
  ]);
  return new ExaminationRoomV1RouteError(
    safe.code,
    safe.message,
    conflictCodes.has(safe.code) ? 409 : preconditionCodes.has(safe.code) ? 412 : 400,
    RECOVERY_BY_CODE[safe.code] || 'Correct the highlighted information, then try again.',
    safe.details,
  );
}

function dependencyRouteError(error) {
  if (!error || typeof error !== 'object' || typeof error.code !== 'string') return null;
  const mappings = {
    INVALID_JSON: ['EXAM_ROOM_V1_INVALID_JSON', 'The request could not be read.', 400, 'Refresh the page, then try the action again.'],
    REQUEST_TOO_LARGE: ['EXAM_ROOM_V1_REQUEST_TOO_LARGE', 'The request is too large.', 413, 'Reduce the upload or examination size, then try again.'],
    INVALID_SESSION: ['EXAM_ROOM_V1_SESSION_INVALID', 'Your sign-in session is no longer valid.', 401, 'Sign in again, then reopen Examination Room.'],
    ADMIN_FORBIDDEN: ['EXAM_ROOM_V1_ADMIN_FORBIDDEN', 'This account cannot administer Examination Room.', 403, 'Sign in with an authorized administrator account.'],
    ADMIN_DATA_UNAVAILABLE: ['EXAM_ROOM_V1_DATA_UNAVAILABLE', 'Examination Room authorization is temporarily unavailable.', 503, 'Wait briefly, then try again.'],
    GUEST_ACCESS_NOT_CONFIGURED: ['EXAM_ROOM_V1_NOT_CONFIGURED', 'Examination Room security is not configured.', 503, 'Contact support and provide the time this message appeared.'],
  };
  const mapped = mappings[error.code];
  if (!mapped) return null;
  return new ExaminationRoomV1RouteError(...mapped);
}

function storeError(result) {
  if (!result || result.ok !== false) return null;
  const error = result.error || {};
  return new ExaminationRoomV1RouteError(
    cleanText(error.code || 'EXAM_ROOM_V1_UNAVAILABLE', 120, 'error code'),
    cleanText(error.message || 'Examination Room could not complete that action.', 1_000, 'error message'),
    Number.isInteger(error.status) ? error.status : 503,
    cleanText(error.recovery || 'Your saved work is preserved. Check the connection, then try again.', 1_000, 'recovery guidance'),
  );
}

function ensureStoreResult(result) {
  const error = storeError(result);
  if (error) throw error;
  if (!isPlainRecord(result)) {
    fail(
      'EXAM_ROOM_V1_UNAVAILABLE',
      'Examination Room returned an incomplete response.',
      503,
      'Your saved work is preserved. Wait briefly, then try again.',
    );
  }
  return result;
}

function authorizationAllowed(value) {
  return isPlainRecord(value) && value.authorized === true;
}

function hasRoleAdmin(value) {
  if (!authorizationAllowed(value)) return false;
  if (['founder_admin', 'super_admin'].includes(value.role)) return true;
  return Array.isArray(value.capabilities) && value.capabilities.includes('role_admin');
}

function hasGlobalRoleAdmin(value) {
  if (!isPlainRecord(value)) return false;
  const globallyAuthorized = value.globalAuthorized === true
    || value.canBootstrap === true
    || value.authorized === true;
  if (!globallyAuthorized) return false;
  if (['founder_admin', 'super_admin'].includes(value.role)) return true;
  return Array.isArray(value.capabilities) && value.capabilities.includes('role_admin');
}

function selectInstitution(authorization, requestedInstitutionId = null, allowedStaffRoles = null) {
  const memberships = Array.isArray(authorization.memberships) ? authorization.memberships : [];
  const allowedRoles = Array.isArray(allowedStaffRoles) && allowedStaffRoles.length
    ? new Set(allowedStaffRoles)
    : null;
  const activeMemberships = memberships.filter((entry) => (
    entry?.active === true
    && entry?.institutionId
    && (!allowedRoles || allowedRoles.has(entry.staffRole))
  ));
  if (requestedInstitutionId) {
    const requested = uuid(requestedInstitutionId, 'the institution identifier');
    const match = activeMemberships.find((entry) => entry.institutionId === requested);
    if (!match) fail('EXAM_ROOM_V1_INSTITUTION_FORBIDDEN', 'You are not assigned to that institution.', 403, 'Choose an institution assigned to your account.');
    return requested;
  }
  const preferred = activeMemberships.find((entry) => entry.institutionId === authorization.institutionId);
  if (!preferred && activeMemberships.length > 1) {
    fail(
      'EXAM_ROOM_V1_INSTITUTION_SELECTION_REQUIRED',
      'Choose the law school for this Examination Room session.',
      409,
      'Select one of your active law-school assignments, then continue.',
      {
        institutions: activeMemberships.map((entry) => ({
          institutionId: entry.institutionId,
          institutionName: entry.institutionName || null,
          institutionCode: entry.institutionCode || null,
          staffRole: entry.staffRole,
        })),
      },
    );
  }
  const primary = preferred?.institutionId || activeMemberships[0]?.institutionId;
  if (!primary) fail('EXAM_ROOM_V1_INSTITUTION_REQUIRED', 'No active law-school assignment is available for this account.', 403, 'Ask an administrator to assign your professor account to the law school.');
  return uuid(primary, 'the institution identifier');
}

export function createExaminationRoomV1Handlers(dependencies) {
  const deps = plainRecord(dependencies, 'route dependencies');
  for (const name of [
    'parseJson',
    'respond',
    'authenticate',
    'authorizeProfessor',
    'authorizeAdmin',
    'rateLimit',
    'rpc',
    'manageStaff',
    'professorAccess',
    'hmacHex',
    'randomBytes',
    'randomUUID',
    'now',
  ]) {
    if (typeof deps[name] !== 'function') throw new TypeError(`Missing Examination Room route dependency: ${name}`);
  }

  async function respondWithErrors(work, origin, allowedOrigin) {
    try {
      return await work();
    } catch (caught) {
      const error = domainRouteError(caught) || dependencyRouteError(caught) || caught;
      const known = error instanceof ExaminationRoomV1RouteError;
      return deps.respond({
        ok: false,
        error: {
          code: known ? error.code : 'EXAM_ROOM_V1_INTERNAL_ERROR',
          message: known
            ? error.message
            : 'Examination Room encountered an unexpected problem.',
          recovery: known
            ? error.recovery
            : 'Your work on this device is preserved. Try again; if it continues, contact support.',
          ...(known && error.details !== undefined ? { details: error.details } : {}),
        },
      }, known ? error.status : 500, origin, allowedOrigin);
    }
  }

  async function professorContext(request, env, requestedInstitutionId = null) {
    const user = await deps.authenticate(request, env);
    if (!user?.id) {
      fail('EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED', 'Professor sign-in is required.', 401, 'Sign in through Due Diligence, then reopen Examination Room.');
    }
    let authorization = await deps.authorizeProfessor(env, user);
    let allowedStaffRoles = ['professor'];
    if (!authorizationAllowed(authorization)) {
      const admin = await deps.authorizeAdmin(env, user).catch(() => null);
      if (hasRoleAdmin(admin)) {
        const memberships = (Array.isArray(admin.memberships) ? admin.memberships : [])
          .filter((entry) => entry?.active === true && entry?.staffRole === 'admin');
        const institutionIds = [...new Set(memberships.map((entry) => entry.institutionId).filter(Boolean))];
        authorization = {
          authorized: true,
          adminTesting: true,
          role: admin.role,
          institutionId: institutionIds.length === 1 ? institutionIds[0] : null,
          memberships,
        };
        allowedStaffRoles = ['admin'];
      }
    }
    if (!authorizationAllowed(authorization)) {
      if (authorization?.professorRoleSelected !== true) {
        fail(
          'EXAM_ROOM_V1_PROFESSOR_ROLE_REQUIRED',
          'This signed-in account has not selected Professor as its account role.',
          403,
          'Open Profile, choose Professor, save the private declaration, and then request school activation from the Professor card.',
        );
      }
      fail('EXAM_ROOM_V1_PROFESSOR_FORBIDDEN', 'This account is not authorized as a professor.', 403, 'Ask an administrator to activate the professor role for this account.');
    }
    return {
      user,
      authorization,
      institutionId: selectInstitution(authorization, requestedInstitutionId, allowedStaffRoles),
    };
  }

  async function adminContext(request, env, requestedInstitutionId = null, options = {}) {
    const requireInstitution = options.requireInstitution !== false;
    const user = await deps.authenticate(request, env);
    if (!user?.id) {
      fail('EXAM_ROOM_V1_ADMIN_SIGN_IN_REQUIRED', 'Administrator sign-in is required.', 401, 'Sign in through Due Diligence, then reopen Admin.');
    }
    const authorization = await deps.authorizeAdmin(env, user);
    if (!hasGlobalRoleAdmin(authorization)) {
      fail('EXAM_ROOM_V1_ADMIN_FORBIDDEN', 'This account cannot administer Examination Room.', 403, 'Ask a Founder or Super Admin to grant the Role admin capability.');
    }
    if (!requireInstitution) return { user, authorization, institutionId: null };
    if (!hasRoleAdmin(authorization)) {
      fail(
        'EXAM_ROOM_V1_INSTITUTION_ADMIN_REQUIRED',
        'This account has no active Examination Room administrator assignment.',
        403,
        'Create the first law-school workspace or ask another institution administrator to assign this account.',
      );
    }
    return {
      user,
      authorization,
      institutionId: selectInstitution(authorization, requestedInstitutionId, ['admin']),
    };
  }

  async function pepperedHmac(env, purpose, secret) {
    const pepper = typeof env?.EXAMINATION_ROOM_KEY_PEPPER === 'string'
      ? env.EXAMINATION_ROOM_KEY_PEPPER.trim()
      : '';
    if (pepper.length < 32) {
      fail('EXAM_ROOM_V1_NOT_CONFIGURED', 'Examination Room security is not configured.', 503, 'Contact support and provide the time this message appeared.');
    }
    const digest = String(await deps.hmacHex(pepper, `${purpose}\0${secret}`)).toLowerCase();
    if (!SHA256_PATTERN.test(digest)) {
      fail('EXAM_ROOM_V1_CRYPTO_UNAVAILABLE', 'A secure verification code could not be created.', 503, 'Wait briefly, then try again.');
    }
    return digest;
  }

  async function requestContext(env, rawRequestKey) {
    const normalized = requestKey(rawRequestKey);
    const requestHash = await pepperedHmac(env, 'request', normalized);
    return { rawRequestKey: normalized, requestHash, clientEventId: uuidFromHash(requestHash) };
  }

  async function sessionCredential(env, payload) {
    const source = plainRecord(payload, 'student request');
    const sessionId = uuid(source.sessionId, 'the examination session identifier');
    if (source.sessionToken === undefined || source.sessionToken === null || source.sessionToken === '') {
      fail(
        'EXAM_ROOM_V1_SESSION_INVALID',
        'This examination session could not be verified.',
        401,
        'Return to the join page and enter the same room key and student details. Server-backed answers remain preserved.',
      );
    }
    const token = cleanText(source.sessionToken, 80, 'the examination session token', { required: true });
    if (!SESSION_TOKEN_PATTERN.test(token)) {
      fail('EXAM_ROOM_V1_SESSION_INVALID', 'This examination session could not be verified.', 401, 'Return to the join page and enter the same room key and student details. Server-backed answers remain preserved.');
    }
    return {
      sessionId,
      sessionTokenHash: await pepperedHmac(env, 'student-session', token),
      rawSessionToken: token,
    };
  }

  function roomKeyPayload() {
    const bytes = deps.randomBytes(ROOM_KEY.PAYLOAD_LENGTH * 2);
    if (!(bytes instanceof Uint8Array) || bytes.length < ROOM_KEY.PAYLOAD_LENGTH) {
      fail('EXAM_ROOM_V1_CRYPTO_UNAVAILABLE', 'A secure room key could not be created.', 503, 'Wait briefly, then issue the key again.');
    }
    let payload = '';
    for (const byte of bytes) {
      if (byte >= 256 - (256 % ROOM_KEY.ALPHABET.length)) continue;
      payload += ROOM_KEY.ALPHABET[byte % ROOM_KEY.ALPHABET.length];
      if (payload.length === ROOM_KEY.PAYLOAD_LENGTH) break;
    }
    if (payload.length !== ROOM_KEY.PAYLOAD_LENGTH) return roomKeyPayload();
    return payload;
  }

  function newSessionToken() {
    const bytes = deps.randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
      fail('EXAM_ROOM_V1_CRYPTO_UNAVAILABLE', 'A secure examination session could not be created.', 503, 'Wait briefly, then try again.');
    }
    return `ers1_${hex(bytes)}`;
  }

  async function callRpc(env, parameters, secrets = []) {
    assertNoPlainSecret(parameters, secrets);
    return ensureStoreResult(await deps.rpc(env, parameters));
  }

  async function professorQuery(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'professor_query');
      const body = plainRecord(await deps.parseJson(request, 24_000));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!PROFESSOR_QUERY_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That professor view is not available.', 400, 'Return to the Examination Room menu and try again.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      if (operation === 'role_status') {
        const user = await deps.authenticate(request, env);
        if (!user?.id) {
          fail('EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED', 'Professor sign-in is required.', 401, 'Sign in through Due Diligence, then reopen the Professor Examination Room card.');
        }
        const result = ensureStoreResult(await deps.professorAccess(env, {
          operation: 'status', actorUserId: user.id, payload: {},
        }));
        return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
      }
      const context = await professorContext(request, env, payload.institutionId);
      const safePayload = operation === 'session'
        ? {}
        : { examId: uuid(payload.examId, 'the examination identifier') };
      const result = await callRpc(env, {
        scope: 'professor', operation, actorUserId: context.user.id,
        institutionId: context.institutionId, payload: safePayload,
      });
      return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function professorCommand(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'professor_command');
      const body = plainRecord(await deps.parseJson(request, operationBodyLimit(request)));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!PROFESSOR_COMMAND_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That professor action is not available.', 400, 'Refresh Examination Room and try again.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      if (operation === 'request_access') {
        const user = await deps.authenticate(request, env);
        if (!user?.id) {
          fail('EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED', 'Professor sign-in is required.', 401, 'Sign in through Due Diligence, then reopen the Professor Examination Room card.');
        }
        const result = ensureStoreResult(await deps.professorAccess(env, {
          operation: 'request',
          actorUserId: user.id,
          payload: payload.institutionId
            ? { institutionId: uuid(payload.institutionId, 'the law-school workspace identifier') }
            : {},
        }));
        return deps.respond({ ok: true, ...result }, result.duplicate || result.alreadyActive ? 200 : 201, origin, allowedOrigin);
      }
      const context = await professorContext(request, env, payload.institutionId);
      const requestInfo = await requestContext(env, body.idempotencyKey ?? request.headers.get('X-Request-ID'));
      let safePayload;

      if (operation === 'save_draft' || operation === 'publish') {
        const draft = professorDraftFromClientExam(payload.exam);
        const exam = operationalExam(payload.exam, draft);
        if (operation === 'publish') {
          const readiness = getPublicationReadiness(draft);
          if (!readiness.ready) {
            fail(
              ERROR_CODES.PUBLICATION_NOT_READY,
              'Finish the listed examination details before publishing.',
              409,
              RECOVERY_BY_CODE[ERROR_CODES.PUBLICATION_NOT_READY],
              { issues: readiness.issues },
            );
          }
          if (exam.roster.length === 0) {
            fail('EXAM_ROOM_V1_ROSTER_REQUIRED', 'Add at least one student before publishing.', 409, 'Add or import the class roster, review it, then publish again.');
          }
          if (draft.integrityTier === 'recorded_proctoring' || exam.cameraRequired || exam.microphoneRequired) {
            fail(
              'EXAM_ROOM_V1_RECORDED_PROCTORING_NOT_CONFIGURED',
              'Recorded proctoring is not configured for this Examination Room release.',
              409,
              'Choose Standard or Focus monitoring, or ask an administrator to configure encrypted media upload, retention, deletion, review access, and an approved student alternative.',
            );
          }
        }
        safePayload = {
          exam,
          draft: persistenceDraft(draft),
          requestHash: requestInfo.requestHash,
          requestedAt: deps.now(),
        };
      } else if (operation === 'import_document') {
        if (typeof deps.importDocument !== 'function') {
          fail('EXAM_ROOM_V1_IMPORT_UNAVAILABLE', 'Document import is temporarily unavailable.', 503, 'Paste the questions into the creator or upload a TXT file while import recovers.');
        }
        const examId = uuid(payload.examId, 'the examination identifier');
        const fileName = cleanText(payload.fileName, 255, 'file name', { required: true });
        const mimeType = cleanText(payload.mimeType, 120, 'file type', { required: true });
        const base64 = cleanText(payload.base64, Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 16, 'uploaded document', { required: true, singleLine: false });
        if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64) || Math.floor(base64.length * 3 / 4) > MAX_DOCUMENT_BYTES) {
          fail('EXAM_ROOM_V1_IMPORT_INVALID', 'The uploaded document is invalid or larger than 8 MB.', 413, 'Upload a DOCX, text PDF, RTF, or TXT file no larger than 8 MB.');
        }
        const imported = await deps.importDocument({ fileName, mimeType, base64 });
        const draft = normalizeProfessorDraft({
          title: '', subject: '', yearLevel: '', instructions: '', identityMode: 'real_names',
          integrityTier: 'standard', privacyNoticeVersion: null,
          questions: (imported?.questions || []).map(normalizedQuestionInput),
        });
        return deps.respond({ ok: true, examId, questions: draft.questions, warnings: imported?.warnings || [] }, 200, origin, allowedOrigin);
      } else if (operation === 'open_room') {
        const rawRoomKey = normalizeRoomKey(payload.roomKey);
        safePayload = {
          examId: uuid(payload.examId, 'the examination identifier'),
          roomKeyHash: await pepperedHmac(env, 'room-key', rawRoomKey),
          requestHash: requestInfo.requestHash,
          openedAt: deps.now(),
        };
        const result = await callRpc(env, {
          scope: 'professor', operation, actorUserId: context.user.id,
          institutionId: context.institutionId, payload: safePayload,
        }, [rawRoomKey]);
        return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
      } else if (operation === 'close_room') {
        safePayload = {
          examId: uuid(payload.examId, 'the examination identifier'),
          requestHash: requestInfo.requestHash,
          closedAt: deps.now(),
        };
      } else if (operation === 'save_grade') {
        const examId = uuid(payload.examId, 'the examination identifier');
        const sessionId = uuid(payload.sessionId, 'the student session identifier');
        const questionReference = cleanText(payload.questionId, 128, 'question', { required: true });
        const gradingContext = ensureStoreResult(await deps.rpc(env, {
          scope: 'professor', operation: 'grading_context', actorUserId: context.user.id,
          institutionId: context.institutionId, payload: { examId, sessionId, questionReference },
        }));
        const submissionManifest = gradingContext.submissionManifest;
        const clientQuestionNumber = /^q-(\d{1,3})$/u.test(questionReference)
          ? Number(questionReference.slice(2))
          : Number(gradingContext.questionNumber);
        const question = normalizePublicationManifest(gradingContext.publicationManifest)
          .questions.find((entry) => (
            entry.key === questionReference
            || String(entry.number) === questionReference
            || entry.number === clientQuestionNumber
          ));
        if (!question) fail('EXAM_ROOM_V1_QUESTION_NOT_FOUND', 'That question is not part of this examination version.', 409, 'Refresh the grading view, then try again.');
        const priorScores = Array.isArray(gradingContext.scores) ? gradingContext.scores : [];
        const scores = priorScores
          .filter((score) => Number(score.questionNumber) !== question.number)
          .concat({
            questionNumber: question.number,
            pointsAwarded: Number(payload.points),
            feedback: cleanText(payload.feedback, 20_000, 'feedback', { singleLine: false }),
          });
        const grade = buildGradingRevision({
          revisionId: deps.randomUUID(),
          revision: positiveInteger(gradingContext.nextRevision, 'the grading revision', 1, 1_000_000, 1),
          status: GRADING_REVISION_STATUSES.DRAFT,
          graderId: context.user.id,
          gradedAt: deps.now(),
          idempotencyKey: requestInfo.rawRequestKey,
          scores,
          overallFeedback: cleanText(gradingContext.overallFeedback, 20_000, 'overall feedback', { singleLine: false }),
        }, { submissionManifest });
        const { idempotencyKey: _discardedIdempotencyKey, ...gradingManifest } = grade.manifest;
        safePayload = {
          examId, sessionId, requestHash: requestInfo.requestHash,
          clientRevisionId: requestInfo.clientEventId,
          gradingManifest,
          gradingHash: await deps.sha256Hex?.(grade.hashInput) || await pepperedHmac(env, 'grading-manifest', grade.hashInput),
        };
      } else if (operation === 'release_results') {
        const examId = uuid(payload.examId, 'the examination identifier');
        if (!Array.isArray(payload.sessionIds) || payload.sessionIds.length === 0 || payload.sessionIds.length > 1_000) {
          fail('EXAM_ROOM_V1_RESULT_RECIPIENT_REQUIRED', 'Select at least one student before releasing results.', 400, 'Select the intended students, review the recipient list, then release again.');
        }
        const sessionIds = [...new Set(payload.sessionIds.map((value) => uuid(value, 'a student session identifier')))];
        const releaseContext = ensureStoreResult(await deps.rpc(env, {
          scope: 'professor', operation: 'release_context', actorUserId: context.user.id,
          institutionId: context.institutionId, payload: { examId, sessionIds },
        }));
        const releases = [];
        for (const entry of releaseContext.entries || []) {
          const finalRevision = buildGradingRevision({
            revisionId: deps.randomUUID(),
            revision: positiveInteger(entry.nextRevision, 'the grading revision', 1, 1_000_000, 1),
            status: GRADING_REVISION_STATUSES.FINAL,
            graderId: context.user.id,
            gradedAt: deps.now(),
            idempotencyKey: `${requestInfo.rawRequestKey}:${entry.sessionId}`.slice(0, 128),
            scores: entry.scores,
            overallFeedback: entry.overallFeedback || '',
          }, { submissionManifest: entry.submissionManifest });
          const release = buildResultRelease({
            releaseId: deps.randomUUID(),
            selectedRevisionId: finalRevision.manifest.revisionId,
            releasedAt: deps.now(),
            releasedBy: context.user.id,
            idempotencyKey: `${requestInfo.rawRequestKey}:release:${entry.sessionId}`.slice(0, 128),
          }, {
            submissionManifest: entry.submissionManifest,
            gradingRevisions: [finalRevision.manifest],
          });
          const gradingManifest = { ...finalRevision.manifest };
          const releaseManifest = { ...release.manifest };
          delete gradingManifest.idempotencyKey;
          delete releaseManifest.idempotencyKey;
          releases.push({
            sessionId: uuid(entry.sessionId, 'the student session identifier'),
            gradingManifest,
            gradingHash: await deps.sha256Hex?.(finalRevision.hashInput) || await pepperedHmac(env, 'grading-manifest', finalRevision.hashInput),
            releaseManifest,
            releaseHash: await deps.sha256Hex?.(release.hashInput) || await pepperedHmac(env, 'release-manifest', release.hashInput),
            releaseRequestHash: await pepperedHmac(
              env,
              'result-release-request',
              `${requestInfo.rawRequestKey}\0${entry.sessionId}`,
            ),
          });
        }
        if (releases.length !== sessionIds.length) {
          fail('EXAM_ROOM_V1_GRADING_CONTEXT_INVALID', 'Some selected student records could not be prepared for release.', 409, 'Refresh grading, review the selected students, then release again.');
        }
        safePayload = { examId, sessionIds, requestHash: requestInfo.requestHash, releases };
      }

      const result = await callRpc(env, {
        scope: 'professor', operation, actorUserId: context.user.id,
        institutionId: context.institutionId, payload: safePayload,
      }, [requestInfo.rawRequestKey]);
      if (operation === 'publish' && result.publicationManifest) normalizePublicationManifest(result.publicationManifest);
      return deps.respond({ ok: true, ...result }, operation === 'publish' ? 201 : 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function previewWithVerifiedKey(env, payload) {
    const rawRoomKey = normalizeRoomKey(payload.roomKey);
    const identity = studentIdentityFromPayload(payload);
    const roomKeyHash = await pepperedHmac(env, 'room-key', rawRoomKey);
    const result = await callRpc(env, {
      scope: 'student', operation: 'preview', actorUserId: null, institutionId: null,
      payload: { roomKeyHash, identity },
    }, [rawRoomKey]);
    return { rawRoomKey, roomKeyHash, identity, result, metadata: publicPreview(result.metadata) };
  }

  async function studentPreview(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'student_preview');
      const payload = plainRecord(await deps.parseJson(request, 12_000));
      const preview = await previewWithVerifiedKey(env, payload);
      return deps.respond({
        ok: true,
        metadata: preview.metadata,
        identity: preview.result.identity ? {
          fullName: cleanText(preview.result.identity.fullName, 240, 'student name', { required: true }),
          studentNumber: cleanText(preview.result.identity.studentNumber, 64, 'student number', { required: true }),
          yearLevel: cleanText(preview.result.identity.yearLevel, 64, 'year level', { required: true }),
        } : undefined,
        notice: preview.result.notice ? {
          version: cleanText(preview.result.notice.version, 64, 'privacy notice version', { required: true }),
          title: cleanText(preview.result.notice.title, 240, 'privacy notice title', { required: true }),
          body: cleanText(preview.result.notice.body, 40_000, 'privacy notice', { required: true, singleLine: false }),
          purposes: Array.isArray(preview.result.notice.purposes) ? preview.result.notice.purposes : [],
        } : undefined,
      }, 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function studentConsent(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'student_consent');
      const payload = plainRecord(await deps.parseJson(request, 16_000));
      const info = await requestContext(env, payload.idempotencyKey ?? request.headers.get('X-Request-ID'));
      const preview = await previewWithVerifiedKey(env, payload);
      const consent = validatePrivacyConsent({
        noticeVersion: payload.noticeVersion,
        accepted: payload.agreed,
        acceptedAt: deps.now(),
        recordingAccepted: payload.recordingAccepted === true,
      }, {
        requiredNoticeVersion: preview.metadata.privacyNoticeVersion,
        integrityTier: preview.metadata.integrityTier,
      });
      const sessionToken = newSessionToken();
      const sessionTokenHash = await pepperedHmac(env, 'student-session', sessionToken);
      const result = await callRpc(env, {
        scope: 'student', operation: 'consent', actorUserId: null, institutionId: null,
        payload: {
          roomKeyHash: preview.roomKeyHash,
          identity: preview.identity,
          consent,
          clientEventId: info.clientEventId,
          requestHash: info.requestHash,
          sessionTokenHash,
          clientInstanceId: payload.clientInstanceId && UUID_PATTERN.test(String(payload.clientInstanceId))
            ? String(payload.clientInstanceId).toLowerCase()
            : deps.randomUUID(),
        },
      }, [preview.rawRoomKey, sessionToken, info.rawRequestKey]);
      const { publicationManifest, ...publicResult } = result;
      let exam = publicResult.exam;
      if (publicationManifest) exam = buildStudentExaminationView(publicationManifest);
      return deps.respond({ ok: true, ...publicResult, exam, sessionToken }, 201, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function studentQuery(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'student_query');
      const body = plainRecord(await deps.parseJson(request, 16_000));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!STUDENT_QUERY_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That student view is not available.', 400, 'Return to the examination and try again.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      const credential = await sessionCredential(env, payload);
      const result = await callRpc(env, {
        scope: 'student', operation, actorUserId: null, institutionId: null,
        payload: { sessionId: credential.sessionId, sessionTokenHash: credential.sessionTokenHash },
      }, [credential.rawSessionToken]);
      const { publicationManifest, ...publicResult } = result;
      if (publicationManifest) publicResult.exam = buildStudentExaminationView(publicationManifest);
      return deps.respond({ ok: true, ...publicResult }, 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function studentCommand(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'student_command');
      const body = plainRecord(await deps.parseJson(request, 140_000));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!STUDENT_COMMAND_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That student action is not available.', 400, 'Refresh the examination and try again.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      const credential = await sessionCredential(env, payload);
      const info = await requestContext(env, body.idempotencyKey ?? request.headers.get('X-Request-ID'));
      let safePayload = {
        sessionId: credential.sessionId,
        sessionTokenHash: credential.sessionTokenHash,
        requestHash: info.requestHash,
        clientEventId: info.clientEventId,
      };

      if (operation === 'heartbeat') {
        safePayload = {
          ...safePayload,
          connected: payload.connected !== false,
          currentQuestion: positiveInteger(payload.currentQuestion, 'the current question', 1, 200, 1),
          occurredAt: deps.now(),
        };
      } else if (operation === 'record_event') {
        const kindMap = {
          focus_lost: 'focus_lost', fullscreen_exit: 'fullscreen_exit',
          camera_interrupted: 'camera_interrupted', microphone_interrupted: 'microphone_interrupted',
          network_disconnected: 'network_disconnected', device_changed: 'device_changed',
          clock_anomaly: 'clock_anomaly', other: 'other',
        };
        const incidentKind = kindMap[String(payload.type || '').trim()] || 'other';
        safePayload = {
          ...safePayload,
          incidentKind,
          severity: ['info', 'warning', 'critical'].includes(payload.severity)
            ? payload.severity
            : payload.severity === 'review' ? 'warning' : 'info',
          occurredAt: isoInstant(payload.occurredAt ?? deps.now(), 'the event time'),
          durationMs: payload.durationMs == null ? null : positiveInteger(payload.durationMs, 'event duration', 0, 86_400_000),
          details: safeEventDetails(payload.details ?? {}),
        };
      } else {
        const sessionContext = ensureStoreResult(await deps.rpc(env, {
          scope: 'student', operation: 'session_context', actorUserId: null, institutionId: null,
          payload: { sessionId: credential.sessionId, sessionTokenHash: credential.sessionTokenHash },
        }));
        const publicationManifest = normalizePublicationManifest(sessionContext.publicationManifest);
        const publicationHash = cleanText(sessionContext.publicationHash, 64, 'publication fingerprint', { required: true }).toLowerCase();
        if (!SHA256_PATTERN.test(publicationHash)) {
          fail('EXAM_ROOM_V1_PUBLICATION_INVALID', 'The published examination could not be verified.', 503, 'Reconnect to the examination. Your local answers remain available.');
        }

        if (operation === 'save_answer') {
          const questionReference = cleanText(payload.questionId ?? payload.questionKey ?? payload.questionNumber, 128, 'question', { required: true });
          const clientQuestionNumber = /^q-(\d{1,3})$/u.test(questionReference)
            ? Number(questionReference.slice(2))
            : Number.NaN;
          const question = publicationManifest.questions.find((entry) => (
            entry.key === questionReference
            || String(entry.number) === questionReference
            || entry.number === clientQuestionNumber
          ));
          if (!question) fail('EXAM_ROOM_V1_QUESTION_NOT_FOUND', 'That question is not part of this examination version.', 409, 'Refresh the examination. Your other saved answers remain available.');
          const revision = normalizeAnswerRevision({
            attemptId: credential.sessionId,
            questionNumber: question.number,
            revision: positiveInteger(
              payload.revision ?? sessionContext.nextRevisionByQuestion?.[question.key],
              'the answer revision',
              1,
              1_000_000_000,
              1,
            ),
            idempotencyKey: info.rawRequestKey,
            answer: payload.answer,
          }, { versionManifest: publicationManifest, publicationHash });
          const answerPayload = { ...revision };
          delete answerPayload.idempotencyKey;
          delete answerPayload.idempotencyInput;
          safePayload = {
            ...safePayload,
            answerRevision: answerPayload,
            answerHash: await deps.sha256Hex?.(revision.idempotencyInput) || await pepperedHmac(env, 'answer-revision', revision.idempotencyInput),
            flagged: payload.flagged === true,
            source: ['manual_save', 'recovery', 'submission'].includes(payload.source) ? payload.source : 'autosave',
            savedAt: deps.now(),
          };
        } else if (operation === 'submit') {
          const submission = buildSubmissionManifest({
            submissionId: deps.randomUUID(),
            attemptId: credential.sessionId,
            idempotencyKey: info.rawRequestKey,
            submittedAt: isoInstant(payload.submittedAt ?? deps.now(), 'submission time'),
            versionManifest: publicationManifest,
            publicationHash,
            studentIdentity: sessionContext.studentIdentity,
            privacyConsent: sessionContext.privacyConsent,
            answerRevisions: sessionContext.answerRevisions,
            anonymousCandidateId: sessionContext.anonymousCandidateId,
          });
          const manifest = { ...submission.manifest };
          delete manifest.idempotencyKey;
          safePayload = {
            ...safePayload,
            submissionManifest: manifest,
            manifestHash: await deps.sha256Hex?.(submission.hashInput) || await pepperedHmac(env, 'submission-manifest', submission.hashInput),
            answerSelections: submission.manifest.questions.map((question) => ({
              questionNumber: question.questionNumber,
              questionKey: question.questionKey,
              revision: question.revision,
            })),
          };
        }
      }

      const result = await callRpc(env, {
        scope: 'student', operation, actorUserId: null, institutionId: null, payload: safePayload,
      }, [credential.rawSessionToken, info.rawRequestKey]);
      return deps.respond({ ok: true, ...result }, operation === 'submit' ? 201 : 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function adminQuery(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'admin_query');
      const body = plainRecord(await deps.parseJson(request, 16_000));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!ADMIN_QUERY_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That administrator view is not available.', 400, 'Return to the Examination Room admin menu.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      if (operation === 'access') {
        const context = await adminContext(request, env, null, { requireInstitution: false });
        const result = ensureStoreResult(await deps.manageStaff(env, {
          operation: 'access', actorUserId: context.user.id, institutionId: null, payload: {},
        }));
        return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
      }
      const context = await adminContext(request, env, payload.institutionId);
      if (operation === 'staff_directory') {
        const result = ensureStoreResult(await deps.manageStaff(env, {
          operation: 'directory', actorUserId: context.user.id,
          institutionId: context.institutionId, payload: {},
        }));
        return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
      }
      const result = await callRpc(env, {
        scope: 'admin', operation, actorUserId: context.user.id,
        institutionId: context.institutionId, payload: {},
      });
      return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  async function adminCommand(request, env, origin, allowedOrigin) {
    return respondWithErrors(async () => {
      await deps.rateLimit(request, env, 'admin_command');
      const body = plainRecord(await deps.parseJson(request, 24_000));
      const operation = cleanText(body.operation, 80, 'operation', { required: true });
      if (!ADMIN_COMMAND_OPERATIONS.has(operation)) {
        fail('EXAM_ROOM_V1_OPERATION_UNSUPPORTED', 'That administrator action is not available.', 400, 'Refresh Admin and try again.');
      }
      const payload = plainRecord(body.payload ?? {}, 'request details');
      const info = await requestContext(env, body.idempotencyKey ?? request.headers.get('X-Request-ID'));

      if (operation === 'bootstrap_institution') {
        const context = await adminContext(request, env, null, { requireInstitution: false });
        const institutionName = cleanText(payload.institutionName, 240, 'the law-school name', { required: true });
        const institutionCode = cleanText(payload.institutionCode, 64, 'the law-school code', { required: true }).toLowerCase();
        const institutionProfileSchoolId = profileSchoolId(institutionName);
        if (!INSTITUTION_CODE_PATTERN.test(institutionCode)) {
          fail(
            'EXAM_ROOM_V1_INSTITUTION_CODE_INVALID',
            'Enter a short school code using letters, numbers, periods, dashes, or underscores.',
            400,
            'Use 2 to 64 lowercase letters, numbers, periods, dashes, or underscores.',
          );
        }
        const result = ensureStoreResult(await deps.manageStaff(env, {
          operation,
          actorUserId: context.user.id,
          institutionId: null,
          payload: {
            institutionName,
            institutionCode,
            profileSchoolId: institutionProfileSchoolId,
            requestHash: info.requestHash,
          },
        }));
        return deps.respond({ ok: true, ...result }, result.duplicate ? 200 : 201, origin, allowedOrigin);
      }

      if (operation === 'assign_staff' || operation === 'revoke_staff' || operation === 'reject_professor_request') {
        const context = await adminContext(request, env, payload.institutionId);
        const reason = cleanText(payload.reason, 1_000, 'the access-change reason', { required: true });
        let safeStaffPayload;
        if (operation === 'assign_staff') {
          const email = cleanText(payload.email, 320, 'the verified account email', { required: true }).toLowerCase();
          if (!EMAIL_PATTERN.test(email)) {
            fail('EXAM_ROOM_V1_EMAIL_INVALID', 'Enter a valid signed-in account email.', 400, 'Correct the email, then try again.');
          }
          const staffRole = cleanText(payload.staffRole, 20, 'the staff role', { required: true }).toLowerCase();
          if (!['professor', 'admin'].includes(staffRole)) {
            fail('EXAM_ROOM_V1_STAFF_ROLE_INVALID', 'Choose Professor or Institution admin.', 400, 'Choose one listed staff role, then try again.');
          }
          safeStaffPayload = {
            email,
            staffRole,
            displayName: cleanText(payload.displayName ?? '', 240, 'the display name'),
            reason,
            requestHash: info.requestHash,
          };
        } else if (operation === 'revoke_staff') {
          safeStaffPayload = {
            membershipId: uuid(payload.membershipId, 'the staff assignment identifier'),
            reason,
            requestHash: info.requestHash,
          };
        } else {
          safeStaffPayload = {
            requestId: uuid(payload.requestId, 'the Professor access request identifier'),
            reason,
            requestHash: info.requestHash,
          };
        }
        const result = ensureStoreResult(await deps.manageStaff(env, {
          operation,
          actorUserId: context.user.id,
          institutionId: context.institutionId,
          payload: safeStaffPayload,
        }));
        return deps.respond({ ok: true, ...result }, 200, origin, allowedOrigin);
      }

      const context = await adminContext(request, env, payload.institutionId);
      const examId = uuid(payload.examId, 'the examination identifier');
      let safePayload = { examId, requestHash: info.requestHash };
      let rawRoomKey = null;

      if (operation === 'activate_exam' || operation === 'email_key') {
        rawRoomKey = createRoomKey(roomKeyPayload());
        safePayload = {
          ...safePayload,
          roomKeyHash: await pepperedHmac(env, 'room-key', rawRoomKey),
          keyHashAlgorithm: 'hmac-sha256-v1',
          opensAt: isoInstant(payload.opensAt ?? deps.now(), 'the room opening time'),
          closesAt: isoInstant(payload.closesAt ?? new Date(new Date(deps.now()).getTime() + 24 * 60 * 60 * 1000).toISOString(), 'the room closing time'),
          maxSessions: payload.maxSessions == null ? null : positiveInteger(payload.maxSessions, 'maximum sessions', 1, 100_000),
          replaceCurrent: operation === 'email_key',
        };
      } else if (operation === 'revoke_key') {
        safePayload.reason = cleanText(payload.reason ?? 'Administrator revoked the room key.', 1_000, 'revocation reason', { required: true });
        safePayload.revokedAt = deps.now();
      } else if (operation === 'create_snapshot') {
        safePayload.scope = ['exam_definition', 'answer_state', 'grading_state', 'full_recovery'].includes(payload.scope)
          ? payload.scope
          : 'full_recovery';
        safePayload.requestedAt = deps.now();
      }

      const result = await callRpc(env, {
        scope: 'admin', operation, actorUserId: context.user.id,
        institutionId: context.institutionId, payload: safePayload,
      }, [rawRoomKey, info.rawRequestKey].filter(Boolean));

      let delivery = null;
      if (operation === 'email_key' && typeof deps.sendRoomKeyEmail === 'function') {
        delivery = await deps.sendRoomKeyEmail(env, {
          recipient: result.professorEmail,
          professorName: result.professorName,
          examTitle: result.examTitle,
          roomKey: rawRoomKey,
          expiresAt: result.activation?.expiresAt ?? safePayload.closesAt,
          idempotencyHash: info.requestHash,
        });
      }
      return deps.respond({
        ok: true,
        ...result,
        ...(rawRoomKey ? { roomKey: rawRoomKey } : {}),
        ...(delivery ? { deliveryStatus: delivery.status } : {}),
      }, operation === 'activate_exam' ? 201 : 200, origin, allowedOrigin);
    }, origin, allowedOrigin);
  }

  return Object.freeze({
    professorQuery,
    professorCommand,
    studentPreview,
    studentConsent,
    studentQuery,
    studentCommand,
    adminQuery,
    adminCommand,
  });
}

function operationBodyLimit(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  return declared > 200_000 ? 12_000_000 : 220_000;
}

export const EXAMINATION_ROOM_V1_PATHS = Object.freeze({
  '/examination-room/v1/professor/query': 'professorQuery',
  '/examination-room/v1/professor/command': 'professorCommand',
  '/examination-room/v1/student/preview': 'studentPreview',
  '/examination-room/v1/student/consent': 'studentConsent',
  '/examination-room/v1/student/query': 'studentQuery',
  '/examination-room/v1/student/command': 'studentCommand',
  '/examination-room/v1/admin/query': 'adminQuery',
  '/examination-room/v1/admin/command': 'adminCommand',
});
