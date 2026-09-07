// Read-only local contract. --browser adds real isolated Chrome DOM checks;
// it never navigates to staging/production or calls any provider.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const runtime = readFileSync(new URL('../assets/examinations.js', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('./verify-examinations-staging-ui.mjs', import.meta.url), 'utf8');
const answers = ['First synthetic answer.\n\nLatest saved draft after tab switching.',
  'Second synthetic answer: ₱149; café; <not markup>.', 'Third synthetic answer.\n\nFinal paragraph retained.'];
const scores = ['3.8 / 5', '4.2 / 5', '2.7 / 5'];
function extract(source, name) {
  const start = source.search(new RegExp(`^(?:  )?(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing ${name}`);
  const next = source.slice(start + 1).search(/\n(?:  )?(?:async )?function /);
  assert.ok(next >= 0, `Missing boundary after ${name}`);
  return source.slice(start, start + 1 + next);
}
const helpers = vm.createContext({ assert });
for (const name of ['normalizeEditorText', 'examinationVerdictHeading', 'verifySimulationVerdict']) {
  vm.runInContext(extract(verifier, name), helpers);
}
async function actualResultMarkup() {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const requests = [];
  const verdict = { attempt: { attemptId:'synthetic-contract', counts:{total:3} },
    results:answers.map((answerText,index)=>({ questionId:`synthetic-${index}`, ordinal:index+1,
      prompt:`Synthetic question ${index+1}.`, answerText, aiScore:Number(scores[index].split('/')[0]),
      modelAnswer:'Synthetic approved answer, separate from the submitted answer.',
      aiAssessment:{ rationale:'Synthetic coaching only.',performanceLabel:'Practice assessment' } })) };
  const before = JSON.stringify(verdict);
  const window = { DueDiligencePhase2Config:{workerUrl:'https://example.invalid'},
    DueDiligencePhase4:{getSession:()=>({user:{id:'synthetic-owner'},access_token:'fixture-only'}),
      request:async(route,{body})=>{ requests.push({route,body});return {data:verdict}; }},
    showPage:()=>{},addEventListener:()=>{} };
  const document={readyState:'loading',addEventListener:()=>{},getElementById:()=>root,querySelectorAll:()=>[]};
  const context=vm.createContext({window,document,console,URL,URLSearchParams,
    setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:()=>{}});
  const boundary='\n}(window));';
  assert.equal(runtime.split(boundary).length-1,1);
  vm.runInContext(runtime.replace(boundary,'\n  global.__uiContract = { state };'+boundary),context);
  window.__uiContract.state.track='bar_feels';
  await window.DueDiligenceExaminations.openVerdict('synthetic-contract');
  assert.equal(JSON.stringify(verdict),before,'Rendering must not change canonical saved data.');
  assert.equal(requests.length,1);assert.equal(requests[0].body.operation,'verdict');
  return `<style>.dd-simulation-submitted-answer{white-space:pre-wrap}</style><div id="dd-bar-feels-app">${root.innerHTML}</div>`;
}
const markup = await actualResultMarkup();

test('actual runtime result uses h1 report title and h2 individual-assessment heading',()=>{
  assert.match(markup,/<h1>Examination results\.<\/h1>/);
  assert.match(markup,/<h2 class="dd-verdict-section-title">Individual ALAC assessments\.<\/h2>/);
  assert.doesNotMatch(markup,/<h1[^>]*>Individual ALAC assessments\./);
  assert.match(markup,/data-cumulative-points>10\.7/);
  assert.match(markup,/data-cumulative-percentage>71\.3%/);
  assert.equal((markup.match(/data-submitted-answer>/g)||[]).length,3);
});
test('verifier requests exact semantic heading scoped to the selected verdict',()=>{
  const calls=[];const expected={};
  const page={locator:(selector)=>{calls.push(selector);return {getByRole:(role,options)=>{
    calls.push({role,...options});return expected;
  }};}};
  assert.equal(helpers.examinationVerdictHeading(page,'#dd-bar-feels-app'),expected);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),['#dd-bar-feels-app .dd-verdict-screen',
    {role:'heading',name:'Individual ALAC assessments.',exact:true}]);
  assert.doesNotMatch(verifier,/\.dd-verdict-screen h1.*filter/);
});
test('live verifier retains score/model-answer checks and adds same-order submitted-answer/totals checks',()=>{
  assert.match(verifier,/submittedAnswers\[index\] = await verifyTwentyTabSwitches/);
  assert.match(verifier,/const submittedAnswers = \[\.\.\.completeAnswers\]/);
  assert.match(verifier,/verifySimulationVerdict\(page, rootSelector, submittedAnswers, scores\)/);
  assert.match(verifier,/assert\.equal\(scores\.length, 3\)/);
  assert.match(verifier,/assert\.match\(verdictText, \/Approved Model Answer\/i\)/);
  assert.match(verifier,/assert\.match\(verdictText, \/Individual Question Assessment\/i\)/);
  assert.match(verifier,/data-submit-exam/);assert.match(verifier,/waitForSaved\(page\)/);
  assert.match(extract(verifier,'verifySimulationVerdict'),/Node\.DOCUMENT_POSITION_FOLLOWING/);
});

