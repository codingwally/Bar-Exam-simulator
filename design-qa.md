# Subject Matter Scoped Design QA — 2026-08-17

## Scope and visual source

- Approved reference: `docs/qa/option3-approved-reference.jpg` (`1487 × 1058`).
- Current production renderer fixture: `docs/qa/option3-subject-matter-fixture.html`.
- Same-view comparison: `docs/qa/option3-comparison.html`.
- Responsive frame: `docs/qa/option3-mobile-frame.html`.
- Production files reviewed: `assets/examinations.js`, `assets/examinations.css`, and the shared action-control stylesheet.
- This pass was deliberately limited to the owner's express instructions. It did not redesign unrelated pages, navigation, branding, examination logic, grading, or content.

## Required corrections verified

1. The established arrangement is restored: question, Writing Approach, and answer workspace are on the left; review disclosures are on the right.
2. The result state uses the same orientation: submitted question, answer, and assessment on the left; review on the right.
3. The retired “one focused question” and “One-question review session” wording is absent.
4. Duplicate autosave and placeholder reveal explanations are removed.
5. The three review controls remain native, keyboard-operable disclosures and are closed initially.
6. The necessary pre-submission consequence remains visible: revealing classifies the attempt as Assisted / Open-book and excludes it from unassisted mastery metrics without reducing its score.
7. Subject Matter actions use the shared Due Diligence control system; no gold gradient was reintroduced.

## Browser evidence

- Desktop renderer viewport: `1363 × 936`.
- Answer pane left edge: `53px`; review pane left edge: `674px`; therefore answer precedes review.
- Three closed disclosure labels were observed: Suggested Answer, Controlling Law and Doctrine, and Application/Limits/Sources.
- Desktop page-level horizontal overflow: none.
- The browser text check found no retired one-question wording.
- Responsive iframe viewport: `390px`; document width: `375px`; page-level horizontal overflow: none.
- Mobile writing top: `319px`; mobile review top: `1469px`; therefore writing stacks before review.
- Mobile controls under 44px: none.
- The approved reference and current implementation were rendered together in the same comparison page before this assessment.

## Intentional differences from the reference

- The reference shows some review material already open. The current pre-submission state correctly keeps all three protected disclosures closed until the user chooses one.
- The current UI includes the durable Assisted / Open-book consequence because omitting it would conceal a real classification change.
- The local fixture header is not acceptance evidence for the production global header; the scoped Subject Matter composition is the comparison target.

## Final QA result

final result: passed

This pass covers only the explicitly requested Subject Matter layout/copy/control corrections. It is local preview evidence, not a staging or production deployment claim.

# Quorum Design QA

## Scope

- Reference: `C:\Users\wally\OneDrive\Desktop\DUEDILLEGENCE PROGRAM\QR IMAGE\mock up image.png`
- Implementation: authenticated staging Quorum experience
- Combined comparison: `docs/qa/quorum-reference-comparison.png`
- Normalized reference: `docs/qa/quorum-reference-normalized.png`
- Normalized implementation: `docs/qa/quorum-implementation-normalized.png`
- Overlay: `docs/qa/quorum-reference-overlay.png`
- Absolute-channel diff: `docs/qa/quorum-reference-diff.png`
- Desktop comparison state: Quorum active, authenticated user, reaction menu open.
- Responsive checks: 125% browser zoom for the medium-width navigation breakpoint and 150% browser zoom for the compact/mobile layout.

## Reference fidelity

The implementation preserves the supplied concept's essential product structure:

- Judicial navy, brass-gold, and alabaster visual language.
- Three-column desktop Quorum layout with navigation, feed, and community insights.
- Compact composer with a progressive-disclosure `Add details` control.
- `I Hear`, `I See`, and `I Feel` reaction choices.
- Prominent community tagline:
  “The floor is yours—speak your mind, ask questions, share your law school journey, and learn together.”

Intentional product differences are retained where they support the existing production application: the Early Access notice, global search, Study Circles, Support and Partnerships navigation, initials-based user avatar, and current authorization-aware controls.

