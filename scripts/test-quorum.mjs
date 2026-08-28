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
  starterMigration,
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
  fs.readFile(new URL('../supabase/migrations/20260821022828_home_taglish_starter_discussions.sql', import.meta.url), 'utf8'),
]);

assert.match(html, /id="spa-community"[^>]*data-public-feature="quorum"[^>]*>Home<\/button>/);
assert.doesNotMatch(html, /quorum-community-banner/);
assert.doesNotMatch(html, /community-home-stats/);
assert.doesNotMatch(html, /id="quorum-menu-open"/);
assert.doesNotMatch(html, /quorum-practice-card-mobile/);
assert.equal((html.match(/class="quorum-practice-card/g) || []).length, 1);
assert.match(html, /class="quorum-practice-menu quorum-home-tools"[\s\S]*My Posts[\s\S]*Saved[\s\S]*Study Circles[\s\S]*Notifications/);
assert.match(html, /Latest member discussions/);
assert.match(html, /Saved/);
assert.match(html, /Study Circles/);
assert.match(html, /Trending discussions/);
assert.match(html, /Questions Needing Answers/);
assert.match(html, /id="quorum-menu-close"[\s\S]*aria-label="Close Home menu"/);
assert.match(html, /id="quorum-menu-back"[\s\S]*>Back<\/button>/);
assert.match(client, /\$\('#quorum-menu-back'\)\?\.addEventListener\('click',[\s\S]*closeQuorumDrawer\(\)/);
assert.match(css, /\.quorum-drawer-actions[\s\S]*justify-content:\s*flex-end/);
assert.match(client, /Practice this issue/);
assert.match(adminHtml, /<button[^>]*data-section="forum"[^>]*>[\s\S]*?Community[\s\S]*?<\/button>/);
assert.match(adminClient, /forum: 'Community Moderation'/);

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
  'quorum-entry-image',
  'quorum-feed-sort',
  'quorum-active-issues',
  'quorum-unanswered',
  'quorum-recommended-circles',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} must be rendered.`);
}

const composerHtml = html.match(/<form class="lex-composer"[\s\S]*?<\/form>/)?.[0] || '';
assert.ok(composerHtml, 'The Home composer must render.');
assert.match(composerHtml, /id="quorum-entry-image"/);
assert.match(composerHtml, /id="lex-post-submit"[^>]*aria-label="Post"/);
assert.match(composerHtml, /id="quorum-entry-anonymous"/);
for (const removedControl of [
  'quorum-entry-type',
  'quorum-entry-category',
  'quorum-entry-subject',
  'quorum-entry-preview',
  'quorum-entry-cancel',
]) {
  assert.doesNotMatch(composerHtml, new RegExp(`id="${removedControl}"`));
}
assert.doesNotMatch(html, /Fictional · anonymized · read-only|Community preview|Starter discussions/);

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
  'create_entry',
  'set_affirm',
]) {
  assert.match(client, new RegExp(`['"]${operation}['"]`), `${operation} must be wired in the Quorum client.`);
}

for (const route of ['/quorum/query', '/quorum/command', '/admin/quorum', '/admin/quorum/posts']) {
  assert.match(worker, new RegExp(`pathname === '${route.replaceAll('/', '\\/')}'`), `${route} must be handled by the Worker.`);
}
assert.match(client, /api\('\/quorum\/query'/);
assert.match(client, /api\('\/quorum\/command'/);
assert.match(adminClient, /api\('\/admin\/quorum\/posts'/);
assert.match(adminClient, /All Community posts/);
assert.match(adminClient, /Download all matching posts/);
assert.match(adminClient, /row\.author_email/);
assert.doesNotMatch(
  client,
  /['"]create_simple_entry['"]/,
  'The composer must submit its full optional details through create_entry.',
);
assert.match(client, /Disseminate/);
assert.doesNotMatch(client, /Cite \/ Send/);
assert.match(client, /draftPrefix[\s\S]*currentUserId\(\)/);
assert.match(client, /\$\('#quorum-notification-count'\)\.textContent = unreadCount/);
assert.match(client, /allowDismiss:\s*true/);
assert.match(phase2, /id="dd2-entry-close"/);
assert.match(phase2, /options\.allowDismiss === true/);
assert.match(phase2, /event\.currentTarget\.dataset\.dismissible === 'true'/);
assert.match(phase2, /event\.key === 'Escape'[\s\S]*returnFromEntry\(\)/);
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

assert.equal(new Set([...starterMigration.matchAll(/home-20260821-post-\d{3}/g)].map((match) => match[0])).size, 23);
assert.equal(new Set([...starterMigration.matchAll(/home-20260821-(?:comment|reply)-\d{3}/g)].map((match) => match[0])).size, 32);
assert.match(starterMigration, /forum_ensure_anonymous_alias/);
assert.match(starterMigration, /on conflict \(starter_content_key\)/);
assert.match(starterMigration, /Paano|niyo|pero|ako|yung/);

const { readFile: readSubscriptionAsset } = await import('node:fs/promises');
const subscriptionCta = await readSubscriptionAsset('assets/subscription-cta.js', 'utf8');
const subscriptionCtaCss = await readSubscriptionAsset('assets/subscription-cta.css', 'utf8');
const vmModule = await import('node:vm');
const subscriptionContext = vmModule.createContext({});
vmModule.runInContext(subscriptionCta, subscriptionContext);
const { isAudienceEligible } = subscriptionContext.DueDiligenceSubscriptionCta;

assert.equal(isAudienceEligible(null), false, 'Unknown access must fail closed.');
assert.equal(isAudienceEligible({ role: 'admin', unlimited: true }), true, 'Admins must see the QA CTA.');
assert.equal(
  isAudienceEligible({ basis: 'founding_beta', freeBeta: { active: true }, unlimited: true }),
  true,
  'Founding Beta members must see the CTA by explicit product decision.',
);
assert.equal(
  isAudienceEligible({ basis: 'introductory', introductoryTokensEligible: true, unlimited: true }),
  true,
  'Introductory members must see the CTA.',
);
assert.equal(isAudienceEligible({ unlimited: false, subscription: null }), true, 'Unpaid members must see the CTA.');
assert.equal(
  isAudienceEligible({ paidSubscriptionExpired: true, unlimited: false, subscription: { status: 'expired' } }),
  true,
  'Expired members must see the CTA.',
);
assert.equal(
  isAudienceEligible({
    introductoryTokensEligible: true,
    unlimited: true,
    subscription: { status: 'active', planCode: 'monthly', source: 'stripe' },
  }),
  false,
  'An active paid subscription must override stale introductory eligibility.',
);
assert.equal(
  isAudienceEligible({ unlimited: true, accountLabel: 'Paid Access', subscription: { status: 'active' } }),
  false,
  'Active paid members must not see the CTA.',
);
assert.equal(
  isAudienceEligible({ unlimited: true, basis: 'complimentary' }),
  false,
  'Paid-equivalent access must not see the CTA.',
);
assert.equal(
  isAudienceEligible({ globalBeta: { active: true }, unlimited: false }),
  false,
  'Active non-founding beta access must not see the CTA.',
);

assert.match(subscriptionCta, /logo\.src = 'assets\/brand\/icon-192\.png'/, 'The post must use the exact website crest.');
assert.match(subscriptionCta, /Your journey deserves a platform that keeps getting better\./);
assert.match(subscriptionCta, /maintained by diligent law students, advised by law professors/);
assert.match(subscriptionCta, /action\.dataset\.dd2View = 'pricing'/, 'The post CTA must open native pricing.');
assert.match(subscriptionCta, /duplicateAccountBadge\.hidden = true/, 'Signed-in users must not see the duplicate account badge.');
assert.match(subscriptionCtaCss, /dd2-header-pricing-button[\s\S]*?min-height:\s*44px/);
assert.match(subscriptionCtaCss, /dd2-subscription-invitation__action[\s\S]*?min-height:\s*44px/);
assert.match(subscriptionCtaCss, /@media \(max-width: 560px\)/);
assert.match(subscriptionCtaCss, /prefers-reduced-motion/);
assert.match(html, /assets\/subscription-cta\.css\?v=home-subscription-cta-20260828-1/);
assert.match(html, /assets\/subscription-cta\.js\?v=home-subscription-cta-20260828-1/);
const pricingButtonIndex = html.indexOf('id="dd2-header-pricing-button"');
const examinationButtonIndex = html.indexOf('id="dd2-header-exam-button"');
const profileButtonIndex = html.indexOf('id="dd2-header-role-button"');
assert.ok(
  pricingButtonIndex >= 0 && pricingButtonIndex < examinationButtonIndex && examinationButtonIndex < profileButtonIndex,
  'Header tab order must be Plans & Pricing, Examination Room, then the single profile control.',
);
assert.match(client, /state\.view === 'home'[\s\S]*?createHomeInvitation/);
assert.match(client, /duediligence:subscription-cta/);

console.log('Quorum static architecture, control, security, naming, and subscription CTA tests passed.');
