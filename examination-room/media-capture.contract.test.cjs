'use strict';

const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const sourcePath = path.join(__dirname, 'media-capture.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_TOKEN = `ers1_${'ab'.repeat(32)}`;
const MEDIA_BYTES = Buffer.from('captured-media-segment', 'utf8');

function waitFor(predicate, message, timeout = 2_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error(message));
        return;
      }
      setTimeout(check, 5);
    }
    check();
  });
}

function createFakeIndexedDb() {
  const records = new Map();
  let created = false;

  function clone(value) {
    return structuredClone(value);
  }

  function objectStore(transaction) {
    return {
      createIndex() {},
      put(value) {
        records.set(value.artifactId, clone(value));
        return {};
      },
      delete(key) {
        records.delete(key);
        return {};
      },
      index(name) {
        assert.equal(name, 'attemptId');
        return {
          getAll(attemptId) {
            const request = {};
            setImmediate(() => {
              request.result = [...records.values()]
                .filter((record) => record.attemptId === attemptId)
                .map(clone);
              if (request.onsuccess) request.onsuccess();
            });
            return request;
          },
        };
      },
    };
  }

  const database = {
    objectStoreNames: { contains: (name) => created && name === 'chunks' },
    createObjectStore(name) {
      assert.equal(name, 'chunks');
      created = true;
      return objectStore(null);
    },
    transaction(name) {
      assert.equal(name, 'chunks');
      const transaction = {
        objectStore: () => objectStore(transaction),
      };
      setImmediate(() => {
        if (transaction.oncomplete) transaction.oncomplete();
      });
      return transaction;
    },
  };

  return {
    records,
    open() {
      const request = {};
      setImmediate(() => {
        request.result = database;
        if (!created && request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

function createHarness(options = {}) {
  const indexedDB = options.indexedDB || createFakeIndexedDb();
  const calls = {
    prepare: [],
    complete: [],
    uploadBodies: [],
    getUserMedia: 0,
    statuses: [],
  };
  let releaseUpload;
  const uploadGate = options.holdUpload
    ? new Promise((resolve) => { releaseUpload = resolve; })
    : Promise.resolve();
  let uploadStartedResolve;
  const uploadStarted = new Promise((resolve) => { uploadStartedResolve = resolve; });
  let completionAttempts = 0;

  class FakeMediaRecorder {
    static isTypeSupported(value) {
      return value === 'video/webm;codecs=vp8,opus';
    }

    constructor(_stream, settings) {
      this.mimeType = settings.mimeType;
      this.state = 'inactive';
    }

    start() {
      this.state = 'recording';
      setImmediate(() => {
        if (this.ondataavailable) {
          this.ondataavailable({
            data: new Blob([MEDIA_BYTES], { type: this.mimeType }),
          });
        }
      });
    }

    stop() {
      this.state = 'inactive';
    }
  }

  const navigator = {
    onLine: options.online !== false,
    storage: { persist: async () => true },
    mediaDevices: {
      getUserMedia: async () => {
        calls.getUserMedia += 1;
        return { getTracks: () => [{ stop() {} }] };
      },
    },
  };

  const fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/examination-room/v1/student/media')) {
      const body = JSON.parse(init.body);
      if (body.operation === 'prepare_upload') {
        calls.prepare.push(body);
        return Response.json({
          ok: true,
          recording: {
            artifactId: body.payload.artifactId,
            state: 'upload_ready',
            provider: 'google_drive',
            providerResult: { status: 'upload_session_created' },
            upload: {
              protocol: 'google_drive_resumable',
              method: 'PUT',
              url: 'https://www.googleapis.com/upload/drive/session-test',
              headers: { 'Content-Type': 'application/octet-stream' },
            },
            retryable: true,
            canContinueExam: true,
            submissionBlocked: false,
          },
        });
      }
      calls.complete.push(body);
      completionAttempts += 1;
      if (options.failFirstCompletion && completionAttempts === 1) {
        return Response.json({
          ok: false,
          error: { code: 'EXAM_ROOM_V1_MEDIA_CONTROL_UNAVAILABLE', message: 'Retry completion.' },
        }, { status: 503 });
      }
      return Response.json({
        ok: true,
        recording: {
          artifactId: body.payload.artifactId,
          state: 'completed',
          provider: body.payload.provider,
          providerResult: { status: 'verified' },
          retryable: false,
          canContinueExam: true,
          submissionBlocked: false,
        },
      });
    }
    if (target === 'https://www.googleapis.com/upload/drive/session-test') {
      calls.uploadBodies.push(init.body);
      uploadStartedResolve();
      await uploadGate;
      return Response.json({ id: 'DriveObject_12345678' });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  function fastTimeout(callback, milliseconds) {
    return setTimeout(callback, Math.min(Number(milliseconds) || 0, 10));
  }

  const window = {
    DueDiligencePhase2Config: { workerUrl: 'https://worker.example' },
    MediaRecorder: FakeMediaRecorder,
    addEventListener() {},
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    clearTimeout,
    crypto: webcrypto,
    fetch,
    indexedDB,
    navigator,
    setTimeout: fastTimeout,
  };
  window.window = window;
  vm.runInNewContext(source, {
    Blob,
    TextEncoder,
    Uint8Array,
    window,
  }, { filename: sourcePath });

  return {
    calls,
    controller: window.ExaminationRoomMediaCapture.create({
      onStatus: (status) => calls.statuses.push(status),
    }),
    indexedDB,
    navigator,
    releaseUpload: () => { if (releaseUpload) releaseUpload(); },
    uploadStarted,
  };
}

function startInput() {
  return {
    attemptId: ATTEMPT_ID,
    sessionToken: SESSION_TOKEN,
    examId: '22222222-2222-4222-8222-222222222222',
    startedAt: '2026-08-28T02:00:00.000Z',
    cameraRequired: true,
    microphoneRequired: true,
  };
}

test('browser encrypted object and prepare/complete bodies align with the Worker contract', async () => {
  const harness = createHarness({ holdUpload: true, failFirstCompletion: true });
  const started = await harness.controller.start(startInput());
  assert.equal(started.active, true);
  await harness.uploadStarted;

  assert.equal(harness.indexedDB.records.size, 1);
  const stored = [...harness.indexedDB.records.values()][0];
  assert.equal(stored.encryptedBlob instanceof Blob, true, 'Blob survives structured-clone storage');
  assert.equal(Object.hasOwn(stored, 'sessionToken'), false, 'raw session token must not enter media IndexedDB');
  assert.equal(Object.hasOwn(stored, 'uploadUrl'), false);

  await harness.controller.stop();
  assert.equal(harness.calls.complete.length, 0, 'stopping capture never waits for media completion');
  harness.releaseUpload();
  await waitFor(
    () => harness.calls.complete.length === 2 && harness.indexedDB.records.size === 0,
    'completion retry did not finish',
  );

  assert.equal(harness.calls.prepare.length, 1, 'completion retry must not upload the object again');
  assert.equal(harness.calls.uploadBodies.length, 1, 'one encrypted object creates one provider upload');
  const prepare = harness.calls.prepare[0];
  const complete = harness.calls.complete[1];
  assert.equal(prepare.operation, 'prepare_upload');
  assert.equal(complete.operation, 'complete_upload');
  assert.equal(prepare.idempotencyKey, `media-prepare:${prepare.payload.artifactId}`);
  assert.equal(complete.idempotencyKey, `media-complete:${prepare.payload.artifactId}`);
  assert.equal(prepare.payload.sessionId, ATTEMPT_ID);
  assert.equal(prepare.payload.sessionToken, SESSION_TOKEN);
  assert.equal(prepare.payload.sourceMimeType, 'video/webm;codecs=vp8,opus');
  assert.equal(complete.payload.provider, 'google_drive');
  assert.equal(complete.payload.providerObjectId, 'DriveObject_12345678');
  assert.equal(Object.hasOwn(complete.payload, 'derivedKey'), false);

  const encryptedBlob = harness.calls.uploadBodies[0];
  const encrypted = new Uint8Array(await encryptedBlob.arrayBuffer());
  assert.equal(Buffer.from(encrypted.subarray(0, 8)).toString('binary'), 'DDERMV1\0');
  assert.equal(prepare.payload.encryptedSizeBytes, encrypted.byteLength);
  assert.equal(prepare.payload.objectSha256, createHash('sha256').update(encrypted).digest('hex'));
  assert.equal(complete.payload.objectSha256, prepare.payload.objectSha256);
  const iv = encrypted.subarray(8, 20);
  const ciphertext = encrypted.subarray(20);
  const rawKey = Buffer.from(prepare.payload.derivedKey, 'base64url');
  assert.equal(rawKey.byteLength, 32);
  const key = await webcrypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await webcrypto.subtle.decrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(prepare.payload.artifactId),
  }, key, ciphertext);
  assert.deepEqual(Buffer.from(plaintext), MEDIA_BYTES, 'artifact ID must authenticate the self-contained encrypted object');

  const mediaModule = await import(pathToFileURL(path.join(__dirname, '../worker/examination-room-media.mjs')).href);
  const {
    sessionId: _prepareSessionId,
    sessionToken: _prepareSessionToken,
    ...prepareMedia
  } = prepare.payload;
  const {
    sessionId: _completeSessionId,
    sessionToken: _completeSessionToken,
    ...completeMedia
  } = complete.payload;
  assert.doesNotThrow(() => mediaModule.normalizeExaminationRoomMediaRequest('prepare_upload', prepareMedia));
  assert.doesNotThrow(() => mediaModule.normalizeExaminationRoomMediaRequest('complete_upload', completeMedia));
});
test('a refreshed submitted attempt resumes encrypted completion without requesting media access', async () => {
  const indexedDB = createFakeIndexedDb();
  const firstPage = createHarness({ indexedDB, online: false });
  await firstPage.controller.start(startInput());
  await waitFor(() => indexedDB.records.size === 1, 'offline encrypted segment was not queued');
  await firstPage.controller.stop();
  assert.equal(firstPage.calls.prepare.length, 0);

  const restoredPage = createHarness({ indexedDB, online: true });
  const resumed = await restoredPage.controller.resume(startInput());
  assert.equal(resumed.submissionBlocked, false);
  assert.equal(resumed.pending, 1);
  assert.equal(restoredPage.calls.getUserMedia, 0, 'queue resume must not reopen camera or microphone permission');
  await waitFor(
    () => restoredPage.calls.complete.length === 1 && indexedDB.records.size === 0,
    'post-submit restored completion did not finish',
  );
  assert.equal(restoredPage.calls.prepare.length, 1);
  assert.equal(restoredPage.calls.uploadBodies.length, 1);
  assert.match(
    restoredPage.calls.statuses.map((entry) => entry.message).join(' '),
    /Submission remains complete/iu,
  );
});