## Issues found and resolved

1. The Quorum banner did not span the available page width.
   - Removed the unnecessary maximum-width constraint while preserving the existing typography and color treatment.
2. `Quorum Feed` had insufficient contrast on its light surface.
   - Restored the existing dark navy text token for a readable heading.
3. The composer was substantially taller than the supplied reference.
   - Reduced the default writing area and moved optional metadata behind `Add details`.
4. The community-standard notice had weak contrast.
   - Restored the dark legal-notice treatment and light text.
5. Navigation labels overlapped at the medium-width breakpoint.
   - Changed the side-navigation layout to a single column until the compact breakpoint.
6. Compact/mobile controls required clearer wrapping.
   - Verified the navigation, composer actions, post controls, and feed cards wrap without page-level horizontal overflow.

## Final QA result

**PASS — no blocking visual defects found.**

- Desktop hierarchy and three-column layout are stable.
- Medium-width navigation no longer overlaps.
- Compact/mobile content remains readable and operable.
- Reaction controls visibly match the requested vocabulary.
- No unrelated global design changes were introduced.

The unmasked raw-pixel comparison reports 72.98% of pixels within a 24-channel
tolerance (mean absolute channel error 48.03). This number is recorded for
reproducibility, not presented as a 98% visual-equivalence claim: the supplied
concept contains fixture identities, photographs, engagement counts, and
navigation labels that the production application must not copy. The combined
comparison and overlay therefore remain the authoritative QA evidence for the
approved structural target and intentional product-content differences.

# Private Beta Landing Design QA

## Scope

- Approved reference: `docs/visual-references/private-beta/Due_Diligence_Private_Beta_Landing_Approved_Reference.png`
- Reference SHA-256: `DD56E1526845086D11EF0F9FA1FB6819EFDBEA2941CA5D029237BC37C6A7BE4C`
- Reference and desktop implementation viewport: 1487 × 1058.
- Desktop implementation capture: `docs/qa/20260731-private-beta-admission/landing-implementation-1487x1058.png`
- Same-viewport comparison: `docs/qa/20260731-private-beta-admission/landing-reference-comparison.png`
- Comparison harness: `docs/qa/20260731-private-beta-admission/landing-comparison.html`
- Mobile landing capture: `docs/qa/20260731-private-beta-admission/landing-mobile-390x844.png`
- Mobile admission-dialog capture: `docs/qa/20260731-private-beta-admission/admission-mobile-390x844.png`

## Issues found and resolved

1. The initial hero crop obscured the student's face relative to the approved reference.
   - Regenerated the responsive library-student variants with a north-weighted crop while preserving the approved source image.
2. Explicit desktop headline breaks concatenated words at the compact breakpoint.
   - Preserved the five-line desktop composition and restored natural mobile wrapping with accessible source spacing.
3. Directional rail cues conflicted with an existing terminology contract.
   - Kept semantic labels free of decorative characters and rendered the cues through presentation-only CSS.
4. The brand descriptor could render inline with the wordmark at some widths.
   - Restored block layout for the wordmark and descriptor.
5. Continuous photo motion required an explicit user control.
   - Added a visible pause/resume control and honored reduced-motion and document-visibility preferences.

## Responsive and interaction checks

- Desktop: 1487 × 1058, with the approved header, split hero, dual image rails, CTA hierarchy, and three-part summary band preserved.
- Mobile: 390 × 844, with no page-level horizontal overflow and a fully operable admission dialog.
- High-zoom approximation: 744 × 529, with stable wrapping and no horizontal overflow.
- Keyboard-accessible native dialog, disclosure-end control, acknowledgement gating, access-code form, and existing legal-notice links verified.
- Browser console: no relevant warnings or errors during the verified journey.

## Intentional differences

- The implementation uses the five approved supplied photographs in responsive, moving rails rather than copying fixture imagery from the reference.
- A visible Pause Motion control is retained as an accessibility improvement.
- Minor crop and rail-frame differences reflect responsive production behavior while preserving the approved hierarchy and visual direction.

