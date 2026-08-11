import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, script, operations] = await Promise.all([
  readFile(new URL('docs/evidence/examination-room-2.0/preview.html', root), 'utf8'),
  readFile(new URL('docs/evidence/examination-room-2.0/preview.js', root), 'utf8'),
  readFile(new URL('docs/examination-room-2.0-operations.md', root), 'utf8'),
]);

const rolePanel = html.match(/<section class="dd26-shell" data-view-panel="roles">[\s\S]*?<\/section>/)?.[0] || '';
assert.equal((rolePanel.match(/class="dd26-role-card"/g) || []).length, 4,
  'the Examination Room entry must contain exactly four role choices');
for (const role of ['Professor', 'Beadle', 'Student', 'Admin']) {
  assert.match(rolePanel, new RegExp(`<strong>${role}</strong>`));
}
assert.doesNotMatch(html, /qa-nav-shell|qa-view-tabs|data-view=/,
  'the local QA page must not restore the removed six-button navigation strip');

for (const stage of [
  'Admin opens the room',
  'Professor publishes',
  'Beadle prepares the class',
  'Students take the exam',
  'Professor grades',
  'Professor releases results',
]) {
  assert.match(rolePanel, new RegExp(stage));
}
assert.equal((rolePanel.match(/<b>Stage [1-6]<\/b>/g) || []).length, 6,
  'the role entry must show the complete six-stage classroom flow');

assert.match(rolePanel, /data-student-entry/);
assert.doesNotMatch(rolePanel, /data-student-entry[^>]*data-open-view/,
  'the Student choice must not open the examination page before the preview sign-in check');
