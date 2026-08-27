import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [
  html,
  experience,
  phase2Config,
  phase2Css,
  shellCss,
  featureLoader,
  api,
  workerRoutes,
  creatorMigration,
  openAdmissionMigration,
  admin,
  adminShell,
  adminCss,
  serviceWorker,
  icon,
] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/phase2-config.js', root), 'utf8'),
  readFile(new URL('assets/phase2.css', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('examination-room/api.js', root), 'utf8'),
  readFile(new URL('worker/examination-room-v1-routes.mjs', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260826130536_examination_room_owner_command_center.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260827010000_examination_room_open_admission_flow.sql', root), 'utf8'),
  readFile(new URL('admin/examination-room-admin.js', root), 'utf8'),
  readFile(new URL('admin/admin.js', root), 'utf8'),
  readFile(new URL('admin/admin.css', root), 'utf8'),
  readFile(new URL('service-worker.js', root), 'utf8'),
  readFile(new URL('assets/icons/navigation/door-open.svg', root), 'utf8'),
]);

const navigation = html.match(/<nav class="spa-nav quorum-primary-nav" id="spa-nav"[\s\S]*?<\/nav>/)?.[0] || '';
const headerMemberTools = html.match(/<div class="dd2-header-member-tools" id="dd2-header-member-tools"[\s\S]*?<\/div>/)?.[0] || '';
assert.match(
  navigation,
  /id="header-account-control"[\s\S]*id="spa-examination-room"[^>]*data-dd2-view="examination-room"[\s\S]*id="spa-pricing"/,
  'Examination Room must be a main-menu item directly after Profile.',
);
assert.equal((navigation.match(/id="spa-examination-room"/g) || []).length, 1);
assert.match(
  headerMemberTools,
  /id="dd2-header-role-button"[^>]*>[\s\S]*?<\/button>\s*<button class="dd2-header-exam-button" id="dd2-header-exam-button"[^>]*data-dd2-view="examination-room"/,
  'The visible Examination Room shortcut must sit immediately beside the signed-in Role control.',
);
assert.match(html, /phase2-experience\.js\?v=profile-photo-release2-20260827-1&amp;baseline=syllabus-reveal-p0-20260826-2-examination-room-3/);
assert.match(phase2Config, /examinationRoom:\s*true/);
assert.match(shellCss, /#spa-examination-room\s*\{[\s\S]*door-open\.svg/);

assert.match(experience, /function examinationRoomContent\(\)/);
assert.match(experience, /id="dd2-professor-door"[^>]*disabled[^>]*aria-disabled="true"/);
assert.match(experience, /id="dd2-student-door"[^>]*href="\/examination-room\/student\.html"/);
assert.match(experience, /id="dd2-examination-room-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(experience, /id="dd2-professor-door-retry"/);
assert.match(experience, /addEventListener\('duediligence:session'/);
assert.match(experience, /showEntry\(\{ allowDismiss: true, returnHash: '#examination-room' \}\)/);
assert.match(experience, /<option value="professor">Professor<\/option>/);
assert.match(experience, /p_category:\s*category/);
assert.match(experience, /commercial_category:\s*category/);
assert.doesNotMatch(experience, /function hasProfessorProfileRole\(/);
assert.match(experience, /signed-in account can create and manage its own examinations/i);
assert.match(experience, /Admin is involved only after you publish and request the student key/i);
assert.doesNotMatch(experience, /operation: 'role_status'/);
assert.doesNotMatch(experience, /operation: 'request_access'/);
assert.doesNotMatch(experience, /Professor role required/i);
assert.doesNotMatch(experience, /requestProfessorSchoolActivation/);

assert.match(experience, /if \(!token \|\| !state\.user\)/);
assert.match(experience, /the Professor workspace is ready[\s\S]*Create and save without approval/);
assert.match(experience, /button\.dataset\.destination = professorDoorDestination\(institutionId\)/);
assert.doesNotMatch(experience, /id="dd2-professor-institution"|EXAM_ROOM_V1_INSTITUTION_SELECTION_REQUIRED|select-institution/);
assert.doesNotMatch(experience, /if \(!hasProfessorProfileRole\(\)/);

const professorDoorCheck = experience.slice(
  experience.indexOf("async function checkProfessorDoor(institutionId = '')"),
  experience.indexOf('function activateProfessorDoor()'),
);
assert.match(professorDoorCheck, /if \(!token \|\| !state\.user\)/);
assert.doesNotMatch(
  professorDoorCheck,
  /nativeWorkerRequest|navigator\.onLine|hasProfessorProfileRole|role_status|request_access|PROFESSOR_FORBIDDEN|license|membership|assignment/iu,
  'Signed-in state must be the only Professor-door UI gate.',
);

assert.doesNotMatch(
  featureLoader,
  /examination-room|professor/iu,
  'Examination Room must not be routed through paid-feature or profile-role loader guards.',
);

const apiPost = api.slice(api.indexOf('async function post('), api.indexOf('async function professorQuery('));
assert.match(apiPost, /options\.auth === true && !session\?\.access_token/);
assert.doesNotMatch(apiPost, /license|membership|assignment|profile role/iu);

const professorContext = workerRoutes.slice(
  workerRoutes.indexOf('async function professorContext('),
  workerRoutes.indexOf('async function adminContext('),
);
assert.match(professorContext, /if \(!user\?\.id\)/);
assert.match(professorContext, /selectCreatorInstitution\(authorization, requestedInstitutionId\)/);
assert.doesNotMatch(
  professorContext,
  /authorizationAllowed|CREATOR_WORKSPACE_REQUIRED|PROFESSOR_FORBIDDEN|license|membership|assignment/iu,
  'Worker Professor routes must require a verified session, not a Professor assignment.',
);
assert.match(workerRoutes, /COMMUNITY_CREATOR_INSTITUTION_ID = 'ddc00000-0000-4000-8000-000000000001'/);

const creatorAuthorizationSql = creatorMigration.slice(
  creatorMigration.indexOf('create or replace function examination_room_v1.creator_authorized('),
  creatorMigration.indexOf('create or replace function examination_room_v1.validate_exam_owner()'),
);
assert.match(creatorAuthorizationSql, /from auth\.users auth_user where auth_user\.id = p_actor_user_id/);
assert.doesNotMatch(creatorAuthorizationSql, /staff_memberships|professor_license_declarations/);
assert.match(openAdmissionMigration, /'due-diligence-community'/);
assert.match(openAdmissionMigration, /Every verified auth user has an active Due Diligence Community workspace; no Professor profile or staff membership is required\./);
assert.match(openAdmissionMigration, /'save_draft', 'publish', 'open_room'/);

const openCreatorAuthorizationSql = openAdmissionMigration.slice(
  openAdmissionMigration.indexOf('create or replace function examination_room_v1.creator_authorized('),
  openAdmissionMigration.indexOf('comment on function examination_room_v1.creator_authorized(uuid, uuid)'),
);
assert.match(openCreatorAuthorizationSql, /from auth\.users auth_user where auth_user\.id = p_actor_user_id/);
assert.match(openCreatorAuthorizationSql, /institution\.institution_code = 'due-diligence-community'/);
assert.doesNotMatch(
  openCreatorAuthorizationSql,
  /commercial_category\s*=\s*'professor'|professor_license_declarations|professorRoleSelected/iu,
  'The current database creator policy must give every verified account the Community workspace without a Professor role or license.',
);
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
assert.match(adminShell, /const isExaminationRoom = section === 'examination_room_v1'/);
assert.match(adminShell, /rangeControl\.hidden = isExaminationRoom/);
assert.match(adminShell, /exportButton\.hidden = isExaminationRoom/);
assert.match(adminShell, /refreshButton\.hidden = isExaminationRoom/);
assert.match(adminShell, /systemBanner\.hidden = isExaminationRoom/);
assert.match(adminCss, /#reporting-range\[hidden\][\s\S]*#refresh-dashboard\[hidden\][\s\S]*#download-current-section\[hidden\][\s\S]*#system-banner\[hidden\][\s\S]*display:\s*none\s*!important/);

assert.match(api, /function staffPayload\(payload = \{\}\)/);
assert.match(api, /URLSearchParams[^\n]*\.get\('institution'\)/);
assert.match(api, /payload: staffPayload\(payload\)/);
assert.match(api, /this\.details = details/);
assert.match(api, /error\.details \|\| null/);

assert.match(phase2Css, /data-native-view="examination-room"/);
assert.match(phase2Css, /\.dd2-header-member-tools\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*8px;/s);
assert.match(phase2Css, /\.dd2-header-exam-button\s*\{[^}]*background:\s*linear-gradient\(135deg, #ead17d, #c79c43\);/s);
assert.match(phase2Css, /\.dd2-examination-door-grid/);
assert.match(phase2Css, /grid-template-columns:\s*repeat\(2/);
assert.match(phase2Css, /@media \(max-width: 820px\)[\s\S]*\.dd2-examination-door-grid \{ grid-template-columns: 1fr; \}/);
assert.doesNotMatch(phase2Css.match(/\.dd2-native-view\[data-native-view="examination-room"\][\s\S]*?body\.dd2-locked/)?.[0] || '', /linear-gradient|radial-gradient/);

assert.match(serviceWorker, /\/assets\/icons\/navigation\/door-open\.svg/);
assert.match(serviceWorker, /phase2-experience\.js\?v=profile-photo-release2-20260827-1&baseline=syllabus-reveal-p0-20260826-2-examination-room-3/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=profile-photo-release2-20260827-1&baseline=public-reliability-20260827-2/);
assert.match(icon, /viewBox="0 0 24 24"/);
assert.match(icon, /M11 4\.562v16\.157/);

console.log('Examination Room virtual-door menu and authorization boundaries passed.');
