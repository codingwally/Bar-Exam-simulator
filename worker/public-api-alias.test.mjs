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

test('legacy Examination Room submit backfills local answers before forwarding submit and patches old receipt timestamp', async () => {
  const calls = [];
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
        if (body.operation === 'save_answer') {
          return new Response(JSON.stringify({ ok: true, revision: { revision: calls.length } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
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
  assert.deepEqual(calls.map((entry) => entry.body.operation), ['save_answer', 'save_answer', 'submit']);
  assert.equal(calls[0].body.payload.questionId, 'q001');
  assert.equal(calls[0].body.payload.answer, 'Recovered essay answer');
  assert.equal(calls[1].body.payload.questionId, 'q002');
  assert.equal(calls[1].body.payload.answer, 1);
  assert.equal(calls[0].body.payload.source, 'submission');
  assert.match(calls[0].requestId, /:answer:1$/u);
  const body = await response.json();
  assert.equal(body.submission.receivedAt, '2026-09-21T18:40:00.000Z');
  assert.equal(body.submission.submittedAt, '2026-09-21T18:40:00.000Z');
});

test('legacy submit stops before final submission if answer backfill is rejected', async () => {
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
  assert.deepEqual(calls, ['save_answer']);
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
