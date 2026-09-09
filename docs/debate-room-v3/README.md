# Debate Room V3 candidate

## Current publication request — 10 September 2026

The owner explicitly authorized public access for every signed-in member, paid or unpaid, with a separate Debate Room link beside Study Room. The earlier admin-only preview interpretation is superseded. Publication and full acceptance remain distinct: the owner requested access while implementation continues. [Publication requirements and current evidence](publication-20260910.md) track the public entry, professional copy, desktop layout and remaining rehearsal gaps. [Production database evidence](evidence/production-database-20260910.json) verifies both additive migrations, preserved Study records, rollback-only checks, permissions and private bucket configuration. Worker and Pages publication are not yet claimed.

## Earlier verification history

Restricted staging is deployed and configuration preservation passed; its authenticated smoke failed before authorization checks. Implementation and verification remain in progress. PR 356 merged the implementation to main 30a90e85b56b72c8da53b857e70b2db428809eb3; PR 357 merged the narrow fixture-client correction to f0c4d6be4203d0a3688521694145d86a0462f2a4. The separate restricted staging deployment is recorded below. Neither repository merge nor staging release establishes production deployment or public launch. Full acceptance and public launch remain open.

[PR 358 candidate 85193a75](evidence/ci-validation-85193a75.json) passed all 13 suite groups, build, both synthetic browsers, all 11 actual Wrangler serialization checks and shared validation; 126 source hashes match the exact tested Git tree. [New browser evidence](evidence/browser-ci-85193a75.json) retains 156 Debate checks / 196 actions / 16 stages/six downloads and Study 5 HTTP + 9 DOM checks. Root reviewed exactly two 1365px / 320px screenshots with the bundled fonts; controls remain above the arena and headings, with narrow content wrapping within the viewport. Historical 147bb582 review is preserved. **The overall CI run remains failed:** [native PostgreSQL 17.6 testing](evidence/native-cleanup-ci-85193a75.json) stopped after 15 successful checks on a harness restore-expression error 42725, before contention and positive final-deletion tests. Its correction and the new hosted lifecycle gates need their own candidate CI; no hosted cleanup or full acceptance is inferred.

The owner adopted the complete V3 attachment (SHA-256 `14ddbb8173dc27c2ab869f593f4315989c33b88be1bf4e0f94d8f98ad121ab09`). Its MD and TXT copies are byte-identical. Later direct owner instructions give the outage task priority, require Study lobby picture removal first, and add ordinary Study room audience choices with All users as the default. Private Inner Chamber restrictions remain.

The first application change is image-removal commit `6431715`. Recovery commit `3a9f46b54ca4f926440e402e3831e578ffcb2022` is incorporated by merge `9053390`. The superior task lifted its incident hold and confirmed that public-launch, spending, capacity, and rehearsal gates still apply. Its recovery preview, DNS configuration, and backups remain unchanged.

## Review and evidence

- [315-row requirement ledger](requirement-to-test-ledger.md) and [complete source inventory](requirement-inventory.json).
- [Verification index](verification-index.md): local tests are separate from real media, hosted database, and deployment proof.
- [Rehearsal and release gates](rehearsal-and-release-gates.md): complete organizer journey and focused procedures for each unavailable external check.
- [Operations and release plan](operations.md): flags, migrations, privacy, scheduling, monitoring, and rollback.
- [Synthetic sample exports and local evidence](evidence/README.md).
- [Draft review receipt and remaining acceptance gates](review-receipt.md).
- [Restricted staging package](../debate-v3-staging-release.md) and [read-only target inventory](staging-inventory.md).
- [Backend API contract](../../worker/debate-backend-contract.md).

## Current verification

[Candidate CI evidence](evidence/ci-validation-147bb582.json) binds all 13 passing suite groups and 92 source hashes to the exact tested Git tree. [Browser evidence](evidence/browser-ci-147bb582.json) records Debate's 156 checks, 196 commands, all 14 speaking stages plus preparation/break, six real browser downloads and next three-judge match startup. Study passed five HTTP/SQL and nine DOM checks, including same-room administrator admission and explicit member entry. The 1365px and 320px live controls were checked and visually reviewed.

