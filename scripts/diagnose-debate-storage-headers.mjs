import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'hlzqmreeoghbldnhlybr';
const BUCKET = 'debate-private-v3';
const URL = `https://${PROJECT}.supabase.co/storage/v1/bucket/${BUCKET}`;
const REPOSITORY = 'codingwally/Bar-Exam-simulator';
const WORKFLOW = 'Debate V3 restricted staging';
const SOURCE_FILES = ['scripts/diagnose-debate-storage-headers.mjs',
  'scripts/test-debate-storage-headers.mjs', '.github/workflows/debate-v3-staging.yml'];
const OUTPUT = 'artifacts/debate-local-rehearsal/staging-release/storage-headers.json';
const ERROR_CODES = new Set(['InvalidJWT', 'AccessDenied', 'NoSuchBucket', 'NoSuchKey',
  'InvalidRequest', 'InvalidSignature', 'InternalError', 'DatabaseTimeout', 'TenantNotFound',
  'Unauthorized', 'unauthorized', 'invalid_jwt', 'invalid_api_key', 'InvalidApiKey']);
const LOCAL_CODES = new Set(['DIAGNOSTIC_CONTEXT_INVALID', 'DIAGNOSTIC_SOURCE_INVALID',
  'DIAGNOSTIC_CREDENTIAL_INVALID', 'DIAGNOSTIC_SOURCE_CHANGED', 'DIAGNOSTIC_WRITE_FAILED']);
const SHA = /^[a-f0-9]{40}$/u;
const need = (value, code) => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Parse only a bounded error response in memory. No provider text, request
// headers, credential, body, bucket metadata or error message enters evidence.
async function safeProviderCode(response) {
  if (response.status === 200) { await response.body?.cancel().catch(() => {}); return null; }
  const reader = response.body?.getReader();
  if (!reader) return null;
  try {
    const chunks = []; let length = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return [body?.code, body?.error].find(value => typeof value === 'string' && ERROR_CODES.has(value)) || null;
  } catch { await reader.cancel().catch(() => {}); return null; }
}

export async function diagnoseStorageHeaders({ serviceRoleKey, sourceSha, request = fetch, clock = Date.now }) {
  need(SHA.test(sourceSha || ''), 'DIAGNOSTIC_SOURCE_INVALID');
  need(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(serviceRoleKey || ''), 'DIAGNOSTIC_CREDENTIAL_INVALID');
  const report = { schemaVersion: 1, kind: 'debate-staging-storage-header-diagnostic',
    sourceSha, projectRef: PROJECT, bucketId: BUCKET, startedAt: new Date(clock()).toISOString(),
    status: 'COMPLETED_READ_ONLY_COMPARISON', requests: [],
    scope: { requestCount: 2, method: 'GET', fixedBucketOnly: true, accountsCreated: 0,
      uploads: 0, databaseWrites: 0, configurationWrites: 0, deployments: 0, email: 0,
      credentialsRecorded: false, headersRecorded: false, bodiesRecorded: false },
    limitations: ['CI_KEY_ONLY_WORKER_SECRET_PARITY_UNVERIFIED', 'HTTP_200_ONLY_NOT_BUCKET_CONTENT_VALIDATION',
      'NO_OBJECT_UPLOAD_OR_DOWNLOAD_PROOF', 'NOT_A_ROOT_CAUSE_OR_ACCEPTANCE_CLAIM'] };
  for (const variant of ['apikey_only', 'duplicated_bearer']) {
    const observation = { variant, status: null, errorCode: null, transportCode: null };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await request(URL, { method: 'GET', redirect: 'error', cache: 'no-store',
        headers: { apikey: serviceRoleKey, ...(variant === 'duplicated_bearer' ? { Authorization: `Bearer ${serviceRoleKey}` } : {}) },
        signal: controller.signal });
      need(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, 'INVALID_HTTP_RESPONSE');
      observation.status = response.status;
      observation.errorCode = await safeProviderCode(response);
    } catch { observation.transportCode = controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED'; }
    finally { clearTimeout(timer); }
    report.requests.push(observation);
  }
  report.finishedAt = new Date(clock()).toISOString();
  const [only, duplicated] = report.requests;
  report.comparison = only.status === 200 && duplicated.status === 200 ? 'BOTH_HTTP_200' :
    only.status === 200 && [401, 403].includes(duplicated.status) ? 'DUPLICATED_HEADER_HTTP_AUTH_DENIAL_ONLY' :
    only.status === duplicated.status && only.status !== null ? 'SAME_HTTP_STATUS' : 'DIFFERENT_OR_INCOMPLETE_HTTP_RESULTS';
  return report;
}

export function verifyDiagnosticContext(env, { head, clean } = {}) {
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === 'refs/heads/main' &&
    env.GITHUB_WORKFLOW === WORKFLOW && env.GITHUB_ACTOR !== 'dependabot[bot]' &&
    env.REQUESTED_STAGING_OPERATION === 'storage-headers', 'DIAGNOSTIC_CONTEXT_INVALID');
  need(SHA.test(env.DEBATE_CANDIDATE_SHA || '') && env.DEBATE_CANDIDATE_SHA === env.GITHUB_SHA &&
    head === env.DEBATE_CANDIDATE_SHA && clean === true, 'DIAGNOSTIC_SOURCE_INVALID');
}

async function sourceHashes(root) {
  return Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file =>
    [file, sha256(await readFile(path.join(root, file)))])));
}
async function main() {
  const root = fileURLToPath(new globalThis.URL('../', import.meta.url));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  verifyDiagnosticContext(process.env, { head: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain', '--untracked-files=all']) === '' });
  const before = await sourceHashes(root);
  const report = await diagnoseStorageHeaders({ serviceRoleKey: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
    sourceSha: process.env.DEBATE_CANDIDATE_SHA });
  need(JSON.stringify(before) === JSON.stringify(await sourceHashes(root)), 'DIAGNOSTIC_SOURCE_CHANGED');
  report.sourceHashes = before;
  try { await mkdir(path.dirname(path.join(root, OUTPUT)), { recursive: true });
    await writeFile(path.join(root, OUTPUT), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  catch { need(false, 'DIAGNOSTIC_WRITE_FAILED'); }
  console.log(JSON.stringify({ status: report.status, comparison: report.comparison,
    requests: report.requests, evidence: OUTPUT }));
  if (report.requests.some(item => item.transportCode)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'DIAGNOSTIC_FAILED',
    code: LOCAL_CODES.has(error?.code) ? error.code : 'DIAGNOSTIC_INTERNAL_FAILURE' })); process.exitCode = 1; });
}
