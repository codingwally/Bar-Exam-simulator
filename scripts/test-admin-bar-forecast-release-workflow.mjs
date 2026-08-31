import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const contracts = Object.freeze([
  Object.freeze({
    path: '.github/workflows/staging-e2e-gate.yml',
    databaseSecret: 'EXAMINATION_ROOM_STAGING_DATABASE_URL',
    serviceSecret: 'STAGING_SUPABASE_SERVICE_ROLE_KEY',
    targetRef: 'hlzqmreeoghbldnhlybr',
    environment: 'staging',
    automaticContent: true,
    conditional: true,
    deployMarker: '      - name: Deploy reviewed Worker and static artifact to staging',
    liveMarker: '      - name: Verify the live admin-only Forecast boundary',
    workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
    allowedOrigin: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
  }),
  Object.freeze({
    path: '.github/workflows/deploy-worker.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    serviceSecret: null,
    targetRef: 'hbllomlijfznnuudpdvr',
    environment: 'production',
    automaticContent: false,
    conditional: false,
    deployMarker: '      - name: Deploy provider-neutral public API alias',
    liveMarker: '      - name: Verify the live admin-only Forecast boundary',
    workerUrl: 'https://duediligence-api.wallyesteban1993.workers.dev',
    allowedOrigin: 'https://duediligence.ph',
  }),
  Object.freeze({
    path: '.github/workflows/deploy.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    serviceSecret: null,
    targetRef: 'hbllomlijfznnuudpdvr',
    environment: 'production',
    automaticContent: false,
    conditional: false,
    deployMarker: '      - name: Deploy provider-neutral public API alias before exposing the new Pages client',
    liveMarker: '      - name: Verify the live admin-only Forecast boundary before Pages',
    workerUrl: 'https://duediligence-api.wallyesteban1993.workers.dev',
    allowedOrigin: 'https://duediligence.ph',
  }),
]);

const builder = await read('scripts/build-admin-bar-forecast-release-bundle.mjs');
assert.deepEqual(
  [...builder.matchAll(/version: '(\d{14})'/gu)].map((match) => match[1]),
  ['20260831100000', '20260831101000', '20260831170000', '20260901010837', '20260901014500'],
);
assert.match(builder, /file: '20260831170000_admin_bar_forecast\.sql'/u);
assert.match(builder, /file: '20260901010837_admin_bar_forecast_consent_version\.sql'/u);
assert.match(builder, /file: '20260901014500_admin_bar_forecast_runtime_integrity\.sql'/u);
assert.match(builder, /probe-admin-bar-forecast-release\.sql/u);
assert.ok(builder.includes('${probe}`'));
assert.doesNotMatch(builder, /readdir|glob|supabase\s+db\s+(?:push|reset)|supabase\s+migration\s+up/iu);

