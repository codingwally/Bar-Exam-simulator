import application from './index.mjs';

const TRIAL_ENDPOINT = '/access/choose-trial';
const PAYMENT_ENDPOINT = '/payments/submit';
const PAYMENT_BUCKET = 'payment-proofs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYMENT_PROOF_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|pdf)$/i;
const MAX_PAYMENT_PROOF_BYTES = 6 * 1024 * 1024;

function runtimeEnv(env) {
  return {
    ...env,
    SUPABASE_URL: String(env?.SUPABASE_URL || '').trim(),
    SUPABASE_SERVICE_ROLE_KEY: String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    RESEND_API_KEY: String(env?.RESEND_API_KEY || '').trim(),
  };
}

function allowedOrigin(env) {
  return String(env.ALLOWED_ORIGIN || 'https://duediligence.ph').trim();
}

function corsHeaders(origin, env) {
  const allowed = allowedOrigin(env);
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type', 'Authorization', 'X-Request-ID',
      'X-DD-Beta-Access', 'X-DD-Beta-Flow-ID',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function requireBrowserOrigin(request, env) {
  const origin = String(request.headers.get('Origin') || '').trim();
  if (!origin || origin !== allowedOrigin(env)) {
    const error = new Error('This request origin is not allowed.');
    error.code = 'ORIGIN_NOT_ALLOWED';
    error.status = 403;
    throw error;
  }
  return origin;
}

function configuredSupabaseUrl(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Secure access services are not configured.');
    error.code = 'ACCESS_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:') throw new Error('Invalid Supabase URL');
  return url;
}

async function verifiedUser(request, env) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    const error = new Error('Sign in with Google before choosing access.');
    error.code = 'AUTHENTICATION_REQUIRED';
    error.status = 401;
    throw error;
  }
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL('/auth/v1/user', baseUrl), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: authorization,
    },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id || !UUID_PATTERN.test(String(user.id))) {
    const error = new Error('Your session expired. Please sign in again.');
    error.code = 'INVALID_SESSION';
    error.status = 401;
    throw error;
  }
  return {
    id: String(user.id),
    email: String(user.email || '').trim().toLowerCase(),
  };
}

async function phase4Rpc(env, functionName, body) {
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(String(result?.message || 'Secure access services are temporarily unavailable.'));
    error.code = 'ACCESS_UNAVAILABLE';
    error.status = 503;
    error.databaseStatus = response.status;
    throw error;
  }
  return result;
}

function safeTrialError(error) {
  const message = String(error?.message || '');
  if (/already been used/i.test(message)) {
    return { code: 'TRIAL_ALREADY_USED', message: 'This account has already used its launch trial.', status: 409 };
  }
  if (/has closed/i.test(message)) {
    return { code: 'TRIAL_CLOSED', message: 'The temporary launch trial is no longer available.', status: 403 };
  }
  if (/profile/i.test(message)) {
    return { code: 'PROFILE_REQUIRED', message: 'Complete your profile before choosing access.', status: 403 };
  }
  if (/terms|privacy/i.test(message)) {
    return { code: 'LEGAL_ACCEPTANCE_REQUIRED', message: 'Accept the current Terms and Privacy Policy before choosing access.', status: 403 };
  }
  if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION', 'ORIGIN_NOT_ALLOWED'].includes(error?.code)) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return {
    code: 'TRIAL_SELECTION_FAILED',
    message: 'The launch trial could not be activated. Please try again.',
    status: Number(error?.status) || 503,
  };
}

async function handleTrialSelection(request, env) {
  const origin = requireBrowserOrigin(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'POST') {
    return jsonResponse({
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted.' },
    }, 405, origin, env);
  }
  try {
    const user = await verifiedUser(request, env);
    const payload = await request.json().catch(() => ({}));
    const requestKey = String(payload?.requestKey || request.headers.get('X-Request-ID') || '').trim();
    if (!REQUEST_KEY_PATTERN.test(requestKey)) {
      return jsonResponse({
        ok: false,
        error: { code: 'REQUEST_ID_REQUIRED', message: 'This access choice could not be verified. Please try again.' },
      }, 400, origin, env);
    }
    const access = await phase4Rpc(env, 'phase4_choose_launch_trial', {
      p_user_id: user.id,
      p_request_key: requestKey,
    });
    return jsonResponse({
      ok: true,
      access,
      message: 'Your complimentary launch trial is active through September 1, 2026 at 11:59 PM Philippine time.',
    }, 200, origin, env);
  } catch (error) {
    const safe = safeTrialError(error);
    return jsonResponse({ ok: false, error: { code: safe.code, message: safe.message } }, safe.status, origin, env);
  }
}

function paymentNotificationsEnabled(env) {
  return String(env.PAYMENT_NOTIFICATION_EMAIL_MODE || '').trim().toLowerCase() === 'enabled';
}

