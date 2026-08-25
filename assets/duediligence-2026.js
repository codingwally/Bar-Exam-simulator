(function dueDiligence2026Experience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const CONTENT_PATHS = Object.freeze({
    bar_easy: { hash: 'bar-easy', tab: 'spa-bar-easy', title: 'Quick Drills' },
    chair_case: { hash: 'chairs-cases', tab: 'spa-chairs-case', title: '2026 Bar Chair’s Cases' },
    doctrine: { hash: 'doctrines', tab: 'spa-jurisprudence', title: 'Doctrines' },
    anchor_case: { hash: 'anchor-case-digests', tab: 'spa-case-digest', title: 'Anchor Case Digests' },
  });
  const FLAG_NAMES = Object.freeze({
    bar_easy: 'BAR_EASY_ENABLED',
    chair_case: 'CHAIR_CASES_ENABLED',
    doctrine: 'DOCTRINES_ENABLED',
    anchor_case: 'ANCHOR_CASE_DIGESTS_ENABLED',
  });
  const RANDOMIZED_STUDY_VIEWS = new Set(['bar_easy', 'doctrine']);
  const STUDY_ROTATION_STORAGE_VERSION = 'v2';
  const state = {
    featureSnapshot: null,
    featureSnapshotUserId: null,
    featureSnapshotGeneration: null,
    featurePromise: null,
    featurePromiseUserId: null,
    featurePromiseGeneration: null,
    featureGeneration: 0,
    view: null,
    items: new Map(),
    filtered: [],
    selectedId: null,
    subject: 'All',
    search: '',
    result: null,
    busy: false,
    sessionUserId: null,
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

  function stableRotationHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function studyRotationKey(subject = state.subject) {
    const userPartition = stableRotationHash(authenticatedUserId() || 'signed-out');
    return `duediligence.study-rotation.${STUDY_ROTATION_STORAGE_VERSION}.${userPartition}.${stableRotationHash(state.view)}.${stableRotationHash(subject)}`;
  }

  function secureRandomIndex(maximum) {
    if (!Number.isInteger(maximum) || maximum <= 1) return 0;
    const ceiling = 0x100000000;
    const acceptable = ceiling - (ceiling % maximum);
    const sample = new Uint32Array(1);
    do crypto.getRandomValues(sample); while (sample[0] >= acceptable);
    return sample[0] % maximum;
  }

  function securelyShuffle(values) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomIndex(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function readStudyRotation(items, subject = state.subject) {
    const ids = items.map((item) => String(item.id || '')).filter(Boolean);
    const allowed = new Set(ids);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(studyRotationKey(subject)) || '{}'); } catch { saved = {}; }
    const seen = Array.isArray(saved.seen)
      ? [...new Set(saved.seen.map(String).filter((id) => allowed.has(id)))]
      : [];
    const seenSet = new Set(seen);
    const remaining = Array.isArray(saved.remaining)
      ? [...new Set(saved.remaining.map(String).filter((id) => allowed.has(id) && !seenSet.has(id)))]
      : [];
    const queued = new Set(remaining);
    const additions = ids.filter((id) => !seenSet.has(id) && !queued.has(id));
    remaining.push(...securelyShuffle(additions));
    return { seen, remaining, lastId: allowed.has(String(saved.lastId || '')) ? String(saved.lastId) : '' };
  }

  function writeStudyRotation(rotation, subject = state.subject) {
    try {
      localStorage.setItem(studyRotationKey(subject), JSON.stringify({
        seen: rotation.seen,
        remaining: rotation.remaining,
        lastId: rotation.lastId,
      }));
    } catch {
      // Storage can be unavailable in strict private browsing; the current in-memory selection still works.
    }
  }

  function takeRandomStudyItem(items, subject = state.subject) {
    if (!items.length) return null;
    const ids = items.map((item) => String(item.id || '')).filter(Boolean);
    const rotation = readStudyRotation(items, subject);
    if (!rotation.remaining.length) {
      rotation.seen = [];
      rotation.remaining = securelyShuffle(ids);
      if (rotation.remaining.length > 1 && rotation.remaining[0] === rotation.lastId) {
        [rotation.remaining[0], rotation.remaining[1]] = [rotation.remaining[1], rotation.remaining[0]];
      }
    }
    const selectedId = rotation.remaining.shift() || null;
    if (selectedId) {
      rotation.seen.push(selectedId);
      rotation.lastId = selectedId;
      writeStudyRotation(rotation, subject);
    }
    return selectedId;
  }

  function consumeExplicitStudyItem(items, selectedId, subject = state.subject) {
    if (!selectedId || !items.some((item) => String(item.id) === String(selectedId))) return;
    const rotation = readStudyRotation(items, subject);
    rotation.remaining = rotation.remaining.filter((id) => id !== String(selectedId));
    if (!rotation.seen.includes(String(selectedId))) rotation.seen.push(String(selectedId));
    rotation.lastId = String(selectedId);
    writeStudyRotation(rotation, subject);
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

  function authenticatedUserId() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    const session = phase4?.getSession?.();
    return session?.access_token && session?.user?.id ? String(session.user.id) : null;
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

  function invalidateFeatureCache() {
    state.featureGeneration += 1;
    state.featureSnapshot = null;
    state.featureSnapshotUserId = null;
    state.featureSnapshotGeneration = null;
    state.featurePromise = null;
    state.featurePromiseUserId = null;
    state.featurePromiseGeneration = null;
  }

  function synchronizeSessionCaches(userId) {
    const featureRequestWasPending = Boolean(state.featurePromise);
    const normalizedUserId = userId ? String(userId) : null;
    const identityChanged = state.sessionUserId !== normalizedUserId;
    state.sessionUserId = normalizedUserId;
    if (identityChanged || !featureRequestWasPending) invalidateFeatureCache();
    return { identityChanged, featureRequestWasPending };
  }

  function shouldReopenSessionRoute(identityChanged, routePageActive) {
    return identityChanged || !routePageActive;
  }

  function isCurrentFeatureRequest(userId, generation) {
    return Boolean(userId)
      && state.sessionUserId === userId
      && state.featureGeneration === generation
      && authenticatedUserId() === userId;
  }

  async function features({ forceFresh = false, userId = authenticatedUserId() } = {}) {
    const scopedUserId = userId ? String(userId) : null;
    if (!scopedUserId) return null;
    if (state.sessionUserId !== scopedUserId) {
      state.sessionUserId = scopedUserId;
      invalidateFeatureCache();
    }
    if (forceFresh) invalidateFeatureCache();
    const generation = state.featureGeneration;
    if (state.featureSnapshot
        && state.featureSnapshotUserId === scopedUserId
        && state.featureSnapshotGeneration === generation) {
      return state.featureSnapshot;
    }
    if (state.featurePromise
        && state.featurePromiseUserId === scopedUserId
        && state.featurePromiseGeneration === generation) {
      return state.featurePromise;
    }
    const pending = api('/dd2026/features', {});
    state.featurePromise = pending;
    state.featurePromiseUserId = scopedUserId;
    state.featurePromiseGeneration = generation;
    try {
      const payload = await pending;
      if (!isCurrentFeatureRequest(scopedUserId, generation)) return null;
      state.featureSnapshot = payload;
      state.featureSnapshotUserId = scopedUserId;
      state.featureSnapshotGeneration = generation;
      return payload;
    } catch (error) {
      if (!isCurrentFeatureRequest(scopedUserId, generation)) return null;
      throw error;
    } finally {
      if (state.featurePromise === pending) {
        state.featurePromise = null;
        state.featurePromiseUserId = null;
        state.featurePromiseGeneration = null;
      }
    }
  }

  function activatePage(view, trigger, { replace = false, detailId = null } = {}) {
    ensurePage();
    const item = trigger || document.getElementById(CONTENT_PATHS[view]?.tab);
    global.showPage?.('dd2026', item, { history: false });
    const path = CONTENT_PATHS[view]?.hash || 'mock-bar';
    const hash = detailId
      ? path + '/' + encodeURIComponent(detailId)
      : path;
    const url = location.pathname + location.search + '#' + hash;
    const currentUrl = location.pathname + location.search + location.hash;
    if (currentUrl !== url) {
      history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), dueDiligence2026: view }, '', url);
    }
  }
  function loading(title) {
    app().innerHTML = `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Due Diligence 2026</div><h1>${escapeHtml(title)}</h1></div><span class="dd26-beta">Source-based study</span></header><div class="dd26-loading" role="status">Loading protected study material…</div></div>`;
  }

  function showError(error, retry) {
    const message = error?.message || 'This module could not be loaded.';
    app().innerHTML = `<div class="dd26-shell"><div class="dd26-error" role="alert">${escapeHtml(message)}</div><div class="dd26-actions"><button class="dd26-button" id="dd26-retry" type="button">Try again</button></div></div>`;
    document.getElementById('dd26-retry')?.addEventListener('click', retry);
  }

  async function open(view, trigger, options = {}) {
    if (!CONTENT_PATHS[view]) return false;
    if (!requireAuthentication()) return false;
    const openUserId = authenticatedUserId();
    state.view = view;
    state.result = null;
    activatePage(view, trigger, options);
    loading(CONTENT_PATHS[view].title);
    try {
      const snapshot = await features({ userId: openUserId });
      if (!snapshot || state.view !== view || authenticatedUserId() !== openUserId) return false;
      const flag = FLAG_NAMES[view];
      if (flag && snapshot?.flags?.[flag] !== true) throw new Error('This module is temporarily unavailable.');
      await openContentView(view, options.detailId || null);
      return true;
    } catch (error) {
      if (state.view !== view || authenticatedUserId() !== openUserId) return false;
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
      state.selectedId = RANDOMIZED_STUDY_VIEWS.has(state.view)
        ? null
        : state.filtered[0]?.id || null;
    }
  }

  async function openContentView(type, detailId) {
    const items = await queryContent(type);
    state.subject = 'All';
    state.search = '';
    state.selectedId = detailId && items.some((item) => item.id === detailId)
      ? detailId
      : RANDOMIZED_STUDY_VIEWS.has(type) ? null : items[0]?.id || null;
    setContentFilter(items);
    if (RANDOMIZED_STUDY_VIEWS.has(type) && state.selectedId) {
      consumeExplicitStudyItem(state.filtered, state.selectedId);
    }
    renderContent();
  }

  function subjectChips(items) {
    const subjects = ['All', ...new Set(items.map((item) => item.subject).filter(Boolean))];
    return `<div class="dd26-toolbar" role="group" aria-label="Filter by subject">${subjects.map((subject) => `<button class="dd26-chip${state.subject === subject ? ' is-active' : ''}" type="button" data-dd26-subject="${escapeHtml(subject)}">${escapeHtml(shortSubject(subject))}</button>`).join('')}</div>`;
  }

  function subjectSelector(items) {
    const subjects = ['All', ...new Set(items.map((item) => item.subject).filter(Boolean))];
    return `<label class="dd26-subject-picker" for="dd26-subject-select"><span>Choose a Subject</span><select class="dd26-select" id="dd26-subject-select">${subjects.map((subject) => `<option value="${escapeHtml(subject)}"${state.subject === subject ? ' selected' : ''}>${escapeHtml(subject === 'All' ? 'All subjects' : shortSubject(subject))}</option>`).join('')}</select></label>`;
  }

  function betaNotice() {
    return '<div class="dd26-notice">AI-assisted educational content. Verify every proposition independently against current law and the linked primary authority.</div>';
  }

  function renderContent() {
    const items = state.items.get(state.view) || [];
    setContentFilter(items);
    if (RANDOMIZED_STUDY_VIEWS.has(state.view) && !state.selectedId) {
      state.selectedId = takeRandomStudyItem(state.filtered);
    }
    if (state.view === 'bar_easy') renderBarEasy(items);
    else if (state.view === 'doctrine') renderDoctrines(items);
    else renderCaseLibrary(items, state.view === 'chair_case');
  }

  function selectedItem() { return state.filtered.find((item) => item.id === state.selectedId) || null; }

  function renderBarEasy(items) {
    const item = selectedItem();
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">Quick Drills</div><h1>Quick Drills</h1><p>Build legal reasoning with focused questions and source-based coaching.</p></div><span class="dd26-beta">Source-based study</span></header>
      ${subjectSelector(items)}
      <div class="dd26-grid">
        <section class="dd26-pane" aria-labelledby="dd26-easy-question">
          <h2 class="dd26-prompt" id="dd26-easy-question">${escapeHtml(payload.prompt || '')}</h2>
          <label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea" id="dd26-easy-answer" maxlength="5000" placeholder="Explain the rule in your own words."></textarea><small class="dd26-counter" id="dd26-easy-count">0 / 5,000</small></label>
          <div class="dd26-actions"><button class="dd26-button primary" id="dd26-easy-submit" type="button">Submit answer</button><button class="dd26-button" id="dd26-easy-next" type="button">Next question</button></div>
          <div class="dd26-privacy">Your answer text and coaching explanation are not saved. Only the completion count is recorded.</div>${betaNotice()}
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
    if (codePointLength(answer.value) > 5000) { global.toast?.('Quick Drills answers are limited to 5,000 characters. Nothing was truncated.', 'warn'); return; }
    state.busy = true; button.disabled = true; button.textContent = 'Reviewing…';
    try {
      const payload = await api('/dd2026/bar-easy/grade', { contentId: item.id, answer: answer.value, requestKey: randomKey('easy') });
      const result = payload.result || {};
      const study = payload.study || {};
      document.getElementById('dd26-easy-result').innerHTML = `<div class="dd26-result"><div class="dd26-kicker">Source-based coaching</div><h2 class="dd26-result-title">${escapeHtml(result.label)}</h2><section class="dd26-section"><h3>Coaching feedback</h3><p>${escapeHtml(result.feedback)}</p></section><section class="dd26-section"><h3>Suggested answer</h3><p>${escapeHtml(study.suggestedAnswer)}</p></section><section class="dd26-section"><h3>Why this works</h3><p>${escapeHtml(study.explanation)}</p></section><section class="dd26-section"><h3>Primary source</h3><p>${escapeHtml([study.primarySource?.title, study.primarySource?.citation].filter(Boolean).join(' · '))}</p>${safeSourceLink(study.primarySource?.url)}</section>${betaNotice()}</div>`;
      answer.value = '';
      answer.dispatchEvent(new Event('input'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally { state.busy = false; button.disabled = false; button.textContent = 'Submit answer'; }
  }

  function selectNext() {
    if (!state.filtered.length) return;
    state.selectedId = takeRandomStudyItem(state.filtered);
    state.result = null;
    renderContent();
  }

  function renderDoctrines(items) {
    const item = selectedItem();
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">Recall / Explain / Verify</div><h1>Doctrines</h1><p>Explain the doctrine in your own words, then compare your understanding with its canonical meaning and limits.</p></div><span class="dd26-beta">Source-based study</span></header>
      ${subjectSelector(items)}
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
      <header class="dd26-header"><div><div class="dd26-kicker">${chairs ? 'Justice Samuel H. Gaerlan / 2026' : 'Core jurisprudence / 2026'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><span class="dd26-beta">Source-based study</span></header>
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
    document.getElementById('dd26-subject-select')?.addEventListener('change', (event) => {
      state.subject = event.currentTarget.value;
      state.selectedId = null;
      state.result = null;
      renderContent();
    });
    document.querySelectorAll('[data-dd26-subject]').forEach((button) => button.addEventListener('click', () => {
      state.subject = button.dataset.dd26Subject;
      state.selectedId = null;
      renderContent();
    }));
  }

  function openVerdictExport(resultId, questionId = '') {
    if (!requireAuthentication()) return false;
    const canSelectQuestion = Boolean(String(questionId || '').trim());
    openDialog(`<button class="dd26-verdict-close" data-dd26-close-dialog type="button" aria-label="Close private Analytics export">&times;</button><div class="dd26-label">Analytics / Private PDF</div><h2>Choose what to export</h2><p>Every included question contains the complete prompt, suggested answer, your answer, and coaching feedback.</p><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="entire_result" checked><span><strong>Entire result</strong><small>Export every available question and section.</small></span></label><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="questions" ${canSelectQuestion ? '' : 'disabled'}><span><strong>This question only</strong><small>${canSelectQuestion ? escapeHtml(questionId) : 'No individual question identifier is available for this legacy result.'}</small></span></label><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Back</button><button class="dd26-button primary" id="dd26-confirm-verdict-export" type="button">Generate private PDF</button></div>`);
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
        body: JSON.stringify({
          gradingResultId: Array.isArray(resultId) ? resultId[0] : resultId,
          gradingResultIds: Array.isArray(resultId) ? resultId : [resultId],
          selectionKind,
          selectedIds,
          requestKey: randomKey('verdict'),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'The Analytics PDF could not be generated.');
      }
      const blob = await response.blob();
      if (blob.type !== 'application/pdf' || !blob.size || blob.size > 25 * 1024 * 1024) throw new Error('The Analytics PDF response was invalid.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'duediligence-verdict.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      global.toast?.('Your private Analytics PDF is ready.', 'ok');
      return true;
    } catch (error) {
      global.toast?.(error.message, 'warn');
      return false;
    }
  }

  let dialogReturnFocus = null;
  let dialogCleanup = null;

  function finishDialogLifecycle(dialog = document.getElementById('dd26-dialog')) {
    if (!dialog) return;
    const card = document.getElementById('dd26-dialog-card');
    card?.querySelectorAll('input[type="password"], [data-dd26-sensitive]').forEach((node) => {
      if ('value' in node) node.value = '';
      node.textContent = '';
    });
    if (dialog.dataset.sensitive === 'true') card?.replaceChildren();
    dialog.dataset.sensitive = 'false';
    const cleanup = dialogCleanup;
    dialogCleanup = null;
    try { cleanup?.(); } catch { /* secrets are already removed from the dialog */ }
  }

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
        finishDialogLifecycle(dialog);
        dialogReturnFocus?.focus?.();
        dialogReturnFocus = null;
      });
    }
    const nextReturnFocus = document.activeElement;
    const preserveOriginalFocus = dialog.open && dialogReturnFocus?.isConnected;
    finishDialogLifecycle(dialog);
    if (!preserveOriginalFocus) dialogReturnFocus = nextReturnFocus;
    dialog.dataset.persistent = options.persistent ? 'true' : 'false';
    dialog.dataset.sensitive = options.sensitive ? 'true' : 'false';
    dialogCleanup = typeof options.onClose === 'function' ? options.onClose : null;
    const card = document.getElementById('dd26-dialog-card');
    card.innerHTML = content.replace(/<h2(\s|>)/, '<h2 id="dd26-dialog-heading"$1');
    if (!card.querySelector('.dd26-dialog-close, .dd26-verdict-close')) {
      card.insertAdjacentHTML('afterbegin', '<button class="dd26-dialog-close" data-dd26-close-dialog type="button" aria-label="Close dialog and go back">&times;</button>');
    }
    let actions = card.querySelector('.dd26-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'dd26-actions';
      card.append(actions);
    }
    let back = actions.querySelector('[data-dd26-close-dialog]');
    if (!back) {
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'dd26-button';
      back.dataset.dd26CloseDialog = 'true';
      actions.append(back);
    }
    back.textContent = 'Back';
    back.setAttribute('aria-label', 'Back');
    back.classList.remove('primary', 'danger');
    document.querySelectorAll('[data-dd26-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
    if (!dialog.open) dialog.showModal();
    document.getElementById('dd26-dialog-card')?.focus();
  }

  function closeDialog() {
    const dialog = document.getElementById('dd26-dialog');
    finishDialogLifecycle(dialog);
    if (dialog?.open) dialog.close();
  }
  function routeFromHash() {
    let raw = '';
    try { raw = decodeURIComponent(location.hash.replace(/^#/, '')); }
    catch { return null; }
    if (raw === 'bar-easy') return ['bar_easy'];
    if (raw === 'chairs-cases') return ['chair_case'];
    if (raw === 'doctrines') return ['doctrine'];
    if (raw === 'anchor-case-digests') return ['anchor_case'];
    if (raw.startsWith('anchor-case-digests/')) return ['anchor_case', raw.slice('anchor-case-digests/'.length)];
    return null;
  }
  function restoreRoute() {
    const route = routeFromHash();
    if (route) open(route[0], document.getElementById(CONTENT_PATHS[route[0]].tab), {
      replace: true, detailId: route[1] || null, ...(route[2] || {}),
    });
  }

  global.DueDiligence2026 = Object.freeze({ open, exportVerdict, openVerdictExport, restoreRoute });
  global.openBarEasy = () => open('bar_easy', document.getElementById('spa-bar-easy'));
  global.openChairCases = () => open('chair_case', document.getElementById('spa-chairs-case'));
  global.openDoctrines = () => open('doctrine', document.getElementById('spa-jurisprudence'));
  global.openAnchorCases = () => open('anchor_case', document.getElementById('spa-case-digest'));
  global.addEventListener('popstate', restoreRoute);
  global.addEventListener('duediligence:session', (event) => {
    const sessionUserId = event.detail?.authenticated ? event.detail?.userId || null : null;
    const { identityChanged } = synchronizeSessionCaches(sessionUserId);
    if (event.detail?.authenticated) {
      const route = routeFromHash();
      const routePageActive = document.getElementById('page-dd2026')?.classList.contains('active');
      if (route && shouldReopenSessionRoute(identityChanged, routePageActive)) restoreRoute();
      return;
    }
    if (document.getElementById('page-dd2026')?.classList.contains('active')) {
      global.showPage?.('mock', document.getElementById('spa-mock'));
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreRoute, { once: true });
  else restoreRoute();
}(window));
