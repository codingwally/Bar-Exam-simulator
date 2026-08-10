# Examination Room 2.0 accessibility and browser test plan

Target: WCAG 2.2 Level AA. This target is not a conformance claim. Automated scans cannot replace the manual journeys below.

## Supported beta matrix (must pass before advertising)

| Platform | Browser | Viewport | Status |
|---|---|---:|---|
| Windows 11 | Current Chrome | 1440×900, 1024×768, 200% zoom | Not yet authenticated end-to-end verified |
| Windows 11 | Current Firefox + NVDA | 1440×900, 200% zoom | Not yet verified |
| macOS | Current Safari + VoiceOver | 1440×900 | Not yet verified |
| iPad-class tablet | Current Safari | 1024×768 portrait/landscape | Not yet verified |
| Phone | Any | phone-sized | Unsupported for serious beta examinations; preflight blocks |

Exact versions, dates, tester, screenshots/video, defects and results must be recorded at execution time.

## Complete keyboard/screen-reader journeys

1. Public entry: announce title/explanation; reach exactly Professor, Beadle and Student; activate with Enter/Space; sign-in focus return.
2. Professor: create class; upload file and pasted text; edit/reorder/remove/add questions; edit points; inspect warnings/student preview; set rules; review; publish; copy one-time credentials without dismissing accidentally.
3. Beadle: redeem invitation; paste/import roster; correct a bad cell without re-upload; navigate Needs attention; record verification/admission/leave return; confirm no answer/grade content is exposed.
4. Student: enter deep-linked exam; complete preflight and policy acknowledgement; start; open instructions; navigate every question; type/paste/select/edit an essay; flag/unflag; start/end leave; review unanswered/flags; create pending submission; receive/read receipt.
5. Student resilience: re-authenticate without losing IndexedDB work; go offline/online; refresh/crash/reopen same device; receive conflict/recovery; second tab is clearly read-only; session transfer invalidates old writer.
6. Professor after exam: use attention-first monitor; grade all questions; review completion; release results.
7. Admin: open metadata-only Examination Room health; verify no answer/grade content; inspect disabled AAL2/candidate-scoped break-glass gate.

## Manual checks

- logical heading/region sequence and descriptive page/dialog names;
- visible, unobscured focus at every control; focus return after dialog;
- no keyboard trap, including native dialog, question navigator and editor;
- active role/question uses programmatic state (`aria-current` or equivalent);
- save/offline/reconnect/recovery/pending/receipt status announces once without moving focus or reading the whole page;
- timer label is clear; warnings are not color-only or overly frequent; accommodation can exempt fullscreen/monitoring and extend time;
- labels/errors identify exact fields/rows and remain associated after re-render;
- 200% and 400% zoom/reflow without lost content/function or two-dimensional page scrolling (data tables may scroll within their wrapper);
- pointer targets meet the target-size objective and mobile/tablet spacing remains usable;
- contrast of text, focus and component states;
- reduced motion honors user preference;
- copy/paste/context menu and approved assistive technology are not blocked;
- review/correction exists before final submission; pending is never announced as submitted;
- reauthentication and server errors retain local answers;
- fullscreen exit does not trap or fail the candidate.

## Automated checks

- HTML/JS syntax and repository contract tests;
- axe-core or equivalent on each loaded/empty/error/warning/offline/recovery/confirmation state;
- browser console and failed-resource check;
- DOM assertions for names/roles/labels/live regions/`aria-current`;
- contrast analysis and responsive overflow scan at required breakpoints;
- IndexedDB, BroadcastChannel, network-offline and second-tab automation;
- no context-menu/copy/paste prevention listeners;
- screenshot comparison against the existing navy/cream/gold Due Diligence visual language.

## Evidence required for release

- automated report with zero unexplained serious/critical findings;
- documented keyboard transcript for all three public roles and Admin;
- NVDA + Firefox/Chrome and VoiceOver + Safari output notes;
- zoom/reflow/contrast/target-size results;
- screenshots for public entry; Professor upload/review/rules/publish; Beadle valid/invalid roster and attention; Student preflight/active/offline/recovery/pending/receipt; Professor monitor/grading/release; Admin health/restricted gate;
- issue links and retest evidence for every finding.
