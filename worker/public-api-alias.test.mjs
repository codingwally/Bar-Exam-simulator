import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import publicApiAlias from './public-api-alias.mjs';

const PRODUCTION_ORIGIN = 'https://duediligence.ph';
const WWW_PRODUCTION_ORIGIN = 'https://www.duediligence.ph';

async function readJson(response) {
  return JSON.parse(await response.text());
}

function assertControlledUnavailableResponse(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('Retry-After'), '5');
  assert.equal(response.headers.get('Vary'), 'Origin');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
}

test('forwards the exact Request and returns the exact successful Response', async () => {
  const request = new Request('https://duediligence-api.example.test/pedro/turn?thread=thread-1', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
      Origin: PRODUCTION_ORIGIN,
      'X-Request-ID': 'request-1',
    },
    body: JSON.stringify({ message: 'Start a study drill.' }),
  });
  const upstreamResponse = new Response(JSON.stringify({ ok: true, turnId: 'turn-1' }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'X-Upstream-Receipt': 'receipt-1',
    },
  });

  let receivedRequest;
  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        receivedRequest = candidate;
        return upstreamResponse;
      },
    },
  });

  assert.strictEqual(receivedRequest, request);
  assert.strictEqual(response, upstreamResponse);
  assert.equal(receivedRequest.url, request.url);
  assert.equal(receivedRequest.method, 'POST');
  assert.equal(receivedRequest.headers.get('Authorization'), 'Bearer user-token');
  assert.equal(receivedRequest.headers.get('X-Request-ID'), 'request-1');
  assert.deepEqual(await readJson(receivedRequest), { message: 'Start a study drill.' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('X-Upstream-Receipt'), 'receipt-1');
  assert.deepEqual(await readJson(response), { ok: true, turnId: 'turn-1' });
});

test('preserves an upstream non-success Response without rewriting it', async () => {
  const request = new Request('https://duediligence-api.example.test/pedro/turn', {
    method: 'POST',
    body: '{}',
  });
  const upstreamResponse = new Response('temporarily busy', {
    status: 429,
    headers: { 'Retry-After': '17', 'X-Application-Code': 'BUSY' },
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      fetch: async () => upstreamResponse,
    },
  });

  assert.strictEqual(response, upstreamResponse);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '17');
  assert.equal(response.headers.get('X-Application-Code'), 'BUSY');
  assert.equal(await response.text(), 'temporarily busy');
});

test('normalizes the approved www browser origin for the application Worker and restores CORS to the browser origin', async () => {
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: {
      Origin: WWW_PRODUCTION_ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation: 'submit', payload: {} }),
  });

  let receivedRequest;
  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        receivedRequest = candidate;
        return new Response(JSON.stringify({ ok: false, error: { code: 'TEST_UPSTREAM' } }), {
          status: 409,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': PRODUCTION_ORIGIN,
            Vary: 'Origin',
          },
        });
      },
    },
  });

  assert.notStrictEqual(receivedRequest, request);
  assert.equal(receivedRequest.headers.get('Origin'), PRODUCTION_ORIGIN);
  assert.deepEqual(await readJson(receivedRequest), { operation: 'submit', payload: {} });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), WWW_PRODUCTION_ORIGIN);
  assert.match(response.headers.get('Vary'), /Origin/);
  assert.deepEqual(await readJson(response), { ok: false, error: { code: 'TEST_UPSTREAM' } });
});

test('does not normalize an unapproved browser origin before forwarding', async () => {
  const attackerOrigin = 'https://attacker.example';
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/preview', {
    method: 'POST',
    headers: { Origin: attackerOrigin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  let receivedRequest;
  const upstreamResponse = new Response(JSON.stringify({
    ok: false,
    error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This grading origin is not allowed.' },
  }), { status: 403 });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        receivedRequest = candidate;
        return upstreamResponse;
      },
    },
  });

  assert.strictEqual(receivedRequest, request);
  assert.equal(receivedRequest.headers.get('Origin'), attackerOrigin);
  assert.strictEqual(response, upstreamResponse);
});

