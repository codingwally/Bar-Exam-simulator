# Private moderator invitations and linked rematches

Local implementation proof only. No real media provider, device, email, or public deployment was used. Full protocol tests use the actual service command reducer with the explicit test MemoryStore and an in-process confirming media adapter. Independent service-role SQL/PGlite tests cover persistence, CAS, idempotency, RLS, job claims and media revocation; they are not physical provider evidence.

## Current contracts

- invite_private_room: matchId, space (affirmative/negative/judges), optional moderatorId (defaults to assigned moderator), nonempty reason, confirmed:true.
- The invitation must be issued by that side's current captain during preparation/break or an assigned judge during deliberation. The guest must be the admitted, checked-in, neutral assigned moderator. Organizer status alone gives no invitation power or private audio access.
- The returned invitation has id, space, moderatorId, invitedBy, reason, phase, exact stageAttemptId, createdAt and revokedAt. Participant snapshots add ACTIVE/EXPIRED/REVOKED. Invitation reasons and revocations are deliberately visible; private judge notes, scorecards, historical team chat and evidence are not included in this media grant.
- revoke_private_room_invitation: matchId, invitationId, reason. The room's captain/judge, invitee or organizer may revoke. Authorization fails immediately and a durable leave operation retires the provider session. A new stage attempt, loss of relevant membership/assignment, or event completion expires permission. An old invitation cannot revive when a stage is replayed.
- create_rematch: matchId, reason, confirmed:true, optional title and existing event motionId. Only an organizer may schedule after the one audited same-panel reconsideration is closed and still unresolved. An unresolved procedural protest must first be resolved.
- Source ballots and attempts remain unchanged, its visible result remains Unresolved, and source mutation commands are locked. A fresh match has empty acknowledgments, device checks, attempts, drafts and ballots and must pass the ordinary readiness and all-stage workflow.
- Source snapshot links rematchId/rematchReason; child links rematchOf/rematchReason. The receipt supplies matchId, rematchOf, unresolvedResultId and fixtureId.
- A bound fixture explicitly changes its current match binding with rematchHistory retaining previous match, result version, motion and start time. It becomes Scheduled with no winner. The original match keeps originalFixtureId. No descendant participant is advanced. Only the rematch's finalized valid winner and explicit advance can resolve the bracket.
- tieResolution exposes method:same_panel_reconsideration_then_rematch and predeclaredTiebreakJudge:null. No tiebreak adjudicator is configured by default or offered by the product. create/update/amend rules reject hidden tiebreak fields; the pure domain's optional adjudicator resolver is not an advertised configuration path.

## Verification

worker/debate-procedures.test.mjs includes seven focused tests: explicit room authorization, private text separation, immediate revocation and durable leave, exact-phase/attempt expiry including untimed deliberation, full fourteen-stage tied match + reconsideration + full fourteen-stage rematch and finalization, unchanged unresolved original and blocked downstream fixture, and hidden tiebreak configuration rejection. Domain plus procedures passed55/55 after the declaration hardening. The broader previous domain/fixture/procedure/service/tournament/media/SQL run passed116/116 before the final two additional procedure cases.

Browser QA evidence and honest remaining browser/device gaps are in artifacts/debate-local-rehearsal/2026-09-09T07-59-52-481Z-c1f4ba/browser-qa.md. The new procedure controls still require the parent's fresh frontend build and final UI rehearsal; they were not included in that earlier browser pass.
