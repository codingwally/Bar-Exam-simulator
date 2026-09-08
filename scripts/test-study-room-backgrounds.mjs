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
      if (overrides.beforeSetProcessor) await overrides.beforeSetProcessor();
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
    MANDATORY_IMAGE_PATH: '/assets/study-room/virtual-background-due-diligence-polished-20260908.webp',
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
      if (overrides.beforePublishResult) await overrides.beforePublishResult();
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

  let imageId = 0;
  const revokedImages = [];
  class LocalURL extends URL {
    static createObjectURL() { return `blob:https://duediligence.ph/${++imageId}`; }
    static revokeObjectURL(value) { revokedImages.push(value); }
  }
  const sandboxWindow = { Blob, URL: LocalURL, location: { origin: 'https://duediligence.ph', protocol: 'https:' } };
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
      if (overrides.verifyImage) return overrides.verifyImage(imagePath);
      return overrides.decodedBounds || { width: 640, height: 360 };
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
    revokedImages,
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
    imagePath: '/assets/study-room/virtual-background-due-diligence-polished-20260908.webp',
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
  assert.equal(harness.controller.snapshot().fallbackRaw, false);
  assert.equal(harness.controller.snapshot().mode, 'disabled');
  assert.equal(harness.track.getProcessor(), null);
  assert.equal(harness.rawMediaTrack.readyState, 'ended', 'A failed backdrop must not expose the raw camera.');
  assert.ok(harness.events.includes('mute-publication'));
  assert.ok(harness.events.includes('unpublish-track:false'));
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

function rasterBlob(type = 'image/png', width = 640, height = 360) {
  if (type === 'image/jpeg') {
    const bytes = new Uint8Array([255,216,255,192,0,8,8,height >>> 8,height & 255,width >>> 8,width & 255,1]);
    return new Blob([bytes], { type });
  }
  if (type === 'image/webp') {
    const bytes = new Uint8Array(30);
    for (const [at,text] of [[0,'RIFF'],[8,'WEBP'],[12,'VP8X']]) [...text].forEach((char,i) => { bytes[at+i]=char.charCodeAt(0); });
    bytes[24]=(width-1)&255;bytes[25]=((width-1)>>>8)&255;
    bytes[27]=(height-1)&255;bytes[28]=((height-1)>>>8)&255;
    return new Blob([bytes], { type });
  }
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);
  new DataView(bytes.buffer).setUint32(16,width);new DataView(bytes.buffer).setUint32(20,height);
  return new Blob([bytes], { type });
}

for (const type of ['image/png','image/jpeg','image/webp']) {
  const h = createHarness();
  const first = await h.controller.registerCustomBackground(rasterBlob(type));
  assert.equal(first.width,640);assert.equal(first.height,360);
  assert.equal(h.api.isRegisteredCustomImage(first.imagePath),true);
  await h.controller.switchBackground({ mode:'virtual-background', imagePath:first.imagePath });
  await h.controller.enableCamera();
  assert.equal(h.processor.imagePath,first.imagePath,'An image selected before camera ON must survive startup.');
  const track=h.track, processor=h.processor, publication=h.publication;
  await h.controller.disableCamera();await h.controller.enableCamera();
  await h.controller.switchCamera({ deviceId:'camera-b' });
  assert.equal(h.processor.imagePath,first.imagePath);
  assert.equal(h.track,track);assert.equal(h.processor,processor);assert.equal(h.publication,publication);
  assert.throws(()=>h.controller.removeCustomBackground(first.imagePath),/different background/);
  const next=await h.controller.registerCustomBackground(rasterBlob());
  await h.controller.switchBackground({ mode:'virtual-background', imagePath:next.imagePath });
  assert.equal(h.controller.removeCustomBackground(first.imagePath),true);
  assert.equal(h.controller.removeCustomBackground(first.imagePath),false);
  assert.equal(h.api.isRegisteredCustomImage(first.imagePath),false);
  await h.controller.destroy();
  assert.equal(h.api.isRegisteredCustomImage(next.imagePath),false);
  assert.deepEqual(h.revokedImages,[first.imagePath,next.imagePath]);
}

