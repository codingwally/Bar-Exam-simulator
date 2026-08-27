import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260827193000_examination_room_lifecycle_controls.sql', import.meta.url);
const sql = await readFile(migrationPath, 'utf8');

assert.match(sql, /add column if not exists blocked_at timestamptz/i);
assert.match(sql, /add column if not exists deleted_at timestamptz/i);
assert.match(sql, /create or replace function public\.examination_room_v1_lifecycle_command/i);
assert.match(sql, /'archive_exam', 'delete_draft', 'restore_exam'/i);
assert.match(sql, /'block_exam', 'unblock_exam', 'reopen_exam'/i);
assert.match(sql, /exam_record\.owner_user_id <> p_actor_user_id/i);
assert.match(sql, /p_operation in \('restore_exam', 'block_exam', 'unblock_exam', 'reopen_exam'\)[\s\S]*not actor_is_owner/i);
assert.match(sql, /Only an unpublished draft can be deleted from the creator workspace/i);
assert.match(sql, /student_sessions session[\s\S]*session_status = 'expired'/i);
assert.match(sql, /create or replace function public\.examination_room_v1_lifecycle_guard/i);
assert.match(sql, /EXAMINATION_ARCHIVED/i);
assert.match(sql, /EXAMINATION_BLOCKED/i);
assert.match(sql, /existingAnswersPreserved/i);
assert.match(sql, /api_record_audit/i);
assert.match(sql, /grant execute on function public\.examination_room_v1_lifecycle_command[\s\S]*to service_role/i);
assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i);

console.log('Examination Room lifecycle migration contract passed.');
