const CANONICAL_ORIGIN = 'https://duediligence.ph';
const ANSWER_RECOVERY_URL = 'https://hbllomlijfznnuudpdvr.supabase.co/functions/v1/examination-room-answer-recovery';
const ANSWER_RECOVERY_TIMEOUT_MS = 3_500;
const APPROVED_BROWSER_ORIGINS = new Set([
  CANONICAL_ORIGIN,
  'https://www.duediligence.ph',
]);

const UNAVAILABLE_BODY = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'APPLICATION_TEMPORARILY_UNAVAILABLE',
    message: 'Due Diligence is temporarily unavailable.',
    recovery: 'Wait briefly, then try again.',
  }),
});

function browserOrigin(request) {
  return String(request?.headers?.get('Origin') || '').trim();
}

function approvedBrowserOrigin(request) {
  const origin = browserOrigin(request);
  return APPROVED_BROWSER_ORIGINS.has(origin) ? origin : '';
}

function preflightResponse(request) {
  const origin = approvedBrowserOrigin(request);
  if (!origin) {
    return new Response(null, {
      status: 403,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Origin',
      },
    });
  }
  const requestedHeaders = String(request.headers.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = new Set(['content-type', 'x-request-id']);
  const deniedHeader = requestedHeaders.find((header) => !allowedHeaders.has(header));
  if (deniedHeader) {
    return new Response(null, {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'Origin',
      },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store, max-age=0',
      Vary: 'Origin',
    },
  });
}

function unavailableResponse(request) {
  const requestOrigin = approvedBrowserOrigin(request);
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': '5',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });

  if (requestOrigin) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
  }

  return new Response(JSON.stringify(UNAVAILABLE_BODY), {
    status: 503,
    headers,
  });
}

function normalizeRequestForApplication(request) {
  const origin = approvedBrowserOrigin(request);
  if (!origin || origin === CANONICAL_ORIGIN) {
    return { browserOrigin: origin, request };
  }

  const headers = new Headers(request.headers);
  headers.set('Origin', CANONICAL_ORIGIN);
  return {
    browserOrigin: origin,
    request: new Request(request, { headers }),
  };
}

function restoreBrowserCors(response, origin) {
  if (!origin || origin === CANONICAL_ORIGIN) return response;

  const headers = new Headers(response.headers);
  const upstreamAllowedOrigin = headers.get('Access-Control-Allow-Origin');
  if (upstreamAllowedOrigin === CANONICAL_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Vary', headers.get('Vary')?.includes('Origin')
    ? headers.get('Vary')
    : [headers.get('Vary'), 'Origin'].filter(Boolean).join(', '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function legacyAnswerValue(value) {
  if (typeof value !== 'string') return value;
  const match = /^option-(\d+)$/iu.exec(value.trim());
  return match ? Math.max(0, Number(match[1]) - 1) : value;
}

function responseWithJson(response, body) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canonicalQuestionId(value) {
  const raw = String(value ?? '').trim();
  const match = /^q[-_ ]?0*(\d{1,3})$/iu.exec(raw) || /^0*(\d{1,3})$/u.exec(raw);
  if (!match) return raw;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0
    ? `q${String(number).padStart(3, '0')}`
    : raw;
}

function sanitizeAnswerText(value) {
  if (typeof value !== 'string') return value;
  let safe = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, '');
  let rebuilt = '';
  for (const character of safe) {
    if (character.length === 1) {
      const code = character.charCodeAt(0);
      if (code >= 0xD800 && code <= 0xDFFF) {
        rebuilt += '\uFFFD';
        continue;
      }
    }
    rebuilt += character;
  }
  return rebuilt.normalize('NFC');
}

function normalizeStudentAnswerPayload(payload = {}) {
  let answer = payload.answer;
  if (typeof answer === 'string') {
    const option = /^option-(\d+)$/iu.exec(answer.trim());
    answer = option ? Math.max(0, Number(option[1]) - 1) : sanitizeAnswerText(answer);
  }
  return {
    ...payload,
    questionId: canonicalQuestionId(payload.questionId ?? payload.questionKey ?? payload.questionNumber),
    answer,
  };
}

async function responseJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function attemptStudentAnswerRecovery(command, requestKey, responseHeaders = null) {
  const payload = normalizeStudentAnswerPayload(command?.payload || {});
  if (!payload.sessionId || !payload.sessionToken || !payload.questionId) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANSWER_RECOVERY_TIMEOUT_MS);
  try {
    const recovery = await fetch(ANSWER_RECOVERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: payload.sessionId,
        sessionToken: payload.sessionToken,
        questionId: payload.questionId,
        answer: payload.answer,
        flagged: payload.flagged === true,
        requestKey: requestKey || command?.idempotencyKey || crypto.randomUUID(),
      }),
      signal: controller.signal,
    });
    const body = await responseJson(recovery);
    if (!recovery.ok || body?.ok !== true) return null;

    const headers = new Headers(responseHeaders || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.delete('Content-Length');
    headers.set('X-Examination-Answer-Recovery', 'supabase-v1');
    headers.set('Cache-Control', 'no-store, max-age=0');
    return new Response(JSON.stringify({
      ok: true,
      revision: body.revision || null,
      recovered: true,
    }), {
      status: 200,
      headers,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function recoverStudentAnswer(command, requestKey, failedResponse) {
  const recovered = await attemptStudentAnswerRecovery(command, requestKey, failedResponse?.headers);
  return recovered || failedResponse;
}

async function forwardStudentSaveWithRepair(request, application, command) {
  const first = await application.fetch(request);
  if (first.ok) return first;

  const firstBody = await responseJson(first);
  const firstCode = String(firstBody?.error?.code || '');
  if (first.status !== 400) return first;

  const repairedPayload = normalizeStudentAnswerPayload(command?.payload || {});
  const originalPayload = command?.payload || {};
  const changed = repairedPayload.questionId !== originalPayload.questionId
    || repairedPayload.answer !== originalPayload.answer;

  // Any 400 on a student answer save is recoverable at this boundary.
  // We still try one canonicalized application request first, but we no longer
  // allow an unfamiliar backend validation code to bypass the authenticated
  // recovery writer. The recovery service independently re-validates the
  // session, question binding, consent, room state, and answer type.
  const repairedKey = `answer-repair:${crypto.randomUUID()}`;
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Request-ID', repairedKey);
  const repairedRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'save_answer',
      payload: repairedPayload,
      idempotencyKey: repairedKey,
    }),
  });
  const repaired = await application.fetch(repairedRequest);
  if (repaired.ok) return repaired;
  return recoverStudentAnswer(
    { operation: 'save_answer', payload: repairedPayload, idempotencyKey: repairedKey },
    repairedKey,
    repaired,
  );
}

