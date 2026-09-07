import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/release-unlimited-feature-access.yml', import.meta.url),
  'utf8',
);
const validation = await readFile(
  new URL('../.github/workflows/validate-mandatory-early-access.yml', import.meta.url),
  'utf8',
);
const liveVerifier = await readFile(
  new URL('./verify-unlimited-feature-access-live.mjs', import.meta.url),
  'utf8',
);
const databaseContract = await readFile(new URL('./astra-release-database-contract.mjs', import.meta.url), 'utf8');
const expectedMigrations = [
  '20260907060650_astra_forecast_attempts.sql',
  '20260907064532_astra_forecast_result_exports.sql',
  '20260907071547_astra_payment_term_repair_journal.sql',
  '20260907120000_astra_payment_activation_terms.sql',
  '20260907120100_astra_payment_proof_evidence.sql',
  '20260907120200_astra_payment_invalidation.sql',
  '20260907130000_astra_simulator_access.sql',
  '20260907133129_astra_149_binding_compatibility.sql',
  '20260907172508_astra_forecast_summary_email.sql',
  '20260907173112_astra_browser_pdf_prepared_note.sql',
];
const actualMigrations = [...databaseContract.match(/ASTRA_MIGRATIONS = Object\.freeze\(\[([\s\S]*?)\]\)/u)[1]
  .matchAll(/'([^']+\.sql)'/gu)].map((match) => match[1]);
assert.deepEqual(actualMigrations, expectedMigrations, 'Exactly the ten reviewed forward migrations must be attested.');
assert.deepEqual(actualMigrations, [...actualMigrations].sort());

const newReviewedPaths = [
  'browser/forecast-result-pdf-worker.mjs',
  'scripts/build-forecast-pdf-browser-worker.mjs',
  'scripts/build-pages-artifact.mjs',
  'scripts/test-pages-artifact.mjs',
  'scripts/test-forecast-browser-pdf.mjs',
  'worker/forecast-browser-pdf-prepared.test.mjs',
  'worker/forecast-result-layout-fixture.mjs',
  'worker/forecast-result-pdf.mjs',
  'worker/forecast-summary-email.test.mjs',
  'worker/fixtures/forecast-analytics-email-claim.sql',
  ...expectedMigrations.slice(-2).map((name) => `supabase/migrations/${name}`),
];
const approvedScope = workflow.slice(workflow.indexOf('          approved_scope='), workflow.indexOf('          actual_scope='));
for (const file of newReviewedPaths) {
  assert.ok(approvedScope.includes(`            ${file} \\`), `Exact release scope is missing ${file}`);
  assert.ok(validation.includes(`- '${file}'`), `Mandatory validation trigger is missing ${file}`);
}

for (const required of [
  'product_sha:',
  'validation_run_id:',
  'expected_current_pages_sha:',
  'forecast_content_verified_sha256:',
  'stage_only:',
  'astra_database_verified_sha256:',
  'production_database_verified:',
  'if: ${{ !inputs.stage_only }}',
  'test "$PRODUCTION_DATABASE_VERIFIED" = "true"',
  'node scripts/astra-release-database-contract.mjs --verify-attestation',
  'node scripts/test-astra-149-binding-compatibility.mjs',
  'node scripts/test-forecast-poll-rate-contract.mjs',
  'node scripts/test-worker-cpu-limit-contract.mjs',
  'worker/bar-forecast-rate-limit.test.mjs',
  'scripts/test-astra-149-binding-compatibility.mjs',
  'supabase/migrations/20260907133129_astra_149_binding_compatibility.sql',
  'node scripts/verify-astra-forecast-staging.mjs --execute-staging',
  'artifacts/staging-e2e/*.json',
  'artifacts/astra-forecast-staging/**/summary.json',
  'test "$GITHUB_REF" = "refs/heads/main"',
  'test "$PRODUCT_SHA" = "$GITHUB_SHA"',
  'test "$(jq -r \'\.event\' <<<"$validation_run")" = "pull_request"',
  'test "$(jq -r \'\.path\' <<<"$validation_run")" = ".github/workflows/validate-mandatory-early-access.yml"',
  'test "$(jq -r \'\.conclusion\' <<<"$validation_run")" = "success"',
  'test "$(git rev-parse "$validated_head^{tree}")" = "$(git rev-parse "$PRODUCT_SHA^{tree}")"',
  'git diff --quiet "$validated_head" "$PRODUCT_SHA" -- .',
  'gh api "repos/$GITHUB_REPOSITORY/commits/$validated_head/pulls"',
  'map(select(.base.ref == "main" and .head.sha == $sha and .head.repo.full_name == $repository))',
  'The release contains files outside the reviewed Forecast and Bar Simulation boundary',
  'This focused release may not delete files.',
  'Import and read back the exact Forecast content on staging',
  'node scripts/import-duediligence-2026-content.mjs --apply --environment staging --content-type bar_forecast_question',
  'node scripts/verify-admin-bar-forecast-content.mjs --verify --environment staging',
  'Verify staging payment, provisional unlimited access, and cleanup',
  'node scripts/run-staging-e2e-suite.mjs complete-beta',
  'Verify staging Bar Simulation access and cleanup',
  'node scripts/run-staging-e2e-suite.mjs examinations',
  'scripts/test-examinations-staging.mjs',
  'Require exact protected production Forecast import and read-back',
  'node scripts/import-duediligence-2026-content.mjs --apply --environment production --content-type bar_forecast_question --confirm-production hbllomlijfznnuudpdvr',
  'node scripts/verify-admin-bar-forecast-content.mjs --verify --environment production --confirm-production hbllomlijfznnuudpdvr',
  'Deploy Worker before exposing the matching Pages client',
  'Deploy provider-neutral public API before Pages',
  'Deploy Pages after the Worker and API gates',
  '.well-known/duediligence-release.txt?release=$GITHUB_SHA',
  'assets/bar-forecast.js',
  'assets/examinations.js',
  'assets/phase2-experience.js',
  'assets/phase4-experience.js',
  'supabase/migrations/20260902093000_fix_unlimited_forecast_entitlement_readonly.sql',
]) {
  assert.ok(workflow.includes(required), `Missing unlimited-feature release contract: ${required}`);
}

