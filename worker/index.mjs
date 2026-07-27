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

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_CORRECTIONS_PER_WINDOW = 5;
const DUPLICATE_TTL_MS = 20 * 1000;
const GEMINI_TIMEOUT_MS = 45 * 1000;
const GEMINI_TRANSIENT_ATTEMPTS = 2;
const GEMINI_RETRY_DELAY_MS = 750;
const WEBSITE_BANK_URL = 'https://duediligence.ph/content/question-bank/website-upload.json';
const rateWindows = new Map();
const correctionRateWindows = new Map();
const recentSubmissions = new Map();
let laborBankCache = null;
let websiteBankCache = null;

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function enforceRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const current = rateWindows.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rateWindows.set(ip, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > MAX_REQUESTS_PER_WINDOW) {
    throw new ExaminerError('RATE_LIMITED', 'Too many grading requests. Please wait a few minutes and try again.', 429);
  }
}

function enforceCorrectionRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const current = correctionRateWindows.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    correctionRateWindows.set(ip, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > MAX_CORRECTIONS_PER_WINDOW) {
    throw new ExaminerError(
      'RATE_LIMITED',
      'Too many correction submissions. Please wait a few minutes and try again.',
      429,
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
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new ExaminerError('QUESTION_BANK_UNAVAILABLE', 'The website question bank is temporarily unavailable.', 503);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ExaminerError('QUESTION_BANK_INVALID', 'The website question bank returned invalid JSON.', 502);
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
  enforceRateLimit(request);
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new ExaminerError('INVALID_JSON', 'The grading request contains invalid JSON.');
  }
  const gradingRequest = normalizeRequest(payload);
  const submissionId = await registerSubmission(gradingRequest, request);

  try {
    let bankContext = null;
    try {
      const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || WEBSITE_BANK_URL);
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

    return jsonResponse({
      ok: true,
      assessment: {
        ...assessment,
        modelUsed: gemini.model,
        gradedAt: new Date().toISOString(),
        questionAuthority: context.authority,
        groundingEnabled: gemini.groundingUsed,
      },
    }, 200, origin, allowedOrigin);
  } catch (error) {
    recentSubmissions.delete(submissionId);
    throw error;
  }
}

async function handleCorrection(request, env, origin, allowedOrigin) {
  enforceCorrectionRateLimit(request);
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

  const records = await loadWebsiteBank(env.WEBSITE_BANK_URL || WEBSITE_BANK_URL);
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
      body: JSON.stringify(correctionInsertRecord(correction)),
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
      if (pathname !== '/') {
        throw new ExaminerError('NOT_FOUND', 'This endpoint does not exist.', 404);
      }
      return await handleGrade(request, env, origin, allowedOrigin);
    } catch (error) {
      const known = error instanceof ExaminerError;
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
