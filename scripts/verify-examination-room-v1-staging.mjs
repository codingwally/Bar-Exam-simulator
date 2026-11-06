import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

const BASE = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';

export async function verifyExaminationRoomV1Staging({ adminToken, runId }) {
  assert.ok(typeof adminToken === 'string' && adminToken.length > 30);
  assert.match(runId, /^[a-z0-9-]{8,40}$/i);
  const marker = `[SYNTHETIC ${runId}] V1 submission verification`;
  let examId = null;
  let publishedReady = false;
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
      const field = /^Reload the page because (the (?:examination|institution|student session) identifier) is invalid\.$/u.exec(
        String(payload?.error?.message || ''),
      )?.[1] || '';
      throw new Error(`${endpoint} HTTP ${response.status} ${String(payload?.error?.code || 'UNEXPECTED').slice(0, 80)} ${field}`);
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
      durationMinutes: 1440, startsAt: null,
      gradingIdentity: 'real_names', integrityTier: 'standard',
      cameraRequired: true, microphoneRequired: false,
      privacyNoticeVersion: 'exam-room-v1',
      admissionMode: 'key_only', allowedEmails: [], roster: [],
      questions: [{ id: 'q-1', type: 'essay', points: 20, wordLimit: 800,
        prompt: 'Explain separation of powers in Philippine law.' }],
    };
    const saved = await professorCommand('save_draft', { exam });
    examId = String(saved.examId || '');
    assert.equal(examId, exam.id, 'Professor draft was stored under an unexpected exam id');
    assert.match(String(saved.versionId || ''), /^[a-f0-9-]{36}$/i);
    results.push('professor_save');

    const published = await professorCommand('publish', { exam: { ...exam, id: examId, versionId: saved.versionId } });
    assert.equal(published.examId, examId);
    assert.equal(published.status, 'published');
    publishedReady = true;
    results.push('professor_publish');

    const approved = await adminCommand('activate_exam', {
      examId, institutionId: 'ddc00000-0000-4000-8000-000000000001',
    });
    const roomKey = String(approved.roomKey || approved.activation?.roomKey || '');
    assert.ok(roomKey.length > 12);
    results.push('student_key_approved');

    await professorCommand('open_room', { examId });
    // Only the key and real name are required for a key-only room.
    // The fixed Worker supplies scoped guest identity and canonical course data.
    const identity = {
      fullName: 'Synthetic Staging Candidate',
      guestIdentityId: 'student-device-' + runId,
    };
    const preview = await call('/examination-room/v1/student/preview', {
      roomKey, identity,
    });
    assert.equal(preview.metadata?.questionCount, 1);
    assert.equal(preview.metadata?.durationMinutes, 1440, 'No Time Limit must survive publication');
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
    // Verify that No Time Limit is not treated as a 24-hour student timer.
    // Untimed sessions remain valid until the separate room closes.
    const openMonitor = await professorQuery('monitor', { examId });
    const roomClosesAt = Date.parse(openMonitor.activation?.closesAt || openMonitor.activation?.expiresAt || '');
    const leaseExpiresAt = Date.parse(started.session?.leaseExpiresAt || '');
    assert.ok(Number.isFinite(roomClosesAt) && Number.isFinite(leaseExpiresAt));
    assert.equal(leaseExpiresAt, roomClosesAt, 'No Time Limit session lease must equal room closure');
    results.push('student_begin');
    results.push('no_time_limit_room_bound');

    const savedAnswer = await studentCommand('save_answer', {
      sessionId, sessionToken, questionId: 'q-1',
      answer: `Earlier autosaved revision ${runId}`, flagged: false,
    }, 'answer-' + randomUUID());
    assert.ok(savedAnswer.revision);
    results.push('student_autosave');

    const finalAnswer = `Final confirmed answer ${runId}: The Constitution separates executive, legislative and judicial power.`;
    const submissionKey = 'submission-' + randomUUID();
    const finalPayload = {
      sessionId, sessionToken, clientCompletedAt: new Date().toISOString(),
      answers: [{ questionId: 'q-1', answer: finalAnswer, flagged: false }],
    };
    let submission = null;
    for (let retry = 0; retry < 12; retry += 1) {
      const response = await fetch(BASE + '/examination-room/v1/student/command', {
        method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { Origin: BASE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'submit', payload: finalPayload, idempotencyKey: submissionKey }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 201 && body?.ok) {
        submission = body;
        break;
      }
      if (response.status !== 503 || body?.error?.code !== 'EXAM_ROOM_V1_SUBMISSION_PENDING') {
        throw new Error('student submit HTTP ' + response.status
          + ' code ' + String(body?.error?.code || 'UNKNOWN').slice(0, 80));
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    assert.ok(submission?.submission?.receiptId || submission?.receipt?.id,
      'Final submission never produced an official receipt');
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
      const cleanupOperation = publishedReady ? 'archive_exam' : 'delete_draft';
      const cleaned = await professorCommand(cleanupOperation, { examId });
      assert.equal(cleaned.ok, true);
      console.log('EXAMINATION_ROOM_V1_STAGING: synthetic_exam_cleaned=true');
    }
  }
}
