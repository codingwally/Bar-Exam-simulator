import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, BUCKET, JOB, KEYS, reconcileStorage, validateSnapshot, validateExecutionEnvironment, validatePriorRuns } from './debate-reconcile-storage-34415569337.mjs';
import { FIXED_MANIFEST } from './debate-reconcile-capture-34415569337.mjs';

const credential = 'sb_secret_inert_test_only_never_a_real_key';
const snapshot = () => ({ version: 1, manifestSha256: 'a'.repeat(64), snapshotSha256: 'b'.repeat(64),
  counts: { events: 1, uploads: 1, outbox: 4, receipts: 647, audit: 647, match_versions: 20, ballots: 1, votes: 1, rate_limits: 10 }, storageKeys: [...KEYS] });
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function harness({ override, persistFailure, operation = 'remove-files' } = {}) {
  const calls = [], saved = [], present = new Set(KEYS.filter(k => !k.includes(JOB)));
  let captures = 0;
  async function request(url, options) {
    const parsed = new URL(url), route = parsed.pathname + parsed.search;
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    assert.equal(parsed.origin, ORIGIN);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.apikey, credential); assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    const altered = override?.({ route, options, present, captures, calls });
    if (altered) return await altered;
    if (route === `/storage/v1/bucket/${BUCKET}`) return response({ id: BUCKET, name: BUCKET, public: false,
      file_size_limit: 10485760, allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] });
    if (route.startsWith('/rest/v1/debate_v3_outbox?')) return response([
      { id: JOB, status: 'cancelled', attempts: 1, claim_id: null, lease_until_ms: null },
    ], 200, { 'content-range': '0-0/1' });
    if (route === '/rest/v1/rpc/astra_staging_debate_cleanup_v1') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { p_manifest: FIXED_MANIFEST, p_expected: null });
      captures++; return response({ status: 'CAPTURED', snapshot: snapshot() });
    }
    if (route.startsWith(`/storage/v1/object/info/${BUCKET}/`)) {
      assert.equal(options.method, 'GET');
      const key = route.slice(`/storage/v1/object/info/${BUCKET}/`.length); assert.ok(KEYS.includes(key));
      return present.has(key) ? response({ name: key, metadata: { size: 879 } }) : response({ code: 'not_found', statusCode: '404' }, 400);
    }
    if (route === `/storage/v1/object/${BUCKET}`) {
      assert.equal(options.method, 'DELETE');
      const { prefixes } = JSON.parse(options.body); assert.equal(prefixes.length, 1); assert.ok(KEYS.includes(prefixes[0]));
      assert.equal(saved.at(-1).files.at(-1).state, 'DELETE_REQUESTED', 'Mutation intent persisted first');
      assert.ok(present.delete(prefixes[0])); return response([{ name: prefixes[0], bucket_id: BUCKET }]);
    }
    throw new Error('Unexpected request reached inert transport');
  }
  const persist = async record => {
    if (persistFailure?.(record)) throw new Error('Filesystem unavailable');
    saved.push(structuredClone(record));
  };
  return { calls, saved, present, run: args => reconcileStorage({ operation, snapshot: snapshot(), serviceRoleKey: credential,
    request, persist, clock: () => 1791770000000, ...args }) };
}

test('three present exact files removed once; absent result is checked without DELETE; full snapshot stays bound', async () => {
  const h = harness(), report = await h.run();
  assert.equal(report.status, 'EXACT_FILES_ABSENT'); assert.equal(h.present.size, 0);
  assert.deepEqual(h.calls.filter(c => c.method === 'DELETE').map(c => c.body.prefixes[0]), KEYS.filter(k => !k.includes(JOB)));
  assert.equal(report.files.find(f => f.storageKey.includes(JOB)).state, 'ALREADY_ABSENT');
  assert.ok(report.files.filter(f => f.state === 'DELETED_ABSENCE_VERIFIED').length === 3);
  assert.equal(h.calls.filter(c => c.url.includes('/rpc/')).length, 5);
  assert.ok(!JSON.stringify(h.saved).includes(credential));
  assert.ok(h.calls.every(c => !/\/auth\/|token|password|production/u.test(c.url)));
});

