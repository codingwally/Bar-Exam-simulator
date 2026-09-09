import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateDelivery, boundedBytes, detectEvidenceType } from './debate-delivery.mjs';
import { safeCsvCell, renderDebateDocument } from './debate-documents.mjs';
import { DEFAULT_RULES } from './debate-domain.mjs';
import { PDFDocument } from 'pdf-lib';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-test-secret-only' };
const actorId = '10000000-0000-4000-8000-000000000001', eventId = 'de-local-test-event', matchId = '10000000-0000-4000-8000-000000000002';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const stream = bytes => new Response(bytes).body;
function storageFixture(isPublic = false) {
  const objects = new Map(), calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    const path = new URL(url).pathname;
    if (path === '/storage/v1/bucket/debate-private-v3') return Response.json({ id: 'debate-private-v3', public: isPublic });
    if (options.method === 'POST' && path.startsWith('/storage/v1/object/')) { objects.set(path.replace('/storage/v1/object/', ''), new Uint8Array(options.body)); return Response.json({ ok: true }); }
    if (path.startsWith('/storage/v1/object/authenticated/')) { const bytes = objects.get(path.replace('/storage/v1/object/authenticated/', '')); return bytes ? new Response(bytes) : Response.json({ error: 'missing' }, { status: 404 }); }
    throw new Error(`Unexpected external operation ${path}`);
  };
  return { objects, calls, fetcher };
}
test('private storage fails closed before any object is written to a public bucket', async () => {
  const fixture = storageFixture(true), delivery = createDebateDelivery(env, fixture);
  await assert.rejects(delivery.upload({ actorId,eventId,matchId,body:stream(png),mimeType:'image/png',name:'sample.png' }), { code: 'PRIVATE_STORAGE_UNCONFIRMED' });
  assert.equal(fixture.objects.size, 0);
});
test('upload receipt binds exact account, event, match, bytes and expiry', async () => {
  let now = 100000; const fixture = storageFixture(), delivery = createDebateDelivery(env, { ...fixture, now: () => now });
  const upload = await delivery.upload({ actorId,eventId,matchId,body:stream(png),mimeType:'image/png',name:'sample.png' });
  const input = { actorId,eventId,matchId,...upload }; const valid = await delivery.validateEvidence(input);
  assert.equal(valid.verified, true); assert.equal(valid.scanStatus, 'type_checked_not_malware_scanned'); assert.match(valid.storageKey, /^evidence\//);
  await assert.rejects(delivery.validateEvidence({ ...input, actorId: matchId }), { code: 'UPLOAD_INVALID' });
  await assert.rejects(delivery.validateEvidence({ ...input, uploadId: upload.uploadId + 'x' }), { code: 'UPLOAD_INVALID' });
  fixture.objects.set(`debate-private-v3/${valid.storageKey}`, Uint8Array.from([...png, 4]));
  await assert.rejects(delivery.validateEvidence(input), { code: 'UPLOAD_CHANGED' });
  now += 3600001; await assert.rejects(delivery.validateEvidence(input), { code: 'UPLOAD_INVALID' });
});
test('file type and streaming byte bounds are enforced without trusting the header', async () => {
  assert.throws(() => detectEvidenceType(new TextEncoder().encode('<svg onload="x"/>')), { code: 'UNSAFE_FILE' });
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(11)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedBytes(body, 10), { code: 'FILE_TOO_LARGE' }); assert.equal(cancelled, true);
});
test('email remains disabled by default and cannot invoke its provider', async () => {
  let calls = 0; const delivery = createDebateDelivery(env, { fetcher: async () => { calls++; throw new Error(); } });
  await assert.rejects(delivery.mail({ id:'test-mail-job',createdAt:Date.now(),payload:{} }), { code:'EMAIL_DISABLED' }); assert.equal(calls,0);
  const enabled = createDebateDelivery({ ...env, OUTBOUND_EMAIL_MODE:'enabled',DEBATE_RESULTS_EMAIL_MODE:'enabled',RESEND_API_KEY:'fake-test-key',DEBATE_RESULTS_EMAIL_FROM:'test@example.test' }, { fetcher:async()=>{calls++;throw new Error();},now:()=>86400000 });
  await assert.rejects(enabled.mail({ id:'test-mail-job',createdAt:0,payload:{} }), { code:'EMAIL_RECONCILIATION_REQUIRED' }); assert.equal(calls,0);
});
test('CSV neutralizes formula prefixes including whitespace and embedded quotes', () => {
  for (const input of ['=HYPERLINK("x")','  +SUM(A1)','\t@bad','-1+1']) assert.ok(safeCsvCell(input).startsWith('"\''));
  assert.equal(safeCsvCell('A, "B"'), '"A, ""B"""');
});
test('result files retain their version and reject unfinalized or unidentified certificates', async () => {
  const document = { eventId,matchId,createdFor:actorId,eventTitle:'Rehearsal ñ',matchTitle:'Match one',kind:'result',rules:DEFAULT_RULES,rulesVersion:2,resultVersion:'result-test-0001',resultRevision:1,result:{ state:'FINAL',winner:'affirmative',resultKind:'normal',judgingMode:'majority',publishedAt:100000,finalizedAt:100001,awards:{status:'UNAVAILABLE'} } };
  const output = await renderDebateDocument(document); assert.equal(output.mimeType,'application/pdf'); const pdf = await PDFDocument.load(output.bytes); assert.ok(pdf.getPageCount()>0); assert.match(pdf.getSubject(), /Rules 2; result 1/);
  const csv = await renderDebateDocument({...document,kind:'csv'}, {format:'csv'}); assert.match(new TextDecoder().decode(csv.bytes), /result-test-0001/); assert.doesNotMatch(new TextDecoder().decode(csv.bytes),/privateNotes/);
  await assert.rejects(renderDebateDocument({...document,kind:'certificate'}), /identified participant/);
  await assert.rejects(renderDebateDocument({...document,kind:'certificate',participant:{id:actorId,displayName:'Local participant'},certificateType:'award'}),/award must be confirmed/);
});
