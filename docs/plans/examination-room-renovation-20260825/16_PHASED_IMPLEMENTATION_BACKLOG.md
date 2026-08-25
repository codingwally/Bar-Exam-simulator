# Phased Implementation Backlog

## Delivery rule

This is a future implementation sequence, not authorization to implement. Work one workflow at a time. A phase enters only after its predecessor has objective evidence and owner approval; a failed stop condition halts the phase and all downstream release work. Each state change must map to a decision ID, diagram, downstream-impact record, invariant, regression, and rollback.

## Phase 1 — State decoupling and regression protection

| Field | Plan |
|---|---|
| Objective | Establish non-negotiable domain/job separation and tests before changing visible workflows; reproduce H01 and prevent export/email/AI from changing or disabling exam/grade state |
| In scope | Current-state mapping; authoritative revision/hash snapshots; command/idempotency receipt contract; export/email/AI isolation assertions; multi-tab lease defect characterization; evidence manifest/gate harness |
| Out of scope | Visual redesign, new importer, grading layout, Assistant Proctor |
| Files likely affected | `assets/duediligence-2026.js`, `assets/examination-room-2-store.js`, Worker Exam Room route/core/delivery files, relevant Exam Room migrations/tests, service-worker/deployment test docs |
| Database changes | Prefer invariant/authorization tests first; if necessary add command/job constraints/receipts without changing domain semantics; forward-compatible only |
| Worker changes | Separate command/query/job handlers; return authoritative outcome/revision/receipt; forbid export/email/AI callbacks from domain RPCs |
| Frontend changes | Remove UI conditions that let download state enable/disable grading; stop forcing read-only lease writable; show unknown command outcomes safely |
| Risks | Breaking legacy clients; deployed-build skew hides H01; constraint added before bad historical rows are understood |
| Required tests | H01/H21 before-after domain snapshots; job-failure injection; command timeout/duplicate; old/new client compatibility; authorization baseline; full unrelated regression |
| Human test | Professor grades, downloads every artifact, refreshes/logs out/switches device, and resumes five times; second tab is read-only |
| Stop conditions | Any authoritative mutation from a read action/job; lost draft; unknown deployment parity; incompatible active client; failed authorization regression |
| Rollback | Disable new isolation path/flag while retaining added evidence; route to last compatible Worker/frontend; never clear DB/IndexedDB or remove receipts |
| Evidence required | Reproduction of H01 or explicit production-build mismatch finding; route/RPC/state trace; before/after hashes; test logs; independent review |
| Owner approval point | Wally approves invariant set, compatibility posture, and closure evidence for H01 before Phase 2 |

## Phase 2 — Professor dashboard and recovery entry

| Field | Plan |
|---|---|
| Objective | Give every authenticated Professor one owner-scoped dashboard and recovery route without old email, Beadle, secret URL, or grading key |
| In scope | Dashboard groups/status mapping; one primary action; return context; local evidence recovery card; owner membership/reauth paths; archived view |
| Out of scope | New creation/import logic, monitoring controls, grading redesign |
| Files likely affected | `assets/duediligence-2026.js`, `assets/duediligence-2026.css`, auth/routing modules, Examination Room query routes/RPCs, browser/accessibility tests |
| Database changes | Owner-scoped summary RPC/projection if existing workspace queries cannot provide bounded summaries; no new lifecycle state for page views/jobs |
| Worker changes | Summary query with plain domain state, attention counts, latest receipt/job metadata; no active answer text |
| Frontend changes | Replace four-role wall for signed-in users; dashboard list/empty/loading/error/recovery; stable routes and one primary action |
| Risks | Status mapping hides real blocker; large dashboard query leaks/costs; legacy links break |
| Required tests | Owner/non-owner/cross-class; empty/large lists; old link redirects; refresh/new device; stale/local conflict; keyboard/zoom/screen reader |
| Human test | Six Professor profiles find an exam in ≤30s and correct next action in ≤10s without old email/key, five repeats |
| Stop conditions | Cross-owner existence leak; dashboard requires email/key; internal enum exposed; lost local evidence; >1 critical wrong turn |
| Rollback | Preserve old owner-safe route behind authenticated compatibility entry; no membership/data changes on UI rollback |
| Evidence required | Browser recordings/metrics, auth matrix, query payload review, visual comparison, accessibility results, independent usability notes |
| Owner approval point | Wally approves terminology, grouping, and Professor recovery before Phase 3 |

