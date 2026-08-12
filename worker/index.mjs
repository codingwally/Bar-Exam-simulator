import {
  DEFAULT_MODEL,
  ExaminerError,
  LABOR_CSV_URL,
  MODEL_FALLBACKS,
  RESPONSE_SCHEMA,
  applyDeterministicScoreCap,
  assessmentPolicy,
  buildExaminerPrompt,
  chooseQuestionContext,
  curatedModelAnswerALAC,
  modelAnswerSectionsForQuestion,
  modelAnswerQualityIssues,
  normalizeRequest,
  parseQuestionBank,
  questionFromBankRow,
  sanitizeSources,
  validateExaminerResult,
} from './examiner-core.mjs';
import {
  CORRECTION_LIMITS,
  CorrectionValidationError,
  correctionInsertRecord,
  normalizeCorrectionRequest,
} from './correction-core.mjs';
import {
  GUEST_DEVICE_ID_PATTERN,
  GUEST_GRADE_LIMIT,
  GuestAccessError,
  deriveGuestHashes,
  hmacHex,
  normalizeReservationResponse,
  publicGuestUsage,
  requireGuestHeaders,
} from './guest-access-core.mjs';
import {
  SUPPORT_LIMITS,
  SupportValidationError,
  normalizeSupportRequest,
  supportInsertRecord,
} from './support-core.mjs';
import {
  AnalyticsValidationError,
  analyticsRpcPayload,
  normalizeAnalyticsEvent,
} from './analytics-core.mjs';
import {
  ADMIN_DIRECTORY_EXPORT_MAX_BYTES,
  AdminValidationError,
  aggregateCsv,
  answerHistoryCsv,
  normalizeAnswerHistoryPreviewRequest,
  normalizeAnswerHistoryRequest,
  normalizeAdminAction,
  normalizeDashboardRequest,
  normalizeGlobalBetaChange,
  normalizeLiveActivityRequest,
  normalizeOperationalRequest,
  normalizeQuorumPostsRequest,
  normalizeUserDirectoryEmailExport,
  normalizeUserDirectoryRequest,
  normalizeUserResponseExport,
  resolveAdminDirectoryRecipient,
  subscriptionDirectoryCsv,
  utf8Base64,
  userDirectoryCsv,
  withUtf8Bom,
} from './admin-core.mjs';
import {
  AccessValidationError,
  accessDeniedError,
  isProtectedQuestionWithheld,
  normalizeAccessSnapshot,
  normalizeRequestKey,
  normalizeSubject,
  selectProtectedQuestion,
} from './access-core.mjs';
import {
  PRIVATE_BETA_ACCESS_SECONDS,
  PRIVATE_BETA_PENDING_SECONDS,
  PrivateBetaError,
  createPrivateBetaToken,
  hmacHex as privateBetaHmacHex,
  sha256Hex as privateBetaSha256Hex,
  validatePrivateBetaAcknowledgements,
  verifyPrivateBetaAccessCode,
  verifyPrivateBetaToken,
} from './private-beta-core.mjs';
import {
  PAYMENT_LIMITS,
  PaymentValidationError,
  normalizePartnershipRequest,
  normalizePaymentFields,
  normalizePhase4AdminAction,
  normalizePhase4AdminRequest,
  normalizeRefundRequest,
  proofExtension,
  validateProofSignature,
} from './payment-core.mjs';
import {
  FORUM_LIMITS,
  QUORUM_LIMITS,
  ForumValidationError,
  forumDatabaseError,
  forumUuid,
  normalizeForumAdminAction,
  normalizeForumAdminQueue,
  normalizeForumCommentRequest,
  normalizeForumDeleteRequest,
  normalizeForumFeedRequest,
  normalizeForumPostRequest,
  normalizeQuorumAdminRequest,
  normalizeQuorumCommandRequest,
  normalizeQuorumAvatar,
  normalizeQuorumImage,
  normalizeQuorumImages,
  normalizeQuorumQueryRequest,
  normalizeForumReactionRequest,
  normalizeForumReportRequest,
  normalizeForumRepostRequest,
} from './forum-core.mjs';
import {
  EXAMINATION_LIMITS,
  ExaminationValidationError,
  examinationDatabaseError,
  extractUploadedQuestions,
  normalizeExaminationAdmin,
  normalizeExaminationCommand,
  normalizeExaminationQuery,
  normalizeUploadRequest,
  sanitizeSubjectMatterCatalog,
  sanitizeSubjectMatterSelection,
} from './examinations-core.mjs';
import {
  ReleaseContentError,
  SUBJECT_MATTER_CSV_URL,
  SUBJECT_MATTER_SHEET_RANGE,
  SUBJECT_MATTER_SPREADSHEET_ID,
  WEBSITE_UPLOAD_CSV_URL,
  buildBarFeelsManifest,
  buildSubjectMatterPlacements,
  parseSubjectMatterSource,
  parseWebsiteUploadSource,
  sheetValuesToCsv,
  subjectMatterReleaseSnapshotCsv,
} from './release-content-core.mjs';
import {
  DD2026ValidationError,
  dd2026DatabaseError,
} from './duediligence-2026-core.mjs';
import { createDD2026Handlers } from './duediligence-2026-routes.mjs';
import {
  googleAccessToken,
  processExamRoomDeliveryQueues,
  verifyResendWebhookRequest,
} from './exam-room-delivery.mjs';
import embeddedWebsiteQuestionBank from '../content/question-bank/website-upload.json' with { type: 'json' };

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_CORRECTIONS_PER_WINDOW = 5;
const MAX_SUPPORT_REQUESTS_PER_WINDOW = 4;
const DUPLICATE_TTL_MS = 20 * 1000;
const GEMINI_TIMEOUT_MS = 45 * 1000;
const GEMINI_TRANSIENT_ATTEMPTS = 2;
const GEMINI_RETRY_DELAY_MS = 750;
const rateWindows = new Map();
const correctionRateWindows = new Map();
const supportRateWindows = new Map();
const analyticsRateWindows = new Map();
const adminRateWindows = new Map();
const guestStatusRateWindows = new Map();
const paymentRateWindows = new Map();
const partnershipRateWindows = new Map();
const forumReadRateWindows = new Map();
const forumWriteRateWindows = new Map();
const examinationReadRateWindows = new Map();
const examinationWriteRateWindows = new Map();
const dd2026ReadRateWindows = new Map();
const dd2026WriteRateWindows = new Map();
const examRoomReadRateWindows = new Map();
const examRoomWriteRateWindows = new Map();
const examRoomSyncRateWindows = new Map();
const examRoomUploadRateWindows = new Map();
const recentSubmissions = new Map();
const recentSignInNotificationSessions = new Map();
const authenticatedUserCache = new WeakMap();
let laborBankCache = null;
let websiteBankCache = null;

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'Authorization',
      'X-Guest-Device-ID',
      'X-Request-ID',
      'X-DD-Session-ID',
      'X-DD-Visitor-ID',
      'X-DD-Event-Key',
      'X-DD-Page-Area',
      'X-DD-Beta-Access',
      'X-DD-Beta-Flow-ID',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function assertOrigin(request, allowedOrigin) {
  const origin = request.headers.get('Origin') || '';
  if (!allowedOrigin || origin !== allowedOrigin) {
    throw new ExaminerError('ORIGIN_NOT_ALLOWED', 'This grading origin is not allowed.', 403);
  }
  return origin;
}

async function transientRateKey(request, env, scope) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unavailable';
  return hmacHex(env.GUEST_USAGE_HMAC_KEY || 'local-transient-rate-key', `${scope}\0${ip}`);
}

function enforceWindow(rateMap, key, maximum, message) {
  const now = Date.now();
  const current = rateMap.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rateMap.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > maximum) {
    throw new ExaminerError('RATE_LIMITED', message, 429);
  }
}

async function enforceRateLimit(request, env) {
  enforceWindow(
    rateWindows,
    await transientRateKey(request, env, 'grade'),
    MAX_REQUESTS_PER_WINDOW,
    'Too many grading requests. Please wait a few minutes and try again.',
  );
}

async function enforceCorrectionRateLimit(request, env) {
  enforceWindow(
    correctionRateWindows,
    await transientRateKey(request, env, 'correction'),
    MAX_CORRECTIONS_PER_WINDOW,
    'Too many correction submissions. Please wait a few minutes and try again.',
  );
}

async function enforceSupportRateLimit(request, env) {
  enforceWindow(
    supportRateWindows,
    await transientRateKey(request, env, 'support'),
    MAX_SUPPORT_REQUESTS_PER_WINDOW,
    'Too many support requests. Please wait a few minutes and try again.',
  );
}

async function enforceAnalyticsRateLimit(request, env) {
  enforceWindow(
    analyticsRateWindows,
    await transientRateKey(request, env, 'analytics'),
    60,
    'Too many analytics events.',
  );
}

async function enforceAdminRateLimit(request, env) {
  enforceWindow(
    adminRateWindows,
    await transientRateKey(request, env, 'admin'),
    90,
    'Too many administrator requests. Please wait and try again.',
  );
}

async function enforceForumRateLimit(request, env, mutation = false) {
  enforceWindow(
    mutation ? forumWriteRateWindows : forumReadRateWindows,
    await transientRateKey(request, env, mutation ? 'forum-write' : 'forum-read'),
    mutation ? 90 : 180,
    mutation
      ? 'Too many forum actions. Please wait and try again.'
      : 'Too many forum requests. Please wait and try again.',
  );
}

async function enforceExaminationRateLimit(request, env, mutation = false) {
  enforceWindow(
    mutation ? examinationWriteRateWindows : examinationReadRateWindows,
    await transientRateKey(request, env, mutation ? 'examination-write' : 'examination-read'),
    mutation ? 180 : 240,
    mutation
      ? 'Too many examination actions. Wait briefly and try again.'
      : 'Too many examination requests. Wait briefly and try again.',
  );
}

async function enforceDD2026RateLimit(request, env, mutation = false) {
  enforceWindow(
    mutation ? dd2026WriteRateWindows : dd2026ReadRateWindows,
    await transientRateKey(request, env, mutation ? 'dd2026-write' : 'dd2026-read'),
    mutation ? 90 : 180,
    mutation
      ? 'Too many study actions. Wait briefly and try again.'
      : 'Too many study requests. Wait briefly and try again.',
  );
}

async function enforceExamRoomRateLimit(request, env, userId, mode = 'read', resource = '') {
  const policies = {
    read: [examRoomReadRateWindows, 600, 480],
    write: [examRoomWriteRateWindows, 300, 240],
    sync: [examRoomSyncRateWindows, 1_200, 1_000],
    upload: [examRoomUploadRateWindows, 30, 20],
  };
  const [windows, maximum, resourceMaximum] = policies[mode] || policies.write;
  const actor = String(userId || 'anonymous');
  const message = mode === 'sync'
    ? 'Answer synchronization is temporarily busy. Your device copy is preserved; retry shortly.'
    : 'Too many Examination Room requests. Wait briefly and try again.';
  enforceWindow(
    windows,
    await transientRateKey(request, env, `exam-room-${mode}-${actor}`),
    maximum,
    message,
  );
  if (resource) {
    enforceWindow(
      windows,
      await transientRateKey(request, env, `exam-room-${mode}-${actor}-${String(resource)}`),
      resourceMaximum,
      message,
    );
  }
}

