# Debate Room V3 verification index

Updated 2026-09-09T09:59:22.688Z. **READY FOR REVIEW, NOT FULL ACCEPTANCE. Not deployed.**

All 315 rows are individually mapped: 267 source subrequirements, 44 acceptance IDs and four owner directives. Bounded states are 61 LOCAL_VERIFIED, 230 PARTIAL and 24 UNVERIFIED; zero complete acceptance passes. All 311 attachment-derived clauses still match their original source spans after whitespace normalization.

## Latest candidate suite

[artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json) — **PASS_LOCAL_SUITE**, all **12 groups**, 2026-09-09T09:54:38.853Z through 2026-09-09T09:56:24.648Z. **74 source hashes**, **changedDuringRun = []**; this audit rechecked every hash with zero mismatches. Permanent evidence: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json) and [docs/debate-room-v3/evidence/README.md](../../docs/debate-room-v3/evidence/README.md).

The suite records HEAD `9053390cb4f69da7627e0f079ebbbb3f0da0ea1d` plus dirty candidate source hashes. HEAD alone does not identify the tested bytes. Per-row `candidateTests` distinguishes checks actually run in the suite from other mapped checks; `candidateSourceHashCoverage` identifies source files not individually hashed. Local artifact packaging is separately recorded in PACKAGE.

| Group | Result | Command / log |
| --- | --- | --- |
| server-domain-database | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/server-domain-database.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/server-domain-database.txt)<br>`node --test --test-concurrency=1 worker/debate-delivery.test.mjs worker/debate-domain.test.mjs worker/debate-fixtures.test.mjs worker/debate-integration.test.mjs worker/debate-media.test.mjs worker/debate-procedures.test.mjs worker/debate-rosters.test.mjs worker/debate-sanctions.test.mjs worker/debate-service.test.mjs worker/debate-standings-sanctions.test.mjs worker/debate-store-sql.test.mjs worker/debate-substitutions.test.mjs worker/debate-tournament.test.mjs worker/study-room-admission.test.mjs worker/study-room-catalog.test.mjs worker/study-room.test.mjs` |
| client-state-media-dates | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/client-state-media-dates.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/client-state-media-dates.txt)<br>`node --test scripts/test-debate-client-state.mjs scripts/test-debate-media.mjs scripts/test-debate-dates.mjs` |
| study-admission-sql | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-admission-sql.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-admission-sql.txt)<br>`node scripts/test-study-room-admission-sql.mjs` |
| study-always-open | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-always-open.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-always-open.txt)<br>`node scripts/test-study-room-always-open.mjs` |
| study-backgrounds | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-backgrounds.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-backgrounds.txt)<br>`node scripts/test-study-room-backgrounds.mjs` |
| study-background-picker | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-background-picker.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-background-picker.txt)<br>`node scripts/test-study-room-background-picker.mjs` |
| study-hotfix-behavior | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-hotfix-behavior.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-hotfix-behavior.txt)<br>`node scripts/test-study-room-hotfix-behavior.mjs` |
| study-live | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-live.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/study-live.txt)<br>`node scripts/test-study-room-live.mjs` |
| local-http-boundaries | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/local-http-boundaries.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/local-http-boundaries.txt)<br>`node --test scripts/test-debate-rehearsal-server.mjs` |
| accelerated-organizer | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/accelerated-organizer.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/accelerated-organizer.txt)<br>`node scripts/test-debate-organizer-rehearsal.mjs` |
| eligible-tournament-exports | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/eligible-tournament-exports.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/eligible-tournament-exports.txt)<br>`node scripts/test-debate-tournament-export.mjs` |
| staging-preflight-gates | PASS | [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/staging-preflight-gates.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/staging-preflight-gates.txt)<br>`node --test scripts/test-debate-staging-release.mjs` |

