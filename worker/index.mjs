import { resolveExaminationRoomActivationWindow } from './examination-room-activation-window.mjs';
import { legacyPricingQrAvailableAt } from './legacy-pricing-qr.mjs';
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
  AdminPulseError,
  adminPulseEnabled,
  adminPulsePublicVapidKey,
  adminPulseWebPushConfigured,
  authorizeAdminPulse,
  coarsePushUserAgent,
  drainAdminPulseDeliveries,
  emptyAdminPulseSnapshot,
  normalizeAdminPulsePushRequest,
  normalizeAdminPulseSnapshotRequest,
  scheduleAdminPulseDispatch,
} from './admin-pulse-core.mjs';
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
  normalizeRecentUserActivityRequest,
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
  availableProtectedQuestionInventory,
  isProtectedQuestionWithheld,
  normalizeAccessSnapshot,
  normalizeRequestKey,
  normalizeSubject,
  protectedQuestionInventory,
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
  normalizeLegacyPaymentFields,
  normalizePartnershipRequest,
  normalizePaymentFields,
  normalizePhase4AdminAction,
  normalizePhase4AdminRequest,
  normalizeRefundRequest,
  proofExtension,
  validateProofSignature,
} from './payment-core.mjs';
import {
  PRICING_ASSET_BUCKET,
  PRICING_ASSET_LIMITS,
  PricingValidationError,
  normalizePricingAdminAction,
  normalizePricingAdminQuery,
  normalizePricingAssetMetadata,
  normalizePricingRequestKey,
  pricingUuid,
  sanitizePublicPricingSnapshot,
  sanitizeTrustedPayment,
  validatePricingAsset,
} from './pricing-core.mjs';
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
import { buildCommunitySampleContent } from './community-sample-content.mjs';
import { PedroValidationError } from './pedro-core.mjs';
import { createPedroHandlers } from './pedro-routes.mjs';
import {
  EXAMINATION_LIMITS,
  ExaminationValidationError,
  examinationDatabaseError,
  examinationText,
  examinationUuid,
  extractUploadedQuestions,
  normalizeExaminationAdmin,
  normalizeExaminationCommand,
  normalizeExaminationQuery,
  normalizeUploadRequest,
  sanitizeSubjectMatterCatalog,
  sanitizeSubjectMatterSelection,
} from './examinations-core.mjs';
import {
  SUBJECT_MATTER_TEACHING_SCHEMA,
  buildSubjectMatterTeachingPrompt,
  fallbackSubjectMatterTeachingExplanation,
  publicSubjectMatterReviewPayload,
  sanitizeSubjectMatterRevealRecord,
  validateSubjectMatterTeachingExplanation,
} from './subject-matter-review.mjs';
import {
  sanitizeLearnerFacingPayload,
  stripInternalEditorialBlocks,
} from './internal-editorial-content.mjs';
import {
  BAR_SIMULATION_POOL_CSV_URL,
  ReleaseContentError,
  SUBJECT_MATTER_CSV_URL,
  SUBJECT_MATTER_SHEET_RANGE,
  SUBJECT_MATTER_SPREADSHEET_ID,
  WEBSITE_UPLOAD_CSV_URL,
  WEBSITE_VISIBILITY_CSV_URL,
  applyWebsitePublicationOverlay,
  buildBarFeelsManifest,
  buildSubjectMatterPlacements,
  parseSubjectMatterSource,
  parseWebsitePublicationOverlay,
  parseWebsiteUploadSource,
  sheetValuesToCsv,
  subjectMatterReleaseSnapshotCsv,
  visibleWebsiteReleaseRows,
  websitePublicationDigest,
} from './release-content-core.mjs';
import {
  DD2026ValidationError,
  dd2026DatabaseError,
} from './duediligence-2026-core.mjs';
import { createDD2026Handlers } from './duediligence-2026-routes.mjs';
import { BarForecastError } from './bar-forecast-core.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';
import { createAuxiliaryWritingDiagnosticsHandlers } from './auxiliary-writing-diagnostics-routes.mjs';
import { StudyRoomError } from './study-room-core.mjs';
import { createStudyRoomHandlers } from './study-room-routes.mjs';
import {
  EXAMINATION_ROOM_V1_PATHS,
  ExaminationRoomV1RouteError,
  createExaminationRoomV1Handlers,
} from './examination-room-v1-routes.mjs';
import { createExaminationRoomAssistant } from './examination-room-assistant.mjs';
import { createExaminationRoomMediaControl } from './examination-room-media.mjs';
import {
  GRADING_REVISION_STATUSES,
  ROOM_KEY,
  buildGradingRevision,
  createRoomKey,
  isExaminationRoomV1Error,
  normalizePublicationManifest,
  normalizeRoomKey,
} from './examination-room-v1-core.mjs';
import {
  ExaminationRoomRecoveryError,
  createExaminationRoomRecovery,
} from './examination-room-v1-recovery.mjs';
import {
  buildExaminationRoomKeyEmail,
  deliverExaminationRoomPublicationRequestEmail,
  deliverExaminationRoomResultReleaseEmails,
} from './examination-room-email.mjs';
import { googleAccessToken } from './google-oauth.mjs';
import {
  outboundEmailMode,
  outboundEmailSuppressed,
  resolvedEmailMode,
} from './outbound-email-policy.mjs';
import embeddedWebsiteQuestionBank from '../content/question-bank/website-upload.json' with { type: 'json' };

export { absoluteSupabaseStorageUrl, outboundEmailMode };

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_CORRECTIONS_PER_WINDOW = 5;
const MAX_SUPPORT_REQUESTS_PER_WINDOW = 4;
const MAX_BAR_FORECAST_ADMIN_REQUESTS_PER_WINDOW = 90;
const DUPLICATE_TTL_MS = 20 * 1000;
const GEMINI_TIMEOUT_MS = 45 * 1000;
const SUBJECT_MATTER_TEACHING_TIMEOUT_MS = 8 * 1000;
const GEMINI_TRANSIENT_ATTEMPTS = 2;
const GEMINI_RETRY_DELAY_MS = 750;
// Deliberate availability tradeoff: a successfully verified token can remain
// accepted by the same warm isolate for at most 30 seconds after revocation,
// deletion, or profile changes. Keep this TTL short and cache no failures or
// identity that was not first verified by this project's Auth server.
const AUTHENTICATED_USER_TOKEN_CACHE_TTL_MS = 30 * 1000;
const AUTHENTICATED_USER_TOKEN_CACHE_MAX_ENTRIES = 512;
const AUTHENTICATED_USER_TOKEN_CACHE_MAX_TOKEN_CHARS = 16 * 1024;
// Supabase documents that Auth-server verification can be slow across regions.
// Production also showed valid /user requests reaching Supabase after the old
// five-second deadline even though Supabase completed them successfully. Keep
// the request bounded, but allow enough time for the cross-region connection.
const AUTHENTICATED_USER_VERIFICATION_TIMEOUT_MS = 15 * 1000;
const AUTHENTICATED_USER_VERIFICATION_ATTEMPTS = 2;
const AUTHENTICATED_USER_VERIFICATION_RETRY_DELAY_MS = 100;
const AUTHENTICATED_USER_RESPONSE_MAX_BYTES = 256 * 1024;
const WEBSITE_VISIBILITY_CACHE_URL = 'https://question-visibility-cache.invalid/v1.csv';
const WEBSITE_BANK_MINIMUM_RECORDS = 320;
const WEBSITE_BANK_MAXIMUM_RECORDS = 10_000;
const WEBSITE_VISIBILITY_MAX_BYTES = 2_000_000;
const rateWindows = new Map();
const correctionRateWindows = new Map();
const supportRateWindows = new Map();
const analyticsRateWindows = new Map();
const adminRateWindows = new Map();
const barForecastAdminRateWindows = new Map();
const studyRoomAccessRateWindows = new Map();
const studyRoomRoomsRateWindows = new Map();
const studyRoomJoinRateWindows = new Map();
const studyRoomModerationRateWindows = new Map();
const guestStatusRateWindows = new Map();
const paymentRateWindows = new Map();
const partnershipRateWindows = new Map();
const forumReadRateWindows = new Map();
const forumWriteRateWindows = new Map();
const examinationReadRateWindows = new Map();
const examinationWriteRateWindows = new Map();
const examinationRoomV1ProfessorRateWindows = new Map();
const examinationRoomV1StudentRateWindows = new Map();
const examinationRoomV1AdminRateWindows = new Map();
const dd2026ReadRateWindows = new Map();
const dd2026WriteRateWindows = new Map();
const pedroReadRateWindows = new Map();
const pedroWriteRateWindows = new Map();
const recentSubmissions = new Map();
const recentSignInNotificationSessions = new Map();
const authenticatedUserCache = new WeakMap();
const authenticatedUserTokenCache = new Map();
let laborBankCache = null;
let websiteBankCache = null;

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    'Access-Control-Expose-Headers': 'Retry-After, Content-Disposition, X-Admin-Data-Scope',
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

async function enforceBarForecastAdminRateLimit(request, env) {
  enforceWindow(
    barForecastAdminRateWindows,
    await transientRateKey(request, env, 'bar-forecast-admin'),
    MAX_BAR_FORECAST_ADMIN_REQUESTS_PER_WINDOW,
    'Too many Forecast administrator requests. Please wait and try again.',
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

async function enforcePedroRateLimit(request, env, operation = 'query') {
  const mutation = operation === 'message';
  try {
    enforceWindow(
      mutation ? pedroWriteRateWindows : pedroReadRateWindows,
      await transientRateKey(request, env, mutation ? 'pedro-message' : 'pedro-query'),
      mutation ? 2500 : 5000,
      'Pedro needs a moment. Please try again shortly.',
    );
  } catch (error) {
    if (String(error?.code || '').toUpperCase() === 'RATE_LIMITED') {
      throw new PedroValidationError(
        'PEDRO_RATE_LIMITED',
        'Pedro needs a moment. Please try again shortly.',
        429,
        { retryable: true, retryAfterSeconds: 30 },
      );
    }
    throw error;
  }
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

async function enforceExaminationRoomV1RateLimit(request, env, scope, boundedPayload = null) {
  const policies = {
    professor_query: [examinationRoomV1ProfessorRateWindows, 180],
    professor_command: [examinationRoomV1ProfessorRateWindows, 90],
    professor_assistant: [examinationRoomV1ProfessorRateWindows, 60],
    student_preview: [examinationRoomV1StudentRateWindows, 20],
    student_consent: [examinationRoomV1StudentRateWindows, 12],
    student_query: [examinationRoomV1StudentRateWindows, 180],
    student_media: [examinationRoomV1StudentRateWindows, 240],
    student_command: [examinationRoomV1StudentRateWindows, 300],
    admin_query: [examinationRoomV1AdminRateWindows, 90],
    admin_command: [examinationRoomV1AdminRateWindows, 45],
  };
  const policy = policies[scope];
  if (!policy) {
    throw new ExaminationRoomV1RouteError(
      'EXAM_ROOM_V1_RATE_POLICY_INVALID',
      'This Examination Room action is not available.',
      500,
      'Refresh the page. If the message continues, contact support.',
    );
  }
  const [window, maximum] = policy;
  const ip = request.headers.get('CF-Connecting-IP') || 'unavailable';
  let subject = request.headers.get('Authorization') || '';
  if (scope.startsWith('student_')) {
    // Student credentials live in the JSON body. Route handlers pass the object
    // produced by their single, size-bounded parse so the limiter never clones or
    // buffers an untrusted request body on its own.
    const payload = boundedPayload?.payload && typeof boundedPayload.payload === 'object'
      ? boundedPayload.payload
      : boundedPayload;
    subject = scope === 'student_preview' || scope === 'student_consent'
      ? `${String(payload?.roomKey || '').slice(0, 100)}\0${String(
        payload?.identity?.studentNumber || payload?.studentNumber || '',
      ).slice(0, 128)}`
      : String(payload?.sessionId || '').slice(0, 128);
  }
  const limiterSecret = env.EXAMINATION_ROOM_KEY_PEPPER || env.GUEST_USAGE_HMAC_KEY;
  if (!limiterSecret) {
    throw new ExaminationRoomV1RouteError(
      'EXAM_ROOM_V1_NOT_CONFIGURED',
      'Examination Room security is not configured.',
      503,
      'Contact support and provide the time this message appeared.',
    );
  }
  try {
    enforceWindow(
      window,
      await hmacHex(limiterSecret, `examination-room-v1:${scope}\0${ip}\0${subject}`),
      maximum,
      'Too many Examination Room requests. Wait a few minutes and try again.',
    );
    if (window.size > 5_000) {
      const cutoff = Date.now() - WINDOW_MS;
      for (const [entryKey, entry] of window) {
        if (entry.startedAt < cutoff) window.delete(entryKey);
      }
      while (window.size > 5_000) {
        const oldestKey = window.keys().next().value;
        if (oldestKey === undefined) break;
        window.delete(oldestKey);
      }
    }
  } catch (error) {
    if (error instanceof ExaminerError && error.code === 'RATE_LIMITED') {
      throw new ExaminationRoomV1RouteError(
        'EXAM_ROOM_V1_RATE_LIMITED',
        error.message,
        429,
        'Wait ten minutes, then repeat the action once. Saved work remains preserved.',
      );
    }
    throw error;
  }
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

function isAuthoritativeRpcRejectionStatus(status) {
  const normalized = Number(status);
  return Number.isInteger(normalized)
    && normalized >= 400
    && normalized < 500
    && ![408, 425, 429, 499].includes(normalized);
}

function markRpcOutcome(error, status) {
  error.authoritativeRpcRejection = isAuthoritativeRpcRejectionStatus(status);
  error.rpcStatus = Number(status) || null;
  return error;
}

function isAuthoritativeRpcRejection(error) {
  return error?.authoritativeRpcRejection === true;
}

async function protectedSupabaseRpc(env, functionName, body, options = {}) {
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
    if (denied && options.returnNullOnAuthorizationDenial === true) return null;
    console.error('Protected storage request failed', {
      operation: functionName,
      status: response.status,
      denied,
    });
    throw markRpcOutcome(new ExaminerError(
      denied ? 'ADMIN_FORBIDDEN' : 'ADMIN_DATA_UNAVAILABLE',
      denied
        ? 'You are not authorized for this administrator operation.'
        : 'Administrator data is temporarily unavailable.',
      denied ? 403 : 503,
    ), response.status);
  }
  return result;
}

async function examinationRoomV1ServiceRpc(env, functionName, body) {
  const allowedFunctions = new Set([
    'examination_room_v1_staff_context',
    'examination_room_v1_professor_access',
    'examination_room_v1_manage_staff',
    'examination_room_v1_api',
    'examination_room_v1_owner_query',
    'examination_room_v1_owner_command',
    'examination_room_v1_lifecycle_query',
    'examination_room_v1_lifecycle_command',
    'examination_room_v1_lifecycle_guard',
    'examination_room_v1_media',
    'examination_room_v1_owner_ensure_membership',
    'examination_room_v1_claim_recovery_snapshot',
    'examination_room_v1_complete_recovery_snapshot',
    'examination_room_v1_fail_recovery_snapshot',
    'examination_room_v1_verify_recovery_snapshot',
    'examination_room_v1_grading_contexts',
    'examination_room_v1_import_grades',
    'examination_room_v1_claim_result_email_deliveries',
    'examination_room_v1_complete_result_email_deliveries',
  ]);
  if (!allowedFunctions.has(functionName)) {
    throw new ExaminationRoomV1RouteError(
      'EXAM_ROOM_V1_OPERATION_UNSUPPORTED',
      'That Examination Room operation is not available.',
      400,
      'Refresh the page and try again.',
    );
  }
  let baseUrl;
  try {
    baseUrl = configuredSupabaseUrl(env);
  } catch {
    throw new ExaminationRoomV1RouteError(
      'EXAM_ROOM_V1_NOT_CONFIGURED',
      'Examination Room persistence is not configured.',
      503,
      'Contact support and provide the time this message appeared.',
    );
  }
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
    const denied = response.status === 401 || response.status === 403;
    console.error('Examination Room v1 service request failed', {
      operation: functionName,
      status: response.status,
      denied,
    });
    throw new ExaminationRoomV1RouteError(
      denied ? 'EXAM_ROOM_V1_FORBIDDEN' : 'EXAM_ROOM_V1_DATA_UNAVAILABLE',
      denied
        ? 'This account is not authorized for that Examination Room action.'
        : 'Examination Room records are temporarily unavailable.',
      denied ? 403 : 503,
      denied
        ? 'Return to Due Diligence and sign in with an authorized account.'
        : 'Your work on this device is preserved. Wait briefly, then try again.',
    );
  }
  return result;
}

async function examinationRoomV1StaffContext(env, user) {
  const context = await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_staff_context',
    { p_user_id: user.id },
  );
  return context && typeof context === 'object' ? context : { authorized: false, memberships: [] };
}

function examinationRoomV1Result(result) {
  if (result?.ok !== false) return result || { ok: true };
  const databaseError = result.error && typeof result.error === 'object' && !Array.isArray(result.error)
    ? result.error
    : {};
  const databaseCode = String(databaseError.code || result.errorCode || 'DATA_UNAVAILABLE');
  const code = databaseCode.startsWith('EXAM_ROOM_V1_')
    ? databaseCode
    : `EXAM_ROOM_V1_${databaseCode}`;
  const reportedStatus = Number(databaseError.status);
  const status = Number.isInteger(reportedStatus) && reportedStatus >= 400 && reportedStatus <= 599
    ? reportedStatus
    : databaseCode === 'FORBIDDEN'
      ? 403
      : databaseCode === 'PERSISTENCE_OPERATION_NOT_IMPLEMENTED'
        ? 501
        : 400;
  return {
    ok: false,
    error: {
      code,
      message: String(databaseError.message || result.message || 'Examination Room could not complete that action.'),
      status,
      recovery: String(databaseError.recovery || (databaseCode === 'PERSISTENCE_OPERATION_NOT_IMPLEMENTED'
        ? 'Use the verified local demonstration while the production persistence release is being completed.'
        : status === 403
          ? 'Sign in with the authorized institution account, then try again.'
          : 'Review the information, then try again.')),
      ...((databaseError.details || result.details) ? { details: databaseError.details || result.details } : {}),
    },
  };
}

async function examinationRoomV1Rpc(env, request) {
  const result = await examinationRoomV1ServiceRpc(env, 'examination_room_v1_api', {
    p_scope: request.scope,
    p_operation: request.operation,
    p_actor_user_id: request.actorUserId,
    p_institution_id: request.institutionId,
    p_payload: request.payload || {},
  });
  return examinationRoomV1Result(result);
}

async function examinationRoomV1ManageStaff(env, request) {
  const result = await examinationRoomV1ServiceRpc(env, 'examination_room_v1_manage_staff', {
    p_operation: request.operation,
    p_actor_user_id: request.actorUserId,
    p_institution_id: request.institutionId,
    p_payload: request.payload || {},
  });
  return examinationRoomV1Result(result);
}

async function examinationRoomV1ProfessorAccess(env, request) {
  const result = await examinationRoomV1ServiceRpc(env, 'examination_room_v1_professor_access', {
    p_operation: request.operation,
    p_actor_user_id: request.actorUserId,
    p_payload: request.payload || {},
  });
  return examinationRoomV1Result(result);
}

const EXAMINATION_ROOM_OWNER_ROLES = new Set(['founder_admin', 'super_admin']);
const EXAMINATION_ROOM_OWNER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXAMINATION_ROOM_OWNER_REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const EXAMINATION_ROOM_OWNER_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXAMINATION_ROOM_OWNER_ENVELOPE_ALGORITHM = 'aes-256-gcm-v1';
const EXAMINATION_ROOM_OWNER_ENVELOPE_AAD = 'duediligence-examination-room-owner-key-v1';
const EXAMINATION_ROOM_RECOVERY_REFERENCE_PREFIXES = Object.freeze([
  'r2:EXAMINATION_ROOM_BACKUPS:',
  'supabase-storage:examination-room-recovery:',
]);

function examinationRoomOwnerError(code, message, status, recovery, details = undefined) {
  return new ExaminationRoomV1RouteError(code, message, status, recovery, details);
}

function examinationRoomOwnerRecord(value, label = 'request details') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_REQUEST_INVALID',
      `Provide ${label} as an object with named fields.`,
      400,
      'Refresh the page and try the action again.',
    );
  }
  return value;
}

function examinationRoomOwnerUuid(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!EXAMINATION_ROOM_OWNER_UUID_PATTERN.test(normalized)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_IDENTIFIER_INVALID',
      `The ${label} is invalid.`,
      400,
      'Refresh the command center, choose the current record, and try again.',
    );
  }
  return normalized;
}

function examinationRoomOwnerRequestKey(request, body) {
  const value = String(body?.idempotencyKey || request.headers.get('X-Request-ID') || '').trim();
  if (!EXAMINATION_ROOM_OWNER_REQUEST_KEY_PATTERN.test(value)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_IDEMPOTENCY_KEY_INVALID',
      'This owner action is missing a valid retry-safe request key.',
      400,
      'Refresh Admin, then repeat the action once.',
    );
  }
  return value;
}

async function examinationRoomOwnerRequestHash(env, requestKey) {
  const pepper = String(env?.EXAMINATION_ROOM_KEY_PEPPER || '').trim();
  if (pepper.length < 32) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_NOT_CONFIGURED',
      'Examination Room key protection is not configured.',
      503,
      'Configure the Examination Room key secret, then retry the action.',
    );
  }
  return hmacHex(pepper, `request\0${requestKey}`);
}

function ensureExaminationRoomOwnerResult(result) {
  const normalized = examinationRoomV1Result(result);
  if (normalized?.ok === false) {
    const error = normalized.error || {};
    throw examinationRoomOwnerError(
      String(error.code || 'EXAM_ROOM_V1_DATA_UNAVAILABLE'),
      String(error.message || 'Examination Room could not complete that owner action.'),
      Number.isInteger(error.status) ? error.status : 503,
      String(error.recovery || 'Refresh the command center and try again.'),
      error.details,
    );
  }
  return normalized || { ok: true };
}

async function requireExaminationRoomPlatformOwner(request, env) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user?.id) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_ADMIN_SIGN_IN_REQUIRED',
      'Platform-owner sign-in is required.',
      401,
      'Sign in with the Founder or Super Admin account, then reopen Admin.',
    );
  }
  let authorization;
  try {
    authorization = await protectedSupabaseRpc(env, 'admin_authorization_context', {
      p_actor_user_id: user.id,
    });
  } catch (error) {
    if (error?.code !== 'ADMIN_FORBIDDEN') {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OWNER_AUTHORIZATION_UNAVAILABLE',
        'Platform-owner authorization is temporarily unavailable.',
        503,
        'No Examination Room data was changed. Wait briefly, then sign in again and retry.',
      );
    }
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_PLATFORM_OWNER_REQUIRED',
      'Only a Founder or Super Admin can open the Examination Room command center.',
      403,
      'Sign in with the platform-owner account.',
    );
  }
  if (authorization?.authorized !== true
      || !EXAMINATION_ROOM_OWNER_ROLES.has(String(authorization.role || ''))) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_PLATFORM_OWNER_REQUIRED',
      'Only a Founder or Super Admin can open the Examination Room command center.',
      403,
      'Sign in with the platform-owner account.',
    );
  }
  return { user, authorization };
}

async function examinationRoomV1OwnerQueryRpc(env, request) {
  return examinationRoomV1Result(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_owner_query',
    {
      p_operation: request.operation,
      p_actor_user_id: request.actorUserId,
      p_institution_id: request.institutionId || null,
      p_exam_id: request.examId || null,
      p_payload: request.payload || {},
    },
  ));
}

async function examinationRoomV1OwnerCommandRpc(env, request) {
  return examinationRoomV1Result(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_owner_command',
    {
      p_operation: request.operation,
      p_actor_user_id: request.actorUserId,
      p_institution_id: request.institutionId,
      p_exam_id: request.examId || null,
      p_payload: request.payload || {},
    },
  ));
}

async function examinationRoomV1LifecycleQueryRpc(env, request) {
  return examinationRoomV1Result(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_lifecycle_query',
    {
      p_actor_user_id: request.actorUserId,
      p_institution_id: request.institutionId || null,
      p_exam_id: request.examId || null,
    },
  ));
}

async function examinationRoomV1LifecycleCommandRpc(env, request) {
  return examinationRoomV1Result(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_lifecycle_command',
    {
      p_operation: request.operation,
      p_actor_user_id: request.actorUserId,
      p_institution_id: request.institutionId,
      p_exam_id: request.examId,
      p_payload: request.payload || {},
    },
  ));
}

async function examinationRoomV1LifecycleGuardRpc(env, examId) {
  return examinationRoomV1Result(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_lifecycle_guard',
    { p_exam_id: examId },
  ));
}

async function examinationRoomV1OwnerEnsureMembership(env, actorUserId, institutionId) {
  return ensureExaminationRoomOwnerResult(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_owner_ensure_membership',
    { p_actor_user_id: actorUserId, p_institution_id: institutionId },
  ));
}

function examinationRoomOwnerBytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function examinationRoomOwnerBase64ToBytes(value) {
  const source = String(value || '').trim().replace(/^base64:/iu, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(source)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_INVALID',
      'The encrypted room-key record is invalid.',
      409,
      'Rotate the room key once to create a new recoverable record.',
    );
  }
  const normalized = source.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_INVALID',
      'The encrypted room-key record is invalid.',
      409,
      'Rotate the room key once to create a new recoverable record.',
    );
  }
}

function examinationRoomOwnerDataKeyBytes(env) {
  const source = String(env?.EXAMINATION_ROOM_OWNER_DATA_KEY_V1 || '').trim();
  if (!source) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_NOT_CONFIGURED',
      'Owner room-key recovery is not configured.',
      503,
      'Configure the 32-byte owner data key, then retry the same approval action.',
    );
  }
  let bytes;
  if (/^hex:[0-9a-f]{64}$/iu.test(source)) {
    const hex = source.slice(4);
    bytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  } else if (/^[0-9a-f]{64}$/iu.test(source)) {
    bytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(source.slice(index * 2, index * 2 + 2), 16));
  } else if (new TextEncoder().encode(source).byteLength === 32) {
    bytes = new TextEncoder().encode(source);
  } else {
    bytes = examinationRoomOwnerBase64ToBytes(source);
  }
  if (bytes.byteLength !== 32) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_NOT_CONFIGURED',
      'Owner room-key recovery is not configured.',
      503,
      'Configure the 32-byte owner data key, then retry the same approval action.',
    );
  }
  return bytes;
}

function examinationRoomOwnerEnvelopeAad(institutionId, examId, activationId) {
  return new TextEncoder().encode(
    `${EXAMINATION_ROOM_OWNER_ENVELOPE_AAD}\0${institutionId}\0${examId}\0${activationId}`,
  );
}

async function examinationRoomOwnerEncryptionKey(env, usages) {
  try {
    return await crypto.subtle.importKey(
      'raw',
      examinationRoomOwnerDataKeyBytes(env),
      { name: 'AES-GCM' },
      false,
      usages,
    );
  } catch (error) {
    if (error instanceof ExaminationRoomV1RouteError) throw error;
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_CRYPTO_UNAVAILABLE',
      'Owner room-key recovery could not use the required encryption service.',
      503,
      'Retry once. If it continues, verify the owner data-key configuration.',
    );
  }
}

