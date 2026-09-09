# Debate Room V3 verification index

Updated 2026-09-09T10:30:27.925Z. **READY FOR REVIEW, NOT FULL ACCEPTANCE. Not deployed.**

All **315 rows** remain individually mapped: 267 source subrequirements, 44 acceptance IDs and four owner directives. Bounded states remain **61 LOCAL_VERIFIED / 230 PARTIAL / 24 UNVERIFIED**, with zero complete acceptance passes. All 311 attachment-derived clauses match original source spans after whitespace normalization; all 599 split source lines are classified.

## Latest candidate suite

[artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/report.json) — **PASS_LOCAL_SUITE**, all **13 groups**, 2026-09-09T10:27:14.002Z through 2026-09-09T10:28:36.953Z. **89 source SHA-256 hashes**, **changedDuringRun = []**. This audit independently rechecked all 89 hashes with zero mismatches, the package-to-report hash, and all nine reviewed export sample hashes.

Permanent evidence: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json) and [docs/debate-room-v3/evidence/README.md](../../docs/debate-room-v3/evidence/README.md). The suite records HEAD `7be9f9d17831ef430a355589fa47e8b76421375a` plus current uncommitted source hashes. That HEAD is the first pushed draft PR candidate and alone does not identify later tested fixes. The coordinator owns subsequent commit/CI receipts. Per-row `candidateTests` distinguishes executed suite files from mapped-only checks; `candidateSourceHashCoverage` identifies source files not individually hashed.

| Group | Result | Reported tests / pass / fail | Log |
| --- | --- | --- | --- |
| server-domain-database | PASS | 260 / 260 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/server-domain-database.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/server-domain-database.txt) |
| client-state-media-dates | PASS | 38 / 38 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/client-state-media-dates.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/client-state-media-dates.txt) |
| study-admission-sql | PASS | 11 / 11 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-admission-sql.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-admission-sql.txt) |
| study-always-open | PASS | 37 / 37 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-always-open.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-always-open.txt) |
| study-backgrounds | PASS | Scenario runner; count not emitted | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-backgrounds.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-backgrounds.txt) |
| study-background-picker | PASS | 23 / 23 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-background-picker.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-background-picker.txt) |
| study-hotfix-behavior | PASS | Scenario runner; count not emitted | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-hotfix-behavior.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-hotfix-behavior.txt) |
| study-live | PASS | Scenario runner; count not emitted | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-live.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/study-live.txt) |
| local-http-boundaries | PASS | 2 / 2 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/local-http-boundaries.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/local-http-boundaries.txt) |
| accelerated-organizer | PASS | Scenario runner; count not emitted | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/accelerated-organizer.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/accelerated-organizer.txt) |
| eligible-tournament-exports | PASS | Scenario runner; count not emitted | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/eligible-tournament-exports.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/eligible-tournament-exports.txt) |
| staging-preflight-gates | PASS | 12 / 12 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/staging-preflight-gates.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/staging-preflight-gates.txt) |
| worker-configuration-contract | PASS | 4 / 4 / 0 | [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/worker-configuration-contract.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/worker-configuration-contract.txt) |

The server group includes **260 tests**, including actual main-Worker origin checks and five real PGlite SQL tests. The client group has **38 tests** (including the 28 client-state checks), the CPU configuration contract has **four**, and staging gate tests have **12**. The release policy separately requires **13 named suite groups exactly once and all 65 critical source hashes**; those numbers are policy coverage, not the staging test count.

The current organizer journey completed **184 commands / 59 checks**, all 14 speaking stages plus preparation/break, six genuine local outputs and the next formal match. Actual time was **23510 ms**, with 5625743 ms simulated. The positive tournament journey ran 229 commands and two fully completed matches; four raw-performance awards remain eligible despite disclosed official A100-to-A90 deductions against N92. Neither accelerated journey is a 90-minute physical rehearsal.

Current fixes cover same-origin GET through the actual Worker without manufacturing Origin, preserved explicit foreign/null/mutation denials and fresh auth, delayed navigation response guards, original two-minute cron preservation plus independent minute sweep, strict staging evidence, and ignored fresh fixture output without changing historical tracked samples. Full browser automation remains blocked; these local checks do not convert that gate to PASS.

The intervening 10:24 run failed with organizer Node resource exhaustion while twelve groups passed. Root paused only the task-owned local PGlite server and reran unchanged source successfully. The failed run is preserved as OOM_HISTORY. The earlier 10:19 pass is OUTPUT_HISTORY because its test output handling changed afterward.

