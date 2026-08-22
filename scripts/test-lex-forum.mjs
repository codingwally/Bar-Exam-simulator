import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = Object.fromEntries(await Promise.all([
  'index.html',
  'assets/phase2-experience.js',
  'assets/lex-forum.js',
  'assets/lex-forum.css',
  'assets/feature-loader.js',
  'worker/index.mjs',
  'worker/forum-core.mjs',
  'admin/index.html',
  'admin/admin.js',
  'scripts/build-pages-artifact.mjs',
  'supabase/migrations/20260802_011_lex_forum_social_beta.sql',
  'supabase/migrations/20260821022828_home_taglish_starter_discussions.sql',
  'supabase/review/lex_forum_production_preflight.sql',
].map(async (path) => [path, await readFile(path, 'utf8')])));

const page = files['index.html'];
const auth = files['assets/phase2-experience.js'];
const forum = files['assets/lex-forum.js'];
const css = files['assets/lex-forum.css'];
const featureLoader = files['assets/feature-loader.js'];
const worker = files['worker/index.mjs'];
const core = files['worker/forum-core.mjs'];
const adminPage = files['admin/index.html'];
const admin = files['admin/admin.js'];
const build = files['scripts/build-pages-artifact.mjs'];
const migration = files['supabase/migrations/20260802_011_lex_forum_social_beta.sql'];
const starterMigration = files['supabase/migrations/20260821022828_home_taglish_starter_discussions.sql'];
const preflight = files['supabase/review/lex_forum_production_preflight.sql'];

assert.match(page, />Home<\/button>/);
assert.match(page, /aria-label="Home navigation"/);
assert.doesNotMatch(page, /quorum-community-banner|community-home-stats|id="quorum-menu-open"/);
assert.match(page, /quorum-home-tools[\s\S]*My Posts[\s\S]*Saved[\s\S]*Study Circles[\s\S]*Notifications/);
assert.match(page, /id="lex-forum-app" hidden/);
assert.match(page, /Community posts do not constitute legal advice/);
assert.doesNotMatch(page, /Lex Forum|Under Construction/i);
assert.match(page, /id="quorum-entry-image"/);
assert.match(page, /id="quorum-entry-anonymous"/);
assert.match(page, /Post anonymously/);
assert.match(page, /id="lex-post-submit"[^>]*aria-label="Post"/);
assert.ok(
  page.indexOf('quorum-practice-card-desktop') < page.indexOf('Community pulse'),
  'Practice Exam must be the first supporting item on Home',
);
assert.ok(
  page.lastIndexOf('Educational discussion only') > page.indexOf('Study Circles'),
  'The educational disclaimer must remain the last supporting item',
);
for (const removedComposerCopy of [
  /Up to 12 JPEG, PNG, or WebP images/,
  />Add details</,
  />Preview</,
  />Cancel</,
  /Fictional · anonymized · read-only/,
  /Community preview/,
  /Starter discussions/,
]) {
  assert.doesNotMatch(page, removedComposerCopy);
}
assert.doesNotMatch(page, /<(?:link|script)[^>]+assets\/lex-forum\.(?:css|js)/);
assert.match(featureLoader, /assets\/lex-forum\.css\?v=post-casing-20260823-1/);
assert.match(featureLoader, /assets\/lex-forum\.js\?v=non-exam-sweep-20260822-2/);

