import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSubjectMatterLegalReview,
  buildSubjectMatterTeachingPrompt,
  fallbackSubjectMatterTeachingExplanation,
  isOfficialSubjectMatterSource,
  isNearDuplicateSubjectMatterReview,
  normalizeSubjectMatterJurisprudence,
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

test('labels only allowlisted official authorities as verified sources', () => {
  assert.equal(isOfficialSubjectMatterSource(record.sources[0]), true);
  assert.equal(isOfficialSubjectMatterSource('https://legal.un.org/avl/ha/udhr/udhr.html'), true);
  assert.equal(isOfficialSubjectMatterSource('https://example.com/looks-official'), false);
  assert.throws(() => sanitizeSubjectMatterRevealRecord({
    ...record,
    sources: ['https://example.com/looks-official'],
  }, attemptId), /not available/i);
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
  assert.throws(() => validateSubjectMatterTeachingExplanation({
    ...base,
    controllingLawAndElements: 'Act No. 9999 independently grants the claimed remedy.',
  }, record), /authority outside/);
  assert.throws(() => validateSubjectMatterTeachingExplanation({
    ...base,
    controllingLawAndElements: 'The Imaginary Reliance Doctrine independently controls the result.',
  }, record), /authority outside/);
});

test('fallback stays complete when Gemini is unavailable', () => {
  const fallback = fallbackSubjectMatterTeachingExplanation(record);
  assert.match(fallback.directAnswer, /^No\./);
  assert.match(fallback.controllingLawAndElements, /political-offense doctrine/);
  assert.match(fallback.applicationToFacts, /personal revenge/i);
  assert.match(fallback.finalConclusion, /prosecuted separately/i);
});

test('fallback controlling law never repeats an unstructured suggested answer', () => {
  const suggestedAnswer = 'Article 19 applies because the defendant deliberately acted against justice and good faith, causing the claimant proven injury.';
  const material = {
    ...record,
    suggestedAnswer,
    legalBasis: 'Article 19 of the Civil Code requires every person to act with justice, give everyone his due, and observe honesty and good faith.',
    governingProvision: 'Article 19 of the Civil Code.',
    doctrine: suggestedAnswer,
    jurisprudence: [],
    citation: '',
  };
  const fallback = fallbackSubjectMatterTeachingExplanation(material);
  assert.equal(
    isNearDuplicateSubjectMatterReview(fallback.controllingLawAndElements, suggestedAnswer),
    false,
  );
  assert.match(fallback.controllingLawAndElements, /Article 19 of the Civil Code/);
});

test('fallback stays distinct when every approved rule field copies the suggested answer', () => {
  const suggestedAnswer = 'Article 19 applies because the defendant deliberately acted against justice and good faith, causing the claimant proven injury.';
  const material = {
    ...record,
    suggestedAnswer,
    legalBasis: suggestedAnswer,
    governingProvision: suggestedAnswer,
    doctrine: suggestedAnswer,
    jurisprudence: [],
    citation: suggestedAnswer,
  };
  const fallback = fallbackSubjectMatterTeachingExplanation(material);
  const review = buildSubjectMatterLegalReview(material, {
    ...fallback,
    controllingLawAndElements: suggestedAnswer,
  });
  assert.equal(
    fallback.controllingLawAndElements,
    'No distinct controlling-law explanation is available in the approved source material for this item.',
  );
  assert.equal(
    isNearDuplicateSubjectMatterReview(fallback.controllingLawAndElements, suggestedAnswer),
    false,
  );
  assert.equal(review.controllingLawAndDoctrine, fallback.controllingLawAndElements);
});

test('fallback prefers a substantive stored doctrine over a citation-only legal basis', () => {
  const material = {
    ...record,
    suggestedAnswer: 'No. Statutory redemption is unavailable after confirmation in an ordinary judicial foreclosure, although a special statute may provide otherwise.',
    legalBasis: 'Rule 68, Section 3; Act No. 3135, Section 6',
    governingProvision: 'Rule 68, Section 3; Act No. 3135, Section 6',
    doctrine: 'Ordinary judicial foreclosure permits equity of redemption before confirmation, while statutory redemption after confirmation exists only when a governing statute grants it.',
    jurisprudence: [],
    citation: 'Rule 68, Section 3; Act No. 3135, Section 6',
  };
  const fallback = fallbackSubjectMatterTeachingExplanation(material);
  assert.match(fallback.controllingLawAndElements, /equity of redemption before confirmation/i);
  assert.doesNotMatch(fallback.controllingLawAndElements, /^Rule 68/i);
});

test('legal review repairs a Gemini controlling-law field copied from the suggested answer', () => {
  const fallback = fallbackSubjectMatterTeachingExplanation(record);
  const review = buildSubjectMatterLegalReview(record, {
    ...fallback,
    controllingLawAndElements: record.suggestedAnswer,
  });
  assert.equal(
    isNearDuplicateSubjectMatterReview(review.controllingLawAndDoctrine, record.suggestedAnswer),
    false,
  );
  assert.match(review.controllingLawAndDoctrine, /political-offense doctrine/);
  assert.doesNotMatch(review.controllingLawAndDoctrine, /personal revenge/i);
});

