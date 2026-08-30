import coreWorker from './index.mjs';
import { sendSubscriptionReceiptEmail } from './subscription-receipt.mjs';

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

async function serviceRoleRpc(env, functionName, body) {
  const supabaseUrl = configuredSupabaseUrl(env);
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      status: 503,
      message: 'Secure access selection is temporarily unavailable.',
    };
  }

  const response = await fetch(
    new URL(`/rest/v1/rpc/${encodeURIComponent(functionName)}`, supabaseUrl),
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload,
    message: cleanSingleLine(
      payload?.message || payload?.details || payload?.hint,
      500,
    ),
  };
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

function encodedStoragePath(value) {
  return String(value || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function canonicalPaymentProof(env, context) {
  const supabaseUrl = configuredSupabaseUrl(env);
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const objectPath = cleanSingleLine(context?.proofObjectPath || context?.proofPath, 500);
  const bucketId = cleanSingleLine(context?.proofBucket, 80) || 'payment-proofs';
  if (!supabaseUrl || !serviceRoleKey || !objectPath || bucketId !== 'payment-proofs') {
    throw new Error('Canonical payment proof is unavailable.');
  }
  const response = await fetch(new URL(
    `/storage/v1/object/${bucketId}/${encodedStoragePath(objectPath)}`,
    supabaseUrl,
  ), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Canonical payment proof could not be read (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedSize = Number(context?.proofSizeBytes || 0);
  if (!bytes.length || (expectedSize > 0 && bytes.length !== expectedSize)) {
    throw new Error('Canonical payment proof size verification failed.');
  }
  const hash = await sha256Hex(bytes);
  if (context?.proofSha256 && hash !== String(context.proofSha256).toLowerCase()) {
    throw new Error('Canonical payment proof integrity verification failed.');
  }
  return {
    name: cleanSingleLine(context?.proofOriginalName || context?.proofName, 180) || 'payment-proof',
    type: cleanSingleLine(context?.proofMimeType, 100) || 'application/octet-stream',
    size: bytes.length,
    bytes,
    hash,
  };
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

function paymentChannelLabel(value) {
  const original = cleanSingleLine(value, 120);
  const method = original.toLowerCase();
  if (method === 'gotyme_instapay') return 'GoTyme InstaPay';
  if (method === 'bpi_instapay') return 'BPI InstaPay';
  return original || 'Not provided';
}

function trustedPaymentEmailDetails(payment = {}, fields = {}) {
  const planCode = cleanSingleLine(payment.planCode, 64).toLowerCase();
  const historicalEarlyAccess = !payment.planVersionId
    && (!planCode || planCode === 'early_access_beta');
  const planName = cleanSingleLine(payment.planName, 120)
    || (historicalEarlyAccess ? 'Early Access' : planCode || 'Published plan');
  const centavos = Number(payment.amountCentavos);
  const hasCentavos = payment.amountCentavos != null && payment.amountCentavos !== ''
    && Number.isSafeInteger(centavos) && centavos >= 0;
  const legacyAmount = payment.amountPhp == null || payment.amountPhp === ''
    ? Number.NaN
    : Number(payment.amountPhp);
  const amountPhp = hasCentavos
    ? centavos / 100
    : Number.isFinite(legacyAmount) && legacyAmount >= 0
      ? legacyAmount
      : historicalEarlyAccess ? 149 : null;
  const amountLabel = amountPhp == null
    ? 'Not available'
    : new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: cleanSingleLine(payment.currency, 3).toUpperCase() || 'PHP',
    }).format(amountPhp);
  const durationDays = Number(payment.durationDays);
  const fixedEndsAt = payment.fixedEntitlementEndsAt
    || payment.fixedEndsAt
    || payment.purchasedEndsAt
    || payment.subscription?.expiresAt;
  const termLabel = Number.isInteger(durationDays) && durationDays > 0
    ? `${durationDays} days from approval`
    : fixedEndsAt
      ? `Through ${philippineDateTime(fixedEndsAt)}`
      : historicalEarlyAccess ? 'Legacy Early Access terms' : 'As captured by the approved plan';
  const channel = paymentChannelLabel(
    payment.paymentChannelLabel
      || payment.channelLabel
      || payment.paymentChannelName
      || payment.paymentMethod
      || fields.paymentMethod,
  );
  return { planCode, planName, amountLabel, termLabel, channel, historicalEarlyAccess };
}

export function paymentEmailText({ payment, fields = {}, user, proof, proofHash }) {
  const submittedAt = payment?.submittedAt || new Date().toISOString();
  const trusted = trustedPaymentEmailDetails(payment, fields);
  const paymentDate = payment?.paymentDate || fields.paymentDate;
  const paymentReference = payment?.paymentReference
    || payment?.transactionReference
    || fields.paymentReference
    || fields.transactionReference;
  return [
    `A Due Diligence user submitted proof for the ${trusted.planName} plan (${trusted.amountLabel}).`,
    '',
    'SUBSCRIBER',
    `Name: ${user?.displayName || 'Not provided'}`,
    `Email: ${user?.email || 'Not provided'}`,
    `User ID: ${user?.id || 'Not available'}`,
    '',
    'PAYMENT INFORMATION',
    `Plan: ${trusted.planName}${trusted.planCode ? ` (${trusted.planCode})` : ''}`,
    `Amount to verify: ${trusted.amountLabel}`,
    `Access term: ${trusted.termLabel}`,
    `Payment channel: ${trusted.channel}`,
    `Payment date declared by subscriber: ${cleanSingleLine(paymentDate, 10) || 'Not provided'}`,
    `Proof submitted in the Philippines: ${philippineDateTime(submittedAt)}`,
    `Proof submitted in UTC: ${new Date(submittedAt).toISOString()}`,
    `Transaction reference: ${cleanSingleLine(paymentReference, 100) || 'Not provided'}`,
    `Subscriber note: ${cleanSingleLine(payment?.note || fields.note, 2000) || 'None'}`,
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
      || env?.SUPPORT_NOTIFICATION_EMAIL_FROM,
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

  const proofBytes = context.proof?.bytes instanceof Uint8Array
    ? context.proof.bytes
    : new Uint8Array(await context.proof.arrayBuffer());
  const proofHash = context.proof?.hash || await sha256Hex(proofBytes);
  const subjectName = context.user?.displayName || context.user?.email || 'subscriber';
  const trusted = trustedPaymentEmailDetails(context.payment, context.fields);
  const message = {
    from,
    to: [recipients[0]],
    bcc: recipients.slice(1),
    subject: `Due Diligence ${trusted.amountLabel} ${trusted.planName} proof — ${cleanSingleLine(subjectName, 120)}`,
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

export async function dispatchQueuedPaymentNotification(env, paymentRequestId = null) {
  const claim = await serviceRoleRpc(env, 'phase4_claim_payment_notification', {
    p_payment_request_id: paymentRequestId,
  });
  if (!claim.ok) {
    console.error('Payment-verification queue claim failed', { status: claim.status });
    return { status: 'failed', recipientCount: 0 };
  }
  const payment = claim.payload;
  if (!payment?.id) return { status: 'idle', recipientCount: 0 };

  let notification = { status: 'failed', providerId: null, recipientCount: 0 };
  let errorCode = 'delivery_failed';
  try {
    const proof = await canonicalPaymentProof(env, payment);
    notification = await sendPaymentVerificationEmail(env, {
      payment,
      user: payment.user,
      proof,
      fields: {
        paymentMethod: payment.paymentMethod,
        paymentDate: payment.paymentDate,
        paymentReference: payment.paymentReference,
        transactionReference: payment.transactionReference,
        note: payment.note,
      },
    });
    errorCode = notification.status === 'not_configured'
      ? 'notification_not_configured'
      : 'delivery_failed';
  } catch (error) {
    errorCode = cleanSingleLine(error?.message || error?.name || 'delivery_failed', 500);
    console.error('Payment-verification notification processing failed', {
      paymentRequestId: payment.id,
      code: cleanSingleLine(error?.name || 'notification_error', 80),
    });
  }

  const terminalStatus = notification.status === 'sent'
    ? 'sent'
    : notification.status === 'suppressed'
      ? 'suppressed'
      : 'failed';
  const completion = await serviceRoleRpc(env, 'phase4_complete_payment_notification', {
    p_payment_request_id: payment.id,
    p_status: terminalStatus,
    p_provider_id: notification.providerId,
    p_error: terminalStatus === 'failed' ? errorCode : null,
  });
  if (!completion.ok) {
    console.error('Payment-verification queue completion failed', {
      status: completion.status,
      paymentRequestId: payment.id,
    });
  }
  return {
    status: terminalStatus,
    recipientCount: notification.recipientCount,
    paymentRequestId: payment.id,
  };
}

export async function drainPaymentNotificationQueue(env, limit = 5) {
  const results = [];
  const boundedLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  for (let index = 0; index < boundedLimit; index += 1) {
    const result = await dispatchQueuedPaymentNotification(env);
    if (result.status === 'idle') break;
    results.push(result);
  }
  return results;
}

export async function dispatchApprovedSubscriptionReceipt(env, paymentRequestId = null) {
  const claim = await serviceRoleRpc(env, 'phase4_claim_subscription_receipt', {
    p_payment_request_id: paymentRequestId,
  });
  if (!claim.ok) {
    console.error('Subscriber receipt queue claim failed', { status: claim.status });
    return { status: 'failed', paymentRequestId };
  }

  const payment = claim.payload;
  if (!payment?.id) {
    const context = paymentRequestId
      ? await serviceRoleRpc(env, 'phase4_subscription_receipt_context', {
        p_payment_request_id: paymentRequestId,
      })
      : null;
    return {
      status: cleanSingleLine(context?.payload?.receiptStatus, 40) || 'idle',
      paymentRequestId,
    };
  }

  let receipt = { status: 'failed', providerId: null };
  let errorCode = 'delivery_failed';
  try {
    const proof = await canonicalPaymentProof(env, payment);
    receipt = await sendSubscriptionReceiptEmail(env, {
      payment,
      user: payment.user,
      subscription: payment.subscription,
      proof,
    });
    errorCode = receipt.status === 'not_configured'
      ? 'receipt_not_configured'
      : receipt.safeErrorCode || 'delivery_failed';
  } catch (error) {
    errorCode = cleanSingleLine(error?.message || error?.name || 'delivery_failed', 500);
    console.error('Subscriber receipt processing failed', {
      paymentRequestId: payment.id,
      code: cleanSingleLine(error?.name || 'receipt_error', 80),
    });
  }

  const terminalStatus = receipt.status === 'sent' ? 'sent' : 'failed';
  const completion = await serviceRoleRpc(env, 'phase4_complete_subscription_receipt', {
    p_payment_request_id: payment.id,
    p_status: terminalStatus,
    p_provider_id: receipt.providerId,
    p_error: terminalStatus === 'failed' ? errorCode : null,
  });
  if (!completion.ok) {
    console.error('Subscriber receipt queue completion failed', {
      status: completion.status,
      paymentRequestId: payment.id,
    });
  }
  return { status: terminalStatus, paymentRequestId: payment.id };
}

export async function drainSubscriptionReceiptQueue(env, limit = 5) {
  const results = [];
  const boundedLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  for (let index = 0; index < boundedLimit; index += 1) {
    const result = await dispatchApprovedSubscriptionReceipt(env);
    if (result.status === 'idle') break;
    results.push(result);
  }
  return results;
}

async function notifyPaymentSubmission(response, env, ctx) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.ok || !payload?.payment?.id) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const delivery = dispatchQueuedPaymentNotification(env, payload.payment.id);
  if (ctx?.waitUntil) ctx.waitUntil(delivery);
  else await delivery;

  return new Response(JSON.stringify({
    ...payload,
    paymentSaved: true,
    verifierNotification: { status: 'queued' },
  }), {
    status: response.status,
    headers,
  });
}

async function notifyApprovedPayment(response, env, paymentRequestId) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.ok || payload?.data?.payment?.status !== 'approved') return response;
  const receipt = await dispatchApprovedSubscriptionReceipt(
    env,
    payload.data.payment.id || paymentRequestId,
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({
    ...payload,
    data: {
      ...payload.data,
      subscriberReceipt: { status: receipt.status },
    },
  }), {
    status: response.status,
    headers,
  });
}

async function fetchWithCommercialNotifications(request, env, ctx) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

  const paymentRequest = request.method === 'POST' && pathname === '/payments/submit';
  const adminActionRequest = request.method === 'POST' && pathname === '/admin/phase4-action';
  const adminAction = adminActionRequest
    ? await request.clone().json().catch(() => null)
    : null;
  const response = await coreWorker.fetch(request, env, ctx);
  if (paymentRequest && response.status === 201) {
    return notifyPaymentSubmission(response, env, ctx);
  }
  if (
    adminActionRequest
    && response.ok
    && adminAction?.action === 'payment_review'
    && adminAction?.payload?.status === 'approved'
  ) {
    return notifyApprovedPayment(response, env, adminAction.targetId);
  }
  return response;
}

export default {
  fetch: fetchWithCommercialNotifications,
  scheduled(controller, env, ctx) {
    const notificationDrain = drainPaymentNotificationQueue(env, 5);
    const receiptDrain = drainSubscriptionReceiptQueue(env, 5);
    ctx?.waitUntil?.(notificationDrain);
    ctx?.waitUntil?.(receiptDrain);
    return coreWorker.scheduled?.(controller, env, ctx);
  },
};
