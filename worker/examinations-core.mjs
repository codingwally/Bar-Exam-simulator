const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export const EXAMINATION_LIMITS = Object.freeze({
  maximumJsonBytes: 2_500_000,
  maximumAnswerCharacters: 20_000,
  maximumUploadBytes: 1_500_000,
  maximumExamQuestions: 20,
  maximumExaminerEmailCharacters: 254,
  maximumReasonCharacters: 1_000,
  maximumTitleCharacters: 180,
  maximumInstructionsCharacters: 8_000,
});

export const EXAMINATION_QUERY_OPERATIONS = new Set([
  'catalog',
  'setup',
  'resume',
  'history',
  'verdict',
  'assignment',
  'subject_catalog',
  'subject_next',
  'subject_performance',
]);

export const EXAMINATION_COMMAND_OPERATIONS = new Set([
  'start_attempt',
  'heartbeat',
  'save_response',
  'flag_response',
  'submit_attempt',
  'request_ai_grading',
  'create_examiner_assignment',
  'claim_examiner_assignment',
  'save_examiner_review',
  'finalize_examiner_review',
  'release_model_answers',
  'confirm_upload',
  'delete_upload',
]);

export const EXAMINATION_ADMIN_OPERATIONS = new Set([
  'dashboard',
  'create_exam',
  'create_version',
  'set_questions',
  'publish_version',
  'set_availability',
  'set_participant',
  'set_beta_access',
  'unpublish_exam',
  'close_exam',
  'release_model_answers',
  'audit',
]);

export class ExaminationValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ExaminationValidationError';
    this.code = code;
    this.status = status;
  }
}

export function examinationText(value, maximum = 2_000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximum);
}

export function examinationUuid(value, label = 'Identifier') {
  const normalized = examinationText(value, 80);
  if (!UUID_PATTERN.test(normalized)) {
    throw new ExaminationValidationError('INVALID_IDENTIFIER', `${label} is invalid.`);
  }
  return normalized.toLowerCase();
}

export function examinationRequestKey(value) {
  const normalized = examinationText(value, 140);
  if (!REQUEST_KEY_PATTERN.test(normalized)) {
    throw new ExaminationValidationError(
      'INVALID_REQUEST_KEY',
      'A valid request identifier is required.',
    );
  }
  return normalized;
}

function objectPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExaminationValidationError(
      'INVALID_REQUEST',
      'The examination request must be a JSON object.',
    );
  }
  return value;
}

function optionalUuid(value, label) {
  if (value == null || value === '') return null;
  return examinationUuid(value, label);
}

function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ExaminationValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return parsed;
}

function boolean(value) {
  return value === true;
}

function timerMode(value, allowNull = false) {
  const normalized = examinationText(value, 30);
  if (allowNull && !normalized) return null;
  if (!['strict', 'selfPaced', 'none'].includes(normalized)) {
    throw new ExaminationValidationError('INVALID_TIMER_MODE', 'Select a valid timer mode.');
  }
  return normalized;
}

function secureTabToken(value) {
  const normalized = examinationText(value, 256);
  if (normalized.length < 32) {
    throw new ExaminationValidationError(
      'TAB_TOKEN_REQUIRED',
      'A secure examination tab token is required.',
    );
  }
  return normalized;
}

function operationFrom(payload, allowed) {
  const operation = examinationText(payload.operation, 80);
  if (!allowed.has(operation)) {
    throw new ExaminationValidationError(
      'UNSUPPORTED_OPERATION',
      'This examination operation is not supported.',
    );
  }
  return operation;
}

