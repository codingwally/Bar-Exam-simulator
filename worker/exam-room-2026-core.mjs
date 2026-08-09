import {
  base64Bytes,
  extractUploadedQuestions,
} from './examinations-core.mjs';
import {
  DD2026_LIMITS,
  DD2026ValidationError,
  boundedText,
  formulaNeutralizedCell,
  requestKey,
  unicodeLength,
  uuid,
} from './duediligence-2026-core.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const EXAM_ROOM_2026_QUERY_OPERATIONS = new Set([
  'portal',
  'attempt',
  'live_status',
  'grading_workspace',
  'student_result',
  'dispute_view',
]);

export const EXAM_ROOM_2026_COMMAND_OPERATIONS = new Set([
  'issue_activation',
  'redeem_activation',
  'create_classroom',
  'validate_roster',
  'import_roster',
  'create_exam',
  'confirm_questions',
  'schedule_exam',
  'start_attempt',
  'save_answer',
  'heartbeat',
  'integrity_event',
  'submit_attempt',
  'save_grade',
  'unlock_attempt',
  'release_results',
  'open_dispute',
  'close_dispute',
  'admin_correct_grade',
]);

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DD2026ValidationError('INVALID_REQUEST', 'The request must be a JSON object.');
  }
  return value;
}

function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return parsed;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value == null || value === '') return null;
  return integer(value, label, minimum, maximum);
}

function timestamp(value, label) {
  const normalized = boundedText(value, label, 80, { minimum: 1 });
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return date.toISOString();
}

function email(value, label = 'Email') {
  const normalized = boundedText(value, label, 254, { minimum: 3 }).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new DD2026ValidationError('INVALID_EMAIL', `${label} is invalid.`);
  }
  return normalized;
}

function credential(value, label) {
  return boundedText(value, label, 512, { minimum: 12, trim: false });
}

function hexSha(value, label = 'SHA-256 digest') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new DD2026ValidationError('INVALID_DIGEST', `${label} is invalid.`);
  }
  return normalized;
}

function enumValue(value, label, allowed) {
  const normalized = String(value ?? '').trim();
  if (!allowed.includes(normalized)) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function rosterRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DD2026_LIMITS.rosterEntries) {
    throw new DD2026ValidationError(
      'ROSTER_SIZE_INVALID',
      `A roster must contain between 1 and ${DD2026_LIMITS.rosterEntries} students.`,
    );
  }
  return value.map((entry, index) => {
    const row = object(entry);
    return {
      email: email(row.email, `Roster row ${index + 1} email`),
      studentNumber: boundedText(
        row.studentNumber,
        `Roster row ${index + 1} student number`,
        120,
        { minimum: 1 },
      ),
      candidateNumber: boundedText(
        row.candidateNumber,
        `Roster row ${index + 1} candidate number`,
        120,
        { minimum: 1 },
      ),
      displayName: row.displayName
        ? boundedText(row.displayName, `Roster row ${index + 1} display name`, 200)
        : null,
    };
  });
}

function questionRows(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new DD2026ValidationError('QUESTIONS_REQUIRED', 'At least one examination question is required.');
  }
  const rows = value.map((entry, index) => {
    const row = object(entry);
    return {
      ordinal: integer(row.ordinal ?? index + 1, `Question ${index + 1} number`, 1),
      prompt: boundedText(row.prompt, `Question ${index + 1}`, 50_000, { minimum: 1 }),
      maximumPoints: Number(row.maximumPoints ?? 5),
    };
  });
  if (rows.some((row) => !Number.isFinite(row.maximumPoints)
      || row.maximumPoints <= 0 || row.maximumPoints > 1000)) {
    throw new DD2026ValidationError('INVALID_POINTS', 'Question points must be greater than zero.');
  }
  const ordinals = rows.map((row) => row.ordinal);
  if (new Set(ordinals).size !== ordinals.length
      || ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new DD2026ValidationError(
      'QUESTION_SEQUENCE_INVALID',
      'Question numbers must be unique and sequential, beginning with 1.',
    );
  }
  return rows;
}

