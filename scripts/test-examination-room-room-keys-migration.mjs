import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260811003200_examination_room_one_key_one_room.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);

assert.equal(fs.existsSync(migrationPath), true, 'ordered one-room-key migration must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');
const lower = sql.toLowerCase();

assert.match(lower, /^-- duediligence examination room: one admin key creates one single-exam room\./);
assert.match(lower, /begin;/);
assert.match(lower, /commit;\s*$/);

function functionBlock(name, parameterMarker = '') {
  const matches = [...sql.matchAll(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'gi',
  ))].map((match) => match[0]);
  const block = matches.find((candidate) => candidate.toLowerCase().includes(parameterMarker.toLowerCase()));
  assert.ok(block, `${name} definition missing${parameterMarker ? ` (${parameterMarker})` : ''}`);
  return block.toLowerCase();
}

assert.match(lower, /add column if not exists room_policy text not null default 'legacy'/);
assert.match(lower, /add column if not exists room_title text/);
assert.match(lower, /add column if not exists school_name text/);
assert.match(lower, /add column if not exists academic_term text/);
assert.match(lower, /add column if not exists classroom_id uuid/);
assert.match(lower, /room_policy = 'one_key_one_room'/);
assert.match(lower, /status = 'redeemed' and classroom_id is not null/);
assert.match(lower, /exam_room_activation_classroom_uq/);
assert.match(lower, /drop index if exists public\.exam_room_activation_one_active_email_idx/);
assert.match(lower, /exam_room_activation_email_status_idx/);

const bindingGuard = functionBlock('exam_room_guard_activation_room_binding', 'returns trigger');
assert.match(bindingGuard, /old\.status = 'issued'[\s\S]*new\.status in \('locked', 'redeemed', 'revoked', 'expired'\)/);
assert.match(bindingGuard, /old\.status = 'locked'[\s\S]*new\.status in \('issued', 'redeemed', 'revoked', 'expired'\)/);
assert.match(bindingGuard, /old\.redeemed_by is not null[\s\S]*old\.redeemed_by is distinct from new\.redeemed_by/);
assert.match(bindingGuard, /old\.redeemed_at is not null[\s\S]*old\.redeemed_at is distinct from new\.redeemed_at/);
assert.match(bindingGuard, /old\.revoked_by is not null[\s\S]*old\.revoked_by is distinct from new\.revoked_by/);
assert.match(bindingGuard, /old\.revoked_at is not null[\s\S]*old\.revoked_at is distinct from new\.revoked_at/);
assert.match(bindingGuard, /old\.revoke_reason is not null[\s\S]*old\.revoke_reason is distinct from new\.revoke_reason/);

assert.match(lower, /create table if not exists public\.exam_room_activation_attempt_windows/);
assert.match(lower, /primary key \(actor_user_id, rate_key_hash\)/);
assert.match(lower, /alter table public\.exam_room_activation_attempt_windows enable row level security/);
assert.match(lower, /alter table public\.exam_room_activation_attempt_windows force row level security/);
assert.match(lower, /revoke all privileges on table public\.exam_room_activation_attempt_windows[\s\S]*from public, anon, authenticated/);

for (const [name, marker] of [
  ['exam_room_guard_activation_room_binding', 'returns trigger'],
  ['exam_room_issue_professor_activation', 'p_room_title text'],
  ['exam_room_admin_professor_activation_ledger', 'p_status text'],
  ['exam_room_admin_revoke_professor_activation', 'p_activation_id uuid'],
  ['exam_room_redeem_professor_activation', 'p_rate_key_hash text'],
  ['exam_room_guard_single_exam_key_room', 'returns trigger'],
  ['exam_room_create_exam', 'p_requested_question_count integer'],
  ['exam_room_create_classroom', 'p_title text'],
]) {
  const block = functionBlock(name, marker);
  assert.match(block, /security definer/, `${name} must be SECURITY DEFINER`);
  assert.match(block, /set search_path = ''/, `${name} must use an empty search_path`);
}

const issue = functionBlock('exam_room_issue_professor_activation', 'p_room_title text');
assert.match(issue, /perform public\.exam_room_require_admin\(p_actor_user_id\)/);
assert.match(issue, /p_room_title is null/);
assert.match(issue, /p_school_name is null/);
assert.match(issue, /p_academic_term is null/);
assert.match(issue, /interval '7 days'/);
assert.match(issue, /'one_key_one_room'/);
assert.match(issue, /'professor_room_invitation_issued'/);
assert.doesNotMatch(issue, /update public\.exam_room_professor_activations[\s\S]*target_email/,
  'issuing one room key must not supersede a Professor\'s other pending rooms');
assert.doesNotMatch(issue, /'tokenhash'|'token_hash'/,
  'issuance JSON/audit output must never expose the persisted digest');

const redeem = functionBlock('exam_room_redeem_professor_activation', 'p_rate_key_hash text');
assert.match(redeem, /a\.target_email = v_email[\s\S]*a\.token_hash = p_token_hash/);
assert.doesNotMatch(redeem, /order by created_at desc limit 1/,
  'redemption must select the exact key, not the latest invitation for an email');
