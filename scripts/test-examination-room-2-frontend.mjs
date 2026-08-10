import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, frontend, css, build, phase2Config, stagingBuild] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/phase2-config.js', root), 'utf8'),
  readFile(new URL('scripts/build-staging-artifact.mjs', root), 'utf8'),
]);

// The owner explicitly approved a live beta-wide activation. The entry is
// available to every admitted beta user, while the independent client and two
// server gates remain fail-closed and role actions remain server-authorized.
assert.match(phase2Config, /examinationRoom2:\s*true/);
assert.match(html, /id="spa-examination-room" type="button"/);
assert.doesNotMatch(html, /id="spa-examination-room" type="button" hidden/);
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
  'staging no longer needs to unhide an entry that is enabled for the private beta');

// Public information architecture is exactly the four classroom roles.
assert.match(frontend, /\['professor', 'Professor'[\s\S]*\['beadle', 'Beadle'[\s\S]*\['student', 'Student'[\s\S]*\['admin', 'Admin'/);
assert.match(frontend, /data-dd26-exam-role="\$\{id\}"/);
assert.doesNotMatch(frontend, /\['workplace'/i);
assert.match(frontend, /A student cannot open the Student examination page until signed in/);
assert.doesNotMatch(frontend, /\$\{examNavigation\(\)\}/,
  'role buttons must not be repeated inside the selected workspace');
const roleSelectionBlock = frontend.slice(
  frontend.indexOf('async function selectExamRole'),
  frontend.indexOf('function announceExamStatus'),
);
assert.ok(roleSelectionBlock.indexOf('if (!isAuthenticated())') < roleSelectionBlock.indexOf("if (role === 'admin')"),
  'authentication must happen before the Admin redirect');
assert.ok(roleSelectionBlock.indexOf('if (!isAuthenticated())') < roleSelectionBlock.indexOf('state.exam.section = role'),
  'authentication must happen before the Student or classroom workspace opens');
assert.match(roleSelectionBlock, /new URL\('admin\/', global\.location\.href\)/);
assert.doesNotMatch(frontend, /operation: '(?:open_dispute|dispute_view|close_dispute)'/,
  'the retired broad dispute viewer must not remain callable from the public Examination Room');

// Existing emailed deep links identify an exam without becoming authorization.
assert.match(frontend, /raw\.startsWith\('examination-room\?'\)/);
assert.match(frontend, /parameters\.get\('exam'\)/);
assert.match(frontend, /The link identifies the examination only\. It does not give anyone access/);

// Professor authoring remains count-configurable and visibly follows the 4-step classroom journey.
assert.match(frontend, /1 Make exam[\s\S]*2 Check questions[\s\S]*3 Set exam rules[\s\S]*4 Publish/);
assert.match(frontend, /id="dd26-exam-count" type="number" min="1" max="200" step="1"/);
assert.match(frontend, /\.pdf,\.txt,\.docx/);
assert.match(frontend, /Paste questions/);
assert.match(frontend, /Student preview/);
assert.match(frontend, /operation: 'schedule_exam'[\s\S]*operation: 'publish_exam'/);
assert.match(frontend, /option\[value="one_way"\][\s\S]*oneWayOption\.disabled = true/,
  'one-way authoring stays gated until durable reload enforcement exists');
assert.match(frontend, /option\[value="upload"\][\s\S]*modelAnswerUploadOption\.disabled = true/,
  'model-answer file upload stays gated until an owner-only retrieval path is verified');

// Rules use honest browser controls and conservative beta defaults.
for (const value of ['off', 'record_only', 'warn_and_record', 'free', 'one_way', 'automatic', 'beadle_approval']) {
  assert.match(frontend, new RegExp(`value="${value}"`));
}
assert.match(frontend, /aiGradingEnabled: false/);
assert.match(frontend, /id="dd26-student-access-code-required" type="checkbox" checked/);
assert.match(frontend, /studentAccessCodeRequired: document\.getElementById\('dd26-student-access-code-required'\)\?\.checked === true/);
assert.match(frontend, /Every student must still sign in, be on the class list, and meet the entry rules/);
assert.match(frontend, /const studentKey = draft\.rules\.studentAccessCodeRequired \? randomKey\('student_exam'\) : null/,
  'publishing without the optional access code must send no invented student secret');
assert.match(frontend, /function accessCodePreflightPolicy[\s\S]*typeof primary === 'boolean'[\s\S]*ready: known/);
assert.match(frontend, /The server did not report this publication’s access-code policy; starting is blocked/);
assert.match(frontend, /studentKey: check\.studentKey/);
assert.match(frontend, /No student access-code secret was issued/);
assert.match(frontend, /publicationSecretsMayBeDisplayed\(result, draft\)/,
  'secrets must remain hidden until a complete server publication result is verified');
const publishBlock = frontend.slice(
  frontend.indexOf('async function scheduleExam'),
  frontend.indexOf('function localDateValue'),
);
assert.match(publishBlock, /operation: 'publish_exam'[\s\S]*rules: draft\.rules, studentKey, requestKey:/,
  'initial publication must transiently prove the selected code/no-code policy');
assert.doesNotMatch(publishBlock, /draft\.(?:studentKey|gradingKey|credentialsScheduled)/,
  'raw publication credentials must not be retained in page state');
assert.match(publishBlock, /retryAuthorized = portalRefreshed === true[\s\S]*publicationStateKnown === true/,
  'a failed or uncertain publication may retry only after the server confirms the publication is unchanged');

// A replacement is a distinct corrected question version, never a rules-only mutation.
assert.match(frontend, /intent\.canReplacePublication !== true[\s\S]*intent\.canUploadReplacementQuestions !== true/);
assert.match(frontend, /Safe staging:[\s\S]*does not alter the currently published examination/);
assert.match(frontend, /operation: replacement \? 'confirm_replacement_questions' : 'confirm_questions'/);
assert.match(frontend, /expectedPublicationId: uploadIntent\.expectedPublicationId/);
assert.match(frontend, /result\.staged !== true[\s\S]*replacementQuestionVersionId/);
assert.match(frontend, /operation: 'replace_publication'[\s\S]*expectedPublicationId:[\s\S]*replacementQuestionVersionId:[\s\S]*rules:[\s\S]*studentKey,[\s\S]*gradingKey,[\s\S]*reason:[\s\S]*requestKey:/);
assert.match(frontend, /result\.questionVersionChanged === true/);
assert.match(frontend, /Once a candidate starts, this path is permanently blocked and corrections must use errata/);
assert.match(frontend, /Use a correction notice/);
assert.match(frontend, /refreshPortalSilently[\s\S]*await enrichProfessorExamIntents\(state\.exam\.portal\)/,
  'silent portal refreshes must not bypass publication eligibility enrichment');

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
assert.match(frontend, /never shows the exam questions, student answers, grades, or the Professor’s suggested answer/);
assert.match(frontend, /record_candidate_verification/);
assert.match(frontend, /set_candidate_admission/);
assert.match(frontend, /operation: 'validate_exam_roster'/);
assert.match(frontend, /operation: 'import_exam_roster'/);
assert.match(frontend, /operation: 'upsert_exam_roster_row'/);
assert.match(frontend, /id="dd26-beadle-exam-link" readonly/);
assert.match(frontend, /rosterMode === 'beadle'[\s\S]*examId: state\.exam\.activeExamId/);

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
assert.ok(preflightStartBlock.indexOf('if (!isAuthenticated())') < preflightStartBlock.indexOf("operation: 'start_attempt'"),
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
assert.match(frontend, /allowUncoordinatedWrite: false/);
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
assert.match(frontend, /synchronizeServerClock\(payload\.result\.serverNow\)/);
assert.match(frontend, /global\.performance\.now\(\) - state\.exam\.serverClockMonotonicAt/,
  'the displayed countdown advances from a server-synchronized monotonic baseline');
assert.match(frontend, /currentServerTimeMs\(\)/);

const leaseBlock = frontend.slice(
  frontend.indexOf('state.exam.tabLease.subscribe'),
  frontend.indexOf('await state.exam.tabLease.start'),
);
assert.match(leaseBlock, /changed[\s\S]*renderAttempt\(\)/,
  'writer-to-reader lease changes must rerender and disable all mutating controls');
assert.match(frontend, /This tab is read-only and cannot submit the examination/);

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

// Exam safeguards block clipboard actions only inside the active surface, respect
// approved assistive-technology settings, and never turn a signal into a penalty.
assert.doesNotMatch(frontend, /preventExamAction|context_menu_attempt|addEventListener\('contextmenu'/);
assert.match(frontend, /function examIntegrityPolicy[\s\S]*integrityMode !== 'off'[\s\S]*integrityExempt !== true[\s\S]*assistiveTechnology !== true/);
assert.match(frontend, /addEventListener\('copy', clipboardIncident, true\)/);
assert.match(frontend, /addEventListener\('cut', clipboardIncident, true\)/);
assert.match(frontend, /addEventListener\('paste', clipboardIncident, true\)/);
assert.match(frontend, /event\.preventDefault\(\)[\s\S]*event\.type === 'paste' \? 'paste_attempt' : 'copy_attempt'/);
assert.match(frontend, /action: event\.type, blocked: true, surface: 'examination'/);
assert.match(frontend, /attempt\.status !== 'in_progress'[\s\S]*clipboardEventTouchesAttempt\(event, surface\)/);
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
assert.match(frontend, /aria-live="polite"/);
assert.match(frontend, /aria-current="step"/);
assert.match(css, /\.dd26-modal::backdrop/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /\.dd26-role-grid/);

assert.match(html, /assets\/examination-room-2-store\.js/);
assert.match(build, /assets\/examination-room-2-store\.js/);

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
  { ok: true, publicationId: 'publication-1', accessCodeRequired: false },
  { rules: { studentAccessCodeRequired: false }, intent: { mode: 'initial' } },
), true);
assert.equal(publicationSecretsMayBeDisplayed(
  { ok: true, publicationId: 'publication-1', accessCodeRequired: true },
  { rules: { studentAccessCodeRequired: false }, intent: { mode: 'initial' } },
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
assert.deepEqual(accessCodePreflightPolicy({}, null), { known: false, required: false, ready: false });
assert.deepEqual(accessCodePreflightPolicy({ accessCodeRequired: false }, null),
  { known: true, required: false, ready: true });
assert.deepEqual(accessCodePreflightPolicy({ accessCodeRequired: true }, null),
  { known: true, required: true, ready: false });
assert.deepEqual(accessCodePreflightPolicy({ checks: { accessCodeRequired: true } }, 'entered-code'),
  { known: true, required: true, ready: true });

console.log('Examination Room 2.0 frontend contracts passed.');