export function normalizeExamRoomQuery(input) {
  const payload = object(input);
  const operation = enumValue(
    payload.operation,
    'Examination Room operation',
    [...EXAM_ROOM_2026_QUERY_OPERATIONS],
  );
  const normalized = { operation };
  if (operation === 'attempt') {
    normalized.attemptId = uuid(payload.attemptId, 'Attempt');
  } else if (operation === 'live_status' || operation === 'grading_workspace' || operation === 'student_result') {
    normalized.examId = uuid(payload.examId, 'Examination');
    if (operation === 'live_status' || operation === 'grading_workspace') {
      normalized.gradingKey = credential(payload.gradingKey, 'Professor grading key');
    }
  } else if (operation === 'dispute_view') {
    normalized.disputeId = uuid(payload.disputeId, 'Dispute review');
    normalized.disputeKey = credential(payload.disputeKey, 'Dispute review key');
  }
  return normalized;
}

export function normalizeExamRoomCommand(input) {
  const payload = object(input);
  const operation = enumValue(
    payload.operation,
    'Examination Room operation',
    [...EXAM_ROOM_2026_COMMAND_OPERATIONS],
  );
  const n = { operation };
  if (operation === 'issue_activation') {
    n.targetEmail = email(payload.targetEmail, 'Professor email');
    n.activationKey = credential(payload.activationKey, 'Professor activation key');
    n.expiresAt = timestamp(payload.expiresAt, 'Activation expiry');
    n.reason = boundedText(payload.reason, 'Reason', 1_000, { minimum: 5 });
  } else if (operation === 'redeem_activation') {
    n.activationKey = credential(payload.activationKey, 'Professor activation key');
  } else if (operation === 'create_classroom') {
    n.title = boundedText(payload.title, 'Class title', 200, { minimum: 2 });
    n.schoolName = payload.schoolName ? boundedText(payload.schoolName, 'School name', 300) : null;
    n.academicTerm = payload.academicTerm ? boundedText(payload.academicTerm, 'Academic term', 160) : null;
  } else if (operation === 'validate_roster' || operation === 'import_roster') {
    n.classroomId = uuid(payload.classroomId, 'Classroom');
    n.rows = rosterRows(payload.rows);
    if (operation === 'import_roster') {
      n.requestKey = requestKey(payload.requestKey);
      n.sourceHash = hexSha(payload.sourceHash, 'Roster source digest');
    }
  } else if (operation === 'create_exam') {
    n.classroomId = uuid(payload.classroomId, 'Classroom');
    n.title = boundedText(payload.title, 'Exam title', DD2026_LIMITS.examTitleCharacters, { minimum: 1 });
    n.instructions = boundedText(
      payload.instructions ?? '',
      'Exam instructions',
      DD2026_LIMITS.examInstructionsCharacters,
      { trim: false },
    );
    n.questionCount = integer(payload.questionCount, 'Question count', 1);
    n.integrityPreset = enumValue(
      payload.integrityPreset ?? 'standard',
      'Integrity preset',
      ['open_book', 'standard', 'strict'],
    );
    n.includeQuestionnaire = payload.includeQuestionnaire === true;
  } else if (operation === 'confirm_questions') {
    n.examId = uuid(payload.examId, 'Examination');
    n.objectPath = boundedText(payload.objectPath, 'Private source path', 900, { minimum: 3 });
    n.fileName = safeExamRoomFileName(payload.fileName);
    n.mimeType = supportedQuestionMime(payload.mimeType);
    n.sizeBytes = integer(payload.sizeBytes, 'Source size', 1, DD2026_LIMITS.sourceUploadBytes);
    n.pageCount = optionalInteger(payload.pageCount, 'Page count', 1, DD2026_LIMITS.sourceUploadPages);
    n.contentHash = hexSha(payload.contentHash, 'Question source digest');
    n.questions = questionRows(payload.questions);
    if (n.questions.length !== integer(payload.questionCount, 'Confirmed question count', 1)) {
      throw new DD2026ValidationError(
        'QUESTION_COUNT_MISMATCH',
        'The confirmed question count does not match the preview.',
      );
    }
    n.warnings = Array.isArray(payload.warnings)
      ? payload.warnings.slice(0, 100).map((warning) => boundedText(warning, 'Warning', 500))
      : [];
  } else if (operation === 'schedule_exam') {
    n.examId = uuid(payload.examId, 'Examination');
    n.opensAt = timestamp(payload.opensAt, 'Opening time');
    n.hardClosesAt = timestamp(payload.hardClosesAt, 'Hard close');
    n.durationMinutes = optionalInteger(
      payload.durationMinutes,
      'Duration',
      DD2026_LIMITS.examDurationMinutesMinimum,
      DD2026_LIMITS.examDurationMinutesMaximum,
    );
    if (new Date(n.hardClosesAt) <= new Date(n.opensAt)) {
      throw new DD2026ValidationError('INVALID_SCHEDULE', 'Hard close must follow the opening time.');
    }
    n.studentKey = credential(payload.studentKey, 'Student exam key');
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'start_attempt') {
    n.examId = uuid(payload.examId, 'Examination');
    n.studentKey = credential(payload.studentKey, 'Student exam key');
  } else if (operation === 'save_answer') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.questionId = uuid(payload.questionId, 'Question');
    n.answerText = boundedText(
      payload.answerText ?? '',
      'Examination answer',
      DD2026_LIMITS.examAnswerCharacters,
      { trim: false },
    );
    n.expectedRevision = integer(payload.expectedRevision ?? 0, 'Answer revision', 0);
  } else if (operation === 'heartbeat') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
  } else if (operation === 'integrity_event') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.eventType = enumValue(payload.eventType, 'Integrity event', [
      'visibility_exit', 'focus_exit', 'fullscreen_exit', 'copy_attempt',
      'paste_attempt', 'context_menu_attempt', 'network_gap', 'heartbeat_gap',
    ]);
    n.details = sanitizeIntegrityMetadata(payload.details);
  } else if (operation === 'submit_attempt') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'save_grade') {
    n.examId = uuid(payload.examId, 'Examination');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.questionId = uuid(payload.questionId, 'Question');
    n.score = Number(payload.score);
    if (!Number.isFinite(n.score) || n.score < 0 || n.score > 1000) {
      throw new DD2026ValidationError('INVALID_SCORE', 'Enter a valid score.');
    }
    n.comment = boundedText(
      payload.comment ?? '',
      'Professor comment',
      DD2026_LIMITS.professorCommentCharacters,
      { trim: false },
    );
    n.gradeState = enumValue(payload.gradeState, 'Grade state', ['draft', 'final']);
    n.expectedRevision = integer(payload.expectedRevision ?? 0, 'Grade revision', 0);
    n.changeReason = boundedText(payload.changeReason, 'Grade reason', 1_000, { minimum: 5 });
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'unlock_attempt') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.reason = boundedText(payload.reason, 'Unlock reason', 1_000, { minimum: 5 });
    n.gradingKey = payload.gradingKey ? credential(payload.gradingKey, 'Professor grading key') : null;
  } else if (operation === 'release_results') {
    n.examId = uuid(payload.examId, 'Examination');
    n.requestKey = requestKey(payload.requestKey);
    n.includeQuestionnaire = payload.includeQuestionnaire === true;
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'open_dispute') {
    n.examId = uuid(payload.examId, 'Examination');
    n.caseReference = boundedText(payload.caseReference, 'Case reference', 200, { minimum: 2 });
    n.reason = boundedText(payload.reason, 'Dispute reason', 2_000, { minimum: 10 });
    n.accessMode = enumValue(payload.accessMode ?? 'read_only', 'Access mode', ['read_only', 'correction']);
    n.disputeKey = credential(payload.disputeKey, 'Dispute review key');
    n.expiresAt = timestamp(payload.expiresAt, 'Dispute expiry');
  } else if (operation === 'close_dispute') {
    n.disputeId = uuid(payload.disputeId, 'Dispute review');
    n.reason = boundedText(payload.reason, 'Closing reason', 1_000, { minimum: 5 });
  } else if (operation === 'admin_correct_grade') {
    n.disputeId = uuid(payload.disputeId, 'Dispute review');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.questionId = uuid(payload.questionId, 'Question');
    n.score = Number(payload.score);
    if (!Number.isFinite(n.score) || n.score < 0 || n.score > 1000) {
      throw new DD2026ValidationError('INVALID_SCORE', 'Enter a valid corrected score.');
    }
    n.comment = boundedText(
      payload.comment ?? '',
      'Professor comment',
      DD2026_LIMITS.professorCommentCharacters,
      { trim: false },
    );
    n.reason = boundedText(payload.reason, 'Correction reason', 1_000, { minimum: 10 });
    n.disputeKey = credential(payload.disputeKey, 'Dispute review key');
  }
  return n;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'answer', 'answer_text', 'student_answer', 'email', 'ip', 'ip_address',
  'raw_ip', 'token', 'key', 'password', 'api_key', 'service_role_key',
]);

