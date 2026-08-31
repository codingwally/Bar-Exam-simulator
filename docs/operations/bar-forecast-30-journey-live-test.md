# Bar Forecast: controlled 30-journey live test

This is a destructive-to-test-data, cost-bearing release check for a specifically approved candidate. It runs exactly 30 complete examiner journeys through the real web page and live Worker/Supabase path. It does not mock or intercept HTTP. Use staging by default. Run production only with explicit release-owner approval.

The runner uses one headless Chrome process and exactly 30 distinct disposable least-privilege `admin` identities, one identity for each counted journey. It executes 15 batches. Every batch starts exactly two simultaneous, isolated browser contexts, and no more than two contexts may be active. A separate disposable non-admin identity proves the Forecast endpoint returns `403 BAR_FORECAST_ADMIN_FORBIDDEN`, for 31 temporary accounts in total. Consecutive batch starts are spaced by at least 180 seconds.

Each administrator first signs in on a neutral page without the Forecast hash. Three tagged direct Forecast probes prove that status, consent, and start all fail with `403 BAR_FORECAST_SETUP_REQUIRED` before the standard account setup is completed. A fourth tagged direct status probe then proves `200`, `authorized: true`, and `consentAccepted: false` before the browser navigates to `#bar-forecast-2026`. Those four setup probes are excluded from the counted journey-network sequence, but their 30-of-30 boundary and readiness proofs remain mandatory in the evidence.

Each counted journey resets only its disposable user's Forecast consent, proves the server rejects start before consent, accepts consent in the UI, selects one of the six subjects, starts 20 real questions, and enters 20 answers of at least ten words. It also exercises a flag, yellow question highlight, bold answer text, answer text size, flagged-question filter, submission confirmation, the total grade, and all 20 feedback/suggested-answer/explanation results. Per-attempt markers prove results did not mix across journeys.

The subject rotation is deterministic: five journeys per subject. Thirty submissions produce 150 live grading calls (five grading batches per submission). The 15-batch cadence requires at least 42 minutes between the first and final batch starts; model latency and setup/cleanup can make it materially longer. The trusted workflow remains capped at 90 minutes. Treat the run as billable production-like traffic.

The rate plan is fail-closed. Each examiner can issue four setup probes plus at most six counted Forecast requests. At a 180-second cadence, no ten-minute window can contain more than four two-examiner batches. Including the one non-admin denial probe, the planned maximum is 81 requests against the dedicated limit of 90, leaving nine requests of headroom. Evidence must independently reproduce both the observed batch spacing and this rate-limit headroom.

## Safety boundaries

- Run only after the exact Pages/Worker candidate and required database migration are staged and approved.
- Prefer a dedicated, temporary `sb_secret_` Supabase key with the narrowest practical lifetime. The runner sends a modern secret only through Supabase's `apikey` header; for compatibility, it sends an explicitly approved legacy three-segment service-role JWT through both `apikey` and bearer authorization. Delete or rotate the credential immediately after the run.
- Do not paste the secret into a command, chat, workflow log, or evidence file. Supply it only through the masked environment prompt or an approved secret store.
- The runner writes progress only to stderr. Its stdout JSON contains candidate SHA/run ID, counts, statuses, durations, and scores, but no protected question or answer text, disposable email, password, access token, or service key.
- The runner creates only 30 temporary `admin` identities and one non-admin identity bearing the `dd-forecast-e2e-` prefix. It globally signs out each browser session, deletes consent and role rows, removes that exact user's `usage_events` and then `usage_sessions`, deletes each Auth user, and verifies every scoped row is gone before reporting success. Success requires exact cleanup of all 31 accounts.
- A signal such as Ctrl+C closes active contexts and enters the same cleanup path. Do not force-kill the process unless cleanup itself is stuck.
- Do not schedule this against production on an ordinary pull request. The production confirmation and approval reference are intentionally separate gates.

## Prerequisites

