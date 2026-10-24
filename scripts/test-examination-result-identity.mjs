import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import path from 'node:path';

const source = fs.readFileSync(process.argv[2]
  ? path.resolve(process.argv[2], 'assets/examinations.js')
  : new URL('../assets/examinations.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function row(id, score = 3.5) {
  return { questionId: `question-${id}`, ordinal: score === 0 ? 2 : 1,
    prompt: `QUESTION_${id}`, answerText: `SAVED_ANSWER_${id}`, aiScore: score,
    modelAnswer: `SUGGESTED_ANSWER_${id}`,
    aiAssessment: { rationale: `FEEDBACK_${id}`, performanceLabel: 'Practice result' } };
}
function verdict(id, rows = [row(id)]) {
  return { attempt: { attemptId: id, counts: { total: rows.length }, assisted: false }, results: rows };
}
function harness() {
  const roots = new Map();
  const root = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
  const requests = [], mounts = [], removed = [];
  const session = { user: { id: 'synthetic-owner' }, access_token: 'synthetic-only' };
  const window = {
    location: { hash: '#bar-feels' },
    DueDiligencePhase2Config: { workerUrl: 'https://example.invalid' },
    DueDiligencePhase4: {
      getSession: () => session, getAccess: () => ({}), canRevealSubjectReview: () => true,
      request: async (route, { body }) => { requests.push({ route, body }); return { data: window.response }; },
    },
    DueDiligenceAuxiliaryDiagnostics: { mount: (ref) => mounts.push(ref) },
    DueDiligencePrivateWorkspace: { scopedKey: () => 'synthetic-recovery' },
    showPage: (page) => { window.location.hash = page === 'bar-feels' ? '#bar-feels' : '#subject-matter'; },
    addEventListener: () => {},
  };
  const document = {
    readyState: 'loading', addEventListener: () => {},
    getElementById: (id) => { if (!roots.has(id)) roots.set(id, root()); return roots.get(id); },
    querySelectorAll: () => [], body: { contains: (panel) => panel.isConnected },
  };
  const marker = '\n}(window));';
  assert.equal(source.split(marker).length, 2);
  const instrumented = source.replace(marker, `
    global.__identity = { state, showTrackPage, invalidateExaminationRequests, subjectMatterResultMarkup,
      subjectReviewPanelIsCurrent, loadCompleteSubjectReview };
  }(window));`);
  vm.runInNewContext(instrumented, { window, document, console, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => {},
    localStorage: { removeItem: (key) => removed.push(key) },
  });
  const hooks = window.__identity;
  hooks.state.track = 'bar_feels';
  return { ...hooks, window, document, roots, requests, mounts, removed, session,
    open: window.DueDiligenceExaminations.openVerdict,
    html: (track = 'bar_feels') => roots.get(track === 'bar_feels' ? 'dd-bar-feels-app' : 'dd-per-subject-app')?.innerHTML || '' };
}

test('Simulation history ignores an active syllabus draft and keeps every result field together', async () => {
  const h = harness();
  h.state.active = { examination: { track: 'per_subject', subject: 'STALE_COURSE' },
    attempt: { attemptId: 'draft', assisted: true }, questions: [{ questionId: 'stale', answerText: 'STALE_ANSWER' }] };
  h.state.history = [{ attemptId: 'selected', track: 'bar_feels' }];
  h.window.response = verdict('selected', [row('ONE'), row('TWO', 0)]);
  const before = JSON.stringify(h.state.active);
  await h.open('selected');
  assert.equal(h.state.track, 'bar_feels');
  assert.match(h.html(), /Examination results/);
  assert.doesNotMatch(h.html(), /STALE_|Syllabus-Based Review/);
  const cards = h.html().split('<div class="dd-verdict-question">').slice(1);
  assert.equal(cards.length, 2);
  for (const [index, id] of ['ONE', 'TWO'].entries()) {
    for (const prefix of ['QUESTION_', 'SAVED_ANSWER_', 'SUGGESTED_ANSWER_', 'FEEDBACK_']) {
      assert.ok(cards[index].includes(prefix + id));
      assert.ok(!cards[1 - index].includes(prefix + id));
    }
  }
  assert.match(cards[0], /3\.5 \/ 5/);
  assert.match(cards[1], /0\.0 \/ 5/);
  assert.equal(JSON.stringify(h.state.active), before, 'Reading history must preserve the active draft');
  assert.equal(h.mounts[0].sourceId, 'selected');
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.requests.map((r) => r.body.operation), ['verdict']);
});

test('Historical syllabus review cannot inherit another attempt’s subject or assisted classification', async () => {
  const h = harness();
  h.state.track = 'per_subject';
  h.state.active = { examination: { track: 'per_subject', subject: 'STALE_COURSE' },
    attempt: { attemptId: 'draft', assisted: true }, questions: [] };
  h.window.response = verdict('history');
  await h.open('history');
  assert.match(h.html('per_subject'), /QUESTION_history/);
  assert.match(h.html('per_subject'), /SAVED_ANSWER_history/);
  assert.match(h.html('per_subject'), />Unassisted</);
  assert.doesNotMatch(h.html('per_subject'), /STALE_COURSE|Assisted \/ Open-book/);
  assert.deepEqual(h.removed, []);
});

