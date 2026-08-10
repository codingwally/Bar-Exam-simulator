import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, adminJs, publicExamJs] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/duediligence-2026.js', import.meta.url), 'utf8'),
]);

assert.match(
  html,
  /<button data-section="examination_room">Examination Room<\/button>/,
  'Examination Room operations must live inside the authenticated Admin Dashboard',
);
assert.match(adminJs, /examination_room:\s*'Examination Room'/);
assert.match(
  adminJs,
  /founderOnly\s*=\s*\[[^\]]*'examination_room'[^\]]*\]\.includes\(section\)/,
  'the section must retain the dashboard founder authorization boundary',
);
assert.match(adminJs, /examinationRoomAdminView:\s*'operations'/);

const loaderStart = adminJs.indexOf('async function loadExaminationRoomAdmin');
const loaderEnd = adminJs.indexOf('function examinationRoomRecords', loaderStart);
assert.ok(loaderStart > 0 && loaderEnd > loaderStart, 'metadata loader must remain independently reviewable');
const loader = adminJs.slice(loaderStart, loaderEnd);
assert.match(loader, /api\('\/exam-room\/query',\s*\{ operation: 'portal' \}\)/);
assert.match(loader, /result\.roles\?\.admin !== true/);
assert.doesNotMatch(loader, /attempt|grading_workspace|dispute_view|student_result|answer/i);

const operationsStart = adminJs.indexOf('function renderExaminationRoomOperations');
const operationsEnd = adminJs.indexOf('function renderExaminationRoomBreakGlassEvidence', operationsStart);
assert.ok(operationsStart > 0 && operationsEnd > operationsStart);
const operationsView = adminJs.slice(operationsStart, operationsEnd);
assert.match(operationsView, /Operational and system health/);
assert.match(operationsView, /Exam and class details/);
assert.match(operationsView, /Basic details only/i);
assert.match(operationsView, /Student answers, grades,[\s\S]*are not requested or shown/);
assert.match(operationsView, /Not shown on this regular Admin page/g);
assert.match(operationsView, /Camera collection[\s\S]*Off\./);
assert.match(operationsView, /Restricted-access notice/);
assert.match(operationsView, /Download warning/);
assert.doesNotMatch(operationsView, /question\.answer|answerText|grading_workspace|disputeKey|gradingKey/);

const restrictedStart = operationsEnd;
const restrictedEnd = adminJs.indexOf('async function renderExaminationRoomAdmin', restrictedStart);
const restrictedView = adminJs.slice(restrictedStart, restrictedEnd);
for (const requiredField of [
  'name="examId"',
  'name="attemptId"',
  'name="candidateNumber"',
  'name="caseReference"',
  'name="reason"',
  'name="expiresAt"',
]) assert.match(restrictedView, new RegExp(requiredField));
assert.match(restrictedView, /Fresh AAL2 challenge/);
assert.match(restrictedView, /does not yet perform Supabase MFA challenge\/verify/);
assert.match(restrictedView, /Not implemented - institutional release blocker/);
assert.match(restrictedView, /exam-room-break-glass-v2/);
assert.match(restrictedView, /data-exam-room-break-glass \$\{gate\.enabled \? '' : 'disabled'\}/);
assert.match(restrictedView, /broad legacy dispute workflow remains retired/i);
assert.match(restrictedView, /No whole-exam or other-candidate request is made/);
assert.match(restrictedView, /Restricted candidate evidence is open/);
assert.match(restrictedView, /Mandatory post-access review and closure/);
assert.match(restrictedView, /The scoped grant expired\. Candidate evidence is no longer rendered/);
assert.match(restrictedView, /grant is closed, but its mandatory post-access review is outstanding/);
assert.match(restrictedView, /Candidate evidence has been removed[\s\S]*cannot be reloaded under the closed grant/);
assert.doesNotMatch(restrictedView, /dispute_view|grading_workspace|student_result/);

const gateStart = adminJs.indexOf('function examinationRoomBreakGlassGate');
const gateEnd = adminJs.indexOf('async function loadExaminationRoomAdmin', gateStart);
const gate = adminJs.slice(gateStart, gateEnd);
assert.match(gate, /contract\.contractVersion === 'exam-room-break-glass-v2'/);
assert.match(gate, /contract\.authenticationLevel === 'aal2'/);
assert.match(gate, /contract\.freshAal2 === true/);
assert.match(gate, /contract\.canIssue === true/);
assert.match(gate, /contract\.canView === true/);
assert.match(gate, /contract\.canClose === true/);
assert.match(gate, /contract\.canRecordReview === true/);
assert.match(gate, /const stepUpUiAvailable = false/);
assert.match(gate, /enabled: stepUpUiAvailable && contractReported && freshAal2/);
assert.doesNotMatch(gate, /has\('exam_room_break_glass'\)/, 'super-admin convenience checks cannot imply step-up capability');

const evaluateGate = Function(
  'state',
  `'use strict'; ${gate}; return examinationRoomBreakGlassGate();`,
);
assert.equal(evaluateGate({ authorization: {} }).enabled, false);
const fullyAuthorizedContract = {
  contractVersion: 'exam-room-break-glass-v2', featureEnabled: true, adminAuthorized: true,
  authenticationLevel: 'aal2', freshAal2: true, requiresFreshAal2: true,
  maximumStepUpAgeSeconds: 900, stepUpExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  canIssue: true, canView: true, canClose: true, canRecordReview: true,
};
assert.equal(evaluateGate({ authorization: { examinationRoomBreakGlass: fullyAuthorizedContract } }).enabled, false,
  'production stays hard-disabled until the dashboard implements real MFA challenge and verify');

