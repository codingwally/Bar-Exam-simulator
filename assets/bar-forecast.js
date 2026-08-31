(function dueDiligenceBarForecast(global) {
  'use strict';

  const ROUTE = '#bar-forecast-2026';
  const ENDPOINT = '/admin/dd2026/bar-forecast';
  const CONSENT_VERSION = '2026-08-31';
  const REQUIRED_QUESTION_COUNT = 20;
  const MINIMUM_WORDS = 10;

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
  const state = {
    root: null,
    dialog: null,
    viewNode: null,
    statusNode: null,
    lastTrigger: null,
    returnHash: '#quorum',
    isolation: [],
    previousOverflow: '',
    requestController: null,
    isOpen: false,
    view: 'preview',
    ownerId: '',
    consentAccepted: false,
    subject: '',
    schedule: null,
    questions: [],
    answers: new Map(),
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
      <section class="bf26-dialog" role="dialog" aria-modal="true" aria-labelledby="bf26-dialog-title" tabindex="-1">
        <header class="bf26-dialog-header">
          <div class="bf26-brand">
            <p class="bf26-eyebrow">Administrator pilot</p>
            <h1 class="bf26-dialog-title" id="bf26-dialog-title">2026 Bar Forecast</h1>
          </div>
          <button class="bf26-close" type="button" aria-label="Close 2026 Bar Forecast">×</button>
        </header>
        <main class="bf26-view" data-bf26-view></main>
      </section>`;

    document.body.append(root);
    state.root = root;
    state.dialog = root.querySelector('.bf26-dialog');
    state.viewNode = root.querySelector('[data-bf26-view]');
    root.querySelector('.bf26-close')?.addEventListener('click', () => closeForecast());
    root.addEventListener('click', (event) => {
      if (event.target === root) closeForecast();
    });
    root.addEventListener('keydown', trapDialogKeyboard);
    return root;
  }

  function focusableNodes() {
    if (!state.root) return [];
    return [...state.root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
  }

  function trapDialogKeyboard(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeForecast();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableNodes();
    if (!focusable.length) {
      event.preventDefault();
      state.dialog?.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
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
      return;
    }
    for (const entry of state.isolation) entry.node.inert = entry.inert;
    state.isolation = [];
    document.body.style.overflow = state.previousOverflow;
  }

  function setForecastRoute() {
    if (location.hash === ROUTE) {
      state.returnHash = '#quorum';
      return;
    }
    state.returnHash = location.hash || '#quorum';
    history.pushState({ dueDiligenceBarForecast: true }, '', ROUTE);
  }

  function restoreForecastRoute() {
    if (location.hash !== ROUTE) return;
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
    state.questions = [];
    state.answers = new Map();
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
    const copy = element('section', 'bf26-copy');
    copy.append(
      element('p', 'bf26-badge', 'Required before starting'),
      element('h2', '', 'Forecast disclaimer'),
      element(
        'p',
        '',
        'The 2026 Bar Forecast is an educational administrator pilot. Acceptance is required once for this disclosure version before any forecast subject can be opened.',
      ),
    );

    const disclosure = element('div', 'bf26-disclaimer');
    const list = element('ul');
    for (const text of [
      'This pilot is designed to train issue spotting. Its question set is aligned using historical question repetition, the 2026 Bar Chair\'s cases, and other editorial indicators.',
      'Forecasting is not an exact science and is not guaranteed accurate.',
      'Forecasts are editorial and AI-assisted study material; they are not official Supreme Court questions, leaks, or confidential examination content.',
      'A predicted topic is not a probability, promise, or guarantee that it will appear in the 2026 Bar Examinations.',
      'Suggested answers, scores, explanations, and feedback may contain errors and do not constitute legal advice.',
      'The official Bar bulletins, syllabi, statutes, rules, and controlling jurisprudence remain authoritative.',
    ]) list.append(element('li', '', text));
    disclosure.append(list);

    const consent = element('label', 'bf26-consent');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'bar-forecast-disclaimer';
    const consentCopy = element(
      'span',
      '',
      'I have read and understand this forecast disclaimer, including the limits of predictions, AI-assisted feedback, suggested answers, and scores.',
    );
    consent.append(checkbox, consentCopy);

    const actions = element('div', 'bf26-actions');
    const accept = makeButton('Accept and choose a subject', 'bf26-button bf26-button--primary');
    accept.disabled = true;
    checkbox.addEventListener('change', () => { accept.disabled = !checkbox.checked; });
    accept.addEventListener('click', async () => {
      if (!checkbox.checked || accept.disabled) return;
      accept.disabled = true;
      checkbox.disabled = true;
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
        checkbox.disabled = false;
        accept.disabled = !checkbox.checked;
        accept.textContent = 'Accept and choose a subject';
        setStatus(error?.message || 'The disclaimer could not be accepted. Please try again.', 'error');
      }
    });
    const back = makeButton('Return to preview');
    back.addEventListener('click', () => renderPreview());
    actions.append(accept, back);

    const status = element('p', 'bf26-status', message);
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    copy.append(disclosure, consent, actions, status);
    centered.append(copy);
    replaceView(centered, 'consent');
    checkbox.focus({ preventScroll: true });
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
    if (!Array.isArray(payload.questions) || payload.questions.length !== REQUIRED_QUESTION_COUNT) {
      throw new Error('The forecast must contain exactly 20 questions. No partial simulation was opened.');
    }

    const ids = new Set();
    const numbers = new Set();
    const questions = payload.questions.map((question) => {
      const id = String(question?.id || '').trim();
      const number = Number(question?.number);
      const prompt = String(question?.prompt || '').trim();
      if (!id || ids.has(id) || !Number.isInteger(number)
          || number < 1 || number > REQUIRED_QUESTION_COUNT || numbers.has(number) || !prompt) {
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
      state.questions = normalizeQuestions(payload, subjectName);
      state.subject = subjectName;
      state.schedule = payload.schedule || null;
      state.answers = new Map(state.questions.map((question) => [question.id, '']));
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
    nav.append(
      element('h2', '', 'Questions'),
      element('p', '', 'Blue circles mark answers that meet the 10-word minimum. Gold marks the current question.'),
    );
    const questionList = element('div', 'bf26-question-list');
    const jumpButtons = state.questions.map((question, index) => {
      const jump = makeButton(String(question.number), 'bf26-question-jump');
      jump.setAttribute('aria-label', `Go to question ${question.number}`);
      jump.addEventListener('click', () => {
        state.currentIndex = index;
        syncExam(true);
      });
      questionList.append(jump);
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
    const prompt = element('p', 'bf26-prompt');
    promptPanel.append(questionLabel, prompt);
    const answerPanel = element('section', 'bf26-answer-panel');
    const answerLabel = element('label', '', 'Your answer');
    answerLabel.htmlFor = 'bf26-current-answer';
    const textarea = element('textarea', 'bf26-answer');
    textarea.id = 'bf26-current-answer';
    textarea.maxLength = 6000;
    textarea.spellcheck = true;
    textarea.autocomplete = 'off';
    const count = element('p', 'bf26-word-count');
    answerPanel.append(answerLabel, textarea, count);
    workspace.append(promptPanel, answerPanel);

    const footer = element('footer', 'bf26-exam-footer');
    const status = element('p', 'bf26-status');
    status.dataset.bf26Status = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'bf26-actions');
    const previous = makeButton('Previous');
    const next = makeButton('Next');
    const submit = makeButton('Submit all answers', 'bf26-button bf26-button--primary');
    previous.addEventListener('click', () => {
      if (state.currentIndex <= 0) return;
      state.currentIndex -= 1;
      syncExam(true);
    });
    next.addEventListener('click', () => {
      if (state.currentIndex >= state.questions.length - 1) return;
      state.currentIndex += 1;
      syncExam(true);
    });
    submit.addEventListener('click', submitForecast);
    actions.append(previous, next, submit);
    footer.append(status, actions);
    main.append(meta, workspace, footer);
    exam.append(nav, main);

    replaceView(exam, 'exam');
    state.examRefs = {
      jumpButtons,
      metaSubject: metaSubject.querySelector('strong'),
      metaSchedule: metaSubject.querySelector('span'),
      metaQuestion: metaProgress.querySelector('strong'),
      metaProgress: metaProgress.querySelector('span'),
      questionLabel,
      prompt,
      textarea,
      count,
      previous,
      next,
      submit,
      status,
    };
    textarea.addEventListener('input', () => {
      const current = state.questions[state.currentIndex];
      if (!current) return;
      state.answers.set(current.id, textarea.value);
      syncExamCompletion();
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
    refs.prompt.textContent = question.prompt;
    refs.textarea.value = state.answers.get(question.id) || '';
    refs.textarea.setAttribute('aria-label', `Your answer to question ${question.number}`);
    refs.previous.disabled = state.currentIndex === 0;
    refs.next.disabled = state.currentIndex === state.questions.length - 1;
    syncExamCompletion();
    if (focusAnswer) refs.textarea.focus({ preventScroll: true });
  }

  function syncExamCompletion() {
    const refs = state.examRefs;
    const question = state.questions[state.currentIndex];
    if (!refs || !question) return;
    const currentWords = wordCount(state.answers.get(question.id));
    const completeCount = completedAnswerCount();
    refs.count.textContent = `${currentWords} words · minimum ${MINIMUM_WORDS}`;
    refs.count.classList.toggle('is-complete', currentWords >= MINIMUM_WORDS);
    refs.metaProgress.textContent = `${completeCount} of ${REQUIRED_QUESTION_COUNT} answers meet the minimum`;
    refs.status.textContent = allAnswersComplete()
      ? 'All answers are ready for final submission.'
      : `${REQUIRED_QUESTION_COUNT - completeCount} answer${REQUIRED_QUESTION_COUNT - completeCount === 1 ? '' : 's'} still need at least ${MINIMUM_WORDS} words.`;
    refs.submit.disabled = !allAnswersComplete();
    state.questions.forEach((entry, index) => {
      const jump = refs.jumpButtons[index];
      const complete = wordCount(state.answers.get(entry.id)) >= MINIMUM_WORDS;
      jump.classList.toggle('is-complete', complete);
      if (index === state.currentIndex) jump.setAttribute('aria-current', 'step');
      else jump.removeAttribute('aria-current');
      jump.setAttribute(
        'aria-label',
        `Go to question ${entry.number}${complete ? ', minimum reached' : ', answer incomplete'}`,
      );
    });
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

  function appendResultSection(parent, heading, value) {
    const section = element('section', 'bf26-result-section');
    section.append(element('h4', '', heading), element('p', '', value));
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
      appendResultSection(body, 'Your answer', result.userAnswer);
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
      state.questions = [];
      state.answers = new Map();
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
    state.root.hidden = true;
    isolatePage(false);
    resetProtectedState();
    if (options.restoreRoute !== false) restoreForecastRoute();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    return true;
  }

  async function openForecast(trigger = null) {
    ensureRoot();
    state.lastTrigger = trigger instanceof Element ? trigger : document.activeElement;
    if (!state.isOpen) {
      state.isOpen = true;
      setForecastRoute();
      isolatePage(true);
      state.root.hidden = false;
    }
    renderPreview({
      message: runtimeOwnerId()
        ? 'Checking whether this signed-in account is authorized…'
        : 'Administrator access is not available for this signed-out or unresolved session.',
      checking: Boolean(runtimeOwnerId()),
    });
    requestAnimationFrame(() => state.dialog?.focus({ preventScroll: true }));
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

  global.addEventListener('popstate', () => {
    if (state.isOpen && location.hash !== ROUTE) closeForecast({ force: true, restoreRoute: false });
  });
  global.addEventListener('hashchange', () => {
    if (state.isOpen && location.hash !== ROUTE) closeForecast({ force: true, restoreRoute: false });
  });

  global.openBarForecast = openForecast;
  global.DueDiligenceBarForecast = Object.freeze({
    open: openForecast,
    close: closeForecast,
  });
})(window);
