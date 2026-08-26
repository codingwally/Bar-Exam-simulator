import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, experience, phase2Css, shellCss, api, admin, adminShell, serviceWorker, icon] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/phase2.css', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('examination-room/api.js', root), 'utf8'),
  readFile(new URL('admin/examination-room-admin.js', root), 'utf8'),
  readFile(new URL('admin/admin.js', root), 'utf8'),
  readFile(new URL('service-worker.js', root), 'utf8'),
  readFile(new URL('assets/icons/navigation/door-open.svg', root), 'utf8'),
]);

const navigation = html.match(/<nav class="spa-nav quorum-primary-nav" id="spa-nav"[\s\S]*?<\/nav>/)?.[0] || '';
assert.match(
  navigation,
  /id="header-account-control"[\s\S]*id="spa-examination-room"[^>]*data-dd2-view="examination-room"[\s\S]*id="spa-pricing"/,
  'Examination Room must be a main-menu item directly after Profile.',
);
assert.equal((navigation.match(/id="spa-examination-room"/g) || []).length, 1);
assert.match(shellCss, /#spa-examination-room\s*\{[\s\S]*door-open\.svg/);

assert.match(experience, /function examinationRoomContent\(\)/);
assert.match(experience, /id="dd2-professor-door"[^>]*disabled[^>]*aria-disabled="true"/);
assert.match(experience, /id="dd2-student-door"[^>]*href="\/examination-room\/student\.html"/);
assert.match(experience, /id="dd2-examination-room-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(experience, /id="dd2-professor-institution"/);
assert.match(experience, /EXAM_ROOM_V1_INSTITUTION_SELECTION_REQUIRED/);
assert.match(experience, /error\?\.details\?\.institutions/);
assert.match(experience, /navigator\.onLine/);
assert.match(experience, /id="dd2-professor-door-retry"/);
assert.match(experience, /request !== state\.examinationRoomDoorRequest/);
assert.match(experience, /token !== state\.session\?\.access_token/);
assert.match(experience, /addEventListener\('duediligence:session'/);
assert.match(experience, /addEventListener\('online'/);
assert.match(experience, /showEntry\(\{ allowDismiss: true, returnHash: '#examination-room' \}\)/);
assert.match(experience, /<option value="professor">Professor<\/option>/);
assert.match(experience, /p_category:\s*category/);
assert.match(experience, /commercial_category:\s*category/);
assert.doesNotMatch(experience, /function hasProfessorProfileRole\(/);
assert.match(experience, /signed-in account can create and manage its own examinations/i);
assert.match(experience, /Admin approval is needed only before a room key is issued/i);
assert.doesNotMatch(experience, /operation: 'role_status'/);
assert.doesNotMatch(experience, /operation: 'request_access'/);
assert.doesNotMatch(experience, /Professor role required/i);
assert.doesNotMatch(experience, /requestProfessorSchoolActivation/);

assert.match(
  experience,
  /nativeWorkerRequest\('\/examination-room\/v1\/professor\/query'[\s\S]*operation: 'session'/,
  'The Professor door must use the signed-in server route.',
);
assert.match(experience, /if \(!token \|\| !state\.user\)/);
assert.doesNotMatch(experience, /if \(!hasProfessorProfileRole\(\)/);
assert.match(admin, /activate_exam/);
assert.match(admin, /approveAndEmail/);
assert.match(
  adminShell,
  /const founderOnly = \[[^\]]*'examination_room_v1'[^\]]*\]/,
  'The Examination Room command center must be visible only to Founder and Super Admin owners.',
);
assert.doesNotMatch(
  adminShell,
  /examination_room_v1:\s*'role_admin'/,
  'Ordinary delegated role administrators must not gain Examination Room command-center access.',
);

assert.match(api, /function staffPayload\(payload = \{\}\)/);
assert.match(api, /URLSearchParams[^\n]*\.get\('institution'\)/);
assert.match(api, /payload: staffPayload\(payload\)/);
assert.match(api, /this\.details = details/);
assert.match(api, /error\.details \|\| null/);

assert.match(phase2Css, /data-native-view="examination-room"/);
assert.match(phase2Css, /\.dd2-examination-door-grid/);
assert.match(phase2Css, /grid-template-columns:\s*repeat\(2/);
assert.match(phase2Css, /@media \(max-width: 820px\)[\s\S]*\.dd2-examination-door-grid \{ grid-template-columns: 1fr; \}/);
assert.doesNotMatch(phase2Css.match(/\.dd2-native-view\[data-native-view="examination-room"\][\s\S]*?body\.dd2-locked/)?.[0] || '', /linear-gradient|radial-gradient/);

assert.match(serviceWorker, /\/assets\/icons\/navigation\/door-open\.svg/);
assert.match(serviceWorker, /phase2-experience\.js\?v=syllabus-reveal-p0-20260826-2-examination-room-3/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=examination-room-doors-20260826-2/);
assert.match(icon, /viewBox="0 0 24 24"/);
assert.match(icon, /M11 4\.562v16\.157/);

console.log('Examination Room virtual-door menu and authorization boundaries passed.');