async function encryptExaminationRoomOwnerKey(env, identifiers, roomKey) {
  const aad = examinationRoomOwnerEnvelopeAad(
    identifiers.institutionId,
    identifiers.examId,
    identifiers.activationId,
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await examinationRoomOwnerEncryptionKey(env, ['encrypt']);
  let ciphertext;
  try {
    ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      key,
      new TextEncoder().encode(normalizeRoomKey(roomKey)),
    ));
  } catch {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_ENCRYPT_FAILED',
      'The room key could not be protected for owner recovery.',
      503,
      'No unencrypted key was stored. Retry the same approval action.',
    );
  }
  return {
    algorithm: EXAMINATION_ROOM_OWNER_ENVELOPE_ALGORITHM,
    keyVersion: 1,
    ciphertext: examinationRoomOwnerBytesToBase64(ciphertext),
    iv: examinationRoomOwnerBytesToBase64(iv),
    aadSha256: await sha256Hex(aad),
  };
}

async function decryptExaminationRoomOwnerKey(env, envelope) {
  if (envelope?.algorithm !== EXAMINATION_ROOM_OWNER_ENVELOPE_ALGORITHM
      || Number(envelope?.keyVersion) !== 1) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_VERSION_UNAVAILABLE',
      'This room-key record uses an unavailable encryption version.',
      409,
      'Rotate the room key once to create a current recoverable record.',
    );
  }
  const identifiers = {
    institutionId: examinationRoomOwnerUuid(envelope.institutionId, 'institution identifier'),
    examId: examinationRoomOwnerUuid(envelope.examId, 'examination identifier'),
    activationId: examinationRoomOwnerUuid(envelope.activationId, 'room activation identifier'),
  };
  const aad = examinationRoomOwnerEnvelopeAad(
    identifiers.institutionId,
    identifiers.examId,
    identifiers.activationId,
  );
  if (await sha256Hex(aad) !== String(envelope.aadSha256 || '').toLowerCase()) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_SCOPE_MISMATCH',
      'The encrypted room key does not match this examination activation.',
      409,
      'Do not use this record. Rotate the key once from the selected examination.',
    );
  }
  const key = await examinationRoomOwnerEncryptionKey(env, ['decrypt']);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: examinationRoomOwnerBase64ToBytes(envelope.iv),
        additionalData: aad,
        tagLength: 128,
      },
      key,
      examinationRoomOwnerBase64ToBytes(envelope.ciphertext),
    );
  } catch {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_DECRYPT_FAILED',
      'The room-key record could not be authenticated.',
      409,
      'Verify the owner data-key version. If needed, rotate the room key once.',
    );
  }
  try {
    return normalizeRoomKey(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_KEY_ESCROW_INVALID',
      'The decrypted room-key record is invalid.',
      409,
      'Rotate the room key once to create a new recoverable record.',
    );
  }
}

async function currentExaminationRoomOwnerKeyEnvelope(env, owner, institutionId, examId) {
  const result = await examinationRoomV1OwnerQueryRpc(env, {
    operation: 'key_envelope',
    actorUserId: owner.user.id,
    institutionId,
    examId,
    payload: {},
  });
  if (result?.ok === false) return null;
  return result;
}

async function ensureExaminationRoomOwnerKeyEscrow(
  env,
  owner,
  identifiers,
  roomKey,
) {
  const current = await currentExaminationRoomOwnerKeyEnvelope(
    env,
    owner,
    identifiers.institutionId,
    identifiers.examId,
  );
  if (current?.activationId === identifiers.activationId) {
    const recovered = await decryptExaminationRoomOwnerKey(env, current);
    if (recovered !== roomKey) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_KEY_ESCROW_CONFLICT',
        'A different encrypted key is already bound to this room activation.',
        409,
        'Refresh Admin and use Rotate key exactly once.',
      );
    }
    return { duplicate: true, activationId: identifiers.activationId };
  }

  const envelope = await encryptExaminationRoomOwnerKey(env, identifiers, roomKey);
  try {
    return ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerCommandRpc(env, {
      operation: 'store_key_envelope',
      actorUserId: owner.user.id,
      institutionId: identifiers.institutionId,
      examId: identifiers.examId,
      payload: { activationId: identifiers.activationId, ...envelope },
    }));
  } catch (error) {
    if (!String(error?.code || '').includes('KEY_ESCROW_CONFLICT')) throw error;
    const raced = await currentExaminationRoomOwnerKeyEnvelope(
      env,
      owner,
      identifiers.institutionId,
      identifiers.examId,
    );
    if (raced?.activationId !== identifiers.activationId
        || await decryptExaminationRoomOwnerKey(env, raced) !== roomKey) throw error;
    return { duplicate: true, activationId: identifiers.activationId };
  }
}

function examinationRoomAdminEmailRecipientReport(env, professorRecipient = '') {
  const raw = String(
    env?.EXAMINATION_ROOM_ADMIN_EMAILS
      || env?.ADMIN_EMAILS
      || '',
  ).trim();
  let candidates = [];
  try {
    const configured = JSON.parse(raw);
    if (Array.isArray(configured)) candidates = configured;
    else if (configured && typeof configured === 'object') candidates = Object.values(configured);
  } catch {
    candidates = raw.split(/[;,\n]/u);
  }
  const seen = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  const recipients = [];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim().toLowerCase();
    if (!value) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(value)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(value);
    if (recipients.length < 20) recipients.push(value);
  }
  return {
    recipients,
    invalidCount,
    duplicateCount,
    configuredCount: candidates.filter((value) => String(value || '').trim()).length,
  };
}

function examinationRoomAdminEmailRecipients(env, professorRecipient = '') {
  return examinationRoomAdminEmailRecipientReport(env, professorRecipient).recipients;
}

async function examinationRoomOwnerPreflight(env) {
  const checks = [];
  try {
    await examinationRoomOwnerEncryptionKey(env, ['encrypt']);
    checks.push({
      id: 'owner_data_key',
      ok: true,
      status: 'ready',
      message: 'Owner room-key encryption is ready.',
    });
  } catch (error) {
    checks.push({
      id: 'owner_data_key',
      ok: false,
      status: 'not_configured',
      code: String(error?.code || 'EXAM_ROOM_V1_KEY_ESCROW_NOT_CONFIGURED'),
      message: String(error?.message || 'Owner room-key encryption is not configured.'),
      recovery: String(error?.recovery || 'Configure the 32-byte owner data key, then run Preflight again.'),
    });
  }

  const emailReport = examinationRoomAdminEmailRecipientReport(env);
  if (emailReport.recipients.length > 0 && emailReport.invalidCount === 0) {
    checks.push({
      id: 'owner_email_recipients',
      ok: true,
      status: 'ready',
      message: `${emailReport.recipients.length} owner email recipient${emailReport.recipients.length === 1 ? '' : 's'} configured.`,
      recipients: emailReport.recipients,
    });
  } else {
    checks.push({
      id: 'owner_email_recipients',
      ok: false,
      status: 'not_configured',
      code: 'EXAM_ROOM_V1_OWNER_EMAILS_INVALID',
      message: emailReport.recipients.length < 1
        ? 'No valid owner email recipient is configured.'
        : 'The owner email list contains an invalid address.',
      recovery: 'Set EXAMINATION_ROOM_ADMIN_EMAILS to a JSON list of valid platform-owner email addresses (or keep the existing ADMIN_EMAILS list during migration), then run Preflight again.',
      recipients: emailReport.recipients,
      invalidCount: emailReport.invalidCount,
    });
  }

  const emailMode = String(env?.EXAMINATION_ROOM_EMAIL_MODE || '').trim().toLowerCase();
  const emailFrom = String(env?.EXAMINATION_ROOM_EMAIL_FROM || env?.SUPPORT_NOTIFICATION_EMAIL_FROM || '').trim();
  const emailReady = emailMode === 'suppressed'
    || (emailMode === 'enabled' && Boolean(env?.RESEND_API_KEY) && Boolean(emailFrom));
  checks.push(emailReady ? {
    id: 'key_email_delivery',
    ok: true,
    status: emailMode === 'suppressed' ? 'suppressed' : 'ready',
    mode: emailMode,
    message: emailMode === 'suppressed'
      ? 'Examination Room key email is intentionally suppressed in this environment.'
      : 'Examination Room key email is configured for provider delivery.',
  } : {
    id: 'key_email_delivery',
    ok: false,
    status: 'not_configured',
    mode: emailMode || 'missing',
    code: 'EXAM_ROOM_V1_KEY_EMAIL_NOT_CONFIGURED',
    message: 'Examination Room key email is not completely configured.',
    recovery: 'Set the scoped email mode, sender, and provider key, then run Preflight again.',
  });

  try {
    const recovery = await createExaminationRoomRecovery().preflight(env);
    checks.push({
      id: 'encrypted_recovery',
      ok: true,
      status: 'ready',
      message: 'The backup master key and private recovery storage are ready.',
      keyVersion: recovery.keyVersion,
      binding: recovery.binding,
      storageProvider: recovery.storageProvider,
      storageStatus: recovery.storageStatus,
      recoveryMode: recovery.recoveryMode,
      maxObjectBytes: recovery.maxObjectBytes,
      maxPlaintextBytes: recovery.maxPlaintextBytes,
      oversizeFallback: recovery.oversizeFallback,
    });
  } catch (error) {
    checks.push({
      id: 'encrypted_recovery',
      ok: false,
      status: 'not_configured',
      code: String(error?.code || 'EXAM_ROOM_V1_RECOVERY_NOT_CONFIGURED'),
      message: String(error?.message || 'Encrypted recovery storage is not configured.'),
      recovery: String(error?.recovery || 'Configure the backup master key and private storage, then run Preflight again.'),
    });
  }

  return {
    ok: true,
    ready: checks.every((check) => check.ok === true),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

async function recordExaminationRoomOwnerEmailDelivery(env, owner, details) {
  const eventRequestHash = await sha256Hex(new TextEncoder().encode(
    `examination-room-email\0${details.requestHash}\0${details.deliveryKind}`,
  ));
  return ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerCommandRpc(env, {
    operation: 'record_email_delivery',
    actorUserId: owner.user.id,
    institutionId: details.institutionId,
    examId: details.examId,
    payload: {
      activationId: details.activationId,
      requestHash: eventRequestHash,
      deliveryKind: details.deliveryKind,
      professorRecipient: details.professorRecipient,
      ownerCopyRecipients: details.ownerCopyRecipients,
      providerStatus: details.delivery.status,
      providerId: details.delivery.providerId || null,
      safeErrorCode: details.delivery.safeErrorCode || null,
      attemptedAt: new Date().toISOString(),
    },
  }));
}

function examinationRoomPersistedDelivery(attempt, auditResult) {
  const knownStatuses = new Set(['sent', 'suppressed', 'not_configured', 'failed']);
  const attemptedStatus = String(attempt?.status || 'failed');
  const recordedStatus = String(auditResult?.providerStatus || '');
  const hasRecordedStatus = knownStatuses.has(recordedStatus);
  return {
    status: hasRecordedStatus ? recordedStatus : attemptedStatus,
    providerId: hasRecordedStatus
      ? (auditResult?.providerId || null)
      : (attempt?.providerId || null),
    safeErrorCode: hasRecordedStatus
      ? (auditResult?.safeErrorCode || null)
      : (attempt?.safeErrorCode || null),
    attemptedAt: hasRecordedStatus ? (auditResult?.attemptedAt || null) : null,
  };
}

function examinationRoomOwnerRecoverableSideEffect(error, fallbackCode, fallbackRecovery) {
  return {
    status: 'failed',
    code: String(error?.code || fallbackCode).slice(0, 120),
    recovery: String(error?.recovery || fallbackRecovery).slice(0, 500),
  };
}

function examinationRoomOwnerDeliverySummary(delivery, professorRecipient, ownerRecipients) {
  const status = String(delivery?.status || 'failed');
  const owners = Array.isArray(ownerRecipients) ? ownerRecipients : [];
  const professor = String(professorRecipient || '').trim().toLowerCase() || null;
  return {
    status,
    providerAccepted: status === 'sent',
    providerId: delivery?.providerId || null,
    safeErrorCode: delivery?.safeErrorCode || null,
    professor: {
      recipient: professor,
      status: professor ? status : 'not_available',
    },
    owners: {
      recipients: owners,
      status: owners.length ? status : 'not_configured',
    },
  };
}

async function deterministicExaminationRoomKey(env, requestHash, institutionId, examId) {
  const pepper = String(env?.EXAMINATION_ROOM_KEY_PEPPER || '').trim();
  const digest = await hmacHex(
    pepper,
    `room-key-generation\0${institutionId}\0${examId}\0${requestHash}`,
  );
  let payload = '';
  for (let index = 0; index < ROOM_KEY.PAYLOAD_LENGTH; index += 1) {
    const byte = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
    payload += ROOM_KEY.ALPHABET[byte % ROOM_KEY.ALPHABET.length];
  }
  return createRoomKey(payload);
}

function examinationRoomPublishedActivationWindow(bundle, payload) {
  const publishedVersionId = String(bundle?.currentPublishedVersionId || '').trim();
  const version = examinationRoomOwnerBundleRows(bundle, 'examVersions')
    .find((entry) => String(examinationRoomOwnerRowValue(entry, 'id') || '') === publishedVersionId);
  if (!publishedVersionId
      || !version
      || examinationRoomOwnerRowValue(version, 'publicationStatus', 'publication_status') !== 'published') {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_PUBLISHED_SCHEDULE_INVALID',
      'The examination does not have a valid published version.',
      409,
      'Ask the exam creator to publish the examination before issuing a room key.',
    );
  }

  const startsAt = examinationRoomOwnerRowValue(version?.controls, 'startsAt', 'starts_at');
  const durationSeconds = Number(examinationRoomOwnerRowValue(
    version,
    'durationSeconds',
    'duration_seconds',
  ));
  const maximumExtraMinutes = examinationRoomOwnerBundleRows(bundle, 'examRoster')
    .reduce((maximum, roster) => {
      const accommodations = examinationRoomOwnerRowValue(roster, 'accommodations') || {};
      const extra = Number(examinationRoomOwnerRowValue(
        accommodations,
        'extraMinutes',
        'extra_minutes',
      ) || 0);
      return Number.isFinite(extra) && extra >= 0 ? Math.max(maximum, extra) : maximum;
    }, 0);

  let activationWindow;
  try {
    activationWindow = resolveExaminationRoomActivationWindow({
      startsAt,
      durationSeconds,
      maximumExtraMinutes,
    });
  } catch (error) {
    const invalidStart = error?.code === 'INVALID_START_TIME';
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_PUBLISHED_SCHEDULE_INVALID',
      invalidStart
        ? 'The published examination has an invalid optional start time.'
        : 'The published examination has no valid duration.',
      409,
      invalidStart
        ? 'Ask the exam creator to clear the optional start time or enter a valid date, then publish the corrected examination.'
        : 'Ask the exam creator to confirm the examination duration and publish the corrected examination before issuing a room key.',
    );
  }

  const maxSessions = payload?.maxSessions == null || payload.maxSessions === ''
    ? null
    : Number(payload.maxSessions);
  if (maxSessions !== null
      && (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 100_000)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_MAX_SESSIONS_INVALID',
      'The maximum student-session count must be a whole number from 1 to 100,000.',
      400,
      'Enter a valid maximum session count or leave it blank for no separate cap.',
    );
  }

  return {
    ...activationWindow,
    maxSessions,
  };
}

async function issueExaminationRoomOwnerKey(env, owner, request, body, payload, options) {
  const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
  const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
  await examinationRoomV1OwnerEnsureMembership(env, owner.user.id, institutionId);
  const detail = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
    operation: 'exam_detail',
    actorUserId: owner.user.id,
    institutionId,
    examId,
    payload: {},
  }));
  const requestKey = examinationRoomOwnerRequestKey(request, body);
  const requestHash = await examinationRoomOwnerRequestHash(env, requestKey);
  const roomKey = await deterministicExaminationRoomKey(
    env,
    requestHash,
    institutionId,
    examId,
  );
  const activationWindow = examinationRoomPublishedActivationWindow(detail.bundle, payload);
  const activationResult = ensureExaminationRoomOwnerResult(await examinationRoomV1Rpc(env, {
    scope: 'admin',
    operation: 'email_key',
    actorUserId: owner.user.id,
    institutionId,
    payload: {
      examId,
      roomKeyHash: await hmacHex(
        String(env.EXAMINATION_ROOM_KEY_PEPPER).trim(),
        `room-key\0${roomKey}`,
      ),
      keyHashAlgorithm: 'hmac-sha256-v1',
      requestHash,
      opensAt: activationWindow.opensAt,
      closesAt: activationWindow.closesAt,
      maxSessions: activationWindow.maxSessions,
      replaceCurrent: options.replaceCurrent === true,
    },
  }));
  const activationId = examinationRoomOwnerUuid(
    activationResult.activation?.id,
    'room activation identifier',
  );
  let escrowResult = null;
  let escrowFailure = null;
  try {
    escrowResult = await ensureExaminationRoomOwnerKeyEscrow(env, owner, {
      institutionId, examId, activationId,
    }, roomKey);
  } catch (error) {
    escrowFailure = examinationRoomOwnerRecoverableSideEffect(
      error,
      'EXAM_ROOM_V1_KEY_ESCROW_RETRY_REQUIRED',
      'The room is active and the exact key is visible in this response. Correct owner-key recovery, then retry this same approval request; do not rotate the key.',
    );
    console.error('Examination Room key escrow needs recovery after activation', {
      code: escrowFailure.code,
      activationId,
    });
  }

  const ownerCopyRecipients = examinationRoomAdminEmailRecipients(
    env,
    activationResult.professorEmail,
  );
  const delivery = await sendExaminationRoomV1KeyEmail(env, {
    recipient: activationResult.professorEmail,
    professorName: activationResult.professorName,
    examTitle: activationResult.examTitle,
    roomKey,
    expiresAt: activationResult.activation?.expiresAt || activationWindow.closesAt,
    idempotencyHash: requestHash,
    ownerRecipients: ownerCopyRecipients,
  });
  let deliveryAudit = null;
  let deliveryAuditFailure = null;
  try {
    deliveryAudit = await recordExaminationRoomOwnerEmailDelivery(env, owner, {
      institutionId,
      examId,
      activationId,
      requestHash,
      deliveryKind: options.deliveryKind,
      professorRecipient: String(activationResult.professorEmail || '').trim().toLowerCase() || null,
      ownerCopyRecipients,
      delivery,
    });
  } catch (error) {
    deliveryAuditFailure = examinationRoomOwnerRecoverableSideEffect(
      error,
      'EXAM_ROOM_V1_EMAIL_DELIVERY_AUDIT_RETRY_REQUIRED',
      'The room is active and its key is unchanged. Retry this same approval request to record delivery evidence; do not rotate the key.',
    );
    console.error('Examination Room key email audit needs recovery after activation', {
      code: deliveryAuditFailure.code,
      activationId,
    });
  }
  const persistedDelivery = examinationRoomPersistedDelivery(delivery, deliveryAudit);
  const recoveryActions = [
    escrowFailure?.recovery,
    deliveryAuditFailure?.recovery,
    delivery.status === 'sent' || delivery.status === 'suppressed'
      ? null
      : persistedDelivery.status === 'sent'
        ? 'This retry was not accepted by the email provider, but an earlier successful delivery remains recorded. Choose Resend existing key to try again; the room key was not changed.'
        : 'The room key is active and visible here. Correct the email configuration, then choose Resend existing key; do not rotate unless the key itself must change.',
  ].filter(Boolean);
  return {
    ok: true,
    ...activationResult,
    roomKey,
    activationCommitted: true,
    keyIssuanceStatus: recoveryActions.length > 0 ? 'active_recovery_required' : 'active',
    keyEscrow: escrowFailure || {
      status: escrowResult?.duplicate === true ? 'recovered' : 'escrowed',
      activationId,
    },
    keyRecovery: {
      status: escrowFailure ? 'deterministic_retry_available' : 'escrowed',
      activationId,
      deterministicRetry: true,
      roomKeyReturned: true,
    },
    deliveryAudit: deliveryAuditFailure || { status: 'recorded' },
    recoveryRequired: recoveryActions.length > 0,
    recoveryActions,
    deliveryStatus: persistedDelivery.status,
    deliverySafeErrorCode: persistedDelivery.safeErrorCode,
    deliveryAttemptStatus: delivery.status,
    deliveryAttemptSafeErrorCode: delivery.safeErrorCode || null,
    delivery: examinationRoomOwnerDeliverySummary(
      persistedDelivery,
      activationResult.professorEmail,
      ownerCopyRecipients,
    ),
    deliveryRecovery: recoveryActions.at(-1) || null,
    recipient: String(activationResult.professorEmail || '').trim().toLowerCase() || null,
    adminRecipients: ownerCopyRecipients,
    ownerRecipients: ownerCopyRecipients,
    schedule: activationWindow,
  };
}

function examinationRoomSnapshotValue(snapshot, camelName, snakeName) {
  return snapshot?.[camelName] ?? snapshot?.[snakeName];
}

function examinationRoomSnapshotDescriptor(snapshot) {
  const reference = String(examinationRoomSnapshotValue(
    snapshot,
    'encryptedObjectReference',
    'encrypted_object_reference',
  ) || '');
  const referencePrefix = EXAMINATION_ROOM_RECOVERY_REFERENCE_PREFIXES.find((prefix) => reference.startsWith(prefix));
  if (!referencePrefix) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_RECOVERY_NOT_AVAILABLE',
      'This recovery checkpoint has not finished materializing.',
      409,
      'Choose Retry for a failed checkpoint, or wait for a pending checkpoint to become Available.',
    );
  }
  const snapshotSha256 = String(examinationRoomSnapshotValue(
    snapshot,
    'snapshotSha256',
    'snapshot_sha256',
  ) || '').toLowerCase();
  if (!EXAMINATION_ROOM_OWNER_SHA256_PATTERN.test(snapshotSha256)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_RECOVERY_NOT_AVAILABLE',
      'This recovery checkpoint has no verified checksum yet.',
      409,
      'Wait for materialization or retry the failed checkpoint.',
    );
  }
  return {
    objectKey: reference.slice(referencePrefix.length),
    snapshotSha256,
  };
}

function examinationRoomOwnerBundleRows(bundle, tableName) {
  const rows = bundle?.tables?.[tableName];
  return Array.isArray(rows) ? rows : [];
}

function examinationRoomOwnerRowValue(row, camelName, snakeName = camelName) {
  return row?.[camelName] ?? row?.[snakeName] ?? null;
}

function examinationRoomOwnerKeyHistoryTime(record) {
  const time = Date.parse(String(record?.issuedAt || record?.createdAt || ''));
  return Number.isFinite(time) ? time : 0;
}

async function examinationRoomOwnerKeyHistory(env, bundle) {
  const activations = examinationRoomOwnerBundleRows(bundle, 'roomActivations');
  const envelopes = examinationRoomOwnerBundleRows(bundle, 'ownerKeyEnvelopes');
  const deliveryEvents = examinationRoomOwnerBundleRows(bundle, 'emailDeliveryEvents');
  const activationById = new Map(activations.map((activation) => [
    String(examinationRoomOwnerRowValue(activation, 'id') || ''),
    activation,
  ]));
  const deliveryByActivation = new Map();
  for (const event of deliveryEvents) {
    const activationId = String(examinationRoomOwnerRowValue(
      event,
      'activationId',
      'activation_id',
    ) || '');
    if (!activationId) continue;
    const listed = deliveryByActivation.get(activationId) || [];
    listed.push({
      id: examinationRoomOwnerRowValue(event, 'id'),
      kind: examinationRoomOwnerRowValue(event, 'deliveryKind', 'delivery_kind'),
      status: examinationRoomOwnerRowValue(event, 'providerStatus', 'provider_status'),
      providerId: examinationRoomOwnerRowValue(event, 'providerId', 'provider_id'),
      safeErrorCode: examinationRoomOwnerRowValue(event, 'safeErrorCode', 'safe_error_code'),
      professorRecipient: examinationRoomOwnerRowValue(
        event,
        'professorRecipient',
        'professor_recipient',
      ),
      ownerCopyRecipients: examinationRoomOwnerRowValue(
        event,
        'ownerCopyRecipients',
        'owner_copy_recipients',
      ) || [],
      attemptedAt: examinationRoomOwnerRowValue(event, 'attemptedAt', 'attempted_at'),
    });
    deliveryByActivation.set(activationId, listed);
  }

  const history = await Promise.all(envelopes.map(async (envelope) => {
    const activationId = examinationRoomOwnerUuid(
      examinationRoomOwnerRowValue(envelope, 'activationId', 'activation_id'),
      'room activation identifier',
    );
    const activation = activationById.get(activationId) || {};
    let roomKey = null;
    let keyStatus = 'available';
    let keyError = null;
    try {
      roomKey = await decryptExaminationRoomOwnerKey(env, {
        activationId,
        examId: examinationRoomOwnerRowValue(envelope, 'examId', 'exam_id'),
        institutionId: examinationRoomOwnerRowValue(
          envelope,
          'institutionId',
          'institution_id',
        ),
        algorithm: examinationRoomOwnerRowValue(
          envelope,
          'algorithm',
          'envelope_algorithm',
        ),
        keyVersion: examinationRoomOwnerRowValue(envelope, 'keyVersion', 'key_version'),
        ciphertext: examinationRoomOwnerRowValue(
          envelope,
          'ciphertext',
          'ciphertext_base64',
        ),
        iv: examinationRoomOwnerRowValue(envelope, 'iv', 'iv_base64'),
        aadSha256: examinationRoomOwnerRowValue(envelope, 'aadSha256', 'aad_sha256'),
      });
    } catch (error) {
      keyStatus = 'unavailable';
      keyError = {
        code: String(error?.code || 'EXAM_ROOM_V1_KEY_ESCROW_DECRYPT_FAILED'),
        message: String(error?.message || 'This historical key could not be recovered.'),
        recovery: String(error?.recovery || 'Verify the owner key version, then retry.'),
      };
    }
    const deliveries = (deliveryByActivation.get(activationId) || [])
      .sort((left, right) => Date.parse(String(right.attemptedAt || '')) - Date.parse(String(left.attemptedAt || '')));
    return {
      activationId,
      roomKey,
      keyStatus,
      ...(keyError ? { error: keyError } : {}),
      status: examinationRoomOwnerRowValue(
        activation,
        'activationStatus',
        'activation_status',
      ) || 'unknown',
      issuedAt: examinationRoomOwnerRowValue(activation, 'createdAt', 'created_at')
        || examinationRoomOwnerRowValue(envelope, 'createdAt', 'created_at'),
      opensAt: examinationRoomOwnerRowValue(activation, 'opensAt', 'opens_at'),
      closesAt: examinationRoomOwnerRowValue(activation, 'closesAt', 'closes_at'),
      revokedAt: examinationRoomOwnerRowValue(
        activation,
        'deactivatedAt',
        'deactivated_at',
      ),
      deactivationReason: examinationRoomOwnerRowValue(
        activation,
        'deactivationReason',
        'deactivation_reason',
      ),
      deliveries,
      latestDelivery: deliveries[0] || null,
    };
  }));
  return history.sort((left, right) => (
    examinationRoomOwnerKeyHistoryTime(right) - examinationRoomOwnerKeyHistoryTime(left)
    || right.activationId.localeCompare(left.activationId)
  ));
}

async function examinationRoomRecoveryResult(env, snapshot, includePayload) {
  const recovery = createExaminationRoomRecovery();
  const descriptor = examinationRoomSnapshotDescriptor(snapshot);
  return includePayload
    ? recovery.retrieve(env, descriptor)
    : recovery.verify(env, descriptor);
}

async function examinationRoomRecordVerifiedSnapshot(env, snapshotId, descriptor) {
  return ensureExaminationRoomOwnerResult(await examinationRoomV1ServiceRpc(
    env,
    'examination_room_v1_verify_recovery_snapshot',
    {
      p_snapshot_id: examinationRoomOwnerUuid(snapshotId, 'snapshot identifier'),
      p_snapshot_sha256: String(descriptor?.snapshotSha256 || '').toLowerCase(),
    },
  ));
}

