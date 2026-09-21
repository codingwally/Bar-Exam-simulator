const CANONICAL_ORIGIN = 'https://duediligence.ph';
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

  if (command?.operation === 'submit' && Array.isArray(command?.payload?.answers)) {
    const sessionId = command.payload.sessionId || command.payload.attemptId;
    const sessionToken = command.payload.sessionToken;
    const baseRequestKey = String(
      command.idempotencyKey || request.headers.get('X-Request-ID') || '',
    ).trim();

    for (let index = 0; index < command.payload.answers.length; index += 1) {
      const answer = command.payload.answers[index];
      if (!answer || answer.answer === undefined || answer.answer === null || answer.answer === '') continue;

      const requestKey = `${baseRequestKey}:answer:${index + 1}`;
      const headers = new Headers(request.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('X-Request-ID', requestKey);

      const saveRequest = new Request(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'save_answer',
          payload: {
            sessionId,
            sessionToken,
            questionId: answer.questionId,
            answer: legacyAnswerValue(answer.answer),
            flagged: answer.flagged === true,
            source: 'submission',
          },
          idempotencyKey: requestKey,
        }),
      });

      const saved = await application.fetch(saveRequest);
      if (!saved.ok) return saved;
    }
  }

  const response = await application.fetch(request);

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
