import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [workflow, pagesOnlyWorkflow, productionConfig, stagingConfig, home, studyRoomPage, studyRoomClient] =
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
    readFile(path.join(root, "study-room/index.html"), "utf8"),
    readFile(path.join(root, "assets/study-room-live.js"), "utf8"),
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
const reviewedLiveSha = "9801ebbb4c972a782dd59a387bd973ae732ca1d5";
const reviewedBaselineSha = "24dfd65bbfdbbaf843a9e00d3be7e53b4bb20030";
const reviewedBaselineTree = "2f5c922c519b6223781a1e262e5999568f59576c";
const reviewedDelta = [
  "M\t.github/workflows/release-unlimited-feature-access.yml",
  "M\t.github/workflows/validate-mandatory-early-access.yml",
  "M\tscripts/astra-release-database-contract.mjs",
  "M\tscripts/test-astra-late-payment-ui.mjs",
  "A\tscripts/test-astra-payment-notification-postgres.mjs",
  "A\tscripts/test-astra-payment-notification-sent-terminal.mjs",
  "M\tscripts/test-unlimited-feature-access-release-workflow.mjs",
  "A\tsupabase/migrations/20260908115426_astra_payment_notification_sent_terminal.sql",
].join("\n");
for (const entry of reviewedDelta.split("\n")) {
  assert.doesNotMatch(entry.slice(2), releaseAllowlist,
    "Reviewed baseline files must never become generally allowed candidate edits.");
}
for (const pin of [reviewedLiveSha, reviewedBaselineSha, reviewedBaselineTree]) {
  assert.ok(workflow.includes(`'${pin}'`), "The recognized baseline must have exact immutable pins.");
}
const scopeStep = workflow.replace(/\r\n/gu, "\n").split(
  "      - name: Enforce the Study Room-only diff\n",
)[1]?.split("      - name: Setup Node\n")[0];
const scopeScript = scopeStep?.split("        run: |\n")[1]
  ?.split("\n").map((line) => line.replace(/^          /u, "")).join("\n");
assert.ok(scopeScript, "Exercise the actual workflow scope script, not a copied policy model.");
// No Git writes, fixture creation or network: the real Bash gate receives only
// deterministic Git outputs. Unknown commands/arguments fail with a distinct code.
const mockGit = String.raw`
PATH=/usr/bin:/bin:$PATH
git() {
  case "$1" in
    cat-file) [[ "$*" == "cat-file -e $MOCK_BASELINE^{commit}" ]] || return 90
      [[ "$MOCK_MISSING_COMMIT" != true ]] ;;
    merge-base)
      if [[ "$*" == "merge-base --is-ancestor $MOCK_LIVE $MOCK_BASELINE" ]]; then
        [[ "$MOCK_BAD_LIVE_ANCESTRY" != true ]]
      elif [[ "$*" == "merge-base --is-ancestor $MOCK_BASELINE $GITHUB_SHA" ]]; then
        [[ "$MOCK_BAD_CANDIDATE_ANCESTRY" != true ]]
      else return 91; fi ;;
    rev-parse) [[ "$*" == "rev-parse $MOCK_BASELINE^{tree}" ]] || return 92
      printf '%s\n' "$MOCK_TREE" ;;
    diff)
      if [[ "$*" == "diff --no-renames --name-status $MOCK_LIVE $MOCK_BASELINE" ]]; then
        printf '%s\n' "$MOCK_BASELINE_DELTA"
      elif [[ "$*" == "diff --quiet $MOCK_LIVE $MOCK_BASELINE -- worker assets study-room index.html content" ]]; then
        [[ "$MOCK_RUNTIME_DRIFT" != true ]]
      elif [[ "$*" == "diff --name-only $MOCK_SCOPE_BASE $GITHUB_SHA" ]]; then
        printf '%s\n' "$MOCK_CANDIDATE_DELTA"
      elif [[ "$*" == "diff --diff-filter=D --name-only $MOCK_SCOPE_BASE $GITHUB_SHA" ]]; then
        printf '%s\n' "$MOCK_DELETED"
      else return 93; fi ;;
    *) return 94 ;;
  esac
}
`;
const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe")
  : "/bin/bash";
