import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, js, css, build] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
]);

assert.match(html, /assets\/duediligence-2026\.css/);
assert.match(html, /assets\/duediligence-2026\.js/);
assert.match(build, /assets\/duediligence-2026\.css/);
assert.match(build, /assets\/duediligence-2026\.js/);

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

assert.match(js, /maxlength="5000"/);
assert.match(js, /maxlength="3000"/);
assert.match(js, /maxlength="20000"/);
assert.match(js, /maxlength="5000"/);
assert.match(js, /id="dd26-exam-title" maxlength="200"/);
assert.match(js, /id="dd26-exam-instructions" maxlength="10000"/);
assert.match(js, /id="dd26-exam-count" type="number" min="1" step="1"/);
assert.doesNotMatch(js, /id="dd26-exam-count"[^>]*max=/);
assert.match(js, /attempt\.questions\.length/);
assert.match(js, /preview\.questions\.length/);

assert.match(js, /Your answer text and Gemini explanation are not saved/);
assert.match(js, /Your answer text is not saved\. Only your thumbs-up or thumbs-down mastery result is recorded/);
assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
assert.match(js, /snapshot\?\.flags\?\.\[flag\] !== true/);
assert.match(js, /AI-prepared beta/);

assert.match(js, /readonly aria-readonly="true"/);
assert.match(js, /operation: 'dispute_view'/);
assert.match(js, /operation: 'close_dispute'/);
assert.match(js, /Open isolated Google backup/);
assert.match(js, /Original exam and grading keys remain revoked/);
assert.match(js, /open_book/);
assert.match(js, /operation: 'live_status'/);
assert.match(js, /data-dd26-monitor-exam/);
assert.match(js, /visibility_exit/);
assert.match(js, /focus_exit/);
assert.match(js, /context_menu_attempt/);
assert.match(js, /contextmenu/);
assert.match(js, /visibilitychange/);
assert.match(js, /fullscreenchange/);
assert.match(js, /A browser cannot detect every outside device or operating-system action/);

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
