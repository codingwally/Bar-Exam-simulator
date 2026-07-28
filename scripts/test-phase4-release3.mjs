import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260730_007_phase4_timer_history.sql');
const worker = read('worker/index.mjs');
const controller = read('assets/exam-session-controller.js');
const experience = read('assets/phase4-experience.js');
const frontend = read('index.html');

for (const column of ['timer_mode', 'elapsed_seconds', 'submission_reason', 'expired']) {
  assert.ok(migration.includes(column), `${column} must be recorded`);
}
for (const rpc of [
  'phase4_prepare_exam_attempt_v2',
  'phase4_record_unanswered_attempt',
  'phase4_exam_history',
]) {
  assert.ok(migration.includes(`function public.${rpc}`), `${rpc} must exist`);
  assert.ok(worker.includes(`'${rpc}'`), `${rpc} must be used by the Worker`);
  assert.match(
    migration,
    new RegExp(`revoke all on function public\\.${rpc}[\\s\\S]*?from public, anon, authenticated`),
  );
}

assert.ok(controller.includes('const STRICT_SECONDS = 12 * 60'));
assert.ok(controller.includes('switchMode'));
assert.ok(controller.includes('syncFromStorage'));
assert.ok(controller.includes('automaticAdvanceHandled'));
assert.ok(frontend.includes('At zero, your answer submits; the result stays here.'));
assert.ok(frontend.includes('No visible clock. Active writing time is still recorded.'));
assert.ok(frontend.includes('clearPersistedWorkspace'));
assert.ok(frontend.includes('restorePersistedWorkspace'));
assert.ok(frontend.includes('switchSessionMode'));
assert.ok(frontend.includes('function questionAnswerKey('));
assert.ok(frontend.includes('userAnswers[questionAnswerKey()]'));
assert.doesNotMatch(frontend, /userAnswers\[`?\$\{currentSubj\}-\$\{currentIdx\}`?\]/);
assert.ok(frontend.includes("submissionReason: 'strict_expiry'"));
assert.ok(frontend.includes('Unanswered attempt recorded'));
assert.ok(experience.includes("request('/exam/unanswered'"));
assert.ok(experience.includes("request('/exam/history'"));
assert.ok(experience.includes("global.addEventListener('duediligence:session'"));
assert.doesNotMatch(frontend, /Advances once when time expires/i);
assert.doesNotMatch(frontend, /Automatically proceeds when time expires/i);

for (const source of [migration, worker, controller, experience, frontend]) {
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(source, /service[_-]?role\s*[:=]\s*['\"][A-Za-z0-9._-]{20,}/i);
}

console.log('Phase 4 Release 3 timer and history contract checks passed.');
