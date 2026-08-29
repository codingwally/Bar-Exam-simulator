import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'assets/study-room-backgrounds.js');
const moduleSource = await readFile(modulePath, 'utf8');

function createHarness(overrides = {}) {
  const events = [];
  let processorOptions;
  let processor;
  let publication;

  const rawMediaTrack = { id: 'raw-camera', readyState: 'live' };
  const track = {
    isMuted: false,
    processor: null,
    get mediaStreamTrack() {
      return this.processor?.processedTrack || rawMediaTrack;
    },
    async setProcessor(nextProcessor, stopExistingProcessor) {
      events.push(`set-processor:${stopExistingProcessor}`);
      if (overrides.setProcessorFailure) throw new Error('processor init failed');
      this.processor = nextProcessor;
    },
    getProcessor() {
      return this.processor;
    },
    async stopProcessor() {
      events.push('stop-processor');
      const current = this.processor;
      this.processor = null;
      await current?.destroy?.();
    },
    stop() {
      events.push('stop-track');
      rawMediaTrack.readyState = 'ended';
    },
    async restartTrack() {
      events.push('restart-track');
      if (overrides.restartFailure) throw new Error('device switch failed');
    },
  };

  const effects = {
    POLICY: 'due-diligence-mandatory-virtual-background-no-raw-first-frame',
    MANDATORY_IMAGE_PATH: '/assets/study-room/virtual-background-due-diligence-branded.webp',
    supportsBackgroundProcessors() {
      events.push('check-support');
      return overrides.supported !== false;
    },
    supportsModernBackgroundProcessors() {
      events.push('check-modern-support');
      return overrides.modern !== false;
    },
    BackgroundProcessor(options) {
      processorOptions = options;
      events.push('create-processor');
      processor = {
        processedTrack: {
          id: 'protected-camera',
          readyState: overrides.processedReadyState || 'live',
        },
        async destroy() {
          events.push('destroy-processor');
        },
      };
      return processor;
    },
  };

  const liveKit = {
    Track: { Source: { Camera: 'camera' } },
    async createLocalVideoTrack() {
      events.push('create-raw-track-unpublished');
      return track;
    },
  };

  const participant = {
    async publishTrack(publishedTrack, publishOptions) {
      events.push('publish-track');
      assert.equal(publishedTrack, track);
      assert.equal(
        publishedTrack.mediaStreamTrack,
        processor?.processedTrack,
        'only the processed media track may be offered to LiveKit',
      );
      assert.equal(publishOptions.source, 'camera');
      if (overrides.publishFailure) throw new Error('publication failed ambiguously');
      publication = {
        track,
        isMuted: false,
        async unmute() {
          events.push('unmute-publication');
          this.isMuted = overrides.unmuteSticks === true;
          track.isMuted = overrides.unmuteSticks === true;
        },
      };
      if (overrides.muteAvailable !== false) {
        publication.mute = async function mute() {
          events.push('mute-publication');
          this.isMuted = overrides.muteSticks !== false;
          track.isMuted = overrides.muteSticks !== false;
        };
      }
      return publication;
    },
    async unpublishTrack(unpublishedTrack, stopOnUnpublish) {
      events.push(`unpublish-track:${stopOnUnpublish}`);
      assert.equal(unpublishedTrack, track);
      if (overrides.unpublishFailure) throw new Error('unpublish failed');
      if (overrides.unpublishReturnsNothing) return undefined;
      if (publication) publication.track = undefined;
      return publication || { track: undefined };
    },
  };

  const sandboxWindow = {};
  vm.runInNewContext(moduleSource, { window: sandboxWindow }, { filename: modulePath });
  const api = sandboxWindow.DueDiligenceStudyRoomMandatoryBackground;
  assert.ok(api, 'the standalone mandatory-background API must be installed');

  const controller = api.createController({
    effects,
    liveKit,
    localParticipant: participant,
    async verifyImage(imagePath) {
      events.push(`verify-image:${imagePath}`);
      if (overrides.imageFailure) throw new Error('image unavailable');
    },
  });

  return {
    api,
    controller,
    effects,
    events,
    get processor() { return processor; },
    get processorOptions() { return processorOptions; },
    get publication() { return publication; },
    participant,
    rawMediaTrack,
    track,
  };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, 'StudyRoomBackgroundError', error?.stack);
    assert.equal(error?.code, code);
    return true;
  });
}

{
  const harness = createHarness();
  const result = await harness.controller.enableCamera(
    { deviceId: 'camera-a' },
    { videoEncoding: { maxBitrate: 800_000 } },
  );
  assert.equal(result.enabled, true);
  assert.equal(harness.controller.snapshot().status, 'enabled');
  assert.equal(harness.processorOptions.mode, 'virtual-background');
  assert.equal(
    harness.processorOptions.imagePath,
    '/assets/study-room/virtual-background-due-diligence-branded.webp',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.processorOptions.assetPaths)),
    {
      tasksVisionFileSet: '/assets/vendor/mediapipe/wasm',
      modelAssetPath: '/assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite',
    },
  );
  assert.deepEqual(harness.events.slice(0, 7), [
    'check-support',
    'check-modern-support',
    'verify-image:/assets/study-room/virtual-background-due-diligence-branded.webp',
    'create-raw-track-unpublished',
    'create-processor',
    'set-processor:true',
    'publish-track',
  ]);
}

