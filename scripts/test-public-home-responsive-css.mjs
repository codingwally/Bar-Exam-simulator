import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [css, subscriptionCtaCss] = await Promise.all([
  readFile('assets/lex-forum.css', 'utf8'),
  readFile('assets/subscription-cta.css', 'utf8'),
]);
const tabletStart = css.lastIndexOf('@media (max-width: 980px)');
const phoneStart = css.indexOf('@media (max-width: 640px)', tabletStart);

assert.ok(tabletStart >= 0, 'Public Home must keep its tablet breakpoint.');
assert.ok(phoneStart > tabletStart, 'Public Home tablet rules must precede its phone rules.');

const tabletCss = css.slice(tabletStart, phoneStart);
assert.match(
  tabletCss,
  /#page-community \.lex-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s,
  'Public Home must collapse to one content column at tablet widths.',
);
assert.match(
  tabletCss,
  /#page-community \.lex-secondary\s*\{[^}]*grid-column:\s*1;/s,
  'The supporting rail must return to the same explicit column as the primary feed.',
);

assert.match(
  subscriptionCtaCss,
  /@media \(max-width: 560px\)[\s\S]*?\.dd2-subscription-invitation__action\s*\{[^}]*width:\s*100%;/s,
  'The Home subscription CTA must become a full-width phone control.',
);
assert.match(
  subscriptionCtaCss,
  /@media \(max-width: 560px\)[\s\S]*?#site-header\.qfs-shell \.dd2-header-role-copy\s*\{[^}]*display:\s*none;/s,
  'The phone header must reserve room for pricing without duplicating the profile label.',
);
assert.match(
  subscriptionCtaCss,
  /\.dd2-subscription-invitation\s*\{[^}]*grid-template-columns:\s*46px minmax\(0, 1fr\);/s,
  'The invitation copy column must be shrinkable to prevent horizontal overflow.',
);

console.log('Public Home tablet grid and subscription CTA responsive contracts passed.');
