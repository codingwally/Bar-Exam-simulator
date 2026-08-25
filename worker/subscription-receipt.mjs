const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

function cleanLine(value, maximum = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));
}

function validEmail(value) {
  const email = cleanLine(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount)
    : 'Not available';
}

function manilaDateTime(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function paymentMethod(value) {
  const method = cleanLine(value, 80).toLowerCase();
  if (method === 'gotyme_instapay') return 'GoTyme InstaPay';
  if (method === 'bpi_instapay') return 'BPI InstaPay';
  return cleanLine(value, 80) || 'Not provided';
}

function attachmentName(value) {
  return (cleanLine(value, 160) || 'payment-proof')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'payment-proof';
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function receiptReference(paymentId, sample = false) {
  if (sample) return 'SAMPLE-NOT-A-PAYMENT';
  const suffix = cleanLine(paymentId, 80).replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  return suffix ? `DD-EA-${suffix.toUpperCase()}` : 'Not available';
}

function detailRow(label, value) {
  return `<tr><td style="padding:10px 0;color:#64748b;font-size:13px;vertical-align:top;width:42%;">${escapeHtml(label)}</td><td style="padding:10px 0;color:#081f3d;font-size:14px;font-weight:700;text-align:right;vertical-align:top;">${escapeHtml(value)}</td></tr>`;
}

export function subscriptionReceiptContent(context = {}) {
  const sample = context.sample === true;
  const payment = context.payment || {};
  const user = context.user || {};
  const subscription = context.subscription || {};
  const recipientName = cleanLine(user.displayName, 120) || 'Due Diligence member';
  const amount = money(payment.amountPhp);
  const method = paymentMethod(payment.paymentMethod);
  const reference = cleanLine(payment.transactionReference, 120) || 'Not provided';
  const paymentDate = cleanLine(payment.paymentDate, 40) || 'Not provided';
  const approvedAt = manilaDateTime(payment.reviewedAt || payment.approvedAt);
  const accessEndsAt = subscription.expiresAt
    ? manilaDateTime(subscription.expiresAt)
    : 'No expiration returned by the approved access record';
  const internalReference = receiptReference(payment.id, sample);
  const subject = sample
    ? '[SAMPLE] Due Diligence electronic receipt'
    : 'Due Diligence — Early Access payment receipt';
  const sampleNotice = sample
    ? 'SAMPLE ONLY — This message does not record or acknowledge a real payment.'
    : '';

  const text = [
    sampleNotice,
    'DUE DILIGENCE',
    sample ? 'Electronic receipt preview' : 'Payment approved',
    '',
    `Thank you, ${recipientName}.`,
    sample
      ? 'This is the pre-publication design preview requested by the owner.'
      : 'Your Early Access payment was verified and your access record was updated.',
    '',
    `Amount: ${amount}`,
    'Plan: Early Access',
    `Payment method: ${method}`,
    `Transaction reference: ${reference}`,
    `Payment date provided: ${paymentDate}`,
    `Approved: ${approvedAt}`,
    `Access through: ${accessEndsAt}`,
    `Due Diligence receipt reference: ${internalReference}`,
    '',
    'NEXT BILLING',
    'No automatic billing is scheduled. This access does not renew automatically. Any future offer requires a separate manual purchase.',
    '',
    'The exact payment proof reviewed by Due Diligence is attached to this email.',
    '',
    'This electronic acknowledgment is issued from the payment information submitted and approved in the Due Diligence platform. It is not a bank-issued receipt.',
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#eef1f5;font-family:Inter,Arial,sans-serif;color:#13233a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f5;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#faf7ef;border:1px solid #d7bd82;border-top:5px solid #d9b24c;border-radius:14px;overflow:hidden;box-shadow:0 18px 48px rgba(8,31,61,.14);">
      <tr><td style="background:#081f3d;padding:26px 34px;color:#fff;">
        <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:2px;font-weight:700;">DUE DILIGENCE</div>
        <div style="margin-top:6px;color:#e7c76e;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Electronic payment acknowledgment</div>
      </td></tr>
      <tr><td style="padding:34px;">
        ${sample ? `<div style="margin-bottom:22px;padding:12px 14px;background:#fff4d8;border-left:4px solid #d9b24c;color:#624b14;font-size:13px;font-weight:800;">${escapeHtml(sampleNotice)}</div>` : ''}
        <div style="color:#9a6b10;font-size:12px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;">${sample ? 'Receipt preview' : 'Payment approved'}</div>
        <h1 style="margin:10px 0 12px;font-family:Georgia,serif;color:#081f3d;font-size:34px;line-height:1.1;">Thank you, ${escapeHtml(recipientName)}.</h1>
        <p style="margin:0 0 26px;color:#4b5d73;font-size:15px;line-height:1.65;">${sample ? 'This is the pre-publication design preview requested by the owner.' : 'Your Early Access payment was verified and your access record was updated.'}</p>
        <div style="padding:22px;background:#fff;border:1px solid #d8dee8;border-radius:10px;">
          <div style="color:#64748b;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Amount acknowledged</div>
          <div style="margin:6px 0 18px;font-family:Georgia,serif;color:#081f3d;font-size:38px;font-weight:700;">${escapeHtml(amount)}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #e2e8f0;">
            ${detailRow('Plan', 'Early Access')}
            ${detailRow('Payment method', method)}
            ${detailRow('Transaction reference', reference)}
            ${detailRow('Payment date provided', paymentDate)}
            ${detailRow('Approved', approvedAt)}
            ${detailRow('Access through', accessEndsAt)}
            ${detailRow('Receipt reference', internalReference)}
          </table>
        </div>
        <div style="margin-top:22px;padding:18px 20px;background:#081f3d;border-radius:10px;color:#fff;">
          <div style="color:#e7c76e;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Next billing</div>
          <p style="margin:8px 0 0;color:#e7edf5;font-size:14px;line-height:1.6;">No automatic billing is scheduled. This access does not renew automatically. Any future offer requires a separate manual purchase.</p>
        </div>
        <p style="margin:22px 0 0;color:#4b5d73;font-size:13px;line-height:1.6;">The exact payment proof reviewed by Due Diligence is attached to this email.</p>
        <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #d8dee8;color:#718096;font-size:11px;line-height:1.6;">This electronic acknowledgment is issued from the payment information submitted and approved in the Due Diligence platform. It is not a bank-issued receipt.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html, internalReference };
}

export async function sendSubscriptionReceiptEmail(env, context = {}) {
  const from = cleanLine(env?.PAYMENT_NOTIFICATION_EMAIL_FROM, 254);
  const apiKey = String(env?.RESEND_API_KEY || '').trim();
  const recipient = validEmail(context?.user?.email);
  const proofBytes = context?.proof?.bytes instanceof Uint8Array
    ? context.proof.bytes
    : new Uint8Array(context?.proof?.bytes || []);
  const proofType = cleanLine(context?.proof?.type, 100).toLowerCase();

  if (!apiKey || !from) return { status: 'not_configured', providerId: null };
  if (!recipient) return { status: 'failed', providerId: null, safeErrorCode: 'recipient_missing' };
  if (!proofBytes.length || proofBytes.length > MAX_ATTACHMENT_BYTES) {
    return { status: 'failed', providerId: null, safeErrorCode: 'proof_size_invalid' };
  }
  if (!ALLOWED_PROOF_TYPES.has(proofType)) {
    return { status: 'failed', providerId: null, safeErrorCode: 'proof_type_invalid' };
  }

  const content = subscriptionReceiptContent(context);
  const paymentId = cleanLine(context?.payment?.id, 80).replace(/[^A-Za-z0-9_-]/g, '');
  const idempotencyKey = context.sample === true
    ? `subscription-receipt-sample-${cleanLine(context.sampleKey, 80).replace(/[^A-Za-z0-9_-]/g, '') || 'owner'}`
    : `subscription-receipt-${paymentId}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.slice(0, 180),
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments: [{
        filename: attachmentName(context?.proof?.name),
        content: bytesToBase64(proofBytes),
      }],
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    console.error('Subscription receipt dispatch failed', { status: response.status });
    return {
      status: 'failed',
      providerId: null,
      safeErrorCode: `provider_${response.status}`,
    };
  }
  return { status: 'sent', providerId: cleanLine(result.id, 180) };
}
