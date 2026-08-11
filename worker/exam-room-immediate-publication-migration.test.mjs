import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260811150421_remove_exam_room_30_minute_lead.sql',
  import.meta.url,
), 'utf8');

test('immediate-opening migration changes only the three schedule functions', () => {
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
  for (const signature of [
    'exam_room_schedule_for_handoff_v3',
    'exam_room_publish_for_beadle_v3',
    'exam_room_reschedule_publication_v1',
  ]) {
    assert.match(migration, new RegExp(`to_regprocedure\\([\\s\\S]*?${signature}`));
    assert.match(migration, new RegExp(
      `revoke all on function public\\.${signature}\\([\\s\\S]*?from public, anon, authenticated`,
      'i',
    ));
  }
  assert.match(migration,
    /revoke all on function public\.exam_room_schedule_for_handoff_v3\([\s\S]*?from public, anon, authenticated, service_role/i,
    'the private scheduler must remain unavailable to direct Worker calls');
  assert.doesNotMatch(migration,
    /grant execute on function public\.exam_room_schedule_for_handoff_v3\(/i);
  for (const signature of [
    'exam_room_publish_for_beadle_v3',
    'exam_room_reschedule_publication_v1',
  ]) {
    assert.match(migration, new RegExp(
      `grant execute on function public\\.${signature}\\([\\s\\S]*?to service_role`,
      'i',
    ));
  }
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /execute replace\(v_definition, v_fragment, ''\)/);
  assert.match(migration, /EXAM_ROOM_IMMEDIATE_OPEN_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /create\s+table|alter\s+table|drop\s+table/i);
});
test('immediate-opening migration removes only the legacy lead-time predicates', () => {
  assert.match(migration,
    /if p_opens_at < clock_timestamp\(\) \+ interval ''30 minutes'' then/);
  assert.match(migration,
    /if v_opens_at < clock_timestamp\(\) \+ interval ''30 minutes'' then/);
  assert.match(migration,
    /or p_opens_at < clock_timestamp\(\) \+ interval ''30 minutes''/);
  assert.match(migration, /EXAM_ROOM_HANDOFF_TIME_REQUIRED/);
  assert.match(migration,
    /where position\('interval ''30 minutes''' in pg_get_functiondef/);
});
