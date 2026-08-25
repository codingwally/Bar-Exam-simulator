# Student Journey

## Journey contract

The Student journey is **access → sign in → identify → preflight → wait if necessary → start → answer → flag/navigate → save/sync → review → submit → receipt → later portal result**. It must remain calm under weak connectivity and clear under time pressure. The system preserves typing locally, confirms authoritative server sync, prevents silent overwrite, and never makes email the sole route.

## Access modes

### Simple classroom mode — default

The Student opens the institutional Examination Room, signs in, enters an exam code or follows a deep link, then confirms legal/display name, student number, and institutional email. The server binds the account to a candidate record. An exact unique match proceeds; an ambiguous duplicate is blocked for Professor resolution. The code locates the exam—it is not a bearer credential that bypasses identity.

### Diagram 10 — Student access in simple mode

```mermaid
flowchart TD
    A[Student opens institutional link or enters exam code] --> B[Sign in and confirm name, student number, and email]
    B --> C[Server authorizes publication and binds unique candidate identity]
    C --> D{Identity unique and access window valid?}
    D -->|Yes| E[Show exam identity, rules, device/network preflight, and Start or Waiting state]
    D -->|No| F[Failure: duplicate identity, wrong account/code, closed window, or unavailable service]
    C -->|Network fails| F
    F --> R[Recovery: preserve entered non-secret data, retry sign-in, select correct account, or request Professor identity resolution]
    R --> B
```

### Roster-controlled mode — optional

Professor uploads or enters a minimal roster. Sign-in matches account/email/student number to one expected candidate. A mismatch never exposes roster data; it creates a pending identity-resolution item. Beadle may forward the request but only Professor or authorized policy can resolve it.

### Diagram 11 — Student access in roster mode

```mermaid
flowchart TD
    A[Student follows roster-controlled exam route] --> B[Sign in and submit minimal identity fields]
    B --> C[Match against owner-scoped roster without revealing other entries]
    C --> D{Exactly one eligible match?}
    D -->|Yes| E[Bind account to candidate and run preflight]
    D -->|No| F[Failure: no match, duplicate match, already bound account, or ineligible status]
    C -->|Roster service fails| F
    F --> R[Recovery: create audited resolution request; Professor corrects identity or roster and Student retries]
    R --> C
```

## Identity and preflight

The preflight page shows exam title/course, Professor, scheduled window/time zone, duration/accommodation, permitted materials, connectivity/save explanation, duplicate-device rule, privacy notice, and support route. It checks browser/storage/time skew/network without claiming that a check guarantees future reliability. Clipboard behavior remains normal unless a narrowly justified rule is approved; assistive technology and accommodation paths cannot be broken.

## Waiting room

The waiting room uses server time and plainly states why the Student is waiting. It shows identity, exam, scheduled start/time zone, device/network status, and a test-save status without question content. Start appears automatically only after server authorization; refreshing or reconnecting returns to the same admission record.

### Diagram 12 — Waiting room

```mermaid
flowchart TD
    A[Eligible Student completes preflight] --> B[Server creates or returns idempotent admission]
    B --> C{Can attempt start now?}
    C -->|Yes| D[Create/return attempt generation and show Start]
    C -->|Not yet| E[Show server-timed waiting room and bounded refresh]
    E --> C
    C -->|No| F[Failure: paused/cancelled exam, window closed, identity hold, or stale client]
    B -->|Connection fails| F
    F --> R[Recovery: keep admission receipt, reconnect/reload, update status, or route identity issue to Professor]
    R --> B
```

## Examination workspace

The active workspace has a restrained header (exam title, save state, server-aligned remaining time), Times New Roman prompt and answer text, one primary answer area, a circular question navigator, Flag control, and Review/Submit. Instructions and permitted materials are accessible without covering the answer. Technical identifiers live only in a support detail.

Time is server-authoritative. The browser displays an estimated countdown and corrects drift without abrupt unexplained loss. At zero, it creates an idempotent auto-submit intent and shows the receipt or a recovery state. A pause freezes effective elapsed time on the server, not only the display.

## Answer save and sync

Every edit first enters a device-local journal with attempt generation, question ID, operation ID, base server revision, content hash, and timestamp. The UI may say `Saved on this device` only after journal commit. It says `Saved to Examination Room at 10:42:18` only after an authorized server acknowledgment. Retries reuse operation IDs. Conflicts never silently choose the server or client version.

### Diagram 13 — Answer save and sync

```mermaid
flowchart TD
    A[Student edits answer] --> B[Append operation to local durable journal]
    B --> C[Show Saved on this device]
    C --> D[Send operation ID, base revision, and content hash]
    D --> E{Server accepts authorized next revision?}
    E -->|Yes| G[Mark journal operation confirmed and show server saved time]
    E -->|Duplicate operation| G
    E -->|No| F[Failure: offline, timeout, stale revision, revoked session, or server error]
    F --> R[Recovery: retain pending operation, retry idempotently, or preserve both versions for explicit reconciliation]
    R --> D
```

### Diagram 14 — Offline and reconnect

```mermaid
flowchart TD
    A[Connectivity drops during active attempt] --> B[Continue typing into local journal and show Offline — saved on this device]
    B --> C[Queue answer and flag operations in original order]
    C --> D{Connection returns before/after deadline under server policy?}
    D -->|Yes| E[Reauthenticate session and reconcile server revision]
    E --> G[Replay accepted operations idempotently and show confirmed sync]
    D -->|No or policy rejects| F[Failure: session expired, deadline exceeded, or newer conflicting server/device revision]
    E -->|Conflict| F
    F --> R[Recovery: freeze local evidence, show exact unsynced scope, request authorized Professor recovery without overwriting either copy]
    R --> E
```

