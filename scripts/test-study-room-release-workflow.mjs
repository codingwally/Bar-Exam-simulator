import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [workflow, pagesOnlyWorkflow, productionConfig, stagingConfig] =
  await Promise.all([
    readFile(
      path.join(root, ".github/workflows/release-study-room-admin-beta.yml"),
      "utf8",
    ),
    readFile(
      path.join(root, ".github/workflows/deploy-pages-only.yml"),
      "utf8",
    ),
    readFile(path.join(root, "worker/wrangler.toml"), "utf8"),
    readFile(path.join(root, "worker/wrangler.staging.toml"), "utf8"),
  ]);

assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /confirm_release:/u);
assert.match(workflow, /expected_current_pages_sha:/u);
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
assert.match(workflow, /deployments\?environment=github-pages&per_page=10/u);
assert.match(workflow, /deployment_state[\s\S]*== "success"/u);
assert.match(workflow, /Enforce the Study Room-only diff/u);
assert.match(workflow, /node --test worker\/\*\.test\.mjs/u);
assert.match(workflow, /node scripts\/test-pages-artifact\.mjs/u);
assert.match(
  workflow,
  /node worker\/study-room-staging-positive-smoke\.mjs --preflight/u,
);
assert.match(
  workflow,
  /node worker\/study-room-staging-positive-smoke\.mjs --self-test/u,
);
assert.match(
  workflow,
  /npm audit --prefix worker --audit-level=high/u,
);
assert.match(
  workflow,
  /npm audit --prefix worker --omit=dev --audit-level=high/u,
);

const stagingJob = workflow.indexOf("deploy_staging:");
const workerJob = workflow.indexOf("deploy_production_worker:");
const pagesJob = workflow.indexOf("deploy_production_pages:");
const stagingSmoke = workflow.indexOf(
  "Verify staging access boundary and shipped room assets",
  stagingJob,
);
const stagingPublishableResolver = workflow.indexOf(
  "Resolve the existing staging publishable configuration",
  stagingJob,
);
const stagingPositiveSmoke = workflow.indexOf(
  "Verify authenticated admins and two-participant media on staging",
  stagingJob,
);
const stagingMarker = workflow.indexOf(
  "Record the successful exact-SHA staging marker",
  stagingJob,
);
assert.ok(
  stagingJob >= 0 &&
    stagingPublishableResolver > stagingJob &&
    stagingSmoke > stagingJob &&
    stagingPositiveSmoke > stagingSmoke &&
    stagingMarker > stagingPositiveSmoke &&
    stagingMarker < workerJob,
  "The exact-SHA marker must be recorded only after every staging smoke check.",
);
assert.match(
  workflow.slice(stagingPublishableResolver, stagingPositiveSmoke),
  /STAGING_SUPABASE_PUBLISHABLE_KEY=\$staging_publishable_key["']? >> "\$GITHUB_ENV"/u,
);
assert.match(
  workflow.slice(stagingPositiveSmoke, stagingMarker),
  /node worker\/study-room-staging-positive-smoke\.mjs/u,
);
assert.match(
  workflow.slice(stagingPositiveSmoke, stagingMarker),
  /STAGING_SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.STAGING_SUPABASE_SERVICE_ROLE_KEY \}\}/u,
);
assert.match(
  workflow.slice(stagingPositiveSmoke, stagingMarker),
  /LIVEKIT_API_KEY:\s*\$\{\{ secrets\.LIVEKIT_API_KEY \}\}/u,
);
assert.match(workflow.slice(stagingJob, workerJob), /deployments: write/u);
assert.match(
  workflow.slice(stagingMarker, workerJob),
  /study-room-admin-beta-staging-approved/u,
);
assert.match(workflow.slice(stagingMarker, workerJob), /task: \$task/u);
assert.match(workflow.slice(stagingMarker, workerJob), /state: "success"/u);
assert.match(workflow, /RELEASE_TARGET: \$\{\{ inputs\.target \}\}/u);
assert.match(workflow, /sha=\$GITHUB_SHA&task=\$STAGING_MARKER_TASK/u);
assert.match(workflow, /marker_state[\s\S]*!= "success"/u);

