import { renderDebateDocument } from './debate-documents.mjs';
import { resolvedEmailMode } from './outbound-email-policy.mjs';

const encoder = new TextEncoder();
const opaque = /^[a-zA-Z0-9:_-]{8,160}$/u;
const MAX_FILE = 10485760;
export class DebateDeliveryError extends Error { constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; } }
const requireThat = (ok, code, message, status) => { if (!ok) throw new DebateDeliveryError(code, message, status); };
const b64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const filename = value => String(value || 'evidence').normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'evidence';
const emailAddress = value => String(value || '').trim().toLowerCase();
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

export async function boundedBytes(body, maximum = MAX_FILE) {
  requireThat(body?.getReader, 'FILE_REQUIRED', 'Choose a file to upload.', 400);
  const reader = body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; requireThat(size <= maximum, 'FILE_TOO_LARGE', 'Use a file no larger than 10 MB.', 413); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return bytes;
}
export function detectEvidenceType(bytes) {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (bytes.length >= 10 && new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-' && new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF')) return 'application/pdf';
  throw new DebateDeliveryError('UNSAFE_FILE', 'Choose a valid PDF, PNG or JPEG file.', 400);
}

export function createDebateDelivery(env, { fetcher = fetch, now = Date.now } = {}) {
  function config() {
    let base; try { base = new URL(env.SUPABASE_URL); } catch { /* Fail below. */ }
    requireThat(base?.protocol === 'https:' && env.SUPABASE_SERVICE_ROLE_KEY, 'STORAGE_UNCONFIGURED', 'Private debate file storage is not configured.');
    const bucket = env.DEBATE_STORAGE_BUCKET || 'debate-private-v3';
    requireThat(/^[a-z0-9-]{3,63}$/.test(bucket), 'STORAGE_UNCONFIGURED', 'The private storage bucket is invalid.');
    return { base: base.origin, bucket, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } };
  }
  async function send(url, options = {}, max = 200000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try { const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal }); const bytes = response.body ? await boundedBytes(response.body, max) : new Uint8Array(); return { response, bytes }; }
    finally { clearTimeout(timer); }
  }
  async function privateBucket() {
    const c = config(), { response, bytes } = await send(`${c.base}/storage/v1/bucket/${c.bucket}`, { headers: c.headers });
    let bucket; try { bucket = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Fail below. */ }
    requireThat(response.ok && bucket?.id === c.bucket && bucket.public === false, 'PRIVATE_STORAGE_UNCONFIRMED', 'The debate storage bucket must be verified private before files can be saved.'); return c;
  }
  const validKey = key => /^(exports|evidence)\/[a-zA-Z0-9:_-]{8,160}\/(?:[a-zA-Z0-9:_-]{8,160}\/)?[a-zA-Z0-9_-]{8,160}\.(pdf|csv|png|jpg)$/.test(key);
  async function put(key, bytes, mimeType, overwrite = false) {
    requireThat(validKey(key), 'INVALID_FILE_KEY', 'The file identifier is invalid.', 400); const c = await privateBucket();
    const { response } = await send(`${c.base}/storage/v1/object/${c.bucket}/${key}`, { method: 'POST', headers: { ...c.headers, 'Content-Type': mimeType, 'x-upsert': String(overwrite), 'Cache-Control': 'private, no-store' }, body: bytes });
    requireThat(response.ok, 'STORAGE_WRITE_UNCONFIRMED', 'Saving this private file could not be confirmed. Retry using the same export job.');
  }
  async function download(key, max = MAX_FILE) {
    requireThat(validKey(key), 'INVALID_FILE_KEY', 'The file identifier is invalid.', 400); const c = await privateBucket();
    const { response, bytes } = await send(`${c.base}/storage/v1/object/authenticated/${c.bucket}/${key}`, { headers: c.headers }, max);
    requireThat(response.ok, 'DOWNLOAD_UNAVAILABLE', 'This private file is unavailable. Generate a new copy or ask the organizer.', 404); return bytes;
  }
  async function exportFile(job) {
    const output = await renderDebateDocument(job.payload.document, { format: job.payload.format });
    const key = `exports/${job.eventId}/${job.id}.${job.payload.format === 'csv' ? 'csv' : 'pdf'}`;
    await put(key, output.bytes, output.mimeType, true);
    return { status: 'ready', downloadId: job.id, storageKey: key, filename: output.filename, mimeType: output.mimeType };
  }
  async function signingKey() { config(); return crypto.subtle.importKey('raw', encoder.encode(`duediligence-debate-v3-evidence:${env.SUPABASE_SERVICE_ROLE_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
  async function seal(value) { const payload = b64(encoder.encode(JSON.stringify(value))); return `${payload}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload))))}`; }
  async function unseal(value) {
    try { const [payload, signature, extra] = String(value).split('.'); if (extra || value.length > 4096 || !await crypto.subtle.verify('HMAC', await signingKey(), unb64(signature), encoder.encode(payload))) throw new Error(); return JSON.parse(new TextDecoder().decode(unb64(payload))); }
    catch { throw new DebateDeliveryError('UPLOAD_INVALID', 'We could not verify this upload. Upload the file again.', 403); }
  }
  async function upload({ actorId, eventId, matchId, channel, body, mimeType, name, reservation }) {
    requireThat([actorId,eventId,matchId].every(v => opaque.test(v)), 'UPLOAD_INVALID', 'The upload destination is invalid.', 400);
    if (reservation) requireThat(['actorId','eventId','matchId','channel','mimeType'].every(key => reservation[key] === ({ actorId,eventId,matchId,channel,mimeType })[key]) && /^[0-9a-f-]{36}$/i.test(reservation.id) && Number.isSafeInteger(reservation.expiresAt) && reservation.expiresAt > now(), 'UPLOAD_INVALID', 'This upload reservation does not match the authorized destination.', 403);
    const bytes = await boundedBytes(body); requireThat(bytes.length > 0 && detectEvidenceType(bytes) === mimeType, 'UNSAFE_FILE', 'The file type does not match its contents.', 400);
    const id = reservation?.id || crypto.randomUUID(), extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg', storageKey = `evidence/${eventId}/${matchId}/${id}.${extension}`;
    requireThat(!reservation || reservation.storageKey === storageKey, 'UPLOAD_INVALID', 'This upload reservation has an invalid storage binding.', 403);
    await put(storageKey, bytes, mimeType);
    const receipt = { id, actorId, eventId, matchId, ...(channel ? { channel } : {}), storageKey, mimeType, size: bytes.length, digest: await digest(bytes), filename: `${filename(name).replace(/\.[^.]+$/, '')}.${extension}`, expiresAt: reservation?.expiresAt || now() + 3600000 };
    return { uploadId: await seal(receipt), mimeType, size: bytes.length };
  }
  async function validateEvidence(input) {
    const receipt = await unseal(input.uploadId);
    requireThat(receipt.expiresAt > now() && ['actorId','eventId','matchId','mimeType','size'].every(k => receipt[k] === input[k]) && (!receipt.channel || receipt.channel === input.channel), 'UPLOAD_INVALID', 'This upload does not belong to this account and match, or has expired.', 403);
    const bytes = await download(receipt.storageKey);
    requireThat(bytes.length === receipt.size && detectEvidenceType(bytes) === receipt.mimeType && await digest(bytes) === receipt.digest, 'UPLOAD_CHANGED', 'The uploaded file changed. Upload it again.', 409);
    return { verified: true, id: receipt.id, storageKey: receipt.storageKey, mimeType: receipt.mimeType, size: receipt.size, digest: receipt.digest, filename: receipt.filename, scanStatus: 'type_checked_not_malware_scanned' };
  }
  async function downloadEvidence(meta) {
    requireThat(Number.isSafeInteger(meta.size) && meta.size > 0 && meta.size <= MAX_FILE && /^[a-f0-9]{64}$/.test(meta.digest || ''), 'EVIDENCE_INTEGRITY_UNCONFIRMED', 'This evidence file needs its verified file record restored before downloading.', 409);
    const bytes = await download(meta.storageKey, meta.size);
    requireThat(bytes.length === meta.size && detectEvidenceType(bytes) === meta.mimeType && await digest(bytes) === meta.digest, 'UPLOAD_CHANGED', 'The saved evidence file changed. Ask its author to upload it again.', 409);
    return bytes;
  }
  async function deleteEvidence(job) {
    const key = job.payload.storageKey; requireThat(validKey(key) && key.startsWith(`evidence/${job.eventId}/`), 'INVALID_FILE_KEY', 'The file identifier is invalid.', 400); const c = await privateBucket();
    const { response } = await send(`${c.base}/storage/v1/object/${c.bucket}`, { method: 'DELETE', headers: { ...c.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
    requireThat(response.ok, 'DELETE_UNCONFIRMED', 'File deletion is not confirmed.'); return { status: 'deleted' };
  }
  async function deleteExport(job) {
    const key = job.payload.storageKey, sourceId = job.payload.sourceJobId;
    requireThat(opaque.test(job.eventId || '') && opaque.test(sourceId || '') && validKey(key) && ['pdf', 'csv'].some(extension => key === `exports/${job.eventId}/${sourceId}.${extension}`), 'INVALID_FILE_KEY', 'This export deletion is not bound to its recorded export job.', 400);
    const c = await privateBucket();
    const { response } = await send(`${c.base}/storage/v1/object/${c.bucket}`, { method: 'DELETE', headers: { ...c.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
    requireThat(response.ok, 'DELETE_UNCONFIRMED', 'Export deletion is not confirmed.'); return { status: 'deleted' };
  }
  async function invitationKey() {
    config();
    const material = await crypto.subtle.importKey('raw', encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('duediligence-debate-v3'), info: encoder.encode('invitation-mail-sealing-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const invitationContext = encoder.encode('duediligence-debate-invitation-v1');
  async function sealInvitation(input) {
    const recipientEmail = emailAddress(input.recipientEmail), secret = String(input.secret || '').trim().toUpperCase();
    requireThat(opaque.test(input.eventId || '') && opaque.test(input.inviteId || '') && validEmail(recipientEmail) && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(secret)
      && Number.isSafeInteger(input.expiresAt) && input.expiresAt > now(), 'INVITATION_INVALID', 'Review the current invitation and intended recipient before sending.', 400);
    const iv = crypto.getRandomValues(new Uint8Array(12)), plain = { eventId: input.eventId, inviteId: input.inviteId, recipientEmail, secret, expiresAt: input.expiresAt, inviteDigest: await digest(encoder.encode(secret)) };
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: invitationContext }, await invitationKey(), encoder.encode(JSON.stringify(plain)));
    return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
  }
  async function openInvitation(value) {
    try {
      requireThat(typeof value === 'string' && value.length <= 4096, 'INVITATION_INVALID', 'Invalid invitation.');
      const [version, vector, ciphertext, extra] = value.split('.'), iv = unb64(vector);
      if (version !== 'v1' || extra || iv.byteLength !== 12) throw new Error();
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: invitationContext }, await invitationKey(), unb64(ciphertext))));
    } catch { throw new DebateDeliveryError('INVITATION_INVALID', 'This invitation delivery cannot be verified. Create a new invitation instead.', 409); }
  }
  async function invitationMail(job) {
    const from = env.DEBATE_INVITATION_EMAIL_FROM || env.DEBATE_RESULTS_EMAIL_FROM;
    requireThat(resolvedEmailMode(env, env.DEBATE_INVITATION_EMAIL_MODE) === 'enabled' && env.RESEND_API_KEY && from && !/[\r\n]/.test(from), 'EMAIL_DISABLED', 'Invitation email is not enabled. The organizer can still share the invitation link.');
    requireThat(Number.isSafeInteger(job.createdAt) && now() - job.createdAt < 23 * 3600000, 'EMAIL_RECONCILIATION_REQUIRED', 'This old invitation send needs provider reconciliation before another attempt.', 409);
    const p = job.payload, recipientEmail = emailAddress(p.recipientEmail), secret = await openInvitation(p.sealedInvitation);
    requireThat(validEmail(recipientEmail) && secret.recipientEmail === recipientEmail && secret.eventId === job.eventId && secret.inviteId === p.inviteId
      && secret.expiresAt === p.expiresAt && secret.expiresAt > now() && secret.inviteDigest === p.inviteDigest, 'INVITATION_INVALID', 'This invitation no longer matches its intended recipient or validity period.', 409);
    if (p.rehearsal) requireThat(String(env.DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS || '').split(',').map(emailAddress).includes(recipientEmail), 'REHEARSAL_RECIPIENT_UNAPPROVED', 'Rehearsal invitation email is limited to the approved test recipients.', 403);
    const eventTitle = String(p.eventTitle || 'Debate Room event').replace(/[\r\n]/g, ' ').slice(0, 180);
    const link = `https://duediligence.ph/debate-room/#event=${encodeURIComponent(job.eventId)}&invite=${encodeURIComponent(secret.secret)}`;
    const payload = { from, to: [recipientEmail], subject: `${p.rehearsal ? '[Rehearsal] ' : ''}Invitation: ${eventTitle}`,
      text: `You have been invited to ${eventTitle}.\n\nSign in to your Due Diligence account and review this invitation:\n${link}\n\nInvitation expires: ${new Date(secret.expiresAt).toISOString()}.\nAn organizer may need to admit you after you join. This invitation does not override the event's role or admission requirements.\nShare this invitation only with its intended recipient.` };
    let response;
    try { response = await send('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `debate-invitation/${job.id}` }, body: JSON.stringify(payload) }); }
    catch { throw new DebateDeliveryError('EMAIL_ACCEPTANCE_UNCONFIRMED', 'The invitation response was unconfirmed. Retry only this same delivery job within its reconciliation window.', 409); }
    let receipt; try { receipt = JSON.parse(new TextDecoder().decode(response.bytes)); } catch { /* Fail below. */ }
    requireThat(response.response.ok && typeof receipt?.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(receipt.id), 'EMAIL_ACCEPTANCE_UNCONFIRMED', 'The provider did not confirm invitation acceptance. Keep the same job when retrying.', 409);
    return { status: 'accepted', deliveryStatus: 'accepted_not_delivery_confirmed', providerId: receipt.id };
  }
  async function recipientEmail(recipientId) {
    requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientId || ''), 'EMAIL_RECIPIENT_INVALID', 'Choose an existing account.', 400);
    const c = config(), account = await send(`${c.base}/auth/v1/admin/users/${recipientId}`, { headers: c.headers });
    let user; try { user = JSON.parse(new TextDecoder().decode(account.bytes)); } catch { /* Fail below. */ }
    const email = emailAddress(user?.email);
    requireThat(account.response.ok && user?.id === recipientId && typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at)) && !user.deleted_at
      && (user.is_anonymous == null || user.is_anonymous === false) && (user.banned_until == null || user.banned_until === '' || (typeof user.banned_until === 'string' && Date.parse(user.banned_until) <= now()))
      && validEmail(email), 'EMAIL_VERIFICATION_REQUIRED', 'The selected recipient needs a currently verified, active account email.', 409);
    return email;
  }
  async function mail(job) {
    requireThat(resolvedEmailMode(env, env.DEBATE_RESULTS_EMAIL_MODE) === 'enabled' && env.RESEND_API_KEY && env.DEBATE_RESULTS_EMAIL_FROM && !/[\r\n]/.test(env.DEBATE_RESULTS_EMAIL_FROM), 'EMAIL_DISABLED', 'Result email is not enabled. Authorized downloads remain available.');
    // Resend retains idempotency keys for 24 hours. Never replay an old uncertain send.
    requireThat(now() - job.createdAt < 23 * 3600000, 'EMAIL_RECONCILIATION_REQUIRED', 'This old send needs provider reconciliation before another delivery attempt.', 409);
    const recipient = await recipientEmail(job.payload.recipientId);
    const doc = job.payload.document, output = await renderDebateDocument(doc);
    const payload = { from: env.DEBATE_RESULTS_EMAIL_FROM, to: [recipient], subject: `${doc.rehearsal ? '[Rehearsal] ' : ''}Debate result: ${doc.eventTitle}`.replace(/[\r\n]/g, ' ').slice(0, 180), text: `${doc.eventTitle}\n${doc.matchTitle}\nResult version ${doc.resultRevision}: ${doc.result.state}\nThe attached PDF reflects this published version. Sign in to view current records and any corrections: https://duediligence.ph/debate-room/#event=${encodeURIComponent(doc.eventId)}&match=${encodeURIComponent(doc.matchId)}\nAudience Choice is separate from the official decision.`, attachments: [{ filename: output.filename, content_type: output.mimeType, content: b64(output.bytes) }] };
    let delivery; try { delivery = await send('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `debate-result/${job.id}` }, body: JSON.stringify(payload) }); }
    catch { throw new DebateDeliveryError('EMAIL_ACCEPTANCE_UNCONFIRMED', 'The email response was unconfirmed. Retry only this same delivery job within its reconciliation window.', 409); }
    let receipt; try { receipt = JSON.parse(new TextDecoder().decode(delivery.bytes)); } catch { /* Fail below. */ }
    requireThat(delivery.response.ok && typeof receipt?.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(receipt.id), 'EMAIL_ACCEPTANCE_UNCONFIRMED', 'The provider did not confirm acceptance. Keep the same delivery job when retrying.', 409);
    return { status: 'accepted', deliveryStatus: 'accepted_not_delivery_confirmed', providerId: receipt.id };
  }
  return { export: exportFile, download, downloadEvidence, upload, validateEvidence, delete_evidence: deleteEvidence, delete_export: deleteExport, mail, sealInvitation, invitation_mail: invitationMail, recipientEmail };
}
