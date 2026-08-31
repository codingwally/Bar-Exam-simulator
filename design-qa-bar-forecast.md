# 2026 Bar Forecast design QA

## Source truth

- Official ExamSoft essay guidance: https://support.examsoft.com/hc/en-us/articles/22757406410765-Examplify-Answer-an-Essay-Question
- Official essay workspace capture: `docs/evidence/bar-forecast/examplify-official-essay-reference.png`
- Due Diligence public preview asset: `assets/bar-forecast/forecast-workspace-preview.webp`
- Final implementation capture: `docs/evidence/bar-forecast/forecast-exam-final.png`
- Same-input visual comparison: `docs/evidence/bar-forecast/examplify-forecast-comparison.png`

All source and implementation captures were compared at 1280 by 720.

## Iterations

1. The first implementation used a wide dark-navy question rail, side-by-side prompt and editor, and a dark footer. This was visibly farther from the official essay workspace.
2. The exam surface was revised to a narrow pale blue-gray rail, vertically scrolling circular question controls, a full-width prompt above the writing area, and a pale-blue fixed footer.
3. The footer was pinned as its own grid row so Previous, Next, and Submit remain visible at 1280 by 720 while only the question workspace scrolls.
4. The navy header and thin gold line were retained as the restrained Due Diligence signature. No ExamSoft or Examplify logo, proprietary asset, or lockdown claim was copied.

## Functional verification

- Forecast appears before Quick Drills in both navigation surfaces.
- Signed-out, unresolved, and non-admin states expose only the coming-soon mockup.
- Administrator status is confirmed by the server before protected content is requested.
- Current-version consent is required before a subject can start.
- Six official subjects show the correct Manila dates and session times and may be taken anytime.
- A subject must return exactly 20 sanitized questions.
- Submit remains disabled until all 20 answers contain at least 10 words.
- Suggested answers and explanations appear only after submission.
- Total and per-question scores are shown without ALAC labels, component scores, rubric categories, or prediction scores.
- Desktop and 390-pixel responsive states remain within their layout bounds.

## Severity review

- P0: none.
- P1: none.
- P2: none remaining after the color, layout, and fixed-footer fidelity passes.

final result: passed
