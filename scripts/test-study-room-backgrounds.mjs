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
  let switchCount = 0;
  let activeSwitches = 0;
  let maxConcurrentSwitches = 0;
  let resolveFirstSwitch;
  let releaseFirstSwitch;
  const firstSwitchStarted = new Promise((resolve) => { resolveFirstSwitch = resolve; });
  const firstSwitchGate = new Promise((resolve) => { releaseFirstSwitch = resolve; });

  const rawMediaTrack = {
    id: 'raw-camera',
    kind: 'video',
    readyState: 'live',
    enabled: true,
  };
  const processedMediaTrack = {
    id: 'processed-camera',
    kind: 'video',
    readyState: 'live',
    enabled: true,
  };
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
      processedMediaTrack.readyState = 'ended';
    },
    async restartTrack() {
      events.push('restart-track');
      if (overrides.restartFailure) throw new Error('device switch failed');
      rawMediaTrack.readyState = 'live';
      processedMediaTrack.readyState = 'live';
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
      events.push(`create-processor:${options.mode}`);
      processor = {
        mode: options.mode,
        imagePath: options.imagePath,
        blurRadius: options.blurRadius,
        processedTrack: processedMediaTrack,
        async switchTo(nextOptions) {
          switchCount += 1;
          activeSwitches += 1;
          maxConcurrentSwitches = Math.max(maxConcurrentSwitches, activeSwitches);
          events.push(`switch-to:${nextOptions.mode}`);
          if (activeSwitches > 1) throw new Error('overlapping processor switch');
          if (switchCount === 1) resolveFirstSwitch();
          if (overrides.blockFirstSwitch && switchCount === 1) await firstSwitchGate;
          if (overrides.switchFailure) {
            activeSwitches -= 1;
            throw new Error('processor switch failed');
          }
          this.mode = nextOptions.mode;
          this.imagePath = nextOptions.imagePath;
          this.blurRadius = nextOptions.blurRadius;
          activeSwitches -= 1;
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
        'only the processor output may be offered to LiveKit',
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
  assert.ok(api, 'the Study Room background API must be installed');

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
    firstSwitchStarted,
    releaseFirstSwitch,
    get maxConcurrentSwitches() { return maxConcurrentSwitches; },
    get processor() { return processor; },
    get processorOptions() { return processorOptions; },
    get publication() { return publication; },
    participant,
    rawMediaTrack,
    processedMediaTrack,
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
  assert.equal(harness.controller.snapshot().mode, 'disabled');
  assert.equal(harness.processorOptions.mode, 'disabled');
  assert.equal(harness.processorOptions.imagePath, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.processorOptions.assetPaths)),
    {
      tasksVisionFileSet: '/assets/vendor/mediapipe/wasm',
      modelAssetPath: '/assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite',
    },
  );
  assert.deepEqual(harness.events.slice(0, 6), [
    'check-support',
    'check-modern-support',
    'create-raw-track-unpublished',
    'create-processor:disabled',
    'set-processor:true',
    'publish-track',
  ]);
  assert.equal(harness.events.filter((event) => event === 'set-processor:true').length, 1);
  assert.equal(harness.events.filter((event) => event.startsWith('switch-to:')).length, 0);
  assert.equal(harness.events.filter((event) => event.startsWith('verify-image:')).length, 0);
}

{
  const harness = createHarness();
  await harness.controller.enableCamera();
  const originalTrack = harness.track;
  const originalProcessor = harness.processor;
  const originalPublication = harness.publication;

  await harness.controller.switchBackground({
    mode: 'virtual-background',
    imagePath: '/assets/study-room/virtual-background-due-diligence-branded.webp',
  });
  assert.equal(harness.controller.snapshot().mode, 'virtual-background');
  assert.equal(harness.processor, originalProcessor);
  assert.equal(harness.track, originalTrack);
  assert.equal(harness.publication, originalPublication);
  assert.equal(harness.processor.mode, 'virtual-background');
  assert.equal(harness.track.mediaStreamTrack, harness.processedMediaTrack);

  await harness.controller.switchBackground({ mode: 'background-blur', blurRadius: 14 });
  assert.equal(harness.controller.snapshot().mode, 'background-blur');
  assert.equal(harness.processor.mode, 'background-blur');
  assert.equal(harness.processor.blurRadius, 14);

  await harness.controller.switchBackground({ mode: 'disabled' });
  assert.equal(harness.controller.snapshot().mode, 'disabled');
  assert.equal(harness.processor.mode, 'disabled');
  assert.equal(harness.events.filter((event) => event === 'set-processor:true').length, 1);
  assert.equal(harness.events.filter((event) => event === 'create-raw-track-unpublished').length, 1);
  assert.equal(harness.events.filter((event) => event === 'publish-track').length, 1);
  assert.deepEqual(harness.events.filter((event) => event.startsWith('switch-to:')), [
    'switch-to:virtual-background',
    'switch-to:background-blur',
    'switch-to:disabled',
  ]);
}

