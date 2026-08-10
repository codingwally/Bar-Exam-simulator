import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811003700_professor_publication_reschedule.sql',
  import.meta.url,
), 'utf8');

assert.match(migration, /begin;[\s\S]*commit;/i,
  'the schedule-control migration must be atomic');
assert.match(migration,
  /drop\s+constraint\s+if\s+exists\s+exam_room_publications_exam_id_snapshot_hash_key/i,
  'a Professor must be able to correct a schedule and later return to an earlier schedule');

for (const name of [
  'exam_room_professor_authoring_snapshot_v2',
  'exam_room_reschedule_publication_v1',
]) {
  assert.match(migration, new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
    'i',
  ), `${name} must use a hardened SECURITY DEFINER contract`);
}

assert.match(migration,
  /status\s+in\s*\(\s*'scheduled',\s*'closed',\s*'grading'\s*\)[\s\S]*not\s+v_attempts_exist/i,
  'a deadline-closed or empty-grading zero-attempt beta exam must remain safely reschedulable');
assert.match(migration,
  /p_expected_workspace_revision\s*<>\s*v_exam\.workspace_revision[\s\S]*EXAM_ROOM_WORKSPACE_CONFLICT/i,
  'the mutation must reject a stale Professor tab');
assert.match(migration,
  /publication\.public_id\s*=\s*p_expected_publication_id[\s\S]*EXAM_ROOM_PUBLICATION_VERSION_CONFLICT/i,
  'the mutation must bind to the exact reviewed publication');
assert.match(migration,
  /p_opens_at\s*<\s*clock_timestamp\(\)\s*\+\s*interval\s*'30 minutes'/i,
  'the database must atomically retain preparation time for the class');
assert.match(migration,
  /exists\s*\([\s\S]*exam_room_attempts[\s\S]*EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST/i,
  'any candidate attempt must permanently close the simple schedule-change path');
assert.match(migration,
  /v_previous\.question_version_id[\s\S]*v_previous\.questions_snapshot[\s\S]*insert\s+into\s+public\.exam_room_publications/i,
  'a schedule correction must retain the exact published questions');
assert.match(migration,
  /insert\s+into\s+public\.exam_room_publication_model_answers[\s\S]*v_model\.content_hash/i,
  'private model-answer provenance must follow the immutable publication version');
assert.match(migration,
  /update\s+public\.exam_room_credentials\s+credential[\s\S]*credential_type\s*=\s*'student_exam'[\s\S]*status\s*=\s*'active'/i,
  'the active class-wide code must be retained and moved to the corrected schedule');
assert.match(migration,
  /update\s+public\.exam_room_credentials\s+credential\s+set\s+valid_from\s*=\s*p_opens_at,\s*expires_at\s*=\s*p_hard_closes_at[\s\S]*credential_type\s*=\s*'attempt_unlock'[\s\S]*status\s*=\s*'active'/i,
  'the active attempt-unlock hash must be retained while its validity follows the corrected schedule');
assert.match(migration,
  /if\s+exists\s*\([\s\S]*exam_room_beadle_assignments\s+assignment[\s\S]*p_hard_closes_at\s*>\s*assignment\.assigned_at\s*\+\s*interval\s*'180 days'[\s\S]*EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON[\s\S]*insert\s+into\s+public\.exam_room_publications/i,
  'an over-horizon active Beadle assignment must fail before publication mutation');
assert.match(migration,
  /update\s+public\.exam_room_beadle_assignments\s+assignment[\s\S]*assignment\.assigned_at\s*\+\s*interval\s*'180 days'/i,
  'Beadle access must follow the corrected hard close within its safety cap');
assert.match(migration,
  /set\s+opens_at\s*=\s*p_opens_at[\s\S]*status\s*=\s*'scheduled'[\s\S]*current_publication_id\s*=\s*v_current\.id/i,
  'a safely closed zero-attempt exam must return to scheduled with the new publication');
assert.match(migration,
  /'exam_schedule_changed'[\s\S]*exam_room_queue_backup/i,
  'the schedule correction needs audit and backup evidence');

for (const signature of [
  'exam_room_professor_authoring_snapshot_v2\\(uuid, uuid\\)',
  'exam_room_reschedule_publication_v1\\(',
]) {
  assert.match(migration, new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`,
    'i',
  ), `${signature} must revoke browser execution`);
}

console.log('Examination Room Professor schedule-control migration contract: PASS');
