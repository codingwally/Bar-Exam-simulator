(function studyWorkspace(global) {
  'use strict';

  if (global.DueDiligenceStudyWorkspace) return;
  const DB_NAME = 'duediligence-study-v1';
  const STORE = 'items';
  const MAX_ITEMS = 40;
  const MAX_BYTES = 5 * 1024 * 1024;
  const config = global.DueDiligencePhase2Config;
  let activeItem = null;
  let observer = null;

  function userId() {
    return String(global.DueDiligencePhase4?.getSession?.()?.user?.id || '').trim();
  }

  function itemKey(type, id, owner = userId()) {
    return `${owner}:${type}:${id}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('ownerSavedAt', ['ownerUserId', 'savedAt']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transaction(mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try { result = callback(store, tx); } catch (error) { reject(error); return; }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getItem(type, id) {
    const owner = userId();
    if (!owner) return null;
    const db = await openDatabase();
    try {
      return await requestResult(db.transaction(STORE).objectStore(STORE).get(itemKey(type, id, owner)));
    } finally { db.close(); }
  }

  async function putItem(item) {
    await transaction('readwrite', (store) => store.put(item));
    await enforceBounds(item.ownerUserId);
  }

  async function allForOwner(ownerUserId) {
    const db = await openDatabase();
    try {
      const rows = await requestResult(db.transaction(STORE).objectStore(STORE).getAll());
      return rows.filter((row) => row.ownerUserId === ownerUserId);
    } finally { db.close(); }
  }

  async function enforceBounds(ownerUserId) {
    const rows = (await allForOwner(ownerUserId)).sort((a, b) => b.savedAt - a.savedAt);
    let bytes = 0;
    const remove = [];
    rows.forEach((row, index) => {
      const size = new Blob([JSON.stringify(row)]).size;
      bytes += size;
      if (index >= MAX_ITEMS || bytes > MAX_BYTES) remove.push(row.key);
    });
    if (remove.length) await transaction('readwrite', (store) => remove.forEach((key) => store.delete(key)));
  }

  async function purgeOwner(ownerUserId) {
    if (!ownerUserId) return;
    const rows = await allForOwner(ownerUserId);
    if (rows.length) await transaction('readwrite', (store) => rows.forEach((row) => store.delete(row.key)));
  }

  function safeSourceUrls(root) {
    return [...root.querySelectorAll('a[href]')].map((link) => {
      try {
        const url = new URL(link.href);
        return url.protocol === 'https:' && !url.username && !url.password
          ? { title: link.textContent.trim().slice(0, 180), url: url.href } : null;
      } catch { return null; }
    }).filter(Boolean).slice(0, 12);
  }

  function snapshot(definition) {
    const root = definition.root;
    return {
      type: definition.type,
      id: String(definition.id).slice(0, 240),
      title: String(definition.title || 'Study item').trim().slice(0, 300),
      text: String(root?.innerText || '').trim().slice(0, 120000),
      sources: safeSourceUrls(root),
    };
  }

  async function api(path, body) {
    const payload = await global.DueDiligencePhase4?.request?.(path, { body });
    return payload?.data;
  }

  function dialog() {
    let element = document.getElementById('dd-study-notes-dialog');
    if (element) return element;
    element = document.createElement('dialog');
    element.id = 'dd-study-notes-dialog';
    element.className = 'dd-study-notes-dialog';
    document.body.append(element);
    return element;
  }

  async function reconcileRemote(definition, stored) {
    if (!navigator.onLine || !userId()) return stored;
    try {
      const result = await api('/study/annotations/query', {
        resourceType: definition.type,
        resourceId: definition.id,
      });
      const server = Array.isArray(result?.annotations) ? result.annotations[0] : null;
      if (!server) return stored;
      const serverRevision = Number(server.revision) || 0;
      if (stored?.dirty) {
        const isSameVersion = serverRevision === (Number(stored.revision) || 0)
          && String(server.noteText || '') === String(stored.noteText || '')
          && String(server.selectedText || '') === String(stored.selectedText || '');
        if (isSameVersion) {
          const reconciled = { ...stored, dirty: false, conflict: null };
          await putItem(reconciled);
          return reconciled;
        }
        const conflicted = { ...stored, conflict: { local: stored.noteText || '', server } };
        await putItem(conflicted);
        return conflicted;
      }
      const restored = {
        ...(stored || {}),
        ...definition,
        key: itemKey(definition.type, definition.id),
        ownerUserId: userId(),
        noteText: String(server.noteText || ''),
        selectedText: String(server.selectedText || ''),
        revision: serverRevision,
        updatedAt: server.updatedAt || new Date().toISOString(),
        dirty: false,
        conflict: null,
        savedOffline: true,
        savedAt: Date.now(),
      };
      delete restored.root;
      await putItem(restored);
      return restored;
    } catch {
      return stored;
    }
  }

  async function openNotes(definition) {
    if (!userId()) {
      global.DueDiligencePhase4?.openSignIn?.({ routeBound: true });
      return;
    }
    activeItem = snapshot(definition);
    let stored = await getItem(activeItem.type, activeItem.id);
    stored = await reconcileRemote(activeItem, stored);
    if (!stored) {
      stored = {
        key: itemKey(activeItem.type, activeItem.id),
        ownerUserId: userId(),
        ...activeItem,
        noteText: '', selectedText: '', revision: 0, dirty: false,
        savedAt: Date.now(),
      };
    }
    const element = dialog();
    element.innerHTML = `<form method="dialog" class="dd-study-notes-shell">
      <button class="dd-study-notes-close" type="button" data-study-close aria-label="Close study notes">&times;</button>
      <p class="dd-study-eyebrow">Private study workspace</p>
      <h2>${escapeHtml(stored.title)}</h2>
      <p class="dd-study-copy">Save this opened study item on this device and attach a private note. It syncs to your account when online.</p>
      <label><span>Your note</span><textarea id="dd-study-note" maxlength="12000" placeholder="Add a concise private note…">${escapeHtml(stored.noteText || '')}</textarea></label>
      <p class="dd-study-sync" id="dd-study-sync" role="status">${stored.savedOffline ? 'Available offline' : 'Not yet saved offline'}</p>
      <div class="dd-study-note-actions">
        ${stored.savedOffline ? '<button class="dd-study-delete" type="button" data-study-delete>Delete note and offline copy</button>' : ''}
        <button type="button" data-study-close>Back</button>
        <button class="dd-study-primary" type="button" data-study-save>Save for offline</button>
      </div>
    </form>`;
    element.querySelectorAll('[data-study-close]').forEach((button) => button.addEventListener('click', () => element.close()));
    element.querySelector('[data-study-save]')?.addEventListener('click', () => saveNotes(stored));
    element.querySelector('[data-study-delete]')?.addEventListener('click', (event) => requestDeleteNotes(event.currentTarget, stored));
    element.showModal();
    if (stored.conflict?.server) {
      document.getElementById('dd-study-sync').textContent = 'A newer version exists on another device. Both versions were preserved.';
      showConflictChoices(stored, stored.conflict.server);
    }
  }

  async function saveNotes(stored) {
    const status = document.getElementById('dd-study-sync');
    const noteText = String(document.getElementById('dd-study-note')?.value || '');
    const local = {
      ...stored, ...activeItem, key: itemKey(activeItem.type, activeItem.id), ownerUserId: userId(),
      noteText, dirty: true, savedOffline: true, savedAt: Date.now(),
    };
    await putItem(local);
    if (status) status.textContent = navigator.onLine ? 'Syncing…' : 'Offline — changes will sync';
    if (!navigator.onLine) return;
    try {
      const result = await api('/study/annotations/command', {
        operation: 'save', resourceType: local.type, resourceId: local.id,
        noteText, selectedText: local.selectedText || null,
        expectedRevision: Number(local.revision) || 0,
      });
      if (result?.conflict) {
        local.conflict = { local: noteText, server: result.server };
        local.dirty = true;
        await putItem(local);
        if (status) status.textContent = 'A newer version exists on another device. Both versions were preserved.';
        showConflictChoices(local, result.server);
        return;
      }
      local.revision = Number(result?.revision) || local.revision;
      local.updatedAt = result?.updatedAt || new Date().toISOString();
      local.dirty = false;
      local.conflict = null;
      await putItem(local);
      if (status) status.textContent = 'Available offline · Saved to Due Diligence';
      refreshToolStatus(local.type, local.id, true);
    } catch {
      if (status) status.textContent = 'Saved on this device · Sync will retry';
    }
  }

  function showConflictChoices(local, server) {
    const actions = dialog().querySelector('.dd-study-note-actions');
    if (!actions || actions.querySelector('[data-study-keep-local]')) return;
    const keepServer = document.createElement('button');
    keepServer.type = 'button'; keepServer.textContent = 'Use newer server note';
    keepServer.addEventListener('click', async () => {
      local.noteText = server.noteText || ''; local.revision = Number(server.revision) || 0;
      local.dirty = false; local.conflict = null; await putItem(local);
      document.getElementById('dd-study-note').value = local.noteText;
      document.getElementById('dd-study-sync').textContent = 'Available offline · Newer version restored';
      keepServer.remove(); keepLocal.remove();
    });
    const keepLocal = document.createElement('button');
    keepLocal.type = 'button'; keepLocal.dataset.studyKeepLocal = 'true'; keepLocal.textContent = 'Keep this device version';
    keepLocal.addEventListener('click', async () => {
      local.revision = Number(server.revision) || 0;
      await saveNotes(local);
      keepServer.remove(); keepLocal.remove();
    });
    actions.prepend(keepServer, keepLocal);
  }

  function requestDeleteNotes(button, stored) {
    if (button.dataset.confirmDelete !== 'true') {
      button.dataset.confirmDelete = 'true';
      button.textContent = 'Yes, delete this note';
      button.setAttribute('aria-label', 'Confirm deletion of this private note and offline copy');
      document.getElementById('dd-study-sync').textContent = 'Delete this private note and its offline copy? Choose Back to keep it.';
      return;
    }
    deleteNotes(stored);
  }

  async function deleteNotes(stored) {
    try {
      if (stored.revision > 0 && navigator.onLine) await api('/study/annotations/command', {
        operation: 'delete', resourceType: stored.type, resourceId: stored.id,
        expectedRevision: stored.revision,
      });
      await transaction('readwrite', (store) => store.delete(stored.key));
      refreshToolStatus(stored.type, stored.id, false);
      dialog().close();
    } catch {
      document.getElementById('dd-study-sync').textContent = 'Could not delete because a newer version exists.';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function refreshToolStatus(type, id, available) {
    document.querySelectorAll(`[data-study-type="${CSS.escape(type)}"][data-study-id="${CSS.escape(id)}"]`)
      .forEach((button) => { button.textContent = available ? 'Available offline · Study notes' : 'Save offline · Study notes'; });
  }

  async function mount(definition) {
    if (!definition?.root || !definition.id || definition.root.querySelector(':scope > .dd-study-tools')) return;
    const controls = document.createElement('div');
    controls.className = 'dd-study-tools';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'dd-study-tools-button';
    button.dataset.studyType = definition.type; button.dataset.studyId = String(definition.id);
    const stored = await getItem(definition.type, definition.id).catch(() => null);
    button.textContent = stored?.savedOffline ? 'Available offline · Study notes' : 'Save offline · Study notes';
    button.addEventListener('click', () => openNotes(definition));
    controls.append(button);
    definition.root.prepend(controls);
  }

  function discover() {
    document.querySelectorAll('[data-study-resource-type][data-study-resource-id]').forEach((root) => mount({
      root, type: root.dataset.studyResourceType, id: root.dataset.studyResourceId,
      title: root.querySelector('.dd-question-prompt, h2, h3')?.textContent || 'Subject Matter study item',
    }));
    const page = String(location.hash || '');
    if (page.includes('chair') || page.includes('anchor')) {
      document.querySelectorAll('#dd26-app article.dd26-pane').forEach((root) => {
        const title = root.querySelector('.dd26-case-title')?.textContent?.trim();
        if (title) mount({ root, type: page.includes('chair') ? 'chair_case' : 'anchor_case', id: title, title });
      });
    }
    document.querySelectorAll('#dd26-doctrine-result .dd26-result').forEach((root) => {
      const title = document.querySelector('.dd26-prompt')?.textContent?.trim();
      if (title) mount({ root, type: 'doctrine', id: title, title });
    });
  }

  async function syncDirty() {
    if (!navigator.onLine || !userId()) return;
    const rows = await allForOwner(userId());
    for (const row of rows.filter((item) => item.dirty && !item.conflict)) {
      try {
        const result = await api('/study/annotations/command', {
          operation: 'save', resourceType: row.type, resourceId: row.id,
          noteText: row.noteText || '', selectedText: row.selectedText || null,
          expectedRevision: Number(row.revision) || 0,
        });
        if (result?.conflict) {
          row.conflict = { local: row.noteText || '', server: result.server };
        } else {
          row.revision = Number(result?.revision) || row.revision;
          row.updatedAt = result?.updatedAt || new Date().toISOString();
          row.dirty = false;
        }
        await putItem(row);
      } catch {}
    }
  }

  function initialize() {
    observer = new MutationObserver(discover);
    observer.observe(document.body, { childList: true, subtree: true });
    discover();
    global.addEventListener('online', syncDirty);
    global.DueDiligencePrivateWorkspace?.registerReset?.(({ previousUserId }) => {
      activeItem = null;
      dialog().open && dialog().close();
      if (previousUserId) purgeOwner(previousUserId).catch(() => {});
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/service-worker.js?v=header-subject-review-20260814-1').catch(() => {});
    }
  }

  global.DueDiligenceStudyWorkspace = Object.freeze({ discover, openNotes, purgeOwner });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}(window));
