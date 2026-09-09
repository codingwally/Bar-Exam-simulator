# Debate V3 restricted staging operating package

This package implements the owner's authorized controlled testing and restricted preview. PR356 and its fixture correction PR357 are merged; public launch remains unapproved. Both reviewed additive staging database migrations and the bounded hosted rollback/privilege checks passed; see [the actual database receipt](debate-room-v3/evidence/staging-database-20260909.json). Actual account preparation passed in run34351971269. Run34352333268 deployed `f0c4d6be4203d0a3688521694145d86a0462f2a4` as staging version `1be1d9c5-af54-4f89-b48c-d941968849ab` and passed full configuration preservation, then failed its smoke check on Cloudflare's canonical index redirect. The [independent readback](debate-room-v3/evidence/staging-anonymous-readback-34352333268.json) matched all18 candidate assets and anonymous boundaries. Authenticated allowlist smoke and the hosted organizer journey remain unverified. Both temporary accounts were deleted; this is not a continuing account preview.

The only target is `https://duediligence-examinations-staging.wallyesteban1993.workers.dev`, backed by Supabase project `hlzqmreeoghbldnhlybr`. The historical Worker name is an environment identifier. The established decommission guard rejects the retired implementation. Existing permitted public compatibility files remain byte-identical to the reviewed candidate and supply no Debate feature behavior.

## Files and preserved boundaries

- `worker/debate-staging-policy.json` locks the target, migration paths, required existing secret names and closed Debate flags.
- `scripts/debate-staging-release.mjs` captures sanitized current settings, verifies evidence, generates an additive configuration and checks deployed settings/assets/authentication. It contains no deployment, migration, login or secret-write operation.
- `scripts/test-debate-staging-release.mjs` checks those gates with hostile drift, scope, privacy, credential and artifact cases.
- `.github/workflows/debate-v3-staging.yml` is the separate manually dispatched staging workflow. It shares the existing staging concurrency group and never cancels an active owner. It requires the exact current `main` SHA and uses the existing `staging-e2e` environment. Read-only inventory found zero environment protection rules: there is no platform approval gate. Explicit current authorization, the account allowlist and the code/configuration/evidence gates therefore remain necessary. The package does not change environment protection, the existing staging workflow or support a production target.
- `.github/workflows/debate-v3-capture.yml` permits only the owner `codingwally` to request a read-only capture by labeling PR356 `dv3-c-<exact head SHA>`. It pins that same-repository feature-branch SHA, rejects stale labels, forks and different actors, shares the staging concurrency group and uploads only sanitized `baseline.json`. It cannot deploy, create accounts, write SQL or change secrets. This provides current configuration evidence before merging the feature or registering the manual deployment workflow.
- `scripts/debate-staging-fixtures.mjs` and `scripts/run-debate-staging-auth.mjs` select two fresh student test identities autonomously for actual Study regression and sibling Debate GET-only auth checks. The existing Study registrar classifies them as internal tests before sign-in. The manual workflow is wired to `prepare-auth` and `deploy`; neither requires persistent bearer secrets or an owner-supplied account list. The tested lifecycle remains preparation until real hosted runs succeed.
- `scripts/run-debate-hosted-rehearsal.mjs` adds `prepare-hosted` and `hosted-rehearsal` operations using eleven fresh internal-test students, with ten inside the transient Debate preview. The short operation verifies account/session cleanup without deployment. The long operation requires a reviewed, digest-pinned receipt from that exact candidate and unchanged baseline before it provisions another set of accounts, deploys, and exercises the actual browser/Worker/database journey.

The generated configuration retains `worker/wrangler.staging.toml`, resolving only the entry and artifact paths and adding `keep_vars = true` plus the Debate overlay. Existing Study Room, recovery, variables, secrets, compatibility date/flags, placement, logging and the two-minute cron must remain unchanged. Existing secret values are neither read into evidence nor replaced. The preflight rejects unrepresented resource bindings, limits, Logpush, extra logging/sampling/tracing settings or incomplete metadata; it requires a separately reviewed preservation change instead of guessing.

Initial settings are `DEBATE_ROOM_ENABLED=false`, `DEBATE_MEDIA_ENABLED=false`, `DEBATE_SWEEPER_ENABLED=false`, approved media capacity `0`, and both Debate mail modes `suppressed`. The existing global outbound mode stays `suppressed`. The required preview list accepts only 1–30 distinct approved staging account UUIDs. No flag in this workflow enables public launch, real media, real email or billable capacity. The old cron remains but the Debate sweeper stays disabled.

