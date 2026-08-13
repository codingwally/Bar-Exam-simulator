import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('supabase/migrations/20260812015047_examination_room_class_results_dashboard.sql', root), 'utf8');
const extension = await readFile(new URL('supabase/migrations/20260812235553_generalize_exam_workspace_removal.sql', root), 'utf8');
const worker = await readFile(new URL('worker/duediligence-2026-routes.mjs', root), 'utf8');
const index = await readFile(new URL('worker/index.mjs', root), 'utf8');
const delivery = await readFile(new URL('worker/exam-room-delivery.mjs', root), 'utf8');
const css = await readFile(new URL('assets/duediligence-2026.css', root), 'utf8');

assert.match(migration, /exam_room_professor_results_dashboard_v1/);
assert.match(migration, /exam\.owner_professor_id = p_professor_user_id/);
assert.match(migration, /attempt\.status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(migration, /jsonb_array_elements\(submission\.answer_snapshot\)/);
assert.match(migration, /'studentNumber', roster\.student_number/);
assert.match(migration, /'lateEntry'/);
assert.match(migration, /'lateSubmission'/);
assert.match(migration, /'allGradesFinal'/);
assert.match(migration, /p_export_scope = 'class_results'[\s\S]*allGradesFinal/);
assert.match(migration, /'classStatuses'[\s\S]*selected_candidate ->> 'candidateNumber' = class_status ->> 'candidateNumber'/,
  'selected workbooks must not include unrelated roster identities');
assert.match(migration, /enable row level security/);
assert.match(migration, /force row level security/);
assert.match(migration, /revoke all on table public\.exam_room_class_result_exports from public, anon, authenticated/);
assert.match(migration, /revoke all on table public\.exam_room_class_result_exports from service_role/);
assert.match(migration, /grant select, insert, update on table public\.exam_room_class_result_exports to service_role/);
assert.doesNotMatch(migration, /grant .* to authenticated/);
assert.match(migration, /includes_submitted_answers/);
assert.match(migration, /class_result_export_requested/);
assert.match(migration, /class_result_export_completed/);
assert.match(migration, /'generatedAt', v_export\.requested_at/,
  'idempotent export retries must reuse the original audited generation timestamp');
assert.match(migration, /The existing release function remains intentionally untouched/);
assert.match(extension, /cardinality\(selected_attempt_ids\) between 0 and 500/);
assert.match(extension, /export_scope = 'offline_grading' or cardinality\(selected_attempt_ids\) >= 1/);
assert.match(extension, /v_class_statuses := coalesce\(v_dashboard -> 'classStatuses', '\[\]'::jsonb\)/,
  'every workbook overview must retain the full confirmed class roster');
assert.doesNotMatch(extension, /from jsonb_array_elements\(v_dashboard -> 'classStatuses'\)[\s\S]*selected_candidate/,
  'selecting detailed answers must not hide other roster members from the class overview');
assert.match(extension, /'includes_submitted_answers', cardinality\(v_selected\) > 0/,
  'roster-only exports must be audited without claiming to contain answers');
assert.match(extension, /from public\.exam_room_questions question[\s\S]*question\.question_version_id = v_exam\.active_question_version_id/,
  'a pre-submission workbook must include the immutable Professor questions');
assert.match(extension, /'questions', v_questions/);
assert.match(extension, /'durationMinutes', v_exam\.duration_minutes/);
assert.match(extension, /exam_room_release_results_v2[\s\S]*exam_room_verify_grading_access_v3/,
  'result release must support remembered Professor access');
assert.match(extension, /exam_room_prepare_result_export_v4[\s\S]*exam_room_verify_grading_access_v3/,
  'individual export must support remembered Professor access');

assert.match(worker, /normalizeExamClassResultsWorkbookRequest/);
assert.match(worker, /exam_room_prepare_class_result_export_v1/);
assert.match(worker, /exam_room_prepare_result_export_v4/);
assert.match(worker, /exam_room_complete_class_result_export_v1/);
assert.match(worker, /private, no-store/);
assert.match(index, /\/exam-room\/results\/workbook/);
assert.match(delivery, /Overall score:/);
assert.match(delivery, /Professor comment:/);
assert.match(delivery, /job\.email_type === 'student_result'/);
assert.match(delivery, /professorReleaseMessage/);
assert.match(delivery, /class results and gradebook/);
assert.match(delivery, /attachments/);
assert.match(delivery, /exam_room_professor_results_dashboard_v1/);

assert.match(css, /\.dd26-result-selection/);
assert.match(css, /\.dd26-result-metrics/);
assert.match(css, /\.dd26-result-bar/);
assert.match(css, /\.dd26-grading-queue/);
assert.match(css, /@media \(max-width:980px\)/);

console.log('Examination Room class-results migration, authorization, delivery, and design checks passed.');
