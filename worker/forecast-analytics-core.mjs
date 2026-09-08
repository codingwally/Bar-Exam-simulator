import { BarForecastError } from './bar-forecast-core.mjs';
import { validateSavedForecastForExport } from './forecast-result-pdf.mjs';

// Shared, immutable scope validation and bounded summary copy. No provider,
// transport, account token, private grading rubric or persistent browser state.
export const FORECAST_ANALYTICS_EMAIL_VERSION = 'forecast-analytics-email-summary-v1';
export const FORECAST_ANALYTICS_VERSION = 'forecast-analytics-pdf-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 400;
export const text = (value) => String(value ?? '');
export const metric = (value, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Not recorded';
export const manila = (value) => Number.isFinite(Date.parse(value))
  ? `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} Philippine time` : 'Not recorded';
const escapeHtml = (value) => text(value).replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sizeError = () => new BarForecastError('BAR_FORECAST_ANALYTICS_SIZE_LIMIT', 'Choose a narrower reporting period. The complete report exceeds the safe PDF limit; no attempts were omitted.', 413);

export function forecastAnalyticsLink(id) {
  if (!UUID.test(text(id))) throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The saved reporting scope is invalid.', 409);
  return `https://duediligence.ph/?forecastAnalytics=${id.toLowerCase()}#verdict`;
}
export function forecastAnalyticsFileName(id) {
  forecastAnalyticsLink(id);
  return `duediligence-forecast-analytics-${id.toLowerCase()}-v1.pdf`;
}
export function validateForecastAnalyticsScope(scope, ownerId, attempts = null) {
  const invalid = () => { throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The saved reporting scope could not be verified. No scores were substituted.', 409); };
  const bounded = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  if (!scope || !UUID.test(text(ownerId)) || !UUID.test(text(scope.id)) || scope.ownerId !== ownerId || !HASH.test(text(scope.scopeHash))
      || scope.schemaVersion !== 'forecast-analytics-scope-v1' || scope.templateVersion !== FORECAST_ANALYTICS_VERSION
      || !Number.isFinite(Date.parse(scope.createdAt)) || scope.filter?.completeOnly !== true || scope.filter.timeZone !== 'Asia/Manila'
      || !Array.isArray(scope.manifest) || !scope.manifest.length || scope.manifest.length > 1000
      || scope.analytics?.completeOnly !== true || scope.analytics.completedAttempts !== scope.manifest.length
      || !Array.isArray(scope.analytics.bySubject) || !Array.isArray(scope.analytics.trend)
      || new Set(scope.manifest.map((row) => row.attemptId)).size !== scope.manifest.length) invalid();
  if (!bounded(scope.analytics.averagePercentage, 100)
      || (scope.analytics.averageGrammarScore !== null && !bounded(scope.analytics.averageGrammarScore, 5))
      || (scope.analytics.averageIssueSpottingScore !== null && !bounded(scope.analytics.averageIssueSpottingScore, 5))
      || scope.analytics.bySubject.some((row) => !Number.isSafeInteger(row.completedAttempts) || row.completedAttempts < 1 || !bounded(row.averagePercentage, 100))
      || scope.analytics.bySubject.reduce((count, row) => count + row.completedAttempts, 0) !== scope.manifest.length
      || scope.analytics.trend.some((row) => !bounded(row.percentage, 100) || !Number.isFinite(Date.parse(row.completedAt)))) invalid();
  for (const row of scope.manifest) {
    if (!UUID.test(text(row.attemptId)) || row.resultRevision !== 1 || !HASH.test(text(row.resultHash))
        || !Number.isFinite(Date.parse(row.completedAt)) || !row.subject
        || typeof row.summary?.percentage !== 'number' || row.summary.percentage < 0 || row.summary.percentage > 100
        || row.summary.totalScore !== row.summary.percentage || row.summary.maxScore !== 100) invalid();
  }
  // Validate canonical integrity; never replace the SQL aggregate with a locally
  // calculated average. SQL already verified each frozen result fingerprint.
  if (attempts !== null) {
    if (!Array.isArray(attempts) || attempts.length !== scope.manifest.length) invalid();
    attempts.forEach((attempt, index) => {
      const row = scope.manifest[index]; const result = validateSavedForecastForExport(attempt, ownerId);
      if (attempt.id !== row.attemptId || attempt.resultRevision !== row.resultRevision || attempt.subject !== row.subject
          || Date.parse(attempt.completedAt) !== Date.parse(row.completedAt)
          || result.totalScore !== row.summary.totalScore || result.percentage !== row.summary.percentage) invalid();
    });
  }
  return scope;
}

export function periodLabel(scope) {
  return `${scope.filter.from ? manila(scope.filter.from) : 'First saved result'} to ${scope.filter.to ? `${manila(scope.filter.to)} (exclusive)` : 'Snapshot time'}`;
}
export function analyticsSummaryLines(scope) {
  const a = scope.analytics;
  const lines = [
    `Subject: ${scope.filter.subject || 'All subjects'}`, `Period: ${periodLabel(scope)}`,
    `Saved snapshot: ${manila(scope.createdAt)}`,
    `${a.completedAttempts} complete valid attempts | Average ${metric(a.averagePercentage, '%')}`,
    `Grammar ${metric(a.averageGrammarScore, ' / 5')} | Issue spotting ${metric(a.averageIssueSpottingScore, ' / 5')}`,
    'Grammar and issue spotting are separate diagnostics, not additions to the grade.',
    `${a.pendingAttempts} pending and ${a.failedAttempts} needing attention are excluded from grades.`,
    'Active writing time was not recorded. No writing-speed metric is estimated.',
  ];
  for (const row of a.bySubject) lines.push(`${row.subject}: ${metric(row.averagePercentage, '%')} (${row.completedAttempts} complete attempts)`);
  return lines;
}

export function buildForecastAnalyticsEmail(scope, ownerId) {
  validateForecastAnalyticsScope(scope, ownerId);
  const link = forecastAnalyticsLink(scope.id);
  const lines = analyticsSummaryLines(scope);
  return {
    subject: 'Your saved Due Diligence Forecast analytics',
    text: ['DUE DILIGENCE | Bar Forecast analytics', ...lines, '', `Open this exact saved scope: ${link}`,
      'Open the exact saved scope above to review every included result and download its complete period PDF. No new grading was performed.',
      'Sign in to the owning account. Current Forecast access is required.',
      '', 'Educational practice record, not an official Bar grade or prediction.'].join('\n'),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f2e9;color:#002147;font-family:Arial,sans-serif;line-height:1.5"><table role="presentation" width="100%"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" style="max-width:640px;background:#fffdf8;border:1px solid #d6c59f;border-top:4px solid #c5a059"><tr><td style="padding:24px;background:#002147;color:white"><img src="https://duediligence.ph/assets/brand/logo1-master.png" alt="Due Diligence" width="56"><h1 style="font:700 26px Georgia,serif">DUE DILIGENCE</h1><p>Bar Forecast / Saved analytics</p></td></tr><tr><td style="padding:24px;overflow-wrap:anywhere"><h2 style="font:700 28px Georgia,serif">${metric(scope.analytics.averagePercentage, '%')} average</h2><p>${scope.analytics.completedAttempts} complete valid attempts</p>${lines.map((line) => `<p style="font-size:14px">${escapeHtml(line)}</p>`).join('')}<p><a href="${link}" style="display:inline-block;padding:14px 20px;background:#002147;color:white;border:1px solid #c5a059;text-decoration:none">Open saved analytics</a></p><p style="font-size:13px">Open the saved scope to review all included reports and download the period PDF. No PDF is attached. No new grading was performed. Sign in to the owning account; current Forecast access is required.</p><p style="font-size:12px">Educational practice record, not an official Bar grade or prediction.</p></td></tr></table></td></tr></table></body></html>`,
    link,
  };
}


export function assertForecastAnalyticsPdfSize(scope) {
  if (scope.manifest.length * 21 + 1 > MAX_PAGES) throw sizeError();
}
export function validateForecastScopeAttempt(scope, ownerId, attempt, index) {
  validateForecastAnalyticsScope(scope, ownerId);
  const row = scope.manifest[index];
  const result = validateSavedForecastForExport(attempt, ownerId);
  if (!Number.isSafeInteger(index) || index < 0 || !row
      || attempt.id !== row.attemptId || attempt.resultRevision !== row.resultRevision
      || attempt.subject !== row.subject || Date.parse(attempt.completedAt) !== Date.parse(row.completedAt)
      || result.totalScore !== row.summary.totalScore || result.percentage !== row.summary.percentage) {
    throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The saved scope member could not be verified.', 409);
  }
  return result;
}
