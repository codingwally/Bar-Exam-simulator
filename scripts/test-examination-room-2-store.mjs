import assert from 'node:assert/strict';
await import('../assets/examination-room-2-store.js');
const {
  STORE_NAMES,
  createLeaseCoordinator,
  createStore,
  retryDelay,
  sha256Hex,
} = globalThis.DueDiligenceExaminationRoomStore;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeNameList {
  constructor(readNames) {
    this.readNames = readNames;
  }

  contains(name) {
    return this.readNames().includes(name);
  }

  *[Symbol.iterator]() {
    yield* this.readNames();
  }
}

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class FakeStoreData {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.records = new Map();
    this.indexes = new Map();
  }

  copy() {
    const copied = new FakeStoreData(this.name, this.keyPath);
    copied.records = new Map([...this.records].map(([key, value]) => [key, clone(value)]));
    copied.indexes = new Map(this.indexes);
    return copied;
  }
}

class FakeObjectStore {
  constructor(transaction, data) {
    this.transaction = transaction;
    this.data = data;
    this.keyPath = data.keyPath;
    this.indexNames = new FakeNameList(() => [...data.indexes.keys()]);
  }

  createIndex(name, keyPath, options = {}) {
    this.data.indexes.set(name, { keyPath, ...options });
    return {};
  }

  get(key) {
    return this.transaction.request(() => clone(this.data.records.get(key)));
  }

  getAll() {
    return this.transaction.request(() => [...this.data.records.values()].map(clone));
  }

  put(value) {
    return this.transaction.request(() => {
      if (this.transaction.database.factory.consumePutFailure(this.data.name)) {
        throw new Error(`Injected ${this.data.name} put failure`);
      }
      const copied = clone(value);
      const key = copied[this.keyPath];
      if (key == null) throw new Error(`Missing key path ${this.keyPath}`);
      this.data.records.set(key, copied);
      return key;
    });
  }

  delete(key) {
    return this.transaction.request(() => {
      this.data.records.delete(key);
      return undefined;
    });
  }
}

class FakeUpgradeTransaction {
  constructor(database) {
    this.database = database;
  }

  objectStore(name) {
    return new FakeObjectStore(this, this.database.stores.get(name));
  }

  request(work) {
    const request = new FakeRequest();
    try {
      request.result = work();
    } catch (error) {
      request.error = error;
    }
    return request;
  }
}

class FakeTransaction {
  constructor(database, names, mode) {
    this.database = database;
    this.names = names;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.pending = 0;
    this.aborted = false;
    this.completed = false;
    this.data = new Map(names.map((name) => {
      const source = database.stores.get(name);
      if (!source) throw new Error(`Unknown object store: ${name}`);
      return [name, source.copy()];
    }));
    this.scheduleCompletion();
  }

  objectStore(name) {
    if (!this.data.has(name)) throw new Error(`Store ${name} is outside this transaction`);
    return new FakeObjectStore(this, this.data.get(name));
  }

  request(work) {
    if (this.completed || this.aborted) throw new Error('Transaction is inactive');
    const request = new FakeRequest();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        request.result = work();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        this.error = error;
        request.onerror?.({ target: request });
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    return request;
  }

  scheduleCompletion() {
    setTimeout(() => {
      if (this.pending || this.aborted || this.completed) return;
      this.completed = true;
      if (this.mode === 'readwrite') {
        for (const [name, data] of this.data) this.database.stores.set(name, data);
      }
      this.oncomplete?.();
    }, 0);
  }

  abort() {
    if (this.completed || this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
}

class FakeDatabase {
  constructor(name, factory) {
    this.name = name;
    this.factory = factory;
    this.version = 0;
    this.stores = new Map();
    this.objectStoreNames = new FakeNameList(() => [...this.stores.keys()]);
    this.onversionchange = null;
    this.closed = false;
    this.upgradeTransaction = null;
  }

  createObjectStore(name, options) {
    const data = new FakeStoreData(name, options.keyPath);
    this.stores.set(name, data);
    return new FakeObjectStore(this.upgradeTransaction, data);
  }

  transaction(names, mode = 'readonly') {
    if (this.closed) throw new Error('Database is closed');
    const normalized = Array.isArray(names) ? names : [names];
    return new FakeTransaction(this, normalized, mode);
  }

  close() {
    this.closed = true;
  }
}

class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
    this.failureStore = null;
  }

  failNextPut(storeName) {
    this.failureStore = storeName;
  }

