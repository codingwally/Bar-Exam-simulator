# Practice examination design verification

Reviewed 2026-10-24. This evaluates the rebuilt practice platform's visible design; it does not certify live hosting, email delivery or official-examination readiness.

## Visual truth and comparison

The owner requested the Examplify examination structure with Due Diligence branding. The reference is the actual ExamSoft documentation imagery, not the rejected first pilot:

- Numbered navigation: https://support.examsoft.com/hc/article_attachments/12547333320589 (350 × 418 pixels).
- Tools panel: https://support.examsoft.com/hc/article_attachments/20895468031373 (370 × 635 pixels).
- Essay editor: https://support.examsoft.com/hc/article_attachments/22757417388429 (1799 × 803 pixels).

Downloaded source files are `.wrangler/reference-examplify-{nav,toolkit,essay}.png`. The combined full-view comparison is `.wrangler/evidence/rebuild/design-comparison.jpg`; the combined tools/phone comparison is `.wrangler/evidence/rebuild/design-focused-comparison.jpg`. Both combined images were opened and visually inspected. Source images remain research material outside the committed application.

Implementation evidence: [desktop](review-evidence/rebuild/student-desktop.jpg), [390px phone](review-evidence/rebuild/student-phone-390.jpg), [320px phone](review-evidence/rebuild/student-phone-320.jpg), [receipt](review-evidence/rebuild/student-receipt.jpg), [professor desk](review-evidence/rebuild/professor-desk.jpg), [upload](review-evidence/rebuild/professor-upload.jpg), [collected responses](review-evidence/rebuild/professor-collected-answers.jpg).

The desktop capture is 1280 × 720 pixels at a 1280 × 720 CSS viewport. Phone captures are 390 × 844 and 320 × 740 pixels at matching CSS viewports. Density is 1 pixel per CSS pixel. The full comparison scales the research crops to fit, retaining aspect ratio; the focused tools comparison uses the original 370 × 635 crop and unscaled implementation regions. These documentation crops have different content and do not expose a complete native application frame. This is a structural comparison, not a claim of pixel identity.

The intended differences are the Due Diligence charcoal, parchment and muted gold palette, local licensed Inter/Fraunces typography, plain text answers, browser-appropriate controls and responsive drawers. ExamSoft marks and OS lockdown behavior are not part of this web application. Calculators, rich text formatting, highlighting and grading are outside the requested essay collection workflow.

## Findings and fixes

1. **[P2, corrected] Narrow viewport expanded beyond its width.** An earlier 390px rehearsal had a 399px document, clipping persistent controls. The fix gives the collapsed examination shell an explicit `minmax(0, 1fr)` column and allows its children to shrink. Post-fix evidence came from a fresh origin serving shell v7, rather than an old cached stylesheet. At 390px, document scroll width is 390; at 320px it is 320. Timer, question content, answer area and the entire footer remain visible in the captures above.
2. **[P2, corrected] Receipt emphasized technical identifiers.** The first receipt led with UUIDs/checksum. The revised view leads with exam title, student name/email, Philippine submission time and answered count. Technical references remain under Receipt details. The synthetic 2-of-2 submission visibly focused its success heading and produced the captured receipt.
3. **[P2, corrected] Professor page could stall loading private modules.** A direct browser rehearsal exposed a missing authenticated `/import.mjs` route. The private asset allowlist and a recursive admin-module regression now cover it. A fresh professor browser loaded the page, read an actual DOCX, published its unique URL and displayed the finalized answers.

No actionable P0/P1/P2 visual findings remain in the captured states.

## Required fidelity surfaces

- **Typography:** Sans serif body and controls remain readable at normal zoom; serif branding is confined to the wordmark. Question/answer text has an adjustable size. Long exam titles truncate only in the compact examination header; the complete title appears at entry and receipt. Labels and buttons remain legible at both phone widths.
- **Layout and spacing:** The fixed desktop workspace has a slim numbered rail, question above a large answer area, a distinct right tools panel and persistent bottom navigation. It follows the reference's examination composition. Professor pages use a single clear task per view with generous text spacing. Phone navigation/tools become dismissible drawers without squeezing the answer column.
- **Color and tokens:** Charcoal/gold intentionally replace ExamSoft blue. Selection, saved status, disabled next/previous and flagged/answered states remain distinguishable. State meaning is also conveyed by text and icons, not color alone.
- **Assets and image quality:** Actual licensed Lucide SVG files provide the icons. There is no simulated product imagery or copied ExamSoft logo. Local fonts and vectors remain crisp. Research screenshots are never used as application controls.
- **Copy and content:** Professor actions say Create exam, Choose your question paper, Copy link, Responses and View answers. Instructions and numbered questions come from the reviewed source. Student copy distinguishes server saving, local saving and confirmed submission. The receipt says answers are saved; it does not claim that an unconfigured email provider delivered them.

## Interaction evidence

An actual Word file was selected through the browser file chooser. Its two main questions and lettered subparts appeared in the review form. A professor set the title and duration, confirmed review and created a unique student URL. A simulated student entered name/email, answered both questions, flagged the first, saved, changed viewport, opened the Instructions drawer and reloaded. Both answers, flag and timer survived. Review showed 2 of 2, submission returned a receipt, and the professor could read both full answers. No warning/error console entries were captured in the student or professor tabs.

Automated browser-engine checks, failure scenarios, real-device coverage and external delivery verification are tracked separately in the release review. Physical phones and a real hosted network are not established by viewport emulation.

## Implementation checklist

- [x] Compare the actual source crops and rendered implementation together.
- [x] Inspect desktop, 390px and 320px states and all five fidelity surfaces.
- [x] Correct and recapture the mobile overflow and receipt hierarchy.
- [x] Verify the professor-to-student-to-professor workflow in a browser.
- [x] Preserve plain-language entry, saving and receipt states.

final result: passed
