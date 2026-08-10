# Examination Room 2.0 beta privacy impact and decision register

Status: engineering draft for owner/DPO/Philippine-counsel review. It is not an approved PIA, privacy notice, contract, records schedule, or legal opinion.

## Data-minimization decisions implemented

- Student authority uses an authenticated account plus normalized roster match; a shared link/code is not identity.
- Beadle and Professor invitations record outcome/scope/account/expiry rather than broadly exposing supporting evidence.
- The roster requires primary email and candidate/student identifiers. Name is optional. A secondary recovery email is not collected because no complete pre-verification/recovery pipeline exists.
- Accommodations expose operational settings—not diagnoses—to the Beadle.
- Browser integrity records are client-reported, grouped signals; audit metadata must not contain answer text, credentials, contact fields, network identifiers, diagnoses, or camera data.
- Camera capture, continuous webcam/audio, facial recognition, biometric templates, gaze/emotion analysis, and screenshot capture are absent/off.
- Institutional AI grading is absent/off. Manual Professor decisions remain official.
- Suggested/model answers are either pasted into the private Professor-only publication record or omitted. File upload is disabled until an audited owner-only retrieval path exists.
- The Beadle operations response excludes questions, model answers, live answer text, grades, and backup contents.
- Admin’s default operations view excludes answers and grades. Candidate-scoped break-glass remains disabled until AAL2, narrow server capability, expiry, per-read audit and post-review exist.
- Per-exam Google backup workbooks remain under the configured Due Diligence service/admin Drive principal and are not shared directly with the Professor. Professors grade through the protected website; sealed dispute or restoration access follows the separate authorized admin process.
- Local answer content uses IndexedDB, not localStorage. The beta cleanup default retains confirmed-receipt recovery data for up to seven days and removes eligible records on a later Examination Room open; browser storage is not permanent and the period still requires DPO/records-schedule approval.

## Processing-purpose matrix requiring approval

The “candidate basis” column is intentionally not filled with a legal conclusion. Required examination processing should not be presented as optional consent, and marketing consent must remain separate and unchecked.

| Purpose | Minimum data | Primary actors | Candidate lawful-basis/DPO decision | Current control/status |
|---|---|---|---|---|
| Account identity and authentication | account ID, verified primary email, auth/session metadata | Due Diligence, auth provider | **DPO/counsel decision required** | Existing Supabase auth; institutional AAL2 not yet proven. |
| Examiner verification/authority | account, institutional email/invitation, verification outcome/method | Due Diligence, institution | **DPO/counsel decision required** | One-time account-bound activation; retain outcome, avoid ID scans. |
| Beadle delegation | account/email, exam scope, capability, expiry/revocation | Professor/institution, Due Diligence | **DPO/counsel decision required** | Exam-specific, expiring, revocable, audited. |
| Roster/admission | primary email, student/candidate ID, optional name, account link, admission/verification outcome | Institution, Professor/Beadle, Due Diligence | **DPO/counsel decision required** | Duplicate/malformed checks; immutable published eligibility snapshot. |
| Examination answering | answers, answer revisions/hashes, immutable exam version, timestamps | Student, institution/Professor, Due Diligence | **DPO/counsel decision required** | Local-first journal plus server revisions; no ordinary logs. |
| Timing/accommodation | exam/candidate scope, operational extra time/window/break/exemption/aids | Institution, authorized Professor/Beadle, Due Diligence | **DPO/counsel decision required** | No diagnosis field; server deadline calculation; audit. |
| Submission evidence | accepted revisions, snapshot/hash, receipt, generation, outage evidence | Due Diligence, institution | **DPO/counsel decision required** | Stable idempotent receipt; old generations preserved. |
| Integrity/technical incident review | grouped browser signals, duration, connectivity/session events, operator note | Due Diligence, authorized institution staff | **DPO/counsel decision required; necessity/proportionality review** | No automatic penalty/failure; signals are not proof. |
| Temporary leave | departure/return, duration, reason category, acknowledgment/note | Student, Beadle, institution | **DPO/counsel decision required** | Timer continues; no automatic grade penalty; avoid diagnoses. |
| Grading/result/dispute | answer, rubric/model version if any, score, comment, decision history, receipt | Professor/institution, Due Diligence | **DPO/counsel decision required** | Manual grading; batch release; controlled dispute. |
| Backup/delivery | per-exam copy, delivery address/status, limited error metadata | Due Diligence, Google/Resend, institution | **DPO/counsel + subprocessor/cross-border decision** | Asynchronous outbox; service/admin-owned workbook with no live Professor Drive grant; real staging controls/restore not yet verified. |
| Security/audit/privileged access | actor, effective role, target/scope, action/outcome/reason, request ID, minimal change | Due Diligence | **DPO/counsel decision required** | Application append-only controls; do not call immutable/tamper-evident yet. |
| Optional product marketing | separately entered marketing contact/choice | Due Diligence | **Separate voluntary basis/notice required** | Must be unchecked and irrelevant to exam access. |

