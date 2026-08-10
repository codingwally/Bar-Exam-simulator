import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811003600_professor_five_step_revision.sql',
  import.meta.url,
), 'utf8');

assert.match(migration, /begin;[\s\S]*commit;/i,
  'the five-step revision migration must be atomic');
assert.match(migration,
  /alter\s+table\s+public\.exam_room_question_versions[\s\S]*drop\s+constraint\s+if\s+exists\s+exam_room_question_versions_exam_id_snapshot_hash_key/i,
  'returning to an earlier reviewed question set must create a new revision rather than fail uniqueness');
assert.match(migration,
  /add\s+column\s+if\s+not\s+exists\s+workspace_revision\s+bigint\s+not\s+null\s+default\s+1/i,
  'Professor revisions need optimistic workspace concurrency');
assert.match(migration,
  /create\s+table\s+if\s+not\s+exists\s+public\.exam_room_authoring_drafts[\s\S]*force\s+row\s+level\s+security/i,
  'saved rule drafts must remain in a private forced-RLS table');

for (const name of [
  'exam_room_professor_authoring_snapshot_v1',
  'exam_room_update_details_v1',
  'exam_room_revise_draft_questions_v1',
  'exam_room_save_rules_draft_v1',
  'exam_room_reopen_roster_v1',
  'exam_room_publish_for_beadle_v4',
  'exam_room_beadle_portal_v5',
]) {
  assert.match(migration, new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
    'i',
  ), `${name} must use a hardened SECURITY DEFINER contract`);
}

assert.match(migration,
  /exam_room_update_details_v1[\s\S]*p_expected_revision\s+is\s+null[\s\S]*EXAM_ROOM_WORKSPACE_CONFLICT/i,
  'detail edits must reject stale workspaces');
assert.match(migration,
  /when\s+exam\.status\s*=\s*'draft'\s+and\s+exam\.active_question_version_id\s+is\s+not\s+null\s+then\s+'confirmed'/i,
  'returning the requested count to the reviewed version must restore Step 2 readiness');
assert.match(migration,
  /exam_room_revise_draft_questions_v1[\s\S]*insert\s+into\s+public\.exam_room_question_versions[\s\S]*set\s+status\s*=\s*'retired'/i,
  'question corrections must append a new version and retain the prior one');
assert.match(migration,
  /if\s+v_exam\.status\s*=\s*'draft'\s+then[\s\S]*set\s+status\s*=\s*'confirmed'[\s\S]*returning\s+\*\s+into\s+v_exam/i,
  'a no-change question review must recover a matching draft instead of trapping the Professor');
assert.match(migration,
  /'canEditRules',\s*v_editable\s+and\s+v_exam\.status\s+in\s*\(\s*'confirmed',\s*'scheduled'\s*\)/i,
  'a safe unpublished scheduled retry must retain the rules-review path');
assert.match(migration,
  /current_setting\('app\.exam_room_backup_update',\s*true\)[\s\S]*new\.workspace_revision\s*:=\s*old\.workspace_revision/i,
  'background backup bookkeeping must not create false Professor workspace conflicts');
assert.match(migration,
  /exam_room_publish_for_beadle_v4[\s\S]*p_expected_revision[\s\S]*p_expected_revision\s*<>\s*v_exam\.workspace_revision[\s\S]*EXAM_ROOM_WORKSPACE_CONFLICT/i,
  'publication must bind to the exact workspace revision reviewed by the Professor');
assert.match(migration,
  /exam_room_reopen_roster_v1[\s\S]*code_ciphertext\s*=\s*null[\s\S]*codeRevoked',\s*true/i,
  'reopening the class list must revoke and erase the prior student-code envelope');

for (const signature of [
  'exam_room_professor_authoring_snapshot_v1\\(uuid, uuid\\)',
  'exam_room_update_details_v1\\(',
  'exam_room_revise_draft_questions_v1\\(',
  'exam_room_save_rules_draft_v1\\(',
  'exam_room_reopen_roster_v1\\(uuid, uuid, text, text\\)',
  'exam_room_publish_for_beadle_v4\\(',
  'exam_room_beadle_portal_v5\\(uuid, uuid\\)',
]) {
  assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}`, 'i'),
    `${signature} must revoke browser execution`);
}

console.log('Examination Room five-step revision migration contract: PASS');
