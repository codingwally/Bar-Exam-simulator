import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebateDelivery, boundedBytes, detectEvidenceType, DebateDeliveryError } from './debate-delivery.mjs';
import { safeCsvCell, renderDebateDocument } from './debate-documents.mjs';
import { DEFAULT_RULES } from './debate-domain.mjs';
import { PDFDocument } from 'pdf-lib';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-test-secret-only' };
const actorId = '10000000-0000-4000-8000-000000000001', eventId = 'de-local-test-event', matchId = '10000000-0000-4000-8000-000000000002';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const stream = bytes => new Response(bytes).body;
const failedStream = error => new ReadableStream({ start(controller) { controller.error(error); } });
const privateFailure = () => new TypeError('PRIVATE_TRANSPORT_DETAIL_DO_NOT_EXPOSE');
const uploadInput = () => ({ actorId, eventId, matchId, body: stream(png), mimeType: 'image/png', name: 'sample.png' });
function safeStage(code) {
  return error => {
    assert.equal(error.code, code); assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /PRIVATE_|TypeError|AbortError|bucket|provider/i);
    assert.equal(Object.hasOwn(error, 'cause'), false, 'The private exception is not retained');
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_|local-test-secret-only/);
    return true;
  };
}
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
const redirectRejected = error => {
  assert.ok(error instanceof DebateDeliveryError);
  assert.equal(error.code, 'DELIVERY_REDIRECT_REJECTED'); assert.equal(error.status, 503);
  assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_|https:|local-test-secret-only/);
  assert.equal(Object.hasOwn(error, 'cause'), false); return true;
};
test('every 300–399 status is refused after one credential-scoped manual request', async () => {
  for (let status = 300; status < 400; status++) for (const location of ['https://example.supabase.co/PRIVATE_redirect', 'https://other.invalid/PRIVATE_redirect']) {
    const calls = [];
    const delivery = createDebateDelivery(env, { fetcher: async (url, options) => {
      calls.push(url); assert.equal(url, env.SUPABASE_URL + '/storage/v1/bucket/debate-private-v3');
      assert.equal(options.redirect, 'manual'); assert.equal(options.method || 'GET', 'GET');
      assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization, 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
      return new Response(null, { status, headers: { Location: location } });
    } });
    await assert.rejects(delivery.upload(uploadInput()), redirectRejected);
    assert.equal(calls.length, 1, `${status}: no redirect target or retry is requested`);
  }
});
for (const operation of ['write', 'read', 'delete', 'recipient']) test(`${operation} redirects preserve the initial request and never follow its Location`, async () => {
  const calls = [], key = `evidence/${eventId}/${matchId}/upload-test-0001.png`;
  const delivery = createDebateDelivery(env, { fetcher: async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    assert.equal(new URL(url).origin, env.SUPABASE_URL); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    if (url.endsWith('/storage/v1/bucket/debate-private-v3')) return Response.json({ id: 'debate-private-v3', public: false });
    assert.equal(options.method || 'GET', { write: 'POST', read: 'GET', delete: 'DELETE', recipient: 'GET' }[operation]);
    if (operation === 'write') assert.deepEqual(options.body, png);
    if (operation === 'delete') assert.deepEqual(JSON.parse(options.body), { prefixes: [key] });
    return new Response(null, { status: 307, headers: { Location: 'https://other.invalid/PRIVATE_redirect' } });
  } });
  const action = { write: () => delivery.upload(uploadInput()), read: () => delivery.download(key),
    delete: () => delivery.delete_evidence({ eventId, payload: { storageKey: key } }), recipient: () => delivery.recipientEmail(actorId) }[operation];
  await assert.rejects(action(), redirectRejected);
  assert.equal(calls.length, operation === 'recipient' ? 1 : 2);
});
for (const cancellation of ['rejects', 'never-settles']) test(`a redirect body whose cancellation ${cancellation} is never read and cannot delay rejection`, { timeout: 1000 }, async () => {
  let reads = 0, cancelled = 0, calls = 0;
  const body = new ReadableStream({ pull() { reads++; throw privateFailure(); }, cancel() { cancelled++; return cancellation === 'rejects' ? Promise.reject(privateFailure()) : new Promise(() => {}); } }, { highWaterMark: 0 });
  const delivery = createDebateDelivery(env, { fetcher: async () => { calls++; return new Response(body, { status: 302, headers: { Location: 'https://other.invalid/PRIVATE_redirect' } }); } });
  await assert.rejects(delivery.upload(uploadInput()), redirectRejected);
  assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(cancelled, 1);
});

