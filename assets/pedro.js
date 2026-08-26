(function dueDiligencePedro(global) {
  'use strict';

  const inboxLimit = 50;
  const messageLimit = 1000;
  const actionTypes = new Set(['doctrine', 'syllabus', 'mock_bar']);
  const navigationStatuses = new Set([
    'opened',
    'busy',
    'terminal',
    'stale',
    'auth-required',
    'retryable',
  ]);
  const uuidFields = ['uuid', 'id', 'doctrineId', 'questionId', 'contentId'];
  const textMetadataFields = ['subject', 'course', 'term'];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const metadataPattern = /^[a-z0-9][a-z0-9 .,&()'/-]{0,99}$/i;
  const technicalDetailPattern = /\b(?:api[_ -]?key|resource_exhausted|service\s+credential|model\s+(?:id|quota)|provider\s+quota)\b/i;

  const state = {
    mounted: false,
    container: null,
    root: null,
    refs: null,
    ownerId: '',
    threadId: '',
    messages: [],
    draft: '',
    pendingSend: null,
    loading: false,
    sending: false,
    actionOpening: false,
    retrying: false,
    error: null,
    controller: null,
    generation: 0,
    renderedMessageCount: 0,
  };

  function phaseApi() {
    if (typeof global.DueDiligencePhase4?.request === 'function') {
      return global.DueDiligencePhase4;
    }
    if (typeof global.DueDiligencePhase2?.request === 'function') {
      return global.DueDiligencePhase2;
    }
    return null;
  }

  function session() {
    return global.DueDiligencePhase4?.getSession?.()
      || global.DueDiligencePhase2?.getSession?.()
      || null;
  }

  function currentUserId() {
    return String(session()?.user?.id || '').trim();
  }

  function hasAuthenticatedSession() {
    return Boolean(currentUserId() && session()?.access_token);
  }

  function requestKey() {
    const value = global.crypto?.randomUUID?.();
    if (value) return `pedro_${value.replace(/-/g, '')}`;
    return `pedro_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function safeText(value, maximum) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      return '';
    }
    return text;
  }

  function safeMessageText(value) {
    const text = safeText(value, messageLimit);
    return text && !technicalDetailPattern.test(text) ? text : '';
  }

  function safePublicText(value, maximum) {
    const text = safeText(value, maximum);
    return text && !technicalDetailPattern.test(text) ? text : '';
  }

  function normalizeAction(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const type = safeText(input.type, 40).toLowerCase();
    const label = safePublicText(input.label, 100);
    if (!actionTypes.has(type) || !label) return null;

    const action = { type, label };
    for (const field of uuidFields) {
      const value = safeText(input[field], 64);
      if (value && uuidPattern.test(value)) action[field] = value;
    }
    for (const field of textMetadataFields) {
      const value = safePublicText(input[field], 100);
      if (value && metadataPattern.test(value)) action[field] = value;
    }
    const year = Number(input.year);
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) action.year = year;
    return Object.freeze(action);
  }

  function normalizeNavigationOutcome(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'retryable';
    const keys = Object.keys(input);
    const status = keys.length === 1 && keys[0] === 'status'
      ? safeText(input.status, 40).toLowerCase()
      : '';
    return navigationStatuses.has(status) ? status : 'retryable';
  }

  function normalizeMessage(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const role = input.role === 'user' || input.role === 'pedro' ? input.role : '';
    const text = safeMessageText(input.text);
    if (!role || !text) return null;

    const id = safeText(input.id, 160);
    if (!id) return null;
    const createdAtValue = safeText(input.createdAt, 80);
    const createdAt = createdAtValue && Number.isFinite(Date.parse(createdAtValue))
      ? new Date(createdAtValue).toISOString()
      : '';
    const actions = Array.isArray(input.actions)
      ? input.actions.slice(0, 6).map(normalizeAction).filter(Boolean)
      : [];
    return Object.freeze({ id, role, text, actions: Object.freeze(actions), createdAt });
  }

  function normalizeMessages(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const messages = [];
    for (const value of input.slice(-inboxLimit)) {
      const message = normalizeMessage(value);
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      messages.push(message);
    }
    return messages;
  }

  function normalizeThreadId(value) {
    const threadId = safeText(value, 160);
    return /^[a-z0-9_-]+$/i.test(threadId) ? threadId : '';
  }

  function element(tagName, className = '', text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function cancelRequest() {
    state.controller?.abort();
    state.controller = null;
  }

  function beginRequest() {
    cancelRequest();
    state.generation += 1;
    state.controller = new AbortController();
    return { generation: state.generation, controller: state.controller, ownerId: state.ownerId };
  }

  function requestIsCurrent(request) {
    return state.mounted
      && request.generation === state.generation
      && request.ownerId === state.ownerId
      && request.ownerId === currentUserId()
      && !request.controller.signal.aborted;
  }

  function publicError(error, context) {
    const code = String(error?.code || '').trim().toUpperCase();
    if (code === 'AUTHENTICATION_REQUIRED' || code === 'INVALID_SESSION') {
      return {
        title: 'Sign in to use Pedro',
        message: 'Your private study inbox is available after you sign in.',
      };
    }
    if (['PEDRO_ACCESS_REQUIRED', 'PEDRO_PAID_REQUIRED', 'PAID_ACCESS_REQUIRED'].includes(code)) {
      return {
        title: 'Pedro is for paid members',
        message: 'Open Plans & Pricing to see the currently available paid access choices.',
      };
    }
    if (['CURRENT_TERMS_REQUIRED', 'PEDRO_TERMS_REQUIRED', 'TERMS_REQUIRED'].includes(code)) {
      return {
        title: 'Accept the current terms first',
        message: 'Open Account, review the current Terms and Privacy notice, then try Pedro again.',
      };
    }
    if (code === 'OFFLINE' || global.navigator?.onLine === false) {
      return {
        title: 'You are offline',
        message: context === 'message'
          ? 'Your message is still here. Reconnect, then try sending it again.'
          : 'Reconnect to load your Pedro inbox.',
      };
    }
    if (['RATE_LIMITED', 'TOO_MANY_REQUESTS', 'PEDRO_RATE_LIMITED'].includes(code)) {
      return {
        title: 'Pedro needs a moment',
        message: context === 'message'
          ? 'Your message is still here. Please try sending it again shortly.'
          : 'Please try loading your inbox again shortly.',
      };
    }
    if (code === 'PEDRO_BUSY') {
      return {
        title: 'Pedro is still finishing your message',
        message: 'Your message is still here. Please try again in a moment; the same message will not be duplicated.',
      };
    }
    if (code === 'PEDRO_ACTIVE_ATTEMPT') {
      return {
        title: 'Finish the current review first',
        message: 'Finish or leave the current Syllabus-Based Review attempt, then try this Pedro button again.',
      };
    }
    if (code === 'PEDRO_THREAD_INVALID' || code === 'PEDRO_HISTORY_CURSOR_INVALID') {
      return {
        title: 'Reload your Pedro inbox',
        message: 'This saved inbox position is no longer available. Reload the latest messages.',
      };
    }
    return {
      title: 'Pedro is taking longer than expected',
      message: context === 'message'
        ? 'Your message is still here. Nothing was cleared; please try sending it again.'
        : 'Your inbox could not be loaded just now. Please try again.',
    };
  }

  function localError(code) {
    const error = new Error('Pedro request unavailable');
    error.code = code;
    return error;
  }

  async function post(path, body, request) {
    if (!hasAuthenticatedSession()) throw localError('AUTHENTICATION_REQUIRED');
    if (global.navigator?.onLine === false) throw localError('OFFLINE');
    const api = phaseApi();
    if (!api) throw localError('PEDRO_UNAVAILABLE');
    return api.request(path, {
      method: 'POST',
      body,
      signal: request.controller.signal,
      requestIdValue: body.requestKey,
    });
  }

  function setOwner(userId) {
    if (state.ownerId === userId) return;
    cancelRequest();
    state.generation += 1;
    state.ownerId = userId;
    state.threadId = '';
    state.messages = [];
    state.draft = '';
    state.pendingSend = null;
    state.loading = false;
    state.sending = false;
    state.actionOpening = false;
    state.retrying = false;
    state.error = null;
    state.renderedMessageCount = 0;
  }

  function syncBusyState() {
    if (!state.refs) return;
    const busy = state.loading || state.sending || state.actionOpening;
    const authenticated = hasAuthenticatedSession();
    state.root?.setAttribute('aria-busy', String(busy));
    state.container?.setAttribute?.('aria-busy', String(busy));
    state.refs.input.disabled = busy || !authenticated;
    const hasMessage = Boolean(state.refs.input.value.trim());
    state.refs.submit.disabled = busy || !authenticated || !hasMessage;
    state.refs.submit.setAttribute('aria-busy', String(state.sending));
    state.refs.submit.textContent = state.retrying
      ? 'Trying again…'
      : state.sending
        ? 'Sending…'
        : 'Send to Pedro';
    state.root?.querySelectorAll?.('.pedro-action, .pedro-suggestion, .pedro-retry')
      .forEach((control) => {
        control.disabled = busy || !authenticated;
        if (busy) control.setAttribute('aria-disabled', 'true');
        else control.removeAttribute('aria-disabled');
      });
  }

  function setStatus(message = '') {
    if (!state.refs) return;
    state.refs.status.textContent = message;
  }

  function makeActionButton(action, className = 'lex-button lex-button-quiet') {
    const button = element('button', `${className} pedro-action`, action.label);
    button.type = 'button';
    button.disabled = state.loading || state.sending || state.actionOpening || !hasAuthenticatedSession();
    button.addEventListener('click', () => openAction(action, button));
    return button;
  }

  function makeSuggestionButton(label, prompt) {
    const button = element('button', 'lex-button lex-button-quiet pedro-suggestion', label);
    button.type = 'button';
    button.disabled = state.loading || state.sending || state.actionOpening || !hasAuthenticatedSession();
    button.addEventListener('click', () => {
      if (!state.refs || state.loading || state.sending || state.actionOpening) return;
      state.draft = prompt;
      state.pendingSend = null;
      state.error = null;
      state.refs.input.value = prompt;
      state.refs.input.focus?.();
      setStatus('Your study question is ready to send.');
      renderThread();
    });
    return button;
  }

  function renderEmpty() {
    const item = element('li', 'pedro-empty');
    const kicker = element('p', 'pedro-kicker', 'Your private study inbox');
    const title = element('h3', 'pedro-empty-title', 'Start with one focused question');
    const copy = element('p', 'pedro-empty-copy', 'Hi. What are we sharpening today? One focused question at a time.');
    const actions = element('div', 'pedro-quick-actions');
    [
      ['Review a doctrine', 'I want to review a doctrine.'],
      ['Find a syllabus topic', 'Help me find a topic in Syllabus-Based Review.'],
      ['Find a practice question', 'Help me find a question in Bar Question Practice.'],
    ].forEach(([label, prompt]) => actions.append(makeSuggestionButton(label, prompt)));
    item.append(kicker, title, copy, actions);
    return item;
  }

  function renderLoading() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 2; index += 1) {
      const item = element('li', 'pedro-message pedro-message--loading');
      item.setAttribute('aria-hidden', 'true');
      item.append(
        element('span', 'pedro-skeleton pedro-skeleton--label'),
        element('span', 'pedro-skeleton pedro-skeleton--line'),
        element('span', 'pedro-skeleton pedro-skeleton--short'),
      );
      fragment.append(item);
    }
    return fragment;
  }

  function renderMessage(message, options = {}) {
    const item = element('li', `pedro-message pedro-message--${message.role}`);
    if (options.pending) item.classList.add('is-pending');
    const label = element('p', 'pedro-message-role', message.role === 'user' ? 'You' : 'Pedro');
    const copy = element('p', 'pedro-message-copy', message.text);
    item.append(label, copy);

    if (message.createdAt) {
      const time = element('time', 'pedro-message-time');
      time.dateTime = message.createdAt;
      time.textContent = new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }).format(new Date(message.createdAt));
      item.append(time);
    }

    if (message.actions.length) {
      const actions = element('div', 'pedro-message-actions');
      message.actions.forEach((action) => actions.append(makeActionButton(action)));
      item.append(actions);
    }
    return item;
  }

  function renderErrorPanel() {
    if (!state.error) return null;
    const item = element('li', 'pedro-error');
    item.setAttribute('role', 'alert');
    const title = element('h3', 'pedro-error-title', state.error.title);
    const message = element('p', 'pedro-error-copy', state.error.message);
    item.append(title, message);

    if (state.error.retry === 'inbox' || state.error.retry === 'message' || state.error.retry === 'action') {
      const button = element(
        'button',
        'lex-button lex-button-quiet pedro-retry',
        state.error.retry === 'message' ? 'Try sending again' : 'Try again',
      );
      button.type = 'button';
      button.addEventListener('click', () => {
        if (state.error?.retry === 'message') sendPending({ retry: true });
        else if (state.error?.retry === 'action' && state.error.action) openAction(state.error.action, button);
        else refresh();
      });
      item.append(button);
    }
    return item;
  }

  function threadIsNearLatest() {
    const thread = state.refs?.thread;
    if (!thread) return true;
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 72;
  }

  function syncJumpToLatest() {
    const thread = state.refs?.thread;
    const jump = state.refs?.jump;
    if (!thread || !jump) return;
    const hasOverflow = thread.scrollHeight > thread.clientHeight + 8;
    jump.hidden = !hasOverflow || threadIsNearLatest();
  }

  function scrollThreadToLatest() {
    const thread = state.refs?.thread;
    if (!thread) return;
    thread.scrollTo?.({
      top: thread.scrollHeight,
      behavior: global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
    });
    if (typeof thread.scrollTo !== 'function') thread.scrollTop = thread.scrollHeight;
    syncJumpToLatest();
  }

  function renderThread(options = {}) {
    if (!state.refs) return;
    const wasNearLatest = threadIsNearLatest();
    const previousMessageCount = state.renderedMessageCount;
    const children = [];
    if (state.loading) {
      children.push(renderLoading());
    } else {
      state.messages.forEach((message) => children.push(renderMessage(message)));
      if (state.sending && state.pendingSend) {
        children.push(renderMessage({
          id: `local_${state.pendingSend.requestKey}`,
          role: 'user',
          text: state.pendingSend.message,
          actions: [],
          createdAt: '',
        }, { pending: true }));
        children.push(renderMessage({
          id: `pending_${state.pendingSend.requestKey}`,
          role: 'pedro',
          text: 'Pedro is preparing a reply…',
          actions: [],
          createdAt: '',
        }, { pending: true }));
      } else if (!state.messages.length && !state.error) {
        children.push(renderEmpty());
      }
      const error = renderErrorPanel();
      if (error) children.push(error);
    }
    state.refs.thread.replaceChildren(...children);
    state.renderedMessageCount = state.messages.length;
    state.root.dataset.state = state.loading
      ? 'loading'
      : state.retrying
        ? 'retrying'
        : state.sending
          ? 'sending'
          : state.actionOpening
            ? 'opening'
          : state.error
            ? 'error'
            : state.messages.length
              ? 'populated'
              : 'empty';
    syncBusyState();
    const shouldScroll = options.scrollLatest === true
      || wasNearLatest
      || state.messages.length > previousMessageCount;
    const afterRender = () => {
      if (shouldScroll) scrollThreadToLatest();
      else syncJumpToLatest();
    };
    if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(afterRender);
    else global.setTimeout?.(afterRender, 0);
  }

  function buildShell(container) {
    const root = element('section', 'pedro-inbox');
    root.id = 'pedro-inbox';
    root.setAttribute('aria-labelledby', 'pedro-inbox-title');
    root.setAttribute('aria-busy', 'false');

    const header = element('header', 'pedro-header');
    const kicker = element('p', 'pedro-kicker', 'Your private study inbox');
    const title = element('h2', 'pedro-title', 'Pedro');
    title.id = 'pedro-inbox-title';
    const intro = element('p', 'pedro-intro', 'Friendly study support, right where you review.');
    header.append(kicker, title, intro);

    const notice = element(
      'p',
      'pedro-website-notice',
      'Pedro replies only here on DueDiligence.ph—never by email, text, Messenger, or WhatsApp.',
    );
    notice.id = 'pedro-website-notice';

    const status = element('p', 'pedro-status lex-status');
    status.id = 'pedro-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const thread = element('ol', 'pedro-thread');
    thread.id = 'pedro-thread';
    thread.setAttribute('aria-label', 'Conversation with Pedro');
    thread.setAttribute('aria-describedby', 'pedro-status');

    const jump = element('button', 'lex-button lex-button-quiet pedro-jump-latest', 'Jump to latest');
    jump.type = 'button';
    jump.hidden = true;
    jump.setAttribute('aria-controls', 'pedro-thread');
    jump.addEventListener('click', scrollThreadToLatest);
    thread.addEventListener('scroll', syncJumpToLatest, { passive: true });

    const form = element('form', 'pedro-composer');
    form.noValidate = true;
    const label = element('label', 'pedro-composer-label', 'Message Pedro');
    label.htmlFor = 'pedro-message-input';
    const input = element('textarea', 'pedro-composer-input');
    input.id = 'pedro-message-input';
    input.name = 'message';
    input.rows = 4;
    input.maxLength = messageLimit;
    input.placeholder = 'Ask about a doctrine, syllabus topic, or practice question…';
    input.setAttribute('aria-describedby', 'pedro-composer-guidance pedro-status');
    const guidance = element(
      'p',
      'pedro-composer-guidance',
      'Pedro supports your study process; verify legal authorities against current official sources.',
    );
    guidance.id = 'pedro-composer-guidance';
    const formActions = element('div', 'pedro-composer-actions');
    const submit = element('button', 'lex-button lex-button-primary pedro-submit', 'Send to Pedro');
    submit.type = 'submit';
    submit.disabled = true;
    formActions.append(submit);
    form.append(label, input, guidance, formActions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitDraft();
    });
    input.addEventListener('input', () => {
      state.draft = input.value;
      if (state.pendingSend && input.value.trim() !== state.pendingSend.message) {
        state.pendingSend = null;
        if (state.error?.retry === 'message') state.error = null;
        renderThread();
      }
      syncBusyState();
    });
    input.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submitDraft();
      }
    });

    root.append(header, notice, status, thread, jump, form);
    container.replaceChildren(root);
    state.root = root;
    state.refs = { status, thread, jump, form, input, submit };
    input.value = state.draft;
    syncBusyState();
  }

  async function openAction(action, trigger) {
    const normalized = normalizeAction(action);
    if (!normalized) return false;
    if (state.loading || state.sending || state.actionOpening) {
      setStatus('Pedro is finishing the current action. Please wait.');
      return false;
    }
    const navigation = global.DueDiligencePedroNavigation;
    if (typeof navigation?.open !== 'function') {
      state.error = {
        title: 'That study feature is not ready',
        message: 'Please try opening it again.',
        retry: 'action',
        action: normalized,
      };
      renderThread();
      return false;
    }
    const actionContext = {
      generation: state.generation,
      ownerId: state.ownerId,
      root: state.root,
    };
    const actionContextIsCurrent = () => state.mounted
      && state.root === actionContext.root
      && state.generation === actionContext.generation
      && state.ownerId === actionContext.ownerId
      && currentUserId() === actionContext.ownerId;
    state.error = null;
    state.actionOpening = true;
    setStatus(`Opening ${normalized.label}…`);
    state.root.dataset.state = 'opening';
    syncBusyState();
    try {
      const status = normalizeNavigationOutcome(await navigation.open(normalized, trigger));
      if (!actionContextIsCurrent()) return false;
      state.actionOpening = false;
      if (status === 'opened') {
        state.error = null;
        setStatus('Study feature opened.');
        renderThread();
        return true;
      }
      if (status === 'busy') {
        state.error = null;
        setStatus('Another Pedro study destination is already opening. Please wait.');
        renderThread();
        return false;
      }
      if (status === 'auth-required') {
        state.error = { ...publicError(localError('AUTHENTICATION_REQUIRED'), 'inbox'), retry: null };
      } else if (status === 'terminal' || status === 'stale') {
        state.error = {
          title: 'That study destination is no longer available',
          message: 'Ask Pedro to find the topic again and create a current study button.',
          retry: null,
        };
      } else {
        state.error = {
          title: 'That study feature could not be opened',
          message: 'Your Pedro inbox is still here. Please try again.',
          retry: 'action',
          action: normalized,
        };
      }
      setStatus('');
      renderThread({ scrollLatest: true });
      return false;
    } catch {
      if (!actionContextIsCurrent()) return false;
      state.actionOpening = false;
      state.error = {
        title: 'That study feature could not be opened',
        message: 'Your Pedro inbox is still here. Please try again.',
        retry: 'action',
        action: normalized,
      };
      setStatus('');
      renderThread({ scrollLatest: true });
      return false;
    } finally {
      if (actionContextIsCurrent() && state.actionOpening) {
        state.actionOpening = false;
        syncBusyState();
      }
    }
  }

  async function refresh() {
    if (!state.mounted || state.sending || state.actionOpening) return false;
    const userId = currentUserId();
    setOwner(userId);
    if (!hasAuthenticatedSession()) {
      state.error = { ...publicError(localError('AUTHENTICATION_REQUIRED'), 'inbox'), retry: null };
      state.loading = false;
      renderThread();
      return false;
    }

    const activeRequest = beginRequest();
    state.loading = true;
    state.error = null;
    setStatus('Loading your Pedro inbox…');
    renderThread();
    try {
      const payload = await post('/pedro/query', {
        operation: 'bootstrap',
        limit: inboxLimit,
      }, activeRequest);
      if (!requestIsCurrent(activeRequest)) return false;
      if (payload?.ok !== true || !payload.data || !Array.isArray(payload.data.messages)) {
        throw localError('INVALID_RESPONSE');
      }
      state.threadId = normalizeThreadId(payload.data.threadId);
      state.messages = normalizeMessages(payload.data.messages);
      state.loading = false;
      state.error = null;
      setStatus(state.messages.length ? 'Pedro inbox loaded.' : 'Pedro is ready when you are.');
      renderThread();
      return true;
    } catch (error) {
      if (!requestIsCurrent(activeRequest)) return false;
      state.loading = false;
      state.error = { ...publicError(error, 'inbox'), retry: 'inbox' };
      setStatus('');
      renderThread();
      return false;
    } finally {
      if (state.controller === activeRequest.controller) state.controller = null;
    }
  }

  function appendMessage(message) {
    if (!message || state.messages.some((item) => item.id === message.id)) return;
    state.messages.push(message);
    if (state.messages.length > inboxLimit) state.messages = state.messages.slice(-inboxLimit);
  }

  async function sendPending(options = {}) {
    if (!state.mounted || state.sending || state.actionOpening || !state.pendingSend) return false;
    const userId = currentUserId();
    setOwner(userId);
    if (!state.pendingSend || !hasAuthenticatedSession()) {
      state.error = { ...publicError(localError('AUTHENTICATION_REQUIRED'), 'message'), retry: null };
      renderThread();
      return false;
    }

    const pending = state.pendingSend;
    const activeRequest = beginRequest();
    state.sending = true;
    state.retrying = options.retry === true;
    state.error = null;
    setStatus(state.retrying
      ? 'Trying again. Pedro is preparing a reply…'
      : 'Sending your message. Pedro is preparing a reply…');
    renderThread();
    try {
      const payload = await post('/pedro/message', {
        message: pending.message,
        requestKey: pending.requestKey,
      }, activeRequest);
      if (!requestIsCurrent(activeRequest)) return false;
      if (payload?.ok === true && payload.data?.inProgress === true) {
        throw localError('PEDRO_BUSY');
      }
      const reply = payload?.ok === true ? normalizeMessage(payload.data?.message) : null;
      if (!reply || reply.role !== 'pedro') throw localError('INVALID_RESPONSE');

      const replyAlreadyPresent = state.messages.some((message) => message.id === reply.id);
      if (!replyAlreadyPresent) {
        appendMessage(normalizeMessage({
          id: `local_${pending.requestKey}`,
          role: 'user',
          text: pending.message,
          actions: [],
          createdAt: new Date().toISOString(),
        }));
      }
      appendMessage(reply);
      state.sending = false;
      state.retrying = false;
      state.pendingSend = null;
      state.draft = '';
      state.refs.input.value = '';
      state.error = null;
      setStatus('Pedro replied.');
      renderThread();
      return true;
    } catch (error) {
      if (!requestIsCurrent(activeRequest)) return false;
      state.sending = false;
      state.retrying = false;
      state.error = { ...publicError(error, 'message'), retry: 'message' };
      state.draft = state.refs.input.value;
      setStatus('');
      renderThread();
      return false;
    } finally {
      if (state.controller === activeRequest.controller) state.controller = null;
    }
  }

  function submitDraft() {
    if (!state.refs || state.loading || state.sending || state.actionOpening) return false;
    const message = safeMessageText(state.refs.input.value);
    if (!message) {
      state.error = {
        title: 'Write a short study question',
        message: `Your message must be between 1 and ${messageLimit.toLocaleString()} characters.`,
        retry: null,
      };
      renderThread();
      state.refs.input.focus?.();
      return false;
    }
    if (!state.pendingSend || state.pendingSend.message !== message) {
      state.pendingSend = Object.freeze({ message, requestKey: requestKey() });
    }
    state.draft = state.refs.input.value;
    sendPending({ retry: state.error?.retry === 'message' });
    return true;
  }

  function unmount() {
    if (state.refs) state.draft = state.refs.input.value;
    cancelRequest();
    state.generation += 1;
    state.loading = false;
    state.sending = false;
    state.actionOpening = false;
    state.retrying = false;
    state.container?.setAttribute?.('aria-busy', 'false');
    const root = state.root;
    if (root?.parentNode === state.container) root.remove();
    state.mounted = false;
    state.container = null;
    state.root = null;
    state.refs = null;
    state.renderedMessageCount = 0;
    return true;
  }

  function reset() {
    cancelRequest();
    state.generation += 1;
    state.ownerId = currentUserId();
    state.threadId = '';
    state.messages = [];
    state.draft = '';
    state.pendingSend = null;
    state.loading = false;
    state.sending = false;
    state.actionOpening = false;
    state.retrying = false;
    state.renderedMessageCount = 0;
    state.error = hasAuthenticatedSession()
      ? null
      : { ...publicError(localError('AUTHENTICATION_REQUIRED'), 'inbox'), retry: null };
    if (state.refs) {
      state.refs.input.value = '';
      setStatus(hasAuthenticatedSession() ? 'Pedro is ready when you are.' : '');
      renderThread();
    }
    return true;
  }

  function mount(options = {}) {
    const container = options.container;
    if (!container || typeof container.replaceChildren !== 'function') return Promise.resolve(false);
    if (state.mounted) unmount();
    setOwner(currentUserId());
    state.mounted = true;
    state.container = container;
    buildShell(container);
    return refresh();
  }

  global.addEventListener?.('duediligence:session', (event) => {
    const userId = event.detail?.authenticated === true ? currentUserId() : '';
    if (userId === state.ownerId && userId) return;
    setOwner(userId);
    if (!state.mounted) return;
    if (userId) refresh();
    else {
      state.error = { ...publicError(localError('AUTHENTICATION_REQUIRED'), 'inbox'), retry: null };
      renderThread();
    }
  });

  global.addEventListener?.('offline', () => {
    if (!state.mounted) return;
    cancelRequest();
    state.generation += 1;
    state.loading = false;
    state.sending = false;
    state.actionOpening = false;
    state.retrying = false;
    state.error = {
      ...publicError(localError('OFFLINE'), state.pendingSend ? 'message' : 'inbox'),
      retry: state.pendingSend ? 'message' : 'inbox',
    };
    renderThread();
  });

  global.DueDiligencePedro = Object.freeze({ mount, unmount, refresh, reset });
})(window);
