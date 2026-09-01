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
  const UNLIMITED_FEATURES = Object.freeze({
    'bar-feels': Object.freeze({
      featureId: 'bar-feels',
      featureLabel: 'Bar Exam Simulation',
      targetHash: '#bar-feels',
    }),
    'bar-forecast': Object.freeze({
      featureId: 'bar-forecast',
      featureLabel: '2026 Bar Forecast',
      targetHash: '#bar-forecast-2026',
    }),
  });
  const ACCESS_AUTH_RETRY_COOLDOWN_MS = 5_000;
  const ROUTINE_SESSION_REFRESH_REASONS = new Set(['refresh', 'TOKEN_REFRESHED']);

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
    accessAuthRetryBlockedUntil: 0,
    subjectReviewAccessGate: null,
    unlimitedFeatureGate: '',
    lastFocusRefreshAt: 0,
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

  function paidSubscriptionExpired(access = state.access) {
    return access?.paidSubscriptionExpired === true
      || String(access?.basis || '').trim().toLowerCase() === 'paid_subscription_expired';
  }

  function profileRequired(access = state.access) {
    return !setupExempt(access) && !paidSubscriptionExpired(access) && (
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
      || ['trial_tokens_exhausted', 'insufficient_introductory_tokens', 'paid_subscription_expired'].includes(
        String(access?.basis || ''),
      );
  }

  function subjectReviewRevealAllowed(access = state.access) {
    const basis = String(access?.basis || '').trim().toLowerCase();
    return access?.allowed === true
      && access?.unlimited === true
      && ['super_admin', 'founder_admin', 'founding_beta', 'early_access', 'paid_subscription'].includes(basis)
      && !setupRequired(access);
  }

  function isSubjectReviewAccessError(error) {
    return Number(error?.status) === 403
      && String(error?.code || '') === 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED';
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
    if (paidSubscriptionExpired(access)) {
      return access?.checkoutOpen === true
        ? 'Your paid Bar Exam Simulator access has expired. Choose the current Regular Subscription to continue. Home and Examination Room remain available.'
        : 'Your paid Bar Exam Simulator access has expired. Open Support for renewal assistance. Home and Examination Room remain available.';
    }
    if (paymentRequired(access)) {
      return 'Your five one-time practice tokens have been used. Choose the current Regular Subscription for more graded practice.';
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
      const recoveryView = paidSubscriptionExpired(access) && access?.checkoutOpen !== true
        ? 'support'
        : 'pricing';
      legacy.openView?.(recoveryView, { returnToQuorum: true });
      requestAnimationFrame(() => {
        document.getElementById(
          recoveryView === 'support' ? 'dd2-support-category' : 'dd2-open-payment',
        )?.focus?.({ preventScroll: true });
      });
    }
    if (!state.gateNoticeShown) {
      state.gateNoticeShown = true;
      global.toast?.(accessMessage(access), 'warn');
    }
  }

  function canUseUnlimitedFeature(access = state.access) {
    return access?.allowed === true
      && access?.unlimited === true
      && !setupRequired(access);
  }

  function unlimitedFeatureDefinition(routeHash = '', options = {}) {
    const requestedId = String(options.featureId || '').trim().toLowerCase();
    const requestedHash = String(routeHash || options.targetHash || '').trim().toLowerCase();
    return UNLIMITED_FEATURES[requestedId]
      || Object.values(UNLIMITED_FEATURES).find((feature) => feature.targetHash === requestedHash)
      || null;
  }

  function unlimitedFeatureBackgroundHash(feature, options = {}) {
    const requested = String(options.backgroundHash || '').trim();
    const current = String(location.hash || '').trim();
    const candidate = requested || current || '#quorum';
    if (!candidate.startsWith('#')
        || candidate === feature.targetHash
        || candidate === '#pricing'
        || candidate === '#bar-forecast-2026'
        || candidate === '#bar-feels') return '#quorum';
    return candidate;
  }

  function openUnlimitedFeatureGate(routeHash = '', options = {}) {
    const feature = unlimitedFeatureDefinition(routeHash, options);
    if (!feature) return false;
    if (state.unlimitedFeatureGate === feature.featureId && overlayOpen('dd2-native-view')) return true;

    const backgroundHash = unlimitedFeatureBackgroundHash(feature, options);
    if (location.hash !== backgroundHash) {
      history.replaceState(
        { ...(history.state || {}) },
        '',
        `${location.pathname}${location.search}${backgroundHash}`,
      );
    }

    state.unlimitedFeatureGate = feature.featureId;
    state.paymentGate = true;
    legacy.openView?.('pricing', {
      mode: 'action',
      actionId: `unlimited-feature-${feature.featureId}-${randomId(8)}`,
      focusOrigin: options.focusOrigin || document.activeElement,
      returnFocus: options.returnFocus || options.focusOrigin || document.activeElement,
      context: {
        reason: 'unlimited_feature',
        featureId: feature.featureId,
        featureLabel: feature.featureLabel,
        targetHash: feature.targetHash,
        backgroundHash,
      },
      onClose: () => {
        if (state.unlimitedFeatureGate === feature.featureId) state.unlimitedFeatureGate = '';
      },
    });
    return true;
  }

  function subjectReviewReturnFocus(options = {}) {
    const focusOrigin = options.focusOrigin || null;
    const attemptId = String(options.attemptId || '');
    const questionId = String(options.questionId || '');
    const section = String(options.section || 'suggested-answer');
    return () => {
      if (focusOrigin?.isConnected) return focusOrigin;
      const panel = [...document.querySelectorAll('[data-subject-review-panel]')]
        .find((candidate) => candidate.dataset.attemptId === attemptId
          && candidate.dataset.questionId === questionId);
      const revealButton = [...(panel?.querySelectorAll('[data-subject-review-reveal]') || [])]
        .find((candidate) => candidate.dataset.subjectReviewSection === section);
      return revealButton
        || document.getElementById('dd-answer-rich-editor')
        || document.getElementById('dd-answer-editor');
    };
  }

  function openSubjectReviewAccessGate(options = {}) {
    const attemptId = String(options.attemptId || '').trim();
    const questionId = String(options.questionId || '').trim();
    const section = String(options.section || 'suggested-answer').trim() || 'suggested-answer';
    const gateId = `subject-review:${attemptId || 'attempt'}:${questionId || 'question'}`;
    const nativeOverlay = document.getElementById('dd2-native-view');
    if (state.subjectReviewAccessGate?.id === gateId
        && overlayOpen('dd2-native-view')
        && nativeOverlay?.dataset.nativeView === 'pricing'
        && nativeOverlay?.dataset.nativeMode === 'action') {
      return true;
    }

    state.subjectReviewAccessGate = {
      id: gateId,
      attemptId,
      questionId,
      section,
      returnHash: '#subject-matter',
    };
    legacy.openView?.('pricing', {
      mode: 'action',
      actionId: gateId,
      focusOrigin: options.focusOrigin || document.activeElement,
      returnFocus: subjectReviewReturnFocus({ ...options, attemptId, questionId, section }),
      context: {
        reason: 'subject_reveal_review',
        attemptId,
        questionId,
        section,
        returnHash: '#subject-matter',
      },
      onClose: ({ actionId } = {}) => {
        if (state.subjectReviewAccessGate?.id === actionId) {
          state.subjectReviewAccessGate = null;
        }
      },
    });
    return true;
  }

  function syncAccessUi() {
    const access = state.access;
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      const role = String(access?.role || '').trim().toLowerCase();
      const basis = String(access?.basis || '').trim().toLowerCase();
      const accountLabel = String(access?.accountLabel || '').trim().toLowerCase();
      const identity = `${role} ${basis} ${accountLabel}`;
      const provisionalPayment = basis === 'provisional_payment'
        || String(access?.accessMode || '').trim().toLowerCase() === 'provisional';
      let label = '';
      if (access) {
        if (/\badmin(?:istrator)?\b|super_admin|founder_admin/.test(identity)) label = 'Admin';
        else if (/founding[_\s-]*beta/.test(identity) || access?.freeBeta?.active === true) label = 'Complimentary Access';
        else if (setupRequired(access)) label = 'Complete profile';
        else if (provisionalPayment) label = 'Payment under review';
        else if (access.unlimited) label = 'Paid Access';
        else if (paidSubscriptionExpired(access)) label = 'Renew Bar access';
        else label = `${Math.max(0, Number(access.tokensRemaining) || 0)} tokens remaining`;
      }
      badge.textContent = label;
      badge.hidden = !label;
      badge.classList.toggle('is-visible', Boolean(label));
      badge.setAttribute('aria-label', label ? `${label}. Open account access details.` : 'Open account access details');
      badge.title = label ? `${label} — open account details` : '';
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

  function adoptAccess(access, options = {}) {
    if (!access || typeof access !== 'object') return state.access;
    state.access = access;
    state.lastRefreshAt = Date.now();
    syncAccessUi();
    if (options.enforce === true) enforceResolvedAccess(state.access, options);
    return state.access;
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
      signal: options.signal,
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
          const access = await refreshAccess({ enforce: false, force: true });
          if (!isSubjectReviewAccessError(error)) {
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
              error.code = paidSubscriptionExpired(access)
                ? 'PAID_SUBSCRIPTION_EXPIRED'
                : 'INTRODUCTORY_TOKENS_EXHAUSTED';
              error.message = accessMessage(access);
            }
          }
        } catch {
          // Preserve the original endpoint error when the access refresh fails.
        }
      }

      throw error;
    }
    return payload;
  }

  function enforceResolvedAccess(access, options = {}) {
    if (options.enforce === false) return;
    if (setupRequired(access)) {
      openRequiredSetup(access, options.routeHash || '');
    } else if (paymentRequired(access) && isProtectedRoute(options.routeHash || location.hash)) {
      openPaymentGate(access, options.routeHash || '');
    }
  }

  async function refreshAccess(options = {}) {
    if (!session()?.access_token) {
      state.access = null;
      syncAccessUi();
      return null;
    }

    let access;
    if (state.accessPromise) {
      access = await state.accessPromise;
    } else {
      if (Date.now() < state.accessAuthRetryBlockedUntil) {
        const error = new Error('Session verification is already being retried.');
        error.code = 'AUTHENTICATION_RETRY_COOLDOWN';
        error.authRetryExhausted = true;
        throw error;
      }
      const pending = request('/access', {
        requestId: false,
        recoverAccess: false,
      })
        .then((payload) => {
          state.accessAuthRetryBlockedUntil = 0;
          return adoptAccess(payload.access, { enforce: false });
        })
        .catch((error) => {
          if (error?.authRetryExhausted === true) {
            state.accessAuthRetryBlockedUntil = Date.now() + ACCESS_AUTH_RETRY_COOLDOWN_MS;
          }
          throw error;
        })
        .finally(() => {
          if (state.accessPromise === pending) state.accessPromise = null;
        });

      state.accessPromise = pending;
      access = await pending;
    }
    enforceResolvedAccess(access, options);
    return access;
  }

  async function ensureProtectedAccess(routeHash = location.hash) {
    if (!requireAuthentication()) return false;
    const access = await refreshAccess({
      enforce: false,
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

  async function ensureUnlimitedFeatureAccess(routeHash, options = {}) {
    if (!requireAuthentication()) return false;
    const access = await refreshAccess({
      enforce: false,
      force: true,
      routeHash,
    });
    if (typeof options.isCurrent === 'function' && options.isCurrent() === false) return false;
    if (setupRequired(access)) {
      openRequiredSetup(access, routeHash);
      return false;
    }
    if (canUseUnlimitedFeature(access)) return true;
    openUnlimitedFeatureGate(routeHash, options);
    return false;
  }

  async function ensureRequiredSetup(routeHash = location.hash) {
    if (!session()?.access_token) return false;
    // Forecast inspects a fresh server snapshot. Required setup remains an
    // explicit user action, while payment state is intentionally ignored.
    const payload = await request('/access', {
      requestId: false,
      recoverAccess: false,
    });
    if (!payload?.access || typeof payload.access !== 'object') return false;
    for (const field of [
      'termsRequired',
      'reauthenticationRequired',
      'profileCompleted',
      'tokenAcknowledgementRequired',
      'paidSubscriptionExpired',
      'commercialLaunchEnabled',
    ]) {
      if (typeof payload.access[field] !== 'boolean') return false;
    }
    if (!String(payload.access.role || '').trim() || !String(payload.access.basis || '').trim()) {
      return false;
    }
    const access = adoptAccess(payload.access, { enforce: false });
    if (!setupRequired(access)) return true;
    openRequiredSetup(access, routeHash);
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

  async function loadProtectedQuestion(
    subject,
    excludeQuestionIds = [],
    questionId = null,
    issuanceId = null,
  ) {
    if (!await ensureProtectedAccess('#mock-bar')) return null;

    const payload = await request('/exam/question', {
      body: {
        subject,
        questionId,
        issuanceId,
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
      issuanceId: payload.rotation?.issuanceId || issuanceId || null,
      issuanceExpiresAt: payload.rotation?.issuanceExpiresAt || null,
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
        refreshAccess({ enforce: false }).catch(() => {});
      }
    });

    global.addEventListener('focus', () => {
      if (!session()?.access_token) return;
      const now = Date.now();
      if (now - state.lastFocusRefreshAt < 1_000) return;
      state.lastFocusRefreshAt = now;
      refreshAccess({ enforce: false, force: true }).catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible'
          && session()?.access_token
          && Date.now() - state.lastRefreshAt > 30_000) {
        refreshAccess({ enforce: false }).catch(() => {});
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
    adoptAccess,
    ensureProtectedAccess,
    ensureUnlimitedFeatureAccess,
    ensureRequiredSetup,
    canUseUnlimitedFeature,
    openUnlimitedFeatureGate,
    canRevealSubjectReview: subjectReviewRevealAllowed,
    isSubjectReviewAccessError,
    openSubjectReviewAccessGate,
    chooseFreeAccess: () => refreshAccess({ enforce: true, force: true }),
    requireAuthentication,
    getAccess: () => state.access,
    request,
  });

  global.DueDiligencePhase2 = phase4;
  global.DueDiligencePhase4 = phase4;

  function handlePhase4SessionChange(event) {
    const detail = event.detail || {};
    if (detail.authenticated) {
      if (ROUTINE_SESSION_REFRESH_REASONS.has(detail.reason)) return;
      state.accessAuthRetryBlockedUntil = 0;
      setTimeout(() => {
        refreshAccess({ enforce: false, force: true }).catch(() => {});
      }, 80);
      return;
    }

    state.access = null;
    state.accessAuthRetryBlockedUntil = 0;
    state.setupGate = false;
    state.paymentGate = false;
    state.gateNoticeShown = false;
    state.pendingRoute = '';
    state.subjectReviewAccessGate = null;
    state.lastFocusRefreshAt = 0;
    document.documentElement?.classList?.remove?.('dd-access-gate-open');
    syncAccessUi();
  }

  global.addEventListener('duediligence:session', handlePhase4SessionChange);

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
      if (isProtectedRoute()) {
        state.pendingRoute = location.hash;
        ensureProtectedAccess(location.hash).catch(() => {});
      } else {
        refreshAccess({ enforce: false, force: true }).catch(() => {});
      }
    }

    const guestButton = document.getElementById('dd2-guest-continue');
    if (guestButton) guestButton.hidden = true;
    const guestReminder = document.getElementById('dd2-guest-reminder');
    if (guestReminder) guestReminder.remove();
  }, { once: true });
}(window));