## Phase 3 — Creation and import

| Field | Plan |
|---|---|
| Objective | Make manual creation, safe DOCX, and bounded text-PDF import produce reviewable, revisioned drafts with optional Gemini proposals |
| In scope | Four-step creation; draft autosave; source validation/storage; sandbox parsers; provenance/uncertainty; comparison/approval; Student preview; publish preflight |
| Out of scope | Scanned-PDF OCR, autonomous content rewriting, reuse-previous unless separately gated, production publish activation |
| Files likely affected | `assets/duediligence-2026.js/.css`, `worker/exam-room-2026-core.mjs`, `worker/duediligence-2026-routes.mjs`, question-source/version migrations and parser/browser tests |
| Database changes | Source/job/provenance/field approval and draft revision additions only where current tables lack them; private retention links; no AI-driven publication transition |
| Worker changes | Actual-byte validation; bounded network-isolated DOCX/text-PDF pipeline; idempotent job; optional server-side Gemini proposal; schema/uncertainty validation |
| Frontend changes | Manual editor, upload status, synchronized source comparison, per-question approval, warning summary, refresh/conflict recovery |
| Risks | Parser exploits/resource exhaustion; lost formatting; AI privacy/cost/hallucination; source retention; 200-question performance |
| Required tests | Golden/adversarial DOCX/PDF; image-only/encrypted/corrupt; 1/20/50/100/200 questions; Gemini off/quota/malformed; cross-owner; refresh/conflict; publication blocked until approval |
| Human test | Professors import real law exams, reject AI, correct ambiguity, find unrepresented pages, and publish sandbox uncoached ×5 per critical format |
| Stop conditions | Unsafe parse; silent wording change; untraceable field; AI key/browser leak; scanned PDF fake success; unapproved publication; source/draft loss |
| Rollback | Disable new parser/AI path; keep sources/drafts/provenance; manual creation remains; no destructive schema rollback |
| Evidence required | Fixture hashes/results, sandbox/resource logs, privacy review, comparison recordings, draft/publication DB assertions, independent security review |
| Owner approval point | Wally approves file limits, Gemini data policy/key project, retention, and parser release |

## Phase 4 — Student flag and save reliability

| Field | Plan |
|---|---|
| Objective | Close H07/H20 by making answers and flags durable, plainly labeled, conflict-safe, and single-writer across refresh/offline/devices |
| In scope | Server flag operation/revision; local flag journal; answer journal hardening; five save states; one-writer lease; deliberate device transfer; circular navigator persistence |
| Out of scope | Final submission redesign, grading, new integrity surveillance |
| Files likely affected | `assets/examination-room-2-store.js`, `assets/exam-session-controller.js`, Student portions of `assets/duediligence-2026.js/.css`, answer/session/flag migrations, Worker routes/tests |
| Database changes | Per-generation/question flag operations/current projection; session lease/transfer constraints as needed; migration/backfill treats absent flag as unflagged without erasing evidence |
| Worker changes | Idempotent answer/flag sync with expected revision; transfer/reconciliation endpoints; shared-NAT-safe limits |
| Frontend changes | Remove `allowUncoordinatedWrite` bypass; read-only duplicate view; explicit transfer; accurate local/server/attention states; accessible circular buttons |
| Risks | Migration mismatch; replay order; old clients; storage quota; false rate limits; stranded old-device operations |
| Required tests | H07/H20; epoch/refresh/offline/reconnect; answer/flag interleaving; duplicate op/revision; two tabs/devices; lost device; quota; shared NAT; accessibility |
| Human test | Student flags/types/navigates/refreshes/offlines/transfers and finds identical state five times across devices/access needs |
| Stop conditions | Any silent flag clear/answer overwrite; two writers; false Saved; inaccessible navigator/editor; active-client incompatibility |
| Rollback | Pin compatible client/Worker; dual-read/dual-safe protocol if migration exists; preserve all operations; disable transfer before disabling durability |
| Evidence required | Operation/revision traces, before/after hashes, conflict copies, device recordings, load/AT results, independent defect retest |
| Owner approval point | Wally approves H07/H20 closure and Student save language before Phase 5 |

