import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, experience] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
]);

const navigation = html.match(/<nav class="spa-nav" id="spa-nav"[\s\S]*?<\/nav>/)?.[0];
assert.ok(navigation, 'The primary navigation must remain present.');

const section = (className) => navigation.match(
  new RegExp(`<section class="nav-audience-group ${className}"[\\s\\S]*?<\\/section>`),
)?.[0];

const academy = section('nav-group-academy');
const commons = section('nav-group-commons');
const premium = section('nav-group-premium');
const utilities = navigation.match(/<div class="nav-utilities"[\s\S]*?<\/div>/)?.[0];

for (const [name, markup] of [
  ['Academy', academy],
  ['Commons', commons],
  ['Premium', premium],
  ['utilities', utilities],
]) {
  assert.ok(markup, `${name} navigation group must be present.`);
}

const assertOrder = (markup, labels) => {
  let previous = -1;
  for (const label of labels) {
    const next = markup.indexOf(label);
    assert.ok(next > previous, `${label} must appear in the approved order.`);
    previous = next;
  }
};

assertOrder(academy, ['The Academy', 'Mock Bar', 'Subject Matter', 'Verdict']);
assertOrder(commons, ['The Commons', 'Bar Easy', 'Quorum', 'Retainer']);
assertOrder(premium, ['Premium', 'Bar Feels', 'Chair’s Case', 'Doctrines', 'Case Digest']);
assertOrder(utilities, ['Examination Room', 'Support', 'The Docket']);

assert.match(html, /\.nav-group-items\{[^}]*display:flex[^}]*flex-wrap:nowrap/);
assert.match(html, /\.nav-group-commons\{left:50%;transform:translateX\(-50%\);\}/);
assert.match(html, /\.nav-group-commons \.spa-tab\{min-width:116px;\}/);
assert.match(html, /\.nav-group-commons \.spa-tab\.active\{[^}]*border-color:rgba\(205,214,228,\.72\)/);
assert.match(html, /\.nav-utilities\{[^}]*flex-direction:column/);
assert.match(html, /\.nav-group-academy \.nav-group-label\{[^}]*background:#4A154B/);

const premiumButtons = premium.match(/class="spa-tab btn-angel"/g) || [];
assert.equal(premiumButtons.length, 4, 'Every Premium destination must use the live gold pill treatment.');
assert.match(
  html,
  /\.btn-angel\{[\s\S]*?linear-gradient\(120deg,#B8860B,#F5E28C 45%,#D4AF37 60%,#B8860B\)[\s\S]*?animation:sheen 3\.2s linear infinite/,
);

for (const id of ['spa-bar-easy', 'spa-chairs-case', 'spa-case-digest', 'spa-examination-room']) {
  assert.match(
    navigation,
    new RegExp(`id="${id}"[^>]*[\\s\\S]*?onclick="openComingSoon\\(\\)"`),
    `#${id} must use the truthful unavailable-feature fallback.`,
  );
}

assert.match(
  html,
  /Developers are currently working on this feature\. This page is not yet available\./,
);
assert.match(html, /id="spa-mock"[^>]*onclick="showPage\('mock', this\)"/);
assert.match(html, /id="spa-subject-matter"[^>]*onclick="openSubjectMatterMenu\(\)"/);
assert.match(html, /id="spa-progress"[^>]*onclick="openAnalytics\(\)"/);
assert.match(html, /id="spa-community"[\s\S]*?DueDiligenceQuorum/);
assert.match(html, /id="spa-pricing"[^>]*data-dd2-view="pricing"/);
assert.match(html, /id="spa-bar-feels"[^>]*onclick="openPremiumBarFeels\(\)"/);
assert.match(html, /id="spa-jurisprudence"[^>]*onclick="showPage\('jurisprudence', this\)"/);
assert.match(html, /id="spa-support"[^>]*data-dd2-view="support"/);
assert.match(html, /id="btn-signin"[^>]*>The Docket<\/button>/);
assert.match(experience, /signInButton\.textContent = 'The Docket';/);
assert.match(html, /id="spa-mock" aria-current="page"/);
assert.match(html, /tab\.setAttribute\('aria-current', 'page'\)/);
assert.match(html, /tab\.removeAttribute\('aria-current'\)/);

assert.doesNotMatch(navigation, /id="spa-partner"/);
assert.match(html, /<a href="#partnership" data-dd2-view="partnership"[^>]*>Quid Pro Quo<\/a>/);

console.log('Audience-group navigation, live routes, and coming-soon fallbacks passed.');
