import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (relativePath) => (await readFile(path.join(root, relativePath), 'utf8'))
  .replace(/\r\n?/gu, '\n');

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
  "      - 'worker/examination-room-media.mjs'",
  "      - 'worker/examination-room-media.test.mjs'",
  "      - 'worker/public-api-alias.mjs'",
  "      - 'worker/public-api-alias.test.mjs'",
  "      - 'worker/wrangler.public-api.toml'",
  "      - 'assets/profile-photo.js'",
  "      - 'assets/pedro-navigation.js'",
  "      - 'assets/pedro.js'",
  "      - 'assets/pedro.css'",
  "      - 'worker/pedro-core.mjs'",
  "      - 'worker/pedro-core.test.mjs'",
  "      - 'worker/pedro-routes.mjs'",
  "      - 'worker/pedro-routes.test.mjs'",
  "      - 'worker/forum-core.mjs'",
  "      - 'worker/forum-core.test.mjs'",
  "      - 'scripts/test-profile-photo-release2.mjs'",
  "      - 'scripts/test-profile-avatar-cleanup-migration.mjs'",
  "      - 'scripts/test-pedro-release2-integration.mjs'",
  "      - 'scripts/test-pedro-migration-contract.mjs'",
  "      - 'scripts/test-pedro-exact-openers.mjs'",
  "      - 'scripts/test-pedro-frontend.mjs'",
  "      - 'scripts/test-pedro-navigation.mjs'",
  "      - 'supabase/migrations/20260827143000_pedro_private_study_inbox.sql'",
  "      - 'supabase/migrations/20260827144000_profile_avatar_cleanup_queue.sql'",
  "      - 'supabase/migrations/20260827145000_pedro_foreign_key_indexes.sql'",
  "      - 'worker/wrangler.staging.toml'",
  "      - 'scripts/build-staging-artifact.mjs'",
  "      - 'scripts/test-staging-artifact.mjs'",
  "      - 'scripts/test-approved-renovation-shell.mjs'",
  "      - 'scripts/test-audience-menu.mjs'",
  "      - 'scripts/test-auth-route-overlay.mjs'",
  "      - 'scripts/test-design-correction-release.mjs'",
  "      - 'scripts/measure-private-beta-read-capacity.mjs'",
  "      - 'scripts/test-duediligence-2026-frontend.mjs'",
  "      - 'scripts/test-examinations.mjs'",
  "      - 'scripts/test-gemini-examiner.mjs'",
  "      - 'scripts/test-lex-forum.mjs'",
  "      - 'scripts/test-master-experience-release.mjs'",
  "      - 'scripts/test-quorum-navigation-state.mjs'",
  "      - 'scripts/test-subject-matter-skip-flag.mjs'",
  "      - 'scripts/test-verdict-export-loading.mjs'",
  "      - 'scripts/test-phase2-contract.mjs'",
  "      - 'scripts/test-phase4-release4.mjs'",
  "      - 'scripts/test-private-beta-landing.mjs'",
  "      - 'scripts/test-examination-room-database.mjs'",
  "      - 'scripts/test-examination-room-commercial-stress.mjs'",
  "      - 'scripts/test-examination-room-v1-staging-smoke.mjs'",
  "      - 'scripts/test-examination-room-release-workflows.mjs'",
  "      - 'scripts/build-examination-room-release-bundle.mjs'",
  "      - 'scripts/build-examination-room-pure-sql-release-bundle.mjs'",
  "      - 'scripts/test-examination-room-pure-sql-release-bundle.mjs'",
  "      - 'scripts/test-examination-room-key-reliability-migration.mjs'",
  "      - 'scripts/test-examination-room-lifecycle-migration.mjs'",
  "      - 'scripts/test-examination-room-recorded-media-migration.mjs'",
  "      - 'scripts/test-feature-decommission-boundary.mjs'",
  "      - 'supabase/migrations/20260825183055_examination_room_v1_greenfield.sql'",
  "      - 'supabase/migrations/20260826130536_examination_room_owner_command_center.sql'",
  "      - 'supabase/migrations/20260827010000_examination_room_open_admission_flow.sql'",
  "      - 'supabase/migrations/20260827020000_examination_room_result_email_delivery.sql'",
  "      - 'supabase/migrations/20260827030000_examination_room_supabase_storage_recovery.sql'",
  "      - 'supabase/migrations/20260827190036_examination_room_key_delivery_nullable_creator.sql'",
  "      - 'supabase/migrations/20260827193000_examination_room_lifecycle_controls.sql'",
  "      - 'supabase/migrations/20260828123000_examination_room_recorded_media.sql'",
  "      - 'supabase/tests/database/**'",
  "      - '.github/workflows/staging-e2e-gate.yml'",
  "      - '.github/workflows/bootstrap-examination-room-key-pepper.yml'",
]) {
  assert.ok(
    pullRequestWorkflow.includes(requiredPath),
    `The PR gate is missing the Examination Room path filter: ${requiredPath.trim()}`,
  );
}

