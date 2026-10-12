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


test('answers authenticated grading preflight directly at the public API alias', async () => {
  const request = new Request('https://duediligence-api.example.test/', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-dd-beta-access',
    },
  });

  const response = await publicApiAlias.fetch(request, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  assert.match(response.headers.get('Access-Control-Allow-Methods') || '', /POST/);
  assert.match(response.headers.get('Access-Control-Allow-Methods') || '', /OPTIONS/);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Authorization/i);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Content-Type/i);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /X-DD-Beta-Access/i);
});

test('answers approved www grading preflight without forwarding to the application binding', async () => {
  let applicationCalls = 0;
  const request = new Request('https://duediligence-api.example.test/', {
    method: 'OPTIONS',
    headers: {
      Origin: WWW_PRODUCTION_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  const response = await publicApiAlias.fetch(request, {
    DUE_DILIGENCE_APPLICATION: {
      async fetch() {
        applicationCalls += 1;
        throw new Error('Preflight must be answered at the alias boundary.');
      },
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), WWW_PRODUCTION_ORIGIN);
  assert.equal(applicationCalls, 0);
});

test('rejects hostile origins and unapproved grading request headers during preflight', async () => {
  const hostileOrigin = await publicApiAlias.fetch(new Request('https://duediligence-api.example.test/', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }), {});
  assert.equal(hostileOrigin.status, 403);
  assert.equal(hostileOrigin.headers.get('Access-Control-Allow-Origin'), null);

  const hostileHeader = await publicApiAlias.fetch(new Request('https://duediligence-api.example.test/', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,x-not-approved',
    },
  }), {});
  assert.equal(hostileHeader.status, 403);
  assert.equal(hostileHeader.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
});

test('keeps alias-owned temporary failures readable from both approved browser origins', async () => {
  for (const origin of [PRODUCTION_ORIGIN, WWW_PRODUCTION_ORIGIN]) {
    const request = new Request('https://duediligence-api.example.test/', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const response = await publicApiAlias.fetch(request, {});
    assertControlledUnavailableResponse(response);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const payload = await readJson(response);
    assert.equal(payload.error.code, 'APPLICATION_TEMPORARILY_UNAVAILABLE');
  }
});

test('public alias source contains no provider brand reference', async () => {
  const source = await readFile(new URL('./public-api-alias.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /gemini/iu);
});