for (const imagePath of ['https://evil.invalid/a.png','http://duediligence.ph/a.png','file:///image.png',
  'data:image/png;base64,AAAA','blob:https://elsewhere.invalid/id','blob:https://duediligence.ph/unregistered','/other.png']) {
  const h=createHarness();
  assert.throws(()=>h.controller.switchBackground({mode:'virtual-background',imagePath}),/this device/);
  assert.equal(h.events.includes('publish-track'),false);
}
for (const blob of [new Blob(['<svg/>'],{type:'image/svg+xml'}),new Blob(['<svg/>'],{type:'image/png'}),
  new Blob([],{type:'image/png'}),new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'}),
  rasterBlob('image/png',4097,1),rasterBlob('image/jpeg',1,4097),rasterBlob('image/webp',4097,1)]) {
  const h=createHarness();await assert.rejects(h.controller.registerCustomBackground(blob));
  assert.equal(h.events.some(e=>e.startsWith('verify-image:')),false,'Invalid/oversized raster must not decode.');
}
{
  const h=createHarness({decodedBounds:{width:9000,height:1}});
  await assert.rejects(h.controller.registerCustomBackground(rasterBlob()));
  assert.equal(h.revokedImages.length,1);
  assert.equal(h.api.isRegisteredCustomImage(h.revokedImages[0]),false);
}
{
  const h=createHarness({imageFailure:true});
  await assert.rejects(h.controller.registerCustomBackground(rasterBlob()));
  assert.equal(h.revokedImages.length,1);
  assert.equal(h.api.isRegisteredCustomImage(h.revokedImages[0]),false);
}
{
  const h=createHarness();
  const paths=[];
  for(let i=0;i<4;i++) paths.push(await h.controller.registerCustomBackground(rasterBlob()));
  await assert.rejects(h.controller.registerCustomBackground(rasterBlob()));
  await h.controller.switchBackground({mode:'disabled'});
  assert.equal(h.controller.removeCustomBackground(paths[0].imagePath),true);
  await h.controller.registerCustomBackground(rasterBlob());
  await h.controller.destroy();assert.equal(h.revokedImages.length,5);
}
{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const start=new Promise(resolve=>{started=resolve;});
  const h=createHarness({verifyImage:async imagePath=>{started(imagePath);await gate;return {width:640,height:360};}});
  const pending=h.controller.registerCustomBackground(rasterBlob());
  const imagePath=await start;
  assert.equal(h.api.isRegisteredCustomImage(imagePath),false,'Decode-pending URLs are not approved.');
  await h.controller.destroy();release();await assert.rejects(pending);
  assert.equal(h.api.isRegisteredCustomImage(imagePath),false);
  assert.deepEqual(h.revokedImages,[imagePath]);
}
{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=createHarness({verifyImage:async()=>{await gate;return {width:640,height:360};}});
  const pending=Array.from({length:4},()=>h.controller.registerCustomBackground(rasterBlob()));
  await assert.rejects(h.controller.registerCustomBackground(rasterBlob()),/5 MB/);
  release();await Promise.all(pending);await h.controller.destroy();assert.equal(h.revokedImages.length,4);
}
{
  const h=createHarness();const selected=await h.controller.registerCustomBackground(rasterBlob());
  await h.controller.enableCamera();h.processor.switchTo=async()=>{throw new Error('processor image switch failed');};
  await assert.rejects(h.controller.switchBackground({mode:'virtual-background',imagePath:selected.imagePath}));
  assert.equal(h.rawMediaTrack.readyState,'ended');assert.equal(h.controller.snapshot().fallbackRaw,false);
  assert.throws(()=>h.controller.removeCustomBackground(selected.imagePath),/different background/);
  await h.controller.switchBackground({mode:'disabled'});
  assert.equal(h.controller.removeCustomBackground(selected.imagePath),true);
}
{
  const h=createHarness({switchFailure:true});
  const selected=await h.controller.registerCustomBackground(rasterBlob());
  await h.controller.enableCamera();
  await assert.rejects(h.controller.switchBackground({mode:'virtual-background',imagePath:selected.imagePath}));
  // The fake camera factory returns one reusable object; revive it as a newly
  // captured camera would be, without weakening the actual failed publication.
  h.rawMediaTrack.readyState='live';h.processedMediaTrack.readyState='live';
  await assert.rejects(h.controller.enableCamera());
  assert.equal(h.events.filter(e=>e==='switch-to:virtual-background').length,2);
  assert.equal(h.events.filter(e=>e==='publish-track').length,1,'Retry must not publish raw while the selected effect still fails.');
  assert.equal(h.rawMediaTrack.readyState,'ended');
  assert.equal(h.controller.snapshot().fallbackRaw,false);
  await h.controller.destroy();
}
for (const during of ['beforeSetProcessor','beforePublishResult']) {
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const h=createHarness({[during]:async()=>{started();await gate;}});
  const enabling=h.controller.enableCamera();await entered;
  const closing=h.controller.destroy();release();
  await rejectsWithCode(enabling,'STUDY_ROOM_BACKGROUND_DESTROYED');await closing;
  assert.equal(h.controller.snapshot().status,'destroyed');assert.equal(h.rawMediaTrack.readyState,'ended');
  assert.equal(h.events.filter(e=>e==='publish-track').length,during==='beforeSetProcessor'?0:1);
  if(during==='beforePublishResult')assert.ok(h.events.includes('unpublish-track:false'));
}
{
  const h=createHarness({blockFirstSwitch:true,switchFailure:true});
  const selected=await h.controller.registerCustomBackground(rasterBlob());
  await h.controller.enableCamera();
  const changing=h.controller.switchBackground({mode:'virtual-background',imagePath:selected.imagePath});
  await h.firstSwitchStarted;
  const latest=h.controller.switchBackground({mode:'disabled'});
  assert.equal(changing,latest);h.releaseFirstSwitch();await assert.rejects(changing);
  assert.equal(h.controller.removeCustomBackground(selected.imagePath),true,'A later explicit Off must survive an earlier failed switch.');
  await h.controller.destroy();
}

console.log('Study Room background processor lifecycle tests passed.');
