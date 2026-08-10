import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260811003500_allow_duplicate_exam_question_prompts.sql',
  import.meta.url,
);
const migration = readFileSync(migrationPath, 'utf8');

assert.match(
  migration,
  /alter\s+table\s+public\.exam_room_questions[\s\S]*drop\s+constraint\s+if\s+exists\s+exam_room_questions_question_version_id_prompt_hash_key/i,
  'duplicate prompt text must not be rejected within one question version',
);
assert.doesNotMatch(
  migration,
  /add\s+constraint[\s\S]*unique\s*\(\s*question_version_id\s*,\s*prompt_hash\s*\)/i,
  'the removed prompt-hash uniqueness rule must not be recreated',
);

console.log('Examination Room duplicate-prompt migration contract: PASS');
