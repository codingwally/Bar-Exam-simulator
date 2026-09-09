import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash } from './debate-staging-release.mjs';
import { validateHostedPreparationRun, resolveHostedPreparationReceipt } from './resolve-debate-hosted-preparation.mjs';
const candidateSha = 'a'.repeat(40), runId = '34352333268';
const run = () => ({ id: Number(runId), workflow_id: 354012056, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
  head_branch: 'main', head_sha: candidateSha, repository: { full_name: 'codingwally/Bar-Exam-simulator' },
  head_repository: { full_name: 'codingwally/Bar-Exam-simulator' }, actor: { login: 'codingwally' }, triggering_actor: { login: 'codingwally' } });
test('preparation provenance rejects a fork, failed or unrelated workflow, different source and different actor', () => {
  assert.equal(validateHostedPreparationRun(run(), { runId, candidateSha }).runId, runId);
  for (const alter of [r => r.id++, r => r.workflow_id++, r => { r.event = 'pull_request'; }, r => { r.status = 'in_progress'; },
    r => { r.conclusion = 'failure'; }, r => { r.head_branch = 'feature'; }, r => { r.head_sha = 'b'.repeat(40); },
    r => { r.repository.full_name = 'other/repo'; }, r => { r.head_repository.full_name = 'fork/repo'; },
    r => { r.actor.login = 'another'; }, r => { r.triggering_actor.login = 'another'; }]) {
    const changed = run(); alter(changed); assert.throws(() => validateHostedPreparationRun(changed, { runId, candidateSha }), { code: 'HOSTED_PREPARATION_RUN_UNTRUSTED' });
  }
  assert.throws(() => validateHostedPreparationRun(run(), { runId: '../wrong', candidateSha }), { code: 'HOSTED_PREPARATION_REFERENCE_INVALID' });
});
test('artifact resolution selects only one digest-matched hosted preparation receipt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'debate-preparation-'));
  const nested = path.join(directory, 'staging-release', 'hosted-aaaaaaaaaaaa-10000000-0000-4000-8000-000000000001'); await mkdir(nested, { recursive: true });
  const bytes = JSON.stringify({ mode: 'prepare', sourceSha: candidateSha, status: 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY' });
  const filename = path.join(nested, 'driver.json'); await writeFile(filename, bytes);
  assert.equal(await resolveHostedPreparationReceipt({ directory, candidateSha, digest: hash(bytes) }), filename);
  await assert.rejects(resolveHostedPreparationReceipt({ directory, candidateSha, digest: 'b'.repeat(64) }), { code: 'HOSTED_PREPARATION_RECEIPT_NOT_UNIQUE' });
  await assert.rejects(resolveHostedPreparationReceipt({ directory, candidateSha: 'b'.repeat(40), digest: hash(bytes) }), { code: 'HOSTED_PREPARATION_RECEIPT_WRONG_OPERATION' });
  const duplicate = path.join(directory, 'hosted-aaaaaaaaaaaa-10000000-0000-4000-8000-000000000002'); await mkdir(duplicate); await writeFile(path.join(duplicate, 'driver.json'), bytes);
  await assert.rejects(resolveHostedPreparationReceipt({ directory, candidateSha, digest: hash(bytes) }), { code: 'HOSTED_PREPARATION_RECEIPT_NOT_UNIQUE' });
});