for (const contract of contracts) {
  const workflow = await read(contract.path);
  assert.match(
    workflow,
    /admin_bar_forecast_database_preapplied_sha256:\s*\n\s+description: "When DB URL is absent: SHA-256 of exact 20260831170000\/20260901010837\/20260901014500 bundle \+ rollback-only probe"\s*\n\s+required: false\s*\n\s+default: ""\s*\n\s+type: string/u,
  );
  assert.match(
    workflow,
    /admin_bar_forecast_content_preapplied_sha256:\s*\n\s+description: "When content credentials are absent: exact reviewed Forecast content-manifest SHA-256"\s*\n\s+required: false\s*\n\s+default: ""\s*\n\s+type: string/u,
  );
  assert.ok(workflow.includes(
    `ADMIN_BAR_FORECAST_DATABASE_URL: \${{ secrets.${contract.databaseSecret} }}`,
  ));
  if (contract.serviceSecret) {
    assert.ok(workflow.includes(
      `DD2026_SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.${contract.serviceSecret} }}`,
    ));
  }
  assert.ok(workflow.includes(
    `DD2026_SUPABASE_URL: https://${contract.targetRef}.supabase.co`,
  ));

  const septemberGate = workflow.indexOf('      - name: Apply and post-apply probe the exact September pricing migrations');
  const forecastDatabaseGate = workflow.indexOf('      - name: Apply and post-apply probe the exact admin-only Bar Forecast migrations');
  const forecastContentGate = workflow.indexOf('      - name: Import and verify the exact admin-only Bar Forecast content');
  const workerDeploy = workflow.indexOf(contract.deployMarker);
  const liveBoundary = workflow.indexOf(contract.liveMarker);
  assert.ok(septemberGate >= 0);
  assert.ok(forecastDatabaseGate > septemberGate, `${contract.path}: Forecast DB must follow pricing DB.`);
  assert.ok(forecastContentGate > forecastDatabaseGate, `${contract.path}: content must follow Forecast schema.`);
  assert.ok(workerDeploy > forecastContentGate, `${contract.path}: Worker must follow verified Forecast content.`);
  assert.ok(liveBoundary > workerDeploy, `${contract.path}: live Forecast denial must follow the deployed Worker endpoint.`);

  const liveBoundaryNext = workflow.indexOf('\n      - name:', liveBoundary + 8);
  const liveBoundaryStep = workflow.slice(liveBoundary, liveBoundaryNext);
  assert.ok(liveBoundaryStep.includes(`ADMIN_BAR_FORECAST_WORKER_URL: ${contract.workerUrl}`));
  assert.ok(liveBoundaryStep.includes(`ADMIN_BAR_FORECAST_ALLOWED_ORIGIN: ${contract.allowedOrigin}`));
  assert.match(liveBoundaryStep, /run: node scripts\/verify-admin-bar-forecast-deployment\.mjs/u);
  if (contract.conditional) {
    assert.match(liveBoundaryStep, /if: inputs\.deploy_greenfield == true/u);
  }

  const databaseNext = workflow.indexOf('\n      - name:', forecastDatabaseGate + 8);
  const databaseStep = workflow.slice(forecastDatabaseGate, databaseNext);
  assert.match(databaseStep, /node scripts\/build-admin-bar-forecast-release-bundle\.mjs/u);
  assert.match(databaseStep, /expected_attestation=/u);
  assert.match(databaseStep, /psql "\$ADMIN_BAR_FORECAST_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$admin_bar_forecast_release_bundle"/u);
  assert.match(databaseStep, /ADMIN_BAR_FORECAST_DATABASE_PREAPPLIED_SHA256" == "\$expected_attestation/u);
  assert.doesNotMatch(databaseStep, /PREAPPLIED[^\n]*== "true"/u);

  const contentNext = workflow.indexOf('\n      - name:', forecastContentGate + 8);
  const contentStep = workflow.slice(forecastContentGate, contentNext);
  assert.match(contentStep, /node scripts\/verify-admin-bar-forecast-content\.mjs --print-attestation/u);
  assert.match(
    contentStep,
    new RegExp(`node scripts/import-duediligence-2026-content\\.mjs --apply --environment ${contract.environment}`, 'u'),
  );
  assert.match(contentStep, /--content-type bar_forecast_question/u);
  assert.match(
    contentStep,
    new RegExp(`node scripts/verify-admin-bar-forecast-content\\.mjs --verify --environment ${contract.environment}`, 'u'),
  );
  if (contract.environment === 'production') {
    assert.ok((contentStep.match(new RegExp(`--confirm-production ${contract.targetRef}`, 'gu')) || []).length >= 2);
  }
  if (contract.automaticContent) {
    assert.match(contentStep, /ADMIN_BAR_FORECAST_CONTENT_PREAPPLIED_SHA256" == "\$expected_content_attestation/u);
    assert.match(contentStep, /trap 'rm -f -- "\$forecast_import_report" "\$forecast_verify_report"' EXIT/u);
    assert.match(contentStep, /imported\.contentType !== 'bar_forecast_question'/u);
    assert.match(contentStep, /imported\.total !== 120/u);
  } else {
    assert.match(contentStep, /ADMIN_BAR_FORECAST_CONTENT_PREAPPLIED_SHA256" != "\$expected_content_attestation/u);
    assert.match(contentStep, /No production service-role credential is exposed to GitHub Actions/u);
    assert.doesNotMatch(contentStep, /DD2026_SUPABASE_SERVICE_ROLE_KEY/u);
  }
  assert.doesNotMatch(contentStep, /PREAPPLIED[^\n]*== "true"/u);
  assert.doesNotMatch(contentStep, /Study Room|subscription|pricing/iu);
  if (contract.conditional) {
    assert.match(databaseStep, /if: inputs\.deploy_greenfield == true/u);
    assert.match(contentStep, /if: inputs\.deploy_greenfield == true/u);
  }

  for (const command of [
    'node scripts/test-bar-forecast-frontend.mjs',
    'node scripts/test-bar-forecast-boundary.mjs',
    'node scripts/test-bar-forecast-preview-isolation.mjs',
    'node scripts/test-bar-forecast-live-journeys.mjs',
    'node scripts/test-bar-forecast-live-evidence.mjs',
    'node scripts/test-admin-bar-forecast-release-bundle.mjs',
    'node scripts/test-admin-bar-forecast-content-release.mjs',
    'node --test scripts/test-admin-bar-forecast-deployment-smoke.mjs',
    'node scripts/test-admin-bar-forecast-release-workflow.mjs',
  ]) {
    const position = workflow.indexOf(command);
    assert.ok(position >= 0, `${contract.path} must run ${command}.`);
    assert.ok(position < forecastDatabaseGate, `${contract.path} must test before applying Forecast schema.`);
  }
}

const combined = await read('.github/workflows/deploy.yml');
const workerOnly = await read('.github/workflows/deploy-worker.yml');
const staging = await read('.github/workflows/staging-e2e-gate.yml');

