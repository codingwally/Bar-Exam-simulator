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
  opensAt: '2026-08-12T01:00:00Z',
  hardClosesAt: '2026-08-12T03:30:00Z',
  durationMinutes: 120,
  expectedCount: 2,
  submittedCount: 1,
  exportScope: 'offline_grading',
  questions: [{
    questionId: '123e4567-e89b-42d3-a456-426614174005',
    ordinal: 1,
    prompt: 'Was the dismissal valid? Explain.',
    maximumPoints: 5,
  }, {
    questionId: '123e4567-e89b-42d3-a456-426614174006',
    ordinal: 2,
    prompt: 'What relief is available?',
    maximumPoints: 5,
  }],
  classStatuses: [
    { studentName: 'Ana Reyes', studentEmail: 'ana@example.test', studentNumber: '2026-001', candidateNumber: 'C-01', status: 'submitted', displayStatus: 'Submitted', startedAt: '2026-08-12T01:00:00Z', submittedAt: '2026-08-12T03:00:00Z', late: false },
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

function unpackStoredZip(bytes) {
  const entries = new Map();
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    assert.equal(compressionMethod, 0, 'the deterministic workbook ZIP uses stored entries');
    const fileNameStart = offset + 30;
    const contentStart = fileNameStart + fileNameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    assert.ok(contentEnd <= bytes.length, 'the ZIP entry must remain within the package bounds');
    const fileName = decoder.decode(bytes.slice(fileNameStart, fileNameStart + fileNameLength));
    entries.set(fileName, decoder.decode(bytes.slice(contentStart, contentEnd)));
    offset = contentEnd;
  }
  return entries;
}

function worksheetCell(sheetXml, reference) {
  return sheetXml.match(new RegExp(`<c r="${reference}"[\\s\\S]*?<\\/c>`))?.[0] || '';
}