export function sanitizeIntegrityMetadata(value, depth = 0) {
  if (depth > 5) {
    throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'Integrity details are too deeply nested.');
  }
  if (value == null) return {};
  if (Array.isArray(value)) {
    if (value.length > 50) {
      throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'Integrity details contain too many values.');
    }
    return value.map((entry) => sanitizeIntegrityMetadata(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
        throw new DD2026ValidationError(
          'INTEGRITY_DETAILS_SENSITIVE',
          'Integrity details cannot contain answers, contact data, credentials, or network identifiers.',
        );
      }
      if (unicodeLength(key) > 80) {
        throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'An integrity detail name is too long.');
      }
      output[key] = sanitizeIntegrityMetadata(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') return boundedText(value, 'Integrity detail', 500, { trim: false });
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'Integrity details are invalid.');
    return value;
  }
  if (typeof value === 'boolean') return value;
  throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'Integrity details are invalid.');
}

export function supportedQuestionMime(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (![
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ].includes(normalized)) {
    throw new DD2026ValidationError(
      'UNSUPPORTED_FILE_TYPE',
      'Upload a UTF-8 text (.txt) or Word (.docx) examination file.',
    );
  }
  return normalized;
}

export function safeExamRoomFileName(value) {
  const input = boundedText(value, 'File name', 200, { minimum: 1 });
  const lower = input.toLowerCase();
  const extension = lower.endsWith('.docx') ? '.docx' : lower.endsWith('.txt') ? '.txt' : '';
  if (!extension) {
    throw new DD2026ValidationError('UNSUPPORTED_FILE_TYPE', 'Use a .txt or .docx question file.');
  }
  const stem = input
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'examination-questions';
  return `${stem}${extension}`;
}

