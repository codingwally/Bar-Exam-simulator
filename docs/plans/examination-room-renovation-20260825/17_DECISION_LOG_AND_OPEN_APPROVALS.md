# Decision Log and Open Approvals

Status: recommended defaults are resolved for planning. Items marked `OWNER APPROVAL` require Wally's explicit approval before implementation or commercial use; they are not left directionless.

## Forty resolved decisions

| ID | Decision question | Recommended default | Tradeoff / rejected alternative | Assumption and approval |
|---:|---|---|---|---|
| D01 | Manual or self-service launch onboarding? | Manual verified onboarding for launch; design self-service only after launch evidence | Self-service scales faster but amplifies identity, privacy, support, and readiness failures | **OWNER APPROVAL.** Initial classes are low volume enough for Wally verification |
| D02 | Sufficient launch identity verification? | Signed-in account, verified institutional email, independent employment/course evidence, accepted terms, MFA; step-up for sensitive actions | Domain email alone is weak; heavy institutional contract for every sandbox slows evaluation | **OWNER APPROVAL + PRIVACY.** Wally can validate the independent signal |
| D03 | One Professor workspace supports multiple examinations? | Yes; one owner workspace contains multiple class contexts/exams | One account/room per exam creates recovery and credential sprawl | Adopt; owner membership remains exam/class scoped |
| D04 | One room equals one exam or one class? | Room/workspace is Professor/class context; Examination is a distinct immutable event/version | One room=one exam is simpler technically but impairs reuse, dashboard, history | Adopt terminology before UI/schema changes |
| D05 | Remove grading key from normal Professor use? | Yes | Keeping it is redundant after authenticated ownership and caused human friction | **OWNER APPROVAL.** Preserve compatibility only during migration |
| D06 | Replacement for grading key on sensitive actions? | Authenticated owner membership plus recent reauthentication/MFA for publish policy changes, release, amendment, cancel, break-glass | Permanent shared key is phishable; MFA adds bounded friction | **OWNER APPROVAL + SECURITY.** Auth provider supports step-up or equivalent |
| D07 | Default simple or roster mode? | Simple classroom mode default; roster-controlled optional | Roster-first adds setup/errors; simple mode needs collision resolution | **OWNER APPROVAL.** Institution may mandate roster for a given exam |
| D08 | Entry without roster while accountable? | Yes: authenticated sign-in + exam locator + name/student number/email; server binds unique candidate | Anonymous code entry is too weak; mandatory roster is too costly | Adopt with duplicate/identity hold and audit |
| D09 | Minimum Student identity? | Account user ID, legal/display name, student number, institutional email; exam/course/section binding | More attributes increase privacy burden; fewer impede accountability | **OWNER APPROVAL + PRIVACY.** Student number/email availability confirmed |
| D10 | Duplicate Student identity resolution? | Block ambiguous match; Professor resolves candidate binding with audit; never auto-merge | Auto-merge risks wrong identity; allowing duplicates fragments receipts | Adopt; Beadle may request but not decide unless separately authorized |
| D11 | Should Beadle remain? | Yes, optional and removable | Removing it loses useful logistics; required Beadle recreates bottleneck | **OWNER APPROVAL.** No Beadle dependency in happy/recovery path |
| D12 | Exact optional Beadle powers? | Roster help, waiting/admission metadata, identity-correction request, incident note, session-transfer request | Broader access risks answers/grades; narrower role may shift logistics to Professor | **OWNER APPROVAL + PRIVACY.** No questions/answers/model answers/grades/release |
| D13 | Professor actions requiring confirmation? | Publish; supersede published content/rules; pause/resume; selected/class extension; session transfer/revoke; reopen; close/end/cancel; finalize/release; amend/reissue; archive | Confirming ordinary saves causes fatigue; missing impact confirmation causes irreversible mistakes | **OWNER APPROVAL.** Confirmation text names scope/consequence |
| D14 | Professor actions requiring reason? | Pause/resume/cancel, extensions, reopen, identity correction, session revoke/transfer, grade change after final, amendment/reissue, Admin break-glass | Reasons on routine drafts are noise; no reason weakens audit | **OWNER APPROVAL.** Use reason codes + meaningful text where necessary |
| D15 | Permitted Admin actions during active exam? | Version/status/queue diagnostics, scoped job retry, stop new entry, compatible rollback, revoke compromised session, candidate-specific fresh-MFA break-glass | Broad service-role edits are fast but make Admin invisible co-Professor | **OWNER APPROVAL + SECURITY.** No routine answer viewing/bulk mutation/grade/release |
| D16 | Whole-examination pause? | Yes; server appends pause/resume events and freezes effective elapsed time | Display-only pause is inconsistent; no pause leaves poor incident control | **OWNER APPROVAL.** Institutional policy permits pause and communication |
| D17 | How extensions affect deadlines? | Append immutable candidate/selected/class extension event; derive new deadline from timing ledger; never rewrite original schedule | Rewriting a deadline hides history; new attempt is excessive | Adopt with reason and per-candidate receipt |
| D18 | Accidental submission reopen? | Professor selects candidate, reason, new deadline; new attempt/submission generation | Unlocking sealed generation destroys receipt integrity; refusing all reopens is impractical | **OWNER APPROVAL.** Block/require amendment after prohibited grading/release stage |
| D19 | Preserve prior receipts after reopen? | Old receipt immutable; new generation links/supersedes operationally and produces a new receipt | Replacing receipt removes evidence; unrelated attempt loses continuity | Adopt as invariant |
| D20 | Grade-release scopes? | Support individual, selected, and whole class | Class-only blocks early release; individual-only is operationally heavy | **OWNER APPROVAL.** Batch returns per-candidate results |
| D21 | Correct released grades? | Immutable amendment: reason, old/new comparison, fresh auth, new grade/release version, separate reissue | In-place edit is simple but destroys history; deletion/retract creates ambiguity | **OWNER APPROVAL + POLICY.** Student history wording/visibility approved |
| D22 | Authoritative Student result location? | Authenticated Due Diligence Student portal | Email/download alone is unreliable and hard to amend securely | Adopt; portal availability is release success |
| D23 | If email never delivers? | Portal remains available; Professor sees permanent failure, may retry/correct/copy route/print notice | Reversing/withholding release for email harms correctness | Adopt; do not promise guaranteed delivery |
| D24 | If PDF never generates? | Readable web view + browser print + regenerate + incident ID; domain state unchanged | Blocking workflow or fabricating empty file is unacceptable | Adopt |
| D25 | First-release offline file role? | Reference/export only | Offline operational/grading authority introduces merge/version conflicts | **OWNER APPROVAL.** Label snapshot/version and no reimport |
| D26 | Defer offline grade import? | Yes | It may support legacy workflows but requires complete merge/security/conflict design | Adopt as deferred scope |
| D27 | Safely importable PDFs? | Bounded text-based, non-encrypted, non-active/malformed PDFs parsed in isolated resource-limited process | Supporting every PDF invites exploit/false extraction | **OWNER APPROVAL + SECURITY.** Exact byte/page/object/time limits proven later |
| D28 | Scanned PDFs? | Detect honestly; ask for searchable PDF or manual entry; OCR deferred | OCR increases privacy, cost, accuracy, and review complexity | **OWNER APPROVAL.** No silent Gemini/image upload |
| D29 | Acceptable Gemini processing? | Optional structure/numbering/field proposal with field uncertainty and source provenance; never publish/grade | No AI is safer but less helpful; broad rewriting undermines authorship | **OWNER APPROVAL + PRIVACY.** Every AI proposal individually reviewed |
| D30 | Assistant Proctor v1 commands? | Allowlisted navigation/find/explain/guide; owner-scoped read-only summaries; open ordinary control; optional unsaved feedback draft from explicitly selected submitted material | Broader commands increase value and confused-deputy risk | **OWNER APPROVAL.** Exact allowlist in spec; no cross-class/active answers |
| D31 | Assistant commands needing confirmation? | Every mutation; v1 mutations only as typed proposals with server-bound confirmation; grade/finalize/release/amend/cancel remain ordinary UI-only | Model-confirmed broad actions are faster but too risky | **OWNER APPROVAL + SECURITY.** Read-only still permission checked |
| D32 | Recover Assistant mistakes? | No proposal has authority; retain ordinary UI, refresh state, discard/correct; unknown command queries receipt; circuit-break assistant | Automatic compensating mutation may compound error | Adopt; audit proposal and confirmed command separately |
| D33 | Data Gemini may receive? | Minimum Professor-selected source fragments for import; explicitly selected sealed answer/rubric only for feedback draft; no credentials/rosters/active answers/other classes | More context may improve output but increases privacy/cross-scope risk | **OWNER APPROVAL + PRIVACY/CONTRACT.** Redact/log minimum metadata |
| D34 | Reuse existing Gemini key? | No blind reuse; inventory/revoke/rotate current key and treat it as development until proven otherwise | Reuse is faster but unknown scope/quota/log/rotation may be unsafe | **OWNER APPROVAL + SECURITY.** Existing key status must be audited without exposing it |
| D35 | Separate production Gemini project/key? | Yes: dedicated production project/key, least privilege, quota/cost alerts, rotation, logs, incident owner | More operations/cost; materially better isolation and accountability | **OWNER APPROVAL + COMMERCIAL/PRIVACY.** Enable only after provider terms approval |
| D36 | Maximum supported class size? | Launch promise 200 simultaneous Students; 500 is stress/capacity target only | Current validation allows 500 but code bound is not load evidence | **OWNER APPROVAL + COMMERCIAL.** Lower if full load/recovery gate fails |
| D37 | Maximum question count? | Launch promise 100; 200 hard parser/stress target | 200 code cap exists but one-page/import/render usability unproven | **OWNER APPROVAL + COMMERCIAL.** Lower if device/accessibility performance fails |
| D38 | Usability targets? | ≥90% next action in 10s and uncoached sandbox publish; Student entry median ≤60s/start ≤2m; SEQ ≥6/7; SUS ≥80; ≤1 critical wrong turn; zero destructive ambiguity/data loss; save ≤1s local/≤3s server p95 normal | Vague “intuitive” targets cannot gate release; strict metrics require recruitment/time | **OWNER APPROVAL.** Metrics measured across prescribed profiles |
| D39 | Human tests before selling to another Professor? | Uncoached real content/class/grading/PDF/Excel/inbox/disconnect/refresh/recovery; six Professor profiles and Student device/network/AT profiles; ≥5 repeats per critical flow | Lab-only tests are faster but already missed real failures | **OWNER APPROVAL + COMMERCIAL.** Every observation becomes regression |
| D40 | Exact GO/NO-GO conditions? | GO only when all acceptance IDs/gates pass on recorded versions, independent audit signs, privacy/support/commercial readiness approved, rollback rehearsed, and Wally records dated GO; otherwise NO-GO | Waivers accelerate launch but invalidate reliability promise | **OWNER APPROVAL.** Current decision remains NO-GO |

