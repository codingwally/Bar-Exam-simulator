import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = Object.freeze({
  base: 'supabase/migrations/20260824172926_bar_exam_simulation_randomized_allocations_v1.sql',
  responseTrigger: 'supabase/migrations/20260824172927_bar_simulation_answer_capture_trigger_v1.sql',
  attemptTriggers: 'supabase/migrations/20260824172928_bar_simulation_attempt_triggers_v1.sql',
  backfill: 'supabase/migrations/20260824172929_bar_simulation_answer_history_backfill_v1.sql',
  hardening: 'supabase/migrations/20260824172930_bar_simulation_answer_clear_race_hardening_v1.sql',
  hashHardening: 'supabase/migrations/20260824172931_bar_simulation_start_hash_expression_hardening_v1.sql',
  poolStaging: 'supabase/migrations/20260824172932_bar_simulation_pool_staging_v1.sql',
});

const sql = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, relativePath]) => [
    key,
    await readFile(new URL(relativePath, root), 'utf8'),
  ]),
));

assert.doesNotMatch(
  sql.base,
  /create\s+trigger\s+\w+[\s\S]{0,300}\bon\s+public\.(?:examination_responses|examination_attempts_multi)\b/i,
  'The long additive migration must not lock either paid-user write table for trigger DDL.',
);
assert.doesNotMatch(
  sql.base,
  /insert\s+into\s+public\.bar_simulation_answered_questions[\s\S]*from\s+public\.examination_responses/i,
  'The long additive migration must not perform the historical response backfill.',
);

const firstFunctionBoundary = sql.base.indexOf(
  'create or replace function public.bar_simulation_sync_pool_v1',
);
assert.ok(firstFunctionBoundary > 0, 'The first Simulation function must remain present.');
const baseSchemaPrefix = sql.base.slice(0, firstFunctionBoundary);
const baseSchemaTransactions = [...baseSchemaPrefix.matchAll(/begin;([\s\S]*?)commit;/gi)]
  .map((match) => match[1]);
const liveReferenceTableTransactions = baseSchemaTransactions.filter((transaction) => (
  /create\s+table\s+if\s+not\s+exists\s+public\.bar_simulation_/i.test(transaction)
));
assert.equal(
  liveReferenceTableTransactions.length,
  8,
  'Each of the eight private tables must be installed in a bounded schema transaction.',
);
for (const [index, transaction] of liveReferenceTableTransactions.entries()) {
  assert.equal(
    (transaction.match(/create\s+table\s+if\s+not\s+exists\s+public\.bar_simulation_/gi) || []).length,
    1,
    `Private table transaction ${index + 1} must release referenced-table locks immediately.`,
  );
  assert.match(
    transaction,
    /set\s+local\s+lock_timeout\s*=\s*'250ms'/i,
    `Private table transaction ${index + 1} must fail fast behind paid-user writes.`,
  );
  assert.match(
    transaction,
    /set\s+local\s+statement_timeout\s*=\s*'5s'/i,
    `Private table transaction ${index + 1} must remain bounded.`,
  );
  assert.doesNotMatch(
    transaction,
    /create\s+or\s+replace\s+function/i,
    `Private table transaction ${index + 1} must not retain foreign-key locks during function DDL.`,
  );
}

for (const [name, triggerSql] of [
  ['response trigger', sql.responseTrigger],
  ['attempt triggers', sql.attemptTriggers],
]) {
  assert.match(triggerSql, /set\s+local\s+lock_timeout\s*=\s*'250ms'/i, `${name} must fail fast on a busy table.`);
  assert.match(triggerSql, /set\s+local\s+statement_timeout\s*=\s*'5s'/i, `${name} must remain a tiny transaction.`);
  assert.equal((triggerSql.match(/\bbegin\s*;/gi) || []).length, 1, `${name} must have one transaction.`);
  assert.equal((triggerSql.match(/\bcommit\s*;/gi) || []).length, 1, `${name} must commit immediately.`);
  assert.doesNotMatch(triggerSql, /drop\s+trigger/i, `${name} must avoid an unnecessary first-install DROP lock.`);
}

assert.match(sql.responseTrigger, /on\s+public\.examination_responses/i);
assert.match(sql.attemptTriggers, /on\s+public\.examination_attempts_multi/i);
assert.doesNotMatch(sql.responseTrigger, /examination_attempts_multi/i);
assert.doesNotMatch(sql.attemptTriggers, /examination_responses/i);
assert.match(
  sql.backfill,
  /insert\s+into\s+public\.bar_simulation_answered_questions[\s\S]*from\s+public\.examination_responses/i,
);
for (const functionSql of [sql.base, sql.hardening]) {
  assert.match(
    functionSql,
    /tg_op\s*<>\s*'UPDATE'[\s\S]*old\.answer_text/i,
    'The answer capture function must preserve a legacy nonblank answer cleared during backfill.',
  );
}
assert.ok(
  files.responseTrigger < files.backfill,
  'The answer-capture trigger must install before the history backfill.',
);
assert.match(
  sql.base,
  /\(item\.value->>'questionId'\)\s*\|\|\s*':'\s*\|\|\s*\(item\.value->>'contentHash'\)/,
  'Allocation snapshot components must be parenthesized before concatenation.',
);
assert.match(sql.hashHardening, /BAR_SIMULATION_START_HASH_EXPRESSION_UNKNOWN/);
assert.match(sql.poolStaging, /create table if not exists public\.bar_simulation_pool_staging_v1/i);
assert.match(sql.poolStaging, /force row level security/i);
assert.match(sql.poolStaging, /jsonb_array_length\(rows_json\) between 1 and 100/i);
assert.match(sql.poolStaging, /bar_simulation_stage_pool_v1/i);
assert.match(sql.poolStaging, /bar_simulation_finalize_pool_v1/i);
assert.match(sql.poolStaging, /perform public\.examination_require_admin\(p_actor_user_id\)/i);
assert.match(sql.poolStaging, /v_result := public\.bar_simulation_sync_pool_v1/i);
const poolStageFunctionBoundary = sql.poolStaging.indexOf(
  'create or replace function public.bar_simulation_stage_pool_v1',
);
assert.ok(poolStageFunctionBoundary > 0);
assert.match(
  sql.poolStaging.slice(0, poolStageFunctionBoundary),
  /set\s+local\s+lock_timeout\s*=\s*'250ms'[\s\S]*commit;/i,
  'Pool staging must release its auth.users foreign-key lock before function DDL.',
);
assert.doesNotMatch(
  sql.poolStaging,
  /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.examination_(?:responses|attempts_multi)/i,
  'Private pool transport must not write paid-user attempts or responses.',
);

console.log('Bar Exam Simulation zero-downtime migration split tests passed.');
