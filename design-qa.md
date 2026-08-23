# Approved Renovation Shell Design QA — 2026-08-21

## Controlling target

- Contract: `docs/visual-references/approved-renovation-20260821.md`.
- Approved walkthrough: `duediligence-design-walkthrough-20260821` (owner-reviewed prototype).
- Required match: 90% or better; fallback hierarchy is modern, legal, professional.
- Scope: shared shell and signed-out entry. Examination Room internals are unchanged.

## Implemented match

- Added the approved two-row desktop shell with Home immediately before Guided Practice.
- Preserved all existing real feature handlers through `data-public-feature` routes.
- Kept the icon-free accessible left drawer for mobile and overflow navigation.
- Rebuilt sign-in as a full-height split: uncropped silent video over a same-video blurred backdrop on
  the left; restrained cream admission panel and real product features on the right.
- Added the approved still transition and 30-minute replay interval without playback controls or sound.
- Preserved the canonical navy, cream, brass-gold, Fraunces, and Inter system.

## Automated gates

- `scripts/test-approved-renovation-shell.mjs` validates shell order, route bindings, sign-in composition,
  responsive stacking, focus treatment, reduced motion, video behavior, and cache versions.
- Existing authentication, onboarding, public-shell, navigation, and complete-beta contracts remain in
  the deployment gate.

## Current result

- Desktop sign-in (`1440 × 900`): the split fills the viewport, the video remains uncropped with
  `object-fit: contain`, and page-level horizontal overflow is `0px`.
- Mobile sign-in (`375 × 812`): the layout resolves to one `375px` column with `0px` horizontal overflow.
- Desktop shell (`1440 × 900`): the visible route order is exactly Home, Guided Practice, Doctrine
  Review, Bar Question Practice, Bar Exam Simulation, Analytics.
- Mobile drawer (`375 × 812`): the open drawer rectangle is exactly `x=0`, `y=0`, `375 × 812`; it
  covers the viewport without clipping or overflow.
- The complete GitHub Pages deployment test inventory passed, including authentication, onboarding,
  navigation, Subject Matter, commercial access, Quorum, Verdict, Examination Room regression,
  content validation, sanitized artifact build, and artifact verification.
- No Examination Room implementation file was changed.

final result: passed

---

# Account Setup Modernization Design QA — 2026-08-21

## Scope and visual evidence

- Owner reference: `docs/qa/onboarding-modernization-20260821/owner-reference-1141x856.png`.
- Source SHA-256: `25A269DFC29246F8C72122F58B0C501CFF3CD1F516D622AA35B13EB7CEB05C1F`.
- Source-matched implementation: `docs/qa/onboarding-modernization-20260821/desktop-source-matched-1141x856.png`.
- Short-laptop implementation: `docs/qa/onboarding-modernization-20260821/desktop-compact-1142x636.png`.
- Mobile implementation: `docs/qa/onboarding-modernization-20260821/mobile-375x812-full.png`.
- Side-by-side comparison: `docs/qa/onboarding-modernization-20260821/comparison-source-vs-redesign.png`.
- Scope is limited to the existing account setup dialog. Account creation, profile fields, legal acceptance,
  token acknowledgement, optional consent, role safety, authentication, and token rules are unchanged.

## Visible corrections

1. Replaced the narrow, vertically dense form with a balanced profile/access layout using the existing
   navy, brass-gold, alabaster, Fraunces, and Inter system.
2. Made all fields at least 52 pixels high with persistent labels, readable helper text, generous spacing,
   clear hover/focus treatment, and native autocomplete behavior.
3. Reframed the token terms as one concise, high-contrast access summary instead of a dense instruction block.
4. Grouped required and optional acknowledgements into distinct modern consent rows without changing their
   identifiers or validation requirements.
5. Added a fixed action footer so `Save and continue` stays visible while the dialog body scrolls independently.
6. Preserved every established HTML identifier and the existing upper-right close and lower action-control logic.

## Responsive and interaction verification

- Browser-tested at `1440×900`, `1366×768`, `1142×636`, `375×812`, and `320×760`.
- Horizontal overflow measured `0px` at every tested width.
- The primary action remained inside the viewport at every tested size and measured 50 pixels high.
- The short-laptop layout scrolls only its content area; the title and action footer remain stationary.
- Professor selection revealed the existing private license declaration; returning to Review hid it again.
- Terms and Privacy opened their established native views; both close and Back returned correctly.
- Required legal and token acknowledgements remained mandatory; the optional quality consent remained optional.
- The existing focus-visible rule remains present for fields, buttons, and close controls.

