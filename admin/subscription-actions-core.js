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
    const hasSubscription = Boolean(row?.subscription_id);
    const actions = [];

    if (!hasSubscription || FINAL_STATUSES.has(status) || !status) {
      actions.push(descriptor('Activate Retainer', 'subscription_change', 'activate', 'primary'));
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
    } else if (['cancelled', 'expired'].includes(status) && hasSubscription) {
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
      descriptor('View Audit History', 'subscription_audit_view', 'view'),
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
        ? 'Explicit expiration required. Bar Feels included.'
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
