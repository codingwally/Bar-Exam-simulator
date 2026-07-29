import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  html,
  frontend,
  styles,
  adminHtml,
  adminJs,
  worker,
  migration,
  seedSql,
  seedJsonText,
  preflight,
] = await Promise.all([
  read('index.html'),
  read('assets/examinations.js'),
  read('assets/examinations.css'),
  read('admin/index.html'),
  read('admin/admin.js'),
  read('worker/index.mjs'),
  read('supabase/migrations/20260729120725_examinations_bar_feels_shared_engine.sql'),
  read('supabase/migrations/20260729120726_approved_examination_test_bank.sql'),
  read('content/examinations/leb-y1-y2-approved-system-test.json'),
  read('supabase/review/examinations_production_preflight.sql'),
]);
const seedDocument = JSON.parse(seedJsonText);
const seed = seedDocument.rows;

for (const id of [
  'welcome-state',
  'start-practice',
  'page-midterms',
  'dd-per-subject-app',
  'page-bar-feels',
  'dd-bar-feels-app',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `index must retain/add #${id}`);
}
assert.match(html, /DueDiligenceExaminations\?\.openPerSubject/);
assert.match(html, /DueDiligenceExaminations\?\.openBarFeels/);
assert.match(html, /assets\/examinations\.css/);
assert.match(html, /assets\/examinations\.js/);
assert.match(html, /Mock Bar/);
assert.match(frontend, /Subject Matter Examinations/);
assert.match(adminJs, />Subject Matter<\/option>/);
const retiredUserFacingTerms = /Moot Court|Per-Subject Examinations|PER-SUBJECT EXAMINATION/i;
assert.doesNotMatch(html, retiredUserFacingTerms);
assert.doesNotMatch(frontend, retiredUserFacingTerms);
assert.doesNotMatch(adminJs, />\s*Per-Subject\s*</i);

for (const contract of [
  /operation:\s*'start_attempt'/,
  /operation:\s*'heartbeat'/,
  /operation:\s*'save_response'/,
  /operation:\s*'flag_response'/,
  /operation:\s*'submit_attempt'/,
  /operation:\s*'request_ai_grading'/,
  /operation:\s*'create_examiner_assignment'/,
  /I\. ANSWER/,
  /II\. LEGAL BASIS/,
  /III\. APPLICATION/,
  /IV\. CONCLUSION/,
  /beforeunload/,
  /popstate/,
  /localStorage/,
  /expectedRevision/,
  /Review All Answers/,
]) {
  assert.match(frontend, contract);
}
assert.doesNotMatch(frontend, /secure browser|proctored|encrypted examination environment/i);
assert.match(frontend, /No cumulative percentage, class rank, pass\/fail claim/);
assert.match(frontend, /PDF is not accepted in this beta/);

for (const viewport of [/max-width:\s*1120px/, /max-width:\s*820px/, /max-width:\s*520px/]) {
  assert.match(styles, viewport);
}
assert.doesNotMatch(styles, /#[a-f0-9]{6}[^;\n]*(?:purple|neon)/i);

assert.match(adminHtml, /data-section="examinations"/);
for (const operation of [
  'create_exam',
  'create_version',
  'set_questions',
  'publish_version',
  'set_availability',
  'set_beta_access',
  'set_participant',
  'unpublish_exam',
  'close_exam',
  'release_model_answers',
]) {
  assert.match(adminJs, new RegExp(operation));
}
assert.match(adminJs, /Founder Admin/);
assert.match(adminJs, /Audit reason/);

for (const route of [
  '/examinations/query',
  '/examinations/command',
  '/examinations/upload',
  '/admin/examinations',
]) {
  assert.match(worker, new RegExp(route.replaceAll('/', '\\/')));
}
assert.match(worker, /EXAMINATION_EMAIL_MODE/);
assert.match(worker, /RESEND_API_KEY/);
assert.match(worker, /questions\[0\]/, 'AI assessment must use bounded one-question batches');
assert.doesNotMatch(worker, /console\.(?:log|error)\([^)]*(?:SERVICE_ROLE|API_KEY|RESEND)/);

const tables = [
  'examination_questions',
  'examination_definitions',
  'examination_versions',
  'examination_version_questions',
  'examination_beta_access',
  'examination_participants',
  'examination_attempts_multi',
  'examination_responses',
  'examination_submissions',
  'examination_grading_jobs',
  'examination_ai_assessments',
  'examination_examiner_assignments',
  'examination_examiner_reviews',
  'examination_model_releases',
  'examination_uploads',
  'examination_notifications',
  'examination_audit_log',
  'examination_command_receipts',
];
for (const table of tables) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  assert.match(migration, new RegExp(`'${table}'`), `${table} must be included in least privilege`);
}
assert.match(migration, /force row level security/gi);
assert.match(migration, /from public, anon, authenticated/gi);
assert.match(migration, /to service_role/gi);
assert.match(migration, /not exists \(\s*select 1\s*from public\.examination_ai_assessments completed/i);
assert.match(migration, /if v_attempt\.timer_mode = 'strict' and v_attempt\.deadline_at <= v_now/i);
assert.match(migration, /EXAM_SECOND_TAB_BLOCKED/);
assert.match(migration, /EXAM_RESPONSE_CONFLICT/);
assert.match(migration, /EXAM_VERSION_IMMUTABLE/);
assert.match(migration, /not v_exam\.test_only and v_count <> 20/i);
assert.doesNotMatch(migration, /\bdrop table\b/i);
assert.doesNotMatch(migration, /grant\s+[^;]*\bon\s+(?:table\s+)?public\.examination_\w+\s+to\s+(?:public|anon|authenticated)/i);

assert.equal(seed.length, 20);
assert.deepEqual(
  [...new Set(seed.map((row) => row.subject))].sort(),
  ['Criminal Law I', 'Persons and Family Law'],
);
for (const row of seed) {
  assert.equal(row.editorialStatus, 'Approved');
  assert.equal(row.publicationReady, 'Yes');
  assert.match(row.prompt, /\S/);
  assert.match(row.suggestedAnswer, /\S/);
  assert.match(row.legalBasis, /\S/);
  assert.match(row.doctrine, /\S/);
  assert.match(String(row.barYear), /^\d{4}$/);
  assert.match(String(row.questionNumber), /^\d+$/);
  assert.match(row.difficulty, /\S/);
  assert.match(row.suggestedAnswer, /\bApplication\b/i);
  assert.match(row.suggestedAnswer, /\bConclusion\b/i);
}
assert.match(seedSql, /source_key,\s*source_type/i);
assert.match(seedSql, /bar_year/i);
assert.match(seedSql, /source_metadata/i);
assert.match(seedSql, /on conflict on constraint examination_questions_source_scope_unique/i);

const executablePreflight = preflight.replace(/--.*$/gm, '');
assert.match(preflight, /READ-ONLY \/ FAIL-FAST/);
assert.match(preflight, /set transaction read only/i);
assert.match(preflight, /EXAMINATIONS_PRODUCTION_PREFLIGHT_PASSED_READ_ONLY/);
assert.match(preflight, /20260729120725/);
assert.match(preflight, /20260729120726/);
assert.match(preflight, /EXAM_PREFLIGHT_EXPECTED_EIGHT_SUBJECTS/);
assert.match(preflight, /EXAM_PREFLIGHT_EXPECTED_TWO_EXISTING_QUESTION_ROWS/);
assert.match(preflight, /examination-uploads/);
assert.match(preflight, /rollback;/i);
assert.doesNotMatch(
  executablePreflight,
  /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i,
);

console.log('Examination architecture, approved seed, UI, admin, and Worker contracts passed.');
