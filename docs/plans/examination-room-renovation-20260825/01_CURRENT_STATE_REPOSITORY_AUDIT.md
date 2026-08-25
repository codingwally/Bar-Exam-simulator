# Current-State Repository Audit

Audit date: 2026-08-25
Repository baseline: branch `feature/question-bank-floor-randomizer-20260825`, HEAD `28fc762`; its tracked tree matches `origin/main` at `057076f`
Conclusion: useful reliability foundations exist, but the current Examination Room is not ready for a real class

## Method and authority

This audit traced critical operations from browser to store, Worker route, authorization, RPC/database, response, and visible state. It reviewed repository instructions, examination audits and operations, accessibility/privacy/rollback plans, architecture notes, JavaScript/CSS, local state, Worker core/routes/delivery/renderers, Supabase migrations, tests, and deployment guidance. The current request outranks the Scrimba target; Scrimba outranks verified legacy behavior when defining the future product. Any item not established by source or a controlled test is labeled `UNVERIFIED — REQUIRES IMPLEMENTATION-PHASE CONFIRMATION`.

## Actual architecture

| Layer | Current role | Evidence |
|---|---|---|
| Browser shell | Role entry, Professor operations, Student attempt, grading/results | `assets/duediligence-2026.js`, `assets/duediligence-2026.css` |
| Local durability | IndexedDB journal, answer revisions/hashes/retry/conflict, session epoch, flags | `assets/examination-room-2-store.js`, `assets/exam-session-controller.js` |
| API boundary | JSON commands/queries and upload/PDF/workbook endpoints | `assets/duediligence-2026.js:460`; `worker/duediligence-2026-routes.mjs` |
| Domain core | Validation, import, state/command rules, payload normalization | `worker/exam-room-2026-core.mjs` |
| Delivery/rendering | Email jobs/events, PDF and workbook construction | `worker/exam-room-delivery.mjs`, `worker/exam-result-pdf.mjs`, `worker/exam-results-workbook.mjs` |
| Database | Ownership, publication, attempts, answer ops, grading, releases, delivery queues, audit | `supabase/migrations/202608*.sql` Examination Room migrations |
| Offline shell | Network-first navigation and small static cache | `service-worker.js:1-35` |

Browser database credentials are not the normal mutation path: the Worker holds the service-role boundary and invokes RPCs that check ownership/membership. That separation is worth preserving.

## Critical traces

### Professor creation and publication

1. Browser renders a four-role entry wall and Professor flow in `assets/duediligence-2026.js:1118-1193`.
2. Professor rules collect a required Beadle email and force `studentAccessCodeRequired: true` (`:4381`, `:4440`, `:4531`).
3. Browser calls the common `api(path, body)` wrapper (`:460`) and Worker Examination Room query/command routes.
4. Worker owner checks precede question-source uploads and publication commands (`worker/duediligence-2026-routes.mjs:1562-1601` and adjacent command handlers).
5. Publication creates Beadle-oriented credentials and the UI shows two one-time keys plus a grading key (`assets/duediligence-2026.js:4766` and nearby render logic).
6. Visible outcome depends on a multi-step Professor-to-Beadle handoff rather than a self-contained Professor receipt.

Current defect: authenticated ownership does not yield the simplest publish-and-return experience. The normal path exposes internal credentials and makes an optional support role mandatory.

### Student access, answer, flag, and submission

1. Student enters through role selection and a link/code sequence, then the browser queries admission/publication state.
2. The active-attempt controller uses the local store for answer journal operations, hashes, revisions, retries, conflicts, and submission intents.
3. Answer mutations travel through the Worker to generation/revision-aware RPCs; final submission uses a durable intent and `submit_attempt_generation`-style server transition.
4. Flag toggle at `assets/duediligence-2026.js:5682-5693` calls only the local store.
5. `assets/examination-room-2-store.js:484-510` keys flags by attempt and session epoch; a changed epoch returns no flags.
6. `scripts/test-examination-room-2-store.mjs:334-342` proves only same-session, same-device behavior and expects a different epoch to be empty.
7. `assets/duediligence-2026.js:5572-5585` requests `allowUncoordinatedWrite: true` and then forces `lease.readonly = false`; frontend tests explicitly expect that unsafe override.
8. Submission receipt concepts are durable and generation-aware, but the browser experience still needs real duplicate-device, disconnect, and receipt-recognition proof.

