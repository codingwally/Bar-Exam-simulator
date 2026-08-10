import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildVerdictPdf, verdictPdfDocument, verdictPdfFileName } from './verdict-pdf.mjs';

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

test('Verdict PDF is valid, paginated, viewer-compatible, private-export sized, and named safely', async () => {
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

test('Verdict PDF entire-result and single-question models contain the complete coaching contract', async () => {
  const multi = {
    ...result,
    questions: [
      {
        id: 'labor-1',
        subject: 'Labor Law',
        question: 'First controlled question',
        userAnswer: 'First controlled student answer',
        score: 4.2,
        feedback: {
          rationale: 'First score rationale',
          strengths: ['Direct answer'],
          errors: ['Application needs another material fact'],
          improvements: ['Connect the notice facts to due process'],
          modelAnswerALAC: {
            answer: 'No.',
            legalBasis: 'The Labor Code and due process rules govern.',
            application: 'The employee received no notice.',
            conclusion: 'Therefore, dismissal without due process is defective.',
          },
        },
        suggestedAnswer: 'First released suggested answer',
        sources: [{ title: 'Supreme Court E-Library', url: 'https://elibrary.judiciary.gov.ph/' }],
      },
      {
        id: 'labor-2',
        subject: 'Labor Law',
        question: 'Second controlled question',
        userAnswer: 'Second controlled student answer',
        score: 3.8,
        feedback: {
          rationale: 'Second score rationale',
          strengths: ['Correct conclusion'],
          errors: ['Authority needs specificity'],
          modelAnswerALAC: {
            answer: 'Yes.',
            legalBasis: 'The controlling statute applies.',
            application: 'The stated facts satisfy the statute.',
            conclusion: 'Therefore, the claim may prosper.',
          },
        },
        suggestedAnswer: 'Second released suggested answer',
        sources: [{ title: 'Official Gazette', url: 'https://www.officialgazette.gov.ph/' }],
      },
    ],
  };
  const entire = verdictPdfDocument({ result: multi });
  assert.equal(entire.questions.length, 2);
  assert.equal(entire.questions[0].prompt, 'First controlled question');
  assert.match(entire.questions[0].coaching, /First score rationale/);
  assert.match(entire.questions[0].strengths, /Direct answer/);
  assert.match(entire.questions[0].omissions, /Application needs another material fact/);
  assert.match(entire.questions[0].improvements, /Connect the notice facts to due process/);
  assert.match(entire.questions[0].improvedAnswer, /Answer:\nNo\./);
  assert.match(entire.questions[0].suggestedAnswer, /First released suggested answer/);
  assert.match(entire.questions[0].legalSources, /Supreme Court E-Library/);

  const single = verdictPdfDocument({
    result: multi,
    selectionKind: 'questions',
    selectedIds: ['labor-2'],
  });
  assert.equal(single.questions.length, 1);
  assert.equal(single.questions[0].prompt, 'Second controlled question');
  assert.doesNotMatch(JSON.stringify(single), /First controlled question/);

  const parsed = await PDFDocument.load(await buildVerdictPdf({ result: multi }));
  assert.ok(parsed.getPageCount() >= 1);
  for (const page of parsed.getPages()) {
    const contents = page.node.Contents();
    assert.ok(contents && contents.size() > 0, 'every generated page must have a non-empty content stream');
  }
});