The post-ACL suite includes **253 server/domain/database tests** and **five actual PGlite SQL tests**. The organizer journey completed **184 commands / 59 checks** in **5259 ms**, simulating 5607494 ms. It covered all 14 stages, preparation/break, six genuine local outputs and the next match. The 229-command positive tournament journey proves two eligible final results and four awards while preserving raw A100/N92 and disclosed adjusted A90/N92. These accelerated synthetic journeys are not 90 real-minute physical rehearsals.

The local default-ACL regression reproduced inherited service-role audit grants, then verified explicit revocation before narrow grants. Current Debate SQL SHA-256: `89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c`. The original 09:43 pass is retained as ACL_HISTORY. The hosted prerequisite review remains read-only; no remote schema was applied.

## Evidence records

### Evidence SOURCE

**SOURCE_COVERAGE_VERIFIED** — [docs/debate-room-v3/source-coverage.json](../../docs/debate-room-v3/source-coverage.json).

MD and TXT are byte-identical; all 599 split lines classified and all 267 source clauses preserved. Source coverage is not product acceptance.

Limit: Supplied external research was not independently refreshed by this ledger audit.

Artifact SHA-256: `b8d49b04ddc0042fbed2cba97dc06bd800a4454c89c75907d972b16fde973ea2`.

### Evidence LATEST

**PASS_LOCAL_SUITE** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/report.json).

Final post-ACL twelve-group suite passes, including 253 server/domain/database tests and five actual PGlite SQL tests. Explicit default service-role grants are revoked before narrow grants, so audit UPDATE/TRUNCATE denial is verified against the reproduced hosted default-ACL shape.

Limit: Local Node/disposable PGlite and inert adapters only. Not hosted migration, native multi-connection load, actual media/capacity/mail, complete current browser or public deployment.

Artifact SHA-256: `7f212fdbd5298eab13f073ada00d1f611368a7ca5775418443b7824f010de8d7`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence HISTORY

**HISTORICAL_LOCAL_SUITE_PASS** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-03-09.895Z/report.json](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-03-09.895Z/report.json).

Earlier ten-group local suite passed. Retained for history; later source fixes supersede this as candidate evidence.

Limit: Not the frozen-candidate result; external and physical gates were not exercised.

Artifact SHA-256: `debbfb256afe33d30af26d99c6dcd096fd27fe37fabe949c582e320b01b22846`.

### Evidence ORGANIZER

**SOFTWARE_JOURNEY_PASS** — [artifacts/debate-local-rehearsal/2026-09-09T09-55-47-855Z-17b100/organizer-rehearsal-de-23a37c2b0a1523a4a2863f5a4cc91495.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-55-47-855Z-17b100/organizer-rehearsal-de-23a37c2b0a1523a4a2863f5a4cc91495.json).

Latest post-ACL organizer journey: 184 committed commands, 59 checks, five motions, all 14 speaking stages plus preparation/break, independent ballots/poll, finalization, six real local outputs and next formal match. Actual duration 5259 ms; simulated timeline 5607494 ms.

Limit: Accelerated synthetic identities and disposable PGlite. Not 90 real minutes, physical media, real email, hosted identity or public deployment.

Artifact SHA-256: `0f2b3b215b5045889908140d86e41f31c4ed713779718b1be279c5985c0add6a`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence CERT_FAIL

**HISTORICAL_FAILED_REHEARSAL** — [artifacts/debate-local-rehearsal/2026-09-09T09-30-52-308Z-d9cd9f/organizer-rehearsal-failed-de-fe5d23e17fe803064868ab818e1a39e4.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-30-52-308Z-d9cd9f/organizer-rehearsal-failed-de-fe5d23e17fe803064868ab818e1a39e4.json).

Earlier organizer rehearsal stopped at command 168/check 55: PARTICIPATION_UNCONFIRMED. Event check-in alone correctly failed match-attendance certificate authorization. Fixture corrected to record actual synthetic match attendance; latest organizer run passed.

Limit: Failure retained; its passing earlier checks do not convert the failed run to PASS.

Artifact SHA-256: `56b71f827b74874d1fc36ce0e2ec7dc5e28752975e11ecd9b849287e7590cdea`.

