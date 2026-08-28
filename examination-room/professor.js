(function professorExaminationRoom(global) {
  'use strict';

  const api = global.ExaminationRoomV1Api;
  const viewModels = global.ExaminationRoomV1ViewModels;
  const offlineGradingCore = global.DueDiligenceOfflineGradingCore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    professor: null,
    exam: null,
    examSummaries: [],
    serverExamIds: new Set(),
    activation: null,
    questions: [],
    roster: [],
    currentView: 'overview',
    saveTimer: null,
    saveInFlight: null,
    lastSavedJson: '',
    serverBaselineFingerprint: null,
    retryAction: null,
    monitor: null,
    monitorTimer: null,
    monitorPollInFlight: null,
    monitorPollGeneration: 0,
    monitorAbortController: null,
    activationTimer: null,
    activationPollInFlight: false,
    activationPollAttempt: 0,
    activationPollStartedAt: 0,
    activationPollExamId: '',
    activationPollingExpired: false,
    activationAbortController: null,
    activationAnnounced: false,
    grading: null,
    selectedGradingSessionId: null,
    selectedReleaseIds: new Set(),
    releaseSelectionSeenIds: new Set(),
    anonymousGrading: false,
    sectionObserver: null,
    hydrating: false,
    textEntryResolve: null,
    confirmationResolve: null,
    offlineWorkspaceReady: Promise.resolve(false),
    revokingSessions: new Set(),
    assistantHistory: [],
    assistantInFlight: false,
    overviewActionInFlight: false,
  };

  const DRAFT_STORAGE_KEY = 'duediligence.examination-room.v1.professor-draft';
  const DRAFT_ACTIVE_KEY = 'duediligence.examination-room.v1.professor-active-draft';
  const DRAFT_INDEX_KEY = 'duediligence.examination-room.v1.professor-draft-index';
  const DRAFT_FALLBACK_PREFIX = 'duediligence.examination-room.v1.professor-draft.';
  const MAX_OFFLINE_PACKAGE_BYTES = 20 * 1024 * 1024;
  const INDEXED_DB_OPEN_TIMEOUT_MS = 5000;
  const MONITOR_POLL_INTERVAL_MS = 5000;
  const MONITOR_HIDDEN_POLL_INTERVAL_MS = 15_000;
  const ACTIVATION_POLL_BASE_DELAY_MS = 4500;
  const ACTIVATION_POLL_MAX_DELAY_MS = 60_000;
  const ACTIVATION_POLL_HIDDEN_MIN_DELAY_MS = 30_000;
  const ACTIVATION_POLL_LIFETIME_MS = 30 * 60_000;
  const QUESTION_TYPES = Object.freeze({
    essay: 'Essay',
    short_answer: 'Short answer',
    multiple_choice: 'Multiple choice',
  });

  function registerExaminationRoomServiceWorker() {
    const serviceWorker = global.navigator?.serviceWorker;
    if (!serviceWorker?.register) return Promise.resolve(false);
    return serviceWorker.register('/service-worker.js?v=examination-room-reliability-20260828-1')
      .then(() => Promise.race([
        serviceWorker.ready.then(() => true),
        new Promise((resolve) => global.setTimeout(() => resolve(false), 5000)),
      ]))
      .catch(() => false);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function safeText(value, maximum = 5000) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maximum);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDateTime(value) {
    if (!value) return 'Not set';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not set';
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }).format(date);
  }

  function timeAgo(value) {
    const elapsed = Date.now() - new Date(value || 0).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 0) return 'just now';
    if (elapsed < 45_000) return 'just now';
    if (elapsed < 90_000) return '1 minute ago';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} minutes ago`;
    return formatDateTime(value);
  }

  function initials(name) {
    return String(name || 'Student')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.classList.remove('is-visible'), 3600);
  }

  function showError(error, retryAction = null, title = 'Action not completed', scope = '') {
    const node = $('#error-banner');
    node.dataset.errorScope = safeText(scope, 80);
    $('#error-title').textContent = title;
    $('#error-message').textContent = error?.message || 'Examination Room could not complete that action.';
    $('#error-recovery').textContent = error?.recovery || 'Your work on this device is preserved. Check your connection, then try again.';
    state.retryAction = retryAction;
    $('#error-retry').hidden = typeof retryAction !== 'function';
    node.hidden = false;
  }

  function dismissError() {
    const node = $('#error-banner');
    node.hidden = true;
    delete node.dataset.errorScope;
    state.retryAction = null;
  }

  function dismissErrorScope(scope) {
    const node = $('#error-banner');
    if (!node.hidden && node.dataset.errorScope === scope) dismissError();
  }

  function setButtonBusy(button, busy, busyLabel = 'Working…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="ph ph-spinner-gap" aria-hidden="true"></i><span>${escapeHtml(busyLabel)}</span>`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function finishTextEntry(value) {
    const resolve = state.textEntryResolve;
    state.textEntryResolve = null;
    closeDialog('text-entry-dialog');
    resolve?.(value);
  }

  function requestText({
    eyebrow = 'Secure entry', title, copy, label, help = '', type = 'text',
    autocomplete = 'off', placeholder = '', minimumLength = 0, submitLabel = 'Continue',
  }) {
    if (state.textEntryResolve) finishTextEntry(null);
    $('#text-entry-eyebrow').textContent = eyebrow;
    $('#text-entry-title').textContent = title;
    $('#text-entry-copy').textContent = copy;
    $('#text-entry-label').textContent = label;
    $('#text-entry-help span').textContent = help;
    $('#text-entry-help').hidden = !help;
    $('#text-entry-submit').textContent = submitLabel;
    const input = $('#text-entry-input');
    input.type = type;
    input.autocomplete = autocomplete;
    input.placeholder = placeholder;
    input.minLength = minimumLength;
    input.value = '';
    openDialog('text-entry-dialog');
    requestAnimationFrame(() => input.focus());
    return new Promise((resolve) => { state.textEntryResolve = resolve; });
  }

  function finishConfirmation(confirmed) {
    const resolve = state.confirmationResolve;
    state.confirmationResolve = null;
    closeDialog('confirmation-dialog');
    resolve?.(confirmed === true);
  }

  function requestConfirmation({
    eyebrow = 'Confirm action', title, copy, help = '', confirmLabel = 'Continue', cancelLabel = 'Cancel',
  }) {
    if (state.confirmationResolve) finishConfirmation(false);
    $('#confirmation-eyebrow').textContent = eyebrow;
    $('#confirmation-title').textContent = title;
    $('#confirmation-copy').textContent = copy;
    $('#confirmation-help span').textContent = help;
    $('#confirmation-help').hidden = !help;
    $('#confirmation-confirm').textContent = confirmLabel;
    $('#confirmation-cancel').textContent = cancelLabel;
    const form = $('#confirmation-form');
    const dialog = $('#confirmation-dialog');
    form.onsubmit = (event) => { event.preventDefault(); finishConfirmation(true); };
    $('#confirmation-close').onclick = () => finishConfirmation(false);
    $('#confirmation-cancel').onclick = () => finishConfirmation(false);
    dialog.oncancel = (event) => { event.preventDefault(); finishConfirmation(false); };
    openDialog('confirmation-dialog');
    requestAnimationFrame(() => $('#confirmation-confirm').focus());
    return new Promise((resolve) => { state.confirmationResolve = resolve; });
  }

  function editorQuestionType(value) {
    const normalized = String(value || 'essay').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return QUESTION_TYPES[normalized] ? normalized : 'essay';
  }

  function editorChoiceLabel(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return safeText(value.label, 500);
    return safeText(value, 500);
  }

  function clientOnlyBlankDraft(institutionId) {
    return {
      id: global.crypto.randomUUID(),
      institutionId: safeText(institutionId, 80) || null,
      versionId: null,
      status: 'draft',
      title: '',
      subject: '',
      jurisdiction: 'Philippines',
      yearLevel: 'Second year',
      instructions: '',
      courseCode: '',
      durationMinutes: 120,
      startsAt: null,
      lateSubmissions: 'not_allowed',
      navigation: 'free',
      gradingIdentity: 'real_names',
      integrityTier: 'standard',
      cameraRequired: false,
      microphoneRequired: false,
      privacyNoticeVersion: 'exam-room-v1',
      privacyController: '',
      retentionSummary: '',
      admissionMode: 'key_only',
      allowedEmails: [],
      sourceFileName: null,
      sourceFileSize: null,
      questions: [],
      roster: [],
      updatedAt: null,
    };
  }

  function examContentFingerprint(exam) {
    const comparable = {
      id: safeText(exam?.id || exam?.examId, 80),
      versionId: safeText(exam?.versionId || exam?.currentPublishedVersionId, 80),
      status: safeText(exam?.status, 40),
      title: safeText(exam?.title, 180),
      subject: safeText(exam?.subject, 120),
      jurisdiction: safeText(exam?.jurisdiction, 80),
      yearLevel: safeText(exam?.yearLevel, 80),
      instructions: safeText(exam?.instructions, 10_000),
      courseCode: safeText(exam?.courseCode, 40),
      durationMinutes: Number(exam?.durationMinutes || 0),
      startsAt: exam?.startsAt || null,
      lateSubmissions: safeText(exam?.lateSubmissions, 40),
      navigation: safeText(exam?.navigation, 40),
      gradingIdentity: safeText(exam?.gradingIdentity || exam?.identityMode, 40),
      integrityTier: safeText(exam?.integrityTier, 40),
      cameraRequired: exam?.cameraRequired === true,
      microphoneRequired: exam?.microphoneRequired === true,
      admissionMode: safeText(exam?.admissionMode, 40) || 'key_only',
      allowedEmails: normalizeAllowedEmails(exam?.allowedEmails),
      questions: (exam?.questions || []).map((question) => ({
        id: safeText(question?.id || question?.questionKey, 80),
        type: safeText(question?.type || question?.questionKind, 40),
        points: Number(question?.points || 0),
        prompt: safeText(question?.prompt, 20_000),
        options: (question?.options || question?.choices || []).map(editorChoiceLabel),
        correctOption: Number(question?.correctOption ?? question?.correctOptionIndex ?? -1),
        wordGuideline: safeText(question?.wordGuideline || question?.wordLimit, 100),
        required: question?.required !== false,
      })),
      roster: (exam?.roster || []).map((student) => ({
        id: safeText(student?.id, 80),
        fullName: safeText(student?.fullName, 160),
        studentNumber: safeText(student?.studentNumber, 48),
        email: safeText(student?.email, 320),
        yearLevel: safeText(student?.yearLevel, 80),
        extraMinutes: Number(student?.extraMinutes || 0),
      })),
    };
    const serialized = JSON.stringify(comparable);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
    }
    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
  }

  function examSummaryId(summary) {
    return safeText(summary?.id || summary?.examId, 80);
  }

  function examSummariesFromSession(result) {
    const candidates = Array.isArray(result?.exams) ? result.exams : [];
    const fallback = result?.exam && typeof result.exam === 'object' ? [result.exam] : [];
    const seen = new Set();
    return [...candidates, ...fallback].filter((summary) => {
      const id = examSummaryId(summary);
      const lifecycle = safeText(summary?.lifecycleState || summary?.status, 40).toLowerCase();
      if (!id || seen.has(id) || summary?.deletedAt || lifecycle === 'archived') return false;
      seen.add(id);
      return true;
    });
  }

  function overviewExamItems(summaries) {
    return examSummariesFromSession({ exams: Array.isArray(summaries) ? summaries : [] });
  }

  function overviewStatusPresentation(summary) {
    const status = safeText(summary?.lifecycleState || summary?.status, 40).toLowerCase();
    if (status === 'draft') return { tone: 'draft', label: 'Draft', help: 'Ready to continue editing' };
    if (['published', 'key_requested', 'awaiting_approval', 'awaiting_activation', 'requested', 'pending'].includes(status)) {
      return { tone: 'waiting', label: 'Waiting for Admin', help: 'Student key requested' };
    }
    if (['active', 'open', 'scheduled'].includes(status)) return { tone: 'active', label: 'Student key issued', help: 'Monitor and Grade are available' };
    if (status === 'grading') return { tone: 'active', label: 'Grading', help: 'Submissions are ready to review' };
    if (status === 'results_released') return { tone: 'active', label: 'Results released', help: 'Results were sent to selected students' };
    if (status === 'blocked') return { tone: 'waiting', label: 'Blocked by Admin', help: 'Open the examination for recovery details' };
    return { tone: 'draft', label: 'Saved examination', help: 'Open to review its current state' };
  }

  function lifecycleOperationForExam(summary) {
    const status = safeText(summary?.lifecycleState || summary?.status, 40).toLowerCase();
    const hasPublishedRecord = Boolean(summary?.currentPublishedVersionId || summary?.publishedAt);
    return status === 'draft' && !hasPublishedRecord ? 'delete_draft' : 'archive_exam';
  }

  function summariesAfterRemoval(summaries, examId) {
    const id = safeText(examId, 80);
    return overviewExamItems(summaries).filter((summary) => examSummaryId(summary) !== id);
  }

  function renderExamOverview() {
    const list = $('#exam-overview-list');
    const empty = $('#exam-overview-empty');
    const count = $('#exam-overview-count');
    const deleteHelp = $('#overview-delete-help');
    if (!list || !empty || !count) return;
    const items = overviewExamItems(state.examSummaries);
    count.textContent = items.length === 1 ? '1 saved examination' : `${items.length} saved examinations`;
    empty.hidden = items.length > 0;
    list.hidden = items.length === 0;
    if (deleteHelp) deleteHelp.hidden = items.length === 0;
    list.innerHTML = items.map((summary) => {
      const id = examSummaryId(summary);
      const title = safeText(summary?.title, 180) || 'Untitled examination';
      const subject = safeText(summary?.subject, 120) || 'Subject not set';
      const status = overviewStatusPresentation(summary);
      const deleteLabel = lifecycleOperationForExam(summary) === 'delete_draft' ? 'Delete draft' : 'Delete examination';
      const current = id === examSummaryId(state.exam);
      return `<article class="exam-overview-row${current ? ' is-current' : ''}" data-overview-exam-id="${escapeHtml(id)}">
        <div class="exam-overview-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subject)}</p></div>
        <div class="exam-overview-status"><span class="exam-status-chip" data-status="${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span><small>${escapeHtml(status.help)}</small></div>
        <div class="exam-overview-actions">
          <button class="button primary overview-open" type="button" data-overview-action="open" data-exam-id="${escapeHtml(id)}"><i class="ph ph-pencil-simple-line" aria-hidden="true"></i>${current ? 'Continue' : 'Open'}</button>
          <button class="button secondary" type="button" data-overview-action="duplicate" data-exam-id="${escapeHtml(id)}"><i class="ph ph-copy" aria-hidden="true"></i>Duplicate</button>
          <button class="button overview-delete" type="button" data-overview-action="delete" data-exam-id="${escapeHtml(id)}"><i class="ph ph-trash" aria-hidden="true"></i>${escapeHtml(deleteLabel)}</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderExamSwitcher(summaries, currentExamId) {
    state.examSummaries = examSummariesFromSession({
      exams: Array.isArray(summaries) ? summaries : [],
    });
    const wrap = $('#exam-switcher-wrap');
    const select = $('#exam-switcher');
    renderExamOverview();
    if (!wrap || !select) return;
    wrap.hidden = state.examSummaries.length < 2;
    select.innerHTML = state.examSummaries.map((summary) => {
      const id = examSummaryId(summary);
      const label = safeText(summary?.title, 180) || 'Untitled examination';
      return `<option value="${escapeHtml(id)}" ${id === currentExamId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function examSummariesWithCurrentExam(summaries, exam) {
    const examId = examSummaryId(exam);
    if (!examId) return Array.isArray(summaries) ? summaries : [];
    const current = (Array.isArray(summaries) ? summaries : [])
      .find((summary) => examSummaryId(summary) === examId) || {};
    const nextSummary = {
      ...current,
      id: examId,
      title: safeText(exam?.title, 180),
      subject: safeText(exam?.subject || current?.subject, 120),
      status: safeText(exam?.status || current?.status, 40) || 'draft',
      currentPublishedVersionId: exam?.currentPublishedVersionId || current?.currentPublishedVersionId || null,
      publishedAt: exam?.publishedAt || current?.publishedAt || null,
      versionId: exam?.versionId || current?.versionId || null,
      updatedAt: exam?.updatedAt || current?.updatedAt || null,
    };
    const found = (Array.isArray(summaries) ? summaries : [])
      .some((summary) => examSummaryId(summary) === examId);
    return found
      ? summaries.map((summary) => (examSummaryId(summary) === examId ? nextSummary : summary))
      : [...(Array.isArray(summaries) ? summaries : []), nextSummary];
  }

  function syncCurrentExamSummary(exam) {
    const examId = examSummaryId(exam);
    if (!examId) return;
    renderExamSwitcher(examSummariesWithCurrentExam(state.examSummaries, exam), examId);
  }

  function navigateToExam(examId, view = state.currentView) {
    const id = safeText(examId, 80);
    if (!id) return;
    const next = new URL(global.location.href);
    next.searchParams.set('exam', id);
    next.searchParams.delete('reset');
    next.hash = `#${['create', 'monitor', 'grade'].includes(view) ? view : 'create'}`;
    global.location.assign(next.toString());
  }

  function replaceWorkspaceUrl(view) {
    if (!global.history?.replaceState) return;
    const next = new URL(global.location.href);
    next.searchParams.delete('reset');
    if (view === 'overview') next.searchParams.delete('exam');
    else if (examSummaryId(state.exam)) next.searchParams.set('exam', examSummaryId(state.exam));
    next.hash = `#${view}`;
    global.history.replaceState(null, '', next.toString());
  }

  function replaceCurrentExamUrl(examId, view = state.currentView) {
    const id = safeText(examId, 80);
    if (!id || !global.history?.replaceState) return;
    const next = new URL(global.location.href);
    next.searchParams.set('exam', id);
    next.searchParams.delete('reset');
    next.hash = `#${['create', 'monitor', 'grade'].includes(view) ? view : 'create'}`;
    global.history.replaceState(null, '', next.toString());
  }

  function duplicateDraft(source) {
    const draft = {
      ...clientOnlyBlankDraft(state.professor?.institutionId),
      ...JSON.parse(JSON.stringify(source || {})),
      id: global.crypto.randomUUID(),
      versionId: null,
      status: 'draft',
      title: `${safeText(source?.title, 170) || 'Untitled examination'} — Copy`,
      updatedAt: null,
      publishedAt: null,
      questions: (source?.questions || []).map((question, index) => normalizeQuestion({
        ...question,
        id: global.crypto.randomUUID(),
      }, index)),
      roster: (source?.roster || []).map((student, index) => normalizeRoster({
        ...student,
        id: global.crypto.randomUUID(),
      }, index)),
    };
    delete draft.activation;
    delete draft.currentPublishedVersionId;
    delete draft.submissions;
    delete draft.gradeRevisions;
    delete draft.releases;
    delete draft.publicationStatus;
    delete draft.version;
    delete draft.lifecycleState;
    delete draft.deletedAt;
    delete draft.deletedReason;
    delete draft.deleteReason;
    delete draft.blockedAt;
    delete draft.blockReason;
    delete draft.canRestore;
    delete draft.needsNewKey;
    return draft;
  }

  function isPristineDraft(exam) {
    return safeText(exam?.status, 40) === 'draft'
      && !safeText(exam?.title, 180)
      && !safeText(exam?.subject, 120)
      && !safeText(exam?.instructions, 10_000)
      && !safeText(exam?.sourceFileName, 255)
      && !(Array.isArray(exam?.questions) && exam.questions.length);
  }

  async function persistNewCreatorDraft(draft, { duplicate = false } = {}) {
    state.activation = null;
    state.activationAnnounced = false;
    state.monitor = null;
    state.grading = null;
    state.lastSavedJson = '';
    hydrateForm(draft);
    switchView('create');
    setSavedStatus('unsaved', duplicate ? 'Duplicate · not saved yet' : 'New draft · not saved yet');
    const result = await saveDraft({ force: true, announce: true });
    if (result.localOnly) {
      replaceCurrentExamUrl(draft.id, 'create');
      renderExamSwitcher(state.examSummaries, draft.id);
      toast(result.awaitingCompletion
        ? 'Fresh draft opened. Add a title and questions; server backup starts automatically as you work.'
        : 'The new draft is safe on this device. Choose Save draft to retry server backup.');
      return;
    }
    const savedExamId = examSummaryId(result.exam) || draft.id;
    state.serverExamIds.add(savedExamId);
    navigateToExam(savedExamId, 'create');
  }

  async function createAnotherExam({ duplicate = false, preserveCurrent = true } = {}) {
    toast(duplicate
      ? 'Saving this draft and preparing a duplicate…'
      : 'Saving this draft and opening a fresh examination…');
    if (preserveCurrent) await saveDraft({ force: true });
    const draft = duplicate
      ? duplicateDraft(collectExam())
      : clientOnlyBlankDraft(state.professor?.institutionId);
    await persistNewCreatorDraft(draft, { duplicate });
  }

  async function openNewExamFromOverview() {
    const current = collectExam();
    if (isPristineDraft(current)) {
      switchView('create');
      toast('Blank examination opened. Add a title or your first question to begin.');
      return;
    }
    await createAnotherExam();
  }

  async function openExamFromOverview(examId) {
    const id = safeText(examId, 80);
    if (!id) return;
    if (id === examSummaryId(state.exam)) {
      switchView('create');
      return;
    }
    const currentListed = state.examSummaries.some((entry) => examSummaryId(entry) === examSummaryId(state.exam));
    if (currentListed || !isPristineDraft(collectExam())) await saveDraft({ force: true });
    navigateToExam(id, 'create');
  }

  async function duplicateExamFromOverview(examId) {
    const id = safeText(examId, 80);
    if (!id) return;
    toast('Saving your current work and preparing the duplicate…');
    const currentListed = state.examSummaries.some((entry) => examSummaryId(entry) === examSummaryId(state.exam));
    if (currentListed || !isPristineDraft(collectExam())) await saveDraft({ force: true });
    let source;
    if (id === examSummaryId(state.exam)) {
      source = collectExam();
    } else {
      const summary = state.examSummaries.find((entry) => examSummaryId(entry) === id) || { id };
      const details = await api.professorQuery('exam', { examId: id });
      source = editorExamFromStored(details?.exam, summary, state.professor?.institutionId);
    }
    await persistNewCreatorDraft(duplicateDraft(source), { duplicate: true });
  }

  async function deleteExamFromOverview(examId) {
    const id = safeText(examId, 80);
    const summary = state.examSummaries.find((entry) => examSummaryId(entry) === id);
    if (!id || !summary) {
      showError({
        message: 'That examination is no longer in your active list.',
        recovery: 'Return to My examinations and choose one of the examinations currently shown.',
      }, null, 'Examination not found');
      return;
    }
    const current = id === examSummaryId(state.exam);
    const source = current ? { ...summary, ...collectExam() } : summary;
    const operation = lifecycleOperationForExam(source);
    const isDraft = operation === 'delete_draft';
    const serverBacked = state.serverExamIds.has(id);
    const title = safeText(source?.title, 180) || 'Untitled examination';
    const confirmed = await requestConfirmation({
      eyebrow: isDraft ? 'Delete draft' : 'Delete examination',
      title: `Delete “${title}” from My examinations?`,
      copy: serverBacked
        ? 'It leaves your active list immediately. Its questions, keys, student answers, grades, receipts, and audit history remain preserved in the recoverable Admin archive.'
        : 'This device-only draft leaves your active list immediately. It has not reached the server, so no student answers or key records are attached to it.',
      help: serverBacked
        ? 'Admin can restore this examination later. Deleting it never erases student evidence.'
        : 'This removes the local draft from this browser. Download a recovery copy first if you may need it again.',
      confirmLabel: isDraft ? 'Delete draft' : 'Delete examination',
      cancelLabel: 'Keep examination',
    });
    if (!confirmed) return;
    if (current) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      if (state.saveInFlight) await state.saveInFlight.catch(() => null);
    }
    if (serverBacked) await api.professorCommand(operation, { examId: id }, api.requestId());
    await removeLocalDraft(id);
    state.examSummaries = summariesAfterRemoval(state.examSummaries, id);
    state.serverExamIds.delete(id);
    if (current) {
      state.activation = null;
      state.activationAnnounced = false;
      state.monitor = null;
      state.grading = null;
      state.serverBaselineFingerprint = null;
      hydrateForm(clientOnlyBlankDraft(state.professor?.institutionId));
    }
    renderExamSwitcher(state.examSummaries, current ? '' : examSummaryId(state.exam));
    switchView('overview');
    toast(serverBacked
      ? 'Examination removed from My examinations. Admin can restore its complete record.'
      : 'Device-only draft removed from My examinations.');
  }

  function editorExamFromStored(storedExam, summary = {}, institutionId = '') {
    const exam = storedExam && typeof storedExam === 'object' && !Array.isArray(storedExam) ? storedExam : {};
    const controls = exam.controls && typeof exam.controls === 'object' && !Array.isArray(exam.controls)
      ? exam.controls
      : {};
    const examId = safeText(exam.id || exam.examId || summary.id || summary.examId, 80);
    if (!examId) throw new api.ExaminationRoomApiError(
      'EXAMINATION_DRAFT_INVALID',
      'The saved examination could not be opened safely.',
      409,
      'Return to the Examination Room doors and open the Professor workspace again. Your server-backed draft remains preserved.',
    );
    return {
      ...summary,
      ...exam,
      id: examId,
      institutionId: safeText(exam.institutionId || institutionId, 80) || null,
      versionId: exam.versionId || exam.currentPublishedVersionId || summary.currentVersionId || null,
      title: safeText(exam.title || summary.title, 180),
      subject: safeText(exam.subject ?? controls.subject, 120),
      jurisdiction: safeText(exam.jurisdiction ?? controls.jurisdiction, 80) || 'Philippines',
      yearLevel: safeText(exam.yearLevel ?? controls.yearLevel, 80) || 'Second year',
      instructions: safeText(exam.instructions ?? exam.description, 10_000),
      courseCode: safeText(exam.courseCode ?? controls.courseCode, 40),
      durationMinutes: Number(exam.durationMinutes || controls.durationMinutes || 120),
      startsAt: exam.startsAt ?? controls.startsAt ?? null,
      lateSubmissions: exam.lateSubmissions ?? controls.lateSubmissions ?? 'not_allowed',
      navigation: exam.navigation ?? controls.navigation ?? 'free',
      gradingIdentity: exam.gradingIdentity
        ?? exam.identityMode
        ?? controls.identityMode
        ?? (exam.anonymousGrading ? 'anonymous_grading' : 'real_names'),
      integrityTier: exam.integrityTier ?? controls.integrityTier ?? 'standard',
      cameraRequired: exam.cameraRequired === true || controls.cameraRequired === true,
      microphoneRequired: exam.microphoneRequired === true || controls.microphoneRequired === true,
      privacyNoticeVersion: safeText(exam.privacyNoticeVersion ?? controls.privacyNoticeVersion, 80) || 'exam-room-v1',
      privacyController: safeText(exam.privacyController ?? controls.privacyController, 1_000),
      retentionSummary: safeText(exam.retentionSummary ?? controls.retentionSummary, 2_000),
      admissionMode: exam.admissionMode === 'email_allowlist' || controls.admissionMode === 'email_allowlist'
        ? 'email_allowlist'
        : 'key_only',
      allowedEmails: normalizeAllowedEmails(exam.allowedEmails ?? controls.allowedEmails),
      sourceFileName: safeText(exam.sourceFileName ?? controls.sourceFileName, 255) || null,
      sourceFileSize: Number(exam.sourceFileSize ?? controls.sourceFileSize) || null,
      questions: (Array.isArray(exam.questions) ? exam.questions : []).map((question, index) => ({
        ...question,
        id: question?.id || question?.questionKey || `q-${index + 1}`,
        type: editorQuestionType(question?.type || question?.questionKind),
        wordGuideline: question?.wordGuideline
          || (Number.isSafeInteger(Number(question?.wordLimit)) && Number(question.wordLimit) > 0
            ? `Up to ${Number(question.wordLimit)} words`
            : ''),
        options: Array.isArray(question?.options)
          ? question.options.map(editorChoiceLabel)
          : Array.isArray(question?.choices)
            ? question.choices.map(editorChoiceLabel)
            : undefined,
        correctOption: question?.correctOption ?? question?.correctOptionIndex ?? 0,
      })),
      roster: Array.isArray(exam.roster) ? exam.roster : [],
      updatedAt: exam.updatedAt || summary.updatedAt || null,
    };
  }

  function normalizeQuestion(question, index) {
    const type = editorQuestionType(question?.type || question?.questionKind);
    return {
      id: safeText(question?.id || question?.questionKey, 80) || global.crypto.randomUUID(),
      number: index + 1,
      type,
      points: Math.max(0, Math.min(1000, Number(question?.points) || 0)),
      prompt: safeText(question?.prompt, 20_000),
      wordGuideline: safeText(question?.wordGuideline, 100),
      required: question?.required !== false,
      options: type === 'multiple_choice'
        ? (Array.isArray(question?.options)
          ? question.options
          : Array.isArray(question?.choices)
            ? question.choices
            : ['', '', '', '']).slice(0, 10).map(editorChoiceLabel)
        : undefined,
      correctOption: type === 'multiple_choice' && Number.isInteger(Number(question?.correctOption ?? question?.correctOptionIndex))
        ? Number(question.correctOption ?? question.correctOptionIndex)
        : 0,
    };
  }

  function normalizeRoster(student, index) {
    return {
      id: safeText(student?.id, 80) || global.crypto.randomUUID(),
      fullName: safeText(student?.fullName, 160) || `Student ${index + 1}`,
      studentNumber: safeText(student?.studentNumber, 48),
      email: safeText(student?.email, 254),
      yearLevel: safeText(student?.yearLevel, 80) || $('#year-level')?.value || 'Second year',
      extraMinutes: Math.max(0, Math.min(360, Number(student?.extraMinutes) || 0)),
    };
  }

  function allowedEmailEntries(value) {
    if (Array.isArray(value)) return value.flatMap((entry) => allowedEmailEntries(entry));
    return String(value || '')
      .split(/[\r\n,;]+/)
      .map((entry) => entry.replace(/^\s*\d+[.)]\s+/, '').trim())
      .filter(Boolean);
  }

  function normalizeAllowedEmails(value) {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return [...new Set(allowedEmailEntries(value)
      .map((entry) => entry.toLocaleLowerCase('en-PH'))
      .filter((entry) => entry.length <= 254 && validEmail.test(entry)))];
  }

  function invalidAllowedEmails(value) {
    const normalized = new Set(normalizeAllowedEmails(value));
    return allowedEmailEntries(value)
      .map((entry) => entry.toLocaleLowerCase('en-PH'))
      .filter((entry) => !normalized.has(entry));
  }

  function questionSuggestion(question, index) {
    const prompt = String(question.prompt || '').toLowerCase();
    if (question.type === 'multiple_choice') {
      return 'Confirm that one option is clearly correct and the distractors remain plausible.';
    }
    if (prompt.includes('separation of powers')) {
      return 'Consider asking students to distinguish structural and functional separation of powers.';
    }
    if (prompt.includes('judicial review')) {
      return 'You may want to invite discussion of political question doctrine and expanded judicial power.';
    }
    if (/property|ownership|possession|title|easement|land/.test(prompt)) {
      return 'Check that the property, competing claims, and requested remedy are stated clearly.';
    }
    if (/obligation|contract|breach|damages/.test(prompt)) {
      return 'Check that students can identify the obligation, breach, available defenses, and remedy.';
    }
    if (/crime|criminal|felony|offense|defense/.test(prompt)) {
      return 'Check that the facts support analysis of each element, participation, and any defense.';
    }
    return 'Check that the facts, task verb, point value, and expected depth are aligned.';
  }

  function marginSuggestion(question, index) {
    if (state.exam?.sourceFileName) {
      return `Imported from your source as Question ${index + 1}. Check the wording against the original before publishing.`;
    }
    return `Assistant check for Question ${index + 1}: review the wording and point value before publishing.`;
  }

  function choiceEditor(question) {
    if (question.type !== 'multiple_choice') return '';
    return `<div class="choice-editor" data-choice-editor="${escapeHtml(question.id)}">
      ${question.options.map((option, index) => `<label class="choice-row">
        <input type="radio" name="correct-${escapeHtml(question.id)}" value="${index}" ${index === question.correctOption ? 'checked' : ''} aria-label="Mark option ${index + 1} as correct">
        <input type="text" value="${escapeHtml(option)}" maxlength="500" data-choice-index="${index}" aria-label="Option ${index + 1}">
        <button type="button" data-remove-choice="${index}" aria-label="Remove option ${index + 1}"><i class="ph ph-x" aria-hidden="true"></i></button>
      </label>`).join('')}
      <button class="button secondary compact" type="button" data-add-choice="true"><i class="ph ph-plus" aria-hidden="true"></i>Add option</button>
    </div>`;
  }

  function questionMarkup(question, index) {
    return `<article class="question-layout" data-question-id="${escapeHtml(question.id)}">
      <aside class="margin-note"><i class="ph ph-sparkle" aria-hidden="true"></i><div><p>${escapeHtml(marginSuggestion(question, index))}</p><button type="button" data-review-question="${escapeHtml(question.id)}">Review</button></div></aside>
      <div class="question-card-wrapper">
        <section class="question-card">
          <header class="question-head">
            <span class="question-number">${index + 1}</span>
            <label><span class="sr-only">Question type</span><select class="question-type" data-question-type-select="true">${Object.entries(QUESTION_TYPES).map(([value, label]) => `<option value="${value}" ${value === question.type ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
            <label class="points-control"><span>Points</span><input type="number" min="0" max="1000" step="1" value="${question.points}" data-points="true" aria-label="Points for question ${index + 1}"></label>
            <button class="icon-action question-options-button" type="button" data-question-options-button="true" aria-label="Question ${index + 1} options" aria-expanded="false"><i class="ph ph-dots-three-vertical" aria-hidden="true"></i></button>
          </header>
          <div class="question-options" hidden>
            <button type="button" data-question-action="move_up"><i class="ph ph-arrow-up" aria-hidden="true"></i>Move up</button>
            <button type="button" data-question-action="move_down"><i class="ph ph-arrow-down" aria-hidden="true"></i>Move down</button>
            <button type="button" data-question-action="duplicate"><i class="ph ph-copy" aria-hidden="true"></i>Duplicate</button>
            <button type="button" data-question-action="delete"><i class="ph ph-trash" aria-hidden="true"></i>Delete</button>
          </div>
          <div class="question-toolbar" role="toolbar" aria-label="Format question ${index + 1}">
            <select data-block-format aria-label="Text style"><option value="p">Paragraph</option><option value="h3">Heading</option><option value="blockquote">Quote</option></select>
            <button type="button" data-format-command="bold" aria-label="Bold"><strong>B</strong></button>
            <button type="button" data-format-command="italic" aria-label="Italic"><em>I</em></button>
            <button type="button" data-format-command="underline" aria-label="Underline"><u>U</u></button>
            <button type="button" data-format-command="insertUnorderedList" aria-label="Bulleted list"><i class="ph ph-list-bullets" aria-hidden="true"></i></button>
            <button type="button" data-format-command="insertOrderedList" aria-label="Numbered list"><i class="ph ph-list-numbers" aria-hidden="true"></i></button>
            <button type="button" data-format-command="justifyLeft" aria-label="Align left"><i class="ph ph-text-align-left" aria-hidden="true"></i></button>
            <button type="button" data-format-command="justifyCenter" aria-label="Align center"><i class="ph ph-text-align-center" aria-hidden="true"></i></button>
            <button type="button" data-format-command="createLink" aria-label="Add link"><i class="ph ph-link" aria-hidden="true"></i></button>
            <span class="toolbar-spacer"></span>
            <button type="button" data-format-command="undo" aria-label="Undo"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i></button>
            <button type="button" data-format-command="redo" aria-label="Redo"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
          </div>
          <div class="question-prompt" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Question ${index + 1} prompt" data-placeholder="Write the question…">${escapeHtml(question.prompt)}</div>
          ${choiceEditor(question)}
          <footer class="question-foot">
            <label><span>Word count guideline</span><input type="text" value="${escapeHtml(question.wordGuideline || '')}" data-word-guideline="true" placeholder="e.g. 600–800 words" maxlength="100"></label>
            <label><input type="checkbox" data-required="true" ${question.required ? 'checked' : ''}><span>Required</span></label>
          </footer>
          <div class="assistant-suggestion"><i class="ph ph-sparkle" aria-hidden="true"></i><span><strong>Assistant suggestion</strong><small>${escapeHtml(questionSuggestion(question, index))}</small></span><button type="button" data-insert-suggestion="${escapeHtml(question.id)}">Insert</button></div>
        </section>
      </div>
    </article>`;
  }

  function renderQuestions(focusId = null) {
    state.questions = state.questions.map(normalizeQuestion);
    $('#questions-list').innerHTML = state.questions.map(questionMarkup).join('');
    if (focusId) {
      const card = $(`[data-question-id="${CSS.escape(focusId)}"] .question-card`);
      card?.classList.add('is-focused');
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => card?.classList.remove('is-focused'), 1800);
    }
    if (!state.hydrating) updateReviewCount();
  }

  function renderRoster() {
    state.roster = state.roster.map(normalizeRoster);
    const body = $('#roster-body');
    if (!body) return;
    body.innerHTML = state.roster.map((student, index) => `<tr data-student-id="${escapeHtml(student.id)}">
      <td><input value="${escapeHtml(student.fullName)}" maxlength="160" data-roster-field="fullName" aria-label="Student ${index + 1} full legal name"></td>
      <td><input value="${escapeHtml(student.studentNumber)}" maxlength="48" data-roster-field="studentNumber" aria-label="${escapeHtml(student.fullName)} student number"></td>
      <td><select data-roster-field="yearLevel" aria-label="${escapeHtml(student.fullName)} year level">${['First year', 'Second year', 'Third year', 'Fourth year', 'Graduate'].map((level) => `<option ${level === student.yearLevel ? 'selected' : ''}>${level}</option>`).join('')}</select></td>
      <td><select data-roster-field="extraMinutes" aria-label="${escapeHtml(student.fullName)} extra time"><option value="0" ${student.extraMinutes === 0 ? 'selected' : ''}>None</option><option value="15" ${student.extraMinutes === 15 ? 'selected' : ''}>+15 min</option><option value="30" ${student.extraMinutes === 30 ? 'selected' : ''}>+30 min</option><option value="60" ${student.extraMinutes === 60 ? 'selected' : ''}>+60 min</option></select></td>
      <td><button class="icon-action" type="button" data-remove-student="true" aria-label="Remove ${escapeHtml(student.fullName)}"><i class="ph ph-trash" aria-hidden="true"></i></button></td>
    </tr>`).join('');
    if ($('#student-count')) $('#student-count').textContent = `(${state.roster.length})`;
    if (api.demoEnabled()) document.body.dataset.demoHydratedRoster = String(state.roster.length);
    if ($('#roster-preview-list')) {
      $('#roster-preview-list').innerHTML = state.roster.slice(0, 5).map((student) => `<li><span>${escapeHtml(student.fullName)}</span><span>${escapeHtml(student.studentNumber)}</span></li>`).join('')
        + (state.roster.length > 5 ? '<li><span>…</span><span></span></li>' : '');
    }
    if (!state.hydrating) updateReviewCount();
  }

  function syncAdmissionControls() {
    const mode = selectedRadio('admission-mode', state.exam?.admissionMode || 'key_only');
    const editor = $('#allowlist-editor');
    const input = $('#allowed-emails');
    const emails = normalizeAllowedEmails(input?.value || []);
    const invalid = invalidAllowedEmails(input?.value || []);
    if (editor) editor.hidden = mode !== 'email_allowlist';
    if ($('#allowlist-count')) {
      $('#allowlist-count').textContent = invalid.length
        ? `${emails.length} valid · ${invalid.length} line${invalid.length === 1 ? '' : 's'} need correction`
        : `${emails.length} valid email address${emails.length === 1 ? '' : 'es'}`;
      $('#allowlist-count').classList.toggle('has-error', invalid.length > 0);
    }
    if ($('#admission-summary')) {
      $('#admission-summary').textContent = mode === 'email_allowlist'
        ? `${emails.length} listed email address${emails.length === 1 ? '' : 'es'} may use the student key.`
        : 'Anyone with the student key may enter. No roster is required.';
    }
  }

  function hydrateForm(exam) {
    stopMonitorPolling();
    stopActivationPolling({ abort: true });
    state.hydrating = true;
    state.exam = exam;
    resetActivationPollingWindow();
    if (exam?.activation && typeof exam.activation === 'object' && !Array.isArray(exam.activation)) {
      state.activation = exam.activation;
    }
    state.questions = (exam.questions || []).map(normalizeQuestion);
    state.roster = (exam.roster || []).map(normalizeRoster);
    $('#command-title').value = exam.title || '';
    $('#command-title').readOnly = true;
    $('#exam-title').value = exam.title || '';
    $('#duration-control').value = String(exam.durationMinutes || 120);
    $('#jurisdiction').value = exam.jurisdiction || 'Philippines';
    $('#subject').value = exam.subject || '';
    $('#instructions').value = exam.instructions || '';
    $('#year-level').value = exam.yearLevel || 'Second year';
    $('#course-code').value = exam.courseCode || '';
    $('#late-control').value = exam.lateSubmissions === 'professor_review' || exam.lateSubmissions === 'grace_5'
      ? 'professor_review'
      : 'not_allowed';
    $('#navigation-control').value = exam.navigation === 'sequential' || exam.navigation === 'forward_only'
      ? 'sequential'
      : 'free';
    $$('input[name="grading-identity"]').forEach((input) => { input.checked = input.value === (exam.gradingIdentity || 'real_names'); });
    state.anonymousGrading = exam.gradingIdentity === 'anonymous_grading' || exam.anonymousGrading === true;
    $('#anonymous-grading-toggle').checked = state.anonymousGrading;
    $$('input[name="integrity-tier-main"]').forEach((input) => { input.checked = input.value === (exam.integrityTier || 'standard'); });
    $('#camera-required').checked = Boolean(exam.cameraRequired);
    $('#microphone-required').checked = Boolean(exam.microphoneRequired);
    $('#recording-options').hidden = (exam.integrityTier || 'standard') !== 'recorded_proctoring';
    $('#recording-availability').hidden = false;
    const admissionMode = exam.admissionMode === 'email_allowlist' ? 'email_allowlist' : 'key_only';
    $$('input[name="admission-mode"]').forEach((input) => { input.checked = input.value === admissionMode; });
    $('#allowed-emails').value = normalizeAllowedEmails(exam.allowedEmails).join('\n');
    syncAdmissionControls();
    $('#source-name').textContent = exam.sourceFileName || 'No source file';
    $('#source-size').textContent = exam.sourceFileSize ? formatBytes(exam.sourceFileSize) : 'Create questions directly below';
    $('#source-file').hidden = !exam.sourceFileName;
    $('#import-notice').hidden = !exam.sourceFileName;
    $('#exam-details').classList.toggle('has-source', Boolean(exam.sourceFileName));
    renderRoster();
    renderQuestions();
    state.hydrating = false;
    updateReviewCount();
    autoResizeTitle();
    state.lastSavedJson = JSON.stringify(collectExam());
    updatePublishState();
  }

  function collectQuestionFromNode(node, index) {
    const question = state.questions.find((entry) => entry.id === node.dataset.questionId) || {};
    const type = $('[data-question-type-select]', node)?.value || question.type || 'essay';
    const options = type === 'multiple_choice'
      ? $$('[data-choice-index]', node).map((input) => safeText(input.value, 500))
      : undefined;
    const correct = type === 'multiple_choice'
      ? Number($(`input[name="correct-${CSS.escape(question.id)}"]:checked`, node)?.value || 0)
      : undefined;
    return normalizeQuestion({
      ...question,
      type,
      points: Number($('[data-points]', node)?.value || 0),
      prompt: safeText($('.question-prompt', node)?.innerText, 20_000),
      wordGuideline: safeText($('[data-word-guideline]', node)?.value, 100),
      required: Boolean($('[data-required]', node)?.checked),
      options,
      correctOption: correct,
    }, index);
  }

  function syncQuestionsFromDom() {
    state.questions = $$('[data-question-id]', $('#questions-list')).map(collectQuestionFromNode);
  }

  function syncRosterFromDom() {
    const body = $('#roster-body');
    if (!body) return;
    state.roster = $$('[data-student-id]', body).map((row, index) => normalizeRoster({
      id: row.dataset.studentId,
      ...Object.fromEntries($$('[data-roster-field]', row).map((field) => [field.dataset.rosterField, field.value])),
    }, index));
  }

  function selectedRadio(name, fallback) {
    return $(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function collectExam() {
    if (!state.exam) return {};
    syncQuestionsFromDom();
    syncRosterFromDom();
    const title = safeText($('#exam-title').value, 180);
    const subject = safeText($('#subject').value, 120);
    const admissionMode = selectedRadio('admission-mode', 'key_only') === 'email_allowlist'
      ? 'email_allowlist'
      : 'key_only';
    return {
      ...state.exam,
      title,
      subject,
      jurisdiction: safeText($('#jurisdiction').value, 80),
      yearLevel: $('#year-level').value,
      instructions: safeText($('#instructions').value, 10_000),
      courseCode: safeText($('#course-code').value, 40),
      durationMinutes: Number($('#duration-control').value || 120),
      startsAt: null,
      lateSubmissions: $('#late-control').value === 'professor_review' ? 'professor_review' : 'not_allowed',
      navigation: $('#navigation-control').value === 'sequential' ? 'sequential' : 'free',
      gradingIdentity: selectedRadio('grading-identity', 'real_names'),
      integrityTier: selectedRadio('integrity-tier-main', 'standard'),
      cameraRequired: $('#camera-required').checked,
      microphoneRequired: $('#microphone-required').checked,
      admissionMode,
      allowedEmails: admissionMode === 'email_allowlist' ? normalizeAllowedEmails($('#allowed-emails').value) : [],
      sourceFileName: $('#source-file').hidden ? null : safeText($('#source-name').textContent, 255),
      sourceFileSize: $('#source-file').hidden ? null : state.exam.sourceFileSize,
      questions: state.questions,
      roster: state.roster,
    };
  }

  async function draftDb() {
    if (!global.indexedDB) return null;
    if (draftDb.promise) return draftDb.promise;
    draftDb.promise = new Promise((resolve) => {
      const request = global.indexedDB.open('duediligence-examination-room-v1-professor', 1);
      let settled = false;
      const finish = (database = null) => {
        if (settled) {
          database?.close?.();
          return;
        }
        settled = true;
        global.clearTimeout(timeout);
        resolve(database);
      };
      const timeout = global.setTimeout(() => finish(null), INDEXED_DB_OPEN_TIMEOUT_MS);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'examId' });
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    });
    return draftDb.promise;
  }

  function professorIdentityId() {
    return safeText(state.professor?.id || state.professor?.userId, 80);
  }

  function localDraftRecord(exam) {
    return {
      examId: safeText(exam?.id, 80),
      ownerUserId: professorIdentityId(),
      institutionId: safeText(state.professor?.institutionId || exam?.institutionId, 80),
      exam,
      serverBaselineFingerprint: state.serverBaselineFingerprint,
      contentFingerprint: examContentFingerprint(exam),
      savedAt: new Date().toISOString(),
    };
  }

  function localDraftBelongsToCurrentProfessor(record) {
    if (!record?.examId || !record?.exam || record.examId !== record.exam.id) return false;
    const ownerUserId = professorIdentityId();
    const institutionId = safeText(state.professor?.institutionId, 80);
    return Boolean(
      ownerUserId
      && institutionId
      && record.ownerUserId === ownerUserId
      && record.institutionId === institutionId
      && safeText(record.exam?.institutionId, 80) === institutionId
    );
  }

  function rememberActiveLocalDraft(record) {
    if (!localDraftBelongsToCurrentProfessor(record)) return;
    try {
      const pointer = {
        examId: record.examId,
        ownerUserId: record.ownerUserId,
        institutionId: record.institutionId,
        title: safeText(record.exam?.title, 180),
        status: safeText(record.exam?.status, 40) || 'draft',
        savedAt: record.savedAt,
      };
      global.localStorage?.setItem(DRAFT_ACTIVE_KEY, JSON.stringify(pointer));
      const existing = JSON.parse(global.localStorage?.getItem(DRAFT_INDEX_KEY) || '[]');
      const index = Array.isArray(existing) ? existing : [];
      const next = [
        pointer,
        ...index.filter((entry) => !(
          entry?.examId === pointer.examId
          && entry?.ownerUserId === pointer.ownerUserId
          && entry?.institutionId === pointer.institutionId
        )),
      ].slice(0, 50);
      global.localStorage?.setItem(DRAFT_INDEX_KEY, JSON.stringify(next));
    } catch {
      // IndexedDB still keeps the recovery copy when localStorage is unavailable.
    }
  }

  async function saveLocalDraft(exam) {
    const record = localDraftRecord(exam);
    rememberActiveLocalDraft(record);
    let persisted = false;
    try {
      if (typeof global.localStorage?.setItem !== 'function') throw new Error('localStorage unavailable');
      global.localStorage.setItem(`${DRAFT_FALLBACK_PREFIX}${record.examId}`, JSON.stringify(record));
      global.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(record));
      persisted = true;
    } catch {
      // IndexedDB remains the primary recovery store for larger examinations.
    }
    try {
      const db = await draftDb();
      if (db) {
        await new Promise((resolve, reject) => {
          const request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(record);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
        persisted = true;
      }
    } catch {
      // Fall through to the small synchronous recovery copy.
    }
    if (!persisted) {
      throw new api.ExaminationRoomApiError(
        'DEVICE_STORAGE_UNAVAILABLE',
        'This browser could not preserve the examination on this device.',
        507,
        'Keep this page open. Allow site storage or free browser space, then choose Save draft again.',
      );
    }
    return record.savedAt;
  }

  async function readLocalDraft(examId) {
    try {
      const db = await draftDb();
      if (db) {
        const record = await new Promise((resolve, reject) => {
          const request = db.transaction('drafts').objectStore('drafts').get(examId);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
        if (localDraftBelongsToCurrentProfessor(record)) return record;
      }
    } catch {
      // Fall through to localStorage.
    }
    try {
      const record = JSON.parse(
        global.localStorage?.getItem(`${DRAFT_FALLBACK_PREFIX}${examId}`)
        || global.localStorage?.getItem(DRAFT_STORAGE_KEY)
        || 'null',
      );
      return record?.examId === examId && localDraftBelongsToCurrentProfessor(record) ? record : null;
    } catch {
      return null;
    }
  }

  async function readActiveLocalDraft() {
    try {
      const pointer = JSON.parse(global.localStorage?.getItem(DRAFT_ACTIVE_KEY) || 'null');
      if (!pointer?.examId) return null;
      if (!api?.demoEnabled?.()) {
        if (pointer.ownerUserId !== professorIdentityId()) return null;
        if (pointer.institutionId !== safeText(state.professor?.institutionId, 80)) return null;
      }
      return readLocalDraft(pointer.examId);
    } catch {
      return null;
    }
  }

  async function readIndexedLocalDrafts() {
    try {
      const db = await draftDb();
      if (!db) return [];
      const records = await new Promise((resolve, reject) => {
        const store = db.transaction('drafts').objectStore('drafts');
        if (typeof store.getAll === 'function') {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
          return;
        }
        const values = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(values); return; }
          values.push(cursor.value);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      return records.filter(localDraftBelongsToCurrentProfessor);
    } catch {
      return [];
    }
  }

  async function readLocalDraftIndex() {
    const indexedRecords = await readIndexedLocalDrafts();
    const recordsById = new Map(indexedRecords.map((record) => [record.examId, record]));
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(DRAFT_INDEX_KEY) || '[]');
      const pointers = Array.isArray(parsed) ? parsed.slice(0, 50) : [];
      for (const pointer of pointers) {
        if (!pointer?.examId) continue;
        if (!api?.demoEnabled?.()) {
          if (pointer.ownerUserId !== professorIdentityId()) continue;
          if (pointer.institutionId !== safeText(state.professor?.institutionId, 80)) continue;
        }
        const record = await readLocalDraft(pointer.examId);
        if (record?.exam) recordsById.set(record.examId, record);
      }
    } catch {
      // IndexedDB enumeration above still makes local drafts discoverable.
    }
    return [...recordsById.values()]
      .sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')));
  }

  async function removeLocalDraft(examId) {
    const id = safeText(examId, 80);
    if (!id) return;
    try {
      const db = await draftDb();
      if (db) {
        await new Promise((resolve, reject) => {
          const request = db.transaction('drafts', 'readwrite').objectStore('drafts').delete(id);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
      }
    } catch {
      // Continue removing the smaller fallback copies.
    }
    try {
      global.localStorage?.removeItem(`${DRAFT_FALLBACK_PREFIX}${id}`);
      const active = JSON.parse(global.localStorage?.getItem(DRAFT_ACTIVE_KEY) || 'null');
      if (active?.examId === id) {
        global.localStorage?.removeItem(DRAFT_ACTIVE_KEY);
        global.localStorage?.removeItem(DRAFT_STORAGE_KEY);
      }
      const index = JSON.parse(global.localStorage?.getItem(DRAFT_INDEX_KEY) || '[]');
      if (Array.isArray(index)) {
        global.localStorage?.setItem(DRAFT_INDEX_KEY, JSON.stringify(index.filter((entry) => entry?.examId !== id)));
      }
    } catch {
      // The server action remains authoritative if browser storage is unavailable.
    }
  }

  function setSavedStatus(mode, label) {
    const status = $('#saved-status');
    status.classList.toggle('is-saving', mode === 'saving');
    status.classList.toggle('is-error', mode === 'error' || mode === 'unsaved');
    const icon = $('i', status);
    icon.className = `ph ${mode === 'saving' ? 'ph-spinner-gap' : mode === 'error' ? 'ph-warning-circle' : mode === 'unsaved' ? 'ph-pencil-simple' : 'ph-check-circle'}`;
    $('span', status).textContent = label;
  }

  function serverDraftBackupBlockers(exam) {
    const blockers = [];
    if (!safeText(exam?.title, 180)) blockers.push('add an examination title');
    (Array.isArray(exam?.questions) ? exam.questions : []).forEach((question, index) => {
      if (!safeText(question?.prompt, 20_000)) blockers.push(`complete Question ${index + 1}`);
    });
    return blockers;
  }

  function serverBackupWaitingLabel(blockers) {
    if (blockers.length === 1) return `Saved on this device · ${blockers[0]} for server backup`;
    return `Saved on this device · complete ${blockers.length} items for server backup`;
  }

  async function saveDraft({ announce = false, force = false } = {}) {
    const exam = collectExam();
    const serialized = JSON.stringify(exam);
    let localSavedAt = null;
    let localSaveError = null;
    try {
      localSavedAt = await saveLocalDraft(exam);
    } catch (error) {
      localSaveError = error;
      setSavedStatus('error', 'Device copy unavailable');
    }
    syncCurrentExamSummary(exam);
    const backupBlockers = serverDraftBackupBlockers(exam);
    if (backupBlockers.length) {
      if (localSaveError) {
        setSavedStatus('error', 'Not saved — keep this page open');
        showError({
          code: 'DRAFT_NOT_PRESERVED',
          message: 'The incomplete draft could not be saved on this device.',
          recovery: 'Keep this page open. Allow site storage or free browser space, then choose Save draft again.',
        }, () => saveDraft({ announce: true, force: true }), 'Draft not saved', 'draft-save');
        throw localSaveError;
      }
      dismissErrorScope('draft-save');
      const waitingLabel = serverBackupWaitingLabel(backupBlockers);
      setSavedStatus('unsaved', waitingLabel);
      if (announce) toast(`${waitingLabel}.`);
      return {
        exam,
        localOnly: true,
        awaitingCompletion: true,
        backupBlockers,
        deviceCopySaved: true,
      };
    }
    if (!force && serialized === state.lastSavedJson) {
      dismissErrorScope('draft-save');
      setSavedStatus('saved', localSavedAt ? `Saved ${timeAgo(localSavedAt)}` : 'Saved on server');
      if (announce) toast('Draft is already up to date.');
      return { exam, deviceCopySaved: Boolean(localSavedAt) };
    }
    if (state.saveInFlight) await state.saveInFlight.catch(() => null);
    setSavedStatus('saving', 'Saving…');
    const action = async () => {
      const result = await api.professorCommand('save_draft', { exam }, api.requestId());
      state.exam = result.exam || exam;
      state.serverExamIds.add(examSummaryId(state.exam));
      state.serverBaselineFingerprint = examContentFingerprint(state.exam);
      state.lastSavedJson = JSON.stringify(exam);
      syncCurrentExamSummary(state.exam);
      if (localSavedAt) {
        try {
          localSavedAt = await saveLocalDraft(state.exam);
        } catch {
          localSavedAt = null;
        }
      }
      dismissErrorScope('draft-save');
      setSavedStatus('saved', localSavedAt ? `Saved ${timeAgo(result.savedAt || new Date())}` : 'Saved on server');
      if (announce) toast(localSavedAt
        ? 'Draft saved on this device and backed up to the server.'
        : 'Draft backed up to the server. Browser storage is unavailable on this device.');
      return { ...result, deviceCopySaved: Boolean(localSavedAt) };
    };
    state.saveInFlight = action();
    try {
      return await state.saveInFlight;
    } catch (error) {
      if (localSaveError) {
        setSavedStatus('error', 'Not saved — keep this page open');
        showError({
          code: 'DRAFT_NOT_PRESERVED',
          message: 'The draft could not be saved on this device or backed up to the server.',
          recovery: 'Keep this page open. Allow site storage or free browser space, restore your connection, then choose Save draft again.',
        }, () => saveDraft({ announce: true, force: true }), 'Draft not saved', 'draft-save');
        throw localSaveError;
      }
      setSavedStatus('error', 'Saved on this device');
      showError(error, () => saveDraft({ announce: true, force: true }), 'Server backup delayed', 'draft-save');
      return { exam, localOnly: true };
    } finally {
      state.saveInFlight = null;
    }
  }

  function scheduleAutosave() {
    if (!state.exam) return;
    clearTimeout(state.saveTimer);
    const exam = collectExam();
    syncCurrentExamSummary(exam);
    saveLocalDraft(exam)
      .then((savedAt) => setSavedStatus('saved', `Saved on this device ${timeAgo(savedAt)}`))
      .catch(() => setSavedStatus('error', 'Device copy unavailable'));
    state.saveTimer = setTimeout(() => saveDraft({ force: false }).catch(() => null), 1600);
    updateReviewCount();
  }

  function reviewItems() {
    const exam = collectExam();
    const items = [];
    if (!exam.title) items.push({ section: 'exam-details', label: 'Add an examination title', help: 'Students and administrators need a clear title.' , blocking: true });
    if (!exam.subject) items.push({ section: 'exam-details', label: 'Select the subject', help: 'The subject is required for student room entry.', blocking: true });
    if (!exam.instructions) items.push({ section: 'additional-details', label: 'Add student instructions', help: 'State the expected answer method and permitted resources.', blocking: true });
    if (!exam.questions.length) items.push({ section: 'questions', label: 'Add at least one question', help: 'An examination needs a question before publication.', blocking: true });
    exam.questions.forEach((question, index) => {
      if (!question.prompt) items.push({ section: 'questions', questionId: question.id, label: `Complete Question ${index + 1}`, help: 'Every question must have a prompt.', blocking: true });
      if (!(Number(question.points) > 0)) items.push({ section: 'questions', questionId: question.id, label: `Set points for Question ${index + 1}`, help: 'Every question needs a positive point value.', blocking: true });
      if (question.type === 'multiple_choice' && (!question.options?.length || question.options.some((choice) => !choice))) items.push({ section: 'questions', questionId: question.id, label: `Complete the choices for Question ${index + 1}`, help: 'Each multiple-choice option must contain text.', blocking: true });
    });
    if (exam.admissionMode === 'email_allowlist') {
      const invalidEmails = invalidAllowedEmails($('#allowed-emails').value);
      if (!exam.allowedEmails.length) items.push({ section: 'students', label: 'Add at least one allowed email', help: 'Choose “Anyone with the student key” or enter the email addresses that may use this key.', blocking: true });
      if (invalidEmails.length) items.push({ section: 'students', label: 'Correct the email list', help: `${invalidEmails.length} line${invalidEmails.length === 1 ? '' : 's'} cannot be used as an email address.`, blocking: true });
    }
    if (exam.integrityTier === 'recorded_proctoring' && !exam.cameraRequired && !exam.microphoneRequired) items.push({ section: 'safety', label: 'Choose camera, microphone, or both', help: 'Recorded proctoring needs at least one recording device selected.', blocking: true });
    return items;
  }

  function updateReviewCount() {
    if (!state.exam) return;
    const items = reviewItems().filter((item) => item.blocking);
    const button = $('#review-items');
    const icon = $('i', button);
    $('span', button).textContent = items.length
      ? `Review ${items.length} required item${items.length === 1 ? '' : 's'}`
      : 'Ready to publish';
    icon.className = `ph ${items.length ? 'ph-warning-circle' : 'ph-check-circle'}`;
    button.classList.toggle('has-blockers', items.length > 0);
  }

  function updatePublishState() {
    if (!state.exam) return;
    const button = $('#publish-exam');
    const status = state.exam.status;
    if (['published', 'key_requested', 'awaiting_approval', 'awaiting_activation', 'active', 'open', 'grading', 'results_released'].includes(status)) {
      button.textContent = ['published', 'key_requested', 'awaiting_approval', 'awaiting_activation'].includes(status)
        ? 'Key requested'
        : 'Published · key issued';
      button.disabled = true;
    } else {
      button.textContent = 'Publish & request key';
      button.disabled = false;
    }
    syncCreatorAccess();
  }

  function activationStatus() {
    return safeText(
      state.activation?.status
        || state.exam?.activation?.status
        || state.exam?.activationStatus
        || state.exam?.status,
      40,
    ).toLowerCase();
  }

  function creatorAccessUnlocked() {
    const status = activationStatus();
    if (['active', 'open', 'closed', 'grading', 'results_released', 'scheduled'].includes(status)) return true;
    if (!state.activation && !state.exam?.activation) return false;
    return !['', 'waiting', 'pending', 'awaiting_activation', 'requested', 'revoked'].includes(status);
  }

  function creatorAccessPending() {
    if (creatorAccessUnlocked()) return false;
    const examStatus = safeText(state.exam?.status, 40).toLowerCase();
    return ['published', 'key_requested', 'awaiting_approval', 'awaiting_activation'].includes(examStatus)
      || ['waiting', 'pending', 'awaiting_activation', 'requested'].includes(activationStatus());
  }

  function resetActivationPollingWindow() {
    state.activationPollAttempt = 0;
    state.activationPollStartedAt = 0;
    state.activationPollExamId = safeText(state.exam?.id, 80);
    state.activationPollingExpired = false;
  }

  function stopActivationPolling({ reset = false, abort = false } = {}) {
    if (state.activationTimer) global.clearTimeout(state.activationTimer);
    state.activationTimer = null;
    if (abort) state.activationAbortController?.abort?.();
    if (abort) state.activationAbortController = null;
    if (reset) resetActivationPollingWindow();
  }

  function activationPollDelay() {
    const exponential = Math.min(
      ACTIVATION_POLL_MAX_DELAY_MS,
      ACTIVATION_POLL_BASE_DELAY_MS * (2 ** Math.min(state.activationPollAttempt, 5)),
    );
    return global.document?.hidden
      ? Math.max(ACTIVATION_POLL_HIDDEN_MIN_DELAY_MS, exponential)
      : exponential;
  }

  function showActivationPollingPaused() {
    const strip = $('#creator-access-status');
    if (!strip || creatorAccessUnlocked()) return;
    strip.hidden = false;
    strip.dataset.state = 'pending';
    $('#creator-access-title').textContent = 'Automatic approval checking paused';
    $('#creator-access-copy').textContent = 'The examination is still saved and waiting for Admin. Choose Check approval to restart automatic checking.';
    $('#check-activation').textContent = 'Check approval';
  }

  function scheduleActivationPoll() {
    if (state.activationTimer || state.activationPollInFlight || !creatorAccessPending()) return;
    const examId = safeText(state.exam?.id, 80);
    if (state.activationPollExamId !== examId) resetActivationPollingWindow();
    if (state.activationPollingExpired) {
      showActivationPollingPaused();
      return;
    }
    if (!state.activationPollStartedAt) state.activationPollStartedAt = Date.now();
    if (Date.now() - state.activationPollStartedAt >= ACTIVATION_POLL_LIFETIME_MS) {
      state.activationPollingExpired = true;
      showActivationPollingPaused();
      return;
    }
    const delay = activationPollDelay();
    state.activationTimer = global.setTimeout(async () => {
      state.activationTimer = null;
      if (!creatorAccessPending() || state.activationPollExamId !== safeText(state.exam?.id, 80)) return;
      await refreshCreatorAccess({ scheduleNext: false });
      state.activationPollAttempt += 1;
      if (creatorAccessPending()) scheduleActivationPoll();
    }, delay);
  }

  function syncCreatorAccess({ announce = false } = {}) {
    if (!state.exam) return;
    const unlocked = creatorAccessUnlocked();
    const pending = creatorAccessPending();
    $$('[data-requires-activation="true"]').forEach((control) => {
      control.disabled = !unlocked;
      control.setAttribute('aria-disabled', String(!unlocked));
      if (control.classList.contains('workspace-tab')) {
        const viewName = control.dataset.view === 'grade' ? 'Grade submissions' : 'Monitor examination';
        control.setAttribute('aria-label', unlocked
          ? viewName
          : `${viewName} — available after Admin issues the student key`);
      }
      control.title = unlocked
        ? (control.dataset.view === 'grade' ? 'Open grading' : 'Open monitoring')
        : 'Publish the examination and wait for Admin to issue the student key';
    });

    const strip = $('#creator-access-status');
    if (strip) {
      strip.hidden = state.exam.status === 'draft' && !pending && !unlocked;
      strip.dataset.state = unlocked ? 'approved' : pending ? 'pending' : 'draft';
      $('#creator-access-title').textContent = unlocked
        ? 'Student key issued · creator access unlocked'
        : state.activationPollingExpired ? 'Automatic approval checking paused' : 'Student key request sent to Admin';
      $('#creator-access-copy').textContent = unlocked
        ? 'Monitor and Grade are ready. You do not need to enter the student key.'
        : state.activationPollingExpired
          ? 'The examination is still saved and waiting for Admin. Choose Check approval to restart automatic checking.'
          : 'Your examination is saved and sealed. This page checks automatically; no creator key entry is required.';
      $('#check-activation').textContent = unlocked ? 'Open monitoring' : 'Check approval';
    }

    if (unlocked) {
      stopActivationPolling({ reset: true });
      if ((announce || !state.activationAnnounced) && pending === false) {
        state.activationAnnounced = true;
        if (announce) toast('Admin issued the student key. Monitor and Grade are now unlocked.');
      }
    } else if (pending) {
      scheduleActivationPoll();
    } else if (!pending && state.activationTimer) {
      stopActivationPolling();
    }
  }

  async function refreshCreatorAccess({ silent = true, scheduleNext = true } = {}) {
    if (state.activationPollInFlight) return creatorAccessUnlocked();
    const examId = safeText(state.exam?.id, 80);
    const wasUnlocked = creatorAccessUnlocked();
    const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    state.activationAbortController = controller;
    state.activationPollInFlight = true;
    try {
      const result = await api.professorQuery('monitor', { examId }, { signal: controller?.signal });
      if (examId !== safeText(state.exam?.id, 80)) return false;
      state.monitor = result;
      state.exam = result.exam || state.exam;
      state.activation = result.activation || null;
      const nowUnlocked = creatorAccessUnlocked();
      syncCreatorAccess({ announce: !wasUnlocked && nowUnlocked });
      if (state.currentView === 'monitor') renderMonitor();
      if (state.currentView === 'grade' && nowUnlocked) await refreshGrading();
      if (!silent && !nowUnlocked) toast('The request is still waiting for Admin approval. This page will keep checking.');
      if (!silent && nowUnlocked && wasUnlocked) toast('Creator access is active. Monitor and Grade are ready.');
      return nowUnlocked;
    } catch (error) {
      if (!silent && error?.code !== 'REQUEST_CANCELLED') showError(error, () => refreshCreatorAccess({ silent: false }), 'Approval status not refreshed');
      return false;
    } finally {
      if (state.activationAbortController === controller) state.activationAbortController = null;
      state.activationPollInFlight = false;
      if (scheduleNext && creatorAccessPending() && !state.activationPollingExpired) scheduleActivationPoll();
    }
  }

  function showReviewItems({ publishAttempt = false } = {}) {
    const items = reviewItems();
    $('#review-list').innerHTML = items.length
      ? items.map((item) => `<button class="review-entry" type="button" data-review-section="${escapeHtml(item.section)}" ${item.questionId ? `data-review-question-id="${escapeHtml(item.questionId)}"` : ''}><i class="ph ${item.blocking ? 'ph-warning-circle' : 'ph-info'}" aria-hidden="true"></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.help)}</small></span><i class="ph ph-caret-right" aria-hidden="true"></i></button>`).join('')
      : '<div class="empty-state"><i class="ph ph-check-circle" aria-hidden="true"></i><h2>Ready to publish</h2><p>No required information is missing.</p></div>';
    openDialog('review-dialog');
    if (publishAttempt && items.some((item) => item.blocking)) toast('Complete the required review items. Suggestions remain under your control.');
  }

  function goToReviewItem(sectionId, questionId = null) {
    closeDialog('review-dialog');
    const target = questionId
      ? $(`[data-question-id="${CSS.escape(questionId)}"]`)
      : document.getElementById(sectionId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (questionId) $('.question-card', target)?.classList.add('is-focused');
    const focusable = questionId ? $('.question-prompt', target) : $('input, textarea, select, button', target);
    setTimeout(() => focusable?.focus(), 350);
  }

  function showPublishDialog() {
    const items = reviewItems();
    const blocker = items.find((item) => item.blocking);
    if (blocker) {
      showReviewItems({ publishAttempt: true });
      setTimeout(() => goToReviewItem(blocker.section, blocker.questionId), 500);
      return;
    }
    const exam = collectExam();
    const totalPoints = exam.questions.reduce((sum, question) => sum + Number(question.points || 0), 0);
    $('#publish-summary').innerHTML = `<div class="publish-grid">
      <div class="publish-item"><small>Examination</small><strong>${escapeHtml(exam.title)}</strong></div>
      <div class="publish-item"><small>Duration</small><strong>${exam.durationMinutes} minutes · no fixed date or start time</strong></div>
      <div class="publish-item"><small>Questions and points</small><strong>${exam.questions.length} questions · ${totalPoints} points</strong></div>
      <div class="publish-item"><small>Student admission</small><strong>${exam.admissionMode === 'email_allowlist' ? `${exam.allowedEmails.length} allowed email address${exam.allowedEmails.length === 1 ? '' : 'es'}` : 'Anyone with the student key'}</strong></div>
      <div class="publish-item"><small>Grading</small><strong>${exam.gradingIdentity === 'real_names' ? 'Real names' : 'Anonymous grading (optional)'}</strong></div>
      <div class="publish-item"><small>Integrity</small><strong>${escapeHtml(exam.integrityTier.replace(/_/g, ' '))}</strong></div>
    </div><p class="legal-note">Publishing is your final setup step. Admin approves the request and issues the student key; Monitor and Grade then unlock automatically without asking you for that key.</p>`;
    $('#publish-confirmation').checked = false;
    $('#publish-confirm').disabled = true;
    openDialog('publish-dialog');
  }

  async function publishExam(event) {
    event.preventDefault();
    if (!$('#publish-confirmation').checked) return;
    const button = $('#publish-confirm');
    setButtonBusy(button, true, 'Publishing…');
    try {
      await saveDraft({ force: true });
      const exam = collectExam();
      const result = await api.professorCommand('publish', { exam }, api.requestId());
      state.exam = result.exam || { ...exam, status: 'awaiting_activation' };
      closeDialog('publish-dialog');
      updatePublishState();
      state.activation = result.activation || null;
      state.activationAnnounced = false;
      resetActivationPollingWindow();
      syncCreatorAccess();
      toast('Published and key requested. Admin can approve it now; this page will unlock Monitor and Grade automatically.');
    } catch (error) {
      showError(error, () => publishExam(event));
    } finally {
      setButtonBusy(button, false);
    }
  }

  function previewExam() {
    const exam = collectExam();
    $('#preview-sheet').innerHTML = `<article class="preview-document">
      <p class="section-kicker">${escapeHtml(exam.subject || 'Law examination')}</p>
      <h1>${escapeHtml(exam.title || 'Untitled examination')}</h1>
      <p class="preview-meta">${exam.durationMinutes} minutes · opens with the student key · ${escapeHtml(exam.jurisdiction || '')}</p>
      <p>${escapeHtml(exam.instructions || 'No instructions have been added.')}</p>
      ${exam.questions.map((question, index) => `<section class="preview-question"><h3>${index + 1}. ${escapeHtml(question.prompt || 'Question prompt missing')} <small>(${question.points} points)</small></h3>${question.type === 'multiple_choice' ? `<ol type="A">${(question.options || []).map((option) => `<li>${escapeHtml(option)}</li>`).join('')}</ol>` : '<div class="preview-answer-area" aria-label="Student answer area"></div>'}</section>`).join('')}
    </article>`;
    openDialog('preview-dialog');
  }

  function autoResizeTitle() {
    const textarea = $('#exam-title');
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`;
  }

  function syncTitle(source) {
    const value = source.value;
    $('#exam-title').value = value;
    $('#command-title').value = value;
    autoResizeTitle();
    scheduleAutosave();
  }

  function addQuestion(type = 'essay', seed = {}) {
    syncQuestionsFromDom();
    const question = normalizeQuestion({
      id: global.crypto.randomUUID(), type, points: seed.points ?? 10,
      prompt: seed.prompt || '', wordGuideline: seed.wordGuideline || '', required: true,
      options: type === 'multiple_choice' ? (seed.options || ['', '', '', '']) : undefined,
      correctOption: seed.correctOption || 0,
    }, state.questions.length);
    state.questions.push(question);
    renderQuestions(question.id);
    scheduleAutosave();
    $('.question-prompt', $(`[data-question-id="${CSS.escape(question.id)}"]`))?.focus();
  }

  function questionAction(questionId, action) {
    syncQuestionsFromDom();
    const index = state.questions.findIndex((question) => question.id === questionId);
    if (index < 0) return;
    if (action === 'delete') {
      if (state.questions.length === 1) {
        showError({ message: 'Keep at least one question in the examination.', recovery: 'Add a replacement question before deleting this one.' }, null, 'Question not deleted');
        return;
      }
      state.questions.splice(index, 1);
      renderQuestions();
      scheduleAutosave();
      toast('Question removed. The draft was renumbered automatically.');
      return;
    }
    if (action === 'duplicate') {
      const copy = normalizeQuestion({ ...state.questions[index], id: global.crypto.randomUUID(), prompt: `${state.questions[index].prompt} (Copy)` }, index + 1);
      state.questions.splice(index + 1, 0, copy);
      renderQuestions(copy.id);
      scheduleAutosave();
      return;
    }
    const destination = action === 'move_up' ? index - 1 : index + 1;
    if (destination < 0 || destination >= state.questions.length) return;
    [state.questions[index], state.questions[destination]] = [state.questions[destination], state.questions[index]];
    renderQuestions(questionId);
    scheduleAutosave();
  }

  function changeQuestionType(questionId, type) {
    syncQuestionsFromDom();
    const index = state.questions.findIndex((entry) => entry.id === questionId);
    if (index < 0) return;
    state.questions[index] = questionAfterTypeChange(state.questions[index], type, index);
    renderQuestions(questionId);
    scheduleAutosave();
  }

  function questionAfterTypeChange(question, type, index = 0) {
    const nextType = QUESTION_TYPES[type] ? type : 'essay';
    const next = { ...question, type: nextType };
    if (nextType === 'multiple_choice') {
      next.options = Array.isArray(question?.options) && question.options.length
        ? question.options
        : ['', '', '', ''];
      const requestedCorrectOption = Number(question?.correctOption);
      next.correctOption = Number.isInteger(requestedCorrectOption)
        ? Math.max(0, Math.min(next.options.length - 1, requestedCorrectOption))
        : 0;
    } else {
      delete next.options;
      delete next.correctOption;
    }
    return normalizeQuestion(next, index);
  }

  async function handleFormat(button, questionNode) {
    const prompt = $('.question-prompt', questionNode);
    prompt?.focus();
    const command = button.dataset.formatCommand;
    if (command === 'createLink') {
      const url = await requestText({
        eyebrow: 'Question editor',
        title: 'Add a secure link',
        copy: 'Paste the complete link you want to add to this question.',
        label: 'Secure link address',
        help: 'For student safety, only complete addresses beginning with https:// are accepted.',
        type: 'url',
        autocomplete: 'url',
        placeholder: 'https://example.edu/reference',
        submitLabel: 'Add link',
      });
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') throw new Error();
        document.execCommand(command, false, parsed.href);
      } catch {
        showError({ message: 'That link address is not valid.', recovery: 'Use a complete secure address beginning with https://.' }, null, 'Link not added');
        return;
      }
    } else {
      document.execCommand(command, false);
    }
    scheduleAutosave();
  }

  function addStudent(seed = {}) {
    syncRosterFromDom();
    state.roster.push(normalizeRoster({
      id: global.crypto.randomUUID(), fullName: '', studentNumber: '',
      yearLevel: $('#year-level').value, extraMinutes: 0, ...seed,
    }, state.roster.length));
    renderRoster();
    scheduleAutosave();
    const row = $('#roster-body tr:last-child');
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('input', row)?.focus();
  }

  function parseCsvLine(line) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
      else value += character;
    }
    values.push(value.trim());
    return values;
  }

  async function importRoster(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showError({ message: 'That roster file is larger than 2 MB.', recovery: 'Export only the required name, student number, email, year level, and extra-time columns, then import again.' }, null, 'Roster not imported');
      return;
    }
    const rows = (await file.text()).split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
    if (rows.length < 2) {
      showError({ message: 'The CSV does not contain student rows.', recovery: 'Include a header row followed by at least one student.' }, null, 'Roster not imported');
      return;
    }
    const headers = rows.shift().map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const positions = {
      fullName: headers.findIndex((value) => ['fullname', 'name', 'studentname'].includes(value)),
      studentNumber: headers.findIndex((value) => ['studentnumber', 'studentno', 'idnumber'].includes(value)),
      email: headers.findIndex((value) => value === 'email'),
      yearLevel: headers.findIndex((value) => ['yearlevel', 'year'].includes(value)),
      extraMinutes: headers.findIndex((value) => ['extraminutes', 'accommodationminutes'].includes(value)),
    };
    if (positions.fullName < 0 || positions.studentNumber < 0) {
      showError({ message: 'The CSV needs Full name and Student number columns.', recovery: 'Rename those two headers, keep the first row as column names, then import again.' }, null, 'Roster not imported');
      return;
    }
    const imported = rows.map((row, index) => normalizeRoster({
      id: global.crypto.randomUUID(),
      fullName: row[positions.fullName],
      studentNumber: row[positions.studentNumber],
      email: positions.email >= 0 ? row[positions.email] : '',
      yearLevel: positions.yearLevel >= 0 ? row[positions.yearLevel] : $('#year-level').value,
      extraMinutes: positions.extraMinutes >= 0 ? Number(row[positions.extraMinutes]) : 0,
    }, index)).filter((student) => student.fullName && student.studentNumber);
    if (!imported.length) {
      showError({ message: 'No complete student rows were found.', recovery: 'Add a full name and student number to each row, then import again.' }, null, 'Roster not imported');
      return;
    }
    state.roster = imported;
    renderRoster();
    scheduleAutosave();
    toast(`${imported.length} students imported. Review the roster before publishing.`);
  }

  function questionsFromText(text) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    const parts = normalized.split(/\n(?=(?:Question\s+)?\d+[.)]\s+)/i).map((part) => part.replace(/^(?:Question\s+)?\d+[.)]\s*/i, '').trim()).filter(Boolean);
    return parts.map((prompt, index) => normalizeQuestion({
      id: global.crypto.randomUUID(), type: 'essay', points: Math.max(1, Math.floor(100 / parts.length)),
      prompt, wordGuideline: index === 0 ? '600–800 words' : '500–700 words', required: true,
    }, index));
  }

  async function importSource(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showError({ message: 'That exam file is larger than 8 MB.', recovery: 'Remove unnecessary images or export the document as a smaller DOCX, text PDF, or TXT file, then try again.' }, null, 'Exam not uploaded');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['docx', 'pdf', 'txt', 'rtf'].includes(extension)) {
      showError({ message: 'That file type is not supported.', recovery: 'Upload a DOCX, text-based PDF, RTF, or TXT file.' }, null, 'Exam not uploaded');
      return;
    }
    $('#source-name').textContent = file.name;
    $('#source-size').textContent = formatBytes(file.size);
    $('#source-file').hidden = false;
    $('#import-notice').hidden = false;
    $('#exam-details').classList.add('has-source');
    state.exam.sourceFileName = file.name;
    state.exam.sourceFileSize = file.size;
    try {
      if (extension === 'txt') {
        const parsed = questionsFromText(await file.text());
        if (parsed.length) {
          state.questions = parsed;
          renderQuestions();
        }
      } else if (!api.demoEnabled()) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        const result = await api.professorCommand('import_document', {
          examId: state.exam.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', base64: btoa(binary),
        }, api.requestId());
        if (result.questions?.length) {
          state.questions = result.questions.map(normalizeQuestion);
          renderQuestions();
        }
      }
      scheduleAutosave();
      toast('Source uploaded. AI numbering is a draft for your review; nothing was published.');
    } catch (error) {
      showError(error, () => importSource(file), 'Source import delayed');
    }
  }

  function syncIntegrityControls() {
    const selected = selectedRadio('integrity-tier-main', 'standard');
    $('#recording-options').hidden = selected !== 'recorded_proctoring';
    $('#recording-availability').hidden = false;
    scheduleAutosave();
  }

  function switchView(view) {
    if (!['overview', 'create', 'monitor', 'grade'].includes(view)) return;
    if (['monitor', 'grade'].includes(view) && !creatorAccessUnlocked()) {
      view = 'create';
      if (creatorAccessPending()) {
        toast('Monitor and Grade unlock automatically when Admin issues the student key.');
      }
    }
    state.currentView = view;
    document.body.dataset.workspaceView = view;
    $$('[data-app-view]').forEach((node) => {
      const active = node.dataset.appView === view;
      node.hidden = !active;
      node.classList.toggle('is-active', active);
    });
    $$('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    const skipLink = $('.skip-link');
    if (skipLink) skipLink.href = view === 'overview' ? '#overview-title' : view === 'create' ? '#exam-editor' : view === 'monitor' ? '#monitor-title' : '#grade-title';
    $('#assistant-panel').hidden = view !== 'create';
    if (view === 'overview') renderExamOverview();
    stopMonitorPolling();
    if (view === 'monitor') {
      const generation = state.monitorPollGeneration;
      refreshMonitor({ pollGeneration: generation })
        .finally(() => scheduleMonitorPoll(generation));
    }
    if (view === 'grade') refreshGrading();
    replaceWorkspaceUrl(view);
  }

  function stopMonitorPolling() {
    state.monitorPollGeneration += 1;
    if (state.monitorTimer) global.clearTimeout(state.monitorTimer);
    state.monitorTimer = null;
    state.monitorAbortController?.abort?.();
    state.monitorAbortController = null;
  }

  function scheduleMonitorPoll(generation = state.monitorPollGeneration) {
    if (
      state.currentView !== 'monitor'
      || generation !== state.monitorPollGeneration
      || state.monitorTimer
    ) return;
    const delay = global.document?.hidden
      ? MONITOR_HIDDEN_POLL_INTERVAL_MS
      : MONITOR_POLL_INTERVAL_MS;
    state.monitorTimer = global.setTimeout(async () => {
      state.monitorTimer = null;
      if (state.currentView !== 'monitor' || generation !== state.monitorPollGeneration) return;
      await refreshMonitor({ pollGeneration: generation });
      scheduleMonitorPoll(generation);
    }, delay);
  }

  async function refreshMonitor({ silent = true, pollGeneration = state.monitorPollGeneration } = {}) {
    if (state.monitorPollInFlight) return state.monitorPollInFlight;
    const examId = safeText(state.exam?.id, 80);
    const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    state.monitorAbortController = controller;
    const request = (async () => {
      try {
        const result = await api.professorQuery('monitor', { examId }, { signal: controller?.signal });
        if (
          pollGeneration !== state.monitorPollGeneration
          || state.currentView !== 'monitor'
          || examId !== safeText(state.exam?.id, 80)
        ) return false;
        state.monitor = result;
        state.exam = result.exam || state.exam;
        state.activation = result.activation || null;
        syncCreatorAccess();
        renderMonitor();
        if (!silent) toast('Live student status refreshed.');
        return true;
      } catch (error) {
        if (!silent && error?.code !== 'REQUEST_CANCELLED') showError(error, () => refreshMonitor({ silent: false }), 'Monitor not refreshed');
        return false;
      } finally {
        if (state.monitorAbortController === controller) state.monitorAbortController = null;
        if (state.monitorPollInFlight === request) state.monitorPollInFlight = null;
      }
    })();
    state.monitorPollInFlight = request;
    return request;
  }

  function renderMonitor() {
    const data = state.monitor || { sessions: [], submissions: [], incidents: [] };
    const sessions = data.sessions || [];
    const submittedIds = new Set((data.submissions || []).map((submission) => submission.sessionId));
    const connected = sessions.filter((session) => session.connected && !submittedIds.has(session.id) && !['revoked', 'blocked'].includes(session.status)).length;
    const submitted = submittedIds.size;
    const disconnected = sessions.filter((session) => !session.connected && !submittedIds.has(session.id)).length;
    $('#monitor-title').textContent = state.exam.title;
    $('#monitor-metrics').innerHTML = [
      ['Entered', sessions.length, state.exam.admissionMode === 'email_allowlist' ? 'From the allowed email list' : 'Anyone with the student key'],
      ['In progress', connected, 'Connected and writing'],
      ['Submitted', submitted, 'Receipts issued'],
      ['Needs attention', disconnected + (data.incidents || []).filter((incident) => incident.severity !== 'info').length, 'Human review only'],
    ].map(([label, value, help]) => `<div class="operations-metric"><small>${escapeHtml(label)}</small><strong>${value}</strong><span>${escapeHtml(help)}</span></div>`).join('');
    const status = activationStatus() || 'waiting';
    $('#room-state-label').textContent = ['open', 'active'].includes(status) ? 'Student key active · monitoring ready' : creatorAccessUnlocked() && status !== 'closed' ? 'Student key issued · monitoring ready' : status === 'closed' ? 'Room closed · grading ready' : 'Waiting for Admin approval';
    $('.live-indicator').classList.toggle('is-live', ['open', 'active'].includes(status));
    const openButton = $('#open-room');
    if (['open', 'active'].includes(status)) {
      openButton.textContent = 'Close room';
      openButton.dataset.roomAction = 'close';
      openButton.disabled = false;
    } else if (status === 'closed') {
      openButton.textContent = 'Room closed';
      openButton.dataset.roomAction = 'closed';
      openButton.disabled = true;
    } else {
      openButton.textContent = creatorAccessUnlocked() ? 'Activate legacy key' : 'Waiting for student key';
      openButton.dataset.roomAction = 'open';
      openButton.disabled = !creatorAccessUnlocked();
    }
    const query = $('#monitor-search').value.trim().toLowerCase();
    const filtered = sessions.filter((session) => !query || `${session.fullName} ${session.studentNumber}`.toLowerCase().includes(query));
    $('#monitor-table-body').innerHTML = filtered.length ? filtered.map((session) => {
      const isSubmitted = submittedIds.has(session.id);
      const sessionStatus = ['revoked', 'blocked'].includes(session.status)
        ? session.status
        : isSubmitted ? 'submitted' : session.connected ? 'in_progress' : 'disconnected';
      const latestIncident = [...(data.incidents || [])].reverse().find((incident) => incident.sessionId === session.id);
      const canRevoke = !isSubmitted && !['revoked', 'blocked'].includes(sessionStatus);
      return `<tr data-monitor-session="${escapeHtml(session.id)}"><td><strong>${escapeHtml(session.fullName)}</strong>${session.email ? `<small>${escapeHtml(session.email)}</small>` : ''}</td><td>${escapeHtml(session.studentNumber)}</td><td><span class="status-label ${sessionStatus}"><i aria-hidden="true"></i>${escapeHtml(sessionStatus.replace('_', ' '))}</span></td><td>${escapeHtml(String(session.currentQuestion || '—'))}</td><td>${escapeHtml(timeAgo(session.lastSeenAt))}</td><td>${latestIncident ? escapeHtml(latestIncident.type.replace(/_/g, ' ')) : 'Clear'}</td><td><div class="session-actions"><button class="table-action" type="button" data-view-student="${escapeHtml(session.id)}">View</button>${canRevoke ? `<button class="table-action warning" type="button" data-revoke-session="${escapeHtml(session.id)}" data-revoke-mode="kick">Kick</button><button class="table-action danger" type="button" data-revoke-session="${escapeHtml(session.id)}" data-revoke-mode="block">Block</button>` : ''}</div></td></tr>`;
    }).join('') : '<tr><td colspan="7"><div class="empty-feed">No students have entered yet. Share the active student key; this page updates automatically.</div></td></tr>';
    const incidents = [...(data.incidents || [])].reverse();
    $('#incident-feed').innerHTML = incidents.length ? incidents.map((incident) => {
      const session = sessions.find((entry) => entry.id === incident.sessionId);
      return `<article class="incident-entry"><i class="ph ph-warning-circle" aria-hidden="true"></i><div><strong>${escapeHtml(session?.fullName || 'Student session')}</strong><p>${escapeHtml(incident.type.replace(/_/g, ' '))}. Review the timing and context before deciding whether any follow-up is needed.</p><small>${escapeHtml(formatDateTime(incident.occurredAt))}</small></div></article>`;
    }).join('') : '<div class="empty-feed">No integrity events require review. A focus change, device interruption, or disconnection will appear here without automatically penalizing the student.</div>';
  }

  async function roomAction() {
    const button = $('#open-room');
    if (button.dataset.roomAction === 'closed') {
      switchView('grade');
      return;
    }
    if (button.dataset.roomAction === 'close') {
      const confirmed = await requestConfirmation({
        eyebrow: 'Room control',
        title: 'Close the examination room?',
        copy: 'Students who already submitted are unaffected. Students still writing will be asked to submit their last saved work.',
        help: 'Saved answers and submission records remain preserved for grading and Admin recovery.',
        confirmLabel: 'Close room',
        cancelLabel: 'Keep room open',
      });
      if (!confirmed) return;
      setButtonBusy(button, true, 'Closing…');
      try {
        await api.professorCommand('close_room', { examId: state.exam.id }, api.requestId());
        toast('Room closed. Grading is now available.');
        await refreshMonitor();
        switchView('grade');
      } catch (error) {
        showError(error, roomAction, 'Room not closed');
      } finally {
        setButtonBusy(button, false);
      }
      return;
    }
    if (!creatorAccessUnlocked()) {
      showError({ message: 'Admin has not issued the student key yet.', recovery: 'Keep this page open or choose Check approval. Monitor and Grade unlock automatically after approval.' }, () => refreshCreatorAccess({ silent: false }), 'Student key pending');
      return;
    }
    setButtonBusy(button, true, 'Opening…');
    try {
      const result = await api.professorCommand('open_room', { examId: state.exam.id }, api.requestId());
      state.exam = result.exam || state.exam;
      state.activation = result.activation || state.activation;
      syncCreatorAccess();
      toast('Monitoring room is open. Students may enter with their student key.');
      await refreshMonitor();
    } catch (error) {
      showError(error, roomAction, 'Room not opened');
    } finally {
      setButtonBusy(button, false);
      renderMonitor();
    }
  }

  async function revokeStudentSession(sessionId, mode, trigger) {
    const session = (state.monitor?.sessions || []).find((entry) => entry.id === sessionId);
    if (!session || state.revokingSessions.has(sessionId)) return;
    let reason = 'Removed by the examination creator';
    if (mode === 'block') {
      const detail = await requestText({
        eyebrow: 'Participant control',
        title: `Block ${session.fullName || 'this student'}?`,
        copy: 'This ends the active session and prevents it from continuing. The action is recorded in the examination audit trail.',
        label: 'Reason for blocking',
        help: 'Write a short reason the creator and Admin can understand later.',
        minimumLength: 3,
        submitLabel: 'Block session',
      });
      if (!detail) return;
      reason = `Blocked by the examination creator: ${safeText(detail, 500)}`;
    } else {
      const confirmed = await requestConfirmation({
        eyebrow: 'Participant control',
        title: `Remove ${session.fullName || 'this student'} from the room?`,
        copy: 'The active session will end. The student cannot continue this attempt unless the creator or Admin resolves the access decision.',
        help: 'The latest saved work remains preserved for creator and Admin review.',
        confirmLabel: 'Remove session',
        cancelLabel: 'Keep student connected',
      });
      if (!confirmed) return;
    }
    state.revokingSessions.add(sessionId);
    if (trigger) trigger.disabled = true;
    try {
      await api.professorCommand('revoke_session', {
        examId: state.exam.id,
        sessionId,
        reason,
      }, api.requestId());
      toast(mode === 'block' ? 'Student session blocked. The action is recorded.' : 'Student session removed. Their latest saved work remains preserved.');
      await refreshMonitor();
    } catch (error) {
      showError(error, () => revokeStudentSession(sessionId, mode, trigger), mode === 'block' ? 'Student not blocked' : 'Student not removed');
    } finally {
      state.revokingSessions.delete(sessionId);
      if (trigger) trigger.disabled = false;
    }
  }

  function showStudentDetail(sessionId) {
    const data = state.monitor || {};
    const session = (data.sessions || []).find((entry) => entry.id === sessionId);
    if (!session) return;
    const submission = (data.submissions || []).find((entry) => entry.sessionId === sessionId);
    const incidents = (data.incidents || []).filter((entry) => entry.sessionId === sessionId);
    $('#student-detail-title').textContent = session.fullName;
    $('#student-detail-content').innerHTML = `<dl class="student-detail-grid">
      <div><dt>Student number</dt><dd>${escapeHtml(session.studentNumber)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(submission ? 'Submitted' : session.connected ? 'In progress' : 'Disconnected')}</dd></div>
      <div><dt>Current question</dt><dd>${escapeHtml(String(session.currentQuestion || 'Not available'))}</dd></div>
      <div><dt>Last server backup</dt><dd>${escapeHtml(formatDateTime(session.lastSeenAt))}</dd></div>
      <div><dt>Entry record</dt><dd>${session.attemptBindingId || session.consentVersion ? 'Recorded' : 'Not available'}</dd></div>
      <div><dt>Integrity events</dt><dd>${incidents.length}</dd></div>
      ${submission ? `<div><dt>Receipt</dt><dd>${escapeHtml(submission.receiptCode)}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(formatDateTime(submission.submittedAt))}</dd></div>` : ''}
    </dl><p class="legal-note">Events are context for human review. They do not establish misconduct and do not alter the student’s grade automatically.</p>`;
    openDialog('student-detail-dialog');
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function jsonDownloadSize(value) {
    return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }).size;
  }

  function downloadMonitorSnapshot() {
    if (!state.monitor) return;
    const safe = {
      generatedAt: new Date().toISOString(), examId: state.exam.id, title: state.exam.title,
      sessions: state.monitor.sessions, submissions: state.monitor.submissions,
      incidents: state.monitor.incidents,
      note: 'Integrity events require human context and are not findings of misconduct.',
    };
    downloadJson(`examination-room-status-${state.exam.id.slice(0, 8)}.json`, safe);
    toast('Status snapshot downloaded. It does not contain room keys or student answers.');
  }

  async function refreshGrading() {
    try {
      state.grading = await api.professorQuery('grading', { examId: state.exam.id });
      renderGrading();
    } catch (error) {
      showError(error, refreshGrading, 'Grading not refreshed');
    }
  }

  function latestBy(items, keyFunction) {
    const map = new Map();
    items.forEach((item) => map.set(keyFunction(item), item));
    return map;
  }

  function gradingDisplayIdentity(session, index) {
    return {
      realName: safeText(session?.realFullName || session?.fullName, 160) || `Student ${index + 1}`,
      realStudentNumber: safeText(session?.realStudentNumber || session?.studentNumber, 48),
      alias: safeText(session?.gradingAlias, 80) || `Student ${index + 1}`,
    };
  }

  function renderGrading() {
    const data = state.grading || { sessions: [], submissions: [], answerRevisions: [], gradeRevisions: [], releases: [] };
    const submittedIds = new Set((data.submissions || []).map((submission) => submission.sessionId));
    const sessions = (data.sessions || []).filter((session) => submittedIds.has(session.id));
    if (!state.selectedGradingSessionId && sessions.length) state.selectedGradingSessionId = sessions[0].id;
    sessions.forEach((session) => {
      if (state.releaseSelectionSeenIds.has(session.id)) return;
      state.releaseSelectionSeenIds.add(session.id);
      state.selectedReleaseIds.add(session.id);
    });
    $('#grading-student-list').innerHTML = sessions.length ? sessions.map((session, index) => {
      const released = (data.releases || []).some((release) => release.sessionIds.includes(session.id));
      const identity = gradingDisplayIdentity(session, index);
      const displayName = state.anonymousGrading ? identity.alias : identity.realName;
      const displayDetail = state.anonymousGrading ? 'Identity hidden during grading' : identity.realStudentNumber;
      return `<div class="submission-person-wrap"><label class="sr-only" for="release-${escapeHtml(session.id)}">Select ${escapeHtml(displayName)} for result release</label><input id="release-${escapeHtml(session.id)}" class="release-selector" type="checkbox" data-release-session="${escapeHtml(session.id)}" ${state.selectedReleaseIds.has(session.id) ? 'checked' : ''}><button class="submission-person ${session.id === state.selectedGradingSessionId ? 'is-active' : ''}" type="button" data-grade-session="${escapeHtml(session.id)}"><span class="avatar">${escapeHtml(initials(displayName))}</span><span><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(displayDetail)}</small></span><i class="ph ${released ? 'ph-paper-plane-tilt' : 'ph-check-circle'}" aria-hidden="true"></i></button></div>`;
    }).join('') : '<div class="empty-feed">No submitted answer files are available yet. Student receipts will appear here automatically.</div>';
    renderGradingSheet();
    const latestGrades = latestBy(data.gradeRevisions || [], (grade) => `${grade.sessionId}:${grade.questionId}`);
    const gradedStudents = sessions.filter((session) => state.questions.every((question) => latestGrades.has(`${session.id}:${question.id}`))).length;
    $('#grading-summary').innerHTML = `<div class="grading-summary-content"><div class="summary-row"><span>Submitted</span><strong>${sessions.length}</strong></div><div class="summary-row"><span>Fully graded</span><strong>${gradedStudents}</strong></div><div class="summary-row"><span>Selected for release</span><strong>${state.selectedReleaseIds.size}</strong></div><div class="summary-row"><span>Identity view</span><strong>${state.anonymousGrading ? 'Anonymous' : 'Real names'}</strong></div></div>`;
  }

  function renderGradingSheet() {
    const data = state.grading || {};
    const session = (data.sessions || []).find((entry) => entry.id === state.selectedGradingSessionId);
    if (!session) {
      $('#grading-sheet').innerHTML = '<div class="empty-state"><i class="ph ph-seal-check" aria-hidden="true"></i><h2>Submissions will appear here</h2><p>Select a submitted student to review answers, award points, and leave feedback.</p></div>';
      return;
    }
    const studentIndex = (data.sessions || []).filter((entry) => (data.submissions || []).some((submission) => submission.sessionId === entry.id)).findIndex((entry) => entry.id === session.id);
    const identity = gradingDisplayIdentity(session, studentIndex);
    const displayName = state.anonymousGrading ? identity.alias : identity.realName;
    const answers = latestBy((data.answerRevisions || []).filter((revision) => revision.sessionId === session.id), (revision) => revision.questionId);
    const grades = latestBy((data.gradeRevisions || []).filter((revision) => revision.sessionId === session.id), (revision) => revision.questionId);
    $('#grading-sheet').innerHTML = `<header class="grading-student-head"><div><p class="section-kicker">Individual response</p><h2>${escapeHtml(displayName)}</h2><p>${escapeHtml(state.anonymousGrading ? 'The professor may reveal the real roster at any time.' : `${identity.realStudentNumber} · ${session.yearLevel}`)}</p></div><span class="grade-save-state"><i class="ph ph-check-circle" aria-hidden="true"></i> Grade changes create durable revisions</span></header>
      ${state.questions.map((question, index) => {
        const answer = answers.get(question.id)?.answer;
        const grade = grades.get(question.id) || {};
        const answerText = viewModels?.professorAnswerLabel
          ? viewModels.professorAnswerLabel(question, answer)
          : answer == null
            ? 'No saved answer was found for this question.'
            : typeof answer === 'string'
              ? answer
              : Array.isArray(answer)
                ? answer.join(', ')
                : JSON.stringify(answer);
        return `<article class="grade-question" data-grade-question="${escapeHtml(question.id)}"><header><h3>Question ${index + 1}</h3><strong>${question.points} points</strong></header><div class="student-answer">${escapeHtml(answerText)}</div><div class="grade-controls"><label><span>Points awarded</span><input type="number" min="0" max="${question.points}" step=".5" value="${grade.points ?? ''}" data-grade-points></label><label><span>Professor feedback</span><textarea maxlength="5000" data-grade-feedback>${escapeHtml(grade.feedback || '')}</textarea></label><button class="button primary compact" type="button" data-save-grade="${escapeHtml(question.id)}">Save grade</button></div></article>`;
      }).join('')}`;
  }

  function gradingEditorHasUnsavedChanges() {
    const data = state.grading || {};
    const sessionId = state.selectedGradingSessionId;
    if (!sessionId) return false;
    const grades = latestBy(
      (data.gradeRevisions || []).filter((revision) => revision.sessionId === sessionId),
      (revision) => revision.questionId,
    );
    return $$('[data-grade-question]').some((container) => {
      const questionId = container.dataset.gradeQuestion;
      const persisted = grades.get(questionId) || {};
      const pointsInput = $('[data-grade-points]', container);
      const feedbackInput = $('[data-grade-feedback]', container);
      const persistedPoints = persisted.points == null ? '' : String(persisted.points);
      const persistedFeedback = String(persisted.feedback || '');
      return String(pointsInput?.value || '') !== persistedPoints
        || String(feedbackInput?.value || '') !== persistedFeedback;
    });
  }

  async function saveGrade(questionId, button) {
    const container = $(`[data-grade-question="${CSS.escape(questionId)}"]`);
    const points = Number($('[data-grade-points]', container).value);
    const feedback = $('[data-grade-feedback]', container).value;
    setButtonBusy(button, true, 'Saving…');
    try {
      const result = await api.professorCommand('save_grade', { examId: state.exam.id, sessionId: state.selectedGradingSessionId, questionId, points, feedback }, api.requestId());
      state.grading.gradeRevisions.push(result.revision);
      toast('Grade saved as a new revision.');
      renderGrading();
    } catch (error) {
      showError(error, () => saveGrade(questionId, button), 'Grade not saved');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function releaseResults() {
    const sessionIds = [...state.selectedReleaseIds];
    if (!sessionIds.length) {
      showError({ message: 'No students are selected for result release.', recovery: 'Select the check box beside each intended student, then choose Release selected results again.' }, null, 'Results not released');
      return;
    }
    const latestGrades = latestBy(state.grading?.gradeRevisions || [], (grade) => `${grade.sessionId}:${grade.questionId}`);
    const incompleteSession = sessionIds.find((sessionId) => state.questions.some((question) => !latestGrades.has(`${sessionId}:${question.id}`)));
    if (incompleteSession) {
      const session = (state.grading?.sessions || []).find((entry) => entry.id === incompleteSession);
      const studentIndex = (state.grading?.sessions || []).findIndex((entry) => entry.id === incompleteSession);
      const identity = gradingDisplayIdentity(session, studentIndex);
      const displayName = state.anonymousGrading ? identity.alias : identity.realName;
      showError({
        message: `Complete every question grade for ${displayName} before releasing the result.`,
        recovery: 'Open the selected answer file, enter points and feedback for each question, save every grade, then release again.',
      }, null, 'Results not released');
      return;
    }
    const confirmed = await requestConfirmation({
      eyebrow: 'Result release',
      title: `Release results to ${sessionIds.length} selected student${sessionIds.length === 1 ? '' : 's'}?`,
      copy: 'The selected students will be able to view their points and Professor feedback on their protected receipt page.',
      help: 'Every saved grade revision remains available to the creator and Admin after release.',
      confirmLabel: 'Release results',
      cancelLabel: 'Continue grading',
    });
    if (!confirmed) return;
    const button = $('#release-results');
    setButtonBusy(button, true, 'Releasing…');
    try {
      const result = await api.professorCommand('release_results', { examId: state.exam.id, sessionIds }, api.requestId());
      state.grading.releases.push(result.release);
      const delivery = result.release?.delivery;
      const baseMessage = `Results released to ${sessionIds.length} selected student${sessionIds.length === 1 ? '' : 's'}.`;
      if (!delivery) {
        toast(baseMessage);
      } else if (Number(delivery.failedCount || 0)
          + Number(delivery.notConfiguredCount || 0)
          + Number(delivery.pendingCount || 0)
          + Number(delivery.suppressedCount || 0) > 0) {
        showError({
          message: `${baseMessage} ${Number(delivery.acceptedCount || 0)} result email${Number(delivery.acceptedCount || 0) === 1 ? '' : 's'} accepted; ${Number(delivery.failedCount || 0) + Number(delivery.notConfiguredCount || 0) + Number(delivery.pendingCount || 0) + Number(delivery.suppressedCount || 0)} still need delivery.`,
          recovery: delivery.recovery || 'After email service is restored, select the same released students and release again. Provider-accepted messages will not be resent.',
        }, releaseResults, 'Results released; email needs attention');
      } else if (Number(delivery.skippedCount || 0) > 0) {
        toast(`${baseMessage} ${Number(delivery.acceptedCount || 0)} email${Number(delivery.acceptedCount || 0) === 1 ? '' : 's'} sent; ${Number(delivery.skippedCount || 0)} student${Number(delivery.skippedCount || 0) === 1 ? '' : 's'} had no email and can view the result in the Student room.`);
      } else {
        toast(`${baseMessage} ${Number(delivery.acceptedCount || 0)} result email${Number(delivery.acceptedCount || 0) === 1 ? '' : 's'} accepted by the provider.`);
      }
      renderGrading();
    } catch (error) {
      showError(error, releaseResults, 'Results not released');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function derivePackageKey(passphrase, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function exportGradingPackage() {
    if (!state.grading) await refreshGrading();
    await state.offlineWorkspaceReady;
    if (!offlineGradingCore?.splitOfflineGradingPayload) {
      showError({
        message: 'The offline package builder did not load.',
        recovery: 'Refresh this Professor page while online, then choose Download offline copy again.',
      }, exportGradingPackage, 'Package not created');
      return;
    }
    const passphrase = await requestText({
      eyebrow: 'Encrypted offline grading',
      title: 'Protect the offline grading copy',
      copy: 'Create a passphrase for this examination copy. You will need the same passphrase to import grades later.',
      label: 'Passphrase',
      help: 'Use at least 12 characters. Store the passphrase separately from the downloaded file and do not email them together.',
      type: 'password',
      autocomplete: 'new-password',
      minimumLength: 12,
      submitLabel: 'Encrypt and download',
    });
    if (passphrase == null) return;
    if (passphrase.length < 12) {
      showError({ message: 'The offline grading passphrase must contain at least 12 characters.', recovery: 'Choose a longer, unique passphrase and store it separately from the downloaded file.' }, exportGradingPackage, 'Package not created');
      return;
    }
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await derivePackageKey(passphrase, salt);
      const payload = {
        format: 'duediligence-examination-room-offline-grading-v1',
        exportedAt: new Date().toISOString(),
        exam: { id: state.exam.id, versionId: state.exam.versionId, title: state.exam.title, questions: state.questions },
        sessions: state.grading.sessions,
        submissions: state.grading.submissions,
        answerRevisions: state.grading.answerRevisions,
        gradeRevisions: state.grading.gradeRevisions,
        privacy: 'Contains sensitive education records. Do not email, share, or store on an unmanaged device.',
      };
      const projectedPlaintextLimit = Math.floor((MAX_OFFLINE_PACKAGE_BYTES - 4096) * 0.74);
      const parts = offlineGradingCore.splitOfflineGradingPayload(
        payload,
        projectedPlaintextLimit,
        crypto.randomUUID(),
      );
      const width = Math.max(2, String(parts.length).length);
      for (let index = 0; index < parts.length; index += 1) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = new TextEncoder().encode(JSON.stringify(parts[index]));
        const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
        const wrapper = {
          format: payload.format, algorithm: 'AES-GCM', keyDerivation: 'PBKDF2-SHA256-310000',
          salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(encrypted),
        };
        if (jsonDownloadSize(wrapper) > MAX_OFFLINE_PACKAGE_BYTES) throw new Error('offline-part-size');
        const suffix = parts.length > 1
          ? `-part-${String(index + 1).padStart(width, '0')}-of-${String(parts.length).padStart(width, '0')}`
          : '';
        downloadJson(`due-diligence-offline-grading-${state.exam.id.slice(0, 8)}${suffix}.ddgrade.json`, wrapper);
      }
      toast(parts.length > 1
        ? `${parts.length} numbered offline grading files downloaded. Grade every file, then select all numbered graded files when importing.`
        : 'Encrypted offline copy downloaded. Open Offline grading, finish the grades, export the graded copy, then import it here.');
    } catch (error) {
      showError({
        message: error?.message || 'This browser could not create the encrypted grading copy.',
        recovery: 'Keep this page open. Use a current version of Chrome, Edge, Firefox, or Safari, allow multiple downloads if asked, then choose Download offline copy again.',
      }, exportGradingPackage, 'Package not created');
    }
  }

  function prepareDecryptedGradePayload(payload) {
    if (payload.exam?.id !== state.exam.id || payload.exam?.versionId !== state.exam.versionId) {
      throw new api.ExaminationRoomApiError(
        'OFFLINE_GRADE_EXAM_MISMATCH',
        'This graded file belongs to another examination or published version.',
        409,
        'Open the matching examination in the Professor Grade page, then import this file there.',
      );
    }
    const allGrades = Array.isArray(payload.gradeRevisions) ? payload.gradeRevisions : [];
    const exportBatchId = safeText(payload.offlineGrading?.exportBatchId, 128);
    const expectedChangeCount = Number(payload.offlineGrading?.addedRevisionCount || 0);
    const offlineGrades = allGrades.filter((grade) => (
      grade?.source === 'offline_grading_workspace'
      && safeText(grade?.offlineExportBatchId, 128) === exportBatchId
    ));
    if (!exportBatchId || !Number.isInteger(expectedChangeCount) || expectedChangeCount <= 0 || offlineGrades.length !== expectedChangeCount) {
      throw new api.ExaminationRoomApiError(
        'OFFLINE_GRADE_NO_CHANGES',
        'This copy contains no new offline grade changes.',
        409,
        'Open the original grading copy in Offline grading, change at least one complete point value or feedback entry, export a new graded copy, then import that file.',
      );
    }
    const importedGrades = [...latestBy(offlineGrades, (grade) => `${grade.sessionId}:${grade.questionId}`).values()].filter((grade) =>
      grade?.sessionId && grade?.questionId && Number.isFinite(Number(grade.points))
    );
    if (!importedGrades.length || importedGrades.length > 1000) throw new Error('grades');
    const questionPoints = new Map(state.questions.map((question) => [question.id, Number(question.points)]));
    if (importedGrades.some((grade) => !questionPoints.has(grade.questionId) || Number(grade.points) < 0 || Number(grade.points) > questionPoints.get(grade.questionId))) {
      throw new Error('grade-range');
    }
    const knownSessions = new Set((state.grading?.sessions || []).map((session) => session.id));
    if (knownSessions.size && importedGrades.some((grade) => !knownSessions.has(grade.sessionId))) {
      throw new Error('student-session');
    }
    return {
      exportBatchId,
      offlinePackage: payload.offlinePackage || null,
      grades: importedGrades.map((grade) => ({
        sessionId: grade.sessionId,
        questionId: grade.questionId,
        points: Number(grade.points),
        feedback: grade.feedback || '',
      })),
    };
  }

  function validateCompleteGradedPackageSets(preparedFiles) {
    const batchIds = new Set();
    const sets = new Map();
    const sourceSets = new Map();
    preparedFiles.forEach((prepared) => {
      if (batchIds.has(prepared.exportBatchId)) {
        throw new api.ExaminationRoomApiError(
          'OFFLINE_GRADE_FILE_DUPLICATE',
          'The same numbered graded file was selected more than once.',
          409,
          'Remove the duplicate selection, keep one copy of each numbered file, then import again.',
        );
      }
      batchIds.add(prepared.exportBatchId);
      const packageInfo = prepared.offlinePackage;
      if (packageInfo?.kind !== 'graded_import' || !packageInfo.setId) return;
      const partCount = Number(packageInfo.partCount || 1);
      const partNumber = Number(packageInfo.partNumber || 1);
      const set = sets.get(packageInfo.setId) || { partCount, parts: new Set() };
      if (set.partCount !== partCount || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
        throw new Error('graded-package-numbering');
      }
      set.parts.add(partNumber);
      sets.set(packageInfo.setId, set);
      if (packageInfo.sourceSetId) {
        const sourcePartCount = Number(packageInfo.sourcePartCount || 1);
        const sourcePartNumber = Number(packageInfo.sourcePartNumber || 1);
        const sourceSet = sourceSets.get(packageInfo.sourceSetId) || { partCount: sourcePartCount, parts: new Set() };
        if (
          !Number.isSafeInteger(sourcePartCount)
          || sourcePartCount < 1
          || sourceSet.partCount !== sourcePartCount
          || !Number.isSafeInteger(sourcePartNumber)
          || sourcePartNumber < 1
          || sourcePartNumber > sourcePartCount
        ) {
          throw new Error('graded-source-package-numbering');
        }
        sourceSet.parts.add(sourcePartNumber);
        sourceSets.set(packageInfo.sourceSetId, sourceSet);
      }
    });
    for (const set of sets.values()) {
      if (set.parts.size !== set.partCount) {
        const missing = Array.from({ length: set.partCount }, (_, index) => index + 1)
          .filter((partNumber) => !set.parts.has(partNumber));
        throw new api.ExaminationRoomApiError(
          'OFFLINE_GRADE_PART_MISSING',
          `The selected graded-file set is missing part ${missing.join(', ')} of ${set.partCount}.`,
          409,
          'Select every numbered graded file from that export together, then try again. No grade from this selection was imported.',
        );
      }
    }
    for (const sourceSet of sourceSets.values()) {
      if (sourceSet.parts.size !== sourceSet.partCount) {
        const missing = Array.from({ length: sourceSet.partCount }, (_, index) => index + 1)
          .filter((partNumber) => !sourceSet.parts.has(partNumber));
        throw new api.ExaminationRoomApiError(
          'OFFLINE_GRADE_SOURCE_PART_MISSING',
          `The selected files do not include the graded copy for original package ${missing.join(', ')} of ${sourceSet.partCount}.`,
          409,
          'Finish grading every original numbered package, export each graded copy, then select all graded files together. No grade from this selection was imported.',
        );
      }
    }
  }

  async function importPreparedGradePayload(prepared) {
    const importResult = await api.professorCommand('import_grades', {
      examId: state.exam.id,
      grades: prepared.grades,
    }, prepared.exportBatchId);
    const importedCount = Number(importResult.importedCount || 0);
    if (importedCount !== prepared.grades.length || importResult.atomic !== true) throw new Error('atomic-import');
    return importedCount;
  }

  async function importGradingPackages(selectedFiles) {
    const files = [...(selectedFiles || [])].filter(Boolean);
    if (!files.length) return;
    const oversized = files.find((file) => file.size > MAX_OFFLINE_PACKAGE_BYTES);
    if (oversized) {
      showError({
        message: `${oversized.name || 'That grading file'} is larger than 20 MB.`,
        recovery: 'Choose the numbered graded files exported by Offline grading. Each valid file is automatically kept below 20 MB.',
      }, null, 'Package not imported');
      return;
    }
    let wrappers;
    try {
      wrappers = await Promise.all(files.map(async (file) => {
        const wrapper = JSON.parse(await file.text());
        if (wrapper.format !== 'duediligence-examination-room-offline-grading-v1') throw new Error('format');
        return wrapper;
      }));
    } catch {
      showError({
        message: 'One of the selected files is not a Due Diligence graded copy.',
        recovery: 'Select only the numbered .ddgrade.json files exported by Offline grading, then try again.',
      }, () => importGradingPackages(files), 'Package not imported');
      return;
    }
    const passphrase = await requestText({
      eyebrow: 'Encrypted offline grading',
      title: files.length > 1 ? `Unlock ${files.length} graded files` : 'Unlock the grading copy',
      copy: files.length > 1
        ? 'Enter the one passphrase used for these numbered files. They will be verified and imported in order.'
        : 'Enter the passphrase created when this exact examination copy was downloaded.',
      label: 'Passphrase',
      help: 'Every file is verified against this examination and immutable version before its grades are imported.',
      type: 'password',
      autocomplete: 'current-password',
      submitLabel: 'Verify and import',
    });
    if (!passphrase) return;
    let completedFiles = 0;
    let importedCount = 0;
    try {
      const preparedFiles = [];
      for (let index = 0; index < wrappers.length; index += 1) {
        const wrapper = wrappers[index];
        const salt = base64ToBytes(wrapper.salt);
        const iv = base64ToBytes(wrapper.iv);
        const key = await derivePackageKey(passphrase, salt);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(wrapper.ciphertext));
        const payload = JSON.parse(new TextDecoder().decode(decrypted));
        preparedFiles.push(prepareDecryptedGradePayload(payload));
      }
      validateCompleteGradedPackageSets(preparedFiles);
      for (const prepared of preparedFiles) {
        importedCount += await importPreparedGradePayload(prepared);
        completedFiles += 1;
      }
      toast(`${importedCount} offline grade${importedCount === 1 ? '' : 's'} verified and imported from ${completedFiles} file${completedFiles === 1 ? '' : 's'}. Review them before releasing results.`);
      await refreshGrading();
    } catch (error) {
      const prior = completedFiles
        ? `${completedFiles} earlier file${completedFiles === 1 ? ' was' : 's were'} already imported safely. `
        : '';
      if (completedFiles) await refreshGrading().catch(() => null);
      showError({
        message: error?.recovery ? error.message : 'A grading file could not be verified, decrypted, or imported.',
        recovery: `${prior}${error?.recovery || 'Select the complete numbered set again and use the correct passphrase. Completed files are retry-safe; every file saves all of its listed grades or none of them.'}`,
      }, () => importGradingPackages(files), 'Package not imported');
    }
  }

  async function importGradingPackage(file) {
    return importGradingPackages(file ? [file] : []);
  }

  function assistantExamContext() {
    const exam = collectExam();
    const activeSection = $('#section-navigation .is-active')?.dataset.scrollTo || 'exam-details';
    return {
      examId: safeText(exam.id, 64),
      status: safeText(exam.status, 80),
      title: safeText(exam.title, 240),
      subject: safeText(exam.subject, 180),
      yearLevel: safeText(exam.yearLevel, 100),
      instructions: safeText(exam.instructions, 8_000),
      durationMinutes: Number(exam.durationMinutes || 120),
      gradingIdentity: exam.gradingIdentity,
      integrityTier: exam.integrityTier,
      admissionMode: exam.admissionMode,
      questionCount: exam.questions.length,
      totalPoints: exam.questions.reduce((sum, question) => sum + Number(question.points || 0), 0),
      reviewIssues: reviewItems().map((item) => safeText(item.label, 500)),
      currentSection: activeSection,
      questions: exam.questions.slice(0, 40).map((question, index) => ({
        id: safeText(question.id, 160),
        number: index + 1,
        type: question.type,
        points: Number(question.points || 0),
        prompt: safeText(question.prompt, 4_000),
        choices: Array.isArray(question.options) ? question.options.map((option) => safeText(option, 800)) : [],
        correctAnswer: question.correctOption == null ? '' : safeText(question.options?.[question.correctOption], 800),
        gradingGuidance: safeText(question.gradingGuidance, 4_000),
        required: question.required !== false,
      })),
    };
  }

  const ASSISTANT_ACTION_LABELS = Object.freeze({
    focus_exam_title: 'Go to examination title',
    focus_subject: 'Go to subject',
    focus_instructions: 'Go to instructions',
    focus_questions: 'Go to questions',
    focus_exam_settings: 'Go to exam settings',
    focus_student_admission: 'Go to student admission',
    open_review: 'Open review items',
    focus_key_request: 'Go to publish and key request',
    open_monitor: 'Open monitoring',
    open_grading: 'Open grading',
    open_results: 'Open results',
    open_downloads: 'Open offline downloads',
  });

  function appendAssistantMessage(role, text, actions = []) {
    const messages = $('#assistant-messages');
    if (!messages) return;
    const article = document.createElement('article');
    article.className = `assistant-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
    const badge = document.createElement('span');
    badge.textContent = role === 'user' ? 'You' : 'AI';
    const copy = document.createElement('p');
    copy.textContent = safeText(text, 6_000);
    article.append(badge, copy);
    const safeActions = Array.isArray(actions) ? actions.slice(0, 4) : [];
    if (role !== 'user' && safeActions.length) {
      const actionWrap = document.createElement('div');
      actionWrap.className = 'assistant-message-actions';
      safeActions.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.assistantAction = safeText(action?.id, 80);
        button.textContent = safeText(action?.label, 100) || 'Apply suggestion';
        actionWrap.append(button);
      });
      article.append(actionWrap);
    }
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
  }

  async function submitAssistantPrompt(rawPrompt) {
    const prompt = safeText(rawPrompt, 1_200);
    if (!prompt || state.assistantInFlight) return;
    const historyBefore = state.assistantHistory.slice(-10);
    state.assistantHistory.push({ role: 'user', text: prompt });
    appendAssistantMessage('user', prompt);
    state.assistantInFlight = true;
    const input = $('#assistant-input');
    const submit = $('#assistant-form button[type="submit"]');
    input.value = '';
    input.disabled = true;
    submit.disabled = true;
    $('#assistant-status').textContent = 'Reviewing this draft…';
    try {
      const result = await api.professorAssistant({
        message: prompt,
        history: historyBefore.map((entry) => ({ role: entry.role, content: entry.text })),
        examContext: assistantExamContext(),
      }, api.requestId());
      const assistant = result?.assistant || result || {};
      const reply = safeText(assistant.reply, 6_000) || 'I reviewed the current draft, but no suggestion was returned. Try asking in a different way.';
      state.assistantHistory.push({ role: 'assistant', text: reply });
      state.assistantHistory = state.assistantHistory.slice(-12);
      const actions = (assistant.suggestedActionIds || []).map((id) => ({ id, label: ASSISTANT_ACTION_LABELS[id] || 'Open suggestion' }));
      appendAssistantMessage('assistant', reply, actions);
      $('#assistant-status').textContent = 'Ready · suggestions never change the draft automatically';
    } catch (error) {
      const reply = `${error?.message || 'The assistant could not respond right now.'} ${error?.recovery || 'Your draft was not changed. Try again when the connection is stable.'}`;
      state.assistantHistory.push({ role: 'assistant', text: reply });
      appendAssistantMessage('assistant', reply);
      $('#assistant-status').textContent = 'Assistant unavailable · your draft is safe';
    } finally {
      state.assistantInFlight = false;
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    }
  }

  function assistantAction(action) {
    const focus = (sectionId, selector) => {
      switchView('create');
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (selector) global.setTimeout(() => document.querySelector(selector)?.focus(), 450);
    };
    if (action === 'focus_exam_title') focus('exam-details', '#exam-title');
    else if (action === 'focus_subject') focus('exam-details', '#subject');
    else if (action === 'focus_instructions') focus('additional-details', '#instructions');
    else if (action === 'focus_questions') focus('questions', '#questions-list textarea, #questions-list input');
    else if (action === 'focus_exam_settings') focus('exam-settings');
    else if (action === 'focus_student_admission') focus('students');
    else if (action === 'open_review') showReviewItems();
    else if (action === 'focus_key_request') {
      switchView('create');
      $('#publish-exam')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      global.setTimeout(() => $('#publish-exam')?.focus(), 450);
    } else if (action === 'open_monitor') switchView('monitor');
    else if (action === 'open_grading' || action === 'open_results' || action === 'open_downloads') {
      switchView('grade');
      if (action === 'open_downloads') global.setTimeout(() => $('#export-grading-package')?.focus(), 350);
    }
  }

  function bindSectionObserver() {
    state.sectionObserver?.disconnect();
    state.sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;
      $$('#section-navigation button').forEach((button) => button.classList.toggle('is-active', button.dataset.scrollTo === visible.target.id));
    }, { rootMargin: '-25% 0px -60% 0px', threshold: [0, .15, .4] });
    ['exam-details', 'questions', 'additional-details', 'exam-settings', 'students', 'safety']
      .forEach((id) => state.sectionObserver.observe(document.getElementById(id)));
  }

  async function runOverviewAction(button, action, errorTitle) {
    if (state.overviewActionInFlight) return;
    state.overviewActionInFlight = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      await action();
    } catch (error) {
      showError(error, () => runOverviewAction(button, action, errorTitle), errorTitle);
    } finally {
      state.overviewActionInFlight = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  function bindEvents() {
    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
    $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    [$('#overview-new-exam'), $('#overview-empty-new-exam')].forEach((button) => button?.addEventListener('click', () => {
      runOverviewAction(button, openNewExamFromOverview, 'New examination not opened');
    }));
    $('#exam-overview-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-overview-action][data-exam-id]');
      if (!button) return;
      const examId = safeText(button.dataset.examId, 80);
      const action = button.dataset.overviewAction;
      if (action === 'open') runOverviewAction(button, () => openExamFromOverview(examId), 'Examination not opened');
      else if (action === 'duplicate') runOverviewAction(button, () => duplicateExamFromOverview(examId), 'Examination not duplicated');
      else if (action === 'delete') runOverviewAction(button, () => deleteExamFromOverview(examId), 'Examination not deleted');
    });
    $('#exam-switcher').addEventListener('change', async (event) => {
      const targetExamId = safeText(event.currentTarget.value, 80);
      if (!targetExamId || targetExamId === state.exam?.id) return;
      await saveDraft({ force: true });
      navigateToExam(targetExamId, state.currentView);
    });
    $('#section-navigation').addEventListener('click', (event) => {
      const button = event.target.closest('[data-scroll-to]');
      if (button) {
        $$('#section-navigation button').forEach((entry) => entry.classList.toggle('is-active', entry === button));
        document.getElementById(button.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    $$('[data-scroll-button]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.scrollButton)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
    $('#edit-title').addEventListener('click', () => { $('#command-title').readOnly = false; $('#command-title').focus(); $('#command-title').select(); });
    $('#command-title').addEventListener('blur', () => { $('#command-title').readOnly = true; });
    $('#command-title').addEventListener('input', (event) => syncTitle(event.currentTarget));
    $('#exam-title').addEventListener('input', (event) => { $('#command-title').value = event.currentTarget.value; autoResizeTitle(); scheduleAutosave(); });
    $('#save-draft').addEventListener('click', async () => {
      const button = $('#save-draft');
      setButtonBusy(button, true, 'Saving…');
      await saveDraft({ announce: true, force: true });
      setButtonBusy(button, false);
    });
    $('#preview-exam').addEventListener('click', previewExam);
    $('#publish-exam').addEventListener('click', showPublishDialog);
    $('#publish-confirmation').addEventListener('change', (event) => { $('#publish-confirm').disabled = !event.currentTarget.checked; });
    $('#publish-form').addEventListener('submit', publishExam);
    $('#review-items').addEventListener('click', () => showReviewItems());
    $('#review-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-review-section]');
      if (button) goToReviewItem(button.dataset.reviewSection, button.dataset.reviewQuestionId || null);
    });
    $('#more-actions').addEventListener('click', () => {
      const menu = $('#more-actions-menu');
      menu.hidden = !menu.hidden;
      $('#more-actions').setAttribute('aria-expanded', String(!menu.hidden));
    });
    $('#more-actions-menu').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      $('#more-actions-menu').hidden = true;
      $('#more-actions').setAttribute('aria-expanded', 'false');
      if (button.dataset.action === 'download-draft') {
        downloadJson(`examination-draft-${state.exam.id.slice(0, 8)}.json`, { exportedAt: new Date().toISOString(), exam: collectExam(), note: 'Private recovery copy. Store securely.' });
        toast('Recovery copy downloaded.');
      } else {
        toast('Version history is preserved after each publish, grade save, and recovery snapshot.');
      }
    });
    $('#add-question').addEventListener('click', () => addQuestion('essay'));
    $('#add-question-menu-button').addEventListener('click', () => {
      const menu = $('#add-question-menu');
      menu.hidden = !menu.hidden;
      $('#add-question-menu-button').setAttribute('aria-expanded', String(!menu.hidden));
    });
    $('#add-question-menu').addEventListener('click', (event) => {
      const button = event.target.closest('[data-question-type]');
      if (button) { addQuestion(button.dataset.questionType); $('#add-question-menu').hidden = true; }
    });
    $('#questions-list').addEventListener('click', (event) => {
      const questionNode = event.target.closest('[data-question-id]');
      if (!questionNode) return;
      const id = questionNode.dataset.questionId;
      const optionsButton = event.target.closest('[data-question-options-button]');
      if (optionsButton) {
        const menu = $('.question-options', questionNode);
        menu.hidden = !menu.hidden;
        optionsButton.setAttribute('aria-expanded', String(!menu.hidden));
        return;
      }
      const action = event.target.closest('[data-question-action]');
      if (action) { questionAction(id, action.dataset.questionAction); return; }
      const format = event.target.closest('[data-format-command]');
      if (format) { handleFormat(format, questionNode); return; }
      const insert = event.target.closest('[data-insert-suggestion]');
      if (insert) {
        const prompt = $('.question-prompt', questionNode);
        prompt.textContent = `${prompt.innerText.trim()} ${questionSuggestion(state.questions.find((question) => question.id === id) || {}, state.questions.findIndex((question) => question.id === id))}`.trim();
        scheduleAutosave();
        toast('Suggestion inserted for your review.');
        return;
      }
      const removeChoice = event.target.closest('[data-remove-choice]');
      if (removeChoice) {
        syncQuestionsFromDom();
        const question = state.questions.find((entry) => entry.id === id);
        if (question.options.length <= 2) {
          showError({ message: 'A multiple-choice question needs at least two options.', recovery: 'Add another option before removing this one.' }, null, 'Option not removed');
          return;
        }
        question.options.splice(Number(removeChoice.dataset.removeChoice), 1);
        question.correctOption = Math.min(question.correctOption, question.options.length - 1);
        renderQuestions(id);
        scheduleAutosave();
        return;
      }
      if (event.target.closest('[data-add-choice]')) {
        syncQuestionsFromDom();
        const question = state.questions.find((entry) => entry.id === id);
        if (question.options.length >= 10) {
          showError({ message: 'A question can contain at most ten options.', recovery: 'Remove an unused option before adding another.' }, null, 'Option not added');
          return;
        }
        question.options.push('');
        renderQuestions(id);
        scheduleAutosave();
      }
    });
    $('#questions-list').addEventListener('change', (event) => {
      const questionNode = event.target.closest('[data-question-id]');
      if (!questionNode) return;
      if (event.target.matches('[data-question-type-select]')) changeQuestionType(questionNode.dataset.questionId, event.target.value);
      else scheduleAutosave();
    });
    $('#questions-list').addEventListener('input', scheduleAutosave);
    $('#questions-list').addEventListener('paste', (event) => {
      if (!event.target.matches('[contenteditable="true"]')) return;
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    $('#add-student')?.addEventListener('click', () => addStudent());
    $('#roster-body')?.addEventListener('input', scheduleAutosave);
    $('#roster-body')?.addEventListener('change', scheduleAutosave);
    $('#roster-body')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-student]');
      const row = event.target.closest('[data-student-id]');
      if (!button || !row) return;
      syncRosterFromDom();
      state.roster = state.roster.filter((student) => student.id !== row.dataset.studentId);
      renderRoster();
      scheduleAutosave();
    });
    $('#roster-upload')?.addEventListener('change', (event) => importRoster(event.target.files?.[0]));
    $$('input[name="admission-mode"]').forEach((input) => input.addEventListener('change', () => {
      syncAdmissionControls();
      scheduleAutosave();
    }));
    $('#allowed-emails').addEventListener('input', () => {
      syncAdmissionControls();
      scheduleAutosave();
    });
    $('#source-upload').addEventListener('change', (event) => importSource(event.target.files?.[0]));
    $('#remove-source').addEventListener('click', () => {
      $('#source-file').hidden = true;
      $('#import-notice').hidden = true;
      $('#exam-details').classList.remove('has-source');
      state.exam.sourceFileName = null;
      state.exam.sourceFileSize = null;
      scheduleAutosave();
    });
    $('#view-mapping').addEventListener('click', () => toast('The uploaded headings were mapped to the numbered questions shown below. Review every prompt before publishing.'));
    $$('input[name="integrity-tier-main"]').forEach((input) => input.addEventListener('change', syncIntegrityControls));
    $$('input[name="grading-identity"]').forEach((input) => input.addEventListener('change', scheduleAutosave));
    $('#exam-form').addEventListener('input', (event) => { if (!event.target.closest('#questions-list, #roster-body') && event.target.id !== 'exam-title') scheduleAutosave(); });
    $('#exam-form').addEventListener('change', (event) => { if (!event.target.closest('#questions-list, #roster-body')) scheduleAutosave(); });
    $('#assistant-toggle').addEventListener('click', () => {
      const panel = $('#assistant-panel');
      const minimized = panel.classList.toggle('is-minimized');
      $('#assistant-toggle').setAttribute('aria-expanded', String(!minimized));
      $('#assistant-toggle').setAttribute('aria-label', minimized ? 'Open Examination Assistant' : 'Minimize Examination Assistant');
      $('#assistant-toggle i').className = `ph ${minimized ? 'ph-plus' : 'ph-minus'}`;
    });
    $('#assistant-panel').addEventListener('click', (event) => {
      const button = event.target.closest('[data-assistant-action]');
      if (button) {
        assistantAction(button.dataset.assistantAction);
        return;
      }
      const prompt = event.target.closest('[data-assistant-prompt]');
      if (prompt) submitAssistantPrompt(prompt.dataset.assistantPrompt);
    });
    $('#assistant-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitAssistantPrompt($('#assistant-input').value);
    });
    $('#assistant-input').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      $('#assistant-form').requestSubmit();
    });
    $('#refresh-monitor').addEventListener('click', () => refreshMonitor({ silent: false }));
    $('#check-activation').addEventListener('click', async () => {
      if (creatorAccessUnlocked()) switchView('monitor');
      else {
        if (state.activationPollingExpired) resetActivationPollingWindow();
        await refreshCreatorAccess({ silent: false });
      }
    });
    $('#monitor-search').addEventListener('input', renderMonitor);
    $('#monitor-table-body').addEventListener('click', (event) => {
      const revoke = event.target.closest('[data-revoke-session]');
      if (revoke) {
        revokeStudentSession(revoke.dataset.revokeSession, revoke.dataset.revokeMode || 'kick', revoke);
        return;
      }
      const button = event.target.closest('[data-view-student]');
      if (button) showStudentDetail(button.dataset.viewStudent);
    });
    $('#open-room').addEventListener('click', roomAction);
    $('#download-monitor-snapshot').addEventListener('click', downloadMonitorSnapshot);
    $('#grading-student-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-grade-session]');
      if (button) { state.selectedGradingSessionId = button.dataset.gradeSession; renderGrading(); }
    });
    $('#grading-student-list').addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-release-session]');
      if (!checkbox) return;
      if (checkbox.checked) state.selectedReleaseIds.add(checkbox.dataset.releaseSession);
      else state.selectedReleaseIds.delete(checkbox.dataset.releaseSession);
      renderGrading();
    });
    $('#grading-sheet').addEventListener('click', (event) => {
      const button = event.target.closest('[data-save-grade]');
      if (button) saveGrade(button.dataset.saveGrade, button);
    });
    $('#anonymous-grading-toggle').addEventListener('change', (event) => { state.anonymousGrading = event.target.checked; renderGrading(); });
    $('#release-results').addEventListener('click', releaseResults);
    $('#export-grading-package').addEventListener('click', exportGradingPackage);
    $('#import-grading-package').addEventListener('change', async (event) => {
      const files = [...(event.target.files || [])];
      await importGradingPackages(files);
      event.target.value = '';
    });
    $('#text-entry-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('#text-entry-input');
      if (!input.reportValidity()) return;
      finishTextEntry(input.value);
    });
    $('#text-entry-cancel').addEventListener('click', () => finishTextEntry(null));
    $('#text-entry-close').addEventListener('click', () => finishTextEntry(null));
    $('#text-entry-dialog').addEventListener('cancel', (event) => { event.preventDefault(); finishTextEntry(null); });
    $('#error-dismiss').addEventListener('click', dismissError);
    $('#error-retry').addEventListener('click', async () => { const action = state.retryAction; dismissError(); await action?.(); });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#more-actions, #more-actions-menu')) { $('#more-actions-menu').hidden = true; $('#more-actions').setAttribute('aria-expanded', 'false'); }
      if (!event.target.closest('#add-question-menu-button, #add-question-menu')) { $('#add-question-menu').hidden = true; $('#add-question-menu-button').setAttribute('aria-expanded', 'false'); }
      $$('.question-options').forEach((menu) => { if (!event.target.closest('[data-question-options-button], .question-options')) menu.hidden = true; });
    });
    document.addEventListener('visibilitychange', () => {
      if (creatorAccessPending() && !state.activationPollingExpired) {
        stopActivationPolling();
        scheduleActivationPoll();
      }
      if (state.currentView === 'monitor') {
        if (state.monitorTimer) global.clearTimeout(state.monitorTimer);
        state.monitorTimer = null;
        scheduleMonitorPoll(state.monitorPollGeneration);
      }
    });
    global.addEventListener('beforeunload', () => {
      stopMonitorPolling();
      stopActivationPolling({ abort: true });
      if (!state.exam) return;
      const record = localDraftRecord(collectExam());
      try {
        global.localStorage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(record));
        rememberActiveLocalDraft(record);
      } catch {
        // The latest successful IndexedDB save remains available for recovery.
      }
    });
    api.subscribe(() => {
      if (creatorAccessPending()) refreshCreatorAccess();
      else if (state.currentView === 'monitor') refreshMonitor();
      else if (state.currentView === 'grade' && !gradingEditorHasUnsavedChanges()) refreshGrading();
    });
  }

  function showProfessorAccessFailure(error) {
    const code = String(error?.code || 'INITIALIZATION_FAILED');
    const status = Number(error?.status || 0);
    const moduleUnavailable = code === 'API_MODULE_UNAVAILABLE';
    const signInRequired = status === 401 || [
      'SIGN_IN_REQUIRED',
      'AUTHENTICATION_REQUIRED',
      'INVALID_SESSION',
      'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED',
    ].includes(code);
    const workspaceUnavailable = status === 403 || [
      'EXAM_ROOM_V1_INSTITUTION_REQUIRED',
      'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN',
      'EXAM_ROOM_V1_FORBIDDEN',
    ].includes(code);
    const gate = $('#access-gate');
    const primary = $('#access-primary-action');
    const recovery = $('#access-recovery');

    gate.hidden = false;
    gate.dataset.accessState = moduleUnavailable ? 'module-unavailable' : signInRequired ? 'sign-in-required' : workspaceUnavailable ? 'workspace-unavailable' : 'check-interrupted';
    primary.href = moduleUnavailable ? (global.location?.href || './') : '../#examination-room';
    if (moduleUnavailable) {
      $('#access-title').textContent = 'The secure connection module did not load';
      primary.textContent = 'Reload Examination Room';
    } else if (signInRequired) {
      $('#access-title').textContent = 'Sign in to create or manage an examination';
      primary.textContent = 'Sign in through Due Diligence';
    } else if (workspaceUnavailable) {
      $('#access-title').textContent = 'The law-school workspace is unavailable';
      primary.textContent = 'Return to Examination Room doors';
    } else {
      $('#access-title').textContent = 'The Examination Room could not open';
      primary.textContent = 'Check access from Examination Room';
    }
    $('#access-copy').textContent = error?.message || 'The creator workspace could not be opened. No Professor role or license approval is required.';
    recovery.textContent = error?.recovery || (moduleUnavailable
      ? 'Reload this page. If it still does not open, check your connection and return through the Examination Room menu; no saved examination is deleted.'
      : signInRequired
      ? 'Sign in through Due Diligence. After sign-in, reopen the Examination Room menu and enter the Professor door.'
      : workspaceUnavailable
        ? 'Ask Admin to create or reopen the correct law-school workspace, then try again.'
        : 'Your saved work was not changed. Check your connection, then return to the Examination Room menu and try again.');
  }

  async function initialize() {
    if (!api) {
      $('#loading-gate').hidden = true;
      showProfessorAccessFailure({
        code: 'API_MODULE_UNAVAILABLE',
        message: 'Examination Room could not load its secure connection module.',
        recovery: 'Reload this page. If it still does not open, check your connection and return through the Examination Room menu; no saved examination is deleted.',
      });
      return;
    }
    state.offlineWorkspaceReady = registerExaminationRoomServiceWorker();
    try {
      const params = new URLSearchParams(global.location.search);
      const isDemo = api.demoEnabled();
      if (isDemo) {
        global.__examinationRoomReady = false;
        global.__examinationRoomState = state;
        global.__examinationRoomError = null;
      }
      if (isDemo && params.get('reset') === '1') {
        api.resetDemo();
        global.localStorage?.removeItem(DRAFT_STORAGE_KEY);
        global.localStorage?.removeItem(DRAFT_ACTIVE_KEY);
        global.localStorage?.removeItem(DRAFT_INDEX_KEY);
        // Consume the one-time reset flag immediately. Keeping it in the URL
        // lets a later refresh or cross-tab demo event reset a room again after
        // Admin has approved it and issued the key.
        if (global.history?.replaceState) {
          const cleanUrl = new URL(global.location.href);
          cleanUrl.searchParams.delete('reset');
          global.history.replaceState(null, '', cleanUrl.toString());
        }
      }
      const result = await api.professorQuery('session');
      state.professor = result.professor;
      state.activation = result.activation || null;
      $('#professor-short-name').textContent = result.professor.displayName || 'Exam creator';
      $('.profile-initials').textContent = initials(result.professor.displayName || 'Exam creator');
      const summaries = examSummariesFromSession(result);
      state.serverExamIds = new Set(summaries.map(examSummaryId).filter(Boolean));
      const requestedExamId = safeText(params.get('exam'), 80);
      const localDrafts = params.get('reset') === '1' ? [] : await readLocalDraftIndex();
      const activeLocalDraft = params.get('reset') === '1'
        ? null
        : (await readActiveLocalDraft()) || localDrafts[0] || null;
      const activeLocalId = safeText(activeLocalDraft?.examId, 80);
      const activeLocalServerSummary = summaries.find((candidate) => examSummaryId(candidate) === activeLocalId) || null;
      const activeLocalPreferred = Boolean(!requestedExamId && activeLocalDraft?.exam);
      const activeLocalMissingFromServer = Boolean(
        activeLocalPreferred
        && !activeLocalServerSummary
      );
      const resultExamId = examSummaryId(result.exam);
      const defaultSummary = summaries.find((candidate) => examSummaryId(candidate) === resultExamId) || summaries[0] || null;
      const summary = requestedExamId
        ? summaries.find((candidate) => examSummaryId(candidate) === requestedExamId) || { id: requestedExamId }
        : activeLocalPreferred ? (activeLocalServerSummary || activeLocalDraft.exam) : defaultSummary;
      const summaryExamId = safeText(summary?.id || summary?.examId, 80);
      let serverExam;
      let clientOnlyDraft = false;
      let exactLocalDraft = activeLocalMissingFromServer ? activeLocalDraft : null;
      if (summaryExamId) {
        if (exactLocalDraft?.exam) {
          serverExam = exactLocalDraft.exam;
          clientOnlyDraft = true;
        } else {
          try {
            const details = await api.professorQuery('exam', { examId: summaryExamId });
            serverExam = editorExamFromStored(details?.exam, summary, result.professor.institutionId);
          } catch (error) {
            exactLocalDraft = params.get('reset') === '1' ? null : await readLocalDraft(summaryExamId);
            if (!exactLocalDraft?.exam || ![404, 409].includes(Number(error?.status || 0))) throw error;
            serverExam = exactLocalDraft.exam;
            clientOnlyDraft = true;
          }
        }
      } else {
        exactLocalDraft = activeLocalDraft;
        serverExam = exactLocalDraft?.exam || clientOnlyBlankDraft(result.professor.institutionId);
        clientOnlyDraft = true;
      }
      if (isDemo) document.body.dataset.demoServerRoster = String(serverExam?.roster?.length || 0);
      const availableSummaries = examSummariesFromSession({
        exams: [...summaries, ...localDrafts.map((record) => record.exam), serverExam],
      });
      renderExamSwitcher(availableSummaries, serverExam.id);
      const local = exactLocalDraft || (params.get('reset') === '1' ? null : await readLocalDraft(serverExam.id));
      const serverFingerprint = clientOnlyDraft ? null : examContentFingerprint(serverExam);
      state.serverBaselineFingerprint = serverFingerprint;
      let exam = serverExam;
      let restoredLocalDraft = false;
      let resolvedConflict = false;
      if (local?.exam) {
        const localFingerprint = local.contentFingerprint || examContentFingerprint(local.exam);
        const baselineFingerprint = local.serverBaselineFingerprint || null;
        if (clientOnlyDraft) {
          exam = local.exam;
          restoredLocalDraft = true;
        } else if (localFingerprint === serverFingerprint) {
          exam = serverExam;
        } else if (baselineFingerprint && serverFingerprint === baselineFingerprint) {
          exam = local.exam;
          restoredLocalDraft = true;
        } else if (!(baselineFingerprint && localFingerprint === baselineFingerprint)) {
          const useDeviceDraft = await requestConfirmation({
            eyebrow: 'Draft recovery',
            title: 'This device and the server contain different changes.',
            copy: 'Choose which copy to open. Nothing is deleted, and you can still download a recovery copy before saving again.',
            help: 'Restore this device to continue its unsaved work, or keep the server copy to use the latest saved server version.',
            confirmLabel: 'Restore this device',
            cancelLabel: 'Keep server copy',
          });
          exam = useDeviceDraft ? local.exam : serverExam;
          restoredLocalDraft = useDeviceDraft;
          resolvedConflict = true;
          if (!useDeviceDraft) await saveLocalDraft(serverExam).catch(() => null);
        }
      }
      hydrateForm(exam);
      if (clientOnlyDraft) {
        await saveLocalDraft(exam);
      }
      bindEvents();
      bindSectionObserver();
      if (global.matchMedia?.('(max-width: 820px)').matches) {
        $('#assistant-panel').classList.add('is-minimized');
        $('#assistant-toggle').setAttribute('aria-expanded', 'false');
        $('#assistant-toggle').setAttribute('aria-label', 'Open Examination Assistant');
        $('#assistant-toggle i').className = 'ph ph-plus';
      }
      $('#loading-gate').hidden = true;
      $('#app-shell').hidden = false;
      const explicitView = global.location.hash.replace('#', '') || params.get('view');
      const requestedView = explicitView || (requestedExamId ? 'create' : 'overview');
      switchView(['overview', 'create', 'monitor', 'grade'].includes(requestedView) ? requestedView : 'overview');
      if (restoredLocalDraft) {
        setSavedStatus('error', 'Restored from this device');
        toast(resolvedConflict
          ? 'This device’s draft was restored by your choice. Save draft to make it the server copy.'
          : 'A device-only draft was restored. Save draft to back it up to the server.');
      } else if (resolvedConflict) {
        setSavedStatus('saved', 'Kept server copy');
        toast('The server copy was kept by your choice. The conflicting device draft was not published.');
      } else if (clientOnlyDraft) {
        setSavedStatus('error', 'Saved on device · server backup pending');
      }
      if (isDemo) global.__examinationRoomReady = true;
    } catch (error) {
      $('#loading-gate').hidden = true;
      showProfessorAccessFailure(error);
      if (api.demoEnabled()) {
        global.__examinationRoomReady = false;
        global.__examinationRoomError = { code: error?.code || 'INITIALIZATION_FAILED', message: error?.message || String(error) };
      }
    }
  }

  initialize();
})(window);
