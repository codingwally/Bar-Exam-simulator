import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  index,
  adminIndex,
  examinationIndex,
  examinationStudent,
  featureLoader,
  forum,
  frontend,
  navigation,
  worker,
  core,
  routes,
  serviceWorker,
  artifactBuilder,
] = await Promise.all([
  read('index.html'),
  read('admin/index.html'),
  read('examination-room/index.html'),
  read('examination-room/student.html'),
  read('assets/feature-loader.js'),
  read('assets/lex-forum.js'),
  read('assets/pedro.js'),
  read('assets/pedro-navigation.js'),
  read('worker/index.mjs'),
  read('worker/pedro-core.mjs'),
  read('worker/pedro-routes.mjs'),
  read('service-worker.js'),
  read('scripts/build-pages-artifact.mjs'),
]);

assert.match(index, /data-quorum-view="home"[\s\S]*data-quorum-view="pedro"[\s\S]*>\s*Pedro\s*</);
assert.match(index, /assets\/profile-photo\.js\?v=profile-photo-release2-20260827-1/);
assert.match(index, /assets\/phase2-config\.js\?v=provider-neutral-release2-20260827-1/);
for (const html of [adminIndex, examinationIndex, examinationStudent]) {
  assert.match(html, /assets\/phase2-config\.js\?v=provider-neutral-release2-20260827-1/);
}
assert.doesNotMatch(
  [index, adminIndex, examinationIndex, examinationStudent].join('\n'),
  /phase2-config\.js\?v=private-maintenance-20260820-2/,
);
assert.match(index, /assets\/pedro-navigation\.js\?v=pedro-release2-20260827-1[\s\S]*DueDiligencePedroNavigation\?\.restoreFromUrl\?\.\(\)/);

assert.match(featureLoader, /'assets\/pedro\.css\?v=pedro-release2-20260827-1'/);
assert.match(featureLoader, /scripts:\s*\[[\s\S]*'assets\/pedro\.js\?v=pedro-release2-20260827-1'[\s\S]*'assets\/lex-forum\.js/);
assert.match(featureLoader, /assets\/examinations\.js\?v=pedro-release2-20260827-1/);
assert.match(featureLoader, /assets\/duediligence-2026\.js\?v=pedro-release2-20260827-1/);
assert.match(forum, /routableViews[\s\S]*'pedro'/);
assert.match(forum, /view === 'pedro'[\s\S]*DueDiligencePedro\.mount/);
assert.match(forum, /previousView === 'pedro'[\s\S]*DueDiligencePedro\?\.unmount/);

assert.match(frontend, /maxlength|input\.maxLength = 1000/i);
assert.match(frontend, /operation: 'bootstrap'/);
assert.match(frontend, /operation: 'resolve_action'|DueDiligencePedroNavigation/);
assert.doesNotMatch(frontend, /gemini|googleai|google\s+generative|generativelanguage/i);
assert.doesNotMatch(frontend, /setAttribute\(['"]href|\.href\s*=|location\.(?:assign|replace)/);

assert.match(navigation, /const ACTION_QUERY = 'pedroAction'/);
assert.match(navigation, /openDoctrines[\s\S]*detailId: action\.target\.contentId/);
assert.match(navigation, /openTargetedQuestion\(action\.target\)/);
assert.match(navigation, /openQuorumMappedQuestion[\s\S]*action\.target\.questionId/);
assert.doesNotMatch(navigation, /target\.url|action\.url|location\.href\s*=/);

assert.match(core, /PEDRO_OUTSIDE_SCOPE = 'I can only help you with due diligence website\.'/);
assert.match(core, /doctrine:\s*'Open Doctrine Review'/);
assert.match(core, /syllabus:\s*'Open Syllabus-Based Review'/);
assert.match(core, /mock_bar:\s*'Open Bar Question Practice'/);
assert.doesNotMatch(`${core}\n${routes}`, /gemini|googleai|generativelanguage/i);

assert.match(worker, /pathname === '\/pedro\/message'/);
assert.match(worker, /pathname === '\/pedro\/query'/);
assert.match(worker, /createPedroHandlers\(\{/);
assert.match(worker, /PEDRO_SYLLABUS_ACTIVE_ATTEMPT[\s\S]*code = 'PEDRO_ACTIVE_ATTEMPT'/);
assert.match(worker, /PEDRO_THREAD_INVALID[\s\S]*code = 'PEDRO_THREAD_INVALID'/);
assert.match(worker, /PEDRO_HISTORY_CURSOR_INVALID[\s\S]*code = 'PEDRO_HISTORY_CURSOR_INVALID'/);
assert.match(worker, /callGeminiStructured\([\s\S]*\{ quiet: true \}/);
assert.match(worker, /return \{ result: generated\.result \}/);
assert.doesNotMatch(worker, /pedroHandlers[\s\S]{0,900}generated\.model/);

assert.match(
  serviceWorker,
  /CACHE_VERSION = 'duediligence-shell-20260901-bar-forecast-exam-tools-5'/,
);
assert.match(serviceWorker, /assets\/pedro-navigation\.js\?v=pedro-release2-20260827-1/);
assert.match(serviceWorker, /assets\/phase2-config\.js\?v=provider-neutral-release2-20260827-1/);
for (const asset of [
  'assets/profile-photo.js',
  'assets/pedro-navigation.js',
  'assets/pedro.css',
  'assets/pedro.js',
]) {
  assert.match(artifactBuilder, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('Pedro Release 2 integration contracts passed.');
