import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExamClassResultsWorkbook,
  examClassResultsWorkbookFileName,
} from './exam-results-workbook.mjs';

const dataset = {
  examId: '123e4567-e89b-42d3-a456-426614174001',
  title: 'Labor Law Midterm',
  generatedAt: '2026-08-12T04:00:00Z',
  expectedCount: 2,
  exportScope: 'offline_grading',
  classStatuses: [
    { studentName: 'Ana Reyes', studentEmail: 'ana@example.test', studentNumber: '2026-001', candidateNumber: 'C-01', status: 'submitted', displayStatus: 'Submitted', submittedAt: '2026-08-12T03:00:00Z', late: false },
    { studentName: 'Ben Cruz', studentEmail: 'ben@example.test', studentNumber: '2026-002', candidateNumber: 'C-02', status: 'no_show', displayStatus: 'Absent', absent: true, late: false },
  ],
  candidates: [{
    attemptId: '123e4567-e89b-42d3-a456-426614174003',
    studentName: '=HYPERLINK("https://example.test")',
    studentEmail: 'ana@example.test',
    studentNumber: '2026-001',
    candidateNumber: 'C-01',
    status: 'submitted',
    startedAt: '2026-08-12T01:00:00Z',
    serverDeadline: '2026-08-12T03:00:00Z',
    submittedAt: '2026-08-12T02:50:00Z',
    late: false,
    allGradesFinal: false,
    unansweredCount: 0,
    incidentCount: 1,
    questions: [{
      questionId: '123e4567-e89b-42d3-a456-426614174005',
      ordinal: 1,
      prompt: 'Was the dismissal valid? Explain.',
      answer: '+No. The employer failed to observe due process.',
      maximumPoints: 5,
      score: 3.5,
      gradeState: 'draft',
      comment: 'Add the controlling Labor Code provision.',
    }, {
      questionId: '123e4567-e89b-42d3-a456-426614174006',
      ordinal: 2,
      prompt: 'What relief is available?',
      answer: 'Reinstatement and full backwages may be awarded.',
      maximumPoints: 5,
      score: null,
      gradeState: 'ungraded',
      comment: '',
    }],
  }],
};

function zipText(bytes) {
  return new TextDecoder().decode(bytes);
}

test('class workbook is a styled multi-sheet OOXML package with offline grading data', () => {
  const bytes = buildExamClassResultsWorkbook({ dataset });
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(bytes.length > 5_000);
  const text = zipText(bytes);
  for (const name of ['Summary', 'Class Results', 'Offline Grading', 'Question Analytics', 'Attendance &amp; Timing']) {
    assert.match(text, new RegExp(name));
  }
  assert.match(text, /Was the dismissal valid\? Explain\./);
  assert.match(text, /The employer failed to observe due process\./);
  assert.match(text, /Offline Score Entry/);
  assert.match(text, /Offline Comment \/ Verification Notes/);
  assert.match(text, /What relief is available\?/);
  assert.doesNotMatch(text, /Question 2:<\/t>.*<v>0<\/v>/,
    'a missing grade must remain blank rather than becoming a scored zero');
  assert.match(text, /freezeRows|pane ySplit="4"|state="frozen"/);
  assert.match(text, /autoFilter ref=/);
  assert.match(text, /FFD4AF37/);
  assert.match(text, /FF061C35/);
  assert.match(text, /&apos;\+No\. The employer/,
    'formula-like student answers must be stored as literal text');
  assert.match(text, /&apos;=HYPERLINK/,
    'formula-like student names must be stored as literal text');
  assert.doesNotMatch(text, /<f>HYPERLINK/);
});

test('class workbook filename is bounded and scope-specific', () => {
  assert.equal(examClassResultsWorkbookFileName({ dataset }), 'due-diligence-labor-law-midterm-offline-grading-20260812.xlsx');
});

test('same authorized export dataset produces identical bytes on retry', () => {
  const first = buildExamClassResultsWorkbook({ dataset });
  const retry = buildExamClassResultsWorkbook({ dataset: structuredClone(dataset) });
  assert.deepEqual(retry, first);
});

test('long Professor questions are preserved in Excel-safe continuation cells', () => {
  const ending = ' END-OF-LONG-PROFESSOR-QUESTION';
  const longPrompt = `${'A'.repeat(32_760)}${ending}`;
  const longDataset = structuredClone(dataset);
  longDataset.candidates[0].questions[0].prompt = longPrompt;
  const text = zipText(buildExamClassResultsWorkbook({ dataset: longDataset }));
  assert.match(text, /Exact Professor Question \(Part 2\)/);
  assert.match(text, new RegExp(ending.trim()));
  const inlineText = [...text.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
  assert.ok(inlineText.every((value) => value.length <= 32_760));
});

test('class workbook rejects malformed or unscoped data', () => {
  assert.throws(() => buildExamClassResultsWorkbook({ dataset: { title: 'Missing ID', candidates: [] } }), /INVALID/);
});
