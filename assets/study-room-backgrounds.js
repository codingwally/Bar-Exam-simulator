(function dueDiligenceStudyRoomMandatoryBackground(global) {
  'use strict';

  const VERSION = 'study-room-mandatory-background-20260829-1';
  const REQUIRED_EFFECTS_POLICY = 'due-diligence-mandatory-virtual-background-no-raw-first-frame';
  const DEFAULT_IMAGE_PATH = '/assets/study-room/virtual-background-due-diligence-branded.webp';
  const DEFAULT_TASKS_VISION_PATH = '/assets/vendor/mediapipe/wasm';
  const DEFAULT_MODEL_PATH = '/assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite';

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
      destroyed: false,
      operation: Promise.resolve(),
      error: '',
    };

    function snapshot() {
      return Object.freeze({
        status: state.status,
        supported: state.supported,
        modern: state.modern,
        enabled: state.status === 'enabled',
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
          && effects.POLICY === REQUIRED_EFFECTS_POLICY
          && effects.MANDATORY_IMAGE_PATH === DEFAULT_IMAGE_PATH
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
          'This browser cannot safely apply the required Due Diligence background, so video remains off.',
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
        || processedTrack.readyState !== 'live'
        || track.mediaStreamTrack !== processedTrack
      ) {
        throw new StudyRoomBackgroundError(
          'STUDY_ROOM_BACKGROUND_NOT_LIVE',
          'The required Due Diligence background did not produce a protected video track, so video remains off.',
        );
      }
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

      // stopProcessor restores the raw source track on any still-attached
      // sender. Only call it after mute/unpublish has made that impossible.
      // LocalVideoTrack.stop() ends the camera and destroys its processor
      // without restoring the raw source on the sender, so it is the safe
      // terminal fallback when publication state is ambiguous.
      if (!couldBePublished || muted || unpublishConfirmed) {
        if (track?.getProcessor?.() === processor && typeof track?.stopProcessor === 'function') {
          await track.stopProcessor(false).catch(() => {});
        } else {
          await processor?.destroy?.().catch(() => {});
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
        await verifyImage(imagePath);
        track = await liveKit.createLocalVideoTrack(captureOptions || {});
        if (!track || typeof track.setProcessor !== 'function') {
          throw new StudyRoomBackgroundError(
            'STUDY_ROOM_BACKGROUND_CAMERA_UNAVAILABLE',
            'The camera did not create a usable local video track.',
          );
        }

        processor = effects.BackgroundProcessor({
          mode: 'virtual-background',
          imagePath,
          assetPaths: {
            tasksVisionFileSet: tasksVisionPath,
            modelAssetPath: modelPath,
          },
          maxFps,
          onFrameProcessed: options.onFrameProcessed,
        });
        await track.setProcessor(processor, true);
        assertProcessedTrack(track, processor);

        // Publication occurs only after a live processed track exists. The raw
        // camera track is never offered to the room or exposed by this API.
        publicationAttempted = true;
        publication = await participant.publishTrack(track, {
          ...(publishOptions || {}),
          source: liveKit.Track?.Source?.Camera || 'camera',
        });
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
            'The required Due Diligence background could not start, so video remains off.',
            error,
          );
        notify('unavailable', errorMessage(protectedError));
        throw protectedError;
      }
    }

    function enableCamera(captureOptions = {}, publishOptions = {}) {
      return enqueue(async () => {
        if (state.destroyed) ensureUsable();
        if (state.publication && state.track && state.processor) {
          notify('preparing');
          try {
            if (typeof state.publication.unmute !== 'function') {
              throw new Error('The existing camera publication cannot be restarted.');
            }
            await state.publication.unmute();
            if (state.publication.isMuted === true || state.track.isMuted === true) {
              throw new Error('The existing camera publication stayed muted.');
            }
            assertProcessedTrack(state.track, state.processor);
            notify('enabled');
            return Object.freeze({ enabled: true, publication: state.publication });
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
        } catch (error) {
          await cleanupMedia();
          notify('disabled');
          return stoppedResult('fail-closed');
        }
      });
    }

    function switchCamera(captureOptions = {}) {
      return enqueue(async () => {
        if (!state.track || !state.publication || !state.processor) {
          return createProtectedCamera(captureOptions, {});
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
        notify('destroyed');
      });
    }

    return Object.freeze({
      capabilities,
      destroy,
      disableCamera,
      enableCamera,
      snapshot,
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
      image.onload = resolve;
      image.onerror = () => reject(new StudyRoomBackgroundError(
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
  }

  global.DueDiligenceStudyRoomMandatoryBackground = Object.freeze({
    VERSION,
    createController,
  });
})(typeof window !== 'undefined' ? window : globalThis);