## Draft PR and historical CI

Read-only inspection confirmed [Add separate Debate Room V3 and optional Study admission](https://github.com/codingwally/Bar-Exam-simulator/pull/356) is draft/open at first-candidate SHA `7be9f9d17831ef430a355589fa47e8b76421375a`. These first-candidate checks are historical; no new-candidate CI or merge outcome is inferred.

| Historical run | Outcome | Finding |
| --- | --- | --- |
| [Debate V3 local validation](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121568) | SUCCESS | Debate local verification passed its then-current candidate. |
| [Validate soft-launch five-token release](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121570) | FAILURE | Obsolete exact single-cron array literal in CPU configuration test; corrected local check is included in the replacement suite. |
| [Temporary promotional video media transfer](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121602) | FAILURE | Unchanged narration download URL returned HTTP404. |

## Evidence records

### Evidence SOURCE

**SOURCE_COVERAGE_VERIFIED** — [docs/debate-room-v3/source-coverage.json](../../docs/debate-room-v3/source-coverage.json).

MD and TXT are byte-identical; all 599 split lines classified and all 267 source clauses preserved. Source coverage is not product acceptance.

Limit: Supplied external research was not independently refreshed by this ledger audit.

Artifact SHA-256: `e0b3e5523696e8132ea9382f1e2633faf1448e1280eeaaf4674fd41dbf4eb35e`.

### Evidence LATEST

**PASS_LOCAL_SUITE** — [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/report.json).

Final thirteen-group suite passes actual Worker same-origin GET, stale navigation guards, CPU/security configuration, database/service/domain behavior and strict release evidence requirements. Staging evidence requires thirteen named groups exactly once and 65 critical source paths; this suite captures 89 source hashes.

Limit: Local Node/disposable PGlite and inert adapters only. Full current browser flow, hosted migration, native multi-connection load, actual media/capacity/mail and deployment remain unverified.

Artifact SHA-256: `bbd593f4cccbcaf99bfc78e67dd483c3db396131fb845f86a3c6a009105b8dc6`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence HISTORY

**HISTORICAL_LOCAL_SUITE_PASS** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-03-09.895Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-03-09.895Z/report.json).

Earlier ten-group local suite passed. Retained for history; later source fixes supersede this as candidate evidence.

Limit: Not the frozen-candidate result; external and physical gates were not exercised.

Artifact SHA-256: `debbfb256afe33d30af26d99c6dcd096fd27fe37fabe949c582e320b01b22846`.

### Evidence ORGANIZER

**SOFTWARE_JOURNEY_PASS** — [artifacts/debate-local-rehearsal/2026-09-09T10-27-43-305Z-433d34/organizer-rehearsal-de-8810015690a05d28b6a7ef952d3a75a6.json](../../artifacts/debate-local-rehearsal/2026-09-09T10-27-43-305Z-433d34/organizer-rehearsal-de-8810015690a05d28b6a7ef952d3a75a6.json).

Latest organizer journey: 184 commands and 59 checks; five motions, all 14 stages plus preparation/break, private drafts, independent poll, explicit finalization, six real local outputs and next formal match. Actual duration 23510 ms; simulated timeline 5625743 ms.

Limit: Accelerated synthetic identities and disposable PGlite. Not 90 real minutes, physical media, real email, hosted identity or public deployment.

Artifact SHA-256: `27c92b7b7dc509e20233b70142e8747f2ccf27125db520a340555075ad7a38fa`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence CERT_FAIL

**HISTORICAL_FAILED_REHEARSAL** — [artifacts/debate-local-rehearsal/2026-09-09T09-30-52-308Z-d9cd9f/organizer-rehearsal-failed-de-fe5d23e17fe803064868ab818e1a39e4.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-30-52-308Z-d9cd9f/organizer-rehearsal-failed-de-fe5d23e17fe803064868ab818e1a39e4.json).

Earlier organizer rehearsal stopped at command 168/check 55: PARTICIPATION_UNCONFIRMED. Event check-in alone correctly failed match-attendance certificate authorization. Fixture corrected to record actual synthetic match attendance; latest organizer run passed.

Limit: Failure retained; its passing earlier checks do not convert the failed run to PASS.

Artifact SHA-256: `56b71f827b74874d1fc36ce0e2ec7dc5e28752975e11ecd9b849287e7590cdea`.

### Evidence TOURNAMENT