function examinationRoomRecoveryMetadata(payload) {
  const snapshot = examinationRoomOwnerRecord(payload?.snapshot, 'snapshot metadata');
  return {
    snapshotId: examinationRoomOwnerUuid(
      examinationRoomSnapshotValue(snapshot, 'snapshotId', 'id'),
      'snapshot identifier',
    ),
    institutionId: examinationRoomOwnerUuid(payload.institutionId, 'institution identifier'),
    examId: examinationRoomOwnerUuid(payload.examId, 'examination identifier'),
    examVersionId: examinationRoomOwnerUuid(payload.examVersionId, 'examination version identifier'),
    sequence: Number(examinationRoomSnapshotValue(snapshot, 'snapshotSequence', 'snapshot_sequence')),
    scope: String(payload.scope || examinationRoomSnapshotValue(snapshot, 'snapshotScope', 'snapshot_scope') || ''),
    recordCount: Number(examinationRoomSnapshotValue(snapshot, 'recordCount', 'record_count') || 0),
    createdAt: String(examinationRoomSnapshotValue(snapshot, 'createdAt', 'created_at') || ''),
  };
}

export async function drainExaminationRoomRecovery(env) {
  const recovery = createExaminationRoomRecovery();
  const limit = 1;
  const summary = { claimed: 0, materialized: 0, failed: 0, leaseLost: 0 };
  for (let index = 0; index < limit; index += 1) {
    const claimed = ensureExaminationRoomOwnerResult(await examinationRoomV1ServiceRpc(
      env,
      'examination_room_v1_claim_recovery_snapshot',
      { p_lease_seconds: 300 },
    ));
    if (!claimed.job) break;
    summary.claimed += 1;
    const snapshotId = examinationRoomOwnerUuid(claimed.job.snapshotId, 'snapshot identifier');
    const leaseId = examinationRoomOwnerUuid(claimed.job.leaseId, 'snapshot lease identifier');
    try {
      const descriptor = await recovery.materialize(env, {
        metadata: examinationRoomRecoveryMetadata(claimed.job.payload),
        payload: claimed.job.payload,
        keyVersion: 'v1',
      });
      const completed = await examinationRoomV1ServiceRpc(
        env,
        'examination_room_v1_complete_recovery_snapshot',
        {
          p_snapshot_id: snapshotId,
          p_lease_id: leaseId,
          p_object_reference: descriptor.encryptedObjectReference,
          p_snapshot_sha256: descriptor.snapshotSha256,
          p_encryption_key_reference: descriptor.encryptionKeyReference,
        },
      );
      if (completed?.ok === true) summary.materialized += 1;
      else summary.leaseLost += 1;
    } catch (error) {
      summary.failed += 1;
      const attempts = Number(examinationRoomSnapshotValue(
        claimed.job.payload?.snapshot,
        'materializationAttempts',
        'materialization_attempts',
      ) || 1);
      const retryAfter = Math.min(3_600, 30 * (2 ** Math.min(7, Math.max(0, attempts - 1))));
      await examinationRoomV1ServiceRpc(
        env,
        'examination_room_v1_fail_recovery_snapshot',
        {
          p_snapshot_id: snapshotId,
          p_lease_id: leaseId,
          p_error_code: String(error?.code || 'BACKUP_FAILED').slice(0, 80),
          p_retry_after_seconds: retryAfter,
        },
      ).catch(() => null);
    }
  }
  return summary;
}

function scheduleExaminationRoomRecoveryDrain(env, ctx) {
  if (typeof ctx?.waitUntil !== 'function') return false;
  ctx.waitUntil(drainExaminationRoomRecovery(env).catch((error) => {
    console.error('Examination Room immediate recovery drain failed; scheduled retry remains active', {
      code: String(error?.code || 'EXAM_ROOM_V1_RECOVERY_DRAIN_FAILED').slice(0, 80),
    });
    return { claimed: 0, materialized: 0, failed: 1, leaseLost: 0 };
  }));
  return true;
}

async function examinationRoomOwnerResponse(work, origin, allowedOrigin) {
  try {
    return await work();
  } catch (error) {
    const known = error instanceof ExaminationRoomV1RouteError
      || error instanceof ExaminationRoomRecoveryError;
    return jsonResponse({
      ok: false,
      error: {
        code: known ? error.code : 'EXAM_ROOM_V1_INTERNAL_ERROR',
        message: known
          ? error.message
          : 'Examination Room encountered an unexpected owner-command problem.',
        recovery: known
          ? error.recovery
          : 'No saved examination data was removed. Refresh Admin and try again.',
        ...(known && error.details !== undefined ? { details: error.details } : {}),
      },
    }, known ? error.status : 500, origin, allowedOrigin);
  }
}

function examinationRoomOwnerPagingValue(value, label, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_PAGING_INVALID',
      `${label} must be a whole number from ${minimum.toLocaleString('en-US')} to ${maximum.toLocaleString('en-US')}.`,
      400,
      'Refresh the command center and load the page again.',
    );
  }
  return number;
}

function examinationRoomOwnerQueryPayload(operation, payload) {
  if (!['command_center', 'audit_log', 'recovery_detail'].includes(operation)) return payload;
  const allowed = new Set(['institutionId', 'examId', 'limit', 'offset']);
  if (operation === 'recovery_detail') {
    allowed.add('snapshotId');
    allowed.add('includeBundle');
    allowed.add('verify');
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_FILTER_UNSUPPORTED',
      'The command-center request contains an unsupported filter.',
      400,
      'Refresh Admin and load the view again.',
    );
  }
  const safe = {
    ...(payload.institutionId ? { institutionId: payload.institutionId } : {}),
    ...(payload.examId ? { examId: payload.examId } : {}),
    limit: examinationRoomOwnerPagingValue(payload.limit, 'Page size', 1, 500, 100),
    offset: examinationRoomOwnerPagingValue(payload.offset, 'Page offset', 0, 10_000_000, 0),
  };
  if (operation === 'recovery_detail') {
    if (payload.snapshotId) {
      safe.snapshotId = examinationRoomOwnerUuid(payload.snapshotId, 'snapshot identifier');
    }
    if (payload.includeBundle !== undefined) safe.includeBundle = payload.includeBundle === true;
    if (payload.verify !== undefined) safe.verify = payload.verify === true;
  }
  return safe;
}

function examinationRoomLifecycleRecordId(record) {
  return String(record?.examId || record?.exam_id || record?.id || '').trim();
}

function examinationRoomLifecycleFields(item) {
  if (!item || typeof item !== 'object') return {};
  const deletedAt = item.deletedAt || item.deleted_at || null;
  const blockedAt = item.blockedAt || item.blocked_at || null;
  return {
    lifecycleState: deletedAt ? 'archived' : blockedAt ? 'blocked' : null,
    blockedAt,
    blockedByUserId: item.blockedByUserId || item.blocked_by_user_id || null,
    blockReason: item.blockReason || item.block_reason || null,
    isBlocked: Boolean(blockedAt),
    deletedAt,
    deletedByUserId: item.deletedByUserId || item.deleted_by_user_id || null,
    deleteReason: item.deleteReason || item.delete_reason || null,
    archivedAt: deletedAt,
    deleted: Boolean(deletedAt),
    priorStatus: item.priorStatus || item.prior_status || null,
    canRestore: item.canRestore === true || item.can_restore === true,
    needsNewKey: item.needsNewKey === true || item.needs_new_key === true,
  };
}

function examinationRoomApplyLifecycleToRecord(record, lifecycleByExam) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const item = lifecycleByExam.get(examinationRoomLifecycleRecordId(record));
  return item ? { ...record, ...examinationRoomLifecycleFields(item) } : record;
}

function examinationRoomMergeOwnerLifecycle(result, lifecycle) {
  const items = Array.isArray(lifecycle?.items) ? lifecycle.items : [];
  const lifecycleByExam = new Map(items.map((item) => [
    examinationRoomLifecycleRecordId(item),
    item,
  ]).filter(([examId]) => examId));
  if (!lifecycleByExam.size) return result;
  const merged = {
    ...result,
    lifecycle: { items },
    ...(Array.isArray(result?.exams)
      ? { exams: result.exams.map((record) => examinationRoomApplyLifecycleToRecord(record, lifecycleByExam)) }
      : {}),
    ...(result?.exam && typeof result.exam === 'object'
      ? { exam: examinationRoomApplyLifecycleToRecord(result.exam, lifecycleByExam) }
      : {}),
    ...(result?.counts && typeof result.counts === 'object'
      ? {
          counts: {
            ...result.counts,
            blocked: items.filter((item) => Boolean(item?.blocked || item?.blockedAt || item?.blocked_at)).length,
            archived: items.filter((item) => Boolean(item?.deleted || item?.deletedAt || item?.deleted_at)).length,
          },
        }
      : {}),
  };
  if (!result?.bundle || typeof result.bundle !== 'object') return merged;
  const tables = result.bundle.tables && typeof result.bundle.tables === 'object'
    ? {
        ...result.bundle.tables,
        ...(Array.isArray(result.bundle.tables.exams)
          ? { exams: result.bundle.tables.exams.map((record) => examinationRoomApplyLifecycleToRecord(record, lifecycleByExam)) }
          : {}),
      }
    : result.bundle.tables;
  const bundleExamId = examinationRoomLifecycleRecordId(result.bundle);
  const bundleLifecycle = bundleExamId && lifecycleByExam.has(bundleExamId)
    ? examinationRoomLifecycleFields(lifecycleByExam.get(bundleExamId))
    : {};
  merged.bundle = {
    ...result.bundle,
    ...bundleLifecycle,
    ...(result.bundle.exam && typeof result.bundle.exam === 'object'
      ? { exam: examinationRoomApplyLifecycleToRecord(result.bundle.exam, lifecycleByExam) }
      : {}),
    ...(tables ? { tables } : {}),
    lifecycle: { items },
  };
  return merged;
}

async function handleExaminationRoomOwnerQuery(request, env, origin, allowedOrigin) {
  return examinationRoomOwnerResponse(async () => {
    await enforceExaminationRoomV1RateLimit(request, env, 'admin_query');
    const owner = await requireExaminationRoomPlatformOwner(request, env);
    const body = examinationRoomOwnerRecord(await parseBoundedJson(request.clone(), 24_000));
    const operation = String(body.operation || '').trim();
    const payload = examinationRoomOwnerRecord(body.payload || {});
    const institutionId = payload.institutionId
      ? examinationRoomOwnerUuid(payload.institutionId, 'institution identifier')
      : null;
    const examId = payload.examId
      ? examinationRoomOwnerUuid(payload.examId, 'examination identifier')
      : null;

    if (operation === 'staff_directory') {
      if (!institutionId) {
        throw examinationRoomOwnerError(
          'EXAM_ROOM_V1_INSTITUTION_REQUIRED',
          'Choose a law-school workspace.',
          400,
          'Select a school from the command-center menu, then try again.',
        );
      }
      await examinationRoomV1OwnerEnsureMembership(env, owner.user.id, institutionId);
      return examinationRoomV1Handlers.adminQuery(request, env, origin, allowedOrigin);
    }

    if (operation === 'preflight') {
      return jsonResponse(await examinationRoomOwnerPreflight(env), 200, origin, allowedOrigin);
    }

    const directOperations = new Set([
      'access', 'overview', 'command_center', 'exam_detail',
      'export_exam_bundle', 'audit_log', 'recovery_detail',
    ]);
    if (!directOperations.has(operation)) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OPERATION_UNSUPPORTED',
        'That owner command-center view is not available.',
        400,
        'Refresh Admin and choose one of the listed views.',
      );
    }

    const safeQueryPayload = examinationRoomOwnerQueryPayload(operation, payload);

    let result = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
      operation,
      actorUserId: owner.user.id,
      institutionId,
      examId,
      payload: safeQueryPayload,
    }));
    if (['overview', 'command_center', 'exam_detail', 'export_exam_bundle'].includes(operation)) {
      const lifecycle = ensureExaminationRoomOwnerResult(await examinationRoomV1LifecycleQueryRpc(env, {
        actorUserId: owner.user.id,
        institutionId,
        examId,
      }));
      result = examinationRoomMergeOwnerLifecycle(result, lifecycle);
    }
    if (operation === 'exam_detail' || operation === 'export_exam_bundle') {
      const keyHistory = await examinationRoomOwnerKeyHistory(env, result.bundle);
      const latestKeyRecord = keyHistory[0] || null;
      return jsonResponse({
        ok: true,
        ...result,
        bundle: {
          ...result.bundle,
          latestKeyRecord,
          keyHistory,
        },
        latestKeyRecord,
        keyHistory,
      }, 200, origin, allowedOrigin);
    }
    if (operation !== 'recovery_detail' || !safeQueryPayload.snapshotId) {
      return jsonResponse({ ok: true, ...result }, 200, origin, allowedOrigin);
    }

    const snapshotId = safeQueryPayload.snapshotId;
    const snapshots = Array.isArray(result.snapshots) ? result.snapshots : [];
    const snapshot = snapshots.find((entry) => String(entry?.id || entry?.snapshotId) === snapshotId);
    if (!snapshot) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_RECOVERY_NOT_FOUND',
        'That recovery checkpoint is no longer in the selected examination.',
        404,
        'Refresh Recovery and choose a current checkpoint.',
      );
    }
    if (safeQueryPayload.includeBundle === true) {
      const recovered = await examinationRoomRecoveryResult(env, snapshot, true);
      const recordedVerification = await examinationRoomRecordVerifiedSnapshot(
        env,
        snapshotId,
        recovered.descriptor,
      );
      return jsonResponse({
        ok: true,
        snapshots,
        snapshot,
        verified: true,
        verificationStatus: 'verified',
        descriptor: recovered.descriptor,
        bundle: recovered.payload,
        verifiedAt: recordedVerification.verifiedAt,
      }, 200, origin, allowedOrigin);
    }
    if (safeQueryPayload.verify === true) {
      const verification = await examinationRoomRecoveryResult(env, snapshot, true);
      const recordedVerification = await examinationRoomRecordVerifiedSnapshot(
        env,
        snapshotId,
        verification.descriptor,
      );
      return jsonResponse({
        ok: true,
        snapshots,
        snapshot,
        verified: true,
        verificationStatus: 'verified',
        descriptor: verification.descriptor,
        bundle: verification.payload,
        verifiedAt: recordedVerification.verifiedAt,
      }, 200, origin, allowedOrigin);
    }
    return jsonResponse({ ok: true, ...result, snapshot }, 200, origin, allowedOrigin);
  }, origin, allowedOrigin);
}

async function resendExaminationRoomOwnerKey(env, owner, request, body, payload) {
  const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
  const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
  const requestKey = examinationRoomOwnerRequestKey(request, body);
  const requestHash = await examinationRoomOwnerRequestHash(env, requestKey);
  const envelope = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
    operation: 'key_envelope', actorUserId: owner.user.id, institutionId, examId, payload: {},
  }));
  const roomKey = await decryptExaminationRoomOwnerKey(env, envelope);
  const center = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
    operation: 'command_center',
    actorUserId: owner.user.id,
    institutionId,
    examId,
    payload: { limit: 1, offset: 0 },
  }));
  const exam = (Array.isArray(center.exams) ? center.exams : [])
    .find((entry) => String(entry?.examId || entry?.id) === examId);
  const ownerCopyRecipients = examinationRoomAdminEmailRecipients(env, exam?.professorEmail);
  const delivery = await sendExaminationRoomV1KeyEmail(env, {
    recipient: exam?.professorEmail,
    professorName: exam?.professorName,
    examTitle: exam?.title,
    roomKey,
    expiresAt: exam?.activation?.closesAt,
    idempotencyHash: requestHash,
    ownerRecipients: ownerCopyRecipients,
  });
  let deliveryAudit = null;
  let deliveryAuditFailure = null;
  try {
    deliveryAudit = await recordExaminationRoomOwnerEmailDelivery(env, owner, {
      institutionId,
      examId,
      activationId: envelope.activationId,
      requestHash,
      deliveryKind: 'key_resend',
      professorRecipient: String(exam?.professorEmail || '').trim().toLowerCase() || null,
      ownerCopyRecipients,
      delivery,
    });
  } catch (error) {
    deliveryAuditFailure = examinationRoomOwnerRecoverableSideEffect(
      error,
      'EXAM_ROOM_V1_EMAIL_DELIVERY_AUDIT_RETRY_REQUIRED',
      'The current room key is unchanged. Retry Resend existing key to record delivery evidence.',
    );
    console.error('Examination Room key resend audit needs recovery', {
      code: deliveryAuditFailure.code,
      activationId: envelope.activationId,
    });
  }
  const persistedDelivery = examinationRoomPersistedDelivery(delivery, deliveryAudit);
  return {
    ok: true,
    examId,
    activationId: envelope.activationId,
    roomKey,
    deliveryAudit: deliveryAuditFailure || { status: 'recorded' },
    deliveryStatus: persistedDelivery.status,
    deliverySafeErrorCode: persistedDelivery.safeErrorCode,
    deliveryAttemptStatus: delivery.status,
    deliveryAttemptSafeErrorCode: delivery.safeErrorCode || null,
    delivery: examinationRoomOwnerDeliverySummary(
      persistedDelivery,
      exam?.professorEmail,
      ownerCopyRecipients,
    ),
    deliveryRecovery: deliveryAuditFailure?.recovery || (delivery.status === 'sent'
      ? null
      : persistedDelivery.status === 'sent'
        ? 'This retry was not accepted by the email provider, but an earlier successful delivery remains recorded. Choose Resend existing key to try again; the current key was not changed.'
        : 'Correct the email configuration, then choose Resend existing key again. The current key was not changed.'),
    recipient: String(exam?.professorEmail || '').trim().toLowerCase() || null,
    adminRecipients: ownerCopyRecipients,
    ownerRecipients: ownerCopyRecipients,
  };
}

function examinationRoomOwnerCommandText(value, label, options = {}) {
  if (value == null || value === '') {
    if (!options.required) return null;
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_FIELD_REQUIRED',
      `${label} is required.`,
      400,
      `Complete ${label.toLowerCase()}, then try the action again.`,
    );
  }
  if (typeof value !== 'string') {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_FIELD_INVALID',
      `${label} is invalid.`,
      400,
      `Correct ${label.toLowerCase()}, then try the action again.`,
    );
  }
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const maximum = Number(options.maximum || 1_000);
  const minimum = Number(options.minimum || (options.required ? 1 : 0));
  if (normalized.length < minimum
      || normalized.length > maximum
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/iu.test(normalized)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_FIELD_INVALID',
      `${label} must contain ${minimum} to ${maximum} safe characters.`,
      400,
      `Correct ${label.toLowerCase()}, then try the action again.`,
    );
  }
  return normalized;
}

function examinationRoomValidatedOwnerDirectPayload(operation, payload) {
  const common = new Set(['institutionId', 'examId']);
  const reason = () => examinationRoomOwnerCommandText(payload.reason, 'Owner receipt note', {
    required: true,
    minimum: 5,
    maximum: 1_000,
  });
  if (operation === 'correct_student_identity') {
    const allowed = new Set([
      ...common, 'studentIdentityId', 'fullName', 'studentNumber', 'email', 'clearEmail', 'reason',
    ]);
    if (Object.keys(payload).some((key) => !allowed.has(key))) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OWNER_FIELD_UNSUPPORTED',
        'The student correction contains an unsupported field.',
        400,
        'Refresh Students, reopen the correction form, and try again.',
      );
    }
    const fullName = examinationRoomOwnerCommandText(payload.fullName, 'Student name', { maximum: 160 });
    const studentNumber = examinationRoomOwnerCommandText(payload.studentNumber, 'Student number', { maximum: 64 });
    const email = examinationRoomOwnerCommandText(payload.email, 'Student email', { maximum: 254 });
    const hasClearEmail = Object.prototype.hasOwnProperty.call(payload, 'clearEmail');
    if (hasClearEmail && typeof payload.clearEmail !== 'boolean') {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_STUDENT_EMAIL_CLEAR_INVALID',
        'The remove-email choice is invalid.',
        400,
        'Refresh Students and select or clear the Remove stored student email checkbox.',
      );
    }
    const clearEmail = payload.clearEmail === true;
    if (clearEmail && email) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_STUDENT_EMAIL_ACTION_CONFLICT',
        'Choose either a corrected student email or Remove stored student email.',
        400,
        'Clear the email field or clear the remove-email checkbox, then try again.',
      );
    }
    if (!fullName && !studentNumber && !email && !clearEmail) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_STUDENT_CORRECTION_REQUIRED',
        'Enter at least one corrected student detail.',
        400,
        'Enter the corrected name, student number, or email, or explicitly remove the stored email, then try again.',
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_STUDENT_EMAIL_INVALID',
        'Enter a valid student email address.',
        400,
        'Correct the email or leave it blank when it should remain unchanged.',
      );
    }
    return {
      institutionId: payload.institutionId,
      examId: payload.examId,
      studentIdentityId: examinationRoomOwnerUuid(
        payload.studentIdentityId,
        'student identity identifier',
      ),
      ...(fullName ? { fullName } : {}),
      ...(studentNumber ? { studentNumber } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(clearEmail ? { clearEmail: true } : {}),
      reason: reason(),
    };
  }
  if (operation === 'set_submission_status') {
    const allowed = new Set([...common, 'submissionId', 'status', 'reason']);
    if (Object.keys(payload).some((key) => !allowed.has(key))) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OWNER_FIELD_UNSUPPORTED',
        'The submission action contains an unsupported field.',
        400,
        'Refresh Answers, reopen the status form, and try again.',
      );
    }
    const status = String(payload.status || '').trim().toLowerCase();
    if (!['accepted', 'under_review', 'voided'].includes(status)) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_SUBMISSION_STATUS_INVALID',
        'Choose Accepted, Under review, or Voided.',
        400,
        'Choose one listed submission status, then try again.',
      );
    }
    return {
      institutionId: payload.institutionId,
      examId: payload.examId,
      submissionId: examinationRoomOwnerUuid(payload.submissionId, 'submission identifier'),
      status,
      reason: reason(),
    };
  }
  const allowed = new Set([...common, 'action', 'reason']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OWNER_FIELD_UNSUPPORTED',
      'The room-control action contains an unsupported field.',
      400,
      'Refresh Examinations, reopen Room control, and try again.',
    );
  }
  const action = String(payload.action || '').trim().toLowerCase();
  if (!['open', 'close'].includes(action)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_ROOM_ACTION_INVALID',
      'Choose Open room or Close room.',
      400,
      'Choose one listed room action, then try again.',
    );
  }
  return {
    institutionId: payload.institutionId,
    examId: payload.examId,
    action,
    reason: reason(),
  };
}

async function handleExaminationRoomOwnerCommand(
  request,
  env,
  origin,
  allowedOrigin,
  executionContext = null,
) {
  return examinationRoomOwnerResponse(async () => {
    await enforceExaminationRoomV1RateLimit(request, env, 'admin_command');
    const owner = await requireExaminationRoomPlatformOwner(request, env);
    const body = examinationRoomOwnerRecord(await parseBoundedJson(request.clone(), 220_000));
    const operation = String(body.operation || '').trim();
    const payload = examinationRoomOwnerRecord(body.payload || {});

    if (['approve_and_email_key', 'activate_exam'].includes(operation)) {
      const result = await issueExaminationRoomOwnerKey(env, owner, request, body, payload, {
        replaceCurrent: false,
        deliveryKind: 'activation_key',
      });
      return jsonResponse(result, 201, origin, allowedOrigin);
    }
    if (['email_key', 'rotate_key'].includes(operation)) {
      const result = await issueExaminationRoomOwnerKey(env, owner, request, body, payload, {
        replaceCurrent: true,
        deliveryKind: 'key_rotation',
      });
      return jsonResponse(result, 200, origin, allowedOrigin);
    }
    if (operation === 'reveal_key') {
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
      if (payload.activationId) {
        const activationId = examinationRoomOwnerUuid(
          payload.activationId,
          'room activation identifier',
        );
        const detail = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
          operation: 'exam_detail',
          actorUserId: owner.user.id,
          institutionId,
          examId,
          payload: {},
        }));
        const record = (await examinationRoomOwnerKeyHistory(env, detail.bundle))
          .find((entry) => entry.activationId === activationId);
        if (!record) {
          throw examinationRoomOwnerError(
            'EXAM_ROOM_V1_ROOM_KEY_HISTORY_NOT_FOUND',
            'That historical room key is not available for this examination.',
            404,
            'Refresh the examination detail and choose a listed key activation.',
          );
        }
        if (!record.roomKey) {
          throw examinationRoomOwnerError(
            record.error?.code || 'EXAM_ROOM_V1_KEY_ESCROW_DECRYPT_FAILED',
            record.error?.message || 'That historical room key could not be recovered.',
            409,
            record.error?.recovery || 'Verify the owner key version, then retry.',
          );
        }
        return jsonResponse({
          ok: true,
          examId,
          activationId,
          roomKey: record.roomKey,
          keyRecord: record,
        }, 200, origin, allowedOrigin);
      }
      const envelope = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
        operation: 'key_envelope', actorUserId: owner.user.id, institutionId, examId, payload: {},
      }));
      return jsonResponse({
        ok: true,
        examId,
        activationId: envelope.activationId,
        roomKey: await decryptExaminationRoomOwnerKey(env, envelope),
        keyVersion: envelope.keyVersion,
      }, 200, origin, allowedOrigin);
    }
    if (operation === 'resend_key') {
      return jsonResponse(
        await resendExaminationRoomOwnerKey(env, owner, request, body, payload),
        200,
        origin,
        allowedOrigin,
      );
    }

    const lifecycleCommands = new Set([
      'reopen_exam', 'block_exam', 'unblock_exam', 'archive_exam', 'restore_exam',
    ]);
    if (lifecycleCommands.has(operation)) {
      const allowed = new Set(['institutionId', 'examId', 'reason']);
      if (Object.keys(payload).some((key) => !allowed.has(key))) {
        throw examinationRoomOwnerError(
          'EXAM_ROOM_V1_OWNER_FIELD_UNSUPPORTED',
          'The examination lifecycle action contains an unsupported field.',
          400,
          'Refresh the selected examination and choose the lifecycle action again.',
        );
      }
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
      const reason = examinationRoomOwnerCommandText(payload.reason, 'Owner receipt note', {
        required: true,
        minimum: 5,
        maximum: 1_000,
      });
      const requestHash = await examinationRoomOwnerRequestHash(
        env,
        examinationRoomOwnerRequestKey(request, body),
      );
      const lifecycleResult = ensureExaminationRoomOwnerResult(await examinationRoomV1LifecycleCommandRpc(env, {
        operation,
        actorUserId: owner.user.id,
        institutionId,
        examId,
        payload: { requestHash, reason },
      }));
      if (operation !== 'reopen_exam') {
        return jsonResponse({ ok: true, ...lifecycleResult }, 200, origin, allowedOrigin);
      }
      const keyResult = await issueExaminationRoomOwnerKey(
        env,
        owner,
        request,
        body,
        { institutionId, examId },
        { replaceCurrent: true, deliveryKind: 'key_rotation' },
      );
      return jsonResponse({
        ok: true,
        ...keyResult,
        reopened: true,
        lifecycle: lifecycleResult,
      }, 200, origin, allowedOrigin);
    }

    if (operation === 'retry_snapshot') {
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
      const requestHash = await examinationRoomOwnerRequestHash(
        env,
        examinationRoomOwnerRequestKey(request, body),
      );
      const result = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerCommandRpc(env, {
        operation,
        actorUserId: owner.user.id,
        institutionId,
        examId,
        payload: {
          ...payload,
          snapshotId: examinationRoomOwnerUuid(payload.snapshotId, 'snapshot identifier'),
          requestHash,
        },
      }));
      const materialization = await drainExaminationRoomRecovery(env);
      return jsonResponse({ ok: true, ...result, materialization }, 200, origin, allowedOrigin);
    }

    if (operation === 'restore_snapshot' || operation === 'verify_snapshot') {
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
      const snapshotId = examinationRoomOwnerUuid(payload.snapshotId, 'snapshot identifier');
      const details = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerQueryRpc(env, {
        operation: 'recovery_detail',
        actorUserId: owner.user.id,
        institutionId,
        examId,
        payload: { snapshotId, limit: 1, offset: 0 },
      }));
      const snapshot = (Array.isArray(details.snapshots) ? details.snapshots : [])
        .find((entry) => String(entry?.id || entry?.snapshotId) === snapshotId);
      if (!snapshot) {
        throw examinationRoomOwnerError(
          'EXAM_ROOM_V1_RECOVERY_NOT_FOUND',
          'That recovery checkpoint is no longer available.',
          404,
          'Refresh Recovery and choose a current checkpoint.',
        );
      }
      const recovered = await examinationRoomRecoveryResult(env, snapshot, operation === 'restore_snapshot');
      const recordedVerification = await examinationRoomRecordVerifiedSnapshot(
        env,
        snapshotId,
        recovered.descriptor,
      );
      return jsonResponse({
        ok: true,
        snapshotId,
        verified: true,
        verificationStatus: 'verified',
        status: operation === 'restore_snapshot' ? 'verification_only' : 'verified',
        restored: false,
        descriptor: recovered.descriptor,
        verifiedAt: recordedVerification.verifiedAt,
        ...(operation === 'restore_snapshot' ? {
          recoveryBundle: recovered.payload,
          message: 'The encrypted checkpoint was authenticated and decrypted. No live database rows were overwritten.',
          recovery: 'Download this verified bundle or use a supervised database-recovery procedure before changing live records.',
        } : {}),
      }, 200, origin, allowedOrigin);
    }

    const ownerDirectCommands = new Set([
      'correct_student_identity', 'set_submission_status', 'room_control',
    ]);
    if (ownerDirectCommands.has(operation)) {
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
      const safePayload = examinationRoomValidatedOwnerDirectPayload(operation, payload);
      const requestHash = await examinationRoomOwnerRequestHash(
        env,
        examinationRoomOwnerRequestKey(request, body),
      );
      const result = ensureExaminationRoomOwnerResult(await examinationRoomV1OwnerCommandRpc(env, {
        operation,
        actorUserId: owner.user.id,
        institutionId,
        examId,
        payload: { ...safePayload, requestHash },
      }));
      scheduleExaminationRoomRecoveryDrain(env, executionContext);
      return jsonResponse({ ok: true, ...result }, 200, origin, allowedOrigin);
    }

    const delegatedCommands = new Set([
      'bootstrap_institution', 'assign_staff', 'revoke_staff',
      'reject_professor_request', 'revoke_key', 'create_snapshot',
    ]);
    if (!delegatedCommands.has(operation)) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OPERATION_UNSUPPORTED',
        'That owner command-center action is not available.',
        400,
        'Refresh Admin and choose one of the listed actions.',
      );
    }
    if (operation !== 'bootstrap_institution') {
      const institutionId = examinationRoomOwnerUuid(payload.institutionId, 'institution identifier');
      await examinationRoomV1OwnerEnsureMembership(env, owner.user.id, institutionId);
    }
    const response = await examinationRoomV1Handlers.adminCommand(request, env, origin, allowedOrigin);
    if (operation !== 'create_snapshot' || !response.ok) {
      if (operation === 'revoke_key' && response.ok) {
        scheduleExaminationRoomRecoveryDrain(env, executionContext);
      }
      return response;
    }
    const responseBody = await response.clone().json().catch(() => null);
    const materialization = await drainExaminationRoomRecovery(env);
    return jsonResponse({ ...responseBody, materialization }, response.status, origin, allowedOrigin);
  }, origin, allowedOrigin);
}

