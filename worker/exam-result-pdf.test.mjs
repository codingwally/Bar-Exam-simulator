import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildExamResultPdf, examResultPdfFileName } from './exam-result-pdf.mjs';

const base = Object.freeze({
  exportId: '123e4567-e89b-42d3-a456-426614174012',
  examId: '123e4567-e89b-42d3-a456-426614174001',
  examTitle: 'Criminal Law II - Finals',
  candidateNumber: '0012',
  submittedAt: '2026-08-10T04:00:00Z',
  generatedAt: '2026-08-10T05:00:00Z',
  questionCount: 1,
  totals: { score: 8, maximumPoints: 10 },
});

test('all three candidate PDF packages render as bounded valid documents', async () => {
  const packages = {
    questions_answers: [{
      ordinal: 1,
      prompt: 'Discuss the elements of the offense.',
      answer: 'The prosecution must establish every element beyond reasonable doubt.',
    }],
    answers_only: [{
      ordinal: 1,
      answer: 'The prosecution must establish every element beyond reasonable doubt.',
    }],
    grades_comments: [{
      ordinal: 1,
      score: 8,
      maximumPoints: 10,
      comment: 'State each element before applying the facts.',
    }],
  };
  for (const [scope, questions] of Object.entries(packages)) {
    const bytes = await buildExamResultPdf({ ...base, scope, questions });
    assert.ok(bytes.length > 1_000 && bytes.length < 5 * 1024 * 1024);
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 1);
    assert.match(examResultPdfFileName({ ...base, scope }), new RegExp(`${scope.replaceAll('_', '-')}\\.pdf$`));
  }
});

test('questions and answers package excludes every grade and comment field', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('./exam-result-pdf.mjs', import.meta.url),
    'utf8',
  ));
  const questionsAnswersBranch = source.match(
    /if \(scope === 'questions_answers'\) \{([\s\S]*?)\} else if \(scope === 'answers_only'\)/,
  )?.[1] || '';
  assert.match(questionsAnswersBranch, /question\?\.prompt/);
  assert.match(questionsAnswersBranch, /question\?\.answer/);
  assert.doesNotMatch(questionsAnswersBranch, /score|maximumPoints|comment|Grade|Professor comment/);
  assert.match(source, /questions_answers: 'Questions and submitted answers'/);
  assert.doesNotMatch(source, /Questions, answers, grades, and comments/);
  assert.match(source, /if \(scope === 'grades_comments' && result\?\.totals\)/);
});

test('questions and answers PDF renders the complete allowed 50,000-character prompt', async () => {
  const prompt = `${'a '.repeat(24_998)}ENDX`;
  assert.equal(prompt.length, 50_000);
  const bytes = await buildExamResultPdf({
    ...base,
    scope: 'questions_answers',
    questions: [{ ordinal: 1, prompt, answer: 'Complete answer.' }],
  });
  assert.ok(bytes.length > 1_000 && bytes.length < 5 * 1024 * 1024);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 5, 'the full prompt should flow across all required pages');

  await assert.rejects(
    buildExamResultPdf({
      ...base,
      scope: 'questions_answers',
      questions: [{ ordinal: 1, prompt: `${prompt}X`, answer: 'Complete answer.' }],
    }),
    (error) => error.code === 'EXAM_ROOM_RESULT_EXPORT_TOO_LARGE' && error.status === 413,
  );
});

test('result PDF rejects an empty package and unsupported scope', async () => {
  await assert.rejects(
    buildExamResultPdf({ ...base, scope: 'answers_only', questions: [] }),
    (error) => error.code === 'EXAM_ROOM_RESULT_EXPORT_INVALID',
  );
  await assert.rejects(
    buildExamResultPdf({ ...base, scope: 'everything', questions: [{ ordinal: 1, answer: 'x' }] }),
    (error) => error.code === 'EXAM_ROOM_RESULT_EXPORT_INVALID',
  );
});
