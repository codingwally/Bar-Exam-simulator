import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const [html, config, frontend, renderer, artifactBuilder] = await Promise.all([
  read('index.html'),
  read('assets/phase2-config.js'),
  read('assets/phase2-experience.js'),
  read('assets/pricing-renderer.js'),
  read('scripts/build-pages-artifact.mjs'),
]);

const rendererPosition = html.indexOf('assets/pricing-renderer.js');
const experiencePosition = html.indexOf('assets/phase2-experience.js');
assert.ok(rendererPosition >= 0 && rendererPosition < experiencePosition,
  'the safe shared pricing renderer must load before the public pricing controller');

assert.match(renderer, /DueDiligencePricingRenderer/);
assert.match(renderer, /normalizeConfig/);
assert.match(renderer, /render/);
assert.doesNotMatch(renderer, /\beval\s*\(|new\s+Function\s*\(/,
  'the renderer must not execute configurable content as code');
assert.match(renderer, /escapeHtml\(plan\.name\)/);
assert.match(renderer, /escapeHtml\(faq\.answer\)/);

assert.match(config, /catalogVersion:\s*'server-published-pricing-v1'/);
assert.match(config, /items:\s*Object\.freeze\(\[\]\)/);
assert.doesNotMatch(config, /id:\s*'early_access_beta'|pricePhp:\s*149/,
  'the browser configuration must not carry an authoritative price fallback');

assert.match(frontend, /form\.set\('planVersionId',\s*plan\.versionId\)/);
assert.match(frontend, /form\.set\('paymentChannelVersionId',\s*paymentMethod\.versionId\)/);
assert.doesNotMatch(frontend, /form\.set\('amountPhp'/,
  'payment amount must come from the captured database plan version');
assert.doesNotMatch(frontend, /assets\/payments\/bpi-instapay-149\.png/,
  'the active QR must come from the published payment-channel revision');
assert.match(frontend, /PRICING_OFFER_STALE/);
assert.match(frontend, /Pricing changed before submission\. Nothing was charged or accepted/);
assert.match(frontend, /Payment is not open yet because this plan has no published matching QR/);
assert.match(frontend, /plan\.checkoutOpen !== true/);
assert.match(frontend, /method\.qrAmountMode === 'generic'[\s\S]*amount === Number\(plan\.priceCentavos\)/,
  'an exact-amount QR must match the published plan price');

for (const required of [
  "'assets/pricing-renderer.js'",
  "'assets/pricing-renderer.css'",
  "'admin/pricing-editor.js'",
  "'admin/pricing-editor.css'",
]) {
  assert.ok(artifactBuilder.includes(required), `${required} must ship in the sanitized Pages artifact`);
}

console.log('Published pricing and fail-closed public checkout contract checks passed.');
