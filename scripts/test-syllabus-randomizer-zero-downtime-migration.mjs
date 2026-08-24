import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const practiceMigrationUrl = new URL(
  '../supabase/migrations/20260824170227_feature_scoped_question_rotation.sql',
  import.meta.url,
);
const migrationUrl = new URL(
  '../supabase/migrations/20260824171639_syllabus_based_review_no_repeat_v2.sql',
  import.meta.url,
);
const practiceSql = await readFile(practiceMigrationUrl, 'utf8');
const sql = await readFile(migrationUrl, 'utf8');

const practiceFunctionBoundary = practiceSql.indexOf(
  'create or replace function public.select_feature_question_v1',
);
assert.ok(practiceFunctionBoundary > 0);
assert.match(
  practiceSql.slice(0, practiceFunctionBoundary),
  /set\s+local\s+lock_timeout\s*=\s*'250ms'[\s\S]*commit;/i,
  'Practice rotation must release its auth.users foreign-key lock before function DDL.',
);

const functionBoundary = sql.indexOf(
  'create or replace function public.subject_matter_next_question_v2',
);
assert.ok(functionBoundary > 0, 'The v2 selector must remain present.');

const preFunctionSql = sql.slice(0, functionBoundary);
const transactions = [...preFunctionSql.matchAll(/begin;([\s\S]*?)commit;/gi)]
  .map((match) => match[1]);

assert.equal(
  transactions.length,
  4,
  'Column addition, constraint addition, validation, and swap must use separate transactions.',
);

for (const [index, transaction] of transactions.entries()) {
  assert.match(
    transaction,
    /set\s+local\s+lock_timeout\s*=\s*'2s'/i,
    `Schema transaction ${index + 1} must fail fast instead of queuing behind traffic.`,
  );
}

assert.match(transactions[0], /add\s+column\s+if\s+not\s+exists/i);
assert.doesNotMatch(transactions[0], /validate\s+constraint/i);
assert.doesNotMatch(transactions[0], /create\s+or\s+replace\s+function/i);

assert.match(transactions[1], /add\s+constraint[\s\S]*not\s+valid/i);
assert.doesNotMatch(transactions[1], /validate\s+constraint/i);

assert.match(transactions[2], /validate\s+constraint/i);
assert.doesNotMatch(transactions[2], /drop\s+constraint\s+if\s+exists\s+examination_attempts_subject_skip_check/i);

assert.match(transactions[3], /rename\s+constraint/i);
assert.doesNotMatch(transactions[3], /create\s+or\s+replace\s+function/i);

assert.match(
  sql.slice(functionBoundary),
  /^create or replace function[\s\S]*commit;\s*$/i,
  'Function DDL must run only after the live-table schema transactions commit.',
);

console.log('Syllabus-Based Review zero-downtime migration split tests passed.');
