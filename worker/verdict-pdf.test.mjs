import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildVerdictPdf, verdictPdfFileName } from './verdict-pdf.mjs';

const result = {
  resultId: '123e4567-e89b-42d3-a456-426614174000',
  subject: 'Labor Law',
  barYear: 2024,
  questionNumber: '18',
  question: 'May an employer dismiss an employee without notice? Explain. ⚖',
  suggestedAnswer: 'No. The employee is entitled to substantive and procedural due process.',
  userAnswer: 'No. Notice and an opportunity to be heard are required before dismissal.',
  feedback: {
    coachingTips: ['State the direct answer first.', 'Apply the notice facts expressly.'],
  },
  score: 4.2,
  gradedAt: '2026-08-04T00:00:00Z',
};

test('Verdict PDF is valid, paginated, Unicode-capable, private-export sized, and named safely', async () => {
  const bytes = await buildVerdictPdf({ result, selectionKind: 'entire_result', selectedIds: [] });
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(bytes.length > 1_000);
  assert.ok(bytes.length < 25 * 1024 * 1024);
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() >= 1);
  assert.equal(verdictPdfFileName(result), 'duediligence-verdict-labor-law.pdf');
});

test('Verdict PDF paginates long answers without corrupting output', async () => {
  const bytes = await buildVerdictPdf({
    result: {
      ...result,
      userAnswer: `${'Application to the material facts remains necessary. '.repeat(800)}\nWakas.`,
    },
  });
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() > 2);
});

test('Verdict PDF rejects an empty selected-question set', async () => {
  await assert.rejects(
    () => buildVerdictPdf({ result, selectionKind: 'questions', selectedIds: ['missing'] }),
    (error) => error.code === 'EMPTY_PDF_SELECTION',
  );
});

test('Verdict PDF supports selected sections while retaining all four required question blocks', async () => {
  const long = 'Material legal analysis and application. '.repeat(180);
  const multi = {
    ...result,
    sections: [
      { id: 'labor', label: 'Labor', questions: [{ id: 'q1', question: long, suggestedAnswer: long, userAnswer: long, feedback: long }] },
      { id: 'remedial', label: 'Remedial', questions: [{ id: 'q2', question: long, suggestedAnswer: long, userAnswer: long, feedback: long }] },
    ],
  };
  const entire = await PDFDocument.load(await buildVerdictPdf({ result: multi }));
  const selected = await PDFDocument.load(await buildVerdictPdf({
    result: multi, selectionKind: 'sections', selectedIds: ['remedial'],
  }));
  assert.ok(selected.getPageCount() >= 2);
  assert.ok(selected.getPageCount() < entire.getPageCount());
});

test('Verdict PDF supports selected individual questions', async () => {
  const long = 'Complete answer block. '.repeat(200);
  const multi = {
    ...result,
    questions: [
      { id: 'q1', question: long, suggestedAnswer: long, userAnswer: long, feedback: long },
      { id: 'q2', question: long, suggestedAnswer: long, userAnswer: long, feedback: long },
    ],
  };
  const entire = await PDFDocument.load(await buildVerdictPdf({ result: multi }));
  const selected = await PDFDocument.load(await buildVerdictPdf({
    result: multi, selectionKind: 'questions', selectedIds: ['q2'],
  }));
  assert.ok(selected.getPageCount() >= 2);
  assert.ok(selected.getPageCount() < entire.getPageCount());
});
