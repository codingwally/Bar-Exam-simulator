import {
  BAR_EASY_RESPONSE_SCHEMA,
  DD2026ValidationError,
  DOCTRINE_RESPONSE_SCHEMA,
  barEasyPersistencePayload,
  buildBarEasyPrompt,
  buildDoctrinePrompt,
  doctrinePersistencePayload,
  featureFlag,
  normalizeBarEasyRequest,
  normalizeContentItemRequest,
  normalizeContentQuery,
  normalizeDoctrineRequest,
  normalizeVerdictPdfRequest,
  publicContentItem,
  validateBarEasyResult,
  validateDoctrineResult,
} from './duediligence-2026-core.mjs';
import {
  examRoomRateKey,
  hashedCredential,
  normalizeExamResultPdfRequest,
  normalizeExamRoomCommand,
  normalizeExamRoomQuery,
  normalizeQuestionUpload,
  normalizeQuestionUploadIntent,
  normalizeRosterUpload,
  normalizeRosterUploadIntent,
  sha256Hex,
} from './exam-room-2026-core.mjs';
import { buildExamResultPdf, examResultPdfFileName } from './exam-result-pdf.mjs';
import {
  decryptStudentExamCode,
  encryptStudentExamCode,
} from './exam-room-student-code-envelope.mjs';
import { buildVerdictPdf, verdictPdfFileName } from './verdict-pdf.mjs';

function barEasyReveal(content) {
  const payload = content?.payload || {};
  return {
    id: content?.id,
    label: content?.title,
    suggestedAnswer: payload.suggested_answer,
    explanation: payload.explanation,
    primarySource: {
      title: payload.source_title,
      citation: payload.source_citation,
      url: payload.source_url,
    },
    aiPreparedBeta: content?.aiPreparedBeta === true,
  };
}

function doctrineReveal(content) {
  const payload = content?.payload || {};
  return {
    id: content?.id,
    title: payload.doctrine_title || content?.title,
    canonicalMeaning: payload.canonical_meaning,
    plainLanguageMeaning: payload.plain_language_meaning,
    limits: payload.exceptions_or_limits,
    authority: payload.primary_authority,
    citation: payload.citation,
    sourceUrl: payload.source_url,
    aiPreparedBeta: content?.aiPreparedBeta === true,
  };
}

const MODEL_ANSWER_HASH = /^[0-9a-f]{64}$/;
const MODEL_ANSWER_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,179}$/;
const MODEL_ANSWER_MIME_TYPES = new Set([
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MODEL_ANSWER_FAILURE_CODES = new Set([
  'GRADING_NOT_OPEN',
  'CREDENTIAL_INVALID',
  'CREDENTIAL_LOCKED',
  'MODEL_ANSWER_NOT_CONFIGURED',
  'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
]);
const RETIRED_DISPUTE_OPERATIONS = new Set([
  'dispute_view',
  'open_dispute',
  'close_dispute',
  'admin_correct_grade',
]);
const EXAMINATION_ROOM_BASE_FLAG = 'EXAMINATION_ROOM_ENABLED';
const EXAMINATION_ROOM_2_FLAG = 'EXAMINATION_ROOM_2_ENABLED';
const EXAM_ROOM_2_QUERY_OPERATIONS = new Set([
  'activation_ledger',
  'exam_intent',
  'professor_authoring_snapshot',
  'preflight',
  'beadle_portal',
  'incident_summary',
  'submission_status',
  'live_status_v2',
  'grading_model_answer',
  'break_glass_view',
]);
const EXAM_ROOM_2_COMMAND_OPERATIONS = new Set([
  'issue_activation',
  'redeem_activation',
  'revoke_activation',
  'create_classroom',
  'validate_exam_roster',
  'import_exam_roster',
  'upsert_exam_roster_row',
  'update_exam_details',
  'revise_draft_questions',
  'save_rules_draft',
  'confirm_replacement_questions',
  'publish_exam',
  'publish_for_beadle',
  'reschedule_publication',
  'replace_publication',
  'invite_beadle',
  'redeem_beadle_invitation',
  'revoke_beadle',
  'issue_student_access',
  'reopen_exam_roster',
  'record_candidate_verification',
  'set_candidate_admission',
  'set_accommodation',
  'open_session',
  'save_answer_operation',
  'heartbeat_v2',
  'record_integrity_event',
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
]);

const VERIFIED_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BREAK_GLASS_STEP_UP_MAX_AGE_SECONDS = 15 * 60;
const PROFESSOR_ACTIVATION_RESULT_CODES = new Set([
  'ACTIVATION_INVALID',
  'ACTIVATION_EXPIRED',
  'ACTIVATION_REVOKED',
  'ACTIVATION_ALREADY_REDEEMED',
  'ACTIVATION_ROOM_SCOPE_REQUIRED',
  'CREDENTIAL_LOCKED',
]);

function requireVerifiedAal2(user) {
  if (user?.authenticationLevel !== 'aal2') {
    throw new DD2026ValidationError(
      'EXAM_ROOM_AAL2_REQUIRED',
      'Complete multi-factor verification before using candidate-scoped Admin review.',
      403,
    );
  }
  const sessionId = String(user?.authenticationSessionId || '').trim().toLowerCase();
  if (!VERIFIED_SESSION_ID.test(sessionId)) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_VERIFIED_SESSION_REQUIRED',
      'Refresh the verified multi-factor session before using candidate-scoped Admin review.',
      403,
    );
  }
  const stepUpAuthenticatedAt = Number(user?.stepUpAuthenticatedAt);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(stepUpAuthenticatedAt)
      || stepUpAuthenticatedAt > nowSeconds + 60
      || nowSeconds - stepUpAuthenticatedAt > BREAK_GLASS_STEP_UP_MAX_AGE_SECONDS) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_FRESH_AAL2_REQUIRED',
      'Complete a fresh multi-factor challenge before using candidate-scoped Admin review.',
      403,
    );
  }
  return {
    aal: 'aal2',
    sessionId,
    authenticatedAt: new Date(stepUpAuthenticatedAt * 1_000).toISOString(),
  };
}

function projectScalarFields(value, fields) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(source, field))
    .filter((field) => source[field] == null
      || ['string', 'number', 'boolean'].includes(typeof source[field]))
    .map((field) => [field, source[field]]));
}

function professorActivationIssueView(value, input) {
  const projected = projectScalarFields(value, [
    'ok', 'activationId', 'status', 'createdAt', 'expiresAt',
  ]);
  return {
    ...projected,
    ok: projected.ok !== false,
    targetEmail: input.targetEmail,
    roomTitle: input.roomTitle,
    schoolName: input.schoolName,
    academicTerm: input.academicTerm,
    expiresAt: projected.expiresAt || input.expiresAt,
  };
}

function professorActivationRedeemView(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const projected = projectScalarFields(source, [
    'ok', 'code', 'role', 'activationId', 'classroomId', 'roomTitle',
    'schoolName', 'academicTerm', 'status', 'redeemedAt', 'lockedUntil',
  ]);
  if (projected.ok === false) {
    return {
      ok: false,
      code: PROFESSOR_ACTIVATION_RESULT_CODES.has(projected.code)
        ? projected.code
        : 'ACTIVATION_UNAVAILABLE',
      ...(projected.lockedUntil ? { lockedUntil: projected.lockedUntil } : {}),
    };
  }
  const { code: _failureCode, lockedUntil: _lockedUntil, ...success } = projected;
  return success;
}

function professorActivationRevokeView(value, input) {
  const projected = projectScalarFields(value, [
    'ok', 'activationId', 'status', 'revokedAt', 'idempotent',
  ]);
  if (projected.activationId && projected.activationId !== input.activationId) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_SCOPE_MISMATCH',
      'The invitation result did not match the selected record.',
      403,
    );
  }
  return { ...projected, activationId: input.activationId };
}

function professorActivationLedgerView(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rows = Array.isArray(source.activations)
    ? source.activations
    : Array.isArray(source.records)
      ? source.records
      : Array.isArray(value)
        ? value
        : [];
  return {
    ...projectScalarFields(source, ['ok', 'status', 'total', 'limit', 'offset']),
    activations: projectEvidenceRows(rows, [
      'activationId', 'roomTitle', 'schoolName', 'academicTerm', 'targetEmail',
      'status', 'createdAt', 'expiresAt', 'issuedByUserId', 'issuedByEmail',
      'redeemedByUserId', 'redeemedByEmail', 'redeemedAt', 'failedAttempts',
      'lockedUntil', 'revokedAt', 'revokeReason', 'classroomId',
    ], 200),
  };
}

