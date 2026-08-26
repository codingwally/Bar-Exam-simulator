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
  releaseBundleBuilder,
] = await Promise.all([
  read('.github/workflows/deploy.yml'),
  read('.github/workflows/validate-mandatory-early-access.yml'),
  read('.github/workflows/deploy-worker.yml'),
  read('.github/workflows/bootstrap-examination-room-key-pepper.yml'),
  read('.github/workflows/staging-e2e-gate.yml'),
  read('scripts/test-examination-room-v1-staging-smoke.mjs'),
  read('scripts/build-examination-room-release-bundle.mjs'),
]);

for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['pull-request validation', pullRequestWorkflow],
  ['Worker release', workerWorkflow],
  ['staging release', stagingWorkflow],
]) {
  assert.match(
    workflow,
    /node --test admin\/examination-room-admin\.test\.cjs/u,
    `${label} must run the owner command-center client tests.`,
  );
  assert.match(
    workflow,
    /node scripts\/test-examination-room-database\.mjs/u,
    `${label} must validate the complete Examination Room database contract.`,
  );
  assert.match(
    workflow,
    /node scripts\/test-examination-room-commercial-stress\.mjs/u,
    `${label} must run the 100-exam commercial stress contract.`,
  );
}

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
  "      - 'admin/examination-room-admin.test.cjs'",
  "      - 'examination-room/**'",
  "      - 'worker/examination-room-v1-*.mjs'",
  "      - 'worker/examination-room-email.mjs'",
  "      - 'worker/examination-room-email.test.mjs'",
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
  "      - 'scripts/test-examination-room-database.mjs'",
  "      - 'scripts/test-examination-room-commercial-stress.mjs'",
  "      - 'scripts/test-examination-room-v1-staging-smoke.mjs'",
  "      - 'scripts/test-examination-room-release-workflows.mjs'",
  "      - 'scripts/test-feature-decommission-boundary.mjs'",
  "      - 'supabase/migrations/20260825183055_examination_room_v1_greenfield.sql'",
  "      - 'supabase/migrations/20260826130536_examination_room_owner_command_center.sql'",
  "      - 'supabase/migrations/20260827010000_examination_room_open_admission_flow.sql'",
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
for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['Worker release', workerWorkflow],
]) {
  assert.match(
    workflow,
    /group: "examination-room-production-cutover"/u,
    `${label} must share the single production cutover lock.`,
  );
  assert.match(workflow, /cancel-in-progress: false/u);
}
assert.match(
  pagesWorkflow,
  /node --test worker\/\*\.test\.mjs/u,
  'The Pages release must verify the Worker before exposing a matching client.',
);
for (const requiredPreflight of [
  'Verify production Examination Room Worker secrets exist',
  'Verify private recovery bucket and lifecycle before cutover',
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'duediligence-examination-room-backups',
]) {
  assert.match(pagesWorkflow, new RegExp(requiredPreflight));
}
const pagesWorkerCutover = pagesWorkflow.indexOf('Deploy Worker before exposing the new Pages client');
const pagesArtifactBuild = pagesWorkflow.indexOf('Build sanitized Pages artifact');
const pagesDeployment = pagesWorkflow.indexOf('Deploy to GitHub Pages');
assert.ok(
  pagesWorkerCutover >= 0
    && pagesArtifactBuild > pagesWorkerCutover
    && pagesDeployment > pagesArtifactBuild,
  'The Pages release must deploy the verified Worker before building and exposing the new client.',
);
assert.doesNotMatch(
  workerWorkflow,
  /secret put EXAMINATION_ROOM_KEY_PEPPER|Ensure the Examination Room key pepper exists/u,
  'An ordinary production deploy must never create or rotate the Examination Room pepper.',
);
assert.match(workerWorkflow, /never rotate it during deploy/u);
for (const requiredReleaseDependency of [
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'EXAMINATION_ROOM_BACKUPS',
  'duediligence-examination-room-backups',
]) {
  assert.match(workerWorkflow, new RegExp(requiredReleaseDependency));
}

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
assert.match(stagingWorkflow, /refs\/heads\/codex\/examination-room-owner-command-center-20260826/u);
assert.match(stagingWorkflow, /EXAMINATION_ROOM_KEY_PEPPER/u);
assert.match(stagingWorkflow, /secret list --format json --name duediligence-examinations-staging/u);
for (const requiredReleaseDependency of [
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'EXAMINATION_ROOM_BACKUPS',
  'duediligence-examination-room-backups-staging',
]) {
  assert.match(stagingWorkflow, new RegExp(requiredReleaseDependency));
}
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

