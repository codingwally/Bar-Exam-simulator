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

assert.match(html, /<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/);
assert.equal((html.match(/id="site-header"/g) || []).length, 1,
  'One canonical header must serve signed-out and authenticated ordinary pages.');
assert.match(sharedHeader, /class="brand pb-brand"[^>]*data-public-home/,
  'The brand must remain the authenticated Home control.');
assert.match(sharedHeader, /data-public-feature="examination-room"[^>]*>Examination Room<\/button>/);
assert.match(sharedHeader, /id="site-menu-toggle"[^>]*aria-controls="spa-nav"[^>]*aria-label="Open navigation menu"[\s\S]*class="site-menu-icon"[\s\S]*<span><\/span><span><\/span><span><\/span>[\s\S]*<\/button>/);
assert.match(sharedHeader, /id="spa-community"[^>]*data-public-feature="quorum"[^>]*>Home<\/button>/);
assert.match(sharedHeader, /<summary>Practice Exam<\/summary>[\s\S]*Guided Practice[\s\S]*Doctrine Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation/);
assert.match(sharedHeader, /data-public-action="docket"[^>]*aria-label="Sign in or open your profile"[^>]*>Profile<\/button>/);
assert.match(sharedHeader, /Plans &amp; Pricing[\s\S]*>Support<[\s\S]*Examination Room/);
assert.doesNotMatch(sharedHeader, />The Academy<|>The Commons<|>BarBound<|>The Docket/,
  'Retired chamber brands must not remain user-facing.');

assert.match(publicLanding, /<h1 id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
assert.match(publicLanding, /Continue with Google/);
assert.match(publicLanding, /data-signin-intro-video[\s\S]*data-src="assets\/brand\/signin-intro\.mp4"[\s\S]*autoplay muted playsinline/,
  'The first-visit sign-in screen must contain the muted inline intro video.');
assert.doesNotMatch(publicLanding, /<video[^>]*\scontrols(?:\s|=|>)/,
  'The decorative sign-in video must not expose playback controls.');
assert.match(publicLanding, /class="quorum-signin-intro-still"[\s\S]*assets\/brand\/logo1-master\.png/,
  'The approved full-resolution justice mark must remain as the seamless fallback and end state.');
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
assert.match(shellCss, /@media \(max-width: 400px\)[\s\S]*#site-header\.qfs-shell \{[\s\S]*flex-wrap:\s*nowrap/,
  'The approved compact header must remain one clean row at 320px and 375px without overflowing.');
assert.match(shellCss, /@media \(max-width: 900px\)[\s\S]*\.quorum-entry/,
  'The signed-out entry must have an explicit mobile treatment.');
assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(shellCss, /\.quorum-signin-intro\.is-playing[\s\S]*opacity:\s*1/);
assert.match(shellCss, /\.quorum-signin-intro\.is-finishing \.quorum-signin-intro-still[\s\S]*opacity:\s*1/);
assert.match(shellCss, /#spa-community[\s\S]*icons\/navigation\/house\.svg/,
  'The Home drawer entry must include a real navigation icon.');
assert.match(shellCss, /#quorum-practice-menu > summary[\s\S]*icons\/navigation\/book-open\.svg/,
  'The Practice Exam drawer group must include a real navigation icon.');
assert.match(shellCss, /#header-account-control[\s\S]*icons\/navigation\/circle-user-round\.svg/,
  'The Profile drawer entry must include a real navigation icon.');

assert.match(landingJs, /function openQuorumHome\(trigger = null\)[\s\S]*openProtectedFeature\('quorum', trigger\)/,
  'Authenticated Home must resolve through the protected Quorum route.');
assert.match(landingJs, /const publicHomepageHashes = new Set\(\[[\s\S]*'quorum'[\s\S]*'lex-forum'/,
  'Both canonical and legacy Home hashes must initialize Quorum instead of stalling in route verification.');
assert.match(landingJs, /if \(!gateEnabled\)[\s\S]*else if \(authenticated\) await openQuorumHome\(\)/,
  'Signed-in root restoration must open Quorum rather than a retired landing.');
assert.match(landingJs, /popstate[\s\S]*openQuorumHome\(\)[\s\S]*hashchange[\s\S]*openQuorumHome\(\)/,
  'Back and hash restoration must retain the Quorum-first home.');
assert.match(landingJs, /global\.DueDiligencePublicHome = Object\.freeze/);
assert.doesNotMatch(landingJs, /duediligence\.signin\.intro\.seen\.v1|signInIntroWasSeen|rememberSignInIntro/,
  'The approved sign-in video must not be suppressed by a previous-view browser flag.');
assert.match(landingJs, /const stillHoldMs = 30 \* 60 \* 1000/,
  'The completed video must hold the approved Prepare with purpose still for thirty minutes.');
assert.match(landingJs, /function initializeSignInIntro\(\)[\s\S]*state\.reducedMotion[\s\S]*media\.map\(\(element\) => element\.play\(\)\)/,
  'The intro must play on each signed-out page initialization while respecting reduced-motion preferences.');
assert.match(landingJs, /video\.addEventListener\('ended',[\s\S]*showStill/,
  'The intro must always resolve to the existing crest when playback ends.');
assert.match(landingJs, /Promise\.allSettled\(playback\)[\s\S]*showStill/,
  'Autoplay rejection must fail open to the approved still state.');
assert.match(landingJs, /route === 'subject-matter'[\s\S]*restoreRoute\('per_subject'/);
assert.match(landingJs, /feature === 'verdict'[\s\S]*global\.openVerdictDashboard\?\.\(\)/);
assert.match(html, /window\.openVerdictDashboard = openAnalytics;/);
assert.match(html, /id="page-analytics"[^>]*class="page"/,
  'Analytics must render as an application page.');
assert.match(html, /function openAnalytics\(\)[\s\S]*showPage\('analytics', document\.getElementById\('spa-progress'\)\)/,
  'The compatibility Analytics route must open the full-page experience.');

assert.match(config, /privateBetaGate: false/);
assert.match(config, /maintenance:\s*Object\.freeze\(\{[\s\S]*enabled:\s*true/,
  'The redesign must remain protected by the temporary maintenance lock.');
assert.doesNotMatch(`${html}\n${landingCss}\n${landingJs}\n${shellCss}\n${shellJs}\n${config}\n${build}`, /ARTICLE[0-9]+NCC/i);
assert.doesNotMatch(build, /privateBetaImageFiles|assets\/private-beta\/.+\.(?:avif|webp|jpe?g)/i,
  'Internet-sourced private-beta photography must not enter the Pages allowlist.');
assert.match(build, /assets\/quorum-first-shell\.css/);
assert.match(build, /assets\/quorum-first-shell\.js/);
assert.match(build, /assets\/brand\/signin-intro\.mp4/);
assert.match(html, /assets\/quorum-first-shell\.css\?v=commercial-entry-access-20260822-1/,
  'The drawer stylesheet URL must change when its icon presentation changes.');
assert.match(html, /assets\/private-beta-landing\.js\?v=single-signin-entry-20260822-1/,
  'The signed-in Home router must use the current release URL.');

const signInIntro = await readFile(path.join(root, 'assets/brand/signin-intro.mp4'));
assert.equal(
  createHash('sha256').update(signInIntro).digest('hex').toUpperCase(),
  '37AE9D8CD9CDFE533FFF4A01A426E002AAFC5644C4C9552DF3664B0360E68827',
  'approved sign-in intro video checksum changed',
);

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