## Regression evidence

- `node --check assets/phase2-experience.js` — passed.
- `node scripts/test-phase2-contract.mjs` — passed.
- `node scripts/test-onboarding-flow.mjs` — passed.
- `node scripts/test-dialog-exit-controls.mjs` — passed.
- `node scripts/test-private-beta-auth-regression.mjs` — passed.
- `node scripts/test-private-beta-admission.mjs` — passed.
- `node scripts/test-auth-session-persistence.mjs` — passed.
- `node scripts/test-commercial-launch-migration.mjs` — 10/10 passed.
- `node scripts/test-pages-artifact.mjs` — passed.
- `git diff --check` — passed.

## Findings

- P0: none.
- P1: none.
- P2: none.

final result: passed

---

# Bar Question Practice Workspace Cleanup — 2026-08-21

## Scope and source truth

- Owner reference: `C:\Users\wally\AppData\Local\Temp\codex-clipboard-f301d42e-5f2a-451d-8447-e4f0475e4d6e.png` (`1383 × 863`).
- Local implementation capture: `docs/qa/renovation-20260821/bar-question-practice-cleanup-1383x863.png`.
- Inspected browser viewport: `1383 × 863`; the in-app browser exported a `1373 × 772` visible-frame capture.
- Scope was limited to Bar Question Practice navigation and answer-workspace controls. Question content, timers, answer persistence, grading, score rules, routes, and Examination Room were not changed.

## Verified corrections

1. The duplicate subject rail is removed from the visual and accessibility trees while its existing DOM identifier remains available for compatibility.
2. `Change Subject` remains visible and continues to call the existing subject-selection flow.
3. The redundant `Answer & Review` control is absent.
4. The former `The Verdict` workspace action is now `Analytics` and opens the existing Analytics dashboard.
5. The non-functional Dictate control and its dead browser-speech implementation are removed.
6. The existing answer textarea, word count, submit control, timer modes, Next action, and Exit Practice action remain in their established positions.

## Browser interaction evidence

- The Analytics control opened the `analytics-modal`; its visible heading and close label both read `Analytics`.
- Closing Analytics returned to the same answer workspace without replacing or pausing it.
- The subject rail computed to `display: none` and remained `hidden`/`aria-hidden`.
- No Dictate or Answer & Review control existed in the rendered workspace.
- Entering an answer enabled the unchanged `Evaluate and grade essay` submission control.
- The inspected desktop workspace retained the existing navy, brass-gold, alabaster, serif, sans, spacing, and control system.

## Findings

- P0: none.
- P1: none.
- P2: none.

final result: passed

---

# Home Modern Icon and Anonymous-Post QA — 2026-08-21

## Scope and reference

- Owner reference: `C:\Users\wally\AppData\Local\Temp\codex-clipboard-d64e6be8-6142-4ed5-98f1-68a51270ee2e.png`.
- Production-CSS fixture: `docs/qa/home-modern-20260821-fixture.html`.
- Scope is limited to the authenticated Home community. Examination Room, grading, access, payments,
  question content, and other product pages are unchanged.

## Visual comparison

- Preserved the controlling navy (`#051326`), brass gold (`#c5a059`), warm paper (`#fffdfa`),
  and cream (`#faf8f3`) tokens instead of introducing another hue family.
- Replaced primitive bordered sidebar boxes with a single navy Practice Exam feature panel followed by
  lightweight separated information groups. The educational disclaimer remains the final group and uses
  an explicit warm-gold surface with high-contrast navy text.
- Replaced visible Search, Add photo, Post, Refresh, View all, Browse, Affirm, Comment, Disseminate,
  Save, More, and Post comment words with locally vendored Phosphor icons where an icon is unambiguous.
  Accessible labels and native focus behavior remain intact.
- Added a modern Post anonymously control beside the composer action and retained the existing anonymous
  comment option.
- Removed the visible comment character counter while preserving native maximum-length enforcement.
- Reduced visual chrome on member posts to paper surfaces and separators rather than nested bordered cards.

## Browser verification

- Desktop `1292 × 772`: Practice Exam is the first side item; the legal disclaimer is the last; all 13
  community icon instances render; post actions expose only counts visually (`2`, `2`, `0`).
- Mobile `375 × 812`: layout width equals viewport width with no horizontal overflow; anonymous posting
  can be checked and remains keyboard-labelled.
