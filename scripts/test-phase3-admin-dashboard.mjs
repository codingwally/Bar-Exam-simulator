import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  html, css, js, analytics, worker, migration, directoryMigration,
  engagementMigration, globalBetaMigration, answerHistoryMigration,
  businessDetailsMigration, monitoringMigration, preflight,
] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase3-analytics.js', import.meta.url), 'utf8'),
  readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260729_004_phase3_admin_analytics.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260809_019_admin_user_directory_exports.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260810002000_admin_overview_engagement_metrics.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260810002100_global_beta_all_access.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260810002200_admin_answer_history_export.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260810002300_admin_business_dashboard_details.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260823080651_admin_sign_in_monitoring.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/review/phase3_production_preflight.sql', import.meta.url), 'utf8'),
]);

const sectionLabels = [
  ['executive', 'Executive Pulse'],
  ['realtime', 'Live Activity'],
  ['users', 'Users'],
  ['acquisition', 'Sign-ups'],
  ['marketing', 'Acquisition'],
  ['answer_exports', 'Answers'],
  ['learning', 'Subject Performance'],
  ['subjects', 'Question Bank'],
  ['reliability', 'Grading Health'],
  ['examinations', 'Exams'],
  ['forum', 'Community Moderation'],
  ['support', 'Support'],
  ['corrections', 'Corrections'],
  ['subscriptions', 'Subscriptions'],
  ['payments', 'Payments'],
  ['refunds', 'Refunds'],
  ['partnerships', 'Partnerships'],
  ['business_revenue', 'Revenue'],
  ['business_projections', 'Projections'],
  ['business_comparisons', 'Comparisons'],
  ['controls', 'Controls'],
  ['security', 'Audit Log'],
];
for (const [section, label] of sectionLabels) {
  assert.match(
    html,
    new RegExp(`<button data-section="${section}"[^>]*>[\\s\\S]*?<span>${label}<\\/span>[\\s\\S]*?<\\/button>`),
  );
}
for (const obsolete of [
  /Chambers/,
  /Visitors &amp; Sign-ups/,
  /Students/,
  /Retainer Management/,
  /Payment Review/,
  /Answer Exports/,
  /Advertiser &amp; Investor/,
]) assert.doesNotMatch(html, obsolete);