## Flag persistence and circular navigation

Flag is an attempt/question property with the same local-journal and server-revision discipline as an answer. It persists across navigation, refresh, reconnect, and authorized replacement device. The circular navigator combines state without color alone: current (double focus ring), unanswered (outline), answered (filled with check), flagged (gold flag marker), sync pending (small clock), and needs attention (red ring plus accessible label). Full visual tokens are in [06_UX_AND_VISUAL_SYSTEM.md](06_UX_AND_VISUAL_SYSTEM.md).

### Diagram 15 — Flag persistence

```mermaid
flowchart TD
    A[Student toggles Flag on a question] --> B[Journal flag operation with question, attempt generation, operation ID, and base revision]
    B --> C[Update circular navigator locally and announce state]
    C --> D[Sync flag operation to authoritative attempt record]
    D --> E{Server confirms current revision?}
    E -->|Yes or duplicate| G[Show confirmed flag across workspace and final review]
    E -->|No| F[Failure: offline, stale revision, refresh epoch, or replacement device]
    F --> R[Recovery: restore journal, fetch server flag, reconcile ordered operations, never silently clear]
    R --> D
```

## Duplicate tabs and devices

One active session holds the write lease. A second tab/device is read-only and shows which session is active. The Student may continue there only through a deliberate transfer: verify identity, compare unsynced evidence, revoke the old lease, synchronize or quarantine its pending operations, then issue a new lease. Mere refresh of the same session must not create a duplicate attempt.

### Diagram 32 — Duplicate-device recovery

```mermaid
flowchart TD
    A[Second tab or device opens the same attempt] --> B[Server and local coordinator detect active write lease]
    B --> C[Open second session read-only with last confirmed answers]
    C --> D{Student requests Continue on this device?}
    D -->|No| E[Remain read-only; active device continues]
    D -->|Yes| G[Reauthenticate and compare pending operations on both sessions]
    G --> H{Safe transfer confirmed?}
    H -->|Yes| I[Revoke old lease, reconcile evidence, issue new lease, record receipt]
    H -->|No| F[Failure: conflicting unsynced edits, unreachable old session, or identity mismatch]
    B -->|Coordinator unavailable| F
    F --> R[Recovery: keep both copies immutable, block writes, and request scoped Professor/Admin resolution]
    R --> G
```

## Final review

Review shows actual question prompts and the Student's current answer excerpts/full answers, answer/save status, flag state, unanswered state, and remaining time. Selecting an item returns to it without losing text. A final server synchronization check distinguishes confirmed, pending-on-device, and needs-attention answers. Submission cannot misrepresent pending work as synced.

### Diagram 16 — Final review

```mermaid
flowchart TD
    A[Student selects Review] --> B[Show every prompt, actual answer, flag, unanswered, and sync state]
    B --> C{Any pending, conflicting, or unanswered item?}
    C -->|No| D[Enable final submission confirmation]
    C -->|Yes| E[Student opens item or requests sync retry]
    E --> B
    B -->|Review load differs from local journal| F[Failure: stale server snapshot or unreadable local evidence]
    E -->|Sync cannot confirm| F
    F --> R[Recovery: preserve attempt/time policy, label exact affected items, reconcile or obtain authorized assistance]
    R --> B
```

## Submission and receipt

Final confirmation states that submission ends normal editing and names unanswered/pending items. The browser first persists a submission intent, then sends an idempotency key and expected attempt generation. The server seals the accepted revision and returns an authoritative receipt. Repeated clicks/timeouts return the same receipt. Auto-submit uses the same contract and is labeled accordingly.

### Diagram 17 — Submission and receipt

```mermaid
flowchart TD
    A[Student confirms final submission or timer reaches zero] --> B[Persist local submission intent and stop new edits]
    B --> C[Send idempotency key, attempt generation, and last known revisions]
    C --> D{Server accepts or already processed intent?}
    D -->|Yes| E[Seal submission and return authoritative receipt]
    E --> G[Show receipt ID, server time, generation, answer count, and portal route]
    D -->|No| F[Failure: pending operations, conflict, timeout, invalid generation, or unavailable server]
    E -->|Response lost| F
    F --> R[Recovery: query intent/receipt idempotently; show existing receipt or exact authorized recovery path]
    R --> C
```

The receipt is available in the portal and supports browser print. It includes no peer/class data. Email may notify but is not the receipt authority.

## Later result portal

The Student signs into the same portal and sees Released results only for their candidate identity. The page identifies exam, release/amendment version, released timestamp, package contents, score/feedback as authorized, and download/print options. A superseding amendment is prominent; previous versions remain available only according to approved policy and audit requirements. A failed email does not hide the result.

## Student-facing save language

| State | Exact intent | Allowed behavior |
|---|---|---|
| Editing | Keystrokes not yet durably journaled | Do not navigate silently; journal immediately |
| Saved on this device | Local durable operation exists | Student may continue; warn before clearing site data/device transfer |
| Syncing | Authorized server confirmation pending | Continue typing; retain ordered operations |
| Saved to Examination Room at *time* | Server acknowledged current visible revision | Safe normal navigation |
| Needs attention | Conflict/session/policy prevents confirmation | Preserve text, identify affected question, provide recovery action |
| Submitted — receipt *ID* | Server sealed the generation | Normal editing locked; receipt and reopen policy available |

## Student acceptance

Across laptop, tablet, permitted mobile, strong/weak/offline connections, refresh, duplicate device, and accessibility needs, Students must enter uncoached, understand question circles, find a flagged item, distinguish local from server save, review actual answers, submit once, recognize the receipt, and later find portal results. Each critical flow is repeated at least five times; zero confirmed work may be lost.
