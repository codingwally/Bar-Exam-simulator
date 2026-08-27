import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile('assets/lex-forum.css', 'utf8');
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

console.log('Public Home tablet grid contract passed.');
