import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');
const ORIGIN = String(process.env.STAGING_EXAMINATION_ORIGIN || 'http://127.0.0.1:4173');
const RUN_AI = process.env.STAGING_EXAMINATION_RUN_AI === 'true';

assert.match(SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
assert.ok(SERVICE_ROLE_KEY.length > 80, 'A staging service-role key is required.');
assert.match(WORKER_URL, /^https:\/\/[a-z0-9.-]+\.workers\.dev$/);

const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const createdUsers = [];
const createdExams = [];
const requestKey = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const tabToken = () => randomBytes(32).toString('hex');

function headers(token = null) {
  return {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function jsonRequest(url, options, expected = [200]) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.message || body?.error?.message || body?.error?.code || body?.code || 'invalid JSON'}`,
    );
  }
  return { response, body };
}

async function createUser(label) {
  const email = `dd-exam-${label}-${runId}@example.com`;
  const password = `Dd!${randomBytes(24).toString('base64url')}`;
  const { body } = await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    }),
  }, [200, 201]);
  assert.match(body.id, /^[0-9a-f-]{36}$/i);
  createdUsers.push(body.id);

  const session = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(session.body.access_token);
  return { id: body.id, email, token: session.body.access_token };
}

async function deleteUser(userId) {
  await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  }, [200, 204]);
}

async function serviceRpc(name, payload) {
  const { body } = await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, [200, 204]);
  return body;
}

async function workerPost(path, payload, token = null, expected = [200]) {
  const { body, response } = await jsonRequest(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(payload),
  }, expected);
  return { body, response };
}

async function adminCommand(token, operation, payload = {}) {
  const { body } = await workerPost('/admin/examinations', {
    operation,
    ...payload,
    ...(!['dashboard', 'audit'].includes(operation) ? {
      reason: payload.reason || `Synthetic staging verification ${runId}`,
      requestKey: payload.requestKey || requestKey(`admin_${operation}`),
    } : {}),
  }, token);
  assert.equal(body.ok, true);
  return body.data;
}

async function query(token, operation, payload = {}, expected = [200]) {
  const { body, response } = await workerPost(
    '/examinations/query',
    { operation, ...payload },
    token,
    expected,
  );
  return { body, response };
}

async function command(token, operation, payload = {}, expected = [200]) {
  const { body, response } = await workerPost(
    '/examinations/command',
    { operation, ...payload },
    token,
    expected,
  );
  return { body, response };
}

async function publishControlledExam(admin, {
  title,
  subject,
  track = 'per_subject',
  assessmentKind = 'system_test',
  timerMode = 'strict',
  gradingRoute = 'human',
  answerReleaseRule = 'after_human',
  questionCount = 3,
  durationSeconds = 3600,
}) {
  const dashboard = await adminCommand(admin.token, 'dashboard');
  const questions = (dashboard.approvedQuestions || [])
    .filter((question) => question.subject === subject)
    .slice(0, questionCount);
  assert.equal(questions.length, questionCount, `Expected ${questionCount} approved ${subject} rows.`);

  const exam = await adminCommand(admin.token, 'create_exam', {
    track,
    assessmentKind,
    title,
    subject,
    yearLevel: 1,
    testOnly: true,
  });
  createdExams.push(exam.examId);
  const version = await adminCommand(admin.token, 'create_version', {
    examId: exam.examId,
    label: `Staging ${runId}`,
    durationSeconds,
    timerMode,
    gradingRoute,
    answerReleaseRule,
    instructions: 'Synthetic staging test. Answer every item using ALAC.',
    syllabus: ['Controlled staging verification'],
  });
  await adminCommand(admin.token, 'set_questions', {
    versionId: version.versionId,
    questionIds: questions.map((question) => question.questionId),
  });
  const published = await adminCommand(admin.token, 'publish_version', {
    versionId: version.versionId,
  });
  assert.equal(published.status, 'published');
  assert.equal(published.testOnly, true);
  return { ...exam, ...version, questions };
}

function completeAlacAnswer(ordinal) {
  return [
    `I. ANSWER: Yes. The legally supported result applies to controlled item ${ordinal}.`,
    'II. LEGAL BASIS: The governing Labor or Civil Code provision and the cited Supreme Court doctrine in the curated answer control.',
    'III. APPLICATION: The material facts in the problem satisfy the elements of the governing rule because the stated conduct, relationship, and resulting legal consequence correspond to that doctrine.',
    'IV. CONCLUSION: Therefore, the legally supported result should be sustained.',
  ].join('\n\n');
}

async function beginAndCompleteAttempt(student, version, timerMode) {
  const access = await adminCommand(version.adminToken, 'set_beta_access', {
    userId: student.id,
    enabled: true,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(access.enabled, true);

  const catalog = await query(student.token, 'catalog', { track: version.track || 'per_subject' });
  assert.equal(catalog.body.ok, true);
  assert.ok(catalog.body.data.items.some((item) => item.versionId === version.versionId));

  const setup = await query(student.token, 'setup', { versionId: version.versionId });
  assert.equal(setup.body.data.versionId, version.versionId);
  assert.equal(setup.body.data.timerMode, timerMode);

  const activeTab = tabToken();
  const startKey = requestKey('start');
  const started = await command(student.token, 'start_attempt', {
    versionId: version.versionId,
    timerMode,
    requestKey: startKey,
    tabToken: activeTab,
  }, [201]);
  const replayed = await command(student.token, 'start_attempt', {
    versionId: version.versionId,
    timerMode,
    requestKey: startKey,
    tabToken: activeTab,
  }, [201]);
  assert.equal(replayed.body.data.replayed, true);

  const attemptId = started.body.data.attempt.attemptId;
  const secondTab = await command(student.token, 'heartbeat', {
    attemptId,
    tabToken: tabToken(),
    takeover: false,
  }, [409]);
  assert.equal(secondTab.body.error.code, 'EXAM_SECOND_TAB_BLOCKED');

  for (const [index, question] of started.body.data.questions.entries()) {
    const saved = await command(student.token, 'save_response', {
      attemptId,
      questionId: question.questionId,
      tabToken: activeTab,
      answerText: completeAlacAnswer(index + 1),
      expectedRevision: 0,
      flagged: index === 0,
    });
    assert.equal(saved.body.data.revision, 1);
    if (index === 0) {
      const conflict = await command(student.token, 'save_response', {
        attemptId,
        questionId: question.questionId,
        tabToken: activeTab,
        answerText: 'This stale write must be rejected.',
        expectedRevision: 0,
        flagged: false,
      }, [409]);
      assert.equal(conflict.body.error.code, 'EXAM_RESPONSE_CONFLICT');
    }
  }

  const heartbeat = await command(student.token, 'heartbeat', {
    attemptId,
    tabToken: activeTab,
    takeover: false,
  });
  assert.equal(heartbeat.body.data.attemptId, attemptId);
  const unconfirmed = await command(student.token, 'submit_attempt', {
    attemptId,
    tabToken: activeTab,
    requestKey: requestKey('unconfirmed'),
    confirmed: false,
  }, [400]);
  assert.equal(unconfirmed.body.error.code, 'REVIEW_CONFIRMATION_REQUIRED');

  const submitKey = requestKey('submit');
  const submitted = await command(student.token, 'submit_attempt', {
    attemptId,
    tabToken: activeTab,
    requestKey: submitKey,
    confirmed: true,
  });
  assert.equal(submitted.body.data.status, 'submitted');
  const submitReplay = await command(student.token, 'submit_attempt', {
    attemptId,
    tabToken: activeTab,
    requestKey: submitKey,
    confirmed: true,
  });
  assert.equal(submitReplay.body.data.replayed, true);
  return { attemptId, started: started.body.data };
}

async function completeHumanReview(student, attempt) {
  const assignmentToken = tabToken();
  const assigned = await command(student.token, 'create_examiner_assignment', {
    attemptId: attempt.attemptId,
    examinerEmail: `synthetic-examiner-${runId}@example.com`,
    assignmentToken,
    requestKey: requestKey('assignment'),
  }, [201]);
  assert.equal(assigned.body.data.invitationStatus, 'suppressed');

  const assignment = await query(null, 'assignment', { assignmentToken });
  assert.equal(assignment.body.ok, true);
  await command(null, 'claim_examiner_assignment', { assignmentToken });
  for (const [index, question] of assignment.body.data.questions.entries()) {
    const score = index % 2 === 0 ? 4.2 : 3.8;
    const review = await command(null, 'save_examiner_review', {
      assignmentToken,
      questionId: question.questionId,
      score,
      comments: `Synthetic examiner comment ${index + 1}.`,
      expectedRevision: 0,
    });
    assert.equal(review.body.data.score, score);
  }
  const finalized = await command(null, 'finalize_examiner_review', {
    assignmentToken,
    confirmed: true,
    expectedRevision: assignment.body.data.questions.length,
  });
  assert.equal(finalized.body.data.status, 'finalized');
  const verdict = await query(student.token, 'verdict', { attemptId: attempt.attemptId });
  assert.equal(verdict.body.data.released, true);
  return verdict.body.data;
}

async function cycleStrictHuman(admin, student) {
  const exam = await publishControlledExam(admin, {
    title: `[SYNTHETIC ${runId}] Criminal Law I Strict Human`,
    subject: 'Criminal Law I',
    timerMode: 'strict',
    gradingRoute: 'human',
    answerReleaseRule: 'after_human',
  });
  const attempt = await beginAndCompleteAttempt(student, {
    ...exam,
    track: 'per_subject',
    adminToken: admin.token,
  }, 'strict');
  const verdict = await completeHumanReview(student, attempt);
  assert.equal(verdict.results.length, 3);
  assert.deepEqual(verdict.results.map((item) => item.humanScore), [4.2, 3.8, 4.2]);
  return { name: 'strict-human', attemptId: attempt.attemptId, examId: exam.examId };
}

async function cycleSelfPaced(admin, student) {
  const gradingRoute = RUN_AI ? 'ai' : 'human';
  const releaseRule = RUN_AI ? 'after_ai' : 'after_human';
  const exam = await publishControlledExam(admin, {
    title: `[SYNTHETIC ${runId}] Persons and Family Law Self-Paced`,
    subject: 'Persons and Family Law',
    timerMode: 'selfPaced',
    gradingRoute,
    answerReleaseRule: releaseRule,
  });
  const attempt = await beginAndCompleteAttempt(student, {
    ...exam,
    track: 'per_subject',
    adminToken: admin.token,
  }, 'selfPaced');

  if (RUN_AI) {
    let result;
    for (let index = 0; index < exam.questions.length + 2; index += 1) {
      result = await command(student.token, 'request_ai_grading', {
        attemptId: attempt.attemptId,
        requestKey: requestKey(`ai_${index}`),
      });
      if (result.body.data.status === 'completed') break;
    }
    assert.equal(result.body.data.status, 'completed');
    const verdict = await query(student.token, 'verdict', { attemptId: attempt.attemptId });
    assert.equal(verdict.body.data.results.length, 3);
    for (const resultItem of verdict.body.data.results) {
      assert.ok(Number.isFinite(resultItem.aiScore));
      assert.ok(resultItem.aiScore >= 0 && resultItem.aiScore <= 5);
      assert.ok(
        Math.abs(resultItem.aiScore * 10 - Math.round(resultItem.aiScore * 10)) < 1e-9,
      );
    }
  } else {
    await completeHumanReview(student, attempt);
  }
  return {
    name: RUN_AI ? 'self-paced-ai' : 'self-paced-human',
    attemptId: attempt.attemptId,
    examId: exam.examId,
  };
}

async function cycleCuratedBarFeels(admin, student) {
  const exam = await publishControlledExam(admin, {
    title: `[SYNTHETIC ${runId}] Curated Bar Feels`,
    subject: 'Criminal Law I',
    track: 'bar_feels',
    assessmentKind: 'curated',
    timerMode: 'none',
    gradingRoute: 'human',
    answerReleaseRule: 'after_human',
  });
  const attempt = await beginAndCompleteAttempt(student, {
    ...exam,
    track: 'bar_feels',
    adminToken: admin.token,
  }, 'none');
  await completeHumanReview(student, attempt);
  return {
    name: 'curated-bar-feels-human',
    attemptId: attempt.attemptId,
    examId: exam.examId,
  };
}

async function cycleStrictExpiration(admin, student) {
  const exam = await publishControlledExam(admin, {
    title: `[SYNTHETIC ${runId}] One-Minute Expiration`,
    subject: 'Criminal Law I',
    track: 'bar_feels',
    assessmentKind: 'system_test',
    timerMode: 'strict',
    gradingRoute: 'human',
    answerReleaseRule: 'after_human',
    questionCount: 1,
    durationSeconds: 60,
  });
  await adminCommand(admin.token, 'set_beta_access', {
    userId: student.id,
    enabled: true,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const activeTab = tabToken();
  const started = await command(student.token, 'start_attempt', {
    versionId: exam.versionId,
    timerMode: 'strict',
    requestKey: requestKey('expiration_start'),
    tabToken: activeTab,
  }, [201]);
  const question = started.body.data.questions[0];
  await command(student.token, 'save_response', {
    attemptId: started.body.data.attempt.attemptId,
    questionId: question.questionId,
    tabToken: activeTab,
    answerText: completeAlacAnswer(1),
    expectedRevision: 0,
    flagged: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 61_500));
  const expired = await command(student.token, 'heartbeat', {
    attemptId: started.body.data.attempt.attemptId,
    tabToken: activeTab,
    takeover: false,
  });
  assert.equal(expired.body.data.expired, true);
  assert.equal(expired.body.data.status, 'expired');
  return {
    name: 'strict-server-expiration',
    attemptId: started.body.data.attempt.attemptId,
    examId: exam.examId,
  };
}

async function cyclePrivateUpload(admin, student) {
  await adminCommand(admin.token, 'set_beta_access', {
    userId: student.id,
    enabled: true,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const source = [
    '1. A private uploaded legal problem asks whether the stated obligation is enforceable. Explain.',
    '',
    '2. A second private uploaded legal problem asks which remedy applies. Explain.',
    '',
    '3. A third private uploaded legal problem asks whether procedural relief should issue. Explain.',
  ].join('\n');
  const uploaded = await workerPost('/examinations/upload', {
    fileName: `synthetic-${runId}.txt`,
    mimeType: 'text/plain',
    base64: Buffer.from(source, 'utf8').toString('base64'),
    title: `[SYNTHETIC ${runId}] Private Bar Feels`,
    timerMode: 'none',
    durationSeconds: 3600,
    gradingRoute: 'human',
    requestKey: requestKey('upload'),
  }, student.token, [201]);
  assert.equal(uploaded.body.data.questionCount, 3);
  assert.equal('publicUrl' in uploaded.body.data, false);

  const confirmed = await command(student.token, 'confirm_upload', {
    uploadId: uploaded.body.data.uploadId,
    title: `[SYNTHETIC ${runId}] Private Bar Feels`,
    timerMode: 'none',
    durationSeconds: 3600,
    gradingRoute: 'human',
    requestKey: requestKey('confirm_upload'),
  });
  assert.equal(confirmed.body.data.status, 'confirmed');
  assert.equal(confirmed.body.data.questionCount, 3);
  createdExams.push(confirmed.body.data.examId);

  const catalog = await query(student.token, 'catalog', { track: 'bar_feels' });
  const item = catalog.body.data.items.find(
    (candidate) => candidate.versionId === confirmed.body.data.versionId,
  );
  assert.ok(item);
  const attempt = await beginAndCompleteAttempt(student, {
    ...confirmed.body.data,
    track: 'bar_feels',
    adminToken: admin.token,
  }, 'none');
  await completeHumanReview(student, attempt);
  const deleted = await command(student.token, 'delete_upload', {
    uploadId: uploaded.body.data.uploadId,
    reason: `Synthetic staging cleanup ${runId}`,
  });
  assert.equal(deleted.body.data.deleted, true);
  return {
    name: 'private-upload-human',
    attemptId: attempt.attemptId,
    examId: confirmed.body.data.examId,
  };
}

let outcome;
try {
  const admin = await createUser('admin');
  const firstStudent = await createUser('student-a');
  const secondStudent = await createUser('student-b');
  await serviceRpc('bootstrap_first_super_admin', {
    p_target_user_id: admin.id,
    p_reason: `Synthetic staging bootstrap ${runId}`,
  });
  const directDashboard = await serviceRpc('examination_admin', {
    p_actor_user_id: admin.id,
    p_operation: 'dashboard',
    p_payload: { operation: 'dashboard', limit: 50, offset: 0 },
  });
  assert.ok(Array.isArray(directDashboard.definitions));

  const denied = await query(secondStudent.token, 'catalog', { track: 'per_subject' }, [403]);
  assert.equal(denied.body.error.code, 'EXAM_BETA_ACCESS_REQUIRED');

  const cycles = [];
  cycles.push(await cycleStrictHuman(admin, firstStudent));
  cycles.push(await cycleSelfPaced(admin, secondStudent));
  cycles.push(await cycleCuratedBarFeels(admin, secondStudent));
  cycles.push(await cyclePrivateUpload(admin, firstStudent));
  cycles.push(await cycleStrictExpiration(admin, secondStudent));
  const crossUser = await query(secondStudent.token, 'resume', {
    attemptId: cycles[0].attemptId,
  }, [404]);
  assert.equal(crossUser.body.error.code, 'EXAM_ATTEMPT_NOT_FOUND');
  const dashboard = await adminCommand(admin.token, 'dashboard');
  assert.ok(dashboard.recentAttempts.length >= 5);
  assert.equal(dashboard.definitions.filter((item) => item.testOnly).length >= 5, true);
  outcome = {
    ok: true,
    runId,
    aiCycle: RUN_AI,
    cycles,
    createdExamIds: [...new Set(createdExams)],
    createdUserCount: createdUsers.length,
  };
} finally {
  for (const userId of createdUsers.reverse()) {
    await deleteUser(userId).catch(() => {});
  }
}

console.log(JSON.stringify(outcome, null, 2));
