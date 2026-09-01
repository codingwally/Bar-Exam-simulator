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

test('active checkout continuity requires the exact current revision, plan, and compatible QR method', () => {
  const plan = Object.freeze({
    versionId: 'plan-149-v1',
    planCode: 'legacy_access_149',
    checkoutOpen: true,
    checkoutEnabled: true,
  });
  const method = Object.freeze({
    versionId: 'method-149-v1',
    enabled: true,
    visible: true,
  });
  const binding = safety.captureCheckoutBinding(
    true,
    'revision-149',
    plan.versionId,
    method.versionId,
  );
  const continuity = safety.reconcileCheckoutBinding(
    binding,
    'revision-149',
    [plan],
    [method],
  );
  assert.equal(continuity.matched, true);
  assert.equal(continuity.plan, plan);
  assert.equal(continuity.method, method);

  const file = Object.freeze({ name: 'receipt.jpg', size: 2_048, type: 'image/jpeg' });
  const proof = safety.captureProof(file, plan.versionId, method.versionId);
  assert.equal(
    safety.reconcileProof(proof, continuity.plan.versionId, continuity.method.versionId).file,
    file,
  );
});

test('changed or closed checkout bindings fail closed and cannot inherit proof by plan code', () => {
  const originalPlan = Object.freeze({
    versionId: 'plan-149-v1',
    planCode: 'legacy_access',
    checkoutOpen: true,
    checkoutEnabled: true,
  });
  const originalMethod = Object.freeze({
    versionId: 'method-149-v1',
    enabled: true,
    visible: true,
  });
  const binding = safety.captureCheckoutBinding(
    true,
    'revision-149',
    originalPlan.versionId,
    originalMethod.versionId,
  );
  const cases = [
    ['published revision changed', 'revision-199', [originalPlan], [originalMethod]],
    ['same plan code but version changed', 'revision-149', [{ ...originalPlan, versionId: 'plan-199-v2' }], [originalMethod]],
    ['payment method version changed', 'revision-149', [originalPlan], [{ ...originalMethod, versionId: 'method-199-v2' }]],
    ['checkout closed at cutoff', 'revision-149', [{ ...originalPlan, checkoutOpen: false }], [originalMethod]],
    ['checkout disabled', 'revision-149', [{ ...originalPlan, checkoutEnabled: false }], [originalMethod]],
    ['method disabled', 'revision-149', [originalPlan], [{ ...originalMethod, enabled: false }]],
    ['method incompatible or QR rejected', 'revision-149', [originalPlan], []],
  ];
  for (const [label, revisionId, plans, methods] of cases) {
    const result = safety.reconcileCheckoutBinding(binding, revisionId, plans, methods);
    assert.equal(result.matched, false, label);
    assert.equal(result.stale, true, label);
    assert.equal(result.plan, null, label);
    assert.equal(result.method, null, label);
  }
  assert.equal(
    safety.captureCheckoutBinding(false, 'revision-149', originalPlan.versionId, originalMethod.versionId),
    null,
    'success markup without an active form must not be reopened',
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