async function submissionFingerprint(requestData, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const encoded = new TextEncoder().encode(`${ip}\n${requestData.questionId}\n${requestData.studentAnswer}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function registerSubmission(requestData, request) {
  const now = Date.now();
  const fingerprint = await submissionFingerprint(requestData, request);
  const previous = recentSubmissions.get(fingerprint);
  if (previous && now - previous < DUPLICATE_TTL_MS) {
    throw new ExaminerError('DUPLICATE_SUBMISSION', 'This answer is already being checked. Please wait for the result.', 409);
  }
  recentSubmissions.set(fingerprint, now);
  if (recentSubmissions.size > 500) {
    for (const [key, timestamp] of recentSubmissions) {
      if (now - timestamp > DUPLICATE_TTL_MS) recentSubmissions.delete(key);
    }
  }
  return fingerprint;
}

function configuredSupabaseUrl(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new GuestAccessError(
      'GUEST_ACCESS_NOT_CONFIGURED',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new GuestAccessError(
      'GUEST_ACCESS_NOT_CONFIGURED',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  if (url.protocol !== 'https:') {
    throw new GuestAccessError(
      'GUEST_ACCESS_NOT_CONFIGURED',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  return url;
}

function normalizedRuntimeSecrets(env) {
  const serviceRoleKey = typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
    : env?.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey === env?.SUPABASE_SERVICE_ROLE_KEY) return env;
  return { ...env, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
}

async function supabaseRpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error('Guest quota storage request failed', {
      operation: functionName,
      status: response.status,
    });
    throw new GuestAccessError(
      'GUEST_ACCESS_UNAVAILABLE',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  return response.json().catch(() => null);
}

async function enforceGuestStatusRateLimit(request, env) {
  enforceWindow(
    guestStatusRateWindows,
    await transientRateKey(request, env, 'guest-status'),
    60,
    'Too many guest access checks. Please wait a few minutes and try again.',
  );
}

async function supabaseGuestRows(env, tableName, query) {
  const allowedTables = new Set(['guest_grading_devices', 'guest_grading_usage']);
  if (!allowedTables.has(tableName)) {
    throw new GuestAccessError(
      'GUEST_ACCESS_UNAVAILABLE',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  const baseUrl = configuredSupabaseUrl(env);
  const url = new URL(`/rest/v1/${tableName}`, baseUrl);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result)) {
    console.error('Guest quota status request failed', {
      operation: `select_${tableName}`,
      status: response.status,
    });
    throw new GuestAccessError(
      'GUEST_ACCESS_UNAVAILABLE',
      'Guest grading is temporarily unavailable.',
      503,
    );
  }
  return result;
}

async function protectedSupabaseRpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const denied = response.status === 401
      || response.status === 403
      || /authorization|capability|required|not allowed/i.test(String(result?.message || ''));
    console.error('Protected storage request failed', {
      operation: functionName,
      status: response.status,
      denied,
    });
    throw new ExaminerError(
      denied ? 'ADMIN_FORBIDDEN' : 'ADMIN_DATA_UNAVAILABLE',
      denied
        ? 'You are not authorized for this administrator operation.'
        : 'Administrator data is temporarily unavailable.',
      denied ? 403 : 503,
    );
  }
  return result;
}

async function forumRpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Quorum storage request failed', {
      operation: functionName,
      status: response.status,
      code: String(result?.code || 'unknown').slice(0, 32),
    });
    throw forumDatabaseError([
      result?.message,
      result?.details,
      result?.hint,
    ].filter(Boolean).join(' '));
  }
  return result;
}

async function examinationRpc(env, functionName, body) {
  const allowedFunctions = new Set([
    'examination_query',
    'examination_command',
    'examination_admin',
    'examination_register_upload',
    'examination_store_ai_assessment',
    'examination_fail_ai_job',
    'examination_record_delivery',
    'examination_authorize_access',
    'subject_matter_catalog',
    'subject_matter_next_question',
    'subject_matter_performance',
    'release_sync_subject_matter',
    'release_sync_bar_feels',
    'release_sync_all_content',
    'release_sync_subject_matter_v2',
    'release_sync_all_content_v2',
    'release_stage_subject_matter_v2',
    'release_finalize_all_content_v2',
  ]);
  if (!allowedFunctions.has(functionName)) {
    throw new ExaminationValidationError(
      'UNSUPPORTED_OPERATION',
      'This examination operation is not supported.',
    );
  }
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Examination storage request failed', {
      operation: functionName,
      status: response.status,
      code: String(result?.code || 'unknown').slice(0, 32),
    });
    const mapped = examinationDatabaseError({
      message: [result?.message, result?.details, result?.hint].filter(Boolean).join(' '),
    });
    if (mapped instanceof ExaminationValidationError) throw mapped;
    throw new ExaminationValidationError(
      'EXAMINATION_UNAVAILABLE',
      'The examination service is temporarily unavailable. Your saved work is preserved.',
      503,
    );
  }
  return result;
}

async function dd2026Rpc(env, functionName, body) {
  const allowedFunctions = new Set([
    'dd2026_feature_snapshot',
    'dd2026_import_content_batch',
    'dd2026_editorial_transition',
    'dd2026_content_list',
    'dd2026_content_get',
    'dd2026_record_bar_easy_completion',
    'dd2026_record_doctrine_mastery',
    'dd2026_verdict_result',
    'dd2026_record_verdict_export',
    'dd2026_service_flag_enabled',
  ]);
  if (!allowedFunctions.has(functionName)) {
    throw new DD2026ValidationError('UNSUPPORTED_OPERATION', 'This study operation is not supported.');
  }
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('DueDiligence 2026 storage request failed', {
      operation: functionName,
      status: response.status,
      code: String(result?.code || 'unknown').slice(0, 32),
    });
    const mapped = dd2026DatabaseError({
      message: [result?.message, result?.details, result?.hint].filter(Boolean).join(' '),
    });
    if (mapped instanceof DD2026ValidationError) throw mapped;
    throw new DD2026ValidationError(
      'STUDY_SERVICE_UNAVAILABLE',
      'The study service is temporarily unavailable.',
      503,
    );
  }
  return result;
}

export function examRoom2026DatabaseError(error) {
  const message = String(error?.message || '');
  const publicErrors = {
    EXAM_ROOM_AUTH_REQUIRED: [403, 'Sign in with the account authorized for this examination.'],
    EXAM_ROOM_ACTIVATION_INVALID: [400, 'Provide a valid Professor email, room details, reason, and expiry of no more than seven days.'],
    EXAM_ROOM_CREDENTIAL_INPUT_INVALID: [400, 'The Professor key is invalid. Check the complete key and try again.'],
    EXAM_ROOM_ROOM_KEY_REQUIRED: [403, 'Ask Due Diligence Admin for a one-time Professor key. Each key opens one Examination Room.'],
    EXAM_ROOM_ACTIVATION_LEDGER_INVALID: [400, 'Choose a valid Professor invitation status, a list limit from 1 to 200, and a valid starting point.'],
    EXAM_ROOM_ACTIVATION_REVOKE_INVALID: [400, 'Choose a Professor invitation and give a documented reason for revoking it.'],
    EXAM_ROOM_ACTIVATION_NOT_REVOCABLE: [409, 'This Professor invitation does not exist or can no longer be revoked.'],
    EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT: [409, 'This Professor key cannot be bound to another Examination Room. Ask Admin for a new key.'],
    EXAM_ROOM_ONE_EXAM_LIMIT: [409, 'This Examination Room already has its examination. Ask Admin for another room key to make another examination.'],
    EXAM_ROOM_OPERATOR_REQUIRED: [403, 'Professor or active Beadle authorization is required.'],
    EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED: [403, 'Your active Beadle assignment is no longer available. Return to assigned examinations and refresh the room.'],
    EXAM_ROOM_ROSTER_REQUIRED: [403, 'This account is not authorized for the examination.'],
    EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED: [400, 'Use the official Beadle class-list template. Do not add, remove, or rename columns.'],
    EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID: [403, 'The class-list template confirmation does not belong to this examination. Upload the official template again.'],
    EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED: [409, 'The class-list template confirmation expired. Upload the completed official template again.'],
    EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED: [409, 'This class-list template confirmation was already used. Upload the completed official template again before saving another class list.'],
    EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH: [409, 'The class list changed after it was checked. Upload the completed official template again before saving.'],
    EXAM_ROOM_MODEL_ANSWER_UPLOAD_NOT_ALLOWED: [403, 'The model-answer source cannot be changed in this examination state.'],
    EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE: [400, 'Uploaded model answers are unavailable until audited owner-only retrieval is enabled. Use pasted text or no model answer.'],
    EXAM_ROOM_EXAM_NOT_FOUND: [404, 'The examination could not be found.'],
    EXAM_ROOM_PAST_EXAM_ACCESS_REQUIRED: [403, 'Only the owning Professor, assigned Beadle, or participating student may remove this examination from their own Past Exams view.'],
    EXAM_ROOM_PAST_EXAM_REQUIRED: [409, 'Only a completed examination can be removed from Past Exams. Active and upcoming examinations must remain visible.'],
    EXAM_ROOM_ATTEMPT_NOT_FOUND: [404, 'The examination attempt could not be found.'],
    EXAM_ROOM_QUESTION_NOT_FOUND: [404, 'The examination question could not be found.'],
    EXAM_ROOM_SESSION_NOT_FOUND: [409, 'This examination session is no longer available. Request a controlled session recovery.'],
    EXAM_ROOM_ACTIVE_SESSION_NOT_FOUND: [409, 'No active examination session is available to transfer.'],
    EXAM_ROOM_BEADLE_ASSIGNMENT_NOT_FOUND: [404, 'The active Beadle assignment could not be found.'],
    EXAM_ROOM_MODEL_ANSWER_OBJECT_NOT_FOUND: [404, 'The private model-answer source could not be found.'],
    EXAM_ROOM_MODEL_ANSWER_SOURCE_NOT_FOUND: [409, 'The published model-answer source is unavailable. Review the examination publication record.'],
    EXAM_ROOM_SESSION_STALE: [409, 'This session has been replaced. Continue only in the active examination session.'],
    EXAM_ROOM_SESSION_EPOCH_CONFLICT: [409, 'The examination session changed. Refresh the session state before continuing.'],
    EXAM_ROOM_OPERATION_ID_REUSED: [409, 'This save identifier was already used for different content.'],
    EXAM_ROOM_LOCAL_SEQUENCE_REUSED: [409, 'A newer local save sequence already exists. Reconcile before retrying.'],
    EXAM_ROOM_REQUEST_KEY_REUSED: [409, 'This request identifier was already used for different content.'],
    EXAM_ROOM_ALREADY_PUBLISHED: [409, 'This examination version is already published.'],
    EXAM_ROOM_EXAM_NOT_PUBLISHABLE: [409, 'Complete and confirm the examination questions before publishing for class preparation.'],
    EXAM_ROOM_HANDOFF_TIME_REQUIRED: [409, 'Choose a valid examination opening time and try again.'],
    EXAM_ROOM_OPEN_NOW_REASON_REQUIRED: [400, 'Briefly explain why the examination should open now.'],
    EXAM_ROOM_OPEN_NOW_NOT_ALLOWED: [409, 'This examination cannot be opened now. Confirm that it is published, scheduled, and has not closed.'],
    EXAM_ROOM_BEADLE_REQUIRED: [403, 'Redeem the Beadle invitation with the invited account before preparing student access.'],
    EXAM_ROOM_ROSTER_FINALIZATION_INVALID: [400, 'Review the class list. Every row needs a valid student name and email, without duplicates.'],
    EXAM_ROOM_ROSTER_IDENTIFIER_ALREADY_ASSIGNED: [409, 'A student email or identifier is already assigned in this class. Correct the duplicate and try again.'],
    EXAM_ROOM_STUDENT_ACCESS_NOT_ISSUABLE: [409, 'Student access can be prepared only after publication and roster upload, before the examination opens and before any attempt starts.'],
    EXAM_ROOM_STUDENT_ACCESS_ROSTER_REQUIRED: [409, 'Upload and save at least one eligible student before preparing student access.'],
    EXAM_ROOM_STUDENT_ACCESS_POLICY_MISMATCH: [409, 'This publication is not configured for the required Beadle-issued student access code.'],
    EXAM_ROOM_STUDENT_ACCESS_SUPERSEDED: [409, 'This student access code has been replaced. Refresh the Beadle page to view the active class code.'],
    EXAM_ROOM_CREDENTIAL_REUSE_FORBIDDEN: [409, 'Use a new student access code that has never been used as another Examination Room key.'],
    EXAM_ROOM_ATTEMPT_CLOSED: [409, 'This examination attempt is closed.'],
    EXAM_ROOM_EXAM_NOT_SCHEDULED: [409, 'Schedule the examination before publishing it.'],
    EXAM_ROOM_PUBLICATION_PRECONDITION_FAILED: [409, 'The examination is not ready to publish. Review its questions, schedule, and access credentials.'],
    EXAM_ROOM_STUDENT_ACCESS_CODE_MISMATCH: [409, 'The student access code does not match the scheduled examination credential. Re-enter the current code.'],
    EXAM_ROOM_STUDENT_CODE_INVALID: [403, 'The examination code or signed-in account could not be authorized. Check the code and account, then try again.'],
    STUDENT_CODE_LOCKED: [429, 'Too many unsuccessful code attempts. Wait until the displayed time before trying again.'],
    EXAM_ROOM_STUDENT_ACCESS_CODE_UNEXPECTED: [400, 'Remove the student access code when publishing a roster-only examination.'],
    EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE: [400, 'One-way navigation is unavailable until durable server-side progress enforcement is enabled. Choose free navigation.'],
    EXAM_ROOM_QUESTION_COUNT_MISMATCH: [409, 'The reviewed question count does not match the examination configuration.'],
    EXAM_ROOM_WORKSPACE_CONFLICT: [409, 'The examination workspace changed in another tab. Refresh it before saving again.'],
    EXAM_ROOM_RESCHEDULE_NOT_ALLOWED: [409, 'This exam time can be changed only before any student starts and before results are sent.'],
    EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST: [409, 'A student has already started, so the published exam time can no longer be changed.'],
    EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON: [409, 'Choose an exam ending within the current Beadle assignment period, or assign a new Beadle before setting this later schedule.'],
    EXAM_ROOM_RESCHEDULE_INVALID: [400, 'Choose a valid opening, an ending after it, valid minute limits, and a short reason.'],
    EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID: [409, 'The published examination is missing its protected class-access policy. Refresh before changing the schedule.'],
    EXAM_ROOM_AUTHORING_LOCKED: [409, 'This examination is already published or has a student attempt. Review the saved version or use the controlled correction process.'],
    EXAM_ROOM_QUESTION_VERSION_CONFLICT: [409, 'The reviewed questions changed in another tab. Refresh the question review before saving.'],
    EXAM_ROOM_ROSTER_REOPEN_NOT_ALLOWED: [409, 'The class list can be reopened only before the examination opens and before any student attempt starts.'],
    EXAM_ROOM_FINAL_GRADES_REQUIRED: [409, 'Finalize every question grade for this candidate before downloading or sending results.'],
    EXAM_ROOM_GRADING_NOT_OPEN: [409, 'Only a final submitted examination can be graded.'],
    EXAM_ROOM_GRADE_INVALID: [400, 'Enter a valid score, grading state, comment, and reason for the change.'],
    EXAM_ROOM_SCORE_INVALID: [400, 'Enter a score within this question\'s allowed points.'],
    EXAM_ROOM_SUBMISSION_NOT_FOUND: [409, 'The final submitted examination could not be confirmed. Refresh and try again.'],
    EXAM_ROOM_SUBMISSION_REQUIRED: [409, 'A committed candidate submission is required before preparing this result.'],
    EXAM_ROOM_RESULT_EXPORT_NOT_READY: [409, 'This candidate result is not ready to download.'],
    EXAM_ROOM_RESULT_EXPORT_NOT_FOUND: [404, 'The requested candidate result download could not be found.'],
    EXAM_ROOM_RESULT_EXPORT_CHANGED: [409, 'This result changed while the download was being prepared. Start a new download.'],
    EXAM_ROOM_BEADLE_INVITATION_NOT_ACTIVE: [409, 'This Beadle invitation is expired, revoked, used, or belongs to another account.'],
    EXAM_ROOM_BEADLE_DELEGATION_CLOSED: [409, 'Beadle delegation is closed for this examination state.'],
    EXAM_ROOM_MODEL_ANSWER_SOURCE_NOT_REGISTERED: [409, 'Register the private model-answer source before publication.'],
    EXAM_ROOM_SESSION_TRANSFER_SAME_DEVICE: [409, 'Session transfer requires a different verified device.'],
    EXAM_ROOM_RECENT_VERIFICATION_REQUIRED: [409, 'Record a fresh physical or institutional identity verification before transferring this examination session.'],
    EXAM_ROOM_ACTIVE_LEAVE_NOT_FOUND: [409, 'No active temporary leave is available to close.'],
    EXAM_ROOM_LEAVE_NOT_FOUND: [404, 'The temporary-leave record could not be found.'],
    EXAM_ROOM_ROSTER_LOCKED: [409, 'This roster is locked because the examination, an attempt, or another class examination is already live.'],
    EXAM_ROOM_ERRATUM_NOT_ALLOWED: [409, 'An erratum cannot be issued in this examination state.'],
    EXAM_ROOM_EXAM_NOT_SCHEDULABLE: [409, 'This examination cannot be scheduled or rotated in its current state.'],
    EXAM_ROOM_IMMUTABLE_EVIDENCE: [409, 'Immutable examination evidence cannot be changed.'],
    EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT: [409, 'This submission request identifier was already used for a different answer set.'],
    EXAM_ROOM_V2_SESSION_REQUIRED: [409, 'This examination requires the active device-bound session. Refresh and reopen the examination session.'],
    EXAM_ROOM_PUBLICATION_REQUIRED: [409, 'Publish an immutable examination version before using this operation.'],
    EXAM_ROOM_REPLACEMENT_NOT_ALLOWED: [409, 'A replacement publication is allowed only before the examination opens.'],
    EXAM_ROOM_REPLACEMENT_ATTEMPTS_EXIST: [409, 'This publication cannot be replaced because a candidate attempt already exists.'],
    EXAM_ROOM_PUBLICATION_VERSION_CONFLICT: [409, 'The published examination changed. Refresh before replacing it.'],
    EXAM_ROOM_REPLACEMENT_CREDENTIAL_INVALID: [400, 'Provide new replacement credentials that match the access-code policy.'],
    EXAM_ROOM_REPLACEMENT_QUESTION_SOURCE_INVALID: [400, 'The replacement question source is invalid or no longer matches the reviewed upload.'],
    EXAM_ROOM_REPLACEMENT_QUESTION_VERSION_INVALID: [409, 'Stage and confirm a new question version against the current publication before replacing it.'],
    EXAM_ROOM_REPLACEMENT_LINEAGE_INVALID: [409, 'The replacement publication lineage could not be verified. Refresh and try again.'],
    EXAM_ROOM_REPLACEMENT_CONTEXT_REQUIRED: [409, 'The replacement publication context could not be verified. Refresh and try again.'],
    EXAM_ROOM_REOPEN_NOT_ALLOWED: [409, 'This submission cannot be reopened in its current examination or grading state.'],
    EXAM_ROOM_REOPEN_REQUEST_INVALID: [400, 'Choose a reopening deadline in the next four hours and provide a documented reason.'],
    EXAM_ROOM_REOPEN_AUTHORITY_INVALID: [403, 'Use either the Professor grading key or an active candidate-scoped Admin review grant.'],
    EXAM_ROOM_REOPEN_AUTHORIZATION_REQUIRED: [403, 'This submission generation has not been authorized for reopening.'],
    EXAM_ROOM_REOPEN_GRADING_ALREADY_STARTED: [409, 'This submission cannot be reopened after grading has started.'],
    EXAM_ROOM_REOPEN_ACTIVE_SESSION_INVALID: [409, 'Close the active candidate session before reopening this submission.'],
    EXAM_ROOM_REOPEN_PRIOR_SUBMISSION_REQUIRED: [409, 'The original immutable submission is unavailable, so reopening is blocked.'],
    EXAM_ROOM_REOPEN_PRIOR_RECEIPT_REQUIRED: [409, 'The original submission receipt is unavailable, so reopening is blocked.'],
    EXAM_ROOM_REOPENING_ALREADY_ACTIVE: [409, 'A bounded reopening is already active for this candidate.'],
    EXAM_ROOM_REOPENING_ATTEMPT_STATE_INVALID: [409, 'The candidate attempt is not in the authorized reopened-generation state.'],
    EXAM_ROOM_ADMIN_REQUIRED: [403, 'Global Administrator authorization is required for candidate-scoped review.'],
    EXAM_ROOM_FRESH_AAL2_REQUIRED: [403, 'Complete a fresh multi-factor challenge before using candidate-scoped Admin review.'],
    EXAM_ROOM_BREAK_GLASS_NOT_FOUND: [404, 'The candidate-scoped Admin review grant could not be found.'],
    EXAM_ROOM_BREAK_GLASS_REQUEST_INVALID: [400, 'Provide an exact candidate scope, case reference, reason, and expiry of no more than four hours.'],
    EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID: [403, 'The requested examination, attempt, or candidate does not match this review grant.'],
    EXAM_ROOM_BREAK_GLASS_SCOPE_OR_EXPIRY_INVALID: [409, 'This candidate-scoped review grant is expired, closed, or no longer valid for the attempt state.'],
    EXAM_ROOM_BREAK_GLASS_TERMINAL_EVIDENCE_REQUIRED: [409, 'Candidate evidence is available only after the submission is terminal and its grace period has passed.'],
    EXAM_ROOM_BREAK_GLASS_ALREADY_ACTIVE: [409, 'An active candidate-scoped review grant already exists for this case.'],
    EXAM_ROOM_BREAK_GLASS_ALREADY_CLOSED: [409, 'This candidate-scoped Admin review grant is already closed.'],
    EXAM_ROOM_BREAK_GLASS_CLOSE_INVALID: [400, 'Provide a documented reason for closing this candidate-scoped review grant.'],
    EXAM_ROOM_BREAK_GLASS_CLOSE_REQUIRED: [409, 'Close the candidate-scoped grant before recording the required post-review outcome.'],
    EXAM_ROOM_BREAK_GLASS_REVIEW_INVALID: [400, 'Provide a valid post-review outcome and review notes.'],
    EXAM_ROOM_BREAK_GLASS_REVIEW_ALREADY_RECORDED: [409, 'The required post-review outcome was already recorded.'],
    EXAM_ROOM_CONFIRM_QUESTIONS_DEFINITION_DRIFT: [503, 'Question confirmation is temporarily unavailable because the database contract is out of date.'],
  };
  const knownInvalid = [
    'EXAM_ROOM_ACCOMMODATION_INVALID', 'EXAM_ROOM_ACCOMMODATION_UNKNOWN',
    'EXAM_ROOM_ACCOMMODATION_WINDOW_INVALID', 'EXAM_ROOM_ADMISSION_INVALID',
    'EXAM_ROOM_ANSWER_HASH_MISMATCH', 'EXAM_ROOM_ANSWER_OPERATION_INVALID',
    'EXAM_ROOM_ANSWER_TOO_LONG', 'EXAM_ROOM_REVISION_INVALID',
    'EXAM_ROOM_AUDIT_EVENT_INVALID', 'EXAM_ROOM_BEADLE_INVITATION_INVALID',
    'EXAM_ROOM_CLIENT_TIMESTAMP_INVALID', 'EXAM_ROOM_DEVICE_HASH_INVALID',
    'EXAM_ROOM_INTEGRITY_EVENT_INVALID', 'EXAM_ROOM_MODEL_ANSWER_INVALID',
    'EXAM_ROOM_MODEL_ANSWER_SOURCE_INVALID', 'EXAM_ROOM_REASON_REQUIRED',
    'EXAM_ROOM_REQUEST_INVALID', 'EXAM_ROOM_REQUEST_KEY_INVALID', 'EXAM_ROOM_RESPONSE_INVALID',
    'EXAM_ROOM_ROSTER_REQUEST_INVALID', 'EXAM_ROOM_SCHEDULE_INVALID',
    'EXAM_ROOM_SUBMISSION_REQUEST_INVALID', 'EXAM_ROOM_ERRATUM_INVALID',
    'EXAM_ROOM_ERRATUM_QUESTION_INVALID', 'EXAM_ROOM_LEAVE_ACTION_INVALID',
    'EXAM_ROOM_LEAVE_REASON_INVALID',
    'EXAM_ROOM_RULE_UNKNOWN', 'EXAM_ROOM_RULES_INVALID',
    'EXAM_ROOM_SESSION_TRANSFER_INVALID', 'EXAM_ROOM_TECHNICAL_INCIDENT_INVALID',
    'EXAM_ROOM_VERIFICATION_INVALID',
    'EXAM_ROOM_CLASS_HANDOFF_INVALID', 'EXAM_ROOM_STUDENT_ACCESS_INVALID',
    'EXAM_ROOM_STUDENT_CODE_ENVELOPE_INVALID', 'EXAM_ROOM_WAITING_ROOM_INVALID',
    'EXAM_ROOM_RESULT_EXPORT_INVALID',
  ];
  for (const code of knownInvalid) {
    if (message.includes(code)) {
      return new DD2026ValidationError(
        code,
        'The Examination Room request is invalid. Review the highlighted fields and try again.',
        400,
      );
    }
  }
  for (const [code, [status, publicMessage]] of Object.entries(publicErrors)) {
    if (message.includes(code)) return new DD2026ValidationError(code, publicMessage, status);
  }
  return dd2026DatabaseError(error);
}

export const EXAM_ROOM_REQUEST_FLOW_RPC_FUNCTIONS = Object.freeze([
  'exam_room_request_snapshot',
  'exam_room_submit_request',
  'exam_room_claim_request',
  'exam_room_prepare_quotation',
  'exam_room_quotation_delivery_context',
  'exam_room_record_quotation_delivery',
  'exam_room_payment_proof_upload_context',
  'exam_room_register_payment_proof',
  'exam_room_payment_proof_review_context',
  'exam_room_review_payment_proof',
]);

export const EXAM_ROOM_2026_RPC_FUNCTIONS = Object.freeze([
    ...EXAM_ROOM_REQUEST_FLOW_RPC_FUNCTIONS,
    'exam_room_issue_professor_activation',
    'exam_room_redeem_professor_activation',
    'exam_room_admin_professor_activation_ledger',
    'exam_room_admin_revoke_professor_activation',
    'exam_room_validate_roster',
    'exam_room_import_roster',
    'exam_room_validate_exam_roster_v2',
    'exam_room_import_exam_roster_v2',
    'exam_room_register_roster_template_validation_v1',
    'exam_room_import_exam_roster_v3',
    'exam_room_upsert_roster_row_v2',
    'exam_room_create_exam',
    'exam_room_professor_authoring_snapshot_v1',
    'exam_room_professor_authoring_snapshot_v2',
    'exam_room_update_details_v1',
    'exam_room_revise_draft_questions_v1',
    'exam_room_save_rules_draft_v1',
    'exam_room_reopen_roster_v1',
    'exam_room_publish_for_beadle_v4',
    'exam_room_publish_for_beadle_and_email_v1',
    'exam_room_generate_provisional_key_and_email_v1',
    'exam_room_reschedule_publication_v1',
    'exam_room_confirm_questions',
    'exam_room_confirm_replacement_questions_v2',
    'exam_room_schedule_exam',
    'exam_room_exam_access_v2',
    'exam_room_exam_access_v3',
    'exam_room_beadle_portal_v2',
    'exam_room_beadle_portal_v3',
    'exam_room_beadle_portal_v4',
    'exam_room_beadle_portal_v5',
    'exam_room_student_preflight_v2',
    'exam_room_student_preflight_v3',
    'exam_room_student_waiting_room_v4',
    'exam_room_student_waiting_room_by_code_v1',
    'exam_room_beadle_student_waiting_room_v1',
    'exam_room_incident_summary_v2',
    'exam_room_issue_beadle_invitation_v2',
    'exam_room_redeem_beadle_invitation_v2',
    'exam_room_revoke_beadle_assignment_v2',
    'exam_room_publish_exam_v2',
    'exam_room_publish_for_beadle_v3',
    'exam_room_issue_student_access_v3',
    'exam_room_issue_student_access_v4',
    'exam_room_finalize_roster_access_v1',
    'exam_room_replace_publication_v2',
    'exam_room_admit_candidate_v2',
    'exam_room_set_accommodation_v2',
    'exam_room_start_attempt',
    'exam_room_start_attempt_v3',
    'exam_room_start_attempt_v4',
    'exam_room_start_attempt_by_code_v1',
    'exam_room_start_beadle_student_attempt_v1',
    'exam_room_open_exam_now_v1',
    'exam_room_open_session_v2',
    'exam_room_attempt_view',
    'exam_room_attempt_view_v2',
    'exam_room_submission_status_v2',
    'exam_room_grading_model_answer_v2',
    'exam_room_grading_model_answer_v3',
    'exam_room_save_answer',
    'exam_room_save_answer_operation_v2',
    'exam_room_heartbeat',
    'exam_room_heartbeat_v2',
    'exam_room_record_integrity_event',
    'exam_room_record_integrity_event_v2',
    'exam_room_submit_attempt',
    'exam_room_submit_attempt_generation_v2',
    'exam_room_submit_attempt_generation_v3',
    'exam_room_reopen_submission_generation_v2',
    'exam_room_transfer_session_v2',
    'exam_room_issue_erratum_v2',
    'exam_room_start_temporary_leave_v2',
    'exam_room_end_temporary_leave_v2',
    'exam_room_acknowledge_temporary_leave_v2',
    'exam_room_record_verification_v2',
    'exam_room_record_technical_incident_v2',
    'exam_room_issue_admin_break_glass_v2',
    'exam_room_admin_break_glass_evidence_v2',
    'exam_room_close_admin_break_glass_v2',
    'exam_room_record_admin_break_glass_review_v2',
    'exam_room_auto_submit_due',
    'exam_room_live_status',
    'exam_room_live_status_v2',
    'exam_room_grading_workspace',
    'exam_room_grading_workspace_v3',
    'exam_room_professor_results_dashboard_v1',
    'exam_room_result_delivery_report_v1',
    'exam_room_retry_student_result_email_v1',
    'exam_room_save_grade',
    'exam_room_save_grade_v3',
    'exam_room_unlock_attempt',
    'exam_room_release_results',
    'exam_room_prepare_result_export_v3',
    'exam_room_complete_result_export_v3',
    'exam_room_prepare_class_result_export_v1',
    'exam_room_complete_class_result_export_v1',
    'exam_room_student_result',
    'exam_room_claim_backup_batch',
    'exam_room_complete_backup',
    'exam_room_fail_backup',
    'exam_room_claim_email_batch',
    'exam_room_complete_email',
    'exam_room_fail_email',
    'exam_room_record_email_delivery_event_v1',
    'exam_room_portal_snapshot',
    'exam_room_dismissed_past_exam_ids_v1',
    'exam_room_dismiss_past_exam_v1',
    'exam_room_backup_context',
]);

async function examRoom2026Rpc(env, functionName, body) {
  const allowedFunctions = new Set(EXAM_ROOM_2026_RPC_FUNCTIONS);
  if (!allowedFunctions.has(functionName)) {
    throw new DD2026ValidationError('UNSUPPORTED_OPERATION', 'This Examination Room operation is not supported.');
  }
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Examination Room storage request failed', {
      operation: functionName,
      status: response.status,
      code: String(result?.code || 'unknown').slice(0, 32),
    });
    const mapped = examRoom2026DatabaseError({
      message: [result?.message, result?.details, result?.hint].filter(Boolean).join(' '),
    });
    if (mapped instanceof DD2026ValidationError) throw mapped;
    throw new DD2026ValidationError(
      'EXAM_ROOM_UNAVAILABLE',
      'The Examination Room is temporarily unavailable. Server-acknowledged work remains preserved.',
      503,
    );
  }
  return result;
}

async function handleResendEmailDeliveryWebhook(request, env) {
  if (request.method !== 'POST') {
    throw new ExaminerError('METHOD_NOT_ALLOWED', 'Only POST requests are accepted.', 405);
  }
  let event;
  try {
    event = await verifyResendWebhookRequest(request, env);
  } catch (error) {
    throw new ExaminerError(
      error?.safeCode === 'EMAIL_WEBHOOK_INVALID'
        ? 'EMAIL_WEBHOOK_INVALID'
        : 'EMAIL_WEBHOOK_UNAVAILABLE',
      'The email-delivery event could not be verified.',
      error?.safeCode === 'EMAIL_WEBHOOK_INVALID' ? 401 : 503,
    );
  }
  const result = await examRoom2026Rpc(env, 'exam_room_record_email_delivery_event_v1', {
    p_provider_id: event.providerId,
    p_provider_event_id: event.providerEventId,
    p_provider_event_type: event.providerEventType,
    p_provider_event_at: event.providerEventAt,
  });
  return new Response(JSON.stringify({ ok: true, matched: result?.matched === true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function quorumStorageObjectUrl(env, objectPath, suffix = '') {
  const baseUrl = configuredSupabaseUrl(env);
  const encodedPath = String(objectPath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return new URL(
    `/storage/v1/object${suffix}/quorum-images/${encodedPath}`,
    baseUrl,
  );
}

function quorumRandomHex(byteLength = 12) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadQuorumImage(env, entryId, image) {
  const objectPath = `entries/${entryId}/${quorumRandomHex(12)}.${image.extension}`;
  const response = await fetch(quorumStorageObjectUrl(env, objectPath), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': image.mimeType,
      'x-upsert': 'false',
      'Cache-Control': 'max-age=3600',
    },
    body: image.bytes,
  });
  if (!response.ok) {
    console.error('Quorum image upload failed', { status: response.status });
    throw new ForumValidationError(
      'QUORUM_IMAGE_UNAVAILABLE',
      'The image could not be stored. Your entry was not published.',
      502,
    );
  }
  return objectPath;
}

async function uploadQuorumAvatar(env, image) {
  const objectPath = `profiles/${quorumRandomHex(12)}.${image.extension}`;
  const response = await fetch(quorumStorageObjectUrl(env, objectPath), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': image.mimeType,
      'x-upsert': 'false',
      'Cache-Control': 'private, max-age=3600',
    },
    body: image.bytes,
  });
  if (!response.ok) {
    console.error('Quorum profile photo upload failed', { status: response.status });
    throw new ForumValidationError(
      'QUORUM_IMAGE_UNAVAILABLE',
      'Your profile photo could not be stored. Please try again.',
      502,
    );
  }
  return objectPath;
}

async function deleteQuorumImage(env, objectPath) {
  if (!objectPath) return true;
  const response = await fetch(quorumStorageObjectUrl(env, objectPath), {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    console.error('Quorum image cleanup failed', { status: response.status });
    return false;
  }
  return true;
}

function collectQuorumImagePaths(value, paths = new Set()) {
  if (!value || typeof value !== 'object') return paths;
  if (Array.isArray(value)) {
    value.forEach((item) => collectQuorumImagePaths(item, paths));
    return paths;
  }
  if (typeof value.imagePath === 'string' && value.imagePath) paths.add(value.imagePath);
  if (typeof value.avatarPath === 'string' && value.avatarPath) paths.add(value.avatarPath);
  Object.values(value).forEach((item) => collectQuorumImagePaths(item, paths));
  return paths;
}

function absoluteSupabaseStorageUrl(baseUrl, signedPath) {
  const base = new URL(baseUrl);
  const signed = new URL(String(signedPath || ''), base);
  if (signed.origin === base.origin && signed.pathname.startsWith('/object/')) {
    signed.pathname = `/storage/v1${signed.pathname}`;
  }
  return signed.href;
}

async function signedQuorumImageUrls(env, paths) {
  const uniquePaths = Array.from(paths);
  if (!uniquePaths.length) return new Map();
  const baseUrl = configuredSupabaseUrl(env);
  const batchResponse = await fetch(
    new URL('/storage/v1/object/sign/quorum-images', baseUrl),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 900, paths: uniquePaths }),
    },
  );
  const map = new Map();
  if (batchResponse.ok) {
    const signed = await batchResponse.json().catch(() => []);
    const rows = Array.isArray(signed) ? signed : signed?.data || [];
    rows.forEach((row, index) => {
      const path = row?.path || uniquePaths[index];
      const signedPath = row?.signedURL || row?.signedUrl || row?.signed_url;
      if (!path || !signedPath) return;
      map.set(
        path,
        absoluteSupabaseStorageUrl(baseUrl, signedPath),
      );
    });
  }
  if (map.size === uniquePaths.length) return map;

  for (const path of uniquePaths) {
    if (map.has(path)) continue;
    const response = await fetch(quorumStorageObjectUrl(env, path, '/sign'), {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 900 }),
    });
    if (!response.ok) {
      console.error('Quorum image signing failed', { status: response.status });
      continue;
    }
    const row = await response.json().catch(() => null);
    const signedPath = row?.signedURL || row?.signedUrl || row?.signed_url;
    if (signedPath) {
      map.set(
        path,
        absoluteSupabaseStorageUrl(baseUrl, signedPath),
      );
    }
  }
  return map;
}

function replaceQuorumImagePaths(value, signedUrls) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => replaceQuorumImagePaths(item, signedUrls));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'imagePath' || key === 'avatarPath') {
      result[key === 'imagePath' ? 'imageUrl' : 'avatarUrl'] = item
        ? signedUrls.get(item) || null
        : null;
      continue;
    }
    result[key] = replaceQuorumImagePaths(item, signedUrls);
  }
  return result;
}

async function withSignedQuorumImages(value, env) {
  const paths = collectQuorumImagePaths(value);
  const urls = await signedQuorumImageUrls(env, paths);
  return replaceQuorumImagePaths(value, urls);
}

async function enforcePaymentRateLimit(request, env) {
  enforceWindow(
    paymentRateWindows,
    await transientRateKey(request, env, 'payment'),
    8,
    'Too many payment requests. Please wait and try again.',
  );
}

async function enforcePartnershipRateLimit(request, env) {
  enforceWindow(
    partnershipRateWindows,
    await transientRateKey(request, env, 'partnership'),
    4,
    'Too many partnership requests. Please wait and try again.',
  );
}

async function phase4Rpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Phase 4 storage request failed', {
      operation: functionName,
      status: response.status,
    });
    throw new ExaminerError(
      'ACCESS_UNAVAILABLE',
      'Your access status is temporarily unavailable.',
      503,
    );
  }
  return result;
}

async function commerceRpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (response.ok) return result;
  const databaseMessage = String(result?.message || '');
  console.error('Commerce storage request failed', {
    operation: functionName,
    status: response.status,
  });
  if (/already been submitted|already exists|request key already used/i.test(databaseMessage)) {
    throw new PaymentValidationError(
      'DUPLICATE_PAYMENT',
      'This payment or refund request has already been submitted.',
      409,
    );
  }
  if (/not available|must match|unsupported|outside the accepted|reason must|valid request/i.test(databaseMessage)) {
    throw new PaymentValidationError(
      'INVALID_COMMERCE_REQUEST',
      'The request did not pass secure validation. Review the details and try again.',
      400,
    );
  }
  throw new PaymentValidationError(
    'COMMERCE_UNAVAILABLE',
    'Secure payment services are temporarily unavailable. No access change was made.',
    503,
  );
}

function encodedStoragePath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function uploadPrivateProof(env, objectPath, bytes, mimeType) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(
    new URL(`/storage/v1/object/payment-proofs/${encodedStoragePath(objectPath)}`, baseUrl),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    console.error('Private payment proof upload failed', { status: response.status });
    throw new PaymentValidationError(
      'PAYMENT_PROOF_UNAVAILABLE',
      'The payment proof could not be stored securely. Please try again.',
      503,
    );
  }
}

async function deletePrivateProof(env, objectPath) {
  try {
    const baseUrl = configuredSupabaseUrl(env);
    await fetch(
      new URL(`/storage/v1/object/payment-proofs/${encodedStoragePath(objectPath)}`, baseUrl),
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
  } catch {
    console.error('Private payment proof cleanup requires operator review');
  }
}

async function signedPrivateProofUrl(env, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(
    new URL(`/storage/v1/object/sign/payment-proofs/${encodedStoragePath(objectPath)}`, baseUrl),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 300 }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.signedURL) {
    console.error('Private payment proof signing failed', { status: response.status });
    throw new PaymentValidationError(
      'PAYMENT_PROOF_UNAVAILABLE',
      'The proof is temporarily unavailable for secure review.',
      503,
    );
  }
  return new URL(result.signedURL, baseUrl).href;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function examinationUploadObjectUrl(env, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  return new URL(
    `/storage/v1/object/examination-uploads/${encodedStoragePath(objectPath)}`,
    baseUrl,
  );
}

async function uploadPrivateExamination(env, objectPath, bytes, mimeType) {
  const response = await fetch(examinationUploadObjectUrl(env, objectPath), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (response.ok) return { created: true };
  if (response.status === 409) return { created: false };
  console.error('Private examination upload failed', { status: response.status });
  throw new ExaminationValidationError(
    'UPLOAD_UNAVAILABLE',
    'The examination file could not be stored privately. Try again.',
    503,
  );
}

async function deletePrivateExamination(env, objectPath) {
  const response = await fetch(examinationUploadObjectUrl(env, objectPath), {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (response.ok || response.status === 404) return true;
  console.error('Private examination cleanup failed', { status: response.status });
  return false;
}

function examRoomSourceObjectUrl(env, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  return new URL(
    `/storage/v1/object/exam-room-sources/${encodedStoragePath(objectPath)}`,
    baseUrl,
  );
}

async function uploadExamRoomSource(env, objectPath, bytes, mimeType) {
  const response = await fetch(examRoomSourceObjectUrl(env, objectPath), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (response.ok || response.status === 409) return response.status !== 409;
  console.error('Examination Room source upload failed', { status: response.status });
  throw new DD2026ValidationError(
    'UPLOAD_UNAVAILABLE',
    'The question source could not be stored privately. Try again.',
    503,
  );
}

async function deleteExamRoomSource(env, objectPath) {
  try {
    const response = await fetch(examRoomSourceObjectUrl(env, objectPath), {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    return response.ok || response.status === 404;
  } catch {
    console.error('Examination Room source cleanup requires operator review');
    return false;
  }
}

export function examinationEmailMode(env, examRoom = false) {
  const configured = examRoom
    ? (env.EXAMINATION_ROOM_EMAIL_MODE ?? env.EXAMINATION_EMAIL_MODE)
    : env.EXAMINATION_EMAIL_MODE;
  const mode = String(configured || '').trim().toLowerCase();
  return ['suppressed', 'enabled'].includes(mode) ? mode : 'not_configured';
}

export async function sendExaminationEmail(
  env,
  { recipient, subject, text, examRoom = false, idempotencyKey = null },
) {
  const mode = examinationEmailMode(env, examRoom);
  if (mode === 'suppressed') return { status: 'suppressed', providerId: null };
  if (
    mode !== 'enabled'
    || !env.RESEND_API_KEY
    || !env.EXAMINATION_EMAIL_FROM
  ) {
    return { status: 'not_configured', providerId: null };
  }
  const target = String(env.EXAMINATION_EMAIL_TEST_RECIPIENT || recipient || '').trim();
  if (!target) return { status: 'failed', safeErrorCode: 'recipient_missing' };
  const safeIdempotencyKey = /^[A-Za-z0-9._:-]{1,180}$/.test(String(idempotencyKey || ''))
    ? String(idempotencyKey)
    : null;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(safeIdempotencyKey ? { 'Idempotency-Key': safeIdempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.EXAMINATION_EMAIL_FROM,
      to: [target],
      subject,
      text,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    console.error('Examination email dispatch failed', { status: response.status });
    return { status: 'failed', safeErrorCode: `provider_${response.status}` };
  }
  return { status: 'sent', providerId: String(result.id).slice(0, 180) };
}

function adminDirectoryEmailMode(env) {
  const mode = String(env.ADMIN_DIRECTORY_EMAIL_MODE || '').trim().toLowerCase();
  return ['suppressed', 'enabled'].includes(mode) ? mode : 'not_configured';
}

async function sendAdminDirectoryEmail(
  env,
  { recipient, csv, filename, requestKey, resultCount },
) {
  const mode = adminDirectoryEmailMode(env);
  if (mode === 'suppressed') return { status: 'suppressed', providerId: null };
  const from = String(
    env.ADMIN_DIRECTORY_EMAIL_FROM || env.EXAMINATION_EMAIL_FROM || '',
  ).trim();
  if (mode !== 'enabled' || !env.RESEND_API_KEY || !from) {
    return { status: 'not_configured', providerId: null };
  }
  const target = String(
    env.ADMIN_DIRECTORY_EMAIL_TEST_RECIPIENT || recipient || '',
  ).trim();
  if (!target) return { status: 'failed', safeErrorCode: 'recipient_missing' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `admin-directory-${requestKey}`,
    },
    body: JSON.stringify({
      from,
      to: [target],
      subject: 'Due Diligence private user-directory export',
      text: [
        'An authorized Founder requested the attached private user-directory export.',
        `Rows exported: ${resultCount}.`,
        'It contains personal information. Store it securely and do not forward it.',
      ].join('\n'),
      attachments: [{ filename, content: utf8Base64(csv) }],
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    console.error('Admin directory email dispatch failed', { status: response.status });
    return { status: 'failed', safeErrorCode: `provider_${response.status}` };
  }
  return { status: 'sent', providerId: String(result.id).slice(0, 180) };
}

const SUPPORT_NOTIFICATION_RECIPIENT = 'support@duediligence.ph';
const SIGN_IN_NOTIFICATION_RECIPIENT_KEY = 'wally';
const SIGN_IN_NOTIFICATION_DEDUPE_MS = 30 * 24 * 60 * 60 * 1000;

function supportNotificationEmailMode(env) {
  const mode = String(env.SUPPORT_NOTIFICATION_EMAIL_MODE || '').trim().toLowerCase();
  return ['suppressed', 'enabled'].includes(mode) ? mode : 'not_configured';
}

function supportReplyAddress(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
    ? candidate
    : null;
}

async function sendSupportNotification(env, { subject, text, replyTo, adminPath }) {
  const mode = supportNotificationEmailMode(env);
  if (mode === 'suppressed') return { status: 'suppressed', providerId: null };
  if (mode !== 'enabled') return { status: 'not_configured', providerId: null };
  const from = String(
    env.SUPPORT_NOTIFICATION_EMAIL_FROM
    || env.ADMIN_DIRECTORY_EMAIL_FROM
    || env.EXAMINATION_EMAIL_FROM
    || '',
  ).trim();
  if (!env.RESEND_API_KEY || !from) {
    console.error('Support notification email is not configured', { mode });
    return { status: 'not_configured', providerId: null };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [SUPPORT_NOTIFICATION_RECIPIENT],
        subject,
        text: [
          String(text || 'A new report or Support request was submitted.').trim(),
          '',
          `Authorized review: https://duediligence.ph${adminPath}`,
        ].join('\n'),
        ...(supportReplyAddress(replyTo) ? { reply_to: supportReplyAddress(replyTo) } : {}),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) {
      console.error('Support notification email dispatch failed', { status: response.status });
      return { status: 'failed', providerId: null };
    }
    return { status: 'sent', providerId: String(result.id).slice(0, 180) };
  } catch {
    console.error('Support notification email dispatch failed', { status: 'network_error' });
    return { status: 'failed', providerId: null };
  }
}