## PIC/PIP allocation questions

Before institutional use, an approved data-processing agreement and privacy notice must state:

- who decides roster, exam, monitoring, accommodation, grading, dispute and retention purposes;
- whether the school/institution is PIC and Due Diligence is PIP for core exam processing, and where Due Diligence has separate PIC purposes (account/security/product operations);
- documented institutional instructions and what Due Diligence may do without new instructions;
- assistance for notices, data-subject requests, incidents, corrections, deletion and legal holds;
- subprocessor authorization, locations, cross-border safeguards, return/deletion and audit terms;
- ownership/control of Google backup workbooks and result emails;
- responsibility for verifying candidate/examiner identity and approving accommodations.

## Category-specific retention decision register

Except for the clearly labeled seven-day browser-local beta recovery default below, no institutional retention period is approved in this beta. Each row must receive an approved period, trigger, deletion/anonymization job, backup propagation rule, hold override, owner and test before institutional release.

| Category | Trigger | Approved period | Deletion/hold design status |
|---|---|---:|---|
| Invitation/activation secrets and failed-attempt windows | issue/expiry/redemption | Pending | Plain secrets never stored; expired hashes/status cleanup pending schedule. |
| Draft source objects and parse previews | upload/abandon/publish | Pending | Private bucket; orphan cleanup and separate object-backup lifecycle required. |
| Published exam versions/rules/questions | publish/archive | Pending | Evidence-preservation/legal-hold decision required. |
| Rosters/account links/verification/admission | import/finalize | Pending | School-record and dispute window decision required. |
| Local IndexedDB answers/operations/conflicts | confirmed receipt | **Beta default: up to 7 days; approval pending** | Cleanup runs when the Examination Room is later opened; user/browser eviction may remove storage earlier. Legal hold is server-side and must not depend on a browser copy. |
| Server answers/revisions/submissions/receipts | submission/finalize | Pending | Generation preservation and legal hold exist conceptually; deletion workflow pending policy. |
| Integrity/technical/leave events | incident/finalize | Pending | Proportionality and shorter-category review required. |
| Grades/comments/history/results | release/finalize | Pending | Education-record, dispute and correction policy required. |
| Audit/privileged-access events | event/access review | Pending | Restricted deletion and external tamper-evidence/backup decision required. |
| Google backups/email evidence | create/send/finalize | Pending | Separate deletion/revocation and restoration procedures required. |

## Layered notice points

1. Account creation: identity/authorization, recovery, submission history, integrity records; optional marketing separate.
2. Role/invitation: authority scope, expiry, audit and verification outcome.
3. Roster import: required/optional fields, duplicates, visibility, institution responsibility.
4. Student preflight: supported device, local storage limits, direct connectivity, server time, policies, support contact, camera off.
5. Exam workspace: truthful browser-signal statement, sync/local state, leave policy, timer authority.
6. Submission: pending versus received, receipt content, late/outage review.
7. Incident/recovery: reason, physical verification, session invalidation and notifications.
8. Any future AI/camera activation: a new just-in-time notice and PIA/retention decision before collection.

## PIA completion gates

- map full data flows and storage/processor locations;
- record necessity/proportionality and alternatives for each identity/integrity field;
- approve lawful basis and notices;
- approve PIC/PIP/DPA allocation;
- approve retention/deletion/hold and backup propagation;
- assess data-subject access/correction/objection/erasure/restriction handling;
- assess NPC registration/DPO/DPS and breach-notification applicability;
- verify Supabase, Cloudflare, Google, Resend and any AI provider contracts/settings;
- complete threat/abuse cases, access/RLS matrix, secrets handling and incident response;
- test deletion, export, access logs and database + Storage restore;
- obtain documented owner, DPO, security and counsel approval.