export async function normalizeQuestionUpload(input) {
  const payload = object(input);
  const examId = uuid(payload.examId, 'Examination');
  const questionCount = integer(payload.questionCount, 'Question count', 1);
  const fileName = safeExamRoomFileName(payload.fileName);
  const mimeType = supportedQuestionMime(payload.mimeType);
  const encoded = String(payload.base64 ?? '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new DD2026ValidationError('INVALID_UPLOAD', 'The question file is invalid.');
  }
  const bytes = base64Bytes(encoded);
  if (!bytes.length || bytes.length > DD2026_LIMITS.sourceUploadBytes) {
    throw new DD2026ValidationError(
      'UPLOAD_SIZE_INVALID',
      'Question files must be no larger than 10 MB.',
    );
  }
  if (mimeType === 'text/plain' && bytes.some((byte) => byte === 0)) {
    throw new DD2026ValidationError('INVALID_TEXT_FILE', 'The text file contains binary data.');
  }
  if (mimeType.endsWith('document') && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
    throw new DD2026ValidationError('INVALID_DOCX_SIGNATURE', 'The Word file signature is invalid.');
  }
  const questions = await extractUploadedQuestions(bytes, mimeType, { maximumQuestions: questionCount + 1 });
  const warnings = [];
  if (questions.length !== questionCount) {
    warnings.push(`Detected ${questions.length} questions; the professor selected ${questionCount}. Correct the preview before confirming.`);
  }
  return {
    examId,
    questionCount,
    fileName,
    mimeType,
    bytes,
    questions,
    warnings,
    contentHash: await sha256Hex(bytes),
    pageCount: null,
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new DD2026ValidationError('ROSTER_CSV_INVALID', 'The CSV contains an unclosed quoted field.');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => String(value).trim()));
}

function normalizedRosterTable(rows) {
  if (rows.length < 2) throw new DD2026ValidationError('ROSTER_EMPTY', 'The roster contains no student rows.');
  const aliases = new Map([
    ['email', 'email'], ['email address', 'email'],
    ['student number', 'studentNumber'], ['student no', 'studentNumber'], ['student id', 'studentNumber'],
    ['candidate number', 'candidateNumber'], ['candidate no', 'candidateNumber'], ['candidate id', 'candidateNumber'],
    ['display name', 'displayName'], ['name', 'displayName'], ['student name', 'displayName'],
  ]);
  const headers = rows[0].map((value) => aliases.get(String(value).trim().toLowerCase()) || null);
  for (const required of ['email', 'studentNumber', 'candidateNumber']) {
    if (!headers.includes(required)) {
      throw new DD2026ValidationError('ROSTER_COLUMNS_MISSING', `Roster column “${required}” is required.`);
    }
  }
  return rosterRows(rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']).filter(([header]) => header),
  )));
}

