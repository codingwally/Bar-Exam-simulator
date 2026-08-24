import assert from 'node:assert/strict';
import test from 'node:test';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };
import {
  loadWebsiteBankForTest,
  resetWebsiteBankCacheForTest,
} from './index.mjs';
import { WEBSITE_VISIBILITY_CSV_URL } from './release-content-core.mjs';

const CANONICAL_URL = 'https://question-bank.test/canonical.json';

function overlayCsv(hiddenIds = []) {
  const hidden = new Set(hiddenIds);
  return [
    'Question ID,Publication Ready?',
    ...questionBank.records.map((record) => {
      const questionId = String(record['Question ID']).trim();
      return `${questionId},${hidden.has(questionId) ? 'No' : 'Yes'}`;
    }),
  ].join('\r\n');
}

function cacheDouble() {
  const entries = new Map();
  return {
    entries,
    cache: {
      async match(request) {
        return entries.get(String(request.url))?.clone() || undefined;
      },
      async put(request, response) {
        entries.set(String(request.url), response.clone());
      },
    },
  };
}

function canonicalResponse() {
  return Response.json(questionBank);
}

test('website loader applies and edge-caches a complete visibility projection', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const edge = cacheDouble();
  globalThis.caches = { default: edge.cache };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === CANONICAL_URL) return canonicalResponse();
    if (target === WEBSITE_VISIBILITY_CSV_URL) {
      return new Response(overlayCsv(['LAB-001']), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    resetWebsiteBankCacheForTest();
  });

  resetWebsiteBankCacheForTest();
  const records = await loadWebsiteBankForTest(CANONICAL_URL);
  assert.equal(records.get('LAB-001')['Publication Ready?'], 'No');
  assert.equal(records.size, questionBank.records.length);
  assert.equal(edge.entries.size, 1);
});

test('fresh isolate keeps the last edge-validated hide through a Google 409', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const edge = cacheDouble();
  globalThis.caches = { default: edge.cache };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === CANONICAL_URL) return canonicalResponse();
    if (target === WEBSITE_VISIBILITY_CSV_URL) {
      return new Response(overlayCsv(['LAB-001']), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    resetWebsiteBankCacheForTest();
  });

  resetWebsiteBankCacheForTest();
  await loadWebsiteBankForTest(CANONICAL_URL);
  resetWebsiteBankCacheForTest();
  globalThis.fetch = async (url) => (
    String(url) === CANONICAL_URL
      ? canonicalResponse()
      : new Response('temporarily unavailable', { status: 409 })
  );
  const records = await loadWebsiteBankForTest(CANONICAL_URL);
  assert.equal(records.get('LAB-001')['Publication Ready?'], 'No');
});

test('partial projection cannot interrupt a cold-start exam request', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const edge = cacheDouble();
  globalThis.caches = { default: edge.cache };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === CANONICAL_URL) return canonicalResponse();
    if (target === WEBSITE_VISIBILITY_CSV_URL) {
      return new Response('Question ID,Publication Ready?\r\nLAB-001,No', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    resetWebsiteBankCacheForTest();
  });

  resetWebsiteBankCacheForTest();
  const records = await loadWebsiteBankForTest(CANONICAL_URL);
  assert.equal(records.size, questionBank.records.length);
  assert.equal(records.get('LAB-001')['Publication Ready?'], 'Yes');
  assert.equal(edge.entries.size, 0);
});

test('last-valid in-memory bank survives simultaneous source outages', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const originalNow = Date.now;
  const edge = cacheDouble();
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.caches = { default: edge.cache };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === CANONICAL_URL) return canonicalResponse();
    if (target === WEBSITE_VISIBILITY_CSV_URL) {
      return new Response(overlayCsv(['LAB-001']), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  t.after(() => {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    resetWebsiteBankCacheForTest();
  });

  resetWebsiteBankCacheForTest();
  await loadWebsiteBankForTest(CANONICAL_URL);
  edge.entries.clear();
  now += 5 * 60 * 1000 + 1;
  globalThis.fetch = async () => new Response('temporarily unavailable', { status: 409 });
  const records = await loadWebsiteBankForTest(CANONICAL_URL);
  assert.equal(records.get('LAB-001')['Publication Ready?'], 'No');
});
