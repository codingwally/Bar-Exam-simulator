# Examination Room 2.0 beta operations and recovery

## Deployment boundary

- The owner approved Examination Room 2.0 for a beta-wide release on 2026-08-10. The checked-in client entry and production V2 Worker flag are enabled for every admitted Due Diligence beta user. Existing beta authentication and admission controls remain mandatory, and each Professor, Beadle, Student, and Admin action remains subject to its own server-side role check.
- Opening an authenticated 2.0 journey requires all three gates: the environment-local `examinationRoom2` client setting, the server-side base flag `EXAMINATION_ROOM_ENABLED`, and the independent server-side flag `EXAMINATION_ROOM_2_ENABLED`. A false or missing gate must fail closed.
- Staging and the live beta run with both server flags enabled. A later market release remains a separate decision and must not be inferred from this beta deployment.
- This branch is approved for beta-wide access and controlled production deployment.
- Never run the migration against production, publish Pages/Worker production artifacts, or mutate production data without explicit conversation approval.
- Production Pages and Worker workflows are manual-only. Neither workflow runs on a push to `main`; each rejects a non-`main` dispatch, an unchecked production confirmation, or a blank approval/change reference.
- Production environments are restricted to `main`. Because the repository is presently operated by one developer, the recorded owner approval and manual workflow confirmation are the beta release authority. Add independent review before any market release or institutional production rollout.
- Keep the repository’s preview/staging path independent of these production workflows. A successful preview is evidence for promotion, not permission to promote.
- Reconcile the remote Supabase migration ledger first. Prior evidence records noncanonical/directly applied migration names; blind `supabase db push` is unsafe.
- The 2.0 migration is additive. Rollback means returning the Worker/frontend to the prior release while retaining 2.0 evidence tables for forward repair—not dropping answer, operation, submission, audit, or receipt evidence.

## Manual production promotion gate

1. For this beta promotion, record the approved commit SHA, last-known-good Pages deployment, last-known-good Worker version, available backup references, and owner approval reference. Complete the institutional release blockers below before a later market or school-wide release.
2. Dispatch `Deploy Gemini examiner Worker` from `main`, check the explicit production confirmation, and enter the owner-approved change reference.
3. Verify compatibility and confirm that both `EXAMINATION_ROOM_ENABLED` and `EXAMINATION_ROOM_2_ENABLED` are true for the approved beta-wide release.
4. Dispatch `Deploy static content to Pages` from the same approved `main` commit using the same change reference.
5. Record both workflow run URLs, deployed identifiers, smoke-test evidence, and the person who authorized any feature-flag change.

For this owner-operated beta, the owner’s explicit conversation approval plus the manual dispatch record is sufficient. Access is beta-wide, not limited to the owner. Independent review is still required before a market release.

## Release order

1. Freeze a staging backup and export the migration ledger.
2. Verify database backup and the separate private Storage-object backup. Supabase database backups do not include Storage objects.
3. Apply the additive migrations to a production-shaped staging database. For the classroom handoff release, apply `20260811003300_examination_room_class_handoff.sql` before deploying its Worker routes.
4. Run RLS/RPC authorization and migration contract tests.
5. Deploy the compatible staging Worker.
6. Smoke query old and new RPC paths; old active attempts must remain readable.
7. Deploy the versioned static artifact.
8. Run authenticated Professor, Beadle, Student, and Admin journeys.
9. Run a rollback rehearsal: restore the prior frontend/Worker while leaving additive schema intact.
10. Run database + private source-object restore and record measured RPO/RTO.

## Examination Room keys and class flow

### Plain-language classroom instructions

#### Professor

1. Sign in and use the Professor room key from Admin. One room key opens one Examination Room.
2. Create the examination, choose the number of questions, upload or paste the questions, check every question and point value, set the schedule and rules, and enter the Beadle's account email.
3. Publish the examination. Due Diligence shows the Beadle key and Professor grading key once. Send only the Beadle key to the named Beadle. Keep the grading key private.
4. Wait for the Beadle to save the class list. Due Diligence then shows the active student exam code and examination link in the Beadle workspace. The Beadle copies the class handout for the students. The Professor does not create or send the student exam code in this flow.
5. After the examination closes, grade every answer and mark every grade final. Then send the class results in one action. Each student sees only their own result. Downloading one student's PDF does not send or release anything.

#### Beadle

