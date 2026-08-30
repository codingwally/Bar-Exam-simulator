import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const workflow = await readFile(new URL(
  '.github/workflows/release-admin-pulse-pilot.yml',
  root,
), 'utf8');
const sharedStaging = await readFile(new URL(
  '.github/workflows/staging-e2e-gate.yml',
  root,
), 'utf8');
const pagesRelease = await readFile(new URL(
  '.github/workflows/deploy-pages-only.yml',
  root,
), 'utf8');
const positiveSmoke = await readFile(new URL(
  'worker/admin-pulse-staging-positive-smoke.mjs',
  root,
), 'utf8');
const stagingConfig = await readFile(new URL('worker/wrangler.staging.toml', root), 'utf8');
const productionConfig = await readFile(new URL('worker/wrangler.toml', root), 'utf8');
const assetLinks = await readFile(new URL('.well-known/assetlinks.json', root), 'utf8');

assert.match(workflow, /name: Release Admin Pulse pilot/);
for (const input of [
  'target:',
  'confirm_release:',
  'expected_source_sha:',
  'expected_current_pages_sha:',
  'expected_current_staging_version:',
  'database_migration_preapplied:',
  'event_isolation_smoke_preapplied:',
  'approval_reference:',
]) {
  assert.ok(workflow.includes(input), `missing release input ${input}`);
}
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
assert.match(workflow, /test "\$GITHUB_SHA" = "\$EXPECTED_SOURCE_SHA"/);
assert.match(workflow, /admin-pulse-pilot-staging-approved/);
assert.match(workflow, /admin-pulse-pilot-staging-gate/);
assert.match(workflow, /marker_sha" = "\$GITHUB_SHA"/);
assert.match(workflow, /group: \$\{\{ inputs\.target == 'staging' && 'duediligence-staging-worker'/);
assert.match(sharedStaging, /concurrency:\s*\n\s*group: duediligence-staging-worker/);
assert.match(
  pagesRelease,
  /concurrency:\s*\n\s*group: "examination-room-production-cutover"/,
);
assert.match(workflow, /createECDH\('prime256v1'\)/);
assert.match(workflow, /VAPID key pair does not match/);
assert.match(workflow, /test "\$current" = "\$EXPECTED_CURRENT_STAGING_VERSION"/);
assert.match(workflow, /needs: deploy_production_worker[\s\S]*uses: actions\/deploy-pages@v4/);
assert.match(workflow, /name: Sign and publish the Android APK/);
assert.match(workflow, /ADMIN_PULSE_ANDROID_KEYSTORE_BASE64/);
assert.match(workflow, /apksigner" verify --verbose --print-certs/);
assert.match(workflow, /test "\$live" = "\$fingerprint"/);
assert.match(workflow, /gh release create "\$RELEASE_TAG"/);
assert.match(workflow, /ADMIN_PULSE_VAPID_PRIVATE_KEY: \$\{\{ secrets\.ADMIN_PULSE_VAPID_PRIVATE_KEY \}\}/);
assert.match(workflow, /ADMIN_PULSE_VAPID_PUBLIC_KEY: \$\{\{ vars\.ADMIN_PULSE_VAPID_PUBLIC_KEY \}\}/);
assert.match(workflow, /ADMIN_SIGN_IN_REQUIRED/);
assert.match(workflow, /node worker\/admin-pulse-staging-positive-smoke\.mjs/);
assert.match(positiveSmoke, /push_registration=true/);
assert.doesNotMatch(workflow, /\+\s+--(?:ks|repo|target|title|notes)\b/);

for (const config of [stagingConfig, productionConfig]) {
  assert.match(config, /ADMIN_PULSE_ENABLED = "true"/);
  assert.match(config, /ADMIN_PULSE_WEB_PUSH_ENABLED = "true"/);
  assert.match(config, /ADMIN_PULSE_VAPID_PUBLIC_KEY = "B[A-Za-z0-9_-]{86}"/);
  assert.doesNotMatch(config, /ADMIN_PULSE_VAPID_PRIVATE_KEY\s*=/);
}
assert.notEqual(
  stagingConfig.match(/ADMIN_PULSE_VAPID_PUBLIC_KEY = "([^"]+)"/)?.[1],
  productionConfig.match(/ADMIN_PULSE_VAPID_PUBLIC_KEY = "([^"]+)"/)?.[1],
);
assert.doesNotMatch(
  assetLinks,
  /REPLACE_WITH_THE_RELEASE_SIGNING_CERTIFICATE_SHA256_FINGERPRINT/,
);
assert.match(assetLinks, /(?:[A-F0-9]{2}:){31}[A-F0-9]{2}/);

console.log('Admin Pulse release workflow contracts passed.');
