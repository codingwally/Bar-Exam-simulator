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
console.log(`${passed} behavior checks passed; cache-busted entry points verified. No customer account or answer was used.`);
