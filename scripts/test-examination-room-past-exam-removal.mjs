import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, generalization, core, routes, worker, frontend, css, html, featureLoader] = await Promise.all([
  readFile(new URL('supabase/migrations/20260811230633_exam_room_user_past_exam_removal.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260812235553_generalize_exam_workspace_removal.sql', root), 'utf8'),
  readFile(new URL('worker/exam-room-2026-core.mjs', root), 'utf8'),
  readFile(new URL('worker/duediligence-2026-routes.mjs', root), 'utf8'),
  readFile(new URL('worker/index.mjs', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
]);

// The database operation is a per-user tombstone, never a canonical deletion.
assert.match(migration, /create table if not exists public\.exam_room_user_exam_dismissals/);
assert.match(migration, /primary key \(user_id, exam_id\)/);
assert.match(migration, /references auth\.users\(id\) on delete cascade/);
assert.match(migration, /references public\.exam_room_exams\(id\) on delete cascade/);
for (const canonical of [
  'exam_room_exams', 'exam_room_attempts', 'exam_room_answers', 'exam_room_grades',
  'exam_room_submissions', 'exam_room_submission_receipts', 'exam_room_audit_log',
]) {
  assert.doesNotMatch(migration, new RegExp(`delete\\s+from\\s+public\\.${canonical}`, 'i'));
  assert.doesNotMatch(generalization, new RegExp(`delete\\s+from\\s+public\\.${canonical}`, 'i'));
}

// Ordinary browser roles cannot read or mutate dismissal records directly.
assert.match(migration, /alter table public\.exam_room_user_exam_dismissals enable row level security/);
assert.match(migration, /alter table public\.exam_room_user_exam_dismissals force row level security/);
assert.match(migration, /revoke all privileges on table public\.exam_room_user_exam_dismissals\s+from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on table public\.exam_room_user_exam_dismissals\s+to service_role/);

// Authorization must cover each requested role and be tied to the authenticated user.
const dismissFunction = generalization.slice(generalization.indexOf('exam_room_dismiss_past_exam_v1'));
assert.match(dismissFunction, /v_exam\.owner_professor_id = p_user_id/);
assert.match(dismissFunction, /b\.beadle_user_id = p_user_id[\s\S]*b\.status = 'active'/);
assert.match(dismissFunction, /a\.student_user_id = p_user_id/);
assert.match(dismissFunction, /r\.student_user_id = p_user_id or r\.canonical_email = v_user_email/);
assert.match(dismissFunction, /EXAM_ROOM_EXAM_ACCESS_REQUIRED/);

// Any lifecycle state may be removed from this user's workspace; access still fails closed.
assert.doesNotMatch(dismissFunction, /EXAM_ROOM_PAST_EXAM_REQUIRED/);
assert.doesNotMatch(dismissFunction, /if not v_is_past/);
assert.match(dismissFunction, /'removedFromWorkspace', true/);
assert.match(generalization, /revoke all on function public\.exam_room_dismiss_past_exam_v1\(uuid, uuid, text\)[\s\S]*from public, anon, authenticated/);
assert.match(generalization, /grant execute on function public\.exam_room_dismiss_past_exam_v1\(uuid, uuid, text\)[\s\S]*to service_role/);

// The validated Worker command carries only actor scope, exam UUID, and request key.
assert.match(core, /'dismiss_past_exam'/);
assert.match(routes, /dismiss_past_exam:[\s\S]*exam_room_dismiss_past_exam_v1/);
assert.match(routes, /exam_room_dismissed_past_exam_ids_v1/);
assert.match(routes, /archivedProfessorExams/);
assert.match(routes, /Removing a past exam hides it from the active workspace, never from the[\s\S]*permanent grade-record archive/);
assert.match(worker, /'exam_room_dismissed_past_exam_ids_v1'/);
assert.match(worker, /'exam_room_dismiss_past_exam_v1'/);
assert.match(worker, /EXAM_ROOM_EXAM_ACCESS_REQUIRED:[\s\S]*their own workspace/);
assert.match(worker, /EXAM_ROOM_PAST_EXAM_ACCESS_REQUIRED/);
assert.match(worker, /EXAM_ROOM_PAST_EXAM_REQUIRED/);

// Professor, Beadle, and Student surfaces expose the same all-state workspace action.
assert.match(frontend, /examWorkspaceRemovalButton\(exam, 'professor'\)/);
assert.match(frontend, /examWorkspaceRemovalButton\(exam, 'beadle'\)/);
assert.match(frontend, /examWorkspaceRemovalButton\(exam, 'student'\)/);
assert.match(frontend, /data-dd26-delete-workspace-exam/);
assert.match(frontend, /function professorExamList/);
assert.match(frontend, /class="dd26-professor-exam-list" role="list"/);
assert.match(frontend, /class="dd26-professor-exam-row\$\{selected \? ' is-selected' : ''\}"/);
assert.doesNotMatch(frontend.slice(frontend.indexOf('function professorSection'), frontend.indexOf('function professorClass')), /class="dd26-toolbar"/);
assert.match(frontend, /Official grade archive/);
assert.match(frontend, /data-dd26-results-dashboard="\$\{escapeHtml\(exam\.examId\)\}"/);
assert.match(frontend, /submissions, saved grades, comments, result delivery status, analytics, and workbook exports are never deleted/);

// Confirmation is explicit and reuses the global accessible dialog contract.
const dialogFlow = frontend.slice(
  frontend.indexOf('function openExamWorkspaceRemoval'),
  frontend.indexOf('function bindExamSection'),
);
assert.match(dialogFlow, /Are you sure\?/);
assert.match(dialogFlow, /Delete from my workspace/);
assert.match(dialogFlow, /official records stay preserved/i);
assert.match(dialogFlow, /does not close the examination, stop its clock, revoke access/);
assert.match(dialogFlow, /operation: 'dismiss_past_exam'/);
const dialogShell = frontend.slice(
  frontend.indexOf('function openDialog'),
  frontend.indexOf('function closeDialog'),
);
assert.match(dialogShell, /class="dd26-dialog-close"/);
assert.match(dialogShell, /back\.textContent = 'Back'/);
assert.match(css, /\.dd26-table-actions\{margin-top:0;gap:8px;\}/);
assert.match(css, /\.dd26-professor-exam-list\{/);
assert.match(css, /\.dd26-professor-exam-row\.is-selected/);
assert.match(css, /@media \(max-width:680px\)[\s\S]*\.dd26-professor-exam-row\{grid-template-columns:1fr/);

assert.match(featureLoader, /duediligence-2026\.css\?v=exam-room-ux-20260814-1/);
assert.match(featureLoader, /duediligence-2026\.js\?v=exam-room-ux-20260814-1/);

console.log('Examination Room all-state workspace removal and Professor list contracts passed.');