Cloudflare documents [`keep_vars`](https://developers.cloudflare.com/workers/wrangler/configuration/) as preserving dashboard variables. This package also compares the complete sanitized binding-name/type and setting inventory after deployment; `keep_vars` alone is not the preservation proof.

## Required reviewed evidence

Finish the intended implementation, reconcile the superior task's latest approved recovery baseline, commit the candidate and obtain the required staging clearance. Do not merge or dispatch merely because this document exists. The workflow only accepts the exact reviewed current `main` commit; a feature-branch run is rejected. A new commit invalidates previous local/source/scope evidence.

Before the mutation path can pass, the reviewed JSON must identify the full candidate/base SHAs, every changed path, actual Study/recovery and retired-runtime review references, and applied staging database proof for exactly these candidate-byte hashes:

1. `supabase/migrations/20260909080139_debate_room_v3.sql`
2. `supabase/migrations/20260909080143_study_room_admission_v3.sql`

Database application is a separate authorized operation. Review both migrations, the intended project, direct-client privilege denial, service-role access, transactional rollback probes and existing Study admission behavior. This package never performs that application and never treats local PGlite results as remote database proof. The JSON attests to separately reviewed evidence; it does not independently execute or verify SQL. Do not set proof fields to true until the referenced checks actually passed.

Use this schema with real values; these placeholders are intentionally invalid and confer no authorization:

```json
{
  "candidateSha": "EXACT_40_CHARACTER_CANDIDATE_SHA",
  "baseSha": "EXACT_40_CHARACTER_REVIEWED_ANCESTOR_SHA",
  "approvedPaths": ["EVERY_PATH_FROM_GIT_DIFF_BASE_TO_CANDIDATE"],
  "studyRoomPreserved": true,
  "recoveryPreserved": true,
  "retiredRuntimeAbsent": true,
  "evidenceReferences": ["ACTUAL_SCOPE_AND_RECOVERY_REVIEW_LOCATION"],
  "approvalReference": "ACTUAL_AUTHORIZED_STAGING_CLEARANCE_REFERENCE",
  "databaseProof": {
    "projectRef": "hlzqmreeoghbldnhlybr",
    "schemaVersion": 2,
    "evidenceReference": "ACTUAL_STAGING_DATABASE_CHECK_RECORD",
    "reviewedBy": "ACTUAL_REVIEWER",
    "verifiedAt": "ACTUAL_ISO_8601_TIME",
    "migrationHashes": {
      "supabase/migrations/20260909080139_debate_room_v3.sql": "EXACT_SHA256",
      "supabase/migrations/20260909080143_study_room_admission_v3.sql": "EXACT_SHA256"
    },
    "localInstallationRollback": {
      "passed": true,
      "evidenceReference": "ACTUAL_LOCAL_INSTALLATION_ROLLBACK_REPORT",
      "artifactSha256": "EXACT_REPORT_SHA256",
      "engine": "ACTUAL_LOCAL_POSTGRES_VERSION",
      "adaptations": ["EXACT_DOCUMENTED_LOCAL_ADAPTATIONS"],
      "migrationHashes": {"BOTH_EXACT_MIGRATION_PATHS": "THEIR_EXACT_SHA256_VALUES"}
    },
    "hostedApplication": {
      "passed": true,
      "evidenceReference": "ACTUAL_MIGRATION_APPLICATION_AND_LEDGER_READBACK",
      "artifactSha256": "EXACT_REPORT_SHA256",
      "migrationHashes": {"BOTH_EXACT_MIGRATION_PATHS": "THEIR_EXACT_SHA256_VALUES"}
    },
    "hostedDmlRollback": {"passed": true, "evidenceReference": "ACTUAL_HOSTED_TRANSACTION_AND_ABSENCE_READBACK", "artifactSha256": "EXACT_REPORT_SHA256"},
    "hostedPrivilegesAndPreservation": {"passed": true, "evidenceReference": "ACTUAL_ROLE_DENIALS_AND_STUDY_PRESERVATION", "artifactSha256": "EXACT_REPORT_SHA256"},
    "hostedInstallationRollback": {"status": "NOT_RUN", "reason": "Exact installation rollback tested locally; hosted DDL uses the supported migration tool."},
    "fullAcceptance": false
  }
}
```

The workflow creates fresh complete local-suite evidence itself. All thirteen required groups must appear exactly once with PASS and exit code zero, and the source manifest must include every explicitly required application, migration, build and release dependency in `CRITICAL_SOURCES`. It verifies every recorded source hash against the clean candidate, plus the approved path list against the actual Git diff. Local tests, build success or a manually filled JSON record alone do not authorize deployment.

### Supported database path for the restricted preview

The V3 specification authorizes implementation, controlled testing and a protected preview. Its F05 requires rollback testing on controlled data; it does not require a hosted schema-installation rollback before that preview. The original main-only and hosted installation-probe conditions were implementation choices in this branch, not additional owner approval boundaries. The installed connector requires DDL through `apply_migration`; no direct database connection is configured. Do not send DDL through `execute_sql` or pretend that a recorded migration is a rollback-only probe.

For the protected preview, retain the exact local installation/rollback report and its stated PostgreSQL/fingerprint adaptations; apply only the two reviewed additive migrations to the fixed staging project through the supported migration tool; then execute a DML-only transaction/rollback probe and independent absence, real-role denial and Study-preservation readbacks. Schema version 2 records these as distinct hash-bound reports. It expressly records that hosted installation rollback was not run and full acceptance remains false. An old undifferentiated `rollbackProbePassed` flag is rejected. Missing application, transactional, privilege or preservation evidence still blocks deployment. This change does not approve public launch or clear F05/full acceptance by inference.

## Controlled staging sequence

1. Confirm no superior task or other owner has an active staging claim. The owner has already authorized autonomous test-account decisions; do not ask for identities or passwords again. Select two fresh run-owned internal-test students, with one inside the transient preview list and the other excluded. Keep production, other staging services and existing credentials untouched.
2. Use the existing CI Cloudflare account/token credentials for a read-only `capture` operation. It fetches deployments, Worker settings, script settings, active version, cron, subdomain and fixed-service metadata; it rechecks the deployment at the end. Review its sanitized `baseline.json`. Require one full version UUID serving 100% of traffic, not a screenshot prefix such as `b134ccc7`. The fingerprint binds the complete sanitized state, including the source metadata diagnostic fields. Capture time is excluded.
3. Keep the full previous version UUID, baseline fingerprint, current candidate SHA, reviewed scope, applied migration evidence and approval reference together. The captured file preserves secret **names/types**, not secret recovery values. Unknown or potentially sensitive plaintext values are hashed. No raw Cloudflare response, bearer token or secret value is uploaded as evidence.
4. The driver rejects caller-supplied persistent bearers and preview lists. It uses existing CI Cloudflare credentials and `STAGING_SUPABASE_SERVICE_ROLE_KEY` without changing them. The established read-only fallback resolves the public key from current staging `assets/phase2-config.js`, verifies its exact staging project/origin and single publishable key, and never executes that JavaScript. A read-only exact-project `GET /auth/v1/settings` validates key acceptance and email authentication before any account creation. Missing keys or failed gates stop before provisioning. Bearers stay in memory and narrowly scoped trusted child environments; they never enter workflow inputs, command arguments, source or evidence.
5. Dispatch `prepare-auth` with the reviewed exact SHA, snapshot fingerprint, complete version UUID and JSON evidence to exercise genuine temporary Auth plus Study access and cleanup without deployment. The driver first verifies the clean candidate, complete suite, source/migration hashes, full reviewed scope, sanitized artifact and current remote baseline. Only then does it create two auto-confirmed run-owned accounts, classify them through the existing Study internal-test registrar before sign-in, verify real Study access, and validate the two sessions with `GET /auth/v1/user`. No signup/OTP/invitation email is sent. A subsequent `deploy` run repeats these gates and creates its own fresh identities.
6. Only after all gates pass does the restricted workflow invoke Wrangler against its generated fixed-target configuration with `--keep-vars`. It then captures the exact active deployed version, checks all preserved settings/bindings, and hashes 18 deployed Debate, Study and recovery assets against the built candidate, including the shared sanctions module and the domain's browser import suffix. No database command is part of deployment.
7. The authenticated smoke must prove anonymous event access is denied, a real excluded account receives `DEBATE_PREVIEW_RESTRICTED`, and a real allowlisted account can fetch its authorized event list. Public access remains disabled. A finally block reconciles only exact run-owned fixtures, signs out known sessions, checks foreign data/identity drift, deletes eligible exact Auth IDs and verifies absence plus old-session denial. Unknown outcomes preserve a sanitized manifest for reconciliation. The resulting status is deliberately `PASS_STAGING_ASSETS_AND_AUTH_ONLY`. Cleanup removes the allowed identity too: this transient smoke is not a continuing owner-usable preview or full organizer rehearsal.
8. Complete and record a real staging organizer journey, waiting/admission and multi-role privacy checks on that exact deployed version, including timer ownership/reconnect, all default stages, judging/protests/correction, fixtures, named awards and authorized exports. Record cleanup and authorization results. This still does not prove physical cameras/microphones/screen sharing, capacity, a 90-minute endurance run or real email delivery. Those require separately authorized runs and any applicable spending approval. Keep those verification gaps explicit and retain the public launch gate.

The release inspection CLI has `capture`, `prepare`, `postflight` and `smoke`; the paired lifecycle driver has `prepare-auth` and `deploy`. The driver supplies temporary account UUIDs and bearers to the appropriate child only. Both write sanitized evidence into ignored `artifacts/debate-local-rehearsal/staging-release`. Deployment uses the existing pinned Wrangler `4.114.0` installed in a fixed ignored runner-only directory. It verifies the package version, resolved entry path and entry hash before invocation, and stores child status/exit/output hashes rather than raw output. Normal operation uses the restricted workflow so current ownership, authority and evidence remain associated with one run; the environment itself supplies no approval protection.

### Real-duration hosted control rehearsal

The expanded lifecycle and browser scripts require review and fresh Linux CI checks before dispatch. Their existence is not hosted evidence. Apply the separately reviewed staging-only atomic fixture cleanup helper through the supported migration tool after its PostgreSQL checks pass; its SQL lives outside normal production migration discovery. No cleanup helper is installed by this workflow.

First dispatch `prepare-hosted` with the current exact candidate, captured baseline and existing evidence JSON. This creates only the scoped private bucket if absent and the eleven temporary internal-test accounts, verifies actual Study member access without joining media, and then signs out/deletes the exact fixtures. Before Auth deletion, the complete eleven-actor run must also invoke the actual atomic cleanup RPC for an empty-scope capture and matching zero-row deletion. Only confirmed RPC responses plus exact absence establish `atomicCleanupHelperVerified`. A successful cleanup may still report missing immediate logout fencing; that report cannot authorize the long run. Inspect actual Auth and Worker denials before deletion, cleanup completeness and the absence of foreign data.

After the short probe proves immediate logout fencing, actual atomic helper operation and exact cleanup, supply its GitHub run ID and SHA-256 of its sanitized hosted `driver.json` in `hosted_preparation_run_id` and `hosted_preparation_sha256`. The workflow verifies a successful owner-dispatched run of workflow354012056 at the same main SHA, downloads that run's artifact, and resolves exactly one digest-matched prepare receipt. The driver independently checks the candidate, target, unchanged baseline/version, eleven actors, cleanup, both explicit proof flags and closed launch/provider/mail flags before provisioning anything.

The `hosted-rehearsal` operation retains the real default78-minute timetable and15-minute correction window, measured again by a monotonic driver clock with no accelerated time. Only the host browser stays open during timed waits; other actors reopen with refreshed in-memory sessions. Physical media remains disabled, and readiness uses the supported accommodation flow rather than a false microphone-test assertion. All browser contexts must close and response/session observations settle before cleanup. Atomic cleanup compares server-captured complete rows and exact run ownership before deleting only fixture records, after exact private-storage cleanup. Unknown outcomes retain a sanitized reconciliation manifest.

This operation can establish hosted control-flow endurance, actual role boundaries, exports and cleanup. It cannot satisfy physical camera/microphone/screen-audio endurance, provider quotas and load ramps, real mail delivery, or public-launch approval. Its sanitized artifact allowlist retains only driver/fixture/browser JSON, screenshots with invitation dialogs hidden, and synthetic PDF/CSV downloads. It does not retain tokens, storage state, raw DOM, traces or request logs.

## Failure and rollback

A missing required setting or a newer active version is a stop condition. Preserve the failed gate's sanitized evidence and coordinate with the current staging owner; capture and review a new baseline only after the reason for drift is understood. Do not substitute fixtures to obtain a green result. Actual capture `34349103999` confirms service placement `gcp:us-east4`, full observability and omitted cache/exports metadata. The omitted cache state must be preserved as omitted, not relabeled disabled. The reviewed compatibility adapter and pinned-tool serialization checks must pass before deployment; see [the compatibility review](debate-room-v3/evidence/cloudflare-staging-compatibility-review-20260909.md).

If deployment succeeds but preservation/authentication fails, report the exact deployed version and failed step immediately, keep public/provider/mail gates closed, and stop further releases. Compare the saved before/after records. An authorized owner may restore the exact reviewed previous Worker version through the existing Cloudflare rollback procedure, then repeat settings, assets, Study/recovery and authentication checks. Do not automatically roll back across another owner's newer deployment. Worker rollback does not undo database changes or restore missing secret values; coordinate any database remediation separately against the two approved migrations.

For run34352333268, the failure was diagnosed by real GETs: `/index.html`, `/debate-room/index.html` and `/study-room/index.html` return307 to their directory URLs. Those canonical URLs serve the exact expected bytes. The corrected smoke checker requests canonical paths directly while retaining `redirect: error`, so authenticated requests cannot silently follow a redirect. See Cloudflare's [documented HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/). The current staging fingerprint is `11ade1db738b752ea4f8b6b049f3290bb2ae50e4c112fd17a630bd9f2ada72ad`; the prior rollback anchor is the complete version `b134ccc7-0c7f-4d00-89e0-d7314e0f1dd9`. A subsequent run must freshly confirm the actual current version and fingerprint rather than reuse the predeployment baseline.

Uploaded evidence is retained for 14 days: sanitized baseline/preflight/artifact/authentication JSON and the local suite report. Save the run ID, exact commit/version IDs and permanent review references in the release record before expiry. Never report public launch or full completion from this workflow alone.