test('private storage fails closed before any object is written to a public bucket', async () => {
  const fixture = storageFixture(true), delivery = createDebateDelivery(env, fixture);
  await assert.rejects(delivery.upload({ actorId,eventId,matchId,body:stream(png),mimeType:'image/png',name:'sample.png' }), { code: 'PRIVATE_STORAGE_UNCONFIRMED' });
  assert.equal(fixture.objects.size, 0);
});
test('input stream failures get safe guidance before any storage request', async () => {
  let calls = 0; const delivery = createDebateDelivery(env, { fetcher: async () => { calls++; assert.fail('No storage request'); } });
  await assert.rejects(delivery.upload({ ...uploadInput(), body: failedStream(privateFailure()) }), safeStage('EVIDENCE_INPUT_READ_FAILED'));
  assert.equal(calls, 0);
});

for (const stage of ['bucket','write','readback']) for (const failure of ['fetch','response-status','body']) {
  test(`${stage} ${failure} failure is classified without repeating a request or hiding file scope`, async () => {
    const storage = storageFixture(); const attempted = [];
    const fetcher = async (url, options) => {
      const current = new URL(url).pathname.startsWith('/storage/v1/bucket/') ? 'bucket' : options.method === 'POST' ? 'write' : 'readback';
      attempted.push(current);
      if (stage !== current) return storage.fetcher(url, options);
      if (failure === 'fetch') throw privateFailure();
      await storage.fetcher(url, options);
      if (failure === 'body') return new Response(failedStream(privateFailure()));
      return Object.defineProperty(new Response('{}'), 'ok', { get() { throw privateFailure(); } });
    };
    const delivery = createDebateDelivery(env, { fetcher });
    const operation = async () => {
      const upload = await delivery.upload(uploadInput());
      if (stage === 'readback') await delivery.validateEvidence({ actorId, eventId, matchId, ...upload });
    };
    await assert.rejects(operation(), safeStage({ bucket: 'EVIDENCE_BUCKET_CHECK_FAILED', write: 'EVIDENCE_WRITE_FAILED', readback: 'EVIDENCE_READBACK_FAILED' }[stage]));
    assert.equal(attempted.filter(value => value === stage).length, 1);
    assert.equal(storage.objects.size, stage === 'bucket' || stage === 'write' && failure === 'fetch' ? 0 : 1);
    assert.ok(attempted.length <= 4, 'No fallback or retry request follows an uncertain failure');
  });
}

test('the real timeout abort class is classified rather than leaking its numeric DOMException code', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ready; const started = new Promise(resolve => { ready = resolve; }); let calls = 0;
  const delivery = createDebateDelivery(env, { fetcher: async (_url, { signal }) => {
    calls++; ready(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      assert.equal(signal.reason.name, 'AbortError'); assert.equal(signal.reason.code, 20); reject(signal.reason);
    }, { once: true }));
  } });
  const pending = assert.rejects(delivery.upload(uploadInput()), safeStage('EVIDENCE_BUCKET_CHECK_FAILED'));
  await started; t.mock.timers.tick(15000); await pending; assert.equal(calls, 1);
});

