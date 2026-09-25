import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExaminationRoomSubmissionPdf,
  examinationRoomSubmissionPdfFilename,
  examinationRoomSubmissionPdfObjectKey,
} from './examination-room-submission-artifacts.mjs';

const context = {
  institutionId: '11111111-1111-4111-8111-111111111111',
  examId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  submissionId: '44444444-4444-4444-8444-444444444444',
  receiptCode: '55555555-5555-4555-8555-555555555555',
  submittedAt: '2026-09-26T02:00:00.000Z',
  studentName: 'Arya Stark',
  studentNumber: '2026-001',
  studentEmail: 'arya@example.edu.ph',
  subject: 'Constitutional Law I',
  submissionManifest: {
    title: 'Constitutional Law I — Practice Examination',
    subject: 'Constitutional Law I',
    questions: [
      {
        questionNumber: 1,
        type: 'essay',
        prompt: 'May the proposed constitutional change be made through people’s initiative? Explain.',
        maxPoints: 10,
        choices: [],
        answer: 'No. The proposal is a revision rather than a mere amendment.',
      },
      {
        questionNumber: 2,
        type: 'essay',
        prompt: 'When did the 1987 Constitution take effect?',
        maxPoints: 10,
        choices: [],
        answer: null,
      },
    ],
  },
};

test('server submission PDF contains a valid PDF envelope', async () => {
  const bytes = await buildExaminationRoomSubmissionPdf(context);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 1_000);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');
});

test('server submission PDF uses deterministic private object naming', () => {
  assert.equal(
    examinationRoomSubmissionPdfObjectKey(context),
    'v1/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444/questions-and-answers.pdf',
  );
  assert.equal(examinationRoomSubmissionPdfFilename(context), 'arya-stark-questions-and-answers.pdf');
});
