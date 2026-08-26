import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPROVED_STAGING_HOST = 'duediligence-examinations-staging.wallyesteban1993.workers.dev';
const DEFAULT_TARGET = 'http://127.0.0.1:4173';
const DEFAULT_USERS = 1_000;
const DEFAULT_CONCURRENCY = 50;
const REQUESTS = Object.freeze([
  { path: '/', type: /^text\/html\b/i, marker: /<title>Due Diligence\b/i },
  { path: '/admin/', type: /^text\/html\b/i, marker: /<title>Admin Dashboard — Due Diligence<\/title>/i },
  { path: '/assets/feature-loader.js', type: /^(?:application|text)\/javascript\b/i, marker: /DueDiligenceFeatureLoader/ },
  { path: '/assets/private-beta-landing.js', type: /^(?:application|text)\/javascript\b/i, marker: /DueDiligencePublicNavigation/ },
  { path: '/assets/duediligence-2026.js', type: /^(?:application|text)\/javascript\b/i, marker: /function gradeBarEasy\(/ },
  { path: '/admin/admin.js', type: /^(?:application|text)\/javascript\b/i, marker: /Security & Activity Log/ },
]);

function integerSetting(value, fallback, label, minimum, maximum) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum,
    `${label} must be an integer from ${minimum} to ${maximum}.`);
  return parsed;
}

export function approvedTarget(rawTarget) {
  const target = new URL(String(rawTarget || DEFAULT_TARGET));
  target.pathname = target.pathname.replace(/\/+$/u, '');
  target.search = '';
  target.hash = '';
  const local = target.protocol === 'http:'
    && ['127.0.0.1', 'localhost'].includes(target.hostname);
  const staging = target.protocol === 'https:' && target.hostname === APPROVED_STAGING_HOST;
  assert.ok(local || staging,
    'Refusing load test: use local preview or the approved Due Diligence staging host only.');
  return target;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

async function timedGet(target, request, userNumber, signal) {
  const { path: requestPath, type, marker } = request;
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(requestPath, `${target.href}/`), {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal,
      headers: {
        Accept: requestPath.endsWith('.js') ? 'application/javascript,*/*;q=0.8' : 'text/html,*/*;q=0.8',
        'User-Agent': `DueDiligence-Staging-Load-Test/1.0 virtual-user-${userNumber}`,
      },
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const contentMatched = marker.test(body);
    const typeMatched = type.test(contentType);
    return {
      path: requestPath,
      ok: response.status === 200 && body.length > 0 && contentMatched && typeMatched,
      status: response.status,
      bytes: Buffer.byteLength(body),
      contentType,
      contentMatched,
      typeMatched,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      path: requestPath,
      ok: false,
      status: 0,
      bytes: 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : 'request_failed',
    };
  }
}

async function virtualUser(target, userNumber, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const results = [];
    for (const request of REQUESTS) {
      results.push(await timedGet(target, request, userNumber, controller.signal));
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(target, users, concurrency, timeoutMs) {
  const results = [];
  let nextUser = 1;
  async function worker() {
    while (nextUser <= users) {
      const userNumber = nextUser;
      nextUser += 1;
      results.push(...await virtualUser(target, userNumber, timeoutMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(users, concurrency) }, worker));
  return results;
}

function summarizePath(path, results) {
  const matching = results.filter((result) => result.path === path);
  const failures = matching.filter((result) => !result.ok);
  const durations = matching.map((result) => result.durationMs);
  return {
    path,
    requests: matching.length,
    successes: matching.length - failures.length,
    failures: failures.length,
    failureRate: matching.length ? failures.length / matching.length : 1,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95),
    p99LatencyMs: percentile(durations, 0.99),
    maximumLatencyMs: durations.length ? Math.max(...durations) : 0,
    statuses: [...new Set(matching.map((result) => result.status))].sort((a, b) => a - b),
    contentTypes: [...new Set(matching.map((result) => result.contentType).filter(Boolean))].sort(),
    contentMismatches: matching.filter((result) => !result.contentMatched || !result.typeMatched).length,
    transferredBytes: matching.reduce((sum, result) => sum + result.bytes, 0),
  };
}

async function main() {
  const target = approvedTarget(process.env.STATIC_STRESS_TARGET || DEFAULT_TARGET);
  const users = integerSetting(process.env.STATIC_STRESS_USERS, DEFAULT_USERS,
    'Virtual users', 1, DEFAULT_USERS);
  const concurrency = integerSetting(process.env.STATIC_STRESS_CONCURRENCY, DEFAULT_CONCURRENCY,
    'Concurrency', 1, 100);
  const timeoutMs = integerSetting(process.env.STATIC_STRESS_USER_TIMEOUT_MS, 30_000,
    'Per-user timeout', 5_000, 120_000);
  const maximumP95Ms = integerSetting(process.env.STATIC_STRESS_MAXIMUM_P95_MS,
    target.hostname === APPROVED_STAGING_HOST ? 2_500 : 1_500,
    'Maximum p95 latency', 100, 60_000);
  const maximumP99Ms = integerSetting(process.env.STATIC_STRESS_MAXIMUM_P99_MS,
    target.hostname === APPROVED_STAGING_HOST ? 4_000 : 2_500,
    'Maximum p99 latency', maximumP95Ms, 60_000);

  const startedAt = new Date();
  const startedPerformance = performance.now();
  const results = await runPool(target, users, concurrency, timeoutMs);
  const elapsedMs = Math.max(1, Math.round(performance.now() - startedPerformance));
  const paths = REQUESTS.map(({ path: requestPath }) => summarizePath(requestPath, results));
  const report = {
    schemaVersion: 1,
    mode: target.hostname === APPROVED_STAGING_HOST
      ? 'approved-staging-static-load'
      : 'local-static-load',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    targetOrigin: target.origin,
    simulatedUsersTotal: users,
    maximumConcurrentUsers: Math.min(users, concurrency),
    loadProfile: `${users} complete user journeys with up to ${Math.min(users, concurrency)} journeys active at once`,
    requestsPerUser: REQUESTS.length,
    totalRequests: results.length,
    elapsedMs,
    throughputRequestsPerSecond: Number((results.length / (elapsedMs / 1_000)).toFixed(2)),
    thresholds: { maximumP95Ms, maximumP99Ms, maximumFailureRate: 0 },
    productionTargetAllowed: false,
    authenticatedRequests: 0,
    mutatingRequests: 0,
    geminiRequests: 0,
    paths,
    passed: paths.every((pathResult) => pathResult.failures === 0
      && pathResult.contentMismatches === 0
      && pathResult.p95LatencyMs <= maximumP95Ms
      && pathResult.p99LatencyMs <= maximumP99Ms),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