test('class workbook is a styled multi-sheet OOXML package with offline grading data', () => {
  const bytes = buildExamClassResultsWorkbook({ dataset });
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(bytes.length > 5_000);
  const text = zipText(bytes);
  for (const name of ['Summary', 'Class Results', 'Offline Grading', 'Question Analytics', 'Attendance']) {
    assert.match(text, new RegExp(name));
  }
  assert.match(text, /Student 01 - =HYPERLINK/,
    'each submitted student receives a dedicated verification worksheet');
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

test('offline workbook remains available before the first student submission', () => {
  const rosterOnly = structuredClone(dataset);
  rosterOnly.candidates = [];
  rosterOnly.submittedCount = 0;
  rosterOnly.classStatuses = rosterOnly.classStatuses.map((entry) => ({
    ...entry,
    status: 'not_started',
    displayStatus: 'Not started',
    startedAt: null,
    submittedAt: null,
    absent: false,
  }));
  const bytes = buildExamClassResultsWorkbook({ dataset: rosterOnly });
  const text = zipText(bytes);
  const entries = unpackStoredZip(bytes);
  const summary = entries.get('xl/worksheets/sheet1.xml') || '';
  const classResults = entries.get('xl/worksheets/sheet2.xml') || '';
  const questionAnalytics = entries.get('xl/worksheets/sheet4.xml') || '';
  const attendance = entries.get('xl/worksheets/sheet5.xml') || '';
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(text, />ATTENDANCE</);
  assert.match(text, /Ana Reyes/);
  assert.match(text, /Ben Cruz/);
  assert.match(text, /Was the dismissal valid\? Explain\./);
  assert.match(text, /What relief is available\?/);
  assert.match(text, /EXAMINATION SCHEDULE/);
  assert.match(text, /Aug 12, 2026/);
  assert.match(text, /120 minutes/);
  assert.match(text, /Not submitted/);
  assert.doesNotMatch(text, /Student 01 -/);
  assert.match(worksheetCell(summary, 'B10'), /inlineStr/,
    'an unavailable class average must be blank rather than a scored zero');
  for (const reference of ['G5', 'I5', 'J5', 'K5']) {
    assert.match(worksheetCell(questionAnalytics, reference), /inlineStr/,
      `${reference} must remain blank until at least one score exists`);
  }
  assert.match(classResults, /ana@example\.test/);
  assert.match(classResults, /Ben Cruz/);
  assert.match(classResults, /No grade recorded/);
  assert.doesNotMatch(classResults, />On time</);
  assert.doesNotMatch(classResults, /Candidate Number|>Timing<|>Late</);
  assert.match(attendance, /Not started/);
  assert.doesNotMatch(attendance, /Candidate Number|Late Entry|Late Submission|>Timing<|>On time</);
});

test('final-grade workbook reopens with the required A/B headers and exact values', () => {
  const finalDataset = structuredClone(dataset);
  finalDataset.exportScope = 'class_results';
  finalDataset.candidates[0].questions[0].gradeState = 'final';
  finalDataset.candidates[0].questions[1].gradeState = 'final';
  finalDataset.candidates[0].questions[1].score = 4;
  finalDataset.candidates[0].allGradesFinal = true;
  const bytes = buildExamClassResultsWorkbook({ dataset: finalDataset });
  const entries = unpackStoredZip(bytes);
  const classResults = entries.get('xl/worksheets/sheet2.xml') || '';
  const expectedHeaders = [
    'Overall Final Grade', 'Raw Score', 'Student Name', 'Email', 'Student Number',
    'Status', 'Started At', 'Deadline', 'Submitted At', 'Final Maximum', 'Grade Status',
    'Unanswered', 'Incidents', 'Q1 Score', 'Q1 Max', 'Q1 Comment', 'Q2 Score', 'Q2 Max',
    'Q2 Comment',
  ];
  expectedHeaders.forEach((header, index) => {
    const column = String.fromCharCode(65 + index);
    assert.match(worksheetCell(classResults, `${column}4`), new RegExp(`>${header.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}<`),
      `${column}4 must retain the approved class-results header order`);
  });
  assert.match(worksheetCell(classResults, 'A5'), /<v>0\.75<\/v>/);
  assert.match(worksheetCell(classResults, 'B5'), /<v>7\.5<\/v>/);
  assert.doesNotMatch(classResults, /Candidate Number|>Timing<|>Late</);
});

test('partial detailed export keeps class-wide roster and clearly separates class and selection counts', () => {
  const partial = structuredClone(dataset);
  partial.submittedCount = 2;
  partial.classStatuses[1] = {
    ...partial.classStatuses[1],
    status: 'submitted',
    displayStatus: 'Submitted',
    absent: false,
    startedAt: '2026-08-12T01:10:00Z',
    submittedAt: '2026-08-12T03:05:00Z',
  };
  const entries = unpackStoredZip(buildExamClassResultsWorkbook({ dataset: partial }));
  const summary = entries.get('xl/worksheets/sheet1.xml') || '';
  const classResults = entries.get('xl/worksheets/sheet2.xml') || '';
  assert.match(worksheetCell(summary, 'B7'), /<v>2<\/v>/,
    'the Summary must show the class-wide submitted count');
  assert.match(worksheetCell(summary, 'B8'), /<v>1<\/v>/,
    'the Summary must separately show detailed records selected for export');
  assert.match(classResults, /ana@example\.test/);
  assert.match(classResults, /Ben Cruz/,
    'the Class Results overview must retain unselected roster members');
  assert.match(classResults, /Detailed record not selected/,
    'an unselected submitted roster member must be distinguished from an ungraded selected record');
});

test('thirty similarly named students receive unique bounded detail tabs without data crossover', () => {
  const classDataset = structuredClone(dataset);
  classDataset.candidates = Array.from({ length: 30 }, (_, index) => ({
    ...structuredClone(dataset.candidates[0]),
    attemptId: `attempt-${String(index + 1).padStart(2, '0')}`,
    studentName: `Professor / Student : Duplicate Name ${'X'.repeat(40)}`,
    studentEmail: `student-${index + 1}@example.test`,
    studentNumber: `2026-${String(index + 1).padStart(3, '0')}`,
    candidateNumber: `C-${String(index + 1).padStart(2, '0')}`,
  }));
  const bytes = buildExamClassResultsWorkbook({ dataset: classDataset });
  const text = zipText(bytes);
  const entries = unpackStoredZip(bytes);
  const sheetNames = [...text.matchAll(/<sheet name="([^"]+)" sheetId=/g)].map((match) => match[1]);
  const studentSheets = sheetNames.filter((name) => name.startsWith('Student '));
  assert.equal(studentSheets.length, 30);
  assert.equal(new Set(studentSheets.map((name) => name.toLowerCase())).size, 30);
  assert.ok(studentSheets.every((name) => name.length <= 31));
  for (let index = 1; index <= 30; index += 1) {
    const studentWorksheet = entries.get(`xl/worksheets/sheet${index + 5}.xml`);
    assert.ok(studentWorksheet, `student ${index} must have a dedicated worksheet`);
    assert.match(studentWorksheet, new RegExp(`student-${index}@example\\.test`));
    assert.match(studentWorksheet, new RegExp(`2026-${String(index).padStart(3, '0')}`));
    const neighbor = index === 30 ? 29 : index + 1;
    assert.doesNotMatch(studentWorksheet, new RegExp(`student-${neighbor}@example\\.test`),
      `student ${index}'s worksheet must not contain student ${neighbor}'s identity`);
  }
  const relationships = entries.get('xl/_rels/workbook.xml.rels') || '';
  assert.equal((relationships.match(/relationships\/worksheet/g) || []).length, 35,
    'five class-level and thirty student worksheets must each have one relationship');
});

test('unfinished grading is labeled as a recorded subtotal and never as a final percentage', () => {
  const text = zipText(buildExamClassResultsWorkbook({ dataset }));
  assert.match(text, /Recorded subtotal \(not final\)/);
  assert.match(text, /1 of 2 questions graded/);
  assert.match(text, /Not final/);
});

test('final class-results workbook still requires at least one submitted attempt', () => {
  const emptyFinal = structuredClone(dataset);
  emptyFinal.candidates = [];
  emptyFinal.exportScope = 'class_results';
  assert.throws(() => buildExamClassResultsWorkbook({ dataset: emptyFinal }), /INVALID/);
});

test('long Professor questions are preserved in Excel-safe continuation cells', () => {
  const ending = ' END-OF-LONG-PROFESSOR-QUESTION';
  const longPrompt = `${'A'.repeat(32_760)}${ending}`;
  const longDataset = structuredClone(dataset);
  longDataset.candidates[0].questions[0].prompt = longPrompt;
  const bytes = buildExamClassResultsWorkbook({ dataset: longDataset });
  const text = zipText(bytes);
  const entries = unpackStoredZip(bytes);
  assert.match(text, /Exact Professor Question \(Part 2\)/);
  assert.match(text, new RegExp(ending.trim()));
  const inlineText = [...text.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
  assert.ok(inlineText.every((value) => value.length <= 32_760));
  assert.doesNotMatch(entries.get('xl/worksheets/sheet3.xml') || '', /<row r="5"[^>]*customHeight/,
    'offline grading rows must auto-fit long legal text');
  assert.doesNotMatch(entries.get('xl/worksheets/sheet6.xml') || '', /<row r="11"[^>]*customHeight/,
    'student detail rows must auto-fit long legal text');
  assert.doesNotMatch(entries.get('xl/worksheets/sheet2.xml') || '', /<row r="5"[^>]*customHeight/,
    'class-result rows must auto-fit long Professor comments');
  assert.doesNotMatch(entries.get('xl/worksheets/sheet4.xml') || '', /<row r="5"[^>]*customHeight/,
    'question-analytics rows must auto-fit long Professor questions');
});

test('class workbook rejects malformed or unscoped data', () => {
  assert.throws(() => buildExamClassResultsWorkbook({ dataset: { title: 'Missing ID', candidates: [] } }), /INVALID/);
});

test('class workbook rejects an aggregate export that exceeds the bounded in-memory budget', () => {
  const oversized = structuredClone(dataset);
  oversized.candidates = Array.from({ length: 300 }, (_, candidateIndex) => ({
    ...structuredClone(dataset.candidates[0]),
    attemptId: `attempt-${candidateIndex}`,
    studentEmail: `student-${candidateIndex}@example.test`,
    questions: Array.from({ length: 200 }, (_, questionIndex) => ({
      ...structuredClone(dataset.candidates[0].questions[0]),
      questionId: `question-${candidateIndex}-${questionIndex}`,
      ordinal: questionIndex + 1,
    })),
  }));
  assert.throws(() => buildExamClassResultsWorkbook({ dataset: oversized }), /TOO_LARGE/);
});
