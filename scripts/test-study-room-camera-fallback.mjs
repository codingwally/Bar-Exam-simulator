import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = await import(pathToFileURL(process.env.STUDY_ROOM_LIVEKIT_MODULE
  || path.join(root, 'worker/node_modules/livekit-client/dist/livekit-client.esm.mjs')).href);
assert.equal(SDK.version, '2.22.1', 'Recovery probes must use the deployed SDK version');
// Reuse the existing offline DOM/media harness and its baseline assertions.
// Load the shipped background controller below instead of its simplified double.
const harnessSource = await readFile(path.join(root, 'scripts/test-study-room-hotfix-behavior.mjs'), 'utf8');
const rootDeclaration = "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');";
assert.equal(harnessSource.split(rootDeclaration).length, 2);
const toggleHook = '    toggleLocalTrack,';
assert.equal(harnessSource.split(toggleHook).length, 2);
const harnessModule = harnessSource.replace(rootDeclaration, `const root = ${JSON.stringify(root)};`)
  .replace(toggleHook, `${toggleHook}\n    setLocalSourceEnabled,\n    scheduleLocalCameraGuard,`)
  + '\nexport { createLiveHarness, waitForAuthorizedPrejoin, authorizedResponse, labeledDevices, FakeHTMLElement };';
const { createLiveHarness, waitForAuthorizedPrejoin, authorizedResponse, labeledDevices, FakeHTMLElement } =
  await import(`data:text/javascript;base64,${Buffer.from(harnessModule).toString('base64')}`);
const controllerSource = await readFile(path.join(root, 'assets/study-room-backgrounds.js'), 'utf8');

