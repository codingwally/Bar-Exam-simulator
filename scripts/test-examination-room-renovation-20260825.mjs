import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8');

const [
  frontend,
  loader,
  renovationCss,
  renovationScript,
  store,
  routes,
  workerEntry,
  migration,
  indexMigration,
  buildScript,
] = await Promise.all([
  read('assets/duediligence-2026.js'),
  read('assets/feature-loader.js'),
  read('assets/examination-room-renovation.css'),
  read('assets/examination-room-renovation.js'),
  read('assets/examination-room-2-store.js'),
  read('worker/duediligence-2026-routes.mjs'),
  read('worker/index.mjs'),
  read('supabase/migrations/20260825183000_examination_room_professor_access_controls.sql'),
  read('supabase/migrations/20260825184500_examination_room_professor_access_control_indexes.sql'),
  read('scripts/build-pages-artifact.mjs'),
]);

const entryStart = frontend.indexOf('function examEntry()');
const entryEnd = frontend.indexOf('function bindExamEntry()', entryStart);
assert.ok(entryStart >= 0 && entryEnd > entryStart, 'the Examination Room entry function must remain discoverable');
const entry = frontend.slice(entryStart, entryEnd);
assert.match(entry, /\['professor', 'Professor'/);
assert.match(entry, /\['student', 'Student'/);
assert.doesNotMatch(entry, /\['(?:beadle|exam_administrator)'/,
  'the public Examination Room entry presents only Professor and Student');
assert.match(entry, /authenticated email used to enter the examination/);
assert.match(entry, /end a live session or block re-entry/);
assert.match(entry, /Camera collection is off/);

const studentPortalStart = frontend.indexOf('function studentSection(portal)');
const studentPortalEnd = frontend.indexOf('function activationSection(portal)', studentPortalStart);
assert.ok(studentPortalStart >= 0 && studentPortalEnd > studentPortalStart,
  'the Student entry surface must remain discoverable');
const studentPortal = frontend.slice(studentPortalStart, studentPortalEnd);
assert.match(studentPortal, /Clipboard and right-click remain available/);
assert.doesNotMatch(studentPortal, /copy, cut, paste, and right-click are blocked/,
  'the Student entry surface must describe the current clipboard policy truthfully');

assert.match(frontend, /operation: 'live_status_v3'/);
for (const operation of ['kick_candidate', 'block_candidate', 'unblock_candidate']) {
  assert.match(routes, new RegExp(`'${operation}'`));
}
for (const rpc of [
  'exam_room_control_candidate_access_v1',
  'exam_room_live_status_v3',
  'exam_room_open_session_v4',
]) {
  assert.match(workerEntry, new RegExp(`'${rpc}'`),
    `${rpc} must be admitted by the Worker's final RPC allowlist`);
}
for (const action of ['kick', 'block', 'unblock']) {
  assert.match(frontend, new RegExp(`data-dd26-access-action="${action}"`));
}
assert.match(frontend, /operation: `\$\{action\}_candidate`/);
for (const field of ['accessEmail', 'rosterEmail', 'accessStatus', 'activeSessionCount']) {
  assert.match(frontend, new RegExp(field));
  assert.match(routes, new RegExp(field));
}

const liveProjectionStart = routes.indexOf('function liveStatusV2View');
const liveProjectionEnd = routes.indexOf('\n}', liveProjectionStart) + 2;
const liveProjection = routes.slice(liveProjectionStart, liveProjectionEnd);
assert.doesNotMatch(liveProjection, /answerText|sessionId|sessionEpoch|deviceInstanceHash/,
  'the Professor live roster must not expose answers or session credentials');

assert.match(migration, /create table if not exists public\.exam_room_candidate_access_controls/);
assert.match(migration, /create or replace function public\.exam_room_control_candidate_access_v1/);
assert.match(migration, /create or replace function public\.exam_room_open_session_v4/);
assert.match(migration, /create or replace function public\.exam_room_live_status_v3/);
assert.match(migration, /'accessEmail',[\s\S]*lower\(account\.email\)/);
assert.match(migration, /'accessStatus',[\s\S]*coalesce\(control\.status, 'allowed'\)/);
assert.match(migration, /revoke all privileges on table public\.exam_room_candidate_access_controls\s+from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.exam_room_live_status_v3[\s\S]*to service_role/);
for (const indexName of [
  'exam_room_candidate_access_roster_idx',
  'exam_room_candidate_access_blocked_by_idx',
  'exam_room_candidate_access_last_kicked_by_idx',
]) {
  assert.match(indexMigration, new RegExp(indexName));
}
assert.doesNotMatch(indexMigration, /bar_simulation|question_rotation|subject_matter/i);

assert.match(frontend, /allowUncoordinatedWrite: false/);
assert.doesNotMatch(frontend, /lease\.readonly\s*=\s*false/);
assert.match(store, /async function saveQuestionFlags[\s\S]*attemptKey: attemptKey\(scope\)[\s\S]*async function getQuestionFlags[\s\S]*record\.attemptKey !== attemptKey\(scope\)/,
  'question flags must remain attempt-scoped across authorized session changes');
assert.match(frontend, /clipboardBlocked: false/);
assert.match(frontend, /Clipboard and right-click remain available/);
assert.match(frontend, /const integrityCopy = integrityRow\?\.querySelector\('span'\)/);
assert.match(frontend, /integrityCopy\.textContent = integrity\.recordingEnabled/);

const examinationManifestStart = loader.indexOf('examinationRoom: Object.freeze');
const examinationManifestEnd = loader.indexOf('\n    }),', examinationManifestStart) + 7;
const examinationManifest = loader.slice(examinationManifestStart, examinationManifestEnd);
assert.match(examinationManifest, /assets\/examination-room-renovation\.css/);
assert.match(examinationManifest, /assets\/examination-room-renovation\.js/);
assert.equal(loader.match(/assets\/examination-room-renovation\.css/g)?.length, 1,
  'the renovation stylesheet is loaded by only one feature manifest');
assert.equal(loader.match(/assets\/examination-room-renovation\.js/g)?.length, 1,
  'the renovation script is loaded by only one feature manifest');
assert.match(buildScript, /assets\/examination-room-renovation\.css/);
assert.match(buildScript, /assets\/examination-room-renovation\.js/);

assert.match(renovationScript, /const ROUTE = '#examination-room'/);
assert.match(renovationScript, /startsWith\(ROUTE\)/);
assert.match(renovationScript, /classList\.toggle\('dd26-examination-room-active', active\)/);
assert.match(renovationCss, /body\.dd26-examination-room-active/);
assert.match(renovationCss, /--dd26-paper: #f4efe5/);
assert.match(renovationCss, /--dd26-navy: #0b243d/);
assert.match(renovationCss, /--dd26-gold: #aa8136/);
assert.match(renovationCss, /font-family: 'Times New Roman', Times, serif/);
assert.match(renovationCss, /border-radius: 50%/,
  'the question navigator retains a circular, scannable target');
assert.match(renovationCss, /\.dd26-choice strong[\s\S]*color: var\(--dd26-navy\)/,
  'choice-card labels retain readable navy contrast on the light renovation surface');
assert.match(renovationCss, /\.dd26-choice small[\s\S]*color: var\(--dd26-muted\)/,
  'choice-card supporting copy retains readable contrast');

const simulatorFiles = new Map([
  ['index.html', '4b7e16c8fceba1b88fdd69163ca0012a69101d88'],
  ['assets/examinations.js', 'facd79383f5fa51d02cfd41e89d4a30d911fd151'],
  ['assets/examinations.css', '4ec3bc402d140bc1cfeedff538f97b4f535a4705'],
  ['assets/exam-session-controller.js', '9360c0d0f5bceb8dfd71570a3f5258a98a89c78e'],
]);
for (const [relativePath, expectedBlob] of simulatorFiles) {
  const actualBlob = execFileSync('git', ['hash-object', '--', relativePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(actualBlob, expectedBlob, `${relativePath} must remain byte-for-byte outside this renovation`);
}

console.log('Examination Room renovation isolation, access-control, and presentation contracts passed.');
