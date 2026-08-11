import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const [html, css, script, config, build] = await Promise.all([
  read('index.html'),
  read('assets/private-beta-landing.css'),
  read('assets/private-beta-landing.js'),
  read('assets/phase2-config.js'),
  read('scripts/build-pages-artifact.mjs'),
]);
const publicLanding = html.slice(
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
  html.indexOf('<dialog class="pb-dialog" id="private-beta-dialog"'),
);

assert.match(html, /<title>Due Diligence — A Friend on Your Journey Through the Study of Law<\/title>/);
assert.match(html, /id="private-beta-landing"/);
assert.match(html, /id="authenticated-app-shell" hidden inert aria-hidden="true"/);
assert.ok(publicLanding.indexOf('class="pb-header"') < publicLanding.indexOf('class="pb-pillars"'),
  'The preparation chooser must follow the public header directly.');
assert.match(publicLanding, /<h2 id="pb-pillars-title">Choose how you want to prepare\.<\/h2>/);
assert.match(publicLanding, /One platform, four focused chambers/i);
assert.doesNotMatch(publicLanding, /class="pb-hero"|class="pb-summary"|class="pb-rail"/);
assert.doesNotMatch(publicLanding, /A platform to express|Practice the reasoning\. Refine the writing\.|Explore Due Diligence|Learn How It Works|Pause Motion/i);
for (const [pillar, route, image] of [
  ['The Academy', 'explore-academy', 'library-student'],
  ['The Commons', 'explore-commons', 'library-community'],
  ['BarBound', 'explore-barbound', 'writing-notes'],
  ['Examination Room', 'explore-examination-room', 'writing-exam'],
]) {
  assert.match(
    publicLanding,
    new RegExp(`<a class="pb-pillar-card" href="#${route}">[\\s\\S]*?${image}-720\\.avif[\\s\\S]*?<h3>${pillar}<\\/h3>`),
    `missing image-led public platform pillar: ${pillar}`,
  );
}
for (const route of ['explore-academy', 'explore-commons', 'explore-barbound', 'explore-examination-room']) {
  assert.match(publicLanding, new RegExp(`id="${route}"`), `missing public category page: ${route}`);
}
for (const taxonomy of [
  'Mock Bar · Subject Matter · The Verdict',
  'Bar Easy · Quorum · Retainer',
  'Bar Feels · 2026 Bar Chair’s Cases · Doctrines · Anchor Case Digests',
  'Professor · Beadle · Student · Exam Administrator',
]) assert.ok(publicLanding.includes(taxonomy), `missing homepage taxonomy: ${taxonomy}`);
assert.doesNotMatch(publicLanding, /EARLY ACCESS BETA|Enter the Beta|Private beta access code/i,
  'The public homepage must not expose the retired admission gate.');

assert.doesNotMatch(`${html}\n${css}\n${script}\n${config}\n${build}`, /ARTICLE[0-9]+NCC/i);
assert.match(script, /privateBetaGate === true/);
assert.match(config, /privateBetaGate: false/);
assert.match(script, /if \(!gateEnabled\)[\s\S]*showLanding\(\)/,
  'The disabled admission gate must render the public landing directly.');
assert.match(script, /IntersectionObserver/);
assert.match(script, /prefers-reduced-motion: reduce/);
assert.match(script, /completeAdmission/);
assert.match(script, /api\.status/);
assert.match(script, /globalBetaEnabled/);
assert.match(script, /privateBetaApi\(\)\?\.policy/);
assert.match(script, /global\.syncModalIsolation\?\.\(\)/);
assert.match(html, /#private-beta-dialog\[open\]/);
assert.match(html, /assets\/private-beta-landing\.js\?v=corrective-20260812-1/);
assert.match(css, /\.pb-pillar-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 1120px\)[\s\S]*?\.pb-pillar-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.pb-pillar-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
assert.doesNotMatch(css, /pb-slide-left|pb-slide-right|\.pb-rail/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

const imageStems = [
  'campus-students',
  'library-community',
  'library-student',
  'writing-exam',
  'writing-notes',
];
for (const stem of imageStems) {
  for (const width of [720, 1440]) {
    for (const extension of ['avif', 'webp', 'jpg']) {
      const relative = `assets/private-beta/${stem}-${width}.${extension}`;
      const details = await stat(path.join(root, relative));
      assert.ok(details.isFile() && details.size > 5_000, `${relative} must be a non-empty optimized image`);
      assert.ok(build.includes(`assets/private-beta/`), 'the Pages allowlist must ship private-beta images');
    }
  }
}

const approvedReference = await readFile(path.join(
  root,
  'docs/visual-references/private-beta/Due_Diligence_Private_Beta_Landing_Approved_Reference.png',
));
assert.equal(
  createHash('sha256').update(approvedReference).digest('hex').toUpperCase(),
  'DD56E1526845086D11EF0F9FA1FB6819EFDBEA2941CA5D029237BC37C6A7BE4C',
  'approved landing reference checksum changed',
);

const sessionPosition = html.indexOf('assets/private-beta-session.js');
const phase2Position = html.indexOf('assets/phase2-experience.js');
const landingPosition = html.indexOf('assets/private-beta-landing.js');
assert.ok(sessionPosition > -1 && phase2Position > sessionPosition && landingPosition > phase2Position);

console.log('Private-beta landing contract checks passed.');
