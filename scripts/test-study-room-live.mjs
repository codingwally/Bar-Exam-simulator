import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [page, css, client, previewClient, workerPackage] = await Promise.all([
  readFile(path.join(root, 'study-room/index.html'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.css'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-live.js'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-preview.js'), 'utf8'),
  readFile(path.join(root, 'worker/package.json'), 'utf8').then(JSON.parse),
]);

assert.match(page, /<html lang="en-PH">/);
assert.match(page, /<meta name="robots" content="noindex,nofollow,noarchive">/);
assert.match(page, /id="sr-access-state"/);
assert.match(page, /id="sr-prejoin"/);
assert.match(page, /id="sr-live-room" hidden/);
assert.match(page, /Camera and microphone are off/);
assert.match(page, /Nothing is shared until you choose to join/);
assert.match(page, /Off when you join/g);
assert.match(page, /Use a nickname\. Real names are not required\./);
assert.match(page, /value="Participant 1"/);
assert.match(page, /Virtual backgrounds[\s\S]*Coming after the quality test/);
assert.match(page, /assets\/vendor\/livekit-client\.umd\.js\?v=2\.22\.1/);
assert.doesNotMatch(page, /facebook|fb\.com|recording is on|Recording enabled/i);

for (const endpoint of ['access', 'join', 'moderate']) {
  assert.match(client, new RegExp(`/admin/study-room/${endpoint}`));
}
assert.match(client, /Authorization: `Bearer \$\{token\}`/);
assert.match(client, /cache: 'no-store'/);
assert.match(client, /new LiveKit\.Room/);
assert.match(client, /bindRoomEvents\(room\);[\s\S]*await room\.connect/);
assert.match(client, /adaptiveStream: true/);
assert.match(client, /dynacast: true/);
assert.match(client, /operation: 'mute'/);
assert.match(client, /operation: 'rename'/);
assert.doesNotMatch(client, /operation:\s*['"]unmute['"]/);
assert.match(client, /Block locally/);
assert.match(client, /publication\.setSubscribed\(!blocked\)/);
assert.match(client, /participant\.setVolume\?\.\(volume \/ 100\)/);
assert.match(client, /ActiveSpeakersChanged[\s\S]*syncActiveSpeakerTiles\(\)/);
assert.doesNotMatch(client, /ActiveSpeakersChanged[\s\S]{0,260}renderParticipants\(\)/);
assert.match(client, /function recoverFromTerminalDisconnect\(room\)/);
assert.match(client, /state\.room = null;[\s\S]*Rejoin Study Room[\s\S]*camera and microphone are off/);
assert.match(client, /event\.Disconnected[\s\S]*recoverFromTerminalDisconnect\(room\)/);
assert.match(client, /state\.room\?\.startAudio/);
assert.match(client, /global\.navigator\.mediaDevices\.getUserMedia/);
assert.match(client, /joinWithMicrophone:\s*false/);
assert.match(client, /joinWithCamera:\s*false/);
assert.match(client, /const STORAGE_KEY = 'duediligence\.study-room\.nickname\.v2'/);
assert.match(client, /`Participant \$\{\(value % 900\) \+ 100\}`/);
assert.match(client, /state\.focusStartedAt = Date\.parse\(credential\.focus_started_at/);
assert.doesNotMatch(client, /console\.(?:log|debug|info)|participant_token[^\n]*(?:localStorage|sessionStorage)|LIVEKIT_API_SECRET|LIVEKIT_API_KEY\s*=/);

const testDevicesStart = client.indexOf('async function testDevices()');
const mediaRequest = client.indexOf('global.navigator.mediaDevices.getUserMedia', testDevicesStart);
const bindTestButton = client.indexOf("byId('sr-test-devices').addEventListener('click', testDevices)");
assert.ok(testDevicesStart >= 0 && mediaRequest > testDevicesStart && bindTestButton > mediaRequest);
assert.equal(client.indexOf('getUserMedia', bindTestButton), -1, 'initialization must never request media automatically');

const openBlank = previewClient.indexOf("global.open(\n      'about:blank'");
const severOpener = previewClient.indexOf('popup.opener = null', openBlank);
const navigateRoom = previewClient.indexOf('popup.location.replace(roomUrl.href)', severOpener);
assert.ok(openBlank >= 0 && severOpener > openBlank && navigateRoom > severOpener);
assert.match(previewClient, /signedIn\(\) && isAdmin\(access\)/);
assert.match(previewClient, /return openMarketingPreview\(trigger\)/);

assert.match(css, /min-width:\s*320px/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\.sr-button[\s\S]*min-height:\s*44px/);
assert.match(css, /\.sr-control-dock button[\s\S]*min-height:\s*58px/);
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

console.log('Study Room live-client privacy, access, media-consent, and interface contracts passed.');