for (const operation of ['digest','importKey','sign']) test(`${operation} runtime failure retains the written file scope and exposes no cryptographic detail`, async t => {
  const storage = storageFixture(), delivery = createDebateDelivery(env, storage);
  t.mock.method(crypto.subtle, operation, () => { throw privateFailure(); });
  await assert.rejects(delivery.upload(uploadInput()), safeStage('EVIDENCE_SEAL_FAILED'));
  assert.equal(storage.objects.size, 1); assert.equal(storage.calls.filter(call => call.method === 'POST').length, 1);
});

test('existing application failures retain the identical error object, code, message and status', async t => {
  const original = new DebateDeliveryError('EXISTING_REJECTION', 'Existing actionable rejection', 409);
  for (const stage of ['input','bucket','write','readback','seal']) {
    const storage = storageFixture();
    const fetcher = async (url, options) => {
      const current = new URL(url).pathname.startsWith('/storage/v1/bucket/') ? 'bucket' : options.method === 'POST' ? 'write' : 'readback';
      if (current === stage) throw original;
      return storage.fetcher(url, options);
    };
    const delivery = createDebateDelivery(env, { fetcher });
    const sign = stage === 'seal' ? t.mock.method(crypto.subtle, 'sign', () => { throw original; }) : null;
    await assert.rejects(async () => {
      const upload = await delivery.upload({ ...uploadInput(), ...(stage === 'input' ? { body: failedStream(original) } : {}) });
      if (stage === 'readback') await delivery.validateEvidence({ actorId, eventId, matchId, ...upload });
    }, error => error === original && error.status === 409 && error.code === 'EXISTING_REJECTION');
    sign?.mock.restore();
  }
});

test('native string error codes cannot expose private argument or header details', async () => {
  for (const code of ['ERR_INVALID_ARG_VALUE','ERR_INVALID_CHAR']) {
    const failure = Object.assign(new TypeError('PRIVATE_HEADER_Bearer_local-test-secret-only'), { code, status: 418 });
    let calls = 0;
    const delivery = createDebateDelivery(env, { fetcher: async () => { calls++; throw failure; } });
    await assert.rejects(delivery.upload(uploadInput()), safeStage('EVIDENCE_BUCKET_CHECK_FAILED'));
    assert.equal(calls, 1);
  }
});

test('the shared export and download paths receive file guidance without an extra write or changed HTTP rejection', async () => {
  const storage = storageFixture(); let writes = 0;
  const delivery = createDebateDelivery(env, { fetcher: async (url, options) => {
    if (options.method === 'POST') { writes++; throw privateFailure(); }
    return storage.fetcher(url, options);
  } });
  const document = { eventId, matchId, createdFor: actorId, eventTitle: 'Test event', matchTitle: 'Test match',
    kind: 'csv', rules: DEFAULT_RULES, rulesVersion: 1, resultRevision: 1, resultVersion: 'result-test-0001',
    result: { state: 'FINAL', winner: 'affirmative', resultKind: 'normal', judgingMode: 'majority', awards: { status: 'UNAVAILABLE' } } };
  await assert.rejects(delivery.export({ id: 'export-test-0001', eventId, payload: { document, format: 'csv' } }), safeStage('EVIDENCE_WRITE_FAILED'));
  assert.equal(writes, 1);
  await assert.rejects(delivery.download(`exports/${eventId}/export-test-0001.csv`), { code: 'DOWNLOAD_UNAVAILABLE', status: 404 });
  assert.equal(writes, 1);
});

test('a digest failure during stored-byte verification is classified after exactly one write', async t => {
  const storage = storageFixture(), delivery = createDebateDelivery(env, storage);
  const upload = await delivery.upload(uploadInput());
  t.mock.method(crypto.subtle, 'digest', () => { throw new DOMException('PRIVATE_DIGEST_DETAIL', 'DataError'); });
  await assert.rejects(delivery.validateEvidence({ actorId, eventId, matchId, ...upload }), safeStage('EVIDENCE_SEAL_FAILED'));
  assert.equal(storage.objects.size, 1); assert.equal(storage.calls.filter(call => call.method === 'POST').length, 1);
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
