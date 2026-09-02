import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [page, css, client, backgroundClient, previewClient, workerPackage] = await Promise.all([
  readFile(path.join(root, 'study-room/index.html'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.css'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.js'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-backgrounds.js'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-preview.js'), 'utf8'),
  readFile(path.join(root, 'worker/package.json'), 'utf8').then(JSON.parse),
]);

assert.match(page, /<html lang="en-PH">/);
assert.match(page, /<meta name="robots" content="noindex,nofollow,noarchive">/);
assert.match(page, /id="sr-access-state"/);
assert.match(page, /id="sr-prejoin"/);
assert.match(page, /id="sr-live-room" hidden/);
assert.match(page, /id="sr-live-room" hidden tabindex="-1"/);
assert.doesNotMatch(
  page,
  /<nav\b[^>]*class="[^"]*\bsr-nav\b/iu,
  'The separate Study Room window must not repeat the simulator navigation menu.',
);
for (const simulatorDestination of [
  'Quick Drills',
  'Doctrine Review',
  'Syllabus-Based Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Analytics',
]) {
  assert.doesNotMatch(page, new RegExp(`>${simulatorDestination}<`, 'u'));
}
assert.match(page, /class="sr-brand"[^>]*aria-label="Return to Due Diligence"/u);
assert.match(page, /class="sr-return-link"[^>]*>Return to simulator<\/a>/u);
assert.match(page, /id="sr-toggle-microphone"[\s\S]*?<span class="sr-control-label">Unmute<\/span>/u);
assert.doesNotMatch(page, /Turn mic on/iu);
assert.match(page, /Camera and microphone are off/);
assert.match(page, /Nothing is shared until you choose to join/);
assert.match(page, /camera indicator may turn on briefly during this local check, but nothing is shared/);
assert.match(page, /The check stops immediately; joining starts muted with camera off/);
assert.match(page, /Off when you join/g);
assert.match(page, /Use a nickname\. Real names are not required\./);
assert.match(page, /value="Participant #"/);
assert.match(page, /id="sr-room-lobby"[\s\S]*data-max-rooms="5"/u);
assert.match(page, /id="sr-room-lobby-count"/u);
assert.match(page, /id="sr-room-card-grid"[^>]*><\/div>/u);
assert.match(page, /id="sr-room-selector"[\s\S]*id="sr-room-selector-menu"/u);
assert.match(page, /id="sr-layout-button"[\s\S]*id="sr-layout-menu"/u);
assert.match(page, /data-layout-mode="auto"[\s\S]*data-layout-mode="tiled"[\s\S]*data-layout-mode="spotlight"/u);
assert.match(page, /id="sr-presentation-size"[^>]*min="65"[^>]*max="90"/u);
assert.match(page, /id="sr-branded-backdrop-status"[\s\S]*data-backdrop-enforcement="optional"/u);
assert.match(page, /id="sr-branded-backdrop-copy"/u);
assert.match(page, /id="sr-toggle-backdrop"[\s\S]*aria-pressed="false"/u);
assert.match(page, /id="sr-panel-chat"[\s\S]*id="sr-chat-form"/u);
assert.match(page, /id="sr-toggle-screen-share"/u);
assert.match(page, /id="sr-toggle-hand"/u);
assert.match(page, /Due Diligence backdrop/u);
assert.doesNotMatch(page, /Virtual backgrounds|Coming after the quality test/iu);
assert.match(page, /assets\/vendor\/livekit-client\.umd\.js\?v=2\.22\.1/);
assert.match(page, /assets\/vendor\/livekit-track-processors\.iife\.js\?v=0\.7\.2/);
assert.match(page, /study-room-backgrounds\.js\?v=study-room-background-processor-20260902-1/);
assert.match(page, /study-room-live\.js\?v=study-room-meet-layout-20260902-6/);
assert.match(page, /study-room-live\.css\?v=study-room-meet-layout-20260831-5/);
assert.doesNotMatch(page, /facebook|fb\.com|recording is on|Recording enabled/i);