async function setup({ supported = true, processorFailure = true, ...failures } = {}) {
  const controls = { processorFailure, ...failures };
  const publications = new Map();
  const counts = { processorAttempts: 0, rawStarts: 0, mutes: 0, stops: 0, unpublishes: 0, creates: 0 };
  const tracks = [];
  let onUnmute = () => {};
  function makeTrack(raw = false) {
    const input = { kind: 'video', readyState: 'live', enabled: true, getSettings: () => ({ deviceId: 'camera-selected' }) };
    let processor = null;
    let rawFallback = raw;
    const track = {
      kind: 'video', source: 'camera', isMuted: false,
      _mediaStreamTrack: input,
      log: { debug() {} },
      emit() {},
      get mediaStreamTrack() { return processor?.processedTrack || input; },
      getProcessor: () => processor,
      async setProcessor(next) {
        counts.processorAttempts++;
        if (controls.processorFailure) throw new Error('Synthetic processor initialization failure');
        processor = next;
      },
      async stopProcessor() { await processor?.destroy(); processor = null; rawFallback = true; },
      stop() {
        if (rawFallback) {
          counts.stops++;
          if (controls.stopFailure) throw new Error('Synthetic stop failure');
          if (controls.stopNoop) return;
          if (controls.stopDisables) { input.enabled = false; return; }
        }
        input.readyState = 'ended';
        if (processor) processor.processedTrack.readyState = 'ended';
      },
      attach: () => new FakeHTMLElement('internal-synthetic-camera', 'video'),
      detach: (element) => element?.remove?.(),
    };
    tracks.push(track);
    return track;
  }
  const participant = {
    identity: 'internal-local-camera-regression', name: 'Synthetic local fixture', isLocal: true,
    trackPublications: publications,
    // LiveKit selects the FIRST matching source from SID-keyed publications.
    // A source-keyed Map would conceal duplicate camera publication bugs.
    getTrackPublication: SDK.Participant.prototype.getTrackPublication,
    async publishTrack(track, options) {
      assert.equal(options.source, 'camera');
      const publication = {
        source: 'camera', track, trackSid: String(tracks.length),
        get isMuted() { return track.isMuted; },
        async mute() {
          counts.mutes++;
          if (controls.muteFailure) throw new Error('Synthetic mute failure');
          if (controls.muteNoop) return;
          SDK.LocalTrack.prototype.setTrackMuted.call(track, true);
        },
        async unmute() {
          // Match LocalVideoTrack.unmute: an already-unmuted track is not
          // reacquired, even if an earlier failed cleanup ended/disabled it.
          if (!track.isMuted) return;
          track._mediaStreamTrack.readyState = 'live';
          SDK.LocalTrack.prototype.setTrackMuted.call(track, false);
          if (controls.guardOnUnmute) await onUnmute();
        },
      };
      publications.set(publication.trackSid, publication);
      return publication;
    },
    setCameraEnabled: SDK.LocalParticipant.prototype.setCameraEnabled,
    setTrackEnabled: SDK.LocalParticipant.prototype.setTrackEnabled,
    pendingPublishing: new Set(),
    log: { debug() {}, info() {} },
    roomOptions: { publishDefaults: {} },
    emit() {},
    async createTracks() {
      counts.rawStarts++;
      return [makeTrack(true)];
    },
    async unpublishTrack(track) {
      const publication = [...publications.values()].find((pub) => pub.track === track);
      if (!publication) return undefined;
      counts.unpublishes++;
      if (controls.unpublishFailure) throw new Error('Synthetic unpublish failure');
      if (!controls.unpublishNoop) publications.delete(publication.trackSid);
      return publication;
    },
  };
  const harness = createLiveHarness({
    fetch: async () => authorizedResponse(),
    enumerateDevices: async () => labeledDevices,
    getUserMedia: async () => { throw new Error('Device activation forbidden in this test'); },
    liveKit: {
      Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } },
      async createLocalVideoTrack() { counts.creates++; return makeTrack(); },
    },
  });
  await waitForAuthorizedPrejoin(harness);
  harness.window.LivekitTrackProcessors = {
    supportsBackgroundProcessors: () => supported,
    supportsModernBackgroundProcessors: () => supported,
    BackgroundProcessor: () => ({
      mode: 'disabled',
      processedTrack: { kind: 'video', readyState: 'live', enabled: true },
      async destroy() { this.processedTrack.readyState = 'ended'; },
      async switchTo(next) {
        if (controls.switchFailure) throw new Error('Synthetic processor mode-switch failure');
        this.mode = next.mode;
      },
    }),
  };
  vm.runInNewContext(controllerSource, { window: harness.window });
  const createController = harness.window.DueDiligenceStudyRoomMandatoryBackground.createController;
  harness.window.DueDiligenceStudyRoomMandatoryBackground = {
    createController: (options) => createController({ ...options, verifyImage: async () => {} }),
  };
  harness.hooks.state.room = {
    localParticipant: participant, remoteParticipants: new Map(),
    connectionState: 'connected', canPlaybackAudio: true,
  };
  harness.document.getElementById('sr-live-camera-select').value = 'camera-selected';
  onUnmute = () => harness.hooks.scheduleLocalCameraGuard(harness.hooks.state.room);
  const toggle = () => harness.hooks.toggleLocalTrack('camera');
  const toast = () => harness.document.getElementById('sr-toast').textContent;
  await toggle();
  const current = () => participant.getTrackPublication('camera');
  assert.ok(current(), 'The synthetic camera must actually be published before shutdown');
  return { harness, controls, publications, counts, tracks, toggle, toast, current };
}

test('processor startup fallback is stopped/unpublished and stale controller discarded on camera off', async () => {
  const h = await setup();
  const track = h.current().track;
  assert.equal(h.counts.processorAttempts, 1);
  assert.equal(h.counts.rawStarts, 1);
  assert.equal(h.harness.hooks.state.backgroundController.snapshot().processorAttached, false);
  await h.toggle();
  assert.equal(h.toast(), 'Camera turned off.');
  assert.equal(h.publications.size, 0);
  assert.equal(track.mediaStreamTrack.readyState, 'ended');
  assert.equal(h.counts.mutes, 1);
  assert.equal(h.counts.unpublishes, 1);
  assert.equal(h.counts.stops, 1);
  assert.equal(h.harness.hooks.state.backgroundController, null);
  assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(track), false);
});

test('mute and unpublish failure still shuts raw video down by stopping its track', async () => {
  const h = await setup({ muteFailure: true, unpublishFailure: true });
  const publication = h.current();
  await h.toggle();
  assert.equal(h.current(), publication);
  assert.equal(publication.isMuted, false);
  assert.equal(publication.track.mediaStreamTrack.readyState, 'ended');
  assert.equal(h.toast(), 'Camera turned off.');
});