These runs use isolated Linux browsers, synthetic identity/bootstrap and inert media. They do not verify real hosted sign-in, physical audio/video, a full second match, 90 real minutes, provider capacity or email delivery. [Successor ab35500b](evidence/browser-ci-ab35500b.json) separately passed its 13 groups and both browsers;147bb582 remains a historical screenshot-review anchor; the newer two-image font review is separately recorded above. The owner authorized autonomous selection/setup of isolated staging test identities; that routine question is resolved. [Both exact staging migrations and bounded hosted DML/privilege probes have now passed](evidence/staging-database-20260909.json). Active Worker configuration was captured read-only; service metadata verifies placement, and cache omission/full observability have a reviewed preservation adapter. Actual pinned-tool serialization and the later restricted deployment preservation passed; authenticated smoke and full hosted acceptance remain open. [Actual pinned Wrangler metadata evidence](evidence/wrangler-metadata-ci-2377d800.json) passed all 11 actual offline serialization checks at candidate 2377d800, preserving the targeted region, cache/exports omission and every captured observability field. This uses an inert Worker, not the full application bundle or deployed runtime.

[Successful two-actor preparation](evidence/staging-prepare-auth-34351971269.json) verified real ordinary staging sign-in, exact project sessions and POST {} Study access with the member response for both fixtures. Both were exactly deleted and their old sessions denied after Auth deletion. [Restricted deployment 34352333268](evidence/staging-deploy-34352333268.json) then deployed f0c4d6be4203d0a3688521694145d86a0462f2a4 as Worker version 1be1d9c5-af54-4f89-b48c-d941968849ab and passed actual configuration preservation. The run remains FAILED: its 112 ms smoke stopped on canonical HTML redirects before authenticated Debate checks. [Independent anonymous readback](evidence/staging-anonymous-readback-34352333268.json) verified all 18 asset hashes, public access disabled and unauthenticated events denied. Root independently confirmed zero Auth, session, role and owned debate_v3_events rows for the exact deployment fixtures. No authenticated Debate allow/exclude, full hosted organizer flow, production deployment or public launch is established.

[First failed preparation](evidence/staging-prepare-auth-34350885585.json) remains historical: the old GET Study access request failed 405 after one classified account signed in; exact cleanup and independent absence readback passed. PR 357 corrected POST {} and the ordinary Study member response (Auth role student). The member issue was discovered in source after the initial GET failure; the later successful retry observed it live.

See the [review receipt](review-receipt.md) for the remaining gates.

## Organizer quick start

1. Sign in and open Debate Room from the separate main or mobile navigation. The navigation becomes public only after the approved feature flag is enabled. A protected preview accepts only configured preview accounts.
2. Create the event, choose its timezone and schedule, and create revocable invitations. Admit waiting participants, confirm two teams of three speakers and their captains, and assign a neutral judge. The organizer may also be the neutral judge, moderator and timekeeper.
3. Add the motion and set up the match. Both captains acknowledge the same rules and sides. Participants check in and report an actual microphone check or accommodation. Readiness reports what is missing.
4. Release the motion, start preparation, and explicitly enter the correct private room. Camera and microphone begin off. Each device is enabled by its own participant.
5. Run the six alternating constructive/questioning pairs and the two closings. Take timer control, then start each ready stage. Finish and Next are explicit. At zero the clock counts red overtime; no automatic ruling or mute occurs.
6. Judges save private drafts and submit reviewed ballots. Complete the required award nominations and any runoff. Publish a provisional result, resolve procedural reports, wait the correction window, and finalize. Audience Choice has a separate poll and never changes the official winner.
7. Generate the permitted PDFs/CSV and optional organizer-issued certificate. Preview recipients before an authorized email. An accepted provider receipt does not prove inbox delivery.
8. Review/publish fixtures and prepare their exact assigned pairings. Advance only from resolved final records. Corrected predecessors trigger explicit review of affected later matches.

The local rehearsal harness is deliberately restricted to loopback and clearly labeled synthetic identities. It does not activate real media, mail, payment, marketing, or real competition standings. It must never become a public deployment configuration.