assert.match(auth, /options\.allowGuest === true && !completed/);
assert.match(auth, /guestButton\.hidden = !allowGuest/);
assert.match(forum, /allowGuest: false/);
assert.match(forum, /duediligence:session/);
assert.match(forum, /safeStorage\(sessionStorage, 'set', destinationKey/);
assert.match(forum, /const key = draftKey\(\);/);
assert.match(forum, /safeStorage\(localStorage, 'set', key/);
assert.match(forum, /forumPost/);
assert.match(forum, /rel = 'noopener noreferrer ugc'/);
assert.match(forum, /textContent = String\(value/);
assert.doesNotMatch(forum, /\.innerHTML\s*=/);
assert.match(forum, /navigator\.onLine/);
assert.doesNotMatch(forum, /query\('sample_feed'\)|sampleVisibleCount|community-sample/);
assert.match(forum, /command\('create_entry'/);
assert.match(forum, /isAnonymous:\s*\$\('#quorum-entry-anonymous'\)\?\.checked === true/);
assert.match(forum, /iconButton\([\s\S]*?'comment'[\s\S]*?'share'[\s\S]*?'save'/);
assert.match(forum, /if \(item\.viewerOwns\)[\s\S]{0,260}'Remove your post'/);
assert.match(forum, /if \(comment\.viewerOwns\)[\s\S]{0,260}button\('Edit'[\s\S]{0,180}button\('Remove'/);
assert.match(forum, /'Reply to this comment'[\s\S]{0,100}'comment'[\s\S]{0,100}'lex-comment-action'/);
assert.match(forum, /function arrangeVisibleComments\(comments\)/);
assert.match(forum, /!comment\.parentCommentId \|\| !visibleIds\.has\(comment\.parentCommentId\)/);
assert.doesNotMatch(forum, /wrapper\.disabled = true/);
assert.match(
  forum,
  /\^\(back\|cancel\|close\|close preview\)\$/i,
  'The shared Home dialog helper must reuse an existing Back action instead of inserting a duplicate.',
);
assert.doesNotMatch(forum, /lex-edit-counter[^\n]*commentLimit/);
assert.match(forum, /'create_comment'/);
assert.match(forum, /payload\.cursorAt = state\.cursor\.createdAt/);
assert.match(forum, /payload\.cursorId = state\.cursor\.id/);
assert.match(forum, /state\.view === 'my-posts'[\s\S]*payload\.authorMemberId = state\.bootstrap\.profile\.memberId/,
  'My Posts must query the signed-in member’s posts rather than opening Profile.');
assert.match(forum, /view === 'my-posts'[\s\S]{0,180}await refreshFeed\(\)/,
  'My Posts must render its filtered feed.');
assert.match(forum, /state\.items = append \? state\.items\.concat/);
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /outline: 3px solid/);
assert.match(css, /quorum-icon-affirm[\s\S]*thumbs-up\.svg/);
assert.match(css, /--home-navy:\s*var\(--qfs-navy-950/);
assert.match(css, /lex-post-card:last-child[\s\S]*border-bottom:\s*0/);
assert.match(css, /#page-community \.lex-post-actions[\s\S]*justify-content:\s*flex-start/);
assert.match(css, /#page-community \.lex-post-actions > \.lex-action:last-child[\s\S]*margin-left:\s*auto/);
assert.match(
  css,
  /\.quorum-entry-heading\s*\{[\s\S]*font-family:\s*var\(--sans\)[\s\S]*text-transform:\s*none/,
  'Home post titles must preserve natural sentence casing in the sans-serif community typography.',
);

for (const route of [
  '/forum/feed',
  '/forum/comments',
  '/forum/posts/create',
  '/forum/posts/update',
  '/forum/posts/delete',
  '/forum/reactions',
  '/forum/comments/create',
  '/forum/comments/update',
  '/forum/comments/delete',
  '/forum/reposts/create',
  '/forum/reposts/delete',
  '/forum/reports',
  '/admin/forum/queue',
  '/admin/forum/action',
]) {
  assert.match(worker, new RegExp(route.replaceAll('/', '\\/')));
}
assert.match(worker, /requireAuthenticatedUser\(request, env\)/);
assert.match(worker, /forumDatabaseError/);
assert.match(core, /typeof payload\.liked !== 'boolean'/);
assert.match(core, /https?:/);
assert.match(core, /FORUM_PRIVATE_CONTACT/);

assert.match(adminPage, />Community<\/button>/);
assert.match(admin, /\/admin\/quorum/);
assert.match(admin, /founder_admin.*super_admin|super_admin.*founder_admin/s);
assert.match(admin, /forum_hide_content/);
assert.match(admin, /forum_restore_content/);
assert.match(admin, /forum_remove_content/);
assert.match(admin, /forum_dismiss_report/);
assert.match(admin, /forum_restrict_user/);
assert.match(admin, /forum_remove_restriction/);

for (const table of [
  'forum_posts',
  'forum_comments',
  'forum_reactions',
  'forum_reposts',
  'forum_reports',
  'forum_user_restrictions',
  'forum_action_events',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
}
assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[^;]*\s+to\s+(?:public|anon|authenticated)/i);
assert.match(migration, /forum_set_reaction\([\s\S]*p_liked boolean/);
assert.match(migration, /on conflict \(post_id, user_id\) do nothing/);
assert.match(migration, /forum_enforce_action_limit/);
assert.match(migration, /FORUM_DUPLICATE_POST/);
assert.match(migration, /FORUM_DUPLICATE_COMMENT/);
assert.match(migration, /FORUM_DUPLICATE_REPORT/);
assert.match(migration, /forum_posts_no_email_check/);
assert.match(migration, /forum_comments_no_email_check/);
assert.match(migration, /forum_reposts_no_email_check/);
assert.match(migration, /moderation_status = 'visible'/);
for (const rowVariable of [
  ['v_post', 'forum_posts'],
  ['v_comment', 'forum_comments'],
  ['v_repost', 'forum_reposts'],
  ['v_report', 'forum_reports'],
  ['v_restriction', 'forum_user_restrictions'],
]) {
  assert.match(
    migration,
    new RegExp(`${rowVariable[0]}\\s+public\\.${rowVariable[1]}%rowtype;`),
    `${rowVariable[0]} must be declared with %rowtype so production validates its composite target`,
  );
}
assert.match(migration, /perform public\.phase4_require_founder/);
assert.match(migration, /insert into public\.admin_audit_log/);
assert.match(migration, /'content_management_action'/);
assert.match(migration, /begin;[\s\S]*commit;/);

const starterPostKeys = new Set(
  [...starterMigration.matchAll(/home-20260821-post-\d{3}/g)].map((match) => match[0]),
);
const starterCommentKeys = new Set(
  [...starterMigration.matchAll(/home-20260821-(?:comment|reply)-\d{3}/g)].map((match) => match[0]),
);
assert.equal(starterPostKeys.size, 23);
assert.equal(starterCommentKeys.size, 32);
assert.match(starterMigration, /is_anonymous[\s\S]*true/);
assert.match(starterMigration, /forum_ensure_anonymous_alias/);
assert.match(starterMigration, /role in \('admin', 'super_admin'\)/);
assert.match(starterMigration, /on conflict \(starter_content_key\)/);
assert.match(starterMigration, /Paano|niyo|pero|ako|yung/);
assert.doesNotMatch(starterMigration, /gmail\.com|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);

assert.match(preflight, /READ-ONLY/);
assert.match(preflight, /forum tables already exist/);
assert.match(preflight, /forum functions already exist/);
assert.doesNotMatch(preflight, /\b(?:insert|update|delete|alter|create|drop|grant|revoke)\b(?![^-]*--)/i);

assert.match(build, /'assets\/lex-forum\.css'/);
assert.match(build, /'assets\/lex-forum\.js'/);

console.log('Home community frontend, Worker, admin, migration, and safety contracts passed.');