assert.match(staging, /refs\/heads\/feature\/bar-forecast-examplify-parity-20260901/u);
assert.match(staging, /name: Run 30 live Forecast examiners in 15 two-browser batches/u);
assert.match(staging, /BAR_FORECAST_E2E_CONFIRM: staging:hlzqmreeoghbldnhlybr:30/u);
assert.match(staging, /BAR_FORECAST_E2E_RELEASE_SHA: \$\{\{ github\.sha \}\}/u);
assert.match(staging, /BAR_FORECAST_E2E_GITHUB_RUN_ID: \$\{\{ github\.run_id \}\}/u);
assert.match(staging, /BAR_FORECAST_E2E_BATCH_INTERVAL_MS: '180000'/u);
assert.match(staging, /timeout-minutes: 90/u);
assert.match(staging, /run-bar-forecast-live-journeys\.mjs --environment staging/u);
assert.match(staging, /artifacts\/staging-e2e\/bar-forecast-live-30\.json/u);
assert.match(staging, /node scripts\/verify-bar-forecast-live-evidence\.mjs/u);

for (const productionWorkflow of [combined, workerOnly]) {
  assert.match(
    productionWorkflow,
    /staging_run_id:\s*\n\s+description: "Successful Trusted staging E2E run for this exact main SHA, including 30 live Forecast journeys"\s*\n\s+required: true\s*\n\s+type: string/u,
  );
  assert.match(productionWorkflow, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/u);
  assert.match(productionWorkflow, /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$STAGING_RUN_ID/u);
  assert.match(productionWorkflow, /test "\$\(jq -r '\.head_sha' <<<"\$staging_run"\)" = "\$GITHUB_SHA"/u);
  assert.match(productionWorkflow, /uses: actions\/download-artifact@v4/u);
  assert.match(productionWorkflow, /run-id: \$\{\{ inputs\.staging_run_id \}\}/u);
  assert.match(productionWorkflow, /name: staging-e2e-sanitized-\$\{\{ inputs\.staging_run_id \}\}/u);
  assert.match(productionWorkflow, /BAR_FORECAST_EVIDENCE_FILE: artifacts\/release-staging-evidence\/bar-forecast-live-30\.json/u);
  assert.match(productionWorkflow, /run: node scripts\/verify-bar-forecast-live-evidence\.mjs/u);
}

assert.match(combined, /\n  deploy_pages:\s*\n\s+needs: deploy_worker/u);
assert.match(combined, /\n  verify_production_pages:\s*\n\s+name: Verify the exact Pages SHA and approved pricing client\s*\n\s+needs: deploy_pages/u);
const pagesDeploy = combined.indexOf('  deploy_pages:');
const pagesVerification = combined.indexOf('  verify_production_pages:');
assert.ok(pagesVerification > pagesDeploy, 'Production Pages verification must follow the Pages deployment.');
const pagesVerificationBlock = combined.slice(pagesVerification);
assert.match(pagesVerificationBlock, /deployments: read/u);
assert.match(pagesVerificationBlock, /latest_authoritative_pages_deployment/u);
assert.match(pagesVerificationBlock, /deployment_state" == "success" && "\$deployed_sha" == "\$GITHUB_SHA/u);
assert.match(pagesVerificationBlock, /postflight_deployment_record="\$\(latest_authoritative_pages_deployment\)"/u);
assert.match(pagesVerificationBlock, /postflight_deployment_state" == "success" && "\$postflight_deployed_sha" == "\$GITHUB_SHA/u);
assert.match(pagesVerificationBlock, /\.well-known\/duediligence-release\.txt\?release=\$GITHUB_SHA/u);
assert.match(pagesVerificationBlock, /cmp -s "\$expected_release_file" "\$served_release_file"/u);
for (const asset of [
  'index.html',
  'service-worker.js',
  'assets/feature-loader.js',
  'assets/phase2.css',
  'assets/phase2-experience.js',
  'assets/pricing-renderer.css',
  'assets/pricing-renderer.js',
  'assets/pricing-checkout-safety.js',
  'assets/payments/bpi-instapay-199-qr.png',
  'assets/payments/bpi-mark.png',
  'assets/bar-forecast.css',
  'assets/bar-forecast.js',
  'assets/bar-forecast/forecast-workspace-preview.webp',
]) {
  assert.ok(pagesVerificationBlock.includes(asset), `Production Pages verification must byte-check ${asset}.`);
}
console.log(JSON.stringify({
  ok: true,
  workflows: contracts.map(({ path: workflowPath }) => workflowPath),
  releaseOrder: 'exact-SHA staging + 30 live journeys -> Forecast schema/probe -> Forecast import/checksum -> Worker -> live denial -> Pages -> exact served SHA and bytes',
  fallback: 'exact-database-bundle-and-content-manifest-hashes',
}));