export function normalizeExaminationQuery(value) {
  const payload = objectPayload(value);
  const operation = operationFrom(payload, EXAMINATION_QUERY_OPERATIONS);
  const normalized = { operation };

  if (operation === 'catalog') {
    normalized.track = ['per_subject', 'bar_feels'].includes(payload.track)
      ? payload.track
      : null;
  } else if (operation === 'setup') {
    normalized.versionId = examinationUuid(payload.versionId, 'Examination version');
  } else if (operation === 'resume') {
    normalized.attemptId = optionalUuid(payload.attemptId, 'Attempt');
    normalized.versionId = optionalUuid(payload.versionId, 'Examination version');
    if (!normalized.attemptId && !normalized.versionId) {
      throw new ExaminationValidationError(
        'ATTEMPT_REFERENCE_REQUIRED',
        'An attempt or examination version is required.',
      );
    }
  } else if (operation === 'history' || operation === 'verdict') {
    normalized.limit = integer(payload.limit ?? 30, 'History limit', 1, 100);
    normalized.offset = integer(payload.offset ?? 0, 'History offset', 0, 10_000);
    normalized.attemptId = optionalUuid(payload.attemptId, 'Attempt');
  } else if (operation === 'assignment') {
    normalized.assignmentToken = examinationText(payload.assignmentToken, 256);
    if (normalized.assignmentToken.length < 32) {
      throw new ExaminationValidationError(
        'ASSIGNMENT_TOKEN_REQUIRED',
        'A valid examiner assignment token is required.',
      );
    }
  } else if (operation === 'subject_next') {
    normalized.subject = examinationText(payload.subject, 120);
    normalized.yearLevel = integer(payload.yearLevel, 'Year level', 1, 4);
    normalized.term = integer(payload.term, 'Term', 1, 3);
    normalized.resetCycle = payload.resetCycle === true;
  } else if (operation === 'subject_performance') {
    normalized.subject = examinationText(payload.subject, 120) || null;
    normalized.limit = integer(payload.limit ?? 50, 'History limit', 1, 100);
  }

  return normalized;
}

const SUBJECT_MATTER_INVENTORY_KEYS = new Set([
  'questioncount',
  'availablecount',
  'totalquestions',
  'remainingquestions',
  'cyclequestioncount',
  'banksize',
  'inventorycount',
  'placementcount',
  'canonicalcount',
  'totalcount',
  'completedcount',
  'attemptedcount',
  'completedquestions',
  'attemptedquestions',
  'cyclecomplete',
]);

function sanitizedSubjectMatterPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizedSubjectMatterPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SUBJECT_MATTER_INVENTORY_KEYS.has(
      String(key).toLowerCase().replace(/[^a-z0-9]/g, ''),
    ))
    .map(([key, nested]) => [key, sanitizedSubjectMatterPayload(nested)]));
}

export function sanitizeSubjectMatterCatalog(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : value;
  if (Array.isArray(source?.items)) {
    source.items = source.items.map((item) => {
      const completed = Number(item?.completedCount) || 0;
      const attempted = Number(item?.attemptedCount) || completed;
      const cycleComplete = item?.cycleComplete === true;
      return {
        ...item,
        progressState: cycleComplete
          ? 'Cycle complete'
          : completed > 0
            ? 'Ready for another review'
            : attempted > 0
              ? 'In progress'
              : 'Not started',
      };
    });
  }
  return sanitizedSubjectMatterPayload(source);
}

export function sanitizeSubjectMatterSelection(value) {
  return sanitizedSubjectMatterPayload(value);
}

