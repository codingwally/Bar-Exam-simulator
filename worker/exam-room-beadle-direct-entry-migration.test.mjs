import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260812183709_beadle_student_direct_entry.sql',
  import.meta.url,
), 'utf8').replace(/\r\n/g, '\n');
const workerEntry = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

function functionBody(name, nextMarker) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${name} must be bounded`);
  return migration.slice(start, end);
}

test('migration is additive, transactional, and Worker-only', () => {
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+table\b/i);
  assert.match(migration, /security definer\s+set search_path = ''/g);
  for (const signature of [
    'exam_room_beadle_student_waiting_room_v1',
    'exam_room_start_beadle_student_attempt_v1',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature}\\([\\s\\S]*?\\) from public, anon, authenticated;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature}\\([\\s\\S]*?\\) to service_role;`),
    );
  }
});

test('direct waiting-room entry requires the active Beadle assignment', () => {
  const body = functionBody(
    'exam_room_beadle_student_waiting_room_v1',
    '\ncreate or replace function public.exam_room_start_beadle_student_attempt_v1',
  );
  assert.match(body, /exam_room_has_active_beadle_assignment_v2\(p_user_id, v_exam\.id\)/);
  assert.match(body, /raise exception 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED'/);
  assert.match(body, /select credential\.token_hash into v_student_key_hash[\s\S]*from public\.exam_room_student_access_issuances/);
  assert.match(body, /exam_room_student_waiting_room_v4\([\s\S]*p_user_id[\s\S]*v_student_key_hash/);
  assert.match(body, /'accessAuthorization', 'active_beadle_assignment'/);
  assert.doesNotMatch(body, /'studentKey'|'tokenHash'|'credentialHash'/);
});

test('direct start rechecks authorization and the authoritative opening gate', () => {
  const body = functionBody(
    'exam_room_start_beadle_student_attempt_v1',
    '\ncomment on function public.exam_room_beadle_student_waiting_room_v1',
  );
  assert.match(body, /exam_room_beadle_student_waiting_room_v1\(/);
  assert.match(body, /if not coalesce\(\(v_preflight ->> 'canStart'\)::boolean, false\)/);
  assert.match(body, /from public\.exam_room_beadle_assignments assignment[\s\S]*for update of assignment/);
  assert.match(body, /assignment\.beadle_user_id = p_user_id[\s\S]*assignment\.status = 'active'/);
  assert.match(body, /raise exception 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED'/);
  assert.match(body, /return public\.exam_room_start_attempt_v4\(/);
  assert.ok(
    body.indexOf('exam_room_beadle_student_waiting_room_v1(')
      < body.indexOf('return public.exam_room_start_attempt_v4('),
    'fresh direct-entry preflight must precede attempt creation',
  );
});

test('the credential is used only inside Postgres and never projected', () => {
  assert.match(migration, /select credential\.token_hash into v_student_key_hash/g);
  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([\s\S]*?'(?:studentKey|tokenHash|credentialHash)'/,
  );
});

test('the production Worker allowlist includes both direct-entry RPCs', () => {
  assert.match(workerEntry, /'exam_room_beadle_student_waiting_room_v1'/);
  assert.match(workerEntry, /'exam_room_start_beadle_student_attempt_v1'/);
  assert.match(workerEntry, /EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED:\s*\[403,/);
});
