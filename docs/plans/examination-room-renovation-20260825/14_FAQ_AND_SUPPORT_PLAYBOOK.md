# FAQ and Support Playbook

## Support principles

1. Keep the person working safely before diagnosing deeply.
2. Treat the portal and server receipts as authoritative; preserve local journals.
3. Never ask for a password, one-time secret, service key, or answer text in ordinary support.
4. A timeout is an unknown outcome until the command/receipt is queried.
5. Email, exports, and AI are independent; isolate their failure rather than changing exam/grade/release state.
6. Use plain language and an incident/support ID; keep technical detail in the authorized diagnostics view.
7. Escalate privacy/authorization or acknowledged-data loss as P0 and stop new entry/deployment as appropriate.

## Professor FAQ

### How do I get access?

For launch, submit an institutional request. Wally verifies your identity, school/course, expected class size, exam date, and support needs, then provisions a private sandbox. Passing sandbox readiness and release gates is required before production activation.

### Do I need a Due Diligence account?

Yes. Use a verified institutional account with MFA/step-up authentication. Your account and owner membership—not an old email, secret URL, Beadle, or grading key—restore your workspace.

### Can I run more than one examination?

Yes. One Professor workspace supports multiple class contexts and examinations. Every exam is a separate versioned event within its class context.

### Must I use a Beadle?

No. A Beadle is optional logistics support. You can publish and operate alone. An invited Beadle cannot see Student answers, model answers, grades, or release controls.

### Should I use simple or roster access?

Simple classroom mode is the default: authenticated Students use the link/code and provide minimal identity fields. Use roster mode when the school needs pre-approved candidates or tighter identity matching. Ambiguous duplicates are blocked for your resolution.

### Can I create an exam manually?

The target provides a short Basics → Questions → Access/timing → Review stepper with revisioned draft saving. This remains a release-blocking requirement, not a claim about current readiness.

### What files can I import?

Launch target: bounded safe DOCX and text-based PDF. Encrypted, corrupt, unsafe, oversized, or scanned/image-only PDFs fail honestly. For scans, obtain a searchable PDF or enter content manually; OCR is deferred.

### Does Gemini change my questions?

No. If you opt in, it proposes numbering/structure for selected material and marks uncertainty. You compare the source and approve or edit every question. Gemini failure leaves deterministic/manual creation available.

### What happens after Publish?

The server creates an immutable portal receipt first, containing the version, link/code, rules, and next action. Notifications are queued separately. A response timeout is recovered by finding the command receipt, not by creating duplicate publications.

### What if email fails?

The exam/result remains available in the portal. You can see queued/delivered/failed status, retry eligible notifications, correct an address, copy the portal route, or print instructions. Email cannot reverse publication or release.

### Can I grade before everyone finishes?

Yes. Any sealed early submission enters the grading queue while active Students remain metadata-only. You cannot see an active answer through monitoring/grading.

### How do I know my grading is saved?

The target shows Editing, Saving on this device, Syncing, Saved at a server time, or Needs attention. `Saved` appears only after the server confirms the visible revision. Refresh/device return loads confirmed work and offers explicit reconciliation for pending/conflicting edits.

### Can I grade one Student on one page?

Yes; that is the default target. Optional question-by-question mode uses the same draft and revision. Switching modes cannot lose or duplicate marks/comments.

### Does downloading change my exam or grades?

It must not. A file is a read-only job against a named saved snapshot. If a file fails, use web view, browser print, regenerate, or the incident ID. Any state change or lost online grading is a P0/P1 blocker.

### How do I release results?

Finalize grades, choose Student(s) and one of the standard packages, preview exactly what each will see, then confirm. Individual, selected, and class release create immutable portal versions. Notification follows separately.

### How do I correct a released grade?

Use Amend released result. Enter a reason, create/finalize the new grade version, compare old/new, reauthenticate, and confirm. The old result/history remains; the new portal version supersedes it and notification can be reissued.

### What can I do during an incident?

Use metadata-only monitoring and scoped controls: pause/resume, extend one/selected/all, transfer a session, reopen an accidental submission, or close entry/end under policy. Every mutation shows target/effect, requires authorization and sometimes reason/fresh authentication, and returns a receipt.

### What can Assistant Proctor do?