function safeSingleLine(value, maximum = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function signInNotificationEmailMode(env) {
  const mode = String(env.SIGN_IN_NOTIFICATION_EMAIL_MODE || '').trim().toLowerCase();
  return ['suppressed', 'enabled'].includes(mode) ? mode : 'not_configured';
}

function decodeJwtPayload(authorization) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1] || '';
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

export function verifiedAccessTokenContext(authorization) {
  const payload = decodeJwtPayload(authorization);
  const sessionId = String(payload.session_id || '').trim().toLowerCase();
  // Supabase Auth's AMR contract distinguishes MFA factors with `mfa/*`.
  // `totp` is retained for the stable/legacy TOTP claim. Plain `otp`, phone,
  // WebAuthn, password, and OAuth entries are not sufficient step-up proof.
  const supportedMfaMethods = new Set([
    'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn',
  ]);
  const stepUpAuthenticatedAt = payload.aal === 'aal2' && Array.isArray(payload.amr)
    ? payload.amr
        .filter((entry) => entry && typeof entry === 'object')
        .filter((entry) => supportedMfaMethods.has(String(entry.method || '').trim().toLowerCase()))
        .map((entry) => entry.timestamp)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .reduce((latest, value) => Math.max(latest, value), 0) || null
    : null;
  return {
    authenticationLevel: payload.aal === 'aal2' ? 'aal2' : 'aal1',
    authenticationSessionId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)
      ? sessionId
      : null,
    stepUpAuthenticatedAt,
  };
}

async function signInSessionDigest(request, user) {
  const payload = decodeJwtPayload(request.headers.get('Authorization'));
  const sessionKey = safeSingleLine(
    payload.session_id || `${user.id}:${payload.iat || 'verified-session'}`,
    180,
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionKey),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function summarizeSignInClient(request) {
  const userAgent = String(request.headers.get('User-Agent') || '');
  const mobileHint = request.headers.get('Sec-CH-UA-Mobile') === '?1';
  let device = 'Desktop or laptop';
  if (/iPad|Tablet|Nexus 7|Nexus 9|SM-T/i.test(userAgent)) device = 'Tablet';
  else if (mobileHint || /Mobile|iPhone|Android/i.test(userAgent)) device = 'Mobile phone';

  let operatingSystem = 'Unknown or privacy-masked';
  if (/iPhone|iPad|iPod/i.test(userAgent)) operatingSystem = 'iOS or iPadOS';
  else if (/Android/i.test(userAgent)) operatingSystem = 'Android';
  else if (/Windows NT/i.test(userAgent)) operatingSystem = 'Windows';
  else if (/CrOS/i.test(userAgent)) operatingSystem = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(userAgent)) operatingSystem = 'macOS';
  else if (/Linux/i.test(userAgent)) operatingSystem = 'Linux';

  const browserPatterns = [
    ['Microsoft Edge', /Edg(?:A|iOS)?\/([0-9]+)/i],
    ['Samsung Internet', /SamsungBrowser\/([0-9]+)/i],
    ['Opera', /(?:OPR|Opera)\/([0-9]+)/i],
    ['Firefox', /(?:Firefox|FxiOS)\/([0-9]+)/i],
    ['Chrome', /(?:Chrome|CriOS)\/([0-9]+)/i],
    ['Safari', /Version\/([0-9]+)[^\n]*Safari\//i],
  ];
  const browserMatch = browserPatterns
    .map(([name, pattern]) => ({ name, match: userAgent.match(pattern) }))
    .find((entry) => entry.match);
  const browser = browserMatch
    ? `${browserMatch.name} ${browserMatch.match[1]}`
    : 'Unknown or privacy-masked';
  const language = safeSingleLine(
    String(request.headers.get('Accept-Language') || '').split(',')[0],
    40,
  ) || 'Not provided';
  return { device, operatingSystem, browser, language };
}

function approximateSignInLocation(request) {
  const parts = [
    safeSingleLine(request.cf?.region, 80),
    safeSingleLine(request.cf?.country, 2),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not available';
}

async function sendSignInNotification(env, request, user, sessionDigest) {
  const mode = signInNotificationEmailMode(env);
  if (mode === 'suppressed') return { status: 'suppressed' };
  const from = String(
    env.SIGN_IN_NOTIFICATION_EMAIL_FROM
    || env.SUPPORT_NOTIFICATION_EMAIL_FROM
    || '',
  ).trim();
  const recipient = resolveAdminDirectoryRecipient(
    env.ADMIN_DIRECTORY_RECIPIENTS_JSON,
    SIGN_IN_NOTIFICATION_RECIPIENT_KEY,
  );
  if (mode !== 'enabled' || !env.RESEND_API_KEY || !from || !recipient) {
    console.error('Sign-in notification email is not configured', { mode });
    return { status: 'not_configured' };
  }

  const now = new Date();
  const createdAt = Date.parse(user.createdAt || '');
  const accountStatus = Number.isFinite(createdAt) && now.getTime() - createdAt < 10 * 60 * 1000
    ? 'New account'
    : 'Returning account';
  const client = summarizeSignInClient(request);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `sign-in-${sessionDigest}`,
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: 'Due Diligence user sign-in',
        text: [
          'A user successfully signed in to Due Diligence.',
          '',
          `Name: ${user.displayName || 'Not provided'}`,
          `Email: ${user.email || 'Not provided'}`,
          `Account ID: ${user.id}`,
          `Account status: ${accountStatus}`,
          `Sign-in provider: ${user.provider || 'Not provided'}`,
          `Time in the Philippines: ${new Intl.DateTimeFormat('en-PH', {
            dateStyle: 'full',
            timeStyle: 'long',
            timeZone: 'Asia/Manila',
          }).format(now)}`,
          `UTC time: ${now.toISOString()}`,
          `Device type: ${client.device}`,
          `Browser: ${client.browser}`,
          `Operating system: ${client.operatingSystem}`,
          `Browser language: ${client.language}`,
          `Approximate location: ${approximateSignInLocation(request)}`,
          '',
          'Privacy and security: This notice intentionally excludes the user’s IP address, password, session token, cookies, answers, and device fingerprint. Browser and location details are approximate and may be masked or spoofed.',
        ].join('\n'),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) {
      console.error('Sign-in notification email dispatch failed', { status: response.status });
      return { status: 'failed' };
    }
    return { status: 'sent' };
  } catch {
    console.error('Sign-in notification email dispatch failed', { status: 'network_error' });
    return { status: 'failed' };
  }
}

async function sendSecureNotification(env, { mailbox, subject, adminPath }) {
  if (!env.WEB3FORMS_ACCESS_KEY) return { sent: false, queued: true };
  const response = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_key: env.WEB3FORMS_ACCESS_KEY,
      from_name: 'Due Diligence Operations',
      subject,
      email: mailbox,
      message: `A new production request is ready for authorized review: https://duediligence.ph${adminPath}`,
    }),
  });
  if (!response.ok) {
    console.error('Operations notification dispatch failed', { status: response.status });
    return { sent: false, queued: true };
  }
  return { sent: true, queued: true };
}

async function verifiedAuthenticatedUser(request, env) {
  if (authenticatedUserCache.has(request)) {
    return authenticatedUserCache.get(request);
  }
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!authorization) return null;
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new GuestAccessError('INVALID_SESSION', 'Your session is invalid. Please sign in again.', 401);
  }
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL('/auth/v1/user', baseUrl), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: authorization,
    },
  });
  if (!response.ok) {
    throw new GuestAccessError('INVALID_SESSION', 'Your session expired. Please sign in again.', 401);
  }
  const user = await response.json().catch(() => null);
  if (!user?.id) {
    throw new GuestAccessError('INVALID_SESSION', 'Your session expired. Please sign in again.', 401);
  }
  // `/auth/v1/user` has just authenticated this exact bearer token. Only
  // after that verification do we decode its AAL and session claims for
  // server-side step-up authorization; client JSON fields are never used.
  const accessTokenContext = verifiedAccessTokenContext(authorization);
  const verified = {
    id: String(user.id),
    email: String(user.email || '').trim().toLowerCase() || null,
    displayName: safeSingleLine(
      user.user_metadata?.full_name || user.user_metadata?.name,
      120,
    ) || null,
    createdAt: safeSingleLine(user.created_at, 40) || null,
    provider: safeSingleLine(user.app_metadata?.provider, 40) || null,
    ...accessTokenContext,
  };
  authenticatedUserCache.set(request, verified);
  return verified;
}

async function handleSignInNotification(request, env, origin, allowedOrigin) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new GuestAccessError('SIGN_IN_REQUIRED', 'Sign-in is required.', 401);
  }
  const sessionDigest = await signInSessionDigest(request, user);
  const now = Date.now();
  for (const [key, sentAt] of recentSignInNotificationSessions.entries()) {
    if (now - sentAt >= SIGN_IN_NOTIFICATION_DEDUPE_MS) {
      recentSignInNotificationSessions.delete(key);
    }
  }
  if (recentSignInNotificationSessions.has(sessionDigest)) {
    return jsonResponse({ ok: true, notification: 'already_processed' }, 202, origin, allowedOrigin);
  }
  const delivery = await sendSignInNotification(env, request, user, sessionDigest);
  if (['sent', 'suppressed'].includes(delivery.status)) {
    recentSignInNotificationSessions.set(sessionDigest, now);
  }
  return jsonResponse({ ok: true, notification: delivery.status }, 202, origin, allowedOrigin);
}

