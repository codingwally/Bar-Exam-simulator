import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811003400_examination_room_waiting_room_and_code_recovery.sql',
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

test('migration is additive, transaction bounded, and stores only a checked cipher envelope', () => {
  assert.match(migration, /^-- Examination Room waiting room and recoverable active class code\./);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/);
  assert.match(migration, /add column if not exists code_ciphertext text/);
  assert.match(migration, /num_nonnulls\([\s\S]*?code_encrypted_at[\s\S]*?\) = 0/);
  assert.match(migration, /num_nonnulls\([\s\S]*?code_encrypted_at[\s\S]*?\) = 5/);
  assert.match(migration, /code_ciphertext ~ '\^\[A-Za-z0-9_-\]\+\$'/);
  assert.match(migration, /char_length\(code_ciphertext\) between 38 and 4096/);
  assert.doesNotMatch(migration, /\{38,4096\}/);
  assert.match(migration, /code_nonce ~ '\^\[A-Za-z0-9_-\]\{16\}\$'/);
  assert.match(migration, /code_algorithm = 'A256GCM'/);
  assert.match(migration, /code_encrypted_at is not null/);
  assert.doesNotMatch(migration, /add column if not exists (plain|raw|student_code|access_code)/i);
});

test('pre-open code proof retains the established bounded lockout without enforcing valid_from', () => {
  const body = functionBody(
    'exam_room_check_student_credential_preopen_v4',
    'exam_room_issue_student_access_v4',
  );
  assert.match(body, /exam_room_student_access_issuances/);
  assert.match(body, /credential\.expires_at/);
  assert.doesNotMatch(body, /valid_from/);
  assert.match(body, /then 1[\s\S]*?least\(credential_window\.failures \+ 1, 5\)/);
  assert.match(body, /least\(credential_window\.failures \+ 1, 5\)/);
  assert.match(body, /interval '15 minutes'/);
  assert.match(body, /on conflict \(exam_id, actor_user_id, credential_type, rate_key_hash\)/);
  assert.match(body, /'credential_failed'/);
  assert.match(body, /delete from public\.exam_room_credential_windows/);
});

test('V4 issuance atomically binds recovery data and destroys retired envelopes', () => {
  const body = functionBody(
    'exam_room_issue_student_access_v4',
    'exam_room_beadle_portal_v4',
  );
  assert.match(body, /public\.exam_room_issue_student_access_v3\(/);
  assert.match(body, /p_code_ciphertext is null/);
  assert.match(body, /credential\.token_hash = p_student_key_hash/);
  assert.match(body, /issuance\.status = 'active'/);
  assert.match(body, /EXAM_ROOM_STUDENT_ACCESS_SUPERSEDED/);
  assert.match(body, /set code_ciphertext = null/);
  const response = body.match(/return v_response \|\| jsonb_build_object\(([\s\S]*?)\n  \);/)?.[1] || '';
  assert.ok(response, 'V4 issuance response projection must be explicit');
  assert.doesNotMatch(response, /ciphertext|nonce|p_student_key_hash/);
});

test('only an active Beadle envelope reaches the Worker and legacy rows remain non-recoverable', () => {
  const body = functionBody(
    'exam_room_beadle_portal_v4',
    'exam_room_student_waiting_room_v4',
  );
  assert.match(body, /exam_room_has_active_beadle_assignment_v2/);
  assert.match(body, /issuance\.status = 'active'/);
  assert.match(body, /credential\.expires_at > clock_timestamp\(\)/);
  assert.match(body, /'studentCodeRecoverable', v_envelope is not null/);
  assert.match(body, /'activeStudentCodeEnvelope', v_envelope/);
});

test('waiting-room preflight is question-free, attempt-free, and gives an authoritative polling clock', () => {
  const body = functionBody(
    'exam_room_student_waiting_room_v4',
    'exam_room_start_attempt_v4',
  );
  assert.match(body, /exam_room_student_preflight_v2/);
  assert.match(body, /exam_room_check_student_credential_preopen_v4/);
  assert.match(body, /'preflightVersion', 4/);
  assert.match(body, /'serverNow', v_now/);
  assert.match(body, /'opensAt', v_window_open/);
  assert.match(body, /'entryClosesAt', v_entry_closes_at/);
  assert.match(body, /'canStart', v_can_start/);
  assert.match(body, /when v_window_open - v_now <= interval '60 seconds' then 5000/);
  assert.match(body, /else 15000/);
  assert.doesNotMatch(body, /insert into public\.exam_room_attempts/);
  assert.doesNotMatch(body, /insert into public\.exam_room_answers/);
  assert.doesNotMatch(body, /'questions'/);
});

test('outsiders, account mismatches, and unpublished exams receive no draft details', () => {
  const body = functionBody(
    'exam_room_student_waiting_room_v4',
    'exam_room_start_attempt_v4',
  );
  const denial = body.match(
    /if \(v_base ->> 'code'\) in \([\s\S]*?'EXAM_NOT_PUBLISHED'[\s\S]*?\) then([\s\S]*?)\n  end if;/,
  )?.[1] || '';
  assert.ok(denial, 'minimal outsider denial branch must exist');
  assert.match(denial, /'waitingRoomState', 'blocked'/);
  assert.match(denial, /'startBlockerCode', v_base ->> 'code'/);
  assert.match(denial, /'published', \(v_base ->> 'code'\) <> 'EXAM_NOT_PUBLISHED'/);
  assert.doesNotMatch(denial, /title|opensAt|entryClosesAt|hardClosesAt|studentAccessReady|rules|instructions|candidateNumber|rosterIdentity/);
  assert.ok(
    body.indexOf("if (v_base ->> 'code') in")
      < body.indexOf('from public.exam_room_publications publication'),
    'outsider denial must precede publication and schedule derivation',
  );
});

test('starting remains a separate mutation with an immediate V4 authorization recheck', () => {
  const body = functionBody('exam_room_start_attempt_v4');
  assert.match(body, /public\.exam_room_student_waiting_room_v4\(/);
  assert.match(body, /if not coalesce\(\(v_preflight ->> 'canStart'\)::boolean, false\)/);
  assert.match(body, /return public\.exam_room_start_attempt\(/);
  assert.ok(
    body.indexOf('public.exam_room_student_waiting_room_v4(')
      < body.indexOf('return public.exam_room_start_attempt('),
  );
});