- Narrow mobile `320 × 760`: document width equals viewport width with no horizontal overflow; composer
  remains within the available column; all five action controls retain descriptive accessible names.
- The anonymous-post checkbox was toggled successfully in the browser and its checked state was confirmed.

## Contract verification

- The existing Worker already accepts `isAnonymous`; the Home composer now sends the selected value and
  preserves it in the existing local draft payload.
- The sanitized Pages artifact contains the local icon assets and MIT license.
- Home forum contract tests, Pages artifact tests, JavaScript syntax checks, and `git diff --check` passed.

final result: passed

---

# Home Left-Navigation Cleanup Design QA — 2026-08-21

## Scope and reference

- Owner-marked reference: `C:\Users\wally\AppData\Local\Temp\codex-clipboard-f4fd1549-f536-40b9-b640-99904c27af90.png`.
- Comparison viewport: `1905 × 861`, matching the reference dimensions.
- Responsive viewports: `375 × 812` and `320 × 760`.
- Scope: shared header navigation and the authenticated Home composition only. Authentication, examination flows, data, grading, and backend behavior were not changed.

## Verified corrections

1. The right-side text `Menu` control is removed.
2. One 44-pixel, three-line navigation control sits at the far left before the Due Diligence crest and wordmark.
3. Navigation opens as a left-edge drawer and closes with its × control or Escape; focus returns to the hamburger and `aria-expanded` returns to `false`.
4. The empty wide navy Home banner and its detached Community/Explore pill are absent.
5. The duplicate lower Practice Exam promotion is absent. Exactly one Practice Exam card remains in the supporting column and stacks normally on mobile.
6. My Posts, Saved, Study Circles, and Notifications remain available through the Home tools group in the global drawer.
7. The brand descriptor remains `Philippine Bar Exam Simulator`; no retired Amicus tagline was restored.

## Browser evidence

- Desktop drawer rectangle: left `0px`, right `390px`, width `390px`.
- Desktop menu icon intrinsic size: `24 × 24`; interactive target: `44 × 44`.
- `375px` viewport: document width `365px`; no horizontal overflow; one Practice Exam card remains visible.
- `320px` viewport: drawer left `0px`, right `320px`, width `320px`; no horizontal overflow.
- Menu open state updates the accessible label from `Open navigation menu` to `Close navigation menu`.
- Escape and the visible × control both close the drawer and restore the toggle state.

## Intentional differences from the marked screenshot

- The surviving Practice Exam card remains in the right supporting column as explicitly requested; its duplicate in the main feed is the card that was removed.
- Home utilities are consolidated inside the drawer instead of being discarded, preserving existing functions while reducing page clutter.
- The examination-room shortcut remains unchanged because it was not marked for removal.

## Final QA result

final result: passed

# Policy Gate and Entry Media Repair — 2026-08-21

## Root cause and correction

- The maintenance gate correctly blocked protected Worker calls until access was verified, but authentication initialization could request `/beta/access/policy` first. That race produced HTTP 503 and surfaced the internal message “Current policy verification failed. No acceptance was recorded.”
- Authentication and legal-policy initialization now wait for the existing `duediligence:maintenance-unlocked` event before making protected requests.
- A validated release-config policy keeps the consent view recoverable during a transient public-policy read failure. The Worker remains authoritative when acceptance is recorded and confirms the current versions and timestamp.
- The internal failure message and “temporarily unavailable” presentation are no longer rendered.

## Approved reference and media treatment

- Owner reference: `docs/qa/policy-media-gate-20260821/owner-reference-1881x887.png`
- Owner-reference SHA-256: `38D9485BE14C0818103766FF07DD69002C411FCB067937B51D1055B246412DEE`
- Playing-state capture: `docs/qa/policy-media-gate-20260821/implementation-video-playing-1881x887.png`
- Static-end capture: `docs/qa/policy-media-gate-20260821/implementation-static-end-1881x887.png`
- Side-by-side comparison: `docs/qa/policy-media-gate-20260821/owner-reference-vs-fixed-1881x887.png`
- The approved local `assets/brand/signin-intro.mp4` autoplays muted, inline, without controls or picture-in-picture, then cross-fades to the existing `assets/brand/icon-512.png` image.
- Video errors, blocked autoplay, or the 12-second watchdog resolve safely to the static image. Reduced-motion users receive a non-animated presentation.

## Responsive and accessibility verification