export function normalizeExaminationCommand(value) {
  const payload = objectPayload(value);
  const operation = operationFrom(payload, EXAMINATION_COMMAND_OPERATIONS);
  const normalized = { operation };

  if (operation === 'start_attempt') {
    normalized.versionId = examinationUuid(payload.versionId, 'Examination version');
    normalized.timerMode = timerMode(payload.timerMode);
    normalized.requestKey = examinationRequestKey(payload.requestKey);
    normalized.tabToken = secureTabToken(payload.tabToken);
  } else if (operation === 'heartbeat') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.tabToken = secureTabToken(payload.tabToken);
    normalized.takeover = boolean(payload.takeover);
  } else if (operation === 'save_response') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.questionId = examinationUuid(payload.questionId, 'Question');
    normalized.tabToken = secureTabToken(payload.tabToken);
    normalized.answerText = examinationText(
      payload.answerText,
      EXAMINATION_LIMITS.maximumAnswerCharacters + 1,
    );
    if (normalized.answerText.length > EXAMINATION_LIMITS.maximumAnswerCharacters) {
      throw new ExaminationValidationError(
        'ANSWER_TOO_LONG',
        `Each answer is limited to ${EXAMINATION_LIMITS.maximumAnswerCharacters.toLocaleString()} characters.`,
      );
    }
    normalized.expectedRevision = integer(
      payload.expectedRevision ?? 0,
      'Expected revision',
      0,
      1_000_000,
    );
    normalized.flagged = boolean(payload.flagged);
  } else if (operation === 'flag_response') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.questionId = examinationUuid(payload.questionId, 'Question');
    normalized.tabToken = secureTabToken(payload.tabToken);
    normalized.expectedRevision = integer(
      payload.expectedRevision ?? 0,
      'Expected revision',
      0,
      1_000_000,
    );
    normalized.flagged = boolean(payload.flagged);
  } else if (operation === 'submit_attempt') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.tabToken = secureTabToken(payload.tabToken);
    normalized.requestKey = examinationRequestKey(payload.requestKey);
    normalized.confirmed = boolean(payload.confirmed);
    if (!normalized.confirmed) {
      throw new ExaminationValidationError(
        'REVIEW_CONFIRMATION_REQUIRED',
        'Review all answers and confirm final submission.',
      );
    }
  } else if (operation === 'request_ai_grading') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.requestKey = examinationRequestKey(payload.requestKey);
  } else if (operation === 'create_examiner_assignment') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.examinerEmail = examinationText(
      payload.examinerEmail,
      EXAMINATION_LIMITS.maximumExaminerEmailCharacters,
    ).toLowerCase();
    if (!EMAIL_PATTERN.test(normalized.examinerEmail)) {
      throw new ExaminationValidationError(
        'INVALID_EXAMINER_EMAIL',
        'Enter a valid examiner email address.',
      );
    }
    normalized.requestKey = examinationRequestKey(payload.requestKey);
    normalized.assignmentToken = examinationText(payload.assignmentToken, 256);
    if (normalized.assignmentToken.length < 32) {
      throw new ExaminationValidationError(
        'ASSIGNMENT_TOKEN_REQUIRED',
        'A secure examiner assignment token is required.',
      );
    }
  } else if (operation === 'claim_examiner_assignment') {
    normalized.assignmentToken = examinationText(payload.assignmentToken, 256);
    if (normalized.assignmentToken.length < 32) {
      throw new ExaminationValidationError(
        'ASSIGNMENT_TOKEN_REQUIRED',
        'A valid examiner assignment token is required.',
      );
    }
  } else if (operation === 'save_examiner_review') {
    normalized.assignmentToken = examinationText(payload.assignmentToken, 256);
    normalized.questionId = examinationUuid(payload.questionId, 'Question');
    normalized.score = normalizedScore(payload.score);
    normalized.comments = examinationText(payload.comments, 8_000);
    normalized.expectedRevision = integer(
      payload.expectedRevision ?? 0,
      'Expected revision',
      0,
      1_000_000,
    );
  } else if (operation === 'finalize_examiner_review') {
    normalized.assignmentToken = examinationText(payload.assignmentToken, 256);
    normalized.confirmed = boolean(payload.confirmed);
    normalized.expectedRevision = integer(
      payload.expectedRevision ?? 0,
      'Expected revision',
      0,
      1_000_000,
    );
    if (!normalized.confirmed) {
      throw new ExaminationValidationError(
        'FINAL_CONFIRMATION_REQUIRED',
        'Confirm the final examiner assessment.',
      );
    }
  } else if (operation === 'release_model_answers') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
    normalized.reason = requiredReason(payload.reason);
  } else if (operation === 'confirm_upload') {
    normalized.uploadId = examinationUuid(payload.uploadId, 'Upload');
    normalized.title = examinationText(payload.title, EXAMINATION_LIMITS.maximumTitleCharacters);
    if (normalized.title.length < 3) {
      throw new ExaminationValidationError(
        'TITLE_REQUIRED',
        'An examination title is required.',
      );
    }
    normalized.timerMode = timerMode(payload.timerMode);
    normalized.durationSeconds = integer(
      payload.durationSeconds ?? 14_400,
      'Duration',
      60,
      14_400,
    );
    normalized.gradingRoute = ['human', 'provisional'].includes(payload.gradingRoute)
      ? payload.gradingRoute
      : 'human';
    normalized.requestKey = examinationRequestKey(payload.requestKey);
  } else if (operation === 'delete_upload') {
    normalized.uploadId = examinationUuid(payload.uploadId, 'Upload');
    normalized.reason = requiredReason(payload.reason);
  }

  if ('tabToken' in normalized && normalized.tabToken.length < 32) {
    throw new ExaminationValidationError(
      'TAB_TOKEN_REQUIRED',
      'A secure examination tab token is required.',
    );
  }

  return normalized;
}

