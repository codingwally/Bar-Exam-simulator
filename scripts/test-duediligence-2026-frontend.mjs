import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, js, css, build, store] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/examination-room-2-store.js', root), 'utf8'),
]);

assert.match(html, /assets\/duediligence-2026\.css/);
assert.match(html, /assets\/duediligence-2026\.js/);
assert.match(build, /assets\/duediligence-2026\.css/);
assert.match(build, /assets\/duediligence-2026\.js/);
assert.match(html, /assets\/examination-room-2-store\.js/);
assert.match(build, /assets\/examination-room-2-store\.js/);

for (const [id, handler] of [
  ['spa-bar-easy', 'openBarEasy'],
  ['spa-chairs-case', 'openChairCases'],
  ['spa-jurisprudence', 'openDoctrines'],
  ['spa-case-digest', 'openAnchorCases'],
  ['spa-examination-room', 'openExaminationRoom'],
]) {
  assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?onclick="${handler}\\(\\)"`));
  assert.match(js, new RegExp(`global\\.${handler} =`));
}

for (const route of ['bar-easy', 'chairs-cases', 'doctrines', 'anchor-case-digests', 'examination-room']) {
  assert.match(js, new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
}

assert.match(
  js,
  /global\.addEventListener\('duediligence:session',[\s\S]*event\.detail\?\.authenticated[\s\S]*routeFromHash\(\)[\s\S]*open\('exam_room'/,
  'protected 2026 routes must retry after the persisted authentication session becomes ready',
);

assert.match(js, /maxlength="5000"/);
assert.match(js, /maxlength="3000"/);
assert.match(js, /maxlength="20000"/);
assert.match(js, /maxlength="5000"/);
assert.match(js, /id="dd26-exam-title" maxlength="200"/);
assert.match(js, /id="dd26-exam-instructions" maxlength="10000"/);
assert.match(js, /id="dd26-exam-count" type="number" min="1" max="200" step="1"/);
assert.match(js, /attempt\.questions\.length/);
assert.match(js, /preview\.questions\.length/);

assert.match(js, /Your answer text and Gemini explanation are not saved/);
assert.match(js, /Your answer text is not saved\. Only your thumbs-up or thumbs-down mastery result is recorded/);
assert.doesNotMatch(js, /localStorage|sessionStorage/);
assert.match(store, /indexedDB/);
assert.doesNotMatch(store, /localStorage|sessionStorage/);
assert.match(js, /snapshot\?\.flags\?\.\[flag\] !== true/);
assert.match(js, /AI-prepared beta/);

assert.match(js, /readonly aria-readonly="true"/);
assert.doesNotMatch(js, /operation: '(?:open_dispute|dispute_view|close_dispute)'/,
  'the public bundle must not expose the retired broad dispute viewer');
assert.match(js, /open_book/);
assert.match(js, /operation: 'live_status_v2'/);
assert.match(js, /data-dd26-monitor-exam/);
assert.match(js, /visibility_exit/);
assert.match(js, /focus_exit/);
assert.doesNotMatch(js, /context_menu_attempt/);
assert.doesNotMatch(js, /preventExamAction|addEventListener\('contextmenu'/);
assert.match(js, /addEventListener\('copy', clipboardIncident, true\)/);
assert.match(js, /addEventListener\('cut', clipboardIncident, true\)/);
assert.match(js, /addEventListener\('paste', clipboardIncident, true\)/);
assert.match(js, /copy_attempt/);
assert.match(js, /paste_attempt/);
assert.match(js, /visibilitychange/);
assert.match(js, /fullscreenchange/);
assert.match(js, /not proof by themselves/);
assert.doesNotMatch(js, /leak[- ]?proof/i);
assert.match(js, /\['professor', 'Professor'[\s\S]*\['beadle', 'Beadle'[\s\S]*\['student', 'Student'[\s\S]*\['admin', 'Admin'/);
assert.match(js, /Submission pending — not yet received by Due Diligence/);
assert.match(js, /Saved on this device/);
assert.match(js, /Synced at/);

assert.match(js, /openVerdictExport/);
assert.match(js, /selectionKind/);
assert.match(js, /selectedIds/);
assert.match(html, /openVerdictExport/);
assert.match(css, /#031a33/);
assert.match(css, /#c5a059/i);
assert.match(css, /'Playfair Display'/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /animation-duration:\.01ms!important/);

console.log('DueDiligence 2026 frontend contracts passed.');
