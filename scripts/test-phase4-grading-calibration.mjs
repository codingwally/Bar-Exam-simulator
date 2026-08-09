import assert from 'node:assert/strict';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };
import {
  applyDeterministicScoreCap,
  questionFromBankRow,
} from '../worker/examiner-core.mjs';

const subjects = [
  'Political and Public International Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Commercial Law',
  'Criminal Law',
  'Remedial Law',
  'Legal and Judicial Ethics',
];

function assessment(score) {
  return {
    score,
    percentagePointValue: score,
    tier: Math.round(score).toFixed(1),
    performanceLabel: 'Calibration fixture',
    errors: [],
  };
}

function expectedPosition(context) {
  const answer = context.suggestedAnswer.match(/Answer:\s*([^\n.]+)/i)?.[1]?.trim() || 'Yes';
  return /^(no|not|invalid|improper|cannot|will not)/i.test(answer) ? 'No' : 'Yes';
}

for (const subject of subjects) {
  const row = questionBank.records.find((record) => record.Subject === subject);
  assert.ok(row, `${subject} fixture must exist`);
  const context = questionFromBankRow(row);
  const position = expectedPosition(context);

  const blank = applyDeterministicScoreCap(assessment(5), '', context);
  assert.ok(blank.score <= 0.5, `${subject}: blank answer must receive no meaningful credit`);

  const weak = applyDeterministicScoreCap(assessment(5), `${position}.`, context);
  assert.ok(weak.score <= 1, `${subject}: bare conclusion must remain at or below 1.0`);

  const generic = applyDeterministicScoreCap(
    assessment(5),
    `Answer: ${position}. Legal Basis: Under the applicable law, the governing rule applies. Application: Here, the facts satisfy the rule. Conclusion: Therefore, ${position.toLowerCase()}.`,
    context,
  );
  assert.ok(generic.score <= 2.5, `${subject}: generic ALAC must not receive an inflated score`);

  const withoutRepeatedConclusionHeading = applyDeterministicScoreCap(
    assessment(5),
    context.suggestedAnswer.replace(/\n*\s*(?:\*\*)?Conclusion(?:\*\*)?\s*:[\s\S]*$/i, ''),
    context,
  );
  assert.ok(
    withoutRepeatedConclusionHeading.score >= 4,
    `${subject}: a substantively complete answer must not be capped solely for omitting a repeated Conclusion heading`,
  );

  const strong = applyDeterministicScoreCap(assessment(4.2), context.suggestedAnswer, context);
  assert.equal(strong.score, 4.2, `${subject}: a complete stored ALAC answer may retain 4.2`);

  const exceptional = applyDeterministicScoreCap(assessment(4.8), context.suggestedAnswer, context);
  assert.equal(exceptional.score, 4.8, `${subject}: an examiner-ready answer may retain 4.8`);
}

const laborContext = questionFromBankRow(
  questionBank.records.find((record) => record['Question ID'] === 'LAB-001'),
);
const doctrineWithoutExactCitation = laborContext.suggestedAnswer
  .replace(/Article\s+\d+[A-Za-z() -]*/gi, 'the security-of-tenure rule ')
  .replace(/[A-Z][A-Za-z. ]+\sv\.\s[A-Z][A-Za-z., ]+/g, 'controlling jurisprudence');
const noCitationPenalty = applyDeterministicScoreCap(
  assessment(4.2),
  doctrineWithoutExactCitation,
  laborContext,
);
assert.equal(
  noCitationPenalty.score,
  4.2,
  'accurate doctrine and application are not penalized solely for omitted citation details',
);

console.log('Phase 4 grading calibration fixtures passed across all eight subjects.');
