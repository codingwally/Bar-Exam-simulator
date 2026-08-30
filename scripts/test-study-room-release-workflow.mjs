import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [workflow, pagesOnlyWorkflow, productionConfig, stagingConfig, home] =
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
    readFile(path.join(root, "index.html"), "utf8"),
  ]);

assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /confirm_release:/u);
assert.match(workflow, /expected_current_pages_sha:/u);
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
assert.match(workflow, /deployments\?environment=github-pages&per_page=10/u);
assert.match(workflow, /deployment_state[\s\S]*== "success"/u);
assert.match(workflow, /Enforce the Study Room-only diff/u);
const allowlistSource = workflow.match(/allowed='([^']+)'/u)?.[1];
assert.ok(allowlistSource, "The Study Room release allowlist must be present.");
const releaseAllowlist = new RegExp(allowlistSource, "u");
for (const expectedReleaseFile of [
  ".github/workflows/deploy-pages-only.yml",
  ".github/workflows/release-study-room-admin-beta.yml",
  "assets/icons/community/image.svg",
  "assets/icons/navigation/hand.svg",
  "assets/icons/navigation/mic.svg",
  "assets/icons/navigation/monitor-up.svg",
  "assets/icons/navigation/pin.svg",
  "assets/icons/navigation/settings.svg",
  "assets/study-room-backgrounds.js",
  "assets/study-room-live.css",
  "assets/study-room-live.js",
  "assets/study-room-preview.css",
  "assets/study-room-preview.js",
  "assets/study-room/virtual-background-due-diligence-branded.webp",
  "assets/vendor/mediapipe/LICENSE.txt",
  "assets/vendor/mediapipe/PROVENANCE.txt",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "index.html",
  "scripts/build-pages-artifact.mjs",
  "scripts/test-pages-artifact.mjs",
  "scripts/test-study-room-backgrounds.mjs",
  "scripts/test-study-room-deployment-smoke.mjs",
  "scripts/test-study-room-hotfix-behavior.mjs",
  "scripts/test-study-room-live.mjs",
  "scripts/test-study-room-preview.mjs",
  "scripts/test-study-room-release-workflow.mjs",
  "study-room/index.html",
  "worker/index.mjs",
  "worker/livekit-credentials-smoke.mjs",
  "worker/livekit-credentials-smoke.test.mjs",
  "worker/package-lock.json",
  "worker/package.json",
  "worker/study-room-core.mjs",
  "worker/study-room-routes.mjs",
  "worker/study-room-staging-positive-smoke.mjs",
  "worker/study-room.test.mjs",
  "worker/wrangler.staging.toml",
  "worker/wrangler.toml",
]) {
  assert.match(
    expectedReleaseFile,
    releaseAllowlist,
    `${expectedReleaseFile} must pass the workflow's Study Room-only allowlist.`,
  );
}
assert.doesNotMatch(
  "assets/study-room/virtual-background-due-diligence-office.webp",
  releaseAllowlist,
  "The unused alternate background must stay outside the isolated release.",
);
assert.match(workflow, /node --test worker\/\*\.test\.mjs/u);
assert.match(workflow, /node scripts\/test-pages-artifact\.mjs/u);
assert.match(workflow, /node scripts\/test-study-room-backgrounds\.mjs/u);
assert.match(workflow, /node scripts\/test-study-room-hotfix-behavior\.mjs/u);
assert.match(workflow, /node --check assets\/study-room-backgrounds\.js/u);
assert.match(
  workflow,
  /node worker\/study-room-staging-positive-smoke\.mjs --preflight/u,
);
assert.match(
  workflow,
  /node worker\/study-room-staging-positive-smoke\.mjs --self-test/u,
);
assert.match(workflow, /npm audit --prefix worker --audit-level=high/u);
assert.match(
  workflow,
  /npm audit --prefix worker --omit=dev --audit-level=high/u,
);

const pagesOnlyAllowlistSource = pagesOnlyWorkflow.match(/allowed='([^']+)'/u)?.[1];
assert.ok(
  pagesOnlyAllowlistSource,
  "The Pages-only release allowlist must be present.",
);
const pagesOnlyAllowlist = new RegExp(pagesOnlyAllowlistSource, "u");
for (const expectedPagesFile of [
  ".github/workflows/deploy-pages-only.yml",
  "assets/icons/community/image.svg",
  "assets/icons/navigation/hand.svg",
  "assets/icons/navigation/mic.svg",
  "assets/icons/navigation/monitor-up.svg",
  "assets/icons/navigation/pin.svg",
  "assets/icons/navigation/settings.svg",
  "assets/study-room-backgrounds.js",
  "assets/study-room-live.css",
  "assets/study-room-live.js",
  "assets/study-room/virtual-background-due-diligence-branded.webp",
  "assets/vendor/mediapipe/LICENSE.txt",
  "assets/vendor/mediapipe/PROVENANCE.txt",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "scripts/build-pages-artifact.mjs",
  "scripts/test-pages-artifact.mjs",
  "scripts/test-study-room-backgrounds.mjs",
  "scripts/test-study-room-live.mjs",
  "study-room/index.html",
]) {
  assert.match(
    expectedPagesFile,
    pagesOnlyAllowlist,
    `${expectedPagesFile} must pass the Pages-only allowlist.`,
  );
}
assert.doesNotMatch(
  "assets/study-room/virtual-background-due-diligence-office.webp",
  pagesOnlyAllowlist,
  "The unused alternate background must stay outside Pages-only releases.",
);
assert.match(
  pagesOnlyWorkflow,
  /npm ci --prefix worker --ignore-scripts --no-audit --no-fund/u,
);
assert.match(
  pagesOnlyWorkflow,
  /node scripts\/test-study-room-backgrounds\.mjs/u,
);