let scopeCases = 0;
function verifyScopeCase(overrides = {}, rejected = false) {
  const env = {
    ...process.env,
    EXPECTED_CURRENT_PAGES_SHA: reviewedLiveSha,
    GITHUB_SHA: "1".repeat(40),
    MOCK_LIVE: reviewedLiveSha,
    MOCK_BASELINE: reviewedBaselineSha,
    MOCK_SCOPE_BASE: reviewedBaselineSha,
    MOCK_TREE: reviewedBaselineTree,
    MOCK_BASELINE_DELTA: reviewedDelta,
    MOCK_CANDIDATE_DELTA: "worker/study-room-core.mjs\nassets/study-room-preview.js",
    MOCK_DELETED: "",
    MOCK_MISSING_COMMIT: "false",
    MOCK_BAD_LIVE_ANCESTRY: "false",
    MOCK_BAD_CANDIDATE_ANCESTRY: "false",
    MOCK_RUNTIME_DRIFT: "false",
    ...overrides,
  };
  const run = () => execFileSync(bash, ["--noprofile", "--norc", "-c", mockGit + scopeScript],
    { env, encoding: "utf8", stdio: "pipe", timeout: 10000 });
  if (rejected) assert.throws(run, (error) => error.status === 1);
  else run();
  scopeCases += 1;
}
verifyScopeCase();
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "scripts/test-study-room-always-open.mjs\nscripts/test-study-room-background-picker.mjs\nassets/study-room/virtual-background-due-diligence-polished-20260908.webp" });
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "assets/study-room/virtual-background-due-diligence-polished-20260909.webp" }, true);
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "supabase/migrations/20260908131116_astra_staging_study_room_fixture_registration.sql\nworker/astra-staging-study-room-fixture-registration.test.mjs" });
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql\nscripts/test-study-room-catalog-sql.mjs\nworker/study-room-catalog.test.mjs" });
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "supabase/migrations/20260908144815_astra_study_room_persisted_catalog.sql" }, true);
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "supabase/migrations/20260908144814_astra_study_room_catalog_reset.sql" }, true);
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "supabase/migrations/20260908070656_astra_staging_commercial_fixture_registration.sql" }, true);
verifyScopeCase({ MOCK_MISSING_COMMIT: "true" }, true);
verifyScopeCase({ MOCK_BAD_LIVE_ANCESTRY: "true" }, true);
verifyScopeCase({ MOCK_BAD_CANDIDATE_ANCESTRY: "true" }, true);
verifyScopeCase({ MOCK_TREE: "0".repeat(40) }, true);
verifyScopeCase({ MOCK_BASELINE_DELTA: reviewedDelta + "\nM\tworker/index.mjs" }, true);
verifyScopeCase({ MOCK_BASELINE_DELTA: reviewedDelta.replace("M\t", "D\t") }, true);
verifyScopeCase({ MOCK_BASELINE_DELTA: reviewedDelta.split("\n").slice(1).join("\n") }, true);
verifyScopeCase({ MOCK_RUNTIME_DRIFT: "true" }, true);
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "" }, true);
verifyScopeCase({ MOCK_CANDIDATE_DELTA: "worker/study-room-core.mjs\nworker/commercial-entry.mjs" }, true);
for (const entry of reviewedDelta.split("\n")) {
  verifyScopeCase({ MOCK_CANDIDATE_DELTA: entry.slice(2) }, true);
}
verifyScopeCase({ MOCK_DELETED: "assets/study-room-preview.js" }, true);
const otherLiveSha = "2".repeat(40);
verifyScopeCase({ EXPECTED_CURRENT_PAGES_SHA: otherLiveSha, MOCK_SCOPE_BASE: otherLiveSha });
verifyScopeCase({ EXPECTED_CURRENT_PAGES_SHA: otherLiveSha, MOCK_SCOPE_BASE: otherLiveSha,
  MOCK_CANDIDATE_DELTA: "scripts/astra-release-database-contract.mjs" }, true);
