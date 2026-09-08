import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildPublishableStagingFailureDiagnostic,buildStagingChildEvidence,
  buildStagingUiFailureDiagnostic,readStagingUiFailureDiagnostic,STAGING_UI_FAILURE_MARKER} from './staging-e2e-diagnostics.mjs';

const secret='sb_secret_abcdefghijklmnopqrstuvwxyz0123456789';
test('current proof child requires successful cleanup and keeps failures sanitized',()=>{
  const script='test-current-payment-proof-staging.mjs';
  const marker='STAGING_GATE: synthetic_cleanup=true run_id=abcdef12-12345678';
  assert.equal(buildStagingChildEvidence(script,{code:0,output:marker}).status,'PASS');
  assert.equal(buildStagingChildEvidence(script,{code:0,output:''}).failureReason,'cleanup-unconfirmed');
  assert.equal(buildStagingChildEvidence(script,null).status,'NOT_RUN');
  const failed=buildStagingChildEvidence(script,{code:1,output:`${marker}\nError: PRIVATE PAYMENT ${secret}\n at /repo/scripts/staging-current-payment-proof-cleanup.mjs:22:7`},secret);
  assert.equal(failed.status,'FAIL');
  assert.equal(failed.cleanup,'completed');
  assert.equal(failed.failureReason,'credential-output-detected');
  assert.equal(failed.failure.location,'staging-current-payment-proof-cleanup.mjs:22:7');
  assert.doesNotMatch(JSON.stringify(failed),/PRIVATE|PAYMENT|sb_secret/);
});
test('published assertion identifies source and numeric mismatch without free-form data',()=>{
  const output=`AssertionError [ERR_ASSERTION]: PRIVATE ANSWER, Alice Smith, alice@example.invalid ${secret}
    at file:///home/runner/work/Bar-Exam-simulator/Bar-Exam-simulator/scripts/test-examinations-staging.mjs:608:10
  code: 'ERR_ASSERTION',
  actual: 6,
  expected: 5,
  operator: 'strictEqual'`;
  const d=buildPublishableStagingFailureDiagnostic(output,1,secret);
  assert.equal(d.errorCode,'ERR_ASSERTION');assert.equal(d.category,'assertion');
  assert.equal(d.location,'test-examinations-staging.mjs:608:10');
  assert.equal(d.actual,'6');assert.equal(d.expected,'5');assert.equal(d.assertionOperator,'strictEqual');
  assert.doesNotMatch(JSON.stringify(d),/PRIVATE|Alice|alice@|sb_secret|home\/runner/);
});
test('arbitrary names, answers, paths, URLs and quoted operands never publish',()=>{
  const d=buildPublishableStagingFailureDiagnostic(`AssertionError [ERR_ASSERTION]: Maria Cruz says the accused is liable under the private facts.
    actual: 'Maria Cruz private answer',
    expected: 'https://private.example/answer/secret?token=secret',
    at /tmp/customer-name/private-answer.mjs:2:1`,1);
  assert.equal(d.actual,undefined);assert.equal(d.expected,undefined);assert.equal(d.location,null);
  assert.doesNotMatch(JSON.stringify(d),/Maria|Cruz|accused|private\.example|private-answer|token=/);
});
test('request diagnostic retains numeric HTTP status and error class only',()=>{
  const d=buildPublishableStagingFailureDiagnostic(`Error: POST /examinations/command returned 403: PRIVATE ANSWER ${secret}
    at /repo/scripts/test-examinations-staging.mjs:44:9`,1,secret);
  assert.equal(d.httpStatus,403);assert.equal(d.category,'request');assert.equal(d.errorClass,'Error');
  assert.equal(d.location,'test-examinations-staging.mjs:44:9');assert.doesNotMatch(JSON.stringify(d),/PRIVATE|sb_secret/);
});
test('large numeric identifiers are not treated as publishable assertion counters',()=>{
  const d=buildPublishableStagingFailureDiagnostic("AssertionError [ERR_ASSERTION]: Private phone comparison\n actual: 639123456789,\n expected: 639123456780,",1);
  assert.equal(d.actual,undefined);assert.equal(d.expected,undefined);assert.doesNotMatch(JSON.stringify(d),/639123/);
});
test('diagnostics stay bounded even for oversized untrusted failure output',()=>{
  for(const first of ['Error','AssertionError [ERR_ASSERTION]','TimeoutError']){
    const d=buildPublishableStagingFailureDiagnostic(`${first}: ${'private answer '.repeat(10000)}`,1);
    assert.ok(d.message.length<=160);assert.ok(JSON.stringify(d).length<=1024);assert.doesNotMatch(JSON.stringify(d),/private answer/);
  }
});
test('API cleanup and unrun UI are distinct without weakening the suite gate',()=>{
  const api=buildStagingChildEvidence('scripts/test-examinations-staging.mjs',{
    code:1,output:'EXAMINATIONS_STAGING: synthetic_cleanup=true run_id=abcdef12-12345678\nAssertionError [ERR_ASSERTION]: expected result'},secret);
  const ui=buildStagingChildEvidence('scripts/test-examinations-staging-ui.mjs',null,secret);
  assert.equal(api.status,'FAIL');assert.equal(api.cleanup,'completed');assert.equal(api.failureReason,'child-exit');
  assert.equal(ui.status,'NOT_RUN');assert.equal(ui.cleanup,'not-run');assert.equal(ui.failure,null);
});
test('cleanup-only and credential-output failures remain failures',()=>{
  const missing=buildStagingChildEvidence('test-examinations-staging-ui.mjs',{code:0,output:'{}'},secret);
  assert.equal(missing.status,'FAIL');assert.equal(missing.failureReason,'cleanup-unconfirmed');
  const leaked=buildStagingChildEvidence('test-examinations-staging-ui.mjs',{code:0,output:`EXAMINATIONS_UI_STAGING: synthetic_cleanup=true\n${secret}`},secret);
  assert.equal(leaked.status,'FAIL');assert.equal(leaked.failureReason,'credential-output-detected');assert.ok(!JSON.stringify(leaked).includes(secret));
});
test('successful API and UI cleanup markers are specific to their child',()=>{
  for(const [script,prefix] of [['test-examinations-staging.mjs','EXAMINATIONS_STAGING'],['test-examinations-staging-ui.mjs','EXAMINATIONS_UI_STAGING']]){
    const d=buildStagingChildEvidence(script,{code:0,output:`${prefix}: synthetic_cleanup=true run_id=abcdef12-12345678`});
    assert.equal(d.status,'PASS');assert.equal(d.failure,null);assert.equal(d.cleanup,'completed');
  }
  assert.throws(()=>buildStagingChildEvidence('private-alice-answer.mjs',null),/Unsupported/);
});
test('runner records sanitized per-child results and never streams raw child output',()=>{
  const source=readFileSync(new URL('./run-staging-e2e-suite.mjs',import.meta.url),'utf8');
  assert.match(source,/buildPublishableStagingFailureDiagnostic as buildStagingFailureDiagnostic/);
  assert.match(source,/STAGING_CHILD \$\{JSON\.stringify\(safeEvidence\)\}/);
  assert.match(source,/children: childEvidence/);assert.match(source,/schemaVersion: 3/);
  assert.match(source,/if \(safeEvidence\.status !== 'PASS'\) break/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:result\.output|childResult\.output|error\.message)/);
});

