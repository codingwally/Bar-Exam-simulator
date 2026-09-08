import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const release = read('.github/workflows/release-unlimited-feature-access.yml');
const mandatory = read('.github/workflows/validate-mandatory-early-access.yml');
const block = name => {
  const marker = '      - name: ' + name + '\n';
  assert.equal(release.split(marker).length, 2);
  return release.split(marker)[1].split('\n      - name: ')[0];
};
const evidence = '${{ runner.temp }}/staging-commercial-deployment-${{ github.run_id }}-${{ github.run_attempt }}.json';
test('exact staging deployment captures its own version and command-associated deployment', () => {
  const deploy = block('Deploy the exact Worker and client to staging');
  assert.ok(deploy.includes('id: staging_worker_deploy'));
  assert.ok(deploy.includes('wranglerVersion: "4.114.0"'));
  assert.ok(deploy.includes('command: deploy --config wrangler.staging.toml --message astra-commercial-stage:${{ github.run_id }}:${{ github.run_attempt }}:${{ github.sha }}'));
  assert.ok(deploy.includes('postCommands: node ../scripts/capture-staging-commercial-deployment.mjs'));
  assert.ok(deploy.includes('STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE: ' + evidence));
  assert.doesNotMatch(deploy, /WRANGLER_OUTPUT_FILE_(?:PATH|DIRECTORY)/u);
});
test('commercial child receives exactly the captured evidence and independent read authorization', () => {
  const child = block('Verify staging payment, provisional unlimited access, and cleanup');
  assert.ok(child.includes('STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE: ' + evidence));
  assert.ok(child.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}'));
  assert.ok(child.includes('STAGING_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}'));
  assert.ok(child.includes('run: node scripts/run-staging-e2e-suite.mjs complete-beta'));
  assert.doesNotMatch(child, /continue-on-error|always\(\)/u);
  const artifacts = block('Retain sanitized staging child diagnostics and cleanup results');
  assert.ok(artifacts.includes(evidence));
  assert.doesNotMatch(artifacts, /wranglerArtifacts|wrangler-output|\.wrangler\//u);
});
test('new infrastructure is explicitly reviewed and tested but never enters production SQL bundle', () => {
  const files = ['scripts/test-commercial-launch-staging.mjs', 'scripts/staging-commercial-fixtures.mjs', 'scripts/staging-commercial-suppression.mjs',
    'scripts/capture-staging-commercial-deployment.mjs', 'scripts/test-capture-staging-commercial-deployment.mjs',
    'scripts/test-staging-commercial-fixtures.mjs', 'scripts/test-staging-commercial-release-workflow.mjs',
    'docs/astra-staging-commercial-fixtures.md', 'worker/astra-staging-commercial-fixture-registration.test.mjs',
    'worker/commercial-access-gate.test.mjs',
    'supabase/migrations/20260908070656_astra_staging_commercial_fixture_registration.sql'];
  for (const file of files) { assert.ok(release.includes(file), file); assert.ok(mandatory.includes(file), file); }
  const tests = 'node --test scripts/test-capture-staging-commercial-deployment.mjs scripts/test-staging-commercial-fixtures.mjs scripts/test-staging-commercial-release-workflow.mjs';
  assert.ok(release.includes(tests)); assert.ok(mandatory.includes(tests));
  assert.doesNotMatch(read('scripts/astra-release-database-contract.mjs'), /astra_staging_commercial_fixture_registration/u);
  assert.equal((release.match(/node scripts\/verify-astra-forecast-staging\.mjs --execute-staging/gu) || []).length, 1);
  assert.doesNotMatch(release, /run-bar-forecast-live-journeys\.mjs/u);
});

test('current proof upload is an additional serial child with exact reviewed infrastructure', () => {
  const runner = read('scripts/run-staging-e2e-suite.mjs');
  const suite = runner.match(/'complete-beta': \[([\s\S]*?)\]/u)?.[1];
  assert.ok(suite);
  assert.deepEqual([...suite.matchAll(/'([^']+\.mjs)'/gu)].map(match => match[1]), [
    'scripts/test-complete-beta-staging.mjs',
    'scripts/test-commercial-launch-staging.mjs',
    'scripts/test-current-payment-proof-staging.mjs',
  ]);
  const files = ['scripts/staging-current-payment-proof.mjs',
    'scripts/test-current-payment-proof-staging.mjs', 'scripts/test-staging-current-payment-proof.mjs',
    'scripts/staging-current-payment-proof-cleanup.mjs', 'scripts/test-staging-current-payment-proof-cleanup.mjs'];
  for (const file of files) { assert.ok(release.includes(file), file); assert.ok(mandatory.includes(file), file); }
  const tests = 'node --test scripts/test-staging-current-payment-proof.mjs scripts/test-staging-current-payment-proof-cleanup.mjs';
  assert.ok(release.includes(tests)); assert.ok(mandatory.includes(tests));
  const artifacts = block('Retain sanitized staging child diagnostics and cleanup results');
  assert.ok(artifacts.includes('artifacts/staging-e2e/*.json'));
  assert.ok(artifacts.includes('artifacts/staging-e2e/*-cleanup-manifest.json.tmp'));
  assert.doesNotMatch(read('scripts/astra-release-database-contract.mjs'), /current.payment.proof/u);
});
