import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const [html, config, frontend, renderer, artifactBuilder, pricingMigration] = await Promise.all([
  read('index.html'),
  read('assets/phase2-config.js'),
  read('assets/phase2-experience.js'),
  read('assets/pricing-renderer.js'),
  read('scripts/build-pages-artifact.mjs'),
  read('supabase/migrations/20260830054727_admin_pricing_revisions.sql'),
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
assert.match(renderer, /visible:\s*boolean\(source\.visible, true\)/,
  'payment-channel visibility must survive the shared renderer/Admin round trip');

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

assert.match(
  pricingMigration,
  /check \(not enabled or qr_asset_id is not null or qr_public_path is not null\)/,
  'disabled future channels may be saved without a QR, but an enabled channel must have one',
);
assert.match(
  pricingMigration,
  /v_asset_id is null and v_qr_url is null[\s\S]{0,120}coalesce\(\(v_method->>'enabled'\)::boolean, true\)/,
  'draft persistence must reject a missing QR only when the payment method is enabled',
);
assert.match(
  pricingMigration,
  /c\.enabled and c\.visible[\s\S]{0,100}\(c\.qr_asset_id is not null or c\.qr_public_path is not null\)/,
  'public and checkout database paths must explicitly omit channels without a QR',
);
assert.match(
  pricingMigration,
  /qrAmountMode', 'exact'\) = 'exact'[\s\S]{0,180}Exact QR amount is required/,
  'database draft persistence must require a captured amount whenever QR mode is exact',
);
assert.doesNotMatch(
  pricingMigration,
  /v_amount is null and v_plan_version_id is not null[\s\S]{0,180}price_centavos into v_amount/,
  'database persistence must not silently relabel an exact QR with the plan price',
);

for (const required of [
  "'assets/pricing-renderer.js'",
  "'assets/pricing-renderer.css'",
  "'admin/pricing-editor.js'",
  "'admin/pricing-editor.css'",
]) {
  assert.ok(artifactBuilder.includes(required), `${required} must ship in the sanitized Pages artifact`);
}

console.log('Published pricing and fail-closed public checkout contract checks passed.');