test('inspect is read-only even when all files exist', async () => {
  const h = harness({ operation: 'inspect' }); h.present.add(KEYS[1]); const r = await h.run();
  assert.equal(r.status, 'INSPECTED_ONLY'); assert.equal(h.present.size, 4);
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
  assert.ok(h.calls.filter(c => c.method === 'POST').every(c => c.body.p_expected === null));
});

test('Storage remove may omit deprecated bucket_id; exact names and absence still required', async () => {
  const h = harness({ override: ({ options, present }) => {
    if (options.method !== 'DELETE') return false;
    const key = JSON.parse(options.body).prefixes[0]; present.delete(key); return response([{ name: key }]);
  } });
  assert.equal((await h.run()).status, 'EXACT_FILES_ABSENT');
});

test('read-only inspection works after all event, job and Auth fixture rows have been removed', async () => {
  const h = harness({ operation: 'inspect', override: ({ route }) => {
    assert.ok(!route.startsWith('/rest/') && !route.startsWith('/auth/'));
    return false;
  } });
  h.present.clear(); const report = await h.run();
  assert.equal(report.status, 'INSPECTED_ONLY'); assert.equal(report.files.length, 4);
  assert.ok(report.files.every(f => f.state === 'ALREADY_ABSENT'));
  assert.ok(h.calls.every(c => c.method === 'GET'));
});

for (const [label, changed] of [
  ['another event prefix', value => { value.storageKeys[0] = 'evidence/de-' + 'f'.repeat(32) + '/other.pdf'; }],
  ['extra file', value => { value.storageKeys.push(KEYS[0]); }],
  ['missing file', value => { value.storageKeys.pop(); }],
  ['reordered keys', value => { value.storageKeys.reverse(); }],
  ['negative count', value => { value.counts.audit = -1; }],
  ['overbound count', value => { value.counts.receipts = 1001; }],
  ['wrong number of events', value => { value.counts.events = 2; }],
  ['extra field', value => { value.authorization = 'untrusted'; }],
]) test(`snapshot refuses ${label} before any request`, async () => {
  const h = harness(), value = snapshot(); changed(value);
  assert.throws(() => validateSnapshot(value), /RECONCILE_SNAPSHOT_SCOPE/u);
  await assert.rejects(h.run({ snapshot: value }), /RECONCILE_SNAPSHOT_SCOPE/u); assert.equal(h.calls.length, 0);
});

test('public or drifted bucket stops before deletion', async () => {
  const h = harness({ override: ({ route }) => route.includes('/bucket/') && response({ id: BUCKET, name: BUCKET, public: true }) });
  await assert.rejects(h.run(), /RECONCILE_BUCKET_DRIFT/u); assert.equal(h.calls.length, 1);
});

for (const drift of [{ status: 'running' }, { attempts: 2 }, { claim_id: 'old-claim' }, { lease_until_ms: 0 }]) {
  test(`job guard refuses ${JSON.stringify(drift)}`, async () => {
    const h = harness({ override: ({ route }) => route.startsWith('/rest/v1/debate_v3_outbox?') && response([
      { id: JOB, status: 'cancelled', attempts: 1, claim_id: null, lease_until_ms: null, ...drift },
    ], 200, { 'content-range': '0-0/1' }) });
    await assert.rejects(h.run(), /RECONCILE_JOB_NOT_FENCED/u); assert.ok(h.calls.every(c => c.method !== 'DELETE'));
  });
}

test('helper refusal (including a fresh session) stops without exposing provider data', async () => {
  const h = harness({ override: ({ route }) => route.includes('/rpc/') && response({ message: 'sensitive_fixture_private_body_and_token' }, 400) });
  await assert.rejects(h.run(), /RECONCILE_CAPTURE_DRIFT/u);
  assert.ok(h.calls.every(c => c.method !== 'DELETE')); assert.ok(!JSON.stringify(h.saved).includes('sensitive_'));
});