1. Sign in and enter the one-time Beadle key sent by the Professor. Never give the Beadle key to students.
2. Upload or paste the class list, correct any errors, and save the final list.
3. After the class list is saved, Due Diligence creates the class-wide student exam code. The Beadle page shows the active code beside the examination link. Select **Copy class handout** and give the complete handout only to the students on the saved class list at the time set by the Professor.
4. During the examination, use the Beadle workspace to confirm entry and help with approved exam-day concerns. The Beadle cannot see questions, answers, grades, or Professor-only material.

#### Student

1. Get the examination link and student exam code from the Beadle.
2. Sign in with the Due Diligence account whose email appears on the class list. Sign-in is required; the code alone cannot open the examination.
3. Open the examination, enter the student exam code, and complete the class-list, code, device, and connection checks. If the examination has not opened, successful checks place the student in the waiting room only.
4. In the waiting room, read the Professor's numbered instructions and watch the countdown based on Due Diligence server time. Questions, answer fields, and the attempt remain closed before the published opening time.
5. When Due Diligence server time reaches the opening time, select **Start examination**, answer the questions, and submit. Do not treat the examination as submitted until Due Diligence shows a receipt.

#### Early student waiting room

- A student may check in early only after sign-in, active class-list membership, and the student exam code are confirmed.
- Early check-in opens the waiting room, not the examination attempt. It must not return question text or create an answer session before the published opening time.
- The waiting room shows the current Due Diligence server time, a countdown to opening, and the Professor's instructions as a readable numbered list.
- The **Start examination** action and all question navigation remain unavailable until the server confirms that the examination is open.

#### Where each key comes from

| Credential | Created by | Given to |
|---|---|---|
| Professor room key | Admin, from **Admin Dashboard → Examination Room** | The named Professor |
| Beadle key | Due Diligence, when the Professor publishes | The Professor sends it to the named Beadle |
| Student exam code | Due Diligence, after the Beadle saves the class list | The Beadle page shows the active code beside the examination link; the Beadle copies the class handout for the listed students |
| Professor grading key | Due Diligence, when the Professor publishes | The Professor keeps it private |

1. A Due Diligence Admin opens **Admin Dashboard → Examination Room** and creates a Professor key for one named Professor and one named Examination Room.
2. The full key is shown only once. The database stores only its cryptographic hash. The Admin ledger keeps the non-secret key record, room, target email, issuer, expiry, status, and redemption details. If the key is lost, revoke its record and create a new one; it cannot be recovered.
3. The Professor signs in with the exact email named by the Admin and redeems the key. Redemption creates that one Examination Room and assigns it to the Professor in the same transaction. One key cannot create a second room.
4. A Professor who needs another Examination Room must redeem another Admin-issued room key. Free-form room creation is unavailable.
5. Each key-created room accepts one examination. The Professor chooses the number of questions, uploads or pastes the examination, reviews the questions, sets the schedule, and publishes it. The server must confirm every step before the next one opens.
6. Publishing creates two separate one-time secrets: the Beadle key, which the Professor sends to the exact named Beadle, and the grading key, which stays with the Professor. Publication must leave at least thirty minutes before the examination opens so the class can be prepared.
7. The Beadle redeems the short-lived, one-use Beadle key, uploads and checks the class list, and saves the authoritative list. Redemption creates a separate assignment that remains active through the examination hard close, capped at 180 days, unless the Professor revokes it or the examination is sealed. Due Diligence then generates the separate class-wide student exam code. The Beadle page shows the active code beside the examination link and provides one **Copy class handout** action.
8. Every Student must sign in with the exact account on the saved class list and enter the student exam code. A code never replaces sign-in, list matching, admission, or schedule checks.
9. The Professor monitors submissions and grades each answer. Class-wide result release is disabled until every score is final. The Professor may then send the class results in one action; each submitted student receives only their own result. The Professor may instead prepare a candidate-specific PDF without sending anything.
10. Candidate PDFs have exactly three choices: questions with the candidate's submitted answers; submitted answers only; or grades with Professor comments only.

An Admin may list and revoke Professor room-key records, but the dashboard never returns a previously displayed plaintext key. Audit rows answer which Admin issued the record, which Professor redeemed it, which room it created, and when those events occurred.

For this classroom handoff, `publish_for_beadle` atomically fixes the reviewed examination and creates the Beadle invitation. No usable student code exists at publication. The Beadle can save the class list only before the examination opens and before any attempt exists; `issue_student_access` creates or rotates the first usable student code and locks the list for that examination. The Beadle interface then shows the active class-wide code beside the examination link and provides one **Copy class handout** action. A tightened `start_attempt` refuses an unpublished or unprepared examination, so a partial handoff is never student-visible. Professor room keys, Beadle keys, and Professor grading keys remain protected secrets; do not infer a database storage design for the active student-code display from this interface wording.

