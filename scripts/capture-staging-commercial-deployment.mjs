// STAGING ONLY. Inert import; the protected action's postCommands invokes main.
// Source: wrangler@4.114.0 src/output.ts and src/deploy/index.ts; wrangler-action
// v3 (9acf94ace14e7dc412b076f2c5c20b8ce93c79cd) owns a fresh output directory.
// Ordinary deploy emits version_id only. deploymentId below comes from a
// read-only Cloudflare response with exact version + unique command association,
// never from treating Current Version ID as a deployment ID or guessing by time.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMERCIAL_STAGE, commercialDeploymentMarker } from './staging-commercial-suppression.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const OUTPUT_NAME = /^wrangler-output-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{3}-[a-f0-9]{6}\.json$/u;
const sha = value => createHash('sha256').update(value).digest('hex');
const repository = fileURLToPath(new URL('../', import.meta.url));
const denied = () => new Error('STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE_REFUSED');

export function parseCommercialDeployOutput(text, { sourceSha, workflowRunId, workflowRunAttempt }) {
  assert.equal(typeof text, 'string'); assert.ok(Buffer.byteLength(text) <= 262144);
  const marker = commercialDeploymentMarker(sourceSha, workflowRunId, workflowRunAttempt);
  const lines = text.trim().split(/\r?\n/u);
  assert.equal(lines.length, 2, 'Exactly one Wrangler session and one completed deploy are required');
  const [session, deploy] = lines.map(line => JSON.parse(line));
  assert.equal(session?.type, 'wrangler-session'); assert.equal(session?.version, 1);
  assert.equal(session?.wrangler_version, '4.114.0');
  assert.deepEqual(session.command_line_args, ['deploy', '--config', 'wrangler.staging.toml', '--message', marker]);
  assert.equal(deploy?.type, 'deploy'); assert.equal(deploy?.version, 1);
  assert.equal(deploy.worker_name, COMMERCIAL_STAGE.workerName);
  assert.equal(deploy.worker_name_overridden, false);
  assert.equal(deploy.wrangler_environment, undefined);
  assert.match(deploy.version_id, UUID);
  assert.ok(Array.isArray(deploy.targets) && deploy.targets.includes(COMMERCIAL_STAGE.workerUrl));
  for (const entry of [session, deploy]) assert.ok(typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp)));
  return { versionId: deploy.version_id, marker, wranglerOutputSha256: sha(text) };
}

async function boundedJson(response) {
  assert.equal(response.status, 200);
  const reader = response.body?.getReader(); assert.ok(reader);
  const parts = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; assert.ok(size <= 1048576);
      parts.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export async function collectCommercialDeploymentEvidence({ outputText, sourceSha, workflowRunId,
  workflowRunAttempt, sourceText, apiToken, request = fetch }) {
  try {
    const parsed = parseCommercialDeployOutput(outputText, { sourceSha, workflowRunId, workflowRunAttempt });
    assert.equal(typeof sourceText, 'string'); assert.ok(sourceText.length > 0 && sourceText.length <= 1048576);
    assert.ok(typeof apiToken === 'string' && apiToken.length >= 20);
    const url = `https://api.cloudflare.com/client/v4/accounts/${COMMERCIAL_STAGE.accountId}/workers/scripts/${COMMERCIAL_STAGE.workerName}/deployments`;
    const body = await boundedJson(await request(url, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(15000) }));
    assert.equal(body?.success, true);
    const deployments = body.result?.deployments;
    assert.ok(Array.isArray(deployments) && deployments.length > 0 && deployments.length <= 1000);
    const matched = deployments.filter(item => item?.annotations?.['workers/message'] === parsed.marker
      && Array.isArray(item.versions) && item.versions.length === 1
      && item.versions[0]?.version_id === parsed.versionId && item.versions[0]?.percentage === 100);
    assert.equal(matched.length, 1, 'Ambiguous or missing exact command/version association');
    assert.equal(matched[0], deployments[0], 'The exact command deployment is not active');
    assert.match(matched[0].id, UUID);
    // Closed scalar evidence only: no author email, API body, command arguments,
    // debug log path, token, binding values or credential-bearing headers.
    return { schemaVersion: 1, kind: 'protected-workflow-worker-deployment',
      provenance: 'wrangler-version-cloudflare-deployment-message-v1',
      sourceSha, workflowRunId, workflowRunAttempt, accountId: COMMERCIAL_STAGE.accountId,
      workerName: COMMERCIAL_STAGE.workerName, deploymentId: matched[0].id,
      versionId: parsed.versionId, deploymentMessage: parsed.marker, wranglerVersion: '4.114.0',
      wranglerOutputSha256: parsed.wranglerOutputSha256,
      commercialEntryLfSha256: sha(sourceText.replaceAll('\r\n', '\n')) };
  } catch { throw denied(); }
}