function phase4AccessEnforced(env) {
  return String(env.PHASE4_ACCESS_ENFORCEMENT).toLowerCase() === 'true';
}

function authenticatedSubmissionsEnforced(env) {
  return phase4AccessEnforced(env)
    || String(env.REQUIRE_AUTHENTICATED_SUBMISSIONS).toLowerCase() === 'true';
}

function phase4ModelQualityEnforced(env) {
  return String(env.PHASE4_MODEL_QUALITY_ENFORCEMENT).toLowerCase() === 'true';
}

function privateBetaGateEnabled(env) {
  return String(env.PRIVATE_BETA_GATE_ENABLED).toLowerCase() === 'true';
}

function privateBetaDisclosureVersion(env) {
  const version = String(
    env.PRIVATE_BETA_DISCLOSURE_VERSION
    || 'beta-disclosure-v1-2026-07-31',
  ).trim();
  if (!/^beta-disclosure-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(version)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_NOT_CONFIGURED',
      'Private-beta access is temporarily unavailable.',
      503,
    );
  }
  return version;
}

function privateBetaAccessToken(request) {
  const token = String(request.headers.get('X-DD-Beta-Access') || '').trim();
  if (!token || token.length > 4096) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_ADMISSION_REQUIRED',
      'Complete private-beta admission before continuing.',
      403,
    );
  }
  return token;
}

function privateBetaFlowId(request) {
  const value = String(request.headers.get('X-DD-Beta-Flow-ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(value)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_ACCESS_DENIED',
      'Private-beta access could not be verified. Review the access details and try again later.',
      401,
    );
  }
  return value;
}

async function privateBetaRateSubjectHashes(request, env) {
  const ip = String(request.headers.get('CF-Connecting-IP') || 'unavailable');
  const flowId = privateBetaFlowId(request);
  const [flowHash, networkHash] = await Promise.all([
    privateBetaHmacHex(
      env.GUEST_USAGE_HMAC_KEY,
      `private-beta-flow\0${flowId}`,
    ),
    privateBetaHmacHex(
      env.GUEST_USAGE_HMAC_KEY,
      `private-beta-network\0${ip}`,
    ),
  ]);
  return { flowHash, networkHash };
}

async function privateBetaAccessForUser(env, userId, accessJti = null) {
  const result = await phase4Rpc(env, 'private_beta_access_snapshot', {
    p_user_id: userId,
    p_access_jti_hash: accessJti ? await privateBetaSha256Hex(accessJti) : null,
  });
  return {
    allowed: result?.allowed === true,
    admissionKind: result?.admissionKind || null,
    disclosureVersion: result?.disclosureVersion || null,
    expiresAt: result?.expiresAt || null,
  };
}

function isGlobalBetaAdmission(access) {
  return access?.allowed === true
    && access?.admissionKind === 'global_beta_all_access'
    && access?.expiresAt == null;
}

async function requirePrivateBetaAdmission(request, env) {
  if (!privateBetaGateEnabled(env)) return null;
  const user = await requireAuthenticatedUser(request, env);
  const globalAccess = await privateBetaAccessForUser(env, user.id);
  if (isGlobalBetaAdmission(globalAccess)) {
    return { user, access: globalAccess, tokenPayload: null };
  }
  const disclosureVersion = privateBetaDisclosureVersion(env);
  const token = privateBetaAccessToken(request);
  const payload = await verifyPrivateBetaToken(
    token,
    env.PRIVATE_BETA_FLOW_SIGNING_KEY,
    {
      expectedType: 'access',
      expectedSubject: user.id,
      disclosureVersion,
    },
  );
  const access = await privateBetaAccessForUser(env, user.id, payload.jti);
  if (!access.allowed || access.disclosureVersion !== disclosureVersion) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_ADMISSION_REQUIRED',
      'Complete private-beta admission before continuing.',
      403,
    );
  }
  return { user, access, tokenPayload: payload };
}

async function privateBetaCapabilityExempt(request, pathname) {
  // Administrator authorization is enforced again by every /admin handler.
  // Keep the protected Admin console reachable even when a Founder disables
  // the learner-wide beta policy; otherwise the console could be unable to
  // load the very control needed to review or re-enable that policy.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return true;
  }
  if (pathname === '/examinations/query') {
    const payload = await parseBoundedJson(request.clone(), 24_000);
    return payload?.operation === 'assignment';
  }
  if (pathname === '/examinations/command') {
    const payload = await parseBoundedJson(request.clone(), 80_000);
    return new Set([
      'claim_examiner_assignment',
      'save_examiner_review',
      'finalize_examiner_review',
    ]).has(payload?.operation);
  }
  return false;
}

function publicPricingEnabled(env) {
  return String(env.PUBLIC_PRICING_ENABLED).toLowerCase() === 'true';
}

function concealedSubscriptionState(value) {
  const subscription = value?.subscription && typeof value.subscription === 'object'
    ? {
        status: value.subscription.status || null,
        startsAt: value.subscription.startsAt || null,
        expiresAt: value.subscription.expiresAt || null,
        betaAccessActive: value.subscription.status === 'active',
      }
    : null;
  const pendingPayment = value?.pendingPayment && typeof value.pendingPayment === 'object'
    ? {
        status: value.pendingPayment.status || null,
        submittedAt: value.pendingPayment.submittedAt || null,
      }
    : null;
  return {
    globalBeta: value?.globalBeta && typeof value.globalBeta === 'object'
      ? {
          enabled: value.globalBeta.enabled === true,
          active: value.globalBeta.active === true,
          expiresAt: value.globalBeta.expiresAt || null,
        }
      : null,
    subscription,
    pendingPayment,
    examinationBeta: value?.examinationBeta || null,
    pricingHidden: true,
    message: 'Pricing will be announced after beta testing.',
  };
}

async function requireAuthenticatedUser(request, env) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new AccessValidationError(
      'AUTHENTICATION_REQUIRED',
      'Sign in with Google before opening or submitting an examination.',
      401,
    );
  }
  return user;
}

async function requireAuthenticatedSubmission(request, env, activity = 'submitting this request') {
  if (!authenticatedSubmissionsEnforced(env)) {
    return verifiedAuthenticatedUser(request, env);
  }
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new AccessValidationError(
      'AUTHENTICATION_REQUIRED',
      `Sign in with Google before ${activity}.`,
      401,
    );
  }
  return user;
}

async function phase4AccessForUser(env, userId, options = {}) {
  const result = await phase4Rpc(env, 'phase4_access_snapshot', {
    p_user_id: userId,
    p_activate_trial: options.activateTrial === true,
    p_request_key: options.requestKey || null,
  });
  return normalizeAccessSnapshot(result);
}

async function reserveGradeAccess(request, env, gradingRequest, verifiedUser = null) {
  if (phase4AccessEnforced(env)) {
    const authenticatedUser = verifiedUser || await requireAuthenticatedUser(request, env);
    const requestId = normalizeRequestKey(request.headers.get('X-Request-ID'));
    const reservation = await phase4Rpc(env, 'phase4_reserve_grade_v2', {
      p_user_id: authenticatedUser.id,
      p_request_key: requestId,
      p_question_bank_id: gradingRequest.questionId,
    });
    if (reservation?.reason === 'duplicate_active'
        || reservation?.reason === 'duplicate_completed'
        || reservation?.reason === 'duplicate_closed') {
      throw new ExaminerError(
        'DUPLICATE_SUBMISSION',
        reservation.reason === 'duplicate_completed'
          ? 'This grading request has already been completed.'
          : 'This answer is already being checked. Please wait for the result.',
        409,
      );
    }
    const access = normalizeAccessSnapshot(reservation);
    if (!access.allowed) throw accessDeniedError(access);
    if (!reservation?.reservationId) {
      throw new ExaminerError(
        'ACCESS_UNAVAILABLE',
        'Your grading request could not be reserved. Please try again.',
        503,
      );
    }
    return {
      signedIn: true,
      phase4: true,
      userId: authenticatedUser.id,
      requestId,
      reservationId: String(reservation.reservationId),
      access,
      usage: null,
    };
  }

  const authenticatedUser = await verifiedAuthenticatedUser(request, env);
  if (authenticatedUser) {
    return { signedIn: true, reservationId: null, usage: null };
  }
  const hasGuestHeaders = request.headers.has('X-Guest-Device-ID')
    && request.headers.has('X-Request-ID');
  if (!hasGuestHeaders && String(env.ALLOW_LEGACY_GUESTS).toLowerCase() === 'true') {
    return { signedIn: false, legacy: true, reservationId: null, usage: null };
  }
  const { deviceId, requestId } = requireGuestHeaders(request);
  const { deviceHash, recoveryHash } = await deriveGuestHashes(
    request,
    env.GUEST_USAGE_HMAC_KEY,
    deviceId,
  );
  const reservation = normalizeReservationResponse(await supabaseRpc(env, 'reserve_guest_grade', {
    p_device_hash: deviceHash,
    p_recovery_hash: recoveryHash,
    p_request_key: requestId,
    p_limit: GUEST_GRADE_LIMIT,
    p_reservation_seconds: 120,
  }));
  if (!reservation.allowed) {
    if (reservation.reason === 'duplicate_request') {
      throw new GuestAccessError(
        'DUPLICATE_SUBMISSION',
        'This answer is already being checked. Please wait for the result.',
        409,
      );
    }
    throw new GuestAccessError(
      'GUEST_LIMIT_REACHED',
      'You have completed your 3 guest questions. Sign in to continue.',
      403,
    );
  }
  return {
    signedIn: false,
    reservationId: reservation.reservationId,
    usage: publicGuestUsage(reservation),
  };
}

async function guestAccessStatus(request, env) {
  const authenticatedUser = await verifiedAuthenticatedUser(request, env);
  if (authenticatedUser) {
    return { signedIn: true, usage: null };
  }

  const deviceId = String(request.headers.get('X-Guest-Device-ID') || '').trim();
  if (!GUEST_DEVICE_ID_PATTERN.test(deviceId)) {
    throw new GuestAccessError(
      'GUEST_ID_REQUIRED',
      'Guest access could not be verified. Refresh the page and try again.',
      400,
    );
  }
  const { deviceHash, recoveryHash } = await deriveGuestHashes(
    request,
    env.GUEST_USAGE_HMAC_KEY,
    deviceId,
  );

  const deviceRows = await supabaseGuestRows(env, 'guest_grading_devices', {
    select: 'usage_id',
    device_hash: `eq.${deviceHash}`,
    limit: '1',
  });
  let usageRows = [];
  if (deviceRows[0]?.usage_id) {
    usageRows = await supabaseGuestRows(env, 'guest_grading_usage', {
      select: 'successful_grades',
      id: `eq.${String(deviceRows[0].usage_id)}`,
      limit: '1',
    });
  } else {
    const recoveryCutoff = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
    const recoveryRows = await supabaseGuestRows(env, 'guest_grading_usage', {
      select: 'successful_grades',
      recovery_hash: `eq.${recoveryHash}`,
      last_seen_at: `gte.${recoveryCutoff}`,
      order: 'last_seen_at.desc',
      limit: '2',
    });
    if (recoveryRows.length === 1) usageRows = recoveryRows;
  }

  const consumed = Math.max(
    0,
    Math.min(GUEST_GRADE_LIMIT, Number(usageRows[0]?.successful_grades) || 0),
  );
  return {
    signedIn: false,
    usage: publicGuestUsage({
      remaining: GUEST_GRADE_LIMIT - consumed,
      consumed,
    }),
  };
}

async function finalizeGradeAccess(access, env, completion = null) {
  if (access?.phase4) {
    if (!completion?.attemptId || !completion?.assessment || !completion?.model) {
      throw new ExaminerError(
        'ATTEMPT_PERSISTENCE_FAILED',
        'The completed assessment could not be preserved. No grade was consumed.',
        503,
      );
    }
    const result = await phase4Rpc(env, 'phase4_finalize_exam_grade', {
      p_user_id: access.userId,
      p_reservation_id: access.reservationId,
      p_attempt_id: completion.attemptId,
      p_score: completion.assessment.score,
      p_assessment: completion.assessment,
      p_provider_model: completion.model,
    });
    return {
      limit: 3,
      used: Math.max(0, Math.min(3, Number(result?.used) || 0)),
      remaining: Math.max(0, Math.min(3, Number(result?.remaining) || 0)),
    };
  }
  if (access.signedIn || access.legacy) return null;
  const result = normalizeReservationResponse(await supabaseRpc(env, 'finalize_guest_grade', {
    p_reservation_id: access.reservationId,
    p_limit: GUEST_GRADE_LIMIT,
  }));
  return publicGuestUsage(result);
}

async function releaseGradeAccess(access, env, reason = 'grading_failed') {
  if (!access || !access.reservationId) return;
  if (access.phase4) {
    try {
      await phase4Rpc(env, 'phase4_release_grade', {
        p_user_id: access.userId,
        p_reservation_id: access.reservationId,
        p_reason: reason,
      });
    } catch (error) {
      console.error('Authenticated grade reservation release failed', {
        code: error?.code || 'UNKNOWN',
      });
    }
    return;
  }
  if (access.signedIn) return;
  try {
    await supabaseRpc(env, 'release_guest_grade', {
      p_reservation_id: access.reservationId,
    });
  } catch (error) {
    console.error('Guest quota reservation release failed', {
      code: error?.code || 'UNKNOWN',
    });
  }
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAY_MS * (attempt + 1)));
}

async function loadLaborBank(csvUrl) {
  const now = Date.now();
  if (laborBankCache && now - laborBankCache.loadedAt < 5 * 60 * 1000) return laborBankCache.records;
  const response = await fetch(csvUrl, { headers: { Accept: 'text/csv' } });
  if (!response.ok) throw new ExaminerError('QUESTION_BANK_UNAVAILABLE', 'The Labor Law question bank is temporarily unavailable.', 503);
  const records = parseQuestionBank(await response.text());
  laborBankCache = { records, loadedAt: now };
  return records;
}

async function loadWebsiteBank(url) {
  const now = Date.now();
  if (websiteBankCache && now - websiteBankCache.loadedAt < 5 * 60 * 1000) {
    return websiteBankCache.records;
  }
  let payload = null;
  let sourceError = null;
  if (url) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`source status ${response.status}`);
      payload = await response.json();
    } catch (error) {
      sourceError = error;
    }
  } else {
    try {
      const response = await fetch(WEBSITE_UPLOAD_CSV_URL, {
        headers: { Accept: 'text/csv' },
      });
      if (!response.ok) throw new Error(`source status ${response.status}`);
      const csvText = await response.text();
      await parseWebsiteUploadSource(csvText);
      const parsed = parseQuestionBank(csvText);
      websiteBankCache = { records: parsed, loadedAt: now, source: WEBSITE_UPLOAD_CSV_URL };
      return parsed;
    } catch (error) {
      sourceError = error;
    }
  }

  // Keep the last successfully validated live source available through a
  // transient publication outage. The embedded reviewed snapshot remains the
  // cold-start fallback and is never preferred over the published CSV.
  if (websiteBankCache?.records) return websiteBankCache.records;
  if (!payload) payload = embeddedWebsiteQuestionBank;
  if (!Array.isArray(payload?.records) || payload.records.length !== 320) {
    console.warn('Published website question bank unavailable and fallback invalid', {
      code: sourceError?.code || 'QUESTION_BANK_UNAVAILABLE',
    });
    throw new ExaminerError(
      'QUESTION_BANK_INVALID',
      'The website question bank could not be prepared safely.',
      502,
    );
  }
  const records = new Map();
  for (const row of payload.records) {
    const id = String(row?.['Question ID'] || '').trim();
    if (!id || records.has(id)) {
      throw new ExaminerError('QUESTION_BANK_INVALID', 'The website question bank contains an invalid or duplicate ID.', 502);
    }
    records.set(id, row);
  }
  websiteBankCache = {
    records,
    loadedAt: now,
    source: url || 'embedded-reviewed-fallback',
  };
  return records;
}

function normalizedAdminSourceLinks(value) {
  return sanitizeSources(Array.isArray(value) ? value : []).map((source) => ({
    title: source.title,
    url: source.url,
    authority: source.authority,
    reference: source.reference,
  }));
}

function mergedAdminSourceLinks(...groups) {
  return normalizedAdminSourceLinks(groups.flatMap((group) => (
    Array.isArray(group) ? group : []
  )));
}

async function enrichAdminAnswerHistory(items, env) {
  const records = Array.isArray(items) ? items : [];
  const needsPracticeBank = records.some((item) => (
    item?.recordSource === 'practice'
    && item?.questionId
    && (!item?.questionText || !item?.suggestedAnswer || !item?.questionSourceLinks?.length)
  ));
  let bank = null;
  if (needsPracticeBank) {
    bank = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  }

  return records.map((original) => {
    const item = { ...original };
    const persistedResultSources = normalizedAdminSourceLinks(item.resultSources);
    let questionSources = normalizedAdminSourceLinks(item.questionSourceLinks);

    if (item.recordSource === 'practice' && bank && item.questionId) {
      const context = questionFromBankRow(bank.get(String(item.questionId)));
      if (context) {
        if (!item.questionText && context.question) {
          item.questionText = context.question;
          item.questionTextSource = 'current_published_question_bank';
          item.questionTextStatus = 'available_current_published_record';
        }
        if (!item.suggestedAnswer && context.suggestedAnswer) {
          item.suggestedAnswer = context.suggestedAnswer;
          item.suggestedAnswerSource = 'current_published_question_bank';
          item.suggestedAnswerStatus = 'available_current_published_record';
        }
        questionSources = mergedAdminSourceLinks(questionSources, context.sourceUrls);
      }
    }

    if (item.recordSource === 'formal_exam' && !item.suggestedAnswer && item.modelAnswer) {
      item.suggestedAnswer = item.modelAnswer;
      item.suggestedAnswerSource = item.modelAnswerSource || 'immutable_exam_snapshot';
      item.suggestedAnswerStatus = item.modelAnswerStatus || 'available_exact_attempt_snapshot';
    }

    item.resultSources = persistedResultSources;
    item.questionSourceLinks = questionSources;
    item.displaySourceLinks = mergedAdminSourceLinks(persistedResultSources, questionSources);
    return item;
  });
}

function orderedModels(configuredModel) {
  return [...new Set([configuredModel || DEFAULT_MODEL, ...MODEL_FALLBACKS])];
}

function isUnsupportedModel(status, body) {
  return status === 404 || (status === 400 && /model|not found|unsupported/i.test(body));
}

function safeProviderErrorSummary(responseText, secret) {
  let message = '';
  try {
    const parsed = JSON.parse(responseText);
    message = `${parsed?.error?.status || 'UNKNOWN'}: ${parsed?.error?.message || 'No provider message'}`;
  } catch {
    message = String(responseText || 'No provider message');
  }
  if (secret) message = message.split(secret).join('[REDACTED]');
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
    .replace(/[?&]key=[^&\s]+/gi, 'key=[REDACTED]')
    .slice(0, 600);
}

function groundedSources(payload) {
  const chunks = payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return sanitizeSources(chunks.map((chunk) => ({
    title: chunk?.web?.title || '',
    url: chunk?.web?.uri || '',
    type: 'grounded',
  })));
}

function providerCapacityError(category = 'unavailable') {
  const error = new ExaminerError(
    'AI_GRADING_CAPACITY',
    'AI grading is temporarily at capacity. Your answer has been preserved and no attempt was consumed. Please return within 12 hours to continue.',
    503,
  );
  error.capacityCategory = category;
  error.retryAfterHours = 12;
  return error;
}

const {
  score: _legacyProviderScoreSchema,
  ...preciseScoreSchemaProperties
} = RESPONSE_SCHEMA.properties;

const PRECISE_SCORE_RESPONSE_SCHEMA = Object.freeze({
  ...RESPONSE_SCHEMA,
  required: RESPONSE_SCHEMA.required.map((field) => (
    field === 'score' ? 'scoreTenths' : field
  )),
  properties: Object.freeze({
    ...preciseScoreSchemaProperties,
    scoreTenths: Object.freeze({
      type: 'integer',
      minimum: 0,
      maximum: 50,
      description: 'The 0.0–5.0 score transported as integer tenths. Return 38 for 3.8/5.0.',
    }),
    percentagePointValue: Object.freeze({
      type: 'number',
      description: 'Must equal scoreTenths divided by 10.',
    }),
  }),
});

function preciseScorePrompt(prompt) {
  return `${prompt}

SCORE OUTPUT TRANSPORT — THIS DOES NOT CHANGE THE RUBRIC:
- Return scoreTenths as an integer from 0 to 50. Every integer step is one tenth of a point: 38 means 3.8/5.0 and 42 means 4.2/5.0.
- Apply the existing rubric first, then encode that score in scoreTenths. Do not return a score field.
- Use the full one-decimal scale when supported by the answer. Do not default scoreTenths to multiples of 5; whole-number and half-point scores remain valid only when the rubric places the answer there.
- Return percentagePointValue as scoreTenths divided by 10 and keep maxScore at 5.`;
}

function examinerResultWithDecimalScore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const scoreTenths = Number(raw.scoreTenths);
  const { score: _ignoredProviderScore, ...assessment } = raw;
  if (!Number.isInteger(scoreTenths) || scoreTenths < 0 || scoreTenths > 50) {
    return { ...assessment, score: Number.NaN };
  }
  const score = scoreTenths / 10;
  return { ...assessment, score, percentagePointValue: score };
}