Verified defect: flag persistence is not authoritative across refresh epochs/devices. Verified defect: the UI bypasses the store coordinator's one-writer protection, so duplicate tabs may write concurrently.

### Grading, result release, and amendment

1. Professor enters grading; `assets/duediligence-2026.js:7004-7021` prompts for a grading key on first access.
2. `exam_room_verify_grading_access_v3` in `supabase/migrations/20260811173745_exam_room_real_classroom_simplification.sql:619-669` checks ownership but still returns `GRADING_KEY_REQUIRED` until key verification is remembered.
3. The grading workspace RPC (`:676-818`) is owner-scoped and includes submitted/auto-submitted/sealed attempts even while the class exam is open, so early grading has an architectural basis.
4. Grade save (`:822-932`) is owner-scoped, revisioned, conflict-aware, and records history, but requires an explicit reason of at least five characters for every save.
5. Frontend grading (`assets/duediligence-2026.js:7274-7445`) is question-by-question; it has Save and Save & Next, not a continuous one-page default.
6. Browser drafts are localStorage-only until Save (`:7112-7154`). Unsaved input disables downloads/release (`:7175-7184`), coupling a local UI state to otherwise separate actions.
7. Candidate release migrations create immutable release versions and portal-readable results; selected release requires final grades and queues email after the release snapshot.
8. Lifecycle migration supports end access, complete, and archive, but not whole-class pause/resume or extension.

Strength: early-submitter queries, revision conflict, grade history, immutable candidate-release versions, and portal access are strong foundations. Gaps: redundant key, unclear save semantics, absent one-page mode, incomplete emergency operations, and insufficient amendment/reissue UI proof.

### Email and downloads

1. Result release writes the authoritative portal snapshot, then enqueues notification email in the same database transaction.
2. The email queue claims with token/lease, reclaims stale work, retries up to eight times, and applies exponential backoff up to 60 minutes (`supabase/migrations/20260813190000_examination_room_grade_email_delivery.sql:330-454`).
3. Provider events have precedence so delivered does not regress to accepted/delayed and bounce/complaint outrank intermediate states (`:588-675`).
4. Class export preparation records an export request and reads grade/result data; the reviewed migration does not mutate exam or grade state (`supabase/migrations/20260812015047_examination_room_class_results_dashboard.sql:238-412`).
5. Route tests assert no release side effect, but current frontend places download controls inside grading/result UI and disables them when an unsaved browser draft exists.
6. Human tests reported downloads that failed, were blank, or appeared to remove website grading, and email that failed or was unreliable.

Finding: source-level export separation is promising, but the human failure is not disproven. Deployed-build skew, stale frontend assets, renderer defects, or client-state coupling remain plausible. Production-like reproduction with build/database identifiers is mandatory.

### DOCX, PDF, Gemini, and Assistant Proctor

1. Import maximum is 200 questions (`worker/exam-room-2026-core.mjs:18`).
2. DOCX validation bounds archive entries and paths and rejects macro/external-relationship hazards (`:1543-1576` vicinity).
3. PDF inspection deliberately sets `extractionMode = 'manual_required'`, returns zero questions, and warns that text extraction is not enabled (`:1617-1627`). A test asserts this missing behavior as success (`worker/exam-room-2-core.test.mjs:356-370`).
4. The Worker has server-side Gemini infrastructure, but no verified Examination Room normalization call was found. Current AI grading is explicitly rejected (`worker/exam-room-2026-core.mjs:397-401`).
5. No Assistant Proctor implementation reference was found.