**PASS_LOCAL_ELIGIBLE_TOURNAMENT_SANCTION_EXPORT** — [artifacts/debate-local-rehearsal/2026-09-09T10-28-18-568Z-7ddffd/positive-tournament-sanctions-export.json](../../artifacts/debate-local-rehearsal/2026-09-09T10-28-18-568Z-7ddffd/positive-tournament-sanctions-export.json).

Latest suite: 229 commands, two completed 14-stage finalized matches, two eligible frozen source results, one comparable group, all four awards. Raw A100/N92; declared 10-point A deduction yields official A90/N92. Raw performance awards unchanged. Three genuine private PDFs plus current-owner download and other-actor denial.

Limit: Synthetic local PGlite only; no real competition, hosted object storage, provider, mail, load or deployment.

Artifact SHA-256: `992455062f23d0c2b8a7efc75446a79b7109c5a4a7716012ff60951778560a78`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence PDF_QA

**PASS_TEXT_PAGINATION_AND_VISUAL_QA** — [artifacts/debate-local-rehearsal/2026-09-09T09-35-59-658Z-e17202/pdf-qa/checks.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-35-59-658Z-e17202/pdf-qa/checks.json).

Agent visual-review manifest: all 17 pages across eight PDFs plus one CSV checked. Renderer SHA matches latest frozen suite; no clipping, overlaps, glyph defects or heading orphans reported. Manifest records individual object hashes.

Limit: Visual inspection was performed by the PDF reviewer agent. New suite output bytes can differ because event IDs and timestamps differ; no claim of visual inspection of every later regenerated byte sequence. Hosted download and inbox attachment parity remain open.

Artifact SHA-256: `6ab08b23450a1c9c3a1c7e256c7cbb97a9af7d0fb48cb28d700a9bcfca3ed0a6`.

### Evidence BROWSER

**HISTORICAL_PARTIAL_BROWSER_QA** — [artifacts/debate-local-rehearsal/2026-09-09T07-59-52-481Z-c1f4ba/browser-qa.md](../../artifacts/debate-local-rehearsal/2026-09-09T07-59-52-481Z-c1f4ba/browser-qa.md).

Actual Chrome with synthetic local identities covered saved setup, invite claim, prep start/pause, private scorecard refresh, export request and fixtures; observer privacy held. Later frozen-browser attempts were blocked by repeated CUA CDP Emulation.setFocusEmulationEnabled and Page.navigate timeouts in Chrome and IAB. Later appended notes record a local server resume and read-only staging workflow inventory, not fresh browser interaction. That task-owned server was subsequently paused for the OOM rerun; the historical running-server statement is not current status.

Limit: Not current complete browser pass, full 14-stage visual rehearsal, mobile, physical camera/audio or inspected browser-download destination. Tool failure is a verification gap, not product success or product failure.

Artifact SHA-256: `1a3492ace282ff032ea7bb7681a1261d82245148cd5a380e13ffe1076b3f94f1`.

### Evidence TARGETED

**HISTORICAL_TARGETED_TEST_OBSERVATIONS** — direct task/CI inspection; see linked history above.

Task transcript recorded targeted service/domain/SQL/fixtures/roster/substitution/sanctions/tournament passes while fixes were developed. Applicable files are now independently covered by LATEST logs.

Limit: Earlier transcript-only counts are historical; use the current source-hashed suite for candidate test results.

### Evidence MEDIA

**LOCAL_DOUBLE_BASED_MEDIA_TESTS** — [artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/server-domain-database.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-27-12.512Z/server-domain-database.txt).

Current server-media and delivery tests pass with installed SDK interfaces, local token signing and inert provider responses; client transition tests pass in the client-state-media-dates group.

Limit: No network traffic to the provider, consenting devices, GPU/camera compatibility, stale-token Cloud measurements or physical privacy proof.

Artifact SHA-256: `fd9115aeaa7d846efb095492b2d2adc37872a503886890ef5a2a71cf59e6a577`.

### Evidence STAGING

**READ_ONLY_INVENTORY** — [docs/debate-room-v3/staging-inventory.md](../../docs/debate-room-v3/staging-inventory.md).

Existing staging infrastructure inspected read-only. New Debate/Study-admission migrations and private Debate bucket were not applied by this work. Local staging preflight/release gates pass.

Limit: No deployment or migration proof; staging inventory cannot establish live Debate behavior or authorize launch.

Artifact SHA-256: `40f3308211fcfe459eb99ea481b04d3b52a4eae3ce927ba7aafcdee4f3c55309`.

### Evidence WORKER_HISTORY

**HISTORICAL_BROAD_RUN_WITH_FAILURES** — [artifacts/debate-local-rehearsal/worker-regression-20260909.txt](../../artifacts/debate-local-rehearsal/worker-regression-20260909.txt).