{
  const harness = createHarness({ blockFirstSwitch: true });
  await harness.controller.enableCamera();
  const first = harness.controller.switchBackground({ mode: 'background-blur' });
  await harness.firstSwitchStarted;
  const second = harness.controller.switchBackground({ mode: 'virtual-background' });
  const third = harness.controller.switchBackground({ mode: 'disabled' });
  assert.equal(first, second, 'rapid mode changes must share one serialized operation');
  assert.equal(second, third, 'rapid mode changes must coalesce to one operation');
  harness.releaseFirstSwitch();
  const result = await first;
  assert.equal(result.mode, 'disabled', 'the last rapid selection must win');
  assert.equal(harness.controller.snapshot().mode, 'disabled');
  assert.equal(harness.maxConcurrentSwitches, 1, 'processor switches must never overlap');
  assert.deepEqual(harness.events.filter((event) => event.startsWith('switch-to:')), [
    'switch-to:background-blur',
    'switch-to:disabled',
  ]);
}

{
  const harness = createHarness();
  await harness.controller.enableCamera();
  const originalTrack = harness.track;
  const originalProcessor = harness.processor;
  const disabled = await harness.controller.disableCamera();
  assert.deepEqual(JSON.parse(JSON.stringify(disabled)), {
    enabled: false,
    reason: 'user-disabled',
  });
  assert.equal(harness.track, originalTrack);
  assert.equal(harness.processor, originalProcessor);
  assert.equal(harness.events.filter((event) => event === 'stop-processor').length, 0);
  await harness.controller.enableCamera();
  assert.equal(harness.track, originalTrack);
  assert.equal(harness.processor, originalProcessor);
  assert.equal(harness.events.filter((event) => event === 'create-raw-track-unpublished').length, 1);
  assert.equal(harness.events.filter((event) => event === 'set-processor:true').length, 1);
  assert.ok(harness.events.includes('unmute-publication'));
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
  const result = await harness.controller.enableCamera();
  assert.equal(result.enabled, true, 'capability must not depend on a legacy policy marker');
}

{
  const harness = createHarness({ modern: false });
  const result = await harness.controller.enableCamera();
  assert.equal(result.enabled, true);
  assert.equal(harness.controller.snapshot().modern, false);
}

{
  const harness = createHarness();
  await harness.controller.enableCamera();
  harness.processor.switchTo = async function failingSwitch() {
    throw new Error('processor switch failed');
  };
  await rejectsWithCode(
    harness.controller.switchBackground({ mode: 'virtual-background' }),
    'STUDY_ROOM_BACKGROUND_SWITCH_FAILED',
  );
  assert.equal(harness.controller.snapshot().fallbackRaw, true);
  assert.equal(harness.controller.snapshot().mode, 'disabled');
  assert.equal(harness.track.getProcessor(), null);
  assert.equal(harness.track.mediaStreamTrack, harness.rawMediaTrack);
}

for (const failure of [
  { setProcessorFailure: true },
  { processedReadyState: 'ended' },
]) {
  const harness = createHarness(failure);
  if (failure.processedReadyState) harness.processedMediaTrack.readyState = failure.processedReadyState;
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
  const cleanupStart = harness.events.length;
  await harness.controller.destroy();
  const cleanupEvents = harness.events.slice(cleanupStart);
  assert.ok(
    cleanupEvents.indexOf('unpublish-track:false') < cleanupEvents.indexOf('stop-processor'),
    'final cleanup must unpublish before removing the processor',
  );
  assert.equal(cleanupEvents.filter((event) => event === 'stop-processor').length, 1);
  assert.equal(cleanupEvents.filter((event) => event === 'stop-track').length, 1);
  await harness.controller.destroy();
  assert.equal(harness.events.filter((event) => event === 'stop-processor').length, 1);
  assert.equal(harness.events.filter((event) => event === 'stop-track').length, 1);
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
  assert.ok(harness.events.includes('stop-processor'));
  assert.ok(harness.events.includes('stop-track'));
  assert.equal(harness.controller.snapshot().status, 'unavailable');
}

assert.match(moduleSource, /mode:\s*'disabled'/u);
assert.match(moduleSource, /processor\.switchTo\(nextMode\)/u);
assert.match(moduleSource, /state\.switchPromise/u);
assert.match(moduleSource, /createLocalVideoTrack[\s\S]*setProcessor[\s\S]*assertProcessedTrack[\s\S]*publishTrack/u);
assert.match(moduleSource, /global\.DueDiligenceStudyRoomMandatoryBackground = Object\.freeze/u);
assert.doesNotMatch(
  moduleSource,
  /BackgroundProcessor\(\{\s*mode:\s*['"]virtual-background['"]/u,
  'camera startup must not recreate a virtual processor for every toggle',
);

console.log('Study Room background processor lifecycle tests passed.');
