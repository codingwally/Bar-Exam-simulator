(function subscriptionCtaModule(global) {
  'use strict';

  const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
  const EXPIRED_SUBSCRIPTION_STATUSES = new Set([
    'canceled',
    'cancelled',
    'expired',
    'incomplete_expired',
    'past_due',
    'paused',
    'unpaid',
  ]);

  function normalized(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  }

  function accessText(access) {
    const subscription = access?.subscription || {};
    return [
      access?.role,
      access?.basis,
      access?.accessMode,
      access?.accountLabel,
      subscription.planCode,
      subscription.status,
      subscription.source,
    ].map(normalized).filter(Boolean).join(' | ');
  }

  function isAdmin(access) {
    return normalized(access?.role) === 'admin' || /(^|\| )admin( \||$)/.test(accessText(access));
  }

  function isFoundingBeta(access) {
    const text = accessText(access);
    return access?.freeBeta?.active === true
      || text.includes('founding beta')
      || text.includes('founding member');
  }

  function hasActivePaidSubscription(access) {
    const subscription = access?.subscription || {};
    const status = normalized(subscription.status);
    const text = accessText(access);
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false;
    return /paid|subscriber|subscription|monthly|annual|yearly|premium|supporter/.test(text)
      || Boolean(subscription.planCode)
      || normalized(subscription.source) === 'stripe';
  }

  function isIntroductory(access) {
    const text = accessText(access);
    return access?.introductoryTokensEligible === true
      || text.includes('introductory')
      || text.includes('intro plan');
  }

  function hasCurrentPaidEquivalentAccess(access) {
    const text = accessText(access);
    return access?.unlimited === true
      || access?.globalBeta?.active === true
      || access?.trial?.active === true
      || /complimentary|sponsored|faculty access|professor access|paid access|unlimited access/.test(text);
  }

  function isExpiredOrUnpaid(access) {
    const subscription = access?.subscription || null;
    const status = normalized(subscription?.status);
    if (access?.paidSubscriptionExpired === true) return true;
    if (EXPIRED_SUBSCRIPTION_STATUSES.has(status)) return true;
    return !subscription || !status || status === 'none' || status === 'inactive';
  }

  function isAudienceEligible(access) {
    if (!access || typeof access !== 'object') return false;
    if (isAdmin(access)) return true;
    if (isFoundingBeta(access)) return true;
    if (hasActivePaidSubscription(access)) return false;
    if (isIntroductory(access)) return true;
    if (hasCurrentPaidEquivalentAccess(access)) return false;
    return isExpiredOrUnpaid(access);
  }

  let currentAccess = null;
  let currentSession = null;
  let currentVisibility = false;
  let lastPublishedVisibility = null;

  function sessionFromRuntime() {
    return global.DueDiligencePhase2?.getSession?.()
      || global.DueDiligencePhase2?.currentSession?.()
      || null;
  }

  function accessFromRuntime() {
    return global.DueDiligencePhase4?.getAccess?.() || null;
  }

  function isSignedIn(session) {
    return Boolean(session?.user || session?.access_token);
  }

  function featureIsPresent() {
    return Boolean(global.document?.getElementById('dd2-header-pricing-button'));
  }

  function publishVisibility() {
    if (!global.document) return;
    const signedIn = isSignedIn(currentSession);
    const visible = featureIsPresent() && signedIn && isAudienceEligible(currentAccess);
    const pricingButton = global.document.getElementById('dd2-header-pricing-button');
    const duplicateAccountBadge = global.document.getElementById('dd2-guest-badge');

    currentVisibility = visible;
    if (pricingButton) {
      pricingButton.hidden = !visible;
      pricingButton.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (signedIn && duplicateAccountBadge) {
      duplicateAccountBadge.hidden = true;
      duplicateAccountBadge.setAttribute('aria-hidden', 'true');
    }
    global.document.documentElement.classList.toggle('dd2-subscription-cta-visible', visible);

    if (lastPublishedVisibility === visible) return;
    lastPublishedVisibility = visible;
    global.dispatchEvent(new global.CustomEvent('duediligence:subscription-cta', {
      detail: { visible },
    }));
  }

  function refresh(overrides = {}) {
    currentSession = Object.prototype.hasOwnProperty.call(overrides, 'session')
      ? overrides.session
      : sessionFromRuntime();
    currentAccess = Object.prototype.hasOwnProperty.call(overrides, 'access')
      ? overrides.access
      : accessFromRuntime();
    publishVisibility();
    return currentVisibility;
  }

  function appendTextElement(parent, tagName, className, text) {
    const element = global.document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function createHomeInvitation() {
    if (!global.document || !currentVisibility) return null;

    const article = global.document.createElement('article');
    article.className = 'dd2-subscription-invitation';
    article.id = 'dd2-subscription-team-post';
    article.setAttribute('aria-labelledby', 'dd2-subscription-team-post-title');

    const identity = global.document.createElement('div');
    identity.className = 'dd2-subscription-invitation__identity';
    const logo = global.document.createElement('img');
    logo.className = 'dd2-subscription-invitation__logo';
    logo.src = 'assets/brand/icon-192.png';
    logo.alt = 'Due Diligence';
    logo.width = 52;
    logo.height = 52;
    logo.decoding = 'async';
    identity.append(logo);

    const identityCopy = global.document.createElement('div');
    appendTextElement(identityCopy, 'strong', '', 'Due Diligence Team');
    const metadata = global.document.createElement('div');
    metadata.className = 'dd2-subscription-invitation__metadata';
    appendTextElement(metadata, 'span', '', 'A note from the team');
    appendTextElement(metadata, 'span', 'dd2-subscription-invitation__pin', 'Pinned');
    identityCopy.append(metadata);
    identity.append(identityCopy);

    const body = global.document.createElement('div');
    body.className = 'dd2-subscription-invitation__body';
    const title = appendTextElement(
      body,
      'h3',
      '',
      'Your journey deserves a platform that keeps getting better.',
    );
    title.id = 'dd2-subscription-team-post-title';
    appendTextElement(
      body,
      'p',
      'dd2-subscription-invitation__message',
      'Due Diligence is maintained by diligent law students, advised by law professors, and developed in consultation with practicing lawyers. Your subscription gives you continued access to focused Bar-style practice, clearer guidance, progress tools, and every improvement we build next. It also helps us keep this community reliable and growing for future lawyers.',
    );

    const action = global.document.createElement('button');
    action.className = 'dd2-subscription-invitation__action';
    action.type = 'button';
    action.dataset.dd2View = 'pricing';
    action.setAttribute('aria-label', 'Continue your journey. View plans and pricing.');
    appendTextElement(action, 'span', '', 'Continue your journey · View plans and pricing');
    const arrow = global.document.createElement('img');
    arrow.src = 'assets/icons/community/caret-right.svg';
    arrow.alt = '';
    arrow.width = 16;
    arrow.height = 16;
    arrow.setAttribute('aria-hidden', 'true');
    action.append(arrow);
    body.append(action);

    article.append(identity, body);
    return article;
  }

  const api = Object.freeze({
    createHomeInvitation,
    isAudienceEligible,
    refresh,
    shouldShow: () => currentVisibility,
  });
  global.DueDiligenceSubscriptionCta = api;

  if (!global.document) return;

  function accessEventHandler(event) {
    const detail = event?.detail;
    refresh({ access: detail?.access || detail || accessFromRuntime() });
  }

  function sessionEventHandler(event) {
    const detail = event?.detail;
    const runtimeSession = sessionFromRuntime();
    refresh({
      session: detail?.session
        || runtimeSession
        || (detail?.authenticated === true ? { access_token: 'authenticated-session' } : null),
    });
  }

  global.addEventListener('duediligence:access', accessEventHandler);
  global.addEventListener('duediligence:session', sessionEventHandler);
  global.document.addEventListener('duediligence:access', accessEventHandler);
  global.document.addEventListener('duediligence:session', sessionEventHandler);

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', () => refresh(), { once: true });
  } else {
    refresh();
  }
  Promise.resolve(global.DueDiligencePhase2?.whenAuthReady?.()).then(() => refresh()).catch(() => {});
})(typeof window !== 'undefined' ? window : globalThis);
