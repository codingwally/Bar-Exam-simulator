import coreWorker from './index.mjs';

export const REQUIRED_PAYMENT_VERIFIER_COUNT = 5;

function cleanSingleLine(value, maximum = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function validEmail(value) {
  const email = cleanSingleLine(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizePaymentVerificationRecipients(rows) {
  const normalized = [];
  const seen = new Set();
  const ordered = Array.isArray(rows)
    ? [...rows].sort((left, right) => (
      Number(left?.display_order || left?.displayOrder || 0)
      - Number(right?.display_order || right?.displayOrder || 0)
    ))
    : [];

  for (const row of ordered) {
    const email = validEmail(typeof row === 'string' ? row : row?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function notificationMode(env) {
  const mode = String(env?.PAYMENT_NOTIFICATION_EMAIL_MODE || 'suppressed')
    .trim()
    .toLowerCase();
  return ['enabled', 'suppressed'].includes(mode) ? mode : 'suppressed';
}

function configuredSupabaseUrl(env) {
  const raw = String(env?.SUPABASE_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

async function paymentVerificationRecipients(env) {
  const supabaseUrl = configuredSupabaseUrl(env);
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) return [];

  const endpoint = new URL('/rest/v1/payment_verification_recipients', supabaseUrl);
  endpoint.searchParams.set('select', 'email,display_order');
  endpoint.searchParams.set('enabled', 'eq.true');
  endpoint.searchParams.set('order', 'display_order.asc');
  endpoint.searchParams.set('limit', '20');

  const response = await fetch(endpoint, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    console.error('Payment-verifier directory could not be loaded', {
      status: response.status,
    });
    return [];
  }
  return normalizePaymentVerificationRecipients(
    await response.json().catch(() => []),
  );
}

async function verifiedPaymentUser(request, env) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  const supabaseUrl = configuredSupabaseUrl(env);
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^Bearer\s+\S+$/i.test(authorization) || !supabaseUrl || !serviceRoleKey) {
    return null;
  }
  const response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: authorization,
    },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!user?.id) return null;
  return {
    id: String(user.id),
    email: validEmail(user.email),
    displayName: cleanSingleLine(
      user.user_metadata?.full_name || user.user_metadata?.name,
      120,
    ) || null,
  };
}

export function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeAttachmentName(file) {
  const original = cleanSingleLine(file?.name, 160) || 'payment-proof';
  const safe = original.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim();
  return safe || 'payment-proof';
}

function philippineDateTime(value) {
  const date = new Date(value || Date.now());
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(safeDate);
}

function paymentEmailText({ payment, fields, user, proof, proofHash }) {
  const submittedAt = payment?.submittedAt || new Date().toISOString();
  return [
    'A Due Diligence user submitted proof for the ₱149 Early Access subscription.',
    '',
    'SUBSCRIBER',
    `Name: ${user?.displayName || 'Not provided'}`,
    `Email: ${user?.email || 'Not provided'}`,
    `User ID: ${user?.id || 'Not available'}`,
    '',
    'PAYMENT INFORMATION',
    'Plan: Early Access',
    'Amount to verify: ₱149.00',
    'Payment channel: BPI InstaPay',
    `Payment date declared by subscriber: ${cleanSingleLine(fields.paymentDate, 10) || 'Not provided'}`,
    `Proof submitted in the Philippines: ${philippineDateTime(submittedAt)}`,
    `Proof submitted in UTC: ${new Date(submittedAt).toISOString()}`,
    `Transaction reference: ${cleanSingleLine(fields.transactionReference, 100) || 'Not provided'}`,
    `Subscriber note: ${cleanSingleLine(fields.note, 2000) || 'None'}`,
    '',
    'VERIFICATION RECORD',
    `Payment request ID: ${cleanSingleLine(payment?.id, 80) || 'Not available'}`,
    `Current status: ${cleanSingleLine(payment?.status, 40) || 'pending'}`,
    `Provisional access expires: ${payment?.provisionalAccessExpiresAt
      ? philippineDateTime(payment.provisionalAccessExpiresAt)
      : 'No provisional period returned'}`,
    `Attached proof filename: ${safeAttachmentName(proof)}`,
    `Attached proof type: ${cleanSingleLine(proof?.type, 100) || 'Not provided'}`,
    `Attached proof size: ${Number(proof?.size || 0).toLocaleString('en-PH')} bytes`,
    `Attached proof SHA-256: ${proofHash}`,
    '',
    `Authorized review page: https://duediligence.ph/admin/payments?request=${encodeURIComponent(payment?.id || '')}`,
    '',
    'Verify the amount, transaction reference, payment date/time shown in the attached receipt, and recipient account before approving access. This email and attachment contain private payment information; do not forward them outside the authorized verification group.',
  ].join('\n');
}

export async function sendPaymentVerificationEmail(env, context) {
  const mode = notificationMode(env);
  if (mode !== 'enabled') {
    return { status: 'suppressed', providerId: null, recipientCount: 0 };
  }

  const recipients = normalizePaymentVerificationRecipients(
    context?.recipients || await paymentVerificationRecipients(env),
  );
  const apiKey = String(env?.RESEND_API_KEY || '').trim();
  const from = cleanSingleLine(
    env?.PAYMENT_NOTIFICATION_EMAIL_FROM
      || env?.SUPPORT_NOTIFICATION_EMAIL_FROM
      || env?.EXAMINATION_EMAIL_FROM,
    254,
  );
  if (
    !apiKey
    || !from
    || recipients.length !== REQUIRED_PAYMENT_VERIFIER_COUNT
  ) {
    console.error('Payment-verification email is not configured', {
      mode,
      recipientCount: recipients.length,
    });
    return {
      status: 'not_configured',
      providerId: null,
      recipientCount: recipients.length,
    };
  }

  const proofBytes = new Uint8Array(await context.proof.arrayBuffer());
  const proofHash = await sha256Hex(proofBytes);
  const subjectName = context.user?.displayName || context.user?.email || 'subscriber';
  const message = {
    from,
    to: [recipients[0]],
    bcc: recipients.slice(1),
    subject: `Due Diligence ₱149 payment proof — ${cleanSingleLine(subjectName, 120)}`,
    text: paymentEmailText({
      payment: context.payment,
      fields: context.fields,
      user: context.user,
      proof: context.proof,
      proofHash,
    }),
    ...(context.user?.email ? { reply_to: context.user.email } : {}),
    attachments: [{
      filename: safeAttachmentName(context.proof),
      content: bytesToBase64(proofBytes),
    }],
  };

  let lastStatus = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `payment-verification-${context.payment.id}`,
      },
      body: JSON.stringify(message),
    });
    lastStatus = response.status;
    const result = await response.json().catch(() => null);
    if (response.ok && result?.id) {
      return {
        status: 'sent',
        providerId: String(result.id).slice(0, 180),
        recipientCount: recipients.length,
      };
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) break;
  }

  console.error('Payment-verification email dispatch failed', {
    status: lastStatus,
    paymentRequestId: context.payment.id,
  });
  return {
    status: 'failed',
    providerId: null,
    recipientCount: recipients.length,
  };
}

