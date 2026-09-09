// Execute the actual Worker window/rate functions, not a parallel quota implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
const phase4 = await readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
function quotaFixture() {
  const constants = ['WINDOW_MS', 'MAX_BAR_FORECAST_NETWORK_REQUESTS_PER_WINDOW',
    'MAX_BAR_FORECAST_USER_REQUESTS_PER_WINDOW', 'MAX_BAR_FORECAST_USER_READ_REQUESTS_PER_WINDOW',
    'BAR_FORECAST_READ_OPERATIONS', 'barForecastNetworkRateWindows', 'barForecastUserRateWindows', 'barForecastUserReadRateWindows'];
  const declarations = constants.map((name) => {
    const match = source.match(new RegExp(`^const ${name} = .+;$`, 'm')); assert.ok(match); return match[0];
  }).join('\n');
  const windowSource = source.slice(source.indexOf('function enforceWindow('), source.indexOf('async function enforceRateLimit('));
  const forecastSource = source.slice(source.indexOf('async function enforceBarForecastRateLimit('), source.indexOf('async function enforceForumRateLimit('));
  let now = 0;
  const context = vm.createContext({ Date: { now: () => now },
    ExaminerError: class extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } },
    hmacHex: async (_key, input) => input, transientRateKey: async (request, _env, scope) => `${scope}:${request.ip}` });
  vm.runInContext(`${declarations}\n${windowSource}\n${forecastSource}\nthis.enforce=enforceBarForecastRateLimit;`, context);
  return { call: (operation, owner = 'owner-a') => context.enforce({ ip: 'same-network' }, {}, owner === null ? null : { id: owner }, operation),
    advance: (ms) => { now += ms; } };
}

test('read budget is separate while all original mutations and export budgets remain thirty', async () => {
  const q = quotaFixture();
  const reads = ['status', 'attempt', 'history', 'analytics_report', 'analytics_attempt'];
  for (let index = 0; index < 120; index++) await q.call(reads[index % reads.length]);
  for (const operation of reads) await assert.rejects(q.call(operation), (error) =>
    error.status === 429 && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 600);
  const writes = ['start', 'submit', 'submit_attempt', 'retry_attempt', 'accept', 'email_result', 'result_pdf',
    'result_pdf_prepared', 'analytics_snapshot', 'analytics_pdf_prepared', 'analytics_email', 'unknown'];
  for (let index = 0; index < 30; index++) await q.call(writes[index % writes.length]);
  for (const operation of writes) await assert.rejects(q.call(operation), (error) => error.status === 429);
  await q.call('attempt', 'owner-b');
  await q.call('submit_attempt', 'owner-b');
});

test('Analytics mutations consume exactly the original thirty-write budget without consuming read access', async () => {
  for (const mutation of ['analytics_snapshot', 'analytics_pdf_prepared', 'analytics_email', 'result_pdf_prepared']) {
    const q = quotaFixture();
    for (let index = 0; index < 30; index++) await q.call(mutation);
    for (const operation of [mutation, 'submit_attempt', 'email_result', 'unknown']) {
      await assert.rejects(q.call(operation), (error) =>
        error.status === 429 && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 600);
    }
    await q.call('analytics_report');
    await q.call('analytics_attempt');
    await q.call(mutation, 'owner-b');
    q.advance(600000);
    await q.call(mutation);
  }
});

test('network abuse protection remains180 per ten minutes across owners and read operations', async () => {
  const q = quotaFixture();
  const reads = ['status', 'attempt', 'history', 'analytics_report', 'analytics_attempt'];
  for (let index = 0; index < 180; index++) await q.call(reads[index % reads.length], null);
  for (const operation of reads) await assert.rejects(q.call(operation, null), (error) =>
    error.status === 429 && error.retryAfterSeconds === 600);
  q.advance(599500);
  await assert.rejects(q.call('status', null), (error) => error.retryAfterSeconds === 1);
  q.advance(500); await q.call('attempt', null);
});

test('long standard-grading UI and observer reads fit without consuming a new grading budget', async () => {
  const q = quotaFixture();
  for (const operation of ['status', 'start', 'submit_attempt']) { await q.call(operation, null); await q.call(operation); }
  for (let tick = 1; tick <= 120; tick++) {
    q.advance(10000);
    await q.call('attempt', null); await q.call('attempt');
    if (tick % 3 === 0) { await q.call('attempt', null); await q.call('attempt'); }
  }
  // The unchanged write quota is independent: the two recent-window writes above
  // were in an older window, so exactly thirty now remain, not unlimited writes.
  for (let index = 0; index < 30; index++) await q.call('submit_attempt');
  await assert.rejects(q.call('submit_attempt'), (error) => error.status === 429);
});

