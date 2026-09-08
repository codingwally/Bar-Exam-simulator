// Light, inert runner contracts. No browser launch, PDF rendering, Auth, SQL,
// network, provider or email. The protected runner owns actual live evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { analyticsFixture, OWNER, OTHER } from '../worker/forecast-analytics-test-fixture.mjs';
import { assertForecastScopeAggregate, assertForecastScopeMetadata, assertForecastScopeMember,
  assertForecastScopePrepared, sanitizeForecastBrowserDiagnostics, sanitizeForecastNodeDiagnostic,
  retryForecastRead, probeSource, TARGET } from './verify-astra-forecast-staging.mjs';

const copy = value => structuredClone(value);
const fixture = await analyticsFixture(3);
// Match the actual SQL manifest (canonical result.summary, not a pared-down
// render-only fixture), and all three actual history trend entries.
fixture.scope.manifest.forEach((row, index) => { row.summary = copy(fixture.attempts[index].result.summary); });
fixture.scope.analytics.trend = fixture.attempts.map(attempt => ({ attemptId: attempt.id, subject: attempt.subject,
  completedAt: attempt.completedAt, percentage: attempt.result.percentage,
  grammarScore: attempt.result.analytics.grammarAverage, issueSpottingScore: attempt.result.analytics.issueSpottingAverage }));
const metadata = () => ({ ok: true, scope: copy(fixture.scope), email: { status: 'not_requested', alreadyRequested: false } });
const prepared = () => ({ id: fixture.scope.id, owner_id: OWNER, scope_hash: fixture.scope.scopeHash,
  filter: copy(fixture.scope.filter), manifest: copy(fixture.scope.manifest), analytics: copy(fixture.scope.analytics),
  template_version: fixture.scope.templateVersion, created_at: fixture.scope.createdAt,
  browser_prepared_at: '2026-09-08T00:00:05.000Z', browser_prepared_version: 'forecast-analytics-pdf-v1',
  browser_prepared_byte_count: 123456, email_status: 'not_requested', email_executions: 0, email_requested_at: null });

test('actual three-result SQL summary and full-set aggregate contract is accepted without rendering', () => {
  const before = JSON.stringify(fixture);
  assert.equal(assertForecastScopeMetadata(metadata(), OWNER, fixture.attempts).manifest.length, 3);
  assert.equal(assertForecastScopeAggregate(fixture.scope.analytics, fixture.attempts).completedAttempts, 3);
  assert.equal(JSON.stringify(fixture), before);
});

test('aggregate rejects page-sized denominators, duplicates, incomplete grades and invented diagnostics', () => {
  for (const mutate of [a => { a.completedAttempts = 1; }, a => { a.averagePercentage = 1; },
    a => { a.averageGrammarScore = 0; }, a => { a.averageIssueSpottingScore = 5; },
    a => { a.pendingAttempts = 1; }, a => { a.failedAttempts = 1; },
    a => { a.bySubject[0].completedAttempts = 1; }, a => { a.trend.pop(); },
    a => { a.trend[1].attemptId = a.trend[0].attemptId; }, a => { a.trend[1].grammarScore = 0; }]) {
    const analytics = copy(fixture.scope.analytics); mutate(analytics);
    assert.throws(() => assertForecastScopeAggregate(analytics, fixture.attempts));
  }
  const duplicates = copy(fixture.attempts); duplicates[1] = duplicates[0];
  assert.throws(() => assertForecastScopeAggregate(fixture.scope.analytics, duplicates));
  const incomplete = copy(fixture.attempts); incomplete[2].result.complete = false;
  assert.throws(() => assertForecastScopeAggregate(fixture.scope.analytics, incomplete));
});

