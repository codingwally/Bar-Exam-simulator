import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, landingCss, landingJs, experience, features2026] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.css', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
]);

const header = html.match(/<header class="topbar pb-header pb-shared-header" id="site-header">[\s\S]*?<\/header>/)?.[0];
assert.ok(header, 'The canonical shared header must remain present.');
assert.equal((html.match(/id="site-header"/g) || []).length, 1);
assert.equal((html.match(/id="spa-nav"/g) || []).length, 1);

const navigation = header.match(/<nav class="spa-nav pb-chamber-nav" id="spa-nav"[\s\S]*?<\/nav>/)?.[0];
assert.ok(navigation, 'The primary navigation must remain present in the shared header.');

const slice = (start, end) => navigation.slice(navigation.indexOf(start), navigation.indexOf(end));
const academy = slice('pb-chamber-academy', 'pb-chamber-commons');
const commons = slice('pb-chamber-commons', 'pb-chamber-barbound');
const premium = slice('pb-chamber-barbound', 'nav-utilities');
const utilities = navigation.slice(navigation.indexOf('nav-utilities'));

const assertOrder = (markup, labels) => {
  let previous = -1;
  for (const label of labels) {
    const next = markup.indexOf(label);
    assert.ok(next > previous, `${label} must appear in the approved order.`);
    previous = next;
  }
};

for (const [markup, slug, visible, accessible, menuId] of [
  [academy, 'academy', 'The Academy', 'Academy', 'pb-academy-menu'],
  [commons, 'commons', 'The Commons', 'Commons', 'pb-commons-menu'],
  [premium, 'barbound', 'BarBound', 'BarBound', 'pb-barbound-menu'],
]) {
  assert.match(markup, new RegExp(`<a class="pb-chamber-link" href="#chamber/${slug}"[^>]*>${visible}<\\/a>`));
  assert.match(markup, new RegExp(`class="pb-chamber-toggle"[\\s\\S]*aria-controls="${menuId}"[\\s\\S]*data-pb-menu-trigger="${slug}"[\\s\\S]*aria-label="Show ${accessible} features"`));
  assert.match(markup, new RegExp(`class="pb-chamber-dropdown" id="${menuId}" role="menu"`));
}

assertOrder(academy, ['The Academy', 'Mock Bar', 'Subject Matter', 'The Verdict']);
assertOrder(commons, ['The Commons', 'Bar Easy', 'Quorum', 'Plans &amp; Pricing']);
assertOrder(premium, ['BarBound', 'Bar Feels', '2026 Bar Chair', 'Doctrines', 'Anchor Case Digests']);
assertOrder(utilities, ['Examination Room', 'Support', 'The Docket']);

assert.match(header, /id="header-account-control"[^>]*data-public-action="docket"[^>]*>Sign in<\/button>/);
assert.match(header, /id="site-menu-toggle"[^>]*aria-controls="spa-nav"[^>]*aria-expanded="false"/);
assert.equal((navigation.match(/role="menu"/g) || []).length, 3);
assert.equal((navigation.match(/role="menuitem"/g) || []).length, 10);
assert.equal((premium.match(/class="btn-angel"/g) || []).length, 4,
  'Every BarBound destination must retain the live gold treatment.');

assert.match(landingCss, /#site-header\.pb-shared-header\s*\{[\s\S]*?grid-template-columns:/);
assert.match(landingCss, /#site-header #spa-nav\s*\{[\s\S]*?grid-row:\s*2/);
assert.match(landingCss, /#site-header \.nav-audience-cluster\s*\{[\s\S]*?grid-column:\s*2/);
assert.match(landingCss, /#site-header \.pb-header-utilities\s*\{[\s\S]*?border-left:/);
assert.match(landingCss, /\.pb-chamber-split\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(landingCss, /@media \(max-width: 900px\)[\s\S]*?#site-header \.site-menu-toggle\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(landingCss, /@media \(max-width: 900px\)[\s\S]*?#site-header \.pb-header-utilities button\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(landingCss, /@media \(max-width: 560px\)[\s\S]*?#site-header \.nav-audience-cluster\s*\{[\s\S]*?grid-template-columns:\s*1fr/);

assert.match(landingJs, /function closePublicMenus\(\{ restoreFocus = false \} = \{\}\)/);
assert.match(landingJs, /function togglePublicMenu\(trigger, forceOpen = null\)/);
assert.match(landingJs, /closePublicMenus\(\{ restoreFocus: true \}\)/);
assert.match(landingJs, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
assert.match(landingJs, /document\.addEventListener\('click',[\s\S]*?closePublicMenus\(\)/);
assert.match(landingJs, /\[landing, siteHeader\]\.forEach/);
const chamberLinkHandler = landingJs.match(/const chamberLink[\s\S]*?const trigger/)?.[0] || '';
assert.ok(chamberLinkHandler);
assert.doesNotMatch(chamberLinkHandler, /scrollIntoView/);

for (const [id, handler] of [
  ['spa-bar-easy', 'openBarEasy'],
  ['spa-chairs-case', 'openChairCases'],
  ['spa-case-digest', 'openAnchorCases'],
  ['spa-examination-room', 'openExaminationRoom'],
]) {
  assert.match(navigation, new RegExp(`id="${id}"[^>]*data-public-feature=`));
  assert.match(features2026, new RegExp(`global\\.${handler} =`));
}

for (const id of [
  'spa-mock', 'spa-subject-matter', 'spa-progress', 'spa-community', 'spa-pricing',
  'spa-bar-feels', 'spa-jurisprudence', 'spa-support', 'btn-signin',
]) assert.match(navigation, new RegExp(`id="${id}"`));

assert.match(experience, /signInButton\.textContent = 'The Docket';/);
assert.match(experience, /headerAccount\.textContent = signedIn \? 'Account' : 'Sign in';/);
assert.doesNotMatch(navigation, /id="spa-partner"/);
assert.match(html, /<a href="#partnership" data-dd2-view="partnership"[^>]*>Quid Pro Quo<\/a>/);

console.log('Shared two-tier navigation and implemented feature routes passed.');
