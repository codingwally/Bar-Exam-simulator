import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

const BASE = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';

export async function verifyExaminationRoomV1Staging({ adminToken, runId }) {
  assert.ok(typeof adminToken === 'string' && adminToken.length > 30);
  assert.match(runId, /^[a-z0-9-]{8,40}$/i);
  const marker = `[SYNTHETIC ${runId}] V1 submission verification`;
  let examId = null;
  const results = [];
  async function call(endpoint, body, token = null, statusCodes = [200]) {
    const response = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: {
        Origin: BASE,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const payload = await response.json().catch(() => null);
    if (!statusCodes.includes(response.status)) {
      throw new Error(`${endpoint} HTTP ${response.status} ${String(payload?.error?.code || 'UNEXPECTED').slice(0, 80)}`);
    }
    assert.equal(payload?.ok, true, `${endpoint} returned an unsuccessful result`);
    return payload;
  }
  const professorQuery = (operation, payload = {}) =>
    call('/examination-room/v1/professor/query', { operation, payload }, adminToken);
  const professorCommand = (operation, payload = {}) =>
    call('/examination-room/v1/professor/command', {
      operation, payload, idempotencyKey: `midterm-${randomUUID()}`,
    }, adminToken, operation === 'publish' ? [201] : [200]);
  const adminCommand = (operation, payload = {}) =>
    call('/examination-room/v1/admin/command', {
      operation, payload, idempotencyKey: `midterm-${randomUUID()}`,
    }, adminToken, [200, 201]);
  const studentCommand = (operation, payload, idempotencyKey) =>
    call('/examination-room/v1/student/command', {
      operation, payload, idempotencyKey,
    }, null, operation === 'submit' ? [201] : [200]);

  try {
    const initial = await professorQuery('session');
    assert.equal(initial.ok, true);
    const exam = {
      id: randomUUID(), versionId: randomUUID(), status: 'draft',
      title: marker, subject: 'Constitutional Law', yearLevel: 'Second year',
      instructions: 'Synthetic staging test only. Do not administer to real students.',
      durationMinutes: 120, startsAt: null,
      gradingIdentity: 'real_names', integrityTier: 'standard',
      cameraRequired: false, microphoneRequired: false,
      privacyNoticeVersion: 'exam-room-v1',
      admissionMode: 'key_only', allowedEmails: [], roster: [],
      questions: [{ id: 'q-1', type: 'essay', points: 20, wordLimit: 800,
        prompt: 'Explain separation of powers in Philippine law.' }],
    };
    const saved = await professorCommand('save_draft', { exam });
    examId = String(saved.exam?.id || saved.exam?.examId || exam.id);
    assert.ok(saved.exam);
    results.push('professor_save');

    const published = await professorCommand('publish', { exam: saved.exam });
    assert.ok(published.exam);
    results.push('professor_publish');

    const approved = await adminCommand('activate_exam', { examId });
    const roomKey = String(approved.roomKey || approved.activation?.roomKey || '');
    assert.ok(roomKey.length > 12);
    results.push('student_key_approved');

    await professorCommand('open_room', { examId });
    const identity = {
      fullName: 'Synthetic Staging Candidate', realName: 'Synthetic Staging Candidate',
      email: `candidate-${runId}@example.com`,
      studentNumber: `STAGE-${runId}`,
      subject: exam.subject, yearLevel: exam.yearLevel,
    };
    const preview = await call('/examination-room/v1/student/preview', {
      roomKey, identity,
    });
    assert.equal(preview.metadata?.questionCount, 1);
    results.push('student_preview');

    const started = await call('/examination-room/v1/student/begin', {
      roomKey, identity,
      attemptBindingId: 'attempt-binding:' + randomBytes(32).toString('hex'),
      idempotencyKey: 'midterm-' + randomUUID(),
      client: { appVersion: 'midterm-staging', timezone: 'Asia/Manila' },
    }, null, [201]);
    const sessionId = String(started.session?.id || '');
    const sessionToken = String(started.sessionToken || '');
    assert.match(sessionId, /^[a-f0-9-]{36}$/i);
    assert.match(sessionToken, /^ers1_[a-f0-9]{64}$/);
    results.push('student_begin');

    const savedAnswer = await studentCommand('save_answer', {
      sessionId, sessionToken, questionId: 'q-1',
      answer: `Earlier autosaved revision ${runId}`, flagged: false,
    }, 'answer-' + randomUUID());
    assert.ok(savedAnswer.revision);
    results.push('student_autosave');

    const finalAnswer = `Final confirmed answer ${runId}: The Constitution separates executive, legislative and judicial power.`;
    const submissionKey = 'submission-' + randomUUID();
    const submission = await studentCommand('submit', {
      sessionId, sessionToken, clientCompletedAt: new Date().toISOString(),
      answers: [{ questionId: 'q-1', answer: finalAnswer, flagged: false }],
    }, submissionKey);
    assert.ok(submission.submission || submission.receipt);
    results.push('official_submission');

    const monitor = await professorQuery('monitor', { examId });
    const sessions = Array.isArray(monitor.sessions) ? monitor.sessions : [];
    const submissions = Array.isArray(monitor.submissions) ? monitor.submissions : [];
    assert.ok(sessions.some(entry => entry.id === sessionId || entry.sessionId === sessionId));
    assert.ok(submissions.some(entry => entry.sessionId === sessionId));
    results.push('professor_monitor');
    console.log('EXAMINATION_ROOM_V1_STAGING: PASS ' + results.join(','));
  } finally {
    if (examId) {
      const archived = await professorCommand('archive_exam', { examId });
      assert.equal(archived.ok, true);
      console.log('EXAMINATION_ROOM_V1_STAGING: synthetic_exam_archived=true');
    }
  }
}