test('aggregate half-up means use all three distinct metric inputs, not the first page', () => {
  // Metric-only perturbations test aggregation, not model/rubric calibration.
  const attempts = copy(fixture.attempts), analytics = copy(fixture.scope.analytics);
  attempts.forEach((a, i) => { a.result.percentage = [10, 40, 90][i];
    a.result.analytics.grammarAverage = [1.1, 2.2, 3.3][i]; a.result.analytics.issueSpottingAverage = [2, 3, 4][i];
    Object.assign(analytics.trend[i], { percentage: a.result.percentage,
      grammarScore: a.result.analytics.grammarAverage, issueSpottingScore: a.result.analytics.issueSpottingAverage }); });
  Object.assign(analytics, { averagePercentage: 46.7, averageGrammarScore: 2.2, averageIssueSpottingScore: 3 });
  Object.assign(analytics.bySubject[0], { averagePercentage: 46.7, averageGrammarScore: 2.2, averageIssueSpottingScore: 3 });
  assert.equal(assertForecastScopeAggregate(analytics, attempts).averagePercentage, 46.7);
  analytics.averagePercentage = attempts[0].result.percentage;
  assert.throws(() => assertForecastScopeAggregate(analytics, attempts));
});

test('metadata rejects answer hydration, foreign owner, omitted maximum attempt and changed canonical summary', () => {
  for (const mutate of [p => { p.scope.ownerId = OTHER; }, p => { p.scope.manifest.pop(); },
    p => { p.scope.manifest[0].summary.questionCount = 19; }, p => { p.scope.manifest[0].resultRevision = 2; },
    p => { p.scope.manifest[0].answers = []; }, p => { p.scope.analytics.prompt = 'private content'; },
    p => { p.scope.filter.from = '2026-09-07T00:00:00Z'; }, p => { p.email.status = 'provider_accepted'; },
    p => { p.extra = 'unexpected hydration'; }]) {
    const payload = metadata(); mutate(payload);
    assert.throws(() => assertForecastScopeMetadata(payload, OWNER, fixture.attempts));
  }
});

test('each serial scope member must equal the complete original owner DTO and manifest position', () => {
  fixture.attempts.forEach((attempt, index) => {
    const payload = { ok: true, scopeId: fixture.scope.id, scopeHash: fixture.scope.scopeHash,
      resultHash: fixture.scope.manifest[index].resultHash, attempt: copy(attempt) };
    assert.equal(assertForecastScopeMember(payload, fixture.scope, attempt, index).id, attempt.id);
    const changedAnswer = copy(payload); changedAnswer.attempt.answers[19].answer += ' lost ending';
    assert.throws(() => assertForecastScopeMember(changedAnswer, fixture.scope, attempt, index));
    const changedGrade = copy(payload); changedGrade.attempt.result.totalScore++;
    assert.throws(() => assertForecastScopeMember(changedGrade, fixture.scope, attempt, index));
    assert.throws(() => assertForecastScopeMember({ ...payload, resultHash: 'b'.repeat(64) }, fixture.scope, attempt, index));
    assert.throws(() => assertForecastScopeMember(payload, fixture.scope, attempt, (index + 1) % 3));
  });
});

test('first client-prepared observation is immutable; email work and changed scope are rejected', () => {
  const original = prepared(); assertForecastScopePrepared(original, fixture.scope, 123456);
  assertForecastScopePrepared(copy(original), fixture.scope, 123456, original);
  for (const mutate of [r => { r.browser_prepared_at = '2026-09-08T00:00:06.000Z'; },
    r => { r.browser_prepared_byte_count++; }, r => { r.email_status = 'processing'; },
    r => { r.email_executions = 1; }, r => { r.email_requested_at = r.created_at; },
    r => { r.filter.subject = fixture.attempts[0].subject; }, r => { r.manifest.pop(); }]) {
    const row = copy(original); mutate(row);
    assert.throws(() => assertForecastScopePrepared(row, fixture.scope, 123456, original));
  }
});