export function normalizeExaminationAdmin(value) {
  const payload = objectPayload(value);
  const operation = operationFrom(payload, EXAMINATION_ADMIN_OPERATIONS);
  const normalized = { operation };

  if (operation === 'dashboard' || operation === 'audit') {
    normalized.limit = integer(payload.limit ?? 50, 'Result limit', 1, 100);
    normalized.offset = integer(payload.offset ?? 0, 'Result offset', 0, 10_000);
    normalized.examId = optionalUuid(payload.examId, 'Examination');
    return normalized;
  }

  normalized.reason = requiredReason(payload.reason);
  normalized.requestKey = examinationRequestKey(payload.requestKey);

  if (operation === 'create_exam') {
    normalized.track = ['per_subject', 'bar_feels'].includes(payload.track)
      ? payload.track
      : null;
    normalized.assessmentKind = [
      'midterm',
      'final',
      'quiz',
      'curated',
      'uploaded',
      'system_test',
    ].includes(payload.assessmentKind)
      ? payload.assessmentKind
      : null;
    if (!normalized.track || !normalized.assessmentKind) {
      throw new ExaminationValidationError(
        'INVALID_EXAM_CONFIGURATION',
        'Select a valid examination track and type.',
      );
    }
    normalized.title = examinationText(payload.title, EXAMINATION_LIMITS.maximumTitleCharacters);
    normalized.subject = examinationText(payload.subject, 120);
    normalized.yearLevel = payload.yearLevel == null
      ? null
      : integer(payload.yearLevel, 'Year level', 1, 4);
    normalized.semester = payload.semester == null
      ? null
      : integer(payload.semester, 'Semester', 1, 3);
    normalized.testOnly = boolean(payload.testOnly);
    normalized.ownerUserId = optionalUuid(payload.ownerUserId, 'Owner');
    if (!normalized.title) {
      throw new ExaminationValidationError('TITLE_REQUIRED', 'An examination title is required.');
    }
  } else if (operation === 'create_version') {
    normalized.examId = examinationUuid(payload.examId, 'Examination');
    normalized.label = examinationText(payload.label, 120);
    normalized.durationSeconds = integer(
      payload.durationSeconds,
      'Duration',
      60,
      14_400,
    );
    normalized.instructions = examinationText(
      payload.instructions,
      EXAMINATION_LIMITS.maximumInstructionsCharacters,
    );
    normalized.timerMode = timerMode(payload.timerMode, true);
    normalized.gradingRoute = ['ai', 'human', 'either', 'provisional'].includes(
      payload.gradingRoute,
    ) ? payload.gradingRoute : null;
    normalized.answerReleaseRule = [
      'after_ai',
      'after_human',
      'scheduled',
      'manual',
    ].includes(payload.answerReleaseRule) ? payload.answerReleaseRule : null;
    normalized.releaseAt = payload.releaseAt
      ? normalizedTimestamp(payload.releaseAt, 'Release date')
      : null;
    normalized.syllabus = Array.isArray(payload.syllabus)
      ? payload.syllabus.slice(0, 50).map((item) => examinationText(item, 300)).filter(Boolean)
      : [];
    if (!normalized.gradingRoute || !normalized.answerReleaseRule) {
      throw new ExaminationValidationError(
        'INVALID_EXAM_CONFIGURATION',
        'Select valid grading and answer-release rules.',
      );
    }
  } else if (operation === 'set_questions') {
    normalized.versionId = examinationUuid(payload.versionId, 'Examination version');
    if (!Array.isArray(payload.questionIds) || payload.questionIds.length < 1
      || payload.questionIds.length > EXAMINATION_LIMITS.maximumExamQuestions) {
      throw new ExaminationValidationError(
        'INVALID_QUESTION_SET',
        'Select between one and twenty unique questions.',
      );
    }
    normalized.questionIds = payload.questionIds.map((id) => examinationUuid(id, 'Question'));
    if (new Set(normalized.questionIds).size !== normalized.questionIds.length) {
      throw new ExaminationValidationError(
        'DUPLICATE_QUESTION',
        'An examination cannot contain a duplicate question.',
      );
    }
  } else if (operation === 'publish_version') {
    normalized.versionId = examinationUuid(payload.versionId, 'Examination version');
  } else if (operation === 'set_availability') {
    normalized.examId = examinationUuid(payload.examId, 'Examination');
    normalized.availableFrom = payload.availableFrom
      ? normalizedTimestamp(payload.availableFrom, 'Availability start')
      : null;
    normalized.availableUntil = payload.availableUntil
      ? normalizedTimestamp(payload.availableUntil, 'Availability end')
      : null;
  } else if (operation === 'set_participant') {
    normalized.versionId = examinationUuid(payload.versionId, 'Examination version');
    normalized.userId = examinationUuid(payload.userId, 'Participant');
    normalized.enabled = boolean(payload.enabled);
  } else if (operation === 'set_beta_access') {
    normalized.userId = examinationUuid(payload.userId, 'Beta user');
    normalized.enabled = boolean(payload.enabled);
    normalized.expiresAt = payload.expiresAt
      ? normalizedTimestamp(payload.expiresAt, 'Beta expiration')
      : null;
  } else if (['unpublish_exam', 'close_exam'].includes(operation)) {
    normalized.examId = examinationUuid(payload.examId, 'Examination');
  } else if (operation === 'release_model_answers') {
    normalized.attemptId = examinationUuid(payload.attemptId, 'Attempt');
  }

  return normalized;
}