## Phase 5 — Student submission and receipt

| Field | Plan |
|---|---|
| Objective | Make final review, manual/auto-submit, receipt recovery, and reopen generations authoritative and understandable |
| In scope | Actual Q&A review; sync readiness; durable intent; idempotent submit; authoritative receipt; browser print; response-loss/stuck recovery; generation-aware reopen foundation |
| Out of scope | Grading UI and result release |
| Files likely affected | Student frontend/store/controller, Worker submission routes/core, attempt/submission/receipt/reopen migrations/tests |
| Database changes | Tighten intent/generation/receipt invariants and query-by-idempotency if current schema is insufficient; no receipt overwrite |
| Worker changes | Submit/status/reopen protocol with expected revisions and exact failure reasons; auto-submit parity |
| Frontend changes | Final review list, consequence confirmation, pending/receipt/recovery screens, reopen generation return |
| Risks | Race at deadline; pending ops; duplicate clicks; response loss; stale generation; accessibility/time pressure |
| Required tests | Offline at zero; commit-response loss; duplicate submit burst; conflict/pending ops; reopen guards; receipt privacy; 200/500 burst characterization |
| Human test | Students review actual answers, explain pending state, submit once, recognize/retain receipt, recover induced response loss ×5 |
| Stop conditions | Missing/wrong/duplicate receipt; sealed content mismatch; local evidence discarded; auto-submit lacks recovery; Student cannot recognize outcome |
| Rollback | Preserve old/new receipt query compatibility; keep sealed generations/intents; pin active bundle and disable new reopen UI only |
| Evidence required | Receipt/content hashes, idempotency traces, burst results, real browser recovery, human comprehension, independent audit |
| Owner approval point | Wally approves receipt text, auto-submit/reopen policy, and submission load envelope |

## Phase 6 — Monitoring and emergency controls

| Field | Plan |
|---|---|
| Objective | Provide metadata-only live monitoring and audited pause/resume, extension, session transfer, close entry/end/cancel, and submission reopen |
| In scope | Counts/status/recency/incidents; candidate drawer; command preflight/confirmation/reason/receipt; timing ledger; class/selected/candidate scopes; Admin stop-new-entry path |
| Out of scope | Active answer viewing, autonomous intervention, continuous camera/microphone |
| Files likely affected | Professor monitor frontend/CSS, Worker query/command core/routes, attempt/session/lifecycle/audit migrations and tests |
| Database changes | Append-only pause/resume/extension/reopen/session-transfer events and derived deadlines; legal-transition constraints/command receipts |
| Worker changes | Metadata-only snapshots; per-target idempotent commands; mixed batch outcomes; unknown-outcome query |
| Frontend changes | Timestamped dashboard, filters/drawer, impact-grouped controls, confirmations, incident/recovery states |
| Risks | Timer math; stale monitor action; partial batch; privacy leak; query/load pressure; cancel misuse |
| Required tests | Legal/illegal transitions; timing/timezone/skew; stale/timeout/duplicate; pause/reconnect; selected extensions; active/submitted/released reopen guards; privacy/load/auth |
| Human test | Professor responds to Student disconnect, whole-room pause, selected extension, duplicate session, accidental submit, and cancellation without coaching |
| Stop conditions | Active answer text leaks; wrong candidate/class affected; timer loses time; unknown shown as success; unreceipted mutation; rollback incompatible |
| Rollback | Feature-disable mutation controls while retaining ledger/events; monitor falls back to safe snapshot; active timers derived from server events |
| Evidence required | State/ledger proofs, command receipts, privacy payload review, 200/500 monitoring load, scenario recordings, independent incident drill |
| Owner approval point | Wally approves emergency authority/reason policy and operational readiness |