async function callGemini(env, prompt, groundingEnabled) {
  if (!env.GEMINI_API_KEY) {
    throw new ExaminerError('EXAMINER_NOT_CONFIGURED', 'The AI examiner is not configured. Please contact the administrator.', 503);
  }

  let lastUnsupported = '';
  let quotaSeen = false;
  let providerFailureSeen = false;
  let timeoutSeen = false;
  for (const model of orderedModels(env.GEMINI_MODEL)) {
    const canGround = groundingEnabled && model !== 'gemini-1.5-flash';
    const groundingAttempts = canGround ? [true, false] : [false];
    let modelUnsupported = false;

    for (const useGrounding of groundingAttempts) {
      let groundingRejected = false;
      for (let requestAttempt = 0; requestAttempt < GEMINI_TRANSIENT_ATTEMPTS; requestAttempt += 1) {
        const body = {
          contents: [{ role: 'user', parts: [{ text: preciseScorePrompt(prompt) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: PRECISE_SCORE_RESPONSE_SCHEMA,
          },
        };
        if (useGrounding) body.tools = [{ google_search: {} }];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
        let response;
        let responseText = '';
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.GEMINI_API_KEY,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            },
          );
          responseText = await response.text();
        } catch (error) {
          providerFailureSeen = true;
          timeoutSeen ||= error?.name === 'AbortError';
          console.warn('Gemini request failed before a response was received', {
            model,
            grounding: useGrounding,
            attempt: requestAttempt + 1,
            reason: error?.name === 'AbortError' ? 'timeout' : 'network',
          });
          if (requestAttempt + 1 < GEMINI_TRANSIENT_ATTEMPTS) {
            await retryDelay(requestAttempt);
            continue;
          }
          break;
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          console.warn('Gemini request rejected', {
            model,
            status: response.status,
            grounding: useGrounding,
            attempt: requestAttempt + 1,
            provider: safeProviderErrorSummary(responseText, env.GEMINI_API_KEY),
          });
          if (useGrounding && response.status === 400 && /ground|google_search|tool|not supported/i.test(responseText)) {
            groundingRejected = true;
            break;
          }
          if (isUnsupportedModel(response.status, responseText)) {
            lastUnsupported = model;
            modelUnsupported = true;
            break;
          }
          if (response.status === 401 || response.status === 403) {
            throw new ExaminerError('EXAMINER_NOT_CONFIGURED', 'The AI examiner is not configured correctly. Please contact the administrator.', 503);
          }
          const transient = response.status === 408 || response.status === 429 || response.status >= 500;
          quotaSeen ||= response.status === 429;
          providerFailureSeen ||= response.status !== 429;
          if (transient && requestAttempt + 1 < GEMINI_TRANSIENT_ATTEMPTS) {
            await retryDelay(requestAttempt);
            continue;
          }
          break;
        }

        let payload;
        try {
          payload = JSON.parse(responseText);
        } catch {
          providerFailureSeen = true;
          if (requestAttempt + 1 < GEMINI_TRANSIENT_ATTEMPTS) {
            await retryDelay(requestAttempt);
            continue;
          }
          break;
        }
        const answerText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
        if (!answerText) {
          providerFailureSeen = true;
          if (requestAttempt + 1 < GEMINI_TRANSIENT_ATTEMPTS) {
            await retryDelay(requestAttempt);
            continue;
          }
          break;
        }
        let result;
        try {
          result = JSON.parse(answerText);
        } catch {
          providerFailureSeen = true;
          if (requestAttempt + 1 < GEMINI_TRANSIENT_ATTEMPTS) {
            await retryDelay(requestAttempt);
            continue;
          }
          break;
        }
        return { model, result, groundedSources: groundedSources(payload), groundingUsed: useGrounding };
      }
      if (modelUnsupported) break;
      if (groundingRejected) continue;
    }
  }
  if (quotaSeen) {
    throw providerCapacityError('rate_limit');
  }
  if (providerFailureSeen) {
    throw providerCapacityError(timeoutSeen ? 'timeout' : 'unavailable');
  }
  throw new ExaminerError(
    'UNSUPPORTED_MODEL',
    `No supported Gemini examiner model is currently available${lastUnsupported ? '.' : '.'}`,
    503,
  );
}

async function callGeminiStructured(env, prompt, responseSchema, validateResult) {
  if (!env.GEMINI_API_KEY) {
    throw new DD2026ValidationError(
      'COACH_NOT_CONFIGURED',
      'The study coach is temporarily unavailable.',
      503,
    );
  }
  let quotaSeen = false;
  let timeoutSeen = false;
  let providerFailureSeen = false;
  for (const model of orderedModels(env.GEMINI_MODEL)) {
    let unsupported = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repair = attempt === 1
        ? '\n\nREPAIR: Return only valid JSON matching the supplied schema. Do not add markdown or commentary outside JSON.'
        : '';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      let response;
      let responseText = '';
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${prompt}${repair}` }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema,
              },
            }),
            signal: controller.signal,
          },
        );
        responseText = await response.text();
      } catch (error) {
        providerFailureSeen = true;
        timeoutSeen ||= error?.name === 'AbortError';
        console.warn('Structured study coach request failed', {
          model,
          attempt: attempt + 1,
          reason: error?.name === 'AbortError' ? 'timeout' : 'network',
        });
        if (attempt === 0) {
          await retryDelay(attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        console.warn('Structured study coach request rejected', {
          model,
          status: response.status,
          attempt: attempt + 1,
          provider: safeProviderErrorSummary(responseText, env.GEMINI_API_KEY),
        });
        if (isUnsupportedModel(response.status, responseText)) {
          unsupported = true;
          break;
        }
        if (response.status === 401 || response.status === 403) {
          throw new DD2026ValidationError(
            'COACH_NOT_CONFIGURED',
            'The study coach is temporarily unavailable.',
            503,
          );
        }
        quotaSeen ||= response.status === 429;
        providerFailureSeen ||= response.status !== 429;
        if (attempt === 0 && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          await retryDelay(attempt);
          continue;
        }
        break;
      }
      try {
        const payload = JSON.parse(responseText);
        const answerText = payload?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || '').join('').trim();
        const parsed = JSON.parse(answerText);
        return { model, result: validateResult(parsed) };
      } catch {
        providerFailureSeen = true;
        if (attempt === 0) {
          await retryDelay(attempt);
          continue;
        }
      }
    }
    if (unsupported) continue;
  }
  if (quotaSeen) {
    throw new DD2026ValidationError(
      'COACH_CAPACITY',
      'The study coach has reached temporary capacity. Try again shortly.',
      503,
    );
  }
  throw new DD2026ValidationError(
    timeoutSeen ? 'COACH_TIMEOUT' : 'COACH_UNAVAILABLE',
    timeoutSeen
      ? 'The study coach took too long to respond. Try again.'
      : 'The study coach is temporarily unavailable.',
    503,
  );
}

async function handleGrade(request, env, origin, allowedOrigin) {
  await enforceRateLimit(request, env);
  const submissionUser = await requireAuthenticatedSubmission(
    request,
    env,
    'submitting an examination answer',
  );
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The grading request contains invalid JSON.');
  }
  const gradingRequest = normalizeRequest(payload);
  if (isProtectedQuestionWithheld(gradingRequest.questionId)) {
    throw new ExaminerError(
      'QUESTION_NOT_FOUND',
      'The protected question is no longer available.',
      404,
    );
  }
  const submissionId = await registerSubmission(gradingRequest, request);
  let gradeAccess = null;
  let attemptId = null;

  try {
    gradeAccess = await reserveGradeAccess(request, env, gradingRequest, submissionUser);
    let bankContext = null;
    try {
      const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
      bankContext = questionFromBankRow(records.get(gradingRequest.questionId));
    } catch (error) {
      console.warn('Unified website question bank unavailable; using compatibility context.', {
        code: error?.code || 'UNKNOWN',
      });
    }
    if (!bankContext && /^LAB-\d{3}$/i.test(gradingRequest.questionId)) {
      try {
        const records = await loadLaborBank(env.LABOR_CSV_URL || LABOR_CSV_URL);
        bankContext = questionFromBankRow(records.get(gradingRequest.questionId));
      } catch (error) {
        console.warn('Labor compatibility bank unavailable; using client context.', {
          code: error?.code || 'UNKNOWN',
        });
      }
    }

    const context = chooseQuestionContext(bankContext, gradingRequest.questionContext);
    attemptId = await prepareExamAttempt(gradeAccess, gradingRequest, context, env);
    const policy = assessmentPolicy(context);
    const prompt = buildExaminerPrompt({
      questionId: gradingRequest.questionId,
      studentAnswer: gradingRequest.studentAnswer,
      context,
      policy,
    });
    const groundingEnabled = String(env.GEMINI_GROUNDING_ENABLED).toLowerCase() === 'true';
    const storedSources = sanitizeSources(
      Array.isArray(context.sourceUrls) && context.sourceUrls.length
        ? context.sourceUrls
        : context.sourceUrl
          ? [{
            title: context.sourceTitle || context.caseName || 'Stored question-bank source',
            url: context.sourceUrl,
            type: 'stored',
          }]
          : [],
    );
    let gemini;
    let assessment;
    let repairIssues = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptPrompt = attempt === 0
        ? prompt
        : `${prompt}

CONTROLLED REPAIR: The previous response failed these quality checks:
${repairIssues.map((issue) => `- ${issue}`).join('\n') || '- Schema or ALAC completeness failure.'}
Rewrite the entire JSON response once. Preserve the stored legal substance, return complete schema-valid JSON, make Application fact-specific and the most developed section, and start Conclusion with "Therefore,".`;
      gemini = await callGemini(env, attemptPrompt, groundingEnabled);
      try {
        let validatedAssessment = validateExaminerResult(
          examinerResultWithDecimalScore(gemini.result),
          policy,
          [...storedSources, ...gemini.groundedSources],
        );
        repairIssues = phase4ModelQualityEnforced(env)
          ? modelAnswerQualityIssues(validatedAssessment, context)
          : [];
        if (repairIssues.length && attempt === 1) {
          const curatedModelAnswer = curatedModelAnswerALAC(context);
          if (curatedModelAnswer) {
            validatedAssessment = {
              ...validatedAssessment,
              modelAnswerALAC: curatedModelAnswer,
            };
            // The reviewed stored answer is the authoritative legal corpus. Its
            // four required sections are preserved without imposing AI verbosity.
            repairIssues = [];
          }
        }
        if (repairIssues.length) {
          throw new ExaminerError(
            'MALFORMED_MODEL_RESPONSE',
            'The examiner returned an educationally incomplete ALAC model answer.',
            502,
          );
        }
        assessment = applyDeterministicScoreCap(
          {
            ...validatedAssessment,
            modelAnswerSections: modelAnswerSectionsForQuestion(validatedAssessment, context),
            humanVerified: context.verified === true,
            educationalNotice: 'AI-generated educational material. Not independently verified. Consult the linked official authorities.',
          },
          gradingRequest.studentAnswer,
          context,
        );
        break;
      } catch (error) {
        if (!(error instanceof ExaminerError) || error.code !== 'MALFORMED_MODEL_RESPONSE' || attempt === 1) {
          throw error;
        }
      }
    }

    const finalizedUsage = await finalizeGradeAccess(gradeAccess, env, {
      attemptId,
      assessment,
      model: gemini.model,
    });
    return jsonResponse({
      ok: true,
      attemptId,
      assessment: {
        ...assessment,
        modelUsed: gemini.model,
        workerVersion: env.WORKER_RELEASE || 'phase3-admin-analytics',
        gradedAt: new Date().toISOString(),
        questionAuthority: context.authority,
        groundingEnabled: gemini.groundingUsed,
      },
      access: gradeAccess.phase4
        ? {
          signedIn: true,
          access: gradeAccess.access,
          freeGrades: finalizedUsage,
        }
        : gradeAccess.signedIn
          ? { signedIn: true }
        : gradeAccess.legacy
          ? { signedIn: false, guest: null }
          : { signedIn: false, guest: finalizedUsage },
    }, 200, origin, allowedOrigin);
  } catch (error) {
    const isCapacity = error instanceof ExaminerError && error.code === 'AI_GRADING_CAPACITY';
    if (isCapacity && attemptId) {
      try {
        await markExamAttemptCapacity(
          gradeAccess,
          attemptId,
          error.capacityCategory || 'unavailable',
          env,
        );
      } catch (storageError) {
        console.error('Capacity-state persistence failed', {
          code: storageError?.code || 'UNKNOWN',
        });
      }
      error.pendingAttemptId = attemptId;
      await releaseGradeAccess(
        gradeAccess,
        env,
        `provider_${error.capacityCategory || 'unavailable'}`,
      );
    } else {
      await markExamAttemptFailed(gradeAccess, attemptId, error?.code, env);
      await releaseGradeAccess(gradeAccess, env);
    }
    recentSubmissions.delete(submissionId);
    throw error;
  }
}

async function prepareExamAttempt(access, gradingRequest, context, env) {
  if (!access?.phase4) return null;
  const result = await phase4Rpc(env, 'phase4_prepare_exam_attempt_v2', {
    p_user_id: access.userId,
    p_reservation_id: access.reservationId,
    p_request_key: access.requestId,
    p_question_bank_id: gradingRequest.questionId,
    p_subject: context.subject || 'Unknown subject',
    p_answer_text: gradingRequest.studentAnswer,
    p_timer_mode: gradingRequest.session.mode,
    p_elapsed_seconds: gradingRequest.session.elapsedSeconds,
    p_submission_reason: gradingRequest.session.submissionReason,
    p_expired: gradingRequest.session.expired,
  });
  if (!result?.attemptId) {
    throw new ExaminerError(
      'ATTEMPT_PERSISTENCE_FAILED',
      'Your answer could not be preserved. No grade was consumed.',
      503,
    );
  }
  return String(result.attemptId);
}

async function markExamAttemptCapacity(access, attemptId, category, env) {
  if (!access?.phase4 || !attemptId) return;
  await phase4Rpc(env, 'phase4_mark_exam_capacity', {
    p_user_id: access.userId,
    p_attempt_id: attemptId,
    p_category: category,
  });
}

async function markExamAttemptFailed(access, attemptId, code, env) {
  if (!access?.phase4 || !attemptId) return;
  try {
    await phase4Rpc(env, 'phase4_fail_exam_attempt', {
      p_user_id: access.userId,
      p_attempt_id: attemptId,
      p_safe_error_code: code || 'grading_failed',
    });
  } catch (error) {
    console.error('Exam attempt failure-state update failed', {
      code: error?.code || 'UNKNOWN',
    });
  }
}

async function handleForumFeed(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const query = normalizeForumFeedRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const feed = await forumRpc(env, 'forum_feed', {
    p_user_id: user.id,
    p_limit: query.limit,
    p_cursor_at: query.cursorAt,
    p_cursor_id: query.cursorId,
    p_post_id: query.postId,
  });
  return jsonResponse({ ok: true, feed }, 200, origin, allowedOrigin);
}

async function handleForumComments(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const payload = await parseBoundedJson(request, FORUM_LIMITS.requestBytes);
  const postId = forumUuid(payload?.postId, 'Post');
  const limit = Math.min(200, Math.max(1, Math.floor(Number(payload?.limit) || 100)));
  const comments = await forumRpc(env, 'forum_comments_for_post', {
    p_user_id: user.id,
    p_post_id: postId,
    p_limit: limit,
  });
  return jsonResponse({ ok: true, comments }, 200, origin, allowedOrigin);
}

async function handleForumPostCreate(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const post = normalizeForumPostRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_create_post', {
    p_user_id: user.id,
    p_body: post.body,
    p_source_url: post.sourceUrl,
  });
  return jsonResponse({ ok: true, post: result }, 201, origin, allowedOrigin);
}

async function handleForumPostUpdate(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const post = normalizeForumPostRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
    'update',
  );
  const result = await forumRpc(env, 'forum_update_post', {
    p_user_id: user.id,
    p_post_id: post.postId,
    p_body: post.body,
    p_source_url: post.sourceUrl,
  });
  return jsonResponse({ ok: true, post: result }, 200, origin, allowedOrigin);
}

async function handleForumPostDelete(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const { id } = normalizeForumDeleteRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_delete_post', {
    p_user_id: user.id,
    p_post_id: id,
  });
  return jsonResponse({ ok: true, post: result }, 200, origin, allowedOrigin);
}

async function handleForumReaction(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const reaction = normalizeForumReactionRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_set_reaction', {
    p_user_id: user.id,
    p_post_id: reaction.postId,
    p_liked: reaction.liked,
  });
  return jsonResponse({ ok: true, reaction: result }, 200, origin, allowedOrigin);
}

async function handleForumCommentCreate(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const comment = normalizeForumCommentRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_create_comment', {
    p_user_id: user.id,
    p_post_id: comment.postId,
    p_body: comment.body,
  });
  return jsonResponse({ ok: true, comment: result }, 201, origin, allowedOrigin);
}

async function handleForumCommentUpdate(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const comment = normalizeForumCommentRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
    'update',
  );
  const result = await forumRpc(env, 'forum_update_comment', {
    p_user_id: user.id,
    p_comment_id: comment.commentId,
    p_body: comment.body,
  });
  return jsonResponse({ ok: true, comment: result }, 200, origin, allowedOrigin);
}

async function handleForumCommentDelete(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const { id } = normalizeForumDeleteRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
    'Comment',
  );
  const result = await forumRpc(env, 'forum_delete_comment', {
    p_user_id: user.id,
    p_comment_id: id,
  });
  return jsonResponse({ ok: true, comment: result }, 200, origin, allowedOrigin);
}

async function handleForumRepostCreate(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const repost = normalizeForumRepostRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_create_repost', {
    p_user_id: user.id,
    p_post_id: repost.postId,
    p_commentary: repost.commentary,
  });
  return jsonResponse({ ok: true, repost: result }, 201, origin, allowedOrigin);
}

async function handleForumRepostDelete(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const { id } = normalizeForumDeleteRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
    'Repost',
  );
  const result = await forumRpc(env, 'forum_delete_repost', {
    p_user_id: user.id,
    p_repost_id: id,
  });
  return jsonResponse({ ok: true, repost: result }, 200, origin, allowedOrigin);
}

async function handleForumReport(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const report = normalizeForumReportRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const result = await forumRpc(env, 'forum_create_report', {
    p_user_id: user.id,
    p_target_type: report.targetType,
    p_target_id: report.targetId,
    p_category: report.category,
    p_explanation: report.explanation,
  });
  await sendSupportNotification(env, {
    subject: 'Due Diligence Quorum report',
    text: [
      'A Quorum report was submitted.',
      `Reporter: ${user.email || 'Signed-in member'}`,
      `Target: ${report.targetType} ${report.targetId}`,
      `Category: ${report.category}`,
      `Explanation: ${report.explanation || 'None provided'}`,
    ].join('\n'),
    replyTo: user.email,
    adminPath: '/admin/',
  });
  return jsonResponse({ ok: true, report: result }, 201, origin, allowedOrigin);
}

async function handleForumAdminQueue(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const query = normalizeForumAdminQueue(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  const queue = await forumRpc(env, 'forum_admin_queue', {
    p_actor_user_id: user.id,
    p_status: query.status,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  return jsonResponse({ ok: true, queue }, 200, origin, allowedOrigin);
}

async function handleForumAdminAction(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const payload = await parseBoundedJson(request, FORUM_LIMITS.requestBytes);
  const action = normalizeForumAdminAction(
    payload,
    payload?.requestId || request.headers.get('X-Request-ID'),
  );
  const result = await forumRpc(env, 'forum_admin_action', {
    p_actor_user_id: user.id,
    p_action: action.action,
    p_target_id: action.targetId,
    p_reason: action.reason,
    p_duration_hours: action.durationHours,
    p_request_key: action.requestId,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleQuorumQuery(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const query = normalizeQuorumQueryRequest(
    await parseBoundedJson(request, FORUM_LIMITS.requestBytes),
  );
  let result;
  if (query.operation === 'insights') {
    result = await forumRpc(env, 'forum_quorum_insights', {
      p_user_id: user.id,
    });
  } else if (query.operation === 'affirm_roster') {
    result = await forumRpc(env, 'forum_affirm_roster', {
      p_user_id: user.id,
      p_entry_id: query.payload.entryId,
      p_limit: query.payload.limit || 60,
    });
  } else {
    result = await forumRpc(env, 'forum_quorum_query_v2', {
      p_user_id: user.id,
      p_operation: query.operation,
      p_payload: query.payload,
    });
  }
  return jsonResponse(
    { ok: true, data: await withSignedQuorumImages(result, env) },
    200,
    origin,
    allowedOrigin,
  );
}

async function handleQuorumCommand(request, env, origin, allowedOrigin) {
  await enforceForumRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  const raw = await parseBoundedJson(request, QUORUM_LIMITS.requestBytes);
  const command = normalizeQuorumCommandRequest(raw);
  const isEntryCreate = ['create_entry', 'create_simple_entry'].includes(command.operation);
  const images = isEntryCreate
    ? (Array.isArray(raw?.images)
      ? normalizeQuorumImages(raw.images)
      : [normalizeQuorumImage(raw?.image)].filter(Boolean))
    : [];
  const avatar = command.operation === 'set_profile_avatar'
    ? normalizeQuorumAvatar(raw?.profileImage)
    : null;
  if ((raw?.image || raw?.images) && !isEntryCreate) {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'Images can be attached only while creating an entry.',
    );
  }

  let result;
  if (command.operation === 'set_profile_avatar') {
    let objectPath = null;
    try {
      objectPath = await uploadQuorumAvatar(env, avatar);
      result = await forumRpc(env, 'forum_set_profile_avatar', {
        p_user_id: user.id,
        p_payload: {
          objectPath,
          mimeType: avatar.mimeType,
          byteSize: avatar.byteSize,
          width: avatar.width,
          height: avatar.height,
          cropX: avatar.cropX,
          cropY: avatar.cropY,
        },
      });
      if (result?.previousPath && result.previousPath !== objectPath) {
        await deleteQuorumImage(env, result.previousPath);
      }
      result = { ...result, avatarPath: objectPath };
    } catch (error) {
      if (objectPath) await deleteQuorumImage(env, objectPath);
      throw error;
    }
  } else if (command.operation === 'set_affirm') {
    result = await forumRpc(env, 'forum_set_affirm', {
      p_user_id: user.id,
      p_entry_id: command.payload.entryId,
      p_reaction_type: command.payload.reaction,
    });
  } else if (['create_simple_entry', 'update_simple_entry'].includes(command.operation)) {
    result = await forumRpc(env, 'forum_publish_simple', {
      p_user_id: user.id,
      p_operation: command.operation === 'create_simple_entry' ? 'create' : 'update',
      p_payload: command.payload,
    });
  } else {
    result = await forumRpc(env, 'forum_quorum_command_v2', {
      p_user_id: user.id,
      p_operation: command.operation,
      p_payload: command.payload,
    });
  }

  if (isEntryCreate && images.length) {
    const objectPaths = [];
    try {
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const objectPath = await uploadQuorumImage(env, result.entryId, image);
        objectPaths.push(objectPath);
        await forumRpc(env, 'forum_quorum_command_v2', {
          p_user_id: user.id,
          p_operation: 'register_attachment',
          p_payload: {
            entryId: result.entryId,
            objectPath,
            mimeType: image.mimeType,
            byteSize: image.byteSize,
            sortOrder: index + 1,
            altText: command.payload.imageAlts?.[index]
              || command.payload.imageAlt
              || '',
          },
        });
      }
      result = {
        ...result,
        imagePath: objectPaths[0] || null,
        images: objectPaths.map((imagePath, index) => ({
          imagePath,
          imageAlt: command.payload.imageAlts?.[index]
            || command.payload.imageAlt
            || '',
          order: index + 1,
        })),
      };
    } catch (error) {
      await Promise.all(objectPaths.map((path) => deleteQuorumImage(env, path)));
      try {
        await forumRpc(env, 'forum_quorum_command_v2', {
          p_user_id: user.id,
          p_operation: 'delete_entry',
          p_payload: { entryId: result.entryId },
        });
      } catch (cleanupError) {
        console.error('Quorum entry cleanup failed after image error', {
          code: cleanupError?.code || 'UNKNOWN',
        });
      }
      throw error;
    }
  }

  if (['delete_entry', 'remove_attachment'].includes(command.operation)) {
    const paths = [
      ...(Array.isArray(result?.imagePaths) ? result.imagePaths : []),
      ...(result?.imagePath ? [result.imagePath] : []),
    ];
    await Promise.all(paths.map((path) => deleteQuorumImage(env, path)));
  }

  if (command.operation === 'create_report') {
    await sendSupportNotification(env, {
      subject: 'Due Diligence Quorum report',
      text: [
        'A Quorum report was submitted.',
        `Reporter: ${user.email || 'Signed-in member'}`,
        `Target: ${command.payload.targetType} ${command.payload.targetId}`,
        `Category: ${command.payload.category}`,
        `Explanation: ${command.payload.explanation || 'None provided'}`,
      ].join('\n'),
      replyTo: user.email,
      adminPath: '/admin/',
    });
  }

  return jsonResponse(
    { ok: true, data: await withSignedQuorumImages(result, env) },
    command.operation.startsWith('create_') ? 201 : 200,
    origin,
    allowedOrigin,
  );
}

async function handleQuorumAdmin(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const raw = await parseBoundedJson(request, FORUM_LIMITS.requestBytes);
  const normalized = normalizeQuorumAdminRequest(
    raw,
    raw?.payload?.requestId || request.headers.get('X-Request-ID'),
  );
  const result = normalized.operation === 'resolve_anonymous_identity'
    ? await forumRpc(env, 'forum_resolve_anonymous_identity', {
      p_actor_user_id: user.id,
      p_entry_id: normalized.payload.entryId,
      p_reason: normalized.payload.reason,
    })
    : await forumRpc(env, 'forum_quorum_admin', {
      p_actor_user_id: user.id,
      p_operation: normalized.operation,
      p_payload: normalized.payload,
    });
  return jsonResponse(
    { ok: true, data: await withSignedQuorumImages(result, env) },
    200,
    origin,
    allowedOrigin,
  );
}

function examinationQuestionContext(question) {
  const jurisprudence = Array.isArray(question?.jurisprudence)
    ? question.jurisprudence.filter(Boolean).join('; ')
    : String(question?.jurisprudence || '');
  return {
    subject: String(question?.subject || 'Philippine law'),
    question: String(question?.prompt || ''),
    suggestedAnswer: String(question?.modelAnswer || ''),
    legalBasis: String(question?.legalBasis || ''),
    application: String(question?.application || ''),
    conclusion: String(question?.conclusion || ''),
    caseName: jurisprudence,
    citation: String(question?.citation || ''),
    sourceUrls: Array.isArray(question?.sourceUrls) ? question.sourceUrls : [],
    verified: true,
    authority: 'curated-approved-examination-snapshot',
  };
}

async function gradeExaminationQuestion(env, question) {
  const context = examinationQuestionContext(question);
  const policy = assessmentPolicy(context);
  const prompt = buildExaminerPrompt({
    questionId: String(question.questionId),
    studentAnswer: String(question.studentAnswer || ''),
    context,
    policy,
  });
  const storedSources = sanitizeSources(
    context.sourceUrls.map((source) => ({
      title: source?.title || 'Stored official authority',
      url: source?.url || source,
      type: 'stored',
    })),
  );
  const groundingEnabled = String(env.GEMINI_GROUNDING_ENABLED).toLowerCase() === 'true';
  let gemini;
  let assessment;
  let repairIssues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptPrompt = attempt === 0
      ? prompt
      : `${prompt}

CONTROLLED REPAIR: The previous response failed these checks:
${repairIssues.map((issue) => `- ${issue}`).join('\n') || '- Schema or ALAC completeness failure.'}
Return one complete schema-valid JSON assessment. Preserve the stored legal substance.`;
    gemini = await callGemini(env, attemptPrompt, groundingEnabled);
    try {
      let validated = validateExaminerResult(
        examinerResultWithDecimalScore(gemini.result),
        policy,
        [...storedSources, ...gemini.groundedSources],
      );
      repairIssues = phase4ModelQualityEnforced(env)
        ? modelAnswerQualityIssues(validated, context)
        : [];
      if (repairIssues.length && attempt === 1) {
        const curatedModelAnswer = curatedModelAnswerALAC(context);
        if (curatedModelAnswer) {
          validated = {
            ...validated,
            modelAnswerALAC: curatedModelAnswer,
          };
          // The reviewed stored answer is the authoritative legal corpus. Its
          // four required sections are preserved without imposing AI verbosity.
          repairIssues = [];
        }
      }
      if (repairIssues.length) {
        throw new ExaminerError(
          'MALFORMED_MODEL_RESPONSE',
          'The examiner returned an incomplete ALAC assessment.',
          502,
        );
      }
      assessment = applyDeterministicScoreCap(
        {
          ...validated,
          modelAnswerSections: modelAnswerSectionsForQuestion(validated, context),
          humanVerified: true,
          educationalNotice: 'AI-generated educational assessment based on the stored approved answer and linked authorities. Not legal advice.',
        },
        String(question.studentAnswer || ''),
        context,
      );
      break;
    } catch (error) {
      if (
        !(error instanceof ExaminerError)
        || error.code !== 'MALFORMED_MODEL_RESPONSE'
        || attempt === 1
      ) throw error;
    }
  }
  return {
    assessment,
    model: gemini.model,
  };
}

async function processExaminationAiJob(env, user, gradingPackage) {
  const questions = Array.isArray(gradingPackage?.questions)
    ? gradingPackage.questions
    : [];
  if (!gradingPackage?.jobId) {
    throw new ExaminationValidationError(
      'EXAM_MODEL_NOT_AVAILABLE',
      'The approved grading package is unavailable.',
      409,
    );
  }
  if (!questions.length && gradingPackage.status === 'completed') {
    return {
      status: 'completed',
      completedQuestions: Number(gradingPackage.questionCount) || 0,
      questionCount: Number(gradingPackage.questionCount) || 0,
      modelsReleased: false,
    };
  }
  if (!questions.length) {
    throw new ExaminationValidationError(
      'EXAM_GRADING_JOB_NOT_FOUND',
      'No unassessed examination response is available for this grading request.',
      409,
    );
  }
  try {
    let finalState = null;
    const question = questions[0];
    const { assessment, model } = await gradeExaminationQuestion(env, question);
    finalState = await examinationRpc(env, 'examination_store_ai_assessment', {
      p_user_id: user.id,
      p_job_id: gradingPackage.jobId,
      p_question_id: question.questionId,
      p_score: assessment.score,
      p_assessment: assessment,
      p_grader_model: model,
      p_model_answer_hash: question.modelAnswerHash,
    });
    if (finalState?.modelsReleased) {
      const delivery = await sendExaminationEmail(env, {
        recipient: user.email,
        subject: 'Due Diligence model answers are available',
        text: [
          'Your model answers and individual ALAC assessments are now available in The Verdict.',
          '',
          'Open https://duediligence.ph and select Mock Bar, then sign in to review them.',
          '',
          'Educational use only. This message contains no examination answers.',
        ].join('\n'),
      });
      await examinationRpc(env, 'examination_record_delivery', {
        p_actor_user_id: user.id,
        p_target_type: 'model_answers_released',
        p_target_id: gradingPackage.attemptId,
        p_status: delivery.status,
        p_provider_id: delivery.providerId || null,
        p_safe_error_code: delivery.safeErrorCode || null,
      });
      finalState.modelAnswerEmailStatus = delivery.status;
    }
    return finalState;
  } catch (error) {
    try {
      await examinationRpc(env, 'examination_fail_ai_job', {
        p_user_id: user.id,
        p_job_id: gradingPackage.jobId,
        p_safe_error_code: error?.code || 'grading_failed',
      });
    } catch {
      console.error('Examination grading failure state requires operator review');
    }
    throw error;
  }
}

async function authorizeExaminationAccess(env, userId, options = {}) {
  return examinationRpc(env, 'examination_authorize_access', {
    p_user_id: userId,
    p_track: options.track || null,
    p_version_id: options.versionId || null,
    p_attempt_id: options.attemptId || null,
    p_allow_historical: options.allowHistorical === true,
  });
}

async function handleExaminationQuery(request, env, origin, allowedOrigin) {
  await enforceExaminationRateLimit(request, env);
  const raw = await parseBoundedJson(request, 24_000);
  const query = normalizeExaminationQuery(raw);
  const user = query.operation === 'assignment'
    ? null
    : await requireAuthenticatedUser(request, env);
  if (user && query.operation === 'subject_catalog') {
    const result = await examinationRpc(env, 'subject_matter_catalog', {
      p_user_id: user.id,
    });
    return jsonResponse({ ok: true, data: sanitizeSubjectMatterCatalog(result) }, 200, origin, allowedOrigin);
  }
  if (user && query.operation === 'subject_next') {
    const result = await examinationRpc(env, 'subject_matter_next_question', {
      p_user_id: user.id,
      p_subject: query.subject,
      p_year_level: query.yearLevel,
      p_term: query.term,
      p_reset_cycle: query.resetCycle,
    });
    return jsonResponse({ ok: true, data: sanitizeSubjectMatterSelection(result) }, 200, origin, allowedOrigin);
  }
  if (user && query.operation === 'subject_performance') {
    const result = await examinationRpc(env, 'subject_matter_performance', {
      p_user_id: user.id,
      p_subject: query.subject,
      p_limit: query.limit,
    });
    return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
  }
  if (user) {
    if (query.operation === 'catalog') {
      await authorizeExaminationAccess(env, user.id, { track: query.track });
    } else if (query.operation === 'setup') {
      await authorizeExaminationAccess(env, user.id, { versionId: query.versionId });
    } else if (query.operation === 'resume') {
      await authorizeExaminationAccess(env, user.id, {
        attemptId: query.attemptId,
        versionId: query.versionId,
      });
    } else if (query.operation === 'verdict') {
      await authorizeExaminationAccess(env, user.id, {
        attemptId: query.attemptId,
        allowHistorical: true,
      });
    } else if (query.operation === 'history') {
      await authorizeExaminationAccess(env, user.id, { allowHistorical: true });
    }
  }
  const result = await examinationRpc(env, 'examination_query', {
    p_user_id: user?.id || null,
    p_operation: query.operation,
    p_payload: query,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleExaminationCommand(request, env, origin, allowedOrigin) {
  await enforceExaminationRateLimit(request, env, true);
  const raw = await parseBoundedJson(request, 80_000);
  const command = normalizeExaminationCommand(raw);
  const tokenOperations = new Set([
    'claim_examiner_assignment',
    'save_examiner_review',
    'finalize_examiner_review',
  ]);
  const user = tokenOperations.has(command.operation)
    ? null
    : await requireAuthenticatedUser(request, env);
  if (user) {
    if (command.operation === 'start_attempt') {
      await authorizeExaminationAccess(env, user.id, { versionId: command.versionId });
    } else if (command.operation === 'confirm_upload') {
      await authorizeExaminationAccess(env, user.id, { track: 'bar_feels' });
    } else if (command.operation === 'delete_upload') {
      await authorizeExaminationAccess(env, user.id, {
        track: 'bar_feels',
        allowHistorical: true,
      });
    } else if (command.attemptId) {
      await authorizeExaminationAccess(env, user.id, {
        attemptId: command.attemptId,
        allowHistorical: ['request_ai_grading', 'release_model_answers'].includes(
          command.operation,
        ),
      });
    }
  }
  const result = await examinationRpc(env, 'examination_command', {
    p_user_id: user?.id || null,
    p_operation: command.operation,
    p_payload: command,
  });

  if (command.operation === 'request_ai_grading') {
    const state = await processExaminationAiJob(env, user, result);
    return jsonResponse({
      ok: true,
      data: {
        jobId: result.jobId,
        attemptId: result.attemptId,
        status: state?.status || 'completed',
        completedQuestions: state?.completedQuestions || 0,
        questionCount: state?.questionCount || 0,
        modelsReleased: state?.modelsReleased === true,
        modelAnswerEmailStatus: state?.modelAnswerEmailStatus || null,
      },
    }, 200, origin, allowedOrigin);
  }

  if (command.operation === 'create_examiner_assignment') {
    const assignmentUrl = `${allowedOrigin}/?assignment=${encodeURIComponent(
      command.assignmentToken,
    )}#examiner-review`;
    const delivery = await sendExaminationEmail(env, {
      recipient: command.examinerEmail,
      subject: 'Due Diligence Human Examiner Review invitation',
      text: [
        'You have been invited to review a submitted Due Diligence examination.',
        '',
        `Secure assignment link (expires ${result.expiresAt}):`,
        assignmentUrl,
        '',
        'The email contains no student answer or model answer. Open the secure link to review.',
      ].join('\n'),
    });
    await examinationRpc(env, 'examination_record_delivery', {
      p_actor_user_id: user.id,
      p_target_type: 'examiner_invitation',
      p_target_id: result.assignmentId,
      p_status: delivery.status,
      p_provider_id: delivery.providerId || null,
      p_safe_error_code: delivery.safeErrorCode || null,
    });
    result.invitationStatus = delivery.status;
  }

  if (command.operation === 'delete_upload' && result?.objectPath) {
    result.storageDeleted = await deletePrivateExamination(env, result.objectPath);
    delete result.objectPath;
  }

  return jsonResponse(
    { ok: true, data: result },
    ['start_attempt', 'create_examiner_assignment'].includes(command.operation) ? 201 : 200,
    origin,
    allowedOrigin,
  );
}

