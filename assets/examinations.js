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
  const SUBJECT_CATALOG_STATE_KEY = 'duediligence.subject-matter.catalog-state.v2';
  const LEGACY_DEFAULT_SUBJECT = 'Criminal Law I';
  const DISTINCT_CONTROLLING_LAW_UNAVAILABLE = 'No distinct controlling-law explanation is available in the approved source material for this item.';
  const OFFICIAL_SUBJECT_SOURCE_HOSTS = Object.freeze([
    'lawphil.net',
    'judiciary.gov.ph',
    'officialgazette.gov.ph',
    'leb.gov.ph',
    'dole.gov.ph',
    'bir.gov.ph',
    'senate.gov.ph',
    'legal.un.org',
  ]);
  const HEARTBEAT_MS = 30_000;
  const AUTOSAVE_MS = 1_100;

  const state = {
    catalog: [],
    history: [],
    selectedSubject: '',
    subjectSelectionConfirmed: false,
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
    preferredTimerMode: 'selfPaced',
    practiceTimerMode: 'selfPaced',
    subjectQuery: '',
    subjectOpenYears: new Set(),
    subjectOpenTerms: new Set(),
    subjectSelectorScroll: 0,
    subjectPageScroll: 0,
    subjectSelectorReturnFocus: null,
    resumeAttemptId: null,
    reviewMaterialCache: new Map(),
    reviewMaterialRequests: new Map(),
    pendingSubjectSkip: null,
    initialized: false,
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));

  const PRACTICE_TIMER_MODES = Object.freeze([
    Object.freeze({
      value: 'strict',
      label: '12-minute practice',
      description: 'Practice answering within a focused 12-minute target.',
    }),
    Object.freeze({
      value: 'selfPaced',
      label: 'Stopwatch',
      description: 'See how much time you spend on the question.',
    }),
    Object.freeze({
      value: 'none',
      label: 'Untimed practice',
      description: 'Write without a clock or time limit.',
    }),
  ]);

  function practiceTimerLabel(mode = state.preferredTimerMode) {
    return PRACTICE_TIMER_MODES.find((item) => item.value === mode)?.label || 'Stopwatch';
  }

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

  function subjectSkipRequestKey(attemptId) {
    const normalizedAttemptId = String(attemptId || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 96);
    if (normalizedAttemptId.length < 16) {
      throw new Error('The current question cannot be skipped safely. Refresh and try again.');
    }
    // Stable per attempt so retrying after a lost HTTP response reaches the
    // server's same-key replay path instead of issuing a second mutation.
    return `skip_${normalizedAttemptId}`;
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

  function currentUserId() {
    return String(global.DueDiligencePhase4?.getSession?.()?.user?.id || '').trim();
  }

  function privateRequestIdentity() {
    return Object.freeze({
      ownerUserId: currentUserId(),
      generation: Number(global.DueDiligencePrivateWorkspace?.generation?.()) || 0,
    });
  }

  function privateRequestIdentityIsCurrent(identity) {
    return Boolean(identity?.ownerUserId)
      && currentUserId() === identity.ownerUserId
      && (Number(global.DueDiligencePrivateWorkspace?.generation?.()) || 0) === identity.generation;
  }

  function isStaleIdentityError(error) {
    return error?.code === 'STALE_IDENTITY';
  }

  function privateKey(baseKey) {
    return global.DueDiligencePrivateWorkspace?.scopedKey?.('examinations', baseKey) || '';
  }

  function saveRecovery() {
    const ownerUserId = currentUserId();
    const storageKey = privateKey(LOCAL_KEY);
    if (!ownerUserId || !storageKey || !state.active?.attempt?.attemptId) return;
    const data = {
      version: 2,
      ownerUserId,
      attemptId: state.active.attempt.attemptId,
      versionId: state.active.attempt.versionId,
      currentIndex: state.currentIndex,
      practiceTimerMode: state.practiceTimerMode,
      pendingSubjectSkipRequestKey:
        state.pendingSubjectSkip?.attemptId === state.active.attempt.attemptId
          ? state.pendingSubjectSkip.requestKey
          : null,
      savedAt: Date.now(),
      questions: state.active.questions.map((question) => ({
        questionId: question.questionId,
        answerText: question.answerText || '',
        answerHtml: question.answerHtml ? sanitizeRichHtml(question.answerHtml) : '',
        flagged: question.flagged === true,
        revision: Number(question.revision) || 0,
      })),
    };
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
  }

  function readRecovery() {
    const ownerUserId = currentUserId();
    const storageKey = privateKey(LOCAL_KEY);
    if (!ownerUserId || !storageKey) return null;
    let value = null;
    try { value = safeJson(localStorage.getItem(storageKey)); } catch {}
    if (
      value?.version !== 2
      || value?.ownerUserId !== ownerUserId
      || !value.attemptId
      || Date.now() - Number(value.savedAt || 0) > 14 * 24 * 60 * 60 * 1000
    ) return null;
    return value;
  }

  function clearRecovery() {
    const storageKey = privateKey(LOCAL_KEY);
    state.pendingSubjectSkip = null;
    if (!storageKey) return;
    try { localStorage.removeItem(storageKey); } catch {}
  }

  async function api(path, body = {}) {
    const phase4 = global.DueDiligencePhase4;
    if (!phase4?.getSession?.()?.access_token) {
      phase4?.openSignIn?.({ routeBound: true });
      const error = new Error('Sign in with Google to use the examination beta.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    const identity = privateRequestIdentity();
    const payload = await phase4.request(path, { body });
    if (!privateRequestIdentityIsCurrent(identity)) {
      const error = new Error('The signed-in account changed before the request completed.');
      error.code = 'STALE_IDENTITY';
      throw error;
    }
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

  function focusRendered(root, selector) {
    requestAnimationFrame(() => {
      const target = root?.querySelector?.(selector);
      target?.focus?.({ preventScroll: true });
    });
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

  const RICH_TAGS = new Set([
    'P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'MARK',
    'UL', 'OL', 'LI', 'FONT', 'SPAN',
  ]);
  const RICH_FONTS = new Set(['Arial', 'Georgia', 'Inter', 'Times New Roman']);

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function sanitizeRichHtml(value) {
    const parser = new DOMParser();
    const documentValue = parser.parseFromString(`<div>${String(value || '')}</div>`, 'text/html');
    const root = documentValue.body.firstElementChild;
    const clean = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (!RICH_TAGS.has(child.tagName)) {
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }
        const textAlign = /^(left|center|right|justify)$/.test(child.style?.textAlign || '')
          ? child.style.textAlign : '';
        const fontFamily = RICH_FONTS.has(child.getAttribute('face') || '')
          ? child.getAttribute('face') : '';
        const fontSize = /^[1-7]$/.test(child.getAttribute('size') || '')
          ? child.getAttribute('size') : '';
        const backgroundColor = /^(?:rgb\(255,\s*243,\s*163\)|#fff3a3|yellow)$/i.test(
          child.style?.backgroundColor || child.getAttribute('color') || '',
        ) ? '#fff3a3' : '';
        Array.from(child.attributes).forEach((attribute) => child.removeAttribute(attribute.name));
        if (textAlign) child.style.textAlign = textAlign;
        if (fontFamily && child.tagName === 'FONT') child.setAttribute('face', fontFamily);
        if (fontSize && child.tagName === 'FONT') child.setAttribute('size', fontSize);
        if (backgroundColor && ['SPAN', 'MARK'].includes(child.tagName)) {
          child.style.backgroundColor = backgroundColor;
        }
        clean(child);
      }
    };
    clean(root);
    return root.innerHTML;
  }

  function plainTextFromRich(editor) {
    if (!editor) return '';
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    clone.querySelectorAll('p,div,li').forEach((node) => node.append('\n'));
    return String(clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  function richHtmlFromText(value) {
    const paragraphs = String(value || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function richToolbar() {
    const control = (command, label, glyph) => `<button class="dd-rich-button" type="button"
      data-rich-command="${command}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">${glyph}</button>`;
    return `<div class="dd-rich-toolbar" role="toolbar" aria-label="Legal writing formatting tools">
      <label class="dd-rich-select"><span class="sr-only">Font family</span><select data-rich-font aria-label="Font family">
        <option value="Inter">Inter</option><option value="Georgia">Georgia</option>
        <option value="Times New Roman">Times New Roman</option><option value="Arial">Arial</option>
      </select></label>
      <label class="dd-rich-select"><span class="sr-only">Font size</span><select data-rich-size aria-label="Font size">
        <option value="2">Small</option><option value="3" selected>Normal</option><option value="4">Large</option><option value="5">Extra large</option>
      </select></label>
      ${control('formatBlock', 'Paragraph', '¶')}
      ${control('bold', 'Bold', '<strong>B</strong>')}
      ${control('italic', 'Italic', '<em>I</em>')}
      ${control('underline', 'Underline', '<u>U</u>')}
      ${control('hiliteColor', 'Highlight', '<mark>H</mark>')}
      ${control('insertUnorderedList', 'Bulleted list', '• List')}
      ${control('insertOrderedList', 'Numbered list', '1. List')}
      ${control('justifyLeft', 'Align left', '≡')}
      ${control('justifyCenter', 'Align center', '≣')}
      ${control('justifyRight', 'Align right', '≡')}
      ${control('undo', 'Undo', '↶')}
      ${control('redo', 'Redo', '↷')}
      ${control('removeFormat', 'Clear formatting', 'Clear')}
    </div>`;
  }

  function subjectCatalogItem(subjectName = state.selectedSubject) {
    return state.catalog.find((item) => item.subject === subjectName) || null;
  }

  function subjectTermKey(item) {
    return `${Number(item?.yearLevel) || 0}-${Number(item?.term) || 0}`;
  }

  function subjectSearchText(item) {
    return [
      item.subject,
      item.courseCode,
      item.code,
      item.classification,
      item.category,
      item.keywords,
      `year ${Number(item.yearLevel) || ''}`,
      `term ${Number(item.term) || ''}`,
      `semester ${Number(item.term) || ''}`,
    ].flat().filter(Boolean).join(' ').toLowerCase();
  }

  function readSubjectCatalogState() {
    const storageKey = privateKey(SUBJECT_CATALOG_STATE_KEY);
    if (!storageKey) return;
    let saved = null;
    try { saved = safeJson(localStorage.getItem(storageKey)); } catch {}
    if (![2, 3].includes(saved?.version)) return;
    state.subjectSelectionConfirmed = saved.version === 3
      ? saved.selectionConfirmed === true
      : Boolean(String(saved.selectedSubject || '').trim())
        && String(saved.selectedSubject || '').trim() !== LEGACY_DEFAULT_SUBJECT;
    state.selectedSubject = state.subjectSelectionConfirmed
      ? String(saved.selectedSubject || '')
      : '';
    state.subjectQuery = String(saved.query || '').slice(0, 160);
    state.subjectOpenYears = new Set(
      Array.isArray(saved.openYears) ? saved.openYears.map(String).slice(0, 8) : [],
    );
    state.subjectOpenTerms = new Set(
      Array.isArray(saved.openTerms) ? saved.openTerms.map(String).slice(0, 24) : [],
    );
    state.subjectSelectorScroll = Math.max(0, Number(saved.selectorScroll) || 0);
    state.subjectPageScroll = Math.max(0, Number(saved.pageScroll) || 0);
    if (PRACTICE_TIMER_MODES.some((item) => item.value === saved.timerMode)) {
      state.preferredTimerMode = saved.timerMode;
    }
  }

  function persistSubjectCatalogState() {
    if (state.track === 'per_subject' && state.screen === 'catalog') {
      const activeTree = document.querySelector('#dd-subject-selector-dialog[open] [data-subject-tree]')
        || document.querySelector('.dd-subject-panel [data-subject-tree]');
      if (activeTree) state.subjectSelectorScroll = activeTree.scrollTop;
      state.subjectPageScroll = Math.max(0, global.scrollY || 0);
    }
    try {
      const storageKey = privateKey(SUBJECT_CATALOG_STATE_KEY);
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify({
        version: 3,
        selectedSubject: state.selectedSubject,
        selectionConfirmed: state.subjectSelectionConfirmed,
        query: state.subjectQuery,
        openYears: [...state.subjectOpenYears],
        openTerms: [...state.subjectOpenTerms],
        selectorScroll: state.subjectSelectorScroll,
        pageScroll: state.subjectPageScroll,
        timerMode: state.preferredTimerMode,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  function ensureSubjectPathOpen(item) {
    if (!item) return;
    state.subjectOpenYears.add(String(Number(item.yearLevel)));
    state.subjectOpenTerms.add(subjectTermKey(item));
  }

  function subjectHierarchyMarkup(selected, prefix) {
    const years = new Map();
    state.catalog.forEach((item) => {
      const year = String(Number(item.yearLevel));
      const term = String(Number(item.term));
      if (!years.has(year)) years.set(year, new Map());
      if (!years.get(year).has(term)) years.get(year).set(term, []);
      years.get(year).get(term).push(item);
    });
    return [...years.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([year, terms]) => {
        const yearOpen = state.subjectOpenYears.has(year) || String(selected?.yearLevel) === year;
        const yearPanelId = `dd-subject-${prefix}-year-${year}`;
        return `<details class="dd-subject-year" data-subject-year="${escapeAttribute(year)}"
          ${yearOpen ? 'open' : ''}>
          <summary class="dd-disclosure-control" aria-expanded="${yearOpen ? 'true' : 'false'}"
            aria-controls="${escapeAttribute(yearPanelId)}"><span>Year ${escapeHtml(year)}</span>
            <span class="dd-subject-chevron" aria-hidden="true"></span></summary>
          <div class="dd-subject-year-body" id="${escapeAttribute(yearPanelId)}">
            ${[...terms.entries()].sort(([left], [right]) => Number(left) - Number(right))
              .map(([term, items]) => {
                const termKey = `${year}-${term}`;
                const termOpen = state.subjectOpenTerms.has(termKey)
                  || subjectTermKey(selected) === termKey;
                const termPanelId = `dd-subject-${prefix}-term-${year}-${term}`;
                return `<details class="dd-subject-term" data-subject-term="${escapeAttribute(termKey)}"
                  ${termOpen ? 'open' : ''}>
                  <summary class="dd-disclosure-control" aria-expanded="${termOpen ? 'true' : 'false'}"
                    aria-controls="${escapeAttribute(termPanelId)}"><span>Term ${escapeHtml(term)}</span>
                    <span class="dd-subject-chevron" aria-hidden="true"></span></summary>
                  <div class="dd-subject-group" id="${escapeAttribute(termPanelId)}">
                    ${items.map((item) => `
                      <button class="dd-choice-control dd-subject-button ${item.subject === selected?.subject ? 'is-selected' : ''}"
                        type="button" data-exam-subject="${escapeAttribute(item.subject)}"
                        aria-label="Select ${escapeAttribute(item.courseCode ? `${item.courseCode}: ${item.subject}` : item.subject)}. ${escapeAttribute(item.progressState || 'Not started')}."
                        data-subject-search="${escapeAttribute(subjectSearchText(item))}"
                        ${item.subject === selected?.subject ? 'aria-current="true"' : ''}>
                        <span class="dd-subject-name">
                          ${item.courseCode ? `<small>${escapeHtml(item.courseCode)}</small>` : ''}
                          <strong>${escapeHtml(item.subject)}</strong>
                        </span>
                        <small class="dd-subject-state is-ready">${escapeHtml(
                          item.progressState || 'Not started',
                        )}</small>
                      </button>`).join('')}
                  </div>
                </details>`;
              }).join('')}
          </div>
        </details>`;
      }).join('');
  }

  function applySubjectFilter(value = state.subjectQuery) {
    const query = String(value || '').trim().toLowerCase().slice(0, 160);
    state.subjectQuery = query;
    document.querySelectorAll('[data-subject-search-input]').forEach((input) => {
      if (input.value !== value) input.value = value;
    });
    document.querySelectorAll('[data-subject-tree]').forEach((tree) => {
      let visibleCount = 0;
      tree.querySelectorAll('.dd-subject-button').forEach((button) => {
        const matches = !query || String(button.dataset.subjectSearch || '').includes(query);
        button.hidden = !matches;
        if (matches) visibleCount += 1;
      });
      tree.querySelectorAll('.dd-subject-term').forEach((details) => {
        const hasMatch = [...details.querySelectorAll('.dd-subject-button')]
          .some((button) => !button.hidden);
        details.hidden = !hasMatch;
        if (query && hasMatch) details.open = true;
      });
      tree.querySelectorAll('.dd-subject-year').forEach((details) => {
        const hasMatch = [...details.querySelectorAll('.dd-subject-button')]
          .some((button) => !button.hidden);
        details.hidden = !hasMatch;
        if (query && hasMatch) details.open = true;
      });
      const result = tree.closest('[data-subject-selector]')?.querySelector('[data-subject-result-count]');
      if (result) {
        result.textContent = `${visibleCount} ${visibleCount === 1 ? 'course' : 'courses'} found`;
      }
      const empty = tree.closest('[data-subject-selector]')?.querySelector('[data-subject-empty]');
      if (empty) empty.hidden = visibleCount > 0;
    });
    persistSubjectCatalogState();
  }

  function closeSubjectSelector() {
    const dialog = document.getElementById('dd-subject-selector-dialog');
    const tree = dialog?.querySelector('[data-subject-tree]');
    if (tree) state.subjectSelectorScroll = tree.scrollTop;
    if (dialog?.open) dialog.close();
    persistSubjectCatalogState();
    const target = state.subjectSelectorReturnFocus;
    state.subjectSelectorReturnFocus = null;
    requestAnimationFrame(() => target?.focus?.());
  }

  function openSubjectSelector(trigger) {
    const dialog = document.getElementById('dd-subject-selector-dialog');
    if (!dialog) return;
    state.subjectSelectorReturnFocus = trigger || document.activeElement;
    if (!dialog.open) dialog.showModal();
    const tree = dialog.querySelector('[data-subject-tree]');
    if (tree) tree.scrollTop = state.subjectSelectorScroll;
    requestAnimationFrame(() => dialog.querySelector('[data-subject-search-input]')?.focus?.());
  }

  function bindSubjectCatalogControls() {
    const dialog = document.getElementById('dd-subject-selector-dialog');
    dialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeSubjectSelector();
    });
    document.querySelectorAll('[data-subject-tree]').forEach((tree) => {
      tree.scrollTop = state.subjectSelectorScroll;
      tree.addEventListener('scroll', () => {
        state.subjectSelectorScroll = tree.scrollTop;
        persistSubjectCatalogState();
      }, { passive: true });
      tree.querySelectorAll('details[data-subject-year], details[data-subject-term]')
        .forEach((details) => details.addEventListener('toggle', () => {
          details.querySelector(':scope > summary')
            ?.setAttribute('aria-expanded', details.open ? 'true' : 'false');
          const year = details.dataset.subjectYear;
          const term = details.dataset.subjectTerm;
          const collection = year ? state.subjectOpenYears : state.subjectOpenTerms;
          const key = year || term;
          if (details.open) collection.add(key);
          else collection.delete(key);
          persistSubjectCatalogState();
        }));
    });
    applySubjectFilter(state.subjectQuery);
    requestAnimationFrame(() => {
      if (state.screen !== 'catalog' || state.track !== 'per_subject') return;
      const tree = document.querySelector('.dd-subject-panel [data-subject-tree]');
      if (tree) tree.scrollTop = state.subjectSelectorScroll;
      if (state.subjectPageScroll > 0) global.scrollTo({ top: state.subjectPageScroll, behavior: 'auto' });
    });
  }

  function chooseSubject(subjectName) {
    const selected = subjectCatalogItem(subjectName);
    if (!selected) return;
    state.selectedSubject = selected.subject;
    state.subjectSelectionConfirmed = true;
    ensureSubjectPathOpen(selected);
    persistSubjectCatalogState();
    const dialog = document.getElementById('dd-subject-selector-dialog');
    if (dialog?.open) {
      const tree = dialog.querySelector('[data-subject-tree]');
      if (tree) state.subjectSelectorScroll = tree.scrollTop;
      dialog.close();
    }
    renderPerSubject();
    requestAnimationFrame(() => {
      const heading = document.getElementById('dd-selected-course-heading');
      const reducedMotion = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      heading?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
      heading?.focus?.({ preventScroll: true });
    });
  }

  function subjectSelectorDialogMarkup(selected) {
    const hierarchy = subjectHierarchyMarkup(selected, 'mobile');
    return `<dialog class="dd-subject-drawer" id="dd-subject-selector-dialog"
      aria-labelledby="dd-subject-selector-title">
      <div class="dd-subject-drawer-shell" data-subject-selector>
        <button class="dd-icon-control dd-exam-dialog-close dd-subject-drawer-close" type="button"
          data-subject-selector-close aria-label="Close course chooser">&times;</button>
        <header>
          <p class="dd-exam-kicker">Syllabus Base Review</p>
          <h2 id="dd-subject-selector-title">Choose a course</h2>
          <label class="dd-subject-search-label" for="dd-subject-search-mobile">Find a course</label>
          <input class="dd-subject-search" id="dd-subject-search-mobile" data-subject-search-input
            type="search" value="${escapeAttribute(state.subjectQuery)}"
            placeholder="Search course, code, year, or term" autocomplete="off">
          <p class="dd-subject-search-help">Search by course title or code, or browse the Year and Term sections.</p>
          <p class="dd-subject-result-count" data-subject-result-count role="status"></p>
        </header>
        <div class="dd-subject-list" data-subject-tree>${hierarchy}</div>
        <p class="dd-subject-empty" data-subject-empty hidden>No matching course was found.</p>
        <footer><button class="dd-control dd-exam-button" type="button" data-subject-selector-close
          aria-label="Close course chooser and return to Syllabus Base Review">Back</button></footer>
      </div>
    </dialog>`;
  }

  function renderPerSubject() {
    const root = pageRoot('per_subject');
    if (!root) return;
    const selected = subjectCatalogItem();
    if (!selected) {
      if (!state.catalog.length) {
        root.innerHTML = `<div class="dd-exam-page dd-subject-study-page"><div class="dd-exam-shell">
          <header class="dd-exam-hero"><div><p class="dd-exam-kicker">Review and retention</p>
            <h1>Syllabus Base Review</h1></div></header>
          <div class="dd-exam-status is-error" role="alert">No Syllabus Base Review courses are available right now.</div>
          <button class="dd-control dd-exam-button is-primary" type="button"
            data-retry-catalog="per_subject">Retry loading courses</button>
        </div></div>`;
        return;
      }
      root.innerHTML = `<div class="dd-exam-page dd-subject-study-page"><div class="dd-exam-shell">
        <header class="dd-exam-hero dd-subject-study-hero">
          <div>
            <p class="dd-exam-kicker">Review and retention</p>
            <h1>Syllabus Base Review</h1>
            <p>Open the governing law when you are ready.</p>
          </div>
        </header>
        <div class="dd-exam-status" role="status" aria-live="polite"></div>
        <section class="dd-subject-selection-callout" aria-labelledby="dd-subject-course-selection-heading">
          <p class="dd-exam-kicker">Your course</p>
          <h2 id="dd-subject-course-selection-heading" tabindex="-1">Choose what you are studying today.</h2>
          <p class="dd-subject-selection-summary">You can change courses at any time.</p>
          <button class="dd-control dd-exam-button is-primary dd-subject-selection-button" type="button"
            data-subject-selector-open aria-haspopup="dialog" aria-controls="dd-subject-selector-dialog"
            aria-describedby="dd-subject-selection-note">
            Browse courses
          </button>
          <p class="dd-subject-selection-note" id="dd-subject-selection-note">Search by course title or code, or browse by year and term.</p>
        </section>
        ${subjectSelectorDialogMarkup(null)}
      </div></div>`;
      bindSubjectCatalogControls();
      return;
    }
    state.selectedSubject = selected.subject;
    ensureSubjectPathOpen(selected);
    root.innerHTML = `<div class="dd-exam-page dd-subject-study-page"><div class="dd-exam-shell">
      <header class="dd-exam-hero dd-subject-study-hero">
        <div>
          <p class="dd-exam-kicker">Review and retention</p>
          <h1>Syllabus Base Review</h1>
        </div>
      </header>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
      <div class="dd-subject-layout is-compact-selector">
        <main class="dd-subject-workspace">
          <header class="dd-selected-heading dd-subject-study-intro" id="dd-selected-course-heading" tabindex="-1">
            <p class="dd-exam-kicker">Year ${Number(selected.yearLevel)} · Term ${Number(selected.term)}</p>
            <h2>${escapeHtml(selected.subject)}</h2>
          </header>
          <section class="dd-subject-study-start" aria-labelledby="dd-subject-study-start-title">
            <div class="dd-subject-study-copy">
              <p class="dd-exam-kicker">Review session</p>
              <h3 id="dd-subject-study-start-title">Begin when you are ready.</h3>
              <p>Questions rotate without repeats. Writing from memory is optional.</p>
            </div>
            <dl class="dd-subject-study-meta">
              <div><dt>Your progress</dt><dd>${escapeHtml(selected.progressState || 'Not started')}</dd></div>
              <div><dt>Current timer</dt><dd>${escapeHtml(practiceTimerLabel())}</dd></div>
            </dl>
            <div class="dd-exam-actions dd-subject-study-actions">
              <button class="dd-control dd-exam-button is-primary" type="button"
                data-subject-start="${escapeAttribute(selected.subject)}"
                data-year="${Number(selected.yearLevel)}" data-term="${Number(selected.term)}">
                Start
              </button>
              <button class="dd-control dd-exam-button is-tertiary" type="button"
                data-subject-selector-open aria-haspopup="dialog" aria-controls="dd-subject-selector-dialog">
                Change course
              </button>
              <button class="dd-control dd-exam-button" type="button" data-subject-timer-settings>
                Timer settings
              </button>
              <button class="dd-control dd-exam-button" type="button"
                data-subject-performance="${escapeAttribute(selected.subject)}">Review my work</button>
            </div>
          </section>
        </main>
      </div>
      ${subjectSelectorDialogMarkup(selected)}
    </div></div>`;
    bindSubjectCatalogControls();
  }

  function curatedBarCards() {
    const items = state.catalog.filter((item) => item.track === 'bar_feels');
    if (!items.length) {
      return `<div class="dd-unavailable">
        Bar Exam Simulation is being prepared for this account.
      </div>`;
    }
    return items.map((item) => `<article class="dd-exam-card">
      <div class="dd-exam-card-head">
        <div><h3>${escapeHtml(item.title)}</h3>
          <p class="dd-exam-description">${escapeHtml(item.subject || 'Curated Philippine law examination')}</p></div>
        <span class="dd-exam-pill">Included with access</span>
      </div>
      <div class="dd-exam-meta">
        <div><small>Questions</small><strong>${Number(item.questionCount)}</strong></div>
        <div><small>Duration</small><strong>${escapeHtml(formatDuration(item.durationSeconds))}</strong></div>
        <div><small>Writing method</small><strong>A.L.A.C.</strong></div>
      </div>
      <div class="dd-exam-actions">
        <button class="dd-exam-button is-primary" data-exam-setup="${escapeHtml(item.versionId)}"
          type="button">Review &amp; Begin</button>
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
          <h1>Bar Exam Simulation</h1>
          <p>Enter one of six Philippine Bar examination blocks. Every block contains
            twenty distinct questions, and no timer begins before you confirm the setup.</p>
        </div>
        <span class="dd-exam-beta">Included with access</span>
      </header>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
      <div class="dd-bar-entry-grid">
        <section class="dd-bar-entry-card">
          <p class="dd-exam-kicker">Curated Route</p>
          <h2>Six Bar Examination Destinations</h2>
          <p>Practice twenty distinct essays in each destination, with individual A.L.A.C.
            assessment and the full suggested answer released under the examination rules.</p>
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
    dialog.setAttribute('aria-labelledby', 'dd-exam-setup-title');
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) dialog.close('cancel');
    });
    document.body.append(dialog);
    return dialog;
  }

  function decisionDialog() {
    let dialog = document.getElementById('dd-exam-decision-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'dd-exam-decision-dialog';
    dialog.className = 'dd-exam-dialog';
    dialog.setAttribute('aria-labelledby', 'dd-exam-decision-title');
    document.body.append(dialog);
    return dialog;
  }

  function confirmDecision(options = {}) {
    const dialog = decisionDialog();
    const subjectMatter = state.track === 'per_subject';
    dialog.classList.toggle('is-subject-matter', subjectMatter);
    const controlClass = subjectMatter ? 'dd-control ' : '';
    const opener = document.activeElement;
    dialog.innerHTML = `<div class="dd-exam-dialog-inner">
      <button class="${subjectMatter ? 'dd-icon-control ' : ''}dd-exam-dialog-close" type="button" data-decision-back
        aria-label="Close confirmation and go back">&times;</button>
      <p class="dd-exam-kicker">Confirm your choice</p>
      <h2 id="dd-exam-decision-title">${escapeHtml(options.title || 'Please confirm')}</h2>
      <p class="dd-exam-description">${escapeHtml(options.copy || '')}</p>
      <div class="dd-exam-dialog-actions">
        <button class="${controlClass}dd-exam-button" type="button" data-decision-back>Back</button>
        <button class="${controlClass}dd-exam-button is-primary" type="button" data-decision-confirm>
          ${escapeHtml(options.confirmLabel || 'Continue')}
        </button>
      </div>
    </div>`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', cancel);
        if (dialog.open) dialog.close(confirmed ? 'confirm' : 'cancel');
        if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
        resolve(confirmed);
      };
      const cancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      dialog.querySelectorAll('[data-decision-back]').forEach((button) => (
        button.addEventListener('click', () => finish(false))
      ));
      dialog.querySelector('[data-decision-confirm]').addEventListener('click', () => finish(true));
      dialog.addEventListener('cancel', cancel);
      dialog.showModal();
      requestAnimationFrame(() => dialog.querySelector('[data-decision-confirm]')?.focus());
    });
  }

  function openSubjectTimerSettings() {
    const dialog = setupDialog();
    dialog.classList.add('is-subject-matter');
    const opener = document.activeElement;
    dialog.innerHTML = `<div class="dd-exam-dialog-inner">
      <button class="dd-icon-control dd-exam-dialog-close" type="button" data-dialog-close
        aria-label="Close timer settings">&times;</button>
      <p class="dd-exam-kicker">Syllabus Base Review</p>
      <h2 id="dd-exam-setup-title">Timer settings</h2>
      <p class="dd-exam-description">Choose how you want to practice. Stopwatch is the default, and no clock starts until you select Start.</p>
      <fieldset class="dd-timer-options">
        <legend class="sr-only">Practice timer</legend>
        ${PRACTICE_TIMER_MODES.map((item) => `<label class="dd-timer-option">
          <input type="radio" name="dd-practice-timer" value="${item.value}"
            ${item.value === state.preferredTimerMode ? 'checked' : ''}>
          <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span>
        </label>`).join('')}
      </fieldset>
      <div class="dd-exam-dialog-actions">
        <button class="dd-control dd-exam-button" type="button" data-dialog-cancel>Back</button>
        <button class="dd-control dd-exam-button is-primary" type="button" data-timer-apply>Apply setting</button>
      </div>
    </div>`;
    const finish = (apply = false) => {
      if (apply) {
        const selected = dialog.querySelector('input[name="dd-practice-timer"]:checked')?.value;
        if (PRACTICE_TIMER_MODES.some((item) => item.value === selected)) {
          state.preferredTimerMode = selected;
          const storageKey = privateKey('duediligence.subject-matter.timer-mode.v1');
          try { if (storageKey) localStorage.setItem(storageKey, selected); } catch {}
          renderPerSubject();
        }
      }
      if (dialog.open) dialog.close(apply ? 'apply' : 'cancel');
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
    dialog.querySelector('[data-dialog-close]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-timer-apply]').addEventListener('click', () => finish(true));
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector('input:checked')?.focus());
  }

  async function openSetup(versionId) {
    setStatus('Preparing your examination…');
    try {
      const setup = await api('/examinations/query', { operation: 'setup', versionId });
      state.setup = setup;
      const dialog = setupDialog();
      const modes = [
        ['strict', '12-minute practice', 'Practice answering within a focused 12-minute target.'],
        ['selfPaced', 'Stopwatch', 'See how much time you spend on the question.'],
        ['none', 'Untimed practice', 'Write without a clock or time limit.'],
      ].filter(([mode]) => (setup.allowedTimerModes || []).includes(mode));
      const compact = setup.track === 'per_subject';
      dialog.classList.toggle('is-subject-matter', compact);
      const controlClass = compact ? 'dd-control ' : '';
      dialog.innerHTML = `<div class="dd-exam-dialog-inner">
        <button class="${compact ? 'dd-icon-control ' : ''}dd-exam-dialog-close" type="button" data-dialog-close
          aria-label="Close time-mode selection">&times;</button>
        <p class="dd-exam-kicker">${escapeHtml(compact ? 'Syllabus Base Review' : 'Bar Exam Simulation')}</p>
        <h2 id="dd-exam-setup-title">${escapeHtml(compact ? setup.subject : setup.title)}</h2>
        <p class="dd-exam-description">${compact
          ? 'Choose how you want to time this question. The clock starts only after you begin.'
          : `This examination uses its existing ${formatDuration(setup.durationSeconds)} countdown. The clock starts only after you begin.`}</p>
        ${compact ? '' : `<dl>
          <dt>Examination</dt><dd>${escapeHtml(setup.subject || 'Curated mixed block')}</dd>
          <dt>Questions</dt><dd>${Number(setup.questionCount)}</dd>
          <dt>Duration</dt><dd>${escapeHtml(formatDuration(setup.durationSeconds))}</dd>
        </dl>`}
        ${compact ? `<label class="dd-exam-field">Timer mode
          <select id="dd-setup-timer">
            ${modes.map(([mode, title, copy]) => `<option value="${mode}"
              ${mode === state.preferredTimerMode ? 'selected' : ''}>${escapeHtml(title)} — ${escapeHtml(copy)}</option>`).join('')}
          </select>
        </label>` : ''}
        <div class="dd-exam-dialog-actions">
          <button class="${controlClass}dd-exam-button" type="button" data-dialog-cancel>Back</button>
          <button class="${controlClass}dd-exam-button is-primary" type="button" data-exam-begin>${compact ? 'Begin review' : 'Begin examination'}</button>
        </div>
      </div>`;
      dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-exam-begin]').addEventListener('click', beginExamination);
      dialog.showModal();
      setStatus('');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function startSubjectSetup(setup, options = {}) {
    const practiceTimerMode = PRACTICE_TIMER_MODES.some(
      (item) => item.value === options.practiceTimerMode,
    ) ? options.practiceTimerMode : state.preferredTimerMode;
    state.setup = setup;
    const active = await api('/examinations/command', {
      operation: 'start_attempt',
      versionId: setup.versionId,
      // Subject Matter's 12-minute target is advisory. The server stopwatch
      // preserves the draft without auto-submitting when the target ends.
      timerMode: practiceTimerMode === 'strict' ? 'selfPaced' : practiceTimerMode,
      requestKey: requestKey('start'),
      tabToken: tabToken(),
    });
    active.practiceTimerMode = practiceTimerMode;
    activateAttempt(active);
    return active;
  }

  async function requestSubjectQuestion(options = {}) {
    const selected = subjectCatalogItem(options.subject || state.selectedSubject);
    if (!selected) return;
    setStatus('Selecting a new question from your no-repeat cycle…');
    try {
      const selection = await api('/examinations/query', {
        operation: 'subject_next',
        subject: selected.subject,
        yearLevel: Number(selected.yearLevel),
        term: Number(selected.term),
        resetCycle: options.resetCycle === true,
      });
      if (selection.exhausted) {
        const restart = await confirmDecision({
          title: 'Start a new randomized cycle?',
          copy: `You completed every available ${selected.subject} question in this cycle. Your performance history will remain available.`,
          confirmLabel: 'Start new cycle',
        });
        if (restart) {
          await requestSubjectQuestion({ subject: selected.subject, resetCycle: true });
        } else {
          setStatus('Cycle complete. Your performance history remains available.', 'success');
        }
        return;
      }
      state.setup = selection.setup;
      if (options.autoStart === true) {
        await startSubjectSetup(selection.setup, {
          practiceTimerMode: state.preferredTimerMode,
        });
        return;
      }
      await openSetup(selection.setup.versionId);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function beginExamination() {
    if (!state.setup) return;
    const button = document.querySelector('[data-exam-begin]');
    if (button) button.disabled = true;
    try {
      const isBarFeels = state.setup.track === 'bar_feels';
      const timerMode = isBarFeels
        ? 'strict'
        : document.getElementById('dd-setup-timer')?.value || state.setup.timerMode;
      if (!isBarFeels) state.preferredTimerMode = timerMode;
      const active = await api('/examinations/command', {
        operation: 'start_attempt',
        versionId: state.setup.versionId,
        timerMode,
        requestKey: requestKey('start'),
        tabToken: tabToken(),
      });
      const dialog = setupDialog();
      if (dialog.open) dialog.close('begin');
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
      if (local.answerText !== question.answerText) {
        return {
          ...question,
          localRecoveryText: local.answerText,
          localRecoveryHtml: local.answerHtml ? sanitizeRichHtml(local.answerHtml) : '',
        };
      }
      return {
        ...question,
        answerHtml: local.answerHtml ? sanitizeRichHtml(local.answerHtml) : question.answerHtml,
      };
    });
    return active;
  }

  function activateAttempt(active) {
    stopActiveTimers();
    const recovery = readRecovery();
    state.active = reconcileRecovery(active);
    state.pendingSubjectSkip = recovery?.attemptId === state.active?.attempt?.attemptId
      && /^[A-Za-z0-9_-]{16,128}$/.test(String(recovery.pendingSubjectSkipRequestKey || ''))
      ? {
        attemptId: state.active.attempt.attemptId,
        requestKey: recovery.pendingSubjectSkipRequestKey,
      }
      : null;
    state.practiceTimerMode = state.active.examination.track === 'per_subject'
      ? active.practiceTimerMode || recovery?.practiceTimerMode || state.preferredTimerMode
      : state.active.attempt.timerMode;
    state.currentIndex = Math.min(
      Number(readRecovery()?.currentIndex) || 0,
      Math.max(0, state.active.questions.length - 1),
    );
    state.screen = 'room';
    state.clientElapsed = Number(state.active.attempt.elapsedSeconds) || 0;
    state.clientRemaining = state.active.examination.track === 'per_subject'
      && state.practiceTimerMode === 'strict'
      ? Math.max(0, 720 - state.clientElapsed)
      : state.active.attempt.remainingSeconds;
    state.serverSyncAt = Date.now();
    state.expiryInFlight = false;
    showTrackPage(state.active.examination.track);
    renderRoom();
    if (state.active.examination.track === 'per_subject') {
      focusRendered(pageRoot('per_subject'), '#dd-subject-question-title');
    }
    saveRecovery();
    resumeActiveClock();
    history.pushState({ dueDiligenceExamination: state.active.attempt.attemptId }, '', location.href);
  }

  async function resumeAttempt(attemptId, options = {}) {
    if (!attemptId) return { status: 'no_match', active: null };
    const expectedTrack = String(options.expectedTrack || '').trim();
    if (state.active?.attempt?.attemptId === attemptId) {
      if (expectedTrack && state.active?.examination?.track !== expectedTrack) {
        return { status: 'no_match', active: null };
      }
      return { status: 'restored', active: state.active };
    }
    state.resumeAttemptId = attemptId;
    const ownerUserId = currentUserId();
    setStatus('Recovering your server-saved examination…');
    try {
      const active = await api('/examinations/query', {
        operation: 'resume',
        attemptId,
      });
      if (!ownerUserId || currentUserId() !== ownerUserId || options.isCurrent?.() === false) {
        return { status: 'stale', active: null };
      }
      if (expectedTrack && active?.examination?.track !== expectedTrack) {
        return { status: 'no_match', active: null };
      }
      activateAttempt(active);
      heartbeat(false).catch(() => {});
      return { status: 'restored', active: state.active };
    } catch (error) {
      if (isStaleIdentityError(error)) return { status: 'stale', active: null };
      setStatus(error.message, 'error');
      return { status: 'retryable_error', active: null };
    } finally {
      if (state.resumeAttemptId === attemptId) state.resumeAttemptId = null;
    }
  }

  async function restoreRoute(track, options = {}) {
    const recovery = readRecovery();
    if (!recovery?.attemptId || !global.DueDiligencePhase4?.getSession?.()?.access_token) {
      return { status: 'no_match', active: null };
    }
    state.track = track;
    showTrackPage(track);
    return resumeAttempt(recovery.attemptId, {
      expectedTrack: track,
      isCurrent: options.isCurrent,
    });
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

  const SUBJECT_QUESTION_TYPES = new Set([
    'problem', 'definition', 'explanation', 'enumeration', 'distinction',
    'procedure', 'practical', 'doctrine', 'mixed', 'other',
  ]);

  function inferSubjectQuestionType(question = {}) {
    const explicit = String(
      question.questionType
      || question.rubricBreakdown?.questionType
      || question.assessment?.rubricBreakdown?.questionType
      || '',
    ).trim().toLowerCase();
    if (SUBJECT_QUESTION_TYPES.has(explicit)) return explicit;
    const prompt = String(question.prompt || question.question || '').trim();
    const lower = prompt.toLowerCase();
    const subparts = prompt.match(/(?:^|\n)\s*\(?[a-d]\)?[.)]\s+/gim) || [];
    if (subparts.length >= 2) return 'mixed';
    if (/^\s*(?:distinguish|differentiate|compare|contrast)\b/i.test(prompt)
      || /what (?:is|are) the differences?\b|how\s+\w+[\s\S]{0,100}\bdiffer\b/i.test(prompt)) {
      return 'distinction';
    }
    if (/^\s*(?:enumerate|list|name)\b/i.test(prompt)
      || /what (?:are|is) the (?:[a-z-]+\s+){0,3}(?:elements?|requisites?|requirements?|grounds?|instances?|exceptions?|kinds?|types?|classes?|modes?|effects?|rights?|duties?)\b/i.test(prompt)) {
      return 'enumeration';
    }
    if (/^\s*(?:define|what is meant by|give the meaning of|what is the legal meaning of)\b/i.test(prompt)) {
      return 'definition';
    }
    if (/\b(?:proper procedure|procedural steps?|remedy|motion|petition|appeal|filed?|filing|period to|how should|what should .* do)\b/i.test(lower)) {
      return 'procedure';
    }
    if (/^\s*(?:state|explain|discuss|identify)\s+(?:the\s+)?(?:controlling\s+)?doctrine\b/i.test(prompt)
      || /\bwhat doctrine\b|\bdoctrinal rule\b/i.test(lower)) {
      return 'doctrine';
    }
    if (/^\s*(?:draft|prepare|write|formulate)\b/i.test(prompt)) return 'practical';
    if (/^\s*(?:explain|discuss|state|describe|identify)\b/i.test(prompt)) return 'explanation';
    return 'problem';
  }

  function subjectPracticeRoomMarkup({ question, timerMode }) {
    const course = state.active.examination.subject || state.selectedSubject || 'Selected course';
    const answerText = question.answerText || '';
    const attemptId = state.active.attempt.attemptId;
    const assisted = state.active.attempt.assisted === true;
    const reviewConfirmationPending = state.active.attempt.reviewConfirmationPending === true;
    return `<div class="dd-subject-editorial">
      <header class="dd-subject-editorial-header">
        <div>
          <p class="dd-exam-kicker">Review and retention</p>
          <p class="dd-subject-breadcrumb"><span>Practice Exam</span><b aria-hidden="true">/</b> Syllabus Base Review</p>
          <h1>Syllabus Base Review</h1>
        </div>
        <div class="dd-subject-course-picker">
          <p>Current course</p>
          <button class="dd-picker-control dd-subject-course-control" type="button" data-subject-change-course
            aria-haspopup="dialog"
            aria-label="${escapeAttribute(course)} — change course. Opens the searchable Year, Term, and Course chooser.">
            <strong>${escapeHtml(course)}</strong>
            <span>Change course</span>
          </button>
        </div>
      </header>
      <div class="dd-subject-editorial-grid">
        <main class="dd-subject-editorial-pane is-writing dd-subject-practice-answer" aria-labelledby="dd-subject-question-title">
          <div class="dd-subject-question-block">
            <div class="dd-subject-question-meta">
              <p class="dd-question-label">${escapeHtml(course)}</p>
              <span class="dd-subject-attempt-badge ${assisted ? 'is-assisted' : 'is-unassisted'}"
                data-subject-attempt-classification>${assisted ? 'Assisted / Open-book' : 'Unassisted'}</span>
            </div>
            <p class="dd-subject-task-label">Your practice question</p>
            <h2 class="dd-question-prompt" id="dd-subject-question-title" tabindex="-1">${escapeHtml(question.prompt)}</h2>
          </div>
          <div class="dd-subject-answer-heading">
            <div><p class="dd-exam-kicker">Your response</p><h3 id="dd-subject-answer-title">Write your answer</h3></div>
          </div>
          ${question.localRecoveryText != null ? `<div class="dd-exam-status is-error">
            A newer local draft differs from the server revision.
            <button class="dd-control dd-exam-button" type="button" data-use-local-draft>Restore local draft</button>
          </div>` : ''}
          <section class="dd-answer-card">
            <label class="sr-only" for="dd-answer-editor">Your answer</label>
            <textarea class="dd-answer-editor" id="dd-answer-editor" maxlength="20000">${escapeHtml(answerText)}</textarea>
            <footer class="dd-answer-footer">
              <span id="dd-word-count">${wordCount(answerText)} words</span>
              <span class="dd-save-state is-saved" id="dd-save-state">${Number(question.revision) > 0 ? 'Saved' : 'Ready to save'}</span>
            </footer>
          </section>
          <div class="dd-subject-writing-status">
            <div class="dd-subject-practice-clock ${timerMode === 'none' ? 'is-hidden' : ''}" id="dd-room-clock">
              <small>${timerMode === 'strict' ? 'Time remaining' : 'Writing time'}</small>
              <strong id="dd-room-clock-value">${formatClock(
                timerMode === 'strict' ? state.clientRemaining : state.clientElapsed,
              )}</strong>
            </div>
          </div>
          <nav class="dd-subject-practice-actions" aria-label="Syllabus Base Review practice actions">
            <button class="dd-control dd-exam-button is-primary" data-submit-current type="button"
              ${answerText.trim() && !reviewConfirmationPending ? '' : 'disabled'}>Submit for coaching</button>
            <button class="dd-control dd-exam-button" id="dd-subject-flag-button" type="button"
              aria-pressed="${question.flagged === true ? 'true' : 'false'}">
              ${question.flagged === true ? 'Flagged for later' : 'Flag for later'}
            </button>
            <button class="dd-control dd-exam-button" data-subject-skip type="button"
              aria-describedby="dd-subject-skip-note">Skip question</button>
            <button class="dd-control dd-exam-button is-tertiary" data-return-catalog type="button">Return to courses</button>
          </nav>
          <p class="dd-subject-action-note" id="dd-subject-skip-note">Skip saves this draft but does not submit or score it.</p>
          <div class="dd-exam-status dd-subject-writing-status-message" data-subject-writing-status
            role="status" aria-live="polite" aria-atomic="true"></div>
        </main>
        <aside class="dd-subject-editorial-pane is-reading is-review-panel"
          aria-label="Suggested answer and legal review">
          ${subjectReviewPanelMarkup({
            attemptId,
            questionId: question.questionId,
            assisted,
            submitted: false,
          })}
        </aside>
      </div>
    </div>`;
  }

  function renderRoom() {
    const root = pageRoot(state.active?.examination?.track || state.track);
    if (!root || !state.active) return;
    const question = currentQuestion();
    const summary = counts();
    const timerMode = state.active.examination.track === 'per_subject'
      ? state.practiceTimerMode
      : state.active.attempt.timerMode;
    const singleSubject = state.active.examination.track === 'per_subject'
      && state.active.questions.length === 1;
    const subjectPractice = state.active.examination.track === 'per_subject';
    const richWriting = state.active.examination.track === 'bar_feels';
    const safeAnswerHtml = richWriting
      ? sanitizeRichHtml(question.answerHtml || richHtmlFromText(question.answerText || ''))
      : '';
    if (subjectPractice) {
      root.innerHTML = subjectPracticeRoomMarkup({ question, timerMode });
      bindRoom(root);
      restoreRevealedSubjectReview(root);
      updateClockNode();
      return;
    }
    root.innerHTML = `<div class="dd-exam-room">
      <header class="dd-exam-room-bar">
        <div class="dd-room-brand"><strong>Due Diligence</strong><span>PH BAR EXAM SIMULATOR</span></div>
        <div class="dd-exam-room-title">
          <h1>${escapeHtml(state.active.examination.title)}</h1>
          <span>${state.active.examination.track === 'bar_feels'
            ? 'BAR EXAM SIMULATION'
            : 'SYLLABUS BASE REVIEW'} &middot;
            ${escapeHtml(state.active.examination.subject || 'Curated examination')}</span>
        </div>
        <div class="dd-room-clock ${timerMode === 'none' ? 'is-hidden' : ''}" id="dd-room-clock">
          <small>${timerMode === 'strict' ? 'Overall time remaining' : 'Total writing time'}</small>
          <strong id="dd-room-clock-value">${formatClock(
            timerMode === 'strict' ? state.clientRemaining : state.clientElapsed,
          )}</strong>
        </div>
      </header>
      <div class="dd-exam-room-layout ${singleSubject ? 'is-single-question' : ''}">
        ${singleSubject ? '' : `<aside class="dd-question-rail">
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
        </aside>`}
        <main class="dd-writing-workspace">
          <p class="dd-question-label">${singleSubject ? 'Your practice question' : `Question ${state.currentIndex + 1} of ${summary.total}`}</p>
          <div class="dd-question-prompt">${escapeHtml(question.prompt)}</div>
          ${question.localRecoveryText != null ? `<div class="dd-exam-status is-error">
            A newer local draft differs from the server revision.
            <button class="dd-exam-button" type="button" data-use-local-draft>Restore local draft</button>
          </div>` : ''}
          <section class="dd-answer-card">
            ${subjectPractice ? '' : `<div class="dd-alac-guide">
              <span>I. Answer</span><span>II. Legal Basis</span>
              <span>III. Application</span><span>IV. Conclusion</span>
            </div>`}
            <label class="sr-only" for="dd-answer-editor">${subjectPractice ? 'Your response' : 'Your ALAC answer'}</label>
            ${richWriting ? `${richToolbar()}
            <div class="dd-answer-editor dd-answer-rich-editor" id="dd-answer-rich-editor"
              contenteditable="true" role="textbox" aria-multiline="true"
              aria-label="Your ALAC answer" data-placeholder="I. ANSWER — State your direct answer.&#10;&#10;II. LEGAL BASIS — Cite the governing provision or doctrine.&#10;&#10;III. APPLICATION — Apply the exact facts to the law.&#10;&#10;IV. CONCLUSION — Reaffirm your position.">${safeAnswerHtml}</div>
            <textarea id="dd-answer-editor" class="dd-answer-editor-backup" maxlength="20000"
              aria-hidden="true" tabindex="-1">${escapeHtml(question.answerText || '')}</textarea>` : `<textarea class="dd-answer-editor" id="dd-answer-editor" maxlength="20000"
              ${subjectPractice ? '' : `placeholder="${escapeAttribute(writingGuide.placeholder)}"`}>${escapeHtml(question.answerText || '')}</textarea>`}
            <footer class="dd-answer-footer">
              <span id="dd-word-count">${wordCount(question.answerText)} words</span>
              <span class="dd-save-state is-saved" id="dd-save-state">Server revision ${Number(question.revision) || 0}</span>
            </footer>
          </section>
        </main>
        ${singleSubject ? '' : `<aside class="dd-exam-status-rail">
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
        </aside>`}
      </div>
      <nav class="dd-room-bottom" aria-label="Question navigation">
        ${singleSubject ? `
          <button class="dd-exam-button" data-return-catalog type="button">Return to catalog</button>
          <span class="dd-room-bottom-status" data-current-word-status>${wordCount(question.answerText)} words &middot;
            ${timerMode === 'strict' ? `${formatClock(state.clientRemaining)} remaining` : 'Autosave active'}</span>
          <button class="dd-exam-button is-primary" data-submit-current type="button"
            ${question.answerText?.trim() ? '' : 'disabled'}>Submit Answer</button>
        ` : `
          <button class="dd-exam-button" data-question-prev type="button"
            ${state.currentIndex === 0 ? 'disabled' : ''}>Previous</button>
          <span class="dd-room-bottom-status" data-current-word-status>${wordCount(question.answerText)} words &middot;
            ${timerMode === 'strict' ? `${formatClock(state.clientRemaining)} remaining` : 'Autosave active'}</span>
          <button class="dd-exam-button is-primary" data-question-next type="button">
            ${state.currentIndex === summary.total - 1 ? 'Review All' : 'Next Question'}
          </button>
        `}
      </nav>
    </div>`;
    bindRoom(root);
    updateClockNode();
  }

  function bindRoom(root) {
    const editor = root.querySelector('#dd-answer-editor');
    const richEditor = root.querySelector('#dd-answer-rich-editor');
    const updateAnswer = () => {
      const question = currentQuestion();
      const answerText = richEditor ? plainTextFromRich(richEditor) : editor.value;
      question.answerText = answerText;
      if (richEditor) {
        question.answerHtml = sanitizeRichHtml(richEditor.innerHTML);
        editor.value = answerText;
      }
      question.localRecoveryText = null;
      question.localRecoveryHtml = null;
      root.querySelector('#dd-word-count').textContent = `${wordCount(answerText)} words`;
      const bottomStatus = root.querySelector('[data-current-word-status]');
      if (bottomStatus) {
        const timerMode = state.active.examination.track === 'per_subject'
          ? state.practiceTimerMode : state.active.attempt.timerMode;
        bottomStatus.textContent = `${wordCount(answerText)} words · ${timerMode === 'strict'
          ? `${formatClock(state.clientRemaining)} remaining` : 'Autosave active'}`;
      }
      const submit = root.querySelector('[data-submit-current]');
      if (submit) submit.disabled = !answerText.trim() || subjectReviewSubmissionBlocked();
      const stateNode = root.querySelector('#dd-save-state');
      if (stateNode) {
        stateNode.textContent = 'Unsaved changes';
        stateNode.className = 'dd-save-state is-saving';
      }
      updateCountsNodes();
      saveRecovery();
      scheduleSave();
    };
    (richEditor || editor)?.addEventListener('input', updateAnswer);
    richEditor?.addEventListener('paste', (event) => {
      event.preventDefault();
      const html = event.clipboardData?.getData('text/html') || '';
      const plain = event.clipboardData?.getData('text/plain') || '';
      document.execCommand(html ? 'insertHTML' : 'insertText', false,
        html ? sanitizeRichHtml(html) : plain);
      updateAnswer();
    });
    richEditor?.addEventListener('drop', (event) => {
      if (event.dataTransfer?.files?.length) event.preventDefault();
    });
    root.querySelectorAll('[data-rich-command]').forEach((control) => {
      control.addEventListener('mousedown', (event) => event.preventDefault());
      control.addEventListener('click', () => {
        richEditor?.focus();
        const command = control.dataset.richCommand;
        const value = command === 'formatBlock' ? 'p'
          : command === 'hiliteColor' ? '#fff3a3' : null;
        document.execCommand(command, false, value);
        updateAnswer();
      });
    });
    root.querySelector('[data-rich-font]')?.addEventListener('change', (event) => {
      richEditor?.focus();
      document.execCommand('fontName', false, event.target.value);
      updateAnswer();
    });
    root.querySelector('[data-rich-size]')?.addEventListener('change', (event) => {
      richEditor?.focus();
      document.execCommand('fontSize', false, event.target.value);
      updateAnswer();
    });
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveCurrent(), AUTOSAVE_MS);
  }

  async function saveCurrent(options = {}) {
    const question = currentQuestion();
    if (!question || !state.active) return true;
    const root = pageRoot(state.active?.examination?.track || state.track);
    const editor = root?.querySelector('#dd-answer-editor');
    if (editor) question.answerText = editor.value;
    if (state.saveInFlight) {
      state.pendingSave = true;
      return false;
    }
    state.saveInFlight = true;
    const answerSnapshot = question.answerText || '';
    const flaggedSnapshot = question.flagged === true;
    const revisionSnapshot = Number(question.revision) || 0;
    const saveNode = root?.querySelector('#dd-save-state');
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
        answerText: answerSnapshot,
        expectedRevision: revisionSnapshot,
        flagged: flaggedSnapshot,
      });
      const newerLocalChanges = (question.answerText || '') !== answerSnapshot
        || (question.flagged === true) !== flaggedSnapshot;
      question.revision = result.revision;
      question.savedAt = result.savedAt;
      if (newerLocalChanges) {
        state.pendingSave = true;
      } else {
        question.answerText = result.answerText;
        question.flagged = result.flagged;
        question.localRecoveryText = null;
        question.localRecoveryHtml = null;
      }
      state.active.attempt.lastSavedAt = result.savedAt;
      if (Number.isFinite(Number(result.remainingSeconds))) {
        state.clientRemaining = Number(result.remainingSeconds);
        state.serverSyncAt = Date.now();
      }
      if (saveNode) {
        saveNode.textContent = newerLocalChanges
          ? 'Unsaved changes'
          : `Saved ${formatDate(result.savedAt)}`;
        saveNode.className = newerLocalChanges
          ? 'dd-save-state is-saving'
          : 'dd-save-state is-saved';
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
      state.clientElapsed = Number(result.elapsedSeconds) || state.clientElapsed;
      state.clientRemaining = state.active.examination.track === 'per_subject'
        && state.practiceTimerMode === 'strict'
        ? Math.max(0, 720 - state.clientElapsed)
        : result.remainingSeconds;
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
    const practiceAttempt = state.active.examination.track === 'per_subject';
    const mode = practiceAttempt ? state.practiceTimerMode : state.active.attempt.timerMode;
    if (mode === 'strict' && Number.isFinite(Number(state.clientRemaining))) {
      state.clientRemaining = Math.max(0, Number(state.clientRemaining) - 1);
      if (state.clientRemaining === 0 && practiceAttempt && !state.expiryInFlight) {
        state.expiryInFlight = true;
        flushCurrentSave().finally(() => {
          setStatus('The 12-minute target has ended. Your answer is safe; submit when ready.', 'error');
        });
      }
      if (state.clientRemaining === 0 && !practiceAttempt && !state.expiryInFlight) {
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
    const strict = (state.active.examination.track === 'per_subject'
      ? state.practiceTimerMode
      : state.active.attempt.timerMode) === 'strict';
    const seconds = strict ? state.clientRemaining : state.clientElapsed;
    value.textContent = formatClock(seconds);
    clock.classList.toggle('is-warning', strict && Number(seconds) <= 300);
  }

  function pauseActiveClock() {
    clearInterval(state.heartbeatTimer);
    clearInterval(state.clockTimer);
    state.heartbeatTimer = null;
    state.clockTimer = null;
  }

  function resumeActiveClock() {
    if (!state.active || !['room', 'review'].includes(state.screen)
        || document.visibilityState === 'hidden') return;
    if (!state.clockTimer) state.clockTimer = setInterval(tickClock, 1000);
    if (!state.heartbeatTimer) {
      state.heartbeatTimer = setInterval(() => heartbeat(false), HEARTBEAT_MS);
    }
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
      requestAnimationFrame(() => pageRoot('per_subject')
        ?.querySelector('#dd-subject-flag-button')?.focus());
    } catch (error) {
      notify(error.message, 'warn');
    }
  }

  async function skipCurrentSubjectQuestion(button) {
    const question = currentQuestion();
    if (!question || !state.active || state.active.examination.track !== 'per_subject') return;
    const confirmed = await confirmDecision({
      title: 'Skip this question?',
      copy: 'Your draft and any flag will remain saved. This question will not be submitted, assessed, or counted in your performance. A different question will open.',
      confirmLabel: 'Skip question',
    });
    if (!confirmed || !state.active) return;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const attemptId = state.active.attempt.attemptId;
    const pendingSkip = state.pendingSubjectSkip?.attemptId === attemptId
      ? state.pendingSubjectSkip
      : null;
    const skipRequestKey = pendingSkip?.requestKey || subjectSkipRequestKey(attemptId);
    let skipResult = null;
    setStatus(pendingSkip
      ? 'Confirming the same safe skip request…'
      : 'Saving this draft before opening a different question…');
    try {
      if (!pendingSkip) {
        if (!await flushCurrentSave()) {
          throw new Error('The latest draft could not be confirmed. The question was not skipped.');
        }
        state.pendingSubjectSkip = { attemptId, requestKey: skipRequestKey };
        saveRecovery();
      }
      skipResult = await api('/examinations/command', {
        operation: 'subject_skip_question',
        attemptId,
        requestKey: skipRequestKey,
        tabToken: tabToken(),
      });
      if (!skipResult?.skipped || !skipResult?.setup?.versionId) {
        throw new Error('The next question could not be prepared safely.');
      }

      pauseActiveClock();
      clearRecovery();
      await startSubjectSetup(skipResult.setup, {
        practiceTimerMode: state.practiceTimerMode,
      });
      notify(
        skipResult.flaggedForLater
          ? 'Question skipped without a score and kept in Flagged for later.'
          : 'Question skipped. No submission or score was recorded.',
        'ok',
      );
    } catch (error) {
      if (skipResult?.skipped) {
        stopActiveTimers();
        clearRecovery();
        state.active = null;
        state.setup = null;
        state.screen = 'catalog';
        await loadCatalog('per_subject');
        setStatus('The question was skipped without a score. Select Start to open the next question.', 'success');
      } else {
        // Preserve the key when the response is ambiguous. If the server
        // committed before the connection failed, the next click replays that
        // exact mutation and does not try to save against a closed attempt.
        if (String(error?.code || '').startsWith('EXAM_')) {
          state.pendingSubjectSkip = null;
        }
        saveRecovery();
        setStatus(error.message, 'error');
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  async function retryFlaggedSubjectQuestion(button) {
    const versionId = String(button?.dataset.subjectRetryFlagged || '').trim();
    const subject = String(button?.dataset.subject || state.selectedSubject || '').trim();
    if (!versionId || !subject) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus('Opening this flagged question as a new practice attempt…');
    try {
      state.selectedSubject = subject;
      state.subjectSelectionConfirmed = true;
      persistSubjectCatalogState();
      // This deliberate retry starts the stored version directly. It does not
      // mutate subject_matter_cycles, whose already-selected next question and
      // no-repeat order remain intact.
      await startSubjectSetup({ versionId }, {
        practiceTimerMode: state.preferredTimerMode,
      });
      notify('Flagged question reopened. It will leave the queue after a later submission.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
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

  async function submitCurrentSubjectAnswer(button) {
    const question = currentQuestion();
    if (!question?.answerText?.trim() || !state.active) return;
    if (subjectReviewSubmissionBlocked()) {
      button.disabled = true;
      setStatus('Submission remains paused until Due Diligence confirms whether the review was opened. Retry the review first.', 'error');
      return;
    }
    const alreadySubmitted = Boolean(state.active.attempt.submittedAt)
      || ['submitted', 'expired'].includes(state.active.attempt.status);
    const idleLabel = alreadySubmitted ? 'Retry assessment' : 'Submit for coaching';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = idleLabel;
    setStatus(alreadySubmitted
      ? 'Your submitted answer is preserved. Retrying the assessment only…'
      : 'Saving your answer before assessment…');
    try {
      if (!alreadySubmitted) {
        if (!await flushCurrentSave()) {
          throw new Error('Your latest answer could not be confirmed. Nothing was submitted.');
        }
        const receipt = await api('/examinations/command', {
          operation: 'submit_attempt',
          attemptId: state.active.attempt.attemptId,
          tabToken: tabToken(),
          requestKey: requestKey('submit'),
          confirmed: true,
        });
        stopActiveTimers();
        state.active.attempt.status = receipt.status;
        state.active.attempt.submittedAt = receipt.submittedAt;
      }
      setStatus('Your answer is preserved. Due Diligence is preparing the coaching assessment…');
      const maximumBatches = Math.max(2, state.active.questions.length + 1);
      let result = null;
      let transientRetries = 0;
      for (let batch = 0; batch < maximumBatches; batch += 1) {
        try {
          result = await api('/examinations/command', {
            operation: 'request_ai_grading',
            attemptId: state.active.attempt.attemptId,
            requestKey: requestKey('ai'),
          });
          transientRetries = 0;
        } catch (error) {
          if (error?.code === 'MALFORMED_MODEL_RESPONSE' && transientRetries < 1) {
            transientRetries += 1;
            batch -= 1;
            setStatus('The examiner response was incomplete. Retrying once safely…');
            continue;
          }
          throw error;
        }
        if (result.status === 'completed') break;
      }
      if (result?.status !== 'completed') {
        throw new Error('Assessment paused before completion. Your submitted answer is preserved.');
      }
      await openVerdict(state.active.attempt.attemptId);
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = subjectReviewSubmissionBlocked() || !currentQuestion()?.answerText?.trim();
      button.removeAttribute('aria-busy');
      button.textContent = state.active?.attempt?.submittedAt ? 'Retry assessment' : 'Submit for coaching';
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
        ? state.active?.examination?.track === 'bar_feels'
          ? 'The examination countdown expired and the full examination was submitted automatically.'
          : 'The timed examination ended and the full examination was submitted automatically.'
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
        <button class="dd-exam-button" type="button" data-exam-verdict="${escapeHtml(receipt.attemptId || state.active?.attempt?.attemptId)}">Open assessment</button>
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
      let transientRetries = 0;
      for (let batch = 0; batch < maximumBatches; batch += 1) {
        try {
          result = await api('/examinations/command', {
            operation: 'request_ai_grading',
            attemptId: state.active.attempt.attemptId,
            requestKey: requestKey('ai'),
          });
          transientRetries = 0;
        } catch (error) {
          if (error?.code === 'MALFORMED_MODEL_RESPONSE' && transientRetries < 1) {
            transientRetries += 1;
            batch -= 1;
            setStatus('The examiner response was incomplete. Retrying once safely…');
            continue;
          }
          throw error;
        }
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
    dialog.setAttribute('aria-labelledby', 'dd-human-review-title');
    dialog.innerHTML = `<form class="dd-exam-dialog-inner" id="dd-human-form">
      <button class="dd-exam-dialog-close" type="button" data-dialog-close
        aria-label="Close Human Examiner assignment">&times;</button>
      <p class="dd-exam-kicker">Structured Review</p>
      <h2 id="dd-human-review-title">Create a Human Examiner Assignment</h2>
      <p class="dd-exam-description">Practice Exam email delivery is disabled. Create the assignment,
        then copy and share the expiring secure link directly.</p>
      <label class="dd-exam-field">Examiner email (assignment record)
        <input type="email" id="dd-examiner-email" maxlength="254" autocomplete="email"
          aria-describedby="dd-examiner-email-help" required>
        <small id="dd-examiner-email-help">This identifies the intended examiner. The expiring secure link controls access.</small>
      </label>
      <div class="dd-exam-dialog-actions">
        <button class="dd-exam-button" type="button" data-dialog-cancel>Back</button>
        <button class="dd-exam-button is-primary" type="submit">Create assignment link</button>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </form>`;
    dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', createHumanAssignment);
    document.body.append(dialog);
    return dialog;
  }

  function humanAssignmentUrl(returnedUrl, assignmentToken) {
    const fallback = new URL(global.location.href);
    fallback.pathname = '/';
    fallback.search = '';
    fallback.hash = '';
    fallback.searchParams.set('assignment', assignmentToken);
    try {
      const candidate = new URL(String(returnedUrl || ''));
      if (!['https:', 'http:'].includes(candidate.protocol)
          || candidate.username || candidate.password
          || candidate.origin !== fallback.origin
          || candidate.searchParams.get('assignment') !== assignmentToken
          || candidate.hash !== '#examiner-review') return fallback.href;
      return candidate.href;
    } catch {
      return fallback.href;
    }
  }

  async function createHumanAssignment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter || form.querySelector('[type="submit"]');
    const status = form.querySelector('.dd-exam-status');
    const emailInput = form.querySelector('#dd-examiner-email');
    button.disabled = true;
    button.textContent = 'Creating assignment link…';
    const examinerEmail = emailInput.value.trim();
    const assignmentToken = randomToken(36);
    try {
      const result = await api('/examinations/command', {
        operation: 'create_examiner_assignment',
        attemptId: state.active.attempt.attemptId,
        examinerEmail,
        requestKey: requestKey('human'),
        assignmentToken,
      });
      const assignmentUrl = humanAssignmentUrl(result.assignmentUrl, assignmentToken);
      emailInput.readOnly = true;
      emailInput.setAttribute('aria-readonly', 'true');
      button.textContent = 'Assignment link created';
      status.className = 'dd-exam-status is-success';
      status.innerHTML = `<strong>Assignment created. No email was sent.</strong>
        <p>Copy and share this expiring secure link directly with ${escapeHtml(examinerEmail)}.</p>
        <label class="dd-exam-field">Secure assignment link
          <input type="url" id="dd-human-assignment-link" value="${escapeAttribute(assignmentUrl)}"
            readonly aria-readonly="true">
        </label>
        <div class="dd-exam-dialog-actions">
          <button class="dd-exam-button is-primary" type="button" data-copy-human-assignment>
            Copy secure link
          </button>
        </div>
        <small data-human-copy-status></small>`;
      const linkInput = status.querySelector('#dd-human-assignment-link');
      const copyButton = status.querySelector('[data-copy-human-assignment]');
      const copyStatus = status.querySelector('[data-human-copy-status]');
      copyButton.addEventListener('click', async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(assignmentUrl);
          copyButton.textContent = 'Copied';
          copyStatus.textContent = 'Secure link copied.';
          global.toast?.('Secure assignment link copied.', 'ok');
        } catch {
          linkInput.focus();
          linkInput.select();
          copyButton.textContent = 'Link selected';
          copyStatus.textContent = 'Copy the selected link, then share it directly with the examiner.';
          global.toast?.('The link is selected. Copy it using your browser or keyboard.', 'warn');
        }
      });
      global.toast?.('Assignment created. No email was sent.', 'ok');
    } catch (error) {
      status.textContent = error.message;
      status.className = 'dd-exam-status is-error';
      button.disabled = false;
      button.textContent = 'Create assignment link';
    }
  }

  function assessmentList(items, emptyText) {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    return `<ul>${(values.length ? values : [emptyText])
      .map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function assessmentSources(sources) {
    const safe = (Array.isArray(sources) ? sources : []).map((source) => {
      const rawUrl = typeof source === 'string' ? source : source?.url;
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        return {
          url: url.href,
          title: typeof source === 'string'
            ? url.hostname
            : source.title || source.reference || url.hostname,
          reference: typeof source === 'string' ? '' : source.reference || source.relevance || '',
          authority: typeof source === 'string'
            ? 'Official or editorial source'
            : source.authority || source.type || 'Legal source',
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (!safe.length) {
      return '<div class="legal-explanation">No verified online source is currently available.</div>';
    }
    return `<div class="source-list">${safe.map((source) => `<a class="source-link"
      href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(source.title)}${source.reference ? `<small>${escapeHtml(source.reference)}</small>` : ''}</span>
      <small>${escapeHtml(source.authority)} · External source</small></a>`).join('')}</div>`;
  }

  function assessmentScoreWasCapped(assessment) {
    if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return false;

    const appliedCeiling = assessment.appliedScoreCeiling;
    if (appliedCeiling && typeof appliedCeiling === 'object' && !Array.isArray(appliedCeiling)) {
      const code = String(appliedCeiling.code || '').trim().toLowerCase();
      const maximum = Number(appliedCeiling.maximum);
      if ((code && code !== 'none') || (Number.isFinite(maximum) && maximum < 5)) return true;
    }

    const scoreCeilingCode = String(assessment.scoreCeilingCode || '').trim().toLowerCase();
    if (scoreCeilingCode && scoreCeilingCode !== 'none') return true;

    return ['errors', 'improvements'].some((field) => (
      Array.isArray(assessment[field])
      && assessment[field].some((value) => /^score capped because\b/i.test(String(value || '').trim()))
    ));
  }

  function assessmentBreakdown(breakdown, options = {}) {
    const rubricFields = new Set(['responsiveness', 'legalBasis', 'application', 'conclusion']);
    const entries = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)
      ? Object.entries(breakdown).filter(([key, value]) => (
        rubricFields.has(key) && Number.isFinite(Number(value))
      ))
      : [];
    if (!entries.length) return '';
    return `<section class="assessment-section"><h4>Point-by-point comparison</h4>
      <div class="dd-assessment-breakdown">${entries.map(([label, value]) => `<div>
        <span>${escapeHtml(
    options.track === 'per_subject'
      && label === 'application'
      && breakdown.applicationRequired === false
      ? 'Task performance'
      : label.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
  )}</span>
        <strong>${Number(value).toFixed(1)}</strong></div>`).join('')}</div></section>`;
  }

  function adaptiveModelAnswerSections(assessment, result = {}) {
    const presentation = assessment?.modelAnswerSections;
    const suppliedSections = Array.isArray(presentation)
      ? presentation
      : Array.isArray(presentation?.sections)
        ? presentation.sections
        : [];
    const cleanSupplied = suppliedSections.map((section) => ({
      label: String(section?.label || '').trim(),
      text: String(section?.text || '').trim(),
    })).filter((section) => section.label && section.text).slice(0, 6);
    if (cleanSupplied.length) return cleanSupplied;

    const alac = assessment?.modelAnswerALAC || {};
    const questionType = presentation?.questionType
      || assessment?.rubricBreakdown?.questionType
      || inferSubjectQuestionType({ prompt: result.prompt || '', questionType: result.questionType });
    const labels = {
      problem: ['Direct answer', 'Governing law', 'Application to the facts', 'Result'],
      definition: ['Definition', 'Governing authority', 'Elements and scope', 'Material qualification'],
      explanation: ['Core response', 'Governing authority', 'Complete explanation', 'Closing synthesis'],
      enumeration: ['Direct response', 'Governing source', 'Required items', 'Qualification or effect'],
      distinction: ['Direct distinction', 'Governing bases', 'Comparative analysis', 'Legal effect'],
      procedure: ['Proper procedure or remedy', 'Governing rule', 'Required sequence', 'Result'],
      practical: ['Requested action', 'Governing requirements', 'Tailored execution', 'Safeguard or result'],
      doctrine: ['Doctrine', 'Source and rule', 'Scope and operation', 'Qualification'],
      mixed: ['Responses to each task', 'Governing rules', 'Integrated analysis', 'Clear dispositions'],
      other: ['Direct response', 'Governing law', 'Complete reasoning', 'Result'],
    }[questionType] || ['Direct response', 'Governing law', 'Complete reasoning', 'Result'];
    return [alac.answer, alac.legalBasis, alac.application, alac.conclusion]
      .map((text, index) => ({ label: labels[index], text: String(text || '').trim() }))
      .filter((section) => section.text);
  }

  function subjectReviewMaterialKey(attemptId) {
    return `${currentUserId()}:${String(attemptId || '').trim()}`;
  }

  function subjectReviewSubmissionBlocked() {
    return state.active?.examination?.track === 'per_subject'
      && !state.active?.attempt?.submittedAt
      && state.active?.attempt?.reviewConfirmationPending === true;
  }

  function completeSubjectReviewSources(sources) {
    const safeSources = (Array.isArray(sources) ? sources : []).filter((source) => {
      try {
        const url = new URL(source);
        const hostname = url.hostname.toLowerCase();
        return url.protocol === 'https:' && !url.username && !url.password
          && OFFICIAL_SUBJECT_SOURCE_HOSTS.some((host) => (
            hostname === host || hostname.endsWith(`.${host}`)
          ));
      } catch { return false; }
    });
    if (!safeSources.length) return '';
    return `<section class="dd-subject-review-section dd-subject-review-sources" aria-labelledby="dd-subject-review-sources-title">
      <h4 id="dd-subject-review-sources-title">Verified official sources</h4>
      <div>${safeSources.map((source, index) => `<a class="source-link" href="${escapeAttribute(source)}" target="_blank" rel="noopener noreferrer"><span>Official source ${index + 1}</span><small>${escapeHtml(new URL(source).hostname)}</small></a>`).join('')}</div>
    </section>`;
  }

  function normalizedSubjectReviewText(value) {
    return String(value || '').trim().toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isNearDuplicateSubjectReviewText(value, suggestedAnswer) {
    const candidate = normalizedSubjectReviewText(value);
    const answer = normalizedSubjectReviewText(suggestedAnswer);
    if (!candidate || !answer) return false;
    if (candidate === answer) return true;
    const lengthRatio = Math.min(candidate.length, answer.length)
      / Math.max(candidate.length, answer.length, 1);
    if (lengthRatio >= 0.8 && (candidate.includes(answer) || answer.includes(candidate))) {
      return true;
    }
    const candidateWords = new Set(candidate.split(' ').filter(Boolean));
    const answerWords = new Set(answer.split(' ').filter(Boolean));
    let intersection = 0;
    candidateWords.forEach((word) => {
      if (answerWords.has(word)) intersection += 1;
    });
    const union = candidateWords.size + answerWords.size - intersection;
    return lengthRatio >= 0.7 && union > 0 && intersection / union >= 0.9;
  }

  function isLowValueSubjectReviewText(value) {
    const text = String(value || '').trim();
    return !text
      || /^(?:answer\s*:\s*)?(?:yes|no)\.?$/i.test(text)
      || /^(?:n\/?a|n\.\s*a\.|none|not applicable)(?:\s*[-\u2013\u2014:]\s*.*)?\.?$/i.test(text);
  }

  function uniqueSubjectReviewValues(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((value) => String(value || '').trim())
      .filter((value) => {
        const key = normalizedSubjectReviewText(value);
        if (!key || seen.has(key) || isLowValueSubjectReviewText(value)) return false;
        seen.add(key);
        return true;
      });
  }

  function distinctSubjectReviewFallback(material) {
    return [material?.doctrine, material?.legalBasis, material?.governingProvision, material?.citation]
      .map((value) => String(value || '').trim())
      .find((value) => value && !isLowValueSubjectReviewText(value)
        && !isNearDuplicateSubjectReviewText(value, material?.suggestedAnswer))
      || DISTINCT_CONTROLLING_LAW_UNAVAILABLE;
  }

  function subjectReviewSuggestedAnswerMarkup(value) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '<p class="dd-study-hold">The suggested answer has not been released for this item.</p>';
    const headingPattern = /^[ \t]*(?:(?:I|II|III|IV)\.[ \t]*)?(Answer|Legal Basis|Application|Conclusion)(?:[ \t]*:[ \t]*|[ \t]*(?=\n|$))/gim;
    const matches = [...text.matchAll(headingPattern)];
    const paragraphMarkup = (content) => String(content || '').split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join('');
    if (!matches.length) {
      return `<div class="dd-subject-review-prose dd-subject-review-structured">${paragraphMarkup(text)}</div>`;
    }
    const sections = [];
    const introduction = text.slice(0, matches[0].index).trim();
    if (introduction) sections.push(paragraphMarkup(introduction));
    matches.forEach((match, index) => {
      const content = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length).trim();
      sections.push(`<section class="dd-subject-review-answer-part"><h5>${escapeHtml(match[1])}</h5>${paragraphMarkup(content)}</section>`);
    });
    return `<div class="dd-subject-review-prose dd-subject-review-structured">${sections.join('')}</div>`;
  }

  function resolvedSubjectLegalReview(material) {
    const supplied = material?.legalReview && typeof material.legalReview === 'object'
      ? material.legalReview
      : {};
    const explanation = material?.whyThisAnswerIsCorrect || {};
    const jurisprudence = (Array.isArray(supplied.jurisprudence)
      ? supplied.jurisprudence
      : (Array.isArray(material?.jurisprudence) ? material.jurisprudence : []))
      .map((entry) => {
        if (typeof entry === 'string') return { caseName: entry, citation: '', doctrine: '' };
        return {
          caseName: String(entry?.caseName || entry?.title || entry?.case || '').trim(),
          citation: String(entry?.citation || '').trim(),
          doctrine: String(entry?.doctrine || entry?.holding || entry?.disposition || '').trim(),
        };
      })
      .filter((entry) => !isLowValueSubjectReviewText(entry.caseName || entry.citation)
        && (/\b(?:v|vs)\.?\s+/i.test(entry.caseName)
          || /^(?:in re|re:|matter of)\b/i.test(entry.caseName)
          || /\b(?:G\.?\s*R\.?|A\.?\s*C\.?|A\.?\s*M\.?|B\.?\s*M\.?)\s*(?:No\.?|Nos\.?)\s*/i.test(entry.citation)));
    const suppliedControllingLaw = String(supplied.controllingLawAndDoctrine
      || explanation.controllingLawAndElements || material?.legalBasis || '').trim();
    return {
      controllingLawAndDoctrine: isNearDuplicateSubjectReviewText(
        suppliedControllingLaw,
        material?.suggestedAnswer,
      ) ? distinctSubjectReviewFallback(material) : suppliedControllingLaw,
      authorityReferences: uniqueSubjectReviewValues(
        supplied.authorityReferences?.length
          ? supplied.authorityReferences
          : [material?.legalBasis, material?.governingProvision, material?.citation],
      ),
      jurisprudence,
      applicationToFacts: String(supplied.applicationToFacts
        || explanation.applicationToFacts || '').trim(),
      materialExceptionsOrLimits: String(supplied.materialExceptionsOrLimits
        || explanation.materialExceptionsOrLimits || '').trim(),
      finalConclusion: String(supplied.finalConclusion
        || explanation.finalConclusion || '').trim(),
    };
  }

  function subjectReviewApplicationMarkup(review) {
    const sections = [
      ['Application to the exact facts', review?.applicationToFacts],
      ['Material exceptions or limits', review?.materialExceptionsOrLimits],
      ['Final conclusion', review?.finalConclusion],
    ].filter(([, value]) => String(value || '').trim());
    if (!sections.length) return '<p class="dd-study-hold">The approved teaching explanation is temporarily unavailable.</p>';
    return `<div class="dd-subject-teaching-sections">${sections.map(([label, value]) => `<section>
      <h5>${escapeHtml(label)}</h5><div class="legal-explanation">${escapeHtml(value)}</div>
    </section>`).join('')}</div>`;
  }

  function completeSubjectReviewContent(material, { openSection = '' } = {}) {
    const review = resolvedSubjectLegalReview(material);
    const headingId = `dd-subject-review-heading-${String(material.attemptId || material.questionId || 'current')
      .replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const authorityMarkup = review.authorityReferences.length
      ? `<section class="dd-subject-review-section"><h4>Cited Authorities</h4>
          <ul class="dd-subject-review-citations">${review.authorityReferences
    .map((authority) => `<li>${escapeHtml(authority)}</li>`).join('')}</ul></section>`
      : '';
    const jurisprudenceMarkup = review.jurisprudence.length
      ? `<section class="dd-subject-review-section"><h4>Related Jurisprudence</h4>
          <div class="dd-subject-review-cases">${review.jurisprudence.map((entry) => `<article>
            ${entry.caseName ? `<h5>${escapeHtml(entry.caseName)}</h5>` : ''}
            ${entry.citation ? `<p class="dd-subject-review-case-citation">${escapeHtml(entry.citation)}</p>` : ''}
            ${entry.doctrine && !isLowValueSubjectReviewText(entry.doctrine)
    ? `<div class="legal-explanation">${escapeHtml(entry.doctrine)}</div>` : ''}
          </article>`).join('')}</div></section>`
      : '';
    const open = (section) => (openSection === section ? ' open' : '');
    return `<section class="dd-subject-review-complete" data-subject-review-content
      data-attempt-id="${escapeAttribute(material.attemptId || '')}"
      data-question-id="${escapeAttribute(material.questionId || '')}"
      aria-labelledby="${escapeAttribute(headingId)}">
      <header class="dd-subject-review-revealed-heading">
        <div><p class="dd-exam-kicker">Review material</p><h3 id="${escapeAttribute(headingId)}">Suggested answer and legal review</h3></div>
        <span class="dd-subject-attempt-badge ${material.assisted ? 'is-assisted' : 'is-unassisted'}">
          ${material.assisted ? 'Assisted / Open-book' : 'Unassisted submission'}
        </span>
      </header>
      <div class="dd-subject-review-disclosures">
        <details data-subject-review-section="suggested-answer"${open('suggested-answer')}>
          <summary class="dd-disclosure-control"><span>Reveal suggested answer</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span></summary>
          <div class="dd-subject-review-disclosure-body">
            ${subjectReviewSuggestedAnswerMarkup(material.suggestedAnswer)}
          </div>
        </details>
        <details data-subject-review-section="controlling-law"${open('controlling-law')}>
          <summary class="dd-disclosure-control"><span>Reveal controlling law and doctrine</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span></summary>
          <div class="dd-subject-review-disclosure-body">
            <section class="dd-subject-review-section"><h4>Controlling Law &amp; Doctrine</h4>
              <div class="dd-subject-review-prose">${escapeHtml(review.controllingLawAndDoctrine)}</div></section>
            ${authorityMarkup}
            ${jurisprudenceMarkup}
          </div>
        </details>
        <details data-subject-review-section="application-guidance"${open('application-guidance')}>
          <summary class="dd-disclosure-control"><span>Reveal application, limits, and sources</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span></summary>
          <div class="dd-subject-review-disclosure-body">
            <section class="dd-subject-review-section"><h4>Application and Material Limits</h4>
              ${subjectReviewApplicationMarkup(review)}</section>
            ${completeSubjectReviewSources(material.sources)}
            <p class="dd-subject-review-source-note">The explanation is limited to Due Diligence's approved question-bank material. It does not add independent authorities.</p>
          </div>
        </details>
      </div>
    </section>`;
  }

  function subjectReviewPanelMarkup({ attemptId, questionId, assisted, submitted }) {
    const material = state.reviewMaterialCache.get(subjectReviewMaterialKey(attemptId));
    if (material?.questionId === questionId) return completeSubjectReviewContent(material);
    const classificationNotice = assisted
      ? 'Review opened before submission. Your score is unchanged, and this attempt is excluded from unassisted mastery metrics.'
      : submitted
        ? 'Your answer was submitted before reveal, so its Unassisted classification will not change.'
        : 'Opening any section marks this attempt Assisted / Open-book. Your score is unchanged, and it is excluded from unassisted mastery metrics.';
    return `<section class="dd-subject-review-lock" data-subject-review-panel
      data-attempt-id="${escapeAttribute(attemptId)}" data-question-id="${escapeAttribute(questionId)}"
      data-submitted="${submitted ? 'true' : 'false'}" aria-labelledby="dd-subject-review-lock-title">
      <p class="dd-exam-kicker">Review material</p>
      <h2 id="dd-subject-review-lock-title">Suggested answer and legal review</h2>
      <div class="dd-subject-review-classification-note">
        <strong>${assisted ? 'Assisted / Open-book' : submitted ? 'Submitted before reveal' : 'Before submission'}</strong>
        <span>${escapeHtml(classificationNotice)}</span>
      </div>
      <div class="dd-subject-review-disclosures is-locked">
        <details>
          <summary class="dd-disclosure-control" data-subject-review-reveal data-subject-review-section="suggested-answer">
            <span>Reveal suggested answer</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span>
          </summary>
        </details>
        <details>
          <summary class="dd-disclosure-control" data-subject-review-reveal data-subject-review-section="controlling-law">
            <span>Reveal controlling law and doctrine</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span>
          </summary>
        </details>
        <details>
          <summary class="dd-disclosure-control" data-subject-review-reveal data-subject-review-section="application-guidance">
            <span>Reveal application, limits, and sources</span><span class="dd-subject-disclosure-chevron" aria-hidden="true"></span>
          </summary>
        </details>
      </div>
      <div class="dd-subject-review-status" id="dd-subject-review-region-${escapeAttribute(attemptId)}"
        data-subject-review-status role="status" aria-live="polite"></div>
      <div class="dd-subject-review-error-actions" data-subject-review-actions></div>
    </section>`;
  }

  function updateCompleteSubjectReviewPanels(attemptId, questionId, material, {
    focus = false,
    openSection = '',
  } = {}) {
    document.querySelectorAll(`[data-subject-review-panel][data-attempt-id="${attemptId}"]`).forEach((panel) => {
      if (panel.dataset.questionId !== questionId) return;
      panel.outerHTML = completeSubjectReviewContent(material, { openSection });
    });
    document.querySelectorAll('[data-subject-attempt-classification]').forEach((badge) => {
      badge.classList.toggle('is-assisted', material.assisted === true);
      badge.classList.toggle('is-unassisted', material.assisted !== true);
      badge.textContent = material.assisted ? 'Assisted / Open-book' : 'Unassisted';
    });
    if (focus) {
      const completed = [...document.querySelectorAll('[data-subject-review-content]')]
        .find((section) => section.dataset.attemptId === attemptId
          && section.dataset.questionId === questionId);
      completed?.querySelector('details[open] > summary')?.focus({ preventScroll: true });
    }
  }

  function showCompleteSubjectReviewError(panel) {
    const status = panel?.querySelector('[data-subject-review-status]');
    const actions = panel?.querySelector('[data-subject-review-actions]');
    const submitted = state.active?.attempt?.attemptId === panel?.dataset.attemptId
      && Boolean(state.active.attempt.submittedAt);
    if (panel) delete panel.dataset.reviewLoading;
    panel?.querySelectorAll('[data-subject-review-reveal]').forEach((summary) => {
      summary.removeAttribute('aria-busy');
      summary.removeAttribute('aria-disabled');
    });
    if (status) status.innerHTML = `<div class="dd-exam-status is-error">
      <strong>Review status could not be confirmed.</strong>
      <span>${submitted
        ? 'Your submitted answer is unchanged, and Retry assessment remains available. Retry the review to open the protected material.'
        : 'Your saved answer is unchanged. This attempt may already be classified Assisted / Open-book, so submission remains paused until Due Diligence confirms the review state.'}</span>
    </div>`;
    if (actions) actions.innerHTML = `<button class="dd-control dd-exam-button is-primary" type="button" data-subject-review-retry
      data-subject-review-section="${escapeAttribute(panel?.dataset.pendingReviewSection || 'suggested-answer')}">Retry review</button>`;
  }

  async function loadCompleteSubjectReview(button, {
    retry = false,
    automatic = false,
    openSection = button?.dataset.subjectReviewSection || 'suggested-answer',
  } = {}) {
    const panel = button?.closest('[data-subject-review-panel]');
    const attemptId = panel?.dataset.attemptId || '';
    const questionId = panel?.dataset.questionId || '';
    if (!attemptId || !questionId) return;
    if (panel.dataset.reviewLoading === 'true') return;
    const key = subjectReviewMaterialKey(attemptId);
    if (retry) {
      state.reviewMaterialCache.delete(key);
      state.reviewMaterialRequests.delete(key);
    }
    const cached = state.reviewMaterialCache.get(key);
    if (cached) {
      if (state.active?.attempt?.attemptId === attemptId) {
        state.active.attempt.reviewConfirmationPending = false;
      }
      updateCompleteSubjectReviewPanels(attemptId, questionId, cached, {
        focus: !automatic,
        openSection,
      });
      const submitButton = pageRoot('per_subject')?.querySelector('[data-submit-current]');
      if (submitButton && !state.active?.attempt?.submittedAt) {
        submitButton.disabled = !currentQuestion()?.answerText?.trim();
      }
      return;
    }
    panel.dataset.pendingReviewSection = openSection;
    panel.dataset.reviewLoading = 'true';
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    const submitButton = pageRoot('per_subject')?.querySelector('[data-submit-current]');
    const reviewAffectsSubmission = state.active?.attempt?.attemptId === attemptId
      && !state.active.attempt.submittedAt;
    if (submitButton && reviewAffectsSubmission) submitButton.disabled = true;
    if (state.active?.attempt?.attemptId === attemptId) {
      state.active.attempt.reviewConfirmationPending = reviewAffectsSubmission;
    }
    const status = panel.querySelector('[data-subject-review-status]');
    const actions = panel.querySelector('[data-subject-review-actions]');
    if (actions) actions.replaceChildren();
    if (status) status.textContent = 'Opening the approved review material…';
    let request = state.reviewMaterialRequests.get(key);
    if (!request) {
      request = api('/examinations/command', { operation: 'subject_reveal_review', attemptId })
        .then((material) => {
          if (material?.attemptId !== attemptId || material?.questionId !== questionId) {
            throw new Error('Verified review material does not match this question.');
          }
          state.reviewMaterialCache.set(key, material);
          return material;
        })
        .finally(() => state.reviewMaterialRequests.delete(key));
      state.reviewMaterialRequests.set(key, request);
    }
    let reviewConfirmed = false;
    try {
      const material = await request;
      if (state.active?.attempt?.attemptId === attemptId) {
        state.active.attempt.assisted = material.assisted === true;
        state.active.attempt.assistanceKnown = material.assistanceKnown === true;
        state.active.attempt.reviewMaterialRevealedAt = material.reviewMaterialRevealedAt || null;
        state.active.attempt.reviewConfirmationPending = false;
      }
      if (!document.body.contains(panel)) return;
      updateCompleteSubjectReviewPanels(attemptId, questionId, material, {
        focus: !automatic,
        openSection,
      });
      reviewConfirmed = true;
    } catch (error) {
      if (document.body.contains(panel)) showCompleteSubjectReviewError(panel);
    } finally {
      if (reviewConfirmed && submitButton && state.active?.attempt?.attemptId === attemptId
          && !state.active.attempt.submittedAt) {
        submitButton.disabled = !currentQuestion()?.answerText?.trim();
      }
    }
  }

  function restoreRevealedSubjectReview(root) {
    if (!state.active?.attempt?.reviewMaterialRevealedAt) return;
    const button = root?.querySelector('[data-subject-review-reveal]');
    if (button) loadCompleteSubjectReview(button, { automatic: true });
  }

  function subjectMatterResultMarkup(result, attemptId = '') {
    const course = result?.subject
      || state.active?.examination?.subject
      || state.selectedSubject
      || 'Selected course';
    const answerText = String(result?.answerText || '').trim();
    const questionId = result?.questionId || result?.id || '';
    const resolvedAttemptId = attemptId || result?.attemptId || state.active?.attempt?.attemptId || '';
    const assisted = result?.assisted === true
      || state.active?.attempt?.assisted === true;
    return `<div class="dd-subject-editorial is-result">
      <header class="dd-subject-editorial-header">
        <div>
          <p class="dd-exam-kicker">Review and retention</p>
          <p class="dd-subject-breadcrumb"><span>Practice Exam</span><b aria-hidden="true">/</b> Syllabus Base Review</p>
          <h1 data-subject-result-heading tabindex="-1">Syllabus Base Review</h1>
        </div>
        <div class="dd-subject-course-picker">
          <p>Current course</p>
          <button class="dd-picker-control dd-subject-course-control" type="button" data-subject-change-course
            aria-haspopup="dialog"
            aria-label="${escapeAttribute(course)} — change course. Opens the searchable Year, Term, and Course chooser.">
            <strong>${escapeHtml(course)}</strong>
            <span>Change course</span>
          </button>
        </div>
      </header>
      <div class="dd-subject-editorial-grid">
        <main class="dd-subject-editorial-pane is-writing is-result-summary" aria-labelledby="dd-subject-result-question-title">
          <div class="dd-subject-question-block">
            <div class="dd-subject-question-meta">
              <p class="dd-question-label">${escapeHtml(course)}</p>
              <span class="dd-subject-attempt-badge ${assisted ? 'is-assisted' : 'is-unassisted'}"
                data-subject-attempt-classification>${assisted ? 'Assisted / Open-book' : 'Unassisted'}</span>
            </div>
            <p class="dd-subject-task-label">Submitted question</p>
            <h2 class="dd-question-prompt" id="dd-subject-result-question-title">${escapeHtml(result?.prompt || '')}</h2>
          </div>
          <section class="dd-subject-submitted-response" aria-labelledby="dd-subject-submitted-answer-title">
            <h3 id="dd-subject-submitted-answer-title">Your answer</h3>
            <div class="dd-subject-submitted-answer">${escapeHtml(answerText || 'No answer text is available in this released record.')}</div>
          </section>
          <section class="dd-subject-result-assessment" aria-label="Score and examiner feedback">
            ${assessmentCard(result, { track: 'per_subject', compactSubject: true })}
          </section>
          <nav class="dd-subject-practice-actions" aria-label="Syllabus Base Review review actions">
            <button class="dd-control dd-exam-button is-primary" type="button" data-subject-next>Next question</button>
            <button class="dd-control dd-exam-button" type="button"
              data-subject-performance="${escapeAttribute(course)}">Review my work</button>
            <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
          </nav>
        </main>
        <aside class="dd-subject-editorial-pane is-reading is-review-panel"
          aria-label="Suggested answer and legal review">
          ${subjectReviewPanelMarkup({
            attemptId: resolvedAttemptId,
            questionId,
            assisted,
            submitted: true,
          })}
        </aside>
      </div>
    </div>`;
  }

  function assessmentCard(result, options = {}) {
    const assessment = result.aiAssessment || result.assessment || {};
    const alac = assessment.modelAnswerALAC || {};
    const track = options.track || result.track || state.active?.examination?.track || state.track;
    const isSubjectMatter = track === 'per_subject';
    const score = result.aiScore ?? result.score;
    const prompt = result.prompt || options.prompt || '';
    const suggestedAnswer = result.modelAnswer || result.suggestedAnswer || '';
    const sources = isSubjectMatter ? (result.sources || []) : (result.sources || assessment.sources || []);
    const questionId = result.questionId || result.id || '';
    const hasAlac = ['answer', 'legalBasis', 'application', 'conclusion'].some((key) => alac[key]);
    const adaptiveSections = isSubjectMatter
      ? adaptiveModelAnswerSections(assessment, { ...result, prompt })
      : [];
    const sourceWarning = assessment.reviewRequired === true || assessment.sourceStatus === 'conflict'
      ? '<div class="assessment-warning"><strong>Review required.</strong> Verify the cited primary authorities before relying on this assessment.</div>'
      : '';
    return `<article class="assessment-card dd-subject-assessment ${isSubjectMatter ? 'dd-subject-review-card' : ''}" aria-label="${isSubjectMatter ? 'Syllabus Base Review review and retention assessment' : 'Individual Philippine Bar essay assessment'}"
      ${isSubjectMatter && questionId ? `data-study-resource-type="subject_matter" data-study-resource-id="${escapeAttribute(questionId)}"` : ''}>
      <div class="assessment-hero">
        ${score != null ? `<div class="score-medallion"><div><strong>${Number(score).toFixed(1)} / 5</strong><span>Points earned</span></div></div>` : ''}
        <div><div class="assessment-kicker">${isSubjectMatter ? 'Evaluation overview' : 'Individual Question Assessment'}</div>
          <h3 class="assessment-title">${escapeHtml(assessment.performanceLabel || (isSubjectMatter ? 'Question review' : 'Philippine Bar essay assessment'))}</h3>
          <div class="assessment-equivalent">Scored on the 0.0–5.0 ${isSubjectMatter ? 'legal-study practice' : 'Philippine Bar essay practice'} scale</div>
          <div class="assessment-badges"><span class="assessment-badge">${escapeHtml(assessment.label || 'Question-bank assessment')}</span>
            ${assessment.tier ? `<span class="assessment-badge">Official tier ${escapeHtml(assessment.tier)}</span>` : ''}
            ${assessment.sourceStatus ? `<span class="assessment-badge">Source: ${escapeHtml(assessment.sourceStatus)}</span>` : ''}</div>
        </div>
      </div>
      <div class="assessment-body">
        ${prompt && !(isSubjectMatter && options.compactSubject) ? `<section class="assessment-section"><h4>Question</h4><div class="dd-question-prompt">${escapeHtml(prompt)}</div></section>` : ''}
        ${options.answerText && !(isSubjectMatter && options.compactSubject) ? `<section class="assessment-section"><h4>Your answer</h4><div class="dd-model-answer">${escapeHtml(options.answerText)}</div></section>` : ''}
        <h4 class="panel-title">${isSubjectMatter ? 'Why this response received its score' : 'Why this score'}</h4>
        <p class="assessment-rationale">${escapeHtml(assessment.rationale || 'The assessment record does not include a written rationale.')}</p>
        ${isSubjectMatter ? '' : `<section class="assessment-section"><h4>Governing rule and authority</h4>
          <div class="legal-explanation">${escapeHtml(assessment.legalExplanation || result.legalBasis || 'Review the controlling provision and doctrine identified in the released answer and legal sources.')}</div></section>`}
        ${assessmentScoreWasCapped(assessment) ? '' : assessmentBreakdown(assessment.rubricBreakdown, { track })}
        <div class="assessment-grid">
          <section class="assessment-panel strengths"><h4>Strengths</h4>${assessmentList(assessment.strengths, 'No specific strength was identified.')}</section>
          <section class="assessment-panel errors"><h4>${isSubjectMatter ? 'Important points missed' : 'Errors or missing points'}</h4>${assessmentList(assessment.errors, 'No material error was identified.')}</section>
          <section class="assessment-panel coaching"><h4>${isSubjectMatter ? 'How to improve' : 'Prioritized improvements'}</h4>${assessmentList(assessment.improvements, 'Keep the answer direct, legally grounded, and fact-specific.')}</section>
        </div>
        ${isSubjectMatter ? (options.compactSubject ? '' : `${adaptiveSections.length ? `<section class="assessment-section"><h4>Suggested discussion</h4>
          <div class="alac-model dd-adaptive-model">${adaptiveSections.map((section) => `<div class="alac-part">
            <b>${escapeHtml(section.label)}</b><p>${escapeHtml(section.text)}</p></div>`).join('')}</div></section>`
          : '<section class="assessment-section"><h4>Suggested discussion</h4><p class="dd-study-hold">A suggested discussion has not been released for this item.</p></section>'}
          ${suggestedAnswer ? `<section class="assessment-section"><h4>Suggested answer</h4><div class="dd-model-answer">${escapeHtml(suggestedAnswer)}</div></section>`
          : '<section class="assessment-section"><h4>Suggested answer</h4><p class="dd-study-hold">The suggested answer has not been released for this item.</p></section>'}`)
        : adaptiveSections.length ? `<section class="assessment-section"><h4>Improved model response</h4>
          <div class="alac-model dd-adaptive-model">${adaptiveSections.map((section) => `<div class="alac-part">
            <b>${escapeHtml(section.label)}</b><p>${escapeHtml(section.text)}</p></div>`).join('')}</div></section>`
        : hasAlac ? `<section class="assessment-section"><h4>Improved Answer — ALAC Method</h4>
          <div class="alac-model"><div class="alac-part"><b>ANSWER</b><p>${escapeHtml(alac.answer || '')}</p></div>
            <div class="alac-part"><b>LEGAL BASIS</b><p>${escapeHtml(alac.legalBasis || '')}</p></div>
            <div class="alac-part"><b>APPLICATION</b><p>${escapeHtml(alac.application || '')}</p></div>
            <div class="alac-part"><b>CONCLUSION</b><p>${escapeHtml(alac.conclusion || '')}</p></div></div></section>` : ''}
        ${isSubjectMatter ? '' : suggestedAnswer ? `<section class="assessment-section"><h4>Approved Model Answer</h4>
          <div class="dd-model-answer">${escapeHtml(suggestedAnswer)}</div></section>`
        : '<p class="dd-exam-description">Model answer not yet released under this examination’s rule.</p>'}
        ${isSubjectMatter ? '' : `<section class="assessment-section"><h4>Supporting legal sources</h4>${assessmentSources(sources)}</section>`}
        ${sourceWarning}
        ${result.humanComments ? `<section class="assessment-section"><h4>Human examiner</h4><div class="legal-explanation">${escapeHtml(result.humanComments)}</div></section>` : ''}
        <div class="assessment-meta">This AI-generated assessment is for ${isSubjectMatter ? 'legal study and coaching' : 'Bar review and coaching'} only. It is not an official Supreme Court grade and does not guarantee or predict an examinee’s actual result.</div>
        <div class="fb-bar"><span class="fb-label">Was this coaching helpful?</span>
          <button class="${isSubjectMatter ? 'dd-control ' : ''}fb-btn" type="button" data-assessment-rating="up" aria-pressed="false">Helpful</button>
          <button class="${isSubjectMatter ? 'dd-control ' : ''}fb-btn" type="button" data-assessment-rating="down" aria-pressed="false">Needs work</button>
          ${questionId ? `<button class="${isSubjectMatter ? 'dd-control is-tertiary ' : ''}fb-btn suggest" type="button" data-suggest-exam-correction
            data-question-id="${escapeHtml(questionId)}" data-question-subject="${escapeHtml(result.subject || state.selectedSubject || '')}">Suggest a correction</button>` : ''}
          <span class="sr-only" data-assessment-rating-status role="status" aria-live="polite"></span>
        </div>
      </div>
    </article>`;
  }

  async function openVerdict(attemptId) {
    const track = state.active?.examination?.track || state.track;
    state.screen = 'verdict';
    showTrackPage(track);
    const root = pageRoot(track);
    root.innerHTML = `<div class="dd-exam-page"><section class="dd-verdict-screen" role="status" aria-live="polite">
        <p class="dd-exam-kicker">Assessment</p><h1 tabindex="-1">Loading individual assessments…</h1>
    </section></div>`;
    try {
      const verdict = await api('/examinations/query', {
        operation: 'verdict',
        attemptId,
        limit: 30,
        offset: 0,
      });
      if (verdict?.attempt && state.active?.attempt) {
        Object.assign(state.active.attempt, verdict.attempt);
      }
      if (track === 'per_subject') {
        const result = Array.isArray(verdict.results) ? verdict.results[0] : null;
        if (result) clearRecovery();
        root.innerHTML = result
          ? subjectMatterResultMarkup(result, attemptId)
          : `<div class="dd-subject-editorial"><section class="dd-subject-result-unavailable">
            <p class="dd-exam-kicker">Syllabus Base Review</p>
            <h1>Review unavailable.</h1>
            <p>Your submitted answer is preserved, but no released assessment record is available yet.</p>
            <button class="dd-control dd-exam-button is-primary" type="button" data-exam-verdict="${escapeAttribute(attemptId)}">Retry assessment</button>
            <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
          </section></div>`;
        if (result) restoreRevealedSubjectReview(root);
        focusRendered(root, result ? '[data-subject-result-heading]' : 'h1');
        return;
      }
      root.innerHTML = `<div class="dd-exam-page ${track === 'per_subject' ? 'dd-subject-review-page' : ''}"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">${track === 'per_subject' ? 'Syllabus Base Review' : 'Multi-question assessment'}</p>
        <h1>${track === 'per_subject' ? 'Review and retain.' : 'Individual ALAC assessments.'}</h1>
        <p class="dd-exam-description">${track === 'per_subject'
          ? 'Understand the evaluation, then reveal the legal basis, discussion, suggested answer, and verified sources at your own pace.'
          : 'No cumulative percentage, class rank, pass/fail claim, or unsupported average is calculated.'}</p>
        ${verdict.results.map((result) => `<div class="dd-verdict-question">
          <p class="dd-question-label">Question ${Number(result.ordinal)}</p>
          ${result.humanScore != null ? `<div class="dd-score-five">Human ${Number(result.humanScore).toFixed(1)} / 5.0</div>` : ''}
          ${assessmentCard(result, { track })}
        </div>`).join('')}
        <div class="dd-exam-actions" style="margin-top:24px">
          ${state.active?.examination?.track === 'per_subject' ? `
            <button class="dd-control dd-exam-button is-primary" type="button" data-subject-next>Next question</button>
            <button class="dd-control dd-exam-button" type="button" data-subject-change-timer>Timer settings</button>
            <button class="dd-control dd-exam-button" type="button"
              data-subject-performance="${escapeHtml(state.active.examination.subject || state.selectedSubject)}">
              Review my work
            </button>
            <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
          ` : '<button class="dd-exam-button" type="button" data-return-catalog>Return to Examination Catalog</button>'}
        </div>
      </section></div>`;
    } catch (error) {
      if (isStaleIdentityError(error)) return;
      root.innerHTML = track === 'per_subject'
        ? `<div class="dd-subject-editorial"><section class="dd-subject-result-unavailable" role="alert" tabindex="-1">
          <p class="dd-exam-kicker">Syllabus Base Review</p><h1>Assessment unavailable.</h1>
          <p>Your submitted answer remains saved. Due Diligence could not load the coaching assessment right now.</p>
          <div class="dd-exam-actions">
            <button class="dd-control dd-exam-button is-primary" type="button" data-exam-verdict="${escapeAttribute(attemptId)}">Retry assessment</button>
            <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
          </div>
        </section></div>`
        : `<div class="dd-exam-page"><section class="dd-verdict-screen" role="alert" tabindex="-1">
          <p class="dd-exam-kicker">Assessment</p><h1>Assessment unavailable.</h1>
          <div class="dd-exam-status is-error">${escapeHtml(error.message)}</div>
        </section></div>`;
      focusRendered(root, '[role="alert"]');
    }
  }

  async function renderSubjectPerformance(subject = state.selectedSubject) {
    const root = pageRoot('per_subject');
    if (!root) return;
    root.innerHTML = `<div class="dd-subject-editorial dd-subject-performance-page"><section class="dd-verdict-screen">
      <p class="dd-exam-kicker">Syllabus Base Review</p><h1>Loading your performance…</h1>
    </section></div>`;
    try {
      const performance = await api('/examinations/query', {
        operation: 'subject_performance',
        subject,
        limit: 50,
      });
      const attempts = performance.recentAttempts || [];
      const flaggedForLater = Array.isArray(performance.flaggedForLater)
        ? performance.flaggedForLater
        : [];
      root.innerHTML = `<div class="dd-subject-editorial dd-subject-performance-page"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">Your private learning record</p>
        <h1>${escapeHtml(subject)} Performance</h1>
        <div class="dd-review-summary">
          <div><strong>${Number(performance.attemptedQuestions) || 0}</strong><span>Questions opened</span></div>
          <div><strong>${Number(performance.completedQuestions) || 0}</strong><span>Answers submitted</span></div>
          <div><strong>${Number(performance.skippedQuestions) || 0}</strong><span>Questions skipped</span></div>
          <div><strong>${Number(performance.unassistedCompletedQuestions) || 0}</strong><span>Unassisted submissions</span></div>
          <div><strong>${performance.unassistedAverageScore == null ? '—' : Number(performance.unassistedAverageScore).toFixed(1)}</strong><span>Unassisted average / 5</span></div>
        </div>
        ${flaggedForLater.length ? `<section class="dd-subject-flagged-queue" aria-labelledby="dd-subject-flagged-title">
          <header><p class="dd-exam-kicker">Your saved review queue</p><h2 id="dd-subject-flagged-title">Flagged for later</h2></header>
          ${flaggedForLater.map((item) => `<article class="dd-subject-flagged-row">
            <div>
              <p class="dd-question-label">${escapeHtml(item.topic || 'Practice question')} · ${escapeHtml(item.resumable === true ? 'Open draft' : 'Skipped without a score')} · ${escapeHtml(formatDate(item.queuedAt || item.skippedAt))}</p>
              <h3>${escapeHtml(item.prompt || 'Flagged Syllabus Base Review question')}</h3>
              ${String(item.answerText || '').trim() ? `<details class="dd-subject-flagged-draft">
                <summary>Saved draft</summary>
                <div>${escapeHtml(item.answerText)}</div>
              </details>` : ''}
            </div>
            ${item.resumable === true
              ? `<button class="dd-control dd-exam-button" type="button"
                data-exam-resume="${escapeAttribute(item.attemptId)}">Resume question</button>`
              : `<button class="dd-control dd-exam-button" type="button"
                data-subject-retry-flagged="${escapeAttribute(item.versionId)}"
                data-subject="${escapeAttribute(item.subject || subject)}">Practice again</button>`}
          </article>`).join('')}
        </section>` : ''}
        ${attempts.length ? attempts.map((item) => `<article class="dd-verdict-question">
          <div class="dd-subject-history-heading"><p class="dd-question-label">${escapeHtml(item.topic || subject)} · ${escapeHtml(formatDate(item.submittedAt))}</p>
            <span class="dd-subject-attempt-badge ${item.assistanceKnown === false ? 'is-unknown' : (item.assisted ? 'is-assisted' : 'is-unassisted')}">${item.assistanceKnown === false ? 'Legacy / Unclassified' : (item.assisted ? 'Assisted / Open-book' : 'Unassisted')}</span></div>
          ${item.assessment ? assessmentCard(item, { answerText: item.answerText, track: 'per_subject' })
            : `<p>Assessment pending.</p><h3>Your answer</h3><div class="dd-model-answer">${escapeHtml(item.answerText || '')}</div>`}
        </article>`).join('') : '<p class="dd-exam-description">Submit your first answer to begin this private performance record.</p>'}
        <div class="dd-exam-actions" style="margin-top:24px">
          <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
        </div>
      </section></div>`;
    } catch (error) {
      if (isStaleIdentityError(error)) return;
      root.innerHTML = `<div class="dd-subject-editorial dd-subject-performance-page"><section class="dd-verdict-screen">
        <p class="dd-exam-kicker">Your private learning record</p>
        <h1>Performance unavailable.</h1>
        <div class="dd-exam-status is-error">Your saved answers and scores are unchanged. Due Diligence could not load this private record right now.</div>
        <button class="dd-control dd-exam-button is-primary" type="button" data-subject-performance="${escapeAttribute(subject)}">Retry performance</button>
        <button class="dd-control dd-exam-button is-tertiary" type="button" data-return-catalog>Return to courses</button>
      </section></div>`;
    }
  }

  function stopActiveTimers() {
    pauseActiveClock();
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  function resetForIdentityChange() {
    stopActiveTimers();
    state.catalog = [];
    state.history = [];
    state.selectedSubject = '';
    state.subjectSelectionConfirmed = false;
    state.subjectQuery = '';
    state.subjectOpenYears = new Set();
    state.subjectOpenTerms = new Set();
    state.subjectSelectorScroll = 0;
    state.subjectPageScroll = 0;
    state.subjectSelectorReturnFocus = null;
    state.setup = null;
    state.active = null;
    state.assignment = null;
    state.uploadPreview = null;
    state.currentIndex = 0;
    state.screen = 'catalog';
    state.resumeAttemptId = null;
    state.saveInFlight = false;
    state.pendingSave = false;
    state.pendingSubjectSkip = null;
    state.reviewMaterialCache.clear();
    state.reviewMaterialRequests.clear();
    ['dd-per-subject-app', 'dd-bar-feels-app', 'dd-verdict-app'].forEach((id) => {
      document.getElementById(id)?.replaceChildren();
    });
  }

  async function loadCatalog(track = state.track) {
    showTrackPage(track);
    const root = pageRoot(track);
    if (root) root.innerHTML = `<div class="dd-exam-page"><div class="dd-exam-shell">
      <div class="dd-exam-status" role="status" aria-live="polite">Preparing your examination choices…</div>
    </div></div>`;
    try {
      const [catalog, history] = track === 'per_subject'
        ? await Promise.all([
          api('/examinations/query', { operation: 'subject_catalog' }),
          Promise.resolve({ items: [] }),
        ])
        : await Promise.all([
          api('/examinations/query', { operation: 'catalog', track }),
          api('/examinations/query', { operation: 'history', limit: 50, offset: 0 }),
        ]);
      state.catalog = catalog.items || [];
      state.history = history.items || [];
      if (track === 'per_subject' && (
        !state.subjectSelectionConfirmed
        || !state.catalog.some((item) => item.subject === state.selectedSubject)
      )) {
        state.selectedSubject = '';
        state.subjectSelectionConfirmed = false;
      }
      state.screen = 'catalog';
      if (track === 'per_subject') renderPerSubject();
      else renderBarFeels();
      focusRendered(root, track === 'per_subject'
        ? (state.subjectSelectionConfirmed
          ? '#dd-selected-course-heading'
          : '#dd-subject-course-selection-heading')
        : '.dd-exam-hero h1');
    } catch (error) {
      if (isStaleIdentityError(error)) return;
      if (root) root.innerHTML = `<div class="dd-exam-page ${track === 'per_subject' ? 'dd-subject-study-page' : ''}"><div class="dd-exam-shell">
        <header class="dd-exam-hero"><div><p class="dd-exam-kicker">${track === 'per_subject' ? 'Syllabus Base Review' : 'Mock Bar'}</p>
          <h1>${track === 'per_subject' ? 'Syllabus Base Review' : 'Bar Exam Simulation'}</h1></div></header>
        <div class="dd-exam-status is-error" role="alert" tabindex="-1">${track === 'per_subject'
          ? 'Courses could not be loaded. Your saved course choice and prior work are unchanged.'
          : escapeHtml(error.message)}</div>
        <button class="${track === 'per_subject' ? 'dd-control ' : ''}dd-exam-button is-primary" type="button"
          data-retry-catalog="${track}">${track === 'per_subject' ? 'Retry loading courses' : 'Retry'}</button>
      </div></div>`;
      focusRendered(root, '[role="alert"]');
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
      dialog.setAttribute('aria-labelledby', 'dd-upload-preview-title');
      document.body.append(dialog);
    }
    return dialog;
  }

  function openUploadPreview() {
    const preview = state.uploadPreview;
    const dialog = uploadDialog();
    dialog.innerHTML = `<div class="dd-exam-dialog-inner">
      <button class="dd-exam-dialog-close" type="button" data-upload-cancel
        aria-label="Close extracted question preview">&times;</button>
      <p class="dd-exam-kicker">Extracted Question Preview</p>
      <h2 id="dd-upload-preview-title">${escapeHtml(preview.title)}</h2>
      <p class="dd-exam-description">${Number(preview.questionCount)} questions parsed from
        ${escapeHtml(preview.fileName)}. Confirm before any examination is created. The timer has not started.</p>
      <ol class="dd-syllabus-list">
        ${(preview.questions || []).map((question) => `<li>${escapeHtml(question.prompt)}</li>`).join('')}
      </ol>
      <label class="dd-exam-field">Grading route
        <select id="dd-upload-route"><option value="human">Human Examiner Review</option>
          <option value="provisional">Provisional feedback only</option></select>
      </label>
      <div class="dd-exam-dialog-actions">
        <button class="dd-exam-button" type="button" data-upload-cancel>Back</button>
        <button class="dd-exam-button is-primary" type="button" data-upload-confirm>Confirm Private Examination</button>
      </div>
      <div class="dd-exam-status" role="status" aria-live="polite"></div>
    </div>`;
    dialog.querySelectorAll('[data-upload-cancel]').forEach((button) => (
      button.addEventListener('click', () => dialog.close())
    ));
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
        timerMode: 'strict',
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
        <div class="dd-exam-status is-success">Human Examiner Review finalized and saved at
          ${escapeHtml(formatDate(result.finalizedAt))}. No Practice Exam email was sent.</div>`;
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  }

  async function returnCatalog(options = {}) {
    const activeAttempt = state.active?.attempt;
    const attemptOpen = activeAttempt
      && ['room', 'review'].includes(state.screen)
      && !['submitted', 'expired', 'cancelled'].includes(
        String(activeAttempt.status || 'in_progress'),
    );
    if (attemptOpen) {
      saveRecovery();
      const confirmed = await confirmDecision({
        title: options.openSubjectSelector ? 'Change course?' : 'Leave this examination?',
        copy: options.openSubjectSelector
          ? 'Your latest answer will be saved before the course chooser opens.'
          : 'Your latest answer will be saved and you can resume it later.',
        confirmLabel: options.openSubjectSelector ? 'Change course' : 'Leave examination',
      });
      if (!confirmed) return;
      const saved = await flushCurrentSave();
      if (!saved) return;
    }
    stopActiveTimers();
    state.active = null;
    state.setup = null;
    state.screen = 'catalog';
    await loadCatalog(state.track);
    if (options.openSubjectSelector === true && state.track === 'per_subject') {
      requestAnimationFrame(() => {
        const trigger = document.querySelector('[data-subject-selector-open]');
        openSubjectSelector(trigger);
      });
    }
  }

  function handleClick(event) {
    const reviewRetry = event.target.closest('[data-subject-review-retry]');
    if (reviewRetry) {
      event.preventDefault();
      const panel = reviewRetry.closest('[data-subject-review-panel]');
      const openSection = reviewRetry.dataset.subjectReviewSection || 'suggested-answer';
      const revealButton = panel?.querySelector(
        `[data-subject-review-reveal][data-subject-review-section="${openSection}"]`,
      ) || panel?.querySelector('[data-subject-review-reveal]');
      if (revealButton) loadCompleteSubjectReview(revealButton, { retry: true, openSection });
      return;
    }
    const reviewReveal = event.target.closest('[data-subject-review-reveal]');
    if (reviewReveal) {
      event.preventDefault();
      loadCompleteSubjectReview(reviewReveal);
      return;
    }
    const subjectSelectorOpen = event.target.closest('[data-subject-selector-open]');
    if (subjectSelectorOpen) {
      openSubjectSelector(subjectSelectorOpen);
      return;
    }
    if (event.target.closest('[data-subject-selector-close]')) {
      closeSubjectSelector();
      return;
    }
    const subject = event.target.closest('[data-exam-subject]');
    if (subject) {
      chooseSubject(subject.dataset.examSubject);
      return;
    }
    const subjectStart = event.target.closest('[data-subject-start]');
    if (subjectStart) {
      if (subjectStart.disabled || subjectStart.getAttribute('aria-busy') === 'true') return;
      subjectStart.disabled = true;
      subjectStart.setAttribute('aria-busy', 'true');
      state.selectedSubject = subjectStart.dataset.subjectStart;
      state.subjectSelectionConfirmed = true;
      persistSubjectCatalogState();
      requestSubjectQuestion({ subject: state.selectedSubject, autoStart: true }).finally(() => {
        if (!subjectStart.isConnected) return;
        subjectStart.disabled = false;
        subjectStart.removeAttribute('aria-busy');
      });
      return;
    }
    if (event.target.closest('[data-subject-timer-settings]')) {
      openSubjectTimerSettings();
      return;
    }
    if (event.target.closest('[data-subject-change-course]')) {
      returnCatalog({ openSubjectSelector: true });
      return;
    }
    const subjectPerformance = event.target.closest('[data-subject-performance]');
    if (subjectPerformance) {
      state.selectedSubject = subjectPerformance.dataset.subjectPerformance;
      renderSubjectPerformance(state.selectedSubject);
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
    if (event.target.closest('#dd-subject-flag-button, #dd-flag-button')) { toggleFlag(); return; }
    const subjectSkip = event.target.closest('[data-subject-skip]');
    if (subjectSkip) { skipCurrentSubjectQuestion(subjectSkip); return; }
    const retryFlagged = event.target.closest('[data-subject-retry-flagged]');
    if (retryFlagged) { retryFlaggedSubjectQuestion(retryFlagged); return; }
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
    const submitCurrent = event.target.closest('[data-submit-current]');
    if (submitCurrent) { submitCurrentSubjectAnswer(submitCurrent); return; }
    const verdict = event.target.closest('[data-exam-verdict]');
    if (verdict) { openVerdict(verdict.dataset.examVerdict); return; }
    const retry = event.target.closest('[data-retry-catalog]');
    if (retry) {
      if (retry.disabled || retry.getAttribute('aria-busy') === 'true') return;
      retry.disabled = true;
      retry.setAttribute('aria-busy', 'true');
      loadCatalog(retry.dataset.retryCatalog).finally(() => {
        if (!retry.isConnected) return;
        retry.disabled = false;
        retry.removeAttribute('aria-busy');
      });
      return;
    }
    if (event.target.closest('[data-request-ai]')) {
      requestAiAssessment(event.target.closest('[data-request-ai]')); return;
    }
    if (event.target.closest('[data-request-human]')) {
      humanDialog().showModal(); return;
    }
    const subjectNext = event.target.closest('[data-subject-next]');
    if (subjectNext) {
      if (subjectNext.disabled || subjectNext.getAttribute('aria-busy') === 'true') return;
      subjectNext.disabled = true;
      subjectNext.setAttribute('aria-busy', 'true');
      requestSubjectQuestion({
        subject: state.active?.examination?.subject || state.selectedSubject,
        autoStart: true,
      }).finally(() => {
        if (!subjectNext.isConnected) return;
        subjectNext.disabled = false;
        subjectNext.removeAttribute('aria-busy');
      });
      return;
    }
    if (event.target.closest('[data-subject-change-timer]')) {
      requestSubjectQuestion({
        subject: state.active?.examination?.subject || state.selectedSubject,
      });
      return;
    }
    const rating = event.target.closest('[data-assessment-rating]');
    if (rating) {
      rating.closest('.fb-bar')?.querySelectorAll('[data-assessment-rating]').forEach((control) => {
        const selected = control === rating;
        control.setAttribute('aria-pressed', String(selected));
        control.classList.toggle('is-selected', selected);
      });
      const status = rating.closest('.fb-bar')?.querySelector('[data-assessment-rating-status]');
      if (status) status.textContent = `${rating.textContent.trim()} feedback selected.`;
      global.rateModel?.(rating.dataset.assessmentRating);
      return;
    }
    const correction = event.target.closest('[data-suggest-exam-correction]');
    if (correction) {
      global.openSuggest?.({
        id: correction.dataset.questionId,
        subject: correction.dataset.questionSubject,
      });
      return;
    }
    if (event.target.closest('[data-return-catalog]')) { returnCatalog(); return; }
    if (event.target.closest('[data-use-local-draft]')) {
      const item = currentQuestion();
      item.answerText = item.localRecoveryText;
      item.answerHtml = item.localRecoveryHtml || richHtmlFromText(item.localRecoveryText);
      item.localRecoveryText = null;
      item.localRecoveryHtml = null;
      renderRoom();
    }
  }

  function handleChange() {}

  function handleInput(event) {
    if (!event.target.matches('[data-subject-search-input]')) return;
    applySubjectFilter(event.target.value);
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
    readSubjectCatalogState();
    try {
      const storageKey = privateKey('duediligence.subject-matter.timer-mode.v1');
      const savedMode = storageKey ? localStorage.getItem(storageKey) : null;
      if (PRACTICE_TIMER_MODES.some((item) => item.value === savedMode)) {
        state.preferredTimerMode = savedMode;
      }
    } catch {}
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    document.addEventListener('submit', handleSubmit);
    global.addEventListener('pagehide', persistSubjectCatalogState, { capture: true });
    global.addEventListener('scroll', () => {
      if (state.track === 'per_subject' && state.screen === 'catalog') {
        state.subjectPageScroll = Math.max(0, global.scrollY || 0);
      }
    }, { passive: true });
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
    document.addEventListener('visibilitychange', () => {
      if (!state.active || !['room', 'review'].includes(state.screen)) return;
      if (document.visibilityState === 'hidden') {
        saveRecovery();
        pauseActiveClock();
        return;
      }
      resumeActiveClock();
      saveCurrent({ silent: true }).then(() => heartbeat(false));
    });
    global.addEventListener('duediligence:session', (event) => {
      if (event.detail?.authenticated) return;
      if (state.active && ['room', 'review'].includes(state.screen)) saveRecovery();
      stopActiveTimers();
    });
    global.DueDiligencePrivateWorkspace?.registerReset?.(({ previousUserId, nextUserId }) => {
      if (previousUserId === nextUserId) return;
      resetForIdentityChange();
      if (nextUserId) readSubjectCatalogState();
    });

    const assignmentToken = new URLSearchParams(location.search).get('assignment');
    if (assignmentToken?.length >= 32) {
      openAssignment(assignmentToken);
      return;
    }
  }

  global.DueDiligenceExaminations = Object.freeze({
    openPerSubject: () => loadCatalog('per_subject'),
    openBarFeels: () => loadCatalog('bar_feels'),
    restoreRoute,
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
