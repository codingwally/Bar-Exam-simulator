(function () {
  'use strict';

  /**
   * Host API contract: set window.ExaminationRoomV1Api before this file runs.
   *
   * Required Promise-returning methods:
   * - previewRoom(entry) -> exam metadata only; never include questions.
   * - beginAttempt({ examId, examVersion, roomKey, student, attemptBindingId, client })
   *     -> { attemptId, sessionToken, serverNow, startedAt, expiresAt }.
   * - loadExam({ attemptId, sessionToken }) -> { questions }.
   * - syncOperations({ attemptId, sessionToken, operations })
   *     -> { acknowledgedOperationIds, serverRevision }.
   * - submitAttempt({ attemptId, sessionToken, idempotencyKey, ...finalSnapshot })
   *     -> a signed receipt with receiptId, submittedAt, signature, answerCount,
   *        and examVersion.
   *
   * Operation IDs and submission idempotency keys must be honored idempotently.
   * Rejections may include code, userMessage, workEffect, and retryable fields.
   * The local demo adapter is installed only when the URL contains ?demo=1.
   */

  var APP_VERSION = '1.0.0';
  var DB_NAME = 'duediligence-examination-room-v1';
  var DB_VERSION = 1;
  var DB_OPEN_TIMEOUT_MS = 5000;
  var DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';
  var REQUIRED_API_METHODS = [
    'previewRoom',
    'beginAttempt',
    'loadExam',
    'syncOperations',
    'submitAttempt'
  ];

  var state = {
    api: null,
    db: null,
    storageReady: false,
    entry: null,
    context: null,
    metadata: null,
    attemptBindingId: null,
    attempt: null,
    questions: [],
    answers: {},
    flags: {},
    currentIndex: 0,
    syncing: false,
    submitting: false,
    timerId: null,
    timerThresholdsAnnounced: {},
    timeExpiryHandled: false,
    syncTimer: null,
    answerTimers: new Map(),
    lastIntegrityEvent: {},
    receipt: null,
    resultTimer: null,
    resultUnsubscribe: null,
    resultChecking: false,
    media: null,
    mediaAttemptId: null,
    view: 'entry'
  };

  var elements = {};

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    cacheElements();
    bindEvents();
    registerExaminationRoomServiceWorker();

    if (window.ExaminationRoomMediaCapture && typeof window.ExaminationRoomMediaCapture.create === 'function') {
      state.media = window.ExaminationRoomMediaCapture.create({ onStatus: handleMediaStatus });
    }

    if (DEMO_MODE && !resolveApiAdapter()) {
      window.ExaminationRoomV1Api = createDemoAdapter();
    }

    state.api = resolveApiAdapter();
    if (DEMO_MODE) {
      elements.demoModeNote.hidden = false;
      prefillDemoEntry();
    }
    updateConnectionUI();
    if (!state.api) {
      showError(elements.entryError, { code: 'API_UNAVAILABLE' }, function () {
        window.location.reload();
      });
    }

    try {
      state.db = await openDatabase();
      state.storageReady = true;
    } catch (error) {
      state.storageReady = false;
      showError(elements.entryError, {
        code: 'STORAGE_UNAVAILABLE',
        cause: error
      });
      elements.previewButton.disabled = true;
    }
  }

  function registerExaminationRoomServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/service-worker.js?v=examination-room-reliability-20260828-1')
      .catch(function () {
        // Registration failure must never block a student who still has a
        // working network connection. The exam UI already reports offline
        // persistence status and keeps the attempt recoverable in IndexedDB.
      });
  }

  function cacheElements() {
    var ids = [
      'connectionLabel', 'studentIdentity', 'entryView', 'roomEntryForm',
      'roomKey', 'fullName', 'email', 'studentNumber', 'yearLevel', 'subject',
      'previewButton', 'entryError', 'demoModeNote', 'examPreview',
      'previewExamTitle', 'previewSubject', 'previewProfessor',
      'previewDuration', 'previewQuestionCount', 'previewAvailability',
      'previewSafeguards', 'changeDetailsButton', 'beginButton',
      'examView', 'examTitle', 'examSubjectLine', 'mediaStatus', 'saveStatus', 'timerBox',
      'timerValue', 'fullscreenButton', 'offlineNotice', 'examError',
      'progressText', 'answerProgress', 'questionList', 'submitOpenButton',
      'questionPosition', 'questionType', 'flagButton', 'questionContent',
      'previousButton', 'nextButton', 'submitDialog', 'submitAnswered',
      'submitUnanswered', 'submitFlagged', 'submitWarning', 'submitError',
      'continueExamButton', 'confirmSubmitButton', 'receiptView',
      'receiptIcon', 'receiptEyebrow', 'receiptTitle', 'receiptMessage',
      'pendingSubmissionNote', 'receiptDetails', 'receiptReference',
      'receiptSubmittedAt', 'receiptExamVersion', 'receiptAnswerCount',
      'receiptSignature', 'receiptError', 'retrySubmissionButton',
      'printReceiptButton', 'resultPanel', 'resultStatusIcon', 'resultTitle',
      'resultMessage', 'resultCheckedAt', 'resultRefreshButton',
      'resultSummary', 'resultTotalScore', 'resultTotalPossible',
      'resultReleasedAt', 'resultQuestionList', 'resultError',
      'toastRegion', 'assertiveStatus'
    ];

    ids.forEach(function (id) {
      elements[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    elements.roomEntryForm.addEventListener('submit', handlePreviewRequest);
    elements.changeDetailsButton.addEventListener('click', unlockEntryDetails);
    elements.beginButton.addEventListener('click', handleBeginExam);

    elements.previousButton.addEventListener('click', function () {
      navigateToQuestion(state.currentIndex - 1);
    });
    elements.nextButton.addEventListener('click', function () {
      navigateToQuestion(state.currentIndex + 1);
    });
    elements.flagButton.addEventListener('click', toggleCurrentQuestionFlag);
    elements.fullscreenButton.addEventListener('click', toggleFullscreen);
    elements.submitOpenButton.addEventListener('click', openSubmitDialog);
    elements.continueExamButton.addEventListener('click', closeSubmitDialog);
    elements.confirmSubmitButton.addEventListener('click', function () {
      startSubmission(false);
    });
    elements.retrySubmissionButton.addEventListener('click', retryPendingSubmission);
    elements.printReceiptButton.addEventListener('click', function () {
      window.print();
    });
    elements.resultRefreshButton.addEventListener('click', function () {
      checkForReleasedResult(true);
    });

    elements.submitDialog.addEventListener('cancel', function (event) {
      if (state.submitting) {
        event.preventDefault();
      }
    });

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    window.addEventListener('blur', function () {
      logIntegrityEvent('window_blurred');
    });
    window.addEventListener('focus', function () {
      logIntegrityEvent('window_focused');
    });
    document.addEventListener('visibilitychange', function () {
      logIntegrityEvent(document.hidden ? 'page_hidden' : 'page_visible');
      if (!document.hidden && state.view === 'receipt') checkForReleasedResult(false);
    });
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    elements.roomKey.addEventListener('blur', function () {
      elements.roomKey.value = normaliseRoomKey(elements.roomKey.value);
    });
  }

  function resolveApiAdapter() {
    var adapter = window.ExaminationRoomV1Api;
    if (!adapter || typeof adapter !== 'object') {
      return null;
    }

    var valid = REQUIRED_API_METHODS.every(function (method) {
      return typeof adapter[method] === 'function';
    });

    return valid ? adapter : null;
  }

  async function handlePreviewRequest(event) {
    event.preventDefault();
    clearError(elements.entryError);

    if (!state.storageReady) {
      showError(elements.entryError, { code: 'STORAGE_UNAVAILABLE' });
      return;
    }

    if (!elements.roomEntryForm.checkValidity()) {
      elements.roomEntryForm.reportValidity();
      return;
    }

    var entry = readEntryForm();
    setButtonBusy(elements.previewButton, true, 'Checking details');
    setEntryFieldsDisabled(true);

    try {
      var context = await buildEntryContext(entry);
      var cached = await databaseGet('cache', 'preview:' + context.entryHash);
      var previewBundle = null;
      var usedCache = false;

      if (navigator.onLine && state.api) {
        try {
          var metadata = await state.api.previewRoom(copyObject(entry));
          validateMetadata(metadata);
          if (metadata.admissionMode === 'email_allowlist' && !entry.email) {
            throw createAppError('EMAIL_REQUIRED');
          }
          previewBundle = { metadata: metadata };
          await databasePut('cache', {
            id: 'preview:' + context.entryHash,
            entryHash: context.entryHash,
            metadata: metadata,
            cachedAt: new Date().toISOString()
          });
        } catch (liveError) {
          var liveCode = String(liveError && liveError.code || '').replace(/^EXAM_ROOM_V1_/, '');
           var accessWasDenied = [
             'INVALID_ROOM_KEY',
             'ROOM_KEY_INVALID',
             'IDENTITY_MISMATCH',
             'SUBJECT_MISMATCH',
             'STUDENT_EMAIL_REQUIRED',
            'STUDENT_EMAIL_INVALID',
            'STUDENT_EMAIL_NOT_ALLOWED',
            'STUDENT_EMAIL_MISMATCH',
            'ROSTER_NAME_MISMATCH',
             'STUDENT_BLOCKED',
             'ROOM_CLOSED',
             'ROOM_NOT_OPEN',
             'EXAMINATION_ARCHIVED',
             'EXAMINATION_BLOCKED'
           ].indexOf(liveCode) !== -1;
           if (!accessWasDenied && cached && isUsableCachedPreview(cached, context)) {
             previewBundle = { metadata: cached.metadata };
            usedCache = true;
            showToast('The live check could not finish. A previously verified preview is shown so you can resume saved work.', 'ph-clock-counter-clockwise');
          } else {
            throw liveError;
          }
        }
      } else if (cached && isUsableCachedPreview(cached, context)) {
        previewBundle = { metadata: cached.metadata };
        usedCache = true;
      } else if (!state.api) {
        throw createAppError('API_UNAVAILABLE');
      } else {
        throw createAppError('OFFLINE_NO_PREVIEW');
      }

      state.entry = entry;
      state.context = context;
      state.metadata = previewBundle.metadata;
      state.attemptBindingId = await createAttemptBindingId(context, previewBundle.metadata);

      renderExamPreview(usedCache);
      elements.examPreview.hidden = false;
      elements.examPreview.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    } catch (error) {
      setEntryFieldsDisabled(false);
      showError(elements.entryError, error, function () {
        elements.roomEntryForm.requestSubmit();
      });
    } finally {
      setButtonBusy(elements.previewButton, false);
    }
  }

  function readEntryForm() {
    return {
      roomKey: normaliseRoomKey(elements.roomKey.value),
      fullName: normaliseHumanText(elements.fullName.value),
      email: normaliseEmail(elements.email.value),
      studentNumber: normaliseHumanText(elements.studentNumber.value),
      subject: normaliseHumanText(elements.subject.value),
      yearLevel: elements.yearLevel.value
    };
  }

  async function buildEntryContext(entry) {
    var roomKeyHash = await digestText(entry.roomKey);
    var studentHash = await digestText([
      entry.studentNumber.toLocaleLowerCase(),
      entry.email
    ].join('|'));
    var identityMaterial = [
      roomKeyHash,
      entry.fullName.toLocaleLowerCase(),
      entry.email,
      entry.studentNumber.toLocaleLowerCase(),
      entry.subject.toLocaleLowerCase(),
      entry.yearLevel
    ].join('|');

    return {
      roomKeyHash: roomKeyHash,
      studentHash: studentHash,
      entryHash: await digestText(identityMaterial)
    };
  }

  function isUsableCachedPreview(cached, context) {
    return Boolean(cached && cached.entryHash === context.entryHash && cached.metadata);
  }

  function validateMetadata(metadata) {
    var required = [
      'examId', 'examVersion', 'title', 'subject', 'professor',
      'durationMinutes', 'questionCount'
    ];
    var valid = metadata && typeof metadata === 'object' && required.every(function (key) {
      return metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '';
    });

    if (!valid || !Number.isFinite(Number(metadata.durationMinutes)) || !Number.isFinite(Number(metadata.questionCount))) {
      throw createAppError('PREVIEW_INVALID');
    }
  }

  function renderExamPreview(usedCache) {
    var metadata = state.metadata;
    setText(elements.previewExamTitle, metadata.title);
    setText(elements.previewSubject, metadata.subject);
    setText(elements.previewProfessor, metadata.professor);
    setText(elements.previewDuration, formatDuration(metadata.durationMinutes));
    setText(elements.previewQuestionCount, String(metadata.questionCount));
    setText(elements.previewAvailability, formatAvailability(metadata));

    elements.previewSafeguards.replaceChildren();
    var safeguards = Array.isArray(metadata.safeguards) && metadata.safeguards.length
      ? metadata.safeguards
      : [
          'Answers are saved on this device while you work.',
          'Connection changes are handled without clearing your answers.',
          'A signed receipt confirms successful submission.'
        ];
    safeguards.forEach(function (item) {
      elements.previewSafeguards.appendChild(createElement('li', '', String(item)));
    });

    elements.beginButton.querySelector('span').textContent = usedCache
      ? 'Resume saved examination'
      : 'Begin examination';
  }

  async function createAttemptBindingId(context, metadata) {
    return 'attempt-binding:' + await digestText([
      metadata.examId,
      metadata.examVersion,
      context.roomKeyHash,
      context.studentHash
    ].join('|'));
  }

  function unlockEntryDetails() {
    elements.examPreview.hidden = true;
    setEntryFieldsDisabled(false);
    elements.roomKey.focus();
  }

  async function handleBeginExam() {
    clearError(elements.entryError);
    if (!state.entry || !state.context || !state.metadata || !state.attemptBindingId) {
      showError(elements.entryError, { code: 'PREVIEW_REQUIRED' });
      return;
    }

    setButtonBusy(elements.beginButton, true, 'Opening examination');

    try {
      var resumed = await restoreMatchingAttempt();
      if (resumed) return;

      if (!navigator.onLine) {
        throw createAppError('OFFLINE_NEW_ATTEMPT');
      }
      if (!state.api) {
        throw createAppError('API_UNAVAILABLE');
      }

      var beginResult = await state.api.beginAttempt({
        examId: state.metadata.examId,
        examVersion: state.metadata.examVersion,
        roomKey: state.entry.roomKey,
        student: {
          fullName: state.entry.fullName,
          email: state.entry.email,
          studentNumber: state.entry.studentNumber,
          subject: state.entry.subject,
          yearLevel: state.entry.yearLevel
        },
        attemptBindingId: state.attemptBindingId,
        client: {
          appVersion: APP_VERSION,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
        }
      });
      validateBeginResult(beginResult);

      var examResult = await state.api.loadExam({
        attemptId: beginResult.attemptId,
        sessionToken: beginResult.sessionToken
      });
      var questions = validateQuestions(examResult && examResult.questions, state.metadata.questionCount);

      var serverNow = Date.parse(beginResult.serverNow);
      var clientNow = Date.now();
      state.attempt = {
        attemptId: beginResult.attemptId,
        examId: state.metadata.examId,
        examVersion: state.metadata.examVersion,
        entryHash: state.context.entryHash,
        attemptBindingId: state.attemptBindingId,
        sessionToken: beginResult.sessionToken,
        student: {
          fullName: state.entry.fullName,
          email: state.entry.email,
          studentNumber: state.entry.studentNumber,
          subject: state.entry.subject,
          yearLevel: state.entry.yearLevel
        },
        metadata: state.metadata,
        questions: questions,
        answers: {},
        flags: {},
        currentIndex: 0,
        clientSequence: 0,
        serverRevision: null,
        startedAt: beginResult.startedAt,
        expiresAt: beginResult.expiresAt,
        clockOffsetMs: Number.isFinite(serverNow) ? serverNow - clientNow : 0,
        status: 'in_progress',
        idempotencyKey: null,
        clientCompletedAt: null,
        automaticSubmission: false,
        timeExpired: false,
        updatedAt: new Date().toISOString()
      };
      state.questions = questions;
      state.answers = {};
      state.flags = {};
      state.currentIndex = 0;

      await persistAttempt();
      await databasePut('cache', {
        id: activeAttemptPointerId(),
        attemptId: state.attempt.attemptId,
        examId: state.attempt.examId,
        examVersion: state.attempt.examVersion,
        entryHash: state.attempt.entryHash,
        attemptBindingId: state.attempt.attemptBindingId,
        updatedAt: state.attempt.updatedAt
      });

      enterExamWorkspace();
      await logIntegrityEvent('attempt_started', { appVersion: APP_VERSION });
    } catch (error) {
      showError(elements.entryError, error, handleBeginExam);
    } finally {
      setButtonBusy(elements.beginButton, false);
    }
  }

  function validateBeginResult(result) {
    if (!result || !result.attemptId || !result.sessionToken || !result.startedAt || !result.expiresAt || !result.serverNow) {
      throw createAppError('ATTEMPT_INVALID');
    }
    if (!Number.isFinite(Date.parse(result.expiresAt)) || !Number.isFinite(Date.parse(result.startedAt))) {
      throw createAppError('ATTEMPT_INVALID');
    }
  }

  function validateQuestions(questions, expectedCount) {
    if (!Array.isArray(questions) || !questions.length) {
      throw createAppError('QUESTIONS_UNAVAILABLE');
    }
    if (Number(expectedCount) !== questions.length) {
      throw createAppError('QUESTION_COUNT_CHANGED');
    }

    var seenIds = new Set();
    return questions.map(function (question, index) {
      if (!question || !question.id || !question.type || !question.prompt || seenIds.has(question.id)) {
        throw createAppError('QUESTIONS_UNAVAILABLE');
      }
      if (['essay', 'multiple_choice', 'short_answer'].indexOf(question.type) === -1) {
        throw createAppError('QUESTION_TYPE_UNSUPPORTED');
      }
      if (question.type === 'multiple_choice' && (!Array.isArray(question.options) || question.options.length < 2)) {
        throw createAppError('QUESTIONS_UNAVAILABLE');
      }
      seenIds.add(question.id);
      return {
        id: String(question.id),
        number: question.number || index + 1,
        type: question.type,
        title: question.title || 'Question ' + (index + 1),
        prompt: String(question.prompt),
        instructions: question.instructions ? String(question.instructions) : '',
        required: question.required !== false,
        maxWords: Number.isFinite(Number(question.maxWords)) ? Number(question.maxWords) : null,
        maxLength: Number.isFinite(Number(question.maxLength)) ? Number(question.maxLength) : null,
        options: Array.isArray(question.options) ? question.options.map(function (option, optionIndex) {
          if (typeof option === 'string') {
            return { id: 'option-' + (optionIndex + 1), label: option };
          }
          return { id: String(option.id), label: String(option.label) };
        }) : []
      };
    });
  }

  async function restoreMatchingAttempt() {
    var pointer = await databaseGet('cache', activeAttemptPointerId());
    if (!pointer || pointer.entryHash !== state.context.entryHash) {
      return false;
    }
    if (pointer.attemptBindingId && pointer.attemptBindingId !== state.attemptBindingId) {
      return false;
    }

    var attempt = await databaseGet('attempts', pointer.attemptId);
    if (!attempt) {
      return false;
    }

    var exactMatch = attempt.examId === state.metadata.examId &&
      attempt.examVersion === state.metadata.examVersion &&
      attempt.entryHash === state.context.entryHash &&
      (!attempt.attemptBindingId || attempt.attemptBindingId === state.attemptBindingId);
    if (!exactMatch) {
      return false;
    }

    state.attempt = attempt;
    state.attempt.attemptBindingId = state.attemptBindingId;
    state.questions = Array.isArray(attempt.questions) ? attempt.questions : [];
    state.answers = attempt.answers || {};
    state.flags = attempt.flags || {};
    state.currentIndex = clamp(Number(attempt.currentIndex) || 0, 0, Math.max(0, state.questions.length - 1));
    state.metadata = attempt.metadata || state.metadata;

    if (attempt.status === 'submitted') {
      resumeMediaUploads();
      var receipt = await databaseGet('receipts', attempt.attemptId);
      if (receipt) {
        renderReceipt(receipt);
        return true;
      }
    }

    if (!state.questions.length) {
      if (!navigator.onLine || !state.api) {
        throw createAppError('OFFLINE_EXAM_NOT_SAVED');
      }
      var examResult = await state.api.loadExam({
        attemptId: attempt.attemptId,
        sessionToken: attempt.sessionToken
      });
      state.questions = validateQuestions(examResult && examResult.questions, state.metadata.questionCount);
      state.attempt.questions = state.questions;
      await persistAttempt();
    }

    if (attempt.status === 'pending_submit') {
      resumeMediaUploads();
      renderPendingSubmission();
      retryPendingSubmission();
      return true;
    }

    enterExamWorkspace();
    showToast('Your saved examination has been restored on this device.', 'ph-arrow-counter-clockwise');
    return true;
  }

  function activeAttemptPointerId() {
    return 'active:' + state.metadata.examId + ':' + state.context.entryHash;
  }

  function enterExamWorkspace() {
    stopResultWatch();
    state.view = 'exam';
    elements.entryView.hidden = true;
    elements.receiptView.hidden = true;
    elements.examView.hidden = false;
    elements.studentIdentity.hidden = false;
    elements.studentIdentity.textContent = state.attempt.student.fullName + ' · ' + state.attempt.student.studentNumber;
    elements.examTitle.textContent = state.attempt.metadata.title;
    elements.examSubjectLine.textContent = state.attempt.metadata.subject + ' · ' + state.attempt.student.yearLevel;
    document.title = state.attempt.metadata.title + ' | Examination Room';
    state.timeExpiryHandled = false;
    state.timerThresholdsAnnounced = {};
    updateConnectionUI();
    renderQuestionNavigator();
    renderQuestion(state.currentIndex, true);
    updateProgress();
    updateSaveStatus(navigator.onLine ? 'saved' : 'local');
    startTimer();
    window.scrollTo({ top: 0, behavior: 'auto' });
    scheduleQueueSync(100);
    startMediaCapture();
  }

  function startMediaCapture() {
    if (!state.media || !state.attempt || state.mediaAttemptId === state.attempt.attemptId) return;
    var metadata = state.attempt.metadata || {};
    var cameraRequired = metadata.cameraRequired === true;
    var microphoneRequired = metadata.microphoneRequired === true;
    if (!cameraRequired && !microphoneRequired) {
      elements.mediaStatus.hidden = true;
      return;
    }
    state.mediaAttemptId = state.attempt.attemptId;
    state.media.start({
      attemptId: state.attempt.attemptId,
      sessionToken: state.attempt.sessionToken,
      examId: state.attempt.examId,
      startedAt: state.attempt.startedAt,
      cameraRequired: cameraRequired,
      microphoneRequired: microphoneRequired
    }).catch(function (error) {
      handleMediaStatus({
        state: 'unavailable',
        message: 'Recording could not start. Your examination remains open and answers continue saving.',
        error: error
      });
    });
  }

  function resumeMediaUploads() {
    if (!state.media || typeof state.media.resume !== 'function' || !state.attempt) return;
    var metadata = state.attempt.metadata || {};
    var cameraRequired = metadata.cameraRequired === true;
    var microphoneRequired = metadata.microphoneRequired === true;
    if (!cameraRequired && !microphoneRequired) return;
    state.mediaAttemptId = state.attempt.attemptId;
    state.media.resume({
      attemptId: state.attempt.attemptId,
      sessionToken: state.attempt.sessionToken,
      examId: state.attempt.examId,
      startedAt: state.attempt.startedAt,
      cameraRequired: cameraRequired,
      microphoneRequired: microphoneRequired
    }).catch(function (error) {
      handleMediaStatus({
        state: 'queued',
        message: 'Encrypted recording backup will retry separately. Your submission remains complete.',
        error: error
      });
    });
  }

  function handleMediaStatus(update) {
    if (!elements.mediaStatus || !update) return;
    var stateName = String(update.state || 'queued');
    var icons = {
      requesting: 'ph-spinner-gap',
      active: 'ph-record',
      queued: 'ph-cloud-arrow-up',
      finishing: 'ph-hourglass-medium',
      permission_denied: 'ph-video-camera-slash',
      unavailable: 'ph-video-camera-slash',
      storage_full: 'ph-hard-drives'
    };
    elements.mediaStatus.hidden = stateName === 'disabled';
    elements.mediaStatus.dataset.state = stateName;
    var icon = elements.mediaStatus.querySelector('i');
    var label = elements.mediaStatus.querySelector('span');
    if (icon) icon.className = 'ph ' + (icons[stateName] || 'ph-video-camera');
    if (label) label.textContent = update.message || 'Recording status updated.';
  }

  function setView(view) {
    state.view = view;
    elements.entryView.hidden = view !== 'entry';
    elements.examView.hidden = view !== 'exam';
    elements.receiptView.hidden = view !== 'receipt';
  }

  function renderQuestionNavigator() {
    elements.questionList.replaceChildren();
    state.questions.forEach(function (question, index) {
      var button = createElement('button', 'question-nav-button');
      button.type = 'button';
      button.dataset.questionIndex = String(index);
      button.setAttribute('aria-label', 'Go to question ' + question.number + ', ' + questionStatusText(question.id));
      if (index === state.currentIndex) {
        button.setAttribute('aria-current', 'step');
      }
      if (hasAnswer(question.id)) {
        button.classList.add('is-answered');
      }
      if (state.flags[question.id]) {
        button.classList.add('is-flagged');
      }

      var number = createElement('span', 'question-number', String(question.number));
      var label = createElement('span', 'question-nav-label', question.title);
      var icon = createElement('i', 'ph question-status-icon');
      icon.setAttribute('aria-hidden', 'true');
      if (state.flags[question.id]) {
        icon.classList.add('ph-flag');
      } else if (hasAnswer(question.id)) {
        icon.classList.add('ph-check-circle');
      } else {
        icon.classList.add('ph-circle');
      }

      button.append(number, label, icon);
      button.addEventListener('click', function () {
        navigateToQuestion(index);
      });
      elements.questionList.appendChild(button);
    });
  }

  function updateQuestionNavigatorState() {
    var buttons = elements.questionList.querySelectorAll('.question-nav-button');
    buttons.forEach(function (button) {
      var index = Number(button.dataset.questionIndex);
      var question = state.questions[index];
      if (!question) {
        return;
      }
      var answered = hasAnswer(question.id);
      var flagged = Boolean(state.flags[question.id]);
      button.classList.toggle('is-answered', answered);
      button.classList.toggle('is-flagged', flagged);
      button.setAttribute('aria-label', 'Go to question ' + question.number + ', ' + questionStatusText(question.id));
      var icon = button.querySelector('.question-status-icon');
      if (icon) {
        icon.className = 'ph question-status-icon ' + (flagged ? 'ph-flag' : answered ? 'ph-check-circle' : 'ph-circle');
      }
    });
  }

  function renderQuestion(index, shouldFocus) {
    if (!state.questions.length) {
      return;
    }

    state.currentIndex = clamp(index, 0, state.questions.length - 1);
    state.attempt.currentIndex = state.currentIndex;
    persistAttempt().catch(handleLocalSaveFailure);

    var question = state.questions[state.currentIndex];
    elements.questionPosition.textContent = 'Question ' + question.number + ' of ' + state.questions.length;
    elements.questionType.textContent = questionTypeLabel(question.type);
    elements.flagButton.setAttribute('aria-pressed', state.flags[question.id] ? 'true' : 'false');
    elements.flagButton.querySelector('span').textContent = state.flags[question.id] ? 'Flagged for review' : 'Flag for review';
    elements.previousButton.disabled = state.currentIndex === 0;
    // On the final question this same control becomes the primary path into
    // the review dialog. Keep it enabled so a student cannot reach the end
    // of the examination and appear to be stuck.
    elements.nextButton.disabled = false;
    elements.nextButton.querySelector('span').textContent = state.currentIndex === state.questions.length - 1 ? 'Review and submit' : 'Next question';
    elements.nextButton.querySelector('i').className = state.currentIndex === state.questions.length - 1
      ? 'ph ph-paper-plane-tilt'
      : 'ph ph-arrow-right';

    elements.questionContent.replaceChildren();
    var heading = createElement('h2', '', question.title);
    heading.id = 'activeQuestionTitle';
    heading.tabIndex = -1;
    elements.questionContent.appendChild(heading);

    var prompt = createElement('div', 'question-prompt');
    question.prompt.split(/\n+/).filter(Boolean).forEach(function (paragraph) {
      prompt.appendChild(createElement('p', '', paragraph));
    });
    elements.questionContent.appendChild(prompt);

    if (question.instructions) {
      elements.questionContent.appendChild(createElement('div', 'question-instructions', question.instructions));
    }

    if (question.type === 'multiple_choice') {
      renderMultipleChoice(question);
    } else {
      renderWrittenAnswer(question);
    }

    renderQuestionNavigator();
    updateProgress();

    if (shouldFocus) {
      window.requestAnimationFrame(function () {
        heading.focus({ preventScroll: true });
      });
    }
  }

  function renderWrittenAnswer(question) {
    var wrapper = createElement('div', 'answer-field ' + (question.type === 'short_answer' ? 'short-answer' : 'essay-answer'));
    var label = createElement('label', 'answer-label');
    label.htmlFor = 'answer-' + safeDomId(question.id);
    var labelText = createElement('span', '', question.type === 'essay' ? 'Your essay answer' : 'Your answer');
    label.appendChild(labelText);

    var count = null;
    if (question.type === 'essay') {
      count = createElement('span', 'word-count');
      count.id = 'word-count-' + safeDomId(question.id);
      label.appendChild(count);
    }

    var textarea = createElement('textarea');
    textarea.id = 'answer-' + safeDomId(question.id);
    textarea.value = typeof state.answers[question.id] === 'string' ? state.answers[question.id] : '';
    textarea.rows = question.type === 'essay' ? 16 : 6;
    textarea.placeholder = question.type === 'essay'
      ? 'Write your legal analysis here. Your work is saved as you type.'
      : 'Write your answer here.';
    if (count) {
      textarea.setAttribute('aria-describedby', count.id);
    }
    if (question.maxLength) {
      textarea.maxLength = question.maxLength;
    }
    if (state.attempt.status !== 'in_progress') {
      textarea.disabled = true;
    }

    textarea.addEventListener('input', function () {
      state.answers[question.id] = textarea.value;
      if (count) {
        updateWordCount(count, textarea.value, question.maxWords);
      }
      updateProgress();
      updateQuestionNavigatorState();
      updateSaveStatus('saving');
      scheduleAnswerSave(question.id);
    });
    textarea.addEventListener('change', function () {
      saveAnswerImmediately(question.id);
    });

    wrapper.append(label, textarea);
    elements.questionContent.appendChild(wrapper);
    if (count) {
      updateWordCount(count, textarea.value, question.maxWords);
    }
  }

  function renderMultipleChoice(question) {
    var fieldset = createElement('fieldset', 'choice-fieldset');
    var legend = createElement('legend', 'visually-hidden', 'Choose one answer for question ' + question.number);
    var list = createElement('div', 'choice-list');
    var groupName = 'choice-' + safeDomId(question.id);

    question.options.forEach(function (option) {
      var label = createElement('label', 'choice-option');
      var input = createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = option.id;
      input.checked = state.answers[question.id] === option.id;
      input.disabled = state.attempt.status !== 'in_progress';
      var text = createElement('span', '', option.label);
      input.addEventListener('change', function () {
        if (input.checked) {
          state.answers[question.id] = option.id;
          updateProgress();
          updateQuestionNavigatorState();
          updateSaveStatus('saving');
          saveAnswerImmediately(question.id);
        }
      });
      label.append(input, text);
      list.appendChild(label);
    });

    fieldset.append(legend, list);
    elements.questionContent.appendChild(fieldset);
  }

  async function navigateToQuestion(index) {
    if (index < 0 || index >= state.questions.length) {
      if (index >= state.questions.length) {
        openSubmitDialog();
      }
      return;
    }
    await flushPendingAnswerSaves();
    renderQuestion(index, true);
    var workspace = elements.questionContent.closest('.question-workspace');
    if (workspace) {
      workspace.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  async function toggleCurrentQuestionFlag() {
    var question = state.questions[state.currentIndex];
    if (!question || state.attempt.status !== 'in_progress') {
      return;
    }
    state.flags[question.id] = !state.flags[question.id];
    await persistAttempt();
    await enqueueOperation('question.flag_changed', {
      questionId: question.id,
      flagged: Boolean(state.flags[question.id])
    });
    renderQuestion(state.currentIndex, false);
  }

  function scheduleAnswerSave(questionId) {
    if (state.answerTimers.has(questionId)) {
      window.clearTimeout(state.answerTimers.get(questionId));
    }
    var timer = window.setTimeout(function () {
      state.answerTimers.delete(questionId);
      saveAnswerImmediately(questionId);
    }, 360);
    state.answerTimers.set(questionId, timer);
  }

  async function saveAnswerImmediately(questionId) {
    if (!state.attempt || state.attempt.status !== 'in_progress') {
      return;
    }
    if (state.answerTimers.has(questionId)) {
      window.clearTimeout(state.answerTimers.get(questionId));
      state.answerTimers.delete(questionId);
    }

    try {
      state.attempt.answers = copyObject(state.answers);
      state.attempt.flags = copyObject(state.flags);
      await persistAttempt();
      await enqueueOperation('answer.changed', {
        questionId: questionId,
        answer: state.answers[questionId] === undefined ? null : state.answers[questionId],
        flagged: Boolean(state.flags[questionId])
      });
      updateSaveStatus(navigator.onLine ? 'saving' : 'local');
    } catch (error) {
      handleLocalSaveFailure(error);
    }
  }

  async function flushPendingAnswerSaves() {
    var questionIds = Array.from(state.answerTimers.keys());
    await Promise.all(questionIds.map(saveAnswerImmediately));
  }

  async function enqueueOperation(kind, payload) {
    if (!state.attempt || state.attempt.status === 'submitted') {
      return;
    }

    state.attempt.clientSequence = Number(state.attempt.clientSequence || 0) + 1;
    var operation = {
      id: randomId('operation'),
      attemptId: state.attempt.attemptId,
      sequence: state.attempt.clientSequence,
      kind: kind,
      payload: payload || {},
      occurredAt: new Date().toISOString(),
      appVersion: APP_VERSION
    };
    await databasePut('operations', operation);
    await persistAttempt();
    scheduleQueueSync(180);
  }

  function scheduleQueueSync(delay) {
    if (state.syncTimer) {
      window.clearTimeout(state.syncTimer);
    }
    state.syncTimer = window.setTimeout(function () {
      state.syncTimer = null;
      flushOperationQueue();
    }, delay || 0);
  }

  async function flushOperationQueue() {
    if (state.syncing || !state.attempt || !state.api || !navigator.onLine || state.attempt.status === 'submitted') {
      if (state.attempt && !navigator.onLine) {
        updateSaveStatus('local');
      }
      return false;
    }

    var operations = await getOperationsForAttempt(state.attempt.attemptId);
    if (!operations.length) {
      updateSaveStatus('saved');
      return true;
    }

    state.syncing = true;
    updateSaveStatus('saving');
    try {
      operations.sort(function (a, b) { return a.sequence - b.sequence; });
      var result = await state.api.syncOperations({
        attemptId: state.attempt.attemptId,
        sessionToken: state.attempt.sessionToken,
        operations: operations.map(copyObject)
      });
      if (!result || !Array.isArray(result.acknowledgedOperationIds)) {
        throw createAppError('SYNC_UNCONFIRMED');
      }
      await deleteOperations(result.acknowledgedOperationIds);
      state.attempt.serverRevision = result.serverRevision || state.attempt.serverRevision;
      await persistAttempt();
      var remaining = await getOperationsForAttempt(state.attempt.attemptId);
      updateSaveStatus(remaining.length ? 'local' : 'saved');
      return remaining.length === 0;
    } catch (error) {
      updateSaveStatus('local');
      return false;
    } finally {
      state.syncing = false;
    }
  }

  async function logIntegrityEvent(eventType, details) {
    if (!state.attempt || state.attempt.status !== 'in_progress') {
      return;
    }
    var now = Date.now();
    if (state.lastIntegrityEvent[eventType] && now - state.lastIntegrityEvent[eventType] < 500) {
      return;
    }
    state.lastIntegrityEvent[eventType] = now;
    try {
      await enqueueOperation('integrity.event', {
        eventType: eventType,
        details: details || {},
        visibilityState: document.visibilityState,
        fullscreen: Boolean(document.fullscreenElement)
      });
    } catch (error) {
      handleLocalSaveFailure(error);
    }
  }

  function handleConnectionChange() {
    updateConnectionUI();
    if (!state.attempt) {
      return;
    }

    logIntegrityEvent(navigator.onLine ? 'connection_restored' : 'connection_lost');
    if (navigator.onLine) {
      showToast(state.attempt.status === 'submitted'
        ? 'Connection restored. Checking for your released result now.'
        : 'Connection restored. Your saved work is syncing now.', 'ph-wifi-high');
      scheduleQueueSync(50);
      if (state.attempt.status === 'pending_submit') {
        window.setTimeout(retryPendingSubmission, 250);
      } else if (state.attempt.status === 'submitted') {
        window.setTimeout(function () { checkForReleasedResult(false); }, 250);
      }
    } else {
      showToast(state.attempt.status === 'submitted'
        ? 'Connection lost. Your signed receipt remains saved; result checking will resume automatically.'
        : 'Connection lost. Keep working; answers remain saved on this device.', 'ph-wifi-slash');
      updateSaveStatus('local');
    }
  }

  function updateConnectionUI() {
    var online = navigator.onLine;
    elements.connectionLabel.classList.toggle('is-offline', !online);
    elements.connectionLabel.querySelector('i').className = online ? 'ph ph-wifi-high' : 'ph ph-wifi-slash';
    elements.connectionLabel.querySelector('span').textContent = online ? 'Connected' : 'Offline';
    elements.offlineNotice.hidden = online || state.view !== 'exam';
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        throw createAppError('FULLSCREEN_UNAVAILABLE');
      }
    } catch (error) {
      showToast('Fullscreen could not be changed. Your answers are unaffected; continue in this window.', 'ph-info');
    }
  }

  function handleFullscreenChange() {
    var active = Boolean(document.fullscreenElement);
    elements.fullscreenButton.querySelector('i').className = active ? 'ph ph-corners-in' : 'ph ph-corners-out';
    elements.fullscreenButton.querySelector('span').textContent = active ? 'Exit fullscreen' : 'Enter fullscreen';
    logIntegrityEvent(active ? 'fullscreen_entered' : 'fullscreen_exited');
  }

  function startTimer() {
    stopTimer();
    updateTimer();
    state.timerId = window.setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function updateTimer() {
    if (!state.attempt || state.attempt.status !== 'in_progress') {
      return;
    }
    var now = Date.now() + Number(state.attempt.clockOffsetMs || 0);
    var remaining = Math.max(0, Date.parse(state.attempt.expiresAt) - now);
    elements.timerValue.textContent = formatClock(remaining);
    elements.timerValue.setAttribute('aria-label', formatClockAccessible(remaining));
    elements.timerBox.classList.toggle('is-urgent', remaining <= 5 * 60 * 1000);

    [10, 5, 1].forEach(function (minutes) {
      var threshold = minutes * 60 * 1000;
      if (remaining <= threshold && remaining > threshold - 1200 && !state.timerThresholdsAnnounced[minutes]) {
        state.timerThresholdsAnnounced[minutes] = true;
        announce(minutes + (minutes === 1 ? ' minute remains.' : ' minutes remain.'));
      }
    });

    if (remaining === 0 && !state.timeExpiryHandled) {
      state.timeExpiryHandled = true;
      state.attempt.timeExpired = true;
      persistAttempt().catch(handleLocalSaveFailure);
      stopTimer();
      announce('Time has ended. Your saved answers are being submitted.');
      showToast('Time has ended. Your saved answers are being submitted.', 'ph-clock-countdown');
      startSubmission(true);
    }
  }

  async function openSubmitDialog() {
    if (!state.attempt || state.attempt.status !== 'in_progress') {
      return;
    }
    await flushPendingAnswerSaves();
    var summary = answerSummary();
    elements.submitAnswered.textContent = String(summary.answered);
    elements.submitUnanswered.textContent = String(summary.unanswered);
    elements.submitFlagged.textContent = String(summary.flagged);
    elements.submitWarning.hidden = summary.unanswered === 0;
    clearError(elements.submitError);
    if (!elements.submitDialog.open) {
      elements.submitDialog.showModal();
    }
  }

  function closeSubmitDialog() {
    if (elements.submitDialog.open && !state.submitting) {
      elements.submitDialog.close();
    }
  }

  async function startSubmission(automatic) {
    if (!state.attempt || state.attempt.status === 'submitted' || state.submitting) {
      return;
    }
    state.submitting = true;
    setButtonBusy(elements.confirmSubmitButton, true, 'Securing answers');

    try {
      await flushPendingAnswerSaves();
      state.attempt.status = 'pending_submit';
      state.attempt.idempotencyKey = state.attempt.idempotencyKey || randomId('submission');
      state.attempt.clientCompletedAt = state.attempt.clientCompletedAt || new Date().toISOString();
      state.attempt.automaticSubmission = Boolean(automatic || state.attempt.automaticSubmission);
      state.attempt.answers = copyObject(state.answers);
      state.attempt.flags = copyObject(state.flags);
      await persistAttempt();
      if (elements.submitDialog.open) {
        elements.submitDialog.close();
      }
      stopTimer();
      if (state.media) state.media.stop().catch(function () {});
      renderPendingSubmission();
    } catch (error) {
      state.attempt.status = 'in_progress';
      showError(elements.submitError, error);
      return;
    } finally {
      state.submitting = false;
      setButtonBusy(elements.confirmSubmitButton, false);
    }

    await retryPendingSubmission();
  }

  function renderPendingSubmission() {
    stopResultWatch();
    setView('receipt');
    stopTimer();
    elements.receiptIcon.classList.add('is-pending');
    elements.receiptIcon.innerHTML = '<i class="ph ph-cloud-arrow-up"></i>';
    elements.receiptEyebrow.textContent = 'Submission pending';
    elements.receiptTitle.textContent = 'Your answers are safe on this device.';
    elements.receiptMessage.textContent = 'The examination is locked while confirmation is pending.';
    elements.pendingSubmissionNote.hidden = false;
    elements.receiptDetails.hidden = true;
    elements.resultPanel.hidden = true;
    elements.retrySubmissionButton.hidden = false;
    elements.printReceiptButton.hidden = true;
    clearError(elements.receiptError);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function retryPendingSubmission() {
    if (!state.attempt || state.attempt.status !== 'pending_submit' || state.submitting) {
      return;
    }
    if (!navigator.onLine) {
      showError(elements.receiptError, { code: 'SUBMISSION_OFFLINE' });
      return;
    }
    if (!state.api) {
      showError(elements.receiptError, { code: 'API_UNAVAILABLE' });
      return;
    }

    state.submitting = true;
    setButtonBusy(elements.retrySubmissionButton, true, 'Requesting confirmation');
    clearError(elements.receiptError);

    try {
      await flushOperationQueue();
      var payload = {
        attemptId: state.attempt.attemptId,
        sessionToken: state.attempt.sessionToken,
        idempotencyKey: state.attempt.idempotencyKey,
        examId: state.attempt.examId,
        examVersion: state.attempt.examVersion,
        clientCompletedAt: state.attempt.clientCompletedAt,
        automaticSubmission: Boolean(state.attempt.automaticSubmission),
        answers: state.questions.map(function (question) {
          return {
            questionId: question.id,
            answer: state.answers[question.id] === undefined ? null : state.answers[question.id],
            flagged: Boolean(state.flags[question.id])
          };
        }),
        client: {
          appVersion: APP_VERSION,
          lastClientSequence: state.attempt.clientSequence,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
        }
      };
      var receipt = await state.api.submitAttempt(payload);
      validateReceipt(receipt);
      receipt.attemptId = state.attempt.attemptId;
      receipt.isDemo = Boolean(receipt.isDemo || DEMO_MODE);
      await databasePut('receipts', receipt);
      state.attempt.status = 'submitted';
      state.attempt.receiptId = receipt.receiptId;
      state.attempt.submittedAt = receipt.submittedAt;
      await persistAttempt();
      await deleteAllOperationsForAttempt(state.attempt.attemptId);
      renderReceipt(receipt);
    } catch (error) {
      renderPendingSubmission();
      showError(elements.receiptError, {
        code: error && error.code ? error.code : 'SUBMISSION_UNCONFIRMED',
        userMessage: error && error.userMessage,
        workEffect: error && error.workEffect,
        cause: error
      }, retryPendingSubmission);
    } finally {
      state.submitting = false;
      setButtonBusy(elements.retrySubmissionButton, false);
    }
  }

  function validateReceipt(receipt) {
    if (!receipt || !receipt.receiptId || !receipt.submittedAt || !receipt.signature || receipt.answerCount === undefined || !receipt.examVersion) {
      throw createAppError('SUBMISSION_UNCONFIRMED');
    }
  }

  function renderReceipt(receipt) {
    setView('receipt');
    stopTimer();
    state.receipt = receipt;
    elements.receiptIcon.classList.remove('is-pending');
    elements.receiptIcon.innerHTML = '<i class="ph ph-seal-check"></i>';
    elements.receiptEyebrow.textContent = receipt.isDemo ? 'Demo submission confirmed' : 'Submission confirmed';
    elements.receiptTitle.textContent = 'Your examination was submitted.';
    elements.receiptMessage.textContent = receipt.isDemo
      ? 'This is a local demonstration receipt. No school record was created.'
      : 'Keep this receipt until your professor releases the results.';
    elements.pendingSubmissionNote.hidden = true;
    elements.receiptDetails.hidden = false;
    elements.resultPanel.hidden = false;
    elements.retrySubmissionButton.hidden = true;
    elements.printReceiptButton.hidden = false;
    setText(elements.receiptReference, receipt.receiptId);
    setText(elements.receiptSubmittedAt, formatDateTime(receipt.submittedAt));
    setText(elements.receiptExamVersion, receipt.examVersion);
    setText(elements.receiptAnswerCount, String(receipt.answerCount) + ' of ' + state.questions.length);
    setText(elements.receiptSignature, (receipt.signatureAlgorithm ? receipt.signatureAlgorithm + ': ' : '') + receipt.signature);
    clearError(elements.receiptError);
    document.title = 'Submission receipt | Examination Room';
    announce('Submission confirmed. Receipt ' + receipt.receiptId + '.');
    window.scrollTo({ top: 0, behavior: 'auto' });
    startResultWatch(receipt);
  }

  function stopResultWatch() {
    if (state.resultTimer) {
      window.clearInterval(state.resultTimer);
      state.resultTimer = null;
    }
    if (state.resultUnsubscribe) {
      state.resultUnsubscribe();
      state.resultUnsubscribe = null;
    }
  }

  function startResultWatch(receipt) {
    stopResultWatch();
    if (isCompleteReleasedResult(receipt?.result)) {
      renderReleasedResult(receipt.result);
    } else {
      renderAwaitingResult(null);
    }
    if (!state.api || typeof state.api.getResult !== 'function') {
      elements.resultCheckedAt.textContent = 'Automatic result checking is unavailable. Refresh this page after your professor announces release.';
      elements.resultRefreshButton.disabled = true;
      return;
    }
    elements.resultRefreshButton.disabled = false;
    if (typeof state.api.subscribe === 'function') {
      state.resultUnsubscribe = state.api.subscribe(function () {
        if (state.view === 'receipt') checkForReleasedResult(false);
      });
    }
    state.resultTimer = window.setInterval(function () {
      if (!document.hidden && state.view === 'receipt') checkForReleasedResult(false);
    }, 15000);
    checkForReleasedResult(false);
  }

  function renderAwaitingResult(checkedAt) {
    elements.resultStatusIcon.classList.add('is-waiting');
    elements.resultStatusIcon.innerHTML = '<i class="ph ph-hourglass-medium"></i>';
    elements.resultTitle.textContent = 'Awaiting your professor’s grade';
    elements.resultMessage.textContent = 'Your signed submission is complete. This page will update after your professor finishes grading and releases the result.';
    elements.resultSummary.hidden = true;
    elements.resultQuestionList.replaceChildren();
    elements.resultCheckedAt.textContent = checkedAt
      ? 'Last checked ' + formatDateTime(checkedAt)
      : 'Checking for an update…';
  }

  function displayScore(value) {
    var number = Number(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
  }

  function renderReleasedResult(result) {
    elements.resultStatusIcon.classList.remove('is-waiting');
    elements.resultStatusIcon.innerHTML = '<i class="ph ph-seal-check"></i>';
    elements.resultTitle.textContent = 'Your result has been released';
    elements.resultMessage.textContent = 'Your professor’s score and question-by-question feedback are shown below.';
    elements.resultCheckedAt.textContent = 'Updated ' + formatDateTime(result.checkedAt || result.releasedAt);
    elements.resultSummary.hidden = false;
    setText(elements.resultTotalScore, displayScore(result.totalScore));
    setText(elements.resultTotalPossible, displayScore(result.totalPossible));
    elements.resultReleasedAt.textContent = result.releasedAt
      ? 'Released ' + formatDateTime(result.releasedAt)
      : 'Released by your professor';
    elements.resultQuestionList.replaceChildren();
    (result.questions || []).forEach(function (question) {
      var item = createElement('li');
      item.append(
        createElement('strong', '', 'Question ' + question.questionNumber),
        createElement('span', '', displayScore(question.pointsAwarded) + ' / ' + displayScore(question.maxPoints)),
        createElement('p', '', question.feedback || 'No written feedback was added for this question.')
      );
      elements.resultQuestionList.appendChild(item);
    });
    clearError(elements.resultError);
    announce('Your professor released your result. Total score ' + displayScore(result.totalScore) + ' out of ' + displayScore(result.totalPossible) + '.');
  }

  function isCompleteReleasedResult(result) {
    return result
      && result.released === true
      && Number.isFinite(Number(result.totalScore))
      && Number.isFinite(Number(result.totalPossible))
      && Number(result.totalPossible) > 0
      && Array.isArray(result.questions)
      && result.questions.length > 0
      && result.questions.every(function (question) {
        return Number.isFinite(Number(question.pointsAwarded))
          && Number.isFinite(Number(question.maxPoints))
          && Number(question.maxPoints) > 0;
      });
  }

  async function checkForReleasedResult(manual) {
    if (state.resultChecking || !state.attempt || state.attempt.status !== 'submitted') return;
    if (!state.api || typeof state.api.getResult !== 'function') return;
    if (!navigator.onLine) {
      elements.resultCheckedAt.textContent = 'Offline — your receipt is safe. Result checking will resume when connected.';
      if (manual) showToast('You are offline. Your signed receipt is safe; results will refresh automatically after reconnecting.', 'ph-wifi-slash');
      return;
    }
    state.resultChecking = true;
    clearError(elements.resultError);
    if (manual) setButtonBusy(elements.resultRefreshButton, true, 'Checking');
    try {
      var result = await state.api.getResult({
        attemptId: state.attempt.attemptId,
        sessionToken: state.attempt.sessionToken
      });
      if (!result || typeof result.released !== 'boolean') throw createAppError('RESULT_CHECK_FAILED');
      if (result.released) {
        if (!isCompleteReleasedResult(result)) throw createAppError('RESULT_CHECK_FAILED');
        state.receipt.result = copyObject(result);
        renderReleasedResult(result);
        stopResultWatch();
        try {
          await databasePut('receipts', state.receipt);
        } catch {
          showToast('Your result is visible, but this browser could not cache it for offline viewing. Print or save the page now.', 'ph-warning-circle');
        }
      } else {
        renderAwaitingResult(result.checkedAt || new Date().toISOString());
        if (manual) showToast('Your submission is confirmed. The professor has not released the grade yet.', 'ph-hourglass-medium');
      }
    } catch (error) {
      showError(elements.resultError, {
        code: 'RESULT_CHECK_FAILED',
        userMessage: 'The latest grading status could not be checked right now.',
        workEffect: 'Your signed submission receipt remains valid. Check your connection and choose Check for result again.',
        cause: error
      }, function () { checkForReleasedResult(true); });
      elements.resultCheckedAt.textContent = 'Result check interrupted — your submission receipt is unaffected.';
    } finally {
      state.resultChecking = false;
      if (manual) setButtonBusy(elements.resultRefreshButton, false);
    }
  }

  function answerSummary() {
    var answered = state.questions.filter(function (question) {
      return hasAnswer(question.id);
    }).length;
    var flagged = state.questions.filter(function (question) {
      return Boolean(state.flags[question.id]);
    }).length;
    return {
      answered: answered,
      unanswered: state.questions.length - answered,
      flagged: flagged
    };
  }

  function updateProgress() {
    var summary = answerSummary();
    elements.progressText.textContent = summary.answered + ' of ' + state.questions.length + ' answered';
    elements.answerProgress.max = Math.max(1, state.questions.length);
    elements.answerProgress.value = summary.answered;
    elements.answerProgress.textContent = Math.round((summary.answered / Math.max(1, state.questions.length)) * 100) + '%';
  }

  function hasAnswer(questionId) {
    var answer = state.answers[questionId];
    if (typeof answer === 'string') {
      return answer.trim().length > 0;
    }
    return answer !== undefined && answer !== null && answer !== '';
  }

  function questionStatusText(questionId) {
    var parts = [];
    parts.push(hasAnswer(questionId) ? 'answered' : 'unanswered');
    if (state.flags[questionId]) {
      parts.push('flagged');
    }
    return parts.join(', ');
  }

  function updateWordCount(element, text, maxWords) {
    var count = countWords(text);
    element.textContent = maxWords ? count + ' of ' + maxWords + ' words' : count + (count === 1 ? ' word' : ' words');
    element.classList.toggle('is-over', Boolean(maxWords && count > maxWords));
  }

  function countWords(text) {
    var trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function updateSaveStatus(mode) {
    var icon = elements.saveStatus.querySelector('i');
    var text = elements.saveStatus.querySelector('span');
    elements.saveStatus.classList.remove('is-local', 'is-saving');
    if (mode === 'saving') {
      elements.saveStatus.classList.add('is-saving');
      icon.className = 'ph ph-circle-notch';
      text.textContent = 'Saving your latest work';
    } else if (mode === 'local') {
      elements.saveStatus.classList.add('is-local');
      icon.className = 'ph ph-device-mobile';
      text.textContent = 'Saved on this device; waiting to sync';
    } else {
      icon.className = 'ph ph-cloud-check';
      text.textContent = 'Saved and synced';
    }
  }

  async function persistAttempt() {
    if (!state.attempt) {
      return;
    }
    state.attempt.answers = copyObject(state.answers);
    state.attempt.flags = copyObject(state.flags);
    state.attempt.currentIndex = state.currentIndex;
    state.attempt.questions = state.questions;
    state.attempt.updatedAt = new Date().toISOString();
    await databasePut('attempts', state.attempt);
  }

  function handleLocalSaveFailure(error) {
    updateSaveStatus('local');
    showError(elements.examError, {
      code: 'LOCAL_SAVE_FAILED',
      cause: error
    });
  }

  function handleBeforeUnload(event) {
    if (!state.attempt || state.attempt.status === 'submitted') {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  function showError(container, error, retryAction) {
    var details = normaliseError(error);
    container.replaceChildren();
    var icon = createElement('i', 'ph ph-warning-circle');
    icon.setAttribute('aria-hidden', 'true');
    var body = createElement('div');
    body.appendChild(createElement('strong', '', details.title));
    body.appendChild(createElement('p', '', details.message));
    if (details.effect) {
      body.appendChild(createElement('p', 'error-effect', details.effect));
    }
    if (retryAction && details.retryable !== false) {
      var retry = createElement('button', 'button button-secondary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', retryAction, { once: true });
      body.appendChild(retry);
    }
    container.append(icon, body);
    container.hidden = false;
  }

  function clearError(container) {
    container.hidden = true;
    container.replaceChildren();
  }

  function normaliseError(error) {
    var code = error && error.code ? String(error.code).replace(/^EXAM_ROOM_V1_/, '') : 'UNEXPECTED';
    if (code === 'EMAIL_REQUIRED') code = 'STUDENT_EMAIL_REQUIRED';
    if (code === 'EMAIL_NOT_ALLOWED') code = 'STUDENT_EMAIL_NOT_ALLOWED';
    var map = {
      STORAGE_UNAVAILABLE: {
        title: 'Safe local saving is unavailable',
        message: 'This browser cannot prepare the protected local storage needed for an examination.',
        effect: 'No examination attempt has started. Try a current browser on this device or contact your administrator.',
        retryable: false
      },
      API_UNAVAILABLE: {
        title: 'The examination service is not connected',
        message: 'This page cannot check the room key or open an examination right now.',
        effect: 'No new attempt has started. A previously saved attempt remains on this device.'
      },
      NETWORK_UNAVAILABLE: {
        title: 'The connection was interrupted',
        message: 'This step needs a connection before it can finish.',
        effect: 'Anything already saved on this device is unchanged. Reconnect, then try again.'
      },
      OFFLINE_NO_PREVIEW: {
        title: 'Connect once to verify this room',
        message: 'This examination has not been verified on this device before.',
        effect: 'No attempt has started. Reconnect, then try the room key again.'
      },
      OFFLINE_NEW_ATTEMPT: {
        title: 'Connect before starting a new attempt',
        message: 'A new examination must be opened while connected. Saved examinations can still be resumed offline.',
        effect: 'Your verified entry details are saved for this exact examination and room key.'
      },
      OFFLINE_EXAM_NOT_SAVED: {
        title: 'The questions are not saved on this device',
        message: 'Reconnect so the examination can be restored safely.',
        effect: 'Your identity check and verified entry details remain saved.'
      },
      INVALID_ROOM_KEY: {
        title: 'That room key was not accepted',
        message: 'Check every letter and number, then try again.',
        effect: 'No examination attempt has started.'
      },
      ROOM_KEY_INVALID: {
        title: 'That room key is not active yet',
        message: 'Check every letter and number. If it is correct, ask the examination creator whether Admin has issued and opened the key.',
        effect: 'No examination attempt has started. You can safely try the same details again.'
      },
      SUBJECT_MISMATCH: {
        title: 'The subject does not match this room',
        message: 'Enter the subject exactly as the examination creator announced it, then preview again.',
        effect: 'No examination attempt has started and none of your details were submitted as answers.'
      },
      IDENTITY_MISMATCH: {
        title: 'These details do not match the room',
        message: 'Check your name, student number, subject, year level, and email if this room uses an email list.',
        effect: 'No examination attempt has started.'
      },
      STUDENT_EMAIL_REQUIRED: {
        title: 'This room uses an email list',
        message: 'Enter the same email address the examination creator placed on the allowed list.',
        effect: 'No attempt has started. Return to the entry form, add the email, and preview again.'
      },
      STUDENT_EMAIL_INVALID: {
        title: 'Check the email address',
        message: 'Enter a complete address such as student@gmail.com, or leave it blank for a key-only room.',
        effect: 'No attempt has started. Correct the field and preview again.'
      },
      STUDENT_EMAIL_NOT_ALLOWED: {
        title: 'That email is not on this room’s list',
        message: 'Check the spelling or ask the examination creator to add the correct address before trying again.',
        effect: 'No attempt has started and no answer was changed.'
      },
      STUDENT_EMAIL_MISMATCH: {
        title: 'This student number is linked to another email',
        message: 'Use the allowed email originally entered with this student number.',
        effect: 'No attempt has started. Ask the examination creator to review the entry if the record is wrong.'
      },
      ROSTER_NAME_MISMATCH: {
        title: 'This student number is linked to another name',
        message: 'Enter the same real full name used when this student number first entered the room.',
        effect: 'No attempt has started. Ask the examination creator to review the student record if needed.'
      },
      ROOM_CLOSED: {
        title: 'This examination room is not open',
        message: 'The room may be early, finished, or awaiting the administrator’s start signal.',
        effect: 'No examination attempt has started.'
      },
      ROOM_NOT_OPEN: {
        title: 'The key is valid, but the room is not open yet',
        message: 'Keep this page open and try again after the examination creator announces that the room is open.',
        effect: 'No examination attempt has started and your entry details remain available here.'
      },
      EXAMINATION_ARCHIVED: {
        title: 'This examination is archived',
        message: 'Ask the examination creator or Admin to restore the room or provide the current key.',
        effect: 'No examination attempt has started.'
      },
      EXAMINATION_BLOCKED: {
        title: 'Admin temporarily blocked this examination',
        message: 'Wait for Admin to reopen admission, then enter the same key again.',
        effect: 'No examination attempt has started and your saved details remain unchanged.'
      },
      SESSION_EXPIRED: {
        title: 'Your secure session needs attention',
        message: 'The examination service can no longer confirm this session automatically.',
        effect: 'Keep this page and device open. Your locally saved answers remain here while the administrator helps restore access.'
      },
      SESSION_REVOKED: {
        title: 'The examination creator ended this session',
        message: 'Your latest saved work remains attached to this attempt for creator and Admin review.',
        effect: 'Do not start a second attempt. Contact the examination creator for the next step.',
        retryable: false
      },
      STUDENT_BLOCKED: {
        title: 'This entry has been blocked by the examination creator',
        message: 'The current session cannot continue with this room key.',
        effect: 'Your latest saved work remains preserved. Contact the examination creator or Admin to resolve access.',
        retryable: false
      },
      SUBMISSION_WINDOW_CLOSED: {
        title: 'The submission window needs administrator review',
        message: 'Your locked answers could not receive a signed receipt before the room closed.',
        effect: 'Keep this page and device available and contact the examination administrator. Do not start another attempt.'
      },
      PREVIEW_INVALID: {
        title: 'The examination details could not be confirmed',
        message: 'The room returned incomplete information.',
        effect: 'Questions have not loaded and no attempt has started.'
      },
      PREVIEW_REQUIRED: {
        title: 'Preview the examination first',
        message: 'Confirm the room and student details before questions can load.',
        effect: 'No examination attempt has started.'
      },
      ATTEMPT_INVALID: {
        title: 'The attempt could not be opened safely',
        message: 'The examination did not return a complete start confirmation.',
        effect: 'Questions have not loaded. Your room and student details remain saved.'
      },
      QUESTIONS_UNAVAILABLE: {
        title: 'The questions could not be loaded',
        message: 'The examination package is incomplete or unavailable.',
        effect: 'Do not begin writing yet. Try again or contact the examination administrator.'
      },
      QUESTION_COUNT_CHANGED: {
        title: 'The examination package changed',
        message: 'The number of questions no longer matches the preview.',
        effect: 'Questions are withheld to protect examination integrity. Ask the administrator to verify the published version.'
      },
      QUESTION_TYPE_UNSUPPORTED: {
        title: 'A question cannot be displayed safely',
        message: 'This version of the Examination Room does not support one of the published question types.',
        effect: 'The examination has not opened. Contact the administrator before proceeding.'
      },
      LOCAL_SAVE_FAILED: {
        title: 'Your latest change may not be safely stored',
        message: 'Keep this page open and try typing a small change again.',
        effect: 'Earlier saved work remains on this device. Do not close the page until the saved status returns.'
      },
      SUBMISSION_OFFLINE: {
        title: 'Submission is waiting for a connection',
        message: 'Your locked answers are saved on this device and will retry automatically.',
        effect: 'Keep this browser and device available until a signed receipt appears.'
      },
      SUBMISSION_UNCONFIRMED: {
        title: 'Confirmation has not arrived yet',
        message: 'Your locked answers remain saved on this device.',
        effect: 'Do not start another attempt. Retry here until the signed receipt appears.'
      },
      RESULT_CHECK_FAILED: {
        title: 'The latest grading status is unavailable',
        message: 'The result could not be checked right now.',
        effect: 'Your signed submission receipt remains valid. Reconnect and choose Check for result again.'
      },
      SYNC_UNCONFIRMED: {
        title: 'Your latest work is waiting to sync',
        message: 'It remains saved on this device.',
        effect: 'Keep the page open; syncing will retry when the connection is ready.'
      },
      UNEXPECTED: {
        title: 'The examination could not continue yet',
        message: 'Something interrupted this step.',
        effect: 'Saved work on this device is unchanged. Try the step again.'
      }
    };
    var result = map[code] || map.UNEXPECTED;
    var hasSafeApiError = code !== 'UNEXPECTED' && error && typeof error.message === 'string';
    return {
      title: error && error.title ? error.title : result.title,
      message: error && error.userMessage
        ? error.userMessage
        : hasSafeApiError ? error.message : result.message,
      effect: error && error.workEffect
        ? error.workEffect
        : hasSafeApiError && typeof error.recovery === 'string' ? error.recovery : result.effect,
      retryable: error && error.retryable === false ? false : result.retryable
    };
  }

  function createAppError(code, userMessage, workEffect) {
    var error = new Error(userMessage || code);
    error.code = code;
    if (userMessage) {
      error.userMessage = userMessage;
    }
    if (workEffect) {
      error.workEffect = workEffect;
    }
    return error;
  }

  function showToast(message, iconName) {
    var toast = createElement('div', 'toast');
    var icon = createElement('i', 'ph ' + (iconName || 'ph-info'));
    icon.setAttribute('aria-hidden', 'true');
    toast.append(icon, createElement('p', '', message));
    elements.toastRegion.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 5200);
  }

  function announce(message) {
    elements.assertiveStatus.textContent = '';
    window.setTimeout(function () {
      elements.assertiveStatus.textContent = message;
    }, 20);
  }

  function setButtonBusy(button, busy, label) {
    if (busy) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }
      button.disabled = true;
      button.classList.add('is-loading');
      button.innerHTML = '<i class="ph ph-circle-notch" aria-hidden="true"></i><span>' + (label || 'Please wait') + '</span>';
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function setEntryFieldsDisabled(disabled) {
    Array.from(elements.roomEntryForm.elements).forEach(function (control) {
      if (control !== elements.previewButton) {
        control.disabled = disabled;
      }
    });
  }

  function questionTypeLabel(type) {
    return {
      essay: 'Essay response',
      multiple_choice: 'Multiple choice',
      short_answer: 'Short answer'
    }[type] || 'Question';
  }

  function formatDuration(minutes) {
    var total = Number(minutes);
    if (total >= 60 && total % 60 === 0) {
      var hours = total / 60;
      return hours + (hours === 1 ? ' hour' : ' hours');
    }
    return total + (total === 1 ? ' minute' : ' minutes');
  }

  function formatAvailability(metadata) {
    return 'Available while this student key remains active';
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value || 'Not available');
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function formatClock(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(function (value) {
      return String(value).padStart(2, '0');
    }).join(':');
  }

  function formatClockAccessible(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return hours + ' hours, ' + minutes + ' minutes, ' + seconds + ' seconds remaining';
  }

  function normaliseRoomKey(value) {
    return String(value || '').trim().replace(/\s+/g, '-').toLocaleUpperCase();
  }

  function normaliseHumanText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function normaliseEmail(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function safeDomId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function setText(element, value) {
    element.textContent = value === undefined || value === null ? '' : String(value);
  }

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function copyObject(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + ':' + window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return prefix + ':' + Array.from(bytes).map(function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }
    return prefix + ':' + Date.now() + ':' + Math.random().toString(16).slice(2);
  }

  async function digestText(value) {
    var text = String(value);
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      var data = new TextEncoder().encode(text);
      var hash = await window.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hash)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }

    var fallback = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      fallback ^= text.charCodeAt(index);
      fallback = Math.imul(fallback, 16777619);
    }
    return 'fallback-' + (fallback >>> 0).toString(16);
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(createAppError('STORAGE_UNAVAILABLE'));
        return;
      }
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      var settled = false;
      var timeout = window.setTimeout(function () {
        finish(null, createAppError('STORAGE_UNAVAILABLE'));
      }, DB_OPEN_TIMEOUT_MS);
      function finish(database, error) {
        if (settled) {
          if (database && typeof database.close === 'function') database.close();
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve(database);
      }
      request.onerror = function () { finish(null, request.error || createAppError('STORAGE_UNAVAILABLE')); };
      request.onblocked = function () { finish(null, createAppError('STORAGE_UNAVAILABLE')); };
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('attempts')) {
          db.createObjectStore('attempts', { keyPath: 'attemptId' });
        }
        if (!db.objectStoreNames.contains('operations')) {
          var operations = db.createObjectStore('operations', { keyPath: 'id' });
          operations.createIndex('attemptId', 'attemptId', { unique: false });
        }
        if (!db.objectStoreNames.contains('receipts')) {
          db.createObjectStore('receipts', { keyPath: 'attemptId' });
        }
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () { db.close(); };
        finish(db);
      };
    });
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function transactionPromise(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || createAppError('STORAGE_UNAVAILABLE')); };
    });
  }

  async function databaseGet(storeName, key) {
    var transaction = state.db.transaction(storeName, 'readonly');
    var result = await requestPromise(transaction.objectStore(storeName).get(key));
    await transactionPromise(transaction);
    return result;
  }

  async function databasePut(storeName, value) {
    var transaction = state.db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(copyObject(value));
    await transactionPromise(transaction);
  }

  async function getOperationsForAttempt(attemptId) {
    var transaction = state.db.transaction('operations', 'readonly');
    var index = transaction.objectStore('operations').index('attemptId');
    var result = await requestPromise(index.getAll(IDBKeyRange.only(attemptId)));
    await transactionPromise(transaction);
    return result || [];
  }

  async function deleteOperations(operationIds) {
    if (!operationIds.length) {
      return;
    }
    var transaction = state.db.transaction('operations', 'readwrite');
    var store = transaction.objectStore('operations');
    operationIds.forEach(function (id) { store.delete(id); });
    await transactionPromise(transaction);
  }

  async function deleteAllOperationsForAttempt(attemptId) {
    var operations = await getOperationsForAttempt(attemptId);
    await deleteOperations(operations.map(function (operation) { return operation.id; }));
  }

  function prefillDemoEntry() {
    if (state.api && state.api.demoRoomKey === 'DD26-LAW1-826K') {
      elements.roomKey.value = 'DD26-LAW1-826K';
      elements.fullName.value = 'Maria Theresa Dela Cruz';
      elements.studentNumber.value = '2024-10001';
      elements.subject.value = 'Constitutional Law';
      elements.yearLevel.value = '2L';
      return;
    }
    elements.roomKey.value = 'DEMO-ROOM';
    elements.fullName.value = 'Maria Santos';
    elements.studentNumber.value = '2026-0001';
    elements.subject.value = 'Remedial Law';
    elements.yearLevel.value = '4L';
  }

  function createDemoAdapter() {
    function requireOnline() {
      if (!navigator.onLine) {
        throw createAppError(
          'NETWORK_UNAVAILABLE',
          'The demonstration is offline right now.',
          'Saved work remains on this device and can be retried after reconnecting.'
        );
      }
    }

    function pause() {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, 220);
      });
    }

    return {
      previewRoom: async function (entry) {
        requireOnline();
        await pause();
        if (normaliseRoomKey(entry.roomKey) !== 'DEMO-ROOM') {
          throw createAppError('INVALID_ROOM_KEY');
        }
        if (normaliseHumanText(entry.subject).toLocaleLowerCase() !== 'remedial law' || entry.yearLevel !== '4L') {
          throw createAppError('IDENTITY_MISMATCH');
        }
        var now = Date.now();
        return {
          examId: 'demo-remedial-law-midterm-2026',
          examVersion: '1.0-demo',
          title: 'Remedial Law Midterm Examination',
          subject: 'Remedial Law',
          professor: 'Atty. Elena M. Reyes',
          durationMinutes: 45,
          questionCount: 3,
          admissionMode: 'key_only',
          opensAt: new Date(now - 15 * 60 * 1000).toISOString(),
          closesAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
          safeguards: [
            'Answers are saved locally and synchronized when connected.',
            'Window focus and fullscreen changes are recorded for review.',
            'This demonstration does not use camera or microphone recording.'
          ]
        };
      },

      beginAttempt: async function (request) {
        requireOnline();
        await pause();
        if (
          request.examId !== 'demo-remedial-law-midterm-2026' ||
          request.examVersion !== '1.0-demo' ||
          normaliseRoomKey(request.roomKey) !== 'DEMO-ROOM'
        ) {
          throw createAppError('ATTEMPT_INVALID');
        }
        var now = new Date();
        return {
          attemptId: randomId('demo-attempt'),
          sessionToken: randomId('demo-session'),
          serverNow: now.toISOString(),
          startedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 45 * 60 * 1000).toISOString()
        };
      },

      loadExam: async function () {
        requireOnline();
        await pause();
        return {
          questions: [
            {
              id: 'demo-q-1',
              number: 1,
              type: 'essay',
              title: 'Jurisdiction and the proper remedy',
              prompt: 'A Regional Trial Court dismissed a civil complaint for lack of jurisdiction after the defendant had already filed an answer and both parties had completed pre-trial. The plaintiff received the dismissal order on 4 August and filed a motion for reconsideration on 20 August. The motion was denied on 2 September.\n\nAs counsel for the plaintiff, identify the proper procedural remedy and discuss the material periods and jurisdictional considerations.',
              instructions: 'Organize your answer clearly. State the governing rule, apply it to the facts, address a credible counterargument, and give a concise conclusion.',
              required: true,
              maxWords: 900
            },
            {
              id: 'demo-q-2',
              number: 2,
              type: 'multiple_choice',
              title: 'Service of pleadings',
              prompt: 'Which statement most accurately describes electronic service of pleadings under the Rules of Civil Procedure?',
              instructions: 'Choose the best answer.',
              required: true,
              options: [
                { id: 'a', label: 'It is never permitted unless the court issues a special order.' },
                { id: 'b', label: 'It may be made at the electronic address of record, subject to the applicable rules and proof of service.' },
                { id: 'c', label: 'It is valid only if followed by personal service on the same day.' },
                { id: 'd', label: 'It automatically extends every responsive period by fifteen days.' }
              ]
            },
            {
              id: 'demo-q-3',
              number: 3,
              type: 'short_answer',
              title: 'Purpose of pre-trial',
              prompt: 'In no more than three sentences, explain why pre-trial is mandatory in civil actions.',
              instructions: 'Give a direct answer. Citations are not required for this demonstration.',
              required: true,
              maxLength: 700
            }
          ]
        };
      },

      syncOperations: async function (request) {
        requireOnline();
        await pause();
        return {
          acknowledgedOperationIds: request.operations.map(function (operation) { return operation.id; }),
          serverRevision: request.operations.length
            ? request.operations[request.operations.length - 1].sequence
            : 0
        };
      },

      submitAttempt: async function (request) {
        requireOnline();
        await pause();
        var answered = request.answers.filter(function (item) {
          return typeof item.answer === 'string' ? item.answer.trim().length > 0 : item.answer !== null;
        }).length;
        var receiptSeed = [
          request.attemptId,
          request.idempotencyKey,
          request.examVersion,
          request.clientCompletedAt,
          JSON.stringify(request.answers)
        ].join('|');
        var signature = await digestText(receiptSeed);
        return {
          receiptId: 'DEMO-' + signature.slice(0, 12).toLocaleUpperCase(),
          submittedAt: request.clientCompletedAt,
          signature: signature,
          signatureAlgorithm: 'DEMO-SHA-256',
          answerCount: answered,
          examVersion: request.examVersion,
          isDemo: true
        };
      },

      getResult: async function () {
        requireOnline();
        await pause();
        return {
          released: false,
          status: 'awaiting_grade',
          checkedAt: new Date().toISOString(),
          releasedAt: null,
          totalScore: null,
          totalPossible: null,
          questions: []
        };
      }
    };
  }
}());