assert.match(redeem, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(redeem, /exam_room_activation_attempt_windows/);
assert.match(redeem, /insert into public\.exam_room_professors/);
assert.match(redeem, /insert into public\.exam_room_classrooms/);
assert.match(redeem, /set status = 'redeemed'[\s\S]*classroom_id = v_class\.id/);
assert.match(redeem, /and classroom_id is null/);
assert.match(redeem, /'classroomid', v_class\.public_id/);
assert.match(redeem, /'activation_already_redeemed'/);
assert.match(redeem, /'activation_revoked'/);
assert.match(redeem, /'activation_expired'/);
assert.match(redeem, /'activation_room_scope_required'/);
assert.doesNotMatch(redeem, /'tokenhash'|'token_hash'/,
  'redemption JSON/audit output must never expose the persisted digest');

const ledger = functionBlock('exam_room_admin_professor_activation_ledger', 'p_status text');
for (const key of [
  'activationId', 'roomTitle', 'schoolName', 'academicTerm', 'targetEmail',
  'status', 'createdAt', 'expiresAt', 'issuedByUserId', 'issuedByEmail',
  'redeemedByUserId', 'redeemedByEmail', 'redeemedAt', 'failedAttempts',
  'lockedUntil', 'revokedAt', 'revokeReason', 'classroomId',
]) {
  assert.match(ledger, new RegExp(`'${key.toLowerCase()}'`), `ledger must include ${key}`);
}
assert.match(ledger, /'activations', v_rows/);
assert.match(ledger, /'total', v_total/);
assert.match(ledger, /p_offset integer default 0/);
assert.match(ledger, /p_offset not between 0 and 100000/);
assert.match(ledger, /offset p_offset/);
assert.match(ledger, /'offset', p_offset/);
assert.match(ledger, /jsonb_agg\(rows\.item order by rows\.created_at desc, rows\.activation_id desc\)/,
  'ledger aggregation must retain deterministic ordering when keys share a timestamp');
assert.match(ledger, /order by a\.created_at desc, a\.id desc[\s\S]*limit p_limit[\s\S]*offset p_offset/,
  'ledger pagination must use a stable timestamp-and-ID order');
assert.doesNotMatch(ledger, /update public\.exam_room_professor_activations/,
  'Admin ledger must be a read-only projection');
assert.doesNotMatch(ledger, /token_hash|tokenhash|plaintext|secret/,
  'Admin ledger must not project key material or its digest');

const revoke = functionBlock('exam_room_admin_revoke_professor_activation', 'p_activation_id uuid');
assert.match(revoke, /perform public\.exam_room_require_admin\(p_actor_user_id\)/);
assert.match(revoke, /exam_room_command_begin_v2/);
assert.match(revoke, /status not in \('issued', 'locked'\)/);
assert.match(revoke, /'professor_room_invitation_revoked'/);
assert.match(revoke, /exam_room_command_complete_v2/);
assert.match(revoke, /'idempotent', true/);
assert.doesNotMatch(revoke, /token_hash|tokenhash/,
  'revocation must operate by record ID and never return key material');

const singleExamGuard = functionBlock('exam_room_guard_single_exam_key_room', 'returns trigger');
assert.match(singleExamGuard, /room_policy = 'one_key_one_room'/);
assert.match(singleExamGuard, /for update/);
assert.match(singleExamGuard, /exam_room_one_exam_limit/);
assert.match(lower, /create trigger exam_room_single_exam_key_room_guard/);
assert.match(lower, /before insert or update of classroom_id on public\.exam_room_exams/);

const createExam = functionBlock('exam_room_create_exam', 'p_requested_question_count integer');
assert.match(createExam, /from public\.exam_room_classrooms c[\s\S]*for update/);
assert.match(createExam, /room_policy = 'one_key_one_room'/);
assert.match(createExam, /exam_room_one_exam_limit/);
assert.match(createExam, /p_requested_question_count not between 1 and 200/);

const createClassroom = functionBlock('exam_room_create_classroom', 'p_title text');
assert.match(createClassroom, /exam_room_room_key_required/);
assert.doesNotMatch(createClassroom, /insert into public\.exam_room_classrooms/);

assert.match(lower, /revoke all on function public\.exam_room_issue_professor_activation\([\s\S]*uuid, text, text, timestamptz, text[\s\S]*from public, anon, authenticated, service_role/);
assert.match(lower, /grant execute on function public\.exam_room_issue_professor_activation\([\s\S]*uuid, text, text, text, text, text, timestamptz, text[\s\S]*to service_role/);
assert.match(lower, /grant execute on function public\.exam_room_admin_professor_activation_ledger\(uuid, text, integer, integer\)[\s\S]*to service_role/);
assert.match(lower, /exam_room_admin_professor_activation_ledger\(uuid,text,integer\)[\s\S]*revoke all on function %s from public, anon, authenticated, service_role/);
assert.match(lower, /grant execute on function public\.exam_room_admin_revoke_professor_activation\(uuid, uuid, text, text\)[\s\S]*to service_role/);

console.log('Examination Room one-key/one-room migration contracts passed.');
