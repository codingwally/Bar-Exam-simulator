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
    'examination-room',
  ]);

  const state = {
    access: null,
    accessPromise: null,
    setupGate: false,
    paymentGate: false,
    gateNoticeShown: false,
    observer: null,
    refreshTimer: null,
    pendingRoute: '',
    lastOverlayOpen: null,
    releasingGate: false,
    lastRefreshAt: 0,
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

  function legalRequired(access = state.access) {
    return access?.termsRequired === true;
  }

  function setupExempt(access = state.access) {
    const role = String(access?.role || '').trim().toLowerCase();
    const basis = String(access?.basis || '').trim().toLowerCase();
    return ['super_admin', 'founder_admin'].includes(role)
      || ['super_admin', 'founder_admin', 'founding_beta'].includes(basis)
      || access?.freeBeta?.active === true;
  }

  function reauthenticationRequired(access = state.access) {
    return !setupExempt(access) && (
      access?.reauthenticationRequired === true
      || access?.basis === 'reauthentication_required'
    );
  }

  function profileRequired(access = state.access) {
    return !setupExempt(access) && (
      access?.basis === 'profile_required'
      || access?.tokenAcknowledgementRequired === true
      || (
        access?.commercialLaunchEnabled === true
        && access?.profileCompleted === false
      )
    );
  }

  function paymentRequired(access = state.access) {
    return access?.paymentRequired === true
      || ['trial_tokens_exhausted', 'insufficient_introductory_tokens'].includes(
        String(access?.basis || ''),
      );
  }

  function setupRequired(access = state.access) {
    return legalRequired(access)
      || reauthenticationRequired(access)
      || profileRequired(access);
  }

  function accessMessage(access) {
    if (legalRequired(access)) {
      return 'Accept the current Terms of Use and Privacy Policy to continue.';
    }
    if (reauthenticationRequired(access)) {
      return 'Sign in with Google again to confirm this account securely.';
    }
    if (profileRequired(access)) {
      return 'Confirm your profile and acknowledge the five one-time practice tokens.';
    }
    if (paymentRequired(access)) {
      return 'Your five one-time practice tokens have been used. Early Access is required for more graded practice.';
    }
    return 'Access is not currently available for this account. Review your access or contact Support.';
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

  function openRequiredSetup(access, routeHash = '') {
    if (routeHash) state.pendingRoute = normalizedRouteHash(routeHash);
    state.setupGate = setupRequired(access);
    document.documentElement?.classList?.toggle?.('dd-access-gate-open', state.setupGate);
    if (!state.setupGate) return;
    if (legalRequired(access)) {
      legacy.openSignIn?.({
        mode: 'consent',
        allowDismiss: false,
        routeBound: true,
        returnHash: state.pendingRoute || location.hash,
        title: 'Accept the current Terms and Privacy Policy',
        copy: 'Review and accept the current documents to continue securely.',
      });
      return;
    }
    if (reauthenticationRequired(access)) {
      legacy.openSignIn?.({
        mode: 'signin',
        allowDismiss: false,
        routeBound: true,
        returnHash: state.pendingRoute || location.hash,
        title: 'Confirm your Google account',
        copy: 'Sign in again once to secure your soft-launch access. Your existing account and saved work remain intact.',
      });
      return;
    }
    if (profileRequired(access)) {
      legacy.openOnboarding?.({
        required: true,
        tokenDisclosureVersion: access?.tokenDisclosureVersion,
      });
    }
    if (!state.gateNoticeShown) {
      state.gateNoticeShown = true;
      global.toast?.(accessMessage(access), 'warn');
    }
  }

  function openPaymentGate(access, routeHash = '') {
    if (routeHash) state.pendingRoute = normalizedRouteHash(routeHash);
    state.paymentGate = true;
    if (!overlayOpen('dd2-native-view')) {
      legacy.openView?.('pricing', { returnToQuorum: true });
      requestAnimationFrame(() => {
        document.getElementById('dd2-open-payment')?.focus?.({ preventScroll: true });
      });
    }
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
      else if (setupRequired(access)) badge.textContent = 'Account setup required';
      else if (access.unlimited) badge.textContent = `${access.accountLabel || 'Unlimited'} · Unlimited`;
      else badge.textContent = `${Math.max(0, Number(access.tokensRemaining) || 0)} of ${Math.max(0, Number(access.tokenLimit) || 5)} tokens`;
    }

    if (!setupRequired(access)) {
      state.setupGate = false;
      document.documentElement?.classList?.remove?.('dd-access-gate-open');
    }
    if (!paymentRequired(access)) {
      state.paymentGate = false;
    }
    if (access?.allowed === true) {
      state.gateNoticeShown = false;
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
          } else if (reauthenticationRequired(access)) {
            error.code = 'REAUTHENTICATION_REQUIRED';
            error.message = accessMessage(access);
          } else if (profileRequired(access)) {
            error.code = 'PROFILE_COMPLETION_REQUIRED';
            error.message = accessMessage(access);
          } else if (paymentRequired(access)) {
            error.code = 'INTRODUCTORY_TOKENS_EXHAUSTED';
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
        state.lastRefreshAt = Date.now();
        syncAccessUi();

        if (options.enforce !== false) {
          if (setupRequired(state.access)) {
            openRequiredSetup(state.access, options.routeHash || '');
          } else if (paymentRequired(state.access) && isProtectedRoute(options.routeHash || location.hash)) {
            openPaymentGate(state.access, options.routeHash || '');
          }
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
    if (setupRequired(access)) {
      openRequiredSetup(access, routeHash);
      return false;
    }
    if (access?.allowed === true) return true;
    if (paymentRequired(access)) openPaymentGate(access, routeHash);
    else global.toast?.(accessMessage(access), 'warn');
    return false;
  }

  function confirmFinalToken() {
    return new Promise((resolve) => {
      document.getElementById('dd-final-token-modal')?.remove();
      document.body.insertAdjacentHTML('beforeend', `
        <div class="dd2-overlay is-open" id="dd-final-token-modal" role="dialog" aria-modal="true"
          aria-labelledby="dd-final-token-title" aria-hidden="false">
          <section class="dd2-reminder-card dd-final-token-card" tabindex="-1">
            <button type="button" class="dd2-close dd2-card-close" data-final-token-cancel aria-label="Close final-token warning">×</button>
            <div class="dd2-view-kicker">Final introductory token</div>
            <h3 id="dd-final-token-title">This submission will use your last practice token.</h3>
            <p>The token is used only if grading succeeds. Failed grading and duplicate retries do not consume it.</p>
            <div class="dd2-reminder-actions">
              <button type="button" class="dd2-button dd2-button-secondary" data-final-token-cancel>Back</button>
              <button type="button" class="dd2-button dd2-button-primary" data-final-token-confirm>Submit final token</button>
            </div>
          </section>
        </div>`);
      const modal = document.getElementById('dd-final-token-modal');
      const finish = (decision) => {
        modal?.remove();
        resolve(decision);
      };
      modal?.querySelectorAll('[data-final-token-cancel]').forEach((button) => {
        button.addEventListener('click', () => finish(false), { once: true });
      });
      modal?.querySelector('[data-final-token-confirm]')?.addEventListener('click', () => finish(true), { once: true });
      modal?.addEventListener('click', (event) => {
        if (event.target === modal) finish(false);
      });
      modal?.querySelector('[data-final-token-confirm]')?.focus?.();
    });
  }

  async function beforeGrade() {
    try {
      const allowed = await ensureProtectedAccess(location.hash || '#mock-bar');
      if (!allowed) return false;
      if (!state.access?.unlimited && Number(state.access?.tokensRemaining) === 1) {
        return confirmFinalToken();
      }
      return true;
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
      'PAYMENT_REQUIRED',
      'LEGAL_ACCEPTANCE_REQUIRED',
      'REAUTHENTICATION_REQUIRED',
      'PROFILE_COMPLETION_REQUIRED',
      'INTRODUCTORY_TOKENS_EXHAUSTED',
      'INSUFFICIENT_INTRODUCTORY_TOKENS',
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
    state.observer = { installed: true };
    state.lastOverlayOpen = onboardingOrSignInOpen();

    document.addEventListener('click', (event) => {
      if (state.setupGate
          && event.target.closest('#dd2-entry-close, #dd2-entry-back, #dd2-onboarding-close, #dd2-onboarding-back')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.(accessMessage(state.access), 'warn');
        return;
      }

      const targetHash = clickedHash(event.target);
      if (!targetHash || !session()?.access_token) return;
      if (state.access?.allowed === true && !setupRequired(state.access)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      state.pendingRoute = targetHash;
      ensureProtectedAccess(targetHash).then((allowed) => {
        if (allowed) location.hash = targetHash;
      }).catch(() => {});
    }, true);

    document.addEventListener('keydown', (event) => {
      if (state.setupGate
          && event.key === 'Escape'
          && onboardingOrSignInOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        global.toast?.(accessMessage(state.access), 'warn');
        return;
      }
    }, true);

    global.addEventListener('hashchange', () => {
      if (!isProtectedRoute() || !session()?.access_token) return;
      const targetHash = location.hash;
      state.pendingRoute = targetHash;
      ensureProtectedAccess(targetHash).catch(() => {});
    });

    global.addEventListener('pageshow', () => {
      if (session()?.access_token && Date.now() - state.lastRefreshAt > 15_000) {
        refreshAccess({ enforce: true }).catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible'
          && session()?.access_token
          && Date.now() - state.lastRefreshAt > 30_000) {
        refreshAccess({ enforce: true }).catch(() => {});
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
    chooseFreeAccess: () => refreshAccess({ enforce: true, force: true }),
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
    state.setupGate = false;
    state.paymentGate = false;
    state.gateNoticeShown = false;
    state.pendingRoute = '';
    document.documentElement?.classList?.remove?.('dd-access-gate-open');
    syncAccessUi();
  });

  global.addEventListener('duediligence:profile-completed', () => {
    if (!session()?.access_token) return;
    refreshAccess({
      enforce: true,
      force: true,
      routeHash: '#quorum',
    }).catch(() => {});
  });

  global.addEventListener('load', () => {
    installCommercialUiGuards();

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
