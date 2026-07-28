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
  return { id: String(user.id) };
}

function phase4AccessEnforced(env) {
  return String(env.PHASE4_ACCESS_ENFORCEMENT).toLowerCase() === 'true';
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

async function phase4AccessForUser(env, userId, options = {}) {
  const result = await phase4Rpc(env, 'phase4_access_snapshot', {
    p_user_id: userId,
    p_activate_trial: options.activateTrial === true,
    p_request_key: options.requestKey || null,
  });
  return normalizeAccessSnapshot(result);
}

async function reserveGradeAccess(request, env, gradingRequest) {
  if (phase4AccessEnforced(env)) {
    const authenticatedUser = await requireAuthenticatedUser(request, env);
    const requestId = normalizeRequestKey(request.headers.get('X-Request-ID'));
    const reservation = await phase4Rpc(env, 'phase4_reserve_grade', {
      p_user_id: authenticatedUser.id,
      p_request_key: requestId,
      p_question_bank_id: gradingRequest.questionId,
    });
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

async function finalizeGradeAccess(access, env) {
  if (access?.phase4) {
    const result = await phase4Rpc(env, 'phase4_finalize_grade', {
      p_user_id: access.userId,
      p_reservation_id: access.reservationId,
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

async function releaseGradeAccess(access, env) {
  if (!access || !access.reservationId) return;
  if (access.phase4) {
    try {
      await phase4Rpc(env, 'phase4_release_grade', {
        p_user_id: access.userId,
        p_reservation_id: access.reservationId,
        p_reason: 'grading_failed',
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

async function callGemini(env, prompt, groundingEnabled) {
  if (!env.GEMINI_API_KEY) {
    throw new ExaminerError('EXAMINER_NOT_CONFIGURED', 'The AI examiner is not configured. Please contact the administrator.', 503);
  }

  let lastUnsupported = '';
  let quotaSeen = false;
  let providerFailureSeen = false;
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
    throw new ExaminerError('EXAMINER_QUOTA_EXCEEDED', 'The examiner is temporarily busy. Please try again later.', 503);
  }
  if (providerFailureSeen) {
    throw new ExaminerError('EXAMINER_UNAVAILABLE', 'The examiner could not complete this assessment.', 502);
  }
  throw new ExaminerError(
    'UNSUPPORTED_MODEL',
    `No supported Gemini examiner model is currently available${lastUnsupported ? '.' : '.'}`,
    503,
  );
}

async function handleGrade(request, env, origin, allowedOrigin) {
  await enforceRateLimit(request, env);
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The grading request contains invalid JSON.');
  }
  const gradingRequest = normalizeRequest(payload);
  const submissionId = await registerSubmission(gradingRequest, request);
  let gradeAccess = null;

  try {
    gradeAccess = await reserveGradeAccess(request, env, gradingRequest);
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
    const policy = assessmentPolicy(context);
    const prompt = buildExaminerPrompt({
      questionId: gradingRequest.questionId,
      studentAnswer: gradingRequest.studentAnswer,
      context,
      policy,
    });
    const groundingEnabled = String(env.GEMINI_GROUNDING_ENABLED).toLowerCase() === 'true';
    const storedSources = sanitizeSources(context.sourceUrl ? [{
      title: context.sourceTitle || context.caseName || 'Stored question-bank source',
      url: context.sourceUrl,
      type: 'stored',
    }] : []);
    let gemini;
    let assessment;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptPrompt = attempt === 0
        ? prompt
        : `${prompt}\n\nRETRY: The previous response failed validation. Return complete schema-valid JSON, and start the conclusion with "Therefore,".`;
      gemini = await callGemini(env, attemptPrompt, groundingEnabled);
      try {
        const validatedAssessment = validateExaminerResult(
          gemini.result,
          policy,
          [...storedSources, ...gemini.groundedSources],
        );
        assessment = applyDeterministicScoreCap(
          validatedAssessment,
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

    const finalizedUsage = await finalizeGradeAccess(gradeAccess, env);
    return jsonResponse({
      ok: true,
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
    await releaseGradeAccess(gradeAccess, env);
    recentSubmissions.delete(submissionId);
    throw error;
  }
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

  const correctionUser = phase4AccessEnforced(env)
    ? await requireAuthenticatedUser(request, env)
    : await verifiedAuthenticatedUser(request, env);
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

  const supportUser = await verifiedAuthenticatedUser(request, env);
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

export default {
  async fetch(request, env) {
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
      if (pathname === '/support') {
        return await handleSupport(request, env, origin, allowedOrigin);
      }
      if (pathname === '/analytics/events') {
        return await handleAnalytics(request, env, origin, allowedOrigin);
      }
      if (pathname === '/admin/session') {
        return await handleAdminSession(request, env, origin, allowedOrigin);
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
      if (pathname !== '/') {
        throw new ExaminerError('NOT_FOUND', 'This endpoint does not exist.', 404);
      }
      return await handleGrade(request, env, origin, allowedOrigin);
    } catch (error) {
      const known = error instanceof ExaminerError
        || error instanceof GuestAccessError
        || error instanceof AccessValidationError;
      return jsonResponse({
        ok: false,
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'The examiner encountered an unexpected error.',
        },
      }, known ? error.status : 500, requestOrigin, allowedOrigin);
    }
  },
};