for (const focusedReleaseGate of [
  'test-examination-room-key-reliability-migration.mjs',
  'test-examination-room-lifecycle-migration.mjs',
  'test-examination-room-recorded-media-migration.mjs',
  'test-examination-room-pure-sql-release-bundle.mjs',
]) {
  assert.ok(
    pullRequestWorkflow.includes(focusedReleaseGate),
    `The PR gate must run the focused Examination Room release check: ${focusedReleaseGate}`,
  );
}

assert.match(workerWorkflow, /EXAMINATION_ROOM_KEY_PEPPER/u);
for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['Worker release', workerWorkflow],
  ['staging release', stagingWorkflow],
]) {
  assert.match(
    workflow,
    /const required = \[[^\]\n]*'GEMINI_API_KEY'/u,
    `${label} must fail closed when the application model-provider secret is absent.`,
  );
}

for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['Worker release', workerWorkflow],
  ['staging release', stagingWorkflow],
]) {
  assert.match(
    workflow,
    /release2_database_preapplied:\s*\r?\n\s+description:.*Pedro and profile-photo.*manually applied and live-probed.*\r?\n\s+required: true\s*\r?\n\s+default: false\s*\r?\n\s+type: boolean/u,
    `${label} must default the Release 2 database attestation to false.`,
  );
  assert.match(workflow, /RELEASE2_DATABASE_PREAPPLIED: \$\{\{ inputs\.release2_database_preapplied \}\}/u);
  assert.match(workflow, /if \[\[ "\$RELEASE2_DATABASE_PREAPPLIED" != "true" \]\]; then/u);
  for (const migration of [
    '20260827143000_pedro_private_study_inbox.sql',
    '20260827144000_profile_avatar_cleanup_queue.sql',
    '20260827145000_pedro_foreign_key_indexes.sql',
  ]) {
    assert.ok(workflow.includes(migration), `${label} Release 2 attestation is missing ${migration}`);
  }
  assert.match(
    workflow,
    /grep -R --include='\*\.html' -F 'phase2-config\.js\?v=private-maintenance-20260820-2' index\.html admin examination-room/u,
    `${label} must reject every legacy provider-visible HTML config consumer.`,
  );
  const release2Gate = workflow.indexOf('Require the live-probed Release 2 database contract');
  const cutover = label === 'Pages release'
    ? workflow.indexOf('Deploy Worker before exposing the new Pages client')
    : workflow.indexOf(label === 'Worker release' ? '      - name: Deploy Worker\n' : 'Deploy reviewed Worker and static artifact to staging');
  assert.ok(release2Gate >= 0 && cutover > release2Gate, `${label} must attest Release 2 before Worker cutover.`);
}
assert.match(
  pullRequestWorkflow,
  /grep -R --include='\*\.html' -F 'phase2-config\.js\?v=private-maintenance-20260820-2' index\.html admin examination-room/u,
);

for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['Worker release', workerWorkflow],
  ['staging release', stagingWorkflow],
  ['pull-request validation', pullRequestWorkflow],
]) {
  for (const release2Gate of [
    'test-profile-photo-release2.mjs',
    'test-profile-avatar-cleanup-migration.mjs',
    'test-pedro-release2-integration.mjs',
    'test-pedro-migration-contract.mjs',
    'test-pedro-exact-openers.mjs',
    'test-pedro-frontend.mjs',
    'test-pedro-navigation.mjs',
    'test-gemini-examiner.mjs',
    'test-master-experience-release.mjs',
    'test-quorum-navigation-state.mjs',
  ]) {
    assert.ok(workflow.includes(release2Gate), `${label} is missing Release 2 gate: ${release2Gate}`);
  }
}
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
  'Verify private Supabase Storage recovery configuration before cutover',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'EXAMINATION_ROOM_RECOVERY_MODE = "supabase_storage"',
  'examination-room-recovery',
  'application/vnd.duediligence.examination-room-recovery+json',
]) {
  assert.ok(pagesWorkflow.includes(requiredPreflight), 'Pages release is missing: ' + requiredPreflight);
}
const pagesWorkerCutover = pagesWorkflow.indexOf('Deploy Worker before exposing the new Pages client');
const pagesPublicAliasCutover = pagesWorkflow.indexOf(
  'Deploy provider-neutral public API alias before exposing the new Pages client',
);
const pagesArtifactBuild = pagesWorkflow.indexOf('Build sanitized Pages artifact');
const pagesDeployment = pagesWorkflow.indexOf('Deploy to GitHub Pages');
assert.ok(
  pagesWorkerCutover >= 0
    && pagesPublicAliasCutover > pagesWorkerCutover
    && pagesArtifactBuild > pagesPublicAliasCutover
    && pagesDeployment > pagesArtifactBuild,
  'The Pages release must deploy the verified Worker and provider-neutral public alias before building and exposing the new client.',
);
assert.match(pagesWorkflow, /command: deploy --config wrangler\.public-api\.toml/u);

