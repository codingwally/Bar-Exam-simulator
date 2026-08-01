import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const adminHtml = read('admin/index.html');
const adminCss = read('admin/admin.css');
const admin = read('admin/admin.js');

assert.match(index, /id="site-menu-toggle"[^>]+aria-controls="spa-nav"/);
assert.match(index, /id="spa-nav"[^>]+aria-label="Primary navigation"/);
assert.match(index, /function setSiteMenuOpen\(open\)/);
assert.doesNotMatch(
  index,
  /\.spa-nav\{[^}]*overflow-x:auto/,
  'Primary navigation must reflow instead of requiring horizontal page navigation.',
);

assert.match(adminHtml, /id="insight-dialog"[^>]+aria-labelledby="insight-title"/);
assert.match(adminHtml, /id="sidebar-scrim"[^>]+type="button"/);
assert.match(admin, /class="metric" \$\{destination\}/);
assert.match(admin, /data-admin-section=/);
assert.match(admin, /class="bar-row" data-insight=/);
assert.match(admin, /data-label="\$\{escapeHtml\(headers\[index\]/);
assert.match(admin, /function cellText\(cell\)/);
assert.doesNotMatch(
  admin,
  /escapeHtml\(cell\)/,
  'Structured table cells must not stringify as [object Object].',
);
assert.match(admin, /document\.createElement\('details'\)/);
assert.match(admin, /menu\.className = 'action-menu'/);
assert.match(admin, /setAttribute\('aria-busy', 'true'\)/);
assert.match(admin, /button\.textContent = 'Refreshing…'/);

assert.match(adminCss, /@media \(max-width: 820px\)[\s\S]*\.table-wrap td::before/);
assert.match(adminCss, /@media \(max-width: 560px\)[\s\S]*\.exam-admin-form \{ grid-template-columns: minmax\(0, 1fr\); \}/);
assert.match(adminCss, /\.exam-admin-form input,[\s\S]*min-width: 0; max-width: 100%;/);
assert.match(adminCss, /\.action-menu-popover/);
assert.match(adminCss, /\.insight-dialog/);
assert.match(adminCss, /\.sidebar-scrim\[hidden\]/);

console.log('Release B responsive navigation, admin drilldown, and action-menu contracts passed.');
