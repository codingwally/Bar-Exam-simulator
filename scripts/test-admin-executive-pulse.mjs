import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, js, recentSignInMigration, recentActivityMigration] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin-observatory.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260823173000_admin_recent_sign_in_directory.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260824014625_admin_recent_user_activity_directory.sql', import.meta.url), 'utf8'),
]);

for (const group of [
  'Overview', 'People &amp; Marketing', 'Learning', 'Commercial',
  'Support &amp; Community', 'Business', 'Security &amp; Operations',
]) assert.match(html, new RegExp(group.replace('&', '&amp;').replace('&amp;amp;', '&amp;')));

assert.match(html, /Marketing reach and live learner activity\./);

for (const label of [
  'Executive Pulse', 'Live Activity', 'Recent users', 'Users', 'Sign-ups', 'Acquisition',
  'Answers', 'Subject Performance', 'Grading Health', 'Subscriptions',
  'Paid Subscribers', 'Payments', 'Refunds', 'Support', 'Corrections', 'Community Moderation',
  'Revenue', 'Projections', 'Comparisons', 'Security &amp; Activity Log', 'Website Settings',
]) assert.match(html, new RegExp(`<span>${label}</span>`));

const navigationSections = [...html.matchAll(/data-section="([a-z_]+)"/g)]
  .map((match) => match[1]);
assert.ok(navigationSections.length >= 20, 'Executive navigation should expose the complete admin toolset.');
for (const section of navigationSections) {
  assert.match(js, new RegExp(`\\b${section}:\\s*['\"]`), `${section} must have a title.`);
  assert.match(js, new RegExp(`section === ['\"]${section}['\"]`), `${section} must have a renderer route.`);
}

for (const control of [
  'refresh-dashboard', 'download-current-section', 'menu-button', 'sidebar-collapse',
]) assert.match(js, new RegExp(`\\$\\('#${control}'\\)\\?\\.addEventListener`));

for (const id of [
  'observatory-source-chart', 'observatory-device-chart', 'observatory-funnel-chart',
]) assert.match(js, new RegExp(id));

