import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptStudentExamCode,
  encryptStudentExamCode,
} from './exam-room-student-code-envelope.mjs';

const examId = '123e4567-e89b-42d3-a456-426614174001';
const studentKey = 'student-exam-code-for-class-2026';
const env = {
  EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v1',
  EXAM_ROOM_STUDENT_CODE_KEY_V1: Buffer.alloc(32, 17).toString('base64url'),
  EXAM_ROOM_STUDENT_CODE_KEY_V2: Buffer.alloc(32, 29).toString('base64url'),
};

async function digest(value) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(result).toString('hex');
}

test('student exam codes round-trip through an exam- and digest-bound AES-GCM envelope', async () => {
  const tokenHash = await digest(studentKey);
  const envelope = await encryptStudentExamCode(env, { examId, tokenHash, studentKey });
  assert.equal(envelope.algorithm, 'A256GCM');
  assert.equal(envelope.keyId, 'v1');
  assert.match(envelope.nonce, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(JSON.stringify(envelope).includes(studentKey), false);
  assert.equal(await decryptStudentExamCode(env, {
    examId,
    tokenHash,
    ...envelope,
  }), studentKey);
});

test('student-code envelopes fail closed across an exam, digest, or key boundary', async () => {
  const tokenHash = await digest(studentKey);
  const envelope = await encryptStudentExamCode(env, { examId, tokenHash, studentKey });
  await assert.rejects(decryptStudentExamCode(env, {
    examId: '123e4567-e89b-42d3-a456-426614174099',
    tokenHash,
    ...envelope,
  }), (error) => error.code === 'STUDENT_CODE_DECRYPTION_FAILED');
  await assert.rejects(decryptStudentExamCode(env, {
    examId,
    tokenHash: 'a'.repeat(64),
    ...envelope,
  }), (error) => error.code === 'STUDENT_CODE_DECRYPTION_FAILED');
  await assert.rejects(decryptStudentExamCode({
    ...env,
    EXAM_ROOM_STUDENT_CODE_KEY_V1: Buffer.alloc(32, 3).toString('base64url'),
  }, {
    examId,
    tokenHash,
    ...envelope,
  }), (error) => error.code === 'STUDENT_CODE_DECRYPTION_FAILED');
});

test('key identifiers allow explicit rotation and unavailable keys never degrade to plaintext', async () => {
  const tokenHash = await digest(studentKey);
  const envelope = await encryptStudentExamCode({
    ...env,
    EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v2',
  }, { examId, tokenHash, studentKey });
  assert.equal(envelope.keyId, 'v2');
  assert.equal(await decryptStudentExamCode(env, {
    examId,
    tokenHash,
    ...envelope,
  }), studentKey);
  await assert.rejects(encryptStudentExamCode({
    EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v3',
  }, { examId, tokenHash, studentKey }), (error) => error.code === 'STUDENT_CODE_KEY_UNAVAILABLE');
});