Verified gap: valid text-PDF question import is absent. `UNVERIFIED — REQUIRES IMPLEMENTATION-PHASE CONFIRMATION`: whether any deployed environment contains an untracked Gemini examination-import path.

## Visual and accessibility audit

- `assets/duediligence-2026.css:1-17` declares a dark navy surface and `color-scheme: dark`; cards and modals continue the dark treatment.
- The question navigator at `:181-184` is a rectangular grid, not circular states.
- Examination prompt typography uses Playfair and answer fields use Inter (`:41-45`), not Times New Roman for legal/exam content.
- Clipboard/right-click interception is installed when integrity recording is on (`assets/duediligence-2026.js:5282-5291`, listeners near `:5710-5728`) without a verified assistive-technology exemption.
- The public entry exposes Professor, Beadle, Student, and Exam Administrator as four large choices. This adds role and technical complexity before the core task.

These facts align with the human reports: too dark, too many buttons/cards/screens, too much scrolling, and less intuitive than Google Forms.

## Existing capabilities worth preserving

| Capability | Why preserve it | Renovation constraint |
|---|---|---|
| Local answer journal and operation IDs | Supports offline typing and retry | Make server reconciliation explicit and never silently overwrite newer work |
| Revision/content hashes and conflicts | Enables deterministic concurrency | Show plain-language conflict resolution and retain both versions as evidence |
| Submission generations and receipts | Makes submit/reopen idempotent and auditable | Receipt must be visible, downloadable/printable, and authoritative in portal |
| Owner-scoped grading RPCs | Protects class data | Remove redundant key; add recent reauthentication for sensitive actions |
| Grade history and candidate release versions | Enables corrections without erasing history | Add preview, amendment reason, supersession, and reissue UI |
| Durable email queue and event precedence | Supports retry after Worker/provider failure | Portal must succeed first; add jitter, controlled-inbox proof, and manual retry |
| Export audit records | Supports traceability | Make renderer output verifiable and exports strictly read-only |
| Audit/command receipts | Supports incident reconstruction | Make high-impact actions searchable and human-readable |
| DOCX safety checks | Reduces parser risk | Keep bounds and add fixture/open tests before broadening formats |

## Test evidence and its limit

The inspected repository tests passed: store, frontend, grading/results, class results, 95 core/route tests, and 38 PDF/workbook/delivery tests. This is not a GO signal. Several tests assert current deficiencies or inspect source strings/mocks rather than perform an uncoached browser journey. In particular, tests accept session-epoch-only flags, accept uncoordinated multi-tab writes, and accept PDF `manual_required` as successful parser behavior.

Missing proof includes real Professor return/recovery, real Student duplicate-device behavior, browser file-open validation, controlled inbox delivery, provider event replay, shared-NAT load, simultaneous submissions, rollback during active attempts, accessibility with assistive technology, and production-build parity.

## Service worker and deployment risk

`service-worker.js:1-35` caches a small shell, uses network-first navigation, and does not clearly pin all active examination JavaScript/CSS. Existing rollback guidance correctly warns not to clear IndexedDB or force asset updates during active attempts. The target must add a deployment gate that preserves the active client bundle or provides protocol compatibility across old/new clients. `UNVERIFIED — REQUIRES IMPLEMENTATION-PHASE CONFIRMATION`: current CDN cache and deployed service-worker versions match the audited commit.

## Capacity posture

Current input validation allows up to 500 roster entries and 200 questions. Those are code bounds, not proven capacity. Plan for 200 simultaneous Students and 100 questions at launch; test 500/200 as a stress envelope. Measure answer-save, monitor, submission burst, grading page, result-release email burst, PDF/workbook burst, and Assistant Proctor request load before increasing the supported limit.

## Audit conclusion

The system is not a blank slate. Preserve its server authorization, journal, revision, receipt, history, queue, and audit primitives. Renovate the interaction model and close the state gaps around flags, multi-device ownership, grading drafts, import, emergency controls, exports, and recovery. Treat all deployed behavior and real-world delivery claims as unverified until correlated with commit, migration, asset, Worker, provider, and database evidence.
