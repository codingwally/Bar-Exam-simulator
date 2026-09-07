import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const rootPath = path.resolve(process.argv[2] || '.');
const source = fs.readFileSync(path.join(rootPath, 'assets/examinations.js'), 'utf8');
assert.ok(source.includes('simulation-timer-review-20260906-r2'));
function extract(name) {
  const pattern = new RegExp(`^  (?:async )?function ${name}\\(`, 'm');
  const start = source.search(pattern);
  assert.ok(start >= 0, `Missing ${name}`);
  const tail = source.slice(start + 1);
  const end = tail.search(/\n  (?:async )?function /);
  assert.ok(end >= 0, `Missing end of ${name}`);
  return source.slice(start, start + 1 + end);
}
function fixture() {
  const question = { questionId: 'q1', answerText: 'Retained answer', flagged: false, revision: 7 };
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const messages = [];
  const state = {
    active: { examination: { track: 'bar_feels' }, attempt: { attemptId: 'a1', timerMode: 'strict' }, questions: [question] },
    screen: 'room', currentIndex: 0, clientRemaining: 0, clientElapsed: 14400,
    saveInFlight: false, pendingSave: false, expiryInFlight: false,
  };
  const context = vm.createContext({
    state, root, messages, console, setTimeout, clearTimeout, Date, Number, Promise,
    currentQuestion: () => state.active.questions[state.currentIndex],
    pageRoot: () => root,
    saveRecovery: () => { context.recoveryCalls = (context.recoveryCalls || 0) + 1; },
    counts: () => ({ answered: 1, flagged: 0, remaining: 0 }),
    wordCount: (s) => String(s || '').split(/\s+/).length,
    escapeHtml: (s) => String(s || ''),
    focusRendered: () => {},
    setStatus: (message) => messages.push(message),
    notify: (message) => messages.push(message),
    formatDate: (value) => String(value),
    scheduleSave: () => {},
    updateClockNode: () => {},
    tabToken: () => 'test-tab-token-not-a-real-user-session',
    requestKey: () => 'test_submission_request_key',
    flushCurrentSave: async () => true,
    api: async (_url, body) => ({ questionId: body.questionId, answerText: body.answerText,
      revision: body.expectedRevision + 1, flagged: body.flagged, savedAt: 'test', remainingSeconds: 0 }),
    showReceipt: (receipt) => { context.receipt = receipt; },
  });
  return context;
}
let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
await test('expired-clock review opens even when the save request never resolves', async () => {
  const c = fixture(); c.flushCurrentSave = () => new Promise(() => {});
  c.root.querySelector = (s) => s === '#dd-answer-editor' ? { value: 'Latest unsaved text' } : null;
  vm.runInContext(extract('showReview'), c);
  await Promise.race([c.showReview(), new Promise((_, reject) => setTimeout(() => reject(new Error('Review blocked')), 100))]);
  assert.equal(c.state.screen, 'review'); assert.match(c.root.innerHTML, /data-submit-exam/);
  assert.equal(c.state.active.questions[0].answerText, 'Latest unsaved text');
});
await test('failed or rejected save stays on review with visible retained-draft feedback', async () => {
  for (const reject of [false, true]) {
    const c = fixture(); c.flushCurrentSave = async () => { if (reject) throw new Error('Offline'); return false; };
    vm.runInContext(extract('showReview'), c); await c.showReview(); await new Promise(r => setTimeout(r, 0));
    assert.equal(c.state.screen, 'review'); assert.ok(c.messages.length > 0);
    assert.equal(c.state.active.questions[0].answerText, 'Retained answer');
  }
});
await test('zero countdown is advisory across repeated clock ticks', async () => {
  const c = fixture(); c.flushCurrentSave = () => { throw new Error('Timer must not submit/save'); };
  c.heartbeat = () => { throw new Error('Timer must not force expiry'); };
  vm.runInContext(extract('tickClock'), c); for (let i=0;i<5;i++) c.tickClock();
  assert.equal(c.state.clientRemaining, 0); assert.equal(c.state.screen, 'room');
  assert.equal(c.recoveryCalls, 1); assert.match(c.messages[0], /continue answering/);
});
await test('valid post-deadline save keeps content and advances revision', async () => {
  const c = fixture(); vm.runInContext(extract('saveCurrent'), c);
  assert.equal(await c.saveCurrent(), true); assert.equal(c.state.active.questions[0].revision, 8);
  assert.equal(c.state.active.questions[0].answerText, 'Retained answer');
});
await test('legacy expiry receipt cannot erase an answer or its revision', async () => {
  const c = fixture(); c.api = async () => ({ status: 'expired', automatic: true });
  vm.runInContext(extract('saveCurrent'), c);
  assert.equal(await c.saveCurrent({ silent: true }), false);
  assert.equal(c.state.active.questions[0].answerText, 'Retained answer');
  assert.equal(c.state.active.questions[0].revision, 7); assert.ok(c.messages.length > 0);
});
await test('saving a different retained answer does not overwrite it with the visible editor', async () => {
  const c = fixture(); const other = { questionId:'q2',answerText:'Other answer',revision:3,flagged:false };
  c.state.active.questions.push(other); c.root.querySelector = (s) => s === '#dd-answer-editor' ? {value:'Visible answer'} : null;
  vm.runInContext(extract('saveCurrent'), c);
  assert.equal(await c.saveCurrent({question:other}),true); assert.equal(other.answerText,'Other answer');
});
await test('all retained answers synchronize before final submission', async () => {
  const c = fixture(); c.state.active.questions = Array.from({length:20},(_,i)=>({questionId:`q${i}`}));
  const saved=[]; c.saveCurrent=async ({question})=>{saved.push(question.questionId);return true;};
  vm.runInContext(extract('flushSimulationAnswers'),c);
  assert.equal(await c.flushSimulationAnswers(),true); assert.equal(saved.length,20);
});
await test('failed synchronization cannot silently submit incomplete answers', async () => {
  const c = fixture(); c.flushSimulationAnswers=async()=>false; c.api=async()=>{throw new Error('Must not submit');};
  vm.runInContext(extract('submitExamination'),c);
  const button={disabled:false,textContent:'Submit Examination',isConnected:true};
  await c.submitExamination(button); assert.equal(c.receipt,undefined); assert.equal(button.disabled,false);
  assert.ok(c.messages.some(m=>m.includes('nothing was submitted')));
});
await test('manual submission succeeds with zero time remaining', async () => {
  const c = fixture(); c.flushSimulationAnswers=async()=>true;
  c.api=async(_url,body)=>{assert.equal(body.operation,'submit_attempt');return {status:'submitted',receiptCode:'TEST-ONLY'};};
  vm.runInContext(extract('submitExamination'),c);
  await c.submitExamination({disabled:false,textContent:'Submit Examination',isConnected:true});
  assert.equal(c.receipt.status,'submitted');
});
for (const filename of ['index.html','assets/feature-loader.js','service-worker.js']) {
  assert.ok(fs.readFileSync(path.join(rootPath,filename),'utf8').includes('simulation-timer-review-20260906-r2'));
}

