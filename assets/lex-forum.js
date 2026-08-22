(function dueDiligenceQuorum(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const destinationKey = 'duediligence.quorum.destination.v1';
  const draftPrefix = 'duediligence.quorum.draft.v2';
  const entryLimit = 4000;
  const commentLimit = 2000;
  const citationLimit = 1000;
  const imageLimit = 3 * 1024 * 1024;
  const imageTotalLimit = 12 * 1024 * 1024;
  const imageCountLimit = 12;
  const avatarSourceLimit = 20 * 1024 * 1024;
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
    entry_comment: 'commented on your post',
    comment_reply: 'replied to your comment',
    helpful: 'affirmed your post',
    repost: 'disseminated your post',
    circle_activity: 'added activity in a Study Circle',
    moderation_decision: 'sent a moderation update',
  };
  const affirmReactions = Object.freeze({
    hear: { label: 'I Hear' },
    see: { label: 'I See' },
    feel: { label: 'I Feel' },
  });

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
    selectedImages: [],
    directEntryId: null,
    legacyPostId: null,
    trigger: null,
    dialogReturnFocus: null,
    searchController: null,
    pending: new Set(),
    draftOwnerId: null,
    drawerOpen: false,
    drawerReturnFocus: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function session() {
    return global.DueDiligencePhase2?.getSession?.() || null;
  }

  function hasSession() {
    return Boolean(session()?.access_token);
  }

  function currentUserId() {
    return String(session()?.user?.id || '').trim();
  }

  function draftKey() {
    const userId = currentUserId();
    return userId ? `${draftPrefix}.${userId}` : null;
  }

  function requestId() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function commentRegionId(entryId) {
    const safeEntryId = String(entryId || '').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `quorum-comments-${safeEntryId}`;
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
      guard.textContent = message || 'The community is available only to signed-in Due Diligence members.';
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
    global.showPage?.('community', state.trigger || $('#spa-community'), { history: false });
    setAuthView(false, 'Sign in to enter the community. Guest access is unavailable.');
    global.DueDiligencePhase2?.openSignIn?.({
      allowGuest: false,
      allowDismiss: true,
      title: 'Enter the community',
      copy: 'Community access is included for signed-in Due Diligence members.',
      message: 'Use your existing Due Diligence account. You will return here after authentication.',
    });
  }

  const routableViews = new Set([
    'home',
    'saved',
    'unanswered',
    'circles',
    'notifications',
    'my-posts',
    'profile',
    'circle',
    'search',
    'entry',
  ]);

  function setStableLocation(entryId = null, { replace = true } = {}) {
    const url = new URL(location.href);
    url.searchParams.delete('forumPost');
    url.searchParams.delete('quorumEntry');
    url.searchParams.delete('quorumView');
    url.searchParams.delete('quorumCircle');
    url.searchParams.delete('quorumQuery');

    const view = entryId ? 'entry' : (routableViews.has(state.view) ? state.view : 'home');
    if (entryId) url.searchParams.set('quorumEntry', entryId);
    if (view !== 'home' && view !== 'entry') url.searchParams.set('quorumView', view);
    if (view === 'circle' && state.activeCircleId) {
      url.searchParams.set('quorumCircle', state.activeCircleId);
    }
    if (view === 'search' && state.filters.query) {
      url.searchParams.set('quorumQuery', state.filters.query);
    }
    url.hash = 'quorum';
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({
      ...(history.state || {}),
      dueDiligencePage: 'community',
      dueDiligenceQuorum: {
        view,
        entryId: entryId || null,
        circleId: view === 'circle' ? state.activeCircleId || null : null,
        query: view === 'search' ? state.filters.query || null : null,
      },
    }, '', `${url.pathname}${url.search}${url.hash}`);
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
      const error = new Error('Sign in to use the community.');
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
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'The community is temporarily unavailable.');
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
      ...(Array.isArray(image) ? { images: image } : image ? { image } : {}),
    });
  }

  function profilePhotoCommand(profileImage) {
    return api('/quorum/command', {
      operation: 'set_profile_avatar',
      payload: {},
      profileImage,
    });
  }

  function commentDraftKey(entryId, parentCommentId = 'root') {
    const userId = currentUserId();
    return userId
      ? `duediligence.quorum.comment.v1.${userId}.${entryId}.${parentCommentId || 'root'}`
      : null;
  }

  function readCommentDraft(entryId, parentCommentId = 'root') {
    const key = commentDraftKey(entryId, parentCommentId);
    if (!key) return { body: '', isAnonymous: false };
    try {
      const value = JSON.parse(safeStorage(localStorage, 'get', key) || 'null');
      if (!value || Date.now() - Number(value.savedAt || 0) > 7 * 86400000) return { body: '', isAnonymous: false };
      return { body: String(value.body || ''), isAnonymous: value.isAnonymous === true };
    } catch { return { body: '', isAnonymous: false }; }
  }

  function writeCommentDraft(entryId, parentCommentId, body, isAnonymous) {
    const key = commentDraftKey(entryId, parentCommentId);
    if (!key) return;
    if (!body) safeStorage(localStorage, 'remove', key);
    else safeStorage(localStorage, 'set', key, JSON.stringify({ body, isAnonymous, savedAt: Date.now() }));
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
    const message = error?.message || 'The community action could not be completed.';
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

  function iconElement(name) {
    const node = document.createElement('span');
    node.className = `quorum-icon quorum-icon-${name}`;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function iconButton(label, icon, className, handler, count = null) {
    const node = button('', `${className} quorum-icon-button`, handler);
    node.setAttribute('aria-label', label);
    node.title = label;
    node.append(iconElement(icon));
    if (count !== null) node.append(textElement('span', 'quorum-action-count', count));
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
    toast('Stable community post link copied.');
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
      textElement('span', 'lex-kicker', 'Community'),
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
    let actions = body.querySelector('.lex-dialog-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      body.append(actions);
    }
    let back = Array.from(actions.querySelectorAll('button')).find((control) => (
      /^(back|cancel|close|close preview)$/i.test(control.textContent.trim())
    ));
    if (back) {
      back.textContent = 'Back';
      back.dataset.lexDialogBack = 'true';
      back.setAttribute('aria-label', 'Back');
    } else {
      back = button('Back', 'lex-button', closeDialog);
      back.dataset.lexDialogBack = 'true';
      back.setAttribute('aria-label', 'Back');
      const primary = actions.querySelector('.lex-button-primary');
      actions.insertBefore(back, primary || null);
    }
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
      actions.append(button('Back', 'lex-button', closeDialog), confirm);
      body.append(error, actions);
    });
  }

  function authorBlock(author = {}, viewerOwns = false) {
    const canOpenProfile = Boolean(author.memberId);
    const wrapper = document.createElement(canOpenProfile ? 'button' : 'div');
    if (canOpenProfile) wrapper.type = 'button';
    wrapper.className = 'lex-author';
    if (canOpenProfile) wrapper.setAttribute('aria-label', `Open ${author.displayName || 'member'} profile`);
    const avatar = textElement('span', 'lex-author-avatar', initials(author.displayName));
    if (author.avatarUrl && !author.anonymous) {
      const image = document.createElement('img');
      image.src = author.avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      avatar.replaceChildren(image);
    }
    wrapper.append(avatar);
    const copy = document.createElement('span');
    copy.className = 'lex-author-copy';
    const name = author.verifiedAcademicIdentity
      ? `${author.displayName || 'Due Diligence Member'} · Verified Academic Identity`
      : author.displayName || 'Due Diligence Member';
    const secondary = author.anonymous
      ? `Anonymous${viewerOwns ? ' · You' : ''}`
      : [author.school, author.yearLevel].filter(Boolean).join(' · ') || 'Due Diligence member';
    copy.append(
      textElement('strong', '', name),
      textElement('span', author.anonymous ? 'lex-anonymous-badge' : '', secondary),
    );
    wrapper.append(copy);
    if (canOpenProfile) wrapper.addEventListener('click', () => showMemberProfile(author.memberId));
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
        textElement('span', '', 'Disseminated by'),
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
    header.append(authorBlock(item.author || {}, item.viewerOwns), entryTime(item));
    inner.append(header);

    const chips = document.createElement('div');
    chips.className = 'quorum-chip-row';
    const typeLabel = entryTypes.get(item.entryType);
    if (typeLabel) chips.append(chip(typeLabel));
    if (item.subject) chips.append(chip(item.subject));
    if (item.category) chips.append(chip(categories.get(item.category) || item.category));
    if (item.lawSchoolYear) chips.append(chip(item.lawSchoolYear));
    if (item.circle?.name) chips.append(chip(`Study Circle: ${item.circle.name}`));
    if (chips.childElementCount) inner.append(chips);

    inner.append(textElement('p', 'lex-post-body', item.body));

    const indicators = document.createElement('div');
    indicators.className = 'quorum-entry-indicators';
    (item.indicators || []).forEach((label) => indicators.append(chip(label, 'quorum-indicator')));
    if (indicators.childElementCount) inner.append(indicators);

    const source = sourceLink(item.sourceUrl);
    if (source) inner.append(source);
    const entryImages = Array.isArray(item.images) && item.images.length
      ? item.images
      : item.imageUrl ? [{ imageUrl: item.imageUrl, imageAlt: item.imageAlt }] : [];
    if (entryImages.length) {
      const gallery = document.createElement('div');
      gallery.className = 'quorum-entry-images';
      entryImages.forEach((entryImage) => {
        if (!entryImage?.imageUrl) return;
        const image = document.createElement('img');
        image.className = 'quorum-entry-image';
        image.src = entryImage.imageUrl;
        image.alt = entryImage.imageAlt
          || `Image attached to the community post by ${item.author?.displayName || 'a member'}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        gallery.append(image);
      });
      if (gallery.childElementCount) inner.append(gallery);
    }

    if (item.practiceQuestionId && item.subject) {
      const practice = button('Practice this issue', 'lex-button lex-button-quiet', async () => {
        practice.disabled = true;
        telemetry('practice_clicked', { subject: item.subject, entryType: item.entryType });
        const opened = await global.openQuorumMappedQuestion?.(item.subject, item.practiceQuestionId);
        if (!opened) practice.disabled = false;
      });
      practice.title = 'Open the genuinely mapped Mock Bar question; existing plan access still applies.';
      inner.append(practice);
    }

    const actions = document.createElement('div');
    actions.className = 'lex-post-actions';
    const affirm = document.createElement('div');
    affirm.className = 'quorum-affirm-control';
    const affirmationCount = Number(item.counts?.reactions ?? item.counts?.helpful) || 0;
    const affirmTrigger = iconButton(
      'Affirm this post: choose I Hear, I See, or I Feel',
      'affirm',
      `lex-action quorum-affirm-trigger${item.viewerReaction ? ' is-active' : ''}`,
      () => {
        const menu = affirm.querySelector('.quorum-affirm-menu');
        const expanded = menu.hidden;
        menu.hidden = !expanded;
        affirmTrigger.setAttribute('aria-expanded', String(expanded));
        if (expanded) requestAnimationFrame(() => menu.querySelector('[role="menuitemradio"]')?.focus());
      },
    );
    affirmTrigger.setAttribute('aria-haspopup', 'menu');
    affirmTrigger.setAttribute('aria-expanded', 'false');
    const affirmCount = button(
      String(affirmationCount),
      'quorum-affirm-count',
      () => openAffirmRoster(item),
    );
    affirmCount.setAttribute('aria-label', `View ${affirmationCount} affirmations`);
    affirmCount.title = `View ${affirmationCount} affirmations`;
    const affirmMenu = document.createElement('div');
    affirmMenu.className = 'quorum-affirm-menu';
    affirmMenu.hidden = true;
    affirmMenu.setAttribute('role', 'menu');
    Object.entries(affirmReactions).forEach(([type, metadata]) => {
      const reaction = button(
        metadata.label,
        `quorum-affirm-option${item.viewerReaction === type ? ' is-active' : ''}`,
        () => setAffirm(item, type),
      );
      reaction.setAttribute('role', 'menuitemradio');
      reaction.setAttribute('aria-checked', String(item.viewerReaction === type));
      affirmMenu.append(reaction);
    });
    affirmTrigger.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      affirmMenu.hidden = false;
      affirmTrigger.setAttribute('aria-expanded', 'true');
      const choices = $$('[role="menuitemradio"]', affirmMenu);
      const target = event.key === 'ArrowUp' ? choices[choices.length - 1] : choices[0];
      target?.focus();
    });
    affirmMenu.addEventListener('keydown', (event) => {
      const choices = $$('[role="menuitemradio"]', affirmMenu);
      const index = choices.indexOf(document.activeElement);
      let next = null;
      if (event.key === 'ArrowDown') next = choices[(index + 1 + choices.length) % choices.length];
      else if (event.key === 'ArrowUp') next = choices[(index - 1 + choices.length) % choices.length];
      else if (event.key === 'Home') next = choices[0];
      else if (event.key === 'End') next = choices[choices.length - 1];
      else if (event.key === 'Escape') {
        event.preventDefault();
        affirmMenu.hidden = true;
        affirmTrigger.setAttribute('aria-expanded', 'false');
        affirmTrigger.focus();
        return;
      } else if (event.key === 'Tab') {
        affirmMenu.hidden = true;
        affirmTrigger.setAttribute('aria-expanded', 'false');
        return;
      }
      if (next) {
        event.preventDefault();
        next.focus();
      }
    });
    affirm.append(affirmTrigger, affirmCount, affirmMenu);
    const comments = iconButton(
      `${Number(item.counts?.comments || 0)} comments. Open comments`,
      'comment',
      'lex-action',
      () => toggleComments(item, article, comments),
      Number(item.counts?.comments || 0),
    );
    comments.setAttribute('aria-controls', commentRegionId(item.entryId));
    comments.setAttribute('aria-expanded', String(state.commentsOpen.has(item.entryId)));
    const disseminate = iconButton(
      `${Number(item.counts?.citations || 0)} disseminations. Disseminate this post`,
      'share',
      'lex-action',
      () => openCitationDialog(item),
      Number(item.counts?.citations || 0),
    );
    disseminate.title = 'Share inside the community, copy a stable link, or use your device share sheet.';
    const save = iconButton(
      item.viewerSaved ? 'Remove from saved posts' : 'Save this post',
      'save',
      `lex-action${item.viewerSaved ? ' is-active' : ''}`,
      () => toggleSaved(item, save),
    );
    save.setAttribute('aria-pressed', item.viewerSaved ? 'true' : 'false');
    actions.append(affirm, comments, disseminate);
    if (item.viewerOwns) {
      const remove = iconButton(
        'Remove your post',
        'close',
        'lex-action lex-action-danger',
        () => removeEntry(item),
      );
      actions.append(remove);
    }
    actions.append(save);
    inner.append(actions);

    const overflow = document.createElement('details');
    overflow.className = 'quorum-overflow';
    const overflowSummary = document.createElement('summary');
    overflowSummary.className = 'quorum-overflow-trigger';
    overflowSummary.append(iconElement('more'));
    overflowSummary.setAttribute('aria-label', 'More post actions');
    overflowSummary.title = 'More post actions';
    const menu = document.createElement('div');
    menu.className = 'lex-post-owner-actions';
    menu.append(button('Report', 'lex-menu-button', () => openReportDialog('entry', item.entryId)));
    if (item.viewerOwns) {
      menu.append(
        button('Edit', 'lex-menu-button', () => openEditEntryDialog(item)),
        button('Remove', 'lex-menu-button is-danger', () => removeEntry(item)),
      );
    }
    if (item.kind === 'citation' && item.citation?.viewerOwns) {
      menu.append(button('Remove dissemination', 'lex-menu-button is-danger', () => removeCitation(item.citation.citationId)));
    }
    overflow.append(overflowSummary, menu);
    inner.append(overflow);
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
            : 'No community posts match this view.'),
        textElement('p', '', state.view === 'saved'
          ? 'Save a useful post to build your private authority list.'
          : state.view === 'my-posts'
            ? 'Your published community posts will appear here.'
            : 'Clear filters, refresh, or contribute a focused post.'),
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
    if (state.view === 'my-posts' && state.bootstrap?.profile?.memberId) {
      payload.authorMemberId = state.bootstrap.profile.memberId;
    }
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
    setFeedStatus(append ? 'Loading more posts…' : 'Loading community posts…');
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
        ? `${state.items.length.toLocaleString()} ${state.items.length === 1 ? 'post' : 'posts'} shown.`
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
    setViewLabels('Community post', 'Stable community link');
    syncViewButtons();
    if (options.route !== false) {
      setStableLocation(entryId, { replace: options.push !== true });
    }
    $('#lex-composer').hidden = true;
    const feed = $('#lex-feed');
    feed?.setAttribute('aria-busy', 'true');
    setFeedStatus('Opening post…');
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
    setViewLabels('Community post', 'Opening a legacy stable link');
    setFeedStatus('Opening post…');
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

  async function setAffirm(item, reaction) {
    const previousReaction = item.viewerReaction || null;
    const desired = previousReaction === reaction ? null : reaction;
    try {
      const result = await command('set_affirm', {
        entryId: item.entryId,
        reaction: desired,
      });
      item.viewerReaction = result.reaction || null;
      item.viewerHelpful = Boolean(item.viewerReaction);
      item.counts = {
        ...(item.counts || {}),
        reactions: Number(result.count) || 0,
        helpful: Number(result.count) || 0,
        hear: Number(result.counts?.hear) || 0,
        see: Number(result.counts?.see) || 0,
        feel: Number(result.counts?.feel) || 0,
      };
      renderFeed();
      toast(item.viewerReaction
        ? `${affirmReactions[item.viewerReaction].label} recorded.`
        : 'Affirmation removed.');
    } catch (error) {
      handleError(error, null);
    }
  }

  async function openAffirmRoster(item) {
    try {
      const roster = await query('affirm_roster', { entryId: item.entryId, limit: 60 });
      openDialog('Affirmations', (body) => {
        Object.entries(affirmReactions).forEach(([type, metadata]) => {
          const members = roster.groups?.[type] || [];
          const group = document.createElement('section');
          group.className = 'quorum-roster-group';
          group.append(textElement('h3', '', `${metadata.label} · ${members.length}`));
          if (!members.length) {
            group.append(textElement('p', 'lex-dialog-copy', 'No members yet.'));
          } else {
            members.forEach((member) => group.append(authorBlock(member)));
          }
          body.append(group);
        });
        const actions = document.createElement('div');
        actions.className = 'lex-dialog-actions';
        actions.append(button('Back', 'lex-button', closeDialog));
        body.append(actions);
      });
    } catch (error) {
      handleError(error, null);
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
      control.setAttribute('aria-label', item.viewerSaved ? 'Remove from saved posts' : 'Save this post');
      control.title = item.viewerSaved ? 'Remove from saved posts' : 'Save this post';
      toast(item.viewerSaved ? 'Added to My Authorities.' : 'Removed from My Authorities.');
      await loadBootstrap();
      if (state.view === 'saved' && !item.viewerSaved) refreshFeed();
    } catch (error) {
      handleError(error, null);
    } finally {
      control.disabled = false;
    }
  }

  async function toggleComments(item, article, control) {
    if (state.commentsOpen.has(item.entryId)) {
      state.commentsOpen.delete(item.entryId);
      control.setAttribute('aria-expanded', 'false');
      article.querySelector('.lex-comments')?.remove();
      return;
    }
    state.commentsOpen.add(item.entryId);
    control.setAttribute('aria-expanded', 'true');
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
    section.id = commentRegionId(item.entryId);
    section.className = 'lex-comments';
    section.setAttribute('aria-label', 'Comments and replies');
    const list = document.createElement('div');
    list.className = 'lex-comments-list';
    if (!comments) {
      list.append(textElement('div', 'lex-status', 'Loading comments…'));
    } else if (!comments.length) {
      list.append(textElement('div', 'lex-status', 'No comments yet. Add the first focused response.'));
    } else {
      arrangeVisibleComments(comments)
        .forEach(({ comment, isReply }) => list.append(renderComment(item, comment, isReply)));
    }
    section.append(list);
    if (!item.commentsLocked) section.append(commentForm(item));
    else section.append(textElement('div', 'lex-status', 'Comments are locked by a moderator.'));
    return section;
  }

  function arrangeVisibleComments(comments) {
    const visibleIds = new Set(comments.map((comment) => comment.commentId).filter(Boolean));
    const roots = comments.filter((comment) => (
      !comment.parentCommentId || !visibleIds.has(comment.parentCommentId)
    ));
    const arranged = [];
    const renderedIds = new Set();

    roots.forEach((comment) => {
      arranged.push({ comment, isReply: false });
      renderedIds.add(comment.commentId);
      comments
        .filter((reply) => reply.parentCommentId === comment.commentId)
        .forEach((reply) => {
          arranged.push({ comment: reply, isReply: true });
          renderedIds.add(reply.commentId);
        });
    });

    comments
      .filter((comment) => !renderedIds.has(comment.commentId))
      .forEach((comment) => arranged.push({ comment, isReply: false }));

    return arranged;
  }

  function renderComment(item, comment, isReply = false) {
    const node = document.createElement('article');
    node.className = `lex-comment${isReply ? ' is-reply' : ''}`;
    node.dataset.commentId = comment.commentId;
    const header = document.createElement('header');
    header.className = 'lex-comment-header';
    header.append(authorBlock(comment.author || {}, comment.viewerOwns), textElement('span', '', relativeTime(comment.createdAt)));
    node.append(header, textElement('p', 'lex-comment-body', comment.body));
    if (comment.edited) node.append(textElement('span', 'lex-edit-counter', 'Edited'));
    const actions = document.createElement('div');
    actions.className = 'lex-comment-actions';
    if (!isReply && !item.commentsLocked) {
      actions.append(iconButton(
        'Reply to this comment',
        'comment',
        'lex-comment-action',
        () => openCommentDialog(item, comment),
      ));
    }
    const overflow = document.createElement('details');
    overflow.className = 'quorum-overflow lex-comment-overflow';
    const overflowSummary = document.createElement('summary');
    overflowSummary.className = 'quorum-overflow-trigger';
    overflowSummary.append(iconElement('more'));
    overflowSummary.setAttribute('aria-label', 'More comment actions');
    overflowSummary.title = 'More comment actions';
    const menu = document.createElement('div');
    menu.className = 'lex-post-owner-actions';
    menu.append(button('Report', 'lex-menu-button', () => openReportDialog('comment', comment.commentId)));
    if (comment.viewerOwns) {
      menu.append(
        button('Edit', 'lex-menu-button', () => editComment(item, comment)),
        button('Remove', 'lex-menu-button is-danger', () => removeComment(item, comment)),
      );
    }
    overflow.append(overflowSummary, menu);
    actions.append(overflow);
    node.append(actions);
    return node;
  }

  function commentForm(item) {
    const form = document.createElement('form');
    form.className = 'lex-comment-form';
    const field = document.createElement('textarea');
    field.maxLength = commentLimit;
    field.rows = 3;
    field.placeholder = 'Add a focused comment. Keep personal information out of the community.';
    field.setAttribute('aria-label', 'Comment');
    const draft = readCommentDraft(item.entryId);
    field.value = draft.body;
    const anonymous = checkbox('Comment anonymously', draft.isAnonymous);
    anonymous.label.className = 'quorum-comment-anonymous';
    const actions = document.createElement('div');
    actions.className = 'lex-form-actions';
    field.addEventListener('input', () => {
      writeCommentDraft(item.entryId, 'root', field.value, anonymous.input.checked);
    });
    anonymous.input.addEventListener('change', () => {
      writeCommentDraft(item.entryId, 'root', field.value, anonymous.input.checked);
    });
    const submit = iconButton('Post comment', 'send', 'lex-button lex-button-primary', async () => {
      if (submit.disabled || !field.value.trim()) return;
      submit.disabled = true;
      try {
        await command('create_comment', {
          entryId: item.entryId,
          body: field.value,
          isAnonymous: anonymous.input.checked,
        });
        field.value = '';
        writeCommentDraft(item.entryId, 'root', '', false);
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
    actions.append(anonymous.label, submit);
    form.append(field, actions);
    form.addEventListener('submit', (event) => event.preventDefault());
    return form;
  }

  function openCommentDialog(item, parent) {
    openDialog('Reply to comment', (body) => {
      body.append(textElement('p', 'lex-dialog-copy', `Replying to ${parent.author?.displayName || 'a community member'}.`));
      const field = document.createElement('textarea');
      field.maxLength = commentLimit;
      field.rows = 5;
      field.placeholder = 'Write a focused reply.';
      const draft = readCommentDraft(item.entryId, parent.commentId);
      field.value = draft.body;
      const anonymous = checkbox('Reply anonymously', draft.isAnonymous);
      anonymous.label.className = 'quorum-comment-anonymous';
      field.addEventListener('input', () => writeCommentDraft(
        item.entryId, parent.commentId, field.value, anonymous.input.checked,
      ));
      anonymous.input.addEventListener('change', () => writeCommentDraft(
        item.entryId, parent.commentId, field.value, anonymous.input.checked,
      ));
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
            isAnonymous: anonymous.input.checked,
          });
          writeCommentDraft(item.entryId, parent.commentId, '', false);
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
      actions.append(button('Back', 'lex-button', closeDialog), submit);
      body.append(field, anonymous.label, error, actions);
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
      actions.append(button('Back', 'lex-button', closeDialog), save);
      body.append(field, error, actions);
    });
  }

  function removeComment(item, comment) {
    confirmDialog({
      title: 'Remove comment',
      copy: 'This comment will no longer appear in the community.',
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
    openDialog('Disseminate', (body) => {
      body.append(textElement('p', 'lex-dialog-copy', 'Share this post inside the community, copy its stable link, or use your device share sheet. Opening or cancelling this dialog does not change share counts.'));
      const field = document.createElement('textarea');
      field.maxLength = citationLimit;
      field.rows = 4;
      field.placeholder = 'Optional commentary for your community share.';
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
          await navigator.share({ title: 'Community post', url: stableEntryUrl(item.entryId) });
        } catch (failure) {
          if (failure?.name !== 'AbortError') error.textContent = 'The device share action could not be completed.';
        }
      });
      if (!navigator.share) nativeShare.hidden = true;
      const disseminate = button('Share in the community', 'lex-button lex-button-primary', async () => {
        if (disseminate.disabled) return;
        disseminate.disabled = true;
        try {
          const result = await command('create_repost', { entryId: item.entryId, body: field.value });
          item.counts.citations = Number(result.count || item.counts.citations || 0);
          closeDialog();
          await refreshFeed();
          toast('Post shared in the community.');
        } catch (failure) {
          disseminate.disabled = false;
          error.textContent = failure?.message || 'The dissemination could not be published.';
        }
      });
      actions.append(
        button('Copy link', 'lex-button', () => copyStableLink(item.entryId)),
        nativeShare,
        button('Back', 'lex-button', closeDialog),
        disseminate,
      );
      body.append(field, counter, error, actions);
    });
  }

  function removeCitation(citationId) {
    confirmDialog({
      title: 'Remove dissemination',
      copy: 'Your community share will be removed. The original post remains.',
      confirmLabel: 'Remove dissemination',
      onConfirm: async () => {
        await command('delete_repost', { citationId });
        await refreshFeed();
        toast('Dissemination removed.');
      },
    });
  }

  function openReportDialog(targetType, targetId) {
    openDialog('Report to community moderation', (body) => {
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
          toast('Report submitted privately to community moderation.');
        } catch (failure) {
          submit.disabled = false;
          error.textContent = failure?.message || 'The report could not be submitted.';
        }
      });
      actions.append(button('Back', 'lex-button', closeDialog), submit);
      body.append(categoryLabel, explanationLabel, error, actions);
    });
  }

  function openEditEntryDialog(item) {
    openDialog('Edit your post', (body) => {
      const bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Post';
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
            toast('Post image removed.');
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
            // Preserve the author's original privacy choice when an anonymous
            // post is edited. The server still verifies ownership.
            isAnonymous: item.anonymous === true,
          });
          closeDialog();
          state.view === 'entry' ? openEntry(item.entryId) : refreshFeed();
          toast('Post updated.');
        } catch (failure) {
          save.disabled = false;
          error.textContent = failure?.message || 'The post could not be updated.';
        }
      });
      actions.append(button('Back', 'lex-button', closeDialog), save);
      body.append(bodyLabel, sourceLabel, opinionLabel, error, actions);
    });
  }

  function removeEntry(item) {
    confirmDialog({
      title: 'Remove post',
      copy: 'This soft-deletes your post and makes its attached image inaccessible.',
      warning: 'Comments, disseminations, and stable links will no longer expose the removed post.',
      confirmLabel: 'Remove post',
      onConfirm: async () => {
        await command('delete_entry', { entryId: item.entryId });
        state.directEntryId = null;
        setStableLocation();
        await setView('home');
        toast('Post removed.');
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
      const active = control.dataset.quorumView === state.view;
      control.classList.toggle('is-active', active);
      if (active) control.setAttribute('aria-current', 'page');
      else control.removeAttribute('aria-current');
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
    if (options.route !== false) {
      setStableLocation(null, { replace: options.push !== true });
    }
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
      setViewLabels('Latest member discussions', 'Academic community');
      await refreshFeed();
    } else if (view === 'saved') {
      setViewLabels('My Authorities', 'Private saved posts');
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
    } else if (view === 'my-posts') {
      setViewLabels('My Posts', 'Your community contributions');
      await refreshFeed();
    } else if (view === 'profile') {
      setViewLabels('Community profile', 'Your public academic identity');
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
    chips.append(
      chip(`${Number(circle.memberCount || 0)} members`),
      chip(`${Number(circle.entryCount || 0)} posts`),
    );
    card.append(chips);
    const actions = document.createElement('div');
    actions.className = 'quorum-circle-actions';
    actions.append(button('Open circle', 'lex-button lex-button-quiet', () => (
      openCircle(circle.circleId, { push: true })
    )));
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
      actions.append(button('Back', 'lex-button', closeDialog), create);
      body.append(form, error, actions);
    });
  }

  async function openCircle(circleId, options = {}) {
    state.view = 'circle';
    state.activeCircleId = circleId;
    if (options.route !== false) {
      setStableLocation(null, { replace: options.push !== true });
    }
    syncViewButtons();
    $('#lex-composer').hidden = false;
    setViewLabels('Study Circle', 'Member circle feed');
    setFeedStatus('Opening Study Circle…');
    try {
      const circle = await query('circle', { circleId });
      state.circleDetail = circle;
      $('#lex-composer').hidden = !(circle.viewerJoined || circle.viewerOwns) || circle.status !== 'active';
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
      copy: `Leave “${circle.name}”? Your existing posts remain attributed to you.`,
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
      const unreadCount = Math.max(0, Number(result.unreadCount || 0));
      $('#quorum-notification-count').textContent = unreadCount;
      if (state.bootstrap?.counts) state.bootstrap.counts.unreadNotifications = unreadCount;
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
      markAll.disabled = unreadCount === 0;
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
            textElement('strong', '', notification.actor?.displayName || 'Community moderation'),
            textElement('p', 'quorum-panel-copy', `${notificationLabels[notification.type] || 'sent a community update'} · ${relativeTime(notification.createdAt)}`),
          );
          const open = button(notification.targetAvailable ? 'Open' : 'Unavailable', 'lex-button lex-button-quiet', async () => {
            if (!notification.read) {
              await command('mark_notification', { notificationId: notification.notificationId });
              loadBootstrap();
            }
            if (notification.entryId && notification.targetAvailable) openEntry(notification.entryId, { push: true });
            else if (notification.circleId && notification.targetAvailable) {
              openCircle(notification.circleId, { push: true });
            }
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
      textElement('span', 'lex-kicker', profile.verifiedAcademicIdentity ? 'Verified Academic Identity' : 'Community member'),
      textElement('h3', '', profile.displayName || 'Due Diligence Member'),
      textElement('p', 'quorum-panel-copy', [profile.school, profile.yearLevel].filter(Boolean).join(' · ') || 'Academic details are private.'),
    );
    const counts = document.createElement('div');
    counts.className = 'quorum-chip-row';
    counts.append(
      chip(`${Number(profile.counts?.entries || 0)} public posts`),
      chip(`${Number(profile.counts?.circles || 0)} Study Circles`),
    );
    panel.append(counts);
    const actions = document.createElement('div');
    actions.className = 'quorum-profile-actions';
    if (profile.viewerOwns) {
      const photoControl = document.createElement('div');
      photoControl.className = 'quorum-profile-photo-control';
      const preview = document.createElement(profile.avatarUrl ? 'img' : 'span');
      preview.className = 'quorum-profile-photo-preview';
      if (profile.avatarUrl) {
        preview.src = profile.avatarUrl;
        preview.alt = 'Your current community profile photo';
      } else {
        preview.textContent = initials(profile.displayName);
        preview.setAttribute('aria-label', 'No profile photo selected');
      }
      const photoInput = document.createElement('input');
      photoInput.type = 'file';
      photoInput.accept = 'image/jpeg,image/png,image/webp';
      photoInput.hidden = true;
      const choosePhoto = button('Update profile photo', 'lex-button', () => photoInput.click());
      const photoHelp = textElement('small', '', 'JPEG, PNG, or WebP up to 20 MB. Due Diligence removes embedded metadata and creates an optimized private version.');
      const photoCopy = document.createElement('div');
      photoCopy.append(choosePhoto, photoHelp);
      photoInput.addEventListener('change', async () => {
        const file = photoInput.files?.[0];
        if (!file) return;
        choosePhoto.disabled = true;
        choosePhoto.textContent = 'Preparing photo…';
        try {
          const image = await optimizedProfilePhoto(file);
          await profilePhotoCommand(image);
          toast('Your community profile photo was updated.', 'ok');
          await renderProfileView();
        } catch (error) {
          choosePhoto.disabled = false;
          choosePhoto.textContent = 'Update profile photo';
          handleError(error, null);
        }
      });
      photoControl.append(preview, photoCopy, photoInput);
      panel.append(photoControl);
      const settings = profile.settings || {
        profilePublic: true,
        showSchool: true,
        showYear: true,
      };
      const profilePublic = checkbox('Public community profile', settings.profilePublic);
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
          toast('Community privacy settings updated.');
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
            ? `Restore mutual community visibility with ${profile.displayName || 'this member'}?`
            : `Hide mutual community posts, comments, notifications, circle activity, and direct links involving ${profile.displayName || 'this member'}?`,
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
    setViewLabels('Academic profile', 'Community member');
    await renderProfileView(memberId);
  }

  async function renderBlockedMembers() {
    try {
      const blocked = await query('blocks');
      openDialog('Blocked members', (body) => {
        if (!blocked.length) {
          body.append(textElement('p', 'lex-dialog-copy', 'You have not blocked any community members.'));
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
        actions.append(button('Back', 'lex-button', closeDialog));
        body.append(actions);
      });
    } catch (error) {
      handleError(error, null);
    }
  }

  async function searchQuorum(queryText, options = {}) {
    const value = String(queryText || '').trim();
    if (value.length < 2) {
      toast('Enter at least two characters to search the community.');
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
    if (!append && options.route !== false) {
      setStableLocation(null, { replace: options.push !== true });
    }
    syncViewButtons();
    updateActiveFilters();
    $('#lex-composer').hidden = true;
    $('#quorum-search-clear').hidden = false;
    setViewLabels('Search results', 'Member community search');
    const feed = $('#lex-feed');
    if (!append) {
      feed.replaceChildren(Object.assign(document.createElement('div'), { className: 'lex-skeleton' }));
      $('#lex-load-more').hidden = true;
    }
    setFeedStatus('Searching the community…');
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
      panel.append(textElement('span', 'lex-kicker', 'Member discussions'), textElement('h3', '', `Results for “${value}”`));
      const entries = result.entries?.items || [];
      const groups = document.createElement('div');
      groups.className = 'quorum-search-groups';
      groups.append(textElement('h4', '', `Posts (${entries.length})`));
      if (!entries.length) groups.append(textElement('p', 'quorum-empty-copy', 'No matching posts.'));
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
    setView('home', { push: true });
  }

  function composerPayload() {
    return {
      body: $('#lex-post-body')?.value || '',
      kind: 'discussion',
      imageAlts: $$('[data-quorum-image-alt]').map((field) => field.value || ''),
      circleId: state.activeCircleId || null,
      isAnonymous: $('#quorum-entry-anonymous')?.checked === true,
    };
  }

  function saveDraft() {
    const key = draftKey();
    if (!key) return;
    const payload = composerPayload();
    if (!payload.body && !state.selectedImages.length) {
      safeStorage(localStorage, 'remove', key);
      return;
    }
    safeStorage(localStorage, 'set', key, JSON.stringify({
      ...payload,
      imageCount: state.selectedImages.length,
      savedAt: Date.now(),
    }));
  }

  function restoreDraft() {
    const key = draftKey();
    if (!key) return;
    const raw = safeStorage(localStorage, 'get', key);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!draft || Date.now() - Number(draft.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return;
      const body = $('#lex-post-body');
      if (body) body.value = draft.body || '';
      const anonymous = $('#quorum-entry-anonymous');
      if (anonymous) anonymous.checked = draft.isAnonymous === true;
      if (Number(draft.imageCount || (draft.hasImage ? 1 : 0))) {
        const status = $('#quorum-image-status');
        if (status) status.textContent = 'Select the images again before posting.';
      }
      updateComposerCounter();
    } catch {
      safeStorage(localStorage, 'remove', key);
    }
  }

  function resetComposerForSession() {
    $('#lex-composer')?.reset();
    state.selectedImage = null;
    state.selectedImages = [];
    $('#quorum-image-list')?.replaceChildren();
    if ($('#quorum-image-status')) $('#quorum-image-status').textContent = '';
    if ($('#quorum-image-remove')) $('#quorum-image-remove').hidden = true;
    updateComposerCounter({ persist: false });
    state.draftOwnerId = currentUserId() || null;
  }

  function clearComposer({ announce = false } = {}) {
    const key = draftKey();
    resetComposerForSession();
    if (key) safeStorage(localStorage, 'remove', key);
    if (announce) toast('Post draft cleared.');
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

  async function optimizedProfilePhoto(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
        || file.size < 1 || file.size > avatarSourceLimit) {
      throw new Error('Choose a JPEG, PNG, or WebP profile photo smaller than 20 MB.');
    }
    const bitmap = typeof createImageBitmap === 'function'
      ? await createImageBitmap(file)
      : await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('This photo could not be opened. Choose another JPG, PNG, or WebP image.'));
        };
        image.src = url;
      });
    try {
      if (bitmap.width < 256 || bitmap.height < 256) {
        throw new Error('Choose a profile photo at least 256 pixels wide and tall.');
      }
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(256, Math.round(bitmap.width * scale));
      const height = Math.max(256, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob || blob.size > imageLimit) {
        throw new Error('This photo is too large after optimization. Choose a smaller photo.');
      }
      const payload = await imageToPayload(new File([blob], 'profile.jpg', { type: 'image/jpeg' }));
      return { ...payload, width, height, cropX: 0.5, cropY: 0.5 };
    } finally {
      bitmap.close?.();
    }
  }

  async function publishEntry(event) {
    event.preventDefault();
    const submit = $('#lex-post-submit');
    if (!submit || submit.disabled) return;
    submit.disabled = true;
    setFeedStatus('Publishing post…');
    try {
      const payload = composerPayload();
      if (state.selectedImages.length && payload.imageAlts.some((description) => !description.trim())) {
        throw new Error('Add a short description for every selected image.');
      }
      const images = await Promise.all(state.selectedImages.map(imageToPayload));
      const result = await command('create_entry', {
        body: payload.body,
        entryType: 'student_support',
        subject: null,
        category: 'law_school_life',
        lawSchoolYear: '',
        caseTitle: '',
        opinionOnly: false,
        sourceUrl: '',
        circleId: payload.circleId,
        imageAlts: payload.imageAlts,
        isAnonymous: payload.isAnonymous,
      }, images);
      clearComposer();
      if (result.publicationStatus === 'pending') {
        toast('Announcement submitted for moderator approval.');
      } else {
        toast('Post published in the community.');
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

  function updateComposerCounter(options = {}) {
    if (options.persist !== false) saveDraft();
  }

  function renderSelectedImages() {
    const list = $('#quorum-image-list');
    if (!list) return;
    list.replaceChildren();
    state.selectedImages.forEach((file, index) => {
      const card = document.createElement('label');
      card.className = 'quorum-image-draft';
      const objectUrl = URL.createObjectURL(file);
      const image = document.createElement('img');
      image.src = objectUrl;
      image.alt = '';
      image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
      const description = document.createElement('input');
      description.maxLength = 500;
      description.required = true;
      description.dataset.quorumImageAlt = String(index);
      description.placeholder = `Describe image ${index + 1}`;
      description.setAttribute('aria-label', `Description for image ${index + 1}`);
      description.addEventListener('input', saveDraft);
      card.append(image, description);
      list.append(card);
    });
  }

  function handleImagesSelection() {
    const field = $('#quorum-entry-image');
    const files = Array.from(field?.files || []);
    if (!files.length) return;
    const invalid = files.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      || file.size < 1 || file.size > imageLimit);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > imageCountLimit || invalid || total > imageTotalLimit) {
      field.value = '';
      state.selectedImage = null;
      state.selectedImages = [];
      renderSelectedImages();
      toast('Choose up to 12 JPEG, PNG, or WebP images, 3 MB each and 12 MB total.');
      return;
    }
    state.selectedImages = files;
    state.selectedImage = files[0] || null;
    $('#quorum-image-status').textContent = `${files.length} image${files.length === 1 ? '' : 's'} selected · ${(total / 1024 / 1024).toFixed(1)} MB total`;
    $('#quorum-image-remove').hidden = false;
    renderSelectedImages();
    saveDraft();
  }

  function removeSelectedImages() {
    state.selectedImage = null;
    state.selectedImages = [];
    const field = $('#quorum-entry-image');
    if (field) field.value = '';
    if ($('#quorum-image-status')) $('#quorum-image-status').textContent = '';
    if ($('#quorum-image-remove')) $('#quorum-image-remove').hidden = true;
    $('#quorum-image-list')?.replaceChildren();
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
      query('insights'),
      query('circles', { limit: 3 }),
    ]);
    const insights = results[0].status === 'fulfilled'
      ? results[0].value
      : { trending: [], questions: [] };
    renderTrending($('#quorum-active-issues'), insights.trending || []);
    renderQuestionsNeedingAnswers($('#quorum-unanswered'), insights.questions || []);
    renderCompactCircles(
      $('#quorum-recommended-circles'),
      results[1].status === 'fulfilled' ? results[1].value.items : [],
    );
  }

  function renderTrending(container, items = []) {
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      container.append(textElement('p', 'quorum-empty-copy', 'No trending topics yet.'));
      return;
    }
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'quorum-ranked-item';
      row.append(
        textElement('strong', 'quorum-rank', String(index + 1)),
        textElement('span', '', item.topic),
        textElement('small', '', `${Number(item.postCount) || 0} ${Number(item.postCount) === 1 ? 'post' : 'posts'}`),
      );
      container.append(row);
    });
  }

  function renderQuestionsNeedingAnswers(container, items = []) {
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      container.append(textElement('p', 'quorum-empty-copy', 'No unanswered questions yet.'));
      return;
    }
    items.forEach((item) => {
      const control = button(item.body, 'quorum-question-item', () => openEntry(item.entryId, { push: true }));
      control.append(textElement('small', '', `${Number(item.answerCount) || 0} answers · ${relativeTime(item.createdAt)}`));
      container.append(control);
    });
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
      control.append(textElement('small', '', `${entryTypes.get(item.entryType) || 'Post'} · ${Number(item.counts?.comments || 0)} comments`));
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
      const control = button(circle.name, 'quorum-compact-item', () => (
        openCircle(circle.circleId, { push: true })
      ));
      control.append(textElement('small', '', `${Number(circle.memberCount || 0)} members · ${circle.subject || 'All subjects'}`));
      container.append(control);
    });
  }

  function populateControls() {
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

  function applySubjectFilter(subject) {
    state.filters.subject = subject;
    $$('#quorum-subject-links .quorum-filter-link').forEach((control) => {
      control.classList.toggle('is-active', control.textContent === (subject || 'All subjects'));
    });
    updateActiveFilters();
    if (state.view === 'search') searchQuorum(state.filters.query);
    else setView(['saved', 'unanswered', 'my-posts'].includes(state.view) ? state.view : 'home', { keepQuery: true });
  }

  function applyTypeFilter(entryType) {
    state.filters.entryType = entryType;
    $$('#quorum-type-links .quorum-filter-link').forEach((control) => {
      control.classList.toggle('is-active', control.textContent === (entryTypes.get(entryType) || 'All purposes'));
    });
    updateActiveFilters();
    if (state.view === 'search') searchQuorum(state.filters.query);
    else setView(['saved', 'unanswered', 'my-posts'].includes(state.view) ? state.view : 'home', { keepQuery: true });
  }

  async function activate() {
    state.active = true;
    setAuthView(true);
    try {
      await loadBootstrap();
      loadSidebar();
      telemetry('quorum_opened');
      await restoreRoute({ loadChrome: false });
    } catch (error) {
      handleError(error);
    }
  }

  async function restoreRoute(options = {}) {
    if (!['#quorum', '#lex-forum'].includes(location.hash)) return false;
    state.active = true;
    global.showPage?.('community', state.trigger || $('#spa-community'), { history: false });
    if (!hasSession()) {
      askForSignIn();
      return true;
    }
    setAuthView(true);
    if (options.loadChrome !== false) {
      await loadBootstrap();
      loadSidebar();
    }

    const params = new URLSearchParams(location.search);
    const entryId = params.get('quorumEntry');
    const legacyPostId = params.get('forumPost');
    const requestedView = params.get('quorumView') || 'home';
    const circleId = params.get('quorumCircle');
    const queryText = params.get('quorumQuery');
    state.directEntryId = entryId;
    state.legacyPostId = legacyPostId;

    if (entryId) await openEntry(entryId, { route: false });
    else if (legacyPostId) await openLegacyEntry(legacyPostId);
    else if (requestedView === 'circle' && circleId) {
      await openCircle(circleId, { route: false });
    } else if (requestedView === 'search' && queryText) {
      await searchQuorum(queryText, { route: false });
    } else if (routableViews.has(requestedView)
        && !['entry', 'circle', 'search'].includes(requestedView)) {
      await setView(requestedView, { route: false });
    } else {
      await setView('home', { route: false });
    }
    return true;
  }

  function deactivate() {
    state.active = false;
    closeQuorumDrawer({ restoreFocus: false });
    state.searchController?.abort();
    $$('.quorum-affirm-menu').forEach((menu) => {
      menu.hidden = true;
      menu.closest('.quorum-affirm-control')
        ?.querySelector('.quorum-affirm-trigger')
        ?.setAttribute('aria-expanded', 'false');
    });
  }

  function open(trigger = null) {
    state.trigger = trigger || state.trigger || $('#spa-community');
    const params = new URLSearchParams(location.search);
    state.directEntryId = params.get('quorumEntry') || state.directEntryId;
    state.legacyPostId = params.get('forumPost') || state.legacyPostId;
    if (!['#quorum', '#lex-forum'].includes(location.hash)) {
      setStableLocation(state.directEntryId, { replace: false });
    }
    if (!hasSession()) {
      askForSignIn();
      return true;
    }
    setAuthView(true);
    global.showPage?.('community', state.trigger, { history: false });
    activate();
    return true;
  }

  function closeQuorumDrawer({ restoreFocus = true } = {}) {
    if (!state.drawerOpen) return;
    state.drawerOpen = false;
    const drawer = $('#quorum-navigation');
    drawer?.classList.remove('is-open');
    drawer?.setAttribute('aria-hidden', 'true');
    $('#quorum-menu-scrim')?.classList.remove('is-open');
    $('#quorum-menu-open')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('quorum-drawer-open');
    if (restoreFocus) (state.drawerReturnFocus || $('#quorum-menu-open'))?.focus?.();
  }

  function openQuorumDrawer(trigger = $('#quorum-menu-open')) {
    const drawer = $('#quorum-navigation');
    if (!drawer) return;
    state.drawerOpen = true;
    state.drawerReturnFocus = trigger;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    $('#quorum-menu-scrim')?.classList.add('is-open');
    $('#quorum-menu-open')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('quorum-drawer-open');
    $('#quorum-menu-close')?.focus();
  }

  function trapQuorumDrawerFocus(event) {
    if (!state.drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeQuorumDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = $$('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])', $('#quorum-navigation'));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function bind() {
    $('#lex-composer')?.addEventListener('submit', publishEntry);
    $('#lex-post-body')?.addEventListener('input', updateComposerCounter);
    $('#quorum-entry-anonymous')?.addEventListener('change', updateComposerCounter);
    $('#quorum-entry-image')?.addEventListener('change', handleImagesSelection);
    $('#quorum-image-remove')?.addEventListener('click', removeSelectedImages);
    $('#quorum-menu-open')?.addEventListener('click', (event) => openQuorumDrawer(event.currentTarget));
    $('#quorum-menu-close')?.addEventListener('click', () => closeQuorumDrawer());
    $('#quorum-menu-back')?.addEventListener('click', () => closeQuorumDrawer());
    $('#quorum-menu-scrim')?.addEventListener('click', () => closeQuorumDrawer());
    document.addEventListener('keydown', trapQuorumDrawerFocus);
    $('#lex-load-more')?.addEventListener('click', () => {
      if (state.view === 'search') searchQuorum(state.filters.query, { append: true });
      else refreshFeed({ append: true });
    });
    $('#lex-feed-refresh')?.addEventListener('click', () => {
      if (state.view === 'entry') setView('home');
      else if (state.view === 'circles') renderCirclesView();
      else if (state.view === 'notifications') renderNotificationsView();
      else if (state.view === 'my-posts') refreshFeed();
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
      searchQuorum($('#quorum-search-input')?.value, { push: true });
    });
    $('#quorum-search-clear')?.addEventListener('click', clearSearch);
    $('#community-compose-jump')?.addEventListener('click', () => {
      const composer = $('#lex-composer');
      composer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#lex-post-body')?.focus({ preventScroll: true });
    });
    $$('[data-quorum-view]').forEach((control) => {
      control.addEventListener('click', () => {
        closeQuorumDrawer({ restoreFocus: false });
        setView(control.dataset.quorumView, { push: true });
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveDraft();
    });
    global.addEventListener('pagehide', saveDraft, { capture: true });
    global.addEventListener('online', () => {
      if (state.active && state.authenticated) {
        state.view === 'search' ? searchQuorum(state.filters.query) : setView(state.view);
      }
    });
    global.addEventListener('offline', () => {
      if (state.active) setFeedStatus('You are offline. Existing posts remain visible until you reconnect.', 'error');
    });
    global.addEventListener('duediligence:session', (event) => {
      const authenticated = event.detail?.authenticated === true;
      const nextUserId = authenticated ? currentUserId() : '';
      if (state.draftOwnerId !== (nextUserId || null)) {
        resetComposerForSession();
        if (authenticated) restoreDraft();
      }
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
        global.showPage?.('community', state.trigger || $('#spa-community'), { history: false });
        activate();
      }
    });
    document.addEventListener('click', (event) => {
      $$('.quorum-affirm-control').forEach((control) => {
        if (control.contains(event.target)) return;
        const menu = $('.quorum-affirm-menu', control);
        const trigger = $('.quorum-affirm-trigger', control);
        if (menu) menu.hidden = true;
        trigger?.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function initialize() {
    if (!config?.workerUrl || !$('#page-community') || state.initialized) return;
    state.initialized = true;
    populateControls();
    bind();
    state.draftOwnerId = currentUserId() || null;
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
    restoreRoute,
    deactivate,
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