## Phase 7 — Professor grading

| Field | Plan |
|---|---|
| Objective | Deliver early grading, one-page default, optional question mode, revisioned server drafts, explicit save/conflict/finalize behavior |
| In scope | Queue/status; sealed-generation guard; one-page performance; shared draft model; five save states; conflict comparison; total/validation; finalization |
| Out of scope | Result release/email; autonomous AI grading |
| Files likely affected | Grading sections of `assets/duediligence-2026.js/.css`, grading Worker routes, grading migrations/RPCs/tests, result render inputs |
| Database changes | Server grade-draft operations/revisions if absent; preserve grade history/final versions; remove normal key gate through safe auth migration |
| Worker changes | Owner/eligible-generation query; draft save/conflict/finalize commands; no active-answer payload |
| Frontend changes | One-page layout/outline/sticky actions; mode switch; local recovery journal; visible timestamps; no routine save reason; reauth for sensitive future action |
| Risks | Long-page memory/accessibility; wrong Student context; local/server conflict; total drift; key migration/legacy links |
| Required tests | Early active/submitted mix; 1/20/50/100/200 questions; save/refresh/logout/device/conflict; mode parity; owner/Beadle; total/final guards; H12–H17 |
| Human test | Essay graders complete/resume full scripts on laptop/tablet, switch mode, explain save/finalize, and recover conflict ×5 |
| Stop conditions | Active answer exposed; confirmed grade lost/overwritten; wrong candidate saved; key still normal dependency; unclear/false save; inaccessible long page |
| Rollback | Retain grade revisions; fall back to compatible question mode reading same draft; never revert/delete finalized/history records |
| Evidence required | Revision/field traces, performance/AT results, human SEQ/SUS, authorization matrix, independent grade comparison |
| Owner approval point | Wally approves save semantics, one-page usability, and grading-key removal/reauth policy |

## Phase 8 — Results and portal-first release

| Field | Plan |
|---|---|
| Objective | Separate finalize from preview/release and provide individual/selected/class portal versions plus immutable amendment/reissue |
| In scope | Three packages; exact Student preview; frozen manifest; candidate receipts; portal Student page; partial batch recovery; amendment/history/reissue |
| Out of scope | Custom package composer, offline grade import, SIS export/import |
| Files likely affected | Professor results/Student portal frontend/CSS, candidate release Worker routes, result/release/amendment migrations/RPCs/tests, renderers |
| Database changes | Extend immutable candidate release/amendment links/package refs only as needed; no overwrite; Student authorization projection |
| Worker changes | Preview from exact versions; release per idempotency; mixed manifest receipts; amendment fresh-auth/reason; portal query |
| Frontend changes | Eligibility/preview/package/scope UI; release receipts; portal version/history; amendment comparison |
| Risks | Wrong recipient/package; stale preview; partial class release; privacy exposure; history ambiguity |
| Required tests | Individual/selected/class; stale/mixed/timeout; other Student/Professor; all packages; long/Unicode; amendment/reissue; portal with email disabled |
| Human test | Professor previews/explains package, releases one/class, recovers partial result, amends; Student verifies portal/history ×5 |
| Stop conditions | Release without exact final/preview; wrong candidate/content; portal unavailable; overwrite/history loss; email dependency |
| Rollback | Keep portal/release versions; hide new UI only if old path cannot mutate them incorrectly; never retract by rollback |
| Evidence required | Version-bound preview/release hashes, auth/privacy results, per-candidate receipts, human comprehension, independent portal audit |
| Owner approval point | Wally approves package definitions, Student history/privacy wording, and release authority |

## Phase 9 — Email outbox fail-safe