async function forwardApplicationRequest(request, application) {
  const url = new URL(request.url);
  const isStudentCommand = request.method === 'POST'
    && url.pathname === '/examination-room/v1/student/command';

  let command = null;
  if (isStudentCommand) {
    try {
      command = await request.clone().json();
    } catch {
      command = null;
    }
  }

  // Student answer saves use the independently authenticated recovery writer
  // first, but only after the browser origin has passed this alias's approved
  // origin allowlist. This keeps autosave available even when the application
  // Worker's global origin gate rejects the service-binding request. The legacy
  // application path remains a bounded fallback if recovery is unavailable.
  //
  // Final submit intentionally does NOT use this per-answer recovery path.
  // Submit stays a single application request containing the complete local
  // snapshot so first-time students do not hit the client deadline.
  if (command?.operation === 'save_answer' && approvedBrowserOrigin(request)) {
    const requestKey = request.headers.get('X-Request-ID')
      || command.idempotencyKey
      || crypto.randomUUID();
    const recovered = await attemptStudentAnswerRecovery(command, requestKey);
    if (recovered) return recovered;
  }

  // Submit is forwarded exactly once. The application Worker owns the atomic
  // submit-time answer backfill from payload.answers. Re-uploading every answer
  // here made one browser request wait on N sequential recovery calls and caused
  // first-time students to hit the client deadline before a receipt was returned.
  const response = command?.operation === 'save_answer'
    ? await forwardStudentSaveWithRepair(request, application, command)
    : await application.fetch(request);

  // Older already-open clients only recognize submittedAt, while the current
  // server receipt uses receivedAt. Add the compatible alias at the boundary
  // so those tabs can confirm without refreshing.
  if (command?.operation === 'submit' && response.headers.get('Content-Type')?.includes('application/json')) {
    try {
      const body = await response.clone().json();
      const submission = body?.submission;
      if (submission && !submission.submittedAt && submission.receivedAt) {
        return responseWithJson(response, {
          ...body,
          submission: {
            ...submission,
            submittedAt: submission.receivedAt,
          },
        });
      }
    } catch {
      // Preserve the upstream response if it is not valid JSON.
    }
  }

  return response;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return preflightResponse(request);
    }

    const application = env?.DUE_DILIGENCE_APPLICATION;
    if (!application || typeof application.fetch !== 'function') {
      return unavailableResponse(request);
    }

    try {
      const normalized = normalizeRequestForApplication(request);
      const response = await forwardApplicationRequest(normalized.request, application);
      if (!(response instanceof Response)) {
        return unavailableResponse(request);
      }
      return restoreBrowserCors(response, normalized.browserOrigin);
    } catch {
      console.error('Public application forwarding failed.');
      return unavailableResponse(request);
    }
  },
};
