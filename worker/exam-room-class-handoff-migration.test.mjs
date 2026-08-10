import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811003300_examination_room_class_handoff.sql',
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

test('class handoff migration is additive, private, and transaction bounded', () => {
  assert.match(migration, /^-- Examination Room classroom handoff\./);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/);
  for (const table of [
    'exam_room_student_access_issuances',
    'exam_room_result_exports',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table}[\\s\\S]*from public, anon, authenticated`));
  }
  const issuanceTable = migration.slice(
    migration.indexOf('create table if not exists public.exam_room_student_access_issuances'),
    migration.indexOf('create unique index if not exists exam_room_student_access_one_active_idx'),
  );
  assert.doesNotMatch(issuanceTable, /token_hash|access_code|raw_code/i);
});

test('publication freezes code protection and atomically creates the Beadle handoff', () => {
  assert.doesNotMatch(migration, /create or replace function public\.exam_room_schedule_exam\(/);
  const scheduler = functionBody(
    'exam_room_schedule_for_handoff_v3',
    'exam_room_redeem_beadle_invitation_v2',
  );
  assert.match(scheduler, /p_opens_at < clock_timestamp\(\) \+ interval '30 minutes'/);
  assert.match(scheduler, /EXAM_ROOM_HANDOFF_TIME_REQUIRED/);
  const body = functionBody('exam_room_publish_for_beadle_v3', 'exam_room_issue_student_access_v3');
  assert.match(body, /studentAccessCodeRequired/);
  assert.match(body, /not \(p_rules ->> 'studentAccessCodeRequired'\)::boolean/);
  assert.match(body, /extensions\.gen_random_bytes\(32\)/);
  assert.match(body, /public\.exam_room_schedule_for_handoff_v3\(/);
  assert.match(body, /public\.exam_room_publish_exam_v2\(/);
  assert.match(body, /public\.exam_room_issue_beadle_invitation_v2\(/);
  assert.match(body, /exam_published_for_beadle_handoff/);
  assert.match(body, /v_opens_at < clock_timestamp\(\) \+ interval '30 minutes'/);
  assert.match(body, /EXAM_ROOM_HANDOFF_TIME_REQUIRED/);
  assert.ok(
    body.indexOf('EXAM_ROOM_HANDOFF_TIME_REQUIRED')
      < body.indexOf('public.exam_room_schedule_for_handoff_v3('),
    'the locked atomic publisher must reject a short handoff before any schedule mutation',
  );
  assert.doesNotMatch(body, /return[\s\S]{0,200}(beadle|student).*token_hash/i);
});

test('one-use Beadle invitation redemption creates an exam-window assignment', () => {
  assert.match(
    migration,
    /exam_room_beadle_assignment_expiry_check[\s\S]*expires_at <= assigned_at \+ interval '180 days'/,
  );
  const body = functionBody(
    'exam_room_redeem_beadle_invitation_v2',
    'exam_room_can_manage_roster_v2',
  );
  assert.match(body, /v_invitation\.status <> 'issued'/);
  assert.match(body, /v_invitation\.expires_at <= now\(\)/);
  assert.match(body, /v_assignment_expires_at := least\([\s\S]*v_exam\.hard_closes_at[\s\S]*interval '180 days'/);
  assert.match(body, /v_invitation\.invited_by, v_assignment_expires_at/);
  assert.doesNotMatch(body, /v_invitation\.invited_by, v_invitation\.expires_at/);
  assert.match(body, /set status = 'redeemed'/);
  assert.match(body, /v_exam\.status = 'sealed'/);
  assert.match(body, /v_exam\.release_id is not null/);
  assert.match(body, /'invitationExpiresAt', v_invitation\.expires_at/);
  assert.match(body, /'assignmentExpiresAt', v_assignment\.expires_at/);
  assert.match(
    migration,
    /revoke all on function public\.exam_room_redeem_beadle_invitation_v2\([\s\S]*grant execute on function public\.exam_room_redeem_beadle_invitation_v2\([\s\S]*to service_role/,
  );
});

test('Beadle code issue is roster-bound, pre-open, zero-attempt, idempotent, and rotatable', () => {
  const body = functionBody('exam_room_issue_student_access_v3', 'exam_room_exam_access_v3');
  assert.match(body, /exam_room_command_begin_v2/);
  assert.match(body, /exam_room_has_active_beadle_assignment_v2/);
  assert.match(body, /v_roster_count < 1/);
  assert.match(body, /EXAM_ROOM_STUDENT_ACCESS_ROSTER_REQUIRED/);
  assert.match(body, /now\(\) >= v_exam\.opens_at/);
  assert.match(body, /exists \(select 1 from public\.exam_room_attempts/);
  assert.match(body, /EXAM_ROOM_CREDENTIAL_REUSE_FORBIDDEN/);
  assert.match(body, /status = 'superseded'/);
  assert.match(body, /student_access_rotated/);
  assert.match(body, /'rosterLocked', true/);
});

test('a corrected Beadle upload becomes the authoritative active class list', () => {
  const body = functionBody('exam_room_import_exam_roster_v2', 'exam_room_upsert_roster_row_v2');
  assert.match(body, /set status = 'removed'/);
  assert.match(body, /from jsonb_array_elements\(p_rows\) incoming\(value\)/);
  assert.match(body, /where lower\(btrim\(incoming\.value ->> 'email'\)\) = r\.canonical_email/);
  assert.match(body, /'removedCount'/);
});

test('student readiness and result exports remain fail-closed and role scoped', () => {
  const preflight = functionBody('exam_room_student_preflight_v3', 'exam_room_start_attempt_v3');
  assert.match(preflight, /'STUDENT_ACCESS_NOT_READY'/);
  assert.match(preflight, /'canStart'/);
  assert.match(preflight, /'entryClosesAt'/);
  const start = functionBody('exam_room_start_attempt_v3', 'exam_room_prepare_result_export_v3');
  assert.match(start, /exam_room_student_preflight_v3/);
  assert.match(start, /if not coalesce\(\(v_preflight ->> 'canStart'\)::boolean, false\)/);
  const result = functionBody('exam_room_prepare_result_export_v3', 'exam_room_complete_result_export_v3');
  assert.match(result, /exam_room_require_professor/);
  assert.match(result, /exam_room_check_credential/);
  assert.match(result, /p_export_scope not in \('questions_answers', 'answers_only', 'grades_comments'\)/);
  assert.match(result, /v_final_grade_count <> v_question_count/);
  assert.match(result, /when p_export_scope = 'questions_answers'/);
  assert.match(result, /when p_export_scope = 'answers_only'/);
  assert.match(result, /result_export_accessed/);
  const complete = functionBody('exam_room_complete_result_export_v3');
  assert.match(complete, /p_output_sha256 text/);
  assert.match(complete, /EXAM_ROOM_RESULT_EXPORT_CHANGED/);
});

test('result export scopes keep grading content exclusively in grades_comments', () => {
  const body = functionBody('exam_room_prepare_result_export_v3', 'exam_room_complete_result_export_v3');
  const questionsAnswers = body.match(
    /when p_export_scope = 'questions_answers' then jsonb_build_object\(([\s\S]*?)\)\s*when p_export_scope = 'answers_only'/,
  )?.[1] || '';
  assert.match(questionsAnswers, /'prompt'/);
  assert.match(questionsAnswers, /'answer'/);
  assert.doesNotMatch(questionsAnswers, /'score'|'maximumPoints'|'comment'/);
  assert.match(body, /if p_export_scope = 'grades_comments' then/);
});
