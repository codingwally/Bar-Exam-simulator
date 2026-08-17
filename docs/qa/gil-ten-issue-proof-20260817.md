# Gil's Subject Matter findings — approval evidence

**Evidence date:** 2026-08-17
**Scope:** pending release; local code plus protected staging database evidence
**Approval verdict:** **STAGING VERIFIED; PRODUCTION PUBLICATION IN PROGRESS**

This is a one-to-one disposition of Gil's ten findings. It separates code and
test evidence from visual evidence and from real email-delivery evidence. All
ten have an implementation and relevant local contract evidence. The two new
database migrations have also been applied and tested on protected staging.
This report does not claim a production deployment until the publication
addendum records the merged commit and successful production workflow runs.

## Executive status

- Issues **1–10** have a local implementation and relevant contract evidence.
- Issue **8** now has an owner-bound flag queue, replay-safe skip lifecycle,
  separate skipped metric, Worker route, migration, behavioral pgTAP, and
  browser QA states. Protected staging has migration version `20260817121616`,
  and its transactional behavioral pgTAP passed **27/27**.
- Practice Exam email is removed at the call sites and hard-disabled at the
  shared transport boundary. Examination Room email remains independently
  controlled. The successful Gmail self-send described below is a separate
  Gmail API test, not a Worker or Resend delivery test.
- At this checkpoint, nothing represented here is claimed as production. The
  production commit, migration versions, deployment runs, live checks, and
  screenshots will be recorded only after they exist.

## One-to-one issue matrix

