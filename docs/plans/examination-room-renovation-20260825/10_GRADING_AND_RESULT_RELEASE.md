# Grading and Result Release

## Product contract

Grading is Professor-owned, revisioned, resumable, and separate from result release. A submitted candidate can be graded while classmates remain active. One-page Student grading is default; question-by-question is optional. A visible server-confirmed save—not a browser draft or downloaded file—is authoritative. Release creates an immutable portal version first; notification follows independently. Corrections create amendments, never overwrites.

## Eligibility and early grading

Only a submitted, auto-submitted, or otherwise sealed submission generation enters the grading queue. The queue shows candidate identity, receipt, submitted time/method, grading status, last saved time/revision, total, and release status. It never reveals answer text for active attempts. Filters include Early submissions, Ungraded, In progress, Final, Released, and Needs attention.

### Diagram 19 — Early grading

```mermaid
flowchart TD
    A[Student receives sealed submission receipt] --> B[Candidate enters Professor grading queue while class may remain open]
    B --> C[Professor opens exact submission generation]
    C --> D[Server verifies owner and sealed status; active peers remain metadata-only]
    D --> E[Create or return revisioned grade draft]
    E --> G[Professor grades without changing examination open state]
    C -->|Wrong/stale generation| F[Failure: submission not sealed, reopened, unauthorized, or query unavailable]
    D -->|Denied| F
    F --> R[Recovery: refresh receipt/generation, wait for seal, use new reopened submission, or escalate with support ID]
    R --> C
```

## One-page grading — default

The page contains the selected Student's full submitted script in order. Each question unit includes Times New Roman prompt and submitted answer, permitted rubric/model answer, point maximum, mark, and Professor feedback. A sticky outline, Previous/Next Student, total, Assistant Proctor, and save status reduce scrolling uncertainty. Large scripts may render incrementally, but find, focus, totals, and drafts remain stable.

The draft is one logical object regardless of view mode. Switching to Question mode changes presentation only. Model answers and rubrics are Professor-only until the chosen result package permits them. The grading page never requires Beadle or grading key; owner authentication plus recent step-up is used for release/amendment.

### Diagram 20 — One-page grading save

```mermaid
flowchart TD
    A[Professor opens one-page submitted script] --> B[Load server draft revision and any same-browser recovery journal]
    B --> C[Edit marks and feedback across questions]
    C --> D[Journal locally and show Saving locally then Syncing]
    D --> E{Server accepts expected grade-draft revision?}
    E -->|Yes or duplicate operation| G[Show Saved at server time, revision, and updated total]
    E -->|No| F[Failure: offline, validation, authorization, stale revision, or timeout]
    F --> R[Recovery: retain all edits, query command receipt, retry idempotently, or open conflict comparison]
    R --> D
```

## Save states and navigation safety

| State | Trigger | Professor-visible text | Navigation rule |
|---|---|---|---|
| Editing | Current value differs from local journal | `Editing` | May remain; leaving triggers immediate journal |
| Saving locally | Durable browser write pending | `Saving on this device…` | Do not close silently |
| Syncing | Server operation outstanding | `Syncing with Examination Room…` | Navigation allowed if journal is durable; status persists |
| Saved | Server acknowledges visible revision | `Saved at 10:42:18` | Safe to navigate/logout/device return |
| Needs attention | Conflict/auth/policy/repeated failure | `Needs attention — your edits are preserved` | Identify affected fields; do not finalize/release |

Autosave may coexist with an explicit `Save now` control, but both use the same idempotent revision contract. Do not require a reason for ordinary draft saves. A reason is required when changing a finalized or released grade.

## Question-by-question mode — optional

Question mode provides a split view and candidate/question navigation for Professors who prefer comparative marking. It reads/writes the exact same grade draft IDs, field operation IDs, totals, and server revision as one-page mode. Mode switches, refresh, and device return cannot clone or discard draft data. Each question displays the Student/submission context to prevent marking the wrong script.

## Grade conflict