const executiveStart = js.indexOf('async function renderExecutive');
const executiveEnd = js.indexOf('\n  function barList', executiveStart);
const executiveSource = js.slice(executiveStart, executiveEnd);
assert.ok(executiveStart >= 0 && executiveEnd > executiveStart, 'Executive renderer must be extractable.');
assert.match(executiveSource, /Home viewers/);
assert.match(executiveSource, /traffic\.home_viewers/);
assert.match(executiveSource, /New accounts/);
assert.match(executiveSource, /funnel\.new_accounts/);
assert.match(executiveSource, /Active now/);
assert.match(executiveSource, /activity\.activeSignedInLast5Minutes/);
assert.match(executiveSource, /Active on Home/);
assert.match(executiveSource, /activity\.activeHomeLast5Minutes/);
assert.match(executiveSource, /activity\.activeSignedInLast30Minutes/);
assert.match(executiveSource, /activity\.activeHomeLast30Minutes/);
assert.match(executiveSource, /Distinct non-admin users · selected period/);
assert.match(executiveSource, /New accounts counts distinct accounts/);
assert.doesNotMatch(executiveSource, /New accounts counts distinct people/);
assert.match(executiveSource, /Sign-ins are recorded events, so one user may appear more than once/);
assert.match(executiveSource, /Promise\.allSettled/);
assert.match(executiveSource, /Recent learner sign-ins/);
assert.match(executiveSource, /\['admin', 'founder_admin', 'super_admin'\]/);
assert.doesNotMatch(executiveSource, /signedInAccounts|Answering users|Questions answered|Grading success/);
assert.doesNotMatch(executiveSource, /loadAllPhase4Operational|approvedValue|pendingValue/);
assert.doesNotMatch(executiveSource, /Top Subjects|Operations &amp; access|openQuorumReports/);
assert.doesNotMatch(executiveSource, /observatory-(?:activity|user-mix|revenue|subject)-chart/);
assert.doesNotMatch(js, /'Not collected', 'Not collected'/);
assert.match(executiveSource, /\['Name', 'Email', 'School', 'Last sign-in', 'Region', 'Device', 'Access'\]/);
assert.match(js, /accountRegion\(account\), accountDevice\(account\)/);
assert.match(js, /\/admin\/recent-sign-ins/);
assert.match(js, /\/admin\/recent-sign-ins'[\s\S]{0,120}limit:\s*25/);
assert.match(js, /\/admin\/recent-user-activity/);
assert.match(js, /data-admin-section="recent_users"/);
assert.match(js, /Signed-in sessions, time used, and the latest recorded activity/);
assert.match(js, /monitoring_recorded_at\s*\|\|\s*right\.last_sign_in_at/);
assert.match(js, /return 'Administrator'/);
assert.match(js, /stacked:\s*true/);
assert.match(js, /Available after next sign-in/);
assert.match(js, /not bank settlement/i);
assert.doesNotMatch(js, /forecast-guaranteed revenue[^\n]*executiveVisuals/i);
assert.match(js, /function renderPaidSubscribers\(context\)/);
assert.match(js, /Paid verified/);
assert.match(js, /Paid not verified/);
assert.match(js, /Expired or within five days/i);
assert.match(js, /function administratorIdentity\(userId, directoryById/);
assert.match(js, /row\.reviewed_by \? administratorIdentity\(row\.reviewed_by, directoryById\)/);
assert.match(js, /class="table-sort"/);
assert.match(js, /aria-sort/);
assert.match(js, /Average time used/);
assert.match(js, /Total time used/);
assert.match(js, /Peak activity times/);
assert.doesNotMatch(js, /loadRecentUserActivityWindow\([\s\S]{0,180}\.catch\(\(\) => \(\{ items: \[\]/);
assert.match(js, /A bounded page is sufficient/);
assert.match(js, /Device and peak-hour distributions use the latest 100 sessions per period/);
assert.match(js, /business-revenue-status-chart/);
assert.match(js, /business-device-comparison-chart/);
assert.match(js, /function activityPageAreaLabel\(value\)/);
for (const legacyHomeArea of ['quorum', "'lex-forum'"]) {
  assert.match(js, new RegExp(`${legacyHomeArea.replace('-', '\\-')}: 'Home'`));
}
assert.match(js, /mock_bar: 'Bar Question Practice'/);
assert.match(js, /'mock-bar': 'Bar Question Practice'/);
assert.match(js, /\.metric, \.observatory-kpi/);
assert.match(js, /due-diligence-community-posts\.csv/);

const realtimeStart = js.indexOf('async function renderRealtime');
const realtimeEnd = js.indexOf('\n  function renderAcquisition', realtimeStart);
const realtimeSource = js.slice(realtimeStart, realtimeEnd);
assert.ok(realtimeStart >= 0 && realtimeEnd > realtimeStart, 'Live Activity renderer must be extractable.');
assert.match(realtimeSource, /Active users · 5 minutes/);
assert.match(realtimeSource, /Active users · 30 minutes/);
assert.match(realtimeSource, /Active on Home · 5 minutes/);
assert.match(realtimeSource, /Active on Home · 30 minutes/);
assert.doesNotMatch(realtimeSource, /Average daily views|DAU|monthly users|Signed-in and guest sessions/);
assert.doesNotMatch(realtimeSource, /loadReport|report\./);
assert.match(js, /rangeControl\.hidden = isExaminationRoom \|\| section === 'realtime'/);
assert.match(js, /'executive', 'acquisition', 'marketing', 'learning', 'subjects'/);
assert.doesNotMatch(js, /'executive', 'realtime', 'acquisition'/);
assert.match(js, /renderRealtime\(context\)/);
assert.match(js, /activity in fixed 5- and 30-minute windows/);

assert.match(css, /executive-chart-grid-top/);
assert.match(css, /grid-template-columns:\s*226px/);
assert.match(css, /admin-sidebar-collapsed/);
assert.match(css, /dashboard-loading/);
assert.match(css, /@media \(max-width: 920px\)/);
assert.match(css, /@media \(min-width: 921px\)[\s\S]*\.menu-button \{ display: none !important; \}/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\.record-detail-expanded[\s\S]*display:\s*grid/);
assert.match(css, /\.admin-table-actions[\s\S]*position:\s*sticky/);
assert.match(css, /\.table-wrap td \.record-source-links a[\s\S]*color:\s*var\(--obs-cyan\)/);
assert.match(css, /recent-user-activity-table/);
assert.match(css, /recent-user-summary/);
assert.match(css, /\.observatory \.table-sort/);
assert.match(css, /\.observatory \.table-wrap th[\s\S]*background:\s*#08131d/);
assert.doesNotMatch(css, /\.recent-users-ledger thead th[\s\S]{0,240}background:\s*#e9eff2/);

assert.match(html, /private-beta-session\.js/);
assert.doesNotMatch(js, /visualPreview|installVisualPreviewFixture|local-preview-only/);

assert.match(recentSignInMigration, /create or replace function public\.admin_recent_sign_in_directory/);
assert.match(recentSignInMigration, /from public\.user_sign_in_events/);
assert.match(recentSignInMigration, /order by e\.signed_in_at desc, e\.id desc/);
assert.match(recentSignInMigration, /u\.email/);
assert.match(recentSignInMigration, /revoke all on function public\.admin_recent_sign_in_directory[\s\S]*from public, anon, authenticated/);
assert.match(recentSignInMigration, /grant execute on function public\.admin_recent_sign_in_directory[\s\S]*to service_role/);

assert.match(recentActivityMigration, /create or replace function public\.admin_recent_user_activity_directory/);
assert.match(recentActivityMigration, /'dailyActivity'/);
assert.match(recentActivityMigration, /'activityMix'/);
assert.match(recentActivityMigration, /'averageDurationSeconds'/);
assert.match(recentActivityMigration, /revoke all on function public\.admin_recent_user_activity_directory[\s\S]*from public, anon, authenticated/);
assert.match(recentActivityMigration, /grant execute on function public\.admin_recent_user_activity_directory[\s\S]*to service_role/);

console.log('Executive Pulse structure, real-data labels, responsive layout, and navigation contracts passed.');
