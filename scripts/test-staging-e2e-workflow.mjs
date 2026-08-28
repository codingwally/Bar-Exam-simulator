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
assert.match(workflow, /refs\/heads\/agent\/soft-launch-five-token-20260821/);
assert.match(workflow, /refs\/heads\/codex\/examination-room-greenfield-20260826/);
assert.match(workflow, /refs\/heads\/fix\/admin-marketing-live-20260828/);
assert.match(workflow, /deploy_greenfield:/);
assert.match(workflow, /smoke_greenfield:/);
assert.match(
  workflow,
  /admin_analytics_database_preapplied:\s*\r?\n\s+description:.*20260828133000 \+ 20260828133500 \+ 20260828134000.*ledger hashes, and live probe are complete/,
);
assert.match(workflow, /EXAMINATION_ROOM_KEY_PEPPER/);
assert.match(workflow, /deploy --config wrangler\.staging\.toml/);
assert.match(workflow, /test-examination-room-v1-staging-smoke\.mjs/);
assert.doesNotMatch(workflow, /secret put EXAMINATION_ROOM_KEY_PEPPER|randomBytes\(48\)/);
const analyticsDatabaseGate = workflow.indexOf('Apply and live-probe the exact Admin analytics migrations');
const stagingWorkerCutover = workflow.indexOf('Deploy reviewed Worker and static artifact to staging');
assert.ok(
  analyticsDatabaseGate >= 0 && stagingWorkerCutover > analyticsDatabaseGate,
  'The exact Admin analytics database gate must complete before the staging Worker cutover.',
);
assert.match(workflow, /node scripts\/test-admin-analytics-release-bundle\.mjs/);
assert.match(
  workflow,
  /node scripts\/build-admin-analytics-release-bundle\.mjs --output "\$admin_analytics_release_bundle"/,
);
assert.match(
  workflow,
  /psql "\$ADMIN_ANALYTICS_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$admin_analytics_release_bundle"/,
);
assert.doesNotMatch(
  workflow,
  /--file "\$(?:scoped_helpers_migration|marketing_live_migration|recent_sign_ins_migration|live_probe)"/,
);
assert.equal(
  (workflow.match(/STAGING_SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.STAGING_SUPABASE_SERVICE_ROLE_KEY \}\}/g) || []).length,
  3,
);
assert.equal(
  (workflow.match(/node scripts\/run-staging-e2e-suite\.mjs (?:complete-beta|duediligence-2026|examinations)/g) || []).length,
  3,
);
for (const suite of ['complete-beta', 'duediligence-2026', 'examinations']) {
  assert.match(workflow, new RegExp(`run-staging-e2e-suite\\.mjs ${suite}`));
}
assert.match(workflow, /if:\s*always\(\)/);
assert.match(workflow, /artifacts\/staging-e2e\/\*\.json/);
assert.doesNotMatch(workflow, /echo[^\n]*(SERVICE_ROLE|Authorization|apikey)/i);
assert.match(workflow, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:\s*'1'/);
assert.match(workflow, /npm install --no-save --no-package-lock playwright@1\.54\.2/);

assert.match(runner, /hlzqmreeoghbldnhlybr/);
assert.match(runner, /hbllomlijfznnuudpdvr/);
assert.match(runner, /productionWorkerHost/);
assert.match(runner, /synthetic_cleanup=true/);
assert.match(runner, /secretEchoDetected/);
assert.match(runner, /buildStagingFailureDiagnostic/);
assert.match(runner, /\^sb_secret_/);
assert.match(runner, /test-examinations-staging-ui\.mjs/);
assert.match(runner, /EXAMINATIONS_UI_STAGING: synthetic_cleanup=true/);
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

const primitiveDiagnostic = buildStagingFailureDiagnostic(
  'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n6 !== 5\n\n    at file:///C:/repo/scripts/test-commercial-launch-staging.mjs:252:10\n  generatedMessage: true,\n  code: \'ERR_ASSERTION\',\n  actual: 6,\n  expected: 5,\n  operator: \'strictEqual\'',
  1,
  syntheticSecret,
);
assert.equal(primitiveDiagnostic.location, 'test-commercial-launch-staging.mjs:252:10');
assert.equal(primitiveDiagnostic.actual, '6');
assert.equal(primitiveDiagnostic.expected, '5');

console.log('Trusted staging E2E workflow contract checks passed.');