async function examinationRoomProfessorImportContext(
  request,
  env,
  requestedInstitutionId,
  authenticatedUser = null,
) {
  const user = authenticatedUser || await verifiedAuthenticatedUser(request, env);
  if (!user?.id) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED',
      'A Due Diligence sign-in is required.',
      401,
      'Sign in through Due Diligence, then reopen Examination Room.',
    );
  }
  const institutionId = examinationRoomOwnerUuid(
    requestedInstitutionId,
    'institution identifier',
  );
  // Both batch-context and atomic-import RPCs independently authorize this
  // verified actor against the exact institution/exam. Keeping authorization
  // in those database transactions avoids one HTTP subrequest per student and
  // lets platform owners use the same tested grading path without weakening it.
  return { user, institutionId };
}

function examinationRoomSimpleOfflineGrade(value, index) {
  const grade = examinationRoomOwnerRecord(value, `offline grade ${index + 1}`);
  const allowed = new Set(['sessionId', 'questionId', 'points', 'feedback']);
  if (Object.keys(grade).some((key) => !allowed.has(key))) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OFFLINE_GRADE_INVALID',
      `Offline grade ${index + 1} contains an unsupported field.`,
      400,
      'Export a fresh graded package from the Due Diligence offline workspace, then import it again.',
    );
  }
  const questionId = String(grade.questionId || '').normalize('NFKC').trim();
  const feedback = grade.feedback == null ? '' : grade.feedback;
  const points = Number(grade.points);
  if (!questionId
      || questionId.length > 128
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/iu.test(questionId)
      || typeof feedback !== 'string'
      || Array.from(feedback).length > 20_000
      || !Number.isFinite(points)
      || points < 0
      || points > 1_000_000) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OFFLINE_GRADE_INVALID',
      `Offline grade ${index + 1} contains an invalid question, score, or feedback value.`,
      400,
      'Open the original offline grading copy, correct the listed grade, export it again, then import the fresh file.',
    );
  }
  return {
    sessionId: examinationRoomOwnerUuid(grade.sessionId, 'student session identifier'),
    questionId,
    points,
    feedback,
  };
}

function examinationRoomUuidFromDigest(digest) {
  const hex = String(digest || '').toLowerCase();
  if (!EXAMINATION_ROOM_OWNER_SHA256_PATTERN.test(hex)) {
    throw examinationRoomOwnerError(
      'EXAM_ROOM_V1_OFFLINE_GRADE_HASH_INVALID',
      'The offline grading receipt could not be created.',
      503,
      'No grades were saved. Retry the same import once.',
    );
  }
  const chars = hex.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = (8 | (Number.parseInt(chars[16], 16) & 3)).toString(16);
  const compact = chars.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function examinationRoomOfflineGradeQuestion(publicationManifest, reference) {
  const clientQuestionNumber = /^q-(\d{1,3})$/u.test(reference)
    ? Number(reference.slice(2))
    : Number(reference);
  return publicationManifest.questions.find((entry) => (
    entry.key === reference
    || String(entry.number) === reference
    || entry.number === clientQuestionNumber
  ));
}

async function examinationRoomPrepareOfflineGradeSession(
  env,
  context,
  examId,
  batchRequestHash,
  sessionId,
  entries,
  gradingContext,
) {
  let publicationManifest;
  try {
    publicationManifest = normalizePublicationManifest(gradingContext.publicationManifest);
  } catch (error) {
    if (!isExaminationRoomV1Error(error)) throw error;
    throw examinationRoomOwnerError(
      error.code,
      error.message,
      409,
      'Refresh the online grading view, export a new offline copy, then import that matching copy.',
      error.details,
    );
  }

  const replacements = [];
  const replacedNumbers = new Set();
  for (const entry of entries) {
    const question = examinationRoomOfflineGradeQuestion(publicationManifest, entry.questionId);
    if (!question) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_QUESTION_NOT_FOUND',
        `Question ${entry.questionId} is not part of this submitted examination version.`,
        409,
        'Refresh grading, export a new offline copy, and import that matching copy.',
      );
    }
    if (replacedNumbers.has(question.number)) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OFFLINE_GRADE_DUPLICATE',
        `The offline package contains more than one grade for question ${question.number} in the same student submission.`,
        409,
        'Keep the latest grade for that student and question, export again, then retry the import.',
      );
    }
    replacedNumbers.add(question.number);
    replacements.push({
      questionNumber: question.number,
      pointsAwarded: entry.points,
      feedback: entry.feedback,
    });
  }

  const priorScores = Array.isArray(gradingContext.scores) ? gradingContext.scores : [];
  const sessionRequestHash = await hmacHex(
    String(env.EXAMINATION_ROOM_KEY_PEPPER).trim(),
    `offline-grade-session\0${batchRequestHash}\0${context.institutionId}\0${examId}\0${sessionId}`,
  );
  let grade;
  try {
    grade = buildGradingRevision({
      revisionId: examinationRoomUuidFromDigest(sessionRequestHash),
      revision: Number(gradingContext.nextRevision || 1),
      status: GRADING_REVISION_STATUSES.DRAFT,
      graderId: context.user.id,
      gradedAt: new Date().toISOString(),
      idempotencyKey: sessionRequestHash,
      scores: priorScores
        .filter((score) => !replacedNumbers.has(Number(score.questionNumber)))
        .concat(replacements),
      overallFeedback: String(gradingContext.overallFeedback || ''),
    }, { submissionManifest: gradingContext.submissionManifest });
  } catch (error) {
    if (!isExaminationRoomV1Error(error)) throw error;
    throw examinationRoomOwnerError(
      error.code,
      error.message,
      409,
      'Correct the affected offline score, export the graded copy again, then retry the complete import.',
      error.details,
    );
  }
  const { idempotencyKey: _discardedIdempotencyKey, ...gradingManifest } = grade.manifest;
  return {
    examId,
    sessionId,
    requestHash: sessionRequestHash,
    clientRevisionId: examinationRoomUuidFromDigest(sessionRequestHash),
    gradingManifest,
    gradingHash: await sha256Hex(new TextEncoder().encode(grade.hashInput)),
  };
}

async function handleExaminationRoomProfessorImportGrades(
  request,
  env,
  origin,
  allowedOrigin,
  prepared = {},
) {
  return examinationRoomOwnerResponse(async () => {
    const body = examinationRoomOwnerRecord(
      prepared.body || await parseBoundedJson(request, 12_000_000),
    );
    const payload = examinationRoomOwnerRecord(body.payload || {});
    const context = await examinationRoomProfessorImportContext(
      request,
      env,
      payload.institutionId,
      prepared.authenticatedUser,
    );
    const examId = examinationRoomOwnerUuid(payload.examId, 'examination identifier');
    if (!Array.isArray(payload.grades) || payload.grades.length < 1 || payload.grades.length > 1_000) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OFFLINE_GRADE_BATCH_INVALID',
        'Choose a graded package containing 1 to 1,000 changed question grades.',
        400,
        'Export a fresh graded package from the offline workspace, then import it again.',
      );
    }
    const requestHash = await examinationRoomOwnerRequestHash(
      env,
      examinationRoomOwnerRequestKey(request, body),
    );
    const simpleFormat = payload.grades.every((grade) => (
      grade && typeof grade === 'object' && !Array.isArray(grade)
      && 'sessionId' in grade && 'questionId' in grade && 'points' in grade
      && !('gradingManifest' in grade)
    ));
    if (!simpleFormat) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OFFLINE_GRADE_BATCH_INVALID',
        'The offline grade list is not in the official changed-question format.',
        400,
        'Export one fresh graded copy from the current Due Diligence offline workspace, then import that file.',
      );
    }

    const simpleGrades = payload.grades.map((grade, index) => (
      examinationRoomSimpleOfflineGrade(grade, index)
    ));
    const grouped = new Map();
    for (const grade of simpleGrades) {
      const entries = grouped.get(grade.sessionId) || [];
      entries.push(grade);
      grouped.set(grade.sessionId, entries);
    }
    const sessionEntries = [...grouped.entries()];
    const contextResult = ensureExaminationRoomOwnerResult(await examinationRoomV1ServiceRpc(
      env,
      'examination_room_v1_grading_contexts',
      {
        p_actor_user_id: context.user.id,
        p_institution_id: context.institutionId,
        p_exam_id: examId,
        p_payload: {
          requests: sessionEntries.map(([sessionId, entries]) => ({
            sessionId,
            questionReferences: entries.map((entry) => entry.questionId),
          })),
        },
      },
    ));
    if (!Array.isArray(contextResult.contexts)
        || contextResult.contexts.length !== sessionEntries.length) {
      throw examinationRoomOwnerError(
        'EXAM_ROOM_V1_OFFLINE_GRADE_CONTEXT_INCOMPLETE',
        'The server could not match every offline grade to its submitted examination.',
        409,
        'Refresh online grading, export a new offline copy, and import that matching file.',
      );
    }
    const contextBySession = new Map();
    for (const gradingContext of contextResult.contexts) {
      const sessionId = examinationRoomOwnerUuid(
        gradingContext?.sessionId,
        'student session identifier',
      );
      if (!grouped.has(sessionId) || contextBySession.has(sessionId)) {
        throw examinationRoomOwnerError(
          'EXAM_ROOM_V1_OFFLINE_GRADE_CONTEXT_MISMATCH',
          'The server returned a grading context outside this exact import batch.',
          409,
          'No grades were saved. Refresh online grading, export a new offline copy, and retry.',
        );
      }
      contextBySession.set(sessionId, gradingContext);
    }
    const grades = await Promise.all(sessionEntries.map(([sessionId, entries]) => (
      examinationRoomPrepareOfflineGradeSession(
        env,
        context,
        examId,
        requestHash,
        sessionId,
        entries,
        contextBySession.get(sessionId),
      )
    )));
    const importedGradeCount = simpleGrades.length;
    const result = ensureExaminationRoomOwnerResult(await examinationRoomV1ServiceRpc(
      env,
      'examination_room_v1_import_grades',
      {
        p_actor_user_id: context.user.id,
        p_institution_id: context.institutionId,
        p_exam_id: examId,
        p_payload: { requestHash, grades },
      },
    ));
    return jsonResponse({
      ok: true,
      ...result,
      importedRevisionCount: Number(result.importedCount || grades.length),
      importedCount: importedGradeCount,
      atomic: true,
    }, result.duplicate ? 200 : 201, origin, allowedOrigin);
  }, origin, allowedOrigin);
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

async function pedroRpc(env, functionName, body) {
  const allowedFunctions = new Set([
    'pedro_reserve_turn',
    'pedro_search_published_content',
    'pedro_complete_turn',
    'pedro_fail_turn',
    'pedro_history',
    'pedro_resolve_action',
  ]);
  if (!allowedFunctions.has(functionName)) {
    throw new PedroValidationError(
      'PEDRO_INVALID_OPERATION',
      'Pedro received an unsupported operation.',
      400,
    );
  }
  const runtimeEnv = normalizedRuntimeSecrets(env);
  const baseUrl = configuredSupabaseUrl(runtimeEnv);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${runtimeEnv.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (response.ok) return result;

  const databaseMessage = [result?.message, result?.details, result?.hint]
    .filter((value) => typeof value === 'string')
    .join(' ');
  let code = 'PEDRO_UNAVAILABLE';
  let message = 'Pedro is temporarily unavailable. Your message is still here—try again.';
  let status = 503;
  let retryable = true;
  let retryAfterSeconds = 3;
  if (/current_terms_required/i.test(databaseMessage)) {
    code = 'PEDRO_TERMS_REQUIRED';
    message = 'Accept the current Terms and Privacy Notice before using Pedro.';
    status = 403;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/paid_access_required/i.test(databaseMessage)) {
    code = 'PEDRO_PAID_REQUIRED';
    message = 'Pedro is available with an active paid subscription.';
    status = 403;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/authentication_required|PEDRO_ACCESS_REQUIRED:authentication/i.test(databaseMessage)) {
    code = 'AUTHENTICATION_REQUIRED';
    message = 'Sign in to use Pedro.';
    status = 401;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/PEDRO_REQUEST_KEY_REUSED/i.test(databaseMessage)) {
    code = 'PEDRO_IDEMPOTENCY_CONFLICT';
    message = 'That retry key belongs to a different message. Send this as a new message.';
    status = 409;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/PEDRO_RATE_LIMIT_(?:SHORT|DAILY)/i.test(databaseMessage)) {
    code = 'PEDRO_RATE_LIMITED';
    message = 'Pedro needs a moment. Please try again shortly.';
    status = 429;
    retryAfterSeconds = 30;
  } else if (/PEDRO_(?:ACTION_NOT_FOUND|ACTION_STALE|SYLLABUS_TARGET_(?:STALE|ALREADY_USED))/i.test(databaseMessage)) {
    code = 'PEDRO_ACTION_NOT_FOUND';
    message = 'That study destination is no longer available.';
    status = 404;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/PEDRO_SYLLABUS_ACTIVE_ATTEMPT/i.test(databaseMessage)) {
    code = 'PEDRO_ACTIVE_ATTEMPT';
    message = 'Finish or leave the current study attempt, then try this destination again.';
    status = 409;
    retryAfterSeconds = 3;
  } else if (/PEDRO_THREAD_INVALID/i.test(databaseMessage)) {
    code = 'PEDRO_THREAD_INVALID';
    message = 'This Pedro inbox is no longer available. Reload your latest inbox.';
    status = 409;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/PEDRO_HISTORY_CURSOR_INVALID/i.test(databaseMessage)) {
    code = 'PEDRO_HISTORY_CURSOR_INVALID';
    message = 'This saved inbox position is no longer available. Reload the latest messages.';
    status = 400;
    retryable = false;
    retryAfterSeconds = null;
  } else if (/PEDRO_(?:CLAIM_STALE|TURN_NOT_FOUND)/i.test(databaseMessage)) {
    code = 'PEDRO_UNAVAILABLE';
    status = 409;
  }

  throw new PedroValidationError(code, message, status, {
    retryable,
    retryAfterSeconds,
  });
}

async function examinationRpc(env, functionName, body) {
  const allowedFunctions = new Set([
    'examination_query',
    'examination_command',
    'examination_admin',
    'examination_register_upload',
    'examination_store_ai_assessment',
    'examination_store_ai_assessment_commercial',
    'examination_fail_ai_job',
    'examination_record_delivery',
    'examination_authorize_access',
    'examination_history_by_track_v1',
    'subject_matter_catalog',
    'subject_matter_next_question',
    'subject_matter_next_question_v2',
    'subject_matter_performance',
    'subject_matter_skip_question',
    'subject_matter_skip_question_v2',
    'subject_matter_reveal_review',
    'bar_simulation_stage_pool_v1',
    'bar_simulation_finalize_pool_v1',
    'bar_simulation_start_attempt_v1',
    'bar_simulation_open_attempt_v1',
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
    'dd2026_record_bar_easy_completion_commercial',
    'dd2026_record_doctrine_mastery',
    'dd2026_record_doctrine_mastery_commercial',
    'dd2026_verdict_result',
    'dd2026_record_verdict_export',
    'dd2026_verdict_records',
    'dd2026_verdict_archive',
    'dd2026_auxiliary_diagnostic_source',
    'dd2026_auxiliary_diagnostic_claim',
    'dd2026_auxiliary_diagnostic_finish',
    'dd2026_auxiliary_diagnostic_fail',
    'dd2026_auxiliary_diagnostic_records',
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

const BAR_FORECAST_RPC_FUNCTIONS = new Set([
  'dd2026_bar_forecast_consent_status',
  'dd2026_bar_forecast_accept_consent',
  'dd2026_bar_forecast_admin_list',
]);

async function barForecastRpc(env, functionName, body) {
  if (!BAR_FORECAST_RPC_FUNCTIONS.has(functionName)) {
    throw new BarForecastError(
      'BAR_FORECAST_OPERATION_UNSUPPORTED',
      'This Forecast operation is not supported.',
    );
  }
  return protectedSupabaseRpc(env, functionName, body);
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

async function uploadQuorumAvatar(env, image, objectPath) {
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

async function readQuorumAvatarRecord(env, userId) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(
    `/rest/v1/forum_profile_avatars?user_id=eq.${encodeURIComponent(userId)}&select=object_path&limit=1`,
    baseUrl,
  ), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.error('Quorum profile photo record lookup failed', { status: response.status });
    throw forumDatabaseError([
      rows?.message,
      rows?.details,
      rows?.hint,
    ].filter(Boolean).join(' '));
  }
  const objectPath = Array.isArray(rows) ? String(rows[0]?.object_path || '') : '';
  return /^profiles\/[a-f0-9]{24}\.(?:jpg|png|webp)$/.test(objectPath) ? objectPath : null;
}

async function removeQuorumAvatarRecord(env, userId, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(
    `/rest/v1/forum_profile_avatars?user_id=eq.${encodeURIComponent(userId)}&object_path=eq.${encodeURIComponent(objectPath)}&select=object_path`,
    baseUrl,
  ), {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.error('Quorum profile photo record removal failed', { status: response.status });
    throw forumDatabaseError([
      rows?.message,
      rows?.details,
      rows?.hint,
    ].filter(Boolean).join(' '));
  }
  const removedPath = Array.isArray(rows) ? String(rows[0]?.object_path || '') : '';
  if (removedPath !== objectPath) {
    throw new ForumValidationError(
      'QUORUM_PROFILE_CHANGED',
      'Your profile photo changed while it was being removed. Review the current photo, then try again.',
      409,
    );
  }
  return removedPath;
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

async function readQuorumAvatarCleanupJobs(env, limit = 50) {
  const baseUrl = configuredSupabaseUrl(env);
  const url = new URL('/rest/v1/forum_profile_avatar_cleanup_jobs', baseUrl);
  url.searchParams.set('select', 'object_path');
  url.searchParams.set('not_before', `lte.${new Date().toISOString()}`);
  url.searchParams.set('order', 'queued_at.asc,object_path.asc');
  url.searchParams.set('limit', String(Math.max(1, Math.min(Number(limit) || 50, 100))));
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.error('Quorum profile photo cleanup queue lookup failed', { status: response.status });
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.object_path || ''))
    .filter((path) => /^profiles\/[a-f0-9]{24}\.(?:jpg|png|webp)$/.test(path));
}

async function queueQuorumAvatarCleanupJob(env, userId, objectPath, delaySeconds = 600) {
  const baseUrl = configuredSupabaseUrl(env);
  const url = new URL('/rest/v1/forum_profile_avatar_cleanup_jobs', baseUrl);
  url.searchParams.set('on_conflict', 'object_path');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      object_path: objectPath,
      user_id: userId,
      not_before: new Date(Date.now() + Math.max(0, Number(delaySeconds) || 0) * 1_000)
        .toISOString(),
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    console.error('Quorum uncertain profile photo could not be queued for reconciliation', {
      status: response.status,
    });
    return false;
  }
  return true;
}

async function removeQuorumAvatarCleanupJob(env, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  const url = new URL('/rest/v1/forum_profile_avatar_cleanup_jobs', baseUrl);
  url.searchParams.set('object_path', `eq.${objectPath}`);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
  });
  if (!response.ok) {
    console.error('Quorum profile photo cleanup queue acknowledgement failed', {
      status: response.status,
    });
    return false;
  }
  return true;
}

async function quorumAvatarCleanupState(env, objectPath) {
  try {
    const result = await forumRpc(env, 'forum_profile_avatar_cleanup_state', {
      p_object_path: objectPath,
    });
    const state = String(result?.state || '');
    return ['active', 'safe', 'missing'].includes(state) ? state : 'unavailable';
  } catch (error) {
    console.error('Quorum profile photo cleanup safety check failed', {
      code: error?.code || 'UNKNOWN',
    });
    return 'unavailable';
  }
}

async function deferQuorumAvatarCleanupJob(env, objectPath) {
  try {
    const result = await forumRpc(env, 'forum_defer_profile_avatar_cleanup', {
      p_object_path: objectPath,
    });
    return ['deferred', 'missing'].includes(String(result?.state || ''));
  } catch (error) {
    console.error('Quorum profile photo cleanup backoff update failed', {
      code: error?.code || 'UNKNOWN',
    });
    return false;
  }
}

async function reconcileQuorumAvatarCleanupJobs(env, objectPaths = null) {
  const paths = Array.isArray(objectPaths)
    ? objectPaths
      .map((path) => String(path || ''))
      .filter((path) => /^profiles\/[a-f0-9]{24}\.(?:jpg|png|webp)$/.test(path))
    : await readQuorumAvatarCleanupJobs(env);
  let removed = 0;
  for (const objectPath of [...new Set(paths)]) {
    try {
      const state = await quorumAvatarCleanupState(env, objectPath);
      if (state === 'active' || state === 'missing') continue;
      if (state !== 'safe') continue;
      if (!await deleteQuorumImage(env, objectPath)) {
        await deferQuorumAvatarCleanupJob(env, objectPath);
        continue;
      }
      if (await removeQuorumAvatarCleanupJob(env, objectPath)) removed += 1;
    } catch (error) {
      console.error('Quorum profile photo cleanup reconciliation failed', {
        code: error?.code || 'UNKNOWN',
      });
    }
  }
  return { examined: paths.length, removed };
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
  const authoritativeRejection = isAuthoritativeRpcRejectionStatus(response.status);
  console.error('Commerce storage request failed', {
    operation: functionName,
    status: response.status,
  });
  if (
    authoritativeRejection
    && ['phase4_create_payment_request_v2', 'phase4_create_payment_request_v3'].includes(functionName)
    && /selected pricing plan is not open|payment method is not compatible/i.test(databaseMessage)
  ) {
    throw markRpcOutcome(new PaymentValidationError(
      'PRICING_OFFER_STALE',
      'Pricing changed before submission. Nothing was charged or accepted. Reload Plans & Pricing.',
      409,
    ), response.status);
  }
  if (
    authoritativeRejection
    && functionName === 'phase4_create_payment_request'
    && /early access checkout is closed/i.test(databaseMessage)
  ) {
    throw markRpcOutcome(new PaymentValidationError(
      'CHECKOUT_CLOSED',
      'This checkout has closed. Reload Plans & Pricing for the current offer.',
      409,
    ), response.status);
  }
  if (
    authoritativeRejection
    && functionName === 'phase4_create_payment_request'
    && /only the legacy 149-peso|legacy payment method is unavailable/i.test(databaseMessage)
  ) {
    throw markRpcOutcome(new PaymentValidationError(
      'PRICING_OFFER_STALE',
      'The previous payment details no longer match the published offer. Nothing was accepted. Reload Plans & Pricing.',
      409,
    ), response.status);
  }
  if (authoritativeRejection
      && /already been submitted|already exists|request key already used/i.test(databaseMessage)) {
    throw markRpcOutcome(new PaymentValidationError(
      'DUPLICATE_PAYMENT',
      'This payment or refund request has already been submitted.',
      409,
    ), response.status);
  }
  if (authoritativeRejection
      && /not available|must match|unsupported|outside the accepted|reason must|valid request/i.test(databaseMessage)) {
    throw markRpcOutcome(new PaymentValidationError(
      'INVALID_COMMERCE_REQUEST',
      'The request did not pass secure validation. Review the details and try again.',
      400,
    ), response.status);
  }
  throw markRpcOutcome(new PaymentValidationError(
    'COMMERCE_UNAVAILABLE',
    'Secure payment services are temporarily unavailable. No access change was made.',
    503,
  ), response.status);
}

function encodedStoragePath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function storageObjectAlreadyExists(response) {
  if (response.status === 409) return true;
  if (response.status !== 400) return false;
  const body = await response.clone().text().catch(() => '');
  return /asset already exists|already_exists|resourcealreadyexists|keyalreadyexists/i.test(body);
}

