import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811003800_beadle_roster_template_provenance.sql',
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

test('template proof migration is additive, private, and stores no roster rows', () => {
  assert.match(migration, /^-- Mandatory official Beadle class-list template provenance\./);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/);
  assert.match(
    migration,
    /create table if not exists public\.exam_room_roster_template_validations/,
  );
  assert.match(
    migration,
    /alter table public\.exam_room_roster_template_validations force row level security/,
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.exam_room_roster_template_validations[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]*exam_room_roster_template_validations to service_role/,
  );
  const table = migration.slice(
    migration.indexOf('create table if not exists public.exam_room_roster_template_validations'),
    migration.indexOf('create index if not exists exam_room_roster_template_validation_scope_idx'),
  );
  assert.match(table, /template_version text not null/);
  assert.match(table, /source_hash text not null/);
  assert.match(table, /canonical_rows_hash text not null/);
  assert.match(table, /expires_at timestamptz not null/);
  assert.match(table, /consumed_at timestamptz/);
  assert.match(table, /consumed_request_key text/);
  assert.match(table, /expires_at = validated_at \+ interval '30 minutes'/);
  assert.doesNotMatch(table, /\b(rows|roster_rows|workbook|source_content)\s+(jsonb|text|bytea)\b/i);
});

test('registration issues a receipt only after exact-template and roster validation', () => {
  const body = functionBody(
    'exam_room_register_roster_template_validation_v1',
    'exam_room_import_exam_roster_v3',
  );
  assert.match(body, /p_template_version is distinct from 'beadle-roster-v1'/);
  assert.match(body, /EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED/);
  assert.match(body, /exam_room_is_operator_v2\(p_actor_user_id, v_exam\.id, true\)/);
  assert.match(body, /exam_room_can_manage_roster_v2\(p_actor_user_id, v_exam\.id\)/);
  assert.match(body, /public\.exam_room_validate_roster\(/);
  assert.ok(
    body.indexOf("if not coalesce((v_validation ->> 'ok')::boolean, false)")
      < body.indexOf('insert into public.exam_room_roster_template_validations'),
    'invalid roster rows must return before receipt insertion',
  );
  assert.match(body, /row_value \? 'email'/);
  assert.match(body, /row_value \? 'studentNumber'/);
  assert.match(body, /row_value \? 'candidateNumber'/);
  assert.match(body, /row_value \? 'displayName'/);
  assert.match(body, /ROSTER_NAME_REQUIRED/);
  assert.match(body, /candidateNumber'[\s\S]*<> btrim\(coalesce\(row_value ->> 'studentNumber'/);
  assert.match(body, /v_now \+ interval '30 minutes'/);
  assert.match(body, /'templateReceiptId', v_receipt\.id/);
  assert.match(body, /'templateReceiptExpiresAt', v_receipt\.expires_at/);
  assert.match(body, /'templateVersion', v_receipt\.template_version/);
});

test('canonical row hash normalizes values and ignores upload row order', () => {
  const body = functionBody(
    'exam_room_roster_rows_hash_v1',
    'exam_room_register_roster_template_validation_v1',
  );
  assert.match(body, /lower\(btrim\(row_value ->> 'email'\)\)/);
  assert.match(body, /btrim\(row_value ->> 'studentNumber'\)/);
  assert.match(body, /btrim\(row_value ->> 'candidateNumber'\)/);
  assert.match(body, /btrim\(row_value ->> 'displayName'\)/);
  assert.match(body, /order by[\s\S]*lower\(btrim\(row_value ->> 'email'\)\)/);
  assert.match(body, /public\.exam_room_hash_json/);
});

test('v3 import consumes the matching proof atomically and is retry-safe', () => {
  const body = functionBody('exam_room_import_exam_roster_v3');
  assert.match(body, /exam_room_command_begin_v2\(/);
  assert.match(body, /'import_exam_roster_v3'/);
  assert.match(body, /from public\.exam_room_roster_template_validations receipt[\s\S]*for update/);
  assert.match(body, /v_receipt\.actor_user_id <> p_actor_user_id/);
  assert.match(body, /v_receipt\.exam_id <> v_exam\.id/);
  assert.match(body, /EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID/);
  assert.match(body, /EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED/);
  assert.match(body, /EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED/);
  assert.match(body, /EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH/);
  assert.match(body, /v_receipt\.canonical_rows_hash <> v_rows_hash/);
  assert.match(body, /public\.exam_room_import_exam_roster_v2\(/);
  assert.match(body, /set consumed_at = clock_timestamp\(\),[\s\S]*consumed_request_key = p_request_key/);
  assert.match(body, /exam_room_command_complete_v2\(/);
  assert.ok(
    body.indexOf('exam_room_command_begin_v2(')
      < body.indexOf('v_receipt.consumed_at is not null'),
    'same-request replay must return before the consumed-receipt rejection',
  );
  assert.ok(
    body.indexOf('public.exam_room_import_exam_roster_v2(')
      < body.indexOf('set consumed_at = clock_timestamp()'),
    'receipt consumption must follow successful authoritative import',
  );
  assert.ok(
    body.indexOf('set consumed_at = clock_timestamp()')
      < body.indexOf('exam_room_command_complete_v2('),
    'the import response and consumed receipt must commit together',
  );
});

test('new RPCs are service-only while v2 remains available for DB-first rolling deploys', () => {
  for (const signature of [
    'exam_room_register_roster_template_validation_v1',
    'exam_room_import_exam_roster_v3',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature}\\([\\s\\S]*?from public, anon, authenticated`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature}\\([\\s\\S]*?to service_role`),
    );
  }
  assert.doesNotMatch(
    migration,
    /revoke all on function public\.exam_room_import_exam_roster_v2\([\s\S]*?service_role/,
  );
});