function encodedStoragePath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function downloadPaymentProof(env, context) {
  const objectPath = String(context?.proofObjectPath || '').trim();
  if (!PAYMENT_PROOF_PATH_PATTERN.test(objectPath)) throw new Error('proof_path_invalid');
  const baseUrl = configuredSupabaseUrl(env);
  const response = await fetch(
    new URL(`/storage/v1/object/${PAYMENT_BUCKET}/${encodedStoragePath(objectPath)}`, baseUrl),
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!response.ok) throw new Error(`proof_download_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PAYMENT_PROOF_BYTES) throw new Error('proof_size_invalid');
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeFileName(value, mimeType) {
  const fallback = mimeType === 'application/pdf'
    ? 'payment-proof.pdf'
    : mimeType === 'image/jpeg'
      ? 'payment-proof.jpg'
      : 'payment-proof.png';
  const cleaned = String(value || '')
    .replace(/[\\/\u0000-\u001f\u007f]+/g, '-')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));
}

function humanPaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'bpi_instapay') return 'BPI InstaPay';
  return normalized ? normalized.replaceAll('_', ' ') : 'Not provided';
}

function paymentTime(value, timeZone = 'Asia/Manila') {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'Not available';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone,
  }).format(parsed);
}

function notificationRecipients(value) {
  const recipients = Array.isArray(value) ? value : [];
  return [...new Set(recipients
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => EMAIL_PATTERN.test(email)))]
    .slice(0, 20);
}

function paymentEmail(context) {
  const requestId = String(context.paymentRequestId || '');
  const adminUrl = `https://duediligence.ph/admin/payments?request=${encodeURIComponent(requestId)}`;
  const fields = [
    ['Subscriber name', context.name || 'Not provided'],
    ['Subscriber email', context.email || 'Not provided'],
    ['Plan', 'Early Access'],
    ['Amount', `₱${Number(context.amountPhp || 149).toFixed(2)}`],
    ['Payment channel', humanPaymentMethod(context.paymentMethod)],
    ['Payment date entered', context.paymentDate || 'Not provided'],
    ['Transaction reference', context.transactionReference || 'Not provided'],
    ['Proof submitted (PHT)', paymentTime(context.submittedAt)],
    ['Proof submitted (UTC)', context.submittedAt || 'Not available'],
    ['Provisional access ends', paymentTime(context.provisionalAccessExpiresAt)],
    ['Payment request ID', requestId],
    ['Current status', context.status || 'pending'],
  ];
  const note = String(context.studentNote || '').trim();
  const text = [
    'A Due Diligence user submitted proof for the ₱149 Early Access offer.',
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    ...(note ? ['', `Subscriber note: ${note}`] : []),
    '',
    `Authorized verification page: ${adminUrl}`,
    '',
    'The original payment proof is attached. Verify the amount, channel, date, reference, account identity, and proof before approving access.',
  ].join('\n');
  const rows = fields.map(([label, value]) => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #e7e0d2;color:#647085;width:38%;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e7e0d2;color:#07182f;font-weight:700;vertical-align:top">${escapeHtml(value)}</td>
    </tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f0e7;font-family:Arial,sans-serif;color:#17243a">
    <table role="presentation" width="100%" style="border-collapse:collapse;background:#f4f0e7"><tr><td align="center" style="padding:28px 14px">
      <table role="presentation" width="720" style="width:100%;max-width:720px;border-collapse:collapse;background:#fff;border:1px solid #d4af37;border-top:5px solid #d4af37">
        <tr><td style="padding:24px 28px;background:#07182f;color:#fff">
          <div style="color:#d4af57;font-size:11px;letter-spacing:2px;text-transform:uppercase">Due Diligence Payments</div>
          <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:28px">Early Access payment proof received</h1>
        </td></tr>
        <tr><td style="padding:26px 28px">
          <p style="margin:0 0 18px;line-height:1.6">A user submitted proof for the <strong>₱149 Early Access</strong> offer. The original proof is attached for authorized verification.</p>
          <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf8f2;border-left:4px solid #d4af37">${rows}</table>
          ${note ? `<p style="margin:20px 0 0"><strong>Subscriber note:</strong><br>${escapeHtml(note)}</p>` : ''}
          <p style="margin:24px 0 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 18px;background:#d4af37;color:#07182f;text-decoration:none;font-weight:700">Open authorized payment review</a></p>
          <p style="margin:22px 0 0;color:#667085;font-size:12px;line-height:1.55">Verify the amount, payment channel, date, transaction reference, account identity, and attached proof before approving access. Do not forward the attachment outside the authorized verification group.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return { text, html, adminUrl };
}

async function sendPaymentNotification(env, context, proofBytes) {
  if (!env.RESEND_API_KEY) throw new Error('resend_not_configured');
  const recipients = notificationRecipients(context.recipients);
  if (!recipients.length) throw new Error('recipients_missing');
  const supportIndex = recipients.indexOf('support@duediligence.ph');
  const to = [supportIndex >= 0 ? recipients[supportIndex] : recipients[0]];
  const bcc = recipients.filter((recipient) => !to.includes(recipient));
  const from = String(
    env.PAYMENT_NOTIFICATION_EMAIL_FROM
    || env.EXAMINATION_EMAIL_FROM
    || 'Due Diligence Payments <support@duediligence.ph>'
  ).trim();
  const message = paymentEmail(context);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `early-access-payment-${context.paymentRequestId}`,
    },
    body: JSON.stringify({
      from,
      to,
      ...(bcc.length ? { bcc } : {}),
      ...(EMAIL_PATTERN.test(String(context.email || '')) ? { reply_to: String(context.email) } : {}),
      subject: `Due Diligence payment proof — ${String(context.name || context.email || 'Early Access subscriber').slice(0, 100)}`,
      text: message.text,
      html: message.html,
      attachments: [{
        content: bytesToBase64(proofBytes),
        filename: safeFileName(context.proofOriginalName, context.proofMimeType),
      }],
      tags: [
        { name: 'category', value: 'early_access_payment' },
        { name: 'payment_id', value: String(context.paymentRequestId).replaceAll('-', '').slice(0, 64) },
      ],
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) throw new Error(`resend_${response.status}`);
  return String(result.id).slice(0, 180);
}

function safeDeliveryError(error) {
  return String(error?.message || 'delivery_failed')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .slice(0, 100) || 'delivery_failed';
}

async function deliverClaim(env, context) {
  if (!context?.paymentRequestId || !context?.claimToken) return false;
  try {
    const proof = await downloadPaymentProof(env, context);
    const providerId = await sendPaymentNotification(env, context, proof);
    await phase4Rpc(env, 'phase4_complete_payment_notification', {
      p_payment_request_id: context.paymentRequestId,
      p_claim_token: context.claimToken,
      p_provider_id: providerId,
    });
    return true;
  } catch (error) {
    console.error('Payment verification notification failed', {
      paymentRequestId: String(context.paymentRequestId).slice(0, 36),
      code: safeDeliveryError(error),
    });
    try {
      await phase4Rpc(env, 'phase4_fail_payment_notification', {
        p_payment_request_id: context.paymentRequestId,
        p_claim_token: context.claimToken,
        p_error_code: safeDeliveryError(error),
      });
    } catch {
      console.error('Payment notification failure state requires operator review');
    }
    return false;
  }
}

async function deliverPaymentNotification(env, paymentRequestId) {
  if (!paymentNotificationsEnabled(env) || !UUID_PATTERN.test(String(paymentRequestId || ''))) return false;
  const context = await phase4Rpc(env, 'phase4_claim_payment_notification', {
    p_payment_request_id: paymentRequestId,
    p_lease_seconds: 180,
  });
  if (!context) return false;
  return deliverClaim(env, context);
}

async function processPendingPaymentNotifications(env) {
  if (!paymentNotificationsEnabled(env)) return;
  try {
    const claims = await phase4Rpc(env, 'phase4_claim_payment_notification_batch', {
      p_limit: 10,
      p_lease_seconds: 180,
    });
    for (const claim of Array.isArray(claims) ? claims : []) {
      await deliverClaim(env, claim);
    }
  } catch (error) {
    console.error('Payment notification queue processing failed', {
      code: safeDeliveryError(error),
    });
  }
}

async function handleApplicationFetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, '') === TRIAL_ENDPOINT) {
    return handleTrialSelection(request, env);
  }

  const paymentRequest = url.pathname.replace(/\/+$/, '') === PAYMENT_ENDPOINT
    ? request.clone()
    : null;
  const response = await application.fetch(request, env, ctx);
  if (paymentRequest && response.ok && response.status === 201) {
    const payload = await response.clone().json().catch(() => null);
    const paymentId = payload?.payment?.id;
    if (paymentId && ctx?.waitUntil) {
      ctx.waitUntil(deliverPaymentNotification(env, paymentId));
    }
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const normalized = runtimeEnv(env);
    try {
      return await handleApplicationFetch(request, normalized, ctx);
    } catch (error) {
      const origin = String(request.headers.get('Origin') || allowedOrigin(normalized));
      return jsonResponse({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The request could not be completed safely.',
        },
      }, 500, origin, normalized);
    }
  },

  async scheduled(controller, env, ctx) {
    const normalized = runtimeEnv(env);
    if (typeof application.scheduled === 'function') {
      await application.scheduled(controller, normalized, ctx);
    }
    if (ctx?.waitUntil) ctx.waitUntil(processPendingPaymentNotifications(normalized));
  },
};
