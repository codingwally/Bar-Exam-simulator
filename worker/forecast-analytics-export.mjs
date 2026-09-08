import { BarForecastError } from './bar-forecast-core.mjs';
import { validateSavedForecastForExport } from './forecast-result-pdf.mjs';
import { verifiedForecastEmail } from './forecast-result-export.mjs';
import { FORECAST_ANALYTICS_EMAIL_VERSION,
  buildForecastAnalyticsEmail, validateForecastAnalyticsScope } from './forecast-analytics-core.mjs';

export const FORECAST_ANALYTICS_RPC_NAMES = Object.freeze([
  'dd2026_forecast_analytics_history', 'dd2026_forecast_analytics_snapshot',
  'dd2026_forecast_analytics_get', 'dd2026_forecast_analytics_attempt',
  'dd2026_forecast_analytics_browser_prepared', 'dd2026_forecast_analytics_email_claim',
  'dd2026_forecast_analytics_email_settle',
]);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

// This server boundary never renders, accepts uploaded PDF bytes, or grades.
// Every member is read through its frozen owner-bound SQL scope. Email contains
// the exact saved summary and a private link, not a CPU-heavy PDF attachment.
export function createForecastAnalyticsExporter({ rpc, sendEmail, assertEmailAvailable = () => {},
  resolveVerifiedUser = async (_env, user) => user }) {
  async function call(env, name, args) {
    let value;
    try { value = await rpc(env, name, args); }
    catch { throw new BarForecastError('BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE', 'The saved scope could not be reached. Retry the same request.', 503); }
    if (!value || value.ok === false) throw new BarForecastError(
      value?.error?.code || 'BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE',
      value?.error?.message || 'The saved scope is unavailable.', value?.error?.status || 503);
    return value;
  }
  async function snapshot(env, user, input) {
    const payload = await call(env, 'dd2026_forecast_analytics_snapshot', { p_actor_user_id: user.id,
      p_request_id: input.requestId, p_subject: input.subject, p_from: input.from, p_to: input.to });
    validateForecastAnalyticsScope(payload.scope, user.id);
    return payload;
  }
  async function get(env, user, scopeId) {
    const payload = await call(env, 'dd2026_forecast_analytics_get', { p_actor_user_id: user.id, p_scope_id: scopeId });
    validateForecastAnalyticsScope(payload.scope, user.id);
    if (payload.scope.id !== scopeId) throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The saved scope identity changed.', 409);
    return payload;
  }
  async function attempt(env, user, scopeId, attemptId) {
    const payload = await call(env, 'dd2026_forecast_analytics_attempt', { p_actor_user_id: user.id,
      p_scope_id: scopeId, p_attempt_id: attemptId });
    if (payload.scopeId !== scopeId || payload.attempt?.id !== attemptId
        || !validHash(payload.scopeHash) || !validHash(payload.resultHash)) {
      throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The saved scope member changed.', 409);
    }
    validateSavedForecastForExport(payload.attempt, user.id);
    return payload;
  }
  async function prepared(env, user, input) {
    const payload = await call(env, 'dd2026_forecast_analytics_browser_prepared', {
      p_actor_user_id: user.id, p_scope_id: input.scopeId, p_scope_hash: input.scopeHash,
      p_pdf_version: input.pdfVersion, p_byte_count: input.byteCount,
    });
    if (typeof payload.recorded !== 'boolean' || payload.clientReported !== true) {
      throw new BarForecastError('BAR_FORECAST_ANALYTICS_INVALID', 'The browser preparation observation was not recorded.', 409);
    }
    return payload;
  }
  async function email(env, user, scopeId) {
    await assertEmailAvailable(env);
    if (typeof sendEmail !== 'function') throw new BarForecastError('BAR_FORECAST_EMAIL_UNAVAILABLE', 'Email is unavailable.', 503);
    const verified = await resolveVerifiedUser(env, user);
    if (verified?.id !== user.id) throw new BarForecastError('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED', 'Verify your account email before requesting this report.', 409);
    const recipient = verifiedForecastEmail(verified);
    const { scope } = await get(env, user, scopeId);
    const presentation = buildForecastAnalyticsEmail(scope, user.id);
    const fingerprint = JSON.stringify([FORECAST_ANALYTICS_EMAIL_VERSION,
      String(env?.FORECAST_RESULTS_EMAIL_FROM || ''), presentation.subject, presentation.text, presentation.html]);
    const payloadHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const claim = await call(env, 'dd2026_forecast_analytics_email_claim', { p_actor_user_id: user.id,
      p_scope_id: scopeId, p_scope_hash: scope.scopeHash, p_recipient_email: recipient,
      p_template_version: FORECAST_ANALYTICS_EMAIL_VERSION, p_payload_hash: payloadHash });
    if (!claim.claimed) return { ok: true, email: claim.email };
    let status = 'uncertain'; let providerId = null;
    try {
      const sent = await sendEmail(env, { to: recipient, subject: presentation.subject,
        text: presentation.text, html: presentation.html, deliveryKind: 'summary_link', idempotencyKey: claim.idempotencyKey });
      if (sent?.accepted === true && typeof sent.providerMessageId === 'string' && sent.providerMessageId.length > 0) {
        status = 'provider_accepted'; providerId = sent.providerMessageId;
      } else if (sent?.definitelyNotAccepted === true) status = 'failed';
    } catch (error) { if (error?.definitelyNotAccepted === true) status = 'failed'; }
    const args = { p_actor_user_id: user.id, p_scope_id: scopeId, p_lease_token: claim.leaseToken,
      p_status: status, p_provider_id: providerId };
    let settled;
    try { settled = await call(env, 'dd2026_forecast_analytics_email_settle', args); }
    catch {
      // Reconcile the same journal outcome, never resend after an uncertain send.
      try { settled = await call(env, 'dd2026_forecast_analytics_email_settle', args); }
      catch { return { ok: true, email: { status: 'uncertain', alreadyRequested: true, retryAllowed: false } }; }
    }
    return { ok: true, email: settled.email };
  }
  return Object.freeze({ snapshot, get, attempt, prepared, email });
}
