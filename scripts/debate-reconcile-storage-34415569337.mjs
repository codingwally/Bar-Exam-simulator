// One-off staging file reconciliation. No database, Auth, session or deployment mutations.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FIXED_MANIFEST } from './debate-reconcile-capture-34415569337.mjs';

export const ORIGIN = 'https://hlzqmreeoghbldnhlybr.supabase.co';
export const BUCKET = 'debate-private-v3';
export const EVENT = 'de-aeb554ed338a0f459afdd2f4dc6995cc';
export const JOB = '049562ae-9dcc-4a54-9e9b-3b5877aea645';
export const KEYS = Object.freeze([
  `evidence/${EVENT}/d7c78b2e-7977-4cc5-a574-ae8ece487dd1/9c2cbcd5-1278-4579-a75a-ceeecbedab43.pdf`,
  `exports/${EVENT}/${JOB}.pdf`,
  `exports/${EVENT}/5f44868b-0086-4d88-837c-5c46461fdb9d.pdf`,
  `exports/${EVENT}/b9a9a95c-14c4-40aa-b993-d13a4904dd10.pdf`,
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const need = (value, code) => { if (!value) throw new Error(code); };
const absent = response => response.status === 404 || (response.status === 400 &&
  (String(response.body?.statusCode) === '404' || ['NoSuchKey', 'not_found'].includes(response.body?.code)));
const tableNames = ['events', 'uploads', 'outbox', 'receipts', 'audit', 'match_versions', 'ballots', 'votes', 'rate_limits'].sort();

async function boundedJson(response) {
  const reader = response.body?.getReader();
  need(reader, 'RECONCILE_EMPTY_RESPONSE');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new Error('RECONCILE_RESPONSE_LIMIT'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export function validateSnapshot(snapshot) {
  need(snapshot && same(Object.keys(snapshot).sort(), ['counts', 'manifestSha256', 'snapshotSha256', 'storageKeys', 'version']) &&
    snapshot.version === 1 && /^[a-f0-9]{64}$/u.test(snapshot.manifestSha256 || '') &&
    /^[a-f0-9]{64}$/u.test(snapshot.snapshotSha256 || '') && same(snapshot.storageKeys, KEYS) &&
    snapshot.counts && same(Object.keys(snapshot.counts).sort(), tableNames) &&
    Object.values(snapshot.counts).every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000) &&
    snapshot.counts.events === 1 && snapshot.counts.outbox === 4 && snapshot.counts.uploads === 1,
  'RECONCILE_SNAPSHOT_SCOPE');
  return structuredClone(snapshot);
}

// request is injectable only for inert tests. The live CLI always uses native fetch.
export async function reconcileStorage({ operation = 'inspect', snapshot: input, serviceRoleKey,
  persist, request = fetch, clock = Date.now }) {
  need(['inspect', 'remove-files'].includes(operation), 'RECONCILE_OPERATION');
  const snapshot = validateSnapshot(input);
  need(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(serviceRoleKey || ''), 'RECONCILE_CREDENTIAL');
  need(typeof persist === 'function', 'RECONCILE_JOURNAL_REQUIRED');
  const record = { version: 1, runId: '34415569337', projectRef: 'hlzqmreeoghbldnhlybr', eventId: EVENT,
    operation, startedAt: new Date(clock()).toISOString(), status: 'STARTED', snapshot,
    files: [], noDatabaseMutation: true, noAuthMutation: true, noPublicDeployment: true };
  const save = () => persist(structuredClone(record));
  await save();
  async function call(route, { method = 'GET', body, headers = {} } = {}) {
    const allowed = method === 'GET' && (route === `/storage/v1/bucket/${BUCKET}` ||
      KEYS.some(key => route === `/storage/v1/object/info/${BUCKET}/${key}`) ||
      route === `/rest/v1/debate_v3_outbox?id=eq.${JOB}&select=id,status,attempts,claim_id,lease_until_ms&limit=2`) ||
      method === 'POST' && route === '/rest/v1/rpc/astra_staging_debate_cleanup_v1' &&
        same(body, { p_manifest: FIXED_MANIFEST, p_expected: null }) ||
      method === 'DELETE' && operation === 'remove-files' && route === `/storage/v1/object/${BUCKET}` &&
        same(Object.keys(body || {}), ['prefixes']) && Array.isArray(body.prefixes) && body.prefixes.length === 1 && KEYS.includes(body.prefixes[0]);
    need(allowed, 'RECONCILE_TRANSPORT_SCOPE');
    let response, payload;
    try {
      response = await request(ORIGIN + route, { method, redirect: 'error', cache: 'no-store',
        headers: { apikey: serviceRoleKey, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      payload = await boundedJson(response);
    } catch { throw new Error('RECONCILE_REMOTE_OUTCOME_UNKNOWN'); }
    return { status: response.status, body: payload, range: response.headers.get('content-range') };
  }
  async function bucketGuard() {
    const bucket = await call(`/storage/v1/bucket/${BUCKET}`);
    need(bucket.status === 200 && bucket.body?.id === BUCKET && bucket.body?.name === BUCKET &&
      bucket.body?.public === false && Number(bucket.body.file_size_limit) === 10485760 &&
      Array.isArray(bucket.body.allowed_mime_types) && same([...bucket.body.allowed_mime_types].sort(),
        ['application/pdf', 'image/jpeg', 'image/png', 'text/csv']), 'RECONCILE_BUCKET_DRIFT');
  }
  async function guard() {
    await bucketGuard();
    // Inspection must remain usable after event/Auth cleanup or an uncertain
    // database response. It performs no writes and needs no surviving fixture.
    if (operation === 'inspect') return;
    const job = await call(`/rest/v1/debate_v3_outbox?id=eq.${JOB}&select=id,status,attempts,claim_id,lease_until_ms&limit=2`,
      { headers: { Prefer: 'count=exact' } });
    need(job.status === 200 && /^(?:0-0|\*)\/1$/u.test(job.range || '') && Array.isArray(job.body) && job.body.length === 1 &&
      same(job.body[0], { id: JOB, status: 'cancelled', attempts: 1, claim_id: null, lease_until_ms: null }),
    'RECONCILE_JOB_NOT_FENCED');
    const captured = await call('/rest/v1/rpc/astra_staging_debate_cleanup_v1',
      { method: 'POST', body: { p_manifest: FIXED_MANIFEST, p_expected: null } });
    need(captured.status === 200 && captured.body?.status === 'CAPTURED' && same(captured.body.snapshot, snapshot),
      'RECONCILE_CAPTURE_DRIFT');
  }
  try {
    await guard(); record.status = 'PRECHECKED'; await save();
    for (const key of KEYS) {
      const file = { storageKey: key, state: 'INSPECTING' }; record.files.push(file); await save();
      const before = await call(`/storage/v1/object/info/${BUCKET}/${key}`);
      need(before.status === 200 || absent(before), 'RECONCILE_OBJECT_READ_UNCONFIRMED');
      if (absent(before)) { file.state = 'ALREADY_ABSENT'; await save(); continue; }
      // info may expose a basename in name. Identity is the exact fixed request path.
      need(before.body && typeof before.body === 'object' && !Array.isArray(before.body), 'RECONCILE_OBJECT_INFO');
      file.state = 'PRESENT'; await save();
      if (operation === 'inspect') continue;
      await guard();
      file.state = 'DELETE_REQUESTED'; await save();
      // No retries. An uncertain response leaves DELETE_REQUESTED in the durable journal.
      const removed = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [key] } });
      need(removed.status === 200 && Array.isArray(removed.body) && removed.body.length <= 1 &&
        removed.body.every(row => row?.name === key && (row.bucket_id === undefined || row.bucket_id === BUCKET)), 'RECONCILE_DELETE_UNCONFIRMED');
      const after = await call(`/storage/v1/object/info/${BUCKET}/${key}`);
      need(absent(after), 'RECONCILE_OBJECT_REMAINS');
      file.state = 'DELETED_ABSENCE_VERIFIED'; await save();
    }
    await guard();
    if (operation === 'remove-files') {
      for (const key of KEYS) need(absent(await call(`/storage/v1/object/info/${BUCKET}/${key}`)), 'RECONCILE_FINAL_OBJECT_REMAINS');
    }
    record.status = operation === 'inspect' ? 'INSPECTED_ONLY' : 'EXACT_FILES_ABSENT';
    record.finishedAt = new Date(clock()).toISOString(); await save(); return structuredClone(record);
  } catch (error) {
    record.status = 'STOPPED_REQUIRES_READ_ONLY_RECONCILIATION';
    record.failure = /^RECONCILE_[A-Z_]+$/u.test(error?.message || '') ? error.message : 'RECONCILE_LOCAL_FAILURE';
    await save(); throw new Error(record.failure);
  }
}

export function validateExecutionEnvironment(env) {
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'codingwally/Bar-Exam-simulator' &&
    env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_RUN_ATTEMPT === '1' && /^[a-f0-9]{40}$/u.test(env.RECONCILE_CANDIDATE_SHA || '') &&
    env.RECONCILE_CANDIDATE_SHA === env.GITHUB_SHA && env.RECONCILE_CHECKOUT_SHA === env.GITHUB_SHA,
  'RECONCILE_EXECUTION_SCOPE');
}

export function validatePriorRuns(pages, currentRunId) {
  need(Array.isArray(pages) && pages.length > 0 && /^\d+$/u.test(currentRunId || ''), 'RECONCILE_HISTORY_REQUIRED');
  let total = null, count = 0; const identities = new Set();
  for (const page of pages) {
    need(Number.isSafeInteger(page?.total_count) && page.total_count >= 0 && Array.isArray(page.workflow_runs), 'RECONCILE_HISTORY_REQUIRED');
    total ??= page.total_count; need(page.total_count === total, 'RECONCILE_HISTORY_DRIFT'); count += page.workflow_runs.length;
    for (const run of page.workflow_runs) {
      need(run.event === 'workflow_dispatch', 'RECONCILE_HISTORY_SCOPE');
      need(!identities.has(String(run.id)) && ['Debate rehearsal 34415569337 / inspect',
        'Debate rehearsal 34415569337 / remove-files'].includes(run.display_title), 'RECONCILE_HISTORY_SCOPE');
      identities.add(String(run.id));
      need(String(run.id) === currentRunId || run.display_title !== 'Debate rehearsal 34415569337 / remove-files', 'RECONCILE_PREVIOUS_REMOVAL_REQUIRES_REVIEW');
    }
  }
  need(count === total && identities.has(currentRunId), 'RECONCILE_HISTORY_INCOMPLETE');
}

async function main() {
  validateExecutionEnvironment(process.env);
  const output = new URL('../artifacts/debate-local-rehearsal/reconcile-34415569337/', import.meta.url);
  await mkdir(output, { recursive: true });
  const journal = await open(new URL('journal.jsonl', output), 'wx', 0o600);
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (event.inputs.operation === 'remove-files') validatePriorRuns(
      JSON.parse(await readFile(process.env.RECONCILE_PRIOR_RUNS_PATH, 'utf8')), process.env.GITHUB_RUN_ID);
    const snapshot = JSON.parse(event.inputs.expected_snapshot_json);
    const report = await reconcileStorage({ operation: event.inputs.operation, snapshot,
      serviceRoleKey: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
      persist: async record => {
        // Append and fsync before every request that can mutate remote data.
        await journal.writeFile(JSON.stringify(record) + '\n'); await journal.sync();
      } });
    console.log(JSON.stringify({ status: report.status, files: report.files.map(f => ({ storageKey: f.storageKey, state: f.state })),
      snapshotSha256: report.snapshot.snapshotSha256, candidate: process.env.GITHUB_SHA,
      sourceSha256: hash(await readFile(new URL(import.meta.url))) }));
  } finally { await journal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Never print error bodies, secrets or stacks from provider requests.
  console.error('RECONCILE_STOPPED_REVIEW_SANITIZED_JOURNAL'); process.exitCode = 1;
});
