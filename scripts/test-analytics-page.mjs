import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [html, measurementMigration, gradedMigration, frontend, landing, core, pdf, workerIndex] = await Promise.all([
  read('index.html'),
  read('supabase/migrations/20260822130000_analytics_measurement_fields.sql'),
  read('supabase/migrations/20260826165302_analytics_graded_records_only.sql'),
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
assert.match(html, /Latest \$\{points\.length\} graded attempts\. Use left and right arrow keys/,
  'Score trend points must support keyboard inspection.');
assert.match(html, /analyticsTrendPointLabel\(point\)[\s\S]*subject[\s\S]*feature[\s\S]*score \$\{point\.score\.toFixed\(1\)\} out of 5[\s\S]*change\.label/,
  'Every trend point must expose subject, feature, score, date, and change context.');
assert.match(html, /Latest \$\{latest\.length\} average[\s\S]*Previous \$\{previous\.length \|\| 5\} average[\s\S]*Recent direction/,
  'The trend must summarize recent performance against the preceding attempts.');
assert.match(html, /Subject performance/);
assert.match(html, /Writing pace/);
assert.match(html, /Grammar strength<\/span><span>Not measured separately/,
  'Analytics must not invent a grammar score.');
assert.match(html, /Issue spotting<\/span><span>Not measured separately/,
  'Analytics must not invent an issue-spotting score.');
assert.match(html, /Account history could not be reached[\s\S]*graded attempts saved on this device/,
  'A local fallback must be disclosed as incomplete.');
assert.match(html, /Reset Analytics\?[\s\S]*Recently Deleted for 30 days/,
  'Reset must be explicit and recoverable for synced records.');
assert.match(html, /for \(let offset = 0; offset < remoteRecords\.length; offset \+= 200\)/,
  'Reset must respect the backend archive batch limit.');
assert.match(html, /reset\.disabled[\s\S]*verdictDashboard\.capped/,
  'Reset must stop when the 500-record page cannot prove complete coverage.');
assert.match(html, /const deviceOnly = local[\s\S]*\.map\(\(record\) => \(\{ \.\.\.record, localOnly: true \}\)\)/,
  'Unsynced device records must never be sent to the server archive endpoint.');
assert.match(html, /function analyticsFeatureLabel\(value\)[\s\S]*Bar Exam Simulation/,
  'Historical Bar Feels records must use the current Bar Exam Simulation label.');
assert.match(html, /function analyticsSubjectLabel\(value\)[\s\S]*Labor Law and Social Legislation/,
  'Historical subject labels must not retain the incorrect plural form.');
assert.match(html, /function analyticsRecordGraded\(record\)[\s\S]*analyticsFiniteScore\(record\) === null[\s\S]*phase4_exam_attempt[\s\S]*completed[\s\S]*examination_attempt[\s\S]*gradingComplete === true/,
  'Analytics must have one defensive graded-record predicate, including complete multi-question grading.');
assert.match(html, /function analyticsRecordExportable\(record\)[\s\S]*!analyticsRecordGraded\(record\)/,
  'PDF exportability must require a fully graded record.');
assert.match(html, /const exportable = analyticsRecordExportable\(record\)/,
  'The Analytics history table must enforce the exportability guard.');
assert.match(html, /filteredVerdictRecords\(\)\.filter\(\(record\) => verdictDashboard\.selected\.has[\s\S]*analyticsRecordExportable\(record\)\)/,
  'Bulk PDF export must reapply the exportability guard.');
assert.doesNotMatch(html, /Available after submission|Not graded/,
  'Ungraded lifecycle rows must not appear in Analytics history.');
assert.match(html, /Graded attempts only\. Search, export/,
  'Attempt history must explain its graded-only scope.');

assert.match(measurementMigration, /'wordCount', word_count/);
assert.match(measurementMigration, /'rubricBreakdown', rubric_breakdown/);
assert.match(measurementMigration, /a\.assessment->'rubricBreakdown'/);
assert.match(measurementMigration, /s\.word_count::integer/);
assert.match(gradedMigration, /g\.overall_score is not null/);
assert.match(gradedMigration, /a\.status = 'completed'[\s\S]*a\.score is not null/);
assert.match(gradedMigration, /grading_job\.status = 'completed'/);
assert.match(gradedMigration, /scores\.assessment_count = v\.question_count/,
  'Multi-question Analytics records must wait for every assessment.');
assert.match(gradedMigration, /'gradingComplete', grading_complete/);
assert.match(gradedMigration, /limit v_limit offset v_offset/,
  'Graded filtering must occur in the records CTE before pagination.');
assert.match(gradedMigration, /revoke all on function public\.dd2026_verdict_records[\s\S]*from public, anon, authenticated/);
assert.match(gradedMigration, /grant execute on function public\.dd2026_verdict_records[\s\S]*to service_role/);
assert.match(gradedMigration, /create or replace function public\.dd2026_verdict_result[\s\S]*a\.status = 'completed'[\s\S]*summary\.assessment_count = v\.question_count/,
  'Direct PDF lookup must reject unanswered and partially graded records.');
assert.match(workerIndex, /'dd2026_verdict_records'/,
  'The production Worker RPC allowlist must permit Analytics history reads.');
assert.match(workerIndex, /'dd2026_verdict_archive'/,
  'The production Worker RPC allowlist must permit recoverable Analytics removal and reset.');

assert.doesNotMatch(`${html}\n${frontend}\n${landing}\n${core}`, />The Verdict<|Close The Verdict|The Verdict is temporarily unavailable|requested Verdict|available Verdict export/,
  'Visible legacy Verdict naming must be replaced with Analytics.');
assert.match(frontend, /Analytics \/ Private PDF/);
assert.match(pdf, /Due Diligence — Analytics/);

console.log('Full-page Analytics and measurement-contract checks passed.');
