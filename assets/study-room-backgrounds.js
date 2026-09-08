(function dueDiligenceStudyRoomMandatoryBackground(global) {
  'use strict';

  const VERSION = 'study-room-background-images-20260908-1';
  const REQUIRED_EFFECTS_POLICY = 'due-diligence-mandatory-virtual-background-no-raw-first-frame';
  const DEFAULT_IMAGE_PATH = '/assets/study-room/virtual-background-due-diligence-polished-20260908.webp';
  const DEFAULT_TASKS_VISION_PATH = '/assets/vendor/mediapipe/wasm';
  const DEFAULT_MODEL_PATH = '/assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite';
  const MAX_CUSTOM_BYTES = 5 * 1024 * 1024;
  const MAX_CUSTOM_DIMENSION = 4096;
  const registeredCustomImages = new Set();

  function isSameOriginBlob(imagePath) {
    if (typeof imagePath !== 'string') return false;
    try {
      const url = new global.URL(imagePath);
      return url.protocol === 'blob:' && url.origin === global.location?.origin
        && /^https?:$/.test(global.location?.protocol || '');
    } catch { return false; }
  }
  function isRegisteredCustomImage(imagePath) {
    return registeredCustomImages.has(imagePath) && isSameOriginBlob(imagePath);
  }

  function imageBounds(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > MAX_CUSTOM_DIMENSION || height > MAX_CUSTOM_DIMENSION) {
      throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_LIMIT', 'Choose an image no larger than 4096 × 4096 pixels.');
    }
    return Object.freeze({ width, height });
  }

  // Inspect bounded raster headers BEFORE decoding; a tiny compressed image must
  // not allocate an unbounded bitmap. SVG/GIF/unknown and animated WebP are not accepted.
  function rasterBounds(bytes, type) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at, text) => bytes.length >= at + text.length
      && [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
    if (type === 'image/png' && bytes.length >= 24
      && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
      && tag(12, 'IHDR')) return imageBounds(view.getUint32(16), view.getUint32(20));
    if (type === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (bytes[offset] === 255) offset += 1;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (offset + 2 > bytes.length) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)
          && length >= 8) return imageBounds(view.getUint16(offset + 5), view.getUint16(offset + 3));
        offset += length;
      }
    }
    if (type === 'image/webp' && bytes.length >= 30 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
      if (tag(12, 'VP8X') && !(bytes[20] & 2)) {
        return imageBounds(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
          1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
      }
      if (tag(12, 'VP8 ') && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
        return imageBounds(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383);
      if (tag(12, 'VP8L') && bytes[20] === 47) {
        const bits = view.getUint32(21, true);
        return imageBounds(1 + (bits & 16383), 1 + ((bits >>> 14) & 16383));
      }
    }
    throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_TYPE', 'Choose a valid PNG, JPEG or static WebP image.');
  }

  class StudyRoomBackgroundError extends Error {
    constructor(code, message, cause) {
      super(message, cause ? { cause } : undefined);
      this.name = 'StudyRoomBackgroundError';
      this.code = code;
    }
  }

  function errorMessage(error) {
    return String(error?.message || '').trim() || 'The protected camera could not start.';
  }

  function stoppedResult(reason) {
    return Object.freeze({ enabled: false, reason });
  }

  function createController(options = {}) {
    const getLocalParticipant = typeof options.getLocalParticipant === 'function'
      ? options.getLocalParticipant
      : () => options.localParticipant || null;
    const resolveEffects = () => options.effects || global.LivekitTrackProcessors || null;
    const resolveLiveKit = () => options.liveKit || global.LivekitClient || null;
    const onStateChange = typeof options.onStateChange === 'function'
      ? options.onStateChange
      : () => {};
    const verifyImage = typeof options.verifyImage === 'function'
      ? options.verifyImage
      : verifyBackgroundImage;
    const imagePath = DEFAULT_IMAGE_PATH;
    const tasksVisionPath = DEFAULT_TASKS_VISION_PATH;
    const modelPath = DEFAULT_MODEL_PATH;
    const maxFps = Number.isFinite(options.maxFps)
      ? Math.max(1, Math.min(30, Number(options.maxFps)))
      : 20;

    const state = {
      status: 'idle',
      supported: null,
      modern: null,
      track: null,
      publication: null,
      processor: null,
      mode: 'disabled',
      requestedMode: Object.freeze({ mode: 'disabled' }),
      pendingMode: null,
      switchPromise: null,
      verifiedImagePath: '',
      fallbackRaw: false,
      destroyed: false,
      operation: Promise.resolve(),
      error: '',
    };
    const customImages = new Set();
    let pendingCustomImages = 0;

    function snapshot() {
      return Object.freeze({
        status: state.status,
        supported: state.supported,
        modern: state.modern,
        enabled: state.status === 'enabled',
        mode: state.mode,
        processorAttached: Boolean(
          state.track
          && state.processor
          && state.track.getProcessor?.() === state.processor,
        ),
        fallbackRaw: state.fallbackRaw,
        error: state.error,
      });
    }

    function notify(status, error = '') {
      state.status = status;
      state.error = error;
      onStateChange(snapshot());
    }

    function capabilities() {
      const effects = resolveEffects();
      try {
        state.supported = Boolean(
          effects
          && typeof effects.BackgroundProcessor === 'function'
          && typeof effects.supportsBackgroundProcessors === 'function'
          && effects.supportsBackgroundProcessors(),
        );
        state.modern = Boolean(
          state.supported
          && typeof effects.supportsModernBackgroundProcessors === 'function'
          && effects.supportsModernBackgroundProcessors(),
        );
      } catch {
        state.supported = false;
        state.modern = false;
      }
      return Object.freeze({ supported: state.supported, modern: state.modern });
    }

    function enqueue(operation) {
      const run = state.operation.catch(() => {}).then(operation);
      state.operation = run;
      return run;
    }

    function ensureUsable() {
      if (state.destroyed) {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_DESTROYED',
          'The protected camera has already been closed.',
        );
      }
      const support = capabilities();
      if (!support.supported) {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_UNSUPPORTED',
          'Background effects are unavailable in this browser, so the camera can continue without them.',
        );
      }
      const liveKit = resolveLiveKit();
      if (!liveKit || typeof liveKit.createLocalVideoTrack !== 'function') {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_LIBRARY_UNAVAILABLE',
          'The protected camera library is unavailable, so video remains off.',
        );
      }
      return { effects: resolveEffects(), liveKit };
    }

    function assertProcessedTrack(track, processor) {
      const processedTrack = processor?.processedTrack;
      if (
        !track
        || typeof track.setProcessor !== 'function'
        || track.getProcessor?.() !== processor
        || !processedTrack
        || String(processedTrack.readyState || '').toLowerCase() !== 'live'
        || processedTrack.enabled === false
        || track.mediaStreamTrack !== processedTrack
      ) {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_NOT_LIVE',
          'The background processor did not produce a live video track, so video remains off.',
        );
      }
    }

    function normalizeMode(request = {}) {
      const requestedMode = typeof request === 'string' ? request : request?.mode;
      if (requestedMode === 'background-blur') {
        const blurRadius = Number(request?.blurRadius);
        return Object.freeze({
          mode: 'background-blur',
          blurRadius: Number.isFinite(blurRadius) ? Math.max(0, blurRadius) : 10,
        });
      }
      if (requestedMode === 'virtual-background') {
        const selectedPath = typeof request === 'string' ? imagePath : request?.imagePath || imagePath;
        if (selectedPath !== imagePath && (!customImages.has(selectedPath) || !isRegisteredCustomImage(selectedPath))) {
          throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_NOT_REGISTERED', 'Choose a background from this device first.');
        }
        return Object.freeze({
          mode: 'virtual-background',
          imagePath: selectedPath,
        });
      }
      return Object.freeze({ mode: 'disabled' });
    }

    async function applyProcessorMode(track, processor, request) {
      const nextMode = normalizeMode(request);
      if (!processor || typeof processor.switchTo !== 'function') {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_SWITCH_UNAVAILABLE',
          'Background effects could not be switched safely, so the camera remains available without them.',
        );
      }
      if (nextMode.mode === 'virtual-background' && state.verifiedImagePath !== nextMode.imagePath) {
        await verifyImage(nextMode.imagePath);
        state.verifiedImagePath = nextMode.imagePath;
      }
      await processor.switchTo(nextMode);
      assertProcessedTrack(track, processor);
      state.mode = nextMode.mode;
      state.requestedMode = nextMode;
      return nextMode;
    }

    async function registerCustomBackground(blob) {
      if (state.destroyed) ensureUsable();
      if (typeof global.Blob !== 'function' || !(blob instanceof global.Blob)
        || !['image/png','image/jpeg','image/webp'].includes(blob.type)
        || blob.size < 1 || blob.size > MAX_CUSTOM_BYTES || customImages.size + pendingCustomImages >= 4) {
        throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_LIMIT', 'Choose a PNG, JPEG or WebP image up to 5 MB; remove an unused custom background before adding another.');
      }
      pendingCustomImages += 1;
      let localPath;
      try {
        rasterBounds(new Uint8Array(await blob.arrayBuffer()), blob.type);
        if (state.destroyed) ensureUsable();
        localPath = global.URL.createObjectURL(blob);
        if (!isSameOriginBlob(localPath)) {
          throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_NOT_REGISTERED', 'Local background images are unavailable in this browser.');
        }
        const decoded = await verifyImage(localPath);
        imageBounds(decoded?.width, decoded?.height);
        if (state.destroyed || customImages.size >= 4) throw new Error('Background image selection is no longer active.');
        customImages.add(localPath);
        registeredCustomImages.add(localPath);
        return Object.freeze({ imagePath: localPath, width: decoded.width, height: decoded.height });
      } catch (error) {
        registeredCustomImages.delete(localPath);
        if (localPath) global.URL.revokeObjectURL(localPath);
        throw error;
      } finally {
        pendingCustomImages -= 1;
      }
    }

    function removeCustomBackground(localPath) {
      if (!customImages.has(localPath)) return false;
      if (state.requestedMode.imagePath === localPath || state.pendingMode?.imagePath === localPath
        || state.processor?.imagePath === localPath || state.verifiedImagePath === localPath && state.mode === 'virtual-background') {
        throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_IMAGE_IN_USE', 'Choose a different background before removing this image.');
      }
      customImages.delete(localPath);
      registeredCustomImages.delete(localPath);
      global.URL.revokeObjectURL(localPath);
      return true;
    }

    async function safelyMutePublication(publication) {
      try {
        if (typeof publication?.mute !== 'function') return false;
        await publication.mute();
        return publication.isMuted === true || publication.track?.isMuted === true;
      } catch {
        // Cleanup below removes the publication entirely when muting is unavailable.
        return false;
      }
    }

    async function disposeMedia({
      participant,
      publication,
      track,
      processor,
      publicationAttempted = false,
      unpublish = true,
    }) {
      const couldBePublished = Boolean(publication || publicationAttempted);
      const muted = await safelyMutePublication(publication);
      let unpublishConfirmed = !couldBePublished;

      if (unpublish && participant && track && typeof participant.unpublishTrack === 'function') {
        try {
          const removedPublication = await participant.unpublishTrack(track, false);
          unpublishConfirmed = Boolean(
            removedPublication
            || (publication && !publication.track),
          );
        } catch {
          unpublishConfirmed = false;
        }
      }

      // Processor removal is terminal cleanup only. During normal mode changes
      // the track and processor remain attached and switchTo is used instead.
      if (!couldBePublished || muted || unpublishConfirmed) {
        if (track?.getProcessor?.() === processor && typeof track?.stopProcessor === 'function') {
          await track.stopProcessor(false).catch(() => {});
        } else if (processor && track?.getProcessor?.() !== processor) {
          await processor.destroy?.().catch(() => {});
        }
      }
      track?.stop?.();
    }

    async function cleanupMedia({ participant = getLocalParticipant(), unpublish = true } = {}) {
      const publication = state.publication;
      const track = state.track;
      const processor = state.processor;
      state.publication = null;
      state.track = null;
      state.processor = null;
      state.pendingMode = null;
      state.fallbackRaw = false;

      await disposeMedia({ participant, publication, track, processor, unpublish });
    }

    async function createProtectedCamera(captureOptions = {}, publishOptions = {}) {
      const participant = getLocalParticipant();
      if (!participant || typeof participant.publishTrack !== 'function') {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_ROOM_UNAVAILABLE',
          'Connect to the Study Room before starting the protected camera.',
        );
      }
      const { effects, liveKit } = ensureUsable();
      notify('preparing');

      let track;
      let processor;
      let publication;
      let publicationAttempted = false;
      try {
        track = await liveKit.createLocalVideoTrack(captureOptions || {});
        if (!track || typeof track.setProcessor !== 'function') {
          throw new StudyRoomBackgroundError(
            'STUDY_ROOM_BACKGROUND_CAMERA_UNAVAILABLE',
            'The camera did not create a usable local video track.',
          );
        }

        // Attach one disabled processor for this camera lifecycle. Mode changes
        // below update this same processor rather than replacing the track.
        processor = effects.BackgroundProcessor({
          mode: 'disabled',
          assetPaths: {
            tasksVisionFileSet: tasksVisionPath,
            modelAssetPath: modelPath,
          },
          maxFps,
          onFrameProcessed: options.onFrameProcessed,
        });
        await track.setProcessor(processor, true);
        assertProcessedTrack(track, processor);

        const initialMode = normalizeMode(state.requestedMode);
        if (initialMode.mode !== 'disabled') {
          await applyProcessorMode(track, processor, initialMode);
        }

        if (state.destroyed) {
          throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_DESTROYED', 'The camera was closed before publication.');
        }
        publicationAttempted = true;
        publication = await participant.publishTrack(track, {
          ...(publishOptions || {}),
          source: liveKit.Track?.Source?.Camera || 'camera',
        });
        if (state.destroyed) {
          throw new StudyRoomBackgroundError('STUDY_ROOM_BACKGROUND_DESTROYED', 'The camera was closed during publication.');
        }
        if (!publication || publication.track !== track) {
          throw new StudyRoomBackgroundError(
            'STUDY_ROOM_BACKGROUND_PUBLISH_FAILED',
            'The protected video track could not be published, so video remains off.',
          );
        }
        assertProcessedTrack(track, processor);
        state.track = track;
        state.processor = processor;
        state.publication = publication;
        state.fallbackRaw = false;
        notify('enabled');
        return Object.freeze({ enabled: true, publication });
      } catch (error) {
        await disposeMedia({
          participant,
          publication,
          track,
          processor,
          publicationAttempted,
        });
        const protectedError = error instanceof StudyRoomBackgroundError
          ? error
          : new StudyRoomBackgroundError(
            'STUDY_ROOM_BACKGROUND_START_FAILED',
            'The background processor could not start, so video remains off.',
            error,
          );
        notify('unavailable', errorMessage(protectedError));
        throw protectedError;
      }
    }

    function enableCamera(captureOptions = {}, publishOptions = {}) {
      return enqueue(async () => {
        if (state.destroyed) ensureUsable();
        if (state.publication && state.track) {
          notify('preparing');
          try {
            if (typeof state.publication.unmute !== 'function') {
              throw new Error('The existing camera publication cannot be restarted.');
            }
            await state.publication.unmute();
            if (state.publication.isMuted === true || state.track.isMuted === true) {
              throw new Error('The existing camera publication stayed muted.');
            }
            if (state.processor) assertProcessedTrack(state.track, state.processor);
            notify('enabled');
            return Object.freeze({ enabled: true, publication: state.publication, fallbackRaw: state.fallbackRaw });
          } catch (error) {
            await cleanupMedia();
            const protectedError = new StudyRoomBackgroundError(
              'STUDY_ROOM_BACKGROUND_RESTART_FAILED',
              'The protected camera could not restart, so video remains off.',
              error,
            );
            notify('unavailable', protectedError.message);
            throw protectedError;
          }
        }
        return createProtectedCamera(captureOptions, publishOptions);
      });
    }

    function disableCamera() {
      return enqueue(async () => {
        if (!state.publication) {
          notify('disabled');
          return stoppedResult('already-disabled');
        }
        try {
          const muted = await safelyMutePublication(state.publication);
          if (!muted) {
            await cleanupMedia();
            notify('disabled');
            return stoppedResult('fail-closed');
          }
          notify('disabled');
          return stoppedResult('user-disabled');
        } catch {
          await cleanupMedia();
          notify('disabled');
          return stoppedResult('fail-closed');
        }
      });
    }

    function switchBackground(request = { mode: 'disabled' }) {
      const nextMode = normalizeMode(request);
      state.requestedMode = nextMode;
      state.pendingMode = nextMode;
      if (state.switchPromise) return state.switchPromise;

      const promise = enqueue(async () => {
        try {
          while (state.pendingMode) {
            const pendingMode = state.pendingMode;
            state.pendingMode = null;
            state.requestedMode = pendingMode;
            if (!state.track || !state.processor) {
              state.mode = pendingMode.mode;
              notify(state.status === 'disabled' ? 'disabled' : state.status);
              continue;
            }
            notify('preparing');
            try {
              await applyProcessorMode(state.track, state.processor, pendingMode);
              notify(state.publication && !state.publication.isMuted ? 'enabled' : 'disabled');
            } catch (error) {
              // A selected backdrop failing must never silently reveal the real
              // room. Stop the publication; raw camera requires a separate user action.
              await cleanupMedia();
              state.mode = 'disabled';
              // Retain the latest requested selection (including a newer queued
              // explicit Off). Failure itself must never select a raw view.
              state.fallbackRaw = false;
              const protectedError = error instanceof StudyRoomBackgroundError
                ? error
                : new StudyRoomBackgroundError(
                  'STUDY_ROOM_BACKGROUND_SWITCH_FAILED',
                  'The background could not be applied. Camera is off; choose another image or explicitly use your camera without a backdrop.',
                  error,
                );
              notify('unavailable', errorMessage(protectedError));
              throw protectedError;
            }
          }
          return snapshot();
        } finally {
          state.switchPromise = null;
        }
      });
      state.switchPromise = promise;
      return promise;
    }

    function switchCamera(captureOptions = {}) {
      return enqueue(async () => {
        if (!state.track || !state.publication) return createProtectedCamera(captureOptions, {});
        if (!state.processor) {
          try {
            await state.track.restartTrack(captureOptions || {});
            notify('enabled');
            return Object.freeze({ enabled: true, publication: state.publication, fallbackRaw: true });
          } catch (error) {
            await cleanupMedia();
            const protectedError = new StudyRoomBackgroundError(
              'STUDY_ROOM_BACKGROUND_DEVICE_SWITCH_FAILED',
              'The camera could not switch devices, so video remains off.',
              error,
            );
            notify('unavailable', protectedError.message);
            throw protectedError;
          }
        }
        notify('preparing');
        try {
          await state.track.restartTrack(captureOptions || {});
          assertProcessedTrack(state.track, state.processor);
          notify('enabled');
          return Object.freeze({ enabled: true, publication: state.publication });
        } catch (error) {
          await cleanupMedia();
          const protectedError = new StudyRoomBackgroundError(
            'STUDY_ROOM_BACKGROUND_DEVICE_SWITCH_FAILED',
            'The protected camera could not switch devices, so video remains off.',
            error,
          );
          notify('unavailable', protectedError.message);
          throw protectedError;
        }
      });
    }

    function destroy() {
      if (state.destroyed) return state.operation.catch(() => {});
      state.destroyed = true;
      return enqueue(async () => {
        await cleanupMedia();
        for (const localPath of customImages) {
          registeredCustomImages.delete(localPath);
          global.URL.revokeObjectURL(localPath);
        }
        customImages.clear();
        notify('destroyed');
      });
    }

    return Object.freeze({
      capabilities,
      destroy,
      disableCamera,
      enableCamera,
      registerCustomBackground,
      removeCustomBackground,
      snapshot,
      switchBackground,
      switchCamera,
    });
  }

  async function verifyBackgroundImage(imagePath) {
    if (!imagePath || typeof global.Image !== 'function') {
      throw new StudyRoomBackgroundError(
        'STUDY_ROOM_BACKGROUND_IMAGE_UNAVAILABLE',
        'The required Due Diligence background image is unavailable.',
      );
    }
    const image = new global.Image();
    image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      const timer = global.setTimeout(() => finish(new StudyRoomBackgroundError(
        'STUDY_ROOM_BACKGROUND_IMAGE_UNAVAILABLE', 'The background image took too long to load.')), 10000);
      const finish = (error) => {
        global.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve();
      };
      image.onload = () => finish();
      image.onerror = () => finish(new StudyRoomBackgroundError(
        'STUDY_ROOM_BACKGROUND_IMAGE_UNAVAILABLE',
        'The required Due Diligence background image could not load.',
      ));
      image.src = imagePath;
    });
    if (typeof image.decode === 'function') await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new StudyRoomBackgroundError(
        'STUDY_ROOM_BACKGROUND_IMAGE_INVALID',
        'The required Due Diligence background image is invalid.',
      );
    }
    return Object.freeze({ width: image.naturalWidth, height: image.naturalHeight });
  }

  global.DueDiligenceStudyRoomMandatoryBackground = Object.freeze({
    VERSION,
    createController,
    isRegisteredCustomImage,
  });
})(typeof window !== 'undefined' ? window : globalThis);
