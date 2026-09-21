# Hosted export recovery review — 22 September 2026

This is a follow-up to [hosted rehearsal 34415569337](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34415569337), source `895380afa2b6dbb8892e29a8c250d1923235fd00`. That rehearsal **failed**; neither the elapsed duration nor the later local regression completes acceptance.

## Observed evidence

The preserved browser report has SHA256 `95e653f28601f029fb09bd8d744566314ff4d4b1c90e86dbfa719b8ce326b390`, matching the driver receipt. It records 383 passing checks and 175 committed actions: all 16 timed stages, the real 15-minute correction window, the corrected final result and awards, and the rules and scorecard PDF downloads. The configured timed stages total 78 minutes; observed stage duration was 79m33.501s. Overall browser duration was 101m40.176s.

The next action created the result PDF export at revision 647. No completed result download was recorded. The exact browser assertion was sanitized into a generic failure and message hash, so a download-readiness timeout is an inference. A separate unexpected `renew_clock` response was `503 STORE_UNAVAILABLE`; the final rejection assertions were never reached. The next three-judge match, remaining exports and final privacy/shutdown assertions did not pass.

Read-only staging inspection on 21 September found the same result export still running on its first attempt, with a lease that expired on 10 September at 00:53:45.924 UTC. No result PDF object exists. Ten exact test identities, their event, and three objects (evidence, rules PDF and scorecard PDF) remain. The exact fixture identities have **zero current Auth sessions**; the historical runner also recorded sign-out and immediate Auth/Worker denial for all eleven original identities. Cleanup is still incomplete. No remote records were changed during this review.

## Scope of the correction

The browser stopped on 10 September at 00:53:14.538 UTC, before the abandoned claim expired. Its generic 30-second download wait did not allow the existing 60-second recovery lease to elapse. Ordinary authorized snapshots schedule queued work; the durable claim can then be reclaimed after expiry. This works independently of the optional sweeper. With all authorized pages closed and sweeping disabled, idle work does not recover itself.

The hosted rehearsal now waits up to 90 seconds for the **exact existing export's** Download control before starting its separate file-download wait. It neither creates a replacement export nor enables background sweeping. Failure records a fixed readiness classification and bounded job-state fields, excluding raw browser errors, links and document contents. The report's limitations also no longer assert that a next match was started when the test never reached it.

## Requirement-to-test supplement

| Requirement | Verification | Scope and remaining gap |
| --- | --- | --- |
| Recover an interrupted result export without duplicate work | `worker/debate-integration.test.mjs`: fresh integrations, unauthorized snapshots, pre-expiry snapshot, concurrent post-expiry snapshots, one storage write and PDF download | Local production-code integration with memory database and inert storage; not a hosted recovery claim |
| Give an existing export time to recover | `scripts/test-debate-hosted-browser-safety.mjs`: readiness after 65 seconds, bounded timeout, matching-job observation | Local helper checks; hosted full-duration rerun remains required |
| Keep failure evidence safe and truthful | Same safety tests: raw browser/job data excluded, missing and unknown states retained as unknown | No raw credentials, private document data or invitation links enter the report |
| Preserve complete rehearsal acceptance | Existing full hosted journey retains result-version, exact download-byte, privacy, next-match and terminal error checks | Original failed run remains failed; the separate unexpected clock error still needs diagnosis |
| Remove only this run's designated fixtures | Existing ownership, session-fence and atomic-cleanup safeguards | Not performed by this patch; all exact residual data still requires reconciliation |

The production application, Study Room, pricing, entitlements, credentials, media configuration and email delivery are unchanged. This follow-up starts from main `6d0fa988d2a2adc05f74ee0cec4ab4a08df748ee`; it does not redeploy the older rehearsal source or supersede later site repairs.

## Local validation

`node scripts/test-debate-v3.mjs` passed all 13 groups on Node 24.18.0 from 21 September 16:07:40 to 16:09:28 UTC, with no source changes during the run. This includes the production-code integration regression, all 20 hosted-browser safety tests, Study Room regression groups and staging preflight/cleanup tests. The full local report is `artifacts/debate-local-rehearsal/suite-2026-09-21T16-07-39.648Z/report.json`, SHA256 `09d2f7928c580d2c9fc03daf9ef5846a10b41dec7c62c017ee2940d9a73ae9ca`. These local checks use disposable databases and inert external services; they do not prove hosted cleanup, physical media, customer email, or production deployment.