## Final QA result

**PASS — no P0, P1, or P2 visual defects found in the implemented landing experience.**

This design-quality result does not authorize launch. Founder-role verification, legal/editorial approval, a measured blind grading benchmark, and verified production capacity are separate launch gates.

# Mock Bar Subject Chooser Exit Design QA

## Scope

- Source truth: `C:\Users\wally\AppData\Local\Temp\codex-clipboard-4035f08b-6333-49fe-8dcd-2b702bb5104e.png`
- Implementation screenshot: `C:\Users\wally\AppData\Local\Temp\duediligence-mockbar-chooser-exit-source-matched.jpg`
- Source pixel dimensions: 1895 × 1036
- Comparison viewport: 1516 × 829 CSS pixels at device pixel ratio 1.25
- Implementation capture export: 1369 × 823 pixels (the in-app browser resampled the screenshot export while preserving the inspected CSS viewport and density)
- State: Mock Bar subject chooser, desktop, equivalent scrolled header state; no subject selected and no timer running

## Full-view comparison evidence

The existing navy background, gold card edge, serif heading, two-column subject grid, header navigation, typography, spacing, and decorative lower-right circle remain unchanged. The only visible additions are an established circular × control in the card's upper-right corner and a restrained Back action in the card's existing lower-right whitespace.

## Focused-region comparison evidence

- Upper-right: the 42 × 42 pixel close control uses the existing navy, alabaster, gold-border, radius, hover, and focus language. Its accessible name is “Close subject selection and return to Mock Bar.”
- Lower-right: Back is positioned within pre-existing whitespace on desktop and becomes a full-width action below the subject list on mobile.
- Mobile 390 × 844: the close control is visible when the chooser opens, Back is visible at the card bottom, and no horizontal overflow occurs.

## Interaction evidence

- × returns to the existing Mock Bar welcome screen.
- Back returns to the existing Mock Bar welcome screen.
- Escape returns to the existing Mock Bar welcome screen.
- Opening the chooser scrolls to its top and focuses the close control with `preventScroll`, keeping the exit visible for keyboard and mobile users.

## Findings

- P0: none
- P1: none
- P2: none

## Iteration history

1. First pass exposed that a flow-positioned Back row changed the desktop card height. It was moved into the card's existing lower-right whitespace.
2. Mobile inspection exposed that prior focus behavior could leave the close control above the viewport. Initial focus was moved to the close control and the chooser now opens at the top.
3. Final desktop, mobile, accessibility, and interaction comparisons passed without actionable findings.

final result: passed

# Examination Room Class Results Visual QA

## Scope

- Surface: owning-Professor class-results selection modal and analytics dashboard.
- Local build: isolated feature worktree served on `127.0.0.1` with synthetic student data only.
- Design constraint: preserve the live Examination Room navy/gold visual system and universal dialog exit controls.

## Verified layouts

- Desktop viewport: modal centered within the viewport, internally scrollable, no page-level horizontal overflow.
- Mobile viewport: 390 × 844 override (375 CSS-pixel layout width in the in-app browser), modal inset within the viewport, no horizontal overflow.
- Primary and secondary actions stack to full width at the mobile breakpoint.
- Dense candidate lists remain independently scrollable at production-scale row counts.
- Dashboard metric cards collapse through the existing responsive grid; question and student tables remain in bounded horizontal table wrappers.

## Accessibility and interaction

- Modal has an accessible heading and labelled student-selection group.
- The established upper-right × control is visible and labelled “Close dialog and go back.”
- The established Back action is present at the bottom of the modal.
- Native checkboxes retain visible focus styling, select-all supports checked/indeterminate states, and disabled sending remains visibly distinct.
- Text and controls use the existing high-contrast alabaster/gold-on-navy palette.
- Downloading or sending closes the modal before rendering the dashboard; no interval, recursive render, or navigation loop is introduced.

