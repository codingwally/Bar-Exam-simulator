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

console.log('Examination Room 2.0 visual preview contracts passed.');
