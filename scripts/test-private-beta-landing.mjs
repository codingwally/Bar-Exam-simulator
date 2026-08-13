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
assert.match(publicLanding, /class="pb-brand"[^>]*data-public-home/,
  'The public logo must return to the canonical homepage without discarding authentication.');
assert.match(
  publicLanding,
  /class="pb-chamber-nav"[\s\S]*data-pb-chamber-link="academy"[\s\S]*data-pb-menu-trigger="academy"[\s\S]*data-pb-chamber-link="commons"[\s\S]*data-pb-menu-trigger="commons"[\s\S]*data-pb-chamber-link="barbound"[\s\S]*data-pb-menu-trigger="barbound"[\s\S]*data-public-feature="examination-room"/,
  'The public header must expose all four chamber pills.',
);
for (const [chamber, label] of [
  ['academy', 'Academy'], ['commons', 'Commons'], ['barbound', 'BarBound'],
]) {
  assert.match(publicLanding, new RegExp(
    `<a class="pb-chamber-link" href="#chamber/${chamber}"[^>]*>${label === 'BarBound' ? 'BarBound' : `The ${label}`}<\\/a>`
    + `[\\s\\S]*?<button class="pb-chamber-toggle"[^>]*data-pb-menu-trigger="${chamber}"[\\s\\S]*?aria-label="Show ${label} features"`,
  ), `${label} must use separate navigation and feature-menu controls.`);
}
assert.match(html, /class="brand"[^>]*data-public-home[^>]*aria-label="Due Diligence homepage"/,
  'The authenticated-shell logo must use the same public-home action.');
assert.doesNotMatch(html, /id="welcome-state"|Prepare with purpose\.|id="start-practice"/,
  'The retired authenticated landing must not ship.');
assert.ok(publicLanding.indexOf('class="pb-header"') < publicLanding.indexOf('class="pb-pillars"'),
  'The preparation chooser must follow the public header directly.');
assert.match(publicLanding, /<h1 id="pb-pillars-title">Choose how you want to prepare\.<\/h1>/);
assert.match(publicLanding, /One platform, four focused chambers/i);
assert.doesNotMatch(publicLanding, /class="pb-hero"|class="pb-summary"|class="pb-rail"/);
assert.match(publicLanding, /class="pb-platform-composition"/);
assert.match(publicLanding, /class="pb-chamber-index"/);
assert.doesNotMatch(publicLanding, /class="pb-pillar-card"/,
  'The homepage must not regress to four generic boxed cards.');
assert.doesNotMatch(publicLanding, /A platform to express|Practice the reasoning\. Refine the writing\.|Explore Due Diligence|Learn How It Works|Pause Motion/i);
assert.match(publicLanding, /campus-students-720\.avif/,
  'The homepage must retain an optimized editorial photographic field.');
for (const [chamber, route] of [
  ['The Academy', 'chamber/academy'],
  ['The Commons', 'chamber/commons'],
  ['BarBound', 'chamber/barbound'],
]) assert.match(publicLanding, new RegExp(
  `<a class="pb-chamber-entry" href="#${route}">[\\s\\S]*?<strong>${chamber}<\\/strong>`,
), `missing editorial chamber entry: ${chamber}`);
assert.match(publicLanding, /<button class="pb-chamber-entry"[^>]*data-public-feature="examination-room"/);
assert.match(publicLanding, /id="pb-chamber-view"/);
assert.match(script, /academy:[\s\S]*commons:[\s\S]*barbound:/);
for (const taxonomy of [
  /Mock Bar[\s\S]*Subject Matter[\s\S]*The Verdict/,
  /Bar Easy[\s\S]*Quorum[\s\S]*Retainer/,
  /Bar Feels[\s\S]*2026 Bar Chair(?:&rsquo;|’|')s Cases[\s\S]*Doctrines[\s\S]*Anchor Case Digests/,
  /Professor[\s\S]*Beadle[\s\S]*Student[\s\S]*Exam Administrator/,
]) assert.match(publicLanding, taxonomy, `missing homepage taxonomy: ${taxonomy}`);
assert.doesNotMatch(publicLanding, /EARLY ACCESS BETA|Enter the Beta|Private beta access code/i,
  'The public homepage must not expose the retired admission gate.');

assert.doesNotMatch(`${html}\n${css}\n${script}\n${config}\n${build}`, /ARTICLE[0-9]+NCC/i);
assert.match(script, /privateBetaGate === true/);
assert.match(config, /privateBetaGate: false/);
assert.match(script, /if \(!gateEnabled\)[\s\S]*applicationRouteRequested\(\)[\s\S]*showApplication\(\)[\s\S]*showLanding\(\{ accessAllowed: true \}\)/,
  'The disabled admission gate must retain the public homepage at root and open only explicit application routes.');
assert.match(script, /global\.DueDiligencePublicHome = Object\.freeze/);
assert.match(script, /mock: '#mock-bar'/, 'Mock Bar sign-in returns must use the canonical route.');
assert.match(
  script,
  /\['mock', 'mock-bar', 'subject-matter'\]/,
  'Application restoration must recognize the Subject Matter route.',
);
assert.match(
  script,
  /route === 'subject-matter'[\s\S]*DueDiligenceExaminations\?\.openPerSubject\?\.\(\)/,
  'Refreshing an authenticated Subject Matter route must reload its catalog.',
);
assert.match(script, /addEventListener\('popstate'[\s\S]*!applicationRouteRequested\(\)[\s\S]*showLanding/,
  'Browser Back must restore the public homepage for root and public chamber anchors.');
assert.match(script, /IntersectionObserver/);
assert.match(script, /prefers-reduced-motion: reduce/);
assert.match(script, /completeAdmission/);
assert.match(script, /api\.status/);
assert.match(script, /globalBetaEnabled/);
assert.match(script, /privateBetaApi\(\)\?\.policy/);
assert.match(script, /global\.syncModalIsolation\?\.\(\)/);
assert.match(html, /#private-beta-dialog\[open\]/);
assert.match(html, /assets\/private-beta-landing\.js\?v=master-experience-20260813-1&amp;release=design-correction-20260814-1/);
assert.match(html, /assets\/private-beta-landing\.css\?v=master-experience-20260813-1&amp;release=design-correction-20260814-1/);
assert.match(css, /\.pb-chamber-nav\s*\{/);
assert.match(css, /\.pb-chamber-pill\s*\{/);
assert.match(css, /\.pb-chamber-link\s*,[\s\S]*?\.pb-chamber-toggle\s*\{/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.pb-chamber-nav\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /\.pb-platform-composition\s*\{[\s\S]*?grid-template-columns:/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.pb-platform-composition\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
assert.match(css, /\.pb-chamber-feature\s*\{[\s\S]*?border-top:/);
assert.doesNotMatch(css, /\.pb-pillar-card/);
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
