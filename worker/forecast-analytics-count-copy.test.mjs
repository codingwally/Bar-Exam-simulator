import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Actual shipped source; dependency-free presentation checks only. PDF drawing,
// fonts and DOM sinks are inert, not native layout/download or provider evidence.
const coreSource = await readFile(new URL('./forecast-analytics-core.mjs', import.meta.url), 'utf8');
const pdfSource = await readFile(new URL('./forecast-analytics-pdf.mjs', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
class BarForecastError extends Error {
  constructor(code, message, status) { super(message); Object.assign(this, { code, status }); }
}
const context = { BarForecastError };
vm.runInNewContext(coreSource.replace(/^import[^\n]*\n/gmu, '').replace(/^export /gmu, '')
  + '\nglobalThis.core = { analyticsSummaryLines, buildForecastAnalyticsEmail, validateForecastAnalyticsScope,'
  + ' FORECAST_ANALYTICS_VERSION, MAX_BYTES, MAX_PAGES, text, metric, manila, sizeError, forecastAnalyticsLink,'
  + ' validateForecastScopeAttempt, assertForecastAnalyticsPdfSize, periodLabel };', context);
const core = context.core;
const OWNER = '11111111-1111-4111-8111-111111111111';
const hash = value => createHash('sha256').update(value).digest('hex');
function scope(count) {
  return {
    id: '44444444-4444-4444-8444-444444444444', ownerId: OWNER,
    schemaVersion: 'forecast-analytics-scope-v1', templateVersion: 'forecast-analytics-pdf-v1',
    createdAt: '2026-09-08T00:00:00.000Z', scopeHash: 'a'.repeat(64),
    filter: { subject: null, from: null, to: null, completeOnly: true, timeZone: 'Asia/Manila' },
    manifest: Array.from({ length: count }, (_, i) => ({
      attemptId: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
      resultRevision: 1, resultHash: 'b'.repeat(64), completedAt: '2026-09-08T00:00:00.000Z',
      subject: 'Civil Law', summary: { totalScore: 0, maxScore: 100, percentage: 0 },
    })),
    analytics: {
      completeOnly: true, completedAttempts: count, pendingAttempts: 0, failedAttempts: 0,
      averagePercentage: 0, averageGrammarScore: 4, averageIssueSpottingScore: 0,
      bySubject: count ? [{ subject: 'Civil Law', completedAttempts: count, averagePercentage: 0 }] : [],
      trend: [], byUnit: [], byTopic: [],
    },
  };
}
test('PDF summary opt-in handles zero/one/many while legacy email default remains unchanged', () => {
  for (const count of [0, 1, 2]) {
    const data = scope(count); const before = JSON.stringify(data);
    const corrected = core.analyticsSummaryLines(data, { singularCounts: true }).join('\n');
    assert.ok(corrected.includes(`${count} complete valid ${count === 1 ? 'attempt' : 'attempts'} | Average 0%`));
    if (count) assert.ok(corrected.includes(`(${count} complete ${count === 1 ? 'attempt' : 'attempts'})`));
    assert.ok(core.analyticsSummaryLines(data).join('\n').includes(`${count} complete valid attempts | Average 0%`));
    assert.equal(JSON.stringify(data), before);
  }
  // Zero is a valid formatter/empty UI case, never a valid saved export scope.
  assert.throws(() => core.buildForecastAnalyticsEmail(scope(0), OWNER), { code: 'BAR_FORECAST_ANALYTICS_INVALID' });
});
test('one/many existing v1 email text, HTML and sender-bound payload hashes remain byte-identical', () => {
  // Captured from unmodified H 3b13e4674e871e2b17ec81ebd1b816abc329e0a0.
  const pins = {
    1: ['22fab5c1cf47b1656fe0e7a5dce795f551de3d33ed3e46196a99585c720ecb15',
      'a56e15a06cd97f967b3d6082deadc5f461f4edada46678543e8c0243183a8ae1',
      'f4c49a4f1941a1984622e5deb9e93ba45b07e8acf0060d0d80362f2e0408083d'],
    2: ['26dcba1f561d6d2f81825761934a2af234ea1d3369e947f091c4a2c22acc03c6',
      '8d1ba71cccae53746dcd31578a71a8d3c51abda87ed49c76c54d532dc2a4c65e',
      '01c298ff2a1df6e5c55c32f336cffaf41bd497d50361b311f056617646b9ab06'],
  };
  for (const count of [1, 2]) {
    const data = scope(count); const before = JSON.stringify(data);
    // A prior PDF presentation must not mutate the source used for a retry.
    core.analyticsSummaryLines(data, { singularCounts: true });
    const message = core.buildForecastAnalyticsEmail(data, OWNER);
    assert.equal(hash(message.text), pins[count][0]); assert.equal(hash(message.html), pins[count][1]);
    assert.equal(hash(JSON.stringify(['forecast-analytics-email-summary-v1',
      'Due Diligence Results <support@duediligence.ph>', message.subject, message.text, message.html])), pins[count][2]);
    assert.equal(JSON.stringify(data), before);
  }
});
async function pdfCopy(data) {
  const lines = []; const pages = [];
  const page = () => ({ drawText: value => lines.push(value), drawRectangle() {}, drawLine() {} });
  const font = { widthOfTextAtSize: value => value.length, getCharacterSet: () => Array.from({ length: 128 }, (_, i) => i) };
  const pdf = { registerFontkit() {}, embedFont: async () => font,
    addPage: () => { const p = page(); pages.push(p); return p; }, getPageCount: () => pages.length };
  const sandbox = { ...core, BarForecastError, structuredClone, Uint8Array, atob: () => '',
    rgb: () => ({}), fontkit: {}, notoSansBase64: '', PDFDocument: { create: async () => pdf },
    buildForecastResultPdf: () => { throw new Error('No individual rendering allowed in copy test'); } };
  vm.runInNewContext(pdfSource.replace(/^import[\s\S]*?;\r?\n/gmu, '').replace(/^export /gmu, ''), sandbox);
  await sandbox.createForecastAnalyticsPdf({ scope: data, ownerId: OWNER });
  return lines.join('\n');
}
test('actual PDF presentation uses singular summary/trend/classifications, keeps plural counts and rejects empty scopes', async () => {
  await assert.rejects(pdfCopy(scope(0)), { code: 'BAR_FORECAST_ANALYTICS_INVALID' });
  for (const count of [1, 2]) {
    for (const trendCount of [0, 1, 2]) {
      const data = scope(count);
      data.analytics.trend = Array.from({ length: trendCount }, () => ({ percentage: 0, completedAt: data.createdAt, subject: 'Civil Law' }));
      data.analytics.byUnit = [{ subject: 'Civil Law', unit: 'Saved unit', averageScore: 0, questionSamples: count, completedAttempts: count }];
      data.analytics.byTopic = [{ subject: 'Civil Law', unitId: 'unit-1', topic: 'Saved topic', averageScore: 0, questionSamples: count, completedAttempts: count }];
      const before = JSON.stringify(data); const copy = await pdfCopy(data);
      const noun = count === 1 ? 'attempt' : 'attempts';
      assert.ok(copy.includes(`${count} complete valid ${noun} | Average 0%`));
      assert.ok(copy.includes(`Latest ${trendCount} completed ${trendCount === 1 ? 'attempt' : 'attempts'} in the saved scope`));
      assert.ok(copy.includes(`${count} graded ${count === 1 ? 'answer' : 'answers'} across ${count} complete ${noun}`));
      assert.doesNotMatch(copy, /\b1 (?:complete valid|complete|completed) attempts\b/u);
      assert.equal(JSON.stringify(data), before);
    }
  }
});
test('actual UI classification and saved-scope template handle empty/one/many without changing state', () => {
  const start = uiSource.indexOf("        for (const [heading, key, field] of [['Saved syllabus units'");
  const end = uiSource.indexOf("        const actions = element('div', 'bf26-history-filters');", start);
  assert.ok(start >= 0 && end > start);
  const source = uiSource.slice(start, end);
  for (const count of [0, 1, 2]) {
    const data = scope(count);
    if (count) {
      data.analytics.byUnit = [{ subject: 'Civil Law', unit: 'Saved unit', averageScore: 0, questionSamples: count, completedAttempts: count }];
      data.analytics.byTopic = [{ subject: 'Civil Law', unitId: 'unit-1', topic: 'Saved topic', averageScore: 0, questionSamples: count, completedAttempts: count }];
    }
    const model = { analytics: data.analytics, scope: count ? data : null }; const before = JSON.stringify(model); const lines = [];
    vm.runInNewContext(source, { model, panel: { append: value => lines.push(value) },
      element: (_tag, _class, value) => value, nullableMetric: String, forecastDate: () => 'Saved date' });
    const copy = lines.join('\n');
    if (count) {
      assert.ok(copy.includes(`${count} graded ${count === 1 ? 'answer' : 'answers'} across ${count} complete ${count === 1 ? 'attempt' : 'attempts'}`));
      assert.ok(copy.includes(`${count} complete ${count === 1 ? 'report' : 'reports'}.`));
      assert.doesNotMatch(copy, /\b1 complete (?:attempts|reports)\b/u);
    } else {
      assert.equal(lines.filter(value => value === 'No supported saved classifications in this scope.').length, 2);
      assert.doesNotMatch(copy, /Saved snapshot:|complete reports/u);
    }
    assert.equal(JSON.stringify(model), before);
  }
});
