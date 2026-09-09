// Execute the actual adapter without replacing fetch, crypto or stream primitives.
import { createDebateDelivery } from '../../worker/debate-delivery.mjs';
const need = (ok, message) => { if (!ok) throw new Error(message); };
export default { async fetch(request, env) {
  let stage = 'input';
  try {
    const mode = new URL(request.url).pathname;
    const redirectPhase = /^\/redirect\/(bucket|write|read|delete)$/.exec(mode)?.[1];
    need(request.method === 'POST' && (['/direct', '/multipart'].includes(mode) || redirectPhase), 'INERT_INPUT_ROUTE');
    const body = mode === '/multipart' ? (await request.formData()).get('file').stream() : request.body;
    const context = { actorId: '10000000-0000-4000-8000-000000000001', eventId: 'de-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', matchId: '10000000-0000-4000-8000-000000000002', channel: 'public', mimeType: 'application/pdf' };
    const id = mode === '/direct' ? '10000000-0000-4000-8000-000000000003' : '10000000-0000-4000-8000-000000000004';
    const storageKey = `evidence/${context.eventId}/${context.matchId}/${id}.pdf`;
    const reservation = { ...context, id, storageKey, expiresAt: Date.now() + 60000 };
    const delivery = createDebateDelivery(env);
    if (redirectPhase) {
      stage = 'redirect_' + redirectPhase;
      try {
        if (redirectPhase === 'bucket' || redirectPhase === 'write') await delivery.upload({ ...context, body, name: 'inert.pdf', reservation });
        else if (redirectPhase === 'read') await delivery.download(storageKey);
        else await delivery.delete_evidence({ eventId: context.eventId, payload: { storageKey } });
      } catch (error) {
        need(error.code === 'DELIVERY_REDIRECT_REJECTED' && error.status === 503, 'INERT_REDIRECT_ERROR_SHAPE');
        return Response.json({ ok: true, redirectRejected: true, phase: redirectPhase, code: error.code, status: error.status });
      }
      throw new Error('INERT_REDIRECT_WAS_ACCEPTED');
    }
    stage = 'upload';
    const uploaded = await delivery.upload({ ...context, body, name: 'inert.pdf', reservation });
    need(uploaded.mimeType === context.mimeType && uploaded.size > 0 && typeof uploaded.uploadId === 'string', 'INERT_UPLOAD_SHAPE');
    stage = 'validate';
    const meta = await delivery.validateEvidence({ ...context, uploadId: uploaded.uploadId, size: uploaded.size });
    need(meta.verified === true && meta.id === id && meta.storageKey === storageKey, 'INERT_VALIDATION_SHAPE');
    stage = 'download';
    const downloaded = await delivery.downloadEvidence(meta);
    need(downloaded.byteLength === uploaded.size, 'INERT_DOWNLOAD_SIZE');
    const downloadSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', downloaded)), byte => byte.toString(16).padStart(2, '0')).join('');
    stage = 'foreign_receipt';
    let foreignReceiptDenied = false;
    try { await delivery.validateEvidence({ ...context, actorId: '10000000-0000-4000-8000-000000000099', uploadId: uploaded.uploadId, size: uploaded.size }); }
    catch (error) { foreignReceiptDenied = error.code === 'UPLOAD_INVALID' && error.status === 403; }
    need(foreignReceiptDenied, 'INERT_FOREIGN_RECEIPT_ACCEPTED');
    stage = 'delete';
    const deleted = await delivery.delete_evidence({ eventId: context.eventId, payload: { storageKey } });
    need(deleted.status === 'deleted', 'INERT_DELETE_SHAPE');
    return Response.json({ ok: true, size: uploaded.size, mimeType: uploaded.mimeType, downloadSha256, foreignReceiptDenied, deleted: true });
  } catch (error) {
    // Every input and binding is inert. Never emit the sealed receipt or headers.
    return Response.json({ ok: false, stage, error: { name: String(error.name).slice(0, 80), code: typeof error.code === 'string' ? error.code.slice(0, 100) : null, message: String(error.message).replace(/inert-delivery-runtime-key-no-credentials/g, '[inert-key]').slice(0, 600), stack: String(error.stack).split('\n').slice(0, 5).map(line => line.slice(0, 180)) } }, { status: 500 });
  }
} };
