import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [
  html,
  client,
  css,
  adminHtml,
  adminClient,
  worker,
  core,
  migration,
  preflight,
  structural,
  behavioral,
  phase2,
  releaseMigration,
] = await Promise.all([
  fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../assets/lex-forum.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../worker/forum-core.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260803_012_quorum_complete.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/review/quorum_production_preflight.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/tests/20260803_013_quorum_structural_test.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/tests/20260803_014_quorum_behavioral_security_test.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260805120000_complete_beta_release_foundation.sql', import.meta.url), 'utf8'),
]);

assert.match(html, /id="spa-community"[\s\S]*?>Quorum<\/button>/);
assert.match(html, /<h2>Quorum<\/h2>/);
assert.match(
  html,
  /The floor is yours—speak your mind, ask questions, share your law school journey, and learn together\./,
);
assert.match(html, /Quorum Feed/);
assert.match(html, /Saved/);
assert.match(html, /Study Circles/);
assert.match(html, /Trending in Quorum/);
assert.match(html, /Questions Needing Answers/);
assert.match(client, /Practice this issue/);
assert.match(adminHtml, /Quorum Moderation/);
assert.match(adminClient, /Quorum Moderation & Analytics/);

for (const obsolete of [
  /Lex Forum/,
  /Due Diligence Commons/,
  /Commons Feed/,
  /Under Construction/,
  /Coming Soon/,
  /Publishing unavailable/,
]) {
  for (const [label, source] of [
    ['public HTML', html],
    ['Quorum client', client],
    ['admin HTML', adminHtml],
  ]) {
    assert.doesNotMatch(source, obsolete, `${label} must not expose obsolete product language.`);
  }
}

for (const id of [
  'lex-forum-app',
  'lex-composer',
  'lex-post-body',
  'lex-post-submit',
  'lex-feed',
  'quorum-search-form',
  'quorum-entry-type',
  'quorum-entry-category',
  'quorum-entry-subject',
  'quorum-entry-image',
  'quorum-entry-preview',
  'quorum-entry-cancel',
  'quorum-feed-sort',
  'quorum-active-issues',
  'quorum-unanswered',
  'quorum-recommended-circles',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} must be rendered.`);
}

for (const operation of [
  'update_entry',
  'delete_entry',
  'set_helpful',
  'create_comment',
  'update_comment',
  'delete_comment',
  'create_repost',
  'delete_repost',
  'set_saved',
  'create_report',
  'set_block',
  'create_circle',
  'join_circle',
  'leave_circle',
  'archive_circle',
  'update_profile_settings',
  'mark_notification',
  'mark_all_notifications',
  'create_simple_entry',
  'set_affirm',
]) {
  assert.match(client, new RegExp(`['"]${operation}['"]`), `${operation} must be wired in the Quorum client.`);
}

for (const route of ['/quorum/query', '/quorum/command', '/admin/quorum']) {
  assert.match(worker, new RegExp(`pathname === '${route.replaceAll('/', '\\/')}'`), `${route} must be handled by the Worker.`);
}
assert.match(client, /api\('\/quorum\/query'/);
assert.match(client, /api\('\/quorum\/command'/);
assert.match(client, /\$\('#quorum-notification-count'\)\.textContent = unreadCount/);
assert.match(client, /allowDismiss:\s*true/);
assert.match(phase2, /id="dd2-entry-close"/);
assert.match(phase2, /options\.allowDismiss === true/);
assert.match(phase2, /entryOverlay\.dataset\.dismissible === 'true'/);
assert.match(phase2, /event\.key === 'Escape'[\s\S]*closeEntry\(\)/);
assert.doesNotMatch(client, /from\(['"]forum_/i, 'The browser must not query Quorum tables directly.');
assert.doesNotMatch(client, /service[_-]?role/i, 'The browser must not contain service-role access.');

for (const table of [
  'forum_profile_settings',
  'forum_study_circles',
  'forum_circle_members',
  'forum_saved_entries',
  'forum_user_blocks',
  'forum_entry_indicators',
  'forum_post_attachments',
  'forum_notifications',
  'forum_telemetry_events',
]) {
  assert.match(migration, new RegExp(`public\\.${table}`), `${table} must exist in the migration.`);
  assert.match(structural, new RegExp(table), `${table} must be structurally tested.`);
}

for (const fn of ['forum_quorum_query', 'forum_quorum_command', 'forum_quorum_admin']) {
  assert.match(migration, new RegExp(`function public\\.${fn}`), `${fn} must exist.`);
  assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`), `${fn} must be browser-denied.`);
  assert.match(structural, new RegExp(fn), `${fn} must be structurally tested.`);
}
for (const fn of [
  'forum_quorum_insights',
  'forum_affirm_roster',
  'forum_set_affirm',
  'forum_publish_simple',
  'forum_set_attachment_alt',
]) {
  assert.match(releaseMigration, new RegExp(`function public\\.${fn}`), `${fn} must exist.`);
  assert.match(
    releaseMigration,
    new RegExp(`revoke all on function public\\.${fn}`),
    `${fn} must remain browser-denied.`,
  );
}

assert.match(
  migration,
  /values\s*\(\s*'quorum-images'\s*,\s*'quorum-images'\s*,\s*false/,
);
assert.match(migration, /file_size_limit[\s\S]*3145728/);
assert.match(core, /image\/jpeg/);
assert.match(core, /image\/png/);
assert.match(core, /image\/webp/);
assert.match(core, /imageSignatureMatches/);
assert.match(behavioral, /signed-out|anonymous|anon/i);
assert.match(behavioral, /cross-user|another user|ownership/i);
assert.match(behavioral, /idempotent|Helpful/i);
assert.match(behavioral, /rolled back/i);
assert.match(preflight, /set transaction read only/i);
assert.match(preflight, /20260728233824/);
assert.match(preflight, /lex_forum_social_beta_20260802/);
assert.match(preflight, /pg_get_constraintdef/);
assert.match(preflight, /QUORUM_PREFLIGHT_PASSED/);
assert.match(preflight, /rollback;/i);
assert.doesNotMatch(
  preflight,
  /^\s*(?:insert|update|delete|alter|create|drop|grant|revoke)\b/im,
  'The production preflight must remain read-only.',
);

for (const source of [
  html,
  client,
  adminHtml,
  adminClient,
  worker,
  core,
  migration,
  releaseMigration,
  preflight,
]) {
  assert.doesNotMatch(source, /sbp_[A-Za-z0-9_-]{20,}/, 'Supabase access tokens must not be committed.');
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{30,}/, 'Google API keys must not be committed.');
  assert.doesNotMatch(source, /gmail\.com/i, 'Personal Gmail addresses must not be exposed.');
}

assert.match(css, /grid-template-columns:\s*minmax\(190px,\s*220px\)[\s\S]*minmax\(0,\s*720px\)/);
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log('Quorum static architecture, control, security, and naming tests passed.');