| Field | Plan |
|---|---|
| Objective | Prove observable, durable notification delivery/retry while portal publication remains authoritative |
| In scope | Lease/token/stale reclaim; jitter; provider acceptance/events/precedence; retry/address correction/permanent failure; controlled inbox/dashboard |
| Out of scope | Guaranteed delivery promises, marketing campaigns, email-only access/recovery |
| Files likely affected | `worker/exam-room-delivery.mjs`, email route handlers/templates, `20260813190000...` lineage migrations, Professor delivery UI/tests |
| Database changes | Add jitter/attempt metadata or status constraints only if needed; preserve event history and domain foreign refs |
| Worker changes | Crash-safe claim/send/event handling; signatures; idempotent provider key; redacted diagnostics |
| Frontend changes | Portal-available plus delivery state; retry/correct/copy instructions; no misleading `sent` |
| Risks | Duplicate mail; event disorder; provider/DNS/config; recipient privacy; retry storm |
| Required tests | Real controlled invitation/access/result mail; crash timing; stale lease; duplicate/reordered events; bounce/complaint; permanent failure; provider off |
| Human test | Professor identifies and safely retries failure while Student gets portal result without email ×5 |
| Stop conditions | Portal state changes/regresses; delivered regresses; duplicate unintended mail; secret/PII leak; mock-only evidence |
| Rollback | Disable sending/retry while keeping portal and queued jobs/history; restore previous compatible consumer; no release rollback |
| Evidence required | Inbox headers/events/timestamps, job attempt history, crash/reclaim trace, domain before/after, provider/privacy review |
| Owner approval point | Wally approves provider configuration, support messaging, retry bounds, and honest commercial promise |

## Phase 10 — Downloads and exports

| Field | Plan |
|---|---|
| Objective | Make all required PDF/workbook/receipt/audit artifacts read-only, valid, private, regenerable, and non-blocking |
| In scope | Snapshot/version contract; job status; semantic validation; real open; privacy; formula/leading zero; web/print fallback; expiry/regenerate |
| Out of scope | Offline grade re-import, automatic state changes from file generation |
| Files likely affected | `worker/exam-result-pdf.mjs`, `worker/exam-results-workbook.mjs`, export routes/storage, Professor/Student file UI, export migrations/tests |
| Database changes | Artifact/source-version/renderer-validation metadata as needed; enforce job-only mutations |
| Worker changes | Bounded render queues; MIME/signature/content validators; private download authorization; stable error IDs |
| Frontend changes | Separate Files area, snapshot disclosure, generate/regenerate/web view/print, job failure status; grading never disabled |
| Risks | Blank/corrupt/privacy-leaking artifact; renderer burst starvation; fonts/pagination; storage/URL expiry |
| Required tests | All required artifacts; real Adobe/browser/Excel/LibreOffice open; Unicode/long/large; privacy; injection; before/after state; renderer crash/quota |
| Human test | Professors/Students open, interpret, regenerate, and print artifacts across devices; grade before/after download ×5 |
| Stop conditions | Any file fails/blank/leaks; any authoritative mutation/permission change; grading hidden/disabled; no fallback |
| Rollback | Disable faulty renderer/file type; preserve job/source/audit and web views; core workflows continue |
| Evidence required | Artifact hashes/open results/visual checks, source snapshot, domain diffs, load results, independent file audit |
| Owner approval point | Wally approves supported artifact list, retention/expiry, and H01/H08/H09 closure |

## Phase 11 — Assistant Proctor

