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

for (const required of [
  'product_sha:',
  'validation_run_id:',
  'expected_current_pages_sha:',
  'forecast_content_verified_sha256:',
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
const worker = workflow.indexOf('\n  deploy_production_worker:');
const pages = workflow.indexOf('\n  deploy_production_pages:');
const verify = workflow.indexOf('\n  verify_production:');
assert.ok(staging > 0 && worker > staging && pages > worker && verify > pages);
assert.match(workflow.slice(worker, pages), /needs: deploy_staging/u);
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

for (const validationContract of [
  "- '.github/workflows/release-unlimited-feature-access.yml'",
  "- 'scripts/test-unlimited-feature-access-live.mjs'",
  "- 'scripts/test-unlimited-feature-access.mjs'",
  "- 'scripts/test-unlimited-feature-access-release-workflow.mjs'",
  "- 'scripts/verify-unlimited-feature-access-live.mjs'",
  'node --test scripts/test-unlimited-feature-access-live.mjs',
  'node scripts/test-unlimited-feature-access.mjs',
  'node scripts/test-unlimited-feature-access-release-workflow.mjs',
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
