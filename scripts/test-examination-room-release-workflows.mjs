import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [
  pagesWorkflow,
  pullRequestWorkflow,
  workerWorkflow,
  bootstrapWorkflow,
  stagingWorkflow,
  stagingSmoke,
] = await Promise.all([
  read('.github/workflows/deploy.yml'),
  read('.github/workflows/validate-mandatory-early-access.yml'),
  read('.github/workflows/deploy-worker.yml'),
  read('.github/workflows/bootstrap-examination-room-key-pepper.yml'),
  read('.github/workflows/staging-e2e-gate.yml'),
  read('scripts/test-examination-room-v1-staging-smoke.mjs'),
]);

for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['pull-request validation', pullRequestWorkflow],
]) {
  assert.match(
    workflow,
    /node --test examination-room\/\*\.test\.cjs/u,
    `${label} must run all Examination Room client tests.`,
  );
  assert.match(
    workflow,
    /node scripts\/test-examination-room-release-workflows\.mjs/u,
    `${label} must enforce the Examination Room release workflow contract.`,
  );
}

for (const requiredPath of [
  "      - 'index.html'",
  "      - 'service-worker.js'",
  "      - 'assets/quorum-first-shell.css'",
  "      - 'assets/icons/navigation/door-open.svg'",
  "      - 'admin/index.html'",
  "      - 'admin/examination-room-admin.css'",
  "      - 'admin/examination-room-admin.js'",
  "      - 'examination-room/**'",
  "      - 'worker/examination-room-v1-*.mjs'",
  "      - 'worker/wrangler.staging.toml'",
  "      - 'scripts/build-staging-artifact.mjs'",
  "      - 'scripts/test-staging-artifact.mjs'",
  "      - 'scripts/test-approved-renovation-shell.mjs'",
  "      - 'scripts/test-audience-menu.mjs'",
  "      - 'scripts/test-auth-route-overlay.mjs'",
  "      - 'scripts/test-design-correction-release.mjs'",
  "      - 'scripts/test-phase2-contract.mjs'",
  "      - 'scripts/test-phase4-release4.mjs'",
  "      - 'scripts/test-private-beta-landing.mjs'",
  "      - 'scripts/test-examination-room-v1-staging-smoke.mjs'",
  "      - 'scripts/test-examination-room-release-workflows.mjs'",
  "      - 'scripts/test-feature-decommission-boundary.mjs'",
  "      - 'supabase/migrations/20260825183055_examination_room_v1_greenfield.sql'",
  "      - 'supabase/tests/database/**'",
  "      - '.github/workflows/staging-e2e-gate.yml'",
  "      - '.github/workflows/bootstrap-examination-room-key-pepper.yml'",
]) {
  assert.ok(
    pullRequestWorkflow.includes(requiredPath),
    `The PR gate is missing the Examination Room path filter: ${requiredPath.trim()}`,
  );
}

assert.match(workerWorkflow, /EXAMINATION_ROOM_KEY_PEPPER/u);
assert.doesNotMatch(
  workerWorkflow,
  /secret put EXAMINATION_ROOM_KEY_PEPPER|Ensure the Examination Room key pepper exists/u,
  'An ordinary production deploy must never create or rotate the Examination Room pepper.',
);
assert.match(workerWorkflow, /never rotate it during deploy/u);

assert.match(bootstrapWorkflow, /workflow_dispatch:/u);
assert.doesNotMatch(bootstrapWorkflow, /pull_request_target|\bpull_request\s*:|\bpush\s*:/u);
assert.match(bootstrapWorkflow, /confirm_one_time_bootstrap:/u);
assert.match(bootstrapWorkflow, /refs\/heads\/main/u);
assert.match(bootstrapWorkflow, /target_environment == 'production'/u);
assert.match(bootstrapWorkflow, /--name duediligence-examinations-staging/u);
assert.match(bootstrapWorkflow, /--name duediligence-gemini-examiner/u);
assert.match(bootstrapWorkflow, /Refusing to rotate EXAMINATION_ROOM_KEY_PEPPER/u);
assert.equal(
  (bootstrapWorkflow.match(/secret put EXAMINATION_ROOM_KEY_PEPPER/gu) || []).length,
  1,
  'The one-time workflow must have exactly one pepper creation command.',
);
assert.doesNotMatch(bootstrapWorkflow, /echo[^\n]*\$examination_room_key_pepper/u);

assert.match(stagingWorkflow, /deploy_greenfield:/u);
assert.match(stagingWorkflow, /smoke_greenfield:/u);
assert.match(stagingWorkflow, /refs\/heads\/codex\/examination-room-greenfield-20260826/u);
assert.match(stagingWorkflow, /EXAMINATION_ROOM_KEY_PEPPER/u);
assert.match(stagingWorkflow, /secret list --format json --name duediligence-examinations-staging/u);
assert.match(stagingWorkflow, /deploy --config wrangler\.staging\.toml/u);
assert.match(stagingWorkflow, /node scripts\/test-examination-room-v1-staging-smoke\.mjs/u);
assert.match(stagingSmoke, /redirect:\s*'follow'/u);
assert.match(stagingSmoke, /response\.url\)\.origin !== new URL\(stagingUrl\)\.origin/u);
assert.match(stagingWorkflow, /node --test examination-room\/\*\.test\.cjs/u);
assert.doesNotMatch(
  stagingWorkflow,
  /secret put EXAMINATION_ROOM_KEY_PEPPER|randomBytes\(48\)/u,
  'The staging deploy must fail closed instead of creating or rotating its pepper.',
);

assert.match(stagingSmoke, /\/examination-room\//u);
assert.match(stagingSmoke, /\/examination-room\/student\.html/u);
assert.match(stagingSmoke, /\/examination-room\/api\.js/u);
assert.match(stagingSmoke, /\/examination-room\/v1\/professor\/query/u);
assert.match(stagingSmoke, /EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED/u);
assert.match(stagingSmoke, /\/examination-room\/v1\/student\/preview/u);
assert.match(stagingSmoke, /EXAM_ROOM_V1_ROOM_KEY_INVALID/u);
assert.doesNotMatch(stagingSmoke, /console\.log\([^\n]*(body|roomKey|response)/u);

console.log('Examination Room release workflow contract checks passed.');
