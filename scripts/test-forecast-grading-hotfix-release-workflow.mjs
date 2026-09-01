import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/release-forecast-grading-hotfix.yml', import.meta.url),
  'utf8',
);

for (const required of [
  'test "$PRODUCT_SHA" = "3cc8ba8b81671bef90dbea07cd12823d160a294a"',
  'test "$VALIDATION_RUN_ID" = "33482650114"',
  'test "$validated_head" = "845b74b771906beb1a4407bbfc2f4922310e773a"',
  'worker/bar-forecast-provider-policy.test.mjs',
  'worker/bar-forecast-routes.mjs',
  'worker/bar-forecast-routes.test.mjs',
  'worker/index.mjs',
  'node --test worker/*.test.mjs',
  "['GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']",
  "['GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']",
  'command: deploy --config wrangler.staging.toml',
  'command: deploy --config wrangler.public-api.toml',
  'needs: deploy_staging',
]) {
  assert.ok(workflow.includes(required), `Missing hotfix release contract: ${required}`);
}

assert.equal(
  (workflow.match(/node scripts\/verify-admin-bar-forecast-deployment\.mjs/gu) || []).length,
  4,
  'Staging and production must each run the Forecast boundary twice.',
);
assert.ok(
  workflow.indexOf('name: Deploy exact hotfix to staging')
    < workflow.indexOf('name: Deploy exact hotfix Worker before public verification'),
  'The staging Worker must deploy before the production Worker.',
);
assert.doesNotMatch(workflow, /deploy-pages|pages-dist|github-pages/iu);

console.log('FORECAST_GRADING_HOTFIX_RELEASE_WORKFLOW_TEST_PASSED');
