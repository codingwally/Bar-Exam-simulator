import assert from 'node:assert/strict';
import {
  isBareSubjectMatterDoctrine,
  isSubjectMatterJurisprudencePlaceholder,
  normalizeSubjectMatterJurisprudence,
} from '../worker/subject-matter-review.mjs';
import {
  SUBJECT_MATTER_RELEASE_SNAPSHOT,
  SUBJECT_MATTER_RELEASE_VALUES,
} from '../worker/subject-matter-release-snapshot.mjs';

const [headers, ...values] = SUBJECT_MATTER_RELEASE_VALUES;
const headerIndex = new Map(headers.map((header, index) => [String(header || '').trim(), index]));
const requiredHeaders = [
  'Question ID',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
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
};

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
});

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

console.log(JSON.stringify({
  status: 'SUBJECT_MATTER_REVIEW_QUALITY_AUDIT_COMPLETE',
  auditedRecords: values.length,
  snapshotSha256: SUBJECT_MATTER_RELEASE_SNAPSHOT.csvSha256,
  counts: Object.fromEntries(Object.entries(findings).map(([key, ids]) => [key, ids.length])),
  sampleQuestionIds: Object.fromEntries(Object.entries(findings).map(([key, ids]) => [key, samples(ids)])),
  note: 'Editorial findings are reported without changing or suppressing the authoritative source bank.',
}, null, 2));
