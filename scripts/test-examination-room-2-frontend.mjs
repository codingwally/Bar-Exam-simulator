import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, frontend, css, build, phase2Config, stagingBuild, featureLoader] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/phase2-config.js', root), 'utf8'),
  readFile(new URL('scripts/build-staging-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
]);

// The owner explicitly approved a live beta-wide activation. The entry is
// available from the canonical shared header, while authentication plus the
// independent client and two server gates remain fail-closed and role actions
// remain server-authorized.
assert.match(phase2Config, /examinationRoom2:\s*true/);
assert.match(html, /id="spa-examination-room" type="button"/);
assert.doesNotMatch(html, /id="spa-examination-room" type="button" hidden/);
const sharedHeaderStart = html.indexOf('<header class="topbar pb-header pb-shared-header" id="site-header">');
const sharedHeaderEnd = html.indexOf('</header>', sharedHeaderStart);
const examinationRoomEntry = html.indexOf('id="spa-examination-room"');
assert.ok(sharedHeaderStart >= 0
  && examinationRoomEntry > sharedHeaderStart
  && examinationRoomEntry < sharedHeaderEnd,
'the beta-wide entry must stay inside the canonical shared header');
assert.match(frontend, /exam_room:\s*'EXAMINATION_ROOM_2_ENABLED'/);
assert.match(frontend, /const EXAMINATION_ROOM_BASE_FLAG = 'EXAMINATION_ROOM_ENABLED'/);
const openBlock = frontend.slice(
  frontend.indexOf('async function open(view'),
  frontend.indexOf('async function queryContent'),
);
assert.match(openBlock, /config\?\.features\?\.examinationRoom2 !== true/,
  'the environment-local client gate must fail closed before Examination Room 2.0 opens');
assert.match(openBlock, /snapshot\?\.flags\?\.\[EXAMINATION_ROOM_BASE_FLAG\] !== true[\s\S]*snapshot\?\.flags\?\.\[FLAG_NAMES\.exam_room\] !== true/,
  'authenticated entry requires both the base and V2 server-side feature flags');
assert.doesNotMatch(stagingBuild, /examinationRoom2: false/,
  'staging no longer needs to override the owner-approved beta-wide client gate');
assert.doesNotMatch(stagingBuild, /spa-examination-room[^\n]*hidden/,
  'staging no longer needs to unhide an entry that is enabled for the beta-wide release');