{
  const harness = createHarness({ supported: false });
  await rejectsWithCode(
    harness.controller.enableCamera(),
    'STUDY_ROOM_BACKGROUND_UNSUPPORTED',
  );
  assert.ok(!harness.events.some((event) => event.includes('create-raw-track')));
  assert.ok(!harness.events.includes('publish-track'));
}

{
  const harness = createHarness();
  delete harness.effects.POLICY;
  await rejectsWithCode(
    harness.controller.enableCamera(),
    'STUDY_ROOM_BACKGROUND_UNSUPPORTED',
  );
  assert.ok(!harness.events.some((event) => event.includes('create-raw-track')));
  assert.ok(!harness.events.includes('publish-track'));
}

{
  const harness = createHarness({ modern: false });
  const result = await harness.controller.enableCamera();
  assert.equal(result.enabled, true);
  assert.equal(harness.controller.snapshot().modern, false);
}

{
  const harness = createHarness({ imageFailure: true });
  await rejectsWithCode(
    harness.controller.enableCamera(),
    'STUDY_ROOM_BACKGROUND_START_FAILED',
  );
  assert.ok(!harness.events.some((event) => event.includes('create-raw-track')));
  assert.ok(!harness.events.includes('publish-track'));
}

for (const failure of [
  { setProcessorFailure: true },
  { processedReadyState: 'ended' },
]) {
  const harness = createHarness(failure);
  await rejectsWithCode(harness.controller.enableCamera(), failure.setProcessorFailure
    ? 'STUDY_ROOM_BACKGROUND_START_FAILED'
    : 'STUDY_ROOM_BACKGROUND_NOT_LIVE');
  assert.ok(!harness.events.includes('publish-track'));
  assert.ok(harness.events.includes('stop-track'));
  assert.equal(harness.rawMediaTrack.readyState, 'ended');
}

{
  const harness = createHarness({ publishFailure: true });
  await rejectsWithCode(
    harness.controller.enableCamera(),
    'STUDY_ROOM_BACKGROUND_START_FAILED',
  );
  assert.ok(harness.events.includes('publish-track'));
  assert.ok(harness.events.includes('unpublish-track:false'));
  assert.ok(harness.events.includes('stop-track'));
}

{
  const harness = createHarness({
    publishFailure: true,
    unpublishReturnsNothing: true,
  });
  await rejectsWithCode(
    harness.controller.enableCamera(),
    'STUDY_ROOM_BACKGROUND_START_FAILED',
  );
  assert.ok(harness.events.includes('unpublish-track:false'));
  assert.ok(!harness.events.includes('stop-processor'));
  assert.ok(harness.events.includes('stop-track'));
}

{
  const harness = createHarness();
  await harness.controller.enableCamera();
  const disabled = await harness.controller.disableCamera();
  assert.deepEqual(JSON.parse(JSON.stringify(disabled)), {
    enabled: false,
    reason: 'user-disabled',
  });
  const publishCount = harness.events.filter((event) => event === 'publish-track').length;
  await harness.controller.enableCamera();
  assert.equal(harness.events.filter((event) => event === 'publish-track').length, publishCount);
  assert.ok(harness.events.includes('unmute-publication'));
  assert.equal(harness.track.mediaStreamTrack, harness.processor.processedTrack);
}

{
  const harness = createHarness({ muteAvailable: false });
  await harness.controller.enableCamera();
  const disabled = await harness.controller.disableCamera();
  assert.equal(disabled.reason, 'fail-closed');
  assert.ok(harness.events.includes('unpublish-track:false'));
  assert.ok(harness.events.includes('stop-track'));
}

{
  const harness = createHarness({
    muteAvailable: false,
    unpublishFailure: true,
  });
  await harness.controller.enableCamera();
  const disabled = await harness.controller.disableCamera();
  assert.equal(disabled.reason, 'fail-closed');
  assert.ok(!harness.events.includes('stop-processor'));
  assert.ok(harness.events.includes('stop-track'));
}

{
  const harness = createHarness();
  await harness.controller.enableCamera();
  const cleanupStart = harness.events.length;
  await harness.controller.destroy();
  const cleanupEvents = harness.events.slice(cleanupStart);
  assert.ok(
    cleanupEvents.indexOf('unpublish-track:false') < cleanupEvents.indexOf('stop-processor'),
    'cleanup must unpublish before the processor is removed from the local track',
  );
  assert.equal(harness.controller.snapshot().status, 'destroyed');
}

{
  const harness = createHarness({ restartFailure: true });
  await harness.controller.enableCamera();
  await rejectsWithCode(
    harness.controller.switchCamera({ deviceId: 'camera-b' }),
    'STUDY_ROOM_BACKGROUND_DEVICE_SWITCH_FAILED',
  );
  assert.ok(harness.events.includes('mute-publication'));
  assert.ok(harness.events.includes('unpublish-track:false'));
  assert.ok(harness.events.includes('stop-track'));
  assert.equal(harness.controller.snapshot().status, 'unavailable');
}

assert.doesNotMatch(
  moduleSource,
  /background-blur|setCameraEnabled\s*\(\s*true|mode:\s*['"]disabled|options\.imagePath|setMicrophoneEnabled|disconnect\s*\(/,
);
assert.match(
  moduleSource,
  /createLocalVideoTrack[\s\S]*setProcessor[\s\S]*assertProcessedTrack[\s\S]*publishTrack/,
);

console.log('Mandatory Study Room background safety tests passed.');