The database migration, Worker, and Pages must be promoted in that order. Migration-first is backward-compatible because the older scheduling path keeps its roster requirement; Worker-first is unsafe because the new handoff functions would not exist yet.

A pre-start replacement is a separate, audited flow: eligibility is re-read from the server; a corrected question source is staged as a distinct confirmed version without changing the live publication; Rules and Publish are reviewed again; and the replacement RPC atomically verifies the expected current publication, pre-open state, zero attempts, and staged corrected version. Only then does it activate the new immutable publication and rotate credentials. Any failed or abandoned staging leaves the current publication and credentials authoritative. After the first attempt or opening time, corrections use errata or an explicit stop notice.

## Fail behavior

| Operation | Failure behavior |
|---|---|
| Active typing | Fail open to the current device’s IndexedDB journal. The UI distinguishes local save from server sync. |
| Answer synchronization | Bounded jittered retry. Per-answer idempotent operation IDs and server revisions prevent blind whole-exam overwrites. |
| Final submission | Remains “Submission pending — not yet received by Due Diligence” until a server receipt. Duplicate retries use one intent key. |
| Receipt observed after reload/status polling | Display only when the server reports a closed attempt with both a receipt ID and received time. Reconcile that receipt into the device journal before display, then retain confirmed browser-local recovery data for up to seven days before cleanup. A local reconciliation failure does not invalidate the server receipt; show the retention warning and preserve the local evidence for retry/dispute. |
| Publishing, role grants, roster changes, accommodations, admission, privileged access | Fail closed. |
| Student exam code | The new classroom handoff always freezes code protection on. The Beadle may create the usable code only after saving a valid class list. It is an additional barrier only: the signed-in account, active class-list entry, admission, publication, and schedule are all rechecked by the server. A missing or unknown readiness state blocks start. |
| Pre-start publication replacement | Requires an explicit corrected-question staging step, expected-publication lock, zero attempts, pre-open state, reason, confirmation, and successful atomic credential rotation. Staging never mutates the live version. |
| Candidate submission reopen | Owning Professor only with the exam grading key, exact attempt, reason, and a deadline no more than four hours away. The owner monitor uses the dedicated answer-free `live_status_v2` projection and renders Reopen only when `canReopenSubmission` is explicitly true. The grading key is cleared before each request and is not retained in page state. Reopen creates a linked generation and fresh session requirement; it never unlocks or overwrites the prior receipt/snapshot. An Admin may use only an exact active break-glass grant under fresh AAL2. |
| Suggested/model answers | Beta publication accepts pasted text or no model answer. File upload and its upload endpoint fail closed with `EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE` until audited owner-only retrieval is implemented. |
| Dispute/break-glass review | Inherited broad Admin dispute operations remain disabled and are absent from the public bundle. The protected Admin Dashboard defaults to metadata only. The candidate-scoped contract requires the exact exam, attempt, candidate, case reference, purpose, expiry of no more than four hours, a server-derived fresh AAL2 session (maximum age 15 minutes), and explicit issue/view/review/close capabilities. Every read repeats the grant and exact scope; page export is blocked. On completion, the grant closes first and candidate evidence is removed, then the mandatory post-access review is recorded. If that second call fails, the dashboard retains only a closed/review-required recovery state and never reopens the evidence. Although those scoped operations are wired, the browser gate is intentionally hard-disabled because the current Admin bundle does not perform Supabase MFA challenge + verify; refreshing `/admin/session` is status refresh, not step-up authentication. |
| Browser integrity/monitoring transport | Non-authoritative; never automatically fails/submits/destroys an attempt. |
| Parser | Reject unsafe input or fall back to manual construction. Never auto-publish parser output. |
| Google backup/email | Queue/retry asynchronously; never block the authoritative examination transaction. The per-exam workbook is service/admin controlled, is not shared with the Professor during the exam or grading, and is used only for backup and authorized sealed-dispute recovery. Professor grading occurs through the website. |

## Candidate incident workflow

