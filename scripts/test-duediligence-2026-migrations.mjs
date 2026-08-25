import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const names = [
  '20260811002500_duediligence_2026_content_foundation.sql',
  '20260811002700_duediligence_2026_delivery_support.sql',
  '20260811002800_duediligence_2026_verdict_phase4_bridge.sql',
  '20260811095128_live_experience_foundation.sql',
  '20260812185703_repair_subject_matter_title_encoding.sql',
];
const migrations = await Promise.all(names.map((name) => (
  readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')
)));
const [content, delivery, verdict, liveExperience, titleEncodingRepair] = migrations;

for (const [name, sql] of names.map((name, index) => [name, migrations[index]])) {
  assert.match(sql, /^--[^\n]*\n(?:--[^\n]*\n)*\s*begin;/i, `${name} must begin transactionally.`);
  assert.match(sql, /commit;\s*$/i, `${name} must commit explicitly.`);
  assert.doesNotMatch(sql, /\b(?:sbp_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/);
}

for (const table of [
  'dd2026_feature_flags', 'dd2026_content_items', 'dd2026_content_versions',
  'dd2026_content_audit', 'dd2026_bar_easy_usage', 'dd2026_doctrine_mastery',
  'dd2026_verdict_pdf_exports',
]) assert.match(content, new RegExp(`create table if not exists public\\.${table}`));

assert.match(content, /draft'[\s\S]*'in_review'[\s\S]*'approved'[\s\S]*'published'[\s\S]*'archived'/);
assert.match(content, /CONTENT_HUMAN_REVIEW_REQUIRED/);
assert.match(content, /revoke all privileges on table public\.%I from public, anon, authenticated/);
assert.match(content, /alter table public\.%I force row level security/);
assert.match(content, /DD2026_BAR_EASY_COMPLETION_INVALID/);
assert.match(content, /DD2026_DOCTRINE_MASTERY_INVALID/);

assert.match(delivery, /dd2026_service_flag_enabled/);

assert.match(verdict, /foreign key \(grading_result_id\) references public\.grading_results\(id\) on delete restrict/i);
assert.match(verdict, /foreign key \(exam_attempt_id\) references public\.exam_attempts\(id\) on delete restrict/i);
assert.match(verdict, /num_nonnulls\(grading_result_id, exam_attempt_id\) = 1/i);
assert.match(verdict, /sourceType', 'phase4_exam_attempt'/);
assert.match(verdict, /a\.status = 'completed'/);
assert.match(verdict, /revoke all on function public\.dd2026_verdict_result\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i);

assert.match(liveExperience, /restore_until/);
assert.match(liveExperience, /interval '30 days'/i);
assert.match(liveExperience, /dd2026_verdict_records/);
assert.match(liveExperience, /forum_resolve_anonymous_identity/);
assert.match(liveExperience, /revoke all[\s\S]*from public, anon, authenticated/i);

assert.doesNotMatch(titleEncodingRepair, /[^\x00-\x7f]/,
  'the title-encoding repair must remain ASCII-only in source control');
assert.match(titleEncodingRepair,
  /release_sync_subject_matter_v2\(uuid,jsonb,text,text,jsonb,text\)/);
assert.match(titleEncodingRepair, /decode\('c3a2e282ace2809d', 'hex'\)/);
assert.match(titleEncodingRepair, /U&'\\2014'/);
assert.match(titleEncodingRepair,
  /title = subject \|\| U&' \\2014 Subject Matter Practice'/);
assert.match(titleEncodingRepair, /where track = 'per_subject'/);
assert.match(titleEncodingRepair, /SUBJECT_MATTER_SYNC_FUNCTION_REPAIR_FAILED/);
assert.match(titleEncodingRepair, /SUBJECT_MATTER_TITLE_REPAIR_INCOMPLETE/);
assert.doesNotMatch(titleEncodingRepair, /\b(?:insert|delete|truncate)\b/i);
assert.doesNotMatch(titleEncodingRepair,
  /\bupdate\s+public\.(?:questions|examination_questions|subject_matter_placements)\b/i,
  'the title repair must not mutate Subject Matter questions or placements');

console.log('DueDiligence 2026 migration contracts passed.');
