# Due Diligence Bar-Aligned Holistic Grading Rubric v2

Status: founder-approved beta default
Rubric identifier: `BAR-ALIGNED-HOLISTIC-v2`

## Scope

This is the default AI essay-grading backbone for Mock Bar, Subject Matter, Bar Feels, formal examinations, and future examination features that use the shared examiner. Bar Easy is expressly excluded because it uses a separate coaching-label rubric rather than the 0.0–5.0 essay scale. Human-examiner scoring is unchanged.

## Method

The final score is holistic and uses the full 0.0–5.0 one-decimal scale. The following weights are indicative guides rather than literal arithmetic requirements:

- Responsiveness and direct answer: 20%
- Correct legal basis: 30%
- Application or requested legal analysis: 35%
- Conclusion and coherence: 15%

Legal substance controls. ALAC remains the coaching format for the returned model answer, but the student's response may use ALAC, CRAC, IRAC, ILAC, or a coherent narrative. Headings do not earn points and their absence does not lose points.

## Citation rule

Exact article, section, case, or docket citations are not required when the controlling doctrine is accurately stated and meaningfully applied. A generic phrase such as “under the law” is insufficient unless the governing rule is actually stated. An unverified authority is not deemed fabricated. Only a confirmed fabricated authority receives the 2.5 ceiling.

## Grammar

Grammar, spelling, and style are coaching matters unless they materially prevent comprehension of the legal position, rule, reasoning, or conclusion.

## Narrow ceilings

- Blank, irrelevant, incoherent, or nonsensical: 0.5
- Bare conclusion: 1.0
- Conclusion without governing rule or meaningful reasoning: 1.5
- Rule without meaningful application in a fact-based question: 2.5
- Major central issue or controlling-point gap despite meaningful analysis: 3.5
- Confirmed fabricated authority: 2.5
- Materially wrong central governing rule: 1.5

No ceiling is imposed merely for missing headings, missing exact citations, different wording, a defensible alternative theory, minor grammar, or failure to reproduce every model-answer detail.

## Beta operation

Every validated AI assessment stores the rubric identifier, authority classification, ceiling code, component breakdown, and any applied deterministic ceiling. These fields support founder review and feedback-led refinement during beta without changing the student-facing examination flow.

## Change control

The shared examiner module is the single default source of truth. Amend the rubric version whenever scoring policy changes, update both Gemini instructions and deterministic ceilings together, and preserve Bar Easy's explicit exemption.
