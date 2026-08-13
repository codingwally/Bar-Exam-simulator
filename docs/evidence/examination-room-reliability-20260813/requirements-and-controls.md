# Examination Room reliability release — requirements and controls

- Date: 2026-08-13 (Asia/Manila)
- Directive SHA-256: `B473FBA8DADBC785C11512DC9C27C3A6E35E7BC7C067C18F13CAA6F3F11BE81E`
- Baseline commit: `8fd10737c676a995d728dff1cb61006a196ad919`
Working branch: `agent/exam-room-reliability-20260813`

## Scope lock

This release changes only the Examination Room database contract, Worker routes and delivery queue, Examination Room frontend, related exports, and their tests. It does not change Gemini, the 0–5 grading rubric, question-bank content, subscription/payment behavior, global authentication, or unrelated pages.

## Confirmed defects

| ID | Defect | Evidence | Required control |
|---|---|---|---|
| ER-01 | Student can be forced into read-only mode by another tab/device. | One-active-session database index and client writer lease. | Up to three authenticated device sessions; answer operations remain revisioned and conflict-preserving; explicit device revocation. |
| ER-02 | Heartbeat and safety-save intervals restart on every answer rerender. | `renderAttempt()` calls timer startup after navigation-triggered rerenders. | Start intervals once per attempt/session; rerenders only refresh visible countdown. |
| ER-03 | Final review omits the actual question-and-answer pairs. | Submission dialog shows counts only. | Full Q&A review, answer editing links, stable idempotent submission, and a downloadable answer copy. |
| ER-04 | Result sending is class-wide and seals/revokes the entire room. | `release_results` requires every grade and sets exam/attempts to sealed. | Candidate-scoped release and retry independent from access closure, completion, and archival. |
| ER-05 | A selected workbook contains unrelated roster identities. | Export dataset always includes the complete `classStatuses` array. | Filter status/identity rows to selected attempts unless the Professor explicitly requests a complete current roster workbook. |
| ER-06 | Worker crashes can strand email jobs in `processing`. | Queue has no owner token or lease expiry. | Claim token, bounded lease, stale reclaim, token-bound complete/fail, monotonic provider status. |
| ER-07 | Grading starts in Draft and requires avoidable repetitive choices. | Grade-state fallback and UI default are Draft. | Final by default; “Save final grade & next”; Draft remains available deliberately. |
| ER-08 | Professor workflow mixes preparation, monitoring, grading, results, and lifecycle actions. | Current cards and five-step progress affordances. | Dashboard / Prepare / Monitor / Grade / Results tabs, four preparation steps, independent access/end/complete/archive actions. |
| ER-09 | Beadle roster correction is all-or-nothing and tablet-heavy. | One invalid row prevents the full import; wide editor. | Per-row validation and correction, actionable errors, retryable finalization, responsive table/card layout. |
| ER-10 | Provider status can regress after a delivered event. | Later `sent`/`delayed` event overwrites `delivered`. | Monotonic terminal delivery precedence. |

## Release controls

1. Production identity must equal `hbllomlijfznnuudpdvr` character-for-character.
2. Production baseline counts and migration ledger are captured read-only immediately before migration.
3. Only the reviewed forward migration is applied in a transaction; no blind `db push`.
4. Database verification precedes Worker deployment; Worker verification precedes frontend deployment.
5. Existing data counts must not decrease. Synthetic records use unique release markers and are removed by exact IDs only.
6. Worker rollback is the previous version `1b2c1501-dd19-4cd0-be5c-99588ef8dba8`; frontend rollback is baseline commit `8fd10737c676a995d728dff1cb61006a196ad919`.
7. No secret values enter source control, command output, screenshots, logs, or the final report.
8. A real controlled inbox must show delivery before the final GO verdict.
9. Any failed migration, authorization isolation test, existing grading smoke test, or live data-preservation check is an immediate stop condition.

## Traceability targets

- Professor: Dashboard, Prepare, Monitor, Grade, Results; live status; immediate grading; lifecycle independence; partial result release; professional downloads.
- Beadle: one focused roster task; recoverable access; actionable validation; automatic student handoff; direct waiting/exam entry.
- Student: roster/code checks; waiting room; local/server saves; multiple safe sessions; full review; idempotent receipt; protected result.
- Founder operations: narrow founder-only diagnostics and recovery actions, without weakening Professor/Beadle/student roles.
- Delivery: durable outbox, retry visibility, provider acceptance/delivery state, no silent success.
- Scale: bounded 200-question / 500-student inputs, paginated or summarized UI, export size checks, no answer text in monitor lists.

## Five independent review streams

1. Architecture: traced browser → Worker → RPC paths and the release/session coupling.
2. Requirements/edge cases: classified all directive requirements as complete, partial, missing, or externally unverifiable.
3. Verification: identified timer starvation, missing Q&A review, accessibility, focus, and real-browser gaps.
4. Database/security: inventoried 58 tables and 176 expected function signatures; found queue leases and contract-preflight gaps.
5. Independent critic/export review: found selected-roster disclosure, stranded jobs, memory risk, and unproven real-email delivery.
