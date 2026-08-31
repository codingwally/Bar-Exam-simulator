import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/pricing-checkout-safety.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'pricing-checkout-safety.js' });
const safety = context.DueDiligencePricingCheckoutSafety;

test('proof continuity is bound to the exact plan and payment channel', () => {
  const file = Object.freeze({ name: 'receipt.png', size: 1_024, type: 'image/png' });
  const captured = safety.captureProof(file, 'plan-149', 'method-149');
  assert.equal(safety.reconcileProof(captured, 'plan-149', 'method-149').file, file);
  assert.deepEqual(
    JSON.parse(JSON.stringify(safety.reconcileProof(captured, 'plan-199', 'method-199'))),
    { matched: false, cleared: true, file: null },
  );
});

test('already-open checkout refresh uses the trusted next server minute and always delivers the new snapshot', async () => {
  let scheduled = null;
  const delivered = [];
  const payload = {
    revisionId: 'same-revision-id',
    serverNow: '2026-09-13T16:00:00.100Z',
    pricing: { plans: [{ priceCentavos: 19900, checkoutOpen: true }] },
  };
  const timerId = safety.scheduleOneShotRefresh({
    serverNow: '2026-09-13T15:59:30.000Z',
    setTimer(callback, delay) {
      scheduled = { callback, delay };
      return 71;
    },
    isActive: () => true,
    fetchPlans: async () => payload,
    onPayload: async (value) => delivered.push(value),
  });
  assert.equal(timerId, 71);
  assert.equal(scheduled.delay, 30_125);
  await scheduled.callback();
  assert.deepEqual(delivered, [payload]);
});

test('same revision with a newly closed checkout is still delivered fail-closed', async () => {
  let callback;
  const closed = {
    revisionId: 'unchanged-revision',
    serverNow: '2026-09-13T16:00:00.000Z',
    pricing: { plans: [{ priceCentavos: 14900, checkoutOpen: false, displayOpen: false }] },
  };
  let delivered = null;
  safety.scheduleOneShotRefresh({
    serverNow: '2026-09-13T15:59:59.900Z',
    setTimer(fn) { callback = fn; return 72; },
    isActive: () => true,
    fetchPlans: async () => closed,
    onPayload: async (value) => { delivered = value; },
  });
  await callback();
  assert.equal(delivered, closed);
  assert.equal(delivered.pricing.plans[0].checkoutOpen, false);
});

test('refresh failure invokes the production pause path and inactive views receive nothing', async () => {
  let callback;
  let paused = 0;
  safety.scheduleOneShotRefresh({
    serverNow: '2026-09-13T15:59:59.900Z',
    setTimer(fn) { callback = fn; return 73; },
    isActive: () => true,
    fetchPlans: async () => { throw new Error('network unavailable'); },
    onPayload: async () => assert.fail('failed refresh must not deliver stale data'),
    onError: async () => { paused += 1; },
  });
  await callback();
  assert.equal(paused, 1);

  let inactiveFetches = 0;
  safety.scheduleOneShotRefresh({
    serverNow: '2026-09-13T15:59:59.900Z',
    setTimer(fn) { callback = fn; return 74; },
    isActive: () => false,
    fetchPlans: async () => { inactiveFetches += 1; return {}; },
    onPayload: async () => assert.fail('closed view must receive nothing'),
  });
  await callback();
  assert.equal(inactiveFetches, 0);
});

test('QR readiness and timer cleanup are fail-closed', () => {
  assert.equal(safety.imageReady({ complete: true, naturalWidth: 496 }), true);
  assert.equal(safety.imageReady({ complete: true, naturalWidth: 0 }), false);
  assert.equal(safety.imageReady({ complete: false, naturalWidth: 496 }), false);
  const cleared = [];
  assert.equal(safety.cancelScheduledRefresh(88, (id) => cleared.push(id)), null);
  assert.deepEqual(cleared, [88]);
});
