import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, js] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin-observatory.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
]);

for (const group of [
  'Overview', 'People &amp; Marketing', 'Learning', 'Commercial',
  'Support &amp; Community', 'Business', 'Security &amp; Operations',
]) assert.match(html, new RegExp(group.replace('&', '&amp;').replace('&amp;amp;', '&amp;')));

for (const label of [
  'Executive Pulse', 'Live Activity', 'Users', 'Sign-ups', 'Acquisition',
  'Answers', 'Subject Performance', 'Grading Health', 'Subscriptions',
  'Payments', 'Refunds', 'Support', 'Corrections', 'Community Moderation',
  'Revenue', 'Projections', 'Comparisons', 'Audit Log', 'Controls',
]) assert.match(html, new RegExp(`<span>${label}</span>`));

const navigationSections = [...html.matchAll(/data-section="([a-z_]+)"/g)]
  .map((match) => match[1]);
assert.ok(navigationSections.length >= 20, 'Executive navigation should expose the complete admin toolset.');
for (const section of navigationSections) {
  assert.match(js, new RegExp(`\\b${section}:\\s*['\"]`), `${section} must have a title.`);
  assert.match(js, new RegExp(`section === ['\"]${section}['\"]`), `${section} must have a renderer route.`);
}

for (const control of [
  'refresh-dashboard', 'download-current-section', 'menu-button', 'sidebar-collapse',
]) assert.match(js, new RegExp(`\\$\\('#${control}'\\)\\?\\.addEventListener`));

for (const id of [
  'observatory-activity-chart', 'observatory-user-mix-chart',
  'observatory-device-chart', 'observatory-funnel-chart',
  'observatory-revenue-chart', 'observatory-subject-chart',
]) assert.match(js, new RegExp(id));

assert.match(js, /Signed-in accounts/);
assert.match(js, /Answering users/);
assert.match(js, /Questions answered/);
assert.match(js, /Grading success/);
assert.doesNotMatch(js, /'Not collected', 'Not collected'/);
assert.match(js, /\['Name', 'Email', 'School', 'Last sign-in', 'Region', 'Device'/);
assert.match(js, /accountRegion\(account\), accountDevice\(account\)/);
assert.match(js, /stacked:\s*true/);
assert.match(js, /Available after next sign-in/);
assert.match(js, /not bank settlement/i);
assert.doesNotMatch(js, /forecast-guaranteed revenue[^\n]*executiveVisuals/i);

assert.match(css, /executive-chart-grid-top/);
assert.match(css, /grid-template-columns:\s*226px/);
assert.match(css, /admin-sidebar-collapsed/);
assert.match(css, /dashboard-loading/);
assert.match(css, /@media \(max-width: 920px\)/);
assert.match(css, /@media \(min-width: 921px\)[\s\S]*\.menu-button \{ display: none !important; \}/);
assert.match(css, /prefers-reduced-motion/);

assert.match(html, /private-beta-session\.js/);
assert.doesNotMatch(js, /visualPreview|installVisualPreviewFixture|local-preview-only/);

console.log('Executive Pulse structure, real-data labels, responsive layout, and navigation contracts passed.');
