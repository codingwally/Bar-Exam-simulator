import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [html, migration, frontend, landing, core, pdf, workerIndex] = await Promise.all([
  read('index.html'),
  read('supabase/migrations/20260822130000_analytics_measurement_fields.sql'),
  read('assets/duediligence-2026.js'),
  read('assets/private-beta-landing.js'),
  read('worker/duediligence-2026-core.mjs'),
  read('worker/verdict-pdf.mjs'),
  read('worker/index.mjs'),
]);

assert.match(html, /<section id="page-analytics" class="page"/,
  'Analytics must be a routed application page.');
assert.doesNotMatch(html, /id="analytics-modal"/,
  'Analytics must not regress to a modal.');
assert.match(html, /analytics:\s*'verdict'/,
  'The compatibility route must resolve to the Analytics page.');
assert.match(html, /function openAnalytics\(\)[\s\S]*showPage\('analytics', document\.getElementById\('spa-progress'\)\)/,
  'Opening Analytics must use SPA routing.');
assert.match(html, /Score trend/);
assert.match(html, /Subject performance/);
assert.match(html, /Writing pace/);
assert.match(html, /Grammar strength<\/span><span>Not measured separately/,
  'Analytics must not invent a grammar score.');
assert.match(html, /Issue spotting<\/span><span>Not measured separately/,
  'Analytics must not invent an issue-spotting score.');
assert.match(html, /Account history could not be reached[\s\S]*only attempts saved on this device/,
  'A local fallback must be disclosed as incomplete.');
assert.match(html, /Reset Analytics\?[\s\S]*Recently Deleted for 30 days/,
  'Reset must be explicit and recoverable for synced records.');
assert.match(html, /for \(let offset = 0; offset < remoteRecords\.length; offset \+= 200\)/,
  'Reset must respect the backend archive batch limit.');
assert.match(html, /reset\.disabled[\s\S]*verdictDashboard\.capped/,
  'Reset must stop when the 500-record page cannot prove complete coverage.');
assert.match(html, /const deviceOnly = local[\s\S]*\.map\(\(record\) => \(\{ \.\.\.record, localOnly: true \}\)\)/,
  'Unsynced device records must never be sent to the server archive endpoint.');

assert.match(migration, /'wordCount', word_count/);
assert.match(migration, /'rubricBreakdown', rubric_breakdown/);
assert.match(migration, /a\.assessment->'rubricBreakdown'/);
assert.match(migration, /s\.word_count::integer/);
assert.match(migration, /revoke all on function public\.dd2026_verdict_records[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.dd2026_verdict_records[\s\S]*to service_role/);
assert.match(workerIndex, /'dd2026_verdict_records'/,
  'The production Worker RPC allowlist must permit Analytics history reads.');
assert.match(workerIndex, /'dd2026_verdict_archive'/,
  'The production Worker RPC allowlist must permit recoverable Analytics removal and reset.');

assert.doesNotMatch(`${html}\n${frontend}\n${landing}\n${core}`, />The Verdict<|Close The Verdict|The Verdict is temporarily unavailable|requested Verdict|available Verdict export/,
  'Visible legacy Verdict naming must be replaced with Analytics.');
assert.match(frontend, /Analytics \/ Private PDF/);
assert.match(pdf, /Due Diligence — Analytics/);

console.log('Full-page Analytics and measurement-contract checks passed.');
