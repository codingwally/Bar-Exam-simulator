import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [
  html,
  privateBetaCss,
  phase2,
  phase2Css,
  forum,
  forumCss,
  examinations,
  examinationsCss,
  admin,
  adminCss,
  room,
  roomCss,
] = await Promise.all([
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
  read('assets/duediligence-2026.js'),
  read('assets/duediligence-2026.css'),
]);

for (const id of [
  'terms-modal',
  'signin-prompt-modal',
  'session-choice-modal',
  'feedback-modal',
  'coming-soon-modal',
  'suggest-modal',
  'checking-modal',
  'decision-modal',
]) {
  const idPosition = html.indexOf(`id="${id}"`);
  const start = html.lastIndexOf('<div class="modal-overlay', idPosition);
  const next = html.indexOf('<div class="modal-overlay', idPosition + id.length);
  const fallbackEnd = html.indexOf('</div><!-- /authenticated-app-shell -->', idPosition);
  const markup = html.slice(start, next > start ? next : fallbackEnd);
  assert.ok(idPosition >= 0 && start >= 0 && markup, `${id} must remain present.`);
  assert.match(markup, /class="[^"]*\bmodal-close\b[^"]*"[^>]*aria-label="Close/i, `${id} needs a labelled upper-right close control.`);
  assert.match(markup, /class="[^"]*modal-back[^"]*"[^>]*>Back<\/button>/, `${id} needs a lower-right Back action.`);
}

assert.match(html, /id="subject-selection-state"[\s\S]*?class="subject-selection-close"[\s\S]*?aria-label="Close subject selection and return to Bar Question Practice"[\s\S]*?class="btn-secondary subject-selection-back"[\s\S]*?>Back<\/button>/);
assert.match(html, /id="private-beta-dialog"[\s\S]*?id="pb-dialog-close"[\s\S]*?>×<\/button>/);
for (const id of ['pb-disclosure-continue', 'pb-code-submit', 'pb-google-intro-continue', 'pb-google-signin', 'pb-final-continue']) {
  const primary = html.indexOf(`id="${id}"`);
  assert.ok(primary > 0, `${id} must remain present.`);
  assert.ok(html.lastIndexOf('>Back</button>', primary) > html.lastIndexOf('<section class="pb-stage"', primary), `${id} needs a preceding Back action in its stage.`);
}

for (const [closeId, backId] of [
  ['dd2-entry-close', 'dd2-entry-back'],
  ['dd2-native-close', 'dd2-native-back'],
  ['dd2-onboarding-close', 'dd2-onboarding-back'],
  ['dd2-reminder-close', 'dd2-reminder-back'],
]) {
  assert.match(phase2, new RegExp(`id="${closeId}"[^>]*aria-label="Close`, 'i'));
  assert.match(phase2, new RegExp(`id="${backId}"[^>]*>Back<\\/button>`));
}

assert.match(forum, /button\('×', 'lex-dialog-close', closeDialog\)/);
assert.match(forum, /back = button\('Back', 'lex-button', closeDialog\)/);
assert.match(examinations, /aria-label="Close time-mode selection"[\s\S]*?data-dialog-cancel>Back<\/button>/);
assert.match(examinations, /aria-label="Close Human Examiner assignment"[\s\S]*?data-dialog-cancel>Back<\/button>/);
assert.match(examinations, /Automated email delivery is disabled[\s\S]*?Examiner email \(assignment record\)/);
assert.match(examinations, /result\.assignmentUrl[\s\S]*?data-copy-human-assignment[\s\S]*?navigator\.clipboard\.writeText\(assignmentUrl\)/);
assert.match(examinations, /candidate\.origin !== fallback\.origin[\s\S]*?candidate\.searchParams\.get\('assignment'\) !== assignmentToken[\s\S]*?candidate\.hash !== '#examiner-review'/,
  'The returned manual link must remain same-origin and bound to the generated token.');
assert.match(examinations, /Assignment created\. No email was sent\./);
assert.doesNotMatch(examinations, /Examiner invitation sent|No answer or model answer is attached to email/);
const humanAssignmentStart = examinations.indexOf('async function createHumanAssignment');
const humanAssignmentEnd = examinations.indexOf('\n  function assessmentList', humanAssignmentStart);
const humanAssignment = examinations.slice(humanAssignmentStart, humanAssignmentEnd);
assert.ok(humanAssignmentStart >= 0 && humanAssignmentEnd > humanAssignmentStart);
assert.doesNotMatch(humanAssignment, /humanDialog\(\)\.close\(\)/,
  'The manual secure link must remain visible after it is created.');
assert.match(humanAssignment, /emailInput\.readOnly = true[\s\S]*?button\.textContent = 'Assignment link created'/);
assert.match(humanAssignment, /linkInput\.focus\(\)[\s\S]*?linkInput\.select\(\)/,
  'Clipboard failures must leave the secure link visibly selected for manual copying.');
assert.match(examinations, /Human Examiner Review finalized and saved at[\s\S]*?No automated email was sent/);
assert.doesNotMatch(examinations, /Student notification status|studentNotificationStatus/);
assert.match(examinations, /aria-label="Close extracted question preview"[\s\S]*?data-upload-cancel>Back<\/button>/);
assert.match(examinations, /id = 'dd-exam-decision-dialog'[\s\S]*?aria-label="Close confirmation and go back"[\s\S]*?>Back<\/button>/);

for (const id of ['action-dialog', 'audit-dialog', 'insight-dialog']) {
  const start = admin.indexOf(`<dialog${id === 'insight-dialog' ? ' class="insight-dialog"' : ''} id="${id}"`);
  const end = admin.indexOf('</dialog>', start);
  const markup = admin.slice(start, end + 9);
  assert.ok(start >= 0 && end > start, `${id} must remain present.`);
  assert.match(markup, /class="icon-button"[^>]*aria-label="Close/i, `${id} needs an upper-right close control.`);
  assert.match(markup, /class="secondary-button"[^>]*>Back<\/button>/, `${id} needs a lower-right Back action.`);
}
const verdictStart = room.indexOf('function openVerdictExport');
const verdictEnd = room.indexOf('\n  function ', verdictStart + 30);
const verdict = room.slice(verdictStart, verdictEnd);
assert.match(verdict, /class="dd26-verdict-close"[^>]*aria-label="Close private Analytics export"/);
assert.match(verdict, /data-dd26-close-dialog type="button">Back<\/button>/);
assert.match(room, /function openDialog\(content, options = \{\}\)[\s\S]*?class="dd26-dialog-close"[\s\S]*?back\.textContent = 'Back'/);

for (const css of [html, privateBetaCss, phase2Css, forumCss, examinationsCss, adminCss, roomCss]) {
  assert.match(css, /44px/, 'Every dialog design surface must retain a 44px touch-target rule.');
  assert.match(css, /focus-visible/, 'Every dialog design surface must expose a keyboard focus rule.');
}

assert.doesNotMatch(html, /window\.confirm|global\.confirm/);
assert.doesNotMatch(examinations, /window\.confirm|global\.confirm/);
assert.doesNotMatch(phase2, /window\.confirm|global\.confirm/);
assert.doesNotMatch(forum, /window\.confirm|global\.confirm/);
assert.match(html, /function confirmWithDueDiligence\([\s\S]*?new Promise/);
assert.match(html, /function returnFromModal\(id\)[\s\S]*?settleDecision\(false\)/);
assert.match(html, /event\.key === 'Escape'[\s\S]*?returnFromModal/);
assert.match(examinations, /function confirmDecision\([\s\S]*?new Promise/);
assert.match(examinations, /selection\.exhausted[\s\S]*?await confirmDecision/);
assert.match(examinations, /async function returnCatalog\([\s\S]*?await confirmDecision/);

console.log('All Due Diligence custom dialogs expose professional upper-right close and lower-right Back controls.');
