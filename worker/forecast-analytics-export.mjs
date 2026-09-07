import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { BarForecastError } from './bar-forecast-core.mjs';
import { buildForecastResultPdf, validateSavedForecastForExport, verifiedForecastEmail, forecastResultLink } from './forecast-result-export.mjs';

export const FORECAST_ANALYTICS_VERSION = 'forecast-analytics-pdf-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 400;
const NAVY = rgb(0, 33 / 255, 71 / 255), GOLD = rgb(197 / 255, 160 / 255, 89 / 255), MUTED = rgb(70 / 255, 84 / 255, 104 / 255);
const text = (value) => String(value ?? '');
const metric = (value, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Not recorded';
const manila = (value) => Number.isFinite(Date.parse(value))
  ? `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} Philippine time` : 'Not recorded';
const escapeHtml = (value) => text(value).replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sizeError = () => new BarForecastError('BAR_FORECAST_ANALYTICS_SIZE_LIMIT', 'Choose a narrower reporting period. The complete report exceeds the safe PDF limit; no attempts were omitted.', 413);

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
  if (!scope || !UUID.test(text(scope.id)) || scope.ownerId !== ownerId || !HASH.test(text(scope.scopeHash))
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

function periodLabel(scope) {
  return `${scope.filter.from ? manila(scope.filter.from) : 'First saved result'} to ${scope.filter.to ? `${manila(scope.filter.to)} (exclusive)` : 'Snapshot time'}`;
}
function analyticsSummaryLines(scope) {
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
  const manifest = scope.manifest.map((row) => `${row.subject} | ${manila(row.completedAt)} | ${row.summary.totalScore} / 100 | revision ${row.resultRevision}\n${forecastResultLink(row.attemptId)}`);
  return {
    subject: 'Your saved Due Diligence Forecast analytics',
    text: ['DUE DILIGENCE | Bar Forecast analytics', ...lines, '', `Open this exact saved scope: ${link}`,
      'The PDF includes this summary and every complete canonical report in the saved scope. No new grading was performed.',
      'Sign in to the owning account. Current Forecast access is required.', '', 'INCLUDED REPORTS', ...manifest,
      '', 'Educational practice record, not an official Bar grade or prediction.'].join('\n'),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f2e9;color:#002147;font-family:Arial,sans-serif;line-height:1.5"><table role="presentation" width="100%"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" style="max-width:640px;background:#fffdf8;border:1px solid #d6c59f;border-top:4px solid #c5a059"><tr><td style="padding:24px;background:#002147;color:white"><img src="https://duediligence.ph/assets/brand/logo1-master.png" alt="Due Diligence" width="56"><h1 style="font:700 26px Georgia,serif">DUE DILIGENCE</h1><p>Bar Forecast / Saved analytics</p></td></tr><tr><td style="padding:24px;overflow-wrap:anywhere"><h2 style="font:700 28px Georgia,serif">${metric(scope.analytics.averagePercentage, '%')} average</h2><p>${scope.analytics.completedAttempts} complete valid attempts</p>${lines.map((line) => `<p style="font-size:14px">${escapeHtml(line)}</p>`).join('')}<p><a href="${link}" style="display:inline-block;padding:14px 20px;background:#002147;color:white;border:1px solid #c5a059;text-decoration:none">Open saved analytics</a></p><p style="font-size:13px">Your PDF includes every complete report in this saved scope. No new grading was performed. Sign in to the owning account; current Forecast access is required.</p><p style="font-size:12px">Educational practice record, not an official Bar grade or prediction.</p></td></tr></table></td></tr></table></body></html>`,
    link,
  };
}

export async function buildForecastAnalyticsPdf({ scope, ownerId, attempts, renderAttempt = buildForecastResultPdf }) {
  validateForecastAnalyticsScope(scope, ownerId, attempts);
  // Every canonical attempt is at least its cover + 20 answer pages. Refuse an
  // impossible whole report before allocating/rendering hundreds of pages.
  if (attempts.length * 21 + 1 > MAX_PAGES) throw sizeError();
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(Uint8Array.from(atob(notoSansBase64), (c) => c.charCodeAt(0)), { subset: true });
  const supported = new Set(font.getCharacterSet()); const width = 499.28; const margin = 48;
  let page; let y;
  function newPage() {
    if (pdf.getPageCount() >= MAX_PAGES) throw sizeError();
    page = pdf.addPage([595.28, 841.89]); y = 744;
    page.drawRectangle({ x: 0, y: 833.89, width: 595.28, height: 8, color: NAVY });
    page.drawText('DUE DILIGENCE', { x: margin, y: 802, size: 14, font, color: NAVY });
    page.drawText('BAR FORECAST / SAVED ANALYTICS', { x: margin, y: 781, size: 8, font, color: GOLD });
  }
  function line(value, size = 10, color = MUTED) {
    const source = text(value);
    if (Array.from(source).some((c) => !/\s/u.test(c) && !supported.has(c.codePointAt(0)))) throw new BarForecastError('BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE', 'This report contains a character the PDF font cannot safely display. Your saved scope remains available online.', 422);
    // Character-aware wrapping also handles long URLs, words and references.
    for (const paragraph of source.split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        if (font.widthOfTextAtSize(current ? `${current} ${word}` : word, size) <= width) { current = current ? `${current} ${word}` : word; continue; }
        if (current) draw(current); current = '';
        for (const c of word) { if (font.widthOfTextAtSize(current + c, size) > width && current) { draw(current); current = ''; } current += c; }
      }
      draw(current);
    }
    y -= 7;
    function draw(value) { if (!page || y < 72) newPage(); if (value) page.drawText(value, { x: margin, y, size, font, color }); y -= size + 5; }
  }
  newPage();
  line('YOUR SAVED ANALYTICS', 23, NAVY);
  line(`${metric(scope.analytics.averagePercentage, '%')} average / ${scope.analytics.completedAttempts} completed ${scope.analytics.completedAttempts === 1 ? 'attempt' : 'attempts'}`, 17, NAVY);
  const cards = [['GRADE AVERAGE', scope.analytics.averagePercentage, 100], ['GRAMMAR / DIAGNOSTIC', scope.analytics.averageGrammarScore, 5], ['ISSUE SPOTTING / DIAGNOSTIC', scope.analytics.averageIssueSpottingScore, 5]];
  cards.forEach(([label, value, max], index) => {
    const x = margin + index * 169; const w = 155;
    page.drawRectangle({ x, y: y - 65, width: w, height: 66, color: rgb(0.966, 0.95, 0.915), borderColor: GOLD, borderWidth: 0.4 });
    page.drawText(label, { x: x + 9, y: y - 14, size: 6.4, font, color: NAVY });
    page.drawText(metric(value, max === 100 ? '%' : ' / 5'), { x: x + 9, y: y - 39, size: 19, font, color: NAVY });
    page.drawRectangle({ x: x + 9, y: y - 54, width: w - 18, height: 4, color: rgb(0.85, 0.86, 0.87) });
    if (typeof value === 'number' && value > 0) page.drawRectangle({ x: x + 9, y: y - 54, width: (w - 18) * value / max, height: 4, color: index === 0 ? NAVY : GOLD });
  });
  y -= 85;
  for (const item of analyticsSummaryLines(scope)) line(item);
  line('SCORE TREND', 12, GOLD);
  line(`Latest ${scope.analytics.trend.length} completed attempts in the saved scope, oldest to newest. Full-scope averages above are not limited to this trend.`);
  if (scope.analytics.trend.length >= 2) {
    if (y < 225) newPage();
    const plotted = scope.analytics.trend.slice(-12); const step = width / plotted.length; const base = y - 105;
    page.drawLine({ start: { x: margin, y: base }, end: { x: margin + width, y: base }, thickness: 0.5, color: MUTED });
    plotted.forEach((row, index) => {
      const x = margin + step * index + 5; const h = row.percentage * 0.8;
      if (h > 0) page.drawRectangle({ x, y: base, width: step - 10, height: h, color: NAVY });
      page.drawText(`${row.percentage}%`, { x, y: base + h + 7, size: 7, font, color: NAVY });
      page.drawText(String(index + 1), { x, y: base - 13, size: 7, font, color: MUTED });
    });
    y = base - 30; line(`Chart: latest ${plotted.length} saved results, left to right. Exact dates and scores follow.`, 8);
  } else line('More completed attempts are needed for a score trend.', 9);
  for (const row of scope.analytics.trend) line(`${manila(row.completedAt)} | ${row.subject} | ${row.percentage}%`, 9);
  for (const [label, key, field] of [['SYLLABUS UNITS', 'byUnit', 'unit'], ['SAVED TOPICS', 'byTopic', 'topic']]) {
    line(label, 12, GOLD);
    const rows = scope.analytics[key];
    if (!Array.isArray(rows) || !rows.length) line('No supported saved classifications are available for this scope.');
    else for (const row of rows) line(`${row.subject} / ${field === 'topic' ? `${row.unitId} / ` : ''}${row[field]}: ${metric(row.averageScore, ' / 5')} (${row.questionSamples} graded answers across ${row.completedAttempts} complete attempts)`, 9);
  }
  const coverage = scope.analytics.classificationCoverage;
  if (coverage) line(`Unknown unit classification: ${coverage.unitUnknownQuestions} answers. Unknown topic classification: ${coverage.topicUnknownQuestions} answers. Unit and topic views overlap; they are not added together.`);
  line('INCLUDED COMPLETE REPORTS', 12, GOLD);
  for (const row of scope.manifest) {
    line(`${row.subject} | ${manila(row.completedAt)} | ${row.summary.totalScore} / 100`, 9);
    line(`Attempt ${row.attemptId} / revision ${row.resultRevision}`, 8);
  }
  line(`Snapshot ${scope.id}\n${forecastAnalyticsLink(scope.id)}\nThe complete canonical reports follow, in the order above. Sign in to the owning account to reopen them.`, 8);
  for (const attempt of attempts) {
    const saved = await PDFDocument.load(await renderAttempt({ attempt, ownerId }));
    if (pdf.getPageCount() + saved.getPageCount() > MAX_PAGES) throw sizeError();
    for (const copy of await pdf.copyPages(saved, saved.getPageIndices())) pdf.addPage(copy);
  }
  // Keep each canonical report's existing footer; the scope has a separate,
  // uniform outer page index so a reader can navigate the combined document.
  pdf.getPages().forEach((entry, index) => {
    entry.drawText(`Scope page ${index + 1} / ${pdf.getPageCount()}`, { x: margin, y: 10, size: 6, font, color: MUTED });
  });
  pdf.setTitle('Due Diligence - Saved Forecast Analytics'); pdf.setAuthor('Due Diligence');
  pdf.setProducer(`Due Diligence ${FORECAST_ANALYTICS_VERSION}`); pdf.setSubject(scope.filter.subject || 'All Forecast subjects');
  pdf.setCreationDate(new Date(scope.createdAt)); pdf.setModificationDate(new Date(scope.createdAt));
  const bytes = await pdf.save({ useObjectStreams: true });
  if (!bytes.length || bytes.length > MAX_BYTES) throw sizeError();
  return bytes;
}

export function createForecastAnalyticsExporter({ rpc, sendEmail, assertEmailAvailable = () => {}, resolveVerifiedUser = async (_env, user) => user, renderPdf = buildForecastAnalyticsPdf }) {
  async function call(env, name, args) {
    let value;
    try { value = await rpc(env, name, args); } catch { throw new BarForecastError('BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE', 'Your saved analytics export could not be reached. Please retry the same request.', 503); }
    if (!value || value.ok === false) throw new BarForecastError(value?.error?.code || 'BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE', value?.error?.message || 'The saved export is unavailable.', value?.error?.status || 503);
    return value;
  }
  async function snapshot(env, user, input) {
    const value = await call(env, 'dd2026_forecast_analytics_snapshot', { p_actor_user_id: user.id, p_request_id: input.requestId,
      p_subject: input.subject || null, p_from: input.from || null, p_to: input.to || null });
    validateForecastAnalyticsScope(value.scope, user.id); return value;
  }
  async function get(env, user, scopeId, withAnswers = false) {
    const value = await call(env, 'dd2026_forecast_analytics_get', { p_actor_user_id: user.id, p_scope_id: scopeId, p_with_answers: withAnswers });
    validateForecastAnalyticsScope(value.scope, user.id, withAnswers ? value.attempts : null); return value;
  }
  async function pdf(env, user, scopeId, download = true) {
    const metadata = await get(env, user, scopeId, false);
    // Bound the manifest before hydrating potentially large private answers.
    if (metadata.scope.manifest.length * 21 + 1 > MAX_PAGES) throw sizeError();
    const saved = await get(env, user, scopeId, true);
    const bytes = await renderPdf({ scope: saved.scope, attempts: saved.attempts, ownerId: user.id });
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) throw sizeError();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fileName = forecastAnalyticsFileName(scopeId);
    await call(env, 'dd2026_forecast_analytics_pdf_record', { p_actor_user_id: user.id, p_scope_id: scopeId,
      p_pdf_hash: hash, p_file_name: fileName, p_byte_count: bytes.length, p_download: download });
    return { bytes, hash, fileName, scope: saved.scope };
  }
  async function email(env, user, scopeId) {
    if (typeof sendEmail !== 'function') throw new BarForecastError('BAR_FORECAST_EMAIL_UNAVAILABLE', 'Report email is not available. Download the PDF instead.', 503);
    await assertEmailAvailable(env);
    const current = await resolveVerifiedUser(env, user);
    if (current?.id !== user.id) throw new BarForecastError('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED', 'Verify your account email before emailing this report.', 409);
    const recipient = verifiedForecastEmail(current);
    const saved = await pdf(env, user, scopeId, false);
    const presentation = buildForecastAnalyticsEmail(saved.scope, user.id);
    const claim = await call(env, 'dd2026_forecast_analytics_email_claim', { p_actor_user_id: user.id, p_scope_id: scopeId, p_recipient_email: recipient, p_pdf_hash: saved.hash });
    if (!claim.claimed) return { ok: true, email: claim.email, message: emailMessage(claim.email.status) };
    let status = 'uncertain'; let providerId = null;
    try {
      const sent = await sendEmail(env, { to: recipient, ...presentation, attachment: { filename: saved.fileName, contentType: 'application/pdf', bytes: saved.bytes, sha256: saved.hash }, idempotencyKey: claim.idempotencyKey });
      if (sent?.accepted === true && typeof sent.providerMessageId === 'string' && sent.providerMessageId) { status = 'provider_accepted'; providerId = sent.providerMessageId; }
      else if (sent?.definitelyNotAccepted === true) status = 'failed';
    } catch (error) { if (error?.definitelyNotAccepted === true) status = 'failed'; }
    const args = { p_actor_user_id: user.id, p_scope_id: scopeId, p_lease_token: claim.leaseToken, p_status: status, p_provider_id: providerId };
    let settled;
    try { settled = await call(env, 'dd2026_forecast_analytics_email_settle', args); }
    catch {
      try { settled = await call(env, 'dd2026_forecast_analytics_email_settle', args); }
      catch { return { ok: true, email: { status: 'uncertain', alreadyRequested: true, retryAllowed: false }, message: emailMessage('uncertain') }; }
    }
    return { ok: true, email: settled.email, message: emailMessage(settled.email.status) };
  }
  return Object.freeze({ snapshot, get, pdf, email });
}

function emailMessage(status) {
  if (status === 'provider_accepted') return 'The email provider accepted your saved analytics. Delivery is not yet confirmed.';
  if (status === 'processing') return 'Your saved analytics email is already being processed.';
  if (status === 'failed') return 'The email provider did not accept the request. Your saved PDF remains available.';
  return 'Email acceptance could not be confirmed. Your saved PDF remains available; avoid repeated requests.';
}
