import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const workflowContracts = Object.freeze([
  Object.freeze({
    path: '.github/workflows/staging-e2e-gate.yml',
    databaseSecret: 'EXAMINATION_ROOM_STAGING_DATABASE_URL',
    deployMarker: '      - name: Deploy reviewed Worker and static artifact to staging',
  }),
  Object.freeze({
    path: '.github/workflows/deploy-worker.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    deployMarker: '      - name: Deploy Worker',
  }),
  Object.freeze({
    path: '.github/workflows/deploy.yml',
    databaseSecret: 'EXAMINATION_ROOM_PRODUCTION_DATABASE_URL',
    deployMarker: '      - name: Deploy Worker before exposing the new Pages client',
  }),
]);

const builder = await read('scripts/build-september-pricing-release-bundle.mjs');
const versions = [...builder.matchAll(/version: '(\d{14})'/gu)].map((match) => match[1]);
const migrationFiles = [...builder.matchAll(/file: '(\d{14}_[^']+\.sql)'/gu)].map((match) => match[1]);
assert.deepEqual(versions, ['20260831100000', '20260831101000']);
assert.deepEqual(migrationFiles, [
  '20260831100000_september_pricing_cutover.sql',
  '20260831101000_proof_only_payment_evidence.sql',
]);
assert.match(builder, /probe-september-pricing-release\.sql/u);
assert.ok(builder.includes('${probe}`'), 'The generated release bundle must append the rollback-only probe.');
assert.match(builder, /migrations: prepared\.map/u);
assert.doesNotMatch(builder, /readdir|glob|supabase\s+db\s+(?:push|reset)|supabase\s+migration\s+up/iu);

for (const contract of workflowContracts) {
  const workflow = await read(contract.path);
  assert.match(
    workflow,
    /september_pricing_database_preapplied_sha256:\s*\n\s+description: "When DB URL is absent: SHA-256 of exact 20260831100000\/20260831101000 bundle \+ probe"\s*\n\s+required: false\s*\n\s+default: ""\s*\n\s+type: string/u,
    `${contract.path} must expose an exact-hash string attestation, not a stale boolean bypass.`,
  );
  assert.ok(
    workflow.includes(`SEPTEMBER_PRICING_DATABASE_URL: \${{ secrets.${contract.databaseSecret} }}`),
    `${contract.path} must use the correct protected database URL.`,
  );
  assert.match(
    workflow,
    /SEPTEMBER_PRICING_DATABASE_PREAPPLIED_SHA256: \$\{\{ inputs\.september_pricing_database_preapplied_sha256 \}\}/u,
  );

  const oldPricingGate = workflow.indexOf('      - name: Require the exact live-probed Admin pricing database contract');
  const septemberGate = workflow.indexOf('      - name: Apply and post-apply probe the exact September pricing migrations');
  const workerDeploy = workflow.indexOf(contract.deployMarker);
  assert.ok(oldPricingGate >= 0, `${contract.path} lost the existing Admin pricing gate.`);
  assert.ok(septemberGate > oldPricingGate, `${contract.path} must preserve the existing gate before the September gate.`);
  assert.ok(workerDeploy > septemberGate, `${contract.path} must finish the September gate before Worker deployment.`);

  const nextStep = workflow.indexOf('\n      - name:', septemberGate + 8);
  const gate = workflow.slice(septemberGate, nextStep >= 0 ? nextStep : workflow.length);
  assert.match(gate, /node scripts\/build-september-pricing-release-bundle\.mjs/u);
  assert.match(gate, /createHash\("sha256"\)\.update\(readFileSync\(process\.argv\[1\]\)\)\.digest\("hex"\)/u);
  assert.match(gate, /"sha256:" \+ createHash/u);
  assert.match(gate, /test -n "\$expected_attestation"/u);
  assert.match(gate, /if \[\[ -n "\$SEPTEMBER_PRICING_DATABASE_URL" \]\]; then/u);
  assert.match(
    gate,
    /psql "\$SEPTEMBER_PRICING_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$september_pricing_release_bundle"/u,
  );
  assert.match(
    gate,
    /elif \[\[ "\$SEPTEMBER_PRICING_DATABASE_PREAPPLIED_SHA256" == "\$expected_attestation" \]\]; then/u,
  );
  assert.match(gate, /verify its embedded rollback-only probe/u);
  assert.match(gate, /exit 1/u);
  assert.doesNotMatch(gate, /PREAPPLIED[^\n]*== "true"/u);

  for (const testCommand of [
    'node scripts/test-september-pricing-sql-contract.mjs',
    'node scripts/test-september-pricing-release-bundle.mjs',
    'node scripts/test-september-pricing-release-workflow.mjs',
    'node scripts/test-syllabus-review-reveal-contract.mjs',
  ]) {
    const testPosition = workflow.indexOf(testCommand);
    assert.ok(testPosition >= 0, `${contract.path} must run ${testCommand}.`);
    assert.ok(testPosition < septemberGate, `${contract.path} must run ${testCommand} before the database gate.`);
  }
}

const staging = await read('.github/workflows/staging-e2e-gate.yml');
assert.match(staging, /refs\/heads\/feature\/pricing-september-cutover-20260831/u);
const combinedRelease = await read('.github/workflows/deploy.yml');
assert.match(combinedRelease, /\n  deploy_pages:\s*\n\s+needs: deploy_worker/u);

const commandList = (workflow, startMarker, endMarker) => {
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Release command block ${startMarker} is missing or unbounded.`);
  return workflow.slice(start, end)
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('node '));
};
const stagingCommands = new Set(commandList(
  staging,
  '      - name: Verify greenfield release contracts before staging deploy',
  '      - name: Apply and probe only the ordered Examination Room migrations',
));
const productionCommands = commandList(
  combinedRelease,
  '      - name: Verify authentication, maintenance, admission, and public-shell contracts',
  '      - name: Apply and probe only the ordered Examination Room migrations',
);
for (const command of productionCommands) {
  assert.ok(stagingCommands.has(command), `Protected staging must run the production predeploy command: ${command}`);
}

console.log(JSON.stringify({
  ok: true,
  workflows: workflowContracts.map(({ path: workflowPath }) => workflowPath),
  releaseOrder: 'existing-gates -> September bundle/probe -> Worker -> Pages',
  preappliedMode: 'exact-bundle-hash-attestation',
}));