1. Candidate keeps the page/device open where possible.
2. Beadle records a technical incident without answer content.
3. If the same device returns, queued operations reconcile by operation ID and revision.
4. A new device restores only server-synchronized work.
5. A returning authorized device checks its device-bound session envelope before requesting a new session. It may use the last cached authorized attempt bundle only when that retained session exists and the live attempt query fails with a transient transport error; server time is then shown as unavailable until reconnection.
6. Session transfer requires the owning Professor or an active exam-scoped Beadle, a reason, a recent approved physical/institutional/manual verification outcome, old-epoch invalidation, and an audit event. A global Admin is not an exam-day operator.
7. Local work under the old epoch is quarantined as recovery evidence and is never replayed blindly. A stale retained session is cleared from the active envelope before recovery guidance is shown.
8. Candidate-specific relief uses an audited deadline extension/accommodation; a global pause is not the default outage control.

## Bad frontend release

- Active attempts pin the immutable publication/version and server session epoch.
- Do not force a service-worker/front-end activation during an active attempt.
- Promote static assets with versioned URLs and retain the prior artifact for immediate rollback.
- If a release breaks the UI, restore the prior artifact; do not delete IndexedDB. The local journal is versioned independently.

## Emergency disable and rollback

1. Stop new Examination Room 2.0 entry by setting `EXAMINATION_ROOM_2_ENABLED` to `false`; use the base `EXAMINATION_ROOM_ENABLED` flag as the wider Examination Room kill switch when required. Apply either change through an explicitly approved configuration release and confirm the API rejects the intended operations; do not rely on the hidden frontend control or static client gate.
2. If the Worker is unhealthy, promote the recorded last-known-good Worker version. If Pages is unhealthy, redeploy the recorded last-known-good Pages artifact/commit. Use the same manual workflow and protected-environment approval path, marking the approval reference as an emergency rollback.
3. Preserve active-attempt evidence, IndexedDB journals, database rows, private source objects, submissions, receipts, audit records, and outbox events. Do not drop additive 2.0 objects or improvise destructive rollback SQL.
4. After service restoration, reconcile active sessions and pending submission receipts before re-enabling entry. Feature re-enablement requires a new explicit approval and recorded smoke test.

## Queue and classroom load

- Use authenticated actor + attempt/session limits for autosave, not a low IP-only classroom limit.
- Jitter debounce and retry traffic.
- Test shared-NAT autosave and a simultaneous submission/reconnect burst at the expected beta volume.
- Queue claims require leases/reclaim after Worker failure; sequencing must not use an unlocked `max()+1` pattern.

## Institutional release blockers

- production-shaped staging verification of corrected-question replacement, optimistic publication locking, zero-attempt/opening races, credential rotation, notification queues, and rollback to the still-preserved prior snapshot;
- two-device/authenticated staging verification of reopened submission lineage, grading-key denial, fresh-session issuance, prior receipt/snapshot preservation, four-hour deadline bounds, and final submission status/history;
- authenticated staging verification of the Beadle-created student-code flow, including wrong, missing, rotated, expired, and correct code behavior while sign-in and class-list matching remain mandatory;
- durable server-enforced one-way navigation across reload/session recovery; new beta authoring therefore disables one-way mode;
- owner-only retrieval of uploaded model-answer files after hard close; paste mode is usable, while new upload selection is disabled;
- implement and verify an actual Supabase MFA challenge + verify ceremony in the Admin Dashboard, then production-shape test the server-derived, non-refresh-AMR-backed, 15-minute fresh-AAL2 break-glass gate; until that UI exists, the local `stepUpUiAvailable` gate remains false and all candidate-evidence actions stay disabled even when the server reports AAL2;
- real staging Google write/read/permission-audit/revocation and Resend delivery/retry tests, including proof that no Professor Drive permission is granted;
- database advisor review with no unexplained warnings;
- migration-ledger reconciliation and production-shaped rehearsal;
- database + private Storage restore drill with recorded RPO/RTO;
- authenticated browser/device, keyboard, zoom/reflow, and screen-reader evidence;
- DPO/counsel decisions listed in `examination-room-2.0-sources.md`;
- protected production environments/manual promotion gates for Pages and Worker workflows;
- tamper-evident external audit retention if the product will call audit evidence tamper-evident or immutable.

## Supported beta device statement

Pending the final browser matrix, serious beta examinations support desktop/laptop and tested tablet-class viewports only. Phones are blocked by preflight. IndexedDB, secure randomness, Web Crypto, and direct server reachability are required. BroadcastChannel is used where available; its absence must be disclosed because cross-tab coordination is weaker. No platform may be advertised until its authenticated flow passes the matrix.
