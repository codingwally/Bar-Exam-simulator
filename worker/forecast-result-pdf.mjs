import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { aggregateBarForecastScores, BarForecastError } from './bar-forecast-core.mjs';

export const FORECAST_PDF_VERSION = 'forecast-pdf-v1';
const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const NAVY = rgb(0, 33 / 255, 71 / 255);
const GOLD = rgb(197 / 255, 160 / 255, 89 / 255);
const SLATE = rgb(51 / 255, 65 / 255, 85 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const RULE = rgb(226 / 255, 232 / 255, 240 / 255);
const WHITE = rgb(1, 1, 1);
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const safeText = (value) => String(value ?? '').replace(/\r\n?/gu, '\n');
const validScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5
  && Math.abs(value * 10 - Math.round(value * 10)) <= 1e-9;
const manilaTime = (value) => `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} Philippine time`;

export function validateSavedForecastForExport(attempt, ownerId) {
  const result = attempt?.result;
  if (attempt?.status !== 'complete' || !result || result.complete !== true || result.attemptId !== attempt.id
      || result.ownerId !== ownerId || result.resultRevision !== attempt.resultRevision
      || result.resultRevision !== 1 || result.schemaVersion !== 'forecast-attempt-v1'
      || result.subject !== attempt.subject || result.setId !== attempt.setId
      || result.questionCount !== 20 || result.completedQuestionCount !== 20
      || !Array.isArray(result.results) || result.results.length !== 20
      || !Array.isArray(attempt.answers) || attempt.answers.length !== 20
      || !Array.isArray(attempt.questions) || attempt.questions.length !== 20
      || !Number.isFinite(Date.parse(attempt.completedAt))) {
    throw new BarForecastError('BAR_FORECAST_EXPORT_NOT_READY', 'Only a complete saved Forecast can be exported.', 409);
  }
  const answers = new Map(attempt.answers.map((row) => [row.questionId, row.answer]));
  const questions = new Map(attempt.questions.map((row) => [row.id, row.prompt]));
  if (new Set(result.results.map((row) => row.questionId)).size !== 20 || result.results.some((row, index) => (
    row.number !== index + 1 || row.maxScore !== 5 || !validScore(row.score)
    || !validScore(row.grammar?.score) || !validScore(row.issueSpotting?.score)
    || row.userAnswer !== answers.get(row.questionId) || row.question !== questions.get(row.questionId)
    || !row.suggestedAnswer || !row.mockBarCoaching || !Array.isArray(row.grammar.corrections)
    || !Array.isArray(row.issueSpotting.identified) || !Array.isArray(row.issueSpotting.missed)
  )) || aggregateBarForecastScores(result.results.map((row) => row.score)).total !== result.totalScore
      || result.maxScore !== 100 || result.percentage !== result.totalScore
      || aggregateBarForecastScores(result.results.map((row) => row.score)).average !== result.analytics?.averageScore
      || aggregateBarForecastScores(result.results.map((row) => row.grammar.score)).average !== result.analytics?.grammarAverage
      || aggregateBarForecastScores(result.results.map((row) => row.issueSpotting.score)).average !== result.analytics?.issueSpottingAverage) {
    throw new BarForecastError('BAR_FORECAST_EXPORT_INVALID', 'The saved report failed its completeness check.', 409);
  }
  return result;
}

export function forecastResultPdfFileName(attempt) {
  return `duediligence-forecast-${String(attempt.id).replace(/[^a-f0-9-]/giu, '')}-r${attempt.resultRevision}.pdf`;
}

// The embedded, pinned Noto font and character-aware wrapping follow the
// reviewed verdict-pdf renderer. Forecast does not invoke its legacy workflows.
function createForecastPdfWidthMeasurer(font) {
  // Numeric measurements only, owned by this render; never retain report text
  // across requests. Saturation falls back to the same exact font measurement.
  const widths = new Map();
  let cachedCharacters = 0;
  return (text, size) => {
    const key = `${size}:${text}`;
    if (widths.has(key)) return widths.get(key);
    const measured = font.widthOfTextAtSize(text, size);
    if (widths.size < 16_384 && cachedCharacters + key.length <= 1_048_576) {
      widths.set(key, measured);
      cachedCharacters += key.length;
    }
    return measured;
  };
}

export async function buildForecastResultPdf({ attempt, ownerId }) {
  const result = validateSavedForecastForExport(attempt, ownerId);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = Uint8Array.from(atob(notoSansBase64), (character) => character.charCodeAt(0));
  // pdf-lib consumes glyph IDs/advance widths, not GPOS positions. These three
  // pinned-font positioning tags are absent from GSUB; keep all substitutions,
  // the font and subset unchanged. fontkit mutates features: use a fresh object.
  const font = await pdf.embedFont(fontBytes, { subset: true, features: { kern: false, mark: false, mkmk: false } });
  const measureWidth = createForecastPdfWidthMeasurer(font);
  const supported = new Set(font.getCharacterSet());
  const checkedText = (value) => {
    const text = safeText(value);
    if (Array.from(text).some((character) => !/\s/u.test(character) && !supported.has(character.codePointAt(0)))) {
      throw new BarForecastError('BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE', 'This report contains a character the PDF font cannot display safely. Your saved report remains available online.', 422);
    }
    return text;
  };
  const width = PAGE.width - PAGE.margin * 2;
  const pages = [];
  let page; let cursor;
  function newPage() {
    if (pages.length >= 400) throw new BarForecastError('BAR_FORECAST_PDF_SIZE_LIMIT', 'This report is too large to export safely. Your saved report remains available online.', 413);
    page = pdf.addPage([PAGE.width, PAGE.height]); pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE.height - 8, width: PAGE.width, height: 8, color: NAVY });
    page.drawText('DUE DILIGENCE', { x: PAGE.margin, y: PAGE.height - 42, size: 14, font, color: NAVY });
    page.drawText('BAR FORECAST / SAVED COACHING REPORT', { x: PAGE.margin, y: PAGE.height - 58, size: 8, font, color: GOLD });
    page.drawLine({ start: { x: PAGE.margin, y: PAGE.height - 70 }, end: { x: PAGE.width - PAGE.margin, y: PAGE.height - 70 }, color: RULE, thickness: 0.8 });
    cursor = PAGE.height - 94;
  }
  function ensure(height) { if (!page || cursor - height < 68) newPage(); }
  function wrap(value, size) {
    return checkedText(value).split('\n').flatMap((paragraph) => {
      const lines = []; let line = '';
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        if (measureWidth(line ? `${line} ${word}` : word, size) <= width) { line = line ? `${line} ${word}` : word; continue; }
        if (line) lines.push(line); line = '';
        if (measureWidth(word, size) <= width) { line = word; continue; }
        for (const character of Array.from(word)) {
          if (measureWidth(line + character, size) > width && line) { lines.push(line); line = ''; }
          line += character;
        }
      }
      lines.push(line); return lines;
    });
  }
  function body(value, { size = 10, lineHeight = 15, color = SLATE, gap = 8 } = {}) {
    for (const line of wrap(value || 'Not recorded.', size)) {
      ensure(lineHeight); if (line) page.drawText(line, { x: PAGE.margin, y: cursor, size, font, color }); cursor -= lineHeight;
    }
    cursor -= gap;
  }
  function heading(value) { ensure(43); body(value, { size: 10, lineHeight: 15, color: GOLD, gap: 3 }); }
  function block(label, value) { heading(label); body(value); }
  newPage();
  body('YOUR FORECAST REPORT', { size: 24, lineHeight: 31, color: NAVY, gap: 10 });
  body(attempt.subject, { size: 16, lineHeight: 23, color: NAVY, gap: 12 });
  body(`Completed ${manilaTime(attempt.completedAt)}\n20 of 20 answers assessed`, { size: 9, lineHeight: 14, color: MUTED, gap: 16 });
  const metrics = [
    ['OVERALL', `${result.totalScore} / 100`, result.percentage / 100],
    ['GRAMMAR', `${result.analytics.grammarAverage} / 5`, result.analytics.grammarAverage / 5],
    ['ISSUE SPOTTING', `${result.analytics.issueSpottingAverage} / 5`, result.analytics.issueSpottingAverage / 5],
  ];
  const cell = (width - 24) / 3;
  for (const [index, [label, value, fraction]] of metrics.entries()) {
    const x = PAGE.margin + index * (cell + 12);
    page.drawRectangle({ x, y: cursor - 84, width: cell, height: 84, color: NAVY });
    page.drawText(label, { x: x + 12, y: cursor - 19, size: 8, font, color: GOLD });
    page.drawText(value, { x: x + 12, y: cursor - 48, size: 19, font, color: WHITE });
    page.drawRectangle({ x: x + 12, y: cursor - 66, width: cell - 24, height: 4, color: SLATE });
    page.drawRectangle({ x: x + 12, y: cursor - 66, width: (cell - 24) * fraction, height: 4, color: GOLD });
  }
  cursor -= 115;
  heading('QUESTION SCORES / OUT OF 5');
  const barWidth = width / 20;
  for (const [index, row] of result.results.entries()) {
    const x = PAGE.margin + index * barWidth;
    page.drawRectangle({ x: x + 4, y: cursor - 92, width: barWidth - 8, height: 80, color: RULE });
    page.drawRectangle({ x: x + 4, y: cursor - 92, width: barWidth - 8, height: 80 * row.score / 5, color: NAVY });
    page.drawText(String(row.number), { x: x + 5, y: cursor - 106, size: 7, font, color: MUTED });
  }
  cursor -= 137;
  body('Grammar and issue spotting are supporting diagnostics. They do not replace or add to the saved overall legal-analysis score.', { size: 9, lineHeight: 14, color: MUTED });
  body(`Attempt ${attempt.id}\nResult revision ${result.resultRevision} / ${result.schemaVersion}\nContent ${result.contentVersion} / ${result.rubricVersion}\nPDF ${FORECAST_PDF_VERSION}`, { size: 8, lineHeight: 13, color: MUTED });
  for (const row of result.results) {
    newPage();
    body(`QUESTION ${row.number} / ${row.score} OF 5`, { size: 18, lineHeight: 25, color: NAVY, gap: 12 });
    block('Question', row.question);
    block('Your saved answer', row.userAnswer);
    block('Curated suggested answer', row.suggestedAnswer);
    block('Assessment', [row.feedback, row.explanation].filter(Boolean).join('\n\n'));
    block('Mock bar coaching', [
      `Strength: ${row.mockBarCoaching.strength}`,
      `Priority improvement: ${row.mockBarCoaching.priorityImprovement}`,
      `Next step: ${row.mockBarCoaching.nextStep}`,
    ].join('\n'));
    block(`Grammar / ${row.grammar.score} of 5`, row.grammar.corrections.length ? row.grammar.corrections.map((item) => [
      `Excerpt: ${item.original}`, item.category ? `Focus: ${item.category.replace(/_/gu, ' ')}` : '', item.suggestion || item.guidance || '',
    ].filter(Boolean).join('\n')).join('\n\n') : 'No specific correction was recorded.');
    block(`Issue spotting / ${row.issueSpotting.score} of 5`, [
      `Identified: ${row.issueSpotting.identified.length ? row.issueSpotting.identified.join('; ') : 'No specific excerpt was recorded.'}`,
      `Missed: ${row.issueSpotting.missed.length ? row.issueSpotting.missed.join('; ') : 'No specific excerpt was recorded.'}`,
      row.issueSpotting.coaching,
    ].filter(Boolean).join('\n'));
    block('Curated legal basis and authority', [row.legalBasis, row.jurisprudence, row.citation].filter(Boolean).join('\n'));
  }
  pages.forEach((entry, index) => {
    entry.drawLine({ start: { x: PAGE.margin, y: 52 }, end: { x: PAGE.width - PAGE.margin, y: 52 }, color: RULE, thickness: 0.6 });
    entry.drawText('Personal study copy. Educational AI assessment; verify legal authorities independently.', { x: PAGE.margin, y: 38, size: 6.6, font, color: MUTED });
    entry.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 42, y: 23, size: 7, font, color: NAVY });
    entry.drawText(`${attempt.id} / r${result.resultRevision}`, { x: PAGE.margin, y: 23, size: 6.5, font, color: MUTED });
  });
  pdf.setTitle('Due Diligence - Saved Forecast Report'); pdf.setAuthor('Due Diligence');
  pdf.setSubject(attempt.subject); pdf.setProducer(`Due Diligence ${FORECAST_PDF_VERSION}`);
  pdf.setCreationDate(new Date(attempt.completedAt)); pdf.setModificationDate(new Date(attempt.completedAt));
  const bytes = await pdf.save({ useObjectStreams: true });
  if (!bytes.length || bytes.length > PDF_MAX_BYTES) throw new BarForecastError('BAR_FORECAST_PDF_SIZE_LIMIT', 'This report is too large to export safely.', 413);
  return bytes;
}
