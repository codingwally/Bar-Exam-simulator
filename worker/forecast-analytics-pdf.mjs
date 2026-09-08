import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { BarForecastError } from './bar-forecast-core.mjs';
import { buildForecastResultPdf } from './forecast-result-pdf.mjs';
import { FORECAST_ANALYTICS_VERSION, MAX_BYTES, MAX_PAGES, text, metric, manila, sizeError,
  forecastAnalyticsLink, validateForecastAnalyticsScope, validateForecastScopeAttempt,
  assertForecastAnalyticsPdfSize, analyticsSummaryLines, periodLabel } from './forecast-analytics-core.mjs';

const NAVY = rgb(0, 33 / 255, 71 / 255), GOLD = rgb(197 / 255, 160 / 255, 89 / 255), MUTED = rgb(70 / 255, 84 / 255, 104 / 255);

// Pure period assembly: one authorized canonical member at a time. No token,
// network call, model, server journal, or partially returned output.
export async function createForecastAnalyticsPdf({ scope: inputScope, ownerId, renderAttempt = buildForecastResultPdf }) {
  const scope = structuredClone(inputScope);
  validateForecastAnalyticsScope(scope, ownerId);
  let appended = 0; let busy = false; let finished = false; let failed = false;
  // Every canonical attempt is at least its cover + 20 answer pages. Refuse an
  // impossible whole report before allocating/rendering hundreds of pages.
  assertForecastAnalyticsPdfSize(scope);
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(Uint8Array.from(atob(notoSansBase64), (c) => c.charCodeAt(0)), { subset: true, features: { kern: false, mark: false, mkmk: false } });
  // Exact numeric widths only, scoped to this one document. The cap measures
  // retained UTF-16 code units, not an inaccurate byte-memory guarantee.
  const widths = new Map(); let retainedCodeUnits = 0;
  function measure(value, size) {
    const key = `${size}\0${value}`; const cached = widths.get(key);
    if (cached !== undefined) return cached;
    const result = font.widthOfTextAtSize(value, size);
    if (widths.size < 16384 && retainedCodeUnits + key.length <= 1048576) {
      widths.set(key, result); retainedCodeUnits += key.length;
    }
    return result;
  }
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
        if (measure(current ? `${current} ${word}` : word, size) <= width) { current = current ? `${current} ${word}` : word; continue; }
        if (current) draw(current); current = '';
        if (measure(word, size) <= width) { current = word; continue; }
        for (const c of word) { if (measure(current + c, size) > width && current) { draw(current); current = ''; } current += c; }
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
  async function append(attempt) {
    if (busy || finished || failed) throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The period PDF sequence is invalid.', 409);
    validateForecastScopeAttempt(scope, ownerId, attempt, appended);
    busy = true;
    try {
      const saved = await PDFDocument.load(await renderAttempt({ attempt, ownerId }));
      if (pdf.getPageCount() + saved.getPageCount() > MAX_PAGES) throw sizeError();
      for (const copy of await pdf.copyPages(saved, saved.getPageIndices())) pdf.addPage(copy);
      appended++;
      return { completedAttempts: appended, totalAttempts: scope.manifest.length, pageCount: pdf.getPageCount() };
    } catch (error) { failed = true; throw error; }
    finally { busy = false; }
  }
  async function finish() {
    if (busy || finished || failed || appended !== scope.manifest.length) {
      throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'Every saved report must be included before download.', 409);
    }
    finished = true;
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
  return Object.freeze({ append, finish });
}

export async function buildForecastAnalyticsPdf({ scope, ownerId, attempts, renderAttempt = buildForecastResultPdf }) {
  validateForecastAnalyticsScope(scope, ownerId, attempts);
  const document = await createForecastAnalyticsPdf({ scope, ownerId, renderAttempt });
  for (const attempt of attempts) await document.append(attempt);
  return document.finish();
}