test('unapproved origins cannot invoke the authenticated answer recovery writer', async (context) => {
  const attackerOrigin = 'https://attacker.example';
  let recoveryCalls = 0;
  let applicationCalls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    recoveryCalls += 1;
    throw new Error('Unapproved browser origins must never reach answer recovery.');
  });

  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: { Origin: attackerOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'save_answer',
      payload: {
        sessionId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        questionId: 'q001',
        answer: 'Blocked cross-origin answer',
        flagged: false,
      },
      idempotencyKey: 'operation:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch() {
        applicationCalls += 1;
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This grading origin is not allowed.' },
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  assert.equal(response.status, 403);
  assert.equal(recoveryCalls, 0);
  assert.equal(applicationCalls, 1);
  const body = await response.json();
  assert.equal(body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('student save_answer uses authenticated recovery before the application route for approved browser origins', async (context) => {
  let applicationCalls = 0;
  let recoveryCalls = 0;
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    recoveryCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.questionId, 'q001');
    assert.equal(body.answer, 'Direct recovery answer');
    return new Response(JSON.stringify({
      ok: true,
      revision: { questionKey: 'q001', revision: 1, savedAt: '2026-09-22T08:50:00.000Z', flagged: false },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: { Origin: PRODUCTION_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'save_answer',
      payload: {
        sessionId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        questionId: 'q001',
        answer: 'Direct recovery answer',
        flagged: false,
      },
      idempotencyKey: 'operation:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch() {
        applicationCalls += 1;
        throw new Error('Application route must not run after a successful authenticated recovery save.');
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Examination-Answer-Recovery'), 'supabase-v1');
  assert.equal(recoveryCalls, 1);
  assert.equal(applicationCalls, 0);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.recovered, true);
  assert.equal(body.revision.revision, 1);
});

test('public API repairs a 400 student save caused by legacy question ids, hidden controls, or stale request keys', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  const calls = [];
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Content-Type': 'application/json',
      'X-Request-ID': 'operation:12345678-1234-4234-8234-1234567890ab',
    },
    body: JSON.stringify({
      operation: 'save_answer',
      payload: {
        sessionId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        questionId: 'q-1',
        answer: 'Answer\u202E text',
        flagged: false,
      },
      idempotencyKey: 'operation:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        const body = JSON.parse(await candidate.text());
        calls.push({
          body,
          requestId: candidate.headers.get('X-Request-ID'),
        });
        if (calls.length === 1) {
          return new Response(JSON.stringify({
            ok: false,
            error: {
              code: 'EXAM_ROOM_V1_TEXT_INVALID',
              message: 'Remove hidden characters and try again.',
            },
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          ok: true,
          revision: { revision: 1 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.operation, 'save_answer');
  assert.equal(calls[1].body.payload.questionId, 'q001');
  assert.equal(calls[1].body.payload.answer, 'Answer text');
  assert.match(calls[1].requestId, /^answer-repair:/u);
  assert.equal(calls[1].body.idempotencyKey, calls[1].requestId);
});

test('public API falls back through the application route and retries authenticated recovery if the primary recovery writer is temporarily unavailable', async (context) => {
  const applicationCalls = [];
  const recoveryCalls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    recoveryCalls.push({ url: String(url), body: JSON.parse(options.body) });
    if (recoveryCalls.length === 1) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      revision: { questionKey: 'q001', revision: 1, savedAt: '2026-09-22T08:55:00.000Z', flagged: false },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Content-Type': 'application/json',
      'X-Request-ID': 'operation:12345678-1234-4234-8234-1234567890ab',
    },
    body: JSON.stringify({
      operation: 'save_answer',
      payload: {
        sessionId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        questionId: 'q001',
        answer: 'Recovered answer',
        flagged: false,
      },
      idempotencyKey: 'operation:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        const body = JSON.parse(await candidate.text());
        applicationCalls.push(body);
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'EXAM_ROOM_V1_TEXT_INVALID', message: 'Save rejected.' },
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': PRODUCTION_ORIGIN,
          },
        });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(applicationCalls.length, 2);
  assert.equal(recoveryCalls.length, 2);
  assert.match(recoveryCalls[0].url, /examination-room-answer-recovery$/u);
  assert.equal(recoveryCalls[0].body.questionId, 'q001');
  assert.equal(recoveryCalls[0].body.answer, 'Recovered answer');
  assert.equal(recoveryCalls[1].body.questionId, 'q001');
  assert.equal(recoveryCalls[1].body.answer, 'Recovered answer');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.recovered, true);
  assert.equal(body.revision.revision, 1);
});

test('unknown 400 validation codes cannot bypass the authenticated answer recovery fallback', async (context) => {
  let recoveryCalls = 0;
  let applicationCalls = 0;
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    recoveryCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.questionId, 'q001');
    if (recoveryCalls === 1) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      revision: { questionKey: 'q001', revision: 1, savedAt: '2026-09-22T09:00:00.000Z', flagged: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: { Origin: PRODUCTION_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'save_answer',
      payload: {
        sessionId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        questionId: 'q001',
        answer: 'Recovered regardless of backend code',
        flagged: false,
      },
      idempotencyKey: 'operation:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch() {
        applicationCalls += 1;
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'SOME_NEW_VALIDATION_CODE', message: 'Rejected.' },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': PRODUCTION_ORIGIN },
        });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(applicationCalls, 2);
  assert.equal(recoveryCalls, 2);
  assert.equal(response.headers.get('X-Examination-Answer-Recovery'), 'supabase-v1');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.recovered, true);
});

test('Examination Room submit is forwarded once with its complete snapshot and patches old receipt timestamp', async (context) => {
  const calls = [];
  let recoveryCalls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    recoveryCalls += 1;
    throw new Error('Submit must not call per-answer recovery at the alias boundary.');
  });
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Content-Type': 'application/json',
      'X-Request-ID': 'submission:12345678-1234-4234-8234-1234567890ab',
    },
    body: JSON.stringify({
      operation: 'submit',
      payload: {
        attemptId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        answers: [
          { questionId: 'q001', answer: 'Recovered essay answer', flagged: false },
          { questionId: 'q002', answer: 'option-2', flagged: true },
        ],
      },
      idempotencyKey: 'submission:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        const body = JSON.parse(await candidate.text());
        calls.push({ body, requestId: candidate.headers.get('X-Request-ID') });
        return new Response(JSON.stringify({
          ok: true,
          submission: {
            id: '66666666-6666-4666-8666-666666666666',
            receiptId: '77777777-7777-4777-8777-777777777777',
            receivedAt: '2026-09-21T18:40:00.000Z',
          },
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  assert.equal(response.status, 201);
  assert.equal(recoveryCalls, 0);
  assert.deepEqual(calls.map((entry) => entry.body.operation), ['submit']);
  assert.equal(calls[0].body.payload.answers.length, 2);
  assert.equal(calls[0].body.payload.answers[0].answer, 'Recovered essay answer');
  assert.equal(calls[0].body.payload.answers[1].answer, 'option-2');
  const body = await response.json();
  assert.equal(body.submission.receivedAt, '2026-09-21T18:40:00.000Z');
  assert.equal(body.submission.submittedAt, '2026-09-21T18:40:00.000Z');
});

test('submit returns the application rejection without starting alias-owned answer uploads', async (context) => {
  let recoveryCalls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    recoveryCalls += 1;
    throw new Error('Submit must not call recovery at the alias boundary.');
  });
  const calls = [];
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'POST',
    headers: { Origin: PRODUCTION_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'submit',
      payload: {
        attemptId: '55555555-5555-4555-8555-555555555555',
        sessionToken: 'ers1_' + 'ab'.repeat(32),
        answers: [{ questionId: 'q001', answer: 'Unsaved answer', flagged: false }],
      },
      idempotencyKey: 'submission:12345678-1234-4234-8234-1234567890ab',
    }),
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch(candidate) {
        const body = JSON.parse(await candidate.text());
        calls.push(body.operation);
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'ANSWER_REVISION_CONFLICT', message: 'Save failed.' },
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  assert.equal(response.status, 409);
  assert.equal(recoveryCalls, 0);
  assert.deepEqual(calls, ['submit']);
});

