import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

const [
  html,
  phase2,
  examinations,
  quorum,
  quorumStyles,
  timerMigration,
] = await Promise.all([
  read('index.html'),
  read('assets/phase2-experience.js'),
  read('assets/examinations.js'),
  read('assets/lex-forum.js'),
  read('assets/lex-forum.css'),
  read('supabase/migrations/20260806_016_active_time_and_accessibility_hardening.sql'),
]);

// Sign-in entry points must tell the truth: protected examination access is
// authenticated, while any future guest path must be an explicit opt-in.
assert.match(phase2, /const allowGuest = options\.allowGuest === true && !completed;/);
assert.match(phase2, /showEntry\(\{\s*allowDismiss:\s*true\s*\}\)/);

// Published controls must work now or be rendered honestly as non-controls.
assert.doesNotMatch(html, /exportProgressPDF/);
assert.match(html, /Downloadable Verdict reports are not yet available/);

// Browser shortcuts remain available outside the answer editor.
assert.doesNotMatch(html, /function enableSecurity\(/);
assert.doesNotMatch(html, /\benableSecurity\(\);/);
assert.match(html, /box\.addEventListener\('paste'/);

// Static dialogs expose semantics and complete keyboard focus sets.
for (const dialogId of ['feedback-modal', 'analytics-modal', 'suggest-modal']) {
  assert.match(
    html,
    new RegExp(`id="${dialogId}"[^>]*role="dialog"[^>]*aria-modal="true"`),
    `${dialogId} must identify itself as a modal dialog.`,
  );
}
assert.match(html, /select:not\(\[disabled\]\)/);
assert.match(html, /id="checking-card"[^>]*tabindex="-1"/);

// The exact premium treatment survives the narrow mobile navigation override.
assert.match(
  html,
  /@media\s*\(max-width:\s*700px\)[\s\S]*?\.spa-tab\.btn-angel\s*\{[\s\S]*?linear-gradient\(120deg,#B8860B,#F5E28C 45%,#D4AF37 60%,#B8860B\)/,
);

// Quorum navigation must encode the exact visible view and restore it.
assert.match(quorum, /quorumView/);
assert.match(quorum, /history\[method\]/);
assert.match(quorum, /restoreRoute/);

// Approved public actions are Affirm, Comment, Disseminate, and Save.
assert.match(quorum, /Disseminate/);
assert.doesNotMatch(quorum, /Cite \/ Send/);
assert.doesNotMatch(quorum, /create_simple_entry/);
assert.match(quorum, /command\('create_entry'/);
assert.match(quorum, /document\.createElement\('details'\)/);
assert.match(quorum, /overflow\.className = 'quorum-overflow'/);
assert.match(
  quorumStyles,
  /#page-community \.lex-composer-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
);
assert.match(
  quorumStyles,
  /#page-community #lex-post-submit\s*\{[\s\S]*?min-width:\s*0;/,
);
assert.match(
  quorumStyles,
  /#page-community \.lex-feed\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
);
assert.match(
  quorumStyles,
  /#page-community \.lex-post-card\s*\{[\s\S]*?min-width:\s*0;/,
);
for (const retiredCopy of [
  'Search entries',
  'Sort entries',
  'Load more entries',
  'No Quorum entries',
  'Loading Quorum entries',
  'Private saved entries',
  'public entries',
  'No matching entries',
]) {
  assert.doesNotMatch(`${html}\n${quorum}`, new RegExp(retiredCopy));
}

// Drafts are isolated by authenticated UUID and are reset on session changes.
assert.match(quorum, /function draftKey\(/);
assert.match(quorum, /session\(\)\?\.user\?\.id/);
assert.match(quorum, /resetComposerForSession/);

// Affirm choices have real menu keyboard behavior.
for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
  assert.match(quorum, new RegExp(key));
}
assert.match(quorum, /aria-current/);

// Leaving an active examination must flush a draft and require an explicit
// choice; hidden or signed-out time must not continue the active-time clock.
assert.match(examinations, /async function returnCatalog\(/);
assert.match(examinations, /await flushCurrentSave\(\)/);
assert.match(examinations, /visibilitychange/);
assert.match(examinations, /pauseActiveClock/);
assert.match(
  examinations,
  /if \(state\.active && \['room', 'review'\]\.includes\(state\.screen\)\) saveRecovery\(\);/,
);

// The additive migration corrects self-paced elapsed time on the server while
// preserving strict/server-running timer semantics.
assert.match(timerMigration, /examination_active_elapsed_seconds/);
assert.match(timerMigration, /timer_mode <> 'selfPaced'/);
assert.match(timerMigration, /<= 45/);
assert.match(timerMigration, /create trigger examination_active_time_guard/);
assert.match(timerMigration, /revoke all on function public\.examination_active_elapsed_seconds/);

console.log('AFK production-debug regression contracts passed.');