test('capture drift after one deletion refuses all subsequent files', async () => {
  const h = harness({ override: ({ route, captures }) => route.includes('/rpc/') && captures >= 2 &&
    response({ status: 'CAPTURED', snapshot: { ...snapshot(), snapshotSha256: 'c'.repeat(64) } }) });
  await assert.rejects(h.run(), /RECONCILE_CAPTURE_DRIFT/u); assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('lost delete response remains unresolved and never retries; later inspect is read-only', async () => {
  const h = harness({ override: ({ options, present }) => {
    if (options.method !== 'DELETE') return false;
    present.delete(JSON.parse(options.body).prefixes[0]);
    throw new Error('private provider response containing secret');
  } });
  await assert.rejects(h.run(), /RECONCILE_REMOTE_OUTCOME_UNKNOWN/u);
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.equal(h.saved.at(-1).files[0].state, 'DELETE_REQUESTED');
  assert.equal(h.saved.at(-1).status, 'STOPPED_REQUIRES_READ_ONLY_RECONCILIATION');
  assert.ok(!JSON.stringify(h.saved).includes('private provider'));
  const later = await h.run({ operation: 'inspect' }); assert.equal(later.status, 'INSPECTED_ONLY');
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('failed journal flush prevents file mutation', async () => {
  const h = harness({ persistFailure: r => r.files.some(f => f.state === 'DELETE_REQUESTED') });
  await assert.rejects(h.run()); assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
});

test('wrong delete response never counts as confirmed absence', async () => {
  const h = harness({ override: ({ options }) => options.method === 'DELETE' && response([{ name: 'unrelated.pdf', bucket_id: BUCKET }]) });
  await assert.rejects(h.run(), /RECONCILE_DELETE_UNCONFIRMED/u);
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.equal(h.saved.at(-1).files[0].state, 'DELETE_REQUESTED');
});

test('oversized response or redirect failure is bounded and sanitized', async () => {
  for (const override of [() => new Response('x'.repeat(65537)), () => { throw new Error('redirect to secret-bearing host'); }]) {
    const h = harness({ override }); await assert.rejects(h.run(), /RECONCILE_REMOTE_OUTCOME_UNKNOWN/u);
    assert.equal(h.calls.length, 1); assert.ok(!JSON.stringify(h.saved).includes('secret-bearing'));
  }
});

test('object reappearing during final readback prevents success', async () => {
  const h = harness({ override: ({ route, present, captures }) => {
    if (captures >= 5 && route.includes('/object/info/')) present.add(KEYS[0]); return false;
  } });
  await assert.rejects(h.run(), /RECONCILE_FINAL_OBJECT_REMAINS/u);
});

test('live CLI requires exact first-attempt main checkout in the designated repository', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'codingwally/Bar-Exam-simulator', GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', RECONCILE_CANDIDATE_SHA: 'a'.repeat(40),
    RECONCILE_CHECKOUT_SHA: 'a'.repeat(40), GITHUB_SHA: 'a'.repeat(40) };
  validateExecutionEnvironment(env);
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'false', GITHUB_REPOSITORY: 'other/repo', GITHUB_REF: 'refs/heads/feature',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '2', RECONCILE_CHECKOUT_SHA: 'b'.repeat(40), RECONCILE_CANDIDATE_SHA: 'b'.repeat(40) })) {
    assert.throws(() => validateExecutionEnvironment({ ...env, [key]: value }), /RECONCILE_EXECUTION_SCOPE/u);
  }
});

test('any earlier removal dispatch blocks replay; prior inspection is allowed and incomplete history refuses', () => {
  const run = (id, operation) => ({ id, event: 'workflow_dispatch', display_title: `Debate rehearsal 34415569337 / ${operation}` });
  validatePriorRuns([{ total_count: 2, workflow_runs: [run(2, 'remove-files'), run(1, 'inspect')] }], '2');
  assert.throws(() => validatePriorRuns([{ total_count: 2, workflow_runs: [run(2, 'remove-files'), run(1, 'remove-files')] }], '2'), /RECONCILE_PREVIOUS_REMOVAL/u);
  assert.throws(() => validatePriorRuns([{ total_count: 2, workflow_runs: [run(2, 'remove-files')] }], '2'), /RECONCILE_HISTORY_INCOMPLETE/u);
  assert.throws(() => validatePriorRuns([], '2'), /RECONCILE_HISTORY_REQUIRED/u);
  assert.throws(() => validatePriorRuns([{ total_count: 0, workflow_runs: [] }], '2'), /RECONCILE_HISTORY_INCOMPLETE/u);
  assert.throws(() => validatePriorRuns([{ total_count: 1, workflow_runs: [run(1, 'unexpected')] }], '2'), /RECONCILE_HISTORY_SCOPE/u);
});