for (const [name, failures] of [
  ['throwing operations', { muteFailure: true, unpublishFailure: true, stopFailure: true }],
  ['silently ineffective operations', { muteNoop: true, unpublishNoop: true, stopNoop: true }],
]) {
  test(`unconfirmed shutdown reports truthful failure and preserves retry ownership: ${name}`, async () => {
    const h = await setup(failures);
    const publication = h.current();
    await h.toggle();
    assert.equal(h.current(), publication);
    assert.equal(publication.isMuted, false);
    assert.equal(publication.track.mediaStreamTrack.readyState, 'live');
    assert.equal(h.toast(), 'The camera could not be confirmed off. Leave the room to stop sharing video.');
    assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(publication.track), true);
    assert.equal(h.harness.document.getElementById('sr-toggle-camera').getAttribute('aria-pressed'), 'true');
    for (const key of Object.keys(h.controls)) h.controls[key] = false;
    await h.toggle();
    assert.equal(h.counts.rawStarts, 1, 'Retry must stop the existing track, not start another camera');
    assert.equal(h.publications.size, 0);
    assert.equal(h.toast(), 'Camera turned off.');
  });
}

test('confirmed publication mute is quiet even if unpublish and raw stop throw', async () => {
  const h = await setup({ unpublishFailure: true, stopFailure: true });
  const publication = h.current();
  await h.toggle();
  assert.equal(publication.isMuted, true);
  assert.equal(h.toast(), 'Camera turned off.');
});

test('confirmed unpublish is quiet even if mute and raw stop throw', async () => {
  const h = await setup({ muteFailure: true, stopFailure: true });
  await h.toggle();
  assert.equal(h.publications.size, 0);
  assert.equal(h.toast(), 'Camera turned off.');
});

test('unsupported processor raw-camera baseline remains usable across off/on', async () => {
  const h = await setup({ supported: false });
  await h.toggle();
  assert.equal(h.publications.size, 0);
  assert.equal(h.counts.processorAttempts, 0);
  await h.toggle();
  assert.equal(h.counts.rawStarts, 2);
  assert.equal(h.current().track.mediaStreamTrack.readyState, 'live');
});

test('healthy processor camera preserves controller, publication, track and processor on off/on', async () => {
  const h = await setup({ processorFailure: false });
  const controller = h.harness.hooks.state.backgroundController;
  const publication = h.current();
  const track = publication.track;
  const processor = track.getProcessor();
  await h.toggle();
  assert.equal(h.toast(), 'Camera turned off.');
  assert.equal(publication.isMuted, true);
  assert.equal(h.harness.hooks.state.backgroundController, controller);
  await h.toggle();
  assert.equal(h.current(), publication);
  assert.equal(publication.track, track);
  assert.equal(track.getProcessor(), processor);
  assert.equal(publication.isMuted, false);
  assert.equal(h.counts.creates, 1);
  assert.equal(h.counts.rawStarts, 0);
  assert.equal(h.counts.unpublishes, 0);
  assert.equal(h.counts.stops, 0);
});

test('final shutdown verification does not trust an empty controller or a missing raw allowlist entry', async () => {
  const h = await setup();
  const publication = h.current();
  h.harness.hooks.state.userApprovedRawCameraTracks.delete(publication.track);
  // Invoke the actual off path directly: the UI toggle otherwise sees an
  // untrusted track as disabled. This checks its independent final verifier.
  await assert.rejects(h.harness.hooks.setLocalSourceEnabled('camera', false),
    (error) => error.code === 'MEDIA_TRACK_STOP_UNCONFIRMED');
  assert.equal(h.current(), publication);
  assert.equal(publication.isMuted, false);
  assert.equal(publication.track.mediaStreamTrack.readyState, 'live');
});