test('only the two additive read operations can use bounded polite 429 recovery', async () => {
  for (const operation of ['analytics_report', 'analytics_attempt']) {
    let requests = 0; let elapsed = 0;
    const value = await retryForecastRead({ operation, deadline: 10000, now: () => elapsed,
      sleep: async ms => { elapsed += ms; }, checkDeadline: () => assert.ok(elapsed < 10000),
      request: async () => ({ response: new Response('{}', { status: ++requests === 1 ? 429 : 200,
        headers: { 'Retry-After': '1' } }), body: {} }) });
    assert.equal(value.response.status, 200); assert.equal(requests, 2); assert.ok(elapsed >= 1000);
  }
  for (const operation of ['analytics_snapshot', 'analytics_pdf_prepared', 'analytics_email']) {
    let requests = 0;
    await assert.rejects(retryForecastRead({ operation, request: async () => { requests++; }, deadline: Date.now() + 1000 }));
    assert.equal(requests, 0, 'Mutations must not enter automatic read retries');
  }
});

test('scope diagnostics retain only safe fixed enums and never private trace IDs or metadata', () => {
  const secret = 'private-person@example.test private-answer token-abc';
  const value = { analyticsTrace: { requested: [OWNER, secret], inFlight: 1 }, scopeId: OWNER, body: secret,
    operations: { analytics_attempt: { requested: 2, responded: 2, httpStatus: 404,
      errorCode: 'BAR_FORECAST_ANALYTICS_NOT_FOUND', attemptId: OWNER, answer: secret } } };
  const safe = sanitizeForecastBrowserDiagnostics(value);
  assert.equal(safe.operations.analytics_attempt.errorCode, 'BAR_FORECAST_ANALYTICS_NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(safe), /private-person|private-answer|token-abc|11111111|analyticsTrace|scopeId/);
  const node = sanitizeForecastNodeDiagnostic({ operation: 'analytics_report', endpoint: 'forecast', httpStatus: 409,
    errorCode: 'BAR_FORECAST_ANALYTICS_CHANGED', scopeId: OWNER, body: secret });
  assert.equal(node.errorCode, 'BAR_FORECAST_ANALYTICS_CHANGED');
  assert.doesNotMatch(JSON.stringify(node), /private-person|private-answer|token-abc|11111111|scopeId/);
});

test('passive browser trace observes actual serial requests without changing responses or sending requests itself', async () => {
  let calls = 0; const response = new Response('{"ok":true}');
  const window = { fetch: async () => { calls++; return response; } };
  vm.runInNewContext(probeSource(), { window, TypeError, URL });
  assert.equal(calls, 0); window.__astraForecastProbe.analyticsTrace.enabled = true;
  for (const attempt of fixture.attempts) {
    assert.equal(await window.fetch(`${TARGET.site}/admin/dd2026/bar-forecast`, {
      method: 'POST', body: JSON.stringify({ operation: 'analytics_attempt', scopeId: fixture.scope.id, attemptId: attempt.id }),
    }), response);
  }
  const trace = JSON.parse(JSON.stringify(window.__astraForecastProbe.analyticsTrace));
  assert.deepEqual(trace.requested, fixture.attempts.map(row => row.id)); assert.equal(trace.maximumInFlight, 1);
  assert.deepEqual(trace.completed, fixture.attempts.map(row => row.id));
  assert.equal(trace.inFlight, 0); assert.equal(calls, 3); assert.equal(await response.text(), '{"ok":true}');
  assert.doesNotMatch(JSON.stringify(sanitizeForecastBrowserDiagnostics(window.__astraForecastProbe)), /33333333|44444444|analyticsTrace/);
});

test('passive trace distinguishes throttled reads from completed members and exposes accidental concurrency', async () => {
  let calls = 0; const responses = [];
  const window = { fetch: () => new Promise(resolve => { calls++; responses.push(resolve); }) };
  vm.runInNewContext(probeSource(), { window, TypeError, URL }); window.__astraForecastProbe.analyticsTrace.enabled = true;
  const read = id => window.fetch(`${TARGET.site}/admin/dd2026/bar-forecast`, {
    method: 'POST', body: JSON.stringify({ operation: 'analytics_attempt', attemptId: id }),
  });
  const throttled = read(fixture.attempts[0].id); responses.shift()(new Response('{}', { status: 429 })); await throttled;
  assert.equal(window.__astraForecastProbe.analyticsTrace.completed.length, 0);
  const a = read(fixture.attempts[0].id), b = read(fixture.attempts[1].id);
  assert.equal(window.__astraForecastProbe.analyticsTrace.maximumInFlight, 2);
  responses.shift()(new Response('{}')); responses.shift()(new Response('{}')); await Promise.all([a, b]);
  assert.equal(calls, 3); assert.equal(window.__astraForecastProbe.analyticsTrace.inFlight, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__astraForecastProbe.analyticsTrace.completed)), fixture.attempts.slice(0, 2).map(row => row.id));
});

