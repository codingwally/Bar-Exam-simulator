(function phase4Experience(global) {
  'use strict';

  const legacy = global.DueDiligencePhase2;
  const config = global.DueDiligencePhase2Config;
  if (!legacy || !config) return;

  const state = {
    access: null,
    accessPromise: null,
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

  function accessMessage(access) {
    if (access?.termsRequired) {
      return 'Review and accept the current Beta Terms and Privacy Notice before opening an examination.';
    }
    return 'Beta All Access is not currently available for this account. Review your access status or contact Support.';
  }

  function syncAccessUi() {
    const access = state.access;
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      const globalBetaActive = access?.globalBeta?.active === true;
      const visibleBasis = globalBetaActive
        || ['trial', 'free_beta', 'paid_subscription'].includes(access?.basis);
      badge.classList.toggle('is-visible', visibleBasis);
      if (!access) badge.textContent = '';
      else if (globalBetaActive) {
        badge.textContent = 'Beta All Access';
      } else if (access.basis === 'trial' && access.trial?.expiresAt) {
        const remainingMs = Math.max(0, new Date(access.trial.expiresAt).getTime() - Date.now());
        const hours = Math.floor(remainingMs / 3_600_000);
        const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
        badge.textContent = `Trial ${hours}h ${minutes}m remaining`;
      } else if (access.basis === 'free_beta') {
        badge.textContent = 'Free Beta Access';
      } else if (access.basis === 'paid_subscription') {
        badge.textContent = 'Active Retainer';
      } else {
        badge.textContent = '';
      }
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

  async function refreshAccess() {
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
      if (!access?.termsRequired) legacy.openView?.('pricing');
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
    if (['ACCESS_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED'].includes(error?.code)) {
      global.toast?.(error.message, 'warn');
      if (error.code === 'ACCESS_REQUIRED') legacy.openView?.('pricing');
      return true;
    }
    return false;
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
    syncAccessUi();
  });

  global.addEventListener('load', () => {
    if (session()?.access_token) refreshAccess().catch(() => {});
    const guestButton = document.getElementById('dd2-guest-continue');
    if (guestButton) guestButton.hidden = true;
    const guestReminder = document.getElementById('dd2-guest-reminder');
    if (guestReminder) guestReminder.remove();
  }, { once: true });
}(window));
