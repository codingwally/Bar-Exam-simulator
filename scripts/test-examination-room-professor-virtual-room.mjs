import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [frontend, css, core, routes, worker, migration, workbook] = await Promise.all([
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('worker/exam-room-2026-core.mjs', root), 'utf8'),
  readFile(new URL('worker/duediligence-2026-routes.mjs', root), 'utf8'),
  readFile(new URL('worker/index.mjs', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260825183000_examination_room_professor_access_controls.sql', root), 'utf8'),
  readFile(new URL('worker/exam-results-workbook.mjs', root), 'utf8'),
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const publish = between(frontend, 'async function scheduleExam', 'function localDateValue');
const room = between(frontend, 'function stopProfessorRoomPolling', 'function openReopenSubmission');
const professor = between(frontend, 'function professorExamList', 'function professorClass');
const liveSql = between(migration, 'create or replace function public.exam_room_live_status_v3', 'revoke all on function public.exam_room_live_status_v3');
const pollerSource = between(frontend, 'function stopProfessorRoomPolling', 'async function openLiveStatus');

assert.match(publish, /id="dd26-enter-published-room"/);
assert.match(publish, /enter virtual room/i);
assert.match(publish, /openLiveStatus\(examId, oneTimeKey\)/,
  'the Professor must enter the dedicated room immediately after safely recording the keys');

assert.match(professor, /data-dd26-monitor-exam/);
assert.match(professor, /Enter virtual room/);
assert.doesNotMatch(professor, /classes\[0\]/,
  'the Professor list must not silently open the first examination');

assert.match(room, /Waiting for the Beadle to upload and confirm a valid class list/);
assert.match(room, /Connected and taking/);
assert.match(room, /Not yet present/);
assert.match(room, /Submitted/);
assert.match(room, /Authenticated access and progress/);
assert.match(room, /Access email/);
assert.match(room, /Kick out/);
assert.match(room, /Block/);
assert.match(room, /Unblock/);
assert.match(room, /Grade submitted exams/);
assert.match(room, /Download current workbook/);
assert.match(room, /Back to Professor workspace/);
assert.match(room, /setTimeout/);
assert.doesNotMatch(room, /setInterval/,
  'live-room refresh must be bounded and non-overlapping rather than an interval loop');
assert.match(room, /professorRoomPolling/);
assert.match(room, /generation !== state\.exam\.professorRoomGeneration/);
assert.match(room, /document\.hidden/);
assert.match(between(frontend, 'async function open(view', 'async function queryContent'), /stopProfessorRoomPolling\(\)/,
  'leaving Examination Room must cancel Professor polling');
assert.match(room, /accessPromptIsOpen/);
assert.match(room, /unrelatedDialogIsOpen/,
  'silent refresh must not close or replace an unrelated Professor dialog');
assert.match(frontend, /Recorded subtotal:/);
assert.match(frontend, /Not final/);
assert.match(frontend, /analytics\.submitted > 0 && analytics\.ungraded === 0/,
  'the dashboard can release complete class grades without an open single-student grading workspace');
assert.match(frontend, /grading\?\.examId \|\| reportBeforeRelease\?\.examId/);

assert.match(core, /operation === 'live_status_v3'[\s\S]*optionalCredential/);
const liveProjection = between(routes, 'function liveStatusV2View', 'function projectEvidenceRows');
assert.match(liveProjection, /'rosterEmail', 'accessEmail'/);
assert.doesNotMatch(liveProjection, /answerText|sessionId|deviceInstanceHash/i,
  'the Professor monitor may expose authenticated email but never answers or bearer-like session data');
assert.match(worker, /'exam_room_release_results_v2'/);
assert.match(worker, /'exam_room_prepare_result_export_v4'/);

for (const field of ['accessEmail', 'rosterEmail', 'activeSessionCount', 'accessStatus', 'canKick', 'canBlock', 'canUnblock']) {
  assert.match(liveSql, new RegExp(`'${field}'`));
}
assert.doesNotMatch(liveSql, /answer_snapshot|answerText/i,
  'the live room SQL must remain answer-free');
assert.match(liveSql, /exam_room_verify_grading_access_v3/);
assert.match(migration, /exam_room_control_candidate_access_v1[\s\S]*candidate_session_kicked/);
assert.match(migration, /exam_room_open_session_v4[\s\S]*EXAM_ROOM_ACCESS_BLOCKED/);

assert.match(workbook, /function studentDetailSheet/);
assert.match(workbook, /function uniqueStudentSheetNames/);
assert.match(workbook, /candidates\.length < 1 && dataset\?\.exportScope !== 'offline_grading'/);
assert.match(css, /\.dd26-professor-room\{/);
assert.match(css, /\.dd26-room-spinner\{/);
assert.match(css, /\.dd26-score-disclosure\{/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);

function professorPollerHarness() {
  const timers = [];
  const controls = {
    api: async () => ({ result: { ok: true, examId: 'exam-1', candidates: [] } }),
    dialogOpen: false,
    accessPromptOpen: false,
  };
  const context = vm.createContext({
    controls,
    Date,
    Error,
    Promise,
    String,
    Array,
    Number,
    Math,
    Boolean,
    setTimeout: (callback, delay) => { timers.push({ callback, delay, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
  });
  vm.runInContext(`
    const PROFESSOR_ROOM_REFRESH_MS = 15000;
    const PROFESSOR_ROOM_RETRY_MS = 30000;
    const state = { exam: {
      activeExamId: 'exam-1', monitoring: null,
      professorRoomPollTimer: null, professorRoomPolling: false, professorRoomGeneration: 1,
    } };
    const document = {
      hidden: false,
      getElementById(id) {
        if (id === 'dd26-monitor-key') return controls.accessPromptOpen ? {} : null;
        if (id === 'dd26-dialog') return { open: controls.dialogOpen };
        return null;
      },
    };
    const global = { toast() {} };
    let renderCount = 0;
    let closeCount = 0;
    let promptCount = 0;
    function escapeHtml(value) { return String(value); }
    function openDialog() { promptCount += 1; controls.dialogOpen = true; controls.accessPromptOpen = true; }
    function loadLiveStatus() {}
    function closeDialog() { closeCount += 1; controls.dialogOpen = false; controls.accessPromptOpen = false; }
    function renderLiveStatus() { renderCount += 1; }
    async function api(...args) { return controls.api(...args); }
    ${pollerSource}
    globalThis.poller = {
      state, document, controls,
      refreshProfessorVirtualRoom, stopProfessorRoomPolling, scheduleProfessorRoomRefresh,
      counts: () => ({ renderCount, closeCount, promptCount }),
    };
  `, context);
  return { poller: context.poller, timers };
}

{
  const { poller, timers } = professorPollerHarness();
  let resolveRequest;
  let requestCount = 0;
  poller.controls.api = () => {
    requestCount += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const first = poller.refreshProfessorVirtualRoom({ examId: 'exam-1', generation: 1, silent: true });
  const overlapping = await poller.refreshProfessorVirtualRoom({ examId: 'exam-1', generation: 1, silent: true });
  assert.equal(overlapping, false);
  assert.equal(requestCount, 1, 'a second refresh must not overlap an active request');
  poller.stopProfessorRoomPolling();
  resolveRequest({ result: { ok: true, examId: 'exam-1', candidates: [] } });
  assert.equal(await first, false, 'a response from a cancelled generation must be ignored');
  assert.equal(poller.counts().renderCount, 0);
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0);
}

{
  const { poller, timers } = professorPollerHarness();
  poller.controls.dialogOpen = true;
  const refreshed = await poller.refreshProfessorVirtualRoom({ examId: 'exam-1', generation: 1, silent: true });
  assert.equal(refreshed, true);
  assert.equal(poller.counts().closeCount, 0, 'polling must not close an unrelated dialog');
  assert.equal(poller.counts().renderCount, 0, 'polling must not replace the view behind an unrelated dialog');
  assert.equal(timers.at(-1).delay, 15000);
  poller.document.hidden = true;
  poller.scheduleProfessorRoomRefresh('exam-1', 1, 15000);
  assert.equal(timers.at(-1).delay, 30000, 'hidden tabs use the bounded backoff delay');
}

{
  const { poller, timers } = professorPollerHarness();
  poller.controls.api = async () => { throw new Error('temporary network failure'); };
  const refreshed = await poller.refreshProfessorVirtualRoom({ examId: 'exam-1', generation: 1, silent: true });
  assert.equal(refreshed, false);
  assert.equal(poller.counts().renderCount, 1,
    'a failed refresh keeps the last classroom view visible with a recoverable status');
  assert.equal(timers.at(-1).delay, 30000,
    'a failed refresh must use bounded retry backoff instead of a tight loop');
  poller.stopProfessorRoomPolling();
  assert.ok(timers.every((timer) => timer.cleared), 'leaving the room cancels the pending retry');
}

{
  const { poller, timers } = professorPollerHarness();
  poller.controls.api = async () => ({ result: { ok: false, code: 'GRADING_KEY_REQUIRED' } });
  const refreshed = await poller.refreshProfessorVirtualRoom({ examId: 'exam-1', generation: 1, silent: true });
  assert.equal(refreshed, false);
  assert.equal(poller.counts().promptCount, 1,
    'an unverified Professor receives one deliberate access prompt');
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0,
    'credential denial must stop background polling until the Professor verifies access');
}

console.log('Professor authenticated access, session controls, remembered access, and workbook contracts passed.');