## Findings resolved

1. Ungraded `null` scores were initially eligible for numeric-zero analytics. They now remain blank and are excluded from averages; a Professor-assigned zero remains valid.
2. A selected export initially retained full-class attendance rows. It now includes only roster identities matching the selected submitted attempts.
3. The offline workbook was initially gated by grade finalization. It is now available before finalization, while official release continues to require all final grades.
4. Retrying an interrupted export initially changed the workbook creation timestamp and digest. The export now reuses its audited request timestamp so retries are byte-for-byte deterministic.

## Workbook compatibility

- A synthetic, non-production workbook opened successfully in installed Microsoft Excel.
- Excel exposed all five expected sheets and preserved the exact Professor question, submitted answer, and decimal score.
- Long Professor questions are split across labelled continuation cells before Excel's per-cell text limit, without dropping content.

## Result

**PASS — no P0, P1, or P2 visual, responsive, or interaction defects in the class-results workflow.**

# Homepage Feature Ledger and Chamber Pages Design QA

## Visual target

- Approved reference: `C:\Users\wally\.codex\generated_images\019f94a6-ad52-78e1-b319-4945649d7e3c\exec-92abb1fd-3434-4e41-8617-90697d86fd64.png`
- Latest implementation capture: `C:\Users\wally\AppData\Local\Temp\duediligence-homepage-ledger-1440-v3.jpg`
- Side-by-side comparison: `C:\Users\wally\AppData\Local\Temp\duediligence-homepage-ledger-comparison-v3.jpg`

The implementation preserves the live navy, gold, cream, serif, and mono design language while replacing the old stock-photo landing composition with the approved 2×2 editorial feature ledger. Every visual uses a real product screenshot, and the existing top-level navigation controls remain intact.

## Homepage verification

- Four distinct ledger sections render in the intended order: The Academy, The Commons, BarBound, and Examination Room.
- The Academy exposes real Mock Bar, Subject Matter, and Verdict previews.
- The Commons exposes real Bar Easy, Quorum, and Retainer previews.
- BarBound exposes real Bar Feels, Chair's Cases, Doctrines, and Anchor Cases previews.
- Examination Room uses the real role-entry interface preview.
- Screenshot previews and text actions preserve the existing feature routes and access checks.
- No stock-photo reference remains in the homepage or chamber rendering path.

## Chamber verification

- The Academy renders three feature rows.
- The Commons renders three feature rows.
- BarBound renders four feature rows.
- Each chamber uses an editorial introduction, real screenshot collage, alternating feature rows, and existing feature actions.
- Back navigation returns to the four-section ledger.

## Responsive and accessibility verification

- Browser-tested at 1366×768, 1024×768, 768×1024, 390×844, and 320×700.
- No horizontal overflow at any tested width.
- Mobile chamber feature rows stack in reading order.
- All visible primary and chamber actions are at least 44px high.
- Every screenshot has meaningful alternative text.
- Every screenshot button has an accessible label.
- Focus-visible outlines remain present for ledger, chamber, header, and dialog controls.
- Reduced-motion handling remains present.
- Color and typography stay within the existing high-contrast navy/gold system.

## Regression evidence

- `node --check assets/private-beta-landing.js` — passed.
- `node scripts/test-private-beta-landing.mjs` — passed.
- `node scripts/test-pages-artifact.mjs` — passed.
- `node scripts/test-duediligence-2026-frontend.mjs` — passed.
- `node scripts/test-afk-production-debug.mjs` — passed.
- `node scripts/test-dialog-exit-controls.mjs` — passed.
- `node scripts/test-exam-session-controller.mjs` — passed.
- `node scripts/test-contact-routes.mjs` — passed.
- `node scripts/test-website-question-bank.mjs` — passed.
- Complete local non-staging regression inventory — 71 of 71 test scripts passed.
- Five credentialed staging suites were reserved for the protected GitHub staging environment; no credential was requested or exposed locally.
- `git diff --check` — passed.

final result: passed
