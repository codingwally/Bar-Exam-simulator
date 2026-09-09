import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const SOURCE = Object.freeze({ camera: TrackSource.CAMERA, microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE, screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO });
const opaque = /^[a-zA-Z0-9_:-]{8,160}$/u;
const epoch = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export class DebateMediaError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}
const pending = () => new DebateMediaError('DEBATE_MEDIA_PENDING', 'We could not confirm your room connection. Stay in the lobby and try again.', 409);
function configuration(env, { cleanup = false } = {}) {
  let url;
  try { url = new URL(env.LIVEKIT_URL); } catch { /* Safe configuration error below. */ }
  if ((!cleanup && env.DEBATE_MEDIA_ENABLED !== 'true') || !url || url.protocol !== 'wss:'
    || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new DebateMediaError('DEBATE_MEDIA_UNAVAILABLE', 'Video and audio calls are not available yet. Your saved debate remains available.');
  }
  // Cloud token revocation is required; JWT expiry alone does not revoke a connected participant.
  if (!url.hostname.endsWith('.livekit.cloud')) {
    throw new DebateMediaError('DEBATE_REVOCATION_UNVERIFIED', 'Video and audio calls are not available. Contact Due Diligence for help.');
  }
  return { url: `wss://${url.host}`, serviceUrl: `https://${url.host}` };
}
function validateBinding(session) {
  if (!session || !opaque.test(session.identity || '') || !opaque.test(session.roomName || '')) throw pending();
}
function validateSession(session) {
  validateBinding(session);
  if (!epoch.test(session.epochId || '') || session.identity !== `dd-debate-${session.epochId}`
    || !Array.isArray(session.sources) || session.sources.some(source => !Object.hasOwn(SOURCE, source))
    || new Set(session.sources).size !== session.sources.length
    || !Number.isInteger(session.maxParticipants) || session.maxParticipants < 1 || session.maxParticipants > 100
    || !Number.isSafeInteger(session.expiresAt) || typeof session.deviceId !== 'string' || !session.deviceId
    || !Array.isArray(session.revocations) || session.revocations.length > 1000) throw pending();
  session.revocations.forEach(validateBinding);
  return session;
}
function permission(session) {
  return { canPublish: session.sources.length > 0, canSubscribe: true,
    canPublishData: false, canUpdateOwnMetadata: false,
    canPublishSources: session.sources.map(source => SOURCE[source]) };
}

/** Durable actor-authorized outbox jobs only. Permission epochs are immutable:
 * NEVER update existing participant grants. Delayed/duplicated jobs can remove
 * retired identities or create empty rooms, but cannot restore retired grants.
 */
export function createDebateMediaAdapter(env, options = {}) {
  const now = options.now || Date.now;
  function service(cleanup = false) {
    const config = configuration(env, { cleanup });
    // Abort SDK fetch; do not detach mutations with Promise.race or replay a
    // timed-out mutation through automatic regional failover.
    return options.service || new RoomServiceClient(config.serviceUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET,
      { requestTimeout: 12, failover: false });
  }
  async function current(job) {
    if (typeof options.authorizeJob !== 'function') throw pending();
    await options.authorizeJob(job);
  }
  async function remove(client, binding) {
    validateBinding(binding);
    // Cloud rejects integer-second nbf STRICTLY before cutoff. +1 includes
    // tokens minted this second. Replacement identities are never reused.
    // Explicit cutoff suppresses Cloud participant-absent errors. Any error,
    // including 404, stays unconfirmed; failure is not successful revocation.
    await client.removeParticipant(binding.roomName, binding.identity, { revokeTokenTs: BigInt(Math.floor(now() / 1000) + 1) });
  }
  async function apply(job) {
    const { action, session } = job?.payload || {};
    validateSession(session);
    if (!['join', 'permissions', 'leave'].includes(action)) throw pending();
    await current(job);
    const client = service(action === 'leave');
    const retired = [...session.revocations, ...(action === 'leave' ? [session] : [])], seen = new Set();
    for (const binding of retired) {
      const key = `${binding.roomName}:${binding.identity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A repeated delivery must never remove its own successfully joined epoch.
      if (action !== 'leave' && binding.identity === session.identity) throw pending();
      await current(job);
      await remove(client, binding);
    }
    await current(job);
    if (action === 'leave') return { status: 'left' };
    const rooms = await client.listRooms([session.roomName]);
    await current(job);
    let room = rooms.find(item => item.name === session.roomName);
    if (!room) room = await client.createRoom({ name: session.roomName, maxParticipants: session.maxParticipants,
      emptyTimeout: 120, departureTimeout: 30, metadata: JSON.stringify({ schema: 'duediligence-debate-v3' }) });
    await current(job);
    if (room.maxParticipants !== session.maxParticipants) {
      throw new DebateMediaError('DEBATE_CAPACITY_UNCONFIRMED', 'The room capacity does not match its approved limit. Stay in the lobby.');
    }
    return { status: 'ready', identity: session.identity, roomName: session.roomName, sources: [...session.sources] };
  }
  /** Reauthorize actor before AND after signing. Integration compares epoch,
   * device, operation, room, sources, and the current unexpired lease. */
  async function credential(session) {
    validateSession(session);
    const config = configuration(env), remaining = Math.floor((session.expiresAt - now()) / 1000) - 1;
    if (session.status !== 'ready' || session.revocations.length || !session.operationId || remaining < 1) throw pending();
    const expiresInSeconds = Math.min(30, remaining);
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: session.identity, ttl: expiresInSeconds });
    // Public ttl is passed to jose.setExpirationTime unchanged: absolute
    // seconds prevent asynchronous signing from extending the app lease.
    token.ttl = Math.min(Math.floor(session.expiresAt / 1000), Math.floor(now() / 1000) + expiresInSeconds);
    token.addGrant({ room: session.roomName, roomJoin: true, ...permission(session) });
    const signed = await token.toJwt();
    if (now() >= token.ttl * 1000 || now() >= session.expiresAt) throw pending();
    return { url: config.url, token: signed, identity: session.identity, roomName: session.roomName,
      sources: [...session.sources], expiresInSeconds: Math.max(0, token.ttl - Math.floor(now() / 1000)), expiresAt: token.ttl * 1000 };
  }
  return { apply, credential };
}
