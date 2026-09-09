# Independent UI/service contract review

Read-only review of assets/debate-room.js against the current service reducer, domain functions and authorized snapshots. No frontend edits by this reviewer and no live provider/browser pass implied by source review.

Confirmed compatible contracts: event contact and timezone schedule; invitation creation and one-time secret handling; recipient-bound invitation preview/send; operator-only retention inputs; paginated message cursor; simple/full draft and scorecard decimal-to-hundredths handling; Audience Choice result shape; per-match and tournament award names/eligibility; fixture binding and reviewed publication; private moderator invitations and explicit linked rematches.

Actionable findings sent to the frontend owner:
1. Cohost organizer controls were absent because official() only checked match IDs. Separate operational official and panel-admin predicates were required.
2. Recusal while another panel was visible retained private judge content in hidden DOM. Sensitive views must clear on authority changes.
3. In-flight history/download requests could reintroduce content after authority revocation. A view generation must invalidate old responses.
4. Roster, captain, closing assignment or rule-version changes could leave dirty old scoring forms attached to a new participant context. These changes must cancel stale saves and require review.
5. A stable seat tile retained its old video when its media identity changed, risking an old camera under a replacement name.
6. Round-robin idle-slot team names were inserted into HTML without escaping.
7. Captain proposal name/school should prefill the organizer's review.
8. Retry was shown for queued jobs although service only retries failed jobs; cancellation must not be offered for mandatory media revocations.
9. Rematch and private invitation/revocation controls should match current actor, phase and status guards.
10. A removed participant receives NOT_MEMBER/403 instead of a filtered snapshot. The rejection path must close local media and clear the active event while retaining valid global sign-in.

At the latest source inspection, fixes for items1–6 were present: host-inclusive official(), separate panelAdmin(), clearSensitiveViews(), viewGeneration checks, scoring-context signature, video detachment on identity change and escaped idle text. Remaining edits were being handled by the frontend owner. These fixes still require the latest combined browser rehearsal.

Backend follow-ups communicated to its owner: immediate media permission refresh after observer-camera rule changes; no hidden reopening of completed events with stale retention endsAt; cleanup of new private draftHistory and official rosterHistory. The owner reported these implemented with its corresponding tests.

## Roster integrity changes implemented here

propose_roster validates three distinct active registered event members, rejects cross-team duplicates and requires its captain among the three. It preserves proposed name/school for organizer review without changing the confirmed roster.

confirm_roster rejects structural changes during an in-progress locked match. For setup matches it updates seat identities/captain, keeps the same closing participant when still present, increments ruleVersion and clears both captain acknowledgments, device checks, accommodations and current score drafts. Previous drafts remain in private draftHistory until chat retention. Named public incidents disclose the change. Locked historical matches remain unchanged and future matches use the new event roster.

Receipt: {teamId, updatedMatchIds, acknowledgmentsRequired}.

worker/debate-rosters.test.mjs passes5/5, including validation failures, refreshed readiness, frozen active matches, atomic rejection of judge/speaker conflicts and deep-equal preservation of a finalized historical match. Roster + procedure + fixture suites pass23/23. These are actual service command tests with the explicit test MemoryStore; separate PGlite tests provide persistence evidence.

Current local runtime RPC allowlist also includes upload reservation/read/complete/fail and debate_v3_expired_jobs. It will take effect at the coordinated resume restart, preserving the saved browser fixture.
