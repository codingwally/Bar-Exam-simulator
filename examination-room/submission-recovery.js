(function () {
  'use strict';

  var DB_NAME = 'duediligence-examination-room-v1';
  var DB_VERSION = 1;
  var state = { db: null, attempt: null, api: null, busy: false };
  var statusEl;
  var detailsEl;
  var errorEl;
  var buttonEl;

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    statusEl = document.getElementById('recovery-status');
    detailsEl = document.getElementById('recovery-details');
    errorEl = document.getElementById('recovery-error');
    buttonEl = document.getElementById('recover-submit');
    buttonEl.addEventListener('click', recoverAndSubmit);
    state.api = window.ExaminationRoomV1Api || null;
    if (!state.api || typeof state.api.submitAttempt !== 'function') {
      fail('The current Examination Room API could not be loaded. Keep the original tab open and reload this recovery page.');
      return;
    }
    try {
      state.db = await openDatabase();
      var attempts = await getAll('attempts');
      var candidates = attempts.filter(function (attempt) {
        if (!attempt || !attempt.attemptId || !attempt.sessionToken) return false;
        if (attempt.status === 'pending_submit') return true;
        return attempt.status === 'in_progress' && Boolean(attempt.clientCompletedAt && attempt.idempotencyKey);
      }).sort(function (a, b) {
        return Date.parse(b.updatedAt || b.startedAt || 0) - Date.parse(a.updatedAt || a.startedAt || 0);
      });
      if (!candidates.length) {
        fail('No pending Examination Room submission was found in this browser. Do not close the original tab.');
        return;
      }
      state.attempt = candidates[0];
      var answerCount = Object.keys(state.attempt.answers || {}).filter(function (key) {
        var value = state.attempt.answers[key];
        return value !== undefined && value !== null && String(value).trim() !== '';
      }).length;
      detailsEl.hidden = false;
      detailsEl.innerHTML =
        '<p><strong>Examination:</strong> ' + escapeHtml(state.attempt.metadata && state.attempt.metadata.title || 'Examination') + '</p>' +
        '<p><strong>Student:</strong> ' + escapeHtml(state.attempt.student && state.attempt.student.fullName || '') + '</p>' +
        '<p><strong>Locally stored answers:</strong> ' + answerCount + '</p>' +
        '<p><strong>Attempt:</strong> ' + escapeHtml(state.attempt.attemptId) + '</p>';
      statusEl.textContent = 'The pending local attempt was found. Nothing has been deleted or changed.';
      buttonEl.hidden = false;
    } catch (error) {
      fail('The browser could not read the pending Examination Room record. Keep the original tab open. ' + (error && error.message ? error.message : ''));
    }
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = function () { reject(request.error || new Error('IndexedDB could not be opened.')); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed.')); };
    });
  }

  async function getAll(storeName) {
    var tx = state.db.transaction(storeName, 'readonly');
    return (await requestPromise(tx.objectStore(storeName).getAll())) || [];
  }

  async function put(storeName, value) {
    await new Promise(function (resolve, reject) {
      var tx = state.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(JSON.parse(JSON.stringify(value)));
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed.')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB write was aborted.')); };
    });
  }

  function normalizeAnswer(question, raw) {
    if (!question || question.type !== 'multiple_choice' || raw === null || raw === undefined) return raw;
    if (Number.isInteger(Number(raw))) return Number(raw);
    var options = Array.isArray(question.options) ? question.options : [];
    var index = options.findIndex(function (option) {
      return option && (option.id === raw || option.label === raw);
    });
    if (index >= 0) return index;
    var numbered = /^(?:option|choice)[-_ ]?(\d+)$/i.exec(String(raw).trim());
    if (numbered) return Math.max(0, Number(numbered[1]) - 1);
    return raw;
  }

  function buildAnswers(attempt) {
    var questions = Array.isArray(attempt.questions) ? attempt.questions : [];
    var answers = attempt.answers || {};
    var flags = attempt.flags || {};
    return questions.map(function (question) {
      var raw = answers[question.id] === undefined ? null : answers[question.id];
      return {
        questionId: question.id,
        answer: normalizeAnswer(question, raw),
        flagged: Boolean(flags[question.id])
      };
    });
  }

  function answerCopy(attempt) {
    var questions = Array.isArray(attempt.questions) ? attempt.questions : [];
    var answers = attempt.answers || {};
    return {
      schemaVersion: 'examination-room/student-answer-copy/v1',
      examination: {
        title: attempt.metadata && attempt.metadata.title || 'Examination',
        subject: attempt.metadata && attempt.metadata.subject || '',
        yearLevel: attempt.student && attempt.student.yearLevel || ''
      },
      student: {
        fullName: attempt.student && attempt.student.fullName || '',
        studentNumber: attempt.student && attempt.student.studentNumber || '',
        email: attempt.student && attempt.student.email || ''
      },
      attemptId: attempt.attemptId,
      clientCompletedAt: attempt.clientCompletedAt || null,
      answers: questions.map(function (question, index) {
        var raw = answers[question.id] === undefined ? null : answers[question.id];
        var display = raw;
        if (question.type === 'multiple_choice' && raw !== null) {
          var options = Array.isArray(question.options) ? question.options : [];
          var option = options.find(function (item) { return item && item.id === raw; });
          if (option) display = option.label;
        }
        return {
          questionNumber: Number(question.number || index + 1),
          prompt: String(question.prompt || ''),
          answer: display
        };
      })
    };
  }

  function safePart(value, fallback) {
    var clean = String(value || '').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return clean || fallback;
  }

  function downloadCopy(attempt) {
    var copy = answerCopy(attempt);
    var filename = [
      'Due-Diligence-Answers',
      safePart(copy.student.studentNumber, 'student'),
      safePart(copy.examination.title, 'examination')
    ].join('-') + '.json';
    var blob = new Blob([JSON.stringify(copy, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return filename;
  }

  async function recoverAndSubmit() {
    if (state.busy || !state.attempt) return;
    state.busy = true;
    buttonEl.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = 'Downloading your local answer copy…';
    try {
      var attempt = state.attempt;
      attempt.idempotencyKey = attempt.idempotencyKey || ('submission:' + crypto.randomUUID());
      attempt.clientCompletedAt = attempt.clientCompletedAt || new Date().toISOString();
      attempt.status = 'pending_submit';
      attempt.answerCopyFilename = downloadCopy(attempt);
      attempt.answerCopyDownloadedAt = attempt.answerCopyDownloadedAt || new Date().toISOString();
      attempt.updatedAt = new Date().toISOString();
      await put('attempts', attempt);

      statusEl.textContent = 'Uploading the complete local answer snapshot to Due Diligence…';
      var receipt = await state.api.submitAttempt({
        attemptId: attempt.attemptId,
        sessionToken: attempt.sessionToken,
        idempotencyKey: attempt.idempotencyKey,
        examId: attempt.examId,
        examVersion: attempt.examVersion,
        clientCompletedAt: attempt.clientCompletedAt,
        automaticSubmission: Boolean(attempt.automaticSubmission),
        answers: buildAnswers(attempt),
        client: {
          appVersion: 'submission-recovery-20260922-8',
          recoveryPage: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
        }
      });

      if (!receipt || !receipt.receiptId || !receipt.submittedAt) {
        throw new Error('The server did not return a complete submission receipt.');
      }
      receipt.attemptId = attempt.attemptId;
      await put('receipts', receipt);
      attempt.status = 'submitted';
      attempt.receiptId = receipt.receiptId;
      attempt.submittedAt = receipt.submittedAt;
      attempt.updatedAt = new Date().toISOString();
      await put('attempts', attempt);
      statusEl.textContent = 'Uploaded. Due Diligence returned submission receipt ' + receipt.receiptId + '.';
      buttonEl.hidden = true;
      detailsEl.innerHTML += '<p><strong>Receipt:</strong> ' + escapeHtml(receipt.receiptId) + '</p>';
    } catch (error) {
      fail((error && (error.message || error.userMessage)) || 'The recovery submission did not complete.');
      buttonEl.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  function fail(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
    statusEl.textContent = 'Submission recovery needs attention.';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}());
