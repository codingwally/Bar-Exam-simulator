(function examinationsExperience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const workerUrl = config?.workerUrl;
  if (!workerUrl) return;

  const SUBJECTS = Object.freeze([
    { display: 'Philosophy of Law', source: 'Philosophy of Law', year: 1, term: 1 },
    { display: 'Statutory Construction', source: 'Statutory Construction', year: 1, term: 1 },
    { display: 'Basic Legal and Judicial Ethics', source: 'Basic Legal and Judicial Ethics', year: 1, term: 1 },
    { display: 'Constitutional Law I', source: 'Constitutional Law I', year: 1, term: 1 },
    { display: 'Criminal Law I', source: 'Criminal Law I', year: 1, term: 1 },
    { display: 'Criminal Procedure', source: 'Criminal Procedure', year: 1, term: 1 },
    { display: 'Legal Research and Writing', source: 'Legal Research and Writing', year: 1, term: 2 },
    { display: 'Constitutional Law II', source: 'Constitutional Law II', year: 1, term: 2 },
    { display: 'Criminal Law II', source: 'Criminal Law II', year: 1, term: 2 },
    { display: 'Obligations and Contracts', source: 'Obligations and Contracts', year: 1, term: 2 },
    { display: 'Civil Procedure I', source: 'Civil Procedure I', year: 1, term: 2 },
    { display: 'Public International Law', source: 'Public International Law', year: 2, term: 1 },
    { display: 'Persons and Family Law', source: 'Persons and Family Law', year: 2, term: 1 },
    { display: 'Civil Procedure II', source: 'Civil Procedure II', year: 2, term: 1 },
    { display: 'Agency, Trust and Partnership Law', source: 'Agency, Trust and Partnership Law', year: 2, term: 1 },
    { display: 'Corporation and Basic Securities Law', source: 'Corporation and Basic Securities Law', year: 2, term: 1 },
    { display: 'Labor Law and Social Legislation', source: 'Labor Law and Social Legislation', year: 2, term: 1 },
    { display: 'Clinical Legal Education', source: 'Clinical Legal Education', year: 2, term: 1 },
    { display: 'Administrative Law and Law on Public Officers', source: 'Administrative Law and Law on Public Officers', year: 2, term: 2 },
    { display: 'Property and Land Law', source: 'Property and Land Law', year: 2, term: 2 },
    { display: 'Basic Succession Law', source: 'Basic Succession Law', year: 2, term: 2 },
    { display: 'Evidence', source: 'Evidence', year: 2, term: 2 },
    { display: 'Commercial Laws I', source: 'Commercial Laws I', year: 2, term: 2 },
    { display: 'Basic Taxation Law', source: 'Basic Taxation Law', year: 2, term: 2 },
  ]);
  const LOCAL_KEY = 'duediligence.examinations.recovery.v1';
  const TAB_KEY = 'duediligence.examinations.tab-token.v1';
  const HEARTBEAT_MS = 30_000;
  const AUTOSAVE_MS = 1_100;

  const state = {
    catalog: [],
    history: [],
    selectedSubject: 'Criminal Law I',
    track: 'per_subject',
    setup: null,
    active: null,
    currentIndex: 0,
    screen: 'catalog',
    saveTimer: null,
    heartbeatTimer: null,
    clockTimer: null,
    serverSyncAt: 0,
    clientRemaining: null,
    clientElapsed: 0,
    saveInFlight: false,
    pendingSave: false,
    expiryInFlight: false,
    assignment: null,
    uploadPreview: null,
    initialized: false,
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));

  function randomToken(byteLength = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function requestKey(prefix = 'exam') {
    return `${prefix}_${randomToken(18)}`;
  }

  function tabToken() {
    let token = '';
    try { token = sessionStorage.getItem(TAB_KEY) || ''; } catch {}
    if (token.length < 32) {
      token = randomToken(32);
      try { sessionStorage.setItem(TAB_KEY, token); } catch {}
    }
    return token;
  }

  function safeJson(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function saveRecovery() {
    if (!state.active?.attempt?.attemptId) return;
    const data = {
      version: 1,
      attemptId: state.active.attempt.attemptId,
      versionId: state.active.attempt.versionId,
      currentIndex: state.currentIndex,
      savedAt: Date.now(),
      questions: state.active.questions.map((question) => ({
        questionId: question.questionId,
        answerText: question.answerText || '',
        flagged: question.flagged === true,
        revision: Number(question.revision) || 0,
      })),
    };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch {}
  }

  function readRecovery() {
    let value = null;
    try { value = safeJson(localStorage.getItem(LOCAL_KEY)); } catch {}
    if (
      value?.version !== 1
      || !value.attemptId
      || Date.now() - Number(value.savedAt || 0) > 14 * 24 * 60 * 60 * 1000
    ) return null;
    return value;
  }

  function clearRecovery() {
    try { localStorage.removeItem(LOCAL_KEY); } catch {}
  }

  async function api(path, body = {}) {
    const phase4 = global.DueDiligencePhase4;
    if (!phase4?.getSession?.()?.access_token) {
      phase4?.openSignIn?.();
      const error = new Error('Sign in with Google to use the examination beta.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    const payload = await phase4.request(path, { body });
    return payload.data;
  }

  async function tokenApi(path, body = {}) {
    const response = await fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'The secure assignment request failed.');
      error.code = payload?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return payload.data;
  }

  function setStatus(message, type = '') {
    document.querySelectorAll('.dd-exam-status').forEach((node) => {
      node.textContent = message || '';
      node.className = `dd-exam-status${type ? ` is-${type}` : ''}`;
    });
  }

  function notify(message, type = 'ok') {
    global.toast?.(message, type);
    setStatus(message, type === 'warn' ? 'error' : type === 'ok' ? 'success' : '');
  }

  function pageRoot(track = state.track) {
    return document.getElementById(
      track === 'bar_feels' ? 'dd-bar-feels-app' : 'dd-per-subject-app',
    );
  }

  function showTrackPage(track) {
    state.track = track;
    const page = track === 'bar_feels' ? 'bar-feels' : 'midterms';
    global.showPage?.(page, null);
    document.querySelectorAll('.spa-tab').forEach((tab) => tab.classList.remove('active'));
  }

  function formatDuration(seconds) {
    const total = Number(seconds) || 0;
    if (total === 14_400) return '4 hours';
    if (total % 3600 === 0) {
      const hours = total / 3600;
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    return `${Math.round(total / 60)} minutes`;
  }

  function formatClock(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatDate(value) {
    if (!value) return 'Not yet submitted';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(date);
  }

  function wordCount(value) {
    return String(value || '').trim().match(/\S+/g)?.length || 0;
  }

  function examItemsForSubject(subject) {
    return state.catalog.filter(
      (item) => item.track === 'per_subject' && item.subject === subject,
    );
  }

  function availabilityMap() {
    const map = new Map();
    SUBJECTS.forEach((subject) => {
      map.set(subject.source, examItemsForSubject(subject.source).length > 0);
    });
    return map;
  }

  function perSubjectCard(item, subject) {
    const labels = {
      midterm: 'Midterm Examination',
      final: 'Final Examination',
      quiz: 'Subject Matter Practice',
      system_test: 'Controlled System Test',
    };
    const label = labels[item?.assessmentKind] || 'Subject Matter Practice';
    if (!item) {
      return `<article class="dd-exam-card">
        <div class="dd-exam-card-head">
          <h3>${label}</h3>
          <span class="dd-exam-pill is-pending">Editorial review pending</span>
        </div>
        <p class="dd-exam-description">
          This examination is not published. The source rows for ${escapeHtml(subject.display)}
          do not yet satisfy the Sheet&rsquo;s Approved / Publication Ready gate.
        </p>
        <button class="dd-exam-button" type="button" disabled>Not available</button>
      </article>`;
    }
    const resume = item.resumableAttemptId
      ? `<button class="dd-exam-button" type="button"
          data-exam-resume="${escapeHtml(item.resumableAttemptId)}">Resume Examination</button>`
      : '';
    return `<article class="dd-exam-card">
      <div class="dd-exam-card-head">
        <div>
          <h3>${escapeHtml(label)}</h3>
          <p class="dd-exam-description">${escapeHtml(item.title)}</p>
        </div>
        <span class="dd-exam-pill">${item.testOnly ? 'Controlled system test' : 'Published'}</span>
      </div>
      <div class="dd-exam-meta">
        <div><small>Questions</small><strong>${Number(item.questionCount)}</strong></div>
        <div><small>Duration</small><strong>${escapeHtml(formatDuration(item.durationSeconds))}</strong></div>
        <div><small>Assessment</small><strong>0.0&ndash;5.0 each</strong></div>
      </div>
      <p class="dd-exam-description">
        ALAC assessment per answer. Stored sources remain attached for verification.
        ${item.testOnly ? 'This is not represented as a complete twenty-question academic examination.' : ''}
      </p>
      <div class="dd-exam-actions">
        <button class="dd-exam-button is-primary" type="button"
          data-exam-setup="${escapeHtml(item.versionId)}">Begin Examination</button>
        ${resume}
      </div>
    </article>`;
  }

  function groupedSubjectButtons(selected, availability) {
    return [1, 2].map((year) => [1, 2].map((term) => {
      const subjects = SUBJECTS.filter((subject) => subject.year === year && subject.term === term);
      return `<section class="dd-subject-group">
        <h3>Year ${year} · Term ${term}</h3>
        ${subjects.map((subject) => {
          const ready = availability.get(subject.source);
          return `<button class="dd-subject-button ${subject.source === selected.source ? 'is-selected' : ''}"
            type="button" data-exam-subject="${escapeHtml(subject.source)}">
            <span>${escapeHtml(subject.display)}</span>
            <small class="dd-subject-state ${ready ? 'is-ready' : ''}">
              ${ready ? 'Practice ready' : 'Review pending'}
            </small>
          </button>`;
        }).join('')}
      </section>`;
    }).join('')).join('');
  }

  function renderPerSubject() {
    const root = pageRoot('per_subject');
    if (!root) return;
    const selected = SUBJECTS.find((subject) => subject.source === state.selectedSubject)
      || SUBJECTS[2];
    const availability = availabilityMap();
    const subjectItems = examItemsForSubject(selected.source);
    const practiceItems = [...subjectItems].sort((left, right) => {
      const rank = { quiz: 0, midterm: 1, final: 2, system_test: 3 };
      return (rank[left.assessmentKind] ?? 9) - (rank[right.assessmentKind] ?? 9);
    });
    const syllabus = [...new Set(subjectItems.flatMap((item) => item.syllabus || []))];
    const relatedHistory = state.history.filter((item) => item.subject === selected.source).slice(0, 5);

    root.innerHTML = `<div class="dd-exam-page"><div class="dd-exam-shell">
      <header class="dd-exam-hero">
        <div>
          <p class="dd-exam-kicker">Mock Bar / Structured Assessment</p>
          <h1>Subject Matter Examinations</h1>
          <p>Published essay practice for LEB-required subjects, using one authoritative
            timer, ALAC workspaces, autosave, and individual five-point assessments.</p>
        </div>
        <span class="dd-exam-beta">Allowlisted live beta</span>
      </header>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
      <div class="dd-subject-layout">
        <aside class="dd-exam-panel">
          <p class="dd-exam-panel-title">First- and Second-Year LEB Subjects</p>
          <label class="sr-only" for="dd-subject-search">Filter subjects</label>
          <input class="dd-subject-search" id="dd-subject-search" type="search"
            placeholder="Filter subjects">
          <label class="sr-only" for="dd-subject-mobile">Select subject</label>
          <select class="dd-subject-mobile" id="dd-subject-mobile">
            ${SUBJECTS.map((subject) => `<option value="${escapeHtml(subject.source)}"
              ${subject.source === selected.source ? 'selected' : ''}>${escapeHtml(subject.display)}</option>`).join('')}
          </select>
          <div class="dd-subject-list">
            ${groupedSubjectButtons(selected, availability)}
          </div>
        </aside>
        <main>
          <header class="dd-selected-heading">
            <p class="dd-exam-kicker">Year ${selected.year} · Term ${selected.term} LEB Subject</p>
            <h2>${escapeHtml(selected.display)}</h2>
            <p>One approved essay question, with a seven-minute strict mode and optional
              self-paced or untimed review. No timer starts before setup confirmation.</p>
          </header>
          <div class="dd-exam-card-list">
            ${practiceItems.length
              ? practiceItems.map((item) => perSubjectCard(item, selected)).join('')
              : perSubjectCard(null, selected)}
          </div>
        </main>
        <aside>
          <section class="dd-exam-panel">
            <p class="dd-exam-panel-title">Syllabus Coverage</p>
            <h3>${escapeHtml(selected.display)}</h3>
            ${syllabus.length
              ? `<ul class="dd-syllabus-list">${syllabus.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
              : '<p class="dd-exam-description">Coverage appears only after a reviewed examination version is published.</p>'}
          </section>
          <section class="dd-exam-panel" style="margin-top:16px">
            <p class="dd-exam-panel-title">The Verdict</p>
            <h3>Recent Examination History</h3>
            ${relatedHistory.length
              ? `<div class="dd-history-list">${relatedHistory.map((item) => `
                <button class="dd-history-item dd-exam-button" type="button"
                  data-exam-verdict="${escapeHtml(item.attemptId)}">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.status)} &middot; ${escapeHtml(formatDate(item.submittedAt || item.startedAt))}</span>
                </button>`).join('')}</div>`
              : '<p class="dd-exam-description">No genuine attempts for this subject yet.</p>'}
          </section>
        </aside>
      </div>
    </div></div>`;
  }

  function curatedBarCards() {
    const items = state.catalog.filter((item) => item.track === 'bar_feels');
    if (!items.length) {
      return `<div class="dd-unavailable">
        No curated Bar Feels examination is published for this beta account yet.
        Founder Admins can publish a controlled test from Chambers.
      </div>`;
    }
    return items.map((item) => `<article class="dd-exam-card">
      <div class="dd-exam-card-head">
        <div><h3>${escapeHtml(item.title)}</h3>
          <p class="dd-exam-description">${escapeHtml(item.subject || 'Curated Philippine law examination')}</p></div>
        <span class="dd-exam-pill">${item.testOnly ? 'System test' : 'Curated'}</span>
      </div>
      <div class="dd-exam-meta">
        <div><small>Questions</small><strong>${Number(item.questionCount)}</strong></div>
        <div><small>Duration</small><strong>${escapeHtml(formatDuration(item.durationSeconds))}</strong></div>
        <div><small>Route</small><strong>${escapeHtml(item.gradingRoute)}</strong></div>
      </div>
      <div class="dd-exam-actions">
        <button class="dd-exam-button is-primary" data-exam-setup="${escapeHtml(item.versionId)}"
          type="button">Open Examination Setup</button>
        ${item.resumableAttemptId ? `<button class="dd-exam-button"
          data-exam-resume="${escapeHtml(item.resumableAttemptId)}" type="button">Resume</button>` : ''}
      </div>
    </article>`).join('');
  }

  function renderBarFeels() {
    const root = pageRoot('bar_feels');
    if (!root) return;
    root.innerHTML = `<div class="dd-exam-page"><div class="dd-exam-shell">
      <header class="dd-exam-hero">
        <div>
          <p class="dd-exam-kicker">Mock Bar / Examination Room</p>
          <h1>Bar Feels</h1>
          <p>Enter a focused multi-question examination using a curated Due Diligence set
            or a private authorized upload. No timer begins before you confirm the setup.</p>
        </div>
        <span class="dd-exam-beta">Allowlisted live beta</span>
      </header>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
      <div class="dd-bar-entry-grid">
        <section class="dd-bar-entry-card">
          <p class="dd-exam-kicker">Curated Route</p>
          <h2>Due Diligence Examination</h2>
          <p>Use approved question snapshots with stored model answers, legal bases,
            and official source links. Each answer is assessed independently from 0.0 to 5.0.</p>
          <div class="dd-exam-card-list">${curatedBarCards()}</div>
        </section>
        <section class="dd-bar-entry-card">
          <p class="dd-exam-kicker">Private Route</p>
          <h2>Authorized Uploaded Examination</h2>
          <p>Upload a plain-text or Word examination. The file remains private and
            never enters the public question bank. PDF is not accepted in this beta because
            the current static/Worker stack cannot parse it reliably without weakening validation.</p>
          <form id="dd-upload-form">
            <label class="dd-exam-field">Examination title
              <input id="dd-upload-title" maxlength="180" required
                placeholder="e.g., Synthetic Civil Law Review">
            </label>
            <div class="dd-upload-drop">
              <label for="dd-upload-file"><strong>Select .txt or .docx</strong><br>
                <small>1.5 MB maximum; signature and MIME validated</small></label>
              <input id="dd-upload-file" type="file"
                accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required>
            </div>
            <div class="dd-exam-actions">
              <button class="dd-exam-button is-primary" type="submit">Parse Securely</button>
            </div>
          </form>
        </section>
      </div>
    </div></div>`;
  }

  function setupDialog() {
    let dialog = document.getElementById('dd-exam-setup-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'dd-exam-setup-dialog';
    dialog.className = 'dd-exam-dialog';
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) dialog.close('cancel');
    });
    document.body.append(dialog);
    return dialog;
  }

  async function openSetup(versionId) {
    setStatus('Loading secure examination setup…');
    try {
      const setup = await api('/examinations/query', { operation: 'setup', versionId });
      state.setup = setup;
      const dialog = setupDialog();
      const modes = [
        ['strict', 'Strict Scrutiny', 'One authoritative overall countdown; automatic full submission at zero.'],
        ['selfPaced', 'Quantum Meruit', 'Counts upward from 0:00 with no automatic deadline.'],
        ['none', 'Summary Judgment', 'No visible timer; server timestamps remain recorded.'],
      ].filter(([mode]) => (setup.allowedTimerModes || []).includes(mode));
      dialog.innerHTML = `<div class="dd-exam-dialog-inner">
        <p class="dd-exam-kicker">${escapeHtml(setup.track === 'bar_feels' ? 'Bar Feels' : 'Subject Matter Examination')}</p>
        <h2>${escapeHtml(setup.title)}</h2>
        <p class="dd-exam-description">Review the complete setup. The timer has not started.</p>
        <dl>
          <dt>Source</dt><dd>${escapeHtml(setup.source)}</dd>
          <dt>Subject / block</dt><dd>${escapeHtml(setup.subject || 'Curated mixed block')}</dd>
          <dt>Questions</dt><dd>${Number(setup.questionCount)}</dd>
          <dt>Duration</dt><dd>${escapeHtml(formatDuration(setup.durationSeconds))}</dd>
          <dt>Grading route</dt><dd>${escapeHtml(setup.gradingRoute)}</dd>
          <dt>Answer release</dt><dd>${escapeHtml(String(setup.answerReleaseRule).replaceAll('_', ' '))}</dd>
          <dt>Examinee</dt><dd>${escapeHtml(setup.examinee || 'Authenticated examinee')}</dd>
        </dl>
        <p class="dd-exam-description">${escapeHtml(setup.instructions)}</p>
        <label class="dd-exam-field">Timer mode
          <select id="dd-setup-timer">
            ${modes.map(([mode, title, copy]) => `<option value="${mode}"
              ${mode === setup.timerMode ? 'selected' : ''}>${escapeHtml(title)} — ${escapeHtml(copy)}</option>`).join('')}
          </select>
        </label>
        <div class="dd-exam-dialog-actions">
          <button class="dd-exam-button" type="button" data-dialog-cancel>Cancel</button>
          <button class="dd-exam-button is-primary" type="button" data-exam-begin>Begin Examination</button>
        </div>
      </div>`;
      dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-exam-begin]').addEventListener('click', beginExamination);
      dialog.showModal();
      setStatus('');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function beginExamination() {
    if (!state.setup) return;
    const button = document.querySelector('[data-exam-begin]');
    if (button) button.disabled = true;
    try {
      const timerMode = document.getElementById('dd-setup-timer')?.value || state.setup.timerMode;
      const active = await api('/examinations/command', {
        operation: 'start_attempt',
        versionId: state.setup.versionId,
        timerMode,
        requestKey: requestKey('start'),
        tabToken: tabToken(),
      });
      setupDialog().close('begin');
      activateAttempt(active);
    } catch (error) {
      setStatus(error.message, 'error');
      if (button) button.disabled = false;
    }
  }

  function reconcileRecovery(active) {
    const recovery = readRecovery();
    if (recovery?.attemptId !== active?.attempt?.attemptId) return active;
    const saved = new Map((recovery.questions || []).map((item) => [item.questionId, item]));
    active.questions = active.questions.map((question) => {
      const local = saved.get(question.questionId);
      if (!local || Number(local.revision) < Number(question.revision)) return question;
      if (Number(local.revision) === Number(question.revision)
        && local.answerText !== question.answerText) {
        return { ...question, localRecoveryText: local.answerText };
      }
      return question;
    });
    return active;
  }

  function activateAttempt(active) {
    stopActiveTimers();
    state.active = reconcileRecovery(active);
    state.currentIndex = Math.min(
      Number(readRecovery()?.currentIndex) || 0,
      Math.max(0, state.active.questions.length - 1),
    );
    state.screen = 'room';
    state.clientRemaining = state.active.attempt.remainingSeconds;
    state.clientElapsed = Number(state.active.attempt.elapsedSeconds) || 0;
    state.serverSyncAt = Date.now();
    state.expiryInFlight = false;
    showTrackPage(state.active.examination.track);
    renderRoom();
    saveRecovery();
    state.clockTimer = setInterval(tickClock, 1000);
    state.heartbeatTimer = setInterval(() => heartbeat(false), HEARTBEAT_MS);
    history.pushState({ dueDiligenceExamination: state.active.attempt.attemptId }, '', location.href);
  }

  async function resumeAttempt(attemptId) {
    setStatus('Recovering your server-saved examination…');
    try {
      const active = await api('/examinations/query', {
        operation: 'resume',
        attemptId,
      });
      activateAttempt(active);
      await heartbeat(false);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  function currentQuestion() {
    return state.active?.questions?.[state.currentIndex] || null;
  }

  function answerValue() {
    return document.getElementById('dd-answer-editor')?.value ?? currentQuestion()?.answerText ?? '';
  }

  function counts() {
    const questions = state.active?.questions || [];
    return {
      answered: questions.filter((question) => String(question.answerText || '').trim()).length,
      flagged: questions.filter((question) => question.flagged).length,
      remaining: questions.filter((question) => !String(question.answerText || '').trim()).length,
      total: questions.length,
    };
  }

  function renderRoom() {
    const root = pageRoot(state.active?.examination?.track || state.track);
    if (!root || !state.active) return;
    const question = currentQuestion();
    const summary = counts();
    const timerMode = state.active.attempt.timerMode;
    root.innerHTML = `<div class="dd-exam-room">
      <header class="dd-exam-room-bar">
        <div class="dd-room-brand"><strong>Due Diligence</strong><span>PH BAR EXAM SIMULATOR</span></div>
        <div class="dd-exam-room-title">
          <h1>${escapeHtml(state.active.examination.title)}</h1>
          <span>${state.active.examination.track === 'bar_feels'
            ? 'BAR FEELS'
            : 'SUBJECT MATTER EXAMINATION'} &middot;
            ${escapeHtml(state.active.examination.subject || 'Curated examination')}</span>
        </div>
        <div class="dd-room-clock ${timerMode === 'none' ? 'is-hidden' : ''}" id="dd-room-clock">
          <small>${timerMode === 'strict' ? 'Overall time remaining' : 'Total writing time'}</small>
          <strong id="dd-room-clock-value">${formatClock(
            timerMode === 'strict' ? state.clientRemaining : state.clientElapsed,
          )}</strong>
        </div>
      </header>
      <div class="dd-exam-room-layout">
        <aside class="dd-question-rail">
          <p class="dd-rail-title">Question Navigator</p>
          <div class="dd-question-grid">
            ${state.active.questions.map((item, index) => `<button type="button"
              class="dd-question-number ${item.answerText?.trim() ? 'is-answered' : ''}
                ${item.flagged ? 'is-flagged' : ''} ${index === state.currentIndex ? 'is-current' : ''}"
              data-exam-question="${index}" aria-label="Question ${index + 1}${item.flagged ? ', flagged' : ''}">
              ${index + 1}
            </button>`).join('')}
          </div>
          <div class="dd-rail-legend">
            <span>Filled: answered</span><span>Gold dot: flagged</span><span>Navy: current</span>
          </div>
        </aside>
        <main class="dd-writing-workspace">
          <p class="dd-question-label">Question ${state.currentIndex + 1} of ${summary.total}</p>
          <div class="dd-question-prompt">${escapeHtml(question.prompt)}</div>
          ${question.localRecoveryText != null ? `<div class="dd-exam-status is-error">
            A newer local draft differs from the server revision.
            <button class="dd-exam-button" type="button" data-use-local-draft>Use local draft</button>
          </div>` : ''}
          <section class="dd-answer-card">
            <div class="dd-alac-guide">
              <span>I. Answer</span><span>II. Legal Basis</span>
              <span>III. Application</span><span>IV. Conclusion</span>
            </div>
            <label class="sr-only" for="dd-answer-editor">Your ALAC answer</label>
            <textarea class="dd-answer-editor" id="dd-answer-editor" maxlength="20000"
              placeholder="I. ANSWER — State your direct answer.

II. LEGAL BASIS — Cite the governing provision or doctrine.

III. APPLICATION — Apply the exact facts to the law.

IV. CONCLUSION — Reaffirm your position.">${escapeHtml(question.answerText || '')}</textarea>
            <footer class="dd-answer-footer">
              <span id="dd-word-count">${wordCount(question.answerText)} words</span>
              <span class="dd-save-state is-saved" id="dd-save-state">Server revision ${Number(question.revision) || 0}</span>
            </footer>
          </section>
        </main>
        <aside class="dd-exam-status-rail">
          <div>
            <p class="dd-rail-title">Exam Status</p>
            <div class="dd-status-stats">
              <div class="dd-status-stat"><small>Answered</small><strong id="dd-count-answered">${summary.answered}</strong></div>
              <div class="dd-status-stat"><small>Flagged</small><strong id="dd-count-flagged">${summary.flagged}</strong></div>
              <div class="dd-status-stat"><small>Remaining</small><strong id="dd-count-remaining">${summary.remaining}</strong></div>
            </div>
          </div>
          <div class="dd-status-actions">
            <button class="dd-exam-button" id="dd-flag-button" type="button">
              ${question.flagged ? 'Remove Flag' : 'Flag for Review'}
            </button>
            <button class="dd-exam-button is-gold" data-review-all type="button">Review All Answers</button>
          </div>
        </aside>
      </div>
      <nav class="dd-room-bottom" aria-label="Question navigation">
        <button class="dd-exam-button" data-question-prev type="button"
          ${state.currentIndex === 0 ? 'disabled' : ''}>Previous</button>
        <span class="dd-room-bottom-status">${wordCount(question.answerText)} words &middot;
          ${timerMode === 'strict' ? `${formatClock(state.clientRemaining)} remaining` : 'Autosave active'}</span>
        <button class="dd-exam-button is-primary" data-question-next type="button">
          ${state.currentIndex === summary.total - 1 ? 'Review All' : 'Next Question'}
        </button>
      </nav>
    </div>`;
    bindRoom();
    updateClockNode();
  }

  function bindRoom() {
    const editor = document.getElementById('dd-answer-editor');
    editor?.addEventListener('input', () => {
      const question = currentQuestion();
      question.answerText = editor.value;
      question.localRecoveryText = null;
      document.getElementById('dd-word-count').textContent = `${wordCount(editor.value)} words`;
      const stateNode = document.getElementById('dd-save-state');
      if (stateNode) {
        stateNode.textContent = 'Unsaved changes';
        stateNode.className = 'dd-save-state is-saving';
      }
      updateCountsNodes();
      saveRecovery();
      scheduleSave();
    });
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveCurrent(), AUTOSAVE_MS);
  }

  async function saveCurrent(options = {}) {
    const question = currentQuestion();
    if (!question || !state.active) return true;
    const editor = document.getElementById('dd-answer-editor');
    if (editor) question.answerText = editor.value;
    if (state.saveInFlight) {
      state.pendingSave = true;
      return false;
    }
    state.saveInFlight = true;
    const saveNode = document.getElementById('dd-save-state');
    if (saveNode) {
      saveNode.textContent = 'Saving securely…';
      saveNode.className = 'dd-save-state is-saving';
    }
    try {
      const result = await api('/examinations/command', {
        operation: 'save_response',
        attemptId: state.active.attempt.attemptId,
        questionId: question.questionId,
        tabToken: tabToken(),
        answerText: question.answerText || '',
        expectedRevision: Number(question.revision) || 0,
        flagged: question.flagged === true,
      });
      question.answerText = result.answerText;
      question.flagged = result.flagged;
      question.revision = result.revision;
      question.savedAt = result.savedAt;
      question.localRecoveryText = null;
      state.active.attempt.lastSavedAt = result.savedAt;
      if (Number.isFinite(Number(result.remainingSeconds))) {
        state.clientRemaining = Number(result.remainingSeconds);
        state.serverSyncAt = Date.now();
      }
      if (saveNode) {
        saveNode.textContent = `Saved ${formatDate(result.savedAt)}`;
        saveNode.className = 'dd-save-state is-saved';
      }
      saveRecovery();
      return true;
    } catch (error) {
      if (saveNode) {
        saveNode.textContent = error.code === 'EXAM_RESPONSE_CONFLICT'
          ? 'Revision conflict — reload required'
          : 'Offline draft retained — retrying';
        saveNode.className = 'dd-save-state is-error';
      }
      saveRecovery();
      if (error.code === 'EXAM_RESPONSE_CONFLICT') {
        notify('A newer server revision exists. Reload the attempt before editing further.', 'warn');
      } else if (!options.silent) {
        setStatus(error.message, 'error');
      }
      return false;
    } finally {
      state.saveInFlight = false;
      if (state.pendingSave) {
        state.pendingSave = false;
        scheduleSave();
      }
    }
  }

  async function flushCurrentSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    const deadline = Date.now() + 12_000;
    while (state.saveInFlight && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (state.saveInFlight) {
      setStatus('The latest revision is still saving. Submission is paused to protect your answer.', 'error');
      return false;
    }
    return saveCurrent({ silent: true });
  }

  async function heartbeat(takeover) {
    if (!state.active?.attempt?.attemptId || !['room', 'review'].includes(state.screen)) return false;
    try {
      const result = await api('/examinations/command', {
        operation: 'heartbeat',
        attemptId: state.active.attempt.attemptId,
        tabToken: tabToken(),
        takeover: takeover === true,
      });
      if (result.expired || ['submitted', 'expired'].includes(result.status)) {
        showReceipt(result);
        return true;
      }
      state.active.attempt = { ...state.active.attempt, ...result };
      state.clientRemaining = result.remainingSeconds;
      state.clientElapsed = Number(result.elapsedSeconds) || state.clientElapsed;
      state.serverSyncAt = Date.now();
      updateClockNode();
      return true;
    } catch (error) {
      if (error.code === 'EXAM_SECOND_TAB_BLOCKED') {
        stopActiveTimers();
        notify('This examination is active in another tab. This view is read-only until its lease expires.', 'warn');
        document.getElementById('dd-answer-editor')?.setAttribute('readonly', '');
      } else {
        setStatus('Connection interrupted. Your local draft is retained; the server timer continues.', 'error');
      }
      return false;
    }
  }

  function tickClock() {
    if (!state.active) return;
    const mode = state.active.attempt.timerMode;
    if (mode === 'strict' && Number.isFinite(Number(state.clientRemaining))) {
      state.clientRemaining = Math.max(0, Number(state.clientRemaining) - 1);
      if (state.clientRemaining === 0 && !state.expiryInFlight) {
        state.expiryInFlight = true;
        flushCurrentSave()
          .then((saved) => {
            if (!saved) throw new Error('The final answer revision was not confirmed.');
            return heartbeat(false).then((confirmed) => {
              if (!confirmed) throw new Error('The server did not confirm expiration.');
            });
          })
          .catch(() => {
            state.expiryInFlight = false;
            setStatus('The server timer has expired. Reconnecting to preserve and submit the examination…', 'error');
          });
      }
    } else if (mode === 'selfPaced') {
      state.clientElapsed += 1;
    }
    updateClockNode();
  }

  function updateClockNode() {
    const clock = document.getElementById('dd-room-clock');
    const value = document.getElementById('dd-room-clock-value');
    if (!clock || !value || !state.active) return;
    const strict = state.active.attempt.timerMode === 'strict';
    const seconds = strict ? state.clientRemaining : state.clientElapsed;
    value.textContent = formatClock(seconds);
    clock.classList.toggle('is-warning', strict && Number(seconds) <= 300);
  }

  function updateCountsNodes() {
    const summary = counts();
    const answered = document.getElementById('dd-count-answered');
    const flagged = document.getElementById('dd-count-flagged');
    const remaining = document.getElementById('dd-count-remaining');
    if (answered) answered.textContent = summary.answered;
    if (flagged) flagged.textContent = summary.flagged;
    if (remaining) remaining.textContent = summary.remaining;
  }

  async function navigateQuestion(index) {
    if (!state.active) return;
    if (!await flushCurrentSave()) return;
    state.currentIndex = Math.max(0, Math.min(index, state.active.questions.length - 1));
    saveRecovery();
    renderRoom();
  }

  async function toggleFlag() {
    const question = currentQuestion();
    if (!question) return;
    if (!await flushCurrentSave()) return;
    try {
      const result = await api('/examinations/command', {
        operation: 'flag_response',
        attemptId: state.active.attempt.attemptId,
        questionId: question.questionId,
        tabToken: tabToken(),
        expectedRevision: Number(question.revision) || 0,
        flagged: !question.flagged,
      });
      question.flagged = result.flagged;
      question.revision = result.revision;
      question.savedAt = result.savedAt;
      saveRecovery();
      renderRoom();
    } catch (error) {
      notify(error.message, 'warn');
    }
  }

  async function showReview() {
    if (!await flushCurrentSave()) return;
    state.screen = 'review';
    const root = pageRoot(state.active.examination.track);
    const summary = counts();
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-review-screen">
      <p class="dd-exam-kicker">Mandatory Review Screen</p>
      <h1>Review all answers.</h1>
      <p class="dd-exam-description">Submission is final. Open any question to revise it before confirming.</p>
      <div class="dd-review-summary">
        <div><strong>${summary.answered}</strong><span>Answered</span></div>
        <div><strong>${summary.flagged}</strong><span>Flagged</span></div>
        <div><strong>${summary.remaining}</strong><span>Unanswered</span></div>
      </div>
      <div class="dd-review-list">
        ${state.active.questions.map((question, index) => `<article class="dd-review-row">
          <strong>Question ${index + 1}</strong>
          <span>${question.answerText?.trim() ? `${wordCount(question.answerText)} words` : 'Unanswered'}
            ${question.flagged ? ' · Flagged for review' : ''}</span>
          <button class="dd-exam-button" type="button" data-review-question="${index}">Open</button>
        </article>`).join('')}
      </div>
      <div class="dd-confirm-submit">
        <div><strong>Confirm final submission</strong>
          <p class="dd-exam-description">A unique receipt will be issued. Repeated clicks cannot create duplicates.</p></div>
        <div class="dd-exam-actions">
          <button class="dd-exam-button" type="button" data-return-room>Return to examination</button>
          <button class="dd-exam-button is-danger" type="button" data-submit-exam>Submit Examination</button>
        </div>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </section></div>`;
  }

  async function submitExamination(button) {
    if (!state.active) return;
    button.disabled = true;
    button.textContent = 'Submitting once…';
    setStatus('Saving every revision and creating your submission receipt…');
    try {
      if (!await flushCurrentSave()) {
        throw new Error('The latest answer revision could not be confirmed. Nothing was submitted.');
      }
      const result = await api('/examinations/command', {
        operation: 'submit_attempt',
        attemptId: state.active.attempt.attemptId,
        tabToken: tabToken(),
        requestKey: requestKey('submit'),
        confirmed: true,
      });
      showReceipt(result);
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Submit Examination';
    }
  }

  function showReceipt(receipt) {
    stopActiveTimers();
    state.expiryInFlight = false;
    clearRecovery();
    state.screen = 'receipt';
    if (state.active?.attempt) {
      state.active.attempt.status = receipt.status;
      state.active.attempt.submittedAt = receipt.submittedAt;
    }
    const root = pageRoot(state.active?.examination?.track || state.track);
    const grading = state.active?.examination?.gradingRoute;
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-receipt-screen">
      <p class="dd-exam-kicker">Submission Received</p>
      <h1>Your examination is preserved.</h1>
      <p class="dd-exam-description">${receipt.automatic
        ? 'Strict Scrutiny expired and the full examination was submitted automatically.'
        : 'Your confirmed examination submission was accepted exactly once.'}</p>
      <code class="dd-receipt-code">${escapeHtml(receipt.receiptCode || 'Receipt recorded')}</code>
      <div class="dd-review-summary">
        <div><strong>${Number(receipt.answeredCount) || 0}</strong><span>Answered</span></div>
        <div><strong>${Number(receipt.flaggedCount) || 0}</strong><span>Flagged</span></div>
        <div><strong>${Number(receipt.questionCount) || state.active?.questions?.length || 0}</strong><span>Total questions</span></div>
      </div>
      <div class="dd-exam-actions">
        ${['ai', 'either'].includes(grading) ? '<button class="dd-exam-button is-primary" type="button" data-request-ai>Request AI Assessment</button>' : ''}
        ${['human', 'either', 'provisional'].includes(grading) ? '<button class="dd-exam-button is-gold" type="button" data-request-human>Human Examiner Review</button>' : ''}
        <button class="dd-exam-button" type="button" data-exam-verdict="${escapeHtml(receipt.attemptId || state.active?.attempt?.attemptId)}">Open The Verdict</button>
        <button class="dd-exam-button" type="button" data-return-catalog>Return to Mock Bar Hub</button>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </section></div>`;
  }

  async function requestAiAssessment(button) {
    button.disabled = true;
    button.textContent = 'Assessing each answer…';
    setStatus('The examiner is comparing each response with the stored approved answer and legal basis.');
    try {
      let result = null;
      const maximumBatches = Math.max(1, state.active.questions.length + 1);
      for (let batch = 0; batch < maximumBatches; batch += 1) {
        result = await api('/examinations/command', {
          operation: 'request_ai_grading',
          attemptId: state.active.attempt.attemptId,
          requestKey: requestKey('ai'),
        });
        const completed = Number(result.completedQuestions) || 0;
        const total = Number(result.questionCount) || state.active.questions.length;
        button.textContent = `Assessed ${completed} of ${total}…`;
        setStatus(`AI Assessment progress: ${completed} of ${total} individual answers finalized.`);
        if (result.status === 'completed') break;
      }
      if (result?.status !== 'completed') {
        throw new Error('The grading queue paused before every individual assessment was finalized. Retry safely to continue.');
      }
      notify(`AI Assessment completed for ${result.completedQuestions} of ${result.questionCount} answers.`, 'ok');
      await openVerdict(state.active.attempt.attemptId);
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Retry AI Assessment';
    }
  }

  function humanDialog() {
    let dialog = document.getElementById('dd-human-review-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'dd-human-review-dialog';
    dialog.className = 'dd-exam-dialog';
    dialog.innerHTML = `<form class="dd-exam-dialog-inner" id="dd-human-form">
      <p class="dd-exam-kicker">Structured Review</p>
      <h2>Invite a Human Examiner</h2>
      <p class="dd-exam-description">The invitation contains only an expiring secure link.
        No answer or model answer is attached to email.</p>
      <label class="dd-exam-field">Examiner email
        <input type="email" id="dd-examiner-email" maxlength="254" required>
      </label>
      <div class="dd-exam-dialog-actions">
        <button class="dd-exam-button" type="button" data-dialog-cancel>Cancel</button>
        <button class="dd-exam-button is-primary" type="submit">Create Assignment</button>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </form>`;
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', createHumanAssignment);
    document.body.append(dialog);
    return dialog;
  }

  async function createHumanAssignment(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const examinerEmail = document.getElementById('dd-examiner-email').value.trim();
    const assignmentToken = randomToken(36);
    try {
      const result = await api('/examinations/command', {
        operation: 'create_examiner_assignment',
        attemptId: state.active.attempt.attemptId,
        examinerEmail,
        requestKey: requestKey('human'),
        assignmentToken,
      });
      humanDialog().close();
      const truthful = result.invitationStatus === 'sent'
        ? 'Examiner invitation sent and assignment preserved.'
        : `Assignment preserved. Email status: ${result.invitationStatus}.`;
      notify(truthful, result.invitationStatus === 'sent' ? 'ok' : 'warn');
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  }

  async function openVerdict(attemptId) {
    state.screen = 'verdict';
    showTrackPage(state.active?.examination?.track || state.track);
    const root = pageRoot(state.active?.examination?.track || state.track);
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
      <p class="dd-exam-kicker">The Verdict</p><h1>Loading individual assessments…</h1>
    </section></div>`;
    try {
      const verdict = await api('/examinations/query', {
        operation: 'verdict',
        attemptId,
        limit: 30,
        offset: 0,
      });
      root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">The Verdict / Multi-Question Examination</p>
        <h1>Individual ALAC assessments.</h1>
        <p class="dd-exam-description">No cumulative percentage, class rank, pass/fail claim,
          or unsupported average is calculated.</p>
        ${verdict.results.map((result) => `<article class="dd-verdict-question">
          <p class="dd-question-label">Question ${Number(result.ordinal)}</p>
          <div class="dd-question-prompt">${escapeHtml(result.prompt)}</div>
          ${result.aiScore != null ? `<div class="dd-score-five">${Number(result.aiScore).toFixed(1)} / 5.0</div>` : ''}
          ${result.humanScore != null ? `<div class="dd-score-five">Human ${Number(result.humanScore).toFixed(1)} / 5.0</div>` : ''}
          ${result.aiAssessment ? `<h3>AI Assessment</h3>
            <p class="dd-exam-description">${escapeHtml(result.aiAssessment.rationale || '')}</p>
            ${Array.isArray(result.aiAssessment.strengths) ? `<p><strong>Strengths:</strong> ${escapeHtml(result.aiAssessment.strengths.join(' · '))}</p>` : ''}
            ${Array.isArray(result.aiAssessment.improvements) ? `<p><strong>Coaching:</strong> ${escapeHtml(result.aiAssessment.improvements.join(' · '))}</p>` : ''}` : ''}
          ${result.humanComments ? `<p><strong>Human examiner:</strong> ${escapeHtml(result.humanComments)}</p>` : ''}
          ${result.modelAnswer ? `<h3>Released Model Answer</h3>
            <div class="dd-model-answer">${escapeHtml(result.modelAnswer)}</div>
            ${(result.sources || []).length ? `<ul class="dd-syllabus-list">${result.sources.map((source) =>
              `<li><a href="${escapeHtml(source.url || source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url || source)}</a></li>`).join('')}</ul>` : ''}` : `<p class="dd-exam-description">Model answer not yet released under this examination&rsquo;s rule.</p>`}
        </article>`).join('')}
        <div class="dd-exam-actions" style="margin-top:24px">
          <button class="dd-exam-button" type="button" data-return-catalog>Return to Examination Catalog</button>
        </div>
      </section></div>`;
    } catch (error) {
      root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">The Verdict</p><h1>Assessment unavailable.</h1>
        <div class="dd-exam-status is-error">${escapeHtml(error.message)}</div>
      </section></div>`;
    }
  }

  function stopActiveTimers() {
    clearInterval(state.heartbeatTimer);
    clearInterval(state.clockTimer);
    clearTimeout(state.saveTimer);
    state.heartbeatTimer = null;
    state.clockTimer = null;
    state.saveTimer = null;
  }

  async function loadCatalog(track = state.track) {
    showTrackPage(track);
    const root = pageRoot(track);
    if (root) root.innerHTML = `<div class="dd-exam-page"><div class="dd-exam-shell">
      <div class="dd-exam-status">Verifying beta access and published examination versions…</div>
    </div></div>`;
    try {
      const [catalog, history] = await Promise.all([
        api('/examinations/query', { operation: 'catalog', track }),
        api('/examinations/query', { operation: 'history', limit: 50, offset: 0 }),
      ]);
      state.catalog = catalog.items || [];
      state.history = history.items || [];
      state.screen = 'catalog';
      if (track === 'per_subject') renderPerSubject();
      else renderBarFeels();
    } catch (error) {
      if (root) root.innerHTML = `<div class="dd-exam-page"><div class="dd-exam-shell">
        <header class="dd-exam-hero"><div><p class="dd-exam-kicker">Mock Bar</p>
          <h1>${track === 'per_subject' ? 'Subject Matter Examinations' : 'Bar Feels'}</h1></div></header>
        <div class="dd-exam-status is-error">${escapeHtml(error.message)}</div>
        <button class="dd-exam-button" type="button" data-retry-catalog="${track}">Retry</button>
      </div></div>`;
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  async function parseUpload(form) {
    const file = document.getElementById('dd-upload-file')?.files?.[0];
    const title = document.getElementById('dd-upload-title')?.value.trim();
    if (!file || !title) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Validating and parsing…';
    setStatus('Validating MIME type, signature, size, and private storage…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const data = await api('/examinations/upload', {
        fileName: file.name,
        mimeType: file.type || (file.name.toLowerCase().endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/plain'),
        base64: bytesToBase64(bytes),
        title,
        timerMode: 'strict',
        durationSeconds: 14_400,
        gradingRoute: 'human',
        requestKey: requestKey('upload'),
      });
      state.uploadPreview = { ...data, title };
      openUploadPreview();
      setStatus('');
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Parse Securely';
    }
  }

  function uploadDialog() {
    let dialog = document.getElementById('dd-upload-preview-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'dd-upload-preview-dialog';
      dialog.className = 'dd-exam-dialog';
      document.body.append(dialog);
    }
    return dialog;
  }

  function openUploadPreview() {
    const preview = state.uploadPreview;
    const dialog = uploadDialog();
    dialog.innerHTML = `<div class="dd-exam-dialog-inner">
      <p class="dd-exam-kicker">Extracted Question Preview</p>
      <h2>${escapeHtml(preview.title)}</h2>
      <p class="dd-exam-description">${Number(preview.questionCount)} questions parsed from
        ${escapeHtml(preview.fileName)}. Confirm before any examination is created. The timer has not started.</p>
      <ol class="dd-syllabus-list">
        ${(preview.questions || []).map((question) => `<li>${escapeHtml(question.prompt)}</li>`).join('')}
      </ol>
      <label class="dd-exam-field">Timer mode
        <select id="dd-upload-timer"><option value="strict">Strict Scrutiny</option>
          <option value="selfPaced">Quantum Meruit</option><option value="none">Summary Judgment</option></select>
      </label>
      <label class="dd-exam-field">Grading route
        <select id="dd-upload-route"><option value="human">Human Examiner Review</option>
          <option value="provisional">Provisional feedback only</option></select>
      </label>
      <div class="dd-exam-dialog-actions">
        <button class="dd-exam-button" type="button" data-upload-cancel>Cancel</button>
        <button class="dd-exam-button is-primary" type="button" data-upload-confirm>Confirm Private Examination</button>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </div>`;
    dialog.querySelector('[data-upload-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-upload-confirm]').addEventListener('click', confirmUpload);
    dialog.showModal();
  }

  async function confirmUpload(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/examinations/command', {
        operation: 'confirm_upload',
        uploadId: state.uploadPreview.uploadId,
        title: state.uploadPreview.title,
        timerMode: document.getElementById('dd-upload-timer').value,
        durationSeconds: 14_400,
        gradingRoute: document.getElementById('dd-upload-route').value,
        requestKey: requestKey('confirm'),
      });
      uploadDialog().close();
      notify('Private examination confirmed. Review its setup before beginning.', 'ok');
      await loadCatalog('bar_feels');
      await openSetup(result.versionId);
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  }

  async function openAssignment(token) {
    state.track = 'bar_feels';
    showTrackPage('bar_feels');
    const root = pageRoot('bar_feels');
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
      <p class="dd-exam-kicker">Human Examiner Review</p><h1>Verifying secure assignment…</h1>
    </section></div>`;
    try {
      const assignment = await tokenApi('/examinations/query', {
        operation: 'assignment',
        assignmentToken: token,
      });
      state.assignment = { ...assignment, token };
      await tokenApi('/examinations/command', {
        operation: 'claim_examiner_assignment',
        assignmentToken: token,
      });
      renderAssignment();
    } catch (error) {
      root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">Human Examiner Review</p><h1>Assignment unavailable.</h1>
        <div class="dd-exam-status is-error">${escapeHtml(error.message)}</div>
      </section></div>`;
    }
  }

  function renderAssignment() {
    const root = pageRoot('bar_feels');
    const assignment = state.assignment;
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen">
      <p class="dd-exam-kicker">Secure Expiring Assignment</p>
      <h1>${escapeHtml(assignment.examination.title)}</h1>
      <p class="dd-exam-description">Score each answer from 0.0 to 5.0 and provide structured comments.
        Finalization is irreversible and requires confirmation.</p>
      <form id="dd-examiner-form">
        ${assignment.questions.map((question) => `<article class="dd-verdict-question">
          <p class="dd-question-label">Question ${Number(question.ordinal)}</p>
          <div class="dd-question-prompt">${escapeHtml(question.prompt)}</div>
          <h3>Student answer</h3>
          <div class="dd-model-answer">${escapeHtml(question.answerText || 'No answer submitted.')}</div>
          <label class="dd-exam-field">Score (0.0&ndash;5.0)
            <input type="number" min="0" max="5" step="0.1" required
              data-review-score="${escapeHtml(question.questionId)}"
              value="${question.score ?? ''}">
          </label>
          <label class="dd-exam-field">Examiner comments
            <textarea maxlength="8000" rows="5" data-review-comments="${escapeHtml(question.questionId)}">${escapeHtml(question.comments || '')}</textarea>
          </label>
        </article>`).join('')}
        <div class="dd-confirm-submit">
          <label><input type="checkbox" id="dd-examiner-confirm" required>
            I confirm these are my final structured assessments.</label>
          <button class="dd-exam-button is-danger" type="submit">Save and Finalize Review</button>
        </div>
        <div class="dd-exam-status" role="status" aria-live="polite"></div>
      </form>
    </section></div>`;
    document.getElementById('dd-examiner-form').addEventListener('submit', finalizeAssignment);
  }

  async function finalizeAssignment(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    setStatus('Saving every examiner assessment before final confirmation…');
    try {
      let revisionSum = 0;
      for (const question of state.assignment.questions) {
        const score = document.querySelector(`[data-review-score="${question.questionId}"]`).value;
        const comments = document.querySelector(`[data-review-comments="${question.questionId}"]`).value;
        const saved = await tokenApi('/examinations/command', {
          operation: 'save_examiner_review',
          assignmentToken: state.assignment.token,
          questionId: question.questionId,
          score,
          comments,
          expectedRevision: Number(question.revision) || 0,
        });
        question.revision = saved.revision;
        revisionSum += Number(saved.revision) || 0;
      }
      const result = await tokenApi('/examinations/command', {
        operation: 'finalize_examiner_review',
        assignmentToken: state.assignment.token,
        expectedRevision: revisionSum,
        confirmed: true,
      });
      document.getElementById('dd-examiner-form').innerHTML = `
        <div class="dd-exam-status is-success">Human Examiner Review finalized at
          ${escapeHtml(formatDate(result.finalizedAt))}. Student notification status:
          ${escapeHtml(result.studentNotificationStatus)}.</div>`;
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  }

  function returnCatalog() {
    stopActiveTimers();
    state.active = null;
    state.setup = null;
    state.screen = 'catalog';
    loadCatalog(state.track);
  }

  function handleClick(event) {
    const subject = event.target.closest('[data-exam-subject]');
    if (subject) {
      state.selectedSubject = subject.dataset.examSubject;
      renderPerSubject();
      return;
    }
    const setup = event.target.closest('[data-exam-setup]');
    if (setup) { openSetup(setup.dataset.examSetup); return; }
    const resume = event.target.closest('[data-exam-resume]');
    if (resume) { resumeAttempt(resume.dataset.examResume); return; }
    const question = event.target.closest('[data-exam-question]');
    if (question) { navigateQuestion(Number(question.dataset.examQuestion)); return; }
    if (event.target.closest('[data-question-prev]')) {
      navigateQuestion(state.currentIndex - 1); return;
    }
    if (event.target.closest('[data-question-next]')) {
      if (state.currentIndex >= state.active.questions.length - 1) showReview();
      else navigateQuestion(state.currentIndex + 1);
      return;
    }
    if (event.target.closest('#dd-flag-button')) { toggleFlag(); return; }
    if (event.target.closest('[data-review-all]')) { showReview(); return; }
    const reviewQuestion = event.target.closest('[data-review-question]');
    if (reviewQuestion) {
      state.currentIndex = Number(reviewQuestion.dataset.reviewQuestion);
      state.screen = 'room';
      renderRoom();
      return;
    }
    if (event.target.closest('[data-return-room]')) {
      state.screen = 'room';
      renderRoom();
      return;
    }
    const submit = event.target.closest('[data-submit-exam]');
    if (submit) { submitExamination(submit); return; }
    const verdict = event.target.closest('[data-exam-verdict]');
    if (verdict) { openVerdict(verdict.dataset.examVerdict); return; }
    const retry = event.target.closest('[data-retry-catalog]');
    if (retry) { loadCatalog(retry.dataset.retryCatalog); return; }
    if (event.target.closest('[data-request-ai]')) {
      requestAiAssessment(event.target.closest('[data-request-ai]')); return;
    }
    if (event.target.closest('[data-request-human]')) {
      humanDialog().showModal(); return;
    }
    if (event.target.closest('[data-return-catalog]')) { returnCatalog(); return; }
    if (event.target.closest('[data-use-local-draft]')) {
      const item = currentQuestion();
      item.answerText = item.localRecoveryText;
      item.localRecoveryText = null;
      renderRoom();
    }
  }

  function handleChange(event) {
    if (event.target.id === 'dd-subject-mobile') {
      state.selectedSubject = event.target.value;
      renderPerSubject();
    }
  }

  function handleInput(event) {
    if (event.target.id !== 'dd-subject-search') return;
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.dd-subject-button').forEach((button) => {
      button.hidden = !button.textContent.toLowerCase().includes(query);
    });
  }

  function handleSubmit(event) {
    if (event.target.id === 'dd-upload-form') {
      event.preventDefault();
      parseUpload(event.target);
    }
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    document.addEventListener('submit', handleSubmit);
    global.addEventListener('beforeunload', (event) => {
      if (!state.active || !['room', 'review'].includes(state.screen)) return;
      saveRecovery();
      event.preventDefault();
      event.returnValue = '';
    });
    global.addEventListener('popstate', () => {
      if (!state.active || !['room', 'review'].includes(state.screen)) return;
      history.pushState({ dueDiligenceExamination: state.active.attempt.attemptId }, '', location.href);
      showReview();
      notify('Review the examination before leaving. Your server timer continues.', 'warn');
    });
    global.addEventListener('online', () => {
      if (state.active && state.screen === 'room') {
        saveCurrent({ silent: true }).then(() => heartbeat(false));
      }
    });
    global.addEventListener('duediligence:session', (event) => {
      if (!event.detail?.authenticated) stopActiveTimers();
    });

    const assignmentToken = new URLSearchParams(location.search).get('assignment');
    if (assignmentToken?.length >= 32) {
      openAssignment(assignmentToken);
      return;
    }
    const recovery = readRecovery();
    if (recovery?.attemptId && global.DueDiligencePhase4?.getSession?.()?.access_token) {
      resumeAttempt(recovery.attemptId);
    }
  }

  global.DueDiligenceExaminations = Object.freeze({
    openPerSubject: () => loadCatalog('per_subject'),
    openBarFeels: () => loadCatalog('bar_feels'),
    resumeAttempt,
    openVerdict,
    getState: () => ({
      track: state.track,
      screen: state.screen,
      activeAttemptId: state.active?.attempt?.attemptId || null,
    }),
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
}(window));
