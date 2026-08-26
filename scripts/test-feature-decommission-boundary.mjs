import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const activeRuntimeFiles = Object.freeze([
  'index.html',
  'offline.html',
  'admin/index.html',
  'admin/admin.css',
  'admin/admin.js',
  'assets/feature-loader.js',
  'assets/duediligence-2026.js',
  'assets/duediligence-2026.css',
  'assets/private-beta-landing.js',
  'assets/private-beta-landing.css',
  'assets/phase2-config.js',
  'assets/phase2-experience.js',
  'assets/phase4-experience.js',
  'assets/quorum-first-shell.css',
  'scripts/build-pages-artifact.mjs',
  'worker/duediligence-2026-core.mjs',
  'worker/duediligence-2026-routes.mjs',
  'worker/index.mjs',
  'worker/wrangler.toml',
  'worker/wrangler.staging.toml',
]);

const deletedFiles = Object.freeze([
  'assets/examination-room-2-store.js',
  'assets/examination-room-renovation.js',
  'assets/examination-room-renovation.css',
  'assets/examination-room-beadle-class-list-template.xlsx',
  'assets/feature-previews/examination-room.png',
  'content/duediligence-2026/exam-room-schema.json',
  'worker/exam-room-2026-core.mjs',
  'worker/exam-room-delivery.mjs',
  'worker/exam-room-student-code-envelope.mjs',
  'worker/exam-result-pdf.mjs',
  'worker/exam-results-workbook.mjs',
]);

for (const file of deletedFiles) {
  await assert.rejects(
    access(new URL(file, root)),
    (error) => error?.code === 'ENOENT',
  `${file} must remain deleted`,
  );
}

for (const file of activeRuntimeFiles) {
  const source = await readFile(new URL(file, root), 'utf8');
  for (const legacyPath of deletedFiles) {
    assert.equal(
      source.includes(legacyPath) || source.includes(legacyPath.split('/').at(-1)),
      false,
      `${file} must not import or reference retired implementation ${legacyPath}`,
    );
  }
}

const greenfieldFiles = Object.freeze([
  'examination-room/index.html',
  'examination-room/professor.css',
  'examination-room/professor.js',
  'examination-room/student.html',
  'examination-room/student.css',
  'examination-room/student.js',
  'examination-room/api.js',
  'examination-room/view-models.js',
  'admin/examination-room-admin.css',
  'admin/examination-room-admin.js',
  'assets/icons/navigation/door-open.svg',
  'worker/examination-room-v1-routes.mjs',
]);

for (const file of greenfieldFiles) await access(new URL(file, root));

const greenfieldClient = await readFile(new URL('examination-room/api.js', root), 'utf8');
const greenfieldWorker = await readFile(new URL('worker/examination-room-v1-routes.mjs', root), 'utf8');
assert.match(greenfieldClient, /\/examination-room\/v1\/professor\/query/);
assert.match(greenfieldWorker, /EXAMINATION_ROOM_V1_PATHS/);

const simulatorFiles = Object.freeze([
  'assets/exam-session-controller.js',
  'assets/examinations.js',
  'assets/examinations.css',
  'worker/examinations-core.mjs',
]);

for (const file of simulatorFiles) await access(new URL(file, root));

const examinationsFrontend = await readFile(new URL('assets/examinations.js', root), 'utf8');
const examinationsWorker = await readFile(new URL('worker/index.mjs', root), 'utf8');
assert.match(examinationsFrontend, /\/examinations\/(?:query|command)/);
assert.match(examinationsFrontend, /DueDiligenceExaminations/);
assert.match(examinationsWorker, /pathname === '\/examinations\/query'/);
assert.match(examinationsWorker, /pathname === '\/examinations\/command'/);
assert.match(examinationsWorker, /pathname === '\/examinations\/upload'/);

// Applied migrations are an immutable environment ledger. Keeping them prevents
// local/remote history drift; they are not a callable application surface.
await access(new URL(
  'supabase/migrations/20260811002600_examination_room_foundation.sql',
  root,
));
await access(new URL(
  'supabase/migrations/20260825184500_examination_room_professor_access_control_indexes.sql',
  root,
));

console.log('Retired feature runtime is absent and Simulator boundaries remain intact.');