if (process.argv.includes('--browser')) {
  const require=createRequire(import.meta.url);
  const {chromium}=require('playwright');
  test('real local Chrome validates exact current markup and rejects false-positive result states',async(t)=>{
    const browser=await chromium.launch({headless:true,channel:'chrome'});
    const context=await browser.newContext();
    let externalRequests=0;
    await context.route('**/*',(route)=>{externalRequests++;return route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(1000);
    const verify=()=>helpers.verifySimulationVerdict(page,'#dd-bar-feels-app',answers,scores);
    try {
      await t.test('current h2 succeeds and retains canonical three-score total/answers',async()=>{
        await page.setContent(markup);
        assert.equal(await helpers.examinationVerdictHeading(page,'#dd-bar-feels-app').count(),1);
        assert.equal(await page.locator('#dd-bar-feels-app .dd-verdict-screen h1').filter({hasText:'Individual ALAC assessments.'}).count(),0);
        assert.deepEqual(JSON.parse(JSON.stringify(await verify())),{total:10.7,maximum:15,percentage:71.3,savedAnswersVerified:true});
      });
      await t.test('semantic heading tolerates previous h1 level without depending on it',async()=>{
        await page.setContent(markup.replace('<h2 class="dd-verdict-section-title">Individual ALAC assessments.</h2>',
          '<h1 class="dd-verdict-section-title">Individual ALAC assessments.</h1>'));
        assert.equal(await helpers.examinationVerdictHeading(page,'#dd-bar-feels-app').count(),1);
      });
      for (const [name,html] of [
        ['plain text is not a heading',markup.replace('<h2 class="dd-verdict-section-title">Individual ALAC assessments.</h2>','<p>Individual ALAC assessments.</p>')],
        ['related heading text is not an exact result',markup.replace('Individual ALAC assessments.</h2>','Individual ALAC assessments. Loading</h2>')],
        ['heading outside the chosen feature cannot pass',markup.replace('id="dd-bar-feels-app"','id="dd-per-subject-app"')],
        ['hidden result heading cannot pass',markup.replace('<h2 class="dd-verdict-section-title">','<h2 hidden class="dd-verdict-section-title">')],
      ]) await t.test(name,async()=>{await page.setContent(html);assert.equal(await helpers.examinationVerdictHeading(page,'#dd-bar-feels-app').count(),0);});
      for (const [name,mutate] of [
        ['wrong cumulative sum rejects',()=>{document.querySelector('[data-cumulative-points]').textContent='10.8';}],
        ['wrong maximum rejects',()=>{document.querySelector('.dd-simulation-total-score span').textContent=' / 100';}],
        ['wrong percentage rejects',()=>{document.querySelector('[data-cumulative-percentage]').textContent='71.4%';}],
        ['partial assessment rejects',()=>{document.querySelector('.dd-simulation-total-badge').textContent='Partial assessment';}],
        ['cumulative total after individual section rejects',()=>{document.querySelector('.dd-verdict-screen').append(document.querySelector('[data-simulation-total]'));}],
        ['changed original answer rejects',()=>{document.querySelector('[data-submitted-answer]').textContent='A substituted answer';}],
        ['swapped question answers reject',()=>{const a=[...document.querySelectorAll('[data-submitted-answer]')];const x=a[0].textContent;a[0].textContent=a[1].textContent;a[1].textContent=x;}],
        ['missing submitted answer rejects',()=>{document.querySelector('[data-submitted-answer]').remove();}],
        ['wrong ordinal rejects',()=>{document.querySelector('.dd-verdict-question .dd-question-label').textContent='Question 2';}],
      ]) await t.test(name,async()=>{await page.setContent(markup);await page.evaluate(mutate);await assert.rejects(verify);});
      assert.equal(externalRequests,0,'The local contract must make no external requests.');
    } finally {await context.close();await browser.close();}
  });
}