| Field | Plan |
|---|---|
| Objective | Add an optional Professor side inbox with deterministic navigation/read-only help and tightly confirmed proposed commands |
| In scope | V1 allowlist/schema; owner permission; quick actions; sources/timestamps; three confirmation classes; command receipts; logging/cost/circuit-break/fallback |
| Out of scope | Autonomous grading/release, cross-class analysis, active-answer access, Student assistant, Admin break-glass, continuous surveillance |
| Files likely affected | Professor frontend/CSS, server-side Gemini/function broker, auth/command routes, AI/audit storage and tests |
| Database changes | AI job/proposal/activity records and confirmation binding only if current audit/command structures cannot represent them; no direct AI domain writes |
| Worker changes | Closed allowlist dispatcher; server-derived actor/scope; prompt/data separation; minimum payload; rate/cost limits; independent command authorization |
| Frontend changes | Side inbox/drawer; What you can do; quick actions; proposal cards; ordinary-control links; failure/circuit state |
| Risks | Prompt injection, confused deputy, privacy/cost, stale/wrong target, trust overreach, active API starvation |
| Required tests | Every allow/disallow; owner/cross-owner/roles; malformed/extra/replay/stale/timeout; document/answer injection; Gemini off/quota; load; ordinary UI parity |
| Human test | Professors execute read-only/ambiguous/denied/confirmed/failed tasks and correctly state whether state changed ×5 |
| Stop conditions | Any direct/bypass mutation; wrong/cross-owner data; autonomous grade/release; ordinary UI dependency; secret leak; unsafe cost/load |
| Rollback | Circuit-break/hide assistant only; preserve activity/command receipts; every ordinary workflow remains usable |
| Evidence required | Allowlist/schema, auth/prompt-injection results, redacted logs/cost, failure/fallback recordings, independent security/privacy audit |
| Owner approval point | Wally approves v1 functions, production Gemini project/data policy, confirmation exclusions, and enablement |

## Phase 12 — Accessibility, scale, and institutional hardening

| Field | Plan |
|---|---|
| Objective | Prove the complete product accessible, secure, private, scalable, operable, and rollback-safe for the first commercial class |
| In scope | Light visual completion; WCAG 2.2 AA; supported devices/AT; security/privacy/retention/deletion; 200/100 load and 500/200 stress; observability/runbooks; deployment freeze/rollback; full human program |
| Out of scope | Consumer pricing, payments/SIS, OCR, offline grade import, autonomous AI, camera/mic, unrelated product renovation |
| Files likely affected | All Examination Room frontend/Worker/migrations/tests/docs/deploy config touched by approved phases; no unrelated feature changes |
| Database changes | Only hardening constraints/indexes/retention evidence proven necessary by load/security review; online/compatible migrations |
| Worker changes | Resource partitioning, shared-NAT-aware limiting, observability/redaction, compatibility/version health, queue isolation |
| Frontend changes | Final responsive/AT/high-contrast/zoom states, status/recovery polish, version/update handling; no core semantic redesign here |
| Risks | Late accessibility/state redesign; performance tuning changes correctness; retention/legal gaps; rollback unproven; support capacity |
| Required tests | Full G0–G9 suite, all 49 acceptance IDs, unrelated regressions, 1–500/1–200 matrix, security/adversarial, real files/email, rollback with active clients |
| Human test | All Professor/Student profiles, realistic class/content, real apps/inbox/network/recovery, five repeats per critical journey/failure, no coaching |
| Stop conditions | Any acceptance failure, WCAG A/AA blocker, P0/P1 recurrence, missing manifest, unsupported scale, privacy/security gap, failed independent audit/rehearsal |
| Rollback | Use rehearsed version-pinning/compatible frontend/Worker/db path; preserve active attempts/jobs/audit; no production deploy without owner approval |
| Evidence required | Complete immutable manifest, performance/security/privacy/accessibility reports, human metrics/observations, incident/rollback drill, independent sign-off |
| Owner approval point | Wally makes explicit dated GO/NO-GO for exact versions, supported envelope, support/privacy terms, and first real class |

## Cross-phase governance

- One implementation PR should address one bounded workflow/gate; unrelated cleanup waits.
- Add regression first for every human defect and state invariant; show it fails on current defective behavior and passes only after the change.
- Any deviation from the approved diagram/decision updates the decision log before code review.
- Never run destructive migration/cleanup during an active exam window. Never deploy without explicit owner approval.
- Phase completion means evidence and independent acceptance, not merged code. The product remains NO-GO until Phase 12 G9 approval.