export function normalizeUploadRequest(value) {
  const payload = objectPayload(value);
  const fileName = safeUploadFileName(payload.fileName);
  const mimeType = examinationText(payload.mimeType, 120).toLowerCase();
  if (!['text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    .includes(mimeType)) {
    throw new ExaminationValidationError(
      'UNSUPPORTED_FILE_TYPE',
      'Upload a plain-text (.txt) or Word (.docx) examination file.',
    );
  }
  const encoded = examinationText(payload.base64, Math.ceil(EXAMINATION_LIMITS.maximumUploadBytes * 1.4));
  if (!encoded || !BASE64_PATTERN.test(encoded) || encoded.length % 4 !== 0) {
    throw new ExaminationValidationError('INVALID_UPLOAD', 'The uploaded file is invalid.');
  }
  const bytes = base64Bytes(encoded);
  if (!bytes.length || bytes.length > EXAMINATION_LIMITS.maximumUploadBytes) {
    throw new ExaminationValidationError(
      'UPLOAD_SIZE_INVALID',
      `Uploads must be between 1 byte and ${Math.floor(
        EXAMINATION_LIMITS.maximumUploadBytes / 1_000_000,
      )} MB.`,
    );
  }
  validateUploadSignature(bytes, mimeType);
  return {
    fileName,
    mimeType,
    bytes,
    title: examinationText(payload.title, EXAMINATION_LIMITS.maximumTitleCharacters),
    timerMode: timerMode(payload.timerMode),
    durationSeconds: integer(payload.durationSeconds ?? 14_400, 'Duration', 60, 14_400),
    requestKey: examinationRequestKey(payload.requestKey),
    gradingRoute: ['human', 'provisional'].includes(payload.gradingRoute)
      ? payload.gradingRoute
      : 'human',
  };
}

export function safeUploadFileName(value) {
  const input = examinationText(value, 200);
  const extension = input.toLowerCase().endsWith('.docx') ? '.docx' : '.txt';
  const stem = input
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'uploaded-examination';
  return `${stem}${extension}`;
}

export function base64Bytes(encoded) {
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ExaminationValidationError('INVALID_UPLOAD', 'The uploaded file is invalid.');
  }
}

export function validateUploadSignature(bytes, mimeType) {
  if (mimeType === 'text/plain') {
    if (bytes.some((byte) => byte === 0)) {
      throw new ExaminationValidationError(
        'INVALID_TEXT_FILE',
        'The text file contains binary data.',
      );
    }
    return true;
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ExaminationValidationError(
      'INVALID_DOCX_SIGNATURE',
      'The Word document signature is invalid.',
    );
  }
  return true;
}

