import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = await readFile(
  path.join(root, '.github', 'workflows', 'staging-e2e-gate.yml'),
  'utf8',
);
const runner = await readFile(path.join(root, 'scripts', 'run-staging-e2e-suite.mjs'), 'utf8');

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request_target|\bpull_request\s*:/);
assert.match(workflow, /environment:\s*staging-e2e/);
assert.match(workflow, /github\.actor != 'dependabot\[bot\]'/);
assert.match(workflow, /refs\/heads\/agent\/master-experience-release-20260813/);
assert.equal(
  (workflow.match(/STAGING_SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.STAGING_SUPABASE_SERVICE_ROLE_KEY \}\}/g) || []).length,
  3,
);
assert.equal((workflow.match(/run: node scripts\/run-staging-e2e-suite\.mjs (?!-)/g) || []).length, 3);
for (const suite of ['complete-beta', 'duediligence-2026', 'examinations']) {
  assert.match(workflow, new RegExp(`run-staging-e2e-suite\\.mjs ${suite}`));
}
assert.match(workflow, /if:\s*always\(\)/);
assert.match(workflow, /artifacts\/staging-e2e\/\*\.json/);
assert.doesNotMatch(workflow, /echo[^\n]*(SERVICE_ROLE|Authorization|apikey)/i);

assert.match(runner, /hlzqmreeoghbldnhlybr/);
assert.match(runner, /hbllomlijfznnuudpdvr/);
assert.match(runner, /productionWorkerHost/);
assert.match(runner, /synthetic_cleanup=true/);
assert.match(runner, /secretEchoDetected/);
assert.match(runner, /serviceRoleKey\.startsWith\('sb_secret_'\)/);
assert.doesNotMatch(runner, /console\.log\([^\n]*serviceRoleKey/);

console.log('Trusted staging E2E workflow contract checks passed.');
