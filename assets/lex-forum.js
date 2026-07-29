(function dueDiligenceQuorum(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const destinationKey = 'duediligence.quorum.destination.v1';
  const draftKey = 'duediligence.quorum.draft.v1';
  const entryLimit = 4000;
  const commentLimit = 2000;
  const citationLimit = 1000;
  const imageLimit = 3 * 1024 * 1024;
  const subjects = [
    'Political Law',
    'Labor Law',
    'Civil Law',
    'Taxation Law',
    'Mercantile Law',
    'Criminal Law',
    'Remedial Law',
    'Legal Ethics',
  ];
  const entryTypes = new Map([
    ['ask_community', 'Ask the Community'],
    ['discuss_legal_issue', 'Discuss a Legal Issue'],
    ['share_case_note', 'Share a Case Note'],
    ['request_study_help', 'Request Study Help'],
    ['share_resource', 'Share a Resource'],
    ['student_support', 'Student Support'],
    ['school_bar_announcement', 'School or Bar Announcement'],
  ]);
  const categories = new Map([
    ['philippine_legal_education', 'Philippine legal education'],
    ['philippine_jurisprudence', 'Philippine jurisprudence'],
    ['bar_examination', 'Bar examination'],
    ['law_school_life', 'Law-school life'],
    ['career_internship', 'Career and internship'],
    ['student_support', 'Student support'],
    ['comparative_law', 'Comparative Law'],
  ]);
  const reportCategories = new Map([
    ['harassment', 'Harassment'],
    ['misinformation', 'Material legal misinformation'],
    ['unsafe_link', 'Unsafe or deceptive link'],
    ['spam', 'Spam'],
    ['privacy', 'Private personal information'],
    ['sexual_content', 'Pornographic or sexual content'],
    ['unlawful_content', 'Unlawful content'],
    ['fundraising_spam', 'Fundraising spam'],
    ['unauthorized_advertising', 'Unauthorized advertising'],
    ['copyright', 'Copyright infringement'],
    ['impersonation', 'Impersonation'],
    ['academic_dishonesty', 'Academic dishonesty'],
    ['other', 'Other community-standard concern'],
  ]);
  const notificationLabels = {
    entry_comment: 'commented on your entry',
    comment_reply: 'replied to your comment',
    helpful: 'marked your entry Helpful',
    repost: 'cited your entry',
    circle_activity: 'added activity in a Study Circle',
    moderation_decision: 'sent a moderation update',
  };

  const state = {
    active: false,
    authenticated: false,
    initialized: false,
    loading: false,
    loaded: false,
    view: 'home',
    items: [],
    cursor: null,
    hasMore: false,
    filters: { subject: '', entryType: '', category: '', sort: 'latest', query: '' },
    bootstrap: null,
    comments: new Map(),
    commentsOpen: new Set(),
    circles: [],
    circleDetail: null,
    circleJoinedOnly: false,
    searchResults: null,
    selectedImage: null,
    directEntryId: null,
    legacyPostId: null,
    trigger: null,
    dialogReturnFocus: null,
    searchController: null,
    pending: new Set(),
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function session() {
    return global.DueDiligencePhase2?.getSession?.() || null;
  }

  function hasSession() {
    return Boolean(session()?.access_token);
  }

  function requestId() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function safeStorage(storage, method, key, value) {
    try {
      if (method === 'get') return storage.getItem(key);
      if (method === 'remove') storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      return null;
    }
    return null;
  }

  function rememberDestination() {
    safeStorage(sessionStorage, 'set', destinationKey, JSON.stringify({
      entryId: state.directEntryId,
      legacyPostId: state.legacyPostId,
      view: state.view,
      createdAt: Date.now(),
    }));
  }

  function consumeDestination() {
    const raw = safeStorage(sessionStorage, 'get', destinationKey);
    safeStorage(sessionStorage, 'remove', destinationKey);
    try {
      const value = JSON.parse(raw || 'null');
      if (!value || Date.now() - Number(value.createdAt || 0) > 30 * 60 * 1000) return null;
      return value;
    } catch {
      return null;
    }
  }

  function setAuthView(authenticated, message = '') {
    state.authenticated = authenticated;
    const app = $('#lex-forum-app');
    const guard = $('#lex-auth-state');
    if (app) app.hidden = !authenticated;
    if (guard) {
      guard.hidden = authenticated;
      guard.textContent = message || 'Quorum is available only to signed-in Due Diligence members.';
    }
  }

  function clearPrivateView() {
    state.items = [];
    state.cursor = null;
    state.hasMore = false;
    state.loaded = false;
    state.bootstrap = null;
    state.comments.clear();
    state.commentsOpen.clear();
    $('#lex-feed')?.replaceChildren();
    setAuthView(false);
  }

  function askForSignIn() {
    rememberDestination();
    global.showPage?.('community', state.trigger || $('#spa-community'));
    setAuthView(false, 'Sign in to enter Quorum. No guest community access is available.');
    global.DueDiligencePhase2?.openSignIn?.({
      allowGuest: false,
      allowDismiss: true,
      title: 'Enter Quorum',
      copy: 'Quorum is free for signed-in Due Diligence members.',
      message: 'Use your existing Due Diligence account. You will return here after authentication.',
    });
  }

  function setStableLocation(entryId = null, { replace = true } = {}) {
    const url = new URL(location.href);
    url.searchParams.delete('forumPost');
    if (entryId) url.searchParams.set('quorumEntry', entryId);
    else url.searchParams.delete('quorumEntry');
    url.hash = 'quorum';
    const method = replace ? 'replaceState' : 'pushState';
    history[method](history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function stableEntryUrl(entryId) {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('quorumEntry', entryId);
    url.hash = 'quorum';
    return url.href;
  }

  async function api(path, body = {}, options = {}) {
    const currentSession = session();
    if (!currentSession?.access_token) {
      const error = new Error('Sign in to use Quorum.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    if (!navigator.onLine) {
      const error = new Error('You appear to be offline. Reconnect and retry.');
      error.code = 'OFFLINE';
      throw error;
    }
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentSession.access_token}`,
        'X-Request-ID': requestId(),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'Quorum is temporarily unavailable.');
      error.code = payload?.error?.code || 'QUORUM_UNAVAILABLE';
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  function query(operation, payload = {}, options = {}) {
    return api('/quorum/query', { operation, payload }, options);
  }

  function command(operation, payload = {}, image = null) {
    return api('/quorum/command', {
      operation,
      payload,
      ...(image ? { image } : {}),
    });
  }

  function telemetry(eventType, details = {}) {
    if (!hasSession()) return;
    command('telemetry', { eventType, ...details }).catch(() => {});
  }

  function handleError(error, target = $('#lex-feed-status')) {
    if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      clearPrivateView();
      askForSignIn();
      return;
    }
    if (error?.name === 'AbortError') return;
    const message = error?.message || 'The Quorum action could not be completed.';
    if (target) {
      target.textContent = message;
      target.classList.add('is-error');
    }
    toast(message);
    telemetry('api_failed', { resultCategory: String(error?.code || 'unknown').slice(0, 80) });
  }

  function setFeedStatus(message = '', kind = '') {
    const status = $('#lex-feed-status');
    if (!status) return;
    status.textContent = message;
    status.className = `lex-status${kind ? ` is-${kind}` : ''}`;
  }

  function toast(message) {
    let node = $('#lex-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'lex-toast';
      node.className = 'lex-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.append(node);
    }
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.classList.remove('is-visible'), 3400);
  }

  function textElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  }

  function button(label, className, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.addEventListener('click', handler);
    return node;
  }

  function option(value, label) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  }

  function initials(name) {
    return String(name || 'Due Diligence Member')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'DD';
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Recently';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return formatter.format(days, 'day');
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium',
      timeZone: 'Asia/Manila',
    }).format(date);
  }

  function sourceLink(sourceUrl) {
    if (!sourceUrl) return null;
    try {
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
      const link = document.createElement('a');
      link.className = 'lex-source-link';
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer ugc';
      link.textContent = `Review source · ${parsed.hostname}`;
      return link;
    } catch {
      return null;
    }
  }

  async function copyStableLink(entryId) {
    const link = stableEntryUrl(entryId);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement('textarea');
      field.value = link;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    toast('Stable Quorum link copied.');
  }

  function ensureDialog() {
    let dialog = $('#lex-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'lex-dialog';
    dialog.className = 'lex-dialog';
    dialog.setAttribute('aria-labelledby', 'lex-dialog-title');
    const header = document.createElement('header');
    header.className = 'lex-dialog-header';
    const heading = document.createElement('div');
    heading.append(
      textElement('span', 'lex-kicker', 'Quorum'),
      textElement('h2', '', 'Dialog'),
    );
    heading.querySelector('h2').id = 'lex-dialog-title';
    const close = button('×', 'lex-dialog-close', closeDialog);
    close.setAttribute('aria-label', 'Close dialog');
    header.append(heading, close);
    const body = document.createElement('div');
    body.id = 'lex-dialog-body';
    body.className = 'lex-dialog-body';
    dialog.append(header, body);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener('close', () => {
      const focus = state.dialogReturnFocus;
      state.dialogReturnFocus = null;
      if (focus?.isConnected) requestAnimationFrame(() => focus.focus());
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = $$(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        dialog,
      ).filter((node) => !node.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.append(dialog);
    return dialog;
  }

  function closeDialog() {
    const dialog = $('#lex-dialog');
    if (dialog?.open) dialog.close();
  }

  function openDialog(title, build) {
    const dialog = ensureDialog();
    state.dialogReturnFocus = document.activeElement;
    $('#lex-dialog-title').textContent = title;
    const body = $('#lex-dialog-body');
    body.replaceChildren();
    build(body, dialog);
    dialog.showModal();
    requestAnimationFrame(() => body.querySelector('textarea,select,input,button')?.focus());
  }

  function inlineError() {
    const node = textElement('div', 'lex-status lex-inline-error', '');
    node.setAttribute('role', 'alert');
    return node;
  }

  function confirmDialog({ title, copy, warning = '', confirmLabel, onConfirm }) {
    openDialog(title, (body) => {
      body.append(textElement('p', 'lex-dialog-copy', copy));
      if (warning) body.append(textElement('div', 'lex-dialog-warning', warning));
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const confirm = button(confirmLabel, 'lex-button lex-button-primary', async () => {
        if (confirm.disabled) return;
        confirm.disabled = true;
        error.textContent = '';
        try {
          await onConfirm();
          closeDialog();
        } catch (failure) {
          confirm.disabled = false;
          error.textContent = failure?.message || 'The action could not be completed.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), confirm);
      body.append(error, actions);
    });
  }

  function authorBlock(author = {}) {
    const wrapper = document.createElement('button');
    wrapper.type = 'button';
    wrapper.className = 'lex-author';
    wrapper.setAttribute('aria-label', `Open ${author.displayName || 'member'} profile`);
    wrapper.append(textElement('span', 'lex-author-avatar', initials(author.displayName)));
    const copy = document.createElement('span');
    copy.className = 'lex-author-copy';
    const name = author.verifiedAcademicIdentity
      ? `${author.displayName || 'Due Diligence Member'} · Verified Academic Identity`
      : author.displayName || 'Due Diligence Member';
    copy.append(
      textElement('strong', '', name),
      textElement('span', '', [author.school, author.yearLevel].filter(Boolean).join(' · ') || 'Due Diligence member'),
    );
    wrapper.append(copy);
    if (author.memberId) wrapper.addEventListener('click', () => showMemberProfile(author.memberId));
    else wrapper.disabled = true;
    return wrapper;
  }

  function entryTime(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lex-post-time';
    const time = document.createElement('time');
    time.dateTime = String(item.createdAt || '');
    time.textContent = relativeTime(item.createdAt);
    wrapper.append(time);
    if (item.edited) wrapper.append(document.createElement('br'), document.createTextNode('Edited'));
    return wrapper;
  }

  function chip(value, className = 'quorum-chip') {
    return textElement('span', className, value);
  }

  function renderEntry(item) {
    const article = document.createElement('article');
    article.className = 'lex-post-card';
    article.id = `quorum-entry-${item.entryId}`;
    article.dataset.entryId = item.entryId;

    if (item.kind === 'citation' && item.citation) {
      const banner = document.createElement('div');
      banner.className = 'lex-repost-banner';
      banner.append(
        textElement('span', '', 'Cited by'),
        authorBlock(item.citation.author || {}),
        textElement('span', '', relativeTime(item.citation.createdAt)),
      );
      article.append(banner);
      if (item.citation.commentary) {
        article.append(textElement('p', 'lex-repost-commentary', item.citation.commentary));
      }
    }

    const inner = document.createElement('div');
    inner.className = 'lex-post-inner';
    const header = document.createElement('header');
    header.className = 'lex-post-header';
    header.append(authorBlock(item.author || {}), entryTime(item));
    inner.append(header);

    const chips = document.createElement('div');
    chips.className = 'quorum-chip-row';
    chips.append(chip(entryTypes.get(item.entryType) || 'Quorum Entry'));
    if (item.subject) chips.append(chip(item.subject));
    if (item.category) chips.append(chip(categories.get(item.category) || item.category));
    if (item.lawSchoolYear) chips.append(chip(item.lawSchoolYear));
    if (item.circle?.name) chips.append(chip(`Study Circle: ${item.circle.name}`));
    inner.append(chips);

    if (item.caseTitle) inner.append(textElement('h3', 'quorum-entry-heading', item.caseTitle));
    inner.append(textElement('p', 'lex-post-body', item.body));

    const indicators = document.createElement('div');
    indicators.className = 'quorum-entry-indicators';
    (item.indicators || []).forEach((label) => indicators.append(chip(label, 'quorum-indicator')));
    if (indicators.childElementCount) inner.append(indicators);

    const source = sourceLink(item.sourceUrl);
    if (source) inner.append(source);
    if (item.imageUrl) {
      const image = document.createElement('img');
      image.className = 'quorum-entry-image';
      image.src = item.imageUrl;
      image.alt = `Image attached to the Quorum entry by ${item.author?.displayName || 'a member'}`;
      image.loading = 'lazy';
      image.decoding = 'async';
      inner.append(image);
    }

    if (item.practiceQuestionId && item.subject) {
      const practice = button('Practice this issue', 'lex-button lex-button-quiet', async () => {
        practice.disabled = true;
        telemetry('practice_clicked', { subject: item.subject, entryType: item.entryType });
        const opened = await global.openQuorumMappedQuestion?.(item.subject, item.practiceQuestionId);
        if (!opened) practice.disabled = false;
      });
      practice.title = 'Open the genuinely mapped Moot Court question; existing plan access still applies.';
      inner.append(practice);
    }

    const actions = document.createElement('div');
    actions.className = 'lex-post-actions';
    const helpful = button(
      `Helpful ${Number(item.counts?.helpful || 0)}`,
      `lex-action${item.viewerHelpful ? ' is-active' : ''}`,
      () => toggleHelpful(item, helpful),
    );
    helpful.setAttribute('aria-pressed', item.viewerHelpful ? 'true' : 'false');
    const comments = button(
      `Comment ${Number(item.counts?.comments || 0)}`,
      'lex-action',
      () => toggleComments(item, article),
    );
    const cite = button(
      `Cite / Send ${Number(item.counts?.citations || 0)}`,
      'lex-action',
      () => openCitationDialog(item),
    );
    cite.title = 'Repost inside Quorum, copy a stable link, or use your device share sheet.';
    const save = button(
      item.viewerSaved ? 'Saved' : 'Save',
      `lex-action${item.viewerSaved ? ' is-active' : ''}`,
      () => toggleSaved(item, save),
    );
    save.setAttribute('aria-pressed', item.viewerSaved ? 'true' : 'false');
    actions.append(helpful, comments, cite, save);
    inner.append(actions);

    const menu = document.createElement('div');
    menu.className = 'lex-post-owner-actions';
    menu.append(
      button('Open', 'lex-menu-button', () => openEntry(item.entryId, { push: true })),
      button('Copy link', 'lex-menu-button', () => copyStableLink(item.entryId)),
      button('Report', 'lex-menu-button', () => openReportDialog('entry', item.entryId)),
    );
    if (item.viewerOwns) {
      menu.append(
        button('Edit', 'lex-menu-button', () => openEditEntryDialog(item)),
        button('Remove', 'lex-menu-button is-danger', () => removeEntry(item)),
      );
    }
    if (item.kind === 'citation' && item.citation?.viewerOwns) {
      menu.append(button('Remove citation', 'lex-menu-button is-danger', () => removeCitation(item.citation.citationId)));
    }
    inner.append(menu);
    article.append(inner);

    if (state.commentsOpen.has(item.entryId)) {
      article.append(renderCommentsSection(item, state.comments.get(item.entryId)));
    }
    return article;
  }

  function renderFeed() {
    const feed = $('#lex-feed');
    if (!feed) return;
    feed.replaceChildren();
    if (state.view === 'circle' && state.circleDetail) {
      feed.append(circleDetailPanel(state.circleDetail));
    }
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = navigator.onLine ? 'lex-empty' : 'lex-offline';
      empty.append(
        textElement('strong', '', state.view === 'saved'
          ? 'No saved authorities yet.'
          : state.view === 'unanswered'
            ? 'No unanswered questions match these filters.'
            : 'No Quorum entries match this view.'),
        textElement('p', '', state.view === 'saved'
          ? 'Save a useful entry to build your private authority list.'
          : 'Clear filters, refresh, or contribute a focused entry.'),
        button('Refresh', 'lex-button lex-button-quiet', () => refreshFeed()),
      );
      feed.append(empty);
    } else {
      state.items.forEach((item) => feed.append(renderEntry(item)));
    }
    const loadMore = $('#lex-load-more');
    if (loadMore) loadMore.hidden = !state.hasMore;
  }

  function feedPayload(append = false) {
    const payload = {
      limit: 10,
      sort: state.filters.sort,
    };
    if (state.filters.subject) payload.subject = state.filters.subject;
    if (state.filters.entryType) payload.entryType = state.filters.entryType;
    if (state.filters.category) payload.category = state.filters.category;
    if (state.filters.query) payload.query = state.filters.query;
    if (state.view === 'circle' && state.activeCircleId) payload.circleId = state.activeCircleId;
    if (append && state.cursor) {
      payload.cursorAt = state.cursor.createdAt;
      payload.cursorId = state.cursor.id;
    }
    return payload;
  }

  async function refreshFeed(options = {}) {
    if (!hasSession() || state.loading) return;
    const append = options.append === true;
    state.loading = true;
    const feed = $('#lex-feed');
    feed?.setAttribute('aria-busy', 'true');
    setFeedStatus(append ? 'Loading more entries…' : 'Loading Quorum entries…');
    if (!append && feed) {
      feed.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'lex-skeleton' }),
        Object.assign(document.createElement('div'), { className: 'lex-skeleton' }),
      );
    }
    try {
      let operation = state.view === 'saved' ? 'saved' : state.view === 'unanswered' ? 'unanswered' : 'feed';
      const payload = await query(operation, feedPayload(append));
      state.items = append ? state.items.concat(payload.items || []) : payload.items || [];
      state.cursor = payload.nextCursor || null;
      state.hasMore = Boolean(payload.hasMore);
      state.loaded = true;
      renderFeed();
      setFeedStatus(state.items.length
        ? `${state.items.length.toLocaleString()} ${state.items.length === 1 ? 'entry' : 'entries'} shown.`
        : '');
    } catch (error) {
      if (!append) state.items = [];
      renderFeed();
      handleError(error);
    } finally {
      state.loading = false;
      feed?.setAttribute('aria-busy', 'false');
    }
  }

  async function openEntry(entryId, options = {}) {
    if (!entryId) return;
    state.view = 'entry';
    state.directEntryId = entryId;
    state.legacyPostId = null;
    setViewLabels('Entry', 'Stable Quorum entry');
    syncViewButtons();
    setStableLocation(entryId, { replace: options.push !== true });
    $('#lex-composer').hidden = true;
    const feed = $('#lex-feed');
    feed?.setAttribute('aria-busy', 'true');
    setFeedStatus('Opening entry…');
    try {
      const payload = await query('entry', { entryId });
      state.items = [payload.entry];
      state.comments.set(entryId, Array.isArray(payload.comments) ? payload.comments : []);
      state.commentsOpen.add(entryId);
      state.hasMore = false;
      renderFeed();
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    } finally {
      feed?.setAttribute('aria-busy', 'false');
    }
  }

  async function openLegacyEntry(legacyPostId) {
    state.view = 'entry';
    $('#lex-composer').hidden = true;
    setViewLabels('Entry', 'Opening a legacy stable link');
    setFeedStatus('Opening entry…');
    try {
      const payload = await query('entry', { legacyPostId });
      state.directEntryId = payload.entry.entryId;
      state.legacyPostId = null;
      state.items = [payload.entry];
      state.comments.set(payload.entry.entryId, Array.isArray(payload.comments) ? payload.comments : []);
      state.commentsOpen.add(payload.entry.entryId);
      state.hasMore = false;
      setStableLocation(payload.entry.entryId);
      renderFeed();
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    }
  }

  async function toggleHelpful(item, control) {
    const desired = !item.viewerHelpful;
    const previousCount = Number(item.counts?.helpful || 0);
    item.viewerHelpful = desired;
    item.counts.helpful = Math.max(0, previousCount + (desired ? 1 : -1));
    control.classList.toggle('is-active', desired);
    control.setAttribute('aria-pressed', desired ? 'true' : 'false');
    control.textContent = `Helpful ${item.counts.helpful}`;
    control.disabled = true;
    try {
      const result = await command('set_helpful', { entryId: item.entryId, enabled: desired });
      item.viewerHelpful = Boolean(result.enabled);
      item.counts.helpful = Number(result.count || 0);
      control.classList.toggle('is-active', item.viewerHelpful);
      control.setAttribute('aria-pressed', item.viewerHelpful ? 'true' : 'false');
      control.textContent = `Helpful ${item.counts.helpful}`;
      toast(item.viewerHelpful ? 'Marked Helpful.' : 'Helpful mark removed.');
    } catch (error) {
      item.viewerHelpful = !desired;
      item.counts.helpful = previousCount;
      control.classList.toggle('is-active', item.viewerHelpful);
      control.setAttribute('aria-pressed', item.viewerHelpful ? 'true' : 'false');
      control.textContent = `Helpful ${previousCount}`;
      handleError(error, null);
    } finally {
      control.disabled = false;
    }
  }

  async function toggleSaved(item, control) {
    const desired = !item.viewerSaved;
    control.disabled = true;
    try {
      const result = await command('set_saved', { entryId: item.entryId, enabled: desired });
      item.viewerSaved = Boolean(result.enabled);
      control.classList.toggle('is-active', item.viewerSaved);
      control.setAttribute('aria-pressed', item.viewerSaved ? 'true' : 'false');
      control.textContent = item.viewerSaved ? 'Saved' : 'Save';
      toast(item.viewerSaved ? 'Added to My Authorities.' : 'Removed from My Authorities.');
      await loadBootstrap();
      if (state.view === 'saved' && !item.viewerSaved) refreshFeed();
    } catch (error) {
      handleError(error, null);
    } finally {
      control.disabled = false;
    }
  }

  async function toggleComments(item, article) {
    if (state.commentsOpen.has(item.entryId)) {
      state.commentsOpen.delete(item.entryId);
      article.querySelector('.lex-comments')?.remove();
      return;
    }
    state.commentsOpen.add(item.entryId);
    article.append(renderCommentsSection(item, null));
    try {
      const comments = await query('comments', { entryId: item.entryId, limit: 200 });
      state.comments.set(item.entryId, comments);
      article.querySelector('.lex-comments')?.replaceWith(renderCommentsSection(item, comments));
    } catch (error) {
      handleError(error, article.querySelector('.lex-comments .lex-status'));
    }
  }

  function renderCommentsSection(item, comments) {
    const section = document.createElement('section');
    section.className = 'lex-comments';
    section.setAttribute('aria-label', 'Comments and replies');
    const list = document.createElement('div');
    list.className = 'lex-comments-list';
    if (!comments) {
      list.append(textElement('div', 'lex-status', 'Loading comments…'));
    } else if (!comments.length) {
      list.append(textElement('div', 'lex-status', 'No comments yet. Add the first focused response.'));
    } else {
      const roots = comments.filter((comment) => !comment.parentCommentId);
      roots.forEach((comment) => {
        list.append(renderComment(item, comment));
        comments
          .filter((reply) => reply.parentCommentId === comment.commentId)
          .forEach((reply) => list.append(renderComment(item, reply, true)));
      });
    }
    section.append(list);
    if (!item.commentsLocked) section.append(commentForm(item));
    else section.append(textElement('div', 'lex-status', 'Comments are locked by a moderator.'));
    return section;
  }

  function renderComment(item, comment, isReply = false) {
    const node = document.createElement('article');
    node.className = `lex-comment${isReply ? ' is-reply' : ''}`;
    node.dataset.commentId = comment.commentId;
    const header = document.createElement('header');
    header.className = 'lex-comment-header';
    header.append(authorBlock(comment.author || {}), textElement('span', '', relativeTime(comment.createdAt)));
    node.append(header, textElement('p', 'lex-comment-body', comment.body));
    if (comment.edited) node.append(textElement('span', 'lex-edit-counter', 'Edited'));
    const actions = document.createElement('div');
    actions.className = 'lex-comment-actions';
    if (!isReply && !item.commentsLocked) {
      actions.append(button('Reply', 'lex-menu-button', () => openCommentDialog(item, comment)));
    }
    actions.append(button('Report', 'lex-menu-button', () => openReportDialog('comment', comment.commentId)));
    if (comment.viewerOwns) {
      actions.append(
        button('Edit', 'lex-menu-button', () => editComment(item, comment)),
        button('Remove', 'lex-menu-button is-danger', () => removeComment(item, comment)),
      );
    }
    node.append(actions);
    return node;
  }

  function commentForm(item) {
    const form = document.createElement('form');
    form.className = 'lex-comment-form';
    const field = document.createElement('textarea');
    field.maxLength = commentLimit;
    field.rows = 3;
    field.placeholder = 'Add a focused comment. Keep personal information out of Quorum.';
    field.setAttribute('aria-label', 'Comment');
    const actions = document.createElement('div');
    actions.className = 'lex-form-actions';
    const counter = textElement('span', 'lex-edit-counter', `0 / ${commentLimit.toLocaleString()}`);
    field.addEventListener('input', () => {
      counter.textContent = `${field.value.length.toLocaleString()} / ${commentLimit.toLocaleString()}`;
    });
    const submit = button('Post comment', 'lex-button lex-button-primary', async () => {
      if (submit.disabled || !field.value.trim()) return;
      submit.disabled = true;
      try {
        await command('create_comment', { entryId: item.entryId, body: field.value });
        field.value = '';
        const comments = await query('comments', { entryId: item.entryId, limit: 200 });
        state.comments.set(item.entryId, comments);
        item.counts.comments = comments.length;
        const article = $(`#quorum-entry-${item.entryId}`);
        article?.querySelector('.lex-comments')?.replaceWith(renderCommentsSection(item, comments));
        toast('Comment published.');
      } catch (error) {
        handleError(error, null);
      } finally {
        submit.disabled = false;
      }
    });
    actions.append(counter, submit);
    form.append(field, actions);
    form.addEventListener('submit', (event) => event.preventDefault());
    return form;
  }

  function openCommentDialog(item, parent) {
    openDialog('Reply to comment', (body) => {
      body.append(textElement('p', 'lex-dialog-copy', `Replying to ${parent.author?.displayName || 'a Quorum member'}.`));
      const field = document.createElement('textarea');
      field.maxLength = commentLimit;
      field.rows = 5;
      field.placeholder = 'Write a focused reply.';
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const submit = button('Publish reply', 'lex-button lex-button-primary', async () => {
        if (submit.disabled || !field.value.trim()) return;
        submit.disabled = true;
        try {
          await command('create_comment', {
            entryId: item.entryId,
            parentCommentId: parent.commentId,
            body: field.value,
          });
          const comments = await query('comments', { entryId: item.entryId, limit: 200 });
          state.comments.set(item.entryId, comments);
          item.counts.comments = comments.length;
          renderFeed();
          closeDialog();
          toast('Reply published.');
        } catch (failure) {
          submit.disabled = false;
          error.textContent = failure?.message || 'The reply could not be published.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), submit);
      body.append(field, error, actions);
    });
  }

  function editComment(item, comment) {
    openDialog('Edit comment', (body) => {
      const field = document.createElement('textarea');
      field.maxLength = commentLimit;
      field.rows = 5;
      field.value = comment.body;
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const save = button('Save comment', 'lex-button lex-button-primary', async () => {
        if (save.disabled || !field.value.trim()) return;
        save.disabled = true;
        try {
          await command('update_comment', { commentId: comment.commentId, body: field.value });
          state.comments.set(item.entryId, await query('comments', { entryId: item.entryId, limit: 200 }));
          renderFeed();
          closeDialog();
          toast('Comment updated.');
        } catch (failure) {
          save.disabled = false;
          error.textContent = failure?.message || 'The comment could not be updated.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), save);
      body.append(field, error, actions);
    });
  }

  function removeComment(item, comment) {
    confirmDialog({
      title: 'Remove comment',
      copy: 'This comment will no longer appear in Quorum.',
      warning: 'Only your own comment or reply will be removed.',
      confirmLabel: 'Remove comment',
      onConfirm: async () => {
        await command('delete_comment', { commentId: comment.commentId });
        state.comments.set(item.entryId, await query('comments', { entryId: item.entryId, limit: 200 }));
        item.counts.comments = state.comments.get(item.entryId).length;
        renderFeed();
        toast('Comment removed.');
      },
    });
  }

  function openCitationDialog(item) {
    openDialog('Cite / Send', (body) => {
      body.append(textElement('p', 'lex-dialog-copy', 'Create an attributed internal citation, copy a stable link, or use your device share sheet. Opening or cancelling this dialog does not change citation counts.'));
      const field = document.createElement('textarea');
      field.maxLength = citationLimit;
      field.rows = 4;
      field.placeholder = 'Optional commentary for your internal citation.';
      const counter = textElement('span', 'lex-edit-counter', `0 / ${citationLimit.toLocaleString()}`);
      field.addEventListener('input', () => {
        counter.textContent = `${field.value.length.toLocaleString()} / ${citationLimit.toLocaleString()}`;
      });
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const nativeShare = button('Device share', 'lex-button', async () => {
        if (!navigator.share) {
          error.textContent = 'The device share sheet is not available in this browser.';
          return;
        }
        try {
          await navigator.share({ title: 'Quorum entry', url: stableEntryUrl(item.entryId) });
        } catch (failure) {
          if (failure?.name !== 'AbortError') error.textContent = 'The device share action could not be completed.';
        }
      });
      if (!navigator.share) nativeShare.hidden = true;
      const cite = button('Cite in Quorum', 'lex-button lex-button-primary', async () => {
        if (cite.disabled) return;
        cite.disabled = true;
        try {
          const result = await command('create_repost', { entryId: item.entryId, body: field.value });
          item.counts.citations = Number(result.count || item.counts.citations || 0);
          closeDialog();
          await refreshFeed();
          toast('Entry cited in Quorum.');
        } catch (failure) {
          cite.disabled = false;
          error.textContent = failure?.message || 'The citation could not be published.';
        }
      });
      actions.append(
        button('Copy link', 'lex-button', () => copyStableLink(item.entryId)),
        nativeShare,
        button('Cancel', 'lex-button', closeDialog),
        cite,
      );
      body.append(field, counter, error, actions);
    });
  }

  function removeCitation(citationId) {
    confirmDialog({
      title: 'Remove citation',
      copy: 'Your internal citation will be removed. The original entry remains.',
      confirmLabel: 'Remove citation',
      onConfirm: async () => {
        await command('delete_repost', { citationId });
        await refreshFeed();
        toast('Citation removed.');
      },
    });
  }

  function openReportDialog(targetType, targetId) {
    openDialog('Report to Quorum moderation', (body) => {
      body.append(textElement('p', 'lex-dialog-copy', 'Reports are private. Ordinary members never see the reporter’s identity.'));
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = 'Reason';
      const select = document.createElement('select');
      reportCategories.forEach((label, value) => select.append(option(value, label)));
      categoryLabel.append(select);
      const explanationLabel = document.createElement('label');
      explanationLabel.textContent = 'Explanation (optional)';
      const field = document.createElement('textarea');
      field.maxLength = 1000;
      field.rows = 4;
      explanationLabel.append(field);
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const submit = button('Submit report', 'lex-button lex-button-primary', async () => {
        submit.disabled = true;
        try {
          await command('create_report', {
            targetType,
            targetId,
            category: select.value,
            explanation: field.value,
          });
          closeDialog();
          toast('Report submitted privately to Quorum moderation.');
        } catch (failure) {
          submit.disabled = false;
          error.textContent = failure?.message || 'The report could not be submitted.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), submit);
      body.append(categoryLabel, explanationLabel, error, actions);
    });
  }

  function openEditEntryDialog(item) {
    openDialog('Edit your entry', (body) => {
      const bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Entry';
      const field = document.createElement('textarea');
      field.maxLength = entryLimit;
      field.rows = 8;
      field.value = item.body;
      bodyLabel.append(field);
      const sourceLabel = document.createElement('label');
      sourceLabel.textContent = 'Source URL (optional)';
      const source = document.createElement('input');
      source.type = 'url';
      source.maxLength = 2000;
      source.value = item.sourceUrl || '';
      sourceLabel.append(source);
      const opinionLabel = document.createElement('label');
      const opinion = document.createElement('input');
      opinion.type = 'checkbox';
      opinion.checked = (item.indicators || []).includes('Opinion Only');
      opinionLabel.append(opinion, document.createTextNode(' Opinion Only'));
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      if (item.imageUrl) {
        actions.append(button('Remove image', 'lex-button is-danger', async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            await command('remove_attachment', { entryId: item.entryId });
            item.imageUrl = null;
            control.remove();
            toast('Entry image removed.');
          } catch (failure) {
            control.disabled = false;
            error.textContent = failure?.message || 'The image could not be removed.';
          }
        }));
      }
      const save = button('Save changes', 'lex-button lex-button-primary', async () => {
        if (save.disabled || !field.value.trim()) return;
        save.disabled = true;
        try {
          await command('update_entry', {
            entryId: item.entryId,
            body: field.value,
            sourceUrl: source.value,
            entryType: item.entryType,
            subject: item.subject,
            category: item.category,
            lawSchoolYear: item.lawSchoolYear,
            caseTitle: item.caseTitle,
            opinionOnly: opinion.checked,
            circleId: item.circle?.circleId || null,
          });
          closeDialog();
          state.view === 'entry' ? openEntry(item.entryId) : refreshFeed();
          toast('Entry updated.');
        } catch (failure) {
          save.disabled = false;
          error.textContent = failure?.message || 'The entry could not be updated.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), save);
      body.append(bodyLabel, sourceLabel, opinionLabel, error, actions);
    });
  }

  function removeEntry(item) {
    confirmDialog({
      title: 'Remove entry',
      copy: 'This soft-deletes your entry and makes its attached image inaccessible.',
      warning: 'Comments, citations, and stable links will no longer expose the removed entry.',
      confirmLabel: 'Remove entry',
      onConfirm: async () => {
        await command('delete_entry', { entryId: item.entryId });
        state.directEntryId = null;
        setStableLocation();
        await setView('home');
        toast('Entry removed.');
      },
    });
  }

  function setViewLabels(title, kicker) {
    const titleNode = $('#quorum-feed-title');
    const kickerNode = $('#quorum-feed-kicker');
    if (titleNode) titleNode.textContent = title;
    if (kickerNode) kickerNode.textContent = kicker;
  }

  function syncViewButtons() {
    $$('[data-quorum-view]').forEach((control) => {
      control.classList.toggle('is-active', control.dataset.quorumView === state.view);
    });
  }

  function updateActiveFilters() {
    const node = $('#quorum-active-filters');
    if (!node) return;
    const values = [
      state.filters.subject,
      entryTypes.get(state.filters.entryType),
      categories.get(state.filters.category),
      state.filters.query ? `Search: “${state.filters.query}”` : '',
    ].filter(Boolean);
    node.hidden = !values.length;
    node.replaceChildren(...values.map((value) => chip(value)));
  }

  async function setView(view, options = {}) {
    if (!hasSession()) {
      askForSignIn();
      return;
    }
    state.view = view;
    state.directEntryId = null;
    state.legacyPostId = null;
    setStableLocation();
    syncViewButtons();
    const composer = $('#lex-composer');
    if (composer) composer.hidden = !['home', 'circle'].includes(view);
    state.filters.query = options.keepQuery ? state.filters.query : '';
    if (!options.keepQuery) {
      const search = $('#quorum-search-input');
      if (search) search.value = '';
      $('#quorum-search-clear').hidden = true;
    }
    updateActiveFilters();
    if (view === 'home') {
      state.activeCircleId = null;
      state.circleDetail = null;
      const circleSelect = $('#quorum-entry-circle');
      if (circleSelect) circleSelect.value = '';
      setViewLabels('Quorum Feed', 'Academic community');
      await refreshFeed();
    } else if (view === 'saved') {
      setViewLabels('My Authorities', 'Private saved entries');
      await refreshFeed();
    } else if (view === 'unanswered') {
      setViewLabels('Unanswered questions', 'Help a fellow law student');
      await refreshFeed();
    } else if (view === 'circles') {
      setViewLabels('Study Circles', 'Study with purpose');
      await renderCirclesView();
    } else if (view === 'notifications') {
      setViewLabels('Notifications', 'Activity relevant to you');
      await renderNotificationsView();
    } else if (view === 'profile') {
      setViewLabels('Quorum profile', 'Your public academic identity');
      await renderProfileView();
    }
  }

  async function renderCirclesView() {
    const feed = $('#lex-feed');
    feed.replaceChildren(Object.assign(document.createElement('div'), { className: 'lex-skeleton' }));
    $('#lex-load-more').hidden = true;
    setFeedStatus('Loading Study Circles…');
    try {
      const result = await query('circles', {
        limit: 20,
        joinedOnly: state.circleJoinedOnly,
      });
      state.circles = result.items || [];
      feed.replaceChildren(circlesPanel(state.circles));
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    }
  }

  function circlesPanel(circles) {
    const panel = document.createElement('section');
    panel.className = 'quorum-panel';
    const head = document.createElement('div');
    head.className = 'quorum-card-head';
    const title = document.createElement('div');
    title.append(textElement('span', 'lex-kicker', 'Study communities'), textElement('h3', '', 'Study Circles'));
    const headActions = document.createElement('div');
    headActions.className = 'quorum-circle-actions';
    headActions.append(
      button(state.circleJoinedOnly ? 'Browse all circles' : 'My joined circles', 'lex-button lex-button-quiet', async () => {
        state.circleJoinedOnly = !state.circleJoinedOnly;
        await renderCirclesView();
      }),
      button('Create Study Circle', 'lex-button lex-button-primary', openCreateCircleDialog),
    );
    head.append(title, headActions);
    panel.append(head, textElement('p', 'quorum-panel-copy', 'Browse visible circles, join those relevant to your studies, or create one with clear academic rules.'));
    const grid = document.createElement('div');
    grid.className = 'quorum-circle-grid';
    if (!circles.length) {
      grid.append(textElement('p', 'quorum-empty-copy', 'No Study Circles yet. Create the first focused academic community.'));
    } else {
      circles.forEach((circle) => grid.append(circleCard(circle)));
    }
    panel.append(grid);
    return panel;
  }

  function circleDetailPanel(circle) {
    const panel = document.createElement('section');
    panel.className = 'quorum-panel';
    panel.append(
      textElement('span', 'lex-kicker', circle.subject || 'Interdisciplinary'),
      textElement('h3', '', circle.name),
      textElement('p', 'quorum-panel-copy', circle.description),
      textElement('strong', '', 'Circle rules'),
      textElement('p', 'quorum-panel-copy', circle.rules),
    );
    const members = document.createElement('div');
    members.className = 'quorum-chip-row';
    (circle.members || []).forEach((member) => members.append(chip(member.displayName || 'Due Diligence Member')));
    if (members.childElementCount) panel.append(members);
    const actions = document.createElement('div');
    actions.className = 'quorum-circle-actions';
    if (circle.status === 'active') {
      if (circle.viewerOwns) actions.append(button('Archive circle', 'lex-button', () => archiveCircle(circle)));
      else if (circle.viewerJoined) actions.append(button('Leave circle', 'lex-button', () => leaveCircle(circle)));
      else actions.append(button('Join circle', 'lex-button lex-button-primary', () => joinCircle(circle)));
    } else if (circle.viewerJoined) {
      actions.append(button('Leave archived circle', 'lex-button', () => leaveCircle(circle)));
    }
    actions.append(
      button('Report circle', 'lex-button', () => openReportDialog('circle', circle.circleId)),
      button('Back to circles', 'lex-button lex-button-quiet', () => setView('circles')),
    );
    panel.append(actions);
    return panel;
  }

  function circleCard(circle) {
    const card = document.createElement('article');
    card.className = 'quorum-circle-card';
    card.append(
      textElement('h4', '', circle.name),
      textElement('p', 'quorum-panel-copy', circle.description),
    );
    const chips = document.createElement('div');
    chips.className = 'quorum-chip-row';
    if (circle.subject) chips.append(chip(circle.subject));
    if (circle.school) chips.append(chip(circle.school));
    chips.append(chip(`${Number(circle.memberCount || 0)} members`), chip(`${Number(circle.entryCount || 0)} entries`));
    card.append(chips);
    const actions = document.createElement('div');
    actions.className = 'quorum-circle-actions';
    actions.append(button('Open circle', 'lex-button lex-button-quiet', () => openCircle(circle.circleId)));
    if (circle.status === 'active') {
      if (circle.viewerOwns) {
        actions.append(button('Archive', 'lex-button', () => archiveCircle(circle)));
      } else if (circle.viewerJoined) {
        actions.append(button('Leave', 'lex-button', () => leaveCircle(circle)));
      } else {
        actions.append(button('Join', 'lex-button lex-button-primary', () => joinCircle(circle)));
      }
    } else if (circle.viewerJoined) {
      actions.append(button('Leave archived circle', 'lex-button', () => leaveCircle(circle)));
    }
    actions.append(button('Report', 'lex-button', () => openReportDialog('circle', circle.circleId)));
    card.append(actions);
    return card;
  }

  function openCreateCircleDialog() {
    openDialog('Create a Study Circle', (body) => {
      const form = document.createElement('div');
      form.className = 'quorum-form-grid';
      const makeField = (label, control, wide = false) => {
        const wrapper = document.createElement('label');
        if (wide) wrapper.className = 'is-wide';
        wrapper.append(document.createTextNode(label), control);
        return wrapper;
      };
      const name = document.createElement('input');
      name.maxLength = 100;
      const subject = document.createElement('select');
      subject.append(option('', 'All subjects'));
      subjects.forEach((value) => subject.append(option(value, value)));
      const school = document.createElement('input');
      school.maxLength = 200;
      school.placeholder = 'Optional';
      const description = document.createElement('textarea');
      description.maxLength = 1000;
      description.rows = 4;
      const rules = document.createElement('textarea');
      rules.maxLength = 2000;
      rules.rows = 4;
      form.append(
        makeField('Circle name', name),
        makeField('Subject', subject),
        makeField('School (optional)', school, true),
        makeField('Description', description, true),
        makeField('Academic rules', rules, true),
      );
      const error = inlineError();
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      const create = button('Create circle', 'lex-button lex-button-primary', async () => {
        create.disabled = true;
        try {
          const result = await command('create_circle', {
            name: name.value,
            description: description.value,
            subject: subject.value || null,
            school: school.value,
            rules: rules.value,
          });
          closeDialog();
          await loadBootstrap();
          await openCircle(result.circleId);
          toast('Study Circle created.');
        } catch (failure) {
          create.disabled = false;
          error.textContent = failure?.message || 'The Study Circle could not be created.';
        }
      });
      actions.append(button('Cancel', 'lex-button', closeDialog), create);
      body.append(form, error, actions);
    });
  }

  async function openCircle(circleId) {
    state.view = 'circle';
    state.activeCircleId = circleId;
    setStableLocation();
    syncViewButtons();
    $('#lex-composer').hidden = false;
    setViewLabels('Study Circle', 'Member circle feed');
    setFeedStatus('Opening Study Circle…');
    try {
      const circle = await query('circle', { circleId });
      state.circleDetail = circle;
      $('#lex-composer').hidden = !(circle.viewerJoined || circle.viewerOwns) || circle.status !== 'active';
      const circleSelect = $('#quorum-entry-circle');
      if (circleSelect && (circle.viewerJoined || circle.viewerOwns)) {
        if (!$(`option[value="${circleId}"]`, circleSelect)) circleSelect.append(option(circleId, circle.name));
        circleSelect.value = circleId;
      }
      await refreshFeed();
    } catch (error) {
      handleError(error);
    }
  }

  async function joinCircle(circle) {
    try {
      await command('join_circle', { circleId: circle.circleId });
      toast('Joined Study Circle.');
      await loadBootstrap();
      state.view === 'circle' ? openCircle(circle.circleId) : renderCirclesView();
    } catch (error) {
      handleError(error, null);
    }
  }

  async function leaveCircle(circle) {
    confirmDialog({
      title: 'Leave Study Circle',
      copy: `Leave “${circle.name}”? Your existing entries remain attributed to you.`,
      confirmLabel: 'Leave circle',
      onConfirm: async () => {
        await command('leave_circle', { circleId: circle.circleId });
        await loadBootstrap();
        await setView('circles');
        toast('You left the Study Circle.');
      },
    });
  }

  async function archiveCircle(circle) {
    confirmDialog({
      title: 'Archive Study Circle',
      copy: `Archive “${circle.name}”? Members can still review existing material, but no new activity should be added.`,
      warning: 'A circle owner must archive the circle before leaving.',
      confirmLabel: 'Archive circle',
      onConfirm: async () => {
        await command('archive_circle', { circleId: circle.circleId });
        await setView('circles');
        toast('Study Circle archived.');
      },
    });
  }

  async function renderNotificationsView() {
    const feed = $('#lex-feed');
    feed.replaceChildren(Object.assign(document.createElement('div'), { className: 'lex-skeleton' }));
    $('#lex-load-more').hidden = true;
    setFeedStatus('Loading notifications…');
    try {
      const result = await query('notifications', { limit: 20 });
      const panel = document.createElement('section');
      panel.className = 'quorum-panel';
      const head = document.createElement('div');
      head.className = 'quorum-card-head';
      const title = document.createElement('div');
      title.append(textElement('span', 'lex-kicker', 'In-site only'), textElement('h3', '', 'Notifications'));
      const markAll = button('Mark all read', 'lex-button lex-button-quiet', async () => {
        markAll.disabled = true;
        try {
          await command('mark_all_notifications');
          await renderNotificationsView();
          await loadBootstrap();
          toast('All notifications marked read.');
        } catch (error) {
          markAll.disabled = false;
          handleError(error, null);
        }
      });
      markAll.disabled = Number(result.unreadCount || 0) === 0;
      head.append(title, markAll);
      const list = document.createElement('div');
      list.className = 'quorum-notification-list';
      if (!(result.items || []).length) {
        list.append(textElement('p', 'quorum-empty-copy', 'No notifications yet.'));
      } else {
        result.items.forEach((notification) => {
          const node = document.createElement('article');
          node.className = `quorum-notification${notification.read ? '' : ' is-unread'}`;
          const copy = document.createElement('div');
          copy.append(
            textElement('strong', '', notification.actor?.displayName || 'Quorum moderation'),
            textElement('p', 'quorum-panel-copy', `${notificationLabels[notification.type] || 'sent a Quorum update'} · ${relativeTime(notification.createdAt)}`),
          );
          const open = button(notification.targetAvailable ? 'Open' : 'Unavailable', 'lex-button lex-button-quiet', async () => {
            if (!notification.read) {
              await command('mark_notification', { notificationId: notification.notificationId });
              loadBootstrap();
            }
            if (notification.entryId && notification.targetAvailable) openEntry(notification.entryId, { push: true });
            else if (notification.circleId && notification.targetAvailable) openCircle(notification.circleId);
            else toast('The referenced content is no longer available.');
          });
          node.append(copy, open);
          list.append(node);
        });
      }
      panel.append(head, list);
      feed.replaceChildren(panel);
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    }
  }

  async function renderProfileView(memberId = null) {
    const feed = $('#lex-feed');
    feed.replaceChildren(Object.assign(document.createElement('div'), { className: 'lex-skeleton' }));
    $('#lex-load-more').hidden = true;
    setFeedStatus('Loading academic profile…');
    try {
      const profile = await query('profile', memberId ? { memberId } : {});
      feed.replaceChildren(profilePanel(profile));
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    }
  }

  function profilePanel(profile) {
    const panel = document.createElement('section');
    panel.className = 'quorum-panel';
    panel.append(
      textElement('span', 'lex-kicker', profile.verifiedAcademicIdentity ? 'Verified Academic Identity' : 'Quorum member'),
      textElement('h3', '', profile.displayName || 'Due Diligence Member'),
      textElement('p', 'quorum-panel-copy', [profile.school, profile.yearLevel].filter(Boolean).join(' · ') || 'Academic details are private.'),
    );
    const counts = document.createElement('div');
    counts.className = 'quorum-chip-row';
    counts.append(
      chip(`${Number(profile.counts?.entries || 0)} public entries`),
      chip(`${Number(profile.counts?.circles || 0)} Study Circles`),
    );
    panel.append(counts);
    const actions = document.createElement('div');
    actions.className = 'quorum-profile-actions';
    if (profile.viewerOwns) {
      const settings = profile.settings || {
        profilePublic: true,
        showSchool: true,
        showYear: true,
      };
      const profilePublic = checkbox('Public Quorum profile', settings.profilePublic);
      const showSchool = checkbox('Show school', settings.showSchool);
      const showYear = checkbox('Show year level', settings.showYear);
      const form = document.createElement('div');
      form.className = 'quorum-profile-grid';
      form.append(profilePublic.label, showSchool.label, showYear.label);
      const save = button('Save privacy settings', 'lex-button lex-button-primary', async () => {
        save.disabled = true;
        try {
          await command('update_profile_settings', {
            profilePublic: profilePublic.input.checked,
            showSchool: showSchool.input.checked,
            showYear: showYear.input.checked,
          });
          toast('Quorum privacy settings updated.');
          await renderProfileView();
        } catch (error) {
          save.disabled = false;
          handleError(error, null);
        }
      });
      form.append(save);
      panel.append(form);
      actions.append(button('View blocked members', 'lex-button lex-button-quiet', renderBlockedMembers));
    } else if (profile.memberId) {
      actions.append(button('Block member', 'lex-button is-danger', async () => {
        const blocked = await query('blocks');
        const alreadyBlocked = blocked.some((member) => member?.memberId === profile.memberId);
        confirmDialog({
          title: alreadyBlocked ? 'Unblock member' : 'Block member',
          copy: alreadyBlocked
            ? `Restore mutual Quorum visibility with ${profile.displayName || 'this member'}?`
            : `Hide mutual Quorum entries, comments, notifications, circle activity, and direct links involving ${profile.displayName || 'this member'}?`,
          confirmLabel: alreadyBlocked ? 'Unblock' : 'Block',
          onConfirm: async () => {
            await command('set_block', { memberId: profile.memberId, enabled: !alreadyBlocked });
            await setView('home');
            toast(alreadyBlocked ? 'Member unblocked.' : 'Member blocked.');
          },
        });
      }));
    }
    if (actions.childElementCount) panel.append(actions);
    return panel;
  }

  function checkbox(labelText, checked) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    label.append(input, document.createTextNode(` ${labelText}`));
    return { label, input };
  }

  async function showMemberProfile(memberId) {
    state.view = 'profile';
    syncViewButtons();
    $('#lex-composer').hidden = true;
    setViewLabels('Academic profile', 'Quorum member');
    await renderProfileView(memberId);
  }

  async function renderBlockedMembers() {
    try {
      const blocked = await query('blocks');
      openDialog('Blocked members', (body) => {
        if (!blocked.length) {
          body.append(textElement('p', 'lex-dialog-copy', 'You have not blocked any Quorum members.'));
        } else {
          blocked.forEach((member) => {
            const row = document.createElement('div');
            row.className = 'quorum-notification';
            row.append(
              textElement('strong', '', member.displayName || 'Due Diligence Member'),
              button('Unblock', 'lex-button', async (event) => {
                event.currentTarget.disabled = true;
                await command('set_block', { memberId: member.memberId, enabled: false });
                closeDialog();
                toast('Member unblocked.');
              }),
            );
            body.append(row);
          });
        }
        const actions = document.createElement('div');
        actions.className = 'lex-dialog-actions';
        actions.append(button('Close', 'lex-button', closeDialog));
        body.append(actions);
      });
    } catch (error) {
      handleError(error, null);
    }
  }

  async function searchQuorum(queryText, options = {}) {
    const value = String(queryText || '').trim();
    if (value.length < 2) {
      toast('Enter at least two characters to search Quorum.');
      return;
    }
    const append = options.append === true;
    if (!append) {
      state.searchController?.abort();
      state.searchController = new AbortController();
      state.searchResults = null;
      state.cursor = null;
    }
    state.view = 'search';
    state.filters.query = value;
    syncViewButtons();
    updateActiveFilters();
    $('#lex-composer').hidden = true;
    $('#quorum-search-clear').hidden = false;
    setViewLabels('Search results', 'Authenticated Quorum search');
    const feed = $('#lex-feed');
    if (!append) {
      feed.replaceChildren(Object.assign(document.createElement('div'), { className: 'lex-skeleton' }));
      $('#lex-load-more').hidden = true;
    }
    setFeedStatus('Searching Quorum…');
    try {
      const result = await query('search', {
        query: value,
        limit: 20,
        sort: state.filters.sort,
        ...(state.filters.subject ? { subject: state.filters.subject } : {}),
        ...(state.filters.entryType ? { entryType: state.filters.entryType } : {}),
        ...(state.filters.category ? { category: state.filters.category } : {}),
        ...(append && state.cursor ? {
          cursorAt: state.cursor.createdAt,
          cursorId: state.cursor.id,
        } : {}),
      }, { signal: state.searchController.signal });
      if (append && state.searchResults) {
        result.entries.items = (state.searchResults.entries?.items || []).concat(result.entries?.items || []);
        result.circles = state.searchResults.circles || [];
        result.profiles = state.searchResults.profiles || [];
      }
      state.searchResults = result;
      state.cursor = result.entries?.nextCursor || null;
      state.hasMore = Boolean(result.entries?.hasMore);
      const panel = document.createElement('section');
      panel.className = 'quorum-panel';
      panel.append(textElement('span', 'lex-kicker', 'Real Quorum records'), textElement('h3', '', `Results for “${value}”`));
      const entries = result.entries?.items || [];
      const groups = document.createElement('div');
      groups.className = 'quorum-search-groups';
      groups.append(textElement('h4', '', `Entries (${entries.length})`));
      if (!entries.length) groups.append(textElement('p', 'quorum-empty-copy', 'No matching entries.'));
      entries.forEach((item) => groups.append(renderEntry(item)));
      groups.append(textElement('h4', '', `Study Circles (${(result.circles || []).length})`));
      (result.circles || []).forEach((circle) => groups.append(circleCard(circle)));
      if (!(result.circles || []).length) groups.append(textElement('p', 'quorum-empty-copy', 'No matching Study Circles.'));
      groups.append(textElement('h4', '', `Academic profiles (${(result.profiles || []).length})`));
      (result.profiles || []).forEach((profile) => {
        const card = document.createElement('div');
        card.className = 'quorum-profile-card';
        card.append(
          textElement('h4', '', profile.displayName || 'Due Diligence Member'),
          textElement('p', 'quorum-panel-copy', [profile.school, profile.yearLevel].filter(Boolean).join(' · ') || 'Academic details are private.'),
          button('Open profile', 'lex-button lex-button-quiet', () => showMemberProfile(profile.memberId)),
        );
        groups.append(card);
      });
      if (!(result.profiles || []).length) groups.append(textElement('p', 'quorum-empty-copy', 'No matching public academic profiles.'));
      panel.append(groups);
      feed.replaceChildren(panel);
      $('#lex-load-more').hidden = !state.hasMore;
      setFeedStatus('');
    } catch (error) {
      handleError(error);
    }
  }

  function clearSearch() {
    state.filters.query = '';
    state.searchResults = null;
    state.cursor = null;
    const input = $('#quorum-search-input');
    if (input) input.value = '';
    $('#quorum-search-clear').hidden = true;
    updateActiveFilters();
    setView('home');
  }

  function composerPayload() {
    return {
      body: $('#lex-post-body')?.value || '',
      sourceUrl: $('#lex-post-source')?.value || '',
      entryType: $('#quorum-entry-type')?.value || '',
      subject: $('#quorum-entry-subject')?.value || null,
      category: $('#quorum-entry-category')?.value || '',
      lawSchoolYear: $('#quorum-entry-year')?.value || '',
      caseTitle: $('#quorum-case-title')?.value || '',
      opinionOnly: Boolean($('#quorum-opinion-only')?.checked),
      circleId: $('#quorum-entry-circle')?.value || null,
    };
  }

  function saveDraft() {
    const payload = composerPayload();
    if (!payload.body && !payload.sourceUrl && !state.selectedImage) {
      safeStorage(localStorage, 'remove', draftKey);
      return;
    }
    safeStorage(localStorage, 'set', draftKey, JSON.stringify({
      ...payload,
      hasImage: Boolean(state.selectedImage),
      savedAt: Date.now(),
    }));
  }

  function restoreDraft() {
    const raw = safeStorage(localStorage, 'get', draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!draft || Date.now() - Number(draft.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return;
      $('#lex-post-body').value = draft.body || '';
      $('#lex-post-source').value = draft.sourceUrl || '';
      $('#quorum-entry-type').value = entryTypes.has(draft.entryType) ? draft.entryType : 'ask_community';
      $('#quorum-entry-category').value = categories.has(draft.category) ? draft.category : 'philippine_legal_education';
      $('#quorum-entry-subject').value = subjects.includes(draft.subject) ? draft.subject : '';
      $('#quorum-entry-year').value = draft.lawSchoolYear || '';
      $('#quorum-case-title').value = draft.caseTitle || '';
      $('#quorum-opinion-only').checked = Boolean(draft.opinionOnly);
      if (draft.hasImage) $('#quorum-image-status').textContent = 'For privacy, select the image again before publishing.';
      syncCaseTitle();
      updateComposerCounter();
    } catch {
      safeStorage(localStorage, 'remove', draftKey);
    }
  }

  function clearComposer({ announce = false } = {}) {
    $('#lex-composer')?.reset();
    state.selectedImage = null;
    $('#quorum-entry-type').value = 'ask_community';
    $('#quorum-entry-category').value = 'philippine_legal_education';
    $('#quorum-image-status').textContent = 'JPEG, PNG, or WebP · 3 MB maximum';
    $('#quorum-image-remove').hidden = true;
    safeStorage(localStorage, 'remove', draftKey);
    syncCaseTitle();
    updateComposerCounter();
    if (announce) toast('Entry draft cleared.');
  }

  function previewEntry() {
    const payload = composerPayload();
    if (!payload.body.trim()) {
      toast('Write an entry before opening the preview.');
      $('#lex-post-body')?.focus();
      return;
    }
    openDialog('Entry preview', (body, dialog) => {
      const preview = document.createElement('div');
      preview.className = 'quorum-dialog-preview';
      preview.append(
        textElement('strong', '', entryTypes.get(payload.entryType) || 'Quorum Entry'),
        textElement('p', '', payload.body),
      );
      if (payload.caseTitle) preview.prepend(textElement('h3', 'quorum-entry-heading', payload.caseTitle));
      const source = sourceLink(payload.sourceUrl);
      if (source) preview.append(source);
      if (state.selectedImage) {
        const objectUrl = URL.createObjectURL(state.selectedImage);
        const image = document.createElement('img');
        image.className = 'quorum-entry-image';
        image.src = objectUrl;
        image.alt = 'Selected image preview';
        preview.append(image);
        dialog.addEventListener('close', () => URL.revokeObjectURL(objectUrl), { once: true });
      }
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      actions.append(button('Close preview', 'lex-button', closeDialog));
      body.append(preview, actions);
    });
  }

  function cancelComposer() {
    const payload = composerPayload();
    if (!payload.body.trim() && !payload.sourceUrl && !state.selectedImage) {
      clearComposer();
      return;
    }
    confirmDialog({
      title: 'Discard entry draft',
      copy: 'Clear this unfinished Quorum entry?',
      confirmLabel: 'Discard draft',
      onConfirm: async () => clearComposer({ announce: true }),
    });
  }

  async function imageToPayload(file) {
    if (!file) return null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > imageLimit) {
      throw new Error('Use one JPEG, PNG, or WebP image no larger than 3 MB.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return { mimeType: file.type, dataBase64: btoa(binary) };
  }

  async function publishEntry(event) {
    event.preventDefault();
    const submit = $('#lex-post-submit');
    if (!submit || submit.disabled) return;
    submit.disabled = true;
    setFeedStatus('Publishing entry…');
    try {
      const payload = composerPayload();
      const image = await imageToPayload(state.selectedImage);
      const result = await command('create_entry', payload, image);
      clearComposer();
      if (result.publicationStatus === 'pending') {
        toast('Announcement submitted for moderator approval.');
      } else {
        toast('Entry published in Quorum.');
        await setView('home');
        if (result.entryId) await openEntry(result.entryId, { push: true });
      }
      await loadBootstrap();
    } catch (error) {
      saveDraft();
      handleError(error);
    } finally {
      submit.disabled = false;
    }
  }

  function updateComposerCounter() {
    const field = $('#lex-post-body');
    const counter = $('#lex-post-counter');
    if (field && counter) counter.textContent = `${field.value.length.toLocaleString()} / ${entryLimit.toLocaleString()}`;
    saveDraft();
  }

  function syncCaseTitle() {
    const wrapper = $('.quorum-case-title');
    const field = $('#quorum-case-title');
    const isCaseNote = $('#quorum-entry-type')?.value === 'share_case_note';
    if (wrapper) wrapper.hidden = !isCaseNote;
    if (field) field.required = isCaseNote;
  }

  function handleImageSelection() {
    const field = $('#quorum-entry-image');
    const file = field?.files?.[0] || null;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > imageLimit) {
      field.value = '';
      state.selectedImage = null;
      toast('Use one JPEG, PNG, or WebP image no larger than 3 MB.');
      return;
    }
    state.selectedImage = file;
    $('#quorum-image-status').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    $('#quorum-image-remove').hidden = false;
    saveDraft();
  }

  function removeSelectedImage() {
    state.selectedImage = null;
    const field = $('#quorum-entry-image');
    if (field) field.value = '';
    $('#quorum-image-status').textContent = 'JPEG, PNG, or WebP · 3 MB maximum';
    $('#quorum-image-remove').hidden = true;
    saveDraft();
  }

  async function loadBootstrap() {
    const data = await query('bootstrap');
    state.bootstrap = data;
    $('#quorum-saved-count').textContent = Number(data.counts?.savedAuthorities || 0);
    $('#quorum-circle-count').textContent = Number(data.counts?.joinedCircles || 0);
    $('#quorum-notification-count').textContent = Number(data.counts?.unreadNotifications || 0);
    return data;
  }

  async function loadSidebar() {
    const results = await Promise.allSettled([
      query('active_issues', { limit: 4 }),
      query('unanswered', { limit: 3 }),
      query('circles', { limit: 3 }),
    ]);
    renderCompactEntries($('#quorum-active-issues'), results[0].status === 'fulfilled' ? results[0].value : []);
    renderCompactEntries($('#quorum-unanswered'), results[1].status === 'fulfilled' ? results[1].value.items : []);
    renderCompactCircles($('#quorum-recommended-circles'), results[2].status === 'fulfilled' ? results[2].value.items : []);
  }

  function renderCompactEntries(container, items = []) {
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      container.append(textElement('p', 'quorum-empty-copy', 'No data yet.'));
      return;
    }
    items.forEach((item) => {
      const control = button(item.caseTitle || item.body.slice(0, 80), 'quorum-compact-item', () => openEntry(item.entryId, { push: true }));
      control.append(textElement('small', '', `${entryTypes.get(item.entryType) || 'Entry'} · ${Number(item.counts?.comments || 0)} comments`));
      container.append(control);
    });
  }

  function renderCompactCircles(container, circles = []) {
    if (!container) return;
    container.replaceChildren();
    if (!circles.length) {
      container.append(textElement('p', 'quorum-empty-copy', 'No data yet.'));
      return;
    }
    circles.forEach((circle) => {
      const control = button(circle.name, 'quorum-compact-item', () => openCircle(circle.circleId));
      control.append(textElement('small', '', `${Number(circle.memberCount || 0)} members · ${circle.subject || 'All subjects'}`));
      container.append(control);
    });
  }

  function populateControls() {
    const type = $('#quorum-entry-type');
    const category = $('#quorum-entry-category');
    const subject = $('#quorum-entry-subject');
    if (type) {
      type.replaceChildren();
      entryTypes.forEach((label, value) => type.append(option(value, label)));
    }
    if (category) {
      category.replaceChildren();
      categories.forEach((label, value) => category.append(option(value, label)));
    }
    if (subject) {
      subject.replaceChildren(option('', 'Not subject-specific'));
      subjects.forEach((value) => subject.append(option(value, value)));
    }
    const subjectLinks = $('#quorum-subject-links');
    if (subjectLinks) {
      subjectLinks.replaceChildren(button('All subjects', 'quorum-filter-link is-active', () => applySubjectFilter('')));
      subjects.forEach((value) => subjectLinks.append(button(value, 'quorum-filter-link', () => applySubjectFilter(value))));
    }
    const typeLinks = $('#quorum-type-links');
    if (typeLinks) {
      typeLinks.replaceChildren(button('All purposes', 'quorum-filter-link is-active', () => applyTypeFilter('')));
      entryTypes.forEach((label, value) => typeLinks.append(button(label, 'quorum-filter-link', () => applyTypeFilter(value))));
    }
  }

  async function populateJoinedCircles() {
    const select = $('#quorum-entry-circle');
    if (!select) return;
    try {
      const result = await query('circles', { joinedOnly: true, limit: 20 });
      select.replaceChildren(option('', 'Public Quorum Feed'));
      (result.items || []).filter((circle) => circle.status === 'active').forEach((circle) => select.append(option(circle.circleId, circle.name)));
    } catch {
      select.replaceChildren(option('', 'Public Quorum Feed'));
    }
  }

  function applySubjectFilter(subject) {
    state.filters.subject = subject;
    $$('#quorum-subject-links .quorum-filter-link').forEach((control) => {
      control.classList.toggle('is-active', control.textContent === (subject || 'All subjects'));
    });
    updateActiveFilters();
    if (state.view === 'search') searchQuorum(state.filters.query);
    else setView(state.view === 'saved' ? 'saved' : state.view === 'unanswered' ? 'unanswered' : 'home', { keepQuery: true });
  }

  function applyTypeFilter(entryType) {
    state.filters.entryType = entryType;
    $$('#quorum-type-links .quorum-filter-link').forEach((control) => {
      control.classList.toggle('is-active', control.textContent === (entryTypes.get(entryType) || 'All purposes'));
    });
    updateActiveFilters();
    if (state.view === 'search') searchQuorum(state.filters.query);
    else setView(state.view === 'saved' ? 'saved' : state.view === 'unanswered' ? 'unanswered' : 'home', { keepQuery: true });
  }

  async function activate() {
    state.active = true;
    setAuthView(true);
    try {
      await Promise.all([loadBootstrap(), populateJoinedCircles()]);
      loadSidebar();
      telemetry('quorum_opened');
      if (state.directEntryId) await openEntry(state.directEntryId);
      else if (state.legacyPostId) await openLegacyEntry(state.legacyPostId);
      else if (!state.loaded) await setView('home');
    } catch (error) {
      handleError(error);
    }
  }

  function open(trigger = null) {
    state.trigger = trigger || state.trigger || $('#spa-community');
    const params = new URLSearchParams(location.search);
    state.directEntryId = params.get('quorumEntry') || state.directEntryId;
    state.legacyPostId = params.get('forumPost') || state.legacyPostId;
    setStableLocation(state.directEntryId);
    if (!hasSession()) {
      askForSignIn();
      return true;
    }
    setAuthView(true);
    global.showPage?.('community', state.trigger);
    activate();
    return true;
  }

  function bind() {
    $('#lex-composer')?.addEventListener('submit', publishEntry);
    $('#lex-post-body')?.addEventListener('input', updateComposerCounter);
    $('#lex-post-source')?.addEventListener('input', saveDraft);
    $('#quorum-entry-type')?.addEventListener('change', () => {
      syncCaseTitle();
      saveDraft();
    });
    ['quorum-entry-category', 'quorum-entry-subject', 'quorum-entry-year', 'quorum-case-title', 'quorum-entry-circle', 'quorum-opinion-only']
      .forEach((id) => $(`#${id}`)?.addEventListener('change', saveDraft));
    $('#quorum-entry-image')?.addEventListener('change', handleImageSelection);
    $('#quorum-image-remove')?.addEventListener('click', removeSelectedImage);
    $('#quorum-entry-preview')?.addEventListener('click', previewEntry);
    $('#quorum-entry-cancel')?.addEventListener('click', cancelComposer);
    $('#lex-load-more')?.addEventListener('click', () => {
      if (state.view === 'search') searchQuorum(state.filters.query, { append: true });
      else refreshFeed({ append: true });
    });
    $('#lex-feed-refresh')?.addEventListener('click', () => {
      if (state.view === 'entry') setView('home');
      else if (state.view === 'circles') renderCirclesView();
      else if (state.view === 'notifications') renderNotificationsView();
      else if (state.view === 'profile') renderProfileView();
      else if (state.view === 'search') searchQuorum(state.filters.query);
      else refreshFeed();
      loadSidebar();
    });
    $('#quorum-active-refresh')?.addEventListener('click', loadSidebar);
    $('#quorum-feed-sort')?.addEventListener('change', (event) => {
      state.filters.sort = event.target.value;
      state.view === 'search' ? searchQuorum(state.filters.query) : refreshFeed();
    });
    $('#quorum-search-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      searchQuorum($('#quorum-search-input')?.value);
    });
    $('#quorum-search-clear')?.addEventListener('click', clearSearch);
    $$('[data-quorum-view]').forEach((control) => {
      control.addEventListener('click', () => setView(control.dataset.quorumView));
    });
    global.addEventListener('online', () => {
      if (state.active && state.authenticated) {
        state.view === 'search' ? searchQuorum(state.filters.query) : setView(state.view);
      }
    });
    global.addEventListener('offline', () => {
      if (state.active) setFeedStatus('You are offline. Existing entries remain visible until you reconnect.', 'error');
    });
    global.addEventListener('duediligence:session', (event) => {
      const authenticated = event.detail?.authenticated === true;
      if (!authenticated) {
        clearPrivateView();
        if (state.active) askForSignIn();
        return;
      }
      setAuthView(true);
      const pending = consumeDestination();
      if (pending?.entryId) state.directEntryId = pending.entryId;
      if (pending?.legacyPostId) state.legacyPostId = pending.legacyPostId;
      if (pending?.view) state.view = pending.view;
      if (state.active || pending || ['#quorum', '#lex-forum'].includes(location.hash)) {
        global.showPage?.('community', state.trigger || $('#spa-community'));
        activate();
      }
    });
    global.addEventListener('popstate', () => {
      if (!['#quorum', '#lex-forum'].includes(location.hash)) return;
      const params = new URLSearchParams(location.search);
      const entryId = params.get('quorumEntry');
      if (entryId) openEntry(entryId);
      else setView('home');
    });
  }

  function initialize() {
    if (!config?.workerUrl || !$('#page-community') || state.initialized) return;
    state.initialized = true;
    populateControls();
    bind();
    restoreDraft();
    const params = new URLSearchParams(location.search);
    state.directEntryId = params.get('quorumEntry');
    state.legacyPostId = params.get('forumPost');
    const requested = ['#quorum', '#lex-forum'].includes(location.hash)
      || Boolean(state.directEntryId)
      || Boolean(state.legacyPostId);
    if (hasSession()) {
      setAuthView(true);
      if (requested) open($('#spa-community'));
    } else {
      setAuthView(false);
      if (requested) open($('#spa-community'));
    }
  }

  const publicApi = Object.freeze({
    open,
    refresh: () => state.view === 'search' ? searchQuorum(state.filters.query) : setView(state.view),
    state: () => ({
      authenticated: state.authenticated,
      active: state.active,
      loaded: state.loaded,
      view: state.view,
      itemCount: state.items.length,
    }),
  });
  global.DueDiligenceQuorum = publicApi;
  global.DueDiligenceLexForum = publicApi;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