// Exercise the future gate with only the explicit local release blocker lifted:
// server AAL2 and every narrow capability are still independently mandatory.
const evaluateGateAfterImplementedStepUp = Function(
  'state',
  `'use strict'; ${gate.replace('const stepUpUiAvailable = false', 'const stepUpUiAvailable = true')}; return examinationRoomBreakGlassGate();`,
);
assert.equal(evaluateGateAfterImplementedStepUp({ authorization: { examinationRoomBreakGlass: {
  contractVersion: 'exam-room-break-glass-v2', featureEnabled: true, adminAuthorized: true,
  authenticationLevel: 'aal1', freshAal2: false, requiresFreshAal2: true,
  maximumStepUpAgeSeconds: 900, stepUpExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  canIssue: true, canView: true, canClose: true, canRecordReview: true,
} } }).enabled, false);
assert.equal(evaluateGateAfterImplementedStepUp({ authorization: { examinationRoomBreakGlass: {
  contractVersion: 'exam-room-break-glass-v2', featureEnabled: true, adminAuthorized: true,
  authenticationLevel: 'aal2', freshAal2: true, requiresFreshAal2: true,
  maximumStepUpAgeSeconds: 900, stepUpExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  canIssue: true, canView: false, canClose: true, canRecordReview: true,
} } }).enabled, false);
assert.equal(evaluateGateAfterImplementedStepUp({ authorization: {
  examinationRoomBreakGlass: fullyAuthorizedContract,
} }).enabled, true);

const bindingStart = adminJs.indexOf('function bindExaminationRoomAdmin');
const bindingEnd = adminJs.indexOf('async function renderSection', bindingStart);
const binding = adminJs.slice(bindingStart, bindingEnd);
assert.match(binding, /4 \* 60 \* 60 \* 1000/);
assert.match(binding, /event\.preventDefault\(\)/);
assert.match(binding, /Break-glass remains blocked by the server authorization gate/);
assert.match(adminJs, /operation: 'issue_break_glass'/);
assert.match(adminJs, /operation: 'break_glass_view'[\s\S]*grantId: scope\.grantId[\s\S]*examId: scope\.examId[\s\S]*attemptId: scope\.attemptId[\s\S]*candidateNumber: scope\.candidateNumber/);
assert.match(adminJs, /operation: 'record_break_glass_review'/);
assert.match(adminJs, /operation: 'close_break_glass'/);
const reviewCloseStart = adminJs.indexOf('async function reviewAndCloseExaminationRoomBreakGlass');
const reviewCloseEnd = adminJs.indexOf('function bindExaminationRoomAdmin', reviewCloseStart);
const reviewCloseBlock = adminJs.slice(reviewCloseStart, reviewCloseEnd);
assert.ok(reviewCloseBlock.indexOf("operation: 'close_break_glass'")
  < reviewCloseBlock.indexOf("operation: 'record_break_glass_review'"),
'the grant must close before the mandatory post-access review is recorded');
assert.match(reviewCloseBlock, /session\.closedAt = closePayload\.result\.closedAt[\s\S]*session\.reviewRequired = true[\s\S]*session\.evidence = null/,
  'a closed-but-unreviewed grant must purge evidence and retain a narrow recovery state');
assert.match(adminJs, /evidence\.caseReference !== scope\.caseReference/);
assert.match(adminJs, /evidenceExpiryMs > authorizedExpiryMs/,
  'an evidence response cannot extend the exact grant expiry');
assert.match(adminJs, /reviewPayload\.result\.examId !== scope\.examId[\s\S]*reviewPayload\.result\.attemptId !== scope\.attemptId[\s\S]*reviewPayload\.result\.candidateNumber !== scope\.candidateNumber/);
assert.match(adminJs, /closePayload\.result\.examId !== scope\.examId[\s\S]*closePayload\.result\.attemptId !== scope\.attemptId[\s\S]*closePayload\.result\.candidateNumber !== scope\.candidateNumber/);
assert.match(adminJs, /state\.examinationRoomBreakGlass\.expiryTimer = global\.setTimeout/,
  'the evidence UI must rerender when its narrow grant expires');
assert.match(adminJs, /Restricted candidate evidence cannot be exported/);
assert.doesNotMatch(adminJs, /\/admin\/examination-room\/break-glass/);

assert.match(css, /\.exam-room-admin-tabs/);
assert.match(css, /\.exam-room-break-glass-form button:disabled/);
assert.match(css, /cursor:\s*not-allowed/);
assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.exam-room-break-glass-form/);

const publicRoleBlockStart = publicExamJs.indexOf('function examEntry');
const publicRoleBlockEnd = publicExamJs.indexOf('function bindExamEntry', publicRoleBlockStart);
const publicRoleBlock = publicExamJs.slice(publicRoleBlockStart, publicRoleBlockEnd);
assert.match(publicRoleBlock, /\['professor', 'Professor'/);
assert.match(publicRoleBlock, /\['beadle', 'Beadle'/);
assert.match(publicRoleBlock, /\['student', 'Student'/);
assert.match(publicRoleBlock, /\['admin', 'Admin'/);
assert.doesNotMatch(publicRoleBlock, /\['workplace'/i);
assert.doesNotMatch(publicExamJs, /operation: '(?:open_dispute|dispute_view|close_dispute)'/,
  'the public bundle must not carry the retired broad dispute operations');

console.log('Examination Room 2.0 Admin operations and break-glass gate tests passed.');
