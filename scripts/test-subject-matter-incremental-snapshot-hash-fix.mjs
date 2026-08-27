import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260828130000_subject_matter_incremental_snapshot_hash_fix.sql',
  import.meta.url,
);
const revealUrl = new URL(
  '../supabase/migrations/20260826110207_subject_matter_unlimited_review_release.sql',
  import.meta.url,
);

const migration = await readFile(migrationUrl, 'utf8');
const reveal = await readFile(revealUrl, 'utf8');

assert.match(
  migration,
  /alter\s+function\s+public\.subject_matter_sync_incremental_v1\([\s\S]*?\)\s+rename\s+to\s+subject_matter_sync_incremental_v1_legacy_snapshot_hash/i,
  'the deployed importer must be preserved behind an unexposed legacy name',
);
assert.match(
  migration,
  /revoke\s+all\s+on\s+function\s+public\.subject_matter_sync_incremental_v1_legacy_snapshot_hash\([\s\S]*?\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  'API roles must not bypass the corrected importer wrapper',
);

const repairStart = migration.indexOf(
  'create or replace function public.subject_matter_repair_incremental_snapshot_hash_v1',
);
const wrapperStart = migration.indexOf(
  'create or replace function public.subject_matter_sync_incremental_v1',
  repairStart + 1,
);
assert.ok(repairStart >= 0 && wrapperStart > repairStart, 'repair and wrapper functions must exist');
const repair = migration.slice(repairStart, wrapperStart);

assert.match(repair, /version\.label\s*=\s*'Incremental reviewed question'/);
assert.match(repair, /version_question\.snapshot_hash\s*=\s*version\.snapshot_hash/);
assert.match(repair, /question\.content_hash\s+is\s+distinct\s+from\s+version_question\.snapshot_hash/i);
assert.match(repair, /question\.publication_ready\s+is\s+true/i);
assert.match(repair, /lower\(question\.review_status\)\s+in\s*\(\s*'approved'\s*,\s*'owner_override'\s*\)/i);

for (const fieldPair of [
  ['prompt_snapshot', 'prompt_text'],
  ['model_answer_snapshot', 'model_answer'],
  ['legal_basis_snapshot', 'legal_basis'],
  ['application_snapshot', 'application_text'],
  ['conclusion_snapshot', 'conclusion_text'],
  ['jurisprudence_snapshot', 'jurisprudence'],
  ['citation_snapshot', 'citation'],
  ['governing_provision_snapshot', 'governing_provision'],
  ['source_urls_snapshot', 'source_urls'],
]) {
  assert.match(
    repair,
    new RegExp(
      `version_question\\.${fieldPair[0]}\\s+is\\s+not\\s+distinct\\s+from\\s+question\\.${fieldPair[1]}`,
      'i',
    ),
    `${fieldPair[0]} must be proven identical before metadata repair`,
  );
}

assert.match(
  repair,
  /raise\s+exception\s+'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_REPAIR_INTEGRITY'/i,
  'content drift must fail closed instead of rewriting an immutable snapshot',
);
assert.match(
  repair,
  /update\s+public\.examination_versions[\s\S]*?set\s+status\s*=\s*'draft'[\s\S]*?update\s+public\.examination_version_questions[\s\S]*?set\s+snapshot_hash\s*=\s*question\.content_hash[\s\S]*?update\s+public\.examination_versions[\s\S]*?set\s+status\s*=\s*'published'/i,
  'the exact metadata repair must respect the published-version immutability trigger inside one transaction',
);
assert.match(repair, /v_repaired_count\s*<>\s*v_candidate_count/i);
assert.match(repair, /SNAPSHOT_REPAIR_COUNT_MISMATCH/);
assert.match(repair, /SNAPSHOT_REPAIR_INCOMPLETE/);

const wrapper = migration.slice(wrapperStart);
assert.match(
  wrapper,
  /v_result\s*:=\s*public\.subject_matter_sync_incremental_v1_legacy_snapshot_hash\(/i,
  'the wrapper must preserve the reviewed v1 validation and import behavior',
);
assert.match(
  wrapper,
  /perform\s+public\.subject_matter_repair_incremental_snapshot_hash_v1\([\s\S]*?p_source_digest/i,
  'every new or replayed incremental digest must be repaired before returning',
);
assert.match(
  wrapper,
  /grant\s+execute\s+on\s+function\s+public\.subject_matter_sync_incremental_v1\([\s\S]*?\)\s+to\s+service_role/i,
);
assert.match(
  migration,
  /revoke\s+all\s+on\s+function\s+public\.subject_matter_repair_incremental_snapshot_hash_v1\(text\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  'the repair helper must remain owner-internal',
);
assert.match(
  migration,
  /perform\s+public\.subject_matter_repair_incremental_snapshot_hash_v1\(null\)/i,
  'the migration must repair already-published incremental rows',
);

assert.match(
  reveal,
  /question\.content_hash\s*=\s*version_question\.snapshot_hash/i,
  'Reveal Answer must retain its strict question-content integrity join after the metadata repair',
);
assert.doesNotMatch(
  migration,
  /delete\s+from\s+public\.(?:examination_questions|subject_matter_placements|examination_attempts_multi|examination_responses|examination_submissions|examination_ai_assessments)/i,
  'the repair must not delete commercial or learner records',
);

assert.match(migration, /^begin;/m);
assert.match(migration, /commit;\s*$/);

console.log('Subject Matter incremental snapshot-hash repair contracts passed.');
