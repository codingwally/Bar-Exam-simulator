import assert from 'node:assert/strict';
import {
  buildSubjectMatterLegalReview,
  fallbackSubjectMatterTeachingExplanation,
  isBareSubjectMatterDoctrine,
  isNearDuplicateSubjectMatterReview,
  isSubjectMatterJurisprudencePlaceholder,
  normalizeSubjectMatterJurisprudence,
  sanitizeSubjectMatterRevealRecord,
} from '../worker/subject-matter-review.mjs';
import { SUBJECT_MATTER_PLACEMENTS } from '../worker/subject-matter-placement-manifest.mjs';
import {
  SUBJECT_MATTER_RELEASE_SNAPSHOT,
  SUBJECT_MATTER_RELEASE_VALUES,
} from '../worker/subject-matter-release-snapshot.mjs';

const [headers, ...values] = SUBJECT_MATTER_RELEASE_VALUES;
const headerIndex = new Map(headers.map((header, index) => [String(header || '').trim(), index]));
const requiredHeaders = [
  'Question ID',
  'Essay Question',
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
];
requiredHeaders.forEach((header) => assert.equal(headerIndex.has(header), true, `Missing ${header}.`));
assert.equal(
  values.length,
  SUBJECT_MATTER_RELEASE_SNAPSHOT.rowsIncludingHeader - 1,
  'The quality audit must cover the complete versioned Subject Matter release snapshot.',
);

const field = (row, name) => String(row[headerIndex.get(name)] || '').trim();
const normalized = (value) => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const samples = (items) => items.slice(0, 12);

const findings = {
  bareDoctrines: [],
  placeholderJurisprudence: [],
  duplicateAuthorityFields: [],
  malformedCaseEntries: [],
  exactSuggestedAnswerReviewDuplicates: [],
  nearSuggestedAnswerReviewDuplicates: [],
};

const canonicalQuestionIds = new Set(SUBJECT_MATTER_PLACEMENTS.map((placement) => placement[2]));

values.forEach((row) => {
  const questionId = field(row, 'Question ID');
  const doctrine = field(row, 'Controlling Doctrine');
  const caseName = field(row, 'Jurisprudence / Case');
  const citation = field(row, 'Citation / G.R. No.');
  const legalBasis = field(row, 'Legal Basis / Provision');

  if (isBareSubjectMatterDoctrine(doctrine)) findings.bareDoctrines.push(questionId);
  if (isSubjectMatterJurisprudencePlaceholder(caseName)) {
    findings.placeholderJurisprudence.push(questionId);
  }

  const authorityValues = [legalBasis, citation].map(normalized).filter(Boolean);
  if (authorityValues.length > new Set(authorityValues).size) {
    findings.duplicateAuthorityFields.push(questionId);
  }

  const genuineSourceCase = caseName && !isSubjectMatterJurisprudencePlaceholder(caseName);
  const normalizedCases = normalizeSubjectMatterJurisprudence([{ case: caseName, citation }]);
  if (genuineSourceCase && normalizedCases.length === 0) {
    findings.malformedCaseEntries.push(questionId);
  }

  if (canonicalQuestionIds.has(questionId)) {
    const material = {
      suggestedAnswer: field(row, 'Suggested Answer'),
      legalBasis,
      governingProvision: legalBasis,
      doctrine,
      jurisprudence: [{ case: caseName, citation }],
      citation,
    };
    const fallback = fallbackSubjectMatterTeachingExplanation(material);
    const review = buildSubjectMatterLegalReview(material, fallback);
    if (normalized(review.controllingLawAndDoctrine) === normalized(material.suggestedAnswer)) {
      findings.exactSuggestedAnswerReviewDuplicates.push(questionId);
    }
    if (isNearDuplicateSubjectMatterReview(
      review.controllingLawAndDoctrine,
      material.suggestedAnswer,
    )) {
      findings.nearSuggestedAnswerReviewDuplicates.push(questionId);
    }
  }
});

assert.equal(canonicalQuestionIds.size, 1490,
  'The review-duplication gate must cover every canonical Subject Matter question.');
if (process.argv.includes('--strict')) {
  assert.deepEqual(findings.exactSuggestedAnswerReviewDuplicates, [],
    'A controlling-law review must never exactly repeat the complete Suggested Answer.');
  assert.deepEqual(findings.nearSuggestedAnswerReviewDuplicates, [],
    'A controlling-law review must never near-repeat the complete Suggested Answer.');
}

const h08 = values.find((row) => field(row, 'Question ID') === 'SM-CPII-H08');
assert.ok(h08, 'SM-CPII-H08 must remain in the release-quality audit.');
assert.equal(isBareSubjectMatterDoctrine(field(h08, 'Controlling Doctrine')), true);
assert.equal(
  normalizeSubjectMatterJurisprudence([{
    case: field(h08, 'Jurisprudence / Case'),
    citation: field(h08, 'Citation / G.R. No.'),
  }]).length,
  0,
  'A provision-only placeholder must never survive as jurisprudence.',
);
const h08Material = sanitizeSubjectMatterRevealRecord({
  status: 'available',
  attemptId: '11111111-1111-4111-8111-111111111111',
  questionId: '22222222-2222-4222-8222-222222222222',
  prompt: field(h08, 'Essay Question'),
  suggestedAnswer: field(h08, 'Suggested Answer'),
  legalBasis: field(h08, 'Legal Basis / Provision'),
  governingProvision: field(h08, 'Legal Basis / Provision'),
  doctrine: field(h08, 'Controlling Doctrine'),
  jurisprudence: [{
    case: field(h08, 'Jurisprudence / Case'),
    citation: field(h08, 'Citation / G.R. No.'),
  }],
  citation: field(h08, 'Citation / G.R. No.'),
  sources: [field(h08, 'Source URL')],
  assisted: true,
  assistanceKnown: true,
  reviewMaterialRevealedAt: '2026-08-15T00:00:00.000Z',
}, '11111111-1111-4111-8111-111111111111');
const h08Review = buildSubjectMatterLegalReview(
  h08Material,
  fallbackSubjectMatterTeachingExplanation(h08Material),
);
assert.doesNotMatch(h08Review.controllingLawAndDoctrine, /^No\.?$/i);
assert.match(h08Review.controllingLawAndDoctrine, /equity of redemption/i);
assert.match(h08Review.controllingLawAndDoctrine, /extrajudicial foreclosure/i);
assert.match(h08Review.applicationToFacts, /foreclosure mode/i);
assert.deepEqual(h08Review.jurisprudence, []);
assert.equal(h08Review.authorityReferences.length, 1);
assert.equal((h08Review.authorityReferences.join('\n').match(/Rule 68/gi) || []).length, 1);
assert.equal((h08Review.authorityReferences.join('\n').match(/Act No\. 3135/gi) || []).length, 1);

console.log(JSON.stringify({
  status: 'SUBJECT_MATTER_REVIEW_QUALITY_AUDIT_COMPLETE',
  auditedRecords: values.length,
  canonicalRecords: canonicalQuestionIds.size,
  snapshotSha256: SUBJECT_MATTER_RELEASE_SNAPSHOT.csvSha256,
  counts: Object.fromEntries(Object.entries(findings).map(([key, ids]) => [key, ids.length])),
  sampleQuestionIds: Object.fromEntries(Object.entries(findings).map(([key, ids]) => [key, samples(ids)])),
  note: 'Editorial findings are reported without changing or suppressing the authoritative source bank.',
}, null, 2));
