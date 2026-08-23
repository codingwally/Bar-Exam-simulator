import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SUBJECT_MATTER_COURSES,
  SUBJECT_MATTER_PLACEMENTS,
} from '../worker/subject-matter-placement-manifest.mjs';

const [migration, worker, core, ui, css, pgTap, fixture, featureLoader, deployWorkflow] = await Promise.all([
  readFile(new URL(
    '../supabase/migrations/20260817111306_subject_matter_skip_and_flag_queue.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../worker/examinations-core.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
  readFile(new URL(
    '../supabase/tests/20260817_035_subject_matter_skip_and_flag_queue_test.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL('../docs/qa/option3-subject-matter-fixture.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
]);

for (const contract of [
  /add column if not exists subject_matter_skipped_at timestamptz/,
  /subject_matter_skipped_at is null\s+and subject_matter_skip_request_key is null\s+and subject_matter_skip_next_version_id is null/,
  /status = 'cancelled'\s+and subject_matter_skipped_at is not null/,
  /subject_matter_skip_request_key is not null\s+and subject_matter_skip_request_key ~/,
  /create or replace function public\.subject_matter_skip_question/,
  /attempt\.user_id = p_user_id/,
  /definition\.track = 'per_subject'/,
  /definition\.assessment_kind = 'quiz'/,
  /placement\.course_name = v_definition\.subject/,
  /v_attempt\.active_tab_hash <> v_tab_hash/,
  /subject_matter_skip_request_key <> v_request_key/,
  /'replayed', true/,
  /version\.id <> v_attempt\.version_id/,
  /version_question\.question_id <> v_question_id/,
  /raise exception 'EXAM_SUBJECT_NO_ALTERNATE_QUESTION'/,
  /seen_question_ids = v_seen_question_ids/,
  /v_cycle\.active_version_id <> v_attempt\.version_id/,
  /v_cycle_preserved := true/,
  /if not v_cycle_preserved then\s+update public\.subject_matter_cycles/,
  /status = 'cancelled'/,
  /subject_matter_skipped_at is null/,
  /'skippedQuestions'/,
  /'flaggedForLater'/,
  /later_attempt\.version_id = attempt\.version_id/,
  /later_attempt\.started_at >= attempt\.subject_matter_skipped_at/,
  /attempt\.status in \('in_progress', 'review'\)/,
  /'resumable', true/,
  /'queuedAt'/,
  /revoke all on function public\.subject_matter_skip_question\([\s\S]*?from public, anon, authenticated/,
  /grant execute on function public\.subject_matter_skip_question\([\s\S]*?to service_role/,
]) assert.match(migration, contract);

const skipFunction = migration.slice(
  migration.indexOf('create or replace function public.subject_matter_skip_question'),
  migration.indexOf('revoke all on function public.subject_matter_skip_question'),
).toLowerCase();
assert.doesNotMatch(skipFunction, /insert into public\.examination_submissions/);
assert.doesNotMatch(skipFunction, /insert into public\.examination_grading_jobs/);
assert.doesNotMatch(skipFunction, /insert into public\.examination_ai_assessments/);

assert.match(core, /'subject_skip_question'/);
assert.match(core, /operation === 'subject_skip_question'[\s\S]*?normalized\.attemptId[\s\S]*?normalized\.tabToken[\s\S]*?normalized\.requestKey/);
assert.match(worker, /command\.operation === 'subject_skip_question'/);
assert.match(worker, /examinationRpc\(env, 'subject_matter_skip_question'/);
assert.match(worker, /p_user_id: user\.id/);
assert.doesNotMatch(worker, /userJwtExaminationRpc|authenticatedExaminationRpc/,
  'Subject Matter Skip must stay inside the existing trusted Worker/service-role boundary.');

const roomMarkup = ui.slice(
  ui.indexOf('function subjectPracticeRoomMarkup'),
  ui.indexOf('function renderRoom'),
);
for (const contract of [
  /id="dd-subject-flag-button"/,
  /aria-pressed="\$\{question\.flagged === true/,
  /Flag for later/,
  /data-subject-skip/,
  /Skip saves this draft but does not submit or score it/,
]) assert.match(roomMarkup, contract);
assert.doesNotMatch(roomMarkup, /id="dd-flag-button"/);
assert.equal((ui.match(/id="dd-flag-button"/g) || []).length, 1,
  'Only the Bar Feels room may retain the legacy flag ID; Subject Matter uses a scoped ID.');
assert.equal((roomMarkup.match(/dd-control dd-exam-button/g) || []).length, 5,
  'The existing submit/return controls plus Flag and Skip must all use the shared control system.');

assert.match(ui, /function skipCurrentSubjectQuestion/);
assert.match(ui, /function subjectSkipRequestKey\(attemptId\)/);
assert.match(ui, /pendingSubjectSkipRequestKey/);
assert.match(ui, /const pendingSkip = state\.pendingSubjectSkip/);
assert.match(ui, /if \(!pendingSkip\)[\s\S]*?flushCurrentSave/);
const clientSkipFunction = ui.slice(
  ui.indexOf('async function skipCurrentSubjectQuestion'),
  ui.indexOf('async function retryFlaggedSubjectQuestion'),
);
assert.match(clientSkipFunction, /subjectSkipRequestKey\(attemptId\)/);
assert.doesNotMatch(clientSkipFunction, /requestKey\('skip'\)/);
assert.match(ui, /Your draft and any flag will remain saved/);
assert.match(ui, /operation: 'subject_skip_question'/);
assert.match(ui, /clearRecovery\(\);[\s\S]*?startSubjectSetup\(skipResult\.setup/);
assert.match(ui, /function retryFlaggedSubjectQuestion/);
assert.match(ui, /It does not[\s\S]*mutate subject_matter_cycles/);
assert.match(ui, /data-subject-retry-flagged/);
assert.match(ui, /data-exam-resume=/);
assert.match(ui, /item\.resumable === true/);
assert.match(ui, /<summary>Saved draft<\/summary>/);
assert.match(ui, /escapeHtml\(item\.answerText\)/,
  'A skipped flagged draft must be escaped before its private disclosure is rendered.');

assert.match(css, /\.dd-subject-editorial \.dd-subject-practice-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
assert.match(css, /#dd-subject-flag-button\[aria-pressed="true"\]/);
assert.match(css, /\.dd-subject-flagged-draft summary\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.dd-subject-flagged-row\s*\{[\s\S]*?grid-template-columns:\s*1fr/);

const placementsByCourse = new Map();
for (const [courseCode, , sourceKey] of SUBJECT_MATTER_PLACEMENTS) {
  if (!placementsByCourse.has(courseCode)) placementsByCourse.set(courseCode, new Set());
  placementsByCourse.get(courseCode).add(sourceKey);
}
assert.equal(placementsByCourse.size, SUBJECT_MATTER_COURSES.length);
for (const course of SUBJECT_MATTER_COURSES) {
  assert.ok(
    (placementsByCourse.get(course.code)?.size || 0) > 1,
    `${course.code} must have a genuinely different question available for Skip.`,
  );
}

assert.match(pgTap, /only the trusted service role can execute Subject Matter skip/);
assert.match(pgTap, /skip closes without creating a submission, grading job, or score/);
assert.match(pgTap, /a skipped flagged question remains private and discoverable until later submission/);
assert.match(pgTap, /flag-only then leave remains discoverable as one resumable private queue item/);
assert.match(pgTap, /same-key skip replay returns the stored next question without a second advance/);
assert.match(pgTap, /cycle exhaustion restarts once and still returns a different question/);
assert.match(pgTap, /skipping an out-of-cycle flagged retry preserves the active no-repeat cycle exactly/);
assert.match(pgTap, /NULL request key/);

assert.match(fixture, /'queue-open'/);
assert.match(fixture, /operation === 'flag_response'/);
assert.match(fixture, /operation === 'subject_skip_question'/);
assert.match(fixture, /versionId: alternateAttempt\.attempt\.versionId/);
assert.match(fixture, /Identify the five sources of obligations under Article 1157/);
assert.match(fixture, /operation === 'subject_performance'/);
assert.match(fixture, /flaggedForLater:/);
assert.match(fixture, /\['queue', 'queue-open'\]\.includes\(window\.__DD_SUBJECT_QA_STATE\)/);
assert.match(featureLoader, /assets\/examinations\.css\?v=subject-matter-gil-fixes-20260817-5/);
assert.match(featureLoader, /assets\/examinations\.js\?v=syllabus-review-20260823-1/);
assert.match(deployWorkflow, /node scripts\/test-subject-matter-skip-flag\.mjs/);

console.log(JSON.stringify({
  coursesWithAlternates: placementsByCourse.size,
  skipClosesWithoutSubmission: true,
  flaggedQueueClearsAfterLaterSubmission: true,
  databaseBrowserAccess: false,
}, null, 2));
