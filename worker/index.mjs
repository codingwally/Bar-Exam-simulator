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

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const DUPLICATE_TTL_MS = 20 * 1000;
const GEMINI_TIMEOUT_MS = 45 * 1000;
const rateWindows = new Map();
const recentSubmissions = new Map();
let laborBankCache = null;

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

async function submissionFingerprint(requestData, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const encoded = new TextEncoder().encode(`${ip}\n${requestData.questionId}\n${requestData.studentAnswer}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rejectRecentDuplicate(requestData, request) {
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
  for (const model of orderedModels(env.GEMINI_MODEL)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const canGround = groundingEnabled && model !== 'gemini-1.5-flash';
      const groundingAttempts = canGround ? [true, false] : [false];
      for (const useGrounding of groundingAttempts) {
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        };
        if (useGrounding) body.tools = [{ google_search: {} }];

        const response = await fetch(
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
        const responseText = await response.text();
        if (!response.ok) {
          console.warn('Gemini request rejected', {
            model,
            status: response.status,
            grounding: useGrounding,
            provider: safeProviderErrorSummary(responseText, env.GEMINI_API_KEY),
          });
          if (useGrounding && response.status === 400 && /ground|google_search|tool|not supported/i.test(responseText)) {
            continue;
          }
          if (isUnsupportedModel(response.status, responseText)) {
            lastUnsupported = model;
            break;
          }
          if (response.status === 429) {
            quotaSeen = true;
            break;
          }
          throw new ExaminerError('EXAMINER_UNAVAILABLE', 'The examiner could not complete this assessment.', 502);
        }

        let payload;
        try {
          payload = JSON.parse(responseText);
        } catch {
          throw new ExaminerError('MALFORMED_MODEL_RESPONSE', 'The examiner returned an unreadable assessment.', 502);
        }
        const answerText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
        if (!answerText) throw new ExaminerError('MALFORMED_MODEL_RESPONSE', 'The examiner returned an empty assessment.', 502);
        let result;
        try {
          result = JSON.parse(answerText);
        } catch {
          throw new ExaminerError('MALFORMED_MODEL_RESPONSE', 'The examiner returned invalid structured data.', 502);
        }
        return { model, result, groundedSources: groundedSources(payload), groundingUsed: useGrounding };
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new ExaminerError('EXAMINER_TIMEOUT', 'The assessment timed out. Please try again.', 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (quotaSeen) {
    throw new ExaminerError('EXAMINER_QUOTA_EXCEEDED', 'The examiner is temporarily busy. Please try again later.', 503);
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
  await rejectRecentDuplicate(gradingRequest, request);

  let bankContext = null;
  if (/^LAB-\d{3}$/i.test(gradingRequest.questionId)) {
    try {
      const records = await loadLaborBank(env.LABOR_CSV_URL || LABOR_CSV_URL);
      bankContext = questionFromBankRow(records.get(gradingRequest.questionId));
    } catch (error) {
      if (!(error instanceof ExaminerError)) throw error;
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
  const gemini = await callGemini(env, prompt, groundingEnabled);
  const storedSources = sanitizeSources(context.sourceUrl ? [{
    title: context.sourceTitle || context.caseName || 'Stored question-bank source',
    url: context.sourceUrl,
    type: 'stored',
  }] : []);
  const validatedAssessment = validateExaminerResult(
    gemini.result,
    policy,
    [...storedSources, ...gemini.groundedSources],
  );
  const assessment = applyDeterministicScoreCap(
    validatedAssessment,
    gradingRequest.studentAnswer,
    context,
  );

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
        throw new ExaminerError('METHOD_NOT_ALLOWED', 'Only POST grading requests are accepted.', 405);
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
