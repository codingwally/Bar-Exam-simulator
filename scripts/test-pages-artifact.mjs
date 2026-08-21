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
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'admin/index.html',
  'assets/private-beta-session.js',
  'assets/examination-room-beadle-class-list-template.xlsx',
  'assets/private-beta-landing.css',
  'assets/due-diligence-controls.css',
  'assets/private-beta-landing.js',
  'assets/feature-loader.js',
  'assets/maintenance-gate.js',
  'assets/quorum-first-shell.css',
  'assets/quorum-first-shell.js',
  'assets/private-workspace.js',
  'assets/feature-previews/mock-bar.png',
  'assets/feature-previews/subject-matter.png',
  'assets/feature-previews/verdict.png',
  'assets/feature-previews/examination-room.png',
  'assets/icons/community/thumbs-up.svg',
  'assets/icons/community/chat-circle.svg',
  'assets/icons/community/share-fat.svg',
  'assets/icons/community/bookmark-simple.svg',
  'assets/icons/community/LICENSE.txt',
  'assets/examinations.css',
  'assets/examinations.js',
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
  'assets/payments/gotyme-instapay-149.png',
]) {
  assert.ok(files.includes(required), `${required} must ship in the Pages artifact`);
}

assert.ok(files.includes('.nojekyll'));
assert.ok(files.every((file) => !/(^|\/)(content|worker|supabase|scripts|docs)(\/|$)/i.test(file)));
assert.ok(files.every((file) => !/\.(json|sql|mjs|csv)$/i.test(file)));
assert.ok(files.every((file) => !/^assets\/private-beta\/.+\.(?:avif|webp|jpe?g)$/i.test(file)));
assert.ok(!files.includes('assets/phase2-law-library.jpg'));

const index = await readFile(path.join(output, 'index.html'), 'utf8');
const examinations = await readFile(path.join(output, 'assets/examinations.js'), 'utf8');
const featureLoader = await readFile(path.join(output, 'assets/feature-loader.js'), 'utf8');
const phase2Config = await readFile(path.join(output, 'assets/phase2-config.js'), 'utf8');
const maintenanceGate = await readFile(path.join(output, 'assets/maintenance-gate.js'), 'utf8');
const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
assert.doesNotMatch(index, /content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i);
assert.doesNotMatch(index, /const BAR_QUESTIONS\s*=\s*\{/);
assert.doesNotMatch(index, /PH Bar Essay Trainer|Advanced Pro Repository/);
assert.match(index, /<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/);
assert.match(index, /<html lang="en-PH">/);
assert.match(index, /id="private-beta-landing"/);
assert.match(index, /<h1 id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
assert.equal((index.match(/id="site-header"/g) || []).length, 1);
assert.match(index, /id="site-header"[\s\S]*id="site-menu-toggle"[\s\S]*Examination Room[\s\S]*>Home<[\s\S]*>Practice Exam<[\s\S]*Guided Practice[\s\S]*Doctrine Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation[\s\S]*>Profile<[\s\S]*Plans &amp; Pricing[\s\S]*>Support/);
assert.doesNotMatch(index, />The Academy<|>The Commons<|>BarBound<|>The Docket</);
assert.doesNotMatch(index, /class="pb-chamber-index"/);
assert.doesNotMatch(index, /class="pb-pillar-grid"|class="pb-pillar-card"/);
assert.doesNotMatch(index, /class="pb-hero"|class="pb-summary"|class="pb-rail"/);
assert.doesNotMatch(index, /A platform to express|Practice the reasoning\. Refine the writing\.|Explore Due Diligence|Learn How It Works|Pause Motion/i);
assert.match(index, /id="authenticated-app-shell" hidden inert/);
assert.match(index, /loadProtectedQuestion/);
assert.match(index, /Authentication is required before an examination question is displayed/);
assert.match(examinations, /data-exam-setup=[\s\S]*Review &amp; Begin/);
assert.match(examinations, /const isBarFeels = state\.setup\.track === 'bar_feels';[\s\S]*\? 'strict'/);
assert.doesNotMatch(examinations, /function subjectWritingGuide\(|Writing approach|Take a clear position on the legal issue/i);
assert.match(examinations, /Improved model response/);
assert.doesNotMatch(examinations, /id="dd-upload-timer"/);
assert.doesNotMatch(featureLoader, /assets\/free-trial-five-daily\.js/);
assert.match(featureLoader, /'subject-matter': '#subject-matter'/);
assert.ok(!files.includes('assets/free-trial-five-daily.js'));
assert.match(phase2Config, /maintenance:\s*Object\.freeze\(\{/);
assert.match(phase2Config, /unlockPath:\s*'\/maintenance\/unlock'/);
assert.match(phase2Config, /statusPath:\s*'\/maintenance\/status'/);
assert.match(phase2Config, /assets\/maintenance-gate\.js\?v=maintenance-lock-20260821-3/);
assert.match(maintenanceGate, /We are improving Due Diligence\./);
assert.match(maintenanceGate, /maintenance\.unlockPath/);
assert.match(maintenanceGate, /maintenance\.statusPath/);
assert.doesNotMatch(maintenanceGate, /\b0802\b/);
assert.match(robots, /Disallow: \/admin\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Sanitized GitHub Pages artifact tests passed.');
