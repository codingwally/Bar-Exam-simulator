# UX and Visual System

## Design intent

The interface should feel like a well-prepared law-school examination: quiet, formal, legible, and trustworthy. It borrows the task clarity of Google Forms, not its visual identity. Density is reduced through hierarchy and progressive disclosure, not by hiding status or recovery.

## Information architecture

### Professor

1. Dashboard
2. Examination workspace
   - Overview and primary action
   - Create/import and question review
   - Rules and Student preview
   - Publication receipt and sharing
   - Live room and incidents
   - Submitted candidates and grading
   - Result preview/release/delivery
   - Files and audit details
3. Assistant Proctor side inbox
4. Account, institution, support, and retention settings

### Student

1. Institutional entry/sign-in
2. Identity and preflight
3. Waiting room
4. Examination workspace
5. Final review
6. Submission receipt
7. Results portal

### Optional Beadle

One scoped logistics view: roster exceptions, waiting/admission metadata, identity-correction request, incidents, and session-transfer request. Do not expose Professor creation, questions, active answer text, model answers, grading, release, or protected exports.

### Wally/Admin

Separate operational console: verification/activation, version/readiness status, metadata-only incidents, queue/export diagnostics, scoped retry, and tightly controlled break-glass. It must not appear at public Student entry.

## Page hierarchy and control rules

- One page title, one short status line, and one primary action in the first viewport.
- Use a stable left/top navigation for destinations; use a stepper only for bounded creation.
- Secondary actions live in a labeled More menu; destructive actions are not adjacent to the primary action.
- Sticky action bars may hold Save/Review/Submit or Save/Finalize, but must not cover content at 200% zoom.
- Status explains outcome first (`Saved to Examination Room`, `3 notifications need attention`); a details drawer may show IDs/timestamps.
- Modals are reserved for consequence/confirmation, not ordinary multi-step work.
- Never expose internal enums, queue leases, RPC names, hashes, migrations, or raw provider codes in normal UI.
- Empty states state why, what happens next, and one action. Error states preserve entered work and include a stable support ID.

## Typography roles

| Typeface | Exact use | Never use for |
|---|---|---|
| Cinzel | Limited Due Diligence wordmark or formal brand lockup | Body, controls, exam prompts, long headings |
| Playfair Display | Restrained page-level headings and ceremonial release/receipt title | Form labels, statuses, question/answer content |
| Inter | Navigation, controls, forms, labels, guidance, dashboards, monitoring, grading controls, Assistant Proctor | Legal/examination content |
| IBM Plex Mono | Exam codes, receipt IDs, timestamps where alignment matters, technical identifiers in details | Paragraphs, buttons, prompts |
| Times New Roman | All Student-visible questions, subparts, authorities/quotations, fact patterns, Student answer text; the same legal/exam content in Professor preview, grading, results, PDF, and print | Navigation, buttons, status, chat/inbox |

Defaults: interface body 16px/1.5 Inter; page heading 32px/1.2 Playfair on desktop and 26px on compact screens; examination text 18px/1.6 Times New Roman; answer editor 18px/1.6; metadata 14px/1.4 Inter; codes 14px IBM Plex Mono. Browser zoom and user font-size preferences must work without clipped controls.

## Light palette

| Token | Proposed value | Use |
|---|---:|---|
| `paper` | `#FCFAF5` | Examination reading surface |
| `alabaster` | `#F3EFE5` | App background and quiet section bands |
| `surface` | `#FFFFFF` | Cards, panels, dialogs |
| `ink` | `#17212B` | Primary text |
| `muted-ink` | `#59636E` | Secondary text after contrast verification |
| `navy` | `#183452` | Primary controls, answered state, formal rules |
| `navy-hover` | `#10263E` | Primary control hover/active |
| `gold` | `#A36F13` | Restrained accent and flagged marker; not small body text on white |
| `line` | `#D8D2C5` | Borders and separators |
| `focus` | `#1769AA` | 3px focus ring with 2px offset |
| `success` | `#236447` | Confirmed/saved state with icon/text |
| `warning` | `#8A5500` | Pending/attention state with icon/text |
| `danger` | `#9B2C2C` | Destructive/error state with icon/text |

These are implementation targets, not a contrast certification. Every foreground/background/state combination must be measured for WCAG 2.2 AA, including disabled, focus, hover, visited, print, high-contrast, and forced-colors modes. Gold is decorative or a large/high-contrast element; it does not carry meaning alone.

## Shape, spacing, and density

- Base spacing unit: 4px; common gaps 8/12/16/24/32px.
- Content reading width: 72–78 characters for legal text; grading can use a wider two-column desktop layout only when both panes remain readable.
- Corner radius: 6px controls, 8px panels; avoid pill-shaped general controls. Status chips may be compact rounded rectangles.
- Borders and elevation are restrained. Use separators and spacing before shadows.
- Minimum pointer target 44×44px. Primary controls have visible text labels; icons supplement labels.
- Tables collapse into labeled rows/cards only when semantic headers and comparison are preserved.

