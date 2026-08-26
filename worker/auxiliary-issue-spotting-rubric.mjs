export const ISSUE_SPOTTING_RUBRIC_ID = 'issue_spotting_v1';

export const ISSUE_SPOTTING_RUBRIC = Object.freeze({
  id: ISSUE_SPOTTING_RUBRIC_ID,
  maximumPoints: 5,
  purpose: 'A non-scoring diagnostic of identifying material legal issues raised by the facts.',
  anchors: Object.freeze([
    '0 — No legally relevant issue is identified.',
    '1 — Only a generic topic, vague issue, or materially misidentified issue appears.',
    '2 — Some relevant issue recognition, but a central issue or major sub-issue is omitted.',
    '3 — The central issue and some material sub-issues are identified, with notable omissions.',
    '4 — The core issue and nearly all material sub-issues are identified and prioritized.',
    '5 — The material issues are comprehensive, precise, fact-responsive, and well-prioritized.',
  ]),
});

export function issueSpottingPromptSection() {
  return `ISSUE SPOTTING — independent auxiliary rubric (${ISSUE_SPOTTING_RUBRIC_ID})
Purpose: assess only whether the learner identifies the material legal issues raised by the supplied facts. Do not assess rule accuracy, legal basis, application quality, conclusion, or writing mechanics.
Credit an issue only when the answer identifies it expressly or unmistakably. Do not award credit merely because analysis happens to touch related facts.
Scale:
${ISSUE_SPOTTING_RUBRIC.anchors.join('\n')}`;
}

export function validateIssueSpottingDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Issue Spotting must be an object.');
  }
  const points = value.auxiliaryPoints;
  if (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 5) {
    throw new RangeError('Issue Spotting auxiliary points must be between 0 and 5.');
  }
  const briefCoaching = String(value.briefCoaching || '').replace(/\s+/g, ' ').trim();
  if (!briefCoaching || briefCoaching.length > 180) {
    throw new RangeError('Issue Spotting coaching must contain 1 to 180 characters.');
  }
  if (/\b(?:pass(?:ed|ing)?|fail(?:ed|ing)?|official\s+(?:score|grade)|answer\s+score|overall\s+score|rubric|grading)\b/i.test(briefCoaching)) {
    throw new RangeError('Issue Spotting coaching must remain separate from official grading language.');
  }
  return Object.freeze({
    auxiliaryPoints: Math.round(points * 10) / 10,
    maximumPoints: 5,
    briefCoaching,
    rubricId: ISSUE_SPOTTING_RUBRIC_ID,
  });
}