- Browser-tested at 1881×887, 1366×768, 375×812, and 320×760.
- The upper-right close control remains labelled and anchored correctly; the lower-right Back action remains present.
- The desktop dialog remains a balanced navy/alabaster split composition. Mobile stacks into one scrollable dialog without horizontal overflow or trapped content.
- Terms and Privacy remain keyboard-operable buttons, the acknowledgment remains a labelled native checkbox, and the primary action retains visible contrast.
- Browser console inspection returned no relevant errors in desktop or mobile fixture verification.

## Regression evidence

- Phase 2 contract, maintenance lock, admission, auth-session persistence, route-overlay, onboarding, dialog-exit, and private-beta frontend tests passed.
- Approved GitHub Pages release command inventory passed after cache-key contracts were updated.
- Subject Matter, examination, commercial access, correction, Quorum, Verdict, and Examination Room regressions passed without changing their runtime logic.
- Worker maintenance-entry tests passed: 4/4.
- Sanitized Pages artifact build and verification passed.
- `git diff --check` passed.

final result: passed

# Home Comments and Taglish Community QA — 2026-08-21

## Scope and comparison evidence

- Owner reference: `docs/qa/renovation-20260820/home-comments-taglish-owner-reference-1880x900.png`.
- Owner reference SHA-256: `D77784DE0F556AD97ECE734A1A83D23706781ACAB153E704FC2466F4AE8AB7F7`.
- Authenticated implementation fixture: `docs/qa/renovation-20260820/quorum-first-authenticated-fixture.html`.
- Desktop implementation: `docs/qa/renovation-20260820/home-comments-taglish-desktop-1880x900.png`.
- Same-input side-by-side review: `docs/qa/renovation-20260820/home-comments-taglish-reference-comparison.png` and its reproducible HTML harness.
- Responsive captures: `375 × 812` and `320 × 760`.

## Verified results

1. The composer retains only its writing field, `Add photo`, image-selection status when relevant, and `Post`.
2. `Up to 12 JPEG, PNG, or WebP images`, `Add details`, `Preview`, and `Cancel` are absent.
3. `Fictional · anonymized · read-only`, `Community preview`, and `Starter discussions` are absent.
4. The feed uses ordinary published discussions. The pictured sample state uses natural Taglish and no legal-advice or AI persona claim.
5. Comments and nested replies are visible and the `Comment 2` control opens and closes the thread while updating `aria-expanded`.
6. The comment editor, anonymous-comment option, and `Post comment` action remain visible and keyboard-addressable.
7. The surviving Practice Exam card remains only in the supporting column on desktop; no duplicate promotion appears in the main feed.
8. The 375-pixel and 320-pixel layouts have no page-level horizontal overflow. The composer actions stack cleanly on mobile.
9. Existing navy, brass, alabaster, serif, mono, border, radius, and focus treatments are preserved.

## Intentional differences from the owner reference

- The reference still shows controls that the owner explicitly requested to remove; the implementation therefore has a shorter, clearer composer.
- The fixture shows an open comment thread so the now-enabled comment experience is visible in the acceptance evidence.
- Feed naming uses `Latest member discussions` rather than the expressly retired `Starter discussions` label.

final result: passed

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

# Judicial Observatory Design QA — 2026-08-23

## Selected visual target

- Reference: `exec-8990621e-35ac-4c68-ad84-acec462a25f7.png` (Option 1 — Judicial Observatory).
- Production implementation: `admin/index.html`, `admin/admin-observatory.css`, and the Executive Pulse rendering in `admin/admin.js`.
- Comparison viewport: 1440 × 900.
- Comparison method: the selected reference and rendered implementation were placed side by side in the same visual review frame.

## Fidelity checks

- Midnight/graphite shell, compact left navigation, judicial gold, cyan, and green accents: passed.
- Executive hierarchy, KPI cards, chart density, action queue, and access posture: passed.
- Due Diligence brand retained without diluting the selected observatory direction: passed.
- Real-data labeling: passed. Device and location detail are not fabricated where the current backend does not collect them.
- Responsive rules: passed by stylesheet and contract inspection for 1180 px, 920 px, 680 px, and 430 px breakpoints, including the mobile drawer and stacked content.
- Reduced-motion handling and focus-visible controls: passed.
- No test-only reference, comparison, or preview artifact is included in the release.

## Intentional production differences

- The live dashboard uses Due Diligence operational labels and available server data instead of the illustrative labels and sample figures in the visual reference.
- The dashboard exposes payment, subscription, support, learning, and audit operations already supported by the product rather than inventing unavailable data sources.

final result: passed
