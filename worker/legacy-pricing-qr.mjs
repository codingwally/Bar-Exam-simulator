export const LEGACY_PRICING_QR_CLOSES_AT = '2026-09-13T16:00:00.000Z';
export const LEGACY_PRICING_QR_CLOSES_AT_MS = Date.parse(LEGACY_PRICING_QR_CLOSES_AT);

export function legacyPricingQrAvailableAt(value) {
  const instant = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(instant) && instant < LEGACY_PRICING_QR_CLOSES_AT_MS;
}
