/** Read-only provenance and digest resolution for a prior hosted fixture probe. */
import { appendFile, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'codingwally/Bar-Exam-simulator';
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
export function validateHostedPreparationRun(run, { runId, candidateSha }) {
  need(/^[1-9][0-9]{5,18}$/.test(runId || '') && /^[a-f0-9]{40}$/.test(candidateSha || ''), 'HOSTED_PREPARATION_REFERENCE_INVALID');
  need(String(run?.id) === runId && run.workflow_id === 354012056 && run.event === 'workflow_dispatch'
    && run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'main'
    && run.head_sha === candidateSha && run.repository?.full_name === REPOSITORY
    && run.head_repository?.full_name === REPOSITORY && run.actor?.login === 'codingwally'
    && run.triggering_actor?.login === 'codingwally', 'HOSTED_PREPARATION_RUN_UNTRUSTED');
  return { runId, candidateSha, workflowId: run.workflow_id };
}

export async function resolveHostedPreparationReceipt({ directory, digest, candidateSha }) {
  need(/^[a-f0-9]{64}$/.test(digest || '') && /^[a-f0-9]{40}$/.test(candidateSha || ''), 'HOSTED_PREPARATION_REFERENCE_INVALID');
  const base = await realpath(directory), matches = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      need(!entry.isSymbolicLink(), 'HOSTED_PREPARATION_ARTIFACT_SYMLINK');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name === 'driver.json' && /^hosted-[a-f0-9]{12}-[a-f0-9-]{36}$/.test(path.basename(dir))) {
        const bytes = await readFile(file);
        if (hash(bytes) === digest) {
          const report = JSON.parse(bytes);
          need(report.mode === 'prepare' && report.sourceSha === candidateSha
            && report.status === 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY', 'HOSTED_PREPARATION_RECEIPT_WRONG_OPERATION');
          matches.push(file);
        }
      }
    }
  };
  await walk(base);
  need(matches.length === 1, 'HOSTED_PREPARATION_RECEIPT_NOT_UNIQUE');
  return matches[0];
}

async function main() {
  const mode = process.argv[2];
  need(['provenance','resolve'].includes(mode) && process.argv.length === 3, 'HOSTED_PREPARATION_MODE');
  need(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_ACTOR === 'codingwally'
    && process.env.GITHUB_TRIGGERING_ACTOR === 'codingwally', 'HOSTED_PREPARATION_CI_ONLY');
  const candidateSha = process.env.DEBATE_CANDIDATE_SHA, digest = process.env.DEBATE_HOSTED_PREPARATION_SHA256;
  need(/^[a-f0-9]{64}$/.test(digest || '') && /^[a-f0-9]{40}$/.test(candidateSha || ''), 'HOSTED_PREPARATION_REFERENCE_INVALID');
  if (mode === 'provenance') {
    const runId = process.env.DEBATE_HOSTED_PREPARATION_RUN_ID;
    need(/^[1-9][0-9]{5,18}$/.test(runId || '') && process.env.GH_TOKEN, 'HOSTED_PREPARATION_REFERENCE_INVALID');
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${runId}`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000) });
    need(response.ok, 'HOSTED_PREPARATION_RUN_UNAVAILABLE');
    validateHostedPreparationRun(await response.json(), { runId, candidateSha });
    console.log('PASS_HOSTED_PREPARATION_RUN_PROVENANCE');
  } else {
    const filename = await resolveHostedPreparationReceipt({ directory: path.join(ROOT, 'artifacts/debate-local-rehearsal/hosted-preparation'), digest, candidateSha });
    const relative = path.relative(ROOT, filename).replaceAll(path.sep, '/');
    need(!/[\r\n]/.test(relative) && relative.startsWith('artifacts/'), 'HOSTED_PREPARATION_PATH_INVALID');
    await appendFile(process.env.GITHUB_ENV, `DEBATE_HOSTED_PREPARATION_REPORT=${relative}\nDEBATE_HOSTED_PREPARATION_SHA256=${digest}\n`);
    console.log('PASS_HOSTED_PREPARATION_RECEIPT_DIGEST');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(/^[A-Z_]+$/.test(error?.code || '') ? error.code : 'HOSTED_PREPARATION_RESOLUTION_FAILED'); process.exitCode = 1;
});
