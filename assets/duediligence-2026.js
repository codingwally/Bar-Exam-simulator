(function dueDiligence2026Experience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const CONTENT_PATHS = Object.freeze({
    bar_easy: { hash: 'bar-easy', tab: 'spa-bar-easy', title: 'Bar Easy' },
    chair_case: { hash: 'chairs-cases', tab: 'spa-chairs-case', title: '2026 Bar Chair’s Cases' },
    doctrine: { hash: 'doctrines', tab: 'spa-jurisprudence', title: 'Doctrines' },
    anchor_case: { hash: 'anchor-case-digests', tab: 'spa-case-digest', title: 'Anchor Case Digests' },
    exam_room: { hash: 'examination-room', tab: 'spa-examination-room', title: 'Examination Room' },
  });
  const FLAG_NAMES = Object.freeze({
    bar_easy: 'BAR_EASY_ENABLED',
    chair_case: 'CHAIR_CASES_ENABLED',
    doctrine: 'DOCTRINES_ENABLED',
    anchor_case: 'ANCHOR_CASE_DIGESTS_ENABLED',
    exam_room: 'EXAMINATION_ROOM_2_ENABLED',
  });
  const EXAMINATION_ROOM_BASE_FLAG = 'EXAMINATION_ROOM_ENABLED';
  const state = {
    featureSnapshot: null,
    featurePromise: null,
    view: null,
    items: new Map(),
    filtered: [],
    selectedId: null,
    subject: 'All',
    search: '',
    result: null,
    busy: false,
    exam: {
      portal: null,
      section: 'entry',
      intentRole: null,
      entryExamId: '',
      activeClassroomId: null,
      activeExamId: null,
      activeBeadleSnapshot: null,
      rosterMode: 'professor',
      rosterPreview: null,
      questionPreview: null,
      attempt: null,
      attemptIndex: 0,
      saveTimers: new Map(),
      heartbeatTimer: null,
      countdownTimer: null,
      submissionStatusTimer: null,
      serverOffsetMs: 0,
      serverClockBaseMs: 0,
      serverClockMonotonicAt: 0,
      grading: null,
      gradingModelAnswer: null,
      gradingCandidate: 0,
      gradingQuestion: 0,
      monitoring: null,
      preflight: null,
      submissionKey: null,
      submissionPending: false,
      offlineSince: null,
      transportFailureSince: null,
      syncing: false,
      syncRequested: false,
      maxVisitedIndex: 0,
      store: null,
      tabLease: null,
      tabReturnPending: false,
      lastIntegrityNoticeAt: 0,
      blurIncidentTimer: null,
    },
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function codePointLength(value) { return Array.from(String(value ?? '')).length; }

  function randomKey(prefix = 'request') {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return `${prefix}_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  }

  function formatDate(value) {
    if (!value) return 'Not yet scheduled';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    });
  }

  function synchronizeServerClock(serverNow) {
    const serverNowMs = new Date(serverNow).getTime();
    if (!Number.isFinite(serverNowMs)) return false;
    state.exam.serverClockBaseMs = serverNowMs;
    state.exam.serverClockMonotonicAt = global.performance?.now?.() ?? 0;
    // Compatibility-only diagnostic. Countdown decisions use the monotonic
    // server baseline above, never the device wall clock as evidence.
    state.exam.serverOffsetMs = serverNowMs - Date.now();
    return true;
  }

  function currentServerTimeMs() {
    if (state.exam.serverClockBaseMs > 0 && global.performance?.now) {
      return state.exam.serverClockBaseMs
        + Math.max(0, global.performance.now() - state.exam.serverClockMonotonicAt);
    }
    return Date.now() + state.exam.serverOffsetMs;
  }

  function shortSubject(value) {
    return String(value || '')
      .replace('Political and Public International Law', 'Political')
      .replace('Commercial and Taxation Laws', 'Commercial & Tax')
      .replace('Civil Law', 'Civil')
      .replace('Labor Law and Social Legislations', 'Labor')
      .replace('Criminal Law', 'Criminal')
      .replace('Remedial Law, Legal and Judicial Ethics with Practical Exercises', 'Remedial & Ethics');
  }

  function requireAuthentication() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (phase4?.getSession?.()?.access_token) return true;
    phase4?.requireAuthentication?.();
    phase4?.openSignIn?.();
    global.toast?.('Sign in to open this protected study module.', 'warn');
    return false;
  }

  function randomUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function isClosedAttemptStatus(status) {
    return ['submitted', 'auto_submitted', 'sealed', 'final', 'released'].includes(String(status || '').toLowerCase());
  }

  function isTransientTransportFailure(error) {
    return error instanceof TypeError
      || (!error?.code && !error?.status)
      || (error?.code === 'REQUEST_FAILED' && (!error?.status || Number(error.status) >= 500));
  }

  function isAuthenticated() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    return Boolean(phase4?.getSession?.()?.access_token);
  }

  async function api(path, body) {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (!phase4?.request) throw new Error('The secure study service is not ready.');
    return phase4.request(path, { body });
  }

  function ensurePage() {
    let page = document.getElementById('page-dd2026');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'page-dd2026';
    page.className = 'page dd26-page';
    page.innerHTML = '<div id="dd2026-app"></div>';
    document.getElementById('spa-root')?.append(page);
    return page;
  }

  function app() { return document.getElementById('dd2026-app'); }

  async function features() {
    if (state.featureSnapshot) return state.featureSnapshot;
    if (!state.featurePromise) {
      state.featurePromise = api('/dd2026/features', {})
        .then((payload) => {
          state.featureSnapshot = payload;
          return payload;
        })
        .finally(() => { state.featurePromise = null; });
    }
    return state.featurePromise;
  }

  function activatePage(view, trigger, { replace = false, detailId = null } = {}) {
    ensurePage();
    const item = trigger || document.getElementById(CONTENT_PATHS[view]?.tab);
    global.showPage?.('dd2026', item, { history: false });
    const path = CONTENT_PATHS[view]?.hash || 'mock-bar';
    const hash = detailId
      ? (view === 'exam_room' ? `${path}?exam=${encodeURIComponent(detailId)}` : `${path}/${encodeURIComponent(detailId)}`)
      : path;
    const url = `${location.pathname}${location.search}#${hash}`;
    if (`${location.pathname}${location.search}${location.hash}` !== url) {
      history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), dueDiligence2026: view }, '', url);
    }
  }

  function loading(title) {
    app().innerHTML = `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Due Diligence 2026</div><h1>${escapeHtml(title)}</h1></div><span class="dd26-beta">AI-prepared beta</span></header><div class="dd26-loading" role="status">Loading protected study material…</div></div>`;
  }

  function showError(error, retry) {
    const message = error?.message || 'This module could not be loaded.';
    app().innerHTML = `<div class="dd26-shell"><div class="dd26-error" role="alert">${escapeHtml(message)}</div><div class="dd26-actions"><button class="dd26-button" id="dd26-retry" type="button">Try again</button></div></div>`;
    document.getElementById('dd26-retry')?.addEventListener('click', retry);
  }

  async function open(view, trigger, options = {}) {
    if (!CONTENT_PATHS[view]) return false;
    if (view !== 'exam_room' && !requireAuthentication()) return false;
    state.view = view;
    state.result = null;
    activatePage(view, trigger, options);
    loading(CONTENT_PATHS[view].title);
    try {
      if (view === 'exam_room') {
        if (config?.features?.examinationRoom2 !== true) throw new Error('Examination Room 2.0 is not enabled for this environment.');
        if (options.detailId) state.exam.entryExamId = String(options.detailId).slice(0, 120);
        if (isAuthenticated()) {
          const snapshot = await features();
          if (snapshot?.flags?.[EXAMINATION_ROOM_BASE_FLAG] !== true
            || snapshot?.flags?.[FLAG_NAMES.exam_room] !== true) {
            throw new Error('This module is temporarily unavailable.');
          }
        }
        await openExamRoomView();
      } else {
        const snapshot = await features();
        const flag = FLAG_NAMES[view];
        if (flag && snapshot?.flags?.[flag] !== true) throw new Error('This module is temporarily unavailable.');
        await openContentView(view, options.detailId || null);
      }
      return true;
    } catch (error) {
      showError(error, () => open(view, trigger, { ...options, replace: true }));
      return false;
    }
  }

  async function queryContent(type) {
    if (state.items.has(type)) return state.items.get(type);
    const payload = await api('/dd2026/content/query', {
      contentType: type, limit: 200, offset: 0,
    });
    const items = Array.isArray(payload.items) ? payload.items : [];
    state.items.set(type, items);
    return items;
  }

  function setContentFilter(items) {
    state.filtered = items.filter((item) => (
      (state.subject === 'All' || item.subject === state.subject)
      && (!state.search || JSON.stringify(item).toLowerCase().includes(state.search.toLowerCase()))
    ));
    if (!state.filtered.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.filtered[0]?.id || null;
    }
  }

  async function openContentView(type, detailId) {
    const items = await queryContent(type);
    state.subject = 'All';
    state.search = '';
    state.selectedId = detailId && items.some((item) => item.id === detailId) ? detailId : items[0]?.id || null;
    setContentFilter(items);
    renderContent();
  }

  function subjectChips(items) {
    const subjects = ['All', ...new Set(items.map((item) => item.subject).filter(Boolean))];
    return `<div class="dd26-toolbar" role="group" aria-label="Filter by subject">${subjects.map((subject) => `<button class="dd26-chip${state.subject === subject ? ' is-active' : ''}" type="button" data-dd26-subject="${escapeHtml(subject)}">${escapeHtml(shortSubject(subject))}</button>`).join('')}</div>`;
  }

  function betaNotice() {
    return '<div class="dd26-notice">AI-prepared beta content. Verify every proposition independently against current law and the linked primary authority.</div>';
  }

  function renderContent() {
    const items = state.items.get(state.view) || [];
    setContentFilter(items);
    if (state.view === 'bar_easy') renderBarEasy(items);
    else if (state.view === 'doctrine') renderDoctrines(items);
    else renderCaseLibrary(items, state.view === 'chair_case');
  }

  function selectedItem() { return state.filtered.find((item) => item.id === state.selectedId) || null; }

  function renderBarEasy(items) {
    const item = selectedItem();
    const index = items.findIndex((entry) => entry.id === item?.id);
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">The Commons / Guided Practice</div><h1>Bar Easy</h1><p>Try legal reasoning in plain language. No law-school jargon is required.</p></div><span class="dd26-beta">AI-prepared beta</span></header>
      ${subjectChips(items)}
      <div class="dd26-grid">
        <section class="dd26-pane" aria-labelledby="dd26-easy-question">
          <div class="dd26-question-meta"><span>${item ? `Question ${index + 1} of ${items.length}` : 'No question'}</span><span class="dd26-status">${escapeHtml(shortSubject(item?.subject || ''))}</span></div>
          <h2 class="dd26-prompt" id="dd26-easy-question">${escapeHtml(payload.prompt || '')}</h2>
          <label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea" id="dd26-easy-answer" maxlength="5000" placeholder="Explain the rule in your own words."></textarea><small class="dd26-counter" id="dd26-easy-count">0 / 5,000</small></label>
          <div class="dd26-actions"><button class="dd26-button primary" id="dd26-easy-submit" type="button">Submit answer</button><button class="dd26-button" id="dd26-easy-next" type="button">Next question</button></div>
          <div class="dd26-privacy">Your answer text and Gemini explanation are not saved. Only the completion count is recorded.</div>${betaNotice()}
        </section>
        <aside class="dd26-pane" id="dd26-easy-result"><div class="dd26-empty">Your coaching result, suggested answer, and primary source will appear here after submission.</div></aside>
      </div>
    </div>`;
    bindContentFilters();
    const answer = document.getElementById('dd26-easy-answer');
    answer?.addEventListener('input', () => { document.getElementById('dd26-easy-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 5,000`; });
    document.getElementById('dd26-easy-submit')?.addEventListener('click', gradeBarEasy);
    document.getElementById('dd26-easy-next')?.addEventListener('click', () => selectNext(items));
  }

  async function gradeBarEasy() {
    if (state.busy) return;
    const item = selectedItem();
    const answer = document.getElementById('dd26-easy-answer');
    const button = document.getElementById('dd26-easy-submit');
    if (!item || !answer?.value.trim()) { global.toast?.('Write an answer before submitting.', 'warn'); return; }
    if (codePointLength(answer.value) > 5000) { global.toast?.('Bar Easy answers are limited to 5,000 characters. Nothing was truncated.', 'warn'); return; }
    state.busy = true; button.disabled = true; button.textContent = 'Reviewing…';
    try {
      const payload = await api('/dd2026/bar-easy/grade', { contentId: item.id, answer: answer.value, requestKey: randomKey('easy') });
      const result = payload.result || {};
      const study = payload.study || {};
      document.getElementById('dd26-easy-result').innerHTML = `<div class="dd26-result"><div class="dd26-kicker">Gemini coaching</div><h2 class="dd26-result-title">${escapeHtml(result.label)}</h2><section class="dd26-section"><h3>Coaching feedback</h3><p>${escapeHtml(result.feedback)}</p></section><section class="dd26-section"><h3>Suggested answer</h3><p>${escapeHtml(study.suggestedAnswer)}</p></section><section class="dd26-section"><h3>Why this works</h3><p>${escapeHtml(study.explanation)}</p></section><section class="dd26-section"><h3>Primary source</h3><p>${escapeHtml([study.primarySource?.title, study.primarySource?.citation].filter(Boolean).join(' · '))}</p>${safeSourceLink(study.primarySource?.url)}</section>${betaNotice()}</div>`;
      answer.value = '';
      answer.dispatchEvent(new Event('input'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally { state.busy = false; button.disabled = false; button.textContent = 'Submit answer'; }
  }

  function selectNext(items) {
    if (!items.length) return;
    const current = items.findIndex((item) => item.id === state.selectedId);
    state.selectedId = items[(current + 1) % items.length].id;
    state.result = null;
    renderContent();
  }

  function renderDoctrines(items) {
    const item = selectedItem();
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">Recall / Explain / Verify</div><h1>Doctrines</h1><p>Explain the doctrine in your own words, then compare your understanding with its canonical meaning and limits.</p></div><span class="dd26-beta">AI-prepared beta</span></header>
      ${subjectChips(items)}
      <div class="dd26-grid">
        <section class="dd26-pane"><div class="dd26-label">Selected doctrine</div><h2 class="dd26-prompt">${escapeHtml(item?.title || payload.doctrine_title || '')}</h2><p class="dd26-help">${escapeHtml(payload.syllabus_topic || '')}</p><label class="dd26-field"><span>Explain in your own words</span><textarea class="dd26-textarea" id="dd26-doctrine-answer" maxlength="3000" placeholder="State the meaning, required elements, and any important limit."></textarea><small class="dd26-counter" id="dd26-doctrine-count">0 / 3,000</small></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-doctrine-submit" type="button">Check mastery</button><button class="dd26-button" id="dd26-doctrine-next" type="button">Next doctrine</button></div><div class="dd26-privacy">Your answer text is not saved. Only your thumbs-up or thumbs-down mastery result is recorded.</div>${betaNotice()}</section>
        <aside class="dd26-pane" id="dd26-doctrine-result"><div class="dd26-empty">The canonical meaning, plain-language explanation, limits, and primary authority will appear after submission.</div></aside>
      </div>
    </div>`;
    bindContentFilters();
    const answer = document.getElementById('dd26-doctrine-answer');
    answer?.addEventListener('input', () => { document.getElementById('dd26-doctrine-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 3,000`; });
    document.getElementById('dd26-doctrine-submit')?.addEventListener('click', gradeDoctrine);
    document.getElementById('dd26-doctrine-next')?.addEventListener('click', () => selectNext(items));
  }

  async function gradeDoctrine() {
    if (state.busy) return;
    const item = selectedItem();
    const answer = document.getElementById('dd26-doctrine-answer');
    const button = document.getElementById('dd26-doctrine-submit');
    if (!item || !answer?.value.trim()) { global.toast?.('Explain the doctrine before checking mastery.', 'warn'); return; }
    if (codePointLength(answer.value) > 3000) { global.toast?.('Doctrine answers are limited to 3,000 characters. Nothing was truncated.', 'warn'); return; }
    state.busy = true; button.disabled = true; button.textContent = 'Checking…';
    try {
      const payload = await api('/dd2026/doctrines/grade', { contentId: item.id, answer: answer.value, requestKey: randomKey('doctrine') });
      const result = payload.result || {};
      const study = payload.study || {};
      const title = result.result === 'thumbs_up' ? 'Doctrine understood' : 'Review this doctrine again';
      document.getElementById('dd26-doctrine-result').innerHTML = `<div class="dd26-result"><div class="dd26-kicker">Mastery check</div><h2 class="dd26-result-title">${escapeHtml(title)}</h2><section class="dd26-section"><h3>Feedback</h3><p>${escapeHtml(result.feedback)}</p></section><section class="dd26-section"><h3>Canonical meaning</h3><p>${escapeHtml(study.canonicalMeaning)}</p></section><section class="dd26-section"><h3>In plain language</h3><p>${escapeHtml(study.plainLanguageMeaning)}</p></section><section class="dd26-section"><h3>Limits and exceptions</h3><p>${escapeHtml(study.limits)}</p></section><section class="dd26-section"><h3>Authority</h3><p>${escapeHtml([study.authority, study.citation].filter(Boolean).join(' · '))}</p>${safeSourceLink(study.sourceUrl)}</section><div class="dd26-privacy">${escapeHtml(payload.privacy)}</div>${betaNotice()}</div>`;
      answer.value = '';
      answer.dispatchEvent(new Event('input'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally { state.busy = false; button.disabled = false; button.textContent = 'Check mastery'; }
  }

  function renderCaseLibrary(items, chairs) {
    const item = selectedItem();
    const payload = item?.payload || {};
    const title = chairs ? '2026 Bar Chair’s Cases' : 'Anchor Case Digests';
    const description = chairs
      ? `${items.length} decisions penned by Justice Samuel H. Gaerlan, mapped to the 2026 Bar syllabus.`
      : 'Sixty foundational decisions—ten for each official 2026 Bar subject—organized for fast ALAC recall.';
    const detailHash = item && !chairs ? item.id : null;
    if (detailHash) activatePage('anchor_case', document.getElementById('spa-case-digest'), { replace: true, detailId: detailHash });
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">${chairs ? 'Justice Samuel H. Gaerlan / 2026' : 'Core jurisprudence / 2026'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><span class="dd26-beta">AI-prepared beta</span></header>
      <label class="dd26-field dd26-search"><span>Search cases</span><input class="dd26-input" id="dd26-case-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search case, topic, doctrine, or citation"></label>
      ${subjectChips(items)}
      <div class="dd26-grid">
        <aside class="dd26-pane"><div class="dd26-label">${String(state.filtered.length).padStart(2, '0')} case${state.filtered.length === 1 ? '' : 's'}</div><div class="dd26-list" role="list">${state.filtered.map((entry, index) => `<button class="dd26-list-button${entry.id === state.selectedId ? ' is-active' : ''}" type="button" data-dd26-case="${escapeHtml(entry.id)}"><span class="dd26-list-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escapeHtml(entry.payload?.short_title || entry.title)}</strong><small>${escapeHtml(shortSubject(entry.subject))}</small></span></button>`).join('') || '<div class="dd26-empty">No cases match this filter.</div>'}</div></aside>
        <article class="dd26-pane">${item ? caseDetail(payload, chairs) : '<div class="dd26-empty">Choose a case to read its digest.</div>'}</article>
      </div>
    </div>`;
    bindContentFilters();
    const search = document.getElementById('dd26-case-search');
    search?.addEventListener('input', () => { state.search = search.value; renderContent(); document.getElementById('dd26-case-search')?.focus(); });
    document.querySelectorAll('[data-dd26-case]').forEach((button) => button.addEventListener('click', () => {
      state.selectedId = button.dataset.dd26Case;
      renderContent();
    }));
  }

  function caseDetail(payload, chairs) {
    const source = payload.primary_source_url;
    return `<div class="dd26-kicker">${chairs ? `${escapeHtml(payload.relevance_rank || '')} of 30 cases` : `Rank ${escapeHtml(payload.rank_within_subject || '')} in subject`}</div><h2 class="dd26-case-title">${escapeHtml(payload.short_title || payload.case_title)}</h2><div class="dd26-case-cite"><span>${escapeHtml(payload.gr_number)}</span><span>${escapeHtml(payload.decision_date)}</span><span>${escapeHtml(payload.court_division)}</span><span>${escapeHtml(payload.ponente)}</span></div><section class="dd26-section"><h3>Why it matters for the Bar</h3><p>${escapeHtml(payload.why_bar_relevant)}</p></section>${factRow('Facts', payload.facts_digest)}${factRow('Issue', payload.issue)}${factRow('Ruling', payload.ruling)}${factRow('Controlling doctrine', payload.controlling_doctrine)}${factRow('Disposition', payload.disposition)}${chairs ? '' : factRow('ALAC use', payload.how_to_use_in_alac)}<div class="dd26-actions">${safeSourceLink(source, 'Open official full text')}<button class="dd26-button" type="button" onclick="window.print()">Print digest</button></div><div class="dd26-help">Source checked ${escapeHtml(payload.source_checked_on || '')}. Verify independently.</div>${betaNotice()}`;
  }

  function factRow(title, value) { return `<section class="dd26-fact-row"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(value || '—')}</p></section>`; }

  function safeSourceLink(value, label = 'Open primary source') {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return '';
      return `<a class="dd26-source" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch { return ''; }
  }

  function bindContentFilters() {
    document.querySelectorAll('[data-dd26-subject]').forEach((button) => button.addEventListener('click', () => {
      state.subject = button.dataset.dd26Subject;
      state.selectedId = null;
      renderContent();
    }));
  }

  function openVerdictExport(resultId, questionId = '') {
    if (!requireAuthentication()) return false;
    const canSelectQuestion = Boolean(String(questionId || '').trim());
    openDialog(`<div class="dd26-label">The Verdict / Private PDF</div><h2>Choose what to export</h2><p>Every included question contains the complete prompt, suggested answer, your answer, and coaching feedback.</p><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="entire_result" checked><span><strong>Entire result</strong><small>Export every available question and section.</small></span></label><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="questions" ${canSelectQuestion ? '' : 'disabled'}><span><strong>This question only</strong><small>${canSelectQuestion ? escapeHtml(questionId) : 'No individual question identifier is available for this legacy result.'}</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-verdict-export" type="button">Generate private PDF</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-confirm-verdict-export')?.addEventListener('click', async () => {
      const scope = document.querySelector('input[name="dd26-verdict-scope"]:checked')?.value || 'entire_result';
      const ok = await exportVerdict(resultId, scope, scope === 'questions' ? [questionId] : []);
      if (ok) closeDialog();
    });
    return true;
  }

  async function exportVerdict(resultId, selectionKind = 'entire_result', selectedIds = []) {
    if (!requireAuthentication()) return false;
    const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
    if (!session?.access_token) return false;
    try {
      const response = await fetch(`${config.workerUrl}/dd2026/verdict/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          'X-Request-ID': randomKey('pdf_request'),
        },
        body: JSON.stringify({ gradingResultId: resultId, selectionKind, selectedIds, requestKey: randomKey('verdict') }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'The Verdict PDF could not be generated.');
      }
      const blob = await response.blob();
      if (blob.type !== 'application/pdf' || !blob.size || blob.size > 25 * 1024 * 1024) throw new Error('The Verdict PDF response was invalid.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'duediligence-verdict.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      global.toast?.('Your private Verdict PDF is ready.', 'ok');
      return true;
    } catch (error) {
      global.toast?.(error.message, 'warn');
      return false;
    }
  }

  async function openExamRoomView() {
    const localStoreApi = global.DueDiligenceExaminationRoomStore;
    if (localStoreApi?.createStore) {
      state.exam.store ||= localStoreApi.createStore();
      state.exam.store.init().then((availability) => {
        if (availability.available) return state.exam.store.cleanupConfirmed();
        return null;
      }).catch(() => { /* local retention cleanup retries on the next Examination Room open */ });
    }
    if (isAuthenticated()) {
      const payload = await api('/exam-room/query', { operation: 'portal' });
      state.exam.portal = payload.result || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
      await enrichProfessorExamIntents(state.exam.portal);
    } else {
      state.exam.portal = null;
      state.exam.section = 'entry';
    }
    renderExamRoom();
  }

  function renderExamRoom() {
    clearAttemptTimers();
    if (state.exam.section !== 'entry' && !isAuthenticated()) {
      state.exam.portal = null;
      state.exam.section = 'entry';
    }
    const portal = state.exam.portal || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
    if (state.exam.section === 'entry') {
      app().innerHTML = examEntry();
      bindExamEntry();
      return;
    }
    app().innerHTML = `<div class="dd26-shell"><button class="dd26-back-link" id="dd26-exam-role-home" type="button">Back to Examination Room</button><header class="dd26-header"><div><div class="dd26-kicker">Law school examination</div><h1>Examination Room</h1><p>One clear place to make, prepare, take, and grade a class examination.</p></div></header><main id="dd26-exam-main" tabindex="-1">${examSection(portal)}</main><p class="dd26-sr-status" id="dd26-exam-status" role="status" aria-live="polite" aria-atomic="true"></p></div>`;
    bindExamSection();
    document.getElementById('dd26-exam-role-home')?.addEventListener('click', () => {
      state.exam.section = 'entry';
      state.exam.intentRole = null;
      renderExamRoom();
    });
  }

  function examEntry() {
    const authenticated = isAuthenticated();
    const cards = [
      ['professor', 'Professor', 'Make the examination', 'Use the room key created by Admin, then upload questions, set the rules, publish, and grade.'],
      ['beadle', 'Beadle', 'Upload students and prepare exam day', 'Use the invitation from the Professor, upload the class list, and help students during the examination.'],
      ['student', 'Student', 'Take the examination', 'Sign in, enter the class exam code if required, answer, review, and submit.'],
      ['admin', 'Admin', 'Manage Examination Rooms', 'Create Professor room keys, see who used each key, and check exam status.'],
    ];
    return `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Due Diligence / Law school examinations</div><h1>Examination Room</h1><p>Choose your role. Each choice opens one simple class flow.</p></div><span class="dd26-beta">2.0 beta</span></header><main aria-labelledby="dd26-entry-title"><h2 class="dd26-visually-hidden" id="dd26-entry-title">Choose an Examination Room role</h2><div class="dd26-role-grid">${cards.map(([id, title, subtitle, description], index) => `<button class="dd26-role-card" type="button" data-dd26-exam-role="${id}"><span class="dd26-role-number" aria-hidden="true">0${index + 1}</span><span><strong>${title}</strong><em>${subtitle}</em><small>${description}</small></span><span class="dd26-role-arrow" aria-hidden="true">→</span></button>`).join('')}</div><div class="dd26-notice"><strong>${authenticated ? 'You are signed in.' : 'Student sign-in is required.'}</strong> ${authenticated ? 'Choose a role to continue. Your school and exam access will still be checked.' : 'A student cannot open the Student examination page until signed in. Professors, Beadles, and Admins also use their own authorized accounts.'}</div>${state.exam.entryExamId ? `<div class="dd26-deep-link"><span>Examination link detected</span><code>${escapeHtml(state.exam.entryExamId)}</code><p>The link identifies the examination only. It does not give anyone access.</p></div>` : ''}<p class="dd26-privacy">During a monitored examination, copy, cut, and paste are blocked. Leaving the exam tab is recorded and shown to the Professor and Beadle. It is reviewed by a person and is not an automatic failure. Camera collection is off.</p></main><p class="dd26-sr-status" id="dd26-exam-status" role="status" aria-live="polite" aria-atomic="true"></p></div>`;
  }

  function bindExamEntry() {
    document.querySelectorAll('[data-dd26-exam-role]').forEach((button) => button.addEventListener('click', () => selectExamRole(button.dataset.dd26ExamRole)));
  }

  async function selectExamRole(role) {
    if (!['professor', 'beadle', 'student', 'admin'].includes(role)) return;
    state.exam.intentRole = role;
    if (!isAuthenticated()) {
      const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
      phase4?.requireAuthentication?.();
      phase4?.openSignIn?.();
      announceExamStatus(`Sign in to continue as ${role}.`);
      global.toast?.(`Sign in to continue as ${role}.`, 'warn');
      return;
    }
    if (role === 'admin') {
      global.location.assign(new URL('admin/', global.location.href).href);
      return;
    }
    if (!state.exam.portal) {
      const payload = await api('/exam-room/query', { operation: 'portal' });
      state.exam.portal = payload.result || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
      await enrichProfessorExamIntents(state.exam.portal);
    }
    if (state.exam.section !== role) state.exam.rosterPreview = null;
    state.exam.rosterMode = role === 'beadle' ? 'beadle' : 'professor';
    state.exam.section = role;
    renderExamRoom();
    document.getElementById('dd26-exam-main')?.focus();
  }

  function announceExamStatus(message) {
    const status = document.getElementById('dd26-exam-status');
    if (status) status.textContent = String(message || '');
  }

  function examSection(portal) {
    if (state.exam.section === 'student') return studentSection(portal);
    if (state.exam.section === 'professor') return portal.roles?.professor ? professorSection(portal) : activationSection(portal);
    if (state.exam.section === 'beadle') return beadleSection(portal);
    return '<section class="dd26-card"><div class="dd26-empty">Choose Professor, Beadle, Student, or Admin.</div></section>';
  }

  function studentSection(portal) {
    const exams = portal.studentExams || [];
    return `<section class="dd26-card"><div class="dd26-label">Student examination</div><h2>Check your exam details</h2><p>Students sign in with their Due Diligence account—there is no separate Student invitation key. The signed-in email must be on the class list. The Professor may also require the class exam access code created when the exam is published.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Exam code</span><input class="dd26-input" id="dd26-student-exam" autocomplete="off" value="${escapeHtml(state.exam.entryExamId)}"><small class="dd26-help">The Professor or Beadle gives the class this exam code.</small></label><label class="dd26-field"><span>Class exam access code (if required)</span><input class="dd26-input" id="dd26-student-key" type="password" autocomplete="one-time-code"><small class="dd26-help">The Professor creates this when publishing. Leave it blank only when the Professor says no separate code is required.</small></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-start-attempt" type="button">Check exam details</button></div><div class="dd26-privacy">Be online to sign in and start. If the connection drops after the exam opens, answers can remain saved on this device until it reconnects. Do not clear browser data.</div></section><section class="dd26-card"><div class="dd26-label">Your examinations</div><h2>Available and completed exams</h2>${exams.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Examination</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody>${exams.map((exam) => { const attemptStatus = exam.attemptStatus || exam.status; return `<tr><td><strong>${escapeHtml(exam.title)}</strong><br><small>${escapeHtml(exam.examId)}</small></td><td>${escapeHtml(formatDate(exam.opensAt))}<br>to ${escapeHtml(formatDate(exam.hardClosesAt))}</td><td><span class="dd26-status">${escapeHtml(attemptStatus)}</span></td><td>${exam.resultReleased ? `<button class="dd26-button" data-dd26-student-result="${escapeHtml(exam.examId)}" type="button">View result</button>` : exam.attemptId && isClosedAttemptStatus(attemptStatus) ? `<button class="dd26-button" data-dd26-submission-status="${escapeHtml(exam.attemptId)}" type="button">View receipt</button>` : exam.attemptId ? `<button class="dd26-button" data-dd26-resume-attempt="${escapeHtml(exam.attemptId)}" type="button">Resume</button>` : `<button class="dd26-button" data-dd26-use-exam="${escapeHtml(exam.examId)}" type="button">Use this exam</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="dd26-empty">No active examination is available for this signed-in account.</div>'}</section>`;
  }

  function activationSection(portal) {
    const adminLink = portal.roles?.admin === true
      ? '<a class="dd26-button" href="admin/">Open Admin Dashboard</a>'
      : '';
    return `<section class="dd26-card"><div class="dd26-label">Professor access</div><h2>Open your Examination Room</h2><p>A Due Diligence Admin creates one invitation key for one Examination Room. The key works only with the Professor’s exact signed-in email, expires, and can be used once.</p><label class="dd26-field"><span>Professor invitation key</span><input class="dd26-input" id="dd26-activation-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-redeem-activation" type="button">Open Examination Room</button>${adminLink}</div><div class="dd26-notice"><strong>Who gives me this key?</strong> Ask a Due Diligence Admin. Admins create and monitor Professor keys under Admin Dashboard → Examination Room.</div></section>`;
  }

  function beadleSection(portal) {
    const exams = portal.beadleExams || portal.beadleAssignments || [];
    return `<section class="dd26-card"><div class="dd26-label">Beadle access for this exam</div><h2>Open your Beadle invitation</h2><p>The Professor creates this invitation from the exam card after making the exam draft. The Professor gives it to the Beadle for that examination. It expires and can be cancelled. It never opens student answers or grades.</p><label class="dd26-field"><span>Beadle invitation key</span><input class="dd26-input" id="dd26-beadle-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-redeem-beadle" type="button">Open invitation</button></div></section><section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Your assigned exams</div><h2>Upload students and prepare exam day</h2></div><span class="dd26-status">${exams.length} assigned</span></div>${exams.length ? `<div class="dd26-attention-list">${exams.map((exam) => `<article><div><strong>${escapeHtml(exam.title || 'Examination')}</strong><small>${escapeHtml(exam.status || 'assigned')} · available until ${escapeHtml(formatDate(exam.expiresAt))}</small></div><div class="dd26-actions"><button class="dd26-button" data-dd26-beadle-exam="${escapeHtml(exam.examId)}" type="button">Open class list</button></div></article>`).join('')}</div>` : '<div class="dd26-empty">No examination has been assigned to this Beadle account.</div>'}<div class="dd26-privacy">A Beadle may upload and check the class list, confirm student entry, record temporary leave, and help with exam-day concerns. Questions, answers, grades, and release remain with the Professor.</div></section>`;
  }

  function professorSection(portal) {
    const classes = portal.classes || [];
    const activeClass = classes.find((entry) => entry.classroomId === state.exam.activeClassroomId) || classes[0] || null;
    if (activeClass) state.exam.activeClassroomId = activeClass.classroomId;
    return `<section class="dd26-card"><div class="dd26-label">Professor workspace</div><h2>Your Examination Rooms</h2><p>Each Admin invitation key opens one Examination Room. To prepare another class examination, ask the Admin for another key made for your exact signed-in email.</p><label class="dd26-field"><span>Open another Examination Room</span><input class="dd26-input" id="dd26-activation-key" type="password" autocomplete="one-time-code"><small class="dd26-help">Paste the new Professor invitation key. It can be used once.</small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-redeem-activation" type="button">Open another room</button></div></section>${classes.length ? `<section class="dd26-card"><div class="dd26-toolbar">${classes.map((entry) => `<button class="dd26-chip${entry.classroomId === activeClass?.classroomId ? ' is-active' : ''}" type="button" data-dd26-class="${escapeHtml(entry.classroomId)}" ${entry.classroomId === activeClass?.classroomId ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${escapeHtml(entry.title)}</button>`).join('')}</div>${activeClass ? professorClass(activeClass) : ''}</section>` : '<section class="dd26-card"><div class="dd26-empty">No Examination Room is assigned yet. Ask the Admin for a Professor invitation key, then paste it above.</div></section>'}`;
  }

  function professorClass(classroom) {
    const exams = classroom.exams || [];
    const authoring = exams.length ? '<section class="dd26-section"><div class="dd26-notice"><strong>This room already has its examination.</strong> One Examination Room holds one examination. Use the exam card below to finish questions, rules, publishing, monitoring, and grading.</div></section>'
      : `<section class="dd26-section"><div class="dd26-stepper" aria-label="Professor exam steps"><span class="is-active">1 Make exam</span><span>2 Check questions</span><span>3 Set exam rules</span><span>4 Publish</span></div><h3>Make an examination</h3><div class="dd26-form-grid"><label class="dd26-field"><span>Exam title</span><input class="dd26-input" id="dd26-exam-title" maxlength="200"></label><label class="dd26-field"><span>Number of questions</span><input class="dd26-input" id="dd26-exam-count" type="number" min="1" max="200" step="1"><small class="dd26-help">Choose 1–200 questions for this beta. The Professor decides the number.</small></label><label class="dd26-field wide"><span>Instructions for students</span><textarea class="dd26-textarea" id="dd26-exam-instructions" maxlength="10000"></textarea></label><label class="dd26-field"><span>If a student leaves the exam tab</span><select class="dd26-select" id="dd26-exam-integrity"><option value="standard" selected>Record for Professor review</option><option value="strict">Warn the student and record</option></select><small class="dd26-help">Copy, cut, and paste are blocked during the monitored exam. Leaving the tab never causes an automatic failure.</small></label><label class="dd26-field"><span>What students receive with grades</span><select class="dd26-select" id="dd26-exam-questionnaire"><option value="false">Grades and comments only</option><option value="true">Include the questionnaire</option></select></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-create-exam" type="button">Create exam draft</button></div></section>`;
    return `<div class="dd26-question-meta"><span>${escapeHtml(classroom.title)}</span><span class="dd26-status">${classroom.rosterCount || 0} students on the class list</span></div><div class="dd26-notice"><strong>The Beadle uploads the students.</strong> After you create the exam, invite the Beadle from the exam card to upload and check the class list.</div>${authoring}<section class="dd26-section"><h3>Your examination</h3>${examCards(exams)}</section>`;
  }

  function rosterPreviewHtml() {
    const preview = state.exam.rosterPreview;
    if (!preview) return '';
    const errors = preview.validation?.errors || [];
    const rows = Array.isArray(preview.rows) ? preview.rows : [];
    return `<div class="${preview.validation?.ok ? 'dd26-success' : 'dd26-error'}" role="status">${preview.validation?.ok ? `${rows.length} students are ready to add to the class list.` : `${errors.length || 1} item(s) must be corrected.`}${errors.length ? `<ul>${errors.map((error) => `<li>${escapeHtml(error.row ? `Row ${error.row}: ` : '')}${escapeHtml(error.code || error.message || error)}</li>`).join('')}</ul>` : ''}</div><div class="dd26-table-wrap"><table class="dd26-table dd26-editable-roster"><thead><tr><th>Primary email</th><th>Student ID</th><th>Exam number</th><th>Name (optional)</th><th></th></tr></thead><tbody>${rows.map((row, index) => `<tr data-dd26-roster-row="${index}"><td><input class="dd26-input" data-dd26-roster-field="email" type="email" value="${escapeHtml(row.email)}" aria-label="Row ${index + 1} email"></td><td><input class="dd26-input" data-dd26-roster-field="studentNumber" value="${escapeHtml(row.studentNumber)}" aria-label="Row ${index + 1} student ID"></td><td><input class="dd26-input" data-dd26-roster-field="candidateNumber" value="${escapeHtml(row.candidateNumber)}" aria-label="Row ${index + 1} exam number"></td><td><input class="dd26-input" data-dd26-roster-field="displayName" value="${escapeHtml(row.displayName || '')}" aria-label="Row ${index + 1} name"></td><td><button class="dd26-button danger" data-dd26-remove-roster-row="${index}" type="button" aria-label="Remove class-list row ${index + 1}">Remove</button></td></tr>`).join('')}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-add-roster-row" type="button">Add student</button><button class="dd26-button" id="dd26-revalidate-roster" type="button">Check corrections</button></div>`;
  }

  function examCards(exams) {
    if (!exams.length) return '<div class="dd26-empty">No examination has been created for this class.</div>';
    return exams.map((exam) => {
      const publicationStateKnown = exam.publicationStateKnown === true;
      const published = publicationStateKnown
        && Boolean(exam.currentPublicationId || exam.publicationId || exam.publishedVersion);
      const versionLabel = exam.sealedAt
        ? 'Sealed'
        : (exam.publicationNumber || exam.publishedVersion)
          ? `v${escapeHtml(exam.publicationNumber || exam.publishedVersion)}`
          : published ? 'Published' : 'Draft';
      const questionAction = !publicationStateKnown
        ? '<button class="dd26-button" type="button" disabled>Exam status unavailable</button>'
        : published
        ? '<button class="dd26-button" type="button" disabled title="Published questions cannot be edited. Before any student starts, use the replacement process to publish corrected questions.">Published questions locked</button>'
        : `<button class="dd26-button" data-dd26-upload-exam="${escapeHtml(exam.examId)}" data-dd26-question-count="${escapeHtml(exam.questionCount)}" type="button">Upload & review</button>`;
      const initialPublishAction = !publicationStateKnown || published
        ? ''
        : `<button class="dd26-button primary" data-dd26-schedule-exam="${escapeHtml(exam.examId)}" type="button">Rules & publish</button>`;
      const replacementAction = published && !exam.sealedAt
        ? exam.canReplacePublication === true && exam.canUploadReplacementQuestions === true
          ? `<button class="dd26-button danger" data-dd26-replace-publication="${escapeHtml(exam.examId)}" type="button">Replace before any start</button>`
          : `<button class="dd26-button" type="button" disabled title="${escapeHtml(exam.replaceBlockedReason || 'Corrected questions cannot be published now. After a student starts, issue a visible correction notice instead.')} ">Use a correction notice</button>`
        : '';
      return `<article class="dd26-card"><div class="dd26-question-meta"><span>${escapeHtml(exam.title)}</span><span class="dd26-status">${escapeHtml(exam.status)}</span></div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${exam.questionCount || 0}</strong><span>Questions</span></div><div class="dd26-stat"><strong>${escapeHtml(exam.totalPoints || '—')}</strong><span>Total points</span></div><div class="dd26-stat"><strong>${exam.opensAt ? 'Set' : 'Draft'}</strong><span>Schedule</span></div><div class="dd26-stat"><strong>${versionLabel}</strong><span>Published version</span></div></div><div class="dd26-help">Opens ${escapeHtml(formatDate(exam.opensAt))} · Ends ${escapeHtml(formatDate(exam.hardClosesAt))}</div><div class="dd26-stepper compact"><span class="${exam.questionCount ? 'is-done' : 'is-active'}">1 Make exam</span><span class="${exam.status === 'confirmed' ? 'is-active' : exam.opensAt ? 'is-done' : ''}">2 Check questions</span><span class="${exam.status === 'confirmed' ? 'is-active' : exam.opensAt ? 'is-done' : ''}">3 Set exam rules</span><span class="${exam.opensAt ? 'is-done' : ''}">4 Publish</span></div><div class="dd26-actions">${questionAction}${initialPublishAction}${replacementAction}<button class="dd26-button" data-dd26-invite-beadle="${escapeHtml(exam.examId)}" type="button">Invite Beadle</button><button class="dd26-button" data-dd26-grade-exam="${escapeHtml(exam.examId)}" type="button">Grade</button></div></article>`;
    }).join('');
  }

  function bindExamNavigation() {
    document.querySelectorAll('[data-dd26-exam-section]').forEach((button) => button.addEventListener('click', () => {
      selectExamRole(button.dataset.dd26ExamSection);
    }));
  }

  function bindExamSection() {
    const openBookOption = document.querySelector('#dd26-exam-integrity option[value="custom"]');
    if (openBookOption) {
      openBookOption.value = 'open_book';
      openBookOption.textContent = 'Open book';
    }
    document.querySelectorAll('[data-dd26-grade-exam]').forEach((button) => {
      if (!button.parentElement?.querySelector('[data-dd26-monitor-exam]')) {
        button.insertAdjacentHTML(
          'beforebegin',
          `<button class="dd26-button" data-dd26-monitor-exam="${escapeHtml(button.dataset.dd26GradeExam)}" type="button">Monitor</button>`,
        );
      }
    });
    document.querySelectorAll('[data-dd26-invite-beadle]').forEach((button) => {
      const examId = escapeHtml(button.dataset.dd26InviteBeadle);
      if (!button.parentElement?.querySelector('[data-dd26-accommodation-exam]')) {
        button.insertAdjacentHTML('afterend', `<button class="dd26-button" data-dd26-manage-beadles="${examId}" type="button">Manage Beadles</button><button class="dd26-button" data-dd26-accommodation-exam="${examId}" type="button">Accommodations</button><button class="dd26-button" data-dd26-erratum-exam="${examId}" type="button">Issue erratum</button>`);
      }
    });
    document.querySelectorAll('[data-dd26-class]').forEach((button) => button.addEventListener('click', () => {
      state.exam.activeClassroomId = button.dataset.dd26Class;
      state.exam.rosterPreview = null;
      renderExamRoom();
    }));
    document.getElementById('dd26-redeem-activation')?.addEventListener('click', redeemActivation);
    document.getElementById('dd26-redeem-beadle')?.addEventListener('click', redeemBeadleInvitation);
    bindRosterControls();
    document.getElementById('dd26-create-exam')?.addEventListener('click', createExam);
    document.getElementById('dd26-start-attempt')?.addEventListener('click', startAttempt);
    document.querySelectorAll('[data-dd26-resume-attempt]').forEach((button) => button.addEventListener('click', () => loadAttempt(button.dataset.dd26ResumeAttempt)));
    document.querySelectorAll('[data-dd26-submission-status]').forEach((button) => button.addEventListener('click', () => loadSubmissionStatus(button.dataset.dd26SubmissionStatus)));
    document.querySelectorAll('[data-dd26-student-result]').forEach((button) => button.addEventListener('click', () => loadStudentResult(button.dataset.dd26StudentResult)));
    document.querySelectorAll('[data-dd26-use-exam]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById('dd26-student-exam');
      if (input) { input.value = button.dataset.dd26UseExam; input.focus(); }
    }));
    document.querySelectorAll('[data-dd26-upload-exam]').forEach((button) => button.addEventListener('click', () => openQuestionUpload(button.dataset.dd26UploadExam, Number(button.dataset.dd26QuestionCount))));
    document.querySelectorAll('[data-dd26-schedule-exam]').forEach((button) => button.addEventListener('click', () => openSchedule(button.dataset.dd26ScheduleExam)));
    document.querySelectorAll('[data-dd26-replace-publication]').forEach((button) => button.addEventListener('click', () => beginReplacementPublication(button.dataset.dd26ReplacePublication)));
    document.querySelectorAll('[data-dd26-invite-beadle]').forEach((button) => button.addEventListener('click', () => openBeadleInvitation(button.dataset.dd26InviteBeadle)));
    document.querySelectorAll('[data-dd26-manage-beadles]').forEach((button) => button.addEventListener('click', () => openBeadleManagement(button.dataset.dd26ManageBeadles)));
    document.querySelectorAll('[data-dd26-accommodation-exam]').forEach((button) => button.addEventListener('click', () => openAccommodation(button.dataset.dd26AccommodationExam)));
    document.querySelectorAll('[data-dd26-erratum-exam]').forEach((button) => button.addEventListener('click', () => openErratum(button.dataset.dd26ErratumExam)));
    document.querySelectorAll('[data-dd26-beadle-exam]').forEach((button) => button.addEventListener('click', () => openBeadleOperations(button.dataset.dd26BeadleExam)));
    document.querySelectorAll('[data-dd26-monitor-exam]').forEach((button) => button.addEventListener('click', () => openLiveStatus(button.dataset.dd26MonitorExam)));
    document.querySelectorAll('[data-dd26-grade-exam]').forEach((button) => button.addEventListener('click', () => openGrading(button.dataset.dd26GradeExam)));
  }

  function bindRosterControls() {
    document.getElementById('dd26-validate-roster')?.addEventListener('click', validateRoster);
    document.getElementById('dd26-validate-roster-paste')?.addEventListener('click', validatePastedRoster);
    document.getElementById('dd26-revalidate-roster')?.addEventListener('click', revalidateRosterPreview);
    document.getElementById('dd26-add-roster-row')?.addEventListener('click', addRosterPreviewRow);
    document.getElementById('dd26-download-roster-template')?.addEventListener('click', downloadRosterTemplate);
    document.querySelectorAll('[data-dd26-remove-roster-row]').forEach((button) => button.addEventListener('click', () => removeRosterPreviewRow(Number(button.dataset.dd26RemoveRosterRow))));
    document.getElementById('dd26-import-roster')?.addEventListener('click', importRoster);
  }

  async function refreshExamPortal(section = state.exam.section) {
    if (!isAuthenticated()) {
      state.exam.portal = null;
      state.exam.intentRole = section;
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    const payload = await api('/exam-room/query', { operation: 'portal' });
    state.exam.portal = payload.result;
    await enrichProfessorExamIntents(state.exam.portal);
    state.exam.section = section;
    renderExamRoom();
  }

  async function enrichProfessorExamIntents(portal) {
    if (portal?.roles?.professor !== true) return portal;
    const exams = (portal.classes || []).flatMap((classroom) => classroom.exams || []);
    await Promise.all(exams.map(async (exam) => {
      try {
        const payload = await api('/exam-room/query', { operation: 'exam_intent', examId: exam.examId });
        const intent = payload.result || {};
        exam.currentPublicationId = intent.currentPublicationId || null;
        exam.publicationNumber = intent.publicationNumber || null;
        exam.canReplacePublication = intent.canReplacePublication === true;
        exam.canUploadReplacementQuestions = intent.canUploadReplacementQuestions === true;
        exam.replaceBlockedReason = intent.replaceBlockedReason || null;
        exam.publicationStateKnown = true;
      } catch {
        exam.publicationStateKnown = false;
      }
    }));
    return portal;
  }

  async function command(body) {
    const payload = await api('/exam-room/command', body);
    if (payload.result?.ok === false) {
      const error = new Error(examCodeMessage(payload.result.code));
      Object.assign(error, payload.result);
      error.code = payload.result.code;
      throw error;
    }
    return payload.result;
  }

  function examCodeMessage(code) {
    const messages = {
      ROSTER_REQUIRED: 'This signed-in account is not on the class list for this examination.',
      ROSTER_ACCOUNT_MISMATCH: 'This student entry is already linked to another account.',
      EXAM_NOT_OPEN: 'This examination has not opened yet.',
      EXAM_CLOSED: 'This examination is closed.',
      CREDENTIAL_INVALID: 'The examination key is invalid.',
      CREDENTIAL_LOCKED: 'Too many failed key attempts. Access is locked for 15 minutes.',
      ACTIVATION_INVALID: 'This Professor invitation key is not valid for the signed-in email.',
      ACTIVATION_EXPIRED: 'This Professor invitation key has expired. Ask the Admin for a new one.',
      ACTIVATION_REVOKED: 'This Professor invitation key was cancelled. Ask the Admin for a new one.',
      ACTIVATION_ALREADY_REDEEMED: 'This Professor invitation key has already been used.',
      ACTIVATION_ROOM_SCOPE_REQUIRED: 'This older Professor key does not create an Examination Room. Ask the Admin for a new one-room key.',
      ACTIVATION_UNAVAILABLE: 'This Professor invitation cannot be opened. Ask the Admin to check its key record.',
      EXAM_ROOM_ONE_EXAM_LIMIT: 'This Examination Room already has its examination.',
      ATTEMPT_LOCKED: 'This attempt is locked. Your saved answers remain preserved.',
      SESSION_ACTIVE_ELSEWHERE: 'Another device has the active examination session. Ask the Beadle to approve a controlled transfer.',
      ANSWER_SET_MISMATCH: 'The server answer snapshot changed while submission was pending. Due Diligence will verify the latest synchronized answers before retrying.',
      GRADING_NOT_OPEN: 'Grading opens only after the examination has ended for every student.',
    };
    return messages[code] || String(code || 'The examination request was denied.').replace(/_/g, ' ').toLowerCase();
  }

  async function redeemActivation() {
    try {
      const result = await command({ operation: 'redeem_activation', activationKey: value('dd26-activation-key', false) });
      global.toast?.(result?.roomTitle ? `${result.roomTitle} is ready.` : 'Examination Room opened.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function filePayload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { fileName: file.name, mimeType: file.type || mimeForName(file.name), base64: btoa(binary) };
  }

  function mimeForName(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'text/plain';
  }

  async function validateRoster() {
    const file = document.getElementById('dd26-roster-file')?.files?.[0];
    if (!file) { global.toast?.('Choose a CSV or XLSX roster first.', 'warn'); return; }
    try {
      const scope = state.exam.rosterMode === 'beadle'
        ? { examId: state.exam.activeExamId }
        : { classroomId: state.exam.activeClassroomId };
      const payload = await api('/exam-room/upload/roster', { ...scope, ...await filePayload(file) });
      state.exam.rosterPreview = payload;
      rerenderRosterSurface();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function redeemBeadleInvitation() {
    try {
      await command({ operation: 'redeem_beadle_invitation', invitationKey: value('dd26-beadle-key', false), requestKey: randomKey('beadle_redeem') });
      global.toast?.('Beadle assignment opened for this account.', 'ok');
      await refreshExamPortal('beadle');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openBeadleInvitation(examId) {
    state.exam.activeExamId = examId;
    const defaultExpiry = localDateValue(new Date(Date.now() + 7 * 86400000));
    openDialog(`<div class="dd26-label">Beadle access for this exam</div><h2>Invite a Beadle</h2><p>This invitation works only for the named Beadle account and this examination. It can be used once, expires, and may be cancelled. The Beadle can upload the class list and help during the exam.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Beadle account email</span><input class="dd26-input" id="dd26-beadle-email" type="email" autocomplete="email"></label><label class="dd26-field"><span>Invitation expires</span><input class="dd26-input" id="dd26-beadle-expiry" type="datetime-local" value="${defaultExpiry}"></label></div><label class="dd26-field"><span>Reason</span><input class="dd26-input" id="dd26-beadle-reason" value="Prepare the class list and assist on exam day"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-issue-beadle" type="button">Create invitation</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div><div class="dd26-privacy">The Beadle cannot edit questions or rules, see student answers or grades, grade the exam, or release results.</div>`);
    document.getElementById('dd26-issue-beadle')?.addEventListener('click', issueBeadleInvitation);
  }

  async function issueBeadleInvitation() {
    const secret = randomKey('beadle_invitation');
    try {
      const result = await command({
        operation: 'invite_beadle', examId: state.exam.activeExamId,
        targetEmail: value('dd26-beadle-email'), invitationKey: secret,
        expiresAt: new Date(value('dd26-beadle-expiry')).toISOString(),
        reason: value('dd26-beadle-reason'), requestKey: randomKey('beadle_invite'),
      });
      showOneTimeSecret('Beadle invitation key', secret, `Share this key securely with the named Beadle. It expires ${formatDate(result?.expiresAt)} and can be redeemed once by that account.`);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openBeadleManagement(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'exam_intent', examId });
      const snapshot = payload.result || {};
      const beadles = Array.isArray(snapshot.beadles) ? snapshot.beadles : [];
      const invitations = Array.isArray(snapshot.pendingBeadleInvitations) ? snapshot.pendingBeadleInvitations : [];
      openDialog(`<div class="dd26-label">Exam-scoped delegation</div><h2>Manage Beadles</h2><p>Assignments remain narrow, expiring, revocable, and answer-blind.</p>${beadles.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Beadle account</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${beadles.map((entry) => `<tr><td><code>${escapeHtml(entry.beadleUserId)}</code></td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(formatDate(entry.expiresAt))}</td><td>${entry.status === 'active' ? `<button class="dd26-button danger" data-dd26-revoke-beadle="${escapeHtml(entry.beadleUserId)}" type="button">Revoke</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dd26-empty">No redeemed Beadle assignment.</div>'}${invitations.length ? `<details class="dd26-section"><summary>Pending invitations (${invitations.length})</summary><ul>${invitations.map((entry) => `<li>${escapeHtml(entry.targetEmail)} — expires ${escapeHtml(formatDate(entry.expiresAt))}</li>`).join('')}</ul></details>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-invite-replacement" type="button">Invite another or replacement Beadle</button><button class="dd26-button" data-dd26-close-dialog type="button">Close</button></div>`);
      document.getElementById('dd26-invite-replacement')?.addEventListener('click', () => openBeadleInvitation(examId));
      document.querySelectorAll('[data-dd26-revoke-beadle]').forEach((button) => button.addEventListener('click', () => revokeBeadle(examId, button.dataset.dd26RevokeBeadle)));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function revokeBeadle(examId, beadleUserId) {
    const reason = String(global.prompt('Required revocation reason:', 'Delegation replaced or no longer required') || '').trim();
    if (reason.length < 5) return;
    try {
      await command({ operation: 'revoke_beadle', examId, beadleUserId, reason, requestKey: randomKey('beadle_revoke') });
      global.toast?.('Beadle assignment revoked.', 'ok');
      await openBeadleManagement(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openAccommodation(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Accommodation for one student</div><h2>Set an examination accommodation</h2><p>Enter only what the student needs for this examination—not a diagnosis. Due Diligence records every change.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Student exam number</span><input class="dd26-input" id="dd26-accommodation-candidate" maxlength="120"></label><label class="dd26-field"><span>Additional minutes</span><input class="dd26-input" id="dd26-accommodation-extra" type="number" min="0" max="480" value="0"></label><label class="dd26-field"><span>This student may start at (optional)</span><input class="dd26-input" id="dd26-accommodation-opens" type="datetime-local"></label><label class="dd26-field"><span>This student’s exam ends at (optional)</span><input class="dd26-input" id="dd26-accommodation-closes" type="datetime-local"></label><label class="dd26-field"><span>Approved break minutes</span><input class="dd26-input" id="dd26-accommodation-break" type="number" min="0" max="240" value="0"></label><label class="dd26-field"><span>Extra minutes after an approved technical problem</span><input class="dd26-input" id="dd26-accommodation-incident" type="number" min="0" max="480" value="0"></label><label class="dd26-field wide"><span>Approved writing aids</span><input class="dd26-input" id="dd26-accommodation-aids" maxlength="1000"></label><label class="dd26-field wide"><span>Note for the Beadle and Professor</span><textarea class="dd26-textarea compact" id="dd26-accommodation-note" maxlength="1000"></textarea></label><label class="dd26-field wide"><span>Reason for this change</span><input class="dd26-input" id="dd26-accommodation-reason" maxlength="1000" value="Approved examination accommodation"></label></div><div class="dd26-choice-grid"><label class="dd26-choice"><input id="dd26-accommodation-fullscreen" type="checkbox"><span>Do not require full screen</span></label><label class="dd26-choice"><input id="dd26-accommodation-integrity" type="checkbox"><span>Do not record tab or window changes</span></label><label class="dd26-choice"><input id="dd26-accommodation-at" type="checkbox"><span>Allow assistive technology and clipboard use</span></label><label class="dd26-choice"><input id="dd26-accommodation-camera" type="checkbox"><span>Camera exception (camera is off in beta)</span></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-save-accommodation" type="button">Save accommodation</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-save-accommodation')?.addEventListener('click', saveAccommodation);
  }

  async function saveAccommodation() {
    const opens = value('dd26-accommodation-opens');
    const closes = value('dd26-accommodation-closes');
    try {
      await command({
        operation: 'set_accommodation',
        examId: state.exam.activeExamId,
        candidateNumber: value('dd26-accommodation-candidate'),
        accommodation: {
          extraMinutes: Number(value('dd26-accommodation-extra')) || 0,
          individualOpensAt: opens ? new Date(opens).toISOString() : null,
          individualHardClosesAt: closes ? new Date(closes).toISOString() : null,
          breakMinutes: Number(value('dd26-accommodation-break')) || 0,
          cameraExempt: Boolean(document.getElementById('dd26-accommodation-camera')?.checked),
          fullscreenExempt: Boolean(document.getElementById('dd26-accommodation-fullscreen')?.checked),
          integrityExempt: Boolean(document.getElementById('dd26-accommodation-integrity')?.checked),
          assistiveTechnology: Boolean(document.getElementById('dd26-accommodation-at')?.checked),
          permittedAids: value('dd26-accommodation-aids', false),
          incidentExtensionMinutes: Number(value('dd26-accommodation-incident')) || 0,
          operationalNote: value('dd26-accommodation-note', false),
        },
        reason: value('dd26-accommodation-reason'),
        requestKey: randomKey('accommodation'),
      });
      closeDialog();
      global.toast?.('Accommodation saved; the server recalculated any applicable deadline.', 'ok');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openErratum(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Published examination correction</div><h2>Issue an audited erratum</h2><p>After a candidate starts, do not silently mutate instructions, questions, order, or points. This notice is delivered with the immutable attempt bundle.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Notice type</span><select class="dd26-select" id="dd26-erratum-type"><option value="clarification">Clarification</option><option value="correction">Correction</option><option value="stop_notice">Stop notice</option><option value="replacement_notice">Replacement notice</option></select></label><label class="dd26-field"><span>Effective at</span><input class="dd26-input" id="dd26-erratum-effective" type="datetime-local" value="${localDateValue(new Date())}"></label><label class="dd26-field wide"><span>Affected question UUIDs (comma-separated; blank for exam-wide)</span><input class="dd26-input" id="dd26-erratum-questions" autocomplete="off"></label><label class="dd26-field wide"><span>Notice</span><textarea class="dd26-textarea" id="dd26-erratum-body" maxlength="5000"></textarea></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-issue-erratum" type="button">Issue notice</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-issue-erratum')?.addEventListener('click', issueErratum);
  }

  async function issueErratum() {
    const affectedQuestionIds = value('dd26-erratum-questions', false).split(',').map((entry) => entry.trim()).filter(Boolean);
    try {
      await command({
        operation: 'issue_erratum', examId: state.exam.activeExamId,
        erratumType: value('dd26-erratum-type'), body: value('dd26-erratum-body', false),
        affectedQuestionIds, effectiveAt: new Date(value('dd26-erratum-effective')).toISOString(),
        requestKey: randomKey('erratum'),
      });
      closeDialog();
      global.toast?.('Audited erratum issued to affected candidates.', 'ok');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openBeadleOperations(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'beadle_portal', examId });
      state.exam.activeExamId = examId;
      state.exam.rosterMode = 'beadle';
      renderBeadleOperations(payload.result || { examId, candidates: [], attention: [] });
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderBeadleOperations(snapshot) {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    state.exam.activeBeadleSnapshot = snapshot;
    const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    const attention = Array.isArray(snapshot.attention) ? snapshot.attention : [];
    const counts = snapshot.counts || {};
    const accountLinked = candidates.filter((candidate) => candidate.accountLinked).length;
    const examLink = `${location.origin}${location.pathname}#examination-room?exam=${encodeURIComponent(snapshot.examId)}`;
    const candidateAccessCopy = snapshot.accessCodeRequired === true
      ? 'The Professor also requires a separate exam access code. Give it only through the approved class channel. Every student must still sign in and be on the class list.'
      : snapshot.accessCodeRequired === false
        ? 'No separate student access code is required. Every student must still sign in and be on the class list.'
        : 'The exam access-code rule is not available. Refresh this page or ask the Professor before giving instructions to students.';
    host.innerHTML = `<section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Beadle / Needs attention</div><h2>${escapeHtml(snapshot.title || 'Exam-day class')}</h2></div><span class="dd26-status">${escapeHtml(snapshot.status || 'assigned')}</span></div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(counts.roster || candidates.length)}</strong><span>Students listed</span></div><div class="dd26-stat"><strong>${escapeHtml(accountLinked)}</strong><span>Accounts matched</span></div><div class="dd26-stat"><strong>${escapeHtml(counts.submitted || 0)}</strong><span>Submitted</span></div><div class="dd26-stat"><strong>${escapeHtml(counts.needsAttention ?? attention.length)}</strong><span>Needs attention</span></div></div>
      <details class="dd26-section" open>
        <summary>Upload and check the class list</summary>
        <p>Upload a CSV or XLSX file, paste a table, or add one student at a time. Any row that needs correction stays visible for you to fix.</p>
        <div class="dd26-form-grid"><label class="dd26-field"><span>Class list CSV or XLSX</span><input class="dd26-input" id="dd26-roster-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><label class="dd26-field"><span>Or paste the class list</span><textarea class="dd26-textarea compact" id="dd26-roster-paste" placeholder="email,student number,exam number,name"></textarea></label></div>
        <div class="dd26-actions"><button class="dd26-button" id="dd26-validate-roster" type="button">Check file</button><button class="dd26-button" id="dd26-validate-roster-paste" type="button">Check pasted list</button><button class="dd26-button primary" id="dd26-import-roster" type="button" ${state.exam.rosterPreview?.validation?.ok ? '' : 'disabled'}>Save class list</button><button class="dd26-button" id="dd26-download-roster-template" type="button">Download class-list template</button></div>
        ${rosterPreviewHtml()}
        <details class="dd26-advanced"><summary>Add or correct one student</summary><div class="dd26-form-grid"><label class="dd26-field"><span>Primary email</span><input class="dd26-input" id="dd26-beadle-row-email" type="email"></label><label class="dd26-field"><span>Student ID</span><input class="dd26-input" id="dd26-beadle-row-student"></label><label class="dd26-field"><span>Exam number</span><input class="dd26-input" id="dd26-beadle-row-candidate"></label><label class="dd26-field"><span>Name (optional)</span><input class="dd26-input" id="dd26-beadle-row-name"></label><label class="dd26-field wide"><span>Reason for the change</span><input class="dd26-input" id="dd26-beadle-row-reason" value="Correct the class list"></label></div><div class="dd26-actions"><button class="dd26-button" id="dd26-upsert-beadle-row" type="button">Check and save student</button></div></details>
        <label class="dd26-field"><span>Student examination link</span><div class="dd26-secret-row"><input class="dd26-input" id="dd26-beadle-exam-link" readonly value="${escapeHtml(examLink)}"><button class="dd26-button" id="dd26-copy-exam-link" type="button">Copy link</button></div></label><p class="dd26-help">The link points to the exam but does not let an unlisted or signed-out student enter. ${escapeHtml(candidateAccessCopy)}</p>
      </details>
      ${attention.length ? `<div class="dd26-attention-list">${attention.map((item) => `<article><div><strong>${escapeHtml(item.candidateNumber || 'Student')}</strong><small>${escapeHtml(item.label || item.type || Object.keys(item.reasons || {}).join(', ') || 'Review required')}</small></div><span class="dd26-status">${escapeHtml(item.severity || item.reasons?.incidentSeverity || 'review')}</span></article>`).join('')}</div>` : '<div class="dd26-success">No student needs attention right now.</div>'}
      <div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Exam number</th><th>Signed-in account</th><th>Identity check</th><th>Exam status</th><th>Temporary leave</th><th>What the Beadle can do</th></tr></thead><tbody>${candidates.map((candidate) => `<tr><td>${escapeHtml(candidate.candidateNumber)}</td><td>${escapeHtml(candidate.accountLinked ? 'Matched' : 'Needs checking')}</td><td>${escapeHtml(candidate.verificationStatus || 'Pending')}</td><td>${escapeHtml(candidate.state || candidate.attemptStatus || 'On class list')}</td><td>${candidate.leave?.active ? `${escapeHtml(candidate.leave.elapsedMinutes || 0)} min` : '—'}</td><td><div class="dd26-actions"><button class="dd26-button" data-dd26-verify-candidate="${escapeHtml(candidate.candidateNumber)}" type="button">Record identity check</button>${candidate.admitted ? '' : `<button class="dd26-button primary" data-dd26-admit-candidate="${escapeHtml(candidate.candidateNumber)}" type="button">Allow entry</button>`}${candidate.leave?.active ? `<button class="dd26-button" data-dd26-return-leave="${escapeHtml(candidate.leave.id)}" data-dd26-leave-attempt="${escapeHtml(candidate.attemptId)}" type="button">Record return</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6">No students are on the class list yet.</td></tr>'}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-refresh-beadle" type="button">Refresh</button><button class="dd26-button" id="dd26-back-beadle" type="button">Back to assigned exams</button></div><div class="dd26-privacy">This page never shows the exam questions, student answers, grades, or the Professor’s suggested answer.</div></section>`;
    candidates.filter((candidate) => candidate.attemptId && candidate.attemptStatus === 'in_progress').forEach((candidate) => {
      const anchor = [...document.querySelectorAll('[data-dd26-verify-candidate]')]
        .find((button) => button.dataset.dd26VerifyCandidate === String(candidate.candidateNumber));
      anchor?.parentElement?.insertAdjacentHTML('beforeend', `<button class="dd26-button" data-dd26-transfer-attempt="${escapeHtml(candidate.attemptId)}" data-dd26-transfer-candidate="${escapeHtml(candidate.candidateNumber)}" type="button">Controlled transfer</button>`);
    });
    candidates.filter((candidate) => candidate.attemptId && candidate.leave?.active && !candidate.leave?.acknowledged).forEach((candidate) => {
      const anchor = document.querySelector(`[data-dd26-return-leave="${CSS.escape(String(candidate.leave.id))}"]`);
      anchor?.insertAdjacentHTML('beforebegin', `<button class="dd26-button" data-dd26-acknowledge-leave="${escapeHtml(candidate.leave.id)}" data-dd26-leave-attempt="${escapeHtml(candidate.attemptId)}" type="button">Acknowledge leave</button>`);
    });
    bindRosterControls();
    document.getElementById('dd26-upsert-beadle-row')?.addEventListener('click', upsertBeadleRosterRow);
    document.getElementById('dd26-copy-exam-link')?.addEventListener('click', copyBeadleExamLink);
    document.getElementById('dd26-refresh-beadle')?.addEventListener('click', () => openBeadleOperations(snapshot.examId));
    document.getElementById('dd26-back-beadle')?.addEventListener('click', () => refreshExamPortal('beadle'));
    document.querySelectorAll('[data-dd26-verify-candidate]').forEach((button) => button.addEventListener('click', () => beadleCandidateAction('record_candidate_verification', button.dataset.dd26VerifyCandidate, snapshot.examId)));
    document.querySelectorAll('[data-dd26-admit-candidate]').forEach((button) => button.addEventListener('click', () => beadleCandidateAction('set_candidate_admission', button.dataset.dd26AdmitCandidate, snapshot.examId)));
    document.querySelectorAll('[data-dd26-return-leave]').forEach((button) => button.addEventListener('click', () => beadleLeaveReturn(button.dataset.dd26ReturnLeave, button.dataset.dd26LeaveAttempt, snapshot.examId)));
    document.querySelectorAll('[data-dd26-acknowledge-leave]').forEach((button) => button.addEventListener('click', () => beadleLeaveAcknowledge(button.dataset.dd26AcknowledgeLeave, button.dataset.dd26LeaveAttempt, snapshot.examId)));
    document.querySelectorAll('[data-dd26-transfer-attempt]').forEach((button) => button.addEventListener('click', () => openSessionTransfer(button.dataset.dd26TransferAttempt, button.dataset.dd26TransferCandidate, snapshot.examId)));
  }

  async function beadleCandidateAction(operation, candidateNumber, examId) {
    const reason = global.prompt(operation === 'set_candidate_admission' ? 'Reason for this admission:' : 'Record only the physical verification outcome or exception note:');
    if (!reason) return;
    try {
      const body = operation === 'set_candidate_admission'
        ? { operation, examId, candidateNumber, decision: 'admit', reason, requestKey: randomKey('admission') }
        : { operation, examId, candidateNumber, method: 'physical', outcome: 'verified', note: reason, requestKey: randomKey('verification') };
      await command(body);
      global.toast?.('Operational decision recorded.', 'ok');
      await openBeadleOperations(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function beadleLeaveReturn(leaveId, attemptId, examId) {
    try {
      await command({ operation: 'acknowledge_leave', attemptId, leaveId, action: 'record_return', note: 'Return recorded by Beadle', requestKey: randomKey('leave_return') });
      await openBeadleOperations(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function beadleLeaveAcknowledge(leaveId, attemptId, examId) {
    try {
      await command({ operation: 'acknowledge_leave', attemptId, leaveId, action: 'acknowledge', note: 'Temporary leave acknowledged by Beadle', requestKey: randomKey('leave_ack') });
      global.toast?.('Temporary leave acknowledged. The exam timer continues.', 'ok');
      await openBeadleOperations(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openSessionTransfer(attemptId, candidateNumber, examId) {
    openDialog(`<div class="dd26-label">Device help for one student</div><h2>Move student ${escapeHtml(candidateNumber)} to a new device</h2><div class="dd26-error"><strong>Verify the student in person first.</strong> The new device restores only answers already received by Due Diligence. The previous device immediately loses exam access, and the change is recorded.</div><div class="dd26-form-grid"><label class="dd26-field"><span>Current exam-session number shown to the student</span><input class="dd26-input" id="dd26-transfer-epoch" type="number" min="1" step="1"></label><label class="dd26-field"><span>New-device recovery reference (64 characters)</span><input class="dd26-input" id="dd26-transfer-device" minlength="64" maxlength="64" autocomplete="off"></label><label class="dd26-field wide"><span>Required reason</span><input class="dd26-input" id="dd26-transfer-reason" maxlength="1000" value="Student verified in person after device failure"></label></div><label class="dd26-choice"><input id="dd26-transfer-verified" type="checkbox"><span><strong>I verified this student and the new device in person</strong><small>The previous device will immediately lose exam access.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-transfer" type="button" disabled>Move exam to the new device</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const acknowledgment = document.getElementById('dd26-transfer-verified');
    const submit = document.getElementById('dd26-confirm-transfer');
    acknowledgment?.addEventListener('change', () => { submit.disabled = !acknowledgment.checked; });
    submit?.addEventListener('click', async () => {
      submit.disabled = true;
      try {
        await command({
          operation: 'transfer_session', attemptId,
          expectedEpoch: Number(value('dd26-transfer-epoch')),
          deviceInstanceHash: value('dd26-transfer-device').toLowerCase(),
          reason: value('dd26-transfer-reason'), requestKey: randomKey('session_transfer'),
        });
        closeDialog();
        global.toast?.('Session transferred; the previous device can no longer write.', 'ok');
        await openBeadleOperations(examId);
      } catch (error) { submit.disabled = false; global.toast?.(error.message, 'warn'); }
    });
  }

  function parseDelimitedRoster(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!source) return [];
    const delimiter = source.includes('\t') ? '\t' : ',';
    const records = [];
    let record = []; let cell = ''; let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted && character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (!quoted && character === delimiter) { record.push(cell); cell = ''; }
      else if (!quoted && character === '\n') { record.push(cell.replace(/\r$/, '')); records.push(record); record = []; cell = ''; }
      else cell += character;
    }
    record.push(cell.replace(/\r$/, '')); records.push(record);
    const aliases = new Map([
      ['email', 'email'], ['email address', 'email'], ['primary email', 'email'],
      ['student number', 'studentNumber'], ['student id', 'studentNumber'], ['student no', 'studentNumber'],
      ['candidate number', 'candidateNumber'], ['candidate id', 'candidateNumber'], ['candidate no', 'candidateNumber'],
      ['name', 'displayName'], ['display name', 'displayName'], ['student name', 'displayName'],
    ]);
    const headers = records.shift()?.map((entry) => aliases.get(String(entry).trim().toLowerCase()) || null) || [];
    return records.filter((row) => row.some((entry) => String(entry).trim())).map((row) => Object.fromEntries(
      headers.map((header, index) => [header, String(row[index] ?? '').trim()]).filter(([header]) => header),
    ));
  }

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function validatePastedRoster() {
    const rows = parseDelimitedRoster(value('dd26-roster-paste', false));
    if (!rows.length) { global.toast?.('Paste a header row and at least one candidate row.', 'warn'); return; }
    await validateRosterRows(rows);
  }

  function collectRosterPreviewRows() {
    return [...document.querySelectorAll('[data-dd26-roster-row]')].map((row) => Object.fromEntries(
      [...row.querySelectorAll('[data-dd26-roster-field]')].map((input) => [input.dataset.dd26RosterField, input.value]),
    ));
  }

  async function validateRosterRows(rows) {
    try {
      const normalizedRows = rows.map((row) => ({
        email: String(row.email || '').trim(),
        studentNumber: String(row.studentNumber || '').trim(),
        candidateNumber: String(row.candidateNumber || '').trim(),
        displayName: String(row.displayName || '').trim(),
      }));
      const validation = state.exam.rosterMode === 'beadle'
        ? await command({ operation: 'validate_exam_roster', examId: state.exam.activeExamId, rows: normalizedRows })
        : await command({ operation: 'validate_roster', classroomId: state.exam.activeClassroomId, rows: normalizedRows });
      state.exam.rosterPreview = {
        rows: normalizedRows,
        sourceHash: await sha256Text(JSON.stringify(normalizedRows)),
        validation,
      };
      rerenderRosterSurface();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function revalidateRosterPreview() {
    await validateRosterRows(collectRosterPreviewRows());
  }

  function addRosterPreviewRow() {
    const rows = collectRosterPreviewRows();
    rows.push({ email: '', studentNumber: '', candidateNumber: '', displayName: '' });
    state.exam.rosterPreview = { rows, sourceHash: '', validation: { ok: false, errors: [{ message: 'Validate the added row.' }] } };
    rerenderRosterSurface();
  }

  function removeRosterPreviewRow(index) {
    const rows = collectRosterPreviewRows();
    rows.splice(index, 1);
    state.exam.rosterPreview = { rows, sourceHash: '', validation: { ok: false, errors: [{ message: 'Revalidate the corrected roster.' }] } };
    rerenderRosterSurface();
  }

  function downloadRosterTemplate() {
    const blob = new Blob(['email,student number,candidate number,name\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'duediligence-examination-roster-template.csv';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importRoster() {
    const preview = state.exam.rosterPreview;
    if (!preview?.validation?.ok) return;
    try {
      if (state.exam.rosterMode === 'beadle') {
        await command({ operation: 'import_exam_roster', examId: state.exam.activeExamId, rows: preview.rows, sourceHash: preview.sourceHash, requestKey: randomKey('roster') });
      } else {
        await command({ operation: 'import_roster', classroomId: state.exam.activeClassroomId, rows: preview.rows, sourceHash: preview.sourceHash, requestKey: randomKey('roster') });
      }
      state.exam.rosterPreview = null;
      global.toast?.('Roster imported without duplicates.', 'ok');
      if (state.exam.rosterMode === 'beadle') await openBeadleOperations(state.exam.activeExamId);
      else await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function rerenderRosterSurface() {
    if (state.exam.rosterMode === 'beadle' && state.exam.activeBeadleSnapshot) {
      renderBeadleOperations(state.exam.activeBeadleSnapshot);
      return;
    }
    renderExamRoom();
  }

  async function upsertBeadleRosterRow() {
    const row = {
      email: value('dd26-beadle-row-email'),
      studentNumber: value('dd26-beadle-row-student'),
      candidateNumber: value('dd26-beadle-row-candidate'),
      displayName: value('dd26-beadle-row-name', false),
    };
    try {
      await command({
        operation: 'upsert_exam_roster_row',
        examId: state.exam.activeExamId,
        row,
        reason: value('dd26-beadle-row-reason'),
        requestKey: randomKey('roster_row'),
      });
      global.toast?.('Roster row saved with an audit record.', 'ok');
      await openBeadleOperations(state.exam.activeExamId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function copyBeadleExamLink() {
    const input = document.getElementById('dd26-beadle-exam-link');
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      document.getElementById('dd26-copy-exam-link').textContent = 'Copied';
    } catch {
      input.focus();
      input.select();
      global.toast?.('Copy was unavailable. The link is selected for manual copying.', 'warn');
    }
  }

  async function createExam() {
    try {
      await command({ operation: 'create_exam', classroomId: state.exam.activeClassroomId, title: value('dd26-exam-title'), instructions: value('dd26-exam-instructions', false), questionCount: Number(value('dd26-exam-count')), integrityPreset: value('dd26-exam-integrity'), includeQuestionnaire: value('dd26-exam-questionnaire') === 'true' });
      global.toast?.('Examination draft created.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openQuestionUpload(examId, questionCount, uploadIntent = null) {
    state.exam.activeExamId = examId;
    state.exam.questionUploadIntent = uploadIntent?.mode === 'replacement'
      ? uploadIntent : { mode: 'initial' };
    const replacement = state.exam.questionUploadIntent.mode === 'replacement';
    openDialog(`<div class="dd26-label">Step 1 Upload / Step 2 Review${replacement ? ' / corrected replacement' : ''}</div><h2>${replacement ? 'Prepare corrected replacement questions' : 'Prepare examination questions'}</h2>${replacement ? '<div class="dd26-notice"><strong>Safe staging:</strong> this creates a separate confirmed question version. It does not alter the currently published examination unless the later replacement publication succeeds.</div>' : ''}<p>Upload a PDF, DOCX, or UTF-8 TXT file, or paste formatted/plain text. Nothing is published automatically. PDF files that cannot be extracted safely fall back to manual construction.</p><label class="dd26-field"><span>Source file</span><input class="dd26-input" id="dd26-question-file" type="file" accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><div class="dd26-divider" aria-hidden="true">or</div><label class="dd26-field"><span>Paste questions</span><textarea class="dd26-textarea compact" id="dd26-question-paste" maxlength="200000" placeholder="1. First question…&#10;&#10;2. Second question…"></textarea></label><input id="dd26-question-count" type="hidden" value="${questionCount}"><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preview-questions" type="button">Open editable review</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div><div class="dd26-privacy">Encrypted or active-content PDFs are rejected. OCR, malware scanning, and direct Google Docs import are not claimed in this beta.</div><div id="dd26-question-preview"></div>`);
    document.getElementById('dd26-preview-questions')?.addEventListener('click', previewQuestions);
  }

  async function previewQuestions() {
    const file = document.getElementById('dd26-question-file')?.files?.[0];
    const pasted = value('dd26-question-paste', false).trim();
    const questionCount = Number(value('dd26-question-count'));
    if (!file && !pasted) { global.toast?.('Choose a PDF, TXT, or DOCX source, or paste the questions.', 'warn'); return; }
    try {
      const source = file
        ? await filePayload(file)
        : await filePayload(new File([pasted], 'pasted-examination.txt', { type: 'text/plain' }));
      const payload = await api('/exam-room/upload/questions', { examId: state.exam.activeExamId, questionCount, ...source });
      state.exam.questionPreview = payload.preview;
      renderQuestionPreview();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderQuestionPreview() {
    const preview = state.exam.questionPreview;
    const host = document.getElementById('dd26-question-preview');
    if (!host || !preview) return;
    const totalPoints = preview.questions.reduce((total, question) => total + (Number(question.maximumPoints) || 0), 0);
    host.innerHTML = `<div class="dd26-notice">${escapeHtml(preview.fileName)} · SHA-256 ${escapeHtml(preview.contentHash)} · detected ${preview.questions.length}, expected ${preview.questionCount} · ${escapeHtml(totalPoints)} total points</div>${preview.warnings?.length ? `<div class="dd26-error" role="alert">${preview.warnings.map(escapeHtml).join('<br>')}</div>` : ''}<div id="dd26-question-editors">${preview.questions.map(questionEditor).join('')}</div><details class="dd26-student-preview"><summary>Student preview</summary><div class="dd26-question-nav" aria-hidden="true">${preview.questions.map((_, index) => `<span>${index + 1}</span>`).join('')}</div>${preview.questions.map((question, index) => `<section><small>Question ${index + 1} · ${escapeHtml(question.maximumPoints || 5)} points</small><p>${escapeHtml(question.prompt)}</p></section>`).join('') || '<p>Add questions manually to build the preview.</p>'}</details><div class="dd26-actions"><button class="dd26-button" id="dd26-add-question" type="button">Add question manually</button><button class="dd26-button primary" id="dd26-confirm-questions" type="button">Confirm review-ready version</button></div>`;
    bindQuestionEditors();
  }

  function questionEditor(question, index) {
    return `<section class="dd26-question-editor" data-dd26-question-index="${index}"><div class="dd26-question-editor-head"><strong>Question ${index + 1}</strong><div class="dd26-question-editor-tools"><button class="dd26-button" data-dd26-question-up type="button">Up</button><button class="dd26-button" data-dd26-question-down type="button">Down</button><button class="dd26-button" data-dd26-question-split type="button">Split at cursor</button><button class="dd26-button" data-dd26-question-merge type="button">Merge above</button><button class="dd26-button danger" data-dd26-question-remove type="button">Remove</button></div></div><textarea class="dd26-textarea" data-dd26-question-prompt maxlength="50000">${escapeHtml(question.prompt)}</textarea><label class="dd26-field"><span>Maximum points</span><input class="dd26-input" data-dd26-question-points type="number" min="0.1" max="1000" step="0.1" value="${escapeHtml(question.maximumPoints || 5)}"></label></section>`;
  }

  function collectQuestionEditors() {
    return [...document.querySelectorAll('[data-dd26-question-index]')].map((section, index) => ({
      ordinal: index + 1,
      prompt: section.querySelector('[data-dd26-question-prompt]').value,
      maximumPoints: Number(section.querySelector('[data-dd26-question-points]').value),
    }));
  }

  function updatePreviewQuestions(rows) {
    state.exam.questionPreview.questions = rows.map((row, index) => ({ ...row, ordinal: index + 1 }));
    state.exam.questionPreview.warnings = rows.length === state.exam.questionPreview.questionCount ? [] : [`Preview contains ${rows.length} questions; the professor selected ${state.exam.questionPreview.questionCount}.`];
    renderQuestionPreview();
  }

  function bindQuestionEditors() {
    document.getElementById('dd26-add-question')?.addEventListener('click', () => updatePreviewQuestions([...collectQuestionEditors(), { prompt: '', maximumPoints: 5 }]));
    document.getElementById('dd26-confirm-questions')?.addEventListener('click', confirmQuestions);
    document.querySelectorAll('[data-dd26-question-index]').forEach((section) => {
      const index = Number(section.dataset.dd26QuestionIndex);
      section.querySelector('[data-dd26-question-up]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-down]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]]; updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-remove]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); rows.splice(index, 1); updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-merge]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index < 1) return; rows[index - 1].prompt = `${rows[index - 1].prompt}\n\n${rows[index].prompt}`; rows.splice(index, 1); updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-split]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); const area = section.querySelector('[data-dd26-question-prompt]'); const point = area.selectionStart; if (!point || point >= area.value.length) { global.toast?.('Place the text cursor where the question should split.', 'warn'); return; } const before = area.value.slice(0, point).trim(); const after = area.value.slice(point).trim(); if (!before || !after) return; rows.splice(index, 1, { ...rows[index], prompt: before }, { ...rows[index], prompt: after }); updatePreviewQuestions(rows); });
    });
  }

  async function confirmQuestions() {
    const preview = state.exam.questionPreview;
    const questions = collectQuestionEditors();
    if (questions.length !== preview.questionCount) { global.toast?.(`Exactly ${preview.questionCount} questions must be confirmed.`, 'warn'); return; }
    const uploadIntent = state.exam.questionUploadIntent || { mode: 'initial' };
    const replacement = uploadIntent.mode === 'replacement';
    try {
      const result = await command({
        operation: replacement ? 'confirm_replacement_questions' : 'confirm_questions',
        examId: preview.examId,
        ...(replacement ? {
          expectedPublicationId: uploadIntent.expectedPublicationId,
          requestKey: uploadIntent.questionRequestKey ||= randomKey('replacement_questions'),
        } : {}),
        objectPath: preview.objectPath,
        fileName: preview.fileName,
        mimeType: preview.mimeType,
        sizeBytes: preview.sizeBytes,
        pageCount: preview.pageCount,
        contentHash: preview.contentHash,
        questionCount: questions.length,
        questions,
        warnings: [],
      });
      if (replacement && (result?.ok !== true || result.staged !== true
          || !result.replacementQuestionVersionId
          || result.expectedPublicationId !== uploadIntent.expectedPublicationId)) {
        throw new Error('The server did not confirm a safely staged replacement question version.');
      }
      closeDialog();
      if (replacement) {
        global.toast?.('Corrected questions staged separately; the live publication is unchanged.', 'ok');
        openSchedule(preview.examId, {
          ...uploadIntent,
          replacementQuestionVersionId: result.replacementQuestionVersionId,
          replacementQuestionVersionNumber: result.questionVersionNumber,
          replacementQuestionSnapshotHash: result.snapshotHash,
        });
      } else {
        global.toast?.('Question version confirmed and sealed for scheduling.', 'ok');
        await refreshExamPortal('professor');
      }
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function beginReplacementPublication(examId) {
    state.exam.activeExamId = examId;
    try {
      const payload = await api('/exam-room/query', { operation: 'exam_intent', examId });
      const intent = payload.result || {};
      if (intent.roles?.professor !== true || intent.canReplacePublication !== true
          || intent.canUploadReplacementQuestions !== true
          || !intent.currentPublicationId) {
        const reason = intent.replaceBlockedReason
          || 'The server did not confirm that this publication is still before opening with zero candidate attempts.';
        openDialog(`<div class="dd26-label">Replacement publication blocked</div><h2>The current version cannot be replaced</h2><div class="dd26-error" role="alert">${escapeHtml(reason)}</div><p>No publication or credential was changed. If any candidate has started, use an audited erratum or explicit stop notice. Otherwise refresh the examination after confirming a revised question version.</p><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div>`);
        return;
      }
      openDialog(`<div class="dd26-label">Pre-start replacement</div><h2>Prepare a corrected examination version?</h2><div class="dd26-error" role="alert"><strong>This starts a credential-rotating publication action.</strong> It is accepted only before the scheduled opening and while zero candidate attempts exist. The current question snapshot remains live and immutable unless the complete replacement later succeeds.</div><p>You will upload and review a distinct corrected question version, then review its rules and publish it. Staging questions alone never changes the live examination. Once a candidate starts, this path is permanently blocked and corrections must use errata.</p><label class="dd26-field"><span>Reason for replacement</span><textarea class="dd26-textarea compact" id="dd26-replacement-reason" minlength="20" maxlength="1000" required></textarea></label><label class="dd26-choice"><input id="dd26-replacement-ack" type="checkbox"><span><strong>I intend to supersede publication ${escapeHtml(intent.publicationNumber || intent.currentPublicationId)}</strong><small>I understand the previous snapshot is preserved and every issued exam credential rotates only after successful replacement publication.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-continue-replacement" type="button" disabled>Upload corrected questions</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
      const acknowledgement = document.getElementById('dd26-replacement-ack');
      const continueButton = document.getElementById('dd26-continue-replacement');
      const updateState = () => {
        continueButton.disabled = !acknowledgement.checked
          || value('dd26-replacement-reason').length < 20;
      };
      acknowledgement?.addEventListener('change', updateState);
      document.getElementById('dd26-replacement-reason')?.addEventListener('input', updateState);
      continueButton?.addEventListener('click', () => {
        const reason = value('dd26-replacement-reason');
        if (!acknowledgement.checked || reason.length < 20) return;
        const exam = (state.exam.portal?.classes || [])
          .flatMap((classroom) => classroom.exams || [])
          .find((entry) => entry.examId === examId);
        const questionCount = Number(exam?.questionCount);
        if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 200) {
          global.toast?.('The server did not provide the examination question count. Refresh before staging a replacement.', 'warn');
          return;
        }
        openQuestionUpload(examId, questionCount, {
          mode: 'replacement',
          expectedPublicationId: intent.currentPublicationId,
          publicationNumber: intent.publicationNumber,
          reason,
        });
      });
    } catch (error) {
      openDialog(`<div class="dd26-label">Replacement publication unavailable</div><h2>The eligibility check failed closed</h2><div class="dd26-error" role="alert">${escapeHtml(error.message || 'The server did not authorize a replacement check.')}</div><p>No publication or credential was changed. Refresh and try again, or use an erratum if any candidate has started.</p><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div>`);
    }
  }

  function openSchedule(examId, publicationIntent = null) {
    state.exam.activeExamId = examId;
    state.exam.publishIntent = publicationIntent?.mode === 'replacement'
      ? publicationIntent
      : { mode: 'initial' };
    const now = new Date(Date.now() + 15 * 60000);
    const close = new Date(now.getTime() + 2 * 3600000);
    const replacementNotice = state.exam.publishIntent.mode === 'replacement'
      ? `<div class="dd26-error" role="alert"><strong>Replacement exam in progress.</strong> You are preparing a corrected version to replace version ${escapeHtml(state.exam.publishIntent.publicationNumber || 'currently published')}. Due Diligence will confirm that no student has started before accepting it.</div>`
      : '';
    openDialog(`<div class="dd26-label">Step 3 · Set exam rules${state.exam.publishIntent.mode === 'replacement' ? ' / replacement' : ''}</div><h2>Set the schedule and exam rules</h2>${replacementNotice}<div class="dd26-form-grid"><label class="dd26-field"><span>Exam opens</span><input class="dd26-input" id="dd26-opens-at" type="datetime-local" value="${localDateValue(now)}"></label><label class="dd26-field"><span>Exam ends</span><input class="dd26-input" id="dd26-closes-at" type="datetime-local" value="${localDateValue(close)}"></label><label class="dd26-field"><span>Time allowed in minutes</span><input class="dd26-input" id="dd26-duration" type="number" min="1" max="480" value="120"></label><label class="dd26-field"><span>Late entry allowed (minutes)</span><input class="dd26-input" id="dd26-late-admission" type="number" min="0" max="480" value="0"><small class="dd26-help">Use 0 when no late entry is allowed.</small></label><label class="dd26-field"><span>Extra time to reconnect and submit</span><input class="dd26-input" id="dd26-submission-grace" type="number" min="0" max="120" value="15"><small class="dd26-help">This helps after a connection problem. Answers written after the exam ends are kept separately for review and are not silently added to the submitted answers.</small></label><label class="dd26-field"><span>Allowed materials</span><input class="dd26-input" id="dd26-allowed-materials" maxlength="2000" value="Professor-published materials only"></label><label class="dd26-field"><span>Moving between questions</span><select class="dd26-select" id="dd26-navigation-mode"><option value="free" selected>Students may move between questions</option><option value="one_way">Move forward only</option></select></label><label class="dd26-field"><span>If a student leaves the exam tab</span><select class="dd26-select" id="dd26-monitoring-mode"><option value="record_only" selected>Record for Professor review</option><option value="warn_and_record">Warn the student and record</option></select><small class="dd26-help">Copy, cut, and paste are blocked during the monitored exam. A recorded event is never an automatic failure.</small></label><label class="dd26-field"><span>Full screen</span><select class="dd26-select" id="dd26-fullscreen-policy"><option value="requested" selected>Ask students to use full screen</option><option value="off">Do not ask for full screen</option><option value="required_with_exemptions">Require full screen, with approved exemptions</option></select></label><label class="dd26-field"><span>Student entry</span><select class="dd26-select" id="dd26-admission-mode"><option value="automatic" selected>Allow after sign-in and class-list checks</option><option value="beadle_approval">Beadle must allow entry</option></select></label><label class="dd26-field"><span>Temporary leave</span><select class="dd26-select" id="dd26-leave-policy"><option value="false" selected>Student records leaving and returning</option><option value="true">Beadle must acknowledge the leave</option></select></label><label class="dd26-field"><span>Suggested answer for grading</span><select class="dd26-select" id="dd26-model-answer-mode"><option value="none" selected>None</option><option value="paste">Paste before publishing</option><option value="upload">Upload a private source</option></select></label></div><label class="dd26-choice"><input id="dd26-student-access-code-required" type="checkbox" checked><span><strong>Require a separate student exam access code</strong><small>This is an extra check. Every student must still sign in, be on the class list, and meet the entry rules.</small></span></label><label class="dd26-field" id="dd26-model-answer-field" hidden><span>Suggested answer for grading</span><textarea class="dd26-textarea" id="dd26-model-answer" maxlength="100000"></textarea></label><label class="dd26-field" id="dd26-model-answer-upload-field" hidden><span>Private suggested-answer source</span><input class="dd26-input" id="dd26-model-answer-file" type="file" accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><small class="dd26-help">TXT, DOCX, or an inactive unencrypted PDF, maximum 10 MB. Students never receive this file.</small></label><details class="dd26-advanced"><summary>More about exam safeguards</summary><p>Leaving the tab or exam window is recorded for the Professor to review. Copy, cut, and paste are blocked during the exam unless an approved accommodation requires otherwise. These records are not proof by themselves and never automatically fail, submit, close, or erase an examination. Camera collection and AI grading are off.</p></details><div class="dd26-actions"><button class="dd26-button primary" id="dd26-review-publish" type="button">Review before publishing</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const oneWayOption = document.querySelector('#dd26-navigation-mode option[value="one_way"]');
    if (oneWayOption) {
      oneWayOption.disabled = true;
      oneWayOption.textContent = 'One-way navigation — unavailable until durable reload enforcement is verified';
    }
    const modelAnswerUploadOption = document.querySelector('#dd26-model-answer-mode option[value="upload"]');
    if (modelAnswerUploadOption) {
      modelAnswerUploadOption.disabled = true;
      modelAnswerUploadOption.textContent = 'Upload — unavailable until owner-only retrieval is verified';
    }
    document.getElementById('dd26-model-answer-mode')?.addEventListener('change', (event) => {
      document.getElementById('dd26-model-answer-field').hidden = event.target.value !== 'paste';
      document.getElementById('dd26-model-answer-upload-field').hidden = event.target.value !== 'upload';
    });
    document.getElementById('dd26-review-publish')?.addEventListener('click', reviewPublish);
  }

  function reviewPublish() {
    if (state.exam.publishIntent?.mode === 'replacement'
        && !state.exam.publishIntent.replacementQuestionVersionId) {
      global.toast?.('A separately staged corrected question version is required before replacement.', 'warn');
      return;
    }
    const opensAt = new Date(value('dd26-opens-at'));
    const hardClosesAt = new Date(value('dd26-closes-at'));
    const durationMinutes = Number(value('dd26-duration'));
    if (!Number.isFinite(opensAt.getTime()) || !Number.isFinite(hardClosesAt.getTime()) || hardClosesAt <= opensAt) {
      global.toast?.('Choose a valid opening and later hard-closing time.', 'warn'); return;
    }
    const suggestedAnswerMode = value('dd26-model-answer-mode');
    const suggestedAnswerFile = document.getElementById('dd26-model-answer-file')?.files?.[0] || null;
    if (suggestedAnswerMode === 'paste' && !value('dd26-model-answer', false).trim()) {
      global.toast?.('Paste a suggested answer or select None.', 'warn'); return;
    }
    if (suggestedAnswerMode === 'upload' && !suggestedAnswerFile) {
      global.toast?.('Choose a private suggested-answer source or select None.', 'warn'); return;
    }
    const rules = {
      opensAt: opensAt.toISOString(),
      hardClosesAt: hardClosesAt.toISOString(),
      durationMinutes,
      lateAdmissionMinutes: Number(value('dd26-late-admission')),
      submissionGraceMinutes: Number(value('dd26-submission-grace')),
      allowedMaterials: value('dd26-allowed-materials', false),
      navigationMode: value('dd26-navigation-mode'),
      integrityMode: value('dd26-monitoring-mode'),
      fullscreenPolicy: value('dd26-fullscreen-policy'),
      admissionMode: value('dd26-admission-mode'),
      temporaryLeaveAcknowledgment: value('dd26-leave-policy') === 'true',
      studentAccessCodeRequired: document.getElementById('dd26-student-access-code-required')?.checked === true,
      suggestedAnswerMode,
      suggestedAnswer: suggestedAnswerMode === 'paste' ? value('dd26-model-answer', false) : null,
      suggestedAnswerObjectPath: null,
      aiGradingEnabled: false,
    };
    state.exam.publishDraft = { rules, suggestedAnswerFile, intent: state.exam.publishIntent || { mode: 'initial' } };
    const exam = (state.exam.portal?.classes || []).flatMap((classroom) => classroom.exams || []).find((entry) => entry.examId === state.exam.activeExamId) || {};
    const warnings = [
      !exam.questionCount && 'No confirmed question count is visible in the portal snapshot.',
      rules.navigationMode === 'one_way' && 'One-way navigation is enabled and should be justified.',
      rules.fullscreenPolicy === 'required_with_exemptions' && 'Fullscreen remains a browser policy, not operating-system lockdown.',
    ].filter(Boolean);
    const replacement = state.exam.publishDraft.intent.mode === 'replacement';
    const immutableNotice = replacement
      ? `This replacement will supersede publication ${state.exam.publishDraft.intent.publicationNumber || state.exam.publishDraft.intent.expectedPublicationId}. It is accepted only before opening and while zero candidate attempts exist. The earlier snapshot remains preserved, all prior exam credentials are revoked, and new credentials are issued. After any start, use an audited erratum or explicit stop notice.`
      : 'Publishing creates one immutable beta snapshot of instructions, order, points, and rules. A later replacement requires a separate warning and is allowed only before opening and while zero candidate attempts exist. After any start, use an audited erratum or explicit stop notice.';
    const replacementQuestionSummary = replacement
      ? `<div><dt>Corrected question version</dt><dd>Version ${escapeHtml(state.exam.publishDraft.intent.replacementQuestionVersionNumber || state.exam.publishDraft.intent.replacementQuestionVersionId)} · staged hash ${escapeHtml(state.exam.publishDraft.intent.replacementQuestionSnapshotHash || 'server-confirmed')}</dd></div>`
      : '';
    openDialog(`<div class="dd26-label">Step 4 ${replacement ? 'Replace publication' : 'Publish'}</div><h2>${replacement ? 'Final replacement confirmation' : 'Final publish confirmation'}</h2><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(exam.questionCount || '—')}</strong><span>Questions</span></div><div class="dd26-stat"><strong>${escapeHtml(exam.totalPoints || '—')}</strong><span>Total points</span></div><div class="dd26-stat"><strong>${escapeHtml(durationMinutes)}</strong><span>Minutes</span></div><div class="dd26-stat"><strong>${escapeHtml(state.exam.portal?.classes?.find((entry) => entry.classroomId === state.exam.activeClassroomId)?.rosterCount || 0)}</strong><span>Candidates</span></div></div><dl class="dd26-publish-summary">${replacementQuestionSummary}<div><dt>Schedule</dt><dd>${escapeHtml(formatDate(opensAt))} to ${escapeHtml(formatDate(hardClosesAt))}</dd></div><div><dt>Student access</dt><dd>${rules.studentAccessCodeRequired ? 'Signed-in active roster plus separate access code' : 'Signed-in active roster and admission rules; no separate access code'}</dd></div><div><dt>Admission</dt><dd>${escapeHtml(rules.admissionMode)}</dd></div><div><dt>Navigation</dt><dd>${escapeHtml(rules.navigationMode)}</dd></div><div><dt>Monitoring</dt><dd>${escapeHtml(rules.integrityMode)}</dd></div><div><dt>Suggested answer</dt><dd>${escapeHtml(rules.suggestedAnswerMode)}</dd></div><div><dt>Accommodations</dt><dd>Per-candidate operational settings apply to server deadlines and exemptions.</dd></div><div><dt>AI / camera</dt><dd>Off</dd></div></dl>${warnings.length ? `<div class="dd26-error">${warnings.map(escapeHtml).join('<br>')}</div>` : '<div class="dd26-success">No blocking publish warning is visible.</div>'}<div class="dd26-notice">${escapeHtml(immutableNotice)}</div><label class="dd26-choice"><input id="dd26-publish-ack" type="checkbox"><span><strong>${replacement ? 'I intend to replace the current publication' : 'I reviewed the student preview and policies'}</strong><small>${replacement ? 'I understand the previous version is preserved and all issued exam credentials will rotate.' : 'I understand this version will be frozen for candidate attempts.'}</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-publish-confirm" type="button" disabled>${replacement ? 'Replace published version' : 'Publish examination'}</button><button class="dd26-button" data-dd26-close-dialog type="button">Return without publishing</button></div>`);
    const acknowledgement = document.getElementById('dd26-publish-ack');
    const publish = document.getElementById('dd26-publish-confirm');
    acknowledgement?.addEventListener('change', () => { publish.disabled = !acknowledgement.checked; });
    publish?.addEventListener('click', scheduleExam);
  }

  function publicationSecretsMayBeDisplayed(result, draft) {
    if (result?.ok !== true || !result.publicationId) return false;
    if (typeof result.accessCodeRequired !== 'boolean'
        || result.accessCodeRequired !== (draft?.rules?.studentAccessCodeRequired === true)) return false;
    if (draft?.intent?.mode !== 'replacement') return true;
    return result.credentialsRotated === true
      && result.questionVersionChanged === true
      && result.replacementQuestionVersionId === draft.intent.replacementQuestionVersionId;
  }

  async function scheduleExam() {
    const draft = state.exam.publishDraft;
    if (!draft?.rules || draft.busy) return;
    const studentKey = draft.rules.studentAccessCodeRequired ? randomKey('student_exam') : null;
    const gradingKey = randomKey('professor_grading');
    const replacement = draft.intent?.mode === 'replacement';
    draft.requestKey ||= randomKey(replacement ? 'replace_publication' : 'publish');
    draft.busy = true;
    const publishButton = document.getElementById('dd26-publish-confirm');
    if (publishButton) { publishButton.disabled = true; publishButton.textContent = replacement ? 'Replacing…' : 'Publishing…'; }
    try {
      if (draft.rules.suggestedAnswerMode === 'upload' && !draft.rules.suggestedAnswerObjectPath) {
        const uploaded = await api('/exam-room/upload/model-answer', {
          examId: state.exam.activeExamId,
          ...await filePayload(draft.suggestedAnswerFile),
          requestKey: draft.modelAnswerRequestKey ||= randomKey('model_answer'),
        });
        if (!uploaded.source?.objectPath) throw new Error('The private suggested-answer source was not registered.');
        draft.rules.suggestedAnswerObjectPath = uploaded.source.objectPath;
      }
      if (!replacement) {
        await command({
          operation: 'schedule_exam', examId: state.exam.activeExamId,
          opensAt: draft.rules.opensAt, hardClosesAt: draft.rules.hardClosesAt,
          durationMinutes: draft.rules.durationMinutes,
          studentKey, gradingKey,
        });
      }
      const result = replacement
        ? await command({
          operation: 'replace_publication',
          examId: state.exam.activeExamId,
          expectedPublicationId: draft.intent.expectedPublicationId,
          replacementQuestionVersionId: draft.intent.replacementQuestionVersionId,
          rules: draft.rules,
          studentKey,
          gradingKey,
          reason: draft.intent.reason,
          requestKey: draft.requestKey,
        })
        : await command({
          operation: 'publish_exam', examId: state.exam.activeExamId,
          rules: draft.rules, studentKey, requestKey: draft.requestKey,
        });
      if (!publicationSecretsMayBeDisplayed(result, draft)) {
        throw new Error('The server did not confirm a complete immutable publication. No secret can be displayed.');
      }
      const studentSecret = draft.rules.studentAccessCodeRequired
        ? `<div class="dd26-field"><span>Student examination access code</span><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-student-secret">${escapeHtml(studentKey)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-student-secret" type="button">Copy</button></div></div>`
        : '<div class="dd26-success"><strong>No student access-code secret was issued.</strong> Students still need a signed-in account that matches the active roster and admission rules.</div>';
      openDialog(`<div class="dd26-label">Published immutable version</div><h2>${replacement ? 'Replacement published' : 'Examination published'}</h2><p>Version ${escapeHtml(result.publicationNumber || result.versionNumber || result.version || 1)} is frozen${replacement ? ` and supersedes ${escapeHtml(result.supersedesPublicationId || draft.intent.expectedPublicationId)}` : ''}. ${draft.rules.studentAccessCodeRequired ? 'Copy the one-time secrets now' : 'Copy the grading secret now'}; Due Diligence stores only secure hashes and cannot reveal them later.</p>${studentSecret}<div class="dd26-field"><span>Professor grading key</span><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-grading-secret">${escapeHtml(gradingKey)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-grading-secret" type="button">Copy</button></div></div><div class="dd26-notice">A link or optional access code never authorizes a candidate without a signed-in account on the active roster and a valid admission decision.</div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">I stored the issued secret${draft.rules.studentAccessCodeRequired ? 's' : ''} securely</button></div>`, { persistent: true });
      bindSecretCopyButtons();
      await refreshPortalSilently();
    } catch (error) {
      draft.busy = false;
      draft.requestKey = null;
      const portalRefreshed = await refreshPortalSilently();
      const refreshedExam = (state.exam.portal?.classes || [])
        .flatMap((classroom) => classroom.exams || [])
        .find((entry) => entry.examId === state.exam.activeExamId);
      const retryAuthorized = portalRefreshed === true
        && refreshedExam?.publicationStateKnown === true
        && (replacement
          ? refreshedExam.currentPublicationId === draft.intent.expectedPublicationId
          : !refreshedExam.currentPublicationId);
      const button = document.getElementById('dd26-publish-confirm');
      if (button) {
        button.disabled = !retryAuthorized;
        button.textContent = retryAuthorized
          ? (replacement ? 'Retry replacement (server confirms no change)' : 'Retry full publish (server confirms unpublished)')
          : 'Return and refresh publication state';
      }
      global.toast?.(`No secret was retained or displayed. ${retryAuthorized ? 'The server confirms the publication is unchanged; a full retry will issue new secrets. ' : 'The publication could not be confirmed unchanged; return and refresh before further action. '}${error.message}`, 'warn');
    }
  }

  function localDateValue(date) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  async function startAttempt() {
    if (!isAuthenticated()) {
      state.exam.portal = null;
      state.exam.intentRole = 'student';
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    const examId = value('dd26-student-exam');
    const studentKey = value('dd26-student-key', false).trim() || null;
    if (!examId) { global.toast?.('Enter or choose an examination first.', 'warn'); return; }
    try {
      const storageApi = global.DueDiligenceExaminationRoomStore;
      state.exam.store ||= storageApi?.createStore?.();
      const storage = state.exam.store ? await state.exam.store.init() : { available: false, code: 'module_unavailable' };
      const persistent = storage.available && navigator.storage?.persist
        ? await navigator.storage.persist().catch(() => false)
        : false;
      const deviceSupported = Math.min(global.screen?.width || global.innerWidth, global.screen?.height || global.innerHeight) >= 600;
      const startedAt = performance.now();
      const deviceInstanceHash = storage.available ? await state.exam.store.getDeviceInstanceHash() : null;
      const payload = await api('/exam-room/query', { operation: 'preflight', examId, deviceInstanceHash });
      const reachabilityMs = Math.max(0, Math.round(performance.now() - startedAt));
      state.exam.preflight = { examId, studentKey, storage, persistent, deviceSupported, deviceInstanceHash, reachabilityMs, server: payload.result || {} };
      renderPreflight();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function accessCodePreflightPolicy(server = {}, studentKey = null) {
    const primary = server.accessCodeRequired;
    const nested = server.checks?.accessCodeRequired;
    const known = typeof primary === 'boolean' || typeof nested === 'boolean';
    const required = primary === true || nested === true;
    return {
      known,
      required,
      ready: known && (!required || Boolean(String(studentKey || '').trim())),
    };
  }

  function examIntegrityPolicy(rules = {}, accommodation = {}) {
    const integrityMode = typeof rules.integrityMode === 'string' ? rules.integrityMode : 'off';
    const recordingEnabled = integrityMode !== 'off'
      && accommodation.integrityExempt !== true;
    return {
      recordingEnabled,
      clipboardBlocked: recordingEnabled
        && accommodation.assistiveTechnology !== true
        && accommodation.assistiveTechnologyAllowed !== true,
    };
  }

  function clipboardEventTouchesAttempt(event, surface, selection = document.getSelection?.()) {
    if (!event || !surface) return false;
    const targetInside = Boolean(event.target && surface.contains(event.target));
    if (event.type === 'paste' || event.type === 'cut') return targetInside;
    if (event.type !== 'copy' || targetInside) return targetInside;
    if (!selection) return false;
    for (let index = 0; index < Number(selection.rangeCount || 0); index += 1) {
      try {
        if (selection.getRangeAt(index).intersectsNode(surface)) return true;
      } catch { /* a detached selection is outside the active examination surface */ }
    }
    return Boolean(
      (selection.anchorNode && surface.contains(selection.anchorNode))
      || (selection.focusNode && surface.contains(selection.focusNode)),
    );
  }

  function renderPreflight() {
    if (!isAuthenticated()) {
      state.exam.preflight = null;
      closeDialog();
      state.exam.portal = null;
      state.exam.section = 'entry';
      renderExamRoom();
      return;
    }
    const check = state.exam.preflight;
    if (!check) return;
    const server = check.server || {};
    const rules = server.rules || {};
    const integrity = examIntegrityPolicy(rules, server.accommodation || {});
    const eligible = server.eligible === true;
    const sessionConflict = server.sessionConflict === true || server.checks?.sessionConflict === true;
    const accessCodePolicy = accessCodePreflightPolicy(server, check.studentKey);
    const accessCodeRequired = accessCodePolicy.required;
    const accessCodeReady = accessCodePolicy.ready;
    const passing = check.storage.available && check.deviceSupported && eligible
      && !sessionConflict && accessCodeReady;
    const accessCodePolicyCopy = !accessCodePolicy.known
      ? 'The server did not report this publication’s access-code policy; starting is blocked until it does'
      : accessCodeRequired
        ? (accessCodeReady ? 'This publication requires a separate access code and one is ready for server verification' : 'This publication requires the separate access code; return and enter it')
        : 'This publication uses signed-in roster and admission checks without a separate access code';
    openDialog(`<div class="dd26-label">Student exam check</div><h2>Check before starting</h2><p>This check confirms that you are signed in, on the class list, and opening the correct exam. The official exam clock comes from Due Diligence.</p><ul class="dd26-check-list"><li class="${check.deviceSupported ? 'is-pass' : 'is-fail'}"><strong>Device</strong><span>${check.deviceSupported ? 'Desktop or tablet is ready' : 'This phone-size screen is not supported for a formal beta exam'}</span></li><li class="${check.storage.available ? 'is-pass' : 'is-fail'}"><strong>Answer saving</strong><span>${escapeHtml(check.storage.message || check.storage.code)}</span></li><li class="${check.persistent ? 'is-pass' : 'is-warn'}"><strong>Keep answers on this device</strong><span>${check.persistent ? 'Allowed by this browser' : 'The browser may remove local data; keep the exam page open'}</span></li><li class="is-pass"><strong>Connection</strong><span>Due Diligence responded in ${escapeHtml(check.reachabilityMs)} ms · official time ${escapeHtml(formatDate(server.serverNow || server.checks?.serverNow))}</span></li><li class="${eligible ? 'is-pass' : 'is-fail'}"><strong>Class list and entry</strong><span>${eligible ? 'This signed-in student may continue' : escapeHtml(server.message || 'This signed-in account cannot start this examination')}</span></li><li class="${accessCodeReady ? 'is-pass' : 'is-fail'}"><strong>Exam access code</strong><span>${escapeHtml(accessCodePolicyCopy)}</span></li><li class="${sessionConflict ? 'is-fail' : 'is-pass'}"><strong>Open exam session</strong><span>${sessionConflict ? 'Another open session must be resolved with the Beadle' : 'No other open session was found'}</span></li><li class="${integrity.recordingEnabled ? 'is-pass' : 'is-warn'}"><strong>Exam integrity</strong><span>${integrity.recordingEnabled ? `${integrity.clipboardBlocked ? 'Copy, cut, and paste are blocked. ' : 'Clipboard restrictions are off for an approved exam setup. '}Leaving the exam tab or window is recorded for the Professor to review. It is not automatic proof and does not automatically fail or lock the exam.` : 'Tab recording and clipboard restrictions are off for this exam or an approved accommodation.'}</span></li></ul><details open class="dd26-rules-summary"><summary>Instructions and exam rules</summary><p>${escapeHtml(server.instructions || 'Follow the Professor’s examination instructions.')}</p><dl><div><dt>Exam time</dt><dd>${escapeHtml(formatDate(server.opensAt))} to ${escapeHtml(formatDate(server.serverDeadline || server.hardClosesAt))}</dd></div><div><dt>Allowed materials</dt><dd>${escapeHtml(rules.allowedMaterials || 'See the Professor’s instructions')}</dd></div><div><dt>Questions</dt><dd>${escapeHtml(rules.navigationMode === 'one_way' ? 'Move forward only' : 'You may move between questions')}</dd></div><div><dt>Leaving the exam tab</dt><dd>${escapeHtml(integrity.recordingEnabled ? 'Recorded for Professor review' : 'Not recorded for this exam or accommodation')}</dd></div><div><dt>Full screen</dt><dd>${escapeHtml(rules.fullscreenPolicy === 'off' ? 'Not requested' : 'Requested when the exam starts')}</dd></div><div><dt>Entry</dt><dd>${escapeHtml(rules.admissionMode === 'beadle_approval' ? 'Beadle confirms entry' : 'Automatic after all checks pass')}</dd></div></dl></details><label class="dd26-choice"><input id="dd26-preflight-ack" type="checkbox" ${passing ? '' : 'disabled'}><span><strong>I reviewed the instructions and exam rules</strong><small>I understand that the exam is submitted only after Due Diligence shows a receipt.</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preflight-start" type="button" disabled>Start examination</button><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div><div class="dd26-privacy">No camera permission is requested.</div>`);
    if (sessionConflict && check.deviceInstanceHash) {
      document.querySelector('.dd26-rules-summary')?.insertAdjacentHTML('beforebegin', `<div class="dd26-notice"><strong>Controlled recovery reference for this device</strong><div class="dd26-secret-row"><code id="dd26-recovery-device-reference">${escapeHtml(check.deviceInstanceHash)}</code><button class="dd26-button" data-dd26-copy-secret="dd26-recovery-device-reference" type="button">Copy</button></div><small>Give this reference and the reported active epoch ${escapeHtml(server.activeEpoch || 'shown by the server')} to the Beadle only after in-person verification. It is not an access key.</small></div>`);
      bindSecretCopyButtons();
    }
    const acknowledgement = document.getElementById('dd26-preflight-ack');
    const start = document.getElementById('dd26-preflight-start');
    acknowledgement?.addEventListener('change', () => { start.disabled = !acknowledgement.checked; });
    start?.addEventListener('click', beginAttemptAfterPreflight);
  }

  async function beginAttemptAfterPreflight() {
    if (!isAuthenticated()) {
      state.exam.preflight = null;
      closeDialog();
      state.exam.portal = null;
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    const check = state.exam.preflight;
    if (!check || !document.getElementById('dd26-preflight-ack')?.checked) return;
    if (!accessCodePreflightPolicy(check.server, check.studentKey).ready) {
      global.toast?.('Starting is blocked because the publication access-code policy is missing or unsatisfied.', 'warn');
      return;
    }
    const button = document.getElementById('dd26-preflight-start');
    button.disabled = true; button.textContent = 'Starting…';
    try {
      const result = await command({ operation: 'start_attempt', examId: check.examId, studentKey: check.studentKey });
      const session = await command({
        operation: 'open_session', attemptId: result.attemptId,
        deviceInstanceHash: check.deviceInstanceHash,
        requestKey: randomKey('session_open'),
      });
      closeDialog();
      if (check.server?.rules?.fullscreenPolicy !== 'off' && !check.server?.accommodation?.fullscreenExempt) await requestFullscreen();
      await loadAttempt(result.attemptId, { ...session, publicationId: result.publicationId });
    } catch (error) {
      button.disabled = false; button.textContent = 'Start examination';
      global.toast?.(error.message, 'warn');
    }
  }

  async function loadAttempt(attemptId, sessionSeed = null) {
    let session = sessionSeed;
    let deviceInstanceHash = null;
    try {
      state.exam.store ||= global.DueDiligenceExaminationRoomStore?.createStore?.();
      const availability = await state.exam.store?.init?.();
      if (!availability?.available) throw new Error(availability?.message || 'IndexedDB is unavailable for this examination.');
      deviceInstanceHash = await state.exam.store.getDeviceInstanceHash();
      if (!session?.sessionId) {
        const retainedSession = await state.exam.store.getSessionEnvelope(attemptId, deviceInstanceHash);
        const retainedEpoch = Number(retainedSession?.sessionEpoch);
        if (retainedSession && Number.isInteger(retainedEpoch) && retainedEpoch > 0) {
          session = { ...retainedSession, epoch: retainedEpoch, restoredFromDevice: true };
        } else {
          if (retainedSession) await state.exam.store.clearSessionEnvelope(attemptId);
          session = await command({
            operation: 'open_session', attemptId,
            deviceInstanceHash,
            requestKey: randomKey('session_open'),
          });
        }
      }
      let payload;
      let recoveredOfflineBundle = false;
      try {
        payload = await api('/exam-room/query', {
          operation: 'attempt', attemptId,
          sessionId: session.sessionId,
          sessionEpoch: session.epoch,
        });
      } catch (error) {
        if (!session?.restoredFromDevice || !isTransientTransportFailure(error)) throw error;
        const retainedBundle = await state.exam.store.getAttemptBundle(attemptId);
        if (!retainedBundle?.bundle) throw error;
        payload = { result: retainedBundle.bundle };
        recoveredOfflineBundle = true;
        state.exam.offlineSince ||= new Date().toISOString();
      }
      state.exam.attempt = {
        ...payload.result,
        examVersionId: payload.result.examVersionId || payload.result.publicationId || session?.publicationId,
        sessionId: session.sessionId,
        sessionEpoch: session.epoch,
        answerSetHash: payload.result.answerSetHash || session.answerSetHash || null,
        offlineBundle: recoveredOfflineBundle,
        serverClockUnavailable: recoveredOfflineBundle,
      };
      if (!recoveredOfflineBundle) {
        await state.exam.store.saveAttemptBundle({
          examId: state.exam.attempt.examId,
          examVersionId: state.exam.attempt.examVersionId,
          attemptId: state.exam.attempt.attemptId,
          sessionEpoch: state.exam.attempt.sessionEpoch,
          bundle: payload.result,
        });
      }
      await state.exam.store.saveSessionEnvelope({
        examId: state.exam.attempt.examId,
        examVersionId: state.exam.attempt.examVersionId,
        attemptId: state.exam.attempt.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: state.exam.attempt.sessionEpoch,
        deviceInstanceHash,
        serverDeadline: state.exam.attempt.serverDeadline,
        answerSetHash: state.exam.attempt.answerSetHash,
      });
      if (!recoveredOfflineBundle) synchronizeServerClock(payload.result.serverNow);
      state.exam.attemptIndex = Math.min(state.exam.attemptIndex, Math.max(0, payload.result.questions.length - 1));
      state.exam.maxVisitedIndex = Math.max(state.exam.attemptIndex, Number(payload.result.navigationProgressIndex) || 0);
      await initializeAttemptPersistence();
      renderAttempt();
    } catch (error) {
      if (error.code === 'ATTEMPT_CLOSED') await loadSubmissionStatus(attemptId);
      else if (session?.restoredFromDevice
        && ['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE', 'EXAM_ROOM_V2_SESSION_REQUIRED'].includes(error.code)) {
        await state.exam.store?.quarantineAttemptQueue?.(session, error.code).catch(() => null);
        await state.exam.store?.clearSessionEnvelope?.(attemptId).catch(() => null);
        renderSubmissionRecoveryRequired('The retained writing session is no longer authoritative. Local work remains preserved for Beadle-assisted recovery.');
      }
      else global.toast?.(error.message, 'warn');
    }
  }

  function attemptScope(questionId = null) {
    const attempt = state.exam.attempt || {};
    if (!attempt.examId || !(attempt.examVersionId || attempt.publicationId) || !attempt.attemptId || attempt.sessionEpoch == null) {
      throw new Error('The server did not provide a complete immutable examination/session scope. Keep this page open and contact the Beadle.');
    }
    const scope = {
      examId: String(attempt.examId),
      examVersionId: String(attempt.examVersionId || attempt.publicationId),
      attemptId: String(attempt.attemptId),
      sessionEpoch: String(attempt.sessionEpoch),
    };
    if (questionId) scope.questionId = String(questionId);
    return scope;
  }

  async function initializeAttemptPersistence() {
    const attempt = state.exam.attempt;
    const storageApi = global.DueDiligenceExaminationRoomStore;
    if (!attempt || !storageApi) throw new Error('Secure local answer storage did not load. Keep this page open and contact the Beadle.');
    state.exam.store ||= storageApi.createStore();
    const availability = await state.exam.store.init();
    if (!availability.available) throw new Error(availability.message || 'IndexedDB is unavailable for this examination.');
    const localAnswers = await state.exam.store.getLatestAnswers(attemptScope());
    const localHistory = await state.exam.store.getAnswerHistory(attemptScope());
    let recovered = 0;
    for (const question of attempt.questions) {
      const pendingForQuestion = localHistory.filter((operation) => String(operation.questionId) === String(question.id) && operation.state === 'queued');
      question.nextExpectedRevision = Math.max(
        Number(question.revision) || 0,
        ...pendingForQuestion.map((operation) => (Number(operation.baseRevision) || 0) + 1),
      );
      question.lastLocalContent = question.answer;
    }
    for (const local of localAnswers) {
      const question = attempt.questions.find((entry) => String(entry.id) === String(local.questionId));
      if (!question || local.content === question.answer) continue;
      question.answer = local.content;
      question.localOperationId = local.operationId;
      question.lastLocalContent = local.content;
      question.localOnly = local.state !== 'server_acknowledged';
      recovered += 1;
    }
    attempt.recoveryAvailable = recovered > 0;
    attempt.unresolvedConflicts = (await state.exam.store.listConflicts(attemptScope()))
      .filter((conflict) => conflict.state === 'unresolved' && conflict.reason !== 'late_evidence_quarantined');
    if (attempt.unresolvedConflicts.length) attempt.recoveryAvailable = true;
    state.exam.tabLease?.stop?.();
    state.exam.tabLease = storageApi.createLeaseCoordinator({
      attemptId: attemptScope().attemptId,
      examVersionId: attemptScope().examVersionId,
      sessionEpoch: attemptScope().sessionEpoch,
      allowUncoordinatedWrite: false,
    });
    state.exam.tabLease.subscribe((lease) => {
      if (!state.exam.attempt) return;
      const changed = state.exam.attempt.readonlyTab !== lease.readonly;
      state.exam.attempt.readonlyTab = lease.readonly;
      if (changed) renderAttempt();
      if (lease.readonly) setSaveStatus('Another tab is active — this tab is read-only', 'error');
    });
    await state.exam.tabLease.start();
    global.removeEventListener('online', reconnectAttempt);
    global.removeEventListener('offline', disconnectAttempt);
    global.addEventListener('online', reconnectAttempt);
    global.addEventListener('offline', disconnectAttempt);
    flushSyncQueue();
  }

  function attentionReturnMarkup() {
    return '<div class="dd26-error dd26-attention-return" id="dd26-attention-return" role="alert"><strong>You returned to the examination.</strong> Leaving the exam tab or window was recorded for the Professor and Beadle. Your answers were not erased and the timer continued. This does not automatically fail or lock your examination.<div class="dd26-actions"><button class="dd26-button primary" id="dd26-continue-after-attention" type="button">Continue examination</button></div></div>';
  }

  function dismissAttentionReturnNotice() {
    if (state.exam.attempt) state.exam.attempt.attentionReturnNotice = false;
    document.getElementById('dd26-attention-return')?.remove();
    document.getElementById('dd26-attempt-answer')?.focus();
  }

  function bindAttentionReturnNotice() {
    const button = document.getElementById('dd26-continue-after-attention');
    if (!button || button.dataset.dd26AttentionBound === 'true') return;
    button.dataset.dd26AttentionBound = 'true';
    button.addEventListener('click', dismissAttentionReturnNotice, { once: true });
  }

  function showAttentionReturnNotice() {
    const attempt = state.exam.attempt;
    const surface = document.getElementById('dd26-attempt-surface');
    if (!attempt || !surface) return;
    attempt.attentionReturnNotice = true;
    if (!document.getElementById('dd26-attention-return')) {
      const top = surface.querySelector('.dd26-attempt-top');
      if (top) top.insertAdjacentHTML('afterend', attentionReturnMarkup());
      else surface.insertAdjacentHTML('afterbegin', attentionReturnMarkup());
    }
    bindAttentionReturnNotice();
    const message = 'Leaving the exam tab or window was recorded for review. Your answers were not erased and the timer continued.';
    announceExamStatus(message);
    global.toast?.(message, 'warn');
    if (document.getElementById('dd26-dialog')?.open !== true) {
      const continueButton = document.getElementById('dd26-continue-after-attention');
      continueButton?.scrollIntoView?.({ block: 'nearest' });
      continueButton?.focus();
    }
  }

  function renderAttempt() {
    const attempt = state.exam.attempt;
    const question = attempt?.questions?.[state.exam.attemptIndex];
    if (!attempt || !question) return;
    const mutable = attempt.status === 'in_progress' && !attempt.readonlyTab;
    const oneWay = attempt.rules?.navigationMode === 'one_way';
    const integrity = examIntegrityPolicy(attempt.rules || {}, attempt.accommodation || {});
    const fullscreenSignalsEnabled = integrity.recordingEnabled
      && attempt.rules?.fullscreenPolicy !== 'off'
      && !attempt.accommodation?.fullscreenExempt;
    document.body.classList.add('dd26-attempt-active');
    const answered = attempt.questions.filter((entry) => String(entry.answer || '').trim()).length;
    const flagged = attempt.questions.filter((entry) => entry.flagged).length;
    const unresolvedConflicts = attempt.unresolvedConflicts || [];
    const initialSaveState = attempt.recoveryAvailable
      ? 'Recovery available — local work restored on this device'
      : (question.localOnly ? 'Saved on this device' : question.savedAt ? `Synced at ${formatDate(question.savedAt)}` : 'Ready — changes save on this device first');
    const errataHtml = (attempt.errata || []).length
      ? `<section class="dd26-error" role="alert"><strong>Professor correction notice</strong><ul>${attempt.errata.map((entry) => `<li><strong>${escapeHtml(entry.type || 'clarification')}</strong> — ${escapeHtml(entry.body)} <small>Effective ${escapeHtml(formatDate(entry.effectiveAt || entry.issuedAt))}</small></li>`).join('')}</ul></section>`
      : '';
    const recoveryHtml = unresolvedConflicts.length
      ? `<div class="dd26-error" role="alert"><strong>${unresolvedConflicts.length} answer recovery decision${unresolvedConflicts.length === 1 ? '' : 's'} required.</strong> The local text shown here is not yet part of the server answer snapshot. Resolve it before submission.<div class="dd26-actions"><button class="dd26-button" id="dd26-resolve-conflicts" type="button">Resolve recovery</button></div></div>`
      : attempt.recoveryAvailable
        ? '<div class="dd26-notice" role="status">Local work from this examination was recovered on this device. Review it before submission; a new device can restore only server-synchronized work.</div>'
        : '';
    const offlineBundleNotice = attempt.offlineBundle
      ? '<div class="dd26-error" role="status"><strong>Offline recovery mode.</strong> This device restored the last authorized examination bundle and local answer journal. Server time is unavailable, so the browser will not decide the deadline or claim submission. Keep working here and reconnect as soon as possible.</div>'
      : '';
    const monitoringDisclosure = integrity.recordingEnabled
      ? integrity.clipboardBlocked
        ? `Examination safeguards are on. Copy, cut, and paste are blocked here. Leaving this tab or exam window${fullscreenSignalsEnabled ? ', or leaving full screen' : ''}, is recorded for the Professor and Beadle to review. Your answers remain saved, and no recorded event automatically fails, locks, submits, closes, or erases this examination.`
        : `Clipboard restrictions are off for your approved examination setup. Leaving this tab or exam window${fullscreenSignalsEnabled ? ', or leaving full screen' : ''}, is still recorded for the Professor and Beadle to review. No recorded event is automatic proof or an automatic failure.`
      : 'Tab recording and clipboard restrictions are off for this examination or approved accommodation. Connection and answer-saving problems may still be recorded so the school can help.';
    const attentionReturnHtml = attempt.attentionReturnNotice ? attentionReturnMarkup() : '';
    const navigatorHtml = attempt.questions.map((entry, index) => {
      const blockedByOneWay = oneWay && index !== state.exam.attemptIndex && index !== state.exam.attemptIndex + 1;
      return `<button type="button" data-dd26-attempt-question="${index}" class="${index === state.exam.attemptIndex ? 'is-active' : ''}${String(entry.answer || '').trim() ? ' is-saved' : ''}${entry.flagged ? ' is-flagged' : ''}" ${index === state.exam.attemptIndex ? 'aria-current="step"' : ''} ${blockedByOneWay ? 'disabled' : ''} aria-label="Question ${entry.ordinal}${String(entry.answer || '').trim() ? ', answered' : ', unanswered'}${entry.flagged ? ', flagged for review' : ''}${blockedByOneWay ? ', unavailable under one-way navigation' : ''}">${entry.ordinal}</button>`;
    }).join('');
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card dd26-attempt-workspace" id="dd26-attempt-surface" aria-labelledby="dd26-attempt-title"><div class="dd26-attempt-top"><div><div class="dd26-label" id="dd26-attempt-title">${escapeHtml(attempt.title)}</div><span class="dd26-save-state${mutable ? '' : ' is-error'}" id="dd26-save-state" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(mutable ? initialSaveState : 'Answer editing is unavailable; preserved work remains visible')}</span></div><div><div class="dd26-clock" id="dd26-attempt-clock" role="timer" aria-label="Time remaining">--:--:--</div><small class="dd26-clock-label">Official exam clock</small></div></div>${attentionReturnHtml}${offlineBundleNotice}${recoveryHtml}${attempt.readonlyTab ? '<div class="dd26-error" role="alert">Another tab holds the active writing lease. This tab is read-only to prevent conflicting edits.</div>' : ''}${mutable ? '' : '<div class="dd26-error" role="status">This attempt is not editable. You may review preserved answers, but no answer can change until an authorized recovery or reopen action.</div>'}${errataHtml}<details class="dd26-instructions"><summary>Examination instructions</summary><p>${escapeHtml(attempt.instructions || 'Follow the published instructions and permitted-materials policy.')}</p></details>${oneWay ? '<div class="dd26-notice"><strong>One-way navigation is enabled.</strong> After moving forward, earlier questions cannot be reopened in this workspace.</div>' : ''}<div class="dd26-integrity">${escapeHtml(monitoringDisclosure)}</div><div class="dd26-progress-summary"><span>${answered} of ${attempt.questions.length} answered</span><span>${flagged} flagged for review</span></div><div class="dd26-question-nav" aria-label="Question navigator">${navigatorHtml}</div><div class="dd26-question-meta"><span>Question ${question.ordinal} of ${attempt.questions.length}</span><span>${escapeHtml(question.maximumPoints)} points</span></div><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea dd26-essay-editor" id="dd26-attempt-answer" maxlength="20000" ${mutable ? '' : 'readonly aria-readonly="true"'}>${escapeHtml(question.answer)}</textarea><small class="dd26-counter"><span id="dd26-attempt-words">${String(question.answer || '').trim() ? String(question.answer).trim().split(/\s+/u).length : 0} words</span><span id="dd26-attempt-count">${codePointLength(question.answer).toLocaleString()} / 20,000 characters</span></small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-attempt-prev" type="button" ${oneWay || state.exam.attemptIndex === 0 ? 'disabled' : ''}>Previous</button><button class="dd26-button" id="dd26-attempt-next" type="button" ${state.exam.attemptIndex === attempt.questions.length - 1 ? 'disabled' : ''}>Next</button><button class="dd26-button ${question.flagged ? 'is-active' : ''}" id="dd26-attempt-flag" type="button" ${mutable ? '' : 'disabled'}>${question.flagged ? 'Remove review flag' : 'Flag for review'}</button><button class="dd26-button" id="dd26-attempt-leave" type="button" ${mutable ? '' : 'disabled'}>${attempt.activeLeave ? 'Return from temporary leave' : 'Temporary leave'}</button><button class="dd26-button" id="dd26-report-technical" type="button">Report technical issue</button><button class="dd26-button primary" id="dd26-attempt-submit" type="button" ${mutable ? '' : 'disabled'}>Review and submit</button></div>${attempt.activeLeave ? `<div class="dd26-notice">Temporary leave began ${escapeHtml(formatDate(attempt.activeLeave.departedAt))}. The examination timer continues. Return when ready; no automatic grading penalty is applied.</div>` : ''}</section>`;
    bindAttempt();
    startAttemptTimers();
  }

  function bindAttempt() {
    document.querySelectorAll('[data-dd26-attempt-question]').forEach((button) => button.addEventListener('click', () => navigateAttempt(Number(button.dataset.dd26AttemptQuestion))));
    document.getElementById('dd26-attempt-prev')?.addEventListener('click', () => navigateAttempt(state.exam.attemptIndex - 1));
    document.getElementById('dd26-attempt-next')?.addEventListener('click', () => navigateAttempt(state.exam.attemptIndex + 1));
    document.getElementById('dd26-attempt-submit')?.addEventListener('click', openSubmissionReview);
    document.getElementById('dd26-resolve-conflicts')?.addEventListener('click', openConflictRecovery);
    document.getElementById('dd26-attempt-flag')?.addEventListener('click', () => {
      const question = state.exam.attempt.questions[state.exam.attemptIndex];
      question.flagged = !question.flagged;
      renderAttempt();
    });
    document.getElementById('dd26-attempt-leave')?.addEventListener('click', toggleTemporaryLeave);
    document.getElementById('dd26-report-technical')?.addEventListener('click', reportTechnicalIssue);
    bindAttentionReturnNotice();
    const answer = document.getElementById('dd26-attempt-answer');
    if (state.exam.attempt.status === 'in_progress' && !state.exam.attempt.readonlyTab) answer?.addEventListener('input', () => {
      const question = state.exam.attempt.questions[state.exam.attemptIndex];
      question.answer = answer.value;
      document.getElementById('dd26-attempt-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 20,000 characters`;
      document.getElementById('dd26-attempt-words').textContent = `${answer.value.trim() ? answer.value.trim().split(/\s+/u).length : 0} words`;
      queueAnswerSave(question);
    });
    document.removeEventListener('visibilitychange', visibilityIncident);
    global.removeEventListener('blur', blurIncident);
    global.removeEventListener('focus', focusReturnIncident);
    document.removeEventListener('fullscreenchange', fullscreenIncident);
    document.removeEventListener('copy', clipboardIncident, true);
    document.removeEventListener('cut', clipboardIncident, true);
    document.removeEventListener('paste', clipboardIncident, true);
    const integrity = examIntegrityPolicy(state.exam.attempt.rules || {}, state.exam.attempt.accommodation || {});
    if (integrity.recordingEnabled && state.exam.attempt.status === 'in_progress') {
      document.addEventListener('visibilitychange', visibilityIncident);
      global.addEventListener('blur', blurIncident);
      global.addEventListener('focus', focusReturnIncident);
      if (state.exam.attempt.rules?.fullscreenPolicy !== 'off'
        && !state.exam.attempt.accommodation?.fullscreenExempt) {
        document.addEventListener('fullscreenchange', fullscreenIncident);
      }
    }
    if (integrity.clipboardBlocked && state.exam.attempt.status === 'in_progress') {
      document.addEventListener('copy', clipboardIncident, true);
      document.addEventListener('cut', clipboardIncident, true);
      document.addEventListener('paste', clipboardIncident, true);
    }
  }

  async function navigateAttempt(index) {
    const oneWay = state.exam.attempt?.rules?.navigationMode === 'one_way';
    if (oneWay && (index < state.exam.attemptIndex || index > state.exam.attemptIndex + 1)) {
      global.toast?.('Earlier or skipped questions are unavailable under the published one-way navigation policy.', 'warn');
      return;
    }
    const question = state.exam.attempt?.questions?.[state.exam.attemptIndex];
    if (question && !state.exam.attempt?.readonlyTab) await flushLocalAnswer(question);
    state.exam.attemptIndex = Math.max(0, Math.min(index, state.exam.attempt.questions.length - 1));
    state.exam.maxVisitedIndex = Math.max(state.exam.maxVisitedIndex, state.exam.attemptIndex);
    renderAttempt();
    document.getElementById('dd26-attempt-answer')?.focus();
  }

  function flushBeforeAttentionExit() {
    void flushAllLocalSaves().catch(() => {
      setSaveStatus('Save problem — keep this page open and contact the Beadle', 'error');
    });
  }

  function visibilityIncident() {
    if (!state.exam.attempt) return;
    if (document.hidden) {
      clearTimeout(state.exam.blurIncidentTimer);
      state.exam.blurIncidentTimer = null;
      state.exam.tabReturnPending = 'visibility';
      flushBeforeAttentionExit();
      recordIncident('visibility_exit', { visibilityState: document.visibilityState });
      return;
    }
    if (state.exam.tabReturnPending === 'visibility') {
      state.exam.tabReturnPending = false;
      showAttentionReturnNotice();
    }
  }

  function blurIncident() {
    if (!state.exam.attempt) return;
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = setTimeout(() => {
      if (document.hidden || document.hasFocus() || !state.exam.attempt) return;
      state.exam.tabReturnPending = 'focus';
      flushBeforeAttentionExit();
      recordIncident('focus_exit', { active: false });
    }, 150);
  }

  function focusReturnIncident() {
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = null;
    if (state.exam.tabReturnPending !== 'focus' || !state.exam.attempt) return;
    state.exam.tabReturnPending = false;
    showAttentionReturnNotice();
  }

  function clipboardIncident(event) {
    const attempt = state.exam.attempt;
    const surface = document.getElementById('dd26-attempt-surface');
    if (!attempt || attempt.status !== 'in_progress' || !surface
        || !examIntegrityPolicy(attempt.rules || {}, attempt.accommodation || {}).clipboardBlocked
        || !clipboardEventTouchesAttempt(event, surface)) return;
    event.preventDefault();
    const eventType = event.type === 'paste' ? 'paste_attempt' : 'copy_attempt';
    recordIncident(eventType, { action: event.type, blocked: true, surface: 'examination' });
    const now = Date.now();
    if (now - state.exam.lastIntegrityNoticeAt > 1200) {
      state.exam.lastIntegrityNoticeAt = now;
      const message = 'Copy, cut, and paste are blocked during this examination.';
      announceExamStatus(message);
      global.toast?.(message, 'warn');
    }
  }

  function fullscreenIncident() { if (state.exam.attempt && !document.fullscreenElement) recordIncident('fullscreen_exit', { fullscreen: false }); }

  async function recordIncident(eventType, details) {
    const attempt = state.exam.attempt;
    if (!attempt) return;
    if (['network_gap', 'heartbeat_gap'].includes(eventType)) {
      const mappedType = eventType === 'heartbeat_gap'
        ? 'sync_problem'
        : details?.state === 'reconnected' ? 'connectivity_restored' : 'connectivity_lost';
      await recordTechnicalIncident(mappedType, details);
      return;
    }
    if (attempt.rules?.integrityMode === 'off' || attempt.accommodation?.integrityExempt) return;
    try {
      await command({
        operation: 'record_integrity_event',
        attemptId: attempt.attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
        clientEventId: randomUuid(),
        eventType,
        details,
        clientOccurredAt: new Date().toISOString(),
      });
      if (['visibility_exit', 'focus_exit'].includes(eventType)) {
        attempt.attentionDepartureCount = Number(attempt.attentionDepartureCount || 0) + 1;
      }
      if (attempt.rules?.integrityMode === 'warn_and_record'
          && ['visibility_exit', 'focus_exit'].includes(eventType)
          && Number(attempt.attentionDepartureCount) === 2) {
        global.toast?.('Repeated browser attention changes were recorded for human review. They are signals, not proof.', 'warn');
      }
    } catch { /* incident transport failures are surfaced through heartbeat state */ }
  }

  async function recordTechnicalIncident(eventType, details = {}) {
    const attempt = state.exam.attempt;
    if (!attempt) return;
    try {
      await command({
        operation: 'record_technical_incident',
        attemptId: attempt.attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
        clientEventId: randomUuid(),
        eventType,
        details,
        clientOccurredAt: new Date().toISOString(),
      });
    } catch { /* technical reporting is non-authoritative and must not block answering */ }
  }

  async function reportTechnicalIssue() {
    const note = String(global.prompt('Briefly describe the technical issue. Do not include an answer, password, diagnosis, or other unnecessary personal data.', '') || '').trim();
    if (!note) return;
    if (note.length > 500) {
      global.toast?.('Keep the technical note to 500 characters or fewer.', 'warn');
      return;
    }
    await recordTechnicalIncident('support_requested', { note });
    global.toast?.('Technical issue recorded for the Beadle and Professor. Continue working if you safely can.', 'ok');
  }

  function queueAnswerSave(question) {
    setSaveStatus('Saving on this device…');
    clearTimeout(state.exam.saveTimers.get(question.id));
    state.exam.saveTimers.set(question.id, setTimeout(() => flushLocalAnswer(question), 350));
  }

  function setSaveStatus(message, tone = '') {
    const status = document.getElementById('dd26-save-state');
    if (!status) return;
    status.textContent = message;
    status.className = `dd26-save-state${tone === 'saved' ? ' is-saved' : tone === 'error' ? ' is-error' : ''}`;
  }

  async function flushLocalAnswer(question) {
    if (!question || !state.exam.store || state.exam.attempt?.readonlyTab) return null;
    clearTimeout(state.exam.saveTimers.get(question.id));
    state.exam.saveTimers.delete(question.id);
    if (question.lastLocalContent === question.answer) return question.localOperationId || null;
    try {
      const baseRevision = Number(question.nextExpectedRevision ?? question.revision) || 0;
      const saved = await state.exam.store.saveAnswer({
        ...attemptScope(question.id),
        content: question.answer,
        baseRevision,
        offlineSince: state.exam.offlineSince ? new Date(state.exam.offlineSince).getTime() : null,
        outageEvidence: state.exam.offlineSince ? { clientReportedOffline: true } : null,
      });
      question.localOperationId = saved.operation.operationId;
      question.localContentHash = saved.operation.contentHash;
      question.localSequence = saved.operation.localSequence;
      question.nextExpectedRevision = baseRevision + 1;
      question.lastLocalContent = question.answer;
      question.localOnly = true;
      setSaveStatus(global.navigator.onLine === false ? 'Offline — saved on this device' : 'Saved on this device', 'saved');
      flushSyncQueue();
      return saved.operation.operationId;
    } catch (error) {
      setSaveStatus('Save problem — keep this page open and contact the Beadle', 'error');
      global.toast?.(error.message, 'warn');
      throw error;
    }
  }

  async function flushAllLocalSaves() {
    const questions = state.exam.attempt?.questions || [];
    const results = await Promise.allSettled(questions.map((question) => flushLocalAnswer(question)));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) {
      throw new AggregateError(failures, 'One or more answers could not be preserved in IndexedDB. Keep this page open and contact the Beadle.');
    }
  }

  async function flushSyncQueue() {
    if (!state.exam.store || !state.exam.attempt) return;
    if (state.exam.syncing) {
      state.exam.syncRequested = true;
      return;
    }
    state.exam.syncing = true;
    state.exam.syncRequested = false;
    clearTimeout(state.exam.syncTimer);
    try {
      const scope = attemptScope();
      const pending = await state.exam.store.getPendingOperations({
        availableAt: Number.MAX_SAFE_INTEGER,
        limit: 250,
        attemptId: scope.attemptId,
        sessionEpoch: scope.sessionEpoch,
      });
      const relevant = pending
        .filter((operation) => operation.attemptId === scope.attemptId && operation.sessionEpoch === scope.sessionEpoch)
        .sort((left, right) => left.localSequence - right.localSequence);
      for (const operation of relevant) {
        if (Number(operation.nextAttemptAt) > Date.now()) {
          state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, Number(operation.nextAttemptAt) - Date.now()));
          break;
        }
        if (operation.kind === 'attempt.submit') {
          try { await sendPendingSubmission(operation); } catch { /* retained for bounded retry */ }
          break;
        }
        if (operation.kind !== 'answer.save') continue;
        setSaveStatus('Syncing…');
        try {
          const result = await command({
            operation: 'save_answer_operation',
            operationId: operation.operationId,
            examId: operation.examId,
            examVersionId: operation.examVersionId,
            attemptId: operation.attemptId,
            questionId: operation.questionId,
            sessionId: state.exam.attempt.sessionId,
            sessionEpoch: operation.sessionEpoch,
            localSequence: operation.localSequence,
            expectedRevision: operation.baseRevision,
            answerText: operation.content,
            contentHash: operation.contentHash,
            clientSavedAt: new Date(operation.clientSavedAt || operation.createdAt).toISOString(),
            offlineSince: operation.offlineSince == null ? null : new Date(operation.offlineSince).toISOString(),
            outageEvidence: operation.outageEvidence || {},
          });
          if (result.acceptedAsAnswer === false || result.disposition === 'late_evidence') {
            await state.exam.store.recordConflict({
              conflictId: result.conflictBranchId,
              operationId: operation.operationId,
              serverRevision: result.serverRevision,
              serverContentHash: result.serverContentHash,
              serverContent: result.serverAnswerText,
              reason: 'late_evidence_quarantined',
            });
            const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(operation.questionId));
            if (question) { question.localOnly = true; question.lateEvidence = true; }
            state.exam.attempt.answerSetHash = result.answerSetHash || state.exam.attempt.answerSetHash;
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.excludedLocalWork = true;
            setSaveStatus('Recovery available — a post-deadline local edit was preserved as evidence, not accepted as an answer', 'error');
            continue;
          }
          const revision = result.acceptedRevision ?? result.revision;
          await state.exam.store.acknowledgeOperation({ operationId: operation.operationId, serverRevision: revision, acknowledgedAt: Date.now() });
          const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(operation.questionId));
          if (question && question.localOperationId === operation.operationId) {
            question.revision = revision;
            question.nextExpectedRevision = Math.max(Number(question.nextExpectedRevision) || 0, Number(revision) || 0);
            question.savedAt = result.savedAt || result.acknowledgedAt || new Date().toISOString();
            question.localOnly = false;
          }
          state.exam.attempt.answerSetHash = result.answerSetHash || state.exam.attempt.answerSetHash;
          setSaveStatus(`Synced at ${formatDate(result.savedAt || result.acknowledgedAt || new Date().toISOString())}`, 'saved');
        } catch (error) {
          if (['ANSWER_CONFLICT', 'STALE_ANSWER', 'EXAM_ROOM_LOCAL_SEQUENCE_REUSED', 'LOCAL_SEQUENCE_REUSED'].includes(error.code)) {
            if (['EXAM_ROOM_LOCAL_SEQUENCE_REUSED', 'LOCAL_SEQUENCE_REUSED'].includes(error.code)) {
              try {
                const latest = await api('/exam-room/query', {
                  operation: 'attempt', attemptId: operation.attemptId,
                  sessionId: state.exam.attempt.sessionId,
                  sessionEpoch: operation.sessionEpoch,
                });
                const serverQuestion = latest.result?.questions?.find((entry) => String(entry.id) === String(operation.questionId));
                if (serverQuestion) {
                  error.serverRevision = serverQuestion.revision;
                  error.serverContentHash = serverQuestion.contentHash;
                  error.serverAnswerText = serverQuestion.answer;
                }
              } catch { /* retain the local branch even if the refresh also fails */ }
            }
            const conflict = await state.exam.store.recordConflict({
              conflictId: error.conflictBranchId,
              operationId: operation.operationId,
              serverRevision: error.serverRevision,
              serverContentHash: error.serverContentHash,
              serverContent: error.serverAnswerText,
              reason: error.code,
            });
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.unresolvedConflicts ||= [];
            if (!state.exam.attempt.unresolvedConflicts.some((entry) => entry.conflictId === conflict.conflictId)) {
              state.exam.attempt.unresolvedConflicts.push(conflict);
            }
            setSaveStatus('Recovery available — a newer server revision was preserved', 'error');
          } else if (['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE'].includes(error.code)) {
            await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
            await state.exam.store.clearSessionEnvelope(state.exam.attempt.attemptId);
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.status = 'recovery_pending';
            state.exam.attempt.readonlyTab = true;
            setSaveStatus('Recovery required — this session can no longer write', 'error');
            renderAttempt();
          } else if (['ATTEMPT_CLOSED', 'EXAM_ROOM_ATTEMPT_CLOSED'].includes(error.code)) {
            await state.exam.store.recordConflict({
              operationId: operation.operationId,
              serverRevision: error.serverRevision,
              serverContentHash: error.serverContentHash,
              serverContent: error.serverAnswerText,
              reason: 'attempt_closed_unaccepted',
            });
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.excludedLocalWork = true;
            await loadSubmissionStatus(operation.attemptId);
          } else {
            const retryOptions = { errorCode: error.code || 'network_error' };
            if (isTransientTransportFailure(error)) {
              const observedAt = Date.now();
              const localSavedAt = Number(operation.clientSavedAt || operation.createdAt || observedAt);
              state.exam.transportFailureSince ||= observedAt;
              state.exam.offlineSince ||= new Date(Math.min(localSavedAt, observedAt)).toISOString();
              retryOptions.offlineSince = Math.min(localSavedAt, observedAt);
              retryOptions.outageEvidence = {
                clientReportedTransportFailure: true,
                firstObservedAt: new Date(state.exam.transportFailureSince).toISOString(),
                lastObservedAt: new Date(observedAt).toISOString(),
              };
            }
            const retry = await state.exam.store.markOperationAttempt(operation.operationId, retryOptions);
            setSaveStatus(global.navigator.onLine === false ? 'Offline — saved on this device' : 'Reconnecting…');
            state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()));
          }
          break;
        }
      }
      if (state.exam.attempt && relevant.length === 250 && !state.exam.syncTimer) {
        state.exam.syncRequested = true;
      }
      if (state.exam.attempt && !state.exam.submissionPending) {
        const remaining = await state.exam.store.getPendingOperations({
          availableAt: Number.MAX_SAFE_INTEGER,
          limit: 1,
          attemptId: scope.attemptId,
          sessionEpoch: scope.sessionEpoch,
        });
        if (!remaining.some((operation) => operation.kind === 'answer.save')) {
          state.exam.offlineSince = null;
          state.exam.transportFailureSince = null;
        }
      }
    } finally {
      state.exam.syncing = false;
      if (state.exam.syncRequested) {
        state.exam.syncRequested = false;
        queueMicrotask(flushSyncQueue);
      }
    }
  }

  function disconnectAttempt() {
    if (!state.exam.attempt) return;
    state.exam.offlineSince ||= new Date().toISOString();
    setSaveStatus('Offline — saved on this device', 'saved');
    recordIncident('network_gap', { state: 'offline' });
  }

  function reconnectAttempt() {
    if (!state.exam.attempt) return;
    setSaveStatus('Reconnecting…');
    recordIncident('network_gap', { state: 'reconnected' });
    flushSyncQueue();
    sendHeartbeat();
  }

  function startAttemptTimers() {
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    clearTimeout(state.exam.submissionStatusTimer);
    updateAttemptClock();
    state.exam.countdownTimer = setInterval(updateAttemptClock, 1000);
    state.exam.heartbeatTimer = setInterval(sendHeartbeat, 60000);
  }

  function clearAttemptTimers() {
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    clearTimeout(state.exam.submissionStatusTimer);
    state.exam.countdownTimer = null;
    state.exam.heartbeatTimer = null;
    state.exam.submissionStatusTimer = null;
    document.removeEventListener('visibilitychange', visibilityIncident);
    global.removeEventListener('blur', blurIncident);
    global.removeEventListener('focus', focusReturnIncident);
    document.removeEventListener('fullscreenchange', fullscreenIncident);
    document.removeEventListener('copy', clipboardIncident, true);
    document.removeEventListener('cut', clipboardIncident, true);
    document.removeEventListener('paste', clipboardIncident, true);
    global.removeEventListener('online', reconnectAttempt);
    global.removeEventListener('offline', disconnectAttempt);
    document.body.classList.remove('dd26-attempt-active');
    state.exam.tabLease?.stop?.();
    state.exam.tabLease = null;
    clearTimeout(state.exam.syncTimer);
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = null;
    state.exam.tabReturnPending = false;
    state.exam.lastIntegrityNoticeAt = 0;
    if (state.exam.attempt) state.exam.attempt.attentionReturnNotice = false;
  }

  function updateAttemptClock() {
    const clock = document.getElementById('dd26-attempt-clock');
    if (!clock || !state.exam.attempt) return;
    if (state.exam.attempt.serverClockUnavailable) {
      clock.textContent = 'OFFLINE';
      clock.setAttribute('aria-label', 'Server countdown unavailable while offline');
      clock.classList.add('is-alert');
      const label = clock.nextElementSibling;
      if (label) label.textContent = 'Reconnect for server time';
      return;
    }
    const remaining = Math.max(0, new Date(state.exam.attempt.serverDeadline).getTime() - currentServerTimeMs());
    const seconds = Math.ceil(remaining / 1000);
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
    clock.textContent = [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
    clock.classList.toggle('is-alert', seconds <= 300);
    if (seconds === 0) {
      clearInterval(state.exam.countdownTimer);
      clearInterval(state.exam.heartbeatTimer);
      state.exam.countdownTimer = null;
      state.exam.heartbeatTimer = null;
      if (state.exam.attempt.status === 'in_progress') submitAttempt(true);
      else loadSubmissionStatus(state.exam.attempt.attemptId);
    }
  }

  async function sendHeartbeat() {
    try {
      const result = await command({
        operation: 'heartbeat_v2',
        attemptId: state.exam.attempt.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
      });
      if (result.serverNow) synchronizeServerClock(result.serverNow);
      state.exam.attempt.offlineBundle = false;
      state.exam.attempt.serverClockUnavailable = false;
      state.exam.attempt.serverDeadline = result.serverDeadline || state.exam.attempt.serverDeadline;
      if (result.status !== 'in_progress') await loadSubmissionStatus(state.exam.attempt.attemptId);
    } catch { recordIncident('heartbeat_gap', { durationSeconds: 60 }); }
  }

  async function toggleTemporaryLeave() {
    const attempt = state.exam.attempt;
    if (!attempt) return;
    if (attempt.readonlyTab || attempt.status !== 'in_progress') {
      global.toast?.('This tab is read-only. Use the active writing tab for leave controls.', 'warn');
      return;
    }
    try {
      if (attempt.activeLeave) {
        const result = await command({ operation: 'end_leave', attemptId: attempt.attemptId, sessionId: attempt.sessionId, sessionEpoch: attemptScope().sessionEpoch, requestKey: randomKey('leave_end') });
        attempt.activeLeave = null;
        global.toast?.(`Temporary leave ended after ${result.elapsedMinutes || 'the recorded'} minutes.`, 'ok');
      } else {
        const entered = String(global.prompt('Leave type: comfort_room, medical, technical, or other. Do not include diagnosis details.', 'comfort_room') || '').trim().toLowerCase();
        if (!['comfort_room', 'medical', 'technical', 'other'].includes(entered)) { global.toast?.('Choose a listed leave type.', 'warn'); return; }
        const result = await command({ operation: 'start_leave', attemptId: attempt.attemptId, sessionId: attempt.sessionId, sessionEpoch: attemptScope().sessionEpoch, reasonCode: entered, requestKey: randomKey('leave_start') });
        attempt.activeLeave = { id: result.leaveId, departedAt: result.departedAt || new Date().toISOString() };
        global.toast?.('Temporary leave recorded. The examination timer continues.', 'ok');
      }
      renderAttempt();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function unresolvedAnswerConflicts() {
    if (!state.exam.store || !state.exam.attempt) return [];
    const conflicts = await state.exam.store.listConflicts(attemptScope());
    const unresolved = conflicts.filter((conflict) => conflict.state === 'unresolved'
      && conflict.reason !== 'late_evidence_quarantined');
    state.exam.attempt.unresolvedConflicts = unresolved;
    return unresolved;
  }

  async function openConflictRecovery() {
    const conflicts = await unresolvedAnswerConflicts();
    if (!conflicts.length) {
      global.toast?.('No unresolved answer recovery remains.', 'ok');
      renderAttempt();
      return;
    }
    openDialog(`<div class="dd26-label">Answer recovery</div><h2>Choose which text to continue with</h2><div class="dd26-error" role="alert">These local answers are not yet part of the server snapshot. Submission is blocked until you resolve each branch. A new retry may still require Professor review if the server deadline has passed.</div>${conflicts.map((conflict) => { const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(conflict.localOperation?.questionId)); return `<section class="dd26-section"><h3>Question ${escapeHtml(question?.ordinal || conflict.localOperation?.questionId || '')}</h3><div class="dd26-form-grid"><div><div class="dd26-label">Preserved on this device</div><p class="dd26-long-cell">${escapeHtml(conflict.localOperation?.content || 'No local text')}</p></div><div><div class="dd26-label">Current server version</div><p class="dd26-long-cell">${escapeHtml(conflict.serverContent || 'No server text')}</p></div></div><div class="dd26-actions"><button class="dd26-button" data-dd26-conflict-server="${escapeHtml(conflict.conflictId)}" type="button">Use server version</button><button class="dd26-button primary" data-dd26-conflict-retry="${escapeHtml(conflict.conflictId)}" type="button">Retry my local version</button></div></section>`; }).join('')}<div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return without deciding</button></div>`, { persistent: true });
    document.querySelectorAll('[data-dd26-conflict-server]').forEach((button) => button.addEventListener('click', () => resolveAnswerConflict(button.dataset.dd26ConflictServer, 'accept_server')));
    document.querySelectorAll('[data-dd26-conflict-retry]').forEach((button) => button.addEventListener('click', () => resolveAnswerConflict(button.dataset.dd26ConflictRetry, 'retry_local')));
  }

  async function resolveAnswerConflict(conflictId, resolution) {
    const conflicts = await unresolvedAnswerConflicts();
    const conflict = conflicts.find((entry) => entry.conflictId === conflictId);
    if (!conflict) return;
    const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(conflict.localOperation?.questionId));
    if (!question) {
      global.toast?.('The conflicted question is not in this immutable examination version.', 'warn');
      return;
    }
    try {
      if (resolution === 'retry_local') {
        const content = String(conflict.localOperation?.content || '');
        const saved = await state.exam.store.saveAnswer({
          ...attemptScope(question.id),
          content,
          baseRevision: Number(conflict.serverRevision) || 0,
          offlineSince: state.exam.offlineSince ? new Date(state.exam.offlineSince).getTime() : null,
          outageEvidence: state.exam.offlineSince ? { clientReportedOffline: true } : null,
        });
        await state.exam.store.resolveConflict({ conflictId, resolution });
        question.answer = content;
        question.lastLocalContent = content;
        question.localOperationId = saved.operation.operationId;
        question.localContentHash = saved.operation.contentHash;
        question.localSequence = saved.operation.localSequence;
        question.revision = Number(conflict.serverRevision) || 0;
        question.nextExpectedRevision = (Number(conflict.serverRevision) || 0) + 1;
        question.localOnly = true;
        flushSyncQueue();
      } else {
        await state.exam.store.resolveConflict({ conflictId, resolution });
        question.answer = String(conflict.serverContent || '');
        question.lastLocalContent = question.answer;
        question.localOperationId = null;
        question.revision = Number(conflict.serverRevision) || 0;
        question.nextExpectedRevision = Number(conflict.serverRevision) || 0;
        question.localOnly = false;
      }
      const remaining = await unresolvedAnswerConflicts();
      if (remaining.length) await openConflictRecovery();
      else {
        state.exam.attempt.recoveryAvailable = Boolean(state.exam.attempt.excludedLocalWork);
        closeDialog();
        renderAttempt();
        global.toast?.('Answer recovery decision recorded.', 'ok');
      }
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openSubmissionReview() {
    try {
      if (state.exam.attempt?.readonlyTab || state.exam.attempt?.status !== 'in_progress') {
        global.toast?.('This tab is read-only and cannot submit the examination.', 'warn');
        return;
      }
      await flushAllLocalSaves();
      if ((await unresolvedAnswerConflicts()).length) {
        await openConflictRecovery();
        return;
      }
      const questions = state.exam.attempt?.questions || [];
      const unanswered = questions.filter((question) => !String(question.answer || '').trim());
      const flagged = questions.filter((question) => question.flagged);
      openDialog(`<div class="dd26-label">Final review</div><h2>Review before submission</h2><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${questions.length - unanswered.length}</strong><span>Answered</span></div><div class="dd26-stat"><strong>${unanswered.length}</strong><span>Unanswered</span></div><div class="dd26-stat"><strong>${flagged.length}</strong><span>Flagged</span></div><div class="dd26-stat"><strong>${questions.length}</strong><span>Total</span></div></div>${unanswered.length ? `<div class="dd26-error">Unanswered: ${unanswered.map((question) => question.ordinal).join(', ')}</div>` : '<div class="dd26-success">Every question has an answer on this device.</div>'}${flagged.length ? `<div class="dd26-notice">Flagged for review: ${flagged.map((question) => question.ordinal).join(', ')}</div>` : ''}<p>Due Diligence will first synchronize queued answer operations, then request one server receipt using the same stable submission key on every retry.</p><label class="dd26-choice"><input id="dd26-submit-ack" type="checkbox"><span><strong>I intend to submit this examination</strong><small>I understand that only a server receipt confirms submission. If offline, the intent remains pending and local work stays on this device.</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-submit" type="button" disabled>Submit and request receipt</button><button class="dd26-button" data-dd26-close-dialog type="button">Return to answers</button></div>`);
      const checkbox = document.getElementById('dd26-submit-ack');
      const submit = document.getElementById('dd26-confirm-submit');
      checkbox?.addEventListener('change', () => { submit.disabled = !checkbox.checked; });
      submit?.addEventListener('click', () => submitAttempt(false));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function submitAttempt(automatic = false) {
    try {
      if (!automatic && (state.exam.attempt?.readonlyTab || state.exam.attempt?.status !== 'in_progress')) {
        global.toast?.('This tab is read-only and cannot submit the examination.', 'warn');
        return;
      }
      await flushAllLocalSaves();
      const conflicts = await unresolvedAnswerConflicts();
      if (conflicts.length && !automatic) {
        await openConflictRecovery();
        return;
      }
      if (conflicts.length) state.exam.attempt.excludedLocalWork = true;
      const localAnswers = await state.exam.store.getLatestAnswers(attemptScope());
      const clientPendingAt = Date.now();
      const offlineSince = global.navigator.onLine === false
        ? Math.min(new Date(state.exam.offlineSince || clientPendingAt).getTime(), clientPendingAt)
        : null;
      const intentResult = await state.exam.store.ensureSubmissionIntent(attemptScope(), {
        intentId: state.exam.submissionKey || undefined,
        answerOperationIds: localAnswers.map((answer) => answer.operationId),
        clientPendingAt,
        offlineSince,
        outageEvidence: offlineSince == null ? null : { clientReportedOffline: true },
      });
      state.exam.submissionKey = intentResult.intent.intentId;
      state.exam.submissionPending = true;
      closeDialog();
      renderPendingSubmission(automatic);
      await flushSyncQueue();
    } catch (error) {
      closeDialog();
      if (state.exam.submissionKey) {
        state.exam.submissionPending = true;
        renderPendingSubmission(automatic, error.message);
      } else {
        state.exam.submissionPending = false;
        renderSubmissionPreparationFailure(automatic, error.message);
      }
    }
  }

  function renderSubmissionPreparationFailure(automatic = false, detail = '') {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">${automatic ? 'Deadline reached' : 'Submission preparation'}</div><h2>Submission was not prepared</h2><div class="dd26-error" role="alert"><strong>No server receipt or durable submission intent was created.</strong> One or more answers could not be confirmed in local IndexedDB. Keep this page open and do not clear browser data.</div>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-retry-preparation" type="button">Retry preservation and submission</button><button class="dd26-button" id="dd26-return-answers" type="button">Return to answers</button></div></section>`;
    document.getElementById('dd26-retry-preparation')?.addEventListener('click', () => submitAttempt(automatic));
    document.getElementById('dd26-return-answers')?.addEventListener('click', renderAttempt);
  }

  async function sendPendingSubmission(operation) {
    if (!state.exam.attempt || operation.attemptId !== attemptScope().attemptId) return;
    const allQueued = await state.exam.store.getPendingOperations({
      availableAt: Number.MAX_SAFE_INTEGER,
      limit: 250,
      attemptId: operation.attemptId,
      sessionEpoch: operation.sessionEpoch,
    });
    const unsyncedAnswers = allQueued.filter((entry) => entry.kind === 'answer.save'
      && entry.attemptId === operation.attemptId && entry.sessionEpoch === operation.sessionEpoch);
    if (unsyncedAnswers.length) {
      setSaveStatus('Syncing answers before submission…');
      const nextAttemptAt = Math.min(...unsyncedAnswers.map((entry) => Number(entry.nextAttemptAt) || Date.now() + 1000));
      state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, nextAttemptAt - Date.now()));
      return false;
    }
    if (!state.exam.attempt.answerSetHash) {
      renderPendingSubmission(false, 'Waiting for the server-authoritative answer-set hash.');
      state.exam.syncTimer = setTimeout(() => refreshAttemptHash(operation.attemptId), 1000);
      return false;
    }
    try {
      const result = await command({
        operation: 'submit_attempt_generation',
        attemptId: operation.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: operation.sessionEpoch,
        requestKey: operation.intentId,
        answerSetHash: state.exam.attempt.answerSetHash,
        clientPendingAt: new Date(operation.clientPendingAt || operation.createdAt).toISOString(),
        offlineSince: operation.offlineSince == null ? null : new Date(operation.offlineSince).toISOString(),
        outageEvidence: operation.outageEvidence || {},
      });
      const receipt = result.receipt || result;
      await state.exam.store.confirmSubmissionReceipt({
        intentId: operation.intentId,
        receiptId: receipt.receiptId || receipt.submissionId,
        receiptToken: receipt.receiptToken,
        submittedAt: new Date(receipt.receivedAt || receipt.submittedAt || Date.now()).getTime(),
      });
      state.exam.submissionPending = false;
      state.exam.offlineSince = null;
      showSubmissionReceipt(receipt);
    } catch (error) {
      if (error.code === 'ANSWER_SET_MISMATCH') {
        state.exam.attempt.answerSetHash = null;
        const retry = await state.exam.store.markOperationAttempt(operation.operationId, { errorCode: error.code });
        state.exam.submissionPending = true;
        renderPendingSubmission(false, examCodeMessage(error.code));
        state.exam.syncTimer = setTimeout(
          () => refreshAttemptHash(operation.attemptId),
          Math.max(500, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()),
        );
        return false;
      }
      if (['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE', 'EXAM_ROOM_V2_SESSION_REQUIRED'].includes(error.code)) {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        await state.exam.store.clearSessionEnvelope(state.exam.attempt.attemptId);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.status = 'recovery_pending';
        state.exam.attempt.readonlyTab = true;
        renderSubmissionRecoveryRequired('This writing session is no longer authoritative. Local work was retained for recovery; the Beadle must verify the candidate before an authorized session transfer.');
        return false;
      }
      if (['ATTEMPT_CLOSED', 'EXAM_ROOM_ATTEMPT_CLOSED'].includes(error.code)) {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.excludedLocalWork = true;
        await loadSubmissionStatus(operation.attemptId);
        return false;
      }
      if (error.code === 'EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT') {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.status = 'recovery_pending';
        state.exam.attempt.readonlyTab = true;
        renderSubmissionRecoveryRequired('The stable submission key was previously used with different content. No retry is safe. Local work was retained; contact the Professor or Beadle for an audited review.');
        return false;
      }
      const retryOptions = { errorCode: error.code || 'submission_transport_error' };
      if (isTransientTransportFailure(error)) {
        const observedAt = Date.now();
        const intentCreatedAt = Number(operation.createdAt || operation.clientPendingAt || observedAt);
        state.exam.transportFailureSince ||= observedAt;
        state.exam.offlineSince ||= new Date(Math.min(intentCreatedAt, observedAt)).toISOString();
        retryOptions.offlineSince = Math.min(intentCreatedAt, observedAt);
        retryOptions.outageEvidence = {
          clientReportedTransportFailure: true,
          firstObservedAt: new Date(state.exam.transportFailureSince).toISOString(),
          lastObservedAt: new Date(observedAt).toISOString(),
        };
      }
      const retry = await state.exam.store.markOperationAttempt(operation.operationId, retryOptions);
      state.exam.submissionPending = true;
      renderPendingSubmission(false, error.message);
      state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(500, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()));
      throw error;
    }
  }

  function renderSubmissionRecoveryRequired(detail) {
    clearAttemptTimers();
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">Submission recovery</div><h2>Operator review required</h2><div class="dd26-error" role="alert"><strong>No new server receipt was issued.</strong> ${escapeHtml(detail)}</div><p>Do not clear browser data. A new device can restore only server-synchronized work; this device retains a bounded recovery copy for review.</p><div class="dd26-actions"><button class="dd26-button" id="dd26-return-recovery-portal" type="button">Return to Examination Room</button></div></section>`;
    document.getElementById('dd26-return-recovery-portal')?.addEventListener('click', () => refreshExamPortal('student'));
  }

  async function refreshAttemptHash(attemptId) {
    try {
      const attempt = state.exam.attempt;
      if (!attempt || attempt.attemptId !== attemptId) return;
      const payload = await api('/exam-room/query', {
        operation: 'attempt', attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
      });
      state.exam.attempt.answerSetHash = payload.result?.answerSetHash || state.exam.attempt.answerSetHash;
      flushSyncQueue();
    } catch { state.exam.syncTimer = setTimeout(() => refreshAttemptHash(attemptId), 2000); }
  }

  function renderPendingSubmission(automatic = false, detail = '') {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">${automatic ? 'Deadline reached' : 'Final submission'}</div><h2>Submission pending — not yet received by Due Diligence</h2><div class="dd26-notice" role="status">Your submission intent and latest local answer journal remain on this device. Keep this page open and reconnect. Do not treat this screen as a receipt.</div>${detail ? `<div class="dd26-error">${escapeHtml(detail)}</div>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-retry-submission" type="button">Retry synchronization</button></div><p class="dd26-privacy">A late server receipt is evaluated under the professor’s configured grace/review policy with outage evidence; the device clock is not authoritative.</p></section>`;
    document.getElementById('dd26-retry-submission')?.addEventListener('click', () => {
      setSaveStatus('Reconnecting…');
      flushSyncQueue();
    });
  }

  async function loadSubmissionStatus(attemptId, pollCount = 0) {
    try {
      clearTimeout(state.exam.submissionStatusTimer);
      state.exam.submissionStatusTimer = null;
      const payload = await api('/exam-room/query', { operation: 'submission_status', attemptId });
      const status = payload.result;
      if (status?.ok !== true) throw new Error(examCodeMessage(status?.code));
      if (status.receiptId && status.receivedAt && isClosedAttemptStatus(status.status)) {
        try {
          state.exam.store ||= global.DueDiligenceExaminationRoomStore?.createStore?.();
          const availability = await state.exam.store?.init?.();
          if (availability?.available) {
            await state.exam.store.reconcileServerReceipt({
              attemptId: status.attemptId || attemptId,
              examId: status.examId,
              examVersionId: status.examVersionId,
              receiptId: status.receiptId,
              receivedAt: status.receivedAt,
              submittedAt: status.submittedAt,
              snapshotHash: status.snapshotHash,
            });
            await state.exam.store.cleanupConfirmed();
          }
        } catch (localError) {
          status.localRetentionWarning = 'The server receipt is valid, but this browser could not schedule its local recovery-data cleanup. Do not clear data needed for a dispute; retry from this device later.';
          console.warn('Examination Room receipt reconciliation failed.', localError);
        }
        showSubmissionReceipt(status);
        return;
      }
      clearAttemptTimers();
      const host = document.getElementById('dd26-exam-main');
      if (!host) return;
      host.innerHTML = `<section class="dd26-card"><div class="dd26-label">Server finalization</div><h2>Deadline reached — server receipt pending</h2><div class="dd26-notice" role="status">The server has not issued a receipt yet. This is not a “Submitted” confirmation. Due Diligence will check again without asking the browser clock to decide the result.</div><dl class="dd26-publish-summary"><div><dt>Attempt</dt><dd>${escapeHtml(status.attemptId || attemptId)}</dd></div><div><dt>Current server state</dt><dd>${escapeHtml(status.status || 'processing')}</dd></div><div><dt>Last checked</dt><dd>${escapeHtml(formatDate(status.serverNow))}</dd></div></dl><div class="dd26-actions"><button class="dd26-button primary" id="dd26-refresh-submission-status" type="button">Check for receipt</button><button class="dd26-button" id="dd26-return-status-portal" type="button">Return to Examination Room</button></div></section>`;
      document.getElementById('dd26-refresh-submission-status')?.addEventListener('click', () => loadSubmissionStatus(attemptId, 0));
      document.getElementById('dd26-return-status-portal')?.addEventListener('click', () => refreshExamPortal('student'));
      if (pollCount < 20) {
        state.exam.submissionStatusTimer = setTimeout(() => loadSubmissionStatus(attemptId, pollCount + 1), 3000);
      }
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function showSubmissionReceipt(receipt) {
    clearAttemptTimers();
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    const activeAttempt = state.exam.attempt;
    const recoveryEvidenceCount = Number(receipt.lateRecoveryEvidenceCount) || 0;
    const excludedLocalWork = activeAttempt?.excludedLocalWork === true || recoveryEvidenceCount > 0;
    const examVersionId = receipt.examVersionId || activeAttempt?.examVersionId || activeAttempt?.publicationId || 'Recorded in server receipt';
    const receiptAttemptId = receipt.attemptId || activeAttempt?.attemptId || 'Recorded in server receipt';
    if (receiptAttemptId && receiptAttemptId !== 'Recorded in server receipt') {
      state.exam.store?.clearSessionEnvelope?.(receiptAttemptId).catch(() => null);
    }
    host.innerHTML = `<section class="dd26-card"><div class="dd26-success" role="status"><strong>Submission received by Due Diligence.</strong> This receipt—not the earlier pending screen—confirms delivery.</div>${excludedLocalWork ? `<div class="dd26-error" role="alert"><strong>A saved answer needs review.</strong> ${recoveryEvidenceCount || 'At least one'} local edit${recoveryEvidenceCount === 1 ? '' : 's'} was kept separately and was not included in the answers confirmed by this receipt. Contact the Professor or Beadle and give them this receipt number.</div>` : ''}<div class="dd26-receipt"><div class="dd26-label">Submission receipt</div><h2>${escapeHtml(receipt.receiptId || receipt.submissionId || 'Receipt recorded')}</h2><dl><div><dt>Examination</dt><dd>${escapeHtml(examVersionId)}</dd></div><div><dt>Due Diligence exam record</dt><dd>${escapeHtml(receiptAttemptId)}</dd></div><div><dt>Received by Due Diligence</dt><dd>${escapeHtml(formatDate(receipt.receivedAt || receipt.submittedAt))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(receipt.status || 'received')}</dd></div><div><dt>Confirmation number</dt><dd><code>${escapeHtml(receipt.answerSnapshotHash || receipt.snapshotHash || 'Recorded in this receipt')}</code></dd></div><div><dt>Connection and exam review</dt><dd>${escapeHtml(receipt.incidentReviewStatus || (excludedLocalWork ? 'A saved answer is waiting for review' : 'No record automatically determines misconduct'))}</dd></div></dl></div><div class="dd26-actions"><button class="dd26-button" id="dd26-return-portal" type="button">Return to Examination Room</button></div><p class="dd26-privacy">Local work remains for a short recovery period after this confirmed receipt; storage on this browser is not permanent.</p></section>`;
    if (receipt.localRetentionWarning) {
      const localRetentionNotice = document.createElement('div');
      localRetentionNotice.className = 'dd26-notice';
      localRetentionNotice.setAttribute('role', 'status');
      localRetentionNotice.textContent = receipt.localRetentionWarning;
      host.querySelector('.dd26-success')?.insertAdjacentElement('afterend', localRetentionNotice);
    }
    const retentionNotice = host.querySelector('.dd26-privacy');
    if (retentionNotice) retentionNotice.textContent = 'Confirmed local recovery data is retained for up to seven days and removed on a later Examination Room open; browser-local storage is not permanent.';
    state.exam.attempt = null;
    document.getElementById('dd26-return-portal')?.addEventListener('click', () => refreshExamPortal('student'));
  }

  async function loadStudentResult(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'student_result', examId });
      const result = payload.result;
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-label">Released result</div><h2>${escapeHtml(result.title)}</h2><p>Student exam number ${escapeHtml(result.candidateNumber)} · Released ${escapeHtml(formatDate(result.releasedAt))}</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Question</th>${result.includeQuestionnaire ? '<th>Questionnaire</th>' : ''}<th>Score</th><th>Professor comment</th></tr></thead><tbody>${(result.grades || []).map((grade) => `<tr><td>${grade.ordinal}</td>${result.includeQuestionnaire ? `<td>${escapeHtml(grade.question)}</td>` : ''}<td>${escapeHtml(grade.score)} / ${escapeHtml(grade.maximumPoints)}</td><td>${escapeHtml(grade.comment)}</td></tr>`).join('')}</tbody></table></div></section>`;
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openLiveStatus(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Exam status</div><h2>See student progress</h2><p>This page shows who is answering, who has submitted, and who may need help. Student answers remain hidden until grading opens after the exam has ended for everyone.</p><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-monitor-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-monitor" type="button">Open exam status</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-load-monitor')?.addEventListener('click', loadLiveStatus);
  }

  async function loadLiveStatus() {
    const keyInput = document.getElementById('dd26-monitor-key')
      || document.getElementById('dd26-monitor-refresh-key');
    const gradingKey = String(keyInput?.value || '');
    if (!gradingKey) {
      global.toast?.('Enter the Professor grading key for this exact status request.', 'warn');
      return;
    }
    keyInput.value = '';
    try {
      const payload = await api('/exam-room/query', {
        operation: 'live_status_v2', examId: state.exam.activeExamId, gradingKey,
      });
      const candidates = (payload.result?.candidates || []).map((candidate) => {
        return {
          ...candidate,
          status: candidate.state || candidate.status,
          canReopenSubmission: candidate.canReopenSubmission === true,
          reopenBlockedReason: candidate.reopenBlockedReason || 'REOPEN_ELIGIBILITY_UNAVAILABLE',
          priorReceiptId: candidate.priorReceiptId || candidate.latestReceiptId,
        };
      });
      state.exam.monitoring = { ...payload.result, candidates };
      closeDialog();
      renderLiveStatus();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderLiveStatus() {
    const monitor = state.exam.monitoring;
    const host = document.getElementById('dd26-exam-main');
    if (!host || !monitor) return;
    const candidates = monitor.candidates || [];
    const candidateRows = candidates.map((candidate) => {
      const closed = ['submitted', 'auto_submitted'].includes(candidate.status);
      const reopenAction = candidate.canReopenSubmission === true && candidate.attemptId
        ? `<button class="dd26-button danger" data-dd26-reopen-submission="${escapeHtml(candidate.attemptId)}" type="button">Allow another submission</button>`
        : closed
          ? `<button class="dd26-button" type="button" disabled title="${escapeHtml(candidate.reopenBlockedReason || 'Due Diligence did not allow another submission for this student.')}">Another submission unavailable</button>`
          : '';
      const unlockAction = candidate.status === 'locked'
        ? `<button class="dd26-button danger" data-dd26-unlock-live="${escapeHtml(candidate.attemptId)}" type="button">Unlock</button>`
        : '';
      return `<tr><td>${escapeHtml(candidate.candidateNumber)}<br><small>Submission round ${escapeHtml(candidate.generation || 1)}</small></td><td>${escapeHtml(candidate.status)}</td><td>${escapeHtml(candidate.incidentCount || 0)}</td><td>${escapeHtml(formatDate(candidate.serverDeadline))}</td><td>${escapeHtml(formatDate(candidate.lastHeartbeatAt))}</td><td><div class="dd26-actions">${unlockAction}${reopenAction}${!unlockAction && !reopenAction ? '—' : ''}</div></td></tr>`;
    }).join('');
    host.innerHTML = `<section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Exam status</div><h2>${escapeHtml(monitor.title)}</h2></div><span class="dd26-status">${escapeHtml(monitor.status)}</span></div><p>This page shows student progress, connection status, and events that may need review. Answers remain private until grading opens.</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Exam status</th><th>For review</th><th>Exam ends</th><th>Last connection</th><th>Action</th></tr></thead><tbody>${candidateRows || '<tr><td colspan="6">No student has started this examination.</td></tr>'}</tbody></table></div><label class="dd26-field"><span>Professor grading key to refresh</span><input class="dd26-input" id="dd26-monitor-refresh-key" type="password" autocomplete="one-time-code"><small class="dd26-help">Used only for this refresh and then cleared.</small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-refresh-monitor" type="button">Refresh status</button><button class="dd26-button" id="dd26-return-professor" type="button">Return to Professor workspace</button></div></section>`;
    document.getElementById('dd26-refresh-monitor')?.addEventListener('click', loadLiveStatus);
    document.getElementById('dd26-return-professor')?.addEventListener('click', () => refreshExamPortal('professor'));
    document.querySelectorAll('[data-dd26-unlock-live]').forEach((button) => button.addEventListener('click', () => openUnlockMonitoredAttempt(button.dataset.dd26UnlockLive)));
    document.querySelectorAll('[data-dd26-reopen-submission]').forEach((button) => button.addEventListener('click', () => openReopenSubmission(button.dataset.dd26ReopenSubmission)));
  }

  function openReopenSubmission(attemptId) {
    const candidate = (state.exam.monitoring?.candidates || [])
      .find((entry) => entry.attemptId === attemptId);
    if (!candidate || candidate.canReopenSubmission !== true) {
      global.toast?.('Due Diligence did not allow another submission for this student.', 'warn');
      return;
    }
    const now = new Date();
    const defaultDeadline = new Date(now.getTime() + 60 * 60 * 1000);
    openDialog(`<div class="dd26-label">Special action for one student</div><h2>Allow another submission</h2><div class="dd26-error" role="alert"><strong>The first submission is never opened or replaced.</strong> Its receipt and submitted answers remain saved. This gives the student one new answer session and a new deadline.</div><dl class="dd26-publish-summary"><div><dt>Student</dt><dd>${escapeHtml(candidate.candidateNumber)}</dd></div><div><dt>Current submission round</dt><dd>${escapeHtml(candidate.generation || 1)}</dd></div><div><dt>First receipt</dt><dd>${escapeHtml(candidate.priorReceiptId || candidate.receiptId || 'Saved by Due Diligence')}</dd></div></dl><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-reopen-grading-key" type="password" autocomplete="one-time-code" required><small class="dd26-help">Used only for this request and then cleared.</small></label><label class="dd26-field"><span>New deadline (maximum four hours from now)</span><input class="dd26-input" id="dd26-reopen-deadline" type="datetime-local" min="${localDateValue(now)}" max="${localDateValue(new Date(now.getTime() + 4 * 60 * 60 * 1000))}" value="${localDateValue(defaultDeadline)}" required></label><label class="dd26-field"><span>Reason</span><textarea class="dd26-textarea compact" id="dd26-reopen-reason" minlength="20" maxlength="1000" required></textarea></label><label class="dd26-choice"><input id="dd26-reopen-ack" type="checkbox"><span><strong>I authorize one new answer session for this student only</strong><small>The first submission and receipt remain saved. Due Diligence will reject a deadline more than four hours from now.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-reopen" type="button" disabled>Allow another submission</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const acknowledgement = document.getElementById('dd26-reopen-ack');
    const confirmButton = document.getElementById('dd26-confirm-reopen');
    const updateState = () => {
      const deadline = new Date(value('dd26-reopen-deadline'));
      const deadlineMs = deadline.getTime();
      const currentMs = Date.now();
      confirmButton.disabled = !acknowledgement.checked
        || !value('dd26-reopen-grading-key', false)
        || value('dd26-reopen-reason').length < 20
        || !Number.isFinite(deadlineMs)
        || deadlineMs <= currentMs
        || deadlineMs > currentMs + (4 * 60 * 60 * 1000);
    };
    acknowledgement?.addEventListener('change', updateState);
    document.getElementById('dd26-reopen-reason')?.addEventListener('input', updateState);
    document.getElementById('dd26-reopen-grading-key')?.addEventListener('input', updateState);
    document.getElementById('dd26-reopen-deadline')?.addEventListener('input', updateState);
    confirmButton?.addEventListener('click', () => reopenSubmission(attemptId));
  }

  async function reopenSubmission(attemptId) {
    const button = document.getElementById('dd26-confirm-reopen');
    if (!button || !document.getElementById('dd26-reopen-ack')?.checked) return;
    const reason = value('dd26-reopen-reason');
    const gradingKeyInput = document.getElementById('dd26-reopen-grading-key');
    const gradingKey = String(gradingKeyInput?.value || '');
    const newDeadline = new Date(value('dd26-reopen-deadline'));
    if (!gradingKey || reason.length < 20 || !Number.isFinite(newDeadline.getTime())) return;
    gradingKeyInput.value = '';
    button.disabled = true;
    button.textContent = 'Creating generation…';
    try {
      const result = await command({
        operation: 'reopen_submission', attemptId,
        newDeadline: newDeadline.toISOString(), reason,
        gradingKey,
        requestKey: randomKey('reopen_submission'),
      });
      if (result?.ok !== true || result.attemptId !== attemptId
          || result.requiresNewSession !== true
          || !(Number(result.generation) > Number(result.priorGeneration))
          || !result.priorReceiptId || !result.priorSnapshotHash) {
        throw new Error('The server did not confirm complete linked-generation lineage.');
      }
      try {
        const payload = await api('/exam-room/query', {
          operation: 'live_status_v2', examId: state.exam.activeExamId, gradingKey,
        });
        state.exam.monitoring = {
          ...payload.result,
          candidates: (payload.result?.candidates || []).map((candidate) => ({
            ...candidate,
            status: candidate.state || candidate.status,
            canReopenSubmission: candidate.canReopenSubmission === true,
            reopenBlockedReason: candidate.reopenBlockedReason || 'REOPEN_ELIGIBILITY_UNAVAILABLE',
            priorReceiptId: candidate.priorReceiptId || candidate.latestReceiptId,
          })),
        };
      } catch { /* reopen succeeded; a later explicit keyed refresh will reconcile the monitor */ }
      openDialog(`<div class="dd26-label">Another submission allowed</div><h2>A new answer session is ready</h2><div class="dd26-success"><strong>Submission round ${escapeHtml(result.generation)} is open until ${escapeHtml(formatDate(result.serverDeadline || result.expiresAt))}.</strong></div><p>The first submission round ${escapeHtml(result.priorGeneration)}, receipt <code>${escapeHtml(result.priorReceiptId)}</code>, and confirmation number <code>${escapeHtml(result.priorSnapshotHash)}</code> remain saved. The student must sign in with the same class-list account and start a new exam session. The old session remains closed.</p><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">Return to exam status</button></div>`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Allow another submission';
      global.toast?.(`No generation was opened. ${error.message}`, 'warn');
    }
  }

  function openUnlockMonitoredAttempt(attemptId) {
    openDialog(`<div class="dd26-label">Candidate-scoped recovery</div><h2>Unlock this preserved attempt</h2><p>This legacy recovery action is separate from reopening a submitted generation. It never replaces an immutable submission receipt.</p><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-unlock-grading-key" type="password" autocomplete="one-time-code" required></label><label class="dd26-field"><span>Required reason</span><textarea class="dd26-textarea compact" id="dd26-unlock-reason" minlength="10" maxlength="1000" required></textarea></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-unlock" type="button">Unlock exact attempt</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-confirm-unlock')?.addEventListener('click', () => unlockMonitoredAttempt(attemptId));
  }

  async function unlockMonitoredAttempt(attemptId) {
    const gradingKeyInput = document.getElementById('dd26-unlock-grading-key');
    const gradingKey = String(gradingKeyInput?.value || '');
    const reason = value('dd26-unlock-reason');
    if (!gradingKey || reason.length < 10) {
      global.toast?.('Enter the grading key and a reason of at least 10 characters.', 'warn');
      return;
    }
    gradingKeyInput.value = '';
    try {
      await command({
        operation: 'unlock_attempt', attemptId, reason,
        gradingKey,
      });
      global.toast?.('Attempt unlocked with an audit record.', 'ok');
      const candidate = (state.exam.monitoring?.candidates || [])
        .find((entry) => entry.attemptId === attemptId);
      if (candidate) candidate.status = 'active';
      closeDialog();
      renderLiveStatus();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openGrading(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Professor grading</div><h2>Open grading workspace</h2><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-grading-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-grading" type="button">Open after the exam ends</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-load-grading')?.addEventListener('click', loadGrading);
  }

  async function loadGrading() {
    const gradingKey = value('dd26-grading-key', false);
    try {
      const payload = await api('/exam-room/query', { operation: 'grading_workspace', examId: state.exam.activeExamId, gradingKey });
      state.exam.grading = { ...payload.result, gradingKey };
      state.exam.gradingModelAnswer = null;
      state.exam.gradingCandidate = 0;
      state.exam.gradingQuestion = 0;
      closeDialog();
      renderGrading();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderGrading() {
    const grading = state.exam.grading;
    const candidate = grading?.candidates?.[state.exam.gradingCandidate];
    const question = candidate?.questions?.[state.exam.gradingQuestion];
    if (!candidate || !question) {
      document.getElementById('dd26-exam-main').innerHTML = '<section class="dd26-card"><div class="dd26-empty">No student submissions are available for grading.</div></section>';
      return;
    }
    const allQuestions = grading.candidates.flatMap((entry) => entry.questions || []);
    const finalCount = allQuestions.filter((entry) => entry.gradeState === 'final').length;
    const modelAnswer = state.exam.gradingModelAnswer;
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-label">Professor grading / ${escapeHtml(grading.title)}</div><div class="dd26-question-meta"><span>Student ${escapeHtml(candidate.candidateNumber)}</span><span>Question ${question.ordinal} of ${grading.questionCount}</span></div><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><section class="dd26-section"><h3>Student answer</h3><p>${escapeHtml(question.answer || 'No answer submitted.')}</p></section><div class="dd26-form-grid"><label class="dd26-field"><span>Score / ${escapeHtml(question.maximumPoints)}</span><input class="dd26-input" id="dd26-grade-score" type="number" min="0" max="${escapeHtml(question.maximumPoints)}" step="0.1" value="${escapeHtml(question.score ?? '')}"></label><label class="dd26-field"><span>Grade status</span><select class="dd26-select" id="dd26-grade-state"><option value="draft" ${question.gradeState === 'draft' ? 'selected' : ''}>Draft</option><option value="final" ${question.gradeState === 'final' ? 'selected' : ''}>Final</option></select></label><label class="dd26-field wide"><span>Professor comment</span><textarea class="dd26-textarea" id="dd26-grade-comment" maxlength="5000">${escapeHtml(question.comment || '')}</textarea></label><label class="dd26-field wide"><span>Reason for this grade</span><input class="dd26-input" id="dd26-grade-reason" value="Initial Professor assessment"></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-save-grade" type="button">Save grade</button><button class="dd26-button" id="dd26-next-ungraded" type="button">Next question</button>${candidate.status === 'locked' ? '<button class="dd26-button danger" id="dd26-unlock-attempt" type="button">Review access</button>' : ''}<button class="dd26-button" id="dd26-release-results" type="button">Release class results</button></div></section>`;
    document.querySelector('#dd26-exam-main > .dd26-card')?.insertAdjacentHTML('afterbegin', `<section class="dd26-section"><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(grading.candidates.length)}</strong><span>Students</span></div><div class="dd26-stat"><strong>${escapeHtml(finalCount)}</strong><span>Final grades</span></div><div class="dd26-stat"><strong>${escapeHtml(allQuestions.length - finalCount)}</strong><span>Needs grading</span></div><div class="dd26-stat"><strong>Professor</strong><span>Official decision</span></div></div><div class="dd26-form-grid"><label class="dd26-field"><span>Student</span><select class="dd26-select" id="dd26-grading-candidate">${grading.candidates.map((entry, index) => `<option value="${index}" ${index === state.exam.gradingCandidate ? 'selected' : ''}>${escapeHtml(entry.candidateNumber)}</option>`).join('')}</select></label><label class="dd26-field"><span>Question</span><select class="dd26-select" id="dd26-grading-question">${candidate.questions.map((entry, index) => `<option value="${index}" ${index === state.exam.gradingQuestion ? 'selected' : ''}>Question ${escapeHtml(entry.ordinal)} — ${escapeHtml(entry.gradeState || 'draft')}</option>`).join('')}</select></label></div><div class="dd26-notice"><strong>Professor judgment is required.</strong> AI grading is off and no suggestion can finalize or release a grade.</div><div class="dd26-actions"><button class="dd26-button" id="dd26-load-model-answer" type="button">${modelAnswer ? 'Refresh suggested answer' : 'Load suggested answer'}</button></div>${modelAnswer ? modelAnswer.mode === 'paste' && modelAnswer.available ? `<details class="dd26-section" open><summary>Professor-only suggested answer</summary><p class="dd26-long-cell">${escapeHtml(modelAnswer.answerText)}</p><small>Saved with the published exam.</small></details>` : `<div class="dd26-notice">${escapeHtml(modelAnswer.code || 'No usable suggested answer is configured for this examination.')}${modelAnswer.safeFileName ? ` File: ${escapeHtml(modelAnswer.safeFileName)}` : ''}</div>` : ''}</section>`);
    document.getElementById('dd26-grading-candidate')?.addEventListener('change', (event) => { state.exam.gradingCandidate = Number(event.target.value); state.exam.gradingQuestion = 0; renderGrading(); });
    document.getElementById('dd26-grading-question')?.addEventListener('change', (event) => { state.exam.gradingQuestion = Number(event.target.value); renderGrading(); });
    document.getElementById('dd26-load-model-answer')?.addEventListener('click', loadGradingModelAnswer);
    document.getElementById('dd26-save-grade')?.addEventListener('click', saveGrade);
    document.getElementById('dd26-next-ungraded')?.addEventListener('click', nextGrade);
    document.getElementById('dd26-unlock-attempt')?.addEventListener('click', unlockAttempt);
    document.getElementById('dd26-release-results')?.addEventListener('click', releaseResults);
  }

  async function loadGradingModelAnswer() {
    const grading = state.exam.grading;
    if (!grading) return;
    try {
      const payload = await api('/exam-room/query', {
        operation: 'grading_model_answer', examId: grading.examId, gradingKey: grading.gradingKey,
      });
      state.exam.gradingModelAnswer = payload.result;
      renderGrading();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function saveGrade() {
    const grading = state.exam.grading;
    const candidate = grading.candidates[state.exam.gradingCandidate];
    const question = candidate.questions[state.exam.gradingQuestion];
    try {
      const result = await command({ operation: 'save_grade', examId: grading.examId, attemptId: candidate.attemptId, questionId: question.questionId, score: Number(value('dd26-grade-score')), comment: value('dd26-grade-comment', false), gradeState: value('dd26-grade-state'), expectedRevision: question.gradeRevision || 0, changeReason: value('dd26-grade-reason'), gradingKey: grading.gradingKey });
      question.score = Number(value('dd26-grade-score'));
      question.comment = value('dd26-grade-comment', false);
      question.gradeState = value('dd26-grade-state');
      question.gradeRevision = result.revision;
      global.toast?.('Grade saved with version history.', 'ok');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function nextGrade() {
    const grading = state.exam.grading;
    const candidate = grading.candidates[state.exam.gradingCandidate];
    if (state.exam.gradingQuestion < candidate.questions.length - 1) state.exam.gradingQuestion += 1;
    else if (state.exam.gradingCandidate < grading.candidates.length - 1) { state.exam.gradingCandidate += 1; state.exam.gradingQuestion = 0; }
    else { state.exam.gradingCandidate = 0; state.exam.gradingQuestion = 0; }
    renderGrading();
  }

  async function unlockAttempt() {
    const grading = state.exam.grading;
    const candidate = grading.candidates[state.exam.gradingCandidate];
    const reason = global.prompt('Enter the required reason for unlocking this preserved attempt:');
    if (!reason) return;
    try {
      await command({ operation: 'unlock_attempt', attemptId: candidate.attemptId, reason, gradingKey: grading.gradingKey });
      candidate.status = 'in_progress';
      global.toast?.('Attempt unlocked with an audit record.', 'ok');
      renderGrading();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function releaseResults() {
    const grading = state.exam.grading;
    const unfinished = grading.candidates.flatMap((candidate) => candidate.questions).filter((question) => question.gradeState !== 'final');
    if (unfinished.length) { global.toast?.(`${unfinished.length} grades are not final.`, 'warn'); return; }
    const includeQuestionnaire = global.confirm('Include the questionnaire in student result packages? Select Cancel for grades and comments only.');
    if (!global.confirm('Release all final grades now? This seals the exam and permanently revokes every original exam-scoped key.')) return;
    try {
      await command({ operation: 'release_results', examId: grading.examId, requestKey: randomKey('release'), includeQuestionnaire, gradingKey: grading.gradingKey });
      state.exam.grading = null;
      global.toast?.('Class results released and the examination sealed.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function requestFullscreen() {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); }
    catch { global.toast?.('Fullscreen was not granted. The event is disclosed and may be recorded by the configured integrity preset.', 'warn'); }
  }

  let dialogReturnFocus = null;

  function openDialog(content, options = {}) {
    let dialog = document.getElementById('dd26-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'dd26-dialog';
      dialog.className = 'dd26-modal';
      dialog.setAttribute('aria-labelledby', 'dd26-dialog-heading');
      dialog.innerHTML = '<div class="dd26-modal-card" id="dd26-dialog-card" tabindex="-1"></div>';
      document.body.append(dialog);
      dialog.addEventListener('cancel', (event) => {
        if (dialog.dataset.persistent === 'true') event.preventDefault();
      });
      dialog.addEventListener('close', () => {
        dialogReturnFocus?.focus?.();
        dialogReturnFocus = null;
      });
    }
    dialogReturnFocus = document.activeElement;
    dialog.dataset.persistent = options.persistent ? 'true' : 'false';
    document.getElementById('dd26-dialog-card').innerHTML = content.replace(/<h2(\s|>)/, '<h2 id="dd26-dialog-heading"$1');
    document.querySelectorAll('[data-dd26-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
    if (!dialog.open) dialog.showModal();
    document.getElementById('dd26-dialog-card')?.focus();
  }

  function closeDialog() {
    const dialog = document.getElementById('dd26-dialog');
    if (dialog?.open) dialog.close();
  }
  function showOneTimeSecret(title, secret, help) {
    openDialog(`<div class="dd26-label">One-time credential display</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(help)}</p><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-one-time-secret">${escapeHtml(secret)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-one-time-secret" type="button">Copy</button></div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">I stored it securely</button></div>`, { persistent: true });
    bindSecretCopyButtons();
  }

  function bindSecretCopyButtons() {
    document.querySelectorAll('[data-dd26-copy-secret]').forEach((button) => button.addEventListener('click', async () => {
      const text = document.getElementById(button.dataset.dd26CopySecret)?.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch { global.toast?.('Copy was not available. Select the displayed secret manually.', 'warn'); }
    }));
  }
  function value(id, trim = true) { const result = document.getElementById(id)?.value ?? ''; return trim ? String(result).trim() : String(result); }
  async function refreshPortalSilently() {
    try {
      const payload = await api('/exam-room/query', { operation: 'portal' });
      state.exam.portal = payload.result;
      await enrichProfessorExamIntents(state.exam.portal);
      return true;
    } catch { return false; }
  }

  function routeFromHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (raw === 'bar-easy') return ['bar_easy'];
    if (raw === 'chairs-cases') return ['chair_case'];
    if (raw === 'doctrines') return ['doctrine'];
    if (raw === 'examination-room') return ['exam_room'];
    if (raw.startsWith('examination-room?')) {
      const parameters = new URLSearchParams(raw.slice('examination-room?'.length));
      const examId = String(parameters.get('exam') || '').trim();
      return ['exam_room', examId.slice(0, 120)];
    }
    if (raw === 'anchor-case-digests') return ['anchor_case'];
    if (raw.startsWith('anchor-case-digests/')) return ['anchor_case', raw.slice('anchor-case-digests/'.length)];
    return null;
  }

  function restoreRoute() {
    const route = routeFromHash();
    if (route) open(route[0], document.getElementById(CONTENT_PATHS[route[0]].tab), { replace: true, detailId: route[1] || null });
  }

  global.DueDiligence2026 = Object.freeze({ open, exportVerdict, openVerdictExport, refreshExamPortal, restoreRoute });
  global.openBarEasy = () => open('bar_easy', document.getElementById('spa-bar-easy'));
  global.openChairCases = () => open('chair_case', document.getElementById('spa-chairs-case'));
  global.openDoctrines = () => open('doctrine', document.getElementById('spa-jurisprudence'));
  global.openAnchorCases = () => open('anchor_case', document.getElementById('spa-case-digest'));
  global.openExaminationRoom = () => open('exam_room', document.getElementById('spa-examination-room'));
  global.addEventListener('popstate', restoreRoute);
  global.addEventListener('duediligence:session', (event) => {
    state.featureSnapshot = null;
    if (event.detail?.authenticated) {
      const route = routeFromHash();
      const routePageActive = document.getElementById('page-dd2026')?.classList.contains('active');
      if (route?.[0] === 'exam_room') {
        open('exam_room', document.getElementById(CONTENT_PATHS.exam_room.tab), { replace: true, detailId: route[1] || null })
          .then(() => { if (state.exam.intentRole) selectExamRole(state.exam.intentRole); });
      } else if (route && !routePageActive) restoreRoute();
      return;
    }
    if (state.view === 'exam_room') {
      clearAttemptTimers();
      state.exam.preflight = null;
      state.exam.attempt = null;
      state.exam.grading = null;
      state.exam.gradingModelAnswer = null;
      state.exam.monitoring = null;
      closeDialog();
    }
    if (document.getElementById('page-dd2026')?.classList.contains('active')) {
      if (state.view === 'exam_room') {
        state.exam.portal = null;
        state.exam.section = 'entry';
        renderExamRoom();
      } else global.showPage?.('mock', document.getElementById('spa-mock'));
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreRoute, { once: true });
  else restoreRoute();
}(window));
