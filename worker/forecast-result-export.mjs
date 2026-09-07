import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { aggregateBarForecastScores, BarForecastError } from './bar-forecast-core.mjs';

export const FORECAST_PDF_VERSION = 'forecast-pdf-v1';
export const FORECAST_RESULT_EXPORT_RPC_NAMES = Object.freeze([
  'dd2026_forecast_result_pdf_record', 'dd2026_forecast_result_email_claim', 'dd2026_forecast_result_email_settle',
  'dd2026_forecast_analytics_snapshot', 'dd2026_forecast_analytics_get', 'dd2026_forecast_analytics_pdf_record',
  'dd2026_forecast_analytics_email_claim', 'dd2026_forecast_analytics_email_settle', 'dd2026_forecast_analytics_history',
]);
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

export function forecastResultLink(attemptId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(String(attemptId))) {
    throw new BarForecastError('BAR_FORECAST_EXPORT_INVALID', 'The saved report identity is invalid.', 409);
  }
  // A fixed origin prevents request/configuration input becoming an email redirect.
  return `https://duediligence.ph/?forecastAttempt=${String(attemptId).toLowerCase()}#bar-forecast-2026`;
}

const escapeEmailHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export function buildForecastResultEmail(attempt, ownerId) {
  const result = validateSavedForecastForExport(attempt, ownerId);
  const link = forecastResultLink(attempt.id);
  const bands = result.analytics.performanceBands;
  if (!bands || ['strong', 'developing', 'needsFocus'].some((key) => !Number.isInteger(bands[key]) || bands[key] < 0 || bands[key] > 20)
      || bands.strong + bands.developing + bands.needsFocus !== 20) {
    throw new BarForecastError('BAR_FORECAST_EXPORT_INVALID', 'The saved report summary is invalid.', 409);
  }
  const completed = manilaTime(attempt.completedAt);
  const score = `${result.totalScore} / ${result.maxScore}`;
  const summary = `${bands.strong} strong · ${bands.developing} developing · ${bands.needsFocus} need focus`;
  const text = [
    'DUE DILIGENCE | Bar Forecast', attempt.subject,
    `Practice score: ${score} (${result.percentage}%)`, `20 answers assessed. ${summary}.`,
    '', 'WRITING DIAGNOSTICS — separate from the practice score',
    `Grammar: ${result.analytics.grammarAverage} / 5`, `Issue spotting: ${result.analytics.issueSpottingAverage} / 5`,
    'These diagnostics do not change your practice score.', '',
    `Completed: ${completed}`, `Attempt: ${attempt.id} · Revision ${attempt.resultRevision}`,
    '', `Open this saved report: ${link}`, 'Sign in to the account that owns this report. Current Forecast access is required.',
    'Your complete PDF is attached. This is the same saved assessment; no new grading was performed.',
    'Educational practice diagnostic only—not an official Bar grade or a prediction of examination performance.',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your saved Forecast report</title>
<style>@media only screen and (max-width:480px){.forecast-email-body{padding:22px 18px!important}.forecast-email-score{font-size:34px!important}}</style></head>
<body style="margin:0;background:#f6f2e9;color:#002147;font-family:Arial,sans-serif;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fffdf8;border:1px solid #d6c59f;border-top:4px solid #c5a059">
<tr><td style="padding:22px 26px;background:#002147;color:#fff"><img src="https://duediligence.ph/assets/brand/logo1-master.png" alt="Due Diligence" width="56" style="display:block;width:56px;max-width:100%;height:auto;margin-bottom:12px"><div style="font:700 23px Georgia,serif;letter-spacing:1px">DUE DILIGENCE</div><div style="color:#e7c76e;font-size:13px">Bar Forecast · Saved result</div></td></tr>
<tr><td class="forecast-email-body" style="padding:28px 30px">
<h1 style="margin:0 0 20px;font:700 24px/1.3 Georgia,serif;overflow-wrap:anywhere">${escapeEmailHtml(attempt.subject)}</h1>
<p style="margin:0;font-size:13px;color:#465468">MOCK BAR PRACTICE SCORE</p>
<p class="forecast-email-score" style="margin:4px 0;font:700 42px/1.2 Georgia,serif">${escapeEmailHtml(score)} <span style="font:700 20px Arial,sans-serif">(${result.percentage}%)</span></p>
<p style="margin:10px 0 22px;font-size:14px">20 answers assessed<br>${escapeEmailHtml(summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #d6c59f;border-bottom:1px solid #d6c59f"><tr><td style="padding:16px 0">
<h2 style="margin:0 0 8px;font:700 18px Georgia,serif">Writing diagnostics</h2>
<p style="margin:0;font-size:15px">Grammar: <strong>${result.analytics.grammarAverage} / 5</strong><br>Issue spotting: <strong>${result.analytics.issueSpottingAverage} / 5</strong></p>
<p style="margin:8px 0 0;font-size:13px;color:#465468">Separate diagnostics. They do not change your practice score.</p></td></tr></table>
<p style="margin:20px 0 6px;font-size:13px">Completed: ${escapeEmailHtml(completed)}</p>
<p style="margin:0 0 22px;font-size:12px;overflow-wrap:anywhere;word-break:break-word">Attempt: ${escapeEmailHtml(attempt.id)}<br>Revision ${attempt.resultRevision}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#002147;border:1px solid #c5a059;border-radius:6px"><a href="${escapeEmailHtml(link)}" style="display:inline-block;padding:14px 20px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none">Open saved report</a></td></tr></table>
<p style="margin:14px 0 0;font-size:13px;color:#465468">Sign in to the account that owns this report. Current Forecast access is required.</p>
<p style="margin:16px 0 0;font-size:13px">Your complete PDF is attached. This is the same saved assessment; no new grading was performed.</p>
<p style="margin:22px 0 0;font-size:12px;color:#465468">Educational practice diagnostic only—not an official Bar grade or a prediction of examination performance.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: 'Your saved Due Diligence Forecast report', text, html, link };
}

// The embedded, pinned Noto font and character-aware wrapping follow the
// reviewed verdict-pdf renderer. Forecast does not invoke its legacy workflows.
export async function buildForecastResultPdf({ attempt, ownerId }) {
  const result = validateSavedForecastForExport(attempt, ownerId);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = Uint8Array.from(atob(notoSansBase64), (character) => character.charCodeAt(0));
  const font = await pdf.embedFont(fontBytes, { subset: true });
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
        if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width) { line = line ? `${line} ${word}` : word; continue; }
        if (line) lines.push(line); line = '';
        for (const character of Array.from(word)) {
          if (font.widthOfTextAtSize(line + character, size) > width && line) { lines.push(line); line = ''; }
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

export function verifiedForecastEmail(user) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)
      || typeof user.email_confirmed_at !== 'string' || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
    throw new BarForecastError('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED', 'Verify your account email before emailing this report.', 409);
  }
  return email;
}

