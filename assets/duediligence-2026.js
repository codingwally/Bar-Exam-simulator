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
    exam_room: 'EXAMINATION_ROOM_ENABLED',
  });
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
      section: 'overview',
      activeClassroomId: null,
      activeExamId: null,
      rosterPreview: null,
      questionPreview: null,
      attempt: null,
      attemptIndex: 0,
      saveTimers: new Map(),
      heartbeatTimer: null,
      countdownTimer: null,
      serverOffsetMs: 0,
      grading: null,
      gradingCandidate: 0,
      gradingQuestion: 0,
      monitoring: null,
      dispute: null,
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
    page.innerHTML = '<div id="dd2026-app" aria-live="polite"></div>';
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
    const hash = detailId ? `${path}/${encodeURIComponent(detailId)}` : path;
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
    if (!CONTENT_PATHS[view] || !requireAuthentication()) return false;
    state.view = view;
    state.result = null;
    activatePage(view, trigger, options);
    loading(CONTENT_PATHS[view].title);
    try {
      const snapshot = await features();
      const flag = FLAG_NAMES[view];
      if (flag && snapshot?.flags?.[flag] !== true) throw new Error('This module is temporarily unavailable.');
      if (view === 'exam_room') await openExamRoomView();
      else await openContentView(view, options.detailId || null);
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
    const payload = await api('/exam-room/query', { operation: 'portal' });
    state.exam.portal = payload.result || { roles: {}, classes: [], studentExams: [] };
    renderExamRoom();
  }

  function examNavigation() {
    const roles = state.exam.portal?.roles || {};
    const items = [
      ['overview', 'Overview'],
      ['student', 'Student entry'],
      ...(roles.professor ? [['professor', 'Professor workspace']] : [['activation', 'Professor activation']]),
      ...(roles.admin ? [['admin', 'Administration']] : []),
    ];
    return `<nav class="dd26-exam-nav" aria-label="Examination Room sections">${items.map(([id, label]) => `<button type="button" data-dd26-exam-section="${id}" class="${state.exam.section === id ? 'is-active' : ''}">${label}</button>`).join('')}</nav>`;
  }

  function renderExamRoom() {
    clearAttemptTimers();
    const portal = state.exam.portal || { roles: {}, classes: [], studentExams: [] };
    app().innerHTML = `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Protected institutional assessment</div><h1>Examination Room</h1><p>Roster-controlled midterm and final examinations with server time, autosave, sealed releases, and an independent backup trail.</p></div><span class="dd26-beta">Authenticated access</span></header><div class="dd26-exam-layout">${examNavigation()}<main id="dd26-exam-main">${examSection(portal)}</main></div></div>`;
    bindExamNavigation();
    bindExamSection();
  }

  function examSection(portal) {
    if (state.exam.section === 'student') return studentSection(portal);
    if (state.exam.section === 'professor') return professorSection(portal);
    if (state.exam.section === 'activation') return activationSection();
    if (state.exam.section === 'admin') return adminSection();
    const roleText = [portal.roles?.admin && 'Administrator', portal.roles?.professor && 'Professor', 'Student'].filter(Boolean).join(' · ');
    return `<section class="dd26-card"><div class="dd26-label">Current access</div><h2>${escapeHtml(roleText)}</h2><p>The database is authoritative. Google Sheets is an asynchronous, isolated per-exam backup and must never block an examination transaction.</p><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${portal.classes?.length || 0}</strong><span>Owned classes</span></div><div class="dd26-stat"><strong>${portal.studentExams?.length || 0}</strong><span>Rostered exams</span></div><div class="dd26-stat"><strong>20,000</strong><span>Characters per answer</span></div><div class="dd26-stat"><strong>480</strong><span>Maximum minutes</span></div></div><div class="dd26-integrity">Fullscreen, copy/paste restrictions, focus monitoring, and incident locks are deterrents. A browser cannot detect every outside device or operating-system action.</div></section>`;
  }

  function studentSection(portal) {
    const exams = portal.studentExams || [];
    return `<section class="dd26-card"><div class="dd26-label">Rostered student access</div><h2>Enter an examination</h2><p>A valid exam code and key are required, but neither is authorization by itself. Your authenticated account must also match an active roster entry.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Exam code</span><input class="dd26-input" id="dd26-student-exam" autocomplete="off"></label><label class="dd26-field"><span>Student exam key</span><input class="dd26-input" id="dd26-student-key" type="password" autocomplete="one-time-code"></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-start-attempt" type="button">Review rules and start</button></div></section><section class="dd26-card"><div class="dd26-label">Your rostered examinations</div><h2>Available and completed exams</h2>${exams.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Examination</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody>${exams.map((exam) => `<tr><td><strong>${escapeHtml(exam.title)}</strong><br><small>${escapeHtml(exam.examId)}</small></td><td>${escapeHtml(formatDate(exam.opensAt))}<br>to ${escapeHtml(formatDate(exam.hardClosesAt))}</td><td><span class="dd26-status">${escapeHtml(exam.attemptStatus || exam.status)}</span></td><td>${exam.resultReleased ? `<button class="dd26-button" data-dd26-student-result="${escapeHtml(exam.examId)}" type="button">View result</button>` : exam.attemptId ? `<button class="dd26-button" data-dd26-resume-attempt="${escapeHtml(exam.attemptId)}" type="button">Resume</button>` : 'Enter the issued key above'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dd26-empty">No active rostered examination is available for this account.</div>'}</section>`;
  }

  function activationSection() {
    return `<section class="dd26-card"><div class="dd26-label">One-time role activation</div><h2>Redeem professor activation</h2><p>Professor activation keys expire and become permanently invalid after one successful redemption.</p><label class="dd26-field"><span>Activation key</span><input class="dd26-input" id="dd26-activation-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-redeem-activation" type="button">Activate professor access</button></div></section>`;
  }

  function adminSection() {
    return `<section class="dd26-card"><div class="dd26-label">Administrator</div><h2>Issue professor activation</h2><div class="dd26-form-grid"><label class="dd26-field"><span>Professor email</span><input class="dd26-input" id="dd26-professor-email" type="email"></label><label class="dd26-field"><span>Expiry</span><input class="dd26-input" id="dd26-activation-expiry" type="datetime-local"></label><label class="dd26-field wide"><span>Reason</span><input class="dd26-input" id="dd26-activation-reason" value="Institutional professor onboarding"></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-issue-activation" type="button">Generate activation</button></div></section><section class="dd26-card"><div class="dd26-label">Sealed-evidence review</div><h2>Open an audited dispute</h2><p>This creates a new time-limited authorization. It never reactivates an original exam or grading key.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Exam ID</span><input class="dd26-input" id="dd26-dispute-exam"></label><label class="dd26-field"><span>Case reference</span><input class="dd26-input" id="dd26-dispute-reference"></label><label class="dd26-field wide"><span>Reason</span><textarea class="dd26-textarea" id="dd26-dispute-reason"></textarea></label></div><div class="dd26-actions"><button class="dd26-button" id="dd26-open-dispute" type="button">Create read-only dispute review</button></div></section><section class="dd26-card"><div class="dd26-label">Existing dispute authorization</div><h2>View sealed evidence</h2><div class="dd26-form-grid"><label class="dd26-field"><span>Dispute ID</span><input class="dd26-input" id="dd26-dispute-id"></label><label class="dd26-field"><span>Dispute-review key</span><input class="dd26-input" id="dd26-dispute-key" type="password" autocomplete="one-time-code"></label></div><div class="dd26-actions"><button class="dd26-button" id="dd26-view-dispute" type="button">Open read-only evidence</button></div><div id="dd26-dispute-evidence">${disputeEvidenceHtml()}</div></section>`;
  }

  function professorSection(portal) {
    const classes = portal.classes || [];
    const activeClass = classes.find((entry) => entry.classroomId === state.exam.activeClassroomId) || classes[0] || null;
    if (activeClass) state.exam.activeClassroomId = activeClass.classroomId;
    return `<section class="dd26-card"><div class="dd26-label">Professor workspace</div><h2>Classes and examinations</h2><div class="dd26-form-grid"><label class="dd26-field"><span>Class title</span><input class="dd26-input" id="dd26-class-title" maxlength="200" placeholder="Evidence · Section A"></label><label class="dd26-field"><span>School</span><input class="dd26-input" id="dd26-class-school" maxlength="300"></label><label class="dd26-field"><span>Academic term</span><input class="dd26-input" id="dd26-class-term" maxlength="160"></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-create-class" type="button">Create class</button></div></section>${classes.length ? `<section class="dd26-card"><div class="dd26-toolbar">${classes.map((entry) => `<button class="dd26-chip${entry.classroomId === activeClass?.classroomId ? ' is-active' : ''}" type="button" data-dd26-class="${escapeHtml(entry.classroomId)}">${escapeHtml(entry.title)}</button>`).join('')}</div>${activeClass ? professorClass(activeClass) : ''}</section>` : '<section class="dd26-card"><div class="dd26-empty">Create your first class to upload a roster and examination.</div></section>'}`;
  }

  function professorClass(classroom) {
    return `<div class="dd26-question-meta"><span>${escapeHtml(classroom.title)}</span><span class="dd26-status">${classroom.rosterCount || 0} active students</span></div><div class="dd26-form-grid"><label class="dd26-field"><span>Roster CSV or XLSX</span><input class="dd26-input" id="dd26-roster-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><div class="dd26-field"><span>Roster workflow</span><div class="dd26-actions"><button class="dd26-button" id="dd26-validate-roster" type="button">Validate roster</button><button class="dd26-button primary" id="dd26-import-roster" type="button" ${state.exam.rosterPreview?.validation?.ok ? '' : 'disabled'}>Import approved rows</button></div></div></div>${rosterPreviewHtml()}<section class="dd26-section"><h3>Create an examination</h3><div class="dd26-form-grid"><label class="dd26-field"><span>Exam title</span><input class="dd26-input" id="dd26-exam-title" maxlength="200"></label><label class="dd26-field"><span>Exact question count</span><input class="dd26-input" id="dd26-exam-count" type="number" min="1" step="1"></label><label class="dd26-field wide"><span>Instructions</span><textarea class="dd26-textarea" id="dd26-exam-instructions" maxlength="10000"></textarea></label><label class="dd26-field"><span>Integrity preset</span><select class="dd26-select" id="dd26-exam-integrity"><option value="standard">Standard</option><option value="strict">Strict</option><option value="custom">Custom</option></select></label><label class="dd26-field"><span>Result package</span><select class="dd26-select" id="dd26-exam-questionnaire"><option value="false">Grades and comments only</option><option value="true">Include questionnaire</option></select></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-create-exam" type="button">Create examination</button></div></section><section class="dd26-section"><h3>Existing examinations</h3>${examCards(classroom.exams || [])}</section>`;
  }

  function rosterPreviewHtml() {
    const preview = state.exam.rosterPreview;
    if (!preview) return '';
    const errors = preview.validation?.errors || [];
    return `<div class="${preview.validation?.ok ? 'dd26-success' : 'dd26-error'}">${preview.validation?.ok ? `${preview.rows.length} unique roster rows are ready to import.` : `${errors.length || 1} validation issue(s) must be corrected.`}${errors.length ? `<ul>${errors.map((error) => `<li>${escapeHtml(error.row ? `Row ${error.row}: ` : '')}${escapeHtml(error.code || error.message || error)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  function examCards(exams) {
    if (!exams.length) return '<div class="dd26-empty">No examination has been created for this class.</div>';
    return exams.map((exam) => `<article class="dd26-card"><div class="dd26-question-meta"><span>${escapeHtml(exam.title)}</span><span class="dd26-status">${escapeHtml(exam.status)}</span></div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${exam.questionCount || 0}</strong><span>Questions</span></div><div class="dd26-stat"><strong>${exam.backupSheetReady ? 'Synced' : 'Pending'}</strong><span>Google backup</span></div><div class="dd26-stat"><strong>${exam.opensAt ? 'Set' : 'Draft'}</strong><span>Schedule</span></div><div class="dd26-stat"><strong>${exam.sealedAt ? 'Sealed' : 'Open'}</strong><span>Release state</span></div></div><div class="dd26-help">Opens ${escapeHtml(formatDate(exam.opensAt))} · Hard close ${escapeHtml(formatDate(exam.hardClosesAt))}</div><div class="dd26-actions"><button class="dd26-button" data-dd26-upload-exam="${escapeHtml(exam.examId)}" data-dd26-question-count="${escapeHtml(exam.questionCount)}" type="button">Questions</button><button class="dd26-button" data-dd26-schedule-exam="${escapeHtml(exam.examId)}" type="button">Schedule & keys</button><button class="dd26-button" data-dd26-grade-exam="${escapeHtml(exam.examId)}" type="button">Grade</button></div></article>`).join('');
  }

  function bindExamNavigation() {
    document.querySelectorAll('[data-dd26-exam-section]').forEach((button) => button.addEventListener('click', () => {
      state.exam.section = button.dataset.dd26ExamSection;
      renderExamRoom();
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
    document.querySelectorAll('[data-dd26-class]').forEach((button) => button.addEventListener('click', () => {
      state.exam.activeClassroomId = button.dataset.dd26Class;
      state.exam.rosterPreview = null;
      renderExamRoom();
    }));
    document.getElementById('dd26-create-class')?.addEventListener('click', createClassroom);
    document.getElementById('dd26-redeem-activation')?.addEventListener('click', redeemActivation);
    document.getElementById('dd26-issue-activation')?.addEventListener('click', issueActivation);
    document.getElementById('dd26-open-dispute')?.addEventListener('click', openDispute);
    document.getElementById('dd26-view-dispute')?.addEventListener('click', viewDispute);
    document.getElementById('dd26-close-dispute')?.addEventListener('click', closeDispute);
    document.getElementById('dd26-validate-roster')?.addEventListener('click', validateRoster);
    document.getElementById('dd26-import-roster')?.addEventListener('click', importRoster);
    document.getElementById('dd26-create-exam')?.addEventListener('click', createExam);
    document.getElementById('dd26-start-attempt')?.addEventListener('click', startAttempt);
    document.querySelectorAll('[data-dd26-resume-attempt]').forEach((button) => button.addEventListener('click', () => loadAttempt(button.dataset.dd26ResumeAttempt)));
    document.querySelectorAll('[data-dd26-student-result]').forEach((button) => button.addEventListener('click', () => loadStudentResult(button.dataset.dd26StudentResult)));
    document.querySelectorAll('[data-dd26-upload-exam]').forEach((button) => button.addEventListener('click', () => openQuestionUpload(button.dataset.dd26UploadExam, Number(button.dataset.dd26QuestionCount))));
    document.querySelectorAll('[data-dd26-schedule-exam]').forEach((button) => button.addEventListener('click', () => openSchedule(button.dataset.dd26ScheduleExam)));
    document.querySelectorAll('[data-dd26-monitor-exam]').forEach((button) => button.addEventListener('click', () => openLiveStatus(button.dataset.dd26MonitorExam)));
    document.querySelectorAll('[data-dd26-grade-exam]').forEach((button) => button.addEventListener('click', () => openGrading(button.dataset.dd26GradeExam)));
  }

  async function refreshExamPortal(section = state.exam.section) {
    const payload = await api('/exam-room/query', { operation: 'portal' });
    state.exam.portal = payload.result;
    state.exam.section = section;
    renderExamRoom();
  }

  async function command(body) {
    const payload = await api('/exam-room/command', body);
    if (payload.result?.ok === false) {
      const error = new Error(examCodeMessage(payload.result.code));
      error.code = payload.result.code;
      throw error;
    }
    return payload.result;
  }

  function examCodeMessage(code) {
    const messages = {
      ROSTER_REQUIRED: 'This authenticated account is not on the active class roster.',
      ROSTER_ACCOUNT_MISMATCH: 'This roster entry is already linked to another account.',
      EXAM_NOT_OPEN: 'This examination has not opened yet.',
      EXAM_CLOSED: 'This examination is closed.',
      CREDENTIAL_INVALID: 'The examination key is invalid.',
      CREDENTIAL_LOCKED: 'Too many failed key attempts. Access is locked for 15 minutes.',
      ATTEMPT_LOCKED: 'This attempt is locked. Your saved answers remain preserved.',
      GRADING_NOT_OPEN: 'Grading opens only after the examination hard close.',
    };
    return messages[code] || String(code || 'The examination request was denied.').replace(/_/g, ' ').toLowerCase();
  }

  async function createClassroom() {
    try {
      await command({ operation: 'create_classroom', title: value('dd26-class-title'), schoolName: value('dd26-class-school'), academicTerm: value('dd26-class-term') });
      global.toast?.('Class created.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function redeemActivation() {
    try {
      await command({ operation: 'redeem_activation', activationKey: value('dd26-activation-key', false) });
      global.toast?.('Professor access activated.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function issueActivation() {
    const secret = randomKey('professor_activation');
    const expiryInput = value('dd26-activation-expiry');
    const expiresAt = expiryInput ? new Date(expiryInput).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString();
    try {
      await command({ operation: 'issue_activation', targetEmail: value('dd26-professor-email'), activationKey: secret, expiresAt, reason: value('dd26-activation-reason') });
      showOneTimeSecret('Professor activation key', secret, 'Share this key securely with the named professor. It expires and can be redeemed only once.');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openDispute() {
    const secret = randomKey('dispute_review');
    try {
      const result = await command({ operation: 'open_dispute', examId: value('dd26-dispute-exam'), caseReference: value('dd26-dispute-reference'), reason: value('dd26-dispute-reason'), accessMode: 'read_only', disputeKey: secret, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() });
      showOneTimeSecret('Dispute-review authorization', secret, `Review ${result.disputeId} expires ${formatDate(result.expiresAt)}. This is separate from every original exam key.`);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function disputeEvidenceHtml() {
    const evidence = state.exam.dispute;
    if (!evidence) return '<div class="dd26-empty">Enter the dispute ID and its separate time-limited key to view sealed evidence.</div>';
    const attempts = Array.isArray(evidence.attempts) ? evidence.attempts : [];
    const audit = Array.isArray(evidence.audit) ? evidence.audit : [];
    const sheetId = String(evidence.exam?.googleSheetId || '');
    const sheetLink = /^[A-Za-z0-9_-]{20,}$/.test(sheetId)
      ? `<a class="dd26-button" href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit" target="_blank" rel="noopener noreferrer">Open isolated Google backup</a>`
      : '<span class="dd26-help">No Google backup identifier is available.</span>';
    return `<div class="dd26-notice">Read-only authorization expires ${escapeHtml(formatDate(evidence.dispute?.expiresAt))}. Original exam and grading keys remain revoked.</div><div class="dd26-question-meta"><span>${escapeHtml(evidence.exam?.title || 'Sealed examination')}</span><span class="dd26-status">${escapeHtml(evidence.exam?.status || 'sealed')}</span></div><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Candidate</th><th>Status</th><th>Saved answers</th><th>Grades</th></tr></thead><tbody>${attempts.map((attempt) => `<tr><td>${escapeHtml(attempt.candidateNumber)}</td><td>${escapeHtml(attempt.status)}</td><td>${attempt.answers?.length || 0}</td><td>${attempt.grades?.length || 0}</td></tr>`).join('') || '<tr><td colspan="4">No sealed attempts.</td></tr>'}</tbody></table></div>${attempts.map((attempt) => `<details class="dd26-section"><summary>Candidate ${escapeHtml(attempt.candidateNumber)} — sealed evidence</summary><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Question</th><th>Saved answer</th><th>Revision</th><th>Grade</th><th>Comment</th></tr></thead><tbody>${(attempt.answers || []).map((answer) => { const grade = (attempt.grades || []).find((entry) => entry.questionId === answer.questionId); return `<tr><td>${escapeHtml(answer.questionId)}</td><td class="dd26-long-cell">${escapeHtml(answer.answerText || 'No answer submitted.')}</td><td>${escapeHtml(answer.revision)}</td><td>${grade ? `${escapeHtml(grade.score)} / ${escapeHtml(grade.maximumPoints)}` : 'Not graded'}</td><td>${escapeHtml(grade?.comment || '')}</td></tr>`; }).join('') || '<tr><td colspan="5">No saved answers.</td></tr>'}</tbody></table></div></details>`).join('')}<details class="dd26-section"><summary>Audit trail (${audit.length})</summary><ul>${audit.map((entry) => `<li>${escapeHtml(formatDate(entry.createdAt))} — ${escapeHtml(entry.action)}${entry.reason ? `: ${escapeHtml(entry.reason)}` : ''}</li>`).join('') || '<li>No audit events.</li>'}</ul></details><div class="dd26-actions">${sheetLink}<button class="dd26-button danger" id="dd26-close-dispute" type="button">Close dispute authorization</button></div>`;
  }

  async function viewDispute() {
    const disputeId = value('dd26-dispute-id');
    const disputeKey = value('dd26-dispute-key', false);
    try {
      const payload = await api('/exam-room/query', { operation: 'dispute_view', disputeId, disputeKey });
      if (payload.result?.ok === false) throw new Error(examCodeMessage(payload.result.code));
      state.exam.dispute = { ...payload.result, disputeKey };
      const host = document.getElementById('dd26-dispute-evidence');
      if (host) host.innerHTML = disputeEvidenceHtml();
      document.getElementById('dd26-close-dispute')?.addEventListener('click', closeDispute);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function closeDispute() {
    const disputeId = state.exam.dispute?.dispute?.id;
    if (!disputeId) return;
    const reason = global.prompt('Enter the required reason for closing this dispute review:');
    if (!reason) return;
    try {
      await command({ operation: 'close_dispute', disputeId, reason });
      state.exam.dispute = null;
      global.toast?.('Dispute review closed and its temporary authorization revoked.', 'ok');
      renderExamRoom();
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
    return 'text/plain';
  }

  async function validateRoster() {
    const file = document.getElementById('dd26-roster-file')?.files?.[0];
    if (!file) { global.toast?.('Choose a CSV or XLSX roster first.', 'warn'); return; }
    try {
      const payload = await api('/exam-room/upload/roster', { classroomId: state.exam.activeClassroomId, ...await filePayload(file) });
      state.exam.rosterPreview = payload;
      renderExamRoom();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function importRoster() {
    const preview = state.exam.rosterPreview;
    if (!preview?.validation?.ok) return;
    try {
      await command({ operation: 'import_roster', classroomId: state.exam.activeClassroomId, rows: preview.rows, sourceHash: preview.sourceHash, requestKey: randomKey('roster') });
      state.exam.rosterPreview = null;
      global.toast?.('Roster imported without duplicates.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function createExam() {
    try {
      await command({ operation: 'create_exam', classroomId: state.exam.activeClassroomId, title: value('dd26-exam-title'), instructions: value('dd26-exam-instructions', false), questionCount: Number(value('dd26-exam-count')), integrityPreset: value('dd26-exam-integrity'), includeQuestionnaire: value('dd26-exam-questionnaire') === 'true' });
      global.toast?.('Examination draft created.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openQuestionUpload(examId, questionCount) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Questions / immutable version</div><h2>Upload and confirm questions</h2><p>Upload one UTF-8 TXT or DOCX source. Due Diligence extracts numbered questions verbatim and will not schedule the exam until the confirmed count is exact.</p><label class="dd26-field"><span>Source file</span><input class="dd26-input" id="dd26-question-file" type="file" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><input id="dd26-question-count" type="hidden" value="${questionCount}"><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preview-questions" type="button">Extract ${questionCount} questions</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div><div id="dd26-question-preview"></div>`);
    document.getElementById('dd26-preview-questions')?.addEventListener('click', previewQuestions);
  }

  async function previewQuestions() {
    const file = document.getElementById('dd26-question-file')?.files?.[0];
    const questionCount = Number(value('dd26-question-count'));
    if (!file) { global.toast?.('Choose a TXT or DOCX source first.', 'warn'); return; }
    try {
      const payload = await api('/exam-room/upload/questions', { examId: state.exam.activeExamId, questionCount, ...await filePayload(file) });
      state.exam.questionPreview = payload.preview;
      renderQuestionPreview();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderQuestionPreview() {
    const preview = state.exam.questionPreview;
    const host = document.getElementById('dd26-question-preview');
    if (!host || !preview) return;
    host.innerHTML = `<div class="dd26-notice">${escapeHtml(preview.fileName)} · SHA-256 ${escapeHtml(preview.contentHash)} · detected ${preview.questions.length}, expected ${preview.questionCount}</div>${preview.warnings?.length ? `<div class="dd26-error">${preview.warnings.map(escapeHtml).join('<br>')}</div>` : ''}<div id="dd26-question-editors">${preview.questions.map(questionEditor).join('')}</div><div class="dd26-actions"><button class="dd26-button" id="dd26-add-question" type="button">Add question</button><button class="dd26-button primary" id="dd26-confirm-questions" type="button">Confirm immutable version</button></div>`;
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
    try {
      await command({ operation: 'confirm_questions', examId: preview.examId, objectPath: preview.objectPath, fileName: preview.fileName, mimeType: preview.mimeType, sizeBytes: preview.sizeBytes, pageCount: preview.pageCount, contentHash: preview.contentHash, questionCount: questions.length, questions, warnings: [] });
      closeDialog();
      global.toast?.('Question version confirmed and sealed for scheduling.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openSchedule(examId) {
    state.exam.activeExamId = examId;
    const now = new Date(Date.now() + 15 * 60000);
    const close = new Date(now.getTime() + 2 * 3600000);
    openDialog(`<div class="dd26-label">Server-controlled schedule</div><h2>Schedule examination</h2><div class="dd26-form-grid"><label class="dd26-field"><span>Opens at</span><input class="dd26-input" id="dd26-opens-at" type="datetime-local" value="${localDateValue(now)}"></label><label class="dd26-field"><span>Hard closes at</span><input class="dd26-input" id="dd26-closes-at" type="datetime-local" value="${localDateValue(close)}"></label><label class="dd26-field"><span>Optional duration in minutes</span><input class="dd26-input" id="dd26-duration" type="number" min="1" max="480" value="120"></label></div><div class="dd26-integrity">The effective server deadline is the earlier of start time plus duration or hard close. Keys are displayed once and stored only as secure hashes.</div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-schedule-confirm" type="button">Schedule and generate keys</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-schedule-confirm')?.addEventListener('click', scheduleExam);
  }

  async function scheduleExam() {
    const studentKey = randomKey('student_exam');
    const gradingKey = randomKey('professor_grading');
    try {
      await command({ operation: 'schedule_exam', examId: state.exam.activeExamId, opensAt: new Date(value('dd26-opens-at')).toISOString(), hardClosesAt: new Date(value('dd26-closes-at')).toISOString(), durationMinutes: Number(value('dd26-duration')) || null, studentKey, gradingKey });
      openDialog(`<div class="dd26-label">One-time credential display</div><h2>Examination scheduled</h2><p>Copy these keys now. Due Diligence stores only their secure hashes and cannot reveal them later.</p><div class="dd26-field"><span>Student exam key</span><div class="dd26-raw-key">${escapeHtml(studentKey)}</div></div><div class="dd26-field"><span>Professor grading key</span><div class="dd26-raw-key">${escapeHtml(gradingKey)}</div></div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">I stored both keys securely</button></div>`);
      await refreshPortalSilently();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function localDateValue(date) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  async function startAttempt() {
    try {
      const result = await command({ operation: 'start_attempt', examId: value('dd26-student-exam'), studentKey: value('dd26-student-key', false) });
      await requestFullscreen();
      await loadAttempt(result.attemptId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function loadAttempt(attemptId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'attempt', attemptId });
      state.exam.attempt = payload.result;
      state.exam.serverOffsetMs = new Date(payload.result.serverNow).getTime() - Date.now();
      state.exam.attemptIndex = Math.min(state.exam.attemptIndex, Math.max(0, payload.result.questions.length - 1));
      renderAttempt();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderAttempt() {
    const attempt = state.exam.attempt;
    const question = attempt?.questions?.[state.exam.attemptIndex];
    if (!attempt || !question) return;
    const mutable = attempt.status === 'in_progress';
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card" id="dd26-attempt-surface"><div class="dd26-attempt-top"><div><div class="dd26-label">${escapeHtml(attempt.title)}</div><span class="dd26-save-state${mutable ? '' : ' is-error'}" id="dd26-save-state">${mutable ? 'Server-acknowledged autosave' : 'Answer editing is locked; saved work is preserved'}</span></div><div class="dd26-clock" id="dd26-attempt-clock">--:--:--</div></div>${mutable ? '' : '<div class="dd26-error" role="status">This attempt is locked. You may review preserved answers, but no answer can be changed or submitted until an authorized unlock.</div>'}<div class="dd26-integrity">${escapeHtml(attempt.integrityDisclosure)}</div><div class="dd26-question-nav" aria-label="Question navigator">${attempt.questions.map((entry, index) => `<button type="button" data-dd26-attempt-question="${index}" class="${index === state.exam.attemptIndex ? 'is-active' : ''}${entry.savedAt ? ' is-saved' : ''}" aria-label="Question ${entry.ordinal}${entry.savedAt ? ', saved' : ''}">${entry.ordinal}</button>`).join('')}</div><div class="dd26-question-meta"><span>Question ${question.ordinal} of ${attempt.questions.length}</span><span>${escapeHtml(question.maximumPoints)} points</span></div><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea" id="dd26-attempt-answer" maxlength="20000" ${mutable ? '' : 'readonly aria-readonly="true"'}>${escapeHtml(question.answer)}</textarea><small class="dd26-counter" id="dd26-attempt-count">${codePointLength(question.answer).toLocaleString()} / 20,000</small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-attempt-prev" type="button" ${state.exam.attemptIndex === 0 ? 'disabled' : ''}>Previous</button><button class="dd26-button" id="dd26-attempt-next" type="button" ${state.exam.attemptIndex === attempt.questions.length - 1 ? 'disabled' : ''}>Next</button><button class="dd26-button primary" id="dd26-attempt-submit" type="button" ${mutable ? '' : 'disabled'}>Submit examination</button></div></section>`;
    bindAttempt();
    startAttemptTimers();
  }

  function bindAttempt() {
    document.querySelectorAll('[data-dd26-attempt-question]').forEach((button) => button.addEventListener('click', () => { state.exam.attemptIndex = Number(button.dataset.dd26AttemptQuestion); renderAttempt(); }));
    document.getElementById('dd26-attempt-prev')?.addEventListener('click', () => { state.exam.attemptIndex -= 1; renderAttempt(); });
    document.getElementById('dd26-attempt-next')?.addEventListener('click', () => { state.exam.attemptIndex += 1; renderAttempt(); });
    document.getElementById('dd26-attempt-submit')?.addEventListener('click', submitAttempt);
    const answer = document.getElementById('dd26-attempt-answer');
    if (state.exam.attempt.status === 'in_progress') answer?.addEventListener('input', () => {
      const question = state.exam.attempt.questions[state.exam.attemptIndex];
      question.answer = answer.value;
      document.getElementById('dd26-attempt-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 20,000`;
      queueAnswerSave(question);
    });
    const surface = document.getElementById('dd26-attempt-surface');
    surface?.addEventListener('contextmenu', preventExamAction);
    surface?.addEventListener('copy', preventExamAction);
    surface?.addEventListener('paste', preventExamAction);
    document.addEventListener('visibilitychange', visibilityIncident);
    global.addEventListener('blur', blurIncident);
    document.addEventListener('fullscreenchange', fullscreenIncident);
  }

  function preventExamAction(event) {
    event.preventDefault();
    const eventType = event.type === 'contextmenu' ? 'context_menu_attempt' : `${event.type}_attempt`;
    recordIncident(eventType, { surface: 'answer_workspace' });
    global.toast?.('This action is disabled under the disclosed exam-integrity rules.', 'warn');
  }
  function visibilityIncident() { if (document.hidden && state.exam.attempt) recordIncident('visibility_exit', { visibilityState: document.visibilityState }); }
  function blurIncident() { if (state.exam.attempt) recordIncident('focus_exit', { active: document.hasFocus() }); }
  function fullscreenIncident() { if (state.exam.attempt && !document.fullscreenElement) recordIncident('fullscreen_exit', { fullscreen: false }); }

  async function recordIncident(eventType, details) {
    try {
      const result = await command({ operation: 'integrity_event', attemptId: state.exam.attempt.attemptId, eventType, details });
      if (result.locked) {
        state.exam.attempt.status = 'locked';
        global.toast?.('Attempt locked. All server-saved answers remain preserved.', 'warn');
        renderAttempt();
      }
    } catch { /* incident transport failures are surfaced through heartbeat state */ }
  }

  function queueAnswerSave(question) {
    const status = document.getElementById('dd26-save-state');
    if (status) { status.textContent = navigator.onLine ? 'Saving…' : 'Offline — waiting to reconnect'; status.className = 'dd26-save-state'; }
    clearTimeout(state.exam.saveTimers.get(question.id));
    state.exam.saveTimers.set(question.id, setTimeout(() => saveAnswer(question), 700));
  }

  async function saveAnswer(question, { throwOnError = false } = {}) {
    const status = document.getElementById('dd26-save-state');
    try {
      const result = await command({ operation: 'save_answer', attemptId: state.exam.attempt.attemptId, questionId: question.id, answerText: question.answer, expectedRevision: question.revision || 0 });
      question.revision = result.revision;
      question.savedAt = result.savedAt;
      if (status) { status.textContent = `Saved ${formatDate(result.savedAt)}`; status.className = 'dd26-save-state is-saved'; }
    } catch (error) {
      if (status) { status.textContent = error.code === 'ANSWER_CONFLICT' ? 'Conflict — reload this attempt' : 'Save error — retrying'; status.className = 'dd26-save-state is-error'; }
      global.toast?.(error.message, 'warn');
      if (throwOnError) throw error;
    }
  }

  function startAttemptTimers() {
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    updateAttemptClock();
    state.exam.countdownTimer = setInterval(updateAttemptClock, 1000);
    state.exam.heartbeatTimer = setInterval(sendHeartbeat, 60000);
  }

  function clearAttemptTimers() {
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    state.exam.countdownTimer = null;
    state.exam.heartbeatTimer = null;
    document.removeEventListener('visibilitychange', visibilityIncident);
    global.removeEventListener('blur', blurIncident);
    document.removeEventListener('fullscreenchange', fullscreenIncident);
  }

  function updateAttemptClock() {
    const clock = document.getElementById('dd26-attempt-clock');
    if (!clock || !state.exam.attempt) return;
    const remaining = Math.max(0, new Date(state.exam.attempt.serverDeadline).getTime() - (Date.now() + state.exam.serverOffsetMs));
    const seconds = Math.ceil(remaining / 1000);
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
    clock.textContent = [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
    clock.classList.toggle('is-alert', seconds <= 300);
    if (seconds === 0) {
      clearAttemptTimers();
      if (state.exam.attempt.status === 'in_progress') submitAttempt(true);
      else loadAttempt(state.exam.attempt.attemptId);
    }
  }

  async function sendHeartbeat() {
    try {
      const result = await command({ operation: 'heartbeat', attemptId: state.exam.attempt.attemptId });
      if (result.serverNow) state.exam.serverOffsetMs = new Date(result.serverNow).getTime() - Date.now();
      state.exam.attempt.serverDeadline = result.serverDeadline || state.exam.attempt.serverDeadline;
      if (result.status !== 'in_progress') await loadAttempt(state.exam.attempt.attemptId);
    } catch { recordIncident('heartbeat_gap', { durationSeconds: 60 }); }
  }

  async function submitAttempt(automatic = false) {
    if (!automatic && !global.confirm('Submit this examination? You cannot edit answers after final submission.')) return;
    try {
      const questions = state.exam.attempt?.questions || [];
      if (state.exam.attempt?.status === 'in_progress') {
        await Promise.all(questions.map((question) => saveAnswer(question, { throwOnError: true })));
      }
      const result = await command({ operation: 'submit_attempt', attemptId: state.exam.attempt.attemptId, requestKey: randomKey(automatic ? 'deadline' : 'submission') });
      clearAttemptTimers();
      state.exam.attempt = null;
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-success">Examination ${escapeHtml(result.status || 'submitted')}. Your server-acknowledged answers are preserved. Results remain private until the professor releases the class in one batch.</div><div class="dd26-actions"><button class="dd26-button" id="dd26-return-portal" type="button">Return to Examination Room</button></div></section>`;
      document.getElementById('dd26-return-portal')?.addEventListener('click', () => refreshExamPortal('student'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function loadStudentResult(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'student_result', examId });
      const result = payload.result;
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-label">Released result</div><h2>${escapeHtml(result.title)}</h2><p>Candidate ${escapeHtml(result.candidateNumber)} · Released ${escapeHtml(formatDate(result.releasedAt))}</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Question</th>${result.includeQuestionnaire ? '<th>Questionnaire</th>' : ''}<th>Score</th><th>Professor comment</th></tr></thead><tbody>${(result.grades || []).map((grade) => `<tr><td>${grade.ordinal}</td>${result.includeQuestionnaire ? `<td>${escapeHtml(grade.question)}</td>` : ''}<td>${escapeHtml(grade.score)} / ${escapeHtml(grade.maximumPoints)}</td><td>${escapeHtml(grade.comment)}</td></tr>`).join('')}</tbody></table></div></section>`;
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openLiveStatus(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Live examination monitor</div><h2>Open incident status</h2><p>This view shows attempt state and neutral incident counts only. Student answers remain hidden until grading opens after hard close.</p><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-monitor-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-monitor" type="button">Open live monitor</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-load-monitor')?.addEventListener('click', loadLiveStatus);
  }

  async function loadLiveStatus() {
    const gradingKey = value('dd26-monitor-key', false) || state.exam.monitoring?.gradingKey;
    try {
      const payload = await api('/exam-room/query', {
        operation: 'live_status', examId: state.exam.activeExamId, gradingKey,
      });
      state.exam.monitoring = { ...payload.result, gradingKey };
      closeDialog();
      renderLiveStatus();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderLiveStatus() {
    const monitor = state.exam.monitoring;
    const host = document.getElementById('dd26-exam-main');
    if (!host || !monitor) return;
    const candidates = monitor.candidates || [];
    host.innerHTML = `<section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Live examination monitor</div><h2>${escapeHtml(monitor.title)}</h2></div><span class="dd26-status">${escapeHtml(monitor.status)}</span></div><p>Only attempt state, deadlines, heartbeats, and neutral incident counts appear here. Answers remain private until grading opens.</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Candidate</th><th>Status</th><th>Incidents</th><th>Deadline</th><th>Last heartbeat</th><th>Action</th></tr></thead><tbody>${candidates.map((candidate) => `<tr><td>${escapeHtml(candidate.candidateNumber)}</td><td>${escapeHtml(candidate.status)}</td><td>${escapeHtml(candidate.incidentCount || 0)}</td><td>${escapeHtml(formatDate(candidate.serverDeadline))}</td><td>${escapeHtml(formatDate(candidate.lastHeartbeatAt))}</td><td>${candidate.status === 'locked' ? `<button class="dd26-button danger" data-dd26-unlock-live="${escapeHtml(candidate.attemptId)}" type="button">Unlock</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="6">No student has started this examination.</td></tr>'}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-refresh-monitor" type="button">Refresh status</button><button class="dd26-button" id="dd26-return-professor" type="button">Return to professor workspace</button></div></section>`;
    document.getElementById('dd26-refresh-monitor')?.addEventListener('click', loadLiveStatus);
    document.getElementById('dd26-return-professor')?.addEventListener('click', () => refreshExamPortal('professor'));
    document.querySelectorAll('[data-dd26-unlock-live]').forEach((button) => button.addEventListener('click', () => unlockMonitoredAttempt(button.dataset.dd26UnlockLive)));
  }

  async function unlockMonitoredAttempt(attemptId) {
    const reason = global.prompt('Enter the required reason for unlocking this preserved attempt:');
    if (!reason) return;
    try {
      await command({
        operation: 'unlock_attempt', attemptId, reason,
        gradingKey: state.exam.monitoring.gradingKey,
      });
      global.toast?.('Attempt unlocked with an audit record.', 'ok');
      await loadLiveStatus();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openGrading(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Professor grading</div><h2>Open grading workspace</h2><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-grading-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-grading" type="button">Open after hard close</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-load-grading')?.addEventListener('click', loadGrading);
  }

  async function loadGrading() {
    const gradingKey = value('dd26-grading-key', false);
    try {
      const payload = await api('/exam-room/query', { operation: 'grading_workspace', examId: state.exam.activeExamId, gradingKey });
      state.exam.grading = { ...payload.result, gradingKey };
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
      document.getElementById('dd26-exam-main').innerHTML = '<section class="dd26-card"><div class="dd26-empty">No candidate submissions are available for grading.</div></section>';
      return;
    }
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-label">Professor grading / ${escapeHtml(grading.title)}</div><div class="dd26-question-meta"><span>Candidate ${escapeHtml(candidate.candidateNumber)}</span><span>Question ${question.ordinal} of ${grading.questionCount}</span></div><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><section class="dd26-section"><h3>Student answer</h3><p>${escapeHtml(question.answer || 'No answer submitted.')}</p></section><div class="dd26-form-grid"><label class="dd26-field"><span>Score / ${escapeHtml(question.maximumPoints)}</span><input class="dd26-input" id="dd26-grade-score" type="number" min="0" max="${escapeHtml(question.maximumPoints)}" step="0.1" value="${escapeHtml(question.score ?? '')}"></label><label class="dd26-field"><span>State</span><select class="dd26-select" id="dd26-grade-state"><option value="draft" ${question.gradeState === 'draft' ? 'selected' : ''}>Draft</option><option value="final" ${question.gradeState === 'final' ? 'selected' : ''}>Final</option></select></label><label class="dd26-field wide"><span>Professor comment</span><textarea class="dd26-textarea" id="dd26-grade-comment" maxlength="5000">${escapeHtml(question.comment || '')}</textarea></label><label class="dd26-field wide"><span>Reason for this grade/version</span><input class="dd26-input" id="dd26-grade-reason" value="Initial professor assessment"></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-save-grade" type="button">Save grade</button><button class="dd26-button" id="dd26-next-ungraded" type="button">Next question</button>${candidate.status === 'locked' ? '<button class="dd26-button danger" id="dd26-unlock-attempt" type="button">Unlock attempt</button>' : ''}<button class="dd26-button" id="dd26-release-results" type="button">Release class results</button></div></section>`;
    document.getElementById('dd26-save-grade')?.addEventListener('click', saveGrade);
    document.getElementById('dd26-next-ungraded')?.addEventListener('click', nextGrade);
    document.getElementById('dd26-unlock-attempt')?.addEventListener('click', unlockAttempt);
    document.getElementById('dd26-release-results')?.addEventListener('click', releaseResults);
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

  function openDialog(content) {
    let dialog = document.getElementById('dd26-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'dd26-dialog';
      dialog.className = 'dd26-modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<div class="dd26-modal-card" id="dd26-dialog-card" tabindex="-1"></div>';
      document.body.append(dialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
    }
    document.getElementById('dd26-dialog-card').innerHTML = content;
    dialog.classList.add('is-open');
    document.querySelectorAll('[data-dd26-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
    document.getElementById('dd26-dialog-card')?.focus();
  }

  function closeDialog() { document.getElementById('dd26-dialog')?.classList.remove('is-open'); }
  function showOneTimeSecret(title, secret, help) { openDialog(`<div class="dd26-label">One-time credential display</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(help)}</p><div class="dd26-raw-key">${escapeHtml(secret)}</div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">I stored it securely</button></div>`); }
  function value(id, trim = true) { const result = document.getElementById(id)?.value ?? ''; return trim ? String(result).trim() : String(result); }
  async function refreshPortalSilently() { try { const payload = await api('/exam-room/query', { operation: 'portal' }); state.exam.portal = payload.result; } catch {} }

  function routeFromHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (raw === 'bar-easy') return ['bar_easy'];
    if (raw === 'chairs-cases') return ['chair_case'];
    if (raw === 'doctrines') return ['doctrine'];
    if (raw === 'examination-room') return ['exam_room'];
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
    if (!event.detail?.authenticated && document.getElementById('page-dd2026')?.classList.contains('active')) global.showPage?.('mock', document.getElementById('spa-mock'));
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreRoute, { once: true });
  else restoreRoute();
}(window));
