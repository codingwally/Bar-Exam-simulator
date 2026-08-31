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
  }),
  Object.freeze({
    path: '.github/workflows/deploy-worker.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    serviceSecret: null,
    targetRef: 'hbllomlijfznnuudpdvr',
    environment: 'production',
    automaticContent: false,
    conditional: false,
    deployMarker: '      - name: Deploy Worker',
  }),
  Object.freeze({
    path: '.github/workflows/deploy.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    serviceSecret: null,
    targetRef: 'hbllomlijfznnuudpdvr',
    environment: 'production',
    automaticContent: false,
    conditional: false,
    deployMarker: '      - name: Deploy Worker before exposing the new Pages client',
  }),
]);

const builder = await read('scripts/build-admin-bar-forecast-release-bundle.mjs');
assert.deepEqual(
  [...builder.matchAll(/version: '(\d{14})'/gu)].map((match) => match[1]),
  ['20260831100000', '20260831101000', '20260831170000'],
);
assert.match(builder, /file: '20260831170000_admin_bar_forecast\.sql'/u);
assert.match(builder, /probe-admin-bar-forecast-release\.sql/u);
assert.ok(builder.includes('${probe}`'));
assert.doesNotMatch(builder, /readdir|glob|supabase\s+db\s+(?:push|reset)|supabase\s+migration\s+up/iu);

for (const contract of contracts) {
  const workflow = await read(contract.path);
  assert.match(
    workflow,
    /admin_bar_forecast_database_preapplied_sha256:\s*\n\s+description: "When DB URL is absent: SHA-256 of exact 20260831170000 bundle \+ rollback-only probe"\s*\n\s+required: false\s*\n\s+default: ""\s*\n\s+type: string/u,
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
  const forecastDatabaseGate = workflow.indexOf('      - name: Apply and post-apply probe the exact admin-only Bar Forecast migration');
  const forecastContentGate = workflow.indexOf('      - name: Import and verify the exact admin-only Bar Forecast content');
  const workerDeploy = workflow.indexOf(contract.deployMarker);
  assert.ok(septemberGate >= 0);
  assert.ok(forecastDatabaseGate > septemberGate, `${contract.path}: Forecast DB must follow pricing DB.`);
  assert.ok(forecastContentGate > forecastDatabaseGate, `${contract.path}: content must follow Forecast schema.`);
  assert.ok(workerDeploy > forecastContentGate, `${contract.path}: Worker must follow verified Forecast content.`);

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
    'node scripts/test-admin-bar-forecast-release-bundle.mjs',
    'node scripts/test-admin-bar-forecast-content-release.mjs',
    'node scripts/test-admin-bar-forecast-release-workflow.mjs',
  ]) {
    const position = workflow.indexOf(command);
    assert.ok(position >= 0, `${contract.path} must run ${command}.`);
    assert.ok(position < forecastDatabaseGate, `${contract.path} must test before applying Forecast schema.`);
  }
}

const combined = await read('.github/workflows/deploy.yml');
assert.match(combined, /\n  deploy_pages:\s*\n\s+needs: deploy_worker/u);
console.log(JSON.stringify({
  ok: true,
  workflows: contracts.map(({ path: workflowPath }) => workflowPath),
  releaseOrder: 'September pricing -> Forecast schema/probe -> Forecast import/checksum -> Worker -> Pages',
  fallback: 'exact-database-bundle-and-content-manifest-hashes',
}));