export function createForecastResultExporter({ attemptStore, rpc, sendEmail, assertEmailAvailable = () => {}, renderPdf = buildForecastResultPdf, resolveVerifiedUser = async (_env, user) => user }) {
  const call = async (env, name, args) => {
    let value;
    try { value = await rpc(env, name, args); } catch { throw new BarForecastError('BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE', 'Your export status could not be saved. Please try again.', 503); }
    if (!value || value.ok === false) throw new BarForecastError(value?.error?.code || 'BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE', value?.error?.message || 'The export could not be recorded.', value?.error?.status || 503);
    return value;
  };
  async function pdf(env, user, attemptId, download = true) {
    const { attempt } = await attemptStore.getOwned(env, user.id, attemptId);
    validateSavedForecastForExport(attempt, user.id);
    const bytes = await renderPdf({ attempt, ownerId: user.id });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fileName = forecastResultPdfFileName(attempt);
    await call(env, 'dd2026_forecast_result_pdf_record', { p_actor_user_id: user.id, p_attempt_id: attemptId,
      p_result_revision: attempt.resultRevision, p_pdf_hash: hash, p_file_name: fileName, p_byte_count: bytes.length, p_download: download });
    return { bytes, fileName, hash, attempt };
  }
  async function email(env, user, attemptId) {
    if (typeof sendEmail !== 'function') throw new BarForecastError('BAR_FORECAST_EMAIL_UNAVAILABLE', 'Report email is not available. You can still download the PDF.', 503);
    await assertEmailAvailable(env);
    const currentUser = await resolveVerifiedUser(env, user);
    if (currentUser?.id !== user.id) throw new BarForecastError('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED', 'Verify your account email before emailing this report.', 409);
    const recipient = verifiedForecastEmail(currentUser);
    const saved = await pdf(env, user, attemptId, false);
    const presentation = buildForecastResultEmail(saved.attempt, user.id);
    const claim = await call(env, 'dd2026_forecast_result_email_claim', { p_actor_user_id: user.id, p_attempt_id: attemptId,
      p_result_revision: saved.attempt.resultRevision, p_recipient_email: recipient, p_pdf_hash: saved.hash });
    if (!claim.claimed) return { ok: true, email: claim.email, message: emailStatusMessage(claim.email.status) };
    let status = 'uncertain'; let providerId = null;
    try {
      const response = await sendEmail(env, {
        to: recipient, subject: presentation.subject, text: presentation.text, html: presentation.html,
        attachment: { filename: saved.fileName, contentType: 'application/pdf', bytes: saved.bytes, sha256: saved.hash },
        idempotencyKey: claim.idempotencyKey,
      });
      if (response?.accepted === true && typeof response.providerMessageId === 'string' && response.providerMessageId.length > 0) {
        status = 'provider_accepted'; providerId = response.providerMessageId;
      } else if (response?.definitelyNotAccepted === true) status = 'failed';
    } catch (error) { if (error?.definitelyNotAccepted === true) status = 'failed'; }
    let settled;
    const args = { p_actor_user_id: user.id, p_attempt_id: attemptId, p_result_revision: saved.attempt.resultRevision,
      p_lease_token: claim.leaseToken, p_status: status, p_provider_id: providerId };
    try { settled = await call(env, 'dd2026_forecast_result_email_settle', args); }
    catch {
      // The provider may have accepted the message. Resolve only the same SQL
      // settlement; never issue another email inside an HTTP retry loop.
      try { settled = await call(env, 'dd2026_forecast_result_email_settle', args); }
      catch { return { ok: true, email: { status: 'uncertain', alreadyRequested: true, retryAllowed: false }, message: emailStatusMessage('uncertain') }; }
    }
    return { ok: true, email: settled.email, message: emailStatusMessage(settled.email.status) };
  }
  return Object.freeze({ pdf, email });
}

function emailStatusMessage(status) {
  if (status === 'provider_accepted') return 'The email provider accepted your report. Delivery is not yet confirmed.';
  if (status === 'processing') return 'Your report email request is already being processed.';
  if (status === 'failed') return 'The email provider did not accept this request. Your PDF remains available.';
  return 'Email acceptance could not be confirmed. Your PDF remains available; avoid repeated requests.';
}
