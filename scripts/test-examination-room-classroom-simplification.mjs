import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, core, routes, frontend, delivery] = await Promise.all([
  readFile(new URL('supabase/migrations/20260811173745_exam_room_real_classroom_simplification.sql', root), 'utf8'),
  readFile(new URL('worker/exam-room-2026-core.mjs', root), 'utf8'),
  readFile(new URL('worker/duediligence-2026-routes.mjs', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('worker/exam-room-delivery.mjs', root), 'utf8'),
]);

// Database state is deliberately independent: publication, roster readiness,
// opening, individual submission, grading, and release are not one global gate.
for (const symbol of [
  'exam_room_open_exam_now_v1',
  'exam_room_student_waiting_room_by_code_v1',
  'exam_room_start_attempt_by_code_v1',
  'exam_room_finalize_roster_access_v1',
  'exam_room_grading_workspace_v3',
  'exam_room_save_grade_v3',
]) assert.match(migration, new RegExp(`create or replace function public\\.${symbol}`));

assert.match(migration, /opened_early_at timestamptz/);
assert.match(migration, /opened_early_by uuid/);
assert.match(migration, /exam_room_roster_versions/);
assert.match(migration, /exam_room_student_code_attempt_windows/);
assert.match(migration, /status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.doesNotMatch(
  migration.slice(migration.indexOf('exam_room_grading_workspace_v3'), migration.indexOf('exam_room_save_grade_v3')),
  /exam_room_grading_readiness_v2|nonTerminalAttemptCount|set status = 'grading'/,
  'opening grading must depend on submitted attempts, not whole-class readiness',
);
assert.doesNotMatch(
  migration.slice(migration.indexOf('exam_room_save_grade_v3')),
  /exam_room_grading_readiness_v2/,
  'saving a grade must not require every student to finish',
);
assert.match(migration, /drop trigger if exists exam_room_grade_write_guard_v2/);
assert.match(migration, /exam_room_guard_submitted_grade_write_v3/);
assert.match(migration, /revoke all on function public\.exam_room_guard_submitted_grade_write_v3\(\)[\s\S]*from public, anon, authenticated/);
assert.match(migration, /for update/i);
assert.match(migration, /on conflict \(exam_id, email_type, recipient_email, event_key\) do nothing/);
assert.match(migration, /'questionText', question\.prompt_text/);
assert.match(migration, /'classStatuses', v_class_statuses/);
assert.match(migration, /alter table public\.exam_room_email_jobs[\s\S]*professor_room_key[\s\S]*professor_grading_key[\s\S]*beadle_key[\s\S]*student_exam_code[\s\S]*professor_submission_notice[\s\S]*student_submission_receipt/);

// The Worker exposes only authenticated, validated operations and keeps the
// code fingerprint/rate scope server-side.
for (const operation of ['student_entry', 'start_attempt_by_code', 'finalize_roster_access', 'open_exam_now']) {
  assert.match(core, new RegExp(`'${operation}'`));
  assert.match(routes, new RegExp(`${operation}`));
}
assert.match(routes, /examRoomRateKey\(request, user\.id, 'student_entry'\)/);
assert.match(routes, /encryptStudentExamCode/);

// Student entry is code-only; deep links remain optional navigation hints and
// are not a required authorization input.
const studentStart = frontend.indexOf('function studentSection');
const studentEnd = frontend.indexOf('function activationSection', studentStart);
const studentSection = frontend.slice(studentStart, studentEnd);
assert.doesNotMatch(studentSection, /dd26-student-exam|Examination link|reference in the class handout/);
assert.match(studentSection, /id="dd26-student-key"/);
assert.match(frontend, /operation: 'student_entry'/);
assert.match(frontend, /operation: 'start_attempt_by_code'/);

// The Beadle gets one transaction, with resilient file/paste/manual entry.
assert.match(frontend, /accept="\.xlsx,\.csv/);
assert.match(frontend, /id="dd26-roster-paste"/);
assert.match(frontend, /id="dd26-roster-add-row"/);
assert.match(frontend, /operation: 'finalize_roster_access'/);
assert.doesNotMatch(frontend, /manually approve each student/i);
const beadleSurface = frontend.slice(frontend.indexOf('function renderBeadleOperations'), frontend.indexOf('function openRosterCorrection'));
assert.doesNotMatch(beadleSurface, /data-dd26-verify-candidate|data-dd26-admit-candidate|Student examination link/);
assert.match(beadleSurface, /No per-student approval or manual email is required/);

// Professor can open early and grade submitted candidates immediately.
assert.match(frontend, /data-dd26-open-exam-now/);
assert.match(frontend, /operation: 'open_exam_now'/);
assert.match(frontend, /Grade submitted exams/);
assert.doesNotMatch(frontend, /Grading opens after the examination closes and all active attempts have ended/);
assert.doesNotMatch(frontend, /Open after the exam ends/);
assert.match(frontend, /leave it blank if this account has already verified access/);
assert.match(frontend, /Grading Draft/);
assert.match(frontend, /'active', 'absent', 'late', 'accommodated'/);
assert.match(routes, /p_grading_key_hash: input\.gradingKey \? await h\(input\.gradingKey\) : null/);

// Preview/live numbered navigation is interactive and page lifecycle is
// persistence-only; pagehide may not destroy active state.
assert.match(frontend, /data-dd26-student-preview-nav/);
assert.match(frontend, /<button[^>]*data-dd26-student-preview-nav/);
const pagehide = frontend.slice(frontend.indexOf("addEventListener?.('pagehide'"), frontend.indexOf("document.addEventListener?.('visibilitychange'"));
assert.match(pagehide, /persistCurrentGradingDraft\(\)/);
assert.doesNotMatch(pagehide, /clearGradingWorkspace|studentExamCodes\.clear|finishDialogLifecycle/);
assert.match(frontend, /pageshow/);
assert.match(frontend, /safetySaveTimer: null/);
assert.match(
  frontend,
  /state\.exam\.safetySaveTimer = setInterval\(\(\) => \{[\s\S]{0,500}flushAllLocalSaves\(\)[\s\S]{0,300}flushSyncQueue\(\)[\s\S]{0,300}\}, 30000\)/,
  'An active student attempt must receive an independent 30-second IndexedDB and server-sync safety flush.',
);
assert.match(
  frontend,
  /clearAttemptTimers\(\)[\s\S]{0,300}clearInterval\(state\.exam\.safetySaveTimer\)/,
  'The safety-save interval must be cleared with the other attempt timers.',
);

// Only the authorized transactional classes are added to the existing queue.
for (const emailType of [
  'professor_room_key',
  'professor_grading_key',
  'beadle_key',
  'student_exam_code',
  'professor_submission_notice',
  'student_submission_receipt',
]) assert.match(delivery, new RegExp(`'${emailType}'`));
assert.match(delivery, /student_submission_receipt[\s\S]*answers/);
assert.match(delivery, /questionText/);
assert.match(delivery, /support@duediligence\.ph/);

console.log('Examination Room real-classroom simplification contract passed.');