const workerCoreCutover = workerWorkflow.indexOf('      - name: Deploy Worker\n');
const workerPublicAliasCutover = workerWorkflow.indexOf('      - name: Deploy provider-neutral public API alias\n');
assert.ok(
  workerCoreCutover >= 0 && workerPublicAliasCutover > workerCoreCutover,
  'The Worker-only release must deploy the verified core Worker before its provider-neutral public alias.',
);
assert.match(workerWorkflow, /command: deploy --config wrangler\.public-api\.toml/u);
assert.doesNotMatch(
  workerWorkflow,
  /secret put EXAMINATION_ROOM_KEY_PEPPER|Ensure the Examination Room key pepper exists/u,
  'An ordinary production deploy must never create or rotate the Examination Room pepper.',
);
assert.match(workerWorkflow, /never rotate it during deploy/u);
for (const requiredReleaseDependency of [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'EXAMINATION_ROOM_RECOVERY_MODE = "supabase_storage"',
  'examination-room-recovery',
  'application/vnd.duediligence.examination-room-recovery+json',
]) {
  assert.ok(workerWorkflow.includes(requiredReleaseDependency), 'Worker release is missing: ' + requiredReleaseDependency);
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
  'SUPABASE_SERVICE_ROLE_KEY',
  'EXAMINATION_ROOM_OWNER_DATA_KEY_V1',
  'EXAMINATION_ROOM_BACKUP_MASTER_KEY_V1',
  'EXAMINATION_ROOM_ADMIN_EMAILS',
  'EXAMINATION_ROOM_RECOVERY_MODE = "supabase_storage"',
  'examination-room-recovery',
  'application/vnd.duediligence.examination-room-recovery+json',
]) {
  assert.ok(stagingWorkflow.includes(requiredReleaseDependency), 'Staging release is missing: ' + requiredReleaseDependency);
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
    /database_release_preapplied:\s*\r?\n\s+description:.*manually applied and live-probed.*\r?\n\s+required: true\s*\r?\n\s+default: false\s*\r?\n\s+type: boolean/u,
    `${label} must default the manual database-release attestation to false.`,
  );
  assert.match(workflow, /DATABASE_RELEASE_PREAPPLIED: \$\{\{ inputs\.database_release_preapplied \}\}/u);
  assert.match(workflow, /elif \[\[ "\$DATABASE_RELEASE_PREAPPLIED" == "true" \]\]; then/u);
  assert.match(workflow, /this exact reviewed bundle was manually applied and live-probed before cutover/u);
  assert.match(workflow, new RegExp(`${databaseSecret} is missing\\.`));
  assert.doesNotMatch(
    workflow,
    /test -n "\$EXAMINATION_ROOM_DATABASE_URL"/u,
    `${label} must permit only the explicit preapplied path when the database URL is absent.`,
  );
}

