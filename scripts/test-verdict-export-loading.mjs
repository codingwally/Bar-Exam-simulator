import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, loader, landing] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
]);

assert.match(loader, /verdict:\s*'content'/,
  'The Verdict must load the content bundle that owns PDF export.');
assert.match(landing, /route === 'subject-matter' \|\| route === 'bar-feels' \|\| route === 'verdict'/,
  'Direct Verdict routes must load their export dependency before opening the dashboard.');
assert.match(html, /async function withVerdictExportApi[\s\S]*loadForFeature\?\.\('verdict'\)/,
  'Verdict export controls must recover the lazy-loaded export API before use.');
assert.match(html, /data-verdict-export-one[\s\S]*withVerdictExportApi\(\(api\) => api\.openVerdictExport/,
  'Single-record export controls must not silently no-op when the bundle is deferred.');
assert.match(html, /verdict-export-selected[\s\S]*withVerdictExportApi\(\(api\) => api\.exportVerdict/,
  'Bulk export must use the same guarded export dependency.');
assert.match(html, /feature-loader\.js[^"\n]*release=subject-matter-gil-fixes-20260817-4/,
  'The feature-loader hotfix must use a fresh browser cache key.');
assert.match(html, /private-beta-landing\.js[^"\n]*v=commercial-launch-20260818-1/,
  'The routed Verdict bundle must use the commercial-launch browser cache key.');

console.log('Verdict export lazy-loading contract checks passed.');
