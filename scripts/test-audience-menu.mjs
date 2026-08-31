import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, landingJs, experience, features2026, forecastJs, shellCss, shellJs] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/bar-forecast.js', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.js', root), 'utf8'),
]);

const header = html.match(/<header class="topbar pb-header pb-shared-header" id="site-header">[\s\S]*?<\/header>/)?.[0];
assert.ok(header, 'The canonical shared header must remain present.');
assert.equal((html.match(/id="site-header"/g) || []).length, 1);
assert.equal((html.match(/id="spa-nav"/g) || []).length, 1);

const navigation = header.match(/<nav class="spa-nav quorum-primary-nav" id="spa-nav"[\s\S]*?<\/nav>/)?.[0];
assert.ok(navigation, 'The Quorum-first primary drawer must remain present.');
assert.match(header, /id="site-menu-toggle"[\s\S]*class="brand pb-brand"[\s\S]*id="spa-support"/);
assert.match(header, /id="site-menu-toggle"[^>]*aria-controls="spa-nav"[^>]*aria-expanded="false"[^>]*aria-label="Open navigation menu"/);
assert.match(header, /class="site-menu-icon"[\s\S]*<span><\/span><span><\/span><span><\/span>/);
assert.doesNotMatch(header, /aria-expanded="false">Menu<\/button>/);

const assertOrder = (markup, labels) => {
  let previous = -1;
  for (const label of labels) {
    const next = markup.indexOf(label);
    assert.ok(next > previous, `${label} must appear in the approved order.`);
    previous = next;
  }
};

assertOrder(navigation, [
  'Home',
  'Study Features',
  '2026 Bar Forecast',
  'Quick Drills',
  'Doctrine Review',
  'Syllabus-Based Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Profile',
  'Examination Room',
  'Plans &amp; Pricing',
  'Support',
]);
assert.match(navigation, /<details class="quorum-practice-menu"[\s\S]*<summary>Study Features<\/summary>/);
assert.match(navigation, /id="header-account-control"[^>]*data-public-action="docket"[^>]*>Profile<\/button>/);
assert.match(navigation, /class="quorum-shell-compat" hidden aria-hidden="true"/);

for (const id of [
  'spa-community', 'spa-bar-forecast', 'spa-bar-easy', 'spa-jurisprudence', 'spa-mock', 'spa-bar-feels',
  'header-account-control', 'spa-examination-room', 'spa-pricing', 'spa-support', 'spa-subject-matter',
  'spa-progress', 'spa-chairs-case', 'spa-case-digest', 'btn-signin',
]) assert.match(navigation, new RegExp(`id="${id}"`));

assert.match(navigation, /id="spa-bar-forecast"[^>]*data-public-feature="bar-forecast"/);
assert.doesNotMatch(navigation, /id="spa-bar-forecast"[^>]*aria-controls=/);
assert.doesNotMatch(navigation, /id="spa-bar-forecast"[^>]*aria-haspopup="dialog"/);
assert.match(forecastJs, /global\.openBarForecast = openForecast/);
assert.match(landingJs, /'bar-forecast': '#bar-forecast-2026'/);
assert.match(shellJs, /'#bar-forecast-2026': 'bar-forecast'/);

for (const [id, handler] of [
  ['spa-bar-easy', 'openBarEasy'],
  ['spa-chairs-case', 'openChairCases'],
  ['spa-case-digest', 'openAnchorCases'],
]) {
  assert.match(html, new RegExp(`id="${id}"[^>]*data-public-feature=`));
  assert.match(features2026, new RegExp(`global\\.${handler} =`));
}

assert.match(shellCss, /#site-header\.qfs-shell #spa-nav\.qfs-drawer/);
assert.match(shellCss, /#site-header\.qfs-shell #spa-nav\.qfs-drawer\.is-open/);
assert.match(shellCss, /inset:\s*0 auto 0 0/);
assert.match(shellCss, /transform:\s*translateX\(-100%\)/);
assert.match(shellCss, /@media \(max-width: 900px\)/);
assert.match(shellCss, /:focus-visible/);
assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(shellJs, /event\.key !== 'Tab'/);
assert.match(shellJs, /event\.key !== 'Escape'/);
assert.match(shellJs, /qfs-menu-scrim/);
assert.match(shellJs, /document\.getElementById\('spa-mock'\)\?\.click\(\)/);
assert.match(shellJs, /refs\.brand\.setAttribute\('href', '#quorum'\)/);

assert.match(landingJs, /function openQuorumHome\(trigger = null\)/);
assert.match(landingJs, /openProtectedFeature\('quorum', trigger\)/);
assert.match(experience, /signInButton\.textContent = 'Profile';/);
assert.match(experience, /function renderHeaderAccountControl[\s\S]*control\.textContent = 'Sign in'[\s\S]*qfs-profile-avatar/);
assert.match(experience, /if \(headerAccount\) \{[\s\S]*renderHeaderAccountControl\(\)/);
assert.doesNotMatch(navigation, /id="spa-partner"/);
assert.match(html, /<a href="#partnership" data-dd2-view="partnership"[^>]*>Quid Pro Quo<\/a>/);

console.log('Quorum-first shared navigation and implemented feature routes passed.');
