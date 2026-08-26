import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, experience, phase2Css, shellCss, api, admin, serviceWorker, icon] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/phase2.css', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('examination-room/api.js', root), 'utf8'),
  readFile(new URL('admin/examination-room-admin.js', root), 'utf8'),
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
assert.match(experience, /function hasProfessorProfileRole\(\)[\s\S]*commercial_category === 'professor'/);
assert.match(experience, /professorRole \? 'Professor Examination Room' : 'Examination Room'/);
assert.match(experience, /operation: 'role_status'/);
assert.match(experience, /operation: 'request_access'/);
assert.match(experience, /role\?\.professorRoleSelected !== true \|\| role\?\.declarationOnFile !== true/);
assert.match(experience, /Change school request/);
assert.match(experience, /the prior request will be safely replaced/);

assert.match(
  experience,
  /nativeWorkerRequest\('\/examination-room\/v1\/professor\/query'[\s\S]*operation: 'session'/,
  'The Professor door must use the authenticated server route.',
);
assert.doesNotMatch(
  experience,
  /commercial_category\s*===\s*['"]professor['"][\s\S]{0,240}(?:authorized|dataset\.destination|location\.assign)/,
  'The self-selected profile category must never authorize the Professor door.',
);
assert.match(experience, /a school administrator still activates access to that school's protected examinations/i);
assert.match(experience, /Ask an Examination Room administrator to activate your professor assignment/);
assert.match(admin, /professorRequests/);
assert.match(admin, /adminCommand\('assign_staff'/);
assert.match(admin, /staffRole:\s*'professor'/);
assert.match(admin, /adminCommand\('reject_professor_request'/);

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
assert.match(serviceWorker, /phase2-experience\.js\?v=syllabus-reveal-access-20260826-1/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=examination-room-doors-20260826-2/);
assert.match(icon, /viewBox="0 0 24 24"/);
assert.match(icon, /M11 4\.562v16\.157/);

console.log('Examination Room virtual-door menu and authorization boundaries passed.');
