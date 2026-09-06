import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootPath = path.resolve(process.argv[2] || '.');
const source = fs.readFileSync(path.join(rootPath, 'assets/examinations.js'), 'utf8');
const marker = 'simulation-cumulative-score-20260906-r1';
assert.ok(source.includes(marker));
function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.slice(start + 1).search(/\n  (?:async )?function /);
  assert.ok(end >= 0, `Missing end of ${name}`);
  return source.slice(start, start + 1 + end);
}
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const c = vm.createContext({ console, escapeHtml: escape, escapeAttribute: escape });
for (const name of ['simulationScoreValue','simulationCumulativeScores','simulationCumulativeScoreMarkup']) vm.runInContext(extract(name), c);
const fixture = (scores, total = scores.length, field = 'aiScore') => ({
  attempt: { attemptId: 'fixture-only', counts: { total } },
  results: scores.map((score, i) => ({ questionId: `fixture-q${i}`, ordinal: i+1, [field]: score,
    prompt: 'Synthetic visual verification question.', aiAssessment: { performanceLabel: 'Practice assessment', rationale: 'Synthetic test data, not a customer score.' } })),
});
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
await test('20 saved scores produce the correct total out of 100 and percentage', () => {
  const s = c.simulationCumulativeScores(fixture(Array(20).fill(3.5)))[0];
  assert.equal(s.total,70); assert.equal(s.maximum,100); assert.equal(s.percentage,70); assert.equal(s.complete,true);
});
await test('valid zero scores count as graded, not missing', () => {
  const s = c.simulationCumulativeScores(fixture(Array(20).fill(0)))[0];
  assert.equal(s.gradedCount,20); assert.equal(s.total,0); assert.equal(s.percentage,0);
});
await test('decimal totals agree with individual 0-to-5 point scores', () => {
  const s = c.simulationCumulativeScores(fixture([0.1,0.2,1.5,2,5]))[0];
  assert.equal(s.total,8.8); assert.equal(s.maximum,25); assert.equal(s.percentage,35.2);
});
await test('null, empty, invalid, negative, and out-of-range scores remain pending', () => {
  const s = c.simulationCumulativeScores(fixture([null,undefined,'', ' ',false,[],{},NaN,Infinity,-1,6,0,'2.5']))[0];
  assert.equal(s.gradedCount,2); assert.equal(s.total,2.5); assert.equal(s.percentage,null);
});
await test('partial assessment uses full question count and never reports a final percentage', () => {
  const f = fixture([3,4,null],20); const s=c.simulationCumulativeScores(f)[0];
  assert.equal(s.total,7); assert.equal(s.maximum,100); assert.equal(s.gradedCount,2);
  const html=c.simulationCumulativeScoreMarkup(f);
  assert.match(html,/Cumulative total so far/); assert.match(html,/18 questions are/); assert.match(html,/pending, not zero/);
  assert.doesNotMatch(html,/7\.0%/);
});
await test('ungraded results display an awaiting state rather than a fabricated zero', () => {
  const html=c.simulationCumulativeScoreMarkup(fixture(Array(20).fill(null)));
  assert.match(html,/Awaiting assessment/); assert.match(html,/data-cumulative-points>—/);
  assert.doesNotMatch(html,/data-cumulative-points>0/);
});
await test('empty or malformed result payloads never show a zero denominator or NaN', () => {
  for (const f of [{},{results:null},{results:'invalid'},{results:[]}]) {
    const html=c.simulationCumulativeScoreMarkup(f); assert.doesNotMatch(html,/NaN|Infinity| \/ 0/);
    assert.match(html,/Awaiting assessment/);
  }
});
await test('duplicate question rows are counted once and conflicting scores stay pending', () => {
  const f=fixture([4,2]); f.results.push({...f.results[0]});
  let s=c.simulationCumulativeScores(f)[0]; assert.equal(s.total,6); assert.equal(s.questionCount,2);
  f.results.push({...f.results[0],aiScore:3}); s=c.simulationCumulativeScores(f)[0];
  assert.equal(s.total,2); assert.equal(s.gradedCount,1); assert.equal(s.complete,false);
});
await test('AI and human totals are separate and never blended', () => {
  const f=fixture(Array(20).fill(3)); f.results.forEach(r=>{r.humanScore=4;});
  const summaries=c.simulationCumulativeScores(f); assert.equal(summaries.length,2);
  assert.equal(summaries[0].total,60); assert.equal(summaries[1].total,80);
  assert.equal(summaries[0].label,'AI assessment'); assert.equal(summaries[1].label,'Human examiner');
});
await test('human-only results show the human cumulative total', () => {
  const summaries=c.simulationCumulativeScores(fixture(Array(20).fill(4),20,'humanScore'));
  assert.equal(summaries.length,1); assert.equal(summaries[0].total,80); assert.equal(summaries[0].label,'Human examiner');
});
await test('rendering does not mutate saved scores or the verdict payload', () => {
  const f=fixture([4,3,2]); const before=JSON.stringify(f); c.simulationCumulativeScoreMarkup(f);
  assert.equal(JSON.stringify(f),before);
});
function verdictContext(f, track='bar_feels') {
  const root={innerHTML:'',querySelector:()=>null}; const calls=[];
  const context=vm.createContext({console,root,global:{},state:{track,active:null},
    pageRoot:()=>root,showTrackPage:()=>{},api:async(route,body)=>{calls.push({route,body});return f;},
    escapeHtml:escape,escapeAttribute:escape,focusRendered:()=>{},isStaleIdentityError:()=>false,
    clearRecovery:()=>{},restoreRevealedSubjectReview:()=>{},subjectMatterResultMarkup:()=>'<section>Existing syllabus result</section>',
    assessmentCard:r=>`<article class="assessment-card" data-test-individual>Score ${r.aiScore ?? 'pending'}</article>`,
  });
  for (const name of ['simulationScoreValue','simulationCumulativeScores','simulationCumulativeScoreMarkup','openVerdict']) vm.runInContext(extract(name),context);
  return {context,root,calls};
}
await test('history result loads cumulative total above the individual heading and Question 1', async () => {
  const {context,root,calls}=verdictContext(fixture(Array(20).fill(3.5)));
  await context.openVerdict('fixture-only');
  assert.ok(root.innerHTML.indexOf('data-simulation-total') < root.innerHTML.indexOf('Individual ALAC assessments.'));
  assert.ok(root.innerHTML.indexOf('data-simulation-total') < root.innerHTML.indexOf('Question 1'));
  assert.match(root.innerHTML,/data-cumulative-points>70\.0/); assert.match(root.innerHTML,/70\.0%/);
  assert.equal(calls.length,1); assert.equal(calls[0].body.operation,'verdict');
});
await test('single-question syllabus result remains unchanged', async () => {
  const {context,root}=verdictContext(fixture([3.5]),'per_subject');
  await context.openVerdict('fixture-only'); assert.equal(root.innerHTML,'<section>Existing syllabus result</section>');
});
await test('all score assets are cache-busted while the prior timer marker remains', () => {
  for(const name of ['index.html','assets/feature-loader.js','service-worker.js']) {
    const text=fs.readFileSync(path.join(rootPath,name),'utf8');
    assert.ok(text.includes(marker)); assert.ok(text.includes('simulation-timer-review-20260906-r2'));
  }
  const loader=fs.readFileSync(path.join(rootPath,'assets/feature-loader.js'),'utf8');
  assert.match(loader,/examinations\.css[^'\n]*simulation-cumulative-score-20260906-r1/);
  assert.match(loader,/examinations\.js[^'\n]*simulation-cumulative-score-20260906-r1/);
  assert.ok(fs.readFileSync(path.join(rootPath,'assets/examinations.css'),'utf8').includes('@media (max-width: 640px)'));
});
if(process.env.SCORE_PREVIEW_DIR) {
  const preview=verdictContext(fixture(Array(20).fill(3.5)));
  preview.context.sanitizeSubjectReviewValue=x=>x;
  for(const name of ['assessmentList','assessmentSources','assessmentScoreWasCapped','assessmentBreakdown','assessmentCard']) vm.runInContext(extract(name),preview.context);
  await preview.context.openVerdict('fixture-only');
  const index=fs.readFileSync(path.join(rootPath,'index.html'),'utf8');
  const globalStyles=[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  const styles=globalStyles+'\n'+fs.readFileSync(path.join(rootPath,'assets/examinations.css'),'utf8');
  fs.mkdirSync(process.env.SCORE_PREVIEW_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.SCORE_PREVIEW_DIR,'cumulative-score-preview.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cumulative score visual verification — synthetic data</title><style>${styles}</style></head><body>${preview.root.innerHTML}</body></html>`);
}
console.log(`${passed} cumulative-score checks passed. Display only: no grading, auth, or submission changes.`);
