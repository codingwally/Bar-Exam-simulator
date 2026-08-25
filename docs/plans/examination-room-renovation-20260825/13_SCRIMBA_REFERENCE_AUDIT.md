# Scrimba Reference Audit

Reference: [Examination Room: Professor Walkthrough](https://scrimba.com/explain/guide0lntvhfg7?claim=b485kiubk1skmqas)
Title observed: `Examination Room: Professor Walkthrough`
Duration observed: 7:12
Review result: **fully accessible and fully reviewed on 2026-08-25**, including all 37 transcript scenes and the embedded proposed screens

## Authority and evidentiary limit

The walkthrough is the target-design reference after the latest requirements. It is not implementation evidence. It demonstrates a coherent animated proposal, not production authorization, data durability, real document parsing, provider delivery, responsive/accessibility behavior, concurrency, load, or rollback. Each adopted scene therefore maps to a repository gap and an objective release gate.

## Scene-by-scene audit

| # | Transcript scene / proposed behavior | Current repository comparison | Renovation decision and required recovery proof |
|---:|---|---|---|
| 1 | Professor-first Examination Room — prepare, supervise, grade, release | Current entry presents four roles and legacy handoffs; core lifecycle exists but is fragmented | Adopt Professor-first journey. Dashboard must recover every stage; failed downstream job never blocks the next safe action |
| 2 | Typography hierarchy — Cinzel, Playfair, Inter, Times New Roman | Current exam prompt uses Playfair and answer UI Inter; dark system dominates | Adopt exact roles in UX spec. Font-load failure must fall back legibly; visual/accessibility and PDF/print tests required |
| 3 | Lighter visual system — paper beige, navy, restrained gold, quiet borders | CSS explicitly uses dark color scheme/cards | Adopt light system. Contrast, high-contrast, zoom, bright/dim human tests; no color-only recovery/error state |
| 4 | One continuous Professor flow; utilities never become gates | Current creation/credentials/grading/results are fragmented; unsaved draft disables adjacent actions | Adopt. Dashboard and domain states are authoritative; email/download/AI job failure has independent retry |
| 5 | Professor home with real state, one next action, Assistant Proctor | Current public role wall and no verified Assistant Proctor | Adopt. Return without email/key; missing ownership/stale snapshot has reauth/support recovery |
| 6 | Three creation routes — manual, DOCX/PDF, reuse previous | Manual/current upload foundations exist; text PDF absent; safe reuse not audited | Launch manual + DOCX/text PDF. Reuse is later gated copy-from-immutable-version; parser/copy failure preserves original |
| 7 | Upload existing exam; preserve source and create separate draft | Private owner-scoped question-source upload exists | Adopt and strengthen byte validation, private retention, source hash/provenance; failure returns to manual work |
| 8 | Gemini import extracts page order/structure; uncertainty marked; all Professor-confirmed | Server-side Gemini infrastructure exists, but no verified Exam Room normalization call | Adopt optional proposal only. Provider/schema/privacy failure leaves deterministic draft and ordinary UI |
| 9 | Controlled cleanup of numbering/subparts/formatting/points; no silent rewriting | DOCX parsing has useful bounds; no complete provenance/approval UI proof | Adopt with field provenance/uncertainty. Unapproved or missing fields block publication and are recoverable by edit |
| 10 | Review: circular sequence, exam text, correction tools, source page | No verified synchronized comparison workspace; current navigator is rectangular | Adopt accessible circular outline plus source/structured comparison; refresh/conflict restores exact item and versions |
| 11 | Rules grouped by schedule, access, materials, optional integrity, Student preview | Current rules force Beadle/code and expose more ceremony | Adopt simplified groups and collapsed advanced options. Continuous camera/mic is rejected/deferred; invalid rules identify exact fix |
| 12 | Publish saves first, gives permanent link/code, queues email second | Email outbox exists; current Beadle/one-time credential workflow is central | Adopt portal-first immutable publication. Link/code locates exam but cannot bypass identity; timeout queries idempotent receipt |
| 13 | Publish receipt with version, link/code, real delivery, one action: Monitor | Current publication returns multiple keys and Beadle steps | Adopt. Receipt exists before email; unknown response recovers by command ID, delivery failure exposes retry/copy/print |
| 14 | Monitor taking/submitted/grading/completed; grade early submitters | Grading workspace can query sealed submissions during open class; UI/real-flow proof missing | Adopt metadata-only monitor and early queue. Load failure labels stale; active answer text never appears |
| 15 | Assistant Proctor as side inbox with What you can do | No implementation found | Adopt Professor-only side inbox. Failure/circuit break leaves ordinary page/actions intact |
| 16 | Assistant commands: navigate, find, explain, guide, suggest | No implementation; existing Gemini not an authority layer | Adopt closed v1 allowlist; constrain suggestions to explicit submitted-answer context. Ambiguity never guesses target |
| 17 | Three safety levels; official actions require confirmation; destructive unauthorized excluded | Server authorization/command concepts exist; no Assistant layer | Adopt stricter v1: read-only immediate; proposals open ordinary control; mutations use server-bound confirmation; grading/release not autonomous |
| 18 | Submitted answer sealed and immediately gradeable; active peers continue | Submission generations/receipts and early-grade query foundation exist | Adopt. Reopen selects new generation; stale/active generation rejected with exact recovery |
| 19 | Grading workspace with answer/rubric/control together and visible saved time | Current split question mode exists; key prompt/local drafts cause ambiguity | Adopt layout and server revision status. Loading/save failure retains local work and shows Needs attention |
| 20 | Focused question controls: score, rubric, comment, Professor flag, Save and Next | Current Save/Save & Next foundation; Professor flag/rubric parity unverified | Keep optional mode. Values share one draft; validation/conflict cannot discard typed feedback |
| 21 | One continuous grading page, circles, completeness summary | Absent | Make default. Incremental rendering must preserve focus/find/drafts; fallback question mode uses identical revisions |
| 22 | Visible recoverable saving: local pending queue, versioned server commit, saved time | LocalStorage draft and server grade save exist but semantics are unclear | Adopt local journal + revisioned server draft. Offline/timeout preserves edits and queries receipt |
| 23 | Five save states, not generic spinner | Current state does not provide the proposed explicit model | Adopt Editing/Saving locally/Syncing/Saved at/Needs attention; Resume is a recovery affordance. No false Saved |
| 24 | Finish Student deliberately: total, missing scores/flags, comments, mark complete | Current finalization/release clarity is insufficient | Adopt Finalize separate from Release. Validation failure returns to exact missing field without losing draft |
| 25 | AI can summarize/compare/draft/find patterns; Professor decides | Current AI grading is rejected, which safely prevents autonomy | Partially adopt explicit selected-answer feedback drafting; defer class-pattern analysis until privacy/accuracy proof. Never save marks |
| 26 | Per-Student gradebook states Ready/In progress/Ungraded/Hold/Released | Current class results foundation exists; plain complete lifecycle UI unproven | Adopt plain statuses and candidate receipts. Query failure labels stale; hold never mutates grade |
| 27 | Release content: Grade Only, Answers and Comments, Full Review, Custom | Current UI offers limited package toggle | Adopt three standard packages. Defer Custom until privacy/comprehension proof; invalid package blocks preview/release |
| 28 | Exact Student preview beside visibility choices | Candidate release versions exist; exact UI/file equivalence unproven | Adopt version-bound web preview. Renderer/source changes invalidate confirmation and preserve unreleased grade |
| 29 | Release is immutable portal transaction; notification after | Current candidate release/outbox architecture strongly supports this | Preserve/extend. Timeout queries candidate receipts; mixed class result shows per-candidate recovery |
| 30 | Delivery dashboard separates portal and email; records Student view | Queue/provider precedence exists; real controlled inbox proof absent | Adopt. Student view is authenticated portal audit, not email tracking; retry never recreates release |
| 31 | Read-only download center and regenerate | Export migrations appear separated; human tests saw state loss/blank files | Adopt only after before/after state and real-open gates. Failure gives web/print/regenerate/incident |
| 32 | Download reads, generates, validates; permissions/workflow unchanged | Route tests assert separation but are mocked/structural; frontend coupling remains | Adopt invariant at DB/Worker/UI. Production-like reproduction of H01 is mandatory before GO |
| 33 | Short Student entry: sign-in, code, readiness, start | Current role/link/key chain is more complex | Adopt for simple mode with identity binding; roster mode optional. Duplicate identity blocks safely for Professor resolution |
| 34 | Light Student workspace, TNR, circular navigator, visible Flag/save | Current dark CSS, rectangular grid, wrong type, local-only flag | Adopt exact system. Flag server sync/refresh/device, keyboard circles, and offline recovery are blockers |
| 35 | Recoverable session protects answers/flags/position; submit needs acknowledgment | Answer journal/receipts strong; flag/forced-writer bugs undermine whole promise | Adopt one writer and authoritative flag. Duplicate device becomes read-only then deliberate transfer |
| 36 | Receipt proves sealed version/time/ID; Student can retain proof | Submission receipt foundation exists; human recognition/browser proof needed | Adopt portal receipt/browser print. Lost response queries same receipt; no duplicate submission |
| 37 | Closing principle: resumable, no traps, one next step, visible proof, optional Assistant | Direction conflicts with current UI but aligns with repository reliability primitives | Adopt as acceptance summary. Any missing receipt/recovery or AI/email/download dependency is NO-GO |

## Proposed screen inventory

The walkthrough contains or implies these screens/panels, all retained or resolved in this plan:

| Screen/panel | Primary control | Required non-happy states |
|---|---|---|
| Professor home | One state-derived Continue action | Empty, loading, missing ownership, stale, unsynced local evidence |
| Creation routes | Build manually / Upload | Parser unavailable, unsupported format, duplicate/reuse version conflict |
| DOCX/PDF upload | Choose/upload file | Too large, unsafe, corrupt, encrypted, scanned, timeout |
| Gemini draft status | Review draft | Disabled, running, low uncertainty quality, quota, invalid schema, privacy refusal |
| Imported-question review | Approve/edit per question | Missing, uncertain, unsupported/source-unrepresented, save conflict |
| Rules + Student preview | Review and publish | Invalid time/access/total, stale preview, unsupported integrity choice |
| Publication confirmation/receipt | Publish then Open monitoring | Rejected, response lost, existing idempotent receipt, email queued/failed |
| Live monitor | Candidate/class safe control | Stale load, shared-NAT pressure, sync incident, command outcome unknown |
| Assistant Proctor inbox | Read query / proposed command | Ambiguous, denied, unavailable, bad proposal, timeout, circuit broken |
| Grading queue/workspace | Grade submission | Active/wrong generation, loading failure, missing rubric, revoked access |
| One-page grading | Save/finalize | Local-only, syncing, conflict, validation, long-page performance |
| Class gradebook | Preview results | In progress, hold, mixed eligibility, stale grade version |
| Result-package preview | Confirm recipient/package | Missing final, privacy exclusion, render failure, stale preview |
| Release receipt/delivery | Portal published / retry notification | Partial batch, queued/delayed/failed/bounced, response lost |
| Download center | Generate/regenerate | Blank/corrupt/timeout/storage failure, web/print fallback, no state mutation |
| Student entry/preflight | Start/wait | Wrong code/account, duplicate identity, closed/paused, device/network issue |
| Student workspace | Answer/flag/review | Offline, sync conflict, duplicate device, timer correction, save problem |
| Submission receipt/results portal | Receipt / view released result | Response lost, reopened generation, no release, email absent, amendment |

## Control audit

- **Adopt:** one primary action; manual/upload entry; source comparison; Student preview; publish receipt; Open monitoring; early grading; one-page default; optional question mode; visible save states; per-candidate gradebook; exact preview; portal-first release; delivery status; regenerate; circular navigator; submission receipt.
- **Constrain:** exam code is a locator plus authenticated identity, not a bearer secret; Assistant commands use server allowlist; AI sees minimum selected data; active-answer monitoring is metadata only; result packages launch with three standard choices.
- **Defer/reject:** continuous camera/microphone; autonomous grading/release; AI class-pattern analysis until separately approved; custom release composer until privacy/usability proof; offline grade re-import; safe reuse until immutable-copy semantics are tested.

## Error and recovery audit

The walkthrough communicates several desired recoveries—email retry, saved-locally retry, version conflict, resume draft, regenerate file, concrete reconnect, receipt proof—but does not demonstrate them. It also omits detailed identity collision, parser security, duplicate-writer transfer, timed pause/extension/reopen, batch partial release, service-worker compatibility, authorization attack, and Admin break-glass behavior. Those omissions are supplied by the numbered diagrams, incident matrix, and release gates in this pack.

## Visual audit

The proposal's paper-beige/navy/gold restraint, Cinzel/Playfair/Inter/Times New Roman roles, circular navigation, visible proof, and side inbox are accepted as target direction. Current CSS does not match it. Before implementation sign-off, compare each target reference and browser build at identical viewport/state, then validate interaction/accessibility; screenshots alone do not prove the walkthrough.

## Final Scrimba decision

Use the walkthrough as the visual and journey north star, with the explicit constraints above. It materially improves Professor clarity and aligns with the desired portal-first, state-decoupled model. It does not change the current **NO-GO** decision and cannot be cited as evidence that any feature works.
