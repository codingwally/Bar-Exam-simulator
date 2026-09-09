import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runHostedUploadDiagnostic, UPLOAD_DIAGNOSTIC_FILE } from './debate-hosted-upload-diagnostic.mjs';
import { createDebateIntegration } from '../worker/debate-integration.mjs';
import { createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';

const names = ['host','A1','A2','A3','N1','N2','N3','judge2','judge3','observer','excluded'];
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sourceSha = 'a'.repeat(40), workerVersion = id(100);
async function fixture(options = {}) {
  const actors = Object.fromEntries(names.map((purpose, index) => [purpose, { id: id(index + 1), displayName: 'Inert fixture', verified: true }]));
  const tokens = Object.fromEntries(names.map(name => [name, `inert-private-${name}-session-`.repeat(8)]));
  const store = createMemoryDebateStoreForTests(), saved = [], network = [], objects = new Map();
  const manifest = { sourceSha, runTag: 'dv3host-0123456789abcdef', noMail: true, noMediaProvider: true,
    fixtures: names.map(purpose => ({ id: actors[purpose].id, purpose, registrationState: 'confirmed',
      registrationReceipt: { registered: true, fixtureUserId: actors[purpose].id, dataScope: 'internal_test' } })) };
  const rpc = (name, p) => {
    if (options.storeFailure && name === 'debate_v3_complete_upload') throw new Error('private database error');
    const calls = { debate_v3_read: ['read', [p.p_event_id]], debate_v3_list: ['list', [p.p_actor_id]],
      debate_v3_receipt: ['receipt', [p.p_request]], debate_v3_rate_limit: ['rateLimit', [p.p_actor_id,p.p_action,p.p_now,p.p_limit,p.p_window_ms]],
      debate_v3_commit: ['commit', [p.p_request]], debate_v3_claim_jobs: ['claimJobs', [p.p_event_id,p.p_limit,p.p_now]],
      debate_v3_finish_job: ['finishJob', [p.p_request]], debate_v3_read_job: ['readJob', [p.p_job_id]],
      debate_v3_reserve_upload: ['reserveUpload', [p.p_request]], debate_v3_read_upload: ['readUpload', [p.p_upload_id]],
      debate_v3_complete_upload: ['completeUpload', [p.p_request]], debate_v3_fail_upload: ['failUpload', [p.p_request]] };
    assert.ok(calls[name], name); return store[calls[name][0]](...calls[name][1]);
  };
  const integration = createDebateIntegration({ env: { SUPABASE_URL: 'https://inert.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'inert-service-secret', DEBATE_ROOM_ENABLED: 'false',
    DEBATE_PREVIEW_ACTOR_IDS: names.filter(name => name !== 'excluded').map(name => actors[name].id).join(','),
    DEBATE_MEDIA_ENABLED: 'false', DEBATE_SWEEPER_ENABLED: 'false', DEBATE_APPROVED_MAX_PARTICIPANTS: '0' }, rpc,
    authenticate: async req => actors[names.find(name => req.headers.get('authorization') === `Bearer ${tokens[name]}`)],
    fetcher: async (url, request) => {
      const path = new URL(url).pathname;
      const stage = path.startsWith('/storage/v1/bucket/') ? 'bucket' : request.method === 'POST' ? 'write' : 'readback';
      if (options.storageFailure === stage) throw new TypeError('private transport detail');
      if (path === '/storage/v1/bucket/debate-private-v3') return Response.json({ id: 'debate-private-v3', public: false });
      if (request.method === 'POST' && path.startsWith('/storage/v1/object/debate-private-v3/')) {
        if (options.storageDenial) return Response.json({ message: 'private provider body' }, { status: 403 });
        objects.set(path.slice('/storage/v1/object/debate-private-v3/'.length), Buffer.from(request.body));
        return Response.json({ ok: true });
      }
      if (path.startsWith('/storage/v1/object/authenticated/debate-private-v3/')) {
        const bytes = objects.get(path.slice('/storage/v1/object/authenticated/debate-private-v3/'.length));
        return new Response(bytes, { status: bytes ? 200 : 404 });
      }
      assert.fail('No other provider route is permitted in this inert test');
    } });
  let intent, eventId;
  const lifecycle = { snapshot: () => structuredClone(manifest),
    sessionFor: async name => ({ user: { id: actors[name].id }, access_token: tokens[name] }),
    recordEventIntent: async value => { assert.equal(intent, undefined); intent = value; },
    recordEvent: async value => { assert.equal(value.title, intent.title); eventId = value.id;
      assert.equal((await store.read(eventId)).ownerId, actors.host.id); },
    readEvent: event => { assert.equal(event, eventId); return store.read(event); } };
  const input = { lifecycle, workerUrl: FIXTURE_TARGET.workerUrl, sourceSha, workerVersion,
    persist: value => { saved.push(structuredClone(value)); },
    request: async (url, options) => {
      const parsed = new URL(url); assert.equal(parsed.origin, FIXTURE_TARGET.workerUrl);
      assert.equal(options.headers.Origin, FIXTURE_TARGET.workerUrl); assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      network.push({ path: parsed.pathname, command: parsed.pathname.endsWith('/command') ? JSON.parse(options.body).command : null });
      const response = await integration.handle(new Request(url, options));
      if (parsed.pathname.endsWith('/evidence/upload') && options.body !== undefined) {
        assert.deepEqual(Buffer.from(options.body), UPLOAD_DIAGNOSTIC_FILE);
        if (fixtureOptions.lostUploadResponse) throw new Error('private transport exception');
      }
      return response;
    } };
  const fixtureOptions = options;
  return { input, network, saved, objects, store, manifest, tokens, get eventId() { return eventId; } };
}

test('one real integration upload verifies stored bytes without timer/media/mail commands', async () => {
  const f = await fixture(), result = await runHostedUploadDiagnostic(f.input);
  assert.equal(result.status, 'PASS_HOSTED_SINGLE_UPLOAD_ONLY'); assert.equal(result.uploadAttempts, 1);
  assert.equal(result.completedTimerStages, 0); assert.equal(result.upload.status, 200);
  assert.equal(result.upload.attachmentSize, UPLOAD_DIAGNOSTIC_FILE.length); assert.ok(UPLOAD_DIAGNOSTIC_FILE.length < 1024);
  assert.equal(f.objects.size, 1); assert.deepEqual([...f.objects.values()][0], UPLOAD_DIAGNOSTIC_FILE);
  const event = await f.store.read(f.eventId); assert.equal(event.rehearsal, true); assert.equal(event.visibility, 'unlisted');
  assert.equal(Object.values(event.matches)[0].timer, null); assert.deepEqual(Object.values(event.matches)[0].attempts, []);
  assert.equal(f.network.filter(row => row.path.endsWith('/evidence/upload')).length, 1);
  assert.ok(f.network.every(row => ['/debate-room/command','/debate-room/evidence/upload'].includes(row.path)));
  assert.ok(f.network.every(row => !['start_match','timer','enter_space','send_invitation_mail','create_export'].includes(row.command)));
  const serialized = JSON.stringify(f.saved);
  for (const token of Object.values(f.tokens)) assert.ok(!serialized.includes(token));
  for (const text of ['private provider body','uploadId','access_token','Authorization','secret','inert-service-secret']) assert.ok(!serialized.includes(text));
  assert.equal(result.independentAbsence, 'PENDING_SEPARATE_POST_RUN_READBACK');
});

test('actual Storage rejection remains a safe upload-stage diagnosis with one attempt', async () => {
  const f = await fixture({ storageDenial: true }), result = await runHostedUploadDiagnostic(f.input);
  assert.equal(result.status, 'FAIL_HOSTED_SINGLE_UPLOAD_DIAGNOSTIC'); assert.equal(result.upload.status, 503);
  assert.equal(result.upload.errorCode, 'STORAGE_WRITE_UNCONFIRMED'); assert.equal(f.objects.size, 0);
  assert.equal(result.uploadAttempts, 1); assert.equal(result.failureCode, 'UPLOAD_DIAGNOSTIC_UPLOAD_REJECTED');
  assert.ok(!JSON.stringify(f.saved).includes('private provider body'));
});

test('actual completion RPC outage preserves STORE_UNAVAILABLE instead of an unknown label', async () => {
  const f = await fixture({ storeFailure: true }), result = await runHostedUploadDiagnostic(f.input);
  assert.equal(result.upload.status, 503); assert.equal(result.upload.errorCode, 'STORE_UNAVAILABLE');
  assert.equal(f.objects.size, 1, 'Cleanup lifecycle must retain the recorded object scope even on failed completion');
  assert.ok(!JSON.stringify(result).includes('private database error'));
});

for (const [stage, code] of [['bucket','EVIDENCE_BUCKET_CHECK_FAILED'], ['write','EVIDENCE_WRITE_FAILED'], ['readback','EVIDENCE_READBACK_FAILED']]) {
  test(`actual integration exposes only the safe ${stage} failure code and retains one upload attempt`, async () => {
    const f = await fixture({ storageFailure: stage }), result = await runHostedUploadDiagnostic(f.input);
    assert.equal(result.status, 'FAIL_HOSTED_SINGLE_UPLOAD_DIAGNOSTIC');
    assert.equal(result.upload.status, 503); assert.equal(result.upload.errorCode, code);
    assert.equal(result.uploadAttempts, 1); assert.equal(result.completedTimerStages, 0);
    assert.equal(f.network.filter(row => row.path.endsWith('/evidence/upload')).length, 1);
    assert.equal(f.objects.size, stage === 'readback' ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(f.saved), /private transport detail|TypeError|inert-service-secret/);
  });
}

test('a lost successful upload response is held without a second mutation or private error text', async () => {
  const f = await fixture({ lostUploadResponse: true }), result = await runHostedUploadDiagnostic(f.input);
  assert.equal(result.failureCode, 'UPLOAD_DIAGNOSTIC_REQUEST_UNKNOWN'); assert.equal(result.upload, null);
  assert.equal(f.objects.size, 1); assert.equal(result.uploadAttempts, 1);
  assert.equal(f.network.filter(row => row.path.endsWith('/evidence/upload')).length, 1);
  assert.equal(result.requests.at(-1).outcome, 'OUTCOME_UNKNOWN'); assert.ok(!JSON.stringify(result).includes('private transport exception'));
});

test('production target and unclassified fixtures are refused before any Worker request', async () => {
  const f = await fixture();
  await assert.rejects(runHostedUploadDiagnostic({ ...f.input, workerUrl: 'https://duediligence.ph' }), /CONTEXT_INVALID/);
  f.manifest.fixtures[0].registrationReceipt.dataScope = 'regular';
  const result = await runHostedUploadDiagnostic(f.input);
  assert.equal(result.failureCode, 'UPLOAD_DIAGNOSTIC_FIXTURES_INVALID'); assert.equal(f.network.length, 0);
});

test('an exhausted journey deadline stops before dispatching or counting an upload', async () => {
  const f = await fixture(), start = Date.now();
  const result = await runHostedUploadDiagnostic({ ...f.input, clock: () => start + (f.network.length >= 29 ? 300001 : 0) });
  assert.equal(result.failureCode, 'UPLOAD_DIAGNOSTIC_DEADLINE'); assert.equal(result.uploadAttempts, 0);
  assert.equal(f.objects.size, 0); assert.equal(f.network.filter(row => row.path.endsWith('/evidence/upload')).length, 0);
});

test('workflow diagnostic retains preparation/native/deployment gates and only adds its sanitized artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/debate-v3-staging.yml', import.meta.url), 'utf8');
  assert.match(workflow, /options: \[[^\n]*upload-diagnostic\]/);
  assert.equal((workflow.match(/inputs.operation == 'hosted-rehearsal' \|\| inputs.operation == 'upload-diagnostic'/g) || []).length, 3);
  assert.match(workflow, /run-debate-hosted-rehearsal\.mjs upload-diagnostic/);
  assert.match(workflow, /hosted-\*\/upload-diagnostic\.json/);
  assert.match(workflow, /group: duediligence-staging-worker\s+cancel-in-progress: false/);
  assert.match(workflow, /needs: hosted-cleanup-postgres/);
});
