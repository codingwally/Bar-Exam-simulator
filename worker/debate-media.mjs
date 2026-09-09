import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const SOURCE = Object.freeze({ camera: TrackSource.CAMERA, microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE, screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO });
const opaque = /^[a-zA-Z0-9_:-]{8,160}$/u;

export class DebateMediaError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}

function configuration(env) {
  let url;
  try { url = new URL(env.LIVEKIT_URL); } catch { /* Report a safe configuration error below. */ }
  if (env.DEBATE_MEDIA_ENABLED !== 'true' || !url || url.protocol !== 'wss:'
    || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new DebateMediaError('DEBATE_MEDIA_UNAVAILABLE', 'Live media is not enabled for this Debate Room preview. Your saved event is safe.');
  }
  // Role revocation must remain effective with an old token. Self-hosted
  // revocation needs a separately verified implementation before being enabled.
  if (!url.hostname.endsWith('.livekit.cloud')) {
    throw new DebateMediaError('DEBATE_REVOCATION_UNVERIFIED', 'This media server needs its role-revocation check before debate calls can open.');
  }
  return { url: url.href.replace(/\/$/u, ''), serviceUrl: url.href.replace(/^wss:/u, 'https:') };
}

function validateSession(session) {
  if (!session || !opaque.test(session.identity || '') || !opaque.test(session.roomName || '')
    || !Array.isArray(session.sources) || session.sources.some((source) => !Object.hasOwn(SOURCE, source))
    || new Set(session.sources).size !== session.sources.length
    || !Number.isInteger(session.maxParticipants) || session.maxParticipants < 1 || session.maxParticipants > 100) {
    throw new DebateMediaError('DEBATE_MEDIA_SESSION_INVALID', 'The room permission could not be confirmed. Refresh before joining.', 409);
  }
  return session;
}

async function bounded(operation) {
  let timeout;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new DebateMediaError('DEBATE_MEDIA_PENDING', 'The room permission is still unconfirmed. Retry from the lobby.')), 12000);
    })]);
  } finally { clearTimeout(timeout); }
}

function permission(session) {
  return { canPublish: session.sources.length > 0, canSubscribe: true,
    canPublishData: false, canUpdateOwnMetadata: false,
    canPublishSources: session.sources.map((source) => SOURCE[source]) };
}

function absent(error) {
  return error?.status === 404 || error?.statusCode === 404 || error?.code === 'not_found';
}

/** Only the authorized durable outbox supplies jobs. No client payload is accepted here. */
export function createDebateMediaAdapter(env, options = {}) {
  function service() {
    const config = configuration(env);
    return options.service || new RoomServiceClient(config.serviceUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  async function remove(client, session) {
    validateSession(session);
    try { await bounded(() => client.removeParticipant(session.roomName, session.identity)); }
    catch (error) {
      // Cloud revokes an already-disconnected identity too. Other failures are
      // not successful private-room transfers and must keep the job pending.
      if (!absent(error)) throw error;
    }
  }

  async function apply(job) {
    const { action, session, previousSession } = job?.payload || {};
    validateSession(session);
    if (!['join', 'permissions', 'leave'].includes(action)) {
      throw new DebateMediaError('DEBATE_MEDIA_ACTION_INVALID', 'The room action is invalid.', 400);
    }
    const client = service();
    if (action === 'leave') { await remove(client, session); return { status: 'left' }; }
    if (previousSession && (previousSession.roomName !== session.roomName || previousSession.identity !== session.identity)) {
      await remove(client, previousSession);
    }
    const rooms = await bounded(() => client.listRooms([session.roomName]));
    let room = rooms.find((item) => item.name === session.roomName);
    if (!room) room = await bounded(() => client.createRoom({ name: session.roomName,
      maxParticipants: session.maxParticipants, emptyTimeout: 120, departureTimeout: 30,
      metadata: JSON.stringify({ schema: 'duediligence-debate-v3' }) }));
    if (room.maxParticipants !== session.maxParticipants) {
      throw new DebateMediaError('DEBATE_CAPACITY_UNCONFIRMED', 'The room capacity does not match its approved limit. Stay in the lobby.');
    }
    try { await bounded(() => client.updateParticipant(session.roomName, session.identity, { permission: permission(session) })); }
    catch (error) { if (!absent(error)) throw error; }
    return { status: 'ready', identity: session.identity, roomName: session.roomName, sources: [...session.sources] };
  }

  /** Call only after service.authorizeMedia checks the current actor and ready lease. */
  async function credential(session) {
    validateSession(session);
    const config = configuration(env);
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: session.identity, ttl: 120,
    });
    token.addGrant({ room: session.roomName, roomJoin: true, ...permission(session) });
    return { url: config.url, token: await token.toJwt(), identity: session.identity,
      roomName: session.roomName, sources: [...session.sources], expiresInSeconds: 120 };
  }
  return { apply, credential };
}