test('runner preserves three journeys, six selected downloads and original deadline; period checks run before cleanup', async () => {
  const source = await readFile(new URL('./verify-astra-forecast-staging.mjs', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('  async function verifyAnalyticsScope('), source.indexOf('  async function cleanupAccount('));
  assert.ok(helper.length > 5000);
  assert.doesNotMatch(helper, /createFixture\(|controlledComplete\(|retry_attempt|submit_attempt|operation:\s*['"]analytics_email['"]|operation:\s*['"]analytics_snapshot['"]|\/rpc\//u);
  assert.match(source, /Date\.now\(\) \+ 35 \* 60 \* 1000/u);
  assert.match(source, /for \(let number = 1; number <= 3; number\+\+\)/u);
  const selected = source.slice(source.indexOf('  async function verifySavedSurfaces('), source.indexOf('  async function verifyAnalyticsScope('));
  assert.match(selected, /repeat < 2/u); assert.match(selected, /actualBrowserDownloads: 2/u);
  assert.match(source, /summary\.analyticsScope = await verifyAnalyticsScope\(other, unpaid\);\s*stage = 'ownership-boundaries'/u);
  assert.match(helper, /await clickText\('Download period PDF'\)/u);
  assert.match(helper, /repeat <= 2/u); assert.match(helper, /await browser\('reload'\)/u);
  assert.match(helper, /if \(repeat === 2\)[\s\S]*?await startBrowser\(member, \{ scopeId: scope\.id \}\)/u);
  assert.match(helper, /readForecastPdfCandidate\(candidate, expectedPdf\)/u);
  assert.match(helper, /writeFile\(retained, bytes, \{ flag: 'wx', mode: 0o600 \}\)/u);
  assert.doesNotMatch(helper, /await rename\(|mtimeMs/u);
  assert.match(helper, /verifyForecastDownloadedBytes\(bytes, expectedPdf\)/u);
  assert.match(helper, /trace\.maximumInFlight, 1/u); assert.match(helper, /authorizedOther\.consentAccepted, true/u);
  assert.match(helper, /assert\.deepEqual\(await batches\(before\.attempt\.id\), before\.batches/u);
  assert.match(helper, /digest\(await ownedAttempt\(member, before\.attempt\.id\)\), digest\(before\.attempt\)/u);
  assert.match(source, /\['dd2026_forecast_analytics_exports', 'owner_id'\], \['dd2026_forecast_analytics_requests', 'owner_id'\]/u);
  assert.match(source, /'dd2026_forecast_analytics_exports', 'dd2026_forecast_analytics_requests'\]\) await service\(`/u);
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(markup, /<nav class="qfs-practice-rail"[\s\S]*?data-public-feature="verdict"/u);
  assert.match(source, /READY_ANALYTICS_LAUNCHER = '\.qfs-practice-rail \[data-public-feature="verdict"\]:not\(:disabled\)'/u);
});