assert.doesNotMatch(workflow, /Run 30 live Forecast|30 live Forecast|run-bar-forecast-live-journeys/iu);
assert.equal(
  (workflow.match(/node scripts\/verify-unlimited-feature-access-live\.mjs/gu) || []).length,
  2,
  'The production postflight must run exactly two live access journeys.',
);
assert.equal(
  (workflow.match(/name: Run post-publish live access journey [12] of 2/gu) || []).length,
  2,
  'Both post-publish live journeys must be explicit and independently visible.',
);

const staging = workflow.indexOf('\n  deploy_staging:');
assert.match(validation, /uses: actions\/checkout@v4\s+with:\s+# Cached-client compatibility tests read the exact production source\.\s+fetch-depth: 0/);
assert.match(workflow.slice(0, staging), /uses: actions\/checkout@v4[\s\S]*?fetch-depth: 0/);
assert.ok(validation.includes('Verify credential-free Linux Forecast browser wiring'));
assert.ok(validation.includes('node scripts/verify-astra-forecast-staging.mjs --self-test-browser'));
for (const source of [validation, workflow]) {
  assert.equal((source.match(/node scripts\/test-forecast-browser-pdf\.mjs --browser\s*$/gmu) || []).length, 1,
    'Require the full credential-free real-browser parity gate exactly once, not browser-only or a skipped test.');
  const parity = source.indexOf('node scripts/test-forecast-browser-pdf.mjs --browser');
  const parityStep = source.slice(source.lastIndexOf('      - name:', parity), source.indexOf('\n      - name:', parity));
  assert.ok(parityStep.indexOf('npx --yes agent-browser@0.36.0 install --with-deps') < parityStep.indexOf('node scripts/test-forecast-browser-pdf.mjs --browser'));
  assert.doesNotMatch(parityStep, /secrets\.|SERVICE_ROLE_KEY|--execute-staging/u,
    'Local browser parity must not run with a fixture credential or a remote journey.');
  assert.doesNotMatch(parityStep, /continue-on-error|\|\| true|--browser-only/u);
}
assert.ok(workflow.indexOf('node scripts/test-forecast-browser-pdf.mjs --browser')
  < workflow.indexOf('Resolve approved staging browser configuration'));
for (const file of ['worker/forecast-summary-email.test.mjs', 'worker/forecast-browser-pdf-prepared.test.mjs']) {
  assert.match(validation, new RegExp(`node --test --test-concurrency=1 [^\\n]*${file.replaceAll('.', '\\.')}`, 'u'));
}
assert.match(workflow, /node --test --test-concurrency=1 worker\/\*\.test\.mjs/u,
  'Release authorization must also execute both new Worker SQL/security suites.');
assert.ok(workflow.indexOf('node scripts/verify-astra-forecast-staging.mjs --self-test-browser')
  < workflow.indexOf('node scripts/verify-astra-forecast-staging.mjs --execute-staging'));
const worker = workflow.indexOf('\n  deploy_production_worker:');
const pages = workflow.indexOf('\n  deploy_production_pages:');
const verify = workflow.indexOf('\n  verify_production:');
assert.ok(staging > 0 && worker > staging && pages > worker && verify > pages);
assert.match(workflow.slice(worker, pages), /needs: deploy_staging/u);
assert.ok(workflow.slice(staging, worker).includes('Require the exact applied and probed Astra staging database bundle'));
assert.ok(workflow.slice(worker, pages).indexOf('independently applied and probed production schema') < workflow.slice(worker, pages).indexOf('Deploy Worker before'));
assert.doesNotMatch(workflow, /(?:cat|printenv|echo).*STAGING_SUPABASE_SERVICE_ROLE_KEY/u);
assert.match(workflow.slice(pages, verify), /needs: deploy_production_worker/u);
assert.match(workflow.slice(verify), /needs: deploy_production_pages/u);

const pagesBaseline = workflow.indexOf('Recheck the old live Pages baseline inside the Pages lock');
const pagesDeploy = workflow.indexOf('Deploy Pages after the Worker and API gates');
assert.ok(pagesBaseline > pages && pagesDeploy > pagesBaseline);
assert.match(
  workflow.slice(pagesBaseline, pagesDeploy),
  /deployment_sha" == "\$GITHUB_SHA" && "\$state" != "success"/u,
  'The Pages baseline must skip this attempt\'s own queued or in-progress deployment record.',
);
assert.match(
  workflow.slice(pagesBaseline, pagesDeploy),
  /inactive\|failure\|error\) continue/u,
  'The Pages baseline must ignore inactive and unsuccessful deployment records.',
);