assert.match(html, /aria-label="Admin sections"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Skip to admin dashboard/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.match(css, /@media print/);

assert.match(js, /operational records, not bank settlement or accounting statements/i);
assert.match(js, /Planning estimate only:[\s\S]*not actual or forecast-guaranteed revenue/i);
assert.match(js, /Final account transfer is disabled/);
assert.match(js, /Contact Support\. We respond within 24 hours\./);
assert.match(js, /Nothing was changed/);
assert.match(js, /No verified events/);
assert.match(js, /Administrator request failed/);
assert.match(js, /const overviewReady = await renderSection\('executive'\)/);
assert.match(js, /Overview is temporarily unavailable\. Payments remains available\./);
assert.match(js, /const report = reportSections\.has\(section\) \? await loadReport\(\) : \{\}/);
assert.match(js, /Aggregate export|aggregate-report\.csv/i);
assert.match(js, /Mastery average/);
assert.match(js, /One-day, seven-day, and 30-day return rates/);

assert.match(analytics, /90_000/);
assert.match(analytics, /document\.visibilityState/);
assert.match(analytics, /session_heartbeat/);
assert.match(analytics, /!headers\.Authorization && !headers\['X-DD-Beta-Access'\]/);
assert.match(analytics, /duediligence:session/);
assert.match(analytics, /duediligence:private-beta-access/);
assert.doesNotMatch(analytics, /CF-Connecting-IP|userAgent|navigator\.userAgent|mousemove|keydown/);

for (const route of [
  '/analytics/events',
  '/admin/session',
  '/admin/dashboard',
  '/admin/data',
  '/admin/user-directory',
  '/admin/user-directory/export',
  '/admin/subscriptions/export',
  '/admin/user-directory/email',
  '/admin/live-activity',
  '/admin/answer-history',
  '/admin/quorum/posts',
  '/admin/global-beta/change',
  '/admin/answer-history/export',
  '/admin/action',
  '/admin/reveal-email',
  '/admin/find-email',
  '/admin/export',
  '/admin/user-responses/export',
]) assert.match(worker, new RegExp(route.replace('/', '\\/')));

assert.match(js, /Download Q&amp;A|Download Q&A/);
assert.match(js, /user_response_export/);
assert.match(js, /founder_admin.*super_admin|super_admin.*founder_admin/s);
assert.match(js, /private student work/i);
assert.match(js, /user\.email/);
assert.match(js, /Download user list/);
assert.match(js, /\/admin\/subscriptions\/export/);
assert.match(js, /Search name, school, or email/);
assert.doesNotMatch(js, /\['Name', 'Masked email'/);
assert.doesNotMatch(js, /'Lifetime grades'/);
assert.match(js, /Download all answer records/);
assert.match(js, /Suggested answer/);
assert.match(js, /Model answer/);
assert.match(js, /all signed-in users bypass commercial limits/i);
assert.match(js, /api\('\/admin\/live-activity'/);
assert.match(js, /api\('\/admin\/answer-history'/);
assert.match(js, /api\('\/admin\/quorum\/posts'/);
assert.match(js, /'Measure', 'Value', 'Meaning', 'Generated at'/);
assert.match(js, /identity|Exact online names are withheld/i);
assert.match(js, /'Answer type', 'Subject', 'Exam', 'Question',[\s\S]*'Student answer'/);
assert.match(js, /'Category', 'Plan record', 'Record status', 'Current access',[\s\S]*'Questions answered'/);
assert.match(js, /'Posted', 'Name', 'Email', 'Type', 'Topic', 'Post', 'Status', 'Comments', 'Reports'/);
assert.match(js, /\^\[\\s\\u0000-\\u001f\\u007f-\\u009f\]\*\[=\+\\-@\]/);

assert.match(directoryMigration, /create or replace function public\.admin_user_directory/);
assert.match(directoryMigration, /from auth\.users u\s+left join public\.profiles p/s);
assert.match(directoryMigration, /learner_analytics_viewer/);
assert.match(directoryMigration, /admin_export_user_responses_with_identity/);
assert.match(directoryMigration, /revoke all on function public\.admin_user_directory[\s\S]*from public, anon, authenticated/);
assert.match(directoryMigration, /grant execute on function public\.admin_user_directory[\s\S]*to service_role/);
assert.doesNotMatch(directoryMigration, /grant execute[\s\S]*to authenticated/);

assert.match(engagementMigration, /admin_overview_engagement_metrics/);
assert.match(engagementMigration, /admin_user_engagement_directory/);
assert.match(globalBetaMigration, /global_beta_all_access_enabled boolean not null default true/);
assert.match(globalBetaMigration, /phase4_global_beta_effective/);
assert.match(globalBetaMigration, /phase4_admin_set_global_beta_all_access/);
assert.match(answerHistoryMigration, /admin_export_answer_history/);
assert.match(answerHistoryMigration, /phase4_require_founder/);
assert.match(answerHistoryMigration, /answer_history_export/);
for (const secureMigration of [engagementMigration, globalBetaMigration, answerHistoryMigration]) {
  assert.doesNotMatch(secureMigration, /grant execute[\s\S]*to authenticated/);
}

assert.match(businessDetailsMigration, /create or replace function public\.admin_live_activity/);
assert.match(businessDetailsMigration, /create or replace function public\.admin_quorum_posts/);
assert.match(businessDetailsMigration, /create or replace function public\.admin_preview_answer_history/);
assert.match(businessDetailsMigration, /create or replace function public\.admin_export_answer_history_with_context/);
assert.match(businessDetailsMigration, /create or replace function public\.admin_user_engagement_directory/);
assert.match(businessDetailsMigration, /display_name[\s\S]*email[\s\S]*subscription_category/);
assert.match(businessDetailsMigration, /'identityRowsWithheld', true/);
assert.match(businessDetailsMigration, /'items', '\[\]'::jsonb/);
assert.match(businessDetailsMigration, /revoke all on function public\.admin_live_activity[\s\S]*from public, anon, authenticated/);
assert.match(businessDetailsMigration, /revoke all on function public\.admin_quorum_posts[\s\S]*from public, anon, authenticated/);
assert.match(businessDetailsMigration, /grant execute on function public\.admin_live_activity[\s\S]*to service_role/);
assert.match(businessDetailsMigration, /grant execute on function public\.admin_quorum_posts[\s\S]*to service_role/);
assert.match(businessDetailsMigration, /grant execute on function public\.admin_preview_answer_history[\s\S]*to service_role/);
assert.match(businessDetailsMigration, /external_question_bank_not_persisted/);
assert.match(businessDetailsMigration, /immutable_exam_snapshot/);
assert.doesNotMatch(businessDetailsMigration, /grant execute[\s\S]*to authenticated/);

assert.match(monitoringMigration, /create table if not exists public\.user_sign_in_events/);
assert.match(monitoringMigration, /alter table public\.user_sign_in_events enable row level security/);
assert.match(monitoringMigration, /revoke all on public\.user_sign_in_events from public, anon, authenticated/);
assert.match(monitoringMigration, /grant select, insert on public\.user_sign_in_events to service_role/);
assert.match(monitoringMigration, /create or replace function public\.record_user_sign_in_event/);
assert.match(monitoringMigration, /create or replace function public\.admin_user_monitoring_directory/);
assert.match(monitoringMigration, /public\.admin_user_engagement_directory/);
assert.match(monitoringMigration, /from public\.usage_sessions/);
assert.match(monitoringMigration, /set search_path = ''/);
assert.match(monitoringMigration, /on conflict \(session_digest\) do nothing/);
assert.match(monitoringMigration, /revoke all on function public\.record_user_sign_in_event[\s\S]*from public, anon, authenticated/);
assert.match(monitoringMigration, /grant execute on function public\.record_user_sign_in_event[\s\S]*to service_role/);
assert.match(monitoringMigration, /revoke all on function public\.admin_user_monitoring_directory[\s\S]*from public, anon, authenticated/);
assert.match(monitoringMigration, /grant execute on function public\.admin_user_monitoring_directory[\s\S]*to service_role/);
assert.doesNotMatch(
  monitoringMigration,
  /\b(?:ip_address|raw_ip|user_agent|authorization|access_token|refresh_token|answer_text)\s+(?:text|inet|jsonb?)\b/i,
);
assert.match(worker, /record_user_sign_in_event/);
assert.match(worker, /admin_user_monitoring_directory/);

for (const capability of [
  'analytics_viewer',
  'learner_analytics_viewer',
  'support_admin',
  'correction_admin',
  'subscription_admin',
  'account_recovery_admin',
  'advertiser_report_viewer',
  'role_admin',
]) assert.match(migration, new RegExp(capability));

assert.match(migration, /revoke all on public\.usage_events from public, anon, authenticated/);
assert.match(migration, /transfer_enabled boolean not null default false check \(transfer_enabled = false\)/);
assert.match(migration, /payment integration pending/);
assert.match(migration, /on conflict \(event_key\).*do nothing/s);
assert.match(migration, /latest_success/);
assert.match(migration, /repeated_success/);
assert.match(migration, /'retention', retention\.metrics/);
assert.match(preflight, /READ-ONLY \/ FAIL-FAST/);
assert.match(preflight, /finalize_guest_grade\(uuid,smallint\)/);
assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);

console.log('Phase 3 admin, analytics, privacy, and preflight contract tests passed.');
