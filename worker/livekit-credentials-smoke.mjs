import { pathToFileURL } from 'node:url';
import { RoomServiceClient } from 'livekit-server-sdk';

const ALLOWED_TARGETS = new Set(['staging', 'production']);

export function normalizeLiveKitServiceUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol !== 'https:') {
    throw new Error('LIVEKIT_URL must use wss:// or https://.');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

export function releaseSmokeRoomName({ target, runId, runAttempt }) {
  const normalizedTarget = String(target || '').trim().toLowerCase();
  if (!ALLOWED_TARGETS.has(normalizedTarget)) {
    throw new Error('STUDY_ROOM_RELEASE_TARGET must be staging or production.');
  }
  const safeRunId = String(runId || '').replace(/[^0-9]/gu, '').slice(0, 24);
  const safeAttempt = String(runAttempt || '1').replace(/[^0-9]/gu, '').slice(0, 4) || '1';
  if (!safeRunId) throw new Error('GITHUB_RUN_ID is required for an isolated smoke room.');
  return `dd-sr-smoke-${normalizedTarget}-${safeRunId}-${safeAttempt}`;
}

export async function runLiveKitCredentialsSmoke(environment = process.env) {
  const apiKey = String(environment.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(environment.LIVEKIT_API_SECRET || '').trim();
  if (!apiKey || !apiSecret) throw new Error('LiveKit release credentials are incomplete.');

  const serviceUrl = normalizeLiveKitServiceUrl(environment.LIVEKIT_URL);
  const roomName = releaseSmokeRoomName({
    target: environment.STUDY_ROOM_RELEASE_TARGET,
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
  });
  const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
  let created = false;

  try {
    const stale = await client.listRooms([roomName]);
    if (stale.some((room) => room.name === roomName)) await client.deleteRoom(roomName);
    await client.createRoom({
      name: roomName,
      maxParticipants: 2,
      emptyTimeout: 60,
      departureTimeout: 30,
    });
    created = true;
    const rooms = await client.listRooms([roomName]);
    if (!rooms.some((room) => room.name === roomName)) {
      throw new Error('The isolated LiveKit smoke room could not be verified.');
    }
  } finally {
    if (created) await client.deleteRoom(roomName).catch(() => {});
  }

  console.log(`LiveKit ${environment.STUDY_ROOM_RELEASE_TARGET} credentials passed an isolated create/list/delete smoke test.`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) await runLiveKitCredentialsSmoke();
