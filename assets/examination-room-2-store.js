(function exposeExaminationRoom2Store(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DueDiligenceExaminationRoomStore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildExaminationRoom2Store() {
  'use strict';

  const DATABASE_NAME = 'duediligence.examination-room.2';
  const DATABASE_VERSION = 1;
  const STORE_NAMES = Object.freeze({
    answers: 'answers',
    operations: 'operations',
    queue: 'queue',
    submissions: 'submissions',
    acknowledgements: 'acknowledgements',
    conflicts: 'conflicts',
    recoveries: 'recoveries',
    receipts: 'receipts',
    meta: 'meta',
  });
  const ALL_STORES = Object.freeze(Object.values(STORE_NAMES));
  const DEFAULT_MAX_CONTENT_BYTES = 1024 * 1024;
  const DEFAULT_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_QUEUE_BATCH = 250;

  class StoreError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'ExaminationRoomStoreError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  function safeClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function assertString(value, field, maximum = 512) {
    const normalized = String(value == null ? '' : value).trim();
    if (!normalized) throw new StoreError('invalid_input', `${field} is required.`);
    if (normalized.length > maximum) {
      throw new StoreError('invalid_input', `${field} exceeds ${maximum} characters.`);
    }
    return normalized;
  }

  function normalizeScope(input, requireQuestion) {
    if (!input || typeof input !== 'object') {
      throw new StoreError('invalid_input', 'An examination scope is required.');
    }
    const scope = {
      examId: assertString(input.examId, 'examId'),
      examVersionId: assertString(input.examVersionId, 'examVersionId'),
      attemptId: assertString(input.attemptId, 'attemptId'),
      sessionEpoch: assertString(input.sessionEpoch, 'sessionEpoch', 128),
    };
    if (requireQuestion) scope.questionId = assertString(input.questionId, 'questionId');
    return scope;
  }

  function makeKey(parts) {
    return JSON.stringify(parts.map((part) => String(part)));
  }

  function attemptKey(scope) {
    return makeKey([scope.examId, scope.examVersionId, scope.attemptId]);
  }

  function epochKey(scope) {
    return makeKey([scope.examId, scope.examVersionId, scope.attemptId, scope.sessionEpoch]);
  }

  function answerKey(scope) {
    return makeKey([
      scope.examId,
      scope.examVersionId,
      scope.attemptId,
      scope.questionId,
      scope.sessionEpoch,
    ]);
  }

  function intentKey(scope) {
    return makeKey([
      scope.examId,
      scope.examVersionId,
      scope.attemptId,
      scope.sessionEpoch,
      'final-submission',
    ]);
  }

  function utf8Bytes(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value);
    const encoded = unescape(encodeURIComponent(value));
    const bytes = new Uint8Array(encoded.length);
    for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
    return bytes;
  }

  // Small dependency-free SHA-256 implementation keeps hashes deterministic in browsers,
  // workers, and Node without requiring a network-facing or platform-specific crypto API.
  function sha256Hex(value) {
    const bytes = utf8Bytes(String(value));
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    view.setUint32(paddedLength - 8, high, false);
    view.setUint32(paddedLength - 4, low, false);

    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const words = new Uint32Array(64);
    const rotateRight = (number, bits) => (number >>> bits) | (number << (32 - bits));

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + (index * 4), false);
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotateRight(words[index - 15], 7)
          ^ rotateRight(words[index - 15], 18)
          ^ (words[index - 15] >>> 3);
        const s1 = rotateRight(words[index - 2], 17)
          ^ rotateRight(words[index - 2], 19)
          ^ (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ ((~e) & g);
        const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map((part) => part.toString(16).padStart(8, '0')).join('');
  }

  function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  function defaultIdFactory() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) {
      throw new StoreError('secure_random_unavailable', 'This browser cannot create secure examination operation identifiers.');
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function generatedId(idFactory, field = 'generatedId') {
    return assertString(idFactory(), field, 256);
  }

  function normalizeStorageError(error, fallbackMessage) {
    if (error instanceof StoreError) return error;
    if (error?.name === 'QuotaExceededError') {
      return new StoreError(
        'storage_quota_exceeded',
        'This device has no space available for another secure local exam save. Free browser storage, then retry before leaving the page.',
        error,
      );
    }
    if (['InvalidStateError', 'NotAllowedError', 'SecurityError'].includes(error?.name)) {
      return new StoreError(
        'indexeddb_unavailable',
        'Secure local exam storage is unavailable under the current browser privacy settings.',
        error,
      );
    }
    return new StoreError('indexeddb_transaction_failed', fallbackMessage, error);
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new StoreError('indexeddb_request_failed', 'IndexedDB request failed.'));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new StoreError('indexeddb_transaction_failed', 'IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new StoreError('indexeddb_transaction_aborted', 'IndexedDB transaction was aborted.'));
    });
  }

  function hasName(collection, name) {
    if (!collection) return false;
    if (typeof collection.contains === 'function') return collection.contains(name);
    return Array.from(collection).includes(name);
  }

  function ensureIndex(store, name, keyPath, options) {
    if (!hasName(store.indexNames, name)) store.createIndex(name, keyPath, options);
  }

  function installSchema(database, transaction) {
    const definitions = [
      [STORE_NAMES.answers, 'answerKey'],
      [STORE_NAMES.operations, 'operationId'],
      [STORE_NAMES.queue, 'operationId'],
      [STORE_NAMES.submissions, 'intentKey'],
      [STORE_NAMES.acknowledgements, 'operationId'],
      [STORE_NAMES.conflicts, 'conflictId'],
      [STORE_NAMES.recoveries, 'recoveryId'],
      [STORE_NAMES.receipts, 'attemptKey'],
      [STORE_NAMES.meta, 'key'],
    ];
    definitions.forEach(([name, keyPath]) => {
      const store = hasName(database.objectStoreNames, name)
        ? transaction.objectStore(name)
        : database.createObjectStore(name, { keyPath });
      if ([STORE_NAMES.answers, STORE_NAMES.operations, STORE_NAMES.queue,
        STORE_NAMES.conflicts, STORE_NAMES.recoveries].includes(name)) {
        ensureIndex(store, 'attemptKey', 'attemptKey', { unique: false });
      }
      if (name === STORE_NAMES.queue) {
        ensureIndex(store, 'nextAttemptAt', 'nextAttemptAt', { unique: false });
      }
    });
  }

  function openIndexedDatabase(indexedDb, databaseName) {
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      try {
        request = indexedDb.open(databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(new StoreError('indexeddb_unavailable', 'This browser could not open secure local exam storage.', error));
        return;
      }
      request.onupgradeneeded = () => installSchema(request.result, request.transaction);
      request.onsuccess = () => {
        if (settled) {
          request.result?.close?.();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(new StoreError(
          'indexeddb_unavailable',
          'Secure local exam storage is unavailable. Check browser privacy or storage settings.',
          request.error,
        ));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new StoreError(
          'indexeddb_blocked',
          'A different tab is blocking the local exam storage upgrade. Close older examination tabs and retry.',
        ));
      };
    });
  }

  function retryDelay(attempt, options = {}) {
    const baseMs = Math.max(100, Number(options.baseMs) || 1_000);
    const capMs = Math.max(baseMs, Number(options.capMs) || 60_000);
    const exponent = Math.max(0, Math.min(20, Math.floor(Number(attempt) || 0)));
    const ceiling = Math.min(capMs, baseMs * (2 ** exponent));
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const sample = Math.min(1, Math.max(0, Number(random()) || 0));
    // Full jitter avoids synchronized retries while the cap keeps offline queues bounded.
    return Math.max(100, Math.floor(sample * ceiling));
  }

  function createStore(options = {}) {
    const indexedDb = Object.prototype.hasOwnProperty.call(options, 'indexedDB')
      ? options.indexedDB
      : globalThis.indexedDB;
    const databaseName = options.databaseName || DATABASE_NAME;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
    const maxContentBytes = Math.max(1, Number(options.maxContentBytes) || DEFAULT_MAX_CONTENT_BYTES);
    const receiptRetentionMs = Math.max(
      0,
      Number.isFinite(Number(options.receiptRetentionMs))
        ? Number(options.receiptRetentionMs)
        : DEFAULT_RECEIPT_RETENTION_MS,
    );
    let database = null;
    let opening = null;
    let availability = indexedDb?.open
      ? { available: null, code: 'not_initialized', message: 'Local exam storage has not been initialized.' }
      : { available: false, code: 'indexeddb_unavailable', message: 'This browser does not provide IndexedDB.' };

    async function init() {
      if (database) return { available: true, code: 'ready', message: 'Secure local exam storage is ready.' };
      if (!indexedDb?.open) return { ...availability };
      if (!opening) {
        opening = openIndexedDatabase(indexedDb, databaseName)
          .then((opened) => {
            database = opened;
            database.onversionchange = () => {
              database.close();
              database = null;
              availability = {
                available: false,
                code: 'indexeddb_version_changed',
                message: 'Local exam storage changed in another tab. Reload this tab before continuing.',
              };
            };
            availability = { available: true, code: 'ready', message: 'Secure local exam storage is ready.' };
            return { ...availability };
          })
          .catch((error) => {
            availability = {
              available: false,
              code: error.code || 'indexeddb_unavailable',
              message: error.message || 'Secure local exam storage is unavailable.',
            };
            return { ...availability };
          })
          .finally(() => { opening = null; });
      }
      return opening;
    }

    function getAvailability() {
      return { ...availability };
    }

    async function requireDatabase() {
      if (!database) {
        const result = await init();
        if (!result.available || !database) {
          throw new StoreError(result.code, result.message);
        }
      }
      return database;
    }

    async function getDeviceInstanceHash() {
      return transact([STORE_NAMES.meta], 'readwrite', async (stores) => {
        const key = 'device-instance-v1';
        let record = await requestPromise(stores.meta.get(key));
        if (!record?.value) {
          record = { key, value: generatedId(idFactory, 'deviceInstanceId'), createdAt: now(), updatedAt: now() };
          await requestPromise(stores.meta.put(record));
        }
        return sha256Hex(`duediligence-exam-device-v1:${record.value}`);
      });
    }

    async function saveSessionEnvelope(input) {
      const scope = normalizeScope(input, false);
      const sessionId = assertString(input.sessionId, 'sessionId', 128);
      const deviceInstanceHash = assertString(input.deviceInstanceHash, 'deviceInstanceHash', 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(deviceInstanceHash)) {
        throw new StoreError('invalid_input', 'deviceInstanceHash must be a SHA-256 value.');
      }
      const serverDeadline = input.serverDeadline == null ? null : String(input.serverDeadline);
      if (serverDeadline && !Number.isFinite(new Date(serverDeadline).getTime())) {
        throw new StoreError('invalid_input', 'serverDeadline must be an ISO date-time when provided.');
      }
      const answerSetHash = input.answerSetHash == null ? null : String(input.answerSetHash).toLowerCase();
      if (answerSetHash && !/^[0-9a-f]{64}$/.test(answerSetHash)) {
        throw new StoreError('invalid_input', 'answerSetHash must be a SHA-256 value when provided.');
      }
      const record = {
        key: `session-envelope:${scope.attemptId}`,
        attemptKey: attemptKey(scope),
        ...scope,
        sessionId,
        deviceInstanceHash,
        serverDeadline,
        answerSetHash,
        updatedAt: now(),
      };
      await transact([STORE_NAMES.meta], 'readwrite', async (stores) => {
        await requestPromise(stores.meta.put(record));
      });
      return safeClone(record);
    }

    async function getSessionEnvelope(attemptIdInput, deviceInstanceHashInput) {
      const attemptId = assertString(attemptIdInput, 'attemptId');
      const deviceInstanceHash = assertString(deviceInstanceHashInput, 'deviceInstanceHash', 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(deviceInstanceHash)) {
        throw new StoreError('invalid_input', 'deviceInstanceHash must be a SHA-256 value.');
      }
      return transact([STORE_NAMES.meta], 'readonly', async (stores) => {
        const record = await requestPromise(stores.meta.get(`session-envelope:${attemptId}`));
        if (!record || record.deviceInstanceHash !== deviceInstanceHash) return null;
        return safeClone(record);
      });
    }

    async function clearSessionEnvelope(attemptIdInput) {
      const attemptId = assertString(attemptIdInput, 'attemptId');
      return transact([STORE_NAMES.meta], 'readwrite', async (stores) => {
        await requestPromise(stores.meta.delete(`session-envelope:${attemptId}`));
        return true;
      });
    }

    async function saveAttemptBundle(input) {
      const scope = normalizeScope(input, false);
      if (!input.bundle || typeof input.bundle !== 'object' || Array.isArray(input.bundle)) {
        throw new StoreError('invalid_input', 'An authorized examination bundle is required.');
      }
      const bundle = safeClone(input.bundle);
      if (utf8Bytes(canonicalJson(bundle)).byteLength > 5 * 1024 * 1024) {
        throw new StoreError('content_too_large', 'The authorized examination bundle exceeds the local recovery limit.');
      }
      const record = {
        key: `attempt-bundle:${scope.attemptId}`,
        attemptKey: attemptKey(scope),
        ...scope,
        bundle,
        updatedAt: now(),
      };
      await transact([STORE_NAMES.meta], 'readwrite', async (stores) => {
        await requestPromise(stores.meta.put(record));
      });
      return safeClone(record);
    }

    async function getAttemptBundle(attemptIdInput) {
      const attemptId = assertString(attemptIdInput, 'attemptId');
      return transact([STORE_NAMES.meta], 'readonly', async (stores) => {
        const record = await requestPromise(stores.meta.get(`attempt-bundle:${attemptId}`));
        return record ? safeClone(record) : null;
      });
    }

    async function transact(names, mode, work) {
      const db = await requireDatabase();
      let transaction;
      try {
        transaction = db.transaction(names, mode);
      } catch (error) {
        throw new StoreError('indexeddb_transaction_failed', 'Could not start a local exam storage transaction.', error);
      }
      const completion = transactionPromise(transaction);
      const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
      try {
        const result = await work(stores, transaction);
        await completion;
        return result;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await completion.catch(() => {});
        throw normalizeStorageError(error, 'Local exam storage could not complete the operation.');
      }
    }

    async function nextSequence(metaStore, scope) {
      const key = `sequence:${epochKey(scope)}`;
      const current = await requestPromise(metaStore.get(key));
      const sequence = Math.max(0, Number(current?.value) || 0) + 1;
      await requestPromise(metaStore.put({
        key,
        attemptKey: attemptKey(scope),
        sessionEpoch: scope.sessionEpoch,
        value: sequence,
        updatedAt: now(),
      }));
      return sequence;
    }

    async function saveAnswer(input) {
      const scope = normalizeScope(input, true);
      const content = String(input.content == null ? '' : input.content);
      if (utf8Bytes(content).byteLength > maxContentBytes) {
        throw new StoreError('content_too_large', `Answer content exceeds the ${maxContentBytes}-byte local limit.`);
      }
      const baseRevision = Math.max(0, Math.floor(Number(input.baseRevision) || 0));
      const operationId = input.operationId
        ? assertString(input.operationId, 'operationId', 256)
        : generatedId(idFactory, 'operationId');
      const contentHash = sha256Hex(content);
      const scopeAttemptKey = attemptKey(scope);
      const scopeAnswerKey = answerKey(scope);
      const createdAt = now();
      const offlineSince = input.offlineSince == null ? null : Math.floor(Number(input.offlineSince));
      if (offlineSince != null && (!Number.isFinite(offlineSince) || offlineSince > createdAt)) {
        throw new StoreError('invalid_input', 'Offline evidence must begin no later than the local answer save.');
      }
      if (input.outageEvidence != null
        && (typeof input.outageEvidence !== 'object' || Array.isArray(input.outageEvidence))) {
        throw new StoreError('invalid_input', 'Outage evidence must be a small structured object.');
      }
      const outageEvidence = input.outageEvidence == null ? null : safeClone(input.outageEvidence);
      if (utf8Bytes(canonicalJson(outageEvidence || {})).byteLength > 8_000) {
        throw new StoreError('invalid_input', 'Outage evidence exceeds the local size limit.');
      }
      const payloadHash = sha256Hex(canonicalJson({
        ...scope, baseRevision, contentHash, offlineSince, outageEvidence,
      }));

      return transact(
        [STORE_NAMES.answers, STORE_NAMES.operations, STORE_NAMES.queue, STORE_NAMES.meta],
        'readwrite',
        async (stores) => {
          const existing = await requestPromise(stores.operations.get(operationId));
          if (existing) {
            if (existing.payloadHash !== payloadHash || existing.kind !== 'answer.save') {
              throw new StoreError('operation_id_collision', 'The operation ID is already bound to different answer content.');
            }
            return { operation: safeClone(existing), created: false };
          }
          const localSequence = await nextSequence(stores.meta, scope);
          const operation = {
            operationId,
            kind: 'answer.save',
            ...scope,
            attemptKey: scopeAttemptKey,
            answerKey: scopeAnswerKey,
            localSequence,
            baseRevision,
            contentHash,
            content,
            clientSavedAt: createdAt,
            offlineSince,
            outageEvidence,
            payloadHash,
            state: 'queued',
            createdAt,
            updatedAt: createdAt,
          };
          const answer = {
            ...operation,
            state: 'local',
          };
          const queueItem = {
            ...operation,
            retryCount: 0,
            nextAttemptAt: createdAt,
            lastErrorCode: null,
          };
          // Content and its durable queue record commit in one IndexedDB transaction.
          await requestPromise(stores.operations.put(operation));
          await requestPromise(stores.answers.put(answer));
          await requestPromise(stores.queue.put(queueItem));
          return { operation: safeClone(operation), created: true };
        },
      );
    }

    async function getLatestAnswers(scopeInput) {
      const scope = normalizeScope(scopeInput, false);
      return transact([STORE_NAMES.answers], 'readonly', async (stores) => {
        const records = await requestPromise(stores.answers.getAll());
        return records
          .filter((record) => record.attemptKey === attemptKey(scope)
            && record.sessionEpoch === scope.sessionEpoch)
          .sort((left, right) => left.questionId.localeCompare(right.questionId))
          .map(safeClone);
      });
    }

    async function getAnswerHistory(scopeInput) {
      const scope = normalizeScope(scopeInput, Boolean(scopeInput?.questionId));
      return transact([STORE_NAMES.operations], 'readonly', async (stores) => {
        const records = await requestPromise(stores.operations.getAll());
        return records
          .filter((record) => record.kind === 'answer.save'
            && record.attemptKey === attemptKey(scope)
            && record.sessionEpoch === scope.sessionEpoch
            && (!scope.questionId || record.questionId === scope.questionId))
          .sort((left, right) => left.localSequence - right.localSequence)
          .map(safeClone);
      });
    }

    async function getPendingOperations(optionsInput = {}) {
      const availableAt = Number.isFinite(Number(optionsInput.availableAt))
        ? Number(optionsInput.availableAt)
        : now();
      const limit = Math.max(1, Math.min(MAX_QUEUE_BATCH, Math.floor(Number(optionsInput.limit) || 50)));
      const requestedAttemptId = optionsInput.attemptId == null
        ? null
        : assertString(optionsInput.attemptId, 'attemptId', 256);
      const requestedEpoch = optionsInput.sessionEpoch == null
        ? null
        : assertString(optionsInput.sessionEpoch, 'sessionEpoch', 256);
      return transact([STORE_NAMES.queue], 'readonly', async (stores) => {
        const records = await requestPromise(stores.queue.getAll());
        return records
          .filter((record) => record.state === 'queued'
            && record.nextAttemptAt <= availableAt
            && (!requestedAttemptId || record.attemptId === requestedAttemptId)
            && (!requestedEpoch || record.sessionEpoch === requestedEpoch))
            .sort((left, right) => (left.localSequence - right.localSequence)
              || (left.nextAttemptAt - right.nextAttemptAt))
          .slice(0, limit)
          .map(safeClone);
      });
    }

    async function markOperationAttempt(operationIdInput, retryOptions = {}) {
      const operationId = assertString(operationIdInput, 'operationId', 256);
      return transact([STORE_NAMES.queue, STORE_NAMES.operations], 'readwrite', async (stores) => {
        const queued = await requestPromise(stores.queue.get(operationId));
        if (!queued) return null;
        const retryCount = Math.max(0, Number(queued.retryCount) || 0) + 1;
        const delayMs = retryDelay(retryCount - 1, retryOptions);
        const updatedAt = now();
        let offlineSince = queued.offlineSince == null ? null : Number(queued.offlineSince);
        if (retryOptions.offlineSince != null) {
          const reportedOfflineSince = Math.floor(Number(retryOptions.offlineSince));
          if (!Number.isFinite(reportedOfflineSince)
            || reportedOfflineSince > Number(queued.clientSavedAt || queued.createdAt || updatedAt)) {
            throw new StoreError('invalid_input', 'Retry outage evidence must begin no later than the local answer save.');
          }
          offlineSince = offlineSince == null
            ? reportedOfflineSince
            : Math.min(offlineSince, reportedOfflineSince);
        }
        let outageEvidence = queued.outageEvidence == null ? null : safeClone(queued.outageEvidence);
        if (retryOptions.outageEvidence != null) {
          if (typeof retryOptions.outageEvidence !== 'object' || Array.isArray(retryOptions.outageEvidence)) {
            throw new StoreError('invalid_input', 'Retry outage evidence must be a small structured object.');
          }
          outageEvidence = { ...(outageEvidence || {}), ...safeClone(retryOptions.outageEvidence) };
          if (utf8Bytes(canonicalJson(outageEvidence)).byteLength > 8_000) {
            throw new StoreError('invalid_input', 'Retry outage evidence exceeds the local size limit.');
          }
        }
        const payloadHash = queued.kind === 'answer.save'
          ? sha256Hex(canonicalJson({
            examId: queued.examId,
            examVersionId: queued.examVersionId,
            attemptId: queued.attemptId,
            sessionEpoch: queued.sessionEpoch,
            questionId: queued.questionId,
            baseRevision: queued.baseRevision,
            contentHash: queued.contentHash,
            offlineSince,
            outageEvidence,
          }))
          : queued.payloadHash;
        const updated = {
          ...queued,
          retryCount,
          nextAttemptAt: updatedAt + delayMs,
          lastAttemptAt: updatedAt,
          lastErrorCode: retryOptions.errorCode
            ? assertString(retryOptions.errorCode, 'errorCode', 128)
            : null,
          offlineSince,
          outageEvidence,
          payloadHash,
          updatedAt,
        };
        await requestPromise(stores.queue.put(updated));
        const operation = await requestPromise(stores.operations.get(operationId));
        if (operation) await requestPromise(stores.operations.put({ ...operation, ...updated }));
        return safeClone(updated);
      });
    }

    async function acknowledgeOperation(input) {
      const operationId = assertString(input?.operationId, 'operationId', 256);
      const acknowledgedAt = Number.isFinite(Number(input.acknowledgedAt))
        ? Number(input.acknowledgedAt)
        : now();
      const serverRevision = input.serverRevision == null
        ? null
        : Math.max(0, Math.floor(Number(input.serverRevision) || 0));
      return transact(
        [STORE_NAMES.queue, STORE_NAMES.operations, STORE_NAMES.answers,
          STORE_NAMES.submissions, STORE_NAMES.acknowledgements],
        'readwrite',
        async (stores) => {
          const operation = await requestPromise(stores.operations.get(operationId));
          if (!operation) return null;
          const acknowledgement = {
            operationId,
            kind: operation.kind,
            attemptKey: operation.attemptKey,
            payloadHash: operation.payloadHash,
            serverRevision,
            acknowledgedAt,
          };
          await requestPromise(stores.queue.delete(operationId));
          await requestPromise(stores.operations.put({
            ...operation,
            state: 'acknowledged',
            serverRevision,
            acknowledgedAt,
            updatedAt: acknowledgedAt,
          }));
          if (operation.answerKey) {
            const latest = await requestPromise(stores.answers.get(operation.answerKey));
            if (latest?.operationId === operationId) {
              await requestPromise(stores.answers.put({
                ...latest,
                state: 'server_acknowledged',
                serverRevision,
                acknowledgedAt,
                updatedAt: acknowledgedAt,
              }));
            }
          }
          if (operation.kind === 'attempt.submit' && operation.intentKey) {
            const submission = await requestPromise(stores.submissions.get(operation.intentKey));
            if (submission?.operationId === operationId) {
              await requestPromise(stores.submissions.put({
                ...submission,
                state: 'acknowledged',
                acknowledgedAt,
                updatedAt: acknowledgedAt,
              }));
            }
          }
          await requestPromise(stores.acknowledgements.put(acknowledgement));
          return safeClone(acknowledgement);
        },
      );
    }

    async function recordConflict(input) {
      const operationId = assertString(input?.operationId, 'operationId', 256);
      const conflictId = input.conflictId
        ? assertString(input.conflictId, 'conflictId', 256)
        : `conflict-${generatedId(idFactory)}`;
      const recordedAt = now();
      const serverContent = input.serverContent == null ? null : String(input.serverContent);
      if (serverContent != null && utf8Bytes(serverContent).byteLength > maxContentBytes) {
        throw new StoreError('content_too_large', `Conflicting answer content exceeds the ${maxContentBytes}-byte local limit.`);
      }
      return transact(
        [STORE_NAMES.queue, STORE_NAMES.operations, STORE_NAMES.answers, STORE_NAMES.conflicts],
        'readwrite',
        async (stores) => {
          const existingConflict = await requestPromise(stores.conflicts.get(conflictId));
          if (existingConflict) {
            if (existingConflict.operationId === operationId) return safeClone(existingConflict);
            throw new StoreError('conflict_id_collision', 'The conflict ID is already bound to another operation.');
          }
          const operation = await requestPromise(stores.operations.get(operationId));
          if (!operation) throw new StoreError('operation_not_found', 'The local operation was not found.');
          const conflict = {
            conflictId,
            operationId,
            kind: operation.kind,
            attemptKey: operation.attemptKey,
            answerKey: operation.answerKey || null,
            localOperation: safeClone(operation),
            serverRevision: input.serverRevision == null
              ? null
              : Math.max(0, Math.floor(Number(input.serverRevision) || 0)),
            serverContentHash: input.serverContentHash
              ? assertString(input.serverContentHash, 'serverContentHash', 128)
              : null,
            serverContent,
            reason: input.reason ? assertString(input.reason, 'reason', 512) : 'revision_conflict',
            state: 'unresolved',
            recordedAt,
          };
          await requestPromise(stores.queue.delete(operationId));
          await requestPromise(stores.operations.put({
            ...operation,
            state: 'conflict',
            conflictId,
            updatedAt: recordedAt,
          }));
          if (operation.answerKey) {
            const latest = await requestPromise(stores.answers.get(operation.answerKey));
            if (latest?.operationId === operationId) {
              await requestPromise(stores.answers.put({ ...latest, state: 'conflict', conflictId, updatedAt: recordedAt }));
            }
          }
          await requestPromise(stores.conflicts.put(conflict));
          return safeClone(conflict);
        },
      );
    }

    async function retainRecoverySnapshot(scopeInput, reasonInput = 'manual_recovery_checkpoint') {
      const scope = normalizeScope(scopeInput, false);
      const reason = assertString(reasonInput, 'reason', 512);
      const recoveryId = `recovery-${generatedId(idFactory)}`;
      const recordedAt = now();
      return transact(
        [STORE_NAMES.answers, STORE_NAMES.operations, STORE_NAMES.recoveries],
        'readwrite',
        async (stores) => {
          const scopeAttemptKey = attemptKey(scope);
          const answers = (await requestPromise(stores.answers.getAll()))
            .filter((record) => record.attemptKey === scopeAttemptKey
              && record.sessionEpoch === scope.sessionEpoch);
          const operations = (await requestPromise(stores.operations.getAll()))
            .filter((record) => record.attemptKey === scopeAttemptKey
              && record.sessionEpoch === scope.sessionEpoch
              && ['queued', 'conflict', 'quarantined'].includes(record.state));
          const recovery = {
            recoveryId,
            attemptKey: scopeAttemptKey,
            ...scope,
            reason,
            answers: safeClone(answers),
            operations: safeClone(operations),
            recordedAt,
          };
          await requestPromise(stores.recoveries.put(recovery));
          return safeClone(recovery);
        },
      );
    }

    async function quarantineSessionEpoch(scopeInput, nextSessionEpochInput, reasonInput = 'session_epoch_replaced') {
      const scope = normalizeScope(scopeInput, false);
      const nextSessionEpoch = assertString(nextSessionEpochInput, 'nextSessionEpoch', 128);
      if (nextSessionEpoch === scope.sessionEpoch) {
        throw new StoreError('invalid_input', 'The replacement session epoch must be different.');
      }
      const recovery = await retainRecoverySnapshot(scope, reasonInput);
      await transact([STORE_NAMES.queue, STORE_NAMES.operations], 'readwrite', async (stores) => {
        const queued = await requestPromise(stores.queue.getAll());
        for (const item of queued) {
          if (item.attemptKey !== attemptKey(scope) || item.sessionEpoch !== scope.sessionEpoch) continue;
          await requestPromise(stores.queue.delete(item.operationId));
          const operation = await requestPromise(stores.operations.get(item.operationId));
          if (operation) {
            await requestPromise(stores.operations.put({
              ...operation,
              state: 'quarantined',
              recoveryId: recovery.recoveryId,
              replacedBySessionEpoch: nextSessionEpoch,
              updatedAt: now(),
            }));
          }
        }
      });
      return recovery;
    }

    async function quarantineAttemptQueue(scopeInput, reasonInput = 'session_requires_operator_recovery') {
      const scope = normalizeScope(scopeInput, false);
      const recovery = await retainRecoverySnapshot(scope, reasonInput);
      await transact([STORE_NAMES.queue, STORE_NAMES.operations], 'readwrite', async (stores) => {
        const queued = await requestPromise(stores.queue.getAll());
        for (const item of queued) {
          if (item.attemptKey !== attemptKey(scope) || item.sessionEpoch !== scope.sessionEpoch) continue;
          await requestPromise(stores.queue.delete(item.operationId));
          const operation = await requestPromise(stores.operations.get(item.operationId));
          if (operation) {
            await requestPromise(stores.operations.put({
              ...operation,
              state: 'quarantined',
              recoveryId: recovery.recoveryId,
              quarantineReason: reasonInput,
              updatedAt: now(),
            }));
          }
        }
      });
      return recovery;
    }

    async function listConflicts(scopeInput) {
      const scope = normalizeScope(scopeInput, false);
      return transact([STORE_NAMES.conflicts], 'readonly', async (stores) => {
        const records = await requestPromise(stores.conflicts.getAll());
        return records.filter((record) => record.attemptKey === attemptKey(scope)).map(safeClone);
      });
    }

    async function resolveConflict(input) {
      const conflictId = assertString(input?.conflictId, 'conflictId', 256);
      const resolution = assertString(input?.resolution, 'resolution', 64);
      if (!['accept_server', 'retry_local'].includes(resolution)) {
        throw new StoreError('invalid_input', 'Choose either the server answer or a retry of the local answer.');
      }
      const resolvedAt = now();
      return transact(
        [STORE_NAMES.conflicts, STORE_NAMES.operations, STORE_NAMES.answers],
        'readwrite',
        async (stores) => {
          const conflict = await requestPromise(stores.conflicts.get(conflictId));
          if (!conflict) throw new StoreError('conflict_not_found', 'The recovery branch was not found.');
          if (conflict.state !== 'unresolved') return safeClone(conflict);
          const resolved = {
            ...conflict,
            state: 'resolved',
            resolution,
            resolvedAt,
          };
          await requestPromise(stores.conflicts.put(resolved));
          const operation = await requestPromise(stores.operations.get(conflict.operationId));
          if (operation) {
            await requestPromise(stores.operations.put({
              ...operation,
              state: resolution === 'accept_server' ? 'resolved_server' : 'resolved_retry',
              resolution,
              resolvedAt,
              updatedAt: resolvedAt,
            }));
          }
          if (resolution === 'accept_server' && conflict.answerKey) {
            const latest = await requestPromise(stores.answers.get(conflict.answerKey));
            if (latest?.operationId === conflict.operationId) {
              await requestPromise(stores.answers.put({
                ...latest,
                content: conflict.serverContent == null ? '' : conflict.serverContent,
                contentHash: conflict.serverContentHash || sha256Hex(conflict.serverContent || ''),
                state: 'server_acknowledged',
                serverRevision: conflict.serverRevision,
                resolution,
                resolvedAt,
                updatedAt: resolvedAt,
              }));
            }
          }
          return safeClone(resolved);
        },
      );
    }

    async function listRecoveries(scopeInput) {
      const scope = normalizeScope(scopeInput, false);
      return transact([STORE_NAMES.recoveries], 'readonly', async (stores) => {
        const records = await requestPromise(stores.recoveries.getAll());
        return records.filter((record) => record.attemptKey === attemptKey(scope)).map(safeClone);
      });
    }

    async function ensureSubmissionIntent(scopeInput, input = {}) {
      const scope = normalizeScope(scopeInput, false);
      const scopeIntentKey = intentKey(scope);
      const createdAt = now();
      const clientPendingAt = Number.isFinite(Number(input.clientPendingAt))
        ? Math.floor(Number(input.clientPendingAt))
        : createdAt;
      const offlineSince = input.offlineSince == null
        ? null
        : Math.floor(Number(input.offlineSince));
      if (offlineSince != null && (!Number.isFinite(offlineSince) || offlineSince > clientPendingAt)) {
        throw new StoreError('invalid_input', 'Offline evidence must begin no later than the pending submission intent.');
      }
      if (input.outageEvidence != null
        && (typeof input.outageEvidence !== 'object' || Array.isArray(input.outageEvidence))) {
        throw new StoreError('invalid_input', 'Outage evidence must be a small structured object.');
      }
      const outageEvidence = input.outageEvidence == null ? null : safeClone(input.outageEvidence);
      if (utf8Bytes(canonicalJson(outageEvidence || {})).byteLength > 8_000) {
        throw new StoreError('invalid_input', 'Outage evidence exceeds the local size limit.');
      }
      return transact(
        [STORE_NAMES.answers, STORE_NAMES.operations, STORE_NAMES.queue, STORE_NAMES.submissions, STORE_NAMES.meta],
        'readwrite',
        async (stores) => {
          const existing = await requestPromise(stores.submissions.get(scopeIntentKey));
          if (existing && ['queued', 'acknowledged', 'confirmed'].includes(existing.state)) {
            return { intent: safeClone(existing), created: false };
          }
          let answerOperationIds;
          if (Array.isArray(input.answerOperationIds)) {
            answerOperationIds = [...new Set(input.answerOperationIds.map((id) => assertString(id, 'answerOperationId', 256)))];
          } else {
            const latest = await requestPromise(stores.answers.getAll());
            answerOperationIds = latest
              .filter((record) => record.attemptKey === attemptKey(scope)
                && record.sessionEpoch === scope.sessionEpoch)
              .sort((left, right) => left.questionId.localeCompare(right.questionId))
              .map((record) => record.operationId);
          }
          const localSequence = await nextSequence(stores.meta, scope);
          const operationId = input.intentId
            ? assertString(input.intentId, 'intentId', 256)
            : `submission-${generatedId(idFactory)}`;
          const payloadHash = sha256Hex(canonicalJson({
            ...scope, answerOperationIds, clientPendingAt, offlineSince, outageEvidence,
          }));
          const collidingOperation = await requestPromise(stores.operations.get(operationId));
          if (collidingOperation) {
            throw new StoreError(
              'operation_id_collision',
              'The submission intent ID is already bound to a different local operation.',
            );
          }
          const intent = {
            intentKey: scopeIntentKey,
            operationId,
            intentId: operationId,
            kind: 'attempt.submit',
            ...scope,
            attemptKey: attemptKey(scope),
            localSequence,
            answerOperationIds,
            clientPendingAt,
            offlineSince,
            outageEvidence,
            payloadHash,
            state: 'queued',
            createdAt,
            updatedAt: createdAt,
          };
          const queued = {
            ...intent,
            retryCount: 0,
            nextAttemptAt: createdAt,
            lastErrorCode: null,
          };
          await requestPromise(stores.submissions.put(intent));
          await requestPromise(stores.operations.put(intent));
          await requestPromise(stores.queue.put(queued));
          return { intent: safeClone(intent), created: true };
        },
      );
    }

    async function confirmSubmissionReceipt(input) {
      const intentId = assertString(input?.intentId, 'intentId', 256);
      const receiptId = assertString(input?.receiptId, 'receiptId', 256);
      const confirmedAt = Number.isFinite(Number(input.confirmedAt)) ? Number(input.confirmedAt) : now();
      return transact(
        [STORE_NAMES.operations, STORE_NAMES.queue, STORE_NAMES.submissions,
          STORE_NAMES.receipts, STORE_NAMES.acknowledgements],
        'readwrite',
        async (stores) => {
          const operation = await requestPromise(stores.operations.get(intentId));
          if (!operation || operation.kind !== 'attempt.submit') {
            throw new StoreError('submission_intent_not_found', 'The stable local submission intent was not found.');
          }
          const existingReceipt = await requestPromise(stores.receipts.get(operation.attemptKey));
          if (existingReceipt) {
            if (existingReceipt.receiptId === receiptId) {
              return safeClone(existingReceipt);
            }
            throw new StoreError(
              'receipt_conflict',
              'A different confirmed submission receipt already exists for this attempt.',
            );
          }
          const receipt = {
            attemptKey: operation.attemptKey,
            intentId,
            receiptId,
            receiptToken: input.receiptToken
              ? assertString(input.receiptToken, 'receiptToken', 1024)
              : null,
            payloadHash: operation.payloadHash,
            submittedAt: Number.isFinite(Number(input.submittedAt)) ? Number(input.submittedAt) : confirmedAt,
            confirmedAt,
            cleanupEligibleAt: confirmedAt + receiptRetentionMs,
            contentPurgedAt: null,
          };
          const submission = await requestPromise(stores.submissions.get(operation.intentKey));
          await requestPromise(stores.queue.delete(intentId));
          await requestPromise(stores.operations.put({
            ...operation,
            state: 'confirmed',
            receiptId,
            acknowledgedAt: confirmedAt,
            updatedAt: confirmedAt,
          }));
          if (submission) {
            await requestPromise(stores.submissions.put({
              ...submission,
              state: 'confirmed',
              receiptId,
              confirmedAt,
              updatedAt: confirmedAt,
            }));
          }
          await requestPromise(stores.receipts.put(receipt));
          await requestPromise(stores.acknowledgements.put({
            operationId: intentId,
            kind: 'attempt.submit',
            attemptKey: operation.attemptKey,
            payloadHash: operation.payloadHash,
            receiptId,
            serverRevision: null,
            acknowledgedAt: confirmedAt,
          }));
          return safeClone(receipt);
        },
      );
    }

    async function reconcileServerReceipt(input) {
      const scope = normalizeScope({
        examId: input?.examId,
        examVersionId: input?.examVersionId,
        attemptId: input?.attemptId,
        // Receipts are attempt-scoped. A closed-status response intentionally
        // does not disclose the retired session epoch.
        sessionEpoch: 'server-receipt',
      }, false);
      const receiptId = assertString(input?.receiptId, 'receiptId', 256);
      const receivedAtValue = input?.receivedAt == null
        ? NaN
        : (Number.isFinite(Number(input.receivedAt))
          ? Number(input.receivedAt)
          : new Date(input.receivedAt).getTime());
      if (!Number.isFinite(receivedAtValue)) {
        throw new StoreError('invalid_input', 'receivedAt must be a server-issued date-time.');
      }
      const submittedAtValue = input?.submittedAt == null
        ? receivedAtValue
        : (Number.isFinite(Number(input.submittedAt))
          ? Number(input.submittedAt)
          : new Date(input.submittedAt).getTime());
      if (!Number.isFinite(submittedAtValue)) {
        throw new StoreError('invalid_input', 'submittedAt must be a server-issued date-time when provided.');
      }
      const confirmedAt = now();
      const scopeAttemptKey = attemptKey(scope);
      return transact(
        [STORE_NAMES.operations, STORE_NAMES.queue, STORE_NAMES.submissions,
          STORE_NAMES.receipts, STORE_NAMES.acknowledgements],
        'readwrite',
        async (stores) => {
          const existingReceipt = await requestPromise(stores.receipts.get(scopeAttemptKey));
          if (existingReceipt) {
            if (existingReceipt.receiptId === receiptId) return safeClone(existingReceipt);
            throw new StoreError(
              'receipt_conflict',
              'A different confirmed submission receipt already exists for this attempt.',
            );
          }
          const submissions = await requestPromise(stores.submissions.getAll());
          const submission = submissions
            .filter((record) => record.attemptKey === scopeAttemptKey)
            .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0] || null;
          const operation = submission?.intentId
            ? await requestPromise(stores.operations.get(submission.intentId))
            : null;
          const intentId = operation?.operationId || `server-status:${receiptId}`;
          const payloadHash = operation?.payloadHash
            || (input?.snapshotHash && /^[0-9a-f]{64}$/.test(String(input.snapshotHash).toLowerCase())
              ? String(input.snapshotHash).toLowerCase()
              : null);
          const receipt = {
            attemptKey: scopeAttemptKey,
            intentId,
            receiptId,
            receiptToken: null,
            payloadHash,
            submittedAt: submittedAtValue,
            receivedAt: receivedAtValue,
            confirmedAt,
            cleanupEligibleAt: confirmedAt + receiptRetentionMs,
            contentPurgedAt: null,
            source: operation ? 'local_intent_reconciled' : 'server_status_observed',
          };
          if (operation) {
            await requestPromise(stores.queue.delete(operation.operationId));
            await requestPromise(stores.operations.put({
              ...operation,
              state: 'confirmed',
              receiptId,
              acknowledgedAt: confirmedAt,
              updatedAt: confirmedAt,
            }));
          }
          if (submission) {
            await requestPromise(stores.submissions.put({
              ...submission,
              state: 'confirmed',
              receiptId,
              confirmedAt,
              updatedAt: confirmedAt,
            }));
          }
          await requestPromise(stores.receipts.put(receipt));
          if (operation) {
            await requestPromise(stores.acknowledgements.put({
              operationId: operation.operationId,
              kind: 'attempt.submit',
              attemptKey: scopeAttemptKey,
              payloadHash,
              receiptId,
              serverRevision: null,
              acknowledgedAt: confirmedAt,
            }));
          }
          return safeClone(receipt);
        },
      );
    }

    async function getReceipt(scopeInput) {
      const scope = normalizeScope(scopeInput, false);
      return transact([STORE_NAMES.receipts], 'readonly', async (stores) => {
        const record = await requestPromise(stores.receipts.get(attemptKey(scope)));
        return record ? safeClone(record) : null;
      });
    }

    async function cleanupConfirmed(cleanupOptions = {}) {
      const currentTime = Number.isFinite(Number(cleanupOptions.now)) ? Number(cleanupOptions.now) : now();
      return transact(ALL_STORES, 'readwrite', async (stores) => {
        const receipts = await requestPromise(stores.receipts.getAll());
        const eligible = receipts.filter((receipt) => receipt.confirmedAt
          && !receipt.contentPurgedAt
          && receipt.cleanupEligibleAt <= currentTime);
        const purgedAttempts = [];
        for (const receipt of eligible) {
          const key = receipt.attemptKey;
          for (const storeName of [
            STORE_NAMES.answers,
            STORE_NAMES.operations,
            STORE_NAMES.queue,
            STORE_NAMES.submissions,
            STORE_NAMES.acknowledgements,
            STORE_NAMES.conflicts,
            STORE_NAMES.recoveries,
          ]) {
            const records = await requestPromise(stores[storeName].getAll());
            for (const record of records) {
              if (record.attemptKey !== key) continue;
              const keyPath = stores[storeName].keyPath;
              await requestPromise(stores[storeName].delete(record[keyPath]));
            }
          }
          const metas = await requestPromise(stores.meta.getAll());
          for (const meta of metas) {
            if (meta.attemptKey === key) await requestPromise(stores.meta.delete(meta.key));
          }
          await requestPromise(stores.receipts.put({ ...receipt, contentPurgedAt: currentTime }));
          purgedAttempts.push(key);
        }
        return { purgedAttempts, purgedCount: purgedAttempts.length };
      });
    }

    function close() {
      if (database) database.close();
      database = null;
      availability = indexedDb?.open
        ? { available: null, code: 'closed', message: 'Local exam storage is closed.' }
        : availability;
    }

    return Object.freeze({
      init,
      close,
      getAvailability,
      getDeviceInstanceHash,
      saveSessionEnvelope,
      getSessionEnvelope,
      clearSessionEnvelope,
      saveAttemptBundle,
      getAttemptBundle,
      saveAnswer,
      getLatestAnswers,
      getAnswerHistory,
      getPendingOperations,
      markOperationAttempt,
      acknowledgeOperation,
      recordConflict,
      listConflicts,
      resolveConflict,
      retainRecoverySnapshot,
      listRecoveries,
      quarantineSessionEpoch,
      quarantineAttemptQueue,
      ensureSubmissionIntent,
      confirmSubmissionReceipt,
      reconcileServerReceipt,
      getReceipt,
      cleanupConfirmed,
    });
  }

  function createLeaseCoordinator(options = {}) {
    const attemptId = assertString(options.attemptId, 'attemptId');
    const examVersionId = assertString(options.examVersionId, 'examVersionId');
    const sessionEpoch = assertString(options.sessionEpoch, 'sessionEpoch', 128);
    const tabId = options.tabId ? assertString(options.tabId, 'tabId', 256) : generatedId(defaultIdFactory, 'tabId');
    const CandidateBroadcastChannel = Object.prototype.hasOwnProperty.call(options, 'BroadcastChannel')
      ? options.BroadcastChannel
      : globalThis.BroadcastChannel;
    const BroadcastChannelClass = typeof CandidateBroadcastChannel === 'function'
      ? CandidateBroadcastChannel
      : null;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimer = options.clearTimeoutFn || clearTimeout;
    const leaseDurationMs = Math.max(3_000, Number(options.leaseDurationMs) || 15_000);
    const heartbeatMs = Math.min(
      leaseDurationMs / 2,
      Math.max(1_000, Number(options.heartbeatMs) || 5_000),
    );
    const negotiationMs = Math.max(0, Number(options.negotiationMs) || 120);
    const allowUncoordinatedWrite = options.allowUncoordinatedWrite === true;
    const channelName = `duediligence.exam.lease.${sha256Hex(`${examVersionId}:${attemptId}:${sessionEpoch}`).slice(0, 24)}`;
    const listeners = new Set();
    let channel = null;
    let timer = null;
    let stopped = false;
    let state = {
      available: Boolean(BroadcastChannelClass),
      mode: BroadcastChannelClass ? 'idle' : (allowUncoordinatedWrite ? 'writer' : 'unsupported'),
      readonly: !BroadcastChannelClass && !allowUncoordinatedWrite,
      tabId,
      ownerTabId: !BroadcastChannelClass && allowUncoordinatedWrite ? tabId : null,
      leaseUntil: null,
      reason: BroadcastChannelClass ? 'not_started' : 'broadcast_channel_unavailable',
    };

    function snapshot() {
      return { ...state };
    }

    function emit() {
      const current = snapshot();
      listeners.forEach((listener) => {
        try { listener(current); } catch { /* subscriber errors cannot break coordination */ }
      });
    }

    function update(patch) {
      state = { ...state, ...patch };
      emit();
    }

    function post(type, details = {}) {
      if (!channel || stopped) return false;
      try {
        channel.postMessage({
          protocol: 1,
          type,
          tabId,
          sentAt: now(),
          ...details,
        });
        return true;
      } catch {
        return false;
      }
    }

    function clearHeartbeat() {
      if (timer != null) clearTimer(timer);
      timer = null;
    }

    function scheduleHeartbeat() {
      clearHeartbeat();
      if (stopped || state.mode !== 'writer') return;
      timer = setTimer(() => {
        if (stopped || state.mode !== 'writer') return;
        if (Number(state.leaseUntil) <= now()) {
          update({
            mode: 'readonly',
            readonly: true,
            ownerTabId: null,
            leaseUntil: null,
            reason: 'lease_expired',
          });
          return;
        }
        const leaseUntil = now() + leaseDurationMs;
        update({ leaseUntil });
        post('lease-claim', { leaseUntil });
        scheduleHeartbeat();
      }, heartbeatMs);
    }

    function becomeWriter(reason = 'lease_acquired') {
      const leaseUntil = now() + leaseDurationMs;
      update({ mode: 'writer', readonly: false, ownerTabId: tabId, leaseUntil, reason });
      post('lease-claim', { leaseUntil });
      if (BroadcastChannelClass) scheduleHeartbeat();
    }

    function becomeReader(ownerTabId, leaseUntil, reason = 'active_tab_detected') {
      clearHeartbeat();
      update({ mode: 'readonly', readonly: true, ownerTabId, leaseUntil, reason });
      post('readonly', { ownerTabId, leaseUntil, reason });
    }

    function handleMessage(event) {
      const message = event?.data;
      if (!message || message.protocol !== 1 || message.tabId === tabId || stopped) return;
      if (message.type === 'lease-probe' && state.mode === 'writer') {
        post('lease-claim', { leaseUntil: state.leaseUntil });
        return;
      }
      if (message.type === 'lease-release' && state.ownerTabId === message.tabId) {
        update({ mode: 'idle', readonly: true, ownerTabId: null, leaseUntil: null, reason: 'writer_released' });
        return;
      }
      if (message.type !== 'lease-claim') return;
      const remoteUntil = Number(message.leaseUntil) || 0;
      if (remoteUntil <= now()) return;
      if (state.mode === 'writer') {
        // Stable lexical tie-breaking converges simultaneous claims without split-brain.
        if (Number(state.leaseUntil) <= now() || String(message.tabId).localeCompare(tabId) < 0) {
          becomeReader(message.tabId, remoteUntil, 'simultaneous_claim_lost');
        } else {
          post('lease-claim', { leaseUntil: state.leaseUntil });
        }
        return;
      }
      becomeReader(message.tabId, remoteUntil);
    }

    function wait(milliseconds) {
      return new Promise((resolve) => {
        const id = setTimer(resolve, milliseconds);
        if (stopped) {
          clearTimer(id);
          resolve();
        }
      });
    }

    async function requestWrite() {
      if (stopped) throw new StoreError('lease_stopped', 'This tab lease coordinator has stopped.');
      if (!BroadcastChannelClass) {
        if (allowUncoordinatedWrite) becomeWriter('uncoordinated_write_allowed');
        return snapshot();
      }
      if (!channel) {
        channel = new BroadcastChannelClass(channelName);
        channel.onmessage = handleMessage;
      }
      update({ mode: 'negotiating', readonly: true, reason: 'checking_other_tabs' });
      post('lease-probe');
      await wait(negotiationMs);
      if (stopped) return snapshot();
      const remoteLeaseActive = state.ownerTabId
        && state.ownerTabId !== tabId
        && Number(state.leaseUntil) > now();
      if (!remoteLeaseActive) becomeWriter();
      return snapshot();
    }

    async function start(startOptions = {}) {
      if (stopped) throw new StoreError('lease_stopped', 'This tab lease coordinator has stopped.');
      if (startOptions.requestWrite === false) {
        if (BroadcastChannelClass && !channel) {
          channel = new BroadcastChannelClass(channelName);
          channel.onmessage = handleMessage;
          post('lease-probe');
        }
        update({ mode: 'readonly', readonly: true, reason: 'readonly_requested' });
        return snapshot();
      }
      return requestWrite();
    }

    function renew() {
      if (state.mode !== 'writer' || stopped) return false;
      if (Number(state.leaseUntil) <= now()) {
        clearHeartbeat();
        update({
          mode: 'readonly',
          readonly: true,
          ownerTabId: null,
          leaseUntil: null,
          reason: 'lease_expired',
        });
        return false;
      }
      const leaseUntil = now() + leaseDurationMs;
      update({ leaseUntil, reason: 'lease_renewed' });
      post('lease-claim', { leaseUntil });
      scheduleHeartbeat();
      return true;
    }

    function release() {
      if (state.mode !== 'writer') return false;
      post('lease-release');
      clearHeartbeat();
      update({ mode: 'readonly', readonly: true, ownerTabId: null, leaseUntil: null, reason: 'lease_released' });
      return true;
    }

    function announceReadonly(reasonInput = 'readonly') {
      const reason = assertString(reasonInput, 'reason', 256);
      post('readonly', { ownerTabId: state.ownerTabId, leaseUntil: state.leaseUntil, reason });
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new StoreError('invalid_input', 'Lease subscriber must be a function.');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    function stop() {
      if (stopped) return;
      if (state.mode === 'writer') post('lease-release');
      stopped = true;
      clearHeartbeat();
      if (channel) channel.close();
      channel = null;
      update({ mode: 'stopped', readonly: true, ownerTabId: null, leaseUntil: null, reason: 'stopped' });
    }

    return Object.freeze({
      start,
      requestWrite,
      renew,
      release,
      announceReadonly,
      subscribe,
      snapshot,
      stop,
      channelName,
      tabId,
    });
  }

  return Object.freeze({
    DATABASE_NAME,
    DATABASE_VERSION,
    STORE_NAMES,
    DEFAULT_RECEIPT_RETENTION_MS,
    StoreError,
    sha256Hex,
    retryDelay,
    createStore,
    createLeaseCoordinator,
  });
}));
