import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [html, privateBetaCss, phase2, phase2Css, forum, forumCss, examinations, examinationsCss, admin, adminCss] = await Promise.all([
  read('index.html'),
  read('assets/private-beta-landing.css'),
  read('assets/phase2-experience.js'),
  read('assets/phase2.css'),
  read('assets/lex-forum.js'),
  read('assets/lex-forum.css'),
  read('assets/examinations.js'),
  read('assets/examinations.css'),
  read('admin/index.html'),
  read('admin/admin.css'),
]);

for (const id of [
  'terms-modal',
  'signin-prompt-modal',
  'session-choice-modal',
  'feedback-modal',
  'analytics-modal',
  'coming-soon-modal',
  'suggest-modal',
  'checking-modal',
]) {
  const idPosition = html.indexOf(`id="${id}"`);
  const start = html.lastIndexOf('<div class="modal-overlay', idPosition);
  const next = html.indexOf('<div class="modal-overlay', idPosition + id.length);
  const markup = html.slice(start, next > start ? next : html.indexOf('</div><!-- /authenticated-app-shell -->', idPosition));
  assert.ok(idPosition >= 0 && start >= 0 && markup, `${id} must remain present.`);
  assert.match(markup, /class="modal-close"[^>]*aria-label="Close/i, `${id} needs a labelled upper-right close control.`);
  assert.match(markup, /class="[^"]*modal-back[^"]*"[^>]*>Back<\/button>/, `${id} needs a Back action.`);
}

assert.match(html, /id="subject-selection-state"[\s\S]*?class="subject-selection-close"[\s\S]*?aria-label="Close subject selection and return to Mock Bar"[\s\S]*?class="btn-secondary subject-selection-back"[\s\S]*?>Back<\/button>/);
assert.match(html, /id="private-beta-dialog"[\s\S]*?id="pb-dialog-close"[\s\S]*?>×<\/button>/);
for (const id of ['pb-disclosure-continue', 'pb-code-submit', 'pb-google-intro-continue', 'pb-google-signin', 'pb-final-continue']) {
  const primary = html.indexOf(`id="${id}"`);
  assert.ok(primary > 0, `${id} must remain present.`);
  assert.ok(html.lastIndexOf('>Back</button>', primary) > html.lastIndexOf('<section class="pb-stage"', primary), `${id} needs a preceding Back action in its stage.`);
}

for (const [source, closeId, backId] of [
  [phase2, 'dd2-entry-close', 'dd2-entry-back'],
  [phase2, 'dd2-native-close', 'dd2-native-back'],
  [phase2, 'dd2-onboarding-close', 'dd2-onboarding-back'],
  [phase2, 'dd2-reminder-close', 'dd2-reminder-back'],
]) {
  assert.match(source, new RegExp(`id="${closeId}"[^>]*aria-label="Close`, 'i'));
  assert.match(source, new RegExp(`id="${backId}"[^>]*>Back<\\/button>`));
}

assert.match(forum, /button\('×', 'lex-dialog-close', closeDialog\)/);
assert.match(forum, /back = button\('Back', 'lex-button', closeDialog\)/);
assert.match(examinations, /aria-label="Close time-mode selection"[\s\S]*?data-dialog-cancel>Back<\/button>/);
assert.match(examinations, /aria-label="Close Human Examiner invitation"[\s\S]*?data-dialog-cancel>Back<\/button>/);
assert.match(examinations, /aria-label="Close extracted question preview"[\s\S]*?data-upload-cancel>Back<\/button>/);

for (const id of ['action-dialog', 'audit-dialog', 'insight-dialog']) {
  const start = admin.indexOf(`<dialog${id === 'insight-dialog' ? ' class="insight-dialog"' : ''} id="${id}"`);
  const end = admin.indexOf('</dialog>', start);
  const markup = admin.slice(start, end + 9);
  assert.ok(start >= 0 && end > start, `${id} must remain present.`);
  assert.match(markup, /class="icon-button"[^>]*aria-label="Close/i, `${id} needs an upper-right close control.`);
  assert.match(markup, /class="secondary-button"[^>]*>Back<\/button>/, `${id} needs a lower-right Back action.`);
}

for (const css of [html, privateBetaCss, phase2Css, forumCss, examinationsCss, adminCss]) {
  assert.match(css, /44px/, 'Every dialog design surface must retain a 44px touch target rule.');
  assert.match(css, /focus-visible/, 'Every dialog design surface must expose a keyboard focus rule.');
}

assert.match(html, /function exitSubjectSelection\(\)\s*\{[\s\S]*?pendingSubjectSelection = null;[\s\S]*?showWelcome\(\);[\s\S]*?\}/);
assert.match(html, /function showWelcome\(options = \{\}\)[\s\S]*?stopExamSession\(\{ reset: true \}\)[\s\S]*?currentSubj = null;[\s\S]*?selectedSessionMode = null;/);
assert.match(html, /function returnFromModal\(id\)[\s\S]*?closeModal\(id\)/);
assert.match(html, /event\.key === 'Escape'[\s\S]*?returnFromModal/);

console.log('Applicable non-Examination-Room dialogs expose professional upper-right close and lower-right Back controls.');