function innerError(overrides = {}) {
  return Object.assign(new Error('PRIVATE ANSWER alice@example.invalid'), {
    name: 'AssertionError', code: 'ERR_ASSERTION', actual: 1, expected: 3, operator: 'strictEqual',
    stack: `AssertionError [ERR_ASSERTION]: ${'PRIVATE ANSWER '.repeat(1000)} ${secret} alice@example.invalid
    at completeExamination (file:///home/runner/work/private-repo/private-repo/scripts/verify-examinations-staging-ui.mjs:949:10)`,
  }, overrides);
}
const innerMarker = (value) => `${STAGING_UI_FAILURE_MARKER}${JSON.stringify(value)}`;

test('inner failure survives long private assertion text without losing its source or stage', () => {
  const d = buildStagingUiFailureDiagnostic(innerError(), 'simulator-result-assertions', secret);
  assert.equal(d.location, 'verify-examinations-staging-ui.mjs:949:10');
  assert.equal(d.stage, 'simulator-result-assertions');
  assert.equal(d.errorClass, 'AssertionError'); assert.equal(d.errorCode, 'ERR_ASSERTION');
  assert.equal(d.actual, '1'); assert.equal(d.expected, '3');
  assert.equal(d.assertionOperator, 'strictEqual');
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE|ANSWER|alice|sb_secret|private-repo|file:|https?:/);
  assert.deepEqual(readStagingUiFailureDiagnostic(innerMarker(d)), d);
});
test('structured inner diagnostic takes priority over outer exit-code assertion', () => {
  const inner = buildStagingUiFailureDiagnostic(innerError(), 'simulator-result-assertions');
  const output = `${innerMarker(inner)}
EXAMINATIONS_UI_STAGING: synthetic_cleanup=true
AssertionError [ERR_ASSERTION]: wrapper failure
 at /repo/scripts/test-examinations-staging-ui.mjs:291:8
 actual: 1,
 expected: 0,`;
  const d = buildStagingChildEvidence('test-examinations-staging-ui.mjs', {code:1, output});
  assert.equal(d.status, 'FAIL'); assert.equal(d.cleanup, 'completed');
  assert.deepEqual(d.failure, inner);
  assert.equal(d.failure.expected, '3');
});
test('Playwright timeout class is preserved even when stack begins with locator operation', () => {
  const error = innerError({name:'TimeoutError', code:undefined, actual:undefined, expected:undefined,
    operator:undefined, stack:'locator.waitFor: Timeout 300000ms exceeded. PRIVATE ANSWER\n    at /repo/scripts/verify-examinations-staging-ui.mjs:925:22'});
  const d = buildStagingUiFailureDiagnostic(error, 'simulator-grading');
  assert.equal(d.category, 'timeout'); assert.equal(d.errorClass, 'TimeoutError');
  assert.equal(d.location, 'verify-examinations-staging-ui.mjs:925:22');
  assert.equal(d.actual, undefined); assert.equal(d.expected, undefined);
});
test('inner diagnostics reject unknown stage, free-form operands, private paths and unsafe codes', () => {
  const d = buildStagingUiFailureDiagnostic(innerError({actual:'Alice private answer', expected:{email:'alice@example.invalid'},
    code:'PRIVATE_CUSTOMER_CODE', operator:'privateOperator', stack:'TypeError: secret answer\n at /tmp/alice-private.js:2:9'}),
  'PRIVATE ANSWER alice@example.invalid');
  assert.equal(d.stage, 'unknown'); assert.equal(d.location, null);
  assert.equal(d.errorCode, null); assert.equal(d.actual, undefined); assert.equal(d.expected, undefined);
  assert.equal(d.assertionOperator, undefined);
  assert.doesNotMatch(JSON.stringify(d), /Alice|alice|PRIVATE|answer|secret|privateOperator/);
});
test('inner safe scalars include booleans/null but exclude large identifiers and precision overflow', () => {
  for (const [actual, expected] of [[true,false],[null,0],[100000,-2.5]]) {
    const d = buildStagingUiFailureDiagnostic(innerError({actual,expected}), 'simulator-review');
    assert.equal(d.actual,String(actual)); assert.equal(d.expected,String(expected));
    assert.deepEqual(readStagingUiFailureDiagnostic(innerMarker(d)),d);
  }
  const d = buildStagingUiFailureDiagnostic(innerError({actual:639123456789, expected:1.123456789}), 'simulator-review');
  assert.equal(d.actual,undefined); assert.equal(d.expected,undefined);
});
test('malformed or duplicated inner markers fail closed and cannot leak fields', () => {
  const valid = buildStagingUiFailureDiagnostic(innerError(), 'simulator-result-assertions');
  const bad = [
    '', 'not JSON', 'null', '[]', JSON.stringify({...valid,extra:'PRIVATE ANSWER'}),
    JSON.stringify({...valid,stage:'alice@example.invalid'}), JSON.stringify({...valid,message:'PRIVATE ANSWER'}),
    JSON.stringify({...valid,location:'/tmp/private.js:1:2'}), JSON.stringify({...valid,errorCode:'PRIVATE'}),
    JSON.stringify({...valid,errorClass:'PrivateError'}), JSON.stringify({...valid,category:'private'}),
    JSON.stringify({...valid,actual:'PRIVATE'}), JSON.stringify({...valid,actual:'01'}),
    JSON.stringify({...valid,actual:1}), JSON.stringify({...valid,expected:'639123456789'}),
    JSON.stringify({...valid,httpStatus:999}), JSON.stringify({...valid,exitCode:0}),
    JSON.stringify({...valid,assertionOperator:'PRIVATE'}), ' '.repeat(2049),
  ];
  for (const payload of bad) {
    const output = `${STAGING_UI_FAILURE_MARKER}${payload}`;
    assert.equal(readStagingUiFailureDiagnostic(output), null);
    assert.doesNotMatch(JSON.stringify(buildPublishableStagingFailureDiagnostic(output,1)), /PRIVATE|alice|private\.js|639123/);
  }
  assert.equal(readStagingUiFailureDiagnostic(`${innerMarker(valid)}\n${innerMarker(valid)}`), null);
  assert.equal(readStagingUiFailureDiagnostic(`quoted ${innerMarker(valid)}`), null);
});
test('valid and malformed inner markers cannot turn a zero exit with cleanup into a pass', () => {
  const valid = buildStagingUiFailureDiagnostic(innerError(), 'simulator-result-assertions');
  for (const output of [innerMarker(valid), `${STAGING_UI_FAILURE_MARKER}invalid`]) {
    const d=buildStagingChildEvidence('test-examinations-staging-ui.mjs', {
      code:0, output:`EXAMINATIONS_UI_STAGING: synthetic_cleanup=true\n${output}`,
    });
    assert.equal(d.status,'FAIL'); assert.equal(d.failureReason,'inner-verifier-failed');
  }
});
test('UI wrapper and verifier only emit structured inner failures, not raw exceptions', () => {
  const wrapper=readFileSync(new URL('./test-examinations-staging-ui.mjs',import.meta.url),'utf8');
  const verifier=readFileSync(new URL('./verify-examinations-staging-ui.mjs',import.meta.url),'utf8');
  assert.match(wrapper,/readStagingUiFailureDiagnostic\(verifier\.output\)/);
  assert.match(wrapper,/buildStagingUiFailureDiagnostic\(verifier\.output, 'unknown', SERVICE_ROLE_KEY\)/);
  assert.doesNotMatch(wrapper,/sanitizeStagingDiagnostic\(verifier\.output/);
  assert.match(verifier,/buildStagingUiFailureDiagnostic\(error, currentUiStage\)/);
  assert.match(verifier,/process\.exitCode = 1/);
  assert.match(wrapper,/assert\.equal\(verifier\?\.code, 0/);
  assert.match(wrapper,/EXAMINATIONS_UI_STAGING: synthetic_cleanup=true/);
  assert.doesNotMatch(wrapper+verifier,/console\.(?:log|error)\([^\n]*(?:verifier\.output|error\.stack|error\.message)/);
});

const subjectObservation = () => ({ nextRequests: 1, nextResponses: 1, nextStatus: 200,
  startRequests: 1, startResponses: 1, startStatus: 403, failedRequests: 0,
  focus: 'start', screen: 'catalog', startBusy: false, dialogOpen: false });

test('Subject Matter entry failure retains bounded transport and UI state, not protected data', () => {
  const error = innerError({name:'TimeoutError', stagingSubjectStart:subjectObservation()});
  const d = buildStagingUiFailureDiagnostic(error, 'subject-room-entry');
  assert.deepEqual(d.subjectStart, subjectObservation());
  assert.deepEqual(readStagingUiFailureDiagnostic(innerMarker(d)), d);
  assert.equal(buildStagingChildEvidence('test-examinations-staging-ui.mjs', {
    code:1, output:innerMarker(d),
  }).failure.subjectStart.startStatus, 403);
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE|ANSWER|alice|sb_secret|url|payload/);
});

test('Subject Matter diagnostic rejects unknown fields, identifiers, free text and invalid scalars', () => {
  const good = subjectObservation();
  const bad = [null, [], {}, {...good, extra:'PRIVATE ANSWER'}, {...good, nextRequests:100},
    {...good, nextRequests:-1}, {...good, nextRequests:0.5}, {...good, nextResponses:'1'},
    {...good, startResponses:639123456789}, {...good, failedRequests:Infinity},
    {...good, nextStatus:99}, {...good, startStatus:600}, {...good, startStatus:'200'},
    {...good, focus:'alice@example.invalid'}, {...good, screen:'PRIVATE ANSWER'},
    {...good, startBusy:1}, {...good, dialogOpen:'false'}];
  const valid = buildStagingUiFailureDiagnostic(innerError({stagingSubjectStart:good}), 'subject-room-entry');
  for (const value of bad) {
    const d = buildStagingUiFailureDiagnostic(innerError({stagingSubjectStart:value}), 'subject-room-entry');
    assert.equal(d.subjectStart, undefined);
    assert.equal(readStagingUiFailureDiagnostic(innerMarker({...valid,subjectStart:value})), null);
  }
  assert.equal(buildStagingUiFailureDiagnostic(innerError({stagingSubjectStart:good}), 'accessibility').subjectStart, undefined);
  assert.equal(readStagingUiFailureDiagnostic(innerMarker({...valid,stage:'accessibility'})), null);
});

test('Subject Matter start observes selection completion but retains a single keyboard activation and 15s room bound', () => {
  const source=readFileSync(new URL('./verify-examinations-staging-ui.mjs',import.meta.url),'utf8');
  const start=source.slice(source.indexOf("currentUiStage = 'subject-course-selection'"),source.indexOf("const practiceRoom =", source.indexOf("currentUiStage = 'subject-course-selection'")));
  assert.match(start,/document\.activeElement === heading/);
  assert.match(start,/heading\.querySelector\('h2'\)\?\.textContent\.trim\(\) === expectedSubject/);
  assert.match(start,/!root\.querySelector\('#dd-subject-selector-dialog\[open\]'\)/);
  assert.equal((start.match(/startButton\.press\('Enter'\)/g)||[]).length,1);
  assert.match(start,/getState\?\.\(\)\.screen === 'room'[\s\S]*?timeout: 15_000/);
  assert.doesNotMatch(start,/waitForTimeout|retry|\.click\(/);
  assert.match(start,/page\.off\('request', onStartRequest\)/);
  assert.match(start,/page\.off\('response', onStartResponse\)/);
  assert.match(start,/page\.off\('requestfailed', onStartFailure\)/);
  assert.match(source,/const previousUiStage = currentUiStage;[\s\S]*currentUiStage = previousUiStage/);
});
