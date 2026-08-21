import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, css, shell, landing, serviceWorker] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('service-worker.js', root), 'utf8'),
]);

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>') + 9);
const rail = header.match(/<nav class="qfs-practice-rail"[\s\S]*?<\/nav>/)?.[0] || '';
const signIn = html.slice(
  html.indexOf('<section class="quorum-entry"'),
  html.indexOf('<section class="pb-chamber-view"'),
);

assert.ok(rail, 'The approved desktop practice rail must ship in the canonical header.');
const expectedRail = [
  'Home',
  'Guided Practice',
  'Doctrine Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Analytics',
];
let lastPosition = -1;
for (const label of expectedRail) {
  const position = rail.indexOf(`>${label}<`);
  assert.ok(position > lastPosition, `${label} must remain in the approved header order.`);
  lastPosition = position;
}
assert.ok(rail.indexOf('>Home<') < rail.indexOf('>Guided Practice<'),
  'Home must remain immediately before Guided Practice.');
assert.equal((rail.match(/data-public-feature=/g) || []).length, expectedRail.length);
assert.doesNotMatch(rail, /<img|<svg|role="img"/, 'The practice rail must remain icon-free.');

assert.match(signIn, /data-signin-intro-backdrop[\s\S]*data-signin-intro-video/);
assert.match(signIn, /assets\/brand\/signin-intro\.mp4/g);
assert.match(signIn, /assets\/brand\/logo1-master\.png/);
assert.match(signIn, /Prepare with purpose\./);
for (const feature of ['Previous Bar Questions', 'High-Yield Questions', 'Doctrine Mastery', 'Guided Questions']) {
  assert.match(signIn, new RegExp(feature));
}
assert.match(signIn, /data-pb-open-admission>Continue with Google<\/button>/);

assert.match(css, /grid-template-rows:\s*var\(--qfs-header-height\) var\(--qfs-rail-height\)/);
assert.match(css, /#site-header\.qfs-shell\s*\{[\s\S]*backdrop-filter:\s*none/,
  'The viewport drawer requires a header without a backdrop-filter containing block.');
assert.match(css, /\.qfs-practice-rail\s*\{[\s\S]*grid-row:\s*2/);
assert.match(css, /\.quorum-entry\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.12fr\) minmax\(440px, \.88fr\)/);
assert.match(css, /\.quorum-signin-intro-main\s*\{[\s\S]*object-fit:\s*contain/);
assert.match(css, /\.quorum-signin-intro-backdrop\s*\{[\s\S]*object-fit:\s*cover[\s\S]*filter:\s*blur/);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.qfs-practice-rail\s*\{[\s\S]*display:\s*none/);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.quorum-entry\s*\{[\s\S]*grid-template-columns:\s*1fr/);
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(shell, /function synchronizePracticeRail/);
assert.match(shell, /synchronizePracticeRail\(refs, 'quorum'\)/);
assert.match(shell, /'spa-community'[\s\S]*'spa-bar-easy'[\s\S]*'spa-jurisprudence'[\s\S]*'spa-mock'[\s\S]*'spa-bar-feels'[\s\S]*'spa-progress'/);
assert.match(shell, /'#quorum':\s*'quorum'[\s\S]*'#verdict':\s*'verdict'/);
assert.match(shell, /addEventListener\('hashchange',[\s\S]*synchronizePracticeRail/);
assert.match(landing, /const stillHoldMs = 30 \* 60 \* 1000/);
assert.match(landing, /Promise\.allSettled\(playback\)/);
assert.match(serviceWorker, /duediligence-shell-20260821-approved-renovation-2/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=approved-renovation-20260821-1/);
assert.match(serviceWorker, /quorum-first-shell\.js\?v=approved-renovation-20260821-2/);

console.log('Approved renovation shell contract checks passed.');