const AUTHORING_RULE_FIELDS = [
  'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
  'submissionGraceMinutes', 'allowedMaterials', 'navigationMode', 'integrityMode',
  'fullscreenPolicy', 'admissionMode', 'temporaryLeaveAcknowledgment',
  'studentAccessCodeRequired', 'suggestedAnswerMode', 'suggestedAnswer',
  'aiGradingEnabled',
];

function professorAuthoringSnapshotView(value, examId) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = requireProjectedScope(projectScalarFields(source, [
    'ok', 'examId', 'workspaceRevision', 'status', 'published', 'serverNow',
  ]), { examId });
  const details = projectScalarFields(source.details, [
    'title', 'instructions', 'questionCount', 'integrityPreset',
    'includeQuestionnaire', 'updatedAt',
  ]);
  const questionSource = source.questions && typeof source.questions === 'object'
    && !Array.isArray(source.questions) ? source.questions : {};
  const questions = {
    ...projectScalarFields(questionSource, [
      'questionVersionId', 'versionNumber', 'questionCount', 'sourceFileName',
      'confirmedAt',
    ]),
    rows: Array.isArray(questionSource.rows)
      ? questionSource.rows.slice(0, 200).map((row) => projectScalarFields(row, [
        'questionId', 'ordinal', 'prompt', 'maximumPoints',
      ]))
      : [],
  };
  const draftSource = source.rulesDraft && typeof source.rulesDraft === 'object'
    && !Array.isArray(source.rulesDraft) ? source.rulesDraft : null;
  const rulesDraft = draftSource ? {
    ...projectScalarFields(draftSource, ['beadleEmail', 'updatedAt']),
    rules: projectScalarFields(draftSource.rules, AUTHORING_RULE_FIELDS),
  } : null;
  const publicationSource = source.publication && typeof source.publication === 'object'
    && !Array.isArray(source.publication) ? source.publication : null;
  const publication = publicationSource ? {
    ...projectScalarFields(publicationSource, [
      'publicationId', 'publicationNumber', 'title', 'instructions',
      'questionCount', 'publishedAt', 'opensAt', 'hardClosesAt',
    ]),
    rules: projectScalarFields(publicationSource.rules, AUTHORING_RULE_FIELDS),
  } : null;
  return {
    ...result,
    details,
    questions,
    rulesDraft,
    capabilities: projectScalarFields(source.capabilities, [
      'canEditDetails', 'canEditQuestions', 'canEditRules',
      'canReviewRoster', 'canReviewHandout', 'canReopenRoster',
      'canReschedulePublication',
    ]),
    blockers: projectScalarFields(source.blockers, [
      'details', 'questions', 'rules', 'roster', 'handout', 'reopenRoster',
      'rescheduleBlocker',
    ]),
    publication,
    handoff: projectScalarFields(source.handoff, [
      'rosterCount', 'beadleAssigned', 'beadleInvitationIssued',
      'studentAccessReady', 'studentAccessIssuedAt', 'examPath',
      'canReopenRoster', 'reopenRosterBlocker',
    ]),
  };
}

function professorAuthoringMutationView(value, input) {
  return requireProjectedScope(projectScalarFields(value, [
    'ok', 'examId', 'status', 'workspaceRevision', 'questionsRequireReview',
    'questionVersionId', 'versionNumber', 'questionCount', 'noChange',
    'rulesDraftUpdatedAt', 'studentAccessReady', 'rosterLocked', 'codeRevoked',
    'idempotent',
  ]), { examId: input.examId });
}

function requireProjectedScope(result, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (value != null && result[field] !== value) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_SCOPE_MISMATCH',
        'The candidate-scoped result did not match the authorized examination scope.',
        403,
      );
    }
  }
  return result;
}

function publicationReplacementView(value, input) {
  return requireProjectedScope(projectScalarFields(value, [
    'ok', 'examId', 'publicationId', 'publicationNumber', 'supersedesPublicationId',
    'publishedAt', 'snapshotHash', 'questionCount', 'accessCodeRequired',
    'credentialsRotated', 'notificationQueued', 'notificationStatus', 'notificationCount',
    'replacementQuestionVersionId', 'questionVersionChanged', 'idempotent',
  ]), { examId: input.examId, supersedesPublicationId: input.expectedPublicationId });
}

function publicationRescheduleView(value, input) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const projected = requireProjectedScope(projectScalarFields(source, [
    'ok', 'examId', 'publicationId', 'publicationNumber', 'workspaceRevision',
    'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
    'submissionGraceMinutes', 'idempotent',
  ]), { examId: input.examId });
  return {
    ...projected,
    preserved: projectScalarFields(source.preserved, [
      'questions', 'classList', 'beadleAccess', 'studentExamCode', 'gradingAccess',
    ]),
  };
}

function stagedReplacementQuestionsView(value, input) {
  return requireProjectedScope(projectScalarFields(value, [
    'ok', 'examId', 'expectedPublicationId', 'replacementQuestionVersionId',
    'sourceVersion', 'questionVersionNumber', 'questionCount', 'snapshotHash',
    'staged', 'idempotent',
  ]), { examId: input.examId, expectedPublicationId: input.expectedPublicationId });
}

function reopenedSubmissionView(value, input) {
  return requireProjectedScope(projectScalarFields(value, [
    'ok', 'attemptId', 'reopeningId', 'generation', 'priorGeneration',
    'priorReceiptId', 'priorSnapshotHash', 'serverDeadline', 'expiresAt',
    'requiresNewSession', 'authority', 'notificationStatus', 'notificationCount',
    'idempotent',
  ]), { attemptId: input.attemptId });
}

function liveStatusV2View(value, input) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = requireProjectedScope(projectScalarFields(source, [
    'ok', 'examId', 'title', 'status', 'opensAt', 'hardClosesAt', 'serverNow',
    'reopenMaximumMinutes', 'accessCodeRequired',
  ]), { examId: input.examId });
  return {
    ...result,
    candidates: projectEvidenceRows(source.candidates, [
      'candidateNumber', 'attemptId', 'state', 'startedAt', 'serverDeadline',
      'submittedAt', 'generation', 'latestReceiptId', 'priorReceiptId',
      'activeReopeningId', 'canReopenSubmission', 'reopenBlockedReason',
    ], 500),
  };
}

function projectEvidenceRows(value, fields, maximum = 500) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).map((entry) => projectScalarFields(entry, fields));
}

const FORBIDDEN_EVIDENCE_METADATA_FRAGMENT = [
  'answer', 'email', 'password', 'credential', 'secret', 'token', 'accesscode',
  'apikey', 'servicerole', 'ipaddress', 'rawip', 'devicehash', 'deviceinstancehash',
  'key', 'hash', 'phone', 'cookie', 'authorization', 'useragent', 'sessionid',
];

function projectEvidenceMetadata(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50)
      .map((entry) => projectEvidenceMetadata(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object') {
    const projected = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      const compactKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!compactKey
        || FORBIDDEN_EVIDENCE_METADATA_FRAGMENT.some((fragment) => compactKey.includes(fragment))) {
        continue;
      }
      const safeEntry = projectEvidenceMetadata(entry, depth + 1);
      if (safeEntry !== undefined) projected[String(key).slice(0, 80)] = safeEntry;
    }
    return projected;
  }
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function projectEvidenceQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((entry) => {
    const question = projectScalarFields(entry, [
      'id', 'questionId', 'ordinal', 'prompt', 'maximumPoints', 'promptHash',
    ]);
    const { id, questionId, ...fields } = question;
    return {
      ...fields,
      questionId: questionId || id,
    };
  });
}

function projectAnswerSnapshot(value) {
  if (Array.isArray(value)) {
    return projectEvidenceRows(value, [
      'questionId', 'ordinal', 'answerText', 'revision', 'savedAt', 'contentHash',
    ], 200);
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).slice(0, 200).map(([questionId, answer]) => {
    if (typeof answer === 'string') return { questionId, answerText: answer };
    return projectScalarFields({ questionId, ...(answer || {}) }, [
      'questionId', 'ordinal', 'answerText', 'revision', 'savedAt', 'contentHash',
    ]);
  });
}

