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
    nextServerMinuteDelay,
    imageReady,
    scheduleOneShotRefresh,
    cancelScheduledRefresh,
  });
})(typeof window !== 'undefined' ? window : globalThis);