for (const [label, workflow, databaseSecret] of [
  ['Pages release', pagesWorkflow, 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL'],
  ['Worker release', workerWorkflow, 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL'],
  ['staging release', stagingWorkflow, 'EXAMINATION_ROOM_STAGING_DATABASE_URL'],
]) {
  assert.match(
    workflow,
    /node scripts\/build-examination-room-release-bundle\.mjs --output "\$release_bundle"/u,
    `${label} must build the exact reviewed nine-migration bundle before cutover.`,
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
  assert.ok(migrationGate >= 0 && cutover > migrationGate, `${label} must enforce the database-release gate before cutover.`);
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
assert.ok(
  releaseBundleBuilder.indexOf('20260827010000_examination_room_open_admission_flow.sql')
    < releaseBundleBuilder.indexOf('20260827020000_examination_room_result_email_delivery.sql'),
  'The isolated release bundle must apply open admission before durable result-email delivery.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260827020000_examination_room_result_email_delivery.sql')
    < releaseBundleBuilder.indexOf('20260827030000_examination_room_supabase_storage_recovery.sql'),
  'The isolated release bundle must apply durable result-email delivery before private recovery storage.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260827030000_examination_room_supabase_storage_recovery.sql')
    < releaseBundleBuilder.indexOf('20260827190036_examination_room_key_delivery_nullable_creator.sql'),
  'The isolated release bundle must apply private recovery storage before key reliability.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260827190036_examination_room_key_delivery_nullable_creator.sql')
    < releaseBundleBuilder.indexOf('20260827193000_examination_room_lifecycle_controls.sql'),
  'The isolated release bundle must apply key reliability before lifecycle controls.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260827193000_examination_room_lifecycle_controls.sql')
    < releaseBundleBuilder.indexOf('20260828123000_examination_room_recorded_media.sql'),
  'The isolated release bundle must apply lifecycle controls before recorded media.',
);
assert.ok(
  releaseBundleBuilder.indexOf('20260828123000_examination_room_recorded_media.sql')
    < releaseBundleBuilder.indexOf('20260828124000_examination_room_immediate_key_access.sql'),
  'The isolated release bundle must apply recorded media before immediate Admin-key access.',
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
  'examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)',
  'examination_room_v1_complete_result_email_deliveries(uuid,jsonb)',
  'result_email_delivery_events',
  'storage.buckets',
  'examination-room-recovery',
  'public is false',
  'file_size_limit >= 10485760',
  'application/vnd.duediligence.examination-room-recovery+json',
  'email_delivery_events_professor_recipient_check',
  'professor_recipient is null',
  'the prior room-key request is already bound to a different key.',
  'persisted.professor_recipient is not distinct from excluded.professor_recipient',
  'examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)',
  'exams_owner_active_lifecycle_idx',
  'exams_admin_lifecycle_idx',
  'examination-room-media',
  'media_upload_intents',
  'media_upload_intents_touch_updated_at',
  'media_upload_intents_no_delete',
  'examination_room_v1_media(text,jsonb)',
  "array['application/octet-stream']::text[]",
  'activation_expires_at',
  'public.examination_room_v1_lifecycle_guard(activation_row.exam_id)',
  'examination_room_immediate_key_access',
]) {
  assert.ok(releaseBundleBuilder.includes(requiredProbe), 'Release bundle is missing probe: ' + requiredProbe);
}
assert.match(releaseBundleBuilder, /Partial Examination Room .* state detected; refusing an unsafe reapply/u);
assert.match(releaseBundleBuilder, /supabase_migrations\.schema_migrations/u);
assert.match(releaseBundleBuilder, /examination_room_greenfield_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_owner_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_open_admission_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_result_email_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_recovery_storage_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_key_reliability_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_lifecycle_controls_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_recorded_media_ledger_exact/u);
assert.match(releaseBundleBuilder, /examination_room_immediate_key_access_ledger_exact/u);
assert.match(releaseBundleBuilder, /name = '\$\{keyReliability\.name\}'/u);
assert.match(releaseBundleBuilder, /name = '\$\{lifecycleControls\.name\}'/u);
assert.match(releaseBundleBuilder, /name = '\$\{recordedMedia\.name\}'/u);
assert.match(releaseBundleBuilder, /name = '\$\{immediateKeyAccess\.name\}'/u);
assert.match(releaseBundleBuilder, /without this release exact checksum/u);
assert.match(releaseBundleBuilder, /Unrecorded pre-existing .* objects cannot be adopted from existence probes/u);
assert.doesNotMatch(releaseBundleBuilder, /Repairing only the missing/u);
assert.doesNotMatch(releaseBundleBuilder, /readdir|glob|supabase\s+(?:db\s+push|migration\s+up)/u);

for (const [label, workflow] of [
  ['Pages release', pagesWorkflow],
  ['Worker release', workerWorkflow],
  ['staging release', stagingWorkflow],
]) {
  assert.match(workflow, /EXAMINATION_ROOM_RECOVERY_MODE = "supabase_storage"/u);
  assert.match(workflow, /20260827030000_examination_room_supabase_storage_recovery\.sql/u);
  assert.match(workflow, /public is false/u);
  assert.match(workflow, /application\/vnd\.duediligence\.examination-room-recovery\+json/u);
  assert.doesNotMatch(workflow, /wrangler@[^\s]+ r2 bucket|\/r2\/buckets\//u, label + ' must not require Cloudflare R2.');
}

console.log('Examination Room release workflow contract checks passed.');