async function uploadPrivateProof(
  env,
  objectPath,
  bytes,
  mimeType,
  { allowExisting = false } = {},
) {
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
  const alreadyExists = !response.ok
    && allowExisting
    && await storageObjectAlreadyExists(response);
  if (!response.ok && !alreadyExists) {
    console.error('Private payment proof upload failed', { status: response.status });
    throw new PaymentValidationError(
      'PAYMENT_PROOF_UNAVAILABLE',
      'The payment proof could not be stored securely. Please try again.',
      503,
    );
  }
  return { created: response.ok, alreadyExists };
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

function pricingAssetObjectUrl(env, bucketId, objectPath) {
  const baseUrl = configuredSupabaseUrl(env);
  return new URL(
    `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodedStoragePath(objectPath)}`,
    baseUrl,
  );
}

async function uploadPrivatePricingAsset(env, objectPath, bytes, mimeType, { allowExisting = false } = {}) {
  const response = await fetch(
    pricingAssetObjectUrl(env, PRICING_ASSET_BUCKET, objectPath),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-upsert': 'false',
      },
      body: bytes,
    },
  );
  const alreadyExists = !response.ok
    && allowExisting
    && await storageObjectAlreadyExists(response);
  if (!response.ok && !alreadyExists) {
    console.error('Private pricing asset upload failed', { status: response.status });
    throw new PricingValidationError(
      'PRICING_ASSET_UNAVAILABLE',
      'The QR image could not be stored securely. Please try again.',
      503,
    );
  }
  return { created: response.ok, alreadyExists };
}

async function deletePrivatePricingAsset(env, objectPath) {
  try {
    const response = await fetch(
      pricingAssetObjectUrl(env, PRICING_ASSET_BUCKET, objectPath),
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok && response.status !== 404) {
      console.error('Private pricing asset cleanup requires operator review', {
        status: response.status,
      });
    }
  } catch {
    console.error('Private pricing asset cleanup requires operator review');
  }
}

async function streamPrivatePricingAsset(
  request,
  env,
  metadata,
  origin,
  allowedOrigin,
  { publicAsset = false } = {},
) {
  const etag = `"${metadata.sha256}"`;
  if (publicAsset && request.headers.get('If-None-Match')?.split(',').map((item) => item.trim()).includes(etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders(origin, allowedOrigin),
        ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  }
  const storageResponse = await fetch(
    pricingAssetObjectUrl(env, metadata.bucketId, metadata.objectPath),
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!storageResponse.ok || !storageResponse.body) {
    console.error('Private pricing asset read failed', {
      status: storageResponse.status,
      assetId: metadata.assetId,
    });
    throw new PricingValidationError(
      'PRICING_ASSET_UNAVAILABLE',
      'The QR image is temporarily unavailable.',
      503,
    );
  }
  return new Response(storageResponse.body, {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': metadata.mimeType,
      'Content-Length': String(metadata.sizeBytes),
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Cache-Control': publicAsset
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      'Cross-Origin-Resource-Policy': publicAsset ? 'cross-origin' : 'same-site',
    },
  });
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
  return absoluteSupabaseStorageUrl(baseUrl, result.signedURL);
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

function adminDirectoryEmailMode(env) {
  return resolvedEmailMode(env, env.ADMIN_DIRECTORY_EMAIL_MODE);
}

async function sendAdminDirectoryEmail(
  env,
  { recipient, csv, filename, requestKey, resultCount },
) {
  const mode = adminDirectoryEmailMode(env);
  if (mode === 'suppressed') return { status: 'suppressed', providerId: null };
  const from = String(env.ADMIN_DIRECTORY_EMAIL_FROM || '').trim();
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
  return resolvedEmailMode(env, env.SUPPORT_NOTIFICATION_EMAIL_MODE);
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
  return resolvedEmailMode(env, env.SIGN_IN_NOTIFICATION_EMAIL_MODE);
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

function configuredSupabaseJwtIssuer(baseUrl) {
  return new URL('/auth/v1', baseUrl).toString().replace(/\/+$/, '');
}

function validatedSupabaseJwtClaims(authorization, baseUrl, now = Date.now()) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const payload = decodeJwtPayload(authorization);
  const subject = String(payload.sub || '').trim().toLowerCase();
  const issuer = String(payload.iss || '').trim().replace(/\/+$/, '');
  const expiresAt = Number(payload.exp) * 1000;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(subject)
      || !Number.isSafeInteger(payload.exp)
      || expiresAt <= now
      || issuer !== configuredSupabaseJwtIssuer(baseUrl)) {
    return null;
  }
  return {
    token,
    subject,
    issuer,
    expiresAt,
    cacheable: token.length <= AUTHENTICATED_USER_TOKEN_CACHE_MAX_TOKEN_CHARS,
  };
}

function pruneAuthenticatedUserTokenCache(now = Date.now()) {
  for (const [digest, entry] of authenticatedUserTokenCache) {
    if (!entry || entry.expiresAt <= now) authenticatedUserTokenCache.delete(digest);
  }
  while (authenticatedUserTokenCache.size > AUTHENTICATED_USER_TOKEN_CACHE_MAX_ENTRIES) {
    const oldestDigest = authenticatedUserTokenCache.keys().next().value;
    if (oldestDigest === undefined) break;
    authenticatedUserTokenCache.delete(oldestDigest);
  }
}

export function resetAuthenticatedUserTokenCacheForTest() {
  authenticatedUserTokenCache.clear();
}

export function authenticatedUserTokenCacheSizeForTest() {
  pruneAuthenticatedUserTokenCache();
  return authenticatedUserTokenCache.size;
}

function transientAuthenticationError(response = null) {
  const retryAfterHeader = String(response?.headers?.get('Retry-After') || '').trim();
  const retryAfterNumber = Number(retryAfterHeader);
  const retryAfterDate = Date.parse(retryAfterHeader);
  const retryAfterSeconds = Number.isSafeInteger(retryAfterNumber) && retryAfterNumber > 0
    ? Math.min(3_600, retryAfterNumber)
    : (Number.isFinite(retryAfterDate) && retryAfterDate > Date.now()
      ? Math.min(3_600, Math.max(1, Math.ceil((retryAfterDate - Date.now()) / 1000)))
      : 5);
  const error = new GuestAccessError(
    'AUTH_SESSION_VERIFICATION_UNAVAILABLE',
    `Your sign-in could not be verified right now. Please try again in ${retryAfterSeconds} seconds.`,
    503,
  );
  error.retryable = true;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function logTransientAuthenticationFailure(category, status, attempt) {
  console.warn('Supabase Auth verification transient failure', {
    category,
    status: Number.isInteger(status) ? status : null,
    attempt,
  });
}

async function readBoundedAuthenticationJson(response, signal) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let finished = false;
  let abortHandler;
  const aborted = new Promise((_resolve, reject) => {
    abortHandler = () => reject(new DOMException('Authentication response timed out.', 'AbortError'));
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        finished = true;
        break;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > AUTHENTICATED_USER_RESPONSE_MAX_BYTES) {
        throw new Error('Authentication response exceeded the safe size limit.');
      }
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener('abort', abortHandler);
    if (!finished) void reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text);
}

async function waitForAuthenticationRetry() {
  await new Promise((resolve) => setTimeout(
    resolve,
    AUTHENTICATED_USER_VERIFICATION_RETRY_DELAY_MS,
  ));
}

async function fetchAuthenticatedUserVerification(
  authorization,
  env,
  baseUrl,
  expectedSubject = null,
) {
  let lastTransientResponse = null;
  for (let attempt = 0; attempt < AUTHENTICATED_USER_VERIFICATION_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      AUTHENTICATED_USER_VERIFICATION_TIMEOUT_MS,
    );
    let response = null;
    let fetchError = null;
    let user = null;
    try {
      response = await fetch(new URL('/auth/v1/user', baseUrl), {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: authorization,
        },
        signal: controller.signal,
      });
      if (response.ok) {
        user = await readBoundedAuthenticationJson(response, controller.signal);
      }
    } catch (error) {
      fetchError = error;
    } finally {
      clearTimeout(deadline);
    }

    if (fetchError) {
      const timedOut = controller.signal.aborted
        || fetchError?.name === 'AbortError'
        || fetchError?.name === 'TimeoutError';
      logTransientAuthenticationFailure(
        timedOut ? 'timeout' : (response?.ok ? 'invalid_response' : 'network_error'),
        response?.status || null,
        attempt + 1,
      );
      if (attempt + 1 >= AUTHENTICATED_USER_VERIFICATION_ATTEMPTS) {
        throw transientAuthenticationError();
      }
      await waitForAuthenticationRetry();
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      return { response, user: null };
    }
    if (response.status === 429) {
      logTransientAuthenticationFailure('rate_limited', response.status, attempt + 1);
      throw transientAuthenticationError(response);
    }
    if (response.status === 408 || response.status >= 500) {
      lastTransientResponse = response;
      logTransientAuthenticationFailure('upstream_error', response.status, attempt + 1);
      if (attempt + 1 >= AUTHENTICATED_USER_VERIFICATION_ATTEMPTS) {
        throw transientAuthenticationError(lastTransientResponse);
      }
      await waitForAuthenticationRetry();
      continue;
    }
    if (!response.ok) {
      logTransientAuthenticationFailure('unexpected_status', response.status, attempt + 1);
      throw transientAuthenticationError(response);
    }
    const userId = String(user?.id || '').trim().toLowerCase();
    const unusableUser = !userId || (expectedSubject && userId !== expectedSubject);
    if (unusableUser) {
      logTransientAuthenticationFailure('invalid_response', response.status, attempt + 1);
      if (attempt + 1 >= AUTHENTICATED_USER_VERIFICATION_ATTEMPTS) {
        throw transientAuthenticationError();
      }
      await waitForAuthenticationRetry();
      continue;
    }
    return { response, user };
  }
  throw transientAuthenticationError(lastTransientResponse);
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

function signInDeviceCategory(device) {
  if (device === 'Mobile phone') return 'mobile';
  if (device === 'Tablet') return 'tablet';
  if (device === 'Desktop or laptop') return 'desktop';
  return 'unknown';
}

function approximateSignInLocationParts(request) {
  return {
    region: safeSingleLine(request.cf?.region, 80) || null,
    countryCode: safeSingleLine(request.cf?.country, 2).toUpperCase() || null,
  };
}

function approximateSignInLocation(request) {
  const location = approximateSignInLocationParts(request);
  const parts = [location.region, location.countryCode].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not available';
}

async function recordSignInMonitoringEvent(env, request, user, sessionDigest) {
  const client = summarizeSignInClient(request);
  const location = approximateSignInLocationParts(request);
  try {
    await protectedSupabaseRpc(env, 'record_user_sign_in_event', {
      p_user_id: user.id,
      p_session_digest: sessionDigest,
      p_device_category: signInDeviceCategory(client.device),
      p_browser: client.browser,
      p_operating_system: client.operatingSystem,
      p_region: location.region,
      p_country_code: location.countryCode,
      p_language: client.language,
    });
    return true;
  } catch {
    // Sign-in monitoring is operational telemetry. A temporary persistence
    // failure must never invalidate or redirect an otherwise valid session.
    console.error('Sign-in monitoring persistence failed', { status: 'storage_error' });
    return false;
  }
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

export async function sendSecureNotification(env, { mailbox, subject, adminPath }) {
  if (outboundEmailSuppressed(env)) {
    return { sent: false, queued: true, status: 'suppressed' };
  }
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
  const now = Date.now();
  const jwtClaims = validatedSupabaseJwtClaims(authorization, baseUrl, now);
  let tokenDigest = null;
  if (jwtClaims?.cacheable) {
    tokenDigest = await sha256Hex(new TextEncoder().encode(jwtClaims.token));
    pruneAuthenticatedUserTokenCache(now);
    const cached = authenticatedUserTokenCache.get(tokenDigest);
    if (cached
        && cached.expiresAt > now
        && cached.subject === jwtClaims.subject
        && cached.issuer === jwtClaims.issuer
        && String(cached.user?.id || '').toLowerCase() === jwtClaims.subject) {
      authenticatedUserCache.set(request, cached.user);
      return cached.user;
    }
  }
  const verification = await fetchAuthenticatedUserVerification(
    authorization,
    env,
    baseUrl,
    jwtClaims?.subject || null,
  );
  if (verification.response.status === 401 || verification.response.status === 403) {
    throw new GuestAccessError('INVALID_SESSION', 'Your session expired. Please sign in again.', 401);
  }
  const user = verification.user;
  // `/auth/v1/user` has just authenticated this exact bearer token. Only
  // after that verification do we decode its AAL and session claims for
  // server-side step-up authorization; client JSON fields are never used.
  const accessTokenContext = verifiedAccessTokenContext(authorization);
  const verified = {
    id: String(user.id).trim(),
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
  if (jwtClaims?.cacheable
      && tokenDigest
      && String(verified.id || '').toLowerCase() === jwtClaims.subject) {
    authenticatedUserTokenCache.set(tokenDigest, {
      user: verified,
      subject: jwtClaims.subject,
      issuer: jwtClaims.issuer,
      expiresAt: Math.min(jwtClaims.expiresAt, now + AUTHENTICATED_USER_TOKEN_CACHE_TTL_MS),
    });
    pruneAuthenticatedUserTokenCache(now);
  }
  return verified;
}

async function handleSignInNotification(request, env, origin, allowedOrigin, executionContext) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new GuestAccessError('SIGN_IN_REQUIRED', 'Sign-in is required.', 401);
  }
  const sessionDigest = await signInSessionDigest(request, user);
  await recordSignInMonitoringEvent(env, request, user, sessionDigest);
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
  scheduleAdminPulse(env, executionContext);
  return jsonResponse({ ok: true, notification: delivery.status }, 202, origin, allowedOrigin);
}

async function sendExaminationRoomV1KeyEmail(env, message) {
  const emailMode = String(env.EXAMINATION_ROOM_EMAIL_MODE || '').trim().toLowerCase();
  if (emailMode === 'suppressed') {
    return { status: 'suppressed', providerId: null, safeErrorCode: 'email_suppressed' };
  }
  const recipient = String(message?.recipient || '').trim().toLowerCase();
  const from = String(
    env.EXAMINATION_ROOM_EMAIL_FROM
    || env.SUPPORT_NOTIFICATION_EMAIL_FROM
    || '',
  ).trim();
  const configuredOwnerRecipients = [...new Set((Array.isArray(message?.ownerRecipients)
    ? message.ownerRecipients
    : examinationRoomAdminEmailRecipients(env))
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))
      .slice(0, 20))];
  const ownerRecipients = configuredOwnerRecipients.filter((value) => value !== recipient);
  const primaryRecipients = recipient ? [recipient] : configuredOwnerRecipients;
  if (emailMode !== 'enabled'
      || !env.RESEND_API_KEY
      || !from
      || primaryRecipients.length < 1
      || configuredOwnerRecipients.length < 1) {
    return {
      status: 'not_configured',
      providerId: null,
      safeErrorCode: !from
          ? 'sender_missing'
          : !env.RESEND_API_KEY
            ? 'provider_key_missing'
            : configuredOwnerRecipients.length < 1
              ? 'owner_recipients_missing'
              : primaryRecipients.length < 1
                ? 'delivery_recipients_missing'
                : 'email_mode_invalid',
    };
  }
  let response;
  try {
    const email = buildExaminationRoomKeyEmail(env, {
      creatorName: message.professorName,
      examTitle: message.examTitle,
      roomKey: message.roomKey,
      expiresAt: message.expiresAt,
    });
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `exam-room-key-${String(message.idempotencyHash || '').slice(0, 64)}`,
      },
      body: JSON.stringify({
        from,
        to: primaryRecipients,
        ...(recipient && ownerRecipients.length ? { bcc: ownerRecipients } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
  } catch (error) {
    console.error('Examination Room key email transport failed', {
      name: String(error?.name || 'Error').slice(0, 80),
    });
    return { status: 'failed', providerId: null, safeErrorCode: 'network_error' };
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Examination Room key email failed', { status: response.status });
    return {
      status: 'failed',
      providerId: null,
      safeErrorCode: `provider_${response.status}`.slice(0, 80),
    };
  }
  return {
    status: 'sent',
    providerId: result?.id ? String(result.id).slice(0, 240) : null,
    safeErrorCode: null,
  };
}

async function sendExaminationRoomV1PublicationRequestEmail(env, result) {
  const manifest = result?.publicationManifest && typeof result.publicationManifest === 'object'
    ? result.publicationManifest
    : {};
  const examId = String(result?.examId || manifest.examinationId || '').trim();
  const version = result?.version ?? manifest.version ?? '';
  const publishedAt = manifest.publishedAt || '';
  const suppliedHash = String(result?.publicationHash || '').trim().toLowerCase();
  const idempotencyHash = /^[0-9a-f]{64}$/u.test(suppliedHash)
    ? suppliedHash
    : await sha256Hex(new TextEncoder().encode(
      `examination-room-key-request\0${examId}\0${String(version)}\0${String(publishedAt)}`,
    ));
  return deliverExaminationRoomPublicationRequestEmail(env, {
    recipients: examinationRoomAdminEmailRecipients(env),
    idempotencyHash,
    examId,
    version,
    publishedAt,
    examTitle: manifest.title,
    subject: manifest.subject,
    questionCount: manifest.questionCount ?? manifest.questions?.length,
  });
}

function scheduleExaminationRoomPublicationRequestNotification(env, result, executionContext) {
  const work = sendExaminationRoomV1PublicationRequestEmail(env, result)
    .then((delivery) => {
      if (!['sent', 'suppressed'].includes(String(delivery?.status || ''))) {
        console.error('Examination Room publication request email was not delivered', {
          status: String(delivery?.status || 'failed').slice(0, 40),
          safeErrorCode: String(delivery?.safeErrorCode || 'unknown').slice(0, 80),
          examId: String(result?.examId || result?.publicationManifest?.examinationId || '').slice(0, 80),
        });
      }
      return delivery;
    })
    .catch((error) => {
      console.error('Examination Room publication request notification failed', {
        name: String(error?.name || 'Error').slice(0, 80),
      });
      return { status: 'failed', safeErrorCode: 'notification_error' };
    });
  if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(work);
  else void work;
}

function examinationRoomResultDeliverySummary(outcomes, extra = {}) {
  const normalized = (Array.isArray(outcomes) ? outcomes : [])
    .map((outcome) => ({
      releaseId: String(outcome?.releaseId || '').trim() || null,
      sessionId: String(outcome?.sessionId || '').trim() || null,
      recipient: String(outcome?.recipient || '').trim().toLowerCase() || null,
      status: String(outcome?.status || 'failed').trim().toLowerCase(),
      providerId: String(outcome?.providerId || '').trim() || null,
      safeErrorCode: String(outcome?.safeErrorCode || '').trim().toLowerCase() || null,
      ...(Number.isSafeInteger(Number(outcome?.attemptCount))
        ? { attemptCount: Number(outcome.attemptCount) }
        : {}),
    }))
    .sort((left, right) => String(left.sessionId || '').localeCompare(String(right.sessionId || '')));
  const counts = normalized.reduce((summary, outcome) => {
    summary[outcome.status] = (summary[outcome.status] || 0) + 1;
    return summary;
  }, {});
  const acceptedCount = counts.sent || 0;
  const failedCount = counts.failed || 0;
  const skippedCount = counts.skipped || 0;
  const suppressedCount = counts.suppressed || 0;
  const notConfiguredCount = counts.not_configured || 0;
  const pendingCount = counts.pending || 0;
  const status = normalized.length === 0
    ? 'skipped'
    : failedCount || notConfiguredCount || pendingCount
      ? acceptedCount || suppressedCount || skippedCount ? 'partial' : 'failed'
      : skippedCount
        ? acceptedCount || suppressedCount ? 'partial' : 'skipped'
        : suppressedCount ? 'suppressed' : 'sent';
  return {
    status,
    total: normalized.length,
    acceptedCount,
    failedCount,
    skippedCount,
    suppressedCount,
    notConfiguredCount,
    pendingCount,
    outcomes: normalized,
    providerBatchIds: Array.isArray(extra.providerBatchIds) ? extra.providerBatchIds : [],
    retrySafe: extra.retrySafe !== false,
    ...(extra.recovery ? { recovery: String(extra.recovery) } : {}),
  };
}

function examinationRoomResultDeliveryFailure(items, safeErrorCode, recovery) {
  return examinationRoomResultDeliverySummary(
    (Array.isArray(items) ? items : []).map((item) => ({
      releaseId: item?.releaseId,
      sessionId: item?.sessionId,
      status: 'failed',
      providerId: null,
      safeErrorCode,
    })),
    { recovery },
  );
}

async function sendExaminationRoomV1ResultReleaseEmails(env, details = {}) {
  const resultEmailItems = Array.isArray(details.resultEmailItems)
    ? details.resultEmailItems.slice(0, 1_000)
    : [];
  if (resultEmailItems.length === 0) {
    return examinationRoomResultDeliverySummary([], {
      recovery: 'No released student records required an email notification.',
    });
  }

  let claimed;
  try {
    claimed = examinationRoomV1Result(await examinationRoomV1ServiceRpc(
      env,
      'examination_room_v1_claim_result_email_deliveries',
      {
        p_actor_user_id: details.actorUserId,
        p_institution_id: details.institutionId,
        p_exam_id: details.examId,
        p_request_hash: details.requestHash,
        p_items: resultEmailItems,
        p_lease_seconds: 300,
      },
    ));
  } catch (error) {
    console.error('Examination Room result-email outbox claim failed', {
      code: String(error?.code || 'claim_failed').slice(0, 80),
    });
    return examinationRoomResultDeliveryFailure(
      resultEmailItems,
      'outbox_claim_failed',
      'The grades were released. Release the same students again after a brief wait; provider-accepted messages will not be resent.',
    );
  }
  if (claimed?.ok === false) {
    return examinationRoomResultDeliveryFailure(
      resultEmailItems,
      'outbox_claim_rejected',
      String(claimed?.error?.recovery || 'The grades were released. Refresh grading, then release the same students again.'),
    );
  }

  const claimedItems = Array.isArray(claimed?.items) ? claimed.items : [];
  const deliverable = claimedItems.filter((item) => item?.shouldSend === true);
  const persisted = claimedItems.filter((item) => item?.shouldSend !== true);
  if (deliverable.length === 0) {
    return examinationRoomResultDeliverySummary(persisted, {
      retrySafe: true,
      recovery: persisted.some((item) => item?.status === 'pending')
        ? 'Another delivery attempt is still active. Refresh grading before retrying.'
        : null,
    });
  }

  const stableReleaseIds = deliverable
    .map((item) => String(item?.releaseId || '').trim())
    .filter(Boolean)
    .sort();
  const idempotencyHash = await sha256Hex(new TextEncoder().encode(
    `examination-room-result-email\0${String(details.requestHash || '')}\0${stableReleaseIds.join('\0')}`,
  ));
  const delivery = await deliverExaminationRoomResultReleaseEmails(env, {
    recipients: deliverable,
    idempotencyHash,
  });
  const attempted = Array.isArray(delivery?.outcomes)
    ? delivery.outcomes.filter((outcome) => outcome?.releaseId)
    : [];

  let completedItems = attempted;
  let completionPending = false;
  try {
    const completion = examinationRoomV1Result(await examinationRoomV1ServiceRpc(
      env,
      'examination_room_v1_complete_result_email_deliveries',
      {
        p_claim_token: claimed.claimToken,
        p_outcomes: attempted.map((outcome) => ({
          releaseId: outcome.releaseId,
          status: outcome.status,
          providerId: outcome.providerId || null,
          safeErrorCode: outcome.safeErrorCode || null,
        })),
      },
    ));
    if (completion?.ok === false) throw new Error('completion_rejected');
    completedItems = Array.isArray(completion?.items) ? completion.items : attempted;
  } catch (error) {
    completionPending = true;
    console.error('Examination Room result-email outbox completion failed', {
      code: String(error?.code || error?.message || 'completion_failed').slice(0, 80),
    });
  }

  const summary = examinationRoomResultDeliverySummary(
    [...persisted, ...completedItems],
    {
      providerBatchIds: delivery?.providerBatchIds,
      retrySafe: delivery?.retrySafe !== false,
      recovery: completionPending
        ? 'The provider response was received but its audit record is still pending. Retry within 24 hours using the same released students; the provider idempotency key prevents duplicate delivery.'
        : delivery?.failedCount || delivery?.notConfiguredCount || delivery?.suppressedCount
          ? 'Release the same students again after correcting email delivery. Already accepted messages will not be resent.'
          : null,
    },
  );
  return completionPending
    ? { ...summary, persistenceStatus: 'pending' }
    : { ...summary, persistenceStatus: 'recorded' };
}

async function handleSessionMonitoring(request, env, origin, allowedOrigin, executionContext) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new GuestAccessError('SIGN_IN_REQUIRED', 'Sign-in is required.', 401);
  }
  const sessionDigest = await signInSessionDigest(request, user);
  const recorded = await recordSignInMonitoringEvent(env, request, user, sessionDigest);
  scheduleAdminPulse(env, executionContext);
  return jsonResponse({
    ok: true,
    monitoring: recorded ? 'recorded' : 'temporarily_unavailable',
  }, 202, origin, allowedOrigin);
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

function barQuestionPracticeRandomizationV2Enabled(env) {
  return String(env.BAR_QUESTION_PRACTICE_RANDOMIZATION_V2_ENABLED)
    .toLowerCase() === 'true';
}

function syllabusBasedReviewRandomizationV2Enabled(env) {
  return String(env.SYLLABUS_BASED_REVIEW_RANDOMIZATION_V2_ENABLED)
    .toLowerCase() === 'true';
}

function barExamSimulationRandomizationSchemaReady(env) {
  return String(env.BAR_EXAM_SIMULATION_RANDOMIZATION_V1_SCHEMA_READY)
    .toLowerCase() === 'true';
}

function barExamSimulationRandomizationV1Enabled(env) {
  return barExamSimulationRandomizationSchemaReady(env)
    && String(env.BAR_EXAM_SIMULATION_RANDOMIZATION_V1_ENABLED)
      .toLowerCase() === 'true';
}

const RANDOMIZED_BAR_SIMULATION_DESTINATIONS = new Set([
  'Political and Public International Law',
  'Commercial and Taxation Laws',
  'Civil Law',
  'Labor Law and Social Legislations',
  'Criminal Law',
  'Remedial Law, Legal and Judicial Ethics',
]);

