import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, '.pages-dist');

if (path.dirname(outputRoot) !== repositoryRoot || path.basename(outputRoot) !== '.pages-dist') {
  throw new Error('Refusing to build outside the repository .pages-dist directory.');
}

const featurePreviewFiles = Object.freeze([
  'anchor-cases.png',
  'bar-easy.png',
  'bar-feels.png',
  'chairs-cases.png',
  'doctrines.png',
  'mock-bar.png',
  'quorum.png',
  'retainer.png',
  'subject-matter.png',
  'verdict.png',
].map((name) => `assets/feature-previews/${name}`));

const communityIconFiles = Object.freeze([
  'thumbs-up.svg',
  'chat-circle.svg',
  'share-fat.svg',
  'bookmark-simple.svg',
  'camera.svg',
  'paper-plane-tilt.svg',
  'magnifying-glass.svg',
  'arrows-clockwise.svg',
  'eye-slash.svg',
  'caret-right.svg',
  'x.svg',
  'dots-three.svg',
  'LICENSE.txt',
].map((name) => `assets/icons/community/${name}`));

const navigationIconFiles = Object.freeze([
  'house.svg',
  'layout-grid.svg',
  'file-text.svg',
  'bookmark.svg',
  'users.svg',
  'bell.svg',
  'book-open.svg',
  'compass.svg',
  'book-open-check.svg',
  'pen-line.svg',
  'timer.svg',
  'circle-user-round.svg',
  'door-open.svg',
  'tag.svg',
  'headphones.svg',
  'LICENSE.txt',
].map((name) => `assets/icons/navigation/${name}`));

const publicFiles = Object.freeze([
  'index.html',
  'CNAME',
  'favicon.svg',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'admin/index.html',
  'admin/admin.css',
  'admin/admin-observatory.css',
  'admin/admin.js',
  'admin/examination-room-admin.css',
  'admin/examination-room-admin.js',
  'admin/subscription-actions-core.js',
  'assets/exam-session-controller.js',
  'assets/phase2-config.js',
  'assets/maintenance-gate.js',
  'assets/auth-session-storage.js',
  'assets/private-beta-session.js',
  'assets/private-beta-landing.css',
  'assets/due-diligence-controls.css',
  'assets/quorum-first-shell.css',
  'assets/quorum-first-shell.js',
  'assets/private-beta-landing.js',
  'assets/feature-loader.js',
  'assets/private-workspace.js',
  'examination-room/index.html',
  'examination-room/professor.css',
  'examination-room/professor.js',
  'examination-room/student.html',
  'examination-room/student.css',
  'examination-room/student.js',
  'examination-room/offline-grading.html',
  'examination-room/offline-grading.css',
  'examination-room/offline-grading.js',
  'examination-room/offline-grading-core.js',
  'examination-room/api.js',
  'examination-room/view-models.js',
  ...featurePreviewFiles,
  ...communityIconFiles,
  ...navigationIconFiles,
  'assets/phase2-experience.js',
  'assets/profile-photo.js',
  'assets/pedro-navigation.js',
  'assets/pedro.css',
  'assets/pedro.js',
  'assets/phase2.css',
  'assets/phase3-analytics.js',
  'assets/phase4-experience.js',
  'assets/examinations.css',
  'assets/examinations.js',
  'assets/auxiliary-writing-diagnostics.css',
  'assets/auxiliary-writing-diagnostics.js',
  'assets/study-workspace.css',
  'assets/study-workspace.js',
  'assets/brand/apple-touch-icon.png',
  'assets/brand/favicon.ico',
  'assets/brand/favicon-16.png',
  'assets/brand/favicon-32.png',
  'assets/brand/favicon-48.png',
  'assets/brand/icon-192.png',
  'assets/brand/icon-512.png',
  'assets/brand/logo1-master.png',
  'assets/brand/social-card-1200x630.png',
  'assets/brand/signin-intro.mp4',
  'assets/admin/judicial-observatory-bg.png',
  'assets/duediligence-2026.css',
  'assets/duediligence-2026.js',
  'assets/lex-forum.css',
  'assets/lex-forum.js',
  'assets/payments/bpi-instapay-149.png',
  'offline.html',
  'service-worker.js',
]);

const qrHashes = Object.freeze({
  'assets/payments/bpi-instapay-149.png':
    '00DF8567B0068B980D2135BCC74DD2963E8398AE472209E9C84F89F6B0F3C1B9',
});

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function copyPublicFile(relativePath) {
  const source = path.join(repositoryRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  if (!(await stat(source)).isFile()) {
    throw new Error(`Public artifact source is not a file: ${relativePath}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Public artifact contains an unsupported filesystem entry: ${relative}`);
    }
  }
  return files.sort();
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await Promise.all(publicFiles.map(copyPublicFile));
await writeFile(path.join(outputRoot, '.nojekyll'), '', 'utf8');

for (const [relativePath, expectedHash] of Object.entries(qrHashes)) {
  const actualHash = sha256(await readFile(path.join(outputRoot, relativePath)));
  if (actualHash !== expectedHash) {
    throw new Error(`${relativePath} does not match the approved payment QR pixels.`);
  }
}

const files = await listFiles(outputRoot);
const forbidden = files.filter((file) => (
  /(^|\/)(content|worker|supabase|scripts|docs|node_modules|\.git)(\/|$)/i.test(file)
  || /\.(json|sql|mjs|csv)$/i.test(file)
));
if (forbidden.length) {
  throw new Error(`Private repository material entered the Pages artifact: ${forbidden.join(', ')}`);
}

const textFiles = files.filter((file) => /\.(?:html|js|css|svg|txt)$/i.test(file));
const searchableArtifact = (
  await Promise.all(textFiles.map((file) => readFile(path.join(outputRoot, file), 'utf8')))
).join('\n');

if (/content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i.test(searchableArtifact)) {
  throw new Error('The Pages artifact still references the private question corpus.');
}

const corpus = JSON.parse(
  await readFile(path.join(repositoryRoot, 'content/question-bank/website-upload.json'), 'utf8'),
);
for (const record of corpus.records.slice(0, 8)) {
  for (const field of ['Essay Question', 'Suggested Answer', 'Legal Basis / Provision']) {
    const sample = String(record[field] || '').trim().slice(0, 120);
    if (sample.length >= 40 && searchableArtifact.includes(sample)) {
      throw new Error(`Curated ${field} content leaked into the Pages artifact.`);
    }
  }
}

console.log(`Built sanitized GitHub Pages artifact with ${files.length} files.`);
for (const file of files) console.log(`- ${file}`);