async function handleExaminationUpload(request, env, origin, allowedOrigin) {
  await enforceExaminationRateLimit(request, env, true);
  const user = await requireAuthenticatedUser(request, env);
  await authorizeExaminationAccess(env, user.id, { track: 'bar_feels' });
  const raw = await parseBoundedJson(request, EXAMINATION_LIMITS.maximumJsonBytes);
  const upload = normalizeUploadRequest(raw);
  const contentHash = await sha256Hex(upload.bytes);
  const objectPath = `${user.id}/${contentHash}/${upload.fileName}`;
  const questions = await extractUploadedQuestions(upload.bytes, upload.mimeType);
  const stored = await uploadPrivateExamination(
    env,
    objectPath,
    upload.bytes,
    upload.mimeType,
  );
  try {
    const result = await examinationRpc(env, 'examination_register_upload', {
      p_user_id: user.id,
      p_object_path: objectPath,
      p_safe_file_name: upload.fileName,
      p_mime_type: upload.mimeType,
      p_size_bytes: upload.bytes.length,
      p_content_hash: contentHash,
      p_extracted_questions: questions,
      p_request_key: upload.requestKey,
    });
    return jsonResponse({
      ok: true,
      data: {
        uploadId: result.uploadId,
        publicId: result.publicId,
        status: result.status,
        fileName: result.fileName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        questionCount: result.questionCount,
        questions: result.questions,
        retentionUntil: result.retentionUntil,
        gradingRoute: upload.gradingRoute,
        timerMode: upload.timerMode,
        durationSeconds: upload.durationSeconds,
        title: upload.title,
      },
    }, 201, origin, allowedOrigin);
  } catch (error) {
    if (stored.created) await deletePrivateExamination(env, objectPath);
    throw error;
  }
}

async function handleExaminationAdmin(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const raw = await parseBoundedJson(request, 120_000);
  const command = normalizeExaminationAdmin(raw);
  const result = await examinationRpc(env, 'examination_admin', {
    p_actor_user_id: user.id,
    p_operation: command.operation,
    p_payload: command,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function fetchPublishedCsv(url, label) {
  const response = await fetch(url, {
    headers: { Accept: 'text/csv' },
  });
  if (!response.ok) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_UNAVAILABLE',
      `${label} could not be loaded from the reviewed publication.`,
      503,
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 5_000_000) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_TOO_LARGE',
      `${label} exceeds the reviewed publication limit.`,
    );
  }
  return text;
}

