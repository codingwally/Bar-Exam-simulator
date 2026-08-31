import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_PRICING_QR_CLOSES_AT_MS,
  legacyPricingQrAvailableAt,
} from './legacy-pricing-qr.mjs';

test('legacy QR is available immediately before the Manila cutover', () => {
  assert.equal(legacyPricingQrAvailableAt(LEGACY_PRICING_QR_CLOSES_AT_MS - 1), true);
});

test('legacy QR closes at the exact Manila cutover and stays closed', () => {
  assert.equal(legacyPricingQrAvailableAt(LEGACY_PRICING_QR_CLOSES_AT_MS), false);
  assert.equal(legacyPricingQrAvailableAt(LEGACY_PRICING_QR_CLOSES_AT_MS + 1), false);
});

test('invalid instants fail closed', () => {
  assert.equal(legacyPricingQrAvailableAt(Number.NaN), false);
  assert.equal(legacyPricingQrAvailableAt('not-a-date'), false);
});
