import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationName = '20260811003100_examination_room_2_beta.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const stalePath = path.join(root, 'supabase', 'migrations', '20260809141407_examination_room_2_beta.sql');
const requestGatePath = path.join(
  root,
  'supabase',
  'migrations',
  '20260825140020_examination_room_registered_professor_request_gate.sql',
);

assert.equal(fs.existsSync(migrationPath), true, 'ordered Examination Room 2.0 migration must exist');
assert.equal(fs.existsSync(stalePath), false, 'pre-foundation empty migration stub must not remain');
assert.equal(fs.existsSync(requestGatePath), true, 'registered-Professor room-request gate migration must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');
const lower = sql.toLowerCase();
const requestGateSql = fs.readFileSync(requestGatePath, 'utf8');

assert.match(lower, /^-- duediligence examination room 2\.0 beta\./);
assert.match(lower, /begin;/);
assert.match(lower, /commit;\s*$/);

for (const table of [
  'exam_room_publications',
  'exam_room_publication_model_answers',
  'exam_room_beadle_invitations',
  'exam_room_beadle_assignments',
  'exam_room_admissions',
  'exam_room_accommodations',
  'exam_room_deadline_extensions',
  'exam_room_sessions',
  'exam_room_session_events',
  'exam_room_answer_operations',
  'exam_room_answer_revisions',
  'exam_room_answer_conflict_branches',
  'exam_room_submissions',
  'exam_room_submission_receipts',
  'exam_room_submission_reopenings',
  'exam_room_errata',
  'exam_room_temporary_leaves',
  'exam_room_incident_groups',
  'exam_room_audit_events_v2',
  'exam_room_admin_break_glass_grants',
  'exam_room_admin_break_glass_events',
]) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} missing`);
}

const expectedRpcs = [
  'exam_room_is_professor',
  'exam_room_has_active_beadle_assignment_v2',
  'exam_room_exam_access_v2',
  'exam_room_beadle_portal_v2',
  'exam_room_live_status_v2',
  'exam_room_student_preflight_v2',
  'exam_room_incident_summary_v2',
  'exam_room_can_manage_roster_v2',
  'exam_room_validate_exam_roster_v2',
  'exam_room_import_exam_roster_v2',
  'exam_room_upsert_roster_row_v2',
  'exam_room_register_model_answer_source_v2',
  'exam_room_publish_exam_v2',
  'exam_room_confirm_replacement_questions_v2',
  'exam_room_replace_publication_v2',
  'exam_room_grading_model_answer_v2',
  'exam_room_issue_beadle_invitation_v2',
  'exam_room_redeem_beadle_invitation_v2',
  'exam_room_revoke_beadle_assignment_v2',
  'exam_room_admit_candidate_v2',
  'exam_room_set_accommodation_v2',
  'exam_room_record_verification_v2',
  'exam_room_open_session_v2',
  'exam_room_transfer_session_v2',
  'exam_room_heartbeat_v2',
  'exam_room_attempt_view_v2',
  'exam_room_submission_status_v2',
  'exam_room_save_answer_operation_v2',
  'exam_room_submit_attempt_generation_v2',
  'exam_room_reopen_submission_generation_v2',
  'exam_room_assert_fresh_aal2_v2',
  'exam_room_assert_admin_break_glass_identity_v2',
  'exam_room_assert_admin_break_glass_active_v2',
  'exam_room_issue_admin_break_glass_v2',
  'exam_room_admin_break_glass_evidence_v2',
  'exam_room_close_admin_break_glass_v2',
  'exam_room_record_admin_break_glass_review_v2',
  'exam_room_issue_erratum_v2',
  'exam_room_start_temporary_leave_v2',
  'exam_room_end_temporary_leave_v2',
  'exam_room_acknowledge_temporary_leave_v2',
  'exam_room_record_integrity_event_v2',
  'exam_room_record_technical_incident_v2',
  'exam_room_revoke_beadle_delegation_on_seal_v2',
  'exam_room_guard_accommodation_state_v2',
  'exam_room_grading_readiness_v2',
  'exam_room_guard_grade_write_v2',
  'exam_room_guard_attempt_terminal_v2',
  'exam_room_guard_exam_grading_state_v2',
  'exam_room_auto_submit_due',
  'exam_room_grading_workspace',
  'exam_room_save_grade',
  'exam_room_release_results',
];

function functionBlock(name) {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  );
  const match = sql.match(pattern);
  assert.ok(match, `${name} definition missing`);
  return match[0];
}

for (const name of expectedRpcs) {
  const block = functionBlock(name).toLowerCase();
  assert.match(block, /security definer/, `${name} must be SECURITY DEFINER`);
  assert.match(block, /set search_path = ''/, `${name} must use an empty search_path`);
}

const legacyIntegrity = functionBlock('exam_room_record_integrity_event').toLowerCase();
assert.match(legacyIntegrity, /exam_room_v2_session_required/);
assert.doesNotMatch(legacyIntegrity, /set status = 'locked'/, 'integrity signals must not auto-lock');
assert.doesNotMatch(legacyIntegrity, /v_threshold/, 'integrity signals must not use a hidden failure threshold');
const integrity = functionBlock('exam_room_record_integrity_event_v2').toLowerCase();
assert.match(integrity, /exam_room_assert_session_v2/);
assert.match(integrity, /rules_snapshot ->> 'integritymode'/);
assert.match(integrity, /configuration ->> 'integrityexempt'/);
assert.match(integrity, /'ignored', true/);
assert.match(integrity, /'recorded', false/);
assert.match(integrity, /exam_room_append_incident_v2/);
assert.match(integrity, /p_client_event_id/);
assert.doesNotMatch(integrity, /set status = 'locked'/, 'v2 integrity signals must not auto-lock');
assert.doesNotMatch(integrity, /v_threshold/, 'v2 integrity signals must not use a hidden failure threshold');
assert.match(functionBlock('exam_room_append_incident_v2').toLowerCase(), /'locked', false/);

const transfer = functionBlock('exam_room_transfer_session_v2').toLowerCase();
assert.match(transfer, /exam_room_is_operator_v2/);
assert.doesNotMatch(transfer, /p_student_user_id/, 'session transfer must be operator-approved');
assert.match(transfer, /exam_room_identity_verifications/);
assert.match(transfer, /interval '30 minutes'/);
assert.match(transfer, /method in \('physical', 'institutional'\)/);
assert.match(transfer, /method = 'manual_exception'/);
assert.match(transfer, /outcome = 'exception_approved'/);
assert.doesNotMatch(transfer, /method = 'camera_exception'/, 'camera exception alone must not authorize transfer');
assert.match(transfer, /exam_room_recent_verification_required/);
assert.match(transfer, /'verificationid', v_verification\.id/);

const heartbeat = functionBlock('exam_room_heartbeat_v2').toLowerCase();
assert.match(heartbeat, /exam_room_assert_session_v2/);
assert.match(heartbeat, /p_session_public_id/);
assert.match(heartbeat, /p_session_epoch/);
assert.match(heartbeat, /update public\.exam_room_sessions/);
assert.match(heartbeat, /update public\.exam_room_attempts/);
assert.match(heartbeat, /'status', v_attempt\.status/);
assert.match(heartbeat, /'servernow', v_now/);
assert.match(heartbeat, /'serverdeadline', v_attempt\.server_deadline/);
assert.doesNotMatch(heartbeat, /submit_attempt_internal/, 'v2 heartbeat must not bypass the bounded submission grace policy');
assert.match(functionBlock('exam_room_heartbeat'), /EXAM_ROOM_V2_SESSION_REQUIRED/);

const startAttempt = functionBlock('exam_room_start_attempt').toLowerCase();
assert.match(startAttempt, /current_publication_id is null/);
assert.match(startAttempt, /identity_verification_blocked/);
assert.match(startAttempt, /rules_snapshot ->> 'studentaccesscoderequired'/);
assert.match(startAttempt, /then[\s\S]*exam_room_check_credential/);
assert.match(startAttempt, /v_publication\.question_version_id/);
assert.doesNotMatch(startAttempt, /v_extra[^;]*breakminutes/s, 'break allowance must not extend the timer');

const preflight = functionBlock('exam_room_student_preflight_v2').toLowerCase();
assert.match(preflight, /'accesscoderequired'/);
assert.match(preflight, /studentaccesscoderequired/);

const autoSubmit = functionBlock('exam_room_auto_submit_due');
assert.match(autoSubmit, /a\.publication_id is null and a\.server_deadline <= now\(\)/);
assert.match(autoSubmit, /a\.publication_id is not null[\s\S]*make_interval[\s\S]*submissionGraceMinutes/);
assert.doesNotMatch(autoSubmit, /submissionGraceMinutes'\)::integer,\s*0/);
assert.match(autoSubmit, /public\.exam_room_commit_submission_v2\([\s\S]*'deadline-auto-submit'/);
assert.match(autoSubmit, /current_publication_id is null[\s\S]*hard_closes_at <= now\(\)/);
assert.match(autoSubmit, /current_publication_id is not null[\s\S]*exam_room_grading_readiness_v2/);
assert.match(autoSubmit, /for update of a skip locked/);
assert.match(autoSubmit, /set search_path = ''/);

const gradingReadiness = functionBlock('exam_room_grading_readiness_v2');
assert.match(gradingReadiness, /\r?\nlanguage plpgsql\r?\nstable\r?\n/i);
assert.match(gradingReadiness, /individualHardClosesAt/);
assert.match(gradingReadiness, /extraMinutes/);
assert.match(gradingReadiness, /incidentExtensionMinutes/);
assert.match(gradingReadiness, /submissionGraceMinutes/);
assert.match(gradingReadiness, /v_grace_minutes is null/);
assert.match(gradingReadiness, /not in \('denied', 'withdrawn', 'no_show'\)/);
assert.match(gradingReadiness, /status not in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(gradingReadiness, /a\.server_deadline \+ make_interval/);
assert.match(gradingReadiness, /now\(\) >= v_wait_until and v_nonterminal_attempts = 0/);

const gradingWorkspace = functionBlock('exam_room_grading_workspace');
assert.match(gradingWorkspace, /exam_room_auto_submit_due/);
assert.match(gradingWorkspace, /exam_room_grading_readiness_v2/);
assert.match(gradingWorkspace, /'GRADING_NOT_OPEN'/);
assert.match(gradingWorkspace, /a\.status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(gradingWorkspace, /current_publication_id is null/);

const saveGrade = functionBlock('exam_room_save_grade');
assert.match(saveGrade, /exam_room_auto_submit_due/);
assert.match(saveGrade, /exam_room_grading_readiness_v2/);
assert.match(saveGrade, /v_attempt\.status not in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(saveGrade, /current_publication_id is null/);

const releaseResults = functionBlock('exam_room_release_results');
assert.match(releaseResults, /exam_room_auto_submit_due/);
assert.match(releaseResults, /exam_room_grading_readiness_v2/);
assert.ok(
  [...releaseResults.matchAll(/status not in \('submitted', 'auto_submitted', 'sealed'\)/g)].length >= 2,
  'release must recheck non-terminal attempts before sealing',
);
assert.match(releaseResults, /where exam_id = v_exam\.id[\s\S]*status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(releaseResults, /current_publication_id is null/);

const accommodation = functionBlock('exam_room_set_accommodation_v2');
assert.match(accommodation, /v_exam\.status = 'sealed' or v_exam\.release_id is not null/);
assert.match(accommodation, /v_exam\.status not in \('draft', 'confirmed', 'scheduled', 'open'\)/);
assert.match(accommodation, /EXAM_ROOM_ACCOMMODATION_ATTEMPT_CLOSED/);
assert.match(accommodation, /EXAM_ROOM_ACCOMMODATION_OPEN_WINDOW_IMMUTABLE/);
assert.match(accommodation, /individualHardClosesAt/);
assert.match(accommodation, /v_attempt\.started_at \+ make_interval/);
assert.match(accommodation, /EXAM_ROOM_ACCOMMODATION_DEADLINE_REDUCTION_FORBIDDEN/);
assert.match(accommodation, /insert into public\.exam_room_deadline_extensions/);
assert.match(accommodation, /EXAM_ROOM_SEALED'[\s\S]*exam_room_command_begin_v2/);
assert.match(accommodation, /EXAM_ROOM_ACCOMMODATION_DEADLINE_REDUCTION_FORBIDDEN[\s\S]*insert into public\.exam_room_accommodations/);

const accommodationGuard = functionBlock('exam_room_guard_accommodation_state_v2');
assert.match(accommodationGuard, /tg_op = 'DELETE'/i);
assert.match(accommodationGuard, /EXAM_ROOM_ACCOMMODATION_EVIDENCE_DELETE_FORBIDDEN/);
assert.match(accommodationGuard, /v_exam\.status = 'sealed' or v_exam\.release_id is not null/);
assert.match(accommodationGuard, /status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(lower, /create trigger exam_room_accommodation_state_guard_v2/);
assert.match(lower, /'exam_room_leave_events', 'exam_room_deadline_extensions'/);

const gradeWriteGuard = functionBlock('exam_room_guard_grade_write_v2');
assert.match(gradeWriteGuard, /exam_room_grading_readiness_v2/);
assert.match(gradeWriteGuard, /EXAM_ROOM_GRADE_IDENTITY_IMMUTABLE/);
assert.match(gradeWriteGuard, /v_attempt\.status not in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(gradeWriteGuard, /EXAM_ROOM_GRADE_EVIDENCE_DELETE_FORBIDDEN/);
const attemptTerminalGuard = functionBlock('exam_room_guard_attempt_terminal_v2');
assert.match(attemptTerminalGuard, /EXAM_ROOM_ATTEMPT_PUBLICATION_IMMUTABLE/);
assert.match(attemptTerminalGuard, /EXAM_ROOM_ATTEMPT_DEADLINE_REDUCTION_FORBIDDEN/);
assert.match(attemptTerminalGuard, /new\.status = 'sealed'/);
assert.match(attemptTerminalGuard, /old\.status not in \('submitted', 'auto_submitted', 'sealed'\)/);
const gradingStateGuard = functionBlock('exam_room_guard_exam_grading_state_v2');
assert.match(gradingStateGuard, /exam_room_grading_readiness_v2/);
assert.match(gradingStateGuard, /EXAM_ROOM_RELEASE_REQUIRES_SEAL/);
assert.match(gradingStateGuard, /EXAM_ROOM_SEAL_REQUIRES_RELEASE/);
assert.match(gradingStateGuard, /status not in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(lower, /create trigger exam_room_grade_write_guard_v2/);
assert.match(lower, /create trigger exam_room_attempt_terminal_guard_v2/);
assert.match(lower, /before update of status, publication_id, server_deadline on public\.exam_room_attempts/);
assert.match(lower, /create trigger exam_room_grading_state_guard_v2/);

const publish = functionBlock('exam_room_publish_exam_v2');
assert.match(publish, /p_student_key_hash text/);
assert.match(publish, /'studentCredentialHash', p_student_key_hash/);
assert.match(publish, /v_exam\.status <> 'scheduled'/);
assert.match(publish, /p_rules ->> 'navigationMode' = 'one_way'[\s\S]*EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE/);
assert.match(publish, /p_rules ->> 'suggestedAnswerMode' = 'upload'[\s\S]*EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE/);
assert.match(functionBlock('exam_room_register_model_answer_source_v2'), /raise exception 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE'/);
assert.match(publish, /p_rules ->> 'navigationMode'\) <> 'free'/);
assert.match(publish, /current_publication_id is not null/);
assert.match(publish, /v_student_rules := p_rules - 'suggestedAnswer' - 'suggestedAnswerObjectPath'/);
assert.match(publish, /coalesce\(\(p_rules ->> 'aiGradingEnabled'\)::boolean, true\)/);
assert.match(publish, /studentAccessCodeRequired/);
assert.match(publish, /jsonb_typeof\(p_rules -> 'studentAccessCodeRequired'\) <> 'boolean'/);
assert.match(publish, /Student access code disabled in the immutable publication policy/);
assert.match(publish, /c\.token_hash = p_student_key_hash/);
assert.match(publish, /EXAM_ROOM_STUDENT_ACCESS_CODE_MISMATCH/);
assert.match(publish, /EXAM_ROOM_STUDENT_ACCESS_CODE_UNEXPECTED/);
assert.match(publish, /supersedes_publication_id/);
assert.match(publish, /v_publication_number/);
assert.match(publish, /app\.exam_room_replacement_exam/);

assert.doesNotMatch(
  lower,
  /create table if not exists public\.exam_room_publications[\s\S]{0,300}?exam_id uuid not null unique/,
  'publication history must allow more than one immutable version per exam',
);
assert.match(lower, /exam_room_publications_exam_version_v2_uq/);
assert.match(lower, /exam_room_publications_supersedes_v2_uq/);
assert.match(lower, /exam_room_publications_replacement_shape_v2_check/);
assert.match(lower, /exam_room_publications_supersedes_v2_fkey/);
assert.match(lower, /exam_room_question_sources_extraction_status_check[\s\S]*staged_replacement/);
assert.match(lower, /exam_room_source_confirmation_check[\s\S]*staged_replacement/);
const stagedSourceGuard = functionBlock('exam_room_guard_staged_question_source_v2');
assert.match(stagedSourceGuard, /old\.extraction_status = 'staged_replacement'/);
assert.match(stagedSourceGuard, /EXAM_ROOM_STAGED_QUESTION_SOURCE_IMMUTABLE/);
assert.match(lower, /create trigger exam_room_staged_question_source_immutable_guard_v2/);

const confirmReplacement = functionBlock('exam_room_confirm_replacement_questions_v2');
assert.match(confirmReplacement, /owner_professor_id = p_professor_user_id/);
assert.match(confirmReplacement, /p_expected_publication_id/);
assert.match(confirmReplacement, /clock_timestamp\(\) >= v_exam\.opens_at/);
assert.match(confirmReplacement, /exam_room_attempts/);
assert.match(confirmReplacement, /replacementQuestionVersionId/);
assert.match(confirmReplacement, /p_content_hash, 'staged_replacement'/);
assert.doesNotMatch(
  confirmReplacement,
  /update public\.exam_room_exams/,
  'staging corrected questions must not mutate the live exam/publication',
);

const replacePublication = functionBlock('exam_room_replace_publication_v2');
assert.match(replacePublication, /p_expected_publication_id uuid/);
assert.match(replacePublication, /p_replacement_question_version_id uuid/);
assert.match(replacePublication, /'studentCredentialHash', p_student_key_hash/);
assert.match(replacePublication, /'gradingCredentialHash', p_grading_key_hash/);
assert.match(replacePublication, /qv\.id <> v_previous\.question_version_id/);
assert.match(replacePublication, /qv\.confirmed_at >= v_previous\.published_at/);
assert.match(replacePublication, /source\.extraction_status = 'staged_replacement'/);
assert.match(replacePublication, /source\.confirmed_by = p_professor_user_id/);
assert.match(replacePublication, /EXAM_ROOM_REPLACEMENT_ATTEMPTS_EXIST/);
assert.match(replacePublication, /clock_timestamp\(\) >= v_exam\.opens_at/);
assert.match(replacePublication, /set status = 'revoked'/);
assert.match(replacePublication, /credential_type in \('student_exam', 'professor_grading'\)/);
assert.match(replacePublication, /exam_room_publish_exam_v2/);
assert.match(replacePublication, /previousPublicationId/);
assert.match(replacePublication, /questionVersionChanged/);
assert.match(replacePublication, /exam_publication_replaced/);
assert.match(replacePublication, /event_key/);
assert.match(replacePublication, /notificationStatus/);
assert.doesNotMatch(replacePublication, /update public\.exam_room_publications/);

const gradingModelAnswer = functionBlock('exam_room_grading_model_answer_v2');
assert.match(gradingModelAnswer, /e\.owner_professor_id = p_professor_user_id/);
assert.doesNotMatch(gradingModelAnswer, /exam_room_is_admin|exam_room_is_operator_v2|beadle/i);
assert.match(gradingModelAnswer, /now\(\) < v_exam\.hard_closes_at/);
assert.match(gradingModelAnswer, /v_exam\.status not in \('grading', 'sealed'\)/);
assert.match(gradingModelAnswer, /'professor_grading'/);
assert.match(gradingModelAnswer, /exam_room_check_credential/);
assert.match(gradingModelAnswer, /'answerText', v_model\.answer_text/);
assert.match(gradingModelAnswer, /'available', false[\s\S]*'mode', 'upload'/);
assert.match(gradingModelAnswer, /model_answer_file_retrieval_unavailable/i);
assert.match(gradingModelAnswer, /'safeFileName', v_source\.safe_file_name/);
assert.doesNotMatch(gradingModelAnswer, /object_path|'objectPath'|'sourceId'/i);

const portal = functionBlock('exam_room_beadle_portal_v2');
assert.match(portal, /'canViewAnswers', false/);
assert.match(portal, /exam_room_has_active_beadle_assignment_v2/);
assert.match(portal, /'expiresAt'/);
assert.match(portal, /'assignmentExpiresAt'/);
assert.doesNotMatch(portal, /exam_room_is_admin/, 'global admins must not be projected into the public Beadle portal');
assert.doesNotMatch(portal, /answer_text|answerText|model_answer/i, 'Beadle projection must not include answer content');
assert.match(portal, /'activeSessionEpoch'/);
assert.match(portal, /'accessCodeRequired'/);
assert.match(portal, /studentAccessCodeRequired/);
assert.doesNotMatch(portal, /device_instance_hash|sessionId/i, 'Beadle projection must expose an epoch, never a device hash or session token');

const operator = functionBlock('exam_room_is_operator_v2');
assert.doesNotMatch(operator, /exam_room_is_admin/, 'global Admin is metadata-only and must not inherit operator power');
const professorAuthority = functionBlock('exam_room_is_professor');
assert.match(professorAuthority, /exam_room_professors/);
assert.match(professorAuthority, /p\.status = 'active'/,
  'only an active Professor registration may authorize the Professor workspace');
assert.doesNotMatch(professorAuthority, /exam_room_is_admin/, 'Admin status must not synthesize Professor authority');
assert.match(requestGateSql, /create or replace function public\.exam_room_submit_request/);
assert.match(requestGateSql, /perform public\.exam_room_require_professor\(p_user_id\);/,
  'room-request submission must reuse the active Professor authority check');
assert.ok(
  requestGateSql.indexOf('perform public.exam_room_require_professor(p_user_id);')
    < requestGateSql.indexOf('insert into public.exam_room_requests'),
  'Professor authority must be checked before a room request can be inserted',
);
assert.match(requestGateSql, /revoke all on function public\.exam_room_submit_request[\s\S]*from public, anon, authenticated/);
assert.match(requestGateSql, /grant execute on function public\.exam_room_submit_request[\s\S]*to service_role/);
const rosterOperator = functionBlock('exam_room_can_manage_roster_v2');
assert.doesNotMatch(rosterOperator, /exam_room_is_admin/, 'global Admin must not inherit roster mutation power');
const examAccess = functionBlock('exam_room_exam_access_v2');
assert.match(examAccess, /'admin', v_admin/);
assert.match(examAccess, /'canUploadQuestions', v_owner/);
assert.match(examAccess, /'canViewAnswers', v_owner/);
assert.match(examAccess, /'canManageOperations', v_owner or v_beadle/);
assert.match(examAccess, /'storagePrefix', case when v_owner/);
for (const ownerOnlyRpc of [
  'exam_room_register_model_answer_source_v2',
  'exam_room_publish_exam_v2',
  'exam_room_confirm_replacement_questions_v2',
  'exam_room_replace_publication_v2',
  'exam_room_issue_beadle_invitation_v2',
  'exam_room_revoke_beadle_assignment_v2',
  'exam_room_set_accommodation_v2',
  'exam_room_issue_erratum_v2',
  'exam_room_schedule_exam',
]) {
  const block = functionBlock(ownerOnlyRpc);
  assert.match(block, /owner_professor_id = p_professor_user_id/, `${ownerOnlyRpc} must require exact exam ownership`);
  assert.doesNotMatch(block, /exam_room_is_admin/, `${ownerOnlyRpc} must not grant blanket Admin mutation power`);
}

const beadleGuard = functionBlock('exam_room_has_active_beadle_assignment_v2');
assert.match(beadleGuard, /b\.expires_at > now\(\)/);
assert.match(beadleGuard, /e\.status <> 'sealed'/);
assert.match(beadleGuard, /e\.release_id is null/);
const redeemBeadle = functionBlock('exam_room_redeem_beadle_invitation_v2');
assert.match(redeemBeadle, /assigned_by, expires_at/);
assert.match(redeemBeadle, /v_invitation\.expires_at/);
assert.match(redeemBeadle, /'expiresAt', v_assignment\.expires_at/);
assert.match(redeemBeadle, /exam_room_beadle_delegation_closed/i);
const sealBeadle = functionBlock('exam_room_revoke_beadle_delegation_on_seal_v2');
assert.match(sealBeadle, /new\.status = 'sealed'/);
assert.match(sealBeadle, /update public\.exam_room_beadle_assignments/);
assert.match(sealBeadle, /update public\.exam_room_beadle_invitations/);
assert.match(lower, /create trigger exam_room_beadle_delegation_seal_guard_v2/);
assert.match(lower, /create table if not exists public\.exam_room_beadle_assignments[\s\S]*expires_at timestamptz not null/);

const submit = functionBlock('exam_room_submit_attempt_generation_v2');
assert.match(submit, /p_client_answer_set_hash text/);
assert.match(submit, /p_request_key !~ '\^\[A-Za-z0-9_-\]\{16,128\}\$'/);
assert.match(submit, /v_submission\.client_answer_set_hash is distinct from p_client_answer_set_hash/);
assert.match(submit, /p_client_pending_at timestamptz default null/);
assert.match(submit, /latePendingAccepted/);
assert.match(lower, /create table if not exists public\.exam_room_submission_receipts/);
assert.match(lower, /public_id uuid not null default extensions\.gen_random_uuid\(\) unique/);
assert.match(submit, /exam_room_submission_reopenings/);

assert.match(lower, /create table if not exists public\.exam_room_submission_reopenings/);
assert.match(lower, /prior_submission_id uuid not null/);
assert.match(lower, /prior_receipt_id uuid not null/);
assert.match(lower, /authorized_generation integer not null/);
assert.match(lower, /authority_type text not null check \(authority_type in \('owner_professor', 'admin_break_glass'\)\)/);
assert.match(lower, /new_deadline <= opened_at \+ interval '4 hours'/);
assert.match(lower, /exam_room_submission_reopenings_break_glass_v2_fkey/);
assert.match(lower, /exam_room_submissions_generation_lineage_v2_check/);
assert.match(lower, /exam_room_admin_break_glass_auth_freshness_check/);
assert.match(lower, /exam_room_admin_break_glass_event_auth_freshness_check/);

const reopen = functionBlock('exam_room_reopen_submission_generation_v2');
assert.match(reopen, /p_grading_key_hash text/);
assert.match(reopen, /p_rate_key_hash text/);
assert.match(reopen, /'gradingCredentialHash', p_grading_key_hash/);
assert.match(reopen, /'rateKeyHash', p_rate_key_hash/);
assert.match(reopen, /p_verified_authentication_at timestamptz/);
assert.match(reopen, /owner_professor_id = p_actor_user_id/);
assert.match(reopen, /exam_room_check_credential/);
assert.match(reopen, /'professor_grading'/);
assert.match(reopen, /exam_room_assert_admin_break_glass_active_v2/);
assert.match(reopen, /p_new_deadline > clock_timestamp\(\) \+ interval '4 hours'/);
assert.match(reopen, /v_prior_receipt\.snapshot_hash/);
assert.match(reopen, /app\.exam_room_reopen_attempt/);
assert.match(reopen, /requiresNewSession/);
assert.match(reopen, /submission_reopened/);
assert.match(reopen, /event_key/);
assert.match(reopen, /notificationStatus/);
assert.doesNotMatch(reopen, /delete from public\.exam_room_(submissions|submission_receipts)/i);

const commitSubmission = functionBlock('exam_room_commit_submission_v2');
assert.match(commitSubmission, /v_reopening\.authorized_generation/);
assert.match(commitSubmission, /reopening_id, prior_submission_id/);
assert.match(commitSubmission, /deadline-auto-submit-g/);
assert.match(commitSubmission, /priorReceiptId/);
const terminalGuard = functionBlock('exam_room_guard_attempt_terminal_v2');
assert.match(terminalGuard, /app\.exam_room_reopen_attempt/);
assert.match(terminalGuard, /new\.server_deadline <= old\.server_deadline/);
assert.match(terminalGuard, /EXAM_ROOM_REOPEN_AUTHORIZATION_REQUIRED/);

const liveStatus = functionBlock('exam_room_live_status_v2');
assert.match(liveStatus, /owner_professor_id = p_professor_user_id/);
assert.match(liveStatus, /exam_room_check_credential/);
assert.match(liveStatus, /canReopenSubmission/);
assert.match(liveStatus, /reopenBlockedReason/);
assert.match(liveStatus, /latestReceiptId/);
assert.match(liveStatus, /priorReceiptId/);
assert.doesNotMatch(liveStatus, /answer_text|answerText|questions_snapshot|prompt_text/i);

assert.match(lower, /alter table public\.exam_room_email_jobs[\s\S]*add column if not exists event_key/);
assert.match(lower, /exam_publication_replaced/);
assert.match(lower, /submission_reopened/);
assert.match(lower, /exam_room_email_jobs_event_v2_uq/);

const freshAal = functionBlock('exam_room_assert_fresh_aal2_v2');
assert.match(freshAal, /p_verified_aal is distinct from 'aal2'/);
assert.match(freshAal, /interval '15 minutes'/);
assert.match(freshAal, /interval '1 minute'/);
const breakGlassIdentity = functionBlock('exam_room_assert_admin_break_glass_identity_v2');
assert.match(breakGlassIdentity, /for update/);
const breakGlassActive = functionBlock('exam_room_assert_admin_break_glass_active_v2');
assert.match(breakGlassActive, /clock_timestamp\(\) >= v_grant\.expires_at/);
assert.match(breakGlassActive, /event_type = 'closed'/);
assert.match(breakGlassActive, /p_exam_public_id/);
assert.match(breakGlassActive, /p_attempt_public_id/);
assert.match(breakGlassActive, /p_candidate_number/);
assert.match(breakGlassActive, /status in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(breakGlassActive, /status = 'active'/);
assert.match(breakGlassActive, /submissionGraceMinutes/);

const breakGlassIssue = functionBlock('exam_room_issue_admin_break_glass_v2');
assert.match(breakGlassIssue, /exam_room_require_admin/);
assert.match(breakGlassIssue, /p_case_reference text/);
assert.match(breakGlassIssue, /p_verified_authentication_at timestamptz/);
assert.match(breakGlassIssue, /p_expires_at > clock_timestamp\(\) \+ interval '4 hours'/);
assert.match(breakGlassIssue, /EXAM_ROOM_BREAK_GLASS_TERMINAL_EVIDENCE_REQUIRED/);
assert.match(breakGlassIssue, /status not in \('submitted', 'auto_submitted', 'sealed'\)/);
assert.match(breakGlassIssue, /active_session\.status = 'active'/);
assert.match(breakGlassIssue, /caseReference/);
assert.match(breakGlassIssue, /where g\.attempt_id = v_attempt\.id/);
assert.doesNotMatch(
  breakGlassIssue,
  /where g\.admin_user_id = p_admin_user_id\s+and g\.attempt_id = v_attempt\.id/,
  'only one live break-glass grant may exist for the exact candidate attempt across all Admins',
);

const breakGlassEvidence = functionBlock('exam_room_admin_break_glass_evidence_v2');
assert.match(breakGlassEvidence, /exam_room_assert_admin_break_glass_active_v2/);
assert.match(breakGlassEvidence, /where s\.attempt_id = v_attempt\.id/);
assert.match(breakGlassEvidence, /where o\.attempt_id = v_attempt\.id/);
assert.match(breakGlassEvidence, /where ie\.attempt_id = v_attempt\.id/);
assert.match(breakGlassEvidence, /caseReference/);
assert.match(breakGlassEvidence, /'scope', 'candidate_evidence'/);
assert.doesNotMatch(breakGlassEvidence, /from public\.exam_room_attempts a\s+where a\.exam_id = v_exam\.id/i);
assert.doesNotMatch(breakGlassEvidence, /model_answer/i);

const breakGlassClose = functionBlock('exam_room_close_admin_break_glass_v2');
assert.match(breakGlassClose, /p_exam_public_id uuid/);
assert.match(breakGlassClose, /p_attempt_public_id uuid/);
assert.match(breakGlassClose, /p_candidate_number text/);
assert.match(breakGlassClose, /exam_room_assert_admin_break_glass_identity_v2/);
assert.match(breakGlassClose, /EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID/);
assert.match(breakGlassClose, /'examId', p_exam_public_id/);
assert.match(breakGlassClose, /'attemptId', p_attempt_public_id/);
const breakGlassReview = functionBlock('exam_room_record_admin_break_glass_review_v2');
assert.match(breakGlassReview, /event_type = 'closed'/);
assert.match(breakGlassReview, /EXAM_ROOM_BREAK_GLASS_CLOSE_REQUIRED/);
assert.match(breakGlassReview, /post_review_completed/);
assert.match(breakGlassReview, /caseReference/);
assert.match(breakGlassReview, /'examId', p_exam_public_id/);
assert.match(breakGlassReview, /'attemptId', p_attempt_public_id/);
assert.match(lower, /fresh supported mfa amr/);

assert.match(lower, /alter table public\.exam_room_exams[\s\S]*requested_question_count between 1 and 200/);
assert.match(lower, /alter table public\.exam_room_question_versions[\s\S]*question_count between 1 and 200/);
assert.match(lower, /application\/pdf/);
const schedule = functionBlock('exam_room_schedule_exam');
assert.match(schedule, /v_exam\.status not in \('confirmed', 'scheduled'\)/);
assert.match(schedule, /replaced during pre-publication scheduling/i);

const sessionView = functionBlock('exam_room_attempt_view_v2');
assert.match(sessionView, /exam_room_assert_session_v2/);
assert.match(sessionView, /'activeLeave'/);
assert.match(sessionView, /'leaveId', l\.public_id/);
assert.match(sessionView, /'departedAt', l\.started_at/);
assert.match(sessionView, /'acknowledgmentRequired'/);
assert.doesNotMatch(sessionView, /reason_code|medical|diagnos/i, 'candidate leave projection must omit sensitive reason details');
const legacyView = functionBlock('exam_room_attempt_view');
assert.match(legacyView, /EXAM_ROOM_V2_SESSION_REQUIRED/);
assert.match(functionBlock('exam_room_save_answer'), /EXAM_ROOM_V2_SESSION_REQUIRED/);
assert.match(functionBlock('exam_room_submit_attempt'), /EXAM_ROOM_V2_SESSION_REQUIRED/);
const legacyUnlock = functionBlock('exam_room_unlock_attempt');
assert.match(legacyUnlock, /owner_professor_id = p_actor_user_id/);
assert.match(legacyUnlock, /EXAM_ROOM_V2_SESSION_REQUIRED/);
assert.doesNotMatch(legacyUnlock, /exam_room_is_admin/, 'global Admin must not bypass Professor unlock credentials');

const saveOperation = functionBlock('exam_room_save_answer_operation_v2');
assert.match(saveOperation, /p_outage_evidence jsonb default '\{\}'::jsonb/);
assert.match(saveOperation, /'late_evidence'/);
assert.match(saveOperation, /'acceptedAsAnswer', false/);
assert.match(saveOperation, /'clientTimestampAuthoritative', false/);
assert.match(saveOperation, /'post_deadline_recovery'/);
const submissionStatus = functionBlock('exam_room_submission_status_v2');
assert.doesNotMatch(submissionStatus, /answer_text|questions_snapshot|prompt_text/i);
assert.match(submissionStatus, /'activeReopening'/);
assert.match(submissionStatus, /'submissionHistory'/);
assert.match(submissionStatus, /'priorReceiptId'/);

const rosterValidation = functionBlock('exam_room_validate_roster');
assert.match(rosterValidation, /v_display_name := nullif\(btrim\(v_row ->> 'displayName'\), ''\)/);
assert.match(rosterValidation, /v_display_name is not null and char_length\(v_display_name\) > 200/);
assert.doesNotMatch(rosterValidation, /display name is required/i);
assert.match(lower, /alter table public\.exam_room_roster[\s\S]*alter column display_name drop not null/);
assert.match(lower, /display_name is null[\s\S]*char_length\(display_name\) between 1 and 200/);
assert.match(functionBlock('exam_room_import_exam_roster_v2'), /nullif\(btrim\(v_row ->> 'displayName'\), ''\)/);
assert.match(functionBlock('exam_room_upsert_roster_row_v2'), /nullif\(btrim\(p_row ->> 'displayName'\), ''\)/);
assert.match(lower, /exam_room_import_roster_display_name_drift/);
assert.match(lower, /exam_room_import_roster_authority_drift/);
assert.match(lower, /alter function public\.exam_room_import_roster\(uuid, uuid, jsonb, text, text\)[\s\S]*set search_path = ''/);
assert.match(lower, /'if v_is_professor or v_is_admin then'/);
assert.match(lower, /exam_room_admin_metadata_snapshot_drift/);
assert.match(lower, /alter function public\.exam_room_portal_snapshot\(uuid\)[\s\S]*set search_path = ''/);

assert.match(lower, /v_exam\.id::text \|\| '\/' \|\| p_content_hash \|\| '\/' \|\| p_safe_file_name/);
assert.match(lower, /p_safe_file_name !~ '\^\[a-za-z0-9_\.\-\]\+\$'/);
assert.match(lower, /exam_room_confirm_questions_path_drift/);
assert.match(lower, /alter function public\.exam_room_confirm_questions\([\s\S]*\) set search_path = ''/);
assert.match(lower, /alter table public\.%i force row level security/);
assert.match(lower, /revoke all privileges on table public\.%i from public, anon, authenticated/);
assert.match(lower, /grant select, insert, update, delete on table public\.%i to service_role/);
assert.match(lower, /revoke all on function %s from public, anon, authenticated/);
assert.match(lower, /grant execute on function %s to service_role/);
assert.match(lower, /exam_room_v2_obsolete_overloads/);
assert.match(lower, /exam_room_publish_exam_v2\(uuid,uuid,jsonb,text\)/);
assert.match(lower, /revoke all on function %s from public, anon, authenticated, service_role/);
assert.match(lower, /revoke execute on function public\.exam_room_open_dispute\([\s\S]*\) from service_role/);
assert.match(lower, /revoke execute on function public\.exam_room_dispute_view\([\s\S]*\) from service_role/);
assert.match(lower, /revoke execute on function public\.exam_room_close_dispute\([\s\S]*\) from service_role/);
assert.match(lower, /revoke execute on function public\.exam_room_admin_correct_grade\([\s\S]*\) from service_role/);

console.log('Examination Room 2.0 migration contracts passed.');
