import assert from 'node:assert/strict';
import test from 'node:test';
import { patchImageSource, patchIndex, QR_VERSION } from './prepare-payment-qr-browser-cache-recovery.mjs';

test('regular and fallback checkout image URLs both bypass stale QR caches', () => {
  const original = '<picture><img src="${escapeHtml(qrUrl)}" alt="payment QR">';
  const result = patchImageSource(original);
  assert.match(result, /qrUrl === '\/assets\/payments\/bpi-instapay-199-qr\.png'/u);
  assert.ok(result.includes('?payment-qr=' + QR_VERSION));
  assert.ok(result.includes(': qrUrl'));
  assert.throws(() => patchImageSource(result), /Expected exactly one/u);
});

test('new visitor loads versioned checkout JS without altering other homepage references', () => {
  const original = '<script src="assets/pricing-renderer.js?v=regular-checkout-r2"></script>\n' +
    '<script src="assets/phase2-experience.js?v=baseline&amp;pricing=regular-checkout-r3"></script>\n' +
    '<script src="assets/some-unrelated-file.js?v=baseline"></script>';
  const result = patchIndex(original);
  assert.equal((result.match(/payment-qr=84959f96cfa8cbe9/gu) || []).length, 2);
  assert.ok(result.includes('<script src="assets/some-unrelated-file.js?v=baseline"></script>'));
  assert.throws(() => patchIndex(result), /Expected one regular pricing renderer/u);
});