test('returns a controlled provider-neutral 503 when the binding is missing', async () => {
  const request = new Request('https://duediligence-api.example.test/pedro/turn', {
    headers: { Origin: PRODUCTION_ORIGIN },
  });
  const response = await publicApiAlias.fetch(request, {});

  assertControlledUnavailableResponse(response);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  const serialized = JSON.stringify(await readJson(response));
  assert.equal(serialized, JSON.stringify({
    ok: false,
    error: {
      code: 'APPLICATION_TEMPORARILY_UNAVAILABLE',
      message: 'Due Diligence is temporarily unavailable.',
      recovery: 'Wait briefly, then try again.',
    },
  }));
  assert.doesNotMatch(serialized, /gemini|model|provider|binding|worker/iu);
});

test('returns the same controlled 503 without leaking a thrown transport error', async (context) => {
  context.mock.method(console, 'error', () => {});
  const request = new Request('https://duediligence-api.example.test/pedro/turn', {
    headers: { Origin: PRODUCTION_ORIGIN },
  });
  const privateFailure = 'internal target and credential details must stay private';
  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch() {
        throw new Error(privateFailure);
      },
    },
  });

  assertControlledUnavailableResponse(response);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  const serialized = JSON.stringify(await readJson(response));
  assert.doesNotMatch(serialized, new RegExp(privateFailure, 'iu'));
  assert.doesNotMatch(serialized, /gemini|model|provider|binding|worker/iu);
  assert.equal(console.error.mock.callCount(), 1);
  assert.deepEqual(console.error.mock.calls[0].arguments, ['Public application forwarding failed.']);
});

test('treats an invalid binding return as an alias-owned unavailable response', async () => {
  const request = new Request('https://duediligence-api.example.test/pedro/turn', {
    headers: { Origin: PRODUCTION_ORIGIN },
  });
  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      fetch: async () => undefined,
    },
  });

  assertControlledUnavailableResponse(response);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  assert.doesNotMatch(JSON.stringify(await readJson(response)), /gemini|model|provider|binding|worker/iu);
});

test('does not grant CORS access to an unapproved or absent origin on alias-owned errors', async () => {
  for (const origin of ['https://attacker.example', null]) {
    const headers = origin ? { Origin: origin } : undefined;
    const request = new Request('https://duediligence-api.example.test/pedro/turn', { headers });
    const response = await publicApiAlias.fetch(request, {});

    assertControlledUnavailableResponse(response);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('public alias source contains no provider brand reference', async () => {
  const source = await readFile(new URL('./public-api-alias.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /gemini/iu);
});


test('public API alias answers approved Examination Room browser preflight directly', async () => {
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-request-id',
    },
  });

  const response = await publicApiAlias.fetch(request, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Content-Type/i);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /X-Request-ID/i);
});

test('public API alias rejects hostile Examination Room browser preflight', async () => {
  const request = new Request('https://duediligence-api.example.test/examination-room/v1/student/command', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-request-id',
    },
  });

  const response = await publicApiAlias.fetch(request, {});
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});