async function notifyPaymentSubmission(request, response, env) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.ok || !payload?.payment?.id) return response;

  let notification = {
    status: 'failed',
    providerId: null,
    recipientCount: 0,
  };
  try {
    const [form, user] = await Promise.all([
      request.formData(),
      verifiedPaymentUser(request, env),
    ]);
    const proof = form.get('proof');
    if (!proof || typeof proof.arrayBuffer !== 'function') {
      throw new Error('Payment proof was unavailable to the notification layer.');
    }
    notification = await sendPaymentVerificationEmail(env, {
      payment: payload.payment,
      user,
      proof,
      fields: {
        paymentDate: form.get('paymentDate'),
        transactionReference: form.get('transactionReference'),
        note: form.get('note'),
      },
    });
  } catch (error) {
    console.error('Payment-verification notification processing failed', {
      paymentRequestId: payload.payment.id,
      code: cleanSingleLine(error?.name || 'notification_error', 80),
    });
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const verifierNotification = {
    status: notification.status,
    recipientCount: notification.recipientCount,
  };
  if (['failed', 'not_configured'].includes(notification.status)) {
    return new Response(JSON.stringify({
      ok: false,
      payment: payload.payment,
      paymentSaved: true,
      verifierNotification,
      error: {
        code: 'PAYMENT_NOTIFICATION_FAILED',
        message: 'Your payment proof was saved, but delivery to the verification team could not be confirmed. Submit the same proof again to retry the notification; no second provisional grant will be created.',
      },
    }), {
      status: 503,
      headers,
    });
  }

  return new Response(JSON.stringify({
    ...payload,
    verifierNotification,
  }), {
    status: response.status,
    headers,
  });
}

async function fetchWithCommercialNotifications(request, env, ctx) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const paymentRequest = request.method === 'POST' && pathname === '/payments/submit'
    ? request.clone()
    : null;
  const response = await coreWorker.fetch(request, env, ctx);
  if (!paymentRequest || response.status !== 201) return response;
  return notifyPaymentSubmission(paymentRequest, response, env);
}

export default {
  fetch: fetchWithCommercialNotifications,
  scheduled(controller, env, ctx) {
    return coreWorker.scheduled?.(controller, env, ctx);
  },
};