test('ALAC fallback isolates the legal-basis section from application and conclusion', () => {
  const fallback = fallbackSubjectMatterTeachingExplanation(record);
  assert.match(fallback.controllingLawAndElements, /^Under the political-offense doctrine/i);
  assert.doesNotMatch(fallback.controllingLawAndElements, /personal revenge|prosecuted separately/i);
});

test('repairs the SM-CPII-H08 low-value authority stack without inventing law', () => {
  const repeatedAuthority = 'Rules of Court, Rule 68, Sections 2-3; Act No. 3135, Section 6';
  const material = sanitizeSubjectMatterRevealRecord({
    ...record,
    prompt: 'After a Rule 68 foreclosure sale is confirmed, the mortgagor demands a one-year statutory redemption period merely because the property is land. Is the demand necessarily correct?',
    suggestedAnswer: 'No. In ordinary judicial foreclosure under Rule 68, the mortgagor has equity of redemption—payment before confirmation under the judgment\'s terms—but no statutory right of redemption after confirmation unless a statute grants one, as in specified bank or institutional mortgage situations. Extrajudicial foreclosure under Act No. 3135 generally carries statutory redemption. The remedy therefore depends on the foreclosure mode, parties, and special law, not simply on the collateral being land.',
    legalBasis: repeatedAuthority,
    governingProvision: repeatedAuthority,
    doctrine: 'No.',
    jurisprudence: [{
      case: 'N/A — provision/rule-based candidate',
      citation: repeatedAuthority,
    }],
    citation: repeatedAuthority,
  }, attemptId);
  const fallback = fallbackSubjectMatterTeachingExplanation(material);
  const review = buildSubjectMatterLegalReview(material, fallback);

  assert.equal(material.doctrine, '');
  assert.deepEqual(material.jurisprudence, []);
  assert.doesNotMatch(review.controllingLawAndDoctrine, /^No\.?$/i);
  assert.match(review.controllingLawAndDoctrine, /equity of redemption/i);
  assert.match(review.controllingLawAndDoctrine, /Extrajudicial foreclosure/i);
  assert.match(review.applicationToFacts, /depends on the foreclosure mode/i);
  assert.equal(review.authorityReferences.length, 1);
  assert.equal(review.authorityReferences[0], repeatedAuthority);
  assert.deepEqual(review.jurisprudence, []);
});

test('canonicalizes the stored case key and retains a genuine G.R. citation', () => {
  assert.deepEqual(normalizeSubjectMatterJurisprudence([{
    case: 'Tañada v. Tuvera',
    citation: 'G.R. No. L-63915, December 29, 1986',
  }]), [{
    caseName: 'Tañada v. Tuvera',
    citation: 'G.R. No. L-63915, December 29, 1986',
  }]);
  assert.deepEqual(normalizeSubjectMatterJurisprudence([{
    case: 'Batas Pambansa Blg. 22 — Bouncing Checks Law',
    citation: 'B.P. Blg. 22',
  }]), [], 'A statute title must not be presented as jurisprudence.');
  assert.deepEqual(normalizeSubjectMatterJurisprudence([{
    case: 'People v. Sample',
    citation: 'B.P. Blg. 22',
  }]), [{ caseName: 'People v. Sample' }], 'A statute must not be mislabeled as a case citation.');
  assert.deepEqual(normalizeSubjectMatterJurisprudence([{
    case: 'Re: Anonymous Bar Matter',
    citation: 'B.M. No. 1234',
  }]), [{
    caseName: 'Re: Anonymous Bar Matter',
    citation: 'B.M. No. 1234',
  }]);
});

test('citation-only legal basis does not repeat a one-sentence approved answer', () => {
  const material = sanitizeSubjectMatterRevealRecord({
    ...record,
    suggestedAnswer: 'No. The remedy is unavailable because the approved rule requires a condition that the stated facts do not satisfy.',
    legalBasis: 'Rule 68, Section 3; Act No. 3135, Section 6',
    governingProvision: 'Rule 68, Section 3; Act No. 3135, Section 6',
    doctrine: 'No.',
    jurisprudence: [],
    citation: 'Rule 68, Section 3; Act No. 3135, Section 6',
  }, attemptId);
  const fallback = fallbackSubjectMatterTeachingExplanation(material);
  assert.equal(fallback.controllingLawAndElements, 'Rule 68, Section 3; Act No. 3135, Section 6');
  assert.equal(
    isNearDuplicateSubjectMatterReview(
      fallback.controllingLawAndElements,
      material.suggestedAnswer,
    ),
    false,
  );
  assert.match(fallback.applicationToFacts, /stated facts do not satisfy/i);
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
  assert.match(payload.legalReview.controllingLawAndDoctrine, /political-offense doctrine/);
  assert.equal(payload.legalReview.authorityReferences.length > 0, true);
  assert.equal('score' in payload, false);
});
