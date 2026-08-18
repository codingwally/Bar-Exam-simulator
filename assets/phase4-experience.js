(function phase4Experience(global) {
  'use strict';

  const legacy = global.DueDiligencePhase2;
  const config = global.DueDiligencePhase2Config;
  if (!legacy || !config) return;

  const PROTECTED_ROUTES = new Set([
    'bar-easy',
    'doctrines',
    'mock-bar',
    'subject-matter',
    'bar-feels',
    'verdict',
  ]);

  const state = {
    access: null,
    accessPromise: null,
    mandatoryChoice: false,
    gateNoticeShown: false,
    observer: null,
    refreshTimer: null,
    pendingRoute: '',
    lastOverlayOpen: null,
    releasingGate: false,
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
    legacy.openSignIn?.({ routeBound: true, returnHash: location.hash });
    global.toast?.('Sign in with Google to continue.', 'warn');
    return false;
  }

  function routeName(hash = location.hash) {
    return String(hash || '')
      .replace(/^#/, '')
      .split('?')[0]
      .trim()
      .toLowerCase();
  }

  function isProtectedRoute(hash = location.hash) {
    return PROTECTED_ROUTES.has(routeName(hash));
  }

  function normalizedRouteHash(value) {
    const hash = String(value || '');
    if (!hash.startsWith('#')) return '';
    return isProtectedRoute(hash) ? hash : '';
  }

  function choiceRequired(access = state.access) {
    return access?.choiceRequired === true
      || access?.planSelectionRequired === true
      || ['plan_selection_required', 'trial_expired', 'payment_required'].includes(
        String(access?.basis || ''),
      );
  }

  function legalRequired(access = state.access) {
    return access?.termsRequired === true;
  }

  function profileRequired(access = state.access) {
    return access?.basis === 'profile_required'
      || (
        access?.commercialLaunchEnabled === true
        && access?.profileCompleted === false
      );
  }

  function accessMessage(access) {
    if (legalRequired(access)) {
      return 'Accept the current Terms of Use and Privacy Policy before choosing access.';
    }
    if (profileRequired(access)) {
      return 'Complete your profile before choosing Free Trial or Early Access.';
    }
    if (access?.basis === 'trial_expired') {
      return 'Your Free Trial has ended. Choose ₱149 Early Access to continue.';
    }
    if (choiceRequired(access)) {
      return 'Choose Free Trial or ₱149 Early Access before continuing.';
    }
    return 'Access is not currently available for this account. Review Retainer or contact Support.';
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
      control.hidden = required;
      control.disabled = required;
      if (required) control.setAttribute('aria-hidden', 'true');
      else control.removeAttribute('aria-hidden');
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

  function trialButtonState(card) {
    if (!card) return;
    const existing = card.querySelector('button');
    if (!existing) return;

    existing.id = 'dd2-start-free-trial';
    existing.type = 'button';
    existing.className = 'dd2-button dd2-button-secondary';

    const active = state.access?.trial?.active === true
      && state.access?.trial?.program === 'commercial_launch_2026';
    const available = state.access?.trialAvailable === true;

    if (active) {
      existing.disabled = true;
      existing.textContent = 'Free Trial active';
      card.removeAttribute('data-dd2-free-trial-card');
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.style.cursor = '';
      return;
    }

    if (!available) {
      existing.disabled = true;
      existing.textContent = state.access?.basis === 'trial_expired'
        ? 'Free Trial already used'
        : 'Free Trial unavailable';
      card.removeAttribute('data-dd2-free-trial-card');
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.style.cursor = '';
      return;
    }

    existing.disabled = false;
    existing.textContent = 'Start Free Trial';
    card.dataset.dd2FreeTrialCard = 'true';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Start the complimentary Free Trial');
    card.style.cursor = 'pointer';
  }

  function paidButtonState(card) {
    const button = document.getElementById('dd2-open-payment');
    if (!card || !button) return;
    if (button.disabled) {
      card.removeAttribute('data-dd2-early-access-card');
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.style.cursor = '';
      return;
    }
    button.textContent = 'Choose ₱149 Early Access';
    card.dataset.dd2EarlyAccessCard = 'true';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Choose the ₱149 Early Access offer');
    card.style.cursor = 'pointer';
  }

  function patchCommercialCopy() {
    const body = document.getElementById('dd2-native-body');
    if (!body) return;

    const pricingHost = document.getElementById('dd2-pricing-plans');
    if (pricingHost) {
      const intro = body.querySelector('.dd2-pricing-intro');
      if (intro) {
        intro.innerHTML = '<strong>Choose your access before continuing.</strong> Start the complimentary Free Trial through September 1, 2026, or choose ₱149 Early Access for unlimited access through October 1, 2026. Neither option renews automatically.';
      }

      const cards = Array.from(body.querySelectorAll('.dd2-plan'));
      const trialCard = cards.find((card) => {
        const title = card.querySelector('h3')?.textContent?.trim().toLowerCase();
        return title === 'free' || title === 'launch trial' || title === 'free trial';
      });
      const paidCard = cards.find((card) => card.classList.contains('dd2-plan-featured'));

      if (trialCard) {
        const heading = trialCard.querySelector('h3');
        if (heading) heading.textContent = 'Free Trial';
        const badge = trialCard.querySelector('.dd2-badge');
        if (badge) badge.textContent = 'No payment';
        const priceNote = trialCard.querySelector('.dd2-price small');
        if (priceNote) priceNote.textContent = 'through September 1';
        trialButtonState(trialCard);
      }

      if (paidCard) paidButtonState(paidCard);
      pricingHost.style.gridTemplateColumns = cards.length > 1
        ? 'repeat(2, minmax(0, 1fr))'
        : 'minmax(0, 1fr)';
    }

    body.querySelectorAll('h3').forEach((heading) => {
      const title = heading.textContent?.trim();
      if (title === 'Free and Early Access' || title === 'Early Access') {
        heading.textContent = 'Free Trial and Early Access';
        replaceFollowingParagraph(
          heading,
          'Every ordinary account must choose one access option. The complimentary Free Trial provides full practice access through September 1, 2026. The one-time ₱149 Early Access offer provides unlimited access through October 1, 2026. Administrator and approved Founding Beta accounts keep their existing access.',
        );
      }
      if (title === 'Access records') {
        replaceFollowingParagraph(
          heading,
          'Protected examinations require authentication. Supabase UUIDs anchor the selected Free Trial, approved Founding Beta eligibility, Early Access entitlements, legal acceptance, progress, and history so refreshes or device changes do not reset access.',
        );
      }
    });

    body.querySelectorAll('p').forEach((paragraph) => {
      if (paragraph.textContent?.includes('How does Free access work?')
          || paragraph.textContent?.includes('How does Early Access work?')) {
        paragraph.innerHTML = '<strong>How do the two access options work?</strong><br>The Free Trial starts immediately when selected and ends September 1, 2026 at 11:59 PM Philippine time. Early Access is a one-time ₱149 payment for unlimited access through October 1, 2026. A submitted payment proof receives one non-renewable 24-hour provisional period while verification is pending.';
      }
    });

    if (state.mandatoryChoice) mandatoryControlState(true);
  }

  function showRequiredLegalAcceptance(access) {
    if (!legalRequired(access) || onboardingOrSignInOpen()) return;
    legacy.openSignIn?.({
      mode: 'consent',
      allowDismiss: false,
      routeBound: true,
      returnHash: state.pendingRoute || location.hash,
      title: 'Accept the current Terms and Privacy Policy',
      copy: 'Acceptance is required before you choose Free Trial or Early Access.',
    });
  }

  function openMandatoryChoice(access, routeHash = '') {
    if (routeHash) state.pendingRoute = normalizedRouteHash(routeHash);

    if (legalRequired(access)) {
      state.mandatoryChoice = false;
      mandatoryControlState(false);
      showRequiredLegalAcceptance(access);
      return;
    }

    if (profileRequired(access) || !choiceRequired(access)) {
      if (!choiceRequired(access)) {
        state.mandatoryChoice = false;
        mandatoryControlState(false);
      }
      return;
    }

    state.mandatoryChoice = true;
    mandatoryControlState(true);
    if (onboardingOrSignInOpen()) return;

    legacy.openView?.('pricing');
    requestAnimationFrame(() => {
      patchCommercialCopy();
      mandatoryControlState(true);
      const focusTarget = document.getElementById('dd2-start-free-trial')
        || document.getElementById('dd2-open-payment');
      focusTarget?.focus?.({ preventScroll: true });
    });

    if (!state.gateNoticeShown) {
      state.gateNoticeShown = true;
      global.toast?.(accessMessage(access), 'warn');
    }
  }

  function releaseMandatoryChoice(options = {}) {
    if (state.releasingGate) return;
    state.releasingGate = true;
    state.mandatoryChoice = false;
    state.gateNoticeShown = false;
    mandatoryControlState(false);

    const destination = normalizedRouteHash(options.destination || state.pendingRoute);
    state.pendingRoute = '';

    const close = document.getElementById('dd2-native-close');
    if (overlayOpen('dd2-native-view') && close) {
      close.click();
    }

    if (destination) {
      setTimeout(() => {
        if (location.hash !== destination) location.hash = destination;
        state.releasingGate = false;
      }, 50);
    } else {
      state.releasingGate = false;
    }
  }

  function syncAccessUi() {
    const access = state.access;
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      badge.classList.toggle('is-visible', Boolean(access?.accountLabel));
      if (!access) badge.textContent = '';
      else if (choiceRequired(access)) badge.textContent = 'Choose access · Free Trial or ₱149';
      else if (access.unlimited) badge.textContent = `${access.accountLabel || 'Unlimited'} · Unlimited`;
      else badge.textContent = access.accountLabel || 'Access unavailable';
    }

    if (access?.allowed === true && state.mandatoryChoice) {
      const delay = ['launch_trial', 'provisional_payment'].includes(access.basis) ? 450 : 0;
      setTimeout(() => releaseMandatoryChoice(), delay);
    } else if (!choiceRequired(access)) {
      state.mandatoryChoice = false;
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

      if (options.recoverAccess !== false && response.status === 403) {
        try {
          const access = await refreshAccess({ enforce: true, force: true });
          if (legalRequired(access)) {
            error.code = 'LEGAL_ACCEPTANCE_REQUIRED';
            error.message = accessMessage(access);
          } else if (choiceRequired(access)) {
            error.code = 'ACCESS_CHOICE_REQUIRED';
            error.message = accessMessage(access);
          }
        } catch {
          // Preserve the original endpoint error when the access refresh fails.
        }
      }

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

    if (state.accessPromise && options.force !== true) return state.accessPromise;
    if (state.accessPromise && options.force === true) {
      try { await state.accessPromise; } catch {}
    }

    const pending = request('/access', {
      requestId: false,
      recoverAccess: false,
    })
      .then((payload) => {
        state.access = payload.access;
        syncAccessUi();

        if (options.enforce !== false) {
          if (legalRequired(state.access)) showRequiredLegalAcceptance(state.access);
          else openMandatoryChoice(state.access, options.routeHash || '');
        }
        return state.access;
      })
      .finally(() => {
        if (state.accessPromise === pending) state.accessPromise = null;
      });

    state.accessPromise = pending;
    return pending;
  }

  async function ensureProtectedAccess(routeHash = location.hash) {
    if (!requireAuthentication()) return false;
    const access = await refreshAccess({
      enforce: true,
      force: true,
      routeHash,
    });
    if (access?.allowed === true) return true;
    if (legalRequired(access)) showRequiredLegalAcceptance(access);
    else openMandatoryChoice(access, routeHash);
    return false;
  }

  async function chooseFreeTrial() {
    if (!requireAuthentication()) return;
    const button = document.getElementById('dd2-start-free-trial');
    if (button) {
      button.disabled = true;
      button.textContent = 'Starting Free Trial…';
    }

    try {
      const payload = await request('/access/choose', {
        body: { choice: 'free_trial' },
        requestIdValue: randomId(18),
        recoverAccess: false,
      });
      state.access = payload.access || null;
      syncAccessUi();
      await refreshAccess({ enforce: false, force: true });
      global.toast?.('Free Trial started. Full practice access is active through September 1, 2026.', 'ok');
      releaseMandatoryChoice();
    } catch (error) {
      if (error.code === 'LEGAL_ACCEPTANCE_REQUIRED') {
        await refreshAccess({ enforce: true, force: true }).catch(() => {});
      } else {
        global.toast?.(error.message || 'The Free Trial could not be started.', 'warn');
      }
      patchCommercialCopy();
    }
  }

  async function beforeGrade() {
    try {
      return await ensureProtectedAccess(location.hash || '#mock-bar');
    } catch (error) {
      if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error.code)) {
        legacy.openSignIn?.({ routeBound: true, returnHash: location.hash });
      }
      global.toast?.(error.message || 'Your access could not be verified.', 'warn');
      return false;
    }
  }

  function gradingHeaders(requestId = null) {
    return authenticatedHeaders({ requestIdValue: requestId || undefined }) || {};
  }

  async function loadProtectedQuestion(subject, excludeQuestionIds = [], questionId = null) {
    if (!await ensureProtectedAccess('#mock-bar')) return null;

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
    refreshAccess({ enforce: true }).catch(() => {});
  }

  function handleGradeError(error) {
    if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      legacy.openSignIn?.({ routeBound: true, returnHash: location.hash });
      return true;
    }

    if ([
      'ACCESS_REQUIRED',
      'ACCESS_CHOICE_REQUIRED',
      'PAYMENT_REQUIRED',
      'LEGAL_ACCEPTANCE_REQUIRED',
      'PROFILE_COMPLETION_REQUIRED',
      'DAILY_LIMIT_REACHED',
    ].includes(error?.code)) {
      global.toast?.(error.message, 'warn');
      refreshAccess({
        enforce: true,
        force: true,
        routeHash: location.hash,
      }).catch(() => {});
      return true;
    }
    return false;
  }

  function schedulePostOnboardingRefresh(delay = 120) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!session()?.access_token || onboardingOrSignInOpen()) return;
      refreshAccess({ enforce: true, force: true }).catch(() => {});
    }, delay);
  }

  function clickedHash(target) {
    const anchor = target.closest?.('a[href]');
    if (!anchor) return '';
    try {
      const url = new URL(anchor.getAttribute('href'), location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname) return '';
      return normalizedRouteHash(url.hash);
    } catch {
      return '';
    }
  }

  function installCommercialUiGuards() {
    if (state.observer || !document.body) return;

    state.lastOverlayOpen = onboardingOrSignInOpen();
    state.observer = new MutationObserver(() => {
      patchCommercialCopy();
      if (state.mandatoryChoice) mandatoryControlState(true);

      const nowOpen = onboardingOrSignInOpen();
      if (state.lastOverlayOpen === true && nowOpen === false && session()?.access_token) {
        schedulePostOnboardingRefresh(80);
      }
      state.lastOverlayOpen = nowOpen;
    });
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden'],
    });

    document.addEventListener('click', (event) => {
      if (state.mandatoryChoice
          && event.target.closest('#dd2-native-close, #dd2-native-back')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Choose Free Trial or ₱149 Early Access before continuing.', 'warn');
        return;
      }

      const trialButton = event.target.closest('#dd2-start-free-trial');
      const trialCard = event.target.closest('[data-dd2-free-trial-card="true"]');
      if (trialButton || (
        trialCard
        && !event.target.closest('button, a, input, select, textarea, label')
      )) {
        event.preventDefault();
        event.stopImmediatePropagation();
        chooseFreeTrial();
        return;
      }

      const paidCard = event.target.closest('[data-dd2-early-access-card="true"]');
      if (paidCard
          && !event.target.closest('button, a, input, select, textarea, label')) {
        event.preventDefault();
        paidCard.querySelector('#dd2-open-payment:not([disabled])')?.click();
        return;
      }

      const targetHash = clickedHash(event.target);
      if (!targetHash || !session()?.access_token || state.access?.allowed === true) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      state.pendingRoute = targetHash;
      ensureProtectedAccess(targetHash).then((allowed) => {
        if (allowed) location.hash = targetHash;
      }).catch(() => {});
    }, true);

    document.addEventListener('keydown', (event) => {
      if (state.mandatoryChoice
          && event.key === 'Escape'
          && overlayOpen('dd2-native-view')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.('Choose Free Trial or ₱149 Early Access before continuing.', 'warn');
        return;
      }

      if (!['Enter', ' '].includes(event.key)) return;
      const trialCard = event.target.closest?.('[data-dd2-free-trial-card="true"]');
      const paidCard = event.target.closest?.('[data-dd2-early-access-card="true"]');
      if (trialCard) {
        event.preventDefault();
        chooseFreeTrial();
      } else if (paidCard) {
        event.preventDefault();
        paidCard.querySelector('#dd2-open-payment:not([disabled])')?.click();
      }
    }, true);

    global.addEventListener('hashchange', () => {
      if (!isProtectedRoute() || !session()?.access_token) return;
      const targetHash = location.hash;
      state.pendingRoute = targetHash;
      ensureProtectedAccess(targetHash).catch(() => {});
    });

    global.addEventListener('pageshow', () => {
      if (session()?.access_token) {
        refreshAccess({ enforce: true, force: true }).catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && session()?.access_token) {
        refreshAccess({ enforce: true, force: true }).catch(() => {});
      }
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
    ensureProtectedAccess,
    chooseFreeTrial,
    requireAuthentication,
    getAccess: () => state.access,
    request,
  });

  global.DueDiligencePhase2 = phase4;
  global.DueDiligencePhase4 = phase4;

  global.addEventListener('duediligence:session', (event) => {
    if (event.detail?.authenticated) {
      setTimeout(() => {
        refreshAccess({ enforce: true, force: true }).catch(() => {});
      }, 80);
      return;
    }

    state.access = null;
    state.mandatoryChoice = false;
    state.gateNoticeShown = false;
    state.pendingRoute = '';
    mandatoryControlState(false);
    syncAccessUi();
  });

  global.addEventListener('load', () => {
    installCommercialUiGuards();
    patchCommercialCopy();

    if (session()?.access_token) {
      if (isProtectedRoute()) state.pendingRoute = location.hash;
      refreshAccess({ enforce: true, force: true }).catch(() => {});
    }

    const guestButton = document.getElementById('dd2-guest-continue');
    if (guestButton) guestButton.hidden = true;
    const guestReminder = document.getElementById('dd2-guest-reminder');
    if (guestReminder) guestReminder.remove();
  }, { once: true });
}(window));
