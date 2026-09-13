(function dueDiligenceSubscriptionActions(root, factory) {
  'use strict';

  const api = Object.freeze(factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DueDiligenceSubscriptionActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSubscriptionActions() {
  'use strict';

  const FOUNDER_ROLES = new Set(['super_admin', 'founder_admin']);
  const LIVE_STATUSES = new Set(['trialing', 'pending_payment', 'active', 'paused']);
  const FINAL_STATUSES = new Set(['cancelled', 'expired', 'refunded']);

  function descriptor(label, action, operation, tone = 'default') {
    return Object.freeze({ label, action, operation, tone });
  }

  function actionsForSubscription(row, actorRole) {
    if (!FOUNDER_ROLES.has(String(actorRole || ''))) return [];

    const status = String(row?.subscription_status || '').toLowerCase();
    const invalidatedPayment = String(row?.subscription_source || '').toLowerCase() === 'invalidated_payment';
    const hasSubscription = Boolean(row?.subscription_id);
    const actions = [];

    if (!hasSubscription || FINAL_STATUSES.has(status) || !status) {
      actions.push(descriptor('Activate Subscription', 'subscription_change', 'activate', 'primary'));
    }

    actions.push(descriptor(
      'Change Plan',
      'subscription_change',
      hasSubscription && !FINAL_STATUSES.has(status) ? 'replace_plan' : 'activate',
      'primary',
    ));

    if (status === 'active') {
      actions.push(
        descriptor('Suspend', 'subscription_change', 'pause'),
        descriptor('Expire now', 'subscription_change', 'expire', 'danger'),
      );
    } else if (status === 'paused') {
      actions.push(descriptor('Resume', 'subscription_change', 'resume', 'primary'));
    } else if (['cancelled', 'expired'].includes(status) && hasSubscription && !invalidatedPayment) {
      actions.push(descriptor('Restore', 'subscription_change', 'restore', 'primary'));
    }

    if (hasSubscription && LIVE_STATUSES.has(status)) {
      actions.push(
        descriptor('Revoke', 'subscription_change', 'cancel', 'danger'),
        descriptor('Extend', 'subscription_change', 'extend'),
        descriptor('Change Start Date', 'subscription_change', 'set_start_date'),
        descriptor('Change Expiration Date', 'subscription_change', 'set_expiration_date'),
      );
    }

    actions.push(
      descriptor(
        row?.free_beta_enabled ? 'Disable Free Beta' : 'Enable Free Beta',
        'free_beta_change',
        row?.free_beta_enabled ? 'disable' : 'enable',
      ),
      descriptor('Grant Complimentary Access', 'subscription_change', 'complimentary'),
      descriptor('Apply Discount', 'discount_assign', 'assign'),
      descriptor('View Activity History', 'subscription_audit_view', 'view'),
    );

    return actions;
  }

  function availablePlans(planConfiguration) {
    return (planConfiguration?.items || []).map((plan) => Object.freeze({
      id: String(plan.id || ''),
      name: String(plan.name || ''),
      pricePhp: Number(plan.pricePhp),
      durationDays: plan.durationDays == null ? null : Number(plan.durationDays),
      disabled: plan.previewStatus === 'disabled',
      statusLabel: plan.previewStatus === 'disabled' ? 'Unavailable' : 'Available',
      note: plan.id === 'premium'
        ? 'Explicit expiration required. Bar Exam Simulation included.'
        : '',
    }));
  }

  function isAccessAction(action) {
    return [
      'subscription_change',
      'free_beta_change',
      'discount_assign',
      'subscription_audit_view',
    ].includes(String(action || ''));
  }

  return {
    actionsForSubscription,
    availablePlans,
    isAccessAction,
  };
});

(function installAdminBulkFetch(global) {
  'use strict';

  if (!global || typeof global.fetch !== 'function' || global.__dueDiligenceAdminBulkFetchInstalled) return;
  global.__dueDiligenceAdminBulkFetchInstalled = true;

  const nativeFetch = global.fetch.bind(global);
  const BULK_PAGE_SIZE = 500;
  const DIRECTORY_BULK_SECTIONS = new Set([
    'paid_subscribers',
    'business_revenue',
    'business_projections',
    'payments',
    'security',
  ]);
  const PHASE4_BULK_SECTIONS = new Set([
    'paid_subscribers',
    'business_revenue',
    'business_projections',
  ]);
  const PHASE4_BULK_DATA = new Set(['payments', 'refunds']);

  function currentSection() {
    return String(global.location?.hash || '')
      .replace(/^#/, '')
      .split('?')[0]
      .trim()
      .toLowerCase();
  }

  global.fetch = function adminBulkFetch(input, init) {
    try {
      const options = init || {};
      if (String(options.method || 'GET').toUpperCase() !== 'POST' || typeof options.body !== 'string') {
        return nativeFetch(input, init);
      }

      const rawUrl = typeof input === 'string' ? input : input?.url;
      if (!rawUrl) return nativeFetch(input, init);

      const url = new URL(rawUrl, global.location?.href || undefined);
      const section = currentSection();
      let body;
      let shouldBulk = false;

      if (url.pathname.endsWith('/admin/user-directory') && DIRECTORY_BULK_SECTIONS.has(section)) {
        body = JSON.parse(options.body);
        shouldBulk = Number(body?.limit) === 100;
      } else if (url.pathname.endsWith('/admin/phase4-data') && PHASE4_BULK_SECTIONS.has(section)) {
        body = JSON.parse(options.body);
        shouldBulk = Number(body?.limit) === 100
          && PHASE4_BULK_DATA.has(String(body?.section || '').trim().toLowerCase());
      }

      if (!shouldBulk || !body || typeof body !== 'object' || Array.isArray(body)) {
        return nativeFetch(input, init);
      }

      body.limit = BULK_PAGE_SIZE;
      body.bulk = true;
      return nativeFetch(input, { ...options, body: JSON.stringify(body) });
    } catch (_error) {
      return nativeFetch(input, init);
    }
  };
})(typeof window !== 'undefined' ? window : null);