for (const endpoint of ['access', 'rooms', 'join', 'moderate']) {
  assert.match(client, new RegExp(`/study-room/${endpoint}`));
}
assert.match(client, /\/admin\/study-room\/rooms/);
assert.match(client, /const MAX_ROOMS = 5/);
assert.match(client, /workerRequest\('\/study-room\/join', \{ nickname, roomKey \}\)/);
assert.match(client, /Authorization: `Bearer \$\{token\}`/);
assert.match(client, /cache: 'no-store'/);
assert.match(client, /new LiveKit\.Room/);
assert.match(client, /bindRoomEvents\(room\);[\s\S]*await room\.connect/);
assert.match(client, /const MEDIA_RELIABILITY_VERSION = 'study-room-meet-layout-20260902-6'/);
assert.match(client, /adaptiveStream:\s*\{[\s\S]*pixelDensity:\s*1[\s\S]*pauseVideoInBackground:\s*true/);
assert.match(client, /dynacast: true/);
assert.match(client, /width:\s*640,[\s\S]*height:\s*360,[\s\S]*frameRate:\s*15/);
assert.match(client, /maxBitrate:\s*450_000,[\s\S]*maxFramerate:\s*15/);
assert.match(client, /dtx:\s*false,[\s\S]*red:\s*true,[\s\S]*forceStereo:\s*false/);
assert.match(client, /videoCodec:\s*'vp8'/);
assert.match(client, /const BACKDROP_PROCESSOR_MAX_FPS = 8/);
assert.match(client, /maxFps:\s*BACKDROP_PROCESSOR_MAX_FPS/);
assert.match(client, /simulcast:\s*true/);
assert.doesNotMatch(client, /videoSimulcastLayers/);
assert.doesNotMatch(client, /operation:\s*['"]mute['"]/u);
assert.match(client, /operation: 'rename'/);
assert.doesNotMatch(client, /operation:\s*['"]unmute['"]/);
assert.match(client, /Block locally/);
assert.doesNotMatch(
  client,
  /Mute for room/iu,
  'Participant sound controls must remain reversible and local to the current listener.',
);
assert.match(client, /publication\.setSubscribed\(!blocked\)/);
assert.match(client, /participant\.setVolume\?\.\(volume \/ 100\)/);
assert.match(client, /state\.localMutedParticipants\.has\(participant\.identity\)/);
assert.match(client, /registerTextStreamHandler\('duediligence\.study-room\.chat\.v1'/);
assert.match(client, /localParticipant\.sendText\(text/);
assert.match(client, /setScreenShareEnabled\(enabled/);
assert.match(client, /setAttributes\(\{ 'dd\.studyRoom\.handRaised'/);
assert.match(client, /ParticipantAttributesChanged/);
assert.match(client, /event\.Reconnecting[\s\S]*event\.Reconnected/);
assert.match(client, /microphone_allowed !== false/);
assert.match(client, /mediaStreamTrack\.readyState === 'live'/);
assert.match(client, /deviceId: \{ exact: deviceId \}/);
assert.match(client, /ActiveSpeakersChanged[\s\S]*renderParticipants\(\)/);
assert.match(client, /ActiveDeviceChanged[\s\S]*rememberDeviceSelection\(deviceKind, deviceId\)/);
assert.match(client, /Stable-key reconciliation preserves media elements while the preferred companion changes/);
assert.match(client, /function recoverFromTerminalDisconnect\(room\)/);
assert.match(
  client,
  /function recoverFromTerminalDisconnect\(room\)[\s\S]*destroyBackgroundController\(\)[\s\S]*clearConnectedRoomState\(\)[\s\S]*sr-prejoin[\s\S]*camera and microphone are off/,
);
assert.match(client, /event\.Disconnected[\s\S]*recoverFromTerminalDisconnect\(room\)/);
assert.match(client, /room\?\.startAudio\?\.\(\)/);
assert.match(client, /function startRoomAudioFromGesture[\s\S]*element\.play\?\.\(\)/);
assert.match(client, /function microphoneTransportSample[\s\S]*getSenderStats/);
assert.match(client, /function verifyMicrophoneTransport[\s\S]*bytesSent[\s\S]*packetsSent/);
assert.match(client, /MICROPHONE_TRANSPORT_STALLED/);
assert.match(client, /discardMicrophonePublication[\s\S]*switchActiveDevice\(deviceKind, 'default', false\)/);
assert.match(client, /Your microphone is sending audio to the room\./);
assert.match(client, /mediaDevices\.getUserMedia\(constraints\)/);
assert.match(client, /joinWithMicrophone:\s*false/);
assert.match(client, /joinWithCamera:\s*false/);
assert.match(client, /const STORAGE_KEY = 'duediligence\.study-room\.nickname\.v2'/);
assert.match(client, /`Participant #\$\{\(value % 900\) \+ 100\}`/);
for (const roomName of ['Library', 'Room 1', 'Room 2', 'Room 3', 'Inner Chamber']) {
  assert.match(client, new RegExp(roomName.replace(' ', '\\s')));
}
assert.match(client, /microphoneAllowed:\s*roomKey !== '1'/);
assert.match(client, /adminOnly:\s*roomKey === '5'/);
assert.match(client, /state\.focusStartedAt = Date\.parse\(credential\.focus_started_at/);
assert.match(client, /global\.opener = null/);
assert.match(client, /function bindDeviceChangeDetection\(\)[\s\S]*addEventListener\('devicechange', refreshDeviceLists\)/);
assert.doesNotMatch(client, /console\.(?:log|debug|info)|participant_token[^\n]*(?:localStorage|sessionStorage)|LIVEKIT_API_SECRET|LIVEKIT_API_KEY\s*=/);

const permissionHelperStart = client.indexOf('async function brieflyRequestDevicePermission(');
const temporaryMediaRequest = client.indexOf(
  'requestUserMediaWithTimeout(mediaDevices, constraints, 10000)',
  permissionHelperStart,
);
const stopTemporaryTracks = client.indexOf('temporaryStream?.getTracks?.().forEach((track) => track.stop())', temporaryMediaRequest);
const discoverDevicesStart = client.indexOf('async function discoverDevices()');
const verifyAccessStart = client.indexOf('async function verifyAccess()');
const discoverAfterAccess = client.indexOf('await discoverDevices()', verifyAccessStart);
assert.ok(permissionHelperStart >= 0 && temporaryMediaRequest > permissionHelperStart);
assert.ok(stopTemporaryTracks > temporaryMediaRequest, 'automatic device discovery must immediately stop temporary media tracks');
assert.ok(discoverDevicesStart > stopTemporaryTracks);
assert.ok(discoverAfterAccess > verifyAccessStart, 'authorized prejoin must discover devices automatically');
assert.ok(client.indexOf('bindDeviceChangeDetection()', verifyAccessStart) > verifyAccessStart);
assert.match(client, /const noDevicesEnumerated = devices\.length === 0/);
assert.match(client, /return `System default \$\{copy\.noun\}`/);
assert.match(client, /return `Alternate \$\{copy\.noun\} \$\{index \+ 1\}`/);
assert.doesNotMatch(client, /`\$\{fallback\} \$\{index \+ 1\}`/);
assert.match(client, /needsCameraLabel[\s\S]*needsMicrophoneLabel[\s\S]*if \(!needsCameraLabel && !needsMicrophoneLabel\)/);
assert.match(client, /video: needsCameraLabel,[\s\S]*audio: needsMicrophoneLabel/);
assert.match(client, /camera indicator may turn on briefly during this local check; nothing is shared/);
assert.match(client, /canRetrySeparately[\s\S]*\{ video: true, audio: false \}[\s\S]*\{ video: false, audio: true \}/);
assert.match(client, /partialAccess = successes > 0 && failures\.length > 0/);
assert.match(client, /cameraLabelResolved[\s\S]*microphoneLabelResolved[\s\S]*available devices were detected/);
assert.match(client, /DueDiligenceStudyRoomMandatoryBackground\?\.createController/);
assert.match(
  client,
  /await controller\.enableCamera\([\s\S]{0,120}captureOptions\('camera', deviceId\)[\s\S]{0,120}cameraPublishOptions\(\)/,
);
assert.match(client, /await ensureBackgroundController\(\)\.switchCamera\(captureOptions\('camera', deviceId\)\)/);
assert.match(client, /function toggleBackdrop\(\)[\s\S]*state\.backdropEnabled = false/);
const toggleBackdropStart = client.indexOf('async function toggleBackdrop()');
const captureOptionsStart = client.indexOf('function captureOptions(', toggleBackdropStart);
assert.ok(toggleBackdropStart >= 0 && captureOptionsStart > toggleBackdropStart);
const toggleBackdropSource = client.slice(toggleBackdropStart, captureOptionsStart);
assert.match(toggleBackdropSource, /controller\.switchBackground\(/u);
assert.doesNotMatch(toggleBackdropSource, /destroyBackgroundController\(/u,
  'backdrop mode changes must not destroy and recreate the camera processor');
assert.match(client, /function setRawCameraEnabled\([\s\S]*rawCameraPublishAuthorized = true/);
assert.match(client, /userApprovedRawCameraTracks/);
assert.match(client, /isUserApprovedRawCameraTrack\(view\.track\)/);
assert.match(client, /backdropEnabled:\s*false/);
assert.match(client, /function buildMediaViews\(participants\)/);
assert.match(client, /mediaViewKey\(participant, cameraSource\)/);
assert.match(client, /mediaViewKey\(participant, screenSource\)/);
assert.match(client, /function reconcileTile\(view\)/);
assert.match(client, /state\.tileViews\.get\(view\.key\)/);
assert.match(client, /function calculateSquareGrid\(count, width, height/);
assert.match(client, /function toggleCompactView\(\)/);
assert.match(client, /document\.pictureInPictureEnabled/);
assert.match(client, /video\?\.requestPictureInPicture/);
assert.match(client, /height \* \(\(100 - state\.presentationSize\) \/ 100\)/);
assert.match(client, /new global\.ResizeObserver\(scheduleStudyRoomLayout\)/);
assert.match(client, /document\.body\.classList\.add\('sr-in-call'\)/);

assert.match(backgroundClient, /const REQUIRED_EFFECTS_POLICY = 'due-diligence-mandatory-virtual-background-no-raw-first-frame'/);
assert.match(backgroundClient, /virtual-background-due-diligence-branded\.webp/);
assert.match(backgroundClient, /mode:\s*'disabled'/u);
assert.match(backgroundClient, /await track\.setProcessor\(processor, true\)/);
assert.match(backgroundClient, /processor\.switchTo\(nextMode\)/u);
const processedBeforePublish = backgroundClient.indexOf('await track.setProcessor(processor, true)');
const publishProtectedTrack = backgroundClient.indexOf('publication = await participant.publishTrack(track', processedBeforePublish);
assert.ok(processedBeforePublish >= 0 && publishProtectedTrack > processedBeforePublish,
  'The camera track must be processed before it can be published.');
assert.match(backgroundClient, /assertProcessedTrack\(track, processor\);[\s\S]*participant\.publishTrack/);
assert.doesNotMatch(backgroundClient, /BackgroundProcessor\(\{\s*mode:\s*['"]virtual-background['"]/u,
  'camera startup must attach a disabled processor before any effect is selected');
assert.match(backgroundClient, /global\.DueDiligenceStudyRoomMandatoryBackground = Object\.freeze/);

const openRoom = previewClient.indexOf('popup = global.open(');
const fallbackNavigation = previewClient.indexOf('global.location.assign(roomUrl.href)', openRoom);
const severOpener = previewClient.indexOf('popup.opener = null', fallbackNavigation);
assert.ok(openRoom >= 0 && fallbackNavigation > openRoom && severOpener > fallbackNavigation);
assert.match(previewClient, /hasLiveRoomAccess\(access\)[\s\S]*accessResolutionFailed[\s\S]*return openLiveRoom\(\)/);
assert.match(previewClient, /return openMarketingPreview\(trigger\)/);

assert.match(css, /min-width:\s*320px/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\.sr-button[\s\S]*min-height:\s*44px/);
assert.match(css, /\.sr-room-card-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u);
assert.match(css, /body\.sr-in-call \.sr-live-room:not\(\[hidden\]\)[\s\S]*height:\s*100dvh/u);
assert.match(css, /\.sr-participant-tile\.is-camera\s*\{[\s\S]*aspect-ratio:\s*1 \/ 1/u);
assert.match(css, /data-presenting="true"[\s\S]*\.sr-participant-tile\.is-presentation/u);
assert.match(css, /--sr-companion-size/u);
assert.match(css, /\.sr-participant-tile\.is-self\.is-screen-share video\s*\{[\s\S]*transform:\s*none/u);
assert.match(css, /body\.sr-in-call \.sr-room-panel:not\(\[hidden\]\)[\s\S]*position:\s*absolute/u);
assert.match(css, /body\.sr-in-call\.sr-compact-mode \.sr-live-room:not\(\[hidden\]\)[\s\S]*resize:\s*both/u);
assert.match(css, /\.sr-control-dock button[\s\S]*min-height:\s*48px/u);
assert.match(css, /\.sr-control-dock button img[\s\S]*width:\s*21px/u);
assert.match(css, /\.sr-control-label\s*\{[\s\S]*clip:\s*rect\(0 0 0 0\)/u);
assert.match(css, /#sr-toggle-backdrop\[aria-pressed="true"\]/u);
assert.match(css, /\.sr-chat-panel\s*\{/u);
assert.match(css, /\.sr-participant-tile\.is-pinned/u);
assert.match(css, /#sr-toggle-screen-share\[aria-pressed="true"\]/u);
assert.match(css, /\.sr-backdrop-enforcement\s*\{/u);
assert.match(css, /\.sr-device-drawer\[hidden\]\s*\{[\s\S]*display:\s*none/u);
assert.match(css, /@media \(max-width:\s*480px\)/);
assert.doesNotMatch(css, /overflow-x:\s*hidden/);

assert.equal(workerPackage.dependencies['livekit-client'], '2.22.1');
assert.equal(workerPackage.dependencies['livekit-server-sdk'], '2.18.0');

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}.`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}.`);
}

const nicknameContext = vm.createContext({
  Intl,
  MAX_NICKNAME_LENGTH: 32,
  DISALLOWED_NICKNAME: /[\p{Cc}\p{Cf}<>]/u,
  RESERVED_NICKNAME: /\b(?:admin|administrator|founder|moderator|staff|support)\b|\bdue\s+diligence\b/iu,
});
vm.runInContext(extractNamedFunction(client, 'graphemeLength'), nicknameContext);
vm.runInContext(extractNamedFunction(client, 'normalizeNickname'), nicknameContext);
assert.equal(vm.runInContext("normalizeNickname('  Dimasalang Reader  ')", nicknameContext), 'Dimasalang Reader');
assert.throws(() => vm.runInContext("normalizeNickname('<Admin>')", nicknameContext));
assert.throws(() => vm.runInContext("normalizeNickname('Dima\\u202Esalang')", nicknameContext));
assert.throws(() => vm.runInContext("normalizeNickname('Due Diligence Staff')", nicknameContext));

const connectionContext = vm.createContext({});
vm.runInContext(extractNamedFunction(client, 'connectionLabel'), connectionContext);
assert.equal(vm.runInContext("connectionLabel('connected')", connectionContext), 'Excellent');
assert.equal(vm.runInContext("connectionLabel('reconnecting')", connectionContext), 'Reconnecting');
assert.equal(vm.runInContext("connectionLabel('disconnected')", connectionContext), 'Offline');
assert.match(client, /syncConnectionState\(room\.state\)/);
assert.match(client, /syncConnectionState\(state\.room\.state\)/);
assert.doesNotMatch(client, /room\.connectionState/);

const renderParticipantsSource = extractNamedFunction(client, 'renderParticipants');
assert.doesNotMatch(
  renderParticipantsSource,
  /detachTracks\(\)/u,
  'Participant metadata updates must not tear down every attached audio/video element.',
);

const squareGridContext = vm.createContext({ Math, Number });
vm.runInContext(extractNamedFunction(client, 'calculateSquareGrid'), squareGridContext);
for (const scenario of [
  { count: 4, width: 1440, height: 760 },
  { count: 4, width: 900, height: 760 },
  { count: 4, width: 640, height: 520 },
  { count: 4, width: 390, height: 620 },
  { count: 4, width: 320, height: 460 },
]) {
  const layout = vm.runInContext(
    `calculateSquareGrid(${scenario.count}, ${scenario.width}, ${scenario.height}, 10)`,
    squareGridContext,
  );
  assert.ok(layout.size >= 88, `Square tiles are too small for ${scenario.width}x${scenario.height}.`);
  assert.ok(layout.columns * layout.rows >= scenario.count);
}

console.log('Study Room live-client privacy, access, media-consent, and interface contracts passed.');
