const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const studentScript = fs.readFileSync(path.join(__dirname, 'student.js'), 'utf8');
const studentHtml = fs.readFileSync(path.join(__dirname, 'student.html'), 'utf8');

test('student registers the Examination Room service worker without blocking startup', () => {
  assert.match(studentScript, /serviceWorker\.register\('\/service-worker\.js\?v=examination-room-v1-20260826-1'\)/);
  assert.match(studentScript, /\.catch\(function \(\) \{/);
});

test('service worker precaches the complete local student examination shell', () => {
  [
    '/examination-room/student.html',
    '/examination-room/student.css',
    '/examination-room/view-models.js?v=greenfield-v1-20260826-1',
    '/examination-room/api.js?v=greenfield-v1-20260826-5',
    '/examination-room/student.js?v=greenfield-v1-20260826-3',
    '/assets/phase2-config.js?v=greenfield-examination-room-v1-20260826-2',
    '/assets/private-beta-session.js?v=beta-all-access-20260802-1',
  ].forEach((asset) => assert.ok(serviceWorker.includes(`'${asset}'`), `${asset} is cached`));

  assert.ok(studentHtml.includes('student.js?v=greenfield-v1-20260826-3'));
  assert.ok(studentHtml.includes('api.js?v=greenfield-v1-20260826-5'));
  assert.ok(studentHtml.includes('phase2-config.js?v=greenfield-examination-room-v1-20260826-2'));
});

test('offline student navigation uses its cached application before the generic offline page', () => {
  const examBranch = serviceWorker.indexOf("if (url.pathname === EXAMINATION_STUDENT_SHELL)");
  const cachedStudent = serviceWorker.indexOf("caches.match(EXAMINATION_STUDENT_SHELL)", examBranch);
  const genericOffline = serviceWorker.indexOf("caches.match('/offline.html')", cachedStudent);

  assert.ok(examBranch >= 0);
  assert.ok(cachedStudent > examBranch);
  assert.ok(genericOffline > cachedStudent);
});
