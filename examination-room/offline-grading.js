(function (global) {
  'use strict';

  const core = global.DueDiligenceOfflineGradingCore;
  const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
  const DATABASE_NAME = 'duediligence-offline-grading-v1';
  const DATABASE_VERSION = 1;
  const STORE_NAME = 'drafts';

  const state = {
    file: null,
    wrapper: null,
    payload: null,
    model: null,
    passphrase: '',
    draft: null,
    selectedSessionId: null,
    search: '',
    database: null,
    autosaveTimer: null,
    toastTimer: null,
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initialize);

  function registerExaminationRoomServiceWorker() {
    const serviceWorker = global.navigator?.serviceWorker;
    if (!serviceWorker?.register) return;
    serviceWorker.register('/service-worker.js?v=commercial-readiness-profile-analytics-offline-paid-expiry-20260827-1').catch(() => {
      // The grading workspace is already self-contained. Registration simply
      // refreshes the offline cache the next time a connection is available.
    });
  }

  function initialize() {
    if (!core) {
      document.body.textContent = 'The offline grading workspace could not load. Reopen the page from the Examination Room.';
      return;
    }
    cacheElements();
    bindEvents();
    registerExaminationRoomServiceWorker();
    updateConnectionState();
    openDatabase().then((database) => { state.database = database; }).catch(() => { state.database = null; });
  }

  function cacheElements() {
    [
      'connection-state', 'connection-label', 'welcome-view', 'unlock-form', 'package-file',
      'file-label', 'package-passphrase', 'unlock-error', 'unlock-button', 'workspace',
      'workspace-title', 'workspace-meta', 'save-state', 'choose-another', 'export-package',
      'show-instructions', 'student-list', 'pseudonym-toggle', 'student-search',
      'student-name', 'student-detail', 'student-progress', 'workspace-error', 'question-grades',
      'summary-students', 'summary-complete', 'summary-remaining', 'summary-identity',
      'clear-local-draft', 'instructions-dialog', 'close-instructions', 'toast',
    ].forEach((id) => { elements[id] = document.getElementById(id); });
  }

  function bindEvents() {
    elements['package-file'].addEventListener('change', handleFileSelection);
    elements['unlock-form'].addEventListener('submit', unlockPackage);
    elements['choose-another'].addEventListener('click', chooseAnotherPackage);
    elements['export-package'].addEventListener('click', exportGradedPackage);
    elements['pseudonym-toggle'].addEventListener('change', togglePseudonyms);
    elements['student-search'].addEventListener('input', (event) => {
      state.search = event.target.value.trim().toLocaleLowerCase();
      renderStudentList();
    });
    elements['student-list'].addEventListener('click', (event) => {
      const button = event.target.closest('[data-session-id]');
      if (!button) return;
      state.selectedSessionId = button.dataset.sessionId;
      renderWorkspace();
    });
    elements['question-grades'].addEventListener('input', handleGradeInput);
    elements['question-grades'].addEventListener('blur', handleGradeBlur, true);
    elements['clear-local-draft'].addEventListener('click', clearLocalDraft);
    elements['show-instructions'].addEventListener('click', () => elements['instructions-dialog'].showModal());
    elements['close-instructions'].addEventListener('click', () => elements['instructions-dialog'].close());
    global.addEventListener('online', updateConnectionState);
    global.addEventListener('offline', updateConnectionState);
  }

  function updateConnectionState() {
    const offline = global.navigator.onLine === false;
    elements['connection-state'].classList.toggle('is-offline', offline);
    elements['connection-label'].textContent = offline ? 'Working offline' : 'Offline-ready';
  }

  function handleFileSelection(event) {
    const file = event.target.files?.[0] || null;
    state.file = file;
    elements['file-label'].textContent = file ? file.name : 'Select .ddgrade.json';
    clearError(elements['unlock-error']);
  }

  async function unlockPackage(event) {
    event.preventDefault();
    clearError(elements['unlock-error']);
    const file = state.file || elements['package-file'].files?.[0];
    const passphrase = elements['package-passphrase'].value;
    if (!file) return showError(elements['unlock-error'], 'Choose the encrypted .ddgrade.json file first.');
    if (file.size > MAX_PACKAGE_BYTES) return showError(elements['unlock-error'], 'That file is larger than 20 MB. Choose the original Due Diligence grading package.');
    if (passphrase.length < 12) return showError(elements['unlock-error'], 'Enter the passphrase created when the grading copy was downloaded.');

    setButtonBusy(elements['unlock-button'], true, 'Unlocking…');
    try {
      const wrapper = JSON.parse(await file.text());
      const payload = await core.decryptWrapper(wrapper, passphrase, global.crypto);
      const model = core.buildModel(payload);
      const saved = await readDraft(draftId(payload));
      state.file = file;
      state.wrapper = wrapper;
      state.payload = payload;
      state.model = model;
      state.passphrase = passphrase;
      state.draft = core.normalizeDraft(saved, payload);
      state.selectedSessionId = model.sessions[0]?.id || null;
      state.search = '';
      elements['student-search'].value = '';
      elements['pseudonym-toggle'].checked = state.draft.usePseudonyms;
      elements['welcome-view'].hidden = true;
      elements.workspace.hidden = false;
      renderWorkspace();
      elements['workspace-title'].focus?.();
      if (saved?.updatedAt) toast(`Restored locally saved grades from ${formatDateTime(saved.updatedAt)}.`);
    } catch (error) {
      showError(elements['unlock-error'], 'The package could not be opened. Check the file and passphrase, then try again.');
    } finally {
      setButtonBusy(elements['unlock-button'], false);
    }
  }

  function renderWorkspace() {
    const { exam, sessions, questions } = state.model;
    const packageInfo = state.payload?.offlinePackage;
    const packageLabel = Number(packageInfo?.partCount) > 1
      ? ` · Package ${packageInfo.partNumber} of ${packageInfo.partCount}`
      : '';
    elements['workspace-title'].textContent = exam.title;
    elements['workspace-meta'].textContent = `${sessions.length} submitted student${sessions.length === 1 ? '' : 's'} · ${questions.length} question${questions.length === 1 ? '' : 's'} · Version ${shortId(exam.versionId)}${packageLabel}`;
    renderStudentList();
    renderCurrentStudent();
    renderSummary();
  }

  function renderStudentList() {
    const fragment = document.createDocumentFragment();
    const query = state.search;
    const visible = state.model.sessions.map((session, index) => ({ session, index })).filter(({ session, index }) => {
      if (!query) return true;
      const identity = core.displayIdentity(session, index, state.draft.usePseudonyms);
      return `${identity.name} ${session.studentNumber}`.toLocaleLowerCase().includes(query);
    });

    visible.forEach(({ session, index }) => {
      const identity = core.displayIdentity(session, index, state.draft.usePseudonyms);
      const count = gradedCountForSession(session.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `student-item${session.id === state.selectedSessionId ? ' is-active' : ''}`;
      button.dataset.sessionId = session.id;
      button.setAttribute('aria-pressed', session.id === state.selectedSessionId ? 'true' : 'false');
      button.append(
        makeElement('span', 'student-avatar', initials(identity.name)),
        makeElement('span', '', '', [
          makeElement('strong', '', identity.name),
          makeElement('small', '', state.draft.usePseudonyms ? identity.detail : (identity.detail || 'Student record')),
        ]),
        makeElement('span', 'grade-count', `${count}/${state.model.questions.length}`),
      );
      fragment.appendChild(button);
    });
    if (!visible.length) fragment.appendChild(makeElement('p', 'empty-list', 'No student matches that search.'));
    elements['student-list'].replaceChildren(fragment);
  }

  function renderCurrentStudent() {
    const sessionIndex = state.model.sessions.findIndex((session) => session.id === state.selectedSessionId);
    const session = state.model.sessions[sessionIndex];
    if (!session) {
      elements['student-name'].textContent = 'No submitted students';
      elements['student-detail'].textContent = 'A grading package needs at least one submitted answer file.';
      elements['student-progress'].textContent = `0 / ${state.model.questions.length}`;
      elements['question-grades'].replaceChildren(makeElement('p', 'empty-list', 'No submitted answer files are available in this package.'));
      return;
    }

    const identity = core.displayIdentity(session, sessionIndex, state.draft.usePseudonyms);
    elements['student-name'].textContent = identity.name;
    elements['student-detail'].textContent = identity.detail || 'Student record';
    elements['student-progress'].textContent = `${gradedCountForSession(session.id)} / ${state.model.questions.length}`;
    clearError(elements['workspace-error']);

    const fragment = document.createDocumentFragment();
    state.model.questions.forEach((question, questionIndex) => {
      const key = core.pairKey(session.id, question.id);
      const answerRevision = state.model.answers.get(key);
      const existingGrade = state.model.grades.get(key) || {};
      const draftGrade = Object.prototype.hasOwnProperty.call(state.draft.grades, key) ? state.draft.grades[key] : null;
      const points = draftGrade ? draftGrade.points : (existingGrade.points ?? '');
      const feedback = draftGrade ? draftGrade.feedback : (existingGrade.feedback || '');
      fragment.appendChild(buildGradeCard({ session, question, questionIndex, key, answerRevision, points, feedback }));
    });
    elements['question-grades'].replaceChildren(fragment);
  }

  function buildGradeCard({ question, questionIndex, key, answerRevision, points, feedback }) {
    const card = makeElement('article', 'grade-card');
    card.dataset.gradeKey = key;
    card.dataset.maximum = String(question.points);

    const header = makeElement('header');
    header.append(makeElement('h3', '', `Question ${questionIndex + 1}`), makeElement('strong', '', `${question.points} points`));
    const prompt = makeElement('p', 'question-prompt', question.prompt);
    const answer = makeElement('div', 'answer-box', core.answerText(answerRevision?.answer, question));

    const pointsId = `points-${questionIndex}`;
    const feedbackId = `feedback-${questionIndex}`;
    const pointsLabel = makeElement('label');
    pointsLabel.htmlFor = pointsId;
    pointsLabel.append(makeElement('span', '', 'Points awarded'));
    const pointsInput = document.createElement('input');
    pointsInput.id = pointsId;
    pointsInput.type = 'number';
    pointsInput.min = '0';
    pointsInput.max = String(question.points);
    pointsInput.step = '0.5';
    pointsInput.value = points;
    pointsInput.dataset.gradePoints = '';
    pointsInput.setAttribute('aria-describedby', `${pointsId}-error`);
    const pointsError = makeElement('small', 'input-error', '');
    pointsError.id = `${pointsId}-error`;
    pointsLabel.append(pointsInput, pointsError);

    const feedbackLabel = makeElement('label');
    feedbackLabel.htmlFor = feedbackId;
    feedbackLabel.append(makeElement('span', '', 'Professor feedback'));
    const feedbackInput = document.createElement('textarea');
    feedbackInput.id = feedbackId;
    feedbackInput.maxLength = core.MAX_FEEDBACK_LENGTH;
    feedbackInput.value = feedback;
    feedbackInput.dataset.gradeFeedback = '';
    feedbackLabel.appendChild(feedbackInput);

    const entry = makeElement('div', 'grade-entry');
    entry.append(pointsLabel, feedbackLabel);
    card.append(header, prompt, answer, entry);
    validateGradeCard(card);
    return card;
  }

  function handleGradeInput(event) {
    if (!event.target.matches('[data-grade-points], [data-grade-feedback]')) return;
    const card = event.target.closest('[data-grade-key]');
    const key = card.dataset.gradeKey;
    state.draft.grades[key] = {
      points: card.querySelector('[data-grade-points]').value,
      feedback: card.querySelector('[data-grade-feedback]').value,
    };
    validateGradeCard(card);
    scheduleAutosave();
    renderProgressWithoutSheet();
  }

  function handleGradeBlur(event) {
    if (!event.target.matches('[data-grade-points], [data-grade-feedback]')) return;
    validateGradeCard(event.target.closest('[data-grade-key]'));
  }

  function validateGradeCard(card) {
    const pointsInput = card.querySelector('[data-grade-points]');
    const feedbackInput = card.querySelector('[data-grade-feedback]');
    const result = core.validateGrade(pointsInput.value, feedbackInput.value, Number(card.dataset.maximum));
    const error = card.querySelector('.input-error');
    error.textContent = result.error;
    pointsInput.setAttribute('aria-invalid', result.error ? 'true' : 'false');
    card.classList.toggle('has-error', Boolean(result.error));
    return result;
  }

  function renderProgressWithoutSheet() {
    const session = state.model.sessions.find((entry) => entry.id === state.selectedSessionId);
    if (session) elements['student-progress'].textContent = `${gradedCountForSession(session.id)} / ${state.model.questions.length}`;
    renderSummary();
    renderStudentList();
  }

  function gradedCountForSession(sessionId) {
    let complete = 0;
    state.model.questions.forEach((question) => {
      const key = core.pairKey(sessionId, question.id);
      const value = Object.prototype.hasOwnProperty.call(state.draft.grades, key)
        ? state.draft.grades[key]
        : state.model.grades.get(key);
      if (value && core.validateGrade(value.points, value.feedback, question.points).complete) complete += 1;
    });
    return complete;
  }

  function renderSummary() {
    const progress = core.gradingProgress(state.model, state.draft);
    elements['summary-students'].textContent = String(state.model.sessions.length);
    elements['summary-complete'].textContent = `${progress.complete} / ${progress.total}`;
    elements['summary-remaining'].textContent = String(progress.remaining);
    elements['summary-identity'].textContent = state.draft.usePseudonyms ? 'Pseudonyms' : 'Real names';
  }

  function togglePseudonyms(event) {
    state.draft.usePseudonyms = event.target.checked;
    scheduleAutosave();
    renderWorkspace();
    toast(state.draft.usePseudonyms ? 'Pseudonyms are shown only in this grading view.' : 'Real student names are visible again.');
  }

  function scheduleAutosave() {
    state.draft.updatedAt = new Date().toISOString();
    elements['save-state'].textContent = 'Saving on this device…';
    elements['save-state'].className = 'save-state is-saving';
    global.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = global.setTimeout(saveDraftNow, 180);
  }

  async function saveDraftNow() {
    if (!state.payload || !state.draft) return;
    try {
      await writeDraft({ ...state.draft, id: draftId(state.payload) });
      elements['save-state'].textContent = 'Saved on this device';
      elements['save-state'].className = 'save-state';
    } catch (_) {
      elements['save-state'].textContent = 'Could not save locally — export now';
      elements['save-state'].className = 'save-state is-error';
    }
  }

  async function exportGradedPackage() {
    clearError(elements['workspace-error']);
    const invalid = [...elements['question-grades'].querySelectorAll('.grade-card')].find((card) => validateGradeCard(card).error);
    if (invalid) {
      invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      invalid.querySelector('[data-grade-points]')?.focus();
      showError(elements['workspace-error'], 'One or more point values need attention. Correct the highlighted field, then export again.');
      return;
    }
    setButtonBusy(elements['export-package'], true, 'Encrypting…');
    try {
      await saveDraftNow();
      const merged = core.appendOfflineGradeRevisions(
        state.payload,
        state.draft,
        new Date().toISOString(),
        global.crypto.randomUUID(),
      );
      if (merged.added === 0) {
        showError(elements['workspace-error'], 'No new grade changes were found. Change at least one point value or feedback entry before exporting a new graded copy.');
        return;
      }
      const projectedPlaintextLimit = Math.floor((MAX_PACKAGE_BYTES - 4096) * 0.74);
      const parts = core.splitOfflineGradeImportPayload(merged.payload, projectedPlaintextLimit, core.MAX_IMPORT_GRADES);
      const width = Math.max(2, String(parts.length).length);
      for (let index = 0; index < parts.length; index += 1) {
        const wrapper = await core.encryptPayload(parts[index], state.passphrase, global.crypto);
        if (new Blob([JSON.stringify(wrapper, null, 2)], { type: 'application/json' }).size > MAX_PACKAGE_BYTES) {
          throw new Error('A numbered graded file exceeded the safe import limit.');
        }
        const suffix = parts.length > 1
          ? `-part-${String(index + 1).padStart(width, '0')}-of-${String(parts.length).padStart(width, '0')}`
          : '';
        downloadJson(`${safeFilename(state.model.exam.title)}-graded${suffix}.ddgrade.json`, wrapper);
      }
      toast(parts.length > 1
        ? `${merged.added} grade changes exported in ${parts.length} numbered files. Select all of them together on the online Professor Grade page.`
        : `${merged.added} offline grade revision${merged.added === 1 ? '' : 's'} exported. Import this file in the online Professor Grade page.`);
      elements['instructions-dialog'].showModal();
    } catch (error) {
      showError(elements['workspace-error'], error?.message || 'The graded copy could not be encrypted. Keep this page open, then try Export graded copy again.');
    } finally {
      setButtonBusy(elements['export-package'], false);
    }
  }

  async function clearLocalDraft() {
    if (!global.confirm('Clear the locally autosaved grade changes for this examination? The original encrypted package will not be changed.')) return;
    await deleteDraft(draftId(state.payload));
    state.draft = core.normalizeDraft(null, state.payload);
    elements['pseudonym-toggle'].checked = false;
    renderWorkspace();
    toast('Local grade draft cleared. The original encrypted package is unchanged.');
  }

  async function chooseAnotherPackage() {
    global.clearTimeout(state.autosaveTimer);
    if (state.payload && state.draft) await saveDraftNow();
    state.file = null;
    state.wrapper = null;
    state.payload = null;
    state.model = null;
    state.passphrase = '';
    state.draft = null;
    state.selectedSessionId = null;
    elements['package-file'].value = '';
    elements['package-passphrase'].value = '';
    elements['file-label'].textContent = 'Select .ddgrade.json';
    elements.workspace.hidden = true;
    elements['welcome-view'].hidden = false;
    elements['package-file'].focus();
  }

  function draftId(payload) {
    const packageInfo = payload?.offlinePackage;
    const packageSuffix = packageInfo?.setId
      ? `:${packageInfo.setId}:${packageInfo.partNumber || 1}`
      : '';
    return `${payload.exam.id}:${payload.exam.versionId}${packageSuffix}`;
  }

  function openDatabase() {
    if (!('indexedDB' in global)) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function databaseOperation(mode, action) {
    if (!state.database) return Promise.reject(new Error('Local database unavailable'));
    return new Promise((resolve, reject) => {
      const transaction = state.database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readDraft(id) {
    try {
      if (!state.database) state.database = await openDatabase();
      return await databaseOperation('readonly', (store) => store.get(id));
    } catch (_) {
      try { return JSON.parse(global.localStorage.getItem(`ddgrade:${id}`) || 'null'); } catch (_) { return null; }
    }
  }

  async function writeDraft(draft) {
    try {
      if (!state.database) state.database = await openDatabase();
      await databaseOperation('readwrite', (store) => store.put(draft));
    } catch (_) {
      global.localStorage.setItem(`ddgrade:${draft.id}`, JSON.stringify(draft));
    }
  }

  async function deleteDraft(id) {
    try {
      if (!state.database) state.database = await openDatabase();
      await databaseOperation('readwrite', (store) => store.delete(id));
    } catch (_) { /* The local fallback is still cleared below. */ }
    try { global.localStorage.removeItem(`ddgrade:${id}`); } catch (_) { /* Ignore unavailable fallback storage. */ }
  }

  function makeElement(tag, className, value, children) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value) element.textContent = value;
    (children || []).forEach((child) => element.appendChild(child));
    return element;
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'ST';
  }

  function shortId(value) {
    const result = String(value || '');
    return result.length > 12 ? `${result.slice(0, 8)}…` : result;
  }

  function safeFilename(value) {
    return String(value || 'examination').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'examination';
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'an earlier session' : date.toLocaleString();
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setButtonBusy(button, busy, label) {
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
      delete button.dataset.originalLabel;
    }
  }

  function showError(element, message) {
    element.hidden = false;
    element.textContent = message;
  }

  function clearError(element) {
    element.hidden = true;
    element.textContent = '';
  }

  function toast(message) {
    global.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = global.setTimeout(() => { elements.toast.hidden = true; }, 5200);
  }
})(window);
