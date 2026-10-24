import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, acknowledgeAnswer, emptyDraft, mergeDrafts, registrationCredential, readOfflineState } from '../public/local-drafts.mjs';

function memoryStorage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }; }
const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Quota'); }, removeItem() {} };
let serial = 0;
const makeStore = (storage = memoryStorage()) => new DraftStore('synthetic-attempt', { storage, indexedDB: null, uuid: () => `mutation-${++serial}` });

test('answers are synchronously journaled before any asynchronous commit', async () => {
  const storage = memoryStorage(), store = makeStore(storage); await store.open();
  const answer = store.write('Q6', 'Recovered Constitutional Law answer');
  assert.equal(JSON.parse(storage.getItem('synthetic-attempt')).answers.Q6.text, answer.text);
  assert.equal(store.pending().length, 1); assert.equal(store.durable, true);
});
test('same-browser reopen returns current question and unsynced answer without a timer reset', async () => {
  const storage = memoryStorage(), store = makeStore(storage); await store.open();
  store.setCurrent(5); store.write('Q6', 'Offline Q6'); store.setMetadata({ attempt: { deadlineAt: 1000 } });
  const resumed = makeStore(storage); await resumed.open();
  assert.equal(resumed.state.current, 5); assert.equal(resumed.state.answers.Q6.text, 'Offline Q6'); assert.equal(resumed.state.metadata.attempt.deadlineAt, 1000);
});
test('old server acknowledgment cannot mark newer writing as synced', async () => {
  const store = makeStore(); await store.open(); const old = store.write('Q1', 'old'); const latest = store.write('Q1', 'new');
  assert.equal(store.acknowledge('Q1', old.mutationId, old.revision, 1), false);
  assert.equal(store.state.answers.Q1.text, 'new'); assert.equal(store.pending().length, 1);
  assert.equal(store.acknowledge('Q1', latest.mutationId, latest.revision, 2), true); assert.equal(store.pending().length, 0);
});
test('refresh cannot overwrite unsynced local text with older server text', async () => {
  const store = makeStore(); await store.open(); store.write('Q1', 'offline');
  store.importServer([{ questionId: 'Q1', revision: 0, text: 'server' }]); assert.equal(store.state.answers.Q1.text, 'offline');
});
test('late GET response cannot roll back an acknowledged newer server answer', async () => {
  const store = makeStore(); await store.open(); const current = store.write('Q1', 'current'); store.acknowledge('Q1', current.mutationId, 3, 3);
  store.importServer([{ questionId: 'Q1', revision: 2, text: 'stale', savedAt: 2 }]); assert.equal(store.state.answers.Q1.text, 'current');
});
test('local revisions increase across typing and server recovery with gaps allowed', async () => {
  const store = makeStore(); await store.open(); store.importServer([{ questionId: 'Q1', revision: 15, text: 'stored' }]);
  assert.equal(store.write('Q1', 'changed').revision, 16); assert.equal(store.write('Q1', 'changed again').revision, 17);
});
test('storage quota failure is truthful and retains the in-memory writing', async () => {
  const store = makeStore(blocked); await store.open(); store.write('Q1', 'important'); await store.tail;
  assert.equal(store.durable, false); assert.equal(store.state.answers.Q1.text, 'important');
});
test('malformed local journal does not crash the examination', async () => {
  const storage = memoryStorage(); storage.setItem('synthetic-attempt', 'malformed'); const store = makeStore(storage); await store.open();
  assert.deepEqual(store.state.answers, {}); store.write('Q1', 'new'); assert.equal(store.durable, true);
});
test('merge recovers latest versions and deduplicates queued events by id', () => {
  const a = emptyDraft(), b = emptyDraft(); a.sequence = 2; b.sequence = 3;
  a.answers.Q1 = { sequence: 2, text: 'first' }; b.answers.Q1 = { sequence: 3, text: 'latest' }; a.answers.Q2 = { sequence: 1, text: 'retained' };
  a.events = [{ eventId: 'same' }]; b.events = [{ eventId: 'same' }, { eventId: 'new' }];
  const result = mergeDrafts(a, b); assert.equal(result.answers.Q1.text, 'latest'); assert.equal(result.answers.Q2.text, 'retained'); assert.equal(result.events.length, 2);
});
test('event retry acknowledgments remove only accepted event ids', async () => {
  const store = makeStore(); await store.open(); const first = store.event('copy', { selectedText: 'known words' }); const second = store.event('paste', { pastedText: 'known paste' });
  store.acknowledgeEvents([first.eventId]); assert.deepEqual(store.state.events.map(event => event.eventId), [second.eventId]); assert.equal(store.state.events[0].detail.pastedText, 'known paste');
});
test('pending manual submission survives reload without manufacturing a receipt', async () => {
  const storage = memoryStorage(), store = makeStore(storage); await store.open(); store.setPendingSubmit(true);
  const reopened = makeStore(storage); await reopened.open(); assert.equal(reopened.state.pendingSubmit, true); assert.equal(reopened.state.receipt, undefined);
});
test('registration credential survives a lost HTTP response and retries exactly', async () => {
  const storage = memoryStorage(), options = { storage, indexedDB: null, uuid: () => 'private-test-credential-32-characters' };
  const first = await registrationCredential('practice', options); const again = await registrationCredential('practice', options);
  assert.deepEqual(first, again); assert.equal(first.durable, true);
});
test('blocked registration storage is reported and cannot claim recoverability', async () => {
  const result = await registrationCredential('practice', { storage: blocked, indexedDB: null, uuid: () => 'memory-only' }); assert.equal(result.durable, false);
});
test('offline snapshot lookup safely handles blocked storage and absent IndexedDB', async () => {
  assert.equal(await readOfflineState('official', { storage: blocked, indexedDB: null }), null);
});
test('missing answer acknowledgment is harmless', () => { assert.equal(acknowledgeAnswer(emptyDraft(), 'missing', 'id', 1, 1), false); });
test('unload journals its events synchronously without starting new storage transactions; cancel resumes normal persistence', async () => {
  const storage = memoryStorage(), store = makeStore(storage); await store.open(); store.write('Q1', 'Preserved answer');
  const before = store.tail; store.beginUnload(); store.event('pagehide', { delivery: 'best-effort' });
  assert.equal(store.tail, before); assert.equal(JSON.parse(storage.getItem('synthetic-attempt')).events[0].category, 'pagehide');
  store.resumePersistence(); store.write('Q1', 'Writing after cancelled navigation'); assert.notEqual(store.tail, before); assert.equal(store.state.answers.Q1.text, 'Writing after cancelled navigation');
});
