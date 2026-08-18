(function phase4Experience(global) {
  'use strict';

  const legacy = global.DueDiligencePhase2;
  const config = global.DueDiligencePhase2Config;
  if (!legacy || !config) return;

  const state = {
    access: null,
    accessPromise: null,
    mandatoryPricing: false,
    gateNoticeShown: false,
    observer: null,
    refreshTimer: null,
  };

  function randomId(byteLength = 20) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function session() {
    return legacy.getSession?.() || null;
  }

  function authenticatedHeaders(options = {}) {
    const active = session();
    if (!active?.access_token) return null;
    return {
      Authorization: `Bearer ${active.access_token}`,
      ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      ...(options.json === false ? {} : { 'Content-Type': 'application/json' }),
      ...(options.requestId === false
        ? {}
        : { 'X-Request-ID': options.requestIdValue || randomId(18) }),
    };
  }

  function requireAuthentication() {
    if (session()?.access_token) return true;
    legacy.openSignIn?.();
    global.toast?.('Sign in with Google to open an examination.', 'warn');
    return false;
  }

  function paymentRequired(access = state.access) {
    return access?.basis === 'payment_required'
      || (
        access?.commercialLaunchEnabled === true
        && access?.allowed !== true
        && access?.termsRequired !== true
        && access?.accessMode === 'locked'
      );
  }

  function accessMessage(access) {
    if (access?.termsRequired) {
      return 'Review and accept the current Terms of Use and Privacy Policy before continuing.';
    }
    if (paymentRequired(access)) {
      return 'Early Access is required. Subscribe for the one-time ₱149 launch offer and submit your payment proof to continue.';
    }
    return 'Access is not currently available for this account. Review The Docket or contact Support.';
  }

  function overlayOpen(id) {
    const element = document.getElementById(id);
    if (!element) return false;
    return element.classList.contains('is-open')
      || element.getAttribute('aria-hidden') === 'false';
  }

  function onboardingOrSignInOpen() {
    return overlayOpen('dd2-onboarding-overlay') || overlayOpen('dd2-entry-overlay');
  }

  function mandatoryControlState(required) {
    for (const id of ['dd2-native-close', 'dd2-native-back']) {
      const control = document.getElementById(id);
      if (!control) continue;
      if (required) {
        if (!control.hidden) control.hidden = true;
        if (!control.disabled) control.disabled = true;
        if (control.getAttribute('aria-hidden') !== 'true') {
          control.setAttribute('aria-hidden', 'true');
        }
      } else {
        if (control.hidden) control.hidden = false;
        if (control.disabled) control.disabled = false;
        if (control.hasAttribute('aria-hidden')) control.removeAttribute('aria-hidden');
      }
    }
    const view = document.getElementById('dd2-native-view');
    if (view) view.toggleAttribute('data-access-choice-required', required);
  }

  function replaceFollowingParagraph(heading, copy) {
    const paragraph = heading?.nextElementSibling;
    if (paragraph?.tagName === 'P' && paragraph.textContent !== copy) {
      paragraph.textContent = copy;
    }
  }

  function patchCommercialCopy() {
    const body = document.getElementById('dd2-native-body');
    if (!body) return;

    const pricingHost = document.getElementById('dd2-pricing-plans');
    if (pricingHost) {
      body.querySelectorAll('.dd2-plan').forEach((card) => {
        if (card.querySelector('h3')?.textContent?.trim().toLowerCase() === 'free') {
          card.remove();
        }
      });
      const intro = body.querySelector('.dd2-pricing-intro');
      if (intro && intro.dataset.ddPaidCopy !== 'true') {
        intro.innerHTML = '<strong>Early Access is required for protected features.</strong> Subscribe for the one-time ₱149 launch offer. There is no automatic renewal.';
        intro.dataset.ddPaidCopy = 'true';
      }
      pricingHost.style.gridTemplateColumns = 'minmax(0, 1fr)';
      const card = body.querySelector('.dd2-plan-featured');
      const button = document.getElementById('dd2-open-payment');
      if (card && button && !button.disabled) {
        if (card.dataset.dd2EarlyAccessCard !== 'true') {
          card.dataset.dd2EarlyAccessCard = 'true';
          card.style.cursor = 'pointer';
        }
        if (button.textContent !== 'Subscribe — ₱149 Early Access') {
          button.textContent = 'Subscribe — ₱149 Early Access';
        }
      }
    }

    body.querySelectorAll('h3').forEach((heading) => {
      const title = heading.textContent?.trim();
      if (title === 'Free and Early Access') {
        heading.textContent = 'Early Access';
        replaceFollowingParagraph(
          heading,
          'Protected features require Early Access unless the account has an administrator or approved Founding Beta entitlement. Early Access is a one-time ₱149 offer available through September 1, 2026 and provides unlimited access through October 1, 2026. No automatic renewal applies.',
        );
      }
      if (title === 'Access records') {
        replaceFollowingParagraph(
          heading,
          'Protected examinations require authentication. Supabase UUIDs anchor approved Founding Beta eligibility, Early Access entitlements, legal acceptance, progress, and history so refreshes or device changes do not reset access.',
        );
      }
    });

    body.querySelectorAll('p').forEach((paragraph) => {
      if (paragraph.textContent?.includes('How does Free access work?')) {
        paragraph.innerHTML = '<strong>How does Early Access work?</strong><br>Protected features require the one-time ₱149 Early Access offer unless the account has an approved administrator or Founding Beta entitlement. Payment proof receives one non-renewable 24-hour provisional period while verification is pending.';
      }
    });

    if (state.mandatoryPricing) mandatoryControlState(true);
  }

  function openMandatoryPricing(access) {
    const required = paymentRequired(access);
    state.mandatoryPricing = required;
    mandatoryControlState(required);
    if (!required || onboardingOrSignInOpen()) return;

    legacy.openView?.('pricing');
    requestAnimationFrame(() => {
      patchCommercialCopy();
      mandatoryControlState(true);
      document.getElementById('dd2-open-payment')?.focus?.({ preventScroll: true });
    });
    if (!state.gateNoticeShown) {
      state.gateNoticeShown = true;
      global.toast?.(accessMessage(access), 'warn');
    }
  }

  function syncAccessUi() {
    const access = state.access;
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      badge.classList.toggle('is-visible', Boolean(access?.accountLabel));
      if (!access) badge.textContent = '';
      else if (paymentRequired(access)) badge.textContent = 'Early Access required · ₱149';
      else if (access.unlimited) badge.textContent = `${access.accountLabel || 'Early Access'} · Unlimited`;
      else badge.textContent = access.accountLabel || 'Access unavailable';
    }
    if (!paymentRequired(access)) {
      state.mandatoryPricing = false;
      state.gateNoticeShown = false;
      mandatoryControlState(false);
    }
    global.dispatchEvent(new CustomEvent('duediligence:access', {
      detail: access,
    }));
  }

  async function request(path, options = {}) {
    const headers = authenticatedHeaders({
      json: options.body instanceof FormData ? false : true,
      requestId: options.requestId !== false,
    });
    if (!headers) {
      const error = new Error('Sign in with Google to continue.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers,
      body: options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body || {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'The request could not be completed.');
      error.code = payload?.error?.code || 'REQUEST_FAILED';
      error.status = response.status;
      error.pendingAttemptId = payload?.error?.pendingAttemptId || null;
      error.retryAfterHours = Number(payload?.error?.retryAfterHours) || null;
      const authenticationError = response.status === 401
        || ['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error.code);
      if (options.authRetry !== false
          && authenticationError
          && await legacy.refreshSession?.()) {
        return request(path, { ...options, authRetry: false });
      }
      error.authRetryExhausted = authenticationError;
      throw error;
    }
    return payload;
  }

  async function refreshAccess(options = {}) {
    if (!session()?.access_token) {
      state.access = null;
      syncAccessUi();
      return null;
    }
    if (state.accessPromise) return state.accessPromise;
    state.accessPromise = request('/access', { requestId: false })
      .then((payload) => {
        state.access = payload.access;
        syncAccessUi();
        if (options.enforce !== false) openMandatoryPricing(state.access);
        return state.access;
      })
      .finally(() => {
        state.accessPromise = null;
      });
    return state.accessPromise;
  }

  async function beforeGrade() {
    if (!requireAuthentication()) return false;
    try {
      const access = await refreshAccess();
      if (access?.allowed) return true;
      global.toast?.(accessMessage(access), 'warn');
      if (!access?.termsRequired) openMandatoryPricing(access);
      return false;
    } catch (error) {
      if (error.code === 'AUTHENTICATION_REQUIRED' || error.code === 'INVALID_SESSION') {
        legacy.openSignIn?.();
      }
      global.toast?.(error.message || 'Your access could not be verified.', 'warn');
      return false;
    }
  }

  function gradingHeaders(requestId = null) {
    return authenticatedHeaders({ requestIdValue: requestId || undefined }) || {};
  }

  async function loadProtectedQuestion(subject, excludeQuestionIds = [], questionId = null) {
    if (!requireAuthentication()) return null;
    const payload = await request('/exam/question', {
      body: {
        subject,
        questionId,
        excludeQuestionIds,
        requestId: randomId(18),
      },
    });
    state.access = payload.access;
    syncAccessUi();
    return {
      id: payload.question.id,
      subject: payload.question.subject,
      topic: payload.question.topic,
      bar_year: payload.question.barYear,
      question_no: payload.question.questionNo,
      text: payload.question.prompt,
      model: '',
      legalBasis: '',
      caseLaw: '',
      verified: false,
      protected: true,
    };
  }

  async function recordUnanswered(question, elapsedSeconds, requestId) {
    return request('/exam/unanswered', {
      body: {
        questionId: question.id,
        subject: question.subject,
        elapsedSeconds,
        requestId,
      },
    });
  }

  async function loadHistory(limit = 100, offset = 0) {
    const payload = await request('/exam/history', {
      body: { limit, offset },
      requestId: false,
    });
    return Array.isArray(payload.history?.items) ? payload.history.items : [];
  }

  function afterGrade(accessPayload) {
    if (accessPayload?.access) state.access = accessPayload.access;
    syncAccessUi();
    refreshAccess().catch(() => {});
  }

  function handleGradeError(error) {
    if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      legacy.openSignIn?.();
      return true;
    }
    if (['ACCESS_REQUIRED', 'PAYMENT_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED', 'DAILY_LIMIT_REACHED'].includes(error?.code)) {
      global.toast?.(error.message, 'warn');
      if (!['LEGAL_ACCEPTANCE_REQUIRED'].includes(error.code)) {
        state.mandatoryPricing = true;
        legacy.openView?.('pricing');
        requestAnimationFrame(patchCommercialCopy);
      }
      return true;
    }
    return false;
  }

  function schedulePostOnboardingRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!session()?.access_token || onboardingOrSignInOpen()) return;
      refreshAccess().catch(() => {});
    }, 150);
  }

  function installCommercialUiGuards() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(() => {
      patchCommercialCopy();
      if (state.mandatoryPricing) mandatoryControlState(true);
      if (state.access?.termsRequired && !onboardingOrSignInOpen()) {
        schedulePostOnboardingRefresh();
      }
    });
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden'],
    });

    document.addEventListener('click', (event) => {
      if (state.mandatoryPricing
          && event.target.closest('#dd2-native-close, #dd2-native-back')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Choose Early Access and submit payment proof before continuing.', 'warn');
        return;
      }
      const card = event.target.closest('[data-dd2-early-access-card="true"]');
      if (!card || event.target.closest('button, a, input, select, textarea, label')) return;
      card.querySelector('#dd2-open-payment:not([disabled])')?.click();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (state.mandatoryPricing && event.key === 'Escape' && overlayOpen('dd2-native-view')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Early Access is required before protected features can open.', 'warn');
      }
    }, true);
  }

  const phase4 = Object.freeze({
    ...legacy,
    beforeGrade,
    gradingHeaders,
    afterGrade,
    handleGradeError,
    loadProtectedQuestion,
    recordUnanswered,
    loadHistory,
    refreshAccess,
    requireAuthentication,
    getAccess: () => state.access,
    request,
  });

  global.DueDiligencePhase2 = phase4;
  global.DueDiligencePhase4 = phase4;

  global.addEventListener('duediligence:session', (event) => {
    if (event.detail?.authenticated) {
      refreshAccess().catch(() => {});
      return;
    }
    state.access = null;
    state.mandatoryPricing = false;
    state.gateNoticeShown = false;
    syncAccessUi();
  });

  global.addEventListener('load', () => {
    installCommercialUiGuards();
    patchCommercialCopy();
    if (session()?.access_token) refreshAccess().catch(() => {});
    const guestButton = document.getElementById('dd2-guest-continue');
    if (guestButton) guestButton.hidden = true;
    const guestReminder = document.getElementById('dd2-guest-reminder');
    if (guestReminder) guestReminder.remove();
  }, { once: true });
}(window));
