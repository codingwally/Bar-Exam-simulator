export const GRAMMAR_STRENGTH_RUBRIC_ID = 'grammar_strength_v1';

export const GRAMMAR_STRENGTH_RUBRIC = Object.freeze({
  id: GRAMMAR_STRENGTH_RUBRIC_ID,
  maximumPoints: 5,
  purpose: 'A non-scoring diagnostic of written grammar and clarity.',
  anchors: Object.freeze([
    '0 — No usable grammatical control; the response is not meaningfully readable.',
    '1 — Pervasive errors regularly obscure the intended meaning.',
    '2 — Frequent errors materially reduce clarity and control.',
    '3 — Generally understandable, with recurring but fixable errors.',
    '4 — Clear and controlled, with only minor lapses.',
    '5 — Precise, concise, and nearly error-free.',
  ]),
});

export function grammarStrengthPromptSection() {
  return `GRAMMAR STRENGTH — independent auxiliary rubric (${GRAMMAR_STRENGTH_RUBRIC_ID})
Purpose: assess only how clearly and correctly the learner writes. Do not assess whether the law, issue, analysis, or conclusion is correct.
Consider sentence completeness, agreement, punctuation, word choice, coherence, concision, and professional legal phrasing.
Scale:
${GRAMMAR_STRENGTH_RUBRIC.anchors.join('\n')}`;
}

export function validateGrammarStrengthDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Grammar Strength must be an object.');
  }
  const points = value.auxiliaryPoints;
  if (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 5) {
    throw new RangeError('Grammar Strength auxiliary points must be between 0 and 5.');
  }
  const briefCoaching = String(value.briefCoaching || '').replace(/\s+/g, ' ').trim();
  if (!briefCoaching || briefCoaching.length > 180) {
    throw new RangeError('Grammar Strength coaching must contain 1 to 180 characters.');
  }
  if (/\b(?:pass(?:ed|ing)?|fail(?:ed|ing)?|official\s+(?:score|grade)|answer\s+score|overall\s+score|rubric|grading)\b/i.test(briefCoaching)) {
    throw new RangeError('Grammar Strength coaching must remain separate from official grading language.');
  }
  return Object.freeze({
    auxiliaryPoints: Math.round(points * 10) / 10,
    maximumPoints: 5,
    briefCoaching,
    rubricId: GRAMMAR_STRENGTH_RUBRIC_ID,
  });
}