const exactPages = workflow.indexOf('Verify the exact Pages SHA and reviewed client bytes');
const firstJourney = workflow.indexOf('Run post-publish live access journey 1 of 2');
const secondJourney = workflow.indexOf('Run post-publish live access journey 2 of 2');
assert.ok(exactPages > verify && firstJourney > exactPages && secondJourney > firstJourney);
const liveBytes = workflow.slice(exactPages, firstJourney);
assert.ok(workflow.slice(verify, exactPages).includes('npm ci --prefix worker --ignore-scripts --no-audit --no-fund'));
assert.ok(workflow.slice(verify, exactPages).includes('node scripts/build-pages-artifact.mjs'));
for (const file of [
  'assets/forecast-result-pdf-worker.js',
  'assets/vendor/forecast-pdf/pdf-lib.LICENSE.txt',
  'assets/vendor/forecast-pdf/Noto-Sans.LICENSE.txt',
  'assets/vendor/forecast-pdf/fontkit.README.txt',
]) assert.ok(liveBytes.includes(`            ${file}\n`) || liveBytes.includes(`            ${file}\r\n`),
  `Live compiled PDF runtime or license is missing: ${file}`);
assert.ok(liveBytes.includes('sha256sum ".pages-dist/$relative_path"'),
  'Live runtime bytes must match the sanitized build output, including generated assets.');
assert.doesNotMatch(liveBytes, /sha256sum "\$relative_path"/u);

for (const validationContract of [
  "- 'worker/bar-forecast-rate-limit.test.mjs'",
  "- 'scripts/test-forecast-poll-rate-contract.mjs'",
  "- 'scripts/test-worker-cpu-limit-contract.mjs'",
  'node scripts/test-worker-cpu-limit-contract.mjs',
  'node scripts/test-forecast-poll-rate-contract.mjs',
  "- '.github/workflows/release-unlimited-feature-access.yml'",
  "- 'scripts/test-unlimited-feature-access-live.mjs'",
  "- 'scripts/test-unlimited-feature-access.mjs'",
  "- 'scripts/test-unlimited-feature-access-release-workflow.mjs'",
  "- 'scripts/verify-unlimited-feature-access-live.mjs'",
  'node --test scripts/test-unlimited-feature-access-live.mjs',
  'node scripts/test-unlimited-feature-access.mjs',
  'node scripts/test-unlimited-feature-access-release-workflow.mjs',
  "- 'scripts/test-astra-149-binding-compatibility.mjs'",
  "- 'supabase/migrations/20260907133129_astra_149_binding_compatibility.sql'",
  'node scripts/test-astra-149-binding-compatibility.mjs',
]) {
  assert.ok(validation.includes(validationContract), `Required validation wiring is missing: ${validationContract}`);
}

for (const liveContract of [
  '/.well-known/duediligence-release.txt?release=',
  '/plans',
  'A published payment method with a QR image is required.',
  'The published payment QR must be downloadable.',
  '/admin/dd2026/bar-forecast',
  '/examinations/query',
  "track: 'bar_feels'",
  'Forecast must reject a signed-out request.',
  'Bar Simulation must reject a signed-out request.',
]) {
  assert.ok(liveVerifier.includes(liveContract), `Live access verification is missing: ${liveContract}`);
}

console.log('UNLIMITED_FEATURE_ACCESS_RELEASE_WORKFLOW_TEST_PASSED');
