import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSubjectMatterTeachingPrompt,
  fallbackSubjectMatterTeachingExplanation,
  publicSubjectMatterReviewPayload,
  sanitizeSubjectMatterRevealRecord,
  validateSubjectMatterTeachingExplanation,
} from './subject-matter-review.mjs';

const attemptId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const record = {
  status: 'available',
  attemptId,
  questionId,
  prompt: 'May a common crime committed for personal revenge be absorbed in rebellion?',
  suggestedAnswer: [
    'Answer: No. The killing is not absorbed in rebellion.',
    'Legal Basis: Under the political-offense doctrine, a common crime is absorbed only when committed in furtherance of the political purpose.',
    'Application: The killing was motivated by personal revenge, not the political objective of the uprising.',
    'Conclusion: The killing may be prosecuted separately.',
  ].join('\n\n'),
  legalBasis: 'Under the Revised Penal Code and the political-offense doctrine, a common crime committed for a private purpose is not absorbed in rebellion.',
  governingProvision: 'The Revised Penal Code provisions on rebellion apply together with the political-offense doctrine.',
  doctrine: 'Absorption depends on whether the common crime furthered the political objective rather than a private purpose.',
  jurisprudence: [{ caseName: 'People v. Test', doctrine: 'Private-purpose crimes are not absorbed.' }],
  citation: 'People v. Test',
  sources: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'],
  assisted: true,
  assistanceKnown: true,
  reviewMaterialRevealedAt: '2026-08-14T05:00:00.000Z',
};

test('sanitizes the exact immutable review record and no private extras', () => {
  const sanitized = sanitizeSubjectMatterRevealRecord({ ...record, privateNote: 'never return' }, attemptId);
  assert.equal(sanitized.attemptId, attemptId);
  assert.equal(sanitized.questionId, questionId);
  assert.equal(sanitized.assisted, true);
  assert.equal('privateNote' in sanitized, false);
});

test('teaching prompt is explicitly corpus-bound and separate from grading', () => {
  const prompt = buildSubjectMatterTeachingPrompt(record);
  assert.match(prompt, /Use only the CURATED CORPUS/);
  assert.match(prompt, /not grading/i);
  assert.match(prompt, /Do not introduce another authority/i);
  assert.match(prompt, /approvedSourceUrls/);
});

test('accepts a complete explanation that uses only stored authority', () => {
  const explanation = validateSubjectMatterTeachingExplanation({
    directAnswer: 'No. The killing is not absorbed in rebellion.',
    controllingLawAndElements: 'The Revised Penal Code and political-offense doctrine require a political, not private, purpose.',
    applicationToFacts: 'The exact fact of personal revenge shows a private purpose.',
    materialExceptionsOrLimits: 'No additional material exception is stated in the approved review material.',
    finalConclusion: 'The killing may be prosecuted separately.',
  }, record);
  assert.equal(explanation.applicationToFacts, 'The exact fact of personal revenge shows a private purpose.');
});

test('rejects a new URL or authority outside the curated corpus', () => {
  const base = {
    directAnswer: 'No. The killing is not absorbed in rebellion.',
    controllingLawAndElements: 'The Revised Penal Code and political-offense doctrine require a political purpose.',
    applicationToFacts: 'Personal revenge is a private purpose.',
    materialExceptionsOrLimits: 'No additional material exception is stated in the approved review material.',
    finalConclusion: 'The killing may be prosecuted separately.',
  };
  assert.throws(() => validateSubjectMatterTeachingExplanation({
    ...base,
    applicationToFacts: 'See https://example.com for a different authority.',
  }, record), /URL outside/);
  assert.throws(() => validateSubjectMatterTeachingExplanation({
    ...base,
    controllingLawAndElements: 'Article 999 of the Civil Code independently controls.',
  }, record), /authority outside/);
});

test('fallback stays complete when Gemini is unavailable', () => {
  const fallback = fallbackSubjectMatterTeachingExplanation(record);
  assert.match(fallback.directAnswer, /^No\./);
  assert.match(fallback.controllingLawAndElements, /Revised Penal Code/);
  assert.match(fallback.applicationToFacts, /personal revenge/i);
  assert.match(fallback.finalConclusion, /prosecuted separately/i);
});

test('post-submission reveal remains unassisted and does not imply a grading penalty', () => {
  const material = sanitizeSubjectMatterRevealRecord({
    ...record,
    assisted: false,
    assistanceKnown: true,
    reviewMaterialRevealedAt: '2026-08-14T06:00:00.000Z',
  }, attemptId);
  const payload = publicSubjectMatterReviewPayload(
    material,
    fallbackSubjectMatterTeachingExplanation(material),
  );
  assert.equal(payload.assisted, false);
  assert.equal(payload.assistanceKnown, true);
  assert.equal(payload.classification, 'unassisted');
  assert.equal(payload.reviewMaterialRevealedAt, '2026-08-14T06:00:00.000Z');
  assert.equal('score' in payload, false);
});