A stale write cannot overwrite a newer grade draft. The server returns base/current revisions and field-level changes. The UI preserves the local version and shows Mine, Saved version, and an editable resolution. Non-overlapping changes may be merged deterministically; overlapping marks/feedback require Professor choice. Resolution writes a new revision and audit event.

### Diagram 21 — Grade conflict

```mermaid
flowchart TD
    A[Professor saves grade draft with expected revision] --> B{Server revision still matches?}
    B -->|Yes| C[Write next revision and return saved receipt]
    B -->|No| F[Failure: newer draft exists from another tab/device/session]
    F --> D[Preserve local operations and load field-level saved changes]
    D --> E[Show Mine versus Saved with actor/time and safe auto-merge candidates]
    E --> G{Professor confirms resolution?}
    G -->|Yes| H[Write reconciled new revision and audit conflict resolution]
    G -->|No| R[Recovery: keep both versions, remain Needs attention, resume later without overwrite]
    R --> E
```

## Finalization

`Finalize grade` validates every required mark, total, policy range, and feedback requirement; shows the exact Student/submission generation; and creates an immutable grade version. It does not release anything. The Professor may create a new draft from a final version before release under ordinary grade-correction policy; after release, amendment rules apply. Batch finalization is deferred unless comprehension and error-recovery testing proves it safe.

## Result packages and preview

Required standard packages:

1. **Score only** — total/maximum and grade label where configured.
2. **Score + feedback** — score plus overall/per-question Professor comments.
3. **Full marked script** — score, feedback, questions, submitted answers, and only the model answers/rubrics the Professor intentionally permits.

The package selection is release-versioned per candidate or batch. Preview runs from the final grade version, sealed submission, publication version, and package policy—not live browser form state. It shows the named recipient and exact web/PDF representation. If any source revision changes, the preview becomes stale and confirmation is blocked.

### Diagram 22 — Result preview

```mermaid
flowchart TD
    A[Professor selects candidate scope and result package] --> B[Server validates final grade and sealed submission versions]
    B --> C[Render exact Student portal preview with recipient, content, and exclusions]
    C --> D{Professor confirms preview is correct and current?}
    D -->|Yes| E[Issue short-lived confirmation bound to versions, scope, and package]
    B -->|Missing or stale source| F[Failure: unfinalized grade, changed revision, renderer error, or unauthorized content]
    C -->|Preview fails| F
    F --> R[Recovery: keep grades unreleased, correct/finalize, regenerate from current versions, or use readable web preview]
    R --> B
```

## Individual and selected release

Individual release is appropriate for early grading or a correction schedule. The confirmation names the Student, package, grade version, immediate portal effect, and separate notification. An idempotent release command creates/returns one immutable candidate release version. Selected release uses the same per-candidate receipts and reports mixed outcomes without pretending an atomic all-success result when policy/implementation is not atomic.

### Diagram 23 — Individual release

```mermaid
flowchart TD
    A[Professor confirms one current result preview] --> B[Server rechecks owner, fresh authentication, final grade, candidate, versions, and token]
    B --> C{Release command valid and not already applied?}
    C -->|Yes| D[Create immutable candidate release version and portal receipt]
    C -->|Already applied| D
    D --> E[Make portal result available immediately and enqueue notification]
    B -->|Denied/stale| F[Failure: stale preview, wrong candidate, invalid grade, timeout, or unknown outcome]
    D -->|Response lost| F
    F --> R[Recovery: query idempotency receipt, show existing portal version or regenerate preview; retry notification separately]
    R --> B
```

## Whole-class release

Whole-class release first summarizes eligible, ineligible, already released, and changed-since-preview candidates. The Professor can exclude ineligible/attention items or return to grading. Confirmation binds a frozen eligible set and package policy. The response lists a receipt for every candidate; portal availability is independent of email burst success.

### Diagram 24 — Class release

