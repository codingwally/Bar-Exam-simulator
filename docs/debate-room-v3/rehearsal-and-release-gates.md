# Debate V3 rehearsal and release gates

Implementation resumed after superior outage clearance. The physical90-minute rehearsal, provider capacity/budget, approved test-mail delivery and deployment gates have not passed. Accelerated service rehearsals supplement these requirements.

## Evidence format

Every execution must record: acceptance/subrequirement IDs; UTC and Asia/Manila timestamps; frontend SHA/asset hashes; backend deployment ID/SHA; migration revision; test version/command; environment; account entitlement and event/match role; physical or synthetic device; exact observation; evidence file; PASS/FAIL/UNVERIFIED/BLOCKED; remaining gap.

Do not include credentials, real participant emails, private notes, invitation secrets, or provider tokens in logs. Use consenting screenshots and an event log. Do not record audio/video without separate consent. No absent result may be counted as a pass.

## Local deterministic and transactional tests

1. Timer: 5:00, 3:00, 0:01, zero duration, exact zero crossing, fractional milliseconds, +00:00, overtime >60 minutes; negative/nonfinite/overflow input denied. Pause, resume, finish and confirmed reset preserve attempt history. Next loads READY. Client clock skew and tab sleep do not accumulate drift. No zero-boundary media, scoring, polling or advancement side effect.
2. Controller: concurrent commands with one expected version accept exactly one; matching retry returns original receipt; altered replay payload is rejected; forged/expired controller denied; 30-second lease expiry leaves clock running; explicit takeover adopts its state. Measure healthy display agreement rather than infer it from formula tests.
3. Scoring: subtotals 70/75/80 plus closing 12 = 87; all maxima = 100; explicit zeros are complete and nulls incomplete. Compare integer hundredths with the saved rubric. Use equal displayed values with unequal exact totals to prevent rounding-derived winners. Majority 90/89, 90/89, 60/100 yields affirmative 2–1; aggregate yields negative. Client totals never become authority.
4. Ballots: unassigned, recused and competing accounts denied; one current ballot per judge/match/round; private draft refresh; losing response after commit; incomplete panels; score tie with reasoned choice; panel tie; one reconsideration round; unresolved progression; 15-minute correction window and unresolved protest blocking; amended result history.
5. Poll: open-time observer snapshot; exclude competitors/coaches/reserves/officials/judges; role-change invalidation; one current vote with revision/withdrawal; lost-response replay; close race; hidden running totals; 31/19 of 60 => 50 valid, 62%/38%, 83.33% turnout; empty/tied outcomes; no official winner/award/bracket coupling.
6. Fixtures: five teams => ten round-robin matches; non-power-of-two elimination with visible byes; side-draw reroll audit; duplicate time assignments denied; no score for bye/forfeit; no winner for double forfeit; no progression from provisional/unresolved results; downstream correction flags review.
7. Data: role-filtered snapshots and downloads, privacy-sensitive delivery reauthorization, RLS/client-role denial, actor-bound idempotency, same-transaction audit/outbox, independent event IDs, account switch/no-store, retention/legal hold, cleanup, recovery and additive rollback. Use controlled local fixtures before staging.

## Complete organizer rehearsal

Use a clearly labeled rehearsal event excluded from real competition, payment, marketing and analytics data. Use six distinct test debater accounts and one neutral multi-role organizer/moderator/timekeeper/judge; repeat formal-flow coverage with three eligible judges. Include free, paid, expired, payment-pending and exhausted-trial accounts across the matrix. Use only approved test recipients for any mail test.

| Step | Action and required observation | Evidence |
|---|---|---|
| 1 | Enter separate desktop and mobile Debate Room navigation; refresh direct route; sign out/in returns to exact event. | Navigation/screenshots/API status |
| 2 | Free member creates single match; autosave acknowledged; five private motions and next-match fixture available. | Saved event/match revisions |
| 3 | Invite/code claim, revoked/expired invitation failure, check-in, seat proposal/confirmation, neutral judge assignment and conflict handling. | Redacted receipts/roster |
| 4 | Confirm three speakers per side, captain/closing assignment, exact shared rules acknowledgment and private motion. | Frozen rules/version and readiness |
| 5 | Release motion simultaneously; 15-minute team preparation in genuinely separate rooms. Attempt adversarial subscriptions/snapshots from observer/opposing team. | Grants, denied access and received media observations |
| 6 | Complete A1, N1/A1 questioning, N1, A1/N1 questioning, A2, N2/A2 questioning, N2, A2/N2 questioning, A3, N3/A3 questioning, N3, A3/N3 questioning. Constructives 5 minutes; all six question periods 3 minutes with both participants audible. | Per-stage attempts, timer and source-specific grants |
| 7 | Run declared 5-minute private break; then negative and affirmative closings, 5 minutes each. Make one stage visibly overrun without automatic action. | Attempt durations and overtime screenshot |
| 8 | Exercise help/ruling queue, moderator technical pause, controlled reconnect, Back/Repeat attempt and permission-failure recovery without score duplication. | Incidents, receipts, media/state observations |
| 9 | Separate judge deliberation; recover private drafts; submit complete scorecards/ballots; observe counts without leaking preferences. | Private own-scorecard and authorized completion count |
| 10 | Open/close/publish optional audience poll with its own state; check role exclusions, revisions and separation from winner. | Poll receipts and published count |
| 11 | Publish provisional results; permit procedural protest; wait the real 15-minute window; dispose protests; explicitly finalize. | Result versions/timestamps |
| 12 | Review correct Best Speaker, Interpellator, Rebuttal Speaker and Debater awards; show ties/eligibility and own released feedback. | Versioned results/award screenshots |
| 13 | Generate selectable rules PDF, own scorecard, authorized result PDF, event report, safe CSV and optional valid certificate; preview mail, approved test send, retry receipt. | Files/version parity/receipt; inbox delivery separately |
| 14 | Advance to next authorized match; preserve prior attempts/ballots/results; explicitly join new media session. | Prior/new match IDs and retained result |