| # | Gil's finding and recommendation | Current disposition | Implementation evidence | Test and visual evidence required for approval |
| --- | --- | --- | --- | --- |
| 1 | The landing silently selects **Criminal Law I**; the course-change control is small and not centered. Start with an explicit, prominent, centered course choice. | **Resolved locally.** First-time state is neutral, the former default is not silently restored, and **Browse courses** sits below a centered prompt. Intentional user choices remain user-scoped. | `assets/examinations.js`; `assets/examinations.css`; `scripts/test-design-correction-release.mjs` | **V1** first-time chooser and **V2** course drawer. Contract checks reject `selectedSubject: 'Criminal Law I'` and `state.catalog[0]`; current browser inspection found no selected course and no automatic Criminal Law I. |
| 2 | Action alignment is awkward and copy is redundant. Remove **Question-aware study** and unnecessary explanations; consider a subject description. | **Resolved locally.** Redundant taglines and retired one-question/autosave copy are removed, actions use the shared control foundation, and the existing Subject Matter visual motif is retained. The optional new subject-description idea was not added because it would expand reviewed content beyond this bug-fix scope. | `assets/examinations.js`; `assets/examinations.css`; `assets/due-diligence-controls.css`; `scripts/test-design-correction-release.mjs` | **V3** selected-course landing and **V4** practice room. Contract checks prohibit **Question-aware study**, **How this review works**, retired one-question copy, and a copied Subject Matter-only button system. |
| 3 | The change-course panel renders an empty button at the bottom. Remove it. | **Resolved locally and hardened.** The drawer has only named controls; malformed catalog rows with blank subject/course code or invalid year/term are removed before rendering, so they cannot create a blank course control. | `worker/examinations-core.mjs`; `worker/examinations-core.test.mjs`; `assets/examinations.js` | **V2** drawer with Year/Term expanded. `node --test worker/examinations-core.test.mjs`: **22/22 passed**, including “malformed rows must never render as blank course controls.” Current browser inspection found no unlabeled course button. |
| 4 | The circular **DD**, **Private review chamber**, icon/slogan/name treatment is inconsistent. Standardize it. | **Resolved locally.** The feature-specific faux seal and “Private review chamber” label were removed. The review now uses the existing text hierarchy: **Review material** and **Suggested answer and legal review**, under the shared site brand. | `assets/examinations.js`; `assets/examinations.css` | **V4** locked review and **V5** opened review. A fresh browser capture must show no circular DD seal or retired chamber label. |
| 5 | **How this review works** duplicates generic, hard-to-read material. Remove or replace it. | **Resolved locally.** The redundant dropdown is absent. The only retained pre-reveal explanation is the material classification consequence: Assisted/Open-book, unchanged score, excluded from unassisted mastery metrics. | `assets/examinations.js`; `scripts/test-design-correction-release.mjs` | **V4** locked review. Contract checks prohibit **How this review works** and require the shortened classification consequence. |
| 6 | The question type is too large on web and mobile. Reduce it to a scale consistent with the answer workspace. | **Resolved locally.** Question text is `clamp(25px, 2vw, 34px)` on desktop and `25px/1.4` at the 520px breakpoint. | `assets/examinations.css`; `scripts/test-design-correction-release.mjs` | **V4** desktop and **V7** 390px mobile. Current 390px browser inspection reported no page overflow. |
| 7 | **Writing Approach** appears after reveal controls. Move it before the reveal decision. | **Resolved locally.** The order is Question → Writing approach → response editor/actions in the left pane; review remains in the right pane. | `assets/examinations.js`; `scripts/test-design-correction-release.mjs` | **V4** desktop and **V7** mobile. Contract checks require Writing Approach before the answer workspace/reveal choice and writing before review in DOM order. |
| 8 | There is no skip/flag flow. Add unlimited skip and flag capability. | **Resolved and database-verified on staging.** Flag-only drafts are resumable; skipped flags can be practised again; Skip closes without submission, grading, assessment, or score; same-request replay is idempotent; out-of-cycle retries preserve the active no-repeat cycle; later submission clears the queue. | `assets/examinations.js`; `assets/examinations.css`; `worker/index.mjs`; `worker/examinations-core.mjs`; `supabase/migrations/20260817111306_subject_matter_skip_and_flag_queue.sql`; `supabase/tests/20260817_035_subject_matter_skip_and_flag_queue_test.sql`; `scripts/test-subject-matter-skip-flag.mjs` | **V8** actual flag/unflag state, **V9** confirmed Skip changing from the civil-obligation question to the different Article 1157 question, and **V10** both skipped/Practice again and flag-only/Resume question queues were exercised in the current renderer. Protected staging migration `20260817121616` is present and the transactional behavioral pgTAP passed **27/27**. |
| 9 | **Suggested Answer** and **Controlling Law** are identical and densely formatted. Distinguish them and add readable structure. | **Resolved for the reported rendering defect.** Suggested Answer uses a structured, escaping-only section renderer. Controlling law is separately normalized, near-duplicate guarded, and falls back to source-bound material rather than repeating the complete answer. Authorities, jurisprudence, application, limits, and sources are separated. | `assets/examinations.js`; `worker/subject-matter-review.mjs`; `worker/subject-matter-review.test.mjs`; `scripts/audit-subject-matter-review-quality.mjs`; `scripts/test-design-correction-release.mjs` | **V5** Suggested Answer open and **V6** Controlling Law open. Canonical audit: **1,490 records, 0 exact and 0 near Suggested Answer/Controlling Law duplicates**. The audit still reports separate editorial debt (bare doctrines, placeholder jurisprudence, duplicate raw authority fields, malformed case entries); this report does not misstate that corpus as fully remediated. |
| 10 | Subject Matter submission sends the wrong repeated “model answers available” email directing users to Mock Bar. Delete that behavior. | **Resolved locally by permanent Practice Exam email removal.** Subject Matter, Bar Feels/model-release, and Human Examiner assignment make no provider call. Human Examiner now returns a manual secure link. Examination Room remains separate. | `worker/index.mjs`; `worker/examinations-routes.test.mjs`; `worker/index.test.mjs`; `worker/exam-room-delivery.mjs`; `worker/wrangler.toml`; `assets/examinations.js`; `scripts/test-examinations.mjs` | Route tests deliberately enable every email mode and assert **0 provider calls** for both practice tracks and Human Examiner. Separate tests prove explicitly enabled Examination Room direct and queued delivery still operate. **E1** below proves only the separate connected-Gmail test. |