  consumePutFailure(storeName) {
    if (this.failureStore !== storeName) return false;
    this.failureStore = null;
    return true;
  }

  open(name, version) {
    const request = new FakeRequest();
    request.transaction = null;
    request.onupgradeneeded = null;
    request.onblocked = null;
    setTimeout(() => {
      try {
        let database = this.databases.get(name);
        if (!database) {
          database = new FakeDatabase(name, this);
          this.databases.set(name, database);
        }
        database.closed = false;
        request.result = database;
        if (database.version < version) {
          const upgrade = new FakeUpgradeTransaction(database);
          database.upgradeTransaction = upgrade;
          request.transaction = upgrade;
          database.version = version;
          request.onupgradeneeded?.({ oldVersion: 0, newVersion: version, target: request });
          database.upgradeTransaction = null;
        }
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      }
    }, 0);
    return request;
  }
}

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    const members = FakeBroadcastChannel.channels.get(name) || new Set();
    members.add(this);
    FakeBroadcastChannel.channels.set(name, members);
  }

  postMessage(message) {
    const members = FakeBroadcastChannel.channels.get(this.name) || new Set();
    for (const member of members) {
      if (member === this || member.closed) continue;
      queueMicrotask(() => member.onmessage?.({ data: clone(message) }));
    }
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

assert.equal(
  sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'content hashes must be portable SHA-256 values',
);
assert.equal(retryDelay(0, { baseMs: 1_000, capMs: 8_000, random: () => 0.5 }), 500);
assert.equal(retryDelay(10, { baseMs: 1_000, capMs: 8_000, random: () => 1 }), 8_000);
assert.equal(retryDelay(0, { baseMs: 1_000, random: () => 0 }), 100, 'retry floor prevents a hot loop');

const unavailable = createStore({ indexedDB: null });
assert.deepEqual(await unavailable.init(), {
  available: false,
  code: 'indexeddb_unavailable',
  message: 'This browser does not provide IndexedDB.',
});
await assert.rejects(
  unavailable.saveAnswer({}),
  (error) => error.code === 'invalid_input',
  'input validation remains deterministic when storage is unavailable',
);

let currentTime = 10_000;
let nextId = 1;
const indexedDB = new FakeIndexedDB();
const store = createStore({
  indexedDB,
  databaseName: 'exam-room-store-test',
  now: () => currentTime,
  idFactory: () => `id-${nextId++}`,
  receiptRetentionMs: 1_000,
});
assert.deepEqual(await store.init(), {
  available: true,
  code: 'ready',
  message: 'Secure local exam storage is ready.',
});
assert.equal(Object.keys(STORE_NAMES).length, 9);
const deviceInstanceHash = await store.getDeviceInstanceHash();
assert.match(deviceInstanceHash, /^[0-9a-f]{64}$/);
assert.equal(await store.getDeviceInstanceHash(), deviceInstanceHash, 'the opaque device identifier remains stable in IndexedDB');

const scope = {
  examId: 'exam-1',
  examVersionId: 'version-7',
  attemptId: 'attempt-3',
  sessionEpoch: 'epoch-a',
};
const savedFlags = await store.saveQuestionFlags({
  ...scope,
  questionIds: ['question-1', 'question-2', 'question-1'],
});
assert.deepEqual(savedFlags.questionIds, ['question-1', 'question-2']);
assert.deepEqual(await store.getQuestionFlags(scope), ['question-1', 'question-2'],
  'question flags survive a same-session reload on the same device');
assert.deepEqual(await store.getQuestionFlags({ ...scope, sessionEpoch: 'epoch-b' }), ['question-1', 'question-2'],
  'question flags remain attached to the attempt across an authorized session transfer');
const firstInput = {
  ...scope,
  questionId: 'question-1',
  content: 'The first local answer.',
  baseRevision: 0,
  operationId: 'operation-stable-1',
};
const first = await store.saveAnswer(firstInput);
assert.equal(first.created, true);
assert.equal(first.operation.localSequence, 1);
assert.equal(first.operation.contentHash, sha256Hex(firstInput.content));
assert.equal((await store.getPendingOperations()).length, 1);
assert.equal((await store.getPendingOperations())[0].content, firstInput.content);

const duplicate = await store.saveAnswer(firstInput);
assert.equal(duplicate.created, false, 'replaying an operation ID is idempotent');
assert.equal(duplicate.operation.localSequence, 1);
await assert.rejects(
  store.saveAnswer({ ...firstInput, content: 'Different content.' }),
  (error) => error.code === 'operation_id_collision',
);

currentTime += 100;
const second = await store.saveAnswer({
  ...scope,
  questionId: 'question-1',
  content: 'A revised local answer.',
  baseRevision: 1,
});
const otherQuestion = await store.saveAnswer({
  ...scope,
  questionId: 'question-2',
  content: 'Answer two.',
  baseRevision: 0,
});
assert.equal(second.operation.localSequence, 2);
assert.equal(otherQuestion.operation.localSequence, 3);
const latest = await store.getLatestAnswers(scope);
assert.equal(latest.length, 2);
assert.equal(latest.find((answer) => answer.questionId === 'question-1').content, 'A revised local answer.');
assert.deepEqual(
  (await store.getAnswerHistory({ ...scope, questionId: 'question-1' })).map((item) => item.localSequence),
  [1, 2],
  'history retains overwritten local revisions for recovery',
);

const acknowledgement = await store.acknowledgeOperation({
  operationId: second.operation.operationId,
  serverRevision: 2,
});
assert.equal(acknowledgement.serverRevision, 2);
assert.equal(
  (await store.getLatestAnswers(scope)).find((answer) => answer.questionId === 'question-1').state,
  'server_acknowledged',
);

const retried = await store.markOperationAttempt(otherQuestion.operation.operationId, {
  baseMs: 1_000,
  capMs: 10_000,
  random: () => 0.5,
  errorCode: 'offline',
});
assert.equal(retried.retryCount, 1);
assert.equal(retried.nextAttemptAt, currentTime + 500);
assert.equal(retried.lastErrorCode, 'offline');
const outageAnnotated = await store.markOperationAttempt(first.operation.operationId, {
  baseMs: 1_000,
  random: () => 0.5,
  errorCode: 'network_error',
  offlineSince: first.operation.clientSavedAt,
  outageEvidence: { clientReportedTransportFailure: true },
});
assert.equal(outageAnnotated.offlineSince, first.operation.clientSavedAt);
assert.deepEqual(outageAnnotated.outageEvidence, { clientReportedTransportFailure: true });
await assert.rejects(
  store.markOperationAttempt(first.operation.operationId, {
    offlineSince: first.operation.clientSavedAt + 1,
  }),
  (error) => error.code === 'invalid_input',
  'a retry cannot backfill an outage that begins after the local answer save',
);

const conflict = await store.recordConflict({
  operationId: otherQuestion.operation.operationId,
  serverRevision: 4,
  serverContent: 'A server-side branch.',
});
assert.equal(conflict.localOperation.content, 'Answer two.');
assert.equal(conflict.serverContent, 'A server-side branch.');
assert.equal((await store.listConflicts(scope)).length, 1);
assert.equal(
  (await store.getPendingOperations({ availableAt: Number.MAX_SAFE_INTEGER }))
    .some((operation) => operation.operationId === otherQuestion.operation.operationId),
  false,
  'a conflicted operation is retained but cannot retry over the server branch',
);

const recovery = await store.retainRecoverySnapshot(scope, 'connectivity_recovery');
assert.equal(recovery.answers.length, 2);
assert.ok(recovery.operations.some((operation) => operation.state === 'conflict'));
assert.equal((await store.listRecoveries(scope)).length, 1);

const resolutionScope = { ...scope, attemptId: 'attempt-conflict-resolution' };
const resolutionOperation = await store.saveAnswer({
  ...resolutionScope,
  questionId: 'question-resolution',
  content: 'Preserved local branch.',
  baseRevision: 0,
});
const resolvable = await store.recordConflict({
  operationId: resolutionOperation.operation.operationId,
  serverRevision: 3,
  serverContentHash: sha256Hex('Accepted server branch.'),
  serverContent: 'Accepted server branch.',
});
const resolved = await store.resolveConflict({
  conflictId: resolvable.conflictId,
  resolution: 'accept_server',
});
assert.equal(resolved.state, 'resolved');
assert.equal(resolved.resolution, 'accept_server');
assert.equal((await store.getLatestAnswers(resolutionScope))[0].content, 'Accepted server branch.');
assert.equal((await store.getLatestAnswers(resolutionScope))[0].state, 'server_acknowledged');

// A failed queue write must roll back answer content and history with the same transaction.
indexedDB.failNextPut(STORE_NAMES.queue);
await assert.rejects(store.saveAnswer({
  ...scope,
  questionId: 'question-rollback',
  content: 'This transaction must not partially persist.',
}));
assert.equal(
  (await store.getLatestAnswers(scope)).some((answer) => answer.questionId === 'question-rollback'),
  false,
);
assert.equal(
  (await store.getAnswerHistory(scope)).some((operation) => operation.questionId === 'question-rollback'),
  false,
);

const intentOne = await store.ensureSubmissionIntent(scope, {
  clientPendingAt: currentTime,
  offlineSince: currentTime - 250,
  outageEvidence: { clientReportedOffline: true },
});
const intentTwo = await store.ensureSubmissionIntent(scope);
assert.equal(intentOne.created, true);
assert.equal(intentTwo.created, false);
assert.equal(intentOne.intent.intentId, intentTwo.intent.intentId, 'submission retries use one stable intent');
assert.equal(intentOne.intent.payloadHash, intentTwo.intent.payloadHash);
assert.equal(intentOne.intent.clientPendingAt, currentTime);
assert.equal(intentOne.intent.offlineSince, currentTime - 250);
assert.deepEqual(intentOne.intent.outageEvidence, { clientReportedOffline: true });
await assert.rejects(
  store.ensureSubmissionIntent({ ...scope, attemptId: 'attempt-invalid-offline' }, {
    clientPendingAt: currentTime,
    offlineSince: currentTime + 1,
  }),
  (error) => error.code === 'invalid_input',
);
await store.acknowledgeOperation({ operationId: intentOne.intent.intentId });
assert.equal(
  (await store.ensureSubmissionIntent(scope)).intent.state,
  'acknowledged',
  'a submission acknowledgement retains the same intent while awaiting its receipt',
);

const receipt = await store.confirmSubmissionReceipt({
  intentId: intentOne.intent.intentId,
  receiptId: 'receipt-2026-001',
  receiptToken: 'signed-receipt-token',
  submittedAt: currentTime + 20,
  confirmedAt: currentTime + 30,
});
assert.equal(receipt.cleanupEligibleAt, currentTime + 1_030);
assert.deepEqual(
  await store.confirmSubmissionReceipt({
    intentId: intentOne.intent.intentId,
    receiptId: 'receipt-2026-001',
  }),
  receipt,
  'receipt confirmation is idempotent',
);
assert.equal((await store.cleanupConfirmed({ now: currentTime + 1_029 })).purgedCount, 0);
assert.equal((await store.cleanupConfirmed({ now: currentTime + 1_030 })).purgedCount, 1);
assert.equal((await store.getLatestAnswers(scope)).length, 0);
assert.equal((await store.getAnswerHistory(scope)).length, 0);
assert.equal((await store.getReceipt(scope)).contentPurgedAt, currentTime + 1_030);

// A receipt first observed after reload/cron must still bind the attempt to
// bounded local cleanup even when no local submission intent survived.
currentTime += 2_000;
const statusReceiptScope = {
  examId: 'exam-status-receipt',
  examVersionId: 'version-status-receipt',
  attemptId: 'attempt-status-receipt',
  sessionEpoch: 'epoch-status-receipt',
};
await store.saveAnswer({
  ...statusReceiptScope,
  questionId: 'question-status-receipt',
  content: 'Locally retained work learned of its receipt after reload.',
});
await store.saveSessionEnvelope({
  ...statusReceiptScope,
  sessionId: 'session-status-receipt',
  deviceInstanceHash,
  serverDeadline: '2026-08-10T04:00:00.000Z',
  answerSetHash: sha256Hex('status answer set'),
});
await store.saveAttemptBundle({
  ...statusReceiptScope,
  bundle: { ok: true, attemptId: statusReceiptScope.attemptId, questions: [] },
});
assert.equal(
  (await store.getSessionEnvelope(statusReceiptScope.attemptId, deviceInstanceHash)).sessionId,
  'session-status-receipt',
  'a crash-safe session envelope is restored only for the bound device',
);
assert.equal(
  await store.getSessionEnvelope(statusReceiptScope.attemptId, '0'.repeat(64)),
  null,
  'another device cannot recover a retained session bearer',
);
assert.equal(
  (await store.getAttemptBundle(statusReceiptScope.attemptId)).bundle.attemptId,
  statusReceiptScope.attemptId,
  'the last authorized attempt bundle remains available for offline crash recovery',
);
const statusReceipt = await store.reconcileServerReceipt({
  attemptId: statusReceiptScope.attemptId,
  examId: statusReceiptScope.examId,
  examVersionId: statusReceiptScope.examVersionId,
  receiptId: 'receipt-status-observed',
  receivedAt: '2026-08-10T04:01:00.000Z',
  submittedAt: '2026-08-10T04:00:30.000Z',
  snapshotHash: sha256Hex('server snapshot'),
});
assert.equal(statusReceipt.source, 'server_status_observed');
assert.equal(statusReceipt.cleanupEligibleAt, currentTime + 1_000);
assert.equal(
  (await store.reconcileServerReceipt({
    attemptId: statusReceiptScope.attemptId,
    examId: statusReceiptScope.examId,
    examVersionId: statusReceiptScope.examVersionId,
    receiptId: 'receipt-status-observed',
    receivedAt: '2026-08-10T04:01:00.000Z',
  })).receiptId,
  'receipt-status-observed',
  'status receipt reconciliation is idempotent',
);
assert.equal((await store.cleanupConfirmed({ now: currentTime + 999 })).purgedCount, 0);
assert.equal((await store.cleanupConfirmed({ now: currentTime + 1_000 })).purgedCount, 1);
assert.equal((await store.getLatestAnswers(statusReceiptScope)).length, 0);
assert.equal(await store.getAttemptBundle(statusReceiptScope.attemptId), null);
assert.equal(await store.getSessionEnvelope(statusReceiptScope.attemptId, deviceInstanceHash), null);

// Session-epoch replacement preserves a recovery branch and removes stale replay work.
const secondAttempt = { ...scope, attemptId: 'attempt-4' };
await store.saveAnswer({
  ...secondAttempt,
  questionId: 'question-1',
  content: 'Unsynchronized answer from the old epoch.',
});
await store.quarantineSessionEpoch(secondAttempt, 'epoch-b', 'session_reissued');
assert.equal(
  (await store.getPendingOperations({ availableAt: Number.MAX_SAFE_INTEGER }))
    .some((operation) => operation.attemptId === secondAttempt.attemptId),
  false,
);
assert.equal((await store.listRecoveries(secondAttempt)).length, 1);

const recoveryPendingAttempt = { ...scope, attemptId: 'attempt-recovery-pending' };
await store.saveAnswer({
  ...recoveryPendingAttempt,
  questionId: 'question-1',
  content: 'Preserve this after a stale-session response.',
});
await store.quarantineAttemptQueue(recoveryPendingAttempt, 'server_session_stale');
assert.equal(
  (await store.getPendingOperations({ availableAt: Number.MAX_SAFE_INTEGER }))
    .some((operation) => operation.attemptId === recoveryPendingAttempt.attemptId),
  false,
);
assert.equal((await store.listRecoveries(recoveryPendingAttempt)).length, 1);

const noChannel = createLeaseCoordinator({
  attemptId: 'attempt-no-channel',
  examVersionId: 'version-1',
  sessionEpoch: 'epoch-1',
  BroadcastChannel: null,
});
assert.deepEqual(
  (await noChannel.start()).readonly,
  true,
  'missing cross-tab coordination fails safely into read-only mode',
);
noChannel.stop();

const leaseOptions = {
  attemptId: 'attempt-lease',
  examVersionId: 'version-1',
  sessionEpoch: 'epoch-1',
  BroadcastChannel: FakeBroadcastChannel,
  negotiationMs: 5,
  heartbeatMs: 1_000,
  leaseDurationMs: 3_000,
};
const tabA = createLeaseCoordinator({ ...leaseOptions, tabId: 'tab-a' });
const tabB = createLeaseCoordinator({ ...leaseOptions, tabId: 'tab-b' });
await Promise.all([tabA.start(), tabB.start()]);
await wait();
assert.equal(tabA.snapshot().mode, 'writer', 'deterministic tie-breaking gives one tab the write lease');
assert.equal(tabB.snapshot().mode, 'readonly');
assert.equal(tabB.snapshot().ownerTabId, 'tab-a');
assert.equal(tabA.release(), true);
await wait();
assert.equal(tabB.snapshot().ownerTabId, null);
await tabB.requestWrite();
assert.equal(tabB.snapshot().mode, 'writer', 'a reader may safely acquire a released lease');
tabA.stop();
tabB.stop();

store.close();
console.log('Examination Room 2.0 local-first store tests passed.');
