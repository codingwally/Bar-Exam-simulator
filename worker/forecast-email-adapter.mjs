import { BarForecastError } from './bar-forecast-core.mjs';

const EMAIL_TIMEOUT_MS = 15_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

export function assertForecastResultEmailAvailable(env) {
  if (String(env?.FORECAST_RESULTS_EMAIL_MODE || '').toLowerCase() !== 'enabled'
      || !env?.RESEND_API_KEY || !env?.FORECAST_RESULTS_EMAIL_FROM
      || /[\r\n]/u.test(String(env.FORECAST_RESULTS_EMAIL_FROM))) {
    throw new BarForecastError('BAR_FORECAST_EMAIL_UNAVAILABLE', 'Report email is not available. You can still download the PDF.', 503);
  }
}

async function boundedJsonFetch(fetcher, url, options) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Forecast email transport deadline')); }, EMAIL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...options, signal: controller.signal });
        const result = await response.json().catch(() => null);
        return { response, result };
      })(),
      timeout,
    ]);
  } finally { clearTimeout(timer); }
}

// This adapter is reachable only through an explicit, journaled email_result
// request. It never retries a transport: acceptance uncertainty belongs to the
// durable journal, and provider acceptance is not a delivery confirmation.
export async function sendForecastResultEmail(env, message, fetcher = fetch) {
  try { assertForecastResultEmailAvailable(env); } catch { return { definitelyNotAccepted: true }; }
  const attachment = message?.attachment;
  if (!emailPattern.test(String(message?.to || '')) || String(message.to).length > 254
      || !/^[a-zA-Z0-9:_/-]{1,256}$/u.test(String(message?.idempotencyKey || ''))
      || !(attachment?.bytes instanceof Uint8Array) || !attachment.bytes.length
      || attachment.bytes.length > MAX_ATTACHMENT_BYTES || attachment.contentType !== 'application/pdf'
      || !/^duediligence-forecast-[a-f0-9-]+-r[0-9]+\.pdf$/u.test(attachment.filename)) {
    return { definitelyNotAccepted: true };
  }
  const content = Buffer.from(attachment.bytes).toString('base64');
  try {
    const { response, result } = await boundedJsonFetch(fetcher, 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: env.FORECAST_RESULTS_EMAIL_FROM, to: [message.to],
        subject: message.subject, text: message.text, ...(typeof message.html === 'string' ? { html: message.html } : {}),
        attachments: [{ filename: attachment.filename, content_type: 'application/pdf', content }] }),
    });
    if (response.ok && typeof result?.id === 'string' && /^[a-zA-Z0-9-]{1,180}$/u.test(result.id)) {
      return { accepted: true, providerMessageId: result.id };
    }
    // 409 can mean the same idempotency key is already processing. 408/5xx,
    // malformed success and network errors may follow an accepted send.
    if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) return { definitelyNotAccepted: true };
    return { accepted: false };
  } catch {
    return { accepted: false };
  }
}

export async function resolveForecastEmailUser(env, user, baseUrl, fetcher = fetch) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(String(user?.id || ''))) {
    throw new BarForecastError('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED', 'Verify your account email before emailing this report.', 409);
  }
  try {
    if (!env?.SUPABASE_SERVICE_ROLE_KEY || new URL(baseUrl).protocol !== 'https:') throw new Error('Account verification unavailable');
    const { response, result: current } = await boundedJsonFetch(fetcher, new URL(`/auth/v1/admin/users/${user.id}`, baseUrl), {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!response.ok) throw new Error('Account verification unavailable');
    if (current?.id !== user.id || current?.banned_until && Date.parse(current.banned_until) > Date.now()) {
      throw new Error('Account verification unavailable');
    }
    return { id: current.id, email: current.email, email_confirmed_at: current.email_confirmed_at };
  } catch {
    throw new BarForecastError('BAR_FORECAST_EMAIL_ACCOUNT_UNAVAILABLE', 'Your verified account email could not be checked. Download the PDF or try again shortly.', 503);
  }
}