## Visual evidence ledger

The current production renderer was exercised through
`docs/qa/option3-subject-matter-fixture.html`, not recreated as a static mock.
The following states were inspected in the controlled browser and displayed
inline to the owner during review:

| ID | Required state | Observed local result | Artifact status |
| --- | --- | --- | --- |
| V1 | First-time chooser | Centered one-column prompt; **Browse courses** below it; no selected course; no automatic Criminal Law I. | Displayed inline; fresh downloadable browser PNG still required for the approval pack. |
| V2 | Course drawer | Search, Year/Term hierarchy, named course controls, close and Back controls; no unlabeled button. | Displayed inline; fresh downloadable browser PNG still required. |
| V3 | Selected-course landing | **Start**, **Change course**, **Timer settings**, and **Review my work** use the shared control classes. | Displayed inline; fresh downloadable browser PNG still required. |
| V4 | Practice room, all review sections closed | Question, Writing Approach, editor, submit and return actions on the left; three review disclosures on the right. | Displayed inline; fresh downloadable browser PNG still required. |
| V5 | Suggested Answer open | **Reveal suggested answer** opens the protected structured answer and applies the Assisted/Open-book classification where required. | Displayed inline; fresh downloadable browser PNG still required. |
| V6 | Controlling Law open | Suggested Answer and Controlling Law are visibly distinct; authorities are separately presented. | Displayed inline; fresh downloadable browser PNG still required. |
| V7 | 390px mobile | Writing content precedes review content; reported page overflow is false. | Displayed inline; fresh downloadable browser PNG still required. |
| V8 | Flag/unflag current question | The persisted state changes between **Flag for later** and pressed **Flagged for later** without changing the answer. | Displayed inline from the current renderer. |
| V9 | Skip to a different question | Confirmed Skip preserved the saved flagged draft, recorded no score, and changed the prompt from the civil-obligation elements question to the different Article 1157 sources question. | Displayed inline from the current interactive fixture; protected staging behavioral pgTAP passed 27/27. |
| V10 | Flagged-history states | A skipped flag renders **Practice again**; a flag-only open draft renders **Resume question**; both expose the escaped **Saved draft** disclosure. | Both states displayed inline from the current renderer. |

### Stale proof files

The existing `proof/*.pdf` documents are **stale, code-derived renderings**, not
current browser screenshots. In particular, do not use the following as
approval proof:

- `proof/01-course-selection.pdf`
- `proof/02-subject-workspace.pdf`
- `proof/03-email-delivery-proof.pdf`
- `proof/04-legal-review-proof.pdf`
- `proof/gil-changes-proof.pdf`

They include retired copy and/or earlier control compositions. They must be
replaced, not relabeled as current screenshots.

## E1 — controlled connected-Gmail test

The connected account was verified as `wallyesteban1993@gmail.com`, and one
controlled message was sent from the account back to itself.

| Field | Verified value |
| --- | --- |
| From | `wallyesteban1993@gmail.com` |
| To | `wallyesteban1993@gmail.com` |
| Subject | `[CONTROLLED TEST] Due Diligence email proof — 17 August 2026` |
| Gmail timestamp | `2026-08-17T04:03:38-07:00` |
| Labels found by exact-subject search | `UNREAD`, `SENT`, `INBOX` |
| Gmail message | `https://mail.google.com/mail/#all/1a00f642eb57de2d` |

This proves only that the connected Gmail account could send and receive its own
message through the Gmail API. It **does not** prove:

- that the Due Diligence Worker sent an email;
- that Resend accepted or delivered a message;
- that `duediligence.ph` sender-domain authentication is valid; or
- that any application email category has been re-enabled.

