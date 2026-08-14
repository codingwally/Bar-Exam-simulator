import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStagingFailureDiagnostic,
  sanitizeStagingDiagnostic,
} from './staging-e2e-diagnostics.mjs';

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
assert.match(workflow, /refs\/heads\/agent\/header-subject-review-correction-20260814/);
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
assert.match(runner, /buildStagingFailureDiagnostic/);
assert.match(runner, /\^sb_secret_/);
assert.doesNotMatch(runner, /console\.log\([^\n]*serviceRoleKey/);

for (const suite of [
  'test-complete-beta-staging.mjs',
  'test-duediligence-2026-staging.mjs',
  'test-examinations-staging.mjs',
]) {
  const source = await readFile(path.join(root, 'scripts', suite), 'utf8');
  assert.doesNotMatch(source, /Authorization:\s*`Bearer \$\{SERVICE_ROLE_KEY\}`/);
  assert.match(source, /apikey:\s*SERVICE_ROLE_KEY|serviceHeaders/);
}

const syntheticSecret = 'eyJhbGciOiJIUzI1NiJ9.synthetic.signature';
const diagnostic = buildStagingFailureDiagnostic(
  `AssertionError [ERR_ASSERTION]: Request for https://example.test/path?token=private failed for student@example.test using Bearer ${syntheticSecret}\n    at file:///C:/repo/scripts/test-examinations-staging.mjs:443:10`,
  1,
  syntheticSecret,
);
assert.deepEqual(diagnostic, {
  category: 'request',
  message: 'Request for https://example.test/path failed for [email] using Bearer [credential]',
  location: 'test-examinations-staging.mjs:443:10',
  exitCode: 1,
});
assert.equal(sanitizeStagingDiagnostic(`token=${syntheticSecret}`, syntheticSecret).includes(syntheticSecret), false);

console.log('Trusted staging E2E workflow contract checks passed.');
