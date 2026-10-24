/* A synchronous recovery journal protects the interval before IndexedDB commits.
 * IndexedDB stores every answer revision. No answer is removed on a network error. */
export const LOCAL_SCHEMA = 1;
export const emptyDraft = () => ({ schema: LOCAL_SCHEMA, sequence: 0, current: 0, answers: {}, events: [], pendingSubmit: false });
export function mergeDrafts(left = emptyDraft(), right = emptyDraft()) {
  const newer = left.sequence > right.sequence ? left : right;
  const result = { ...newer, answers: {}, events: [], sequence: Math.max(left.sequence || 0, right.sequence || 0) };
  for (const id of new Set([...Object.keys(left.answers || {}), ...Object.keys(right.answers || {})])) {
    const a = left.answers?.[id], b = right.answers?.[id];
    result.answers[id] = !a ? b : !b ? a : a.sequence > b.sequence ? a : b;
  }
  result.events = [...new Map([...(left.events || []), ...(right.events || [])].map(event => [event.eventId, event])).values()];
  return result;
}
export function acknowledgeAnswer(state, id, mutationId, serverRevision, savedAt) {
  const current = state.answers[id];
  // An older response may acknowledge its own revision, but never newer typing.
  if (!current || current.mutationId !== mutationId) return false;
  current.acknowledged = true;
  current.serverRevision = serverRevision;
  current.savedAt = savedAt;
  return true;
}
const copy = value => JSON.parse(JSON.stringify(value));
export class DraftStore {
  constructor(key, { storage = globalThis.localStorage, indexedDB = globalThis.indexedDB, uuid = () => globalThis.crypto.randomUUID(), onStatus = () => {} } = {}) {
    this.key = key; this.storage = storage; this.indexedDB = indexedDB; this.uuid = uuid; this.onStatus = onStatus;
    this.state = emptyDraft(); this.db = null; this.tail = Promise.resolve(); this.localAvailable = false; this.idbAvailable = false; this.journalSequence = -1; this.idbSequence = -1;
  }
  async open() {
    this.suspending = false;
    let journal = emptyDraft();
    try {
      const raw = this.storage.getItem(this.key);
      if (raw) { const parsed = JSON.parse(raw); if (parsed.schema === LOCAL_SCHEMA) { journal = parsed; this.journalSequence = parsed.sequence; } }
      this.storage.setItem(`${this.key}:probe`, '1'); this.storage.removeItem(`${this.key}:probe`); this.localAvailable = true;
    } catch { this.localAvailable = false; }
    try {
      if (!this.indexedDB) throw new Error('Unavailable');
      this.db = await new Promise((resolve, reject) => {
        const request = this.indexedDB.open('due-diligence-exam-drafts-v1', LOCAL_SCHEMA);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('states')) request.result.createObjectStore('states');
          if (!request.result.objectStoreNames.contains('revisions')) request.result.createObjectStore('revisions', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Browser storage is busy'));
      });
      const saved = await new Promise((resolve, reject) => {
        const request = this.db.transaction('states').objectStore('states').get(this.key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      this.state = mergeDrafts(this.state, mergeDrafts(saved?.schema === LOCAL_SCHEMA ? saved : emptyDraft(), journal));
      this.idbSequence = saved?.sequence ?? -1;
      this.idbAvailable = true;
      this.db.onversionchange = () => { this.db.close(); this.idbAvailable = false; this.report(); };
    } catch { this.state = mergeDrafts(this.state, journal); this.idbAvailable = false; }
    this.report(); return this.state;
  }
  report() { this.onStatus({ localAvailable: this.localAvailable, idbAvailable: this.idbAvailable }); }
  persist(revision) {
    const snapshot = copy(this.state);
    try { this.storage.setItem(this.key, JSON.stringify(snapshot)); this.localAvailable = true; this.journalSequence = snapshot.sequence; } catch { this.localAvailable = false; }
    // Navigation events use the synchronous journal. Starting new IndexedDB
    // transactions during unload can delay the next document in some browsers.
    if (this.suspending) { this.report(); return this.tail; }
    // Serialize transactions and capture snapshots now: a slow previous write can
    // never overwrite a later state with its stale object reference.
    this.tail = this.tail.then(() => new Promise(resolve => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(['states', 'revisions'], 'readwrite');
        tx.objectStore('states').put(snapshot, this.key);
        if (revision) tx.objectStore('revisions').put({ ...revision, key: `${this.key}:${revision.mutationId}`, attemptKey: this.key });
        tx.oncomplete = () => { this.idbAvailable = true; this.idbSequence = Math.max(this.idbSequence, snapshot.sequence); this.report(); resolve(true); };
        tx.onerror = tx.onabort = () => { this.idbAvailable = false; this.report(); resolve(false); };
      } catch { this.idbAvailable = false; this.report(); resolve(false); }
    }));
    this.report(); return this.tail;
  }
  write(questionId, text, serverRevision = 0, editedAt = new Date().toISOString()) {
    const previous = this.state.answers[questionId];
    const answer = { questionId, text, sequence: ++this.state.sequence, mutationId: this.uuid(), editedAt, revision: Math.max(previous?.revision || 0, previous?.serverRevision || 0, serverRevision) + 1, baseRevision: previous?.serverRevision ?? previous?.baseRevision ?? serverRevision, acknowledged: false };
    this.state.answers[questionId] = answer;
    this.persist(answer); return answer;
  }
  acknowledge(id, mutationId, serverRevision, savedAt) {
    if (acknowledgeAnswer(this.state, id, mutationId, serverRevision, savedAt)) { this.persist(); return true; }
    return false;
  }
  importServer(answers) {
    for (const item of answers || []) {
      const old = this.state.answers[item.questionId];
      if (old && !old.acknowledged) continue;
      if (old && (old.serverRevision || old.revision || 0) > item.revision) continue;
      this.state.answers[item.questionId] = { questionId: item.questionId, text: item.text || '', sequence: ++this.state.sequence, mutationId: item.mutationId || this.uuid(), revision: item.revision, serverRevision: item.revision, baseRevision: item.revision, savedAt: item.savedAt, acknowledged: true };
    }
    this.persist();
  }
  rebase(id, revision) { if (this.state.answers[id]) { this.state.answers[id].baseRevision = revision; this.persist(); } }
  setCurrent(current) { this.state.current = current; this.state.sequence++; this.persist(); }
  setMetadata(metadata) { this.state.metadata = metadata; this.state.sequence++; this.persist(); }
  setPendingSubmit(value) { this.state.pendingSubmit = value; this.state.sequence++; this.persist(); }
  event(category, detail = {}, questionId = null) {
    const event = { eventId: this.uuid(), category, clientTime: new Date().toISOString(), questionId, detail, provenance: 'browser-observed' };
    this.state.events.push(event); this.state.sequence++; this.persist(); return event;
  }
  acknowledgeEvents(ids) { const accepted = new Set(ids); this.state.events = this.state.events.filter(event => !accepted.has(event.eventId)); this.state.sequence++; this.persist(); }
  pending() { return Object.values(this.state.answers).filter(answer => !answer.acknowledged); }
  get durable() { return this.localAvailable || this.idbAvailable; }
  get persisted() { return Math.max(this.journalSequence, this.idbSequence) >= this.state.sequence; }
  beginUnload() { this.suspending = true; }
  resumePersistence() { this.suspending = false; }
  close() { this.db?.close(); this.db = null; this.idbAvailable = false; }
}

export async function readOfflineState(slug, { storage = null, indexedDB = globalThis.indexedDB } = {}) {
  let journal = null;
  try { journal = JSON.parse(storage?.getItem(`dd-exam:${slug}:resume`) || 'null'); } catch { /* Try IndexedDB. */ }
  try {
    if (!indexedDB) return journal;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('due-diligence-exam-drafts-v1', LOCAL_SCHEMA);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('states');
        request.result.createObjectStore('revisions', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Busy'));
    });
    if (!db.objectStoreNames.contains('states')) { db.close(); return journal; }
    const states = await new Promise((resolve, reject) => {
      const request = db.transaction('states').objectStore('states').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close();
    return [journal, ...states.map(state => state.metadata)].filter(value => value?.exam?.slug === slug && value?.attempt).sort((a, b) => b.cachedAt - a.cachedAt)[0] || null;
  } catch { return journal; }
}

// A stable, browser-private registration key makes a retried registration safe
// even when the first HTTP response (including its session cookie) is lost.
export async function registrationCredential(slug, { storage = null, indexedDB = globalThis.indexedDB, uuid = () => crypto.randomUUID() } = {}) {
  const key = `dd-exam:${slug}:registration`;
  let known; try { known = storage?.getItem(key); } catch { /* IndexedDB can work independently. */ }
  try {
    if (!indexedDB) throw new Error('Unavailable');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('due-diligence-exam-registration-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('registrations');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Busy'));
    });
    const id = await new Promise((resolve, reject) => {
      const tx = db.transaction('registrations', 'readwrite'), store = tx.objectStore('registrations');
      const request = store.get(slug); let id;
      request.onsuccess = () => { id = request.result || known || uuid(); if (!request.result) store.put(id, slug); };
      tx.oncomplete = () => resolve(id); tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close(); try { storage?.setItem(key, id); } catch { /* IndexedDB is durable. */ }
    return { id, durable: true };
  } catch {
    const id = known || uuid();
    try { if (!storage) throw new Error('Unavailable'); storage.setItem(key, id); return { id, durable: true }; } catch { return { id, durable: false }; }
  }
}
