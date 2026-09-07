import { BarForecastError } from './bar-forecast-core.mjs';
import { buildForecastResultPdf, validateSavedForecastForExport, forecastResultPdfFileName } from './forecast-result-pdf.mjs';
export { buildForecastResultPdf, validateSavedForecastForExport, forecastResultPdfFileName, FORECAST_PDF_VERSION } from './forecast-result-pdf.mjs';

export const FORECAST_RESULT_EXPORT_RPC_NAMES = Object.freeze([
  'dd2026_forecast_result_pdf_record', 'dd2026_forecast_result_email_claim', 'dd2026_forecast_result_email_settle',
  'dd2026_forecast_result_summary_email_claim',
]);
const manilaTime = (value) => `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} Philippine time`;

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

export function buildForecastResultEmail(attempt, ownerId, { deliveryKind = 'pdf_attachment' } = {}) {
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
  const reportNotice = deliveryKind === 'summary_link'
    ? 'Open your complete saved report and download its PDF using the link above. No new grading was performed.'
    : 'Your complete PDF is attached. This is the same saved assessment; no new grading was performed.';
  const text = [
    'DUE DILIGENCE | Bar Forecast', attempt.subject,
    `Practice score: ${score} (${result.percentage}%)`, `20 answers assessed. ${summary}.`,
    '', 'WRITING DIAGNOSTICS — separate from the practice score',
    `Grammar: ${result.analytics.grammarAverage} / 5`, `Issue spotting: ${result.analytics.issueSpottingAverage} / 5`,
    'These diagnostics do not change your practice score.', '',
    `Completed: ${completed}`, `Attempt: ${attempt.id} · Revision ${attempt.resultRevision}`,
    '', `Open this saved report: ${link}`, 'Sign in to the account that owns this report. Current Forecast access is required.',
    reportNotice,
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
<p style="margin:16px 0 0;font-size:13px">${escapeEmailHtml(reportNotice)}</p>
<p style="margin:22px 0 0;font-size:12px;color:#465468">Educational practice diagnostic only—not an official Bar grade or a prediction of examination performance.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: 'Your saved Due Diligence Forecast report', text, html, link };
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
    const { attempt } = await attemptStore.getOwned(env, user.id, attemptId);
    const presentation = buildForecastResultEmail(attempt, user.id, { deliveryKind: 'summary_link' });
    // Pin the exact versioned body before claiming. A later template change
    // must not retry a different payload under a provider's existing key.
    const templateVersion = 'forecast-summary-link-v1';
    const payloadBytes = new TextEncoder().encode(JSON.stringify([templateVersion, String(env?.FORECAST_RESULTS_EMAIL_FROM || ''), presentation.subject, presentation.text, presentation.html]));
    const payloadHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const claim = await call(env, 'dd2026_forecast_result_summary_email_claim', { p_actor_user_id: user.id, p_attempt_id: attemptId,
      p_result_revision: attempt.resultRevision, p_recipient_email: recipient, p_result: attempt.result,
      p_completed_at: attempt.completedAt, p_template_version: templateVersion, p_payload_hash: payloadHash });
    if (!claim.claimed) return { ok: true, email: claim.email, message: emailStatusMessage(claim.email.status) };
    let status = 'uncertain'; let providerId = null;
    try {
      const response = await sendEmail(env, {
        to: recipient, subject: presentation.subject, text: presentation.text, html: presentation.html,
        deliveryKind: 'summary_link',
        idempotencyKey: claim.idempotencyKey,
      });
      if (response?.accepted === true && typeof response.providerMessageId === 'string' && response.providerMessageId.length > 0) {
        status = 'provider_accepted'; providerId = response.providerMessageId;
      } else if (response?.definitelyNotAccepted === true) status = 'failed';
    } catch (error) { if (error?.definitelyNotAccepted === true) status = 'failed'; }
    let settled;
    const args = { p_actor_user_id: user.id, p_attempt_id: attemptId, p_result_revision: attempt.resultRevision,
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
