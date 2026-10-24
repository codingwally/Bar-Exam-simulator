# Examination pilot release review — 24 October 2026, Philippine time

**Current classification: implemented and independently rehearsed in local and CI
browsers; not approved for a
real official examination until hosting, private administrator access and all
independent deliveries have been verified.** No public deployment URL is claimed.

The reference is the owner's new Constitutional Law I brief and request for a
simple professional examination prioritizing preservation. Three task agents
implemented and independently reviewed the backend, student journey and private
examiner desk. The existing website and its data were not changed.

The current deterministic suite passes **102 tests**. The clean, credential-free
[CI rehearsal](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/40081239013)
passed at implementation revision `2e3ca325c6d6a24968197fad41483e260dbc0702`:
Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 completed registration,
incremental saving, same-attempt reload recovery, unchanged deadline and final
receipt, with keyboard focus, 390px layout and doubled text. Firefox also passed
60 separate reload checks: 20 minimal worker, 20 actual exam shell and 20 shell
with student module imports. No production credentials were used.

Local Windows repeated Firefox reloads remain inconclusive: failures reproduced
both in the exam and in a tiny independent service-worker fixture while this
8 GB machine had about 90 MB of free memory. The clean Linux success does not
establish the cause of the local failures or certify every Windows device.
WebKit rejected one unload transport under synthetic self-signed TLS; the test
confirmed that the same queued pagehide event reached the server after reload
retry. The event transport does not carry authoritative exam answers.

## Five review passes

| Pass | Scope and observed result |
| --- | --- |
| 1 | Code, authorization and architecture: isolated resources, secret-free assets, verified Access JWTs, secure cookies, same-origin commands, per-attempt access, immutable question versions. Fixed private asset routing and numeric timestamp handling. |
| 2 | Persistence, races and deadlines: real SQLite tests for reversed saves, idempotent retry, atomic submit/lease/cutoff races, database outage, independent queue failure, waiting-room rescheduling and separate recovered drafts. Fixed stale snapshot ordering, conflicting operation UUIDs and pre-cutoff client timer finalization. |
| 3 | Actual student and examiner journeys: one-question five-minute practice, incremental autosave during continuous typing, crash/offline reload, second-tab takeover, blocked storage, receipt reload; 20-question paste/preview/PHT scheduling, recovery, strict readiness, preserved archives and next empty exam. Fixed unbound browser fetch, refresh lease identity and autosave starvation. |
| 4 | Visual and accessibility: 1440/1024/768/390/375/320px student and examiner screens, 200% layout/text checks, visible focus, touch targets, font failure and no horizontal overflow. Inspected saved screenshots. Fixed 320px timer clipping and long checksum overflow. Browser-engine review results are saved with the local evidence. |
| 5 | Adversarial final rehearsal: full immediate countdown at 2 days, 2 hours, 20/6/4 minutes and 30 seconds; actual automatic release without reload; unlisted late entry; offline through common cutoff; official on-time text frozen while later local text remains separate. Local concurrency tested at 13/25/50/100 students, each saving all 20 answers and receiving a checksum receipt. Cloudflare's local workerd/D1/R2 runtime also exercised preservation and failed-provider retry. |

## Evidence and reproduction

- `node exam-pilot/run-tests.mjs`: deterministic real SQLite, provider-adapter,
  importer, countdown and local draft tests. No actual mail or Google data sent.
- `node exam-pilot/test/student-browser.mjs http://localhost:8797`: real browser
  practice, continuous typing, IndexedDB, service-worker offline reload, tab
  recovery, receipts and blocked storage.
- `node exam-pilot/test/visual-browser.mjs`: screenshots and measured overflow,
  target size and save checks at six viewport widths.
- `node exam-pilot/test/official-browser.mjs http://localhost:8798`: requires a
  fresh synthetic server; exercises the complete official timing boundary.
- `test/admin-browser.mjs` exports `runAdminReview` and
  `runAdminControlsReview` for synthetic setup and preservation controls.
- `.wrangler/evidence/`: local screenshots and JSON result records; intentionally
  excluded from public assets and deployment. A small reviewed screenshot set is
  retained in `review-evidence/` for this change.
- `review-evidence/compatibility-chromium-firefox-webkit.json` and
  `review-evidence/ci-rehearsal.json`: retained clean-run results and provenance.
  The CI run also retains its synthetic browser screenshots for 30 days.
- Existing application regressions: feature isolation guard, 14 saved-result
  identity tests, 26 Simulator core tests, 28 route tests, sanitized Pages build
  and its 34 Forecast lifecycle tests passed.
  The existing comprehensive release-validation CI also
  [passed](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/40081238941)
  at the same implementation revision.

Local concurrency is a completeness/race rehearsal, not a hosted load benchmark.
Browser engines and simulated phone widths do not certify every physical
device. A school-network and real iOS/Android rehearsal remains a release task.

The unrelated legacy promotional-video workflow failed because its external
narration download returned HTTP 404. It does not exercise this service; the
existing workflow was not changed to conceal its failure.

## Verified local platform behavior

The schema applied successfully to Wrangler's local D1. The production Worker
entry point ran in local workerd with actual static-asset, D1 and R2 bindings,
without the test server's administrator bypass. Practice browser recovery and
receipt tests passed. Official remained empty and `UNCONFIGURED`; unauthenticated
administrator routes and assets failed closed. Scheduled maintenance recorded
18 successfully written private local R2 snapshots and retained four failed
Google jobs because Google authorization was intentionally absent. These are
local emulators, not live Cloudflare or Google delivery claims.

## Hosting and live release blockers

The available local Cloudflare OAuth session is expired and could not be
refreshed. No production secrets were printed, copied into browser files or
committed. The repository has named Cloudflare deployment secrets, but their
permissions and validity were not verified. The credentialed infrastructure
workflow is manual-only; pull-request tests cannot access those credentials.
Deployment also requires a verified Access issuer and audience before resources
can be provisioned. No live deployment was attempted with missing authentication.

Before recommending the official exam, verify all of the following:

1. Actual hosted HTTPS practice and official routes, protected owner dashboard,
   exact deployed revision and separate D1/R2 bindings.
2. Working Access issuer/audience and owner identity; approved instructor identity
   is still unknown. Private read-only examiner access must be provisioned.
3. Actual independent private R2 copies, authorized private Google Sheet and
   full owner answer email, with matching IDs/checksums and retries. Mock-provider
   success is not evidence of live delivery. Mail is disabled by default.
4. Real mobile devices and hosted concurrency, especially under school NAT and
   intermittent Philippine mobile networks.
5. Actual official questions and confirmed PHT opening/closing times. Never
   publish synthetic review questions into the real official exam.
6. Owner-approved privacy contact, retention/deletion policy and institutional
   review where applicable. No automatic deletion was introduced.

The pilot supports CSV/paste/manual import, not untested DOCX/XLSX parsers. It
offers a strict common cutoff; individual extensions and accommodation approval
are not provided. Question amendments after opening are refused; an examiner
must handle corrections through an announced escalation procedure rather than
silently changing the paper. Recovered drafts stay separately labeled for examiner review.
Monitoring cannot determine misconduct; only Atty. Aguila may decide it.

Baseline: `a375f3eb2d8d914948a38e1ba195098849aed10d`.
Branch: `feat/constitutional-exam-reliability-20261024`.
Rollback preserves the isolated exam database and backup objects; see README.
