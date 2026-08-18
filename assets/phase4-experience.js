(function phase4Experience(global) {
  'use strict';

  const legacy = global.DueDiligencePhase2;
  const config = global.DueDiligencePhase2Config;
  if (!legacy || !config) return;

  const state = {
    access: null,
    accessPromise: null,
    trialBusy: false,
    refreshTimer: null,
    observer: null,
  };

  function ensureHotfixStyles() {
    if (document.getElementById('dd4-commercial-hotfix-style')) return;
    const style = document.createElement('style');
    style.id = 'dd4-commercial-hotfix-style';
    style.textContent = `
      .dd2-plan-featured.dd4-clickable-plan { cursor: pointer; }
      .dd2-plan-featured.dd4-clickable-plan:hover {
        border-color: var(--dd2-gold, #b8934f);
        box-shadow: 0 14px 34px rgba(7, 24, 47, .13);
      }
      #dd4-start-trial { margin-top: auto; }
      #dd2-native-view[data-mandatory-access="true"] #dd2-native-close,
      #dd2-native-view[data-mandatory-access="true"] #dd2-native-back {
        opacity: .72;
      }
    `;
    document.head.appendChild(style);
  }

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

  function requiresAccessChoice(access = state.access) {
    return Boolean(
      access?.mandatoryAccessChoiceEnabled
      && access?.profileCompleted
      && !access?.termsRequired
      && !access?.allowed
      && ['plan_selection_required', 'trial_expired'].includes(access?.basis),
    );
  }

  function accessMessage(access) {
    if (access?.termsRequired) {
      return 'Review and accept the current Terms of Use and Privacy Policy before opening an examination.';
    }
    if (access?.basis === 'profile_required' || access?.profileCompleted === false) {
      return 'Complete your required profile before opening an examination.';
    }
    if (access?.basis === 'plan_selection_required') {
      return 'Choose ₱149 Early Access or the temporary launch trial before continuing.';
    }
    if (access?.basis === 'trial_expired') {
      return 'Your temporary launch trial has ended. Choose Early Access to continue.';
    }
    if (!access?.unlimited && access?.accessMode === 'free' && Number(access?.remainingToday) <= 0) {
      return 'Your free submissions for today are complete. Your allowance resets at Philippine midnight.';
    }
    return 'Access is not currently available for this account. Review Retainer or contact Support.';
  }

  function syncAccessUi() {
    const access = state.access;
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      badge.classList.toggle('is-visible', Boolean(access?.accountLabel));
      if (!access) badge.textContent = '';
      else if (access.unlimited) badge.textContent = `${access.accountLabel || 'Early Access'} · Unlimited`;
      else if (requiresAccessChoice(access)) badge.textContent = access.accountLabel || 'Choose access';
      else badge.textContent = `${access.accountLabel || 'Access'} · ${Math.max(0, Number(access.remainingToday) || 0)}/${Math.max(0, Number(access.dailyLimit) || 0)} left`;
    }
    global.dispatchEvent(new CustomEvent('duediligence:access', {
      detail: access,
    }));
  }

  async function request(path, options = {}) {
    const headers = authenticatedHeaders({
      json: options.body instanceof FormData ? false : true,
      requestId: options.requestId !== false,
      requestIdValue: options.requestIdValue,
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

  function mandatoryPricingView() {
    return document.getElementById('dd2-native-view')?.dataset?.mandatoryAccess === 'true';
  }

  function setMandatoryPricingView(enabled) {
    const view = document.getElementById('dd2-native-view');
    if (!view) return;
    if (enabled) view.dataset.mandatoryAccess = 'true';
    else delete view.dataset.mandatoryAccess;
    for (const control of [
      document.getElementById('dd2-native-close'),
      document.getElementById('dd2-native-back'),
    ]) {
      if (!control) continue;
      control.setAttribute('aria-disabled', enabled ? 'true' : 'false');
      control.title = enabled
        ? 'Choose Early Access or the temporary launch trial before returning.'
        : '';
    }
  }

  function isInteractiveTarget(target) {
    return Boolean(target?.closest?.('button, a, input, select, textarea, label, form'));
  }

  function decoratePricing() {
    const host = document.getElementById('dd2-pricing-plans');
    if (!host) return;
    const cards = host.querySelectorAll('.dd2-plan');
    const trialCard = cards[0];
    const earlyCard = host.querySelector('.dd2-plan-featured') || cards[1];
    const access = state.access;

    if (trialCard && access?.mandatoryAccessChoiceEnabled) {
      trialCard.classList.toggle('is-disabled', access?.trialAvailable !== true);
      const oldAction = trialCard.querySelector('.dd2-button');
      if (oldAction && oldAction.id !== 'dd4-start-trial') {
        const action = document.createElement('button');
        action.className = 'dd2-button dd2-button-secondary';
        action.type = 'button';
        action.id = 'dd4-start-trial';
        action.dataset.dd4StartTrial = 'true';
        action.disabled = access?.trialAvailable !== true;
        action.textContent = access?.trialAvailable
          ? 'Use free trial until September 1'
          : access?.basis === 'trial_expired'
            ? 'Launch trial already used'
            : access?.trial?.active
              ? 'Launch trial active'
              : 'Launch trial unavailable';
        oldAction.replaceWith(action);
      } else if (oldAction?.id === 'dd4-start-trial') {
        oldAction.disabled = access?.trialAvailable !== true;
      }
    }

    if (earlyCard) {
      const paymentButton = earlyCard.querySelector('#dd2-open-payment');
      const clickable = Boolean(paymentButton && !paymentButton.disabled);
      earlyCard.classList.toggle('dd4-clickable-plan', clickable);
      if (clickable) {
        earlyCard.setAttribute('role', 'button');
        earlyCard.setAttribute('tabindex', '0');
        earlyCard.setAttribute('aria-label', 'Get Early Access for ₱149');
      } else {
        earlyCard.removeAttribute('role');
        earlyCard.removeAttribute('tabindex');
        earlyCard.removeAttribute('aria-label');
      }
    }

    setMandatoryPricingView(requiresAccessChoice(access));
  }

  function openRequiredPricing(access = state.access) {
    if (!requiresAccessChoice(access)) {
      setMandatoryPricingView(false);
      return false;
    }
    legacy.openView?.('pricing');
    setMandatoryPricingView(true);
    requestAnimationFrame(decoratePricing);
    setTimeout(decoratePricing, 100);
    return true;
  }

  async function refreshAccess() {
    if (!session()?.access_token) {
      state.access = null;
      setMandatoryPricingView(false);
      syncAccessUi();
      return null;
    }
    if (state.accessPromise) return state.accessPromise;
    state.accessPromise = request('/access', { requestId: false })
      .then((payload) => {
        state.access = payload.access;
        syncAccessUi();
        openRequiredPricing(state.access);
        return state.access;
      })
      .finally(() => {
        state.accessPromise = null;
      });
    return state.accessPromise;
  }

  function scheduleAccessRefresh(delay = 80) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (session()?.access_token) refreshAccess().catch(() => {});
    }, delay);
  }

  async function startLaunchTrial() {
    if (state.trialBusy || !state.access?.trialAvailable) return;
    state.trialBusy = true;
    const button = document.getElementById('dd4-start-trial');
    if (button) {
      button.disabled = true;
      button.textContent = 'Activating trial…';
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const requestKey = randomId(24);
      const payload = await request('/access/choose-trial', {
        body: { requestKey },
        requestIdValue: requestKey,
      });
      state.access = payload.access;
      syncAccessUi();
      setMandatoryPricingView(false);
      global.toast?.(payload.message || 'Launch trial activated.', 'ok');
      document.getElementById('dd2-native-close')?.click();
    } catch (error) {
      global.toast?.(error.message || 'The launch trial could not be activated.', 'warn');
      await refreshAccess().catch(() => {});
    } finally {
      state.trialBusy = false;
      decoratePricing();
    }
  }

  async function beforeGrade() {
    if (!requireAuthentication()) return false;
    try {
      const access = await refreshAccess();
      if (access?.allowed) return true;
      global.toast?.(accessMessage(access), 'warn');
      if (!access?.termsRequired && access?.basis !== 'profile_required') {
        openRequiredPricing(access) || legacy.openView?.('pricing');
      }
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
    const access = await refreshAccess();
    if (!access?.allowed) {
      global.toast?.(accessMessage(access), 'warn');
      openRequiredPricing(access) || legacy.openView?.('pricing');
      return null;
    }
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
    if (accessPayload?.freeGrades && state.access?.freeGrades) {
      state.access = {
        ...state.access,
        freeGrades: {
          ...state.access.freeGrades,
          ...accessPayload.freeGrades,
        },
      };
    }
    syncAccessUi();
    refreshAccess().catch(() => {});
  }

  function handleGradeError(error) {
    if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      legacy.openSignIn?.();
      return true;
    }
    const accessCodes = [
      'ACCESS_REQUIRED',
      'LEGAL_ACCEPTANCE_REQUIRED',
      'DAILY_LIMIT_REACHED',
      'PLAN_SELECTION_REQUIRED',
      'TRIAL_EXPIRED',
      'PROFILE_REQUIRED',
    ];
    if (accessCodes.includes(error?.code)) {
      global.toast?.(error.message, 'warn');
      if (!['LEGAL_ACCEPTANCE_REQUIRED', 'PROFILE_REQUIRED'].includes(error.code)) {
        refreshAccess().then(openRequiredPricing).catch(() => legacy.openView?.('pricing'));
      }
      return true;
    }
    return false;
  }

  function bindCommercialChoiceControls() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (target?.closest?.('#dd4-start-trial')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        startLaunchTrial();
        return;
      }
      if (requiresAccessChoice()
          && target?.closest?.('#dd2-native-close, #dd2-native-back')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Choose Early Access or the temporary launch trial before returning.', 'warn');
        openRequiredPricing();
        return;
      }
      const card = target?.closest?.('.dd2-plan-featured.dd4-clickable-plan');
      if (card && !isInteractiveTarget(target)) {
        event.preventDefault();
        card.querySelector('#dd2-open-payment')?.click();
      }
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && requiresAccessChoice() && mandatoryPricingView()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Choose Early Access or the temporary launch trial before returning.', 'warn');
        return;
      }
      const card = event.target?.closest?.('.dd2-plan-featured.dd4-clickable-plan');
      if (card && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        card.querySelector('#dd2-open-payment')?.click();
      }
    }, true);
  }

  function observeCommercialViews() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver((mutations) => {
      let pricingChanged = false;
      let onboardingChanged = false;
      for (const mutation of mutations) {
        if (mutation.target?.id === 'dd2-pricing-plans'
            || mutation.target?.closest?.('#dd2-pricing-plans')) pricingChanged = true;
        if (mutation.target?.id === 'dd2-onboarding-overlay'
            || mutation.target?.closest?.('#dd2-onboarding-overlay')) onboardingChanged = true;
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.id === 'dd2-pricing-plans' || node.querySelector?.('#dd2-pricing-plans')) pricingChanged = true;
        }
      }
      if (pricingChanged) requestAnimationFrame(decoratePricing);
      if (onboardingChanged) scheduleAccessRefresh(120);
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden'],
    });
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
      scheduleAccessRefresh(40);
      return;
    }
    state.access = null;
    setMandatoryPricingView(false);
    syncAccessUi();
  });

  global.addEventListener('hashchange', () => {
    if (requiresAccessChoice()) setTimeout(openRequiredPricing, 0);
  });

  ensureHotfixStyles();
  bindCommercialChoiceControls();

  global.addEventListener('load', () => {
    observeCommercialViews();
    if (session()?.access_token) scheduleAccessRefresh(40);
    const guestButton = document.getElementById('dd2-guest-continue');
    if (guestButton) guestButton.hidden = true;
    const guestReminder = document.getElementById('dd2-guest-reminder');
    if (guestReminder) guestReminder.remove();
  }, { once: true });
}(window));
