import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootPath = path.resolve(process.argv[2] || '.');
const source = fs.readFileSync(path.join(rootPath, 'assets/examinations.js'), 'utf8');
const marker = 'simulation-submitted-answer-20260906-r1';
assert.ok(source.includes(marker));
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function fixture() {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const requests = [];
  const session = { user: { id: 'synthetic-owner' }, access_token: 'synthetic-test-only' };
  const window = {
    DueDiligencePhase2Config: { workerUrl: 'https://example.invalid' },
    DueDiligencePhase4: {
      getSession: () => session,
      request: async (route, { body }) => { requests.push({ route, body }); return { data: window.verdict }; },
    },
    showPage: () => {},
    addEventListener: () => {},
  };
  const document = {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => root,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({ window, document, console, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => {} });
  // Instrument only the test VM. The shipped module is unchanged and exposes no test hooks.
  assert.equal(source.split('\n}(window));').length - 1, 1);
  vm.runInContext(source.replace('\n}(window));', '\n  global.__answerTest = { state, assessmentCard, simulationSubmittedAnswerMarkup };\n}(window));'), context);
  window.__answerTest.state.track = 'bar_feels';
  return { window, root, requests, session, ...window.__answerTest };
}
function answerBlock(html) {
  const match = html.match(/<div class="dd-model-answer dd-simulation-submitted-answer" data-submitted-answer>([\s\S]*?)<\/div>/);
  assert.ok(match, 'Submitted answer panel missing');
  return match[1];
}
function row(i = 1, overrides = {}) {
  return { questionId: `synthetic-q${i}`, ordinal: i, prompt: `Synthetic question ${i}?`,
    answerText: `Original answer ${i}.\n\nMy reasoning for question ${i}.`, aiScore: 3.5,
    aiAssessment: { rationale: `Synthetic coaching ${i}.`, performanceLabel: 'Practice assessment' }, ...overrides };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
await test('saved answer is displayed without callers supplying answerText options', () => {
  const c = fixture(); const r = row(); const html = c.assessmentCard(r, { track: 'bar_feels' });
  assert.equal(answerBlock(html), escape(r.answerText));
  assert.ok(html.indexOf('<h4>Question</h4>') < html.indexOf('data-submitted-answer-section'));
  assert.ok(html.indexOf('data-submitted-answer-section') < html.indexOf('Why this score'));
});
await test('paragraphs, punctuation, Unicode, spelling and rubric words stay verbatim', () => {
  const c = fixture(); const answer = '  No po — mali "eto" & <ito>.\n\nRubric: this is my own answer.\n  Article 19; ₱500.  ';
  assert.equal(answerBlock(c.assessmentCard(row(1, {answerText:answer}), {track:'bar_feels'})), escape(answer));
});
await test('HTML and scripts in user answers render as safe selectable text', () => {
  const c = fixture(); const answer = '</div><script>window.bad=true</script><img src=x onerror="alert(1)">';
  const html = c.assessmentCard(row(1,{answerText:answer}), {track:'bar_feels'});
  assert.equal(answerBlock(html),escape(answer)); assert.doesNotMatch(html,/<script>|<img src=x/);
});
await test('blank submitted answers have an explicit unanswered state', () => {
  const c = fixture();
  for (const answerText of ['', '  \n\t']) {
    assert.equal(answerBlock(c.assessmentCard(row(1,{answerText}),{track:'bar_feels'})), 'No answer was submitted for this question.');
  }
});
await test('missing or invalid saved answers never invent or borrow answer content', () => {
  const c = fixture();
  for (const answerText of [undefined,null,{},42]) {
    const html = c.assessmentCard(row(1,{answerText,modelAnswer:'MODEL ONLY'}),{track:'bar_feels',answerText:'UNRELATED DRAFT'});
    assert.equal(answerBlock(html),'The saved answer is unavailable for this question.');
  }
});
await test('saved result beats stale options and another active attempt', () => {
  const c=fixture(); c.state.active={examination:{track:'bar_feels'},questions:[{answerText:'Wrong active answer'}]};
  assert.equal(answerBlock(c.assessmentCard(row(),{track:'bar_feels',answerText:'Wrong options answer'})),escape(row().answerText));
});
await test('full 20000-character answers are not truncated', () => {
  const c=fixture(); const answer='A'.repeat(19990)+'\nEND-12345';
  assert.equal(answer.length,20000);
  assert.equal(answerBlock(c.assessmentCard(row(1,{answerText:answer}),{track:'bar_feels'})),answer);
});
await test('answer stays visible while AI grading is pending or human-only', () => {
  const c=fixture();
  for(const overrides of [{aiScore:null,aiAssessment:null},{aiScore:null,aiAssessment:null,humanScore:4.5}]) {
    const r=row(1,overrides); assert.equal(answerBlock(c.assessmentCard(r,{track:'bar_feels'})),escape(r.answerText));
  }
});
await test('model response remains separate from the submitted answer', () => {
  const c=fixture();const r=row(1,{modelAnswer:'Approved model answer, not the student answer.'});
  const html=c.assessmentCard(r,{track:'bar_feels'});
  assert.equal(answerBlock(html),escape(r.answerText));assert.ok(html.indexOf('data-submitted-answer-section')<html.indexOf('Approved Model Answer'));
});
await test('single-question syllabus cards retain their existing answer presentation', () => {
  const c=fixture();
  const compact=c.assessmentCard(row(),{track:'per_subject',compactSubject:true});
  assert.doesNotMatch(compact,/data-submitted-answer|<h4>Your answer<\/h4>/);
  const legacy=c.assessmentCard(row(),{track:'per_subject',answerText:'Existing syllabus answer'});
  assert.match(legacy,/Existing syllabus answer/);assert.doesNotMatch(legacy,/data-submitted-answer/);
});
await test('all 20 historical results show the matching saved answers below the unchanged total', async () => {
  const c=fixture(); c.window.verdict={attempt:{attemptId:'synthetic-history',counts:{total:20}},results:Array.from({length:20},(_,i)=>row(i+1))};
  const before=JSON.stringify(c.window.verdict); await c.window.DueDiligenceExaminations.openVerdict('synthetic-history');
  assert.equal((c.root.innerHTML.match(/data-submitted-answer-section/g)||[]).length,20);
  const blocks=[...c.root.innerHTML.matchAll(/<div class="dd-model-answer dd-simulation-submitted-answer" data-submitted-answer>([\s\S]*?)<\/div>/g)];
  blocks.forEach((m,i)=>assert.equal(m[1],escape(c.window.verdict.results[i].answerText)));
  assert.ok(c.root.innerHTML.indexOf('data-simulation-total')<c.root.innerHTML.indexOf('data-submitted-answer-section'));
  assert.match(c.root.innerHTML,/data-cumulative-points>70\.0/); assert.match(c.root.innerHTML,/70\.0%/);
  assert.equal(JSON.stringify(c.window.verdict),before);assert.equal(c.requests.length,1);
  assert.equal(c.requests[0].route,'/examinations/query');assert.equal(c.requests[0].body.operation,'verdict');
});
await test('new-result route uses saved answers and performs no grading or submission writes', async () => {
  const c=fixture(); c.state.active={attempt:{attemptId:'synthetic-new'},examination:{track:'bar_feels'},questions:[{answerText:'STALE EDITOR'}]};
  c.window.verdict={attempt:{attemptId:'synthetic-new',counts:{total:1}},results:[row()]};
  await c.window.DueDiligenceExaminations.openVerdict('synthetic-new');
  assert.equal(answerBlock(c.root.innerHTML),escape(row().answerText));
  assert.equal(c.requests.length,1);assert.equal(c.requests[0].body.operation,'verdict');
});
await test('account change discards a stale result instead of rendering private answers', async () => {
  const c=fixture();c.window.DueDiligencePhase4.request=async()=>{
    c.session.user.id='different-synthetic-owner';
    return {data:{attempt:{counts:{total:1}},results:[row()]}};
  };
  await c.window.DueDiligenceExaminations.openVerdict('synthetic-history');
  assert.doesNotMatch(c.root.innerHTML,/data-submitted-answer|Original answer/);
});
await test('styles wrap long answers and asset versions preserve the timer and total markers', () => {
  const css=fs.readFileSync(path.join(rootPath,'assets/examinations.css'),'utf8');
  assert.match(css,/\.dd-simulation-submitted-answer\s*\{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;[^}]*user-select: text;/);
  for(const name of ['index.html','assets/feature-loader.js','service-worker.js']) {
    const text=fs.readFileSync(path.join(rootPath,name),'utf8');
    for(const expected of [marker,'simulation-cumulative-score-20260906-r1','simulation-timer-review-20260906-r2']) assert.ok(text.includes(expected));
  }
});
if (process.env.ANSWER_PREVIEW_DIR) {
  const c=fixture(); c.window.verdict={attempt:{counts:{total:20}},results:Array.from({length:20},(_,i)=>row(i+1))};
  c.window.verdict.results[0].answerText='No. The action should not prosper.\n\nThe governing rule requires the claimant to prove each essential element. In this case, the stated facts do not establish the required element.\n\nTherefore, the claim should be denied.';
  await c.window.DueDiligenceExaminations.openVerdict('synthetic-preview');
  const index=fs.readFileSync(path.join(rootPath,'index.html'),'utf8');
  const styles=[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+'\n'+fs.readFileSync(path.join(rootPath,'assets/examinations.css'),'utf8');
  fs.mkdirSync(process.env.ANSWER_PREVIEW_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.ANSWER_PREVIEW_DIR,'submitted-answer-preview.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Submitted answer verification — synthetic data</title><style>${styles}</style></head><body>${c.root.innerHTML}</body></html>`);
}
console.log(`${passed} submitted-answer checks passed. No customer account, answer, or score was used.`);
