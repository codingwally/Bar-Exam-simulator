import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260828124000_examination_room_immediate_key_access.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');

assert.equal((sql.match(/^\s*begin;\s*$/gimu) || []).length, 1);
assert.equal((sql.match(/^\s*commit;\s*$/gimu) || []).length, 1);

assert.match(sql, /pg_get_functiondef\([\s\S]+?examination_room_v1\.api_admin\(text,uuid,uuid,jsonb\)/iu);
assert.match(sql, /request_hash,[\s\S]+?'open',[\s\S]+?event_time,[\s\S]+?activation_expires_at/iu);
assert.match(sql, /'status', 'open',[\s\S]+?'opensAt', event_time/iu);
assert.match(sql, /nullif\(btrim\(p_payload ->> 'closesAt'\), ''\) is null/iu);
assert.match(sql, /event_time \+ interval '180 days'/iu);
const newActivationValues = sql.match(
  /new_activation_values text := \$new\$([\s\S]+?)\$new\$;/iu,
)?.[1] || '';
assert.ok(newActivationValues, 'the patched activation values must be declared');
assert.doesNotMatch(
  newActivationValues,
  /p_payload ->> 'opensAt'/iu,
  'the new activation insert must not require a creator/admin opening timestamp',
);

assert.match(sql, /activation_status = 'scheduled'[\s\S]+?activation_status = 'open'/iu);
assert.match(sql, /activation\.closes_at > clock_timestamp\(\)/iu);
assert.match(sql, /exam\.blocked_at is null/iu);
assert.match(sql, /exam\.deleted_at is null/iu);
assert.match(sql, /exam\.status <> 'archived'/iu);

assert.match(sql, /public\.examination_room_v1_lifecycle_guard\(activation_row\.exam_id\)/iu);
assert.match(sql, /activation_row\.activation_status not in \('scheduled', 'open'\)/iu);
assert.match(sql, /activation_row\.closes_at <= clock_timestamp\(\)/iu);
assert.match(sql, /activation_row\.activation_status = 'scheduled'[\s\S]+?set activation_status = 'open'/iu);
assert.match(sql, /if not found then[\s\S]+?activation\.activation_status = 'open'/iu);
assert.match(sql, /activation_status <> ''open''/iu);

assert.match(sql, /The prior room-key request is already bound to a different key\./iu);
assert.match(sql, /jsonb_set\(replay, '\{activation,status\}'/iu);
assert.match(sql, /examination_room_v1\.api_record_audit/iu);
assert.doesNotMatch(sql, /grant execute[\s\S]+?to (?:public|anon|authenticated)/iu);
assert.doesNotMatch(sql, /alter table[\s\S]+?drop column/iu);

console.log('Examination Room immediate-key-access migration contract passed.');