## Alternatives explicitly rejected for launch

- Required Beadle, anonymous bearer-code entry, permanent grading key, email-only recovery/results, and file-driven state.
- In-place publication/submission/grade/release edits; two concurrent writers; last-write-wins without comparison.
- PDF “success” with no extracted questions, silent OCR/Gemini upload, AI rewriting/publishing/grading/releasing.
- Downloads that lock or advance workflows; offline grade-file merge; custom release composer before privacy/usability evidence.
- Continuous camera/microphone, browser-focus-as-cheating proof, broad Admin answer access, or Assistant Proctor direct DB/service-role access.
- Selling 500/200 capacity because input validators accept it; declaring completion from mocks/screenshots/source-string tests.

## Assumptions requiring implementation-phase confirmation

| ID | Assumption | Required confirmation |
|---|---|---|
| AS01 | Auth provider can support institutional identity plus recent reauthentication/MFA | Trace configured provider/session claims and test step-up/expiry/revocation |
| AS02 | Existing owner-scoped RPCs can support a bounded dashboard without leaking data | Map/query/profile current RPCs and payloads at 500-exam history |
| AS03 | Current answer journal/revision model can be extended to flags and grade drafts | Schema/store protocol mapping and old/new-client compatibility proof |
| AS04 | Export RPC source currently has no domain mutation | Reproduce human H01 on deployed build/database and correlate versions/queries |
| AS05 | Candidate release migration is deployed and portal path reads the same version | Environment migration/route/authorization trace and real browser release |
| AS06 | Email provider/DNS/webhooks can supply trustworthy delivery events | Controlled inbox and signed event replay in target production configuration |
| AS07 | Bounded text-PDF extraction can run safely in the Worker architecture | Parser sandbox/resource/security prototype and adversarial evidence—not production implementation in this phase |
| AS08 | 200/100 is supportable without starving active APIs | Full shared-NAT/burst/reconnect/render/AI load gate |
| AS09 | Service-worker/CDN/version routing can pin active compatible clients | Production-like bad-deploy/rollback rehearsal |
| AS10 | Institutional privacy/retention terms permit proposed data and Gemini minimums | Legal/privacy review, controller/processor roles, region/retention/deletion approval |

