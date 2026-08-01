import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  html, css, js, analytics, worker, migration, directoryMigration,
  engagementMigration, globalBetaMigration, answerHistoryMigration, preflight,
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
  readFile(new URL('../supabase/review/phase3_production_preflight.sql', import.meta.url), 'utf8'),
]);

const sectionLabels = [
  'Chambers',
  'Live Activity',
  'Visitors &amp; Sign-ups',
  'Students',
  'Performance',
  'Question Bank',
  'AI Grading Health',
  'Retainer Management',
  'Payment Review',
  'Refunds',
  'Support Requests',
  'Answer Corrections',
  'Partnerships',
  'Website Settings',
  'Access &amp; Activity Log',
  'Answer Exports',
];
for (const label of sectionLabels) assert.match(html, new RegExp(label.replace(/[&]/g, '&')));
assert.doesNotMatch(html, /Advertiser &amp; Investor/);

assert.match(html, /aria-label="Admin sections"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Skip to Chambers/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.match(css, /@media print/);

assert.match(js, /Paid subscribers: Not connected/);
assert.match(js, /Scenario only — not actual performance/);
assert.match(js, /Final identity transfer is disabled/);
assert.match(js, /Contact Support\. We respond within 24 hours\./);
assert.match(js, /No production data was changed/);
assert.match(js, /No verified events/);
assert.match(js, /Administrator request failed/);
assert.match(js, /Aggregate export|aggregate-report\.csv/i);
assert.match(js, /Mastery average/);
assert.match(js, /D1, D7, and D30/);

assert.match(analytics, /90_000/);
assert.match(analytics, /document\.visibilityState/);
assert.match(analytics, /session_heartbeat/);
assert.doesNotMatch(analytics, /CF-Connecting-IP|userAgent|navigator\.userAgent|mousemove|keydown/);

for (const route of [
  '/analytics/events',
  '/admin/session',
  '/admin/dashboard',
  '/admin/data',
  '/admin/user-directory',
  '/admin/user-directory/export',
  '/admin/user-directory/email',
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
assert.match(js, /Download Students CSV/);
assert.match(js, /Search name, school, or email/);
assert.doesNotMatch(js, /\['Name', 'Masked email'/);
assert.doesNotMatch(js, /'Lifetime grades'/);
assert.match(js, /Download all answer records/);
assert.match(js, /Suggested answer/);
assert.match(js, /Model answer/);
assert.match(js, /all current and future signed-in users/i);

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
