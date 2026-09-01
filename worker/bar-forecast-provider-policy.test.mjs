import assert from 'node:assert/strict';
import test from 'node:test';

import { callGeminiStructuredForTest } from './index.mjs';

const RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['ok'],
  properties: Object.freeze({ ok: Object.freeze({ type: 'boolean' }) }),
});

function successfulProviderResponse() {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }],
  });
}

test('Forecast policy gets one attempt on each of two bounded models', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return Response.json({ error: { status: 'UNAVAILABLE', message: 'test failure' } }, {
        status: 503,
      });
    }
    return successfulProviderResponse();
  };
  try {
    const result = await callGeminiStructuredForTest(
      { GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'primary-test-model' },
      'Return the test result.',
      RESPONSE_SCHEMA,
      (value) => value,
      {
        quiet: true,
        requestTimeoutMs: 30_000,
        modelLimit: 2,
        attemptsPerModel: 1,
      },
    );
    assert.deepEqual(result.result, { ok: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0], /models\/primary-test-model:generateContent$/u);
    assert.match(calls[1], /models\/gemini-3\.6-flash:generateContent$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quick-coaching defaults retain one model with one repair retry', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return Response.json({ error: { status: 'UNAVAILABLE', message: 'test failure' } }, {
        status: 503,
      });
    }
    return successfulProviderResponse();
  };
  try {
    const result = await callGeminiStructuredForTest(
      { GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'primary-test-model' },
      'Return the test result.',
      RESPONSE_SCHEMA,
      (value) => value,
      { quiet: true },
    );
    assert.deepEqual(result.result, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
    assert.match(calls[0], /models\/primary-test-model:generateContent$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
