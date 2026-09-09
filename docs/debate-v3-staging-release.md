# Debate V3 restricted staging operating package

This package is prepared code in draft PR 356, not permission to deploy and not evidence of a successful staging run. The workflow has not been dispatched or used to deploy or apply database changes. Its unit tests use local fixtures; real staging authorization remains unverified until the restricted workflow and the subsequent organizer rehearsal succeed.

The only target is `https://duediligence-examinations-staging.wallyesteban1993.workers.dev`, backed by Supabase project `hlzqmreeoghbldnhlybr`. The historical Worker name is an environment identifier. The established decommission guard rejects the retired implementation. Existing permitted public compatibility files remain byte-identical to the reviewed candidate and supply no Debate feature behavior.

## Files and preserved boundaries

- `worker/debate-staging-policy.json` locks the target, migration paths, required existing secret names and closed Debate flags.
- `scripts/debate-staging-release.mjs` captures sanitized current settings, verifies evidence, generates an additive configuration and checks deployed settings/assets/authentication. It contains no deployment, migration, login or secret-write operation.
- `scripts/test-debate-staging-release.mjs` checks those gates with hostile drift, scope, privacy, credential and artifact cases.
- `.github/workflows/debate-v3-staging.yml` is the separate manually dispatched staging workflow. It shares the existing staging concurrency group and never cancels an active owner. It requires the exact current `main` SHA and uses the existing `staging-e2e` environment. Read-only inventory found zero environment protection rules: there is no platform approval gate. Explicit current authorization, the account allowlist and the code/configuration/evidence gates therefore remain necessary. The package does not change environment protection, the existing staging workflow or support a production target.

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
    "applied": true,
    "rollbackProbePassed": true,
    "privilegesPassed": true,
    "evidenceReference": "ACTUAL_STAGING_DATABASE_CHECK_RECORD",
    "reviewedBy": "ACTUAL_REVIEWER",
    "verifiedAt": "ACTUAL_ISO_8601_TIME",
    "migrationHashes": {
      "supabase/migrations/20260909080139_debate_room_v3.sql": "EXACT_SHA256",
      "supabase/migrations/20260909080143_study_room_admission_v3.sql": "EXACT_SHA256"
    }
  }
}
```

The workflow creates fresh complete local-suite evidence itself. All thirteen required groups must appear exactly once with PASS and exit code zero, and the source manifest must include the 65 explicitly required application, migration, build and release dependencies. It verifies every recorded source hash against the clean candidate, plus the approved path list against the actual Git diff. Local tests, build success or a manually filled JSON record alone do not authorize deployment.

## Controlled staging sequence

1. Confirm no superior task or other owner has an active staging claim. Keep production, other staging services and existing credentials untouched. Confirm the two approved staging test accounts are available: one UUID inside the preview list, the other outside it.
2. Use the existing CI Cloudflare account/token credentials for a read-only `capture` operation. It fetches deployments, Worker settings, script settings, active version, cron and subdomain metadata; it rechecks the deployment at the end. Review its sanitized `baseline.json`. Require one full version UUID serving 100% of traffic, not a screenshot prefix such as `b134ccc7`. The fingerprint binds the complete sanitized state, excluding only capture time and volatile placement timestamps.
3. Keep the full previous version UUID, baseline fingerprint, current candidate SHA, reviewed scope, applied migration evidence and approval reference together. The captured file preserves secret **names/types**, not secret recovery values. Unknown or potentially sensitive plaintext values are hashed. No raw Cloudflare response, bearer token or secret value is uploaded as evidence.
4. The two proposed CI secret names `DEBATE_STAGING_ALLOWED_BEARER` and `DEBATE_STAGING_DENIED_BEARER` are **not provisioned**; valid short-lived staging sessions are an open release gate. Supplying them requires separately authorized credential handling. The existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` remain unchanged. The current environment has no `STAGING_SUPABASE_PUBLISHABLE_KEY` secret: the workflow follows the established read-only fallback to the current staging `assets/phase2-config.js`, verifies its exact staging project/origin and single publishable key, and places that public value in the runner environment. It does not execute the remote JavaScript or create a secret. Do not place bearer tokens in workflow input JSON, source, command text or evidence. The package neither creates accounts nor stores new secrets. Missing or invalid credentials block the deployment.
5. Dispatch `deploy` only with explicit current clearance and the reviewed exact SHA, snapshot fingerprint, complete version UUID, preview UUID list and JSON evidence. The workflow runs the complete local suite and release tests, uses the existing target-locked sanitized staging builder, validates real Supabase sessions with `GET /auth/v1/user`, and rechecks the fresh remote snapshot against the reviewed fingerprint. It rejects dirty files, source/migration changes, any unreviewed changed path, unavailable credentials or live baseline drift.
6. Only after all gates pass does the restricted workflow invoke Wrangler against its generated fixed-target configuration with `--keep-vars`. It then captures the exact active deployed version, checks all preserved settings/bindings, and hashes 18 deployed Debate, Study and recovery assets against the built candidate, including the shared sanctions module and the domain's browser import suffix. No database command is part of deployment.
7. The authenticated smoke must prove anonymous event access is denied, a real excluded account receives `DEBATE_PREVIEW_RESTRICTED`, and a real allowlisted account can fetch its authorized event list. Public access remains disabled. The resulting status is deliberately `PASS_STAGING_ASSETS_AND_AUTH_ONLY`.
8. Complete and record a real staging organizer journey, waiting/admission and multi-role privacy checks on that exact deployed version, including timer ownership/reconnect, all default stages, judging/protests/correction, fixtures, named awards and authorized exports. Record cleanup and authorization results. This still does not prove physical cameras/microphones/screen sharing, capacity, a 90-minute endurance run or real email delivery. Those require separately authorized runs and any applicable spending approval. Keep those verification gaps explicit and retain the public launch gate.

The CLI has only `capture`, `prepare`, `postflight` and `smoke`. `prepare` uses the same environment names as the workflow, plus `DEBATE_LOCAL_SUITE_REPORT`, `DEBATE_CANDIDATE_SHA`, `DEBATE_EXPECTED_BASELINE_SHA256`, `DEBATE_EXPECTED_VERSION_ID`, `DEBATE_PREVIEW_ACTOR_IDS` and `DEBATE_RELEASE_REVIEW`. It writes into ignored `artifacts/debate-local-rehearsal/staging-release`. Normal operation should use the restricted workflow so current ownership, explicit authorization references and evidence remain associated with one run; the environment itself supplies no approval protection.

## Failure and rollback

A missing setting or a newer active version is a stop condition. Preserve the failed gate's sanitized evidence and coordinate with the current staging owner; capture and review a new baseline only after the reason for drift is understood. Do not weaken a gate or substitute fixtures to obtain a green result. API metadata shapes have only been exercised with local fixtures in this package; a real read-only capture is still required and may reveal a needed compatibility adjustment.

If deployment succeeds but preservation/authentication fails, report the exact deployed version and failed step immediately, keep public/provider/mail gates closed, and stop further releases. Compare the saved before/after records. An authorized owner may restore the exact reviewed previous Worker version through the existing Cloudflare rollback procedure, then repeat settings, assets, Study/recovery and authentication checks. Do not automatically roll back across another owner's newer deployment. Worker rollback does not undo database changes or restore missing secret values; coordinate any database remediation separately against the two approved migrations.

Uploaded evidence is retained for 14 days: sanitized baseline/preflight/artifact/authentication JSON and the local suite report. Save the run ID, exact commit/version IDs and permanent review references in the release record before expiry. Never report public launch or full completion from this workflow alone.