Broad Worker regression recorded 1,695 tests: 1,693 passed, two failed. Root reported fixture-only corrections, then complete affected files re-ran with 65/65 index and 20/20 integration passing; new Debate integration is also covered in LATEST.

Limit: Broad all-Worker suite was not represented as an entirely green rerun. Preserve original failure log and root retest evidence.

Artifact SHA-256: `200f3dd6cc8e2c81567b46c5ff6fd2fc36841136d5250b9827ba7a15cf9dfa26`.

### Evidence ACL_HISTORY

**HISTORICAL_PASS_SUPERSEDED_BY_SQL_ACL_FIX** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-43-14.752Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-43-14.752Z/report.json).

The 09:43 twelve-group suite passed its then-current bytes. Read-only hosted default-ACL inspection then found inherited service-role audit UPDATE/TRUNCATE grants; local SQL was hardened and a reproducing real-SQL regression added. LATEST is the corrected rerun.

Limit: No hosted migration or actual remote privilege probe was performed. The earlier passing suite did not cover the newly reproduced default-ACL shape.

Artifact SHA-256: `c61758ee9478bce41a01a41640fbb5885f3623332c6c00708ac70ef4f10b63b3`.

### Evidence PACKAGE

**PASS_LOCAL_IMPLEMENTATION_CHECKS_NOT_FULL_ACCEPTANCE** — [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

Permanent package records current thirteen-group source/log hashes and counts, preserved broad/CI and OOM history, actual local Pages/staging artifact checks, browser limits, and nine reviewed synthetic samples. This audit verified all nine sample hashes.

Limit: Packaged synthetic outputs and local artifact inspection are not deployment, physical-media, real mail or public launch evidence.

Artifact SHA-256: `773cf7b899407dfd074710a86a7af3127fb02042bd88fdbd5573e81e8abbd7a0`.

### Evidence DB_PREREQ

**READ_ONLY_HOSTED_PREREQUISITES_LOCAL_FIX_VERIFIED** — [docs/debate-room-v3/evidence/staging-db-prerequisites.md](../../docs/debate-room-v3/evidence/staging-db-prerequisites.md).

SELECT-only catalog review found no new Debate/admission objects installed, documented existing Study migration-history naming drift and reproduced default service-role ACL risk. Local correction and five SQL tests pass.

Limit: No remote schema change or hosted transaction/rollback probe. Revalidate metadata drift before any authorized migration.

Artifact SHA-256: `dc346e940cea82f28041dca5072ee34d4b124d86f9773543f2760ae75a7baa5a`.

### Evidence PRE_ORIGIN_HISTORY

**HISTORICAL_PASS_BEFORE_ORIGIN_NAVIGATION_CONFIGURATION_FIXES** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json).

The earlier twelve-group suite passed its recorded bytes before the main Worker same-origin GET, navigation, CPU contract and evidence-manifest fixes.

Limit: Retained history only; latest candidate requires the thirteen-group suite.

Artifact SHA-256: `7f212fdbd5298eab13f073ada00d1f611368a7ca5775418443b7824f010de8d7`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence ROLLBACK_PROBE

**LOCAL_ADAPTED_ROLLBACK_ONLY_NOT_HOSTED** — [docs/debate-room-v3/evidence/staging-rollback-probe.md](../../docs/debate-room-v3/evidence/staging-rollback-probe.md).

Concrete rollback probe embeds exact migration bodies and checks collisions, prerequisites, privileges, actual service commands, immutable audit and restoration. Documented local PG18 version/helper-fingerprint adaptations and five negative cases passed; the unmodified PG17-targeted artifact rejects that local runtime.

Limit: No hosted probe or migration. A separately approved transport preserving the complete transaction and rollback/readback remains unresolved; execute_sql/apply_migration are not substitute rollback transports.

Artifact SHA-256: `7d09e4d5a3d242742e3d2efa9be97a1ae1f9d1ef4d6515a4fddfa1d16a6a5287`.

SQL artifact: [docs/debate-room-v3/evidence/staging-rollback-probe.sql](../../docs/debate-room-v3/evidence/staging-rollback-probe.sql), SHA-256 `ce653a3902b58c038c4fc44ff24d136a05fa1723699288bbf436d6111b6e6a9b`.

### Evidence CI_HISTORY

**FIRST_DRAFT_CANDIDATE_CI_HISTORY** — direct task/CI inspection; see linked history above.