test('real shared-client retry projection preserves valid header/body delays and rejects malformed values', () => {
  const start = phase4.indexOf('      const retrySeconds = payload?.error?.retryAfterSeconds;');
  const endMarker = 'error.retryAfterMs = Number.isFinite(retryDelay) && retryDelay >= 0 ? Math.max(1000, retryDelay) : null;';
  const end = phase4.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start);
  const block = phase4.slice(start, end);
  const project = (header, seconds) => {
    const context = vm.createContext({ error: {}, payload: { error: { retryAfterSeconds: seconds } },
      response: { headers: { get: () => header } }, Date });
    vm.runInContext(block, context); return context.error;
  };
  assert.equal(project('90', 120).retryAfterMs, 90000);
  assert.equal(project('90', 120).retryAfterSeconds, 120);
  assert.ok(project(new Date(Date.now() + 120000).toUTCString()).retryAfterMs >= 118000);
  assert.equal(project('untrusted-not-a-date', 'private').retryAfterMs, null);
  assert.equal(project(null, '90').retryAfterSeconds, null);
  assert.equal(project('-1', -1).retryAfterSeconds, null);
  assert.match(source, /errorResponse\.headers\.set\('Retry-After', String\(error\.retryAfterSeconds\)\)/);
});
test('online shell, lazy loader and cache-first service worker use matching new polling asset URLs', async () => {
  const [html, loader, serviceWorker] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
  ]);
  const version = 'poll=astra-forecast-read-wait-20260907-r1';
  for (const name of ['phase4-experience', 'feature-loader']) {
    const url = html.match(new RegExp('src="(assets/' + name + '\\.js\\?[^"]+)"'))?.[1]?.replaceAll('&amp;', '&');
    assert.equal(new URL(url, 'https://fixture.invalid').searchParams.get('poll'), version.split('=')[1],
      name + ' must retain the bounded polling generation');
    if (name === 'feature-loader') {
      assert.equal(new URL(url, 'https://fixture.invalid').searchParams.get('pdf'), 'astra-browser-pdf-20260908-r1');
      assert.equal(new URL(url, 'https://fixture.invalid').searchParams.get('editor'), 'astra-forecast-multiline-20260908-r1');
      assert.equal(new URL(url, 'https://fixture.invalid').searchParams.get('analytics'), 'astra-analytics-browser-20260908-r1');
      assert.equal(new URL(url, 'https://fixture.invalid').searchParams.get('counts'), 'astra-analytics-count-copy-20260908-r1');
    }
    assert.ok(serviceWorker.includes("'/" + url + "'"), name + ' cache URL must exactly match page');
  }
  const forecast = loader.match(/'(assets\/bar-forecast\.js\?[^']+)'/)?.[1];
  assert.equal(new URL(forecast, 'https://fixture.invalid').searchParams.get('poll'), version.split('=')[1]);
  assert.equal(new URL(forecast, 'https://fixture.invalid').searchParams.get('pdf'), 'astra-browser-pdf-20260908-r1');
  assert.equal(new URL(forecast, 'https://fixture.invalid').searchParams.get('editor'), 'astra-forecast-multiline-20260908-r1');
  assert.equal(new URL(forecast, 'https://fixture.invalid').searchParams.get('analytics'), 'astra-analytics-browser-20260908-r1');
  assert.equal(new URL(forecast, 'https://fixture.invalid').searchParams.get('counts'), 'astra-analytics-count-copy-20260908-r1');
  assert.ok(serviceWorker.includes("'/" + forecast + "'"));
  const forecastCss = loader.match(/'(assets\/bar-forecast\.css\?[^']+)'/)?.[1];
  assert.ok(forecastCss.endsWith('editor=astra-forecast-multiline-20260908-r1'));
  assert.ok(serviceWorker.includes("'/" + forecastCss + "'"));
  assert.match(serviceWorker, /const CACHE_VERSION = 'duediligence-shell-astra-analytics-count-copy-20260908-r1-asset-recovery-20260909-r1-home-readable-20260910-1-native-close-20260910-1';/);
});