const stagingJob = workflow.indexOf("deploy_staging:");
const workerJob = workflow.indexOf("deploy_production_worker:");
const pagesJob = workflow.indexOf("deploy_production_pages:");
const pagesVerificationJob = workflow.indexOf("verify_production_pages:");
const stagingSmoke = workflow.indexOf(
  "Verify staging access boundary and shipped room assets",
  stagingJob,
);
const stagingPublishableResolver = workflow.indexOf(
  "Resolve the existing staging publishable configuration",
  stagingJob,
);
const stagingPositiveSmoke = workflow.indexOf(
  "Verify subscriber, admin, chat, and two-participant media on staging",
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
const stagingAssetChecks = workflow.slice(stagingSmoke, stagingPositiveSmoke);
for (const requiredStagingMarker of [
  "study-room-launch-20260830-1",
  "workerRequest('/study-room/rooms'",
  "workerRequest('/study-room/join'",
  "registerTextStreamHandler",
  "setScreenShareEnabled",
  "DueDiligenceStudyRoomMandatoryBackground",
  "due-diligence-mandatory-virtual-background-no-raw-first-frame",
  "assets/icons/navigation/hand.svg",
  "assets/icons/navigation/mic.svg",
  "assets/icons/navigation/monitor-up.svg",
  "assets/icons/navigation/pin.svg",
  "assets/icons/navigation/settings.svg",
  "assets/study-room/virtual-background-due-diligence-branded.webp",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "assets/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
]) {
  assert.ok(
    stagingAssetChecks.includes(requiredStagingMarker),
    `Staging must verify ${requiredStagingMarker} before recording success.`,
  );
}
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
  workerJob >= 0 && pagesJob > workerJob && pagesVerificationJob > pagesJob,
  "The Worker, Pages deployment, and post-deploy verification jobs must stay ordered.",
);
assert.match(workflow.slice(pagesJob), /needs: deploy_production_worker/u);
assert.match(
  workflow.slice(pagesVerificationJob),
  /needs: deploy_production_pages/u,
);
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
  /concurrency:\s*\n\s+group: ["']?examination-room-production-cutover["']?\s*\n\s+cancel-in-progress: false/u,
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
assert.ok(
  pagesMutation < pagesVerificationJob,
  "The Pages deployment job must finish before exact-SHA verification starts.",
);
assert.doesNotMatch(
  workflow.slice(pagesMutation, pagesVerificationJob),
  /latest_successful_pages_sha/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /latest_successful_pages_sha/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /deployed_sha[\s\S]*== "\$GITHUB_SHA"/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /exact_sha_is_latest[\s\S]*!= "true"/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /study-room-launch-20260830-1/u,
);
assert.match(
  home,
  /study-room-launch-20260830-1/u,
  "Production verification must use a marker that exists in the shipped Home document.",
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /study-room-launch-20260830-1/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /study-room-optional-background-20260829-1/u,
);
for (const requiredProductionAsset of [
  "workerRequest('/study-room/rooms'",
  "workerRequest('/study-room/join'",
  "registerTextStreamHandler",
  "setScreenShareEnabled",
  "assets/icons/community/image.svg",
  "assets/icons/navigation/hand.svg",
  "assets/icons/navigation/mic.svg",
  "assets/icons/navigation/monitor-up.svg",
  "assets/icons/navigation/pin.svg",
  "assets/icons/navigation/settings.svg",
  "assets/study-room/virtual-background-due-diligence-branded.webp",
  "assets/vendor/livekit-track-processors.iife.js",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "assets/vendor/mediapipe/wasm/vision_wasm_internal.js",
  "assets/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "assets/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "assets/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "DueDiligenceStudyRoomMandatoryBackground",
  "due-diligence-mandatory-virtual-background-no-raw-first-frame",
]) {
  assert.ok(
    workflow.slice(pagesVerificationJob).includes(requiredProductionAsset),
    `Production Pages verification must check ${requiredProductionAsset}.`,
  );
  assert.ok(
    pagesOnlyWorkflow.includes(requiredProductionAsset),
    `Pages-only production verification must check ${requiredProductionAsset}.`,
  );
}
assert.match(pagesOnlyWorkflow, /study-room-launch-20260830-1/u);
assert.match(
  pagesOnlyWorkflow,
  /study-room-optional-background-20260829-1/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /async function discoverDevices\(\)/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /global\.location\.assign\(roomUrl\.href\)/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /bindDeviceChangeDetection\(\);/u,
);
assert.match(
  workflow.slice(pagesVerificationJob),
  /accessResolutionFailed = signedIn\(latestSession\) && !latestAccess/u,
);

console.log(
  "Study Room isolated staging and Worker-first production release workflow contracts passed.",
);