for (const [name, mutate] of [
  ['wrong attempt', (v) => { v.attempt.attemptId = 'other'; }],
  ['wrong track', (v) => { v.attempt.track = 'per_subject'; }],
  ['wrong row attempt', (v) => { v.results[0].attemptId = 'other'; }],
  ['duplicate question', (v) => { v.results.push({ ...v.results[0] }); }],
  ['missing question identity', (v) => { delete v.results[0].questionId; }],
  ['missing results', (v) => { delete v.results; }],
]) test(`Refuses ${name} without displaying a borrowed grade or answer`, async () => {
  const h = harness();
  h.window.response = verdict('selected'); mutate(h.window.response);
  await h.open('selected');
  assert.match(h.html(), /Assessment unavailable/);
  assert.doesNotMatch(h.html(), /SAVED_ANSWER_|FEEDBACK_|SUGGESTED_ANSWER_/);
  assert.equal(h.mounts.length, 0);
});

test('Opening another attempt discards a late response for the previous selection', async () => {
  const h = harness(), a = deferred(), b = deferred();
  h.window.DueDiligencePhase4.request = async (_route, { body }) => ({ data: await (body.attemptId === 'A' ? a.promise : b.promise) });
  const first = h.open('A'), second = h.open('B');
  b.resolve(verdict('B')); await second;
  a.resolve(verdict('A')); await first;
  assert.match(h.html(), /SAVED_ANSWER_B/);
  assert.doesNotMatch(h.html(), /SAVED_ANSWER_A/);
  assert.equal(h.mounts.length, 1);
  assert.equal(h.mounts[0].sourceId, 'B');
});

test('Leaving results or changing accounts discards a pending private response', async () => {
  for (const change of [(h) => h.showTrackPage('per_subject'), (h) => { h.session.user.id = 'another-owner'; }]) {
    const h = harness(), pending = deferred();
    h.window.DueDiligencePhase4.request = async () => ({ data: await pending.promise });
    const request = h.open('A'); change(h); pending.resolve(verdict('A')); await request;
    assert.doesNotMatch(h.html(), /SAVED_ANSWER_A/);
    assert.equal(h.mounts.length, 0);
  }
});

test('Suggested-answer panels are current only for their selected attempt and question', () => {
  const h = harness();
  h.state.screen = 'verdict';
  h.state.verdict = { ...verdict('selected'), track: 'per_subject' };
  const panel = { isConnected: true, dataset: { attemptId: 'selected', questionId: 'question-selected' } };
  assert.equal(h.subjectReviewPanelIsCurrent(panel), true);
  panel.dataset.questionId = 'other-question'; assert.equal(h.subjectReviewPanelIsCurrent(panel), false);
  panel.dataset.questionId = 'question-selected'; panel.dataset.attemptId = 'other-attempt';
  assert.equal(h.subjectReviewPanelIsCurrent(panel), false);
  panel.dataset.attemptId = 'selected'; panel.isConnected = false;
  assert.equal(h.subjectReviewPanelIsCurrent(panel), false);
});

test('Pending grading does not borrow a score, answer, model or feedback from the active editor', async () => {
  const h = harness();
  h.state.active = { attempt: { attemptId: 'draft' }, examination: { track: 'bar_feels' },
    questions: [{ answerText: 'STALE_ANSWER' }] };
  const result = row('pending'); delete result.answerText; delete result.modelAnswer;
  result.aiScore = null; result.aiAssessment = null;
  h.window.response = verdict('selected', [result]); await h.open('selected');
  assert.match(h.html(), /saved answer is unavailable/);
  assert.match(h.html(), /Model answer not yet released/);
  assert.doesNotMatch(h.html(), /STALE_ANSWER|SUGGESTED_ANSWER_|FEEDBACK_|>0\.0 \/ 5/);
});

test('Private-result context is erased when examination requests are invalidated', () => {
  const h = harness();
  h.state.verdict = { ...verdict('private'), track: 'bar_feels' };
  h.invalidateExaminationRequests();
  assert.equal(h.state.verdict, null);
});

test('A historical suggested-answer request rejects material for another question', async () => {
  const h = harness();
  h.state.screen = 'verdict';
  h.state.verdict = { ...verdict('selected'), track: 'per_subject' };
  const status = { textContent: '', innerHTML: '' }, actions = { replaceChildren() {}, innerHTML: '' };
  const panel = { isConnected: true, dataset: { attemptId: 'selected', questionId: 'question-selected' },
    querySelector: (s) => s === '[data-subject-review-status]' ? status : s === '[data-subject-review-actions]' ? actions : null,
    querySelectorAll: () => [] };
  const button = { dataset: {}, closest: () => panel, setAttribute() {}, removeAttribute() {} };
  h.window.response = { attemptId: 'selected', questionId: 'WRONG', suggestedAnswer: 'UNRELATED_MODEL' };
  await h.loadCompleteSubjectReview(button);
  assert.match(status.innerHTML, /Review status could not be confirmed/);
  assert.doesNotMatch(status.innerHTML, /UNRELATED_MODEL/);
  assert.equal(h.state.reviewMaterialCache.size, 0);
  assert.equal(h.requests[0].body.attemptId, 'selected');
});