for (const processorRecovers of [true, false]) {
  test(`surviving muted raw publication is reused without a second camera (processor recovers: ${processorRecovers})`, async () => {
    const h = await setup({ unpublishFailure: true, stopFailure: true, guardOnUnmute: true });
    const publication = h.current();
    await h.toggle();
    assert.equal(h.toast(), 'Camera turned off.');
    assert.equal(h.publications.size, 1);
    assert.equal(publication.isMuted, true);
    assert.equal(publication.track.isMuted, true);
    assert.equal(publication.track.mediaStreamTrack.enabled, false,
      'The pinned SDK mute changes the source track, not only a UI flag');
    assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(publication.track), true);
    h.controls.unpublishFailure = false;
    h.controls.stopFailure = false;
    h.controls.processorFailure = !processorRecovers;
    await h.toggle();
    await h.harness.hooks.state.cameraGuard;
    assert.equal(h.publications.size, 1, 'Never publish another camera beside the surviving raw publication');
    assert.equal(h.current(), publication);
    assert.equal(publication.isMuted, false);
    assert.equal(publication.track.mediaStreamTrack.enabled, true);
    assert.equal(publication.track.mediaStreamTrack.readyState, 'live');
    assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(publication.track), true,
      'Ownership is present before the unmute event guard runs');
    assert.equal(h.counts.rawStarts, 1);
    assert.equal(h.counts.processorAttempts, 1, 'Existing raw publication is resolved before attempting a new processor');
    assert.equal(h.toast(), 'Camera is on.');
    await h.toggle();
    assert.equal(h.publications.size, 0);
  });
}

test('disabled raw source is independently quiet without a mute flag or successful unpublish', async () => {
  const h = await setup({ muteFailure: true, unpublishFailure: true, stopDisables: true });
  const publication = h.current();
  await h.toggle();
  assert.equal(publication.isMuted, false);
  assert.equal(publication.track.isMuted, false);
  assert.equal(publication.track.mediaStreamTrack.readyState, 'live');
  assert.equal(publication.track.mediaStreamTrack.enabled, false);
  assert.equal(h.toast(), 'Camera turned off.');
  assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(publication.track), true);
});

for (const stopDisables of [false, true]) {
  test(`surviving unmuted quiet source cannot trigger a duplicate when SDK reuse fails (disabled: ${stopDisables})`, async () => {
    const h = await setup({ muteFailure: true, unpublishFailure: true, stopDisables });
    await h.toggle();
    assert.equal(h.toast(), 'Camera turned off.');
    assert.equal(h.publications.size, 1);
    h.controls.muteFailure = false;
    h.controls.unpublishFailure = false;
    h.controls.stopDisables = false;
    h.controls.processorFailure = false;
    await h.toggle();
    assert.notEqual(h.toast(), 'Camera is on.');
    assert.equal(h.publications.size, 0, 'Failed SDK reuse cleans the original before a later retry');
    assert.equal(h.counts.processorAttempts, 1);
    assert.equal(h.counts.rawStarts, 1);
    await h.toggle();
    assert.equal(h.publications.size, 1);
    assert.equal(h.current().track.mediaStreamTrack.readyState, 'live');
    assert.equal(h.toast(), 'Camera is on.');
  });
}

for (const mixedFailure of [false, true]) {
  test(`controller-owned raw downgrade preserves off/on control (mixed shutdown failure: ${mixedFailure})`, async () => {
    const h = await setup({ processorFailure: false, guardOnUnmute: true });
    const publication = h.current();
    h.controls.switchFailure = true;
    await h.harness.hooks.toggleBackdrop();
    assert.equal(h.harness.hooks.state.backgroundController.snapshot().fallbackRaw, true);
    assert.equal(publication.track.getProcessor(), null);
    assert.equal(h.harness.hooks.state.userApprovedRawCameraTracks.has(publication.track), true);
    h.controls.unpublishFailure = mixedFailure;
    h.controls.stopFailure = mixedFailure;
    await h.toggle();
    assert.equal(h.toast(), 'Camera turned off.');
    assert.equal(h.harness.hooks.state.backgroundController, null);
    assert.equal(h.publications.size, mixedFailure ? 1 : 0);
    h.controls.unpublishFailure = false;
    h.controls.stopFailure = false;
    h.controls.switchFailure = false;
    await h.toggle();
    await h.harness.hooks.state.cameraGuard;
    assert.equal(h.publications.size, 1);
    assert.equal(h.current().isMuted, false);
    assert.equal(h.current().track.mediaStreamTrack.readyState, 'live');
    if (mixedFailure) assert.equal(h.current(), publication);
    assert.equal(h.toast(), 'Camera is on.');
  });
}