### Evidence TOURNAMENT

**PASS_LOCAL_ELIGIBLE_TOURNAMENT_SANCTION_EXPORT** — [artifacts/debate-local-rehearsal/2026-09-09T09-55-57-068Z-a4a2e5/positive-tournament-sanctions-export.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-55-57-068Z-a4a2e5/positive-tournament-sanctions-export.json).

Latest suite: 229 commands, two completed 14-stage finalized matches, two eligible frozen source results, one comparable group, all four awards. Raw A100/N92; declared 10-point A deduction yields official A90/N92. Raw performance awards unchanged. Three genuine private PDFs plus current-owner download and other-actor denial.

Limit: Synthetic local PGlite only; no real competition, hosted object storage, provider, mail, load or deployment.

Artifact SHA-256: `7217f10c64f324e14ea553f932f011579e84c35a643d0b464972bcfd7817859d`.

Permanent record: [docs/debate-room-v3/evidence/local-verification-20260909.json](../../docs/debate-room-v3/evidence/local-verification-20260909.json).

### Evidence PDF_QA

**PASS_TEXT_PAGINATION_AND_VISUAL_QA** — [artifacts/debate-local-rehearsal/2026-09-09T09-35-59-658Z-e17202/pdf-qa/checks.json](../../artifacts/debate-local-rehearsal/2026-09-09T09-35-59-658Z-e17202/pdf-qa/checks.json).

Agent visual-review manifest: all 17 pages across eight PDFs plus one CSV checked. Renderer SHA matches latest frozen suite; no clipping, overlaps, glyph defects or heading orphans reported. Manifest records individual object hashes.

Limit: Visual inspection was performed by the PDF reviewer agent. New suite output bytes can differ because event IDs and timestamps differ; no claim of visual inspection of every later regenerated byte sequence. Hosted download and inbox attachment parity remain open.

Artifact SHA-256: `6ab08b23450a1c9c3a1c7e256c7cbb97a9af7d0fb48cb28d700a9bcfca3ed0a6`.

### Evidence BROWSER

**HISTORICAL_PARTIAL_BROWSER_QA** — [artifacts/debate-local-rehearsal/2026-09-09T07-59-52-481Z-c1f4ba/browser-qa.md](../../artifacts/debate-local-rehearsal/2026-09-09T07-59-52-481Z-c1f4ba/browser-qa.md).

Actual Chrome with synthetic local identities covered saved setup, invite claim, prep start/pause, private scorecard refresh, export request and fixtures; observer privacy held. Later frozen-browser attempts were blocked by repeated CUA CDP Emulation.setFocusEmulationEnabled and Page.navigate timeouts in Chrome and IAB.

Limit: Not current complete browser pass, full 14-stage visual rehearsal, mobile, physical camera/audio or inspected browser-download destination. Tool failure is a verification gap, not product success or product failure.

Artifact SHA-256: `dea0b36902f7c6aa8326acaac9670b5a55ac25f833b3b4e0ec70f8c0ce4b0680`.

### Evidence TARGETED

**HISTORICAL_TARGETED_TEST_OBSERVATIONS** — historical task transcript, no standalone run manifest.

Task transcript recorded targeted service/domain/SQL/fixtures/roster/substitution/sanctions/tournament passes while fixes were developed. Applicable files are now independently covered by LATEST logs.

Limit: Earlier transcript-only counts are historical; use the current source-hashed suite for candidate test results.

### Evidence MEDIA

**LOCAL_DOUBLE_BASED_MEDIA_TESTS** — [artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/server-domain-database.txt](../../artifacts/debate-local-rehearsal/suite-2026-09-09T09-54-38.432Z/server-domain-database.txt).

Current server-media and delivery tests pass with installed SDK interfaces, local token signing and inert provider responses; client transition tests pass in the client-state-media-dates group.

Limit: No network traffic to the provider, consenting devices, GPU/camera compatibility, stale-token Cloud measurements or physical privacy proof.