It can navigate, explain, find owner-scoped records, summarize operational metadata, and prepare a permitted command. It cannot directly mutate the database, see another Professor's data, grade, finalize, release, or replace ordinary controls. If it fails, continue normally.

### How do I cancel?

A draft can be cancelled without Student exposure. After publication, cancellation retains all versions/audit and communicates impact. With active attempts, pause and assess first; never delete answers. Commercial cancellation/refund terms remain an owner decision.

## Student FAQ

### How do I enter?

Open the institution/Professor link or Examination Room, sign in, enter the exam code if not prefilled, and confirm your name, student number, and institutional email. Complete the readiness check. The code locates the exam; your authenticated identity grants access.

### Why am I in a waiting room?

You are eligible but the server has not authorized start yet, or the exam is paused. The page shows server-timed status and updates safely. Refresh/reconnect returns to the same admission.

### What if my identity is not matched?

No roster details are exposed. The system creates a resolution request for the Professor. Correct your account/fields if prompted, then retry after resolution; do not create multiple identities.

### What do the circles mean?

Each circle is a question. Outline means unanswered, filled/check means answered, a flag marker means flagged, a double ring means current, a clock means sync pending, and a red/exclamation state needs attention. Labels provide the same information to assistive technology.

### Does Flag survive a refresh?

The target requires flag operations to save locally and synchronize to the server just like answer operations. They must survive navigation, refresh, reconnect, and an authorized replacement device. A pending/failed flag remains visible and is never silently cleared.

### How do I know my answer is safe?

`Saved on this device` means a durable local journal exists. `Saved to Examination Room at [time]` means the server confirmed that revision. `Needs attention` identifies the affected question and preserves your text for recovery.

### Can I keep typing offline?

Yes, while the active-attempt policy permits. The browser journals your work and shows Offline. On reconnect it reauthenticates and replays operations in order. It never silently overwrites a newer version; a conflict preserves both.

### What if I close or refresh?

Reopen the same route and sign in. Confirmed server work returns; same-device pending journal work is offered for recovery. Do not clear site data. The server timer continues unless the Professor has paused the exam.

### Can I use two devices?

Only one has the write lease. The second is read-only. To continue there, request a deliberate transfer that compares pending work, revokes the old lease, and returns a receipt. Do not type independently on both.

### What if I lose my device?

Sign in on a replacement and request transfer. Server-confirmed work returns. Any unsynced work stranded on the lost device cannot be invented; the Professor sees the incident metadata and follows the approved recovery policy.

### What happens when time reaches zero?

The browser/server creates an idempotent auto-submit intent. You receive the authoritative receipt or a concrete pending/recovery screen. Repeated requests cannot create multiple submissions.

### What should I check before Submit?

Final review displays every real prompt/answer, unanswered state, flag, and sync status. Resolve pending/attention items if possible. Confirmation names any remaining items and explains that normal editing will end.

### How do I know submission succeeded?

Only the server receipt proves it. It shows receipt ID, server time, attempt generation, and answer count/method. Keep it in the portal or print/copy it. A spinner or email is not proof.

### I submitted accidentally. What now?

Tell the Professor with your receipt ID. If policy permits and no prohibited downstream action occurred, the Professor may reopen a new generation with reason/deadline. The original receipt remains immutable.

### Where are my results?

Sign into the same portal. Released results appear there even if no email arrives. The page identifies the release/amendment version and approved package. You can see only your result.

## Optional Beadle FAQ

### What can I do?

Within the invited exam, you may help with roster exceptions, waiting-room metadata, identity-correction requests, incidents, and session-transfer requests. Every action is attributable and revocable.

### What can I not see or do?

You cannot see questions before authorized Student visibility, active/submitted answer text, model answers, grades, Professor comments, release controls, or protected exports. You cannot publish, grade, release, amend, or use Assistant Proctor to bypass those limits.

### Can the Professor run without me?

Yes. You are optional and never carry the only link/key or recovery route.

### How do I resolve a duplicate identity?

You may collect/forward the request metadata, but the Professor or approved policy makes the binding decision. You cannot browse the roster beyond scoped fields or merge candidates yourself unless explicitly permitted.

### Can I extend time or reopen a submission?