## Owner approval register

Before any implementation begins, Wally should approve product terms D01–D40 as a set or record a replacement decision with rationale, affected diagrams/states/tests, and date. At minimum, separate signed approval points are required for:

1. Launch/service/support model and supported 200/100 envelope.
2. Identity, MFA, Student fields, simple-vs-roster default, and optional Beadle boundary.
3. Professor/Admin emergency authority, reasons, cancellation, reopen, release, and amendment policy.
4. Result packages, Student amendment visibility, retention/deletion, exports, and portal/email promise.
5. PDF bounds, scanned-PDF deferral, Gemini data/provider/project/key/cost/retention, and Assistant Proctor v1.
6. Usability metrics, human-test recruitment, independent reviewer, and final GO/NO-GO authority.

Approval of planning does not authorize database migration, code change, secret rotation, provider configuration, or deployment.

## Commercial decisions intentionally unresolved

The product direction is resolved without inventing commercial terms. Wally still must decide service packaging, Professor/institution pricing (separate from ₱149 Student subscription), taxes/contracts, payment/approval method, included sandbox/demonstration/support hours, first-exam monitoring, incident/SLA language, overage/unsupported scale handling, cancellation/refund, renewal, suspension, revocation, and institutional procurement. These decisions do not block planning but do block commercial offer publication.

## Privacy and legal approvals

Before production: define school/Professor/Due Diligence controller/processor roles; lawful basis/notices/consent where applicable; identity/exam/answer/grade/source/AI/log/artifact retention; deletion and legal-hold workflow; data region/subprocessors; Gemini no-training/retention terms; export access/expiry; breach response; accessibility/accommodation policy; and candidate amendment/audit visibility. Continuous camera/microphone requires a wholly separate project and review.

## Deferred scope

Consumer subscription and ₱149 pricing changes, promotional video, unrelated homepage/practice exams, payment, SIS, OCR, offline grade re-import, custom result composer, autonomous grading, continuous camera/microphone, class-pattern AI, and broadly self-service production onboarding remain deferred until their own approved plans and evidence.

## Decision change control

Every replacement decision records requester/owner/date, old/new recommendation, reason, user/privacy/security/commercial effect, affected flow diagrams, data contracts/migrations, tests/acceptance IDs, compatibility/rollback, and approval. Implementation may not silently diverge because a different UI or schema appears easier.
