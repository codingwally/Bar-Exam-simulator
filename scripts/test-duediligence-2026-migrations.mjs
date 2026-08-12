import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const names = [
  '20260811002500_duediligence_2026_content_foundation.sql',
  '20260811002600_examination_room_foundation.sql',
  '20260811002700_duediligence_2026_delivery_support.sql',
  '20260811002800_duediligence_2026_verdict_phase4_bridge.sql',
  '20260811002900_examination_room_integrity_unlock_fix.sql',
  '20260811003000_examination_room_admin_owner_repair.sql',
  '20260811095128_live_experience_foundation.sql',
  '20260811095200_examination_room_request_flow.sql',
  '20260812185703_repair_subject_matter_title_encoding.sql',
];
const migrations = await Promise.all(names.map((name) => (
  readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')
)));
const [content, exam, delivery, verdict, integrityFix, adminOwnerRepair,
  liveExperience, requestFlow, titleEncodingRepair] = migrations;
const adminOwnerPreflight = await readFile(new URL(
  'supabase/review/examination_room_admin_owner_repair_preflight.sql',
  root,
), 'utf8');

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

assert.match(adminOwnerRepair, /create or replace function public\.exam_room_create_classroom/i);
assert.match(adminOwnerRepair, /if public\.exam_room_is_admin\(p_professor_user_id\)[\s\S]*insert into public\.exam_room_professors/i);
assert.match(adminOwnerRepair, /values \(\s*p_professor_user_id, 'revoked', p_professor_user_id\s*\)[\s\S]*on conflict \(user_id\) do nothing/i);
assert.match(adminOwnerRepair, /revoke all on function public\.exam_room_create_classroom\(uuid, text, text, text\)[\s\S]*from public, anon, authenticated/i);
assert.match(adminOwnerRepair, /grant execute on function public\.exam_room_create_classroom\(uuid, text, text, text\)[\s\S]*to service_role/i);

assert.match(adminOwnerPreflight, /begin transaction read only/i);
assert.match(adminOwnerPreflight, /EXAM_ROOM_REPAIR_PREFLIGHT_PASSED_READ_ONLY/);
assert.match(adminOwnerPreflight, /20260811002500[\s\S]*20260811002900/);
assert.match(adminOwnerPreflight, /rollback;\s*$/i);
const normalizedAdminOwnerPreflight = adminOwnerPreflight
  .replace(/^\s*--.*$/gm, '')
  .replace(/'(?:''|[^'])*'/g, "''");
assert.doesNotMatch(
  normalizedAdminOwnerPreflight,
  /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i,
  'administrator-owner production preflight must remain read-only',
);

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

for (const table of ['exam_room_requests', 'exam_room_request_payment_proofs']) {
  assert.match(requestFlow, new RegExp(`create table if not exists public\\.${table}`));
}
assert.match(requestFlow, /alter table public\.exam_room_requests force row level security/i);
assert.match(requestFlow, /alter table public\.exam_room_request_payment_proofs force row level security/i);
assert.match(requestFlow, /revoke all on table public\.exam_room_requests from public, anon, authenticated/i);
assert.match(requestFlow, /revoke all on table public\.exam_room_request_payment_proofs from public, anon, authenticated/i);
assert.match(requestFlow, /create or replace function public\.exam_room_request_is_manager[\s\S]*assigned_administrator_user_id = p_user_id/i);
const managerBlock = requestFlow.slice(
  requestFlow.indexOf('create or replace function public.exam_room_request_is_manager'),
  requestFlow.indexOf('create or replace function public.exam_room_request_snapshot'),
);
assert.doesNotMatch(managerBlock, /exam_room_is_admin/,
  'an unassigned platform admin must claim a request before managing it');
assert.match(requestFlow, /create or replace function public\.exam_room_claim_request[\s\S]*exam_room_require_admin\(p_actor_user_id\)/i);
assert.match(requestFlow, /on conflict \(professor_user_id, request_key\) do nothing[\s\S]*EXAM_ROOM_REQUEST_IDEMPOTENCY_CONFLICT/i);
assert.match(requestFlow, /on conflict \(submitted_by, request_key\) do nothing[\s\S]*EXAM_ROOM_PAYMENT_PROOF_IDEMPOTENCY_CONFLICT/i);
const paymentProofReviewContextBlock = requestFlow.slice(
  requestFlow.indexOf('create or replace function public.exam_room_payment_proof_review_context'),
  requestFlow.indexOf('create or replace function public.exam_room_review_payment_proof'),
);
assert.doesNotMatch(paymentProofReviewContextBlock, /\bstable\b/i,
  'payment-proof review context mutates review state and audit records, so it must remain volatile');
assert.match(requestFlow, /create trigger exam_room_student_access_payment_gate[\s\S]*before insert or update on public\.exam_room_student_access_issuances/i);
assert.match(requestFlow, /EXAM_ROOM_PAYMENT_VERIFICATION_REQUIRED/);
assert.doesNotMatch(requestFlow, /\b(?:update|delete|truncate)\s+public\.(?:subjects|questions|examination_questions|subject_matter_courses|subject_matter_placements)\b/i,
  'the request workflow must not mutate reviewed legal content');

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
