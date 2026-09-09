// Inert service binding. It cannot call fetch or any provider.
export const INERT_KEY = 'inert-delivery-runtime-key-no-credentials';
const ORIGIN = 'https://storage.fixture.invalid';
const BUCKET = '/storage/v1/bucket/debate-private-v3';
const ROOT = '/storage/v1/object/debate-private-v3/';
const AUTHENTICATED = '/storage/v1/object/authenticated/debate-private-v3/';
const FILE = /^evidence\/de-a{32}\/10000000-0000-4000-8000-000000000002\/10000000-0000-4000-8000-00000000000[34]\.pdf$/;
const need = (ok, code) => { if (!ok) throw new Error(code); };
export function createFakeStorage() {
  const objects = new Map(), calls = [];
  return { async fetch(request) {
    const url = new URL(request.url);
    need(url.origin === ORIGIN && !url.search && !url.hash, 'INERT_STORAGE_TARGET_REJECTED');
    if (url.pathname === '/__report') { need(request.method === 'GET', 'INERT_REPORT_METHOD'); return Response.json({ calls, objectsRemaining: objects.size }); }
    need(request.headers.get('apikey') === INERT_KEY && request.headers.get('authorization') === 'Bearer ' + INERT_KEY, 'INERT_STORAGE_HEADERS_REJECTED');
    if (request.method === 'GET' && url.pathname === BUCKET) { calls.push({ method: 'GET', operation: 'private_bucket' }); return Response.json({ id: 'debate-private-v3', public: false }); }
    if (request.method === 'POST' && url.pathname.startsWith(ROOT)) {
      const key = url.pathname.slice(ROOT.length);
      need(FILE.test(key) && !objects.has(key), 'INERT_STORAGE_WRITE_SCOPE');
      need(request.headers.get('content-type') === 'application/pdf' && request.headers.get('x-upsert') === 'false', 'INERT_STORAGE_WRITE_HEADERS');
      const bytes = new Uint8Array(await request.arrayBuffer());
      need(bytes.length > 0 && bytes.length < 1024, 'INERT_STORAGE_FILE_BOUND');
      objects.set(key, bytes); calls.push({ method: 'POST', operation: 'private_write', bytes: bytes.length });
      return Response.json({ Key: key });
    }
    if (request.method === 'GET' && url.pathname.startsWith(AUTHENTICATED)) {
      const key = url.pathname.slice(AUTHENTICATED.length);
      need(FILE.test(key) && objects.has(key), 'INERT_STORAGE_READ_SCOPE');
      calls.push({ method: 'GET', operation: 'private_read' });
      return new Response(objects.get(key), { headers: { 'Content-Type': 'application/pdf' } });
    }
    if (request.method === 'DELETE' && url.pathname === ROOT.slice(0, -1)) {
      const body = await request.json();
      need(Array.isArray(body.prefixes) && body.prefixes.length === 1 && FILE.test(body.prefixes[0]) && objects.has(body.prefixes[0]), 'INERT_STORAGE_DELETE_SCOPE');
      objects.delete(body.prefixes[0]); calls.push({ method: 'DELETE', operation: 'private_delete' });
      return Response.json({ deleted: true });
    }
    throw new Error('INERT_STORAGE_ROUTE_REJECTED');
  } };
}
export default createFakeStorage();
