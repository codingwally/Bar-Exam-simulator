# DueDiligence.ph Examination Room v1

This is a separate greenfield Examination Room. It does not replace, import, inspect, or reuse the legacy `/examinations/*` implementation.

## Local prototype

- Professor: `http://127.0.0.1:4173/examination-room/?demo=1`
- Student: `http://127.0.0.1:4173/examination-room/student.html?demo=1`
- Administrator: `http://127.0.0.1:4173/admin/?demo=1#examination_room_v1`
- Demonstration room key: `DD26-LAW1-826K`

The local demonstration is deliberately labelled. It stores no school record and sends no email.

## Role lifecycle

### Professor

1. Prepare one long, forgiving examination page.
2. Create questions directly or upload a source document for AI-assisted numbering.
3. Confirm real-name roster, timing, accommodations, grading identity, and optional safeguards.
4. Preview and publish an immutable examination version.
5. Wait for an administrator-issued room key.
6. Enter the key while still authenticated as professor, then open monitoring.
7. Monitor real student names, save/connection state, submissions, and contextual integrity signals.
8. Grade one student at a time; every save creates a revision.
9. Optionally switch the grading view to anonymous mode without changing the roster or result identity.
10. Download a passphrase-encrypted offline grading copy and import it only into the exact same examination version.
11. Release only selected, fully graded results.

### Administrator

1. Open the dedicated `Examination Room` administration menu.
2. Review published examinations and activation state.
3. Issue, rotate, hide, or revoke the room key.
4. Deliver the key to the professor through the protected mail boundary.
5. Create recovery snapshots and inspect backup state without exposing raw answers in the menu.

### Student

1. Enter the room key, real full name, student number, year level, and subject.
2. Preview only examination metadata; questions remain sealed.
3. Review the exact versioned privacy and integrity notice.
4. Use one required agreement action before questions load. The saved agreement is bound to the student, key, exam version, and notice version.
5. Answer, navigate, flag, and continue during a temporary connection loss.
6. Review completion, submit once, and receive a signed receipt.
7. Wait for the professor to release the score, then see total and question-by-question feedback.

## Professor control and identity

- Real names are the default everywhere the professor is entitled to see them.
- Anonymous grading is optional, limited to the grading view, and controlled only by the professor.
- Question order, points, navigation, timing, late-submission policy, accommodations, safeguards, release selection, and feedback remain professor decisions.
- AI suggestions never publish, delete, regrade, release, or silently change the exam.

## Recovery model

- Student answers are written to IndexedDB before network synchronization.
- The student application shell is service-worker cached. A live network-blocked reload restored the active exam, timer, identity, progress, and exact saved answer before reconnection.
- Each answer change is append-only and revisioned.
- Reconnection retries are idempotent.
- Submission freezes the latest answer revision for every question and returns a signed receipt.
- Professor grade saves and result releases are revisioned.
- Administrator recovery snapshots are separate from the live tables.
- Room keys, session tokens, and idempotency secrets are HMACed before persistence.
- The offline grading package uses PBKDF2-SHA256 with 310,000 iterations and AES-GCM, and is refused if its exam/version binding does not match.

## Integrity modes

- **Standard:** authenticated room access, local answer recovery, server synchronization, submission receipt, and professor-controlled grading.
- **Focus monitoring:** fullscreen, page visibility, focus, connection, and related browser signals are recorded for human review. Signals are never automatic misconduct findings.
- **Recorded proctoring:** visible as a future professor option but currently fails closed. Publication is blocked until a complete encrypted media upload, retention, deletion, review-access, and accommodation pipeline is configured and legally approved.

A web page can detect tab visibility and fullscreen exits; it cannot guarantee operating-system lockdown. Any future native lockdown client must be a separately described product.

## Evidence

- Exact selected-image comparison: `qa/reference-vs-implementation-final.png`
- All-pages image atlas: `screenshots/all-pages-contact-sheet.png`
- Disconnected-refresh proof: `screenshots/student-offline-refresh-recovered.png`
- Professor walkthrough: `videos/professor-walkthrough.mp4`
- Student walkthrough: `videos/student-walkthrough.mp4`
- Product research and legal/technical boundaries: `research-and-product-decisions.md`
- Root visual QA ledger: `../../design-qa.md`

## Verified local audit

- Focused Examination Room browser/core/route contracts: `71 / 71` passed.
- Complete existing Worker regression suite: `393 / 393` passed.
- Private database pgTAP-compatible assertions in PGlite: `89 / 89` passed.
- Actual route-to-PGlite lifecycle: `18` successful RPC calls from publication through released student result.
- Security introspection: `21 / 21` private tables use forced row-level security; no unsafe public RPC was found.
- Live browser: professor publish/key/open/monitor/grade/release, administrator key operations, student privacy/answer/submit/result, and a network-blocked active-exam refresh all passed with no current console errors.
- Both MP4 walkthroughs decoded end-to-end with no media errors.

The official local Supabase CLI test could not connect because this workstation's Supabase/Docker stack was not running on `127.0.0.1:54322`. The migration was instead loaded and exercised in isolated PGlite; staging Supabase verification remains a production Go gate.

## Production Go checklist

The local product demonstration is not a production deployment. Production requires all of the following:

1. Apply and verify the private Supabase migration in an isolated staging project.
2. Configure Worker secrets and the authorized mail sender without placing secrets in the browser or repository.
3. Run authenticated professor, administrator, and student staging tests.
4. Prove external encrypted snapshot materialization and restore, concurrent submission, idempotent retry, key rotation, revocation, and result-release drills.
5. Have the participating school, Data Protection Officer, and counsel approve the lawful basis, notice, retention, access, incident-review, accommodation, appeal, and deletion rules.
6. Complete accessibility and supported-browser acceptance testing on actual law-school devices.
7. Keep recorded proctoring disabled until its separate Go gates are genuinely complete.
