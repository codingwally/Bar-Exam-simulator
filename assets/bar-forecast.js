(function dueDiligenceBarForecast(global) {
  'use strict';

  const ROUTE = '#bar-forecast-2026';
  const ENDPOINT = '/admin/dd2026/bar-forecast';
  const CONSENT_VERSION = '2026-09-01';
  const SOURCE_VERSION = '2026.3';
  const CONTENT_TYPE = 'bar_forecast_question';
  const REQUIRED_QUESTION_COUNT = 20;
  const MINIMUM_WORDS = 10;
  const MAX_ANSWER_CHARACTERS = 6000;
  // astra-forecast-durable-20260907-r1: owner-scoped drafts and canonical saved reports.
  const FORECAST_POLL_LIMIT = 120;
  const FORECAST_POLL_INTERVAL_MS = 10000;
  const FORECAST_POLL_WINDOW_MS = 20 * 60 * 1000;
  const FORECAST_REQUEST_TIMEOUT_MS = 25_000;
  const FORECAST_PDF_RENDER_TIMEOUT_MS = 60_000;
  const FORECAST_PDF_WORKER = '/assets/forecast-result-pdf-worker.js?v=astra-browser-pdf-20260908-r1';
  // Access verification is an interactive preflight, not a grading job. Keep
  // it within the same bounded session budget used by the sign-in surface so a
  // stalled auth/entitlement request always reaches a recoverable terminal UI.
  const FORECAST_ACCESS_TIMEOUT_MS = 12_000;
  const HIGHLIGHT_COLORS = Object.freeze([
    Object.freeze({ id: 'yellow', label: 'Yellow' }),
    Object.freeze({ id: 'green', label: 'Green' }),
    Object.freeze({ id: 'blue', label: 'Blue' }),
    Object.freeze({ id: 'pink', label: 'Pink' }),
  ]);
  const GRAMMAR_CORRECTION_GUIDANCE = Object.freeze({
    punctuation: Object.freeze({ label: 'Punctuation', guidance: 'Review punctuation in this exact excerpt.' }),
    capitalization: Object.freeze({ label: 'Capitalization', guidance: 'Review capitalization in this exact excerpt.' }),
    agreement: Object.freeze({ label: 'Agreement', guidance: 'Check subject–verb or pronoun agreement in this exact excerpt.' }),
    spelling: Object.freeze({ label: 'Spelling', guidance: 'Review spelling in this exact excerpt.' }),
    sentence_structure: Object.freeze({ label: 'Sentence structure', guidance: 'Review sentence boundaries and structure without changing the legal meaning.' }),
    wordiness: Object.freeze({ label: 'Wordiness', guidance: 'Shorten this excerpt while preserving every legal proposition.' }),
    professional_tone: Object.freeze({ label: 'Professional tone', guidance: 'Use formal legal phrasing without changing the substance.' }),
  });

  const SUBJECTS = Object.freeze([
    Object.freeze({
      name: 'Political and Public International Law',
      date: 'September 6, 2026',
      time: '8:00 AM–12:00 NN (Manila time)',
    }),
    Object.freeze({
      name: 'Commercial and Taxation Laws',
      date: 'September 6, 2026',
      time: '2:00 PM–6:00 PM (Manila time)',
    }),
    Object.freeze({
      name: 'Civil Law and Land Titles and Deeds',
      date: 'September 9, 2026',
      time: '8:00 AM–12:00 NN (Manila time)',
    }),
    Object.freeze({
      name: 'Labor Law and Social Legislation',
      date: 'September 9, 2026',
      time: '2:00 PM–6:00 PM (Manila time)',
    }),
    Object.freeze({
      name: 'Criminal Law',
      date: 'September 13, 2026',
      time: '8:00 AM–12:00 NN (Manila time)',
    }),
    Object.freeze({
      name: 'Remedial Law, Legal and Judicial Ethics, with Practical Exercises',
      date: 'September 13, 2026',
      time: '2:00 PM–6:00 PM (Manila time)',
    }),
  ]);

  const SUBJECT_NAMES = new Set(SUBJECTS.map((subject) => subject.name));
  const SYNTHETIC_QA_PATTERN = /(?:^synthetic-ui-|synthetic interface-test question|\bmock permit\s+\d+\b|deterministic mock output for visual)/iu;
  const state = {
    root: null,
    page: null,
    viewNode: null,
    statusNode: null,
    closeButton: null,
    lastTrigger: null,
    returnHash: '#quorum',
    isolation: [],
    previousOverflow: '',
    routeWasPushed: false,
    routeRecovery: false,
    requestController: null,
    pdfController: null,
    pdfNoteController: null,
    authorizationController: null,
    submissionTimer: null,
    submissionStartedAt: 0,
    submissionElapsedNode: null,
    isOpen: false,
    view: 'access',
    ownerId: '',
    authorizationOwnerId: '',
    authorizationErrorOwnerId: '',
    pricingRedirectInProgress: false,
    consentAccepted: false,
    subject: '',
    schedule: null,
    setId: '',
    questions: [],
    answers: new Map(),
    answerMarkup: new Map(),
    flaggedQuestions: new Set(),
    questionHighlights: new Map(),
    questionFilter: 'all',
    lastPromptSelection: null,
    answerFontSize: 16,
    currentIndex: 0,
    results: null,
    examRefs: null,
    clientAttemptId: '',
    acceptedAttempt: null,
    submissionSnapshot: null,
    draftTimer: null,
    storageError: false,
    pollTimer: null,
    pollResolve: null,
    pollGeneration: 0,
    workspaceGeneration: 0,
    historySubject: '',
    historyCompleteOnly: false,
    historyFrom: '',
    historyTo: '',
    historyItems: [],
    historyCursor: null,
    historyAnalytics: null,
  };

  function draftStorageKey() {
    const ownerId = runtimeOwnerId();
    return ownerId ? `duediligence.private.${encodeURIComponent(ownerId)}.bar-forecast.drafts.v1` : '';
  }

  function readForecastDrafts() {
    try {
      const stored = JSON.parse(global.localStorage?.getItem(draftStorageKey()) || 'null');
      return stored?.version === 1 && stored.ownerId === runtimeOwnerId()
        && stored.drafts && typeof stored.drafts === 'object' && !Array.isArray(stored.drafts)
        ? stored.drafts : {};
    } catch { return {}; }
  }

  function persistForecastDraft() {
    if (state.draftTimer !== null) global.clearTimeout(state.draftTimer);
    state.draftTimer = null;
    const ownerId = runtimeOwnerId();
    if (!ownerId || ownerId !== state.ownerId || !state.clientAttemptId || !state.questions.length) return false;
    try {
      if (!global.localStorage) throw new Error('Private draft storage unavailable');
      const drafts = readForecastDrafts();
      drafts[state.clientAttemptId] = {
        ownerId, clientAttemptId: state.clientAttemptId, subject: state.subject, setId: state.setId,
        questions: state.questions, answers: [...state.answers], markup: [...state.answerMarkup],
        flags: [...state.flaggedQuestions], highlights: [...state.questionHighlights],
        currentIndex: state.currentIndex, savedAt: Date.now(),
        submission: state.submissionSnapshot,
        attemptId: state.acceptedAttempt?.id || null,
      };
      global.localStorage.setItem(draftStorageKey(), JSON.stringify({ version: 1, ownerId, drafts }));
      state.storageError = false;
      return true;
    } catch {
      state.storageError = true;
      return false;
    }
  }

  function scheduleForecastDraftSave() {
    if (state.draftTimer !== null) global.clearTimeout(state.draftTimer);
    state.draftTimer = global.setTimeout(() => {
      if (!persistForecastDraft()) setStatus('This device could not save your draft. Keep this page open and retry before submitting.', 'error');
    }, 200);
  }

  function removeCompletedLocalDraft(clientAttemptId) {
    try {
      const drafts = readForecastDrafts();
      delete drafts[clientAttemptId];
      global.localStorage?.setItem(draftStorageKey(), JSON.stringify({ version: 1, ownerId: runtimeOwnerId(), drafts }));
    } catch { /* The canonical completed report is already stored on the server. */ }
  }

  function newClientAttemptId() {
    if (typeof global.crypto?.randomUUID === 'function') return global.crypto.randomUUID();
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  function stopForecastPolling() {
    state.pollGeneration = (state.pollGeneration || 0) + 1;
    if (state.pollTimer !== null) global.clearTimeout(state.pollTimer);
    state.pollTimer = null;
    state.pollResolve?.();
    state.pollResolve = null;
  }

  function forecastRequestIsCurrent(ownerId, generation) {
    return state.isOpen && state.ownerId === ownerId && runtimeOwnerId() === ownerId
      && state.workspaceGeneration === generation && location.hash === ROUTE;
  }

  function forecastTabs(selected) {
    const nav = element('nav', 'bf26-workspace-tabs');
    nav.setAttribute('aria-label', 'Forecast workspace');
    for (const [id, label] of [['new', 'New forecast'], ['history', 'Saved attempts'], ['analytics', 'Analytics']]) {
      const button = makeButton(label, `bf26-button${selected === id ? ' bf26-button--primary' : ''}`);
      button.setAttribute('aria-current', selected === id ? 'page' : 'false');
      button.addEventListener('click', () => {
        stopForecastPolling(); abortRequest();
        state.workspaceGeneration = (state.workspaceGeneration || 0) + 1;
        if (id === 'new') renderSubjectPicker();
        else loadForecastHistory(id);
      });
      nav.append(button);
    }
    return nav;
  }

  function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function makeButton(label, className = 'bf26-button') {
    const button = element('button', className, label);
    button.type = 'button';
    return button;
  }

  function runtimeSession() {
    return global.DueDiligencePhase4?.getSession?.()
      || global.DueDiligencePhase2?.getSession?.()
      || null;
  }

  function runtimeOwnerId() {
    const session = runtimeSession();
    return session?.access_token ? String(session.user?.id || '').trim() : '';
  }

  function wordCount(value) {
    return String(value || '').trim().match(/\S+/gu)?.length || 0;
  }

  function answerParagraphPlaceholder(node) {
    if (node?.tagName !== 'DIV') return false;
    let leaf = node;
    while (leaf.childNodes?.length === 1) {
      leaf = leaf.firstChild;
      if (leaf.nodeName === 'BR') return true;
      if (!['B', 'STRONG', 'I', 'EM', 'U', 'SPAN'].includes(leaf.nodeName)) return false;
    }
    return false;
  }

  function answerParagraphText(parent) {
    let text = '';
    let hasPart = false;
    let previousBlock = false;
    for (const child of parent.childNodes) {
      const block = child.nodeType === 1 && child.tagName === 'DIV';
      const value = child.nodeType === 3 ? child.textContent
        : child.nodeName === 'BR' ? '\n' : answerParagraphPlaceholder(child) ? '' : answerParagraphText(child);
      if (block) {
        if (hasPart) text += '\n';
        text += value;
        hasPart = true;
        previousBlock = true;
      } else if (value) {
        if (previousBlock) text += '\n';
        text += value;
        hasPart = true;
        previousBlock = false;
      }
    }
    return text;
  }

  function answerPlainText(editor) {
    let plain = String(editor?.innerText || '');
    // Chrome uses <div><br></div> for an empty typed/pasted paragraph.
    // innerText counts both its block boundary and placeholder BR, inventing
    // a newline (and potentially truncating a 6,000-character pasted answer).
    // Read that exact ordinary-paragraph shape without touching DOM/caret/undo
    // or rich markup. Keep the existing behavior for paragraph/list formats.
    if (editor?.querySelectorAll && !editor.querySelector('p,ul,ol,li')
        && [...editor.querySelectorAll('div')].some(answerParagraphPlaceholder)) {
      plain = answerParagraphText(editor);
    }
    return plain
      .replace(/\u00a0/gu, ' ')
      .replace(/\r\n?/gu, '\n');
  }

  function sanitizeAnswerMarkup(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI']);
    const clean = (parent) => {
      for (const child of [...parent.childNodes]) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        clean(child);
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
      }
    };
    clean(template.content);
    return template.innerHTML;
  }

  function placeCaretAtEnd(node) {
    const selection = global.getSelection?.();
    if (!selection || !node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function captureAnswerFromEditor() {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    if (!refs?.editor || !question) return;
    let plain = answerPlainText(refs.editor);
    if (plain.length > MAX_ANSWER_CHARACTERS) {
      plain = plain.slice(0, MAX_ANSWER_CHARACTERS);
      refs.editor.innerText = plain;
      placeCaretAtEnd(refs.editor);
    }
    state.answers.set(question.id, plain);
    state.answerMarkup.set(question.id, sanitizeAnswerMarkup(refs.editor.innerHTML));
    syncExamCompletion();
    scheduleForecastDraftSave();
  }

  function selectedAnswerLength(editor) {
    const selection = global.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return 0;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return 0;
    // Range.toString omits structural newlines. Use the same ordinary-paragraph
    // units for a detached selection so valid replacement paste is not cut short.
    // The live range, DOM, caret and native P/list editing are left unchanged.
    const fragment = range.cloneContents?.();
    if (fragment && !fragment.querySelector('p,ul,ol,li')) {
      return answerParagraphText(fragment).replace(/\r\n?/gu, '\n').length;
    }
    // A single native P/list selection includes its rendered separators;
    // Range.toString drops them and would truncate a valid replacement paste.
    // Never combine multiple ranges (which could include another surface).
    if (selection.rangeCount === 1 && fragment?.querySelector('p,ul,ol,li')) {
      return selection.toString().replace(/\r\n?/gu, '\n').length;
    }
    return range.toString().length;
  }

  function insertPlainAnswerText(editor, value) {
    const selectedLength = selectedAnswerLength(editor);
    const available = Math.max(
      0,
      MAX_ANSWER_CHARACTERS - (answerPlainText(editor).length - selectedLength),
    );
    const text = String(value || '').slice(0, available);
    if (text) document.execCommand('insertText', false, text);
    captureAnswerFromEditor();
  }

  function sanitizeEditorDom(editor) {
    if (!editor) return;
    const clean = sanitizeAnswerMarkup(editor.innerHTML);
    if (editor.innerHTML !== clean) editor.innerHTML = clean;
    captureAnswerFromEditor();
  }

  function runAnswerCommand(command) {
    const editor = state.examRefs?.editor;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    document.execCommand(command, false, null);
    captureAnswerFromEditor();
    syncEditorToolbarState();
  }

  function answerCommandButton(label, command, shortcut = '') {
    const button = makeButton(label, 'bf26-editor-button');
    button.dataset.answerCommand = command;
    button.setAttribute('aria-label', shortcut ? `${label} (${shortcut})` : label);
    if (['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].includes(command)) {
      button.setAttribute('aria-pressed', 'false');
    }
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => runAnswerCommand(command));
    return button;
  }

  function syncEditorToolbarState() {
    const refs = state.examRefs;
    if (!refs?.editor) return;
    for (const button of refs.commandButtons || []) {
      if (!button.hasAttribute('aria-pressed')) continue;
      let pressed = false;
      try {
        pressed = Boolean(document.queryCommandState(button.dataset.answerCommand));
      } catch (_error) {
        pressed = false;
      }
      button.setAttribute('aria-pressed', String(pressed));
    }
  }

  function textOffsetWithin(root, node, offset) {
    if (!root || !node || (!root.contains(node) && root !== node)) return -1;
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(node, offset);
      return range.toString().length;
    } catch (_error) {
      return -1;
    }
  }

  function capturePromptSelection() {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    const selection = global.getSelection?.();
    if (!refs?.prompt || !question || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!refs.prompt.contains(range.startContainer) || !refs.prompt.contains(range.endContainer)) return;
    const first = textOffsetWithin(refs.prompt, range.startContainer, range.startOffset);
    const second = textOffsetWithin(refs.prompt, range.endContainer, range.endOffset);
    const start = Math.min(first, second);
    const end = Math.max(first, second);
    if (start < 0 || end <= start) return;
    state.lastPromptSelection = Object.freeze({ questionId: question.id, start, end });
  }

  function withoutHighlightOverlap(ranges, start, end) {
    const next = [];
    for (const range of ranges) {
      if (range.end <= start || range.start >= end) {
        next.push(range);
        continue;
      }
      if (range.start < start) next.push({ ...range, end: start });
      if (range.end > end) next.push({ ...range, start: end });
    }
    return next;
  }

  function renderPromptHighlights() {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    if (!refs?.prompt || !question) return;
    const text = question.prompt;
    const ranges = [...(state.questionHighlights.get(question.id) || [])]
      .filter((range) => range.start >= 0 && range.end > range.start && range.end <= text.length)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) fragment.append(document.createTextNode(text.slice(cursor, range.start)));
      const mark = element('mark', 'bf26-question-highlight', text.slice(range.start, range.end));
      mark.dataset.color = range.color;
      fragment.append(mark);
      cursor = range.end;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    refs.prompt.replaceChildren(fragment);
  }

  function applyPromptHighlight(color = '') {
    const question = state.questions[state.currentIndex];
    const selected = state.lastPromptSelection;
    if (!question || !selected || selected.questionId !== question.id) {
      setStatus('Select words in the question first, then choose a highlight color or Erase.', 'error');
      return;
    }
    let ranges = withoutHighlightOverlap(
      state.questionHighlights.get(question.id) || [],
      selected.start,
      selected.end,
    );
    if (color) ranges.push(Object.freeze({ start: selected.start, end: selected.end, color }));
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    state.questionHighlights.set(question.id, Object.freeze(ranges));
    state.lastPromptSelection = null;
    global.getSelection?.()?.removeAllRanges();
    renderPromptHighlights();
    setStatus(color ? 'Question highlight saved.' : 'Selected question highlight removed.', 'success');
  }

  function questionMatchesFilter(question) {
    if (state.questionFilter === 'flagged') return state.flaggedQuestions.has(question.id);
    if (state.questionFilter === 'needs-answer') {
      return wordCount(state.answers.get(question.id)) < MINIMUM_WORDS;
    }
    if (state.questionFilter === 'complete') {
      return wordCount(state.answers.get(question.id)) >= MINIMUM_WORDS;
    }
    return true;
  }

  function adjacentQuestionIndex(direction) {
    for (
      let index = state.currentIndex + direction;
      index >= 0 && index < state.questions.length;
      index += direction
    ) {
      if (questionMatchesFilter(state.questions[index])) return index;
    }
    return -1;
  }

  function subjectSchedule(subjectName = state.subject) {
    return SUBJECTS.find((subject) => subject.name === subjectName) || null;
  }

  function ensureRoot() {
    if (state.root?.isConnected) return state.root;

    const root = element('div', 'bf26-root');
    root.id = 'bf26-root';
    root.hidden = true;
    root.dataset.barForecastRoot = '';
    root.innerHTML = `
      <section class="bf26-page" aria-labelledby="bf26-page-title" tabindex="-1">
        <header class="bf26-dialog-header">
          <div class="bf26-brand">
            <p class="bf26-eyebrow">Member access</p>
            <h1 class="bf26-dialog-title" id="bf26-page-title">2026 Bar Forecast</h1>
          </div>
          <button class="bf26-close" type="button" aria-label="Exit 2026 Bar Forecast">Exit forecast</button>
        </header>
        <main class="bf26-view" data-bf26-view aria-labelledby="bf26-page-title"></main>
      </section>`;

    document.body.append(root);
    state.root = root;
    state.page = root.querySelector('.bf26-page');
    state.viewNode = root.querySelector('[data-bf26-view]');
    state.closeButton = root.querySelector('.bf26-close');
    state.closeButton?.addEventListener('click', () => closeForecast());
    root.addEventListener('keydown', handlePageKeyboard);
    return root;
  }

  function handlePageKeyboard(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeForecast();
      return;
    }
  }

  function isolatePage(enabled) {
    if (enabled) {
      state.isolation = [...document.body.children]
        .filter((node) => node !== state.root)
        .map((node) => ({
          node,
          owned: !node.inert || node.dataset.ddModalInert === 'true',
        }));
      for (const entry of state.isolation) {
        if (!entry.owned) continue;
        entry.node.inert = true;
        entry.node.dataset.bf26PageInert = 'true';
      }
      state.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('bf26-page-open');
      global.syncModalIsolation?.();
      return;
    }
    for (const entry of state.isolation) {
      if (!entry.owned) continue;
      entry.node.inert = false;
      delete entry.node.dataset.bf26PageInert;
    }
    state.isolation = [];
    document.body.style.overflow = state.previousOverflow;
    document.body.classList.remove('bf26-page-open');
    global.syncModalIsolation?.();
  }

  function setForecastRoute() {
    state.routeRecovery = false;
    if (location.hash === ROUTE) {
      state.returnHash = '#quorum';
      state.routeWasPushed = false;
      return;
    }
    state.returnHash = location.hash || '#quorum';
    state.routeWasPushed = true;
    history.pushState({ dueDiligenceBarForecast: true }, '', ROUTE);
  }

  function restoreForecastRoute() {
    if (location.hash !== ROUTE) return;
    if (state.routeWasPushed) {
      state.routeWasPushed = false;
      history.back();
      return;
    }
    const destination = state.returnHash && state.returnHash !== ROUTE
      ? state.returnHash
      : '#quorum';
    history.replaceState({}, '', `${location.pathname}${location.search}${destination}`);
    global.dispatchEvent(new Event('popstate'));
  }

  function resetProtectedState() {
    state.pdfNoteController?.abort(); state.pdfNoteController = null;
    state.pdfController?.abort(); state.pdfController = null;
    stopForecastPolling();
    if (state.draftTimer !== null) global.clearTimeout(state.draftTimer);
    state.draftTimer = null;
    state.workspaceGeneration = (state.workspaceGeneration || 0) + 1;
    stopSubmittingProgress();
    state.ownerId = '';
    state.authorizationOwnerId = '';
    state.authorizationErrorOwnerId = '';
    state.consentAccepted = false;
    state.subject = '';
    state.schedule = null;
    state.setId = '';
    state.questions = [];
    state.answers = new Map();
    state.answerMarkup = new Map();
    state.flaggedQuestions = new Set();
    state.questionHighlights = new Map();
    state.questionFilter = 'all';
    state.lastPromptSelection = null;
    state.currentIndex = 0;
    state.results = null;
    state.examRefs = null;
    state.clientAttemptId = '';
    state.acceptedAttempt = null;
    state.submissionSnapshot = null;
    state.historyItems = [];
    state.historyCursor = null;
    state.historyAnalytics = null;
    state.historySubject = '';
    state.historyCompleteOnly = false;
    state.historyFrom = '';
    state.historyTo = '';
  }

  function abortRequest() {
    state.pdfNoteController?.abort(); state.pdfNoteController = null;
    state.requestController?.abort();
    state.requestController = null;
    state.pdfController?.abort(); state.pdfController = null;
  }

  function abortAuthorization() {
    state.authorizationController?.abort();
    state.authorizationController = null;
  }

  function beginAuthorizationDeadline() {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutReject;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutReject = reject;
    });
    const timeoutId = global.setTimeout(() => {
      timedOut = true;
      const error = new Error(
        'Forecast access verification took too long. Your protected Forecast content remains closed. Please try again.',
      );
      error.code = 'BAR_FORECAST_ACCESS_TIMEOUT';
      error.status = 504;
      timeoutReject(error);
      controller.abort();
    }, FORECAST_ACCESS_TIMEOUT_MS);
    state.authorizationController = controller;
    return Object.freeze({
      controller,
      signal: controller.signal,
      timeoutPromise,
      timedOut: () => timedOut,
      clear: () => {
        global.clearTimeout(timeoutId);
        if (state.authorizationController === controller) state.authorizationController = null;
      },
    });
  }

  function beginRequest() {
    abortRequest();
    state.requestController = new AbortController();
    return state.requestController;
  }

  async function requestForecast(body, options = {}) {
    const client = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (typeof client?.request !== 'function') {
      const error = new Error('Bar Forecast access could not be checked yet.');
      error.code = 'AUTH_UNRESOLVED';
      throw error;
    }
    const controller = options.signal ? null : beginRequest();
    let deadline;
    let rejectAborted;
    try {
      const pending = client.request(ENDPOINT, {
        body,
        signal: options.signal || controller?.signal,
        recoverAccess: false,
      });
      // Entry keeps its dedicated controller/12-second guard. Saved-work requests
      // have a separate finite transport deadline; timeout never means not accepted.
      const payload = controller ? await Promise.race([pending, new Promise((_, reject) => {
        rejectAborted = () => { const error = new Error('This Forecast request was cancelled.'); error.name = 'AbortError'; reject(error); };
        controller.signal.addEventListener('abort', rejectAborted, { once: true });
      }), new Promise((_, reject) => {
        deadline = global.setTimeout(() => {
          const error = new Error('The saved Forecast request took too long. You can safely retry.');
          error.code = 'BAR_FORECAST_REQUEST_TIMEOUT';
          reject(error); controller.abort();
        }, FORECAST_REQUEST_TIMEOUT_MS);
      })]) : await pending;
      if (controller && (state.requestController !== controller || controller.signal.aborted)) {
        const error = new Error('This Forecast request is no longer current.'); error.name = 'AbortError'; throw error;
      }
      return payload;
    } finally {
      if (deadline !== undefined) global.clearTimeout(deadline);
      if (rejectAborted) controller?.signal.removeEventListener('abort', rejectAborted);
      if (controller && state.requestController === controller) state.requestController = null;
    }
  }

  function replaceView(node, viewName) {
    if (viewName !== 'submitting') stopSubmittingProgress();
    state.view = viewName;
    if (state.closeButton) {
      state.closeButton.disabled = false;
      state.closeButton.textContent = 'Exit forecast';
      state.closeButton.setAttribute('aria-label', 'Exit 2026 Bar Forecast');
    }
    state.examRefs = null;
    state.viewNode.replaceChildren(node);
    state.statusNode = node.querySelector?.('[data-bf26-status]') || null;
    state.viewNode.scrollTop = 0;
    state.viewNode.scrollLeft = 0;
    requestAnimationFrame(() => {
      if (!state.isOpen || state.view !== viewName) return;
      const heading = node.querySelector?.('h2');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
  }

  function stopSubmittingProgress() {
    if (state.submissionTimer !== null) global.clearInterval(state.submissionTimer);
    state.submissionTimer = null;
    state.submissionStartedAt = 0;
    state.submissionElapsedNode = null;
  }

  function setStatus(message = '', kind = '') {
    if (!state.statusNode) return;
    state.statusNode.textContent = message;
    if (kind) state.statusNode.dataset.kind = kind;
    else delete state.statusNode.dataset.kind;
  }

  function renderAccessProgress(message = 'Confirming your Forecast access…') {
    resetProtectedState();
    const centered = element('div', 'bf26-centered');
    const copy = element('section', 'bf26-copy');
    copy.append(
      element('p', 'bf26-badge', '2026 Bar Forecast'),
      element('h2', '', 'Opening your forecast…'),
      element(
        'p',
        '',
        'We are checking this signed-in account securely. Eligible members continue automatically.',
      ),
    );
    const spinner = element('div', 'bf26-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    const status = element('p', 'bf26-status', message);
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    copy.append(spinner, status);
    centered.append(copy);
    replaceView(centered, 'access');
  }

  function renderAccessError(message = 'Bar Forecast could not be opened just now. Please try again.') {
    resetProtectedState();
    const centered = element('div', 'bf26-centered');
    const copy = element('section', 'bf26-copy');
    copy.append(
      element('p', 'bf26-badge', '2026 Bar Forecast'),
      element('h2', '', 'We could not open Forecast yet.'),
      element('p', '', 'Your protected Forecast content remains closed. You can retry without losing account access.'),
    );
    const actions = element('div', 'bf26-actions');
    const retry = makeButton('Try again', 'bf26-button bf26-button--primary');
    retry.addEventListener('click', () => checkAuthorization());
    const home = makeButton('Return to Home');
    home.addEventListener('click', () => closeForecast({ force: true }));
    actions.append(retry, home);
    const status = element('p', 'bf26-status', message);
    status.dataset.bf26Status = '';
    status.dataset.kind = 'error';
    status.setAttribute('role', 'alert');
    copy.append(actions, status);
    centered.append(copy);
    replaceView(centered, 'access-error');
  }

  function isForecastAccessRequired(error) {
    return Number(error?.status) === 403
      && String(error?.code || '').trim().toUpperCase() === 'BAR_FORECAST_ACCESS_REQUIRED';
  }

  function isForecastAuthenticationRequired(error) {
    return Number(error?.status) === 401
      || ['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(
        String(error?.code || '').trim().toUpperCase(),
      );
  }

  function openForecastSignIn() {
    const client = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    client?.openSignIn?.({
      allowDismiss: true,
      routeBound: true,
      returnHash: ROUTE,
      title: 'Continue to 2026 Bar Forecast',
      copy: 'Use Google to continue. Eligible paid, Founding Beta, and administrator accounts open Forecast automatically.',
    });
    return true;
  }

  function routeToPlansAndPricing() {
    if (state.pricingRedirectInProgress) return true;
    state.pricingRedirectInProgress = true;
    const client = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    const backgroundHash = state.returnHash && state.returnHash !== ROUTE
      ? state.returnHash
      : '#quorum';
    const focusOrigin = state.lastTrigger?.isConnected ? state.lastTrigger : null;
    closeForecast({ force: true, restoreRoute: false });
    if (typeof client?.openUnlimitedFeatureGate === 'function') {
      client.openUnlimitedFeatureGate(ROUTE, {
        featureId: 'bar-forecast',
        backgroundHash,
        focusOrigin,
      });
    } else if (typeof client?.openView === 'function') {
      history.replaceState({}, '', `${location.pathname}${location.search}${backgroundHash}`);
      client.openView('pricing', {
        mode: 'action',
        focusOrigin,
        context: {
          reason: 'unlimited_feature',
          featureId: 'bar-forecast',
          featureLabel: '2026 Bar Forecast',
          targetHash: ROUTE,
          backgroundHash,
        },
      });
    } else {
      history.replaceState({ dd2View: 'pricing' }, '', `${location.pathname}${location.search}#pricing`);
      global.dispatchEvent(new Event('popstate'));
    }
    return true;
  }

  function handleForecastAccessInterruption(error) {
    if (isForecastAccessRequired(error)) return routeToPlansAndPricing();
    if (isForecastAuthenticationRequired(error)) {
      closeForecast({ force: true, restoreRoute: false });
      return openForecastSignIn();
    }
    if (String(error?.code || '').trim().toUpperCase() === 'BAR_FORECAST_SETUP_REQUIRED') {
      closeForecast({ force: true, restoreRoute: false });
      Promise.resolve(global.DueDiligencePhase4?.ensureRequiredSetup?.(ROUTE)).catch(() => {
        global.toast?.('Complete the required account setup before opening Bar Forecast.', 'warn');
      });
      return true;
    }
    return false;
  }

  function renderDisclaimer(message = '') {
    const centered = element('div', 'bf26-centered');
    centered.classList.add('bf26-agreement');
    const copy = element('section', 'bf26-copy');
    copy.append(
      element('p', 'bf26-badge', 'Required before starting'),
      element('h2', '', 'Notice & Disclaimer'),
      element(
        'p',
        '',
        'This pilot program is designed to train issue-spotting skills using question sets aligned with historical exam patterns, cases associated with the 2026 Bar Chairperson, and independent legal research.',
      ),
    );

    const disclosure = element('div', 'bf26-disclaimer');
    disclosure.append(element(
      'p',
      'bf26-disclaimer-lead',
      'By proceeding, you acknowledge and agree to the following:',
    ));
    const list = element('ul');
    for (const [label, text] of [
      ['Not Official Material', 'All forecast questions and study content are independently created. They are not official Supreme Court questions, leaks, or confidential materials.'],
      ['No Warranties or Guarantees', 'Topic predictions are instructional aids, not an exact science. Predicted topics do not guarantee or promise appearance in the 2026 Bar Examinations.'],
      ['Educational Use Only', 'Suggested answers, feedback, and scoring may contain errors and do not constitute legal advice.'],
      ['Authoritative Sources', 'Official Supreme Court Bar bulletins, syllabi, statutes, rules, and controlling jurisprudence remain the sole authoritative references.'],
    ]) {
      const item = element('li');
      item.append(element('strong', '', `${label}:`), document.createTextNode(` ${text}`));
      list.append(item);
    }
    disclosure.append(list);

    const actions = element('div', 'bf26-actions');
    const decline = makeButton('Decline');
    decline.addEventListener('click', () => closeForecast());
    const accept = makeButton('I Understand & Agree', 'bf26-button bf26-button--primary');
    accept.setAttribute('aria-busy', 'false');
    accept.addEventListener('click', async () => {
      if (accept.disabled) return;
      accept.disabled = true;
      accept.setAttribute('aria-busy', 'true');
      decline.disabled = true;
      accept.textContent = 'Saving acceptance…';
      setStatus('Saving this disclosure acceptance…');
      const ownerId = runtimeOwnerId();
      try {
        const payload = await requestForecast({ operation: 'accept', version: CONSENT_VERSION });
        if (!state.isOpen || ownerId !== runtimeOwnerId()) return;
        if (payload?.authorized !== true || payload?.consentAccepted !== true) {
          renderAccessError('Bar Forecast access could not be confirmed.');
          return;
        }
        state.ownerId = ownerId;
        state.consentAccepted = true;
        renderSubjectPicker('', true);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!state.isOpen || ownerId !== runtimeOwnerId()) return;
        if (handleForecastAccessInterruption(error)) return;
        decline.disabled = false;
        accept.disabled = false;
        accept.setAttribute('aria-busy', 'false');
        accept.textContent = 'I Understand & Agree';
        setStatus(error?.message || 'The disclaimer could not be accepted. Please try again.', 'error');
      }
    });
    actions.append(decline, accept);

    const status = element('p', 'bf26-status', message);
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    copy.append(disclosure, actions, status);
    centered.append(copy);
    replaceView(centered, 'consent');
  }

  function openForecastAttemptLink() {
    if (!state.isOpen || !state.consentAccepted || !state.ownerId || state.ownerId !== runtimeOwnerId()
        || location.hash !== ROUTE || !location.search) return false;
    const attempts = new URLSearchParams(location.search).getAll('forecastAttempt');
    if (!attempts.length) return false;
    if (attempts.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(attempts[0])) {
      renderSubjectPicker('This saved-report link is invalid. Open Saved attempts to find your report.');
      return true;
    }
    // The URL is only an opaque locator, never authorization. The existing
    // owner-gated request and generation fencing control every saved report.
    openSavedForecast(attempts[0].toLowerCase());
    return true;
  }

  function renderSubjectPicker(message = '', openLinkedAttempt = false) {
    if (openLinkedAttempt && openForecastAttemptLink()) return;
    const picker = element('section', 'bf26-picker');
    picker.append(forecastTabs('new'));
    picker.append(
      element('p', 'bf26-badge', 'Forecast access confirmed'),
      element('h2', '', 'Choose a 2026 Bar subject.'),
      element(
        'p',
        '',
        'Each subject opens an independent twenty-question forecast simulation. Questions are delivered securely only after the server confirms paid, Founding Beta, or administrator access.',
      ),
      element(
        'div',
        'bf26-anytime',
        'The official examination date and session are shown for orientation. Forecast simulations may be taken anytime during this pilot.',
      ),
    );

    const grid = element('div', 'bf26-subject-grid');
    const drafts = Object.values(readForecastDrafts()).filter((draft) => draft.ownerId === state.ownerId && SUBJECT_NAMES.has(draft.subject));
    if (drafts.length) {
      const saved = element('section', 'bf26-local-drafts');
      saved.append(element('h3', '', 'Continue on this device'));
      for (const draft of drafts.sort((a, b) => b.savedAt - a.savedAt)) {
        const button = makeButton(`${draft.subject} · ${draft.attemptId ? 'Saved submission' : draft.submission ? 'Check submission' : 'Draft'}`);
        button.addEventListener('click', () => restoreForecastDraft(draft.clientAttemptId));
        saved.append(button);
      }
      picker.append(saved);
    }
    for (const subject of SUBJECTS) {
      const card = element('article', 'bf26-subject-card');
      card.append(
        element('h3', '', subject.name),
        element('p', 'bf26-schedule', `${subject.date} · ${subject.time} · 20 questions`),
      );
      const start = makeButton('Start forecast', 'bf26-button bf26-button--primary');
      start.dataset.subject = subject.name;
      start.addEventListener('click', () => startSubject(subject.name, start));
      card.append(start);
      grid.append(card);
    }

    const status = element('p', 'bf26-status', message);
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'bf26-actions');
    const close = makeButton('Close forecast');
    close.addEventListener('click', () => closeForecast());
    actions.append(close);
    picker.append(grid, status, actions);
    replaceView(picker, 'picker');
  }

  function normalizeQuestions(payload, selectedSubject) {
    if (payload?.subject !== selectedSubject || !SUBJECT_NAMES.has(payload?.subject)) {
      throw new Error('The forecast subject response did not match your selection.');
    }
    if (payload?.sourceVersion !== SOURCE_VERSION || payload?.contentType !== CONTENT_TYPE) {
      throw new Error('The forecast source identity failed verification. No examination was opened.');
    }
    if (!Array.isArray(payload.questions) || payload.questions.length !== REQUIRED_QUESTION_COUNT) {
      throw new Error('The forecast must contain exactly 20 questions. No partial simulation was opened.');
    }

    const ids = new Set();
    const numbers = new Set();
    const questions = payload.questions.map((question) => {
      const id = String(question?.id || '').trim();
      const number = Number(question?.number);
      const prompt = String(question?.prompt || '').trim();
      const syntheticQaContent = SYNTHETIC_QA_PATTERN.test(id) || SYNTHETIC_QA_PATTERN.test(prompt);
      if (!id || ids.has(id) || !Number.isInteger(number)
          || number < 1 || number > REQUIRED_QUESTION_COUNT || numbers.has(number) || !prompt
          || syntheticQaContent) {
        throw new Error('The forecast question set failed its integrity check.');
      }
      ids.add(id);
      numbers.add(number);
      return Object.freeze({ id, number, prompt });
    }).sort((left, right) => left.number - right.number);

    for (let number = 1; number <= REQUIRED_QUESTION_COUNT; number += 1) {
      if (!numbers.has(number)) throw new Error('The forecast question set is incomplete.');
    }
    return Object.freeze(questions);
  }

  async function startSubject(subjectName, trigger) {
    if (!SUBJECT_NAMES.has(subjectName) || !state.consentAccepted) return;
    const ownerId = runtimeOwnerId();
    const generation = state.workspaceGeneration;
    if (!ownerId || ownerId !== state.ownerId) {
      closeForecast({ force: true, restoreRoute: false });
      openForecastSignIn();
      return;
    }
    const buttons = [...state.viewNode.querySelectorAll('[data-subject]')];
    for (const button of buttons) button.disabled = true;
    trigger.textContent = 'Opening 20 questions…';
    setStatus(`Opening ${subjectName}…`);
    try {
      const payload = await requestForecast({ operation: 'start', subject: subjectName });
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      const setId = String(payload?.setId || '').trim().toLowerCase();
      if (!/^sha256:[0-9a-f]{64}$/u.test(setId)) {
        throw new Error('The forecast question-set identity failed verification.');
      }
      state.questions = normalizeQuestions(payload, subjectName);
      state.subject = subjectName;
      state.schedule = payload.schedule || null;
      state.setId = setId;
      state.clientAttemptId = newClientAttemptId();
      state.acceptedAttempt = null;
      state.submissionSnapshot = null;
      state.answers = new Map(state.questions.map((question) => [question.id, '']));
      state.answerMarkup = new Map();
      state.flaggedQuestions = new Set();
      state.questionHighlights = new Map();
      state.questionFilter = 'all';
      state.lastPromptSelection = null;
      state.currentIndex = 0;
      state.results = null;
      persistForecastDraft();
      renderExam();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      if (handleForecastAccessInterruption(error)) return;
      renderSubjectPicker(error?.message || 'The forecast could not be opened. Please try again.');
      setStatus(state.statusNode?.textContent || '', 'error');
    }
  }

  function allAnswersComplete() {
    return state.questions.length === REQUIRED_QUESTION_COUNT
      && state.questions.every((question) => wordCount(state.answers.get(question.id)) >= MINIMUM_WORDS);
  }

  function freezeSubmission(snapshot) {
    return Object.freeze({ operation: 'submit_attempt', subject: snapshot.subject, setId: snapshot.setId,
      clientAttemptId: snapshot.clientAttemptId,
      answers: Object.freeze(snapshot.answers.map((row) => Object.freeze({ questionId: row.questionId, answer: row.answer }))),
    });
  }

  function restoreForecastDraft(clientAttemptId) {
    const draft = readForecastDrafts()[clientAttemptId];
    if (!draft || draft.ownerId !== state.ownerId || runtimeOwnerId() !== state.ownerId) return;
    if (draft.attemptId) { openSavedForecast(draft.attemptId); return; }
    try {
      state.questions = normalizeQuestions({ subject: draft.subject, sourceVersion: SOURCE_VERSION,
        contentType: CONTENT_TYPE, questions: draft.questions }, draft.subject);
      if (!SUBJECT_NAMES.has(draft.subject) || !/^sha256:[0-9a-f]{64}$/u.test(draft.setId)
          || !/^[0-9a-f-]{36}$/u.test(draft.clientAttemptId) || !Array.isArray(draft.answers)) throw new Error('The saved draft is incomplete.');
      state.subject = draft.subject; state.schedule = subjectSchedule(draft.subject); state.setId = draft.setId;
      state.clientAttemptId = draft.clientAttemptId; state.acceptedAttempt = null; state.results = null;
      state.answers = new Map(draft.answers.filter((row) => Array.isArray(row) && typeof row[1] === 'string'));
      state.answerMarkup = new Map(Array.isArray(draft.markup) ? draft.markup : []);
      state.flaggedQuestions = new Set(Array.isArray(draft.flags) ? draft.flags : []);
      state.questionHighlights = new Map(Array.isArray(draft.highlights) ? draft.highlights : []);
      state.currentIndex = Math.max(0, Math.min(19, Number(draft.currentIndex) || 0));
      state.submissionSnapshot = draft.submission ? freezeSubmission(draft.submission) : null;
      if (state.submissionSnapshot) renderSubmissionUnconfirmed();
      else renderExam();
    } catch (error) { setStatus(error.message || 'This saved draft could not be restored.', 'error'); }
  }

  function normalizedSavedAttempt(attempt) {
    if (!attempt || !/^[0-9a-f-]{36}$/u.test(attempt.id) || !/^[0-9a-f-]{36}$/u.test(attempt.clientAttemptId) || !SUBJECT_NAMES.has(attempt.subject)
        || !/^sha256:[0-9a-f]{64}$/u.test(attempt.setId) || attempt.questionCount !== 20
        || !['pending', 'processing', 'retryable_failed', 'failed', 'complete'].includes(attempt.status)
        || !Array.isArray(attempt.questions) || attempt.questions.length !== 20
        || !Array.isArray(attempt.answers) || attempt.answers.length !== 20) {
      throw new Error('The saved Forecast response is incomplete. Your stored answers have not been changed.');
    }
    const questions = [...attempt.questions].sort((a, b) => a.number - b.number);
    const answers = new Map(attempt.answers.map((row) => [row.questionId, row.answer]));
    if (new Set(questions.map((row) => row.id)).size !== 20 || answers.size !== 20
        || questions.some((row, index) => !row.id || row.number !== index + 1 || typeof row.prompt !== 'string'
          || !row.prompt.trim() || typeof answers.get(row.id) !== 'string')) {
      throw new Error('The saved questions and answers do not match.');
    }
    return Object.freeze({ ...attempt, questions: Object.freeze(questions.map((row) => Object.freeze({ ...row }))),
      answers: Object.freeze(attempt.answers.map((row) => Object.freeze({ ...row }))) });
  }

  function adoptSavedAttempt(value, expectedId = null) {
    const attempt = normalizedSavedAttempt(value);
    if (expectedId && attempt.id !== expectedId) throw new Error('The saved attempt identity did not match your selection.');
    if (state.acceptedAttempt?.id === attempt.id) {
      if (state.acceptedAttempt.status === 'complete' && attempt.status !== 'complete') return state.acceptedAttempt;
      if (Date.parse(attempt.updatedAt) < Date.parse(state.acceptedAttempt.updatedAt)) return state.acceptedAttempt;
    }
    const answers = new Map(attempt.answers.map((row) => [row.questionId, row.answer]));
    let verifiedResults = null;
    if (attempt.status === 'complete') {
      const report = attempt.result;
      if (report?.complete !== true || report?.attemptId !== attempt.id || report.ownerId !== state.ownerId
          || report.questionCount !== 20 || report.completedQuestionCount !== 20
          || report.subject !== attempt.subject || report.setId !== attempt.setId) {
        throw new Error('The completed saved report did not pass its identity check.');
      }
      verifiedResults = normalizeResults(report, { questions: attempt.questions, answers });
    }
    state.acceptedAttempt = attempt;
    state.clientAttemptId = attempt.clientAttemptId;
    state.subject = attempt.subject; state.setId = attempt.setId; state.schedule = subjectSchedule(attempt.subject);
    state.questions = attempt.questions;
    state.answers = answers;
    // Saved reports always display canonical server answer text, never another draft's markup.
    state.answerMarkup = new Map(); state.flaggedQuestions = new Set(); state.questionHighlights = new Map();
    state.submissionSnapshot = freezeSubmission({ ...attempt, answers: attempt.answers });
    if (attempt.status === 'complete') {
      state.results = verifiedResults;
      removeCompletedLocalDraft(attempt.clientAttemptId);
    } else {
      state.results = null;
      persistForecastDraft();
    }
    return attempt;
  }

  function renderSubmissionUnconfirmed(message = '') {
    const panel = element('section', 'bf26-picker');
    panel.append(forecastTabs('history'), element('h2', '', 'Submission not yet confirmed.'),
      element('p', '', message || 'Your answers are retained on this device. Retrying uses the same submission ID and cannot create a second attempt.'),
      element('p', '', 'Check Saved attempts on any signed-in device if the server already accepted it.'));
    const retry = makeButton('Retry saved submission', 'bf26-button bf26-button--primary');
    retry.addEventListener('click', () => sendForecastSubmission()); panel.append(retry);
    replaceView(panel, 'unconfirmed');
  }

  function renderSavedForecastStatus(message = '', allowPolling = true) {
    const attempt = state.acceptedAttempt;
    if (!attempt) return;
    if (attempt.status === 'complete') { renderResults(); return; }
    if (allowPolling && ['pending', 'processing', 'retryable_failed'].includes(attempt.status)) {
      renderSubmitting(); return;
    }
    const panel = element('section', 'bf26-picker');
    panel.append(forecastTabs('history'), element('h2', '', attempt.status === 'failed' ? 'Assessment needs attention.' : 'Your answers are saved.'),
      element('p', '', message || 'The report is not complete. No final score is available yet.'),
      element('p', '', 'You can close this page and return to Saved attempts.'));
    const check = makeButton('Check progress', 'bf26-button bf26-button--primary');
    check.addEventListener('click', () => openSavedForecast(attempt.id)); panel.append(check);
    if (attempt.status === 'failed' && attempt.retryAllowed === true) {
      const retry = makeButton('Retry assessment');
      retry.addEventListener('click', () => retrySavedForecast(attempt.id)); panel.append(retry);
    }
    replaceView(panel, 'saved-status');
  }

  function forecastReadRetryDelay(error) {
    if (error?.status !== 429 && error?.code !== 'RATE_LIMITED') return null;
    const delays = [error.retryAfterMs, Number.isSafeInteger(error.retryAfterSeconds) ? error.retryAfterSeconds * 1000 : null]
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    return delays.length ? Math.max(1000, ...delays) : 60000;
  }

  async function pollSavedForecast(attemptId) {
    stopForecastPolling();
    const pollGeneration = state.pollGeneration;
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    const current = () => forecastRequestIsCurrent(ownerId, generation) && state.pollGeneration === pollGeneration
      && state.acceptedAttempt?.id === attemptId && state.view === 'submitting';
    const deadline = Date.now() + FORECAST_POLL_WINDOW_MS;
    let nextDelay = FORECAST_POLL_INTERVAL_MS;
    for (let count = 0; count < FORECAST_POLL_LIMIT; count++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      let finishDelay;
      await new Promise((resolve) => {
        finishDelay = resolve;
        state.pollResolve = finishDelay;
        state.pollTimer = global.setTimeout(finishDelay, Math.min(nextDelay, remaining));
      });
      if (state.pollResolve === finishDelay) { state.pollTimer = null; state.pollResolve = null; }
      if (!current()) return;
      if (Date.now() >= deadline) break;
      try {
        const payload = await requestForecast({ operation: 'attempt', attemptId });
        if (!current()) return;
        nextDelay = FORECAST_POLL_INTERVAL_MS;
        const attempt = adoptSavedAttempt(payload?.attempt, attemptId);
        if (attempt.status === 'complete' || attempt.status === 'failed') {
          stopForecastPolling(); renderSavedForecastStatus(); return;
        }
        const progress = Number.isInteger(attempt.completedQuestionCount) ? attempt.completedQuestionCount : null;
        setStatus(progress === null ? 'Your saved assessment is still processing.' : `${progress} of 20 answers assessed. No final score until all 20 are complete.`);
      } catch (error) {
        if (!current() || error?.name === 'AbortError') return;
        if (handleForecastAccessInterruption(error)) return;
        const retryDelay = forecastReadRetryDelay(error);
        if (retryDelay !== null) {
          nextDelay = Math.max(FORECAST_POLL_INTERVAL_MS, retryDelay);
          setStatus('Your answers are saved. Progress checking will resume automatically.');
          continue;
        }
        stopForecastPolling(); renderSavedForecastStatus('Progress could not be checked. Your saved work remains available; retry when ready.', false); return;
      }
    }
    if (current()) { stopForecastPolling(); renderSavedForecastStatus('Automatic checking has paused. Assessment can continue on the server; check progress when ready.', false); }
  }

  async function openSavedForecast(attemptId) {
    stopForecastPolling(); abortRequest(); state.workspaceGeneration = (state.workspaceGeneration || 0) + 1;
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    const loading = element('section', 'bf26-picker'); loading.append(forecastTabs('history'), element('h2', '', 'Opening saved attempt…'));
    replaceView(loading, 'saved-loading');
    try {
      const payload = await requestForecast({ operation: 'attempt', attemptId });
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      const attempt = adoptSavedAttempt(payload?.attempt, attemptId);
      renderSavedForecastStatus();
      if (!['complete', 'failed'].includes(attempt.status)) pollSavedForecast(attempt.id);
    } catch (error) {
      if (!forecastRequestIsCurrent(ownerId, generation) || error?.name === 'AbortError') return;
      if (handleForecastAccessInterruption(error)) return;
      const panel = element('section', 'bf26-picker'); panel.append(forecastTabs('history'), element('h2', '', 'Saved attempt unavailable.'), element('p', '', error.message));
      const retry = makeButton('Try again'); retry.addEventListener('click', () => openSavedForecast(attemptId)); panel.append(retry); replaceView(panel, 'saved-error');
    }
  }

  async function retrySavedForecast(attemptId) {
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    stopForecastPolling();
    try {
      const payload = await requestForecast({ operation: 'retry_attempt', attemptId });
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      const attempt = adoptSavedAttempt(payload?.attempt, attemptId); renderSavedForecastStatus();
      if (!['complete', 'failed'].includes(attempt.status)) pollSavedForecast(attempt.id);
    } catch (error) {
      if (!forecastRequestIsCurrent(ownerId, generation) || error?.name === 'AbortError') return;
      if (handleForecastAccessInterruption(error)) return;
      renderSavedForecastStatus(error.message || 'Retry could not be confirmed. Check the saved attempt.', false);
    }
  }

  function forecastDate(value) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }).format(date) : 'Date unavailable';
  }

  function nullableMetric(value, suffix = '') {
    return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—';
  }

  function appendForecastAnalytics(panel, analytics) {
    if (analytics?.completeOnly !== true || !Number.isInteger(analytics.completedAttempts)
        || !Array.isArray(analytics.bySubject)) {
      panel.append(element('p', '', 'Analytics are unavailable. No scores have been estimated.')); return;
    }
    panel.append(element('p', '', 'All completed saved attempts · before pagination. Pending or failed assessments are excluded from scores.'));
    const metrics = element('div', 'bf26-metric-grid');
    metrics.append(metricCard('Completed attempts', String(analytics.completedAttempts)),
      metricCard('Average score', nullableMetric(analytics.averagePercentage, '%')),
      metricCard('Grammar', nullableMetric(analytics.averageGrammarScore, ' / 5')),
      metricCard('Issue spotting', nullableMetric(analytics.averageIssueSpottingScore, ' / 5')));
    panel.append(metrics);
    if (!analytics.completedAttempts) { panel.append(element('p', '', 'Complete an assessment to see your progress.')); return; }
    const bars = element('div', 'bf26-subject-analytics');
    for (const row of analytics.bySubject) {
      if (!SUBJECT_NAMES.has(row.subject)) continue;
      const item = element('div', 'bf26-history-row');
      item.append(element('h3', '', row.subject), element('p', '', `${nullableMetric(row.averagePercentage, '%')} · ${row.completedAttempts} completed`));
      if (typeof row.averagePercentage === 'number' && row.averagePercentage >= 0 && row.averagePercentage <= 100) {
        const meter = element('meter'); meter.min = 0; meter.max = 100; meter.value = row.averagePercentage;
        meter.setAttribute('aria-label', `${row.subject} average score`); item.append(meter);
      }
      bars.append(item);
    }
    panel.append(bars);
    const trend = Array.isArray(analytics.trend) ? analytics.trend.filter((row) => typeof row.percentage === 'number'
      && Number.isFinite(row.percentage) && row.percentage >= 0 && row.percentage <= 100).slice(-12) : [];
    if (trend.length > 1) {
      panel.append(element('h3', '', 'Recent completed attempts'));
      const chart = element('div', 'bf26-score-trend'); chart.setAttribute('aria-label', 'Latest completed Forecast percentages, oldest to newest');
      for (const row of trend) {
        const column = element('div', 'bf26-score-column');
        const bar = element('span', 'bf26-score-bar'); bar.style.height = `${row.percentage}%`; bar.setAttribute('aria-hidden', 'true');
        column.title = `${row.subject} · ${forecastDate(row.completedAt)} · ${row.percentage}%`;
        column.append(bar, element('span', 'bf26-score-value', `${row.percentage}%`));
        column.setAttribute('aria-label', column.title); chart.append(column);
      }
      panel.append(chart, element('p', '', 'Oldest → newest · saved complete scores only.'));
    }
  }

  function renderForecastHistory(tab = 'history', message = '') {
    const panel = element('section', 'bf26-picker'); panel.append(forecastTabs(tab), element('h2', '', tab === 'analytics' ? 'Your Forecast analytics' : 'Saved attempts'));
    const filters = element('div', 'bf26-history-filters');
    const subject = element('select'); subject.setAttribute('aria-label', 'Filter Forecast subject');
    const all = element('option', '', 'All subjects'); all.value = ''; subject.append(all);
    for (const item of SUBJECTS) { const option = element('option', '', item.name); option.value = item.name; subject.append(option); }
    subject.value = state.historySubject;
    subject.addEventListener('change', () => { state.historySubject = subject.value; loadForecastHistory(tab); }); filters.append(subject);
    for (const [field, labelText] of [['historyFrom', 'From'], ['historyTo', 'Through']]) {
      const label = element('label', 'bf26-history-date', labelText);
      const input = element('input'); input.type = 'date'; input.value = state[field];
      input.setAttribute('aria-label', `${labelText} date, Philippine time`);
      input.addEventListener('change', () => { state[field] = input.value; loadForecastHistory(tab); });
      label.append(input); filters.append(label);
    }
    if (tab === 'history') {
      const label = element('label', 'bf26-history-complete'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.historyCompleteOnly;
      checkbox.addEventListener('change', () => { state.historyCompleteOnly = checkbox.checked; loadForecastHistory(tab); });
      label.append(checkbox, document.createTextNode('Completed only')); filters.append(label);
    }
    panel.append(filters);
    if (message) panel.append(element('p', 'bf26-status', message));
    if (tab === 'analytics') appendForecastAnalytics(panel, state.historyAnalytics);
    else {
      if (!state.historyItems.length && !message) panel.append(element('p', '', 'No saved attempts yet. Submit a forecast to save it securely.'));
      for (const attempt of state.historyItems) {
        const row = element('article', 'bf26-history-row');
        const score = attempt.status === 'complete' ? nullableMetric(attempt.summary?.percentage, '%') : 'No final score';
        const label = ({ pending: 'Queued', processing: 'Assessing', retryable_failed: 'Retry scheduled', failed: 'Needs attention', complete: 'Complete' })[attempt.status] || 'Status unavailable';
        row.append(element('h3', '', attempt.subject), element('p', '', `${forecastDate(attempt.acceptedAt)} · ${label} · ${score}`));
        const open = makeButton(attempt.status === 'complete' ? 'Open report' : 'Open saved attempt'); open.addEventListener('click', () => openSavedForecast(attempt.id)); row.append(open); panel.append(row);
      }
      if (state.historyCursor) {
        const more = makeButton('Load more'); more.addEventListener('click', () => loadForecastHistory(tab, true)); panel.append(more);
      }
    }
    const refresh = makeButton('Refresh'); refresh.addEventListener('click', () => loadForecastHistory(tab)); panel.append(refresh);
    replaceView(panel, tab);
  }

  async function loadForecastHistory(tab = 'history', more = false) {
    stopForecastPolling(); abortRequest(); state.workspaceGeneration = (state.workspaceGeneration || 0) + 1;
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    const before = more ? state.historyCursor : null;
    if (!more) { state.historyItems = []; state.historyCursor = null; state.historyAnalytics = null; }
    renderForecastHistory(tab, 'Loading saved attempts…');
    try {
      const from = state.historyFrom ? new Date(`${state.historyFrom}T00:00:00+08:00`).toISOString() : null;
      const to = state.historyTo ? new Date(Date.parse(`${state.historyTo}T00:00:00+08:00`) + 86400000).toISOString() : null;
      if (from && to && from >= to) throw new Error('Choose an end date on or after the start date.');
      const payload = await requestForecast({ operation: 'history', limit: 20,
        ...(before ? { before } : {}), ...(state.historySubject ? { subject: state.historySubject } : {}),
        ...(from ? { from } : {}), ...(to ? { to } : {}),
        completeOnly: tab === 'analytics' || state.historyCompleteOnly });
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      if (!Array.isArray(payload?.attempts)) throw new Error('Saved history is unavailable.');
      state.historyItems = [...new Map([...state.historyItems, ...payload.attempts].map((attempt) => [attempt.id, attempt])).values()];
      state.historyCursor = payload.nextCursor || null; state.historyAnalytics = payload.analytics || null;
      renderForecastHistory(tab);
    } catch (error) {
      if (!forecastRequestIsCurrent(ownerId, generation) || error?.name === 'AbortError') return;
      if (handleForecastAccessInterruption(error)) return;
      renderForecastHistory(tab, error.message || 'History could not be loaded. Your saved attempts remain unchanged.');
    }
  }

  function completedAnswerCount() {
    return state.questions.filter(
      (question) => wordCount(state.answers.get(question.id)) >= MINIMUM_WORDS,
    ).length;
  }

  function renderExam() {
    const exam = element('section', 'bf26-exam');
    const nav = element('aside', 'bf26-exam-nav');
    nav.setAttribute('aria-label', 'Forecast question navigator');
    const navHeader = element('div', 'bf26-nav-header');
    navHeader.append(element('h2', '', 'Questions'));
    const filterLabel = element('label', 'bf26-filter-label', 'Filter');
    const filter = element('select', 'bf26-filter');
    filter.setAttribute('aria-label', 'Filter questions');
    for (const [value, label] of [
      ['all', 'All'],
      ['flagged', 'Flagged'],
      ['needs-answer', 'Needs answer'],
      ['complete', 'Complete'],
    ]) {
      const option = element('option', '', label);
      option.value = value;
      filter.append(option);
    }
    filter.value = state.questionFilter;
    filterLabel.append(filter);
    navHeader.append(filterLabel);
    nav.append(
      navHeader,
      element('p', '', 'Blue marks a complete answer. Gold marks the current question. A flag marks a question for review.'),
    );
    const questionList = element('div', 'bf26-question-list');
    const flagIcons = [];
    const jumpButtons = state.questions.map((question, index) => {
      const jump = makeButton('', 'bf26-question-jump');
      const number = element('span', 'bf26-question-number', String(question.number));
      const flagIcon = element('img', 'bf26-question-flag-icon');
      flagIcon.src = 'assets/icons/navigation/flag.svg';
      flagIcon.alt = '';
      flagIcon.width = 14;
      flagIcon.height = 14;
      flagIcon.hidden = true;
      jump.append(number, flagIcon);
      jump.setAttribute('aria-label', `Go to question ${question.number}`);
      jump.addEventListener('click', () => {
        state.currentIndex = index;
        syncExam(true);
      });
      questionList.append(jump);
      flagIcons.push(flagIcon);
      return jump;
    });
    nav.append(questionList);

    const main = element('div', 'bf26-exam-main');
    const meta = element('header', 'bf26-exam-meta');
    const metaSubject = element('div');
    metaSubject.append(element('strong'), element('span'));
    const metaProgress = element('div');
    metaProgress.append(element('strong'), element('span'));
    meta.append(metaSubject, metaProgress);

    const workspace = element('div', 'bf26-exam-workspace');
    const promptPanel = element('article', 'bf26-prompt-panel');
    const questionLabel = element('p', 'bf26-question-label');
    const promptTools = element('div', 'bf26-prompt-tools');
    promptTools.setAttribute('role', 'toolbar');
    promptTools.setAttribute('aria-label', 'Question review tools');
    const flagQuestion = makeButton('Flag question', 'bf26-tool-button bf26-flag-button');
    flagQuestion.setAttribute('aria-pressed', 'false');
    const highlightLabel = element('span', 'bf26-tool-label', 'Highlight');
    promptTools.append(flagQuestion, highlightLabel);
    const highlightButtons = [];
    for (const color of HIGHLIGHT_COLORS) {
      const button = makeButton(color.label.slice(0, 1), 'bf26-highlight-button');
      button.dataset.color = color.id;
      button.setAttribute('aria-label', `Highlight selected question text ${color.label.toLowerCase()}`);
      button.title = `${color.label} highlighter`;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => applyPromptHighlight(color.id));
      highlightButtons.push(button);
      promptTools.append(button);
    }
    const eraseHighlight = makeButton('Erase', 'bf26-tool-button');
    eraseHighlight.addEventListener('mousedown', (event) => event.preventDefault());
    eraseHighlight.addEventListener('click', () => applyPromptHighlight(''));
    promptTools.append(eraseHighlight);
    const promptInstruction = element(
      'p',
      'bf26-tool-instruction',
      'Select question text, then choose a color. Erase removes highlighting from the selection.',
    );
    const prompt = element('p', 'bf26-prompt');
    prompt.tabIndex = 0;
    promptPanel.append(questionLabel, promptTools, promptInstruction, prompt);
    const answerPanel = element('section', 'bf26-answer-panel');
    const answerLabel = element('label', '', 'Your answer');
    answerLabel.htmlFor = 'bf26-current-answer';
    const editorToolbar = element('div', 'bf26-editor-toolbar');
    editorToolbar.setAttribute('role', 'toolbar');
    editorToolbar.setAttribute('aria-label', 'Essay formatting');
    editorToolbar.append(
      answerCommandButton('Undo', 'undo', 'Ctrl/Cmd+Z'),
      answerCommandButton('Redo', 'redo', 'Ctrl/Cmd+Shift+Z'),
      element('span', 'bf26-toolbar-divider'),
      answerCommandButton('B', 'bold', 'Ctrl/Cmd+B'),
      answerCommandButton('I', 'italic', 'Ctrl/Cmd+I'),
      answerCommandButton('U', 'underline', 'Ctrl/Cmd+U'),
      element('span', 'bf26-toolbar-divider'),
      answerCommandButton('Bullets', 'insertUnorderedList'),
      answerCommandButton('Numbered', 'insertOrderedList'),
    );
    const sizeLabel = element('label', 'bf26-size-label', 'Text size');
    const size = element('select', 'bf26-size-select');
    size.setAttribute('aria-label', 'Essay text size');
    for (const pixels of [14, 16, 18, 20, 22]) {
      const option = element('option', '', `${pixels}px`);
      option.value = String(pixels);
      size.append(option);
    }
    size.value = String(state.answerFontSize);
    sizeLabel.append(size);
    editorToolbar.append(sizeLabel);
    const editor = element('div', 'bf26-answer');
    editor.id = 'bf26-current-answer';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('data-placeholder', 'Type your answer here.');
    editor.spellcheck = true;
    editor.setAttribute('autocomplete', 'off');
    const countDetails = element('details', 'bf26-count-details');
    const count = element('summary', 'bf26-word-count');
    const breakdown = element('div', 'bf26-count-breakdown');
    const countWords = element('span');
    const countCharacters = element('span');
    const countWithoutSpaces = element('span');
    breakdown.append(countWords, countCharacters, countWithoutSpaces);
    countDetails.append(count, breakdown);
    answerPanel.append(answerLabel, editorToolbar, editor, countDetails);
    workspace.append(promptPanel, answerPanel);

    const footer = element('footer', 'bf26-exam-footer');
    const status = element('p', 'bf26-status');
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'bf26-actions');
    const previous = makeButton('Previous');
    const next = makeButton('Next');
    const showAll = makeButton('Show all questions');
    const submit = makeButton('Submit all answers', 'bf26-button bf26-button--primary');
    previous.addEventListener('click', () => {
      const previousIndex = adjacentQuestionIndex(-1);
      if (previousIndex < 0) return;
      state.currentIndex = previousIndex;
      syncExam(true);
    });
    next.addEventListener('click', () => {
      const nextIndex = adjacentQuestionIndex(1);
      if (nextIndex < 0) return;
      state.currentIndex = nextIndex;
      syncExam(true);
    });
    showAll.addEventListener('click', () => {
      state.questionFilter = 'all';
      filter.value = 'all';
      syncExamCompletion();
      filter.focus({ preventScroll: true });
      setStatus('Showing all questions.');
    });
    submit.addEventListener('click', submitForecast);
    actions.append(previous, next, showAll, submit);
    footer.append(status, actions);
    main.append(meta, workspace, footer);
    exam.append(nav, main);

    replaceView(exam, 'exam');
    state.examRefs = {
      jumpButtons,
      flagIcons,
      filter,
      metaSubject: metaSubject.querySelector('strong'),
      metaSchedule: metaSubject.querySelector('span'),
      metaQuestion: metaProgress.querySelector('strong'),
      metaProgress: metaProgress.querySelector('span'),
      questionLabel,
      flagQuestion,
      highlightButtons,
      prompt,
      editor,
      commandButtons: [...editorToolbar.querySelectorAll('[data-answer-command]')],
      size,
      count,
      countWords,
      countCharacters,
      countWithoutSpaces,
      previous,
      next,
      showAll,
      submit,
      status,
    };
    filter.addEventListener('change', () => {
      state.questionFilter = filter.value;
      const current = state.questions[state.currentIndex];
      const firstMatch = state.questions.findIndex((question) => questionMatchesFilter(question));
      if (firstMatch < 0) {
        const emptyFilter = state.questionFilter;
        state.questionFilter = 'all';
        filter.value = 'all';
        syncExamCompletion();
        setStatus(`No questions match ${emptyFilter.replace('-', ' ')}. Showing all questions.`);
        return;
      }
      if (firstMatch >= 0 && !questionMatchesFilter(current)) {
        state.currentIndex = firstMatch;
        syncExam(true);
        return;
      }
      syncExamCompletion();
    });
    flagQuestion.addEventListener('click', () => {
      const current = state.questions[state.currentIndex];
      if (!current) return;
      if (state.flaggedQuestions.has(current.id)) state.flaggedQuestions.delete(current.id);
      else state.flaggedQuestions.add(current.id);
      if (!questionMatchesFilter(current)) {
        const firstMatch = state.questions.findIndex((entry) => questionMatchesFilter(entry));
        if (firstMatch >= 0) {
          state.currentIndex = firstMatch;
          syncExam(true);
          return;
        }
        state.questionFilter = 'all';
        filter.value = 'all';
        syncExamCompletion();
        setStatus('No flagged questions remain. Showing all questions.');
        flagQuestion.focus({ preventScroll: true });
        return;
      }
      syncExamCompletion();
      flagQuestion.focus({ preventScroll: true });
    });
    prompt.addEventListener('mouseup', capturePromptSelection);
    prompt.addEventListener('pointerup', capturePromptSelection);
    prompt.addEventListener('touchend', capturePromptSelection, { passive: true });
    prompt.addEventListener('keyup', capturePromptSelection);
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      const plain = String(event.clipboardData?.getData('text/plain') || '');
      insertPlainAnswerText(editor, plain);
    });
    editor.addEventListener('drop', (event) => {
      event.preventDefault();
      editor.focus({ preventScroll: true });
      insertPlainAnswerText(editor, event.dataTransfer?.getData('text/plain') || '');
    });
    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'insertFromDrop' || event.inputType === 'insertFromPaste') {
        event.preventDefault();
        return;
      }
      const inserted = typeof event.data === 'string' ? event.data : '';
      const addsParagraph = event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak';
      if (!inserted && !addsParagraph) return;
      const selectedLength = selectedAnswerLength(editor);
      const available = MAX_ANSWER_CHARACTERS - (answerPlainText(editor).length - selectedLength);
      const nextText = addsParagraph ? '\n' : inserted;
      if (nextText.length <= available) return;
      event.preventDefault();
      insertPlainAnswerText(editor, nextText);
    });
    editor.addEventListener('input', () => {
      captureAnswerFromEditor();
      syncEditorToolbarState();
    });
    editor.addEventListener('focus', syncEditorToolbarState);
    editor.addEventListener('mouseup', syncEditorToolbarState);
    editor.addEventListener('keyup', syncEditorToolbarState);
    editor.addEventListener('blur', () => sanitizeEditorDom(editor));
    editor.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : '';
      if (!command) return;
      event.preventDefault();
      runAnswerCommand(command);
    });
    size.addEventListener('change', () => {
      state.answerFontSize = Number(size.value) || 16;
      editor.style.fontSize = `${state.answerFontSize}px`;
    });
    syncExam(false);
  }

  function syncExam(focusAnswer = false) {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    if (!refs || !question) return;
    const schedule = subjectSchedule();
    refs.metaSubject.textContent = state.subject;
    refs.metaSchedule.textContent = schedule
      ? `${schedule.date} · ${schedule.time} · simulation may be taken anytime`
      : 'Forecast simulation';
    refs.metaQuestion.textContent = `Question ${question.number} of ${REQUIRED_QUESTION_COUNT}`;
    refs.questionLabel.textContent = `Question ${question.number}`;
    renderPromptHighlights();
    const markup = sanitizeAnswerMarkup(state.answerMarkup.get(question.id) || '');
    if (markup) refs.editor.innerHTML = markup;
    else refs.editor.innerText = state.answers.get(question.id) || '';
    refs.editor.style.fontSize = `${state.answerFontSize}px`;
    refs.editor.setAttribute('aria-label', `Your answer to question ${question.number}`);
    state.lastPromptSelection = null;
    syncExamCompletion();
    syncEditorToolbarState();
    if (focusAnswer) refs.editor.focus({ preventScroll: true });
  }

  function syncExamCompletion() {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    if (!refs || !question) return;
    const currentAnswer = String(state.answers.get(question.id) || '');
    const currentWords = wordCount(currentAnswer);
    const currentCharacters = currentAnswer.length;
    const charactersWithoutSpaces = currentAnswer.replace(/\s/gu, '').length;
    const completeCount = completedAnswerCount();
    delete refs.status.dataset.kind;
    refs.count.textContent = `${currentCharacters} / ${MAX_ANSWER_CHARACTERS} characters · ${currentWords} words · minimum ${MINIMUM_WORDS}`;
    refs.count.classList.toggle('is-complete', currentWords >= MINIMUM_WORDS);
    refs.countWords.textContent = `Words: ${currentWords}`;
    refs.countCharacters.textContent = `Characters: ${currentCharacters}`;
    refs.countWithoutSpaces.textContent = `Characters without spaces: ${charactersWithoutSpaces}`;
    refs.metaProgress.textContent = `${completeCount} of ${REQUIRED_QUESTION_COUNT} answers meet the minimum`;
    refs.status.textContent = allAnswersComplete()
      ? 'All answers are ready for final submission.'
      : `${REQUIRED_QUESTION_COUNT - completeCount} answer${REQUIRED_QUESTION_COUNT - completeCount === 1 ? '' : 's'} still need at least ${MINIMUM_WORDS} words.`;
    refs.submit.disabled = !allAnswersComplete();
    const flagged = state.flaggedQuestions.has(question.id);
    refs.flagQuestion.textContent = flagged ? 'Unflag question' : 'Flag question';
    refs.flagQuestion.setAttribute('aria-pressed', String(flagged));
    state.questions.forEach((entry, index) => {
      const jump = refs.jumpButtons[index];
      const complete = wordCount(state.answers.get(entry.id)) >= MINIMUM_WORDS;
      const entryFlagged = state.flaggedQuestions.has(entry.id);
      jump.classList.toggle('is-complete', complete);
      jump.classList.toggle('is-flagged', entryFlagged);
      jump.hidden = !questionMatchesFilter(entry) && index !== state.currentIndex;
      refs.flagIcons[index].hidden = !entryFlagged;
      if (index === state.currentIndex) jump.setAttribute('aria-current', 'step');
      else jump.removeAttribute('aria-current');
      jump.setAttribute(
        'aria-label',
        `Go to question ${entry.number}${entryFlagged ? ', flagged' : ''}${complete ? ', minimum reached' : ', answer incomplete'}`,
      );
    });
    const previousIndex = adjacentQuestionIndex(-1);
    const nextIndex = adjacentQuestionIndex(1);
    const lastQuestion = state.currentIndex === state.questions.length - 1;
    refs.previous.disabled = previousIndex < 0;
    refs.next.hidden = lastQuestion || nextIndex < 0;
    refs.next.disabled = lastQuestion || nextIndex < 0;
    refs.showAll.hidden = lastQuestion || nextIndex >= 0 || state.questionFilter === 'all';
    refs.submit.hidden = !lastQuestion;
  }

  function renderSubmitting() {
    stopSubmittingProgress();
    const centered = element('div', 'bf26-centered');
    centered.append(
      element('div', 'bf26-spinner'),
      element('h2', '', state.acceptedAttempt ? 'Your answers are saved.' : 'Saving your answers…'),
      element(
        'p',
        'bf26-status',
        state.acceptedAttempt
          ? 'Your coaching report is being prepared. You can close this page; return to Saved attempts from any signed-in device.'
          : 'Waiting for the server to confirm this submission. Your exact answers are retained on this device.',
      ),
      element(
        'p',
        'bf26-submitting-note',
        'No final score is shown until all 20 answers have complete, validated assessments.',
      ),
      element('p', 'bf26-submitting-elapsed', 'Elapsed time: 0:00'),
    );
    centered.querySelector('.bf26-spinner').setAttribute('aria-hidden', 'true');
    centered.append(forecastTabs('history'));
    replaceView(centered, 'submitting');
    state.statusNode = centered.querySelector('.bf26-status');
    state.statusNode.setAttribute('role', 'status');
    state.statusNode.setAttribute('aria-live', 'polite');
    state.submissionElapsedNode = centered.querySelector('.bf26-submitting-elapsed');
    state.submissionElapsedNode.setAttribute('aria-hidden', 'true');
    state.submissionStartedAt = Date.now();
    state.submissionTimer = global.setInterval(() => {
      if (state.view !== 'submitting' || !state.submissionElapsedNode) {
        stopSubmittingProgress();
        return;
      }
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.submissionStartedAt) / 1000));
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = String(elapsedSeconds % 60).padStart(2, '0');
      state.submissionElapsedNode.textContent = `Elapsed time: ${minutes}:${seconds}`;
    }, 10_000);
  }

  function normalizeResults(payload, workspace = state) {
    const requiredText = (value) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('A forecast coaching field failed its integrity check.');
      }
      return value.trim();
    };
    const diagnosticScore = (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5
          || Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) {
        throw new Error('A forecast diagnostic score failed its integrity check.');
      }
      return value;
    };
    const diagnosticList = (value, allowedSources) => {
      if (!Array.isArray(value) || value.length > 5) {
        throw new Error('A forecast diagnostic list failed its integrity check.');
      }
      const entries = value.map(requiredText);
      if (new Set(entries.map((entry) => entry.toLowerCase())).size !== entries.length
          || !Array.isArray(allowedSources)
          || entries.some((entry) => entry.length < 8 || !allowedSources.some((source) => (
            typeof source === 'string' && source.includes(entry)
          )))) {
        throw new Error('A forecast diagnostic list failed its curated-source integrity check.');
      }
      return Object.freeze(entries);
    };
    const maxScore = payload?.maxScore;
    const totalScore = payload?.totalScore;
    if (typeof maxScore !== 'number' || maxScore !== 100
        || typeof totalScore !== 'number' || !Number.isFinite(totalScore)
        || totalScore < 0 || totalScore > maxScore
        || Math.abs(totalScore * 10 - Math.round(totalScore * 10)) > 1e-9) {
      throw new Error('The forecast grade response failed its integrity check.');
    }
    if (!Array.isArray(payload.results) || payload.results.length !== REQUIRED_QUESTION_COUNT) {
      throw new Error('The forecast result set is incomplete.');
    }
    const byId = new Map();
    for (const result of payload.results) {
      const questionId = String(result?.questionId || '').trim();
      const number = result?.number;
      const score = result?.score;
      const resultMax = result?.maxScore;
      const coaching = result?.mockBarCoaching;
      const grammar = result?.grammar;
      const issueSpotting = result?.issueSpotting;
      if (!questionId || byId.has(questionId) || !workspace.answers.has(questionId)
          || typeof number !== 'number' || !Number.isInteger(number)
          || number < 1 || number > REQUIRED_QUESTION_COUNT
          || typeof score !== 'number' || !Number.isFinite(score)
          || score < 0 || score > 5 || typeof resultMax !== 'number' || resultMax !== 5
          || Math.abs(score * 10 - Math.round(score * 10)) > 1e-9
          || !coaching || typeof coaching !== 'object' || Array.isArray(coaching)
          || !grammar || typeof grammar !== 'object' || Array.isArray(grammar)
          || !issueSpotting || typeof issueSpotting !== 'object' || Array.isArray(issueSpotting)
          || typeof grammar.maxScore !== 'number' || grammar.maxScore !== 5
          || typeof issueSpotting.maxScore !== 'number' || issueSpotting.maxScore !== 5
          || !Array.isArray(grammar.corrections) || grammar.corrections.length > 5) {
        throw new Error('A forecast result failed its integrity check.');
      }
      const userAnswer = requiredText(result.userAnswer);
      if (userAnswer !== String(workspace.answers.get(questionId) || '').trim()) {
        throw new Error('The returned answer did not match the submitted answer.');
      }
      const suggestedAnswer = requiredText(result.suggestedAnswer);
      const question = workspace.questions.find((candidate) => candidate.id === questionId);
      const issueSources = [question?.prompt || '', suggestedAnswer];
      const corrections = grammar.corrections.map((correction) => {
        if (!correction || typeof correction !== 'object' || Array.isArray(correction)) {
          throw new Error('A grammar correction failed its integrity check.');
        }
        const original = requiredText(correction.original);
        const category = String(correction.category || '').trim();
        const categoryConfig = GRAMMAR_CORRECTION_GUIDANCE[category];
        if (!userAnswer.includes(original) || !categoryConfig
            || correction.guidance !== categoryConfig.guidance) {
          throw new Error('A grammar correction did not match the submitted answer.');
        }
        return Object.freeze({
          original,
          category,
          guidance: categoryConfig.guidance,
        });
      });
      const identifiedIssues = diagnosticList(issueSpotting.identified, issueSources);
      const missedIssues = diagnosticList(issueSpotting.missed, issueSources);
      const identifiedKeys = new Set(identifiedIssues.map((item) => item.toLowerCase()));
      if (missedIssues.some((item) => identifiedKeys.has(item.toLowerCase()))) {
        throw new Error('An issue cannot be both identified and missed.');
      }
      byId.set(questionId, Object.freeze({
        questionId,
        number,
        score,
        maxScore: resultMax,
        feedback: requiredText(result.feedback),
        userAnswer,
        suggestedAnswer,
        explanation: requiredText(result.explanation),
        mockBarCoaching: Object.freeze({
          strength: requiredText(coaching.strength),
          priorityImprovement: requiredText(coaching.priorityImprovement),
          nextStep: requiredText(coaching.nextStep),
        }),
        grammar: Object.freeze({
          score: diagnosticScore(grammar.score),
          maxScore: 5,
          corrections: Object.freeze(corrections),
        }),
        issueSpotting: Object.freeze({
          score: diagnosticScore(issueSpotting.score),
          maxScore: 5,
          identified: identifiedIssues,
          missed: missedIssues,
          coaching: requiredText(issueSpotting.coaching),
        }),
      }));
    }
    const results = workspace.questions.map((question) => {
      const result = byId.get(question.id);
      if (!result || result.number !== question.number) {
        throw new Error('The forecast results did not match the submitted questions.');
      }
      return result;
    });
    const tenths = (read) => results.reduce((sum, result) => sum + Math.round(read(result) * 10), 0);
    const average = (read) => Math.round(tenths(read) / results.length) / 10;
    const computedTotal = tenths((result) => result.score) / 10;
    const analytics = Object.freeze({
      questionCount: results.length,
      averageScore: average((result) => result.score),
      issueSpottingAverage: average((result) => result.issueSpotting.score),
      grammarAverage: average((result) => result.grammar.score),
      diagnosticMaxScore: 5,
      performanceBands: Object.freeze({
        strong: results.filter((result) => result.score >= 4).length,
        developing: results.filter((result) => result.score >= 2.5 && result.score < 4).length,
        needsFocus: results.filter((result) => result.score < 2.5).length,
      }),
    });
    const suppliedAnalytics = payload?.analytics;
    if (computedTotal !== totalScore
        || !suppliedAnalytics || typeof suppliedAnalytics !== 'object'
        || typeof suppliedAnalytics.questionCount !== 'number'
        || suppliedAnalytics.questionCount !== analytics.questionCount
        || typeof suppliedAnalytics.averageScore !== 'number'
        || suppliedAnalytics.averageScore !== analytics.averageScore
        || typeof suppliedAnalytics.issueSpottingAverage !== 'number'
        || suppliedAnalytics.issueSpottingAverage !== analytics.issueSpottingAverage
        || typeof suppliedAnalytics.grammarAverage !== 'number'
        || suppliedAnalytics.grammarAverage !== analytics.grammarAverage
        || typeof suppliedAnalytics.diagnosticMaxScore !== 'number'
        || suppliedAnalytics.diagnosticMaxScore !== analytics.diagnosticMaxScore
        || typeof suppliedAnalytics.performanceBands?.strong !== 'number'
        || suppliedAnalytics.performanceBands.strong !== analytics.performanceBands.strong
        || typeof suppliedAnalytics.performanceBands?.developing !== 'number'
        || suppliedAnalytics.performanceBands.developing !== analytics.performanceBands.developing
        || typeof suppliedAnalytics.performanceBands?.needsFocus !== 'number'
        || suppliedAnalytics.performanceBands.needsFocus !== analytics.performanceBands.needsFocus) {
      throw new Error('The forecast analytics failed its integrity check.');
    }
    return Object.freeze({
      totalScore,
      maxScore,
      analytics,
      results: Object.freeze(results),
    });
  }

  async function submitForecast() {
    if (state.view !== 'exam') return;
    // Capture the final editor value BEFORE checking completeness, including
    // composition/paste updates that have not yet emitted their input event.
    sanitizeEditorDom(state.examRefs?.editor);
    if (!allAnswersComplete()) { setStatus('Complete all 20 answers before submitting.', 'error'); return; }
    if (!global.confirm('Submit all 20 answers for assessment? Your saved answers cannot be edited after acceptance.')) return;
    const submittedSubject = state.subject;
    const submittedAnswers = state.questions.map((question) => Object.freeze({
      questionId: question.id,
      answer: state.answers.get(question.id) || '',
    }));
    if (!state.clientAttemptId) state.clientAttemptId = newClientAttemptId();
    state.submissionSnapshot = freezeSubmission({ subject: submittedSubject, setId: state.setId,
      answers: submittedAnswers, clientAttemptId: state.clientAttemptId });
    if (!persistForecastDraft()) {
      state.submissionSnapshot = null;
      setStatus('Your draft could not be safely saved on this device. Keep this page open and retry; nothing was submitted.', 'error');
      return;
    }
    await sendForecastSubmission();
  }

  async function sendForecastSubmission() {
    const ownerId = runtimeOwnerId(); const generation = state.workspaceGeneration;
    const snapshot = state.submissionSnapshot;
    if (!snapshot || ownerId !== state.ownerId || !state.isOpen) return;
    if (!persistForecastDraft()) { renderSubmissionUnconfirmed('Your draft could not be saved on this device. Nothing new was sent. Keep this page open and retry.'); return; }
    renderSubmitting();
    try {
      const payload = await requestForecast(snapshot);
      if (!forecastRequestIsCurrent(ownerId, generation) || state.submissionSnapshot !== snapshot) return;
      if (payload?.attempt?.clientAttemptId !== snapshot.clientAttemptId) throw new Error('The saved submission identity could not be confirmed.');
      const attempt = adoptSavedAttempt(payload.attempt);
      renderSavedForecastStatus();
      if (!['complete', 'failed'].includes(attempt.status)) pollSavedForecast(attempt.id);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      if (handleForecastAccessInterruption(error)) return;
      renderSubmissionUnconfirmed(error?.message || 'The server has not confirmed acceptance. Your answers and submission ID are retained for a safe retry.');
    }
  }

  function appendResultSection(parent, heading, value, markup = '') {
    const section = element('section', 'bf26-result-section');
    const copy = element('p', '', value);
    const cleanMarkup = sanitizeAnswerMarkup(markup);
    if (cleanMarkup) copy.innerHTML = cleanMarkup;
    section.append(element('h4', '', heading), copy);
    parent.append(section);
  }

  function metricCard(label, value, note = '') {
    const card = element('div', 'bf26-metric-card');
    card.append(
      element('span', 'bf26-metric-label', label),
      element('strong', 'bf26-metric-value', value),
    );
    if (note) card.append(element('p', 'bf26-metric-note', note));
    return card;
  }

  function appendMockBarCoaching(parent, result) {
    const section = element('section', 'bf26-result-section bf26-coaching-section');
    section.append(
      element('h4', '', 'Mock Bar coaching'),
      element('p', 'bf26-coaching-summary', result.feedback),
    );
    const coaching = element('dl', 'bf26-coaching-grid');
    for (const [label, value] of [
      ['Strength', result.mockBarCoaching.strength],
      ['Priority improvement', result.mockBarCoaching.priorityImprovement],
      ['Next timed-answer step', result.mockBarCoaching.nextStep],
    ]) {
      const item = element('div', 'bf26-coaching-item');
      item.append(element('dt', '', label), element('dd', '', value));
      coaching.append(item);
    }
    section.append(coaching);
    parent.append(section);
  }

  function appendDiagnosticList(parent, heading, items, emptyMessage, kind = '') {
    const block = element('div', `bf26-diagnostic-list${kind ? ` bf26-diagnostic-list--${kind}` : ''}`);
    block.append(element('h5', '', heading));
    if (!items.length) {
      block.append(element('p', '', emptyMessage));
    } else {
      const list = element('ul');
      for (const item of items) list.append(element('li', '', item));
      block.append(list);
    }
    parent.append(block);
  }

  function appendIssueSpotting(parent, result) {
    const diagnostic = result.issueSpotting;
    const section = element('section', 'bf26-result-section bf26-diagnostic-section');
    const heading = element('div', 'bf26-section-heading');
    heading.append(
      element('h4', '', 'Issue spotting'),
      element('span', 'bf26-score-chip', `${diagnostic.score} / ${diagnostic.maxScore} diagnostic`),
    );
    section.append(heading);
    const lists = element('div', 'bf26-diagnostic-columns');
    appendDiagnosticList(lists, 'Issues identified', diagnostic.identified, 'No material issue was clearly identified.', 'identified');
    appendDiagnosticList(lists, 'Issues missed', diagnostic.missed, 'No material issue omission was identified.', 'missed');
    section.append(lists, element('p', 'bf26-diagnostic-coaching', diagnostic.coaching));
    parent.append(section);
  }

  function appendGrammarReview(parent, result) {
    const diagnostic = result.grammar;
    const section = element('section', 'bf26-result-section bf26-diagnostic-section');
    const heading = element('div', 'bf26-section-heading');
    heading.append(
      element('h4', '', 'Grammar and clarity'),
      element('span', 'bf26-score-chip', `${diagnostic.score} / ${diagnostic.maxScore} diagnostic`),
    );
    section.append(heading);
    if (!diagnostic.corrections.length) {
      section.append(element('p', 'bf26-no-corrections', 'No material grammar correction was identified.'));
    } else {
      const list = element('ol', 'bf26-correction-list');
      for (const correction of diagnostic.corrections) {
        const item = element('li', 'bf26-correction');
        const original = element('p');
        original.append(element('strong', '', 'Review this excerpt: '), element('q', '', correction.original));
        const focus = element('p');
        focus.append(
          element('strong', '', 'Correction focus: '),
          document.createTextNode(GRAMMAR_CORRECTION_GUIDANCE[correction.category].label),
        );
        const guidance = element('p');
        guidance.append(element('strong', '', 'How to revise: '), document.createTextNode(correction.guidance));
        item.append(original, focus, guidance);
        list.append(item);
      }
      section.append(list);
    }
    parent.append(section);
  }

  function practiceBand(averageScore) {
    if (averageScore >= 4) return 'Strong practice performance';
    if (averageScore >= 2.5) return 'Developing practice performance';
    return 'Priority coaching recommended';
  }

  function forecastPdfAbortError() {
    const error = new Error('The PDF request was cancelled.'); error.name = 'AbortError'; return error;
  }

  function awaitForecastPdfRequest(pending, signal) {
    return new Promise((resolve, reject) => {
      const observed = Promise.resolve(pending);
      if (signal.aborted) { observed.catch(() => {}); reject(forecastPdfAbortError()); return; }
      const abort = () => { signal.removeEventListener('abort', abort); reject(forecastPdfAbortError()); };
      signal.addEventListener('abort', abort, { once: true });
      observed.then(value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(forecastPdfAbortError()); else resolve(value);
      }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }

  function renderSavedForecastPdfInBrowser(attempt, ownerId, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(forecastPdfAbortError()); return; }
      if (typeof global.Worker !== 'function') { reject(new Error('This browser cannot prepare the PDF. Your saved report remains available.')); return; }
      let worker; let timer; let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        global.clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(forecastPdfAbortError());
      signal.addEventListener('abort', abort, { once: true });
      timer = global.setTimeout(() => finish(new Error('PDF preparation timed out. Your saved report is unchanged.')), FORECAST_PDF_RENDER_TIMEOUT_MS);
      try {
        // Fixed same-origin asset; no blob worker, remote script, auth token or
        // model request. The large renderer is downloaded only for this action.
        const origin = String(global.location?.origin || '');
        if (!/^https?:\/\/[^/?#]+$/u.test(origin)) throw new Error('INVALID_ORIGIN');
        worker = new global.Worker(`${origin}${FORECAST_PDF_WORKER}`, { name: 'due-diligence-saved-pdf' });
        worker.onmessage = ({ data }) => {
          if (signal.aborted) { finish(forecastPdfAbortError()); return; }
          if (data?.requestId !== 1) { finish(new Error('The PDF response could not be verified.')); return; }
          if (data.type === 'error') {
            const messages = {
              BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE: 'The PDF font cannot display a character in this report safely. Your complete report remains available here.',
              BAR_FORECAST_PDF_SIZE_LIMIT: 'This report is too large to export safely. Your saved report remains available.',
            };
            finish(new Error(messages[data.code] || 'The saved PDF could not be prepared. Your report is unchanged.')); return;
          }
          const bytes = data?.bytes instanceof ArrayBuffer ? new Uint8Array(data.bytes) : null;
          if (data.type !== 'result' || data.attemptId !== attempt.id || data.resultRevision !== attempt.resultRevision
              || data.pdfVersion !== 'forecast-pdf-v1' || data.fileName !== `duediligence-forecast-${attempt.id}-r${attempt.resultRevision}.pdf`
              || !bytes || bytes.length < 5 || bytes.length > 10 * 1024 * 1024
              || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
            finish(new Error('The PDF response could not be verified.')); return;
          }
          finish(null, { bytes, fileName: data.fileName });
        };
        worker.onerror = worker.onmessageerror = (event) => {
          event?.preventDefault?.(); finish(new Error('The saved PDF could not be prepared. Your report is unchanged.'));
        };
        worker.postMessage({ type: 'render', requestId: 1, ownerId, attempt });
      } catch { finish(new Error('The saved PDF could not be prepared. Your report is unchanged.')); }
    });
  }

  function forecastPdfRenderingSnapshot(saved) {
    const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
    const result = pick(saved.result, ['ownerId', 'attemptId', 'resultRevision', 'schemaVersion', 'subject', 'setId',
      'questionCount', 'completedQuestionCount', 'complete', 'totalScore', 'maxScore', 'percentage', 'contentVersion', 'rubricVersion']);
    result.analytics = pick(saved.result.analytics, ['averageScore', 'grammarAverage', 'issueSpottingAverage']);
    result.results = saved.result.results.map(row => ({
      ...pick(row, ['questionId', 'number', 'score', 'maxScore', 'question', 'userAnswer', 'suggestedAnswer',
        'feedback', 'explanation', 'legalBasis', 'jurisprudence', 'citation']),
      mockBarCoaching: pick(row.mockBarCoaching, ['strength', 'priorityImprovement', 'nextStep']),
      grammar: { score: row.grammar.score, corrections: row.grammar.corrections.map(item => pick(item, ['original', 'category', 'suggestion', 'guidance'])) },
      issueSpotting: { score: row.issueSpotting.score, identified: [...row.issueSpotting.identified],
        missed: [...row.issueSpotting.missed], coaching: row.issueSpotting.coaching },
    }));
    return { ...pick(saved, ['id', 'status', 'resultRevision', 'subject', 'setId', 'completedAt']),
      questions: saved.questions.map(row => pick(row, ['id', 'number', 'prompt'])),
      answers: saved.answers.map(row => pick(row, ['questionId', 'answer'])), result };
  }

  function noteBrowserPdfPrepared(attempt, byteCount, ownerId, generation) {
    if (!forecastRequestIsCurrent(ownerId, generation)) return;
    state.pdfNoteController?.abort();
    const controller = new AbortController(); state.pdfNoteController = controller;
    const deadline = global.setTimeout(() => controller.abort(), 5000);
    // Optional observation, not server verification or proof that the user saved
    // a file. Failure never changes the download, report, or visible access state.
    void awaitForecastPdfRequest(requestForecast({ operation: 'result_pdf_prepared',
      attemptId: attempt.id, resultRevision: attempt.resultRevision,
      pdfVersion: 'forecast-pdf-v1', byteCount }, { signal: controller.signal }), controller.signal)
      .catch(() => {}).finally(() => {
        global.clearTimeout(deadline);
        if (state.pdfNoteController === controller) state.pdfNoteController = null;
      });
  }

  async function downloadSavedForecast(trigger, status) {
    const attempt = state.acceptedAttempt;
    if (attempt?.status !== 'complete') return;
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    const session = runtimeSession();
    if (!session?.access_token || runtimeOwnerId() !== ownerId) return;
    abortRequest();
    const controller = new AbortController(); state.pdfController = controller;
    const isCurrent = () => forecastRequestIsCurrent(ownerId, generation) && !controller.signal.aborted
      && state.pdfController === controller && state.acceptedAttempt?.id === attempt.id;
    trigger.disabled = true;
    status.textContent = 'Preparing saved PDF…';
    let timeout = global.setTimeout(() => controller.abort(), FORECAST_REQUEST_TIMEOUT_MS);
    try {
      // Fresh server authorization is mandatory even when this report was
      // already displayed. Never export a cached report after access expires.
      const payload = await awaitForecastPdfRequest(requestForecast({ operation: 'attempt', attemptId: attempt.id }, { signal: controller.signal }), controller.signal);
      global.clearTimeout(timeout); timeout = null;
      if (!isCurrent()) return;
      const saved = normalizedSavedAttempt(payload?.attempt);
      if (saved.id !== attempt.id || saved.clientAttemptId !== attempt.clientAttemptId || saved.resultRevision !== attempt.resultRevision
          || saved.status !== 'complete' || saved.result?.ownerId !== ownerId || saved.result?.attemptId !== saved.id
          || saved.result?.resultRevision !== saved.resultRevision || saved.result?.complete !== true
          || saved.result?.subject !== saved.subject || saved.result?.setId !== saved.setId) {
        throw new Error('The saved report identity could not be verified.');
      }
      normalizeResults(saved.result, { questions: saved.questions, answers: new Map(saved.answers.map(row => [row.questionId, row.answer])) });
      // Send only the canonical rendering contract, not the session or other
      // transport/account metadata. The shared renderer validates it again.
      const rendering = forecastPdfRenderingSnapshot(saved);
      const exported = await renderSavedForecastPdfInBrowser(rendering, ownerId, controller.signal);
      if (!isCurrent()) return;
      const blob = new Blob([exported.bytes], { type: 'application/pdf' });
      const url = global.URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = exported.fileName;
      document.body.append(link); link.click(); link.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
      status.textContent = 'PDF download started.';
      noteBrowserPdfPrepared(saved, exported.bytes.length, ownerId, generation);
    } catch (error) {
      if (!forecastRequestIsCurrent(ownerId, generation) || state.pdfController !== controller) return;
      if (handleForecastAccessInterruption(error)) return;
      status.textContent = error?.name === 'AbortError' ? 'Download timed out. Your saved report is unchanged; retry when ready.' : error.message;
    } finally {
      global.clearTimeout(timeout);
      if (state.pdfController === controller) state.pdfController = null;
      // Another report action can cancel the PDF without replacing this DOM.
      // Release its old button only while the same owner/report is still current
      // and no successor PDF owns the busy state.
      if (!state.pdfController && trigger.isConnected && forecastRequestIsCurrent(ownerId, generation)
          && state.acceptedAttempt?.id === attempt.id) trigger.disabled = false;
    }
  }

  async function emailSavedForecast(trigger, status) {
    const attempt = state.acceptedAttempt;
    if (attempt?.status !== 'complete') return;
    const ownerId = state.ownerId; const generation = state.workspaceGeneration;
    trigger.disabled = true;
    try {
      const payload = await requestForecast({ operation: 'email_result', attemptId: attempt.id });
      if (!forecastRequestIsCurrent(ownerId, generation)) return;
      const emailStatus = payload?.email?.status;
      status.textContent = emailStatus === 'provider_accepted'
        ? 'Email accepted by the provider. Delivery to your verified account address is not yet confirmed.'
        : emailStatus === 'processing' ? 'The email request is processing. Check your inbox shortly.'
          : emailStatus === 'uncertain' ? 'Email delivery is not confirmed. Check your inbox before requesting again.'
            : 'Email could not be confirmed. Your report remains saved here.';
      trigger.disabled = ['provider_accepted', 'processing', 'uncertain'].includes(emailStatus);
    } catch (error) {
      if (!forecastRequestIsCurrent(ownerId, generation) || error?.name === 'AbortError') return;
      if (handleForecastAccessInterruption(error)) return;
      status.textContent = 'The email request could not be confirmed. Check your inbox before retrying.';
      trigger.disabled = false;
    }
  }

  function renderResults() {
    const resultSet = state.results;
    if (!resultSet) return;
    const results = element('section', 'bf26-results');
    results.append(forecastTabs('history'));
    results.setAttribute('aria-labelledby', 'bf26-report-title');
    const title = element('h2', '', `${state.subject} results`);
    title.id = 'bf26-report-title';
    results.append(
      element('p', 'bf26-badge', 'Grading complete · Mock Bar coaching report'),
      title,
      element(
        'p',
        'bf26-report-disclaimer',
        'This is an educational practice diagnostic, not an official Bar grade or a prediction of examination performance.',
      ),
    );
    const overview = element('section', 'bf26-report-overview');
    overview.setAttribute('aria-label', 'Forecast score overview');
    const grade = element('div', 'bf26-grade');
    grade.append(
      element('span', '', 'Mock Bar practice score'),
      element('strong', '', `${resultSet.totalScore} / ${resultSet.maxScore}`),
      element('p', '', practiceBand(resultSet.analytics.averageScore)),
    );
    const metrics = element('div', 'bf26-metric-grid');
    metrics.append(
      metricCard('Average answer', `${resultSet.analytics.averageScore} / 5`, 'Holistic legal-response score'),
      metricCard('Issue spotting', `${resultSet.analytics.issueSpottingAverage} / 5`, 'Non-scoring diagnostic'),
      metricCard('Grammar', `${resultSet.analytics.grammarAverage} / 5`, 'Non-scoring diagnostic'),
      metricCard('Priority review', String(resultSet.analytics.performanceBands.needsFocus), `of ${resultSet.analytics.questionCount} answers`),
    );
    overview.append(grade, metrics);
    results.append(overview);

    const analytics = element('section', 'bf26-analytics');
    analytics.append(
      element('h3', '', 'Performance analytics'),
      element('p', '', 'Issue spotting and grammar help diagnose writing habits; they do not change the 100-point practice score.'),
    );
    const bands = element('div', 'bf26-band-grid');
    bands.append(
      metricCard('Strong answers', String(resultSet.analytics.performanceBands.strong), '4.0–5.0 per answer'),
      metricCard('Developing answers', String(resultSet.analytics.performanceBands.developing), '2.5–3.9 per answer'),
      metricCard('Needs focus', String(resultSet.analytics.performanceBands.needsFocus), 'Below 2.5 per answer'),
    );
    analytics.append(bands);
    results.append(analytics);

    const strongest = [...resultSet.results].sort((left, right) => right.score - left.score)[0];
    const priority = [...resultSet.results].sort((left, right) => left.score - right.score)[0];
    const verdict = element('section', 'bf26-coach-verdict');
    verdict.append(element('h3', '', 'Mock Bar coach’s verdict'));
    const verdictGrid = element('dl', 'bf26-coaching-grid bf26-coaching-grid--report');
    for (const [label, value, questionNumber] of [
      ['Strongest demonstrated habit', strongest.mockBarCoaching.strength, strongest.number],
      ['Priority improvement', priority.mockBarCoaching.priorityImprovement, priority.number],
      ['Next practice action', priority.mockBarCoaching.nextStep, priority.number],
    ]) {
      const item = element('div', 'bf26-coaching-item');
      const description = element('dd');
      description.append(
        document.createTextNode(value),
        element('span', 'bf26-question-reference', `From question ${questionNumber}`),
      );
      item.append(
        element('dt', '', label),
        description,
      );
      verdictGrid.append(item);
    }
    verdict.append(verdictGrid);
    results.append(verdict);

    const reviewHeading = element('h3', 'bf26-review-heading', 'Question-by-question review');
    results.append(
      reviewHeading,
      element('p', 'bf26-review-intro', 'Open a question to review your answer, targeted coaching, issue spotting, grammar corrections, the curated suggested answer, and the score rationale.'),
    );

    const list = element('div', 'bf26-result-list');
    resultSet.results.forEach((result, index) => {
      const item = element('details', 'bf26-result');
      if (index === 0) item.open = true;
      const summary = element('summary');
      const summaryTitle = element('span', 'bf26-result-summary-title', `Question ${result.number}`);
      if (result.score < 2.5) summaryTitle.append(element('span', 'bf26-priority-label', 'Priority review'));
      const summaryScores = element('span', 'bf26-result-summary-scores');
      summaryScores.append(
        element('span', '', `${result.score} / ${result.maxScore} score`),
        element('span', '', `${result.issueSpotting.score} / 5 issues`),
        element('span', '', `${result.grammar.score} / 5 grammar`),
      );
      const summaryRow = element('span', 'bf26-result-summary-row');
      summaryRow.append(
        summaryTitle,
        summaryScores,
      );
      summary.append(summaryRow);
      const body = element('div', 'bf26-result-body');
      appendResultSection(body, 'Question', state.questions[index]?.prompt || 'Question unavailable.');
      appendResultSection(body, 'Your answer', result.userAnswer, state.answerMarkup.get(result.questionId));
      appendMockBarCoaching(body, result);
      appendIssueSpotting(body, result);
      appendGrammarReview(body, result);
      appendResultSection(body, 'Suggested answer', result.suggestedAnswer);
      appendResultSection(body, 'Score rationale', result.explanation);
      item.append(summary, body);
      list.append(item);
    });
    results.append(list);

    const actions = element('div', 'bf26-actions');
    if (state.acceptedAttempt?.status === 'complete') {
      const delivery = element('p', 'bf26-status'); delivery.setAttribute('role', 'status'); delivery.setAttribute('aria-live', 'polite');
      const download = makeButton('Download PDF'); download.addEventListener('click', () => downloadSavedForecast(download, delivery));
      const email = makeButton('Email to me'); email.addEventListener('click', () => emailSavedForecast(email, delivery));
      actions.append(download, email); results.append(delivery);
    }
    const another = makeButton('Choose another subject', 'bf26-button bf26-button--primary');
    another.addEventListener('click', () => {
      state.subject = '';
      state.schedule = null;
      state.setId = '';
      state.questions = [];
      state.answers = new Map();
      state.answerMarkup = new Map();
      state.flaggedQuestions = new Set();
      state.questionHighlights = new Map();
      state.questionFilter = 'all';
      state.lastPromptSelection = null;
      state.results = null;
      state.currentIndex = 0;
      state.clientAttemptId = '';
      state.acceptedAttempt = null;
      state.submissionSnapshot = null;
      renderSubjectPicker();
    });
    const close = makeButton('Close forecast');
    close.addEventListener('click', () => closeForecast({ force: true }));
    actions.append(another, close);
    results.append(actions);
    replaceView(results, 'results');
  }

  async function checkAuthorization() {
    if (!state.isOpen) return false;
    const ownerId = runtimeOwnerId();
    if (!ownerId || !runtimeSession()?.access_token) {
      closeForecast({ force: true, restoreRoute: false });
      openForecastSignIn();
      return true;
    }
    if (state.authorizationOwnerId === ownerId && state.authorizationController) return true;
    renderAccessProgress();
    // Session restoration can emit another same-user event while this request is
    // pending. Claim the owner before awaiting so that event cannot abort and
    // replace the consent view underneath an agreement click.
    state.authorizationOwnerId = ownerId;
    const deadline = beginAuthorizationDeadline();
    const isCurrentAuthorization = () => state.isOpen
      && ownerId === runtimeOwnerId()
      && state.authorizationController === deadline.controller;
    try {
      const ensureRequiredSetup = global.DueDiligencePhase4?.ensureRequiredSetup;
      if (typeof ensureRequiredSetup !== 'function') {
        throw new Error('Required account setup could not be verified.');
      }
      const setupReady = await Promise.race([
        ensureRequiredSetup(ROUTE, { signal: deadline.signal }),
        deadline.timeoutPromise,
      ]);
      if (!isCurrentAuthorization() || deadline.signal.aborted) return false;
      if (setupReady !== true) {
        closeForecast({ force: true, restoreRoute: false });
        global.toast?.('Complete the required account setup before opening Bar Forecast.', 'warn');
        return true;
      }
      const payload = await Promise.race([
        requestForecast({ operation: 'status' }, { signal: deadline.signal }),
        deadline.timeoutPromise,
      ]);
      if (!isCurrentAuthorization() || deadline.signal.aborted) return false;
      if (payload?.authorized !== true) {
        routeToPlansAndPricing();
        return true;
      }
      state.ownerId = ownerId;
      state.consentAccepted = payload?.consentAccepted === true;
      if (state.consentAccepted) renderSubjectPicker('', true);
      else renderDisclaimer();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (!deadline.timedOut()) return false;
      }
      if (!isCurrentAuthorization()) return false;
      if (handleForecastAccessInterruption(error)) return true;
      renderAccessError(
        error?.message || 'Bar Forecast access could not be confirmed. The protected forecast remains closed.',
      );
      // Keep a terminal-error owner marker so a late same-account session event
      // cannot reopen the failed preflight before the user chooses Try again.
      if (state.isOpen && ownerId === runtimeOwnerId()) {
        state.authorizationOwnerId = ownerId;
        state.authorizationErrorOwnerId = ownerId;
      }
      return true;
    } finally {
      const ownsAuthorization = state.authorizationController === deadline.controller;
      deadline.clear();
      if (ownsAuthorization) state.authorizationOwnerId = '';
    }
  }

  function hasDraftAnswers() {
    return state.view === 'exam'
      && [...state.answers.values()].some((answer) => String(answer || '').trim());
  }

  function closeForecast(options = {}) {
    if (!state.isOpen) return true;
    if (state.view === 'exam') captureAnswerFromEditor();
    if (state.questions.length && !state.results) {
      const saved = persistForecastDraft();
      if (!saved && !state.acceptedAttempt && options.force !== true
          && !global.confirm('This device could not save the draft. Leave this page anyway?')) return false;
    }
    stopForecastPolling();
    abortRequest();
    abortAuthorization();
    const trigger = state.lastTrigger;
    state.isOpen = false;
    state.viewNode?.replaceChildren();
    state.statusNode = null;
    state.root.hidden = true;
    isolatePage(false);
    resetProtectedState();
    global.dispatchEvent(new Event('duediligence:bar-forecast-closed'));
    if (options.restoreRoute !== false) restoreForecastRoute();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    return true;
  }

  async function openForecast(trigger = null, options = {}) {
    if (options.isCurrent?.() === false) return false;
    ensureRoot();
    if (!runtimeOwnerId() || !runtimeSession()?.access_token) {
      openForecastSignIn();
      return true;
    }
    if (state.isOpen) {
      const ownerId = runtimeOwnerId();
      if (ownerId && ownerId !== state.ownerId && ownerId !== state.authorizationOwnerId) {
        await checkAuthorization();
      }
      return true;
    }
    state.lastTrigger = trigger instanceof Element ? trigger : document.activeElement;
    state.pricingRedirectInProgress = false;
    state.isOpen = true;
    setForecastRoute();
    isolatePage(true);
    state.root.hidden = false;
    renderAccessProgress();
    await checkAuthorization();
    return true;
  }

  function handleForecastSessionChange() {
    if (!state.isOpen) return;
    const nextOwnerId = runtimeOwnerId();
    if (nextOwnerId && (
      nextOwnerId === state.ownerId
      || nextOwnerId === state.authorizationOwnerId
      || (state.view === 'access-error' && nextOwnerId === state.authorizationErrorOwnerId)
    )) return;
    abortRequest();
    abortAuthorization();
    resetProtectedState();
    if (nextOwnerId) {
      renderAccessProgress('The signed-in account changed. Checking Forecast access again…');
      checkAuthorization();
    } else {
      closeForecast({ force: true, restoreRoute: false });
      openForecastSignIn();
    }
  }

  global.addEventListener('duediligence:session', handleForecastSessionChange);

  function handleForecastAccessChange(event) {
    if (!state.isOpen) return;
    const ownerId = runtimeOwnerId();
    const access = event?.detail;
    if (ownerId && ownerId === state.ownerId && access && typeof access.allowed === 'boolean'
        && access.basis && !['admin', 'founder_admin', 'super_admin'].includes(access.role)
        && (access.allowed === false || access.unlimited === false)) {
      if (state.view === 'exam') captureAnswerFromEditor();
      persistForecastDraft();
      stopForecastPolling(); abortRequest();
      routeToPlansAndPricing(); return;
    }
    if (!ownerId || ownerId === state.ownerId
        || (state.view === 'access-error' && ownerId === state.authorizationErrorOwnerId)) return;
    // ensureRequiredSetup() itself refreshes access. Ignore the event emitted by
    // that refresh while authorization is pending. A terminal failure stays
    // visible until the member explicitly retries or changes accounts.
    if (state.authorizationOwnerId) return;
    checkAuthorization();
  }

  global.addEventListener('duediligence:access', handleForecastAccessChange);

  function recoverBlockedForecastRoute() {
    state.routeRecovery = true;
    history.forward();
    global.setTimeout(() => {
      if (!state.routeRecovery || !state.isOpen) return;
      if (location.hash !== ROUTE) {
        state.routeWasPushed = true;
        history.pushState({ dueDiligenceBarForecast: true }, '', ROUTE);
      }
      state.routeRecovery = false;
    }, 250);
  }

  global.addEventListener('popstate', () => {
    if (state.routeRecovery) {
      if (location.hash === ROUTE) state.routeRecovery = false;
      return;
    }
    if (!state.isOpen || location.hash === ROUTE) return;
    if (!closeForecast({ restoreRoute: false })) recoverBlockedForecastRoute();
  });
  global.addEventListener('hashchange', () => {
    if (state.routeRecovery || !state.isOpen || location.hash === ROUTE) return;
    if (!closeForecast({ restoreRoute: false })) {
      state.routeWasPushed = false;
      history.replaceState({ dueDiligenceBarForecast: true }, '', ROUTE);
    }
  });
  global.addEventListener('beforeunload', (event) => {
    if (!state.isOpen) return;
    if (state.view === 'exam') captureAnswerFromEditor();
    if (state.questions.length && !state.results && !persistForecastDraft() && !state.acceptedAttempt) {
      event.preventDefault(); event.returnValue = '';
    }
  });

  global.openBarForecast = openForecast;
  global.DueDiligenceBarForecast = Object.freeze({
    open: openForecast,
    close: closeForecast,
  });
})(window);