Practice Exam delivery remains fail-closed in code regardless of configuration.
Production uses `OUTBOUND_EMAIL_MODE = "suppressed"` for general non-Room
notifications while Examination Room retains its independent explicit mode.

## Local verification run

The following were rerun against the current tree on 2026-08-17:

| Command | Result |
| --- | --- |
| `node --test worker/examinations-core.test.mjs` | **22 passed, 0 failed** |
| `node scripts/test-subject-matter-consolidation.mjs` | Passed; 42 courses, 1,890 placements, 1,490 canonical questions |
| `node scripts/test-examinations.mjs` | Passed |
| `node scripts/test-design-correction-release.mjs` | Passed |
| `node scripts/audit-subject-matter-review-quality.mjs` | Completed; 1,490 canonical records, 0 exact and 0 near answer/law duplicates |
| `node scripts/test-subject-matter-skip-flag.mjs` | Passed; all 42 courses have a different eligible question and the skip/flag contracts are present |
| `node --test worker/examinations-core.test.mjs worker/examinations-routes.test.mjs` | **35 passed, 0 failed** |

The final independent regression recorded **447/447 Worker tests**, **31/31**
frontend/content verification commands, a passing sanitized **89-file** Pages
artifact, passing syntax checks, and `git diff --check`. Those local results
do not replace production deployment and live-browser evidence below.

## Protected staging database verification

The two forward migrations were applied to the protected staging project in
their required order. They were not applied with a blind `db push`.

| Change | Staging migration version | Transactional result |
| --- | --- | --- |
| Subject Matter Skip/Flag lifecycle | `20260817121616` | `20260817_035_subject_matter_skip_and_flag_queue_test.sql`: **27/27 passed**, then rolled back |
| Retired email-marketing collection | `20260817121625` | `20260817_036_retired_email_marketing_collection_test.sql`: **6/6 passed**, then rolled back |

The Skip/Flag staging schema exposes a service-role-only owner-bound skip RPC,
validated lifecycle constraint, separate skipped metric, and flagged queue. The
marketing compatibility RPC is `SECURITY INVOKER`, remains callable by signed-in
legacy clients, and performs no insert or update. Anonymous execution is denied.

One pgTAP fixture was corrected before the final 27/27 run: it originally
simulated several normally separate HTTP requests inside a single database
transaction, so PostgreSQL's transaction timestamp could sort a later test
submission before a skip recorded with wall-clock time. The fixture now assigns
the earlier skip timestamp explicitly. Production logic was not changed to hide
that test artifact.

## Publication gate

The following publication evidence must be completed and recorded:

1. **Complete:** protected staging has both migrations; Skip/Flag passed 27/27
   and marketing retirement passed 6/6.
2. Apply the same reviewed migrations to production in order and verify the
   resulting functions, grants, lifecycle constraint, and no-write behavior.
3. Preserve the fresh V1–V10 actual-browser captures as the approval record;
   do not substitute the stale `proof/*.pdf` files.
4. The full regression suite and sanitized Pages artifact pass after the Issue 8 change.
5. Deploy the merged production Worker and Pages from the same reviewed commit.
6. Live production confirms the Subject Matter UI states and cache-busted assets;
   automated hostile-configuration tests continue to confirm zero provider
   traffic from every Practice Exam route while Examination Room remains separate.
7. Any future Practice Exam marketing flow must obtain fresh consent and receive
   separate review; the retired compatibility RPC stores nothing and historical
   consent rows must not be reused.
8. The two untracked production-critical files,
   `assets/due-diligence-controls.css` and `worker/outbound-email-policy.mjs`, are
   included in the reviewed release artifact.

At this checkpoint the honest status is **ten issues implemented, both new
database behaviors verified on protected staging, and production publication in
progress**. No production deployment or live screenshot is claimed yet.