function breakGlassActionView(value, input) {
  const projected = projectScalarFields(value, [
    'ok', 'grantId', 'examId', 'attemptId', 'candidateNumber', 'caseReference',
    'scope', 'requiresPostReview', 'status', 'issuedAt', 'expiresAt', 'closedAt',
    'reviewedAt', 'outcome', 'idempotent',
  ]);
  return requireProjectedScope(projected, {
    grantId: input.grantId || null,
    examId: input.examId,
    attemptId: input.attemptId,
    candidateNumber: input.candidateNumber,
  });
}

function breakGlassEvidenceView(value, input) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const evidence = source.evidence && typeof source.evidence === 'object'
    && !Array.isArray(source.evidence) ? source.evidence : source;
  const result = requireProjectedScope(projectScalarFields(source, [
    'ok', 'grantId', 'examId', 'attemptId', 'candidateNumber', 'caseReference',
    'scope', 'status', 'issuedAt', 'expiresAt', 'accessedAt', 'idempotent',
  ]), {
    grantId: input.grantId,
    examId: input.examId,
    attemptId: input.attemptId,
    candidateNumber: input.candidateNumber,
  });
  return {
    ...result,
    evidence: {
      exam: {
        ...projectScalarFields(evidence.exam, [
          'title', 'status', 'publicationId', 'publicationNumber',
        ]),
        questions: projectEvidenceQuestions(evidence.exam?.questions),
      },
      attempt: projectScalarFields(evidence.attempt, [
        'status', 'startedAt', 'serverDeadline', 'submittedAt', 'generation',
      ]),
      submissionHistory: (Array.isArray(evidence.submissionHistory)
        ? evidence.submissionHistory.slice(0, 50)
        : []).map((entry) => ({
        ...projectScalarFields(entry, [
          'generation', 'receiptId', 'receivedAt', 'snapshotHash', 'automatic',
          'reopeningId', 'priorSubmissionGeneration',
        ]),
        answerSnapshot: projectAnswerSnapshot(entry?.answerSnapshot),
      })),
      answerOperations: projectEvidenceRows(evidence.answerOperations, [
        'operationId', 'questionId', 'sessionEpoch', 'localSequence',
        'baseRevision', 'answerText', 'contentHash', 'disposition',
        'resultingRevision', 'clientSavedAt', 'serverReceivedAt',
      ], 2_000),
      conflictBranches: projectEvidenceRows(evidence.conflictBranches, [
        'operationId', 'questionId', 'baseRevision', 'serverRevision',
        'incomingAnswerText', 'incomingContentHash', 'serverAnswerText',
        'serverContentHash', 'branchReason', 'clientSavedAt', 'preservedAt',
      ], 500),
      sessions: projectEvidenceRows(evidence.sessions, [
        'sessionId', 'epoch', 'status', 'openedAt', 'lastSeenAt', 'endedAt', 'endReason',
      ], 100),
      sessionEvents: (Array.isArray(evidence.sessionEvents)
        ? evidence.sessionEvents.slice(0, 1_000)
        : []).map((entry) => ({
        ...projectScalarFields(entry, ['eventType', 'epoch', 'occurredAt']),
        metadata: projectEvidenceMetadata(entry?.metadata),
      })),
      integrityEvents: (Array.isArray(evidence.integrityEvents)
        ? evidence.integrityEvents.slice(0, 2_000)
        : []).map((entry) => ({
        ...projectScalarFields(entry, ['eventType', 'severity', 'occurredAt']),
        details: projectEvidenceMetadata(entry?.details),
      })),
      incidentGroups: projectEvidenceRows(evidence.incidentGroups, [
        'incidentId', 'category', 'severity', 'status', 'eventCount',
        'firstOccurredAt', 'lastOccurredAt', 'summary',
      ], 500),
      temporaryLeaves: projectEvidenceRows(evidence.temporaryLeaves, [
        'leaveId', 'status', 'startedAt', 'acknowledgedAt', 'returnedAt',
      ], 100),
      deadlineExtensions: projectEvidenceRows(evidence.deadlineExtensions, [
        'previousDeadline', 'newDeadline', 'extensionMinutes', 'extensionType',
        'reason', 'grantedAt',
      ], 100),
      grades: projectEvidenceRows(evidence.grades, [
        'questionId', 'score', 'maximumPoints', 'comment', 'gradeState',
        'revision', 'gradedAt',
      ], 200),
      gradeHistory: projectEvidenceRows(evidence.gradeHistory, [
        'questionId', 'revision', 'score', 'maximumPoints', 'comment',
        'gradeState', 'changeReason', 'changedAt',
      ], 1_000),
    },
  };
}

function rejectRetiredDisputeOperation(operation) {
  if (RETIRED_DISPUTE_OPERATIONS.has(operation)) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_DISPUTE_UNAVAILABLE',
      'Dispute access is unavailable until the scoped, step-up review process is enabled.',
      403,
    );
  }
}

function gradingModelAnswerView(value, examId) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (source.ok !== true) {
    return {
      ok: false,
      examId,
      available: false,
      mode: 'none',
      code: MODEL_ANSWER_FAILURE_CODES.has(source.code)
        ? source.code
        : 'MODEL_ANSWER_UNAVAILABLE',
    };
  }
  const contentHash = MODEL_ANSWER_HASH.test(String(source.contentHash || '').toLowerCase())
    ? String(source.contentHash).toLowerCase()
    : null;
  if (source.mode === 'paste') {
    const answerText = typeof source.answerText === 'string' ? source.answerText : null;
    if (source.available !== true || answerText == null || Array.from(answerText).length > 100_000) {
      return {
        ok: true,
        examId,
        available: false,
        mode: 'paste',
        code: 'MODEL_ANSWER_UNAVAILABLE',
        contentHash,
      };
    }
    return {
      ok: true,
      examId,
      available: true,
      mode: 'paste',
      answerText,
      contentHash,
    };
  }
  if (source.mode === 'upload') {
    const safeFileName = MODEL_ANSWER_FILE_NAME.test(String(source.safeFileName || ''))
      ? String(source.safeFileName)
      : null;
    const mimeType = MODEL_ANSWER_MIME_TYPES.has(String(source.mimeType || '').toLowerCase())
      ? String(source.mimeType).toLowerCase()
      : null;
    const size = Number(source.sizeBytes);
    return {
      ok: true,
      examId,
      available: false,
      mode: 'upload',
      code: 'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
      safeFileName,
      mimeType,
      sizeBytes: Number.isSafeInteger(size) && size >= 1 && size <= 10 * 1024 * 1024
        ? size
        : null,
      contentHash,
    };
  }
  return {
    ok: true,
    examId,
    available: false,
    mode: 'none',
    code: 'MODEL_ANSWER_NOT_CONFIGURED',
  };
}

async function beadlePortalView(env, value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const {
    activeStudentCodeEnvelope,
    ...publicResult
  } = source;
  if (!activeStudentCodeEnvelope || source.studentCodeRecoverable !== true) {
    return {
      ...publicResult,
      activeStudentExamCode: null,
      studentCodeRecoverable: false,
      studentCodeRecoveryCode: source.studentAccessReady === true
        ? 'LEGACY_STUDENT_CODE_NOT_RECOVERABLE'
        : null,
    };
  }
  try {
    return {
      ...publicResult,
      activeStudentExamCode: await decryptStudentExamCode(env, activeStudentCodeEnvelope),
      studentCodeRecoverable: true,
      studentCodeRecoveryCode: null,
    };
  } catch (error) {
    return {
      ...publicResult,
      activeStudentExamCode: null,
      studentCodeRecoverable: false,
      studentCodeRecoveryCode: error?.code === 'STUDENT_CODE_KEY_UNAVAILABLE'
        ? 'STUDENT_CODE_KEY_UNAVAILABLE'
        : 'STUDENT_CODE_RECOVERY_FAILED',
    };
  }
}

