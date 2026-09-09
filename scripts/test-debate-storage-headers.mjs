import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagnoseStorageHeaders, verifyDiagnosticContext } from './diagnose-debate-storage-headers.mjs';

const key = 'sb_secret_INERT_TEST_ONLY_01234567890123456789';
const sourceSha = 'a'.repeat(40);
const target = 'https://hlzqmreeoghbldnhlybr.supabase.co/storage/v1/bucket/debate-private-v3';
const options = { serviceRoleKey: key, sourceSha, clock: () => 1788970000000 };
const context = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'codingwally/Bar-Exam-simulator', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW: 'Debate V3 restricted staging', GITHUB_ACTOR: 'codingwally',
  REQUESTED_STAGING_OPERATION: 'storage-headers', DEBATE_CANDIDATE_SHA: sourceSha, GITHUB_SHA: sourceSha };

test('only two sequential fixed-bucket GETs differ by the duplicated bearer; neither follows redirects', async () => {
  const calls = []; let active = 0;
  const report = await diagnoseStorageHeaders({ ...options, request: async (url, init) => {
    assert.equal(active++, 0); assert.equal(url, target); assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.headers.apikey, key);
    calls.push(init.headers); await Promise.resolve(); active--;
    return Response.json({ id: 'private-provider-metadata-not-recorded' });
  } });
  assert.deepEqual(calls, [{ apikey: key }, { apikey: key, Authorization: `Bearer ${key}` }]);
  assert.equal(report.comparison, 'BOTH_HTTP_200');
  assert.deepEqual(report.requests.map(item => item.status), [200, 200]);
  const encoded = JSON.stringify(report);
  for (const forbidden of [key, 'Bearer ', 'private-provider-metadata-not-recorded']) assert.equal(encoded.includes(forbidden), false);
});

test('a duplicated-header auth denial is retained without the provider error message or other fields', async () => {
  let call = 0;
  const report = await diagnoseStorageHeaders({ ...options, request: async () => ++call === 1 ? new Response(null) :
    Response.json({ code: 'InvalidJWT', message: key, authorization: key, email: 'secret@example.invalid' }, { status: 403 }) });
  assert.equal(report.comparison, 'DUPLICATED_HEADER_HTTP_AUTH_DENIAL_ONLY');
  assert.deepEqual(report.requests[1], { variant: 'duplicated_bearer', status: 403, errorCode: 'InvalidJWT', transportCode: null });
  assert.equal(JSON.stringify(report).includes(key), false);
  assert.equal(JSON.stringify(report).includes('secret@example.invalid'), false);
});

test('unrecognized codes, message-only errors and invalid JSON are never echoed', async () => {
  for (const body of [JSON.stringify({ code: key, error: key, message: key }), JSON.stringify({ message: 'InvalidJWT' }), `<html>${key}</html>`]) {
    const report = await diagnoseStorageHeaders({ ...options, request: async () => new Response(body, { status: 503 }) });
    assert.equal(report.comparison, 'SAME_HTTP_STATUS');
    assert.ok(report.requests.every(item => item.errorCode === null && item.status === 503));
    assert.equal(JSON.stringify(report).includes(key), false);
  }
});

test('oversized bodies are cancelled and cannot smuggle an allowed code after the bound', async () => {
  let cancelled = 0;
  const report = await diagnoseStorageHeaders({ ...options, request: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16385))); },
    cancel() { cancelled++; }
  }), { status: 403 }) });
  assert.equal(cancelled, 2); assert.ok(report.requests.every(item => item.errorCode === null));
});

test('a raw transport error leaks nothing and does not trigger a retry or skip the second variant', async () => {
  let calls = 0;
  const report = await diagnoseStorageHeaders({ ...options, request: async () => {
    if (++calls === 1) throw new Error(`authorization ${key}`); return new Response(null, { status: 200 });
  } });
  assert.equal(calls, 2); assert.equal(report.requests[0].transportCode, 'REQUEST_FAILED');
  assert.equal(report.requests[0].status, null); assert.equal(report.requests[1].status, 200);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('invalid keys and source identifiers fail before any transport', async () => {
  let calls = 0; const request = async () => { calls++; throw new Error('must not run'); };
  for (const serviceRoleKey of ['', 'eyJ.legacy.jwt', key + '\n', 'sb_publishable_' + 'x'.repeat(30)])
    await assert.rejects(diagnoseStorageHeaders({ ...options, serviceRoleKey, request }), { code: 'DIAGNOSTIC_CREDENTIAL_INVALID' });
  await assert.rejects(diagnoseStorageHeaders({ ...options, sourceSha: 'main', request }), { code: 'DIAGNOSTIC_SOURCE_INVALID' });
  assert.equal(calls, 0);
});

test('CLI provenance accepts only the exact clean manual main checkout and operation', () => {
  verifyDiagnosticContext(context, { head: sourceSha, clean: true });
  for (const [field, value] of [['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REPOSITORY', 'other/fork'], ['GITHUB_REF', 'refs/heads/topic'], ['GITHUB_WORKFLOW', 'Other'],
    ['GITHUB_ACTOR', 'dependabot[bot]'], ['REQUESTED_STAGING_OPERATION', 'deploy'], ['GITHUB_SHA', 'b'.repeat(40)]])
    assert.throws(() => verifyDiagnosticContext({ ...context, [field]: value }, { head: sourceSha, clean: true }));
  assert.throws(() => verifyDiagnosticContext(context, { head: 'b'.repeat(40), clean: true }));
  assert.throws(() => verifyDiagnosticContext(context, { head: sourceSha, clean: false }));
});

test('the diagnostic workflow branch is independent of provider-writing branches and receives only its one existing secret', () => {
  const yaml = readFileSync(new URL('../.github/workflows/debate-v3-staging.yml', import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
  const start = yaml.indexOf('  storage-headers:\n'), end = yaml.indexOf('  hosted-cleanup-postgres:', start);
  assert.ok(start > 0 && end > start);
  const job = yaml.slice(start, end);
  assert.match(job, /inputs\.operation == 'storage-headers'/u);
  assert.match(job, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(job, /environment: staging-e2e/u);
  assert.deepEqual([...job.matchAll(/secrets\.([A-Z_]+)/gu)].map(match => match[1]), ['STAGING_SUPABASE_SERVICE_ROLE_KEY']);
  for (const forbidden of ['wrangler', 'run-debate-hosted-rehearsal', 'run-debate-staging-auth', 'build-staging-artifact', 'npm install', 'npm ci'])
    assert.equal(job.includes(forbidden), false);
  assert.match(yaml.slice(end), /if: inputs\.operation != 'capture' && inputs\.operation != 'storage-headers'/u);
  assert.match(yaml.slice(yaml.indexOf('  staging:\n')), /inputs\.operation != 'storage-headers'/u);
  assert.match(yaml, /group: duediligence-staging-worker\r?\n\s+cancel-in-progress: false/u);
});
