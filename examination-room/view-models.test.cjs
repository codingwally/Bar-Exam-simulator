'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, 'view-models.js'), 'utf8'),
  sandbox,
  { filename: 'view-models.js' },
);
const {
  normalizeStudentQuestion,
  professorAnswerLabel,
  buildStudentResultView,
} = sandbox.ExaminationRoomV1ViewModels;

test('professor grading resolves stable multiple-choice option ids to published labels', () => {
  const question = {
    type: 'multiple_choice',
    options: ['Congress', 'Supreme Court', 'Judicial and Bar Council', 'Department of Justice'],
  };
  assert.equal(professorAnswerLabel(question, 'option-2'), 'Supreme Court');
});

test('professor grading resolves object option ids without changing written answers', () => {
  const question = {
    type: 'multiple-choice',
    choices: [{ id: 'court', label: 'Supreme Court' }, { id: 'congress', label: 'Congress' }],
  };
  assert.equal(professorAnswerLabel(question, 'court'), 'Supreme Court');
  assert.equal(professorAnswerLabel({ type: 'essay' }, 'A complete written answer.'), 'A complete written answer.');
});

test('student question normalization strips answer keys and adapts the published route shape', () => {
  const normalized = normalizeStudentQuestion({
    key: 'q004',
    number: 4,
    type: 'multiple-choice',
    prompt: 'Which body?',
    points: 25,
    choices: ['Congress', 'Supreme Court'],
    correctOptionIndex: 1,
    gradingGuidance: 'Award full points for the second option.',
    acceptedAnswers: ['Supreme Court'],
  }, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
    id: 'q004',
    number: 4,
    type: 'multiple_choice',
    title: 'Question 4',
    prompt: 'Which body?',
    instructions: '',
    required: true,
    maxWords: null,
    maxLength: null,
    options: [
      { id: 'option-1', label: 'Congress' },
      { id: 'option-2', label: 'Supreme Court' },
    ],
  });
  assert.equal('correctOptionIndex' in normalized, false);
  assert.equal('gradingGuidance' in normalized, false);
  assert.equal('acceptedAnswers' in normalized, false);
});

test('unreleased results expose no grade or feedback detail', () => {
  const view = buildStudentResultView({
    released: false,
    grades: [{ questionId: 'q-1', points: 30, feedback: 'Private draft feedback' }],
    exam: { questions: [{ id: 'q-1', number: 1, points: 30, correctOption: 0 }] },
  });
  assert.equal(view.status, 'awaiting_grade');
  assert.equal(view.released, false);
  assert.equal(view.questions.length, 0);
  assert.equal(JSON.stringify(view).includes('Private draft feedback'), false);
  assert.equal(JSON.stringify(view).includes('correctOption'), false);
});

test('released result uses the latest question revision and computes the total with feedback', () => {
  const view = buildStudentResultView({
    released: true,
    release: { at: '2026-08-26T04:00:00.000Z' },
    serverTime: '2026-08-26T04:00:01.000Z',
    exam: {
      questions: [
        { id: 'q-1', number: 1, points: 30 },
        { id: 'q-4', number: 4, points: 25 },
      ],
    },
    grades: [
      { questionId: 'q-1', revision: 1, points: 24, feedback: 'Clear application.' },
      { questionId: 'q-4', revision: 1, points: 20, feedback: 'Review the constitutional text.' },
      { questionId: 'q-4', revision: 2, points: 25, feedback: 'Correct answer and reasoning.' },
    ],
  });
  assert.equal(view.released, true);
  assert.equal(view.totalScore, 49);
  assert.equal(view.totalPossible, 55);
  assert.equal(view.questions[1].pointsAwarded, 25);
  assert.equal(view.questions[1].feedback, 'Correct answer and reasoning.');
});
