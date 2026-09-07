import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const contracts = [
  {
    path: '.github/workflows/staging-e2e-gate.yml',
    databaseSecret: 'EXAMINATION_ROOM_STAGING_DATABASE_URL',
    workerMarker: '      - name: Deploy reviewed Worker and static artifact to staging',
    staging: true,
  },
  {
    path: '.github/workflows/deploy-worker.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    workerMarker: '      - name: Deploy Worker',
    staging: false,
  },
  {
    path: '.github/workflows/deploy.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    workerMarker: '      - name: Deploy Worker before exposing the new Pages client',
    staging: false,
  },
];

for (const contract of contracts) {
  const workflow = await read(contract.path);
  assert.match(
    workflow,
    /admin_payment_invalidation_database_preapplied_sha256:\s*\n\s+description: "When DB URL is absent: SHA-256 of exact 20260901120000 Admin payment invalidation bundle \+ rollback-only probe"\s*\n\s+required: false\s*\n\s+default: ""\s*\n\s+type: string/u,
  );
  assert.ok(
    workflow.includes(`ADMIN_PAYMENT_INVALIDATION_DATABASE_URL: \${{ secrets.${contract.databaseSecret} }}`),
    `${contract.path} must use the protected database URL for its environment.`,
  );
  assert.match(
    workflow,
    /ADMIN_PAYMENT_INVALIDATION_DATABASE_PREAPPLIED_SHA256: \$\{\{ inputs\.admin_payment_invalidation_database_preapplied_sha256 \}\}/u,
  );

  const september = workflow.indexOf(
    '      - name: Apply and post-apply probe the exact September pricing migrations',
  );
  const invalidation = workflow.indexOf(
    '      - name: Apply and rollback-probe the exact Admin payment invalidation migration',
  );
  const forecast = workflow.indexOf(
    '      - name: Apply and probe the exact paid, Founding Beta, and admin Forecast migrations',
  );
  const worker = workflow.indexOf(contract.workerMarker);
  assert.ok(september >= 0 && invalidation > september, `${contract.path} lost release ordering.`);
  assert.ok(forecast > invalidation, `${contract.path} must probe invalidation before Forecast.`);
  assert.ok(worker > invalidation, `${contract.path} must migrate before Worker deployment.`);

  const nextStep = workflow.indexOf('\n      - name:', invalidation + 8);
  const gate = workflow.slice(invalidation, nextStep >= 0 ? nextStep : workflow.length);
  assert.match(gate, /build-admin-payment-invalidation-release-bundle\.mjs/u);
  assert.match(gate, /createHash\("sha256"\)/u);
  assert.match(gate, /psql "\$ADMIN_PAYMENT_INVALIDATION_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$payment_invalidation_bundle"/u);
  assert.match(gate, /ADMIN_PAYMENT_INVALIDATION_DATABASE_PREAPPLIED_SHA256" == "\$expected_attestation/u);
  assert.match(gate, /verify its embedded rollback-only probe/u);
  assert.match(gate, /exit 1/u);
  assert.doesNotMatch(gate, /PREAPPLIED[^\n]*== "true"/u);
  if (contract.staging) assert.match(gate, /if: inputs\.deploy_greenfield == true/u);

  for (const command of [
    'node scripts/test-admin-payment-invalidation.mjs',
    'node scripts/test-admin-payment-invalidation-release-bundle.mjs',
    'node scripts/test-admin-payment-invalidation-release-workflow.mjs',
  ]) {
    const position = workflow.indexOf(command);
    assert.ok(position >= 0 && position < invalidation, `${contract.path} must run ${command} first.`);
  }
}

const staging = await read('.github/workflows/staging-e2e-gate.yml');
assert.match(staging, /refs\/heads\/codex\/payment-proof-invalidation/u);
const production = await read('.github/workflows/deploy.yml');
assert.match(
  production,
  /require_step 'Apply and rollback-probe the exact Admin payment invalidation migration' success/u,
);

console.log(JSON.stringify({
  ok: true,
  workflows: contracts.map((contract) => contract.path),
  releaseOrder: 'September pricing -> payment invalidation -> Forecast -> Worker',
  preappliedMode: 'exact-bundle-hash-attestation',
}));