Read-only GitHub inspection confirmed draft PR356 at its first candidate and these three CI conclusions. The failed runs remain failures in history.

Limit: These checks predate newer candidate fixes. Root owns subsequent CI receipts; none establishes merge, hosted behavior or deployment.

### Evidence OOM_HISTORY

**FAILED_LOCAL_RUN_RESOURCE_EXHAUSTION** — [artifacts/debate-local-rehearsal/suite-2026-09-09T10-24-11.761Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-24-11.761Z/report.json).

The intervening thirteen-group run had twelve groups pass and the organizer process exit2147483651 with Fatal process out of memory: Zone. Its source hashes did not change during the run. Root paused only the task-owned local PGlite server, then the unchanged source passed all thirteen groups.

Limit: This was a failed complete run and remains failed. It is a Node resource failure, not a passing rehearsal or a demonstrated product assertion failure. No physical or hosted conclusion follows.

Artifact SHA-256: `c6ff1e06d714070f769ce2cb8f32b3e13d2ef97136564125c22f63c4c3d6eaed`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence OUTPUT_HISTORY

**HISTORICAL_PASS_BEFORE_FIXTURE_OUTPUT_HYGIENE** — [artifacts/debate-local-rehearsal/suite-2026-09-09T10-19-47.413Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T10-19-47.413Z/report.json).

The first thirteen-group suite passed but its fixture wrote a random-UUID result into a tracked historical sample. The test output was moved to ignored local evidence; the historical tracked sample was preserved. LATEST covers the corrected test bytes.

Limit: The old pass is not current source-hash evidence. No runtime feature changes were made for output hygiene.

Artifact SHA-256: `5580ff11490a5fbc5da78ebac355837e5183088f8edc730037cd0db18f708f55`.

## Open acceptance and release gates

- **Current complete browser journey:** latest Chrome and in-app-browser attempts were blocked by repeated CUA CDP focus/navigation timeouts. Historical partial Chrome QA remains evidence only for its tested flow. Full frozen UI, mobile/320px, zoom, keyboard, screen reader, contrast, reconnect and real-account cohort checks remain open.
- **Physical media and endurance:** consenting independent camera/microphone devices, simultaneous questioning/responding, background effects, private-room leakage, controlled tab sleep/network failure, measured timer agreement and at least 90 real minutes of full-flow operation have not been verified. A synthetic clock advance or API journey does not satisfy these checks.
- **Capacity and spend:** no approved 10/25/50/100 participant ramp, measured provider overhead/reconnect headroom, concurrent event limit or cost evidence. 100 is a requested target, not verified capacity. New media stays disabled until configured verified limits, revocation assumptions and independent minute sweep operation are proved.
- **External delivery and persistence:** no actual approved-recipient inbox delivery, production email send, hosted private-object lifecycle, native multi-connection database load, hosted migration, backup/restore or live rollback proof. Provider/mail success doubles verify boundary behavior only. Proposed retention defaults require actual owner/operator approval.
- **Rollback probe transport:** the concrete PG17-targeted SQL has local adapted PG18 evidence only. Hosted execution needs a separately approved single-connection transaction/rollback transport and independent readback; no hosted probe has run.
- **Deployment and launch:** new migrations, Worker and Pages have not been deployed by this work. No new Debate deployment IDs, live SHA/asset/auth/navigation smoke or approved public launch are claimed. Read-only staging inventory and local release-gate tests do not fulfill deployment evidence.

## Historical failures and source boundaries

The certificate rehearsal failure is retained as CERT_FAIL: absence of match attendance correctly blocked issuance. The latest corrected fixture records attendance and passes. WORKER_HISTORY retains the broad 1,695-test run with two failures; root reported fixture corrections and full affected-file retests (65/65 index, 20/20 integration), rather than describing the entire broad run as clean. Earlier local suite and partial browser results are labeled historical. PDF_QA records reviewer inspection of eight PDFs / 17 pages and one CSV with the current renderer hash, not a claim that every later byte sequence was visually inspected.

The Debate SQL draft/migration hash is `89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c`. Study Room admission migration hash is `5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637`; the latest suite hashes its byte-identical draft and executes actual local admission SQL. These hashes are local preparation evidence, not proof of application to a remote database.

The permanent evidence package and nine hash-verified synthetic samples are repository files under evidence/. Raw artifact logs and earlier outputs may remain local/ignored; their hashes and paths are retained so historical failures remain traceable. The source attachment and existing Study Room repairs remain intact. No subscription/provider purchase, actual email send or remote database mutation was performed by this documentation audit.