export async function extractUploadedQuestions(
  bytes,
  mimeType,
  { maximumQuestions = EXAMINATION_LIMITS.maximumExamQuestions } = {},
) {
  const source = mimeType === 'text/plain'
    ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    : await extractDocxText(bytes);
  const normalized = source
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!normalized) {
    throw new ExaminationValidationError(
      'NO_QUESTIONS_FOUND',
      'No readable examination questions were found.',
    );
  }

  const numbered = normalized
    .split(/(?:^|\n)\s*(?:question\s*)?(\d{1,4})[.)]\s+/i)
    .slice(1);
  const questions = [];
  if (numbered.length >= 2) {
    for (let index = 0; index < numbered.length; index += 2) {
      const ordinal = Number(numbered[index]);
      const prompt = examinationText(numbered[index + 1], 20_000);
      if (ordinal && prompt) questions.push({ ordinal, prompt });
    }
  }

  if (!questions.length) {
    const blocks = normalized
      .split(/\n{2,}/)
      .map((block) => examinationText(block, 20_000))
      .filter((block) => block.length >= 20);
    blocks.forEach((prompt, index) => questions.push({ ordinal: index + 1, prompt }));
  }

  const safeMaximum = Number.isSafeInteger(maximumQuestions) && maximumQuestions > 0
    ? maximumQuestions
    : EXAMINATION_LIMITS.maximumExamQuestions;
  const bounded = questions.slice(0, safeMaximum);
  if (!bounded.length) {
    throw new ExaminationValidationError(
      'NO_QUESTIONS_FOUND',
      'No readable examination questions were found.',
    );
  }
  return bounded.map((question, index) => ({
    ordinal: index + 1,
    prompt: question.prompt,
  }));
}

async function extractDocxText(bytes) {
  const entries = parseZipCentralDirectory(bytes);
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) {
    throw new ExaminationValidationError(
      'INVALID_DOCX',
      'The Word document does not contain a readable document body.',
    );
  }
  const xmlBytes = await inflateZipEntry(bytes, documentEntry);
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function little16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function little32(bytes, offset) {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function parseZipCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (little32(bytes, index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) {
    throw new ExaminationValidationError('INVALID_DOCX', 'The Word document is corrupt.');
  }
  const entryCount = little16(bytes, endOffset + 10);
  let offset = little32(bytes, endOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (little32(bytes, offset) !== 0x02014b50) {
      throw new ExaminationValidationError('INVALID_DOCX', 'The Word document is corrupt.');
    }
    const compression = little16(bytes, offset + 10);
    const compressedSize = little32(bytes, offset + 20);
    const uncompressedSize = little32(bytes, offset + 24);
    const nameLength = little16(bytes, offset + 28);
    const extraLength = little16(bytes, offset + 30);
    const commentLength = little16(bytes, offset + 32);
    const localOffset = little32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateZipEntry(bytes, entry) {
  const offset = entry.localOffset;
  if (little32(bytes, offset) !== 0x04034b50) {
    throw new ExaminationValidationError('INVALID_DOCX', 'The Word document is corrupt.');
  }
  const nameLength = little16(bytes, offset + 26);
  const extraLength = little16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression !== 8) {
    throw new ExaminationValidationError(
      'UNSUPPORTED_DOCX',
      'The Word document uses an unsupported compression method.',
    );
  }
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (entry.uncompressedSize && result.length !== entry.uncompressedSize) {
      throw new Error('Size mismatch');
    }
    return result;
  } catch {
    throw new ExaminationValidationError('INVALID_DOCX', 'The Word document is corrupt.');
  }
}

export function normalizedScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 5) {
    throw new ExaminationValidationError(
      'INVALID_EXAMINER_SCORE',
      'Examiner scores must be between 0.0 and 5.0.',
    );
  }
  return Math.round(score * 10) / 10;
}

export function requiredReason(value) {
  const reason = examinationText(value, EXAMINATION_LIMITS.maximumReasonCharacters);
  if (reason.length < 5) {
    throw new ExaminationValidationError(
      'REASON_REQUIRED',
      'Enter a reason of at least five characters.',
    );
  }
  return reason;
}

export function normalizedTimestamp(value, label = 'Date') {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ExaminationValidationError('INVALID_DATE', `${label} is invalid.`);
  }
  return parsed.toISOString();
}