## Circular question navigator

Each question is a true 44px circular button with a centered number and an accessible name such as `Question 4, answered, flagged, sync pending`. State combinations are compositional:

| State | Visual treatment | Non-color signal |
|---|---|---|
| Unanswered | White/paper fill, navy 1px outline, navy number | Accessible label `unanswered` |
| Answered | Navy fill, white number | Small check badge and label `answered` |
| Current | 3px blue outer focus/current ring with 2px gap | `aria-current="step"`; persistent focus style is distinct |
| Flagged | Gold upper-right flag badge; base answered/unanswered treatment remains | Flag icon and label `flagged` |
| Sync pending | Small warning clock at lower-right | Live save text and label `sync pending` |
| Needs attention | Danger outer ring and exclamation badge | Label states exact conflict/offline issue |
| Submitted/locked | Muted fill with lock marker; still readable and navigable in review | Label `submitted, read only` |

Keyboard behavior follows document order: Tab enters/exits the navigator; arrow keys move among circles; Enter/Space opens; Home/End go first/last. Focus is never moved solely because a save completes. At narrow widths, circles wrap in a horizontally contained grid with the current/flagged states retained; do not shrink below target size.

## Student examination layout

Desktop/tablet landscape: restrained header, main legal-content column, and compact navigator rail or top tray. Tablet portrait/mobile: header condenses, navigator opens as an accessible tray, and the answer editor remains full-width. Timer and save state are persistent but not visually alarming. Instructions open in a non-destructive panel. Review/Submit is visually distinct from Save and never appears as an accidental adjacent click.

The editor supports ordinary browser editing, selection, spelling/assistive input as policy permits, and screen readers. Do not globally suppress right-click or clipboard. If a narrowly scoped integrity restriction is approved, document the necessity, exceptions, notice, alternative, and accessibility/privacy review.

## Professor grading UI

One-page per Student is default. The header shows candidate, submission receipt/time, grade status/revision, total, Previous/Next Student, and Assistant Proctor. The body repeats a compact unit per question: Times New Roman prompt, read-only Times New Roman answer, permitted rubric/model answer in a distinct collapsed reference, Inter feedback field, mark/maximum, and save state. A sticky outline jumps to questions without hiding content.

Question mode uses the same draft object and server revision. Switching modes cannot save, discard, duplicate, or recompute values. `Finalize grade` is separate from `Release result`. Downloads live in a Files area and do not enable/disable based on unsaved UI state; they snapshot only server-confirmed data after a warning if the browser has unconfirmed draft changes.

## Assistant Proctor panel

The side inbox is 360–420px on wide screens and a full-screen dialog/drawer on compact screens. It contains:

- `What you can do` permission-specific summary.
- Quick actions: open creation, show candidates needing attention, show early submissions, explain current page, find a named Student, show failed notification/file jobs.
- Conversation/inbox with sources and last-confirmed timestamp.
- Proposed command card with scope, consequence, reason, confirmation, and `Open ordinary control` fallback.
- Failure card that keeps the ordinary interface active and provides retry/support ID.

It uses Inter, normal icons from the product library, no fake personification, and never appears inside the Student answer workspace.

## Responsive and large-data behavior

- Supported launch views cover laptop ≥1280px, tablet 768–1279px, and permitted mobile 360–767px.
- No horizontal page scrolling at 320 CSS px except a semantic data table with an accessible alternative.
- Monitoring and candidate lists paginate/virtualize while keeping counts and filters server-derived.
- One-page grading may incrementally render sections but must preserve find, focus, draft values, total, and print semantics.
- At 200% zoom, fixed/sticky elements must not obscure question text, editor, save state, or primary action.
- Print/PDF uses Times New Roman for exam content, repeats headers safely, prevents blank output, and includes artifact/version metadata.

## Accessibility acceptance

- Meet WCAG 2.2 AA, including contrast, reflow, keyboard, focus appearance/not obscured, target size, errors, status messages, time limits, authentication, and redundant entry.
- Use landmarks, one H1, logical headings, explicit labels/descriptions, fieldset/legend, semantic tables, and `aria-live` only for concise save/timing/incident changes.
- Announce flag/save/submission results without stealing focus.
- Offer time-warning controls compatible with accommodations; pause/extension changes are announced and recorded.
- Screen readers receive question number, prompt structure, maximum points where appropriate, answer label, flag state, and navigator state.
- Support Windows high contrast/forced colors, reduced motion, text spacing overrides, voice input, switch/keyboard operation, and browser zoom.
- Never require drag-only reorder, hover-only detail, color-only state, memory of a one-time code, or CAPTCHA that lacks an accessible path.

## Visual QA evidence

For every primary page and destructive/recovery state, capture the approved reference and implementation at identical viewport/state, compare them side by side, and record visible differences. Required states include empty/loading/success/offline/conflict/error/confirmation/read-only, long legal text, 100 questions, large Student names, zoom/reflow, keyboard focus, and print. Screenshots complement—but never replace—functional, accessibility, file-open, and human evidence.
