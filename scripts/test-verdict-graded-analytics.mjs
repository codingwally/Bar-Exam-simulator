import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Expected source section ${start} -> ${end}`);
  return html.slice(startIndex, endIndex);
};

const helperSource = [
  section('function analyticsRecordExportable(record)', 'async function verdictRequest(path, payload)'),
  section('function analyticsFiniteScore(record)', 'function analyticsTrendPoints(records)'),
  section('function analyticsTrendPoints(records)', 'function analyticsSubjectMarkup(records)'),
].join('\n');

const normalizeFivePointScore = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 5 ? score : null;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character]));
const fmtSecs = (value) => `${Math.floor(Number(value) / 60)}:${String(Number(value) % 60).padStart(2, '0')}`;
const verdictDashboard = { showDeleted: false, trendSelectedKey: '' };

const helpers = Function(
  'normalizeFivePointScore', 'escapeHtml', 'fmtSecs', 'verdictDashboard',
  `${helperSource}; return {
    analyticsRecordExportable, analyticsFiniteScore, analyticsRecordGraded,
    analyticsGradedRecords, analyticsAverage, analyticsMedian,
    analyticsTrendPoints, analyticsTrendPointLabel,
    analyticsTrendMarkup,
  };`,
)(normalizeFivePointScore, escapeHtml, fmtSecs, verdictDashboard);

const records = [
  { id: 'legacy-zero', sourceType: 'legacy_grading_result', score: 0, occurredAt: '2026-08-01T00:00:00Z', subject: 'Civil Law', feature: 'Bar Question Practice' },
  { id: 'phase-graded', sourceType: 'phase4_exam_attempt', status: 'completed', gradingComplete: true, score: 3.4, occurredAt: '2026-08-02T00:00:00Z', subject: 'Labor Law', feature: 'Bar Question Practice' },
  { id: 'phase-pending', sourceType: 'phase4_exam_attempt', status: 'pending', score: 4.1, occurredAt: '2026-08-03T00:00:00Z' },
  { id: 'phase-grading', sourceType: 'phase4_exam_attempt', status: 'grading', score: 2.5, occurredAt: '2026-08-04T00:00:00Z' },
  { id: 'phase-unanswered', sourceType: 'phase4_exam_attempt', status: 'unanswered', score: null, occurredAt: '2026-08-05T00:00:00Z' },
  { id: 'phase-null', sourceType: 'phase4_exam_attempt', status: 'completed', score: null, occurredAt: '2026-08-06T00:00:00Z' },
  { id: 'multi-partial', sourceType: 'examination_attempt', status: 'submitted', gradingComplete: false, score: 4.5, occurredAt: '2026-08-07T00:00:00Z' },
  { id: 'multi-open', sourceType: 'examination_attempt', status: 'review', gradingComplete: true, score: 4.2, occurredAt: '2026-08-08T00:00:00Z' },
  { id: 'multi-graded', sourceType: 'examination_attempt', status: 'submitted', gradingComplete: true, score: 4.0, occurredAt: '2026-08-09T00:00:00Z', subject: 'Remedial Law', feature: 'Bar Exam Simulation' },
  { id: 'local-graded', sourceType: 'local_only', gradingComplete: true, localOnly: true, score: 2.8, occurredAt: '2026-08-10T00:00:00Z', subject: 'Political Law', feature: 'Bar Question Practice' },
];

assert.deepEqual(
  helpers.analyticsGradedRecords(records).map((record) => record.id),
  ['legacy-zero', 'phase-graded', 'multi-graded', 'local-graded'],
  'Only fully graded records should enter Analytics; a genuine zero score remains valid.',
);
assert.equal(helpers.analyticsRecordExportable(records[0]), true, 'A zero-score legacy grade remains exportable.');
assert.equal(helpers.analyticsRecordExportable(records[1]), true, 'A completed phase-4 grade is exportable.');
assert.equal(helpers.analyticsRecordExportable(records[2]), false, 'A pending attempt is never exportable.');
assert.equal(helpers.analyticsRecordExportable(records[4]), false, 'An unanswered attempt is never exportable.');
assert.equal(helpers.analyticsRecordExportable(records[6]), false, 'A partial multi-question grade is never exportable.');
assert.equal(helpers.analyticsRecordExportable(records[8]), true, 'A fully graded multi-question attempt is exportable.');
assert.equal(helpers.analyticsRecordExportable(records[9]), false, 'A device-only summary cannot call the server PDF endpoint.');
assert.equal(helpers.analyticsAverage([null, undefined, '', 4, 2]), 3,
  'Missing measurements must not be misread as zero when calculating averages.');
assert.equal(helpers.analyticsMedian([null, undefined, '', 4, 2]), 3,
  'Missing measurements must not be misread as zero when calculating medians.');

const chronological = Array.from({ length: 30 }, (_, index) => ({
  id: `attempt-${index + 1}`,
  sourceType: 'phase4_exam_attempt',
  status: 'completed',
  gradingComplete: true,
  score: index === 0 ? 0 : (index % 6) - 1 < 0 ? 0 : Math.min(5, (index % 6) - 1),
  occurredAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
  subject: index % 2 ? 'Civil Law' : 'Commercial Law',
  feature: 'Bar Question Practice',
  questionId: `Q-${index + 1}`,
  elapsedSeconds: 600 + index,
  wordCount: 300,
})).reverse();
chronological.push({
  id: 'invalid-date', sourceType: 'phase4_exam_attempt', status: 'completed', gradingComplete: true,
  score: 5, occurredAt: 'not-a-date', subject: 'Invalid', feature: 'Invalid',
});
chronological.push({
  id: 'missing-date', sourceType: 'phase4_exam_attempt', status: 'completed', gradingComplete: true,
  score: 5, occurredAt: null, subject: 'Invalid', feature: 'Invalid',
});

const points = helpers.analyticsTrendPoints(chronological);
assert.equal(points.length, 24, 'Score trend should keep the latest 24 graded attempts.');
assert.equal(points[0].record.id, 'attempt-7', 'Trend points should be chronological after applying the latest-24 cap.');
assert.equal(points.at(-1).record.id, 'attempt-30');
assert.equal(points[0].change, null, 'The first visible point is the starting point.');
assert.equal(points[1].change, points[1].score - points[0].score, 'Each later point includes its change from the preceding visible attempt.');
assert.match(helpers.analyticsTrendPointLabel(points.at(-1)), /Civil Law|Commercial Law/);
assert.match(helpers.analyticsTrendPointLabel(points.at(-1)), /Bar Question Practice/);
assert.match(helpers.analyticsTrendPointLabel(points.at(-1)), /score \d\.\d out of 5/);
assert.match(helpers.analyticsTrendPointLabel(points.at(-1)), /previous attempt|Starting point/);

const markup = helpers.analyticsTrendMarkup(chronological);
assert.match(markup, /role="group"/);
assert.match(markup, /data-analytics-trend-key=/);
assert.match(markup, /aria-controls="analytics-trend-detail"/);
assert.match(markup, /Latest 5 average/);
assert.match(markup, /Recent direction/);
assert.match(markup, /analytics-trend-detail/);
assert.doesNotMatch(markup, / title=/, 'Trend detail must not depend on pointer hover.');

console.log('Graded-only Analytics eligibility, export, and informative trend checks passed.');
