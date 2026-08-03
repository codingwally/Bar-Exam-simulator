import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const names = [
  '20260811002500_duediligence_2026_content_foundation.sql',
  '20260811002600_examination_room_foundation.sql',
  '20260811002700_duediligence_2026_delivery_support.sql',
  '20260811002800_duediligence_2026_verdict_phase4_bridge.sql',
  '20260811002900_examination_room_integrity_unlock_fix.sql',
];
const migrations = await Promise.all(names.map((name) => (
  readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')
)));
const [content, exam, delivery, verdict, integrityFix] = migrations;

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

for (const table of [
  'exam_room_professor_activations', 'exam_room_classrooms', 'exam_room_roster',
  'exam_room_exams', 'exam_room_question_versions', 'exam_room_questions',
  'exam_room_credentials', 'exam_room_attempts', 'exam_room_answers',
  'exam_room_integrity_events', 'exam_room_grades', 'exam_room_grade_history',
  'exam_room_releases', 'exam_room_dispute_reviews', 'exam_room_backup_outbox',
  'exam_room_email_jobs', 'exam_room_audit_log',
]) assert.match(exam, new RegExp(`create table if not exists public\\.${table}`));

assert.match(exam, /unique \(classroom_id, canonical_email\)/i);
assert.match(exam, /create unique index if not exists exam_room_roster_class_account_idx[\s\S]*?\(classroom_id, student_user_id\)[\s\S]*?where student_user_id is not null/i);
assert.match(exam, /unique \(classroom_id, candidate_number\)/i);
assert.match(exam, /unique \(exam_id, student_user_id\)/i);
assert.match(exam, /unique \(exam_id, candidate_number\)/i);
assert.match(exam, /primary key \(attempt_id, question_id\)/i);
assert.match(exam, /v_deadline := least\([\s\S]*?v_exam\.hard_closes_at[\s\S]*?now\(\) \+ make_interval\(mins => v_exam\.duration_minutes\)[\s\S]*?\);/i);
assert.match(exam, /exam_room_auto_submit_due/);
assert.match(exam, /credential_type in \('student_exam', 'professor_grading', 'attempt_unlock', 'dispute_review'\)/);
assert.match(exam, /update public\.exam_room_credentials[\s\S]*?set status = 'revoked'[\s\S]*?where exam_id = v_exam\.id and status = 'active'/i);
assert.match(exam, /credential_type = 'dispute_review' and status = 'active'/i);
assert.match(exam, /exam_room_open_dispute/);
assert.match(exam, /exam_room_dispute_view/);
assert.match(exam, /exam_room_close_dispute/);
assert.match(exam, /force row level security/i);
assert.match(exam, /revoke all privileges on table public\.%I from public, anon, authenticated/i);
assert.match(exam, /char_length\(coalesce\(p_answer_text, ''\)\) > 20000/i);
assert.match(exam, /char_length\(coalesce\(p_comment, ''\)\) > 5000/i);

assert.match(exam, /exam_room_claim_backup_batch/);
assert.match(exam, /exam_room_complete_backup/);
assert.match(exam, /exam_room_fail_backup/);
assert.match(exam, /exam_room_claim_email_batch/);
assert.match(exam, /exam_room_complete_email/);
assert.match(exam, /exam_room_fail_email/);
assert.match(delivery, /dd2026_service_flag_enabled/);
assert.match(delivery, /exam_room_backup_context/);

assert.match(integrityFix, /credential_type, token_hash, scoped_user_id, status/);
assert.match(integrityFix, /'attempt_unlock'/);
assert.match(integrityFix, /create or replace function public\.exam_room_live_status/);
assert.match(integrityFix, /v_exam\.public_id::text/);
assert.match(integrityFix, /p_professor_user_id::text/);
assert.match(integrityFix, /'attempt_unlock', v_unlock_hash/);
assert.match(integrityFix, /revoke all on function public\.exam_room_live_status/);
assert.match(integrityFix, /'exam_confirmed'/);
assert.match(integrityFix, /tg_table_name = 'exam_room_grades'[\s\S]*tg_op = 'UPDATE'[\s\S]*set_config\('app\.exam_room_admin_correction', 'off', true\)/i);
assert.match(integrityFix, /set_config\('app\.exam_room_backup_update', 'on', true\)[\s\S]*set_config\('app\.exam_room_backup_update', 'off', true\)/i);

assert.match(verdict, /foreign key \(grading_result_id\) references public\.grading_results\(id\) on delete restrict/i);
assert.match(verdict, /foreign key \(exam_attempt_id\) references public\.exam_attempts\(id\) on delete restrict/i);
assert.match(verdict, /num_nonnulls\(grading_result_id, exam_attempt_id\) = 1/i);
assert.match(verdict, /sourceType', 'phase4_exam_attempt'/);
assert.match(verdict, /a\.status = 'completed'/);
assert.match(verdict, /revoke all on function public\.dd2026_verdict_result\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i);

console.log('DueDiligence 2026 migration contracts passed.');