The timed debate is 58 minutes, or 63 with the break; initial prep adds 15. Setup, transitions, judging, the correction window and overtime add more. The actual continuous rehearsal must last **at least 90 minutes** and include the full default flow. Accelerated deterministic tests cannot meet this gate. Do not promise a 90-minute maximum or shorten the default periods to fit a test window.

## Physical media and browser gates

Record actual browser/OS/version/device, resolution, frame rate, received moving frames, intelligible speech each direction, independent screen-share audio, loss/freeze/reconnect count, bitrate and available latency/resource diagnostics. A token, track state or local meter is not remote media proof.

Use a physical camera and microphone at each end for the representative two-way check; label all synthetic clients. Test Chrome, Edge, Firefox, Safari, Android Chrome and iPhone Safari where available. Emulation is a layout check only. Perform 20 or more background changes (None/Blur/supported image), repeated open/close, rapid changes, restart/device switch, share/unshare, leave/rejoin and processor failure. Confirm no raw-background fallback without consent.

For each absent physical browser/device, keep UNVERIFIED and provide the exact join link and role-specific steps once a protected candidate exists. Do not request people to test an unfinished route or use real meetings as a load environment.

## Capacity and spending gate

Before any provider test, verify actual account plan, region, concurrent project allowance, existing Study Room commitments, remaining participant-minutes, downstream transfer, subscription limits, storage and API limits. Record provider deployment type and installed SDK compatibility. No purchases, quota upgrades, recordings or new providers are authorized.

The requirement is 100 connected participants including all officials, not 100 observers plus officials. Private-space migration replaces the old session; account for reconnect overlap/headroom and all Study Rooms. If the safe limit is lower, state it and retain the 100-person gap.

Ramp 10 → 25 → 50 → 100 only within an approved resource budget and isolated empty environment. Record participant count, active cameras, actual visible subscriptions, screen share, simultaneous questioning pair, private transfers, duration, state/clock latency and media observations. Stop before exceeding the approved cap or affecting active meetings. No pass based on lowered participant limits or hidden observer-camera restrictions.

Planning arithmetic only: 100 × 63 minutes = 6,300 participant-minutes; 100 × 80 = 8,000. These are not measured consumption or peso quotes. Current published Build allowances are not evidence of this account's plan or remaining usage. [LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/).

## Release gates and truthful handoff

Implementation and controlled testing are authorized; public launch is not evidenced. An email requesting Gilmar's approval does not establish approval. Finish a protected preview and release-ready build, then apply any later explicit owner launch authorization. Do not send a launch approval request or real invitations without authorization to send.

Release uses the reviewed existing pipeline with explicit scope, exact candidate SHA, frontend/backend artifacts, additive migrations/config, protected environment and staging proof. The current Study Room-only workflow does not authorize a new Debate Room release. Prepare an isolated reviewed release extension without broadening unrelated file allowlists or weakening CI.

After authorized deployment, verify both actual desktop/mobile navigation and direct refresh with free and paid accounts. Confirm frontend/backend SHA and asset hashes, feature flags, sign-in return, cache update and backend membership neutrality. A private flag is a preview, not public delivery.

Final handoff must separately state implemented / committed / merged / deployed / live verified. Include exact URLs and navigation, SHAs/deployment IDs, completed ledger, failures/gaps, physical versus synthetic evidence, timer/score/results screenshots, authorized sample exports, actual capacity and cost assumptions, organizer help, monitoring and recovery instructions.

Rollback must preserve competition records and active Study Room sessions: disable only the newly introduced Debate entry when necessary, restore known frontend/backend artifacts through the established workflow, preserve additive data/audit records, and reconcile pending provider/outbox jobs. Do not drop historical rows or roll back unrelated outage fixes.
