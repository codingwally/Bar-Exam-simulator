(function examinationRoomMediaCapture(global) {
  'use strict';

  var MEDIA_DB_NAME = 'duediligence-examination-room-media-v1';
  var MEDIA_DB_VERSION = 1;
  var CHUNK_MILLISECONDS = 30000;
  var ENCRYPTED_CHUNK_MAGIC = new Uint8Array([68, 68, 69, 82, 77, 86, 49, 0]); // DDERMV1\0
  var RETRY_DELAYS = [0, 1500, 5000, 15000, 45000];
  var MIME_CANDIDATES = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];

  function mediaError(code, message, cause) {
    var error = new Error(message);
    error.name = 'ExaminationRoomMediaError';
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunkSize = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function uuid() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12);
  }

  function openMediaDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(mediaError('MEDIA_STORAGE_UNAVAILABLE', 'This browser cannot keep an encrypted recording queue.'));
        return;
      }
      var request = global.indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains('chunks')) {
          var chunks = database.createObjectStore('chunks', { keyPath: 'artifactId' });
          chunks.createIndex('attemptId', 'attemptId', { unique: false });
          chunks.createIndex('status', 'status', { unique: false });
          chunks.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onerror = function () { reject(request.error || mediaError('MEDIA_STORAGE_UNAVAILABLE', 'The encrypted recording queue could not be opened.')); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }

  function transactionRequest(database, mode, callback) {
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction('chunks', mode);
      var store = transaction.objectStore('chunks');
      var result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = function () { resolve(result); };
      transaction.onerror = function () { reject(transaction.error || mediaError('MEDIA_STORAGE_UNAVAILABLE', 'The encrypted recording queue could not be updated.')); };
      transaction.onabort = function () { reject(transaction.error || mediaError('MEDIA_STORAGE_UNAVAILABLE', 'The encrypted recording queue update was interrupted.')); };
    });
  }

  function readAttemptChunks(database, attemptId) {
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction('chunks', 'readonly');
      var index = transaction.objectStore('chunks').index('attemptId');
      var request = index.getAll(attemptId);
      request.onsuccess = function () {
        resolve((request.result || []).sort(function (left, right) {
          return Number(left.sequence || 0) - Number(right.sequence || 0);
        }));
      };
      request.onerror = function () { reject(request.error || mediaError('MEDIA_STORAGE_UNAVAILABLE', 'The encrypted recording queue could not be read.')); };
    });
  }

  async function deriveAttemptKey(sessionToken, attemptId) {
    if (!global.crypto || !global.crypto.subtle) {
      throw mediaError('MEDIA_CRYPTO_UNAVAILABLE', 'This browser cannot encrypt recording segments.');
    }
    var encoder = new TextEncoder();
    var input = await global.crypto.subtle.importKey(
      'raw',
      encoder.encode(String(sessionToken)),
      'HKDF',
      false,
      ['deriveKey']
    );
    var salt = await global.crypto.subtle.digest('SHA-256', encoder.encode('DueDiligence Examination Room media\u0000' + attemptId));
    return global.crypto.subtle.deriveKey({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: encoder.encode('examination-room-media-v1')
    }, input, { name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  }

  function supportedMime(cameraEnabled) {
    if (!global.MediaRecorder) return '';
    var candidates = MIME_CANDIDATES.filter(function (value) {
      return cameraEnabled ? value.indexOf('video/') === 0 : value.indexOf('audio/') === 0;
    });
    return candidates.find(function (value) {
      return typeof global.MediaRecorder.isTypeSupported !== 'function' || global.MediaRecorder.isTypeSupported(value);
    }) || '';
  }

  async function postJson(path, body) {
    var base = String(global.DueDiligencePhase2Config && global.DueDiligencePhase2Config.workerUrl || '').replace(/\/+$/g, '');
    if (!base) throw mediaError('MEDIA_SERVICE_UNAVAILABLE', 'The recording upload service is not configured.');
    var response = await global.fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': uuid()
      },
      body: JSON.stringify(body)
    });
    var result = await response.json().catch(function () { return null; });
    if (!response.ok || !result || result.ok !== true) {
      var remote = result && result.error || {};
      throw mediaError(remote.code || 'MEDIA_SERVICE_UNAVAILABLE', remote.message || 'The recording upload service did not complete the request.');
    }
    return result;
  }

  async function putEncryptedChunk(recording, chunk) {
    var instruction = recording && recording.upload;
    if (!recording || recording.state === 'local_queue' || !instruction || !instruction.url) {
      throw mediaError('MEDIA_UPLOAD_DEFERRED', 'Encrypted recording remains queued on this device.');
    }
    var headers = Object.assign({}, instruction.headers || {}, {
      'Content-Type': 'application/octet-stream'
    });
    var response = await global.fetch(instruction.url, {
      method: instruction.method || 'PUT',
      headers: headers,
      body: chunk.encryptedBlob
    });
    if (!response.ok) {
      throw mediaError('MEDIA_UPLOAD_FAILED', 'Encrypted recording upload failed with status ' + response.status + '.');
    }
    var providerResult = await response.json().catch(function () { return {}; });
    return {
      provider: recording.provider,
      providerObjectId: providerResult && providerResult.id || null
    };
  }

  function createController(options) {
    options = options || {};
    var notify = typeof options.onStatus === 'function' ? options.onStatus : function () {};
    var database = null;
    var recorder = null;
    var stream = null;
    var key = null;
    var keyBase64 = '';
    var context = null;
    var sequence = 0;
    var lastChunkStartedAt = null;
    var flushPromise = null;
    var retryTimer = null;

    function status(state, message, extra) {
      try { notify(Object.assign({ state: state, message: message }, extra || {})); } catch (_) { /* UI reporting cannot break capture. */ }
    }

    async function storeChunk(blob) {
      if (!blob || blob.size === 0 || !context || !database || !key) return;
      var capturedTo = new Date().toISOString();
      var capturedFrom = lastChunkStartedAt || context.startedAt || capturedTo;
      lastChunkStartedAt = capturedTo;
      var artifactId = uuid();
      var iv = global.crypto.getRandomValues(new Uint8Array(12));
      var plain = await blob.arrayBuffer();
      var cipher = await global.crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv: iv,
        additionalData: new TextEncoder().encode(artifactId)
      }, key, plain);
      // The encrypted object is self-contained: version header, 12-byte AES-GCM IV,
      // then ciphertext and authentication tag. The wrapped key and artifact ID are
      // stored server-side; the artifact ID remains the authenticated additional data.
      var encryptedBytes = new Uint8Array(ENCRYPTED_CHUNK_MAGIC.byteLength + iv.byteLength + cipher.byteLength);
      encryptedBytes.set(ENCRYPTED_CHUNK_MAGIC, 0);
      encryptedBytes.set(iv, ENCRYPTED_CHUNK_MAGIC.byteLength);
      encryptedBytes.set(new Uint8Array(cipher), ENCRYPTED_CHUNK_MAGIC.byteLength + iv.byteLength);
      var checksum = await global.crypto.subtle.digest('SHA-256', encryptedBytes);
      var record = {
        artifactId: artifactId,
        attemptId: context.attemptId,
        examId: context.examId,
        artifactKind: context.cameraRequired ? 'camera_chunk' : 'microphone_chunk',
        sequence: ++sequence,
        objectSha256: bufferToHex(checksum),
        originalMimeType: blob.type || context.mimeType || (context.cameraRequired ? 'video/webm' : 'audio/webm'),
        encryptedBlob: new Blob([encryptedBytes], { type: 'application/octet-stream' }),
        capturedFrom: capturedFrom,
        capturedTo: capturedTo,
        status: 'queued',
        attempts: 0,
        createdAt: capturedTo,
        updatedAt: capturedTo
      };
      try {
        await transactionRequest(database, 'readwrite', function (store) { store.put(record); });
        status('queued', 'Recording is encrypted and queued for upload.', { pending: true });
        flush();
      } catch (error) {
        status('storage_full', 'Recording storage is full. Your examination remains open and answers continue saving.', { error: error });
        stopRecorderOnly();
      }
    }

    async function uploadOne(chunk) {
      var sharedPayload = {
        sessionId: chunk.attemptId,
        sessionToken: context.sessionToken,
        artifactId: chunk.artifactId,
        artifactKind: chunk.artifactKind,
        sourceMimeType: chunk.originalMimeType,
        encryptedSizeBytes: chunk.encryptedBlob.size,
        objectSha256: chunk.objectSha256,
        capturedFrom: chunk.capturedFrom,
        capturedTo: chunk.capturedTo
      };
      var provider = chunk.provider ? {
        provider: chunk.provider,
        providerObjectId: chunk.providerObjectId || null
      } : null;
      if (!provider) {
        var prepared = await postJson('/examination-room/v1/student/media', {
          operation: 'prepare_upload',
          idempotencyKey: 'media-prepare:' + chunk.artifactId,
          payload: Object.assign({}, sharedPayload, { derivedKey: keyBase64 })
        });
        var recording = prepared && prepared.recording;
        if (!recording || recording.state === 'local_queue' || recording.provider === 'local_queue') {
          throw mediaError('MEDIA_UPLOAD_DEFERRED', recording && recording.recovery || 'Recording remains queued on this device.');
        }
        provider = await putEncryptedChunk(recording, chunk);
        chunk.provider = provider.provider;
        chunk.providerObjectId = provider.providerObjectId;
        chunk.status = 'uploaded';
        chunk.updatedAt = new Date().toISOString();
        delete chunk.sessionToken;
        await transactionRequest(database, 'readwrite', function (store) { store.put(chunk); });
      }
      var completed = await postJson('/examination-room/v1/student/media', {
        operation: 'complete_upload',
        idempotencyKey: 'media-complete:' + chunk.artifactId,
        payload: Object.assign({}, sharedPayload, {
          provider: provider.provider,
          providerObjectId: provider.providerObjectId
        })
      });
      if (!completed.recording || completed.recording.state !== 'completed') {
        throw mediaError('MEDIA_COMPLETION_DEFERRED', completed.recording && completed.recording.recovery || 'Recording completion remains queued.');
      }
      await transactionRequest(database, 'readwrite', function (store) { store.delete(chunk.artifactId); });
    }

    async function flush() {
      if (flushPromise || !database || !context || !global.navigator.onLine) return flushPromise;
      flushPromise = (async function () {
        if (retryTimer) {
          global.clearTimeout(retryTimer);
          retryTimer = null;
        }
        while (global.navigator.onLine) {
          var chunks = await readAttemptChunks(database, context.attemptId);
          if (!chunks.length) break;
          var blocked = false;
          for (var index = 0; index < chunks.length; index += 1) {
            var chunk = chunks[index];
            try {
              await uploadOne(chunk);
              status('active', recorder && recorder.state === 'recording'
                ? 'Camera and microphone recording is encrypted and backed up.'
                : 'Encrypted recording backup is complete.');
            } catch (error) {
              chunk.attempts = Number(chunk.attempts || 0) + 1;
              chunk.updatedAt = new Date().toISOString();
              chunk.status = chunk.provider ? 'uploaded' : 'queued';
              delete chunk.sessionToken;
              await transactionRequest(database, 'readwrite', function (store) { store.put(chunk); });
              status('queued', 'Recording is safely queued on this device. Answers and submission are not affected.', { error: error });
              if (global.navigator.onLine) {
                var retryDelay = RETRY_DELAYS[Math.min(chunk.attempts, RETRY_DELAYS.length - 1)];
                retryTimer = global.setTimeout(function () {
                  retryTimer = null;
                  flush();
                }, retryDelay);
              }
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
      })().finally(function () { flushPromise = null; });
      return flushPromise;
    }

    function stopRecorderOnly() {
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (_) { /* already stopping */ }
      }
      if (stream) {
        stream.getTracks().forEach(function (track) { track.stop(); });
      }
      recorder = null;
      stream = null;
    }

    async function initialiseQueue(input) {
      context = Object.assign({}, input || {});
      if (!context.attemptId || !context.sessionToken) {
        throw mediaError('MEDIA_SESSION_UNAVAILABLE', 'The encrypted recording queue could not match this examination session.');
      }
      database = database || await openMediaDatabase();
      if (global.navigator.storage && typeof global.navigator.storage.persist === 'function') {
        global.navigator.storage.persist().catch(function () {});
      }
      key = await deriveAttemptKey(context.sessionToken, context.attemptId);
      keyBase64 = bytesToBase64(new Uint8Array(await global.crypto.subtle.exportKey('raw', key)));
      var existing = await readAttemptChunks(database, context.attemptId);
      sequence = existing.reduce(function (highest, chunk) { return Math.max(highest, Number(chunk.sequence || 0)); }, 0);
      return existing;
    }

    async function start(input) {
      context = Object.assign({}, input || {});
      if (!context.cameraRequired && !context.microphoneRequired) {
        status('disabled', 'No camera or microphone recording was selected for this examination.');
        return { active: false, reason: 'not_selected' };
      }
      if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia || !global.MediaRecorder) {
        status('unavailable', 'Recording is unavailable in this browser. Your examination remains open.', { recoverable: true });
        return { active: false, reason: 'browser_unavailable' };
      }
      try {
        await initialiseQueue(context);
        context.mimeType = supportedMime(context.cameraRequired);
        status('requesting', 'Your browser is requesting camera and microphone access.');
        stream = await global.navigator.mediaDevices.getUserMedia({
          video: context.cameraRequired ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 12, max: 15 } } : false,
          audio: context.microphoneRequired ? { echoCancellation: true, noiseSuppression: true, channelCount: 1 } : false
        });
        recorder = new global.MediaRecorder(stream, Object.assign({
          videoBitsPerSecond: context.cameraRequired ? 350000 : undefined,
          audioBitsPerSecond: context.microphoneRequired ? 32000 : undefined
        }, context.mimeType ? { mimeType: context.mimeType } : {}));
        lastChunkStartedAt = new Date().toISOString();
        context.startedAt = context.startedAt || lastChunkStartedAt;
        recorder.ondataavailable = function (event) {
          storeChunk(event.data).catch(function (error) {
            status('queued', 'A recording segment could not be prepared. Your examination remains open.', { error: error });
          });
        };
        recorder.onerror = function (event) {
          status('unavailable', 'Recording stopped unexpectedly. Your answers and examination remain available.', { error: event && event.error });
        };
        recorder.start(CHUNK_MILLISECONDS);
        status('active', 'Camera and microphone recording is active and encrypted.');
        flush();
        return { active: true };
      } catch (error) {
        stopRecorderOnly();
        status('permission_denied', 'Camera or microphone was not available. Your examination remains open and answers continue saving.', { error: error, recoverable: true });
        return { active: false, reason: error && error.name || 'start_failed' };
      }
    }

    async function resume(input) {
      try {
        var existing = await initialiseQueue(input);
        if (!existing.length) {
          status('disabled', 'No encrypted recording uploads are pending.');
          return { active: false, pending: 0, submissionBlocked: false };
        }
        status('finishing', 'Finishing encrypted recording backup after submission. Submission remains complete.', {
          pending: existing.length
        });
        flush();
        return { active: false, pending: existing.length, submissionBlocked: false };
      } catch (error) {
        status('queued', 'Encrypted recording backup will retry when this device can resume it. Submission remains complete.', {
          error: error,
          recoverable: true
        });
        return { active: false, pending: null, submissionBlocked: false, reason: error && error.code || 'resume_failed' };
      }
    }

    async function stop() {
      stopRecorderOnly();
      status('finishing', 'Finishing the encrypted recording queue. Submission is not delayed.');
      global.setTimeout(function () { flush(); }, 250);
    }

    global.addEventListener('online', function () { flush(); });

    return Object.freeze({ start: start, resume: resume, stop: stop, flush: flush });
  }

  global.ExaminationRoomMediaCapture = Object.freeze({
    create: createController,
    databaseName: MEDIA_DB_NAME
  });
})(window);
