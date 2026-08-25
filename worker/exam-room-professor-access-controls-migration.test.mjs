import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260825183000_examination_room_professor_access_controls.sql',
  import.meta.url,
), 'utf8');
const indexMigration = readFileSync(new URL(
  '../supabase/migrations/20260825184500_examination_room_professor_access_control_indexes.sql',
  import.meta.url,
), 'utf8');

function functionBody(name, nextName) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start + 1)
    : migration.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return migration.slice(start, end);
}

test('Professor candidate access controls are isolated, private, and reversible', () => {
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/);
  assert.match(migration, /create table if not exists public\.exam_room_candidate_access_controls/);
  assert.match(migration, /alter table public\.exam_room_candidate_access_controls force row level security/);
  assert.match(migration, /revoke all privileges on table public\.exam_room_candidate_access_controls[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /bar_simulation|question_rotation|subject_matter/i);

  const control = functionBody(
    'exam_room_control_candidate_access_v1',
    'exam_room_open_session_v4',
  );
  assert.match(control, /owner_professor_id = p_professor_user_id/);
  assert.match(control, /p_action not in \('kick', 'block', 'unblock'\)/);
  assert.match(control, /set status = 'closed'/);
  assert.match(control, /'candidate_access_blocked'/);
  assert.match(control, /'candidate_access_unblocked'/);
  assert.match(control, /'candidate_session_kicked'/);
  assert.match(control, /exam_room_append_audit_v2/);
  assert.match(control, /prior_admission_status/);
  assert.match(indexMigration, /exam_room_candidate_access_roster_idx/);
  assert.match(indexMigration, /exam_room_candidate_access_blocked_by_idx/);
  assert.match(indexMigration, /exam_room_candidate_access_last_kicked_by_idx/);
  assert.doesNotMatch(indexMigration, /bar_simulation|question_rotation|subject_matter/i);
});

test('blocked accounts cannot open a replacement session', () => {
  const body = functionBody('exam_room_open_session_v4', 'exam_room_live_status_v3');
  assert.match(body, /control\.status = 'blocked'/);
  assert.match(body, /'EXAM_ROOM_ACCESS_BLOCKED'/);
  assert.match(body, /exam_room_open_session_v3/);
});

test('Professor live status shows authenticated email without exposing session credentials or answers', () => {
  const body = functionBody('exam_room_live_status_v3');
  assert.match(body, /owner_professor_id = p_professor_user_id/);
  assert.match(body, /'accessEmail'.*lower\(account\.email\)/s);
  assert.match(body, /'rosterEmail'.*roster\.canonical_email/s);
  assert.match(body, /'activeSessionCount'/);
  assert.match(body, /'canKick'/);
  assert.match(body, /'canBlock'/);
  assert.match(body, /'canUnblock'/);
  assert.doesNotMatch(body, /'answerText'|'sessionId'|'deviceInstanceHash'/);
});
