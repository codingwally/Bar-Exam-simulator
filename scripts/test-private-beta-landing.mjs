import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const [html, landingCss, landingJs, shellCss, shellJs, config, build] = await Promise.all([
  read('index.html'),
  read('assets/private-beta-landing.css'),
  read('assets/private-beta-landing.js'),
  read('assets/quorum-first-shell.css'),
  read('assets/quorum-first-shell.js'),
  read('assets/phase2-config.js'),
  read('scripts/build-pages-artifact.mjs'),
]);

const publicLanding = html.slice(
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
  html.indexOf('<dialog class="pb-dialog" id="private-beta-dialog"'),
);
const sharedHeader = html.slice(
  html.indexOf('<header class="topbar pb-header pb-shared-header" id="site-header">'),
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
);

assert.match(html, /<title>Due Diligence — A Friend on Your Journey Through the Study of Law<\/title>/);
assert.equal((html.match(/id="site-header"/g) || []).length, 1,
  'One canonical header must serve signed-out and authenticated ordinary pages.');
assert.match(sharedHeader, /class="brand pb-brand"[^>]*data-public-home/,
  'The brand must remain the authenticated Home control.');
assert.match(sharedHeader, /data-public-feature="examination-room"[^>]*>Examination Room<\/button>/);
assert.match(sharedHeader, /id="site-menu-toggle"[^>]*aria-controls="spa-nav"[^>]*>Menu<\/button>/);
assert.match(sharedHeader, /id="spa-community"[^>]*data-public-feature="quorum"[^>]*>Home<\/button>/);
assert.match(sharedHeader, /<summary>Practice Exam<\/summary>[\s\S]*Guided Practice[\s\S]*Doctrine Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation/);
assert.match(sharedHeader, /data-public-action="docket"[^>]*aria-label="Sign in or open your profile"[^>]*>Profile<\/button>/);
assert.match(sharedHeader, /Plans &amp; Pricing[\s\S]*>Support<[\s\S]*Examination Room/);
assert.doesNotMatch(sharedHeader, />The Academy<|>The Commons<|>BarBound<|>The Docket/,
  'Retired chamber brands must not remain user-facing.');

assert.match(publicLanding, /<h1 id="pb-pillars-title">Your legal study community\.<\/h1>/);
assert.match(publicLanding, /Continue with Google/);
assert.doesNotMatch(publicLanding, /pb-feature-ledger|pb-chamber-index|pb-pillar-card|feature-previews\//,
  'The signed-out entry must stay concise and must not recreate the retired chamber landing.');
assert.doesNotMatch(`${publicLanding}\n${landingJs}`, /campus-students|library-community|library-student|writing-notes/,
  'No internet-sourced photography may ship in the landing or routing paths.');

assert.match(shellJs, /refs\.brand\.setAttribute\('href', '#quorum'\)/);
assert.match(shellJs, /refs\.brand\.setAttribute\('aria-label', 'Due Diligence — Home'\)/);
assert.match(shellJs, /focusInside[\s\S]*restoreFocus[\s\S]*event\.key !== 'Escape'/,
  'The drawer must manage entry focus, Escape, and focus restoration.');
assert.match(shellJs, /document\.getElementById\('spa-mock'\)\?\.click\(\)/,
  'The Quorum practice promotion must reuse the existing practice route.');
assert.match(shellCss, /#site-header\.qfs-shell #spa-nav\.qfs-drawer[\s\S]*position:\s*fixed[\s\S]*height:\s*100dvh/,
  'The compact menu must use the approved full-height drawer.');
assert.match(shellCss, /@media \(max-width: 760px\)[\s\S]*\.quorum-entry/,
  'The signed-out entry must have an explicit mobile treatment.');
assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(landingJs, /function openQuorumHome\(trigger = null\)[\s\S]*openProtectedFeature\('quorum', trigger\)/,
  'Authenticated Home must resolve through the protected Quorum route.');
assert.match(landingJs, /if \(!gateEnabled\)[\s\S]*else if \(authenticated\) await openQuorumHome\(\)/,
  'Signed-in root restoration must open Quorum rather than a retired landing.');
assert.match(landingJs, /popstate[\s\S]*openQuorumHome\(\)[\s\S]*hashchange[\s\S]*openQuorumHome\(\)/,
  'Back and hash restoration must retain the Quorum-first home.');
assert.match(landingJs, /global\.DueDiligencePublicHome = Object\.freeze/);
assert.match(landingJs, /route === 'subject-matter'[\s\S]*restoreRoute\('per_subject'/);
assert.match(landingJs, /feature === 'verdict'[\s\S]*global\.openVerdictDashboard\?\.\(\)/);
assert.match(html, /window\.openVerdictDashboard = openAnalytics;/);

assert.match(config, /privateBetaGate: false/);
assert.match(config, /maintenance:\s*Object\.freeze\(\{[\s\S]*enabled:\s*true/,
  'The redesign must remain protected by the temporary maintenance lock.');
assert.doesNotMatch(`${html}\n${landingCss}\n${landingJs}\n${shellCss}\n${shellJs}\n${config}\n${build}`, /ARTICLE[0-9]+NCC/i);
assert.doesNotMatch(build, /privateBetaImageFiles|assets\/private-beta\/.+\.(?:avif|webp|jpe?g)/i,
  'Internet-sourced private-beta photography must not enter the Pages allowlist.');
assert.match(build, /assets\/quorum-first-shell\.css/);
assert.match(build, /assets\/quorum-first-shell\.js/);

const approvedReference = await readFile(path.join(
  root,
  'docs/visual-references/renovation-20260820/approved-quorum-first-target.png',
));
assert.equal(
  createHash('sha256').update(approvedReference).digest('hex').toUpperCase(),
  '4CD5CB5DCACA0BBB665FED643CEFCCFCDC775AE6624A07490672BA43407CB9AE',
  'approved Quorum-first design target checksum changed',
);

const sessionPosition = html.indexOf('assets/private-beta-session.js');
const phase2Position = html.indexOf('assets/phase2-experience.js');
const shellPosition = html.indexOf('assets/quorum-first-shell.js');
const landingPosition = html.indexOf('assets/private-beta-landing.js');
assert.ok(sessionPosition > -1 && phase2Position > sessionPosition);
assert.ok(shellPosition > phase2Position && landingPosition > shellPosition,
  'The accessibility shell must initialize after shared controls and before public routing.');

console.log('Quorum-first landing contract checks passed.');
