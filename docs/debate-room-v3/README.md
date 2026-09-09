# Debate Room V3 candidate

Implementation and verification are in progress. Candidate `147bb582e3ed4f0136f5e46f7d9a67412b404630` passed the complete synthetic CI organizer and Study admission journeys. No staging or production deployment is claimed, and full acceptance/public launch remain open.

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

These runs use isolated Linux browsers, synthetic identity/bootstrap and inert media. They do not verify real hosted sign-in, physical audio/video, a full second match, 90 real minutes, provider capacity or email delivery. [Successor ab35500b](evidence/browser-ci-ab35500b.json) separately passed its 13 groups and both browsers;147bb582 remains the screenshot-review anchor. The owner authorized autonomous selection/setup of isolated staging test identities; that routine question is resolved. [Both exact staging migrations and bounded hosted DML/privilege probes have now passed](evidence/staging-database-20260909.json). Active Worker configuration was captured read-only; service metadata verifies placement, and cache omission/full observability have a reviewed preservation adapter. Actual pinned-tool serialization and hosted deployment remain open. See the [review receipt](review-receipt.md) for the remaining gates.

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