- Node.js 22 or later.
- Chrome installed, or Playwright's bundled Chromium with `BAR_FORECAST_E2E_BROWSER_CHANNEL=bundled`.
- Playwright 1.54.2 available without changing the lockfile. The release workflow may install it with:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
npm install --no-save --no-package-lock playwright@1.54.2
```

- The exact 40-character release commit SHA and numeric GitHub Actions run ID.
- The target-specific typed confirmation below.

Run the offline contract check before any live execution:

```powershell
node scripts/test-bar-forecast-live-journeys.mjs
```

## Staging

Set the non-secret attestation values and run preflight first. Preflight loads neither Playwright nor the secret:

```powershell
$env:BAR_FORECAST_E2E_CONFIRM = 'staging:hlzqmreeoghbldnhlybr:30'
$env:BAR_FORECAST_E2E_RELEASE_SHA = '<exact-40-hex-candidate-sha>'
$env:BAR_FORECAST_E2E_GITHUB_RUN_ID = '<numeric-run-id>'
$env:BAR_FORECAST_E2E_BATCH_INTERVAL_MS = '180000'
node scripts/run-bar-forecast-live-journeys.mjs --environment staging --preflight
```

Then load the dedicated temporary key without echoing it and run the real journeys. The artifact directory must already exist when running this command manually:

```powershell
$env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY = Read-Host 'Temporary Supabase secret key' -MaskInput
New-Item -ItemType Directory -Force -Path 'artifacts/staging-e2e' | Out-Null
node scripts/run-bar-forecast-live-journeys.mjs --environment staging 1> artifacts/staging-e2e/bar-forecast-live-30.json
$runExitCode = $LASTEXITCODE
Remove-Item Env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
exit $runExitCode
```

The runner independently fetches `/.well-known/duediligence-release.txt` in the browser and fails closed unless it equals `BAR_FORECAST_E2E_RELEASE_SHA`.

## Production

Production uses the same script, but only after the release owner approves the exact candidate, expected 150 grading calls, and disposable-user creation. Add an auditable approval reference of at least eight characters:

```powershell
$env:BAR_FORECAST_E2E_CONFIRM = 'production:hbllomlijfznnuudpdvr:30'
$env:BAR_FORECAST_E2E_RELEASE_SHA = '<exact-40-hex-candidate-sha>'
$env:BAR_FORECAST_E2E_GITHUB_RUN_ID = '<numeric-run-id>'
$env:BAR_FORECAST_E2E_APPROVAL_REFERENCE = '<approved-change-or-release-reference>'
$env:BAR_FORECAST_E2E_AWAIT_CLASSIFICATION = 'true'
$env:BAR_FORECAST_E2E_BATCH_INTERVAL_MS = '180000'
node scripts/run-bar-forecast-live-journeys.mjs --environment production --preflight
$env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY = Read-Host 'Temporary Supabase secret key' -MaskInput
node scripts/run-bar-forecast-live-journeys.mjs --environment production 1> artifacts/staging-e2e/bar-forecast-live-30.json
$runExitCode = $LASTEXITCODE
Remove-Item Env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
exit $runExitCode
```

Before the first production sign-in, the runner prints a credential-free `FORECAST_E2E_CLASSIFICATION` checkpoint containing only the run ID and 31 synthetic user UUID/kind pairs, then pauses for at most ten minutes. Independently validate those exact, newly created `dd-forecast-e2e-<run-id>-*` Auth identities and their expected roles, insert all 31 into `private.internal_test_accounts`, and only then enter `CONTINUE <run-id>` on stdin. This keeps their telemetry in the internal/test scope and prevents Admin Pulse delivery. Never acknowledge a partial, stale, reused, or mismatched fixture set.

Optional controls are deliberately bounded: `BAR_FORECAST_E2E_BATCH_INTERVAL_MS` must be exactly `180000`, `BAR_FORECAST_E2E_JOURNEY_TIMEOUT_MS` may be `300000..900000`, and `BAR_FORECAST_E2E_BROWSER_CHANNEL` may be `chrome|bundled`. There is no option to reduce or increase the journey count, alter the 15 batches, reuse an administrator identity, or change the exact two-browser concurrency.

## Evidence and failure handling

A passing JSON artifact must show `journeysRequested: 30`, `journeysPassed: 30`, `batchesPassed: 15`, exactly two active contexts, observed batch spacing of at least 180 seconds, 30 distinct administrator identities used once each, 30 required-setup boundary proofs, 30 post-setup authorized-status proofs, no more than six approved counted Forecast requests in their exact order per journey, five journeys for every subject, `nonAdministratorDenied: true`, nine or more requests of observed rate-limit headroom, and exact cleanup of all 31 accounts. The `releaseSha` and `githubRunId` must match the reviewed workflow candidate.

Browser-console errors are classified. Chromium's expected `Failed to load resource` messages for the deliberate `403` setup/denial and `409` consent-gate responses may be counted as expected resource errors. Any other console error, any uncaught page error, or any mismatch between the console totals and classifications fails the gate.

Any journey, authorization, candidate-SHA, sign-out, or cleanup failure emits sanitized failure JSON to stdout and exits nonzero. Failure detail is deliberately suppressed to prevent protected content from reaching logs. Use the last stderr progress line to locate the failed ordinal, then inspect approved platform diagnostics rather than adding content capture.

If `cleanup.complete` is false, immediately revoke the temporary key and perform manual cleanup for the exact recorded synthetic user IDs. Remove their `dd2026_bar_forecast_consents` and `user_roles` rows; remove `usage_events` and then `usage_sessions` for each exact user ID; only then remove the matching Auth users whose email begins with the run's `dd-forecast-e2e-<run-id>-` prefix. Verify `profiles`, `terms_acceptances`, `introductory_token_grants`, and `introductory_token_ledger` have no rows for those exact IDs after Auth deletion. Also verify both usage tables, both Forecast authorization tables, and Auth users are empty for those exact IDs before retrying. Never delete by a broad wildcard or touch non-test users.
