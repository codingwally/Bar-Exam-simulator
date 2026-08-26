import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WORKER_URL = 'https://duediligence-api.wallyesteban1993.workers.dev';
const SITE_ORIGIN = 'https://duediligence.ph';
const SUPABASE_URL = 'https://hbllomlijfznnuudpdvr.supabase.co';
const CONCURRENCY_LEVELS = [1, 2, 4, 8, 16];

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

async function loadPublishableKey() {
  const source = await readFile(new URL('../assets/phase2-config.js', import.meta.url), 'utf8');
  const match = source.match(/publishableKey:\s*'([^']+)'/);
  assert(match, 'Production publishable key is missing from the browser configuration.');
  assert.match(match[1], /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
  return match[1];
}

async function timedRequest(makeRequest) {
  const startedAt = performance.now();
  try {
    const response = await makeRequest();
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      body,
      corsOrigin: response.headers.get('access-control-allow-origin'),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runLevel(name, concurrency, makeRequest, validate) {
  const responses = await Promise.all(
    Array.from({ length: concurrency }, () => timedRequest(makeRequest)),
  );
  const failures = responses.filter((result) => !result.ok || !validate(result));
  const durations = responses.map((result) => result.durationMs);
  return {
    name,
    concurrency,
    requests: responses.length,
    successes: responses.length - failures.length,
    failures: failures.length,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95),
    maximumLatencyMs: Math.max(...durations),
    statuses: [...new Set(responses.map((result) => result.status))].sort(),
  };
}

const publishableKey = await loadPublishableKey();
const workerResults = [];
const databaseResults = [];

for (const concurrency of CONCURRENCY_LEVELS) {
  workerResults.push(await runLevel(
    'worker-cors-preflight',
    concurrency,
    () => fetch(WORKER_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: SITE_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }),
    (result) => result.status === 204 && result.corsOrigin === SITE_ORIGIN,
  ));

  databaseResults.push(await runLevel(
    'supabase-public-subject-read',
    concurrency,
    () => fetch(`${SUPABASE_URL}/rest/v1/subjects?select=id,name,sort_order&order=sort_order.asc`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
    }),
    (result) => {
      if (result.status !== 200) return false;
      try {
        const rows = JSON.parse(result.body);
        return Array.isArray(rows) && rows.length === 8;
      } catch {
        return false;
      }
    },
  ));
}

const allResults = [...workerResults, ...databaseResults];
const report = {
  measuredAt: new Date().toISOString(),
  mode: 'read-only-production-capacity-probe',
  productionWrites: 0,
  credentialsLoggedOrPersisted: false,
  concurrencyLevels: CONCURRENCY_LEVELS,
  workerResults,
  databaseResults,
  passed: allResults.every((result) => result.failures === 0),
};

console.log(JSON.stringify(report, null, 2));

if (!report.passed) process.exitCode = 1;