Artifact SHA-256: `a7f963bb14fca0ae7c8d4edf61499ef95bfe5dd88eda86e111ec6fcbf2dd9e76`.

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

Permanent reviewed evidence package contains final source/log hashes, actual group counts, preserved broad failures and affected-file retests, local Pages and locked staging artifact checks, browser limits and nine synthetic output samples. This audit verified all nine sample byte hashes.

Limit: Packaged synthetic outputs and local artifact inspection are not deployment, physical-media, real mail or public launch evidence.

Artifact SHA-256: `b8b1de8257fe58d86a785009a198c93670b191a8b6e71f62f42b7798d4436398`.

### Evidence DB_PREREQ

**READ_ONLY_HOSTED_PREREQUISITES_LOCAL_FIX_VERIFIED** — [docs/debate-room-v3/evidence/staging-db-prerequisites.md](../../docs/debate-room-v3/evidence/staging-db-prerequisites.md).

SELECT-only catalog review found no new Debate/admission objects installed, documented existing Study migration-history naming drift and reproduced default service-role ACL risk. Local correction and five SQL tests pass.

Limit: No remote schema change or hosted transaction/rollback probe. Revalidate metadata drift before any authorized migration.

Artifact SHA-256: `dc346e940cea82f28041dca5072ee34d4b124d86f9773543f2760ae75a7baa5a`.

## Open acceptance and release gates

- **Current complete browser journey:** latest Chrome and in-app-browser attempts were blocked by repeated CUA CDP focus/navigation timeouts. Historical partial Chrome QA remains evidence only for its tested flow. Full frozen UI, mobile/320px, zoom, keyboard, screen reader, contrast, reconnect and real-account cohort checks remain open.
- **Physical media and endurance:** consenting independent camera/microphone devices, simultaneous questioning/responding, background effects, private-room leakage, controlled tab sleep/network failure, measured timer agreement and at least 90 real minutes of full-flow operation have not been verified. A synthetic clock advance or API journey does not satisfy these checks.
- **Capacity and spend:** no approved 10/25/50/100 participant ramp, measured provider overhead/reconnect headroom, concurrent event limit or cost evidence. 100 is a requested target, not verified capacity. New media stays disabled until configured verified limits, revocation assumptions and independent minute sweep operation are proved.
- **External delivery and persistence:** no actual approved-recipient inbox delivery, production email send, hosted private-object lifecycle, native multi-connection database load, hosted migration, backup/restore or live rollback proof. Provider/mail success doubles verify boundary behavior only. Proposed retention defaults require actual owner/operator approval.
- **Deployment and launch:** new migrations, Worker and Pages have not been deployed by this work. No new Debate deployment IDs, live SHA/asset/auth/navigation smoke or approved public launch are claimed. Read-only staging inventory and local release-gate tests do not fulfill deployment evidence.

## Historical failures and source boundaries

The certificate rehearsal failure is retained as CERT_FAIL: absence of match attendance correctly blocked issuance. The latest corrected fixture records attendance and passes. WORKER_HISTORY retains the broad 1,695-test run with two failures; root reported fixture corrections and full affected-file retests (65/65 index, 20/20 integration), rather than describing the entire broad run as clean. Earlier local suite and partial browser results are labeled historical. PDF_QA records reviewer inspection of eight PDFs / 17 pages and one CSV with the current renderer hash, not a claim that every later byte sequence was visually inspected.

The Debate SQL draft/migration hash is `89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c`. Study Room admission migration hash is `5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637`; the latest suite hashes its byte-identical draft and executes actual local admission SQL. These hashes are local preparation evidence, not proof of application to a remote database.

The permanent evidence package and nine hash-verified synthetic samples are repository files under evidence/. Raw artifact logs and earlier outputs may remain local/ignored; their hashes and paths are retained so historical failures remain traceable. The source attachment and existing Study Room repairs remain intact. No subscription/provider purchase, actual email send or remote database mutation was performed by this documentation audit.
