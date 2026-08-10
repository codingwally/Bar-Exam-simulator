import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, script] = await Promise.all([
  readFile(new URL('docs/evidence/examination-room-2.0/preview.html', root), 'utf8'),
  readFile(new URL('docs/evidence/examination-room-2.0/preview.js', root), 'utf8'),
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
assert.match(html, /student exam code from the Beadle/i);

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
assert.match(beadlePanel, /Save class list and prepare student code/);
assert.match(beadlePanel, /id="qa-student-exam-code"/);
assert.match(beadlePanel, /student exam code is different from the Beadle key and the Professor grading key/i);
assert.match(beadlePanel, /Copy complete class handout/);
assert.doesNotMatch(beadlePanel, /data-open-view="student"/,
  'every path to the Student page must pass through the sign-in check');

const studentPanel = html.match(/<section class="dd26-shell" data-view-panel="student"[\s\S]*?<section class="dd26-shell" data-view-panel="professor-after"/)?.[0] || '';
assert.match(studentPanel, /id="qa-student-entry-code"/);
assert.match(studentPanel, /Signed-in student/);
assert.match(studentPanel, /Start examination/);
assert.match(studentPanel, /Submission receipt/);

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

console.log('Examination Room 2.0 visual preview contracts passed.');