export function createDD2026Handlers(deps) {
  const {
    corsHeaders,
    dd2026Rpc,
    enforceAdminRateLimit,
    enforceDD2026RateLimit,
    enforceExamRoomRateLimit,
    examRoomRpc,
    jsonResponse,
    parseBoundedJson,
    processExamRoomQueues,
    requireAdministrator,
    requireAuthenticatedUser,
    resolveVerdictQuestion,
    structuredGemini,
    uploadExamRoomSource,
  } = deps;
  const examRateLimit = enforceExamRoomRateLimit
    || ((request, env, _userId, mode = 'read') => (
      enforceDD2026RateLimit(request, env, mode !== 'read')
    ));

  function requireExamRoomEnabled(env) {
    if (!featureFlag(env, EXAMINATION_ROOM_BASE_FLAG)) {
      throw new DD2026ValidationError(
        'EXAMINATION_ROOM_DISABLED',
        'The Examination Room is not available.',
        404,
      );
    }
  }

  function examRoom2Enabled(env) {
    return featureFlag(env, EXAMINATION_ROOM_BASE_FLAG)
      && featureFlag(env, EXAMINATION_ROOM_2_FLAG);
  }

  function requireExamRoom2Enabled(env) {
    requireExamRoomEnabled(env);
    if (!featureFlag(env, EXAMINATION_ROOM_2_FLAG)) {
      throw new DD2026ValidationError(
        'EXAMINATION_ROOM_2_DISABLED',
        'Examination Room 2.0 is not available.',
        404,
      );
    }
  }

  function isExamRoom2Query(input) {
    return EXAM_ROOM_2_QUERY_OPERATIONS.has(String(input?.operation || ''))
      || (input?.operation === 'attempt' && Boolean(input.sessionId));
  }

  async function features(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const result = await dd2026Rpc(env, 'dd2026_feature_snapshot', { p_user_id: user.id });
    const storedFlags = result?.flags && typeof result.flags === 'object'
      && !Array.isArray(result.flags) ? result.flags : {};
    const legacyEnabled = featureFlag(env, EXAMINATION_ROOM_BASE_FLAG)
      && storedFlags[EXAMINATION_ROOM_BASE_FLAG] !== false;
    return jsonResponse({
      ok: true,
      ...result,
      flags: {
        ...storedFlags,
        [EXAMINATION_ROOM_BASE_FLAG]: legacyEnabled,
        [EXAMINATION_ROOM_2_FLAG]: legacyEnabled && featureFlag(env, EXAMINATION_ROOM_2_FLAG),
      },
    }, 200, origin, allowedOrigin);
  }

  async function contentQuery(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeContentQuery(await parseBoundedJson(request, 25_000));
    const result = await dd2026Rpc(env, 'dd2026_content_list', {
      p_user_id: user.id,
      p_content_type: input.contentType,
      p_subject: input.subject,
      p_search: input.search,
      p_limit: input.limit,
      p_offset: input.offset,
    });
    return jsonResponse({
      ok: true,
      ...result,
      items: Array.isArray(result?.items) ? result.items.map(publicContentItem) : [],
    }, 200, origin, allowedOrigin);
  }

  async function contentItem(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeContentItemRequest(await parseBoundedJson(request, 10_000));
    const result = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: input.contentType,
      p_content_id: input.contentId,
    });
    return jsonResponse({ ok: true, item: publicContentItem(result) }, 200, origin, allowedOrigin);
  }

  async function barEasyGrade(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeBarEasyRequest(await parseBoundedJson(request, 20_000));
    const content = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: 'bar_easy',
      p_content_id: input.contentId,
    });
    const coached = await structuredGemini(
      env,
      buildBarEasyPrompt(content, input.answer),
      BAR_EASY_RESPONSE_SCHEMA,
      validateBarEasyResult,
    );
    const completion = await dd2026Rpc(
      env,
      'dd2026_record_bar_easy_completion',
      barEasyPersistencePayload(user.id, content.id, input, coached.model),
    );
    return jsonResponse({
      ok: true,
      result: coached.result,
      study: barEasyReveal(content),
      completion,
      notice: 'AI-prepared beta. Verify independently against current law and the linked primary source.',
    }, 200, origin, allowedOrigin);
  }

  async function doctrineGrade(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeDoctrineRequest(await parseBoundedJson(request, 15_000));
    const content = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: 'doctrine',
      p_content_id: input.contentId,
    });
    const coached = await structuredGemini(
      env,
      buildDoctrinePrompt(content, input.answer),
      DOCTRINE_RESPONSE_SCHEMA,
      validateDoctrineResult,
    );
    const completion = await dd2026Rpc(
      env,
      'dd2026_record_doctrine_mastery',
      doctrinePersistencePayload(user.id, content.id, input, coached.result, coached.model),
    );
    return jsonResponse({
      ok: true,
      result: coached.result,
      study: doctrineReveal(content),
      completion,
      privacy: 'Your answer text is not saved. Only your mastery result is recorded.',
      notice: 'AI-prepared beta. Verify independently against current law and the linked primary source.',
    }, 200, origin, allowedOrigin);
  }

  async function verdictPdf(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeVerdictPdfRequest(await parseBoundedJson(request, 25_000));
    let result = await dd2026Rpc(env, 'dd2026_verdict_result', {
      p_user_id: user.id,
      p_grading_result_id: input.gradingResultId,
    });
    if (result?.sourceType === 'phase4_exam_attempt') {
      const source = await resolveVerdictQuestion(result.questionBankId, env);
      if (!source?.question || !source?.suggestedAnswer) {
        throw new DD2026ValidationError(
          'VERDICT_SOURCE_UNAVAILABLE',
          'The complete source record for this result is temporarily unavailable. Try again later.',
          503,
        );
      }
      result = {
        ...result,
        questionId: result.questionBankId,
        question: source.question,
        suggestedAnswer: source.suggestedAnswer,
        questionNumber: result.questionBankId,
      };
    }
    const bytes = await buildVerdictPdf({
      result,
      selectionKind: input.selectionKind,
      selectedIds: input.selectedIds,
    });
    await dd2026Rpc(env, 'dd2026_record_verdict_export', {
      p_user_id: user.id,
      p_grading_result_id: input.gradingResultId,
      p_request_key: input.requestKey,
      p_selection_kind: input.selectionKind,
      p_selected_ids: input.selectedIds,
      p_output_bytes: bytes.length,
    });
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders(origin, allowedOrigin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${verdictPdfFileName(result)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  async function examResultPdf(request, env, origin, allowedOrigin) {
    requireExamRoom2Enabled(env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeExamResultPdfRequest(
      await parseBoundedJson(request, 20_000),
    );
    await examRateLimit(request, env, user.id, 'write', input.attemptId);
    const rateHash = await examRoomRateKey(request, user.id, input.examId);
    const result = await examRoomRpc(env, 'exam_room_prepare_result_export_v3', {
      p_professor_user_id: user.id,
      p_exam_public_id: input.examId,
      p_attempt_public_id: input.attemptId,
      p_export_scope: input.scope,
      p_request_key: input.requestKey,
      p_grading_key_hash: await hashedCredential(input.gradingKey),
      p_rate_key_hash: rateHash,
    });
    if (result?.ok !== true || !result?.exportId) {
      throw new DD2026ValidationError(
        String(result?.code || 'EXAM_ROOM_RESULT_EXPORT_DENIED'),
        'The Professor result download could not be authorized.',
        403,
      );
    }
    const bytes = await buildExamResultPdf(result);
    await examRoomRpc(env, 'exam_room_complete_result_export_v3', {
      p_professor_user_id: user.id,
      p_export_id: result.exportId,
      p_request_key: input.requestKey,
      p_output_bytes: bytes.length,
      p_output_sha256: await sha256Hex(bytes),
    });
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders(origin, allowedOrigin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${examResultPdfFileName(result)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  async function importContent(request, env, origin, allowedOrigin) {
    await enforceAdminRateLimit(request, env);
    const admin = await requireAdministrator(request, env);
    const payload = await parseBoundedJson(request, 2_500_000);
    if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 500) {
      throw new DD2026ValidationError('IMPORT_INVALID', 'Provide between 1 and 500 validated content rows.');
    }
    const result = await dd2026Rpc(env, 'dd2026_import_content_batch', {
      p_actor_user_id: admin.id,
      p_rows: payload.rows,
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function editorial(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 25_000);
    const result = await dd2026Rpc(env, 'dd2026_editorial_transition', {
      p_actor_user_id: user.id,
      p_content_id: String(payload.contentId || ''),
      p_version_id: String(payload.versionId || ''),
      p_action: String(payload.action || ''),
      p_note: payload.note == null ? null : String(payload.note),
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function examQuery(request, env, origin, allowedOrigin) {
    requireExamRoomEnabled(env);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 30_000);
    if (isExamRoom2Query(payload)) requireExamRoom2Enabled(env);
    const input = normalizeExamRoomQuery(payload);
    await examRateLimit(
      request,
      env,
      user.id,
      'read',
      input.examId || input.attemptId || input.disputeId || input.operation,
    );
    rejectRetiredDisputeOperation(input.operation);
    if (input.operation === 'portal') {
      const portal = await examRoomRpc(env, 'exam_room_portal_snapshot', { p_user_id: user.id });
      if (!examRoom2Enabled(env)) {
        return jsonResponse({ ok: true, result: portal }, 200, origin, allowedOrigin);
      }
      const delegated = await examRoomRpc(env, 'exam_room_beadle_portal_v3', {
          p_user_id: user.id,
          p_exam_public_id: null,
      });
      const assignments = Array.isArray(delegated?.assignments) ? delegated.assignments : [];
      const result = {
        ...(portal || {}),
        roles: {
          ...(portal?.roles || {}),
          beadle: assignments.some((assignment) => assignment?.role === 'beadle'),
        },
        beadleExams: assignments,
        beadleAssignments: assignments,
      };
      return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
    }
    let functionName;
    let body;
    if (input.operation === 'activation_ledger') {
      const admin = await requireAdministrator(request, env);
      functionName = 'exam_room_admin_professor_activation_ledger';
      body = {
        p_actor_user_id: admin.id,
        p_status: input.status,
        p_limit: input.limit,
        p_offset: input.offset,
      };
    } else if (input.operation === 'exam_intent') {
      functionName = 'exam_room_exam_access_v3';
      body = { p_user_id: user.id, p_exam_public_id: input.examId };
    } else if (input.operation === 'professor_authoring_snapshot') {
      functionName = 'exam_room_professor_authoring_snapshot_v2';
      body = { p_professor_user_id: user.id, p_exam_public_id: input.examId };
    } else if (input.operation === 'preflight') {
      functionName = 'exam_room_student_waiting_room_v4';
      body = {
        p_student_user_id: user.id,
        p_exam_public_id: input.examId,
        p_student_key_hash: input.studentKey
          ? await hashedCredential(input.studentKey)
          : null,
        p_rate_key_hash: await examRoomRateKey(request, user.id, input.examId),
        p_device_instance_hash: input.deviceInstanceHash,
      };
    } else if (input.operation === 'beadle_portal') {
      functionName = 'exam_room_beadle_portal_v5';
      body = { p_user_id: user.id, p_exam_public_id: input.examId };
    } else if (input.operation === 'incident_summary') {
      functionName = 'exam_room_incident_summary_v2';
      body = { p_actor_user_id: user.id, p_exam_public_id: input.examId };
    } else if (input.operation === 'attempt') {
      functionName = input.sessionId ? 'exam_room_attempt_view_v2' : 'exam_room_attempt_view';
      body = input.sessionId ? {
        p_student_user_id: user.id,
        p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId,
        p_session_epoch: input.sessionEpoch,
      } : {
        p_student_user_id: user.id,
        p_attempt_public_id: input.attemptId,
      };
    } else if (input.operation === 'submission_status') {
      functionName = 'exam_room_submission_status_v2';
      body = {
        p_student_user_id: user.id,
        p_attempt_public_id: input.attemptId,
      };
    } else if (input.operation === 'live_status'
        || input.operation === 'live_status_v2'
        || input.operation === 'grading_workspace') {
      functionName = input.operation === 'live_status_v2'
        ? 'exam_room_live_status_v2'
        : input.operation === 'live_status'
          ? 'exam_room_live_status'
          : 'exam_room_grading_workspace';
      body = { p_professor_user_id: user.id, p_exam_public_id: input.examId,
        p_grading_key_hash: await hashedCredential(input.gradingKey),
        p_rate_key_hash: await examRoomRateKey(request, user.id, input.examId) };
    } else if (input.operation === 'grading_model_answer') {
      functionName = 'exam_room_grading_model_answer_v2';
      body = { p_professor_user_id: user.id, p_exam_public_id: input.examId,
        p_grading_key_hash: await hashedCredential(input.gradingKey),
        p_rate_key_hash: await examRoomRateKey(request, user.id, input.examId) };
    } else if (input.operation === 'break_glass_view') {
      const stepUp = requireVerifiedAal2(user);
      functionName = 'exam_room_admin_break_glass_evidence_v2';
      body = {
        p_admin_user_id: user.id,
        p_grant_public_id: input.grantId,
        p_exam_public_id: input.examId,
        p_attempt_public_id: input.attemptId,
        p_candidate_number: input.candidateNumber,
        p_verified_aal: stepUp.aal,
        p_verified_session_id: stepUp.sessionId,
        p_verified_authentication_at: stepUp.authenticatedAt,
        p_request_key: input.requestKey,
      };
    } else if (input.operation === 'student_result') {
      functionName = 'exam_room_student_result';
      body = { p_student_user_id: user.id, p_exam_public_id: input.examId };
    } else {
      throw new DD2026ValidationError(
        'UNSUPPORTED_OPERATION',
        'This Examination Room query is not supported.',
      );
    }
    const result = await examRoomRpc(env, functionName, body);
    if (input.operation === 'activation_ledger') {
      return jsonResponse({
        ok: true,
        result: professorActivationLedgerView(result),
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'exam_intent') {
      const { storagePrefix: _privateStoragePrefix, ...publicIntent } = result || {};
      return jsonResponse({ ok: true, result: publicIntent }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'professor_authoring_snapshot') {
      return jsonResponse({
        ok: true,
        result: professorAuthoringSnapshotView(result, input.examId),
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'beadle_portal') {
      return jsonResponse({
        ok: true,
        result: await beadlePortalView(env, result),
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'attempt') {
      // Session identifiers are bearer-like concurrency credentials. Never
      // disclose an already-active session through the answer bundle: every
      // page load or device resume must prove its device hash to open_session.
      const {
        sessionId: _activeSessionId,
        sessionEpoch: _activeSessionEpoch,
        ...attemptView
      } = result || {};
      return jsonResponse({
        ok: true,
        result: { ...attemptView, sessionRequired: true },
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'grading_model_answer') {
      return jsonResponse({
        ok: true,
        result: gradingModelAnswerView(result, input.examId),
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'live_status_v2') {
      return jsonResponse({
        ok: true,
        result: liveStatusV2View(result, input),
      }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'break_glass_view') {
      return jsonResponse({
        ok: true,
        result: breakGlassEvidenceView(result, input),
      }, 200, origin, allowedOrigin);
    }
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function rosterUpload(request, env, origin, allowedOrigin) {
    requireExamRoomEnabled(env);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 3_000_000);
    const intent = normalizeRosterUploadIntent(payload);
    if (intent.examId) requireExamRoom2Enabled(env);
    await examRateLimit(request, env, user.id, 'upload', intent.examId || intent.classroomId);
    if (intent.examId) {
      const access = await examRoomRpc(env, 'exam_room_exam_access_v3', {
        p_user_id: user.id,
        p_exam_public_id: intent.examId,
      });
      if (access?.canManageRoster !== true) {
        throw new DD2026ValidationError(
          'EXAM_ROOM_OPERATOR_REQUIRED',
          'Professor, administrator, or active Beadle authorization is required.',
          403,
        );
      }
    } else {
      const portal = await examRoomRpc(env, 'exam_room_portal_snapshot', { p_user_id: user.id });
      const ownsClassroom = portal?.roles?.professor === true
        && Array.isArray(portal.classes)
        && portal.classes.some((classroom) => classroom?.classroomId === intent.classroomId);
      if (!ownsClassroom) {
        throw new DD2026ValidationError(
          'EXAM_ROOM_PROFESSOR_REQUIRED',
          'An owning professor account is required.',
          403,
        );
      }
    }
    const input = await normalizeRosterUpload(payload, intent);
    const validation = input.examId
      ? await examRoomRpc(env, 'exam_room_validate_exam_roster_v2', {
        p_actor_user_id: user.id,
        p_exam_public_id: input.examId,
        p_rows: input.rows,
      })
      : await examRoomRpc(env, 'exam_room_validate_roster', {
        p_professor_user_id: user.id,
        p_classroom_public_id: input.classroomId,
        p_rows: input.rows,
      });
    return jsonResponse({
      ok: true,
      examId: input.examId,
      classroomId: input.classroomId,
      rows: input.rows,
      sourceHash: input.sourceHash,
      validation,
    }, 200, origin, allowedOrigin);
  }

  async function questionUpload(request, env, origin, allowedOrigin) {
    requireExamRoom2Enabled(env);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 14_500_000);
    const intent = normalizeQuestionUploadIntent(payload);
    await examRateLimit(request, env, user.id, 'upload', intent.examId);
    const access = await examRoomRpc(env, 'exam_room_exam_access_v3', {
      p_user_id: user.id,
      p_exam_public_id: intent.examId,
    });
    if (access?.canUploadQuestions !== true && access?.canUploadReplacementQuestions !== true) {
      throw new DD2026ValidationError('EXAM_ROOM_PROFESSOR_REQUIRED', 'An owning professor account is required.', 403);
    }
    const input = await normalizeQuestionUpload(payload, intent);
    const storagePrefix = String(access.storagePrefix || '').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(storagePrefix)) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_UPLOAD_UNAVAILABLE',
        'The private upload location is temporarily unavailable.',
        503,
      );
    }
    const objectPath = `${storagePrefix}/${input.contentHash}/${input.fileName}`;
    await uploadExamRoomSource(env, objectPath, input.bytes, input.mimeType);
    return jsonResponse({
      ok: true,
      preview: {
        examId: input.examId,
        questionCount: input.questionCount,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        pageCount: input.pageCount,
        contentHash: input.contentHash,
        objectPath,
        questions: input.questions,
        warnings: input.warnings,
        extractionMode: input.extractionMode,
      },
    }, 200, origin, allowedOrigin);
  }

  async function modelAnswerUpload(request, env, origin, allowedOrigin) {
    requireExamRoom2Enabled(env);
    await requireAuthenticatedUser(request, env);
    throw new DD2026ValidationError(
      'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE',
      'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.',
    );
  }

  async function examCommand(request, env, origin, allowedOrigin, ctx) {
    requireExamRoomEnabled(env);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 2_500_000);
    if (EXAM_ROOM_2_COMMAND_OPERATIONS.has(String(payload?.operation || ''))) {
      requireExamRoom2Enabled(env);
    }
    if (payload?.operation === 'create_classroom') {
      throw new DD2026ValidationError(
        'EXAM_ROOM_ROOM_KEY_REQUIRED',
        'Ask Due Diligence Admin for a one-time Professor key. Each key opens one Examination Room.',
        403,
      );
    }
    const input = normalizeExamRoomCommand(payload);
    await examRateLimit(
      request,
      env,
      user.id,
      input.operation === 'save_answer_operation' ? 'sync' : 'write',
      input.examId || input.attemptId || input.disputeId || input.operation,
    );
    rejectRetiredDisputeOperation(input.operation);
    if (input.operation === 'save_answer_operation'
        && await sha256Hex(input.answerText) !== input.contentHash) {
      throw new DD2026ValidationError(
        'ANSWER_HASH_MISMATCH',
        'The locally saved answer digest does not match its content. Keep this page open and retry.',
      );
    }
    const stepUpRequired = new Set([
      'issue_break_glass', 'close_break_glass', 'record_break_glass_review',
    ]).has(input.operation) || (input.operation === 'reopen_submission' && input.breakGlassGrantId);
    const stepUp = stepUpRequired ? requireVerifiedAal2(user) : null;
    const rateHash = await examRoomRateKey(
      request,
      user.id,
      input.examId || input.attemptId || input.disputeId || input.operation,
    );
    const actor = ['issue_activation', 'revoke_activation'].includes(input.operation)
      ? await requireAdministrator(request, env)
      : user;
    const spec = await commandSpec(input, actor.id, rateHash, stepUp, env);
    if (input.operation === 'confirm_questions' || input.operation === 'confirm_replacement_questions') {
      const access = await examRoomRpc(env, 'exam_room_exam_access_v3', {
        p_user_id: user.id,
        p_exam_public_id: input.examId,
      });
      const prefix = `${String(access?.storagePrefix || '').toLowerCase()}/`;
      const canConfirm = input.operation === 'confirm_replacement_questions'
        ? access?.canStageReplacementQuestions === true
          || access?.canUploadReplacementQuestions === true
        : access?.canUploadQuestions === true;
      if (!canConfirm || !/^[0-9a-f-]{36}\/$/.test(prefix)) {
        throw new DD2026ValidationError(
          'EXAM_ROOM_PROFESSOR_REQUIRED',
          'An owning professor account is required.',
          403,
        );
      }
      if (!input.objectPath.startsWith(prefix) || input.objectPath.includes('..')) {
        throw new DD2026ValidationError('INVALID_SOURCE_PATH', 'The private source reference is invalid.');
      }
    }
    // A source path is content-addressed and may have existed before this
    // command. A confirmation failure therefore leaves it private for orphan
    // cleanup instead of risking deletion of another valid registration.
    const result = await examRoomRpc(env, spec.functionName, spec.body);
    if ([
      'submit_attempt', 'submit_attempt_generation', 'replace_publication',
      'reschedule_publication', 'reopen_submission', 'release_results',
    ].includes(input.operation)
        && ctx?.waitUntil) {
      ctx.waitUntil(processExamRoomQueues(env));
    }
    const publicResult = input.operation === 'issue_activation'
      ? professorActivationIssueView(result, input)
      : input.operation === 'redeem_activation'
        ? professorActivationRedeemView(result)
          : input.operation === 'revoke_activation'
          ? professorActivationRevokeView(result, input)
          : ['update_exam_details', 'revise_draft_questions', 'save_rules_draft',
            'reopen_exam_roster'].includes(input.operation)
            ? professorAuthoringMutationView(result, input)
          : input.operation === 'publish_for_beadle'
            ? {
              ...(result || {}),
              oneTimeBeadleKey: input.beadleInvitationKey,
              oneTimeOnly: true,
            }
            : input.operation === 'issue_student_access'
              ? {
                ...(result || {}),
                oneTimeStudentAccessCode: input.studentKey,
                activeStudentExamCode: input.studentKey,
                oneTimeOnly: false,
                studentCodeRecoverable: true,
              }
          : input.operation === 'confirm_replacement_questions'
      ? stagedReplacementQuestionsView(result, input)
      : input.operation === 'replace_publication'
      ? publicationReplacementView(result, input)
      : input.operation === 'reschedule_publication'
        ? publicationRescheduleView(result, input)
      : input.operation === 'reopen_submission'
        ? reopenedSubmissionView(result, input)
        : ['issue_break_glass', 'close_break_glass', 'record_break_glass_review'].includes(input.operation)
          ? breakGlassActionView(result, input)
          : result;
    return jsonResponse({ ok: true, result: publicResult }, 200, origin, allowedOrigin);
  }

  async function commandSpec(input, userId, rateHash, stepUp = null, env = {}) {
    const h = hashedCredential;
    const noAccessCodePlaceholderHash = async () => {
      const random = new Uint8Array(32);
      crypto.getRandomValues(random);
      return sha256Hex(random);
    };
    const specs = {
      issue_activation: async () => ({ functionName: 'exam_room_issue_professor_activation', body: {
        p_actor_user_id: userId, p_target_email: input.targetEmail,
        p_token_hash: await h(input.activationKey), p_room_title: input.roomTitle,
        p_school_name: input.schoolName, p_academic_term: input.academicTerm,
        p_expires_at: input.expiresAt, p_reason: input.reason,
      } }),
      redeem_activation: async () => ({ functionName: 'exam_room_redeem_professor_activation', body: {
        p_user_id: userId, p_token_hash: await h(input.activationKey), p_rate_key_hash: rateHash,
      } }),
      revoke_activation: async () => ({ functionName: 'exam_room_admin_revoke_professor_activation', body: {
        p_actor_user_id: userId, p_activation_id: input.activationId,
        p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      validate_roster: async () => ({ functionName: 'exam_room_validate_roster', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId, p_rows: input.rows,
      } }),
      import_roster: async () => ({ functionName: 'exam_room_import_roster', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId, p_rows: input.rows,
        p_request_key: input.requestKey, p_source_hash: input.sourceHash,
      } }),
      validate_exam_roster: async () => ({ functionName: 'exam_room_validate_exam_roster_v2', body: {
        p_actor_user_id: userId, p_exam_public_id: input.examId, p_rows: input.rows,
      } }),
      import_exam_roster: async () => ({ functionName: 'exam_room_import_exam_roster_v2', body: {
        p_actor_user_id: userId, p_exam_public_id: input.examId, p_rows: input.rows,
        p_request_key: input.requestKey, p_source_hash: input.sourceHash,
      } }),
      upsert_exam_roster_row: async () => ({ functionName: 'exam_room_upsert_roster_row_v2', body: {
        p_actor_user_id: userId, p_exam_public_id: input.examId, p_row: input.row,
        p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      create_exam: async () => ({ functionName: 'exam_room_create_exam', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId,
        p_title: input.title, p_instructions: input.instructions,
        p_requested_question_count: input.questionCount, p_integrity_preset: input.integrityPreset,
        p_include_questionnaire: input.includeQuestionnaire,
      } }),
      update_exam_details: async () => ({
        functionName: 'exam_room_update_details_v1',
        body: {
          p_professor_user_id: userId,
          p_exam_public_id: input.examId,
          p_expected_revision: input.expectedRevision,
          p_title: input.title,
          p_instructions: input.instructions,
          p_requested_question_count: input.questionCount,
          p_integrity_preset: input.integrityPreset,
          p_include_questionnaire: input.includeQuestionnaire,
          p_request_key: input.requestKey,
        },
      }),
      confirm_questions: async () => ({ functionName: 'exam_room_confirm_questions', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_object_path: input.objectPath, p_safe_file_name: input.fileName,
        p_mime_type: input.mimeType, p_size_bytes: input.sizeBytes, p_page_count: input.pageCount,
        p_content_hash: input.contentHash, p_questions: input.questions, p_warnings: input.warnings,
      } }),
      confirm_replacement_questions: async () => ({
        functionName: 'exam_room_confirm_replacement_questions_v2',
        body: {
          p_professor_user_id: userId, p_exam_public_id: input.examId,
          p_expected_publication_id: input.expectedPublicationId,
          p_object_path: input.objectPath, p_safe_file_name: input.fileName,
          p_mime_type: input.mimeType, p_size_bytes: input.sizeBytes,
          p_page_count: input.pageCount, p_content_hash: input.contentHash,
          p_questions: input.questions, p_warnings: input.warnings,
          p_request_key: input.requestKey,
        },
      }),
      revise_draft_questions: async () => ({
        functionName: 'exam_room_revise_draft_questions_v1',
        body: {
          p_professor_user_id: userId,
          p_exam_public_id: input.examId,
          p_expected_revision: input.expectedRevision,
          p_expected_question_version_id: input.expectedQuestionVersionId,
          p_questions: input.questions,
          p_request_key: input.requestKey,
        },
      }),
      save_rules_draft: async () => ({
        functionName: 'exam_room_save_rules_draft_v1',
        body: {
          p_professor_user_id: userId,
          p_exam_public_id: input.examId,
          p_expected_revision: input.expectedRevision,
          p_rules: input.rules,
          p_beadle_email: input.beadleEmail,
          p_request_key: input.requestKey,
        },
      }),
      schedule_exam: async () => ({ functionName: 'exam_room_schedule_exam', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_opens_at: input.opensAt, p_hard_closes_at: input.hardClosesAt,
        p_duration_minutes: input.durationMinutes,
        // The foundation scheduler predates optional access codes and requires
        // a hash. For roster-only exams use an unreturnable random placeholder;
        // publication revokes it when freezing studentAccessCodeRequired=false.
        p_student_key_hash: input.studentKey
          ? await h(input.studentKey)
          : await noAccessCodePlaceholderHash(),
        p_grading_key_hash: await h(input.gradingKey),
      } }),
      publish_exam: async () => ({ functionName: 'exam_room_publish_exam_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_rules: input.rules,
        p_student_key_hash: input.studentKey ? await h(input.studentKey) : null,
        p_request_key: input.requestKey,
      } }),
      publish_for_beadle: async () => ({
        functionName: 'exam_room_publish_for_beadle_v4',
        body: {
          p_professor_user_id: userId,
          p_exam_public_id: input.examId,
          p_expected_revision: input.expectedRevision,
          p_rules: input.rules,
          p_grading_key_hash: await h(input.gradingKey),
          p_beadle_email: input.beadleEmail,
          p_beadle_token_hash: await h(input.beadleInvitationKey),
          p_beadle_expires_at: input.beadleExpiresAt,
          p_beadle_reason: input.reason,
          p_request_key: input.requestKey,
        },
      }),
      reschedule_publication: async () => ({
        functionName: 'exam_room_reschedule_publication_v1',
        body: {
          p_professor_user_id: userId,
          p_exam_public_id: input.examId,
          p_expected_publication_id: input.expectedPublicationId,
          p_expected_workspace_revision: input.expectedWorkspaceRevision,
          p_opens_at: input.opensAt,
          p_hard_closes_at: input.hardClosesAt,
          p_duration_minutes: input.durationMinutes,
          p_late_admission_minutes: input.lateAdmissionMinutes,
          p_submission_grace_minutes: input.submissionGraceMinutes,
          p_reason: input.reason,
          p_request_key: input.requestKey,
        },
      }),
      replace_publication: async () => ({ functionName: 'exam_room_replace_publication_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_expected_publication_id: input.expectedPublicationId,
        p_replacement_question_version_id: input.replacementQuestionVersionId,
        p_rules: input.rules,
        p_student_key_hash: input.studentKey ? await h(input.studentKey) : null,
        p_grading_key_hash: await h(input.gradingKey), p_reason: input.reason,
        p_request_key: input.requestKey,
      } }),
      invite_beadle: async () => ({ functionName: 'exam_room_issue_beadle_invitation_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_target_email: input.targetEmail, p_token_hash: await h(input.invitationKey),
        p_expires_at: input.expiresAt, p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      redeem_beadle_invitation: async () => ({ functionName: 'exam_room_redeem_beadle_invitation_v2', body: {
        p_beadle_user_id: userId, p_token_hash: await h(input.invitationKey),
        p_request_key: input.requestKey,
      } }),
      revoke_beadle: async () => ({ functionName: 'exam_room_revoke_beadle_assignment_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_beadle_user_id: input.beadleUserId, p_reason: input.reason,
        p_request_key: input.requestKey,
      } }),
      issue_student_access: async () => {
        const studentKeyHash = await h(input.studentKey);
        let envelope;
        try {
          envelope = await encryptStudentExamCode(env, {
            examId: input.examId,
            tokenHash: studentKeyHash,
            studentKey: input.studentKey,
          });
        } catch {
          throw new DD2026ValidationError(
            'EXAM_ROOM_STUDENT_CODE_RECOVERY_UNAVAILABLE',
            'Student exam-code recovery is temporarily unavailable. No code was issued.',
            503,
          );
        }
        return {
          functionName: 'exam_room_issue_student_access_v4',
          body: {
            p_beadle_user_id: userId,
            p_exam_public_id: input.examId,
            p_student_key_hash: studentKeyHash,
            p_code_ciphertext: envelope.ciphertext,
            p_code_nonce: envelope.nonce,
            p_code_key_id: envelope.keyId,
            p_code_algorithm: envelope.algorithm,
            p_request_key: input.requestKey,
          },
        };
      },
      reopen_exam_roster: async () => ({
        functionName: 'exam_room_reopen_roster_v1',
        body: {
          p_actor_user_id: userId,
          p_exam_public_id: input.examId,
          p_reason: input.reason,
          p_request_key: input.requestKey,
        },
      }),
      record_candidate_verification: async () => ({ functionName: 'exam_room_record_verification_v2', body: {
        p_actor_user_id: userId, p_exam_public_id: input.examId,
        p_candidate_number: input.candidateNumber, p_method: input.method,
        p_outcome: input.outcome, p_note: input.note, p_request_key: input.requestKey,
      } }),
      set_candidate_admission: async () => ({ functionName: 'exam_room_admit_candidate_v2', body: {
        p_actor_user_id: userId, p_exam_public_id: input.examId,
        p_candidate_number: input.candidateNumber, p_decision: input.decision,
        p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      set_accommodation: async () => ({ functionName: 'exam_room_set_accommodation_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_candidate_number: input.candidateNumber, p_accommodation: input.accommodation,
        p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      start_attempt: async () => ({ functionName: 'exam_room_start_attempt_v4', body: {
        p_student_user_id: userId, p_exam_public_id: input.examId,
        p_student_key_hash: input.studentKey ? await h(input.studentKey) : null,
        p_rate_key_hash: rateHash,
      } }),
      open_session: async () => ({ functionName: 'exam_room_open_session_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_device_instance_hash: input.deviceInstanceHash, p_request_key: input.requestKey,
      } }),
      save_answer: async () => ({ functionName: 'exam_room_save_answer', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_question_id: input.questionId, p_answer_text: input.answerText,
        p_expected_revision: input.expectedRevision,
      } }),
      save_answer_operation: async () => ({ functionName: 'exam_room_save_answer_operation_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_operation_id: input.operationId, p_question_id: input.questionId,
        p_local_sequence: input.localSequence, p_answer_text: input.answerText,
        p_base_revision: input.expectedRevision, p_content_hash: input.contentHash,
        p_client_saved_at: input.clientSavedAt, p_outage_evidence: input.outageEvidence,
      } }),
      heartbeat: async () => ({ functionName: 'exam_room_heartbeat', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
      } }),
      heartbeat_v2: async () => ({ functionName: 'exam_room_heartbeat_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
      } }),
      integrity_event: async () => ({ functionName: 'exam_room_record_integrity_event', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_event_type: input.eventType, p_details: input.details,
      } }),
      record_integrity_event: async () => ({ functionName: 'exam_room_record_integrity_event_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_client_event_id: input.clientEventId, p_event_type: input.eventType,
        p_details: input.details, p_client_occurred_at: input.clientOccurredAt,
      } }),
      submit_attempt: async () => ({ functionName: 'exam_room_submit_attempt', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId, p_request_key: input.requestKey,
      } }),
      submit_attempt_generation: async () => ({ functionName: 'exam_room_submit_attempt_generation_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_client_answer_set_hash: input.answerSetHash, p_request_key: input.requestKey,
        p_client_pending_at: input.clientPendingAt, p_offline_since: input.offlineSince,
        p_outage_evidence: input.outageEvidence,
      } }),
      reopen_submission: async () => ({ functionName: 'exam_room_reopen_submission_generation_v2', body: {
        p_actor_user_id: userId, p_attempt_public_id: input.attemptId,
        p_new_deadline: input.newDeadline, p_reason: input.reason,
        p_request_key: input.requestKey,
        p_grading_key_hash: input.gradingKey ? await h(input.gradingKey) : null,
        p_rate_key_hash: input.gradingKey ? rateHash : null,
        p_admin_break_glass_grant_public_id: input.breakGlassGrantId,
        p_verified_aal: stepUp?.aal || null,
        p_verified_session_id: stepUp?.sessionId || null,
        p_verified_authentication_at: stepUp?.authenticatedAt || null,
      } }),
      transfer_session: async () => ({ functionName: 'exam_room_transfer_session_v2', body: {
        p_actor_user_id: userId, p_attempt_public_id: input.attemptId,
        p_expected_epoch: input.expectedEpoch, p_device_instance_hash: input.deviceInstanceHash,
        p_reason: input.reason, p_request_key: input.requestKey,
      } }),
      issue_erratum: async () => ({ functionName: 'exam_room_issue_erratum_v2', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_erratum_type: input.erratumType, p_body: input.body,
        p_affected_question_ids: input.affectedQuestionIds,
        p_effective_at: input.effectiveAt, p_request_key: input.requestKey,
      } }),
      start_leave: async () => ({ functionName: 'exam_room_start_temporary_leave_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_reason_code: input.reasonCode, p_request_key: input.requestKey,
      } }),
      end_leave: async () => ({ functionName: 'exam_room_end_temporary_leave_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_request_key: input.requestKey,
      } }),
      acknowledge_leave: async () => ({ functionName: 'exam_room_acknowledge_temporary_leave_v2', body: {
        p_actor_user_id: userId, p_attempt_public_id: input.attemptId,
        p_leave_public_id: input.leaveId, p_action: input.action,
        p_note: input.note, p_request_key: input.requestKey,
      } }),
      record_technical_incident: async () => ({ functionName: 'exam_room_record_technical_incident_v2', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_session_public_id: input.sessionId, p_session_epoch: input.sessionEpoch,
        p_client_event_id: input.clientEventId, p_event_type: input.eventType,
        p_details: input.details, p_client_occurred_at: input.clientOccurredAt,
      } }),
      issue_break_glass: async () => ({ functionName: 'exam_room_issue_admin_break_glass_v2', body: {
        p_admin_user_id: userId, p_exam_public_id: input.examId,
        p_attempt_public_id: input.attemptId, p_candidate_number: input.candidateNumber,
        p_case_reference: input.caseReference, p_reason: input.reason, p_expires_at: input.expiresAt,
        p_verified_aal: stepUp?.aal, p_verified_session_id: stepUp?.sessionId,
        p_verified_authentication_at: stepUp?.authenticatedAt,
        p_request_key: input.requestKey,
      } }),
      close_break_glass: async () => ({ functionName: 'exam_room_close_admin_break_glass_v2', body: {
        p_admin_user_id: userId, p_grant_public_id: input.grantId,
        p_exam_public_id: input.examId, p_attempt_public_id: input.attemptId,
        p_candidate_number: input.candidateNumber,
        p_reason: input.reason,
        p_verified_aal: stepUp?.aal, p_verified_session_id: stepUp?.sessionId,
        p_verified_authentication_at: stepUp?.authenticatedAt,
        p_request_key: input.requestKey,
      } }),
      record_break_glass_review: async () => ({ functionName: 'exam_room_record_admin_break_glass_review_v2', body: {
        p_admin_user_id: userId, p_grant_public_id: input.grantId,
        p_exam_public_id: input.examId, p_attempt_public_id: input.attemptId,
        p_candidate_number: input.candidateNumber,
        p_outcome: input.outcome,
        p_notes: input.notes, p_verified_aal: stepUp?.aal,
        p_verified_session_id: stepUp?.sessionId,
        p_verified_authentication_at: stepUp?.authenticatedAt,
        p_request_key: input.requestKey,
      } }),
      save_grade: async () => ({ functionName: 'exam_room_save_grade', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_attempt_public_id: input.attemptId, p_question_id: input.questionId,
        p_score: input.score, p_comment: input.comment, p_grade_state: input.gradeState,
        p_expected_revision: input.expectedRevision, p_change_reason: input.changeReason,
        p_grading_key_hash: await h(input.gradingKey), p_rate_key_hash: rateHash,
      } }),
      unlock_attempt: async () => ({ functionName: 'exam_room_unlock_attempt', body: {
        p_actor_user_id: userId, p_attempt_public_id: input.attemptId, p_reason: input.reason,
        p_grading_key_hash: input.gradingKey ? await h(input.gradingKey) : null,
        p_rate_key_hash: input.gradingKey ? rateHash : null,
      } }),
      release_results: async () => ({ functionName: 'exam_room_release_results', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_request_key: input.requestKey, p_include_questionnaire: input.includeQuestionnaire,
        p_grading_key_hash: await h(input.gradingKey), p_rate_key_hash: rateHash,
      } }),
    };
    if (!specs[input.operation]) {
      throw new DD2026ValidationError('UNSUPPORTED_OPERATION', 'This Examination Room operation is not supported.');
    }
    return specs[input.operation]();
  }

  return {
    barEasyGrade,
    contentItem,
    contentQuery,
    doctrineGrade,
    editorial,
    examCommand,
    examQuery,
    examResultPdf,
    features,
    importContent,
    modelAnswerUpload,
    questionUpload,
    rosterUpload,
    verdictPdf,
  };
}
