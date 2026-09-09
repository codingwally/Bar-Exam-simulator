# Debate Room V3 review receipt — 9 September 2026

**The implementation is a draft candidate, not a completed acceptance or a launch.** [Draft PR 356](https://github.com/codingwally/Bar-Exam-simulator/pull/356) is the review handoff. The authoritative requirement ledger contains 315 individually mapped rows; local checks do not clear its external acceptance gates.

The first application change removed Study lobby pictures in `6431715`. Ordinary Study rooms now have All users (the default), Paid users, Admins and Admin approval. An authorized administrator must be inside the exact room to admit a waiting entrant. The private Inner Chamber restriction remains. These changes are source changes and have not reached the live site.

The superior outage/pricing task retains priority. Its recovery commit `3a9f46b54ca4f926440e402e3831e578ffcb2022` is incorporated by merge `9053390cb4f69da7627e0f079ebbbb3f0da0ea1d`. Recovery assets and pricing implementation are unchanged. No recovery preview, DNS, backup, production deployment or shared staging configuration was altered by this task.

## Reviewable evidence

The [permanent local evidence](evidence/local-verification-20260909.json) records the current thirteen-group combined suite, source hashes, actual log hashes, earlier failures and affected-file retests, artifact checks and PDF/CSV QA. The source report records the checkpoint HEAD and separately hashes the then-uncommitted changes; it must not be represented as clean committed or hosted evidence. The release workflow requires a fresh clean exact-commit run.

Checks cover the actual service and SQL transaction paths, authorization, private rooms, default timed stages, ballots, sanctions, correction, fixtures, tournament eligibility, exports, client navigation/account changes, media state and Study admission. An actual Worker test reproduces a browser's same-origin GET without an artificial Origin header, while retaining bearer and preview authorization. The shared maintenance contract verifies the original two-minute schedule alongside the new Debate-only minute schedule. Fresh test-generated tournament output is written to ignored evidence, preserving the tracked historical sample and a clean release checkout.

The build contains 177 public Pages files; the sanitized staging artifact contains 176 files and 18 verified critical asset hashes. Forecast lifecycle and retired-feature/Simulator boundaries passed. Actual synthetic export jobs produced all six output types. Visual inspection covered 17 pages across eight PDFs; text, pagination and file hashes passed. The [sample exports](evidence/README.md) contain synthetic participant data only.

The [rollback probe](evidence/staging-rollback-probe.md) embeds both exact migration bodies. Local transaction/rollback and five negative cases passed with the documented local PostgreSQL version and authorization-helper fingerprint adaptations. No hosted execution occurred. The connector's DDL routing does not provide the required single-connection rollback transport, and applying a ledger migration is not a substitute.

## Remote CI history

The first pushed candidate is `7be9f9d17831ef430a355589fa47e8b76421375a`:

- [Debate validation 34338121568](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121568) passed its then-current twelve groups and artifact checks. CI checked out synthetic PR merge `350b309cdd757ccd9123200736cf486fd89c13fb`; its tree `b3c357bc4b3e3baa05a46c6e3f709e069c20b1a4` equals the candidate tree. This is not a deployment.
- [Shared validation 34338121570](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121570) failed an obsolete literal cron assertion. The current test requires the exact intended production and staging arrays, preserving the original maintenance trigger. Its four focused tests and twenty Debate integration tests passed locally. A later green run must identify its own candidate.
- [Temporary media transfer 34338121602](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/34338121602) failed when an existing narration URL returned HTTP 404. That workflow is unchanged from the recovery base; the failure is separate and has not been repaired or waived by this task.

Current successor CI results belong in the PR's check records and review update, with the exact candidate/tree. These historical runs do not attest to a later source revision.

## Remaining acceptance and release gates

The local server was resumed with current source and the saved synthetic rehearsal; HTTP availability and saved state passed readback. An intervening full-suite run then passed twelve groups but failed the organizer process with a Node out-of-memory error. Only this task's local server was paused, preserving its saved data, and all thirteen groups passed on the unchanged-source rerun. The failed report remains in the evidence record. The local server is currently paused to conserve memory.

Browser control repeatedly failed with CDP focus/navigation timeouts on Chrome and the task-owned in-app tab. Earlier browser evidence covers only the documented partial actions; it does not establish a complete current organizer or Study waiting-room walkthrough.

Still required are approved staging test-account sessions, a complete current Cloudflare version/configuration baseline, hosted migration and privilege/rollback proof through a supported transport, exact-version deployment and authenticated hosted end-to-end checks. The current staging environment has no platform approval protection rules; source/configuration gates and the owner's actual authorization remain necessary.

Full acceptance also requires at least 90 minutes of real continuous default-flow rehearsal with physical cameras, microphones and independent screen-share audio; the physical browser/device matrix; verified provider allowances and current Study commitments; the approved 10/25/50/100 capacity ramp; and approved mail acceptance plus inbox delivery. The proposed retention operating policy and public launch still require the owner's approval. No elapsed wait, synthetic clock or passing CI substitutes for those gates.

No hosted migrations, bucket creation, provider connection, real email, recording, staging/production deployment, upgrade or new spending has been performed. The feature is not live.
