import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const worker = read('worker/index.mjs');
const examiner = read('worker/examiner-core.mjs');
const migration = read('supabase/migrations/20260730_006_phase4_exam_reliability.sql');
const wrangler = read('worker/wrangler.toml');
const frontend = read('index.html');

for (const table of ['exam_attempts', 'provider_incidents']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`),
  );
}

for (const rpc of [
  'phase4_reserve_grade_v2',
  'phase4_mark_exam_capacity',
  'phase4_finalize_exam_grade',
  'phase4_fail_exam_attempt',
]) {
  assert.ok(migration.includes(`function public.${rpc}`), `${rpc} must exist`);
  assert.ok(worker.includes(`'${rpc}'`), `${rpc} must be called by the Worker`);
}

assert.ok(migration.includes('pg_advisory_xact_lock'));
assert.ok(migration.includes('provider_rate_limit'));
assert.ok(migration.includes('provider_timeout'));
assert.ok(migration.includes('provider_unavailable'));
assert.ok(migration.includes('jsonb_has_forbidden_keys'));
assert.ok(migration.includes('student_answer'));
assert.ok(examiner.includes('modelAnswerQualityIssues'));
assert.ok(examiner.includes('Application must be the most developed ALAC section.'));
assert.ok(examiner.includes('Do not claim "Human Verified"'));
assert.match(
  wrangler,
  /\[placement\]\s*region\s*=\s*"gcp:us-east4"/,
  'The Gemini examiner must execute from a supported, explicit Cloudflare placement.',
);
assert.match(wrangler, /PHASE4_MODEL_QUALITY_ENFORCEMENT\s*=\s*"true"/);
assert.ok(worker.includes('CONTROLLED REPAIR'));
assert.ok(worker.includes('AI_GRADING_CAPACITY'));
assert.ok(worker.includes('no attempt was consumed'));
assert.ok(frontend.includes('assessmentError.pendingAttemptId'));

for (const source of [worker, examiner, migration, frontend]) {
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(source, /service[_-]?role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i);
}

console.log('Phase 4 Release 2 reliability contract checks passed.');