export async function captureCommercialDeployment({ env = process.env, io = fs, request = fetch,
  git = execFileSync, temporaryDirectory = tmpdir(), root = repository } = {}) {
  try {
    assert.equal(env.GITHUB_ACTIONS, 'true');
    const sourceSha = env.GITHUB_SHA, workflowRunId = env.GITHUB_RUN_ID, workflowRunAttempt = env.GITHUB_RUN_ATTEMPT;
    commercialDeploymentMarker(sourceSha, workflowRunId, workflowRunAttempt);
    const checkedOut = git('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(checkedOut, sourceSha);
    // Wrangler's install can modify package files; validate the exact deployed
    // entry against HEAD directly instead of weakening the protected tree gate.
    const sourceText = await io.readFile(path.join(root, 'worker', 'commercial-entry.mjs'), 'utf8');
    const committedSource = git('git', ['show', `${sourceSha}:worker/commercial-entry.mjs`],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(sourceText.replaceAll('\r\n', '\n'), committedSource.replaceAll('\r\n', '\n'));
    assert.equal(env.WRANGLER_OUTPUT_FILE_PATH, undefined, 'Do not override the action-owned directory');
    const dir = env.WRANGLER_OUTPUT_FILE_DIRECTORY;
    assert.ok(typeof dir === 'string' && path.isAbsolute(dir));
    assert.match(path.basename(dir), /^wranglerArtifacts-[a-f0-9-]{36}$/u);
    const temp = await io.realpath(temporaryDirectory), realDir = await io.realpath(dir);
    assert.equal(path.dirname(realDir), temp); assert.equal(realDir, path.resolve(dir));
    const entries = await io.readdir(realDir, { withFileTypes: true });
    assert.equal(entries.length, 1); assert.ok(entries[0].isFile() && !entries[0].isSymbolicLink());
    assert.match(entries[0].name, OUTPUT_NAME);
    const rawFile = path.join(realDir, entries[0].name), rawStat = await io.lstat(rawFile);
    assert.ok(rawStat.isFile() && !rawStat.isSymbolicLink() && rawStat.size <= 262144);
    const outputText = await io.readFile(rawFile, 'utf8');
    const out = env.STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE;
    assert.ok(typeof out === 'string' && path.isAbsolute(out));
    const runnerTemp = await io.realpath(env.RUNNER_TEMP);
    assert.equal(path.dirname(path.resolve(out)), runnerTemp);
    assert.equal(path.basename(out), `staging-commercial-deployment-${workflowRunId}-${workflowRunAttempt}.json`);
    try { await io.lstat(out); throw denied(); } catch (error) { assert.equal(error.code, 'ENOENT'); }
    const evidence = await collectCommercialDeploymentEvidence({ outputText, sourceSha, workflowRunId,
      workflowRunAttempt, sourceText, apiToken: env.CLOUDFLARE_API_TOKEN, request });
    await io.writeFile(out, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return evidence;
  } catch { throw denied(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2);
    await captureCommercialDeployment();
    console.log(JSON.stringify({ ok: true, deploymentEvidenceCaptured: true, fixtureOperations: 0 }));
  } catch { console.error('STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE_REFUSED'); process.exitCode = 1; }
}