export function examinationDatabaseError(error) {
  const message = String(error?.message || '');
  const known = [
    'EXAM_BETA_ACCESS_REQUIRED',
    'EXAM_ACCESS_REQUIRED',
    'EXAM_PREMIUM_REQUIRED',
    'EXAM_NOT_AVAILABLE',
    'EXAM_VERSION_NOT_FOUND',
    'EXAM_VERSION_IMMUTABLE',
    'EXAM_ATTEMPT_NOT_FOUND',
    'EXAM_ATTEMPT_CLOSED',
    'EXAM_SECOND_TAB_BLOCKED',
    'EXAM_RESPONSE_CONFLICT',
    'EXAM_SUBMISSION_CONFLICT',
    'EXAM_ASSIGNMENT_NOT_FOUND',
    'EXAM_ASSIGNMENT_EXPIRED',
    'EXAM_ASSIGNMENT_FINALIZED',
    'EXAM_MODEL_NOT_AVAILABLE',
    'EXAM_ADMIN_REQUIRED',
    'EXAM_PUBLISH_INCOMPLETE',
    'EXAM_TIMER_MODE_LOCKED',
    'EXAM_UPLOAD_NOT_FOUND',
    'EXAM_ASSIGNMENT_ACTIVE',
    'EXAM_GRADING_JOB_NOT_FOUND',
    'EXAM_GRADING_JOB_CLOSED',
    'EXAM_ACTIVE_ATTEMPTS_EXIST',
  ];
  const code = known.find((candidate) => message.includes(candidate));
  if (!code) return error;
  const publicMessages = {
    EXAM_BETA_ACCESS_REQUIRED: 'This examination beta is limited to authorized test accounts.',
    EXAM_ACCESS_REQUIRED: 'Your current access does not include this examination.',
    EXAM_PREMIUM_REQUIRED: 'Bar Feels requires an active Premium plan.',
    EXAM_NOT_AVAILABLE: 'This examination is not currently available.',
    EXAM_VERSION_NOT_FOUND: 'The examination version could not be found.',
    EXAM_VERSION_IMMUTABLE: 'A published examination version cannot be changed.',
    EXAM_ATTEMPT_NOT_FOUND: 'The examination attempt could not be found.',
    EXAM_ATTEMPT_CLOSED: 'This examination attempt is already closed.',
    EXAM_SECOND_TAB_BLOCKED: 'This examination is active in another browser tab.',
    EXAM_RESPONSE_CONFLICT: 'A newer answer revision exists. Reload before saving again.',
    EXAM_SUBMISSION_CONFLICT: 'This examination was already submitted from another session.',
    EXAM_ASSIGNMENT_NOT_FOUND: 'The examiner assignment could not be found.',
    EXAM_ASSIGNMENT_EXPIRED: 'The examiner assignment has expired.',
    EXAM_ASSIGNMENT_FINALIZED: 'The examiner assessment is already final.',
    EXAM_MODEL_NOT_AVAILABLE: 'Final AI grading requires an authorized model answer and rubric.',
    EXAM_ADMIN_REQUIRED: 'Founder or Super Admin authorization is required.',
    EXAM_PUBLISH_INCOMPLETE: 'The examination is not ready for publication.',
    EXAM_TIMER_MODE_LOCKED: 'This examination requires a different timer mode.',
    EXAM_UPLOAD_NOT_FOUND: 'The private uploaded examination could not be found.',
    EXAM_ASSIGNMENT_ACTIVE: 'This attempt already has an active examiner assignment.',
    EXAM_GRADING_JOB_NOT_FOUND: 'The AI grading job could not be found.',
    EXAM_GRADING_JOB_CLOSED: 'The AI grading job is already closed.',
    EXAM_ACTIVE_ATTEMPTS_EXIST: 'This examination still has active attempts and cannot be closed.',
  };
  const status = [
    'EXAM_BETA_ACCESS_REQUIRED',
    'EXAM_ACCESS_REQUIRED',
    'EXAM_PREMIUM_REQUIRED',
    'EXAM_ADMIN_REQUIRED',
  ].includes(code)
    ? 403
    : code.includes('NOT_FOUND')
      ? 404
      : 409;
  return new ExaminationValidationError(code, publicMessages[code], status);
}