Not directly in the recommended launch role. You may request an intervention with candidate/reason; the Professor reviews and confirms it.

### What if I see a save/connection problem?

Record the candidate, time, visible status/support ID, and device/network metadata—never the answer text. Ask the Student not to clear browser data; notify the Professor.

### How is my access removed?

Professor/Admin revokes the scoped invitation; current session expires; all prior actions remain audited.

## Wally / Owner / Admin FAQ

### What must I verify before provisioning?

Professor identity/employment, school, subject/course/section, candidate/question scale, date/time zone/duration, access mode, accommodations, optional Beadle, privacy/retention terms, support contacts, and sandbox readiness.

### What do I monitor?

Version/readiness health, counts/latency/errors, stuck submission intents, failed answer/flag sync metadata, failed grade saves/conflicts, release receipts, notification/export jobs, and Assistant Proctor errors. Do not load answer text into monitoring.

### May I use service-role access to fix a record?

Not routinely. Service-role capability does not make Admin a co-Professor. Use ordinary owner flows or narrowly approved candidate-specific break-glass with fresh MFA, reason, expiry, immutable audit, and independent review. Never silently change a grade/release/receipt.

### How do I disable new entry safely?

Use the audited entry-control/incident operation while preserving active attempts, local journals, server sessions, and published versions. Do not archive/cancel/delete as a shortcut.

### How do I handle a stuck command?

Search its idempotency/command ID, determine confirmed/already applied/rejected/unknown, and return the receipt. Do not repeat until the original outcome is known.

### How do I recover a bad deployment?

Freeze rollout/new entry, inventory active versions/journals, pin compatible active bundles, route new loads to last-known-good, preserve DB/IndexedDB, verify critical flows, and execute the rehearsed rollback. Never force reload/clear storage during attempts.

### How do I retry jobs?

Check domain state first, then retry only the independent email/export/AI job with its idempotency and lease rules. A job retry may alter only job/artifact/audit records.

### When do I view Student answer text?

Only when specifically authorized, necessary, candidate-scoped, time-limited, and audited. Most recovery uses revisions/hashes/status/receipts without content. Never bulk-view answers for routine support.

### How do I revoke Professor access?

Revoke membership/sessions with reason and preserve ownership/audit/retention obligations. Decide how ongoing/open exams transfer or stop before revocation; never orphan active attempts.

### How do I archive/cancel the service relationship?

Complete/cancel exams through their legal lifecycle, resolve active attempts/incidents/jobs, apply retention/export/deletion policy, revoke access, and record the commercial closure. Archive is not deletion.

### What makes a launch GO?

All release-blocking criteria pass on recorded versions; real files/inbox/disconnect/load/accessibility/rollback and uncoached human journeys pass; independent audit signs; privacy/support readiness is approved; Wally records a dated GO. Otherwise it is NO-GO.

## First-response playbook

1. Ask: `Are Students actively taking the exam?` and `Is anyone unable to preserve or submit work?`
2. Record exam ID, candidate/receipt/job ID if applicable, exact visible message/support ID, local time/time zone, browser/device, connection state, and last confirmed saved time.
3. Tell users not to clear browser data, create duplicate attempts, repeatedly submit/release, or share credentials.
4. If active data/authorization is at risk, declare P0, stop new entry/deployments, preserve versions/logs, and consider Professor-authorized pause.
5. Query authoritative state and command receipts before retry. Compare browser-local pending evidence without copying content into general support.
6. Isolate email/export/AI failures; confirm the portal/domain state remains intact.
7. Execute only the least-privileged documented recovery; issue a receipt and revalidate the user's journey.
8. Close only after reconciliation, user continuation, evidence capture, regression creation, and independent review.

## Messages support should use

- `Your work is preserved on this device. Keep this tab/device and do not clear browser data while we reconnect.`
- `The server has not yet confirmed this action. We are checking its receipt before retrying.`
- `Your result is available in the portal. The notification failed and can be retried separately.`
- `The file job failed; your examination and grading state did not change. Use the web view/print option or regenerate.`
- `This device is read-only because another session holds the writing lease. Use Continue on this device to transfer safely.`

Avoid `Something went wrong`, `probably saved`, `try again repeatedly`, `sent` when only queued, or `complete` without a server receipt.
