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
  const HIGHLIGHT_COLORS = Object.freeze([
    Object.freeze({ id: 'yellow', label: 'Yellow' }),
    Object.freeze({ id: 'green', label: 'Green' }),
    Object.freeze({ id: 'blue', label: 'Blue' }),
    Object.freeze({ id: 'pink', label: 'Pink' }),
  ]);

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
    lastTrigger: null,
    returnHash: '#quorum',
    isolation: [],
    previousOverflow: '',
    routeWasPushed: false,
    routeRecovery: false,
    requestController: null,
    isOpen: false,
    view: 'preview',
    ownerId: '',
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
  };

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

  function answerPlainText(editor) {
    return String(editor?.innerText || '')
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
      refs.editor.textContent = plain;
      placeCaretAtEnd(refs.editor);
    }
    state.answers.set(question.id, plain);
    state.answerMarkup.set(question.id, sanitizeAnswerMarkup(refs.editor.innerHTML));
    syncExamCompletion();
  }

  function selectedAnswerLength(editor) {
    const selection = global.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return 0;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return 0;
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
            <p class="bf26-eyebrow">Administrator pilot</p>
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
    root.querySelector('.bf26-close')?.addEventListener('click', () => closeForecast());
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
        .map((node) => ({ node, inert: Boolean(node.inert) }));
      for (const entry of state.isolation) entry.node.inert = true;
      state.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('bf26-page-open');
      return;
    }
    for (const entry of state.isolation) entry.node.inert = entry.inert;
    state.isolation = [];
    document.body.style.overflow = state.previousOverflow;
    document.body.classList.remove('bf26-page-open');
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
    state.ownerId = '';
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
  }

  function abortRequest() {
    state.requestController?.abort();
    state.requestController = null;
  }

  function beginRequest() {
    abortRequest();
    state.requestController = new AbortController();
    return state.requestController;
  }

  async function requestForecast(body) {
    const client = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (typeof client?.request !== 'function') {
      const error = new Error('Administrator access could not be checked yet.');
      error.code = 'AUTH_UNRESOLVED';
      throw error;
    }
    const controller = beginRequest();
    try {
      return await client.request(ENDPOINT, {
        body,
        signal: controller.signal,
        recoverAccess: false,
      });
    } finally {
      if (state.requestController === controller) state.requestController = null;
    }
  }

  function replaceView(node, viewName) {
    state.view = viewName;
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

  function setStatus(message = '', kind = '') {
    if (!state.statusNode) return;
    state.statusNode.textContent = message;
    if (kind) state.statusNode.dataset.kind = kind;
    else delete state.statusNode.dataset.kind;
  }

  function renderPreview(options = {}) {
    resetProtectedState();
    const centered = element('div', 'bf26-centered');
    const grid = element('div', 'bf26-preview-grid');
    const figure = element('figure', 'bf26-preview-figure');
    const image = element('img');
    image.src = 'assets/bar-forecast/forecast-workspace-preview.webp';
    image.alt = 'Preview of the 2026 Bar Forecast writing workspace with a twenty-question navigator and blank answer editor.';
    image.width = 1672;
    image.height = 939;
    image.decoding = 'async';
    const caption = element(
      'figcaption',
      '',
      'Interface preview only. Forecast questions and suggested answers are never included in this public preview.',
    );
    figure.append(image, caption);

    const copy = element('section', 'bf26-copy');
    copy.append(
      element('p', 'bf26-badge', 'Coming soon'),
      element('h2', '', 'A focused forecast workspace is being prepared.'),
      element(
        'p',
        '',
        'This limited pilot is available only to authorized Due Diligence administrators. The public preview does not contain forecast questions, answers, scoring methods, or internal prediction data.',
      ),
    );
    const actions = element('div', 'bf26-actions');
    const check = makeButton(
      options.checking ? 'Checking admin access…' : 'Check admin access',
      'bf26-button bf26-button--primary',
    );
    check.disabled = options.checking === true;
    check.addEventListener('click', () => checkAuthorization());
    const home = makeButton('Return to Home');
    home.addEventListener('click', () => closeForecast({ force: true }));
    actions.append(check, home);
    const status = element('p', 'bf26-status');
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = options.message || (
      options.checking
        ? 'Verifying this signed-in account without exposing protected material…'
        : 'If you are an authorized administrator, sign in through Due Diligence and check access again.'
    );
    copy.append(actions, status);
    grid.append(figure, copy);
    centered.append(grid);
    replaceView(centered, 'preview');
    if (options.kind) setStatus(status.textContent, options.kind);
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
    accept.addEventListener('click', async () => {
      if (accept.disabled) return;
      accept.disabled = true;
      decline.disabled = true;
      accept.textContent = 'Saving acceptance…';
      setStatus('Saving this disclosure acceptance…');
      const ownerId = runtimeOwnerId();
      try {
        const payload = await requestForecast({ operation: 'accept', version: CONSENT_VERSION });
        if (!state.isOpen || ownerId !== runtimeOwnerId()) return;
        if (payload?.authorized !== true || payload?.consentAccepted !== true) {
          renderPreview({ message: 'Administrator authorization could not be confirmed.', kind: 'error' });
          return;
        }
        state.ownerId = ownerId;
        state.consentAccepted = true;
        renderSubjectPicker();
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if ([401, 403].includes(Number(error?.status))) {
          renderPreview({ message: 'This account is not authorized for the administrator pilot.', kind: 'error' });
          return;
        }
        decline.disabled = false;
        accept.disabled = false;
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

  function renderSubjectPicker(message = '') {
    const picker = element('section', 'bf26-picker');
    picker.append(
      element('p', 'bf26-badge', 'Authorized administrator'),
      element('h2', '', 'Choose a 2026 Bar subject.'),
      element(
        'p',
        '',
        'Each subject opens an independent twenty-question forecast simulation. Questions are delivered securely only after the server confirms administrator access.',
      ),
      element(
        'div',
        'bf26-anytime',
        'The official examination date and session are shown for orientation. Forecast simulations may be taken anytime during this pilot.',
      ),
    );

    const grid = element('div', 'bf26-subject-grid');
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
    if (!ownerId || ownerId !== state.ownerId) {
      renderPreview({ message: 'Administrator access must be confirmed again.', kind: 'error' });
      return;
    }
    const buttons = [...state.viewNode.querySelectorAll('[data-subject]')];
    for (const button of buttons) button.disabled = true;
    trigger.textContent = 'Opening 20 questions…';
    setStatus(`Opening ${subjectName}…`);
    try {
      const payload = await requestForecast({ operation: 'start', subject: subjectName });
      if (!state.isOpen || ownerId !== runtimeOwnerId()) return;
      const setId = String(payload?.setId || '').trim().toLowerCase();
      if (!/^sha256:[0-9a-f]{64}$/u.test(setId)) {
        throw new Error('The forecast question-set identity failed verification.');
      }
      state.questions = normalizeQuestions(payload, subjectName);
      state.subject = subjectName;
      state.schedule = payload.schedule || null;
      state.setId = setId;
      state.answers = new Map(state.questions.map((question) => [question.id, '']));
      state.answerMarkup = new Map();
      state.flaggedQuestions = new Set();
      state.questionHighlights = new Map();
      state.questionFilter = 'all';
      state.lastPromptSelection = null;
      state.currentIndex = 0;
      state.results = null;
      renderExam();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if ([401, 403].includes(Number(error?.status))) {
        renderPreview({ message: 'Administrator authorization expired or was not confirmed.', kind: 'error' });
        return;
      }
      renderSubjectPicker(error?.message || 'The forecast could not be opened. Please try again.');
      setStatus(state.statusNode?.textContent || '', 'error');
    }
  }

  function allAnswersComplete() {
    return state.questions.length === REQUIRED_QUESTION_COUNT
      && state.questions.every((question) => wordCount(state.answers.get(question.id)) >= MINIMUM_WORDS);
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
    else refs.editor.textContent = state.answers.get(question.id) || '';
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
    const centered = element('div', 'bf26-centered');
    centered.append(
      element('div', 'bf26-spinner'),
      element('h2', '', 'Submitting all 20 answers…'),
      element(
        'p',
        'bf26-status',
        'Keep this window open while the administrator forecast is graded.',
      ),
    );
    centered.querySelector('.bf26-spinner').setAttribute('aria-hidden', 'true');
    replaceView(centered, 'submitting');
    state.statusNode = centered.querySelector('.bf26-status');
    state.statusNode.setAttribute('role', 'status');
  }

  function normalizeResults(payload) {
    const maxScore = Number(payload?.maxScore);
    const totalScore = Number(payload?.totalScore);
    if (maxScore !== 100 || !Number.isFinite(totalScore) || totalScore < 0 || totalScore > maxScore) {
      throw new Error('The forecast grade response failed its integrity check.');
    }
    if (!Array.isArray(payload.results) || payload.results.length !== REQUIRED_QUESTION_COUNT) {
      throw new Error('The forecast result set is incomplete.');
    }
    const byId = new Map();
    for (const result of payload.results) {
      const questionId = String(result?.questionId || '').trim();
      const number = Number(result?.number);
      const score = Number(result?.score);
      const resultMax = Number(result?.maxScore);
      if (!questionId || byId.has(questionId) || !state.answers.has(questionId)
          || !Number.isInteger(number) || number < 1 || number > REQUIRED_QUESTION_COUNT
          || !Number.isFinite(score) || score < 0 || score > 5 || resultMax !== 5
          || typeof result?.feedback !== 'string'
          || typeof result?.userAnswer !== 'string'
          || typeof result?.suggestedAnswer !== 'string'
          || typeof result?.explanation !== 'string') {
        throw new Error('A forecast result failed its integrity check.');
      }
      byId.set(questionId, Object.freeze({
        questionId,
        number,
        score,
        maxScore: resultMax,
        feedback: result.feedback.trim(),
        userAnswer: result.userAnswer.trim(),
        suggestedAnswer: result.suggestedAnswer.trim(),
        explanation: result.explanation.trim(),
      }));
    }
    const results = state.questions.map((question) => {
      const result = byId.get(question.id);
      if (!result || result.number !== question.number) {
        throw new Error('The forecast results did not match the submitted questions.');
      }
      return result;
    });
    return Object.freeze({ totalScore, maxScore, results: Object.freeze(results) });
  }

  async function submitForecast() {
    if (!allAnswersComplete() || state.view !== 'exam') return;
    sanitizeEditorDom(state.examRefs?.editor);
    if (!allAnswersComplete()) return;
    if (!global.confirm('Submit all 20 answers for final grading? Answers cannot be edited after submission.')) return;
    const ownerId = runtimeOwnerId();
    const submittedSubject = state.subject;
    const submittedAnswers = state.questions.map((question) => Object.freeze({
      questionId: question.id,
      answer: state.answers.get(question.id) || '',
    }));
    renderSubmitting();
    try {
      const payload = await requestForecast({
        operation: 'submit',
        subject: submittedSubject,
        setId: state.setId,
        answers: submittedAnswers,
      });
      if (!state.isOpen || ownerId !== runtimeOwnerId() || submittedSubject !== state.subject) return;
      state.results = normalizeResults(payload);
      renderResults();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if ([401, 403].includes(Number(error?.status))) {
        renderPreview({ message: 'Administrator authorization expired before grading completed.', kind: 'error' });
        return;
      }
      renderExam();
      setStatus(error?.message || 'The answers were not submitted. Review them and try again.', 'error');
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

  function renderResults() {
    const resultSet = state.results;
    if (!resultSet) return;
    const results = element('section', 'bf26-results');
    results.append(
      element('p', 'bf26-badge', 'Grading complete'),
      element('h2', '', `${state.subject} results`),
      element(
        'p',
        '',
        'Open a question to review its score, feedback, your submitted answer, the suggested answer, and the accompanying explanation.',
      ),
    );
    const grade = element('div', 'bf26-grade');
    grade.append(
      element('span', '', 'Total grade'),
      element('strong', '', `${resultSet.totalScore} / ${resultSet.maxScore}`),
    );
    results.append(grade);

    const list = element('div', 'bf26-result-list');
    resultSet.results.forEach((result, index) => {
      const item = element('details', 'bf26-result');
      if (index === 0) item.open = true;
      const summary = element('summary');
      summary.append(
        element('span', '', `Question ${result.number}`),
        element('span', '', `${result.score} / ${result.maxScore}`),
      );
      const body = element('div', 'bf26-result-body');
      appendResultSection(body, 'Question', state.questions[index]?.prompt || 'Question unavailable.');
      appendResultSection(body, 'Feedback', result.feedback);
      appendResultSection(body, 'Your answer', result.userAnswer, state.answerMarkup.get(result.questionId));
      appendResultSection(body, 'Suggested answer', result.suggestedAnswer);
      appendResultSection(body, 'Explanation', result.explanation);
      item.append(summary, body);
      list.append(item);
    });
    results.append(list);

    const actions = element('div', 'bf26-actions');
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
      renderPreview({
        message: 'Administrator access is not available for this signed-out or unresolved session.',
      });
      return true;
    }
    renderPreview({ checking: true });
    try {
      const payload = await requestForecast({ operation: 'status' });
      if (!state.isOpen || ownerId !== runtimeOwnerId()) return false;
      if (payload?.authorized !== true) {
        renderPreview({ message: 'This account is not authorized for the administrator pilot.' });
        return true;
      }
      state.ownerId = ownerId;
      state.consentAccepted = payload?.consentAccepted === true;
      if (state.consentAccepted) renderSubjectPicker();
      else renderDisclaimer();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      renderPreview({
        message: [401, 403].includes(Number(error?.status))
          ? 'This account is not authorized for the administrator pilot.'
          : 'Administrator access could not be confirmed. The protected forecast remains closed.',
        kind: error?.status ? '' : 'error',
      });
      return true;
    }
  }

  function hasDraftAnswers() {
    return state.view === 'exam'
      && [...state.answers.values()].some((answer) => String(answer || '').trim());
  }

  function closeForecast(options = {}) {
    if (!state.isOpen) return true;
    if (state.view === 'submitting' && options.force !== true) return false;
    if (hasDraftAnswers() && options.force !== true
        && !global.confirm('Close the forecast and discard all unsubmitted answers?')) return false;
    abortRequest();
    const trigger = state.lastTrigger;
    state.isOpen = false;
    state.viewNode?.replaceChildren();
    state.statusNode = null;
    state.root.hidden = true;
    isolatePage(false);
    resetProtectedState();
    if (options.restoreRoute !== false) restoreForecastRoute();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    return true;
  }

  async function openForecast(trigger = null) {
    ensureRoot();
    if (state.isOpen) return true;
    state.lastTrigger = trigger instanceof Element ? trigger : document.activeElement;
    state.isOpen = true;
    setForecastRoute();
    isolatePage(true);
    state.root.hidden = false;
    renderPreview({
      message: runtimeOwnerId()
        ? 'Checking whether this signed-in account is authorized…'
        : 'Administrator access is not available for this signed-out or unresolved session.',
      checking: Boolean(runtimeOwnerId()),
    });
    if (runtimeOwnerId()) await checkAuthorization();
    return true;
  }

  global.addEventListener('duediligence:session', () => {
    if (!state.isOpen) return;
    const nextOwnerId = runtimeOwnerId();
    if (nextOwnerId && nextOwnerId === state.ownerId) return;
    abortRequest();
    resetProtectedState();
    renderPreview({
      message: nextOwnerId
        ? 'The signed-in account changed. Checking administrator access again…'
        : 'Administrator access is not available for this signed-out session.',
      checking: Boolean(nextOwnerId),
    });
    if (nextOwnerId) checkAuthorization();
  });

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
    if (!state.isOpen || (state.view !== 'submitting' && !hasDraftAnswers())) return;
    event.preventDefault();
    event.returnValue = '';
  });

  global.openBarForecast = openForecast;
  global.DueDiligenceBarForecast = Object.freeze({
    open: openForecast,
    close: closeForecast,
  });
})(window);
