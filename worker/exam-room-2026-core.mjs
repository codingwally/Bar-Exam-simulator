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
export const EXAM_ROOM_2026_MAX_QUESTIONS = 200;
export const EXAM_ROOM_HANDOFF_MINIMUM_LEAD_MINUTES = 0;
export const EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION = 'beadle-roster-v1';
export const EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS = Object.freeze([
  'Email Address',
  'Student Number',
  'Student Name (Last Name, First Name, Middle Initial)',
]);
export const EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE =
  'Use the official Beadle class-list template. Do not add, remove, or rename columns.';

export const EXAM_ROOM_2026_QUERY_OPERATIONS = new Set([
  'portal',
  'room_requests',
  'payment_proof_review',
  'activation_ledger',
  'exam_intent',
  'professor_authoring_snapshot',
  'preflight',
  'student_entry',
  'beadle_student_entry',
  'beadle_portal',
  'incident_summary',
  'attempt',
  'submission_status',
  'live_status',
  'live_status_v2',
  'grading_workspace',
  'results_dashboard',
  'result_delivery_report',
  'grading_model_answer',
  'break_glass_view',
  'student_result',
  'dispute_view',
]);

export const EXAM_ROOM_2026_COMMAND_OPERATIONS = new Set([
  'submit_room_request',
  'claim_room_request',
  'prepare_room_quotation',
  'send_room_quotation',
  'generate_provisional_room_key',
  'review_room_payment',
  'issue_activation',
  'redeem_activation',
  'revoke_activation',
  'create_classroom',
  'validate_roster',
  'import_roster',
  'validate_exam_roster',
  'import_exam_roster',
  'create_exam',
  'update_exam_details',
  'confirm_questions',
  'revise_draft_questions',
  'save_rules_draft',
  'confirm_replacement_questions',
  'schedule_exam',
  'publish_exam',
  'publish_for_beadle',
  'reschedule_publication',
  'replace_publication',
  'invite_beadle',
  'redeem_beadle_invitation',
  'revoke_beadle',
  'issue_student_access',
  'finalize_roster_access',
  'reopen_exam_roster',
  'record_candidate_verification',
  'set_candidate_admission',
  'set_accommodation',
  'start_attempt',
  'start_attempt_by_code',
  'start_beadle_attempt',
  'open_exam_now',
  'dismiss_past_exam',
  'open_session',
  'save_answer',
  'save_answer_operation',
  'heartbeat',
  'heartbeat_v2',
  'integrity_event',
  'record_integrity_event',
  'submit_attempt',
  'submit_attempt_generation',
  'reopen_submission',
  'transfer_session',
  'issue_erratum',
  'start_leave',
  'end_leave',
  'acknowledge_leave',
  'record_technical_incident',
  'issue_break_glass',
  'close_break_glass',
  'record_break_glass_review',
  'save_grade',
  'unlock_attempt',
  'release_results',
  'retry_student_result_email',
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

function optionalTimestamp(value, label) {
  if (value == null || value === '') return null;
  return timestamp(value, label);
}

function boolean(value, label, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function timestamp(value, label) {
  const normalized = boundedText(value, label, 80, { minimum: 1 });
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return date.toISOString();
}

function calendarDate(value, label) {
  const normalized = boundedText(value, label, 10, { minimum: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)
      || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function clockTime(value, label) {
  const normalized = boundedText(value, label, 8, { minimum: 5 });
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(normalized)) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return normalized;
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

function activationExpiry(value) {
  const normalized = timestamp(value, 'Activation expiry');
  const target = new Date(normalized).getTime();
  const now = Date.now();
  if (target <= now || target > now + 7 * 24 * 60 * 60 * 1_000) {
    throw new DD2026ValidationError(
      'INVALID_REQUEST',
      'Activation expiry must be in the future and no more than seven days from now.',
    );
  }
  return normalized;
}

function optionalCredential(value, label) {
  if (value == null || value === '') return null;
  return credential(value, label);
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

function classroomRosterRows(value) {
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
      displayName: boundedText(
        row.displayName ?? row.name,
        `Roster row ${index + 1} student name`,
        200,
        { minimum: 2 },
      ),
      studentNumber: row.studentNumber
        ? boundedText(row.studentNumber, `Roster row ${index + 1} student number`, 120)
        : null,
      candidateNumber: row.candidateNumber
        ? boundedText(row.candidateNumber, `Roster row ${index + 1} candidate number`, 120)
        : null,
    };
  });
}

function questionRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > EXAM_ROOM_2026_MAX_QUESTIONS) {
    throw new DD2026ValidationError(
      'QUESTIONS_REQUIRED',
      `Provide between 1 and ${EXAM_ROOM_2026_MAX_QUESTIONS} examination questions.`,
    );
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

function requiredRosterTemplateReceipt(value, version) {
  if (String(version ?? '').trim() !== EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED',
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE,
    );
  }
  try {
    return uuid(value, 'Beadle class-list template receipt');
  } catch {
    throw new DD2026ValidationError(
      'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED',
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE,
    );
  }
}

function optionalUuid(value, label) {
  if (value == null || value === '') return null;
  return uuid(value, label);
}

function uuidRows(value, label, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} is invalid.`);
  }
  const rows = value.map((entry) => uuid(entry, label));
  if (new Set(rows).size !== rows.length) {
    throw new DD2026ValidationError('INVALID_REQUEST', `${label} cannot contain duplicates.`);
  }
  return rows;
}

function examRules(value) {
  const rules = object(value);
  const opensAt = timestamp(rules.opensAt, 'Opening time');
  const hardClosesAt = timestamp(rules.hardClosesAt, 'Hard close');
  if (new Date(hardClosesAt) <= new Date(opensAt)) {
    throw new DD2026ValidationError('INVALID_SCHEDULE', 'Hard close must follow the opening time.');
  }
  const suggestedAnswerMode = enumValue(
    rules.suggestedAnswerMode ?? 'none',
    'Suggested-answer mode',
    ['none', 'paste', 'upload'],
  );
  if (suggestedAnswerMode === 'upload') {
    throw new DD2026ValidationError(
      'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE',
      'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.',
    );
  }
  const suggestedAnswer = rules.suggestedAnswer == null
    ? null
    : boundedText(rules.suggestedAnswer, 'Suggested answer', 100_000, { trim: false });
  if (suggestedAnswerMode === 'paste' && !suggestedAnswer?.trim()) {
    throw new DD2026ValidationError(
      'SUGGESTED_ANSWER_REQUIRED',
      'Paste a suggested answer or select no suggested answer.',
    );
  }
  if (suggestedAnswerMode !== 'paste' && suggestedAnswer) {
    throw new DD2026ValidationError(
      'SUGGESTED_ANSWER_MODE_MISMATCH',
      'Suggested-answer text is accepted only when paste mode is selected.',
    );
  }
  const suggestedAnswerObjectPath = rules.suggestedAnswerObjectPath == null
    ? null
    : boundedText(rules.suggestedAnswerObjectPath, 'Suggested-answer source', 900, { minimum: 3 });
  if (suggestedAnswerMode === 'upload' && !suggestedAnswerObjectPath) {
    throw new DD2026ValidationError(
      'SUGGESTED_ANSWER_SOURCE_REQUIRED',
      'Upload a suggested-answer source or select no suggested answer.',
    );
  }
  if (suggestedAnswerMode !== 'upload' && suggestedAnswerObjectPath) {
    throw new DD2026ValidationError(
      'SUGGESTED_ANSWER_MODE_MISMATCH',
      'A suggested-answer source is accepted only when upload mode is selected.',
    );
  }
  if (rules.aiGradingEnabled === true) {
    throw new DD2026ValidationError(
      'AI_GRADING_UNAVAILABLE',
      'AI-assisted institutional grading is not enabled for this beta.',
    );
  }
  const navigationMode = enumValue(
    rules.navigationMode ?? 'free',
    'Navigation mode',
    ['free', 'one_way'],
  );
  if (navigationMode === 'one_way') {
    throw new DD2026ValidationError(
      'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE',
      'One-way navigation is unavailable until durable server-side progress enforcement is enabled. Choose free navigation.',
    );
  }
  return {
    opensAt,
    hardClosesAt,
    durationMinutes: optionalInteger(
      rules.durationMinutes,
      'Duration',
      DD2026_LIMITS.examDurationMinutesMinimum,
      DD2026_LIMITS.examDurationMinutesMaximum,
    ),
    lateAdmissionMinutes: integer(rules.lateAdmissionMinutes ?? 0, 'Late-admission allowance', 0, 480),
    submissionGraceMinutes: integer(rules.submissionGraceMinutes ?? 0, 'Submission grace', 0, 120),
    allowedMaterials: boundedText(rules.allowedMaterials ?? '', 'Allowed materials', 2_000, { trim: false }),
    navigationMode,
    integrityMode: enumValue(
      rules.integrityMode ?? 'record_only',
      'Integrity-monitoring mode',
      ['off', 'record_only', 'warn_and_record'],
    ),
    fullscreenPolicy: enumValue(
      rules.fullscreenPolicy ?? 'off',
      'Fullscreen policy',
      ['off', 'requested', 'required_with_exemptions'],
    ),
    admissionMode: enumValue(
      rules.admissionMode ?? 'automatic',
      'Admission mode',
      ['automatic', 'beadle_approval'],
    ),
    temporaryLeaveAcknowledgment: boolean(
      rules.temporaryLeaveAcknowledgment,
      'Temporary-leave acknowledgment',
      false,
    ),
    studentAccessCodeRequired: boolean(
      rules.studentAccessCodeRequired,
      'Student access-code requirement',
      true,
    ),
    suggestedAnswerMode,
    suggestedAnswer,
    suggestedAnswerObjectPath,
    aiGradingEnabled: false,
  };
}

function boundedFutureTimestamp(value, label, maximumFutureMilliseconds) {
  const normalized = timestamp(value, label);
  const now = Date.now();
  const target = new Date(normalized).getTime();
  if (target <= now || target > now + maximumFutureMilliseconds) {
    throw new DD2026ValidationError(
      'INVALID_REQUEST',
      `${label} must be in the future and no more than four hours from now.`,
    );
  }
  return normalized;
}

function accommodation(value) {
  const entry = object(value);
  return {
    extraMinutes: integer(entry.extraMinutes ?? 0, 'Additional time', 0, 480),
    individualOpensAt: optionalTimestamp(entry.individualOpensAt, 'Individual opening time'),
    individualHardClosesAt: optionalTimestamp(entry.individualHardClosesAt, 'Individual hard close'),
    breakMinutes: integer(entry.breakMinutes ?? 0, 'Permitted breaks', 0, 240),
    cameraExempt: boolean(entry.cameraExempt, 'Camera exemption', false),
    fullscreenExempt: boolean(entry.fullscreenExempt, 'Fullscreen exemption', false),
    integrityExempt: boolean(
      entry.integrityExempt,
      'Integrity-monitoring exemption',
      false,
    ),
    assistiveTechnology: boolean(
      entry.assistiveTechnology,
      'Assistive-technology allowance',
      false,
    ),
    permittedAids: boundedText(
      entry.permittedAids ?? '',
      'Approved writing aids',
      1_000,
      { trim: false },
    ),
    incidentExtensionMinutes: integer(entry.incidentExtensionMinutes ?? 0, 'Incident extension', 0, 480),
    operationalNote: boundedText(entry.operationalNote ?? '', 'Operational note', 1_000, { trim: false }),
  };
}

export function normalizeExamRoomQuery(input) {
  const payload = object(input);
  const operation = enumValue(
    payload.operation,
    'Examination Room operation',
    [...EXAM_ROOM_2026_QUERY_OPERATIONS],
  );
  const normalized = { operation };
  if (operation === 'activation_ledger') {
    normalized.status = enumValue(
      payload.status ?? 'all',
      'Professor invitation status',
      ['all', 'issued', 'redeemed', 'expired', 'revoked', 'locked'],
    );
    normalized.limit = integer(payload.limit ?? 200, 'Professor invitation limit', 1, 200);
    normalized.offset = integer(payload.offset ?? 0, 'Professor invitation offset', 0, 100_000);
  } else if (operation === 'room_requests') {
    // The authenticated user is the complete authorization scope.
  } else if (operation === 'payment_proof_review') {
    normalized.requestId = uuid(payload.requestId, 'Examination Room request');
    normalized.proofId = optionalUuid(payload.proofId, 'Payment proof');
  } else if (operation === 'exam_intent'
      || operation === 'professor_authoring_snapshot'
      || operation === 'results_dashboard'
      || operation === 'result_delivery_report') {
    normalized.examId = uuid(payload.examId, 'Examination');
  } else if (operation === 'preflight') {
    normalized.examId = uuid(payload.examId, 'Examination');
    normalized.studentKey = optionalCredential(
      payload.studentKey,
      'Student exam access code',
    );
    normalized.deviceInstanceHash = payload.deviceInstanceHash
      ? hexSha(payload.deviceInstanceHash, 'Device instance digest')
      : null;
  } else if (operation === 'student_entry') {
    normalized.studentKey = credential(payload.studentKey, 'Student exam access code');
    normalized.deviceInstanceHash = payload.deviceInstanceHash
      ? hexSha(payload.deviceInstanceHash, 'Device instance digest')
      : null;
  } else if (operation === 'beadle_student_entry') {
    normalized.examId = uuid(payload.examId, 'Examination');
    normalized.deviceInstanceHash = payload.deviceInstanceHash
      ? hexSha(payload.deviceInstanceHash, 'Device instance digest')
      : null;
  } else if (operation === 'beadle_portal') {
    normalized.examId = optionalUuid(payload.examId, 'Examination');
  } else if (operation === 'incident_summary') {
    normalized.examId = uuid(payload.examId, 'Examination');
  } else if (operation === 'attempt') {
    normalized.attemptId = uuid(payload.attemptId, 'Attempt');
    normalized.sessionId = optionalUuid(payload.sessionId, 'Examination session');
    normalized.sessionEpoch = optionalInteger(payload.sessionEpoch, 'Session epoch', 1);
    if (Boolean(normalized.sessionId) !== Boolean(normalized.sessionEpoch)) {
      throw new DD2026ValidationError(
        'SESSION_SCOPE_REQUIRED',
        'Provide both the examination session and its epoch.',
      );
    }
  } else if (operation === 'submission_status') {
    normalized.attemptId = uuid(payload.attemptId, 'Attempt');
  } else if (operation === 'break_glass_view') {
    normalized.grantId = uuid(payload.grantId, 'Break-glass grant');
    normalized.examId = uuid(payload.examId, 'Examination');
    normalized.attemptId = uuid(payload.attemptId, 'Attempt');
    normalized.candidateNumber = boundedText(
      payload.candidateNumber,
      'Candidate number',
      120,
      { minimum: 1 },
    );
    normalized.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'live_status'
      || operation === 'live_status_v2'
      || operation === 'grading_workspace'
      || operation === 'grading_model_answer'
      || operation === 'student_result') {
    normalized.examId = uuid(payload.examId, 'Examination');
    if (operation === 'live_status'
        || operation === 'live_status_v2') {
      normalized.gradingKey = credential(payload.gradingKey, 'Professor grading key');
    } else if (operation === 'grading_workspace'
        || operation === 'grading_model_answer') {
      normalized.gradingKey = optionalCredential(payload.gradingKey, 'Professor grading key');
    }
  } else if (operation === 'dispute_view') {
    normalized.disputeId = uuid(payload.disputeId, 'Dispute review');
    normalized.disputeKey = credential(payload.disputeKey, 'Dispute review key');
  }
  return normalized;
}

export function normalizeExamResultPdfRequest(input) {
  const payload = object(input);
  return {
    examId: uuid(payload.examId, 'Examination'),
    attemptId: uuid(payload.attemptId, 'Attempt'),
    scope: enumValue(payload.scope, 'Result download', [
      'questions_answers',
      'answers_only',
      'grades_comments',
    ]),
    gradingKey: credential(payload.gradingKey, 'Professor grading key'),
    requestKey: requestKey(payload.requestKey),
  };
}

export function normalizeExamClassResultsWorkbookRequest(input) {
  const payload = object(input);
  const attemptIds = uuidRows(payload.attemptIds, 'Selected examination attempt');
  if (attemptIds.length < 1) {
    throw new DD2026ValidationError(
      'INVALID_REQUEST',
      'Select at least one submitted student examination.',
    );
  }
  return {
    examId: uuid(payload.examId, 'Examination'),
    attemptIds,
    scope: enumValue(payload.scope, 'Class result workbook', [
      'offline_grading',
      'class_results',
    ]),
    requestKey: requestKey(payload.requestKey),
  };
}

export function normalizeExamRoomCommand(input) {
  const payload = object(input);
  const operation = enumValue(
    payload.operation,
    'Examination Room operation',
    [...EXAM_ROOM_2026_COMMAND_OPERATIONS],
  );
  const n = { operation };
  if (operation === 'submit_room_request') {
    n.professorName = boundedText(payload.professorName, 'Professor name', 200, { minimum: 2 });
    n.schoolName = boundedText(payload.schoolName, 'School name', 300, { minimum: 2 });
    n.courseSubject = boundedText(payload.courseSubject, 'Course or subject', 200, { minimum: 2 });
    n.examinationTitle = boundedText(payload.examinationTitle, 'Examination title', 200, { minimum: 2 });
    n.examinationDate = calendarDate(payload.examinationDate, 'Examination date');
    n.startTime = clockTime(payload.startTime, 'Start time');
    n.timeZone = boundedText(payload.timeZone ?? 'Asia/Manila', 'Time zone', 80, { minimum: 3 });
    n.expectedDurationMinutes = integer(payload.expectedDurationMinutes, 'Expected duration', 15, 480);
    n.estimatedStudentCount = integer(payload.estimatedStudentCount, 'Estimated student count', 1, 500);
    n.examinationType = enumValue(payload.examinationType ?? 'essay', 'Examination type', ['essay']);
    n.quotationRecipient = enumValue(
      payload.quotationRecipient ?? 'professor',
      'Quotation recipient',
      ['professor', 'beadle'],
    );
    n.beadleName = payload.beadleName
      ? boundedText(payload.beadleName, 'Beadle name', 200, { minimum: 2 })
      : null;
    n.beadleEmail = payload.beadleEmail ? email(payload.beadleEmail, 'Beadle email') : null;
    if (n.quotationRecipient === 'beadle' && (!n.beadleName || !n.beadleEmail)) {
      throw new DD2026ValidationError(
        'INVALID_REQUEST',
        'Enter the Beadle name and email before sending the quotation to the Beadle.',
      );
    }
    n.notes = boundedText(payload.notes ?? '', 'Request notes', 3_000, { trim: false });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'claim_room_request') {
    n.requestId = uuid(payload.requestId, 'Examination Room request');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'prepare_room_quotation') {
    n.requestId = uuid(payload.requestId, 'Examination Room request');
    n.amountCentavos = integer(payload.amountCentavos, 'Quotation amount', 1, 1_000_000_000);
    n.notes = boundedText(payload.notes ?? '', 'Quotation notes', 3_000, { trim: false });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'send_room_quotation') {
    n.requestId = uuid(payload.requestId, 'Examination Room request');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'generate_provisional_room_key') {
    n.requestId = uuid(payload.requestId, 'Examination Room request');
    n.expiresAt = activationExpiry(payload.expiresAt);
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'review_room_payment') {
    n.requestId = uuid(payload.requestId, 'Examination Room request');
    n.proofId = uuid(payload.proofId, 'Payment proof');
    n.decision = enumValue(payload.decision, 'Payment review', ['verified', 'rejected']);
    n.reason = boundedText(payload.reason ?? '', 'Payment review reason', 1_000, { trim: true });
    if (n.decision === 'rejected' && n.reason.length < 5) {
      throw new DD2026ValidationError(
        'INVALID_REQUEST',
        'Explain why the payment proof was rejected.',
      );
    }
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'issue_activation') {
    n.targetEmail = email(payload.targetEmail, 'Professor email');
    n.activationKey = credential(payload.activationKey, 'Professor activation key');
    n.roomTitle = boundedText(payload.roomTitle, 'Examination Room title', 200, { minimum: 2 });
    n.schoolName = boundedText(payload.schoolName, 'School name', 300, { minimum: 2 });
    n.academicTerm = boundedText(payload.academicTerm, 'Academic term', 160, { minimum: 1 });
    n.expiresAt = activationExpiry(payload.expiresAt);
    n.reason = boundedText(payload.reason, 'Reason', 1_000, { minimum: 5 });
  } else if (operation === 'redeem_activation') {
    n.activationKey = credential(payload.activationKey, 'Professor activation key');
  } else if (operation === 'revoke_activation') {
    n.activationId = uuid(payload.activationId, 'Professor invitation');
    n.reason = boundedText(payload.reason, 'Revocation reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
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
  } else if (operation === 'validate_exam_roster' || operation === 'import_exam_roster') {
    n.examId = uuid(payload.examId, 'Examination');
    n.rows = rosterRows(payload.rows);
    if (operation === 'import_exam_roster') {
      n.requestKey = requestKey(payload.requestKey);
      n.sourceHash = hexSha(payload.sourceHash, 'Roster source digest');
      n.templateReceiptId = requiredRosterTemplateReceipt(
        payload.templateReceiptId,
        payload.templateVersion,
      );
      n.templateVersion = EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION;
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
    n.questionCount = integer(
      payload.questionCount,
      'Question count',
      1,
      EXAM_ROOM_2026_MAX_QUESTIONS,
    );
    n.integrityPreset = enumValue(
      payload.integrityPreset ?? 'standard',
      'Integrity preset',
      ['open_book', 'standard', 'strict'],
    );
    n.includeQuestionnaire = payload.includeQuestionnaire === true;
  } else if (operation === 'update_exam_details') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedRevision = integer(payload.expectedRevision, 'Workspace revision', 1);
    n.title = boundedText(payload.title, 'Exam title', DD2026_LIMITS.examTitleCharacters, { minimum: 1 });
    n.instructions = boundedText(
      payload.instructions ?? '',
      'Exam instructions',
      DD2026_LIMITS.examInstructionsCharacters,
      { trim: false },
    );
    n.questionCount = integer(
      payload.questionCount,
      'Question count',
      1,
      EXAM_ROOM_2026_MAX_QUESTIONS,
    );
    n.integrityPreset = enumValue(
      payload.integrityPreset ?? 'standard',
      'Integrity preset',
      ['open_book', 'standard', 'strict'],
    );
    n.includeQuestionnaire = boolean(
      payload.includeQuestionnaire,
      'Student result questionnaire',
      false,
    );
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'confirm_questions' || operation === 'confirm_replacement_questions') {
    n.examId = uuid(payload.examId, 'Examination');
    n.objectPath = boundedText(payload.objectPath, 'Private source path', 900, { minimum: 3 });
    n.fileName = safeExamRoomFileName(payload.fileName);
    n.mimeType = supportedQuestionMime(payload.mimeType);
    n.sizeBytes = integer(payload.sizeBytes, 'Source size', 1, DD2026_LIMITS.sourceUploadBytes);
    n.pageCount = optionalInteger(payload.pageCount, 'Page count', 1, DD2026_LIMITS.sourceUploadPages);
    n.contentHash = hexSha(payload.contentHash, 'Question source digest');
    n.questions = questionRows(payload.questions);
    if (n.questions.length !== integer(
      payload.questionCount,
      'Confirmed question count',
      1,
      EXAM_ROOM_2026_MAX_QUESTIONS,
    )) {
      throw new DD2026ValidationError(
        'QUESTION_COUNT_MISMATCH',
        'The confirmed question count does not match the preview.',
      );
    }
    n.warnings = Array.isArray(payload.warnings)
      ? payload.warnings.slice(0, 100).map((warning) => boundedText(warning, 'Warning', 500))
      : [];
    if (operation === 'confirm_replacement_questions') {
      n.expectedPublicationId = uuid(payload.expectedPublicationId, 'Expected publication');
      n.requestKey = requestKey(payload.requestKey);
    }
  } else if (operation === 'revise_draft_questions') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedRevision = integer(payload.expectedRevision, 'Workspace revision', 1);
    n.expectedQuestionVersionId = uuid(
      payload.expectedQuestionVersionId,
      'Expected question version',
    );
    n.questions = questionRows(payload.questions);
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'save_rules_draft') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedRevision = integer(payload.expectedRevision, 'Workspace revision', 1);
    n.rules = examRules(payload.rules);
    if (n.rules.studentAccessCodeRequired !== true) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_CLASS_HANDOFF_INVALID',
        'The Beadle handoff requires one class-wide student exam code.',
      );
    }
    n.beadleEmail = email(payload.beadleEmail, 'Beadle email');
    n.requestKey = requestKey(payload.requestKey);
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
    n.studentKey = optionalCredential(payload.studentKey, 'Student exam access code');
    n.gradingKey = optionalCredential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'publish_exam') {
    n.examId = uuid(payload.examId, 'Examination');
    n.rules = examRules(payload.rules);
    n.studentKey = optionalCredential(payload.studentKey, 'Student exam access code');
    if (n.rules.studentAccessCodeRequired !== Boolean(n.studentKey)) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_PUBLICATION_CREDENTIAL_INVALID',
        n.rules.studentAccessCodeRequired
          ? 'Re-enter the student access code before publishing this immutable examination version.'
          : 'Remove the student access code when access-code protection is disabled.',
      );
    }
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'publish_for_beadle') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedRevision = integer(payload.expectedRevision, 'Workspace revision', 1);
    n.rules = examRules(payload.rules);
    if (n.rules.studentAccessCodeRequired !== true) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_STUDENT_ACCESS_POLICY_REQUIRED',
        'Student access-code protection must be enabled for the Beadle handoff.',
      );
    }
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
    n.beadleEmail = email(payload.beadleEmail, 'Beadle email');
    n.beadleInvitationKey = credential(
      payload.beadleInvitationKey,
      'Beadle invitation key',
    );
    n.beadleExpiresAt = timestamp(payload.beadleExpiresAt, 'Beadle invitation expiry');
    n.reason = boundedText(payload.reason, 'Delegation reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'reschedule_publication') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedPublicationId = uuid(
      payload.expectedPublicationId,
      'Expected publication',
    );
    n.expectedWorkspaceRevision = integer(
      payload.expectedWorkspaceRevision,
      'Workspace revision',
      1,
    );
    n.opensAt = timestamp(payload.opensAt, 'Opening time');
    n.hardClosesAt = timestamp(payload.hardClosesAt, 'Hard close');
    n.durationMinutes = integer(
      payload.durationMinutes,
      'Duration',
      DD2026_LIMITS.examDurationMinutesMinimum,
      DD2026_LIMITS.examDurationMinutesMaximum,
    );
    n.lateAdmissionMinutes = integer(
      payload.lateAdmissionMinutes,
      'Late entry',
      0,
      480,
    );
    n.submissionGraceMinutes = integer(
      payload.submissionGraceMinutes,
      'Reconnect and submission time',
      0,
      120,
    );
    if (new Date(n.hardClosesAt) <= new Date(n.opensAt)) {
      throw new DD2026ValidationError(
        'INVALID_SCHEDULE',
        'The examination must end after it opens.',
      );
    }
    n.reason = boundedText(
      payload.reason,
      'Schedule change reason',
      1_000,
      { minimum: 10 },
    );
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'replace_publication') {
    n.examId = uuid(payload.examId, 'Examination');
    n.expectedPublicationId = uuid(payload.expectedPublicationId, 'Expected publication');
    n.replacementQuestionVersionId = uuid(
      payload.replacementQuestionVersionId,
      'Replacement question version',
    );
    n.rules = examRules(payload.rules);
    n.studentKey = optionalCredential(payload.studentKey, 'Student exam access code');
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
    if (n.rules.studentAccessCodeRequired !== Boolean(n.studentKey)) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_REPLACEMENT_CREDENTIAL_INVALID',
        n.rules.studentAccessCodeRequired
          ? 'Provide a new student access code for this replacement publication.'
          : 'Remove the student access code when access-code protection is disabled.',
      );
    }
    n.reason = boundedText(payload.reason, 'Replacement reason', 1_000, { minimum: 10 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'invite_beadle') {
    n.examId = uuid(payload.examId, 'Examination');
    n.targetEmail = email(payload.targetEmail, 'Beadle email');
    n.invitationKey = credential(payload.invitationKey, 'Beadle invitation key');
    n.expiresAt = timestamp(payload.expiresAt, 'Invitation expiry');
    n.reason = boundedText(payload.reason, 'Delegation reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'redeem_beadle_invitation') {
    n.invitationKey = credential(payload.invitationKey, 'Beadle invitation key');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'revoke_beadle') {
    n.examId = uuid(payload.examId, 'Examination');
    n.beadleUserId = uuid(payload.beadleUserId, 'Beadle');
    n.reason = boundedText(payload.reason, 'Revocation reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'issue_student_access') {
    n.examId = uuid(payload.examId, 'Examination');
    n.studentKey = credential(payload.studentKey, 'Student exam access code');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'finalize_roster_access') {
    n.examId = uuid(payload.examId, 'Examination');
    n.rows = classroomRosterRows(payload.rows);
    n.sourceKind = enumValue(payload.sourceKind, 'Roster source', ['xlsx', 'csv', 'paste', 'manual']);
    n.sourceHash = hexSha(payload.sourceHash, 'Roster source digest');
    n.studentKey = credential(payload.studentKey, 'Student exam access code');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'reopen_exam_roster') {
    n.examId = uuid(payload.examId, 'Examination');
    n.reason = boundedText(payload.reason, 'Class-list correction reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'record_candidate_verification') {
    n.examId = uuid(payload.examId, 'Examination');
    n.candidateNumber = boundedText(payload.candidateNumber, 'Candidate number', 120, { minimum: 1 });
    n.method = enumValue(payload.method, 'Verification method', [
      'physical', 'institutional', 'manual_exception', 'camera_exception',
    ]);
    n.outcome = enumValue(payload.outcome, 'Verification outcome', [
      'verified', 'blocked', 'exception_approved',
    ]);
    n.note = boundedText(payload.note ?? '', 'Verification note', 1_000, { trim: false });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'set_candidate_admission') {
    n.examId = uuid(payload.examId, 'Examination');
    n.candidateNumber = boundedText(payload.candidateNumber, 'Candidate number', 120, { minimum: 1 });
    n.decision = enumValue(payload.decision, 'Admission decision', ['admit', 'deny', 'reset']);
    n.reason = boundedText(payload.reason, 'Admission reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'set_accommodation') {
    n.examId = uuid(payload.examId, 'Examination');
    n.candidateNumber = boundedText(payload.candidateNumber, 'Candidate number', 120, { minimum: 1 });
    n.accommodation = accommodation(payload.accommodation);
    if (Boolean(n.accommodation.individualOpensAt) !== Boolean(n.accommodation.individualHardClosesAt)) {
      throw new DD2026ValidationError(
        'INVALID_ACCOMMODATION_WINDOW',
        'Provide both the individual opening time and individual hard close.',
      );
    }
    if (n.accommodation.individualOpensAt && n.accommodation.individualHardClosesAt
        && new Date(n.accommodation.individualHardClosesAt) <= new Date(n.accommodation.individualOpensAt)) {
      throw new DD2026ValidationError(
        'INVALID_ACCOMMODATION_WINDOW',
        'The individual hard close must follow the individual opening time.',
      );
    }
    if (n.accommodation.extraMinutes + n.accommodation.incidentExtensionMinutes > 480) {
      throw new DD2026ValidationError(
        'INVALID_ACCOMMODATION_TIME',
        'Combined additional time and incident extension cannot exceed 480 minutes.',
      );
    }
    n.reason = boundedText(payload.reason, 'Accommodation reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'start_attempt') {
    n.examId = uuid(payload.examId, 'Examination');
    n.studentKey = optionalCredential(payload.studentKey, 'Student exam access code');
  } else if (operation === 'start_attempt_by_code') {
    n.studentKey = credential(payload.studentKey, 'Student exam access code');
  } else if (operation === 'start_beadle_attempt') {
    n.examId = uuid(payload.examId, 'Examination');
  } else if (operation === 'open_exam_now') {
    n.examId = uuid(payload.examId, 'Examination');
    n.reason = boundedText(
      payload.reason ?? 'Opened by the Professor for the present class session.',
      'Opening reason',
      1_000,
      { minimum: 5 },
    );
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'dismiss_past_exam') {
    n.examId = uuid(payload.examId, 'Examination');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'open_session') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.deviceInstanceHash = hexSha(payload.deviceInstanceHash, 'Device instance digest');
    n.requestKey = requestKey(payload.requestKey);
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
  } else if (operation === 'save_answer_operation') {
    n.operationId = uuid(payload.operationId, 'Answer operation');
    n.examId = uuid(payload.examId, 'Examination');
    n.examVersionId = uuid(payload.examVersionId, 'Examination version');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.questionId = uuid(payload.questionId, 'Question');
    n.localSequence = integer(payload.localSequence, 'Local answer sequence', 1);
    n.answerText = boundedText(
      payload.answerText ?? '',
      'Examination answer',
      DD2026_LIMITS.examAnswerCharacters,
      { trim: false },
    );
    n.expectedRevision = integer(payload.expectedRevision ?? 0, 'Answer revision', 0);
    n.contentHash = hexSha(payload.contentHash, 'Answer content digest');
    n.clientSavedAt = timestamp(payload.clientSavedAt, 'Client save time');
    n.outageEvidence = integrityMetadataObject(payload.outageEvidence);
  } else if (operation === 'heartbeat' || operation === 'heartbeat_v2') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    if (operation === 'heartbeat_v2') {
      n.sessionId = uuid(payload.sessionId, 'Examination session');
      n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    }
  } else if (operation === 'integrity_event') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.eventType = enumValue(payload.eventType, 'Integrity event', [
      'visibility_exit', 'visibility_resume', 'focus_exit', 'focus_return',
      'fullscreen_enter', 'fullscreen_exit', 'reload_resume',
      'copy_attempt', 'paste_attempt', 'context_menu_attempt',
      'network_gap', 'network_restored', 'heartbeat_gap',
      'sync_failed', 'sync_restored', 'second_session_attempt', 'session_transfer',
    ]);
    n.details = integrityMetadataObject(payload.details);
  } else if (operation === 'record_integrity_event') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.clientEventId = uuid(payload.clientEventId, 'Integrity event');
    n.eventType = enumValue(payload.eventType, 'Integrity event', [
      'visibility_exit', 'visibility_resume', 'focus_exit', 'focus_return',
      'fullscreen_enter', 'fullscreen_exit', 'reload_resume',
      'copy_attempt', 'paste_attempt', 'context_menu_attempt',
      'network_gap', 'network_restored', 'heartbeat_gap',
      'sync_failed', 'sync_restored', 'second_session_attempt', 'session_transfer',
    ]);
    n.details = integrityMetadataObject(payload.details);
    n.clientOccurredAt = timestamp(payload.clientOccurredAt, 'Integrity event time');
  } else if (operation === 'submit_attempt') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'submit_attempt_generation') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.requestKey = requestKey(payload.requestKey);
    n.answerSetHash = hexSha(payload.answerSetHash, 'Answer-set digest');
    n.clientPendingAt = optionalTimestamp(
      payload.clientPendingAt ?? payload.clientRecordedAt,
      'Pending-submission time',
    );
    n.offlineSince = optionalTimestamp(payload.offlineSince, 'Offline start');
    n.outageEvidence = integrityMetadataObject(payload.outageEvidence);
  } else if (operation === 'reopen_submission') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.newDeadline = boundedFutureTimestamp(
      payload.newDeadline,
      'Reopening deadline',
      4 * 60 * 60 * 1_000,
    );
    n.reason = boundedText(payload.reason, 'Reopening reason', 1_000, { minimum: 10 });
    n.requestKey = requestKey(payload.requestKey);
    n.breakGlassGrantId = optionalUuid(payload.breakGlassGrantId, 'Break-glass grant');
    n.gradingKey = optionalCredential(payload.gradingKey, 'Professor grading key');
    if (Boolean(n.breakGlassGrantId) === Boolean(n.gradingKey)) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_REOPEN_AUTHORITY_INVALID',
        'Provide either the Professor grading key or an active candidate-scoped Admin review grant.',
      );
    }
  } else if (operation === 'transfer_session') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.expectedEpoch = integer(payload.expectedEpoch, 'Expected session epoch', 1);
    n.deviceInstanceHash = hexSha(payload.deviceInstanceHash, 'Device instance digest');
    n.reason = boundedText(payload.reason, 'Session-transfer reason', 1_000, { minimum: 5 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'issue_erratum') {
    n.examId = uuid(payload.examId, 'Examination');
    n.erratumType = enumValue(payload.erratumType, 'Erratum type', [
      'clarification', 'correction', 'stop_notice', 'replacement_notice',
    ]);
    n.body = boundedText(payload.body, 'Erratum', 5_000, { minimum: 5, trim: false });
    n.effectiveAt = timestamp(payload.effectiveAt, 'Erratum effective time');
    n.affectedQuestionIds = uuidRows(payload.affectedQuestionIds ?? [], 'Affected question');
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'start_leave') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.reasonCode = enumValue(payload.reasonCode ?? 'comfort_room', 'Leave reason', [
      'comfort_room', 'medical', 'technical', 'other',
    ]);
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'end_leave') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'acknowledge_leave') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.leaveId = uuid(payload.leaveId, 'Temporary leave');
    n.action = enumValue(payload.action, 'Leave action', ['acknowledge', 'record_return']);
    n.note = boundedText(payload.note ?? '', 'Leave note', 1_000, { trim: false });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'record_technical_incident') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.sessionId = uuid(payload.sessionId, 'Examination session');
    n.sessionEpoch = integer(payload.sessionEpoch, 'Session epoch', 1);
    n.clientEventId = uuid(payload.clientEventId, 'Technical incident');
    n.eventType = enumValue(payload.eventType, 'Technical incident type', [
      'connectivity_lost', 'connectivity_restored', 'sync_problem', 'device_problem',
      'browser_problem', 'session_conflict', 'support_requested', 'other',
    ]);
    n.details = integrityMetadataObject(payload.details);
    n.clientOccurredAt = timestamp(payload.clientOccurredAt, 'Incident time');
  } else if (operation === 'issue_break_glass') {
    n.examId = uuid(payload.examId, 'Examination');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.candidateNumber = boundedText(
      payload.candidateNumber,
      'Candidate number',
      120,
      { minimum: 1 },
    );
    n.caseReference = boundedText(payload.caseReference, 'Case reference', 200, { minimum: 2 });
    n.reason = boundedText(payload.reason, 'Break-glass reason', 2_000, { minimum: 20 });
    n.expiresAt = boundedFutureTimestamp(
      payload.expiresAt,
      'Break-glass expiry',
      4 * 60 * 60 * 1_000,
    );
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'close_break_glass') {
    n.grantId = uuid(payload.grantId, 'Break-glass grant');
    n.examId = uuid(payload.examId, 'Examination');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.candidateNumber = boundedText(
      payload.candidateNumber,
      'Candidate number',
      120,
      { minimum: 1 },
    );
    n.reason = boundedText(payload.reason, 'Break-glass closing reason', 1_000, { minimum: 10 });
    n.requestKey = requestKey(payload.requestKey);
  } else if (operation === 'record_break_glass_review') {
    n.grantId = uuid(payload.grantId, 'Break-glass grant');
    n.examId = uuid(payload.examId, 'Examination');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.candidateNumber = boundedText(
      payload.candidateNumber,
      'Candidate number',
      120,
      { minimum: 1 },
    );
    n.outcome = enumValue(payload.outcome, 'Break-glass review outcome', [
      'no_issue', 'procedure_change', 'escalation_required',
    ]);
    n.notes = boundedText(payload.notes, 'Break-glass review notes', 2_000, { minimum: 10 });
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
    n.gradingKey = optionalCredential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'unlock_attempt') {
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.reason = boundedText(payload.reason, 'Unlock reason', 1_000, { minimum: 5 });
    n.gradingKey = payload.gradingKey ? credential(payload.gradingKey, 'Professor grading key') : null;
  } else if (operation === 'release_results') {
    n.examId = uuid(payload.examId, 'Examination');
    n.requestKey = requestKey(payload.requestKey);
    n.includeQuestionnaire = payload.includeQuestionnaire === true;
    n.gradingKey = credential(payload.gradingKey, 'Professor grading key');
  } else if (operation === 'retry_student_result_email') {
    n.examId = uuid(payload.examId, 'Examination');
    n.attemptId = uuid(payload.attemptId, 'Attempt');
    n.requestKey = requestKey(payload.requestKey);
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

export function normalizeExamRoomPaymentProofUpload(input) {
  const payload = object(input);
  const requestId = uuid(payload.requestId, 'Examination Room request');
  const fileName = boundedText(payload.fileName, 'Payment proof file name', 180, { minimum: 1 })
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const mimeType = enumValue(payload.mimeType, 'Payment proof file type', [
    'image/png', 'image/jpeg', 'application/pdf',
  ]);
  const raw = String(payload.dataBase64 || '').trim();
  if (!raw || raw.length > 11_200_000 || !BASE64_PATTERN.test(raw)) {
    throw new DD2026ValidationError(
      'INVALID_PAYMENT_PROOF',
      'Upload a PNG, JPEG, or PDF payment proof no larger than 8 MB.',
    );
  }
  let bytes;
  try {
    bytes = base64Bytes(raw);
  } catch {
    throw new DD2026ValidationError('INVALID_PAYMENT_PROOF', 'The payment proof could not be read.');
  }
  if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024) {
    throw new DD2026ValidationError(
      'INVALID_PAYMENT_PROOF',
      'Upload a PNG, JPEG, or PDF payment proof no larger than 8 MB.',
    );
  }
  const extension = fileName.toLowerCase().split('.').pop();
  const extensionMatches = mimeType === 'image/png'
    ? extension === 'png'
    : mimeType === 'image/jpeg'
      ? extension === 'jpg' || extension === 'jpeg'
      : extension === 'pdf';
  const signatureMatches = mimeType === 'image/png'
    ? bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((value, index) => bytes[index] === value)
    : mimeType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  if (!extensionMatches || !signatureMatches) {
    throw new DD2026ValidationError(
      'INVALID_PAYMENT_PROOF',
      'The payment proof filename and content must match the selected PNG, JPEG, or PDF file type.',
    );
  }
  if (mimeType === 'application/pdf') {
    const inspectableNames = new TextDecoder('latin1')
      .decode(bytes)
      .replace(/#([0-9a-f]{2})/gi, (_match, encoded) => (
        String.fromCharCode(Number.parseInt(encoded, 16))
      ));
    if (/\/(?:Encrypt|JavaScript|JS|OpenAction|AA|Launch|RichMedia|EmbeddedFile|SubmitForm|ImportData)\b/i
      .test(inspectableNames)) {
      throw new DD2026ValidationError(
        'INVALID_PAYMENT_PROOF',
        'Upload an unencrypted, inactive PDF payment proof.',
      );
    }
  }
  return {
    requestId,
    fileName,
    mimeType,
    bytes,
    requestKey: requestKey(payload.requestKey),
  };
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'answer', 'answer_text', 'student_answer', 'email', 'ip', 'ip_address',
  'raw_ip', 'token', 'key', 'password', 'api_key', 'service_role_key',
  'answertext', 'studentanswer', 'rawanswer', 'emailaddress', 'primaryemail',
  'recoveryemail', 'ipaddress', 'rawip', 'accesstoken', 'accesscode',
  'credential', 'secret', 'apikey', 'servicerolekey',
]);

function integrityMetadataObject(value) {
  const sanitized = sanitizeIntegrityMetadata(value);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    throw new DD2026ValidationError(
      'INTEGRITY_DETAILS_INVALID',
      'Integrity and outage details must be a JSON object.',
    );
  }
  if (new TextEncoder().encode(JSON.stringify(sanitized)).byteLength > 8_000) {
    throw new DD2026ValidationError(
      'INTEGRITY_DETAILS_INVALID',
      'Integrity and outage details exceed the safe size limit.',
    );
  }
  return sanitized;
}

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
    if (Object.keys(value).length > 50) {
      throw new DD2026ValidationError('INTEGRITY_DETAILS_INVALID', 'Integrity details contain too many fields.');
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      const compactKey = lowerKey.replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_METADATA_KEYS.has(lowerKey)
          || FORBIDDEN_METADATA_KEYS.has(compactKey)
          || ['answer', 'email', 'password', 'credential', 'secret', 'accesstoken', 'accesscode']
            .some((forbidden) => compactKey.includes(forbidden))) {
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
    'application/pdf',
  ].includes(normalized)) {
    throw new DD2026ValidationError(
      'UNSUPPORTED_FILE_TYPE',
      'Upload a UTF-8 text (.txt), Word (.docx), or PDF (.pdf) examination file.',
    );
  }
  return normalized;
}

export function safeExamRoomFileName(value) {
  const input = boundedText(value, 'File name', 200, { minimum: 1 });
  const lower = input.toLowerCase();
  const extension = lower.endsWith('.docx') ? '.docx'
    : lower.endsWith('.txt') ? '.txt'
      : lower.endsWith('.pdf') ? '.pdf' : '';
  if (!extension) {
    throw new DD2026ValidationError('UNSUPPORTED_FILE_TYPE', 'Use a .txt, .docx, or .pdf question file.');
  }
  const stem = input
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'examination-questions';
  return `${stem}${extension}`;
}

function questionMimeForFile(fileName) {
  if (fileName.endsWith('.txt')) return 'text/plain';
  if (fileName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (fileName.endsWith('.pdf')) return 'application/pdf';
  return null;
}

export function normalizeQuestionUploadIntent(input) {
  const payload = object(input);
  const examId = uuid(payload.examId, 'Examination');
  const questionCount = integer(
    payload.questionCount,
    'Question count',
    1,
    EXAM_ROOM_2026_MAX_QUESTIONS,
  );
  const sourceKind = enumValue(
    payload.sourceKind ?? (payload.pastedText != null ? 'paste' : 'file'),
    'Question source',
    ['file', 'paste'],
  );
  const fileName = safeExamRoomFileName(
    sourceKind === 'paste' ? payload.fileName || 'pasted-questions.txt' : payload.fileName,
  );
  const mimeType = supportedQuestionMime(sourceKind === 'paste' ? payload.mimeType || 'text/plain' : payload.mimeType);
  if (questionMimeForFile(fileName) !== mimeType) {
    throw new DD2026ValidationError(
      'FILE_TYPE_MISMATCH',
      'The file extension and declared content type do not match.',
    );
  }
  if (sourceKind === 'paste' && mimeType !== 'text/plain') {
    throw new DD2026ValidationError(
      'PASTED_SOURCE_INVALID',
      'Pasted questions are accepted as plain text and reviewed before publication.',
    );
  }
  return { examId, questionCount, sourceKind, fileName, mimeType };
}

function pdfInspection(bytes) {
  if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new DD2026ValidationError('INVALID_PDF_SIGNATURE', 'The PDF file signature is invalid.');
  }
  const source = new TextDecoder('latin1').decode(bytes);
  if (!/%%EOF(?:\s|\0)*$/i.test(source.slice(-2048))) {
    throw new DD2026ValidationError('INVALID_PDF', 'The PDF file is incomplete or corrupt.');
  }
  const inspectableNames = source.replace(/#([0-9a-f]{2})/gi, (_match, encoded) => (
    String.fromCharCode(Number.parseInt(encoded, 16))
  ));
  if (/\/Encrypt\b/i.test(inspectableNames) || /\/Filter\s*\/Standard\b/i.test(inspectableNames)) {
    throw new DD2026ValidationError(
      'ENCRYPTED_PDF_REJECTED',
      'Password-protected or encrypted PDFs cannot be processed. Upload an unencrypted copy.',
    );
  }
  if (/\/Type\s*\/ObjStm\b/i.test(inspectableNames)
      || /\/(?:JavaScript|JS|OpenAction|AA|Launch|RichMedia|EmbeddedFile|SubmitForm|ImportData)\b/i.test(inspectableNames)) {
    throw new DD2026ValidationError(
      'ACTIVE_PDF_REJECTED',
      'The PDF contains active, embedded, or uninspectable object content. Export a flattened, inactive PDF and try again.',
    );
  }
  const pageMarkers = inspectableNames.match(/\/Type\s*\/Page(?!s)\b/g) || [];
  const pageCount = pageMarkers.length || null;
  if (pageCount && pageCount > DD2026_LIMITS.sourceUploadPages) {
    throw new DD2026ValidationError(
      'PDF_PAGE_LIMIT_EXCEEDED',
      `PDF question files are limited to ${DD2026_LIMITS.sourceUploadPages} pages.`,
    );
  }
  return { pageCount };
}

async function validateDocxSafety(bytes) {
  const entries = zipEntries(bytes);
  if (!entries.has('[Content_Types].xml') || !entries.has('word/document.xml')) {
    throw new DD2026ValidationError('INVALID_DOCX', 'The Word file has no readable document body.');
  }
  let totalUncompressed = 0;
  for (const [name, entry] of entries) {
    if (name.startsWith('/') || name.includes('..') || name.includes('\\')) {
      throw new DD2026ValidationError('INVALID_DOCX', 'The Word file contains an unsafe archive path.');
    }
    totalUncompressed += entry.uncompressedSize;
    if (entry.uncompressedSize > 5_000_000
        || (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 200)) {
      throw new DD2026ValidationError('UNSAFE_DOCX', 'The Word file expands beyond safe processing limits.');
    }
    if (/(?:vbaProject\.bin|\/activeX\/|\/embeddings\/)/i.test(name)) {
      throw new DD2026ValidationError(
        'ACTIVE_DOCX_REJECTED',
        'The Word file contains macros, embedded objects, or active content.',
      );
    }
  }
  if (totalUncompressed > 25_000_000) {
    throw new DD2026ValidationError('UNSAFE_DOCX', 'The Word file expands beyond safe processing limits.');
  }
  await zipText(bytes, entries.get('word/document.xml'));
  for (const [name, entry] of entries) {
    if (!name.endsWith('.rels')) continue;
    const relationships = await zipText(bytes, entry);
    if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) {
      throw new DD2026ValidationError(
        'EXTERNAL_DOCX_RESOURCE_REJECTED',
        'The Word file references an external resource. Remove external links and try again.',
      );
    }
  }
}

export async function normalizeQuestionUpload(input, prevalidatedIntent = null) {
  const payload = object(input);
  const intent = prevalidatedIntent || normalizeQuestionUploadIntent(payload);
  const {
    examId, questionCount, sourceKind, fileName, mimeType,
  } = intent;
  const encoded = String(payload.base64 ?? '').trim();
  let bytes;
  if (sourceKind === 'paste') {
    const pastedText = boundedText(payload.pastedText, 'Pasted questions', 2_500_000, {
      minimum: 1,
      trim: false,
    });
    bytes = new TextEncoder().encode(pastedText);
  } else {
    if (!encoded || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
      throw new DD2026ValidationError('INVALID_UPLOAD', 'The question file is invalid.');
    }
    bytes = base64Bytes(encoded);
  }
  if (!bytes.length || bytes.length > DD2026_LIMITS.sourceUploadBytes) {
    throw new DD2026ValidationError(
      'UPLOAD_SIZE_INVALID',
      'Question files must be no larger than 10 MB.',
    );
  }
  if (mimeType === 'text/plain' && bytes.some((byte) => byte === 0)) {
    throw new DD2026ValidationError('INVALID_TEXT_FILE', 'The text file contains binary data.');
  }
  if (mimeType.includes('wordprocessingml') && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
    throw new DD2026ValidationError('INVALID_DOCX_SIGNATURE', 'The Word file signature is invalid.');
  }
  const warnings = [];
  let pageCount = null;
  let extractionMode = 'parsed';
  let questions = [];
  if (mimeType === 'application/pdf') {
    ({ pageCount } = pdfInspection(bytes));
    extractionMode = 'manual_required';
    warnings.push(
      'PDF text extraction is not enabled in this beta. Construct and verify every question manually before publication.',
    );
    if (pageCount == null) {
      warnings.push(
        `The PDF page count could not be verified automatically. Confirm that it does not exceed ${DD2026_LIMITS.sourceUploadPages} pages.`,
      );
    }
  } else {
    if (mimeType.includes('wordprocessingml')) await validateDocxSafety(bytes);
    questions = await extractUploadedQuestions(bytes, mimeType, { maximumQuestions: questionCount + 1 });
  }
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
    extractionMode,
    contentHash: await sha256Hex(bytes),
    pageCount,
  };
}

export function normalizeModelAnswerUploadIntent(input) {
  const payload = object(input);
  const examId = uuid(payload.examId, 'Examination');
  const fileName = safeExamRoomFileName(payload.fileName);
  const mimeType = supportedQuestionMime(payload.mimeType);
  const normalizedRequestKey = requestKey(payload.requestKey);
  if (questionMimeForFile(fileName) !== mimeType) {
    throw new DD2026ValidationError(
      'FILE_TYPE_MISMATCH',
      'The file extension and declared content type do not match.',
    );
  }
  return { examId, fileName, mimeType, requestKey: normalizedRequestKey };
}

export async function normalizeModelAnswerUpload(input, prevalidatedIntent = null) {
  const payload = object(input);
  const intent = prevalidatedIntent || normalizeModelAnswerUploadIntent(payload);
  const encoded = String(payload.base64 ?? '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new DD2026ValidationError('INVALID_UPLOAD', 'The suggested-answer file is invalid.');
  }
  const bytes = base64Bytes(encoded);
  if (!bytes.length || bytes.length > DD2026_LIMITS.sourceUploadBytes) {
    throw new DD2026ValidationError(
      'UPLOAD_SIZE_INVALID',
      'Suggested-answer files must be no larger than 10 MB.',
    );
  }
  let pageCount = null;
  const warnings = [];
  if (intent.mimeType === 'text/plain') {
    if (bytes.some((byte) => byte === 0)) {
      throw new DD2026ValidationError('INVALID_TEXT_FILE', 'The text file contains binary data.');
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new DD2026ValidationError('INVALID_TEXT_FILE', 'Upload a valid UTF-8 text file.');
    }
  } else if (intent.mimeType.includes('wordprocessingml')) {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new DD2026ValidationError('INVALID_DOCX_SIGNATURE', 'The Word file signature is invalid.');
    }
    await validateDocxSafety(bytes);
  } else {
    ({ pageCount } = pdfInspection(bytes));
    if (pageCount == null) {
      warnings.push(
        `The PDF page count could not be verified automatically. Confirm that it does not exceed ${DD2026_LIMITS.sourceUploadPages} pages.`,
      );
    }
  }
  return {
    ...intent,
    bytes,
    pageCount,
    warnings,
    contentHash: await sha256Hex(bytes),
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

export function normalizeRosterUploadIntent(input) {
  const payload = object(input);
  const examId = optionalUuid(payload.examId, 'Examination');
  const classroomId = optionalUuid(payload.classroomId, 'Classroom');
  if (Boolean(examId) === Boolean(classroomId)) {
    throw new DD2026ValidationError(
      'INVALID_ROSTER_SCOPE',
      'Provide exactly one examination or classroom for the roster upload.',
    );
  }
  const fileName = boundedText(payload.fileName, 'Roster file name', 200, { minimum: 1 });
  const mimeType = String(payload.mimeType ?? '').trim().toLowerCase();
  if (!['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mimeType)) {
    throw new DD2026ValidationError('UNSUPPORTED_ROSTER_TYPE', 'Upload a CSV or XLSX roster.');
  }
  return { examId, classroomId, fileName, mimeType };
}

function officialBeadleRosterTable(rows) {
  const headers = Array.isArray(rows?.[0]) ? rows[0] : [];
  const exactHeaders = headers.length === EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS.length
    && EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS.every(
      (expected, index) => String(headers[index] ?? '') === expected,
    );
  if (!exactHeaders) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED',
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE,
    );
  }
  const studentRows = rows.slice(1).filter(
    (values) => Array.isArray(values)
      && values.some((value) => String(value ?? '').trim() !== ''),
  );
  if (!studentRows.length) {
    throw new DD2026ValidationError('ROSTER_EMPTY', 'The class list contains no student rows.');
  }
  const mapped = rosterRows(studentRows.map((values, index) => {
    if (values.slice(EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_HEADERS.length)
      .some((value) => String(value ?? '').trim() !== '')) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED',
        EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE,
      );
    }
    const displayName = String(values?.[2] ?? '').trim();
    if (!displayName) {
      throw new DD2026ValidationError(
        'ROSTER_NAME_REQUIRED',
        `Class-list row ${index + 1} must include the student name.`,
      );
    }
    const studentNumber = values?.[1] ?? '';
    return {
      email: values?.[0] ?? '',
      studentNumber,
      candidateNumber: studentNumber,
      displayName,
    };
  }));
  return mapped;
}

export async function normalizeRosterUpload(input, prevalidatedIntent = null) {
  const payload = object(input);
  const intent = prevalidatedIntent || normalizeRosterUploadIntent(payload);
  if (intent.examId && (intent.mimeType
      !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || !intent.fileName.toLowerCase().endsWith('.xlsx'))) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED',
      EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_MESSAGE,
    );
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
  if (intent.mimeType === 'text/csv') {
    rows = parseCsvRows(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new DD2026ValidationError('INVALID_XLSX_SIGNATURE', 'The Excel file signature is invalid.');
    }
    rows = await extractFirstXlsxSheet(bytes);
  }
  return {
    ...intent,
    rows: intent.examId ? officialBeadleRosterTable(rows) : normalizedRosterTable(rows),
    sourceHash: await sha256Hex(bytes),
    ...(intent.examId ? { templateVersion: EXAM_ROOM_BEADLE_ROSTER_TEMPLATE_VERSION } : {}),
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
  if (bytes.length < 22) {
    throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
  }
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (little32(bytes, index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
  const count = little16(bytes, end + 10);
  if (count < 1 || count > 2_000) {
    throw new DD2026ValidationError('UNSAFE_ARCHIVE', 'The uploaded archive has too many entries.');
  }
  let offset = little32(bytes, end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset < 0 || offset + 46 > bytes.length || little32(bytes, offset) !== 0x02014b50) {
      throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
    }
    const entry = {
      flags: little16(bytes, offset + 8),
      compression: little16(bytes, offset + 10),
      compressedSize: little32(bytes, offset + 20),
      uncompressedSize: little32(bytes, offset + 24),
      localOffset: little32(bytes, offset + 42),
    };
    const nameLength = little16(bytes, offset + 28);
    const extraLength = little16(bytes, offset + 30);
    const commentLength = little16(bytes, offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > bytes.length || entry.localOffset + 30 > bytes.length) {
      throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
    }
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (!name || entries.has(name) || (entry.flags & 0x1) !== 0) {
      throw new DD2026ValidationError(
        (entry.flags & 0x1) !== 0 ? 'ENCRYPTED_ARCHIVE_REJECTED' : 'INVALID_ARCHIVE',
        (entry.flags & 0x1) !== 0
          ? 'Encrypted document archives cannot be processed.'
          : 'The uploaded archive is corrupt.',
      );
    }
    entries.set(name, entry);
    offset = nextOffset;
  }
  return entries;
}

async function zipText(bytes, entry) {
  if (!entry || entry.uncompressedSize > 5_000_000
      || (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 200)) {
    throw new DD2026ValidationError('UNSAFE_ARCHIVE', 'The uploaded archive expands beyond safe limits.');
  }
  const offset = entry.localOffset;
  if (little32(bytes, offset) !== 0x04034b50) {
    throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
  }
  const nameLength = little16(bytes, offset + 26);
  const extraLength = little16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  if (start < 0 || start + entry.compressedSize > bytes.length) {
    throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is corrupt.');
  }
  const compressed = bytes.slice(start, start + entry.compressedSize);
  let result;
  if (entry.compression === 0) result = compressed;
  else if (entry.compression === 8) {
    const reader = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 5_000_000) {
        await reader.cancel();
        throw new DD2026ValidationError('UNSAFE_ARCHIVE', 'The uploaded archive expands beyond safe limits.');
      }
      chunks.push(value);
    }
    result = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      result.set(chunk, position);
      position += chunk.byteLength;
    }
  } else throw new DD2026ValidationError('INVALID_ARCHIVE', 'The archive uses unsupported compression.');
  if (result.length > 5_000_000 || (entry.uncompressedSize && result.length !== entry.uncompressedSize)) {
    throw new DD2026ValidationError('INVALID_ARCHIVE', 'The uploaded archive is unsafe or corrupt.');
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
    ? [...(await zipText(bytes, sharedEntry)).matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g,
    )].map((match) => xmlText(match[1]))
    : [];
  const xml = await zipText(bytes, sheetEntry);
  if (/<(?:[A-Za-z_][\w.-]*:)?f\b/i.test(xml)) {
    throw new DD2026ValidationError('ROSTER_FORMULA_REJECTED', 'Roster spreadsheets cannot contain formulas.');
  }
  const rows = [];
  for (const rowMatch of xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g,
  )) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>/g,
    )) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || 'A1';
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || '';
      const raw = body.match(
        /<(?:[A-Za-z_][\w.-]*:)?v>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/,
      )?.[1]
        ?? body.match(
          /<(?:[A-Za-z_][\w.-]*:)?is>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?is>/,
        )?.[1]
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
