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

test('Forecast policy prefers the full model at zero temperature with one bounded fallback', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) {
      return Response.json({ error: { status: 'UNAVAILABLE', message: 'test failure' } }, {
        status: 503,
      });
    }
    return successfulProviderResponse();
  };
  try {
    const result = await callGeminiStructuredForTest(
      { GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'gemini-3.5-flash-lite' },
      'Return the test result.',
      RESPONSE_SCHEMA,
      (value) => value,
      {
        quiet: true,
        requestTimeoutMs: 45_000,
        preferredModel: 'gemini-3.6-flash',
        fallbackModels: ['gemini-3.5-flash-lite'],
        temperature: 0,
        modelLimit: 2,
        attemptsPerModel: 1,
      },
    );
    assert.deepEqual(result.result, { ok: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /models\/gemini-3\.6-flash:generateContent$/u);
    assert.match(calls[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/u);
    assert.equal(calls[0].body.generationConfig.temperature, 0);
    assert.equal(calls[1].body.generationConfig.temperature, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('caller preference can pin or emergency-redirect Forecast independently', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) {
      return Response.json({ error: { status: 'UNAVAILABLE', message: 'test failure' } }, {
        status: 503,
      });
    }
    return successfulProviderResponse();
  };
  try {
    const result = await callGeminiStructuredForTest(
      { GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'gemini-3.5-flash-lite' },
      'Return the test result.',
      RESPONSE_SCHEMA,
      (value) => value,
      {
        quiet: true,
        preferredModel: 'emergency-operations-model',
        fallbackModels: ['gemini-3.5-flash-lite'],
        temperature: 0,
        modelLimit: 2,
        attemptsPerModel: 1,
      },
    );
    assert.deepEqual(result.result, { ok: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /models\/emergency-operations-model:generateContent$/u);
    assert.match(calls[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quick-coaching defaults retain one model with one repair retry', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
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
    assert.equal(calls[0].url, calls[1].url);
    assert.match(calls[0].url, /models\/primary-test-model:generateContent$/u);
    assert.equal('temperature' in calls[0].body.generationConfig, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