// Public information architecture is exactly the four room-scoped roles.
assert.match(frontend, /\['professor', 'Professor'[\s\S]*\['beadle', 'Beadle'[\s\S]*\['student', 'Student'[\s\S]*\['exam_administrator', 'Exam Administrator'/);
assert.match(frontend, /data-dd26-exam-role="\$\{id\}"/);
assert.doesNotMatch(frontend, /\['workplace'/i);
assert.match(frontend, /Sign-in is required to continue/);
assert.doesNotMatch(frontend, /\$\{examNavigation\(\)\}/,
  'role buttons must not be repeated inside the selected workspace');
const roleSelectionBlock = frontend.slice(
  frontend.indexOf('async function selectExamRole'),
  frontend.indexOf('function announceExamStatus'),
);
assert.ok(roleSelectionBlock.indexOf('if (!isAuthenticated())') < roleSelectionBlock.indexOf('state.exam.section = role'),
  'authentication must happen before the Student or classroom workspace opens');
assert.doesNotMatch(roleSelectionBlock, /new URL\('admin\//,
  'Exam Administrator must stay room-scoped instead of redirecting into platform administration');
assert.match(roleSelectionBlock, /if \(role !== 'student'\) await loadRoomRequests\(\)/);
assert.match(frontend, /Request an Examination Room/);
assert.match(frontend, /Use the invitation from the Professor/);
assert.match(frontend, /Prepare quotations, issue provisional room keys, and review payment only for assigned requests/);
assert.match(frontend, /Return to Examination Room home/);
assert.match(frontend, /class="dd26-button dd26-exam-home-button"/,
  'the role and workspace return control must be a prominent design-system button');
const homeReturnStart = frontend.indexOf('async function returnToExaminationRoomHome');
const homeReturnEnd = frontend.indexOf('function examEntry', homeReturnStart);
const homeReturnBlock = frontend.slice(homeReturnStart, homeReturnEnd);
assert.match(homeReturnBlock, /state\.exam\.attempt\?\.status === 'in_progress'[\s\S]*global\.confirm/,
  'leaving a live examination requires an explicit warning');
assert.ok(homeReturnBlock.indexOf('await flushAllLocalSaves()') < homeReturnBlock.indexOf('clearAttemptTimers()'),
  'the latest answers must be saved before live-exam timers are cleared');
assert.ok(homeReturnBlock.indexOf("recordIncident('focus_exit'") < homeReturnBlock.indexOf('clearAttemptTimers()'),
  'returning home during a live exam must be recorded before leaving the attempt surface');
assert.match(frontend, /global\.openExaminationRoom = async \(\) => \{[\s\S]*moduleIsOpen[\s\S]*await returnToExaminationRoomHome\(\)[\s\S]*state\.exam\.section = 'entry'[\s\S]*state\.exam\.intentRole = null[\s\S]*return open\('exam_room'/,
  'the header Examination Room button must safely return from active work, then open the role hub');
assert.doesNotMatch(frontend, /operation: '(?:open_dispute|dispute_view|close_dispute)'/,
  'the retired broad dispute viewer must not remain callable from the public Examination Room');
assert.match(frontend, /operation: 'submit_room_request'/);
assert.match(frontend, /operation: 'prepare_room_quotation'/);
assert.match(frontend, /operation: 'send_room_quotation'/);
assert.match(frontend, /operation: 'generate_provisional_room_key'/);
assert.match(frontend, /operation: 'review_room_payment'/);
assert.match(frontend, /\/exam-room\/upload\/payment-proof/);
assert.match(frontend, /accept="image\/png,image\/jpeg,application\/pdf/);
assert.match(frontend, /Exam Administrator[\s\S]*assigned to this account/,
  'the Exam Administrator workspace must explain its assigned-room boundary');
assert.match(frontend, /does not provide access to users, subscriptions, secrets, or unrelated rooms/,
  'room administration must explicitly deny platform-wide access');

// Professor entry supports the request, quotation, provisional-key, and
// payment-proof flow without exposing platform administration.
const activationStart = frontend.indexOf('function activationSection');
const activationEnd = frontend.indexOf('function beadleSection', activationStart);
const activationView = frontend.slice(activationStart, activationEnd);
assert.match(activationView, /Request or open an Examination Room/i);
assert.match(activationView, /provisional one-time key/i);
assert.match(activationView, /exact signed-in Professor email/);
assert.match(activationView, /Student access remains protected/);
assert.doesNotMatch(activationView, /href="admin\/"|Admin Dashboard/,
  'Professor room requests never expose platform-administration navigation');
assert.doesNotMatch(activationView, /dd26-professor-email|dd26-activation-expiry|issue_activation/,
  'the public Professor entry must not issue Admin keys inline');

const professorStart = frontend.indexOf('function professorSection');
const professorEnd = frontend.indexOf('function professorClass', professorStart);
const professorView = frontend.slice(professorStart, professorEnd);
assert.match(professorView, /Request another Examination Room/);
assert.match(professorView, /Open another room/);
assert.match(professorView, /No Examination Room is open yet/);
assert.doesNotMatch(professorView, /dd26-class-title|dd26-class-school|dd26-class-term|dd26-create-class/,
  'a Professor cannot bypass Admin room-key issuance with a free-form class creator');
assert.doesNotMatch(frontend, /operation: 'create_classroom'/,
  'the public bundle must not retain a callable free-form classroom command');
assert.doesNotMatch(frontend, /function issueActivation|dd26-issue-activation/,
  'Professor key generation remains an assigned Exam Administrator action');
assert.match(frontend, /operation: 'redeem_activation'[\s\S]*activationKey: value\('dd26-activation-key', false\)/);

const professorClassStart = professorEnd;
const professorClassEnd = frontend.indexOf('function rosterPreviewHtml', professorClassStart);
const professorClassView = frontend.slice(professorClassStart, professorClassEnd);
assert.match(professorClassView, /const authoring = exams\.length \?[\s\S]*Continue the examination below/,
  'once the room has its examination, the Professor must continue that exam instead of making another');
assert.match(professorClassView, /One Examination Room holds one examination/);

const studentStart = frontend.indexOf('function studentSection');
const studentEnd = frontend.indexOf('function activationSection', studentStart);
const studentView = frontend.slice(studentStart, studentEnd);
assert.match(studentView, /Sign in with the Google account listed in the Beadle's confirmed class list/);
assert.match(studentView, /No examination link or reference is needed/);
assert.match(studentView, /Use the current code emailed to your rostered account/);
assert.match(studentView, /A code never replaces sign-in or the class-list check/);
const beadleStart = frontend.indexOf('function beadleSection');
const beadleEnd = frontend.indexOf('function professorSection', beadleStart);
assert.match(frontend.slice(beadleStart, beadleEnd), /After publishing, the Professor gives the named Beadle a one-time key/);
assert.match(frontend.slice(beadleStart, beadleEnd), /This Beadle key is not the student exam code/);
assert.match(frontend.slice(beadleStart, beadleEnd), /Do not give it to students/);
assert.match(frontend, /Professor . Preparation steps 1 to 3[\s\S]*Beadle . Preparation steps 4 and 5[\s\S]*Student . Simple steps[\s\S]*Exam Administrator . Assigned-room controls/);

// Existing emailed deep links identify an exam without becoming authorization.
assert.match(frontend, /raw\.startsWith\('examination-room\?'\)/);
assert.match(frontend, /parameters\.get\('exam'\)/);
assert.match(frontend, /The link identifies the examination only\. It does not give anyone access/);

// Professor authoring remains count-configurable and follows one reversible five-step preparation journey.
assert.match(frontend, /Examination details[\s\S]*Questions reviewed[\s\S]*Rules and publication[\s\S]*Class list saved[\s\S]*Student handout ready/);
const professorFlowStart = frontend.indexOf('function professorFlowList');
const professorFlowEnd = frontend.indexOf('function rosterPreviewHtml', professorFlowStart);
const professorFlowView = frontend.slice(professorFlowStart, professorFlowEnd);
for (const step of ['details', 'questions', 'rules', 'roster', 'handout']) {
  assert.match(professorFlowView, new RegExp(`id: '${step}'[\\s\\S]*data-dd26-professor-step`),
    `Professor Step ${step} must have a real review action`);
}
assert.doesNotMatch(professorFlowView, /Grade and deliver results/,
  'grading is an after-exam activity, not a sixth preparation step');
assert.match(frontend, /operation: 'professor_authoring_snapshot', examId/);
assert.match(frontend, /function authoringCapability[\s\S]*=== true/,
  'mutation and review capabilities must fail closed unless explicitly true');
const authoringCapabilityStart = frontend.indexOf('function authoringCapability');
const authoringCapabilityEnd = frontend.indexOf('function authoringBlockedCopy', authoringCapabilityStart);
const authoringCapability = Function(
  `'use strict'; ${frontend.slice(authoringCapabilityStart, authoringCapabilityEnd)}; return authoringCapability;`,
)();
assert.equal(authoringCapability({ capabilities: { canEditDetails: true } }, 'canEditDetails'), true);
assert.equal(authoringCapability({ capabilities: { canEditDetails: false } }, 'canEditDetails'), false);
assert.equal(authoringCapability({ capabilities: { canEditDetails: 1 } }, 'canEditDetails'), false);
assert.equal(authoringCapability({}, 'canEditDetails'), false);

// A published examination with no attempts may receive a schedule-only
// correction when the server explicitly authorizes it. Local status labels,
// including a deadline-closed label, must never hide that recovery action.
const publishedReviewStart = frontend.indexOf('function openPublishedPreparationReview');
const publishedReviewEnd = frontend.indexOf('function rescheduleBlockerCopy', publishedReviewStart);
const publishedReviewView = frontend.slice(publishedReviewStart, publishedReviewEnd);
assert.match(publishedReviewView, /authoringCapability\(snapshot, 'canReschedulePublication'\)/);
assert.match(publishedReviewView, /Change exam time/);
assert.doesNotMatch(publishedReviewView, /exam\?\.status|status\s*===|status\s*!==|\['scheduled'\]|\['closed'\]/,
  'schedule adjustment availability must come only from the server capability');
assert.match(frontend, /snapshot\?\.blockers\?\.rescheduleBlocker/);
for (const blocker of ['NOT_PUBLISHED', 'RESULTS_SEALED', 'RESULTS_RELEASED', 'CANDIDATE_ATTEMPTS_EXIST', 'EXAM_STATE_BLOCKED']) {
  assert.match(frontend, new RegExp(`${blocker}:`), `plain classroom copy is required for ${blocker}`);
}
assert.match(frontend, /Set the updated examination schedule[\s\S]*id="dd26-reschedule-opens-at"[\s\S]*id="dd26-reschedule-closes-at"[\s\S]*id="dd26-reschedule-duration"[\s\S]*id="dd26-reschedule-late-admission"[\s\S]*id="dd26-reschedule-submission-grace"[\s\S]*id="dd26-reschedule-reason"/);
assert.match(frontend, /Confirm the updated exam time[\s\S]*id="dd26-reschedule-ack"[\s\S]*id="dd26-confirm-reschedule" type="button" disabled/,
  'the Professor must complete a final review before saving the new time');
assert.match(frontend, /operation: 'reschedule_publication',[\s\S]*examId: snapshot\.examId,[\s\S]*expectedPublicationId: snapshot\.publication\.publicationId,[\s\S]*expectedWorkspaceRevision: Number\(snapshot\.workspaceRevision\),[\s\S]*opensAt: change\.opensAt,[\s\S]*hardClosesAt: change\.hardClosesAt,[\s\S]*durationMinutes: change\.durationMinutes,[\s\S]*lateAdmissionMinutes: change\.lateAdmissionMinutes,[\s\S]*submissionGraceMinutes: change\.submissionGraceMinutes,[\s\S]*reason: change\.reason,[\s\S]*requestKey: change\.requestKey/,
  'the schedule-only command must bind the current publication and Professor workspace revision');
assert.match(frontend, /change\.requestKey \|\|= randomKey\('reschedule_publication'\)/,
  'a retry must keep one schedule-change request identity');
assert.match(frontend, /withBoundedPublishWait\(command\(\{[\s\S]*operation: 'reschedule_publication'/,
  'a stalled schedule request must stop waiting while keeping its idempotent retry identity');
assert.match(frontend, /loadProfessorAuthoringSnapshot\(snapshot\.examId\)[\s\S]*refreshPortalSilently\(\)/,
  'a confirmed schedule change must refresh both the authoring snapshot and Professor portal');
assert.match(frontend, /Questions, the class list, Beadle access, and the student exam code are unchanged/);
for (const code of ['EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID', 'EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON']) {
  assert.match(frontend, new RegExp(`${code}:`), `plain recovery copy is required for ${code}`);
}
const rescheduleRetryStart = frontend.indexOf('const RESCHEDULE_TERMINAL_FAILURE_CODES');
const rescheduleRetryEnd = frontend.indexOf('function publicationRescheduleValidation', rescheduleRetryStart);
assert.ok(rescheduleRetryStart > 0 && rescheduleRetryEnd > rescheduleRetryStart);
const rescheduleRetryView = frontend.slice(rescheduleRetryStart, rescheduleRetryEnd);
const rescheduleRetryIsSafe = Function(
  `'use strict'; const isTransientTransportFailure = (error) => error instanceof TypeError || (!error?.code && !error?.status) || (error?.code === 'REQUEST_FAILED' && (!error?.status || Number(error.status) >= 500)); ${rescheduleRetryView}; return rescheduleRetryIsSafe;`,
)();
for (const code of [
  'EXAM_ROOM_WORKSPACE_CONFLICT',
  'EXAM_ROOM_PUBLICATION_VERSION_CONFLICT',
  'EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST',
  'EXAM_ROOM_RESCHEDULE_NOT_ALLOWED',
  'EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID',
]) {
  assert.equal(rescheduleRetryIsSafe({ code, status: 503 }), false,
    `${code} must never reuse the stale schedule-change request`);
}
assert.equal(rescheduleRetryIsSafe(new TypeError('network disconnected')), true);
assert.equal(rescheduleRetryIsSafe({ code: 'REQUEST_FAILED', status: 503 }), true);
assert.equal(rescheduleRetryIsSafe({ code: 'UPSTREAM_FAILURE', status: 503 }), true);
assert.equal(rescheduleRetryIsSafe({ code: 'EXAM_ROOM_PUBLISH_WAIT_TIMEOUT' }), true);
assert.equal(rescheduleRetryIsSafe({ code: 'EXAM_ROOM_RESCHEDULE_INVALID', status: 409 }), false);
assert.equal(rescheduleRetryIsSafe({ code: 'EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON', status: 409 }), false,
  'a Beadle assignment-period error must return to editable schedule fields, not retry unchanged');
const rescheduleSaveStart = frontend.indexOf('async function savePublicationReschedule');
const rescheduleSaveEnd = frontend.indexOf('function openQuestionUpload', rescheduleSaveStart);
const rescheduleSaveView = frontend.slice(rescheduleSaveStart, rescheduleSaveEnd);
assert.match(rescheduleSaveView, /if \(rescheduleRetryIsSafe\(error\)\)[\s\S]*Retry saving updated time[\s\S]*return;/,
  'only an ambiguous transport or server result may expose the same-key retry');
assert.match(rescheduleSaveView, /if \(rescheduleFailureNeedsRefresh\(error\)\)[\s\S]*discardPublicationRescheduleDraft\(change\)[\s\S]*refreshButton\.hidden = false[\s\S]*refreshButton\.style\.display = ''/,
  'terminal failures must discard the stale change and expose the refresh action');
assert.match(frontend, /id="dd26-refresh-reschedule" type="button" hidden style="display:none">Refresh latest examination/);
const rescheduleRefreshStart = frontend.indexOf('async function refreshLatestPublicationAfterReschedule');
const rescheduleRefreshEnd = frontend.indexOf('async function savePublicationReschedule', rescheduleRefreshStart);
const rescheduleRefreshView = frontend.slice(rescheduleRefreshStart, rescheduleRefreshEnd);
assert.match(rescheduleRefreshView, /withBoundedPublishWait\([\s\S]*loadProfessorAuthoringSnapshot\(examId\),[\s\S]*EXAMINATION_ROOM_REFRESH_WAIT_MS/);
assert.match(rescheduleRefreshView, /withBoundedPublishWait\([\s\S]*refreshPortalSilently\(\),[\s\S]*EXAMINATION_ROOM_REFRESH_WAIT_MS/);
assert.match(rescheduleRefreshView, /closeDialog\(\);[\s\S]*renderExamRoom\(\);[\s\S]*openPublishedPreparationReview\(latestSnapshot\)/,
  'refresh recovery must close the stale flow, rerender, and open the latest published review');
const normalizeRescheduleStart = frontend.indexOf('function normalizeReschedulePublicationSuccess');
const normalizeRescheduleEnd = frontend.indexOf('async function savePublicationReschedule', normalizeRescheduleStart);
const normalizeRescheduleView = frontend.slice(normalizeRescheduleStart, normalizeRescheduleEnd);
assert.doesNotMatch(normalizeRescheduleView, /result\.(?:credentialsPreserved|rosterPreserved|beadleAssignmentPreserved|studentAccessPreserved|rescheduled|supersedesPublicationId)/,
  'frontend confirmation consumes only the approved schedule-change result fields');
assert.doesNotMatch(normalizeRescheduleView, /if\s*\([^)]*preserved/,
  'informational preservation text must not become an authorization gate');
const normalizeReschedulePublicationSuccess = Function(
  `'use strict'; ${normalizeRescheduleView}; return normalizeReschedulePublicationSuccess;`,
)();
const normalizedReschedule = normalizeReschedulePublicationSuccess({
  ok: true, examId: 'exam-1', publicationId: 'publication-2', publicationNumber: 2,
  workspaceRevision: 7, opensAt: '2035-08-10T12:00:00.000Z',
  hardClosesAt: '2035-08-10T14:00:00.000Z', durationMinutes: 120,
  lateAdmissionMinutes: 15, submissionGraceMinutes: 15, preserved: { questions: true },
  credentialsPreserved: true, studentAccessPreserved: true, unexpectedSecret: 'never-consume',
}, 'exam-1');
assert.deepEqual(Object.keys(normalizedReschedule).sort(), [
  'durationMinutes', 'examId', 'hardClosesAt', 'lateAdmissionMinutes', 'ok', 'opensAt',
  'preserved', 'publicationId', 'publicationNumber', 'submissionGraceMinutes', 'workspaceRevision',
].sort());
assert.throws(() => normalizeReschedulePublicationSuccess({
  ok: true, examId: 'exam-1', publicationId: 'publication-2', workspaceRevision: 7,
}, 'exam-1'), /not confirmed completely/);
assert.match(frontend, /operation: 'update_exam_details'[\s\S]*expectedRevision:[\s\S]*questionCount:[\s\S]*includeQuestionnaire:/);
assert.match(frontend, /operation: 'revise_draft_questions'[\s\S]*expectedRevision:[\s\S]*expectedQuestionVersionId:[\s\S]*questions,/);
assert.match(frontend, /const canUploadInitial = !published && !hasSavedQuestions && !source\?\.questionVersionId[\s\S]*canUploadQuestions === true/,
  'a brand-new exam may open the existing upload only when the server explicitly authorizes it');
assert.match(frontend, /operation: 'save_rules_draft'[\s\S]*expectedRevision:[\s\S]*rules: form\.rules,[\s\S]*beadleEmail:/);
assert.match(frontend, /rulesDraft\?\.rules[\s\S]*saved\.opensAt[\s\S]*storedDraft\?\.beadleEmail/,
  'Step 3 must hydrate the server-saved rules and Beadle handoff draft');
assert.match(frontend, /Review and edit the examination details[\s\S]*Save changes/);
assert.match(frontend, /typeof details\.instructions !== 'string'[\s\S]*typeof details\.includeQuestionnaire !== 'boolean'/,
  'Step 1 fails closed when the server snapshot omits an editable field');
assert.match(frontend, /Review and revise every question[\s\S]*Save revised questions/);
assert.match(frontend, /id="dd26-exam-count" type="number" min="1" max="200" step="1"/);
assert.match(frontend, /\.pdf,\.txt,\.docx/);
assert.match(frontend, /Paste questions/);
assert.match(frontend, /Student preview/);
assert.match(frontend, /operation: 'publish_for_beadle'/);
assert.match(frontend, /Finish question review first/,
  'the rules step stays unavailable until the question version is confirmed');
assert.match(frontend, /id="dd26-create-exam-errors" role="alert"/);
assert.match(frontend, /function examDraftValidation[\s\S]*number of questions must be a whole number from 1 to 200/);
assert.match(frontend, /id="dd26-question-review-errors" role="alert"/);
assert.match(frontend, /function questionReviewValidation[\s\S]*needs question text[\s\S]*points must be greater than 0/);
assert.match(frontend, /id="dd26-publish-rule-errors" role="alert"/);
assert.match(frontend, /id="dd26-publish-operation-status" role="status" aria-live="polite"/);
assert.match(frontend, /EXAMINATION_ROOM_PUBLISH_WAIT_MS = 25_000/);
assert.match(frontend, /The server did not answer within 25 seconds/);
assert.match(frontend, /option\[value="one_way"\][\s\S]*oneWayOption\.disabled = true/,
  'one-way authoring stays gated until durable reload enforcement exists');
assert.match(frontend, /option\[value="upload"\][\s\S]*modelAnswerUploadOption\.disabled = true/,
  'model-answer file upload stays gated until an owner-only retrieval path is verified');

// Rules use honest browser controls and conservative beta defaults.
for (const value of ['off', 'record_only', 'warn_and_record', 'free', 'one_way', 'automatic']) {
  assert.match(frontend, new RegExp(`value="${value}"`));
}
assert.doesNotMatch(frontend, /value="beadle_approval"/,
  'the simplified classroom flow must not require Beadle admission approval');
assert.match(frontend, /aiGradingEnabled: false/);
assert.match(frontend, /document\.getElementById\('dd26-student-access-code-required'\)\?\.closest\('label'\)\?\.remove\(\)/,
  'the Professor publication screen must remove the legacy student-code choice');
assert.match(frontend, /studentAccessCodeRequired: true/);
assert.match(frontend, /lateAdmissionValue = lateAdmissionWasChosen[\s\S]*: durationValue/,
  'a new examination must default student entry to the full exam duration');
assert.match(frontend, /lateAdmissionUntouched[\s\S]*scheduledWindowMinutes[\s\S]*lateAdmissionField\.value = String\(windowMinutes\)/,
  'the default student-entry cutoff must follow the calculated schedule until the Professor edits it');
assert.match(frontend, /durationField\.type = 'hidden'[\s\S]*Automatically calculated duration[\s\S]*Calculated from the opening and ending times in Philippine Time/,
  'exam duration must be calculated from the Philippine-Time schedule rather than edited separately');
assert.match(frontend, /Allow entry until the exam ends[\s\S]*Your current Professor setting is kept unless you change this choice/,
  'rescheduling must expose an explicit until-end choice without overwriting an earlier cutoff');
assert.match(frontend, /entryCutoffReviewHtml\(opensAt, hardClosesAt, lateAdmissionMinutes\)/,
  'final publication review must prominently state the exact student-entry cutoff');
assert.match(featureLoader, /duediligence-2026\.js\?v=guided-random-access-20260822-1/,
  'the corrected student preflight must retain a release-scoped lazy cache key');
assert.match(frontend, /None of them replaces student sign-in and the class-list check/);
assert.match(frontend, /publicationAttempt\.studentKey = null/,
  'Professor publication must not generate the student handout code');
assert.match(frontend, /function accessCodePreflightPolicy[\s\S]*typeof primary === 'boolean'[\s\S]*ready: known/);
assert.match(frontend, /could not confirm this examination’s student-code requirement/);
assert.match(frontend, /studentKey: check\.studentKey/);
assert.match(frontend, /result\.oneTimeBeadleKey === publicationAttempt\.beadleKey/);
assert.match(frontend, /publicationSecretsMayBeDisplayed\(result, draft, publicationAttempt\)/,
  'secrets must remain hidden until a complete server publication result is verified');
const publishBlock = frontend.slice(
  frontend.indexOf('async function scheduleExam'),
  frontend.indexOf('function localDateValue'),
);
assert.match(publishBlock, /operation: 'publish_for_beadle'[\s\S]*expectedRevision: draft\.expectedRevision,[\s\S]*rules: draft\.rules,[\s\S]*gradingKey,[\s\S]*beadleEmail: draft\.beadleEmail,[\s\S]*beadleInvitationKey: publicationAttempt\.beadleKey/,
  'initial publication must bind the reviewed workspace revision, freeze the exam, and issue the exact Beadle handoff');
assert.doesNotMatch(publishBlock, /draft\.(?:studentKey|gradingKey|credentialsScheduled)/,
  'raw publication credentials must not be retained in page state');
assert.match(publishBlock, /draft\.requestKey \|\|= randomKey[\s\S]*withBoundedPublishWait\(publicationOperation\)/,
  'publication retries must keep one request identity and use a bounded wait');
assert.doesNotMatch(publishBlock, /draft\.requestKey = null/,
  'an uncertain publication must not discard its idempotency key');
assert.match(publishBlock, /publicationAttempt\.gradingKey \|\|= randomKey[\s\S]*publicationAttempt\.beadleKey \|\|= randomKey/,
  'an uncertain retry reuses the same closure-scoped grading and Beadle secrets');
assert.match(publishBlock, /publishRetryIsSafe\(error\)[\s\S]*Retry publication safely/);
assert.match(publishBlock, /publicationAttempt\.gradingKey = ''[\s\S]*publicationAttempt\.beadleKey = ''/,
  'confirmed one-time Professor and Beadle keys must be removed from the request closure');
assert.match(publishBlock, /refreshPortalSilently\(\)[\s\S]*renderExamRoom\(\)/,
  'a confirmed publication must refresh and re-render the Professor state behind the key dialog');

// A replacement is a distinct corrected question version, never a rules-only mutation.
assert.match(frontend, /intent\.canReplacePublication !== true[\s\S]*intent\.canUploadReplacementQuestions !== true/);
assert.match(frontend, /Safe staging:[\s\S]*does not alter the currently published examination/);
assert.match(frontend, /operation: replacement \? 'confirm_replacement_questions' : 'confirm_questions'/);
assert.match(frontend, /expectedPublicationId: uploadIntent\.expectedPublicationId/);
assert.match(frontend, /result\.staged !== true[\s\S]*replacementQuestionVersionId/);
assert.match(frontend, /operation: 'replace_publication'[\s\S]*expectedPublicationId:[\s\S]*replacementQuestionVersionId:[\s\S]*rules:[\s\S]*studentKey,[\s\S]*gradingKey,[\s\S]*reason:[\s\S]*requestKey:/);
assert.match(frontend, /publication\.questionVersionChanged === true/);
assert.match(frontend, /allowed only before the exam opens and before any student starts/);
assert.match(frontend, /After a student starts, send a correction or stop notice instead/);
assert.match(frontend, /Use a correction notice/);
assert.match(frontend, /async function refreshPortalSilently[\s\S]*const portal = payload\.result[\s\S]*await enrichProfessorExamIntents\(portal\)[\s\S]*if \(!isCurrentExamPortalLifecycle\(lifecycle\)\) return false;[\s\S]*state\.exam\.portal = portal/,
  'silent portal refreshes must enrich locally and revalidate the session before publishing portal state');

// Another submission is student-specific and preserves the first receipt under a one-use grading-key check.
assert.match(frontend, /candidate\.canReopenSubmission === true/);
assert.match(frontend, /id="dd26-reopen-grading-key" type="password"/);
assert.match(frontend, /gradingKeyInput\.value = ''/,
  'the Professor grading key must leave the form before the operation is sent');
assert.match(frontend, /operation: 'reopen_submission'[\s\S]*attemptId[\s\S]*newDeadline:[\s\S]*reason[\s\S]*gradingKey[\s\S]*requestKey:/);
assert.match(frontend, /result\.requiresNewSession !== true[\s\S]*result\.generation[\s\S]*result\.priorGeneration[\s\S]*result\.priorReceiptId[\s\S]*result\.priorSnapshotHash/);
assert.match(frontend, /The first submission is never opened or replaced/);
assert.match(frontend, /operation: 'live_status_v2'/);
const liveStatusBlock = frontend.slice(
  frontend.indexOf('async function loadLiveStatus'),
  frontend.indexOf('function renderLiveStatus'),
);
assert.doesNotMatch(liveStatusBlock, /beadle_portal|monitoring\?\.gradingKey|candidates, gradingKey/,
  'owner reopen eligibility comes from the dedicated fail-closed view and the grading key is not retained');
assert.match(liveStatusBlock, /keyInput\.value = ''/);
assert.match(frontend, /Camera collection is off/);
assert.doesNotMatch(frontend, /face recognition|gaze tracking|emotion analysis/i);

// Beadle delegation and operations cannot surface answers or grades.
assert.match(frontend, /operation: 'invite_beadle'/);
assert.match(frontend, /operation: 'redeem_beadle_invitation'/);
assert.match(frontend, /operation: 'revoke_beadle'/);
assert.match(frontend, /operation: 'set_accommodation'/);
assert.match(frontend, /operation: 'issue_erratum'/);
assert.match(frontend, /operation: 'transfer_session'/);
assert.match(frontend, /never shows questions, answers, grades, or the Professor’s suggested answer/);
assert.doesNotMatch(frontend, /operation: 'record_candidate_verification'/,
  'the simplified Beadle flow has no per-student verification action');
assert.doesNotMatch(frontend, /operation: 'set_candidate_admission'/,
  'the simplified Beadle flow has no per-student admission action');
assert.doesNotMatch(frontend, /operation: 'import_exam_roster'/,
  'the simplified Beadle flow confirms the reviewed roster in one finalization request');
assert.doesNotMatch(frontend.slice(frontend.indexOf('function renderBeadleOperations'), frontend.indexOf('function openRosterCorrection')), /id="dd26-beadle-exam-link"|Student examination link/);
assert.match(frontend, /Step 4 · Prepare and save the class list/);
assert.match(frontend, /Step 5 · Finished/);
assert.doesNotMatch(frontend, /operation: 'validate_exam_roster'/,
  'Beadle preview edits must not bypass the official-template upload check');
const rosterSurfaceStart = frontend.indexOf('const rosterEditor = canEditRoster');
const rosterSurfaceEnd = frontend.indexOf('const codeValue = activeStudentCode', rosterSurfaceStart);
const rosterSurface = frontend.slice(rosterSurfaceStart, rosterSurfaceEnd);
assert.match(rosterSurface, /Class-list steps/);
assert.match(rosterSurface, /Download optional template/);
assert.match(frontend, /BEADLE_ROSTER_TEMPLATE_URL = '\/assets\/examination-room-beadle-class-list-template\.xlsx'/);
assert.match(rosterSurface, /accept="\.xlsx,\.csv/);
for (const field of ['Email Address', 'Student Number', 'Student Name']) {
  assert.match(rosterSurface, new RegExp(field));
}
assert.match(rosterSurface, /existing XLSX or CSV is accepted/);
assert.match(rosterSurface, /dd26-roster-paste[\s\S]*checked automatically as you edit[\s\S]*dd26-roster-add-row/,
  'the Beadle can use auto-checked file upload, paste, or manual entry');
assert.doesNotMatch(rosterSurface, /Check selected file|Check pasted list/,
  'the simplified class-list flow must not require separate validation buttons');
const rosterPreviewStart = frontend.indexOf('if (beadleMode) {', frontend.indexOf('function rosterPreviewHtml'));
const rosterPreviewEnd = frontend.indexOf('return `<div class=', rosterPreviewStart);
const beadleRosterPreview = frontend.slice(rosterPreviewStart, rosterPreviewEnd);
assert.match(beadleRosterPreview, /<th>Email Address<\/th><th>Student Number \(optional\)<\/th><th>Student Name[\s\S]*escapeHtml\(row\.email[\s\S]*escapeHtml\(row\.studentNumber[\s\S]*escapeHtml\(row\.displayName/);
assert.match(beadleRosterPreview, /data-dd26-roster-field="email"[\s\S]*data-dd26-roster-field="studentNumber"[\s\S]*data-dd26-roster-field="displayName"/,
  'the Beadle preview keeps the three student fields editable before confirmation');
assert.doesNotMatch(beadleRosterPreview, /candidateNumber|Exam number/,
  'candidate numbers remain server-derived for the simplified Beadle flow');
const importRosterBlock = frontend.slice(
  frontend.indexOf('async function importRoster'),
  frontend.indexOf('function rerenderRosterSurface'),
);
assert.match(importRosterBlock, /operation: 'finalize_roster_access'[\s\S]*rows: preview\.rows[\s\S]*sourceKind:[\s\S]*sourceHash,[\s\S]*studentKey: finalization\.studentKey[\s\S]*requestKey: finalization\.requestKey/,
  'one idempotent roster confirmation versions the list and activates student access');
assert.match(importRosterBlock, /finalization = state\.exam\.rosterFinalization[\s\S]*finalization\.sourceHash !== sourceHash[\s\S]*state\.exam\.rosterFinalization = finalization/,
  'a retry must reuse the same class-code and request keys for an unchanged validated list');
const dirtyRosterBlock = frontend.slice(
  frontend.indexOf('function markRosterPreviewDirty'),
  frontend.indexOf('async function refreshExamPortal'),
);
assert.match(dirtyRosterBlock, /templateReceiptId = ''[\s\S]*templateVersion = ''[\s\S]*rosterValidationGeneration \+= 1[\s\S]*revalidateRosterPreview/,
  'editing the preview invalidates prior validation and automatically checks the new rows');
assert.match(frontend, /const canEditRoster = !professorView && snapshot\.canEditRoster === true/,
  'Professor Step 4/5 review must not bind Beadle roster mutations');
assert.match(frontend, /canReopenRoster = !professorView && snapshot\.canReopenRoster === true/);
assert.match(frontend, /operation: 'reopen_exam_roster'[\s\S]*reason,[\s\S]*requestKey:/);
assert.match(frontend, /current student exam code will stop working immediately/i);
assert.match(frontend, /rosterMode === 'beadle'[\s\S]*examId: state\.exam\.activeExamId/);
assert.match(frontend, /snapshot\.activeStudentExamCode[\s\S]*state\.exam\.studentExamCodes\.get\(snapshot\.examId\)/,
  'the Beadle handout must consume a recoverable active code when the backend provides it');
assert.match(frontend, /id="dd26-active-student-code"[\s\S]*id="dd26-copy-active-class-handout"[\s\S]*Copy class code/,
  'the active class-wide code has one optional class-channel copy action');
assert.match(frontend, /Finish Beadle duties and enter my exam/);
const beadleDirectEntryBlock = frontend.slice(
  frontend.indexOf('function enterRosteredBeadleExam'),
  frontend.indexOf('function openRosterCorrection'),
);
assert.match(beadleDirectEntryBlock, /operation: 'beadle_student_entry'[\s\S]*examId,[\s\S]*deviceInstanceHash/);
const directEntryQueryStart = beadleDirectEntryBlock.indexOf("const payload = await api('/exam-room/query'");
const directEntryQueryEnd = beadleDirectEntryBlock.indexOf(');', directEntryQueryStart);
const directEntryQuery = beadleDirectEntryBlock.slice(directEntryQueryStart, directEntryQueryEnd);
assert.doesNotMatch(directEntryQuery, /studentKey|dd26-student-key/,
  'the Beadle handoff query must not ask for or send a browser class code');
assert.match(beadleDirectEntryBlock, /entryMode: 'beadle'[\s\S]*autoEnter: true/,
  'the direct handoff must preserve its waiting-room auto-entry intent');
assert.match(beadleDirectEntryBlock, /beadleHandoffPromise[\s\S]*pending\.finally/,
  'rapid repeated clicks must share one direct-entry request');
const beadlePersistenceBlock = frontend.slice(
  frontend.indexOf('function clearBeadleStudentHandoff'),
  frontend.indexOf('function stopStudentWaitingRoom'),
);
assert.match(beadlePersistenceBlock, /BEADLE_STUDENT_HANDOFF_KEY[\s\S]*localStorage[\s\S]*userId[\s\S]*examId/,
  'the no-secret handoff marker must survive a same-account reload');
assert.match(frontend, /if \(portalUserId\) await restoreBeadleStudentHandoff\(\)/,
  'a signed-in portal refresh must recover the exact saved Beadle handoff');
const beadleTerminalBlock = frontend.slice(
  frontend.indexOf('function stopStudentWaitingRoom'),
  frontend.indexOf('function enterRosteredBeadleExam'),
);
assert.match(beadleTerminalBlock, /stopStudentWaitingRoom[\s\S]*directBeadleTerminalState[\s\S]*clearBeadleStudentHandoff/,
  'terminal authorization and completed-attempt states must stop retrying and clear the handoff');
assert.match(frontend, /This page never shows questions, answers, grades, or the Professor’s suggested answer/,
  'the streamlined handoff must retain the Beadle privacy boundary');
assert.match(frontend, /Create a new student exam code/,
  'a Beadle who cannot recover the active code gets one plain replacement action');
assert.match(importRosterBlock, /Access-code emails were queued|access-code emails were queued|student access-code emails queued/i);
assert.match(frontend, /STUDENT_ACCESS_ISSUED: 'The class-wide student exam code is already active\.'/,
  'the issued state must be translated into classroom language');
const pagehideBlock = frontend.slice(frontend.indexOf("addEventListener?.('pagehide'"), frontend.indexOf("document.addEventListener?.('visibilitychange'"));
assert.match(pagehideBlock, /persistCurrentGradingDraft\(\)/);
assert.doesNotMatch(pagehideBlock, /studentExamCodes\.clear|clearGradingWorkspace|finishDialogLifecycle/,
  'pagehide must preserve active classroom and grading state');

// A valid signed-in student can wait before opening time without receiving an
// attempt or any question payload. Start always rechecks authoritative server time.
assert.match(frontend, /operation: 'student_entry', studentKey, deviceInstanceHash/,
  'initial entry must resolve and validate the class-wide code before the waiting room opens');
const waitingRoomStart = frontend.indexOf('function waitingRoomChecks');
const waitingRoomEnd = frontend.indexOf('function examIntegrityPolicy', waitingRoomStart);
const waitingRoomBlock = frontend.slice(waitingRoomStart, waitingRoomEnd);
assert.match(waitingRoomBlock, /accessCodeAccepted === true[\s\S]*accessCodeStatus === 'accepted'/);
assert.match(waitingRoomBlock, /waitingRoomState[\s\S]*EXAM_NOT_OPEN/);
assert.match(waitingRoomBlock, /Student waiting room[\s\S]*id="dd26-waiting-countdown"/);
assert.match(waitingRoomBlock, /identity, class-list entry, and student exam code have been checked/i);
assert.match(waitingRoomBlock, /No attempt is created and no examination question is shown/);
assert.doesNotMatch(waitingRoomBlock, /operation: 'start_attempt'|question\.prompt|questions\.map/,
  'the waiting room must not create an attempt or render examination questions');
const waitingEntryStart = frontend.indexOf('async function enterExamFromWaitingRoom');
const waitingEntryEnd = frontend.indexOf('function examIntegrityPolicy', waitingEntryStart);
const waitingEntryBlock = frontend.slice(waitingEntryStart, waitingEntryEnd);
assert.ok(waitingEntryBlock.indexOf('studentPreflightQuery(check)') < waitingEntryBlock.indexOf('beginAttemptAfterPreflight(fullscreenRequest)'),
  'Start must recheck server opening time before attempt creation');
assert.ok(waitingEntryBlock.indexOf('requestFullscreen()') < waitingEntryBlock.indexOf('studentPreflightQuery(check)'),
  'the waiting-room Start click must preserve the browser gesture before its server recheck');
assert.match(frontend, /serverDelay[\s\S]*Math\.max\(5000, Math\.min\(30_000, serverDelay\)\)[\s\S]*: 15_000/,
  'waiting-room polling must default to 15 seconds and use the server’s shorter final-minute cadence');
assert.match(frontend, /accessAuthorization === 'active_beadle_assignment'/);
assert.match(waitingRoomBlock, /Secure Beadle handoff/);
assert.match(waitingRoomBlock, /Automatic entry armed/);
assert.match(waitingRoomBlock, /autoEntryBusy[\s\S]*autoEntryRetryAt[\s\S]*5_000/,
  'automatic Beadle entry must be single-flight and back off after a transient failure');
assert.match(waitingRoomBlock, /!isRetryableBeadleHandoffError\(error\)[\s\S]*renderDirectBeadleHandoffBlocker/,
  'terminal Beadle polling failures must stop instead of entering a retry loop');
assert.match(waitingEntryBlock, /directBeadleTerminalState\(check\.server\)[\s\S]*renderDirectBeadleHandoffBlocker/,
  'the final server recheck must route submitted, revoked, and ineligible states to recovery');
assert.match(waitingEntryBlock, /check\.lastStartError[\s\S]*!isRetryableBeadleHandoffError\(startError\)/,
  'a terminal start mutation failure must not be retried as a transport failure');
assert.match(waitingRoomBlock, /Cancel and return to Beadle workspace/);
assert.match(frontend, /clearInterval\(state\.exam\.waitingRoomTimer\)[\s\S]*clearTimeout\(state\.exam\.waitingRoomPollTimer\)/,
  'both waiting-room timers must be cleared when the student leaves or starts');

const instructionSourceStart = frontend.indexOf('function studentInstructionsHtml');
const instructionSourceEnd = frontend.indexOf('function randomKey', instructionSourceStart);
const instructionSource = frontend.slice(instructionSourceStart, instructionSourceEnd);
const testEscapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character]));
const studentInstructionsHtml = Function('escapeHtml', `${instructionSource}; return studentInstructionsHtml;`)(testEscapeHtml);
const numberedInstructions = studentInstructionsHtml('INSTRUCTIONS 1. Read every question. 2. Submit before time expires.');
assert.match(numberedInstructions, /<ol>[\s\S]*<li>Read every question\.<\/li>[\s\S]*<li>Submit before time expires\.<\/li>/);
const paragraphInstructions = studentInstructionsHtml('First paragraph.\n\nSecond <script>alert(1)<\/script> paragraph.');
assert.match(paragraphInstructions, /<p>First paragraph\.<\/p>[\s\S]*<p>Second &lt;script&gt;alert\(1\)&lt;\/script&gt; paragraph\.<\/p>/,
  'instruction paragraphs must be safely escaped');
assert.ok((frontend.match(/studentInstructionsHtml\(/g) || []).length >= 4,
  'waiting room, normal preflight, and active attempt must share formatted instructions');
assert.match(css, /\.dd26-waiting-room/);
assert.match(css, /\.dd26-waiting-clock/);
assert.match(css, /\.dd26-student-instructions ol/);

// Student checks, local-first states, stable pending intent, receipt, recovery, and leave are explicit.
assert.match(frontend, /operation: 'preflight'/);
const preflightRenderBlock = frontend.slice(
  frontend.indexOf('function renderPreflight'),
  frontend.indexOf('async function beginAttemptAfterPreflight'),
);
assert.ok(preflightRenderBlock.indexOf('if (!isAuthenticated())') < preflightRenderBlock.indexOf('openDialog('),
  'a delayed exam check must not reopen after the Student signs out');
const preflightStartBlock = frontend.slice(
  frontend.indexOf('async function beginAttemptAfterPreflight'),
  frontend.indexOf('async function loadAttempt'),
);
assert.match(preflightRenderBlock, /studentStartReadiness\(server\)[\s\S]*startReadiness\.canStart/,
  'the Start control requires the server-confirmed opening and entry window');
assert.match(preflightStartBlock, /studentStartReadiness\(check\.server\)\.canStart/,
  'the server-confirmed opening and entry window is checked again immediately before start');
assert.ok(preflightStartBlock.indexOf('requestFullscreen()') < preflightStartBlock.indexOf("operation: 'start_attempt_by_code'"),
  'full screen must be requested synchronously from the Start click before a network wait');
assert.match(preflightStartBlock, /entryMode === 'beadle'[\s\S]*operation: 'start_beadle_attempt'[\s\S]*examId: check\.examId/,
  'the Beadle direct path must start only its server-authorized rostered attempt');
assert.doesNotMatch(preflightRenderBlock, /checks it when you select Start examination/,
  'preflight must never describe an already rejected code as awaiting validation');
assert.match(preflightRenderBlock, /studentAccessCodeState\(server, check\.studentKey\)[\s\S]*accessCodeState\.className/,
  'invalid, locked, inactive, and missing student codes must render as explicit failures');
assert.match(preflightRenderBlock, /studentEntryTiming\(server\)[\s\S]*openingRow\.className = entryTiming\.className/,
  'opening and entry timing must render independently from any other blocker');
assert.ok(preflightStartBlock.indexOf('if (!isAuthenticated())') < preflightStartBlock.indexOf("operation: 'start_attempt_by_code'"),
  'Student authentication must be rechecked immediately before starting the attempt');
assert.match(frontend, /if \(state\.view === 'exam_room'\)[\s\S]*state\.exam\.preflight = null;[\s\S]*state\.exam\.attempt = null;[\s\S]*closeDialog\(\)/,
  'sign-out must close the exam dialog and remove any Student preflight or attempt state');
assert.match(frontend, /state\.exam\.store\.saveAnswer/);
assert.match(frontend, /Saving on this device…/);
assert.match(frontend, /Saved on this device/);
assert.match(frontend, /Syncing…/);
assert.match(frontend, /Synced at/);
assert.match(frontend, /Offline — saved on this device/);
assert.match(frontend, /Recovery available/);
assert.match(frontend, /ensureSubmissionIntent/);
assert.match(frontend, /Submission pending — not yet received by Due Diligence/);
assert.match(frontend, /Submission received by Due Diligence/);
assert.match(frontend, /operation: 'start_leave'/);
assert.match(frontend, /operation: 'end_leave'/);
assert.match(frontend, /action: 'acknowledge'/);
assert.match(frontend, /operation: 'record_technical_incident'/);
assert.match(frontend, /operation: 'record_integrity_event'/);
assert.match(frontend, /clientEventId: randomUuid\(\)/);
assert.match(frontend, /sessionId: attempt\.sessionId[\s\S]*sessionEpoch: attemptScope\(\)\.sessionEpoch/);
const reviewBlock = frontend.slice(
  frontend.indexOf('async function openSubmissionReview'),
  frontend.indexOf('async function submitAttempt'),
);
assert.doesNotMatch(reviewBlock, /ensureSubmissionIntent/,
  'Opening final review must not queue a submission before explicit confirmation.');
const submitBlock = frontend.slice(
  frontend.indexOf('async function submitAttempt'),
  frontend.indexOf('async function sendPendingSubmission'),
);
assert.match(submitBlock, /ensureSubmissionIntent/);
assert.match(frontend, /allowUncoordinatedWrite: true/,
  'the browser must not turn a valid server-authorized multi-device session read-only');
assert.match(frontend, /activeWritingSession[\s\S]*renderExamRoom\(\)[\s\S]*return;/,
  'session refresh events must preserve an in-progress Examination Room attempt');
assert.match(frontend, /attemptTimerKey[\s\S]*timerKey[\s\S]*updateAttemptClock\(\);[\s\S]*return;/,
  'rerendering an attempt must not restart its timer and heartbeat intervals');
assert.match(frontend, /id="dd26-attempt-review"[^>]*>Review All Answers<[\s\S]*id="dd26-attempt-submit"[^>]*>Submit</,
  'students must always have explicit review and submit controls, including on the last question');
assert.match(reviewBlock, /Review every question and answer[\s\S]*data-dd26-review-edit/,
  'final review must show the actual questions and answers with edit controls');
assert.match(frontend, /operation\.offlineSince/);
assert.match(frontend, /error\.code === 'ANSWER_SET_MISMATCH'[\s\S]*refreshAttemptHash/);
assert.match(frontend, /async function unresolvedAnswerConflicts/);
assert.match(frontend, /resolveConflict\(\{ conflictId, resolution \}\)/);
assert.match(frontend, /Submission was not prepared/);
assert.match(frontend, /cleanupConfirmed\(\)/);
assert.match(frontend, /up to seven days/);
assert.match(frontend, /operation: 'heartbeat_v2'[\s\S]*sessionId:[\s\S]*sessionEpoch:/,
  'heartbeats must be bound to the active device session');
assert.match(frontend, /operation: 'grading_model_answer'/);
assert.match(frontend, /function gradingDraftKey[\s\S]*dd:exam-room:grading:/,
  'Professor grading drafts must be isolated by account, exam, attempt, and question');
assert.match(frontend, /function persistCurrentGradingDraft[\s\S]*localStorage\?\.setItem/,
  'Professor grading work must persist locally before navigation or tab exit');
assert.match(frontend, /visibilitychange[\s\S]*persistCurrentGradingDraft\(\)/,
  'backgrounding the browser must preserve the current Professor grading draft');
assert.match(frontend, /pagehide[\s\S]*persistCurrentGradingDraft\(\)/,
  'Alt-Tab or page exit must preserve the current Professor grading draft');
assert.match(frontend, /\['ungraded', 'draft', 'graded', 'active', 'absent', 'accommodated', 'flagged', 'all'\]/);
assert.doesNotMatch(frontend, /const GRADING_FILTERS = \[[^\]]*'late'/,
  'late-status classifications must not appear in Professor grading filters');
assert.match(frontend, /class="dd26-grading-split"/);
assert.match(frontend, /id="dd26-save-next-grade"/);
assert.match(frontend, /event\.altKey[\s\S]*ArrowRight[\s\S]*ArrowLeft/,
  'keyboard grading navigation must support Alt+Left and Alt+Right');
assert.match(frontend, /synchronizeServerClock\(payload\.result\.serverNow\)/);
assert.match(frontend, /global\.performance\.now\(\) - state\.exam\.serverClockMonotonicAt/,
  'the displayed countdown advances from a server-synchronized monotonic baseline');
assert.match(frontend, /currentServerTimeMs\(\)/);
assert.match(frontend, /data-dd26-student-preview-prompt[\s\S]*synchronizeCurrentPreview/,
  'the student question preview must stay current while the Professor edits text');

const leaseBlock = frontend.slice(
  frontend.indexOf('state.exam.tabLease.subscribe'),
  frontend.indexOf('await state.exam.tabLease.start'),
);
assert.match(leaseBlock, /lease\.readonly = false/,
  'browser tab coordination must not override a valid server-authorized writing session');
assert.doesNotMatch(frontend, /This tab is read-only and cannot submit the examination/,
  'a returning or second authorized device must not be blocked by a browser-only writer lease');

const loadAttemptBlock = frontend.slice(
  frontend.indexOf('async function loadAttempt'),
  frontend.indexOf('function attemptScope'),
);
assert.match(loadAttemptBlock, /deviceInstanceHash = await state\.exam\.store\.getDeviceInstanceHash\(\)[\s\S]*getSessionEnvelope\(attemptId, deviceInstanceHash\)/,
  'resume may restore only a session envelope bound to this browser device instance');
assert.ok(
  loadAttemptBlock.indexOf('getSessionEnvelope(attemptId, deviceInstanceHash)')
    < loadAttemptBlock.indexOf("operation: 'open_session'"),
  'the device-bound retained session must be checked before opening a replacement session',
);
assert.match(loadAttemptBlock, /operation: 'attempt'[\s\S]*sessionId: session\.sessionId[\s\S]*sessionEpoch: session\.epoch/,
  'the attempt bundle query remains bound to the restored or newly opened session');
assert.match(loadAttemptBlock, /if \(!session\?\.restoredFromDevice \|\| !isTransientTransportFailure\(error\)\) throw error;[\s\S]*getAttemptBundle\(attemptId\)/,
  'a cached authorized attempt bundle is usable only after a transient transport failure on a restored device session');
assert.match(loadAttemptBlock, /quarantineAttemptQueue\?\.\(session, error\.code\)[\s\S]*clearSessionEnvelope\?\.\(attemptId\)/,
  'a stale restored session quarantines pending work and clears its retained envelope');
const refreshHashBlock = frontend.slice(
  frontend.indexOf('async function refreshAttemptHash'),
  frontend.indexOf('function renderPendingSubmission'),
);
assert.match(refreshHashBlock, /sessionId: attempt\.sessionId[\s\S]*sessionEpoch: attemptScope\(\)\.sessionEpoch/,
  'answer-set refreshes remain session-bound');
assert.match(frontend, /operation: 'submission_status'/);
assert.match(frontend, /status\.receiptId && status\.receivedAt && isClosedAttemptStatus\(status\.status\)/,
  'the receipt UI requires a real server receipt and closed status');
assert.match(frontend, /Deadline reached — server receipt pending/);
const submissionStatusBlock = frontend.slice(
  frontend.indexOf('async function loadSubmissionStatus'),
  frontend.indexOf('function showSubmissionReceipt'),
);
assert.match(submissionStatusBlock, /await state\.exam\.store\.reconcileServerReceipt\(\{/,
  'a receipt discovered by status polling must be reconciled into the device journal');
assert.ok(
  submissionStatusBlock.indexOf('await state.exam.store.reconcileServerReceipt({')
    < submissionStatusBlock.indexOf('showSubmissionReceipt(status)'),
  'status-observed receipt reconciliation must finish before the receipt is displayed',
);
const clockBlock = frontend.slice(
  frontend.indexOf('function updateAttemptClock'),
  frontend.indexOf('async function sendHeartbeat'),
);
assert.match(clockBlock, /serverClockUnavailable[\s\S]*clock\.textContent = 'OFFLINE'/,
  'offline recovery must visibly replace the countdown when server time is unavailable');
assert.match(clockBlock, /Server countdown unavailable while offline[\s\S]*Reconnect for server time/);
const pendingSubmissionBlock = frontend.slice(
  frontend.indexOf('async function sendPendingSubmission'),
  frontend.indexOf('async function refreshAttemptHash'),
);
for (const terminalCode of [
  'EXAM_ROOM_SESSION_STALE',
  'EXAM_ROOM_SESSION_EPOCH_CONFLICT',
  'EXAM_ROOM_ATTEMPT_CLOSED',
  'EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT',
]) {
  assert.match(pendingSubmissionBlock, new RegExp(terminalCode));
}
assert.match(pendingSubmissionBlock, /quarantineAttemptQueue/,
  'terminal submission failures retain recovery evidence and do not retry forever');

// Exam safeguards block clipboard and right-click actions only inside the active
// surface, respect approved assistive-technology settings, and never turn a
// signal into a penalty.
assert.doesNotMatch(frontend, /preventExamAction/);
assert.match(frontend, /function examIntegrityPolicy[\s\S]*integrityMode !== 'off'[\s\S]*integrityExempt !== true[\s\S]*assistiveTechnology !== true/);
assert.match(frontend, /addEventListener\('copy', clipboardIncident, true\)/);
assert.match(frontend, /addEventListener\('cut', clipboardIncident, true\)/);
assert.match(frontend, /addEventListener\('paste', clipboardIncident, true\)/);
assert.match(frontend, /addEventListener\('contextmenu', contextMenuIncident, true\)/);
assert.match(frontend, /event\.preventDefault\(\)[\s\S]*event\.type === 'paste' \? 'paste_attempt' : 'copy_attempt'/);
assert.match(frontend, /action: event\.type, blocked: true, surface: 'examination'/);
assert.match(frontend, /attempt\.status !== 'in_progress'[\s\S]*clipboardEventTouchesAttempt\(event, surface\)/);
assert.match(frontend, /function contextMenuIncident[\s\S]*event\.preventDefault\(\)[\s\S]*recordIncident\('context_menu_attempt'/);
assert.doesNotMatch(frontend, /clipboardData|getData\(['"]text|selectedText/,
  'clipboard and selected content must never enter an incident payload');
assert.match(frontend, /You returned to the examination[\s\S]*does not automatically fail or lock/);
assert.match(frontend, /not proof by themselves/);
assert.doesNotMatch(frontend, /leak[- ]?proof/i);
assert.doesNotMatch(frontend, /result\.locked/);
assert.doesNotMatch(frontend, /recordIncident\('(?:visibility_resume|focus_return)'/,
  'returning to the exam must not count as a second departure event');
assert.match(frontend, /removeEventListener\('visibilitychange', visibilityIncident\)[\s\S]*addEventListener\('visibilitychange', visibilityIncident\)/);
for (const eventName of ['copy', 'cut', 'paste']) {
  assert.match(frontend, new RegExp(`removeEventListener\\('${eventName}', clipboardIncident, true\\)`));
}
assert.match(frontend, /removeEventListener\('contextmenu', contextMenuIncident, true\)/);

const visibilityHandler = frontend.slice(
  frontend.indexOf('function visibilityIncident'),
  frontend.indexOf('function blurIncident'),
);
const focusReturnHandler = frontend.slice(
  frontend.indexOf('function focusReturnIncident'),
  frontend.indexOf('function clipboardIncident'),
);
const attentionNoticeHandler = frontend.slice(
  frontend.indexOf('function showAttentionReturnNotice'),
  frontend.indexOf('function renderAttempt'),
);
assert.match(visibilityHandler, /recordIncident\('visibility_exit'[\s\S]*showAttentionReturnNotice\(\)/);
assert.doesNotMatch(visibilityHandler, /renderAttempt\(\)/,
  'returning from a hidden tab must preserve the live textarea node and its undo history');
assert.match(focusReturnHandler, /showAttentionReturnNotice\(\)/);
assert.doesNotMatch(focusReturnHandler, /renderAttempt\(\)/,
  'returning focus must preserve the live textarea node and its undo history');
assert.match(attentionNoticeHandler, /insertAdjacentHTML\('afterend', attentionReturnMarkup\(\)\)/);
assert.match(attentionNoticeHandler, /continueButton\?\.focus\(\)/);
assert.doesNotMatch(attentionNoticeHandler, /\.innerHTML\s*=/,
  'the attention notice must be inserted without rebuilding the answer editor');

// Execute the pure integrity policy and clipboard-scope helpers. Copy is blocked
// whenever a selection crosses the exam; cut/paste depend only on their target.
const integrityHelpersStart = frontend.indexOf('function examIntegrityPolicy');
const integrityHelpersEnd = frontend.indexOf('function renderPreflight', integrityHelpersStart);
assert.ok(integrityHelpersStart > 0 && integrityHelpersEnd > integrityHelpersStart);
const { examIntegrityPolicy, clipboardEventTouchesAttempt } = Function(
  `'use strict'; ${frontend.slice(integrityHelpersStart, integrityHelpersEnd)}; return { examIntegrityPolicy, clipboardEventTouchesAttempt };`,
)();
assert.deepEqual(examIntegrityPolicy({}, {}), { recordingEnabled: false, clipboardBlocked: false });
assert.deepEqual(examIntegrityPolicy({ integrityMode: 'off' }, {}),
  { recordingEnabled: false, clipboardBlocked: false });
assert.deepEqual(examIntegrityPolicy({ integrityMode: 'record_only' }, { integrityExempt: true }),
  { recordingEnabled: false, clipboardBlocked: false });
assert.deepEqual(examIntegrityPolicy({ integrityMode: 'record_only' }, { assistiveTechnology: true }),
  { recordingEnabled: true, clipboardBlocked: false });
assert.deepEqual(examIntegrityPolicy({ integrityMode: 'warn_and_record' }, {}),
  { recordingEnabled: true, clipboardBlocked: true });

const insideNode = { location: 'inside' };
const outsideStart = { location: 'outside-start' };
const outsideEnd = { location: 'outside-end' };
const attemptSurface = { contains: (node) => node === insideNode };
const crossingSelection = {
  anchorNode: outsideStart,
  focusNode: outsideEnd,
  rangeCount: 1,
  getRangeAt: () => ({ intersectsNode: (node) => node === attemptSurface }),
};
assert.equal(clipboardEventTouchesAttempt(
  { type: 'copy', target: outsideStart }, attemptSurface, crossingSelection,
), true, 'a selection crossing into the examination must not bypass copy blocking');
assert.equal(clipboardEventTouchesAttempt(
  { type: 'paste', target: outsideStart }, attemptSurface, crossingSelection,
), false, 'a stale examination selection must not block paste outside the examination');
assert.equal(clipboardEventTouchesAttempt(
  { type: 'cut', target: outsideStart }, attemptSurface, crossingSelection,
), false, 'cut outside the examination remains available');
assert.equal(clipboardEventTouchesAttempt(
  { type: 'paste', target: insideNode }, attemptSurface, null,
), true, 'paste into the examination answer must be blocked');
assert.equal(clipboardEventTouchesAttempt(
  { type: 'cut', target: insideNode }, attemptSurface, null,
), true, 'cut from the examination answer must be blocked');

// Accessible dialog/status/navigation contracts and reduced motion are present.
assert.match(frontend, /document\.createElement\('dialog'\)/);
assert.match(frontend, /function finishDialogLifecycle[\s\S]*input\[type="password"\], \[data-dd26-sensitive\][\s\S]*replaceChildren\(\)/,
  'closing a one-time-key dialog must remove the key from the live DOM');
assert.doesNotMatch(pagehideBlock, /finishDialogLifecycle/,
  'pagehide must not destroy resumable classroom or grading dialog state');
assert.match(frontend, /refreshBeadleOperations\(examId\)[\s\S]*EXAMINATION_ROOM_REFRESH_WAIT_MS/,
  'student-code issue must refresh the exact Beadle state after success');
assert.match(frontend, /aria-live="polite"/);
assert.match(frontend, /aria-current="step"/);
assert.match(css, /\.dd26-modal::backdrop/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /\.dd26-role-grid/);
assert.match(css, /\.dd26-roster-template-flow>li\{[^}]*grid-template-columns:42px minmax\(0,1fr\)[^}]*border-left:4px solid #d4af37/,
  'the required Beadle template flow has a clear numbered rail and aligned copy');
assert.match(css, /\.dd26-roster-field-list\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
  'the three required roster fields align in one readable row on wide screens');
assert.match(css, /\.dd26-roster-field-list\{grid-template-columns:1fr;\}/,
  'the three roster fields stack cleanly on small screens');
assert.match(css, /\.dd26-flow-step\.has-action\{[^}]*grid-template-columns:38px minmax\(0,1fr\) auto minmax\(150px,auto\)/,
  'the five-step review aligns status and a dedicated action column');
assert.match(css, /\.dd26-flow-step,\.dd26-flow-step\.has-action\{grid-template-columns:34px minmax\(0,1fr\)/,
  'the five-step action column collapses cleanly on small screens');
assert.match(css, /\.dd26-flow-action\{[^}]*justify-self:end/);
assert.match(css, /\.dd26-question-editor\.is-read-only/);
assert.match(css, /\.dd26-reschedule-comparison>div\{[^}]*grid-template-columns:minmax\(145px,.7fr\) repeat\(2,minmax\(0,1fr\)\)/,
  'current and updated schedules align in the review dialog');
assert.match(css, /\.dd26-reschedule-comparison>div\{grid-template-columns:1fr;gap:5px/,
  'the schedule comparison becomes a readable vertical list on small screens');

assert.doesNotMatch(html, /<script[^>]+assets\/examination-room-2-store\.js/);
assert.match(featureLoader, /assets\/examination-room-2-store\.js\?v=exam-room-ux-20260814-1/);
assert.match(build, /assets\/examination-room-2-store\.js/);
assert.match(featureLoader, /duediligence-2026\.css\?v=guided-random-access-20260822-1/);
assert.match(featureLoader, /duediligence-2026\.js\?v=guided-random-access-20260822-1/);

// Execute the pure disclosure gate: malformed, partial, and stale replacement
// results must never unlock one-time secret rendering.
const disclosureGateStart = frontend.indexOf('function publicationSecretsMayBeDisplayed');
const disclosureGateEnd = frontend.indexOf('async function scheduleExam', disclosureGateStart);
assert.ok(disclosureGateStart > 0 && disclosureGateEnd > disclosureGateStart);
const publicationSecretsMayBeDisplayed = Function(
  `'use strict'; ${frontend.slice(disclosureGateStart, disclosureGateEnd)}; return publicationSecretsMayBeDisplayed;`,
)();
assert.equal(publicationSecretsMayBeDisplayed({}, { intent: { mode: 'initial' } }), false);
assert.equal(publicationSecretsMayBeDisplayed(
  { ok: true,
    publication: { ok: true, publicationId: 'publication-1', accessCodeRequired: true },
    beadleInvitation: { ok: true }, studentAccessReady: false, oneTimeBeadleKey: 'beadle-key' },
  { rules: { studentAccessCodeRequired: true }, intent: { mode: 'initial' } },
  { beadleKey: 'beadle-key' },
), true);
assert.equal(publicationSecretsMayBeDisplayed(
  { ok: true,
    publication: { ok: true, publicationId: 'publication-1', accessCodeRequired: true },
    beadleInvitation: { ok: true }, studentAccessReady: false, oneTimeBeadleKey: 'wrong-key' },
  { rules: { studentAccessCodeRequired: true }, intent: { mode: 'initial' } },
  { beadleKey: 'beadle-key' },
), false);
assert.equal(publicationSecretsMayBeDisplayed(
  { ok: true, publicationId: 'publication-2', credentialsRotated: true, questionVersionChanged: true,
    replacementQuestionVersionId: 'questions-old', accessCodeRequired: true },
  { rules: { studentAccessCodeRequired: true },
    intent: { mode: 'replacement', replacementQuestionVersionId: 'questions-new' } },
), false);
assert.equal(publicationSecretsMayBeDisplayed(
  { ok: true, publicationId: 'publication-2', credentialsRotated: true, questionVersionChanged: true,
    replacementQuestionVersionId: 'questions-new', accessCodeRequired: true },
  { rules: { studentAccessCodeRequired: true },
    intent: { mode: 'replacement', replacementQuestionVersionId: 'questions-new' } },
), true);

// Execute the access-code policy gate. An omitted publication policy must block;
// explicit roster-only and code-required policies remain distinguishable.
const accessPolicyStart = frontend.indexOf('function accessCodePreflightPolicy');
const accessPolicyEnd = frontend.indexOf('function renderPreflight', accessPolicyStart);
assert.ok(accessPolicyStart > 0 && accessPolicyEnd > accessPolicyStart);
const accessCodePreflightPolicy = Function(
  `'use strict'; ${frontend.slice(accessPolicyStart, accessPolicyEnd)}; return accessCodePreflightPolicy;`,
)();
assert.deepEqual(accessCodePreflightPolicy({}, null),
  { known: false, required: false, beadleAuthorized: false, ready: false });
assert.deepEqual(accessCodePreflightPolicy({ accessCodeRequired: false }, null),
  { known: true, required: false, beadleAuthorized: false, ready: true });
assert.deepEqual(accessCodePreflightPolicy({ accessCodeRequired: true }, null),
  { known: true, required: true, beadleAuthorized: false, ready: false });
assert.deepEqual(accessCodePreflightPolicy({ checks: { accessCodeRequired: true } }, 'entered-code'),
  { known: true, required: true, beadleAuthorized: false, ready: true });
assert.deepEqual(accessCodePreflightPolicy({
  accessCodeRequired: true,
  beadleDirectEntry: true,
  accessAuthorization: 'active_beadle_assignment',
}, null), { known: true, required: true, beadleAuthorized: true, ready: true },
'an active server-authorized Beadle handoff satisfies the code gate without putting a code in the browser');

const startReadinessStart = frontend.indexOf('function studentStartReadiness');
const startReadinessEnd = frontend.indexOf('function examIntegrityPolicy', startReadinessStart);
const studentStartReadiness = Function(
  'formatDate',
  `'use strict'; ${frontend.slice(startReadinessStart, startReadinessEnd)}; return studentStartReadiness;`,
)((value) => String(value || 'unknown'));
assert.equal(studentStartReadiness({}).canStart, false,
  'an omitted server decision must fail closed');
assert.equal(studentStartReadiness({ canStart: true, entryClosesAt: 'later' }).canStart, true);
assert.match(studentStartReadiness({ canStart: false, startBlockerCode: 'STUDENT_ACCESS_NOT_READY' }).copy,
  /Beadle has not finished the class handout/);
assert.match(studentStartReadiness({ canStart: false, startBlockerCode: 'CREDENTIAL_INVALID' }).copy,
  /incorrect for this examination/);
assert.match(studentStartReadiness({ canStart: false, startBlockerCode: 'CREDENTIAL_LOCKED' }).copy,
  /locked for 15 minutes/);
assert.match(studentStartReadiness({ canStart: false, startBlockerCode: 'CREDENTIAL_NOT_ACTIVE' }).copy,
  /No active student exam code/);
assert.match(studentStartReadiness({ canStart: false, startBlockerCode: 'STUDENT_ACCESS_CODE_REQUIRED' }).copy,
  /Enter the active student exam code/);

// Execute the three Professor step gates. Browser-detectable errors must stop
// each transition and publication does not wait for the later Beadle roster.
const draftValidationStart = frontend.indexOf('function examDraftValidation');
const draftValidationEnd = frontend.indexOf('function showCreateExamErrors', draftValidationStart);
const examDraftValidation = Function(
  `'use strict'; const codePointLength = (value) => Array.from(String(value ?? '')).length; ${frontend.slice(draftValidationStart, draftValidationEnd)}; return examDraftValidation;`,
)();
assert.equal(examDraftValidation({
  title: 'Civil Law Midterms', instructions: '', questionCount: '20',
  integrityPreset: 'standard', classroomId: 'room-1',
}).errors.length, 0);
assert.ok(examDraftValidation({
  title: ' ', instructions: '', questionCount: '1.5',
  integrityPreset: 'standard', classroomId: 'room-1',
}).errors.length >= 2);

const questionValidationStart = frontend.indexOf('function questionReviewValidation');
const questionValidationEnd = frontend.indexOf('function showQuestionReviewErrors', questionValidationStart);
const questionReviewValidation = Function(
  `'use strict'; const codePointLength = (value) => Array.from(String(value ?? '')).length; ${frontend.slice(questionValidationStart, questionValidationEnd)}; return questionReviewValidation;`,
)();
assert.deepEqual(questionReviewValidation([
  { prompt: 'Discuss jurisdiction.', maximumPoints: 10 },
], 1), []);
assert.ok(questionReviewValidation([
  { prompt: ' ', maximumPoints: 0 },
], 2).length >= 3);

const rescheduleValidationStart = frontend.indexOf('function publicationRescheduleValidation');
const rescheduleValidationEnd = frontend.indexOf('function showPublicationRescheduleErrors', rescheduleValidationStart);
const manilaDateTimeStart = frontend.indexOf('function manilaDateTime');
const scheduleHelpersEnd = frontend.indexOf('function entryClosesAtForSchedule', manilaDateTimeStart);
const publicationRescheduleValidation = Function(
  `'use strict'; ${frontend.slice(manilaDateTimeStart, scheduleHelpersEnd)}; ${frontend.slice(rescheduleValidationStart, rescheduleValidationEnd)}; return publicationRescheduleValidation;`,
)();
assert.equal(publicationRescheduleValidation({
  opensAt: '2035-08-10T12:00:00.000Z', hardClosesAt: '2035-08-10T14:00:00.000Z',
  durationMinutes: '120', lateAdmissionMinutes: '15', submissionGraceMinutes: '15',
  reason: 'The law school moved the examination schedule.',
  nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
}).errors.length, 0);
assert.equal(publicationRescheduleValidation({
  opensAt: '2035-08-10T10:00:00.000Z', hardClosesAt: '2035-08-10T12:00:00.000Z',
  durationMinutes: '120', lateAdmissionMinutes: '15', submissionGraceMinutes: '15',
  reason: 'The Professor is opening the examination immediately.',
  nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
}).errors.length, 0, 'a Professor may move an exam to an immediate opening');
assert.ok(publicationRescheduleValidation({
  opensAt: '2035-08-10T10:20:00.000Z', hardClosesAt: '2035-08-10T10:10:00.000Z',
  durationMinutes: '0', lateAdmissionMinutes: '481', submissionGraceMinutes: '121',
  reason: 'short', nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
}).errors.length >= 4,
'schedule changes enforce end order, entry/grace limits, and a recorded reason while duration is calculated');

const publishValidationStart = frontend.indexOf('function publishStepValidation');
const publishValidationEnd = frontend.indexOf('function showPublishStepErrors', publishValidationStart);
const publishStepValidation = Function(
  `'use strict'; ${frontend.slice(manilaDateTimeStart, scheduleHelpersEnd)}; ${frontend.slice(publishValidationStart, publishValidationEnd)}; return publishStepValidation;`,
)();
const validPublishStep = publishStepValidation({
  opensAt: '2035-08-10T12:00:00.000Z',
  hardClosesAt: '2035-08-10T14:00:00.000Z',
  durationMinutes: '120', lateAdmissionMinutes: '0', submissionGraceMinutes: '15',
  allowedMaterials: 'Codal only', suggestedAnswerMode: 'none', suggestedAnswer: '',
  beadleEmail: 'beadle@example.edu', nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
  exam: { publicationStateKnown: true, status: 'confirmed', questionCount: 20, canPublish: true },
});
assert.equal(validPublishStep.errors.length, 0,
  'Professor may finalize before the Beadle uploads the class list');
assert.match(frontend, /const defaultOpen = new Date\(\);/,
  'the Professor schedule opens immediately by default');
assert.match(frontend, /EXAM_ROOM_HANDOFF_TIME_REQUIRED/);
assert.equal(publishStepValidation({
  opensAt: '2035-08-10T10:00:00.000Z', hardClosesAt: '2035-08-10T14:00:00.000Z',
  durationMinutes: '120', lateAdmissionMinutes: '15', submissionGraceMinutes: '15',
  allowedMaterials: '', suggestedAnswerMode: 'none', beadleEmail: 'beadle@example.edu',
  nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
  exam: { publicationStateKnown: true, status: 'confirmed', questionCount: 20, canPublish: true },
}).errors.length, 0, 'publication may open immediately');
assert.doesNotMatch(frontend, /at least 30 minutes|30 minutes after publication/,
  'the Professor workflow must not retain the removed lead-time restriction');
assert.ok(publishStepValidation({
  opensAt: '2035-08-10T12:00:00.000Z', hardClosesAt: '2035-08-10T14:00:00.000Z',
  durationMinutes: '120', lateAdmissionMinutes: '0', submissionGraceMinutes: '15',
  suggestedAnswerMode: 'none', beadleEmail: 'beadle@example.edu',
  nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
  exam: { publicationStateKnown: true, status: 'confirmed', questionCount: 20, canPublish: false,
    publishBlockers: ['Confirm all questions.'] },
}).errors.length > 0, 'the final review fails closed unless the server confirms publication readiness');
assert.ok(publishStepValidation({
  opensAt: '', hardClosesAt: '2035-08-10T09:00:00.000Z',
  durationMinutes: '1.5', lateAdmissionMinutes: '', submissionGraceMinutes: '121',
  suggestedAnswerMode: 'paste', suggestedAnswer: '', beadleEmail: 'not-an-email',
  nowMs: Date.parse('2035-08-10T10:00:00.000Z'),
  exam: { publicationStateKnown: true, status: 'draft', questionCount: 20 },
}).errors.length >= 7);

console.log('Examination Room 2.0 frontend contracts passed.');
