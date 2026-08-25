# Examination Room Renovation — Executive Decision

Date: 2026-08-25
Decision owner: Wally / Due Diligence
Planning status: implementation-ready direction; no implementation authorized

## Product direction

Renovate Examination Room into a calm, light, formal law-school examination service that is as easy to understand as Google Forms while preserving stronger controls for identity, timing, answer durability, grading, audit, and result release. The normal Professor journey is one workspace: create or import, review, set rules, publish, monitor, grade, release, correct, and archive. The normal Student journey is one clear link: identify, wait if necessary, answer, review, submit, keep a receipt, and later view released results.

The portal is authoritative. Email is a notification channel. Downloads are read-only derivatives. Gemini and Assistant Proctor are optional helpers. None of those three systems may change or gate the authoritative examination, answer, grade, or release state.

## Current decision: NO-GO

The current product is **NO-GO for a real institutional examination**. The repository has valuable durability and authorization foundations, but real users have encountered release-blocking failures and the current tests do not prove the complete human workflow. Every release-blocking acceptance criterion in [12_TEST_AND_RELEASE_GATES.md](12_TEST_AND_RELEASE_GATES.md) must be evidenced before the decision can change.

No claim in this pack says a feature is complete. Scrimba is treated as target design evidence, not implementation evidence.

## Top risks

| Priority | Risk | Evidence / consequence | Required disposition |
|---|---|---|---|
| 1 | Flag state is local and session-epoch scoped | A real Student test failed; current store does not provide server or cross-device durability | Make flags authoritative per attempt/question, with a local journal and conflict-safe sync |
| 2 | Multi-tab protection is bypassed | Frontend forces the lease writable even after coordination | Enforce one writer, make other tabs read-only, provide deliberate transfer/recovery |
| 3 | Download experience and grading state are coupled in the UI | Human tests reported lost website grading and failed/blank files | Separate export jobs from grading state and prove every file opens without any state mutation |
| 4 | Email is treated as a workflow dependency | Human delivery failures can strand Professor or Student | Make every action and result available in the portal; queue and retry notification independently |
| 5 | Current Professor flow requires Beadle, codes, and a grading key | Too many buttons, cards, screens, keys, and recovery dependencies | Make authenticated Professor ownership sufficient; retain Beadle only as optional scoped support |
| 6 | Text PDF import is not implemented | Current parser deliberately returns `manual_required` with zero questions | Add a bounded text-PDF path, safe failure, and manual fallback; scanned OCR remains deferred |
| 7 | Grading is question-by-question and local-draft dependent | Users require early and one-page grading with unambiguous save status | Add one-page default, revisioned server drafts, conflict handling, and visible save states |
| 8 | Emergency lifecycle controls are incomplete | No whole-exam pause/resume, class extension, or normal reopen flow | Add audited commands with reasons, confirmation, idempotency, and recovery |
| 9 | Visual and accessibility contract is wrong | Dark UI, non-circular navigator, wrong content typography, clipboard blocking | Replace with the specified light system and validate WCAG 2.2 AA with assistive technology |
| 10 | Passing tests overstate readiness | Structural and mocked tests pass while confirmed human defects remain | Gate release on uncoached human tests, real files/email/disconnects, load, rollback, and independent audit |

## What must change

- Replace role-card entry with a signed-in, role-aware dashboard and one obvious primary action per examination.
- Remove Beadle and grading-key dependencies from the Professor happy path.
- Support simple access by default and roster-controlled access when the Professor needs it.
- Make flags, answers, grading drafts, receipts, releases, and amendments durable and recoverable across refresh and devices.
- Make publication, email, exports, AI, and result release separate jobs or transitions with independent status.
- Add bounded DOCX and text-PDF import; let Gemini propose structure only after explicit Professor review.
- Add one-page grading, optional question mode, early grading, preview, scoped release, and immutable amendments.
- Add pause/resume, selected or class time extension, submission reopen, session transfer, and rollback operations.
- Reduce interface density, internal state language, scrolling, and destructive ambiguity.
- Replace superficial release claims with evidence IDs and independent sign-off.

## What must remain

- Service-role-only Worker/RPC boundary and Professor ownership checks.
- Immutable publication, submission, receipt, grade-history, and candidate-release evidence.
- IndexedDB answer journal, revisions, content hashes, retry, conflict, and idempotency concepts.
- Durable email queue, leasing, retry, and provider-event precedence.
- Audit events, command receipts, export records, and incident evidence.
- Safe DOCX archive/path/macro/external-relationship validation.
- Portal access to authoritative submissions and released results.

## What must be removed from the normal path

- Public four-role card wall and technical/admin concepts at entry.
- Required Beadle email and forced Beadle handoff.
- Redundant grading key after authenticated ownership and step-up verification.
- Chains of one-time links and codes where one authenticated route is sufficient.
- Dark examination canvas, rectangular question navigator, and non-legal body typography.
- Silent local-only grading or flag states.
- Any download control that changes or disables authoritative grading state.
- Global clipboard/right-click blocking unless a narrowly justified, accessible policy is approved.

## Deferred or out of scope

Consumer subscription and ₱149 pricing changes, promotional video work, unrelated homepage or practice-exam renovation, autonomous AI grading, continuous camera or microphone recording, offline grade-file re-import, payments, and full SIS integration are outside this plan. Scanned-PDF OCR is a later opportunity after safe text-PDF import is proven.

## Recommended launch model

Launch first as a manually verified institutional service. Wally verifies the Professor and institution, provisions a sandbox, conducts a readiness check, and authorizes a production examination only after the release gates pass. The Professor then operates independently through authenticated ownership; support is available but not required for ordinary work. Future self-service onboarding may automate verification and workspace creation only after audit, privacy, support, and abuse controls are proven.

Supported launch envelope: **200 simultaneous Students and 100 questions per examination**. Treat 500 Students and 200 questions as stress/capacity targets, not launch promises, until production-like evidence exists.

## Non-negotiable product rules

1. Server-owned state transitions are authorized, revisioned, idempotent, and auditable.
2. The browser preserves local evidence but never silently wins over a newer server revision.
3. Export, email, and AI jobs cannot mutate examination, attempt, grade, or release state.
4. An active attempt does not depend on email, Gemini, or a newly deployed frontend asset.
5. Professor-visible language describes user outcomes, not internal enums or queue mechanics.
6. Every destructive or high-impact action has scope, consequence, confirmation, reason, receipt, and recovery.
7. Every human-reported defect becomes a permanent regression test.
8. No team or agent may self-certify production readiness.

## Outcome measures

- At least 90% of first-time Professors identify the next action within 10 seconds and publish a sandbox examination without coaching.
- Student entry median is at most 60 seconds after sign-in; preflight-to-start is at most two minutes when the room is open.
- Core-task SEQ is at least 6/7 and overall SUS is at least 80.
- There is zero answer, flag, grading-draft, submission, receipt, release, or amendment loss in required recovery tests.
- Local save is visibly acknowledged within one second and normal server confirmation within three seconds at p95.
- 100% of generated test files open and 0 downloads mutate authoritative state.
- Portal results are available immediately after release regardless of email status.
- WCAG 2.2 AA, complete keyboard operation, 200% zoom, reflow, and assistive-technology paths pass.

## Approval boundary

This pack recommends product and architecture decisions. Wally must approve the decisions marked `OWNER APPROVAL` in [17_DECISION_LOG_AND_OPEN_APPROVALS.md](17_DECISION_LOG_AND_OPEN_APPROVALS.md), the supported launch envelope, privacy terms, and the final GO decision. Approval of this plan does not authorize implementation or deployment.
