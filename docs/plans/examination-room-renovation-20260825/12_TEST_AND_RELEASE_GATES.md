# Test and Release Gates

## Release posture

Current status is **NO-GO**. A passing unit suite or visual walkthrough cannot change that decision. GO requires every blocker below to pass against a recorded production-like build and migration set, all evidence to be linked in one immutable manifest, an independent audit, and explicit dated approval from Wally. No implementer, Codex session, CI job, or vendor may self-certify the release.

## Evidence manifest

Record repository commit, frontend asset hashes, service-worker/cache version, Worker build/version, database project and applied migrations, feature flags, renderer versions/fonts, email provider/template/DNS configuration, Gemini model/project/config where enabled, environment/time zone, fixture hashes, device/browser/assistive-technology versions, load topology, test start/end, raw results, incidents, known deviations, reviewer, and owner decision.

Evidence must distinguish fresh execution from historical documentation. Screenshots do not replace assertions, file opening, database checks, or human observation.

## Gate sequence

1. **G0 — Plan and traceability:** approved decisions, flow IDs, invariants, data mapping, and tests exist before state logic changes.
2. **G1 — Unit/static:** schemas, parsers, reducers, state transitions, formatting, accessibility/static rules.
3. **G2 — Database/authorization:** migrations, constraints, RLS/RPC ownership, idempotency, revisions, audit, rollback compatibility.
4. **G3 — Worker integration:** real route/auth/RPC/job/renderer/provider-test paths with failure injection.
5. **G4 — Browser journeys:** supported browsers/devices with real storage, network changes, refresh, multiple tabs/devices, and service worker.
6. **G5 — Artifact and delivery:** real PDF/workbook open, browser print, controlled inbox, provider event replay, portal fallback.
7. **G6 — Accessibility/security/privacy:** WCAG 2.2 AA, assistive technology, adversarial authorization/file/AI tests, retention review.
8. **G7 — Performance/resilience:** supported 200/100 envelope, shared NAT, bursts, reconnect, rollback, and 500/200 stress characterization.
9. **G8 — Uncoached human acceptance:** Professor/Student profiles, realistic content, at least five repeats per critical flow/failure condition.
10. **G9 — Independent release review:** fresh auditor checks manifest and reproduces high-risk gates; Wally decides GO/NO-GO.

Failure at any gate stops downstream release activity. Fixes rerun the failed gate, all dependent gates, and a defined regression subset; a blocker can never be waived by a screenshot or schedule pressure.

## Unit and static tests

- Legal/illegal examination, attempt, grade, release, job, and amendment transitions.
- Idempotency/duplicate command, expected revision, command receipt, and unknown-outcome logic.
- Answer/flag/grade operation journals, ordering, hashes, conflicts, retries, and merge rules.
- Timing ledger with pauses, overlapping/selected extensions, client skew, time zones/DST, zero/auto-submit.
- DOCX/text-PDF deterministic extraction, field provenance/uncertainty, bounds, corrupt/adversarial formats.
- Assistant Proctor closed schemas, allowlist, confirmation classes, prompt-injection separation, malformed/extra arguments.
- Result packages, totals, privacy redaction, filenames/MIME/signatures, formula-injection neutralization, leading-zero IDs.
- UI state-to-plain-language mapping, circular navigator combinations, forbidden internal terms, accessibility semantics.

## Integration and database tests

Trace Browser → local store → Worker route → auth → RPC/database → response → visible state for create/import/approve/publish, both access modes, wait/start, answer/flag, submit/receipt, monitor/intervene, early grade/save/conflict/finalize, preview/release/amend, email/export/AI jobs, and archive.

Database tests assert owner/class/candidate scope; exactly-one-writer lease; immutable publication/submission/grade-release history; no active-answer grading; per-generation operations; idempotent submission/release; timing ledger correctness; queue lease/stale reclaim/event precedence; audit completeness; and foreign-key/transaction behavior on injected failures.

Migration tests use production-scale anonymized fixtures and cover forward deploy, old/new app compatibility, rollback/disable, partial migration failure, and no destructive rewrite of active records. A schema migration that cannot coexist with active attempts is prohibited during the protected window.

## Authorization and security tests

Use Professor owner, other Professor, revoked Professor, optional Beadle, Student, wrong Student, anonymous user, Wally/Admin normal, and break-glass sessions. Attempt direct ID substitution, cross-class/cross-owner access, stale/replayed confirmation, mass assignment, forged role, service-role leakage, public source/artifact URL, shared-NAT rate-limit evasion/false blocking, CSRF/session fixation, XSS from imported content, formula injection, unsafe file archives/PDF objects, and prompt injection through questions/answers.

Pass means no existence/data leak, no Beadle answer/grade access, no Assistant Proctor bypass, no Gemini or service-role secret in browser/build/log, minimum monitoring payload, exam-scoped authorization, auditable session expiry/transfer, and a reviewed retention/deletion/incident-evidence path.