function randomizedBarSimulationSetupEligible(setup) {
  return setup?.assessmentKind === 'curated'
    && setup?.testOnly === false
    && RANDOMIZED_BAR_SIMULATION_DESTINATIONS.has(String(setup?.subject || '').trim());
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
  // Retainer pricing is intentionally public. Authentication is still required
  // for checkout and every entitlement-changing operation.
  if (pathname === '/plans') {
    return true;
  }
  // Pedro enforces its own stricter current-terms plus verified paid-payment
  // entitlement (with explicit Founder/Super Admin test access) in SQL.
  if (pathname === '/pedro/message' || pathname === '/pedro/query') {
    return true;
  }
  // Study Room routes re-authenticate the user and enforce either a verified
  // administrator role or the explicitly authorized Founding Beta test cohort.
  if (pathname === '/study-room' || pathname.startsWith('/study-room/')) {
    return true;
  }
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

function studyRoomMemberAccess(access) {
  const basis = String(access?.basis || '').trim().toLowerCase();
  const allowed = access?.allowed === true
    && access?.termsRequired !== true
    && access?.reauthenticationRequired !== true
    && access?.paidSubscriptionExpired !== true
    && basis === 'founding_beta';
  return { ...access, allowed };
}

async function studyRoomAdministratorAccess(env, user) {
  return protectedSupabaseRpc(env, 'admin_authorization_context', {
    p_actor_user_id: user.id,
  }, { returnNullOnAuthorizationDenial: true });
}

async function reserveGradeAccess(request, env, gradingRequest, verifiedUser = null) {
  if (phase4AccessEnforced(env)) {
    const authenticatedUser = verifiedUser || await requireAuthenticatedUser(request, env);
    const requestId = normalizeRequestKey(request.headers.get('X-Request-ID'));
    const reservation = await phase4Rpc(env, 'phase4_reserve_grade_v2', {
      p_user_id: authenticatedUser.id,
      p_request_key: requestId,
      p_question_bank_id: gradingRequest.questionId,
      p_examination_track: 'bar_practice',
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
    const finalizedAccess = normalizeAccessSnapshot(result);
    return {
      limit: finalizedAccess.dailyLimit,
      used: finalizedAccess.completedToday,
      remaining: finalizedAccess.remainingToday,
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

function websiteRecordsFromPayload(payload) {
  if (!Array.isArray(payload?.records)
      || payload.records.length < WEBSITE_BANK_MINIMUM_RECORDS
      || payload.records.length > WEBSITE_BANK_MAXIMUM_RECORDS) {
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
      throw new ExaminerError(
        'QUESTION_BANK_INVALID',
        'The website question bank contains an invalid or duplicate ID.',
        502,
      );
    }
    records.set(id, row);
  }
  try {
    protectedQuestionInventory(records);
  } catch {
    throw new ExaminerError(
      'QUESTION_BANK_INVALID',
      'The website question bank could not be prepared safely.',
      502,
    );
  }
  return records;
}

function boundedWebsiteVisibilityCsv(csvText) {
  const source = String(csvText || '');
  if (!source || new TextEncoder().encode(source).length > WEBSITE_VISIBILITY_MAX_BYTES) {
    throw new ReleaseContentError(
      'MOCK_BAR_VISIBILITY_OVERLAY_INVALID',
      'The website visibility projection exceeds its safe transport boundary.',
    );
  }
  return source;
}

async function fetchWebsiteVisibilityCsv() {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(WEBSITE_VISIBILITY_CSV_URL, {
        headers: { Accept: 'text/csv' },
      });
      if (response.ok) return boundedWebsiteVisibilityCsv(await response.text());
      lastError = new Error(`visibility source status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw lastError || new Error('visibility source unavailable');
}

async function readCachedWebsiteVisibility() {
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(WEBSITE_VISIBILITY_CACHE_URL));
    if (!response?.ok) return null;
    const csvText = boundedWebsiteVisibilityCsv(await response.text());
    return { records: parseWebsitePublicationOverlay(csvText), csvText };
  } catch (error) {
    console.warn('Validated website visibility cache could not be read', {
      code: error?.code || 'WEBSITE_VISIBILITY_CACHE_READ_FAILED',
    });
    return null;
  }
}

async function cacheWebsiteVisibility(csvText) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  try {
    const boundedCsv = boundedWebsiteVisibilityCsv(csvText);
    await cache.put(
      new Request(WEBSITE_VISIBILITY_CACHE_URL),
      new Response(boundedCsv, {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': 'text/csv; charset=utf-8',
        },
      }),
    );
  } catch (error) {
    // Cache persistence improves cross-isolate continuity but is never allowed
    // to delay or interrupt a paid user's exam request.
    console.warn('Validated website visibility cache could not be updated', {
      code: error?.code || 'WEBSITE_VISIBILITY_CACHE_WRITE_FAILED',
    });
  }
}

async function loadWebsiteBank(url) {
  const now = Date.now();
  if (websiteBankCache && now - websiteBankCache.loadedAt < 5 * 60 * 1000) {
    return websiteBankCache.records;
  }
  let canonicalRecords = null;
  let visibilityRecords = null;
  let visibilityCsvText = null;
  let sourceError = null;

  const visibilityRequest = (async () => {
    const csvText = await fetchWebsiteVisibilityCsv();
    return { records: parseWebsitePublicationOverlay(csvText), csvText };
  })();
  const canonicalRequest = (async () => {
    if (url) {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`source status ${response.status}`);
      return websiteRecordsFromPayload(await response.json());
    }
    const response = await fetch(WEBSITE_UPLOAD_CSV_URL, {
      headers: { Accept: 'text/csv' },
    });
    if (!response.ok) throw new Error(`source status ${response.status}`);
    const csvText = await response.text();
    await parseWebsiteUploadSource(csvText);
    return parseQuestionBank(csvText);
  })();
  const [visibilityResult, canonicalResult] = await Promise.allSettled([
    visibilityRequest,
    canonicalRequest,
  ]);
  if (visibilityResult.status === 'fulfilled') {
    visibilityRecords = visibilityResult.value.records;
    visibilityCsvText = visibilityResult.value.csvText;
  } else {
    sourceError = visibilityResult.reason;
  }
  if (canonicalResult.status === 'fulfilled') {
    canonicalRecords = canonicalResult.value;
  } else {
    sourceError = canonicalResult.reason;
  }

  if (canonicalRecords && visibilityRecords) {
    try {
      const records = applyWebsitePublicationOverlay(canonicalRecords, visibilityRecords);
      websiteBankCache = {
        records,
        loadedAt: now,
        source: `${url || WEBSITE_UPLOAD_CSV_URL} + Q&A Bank visibility`,
      };
      await cacheWebsiteVisibility(visibilityCsvText);
      return records;
    } catch (error) {
      // A partial or malformed control projection must never interrupt paid
      // users. Keep the last fully validated combined bank, or use the
      // reviewed embedded status quo on a cold start.
      sourceError = error;
      visibilityRecords = null;
    }
  }

  // Keep the last successfully validated live source available through a
  // transient publication outage. The embedded reviewed snapshot remains the
  // cold-start fallback. A separately available Q&A overlay is still applied
  // so a canonical-source outage cannot reissue a question the owner hid.
  if (websiteBankCache?.records) return websiteBankCache.records;
  if (!visibilityRecords) {
    const cachedVisibility = await readCachedWebsiteVisibility();
    visibilityRecords = cachedVisibility?.records || null;
    visibilityCsvText = cachedVisibility?.csvText || null;
  }
  let records = null;
  let usedEmbeddedFallback = false;
  try {
    const embeddedRecords = websiteRecordsFromPayload(embeddedWebsiteQuestionBank);
    if (visibilityRecords) {
      try {
        usedEmbeddedFallback = !canonicalRecords;
        records = applyWebsitePublicationOverlay(
          canonicalRecords || embeddedRecords,
          visibilityRecords,
        );
      } catch (error) {
        sourceError = error;
        try {
          records = applyWebsitePublicationOverlay(embeddedRecords, visibilityRecords);
          usedEmbeddedFallback = true;
        } catch (embeddedOverlayError) {
          sourceError = embeddedOverlayError;
          visibilityRecords = null;
          visibilityCsvText = null;
        }
      }
    }
    if (!records) {
      records = embeddedRecords;
      usedEmbeddedFallback = true;
    }
  } catch (error) {
    console.warn('Published website question bank unavailable and fallback invalid', {
      code: error?.code || sourceError?.code || 'QUESTION_BANK_UNAVAILABLE',
    });
    throw error;
  }
  if (visibilityRecords && visibilityCsvText) {
    await cacheWebsiteVisibility(visibilityCsvText);
  }
  websiteBankCache = {
    records,
    loadedAt: now,
    source: visibilityRecords && !usedEmbeddedFallback
      ? 'validated canonical fallback + Q&A Bank visibility'
      : visibilityRecords
        ? 'embedded-reviewed-fallback + Q&A Bank visibility'
        : 'embedded-reviewed-status-quo-fallback',
  };
  return records;
}

async function searchPedroMockBar(request, env) {
  const terms = Array.isArray(request?.terms)
    ? request.terms
      .map((value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en'))
      .filter((value) => value.length >= 2 && value.length <= 48)
      .slice(0, 12)
    : [];
  const limit = Math.min(Math.max(Number(request?.limit) || 4, 1), 4);
  if (!terms.length) return { candidates: [] };
  const bank = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  const candidates = [];
  for (const [questionIdValue, row] of bank.entries()) {
    const questionId = String(questionIdValue || row?.['Question ID'] || '').trim();
    const subject = String(row?.Subject || '').normalize('NFKC').trim();
    const topic = String(row?.Topic || '').normalize('NFKC').trim();
    if (!questionId || !subject) continue;
    const searchable = [
      topic,
      subject,
      row?.['Essay Question'],
      row?.['Controlling Doctrine'],
      row?.['Jurisprudence / Case'],
    ].map((value) => String(value || '').normalize('NFKC').toLocaleLowerCase('en')).join('\n');
    const matchCount = terms.reduce((count, term) => count + (searchable.includes(term) ? 1 : 0), 0);
    if (!matchCount) continue;
    candidates.push({
      type: 'mock_bar',
      title: (topic || `${subject} practice question`).slice(0, 180),
      subject: subject.slice(0, 120),
      questionId,
      score: matchCount / terms.length,
    });
  }
  candidates.sort((left, right) => (
    right.score - left.score
      || left.title.localeCompare(right.title)
      || left.questionId.localeCompare(right.questionId)
  ));
  return { candidates: candidates.slice(0, limit) };
}

export async function loadWebsiteBankForTest(url = null) {
  return loadWebsiteBank(url);
}

export function resetWebsiteBankCacheForTest() {
  websiteBankCache = null;
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

async function callGeminiStructured(env, prompt, responseSchema, validateResult, options = {}) {
  const quiet = options?.quiet === true;
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
  // A reveal must never sit behind the examiner's full multi-model retry budget.
  // One configured model gets one repair attempt, then the curated fallback wins.
  for (const model of orderedModels(env.GEMINI_MODEL).slice(0, 1)) {
    let unsupported = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repair = attempt === 1
        ? '\n\nREPAIR: Return only valid JSON matching the supplied schema. Do not add markdown or commentary outside JSON.'
        : '';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SUBJECT_MATTER_TEACHING_TIMEOUT_MS);
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
        if (!quiet) {
          console.warn('Structured study coach request failed', {
            model,
            attempt: attempt + 1,
            reason: error?.name === 'AbortError' ? 'timeout' : 'network',
          });
        }
        if (attempt === 0) {
          await retryDelay(attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        if (!quiet) {
          console.warn('Structured study coach request rejected', {
            model,
            status: response.status,
            attempt: attempt + 1,
            provider: safeProviderErrorSummary(responseText, env.GEMINI_API_KEY),
          });
        }
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
        assessment = sanitizeLearnerFacingPayload({ assessment }).assessment;
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
    subject: 'Due Diligence Community report',
    text: [
      'A Community report was submitted.',
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
  if (query.operation === 'sample_feed') {
    result = buildCommunitySampleContent();
  } else if (query.operation === 'insights') {
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

async function handleQuorumCommand(request, env, origin, allowedOrigin, executionContext) {
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
  if (raw?.profileImage && command.operation !== 'set_profile_avatar') {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'A profile photo can be uploaded only while updating the profile photo.',
    );
  }
  if ((raw?.image || raw?.images) && !isEntryCreate) {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'Images can be attached only while creating an entry.',
    );
  }

  let result;
  if (command.operation === 'set_profile_avatar') {
    const objectPath = `profiles/${quorumRandomHex(12)}.${avatar.extension}`;
    if (!await queueQuorumAvatarCleanupJob(env, user.id, objectPath)) {
      throw new ForumValidationError(
        'QUORUM_IMAGE_UNAVAILABLE',
        'Your profile photo could not be prepared safely. Nothing was uploaded. Please try again.',
        503,
      );
    }
    await uploadQuorumAvatar(env, avatar, objectPath);
    try {
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
    } catch (error) {
      let activePath;
      try {
        activePath = await readQuorumAvatarRecord(env, user.id);
      } catch (readbackError) {
        console.error('Quorum profile photo commit state is uncertain; preserving uploaded object', {
          code: readbackError?.code || 'UNKNOWN',
        });
      }
      if (activePath === objectPath) {
        result = {
          updated: true,
          avatarPath: objectPath,
        };
      } else if (error instanceof ForumValidationError
          && Number(error.status) >= 400
          && Number(error.status) < 500) {
        await reconcileQuorumAvatarCleanupJobs(env, [objectPath]);
        throw error;
      } else {
        throw new ForumValidationError(
          'QUORUM_PROFILE_UNCERTAIN',
          'Your profile photo update could not be confirmed. Refresh your profile before trying again.',
          503,
        );
      }
    }
    const previousPath = result?.previousPath && result.previousPath !== objectPath
      ? String(result.previousPath)
      : null;
    await reconcileQuorumAvatarCleanupJobs(
      env,
      [objectPath, previousPath].filter(Boolean),
    );
    const publicAvatarResult = { ...(result || {}) };
    delete publicAvatarResult.previousPath;
    delete publicAvatarResult.cleanupQueued;
    result = { ...publicAvatarResult, avatarPath: objectPath };
  } else if (command.operation === 'remove_profile_avatar') {
    const previousPath = await readQuorumAvatarRecord(env, user.id);
    if (previousPath && !await deleteQuorumImage(env, previousPath)) {
      throw new ForumValidationError(
        'QUORUM_IMAGE_UNAVAILABLE',
        'Your profile photo could not be removed. Please try again.',
        502,
      );
    }
    if (previousPath) {
      await removeQuorumAvatarRecord(env, user.id, previousPath);
      await removeQuorumAvatarCleanupJob(env, previousPath);
    }
    result = { removed: Boolean(previousPath) };
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
      subject: 'Due Diligence Community report',
      text: [
        'A Community report was submitted.',
        `Reporter: ${user.email || 'Signed-in member'}`,
        `Target: ${command.payload.targetType} ${command.payload.targetId}`,
        `Category: ${command.payload.category}`,
        `Explanation: ${command.payload.explanation || 'None provided'}`,
      ].join('\n'),
      replyTo: user.email,
      adminPath: '/admin/',
    });
  }

  let publicResult = await withSignedQuorumImages(result, env);
  if (command.operation === 'set_profile_avatar' && result?.avatarPath && !publicResult?.avatarUrl) {
    await retryDelay(0);
    publicResult = await withSignedQuorumImages(result, env);
    if (!publicResult?.avatarUrl) {
      throw new ForumValidationError(
        'QUORUM_IMAGE_UNAVAILABLE',
        'Your profile photo was saved, but it could not be displayed securely. Please try again.',
        502,
      );
    }
  }
  if (isEntryCreate || command.operation === 'create_simple_entry') {
    scheduleAdminPulse(env, executionContext);
  }
  return jsonResponse(
    { ok: true, data: publicResult },
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
    ? await forumRpc(env, 'forum_resolve_anonymous_identity_v2', {
      p_actor_user_id: user.id,
      p_target_type: normalized.payload.targetType,
      p_target_public_id: normalized.payload.targetId,
      p_reason: normalized.payload.reason,
    })
    : await forumRpc(env, 'forum_quorum_admin_safe', {
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

function retiredForumWriteResponse(origin, allowedOrigin) {
  return jsonResponse({
    ok: false,
    error: {
      code: 'FORUM_ROUTE_RETIRED',
      message: 'Refresh Due Diligence to publish through the current privacy-safe Community editor.',
    },
  }, 410, origin, allowedOrigin);
}

function examinationQuestionContext(question) {
  const jurisprudence = Array.isArray(question?.jurisprudence)
    ? question.jurisprudence.filter(Boolean).join('; ')
    : String(question?.jurisprudence || '');
  return {
    subject: String(question?.subject || 'Philippine law'),
    question: String(question?.prompt || ''),
    suggestedAnswer: stripInternalEditorialBlocks(question?.modelAnswer),
    legalBasis: stripInternalEditorialBlocks(question?.legalBasis),
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
      assessment = sanitizeLearnerFacingPayload({ assessment }).assessment;
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

async function failExaminationAiJob(env, user, gradingPackage, error) {
  if (!gradingPackage?.jobId || !user?.id) return;
  try {
    await examinationRpc(env, 'examination_fail_ai_job', {
      p_user_id: user.id,
      p_job_id: gradingPackage.jobId,
      p_safe_error_code: error?.code || 'grading_failed',
    });
  } catch {
    console.error('Examination grading failure state requires operator review');
  }
}

async function processExaminationAiJob(env, user, gradingPackage, commercialReservation = null) {
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
    const persistenceOperation = commercialReservation?.reservationId
      ? 'examination_store_ai_assessment_commercial'
      : 'examination_store_ai_assessment';
    finalState = await examinationRpc(env, persistenceOperation, {
      p_user_id: user.id,
      p_job_id: gradingPackage.jobId,
      p_question_id: question.questionId,
      p_score: assessment.score,
      p_assessment: assessment,
      p_grader_model: model,
      p_model_answer_hash: question.modelAnswerHash,
      ...(commercialReservation?.reservationId
        ? { p_reservation_id: commercialReservation.reservationId }
        : {}),
    });
    if (finalState?.modelsReleased) {
      const delivery = {
        status: 'suppressed',
        providerId: null,
        safeErrorCode: 'practice_exam_email_removed',
      };
      try {
        await examinationRpc(env, 'examination_record_delivery', {
          p_actor_user_id: user.id,
          p_target_type: 'model_answers_released',
          p_target_id: gradingPackage.attemptId,
          p_status: delivery.status,
          p_provider_id: delivery.providerId || null,
          p_safe_error_code: delivery.safeErrorCode || null,
        });
      } catch {
        // Email delivery is permanently absent for Practice Exams. A legacy
        // audit-row failure must not turn completed grading into a failed job.
        console.error('Practice Exam email-removal audit requires operator review');
      }
      finalState.modelAnswerEmailStatus = delivery.status;
    }
    return finalState;
  } catch (error) {
    await failExaminationAiJob(env, user, gradingPackage, error);
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

const SUBJECT_MATTER_RELEASE_POLICY_VERSION = 'subject-review-unlimited-v1-2026-08-26';
const SUBJECT_MATTER_RELEASE_ACCESS_BASES = new Set([
  'super_admin',
  'founder_admin',
  'founding_beta',
  'early_access',
  'paid_subscription',
]);

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
    const selector = syllabusBasedReviewRandomizationV2Enabled(env)
      ? 'subject_matter_next_question_v2'
      : 'subject_matter_next_question';
    const result = await examinationRpc(env, selector, {
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
    return jsonResponse({
      ok: true,
      data: sanitizeLearnerFacingPayload(result),
    }, 200, origin, allowedOrigin);
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
        allowHistorical: Boolean(query.attemptId),
      });
    } else if (query.operation === 'verdict') {
      await authorizeExaminationAccess(env, user.id, {
        attemptId: query.attemptId,
        allowHistorical: true,
      });
    } else if (query.operation === 'history') {
      await authorizeExaminationAccess(env, user.id, {
        track: query.track,
        allowHistorical: true,
      });
    }
  }
  const result = query.operation === 'history' && query.track
    ? await examinationRpc(env, 'examination_history_by_track_v1', {
      p_user_id: user.id,
      p_track: query.track,
      p_limit: query.limit,
      p_offset: query.offset,
    })
    : await examinationRpc(env, 'examination_query', {
      p_user_id: user?.id || null,
      p_operation: query.operation,
      p_payload: query,
    });
  const learnerResult = ['verdict', 'history'].includes(query.operation)
    ? sanitizeLearnerFacingPayload(result)
    : result;
  return jsonResponse({ ok: true, data: learnerResult }, 200, origin, allowedOrigin);
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
  let authorizedAccess = null;
  let useRandomizedBarSimulationStart = false;
  if (user) {
    if (command.operation === 'start_attempt') {
      authorizedAccess = await authorizeExaminationAccess(
        env,
        user.id,
        { versionId: command.versionId },
      );
      if (authorizedAccess?.track === 'bar_feels'
          && barExamSimulationRandomizationSchemaReady(env)) {
        const setup = await examinationRpc(env, 'examination_query', {
          p_user_id: user.id,
          p_operation: 'setup',
          p_payload: {
            operation: 'setup',
            versionId: command.versionId,
          },
        });
        if (randomizedBarSimulationSetupEligible(setup)) {
          if (barExamSimulationRandomizationV1Enabled(env)) {
            useRandomizedBarSimulationStart = true;
          } else {
            const openRandomizedAttempt = await examinationRpc(
              env,
              'bar_simulation_open_attempt_v1',
              {
                p_user_id: user.id,
                p_catalog_version_id: command.versionId,
              },
            );
            // Rollback safety: new starts return to the fixed catalog, while an
            // already-open private allocation must remain resumable by its owner.
            useRandomizedBarSimulationStart = Boolean(openRandomizedAttempt?.attemptId);
          }
        }
      }
    } else if (command.operation === 'confirm_upload') {
      await authorizeExaminationAccess(env, user.id, { track: 'bar_feels' });
    } else if (command.operation === 'delete_upload') {
      await authorizeExaminationAccess(env, user.id, {
        track: 'bar_feels',
        allowHistorical: true,
      });
    } else if (command.attemptId && command.operation !== 'subject_reveal_review') {
      authorizedAccess = await authorizeExaminationAccess(env, user.id, {
        attemptId: command.attemptId,
        allowHistorical: [
          'heartbeat',
          'save_response',
          'flag_response',
          'submit_attempt',
        ].includes(command.operation),
      });
    }
  }

  if (user && command.operation === 'subject_reveal_review') {
    let stored;
    try {
      stored = await examinationRpc(env, 'subject_matter_reveal_review', {
        p_user_id: user.id,
        p_attempt_id: command.attemptId,
      });
    } catch (error) {
      const code = String(error?.code || '');
      const message = String(error?.message || '');
      if (/EXAM_(?:ATTEMPT_NOT_FOUND|ACCESS_REQUIRED|SUBJECT_REVIEW_MATERIAL_UNAVAILABLE)/.test(
        `${code} ${message}`,
      )) {
        throw new ExaminationValidationError(
          'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE',
          'Verified review material is not available for this question.',
          404,
        );
      }
      throw error;
    }

    const firstReveal = stored?.firstReveal === true;
    let access;
    try {
      if (typeof stored?.firstReveal !== 'boolean'
          || stored?.releaseAuthorized !== true
          || stored?.releasePolicyVersion !== SUBJECT_MATTER_RELEASE_POLICY_VERSION) {
        throw new Error('untrusted_release_provenance');
      }
      access = normalizeAccessSnapshot(stored.access);
      if (firstReveal
          && (!access.allowed
            || !access.unlimited
            || !SUBJECT_MATTER_RELEASE_ACCESS_BASES.has(access.basis))) {
        throw new Error('invalid_first_release_access');
      }
    } catch {
      throw new ExaminationValidationError(
        'SYLLABUS_REVIEW_RELEASE_INTEGRITY',
        'The protected review release could not be verified. Please try again later.',
        503,
      );
    }

    let material;
    try {
      material = sanitizeSubjectMatterRevealRecord(stored, command.attemptId);
    } catch {
      throw new ExaminationValidationError(
        'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE',
        'Verified review material is not available for this question.',
        404,
      );
    }
    let explanation = fallbackSubjectMatterTeachingExplanation(material);
    let explanationSource = 'curated_fallback';
    let teachingModel = null;
    if (firstReveal) {
      try {
        const generated = await callGeminiStructured(
          env,
          buildSubjectMatterTeachingPrompt(material),
          SUBJECT_MATTER_TEACHING_SCHEMA,
          (value) => validateSubjectMatterTeachingExplanation(value, material),
        );
        explanation = generated.result;
        explanationSource = 'gemini_curated';
        teachingModel = generated.model;
      } catch (error) {
        console.warn('Subject Matter teaching explanation used curated fallback', {
          code: String(error?.code || 'validation_failed').slice(0, 48),
        });
      }
    }

    return jsonResponse({
      ok: true,
      data: publicSubjectMatterReviewPayload(material, explanation, {
        explanationSource,
        teachingModel,
        access,
      }),
    }, 200, origin, allowedOrigin);
  }

  if (user && command.operation === 'subject_skip_question') {
    const selector = syllabusBasedReviewRandomizationV2Enabled(env)
      ? 'subject_matter_skip_question_v2'
      : 'subject_matter_skip_question';
    const result = await examinationRpc(env, selector, {
      p_user_id: user.id,
      p_attempt_id: command.attemptId,
      p_request_key: command.requestKey,
      p_tab_token: command.tabToken,
    });
    return jsonResponse({
      ok: true,
      data: sanitizeSubjectMatterSelection(result),
    }, 200, origin, allowedOrigin);
  }

  if (user && command.operation === 'start_attempt' && useRandomizedBarSimulationStart) {
    const result = await examinationRpc(env, 'bar_simulation_start_attempt_v1', {
      p_user_id: user.id,
      p_catalog_version_id: command.versionId,
      p_timer_mode: command.timerMode,
      p_request_key: command.requestKey,
      p_tab_token: command.tabToken,
    });
    return jsonResponse({ ok: true, data: result }, 201, origin, allowedOrigin);
  }

  const result = await examinationRpc(env, 'examination_command', {
    p_user_id: user?.id || null,
    p_operation: command.operation,
    p_payload: command,
  });

  if (command.operation === 'request_ai_grading') {
    const pendingQuestion = Array.isArray(result?.questions) ? result.questions[0] : null;
    let reservation = null;
    if (pendingQuestion?.questionId) {
      const commercialTrack = authorizedAccess?.track === 'bar_feels'
        ? 'bar_feels'
        : 'subject_matter';
      try {
        reservation = await reserveCommercialSubmission(
          request,
          env,
          user,
          commercialTrack,
          pendingQuestion.questionId,
          command.requestKey,
        );
      } catch (error) {
        // examination_command creates (or reopens) the grading job before
        // commercial capacity is reserved. Preserve an honest resumable state
        // when access or capacity prevents this question from being processed.
        await failExaminationAiJob(env, user, result, error);
        throw error;
      }
    }
    let state;
    try {
      state = await processExaminationAiJob(env, user, result, reservation);
    } catch (error) {
      await releaseCommercialSubmission(env, reservation, 'grading_failed');
      throw error;
    }
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
        access: state?.access || reservation?.access || null,
      },
    }, 200, origin, allowedOrigin);
  }

  if (command.operation === 'create_examiner_assignment') {
    const assignmentUrl = `${allowedOrigin}/?assignment=${encodeURIComponent(
      command.assignmentToken,
    )}#examiner-review`;
    const delivery = {
      status: 'suppressed',
      providerId: null,
      safeErrorCode: 'practice_exam_email_removed',
    };
    try {
      await examinationRpc(env, 'examination_record_delivery', {
        p_actor_user_id: user.id,
        p_target_type: 'examiner_invitation',
        p_target_id: result.assignmentId,
        p_status: delivery.status,
        p_provider_id: delivery.providerId || null,
        p_safe_error_code: delivery.safeErrorCode || null,
      });
    } catch {
      // The assignment and its manual secure link already exist. Do not hide
      // that link merely because the legacy delivery audit could not be saved.
      console.error('Practice Exam email-removal audit requires operator review');
    }
    result.invitationStatus = delivery.status;
    result.assignmentUrl = assignmentUrl;
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

const STUDY_RESOURCE_TYPES = new Set(['doctrine', 'chair_case', 'anchor_case', 'subject_matter']);

function normalizeStudyResource(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 240) {
    throw new ExaminerError('STUDY_ANNOTATION_INVALID', `${label} is invalid.`, 400);
  }
  return normalized;
}

function normalizeStudyType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!STUDY_RESOURCE_TYPES.has(type)) {
    throw new ExaminerError('STUDY_ANNOTATION_INVALID', 'Choose an eligible study resource.', 400);
  }
  return type;
}

async function handleStudyAnnotationQuery(request, env, origin, allowedOrigin) {
  const user = await requireAuthenticatedUser(request, env);
  const raw = await parseBoundedJson(request, 8_000);
  const type = raw.resourceType == null ? null : normalizeStudyType(raw.resourceType);
  const resourceId = raw.resourceId == null ? null : normalizeStudyResource(raw.resourceId, 'Study item');
  const annotations = await protectedSupabaseRpc(env, 'study_annotation_query', {
    p_user_id: user.id,
    p_resource_type: type,
    p_resource_id: resourceId,
  });
  return jsonResponse({ ok: true, data: { annotations } }, 200, origin, allowedOrigin);
}

async function handleStudyAnnotationCommand(request, env, origin, allowedOrigin) {
  const user = await requireAuthenticatedUser(request, env);
  const raw = await parseBoundedJson(request, 24_000);
  const operation = String(raw.operation || '').trim().toLowerCase();
  if (!['save', 'delete'].includes(operation)) {
    throw new ExaminerError('STUDY_ANNOTATION_INVALID', 'Choose save or delete.', 400);
  }
  const payload = {
    resourceType: normalizeStudyType(raw.resourceType),
    resourceId: normalizeStudyResource(raw.resourceId, 'Study item'),
    noteText: String(raw.noteText || '').slice(0, 12_001),
    selectedText: raw.selectedText == null ? null : String(raw.selectedText).slice(0, 1_001),
    expectedRevision: Number.isInteger(Number(raw.expectedRevision))
      ? Number(raw.expectedRevision) : 0,
  };
  if (payload.noteText.length > 12_000 || String(payload.selectedText || '').length > 1_000) {
    throw new ExaminerError('STUDY_ANNOTATION_INVALID', 'The study note is too long.', 400);
  }
  const result = await protectedSupabaseRpc(env, 'study_annotation_command', {
    p_user_id: user.id,
    p_operation: operation,
    p_payload: payload,
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
  const [subjectSource, websiteCsv, visibilityCsv, barSimulationCsv] = await Promise.all([
    loadSubjectMatterSource(env),
    fetchPublishedCsv(WEBSITE_UPLOAD_CSV_URL, 'Mock Bar source'),
    fetchPublishedCsv(WEBSITE_VISIBILITY_CSV_URL, 'website publication visibility'),
    fetchPublishedCsv(BAR_SIMULATION_POOL_CSV_URL, 'Bar Exam Simulation pool source'),
  ]);
  const websiteSource = await parseWebsiteUploadSource(websiteCsv);
  const barSimulationSource = await parseWebsiteUploadSource(barSimulationCsv);
  const overlaidWebsiteRecords = applyWebsitePublicationOverlay(
    parseQuestionBank(websiteCsv),
    parseWebsitePublicationOverlay(visibilityCsv),
  );
  const subjectPlacementManifest = buildSubjectMatterPlacements(subjectSource.rows);
  const visibleBarRows = visibleWebsiteReleaseRows(
    websiteSource.rows,
    overlaidWebsiteRecords,
  );
  const visibleBarSimulationRows = barSimulationSource.rows.filter(
    (row) => row.publicationReady === 'Yes',
  );
  const barGroups = buildBarFeelsManifest(visibleBarRows);
  const barDigest = await websitePublicationDigest(
    websiteSource.digest,
    overlaidWebsiteRecords,
  );
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
    p_bar_digest: barDigest,
    p_bar_endpoint: WEBSITE_UPLOAD_CSV_URL,
  });
  let barSimulationPool = null;
  if (barExamSimulationRandomizationSchemaReady(env)) {
    // This is a private eligibility snapshot only. The database RPC does not
    // activate a catalog version or enable randomized allocation.
    const poolSyncId = crypto.randomUUID();
    const poolPartSize = 50;
    const poolTotalParts = Math.ceil(visibleBarSimulationRows.length / poolPartSize);
    for (let offset = 0; offset < visibleBarSimulationRows.length; offset += poolPartSize) {
      await examinationRpc(env, 'bar_simulation_stage_pool_v1', {
        p_actor_user_id: user.id,
        p_sync_id: poolSyncId,
        p_part_number: Math.floor(offset / poolPartSize) + 1,
        p_total_parts: poolTotalParts,
        p_rows: visibleBarSimulationRows.slice(offset, offset + poolPartSize),
        p_source_digest: barSimulationSource.digest,
        p_source_endpoint: BAR_SIMULATION_POOL_CSV_URL,
      });
    }
    barSimulationPool = await examinationRpc(env, 'bar_simulation_finalize_pool_v1', {
      p_actor_user_id: user.id,
      p_sync_id: poolSyncId,
      p_source_digest: barSimulationSource.digest,
      p_source_endpoint: BAR_SIMULATION_POOL_CSV_URL,
    });
  }
  // Never echo question or answer content from the administrative sync.
  return jsonResponse({
    ok: true,
    data: {
      subjectMatter: result?.subjectMatter || null,
      barFeels: result?.barFeels || null,
      barExamSimulationPool: barSimulationPool,
      sources: {
        subjectMatter: SUBJECT_MATTER_CSV_URL,
        mockBar: WEBSITE_UPLOAD_CSV_URL,
        barExamSimulation: BAR_SIMULATION_POOL_CSV_URL,
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
  const termsVersion = String(policy?.legal?.termsVersion || '').trim();
  const privacyVersion = String(policy?.legal?.privacyVersion || '').trim();
  if (!termsVersion || !privacyVersion) {
    throw new ExaminerError(
      'LEGAL_POLICY_UNAVAILABLE',
      'The current Terms and Privacy policy is temporarily unavailable.',
      503,
    );
  }
  return jsonResponse({
    ok: true,
    policy: {
      enabled: policy?.enabled === true,
      commercialLaunchEnabled: policy?.commercialLaunchEnabled === true,
      legal: { termsVersion, privacyVersion },
    },
  }, 200, origin, allowedOrigin);
}

async function handleCurrentLegalAcceptance(request, env, origin, allowedOrigin) {
  const user = await verifiedAuthenticatedUser(request, env);
  if (!user) {
    throw new GuestAccessError('SIGN_IN_REQUIRED', 'Sign-in is required.', 401);
  }
  const result = await phase4Rpc(env, 'phase4_accept_current_terms_for_user', {
    p_user_id: user.id,
    p_acceptance_source: 'web_authenticated_acceptance',
  });
  const termsVersion = String(result?.termsVersion || '').trim();
  const privacyVersion = String(result?.privacyVersion || '').trim();
  const acceptedAt = String(result?.acceptedAt || '').trim();
  if (result?.recorded !== true || !termsVersion || !privacyVersion || !acceptedAt) {
    throw new ExaminerError(
      'LEGAL_ACCEPTANCE_UNAVAILABLE',
      'Your acceptance could not be verified. Please try again.',
      503,
    );
  }
  return jsonResponse({
    ok: true,
    acceptance: {
      recorded: true,
      termsVersion,
      privacyVersion,
      acceptedAt,
    },
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
  if (!barQuestionPracticeRandomizationV2Enabled(env)) {
    const inventory = protectedQuestionInventory(records);
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
        questionsPerSubject: inventory[subject].length,
        totalQuestions: Object.values(inventory)
          .reduce((total, questions) => total + questions.length, 0),
      },
    }, 200, origin, allowedOrigin);
  }

  const canonicalInventory = protectedQuestionInventory(records);
  const availableInventory = availableProtectedQuestionInventory(records);
  const requestedQuestionId = String(payload?.questionId || '').trim();
  const requestedIssuanceId = String(payload?.issuanceId || '').trim();
  const validRequestedIssuanceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(requestedIssuanceId)
    ? requestedIssuanceId
    : null;
  let question;
  let rotation = null;

  if (requestedQuestionId) {
    const visibleQuestionIds = new Set(
      availableInventory[subject].map((candidate) => candidate.id),
    );
    let restoreAuthorized = false;
    if (validRequestedIssuanceId) {
      restoreAuthorized = await phase4Rpc(
        env,
        'feature_question_restore_authorized_v2',
        {
          p_user_id: user.id,
          p_feature_key: 'bar_question_practice',
          p_subject: subject,
          p_question_id: requestedQuestionId,
          p_issuance_id: validRequestedIssuanceId,
        },
      );
    }

    if (!visibleQuestionIds.has(requestedQuestionId)) {
      if (restoreAuthorized !== true) {
        throw new ExaminerError(
          'QUESTION_NOT_FOUND',
          'The protected question could not be restored.',
          404,
        );
      }
    } else if (restoreAuthorized !== true) {
      // Explicit visible IDs are used by resumable workspaces and mapped
      // Quorum links. They must still pass the same lifetime answered ledger
      // as ordinary randomized entry. A one-candidate selection creates
      // durable issuance/receipt evidence without allowing an answered item
      // to bypass no-repeat.
      rotation = await phase4Rpc(env, 'select_feature_question_v2', {
        p_user_id: user.id,
        p_feature_key: 'bar_question_practice',
        p_subject: subject,
        p_candidate_question_ids: [requestedQuestionId],
        p_soft_exclude_question_ids: [],
        p_request_key: requestKey,
      });
      if (rotation?.exhausted === true
          || String(rotation?.questionId || '').trim() !== requestedQuestionId) {
        throw new ExaminerError(
          'QUESTION_ALREADY_ANSWERED',
          'You have already answered this Bar Question Practice item. Open a randomized question instead.',
          409,
        );
      }
    }
    // A hidden item can reach this restoration path only after the database
    // confirms an unexpired, owner-bound issuance and that the same user has
    // not already answered it.
    question = selectProtectedQuestion(records, {
      subject,
      questionId: requestedQuestionId,
    });
  } else {
    const transitionExclusions = new Set(
      Array.isArray(payload?.excludeQuestionIds)
        ? payload.excludeQuestionIds
          .map((questionId) => String(questionId || '').trim())
          .filter(Boolean)
          .slice(0, 40)
        : [],
    );
    const rotationCandidates = availableInventory[subject]
      .map((candidate) => candidate.id);
    rotation = await phase4Rpc(env, 'select_feature_question_v2', {
      p_user_id: user.id,
      p_feature_key: 'bar_question_practice',
      p_subject: subject,
      p_candidate_question_ids: rotationCandidates,
      p_soft_exclude_question_ids: [...transitionExclusions],
      p_request_key: requestKey,
    });
    if (rotation?.exhausted === true || !String(rotation?.questionId || '').trim()) {
      throw new ExaminerError(
        'QUESTION_POOL_COMPLETED',
        `You have answered every available ${subject} question in Bar Question Practice. Choose another subject.`,
        409,
      );
    }
    question = selectProtectedQuestion(records, {
      subject,
      questionId: String(rotation.questionId).trim(),
    });
  }
  return jsonResponse({
    ok: true,
    access,
    question,
    rotation: rotation ? {
      feature: 'bar_question_practice',
      answeredCount: Number(rotation.answeredCount) || 0,
      unansweredCount: Number(rotation.unansweredCount) || 0,
      remainingUnissued: Number(rotation.remainingUnissued) || 0,
      cycleNumber: Number(rotation.cycleNumber) || 1,
      issuanceId: String(rotation.issuanceId || ''),
      issuanceExpiresAt: String(rotation.issuanceExpiresAt || ''),
    } : null,
    inventory: {
      subjects: 8,
      questionsPerSubject: availableInventory[subject].length,
      totalQuestions: Object.values(availableInventory)
        .reduce((total, questions) => total + questions.length, 0),
      canonicalQuestionsPerSubject: canonicalInventory[subject].length,
      canonicalTotalQuestions: Object.values(canonicalInventory)
        .reduce((total, questions) => total + questions.length, 0),
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
  return jsonResponse({
    ok: true,
    history: sanitizeLearnerFacingPayload(result),
  }, 200, origin, allowedOrigin);
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

async function handleSupport(request, env, origin, allowedOrigin, executionContext) {
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
  scheduleAdminPulse(env, executionContext);
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
  const reader = request.body?.getReader?.();
  const chunks = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      totalBytes += chunk.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ExaminerError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
      }
      chunks.push(chunk);
    }
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The request contains invalid JSON.', 400);
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

const PRICING_ADMIN_ROLES = new Set(['founder_admin', 'super_admin']);

async function requirePricingAdministrator(request, env) {
  const user = await requireAdministrator(request, env);
  const authorization = await protectedSupabaseRpc(env, 'admin_authorization_context', {
    p_actor_user_id: user.id,
  });
  if (
    authorization?.authorized !== true
    || !PRICING_ADMIN_ROLES.has(String(authorization?.role || '').trim().toLowerCase())
  ) {
    throw new PricingValidationError(
      'PRICING_ADMIN_FORBIDDEN',
      'Only a Founder or Super Admin can edit or publish pricing.',
      403,
    );
  }
  return { user, authorization };
}

async function handleAnalytics(request, env, origin, allowedOrigin, executionContext) {
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
  if (event.eventType === 'session_start') {
    scheduleAdminPulse(env, executionContext);
  }
  return jsonResponse({ ok: true, accepted: Boolean(result?.accepted) }, 202, origin, allowedOrigin);
}

async function handleAdminSession(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const result = await protectedSupabaseRpc(env, 'admin_authorization_context', {
    p_actor_user_id: user.id,
  });
  return jsonResponse({ ok: true, ...result }, 200, origin, allowedOrigin);
}

function scheduleAdminPulse(env, executionContext) {
  return scheduleAdminPulseDispatch(env, executionContext, {
    rpc: protectedSupabaseRpc,
  });
}

async function handleAdminPulseSnapshot(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await authorizeAdminPulse(request, env, {
    requireAdministrator,
    rpc: protectedSupabaseRpc,
  });
  const payload = request.body == null
    ? {}
    : await parseBoundedJson(request, 2_000);
  const query = normalizeAdminPulseSnapshotRequest(payload);
  if (!adminPulseEnabled(env)) {
    return jsonResponse({
      ok: true,
      enabled: false,
      vapidPublicKey: null,
      snapshot: emptyAdminPulseSnapshot(),
      subscribed: false,
    }, 200, origin, allowedOrigin);
  }

  const result = await protectedSupabaseRpc(env, 'admin_pulse_snapshot_v1', {
    p_actor_user_id: user.id,
    p_limit: query.limit,
  });
  const enabled = result?.captureEnabled === true;
  const deliveryEnabled = enabled
    && result?.deliveryEnabled === true
    && adminPulseWebPushConfigured(env);
  return jsonResponse({
    ok: true,
    enabled,
    vapidPublicKey: deliveryEnabled
      ? adminPulsePublicVapidKey(env)
      : null,
    snapshot: enabled ? {
      generatedAt: result?.generatedAt || new Date().toISOString(),
      activeUsers: {
        count: Math.max(0, Number(result?.activeUsers?.count) || 0),
      },
      events: Array.isArray(result?.events) ? result.events : [],
    } : emptyAdminPulseSnapshot(),
    subscribed: deliveryEnabled && result?.subscribed === true,
  }, 200, origin, allowedOrigin);
}

async function handleAdminPulsePushSubscription(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await authorizeAdminPulse(request, env, {
    requireAdministrator,
    rpc: protectedSupabaseRpc,
  });
  const command = normalizeAdminPulsePushRequest(
    await parseBoundedJson(request, 8_000),
  );
  if (command.operation === 'upsert' && !adminPulseEnabled(env)) {
    throw new AdminPulseError(
      'ADMIN_PULSE_DISABLED',
      'Due Diligence Pulse is not enabled for this environment.',
      404,
    );
  }
  if (command.operation === 'upsert' && !adminPulseWebPushConfigured(env)) {
    throw new AdminPulseError(
      'ADMIN_PULSE_PUSH_UNAVAILABLE',
      'Due Diligence Pulse notifications are not configured.',
      503,
    );
  }

  const result = command.operation === 'upsert'
    ? await protectedSupabaseRpc(env, 'admin_pulse_upsert_push_subscription_v1', {
      p_actor_user_id: user.id,
      p_endpoint: command.subscription.endpoint,
      p_p256dh: command.subscription.keys.p256dh,
      p_auth_secret: command.subscription.keys.auth,
      p_expiration_time: command.subscription.expirationTime,
      p_user_agent_family: coarsePushUserAgent(request.headers.get('User-Agent')),
    })
    : await protectedSupabaseRpc(env, 'admin_pulse_remove_push_subscription_v1', {
      p_actor_user_id: user.id,
      p_endpoint: command.subscription.endpoint,
    });

  const enabled = adminPulseEnabled(env) && result?.captureEnabled === true;
  const deliveryEnabled = enabled
    && result?.deliveryEnabled === true
    && adminPulseWebPushConfigured(env);
  return jsonResponse({
    ok: true,
    enabled,
    subscribed: deliveryEnabled && result?.subscribed === true,
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
  const dashboardSnapshot = await protectedSupabaseRpc(env, 'admin_dashboard_snapshot_scoped_v1', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
    p_data_scope: report.dataScope,
  });
  const marketingSummary = await protectedSupabaseRpc(env, 'admin_marketing_summary_scoped_v1', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
    p_data_scope: report.dataScope,
  });
  let engagement = null;
  try {
    engagement = await protectedSupabaseRpc(env, 'admin_overview_engagement_metrics_scoped_v1', {
      p_actor_user_id: user.id,
      p_data_scope: report.dataScope,
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
  const currentMarketing = marketingSummary?.current || {};
  const previousMarketing = marketingSummary?.previous || {};
  const result = {
    ...(dashboardSnapshot || {}),
    current: {
      ...(dashboardSnapshot?.current || {}),
      traffic: {
        ...(dashboardSnapshot?.current?.traffic || {}),
        home_viewers: currentMarketing.home_viewers ?? null,
      },
      funnel: {
        ...(dashboardSnapshot?.current?.funnel || {}),
        new_accounts: currentMarketing.new_accounts ?? null,
      },
    },
    previous: {
      ...(dashboardSnapshot?.previous || {}),
      traffic: {
        ...(dashboardSnapshot?.previous?.traffic || {}),
        home_viewers: previousMarketing.home_viewers ?? null,
      },
      funnel: {
        ...(dashboardSnapshot?.previous?.funnel || {}),
        new_accounts: previousMarketing.new_accounts ?? null,
      },
    },
    marketingDefinitions: marketingSummary?.definitions || null,
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
  return jsonResponse({
    ok: true,
    report: result,
    dataScope: report.dataScope,
  }, 200, origin, allowedOrigin);
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
  const result = query.section === 'support'
    ? await protectedSupabaseRpc(env, 'admin_support_queue_v1', {
      p_actor_user_id: user.id,
      p_search: query.search,
      p_limit: query.limit,
      p_offset: query.offset,
      p_request_key: normalizeRequestKey(request.headers.get('X-Request-ID')),
    })
    : await protectedSupabaseRpc(env, 'admin_operational_data', {
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
  const data = await protectedSupabaseRpc(env, 'admin_user_monitoring_directory_scoped_v1', {
    p_actor_user_id: user.id,
    p_search: query.search,
    p_limit: query.limit,
    p_offset: query.offset,
    p_request_key: query.requestKey,
    p_access_purpose: query.accessPurpose,
    p_data_scope: query.dataScope,
  });
  return { data, query };
}

async function handleAdminUserDirectory(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { data, query } = await adminUserDirectoryResult(request, env, 'dashboard');
  return jsonResponse({
    ok: true,
    data,
    dataScope: query.dataScope,
  }, 200, origin, allowedOrigin);
}

async function handleAdminRecentSignIns(request, env, origin, allowedOrigin) {
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
  const result = await protectedSupabaseRpc(env, 'admin_recent_sign_in_directory_scoped_v1', {
    p_actor_user_id: user.id,
    p_limit: Math.min(query.limit, 25),
    p_request_key: query.requestKey,
    p_data_scope: query.dataScope,
  });
  return jsonResponse({
    ok: true,
    data: result,
    dataScope: query.dataScope,
  }, 200, origin, allowedOrigin);
}

async function handleAdminUserDirectoryExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { data: result, query } = await adminUserDirectoryResult(request, env, 'csv_export');
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
      'Content-Disposition': `attachment; filename="due-diligence-users-${query.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}.csv"`,
      'X-Admin-Data-Scope': query.dataScope,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleAdminSubscriptionsExport(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { data: result, query } = await adminUserDirectoryResult(request, env, 'csv_export');
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
      'Content-Disposition': `attachment; filename="due-diligence-subscriptions-${query.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}.csv"`,
      'X-Admin-Data-Scope': query.dataScope,
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
  const result = await protectedSupabaseRpc(env, 'admin_live_activity_scoped_v1', {
    p_actor_user_id: user.id,
    p_limit: query.limit,
    p_request_key: query.requestKey,
    p_data_scope: query.dataScope,
  });
  return jsonResponse({
    ok: true,
    data: result,
    dataScope: query.dataScope,
  }, 200, origin, allowedOrigin);
}

async function handleAdminRecentUserActivity(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  let query;
  try {
    query = normalizeRecentUserActivityRequest(await parseBoundedJson(request, 4_000));
  } catch (error) {
    if (error instanceof AdminValidationError) {
      throw new ExaminerError('INVALID_ADMIN_REQUEST', error.message, 400);
    }
    throw error;
  }
  const result = await protectedSupabaseRpc(env, 'admin_recent_user_activity_directory_scoped_v1', {
    p_actor_user_id: user.id,
    p_search: query.search,
    p_from: query.from,
    p_to: query.to,
    p_limit: query.limit,
    p_offset: query.offset,
    p_request_key: query.requestKey,
    p_data_scope: query.dataScope,
  });
  return jsonResponse({
    ok: true,
    data: result,
    dataScope: query.dataScope,
  }, 200, origin, allowedOrigin);
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
    'admin_prepare_user_directory_email_export_scoped_v1',
    {
      p_actor_user_id: user.id,
      p_search: exportRequest.search,
      p_limit: exportRequest.limit,
      p_recipient_key: exportRequest.recipientKey,
      p_reason: exportRequest.reason,
      p_request_key: exportRequest.requestKey,
      p_data_scope: exportRequest.dataScope,
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
        filename: `due-diligence-private-user-directory-${exportRequest.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}.csv`,
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
      dataScope: exportRequest.dataScope,
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
  const result = await protectedSupabaseRpc(
    env,
    'admin_preview_answer_history_by_feature_scoped_v1',
    {
      p_actor_user_id: user.id,
      p_target_user_id: previewRequest.targetUserId,
      p_from: previewRequest.from,
      p_to: previewRequest.to,
      p_search: previewRequest.search,
      p_feature_key: previewRequest.feature,
      p_limit: previewRequest.limit,
      p_offset: previewRequest.offset,
      p_request_key: previewRequest.requestKey,
      p_data_scope: previewRequest.dataScope,
    },
  );
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
      featureFilter: result?.featureFilter || previewRequest.feature,
      featureTotals: result?.featureTotals || null,
      dataScope: previewRequest.dataScope,
    },
    dataScope: previewRequest.dataScope,
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
  const result = await protectedSupabaseRpc(env, 'admin_export_answer_history_scoped_v1', {
    p_actor_user_id: user.id,
    p_target_user_id: exportRequest.targetUserId,
    p_from: exportRequest.from,
    p_to: exportRequest.to,
    p_limit: exportRequest.limit,
    p_reason: exportRequest.reason,
    p_request_key: exportRequest.requestKey,
    p_data_scope: exportRequest.dataScope,
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
      'Content-Disposition': `attachment; filename="due-diligence-answer-history-${exportRequest.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}-${scope}.csv"`,
      'X-Admin-Data-Scope': exportRequest.dataScope,
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
  const snapshot = await protectedSupabaseRpc(env, 'admin_dashboard_snapshot_scoped_v1', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
    p_data_scope: report.dataScope,
  });
  await protectedSupabaseRpc(env, 'admin_execute_action', {
    p_actor_user_id: user.id,
    p_action: 'aggregate_export',
    p_target_id: null,
    p_payload: { aggregate_only: true, data_scope: report.dataScope },
    p_reason: 'Authorized aggregate business report export',
    p_request_key: crypto.randomUUID().replace(/-/g, ''),
  });
  return new Response(aggregateCsv(snapshot), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="due-diligence-aggregate-report-${report.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}.csv"`,
      'X-Admin-Data-Scope': report.dataScope,
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
  const result = await protectedSupabaseRpc(env, 'admin_export_answer_history_scoped_v1', {
    p_actor_user_id: user.id,
    p_target_user_id: exportRequest.targetUserId,
    p_from: exportRequest.from,
    p_to: exportRequest.to,
    p_limit: exportRequest.limit,
    p_reason: exportRequest.reason,
    p_request_key: exportRequest.requestKey,
    p_data_scope: exportRequest.dataScope,
  });
  if (result?.tooMany) {
    throw new ExaminerError(
      'ADMIN_EXPORT_TOO_LARGE',
      'This user has more than 2,000 responses in the selected period. Choose a shorter date range.',
      422,
    );
  }

  const items = await enrichAdminAnswerHistory(result?.items, env);
  const filename = `due-diligence-user-${exportRequest.targetUserId}-${exportRequest.dataScope === 'internal_test' ? 'internal-testing' : 'regular-users'}-questions-answers.csv`;
  return new Response(withUtf8Bom(answerHistoryCsv(items)), {
    status: 200,
    headers: {
      ...corsHeaders(origin, allowedOrigin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Admin-Data-Scope': exportRequest.dataScope,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handlePlans(request, env, origin, allowedOrigin) {
  const result = await phase4Rpc(env, 'phase4_pricing_snapshot', {});
  const pricing = sanitizePublicPricingSnapshot(result);
  return jsonResponse({
    ok: true,
    pricing,
    plans: pricing.plans,
    serverNow: pricing.serverNow,
    revisionId: pricing.revisionId,
  }, 200, origin, allowedOrigin);
}

async function handlePublicPricingAsset(
  request,
  env,
  assetId,
  origin,
  allowedOrigin,
) {
  const normalizedAssetId = pricingUuid(assetId, 'pricing asset');
  const result = await phase4Rpc(env, 'phase4_pricing_public_asset', {
    p_asset_id: normalizedAssetId,
  });
  if (!result) {
    throw new PricingValidationError(
      'PRICING_ASSET_NOT_FOUND',
      'The QR image is not available.',
      404,
    );
  }
  const metadata = normalizePricingAssetMetadata(result);
  return streamPrivatePricingAsset(
    request,
    env,
    metadata,
    origin,
    allowedOrigin,
    { publicAsset: true },
  );
}

let legacyPricingQrModulePromise = null;
const defaultLegacyPricingQrLoader = () => import('../assets/payments/bpi-instapay-149.png');
let legacyPricingQrLoader = defaultLegacyPricingQrLoader;

export function setLegacyPricingQrLoaderForTest(loader = null) {
  legacyPricingQrLoader = typeof loader === 'function' ? loader : defaultLegacyPricingQrLoader;
  legacyPricingQrModulePromise = null;
}

async function handleLegacyPricingQr() {
  if (!legacyPricingQrAvailableAt(Date.now())) {
    return new Response('The requested image is no longer available.', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }
  legacyPricingQrModulePromise ||= Promise.resolve().then(() => legacyPricingQrLoader());
  const module = await legacyPricingQrModulePromise;
  const body = module?.default ?? module;
  if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    throw new PricingValidationError(
      'PRICING_ASSET_NOT_FOUND',
      'The QR image is not available.',
      404,
    );
  }
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

async function handleAdminPricingQuery(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { user } = await requirePricingAdministrator(request, env);
  normalizePricingAdminQuery(await parseBoundedJson(request, 8_000));
  const snapshot = await protectedSupabaseRpc(env, 'phase4_admin_pricing_snapshot', {
    p_actor_user_id: user.id,
  });
  return jsonResponse({ ok: true, pricing: snapshot, snapshot, data: snapshot }, 200, origin, allowedOrigin);
}

async function handleAdminPricingAction(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { user } = await requirePricingAdministrator(request, env);
  const action = normalizePricingAdminAction(await parseBoundedJson(request, 300_000));
  const result = await protectedSupabaseRpc(env, 'phase4_admin_pricing_action', {
    p_actor_user_id: user.id,
    p_operation: action.operation,
    p_request_key: action.requestKey,
    p_expected_lock_version: action.expectedLockVersion,
    p_draft_revision_id: action.draftRevisionId,
    p_source_revision_id: action.sourceRevisionId,
    p_publish_at: action.publishAt,
    p_config: action.config,
    p_reason: action.reason,
    p_confirmed: action.confirmed,
  });
  return jsonResponse({ ok: true, action: result, data: result }, 200, origin, allowedOrigin);
}

async function handleAdminPricingAssetUpload(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { user } = await requirePricingAdministrator(request, env);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > PRICING_ASSET_LIMITS.maxBytes + 120_000) {
    throw new PricingValidationError(
      'PRICING_ASSET_TOO_LARGE',
      'The QR image exceeds the 5 MiB limit.',
      413,
    );
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new PricingValidationError(
      'INVALID_PRICING_ASSET',
      'Choose one PNG or JPEG QR image to upload.',
    );
  }
  const file = form.get('file') || form.get('asset') || form.get('image') || form.get('qr');
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new PricingValidationError(
      'INVALID_PRICING_ASSET',
      'Choose one PNG or JPEG QR image to upload.',
    );
  }
  const requestKey = normalizePricingRequestKey(
    form.get('requestKey') || request.headers.get('X-Request-ID'),
  );
  const image = validatePricingAsset(
    new Uint8Array(await file.arrayBuffer()),
    file.type,
    file.name,
  );
  const sha256 = await sha256Hex(image.bytes);
  const requestFingerprint = await sha256Hex(new TextEncoder().encode(requestKey));
  // A deterministic immutable path makes a lost-response retry safe. Storage
  // may report 409 on the retry; the Founder-only registration RPC then
  // verifies that the request key, path, hash, dimensions, and MIME all match.
  const objectPath = [
    'assets',
    user.id,
    `${requestFingerprint}-${sha256}.${image.extension}`,
  ].join('/');
  const upload = await uploadPrivatePricingAsset(
    env,
    objectPath,
    image.bytes,
    image.mimeType,
    { allowExisting: true },
  );

  let registered;
  try {
    registered = await protectedSupabaseRpc(env, 'phase4_admin_register_pricing_asset', {
      p_actor_user_id: user.id,
      p_request_key: requestKey,
      p_bucket_id: PRICING_ASSET_BUCKET,
      p_object_path: objectPath,
      p_mime_type: image.mimeType,
      p_size_bytes: image.bytes.byteLength,
      p_width: image.width,
      p_height: image.height,
      p_sha256: sha256,
    });
  } catch (error) {
    // A network/timeout/5xx can arrive after Postgres committed the asset row.
    // Preserve the deterministic private object so a retry can reconcile it;
    // delete only when the RPC authoritatively rejected the registration.
    if (upload.created && isAuthoritativeRpcRejection(error)) {
      await deletePrivatePricingAsset(env, objectPath);
    }
    throw error;
  }

  const asset = normalizePricingAssetMetadata(registered);
  if (asset.objectPath !== objectPath && upload.created) {
    await deletePrivatePricingAsset(env, objectPath);
  }
  return jsonResponse({
    ok: true,
    asset,
    data: asset,
    previewEndpoint: '/admin/pricing/asset',
  }, 201, origin, allowedOrigin);
}

async function handleAdminPricingAsset(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const { user } = await requirePricingAdministrator(request, env);
  const payload = await parseBoundedJson(request, 4_000);
  const assetId = pricingUuid(payload?.assetId, 'pricing asset');
  const result = await protectedSupabaseRpc(env, 'phase4_admin_pricing_asset', {
    p_actor_user_id: user.id,
    p_asset_id: assetId,
  });
  const metadata = normalizePricingAssetMetadata(result);
  return streamPrivatePricingAsset(
    request,
    env,
    metadata,
    origin,
    allowedOrigin,
    { publicAsset: false },
  );
}

async function reserveCommercialSubmission(
  request,
  env,
  user,
  track,
  resourceId,
  suppliedRequestKey = null,
) {
  const requestId = normalizeRequestKey(
    suppliedRequestKey || request.headers.get('X-Request-ID'),
  );
  const reservation = await phase4Rpc(env, 'phase4_reserve_grade_v2', {
    p_user_id: user.id,
    p_request_key: requestId,
    p_question_bank_id: String(resourceId || '').slice(0, 100),
    p_examination_track: track,
  });
  if (['duplicate_active', 'duplicate_completed', 'duplicate_closed'].includes(reservation?.reason)) {
    throw new AccessValidationError(
      'DUPLICATE_SUBMISSION',
      reservation.reason === 'duplicate_completed'
        ? 'This submission has already been completed.'
        : 'This submission is already being processed. Please wait for the result.',
      409,
    );
  }
  const access = normalizeAccessSnapshot(reservation);
  if (!access.allowed) throw accessDeniedError(access);
  if (!reservation?.reservationId) {
    throw new AccessValidationError(
      'ACCESS_UNAVAILABLE',
      'Your submission could not be reserved. Please try again.',
      503,
    );
  }
  return {
    userId: user.id,
    requestId,
    reservationId: String(reservation.reservationId),
    access,
  };
}

async function releaseCommercialSubmission(env, reservation, reason = 'grading_failed') {
  if (!reservation?.reservationId) return;
  try {
    await phase4Rpc(env, 'phase4_release_grade', {
      p_user_id: reservation.userId,
      p_reservation_id: reservation.reservationId,
      p_reason: reason,
    });
  } catch (error) {
    console.error('Commercial submission reservation release failed', {
      code: error?.code || 'UNKNOWN',
    });
  }
}

async function handlePaymentSubmit(request, env, origin, allowedOrigin) {
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
  const hasVersionedSelection = Boolean(
    form.get('planVersionId') || form.get('paymentChannelVersionId'),
  );
  const fields = hasVersionedSelection
    ? normalizePaymentFields({
      planVersionId: form.get('planVersionId'),
      paymentChannelVersionId: form.get('paymentChannelVersionId'),
    })
    : normalizeLegacyPaymentFields({
      planCode: form.get('planCode'),
      amountPhp: form.get('amountPhp'),
      paymentMethod: form.get('paymentMethod'),
      paymentDate: form.get('paymentDate'),
      transactionReference: form.get('transactionReference') ?? form.get('paymentReference'),
      note: form.get('note'),
    });
  const legacyRequestKey = hasVersionedSelection
    ? null
    : normalizeRequestKey(request.headers.get('X-Request-ID'));
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
  const proofStorageKey = hasVersionedSelection
    ? [
      'pricing-v3', user.id, fields.planVersionId, fields.paymentChannelVersionId,
      proofSha256,
    ].join('|')
    : [
      'pricing-legacy', user.id, legacyRequestKey,
      fields.transactionReference.toLowerCase(), proofSha256,
    ].join('|');
  const objectHash = await sha256Hex(new TextEncoder().encode(proofStorageKey));
  const objectId = [
    objectHash.slice(0, 8),
    objectHash.slice(8, 12),
    objectHash.slice(12, 16),
    objectHash.slice(16, 20),
    objectHash.slice(20, 32),
  ].join('-');
  const objectPath = `${user.id}/${objectId}.${extension}`;
  const proofUpload = await uploadPrivateProof(
    env,
    objectPath,
    bytes,
    mimeType,
    { allowExisting: true },
  );
  let result;
  try {
    result = hasVersionedSelection
      ? await commerceRpc(env, 'phase4_create_payment_request_v3', {
        p_user_id: user.id,
        p_plan_version_id: fields.planVersionId,
        p_payment_channel_version_id: fields.paymentChannelVersionId,
        p_proof_bucket: 'payment-proofs',
        p_proof_path: objectPath,
        p_proof_mime_type: mimeType,
        p_proof_size_bytes: bytes.byteLength,
        p_proof_sha256: proofSha256,
      })
      : await commerceRpc(env, 'phase4_create_payment_request', {
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
        p_request_key: legacyRequestKey,
      });
  } catch (error) {
    // A lost RPC response can hide an already committed payment. Preserve the
    // deterministic proof on ambiguous failures and reconcile it on retry.
    if (proofUpload.created && isAuthoritativeRpcRejection(error)) {
      await deletePrivateProof(env, objectPath);
    }
    throw error;
  }
  if (
    result?.replayed
    && proofUpload.created
    && String(result?.proofObjectPath || '') !== objectPath
  ) {
    await deletePrivateProof(env, objectPath);
  }
  const payment = sanitizeTrustedPayment(result);
  return jsonResponse({
    ok: true,
    payment,
    message: 'Payment proof submitted for secure verification under the published plan.',
  }, 201, origin, allowedOrigin);
}

async function handleBillingStatus(request, env, origin, allowedOrigin) {
  const user = await requireAuthenticatedUser(request, env);
  const result = await commerceRpc(env, 'phase4_student_billing_snapshot', {
    p_user_id: user.id,
  });
  return jsonResponse({ ok: true, billing: result }, 200, origin, allowedOrigin);
}

async function handleRefundSubmit(request, env, origin, allowedOrigin) {
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
    mailbox: 'premium@duediligence.ph',
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
    message: 'Your inquiry has been saved securely for Due Diligence founder review.',
  }, 201, origin, allowedOrigin);
}

async function handlePhase4AdminData(request, env, origin, allowedOrigin) {
  await enforceAdminRateLimit(request, env);
  const user = await requireAdministrator(request, env);
  const query = normalizePhase4AdminRequest(await parseBoundedJson(request, 8_000));
  const result = await protectedSupabaseRpc(env, 'phase4_admin_operational_data_scoped_v2', {
      p_actor_user_id: user.id,
      p_section: query.section === 'introductory_access' ? 'access' : query.section,
      p_search: query.search,
      p_limit: query.limit,
      p_offset: query.offset,
      p_data_scope: query.dataScope,
    });
  return jsonResponse({
    ok: true,
    data: result,
    dataScope: query.dataScope,
  }, 200, origin, allowedOrigin);
}

async function handlePhase4AdminAction(request, env, origin, allowedOrigin, executionContext) {
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
  if (action.action === 'payment_review'
      && result?.payment?.status === 'approved'
      && result?.replayed !== true) {
    scheduleAdminPulse(env, executionContext);
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
    audit: {
      action: 'proof_viewed',
      reason,
      recordedAt: new Date().toISOString(),
    },
  }, 200, origin, allowedOrigin);
}

async function resolveVerdictQuestion(questionId, env) {
  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || null);
  return questionFromBankRow(records.get(String(questionId || '')));
}

async function enforceStudyRoomRateLimit(request, env, scope) {
  const policies = {
    access: [studyRoomAccessRateWindows, 60],
    rooms: [studyRoomRoomsRateWindows, 30],
    join: [studyRoomJoinRateWindows, 20],
    moderate: [studyRoomModerationRateWindows, 60],
  };
  const policy = policies[scope];
  if (!policy) {
    throw new StudyRoomError(
      'STUDY_ROOM_OPERATION_UNSUPPORTED',
      'That Study Room operation is not available.',
      400,
    );
  }
  enforceWindow(
    policy[0],
    await transientRateKey(request, env, `study-room-${scope}`),
    policy[1],
    'Too many Study Room requests. Please wait and try again.',
  );
}

const studyRoomHandlers = createStudyRoomHandlers({
  authenticate: verifiedAuthenticatedUser,
  authorizeAdmin: studyRoomAdministratorAccess,
  authorizeMember: async (env, user) => studyRoomMemberAccess(
    await phase4AccessForUser(env, user.id),
  ),
  parseJson: parseBoundedJson,
  rateLimit: enforceStudyRoomRateLimit,
  respond: jsonResponse,
});

const dd2026Handlers = createDD2026Handlers({
  corsHeaders,
  dd2026Rpc,
  enforceAdminRateLimit,
  enforceDD2026RateLimit,
  jsonResponse,
  parseBoundedJson,
  requireAdministrator,
  requireAuthenticatedUser,
  requireCommercialAccess: async (_request, env, user) => {
    const access = await phase4AccessForUser(env, user.id);
    if (!access.allowed) throw accessDeniedError(access);
    return access;
  },
  reserveCommercialSubmission,
  releaseCommercialSubmission,
  resolveVerdictQuestion,
  structuredGemini: callGeminiStructured,
});

const barForecastHandlers = createBarForecastHandlers({
  authorizeAdministrator: (env, user) => protectedSupabaseRpc(
    env,
    'admin_authorization_context',
    { p_actor_user_id: user.id },
    { returnNullOnAuthorizationDenial: true },
  ),
  barForecastRpc,
  enforceBarForecastAdminRateLimit,
  jsonResponse,
  parseBoundedJson,
  requireAdministrator,
  structuredGemini: callGeminiStructured,
});

const auxiliaryWritingDiagnosticsHandlers = createAuxiliaryWritingDiagnosticsHandlers({
  dd2026Rpc,
  enforceDD2026RateLimit,
  jsonResponse,
  parseBoundedJson,
  requireAuthenticatedUser,
  resolveVerdictQuestion,
  structuredGemini: callGeminiStructured,
});

const pedroHandlers = createPedroHandlers({
  requireAuthenticatedUser,
  parseBoundedJson,
  jsonResponse,
  pedroRpc,
  enforcePedroRateLimit,
  searchMockBar: searchPedroMockBar,
  structuredClassifier: async (env, prompt, responseSchema, validateResult) => {
    const generated = await callGeminiStructured(
      env,
      prompt,
      responseSchema,
      validateResult,
      { quiet: true },
    );
    return { result: generated.result };
  },
});

const examinationRoomAssistant = createExaminationRoomAssistant({
  structuredCompletion: async (env, prompt, responseSchema, validateResult) => {
    const generated = await callGeminiStructured(
      env,
      prompt,
      responseSchema,
      validateResult,
      { quiet: true },
    );
    return { result: generated.result };
  },
});

const examinationRoomMedia = createExaminationRoomMediaControl({
  fetch: (...args) => fetch(...args),
  mediaRpc: async (env, { operation, payload }) => examinationRoomV1Result(
    await examinationRoomV1ServiceRpc(env, 'examination_room_v1_media', {
      p_operation: operation,
      p_payload: payload,
    }),
  ),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  now: () => new Date().toISOString(),
});

const examinationRoomV1Handlers = createExaminationRoomV1Handlers({
  parseJson: parseBoundedJson,
  respond: jsonResponse,
  authenticate: verifiedAuthenticatedUser,
  authorizeProfessor: async (env, user) => {
    const staff = await examinationRoomV1StaffContext(env, user);
    const professorRoleSelected = staff?.professorRoleSelected === true;
    const creatorWorkspaces = (Array.isArray(staff?.creatorWorkspaces)
      ? staff.creatorWorkspaces
      : [])
      .filter((workspace) => workspace?.active === true && workspace?.institutionId);
    const memberships = (Array.isArray(staff?.memberships) ? staff.memberships : [])
      .filter((membership) => membership?.active === true && membership?.institutionId);
    const institutionIds = [...new Set([
      ...creatorWorkspaces.map((workspace) => workspace.institutionId),
      ...memberships.map((membership) => membership.institutionId),
    ].filter(Boolean))];
    return {
      ...staff,
      professorRoleSelected,
      creatorAuthorized: institutionIds.length > 0,
      authorized: institutionIds.length > 0,
      institutionId: staff?.institutionId || (institutionIds.length === 1 ? institutionIds[0] : null),
      creatorWorkspaces,
      memberships,
    };
  },
  authorizeAdmin: async (env, user) => {
    const [staff, admin] = await Promise.all([
      examinationRoomV1StaffContext(env, user),
      protectedSupabaseRpc(env, 'admin_authorization_context', {
        p_actor_user_id: user.id,
      }),
    ]);
    const platformOwner = admin?.authorized === true
      && EXAMINATION_ROOM_OWNER_ROLES.has(String(admin?.role || ''));
    const memberships = (Array.isArray(staff?.memberships) ? staff.memberships : [])
      .filter((membership) => membership?.active === true && membership?.staffRole === 'admin');
    const institutionIds = [...new Set(memberships.map((membership) => membership.institutionId).filter(Boolean))];
    return {
      ...staff,
      ...admin,
      capabilities: platformOwner ? admin.capabilities : [],
      memberships,
      institutionId: institutionIds.length === 1 ? institutionIds[0] : null,
      globalAuthorized: platformOwner,
      canBootstrap: platformOwner,
      authorized: platformOwner && memberships.length > 0,
    };
  },
  rateLimit: enforceExaminationRoomV1RateLimit,
  examinationRoomAssistant,
  examinationRoomMedia,
  examLifecycleQuery: examinationRoomV1LifecycleQueryRpc,
  examLifecycleCommand: examinationRoomV1LifecycleCommandRpc,
  examLifecycleGuard: examinationRoomV1LifecycleGuardRpc,
  rpc: examinationRoomV1Rpc,
  manageStaff: examinationRoomV1ManageStaff,
  professorAccess: examinationRoomV1ProfessorAccess,
  importGrades: ({
    request, env, origin, allowedOrigin, body, authenticatedUser,
  }) => handleExaminationRoomProfessorImportGrades(
    request,
    env,
    origin,
    allowedOrigin,
    { body, authenticatedUser },
  ),
  afterProfessorCommand: async ({
    operation,
    result,
    env,
    executionContext,
    actorUserId,
    institutionId,
    requestHash,
    examId,
    resultEmailItems,
  }) => {
    if (operation === 'publish' || operation === 'release_results') {
      scheduleExaminationRoomRecoveryDrain(env, executionContext);
    }
    if (operation === 'publish') {
      scheduleExaminationRoomPublicationRequestNotification(env, result, executionContext);
    }
    if (operation === 'release_results' && Array.isArray(resultEmailItems) && resultEmailItems.length) {
      return {
        resultDelivery: await sendExaminationRoomV1ResultReleaseEmails(env, {
          actorUserId,
          institutionId,
          requestHash,
          examId,
          resultEmailItems,
        }),
      };
    }
    return null;
  },
  afterStudentCommand: ({ operation, env, executionContext }) => {
    if (operation === 'submit') {
      scheduleExaminationRoomRecoveryDrain(env, executionContext);
    }
  },
  hmacHex,
  sha256Hex: (value) => sha256Hex(new TextEncoder().encode(String(value))),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  sendRoomKeyEmail: sendExaminationRoomV1KeyEmail,
});

export default {
  async fetch(request, env, ctx) {
    env = normalizedRuntimeSecrets(env);
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://duediligence.ph';
    const requestOrigin = request.headers.get('Origin') || '';
    let pathname = '';
    try {
      pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      const publicPricingAssetMatch = pathname.match(
        /^\/pricing\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu,
      );
      if (request.method === 'GET' && pathname === '/pricing/legacy-149-qr.png') {
        return await handleLegacyPricingQr();
      }
      if (request.method === 'GET' && publicPricingAssetMatch) {
        const assetOrigin = requestOrigin ? assertOrigin(request, allowedOrigin) : allowedOrigin;
        return await handlePublicPricingAsset(
          request,
          env,
          publicPricingAssetMatch[1],
          assetOrigin,
          allowedOrigin,
        );
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
      if (pathname === '/beta/access/accept-terms') {
        return await handleCurrentLegalAcceptance(request, env, origin, allowedOrigin);
      }
      if (pathname === '/auth/sign-in-notification') {
        return await handleSignInNotification(request, env, origin, allowedOrigin, ctx);
      }
      if (pathname === '/auth/session-monitoring') {
        return await handleSessionMonitoring(request, env, origin, allowedOrigin, ctx);
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
      if (pathname === '/dd2026/auxiliary-diagnostics/ensure') {
        return await auxiliaryWritingDiagnosticsHandlers.ensure(
          request, env, origin, allowedOrigin, ctx,
        );
      }
      if (pathname === '/dd2026/auxiliary-diagnostics/records') {
        return await auxiliaryWritingDiagnosticsHandlers.records(request, env, origin, allowedOrigin);
      }
      if (pathname === '/dd2026/editorial') {
        return await dd2026Handlers.editorial(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/dd2026/import') {
        return await dd2026Handlers.importContent(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/dd2026/bar-forecast') {
        if (request.method !== 'POST') {
          throw new BarForecastError(
            'BAR_FORECAST_METHOD_NOT_ALLOWED',
            'Use POST for the Bar Forecast administrator endpoint.',
            405,
          );
        }
        return await barForecastHandlers.handle(request, env, origin, allowedOrigin);
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
        return await handleSupport(request, env, origin, allowedOrigin, ctx);
      }
      if (pathname === '/analytics/events') {
        return await handleAnalytics(request, env, origin, allowedOrigin, ctx);
      }
      if (pathname === '/study/annotations/query') {
        return await handleStudyAnnotationQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/study/annotations/command') {
        return await handleStudyAnnotationCommand(request, env, origin, allowedOrigin);
      }
      const examinationRoomV1HandlerName = EXAMINATION_ROOM_V1_PATHS[pathname];
      if (examinationRoomV1HandlerName) {
        if (String(env.EXAMINATION_ROOM_ENABLED || '').trim().toLowerCase() !== 'true') {
          return jsonResponse({
            ok: false,
            error: {
              code: 'EXAM_ROOM_V1_DISABLED',
              message: 'Examination Room is temporarily unavailable.',
              recovery: 'No saved examination data was removed. Contact support or try again after the school reopens the service.',
            },
          }, 503, origin, allowedOrigin);
        }
        if (pathname === '/examination-room/v1/admin/query') {
          return handleExaminationRoomOwnerQuery(request, env, origin, allowedOrigin);
        }
        if (pathname === '/examination-room/v1/admin/command') {
          return handleExaminationRoomOwnerCommand(
            request,
            env,
            origin,
            allowedOrigin,
            ctx,
          );
        }
        return await examinationRoomV1Handlers[examinationRoomV1HandlerName](
          request,
          env,
          origin,
          allowedOrigin,
          ctx,
        );
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
      if (pathname === '/pedro/message') {
        return await pedroHandlers.message(request, env, origin, allowedOrigin);
      }
      if (pathname === '/pedro/query') {
        return await pedroHandlers.query(request, env, origin, allowedOrigin);
      }
      if (pathname === '/quorum/query') {
        return await handleQuorumQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/quorum/command') {
        return await handleQuorumCommand(request, env, origin, allowedOrigin, ctx);
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
        return retiredForumWriteResponse(origin, allowedOrigin);
      }
      if (pathname === '/forum/posts/update') {
        return retiredForumWriteResponse(origin, allowedOrigin);
      }
      if (pathname === '/forum/posts/delete') {
        return await handleForumPostDelete(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/reactions') {
        return await handleForumReaction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/forum/comments/create') {
        return retiredForumWriteResponse(origin, allowedOrigin);
      }
      if (pathname === '/forum/comments/update') {
        return retiredForumWriteResponse(origin, allowedOrigin);
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
      if (pathname === '/admin/pulse/snapshot') {
        return await handleAdminPulseSnapshot(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/pulse/push-subscription') {
        return await handleAdminPulsePushSubscription(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/study-room/access') {
        return await studyRoomHandlers.access(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/study-room/rooms') {
        return await studyRoomHandlers.rooms(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/study-room/join') {
        return await studyRoomHandlers.join(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/study-room/moderate') {
        return await studyRoomHandlers.moderate(request, env, origin, allowedOrigin);
      }
      if (pathname === '/study-room/access') {
        return await studyRoomHandlers.access(request, env, origin, allowedOrigin);
      }
      if (pathname === '/study-room/rooms') {
        return await studyRoomHandlers.rooms(request, env, origin, allowedOrigin);
      }
      if (pathname === '/study-room/join') {
        return await studyRoomHandlers.join(request, env, origin, allowedOrigin);
      }
      if (pathname === '/study-room/moderate') {
        return await studyRoomHandlers.moderate(request, env, origin, allowedOrigin);
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
      if (pathname === '/admin/pricing/query') {
        return await handleAdminPricingQuery(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/pricing/action') {
        return await handleAdminPricingAction(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/pricing/assets/upload') {
        return await handleAdminPricingAssetUpload(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/pricing/asset') {
        return await handleAdminPricingAsset(request, env, origin, allowedOrigin);
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
      if (pathname === '/admin/recent-sign-ins') {
        return await handleAdminRecentSignIns(request, env, origin, allowedOrigin);
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
      if (pathname === '/admin/recent-user-activity') {
        return await handleAdminRecentUserActivity(request, env, origin, allowedOrigin);
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
        return await handlePhase4AdminAction(request, env, origin, allowedOrigin, ctx);
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
        || error instanceof AdminPulseError
        || error instanceof GuestAccessError
        || error instanceof AccessValidationError
        || error instanceof PrivateBetaError
        || error instanceof PaymentValidationError
        || error instanceof PricingValidationError
        || error instanceof ForumValidationError
        || error instanceof ExaminationValidationError
        || error instanceof ReleaseContentError
        || error instanceof DD2026ValidationError
        || error instanceof BarForecastError
        || error instanceof StudyRoomError;
      const errorResponse = jsonResponse({
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
          ...(known && error.retryable === true ? { retryable: true } : {}),
          ...(known && Number.isSafeInteger(error.retryAfterSeconds)
            ? { retryAfterSeconds: Number(error.retryAfterSeconds) }
            : {}),
          ...(error instanceof StudyRoomError && error.recovery
            ? { recovery: String(error.recovery) }
            : {}),
        },
      }, known ? error.status : 500, requestOrigin, allowedOrigin);
      if (known && Number.isSafeInteger(error.retryAfterSeconds)) {
        errorResponse.headers.set('Retry-After', String(error.retryAfterSeconds));
      }
      if (pathname === '/admin/dd2026/bar-forecast') {
        errorResponse.headers.set('Cache-Control', 'private, no-store, max-age=0');
        errorResponse.headers.set('Pragma', 'no-cache');
      }
      return errorResponse;
    }
  },
  scheduled(_controller, env, ctx) {
    const runtimeEnv = normalizedRuntimeSecrets(env);
    const recovery = drainExaminationRoomRecovery(runtimeEnv).catch((error) => {
      console.error('Scheduled Examination Room recovery drain failed', {
        code: String(error?.code || 'EXAM_ROOM_V1_RECOVERY_DRAIN_FAILED').slice(0, 80),
      });
      throw error;
    });
    const avatarCleanup = reconcileQuorumAvatarCleanupJobs(runtimeEnv).catch((error) => {
      console.error('Scheduled Quorum profile photo cleanup failed', {
        code: error?.code || 'UNKNOWN',
      });
      return 0;
    });
    const adminPulse = drainAdminPulseDeliveries(runtimeEnv, {
      rpc: protectedSupabaseRpc,
    }).catch((error) => {
      console.error('Scheduled Admin Pulse Web Push drain failed', {
        code: String(error?.code || error?.name || 'ADMIN_PULSE_DRAIN_FAILED').slice(0, 80),
      });
      return { status: 'failed' };
    });
    const maintenance = Promise.all([recovery, avatarCleanup, adminPulse])
      .then(([recoveryResult]) => recoveryResult);
    if (typeof ctx?.waitUntil === 'function') {
      ctx.waitUntil(maintenance);
      return undefined;
    }
    return maintenance;
  },
};
