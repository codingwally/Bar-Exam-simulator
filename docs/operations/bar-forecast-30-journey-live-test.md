# Bar Forecast: controlled 30-journey live test

This is a destructive-to-test-data, cost-bearing release check for a specifically approved candidate. It runs exactly 30 complete examiner journeys through the real web page and live Worker/Supabase path. It does not mock or intercept HTTP. Use staging by default. Run production only with explicit release-owner approval.

The runner uses one headless Chrome process. Its default and maximum concurrency is two browser contexts, with one disposable least-privilege `admin` account per worker slot. A separate disposable non-admin account proves the Forecast endpoint returns `403 BAR_FORECAST_ADMIN_FORBIDDEN`. Starts are spaced by at least 45 seconds to remain below the shared Forecast rate limit on a single outbound IP.

Each counted journey resets only its disposable user's Forecast consent, proves the server rejects start before consent, accepts consent in the UI, selects one of the six subjects, starts 20 real questions, and enters 20 answers of at least ten words. It also exercises a flag, yellow question highlight, bold answer text, answer text size, flagged-question filter, submission confirmation, the total grade, and all 20 feedback/suggested-answer/explanation results. Per-attempt markers prove results did not mix across journeys.

The subject rotation is deterministic: five journeys per subject. Thirty submissions produce 150 live grading calls (five grading batches per submission). The 45-second start cadence alone makes the run at least about 22 minutes; model latency can make it materially longer. Treat the run as billable production-like traffic.

## Safety boundaries

- Run only after the exact Pages/Worker candidate and required database migration are staged and approved.
- Prefer a dedicated, temporary `sb_secret_` Supabase key with the narrowest practical lifetime. The runner sends a modern secret only through Supabase's `apikey` header; for compatibility, it sends an explicitly approved legacy three-segment service-role JWT through both `apikey` and bearer authorization. Delete or rotate the credential immediately after the run.
- Do not paste the secret into a command, chat, workflow log, or evidence file. Supply it only through the masked environment prompt or an approved secret store.
- The runner writes progress only to stderr. Its stdout JSON contains candidate SHA/run ID, counts, statuses, durations, and scores, but no protected question or answer text, disposable email, password, access token, or service key.
- The runner creates only temporary `admin` and non-admin test identities bearing the `dd-forecast-e2e-` prefix. It globally signs out each browser session, deletes consent and role rows, removes that exact user's `usage_events` and then `usage_sessions`, deletes each Auth user, and verifies every scoped row is gone before reporting success.
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
node scripts/run-bar-forecast-live-journeys.mjs --environment production --preflight
$env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY = Read-Host 'Temporary Supabase secret key' -MaskInput
node scripts/run-bar-forecast-live-journeys.mjs --environment production 1> artifacts/staging-e2e/bar-forecast-live-30.json
$runExitCode = $LASTEXITCODE
Remove-Item Env:BAR_FORECAST_E2E_SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
exit $runExitCode
```

Optional controls are deliberately bounded: `BAR_FORECAST_E2E_CONCURRENCY=1|2`, `BAR_FORECAST_E2E_START_INTERVAL_MS=45000..120000`, `BAR_FORECAST_E2E_JOURNEY_TIMEOUT_MS=300000..900000`, and `BAR_FORECAST_E2E_BROWSER_CHANNEL=chrome|bundled`. There is no option to reduce or increase the journey count.

## Evidence and failure handling

A passing JSON artifact must show `journeysRequested: 30`, `journeysPassed: 30`, no more than two active contexts, five journeys for every subject, all proof counters at 30, `nonAdministratorDenied: true`, and `cleanup.complete: true`. The `releaseSha` and `githubRunId` must match the reviewed workflow candidate.

Any journey, authorization, candidate-SHA, sign-out, or cleanup failure emits sanitized failure JSON to stdout and exits nonzero. Failure detail is deliberately suppressed to prevent protected content from reaching logs. Use the last stderr progress line to locate the failed ordinal, then inspect approved platform diagnostics rather than adding content capture.

If `cleanup.complete` is false, immediately revoke the temporary key and perform manual cleanup for the exact recorded synthetic user IDs. Remove their `dd2026_bar_forecast_consents` and `user_roles` rows; remove `usage_events` and then `usage_sessions` for each exact user ID; only then remove the matching Auth users whose email begins with the run's `dd-forecast-e2e-<run-id>-` prefix. Verify both usage tables, both Forecast authorization tables, and Auth users are empty for those exact IDs before retrying. Never delete by a broad wildcard or touch non-test users.