assert.doesNotMatch(scopeStep, /supabase\s+(?:db|migration)|apply_migration|psql/iu);
console.log(`Study Room recognized-baseline scope gate: ${scopeCases} inert Bash cases passed.`);
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
  "assets/study-room/virtual-background-due-diligence-polished-20260908.webp",
  "assets/vendor/mediapipe/LICENSE.txt",
  "assets/vendor/mediapipe/PROVENANCE.txt",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "index.html",
  "scripts/build-pages-artifact.mjs",
  "scripts/test-pages-artifact.mjs",
  "scripts/test-study-room-backgrounds.mjs",
  "scripts/test-study-room-always-open.mjs",
  "scripts/test-study-room-background-picker.mjs",
  "scripts/test-study-room-catalog-sql.mjs",
  "scripts/test-study-room-deployment-smoke.mjs",
  "scripts/test-study-room-fixture-safety.mjs",
  "scripts/test-study-room-hotfix-behavior.mjs",
  "scripts/test-study-room-live.mjs",
  "scripts/test-study-room-preview.mjs",
  "scripts/test-study-room-release-workflow.mjs",
  "study-room/index.html",
  "supabase/migrations/20260908131116_astra_staging_study_room_fixture_registration.sql",
  "supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql",
  "worker/astra-staging-study-room-fixture-registration.test.mjs",
  "worker/index.mjs",
  "worker/livekit-credentials-smoke.mjs",
  "worker/livekit-credentials-smoke.test.mjs",
  "worker/package-lock.json",
  "worker/package.json",
  "worker/study-room-core.mjs",
  "worker/study-room-routes.mjs",
  "worker/study-room-staging-positive-smoke.mjs",
  "worker/study-room.test.mjs",
  "worker/study-room-catalog.test.mjs",
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
assert.equal((workflow.match(/node scripts\/test-study-room-fixture-safety\.mjs/gu) || []).length, 1);
for (const script of ['test-study-room-always-open.mjs', 'test-study-room-background-picker.mjs', 'test-study-room-catalog-sql.mjs']) {
  for (const [label, candidate] of [['protected Study Room', workflow], ['Pages-only', pagesOnlyWorkflow]]) {
    const command = `node scripts/${script}`;
    assert.equal(candidate.split('\n').filter((line) => line.trim() === command).length, 1,
      `${label} must run the exact ${script} once, not only allow its path.`);
  }
}
assert.equal(workflow.split('\n').filter((line) => line.trim() === 'node --test worker/*.test.mjs').length, 1,
  'The protected Study Room gate must run the new catalog Worker test through its unchanged full Worker suite.');
assert.equal(workflow.split('\n').filter((line) => line.trim() === 'node --test worker/study-room-catalog.test.mjs').length, 0,
  'Do not run the catalog Worker test twice in the protected gate.');
assert.equal(pagesOnlyWorkflow.split('\n').filter((line) => line.trim() === 'node --test worker/study-room-catalog.test.mjs').length, 1,
  'Pages-only verification must run the existing catalog authorization contract once.');