## Browser and recovery tests

Supported Chrome/Edge/Safari-equivalent policy must be owner-approved. For laptop/tablet/permitted mobile, test keyboard and pointer/touch; fresh/returning browser; refresh/hard close/logout; storage persistence and quota; offline/weak/flapping network; timer drift; two tabs/devices; waiting/open/pause/resume/extension; conflict; submission response loss; reopen generation; active client during frontend/Worker/SW update and rollback.

Assertions must inspect visible status and authoritative DB/receipt state. Specifically regress H01 download/grading, H07 flag, H12 save clarity, H19 dashboard return, H20 interruption/device, and every other H-ID in the root-cause matrix.

## File-open tests

For printable exam, submitted answers, Q&A, grades/comments, class/selected workbook, individual result, receipt, and audit manifest verify:

1. Correct status, MIME, magic signature, extension, and filename.
2. Open in standard browser PDF viewer/Adobe Reader and current Excel/LibreOffice equivalent as approved.
3. Required non-empty semantic content, correct totals/order/page count, no blank/unusable pages.
4. Long/Unicode/legal-citation/table/page-break behavior and font availability.
5. Only selected identities/content; formula injection neutralized; leading zeros preserved.
6. Bounded 1/20/50/100/200/500 Student and 1/20/50/100/200 question behavior.
7. Regenerate, failed-job message, readable web view, browser print, incident ID.
8. Before/after authoritative exam/attempt/grade/release hashes and revisions identical; grading remains available.

Mock bytes are insufficient. Store artifact hashes and application-open evidence.

## Real-email tests

Use controlled real inboxes and provider webhooks for Professor invitation, Student access notification, and result-release notification. Exercise accepted/delivered, delayed, provider rejection, invalid address, bounce, complaint, Worker crash after claim/send, stale lease reclaim, duplicate webhook, out-of-order event, bounded retry with jitter, permanent failure, address correction, and manual retry.

Assert one domain event/portal version, no duplicate unintended message, accurate Professor-visible precedence, immediate portal access with provider disabled, and complete attempt/event history. Mock delivery alone cannot pass.

## Accessibility tests

- Automated rules plus manual keyboard-only Professor creation/import/publish, Student access/exam/review/submit, one-page/question grading, preview/release, Assistant Proctor, dialogs/errors/recovery.
- Screen readers on owner-approved Windows/browser and mobile/tablet combinations; headings/landmarks/labels/descriptions/tables/live regions.
- Visible/unobscured focus, 44px targets, arrow-key circular navigation, no color-only state, high contrast/forced colors, reduced motion.
- 200% and 400% zoom as applicable, 320px reflow, text-spacing overrides, portrait/landscape, long names/prompts/answers.
- Save/flag/timer/pause/extension/error/submission announcements without focus theft.
- Assistive editor input, selection, copy/paste/context menu, voice input where available, authentication without cognitive barrier, accommodation/time-warning behavior.

Pass WCAG 2.2 AA with zero unresolved A/AA blocker. Any integrity restriction that breaks ordinary browser/assistive behavior fails unless necessity, lawfulness, exception, and equivalent access are independently approved.

## Load and resilience tests

Test Students 1/20/50/100/200 and characterize 500; questions 1/20/50/100 and characterize 200. Required scenarios: shared-NAT entry, autosave burst, reconnect replay, final-submission burst, large DOCX/text PDF, large monitoring, one-page grading, class release/email burst, PDF/workbook generation, and Assistant Proctor burst.

Launch target is 200 simultaneous Students/100 questions. Under this load: no lost/duplicated operations or receipts; authorization/rate limits remain correct; visible local save ≤1s; normal server confirmation and control receipt p95 ≤3s; monitor is timestamped and operationally useful; queues recover; user-facing APIs are not starved by AI/renderers. Establish explicit throughput/latency/error budgets from baseline before implementation; 500/200 is a non-marketed stress target until it passes equivalent gates.

## Human testing

Professor profiles: technology-comfortable; average ability; Google Forms user; high-volume essay grader; laptop; tablet. Student profiles: laptop/tablet/permitted mobile; strong/weak/temporary-offline; refresh; duplicate/lost device; accessibility needs.

Use realistic law-exam content, realistic class data/size, real grading, real PDF/Excel applications, controlled inboxes, real network interruption, refresh, recovery, and no developer coaching. Each critical flow is repeated at least five times across relevant devices/failure conditions. Observe completion/time-to-first-draft/time-to-publish, wrong turns, support interventions, save-state comprehension, task SEQ, SUS, and critical-error rate.