assert.match(script, /Student sign-in is required before the examination page opens/);
assert.match(script, /data-student-entry[\s\S]*Sign in and continue \(demo\)[\s\S]*showView\('student'/);

assert.doesNotMatch(html, /\bmetadata\b|roster-controlled/i);
assert.match(rolePanel, /class list/);
assert.match(rolePanel, /copy, cut, and paste are blocked/);
assert.match(rolePanel, /Leaving the exam tab is recorded/);
assert.doesNotMatch(rolePanel, /leak[- ]proof/i);
assert.match(script, /\['copy', 'cut', 'paste'\][\s\S]*event\.preventDefault\(\)/);

assert.match(html, /One Admin room key opened this Examination Room for this Professor/);
assert.match(html, /The Professor sends the Beadle key after publishing/);
assert.match(html, /Students do not receive a Professor room key/);
assert.match(html, /class examination code/i);

const professorPanel = html.match(/<section class="dd26-shell" data-view-panel="professor-authoring"[\s\S]*?<section class="dd26-shell" data-view-panel="beadle"/)?.[0] || '';
assert.match(professorPanel, /Publish and get Beadle key/);
assert.match(professorPanel, /id="qa-beadle-key"/);
assert.match(professorPanel, /Send this to the Beadle/);
assert.match(professorPanel, /It is not the student exam code/);
assert.doesNotMatch(professorPanel, /id="qa-student-exam-code"/,
  'the Professor publication result must not generate the student exam code');

const beadlePanel = html.match(/<section class="dd26-shell" data-view-panel="beadle"[\s\S]*?<section class="dd26-shell" data-view-panel="student"/)?.[0] || '';
for (const state of ['entry', 'roster', 'handout', 'attention']) {
  assert.match(beadlePanel, new RegExp(`data-state-panel="beadle:${state}"`));
}
assert.match(beadlePanel, /id="qa-beadle-entry-key"/);
assert.match(beadlePanel, /Confirm class list and finish/);
assert.doesNotMatch(beadlePanel, /id="qa-student-exam-link"|Student examination link/,
  'the Beadle flow must not require or distribute an examination link');
assert.match(beadlePanel, /id="qa-student-exam-code"/);
assert.match(beadlePanel, /queued one private email for every listed student/);
assert.equal((beadlePanel.match(/>Copy class code</g) || []).length, 1,
  'the Beadle completion screen may provide one optional class-code copy action');
assert.doesNotMatch(beadlePanel, /Record identity check|Allow entry|Move to new device/);
assert.doesNotMatch(beadlePanel, /Copy student exam code|Copy complete class handout|shown once/i);
assert.doesNotMatch(beadlePanel, /data-open-view="student"/,
  'every path to the Student page must pass through the sign-in check');

const studentPanel = html.match(/<section class="dd26-shell" data-view-panel="student"[\s\S]*?<section class="dd26-shell" data-view-panel="professor-after"/)?.[0] || '';
assert.match(studentPanel, /id="qa-student-entry-code"/);
assert.match(studentPanel, /No examination link or separate reference is required/);
assert.match(studentPanel, /Signed-in student/);
assert.match(studentPanel, /data-state-panel="student:waiting"/);
assert.match(studentPanel, /id="qa-enter-waiting-room"[^>]*disabled>Enter waiting room/);
assert.match(studentPanel, /id="qa-student-code-check"/);
assert.match(studentPanel, /id="qa-student-waiting-tab"[^>]*aria-disabled="true"[^>]*disabled/);
assert.match(studentPanel, /id="qa-student-workspace-tab"[^>]*data-requires-exam-open disabled/);
assert.match(studentPanel, /id="qa-waiting-server-time"/);
assert.match(studentPanel, /id="qa-waiting-countdown">00:05:00/);
assert.match(studentPanel, /role="timer" aria-label="Time until examination questions open"/);
const waitingPanel = studentPanel.match(/<div data-state-panel="student:waiting"[\s\S]*?<div data-state-panel="student:workspace"/)?.[0] || '';
assert.equal((waitingPanel.match(/<li>/g) || []).length, 5,
  'the waiting room must present five readable numbered instructions');
assert.match(waitingPanel, /No question, answer field, or attempt session is available/);
assert.match(waitingPanel, /id="qa-open-examination"[^>]*disabled>Start examination when open/);
assert.doesNotMatch(waitingPanel, /id="qa-student-prompt"|id="qa-student-answer"/,
  'question and answer content must remain outside the early waiting room');
assert.match(studentPanel, /Submission receipt/);

assert.match(script, /function updateStudentEarlyEntryState\(\)[\s\S]*enteredCode === 'EVID-8K3J-7M2Q'[\s\S]*acknowledgment\.checked && codeMatches/,
  'waiting-room entry must require both the Beadle code and the student acknowledgment');
assert.match(script, /qa-student-ack'\)\.addEventListener\('change', updateStudentEarlyEntryState\)/);
assert.match(script, /qa-student-entry-code'\)\.addEventListener\('input', updateStudentEarlyEntryState\)/);
assert.match(script, /qa-enter-waiting-room[\s\S]*showState\('student', 'waiting'[\s\S]*startWaitingRoomCountdown\(\)/);
assert.match(script, /function setWaitingRoomOpen\(open\)[\s\S]*\[data-requires-exam-open\][\s\S]*button\.disabled = !waitingRoomIsOpen/);
assert.match(script, /function updateWaitingRoomCountdown\(\)[\s\S]*waitingRoomOpeningMs - serverNow[\s\S]*setWaitingRoomOpen\(true\)/);
assert.match(script, /qa-open-examination[\s\S]*if \(!waitingRoomIsOpen\)[\s\S]*showState\('student', 'workspace'/,
  'the preview must not open the attempt before the server-time gate opens');
assert.doesNotMatch(script, /qa-start-exam/);

const professorAfterPanel = html.match(/<section class="dd26-shell" data-view-panel="professor-after"[\s\S]*?<section class="dd26-shell" data-view-panel="admin"/)?.[0] || '';
assert.match(professorAfterPanel, /data-state-panel="professor-after:monitor"/);
assert.match(professorAfterPanel, /data-state-panel="professor-after:grading"/);
assert.match(professorAfterPanel, /data-state-panel="professor-after:results"/);
assert.match(professorAfterPanel, /id="qa-send-result-confirm"/);
assert.match(professorAfterPanel, /id="qa-send-result-button"[^>]*disabled/);
assert.match(professorAfterPanel, /id="qa-download-result-button"/);
for (const packageName of ['Questions and answers', 'Answers only', 'Grade and comments only']) {
  assert.match(professorAfterPanel, new RegExp(packageName));
}
assert.match(professorAfterPanel, /Nothing is sent or downloaded automatically/);

const adminPanel = html.match(/<section class="dd26-shell" data-view-panel="admin"[\s\S]*?<\/main>/)?.[0] || '';
assert.match(adminPanel, /data-state-panel="admin:room-keys"/);
assert.match(adminPanel, /id="qa-room-key-form"/);
assert.match(adminPanel, /One key opens one Examination Room/);
assert.match(adminPanel, /another room, Admin creates another key/);
for (const heading of ['Examination Room', 'Professor', 'Status', 'Created by', 'Used by', 'Expires', 'Action']) {
  assert.match(adminPanel, new RegExp(`<th>${heading}</th>`));
}

const keyRecords = html.match(/<tbody id="qa-room-key-records">[\s\S]*?<\/tbody>/)?.[0] || '';
assert.ok(keyRecords, 'the Admin preview must render the Professor key record list');
assert.doesNotMatch(keyRecords, /ROOM-[A-Z0-9-]+|dd26-raw-key/,
  'the Admin key record list must never retain a full Professor key');
assert.match(html, /id="qa-professor-key-dialog"/);
assert.match(html, /Shown only once/);
assert.match(script, /generateProfessorRoomKey/);
assert.match(script, /appendProfessorRoomKeyRecord\(details\);[\s\S]*openProfessorRoomKeyDialog\(details\)/);
assert.match(script, /clearProfessorRoomKeyDialog[\s\S]*activeProfessorRoomKey = ''[\s\S]*qa-professor-key-value/);
assert.match(script, /showState\('admin', 'room-keys', false\)/);
assert.match(script, /showState\('beadle', 'entry', false\)/);
assert.match(script, /data-beadle-next[\s\S]*showState\('beadle'/);
assert.match(script, /qa-send-result-confirm[\s\S]*qa-send-result-button/);
assert.match(script, /qa-download-result-button[\s\S]*qa-result-package/);

for (const heading of ['#### Professor', '#### Beadle', '#### Student', '#### Where each key comes from']) {
  assert.match(operations, new RegExp(heading));
}
assert.match(operations, /#### Early student waiting room/);
assert.match(operations, /successful checks place the student in the waiting room only/);
assert.match(operations, /Due Diligence server time, a countdown to opening/);
assert.match(operations, /Questions, answer fields, and the attempt remain closed/);
assert.match(operations, /Due Diligence, when the Beadle confirms a valid class list/);
assert.match(operations, /queues one private email per validated student/);
assert.match(operations, /separate class-results release action/i);
assert.doesNotMatch(`${html}\n${script}\n${operations}`, /STUDENT_ACCESS_ISSUED/,
  'raw server status codes must not appear in classroom instructions');

console.log('Examination Room 2.0 visual preview contracts passed.');