for (const candidate of [workflow, pagesOnlyWorkflow]) {
  assert.doesNotMatch(candidate, /(?:supabase\s+(?:db|migration)|apply_migration|\bpsql\b)/iu,
    'Release workflow gates may run disposable local SQL tests but must never apply hosted DDL.');
}
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
  "assets/study-room/virtual-background-due-diligence-polished-20260908.webp",
  "assets/vendor/mediapipe/LICENSE.txt",
  "assets/vendor/mediapipe/PROVENANCE.txt",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "scripts/build-pages-artifact.mjs",
  "scripts/test-pages-artifact.mjs",
  "scripts/test-study-room-backgrounds.mjs",
  "scripts/test-study-room-always-open.mjs",
  "scripts/test-study-room-background-picker.mjs",
  "scripts/test-study-room-catalog-sql.mjs",
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
for (const serverOnly of [
  'supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql',
  'worker/study-room-catalog.test.mjs', 'worker/study-room-core.mjs', 'worker/study-room-routes.mjs',
]) {
  assert.doesNotMatch(serverOnly, pagesOnlyAllowlist,
    'Backend/catalog changes must use the protected Worker-first release, never Pages-only deployment.');
}
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
  "Verify free-member, admin, chat, and two-participant media on staging",
  stagingJob,
);
const stagingCleanupArtifact = workflow.indexOf(
  "Preserve Study Room fixture cleanup evidence",
  stagingPositiveSmoke,
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
    stagingCleanupArtifact > stagingPositiveSmoke &&
    stagingMarker > stagingCleanupArtifact &&
    stagingMarker < workerJob,
  "The exact-SHA marker must be recorded only after every staging smoke check.",
);
const cleanupArtifactStep = workflow.slice(stagingCleanupArtifact, stagingMarker);
assert.match(cleanupArtifactStep, /if: always\(\)/u);
assert.match(cleanupArtifactStep, /uses: actions\/upload-artifact@v4/u);
assert.match(cleanupArtifactStep, /path: artifacts\/study-room\/\*-cleanup-manifest\.json/u);
assert.match(cleanupArtifactStep, /retention-days: 7/u);
assert.match(cleanupArtifactStep, /if-no-files-found: error/u);
const stagingAssetChecks = workflow.slice(stagingSmoke, stagingPositiveSmoke);
for (const [source, requiredMarkers] of [
  [studyRoomPage, ['layout=stable-pins-20260908-1', 'catalog=admin-room-manager-20260908-1',
    'study-room-live.css?v=study-room-admin-manager-20260908-1', 'data-max-rooms="24"', 'id="sr-room-editor"',
    'Inner Chamber always remains admin-only.']],
  [studyRoomClient, ['const MAX_ROOMS = 24;', "name: 'Room 4'",
    "const audience = roomKey === '5' ? 'admin' : candidate?.audience;",
    "workerRequest('/admin/study-room/rooms'", 'expectedRevision: editor.revision']],
]) {
  for (const marker of requiredMarkers) {
    assert.ok(source.includes(marker), `Catalog evidence must match shipped source: ${marker}`);
    for (const [label, checks] of [['staging', stagingAssetChecks],
      ['Worker-first production', workflow.slice(pagesVerificationJob)], ['Pages-only', pagesOnlyWorkflow]]) {
      assert.ok(checks.includes(marker), `${label} must verify the dynamic catalog/admin UI marker: ${marker}`);
    }
  }
}
for (const requiredStagingMarker of [
  "study-room-always-open-20260908-1",
  "study-room-background-images-20260908-1",
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
  "assets/study-room/virtual-background-due-diligence-polished-20260908.webp",
  "assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite",
  "assets/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "assets/study-room-preview.js?v=study-room-all-members-20260908-1",
  "Open to all signed-in members",
  "function hasLiveRoomAccess(value = session)",
  "return signedIn(value);",
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
const workerDeployCommands = workflow.split(/\r?\n/u).filter((line) => /wrangler@4\.114\.0 deploy\b/u.test(line));
assert.equal(workerDeployCommands.length, 5, 'Review all staging and production Worker deploy commands.');
for (const command of workerDeployCommands) {
  assert.match(command, /--keep-vars\b/u, 'A Study Room release must preserve existing unrelated runtime variables.');
}
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
  /study-room-always-open-20260908-1/u,
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
  /study-room-background-images-20260908-1/u,
);
for (const requiredAllMembersMarker of [
  "assets/study-room-preview.js?v=study-room-all-members-20260908-1",
  "Open to all signed-in members",
  "function hasLiveRoomAccess(value = session)",
  "return signedIn(value);",
]) {
  assert.ok(workflow.slice(pagesVerificationJob).includes(requiredAllMembersMarker),
    `Dedicated production verification must check ${requiredAllMembersMarker}.`);
}
assert.ok(home.includes("assets/study-room-preview.js?v=study-room-all-members-20260908-1"));
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
  "assets/study-room/virtual-background-due-diligence-polished-20260908.webp",
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
assert.match(pagesOnlyWorkflow, /study-room-always-open-20260908-1/u);
assert.match(
  pagesOnlyWorkflow,
  /study-room-background-images-20260908-1/u,
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