export async function normalizeRosterUpload(input) {
  const payload = object(input);
  const classroomId = uuid(payload.classroomId, 'Classroom');
  const fileName = boundedText(payload.fileName, 'Roster file name', 200, { minimum: 1 });
  const mimeType = String(payload.mimeType ?? '').trim().toLowerCase();
  if (!['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mimeType)) {
    throw new DD2026ValidationError('UNSUPPORTED_ROSTER_TYPE', 'Upload a CSV or XLSX roster.');
  }
  const encoded = String(payload.base64 ?? '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new DD2026ValidationError('INVALID_ROSTER_UPLOAD', 'The roster file is invalid.');
  }
  const bytes = base64Bytes(encoded);
  if (!bytes.length || bytes.length > DD2026_LIMITS.rosterUploadBytes) {
    throw new DD2026ValidationError('ROSTER_SIZE_INVALID', 'Roster files must be no larger than 2 MB.');
  }
  let rows;
  if (mimeType === 'text/csv') {
    rows = parseCsvRows(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new DD2026ValidationError('INVALID_XLSX_SIGNATURE', 'The Excel file signature is invalid.');
    }
    rows = await extractFirstXlsxSheet(bytes);
  }
  return {
    classroomId,
    fileName,
    mimeType,
    rows: normalizedRosterTable(rows),
    sourceHash: await sha256Hex(bytes),
  };
}

function little16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function little32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function zipEntries(bytes) {
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (little32(bytes, index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file is corrupt.');
  const count = little16(bytes, end + 10);
  let offset = little32(bytes, end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (little32(bytes, offset) !== 0x02014b50) {
      throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file is corrupt.');
    }
    const entry = {
      compression: little16(bytes, offset + 10),
      compressedSize: little32(bytes, offset + 20),
      uncompressedSize: little32(bytes, offset + 24),
      localOffset: little32(bytes, offset + 42),
    };
    const nameLength = little16(bytes, offset + 28);
    const extraLength = little16(bytes, offset + 30);
    const commentLength = little16(bytes, offset + 32);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function zipText(bytes, entry) {
  const offset = entry.localOffset;
  if (little32(bytes, offset) !== 0x04034b50) {
    throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file is corrupt.');
  }
  const nameLength = little16(bytes, offset + 26);
  const extraLength = little16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  let result;
  if (entry.compression === 0) result = compressed;
  else if (entry.compression === 8) {
    result = new Uint8Array(await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).arrayBuffer());
  } else throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file uses unsupported compression.');
  if (result.length > 5_000_000 || (entry.uncompressedSize && result.length !== entry.uncompressedSize)) {
    throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file is unsafe or corrupt.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(result);
}

function xmlText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

async function extractFirstXlsxSheet(bytes) {
  const entries = zipEntries(bytes);
  const sheetEntry = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetEntry) throw new DD2026ValidationError('INVALID_XLSX', 'The Excel file has no first worksheet.');
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry
    ? [...(await zipText(bytes, sharedEntry)).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]))
    : [];
  const xml = await zipText(bytes, sheetEntry);
  if (/<f\b/i.test(xml)) {
    throw new DD2026ValidationError('ROSTER_FORMULA_REJECTED', 'Roster spreadsheets cannot contain formulas.');
  }
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || 'A1';
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || '';
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        ?? body.match(/<is>([\s\S]*?)<\/is>/)?.[1]
        ?? '';
      const value = type === 's' ? shared[Number(raw)] ?? '' : xmlText(raw);
      row[columnIndex(reference)] = value;
    }
    rows.push(row.map((value) => value ?? ''));
  }
  return rows;
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashedCredential(value) {
  return sha256Hex(credential(value, 'Credential'));
}

export async function examRoomRateKey(request, userId, resource = '') {
  const address = request.headers.get('CF-Connecting-IP') || 'unavailable';
  return sha256Hex(`${userId}|${resource}|${address}`);
}

export function backupRowValues(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  return Object.entries({
    event_id: event?.id,
    sequence: event?.sequence_number,
    event_type: event?.event_type,
    payload_hash: event?.payload_hash,
    created_at: event?.created_at,
    ...payload,
  }).map(([key, value]) => [formulaNeutralizedCell(key), formulaNeutralizedCell(
    typeof value === 'string' ? value : JSON.stringify(value ?? null),
  )]);
}
