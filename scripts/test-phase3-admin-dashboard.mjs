import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, js, analytics, worker, migration, preflight] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase3-analytics.js', import.meta.url), 'utf8'),
  readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260729_004_phase3_admin_analytics.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/review/phase3_production_preflight.sql', import.meta.url), 'utf8'),
]);

const sectionLabels = [
  'Executive Overview',
  'Realtime &amp; Traffic',
  'Acquisition &amp; Conversion',
  'Users &amp; Cohorts',
  'Learning &amp; Scores',
  'Subjects &amp; Questions',
  'Gemini &amp; Reliability',
  'Entitlements &amp; Discounts',
  'Support &amp; Recovery',
  'Correction Queue',
  'Advertiser &amp; Investor',
  'Website Controls',
  'Roles, Security &amp; Audit',
];
for (const label of sectionLabels) assert.match(html, new RegExp(label.replace(/[&]/g, '&')));

assert.match(html, /aria-label="Admin sections"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Skip to dashboard/);
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
assert.match(js, /safeCsv|aggregate CSV|Export aggregate CSV/i);
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
  '/admin/action',
  '/admin/reveal-email',
  '/admin/find-email',
  '/admin/export',
]) assert.match(worker, new RegExp(route.replace('/', '\\/')));

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
