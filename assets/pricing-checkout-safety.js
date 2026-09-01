(function pricingCheckoutSafety(global) {
  'use strict';

  function cleanId(value) {
    return String(value || '').trim();
  }

  function captureProof(file, planVersionId, paymentMethodVersionId) {
    if (!file) return null;
    const planId = cleanId(planVersionId);
    const methodId = cleanId(paymentMethodVersionId);
    if (!planId || !methodId) return null;
    return Object.freeze({ file, planVersionId: planId, paymentMethodVersionId: methodId });
  }

  function reconcileProof(selection, planVersionId, paymentMethodVersionId) {
    if (!selection?.file) return Object.freeze({ matched: false, cleared: false, file: null });
    const matched = cleanId(selection.planVersionId) === cleanId(planVersionId)
      && cleanId(selection.paymentMethodVersionId) === cleanId(paymentMethodVersionId);
    return Object.freeze({
      matched,
      cleared: !matched,
      file: matched ? selection.file : null,
    });
  }

  function captureCheckoutBinding(formOpen, revisionId, planVersionId, paymentMethodVersionId) {
    if (formOpen !== true) return null;
    const pricingRevisionId = cleanId(revisionId);
    const planId = cleanId(planVersionId);
    const methodId = cleanId(paymentMethodVersionId);
    if (!pricingRevisionId || !planId || !methodId) return null;
    return Object.freeze({
      revisionId: pricingRevisionId,
      planVersionId: planId,
      paymentMethodVersionId: methodId,
    });
  }

  function reconcileCheckoutBinding(binding, revisionId, plans, compatibleMethods) {
    if (!binding) {
      return Object.freeze({ matched: false, stale: false, plan: null, method: null });
    }
    const plan = (Array.isArray(plans) ? plans : []).find((candidate) => (
      cleanId(candidate?.versionId) === cleanId(binding.planVersionId)
    ));
    const method = (Array.isArray(compatibleMethods) ? compatibleMethods : []).find((candidate) => (
      cleanId(candidate?.versionId) === cleanId(binding.paymentMethodVersionId)
    ));
    const matched = Boolean(
      cleanId(binding.revisionId) === cleanId(revisionId)
      && plan
      && plan.checkoutOpen === true
      && plan.checkoutEnabled !== false
      && method
      && method.enabled !== false
      && method.visible !== false,
    );
    return Object.freeze({
      matched,
      stale: !matched,
      plan: matched ? plan : null,
      method: matched ? method : null,
    });
  }

  function nextServerMinuteDelay(serverNow) {
    const serverTime = Date.parse(String(serverNow || ''));
    if (!Number.isFinite(serverTime)) return null;
    const nextMinute = (Math.floor(serverTime / 60_000) + 1) * 60_000;
    return Math.max(250, Math.min(60_250, nextMinute - serverTime + 125));
  }

  function imageReady(image) {
    return Boolean(image?.complete && Number(image.naturalWidth) > 0);
  }

  function scheduleOneShotRefresh(options = {}) {
    const delay = nextServerMinuteDelay(options.serverNow);
    if (delay == null || typeof options.setTimer !== 'function'
        || typeof options.fetchPlans !== 'function'
        || typeof options.onPayload !== 'function') return null;
    const active = typeof options.isActive === 'function'
      ? options.isActive : () => true;
    return options.setTimer(async () => {
      if (!active()) return;
      try {
        const payload = await options.fetchPlans();
        if (!active()) return;
        // Always deliver the trusted snapshot. Checkout-open/display-open can
        // change at a boundary even when a broken schedule leaves the same
        // revision selected, and the UI must fail closed rather than stay stale.
        await options.onPayload(payload);
      } catch (error) {
        if (active() && typeof options.onError === 'function') {
          await options.onError(error);
        }
      }
    }, delay);
  }

  function cancelScheduledRefresh(timerId, clearTimer) {
    if (timerId != null && typeof clearTimer === 'function') clearTimer(timerId);
    return null;
  }

  global.DueDiligencePricingCheckoutSafety = Object.freeze({
    captureProof,
    reconcileProof,
    captureCheckoutBinding,
    reconcileCheckoutBinding,
    nextServerMinuteDelay,
    imageReady,
    scheduleOneShotRefresh,
    cancelScheduledRefresh,
  });
})(typeof window !== 'undefined' ? window : globalThis);