// Run the actual staging cycle with a deterministic local transport/clock. This
// proves the fixture's assertions and sequencing, NOT live database behavior.
// Read from this checkout even when the UI test targets a built/live artifact.
const stagingSource = fs.readFileSync(new URL('./test-examinations-staging.mjs', import.meta.url), 'utf8');
function extractStaging(name) {
  const start = stagingSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing staging function ${name}`);
  const tail = stagingSource.slice(start + 1);
  const end = tail.search(/\n(?:async )?function /);
  assert.ok(end >= 0, `Missing staging function end for ${name}`);
  return stagingSource.slice(start, start + 1 + end);
}
function advisoryStagingFixture(fault = null) {
  let now = Date.parse('2026-09-07T00:00:00Z');
  const startedAt = now;
  const deadlineAt = new Date(now + 60_000).toISOString();
  const trace = [];
  const waits = [];
  const question = { questionId: 'synthetic-q1', ordinal: 1, answerText: '', revision: 0, flagged: false };
  const student = { id: 'synthetic-student', token: 'local-test-only' };
  let heartbeatCount = 0;
  let resumeCount = 0;
  let status = 'in_progress';
  let submittedAt = null;
  let humanScore = null;
  let assignmentToken = null;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const summary = () => ({
    attemptId: 'synthetic-attempt', status, timerMode: 'strict', deadlineAt,
    submittedAt, remainingSeconds: Math.max(0, Math.floor((Date.parse(deadlineAt) - now) / 1000)),
    counts: { answered: Number(Boolean(question.answerText)), flagged: Number(question.flagged), total: 1 },
  });
  const snapshot = () => ({ attempt: summary(), examination: { track: 'bar_feels' }, questions: [copy(question)] });
  const response = (data) => ({ body: { ok: true, data: copy(data) } });
  const context = vm.createContext({
    assert, URL, console, Number, Promise, runId: 'local-only', ORIGIN: 'https://staging.test',
    Date: class extends Date { static now() { return now; } },
    tabToken: () => 'local-test-tab',
    requestKey: (prefix) => prefix + '-local-request',
    setTimeout: (callback, milliseconds) => {
      assert.ok(milliseconds > 0 && milliseconds <= 60_000);
      waits.push(milliseconds); now += milliseconds; callback(); return waits.length;
    },
    publishControlledExam: async (_admin, config) => {
      assert.equal(config.track, 'bar_feels');
      assert.equal(config.timerMode, 'strict');
      assert.equal(config.durationSeconds, 60);
      assert.equal(config.questionCount, 1);
      assert.equal(config.gradingRoute, 'human');
      assert.equal(config.answerReleaseRule, 'after_human');
      return { examId: 'synthetic-exam', versionId: 'synthetic-version' };
    },
    adminCommand: async (_token, operation, payload) => {
      assert.equal(operation, 'set_beta_access');
      assert.equal(payload.userId, student.id);
      assert.equal(payload.enabled, true);
      return { enabled: true };
    },
    command: async (_token, operation, payload, expected = [200]) => {
      trace.push({ operation, elapsed: now - startedAt });
      if (operation === 'start_attempt') {
        assert.equal(expected[0], 201);
        assert.equal(payload.timerMode, 'strict');
        return response(snapshot());
      }
      if (['heartbeat', 'save_response', 'flag_response', 'submit_attempt'].includes(operation)) {
        assert.equal(payload.attemptId, 'synthetic-attempt');
        assert.equal(payload.tabToken, 'local-test-tab');
      }
      if (operation === 'heartbeat') {
        heartbeatCount += 1;
        const value = summary();
        if (fault === 'zero_before_deadline' && heartbeatCount === 1) value.remainingSeconds = 0;
        if (fault === 'automatic_expiry' && heartbeatCount === 2) Object.assign(value, { expired: true, status: 'expired' });
        if (fault === 'extended_deadline' && heartbeatCount === 2) value.deadlineAt = new Date(now + 60_000).toISOString();
        return response(value);
      }
      if (operation === 'save_response' || operation === 'flag_response') {
        assert.equal(status, 'in_progress');
        assert.equal(payload.questionId, question.questionId);
        assert.equal(payload.expectedRevision, question.revision);
        if (operation === 'save_response') question.answerText = payload.answerText;
        question.flagged = payload.flagged;
        question.revision += 1;
        const value = { ...question, remainingSeconds: summary().remainingSeconds };
        if (fault === 'lost_post_deadline_edit' && question.revision === 2) value.answerText = '';
        if (fault === 'stale_post_deadline_revision' && question.revision === 2) value.revision = 1;
        if (fault === 'flag_erases_answer' && operation === 'flag_response') value.answerText = '';
        return response(value);
      }
      if (operation === 'submit_attempt') {
        assert.ok(now - startedAt >= 61_500, 'Submission must follow the real-duration wait.');
        if (!payload.confirmed) {
          assert.equal(expected[0], 400);
          return { body: { ok: false, error: { code: fault === 'missing_confirmation_guard' ? 'WRONG_CODE' : 'REVIEW_CONFIRMATION_REQUIRED' } } };
        }
        assert.equal(resumeCount, 3);
        assert.equal(question.revision, 3);
        status = 'submitted'; submittedAt = new Date(now).toISOString();
        return response({ attemptId: 'synthetic-attempt', status, automatic: fault === 'automatic_submit', answeredCount: 1, questionCount: 1 });
      }
      if (operation === 'create_examiner_assignment') {
        assert.equal(status, 'submitted');
        assert.equal(expected[0], 201);
        assignmentToken = payload.assignmentToken;
        return response({ invitationStatus: 'suppressed', assignmentUrl: `https://staging.test/?assignment=${assignmentToken}#examiner-review` });
      }
      assert.equal(payload.assignmentToken, assignmentToken);
      if (operation === 'claim_examiner_assignment') return response({ status: 'claimed' });
      if (operation === 'save_examiner_review') {
        assert.equal(payload.questionId, question.questionId);
        assert.equal(payload.expectedRevision, 0);
        humanScore = payload.score;
        return response({ score: humanScore });
      }
      if (operation === 'finalize_examiner_review') {
        assert.equal(payload.expectedRevision, 1);
        assert.equal(payload.confirmed, true);
        return response({ status: 'finalized' });
      }
      throw new Error('Unexpected staging fixture command: ' + operation);
    },
    query: async (_token, operation, payload) => {
      trace.push({ operation, elapsed: now - startedAt });
      if (operation === 'resume') {
        assert.equal(payload.attemptId, 'synthetic-attempt');
        resumeCount += 1;
        const value = snapshot();
        if (fault === 'lost_original_answer' && resumeCount === 1) value.questions[0].answerText = '';
        if (fault === 'new_attempt_on_reload' && resumeCount === 3) value.attempt.attemptId = 'wrong-attempt';
        if (fault === 'lost_flag_on_reload' && resumeCount === 3) value.questions[0].flagged = false;
        return response(value);
      }
      if (operation === 'assignment') {
        assert.equal(payload.assignmentToken, assignmentToken);
        return response({ questions: [copy(question)] });
      }
      if (operation === 'verdict') {
        assert.equal(payload.attemptId, 'synthetic-attempt');
        return response({ released: true, results: [{ questionId: question.questionId,
          answerText: fault === 'lost_final_answer' ? '' : question.answerText, humanScore }] });
      }
      throw new Error('Unexpected staging fixture query: ' + operation);
    },
  });
  vm.runInContext(['completeAlacAnswer', 'completeHumanReview', 'cycleBarFeelsAdvisoryDeadline'].map(extractStaging).join('\n'), context);
  return { context, student, trace, waits, run: () => context.cycleBarFeelsAdvisoryDeadline({ token: 'local-admin' }, student) };
}
await test('actual staging cycle crosses 61.5s, retains revisions and reloads before manual human review', async () => {
  const f = advisoryStagingFixture();
  const result = await f.run();
  assert.equal(result.name, 'bar-feels-advisory-deadline-human');
  assert.equal(result.attemptId, 'synthetic-attempt');
  assert.deepEqual(f.waits, [60_000, 1_500]);
  assert.equal(f.trace.filter(({ operation }) => operation === 'heartbeat').length, 2);
  assert.equal(f.trace.filter(({ operation }) => operation === 'resume').length, 3);
  assert.equal(f.trace.some(({ operation }) => operation === 'request_ai_grading'), false);
  assert.ok(f.trace.filter(({ operation }) => ['flag_response', 'submit_attempt', 'create_examiner_assignment'].includes(operation))
    .every(({ elapsed }) => elapsed >= 61_500));
});
for (const fault of [
  'zero_before_deadline', 'automatic_expiry', 'extended_deadline', 'lost_original_answer',
  'lost_post_deadline_edit', 'stale_post_deadline_revision', 'flag_erases_answer',
  'new_attempt_on_reload', 'lost_flag_on_reload', 'missing_confirmation_guard',
  'automatic_submit', 'lost_final_answer',
]) {
  await test(`actual staging cycle rejects ${fault}`, async () => {
    const f = advisoryStagingFixture(fault);
    await assert.rejects(f.run(), (error) => error.code === 'ERR_ASSERTION');
  });
}
await test('formal per-subject strict human cycle and narrow Bar Feels-only database exception remain intact', async () => {
  const context = vm.createContext({
    assert, runId: 'local-only',
    publishControlledExam: async (_admin, config) => {
      assert.equal(config.timerMode, 'strict');
      assert.equal(config.gradingRoute, 'human');
      assert.equal(config.answerReleaseRule, 'after_human');
      return { examId: 'formal-test' };
    },
    beginAndCompleteAttempt: async (_student, config, timerMode) => {
      assert.equal(config.track, 'per_subject');
      assert.equal(timerMode, 'strict');
      return { attemptId: 'formal-test-attempt' };
    },
  });
  vm.runInContext(`async function completeHumanReview() {
    return { results: [4.2, 3.8, 4.2].map((humanScore) => ({ humanScore })) };
  }\n` + extractStaging('cycleStrictHuman'), context);
  assert.equal((await context.cycleStrictHuman({ token: 'local-admin' }, {})).name, 'strict-human');
  const hotfix = fs.readFileSync(new URL('../supabase/migrations/20260906100248_bar_simulation_timer_advisory_hotfix.sql', import.meta.url), 'utf8');
  assert.match(hotfix, /v_attempt\.timer_mode = 'strict' and v_attempt\.deadline_at <= v_now\s+and not exists \([\s\S]*timer_definition\.track = 'bar_feels'\s+\) then/);
  assert.doesNotMatch(stagingSource, /cycleStrictExpiration|strict-server-expiration/);
});
console.log(`${passed} behavior checks passed; cache-busted entry points verified. No customer account or answer was used.`);
