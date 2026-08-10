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

assert.match(html, /Admin created a key for this Professor and this Examination Room/);
assert.match(html, /The Professor gives the Beadle access/);
assert.match(html, /Students do not receive a Professor room key/);
assert.match(html, /the Professor or Beadle gives it to the class/i);

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

console.log('Examination Room 2.0 visual preview contracts passed.');
