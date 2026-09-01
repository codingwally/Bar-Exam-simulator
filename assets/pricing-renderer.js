(function dueDiligencePricingRenderer(global) {
  'use strict';

  const MANILA_TIME_ZONE = 'Asia/Manila';
  const MAX_PLANS = 20;
  const MAX_PAYMENT_METHODS = 40;
  const MAX_FEATURES = 30;
  const MAX_FAQS = 40;

  function text(value, maximum = 4_000) {
    return String(value ?? '').trim().slice(0, maximum);
  }

  function boolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[character]));
  }

  function normalizeDate(value) {
    const supplied = text(value, 64);
    if (!supplied) return null;
    const parsed = new Date(supplied);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  function normalizePlan(plan, index) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const planCode = text(source.planCode || source.code || source.id, 64).toLowerCase();
    const rawFeatures = Array.isArray(source.features)
      ? source.features
      : String(source.features || '').split(/\r?\n/);
    return Object.freeze({
      versionId: text(source.versionId || source.version_id, 100) || null,
      planCode,
      name: text(source.name, 100) || 'Access plan',
      badge: text(source.badge, 80),
      priceCentavos: integer(
        source.priceCentavos ?? source.priceInCentavos ?? source.price_cents
          ?? (Number.isFinite(Number(source.pricePhp)) ? Number(source.pricePhp) * 100 : 0),
        0,
        0,
        100_000_000,
      ),
      durationDays: integer(source.durationDays ?? source.duration_days, 30, 1, 366),
      description: text(source.description, 4_000),
      features: Object.freeze(rawFeatures
        .map((feature) => text(feature, 240))
        .filter(Boolean)
        .slice(0, MAX_FEATURES)),
      ctaLabel: text(source.ctaLabel || source.buttonLabel || source.cta, 80) || 'Choose plan',
      renewalNote: text(source.renewalNote || source.renewal_note, 1_000),
      visible: boolean(source.visible, true),
      checkoutEnabled: boolean(source.checkoutEnabled ?? source.checkout_enabled, false),
      checkoutStartsAt: normalizeDate(source.checkoutStartsAt ?? source.checkout_starts_at),
      checkoutEndsAt: normalizeDate(source.checkoutEndsAt ?? source.checkout_ends_at),
      displayStartsAt: normalizeDate(source.displayStartsAt ?? source.display_starts_at),
      displayEndsAt: normalizeDate(source.displayEndsAt ?? source.display_ends_at),
      checkoutOpen: typeof source.checkoutOpen === 'boolean' ? source.checkoutOpen : null,
      displayOpen: typeof source.displayOpen === 'boolean' ? source.displayOpen : null,
      entitlementMode: text(source.entitlementMode || source.entitlement_mode, 40) || null,
      fixedEntitlementEndsAt: normalizeDate(
        source.fixedEntitlementEndsAt ?? source.fixed_entitlement_ends_at,
      ),
      sortOrder: integer(source.sortOrder ?? source.sort_order, (index + 1) * 10, -10_000, 10_000),
    });
  }

  function normalizePaymentMethod(method, index) {
    const source = method && typeof method === 'object' ? method : {};
    const rawAsset = source.qrAsset && typeof source.qrAsset === 'object'
      ? source.qrAsset
      : {};
    const assetId = text(rawAsset.assetId || rawAsset.id || source.qrAssetId, 100);
    const suppliedQrUrl = text(source.qrUrl, 2_000);
    const qrUrl = /^\/pricing\/assets\/[0-9a-f-]{36}$/i.test(suppliedQrUrl)
      || suppliedQrUrl === '/pricing/legacy-149-qr.png'
      || /^\/assets\/payments\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g)$/i.test(suppliedQrUrl)
      ? suppliedQrUrl
      : null;
    return Object.freeze({
      versionId: text(source.versionId || source.version_id, 100) || null,
      channelCode: text(source.channelCode || source.code || source.id, 64).toLowerCase(),
      planCode: text(source.planCode, 64).toLowerCase() || null,
      label: text(source.label, 100) || 'Payment method',
      accountName: text(source.accountName, 200),
      accountDetails: text(source.accountDetails, 500),
      instructions: text(source.instructions, 4_000),
      qrAsset: assetId ? Object.freeze({
        assetId,
        sha256: text(rawAsset.sha256 || source.qrAssetSha256, 128),
        mimeType: text(rawAsset.mimeType || source.qrAssetMimeType, 80),
        width: integer(rawAsset.width || source.qrAssetWidth, 0, 0, 20_000),
        height: integer(rawAsset.height || source.qrAssetHeight, 0, 0, 20_000),
      }) : null,
      qrAmountMode: text(source.qrAmountMode, 16).toLowerCase() === 'generic' ? 'generic' : 'exact',
      qrAmountCentavos: source.qrAmountCentavos == null
        ? null
        : integer(source.qrAmountCentavos, 0, 0, 100_000_000),
      qrUrl,
      enabled: boolean(source.enabled, true),
      visible: boolean(source.visible, true),
      sortOrder: integer(source.sortOrder ?? source.sort_order, (index + 1) * 10, -10_000, 10_000),
    });
  }

  function normalizeFaq(faq, index) {
    const source = faq && typeof faq === 'object' ? faq : {};
    return Object.freeze({
      id: text(source.id, 100) || `faq-${index + 1}`,
      question: text(source.question, 300),
      answer: text(source.answer, 3_000),
      visible: boolean(source.visible, true),
      sortOrder: integer(source.sortOrder ?? source.sort_order, (index + 1) * 10, -10_000, 10_000),
    });
  }

  function normalizeConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const pageSource = source.page && typeof source.page === 'object' ? source.page : {};
    const plans = (Array.isArray(source.plans) ? source.plans : [])
      .slice(0, MAX_PLANS)
      .map(normalizePlan)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.planCode.localeCompare(right.planCode));
    const paymentMethods = (Array.isArray(source.paymentMethods) ? source.paymentMethods : [])
      .slice(0, MAX_PAYMENT_METHODS)
      .map(normalizePaymentMethod)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.channelCode.localeCompare(right.channelCode));
    const faqs = (Array.isArray(source.faqs) ? source.faqs : [])
      .slice(0, MAX_FAQS)
      .map(normalizeFaq)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));

    return Object.freeze({
      page: Object.freeze({
        eyebrow: text(pageSource.eyebrow, 120),
        title: text(pageSource.title, 240) || 'Plans & Pricing',
        intro: text(pageSource.intro, 2_000),
        notice: text(pageSource.notice, 2_000),
        finePrint: text(pageSource.finePrint, 2_000),
      }),
      plans: Object.freeze(plans),
      paymentMethods: Object.freeze(paymentMethods),
      faqs: Object.freeze(faqs),
    });
  }

  function pesos(centavos) {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: Number(centavos) % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(Number(centavos || 0) / 100);
  }

  function manilaDateTime(value) {
    const parsed = new Date(value || 0);
    if (!Number.isFinite(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: MANILA_TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }

  function manilaDate(value) {
    const parsed = new Date(value || 0);
    if (!Number.isFinite(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: MANILA_TIME_ZONE,
      dateStyle: 'medium',
    }).format(parsed);
  }

  function planOverride(access, planCode) {
    if (!access || typeof access !== 'object') return null;
    const collection = access.planEligibility || access.plans;
    if (!collection || typeof collection !== 'object') return null;
    const supplied = collection[planCode];
    return supplied && typeof supplied === 'object' ? supplied : null;
  }

  function paymentCompatibility(plan, paymentMethods) {
    const publishable = paymentMethods.filter((method) => (
      method.enabled
      && method.visible
      && Boolean(method.qrUrl || method.qrAsset?.assetId)
      && (!method.planCode || method.planCode === plan.planCode)
    ));
    if (publishable.some((method) => (
      method.qrAmountMode === 'generic'
      || (method.qrAmountMode === 'exact'
        && method.qrAmountCentavos === plan.priceCentavos)
    ))) {
      return { available: true, label: '' };
    }
    return {
      available: false,
      label: publishable.length
        ? 'Update payment QR for this price'
        : 'Payment QR required',
    };
  }

  function planAvailability(plan, paymentMethods, access = {}, useRuntimeState = true) {
    const nowValue = access.serverNow || access.now || Date.now();
    const now = new Date(nowValue).getTime();
    const start = plan.checkoutStartsAt ? new Date(plan.checkoutStartsAt).getTime() : Number.NaN;
    const end = plan.checkoutEndsAt ? new Date(plan.checkoutEndsAt).getTime() : Number.NaN;
    const override = planOverride(access, plan.planCode);

    if (override?.enabled === false || override?.eligible === false) {
      return {
        disabled: true,
        label: text(override.label || override.reason, 160) || 'Not available for this account',
        state: 'ineligible',
      };
    }
    if ((useRuntimeState && plan.checkoutOpen === false) || !plan.checkoutEnabled) {
      return { disabled: true, label: 'Not currently available', state: 'disabled' };
    }
    if (Number.isFinite(start) && start > now) {
      return { disabled: true, label: `Opens ${manilaDateTime(plan.checkoutStartsAt)}`, state: 'upcoming' };
    }
    if (Number.isFinite(end) && end <= now) {
      return { disabled: true, label: 'Enrollment closed', state: 'closed' };
    }
    if (access.canCheckout === false) {
      return {
        disabled: true,
        label: text(access.checkoutMessage, 160) || 'Checkout is unavailable for this account',
        state: 'ineligible',
      };
    }
    const payment = paymentCompatibility(plan, paymentMethods);
    if (!payment.available) {
      return {
        disabled: true,
        label: payment.label,
        state: 'payment_channel_required',
      };
    }
    return { disabled: false, label: '', state: 'available' };
  }

  function planIsDisplayed(plan, access = {}, useRuntimeState = true) {
    if (!plan.visible || (useRuntimeState && plan.displayOpen === false)) return false;
    if (useRuntimeState && plan.displayOpen === true) return true;
    const nowValue = access.serverNow || access.now || Date.now();
    const now = new Date(nowValue).getTime();
    const start = plan.displayStartsAt ? new Date(plan.displayStartsAt).getTime() : Number.NaN;
    const end = plan.displayEndsAt ? new Date(plan.displayEndsAt).getTime() : Number.NaN;
    if (Number.isFinite(start) && start > now) return false;
    if (Number.isFinite(end) && end <= now) return false;
    return true;
  }

  function planHtml(plan, availability) {
    const featureList = plan.features.length
      ? `<ul class="dd-pricing-plan-features">${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>`
      : '';
    const term = plan.entitlementMode === 'fixed_end' && plan.fixedEntitlementEndsAt
      ? `through ${manilaDate(plan.fixedEntitlementEndsAt)}`
      : `for ${plan.durationDays} days`;
    return `<article class="dd-pricing-plan" data-plan-code="${escapeHtml(plan.planCode)}" data-checkout-state="${escapeHtml(availability.state)}">
      <div class="dd-pricing-plan-heading">
        <div>
          ${plan.badge ? `<p class="dd-pricing-plan-badge">${escapeHtml(plan.badge)}</p>` : ''}
          <h2>${escapeHtml(plan.name)}</h2>
        </div>
        <p class="dd-pricing-price"><strong>${escapeHtml(pesos(plan.priceCentavos))}</strong><span>${escapeHtml(term)}</span></p>
      </div>
      ${plan.description ? `<p class="dd-pricing-description">${escapeHtml(plan.description)}</p>` : ''}
      ${featureList}
      ${plan.renewalNote ? `<p class="dd-pricing-renewal">${escapeHtml(plan.renewalNote)}</p>` : ''}
      <button class="dd-pricing-cta" type="button" data-select-plan="${escapeHtml(plan.planCode)}"${availability.disabled ? ' disabled' : ''}>${escapeHtml(availability.disabled ? availability.label : plan.ctaLabel)}</button>
    </article>`;
  }

  function regularPaymentMethod(plan, paymentMethods) {
    return paymentMethods.find((method) => (
      method.enabled
      && method.visible
      && method.channelCode === 'bpi_instapay'
      && method.qrUrl === '/assets/payments/bpi-instapay-199-qr.png'
      && method.planCode === plan.planCode
      && method.qrAmountMode === 'exact'
      && method.qrAmountCentavos === plan.priceCentavos
    )) || null;
  }

  function regularCheckoutHtml(plan, paymentMethod, availability) {
    const exactAmount = (plan.priceCentavos / 100).toFixed(2);
    const qrUrl = paymentMethod?.qrUrl || (paymentMethod?.qrAsset?.assetId
      ? `/pricing/assets/${paymentMethod.qrAsset.assetId}` : '');
    const features = plan.features.map((feature) => `<li>
      <img src="/assets/icons/navigation/circle-check.svg" width="22" height="22" alt="" aria-hidden="true">
      <span>${escapeHtml(feature)}</span>
    </li>`).join('');
    return `<section class="dd-regular-checkout" data-plan-code="${escapeHtml(plan.planCode)}" data-payment-method-version-id="${escapeHtml(paymentMethod?.versionId || '')}" data-checkout-state="${escapeHtml(availability.state)}">
      <section class="dd-regular-summary" aria-labelledby="dd-regular-summary-title">
        <p class="dd-regular-price"><strong>${escapeHtml(pesos(plan.priceCentavos))}</strong><span>${escapeHtml(plan.durationDays)} days from payment</span></p>
        <div class="dd-regular-divider" aria-hidden="true"></div>
        <h2 id="dd-regular-summary-title">Everything included</h2>
        ${plan.description ? `<p class="dd-regular-description">${escapeHtml(plan.description)}</p>` : ''}
        <ul class="dd-regular-features">${features}</ul>
        <div class="dd-regular-assurance">
          <img src="/assets/icons/navigation/shield-check.svg" width="34" height="34" alt="" aria-hidden="true">
          <p>Manual verification required. The ${escapeHtml(plan.durationDays)}-day term begins when payment is made.</p>
        </div>
        <p class="dd-regular-renewal">One-time payment <span aria-hidden="true">·</span> No automatic renewal</p>
      </section>
      <section class="dd-regular-qr" aria-labelledby="dd-regular-qr-title">
        <p class="dd-regular-channel"><span></span>BPI InstaPay<span></span></p>
        <h2 id="dd-regular-qr-title">Pay exactly ₱${escapeHtml(exactAmount)}</h2>
        <figure class="dd-regular-qr-card">
          <img class="dd-regular-bpi-mark" src="/assets/payments/bpi-mark.png" width="110" height="60" alt="BPI">
          <strong>DUE DILIGENCE</strong>
          <img class="dd-regular-qr-image" src="${escapeHtml(qrUrl)}" width="496" height="496" alt="BPI InstaPay QR code for PHP ${escapeHtml(exactAmount)}">
          <figcaption><strong>PHP ${escapeHtml(exactAmount)}</strong><span>Transfer fees may apply</span></figcaption>
        </figure>
      </section>
      <div class="dd-regular-proof-slot" id="dd2-regular-proof-host" aria-live="polite"></div>
    </section>`;
  }

  function render(host, config, options = {}) {
    if (!(host instanceof Element)) throw new TypeError('A pricing preview host is required.');
    const normalized = normalizeConfig(config);
    const mode = options.mode === 'preview' ? 'preview' : 'public';
    const access = {
      ...(options.access && typeof options.access === 'object' ? options.access : {}),
      ...(options.serverNow ? { serverNow: options.serverNow } : {}),
    };
    const useRuntimeState = mode === 'public';
    const plans = normalized.plans.filter((plan) => (
      mode === 'preview' ? plan.visible : planIsDisplayed(plan, access, useRuntimeState)
    ));
    const faqs = normalized.faqs.filter((faq) => faq.visible && faq.question && faq.answer);
    const availabilityByPlan = new Map(plans.map((plan) => [
      plan.planCode,
      planAvailability(plan, normalized.paymentMethods, access, useRuntimeState),
    ]));

    const regularPlan = mode === 'public' && plans.length === 1
      && plans[0].planCode === 'bar_access_30d'
      ? plans[0] : null;
    const regularAvailability = regularPlan
      ? availabilityByPlan.get(regularPlan.planCode) : null;
    const regularMethod = regularPlan
      ? regularPaymentMethod(regularPlan, normalized.paymentMethods) : null;
    if (regularPlan && regularAvailability?.disabled === false && regularMethod) {
      host.innerHTML = `<section class="dd-pricing dd-pricing-regular" data-pricing-mode="${mode}">
        ${regularCheckoutHtml(regularPlan, regularMethod, regularAvailability)}
      </section>`;
      return normalized;
    }

    host.innerHTML = `<section class="dd-pricing" data-pricing-mode="${mode}">
      <header class="dd-pricing-hero">
        ${normalized.page.eyebrow ? `<p class="dd-pricing-eyebrow">${escapeHtml(normalized.page.eyebrow)}</p>` : ''}
        <h1>${escapeHtml(normalized.page.title)}</h1>
        ${normalized.page.intro ? `<p class="dd-pricing-intro">${escapeHtml(normalized.page.intro)}</p>` : ''}
        ${normalized.page.notice ? `<p class="dd-pricing-notice">${escapeHtml(normalized.page.notice)}</p>` : ''}
      </header>
      <div class="dd-pricing-plans">${plans.length
    ? plans.map((plan) => planHtml(plan, availabilityByPlan.get(plan.planCode))).join('')
    : '<p class="dd-pricing-empty">No plans are currently available.</p>'}</div>
      ${faqs.length ? `<section class="dd-pricing-faqs" aria-labelledby="dd-pricing-faq-title">
        <h2 id="dd-pricing-faq-title">Questions</h2>
        ${faqs.map((faq) => `<details><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p></details>`).join('')}
      </section>` : ''}
      ${normalized.page.finePrint ? `<p class="dd-pricing-fine-print">${escapeHtml(normalized.page.finePrint)}</p>` : ''}
    </section>`;

    host.querySelectorAll('[data-select-plan]').forEach((button) => {
      const plan = plans.find((item) => item.planCode === button.dataset.selectPlan);
      if (!plan || button.disabled || typeof options.onSelectPlan !== 'function') return;
      button.addEventListener('click', () => options.onSelectPlan(plan));
    });

    return normalized;
  }

  global.DueDiligencePricingRenderer = Object.freeze({
    normalizeConfig,
    render,
  });
})(window);