```mermaid
flowchart TD
    A[Professor selects Release class] --> B[Build candidate eligibility and version manifest]
    B --> C[Preview counts, package, exceptions, and exact recipient set]
    C --> D{Professor confirms current frozen manifest?}
    D -->|Yes| E[Authorize and create idempotent candidate release versions]
    E --> G[Return per-candidate portal receipts and enqueue separate notification jobs]
    B -->|Missing final/stale grade| F[Failure: ineligible candidate, changed manifest, partial/unknown command, or service timeout]
    E -->|Mixed outcome| F
    F --> R[Recovery: query each receipt, preserve confirmed releases, show unchanged failures, correct and retry only eligible missing candidates]
    R --> B
```

## Portal-first notification and retry

Portal release is successful when the candidate release version exists and is authorized for that Student. Email status can be Not queued, Queued, Processing, Provider accepted, Sent, Delivered, Delayed, Failed, Retrying, Permanently failed—always alongside `Portal available`. Provider precedence prevents Delivered from regressing to Sent/Delayed; bounce/complaint remains visible.

Professor may retry an eligible job or correct an address after viewing the consequence. Retry reuses the release version and creates/updates notification job attempts only. Copy portal link/instructions and approved alternate contact remain available.

### Diagram 25 — Failed email and retry

```mermaid
flowchart TD
    A[Candidate portal release exists] --> B[Email job is leased and sent with idempotency]
    B --> C{Provider and delivery events succeed?}
    C -->|Yes| D[Record highest-precedence Delivered status]
    C -->|No| F[Failure: rejection, timeout, Worker crash, stale lease, delayed, bounce, complaint, or retry exhausted]
    D -->|Later lower-precedence event| D
    F --> R[Recovery: reclaim stale job, bounded retry with jitter, correct address, copy portal route, or mark permanent with incident ID]
    R --> B
    D --> E[Portal result remains unchanged and available]
```

## Post-release amendment and reissue

The Professor selects `Amend released result`, sees original grade/comments/release time/delivery history, enters a reason, creates a new draft, finalizes it, and previews old versus new. Fresh authentication and explicit confirmation create an immutable amendment/release version that supersedes the old one. The Student portal labels the latest version and amendment time/reason summary as policy allows. Reissue notification is a separate job.

### Diagram 26 — Post-release grade amendment

```mermaid
flowchart TD
    A[Professor opens released candidate and selects Amend] --> B[Load immutable original grade, comments, release, and delivery history]
    B --> C[Require reason; create new grade draft without editing original]
    C --> D[Finalize and preview old versus new result package]
    D --> E{Fresh-auth confirmation and current versions valid?}
    E -->|Yes| G[Create immutable amendment and superseding portal release receipt]
    G --> H[Show amendment history and enqueue reissue notification independently]
    E -->|No| F[Failure: stale version, invalid grade, unauthorized actor, preview error, or unknown command]
    G -->|Response lost| F
    F --> R[Recovery: preserve original and draft, query receipt, regenerate comparison, retry reissue only]
    R --> B
```

## Downloads in grading/results

Files are read-only jobs against named server-confirmed revisions. If unsynced browser edits exist, explain that the export uses the last server-saved version and offer `Save now` or `Continue with saved version`; do not disable grading or mutate its state. Completion validates MIME/signature/name/content/privacy and real application opening. Failure offers readable web view, browser print, regenerate, and incident ID.

## Authorization and privacy

- Owner-only grade access; optional delegates/Beadles cannot see answers/grades/releases.
- Active answers are excluded from grading and monitoring payloads.
- Recent reauthentication/MFA is required for release/amendment, not a reusable grading key.
- Candidate release queries bind signed-in Student to exactly their release versions.
- Exports/packages include only selected candidates and approved content; neutralize spreadsheet formula injection and preserve leading-zero IDs.
- Assistant Proctor may navigate/read eligible metadata or draft unsaved feedback by explicit request; it cannot save marks, finalize, release, or amend.

## Acceptance

An uncoached Professor grades an early submitter while the class remains open, completes a full script on one page, switches modes without loss, understands every save state, recovers from refresh/device conflict, finalizes separately from release, previews the exact Student package, releases one and a class, continues during email failure, downloads files without affecting grading, and amends/reissues with complete immutable history.
