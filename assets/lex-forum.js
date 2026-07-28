(function dueDiligenceLexForum(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const pendingKey = 'duediligence.lex-forum.destination.v1';
  const postLimit = 4000;
  const commentLimit = 2000;
  const repostLimit = 1000;
  const state = {
    active: false,
    authenticated: false,
    loading: false,
    loaded: false,
    items: [],
    cursor: null,
    hasMore: false,
    directPostId: null,
    comments: new Map(),
    commentsOpen: new Set(),
    trigger: null,
    dialogReturnFocus: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function session() {
    return global.DueDiligencePhase2?.getSession?.() || null;
  }

  function hasSession() {
    return Boolean(session()?.access_token);
  }

  function requestId() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function rememberDestination(postId = null) {
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({
        postId: postId || state.directPostId || null,
        createdAt: Date.now(),
      }));
    } catch {
      // The hash and query string remain a non-sensitive fallback.
    }
  }

  function consumeDestination() {
    let destination = null;
    try {
      destination = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      sessionStorage.removeItem(pendingKey);
    } catch {
      destination = null;
    }
    if (!destination || Date.now() - Number(destination.createdAt || 0) > 30 * 60 * 1000) {
      return null;
    }
    return destination;
  }

  function setAuthView(authenticated, message = '') {
    state.authenticated = authenticated;
    const app = $('#lex-forum-app');
    const guard = $('#lex-auth-state');
    if (app) app.hidden = !authenticated;
    if (guard) {
      guard.hidden = authenticated;
      guard.textContent = message || (authenticated
        ? ''
        : 'Lex Forum is available only to signed-in Due Diligence members.');
    }
  }

  function clearPrivateView() {
    state.items = [];
    state.cursor = null;
    state.hasMore = false;
    state.loaded = false;
    state.comments.clear();
    state.commentsOpen.clear();
    const feed = $('#lex-feed');
    if (feed) feed.replaceChildren();
    setAuthView(false);
  }

  function askForSignIn() {
    rememberDestination();
    setAuthView(false, 'Sign in with Google to enter Lex Forum. No guest forum access is available.');
    global.DueDiligencePhase2?.openSignIn?.({
      allowGuest: false,
      title: 'Enter Lex Forum',
      copy: 'Lex Forum is available only to signed-in Due Diligence members.',
      message: 'Sign in with Google. You will return to Lex Forum after authentication.',
    });
  }

  function setStableLocation(postId = null) {
    const url = new URL(location.href);
    if (postId) url.searchParams.set('forumPost', postId);
    else url.searchParams.delete('forumPost');
    url.hash = 'lex-forum';
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function open(trigger = null) {
    state.trigger = trigger || state.trigger || $('#spa-community');
    const queryPost = new URLSearchParams(location.search).get('forumPost');
    state.directPostId = queryPost || state.directPostId;
    setStableLocation(state.directPostId);
    if (!hasSession()) {
      askForSignIn();
      return true;
    }
    setAuthView(true);
    global.showPage?.('community', state.trigger);
    activate();
    return true;
  }

  async function api(path, body = {}) {
    const currentSession = session();
    if (!currentSession?.access_token) {
      const error = new Error('Sign in to use Lex Forum.');
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
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'Lex Forum is temporarily unavailable.');
      error.code = payload?.error?.code || 'FORUM_UNAVAILABLE';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function handleError(error, target = $('#lex-feed-status')) {
    if (['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      clearPrivateView();
      askForSignIn();
      return;
    }
    if (target) {
      target.textContent = error?.message || 'Lex Forum is temporarily unavailable.';
      target.classList.add('is-error');
    }
    toast(error?.message || 'The forum action could not be completed.');
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
    node.timer = setTimeout(() => node.classList.remove('is-visible'), 3200);
  }

  function textElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
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

  function stablePostUrl(postId) {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('forumPost', postId);
    url.hash = 'lex-forum';
    return url.href;
  }

  function button(label, className, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.addEventListener('click', handler);
    return node;
  }

  function authorBlock(author = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lex-author';
    const avatar = textElement('span', 'lex-author-avatar', initials(author.displayName));
    avatar.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'lex-author-copy';
    copy.append(
      textElement('strong', '', author.displayName || 'Due Diligence Member'),
      textElement('span', '', author.school || 'Due Diligence member'),
    );
    wrapper.append(avatar, copy);
    return wrapper;
  }

  function postTime(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lex-post-time';
    const time = document.createElement('time');
    time.dateTime = String(item.createdAt || '');
    time.textContent = relativeTime(item.createdAt);
    wrapper.append(time);
    if (item.edited) wrapper.append(document.createElement('br'), document.createTextNode('Edited'));
    return wrapper;
  }

  function sourceLink(sourceUrl) {
    if (!sourceUrl) return null;
    try {
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        return null;
      }
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

  async function copyStableLink(postId) {
    const link = stablePostUrl(postId);
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
    toast('Stable Lex Forum link copied.');
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
      textElement('span', 'lex-kicker', 'Lex Forum'),
      textElement('h2', '', 'Confirm action'),
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
    dialog.addEventListener('close', restoreDialogFocus);
    document.body.append(dialog);
    return dialog;
  }

  function restoreDialogFocus() {
    const focus = state.dialogReturnFocus;
    state.dialogReturnFocus = null;
    if (focus?.isConnected) requestAnimationFrame(() => focus.focus());
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
    requestAnimationFrame(() => {
      body.querySelector('textarea, select, input, button')?.focus();
    });
  }

  function confirmDialog({ title, copy, warning, confirmLabel, onConfirm }) {
    openDialog(title, (body) => {
      body.append(textElement('p', 'lex-dialog-copy', copy));
      if (warning) body.append(textElement('div', 'lex-dialog-warning', warning));
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      actions.append(
        button('Cancel', 'lex-button', closeDialog),
        button(confirmLabel, 'lex-button lex-button-primary', async (event) => {
          const target = event.currentTarget;
          target.disabled = true;
          try {
            await onConfirm();
            closeDialog();
          } catch (error) {
            target.disabled = false;
            handleError(error, body.querySelector('.lex-inline-error'));
          }
        }),
      );
      body.append(actions);
    });
  }

  async function refreshFeed(options = {}) {
    if (!hasSession() || state.loading) return;
    state.loading = true;
    const append = options.append === true;
    const feed = $('#lex-feed');
    feed?.setAttribute('aria-busy', 'true');
    setFeedStatus(append ? 'Loading more discussions…' : 'Loading member discussions…');
    if (!append && feed) {
      feed.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'lex-skeleton' }),
        Object.assign(document.createElement('div'), { className: 'lex-skeleton' }),
      );
    }
    try {
      const payload = await api('/forum/feed', {
        limit: 10,
        cursor: append ? state.cursor : null,
        postId: state.directPostId || null,
      });
      const items = Array.isArray(payload.feed?.items) ? payload.feed.items : [];
      const known = new Set((append ? state.items : []).map((item) => `${item.kind}:${item.id}`));
      state.items = append
        ? state.items.concat(items.filter((item) => !known.has(`${item.kind}:${item.id}`)))
        : items;
      state.cursor = payload.feed?.nextCursor || null;
      state.hasMore = Boolean(payload.feed?.hasMore) && !state.directPostId;
      state.loaded = true;
      renderFeed();
      setFeedStatus(state.directPostId
        ? 'Viewing a stable Lex Forum discussion link.'
        : '');
    } catch (error) {
      if (!append && feed) feed.replaceChildren();
      handleError(error);
      renderRetryState(error);
    } finally {
      state.loading = false;
      feed?.setAttribute('aria-busy', 'false');
    }
  }

  function renderRetryState(error) {
    const feed = $('#lex-feed');
    if (!feed || !state.authenticated) return;
    const box = document.createElement('div');
    box.className = navigator.onLine ? 'lex-empty' : 'lex-offline';
    box.append(
      textElement('strong', '', navigator.onLine ? 'The feed could not be loaded.' : 'You are offline.'),
      document.createElement('br'),
      document.createTextNode(error?.message || 'Reconnect or retry in a moment.'),
      document.createElement('br'),
      button('Retry', 'lex-button lex-button-quiet', () => refreshFeed()),
    );
    feed.replaceChildren(box);
  }

  function renderFeed() {
    const feed = $('#lex-feed');
    const loadMore = $('#lex-load-more');
    const refresh = $('#lex-feed-refresh');
    if (!feed) return;
    feed.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'lex-empty';
      empty.append(
        textElement('strong', '', state.directPostId
          ? 'This discussion is unavailable.'
          : 'The forum is ready for its first discussion.'),
        document.createElement('br'),
        document.createTextNode(state.directPostId
          ? 'It may have been removed or moderated.'
          : 'Share a doctrine, question, or study insight above.'),
      );
      feed.append(empty);
    } else {
      state.items.forEach((item) => feed.append(renderPost(item)));
    }
    if (loadMore) loadMore.hidden = !state.hasMore;
    if (refresh) refresh.textContent = state.directPostId ? 'All discussions' : 'Refresh';
  }

  function renderPost(item) {
    const article = document.createElement('article');
    article.className = 'lex-post-card';
    article.dataset.itemId = item.id;
    article.dataset.postId = item.postId;
    article.id = `lex-item-${item.id}`;

    if (item.kind === 'repost' && item.repost) {
      const banner = document.createElement('div');
      banner.className = 'lex-repost-banner';
      banner.append(
        document.createTextNode(`${item.repost.author?.displayName || 'A member'} shared this discussion`),
        textElement('time', '', relativeTime(item.repost.createdAt)),
      );
      article.append(banner);
      if (item.repost.commentary) {
        article.append(textElement('p', 'lex-repost-commentary', item.repost.commentary));
      }
    }

    const inner = document.createElement('div');
    inner.className = 'lex-post-inner';
    const header = document.createElement('header');
    header.className = 'lex-post-header';
    header.append(authorBlock(item.author), postTime(item));
    inner.append(header, textElement('p', 'lex-post-body', item.body));
    const link = sourceLink(item.sourceUrl);
    if (link) inner.append(link);
    article.append(inner);

    const actions = document.createElement('div');
    actions.className = 'lex-post-actions';
    const like = button(
      `${item.viewerLiked ? 'Liked' : 'Like'} · ${Number(item.counts?.likes) || 0}`,
      `lex-action${item.viewerLiked ? ' is-active' : ''}`,
      () => setReaction(item, like),
    );
    like.setAttribute('aria-pressed', item.viewerLiked ? 'true' : 'false');
    const comments = button(
      `Comment · ${Number(item.counts?.comments) || 0}`,
      'lex-action',
      () => toggleComments(item, article),
    );
    const share = button(
      `Share · ${Number(item.counts?.shares) || 0}`,
      'lex-action',
      () => openShareDialog(item),
    );
    const report = button('Report', 'lex-action', () => openReportDialog('post', item.postId));
    actions.append(like, comments, share, report);
    article.append(actions);

    const ownerActions = document.createElement('div');
    ownerActions.className = 'lex-post-owner-actions';
    ownerActions.append(
      button('Open', 'lex-menu-button', () => openStablePost(item.postId)),
      button('Copy link', 'lex-menu-button', () => copyStableLink(item.postId)),
    );
    if (item.viewerOwns) {
      ownerActions.append(
        button('Edit', 'lex-menu-button', () => editPost(item, article)),
        button('Remove', 'lex-menu-button is-danger', () => deletePost(item)),
      );
    }
    if (item.kind === 'repost' && item.repost?.viewerOwns) {
      ownerActions.append(
        button('Remove share', 'lex-menu-button is-danger', () => deleteRepost(item.repost.id)),
      );
    }
    article.append(ownerActions);

    if (state.commentsOpen.has(item.postId)) {
      article.append(renderCommentsSection(item));
    }
    return article;
  }

  async function setReaction(item, control) {
    if (control.disabled) return;
    const beforeLiked = Boolean(item.viewerLiked);
    const beforeCount = Number(item.counts?.likes) || 0;
    item.viewerLiked = !beforeLiked;
    item.counts.likes = Math.max(0, beforeCount + (item.viewerLiked ? 1 : -1));
    control.textContent = `${item.viewerLiked ? 'Liked' : 'Like'} · ${item.counts.likes}`;
    control.classList.toggle('is-active', item.viewerLiked);
    control.setAttribute('aria-pressed', item.viewerLiked ? 'true' : 'false');
    control.disabled = true;
    try {
      const payload = await api('/forum/reactions', {
        postId: item.postId,
        liked: item.viewerLiked,
      });
      item.viewerLiked = Boolean(payload.reaction?.liked);
      item.counts.likes = Number(payload.reaction?.count) || 0;
      control.textContent = `${item.viewerLiked ? 'Liked' : 'Like'} · ${item.counts.likes}`;
      control.classList.toggle('is-active', item.viewerLiked);
      control.setAttribute('aria-pressed', item.viewerLiked ? 'true' : 'false');
      toast(item.viewerLiked ? 'Post liked.' : 'Like removed.');
    } catch (error) {
      item.viewerLiked = beforeLiked;
      item.counts.likes = beforeCount;
      control.textContent = `${beforeLiked ? 'Liked' : 'Like'} · ${beforeCount}`;
      control.classList.toggle('is-active', beforeLiked);
      control.setAttribute('aria-pressed', beforeLiked ? 'true' : 'false');
      handleError(error);
    } finally {
      control.disabled = false;
    }
  }

  async function toggleComments(item) {
    if (state.commentsOpen.has(item.postId)) {
      state.commentsOpen.delete(item.postId);
      renderFeed();
      return;
    }
    state.commentsOpen.add(item.postId);
    renderFeed();
    try {
      const payload = await api('/forum/comments', { postId: item.postId, limit: 100 });
      state.comments.set(item.postId, Array.isArray(payload.comments) ? payload.comments : []);
      renderFeed();
      requestAnimationFrame(() => {
        document.getElementById(`lex-item-${item.id}`)
          ?.querySelector('.lex-comment-form textarea')
          ?.focus();
      });
    } catch (error) {
      state.commentsOpen.delete(item.postId);
      renderFeed();
      handleError(error);
    }
  }

  function renderCommentsSection(item) {
    const section = document.createElement('section');
    section.className = 'lex-comments';
    section.setAttribute('aria-label', 'Comments');
    const list = document.createElement('div');
    list.className = 'lex-comments-list';
    const comments = state.comments.get(item.postId);
    if (!comments) {
      list.append(textElement('div', 'lex-status', 'Loading comments…'));
    } else if (!comments.length) {
      list.append(textElement('div', 'lex-status', 'No comments yet. Add the first focused response.'));
    } else {
      comments.forEach((comment) => list.append(renderComment(comment, item)));
    }
    section.append(list, commentForm(item));
    return section;
  }

  function renderComment(comment, item) {
    const node = document.createElement('article');
    node.className = 'lex-comment';
    node.dataset.commentId = comment.id;
    const header = document.createElement('header');
    header.className = 'lex-comment-header';
    header.append(
      textElement('strong', '', `${comment.author?.displayName || 'Due Diligence Member'}${comment.author?.school ? ` · ${comment.author.school}` : ''}`),
      textElement('span', '', `${relativeTime(comment.createdAt)}${comment.edited ? ' · Edited' : ''}`),
    );
    node.append(header, textElement('p', 'lex-comment-body', comment.body));
    const actions = document.createElement('div');
    actions.className = 'lex-comment-actions';
    actions.append(button('Report', '', () => openReportDialog('comment', comment.id)));
    if (comment.viewerOwns) {
      actions.append(
        button('Edit', '', () => editComment(comment, item)),
        button('Remove', '', () => deleteComment(comment, item)),
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
    field.placeholder = 'Add a plain-text comment…';
    field.setAttribute('aria-label', 'Add a comment');
    field.required = true;
    const actions = document.createElement('div');
    actions.className = 'lex-form-actions';
    const counter = textElement('span', 'lex-edit-counter', `0 / ${commentLimit.toLocaleString()}`);
    field.addEventListener('input', () => {
      counter.textContent = `${field.value.length.toLocaleString()} / ${commentLimit.toLocaleString()}`;
    });
    const submit = button('Post comment', 'lex-button lex-button-primary', () => {});
    submit.type = 'submit';
    actions.append(counter, submit);
    form.append(field, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await api('/forum/comments/create', { postId: item.postId, body: field.value });
        const payload = await api('/forum/comments', { postId: item.postId, limit: 100 });
        state.comments.set(item.postId, Array.isArray(payload.comments) ? payload.comments : []);
        item.counts.comments = state.comments.get(item.postId).length;
        renderFeed();
        toast('Comment published.');
      } catch (error) {
        submit.disabled = false;
        handleError(error);
      }
    });
    return form;
  }

  function editPost(item, article) {
    const inner = $('.lex-post-inner', article);
    if (!inner) return;
    const form = document.createElement('form');
    form.className = 'lex-edit-form';
    const body = document.createElement('textarea');
    body.maxLength = postLimit;
    body.rows = 6;
    body.value = item.body;
    body.required = true;
    const source = document.createElement('input');
    source.type = 'url';
    source.maxLength = 2000;
    source.value = item.sourceUrl || '';
    source.placeholder = 'Optional source URL';
    source.className = 'lex-edit-source';
    const actions = document.createElement('div');
    actions.className = 'lex-form-actions';
    actions.append(
      button('Cancel', 'lex-button', renderFeed),
      button('Save changes', 'lex-button lex-button-primary', () => {}),
    );
    const save = actions.lastElementChild;
    save.type = 'submit';
    form.append(body, source, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await api('/forum/posts/update', {
          postId: item.postId,
          body: body.value,
          sourceUrl: source.value,
        });
        await refreshFeed();
        toast('Post updated.');
      } catch (error) {
        save.disabled = false;
        handleError(error);
      }
    });
    inner.replaceChildren(form);
    body.focus();
  }

  function deletePost(item) {
    confirmDialog({
      title: 'Remove your post?',
      copy: 'The post will be removed from the member feed. This does not delete examination or account data.',
      warning: 'Comments, reactions, and reports attached to this post will no longer be visible to members.',
      confirmLabel: 'Remove post',
      onConfirm: async () => {
        await api('/forum/posts/delete', { postId: item.postId });
        if (state.directPostId === item.postId) {
          state.directPostId = null;
          setStableLocation();
        }
        await refreshFeed();
        toast('Post removed.');
      },
    });
  }

  function editComment(comment, item) {
    openDialog('Edit comment', (body) => {
      const field = document.createElement('textarea');
      field.maxLength = commentLimit;
      field.rows = 5;
      field.value = comment.body;
      field.required = true;
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      actions.append(
        button('Cancel', 'lex-button', closeDialog),
        button('Save comment', 'lex-button lex-button-primary', async (event) => {
          const target = event.currentTarget;
          target.disabled = true;
          try {
            await api('/forum/comments/update', { commentId: comment.id, body: field.value });
            const payload = await api('/forum/comments', { postId: item.postId, limit: 100 });
            state.comments.set(item.postId, Array.isArray(payload.comments) ? payload.comments : []);
            closeDialog();
            renderFeed();
            toast('Comment updated.');
          } catch (error) {
            target.disabled = false;
            handleError(error);
          }
        }),
      );
      body.append(field, actions);
    });
  }

  function deleteComment(comment, item) {
    confirmDialog({
      title: 'Remove your comment?',
      copy: 'The comment will be removed from this discussion.',
      confirmLabel: 'Remove comment',
      onConfirm: async () => {
        await api('/forum/comments/delete', { commentId: comment.id });
        const payload = await api('/forum/comments', { postId: item.postId, limit: 100 });
        state.comments.set(item.postId, Array.isArray(payload.comments) ? payload.comments : []);
        item.counts.comments = state.comments.get(item.postId).length;
        renderFeed();
        toast('Comment removed.');
      },
    });
  }

  function openShareDialog(item) {
    openDialog('Share inside Lex Forum', (body) => {
      body.append(textElement(
        'p',
        'lex-dialog-copy',
        'Repost this discussion to the chronological member feed. Opening or cancelling this dialog does not count as a share.',
      ));
      const field = document.createElement('textarea');
      field.maxLength = repostLimit;
      field.rows = 4;
      field.placeholder = 'Optional commentary (up to 1,000 characters)';
      field.setAttribute('aria-label', 'Optional repost commentary');
      const counter = textElement('span', 'lex-dialog-counter', `0 / ${repostLimit.toLocaleString()}`);
      field.addEventListener('input', () => {
        counter.textContent = `${field.value.length.toLocaleString()} / ${repostLimit.toLocaleString()}`;
      });
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      actions.append(
        button('Copy link', 'lex-button', () => copyStableLink(item.postId)),
        button('Cancel', 'lex-button', closeDialog),
        button('Repost', 'lex-button lex-button-primary', async (event) => {
          const target = event.currentTarget;
          target.disabled = true;
          try {
            const payload = await api('/forum/reposts/create', {
              postId: item.postId,
              commentary: field.value,
            });
            closeDialog();
            await refreshFeed();
            toast(payload.repost?.replayed
              ? 'This discussion is already in your shared posts.'
              : 'Discussion shared to Lex Forum.');
          } catch (error) {
            target.disabled = false;
            handleError(error);
          }
        }),
      );
      body.append(field, counter, actions);
    });
  }

  function deleteRepost(repostId) {
    confirmDialog({
      title: 'Remove this share?',
      copy: 'The original discussion remains available. Only your repost is removed.',
      confirmLabel: 'Remove share',
      onConfirm: async () => {
        await api('/forum/reposts/delete', { repostId });
        await refreshFeed();
        toast('Share removed.');
      },
    });
  }

  function openReportDialog(targetType, targetId) {
    openDialog(`Report ${targetType}`, (body) => {
      body.append(textElement(
        'p',
        'lex-dialog-copy',
        'Reports are private and visible only to authorized founder moderators.',
      ));
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = 'Category';
      const category = document.createElement('select');
      [
        ['misinformation', 'Material legal misinformation'],
        ['unsafe_link', 'Unsafe or misleading link'],
        ['harassment', 'Harassment'],
        ['spam', 'Spam'],
        ['privacy', 'Privacy concern'],
        ['other', 'Other'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        category.append(option);
      });
      categoryLabel.append(category);
      const explanationLabel = document.createElement('label');
      explanationLabel.textContent = 'Explanation (optional)';
      const explanation = document.createElement('textarea');
      explanation.maxLength = 1000;
      explanation.rows = 4;
      explanationLabel.append(explanation);
      const actions = document.createElement('div');
      actions.className = 'lex-dialog-actions';
      actions.append(
        button('Cancel', 'lex-button', closeDialog),
        button('Submit report', 'lex-button lex-button-primary', async (event) => {
          const target = event.currentTarget;
          target.disabled = true;
          try {
            await api('/forum/reports', {
              targetType,
              targetId,
              category: category.value,
              explanation: explanation.value,
            });
            closeDialog();
            toast('Report submitted privately for moderation review.');
          } catch (error) {
            target.disabled = false;
            handleError(error);
          }
        }),
      );
      body.append(categoryLabel, explanationLabel, actions);
    });
  }

  function openStablePost(postId) {
    state.directPostId = postId;
    setStableLocation(postId);
    refreshFeed();
  }

  async function publishPost(event) {
    event.preventDefault();
    const body = $('#lex-post-body');
    const source = $('#lex-post-source');
    const submit = $('#lex-post-submit');
    if (!body || !submit) return;
    submit.disabled = true;
    setFeedStatus('Publishing your discussion…');
    try {
      await api('/forum/posts/create', {
        body: body.value,
        sourceUrl: source?.value || '',
      });
      body.value = '';
      if (source) source.value = '';
      updateComposerCounter();
      state.directPostId = null;
      setStableLocation();
      await refreshFeed();
      toast('Post published to Lex Forum.');
      body.focus();
    } catch (error) {
      handleError(error);
    } finally {
      submit.disabled = false;
    }
  }

  function updateComposerCounter() {
    const field = $('#lex-post-body');
    const counter = $('#lex-post-counter');
    if (field && counter) {
      counter.textContent = `${field.value.length.toLocaleString()} / ${postLimit.toLocaleString()}`;
    }
  }

  async function activate() {
    state.active = true;
    setAuthView(true);
    if (!state.loaded) await refreshFeed();
  }

  function bind() {
    $('#lex-composer')?.addEventListener('submit', publishPost);
    $('#lex-post-body')?.addEventListener('input', updateComposerCounter);
    $('#lex-load-more')?.addEventListener('click', () => refreshFeed({ append: true }));
    $('#lex-feed-refresh')?.addEventListener('click', () => {
      if (state.directPostId) {
        state.directPostId = null;
        setStableLocation();
      }
      refreshFeed();
    });
    global.addEventListener('online', () => {
      if (state.active && state.authenticated) refreshFeed();
    });
    global.addEventListener('offline', () => {
      if (state.active) {
        setFeedStatus('You are offline. Existing discussions remain visible until you reconnect.', 'error');
      }
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
      if (pending?.postId) {
        state.directPostId = pending.postId;
        setStableLocation(pending.postId);
      }
      if (state.active || pending || location.hash === '#lex-forum') {
        global.showPage?.('community', state.trigger || $('#spa-community'));
        activate();
      }
    });
  }

  function initialize() {
    if (!config?.workerUrl || !$('#page-community')) return;
    bind();
    state.directPostId = new URLSearchParams(location.search).get('forumPost');
    const requested = location.hash === '#lex-forum' || Boolean(state.directPostId);
    if (hasSession()) {
      setAuthView(true);
      if (requested) open($('#spa-community'));
    } else {
      setAuthView(false);
      if (requested) open($('#spa-community'));
    }
  }

  global.DueDiligenceLexForum = Object.freeze({
    open,
    refresh: () => refreshFeed(),
    state: () => ({
      authenticated: state.authenticated,
      active: state.active,
      loaded: state.loaded,
      itemCount: state.items.length,
    }),
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