for (const [label, workflow, databaseSecret] of [
  ['Pages release', pagesWorkflow, 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL'],
  ['Worker release', workerWorkflow, 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL'],
  ['staging release', stagingWorkflow, 'EXAMINATION_ROOM_STAGING_DATABASE_URL'],
]) {
  assert.match(
    workflow,
    /node scripts\/build-examination-room-release-bundle\.mjs --output "\$release_bundle"/u,
    `${label} must build the exact reviewed three-migration bundle before cutover.`,
  );
  assert.match(workflow, new RegExp(databaseSecret));
  assert.match(workflow, /psql "\$EXAMINATION_ROOM_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$release_bundle"/u);
  assert.doesNotMatch(
    workflow,
    /supabase\s+(?:db\s+push|migration\s+up)/u,
    `${label} must never apply the repository's unrelated pending migration ledger.`,
  );
  const migrationGate = workflow.indexOf('build-examination-room-release-bundle.mjs');
  const cutover = label === 'Pages release'
    ? workflow.indexOf('Build sanitized Pages artifact')
    : workflow.indexOf(label === 'Worker release' ? 'Deploy Worker' : 'Deploy reviewed Worker and static artifact to staging');
  assert.ok(migrationGate >= 0 && cutover > migrationGate, `${label} must probe the database before cutover.`);
}

assert.ok(
  releaseBundleBuilder.indexOf('20260825183055_examination_room_v1_greenfield.sql')
    < releaseBundleBuilder.indexOf('20260826130536_examination_room_owner_command_center.sql'),
  'The isolated release bundle must apply the greenfield migration before the owner migration.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260826130536_examination_room_owner_command_center.sql')
    < releaseBundleBuilder.indexOf('20260827010000_examination_room_open_admission_flow.sql'),
  'The isolated release bundle must apply the owner migration before the open-admission migration.',
);
for (const requiredProbe of [
  'examination_room_v1_api(text,text,uuid,uuid,jsonb)',
  'examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)',
  'examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)',
  'examination_room_v1_grading_contexts(uuid,uuid,uuid,jsonb)',
  'examination_room_v1_import_grades(uuid,uuid,uuid,jsonb)',
  'examination_room_v1_verify_recovery_snapshot(uuid,text)',
  'prepare_student_admission(jsonb)',
  'creator_revoke_session(uuid,uuid,jsonb)',
  'admission_mode_snapshot',
]) {
  assert.match(releaseBundleBuilder, new RegExp(requiredProbe.replace(/[()]/gu, '\\$&')));
}
assert.match(releaseBundleBuilder, /Partial Examination Room .* state detected; refusing an unsafe reapply/u);
assert.match(releaseBundleBuilder, /supabase_migrations\.schema_migrations/u);
assert.match(releaseBundleBuilder, /examination_room_greenfield_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_owner_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_open_admission_ledger_exact/u);
assert.match(releaseBundleBuilder, /without this release exact checksum/u);
assert.match(releaseBundleBuilder, /Unrecorded pre-existing .* objects cannot be adopted from existence probes/u);
assert.doesNotMatch(releaseBundleBuilder, /Repairing only the missing/u);
assert.doesNotMatch(releaseBundleBuilder, /readdir|glob|supabase\s+(?:db\s+push|migration\s+up)/u);

for (const workflow of [workerWorkflow, stagingWorkflow]) {
  assert.match(workflow, /\/r2\/buckets\/[^"]+\/lifecycle/u);
  assert.match(workflow, /examination-room-recovery\/v1\//u);
  assert.match(workflow, /365 \* 24 \* 60 \* 60/u);
}

console.log('Examination Room release workflow contract checks passed.');
