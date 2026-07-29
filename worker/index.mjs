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
  AdminValidationError,
  aggregateCsv,
  normalizeAdminAction,
  normalizeDashboardRequest,
  normalizeOperationalRequest,
} from './admin-core.mjs';
import {
  AccessValidationError,
  accessDeniedError,
  normalizeAccessSnapshot,
  normalizeRequestKey,
  normalizeSubject,
  selectProtectedQuestion,
} from './access-core.mjs';
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
  normalizeQuorumImage,
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
} from './examinations-core.mjs';
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
const recentSubmissions = new Map();
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
  Object.values(value).forEach((item) => collectQuorumImagePaths(item, paths));
  return paths;
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
        /^https?:\/\//i.test(signedPath)
          ? signedPath
          : new URL(signedPath, baseUrl).href,
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
        /^https?:\/\//i.test(signedPath)
          ? signedPath
          : new URL(signedPath, baseUrl).href,
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
    if (key === 'imagePath') {
      result.imageUrl = item ? signedUrls.get(item) || null : null;
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

function examinationEmailMode(env) {
  const mode = String(env.EXAMINATION_EMAIL_MODE || '').trim().toLowerCase();
  return ['suppressed', 'enabled'].includes(mode) ? mode : 'not_configured';
}

async function sendExaminationEmail(env, { recipient, subject, text }) {
  const mode = examinationEmailMode(env);
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
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
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
  return {
    id: String(user.id),
    email: String(user.email || '').trim().toLowerCase() || null,
  };
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
  let payload;
  if (url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new ExaminerError('QUESTION_BANK_UNAVAILABLE', 'The website question bank is temporarily unavailable.', 503);
    }
    try {
      payload = await response.json();
    } catch {
      throw new ExaminerError('QUESTION_BANK_INVALID', 'The website question bank returned invalid JSON.', 502);
    }
  } else {
    payload = embeddedWebsiteQuestionBank;
  }
  if (!Array.isArray(payload?.records) || payload.records.length !== 320) {
    throw new ExaminerError('QUESTION_BANK_INVALID', 'The website question bank must contain exactly 320 records.', 502);
  }
  const records = new Map();
  for (const row of payload.records) {
    const id = String(row?.['Question ID'] || '').trim();
    if (!id || records.has(id)) {
      throw new ExaminerError('QUESTION_BANK_INVALID', 'The website question bank contains an invalid or duplicate ID.', 502);
    }
    records.set(id, row);
  }
  websiteBankCache = { records, loadedAt: now };
  return records;
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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
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
        const validatedAssessment = validateExaminerResult(
          gemini.result,
          policy,
          [...storedSources, ...gemini.groundedSources],
        );
        repairIssues = phase4ModelQualityEnforced(env)
          ? modelAnswerQualityIssues(validatedAssessment, context)
          : [];
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
  const result = await forumRpc(env, 'forum_quorum_query', {
    p_user_id: user.id,
    p_operation: query.operation,
    p_payload: query.payload,
  });
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
  const image = command.operation === 'create_entry'
    ? normalizeQuorumImage(raw?.image)
    : null;
  if (raw?.image && command.operation !== 'create_entry') {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'An image can be attached only while creating an entry.',
    );
  }

  let result = await forumRpc(env, 'forum_quorum_command', {
    p_user_id: user.id,
    p_operation: command.operation,
    p_payload: command.payload,
  });

  if (command.operation === 'create_entry' && image) {
    let objectPath = null;
    try {
      objectPath = await uploadQuorumImage(env, result.entryId, image);
      await forumRpc(env, 'forum_quorum_command', {
        p_user_id: user.id,
        p_operation: 'register_attachment',
        p_payload: {
          entryId: result.entryId,
          objectPath,
          mimeType: image.mimeType,
          byteSize: image.byteSize,
        },
      });
      result = { ...result, imagePath: objectPath };
    } catch (error) {
      if (objectPath) await deleteQuorumImage(env, objectPath);
      try {
        await forumRpc(env, 'forum_quorum_command', {
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

  if (['delete_entry', 'remove_attachment'].includes(command.operation) && result?.imagePath) {
    await deleteQuorumImage(env, result.imagePath);
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
  const result = await forumRpc(env, 'forum_quorum_admin', {
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
      const validated = validateExaminerResult(
        gemini.result,
        policy,
        [...storedSources, ...gemini.groundedSources],
      );
      repairIssues = phase4ModelQualityEnforced(env)
        ? modelAnswerQualityIssues(validated, context)
        : [];
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

async function handleExaminationQuery(request, env, origin, allowedOrigin) {
  await enforceExaminationRateLimit(request, env);
  const raw = await parseBoundedJson(request, 24_000);
  const query = normalizeExaminationQuery(raw);
  const user = query.operation === 'assignment'
    ? null
    : await requireAuthenticatedUser(request, env);
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

async function handleAccess(request, env, origin, allowedOrigin) {
  await enforceGuestStatusRateLimit(request, env);
  const user = await requireAuthenticatedUser(request, env);
  const access = await phase4AccessForUser(env, user.id);
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
    'sending a Co-Counsel request',
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
  return jsonResponse({ ok: true, ...result }, 200, origin, allowedOrigin);
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
  const result = await protectedSupabaseRpc(env, 'admin_dashboard_snapshot', {
    p_actor_user_id: user.id,
    p_from: report.from,
    p_to: report.to,
    p_previous_from: report.previousFrom,
    p_previous_to: report.previousTo,
  });
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

async function handlePlans(request, env, origin, allowedOrigin) {
  const plans = await phase4Rpc(env, 'phase4_plan_catalog', {});
  return jsonResponse({ ok: true, plans: Array.isArray(plans) ? plans : [] }, 200, origin, allowedOrigin);
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
    'sending a Joint Venture inquiry',
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
  const result = await protectedSupabaseRpc(env, 'phase4_admin_operational_data', {
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
  if (action.action === 'subscription_audit_view') {
    result = await protectedSupabaseRpc(env, 'phase4_admin_subscription_audit', {
      p_actor_user_id: user.id,
      p_target_user_id: action.targetId,
      p_reason: action.reason,
      p_request_key: action.requestKey,
    });
  } else if (['subscription_change', 'free_beta_change', 'discount_assign'].includes(action.action)) {
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

export default {
  async fetch(request, env, ctx) {
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://duediligence.ph';
    const requestOrigin = request.headers.get('Origin') || '';
    try {
      const origin = assertOrigin(request, allowedOrigin);
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
      }
      if (request.method !== 'POST') {
        throw new ExaminerError('METHOD_NOT_ALLOWED', 'Only POST requests are accepted.', 405);
      }
      const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
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
      if (pathname === '/admin/data') {
        return await handleAdminData(request, env, origin, allowedOrigin);
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
        || error instanceof PaymentValidationError
        || error instanceof ForumValidationError
        || error instanceof ExaminationValidationError;
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