async function fetchAuthenticatedSubjectMatterCsv(env) {
  const token = await googleAccessToken(env, fetch);
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SUBJECT_MATTER_SPREADSHEET_ID)}/values/${encodeURIComponent(SUBJECT_MATTER_SHEET_RANGE)}`,
  );
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new ReleaseContentError(
      'AUTHENTICATED_SOURCE_UNAVAILABLE',
      'Subject Matter could not be loaded from the reviewed spreadsheet.',
      503,
    );
  }
  const body = await response.json().catch(() => null);
  return sheetValuesToCsv(body?.values);
}

async function loadSubjectMatterSource(env) {
  try {
    return await parseSubjectMatterSource(await fetchAuthenticatedSubjectMatterCsv(env));
  } catch {
    // The reviewed, versioned snapshot is the deterministic release fallback
    // when the editorial Google account is unavailable to the Worker identity.
    return parseSubjectMatterSource(subjectMatterReleaseSnapshotCsv());
  }
}

async function handleReleaseContentSync(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const [subjectSource, websiteCsv] = await Promise.all([
    loadSubjectMatterSource(env),
    fetchPublishedCsv(WEBSITE_UPLOAD_CSV_URL, 'Mock Bar source'),
  ]);
  const websiteSource = await parseWebsiteUploadSource(websiteCsv);
  const subjectPlacementManifest = buildSubjectMatterPlacements(subjectSource.rows);
  const barGroups = buildBarFeelsManifest(websiteSource.rows);
  const syncId = crypto.randomUUID();
  const stageParts = async (kind, records, partSize) => {
    const totalParts = Math.ceil(records.length / partSize);
    for (let offset = 0; offset < records.length; offset += partSize) {
      await examinationRpc(env, 'release_stage_subject_matter_v2', {
        p_actor_user_id: user.id,
        p_sync_id: syncId,
        p_payload_kind: kind,
        p_part_number: Math.floor(offset / partSize) + 1,
        p_total_parts: totalParts,
        p_payload: records.slice(offset, offset + partSize),
        p_source_digest: subjectSource.digest,
        p_source_endpoint: SUBJECT_MATTER_CSV_URL,
        p_placement_digest: subjectPlacementManifest.digest,
      });
    }
  };
  // Bounded chunks stay backend-only. The final RPC performs the only catalog-
  // visible transaction after every source and placement part is present.
  await stageParts('rows', subjectSource.rows, 100);
  await stageParts('placements', subjectPlacementManifest.placements, 200);
  const result = await examinationRpc(env, 'release_finalize_all_content_v2', {
    p_actor_user_id: user.id,
    p_sync_id: syncId,
    p_bar_groups: barGroups,
    p_bar_digest: websiteSource.digest,
    p_bar_endpoint: WEBSITE_UPLOAD_CSV_URL,
  });
  // Never echo question or answer content from the administrative sync.
  return jsonResponse({
    ok: true,
    data: {
      subjectMatter: result?.subjectMatter || null,
      barFeels: result?.barFeels || null,
      sources: {
        subjectMatter: SUBJECT_MATTER_CSV_URL,
        mockBar: WEBSITE_UPLOAD_CSV_URL,
      },
    },
  }, 200, origin, allowedOrigin);
}

async function handlePrivateBetaCodeVerification(
  request,
  env,
  origin,
  allowedOrigin,
) {
  const payload = await parseBoundedJson(request, 12_000);
  const disclosureVersion = privateBetaDisclosureVersion(env);
  const submittedVersion = String(payload?.disclosureVersion || '').trim();
  if (submittedVersion !== disclosureVersion
      || payload?.disclosureEndReached !== true
      || !validatePrivateBetaAcknowledgements(payload?.acknowledgements)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_DISCLOSURE_REQUIRED',
      'Complete the current Beta Disclosure before continuing.',
      400,
    );
  }

  const codeMatches = await verifyPrivateBetaAccessCode(payload?.accessCode, {
    verifier: env.PRIVATE_BETA_ACCESS_CODE_VERIFIER,
    pepper: env.PRIVATE_BETA_ACCESS_CODE_PEPPER,
  });
  const rateSubjects = await privateBetaRateSubjectHashes(request, env);
  const rateResult = await phase4Rpc(
    env,
    'private_beta_evaluate_code_attempt',
    {
      p_flow_hash: rateSubjects.flowHash,
      p_network_hash: rateSubjects.networkHash,
      p_code_valid: codeMatches,
    },
  );
  if (rateResult?.allowed !== true) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_ACCESS_DENIED',
      'Private-beta access could not be verified. Review the access details and try again later.',
      rateResult?.blocked === true ? 429 : 401,
    );
  }

  const pending = await createPrivateBetaToken({
    type: 'pending',
    disclosureVersion,
    lifetimeSeconds: PRIVATE_BETA_PENDING_SECONDS,
  }, env.PRIVATE_BETA_FLOW_SIGNING_KEY);

  return jsonResponse({
    ok: true,
    pending: {
      token: pending.token,
      disclosureVersion,
      expiresAt: new Date(pending.payload.exp * 1000).toISOString(),
    },
  }, 200, origin, allowedOrigin);
}

async function handlePrivateBetaAdmissionCompletion(
  request,
  env,
  origin,
  allowedOrigin,
) {
  const user = await requireAuthenticatedUser(request, env);
  const payload = await parseBoundedJson(request, 16_000);
  const disclosureVersion = privateBetaDisclosureVersion(env);
  if (payload?.disclosureEndReached !== true
      || !validatePrivateBetaAcknowledgements(payload?.acknowledgements)) {
    throw new PrivateBetaError(
      'PRIVATE_BETA_ACKNOWLEDGMENTS_REQUIRED',
      'Confirm all required acknowledgments to continue.',
      400,
    );
  }

  const pending = await verifyPrivateBetaToken(
    payload?.pendingToken,
    env.PRIVATE_BETA_FLOW_SIGNING_KEY,
    {
      expectedType: 'pending',
      disclosureVersion,
    },
  );
  const access = await createPrivateBetaToken({
    type: 'access',
    subject: user.id,
    disclosureVersion,
    lifetimeSeconds: PRIVATE_BETA_ACCESS_SECONDS,
  }, env.PRIVATE_BETA_FLOW_SIGNING_KEY);

  const admission = await phase4Rpc(env, 'private_beta_complete_admission', {
    p_user_id: user.id,
    p_disclosure_version: disclosureVersion,
    p_pending_jti_hash: await privateBetaSha256Hex(pending.jti),
    p_access_jti_hash: await privateBetaSha256Hex(access.payload.jti),
    p_acknowledged_ai_limitations: true,
    p_acknowledged_educational_only: true,
    p_acknowledged_terms_and_privacy: true,
  });

  return jsonResponse({
    ok: true,
    access: {
      allowed: admission?.admitted === true,
      token: access.token,
      admissionKind: admission?.admissionKind || null,
      disclosureVersion,
      expiresAt: new Date(access.payload.exp * 1000).toISOString(),
    },
  }, 200, origin, allowedOrigin);
}

async function handlePrivateBetaStatus(request, env, origin, allowedOrigin) {
  const user = await requireAuthenticatedUser(request, env);
  const globalAccess = await privateBetaAccessForUser(env, user.id);
  if (isGlobalBetaAdmission(globalAccess)) {
    return jsonResponse({ ok: true, access: globalAccess }, 200, origin, allowedOrigin);
  }
  const disclosureVersion = privateBetaDisclosureVersion(env);
  const token = privateBetaAccessToken(request);
  const payload = await verifyPrivateBetaToken(
    token,
    env.PRIVATE_BETA_FLOW_SIGNING_KEY,
    {
      expectedType: 'access',
      expectedSubject: user.id,
      disclosureVersion,
    },
  );
  const access = await privateBetaAccessForUser(env, user.id, payload.jti);
  return jsonResponse({
    ok: true,
    access: {
      allowed: access.allowed,
      admissionKind: access.admissionKind,
      disclosureVersion: access.disclosureVersion,
      expiresAt: access.expiresAt,
    },
  }, 200, origin, allowedOrigin);
}

async function handleGlobalBetaPublicPolicy(env, origin, allowedOrigin) {
  const policy = await phase4Rpc(env, 'phase4_global_beta_public_policy', {});
  return jsonResponse({
    ok: true,
    policy: { enabled: policy?.enabled === true },
  }, 200, origin, allowedOrigin);
}

async function handleAdminGlobalBetaStatus(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const policy = await protectedSupabaseRpc(
    env,
    'phase4_global_beta_policy_snapshot',
    { p_actor_user_id: user.id },
  );
  return jsonResponse({ ok: true, policy }, 200, origin, allowedOrigin);
}

async function handleAdminGlobalBetaChange(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let change;
  try {
    change = normalizeGlobalBetaChange(await parseBoundedJson(request, 4_000));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_ACTION', error.message, 400);
    }
    throw error;
  }
  const policy = await protectedSupabaseRpc(
    env,
    'phase4_admin_set_global_beta_all_access',
    {
      p_actor_user_id: user.id,
      p_enabled: change.enabled,
      p_reason: change.reason,
      p_request_key: change.requestKey,
    },
  );
  return jsonResponse({ ok: true, policy }, 200, origin, allowedOrigin);
}

async function handleAccess(request, env, origin, allowedOrigin) {
  await enforceGuestStatusRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const [access, subscriptionState] = await Promise.all([
    phase4AccessForUser(env, user.id),
    phase4Rpc(env, 'phase4_user_subscription_status', { p_user_id: user.id }),
  ]);
  access.subscriptionState = subscriptionState || {
    subscription: access.subscription,
    pendingPayment: null,
  };
  if (!publicPricingEnabled(env)) {
    access.subscription = access.subscription
      ? {
          status: access.subscription.status || null,
          startsAt: access.subscription.startsAt || null,
          expiresAt: access.subscription.expiresAt || null,
        }
      : null;
    access.subscriptionState = concealedSubscriptionState(access.subscriptionState);
    access.pricingHidden = true;
    access.pricingMessage = 'Pricing will be announced after beta testing.';
  }
  return jsonResponse({ ok: true, access }, 200, origin, allowedOrigin);
}

async function handleProtectedQuestion(request, env, origin, allowedOrigin) {
  await enforceRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const payload = await parseBoundedJson(request, 12_000);
  const subject = normalizeSubject(payload?.subject);
  const requestKey = normalizeRequestKey(
    payload?.requestId || request.headers.get('X-Request-ID'),
  );
  const access = await phase4AccessForUser(env, user.id, {
    activateTrial: true,
    requestKey,
  });
  if (!access.allowed) throw accessDeniedError(access);

  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  const question = selectProtectedQuestion(records, {
    subject,
    questionId: payload?.questionId,
    excludeQuestionIds: payload?.excludeQuestionIds,
  });
  return jsonResponse({
    ok: true,
    access,
    question,
    inventory: {
      subjects: 8,
      questionsPerSubject: 40,
      totalQuestions: 320,
    },
  }, 200, origin, allowedOrigin);
}

async function handleUnansweredAttempt(request, env, origin, allowedOrigin) {
  await enforceRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const payload = await parseBoundedJson(request, 8_000);
  const questionId = String(payload?.questionId || '').trim();
  const subject = normalizeSubject(payload?.subject);
  const requestKey = normalizeRequestKey(
    payload?.requestId || request.headers.get('X-Request-ID'),
  );
  const elapsedSeconds = Math.floor(Number(payload?.elapsedSeconds) || 0);
  if (!/^[A-Z]{2,8}-(?:\d{3}|\d{4}-Q\d{1,3})$/i.test(questionId)) {
    throw new ExaminerError('INVALID_QUESTION', 'A valid protected question is required.', 400);
  }
  if (elapsedSeconds < 720 || elapsedSeconds > 86_400) {
    throw new ExaminerError('INVALID_TIMER_STATE', 'The Strict Scrutiny expiration state is invalid.', 400);
  }

  const access = await phase4AccessForUser(env, user.id);
  if (!access.allowed) throw accessDeniedError(access);
  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  const context = questionFromBankRow(records.get(questionId));
  if (!context?.question || normalizeSubject(context.subject) !== subject) {
    throw new ExaminerError('INVALID_QUESTION', 'The protected question could not be verified.', 400);
  }

  const result = await phase4Rpc(env, 'phase4_record_unanswered_attempt', {
    p_user_id: user.id,
    p_request_key: requestKey,
    p_question_bank_id: questionId,
    p_subject: context.subject,
    p_elapsed_seconds: elapsedSeconds,
  });
  return jsonResponse({
    ok: true,
    attempt: {
      id: String(result?.attemptId || ''),
      status: 'unanswered',
      replayed: result?.replayed === true,
      questionId,
      subject: context.subject,
      timerMode: 'strict',
      elapsedSeconds,
      submissionReason: 'strict_expiry',
      expired: true,
    },
  }, 201, origin, allowedOrigin);
}

async function handleExamHistory(request, env, origin, allowedOrigin) {
  await enforceGuestStatusRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(payload?.limit) || 100)));
  const offset = Math.min(10_000, Math.max(0, Math.floor(Number(payload?.offset) || 0)));
  const result = await phase4Rpc(env, 'phase4_exam_history', {
    p_user_id: user.id,
    p_limit: limit,
    p_offset: offset,
  });
  return jsonResponse({ ok: true, history: result }, 200, origin, allowedOrigin);
}

async function handleGuestAccess(request, env, origin, allowedOrigin) {
  if (phase4AccessEnforced(env)) {
    return handleAccess(request, env, origin, allowedOrigin);
  }
  await enforceGuestStatusRateLimit(request, env);
  const access = await guestAccessStatus(request, env);
  return jsonResponse({
    ok: true,
    access: {
      signedIn: access.signedIn,
      guest: access.signedIn ? null : access.usage,
    },
  }, 200, origin, allowedOrigin);
}

async function handleCorrection(request, env, origin, allowedOrigin) {
  await enforceCorrectionRateLimit(request, env);
  const correctionUser = await requireAuthenticatedSubmission(
    request,
    env,
    'suggesting a correction or better answer',
  );
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > CORRECTION_LIMITS.requestBytes) {
    throw new ExaminerError('INVALID_CORRECTION', 'The correction request is too large.', 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > CORRECTION_LIMITS.requestBytes) {
    throw new ExaminerError('INVALID_CORRECTION', 'The correction request is too large.', 413);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The correction request contains invalid JSON.');
  }

  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  let correction;
  try {
    correction = normalizeCorrectionRequest(payload, records.get(String(payload?.questionId || '').trim()));
  } catch (error) {
    if (error instanceof CorrectionValidationError) {
      throw new ExaminerError(error.code, error.message, 400);
    }
    throw error;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ExaminerError(
      'CORRECTIONS_NOT_CONFIGURED',
      'Correction submissions are temporarily unavailable.',
      503,
    );
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL);
  } catch {
    throw new ExaminerError(
      'CORRECTIONS_NOT_CONFIGURED',
      'Correction submissions are temporarily unavailable.',
      503,
    );
  }
  if (supabaseUrl.protocol !== 'https:') {
    throw new ExaminerError(
      'CORRECTIONS_NOT_CONFIGURED',
      'Correction submissions are temporarily unavailable.',
      503,
    );
  }

  const insertResponse = await fetch(
    new URL('/rest/v1/question_corrections', supabaseUrl),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ...correctionInsertRecord(correction),
        user_id: correctionUser?.id || null,
      }),
    },
  );

  if (!insertResponse.ok) {
    console.error('Correction storage request failed', { status: insertResponse.status });
    throw new ExaminerError(
      'CORRECTION_SUBMISSION_FAILED',
      'Suggest a Correction/Better Answer could not be submitted. Please try again.',
      502,
    );
  }

  await sendSupportNotification(env, {
    subject: 'Due Diligence answer correction report',
    text: [
      'An answer correction report was submitted.',
      `Reporter: ${correctionUser?.email || 'Signed-in member'}`,
      `Question: ${correction.questionId}`,
      `Subject: ${correction.subject}`,
      `Report type: ${correction.correctionType}`,
      '',
      'Proposed correction:',
      correction.proposedCorrection,
      '',
      'Explanation:',
      correction.explanation,
      '',
      'Supporting sources:',
      correction.sourceUrls.length ? correction.sourceUrls.join('\n') : 'None provided',
    ].join('\n'),
    replyTo: correctionUser?.email,
    adminPath: '/admin/',
  });

  return jsonResponse({
    ok: true,
    message: 'Suggest a Correction/Better Answer submitted successfully.',
  }, 201, origin, allowedOrigin);
}

async function handleSupport(request, env, origin, allowedOrigin) {
  await enforceSupportRateLimit(request, env);
  const supportUser = await requireAuthenticatedSubmission(
    request,
    env,
    'sending a Support request',
  );
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > SUPPORT_LIMITS.requestBytes) {
    throw new ExaminerError('INVALID_SUPPORT_REQUEST', 'The support request is too large.', 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > SUPPORT_LIMITS.requestBytes) {
    throw new ExaminerError('INVALID_SUPPORT_REQUEST', 'The support request is too large.', 413);
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The support request contains invalid JSON.');
  }
  let supportRequest;
  try {
    supportRequest = normalizeSupportRequest(payload);
  } catch (error) {
    if (error instanceof SupportValidationError) {
      throw new ExaminerError(error.code, error.message, 400);
    }
    throw error;
  }

  const supabaseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL('/rest/v1/support_requests', supabaseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      ...supportInsertRecord(supportRequest),
      user_id: supportUser?.id || null,
    }),
  });
  if (!response.ok) {
    console.error('Support storage request failed', { status: response.status });
    throw new ExaminerError(
      'SUPPORT_SUBMISSION_FAILED',
      'Your support request could not be submitted. Please try again.',
      502,
    );
  }
  await sendSupportNotification(env, {
    subject: 'Due Diligence Support request',
    text: [
      'A Support request was submitted.',
      `Account: ${supportUser?.email || 'Signed-in member'}`,
      `Category: ${supportRequest.category}`,
      `Reply email: ${supportRequest.replyEmail || supportUser?.email || 'Not provided'}`,
      '',
      'Message:',
      supportRequest.message,
    ].join('\n'),
    replyTo: supportRequest.replyEmail || supportUser?.email,
    adminPath: '/admin/',
  });
  return jsonResponse({
    ok: true,
    message: 'Your support request was received.',
  }, 201, origin, allowedOrigin);
}

async function parseBoundedJson(request, maximumBytes = 20_000) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ExaminerError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    throw new ExaminerError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The request contains invalid JSON.', 400);
  }
}

async function requireAdministrator(request, env) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) throw new ExaminerError('ADMIN_SIGN_IN_REQUIRED', 'Administrator sign-in is required.', 401);
  return user;
}

async function handleAnalytics(request, env, origin, allowedOrigin) {
  await enforceAnalyticsRateLimit(request, env);
  const payload = await parseBoundedJson(request, 12_000);
  let event;
  try {
    event = normalizeAnalyticsEvent(payload);
  } catch (error) {
    if (error instanceof AnalyticsValidationError) {
      throw new ExaminerError('INVALID_ANALYTICS_EVENT', error.message, 400);
    }
    throw error;
  }
  const user = await verifiedAuthenticatedUser(request, env);
  const result = await protectedSupabaseRpc(
    env,
    'record_usage_event',
    analyticsRpcPayload(event, user?.id || null),
  );
  return jsonResponse({ ok: true, accepted: Boolean(result?.accepted) }, 202, origin, allowedOrigin);
}

async function handleAdminSession(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const result = await protectedSupabaseRpc(env, 'admin_authorization_context', {
    p_actor_user_id: user.id,
  });
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const authenticatedAt = Number(user.stepUpAuthenticatedAt);
  const freshAal2 = user.authenticationLevel === 'aal2'
    && Boolean(user.authenticationSessionId)
    && Number.isSafeInteger(authenticatedAt)
    && authenticatedAt > 0
    && authenticatedAt <= nowSeconds + 60
    && nowSeconds - authenticatedAt <= 15 * 60;
  const featureEnabled = String(env.EXAMINATION_ROOM_ENABLED || '').toLowerCase() === 'true'
    && String(env.EXAMINATION_ROOM_2_ENABLED || '').toLowerCase() === 'true';
  return jsonResponse({
    ok: true,
    ...result,
    examinationRoomBreakGlass: {
      contractVersion: 'exam-room-break-glass-v2',
      featureEnabled,
      adminAuthorized: true,
      authenticationLevel: user.authenticationLevel,
      freshAal2,
      requiresFreshAal2: true,
      maximumStepUpAgeSeconds: 15 * 60,
      stepUpExpiresAt: Number.isSafeInteger(authenticatedAt) && authenticatedAt > 0
        ? new Date((authenticatedAt + 15 * 60) * 1_000).toISOString()
        : null,
      canIssue: featureEnabled && freshAal2,
      canView: featureEnabled && freshAal2,
      canClose: featureEnabled && freshAal2,
      canRecordReview: featureEnabled && freshAal2,
    },
  }, 200, origin, allowedOrigin);
}

async function handleAdminDashboard(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let report;
  try {
    report = normalizeDashboardRequest(await parseBoundedJson(request));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const dashboardSnapshot = await protectedSupabaseRpc(env, 'admin_dashboard_snapshot', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
  });
  let engagement = null;
  try {
    engagement = await protectedSupabaseRpc(env, 'admin_overview_engagement_metrics', {
      p_actor_user_id: user.id,
    });
  } catch {
    engagement = {
      available: false,
      definition: 'All-time signed-in-account and persisted-answer metrics are temporarily unavailable.',
    };
  }
  let betaAllAccess = null;
  try {
    betaAllAccess = await protectedSupabaseRpc(env, 'phase4_global_beta_policy_snapshot', {
      p_actor_user_id: user.id,
    });
  } catch {
    betaAllAccess = {
      available: false,
      enabled: null,
      definition: 'The global Beta All Access policy is temporarily unavailable.',
    };
  }
  const result = {
    ...(dashboardSnapshot || {}),
    engagement: engagement || null,
    betaAllAccess,
  };
  try {
    const bank = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
    const subjects = new Set(Array.from(bank.values()).map((row) => String(row.Subject || row.subject || '').trim()).filter(Boolean));
    result.inventory = {
      ...(result.inventory || {}),
      public_question_bank: bank.size,
      public_subjects: subjects.size,
      source: 'Published Website Upload question bank',
    };
  } catch {
    result.inventory = {
      ...(result.inventory || {}),
      public_question_bank: null,
      public_subjects: null,
      source: 'Published question bank temporarily unavailable',
    };
  }
  return jsonResponse({ ok: true, report: result }, 200, origin, allowedOrigin);
}

async function handleAdminData(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let query;
  try {
    query = normalizeOperationalRequest(await parseBoundedJson(request));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_operational_data', {
    p_actor_user_id: user.id,
    p_section: query.section,
    p_search: query.search,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function adminUserDirectoryResult(request, env, accessPurpose) {
  const user = await requireAdministrator(request, env);
  let query;
  try {
    query = normalizeUserDirectoryRequest(
      await parseBoundedJson(request, 4_000),
      accessPurpose,
    );
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  return protectedSupabaseRpc(env, 'admin_user_engagement_directory', {
    p_actor_user_id: user.id,
    p_search: query.search,
    p_limit: query.limit,
    p_offset: query.offset,
    p_request_key: query.requestKey,
    p_access_purpose: query.accessPurpose,
  });
}

async function handleAdminUserDirectory(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const result = await adminUserDirectoryResult(request, env, 'dashboard');
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminUserDirectoryExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const result = await adminUserDirectoryResult(request, env, 'csv_export');
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'The directory contains more than 5,000 matching users. Narrow the search before exporting.',
      422,
    );
  }
  return new Response(withUtf8Bom(userDirectoryCsv(result?.items)), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="due-diligence-users.csv"',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleAdminSubscriptionsExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const result = await adminUserDirectoryResult(request, env, 'csv_export');
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'More than 5,000 subscriptions match this request. Narrow the search before downloading.',
      422,
    );
  }
  return new Response(withUtf8Bom(subscriptionDirectoryCsv(result?.items)), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="due-diligence-subscriptions.csv"',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleAdminLiveActivity(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let query;
  try {
    query = normalizeLiveActivityRequest(await parseBoundedJson(request, 2_000));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_live_activity', {
    p_actor_user_id: user.id,
    p_limit: query.limit,
    p_request_key: query.requestKey,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminQuorumPosts(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let query;
  try {
    query = normalizeQuorumPostsRequest(await parseBoundedJson(request, 4_000));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_quorum_posts', {
    p_actor_user_id: user.id,
    p_search: query.search,
    p_status: query.status,
    p_limit: query.limit,
    p_offset: query.offset,
    p_request_key: query.requestKey,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminUserDirectoryEmail(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let exportRequest;
  try {
    exportRequest = normalizeUserDirectoryEmailExport(
      await parseBoundedJson(request, 4_000),
    );
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const recipient = resolveAdminDirectoryRecipient(
    env.ADMIN_DIRECTORY_RECIPIENTS_JSON,
    exportRequest.recipientKey,
  );
  if (!recipient) {
    throw new ExaminerError(
      'ADMIN_EMAIL_NOT_CONFIGURED',
      'The approved Founder recipient is not configured for private exports.',
      503,
    );
  }
  const result = await protectedSupabaseRpc(
    env,
    'admin_prepare_user_directory_email_export',
    {
      p_actor_user_id: user.id,
      p_search: exportRequest.search,
      p_limit: exportRequest.limit,
      p_recipient_key: exportRequest.recipientKey,
      p_reason: exportRequest.reason,
      p_request_key: exportRequest.requestKey,
    },
  );
  if (result?.alreadyPrepared === true) {
    throw new ExaminerError(
      'ADMIN_EXPORT_ALREADY_PROCESSED',
      'This private email request was already processed. Start a new request to send another copy.',
      409,
    );
  }
  const items = Array.isArray(result?.items) ? result.items : [];
  let delivery;
  if (result?.tooMany) {
    delivery = { status: 'failed', safeErrorCode: 'result_limit_exceeded' };
  } else {
    const csv = withUtf8Bom(userDirectoryCsv(items));
    if (new TextEncoder().encode(csv).byteLength > ADMIN_DIRECTORY_EXPORT_MAX_BYTES) {
      delivery = { status: 'failed', safeErrorCode: 'attachment_too_large' };
    } else {
      delivery = await sendAdminDirectoryEmail(env, {
        recipient,
        csv,
        filename: 'due-diligence-private-user-directory.csv',
        requestKey: exportRequest.requestKey,
        resultCount: items.length,
      });
    }
  }
  await protectedSupabaseRpc(env, 'admin_record_user_directory_email_delivery', {
    p_actor_user_id: user.id,
    p_recipient_key: exportRequest.recipientKey,
    p_status: delivery.status,
    p_provider_id: delivery.providerId || null,
    p_safe_error_code: delivery.safeErrorCode || null,
    p_result_count: items.length,
    p_reason: exportRequest.reason,
    p_request_key: exportRequest.requestKey,
  });
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'The directory contains more than 5,000 matching users. Narrow the search before emailing it.',
      422,
    );
  }
  if (delivery.safeErrorCode === 'attachment_too_large') {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'The private directory attachment is too large. Narrow the search before emailing it.',
      422,
    );
  }
  if (delivery.status !== 'sent') {
    throw new ExaminerError(
      delivery.status === 'not_configured'
        ? 'ADMIN_EMAIL_NOT_CONFIGURED'
        : 'ADMIN_EMAIL_DELIVERY_FAILED',
      delivery.status === 'not_configured'
        ? 'Private Founder email delivery is not configured.'
        : 'The private directory email could not be delivered.',
      delivery.status === 'not_configured' ? 503 : 502,
    );
  }
  return jsonResponse({
    ok: true,
    delivery: {
      status: 'sent',
      recipientKey: exportRequest.recipientKey,
      resultCount: items.length,
    },
  }, 200, origin, allowedOrigin);
}

async function handleAdminAnswerHistoryPreview(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  let previewRequest;
  try {
    previewRequest = normalizeAnswerHistoryPreviewRequest({
      ...payload,
      requestKey: crypto.randomUUID().replace(/-/g, ''),
    });
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_preview_answer_history_with_sources', {
    p_actor_user_id: user.id,
    p_target_user_id: previewRequest.targetUserId,
    p_from: previewRequest.from,
    p_to: previewRequest.to,
    p_search: previewRequest.search,
    p_record_source: previewRequest.recordSource,
    p_limit: previewRequest.limit,
    p_offset: previewRequest.offset,
    p_request_key: previewRequest.requestKey,
  });
  const items = await enrichAdminAnswerHistory(result?.items, env);
  return jsonResponse({
    ok: true,
    data: {
      items,
      total: Number(result?.total) || items.length,
      limit: Number(result?.limit) || previewRequest.limit,
      offset: Number(result?.offset) || 0,
      hasMore: result?.hasMore === true,
      tooMany: false,
      scope: result?.scope || 'all_users',
      dateScope: result?.dateScope || 'all_time',
    },
  }, 200, origin, allowedOrigin);
}

async function handleAdminAnswerHistoryExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let exportRequest;
  try {
    exportRequest = normalizeAnswerHistoryRequest(
      await parseBoundedJson(request, 4_000),
      'csv_export',
    );
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_export_answer_history_with_sources', {
    p_actor_user_id: user.id,
    p_target_user_id: exportRequest.targetUserId,
    p_from: exportRequest.from,
    p_to: exportRequest.to,
    p_limit: exportRequest.limit,
    p_reason: exportRequest.reason,
    p_request_key: exportRequest.requestKey,
  });
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'More than 5,000 persisted answers match this request. Narrow the date range or select one user.',
      422,
    );
  }
  const items = await enrichAdminAnswerHistory(result?.items, env);
  const scope = result?.scope === 'single_user' && exportRequest.targetUserId
    ? `user-${exportRequest.targetUserId}`
    : 'all-users';
  return new Response(withUtf8Bom(answerHistoryCsv(items)), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="due-diligence-answer-history-${scope}.csv"`,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleAdminAction(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let action;
  try {
    action = normalizeAdminAction(await parseBoundedJson(request));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_ACTION', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_execute_action', {
    p_actor_user_id: user.id,
    p_action: action.action,
    p_target_id: action.targetId,
    p_payload: action.payload,
    p_reason: action.reason,
    p_request_key: action.requestKey,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminEmailReveal(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  const targetUserId = String(payload?.targetUserId || '');
  const reason = String(payload?.reason || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || reason.length < 5 || reason.length > 1000) {
    throw new ExaminerError('INVALID_ADMIN_ACTION', 'A valid user and reason are required.', 400);
  }
  const result = await protectedSupabaseRpc(env, 'admin_reveal_user_email', {
    p_actor_user_id: user.id,
    p_target_user_id: targetUserId,
    p_reason: reason,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminEmailSearch(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  const email = String(payload?.email || '').trim().toLowerCase();
  const reason = String(payload?.reason || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || reason.length < 5 || reason.length > 1000) {
    throw new ExaminerError('INVALID_ADMIN_ACTION', 'A valid exact email and reason are required.', 400);
  }
  const result = await protectedSupabaseRpc(env, 'admin_find_user_by_email', {
    p_actor_user_id: user.id,
    p_email: email,
    p_reason: reason,
  });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let report;
  try {
    report = normalizeDashboardRequest(await parseBoundedJson(request));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const snapshot = await protectedSupabaseRpc(env, 'admin_dashboard_snapshot', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
  });
  await protectedSupabaseRpc(env, 'admin_execute_action', {
    p_actor_user_id: user.id,
    p_action: 'aggregate_export',
    p_target_id: null,
    p_payload: { aggregate_only: true },
    p_reason: 'Authorized aggregate business report export',
    p_request_key: crypto.randomUUID().replace(/-/g, ''),
  });
  return new Response(aggregateCsv(snapshot), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="due-diligence-aggregate-report.csv"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleAdminUserResponsesExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let exportRequest;
  try {
    exportRequest = normalizeUserResponseExport(await parseBoundedJson(request, 6_000));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_EXPORT', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_export_answer_history_with_sources', {
    p_actor_user_id: user.id,
    p_target_user_id: exportRequest.targetUserId,
    p_from: exportRequest.from,
    p_to: exportRequest.to,
    p_limit: exportRequest.limit,
    p_reason: exportRequest.reason,
    p_request_key: exportRequest.requestKey,
  });
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'This user has more than 2,000 responses in the selected period. Choose a shorter date range.',
      422,
    );
  }

  const items = await enrichAdminAnswerHistory(result?.items, env);
  const filename = `due-diligence-user-${exportRequest.targetUserId}-questions-answers.csv`;
  return new Response(withUtf8Bom(answerHistoryCsv(items)), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handlePlans(request, env, origin, allowedOrigin) {
  if (!publicPricingEnabled(env)) {
    return jsonResponse({
      ok: true,
      plans: [],
      betaAccessActive: true,
      pricingHidden: true,
      message: 'Pricing will be announced after beta testing.',
    }, 200, origin, allowedOrigin);
  }
  const plans = await phase4Rpc(env, 'phase4_plan_catalog', {});
  return jsonResponse({ ok: true, plans: Array.isArray(plans) ? plans : [] }, 200, origin, allowedOrigin);
}

async function handlePaymentSubmit(request, env, origin, allowedOrigin) {
  if (!publicPricingEnabled(env)) {
    throw new PaymentValidationError(
      'BETA_PRICING_NOT_PUBLISHED',
      'Pricing will be announced after beta testing.',
      403,
    );
  }
  await enforcePaymentRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > PAYMENT_LIMITS.maxProofBytes + 100_000) {
    throw new PaymentValidationError(
      'PAYMENT_REQUEST_TOO_LARGE',
      'Payment proof exceeds the 6 MiB limit.',
      413,
    );
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new PaymentValidationError(
      'INVALID_PAYMENT',
      'Submit payment details and one payment-proof file.',
    );
  }
  const fields = normalizePaymentFields({
    planCode: form.get('planCode'),
    amountPhp: form.get('amountPhp'),
    paymentMethod: form.get('paymentMethod'),
    paymentDate: form.get('paymentDate'),
    transactionReference: form.get('transactionReference'),
    note: form.get('note'),
  });
  const requestKey = normalizeRequestKey(request.headers.get('X-Request-ID'));
  const proof = form.get('proof');
  if (!proof || typeof proof.arrayBuffer !== 'function') {
    throw new PaymentValidationError('PAYMENT_PROOF_REQUIRED', 'Upload a PNG, JPEG, or PDF payment proof.');
  }
  const originalName = String(proof.name || 'payment-proof').trim();
  const mimeType = String(proof.type || '').toLowerCase();
  const extension = proofExtension(originalName, mimeType);
  const arrayBuffer = await proof.arrayBuffer();
  const bytes = validateProofSignature(new Uint8Array(arrayBuffer), mimeType);
  const proofSha256 = await sha256Hex(bytes);
  const objectId = crypto.randomUUID();
  const objectPath = `${user.id}/${objectId}.${extension}`;
  await uploadPrivateProof(env, objectPath, bytes, mimeType);
  let result;
  try {
    result = await commerceRpc(env, 'phase4_create_payment_request', {
      p_user_id: user.id,
      p_plan_code: fields.planCode,
      p_amount_php: fields.amountPhp,
      p_payment_method: fields.paymentMethod,
      p_payment_date: fields.paymentDate,
      p_transaction_reference: fields.transactionReference,
      p_student_note: fields.note,
      p_proof_object_path: objectPath,
      p_proof_original_name: originalName.slice(0, 180),
      p_proof_mime_type: mimeType,
      p_proof_size_bytes: bytes.byteLength,
      p_proof_sha256: proofSha256,
      p_request_key: requestKey,
    });
  } catch (error) {
    await deletePrivateProof(env, objectPath);
    throw error;
  }
  if (result?.replayed) await deletePrivateProof(env, objectPath);
  await sendSecureNotification(env, {
    mailbox: 'plansandpricing@duediligence.ph',
    subject: 'Due Diligence payment verification request',
    adminPath: `/admin/payments?request=${encodeURIComponent(result.id)}`,
  });
  return jsonResponse({
    ok: true,
    payment: result,
    message: 'Payment proof submitted for Founder verification. Access begins only after approval.',
  }, 201, origin, allowedOrigin);
}

async function handleBillingStatus(request, env, origin, allowedOrigin) {
  const user = await requireAuthenticatedUser(request, env);
  const result = await commerceRpc(env, 'phase4_student_billing_snapshot', {
    p_user_id: user.id,
  });
  if (!publicPricingEnabled(env)) {
    return jsonResponse({
      ok: true,
      billing: concealedSubscriptionState(result),
    }, 200, origin, allowedOrigin);
  }
  return jsonResponse({ ok: true, billing: result }, 200, origin, allowedOrigin);
}

async function handleRefundSubmit(request, env, origin, allowedOrigin) {
  if (!publicPricingEnabled(env)) {
    throw new PaymentValidationError(
      'BETA_PRICING_NOT_PUBLISHED',
      'Account assistance remains available through Support during beta testing.',
      403,
    );
  }
  await enforcePaymentRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const input = normalizeRefundRequest(await parseBoundedJson(request, 8_000));
  const requestKey = normalizeRequestKey(request.headers.get('X-Request-ID'));
  const result = await commerceRpc(env, 'phase4_create_refund_request', {
    p_user_id: user.id,
    p_payment_request_id: input.paymentRequestId,
    p_reason: input.reason,
    p_request_key: requestKey,
  });
  await sendSecureNotification(env, {
    mailbox: 'plansandpricing@duediligence.ph',
    subject: 'Due Diligence refund review request',
    adminPath: `/admin/refunds?request=${encodeURIComponent(result.id)}`,
  });
  return jsonResponse({
    ok: true,
    refund: result,
    message: 'Refund request received. Initial response target: 24 hours.',
  }, 201, origin, allowedOrigin);
}

async function handlePartnershipSubmit(request, env, origin, allowedOrigin) {
  await enforcePartnershipRateLimit(request, env);
  const user = await requireAuthenticatedSubmission(
    request,
    env,
    'sending a Partnership inquiry',
  );
  const input = normalizePartnershipRequest(await parseBoundedJson(request, 12_000));
  const requestKey = normalizeRequestKey(request.headers.get('X-Request-ID'));
  const result = await commerceRpc(env, 'phase4_create_partnership_inquiry', {
    p_user_id: user?.id || null,
    p_inquiry_type: input.inquiryType,
    p_contact_name: input.contactName,
    p_contact_email: input.contactEmail,
    p_organization: input.organization,
    p_message: input.message,
    p_consent: input.consent,
    p_request_key: requestKey,
  });
  await sendSecureNotification(env, {
    mailbox: 'founders@duediligence.ph',
    subject: 'Due Diligence partnership inquiry',
    adminPath: `/admin/partnerships?inquiry=${encodeURIComponent(result.id)}`,
  });
  return jsonResponse({
    ok: true,
    inquiry: result,
    message: 'Your inquiry has been sent to the Due Diligence founders.',
  }, 201, origin, allowedOrigin);
}

async function handlePhase4AdminData(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const query = normalizePhase4AdminRequest(await parseBoundedJson(request, 8_000));
  const result = query.section === 'access'
    ? await protectedSupabaseRpc(env, 'phase4_admin_premium_access', {
      p_actor_user_id: user.id,
      p_search: query.search,
      p_status: query.premiumStatus,
      p_limit: query.limit,
      p_offset: query.offset,
    })
    : await protectedSupabaseRpc(env, 'phase4_admin_operational_data', {
      p_actor_user_id: user.id,
      p_section: query.section,
      p_search: query.search,
      p_limit: query.limit,
      p_offset: query.offset,
    });
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handlePhase4AdminAction(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const action = normalizePhase4AdminAction(await parseBoundedJson(request, 16_000));
  let result;
  if (action.action === 'payment_review') {
    result = await protectedSupabaseRpc(env, 'phase4_admin_review_payment', {
      p_actor_user_id: user.id,
      p_payment_request_id: action.targetId,
      p_payload: action.payload,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  } else if (action.action === 'subscription_audit_view') {
    result = await protectedSupabaseRpc(env, 'phase4_admin_subscription_audit', {
      p_actor_user_id: user.id,
      p_target_user_id: action.targetId,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  } else if (action.action === 'subscription_change') {
    result = await protectedSupabaseRpc(env, 'phase4_admin_manage_subscription', {
      p_actor_user_id: user.id,
      p_target_user_id: action.targetId,
      p_subscription_id: action.payload.subscriptionId || null,
      p_payload: action.payload,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  } else if (['free_beta_change', 'discount_assign'].includes(action.action)) {
    result = await protectedSupabaseRpc(env, 'phase4_admin_manage_access', {
      p_actor_user_id: user.id,
      p_action: action.action,
      p_target_user_id: action.targetId,
      p_subscription_id: action.payload.subscriptionId || null,
      p_payload: action.payload,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  } else {
    result = await protectedSupabaseRpc(env, 'phase4_admin_execute_action', {
      p_actor_user_id: user.id,
      p_action: action.action,
      p_target_id: action.targetId,
      p_payload: action.payload,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  }
  return jsonResponse({ ok: true, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminPaymentProof(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  const paymentRequestId = String(payload?.paymentRequestId || '').trim();
  const reason = String(payload?.reason || '').trim();
  const requestKey = normalizeRequestKey(request.headers.get('X-Request-ID'));
  if (!/^[0-9a-f-]{36}$/i.test(paymentRequestId) || reason.length < 5 || reason.length > 1000) {
    throw new PaymentValidationError(
      'INVALID_ADMIN_ACTION',
      'A payment request and review reason are required.',
    );
  }
  const context = await phase4Rpc(env, 'phase4_payment_proof_context', {
    p_actor_user_id: user.id,
    p_payment_request_id: paymentRequestId,
    p_reason: reason,
    p_request_key: requestKey,
  });
  const url = await signedPrivateProofUrl(env, context.objectPath);
  return jsonResponse({
    ok: true,
    proof: {
      url,
      mimeType: context.mimeType,
      sizeBytes: context.sizeBytes,
      expiresInSeconds: 300,
    },
  }, 200, origin, allowedOrigin);
}

async function processExamRoomQueues(env) {
  return processExamRoomDeliveryQueues(env, {
    rpc: (rpcEnv, functionName, body) => (
      functionName.startsWith('dd2026_')
        ? dd2026Rpc(rpcEnv, functionName, body)
        : examRoom2026Rpc(rpcEnv, functionName, body)
    ),
  });
}

async function resolveVerdictQuestion(questionId, env) {
  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  return questionFromBankRow(records.get(String(questionId || '')));
}

const dd2026Handlers = createDD2026Handlers({
  corsHeaders,
  dd2026Rpc,
  deleteExamRoomSource,
  enforceAdminRateLimit,
  enforceDD2026RateLimit,
  enforceExamRoomRateLimit,
  examRoomRpc: examRoom2026Rpc,
  jsonResponse,
  parseBoundedJson,
  processExamRoomQueues,
  requireAdministrator,
  requireAuthenticatedUser,
  resolveVerdictQuestion,
  sendExamRoomEmail: (env, message) => sendExaminationEmail(env, {
    ...message,
    examRoom: true,
  }),
  signExamRoomPaymentProof: signedPrivateProofUrl,
  structuredGemini: callGeminiStructured,
  uploadExamRoomPaymentProof: uploadPrivateProof,
  uploadExamRoomSource,
  deleteExamRoomPaymentProof: deletePrivateProof,
});

export default {
  async scheduled(_controller, env, ctx) {
    env = normalizedRuntimeSecrets(env);
    ctx.waitUntil(processExamRoomQueues(env));
  },
  async fetch(request, env, ctx) {
    env = normalizedRuntimeSecrets(env);
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://duediligence.ph';
    const requestOrigin = request.headers.get('Origin') || '';
    try {
      const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      // Resend signs this server-to-server request. It has no browser Origin and
      // must be verified before any payload is accepted or persisted.
      if (pathname === '/webhooks/resend/email') {
        return await handleResendEmailDeliveryWebhook(request, env);
      }
      const origin = assertOrigin(request, allowedOrigin);
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
      }
      if (request.method !== 'POST') {
        throw new ExaminerError('METHOD_NOT_ALLOWED', 'Only POST requests are accepted.', 405);
      }
      if (pathname === '/beta/access/policy') {
        return await handleGlobalBetaPublicPolicy(env, origin, allowedOrigin);
      }
      if (pathname === '/auth/sign-in-notification') {
        return await handleSignInNotification(request, env, origin, allowedOrigin);
      }
      if (privateBetaGateEnabled(env) && pathname === '/beta/access/verify') {
        return await handlePrivateBetaCodeVerification(
          request,
          env,
          origin,
          allowedOrigin,
        );
      }
      if (privateBetaGateEnabled(env) && pathname === '/beta/access/complete') {
        return await handlePrivateBetaAdmissionCompletion(
          request,
          env,
          origin,
          allowedOrigin,
        );
      }
      if (privateBetaGateEnabled(env) && pathname === '/beta/access/status') {
        return await handlePrivateBetaStatus(
          request,
          env,
          origin,
          allowedOrigin,
        );
      }
      if (privateBetaGateEnabled(env)
          && !(await privateBetaCapabilityExempt(request, pathname))) {
        await requirePrivateBetaAdmission(request, env);
      }
      if (pathname === '/dd2026/features') {
        return await dd2026Handlers.features(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/content/query') {
        return await dd2026Handlers.contentQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/content/item') {
        return await dd2026Handlers.contentItem(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/bar-easy/grade') {
        return await dd2026Handlers.barEasyGrade(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/doctrines/grade') {
        return await dd2026Handlers.doctrineGrade(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/verdict/pdf') {
        return await dd2026Handlers.verdictPdf(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/verdict/records') {
        return await dd2026Handlers.verdictRecords(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/verdict/archive') {
        return await dd2026Handlers.verdictArchive(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/editorial') {
        return await dd2026Handlers.editorial(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/dd2026/import') {
        return await dd2026Handlers.importContent(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/query') {
        return await dd2026Handlers.examQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/command') {
        return await dd2026Handlers.examCommand(request, env, origin, allowedOrigin, ctx);
      }
      if (pathname === '/exam-room/upload/questions') {
        return await dd2026Handlers.questionUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/upload/model-answer') {
        return await dd2026Handlers.modelAnswerUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/upload/payment-proof') {
        return await dd2026Handlers.paymentProofUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/upload/roster') {
        return await dd2026Handlers.rosterUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/results/pdf') {
        return await dd2026Handlers.examResultPdf(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam-room/results/workbook') {
        return await dd2026Handlers.examClassResultsWorkbook(request, env, origin, allowedOrigin);
      }
      if (pathname === '/corrections') {
        return await handleCorrection(request, env, origin, allowedOrigin);
      }
      if (pathname === '/guest-access') {
        return await handleGuestAccess(request, env, origin, allowedOrigin);
      }
      if (pathname === '/access') {
        return await handleAccess(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam/question') {
        return await handleProtectedQuestion(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam/unanswered') {
        return await handleUnansweredAttempt(request, env, origin, allowedOrigin);
      }
      if (pathname === '/exam/history') {
        return await handleExamHistory(request, env, origin, allowedOrigin);
      }
      if (pathname === '/plans') {
        return await handlePlans(request, env, origin, allowedOrigin);
      }
      if (pathname === '/payments/submit') {
        return await handlePaymentSubmit(request, env, origin, allowedOrigin);
      }
      if (pathname === '/payments/status') {
        return await handleBillingStatus(request, env, origin, allowedOrigin);
      }
      if (pathname === '/refunds/submit') {
        return await handleRefundSubmit(request, env, origin, allowedOrigin);
      }
      if (pathname === '/partnerships') {
        return await handlePartnershipSubmit(request, env, origin, allowedOrigin);
      }
      if (pathname === '/support') {
        return await handleSupport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/analytics/events') {
        return await handleAnalytics(request, env, origin, allowedOrigin);
      }
      if (pathname === '/examinations/query') {
        return await handleExaminationQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/examinations/command') {
        return await handleExaminationCommand(request, env, origin, allowedOrigin, ctx);
      }
      if (pathname === '/examinations/upload') {
        return await handleExaminationUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/examinations') {
        return await handleExaminationAdmin(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/content/sync') {
        return await handleReleaseContentSync(request, env, origin, allowedOrigin);
      }
      if (pathname === '/quorum/query') {
        return await handleQuorumQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/quorum/command') {
        return await handleQuorumCommand(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/quorum') {
        return await handleQuorumAdmin(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/feed') {
        return await handleForumFeed(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/comments') {
        return await handleForumComments(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/posts/create') {
        return await handleForumPostCreate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/posts/update') {
        return await handleForumPostUpdate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/posts/delete') {
        return await handleForumPostDelete(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/reactions') {
        return await handleForumReaction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/comments/create') {
        return await handleForumCommentCreate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/comments/update') {
        return await handleForumCommentUpdate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/comments/delete') {
        return await handleForumCommentDelete(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/reposts/create') {
        return await handleForumRepostCreate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/reposts/delete') {
        return await handleForumRepostDelete(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/reports') {
        return await handleForumReport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/session') {
        return await handleAdminSession(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/forum/queue') {
        return await handleForumAdminQueue(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/forum/action') {
        return await handleForumAdminAction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/dashboard') {
        return await handleAdminDashboard(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/global-beta'
          || pathname === '/admin/global-beta/status') {
        return await handleAdminGlobalBetaStatus(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/global-beta/change') {
        return await handleAdminGlobalBetaChange(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/data') {
        return await handleAdminData(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/user-directory') {
        return await handleAdminUserDirectory(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/user-directory/export') {
        return await handleAdminUserDirectoryExport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/subscriptions/export') {
        return await handleAdminSubscriptionsExport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/user-directory/email') {
        return await handleAdminUserDirectoryEmail(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/live-activity') {
        return await handleAdminLiveActivity(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/quorum/posts') {
        return await handleAdminQuorumPosts(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/answer-history') {
        return await handleAdminAnswerHistoryPreview(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/answer-history/export') {
        return await handleAdminAnswerHistoryExport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/action') {
        return await handleAdminAction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/reveal-email') {
        return await handleAdminEmailReveal(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/find-email') {
        return await handleAdminEmailSearch(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/export') {
        return await handleAdminExport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/user-responses/export') {
        return await handleAdminUserResponsesExport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/phase4-data') {
        return await handlePhase4AdminData(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/phase4-action') {
        return await handlePhase4AdminAction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/payment-proof') {
        return await handleAdminPaymentProof(request, env, origin, allowedOrigin);
      }
      if (pathname !== '/') {
        throw new ExaminerError('NOT_FOUND', 'This endpoint does not exist.', 404);
      }
      return await handleGrade(request, env, origin, allowedOrigin);
    } catch (error) {
      const known = error instanceof ExaminerError
        || error instanceof GuestAccessError
        || error instanceof AccessValidationError
        || error instanceof PrivateBetaError
        || error instanceof PaymentValidationError
        || error instanceof ForumValidationError
        || error instanceof ExaminationValidationError
        || error instanceof ReleaseContentError
        || error instanceof DD2026ValidationError;
      return jsonResponse({
        ok: false,
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'The examiner encountered an unexpected error.',
          ...(known && error.pendingAttemptId
            ? { pendingAttemptId: String(error.pendingAttemptId) }
            : {}),
          ...(known && Number.isFinite(error.retryAfterHours)
            ? { retryAfterHours: Number(error.retryAfterHours) }
            : {}),
        },
      }, known ? error.status : 500, requestOrigin, allowedOrigin);
    }
  },
};