Targets: ≥90% first-time Professors identify next action within 10s and publish sandbox uncoached; Student entry median ≤60s after sign-in and start ≤2m including preflight; SEQ ≥6/7; SUS ≥80; ≤1 critical wrong turn per end-to-end task; zero destructive ambiguity/data loss; 100% understand local versus server save and authoritative receipt. Every observation becomes a permanent regression test.

## Release-blocking acceptance checklist

### Professor

- [ ] P01 Professor reopens an owned exam without old email or key.
- [ ] P02 Professor creates an exam manually.
- [ ] P03 Valid DOCX import creates a reviewable complete draft.
- [ ] P04 Valid bounded text PDF import creates a reviewable complete draft.
- [ ] P05 Gemini failure does not block creation.
- [ ] P06 Professor approves every AI-structured question.
- [ ] P07 Professor publishes without a Beadle.
- [ ] P08 Email failure does not block publication.
- [ ] P09 Professor grades an early submitter while class remains open.
- [ ] P10 Professor grades one Student on one page.
- [ ] P11 Every grade save has accurate visible status.
- [ ] P12 Refresh does not lose saved grading work.
- [ ] P13 Download does not disable/change online grading.
- [ ] P14 Professor previews the exact Student result.
- [ ] P15 Professor releases one Student and the whole class.
- [ ] P16 Email failure does not remove portal access.
- [ ] P17 Professor amends a released grade with immutable history.

### Student

- [ ] S01 Student enters through a clear flow.
- [ ] S02 Student understands identity requirements.
- [ ] S03 Questions/answers use Times New Roman.
- [ ] S04 Workspace is light and readable.
- [ ] S05 Circular question navigation works accessibly.
- [ ] S06 Flag persists across navigation and refresh.
- [ ] S07 Local save works and is accurately labeled.
- [ ] S08 Server sync works and is accurately labeled.
- [ ] S09 Offline typing is preserved.
- [ ] S10 Reconnection does not overwrite newer work.
- [ ] S11 Final review shows actual questions and answers.
- [ ] S12 Submission is idempotent.
- [ ] S13 Student receives an authoritative receipt.
- [ ] S14 Student later views released results in the portal.

### Reliability

- [ ] R01 Every required download opens.
- [ ] R02 No download mutates exam or grade state.
- [ ] R03 Email jobs recover after Worker failure.
- [ ] R04 Delivered status does not regress.
- [ ] R05 Active attempts survive frontend rollback.
- [ ] R06 Active attempts do not depend on Gemini.
- [ ] R07 Active attempts do not depend on email.
- [ ] R08 Shared-NAT classroom is supported.
- [ ] R09 Simultaneous submission burst is tested at supported load.
- [ ] R10 Database authorization isolation passes.
- [ ] R11 No unrelated Due Diligence feature regresses.

### Assistant Proctor

- [ ] A01 Read-only commands are permission checked.
- [ ] A02 Navigation commands use allowlisted routes.
- [ ] A03 Mutating commands require explicit server-bound confirmation.
- [ ] A04 Gemini cannot bypass the server.
- [ ] A05 Gemini failure leaves ordinary UI functional.
- [ ] A06 Assistant Proctor cannot access another Professor's records.
- [ ] A07 Assistant Proctor cannot autonomously grade or release.

## Stop conditions

Stop release immediately for any lost/overwritten acknowledged work; missing/incorrect submission or release receipt; unauthorized/cross-owner access; blank/corrupt/private-data-leaking file; export state mutation; portal result unavailable after release; false save/release status; active-attempt protocol incompatibility; unresolved WCAG A/AA blocker; shared-NAT/rate-limit failure; controlled-email state regression; failed rollback rehearsal; missing evidence/version correlation; human critical-error recurrence; or unapproved plan divergence.

## Rollback rehearsal

In a production-like environment with active Students, pending offline answer/flag operations, a grading draft, queued email/export jobs, and mixed old/new clients:

1. Deploy a deliberately detectable bad but non-destructive frontend/Worker fixture.
2. Detect it, stop new entry, freeze rollout, and record versions/incident.
3. Pin active clients; route new loads to last-known-good compatible release without clearing storage.
4. Roll back frontend and Worker independently; keep database migrations forward-compatible or disable new paths safely.
5. Verify old/new clients can save, sync, flag, time, submit, retrieve receipt; Professor can monitor and grade; jobs recover separately.
6. Reconcile every pending operation/command receipt and assert zero domain data loss/mutation beyond intended actions.
7. Have an independent reviewer repeat the critical path and sign the evidence.

Any forced reload, IndexedDB clearing, incompatible active-session protocol, missing receipt, or unexplained revision blocks release.

## Final GO decision

The independent reviewer signs only what the evidence proves and lists every deviation. Wally reviews business/support/privacy readiness plus technical evidence and records GO or NO-GO with date, supported scale, versions, and conditions. Feature completion is never inferred from this plan; it must be established by the future evidence manifest.
