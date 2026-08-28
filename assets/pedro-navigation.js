(function dueDiligencePedroNavigation(global) {
  'use strict';

  const ACTION_QUERY = 'pedroAction';
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const MOCK_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .,&()'/-]{1,119}$/;
  const ACTION_KEYS = new Set(['id', 'type', 'label']);
  const RESPONSE_KEYS = new Set(['ok', 'data']);
  const DATA_KEYS = new Set(['action']);
  const RESOLVED_ACTION_KEYS = new Set(['id', 'type', 'target']);
  const LABELS = Object.freeze({
    doctrine: 'Open Doctrine Review',
    syllabus: 'Open Syllabus-Based Review',
    mock_bar: 'Open Bar Question Practice',
  });
  const DESTINATIONS = Object.freeze({
    doctrine: Object.freeze({ feature: 'doctrines', hash: '#doctrines' }),
    syllabus: Object.freeze({ feature: 'subject-matter', hash: '#subject-matter' }),
    mock_bar: Object.freeze({ feature: 'mock', hash: '#mock-bar' }),
  });
  const HASH_TYPES = Object.freeze(Object.fromEntries(
    Object.entries(DESTINATIONS).map(([type, destination]) => [destination.hash, type]),
  ));
  const TERMINAL_CODES = new Set([
    'PEDRO_ACCESS_REQUIRED',
    'PEDRO_HISTORY_CURSOR_INVALID',
    'PEDRO_PAID_REQUIRED',
    'PEDRO_TERMS_REQUIRED',
    'PEDRO_THREAD_INVALID',
    'TERMS_REQUIRED',
  ]);
  const AUTH_REQUIRED_CODES = new Set([
    'AUTHENTICATION_REQUIRED',
    'INVALID_SESSION',
    'MISSING_AUTHORIZATION',
  ]);
  const STALE_CODES = new Set([
    'PEDRO_ACTION_NOT_FOUND',
    'PEDRO_ACTION_STALE',
    'PEDRO_NAVIGATION_STALE',
  ]);
  const OUTCOMES = Object.freeze(Object.fromEntries([
    'opened',
    'busy',
    'terminal',
    'stale',
    'auth-required',
    'retryable',
  ].map((status) => [status, Object.freeze({ status })])));
  const TERMINAL_STATUS_TIMEOUT_MS = 8000;
  const BUSY_STATUS_TIMEOUT_MS = 3200;

  const state = {
    generation: 0,
    active: null,
    ownerId: '',
    statusTimer: null,
    statusMessage: '',
    statusObserver: null,
    triggerStates: new WeakMap(),
  };

  function isPlainObject(value) {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]';
  }

  function hasExactKeys(value, allowed) {
    return isPlainObject(value)
      && Object.keys(value).length === allowed.size
      && Object.keys(value).every((key) => allowed.has(key));
  }

  function localError(code, options = {}) {
    const error = new Error('Pedro navigation could not be completed.');
    error.code = code;
    error.status = Number(options.status) || 0;
    error.terminal = options.terminal === true;
    return error;
  }

  function currentSession() {
    return global.DueDiligencePhase4?.getSession?.()
      || global.DueDiligencePhase2?.getSession?.()
      || null;
  }

  function currentOwnerId() {
    const session = currentSession();
    return session?.access_token ? String(session.user?.id || '').trim() : '';
  }

  function normalizeUiAction(value) {
    if (!hasExactKeys(value, ACTION_KEYS)) return null;
    const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
    const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    if (!UUID_PATTERN.test(id) || !Object.hasOwn(DESTINATIONS, type) || label !== LABELS[type]) {
      return null;
    }
    return Object.freeze({ id, type, label });
  }

  function normalizeTarget(type, value) {
    if (!isPlainObject(value)) return null;
    if (type === 'doctrine') {
      if (!hasExactKeys(value, new Set(['contentId']))) return null;
      const contentId = typeof value.contentId === 'string' ? value.contentId.trim() : '';
      return REFERENCE_PATTERN.test(contentId) ? Object.freeze({ contentId }) : null;
    }
    if (type === 'syllabus') {
      if (!hasExactKeys(value, new Set(['versionId', 'questionId']))) return null;
      const versionId = typeof value.versionId === 'string' ? value.versionId.trim().toLowerCase() : '';
      const questionId = typeof value.questionId === 'string' ? value.questionId.trim().toLowerCase() : '';
      return UUID_PATTERN.test(versionId) && UUID_PATTERN.test(questionId)
        ? Object.freeze({ versionId, questionId })
        : null;
    }
    if (type === 'mock_bar') {
      if (!hasExactKeys(value, new Set(['subject', 'questionId']))) return null;
      const subject = typeof value.subject === 'string' ? value.subject.trim() : '';
      const questionId = typeof value.questionId === 'string' ? value.questionId.trim() : '';
      return SUBJECT_PATTERN.test(subject) && MOCK_REFERENCE_PATTERN.test(questionId)
        ? Object.freeze({ subject, questionId })
        : null;
    }
    return null;
  }

  function normalizeResolvedPayload(payload, expected) {
    if (!hasExactKeys(payload, RESPONSE_KEYS) || payload.ok !== true) return null;
    if (!hasExactKeys(payload.data, DATA_KEYS)) return null;
    const value = payload.data.action;
    if (!hasExactKeys(value, RESOLVED_ACTION_KEYS)) return null;
    const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
    const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
    if (id !== expected.id || type !== expected.type || !Object.hasOwn(DESTINATIONS, type)) return null;
    const target = normalizeTarget(type, value.target);
    return target ? Object.freeze({ id, type, target }) : null;
  }

  function currentUrl() {
    try {
      return new URL(global.location.href);
    } catch {
      return null;
    }
  }

  function replaceUrl(url) {
    if (!url || url.origin !== global.location.origin || typeof global.history?.replaceState !== 'function') {
      return false;
    }
    global.history.replaceState(global.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  function writeActionUrl(action) {
    const url = currentUrl();
    if (!url || !DESTINATIONS[action.type]) return false;
    url.searchParams.delete(ACTION_QUERY);
    url.searchParams.set(ACTION_QUERY, action.id);
    url.hash = DESTINATIONS[action.type].hash;
    return replaceUrl(url);
  }

  function clearUrl() {
    const url = currentUrl();
    if (!url || !url.searchParams.has(ACTION_QUERY)) return true;
    url.searchParams.delete(ACTION_QUERY);
    return replaceUrl(url);
  }

  function ensureStatusRegion() {
    const document = global.document;
    if (!document?.createElement) return null;
    const region = document.getElementById?.('public-navigation-status');
    if (!region) return null;
    region.setAttribute('aria-atomic', 'true');
    return region;
  }

  function removeDismissControl() {
    const dismiss = global.document?.getElementById?.('pedro-navigation-dismiss');
    if (!dismiss) return;
    dismiss.disabled = true;
    dismiss.onclick = null;
    dismiss.remove?.();
    if (dismiss.parentNode) dismiss.parentNode.removeChild?.(dismiss);
  }

  function stopStatusObserver() {
    state.statusObserver?.disconnect?.();
    state.statusObserver = null;
  }

  function releasePedroStatusOwnership() {
    global.clearTimeout?.(state.statusTimer);
    state.statusTimer = null;
    state.statusMessage = '';
    stopStatusObserver();
    removeDismissControl();
  }

  function observeStatusOverride(copy) {
    stopStatusObserver();
    if (!copy || typeof global.MutationObserver !== 'function') return;
    const expectedMessage = state.statusMessage;
    state.statusObserver = new global.MutationObserver(() => {
      if (state.statusMessage === expectedMessage && copy.textContent !== expectedMessage) {
        releasePedroStatusOwnership();
      }
    });
    state.statusObserver.observe(copy, { childList: true, characterData: true, subtree: true });
  }

  function statusParts(options = {}) {
    const region = ensureStatusRegion();
    if (!region) return {};
    const document = global.document;
    let dismiss = document.getElementById?.('pedro-navigation-dismiss');
    if (!dismiss && options.createDismiss === true) {
      dismiss = document.createElement('button');
      dismiss.id = 'pedro-navigation-dismiss';
      dismiss.type = 'button';
      dismiss.textContent = 'Close';
      dismiss.hidden = true;
      dismiss.disabled = true;
      dismiss.dataset.pedroNavigationDismiss = 'true';
      region.append(dismiss);
    }
    return {
      region,
      copy: document.getElementById?.('public-navigation-status-copy') || null,
      retry: document.getElementById?.('public-navigation-retry') || null,
      dismiss,
    };
  }

  function clearStatus(expectedMessage = '') {
    global.clearTimeout?.(state.statusTimer);
    state.statusTimer = null;
    const { region, copy, retry, dismiss } = statusParts();
    if (!region || !copy) return;
    if (expectedMessage && copy.textContent !== expectedMessage) return;
    state.statusMessage = '';
    stopStatusObserver();
    region.hidden = true;
    region.className = 'public-navigation-status';
    region.setAttribute('role', 'status');
    copy.textContent = '';
    if (retry) {
      retry.hidden = true;
      retry.disabled = true;
      retry.removeAttribute?.('aria-busy');
      retry.onclick = null;
    }
    removeDismissControl();
  }

  function setStatus(message, kind = 'status', options = {}) {
    global.clearTimeout?.(state.statusTimer);
    state.statusTimer = null;
    const dismissable = options.dismissable === true;
    const { region, copy, retry, dismiss } = statusParts({ createDismiss: dismissable });
    if (!region || !copy) {
      if (message && kind === 'error') global.toast?.(message, 'warn');
      return;
    }
    const retryAction = typeof options.retryAction === 'function' ? options.retryAction : null;
    state.statusMessage = message;
    region.hidden = !message;
    region.dataset.kind = kind;
    const announcementOnly = kind === 'loading' || kind === 'success' ? ' dd2-sr-only' : '';
    region.className = `public-navigation-status${kind ? ` is-${kind}` : ''}${announcementOnly}`;
    region.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    copy.textContent = message;
    if (retry) {
      retry.hidden = retryAction == null;
      retry.disabled = retryAction == null;
      retry.removeAttribute?.('aria-busy');
      retry.onclick = retryAction ? async () => {
        if (retry.disabled) return;
        retry.disabled = true;
        retry.setAttribute('aria-busy', 'true');
        try {
          await retryAction();
        } finally {
          retry.disabled = retry.hidden;
          retry.removeAttribute?.('aria-busy');
        }
      } : null;
    }
    if (dismiss) {
      dismiss.hidden = !dismissable;
      dismiss.disabled = !dismissable;
      dismiss.onclick = dismissable ? () => clearStatus(message) : null;
    }
    if (!dismissable) removeDismissControl();
    observeStatusOverride(copy);
    const autoClearMs = Number(options.autoClearMs) || 0;
    if (autoClearMs > 0 && typeof global.setTimeout === 'function') {
      state.statusTimer = global.setTimeout(() => clearStatus(message), autoClearMs);
      state.statusTimer?.unref?.();
    }
  }

  function finishStatusSoon(generation) {
    const message = state.statusMessage;
    if (!message || typeof global.setTimeout !== 'function') return;
    state.statusTimer = global.setTimeout(() => {
      if (generation === state.generation) clearStatus(message);
    }, 1600);
    state.statusTimer?.unref?.();
  }

  function beginTrigger(trigger) {
    if (!trigger || typeof trigger !== 'object') return;
    if (!state.triggerStates.has(trigger)) {
      state.triggerStates.set(trigger, {
        disabled: Boolean(trigger.disabled),
        ariaBusy: trigger.getAttribute?.('aria-busy'),
      });
    }
    trigger.disabled = true;
    trigger.setAttribute?.('aria-busy', 'true');
  }

  function finishTrigger(trigger) {
    const previous = trigger && state.triggerStates.get(trigger);
    if (!previous) return;
    trigger.disabled = previous.disabled;
    if (previous.ariaBusy == null) trigger.removeAttribute?.('aria-busy');
    else trigger.setAttribute?.('aria-busy', previous.ariaBusy);
    state.triggerStates.delete(trigger);
  }

  function operationIsCurrent(operation) {
    return state.active === operation
      && operation.generation === state.generation
      && operation.ownerId === currentOwnerId();
  }

  function delay(milliseconds) {
    return new Promise((resolve) => global.setTimeout(resolve, milliseconds));
  }

  async function waitFor(getValue, operation, attempts = 30) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!operationIsCurrent(operation)) throw localError('PEDRO_NAVIGATION_STALE', { terminal: true });
      const value = getValue();
      if (value) return value;
      if (attempt + 1 < attempts) await delay(50);
    }
    throw localError('PEDRO_NAVIGATION_UNAVAILABLE');
  }

  async function resolveAction(action, operation) {
    const api = await waitFor(() => (
      typeof global.DueDiligencePhase4?.request === 'function'
        ? global.DueDiligencePhase4
        : null
    ), operation);
    const payload = await api.request('/pedro/query', {
      method: 'POST',
      body: { operation: 'resolve_action', actionId: action.id },
      recoverAccess: false,
    });
    if (!operationIsCurrent(operation)) throw localError('PEDRO_NAVIGATION_STALE', { terminal: true });
    const returnedAction = payload?.data?.action;
    const returnedId = typeof returnedAction?.id === 'string'
      ? returnedAction.id.trim().toLowerCase()
      : '';
    const returnedType = typeof returnedAction?.type === 'string'
      ? returnedAction.type.trim().toLowerCase()
      : '';
    if (returnedId && returnedType && (returnedId !== action.id || returnedType !== action.type)) {
      throw localError('PEDRO_DESTINATION_MISMATCH', { terminal: true });
    }
    const resolved = normalizeResolvedPayload(payload, action);
    if (!resolved) throw localError('PEDRO_INVALID_RESPONSE');
    return resolved;
  }

  async function dispatchResolvedAction(action, trigger, operation) {
    const destination = DESTINATIONS[action.type];
    const navigation = await waitFor(() => (
      typeof global.DueDiligencePublicNavigation?.open === 'function'
        ? global.DueDiligencePublicNavigation
        : null
    ), operation);
    const pageOpened = await navigation.open(destination.feature, trigger || null);
    if (!operationIsCurrent(operation)) throw localError('PEDRO_NAVIGATION_STALE', { terminal: true });
    if (pageOpened !== true) throw localError('PEDRO_PAGE_NOT_OPENED');

    let exactOpened = false;
    if (action.type === 'doctrine') {
      const opener = await waitFor(() => (
        typeof global.openDoctrines === 'function' ? global.openDoctrines : null
      ), operation);
      exactOpened = await opener({ detailId: action.target.contentId, routeDetail: false });
    } else if (action.type === 'syllabus') {
      const examinations = await waitFor(() => (
        typeof global.DueDiligenceExaminations?.openTargetedQuestion === 'function'
          ? global.DueDiligenceExaminations
          : null
      ), operation);
      exactOpened = await examinations.openTargetedQuestion(action.target);
    } else if (action.type === 'mock_bar') {
      const opener = await waitFor(() => (
        typeof global.openQuorumMappedQuestion === 'function'
          ? global.openQuorumMappedQuestion
          : null
      ), operation);
      exactOpened = await opener(action.target.subject, action.target.questionId);
    }
    if (!operationIsCurrent(operation)) throw localError('PEDRO_NAVIGATION_STALE', { terminal: true });
    if (exactOpened !== true) throw localError('PEDRO_EXACT_DESTINATION_NOT_OPENED');
    return true;
  }

  function terminalError(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const status = Number(error?.status) || 0;
    return error?.terminal === true
      || TERMINAL_CODES.has(code)
      || (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status));
  }

  function errorOutcome(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    if (AUTH_REQUIRED_CODES.has(code)) return OUTCOMES['auth-required'];
    if (STALE_CODES.has(code)) return OUTCOMES.stale;
    if (terminalError(error)) return OUTCOMES.terminal;
    return OUTCOMES.retryable;
  }

  function publicErrorMessage(error, outcome) {
    const code = String(error?.code || '').trim().toUpperCase();
    if (outcome.status === 'auth-required') {
      return 'Sign in again to open this Pedro study link.';
    }
    if (code === 'PEDRO_ACTIVE_ATTEMPT') {
      return 'Finish or leave the current Syllabus-Based Review attempt, then try this Pedro button again.';
    }
    if (outcome.status === 'stale') {
      return 'That Pedro study destination has expired. Ask Pedro to find it again.';
    }
    if (outcome.status === 'terminal' && (code.includes('ACCESS') || code.includes('PAID') || code.includes('TERMS'))) {
      return 'This Pedro study link is not available for this account.';
    }
    if (outcome.status === 'terminal') {
      return 'That Pedro study destination is no longer available. Ask Pedro to find it again.';
    }
    if (global.navigator?.onLine === false) {
      return 'You are offline. Your Pedro study link is saved—reconnect, then try again.';
    }
    return 'That Pedro study destination could not open yet. Your link is saved—try again.';
  }

  async function run(action, trigger, options, operation) {
    beginTrigger(trigger);
    setStatus(`Opening ${action.label}…`, 'loading');
    try {
      const resolved = await resolveAction(action, operation);
      await dispatchResolvedAction(resolved, trigger, operation);
      if (!operationIsCurrent(operation)) return OUTCOMES.stale;
      if (!writeActionUrl(resolved)) throw localError('PEDRO_URL_UNAVAILABLE');
      setStatus(`${action.label} opened.`, 'success');
      finishStatusSoon(operation.generation);
      return OUTCOMES.opened;
    } catch (error) {
      if (!operationIsCurrent(operation)) return OUTCOMES.stale;
      const outcome = errorOutcome(error);
      if (options.restore === true && ['terminal', 'stale'].includes(outcome.status)) clearUrl();
      if (outcome.status === 'auth-required'
        || (options.restore === true && outcome.status === 'retryable')) {
        writeActionUrl(action);
      }
      const message = publicErrorMessage(error, outcome);
      setStatus(
        message,
        'error',
        {
          retryAction: outcome.status === 'retryable'
            ? () => (options.restore === true ? restoreFromUrl() : open(action, trigger))
            : null,
          dismissable: true,
          autoClearMs: ['terminal', 'stale', 'auth-required'].includes(outcome.status)
            ? TERMINAL_STATUS_TIMEOUT_MS
            : 0,
        },
      );
      return outcome;
    } finally {
      finishTrigger(trigger);
    }
  }

  function start(action, trigger, options = {}) {
    const ownerId = currentOwnerId();
    if (state.active) {
      if (state.active.action.id === action.id && state.active.ownerId === ownerId) {
        return state.active.promise;
      }
      setStatus(
        'Another Pedro study destination is already opening. Please wait.',
        'status',
        { dismissable: true, autoClearMs: BUSY_STATUS_TIMEOUT_MS },
      );
      return Promise.resolve(OUTCOMES.busy);
    }
    const operation = {
      action,
      ownerId,
      generation: ++state.generation,
      trigger,
      promise: null,
    };
    state.active = operation;
    operation.promise = run(action, trigger, options, operation).finally(() => {
      if (state.active === operation) state.active = null;
    });
    return operation.promise;
  }

  async function open(action, trigger = null) {
    const normalized = normalizeUiAction(action);
    if (!normalized) {
      setStatus(
        'That Pedro study button is invalid. Ask Pedro to find the topic again.',
        'error',
        { dismissable: true, autoClearMs: TERMINAL_STATUS_TIMEOUT_MS },
      );
      return OUTCOMES.terminal;
    }
    if (!currentOwnerId()) {
      writeActionUrl(normalized);
      setStatus(
        'Sign in again to open this Pedro study link. It will stay saved while you sign in.',
        'error',
        { dismissable: true, autoClearMs: TERMINAL_STATUS_TIMEOUT_MS },
      );
      return OUTCOMES['auth-required'];
    }
    return start(normalized, trigger, { restore: false });
  }

  function actionFromUrl() {
    const url = currentUrl();
    if (!url) return { invalid: true };
    const values = url.searchParams.getAll(ACTION_QUERY);
    if (!values.length) return null;
    const id = values.length === 1 ? values[0].trim().toLowerCase() : '';
    const type = HASH_TYPES[url.hash] || '';
    if (!UUID_PATTERN.test(id) || !type) return { invalid: true };
    return Object.freeze({ id, type, label: LABELS[type] });
  }

  async function restoreFromUrl() {
    const action = actionFromUrl();
    if (!action) return OUTCOMES.stale;
    if (action.invalid) {
      clearUrl();
      setStatus(
        'That Pedro study link is invalid. Ask Pedro to find the topic again.',
        'error',
        { dismissable: true, autoClearMs: TERMINAL_STATUS_TIMEOUT_MS },
      );
      return OUTCOMES.terminal;
    }
    try {
      await global.DueDiligencePhase2?.whenAuthReady?.();
    } catch {
      setStatus(
        'That Pedro study destination could not open yet. Your link is saved—try again.',
        'error',
        { retryAction: restoreFromUrl, dismissable: true },
      );
      return OUTCOMES.retryable;
    }
    if (!currentOwnerId()) {
      setStatus(
        'Sign in to open this Pedro study link. It will stay saved while you sign in.',
        'error',
        { dismissable: true, autoClearMs: TERMINAL_STATUS_TIMEOUT_MS },
      );
      return OUTCOMES['auth-required'];
    }
    return start(action, null, { restore: true });
  }

  function invalidateForAccountChange() {
    const ownerId = currentOwnerId();
    if (ownerId === state.ownerId) return;
    state.ownerId = ownerId;
    state.generation += 1;
    if (state.active) finishTrigger(state.active.trigger);
    state.active = null;
    const action = actionFromUrl();
    if (ownerId && action && !action.invalid && typeof global.setTimeout === 'function') {
      const expectedOwnerId = ownerId;
      const timer = global.setTimeout(() => {
        if (currentOwnerId() === expectedOwnerId) restoreFromUrl();
      }, 0);
      timer?.unref?.();
    }
  }

  state.ownerId = currentOwnerId();
  global.addEventListener?.('duediligence:session', invalidateForAccountChange);
  global.addEventListener?.('popstate', () => { restoreFromUrl(); });

  global.DueDiligencePedroNavigation = Object.freeze({ open, restoreFromUrl, clearUrl });
})(window);
