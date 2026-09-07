import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildPublishableStagingFailureDiagnostic,buildStagingChildEvidence} from './staging-e2e-diagnostics.mjs';

const secret='sb_secret_abcdefghijklmnopqrstuvwxyz0123456789';
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
