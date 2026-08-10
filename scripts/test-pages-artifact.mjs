import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  stdio: 'pipe',
});

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

const output = path.join(root, '.pages-dist');
const files = await walk(output);
for (const required of [
  'index.html',
  'CNAME',
  'favicon.svg',
  'robots.txt',
  'sitemap.xml',
  'admin/index.html',
  'assets/private-beta-session.js',
  'assets/examination-room-beadle-class-list-template.xlsx',
  'assets/private-beta-landing.css',
  'assets/private-beta-landing.js',
  'assets/private-beta/library-student-1440.avif',
  'assets/examinations.css',
  'assets/examinations.js',
  'assets/payments/gcash.png',
  'assets/payments/maribank.png',
]) {
  assert.ok(files.includes(required), `${required} must ship in the Pages artifact`);
}

assert.ok(files.includes('.nojekyll'));
assert.ok(files.every((file) => !/content|worker|supabase|scripts|docs/i.test(file)));
assert.ok(files.every((file) => !/\.(json|sql|mjs|csv)$/i.test(file)));

const index = await readFile(path.join(output, 'index.html'), 'utf8');
const examinations = await readFile(path.join(output, 'assets/examinations.js'), 'utf8');
const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
assert.doesNotMatch(index, /content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i);
assert.doesNotMatch(index, /const BAR_QUESTIONS\s*=\s*\{/);
assert.doesNotMatch(index, /PH Bar Essay Trainer|Advanced Pro Repository|PH Bar Exam Simulator/);
assert.match(index, /<title>Due Diligence — A Friend on Your Journey Through the Study of Law<\/title>/);
assert.match(index, /<html lang="en-PH">/);
assert.match(index, /id="private-beta-landing"/);
assert.match(
  index,
  /A platform to express<br>\s*your perspective, sharpen<br>\s*your legal reasoning, and<br>\s*strengthen your performance<br>\s*throughout law school\./,
);
assert.match(index, /Practice the reasoning\. Refine the writing\./);
assert.match(index, /id="authenticated-app-shell" hidden inert/);
assert.match(index, /loadProtectedQuestion/);
assert.match(index, /Authentication is required before an examination question is displayed/);
assert.match(examinations, /data-exam-setup=[\s\S]*Review &amp; Begin/);
assert.match(examinations, /const isBarFeels = state\.setup\.track === 'bar_feels';[\s\S]*\? 'strict'/);
assert.doesNotMatch(examinations, /id="dd-upload-timer"/);
assert.match(robots, /Disallow: \/admin\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Sanitized GitHub Pages artifact tests passed.');