for (const secret of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) {
  assert.match(workflow, new RegExp(`secrets\\.${secret}`, "u"));
  assert.match(
    productionConfig,
    new RegExp(`required = \\[.*"${secret}"`, "u"),
  );
  assert.match(stagingConfig, new RegExp(`required = \\[.*"${secret}"`, "u"));
}
assert.match(workflow, /--secrets-file "\$LIVEKIT_SECRET_FILE" --dry-run/u);
assert.match(workflow, /node worker\/livekit-credentials-smoke\.mjs/u);
assert.match(workflow, /test-study-room-deployment-smoke\.mjs/u);
assert.doesNotMatch(workflow, /wrangler@4\.114\.0 secret (?:put|bulk)/u);

assert.match(stagingConfig, /STUDY_ROOM_ENABLED = "true"/u);
assert.match(
  stagingConfig,
  /STUDY_ROOM_NAME = "dd-study-room-admin-beta-staging-v1"/u,
);
assert.match(stagingConfig, /compatibility_flags = \["nodejs_compat"\]/u);
assert.match(productionConfig, /STUDY_ROOM_ENABLED = "true"/u);
assert.match(
  productionConfig,
  /STUDY_ROOM_NAME = "dd-study-room-admin-beta-prod-v1"/u,
);
assert.match(productionConfig, /compatibility_flags = \["nodejs_compat"\]/u);

assert.ok(
  workerJob >= 0 && pagesJob > workerJob,
  "The Worker job must be declared before Pages.",
);
assert.match(workflow.slice(pagesJob), /needs: deploy_production_worker/u);
assert.match(
  workflow.slice(workerJob, pagesJob),
  /test-study-room-deployment-smoke\.mjs/u,
);
const workerBaselineRecheck = workflow.indexOf(
  "Recheck the live Pages baseline immediately before Worker mutation",
  workerJob,
);
const workerMutation = workflow.indexOf(
  "Deploy the application Worker",
  workerBaselineRecheck,
);
assert.ok(
  workerBaselineRecheck > workerJob &&
    workerMutation > workerBaselineRecheck &&
    workerMutation < pagesJob,
  "The current live Pages SHA must be rechecked immediately before the Worker mutation.",
);
assert.match(
  workflow.slice(workerBaselineRecheck, workerMutation),
  /deployed_sha[\s\S]*EXPECTED_CURRENT_PAGES_SHA/u,
);
assert.match(
  workflow.slice(pagesJob),
  /concurrency:\s*\n\s+group: github-pages\s*\n\s+cancel-in-progress: false/u,
);
assert.match(
  pagesOnlyWorkflow,
  /concurrency:\s*\n\s+group: ["']?github-pages["']?\s*\n\s+cancel-in-progress: false/u,
);
const pagesBaselineRecheck = workflow.indexOf(
  "Recheck the live Pages baseline inside the Pages lock",
  pagesJob,
);
const pagesMutation = workflow.indexOf(
  "Deploy Pages after the Worker gate",
  pagesBaselineRecheck,
);
assert.ok(
  pagesBaselineRecheck > pagesJob && pagesMutation > pagesBaselineRecheck,
  "Pages must recheck the current live SHA while holding the shared lock and before deployment.",
);
assert.match(
  workflow.slice(pagesBaselineRecheck, pagesMutation),
  /deployed_sha[\s\S]*EXPECTED_CURRENT_PAGES_SHA/u,
);
assert.match(workflow.slice(pagesJob), /Deploy Pages after the Worker gate/u);
assert.match(workflow.slice(pagesMutation), /latest_successful_pages_sha/u);
assert.match(
  workflow.slice(pagesMutation),
  /deployed_sha[\s\S]*== "\$GITHUB_SHA"/u,
);
assert.match(
  workflow.slice(pagesMutation),
  /exact_sha_is_latest[\s\S]*!= "true"/u,
);

console.log(
  "Study Room isolated staging and Worker-first production release workflow contracts passed.",
);
