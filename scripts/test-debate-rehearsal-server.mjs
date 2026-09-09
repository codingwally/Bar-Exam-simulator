/** Local HTTP perimeter checks. Explicit MemoryStore here is not SQL/persistence evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startLocalDebateServer, createRehearsalRuntime } from './serve-debate-rehearsal.mjs';

test('local rehearsal HTTP perimeter and real command authorization', async t => {
  const server = await startLocalDebateServer({ port: 0, storeMode: 'memory' });
  t.after(() => server.close());
  const origin = new URL(server.url).origin, checks = [];
  const request = (pathname, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.port, path: pathname, method,
      headers: { ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8'),
      }));
    }); req.on('error', reject); req.end(body);
  });
  const expect = (name, actual, expected) => { assert.equal(actual, expected, name); checks.push({ name, status: 'PASS' }); };
  const getIdentity = async actorId => JSON.parse((await request('/__rehearsal/identity', { headers: actorId ? { Cookie: `dd_debate_local_actor=${actorId}` } : {} })).text);
  const hostIdentity = await getIdentity(), observerIdentity = await getIdentity(server.actors[9].id);
  expect('Only fixed ten synthetic accounts are exposed', hostIdentity.actors.length, 10);
  expect('Opaque actor switch uses selected fixed local actor', observerIdentity.user.id, server.actors[9].id);
  expect('Unauthenticated events are denied', (await request('/debate-room/events')).status, 401);
  expect('An invented fake bearer is denied', (await request('/debate-room/events', { headers: { Authorization: `Bearer local-rehearsal:${server.actors[0].id}:wrong` } })).status, 401);
  expect('Host rebinding is denied', (await request('/__rehearsal/identity', { headers: { Host: 'attacker.test' } })).status, 403);
  expect('Cross-origin identity reads are denied', (await request('/__rehearsal/identity', { headers: { Origin: 'https://attacker.test' } })).status, 403);
  expect('POST without same-origin proof is denied', (await request('/__rehearsal/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"milliseconds":1}' })).status, 403);
  expect('Cross-origin mutation is denied', (await request('/__rehearsal/advance', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{"milliseconds":1}' })).status, 403);
  expect('Unsupported methods are denied', (await request('/debate-room/', { method: 'DELETE' })).status, 405);
  for (const target of ['/worker/debate-service.mjs', '/scripts/serve-debate-rehearsal.mjs', '/.env', '/package.json', '/exports/secret.pdf', '/assets/../worker/debate-service.mjs', '/assets/%2e%2e%2fworker%2fdebate-service.mjs', '/assets/%5c..%5cworker%5cdebate-service.mjs']) {
    expect(`Private or traversed path unavailable: ${target}`, (await request(target)).status, 404);
  }
  const page = await request('/debate-room/'); expect('Only built Debate page is served', page.status, 200);
  assert.match(page.text, /LOCAL SOFTWARE REHEARSAL/); assert.match(page.text, /DEBATE_LOCAL_REHEARSAL=true/);
  expect('All SDK and hosted configuration script URLs are absent locally', /<script\b[^>]*src="[^"]*(?:supabase|phase2-config|livekit)/i.test(page.text), false);
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/); assert.match(page.headers['content-security-policy'], /media-src 'none'/);
  expect('Cross-origin allow header is absent', Object.hasOwn(page.headers, 'access-control-allow-origin'), false);
  const localCss = (await request('/assets/debate-room.css')).text;
  expect('External font imports are removed from local copy', /@import/.test(localCss), false);
  expect('Semicolons inside font URLs do not corrupt the first local CSS rule', localCss.trimStart().startsWith(':root'), true);
  expect('Local media endpoint cannot connect a provider', (await request('/debate-room/media')).status, 503);
  const authHeaders = { Origin: origin, Authorization: `Bearer ${hostIdentity.token}`, 'Content-Type': 'application/json' };
  const post = async (pathname, data, headers = authHeaders) => request(pathname, { method: 'POST', headers, body: JSON.stringify(data) });
  const unmarked = await post('/debate-room/command', { command: 'create_event', payload: { title: 'Unmarked event' }, expectedRevision: 0, idempotencyKey: randomUUID() });
  expect('Unmarked event is refused by the localhost wrapper', JSON.parse(unmarked.text).error.code, 'LOCAL_REHEARSAL_REQUIRED');
  const created = await post('/debate-room/command', { command: 'create_event', payload: { title: 'HTTP perimeter actual service fixture', rehearsal: true }, expectedRevision: 0, idempotencyKey: randomUUID() });
  expect('Actual service creates a marked local event through HTTP', created.status, 200);
  const event = JSON.parse(created.text).event;
  expect('Real service event persists under the host', (await server.store.read(event.id)).ownerId, server.actors[0].id);
  expect('Host authorized snapshot succeeds', (await request(`/debate-room/snapshot?eventId=${event.id}`, { headers: authHeaders })).status, 200);
  const observerHeaders = { ...authHeaders, Authorization: `Bearer ${observerIdentity.token}` };
  expect('Authenticated nonmember cannot read event snapshot', (await request(`/debate-room/snapshot?eventId=${event.id}`, { headers: observerHeaders })).status, 403);
  expect('Unauthenticated outbox processing is denied', (await post('/debate-room/outbox', { eventId: event.id }, { Origin: origin, 'Content-Type': 'application/json' })).status, 401);
  expect('Nonmember outbox processing is denied', (await post('/debate-room/outbox', { eventId: event.id }, observerHeaders)).status, 403);
  expect('Member outbox processing uses current authorization', (await post('/debate-room/outbox', { eventId: event.id })).status, 200);
  expect('Downloads require bearer authorization', (await request(`/debate-room/download?eventId=${event.id}&downloadId=unknown`)).status, 401);
  expect('Invented export cannot be downloaded', (await request(`/debate-room/download?eventId=${event.id}&downloadId=unknown`, { headers: authHeaders })).status < 300, false);
  expect('Local actor switch refuses unknown identities', (await post('/__rehearsal/actor', { id: 'not-a-local-actor' })).status, 400);
  expect('Simulated advancement requires a safe bounded value', (await post('/__rehearsal/advance', { milliseconds: 86400001 })).status, 400);
  const report = { kind: 'LOCAL_HTTP_PERIMETER_TEST', state: 'PASS', storeMode: 'memory', actualSql: false, checks, physicalMedia: false, publicDeployment: false, outputDir: server.outputDir };
  await writeFile(path.join(server.outputDir, 'http-perimeter-report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ state: 'PASS', checks: checks.length, report: path.join(server.outputDir, 'http-perimeter-report.json'), actualSql: false })}\n`);
});

test('explicit local PGlite resume preserves event identity, revision and simulated time without overwriting original manifest', async () => {
  const first = await createRehearsalRuntime({ storeMode: 'pglite' });
  const actor = first.actors[0]; let second;
  try {
    const created = await first.service.execute({ actor, command: 'create_event', payload: { title: 'Preserved local browser rehearsal', rehearsal: true }, expectedRevision: 0, idempotencyKey: 'resume-created-event' });
    await first.advance(123456); const before = first.now(), initialRunId = first.manifest.runId;
    await first.close();
    second = await createRehearsalRuntime({ outputDir: first.outputDir, storeMode: 'pglite', resume: true });
    const restored = await second.service.snapshot({ actor, eventId: created.event.id });
    assert.equal(restored.event.id, created.event.id); assert.equal(restored.event.revision, created.event.revision); assert.ok(second.now() >= before);
    assert.equal(second.manifest.resumedFromRunId, initialRunId);
    await second.log({ kind: 'LOCAL_PGLITE_RESUME_VERIFIED', eventId: created.event.id, revision: restored.event.revision, actualSql: true, hostedDatabaseEvidence: false });
    process.stdout.write(`${JSON.stringify({ state: 'PASS', kind: 'LOCAL_PGLITE_RESUME', outputDir: second.outputDir, actualSql: true })}\n`);
  } finally { await first.close(); await second?.close(); }
});
