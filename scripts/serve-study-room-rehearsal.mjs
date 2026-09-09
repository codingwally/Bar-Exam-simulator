/** Isolated test transport. Never serves hosted identities, real media, or provider credentials. */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createStudyRoomHandlers } from '../worker/study-room-routes.mjs';
import { createStudyRoomJoinCredential, listStudyRooms, createStudyRoom, configureStudyRoom,
  requireStudyRoomAdministratorPresence, revokeStudyRoomParticipantToken,
  studyRoomParticipantIdentity } from '../worker/study-room-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireWorker = createRequire(path.join(ROOT, 'worker/package.json'));
const { PGlite } = requireWorker('@electric-sql/pglite');
const { TokenVerifier } = requireWorker('livekit-server-sdk');
export const STUDY_TEST_ACTORS = Object.freeze(['admin','admin2','member','member2','paid'].map((key, index) => Object.freeze({
  key, id: `ad000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name: `Synthetic ${key}`, role: key.startsWith('admin') ? 'admin' : 'student', paid: key === 'paid',
})));
const SOURCE_FILES = ['study-room/index.html','assets/study-room-live.js','assets/study-room-live.css',
  'worker/study-room-routes.mjs','worker/study-room-core.mjs','worker/study-room-admission.mjs',
  'supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql',
  'supabase/migrations/20260909080143_study_room_admission_v3.sql',
  'scripts/serve-study-room-rehearsal.mjs','scripts/test-study-room-browser.mjs'];
const read = file => readFile(path.join(ROOT, file), 'utf8');
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { code, status }); };

// This bootstrap substitutes only authentication and disconnected SDK transport.
// The actual Study client, DOM, routes, authorization, signing and SQL are used.
function browserBootstrap() {
  const metrics = { constructors: 0, connects: 0, disconnects: 0, captures: 0, publications: 0, forbidden: [] };
  const transport = window.fetch.bind(window);
  const forbidden = name => { metrics.forbidden.push(name); throw new Error('SYNTHETIC_TEST_FORBIDS_' + name); };
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) return Promise.reject(new Error('NON_LOOPBACK_NETWORK_FORBIDDEN'));
    return transport(input, options);
  };
  window.WebSocket = class { constructor() { forbidden('WEBSOCKET'); } };
  window.RTCPeerConnection = class { constructor() { forbidden('WEBRTC'); } };
  const mediaDevices = { enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {},
    getUserMedia: async () => { metrics.captures++; return forbidden('CAPTURE'); },
    getDisplayMedia: async () => { metrics.captures++; return forbidden('DISPLAY_CAPTURE'); } };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  const call = async (route, body, token) => {
    const response = await fetch(route, { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.code || 'SYNTHETIC_TRANSPORT_FAILED');
    return result;
  };
  let sessionPromise = call('/__study/identity').then(result => result.session);
  const authListeners = new Set();
  window.supabase = { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: await sessionPromise } }),
    onAuthStateChange: listener => { authListeners.add(listener); return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } }; },
  } }) };
  window.DueDiligencePhase2Config = { workerUrl: location.origin,
    supabase: { url: location.origin + '/synthetic-auth', publishableKey: 'SYNTHETIC_LOCAL_ONLY' } };
  const rooms = new Set();
  class Room {
    constructor() {
      metrics.constructors++; rooms.add(this); this.listeners = new Map(); this.state = 'disconnected';
      this.remoteParticipants = new Map(); this.canPlaybackAudio = true;
      const disabled = async enabled => { if (enabled) { metrics.publications++; forbidden('MEDIA_ENABLE'); } };
      this.localParticipant = { identity: '', name: '', isLocal: true, attributes: {},
        trackPublications: new Map(), audioTrackPublications: new Map(), videoTrackPublications: new Map(),
        isCameraEnabled: false, isMicrophoneEnabled: false, isScreenShareEnabled: false,
        getTrackPublication() { return undefined; }, setCameraEnabled: disabled, setMicrophoneEnabled: disabled, setScreenShareEnabled: disabled,
        publishTrack: async () => { metrics.publications++; forbidden('PUBLICATION'); },
        unpublishTrack: async () => {}, setAttributes: async () => {}, sendText: async () => forbidden('CHAT_SEND'),
      };
    }
    on(name, listener) { if (!name) return this; const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); return this; }
    emit(name, ...args) { for (const listener of this.listeners.get(name) || []) listener(...args); }
    async connect(_url, token) {
      const session = await sessionPromise;
      const result = await call('/__study/connect', { participantToken: token }, session.access_token);
      this.sessionToken = session.access_token; this.connectionId = result.connectionId;
      this.localParticipant.identity = result.identity; this.localParticipant.name = result.name;
      this.name = result.roomName; this.state = 'connected'; metrics.connects++;
      this.emit('connectionStateChanged', this.state);
      this.poll = setInterval(async () => {
        try { const state = await call('/__study/connection', { connectionId: this.connectionId }, this.sessionToken);
          if (!state.active) { clearInterval(this.poll); this.state = 'disconnected'; this.emit('disconnected'); }
        } catch { clearInterval(this.poll); this.state = 'disconnected'; this.emit('disconnected'); }
      }, 250);
    }
    async disconnect() {
      clearInterval(this.poll);
      if (this.connectionId) await call('/__study/disconnect', { connectionId: this.connectionId }, this.sessionToken).catch(() => {});
      this.connectionId = null; this.state = 'disconnected'; metrics.disconnects++; rooms.delete(this);
    }
    async startAudio() {} registerTextStreamHandler() {} unregisterTextStreamHandler() {}
    async switchActiveDevice() { forbidden('DEVICE_SWITCH'); }
  }
  const eventNames = ['ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','TrackMuted','TrackUnmuted',
    'LocalTrackPublished','LocalTrackUnpublished','ParticipantNameChanged','ParticipantAttributesChanged','TrackStreamStateChanged',
    'ActiveSpeakersChanged','ConnectionStateChanged','Disconnected','AudioPlaybackStatusChanged'];
  window.LivekitClient = { Room, RoomEvent: Object.fromEntries(eventNames.map(name => [name, name[0].toLowerCase() + name.slice(1)])),
    Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' } } };
  window.__studySynthetic = { metrics, async switchActor(key) {
    const result = await call('/__study/actor', { key }); sessionPromise = Promise.resolve(result.session);
    for (const listener of authListeners) listener('SIGNED_IN', result.session);
  }, async closeTransports() { for (const room of [...rooms]) await room.disconnect(); } };
}

export async function startStudyRoomRehearsal({ outputDir = path.join(ROOT, 'artifacts/debate-local-rehearsal/study-browser-ci') } = {}) {
  const output = path.resolve(outputDir), allowedRoot = path.join(ROOT, 'artifacts/debate-local-rehearsal');
  if (!output.startsWith(allowedRoot + path.sep)) fail('TEST_OUTPUT_OUTSIDE_IGNORED_DIRECTORY');
  await mkdir(output, { recursive: true });
  const db = new PGlite(); let server, serial = Promise.resolve(), closed = false;
  const logs = [], credentials = new Map(), connections = new Map(), registry = new Map(), cutoffs = new Map();
  const metrics = { signedCredentials: 0, connections: 0, revoked: 0, providerCalls: 0, rpcCalls: 0 };
  const tokens = new Map(STUDY_TEST_ACTORS.map(actor => [randomBytes(24).toString('hex'), actor]));
  const tokenFor = actor => [...tokens].find(([, value]) => value.id === actor.id)[0];
  const actorByKey = key => STUDY_TEST_ACTORS.find(actor => actor.key === key);
  const env = { STUDY_ROOM_ENABLED: 'true', STUDY_ROOM_NAME: 'synthetic-study-ci',
    LIVEKIT_URL: 'wss://synthetic-study-ci.livekit.cloud', LIVEKIT_API_KEY: 'synthetic-key', LIVEKIT_API_SECRET: randomBytes(32).toString('hex') };
  const verifier = new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const rpc = (name, args = {}) => {
    const allowed = new Set(['study_room_catalog_v2','study_room_configure_v2','study_room_admission_v1','admin_authorization_context']);
    if (!allowed.has(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) fail('UNEXPECTED_TEST_RPC');
    const operation = serial.then(async () => {
      await db.exec('begin; set local role service_role;');
      try {
        const keys = Object.keys(args), values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
        const result = (await db.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, values)).rows[0].result;
        await db.exec('commit'); metrics.rpcCalls++; return result;
      } catch (error) { await db.exec('rollback'); throw error; }
    });
    serial = operation.catch(() => {}); return operation;
  };
  const roomService = {
    async listRooms(names) { return [...registry.values()].filter(room => names.includes(room.name)).map(room => ({ ...room, numParticipants: [...connections.values()].filter(c => c.active && c.roomName === room.name).length })); },
    async createRoom(room) { if (!registry.has(room.name)) registry.set(room.name, { ...room, creationTime: Math.floor(Date.now() / 1000) }); return registry.get(room.name); },
    async getParticipant(roomName, identity) { const active = [...connections.values()].find(c => c.active && c.roomName === roomName && c.identity === identity); if (!active) fail('SYNTHETIC_PARTICIPANT_ABSENT'); return { identity, state: 2 }; },
    async removeParticipant(roomName, identity, options) {
      if (typeof options?.revokeTokenTs !== 'bigint') fail('TEST_REVOCATION_CUTOFF_REQUIRED');
      const key = roomName + ':' + identity; cutoffs.set(key, Math.max(cutoffs.get(key) || 0, Number(options.revokeTokenTs)));
      for (const connection of connections.values()) if (connection.roomName === roomName && connection.identity === identity) connection.active = false;
      metrics.revoked++;
    },
  };
  const providerOptions = options => ({ ...options, roomService });
  const session = actor => ({ access_token: tokenFor(actor), user: { id: actor.id, user_metadata: { full_name: actor.name } } });
  const actorFor = request => tokens.get((request.headers.get('authorization') || '').replace(/^Bearer /, '')) || null;
  let delayedRequest = null;
  const handlers = createStudyRoomHandlers({
    authenticate: async request => actorFor(request),
    authorizeAdmin: async (_env, user) => {
      try { return await rpc('admin_authorization_context', { p_actor_user_id: user.id }); }
      catch (error) {
        if (error.code === 'P0001' && error.message === 'Administrator authorization required') return { authorized:false };
        throw error;
      }
    },
    authorizeMember: async (_env, user) => ({ allowed: STUDY_TEST_ACTORS.some(actor => actor.id === user.id), basis: 'signed_in' }),
    verifyPaidMembership: async (_env, user) => actorByKey(user.key)?.paid === true,
    rateLimit: async () => {}, // Actual per-actor limiter has its own Worker integration test; no traffic capacity claim here.
    parseJson: async request => request.json(),
    respond: (body, status) => Response.json(body, { status }),
    readCatalog: () => rpc('study_room_catalog_v2'),
    configureCatalog: (_env, args) => rpc('study_room_configure_v2', args),
    admissionRpc: async (_env, args) => {
      const result = await rpc('study_room_admission_v1', args);
      if (delayedRequest && args.p_command.operation === 'request' && args.p_command.actor === delayedRequest.actorId) {
        delayedRequest.committed = true; await delayedRequest.promise;
      }
      return result;
    },
    admissionPresence: (e, actor, room, options) => requireStudyRoomAdministratorPresence(e, actor, room, providerOptions(options)),
    admissionRevokeToken: (e, room, identity, options) => revokeStudyRoomParticipantToken(e, room, identity, providerOptions(options)),
    listRooms: (e, options) => listStudyRooms(e, providerOptions(options)),
    createRoom: (e, room, options) => createStudyRoom(e, room, providerOptions(options)),
    configureRoom: (e, user, body, options) => configureStudyRoom(e, user, body, providerOptions(options)),
    issueCredential: async (e, user, room, nickname, options) => {
      const result = await createStudyRoomJoinCredential(e, user, room, nickname, providerOptions(options));
      credentials.set(result.participantToken, { actorId: user.id, roomKey: result.roomKey, roomName: result.roomName, identity: result.participantIdentity });
      metrics.signedCredentials++; return result;
    },
  });
  const endpoint = new Map([['/study-room/access','access'],['/study-room/rooms','rooms'],['/admin/study-room/rooms','rooms'],
    ['/study-room/join','join'],['/study-room/admission','admission'],['/admin/study-room/admission','admission'],['/study-room/moderate','moderate']]);
  try {
    const oldHelper = await read('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');
    const start = oldHelper.indexOf('create or replace function public.admin_authorization_context(');
    if (start < 0) fail('AUTHORIZATION_HELPER_MISSING');
    const helper = oldHelper.slice(start, oldHelper.indexOf('\n$$;', start) + 4)
      .replace("if v_role not in ('admin', 'founder_admin', 'super_admin') then", "if v_role is null or v_role not in ('admin', 'founder_admin', 'super_admin') then");
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; grant usage on schema private to service_role;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
      create table public.admin_capabilities(user_id uuid references auth.users(id),capability text,revoked_at timestamptz);
      ${helper}
      revoke all on function public.admin_authorization_context(uuid) from public,anon,authenticated;
      grant execute on function public.admin_authorization_context(uuid) to service_role;`);
    for (const actor of STUDY_TEST_ACTORS) { await db.query('insert into auth.users(id) values($1)', [actor.id]); await db.query('insert into public.user_roles values($1,$2)', [actor.id, actor.role]); }
    await db.exec(await read(SOURCE_FILES[6])); await db.exec(await read(SOURCE_FILES[7]));
    const html = (await read('study-room/index.html')).replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,
      tag => tag.includes('assets/study-room-live.js') ? tag : '')
      .replace('</head>', `<script>(${browserBootstrap.toString()})();</script></head>`)
      .replace('<body>', '<body><aside id="study-synthetic-notice">SYNTHETIC LOCAL STUDY TEST — no real identity, provider, camera or microphone.</aside>');
    let port;
    const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    const json = (response, body, status = 200, extra = {}) => { response.writeHead(status, { ...headers, ...extra, 'Content-Type':'application/json' }); response.end(JSON.stringify(body)); };
    server = http.createServer(async (incoming, response) => {
      let actor = null, route = '', operation = null, status = 500;
      try {
        const origin = `http://127.0.0.1:${port}`;
        if (incoming.socket.remoteAddress !== '127.0.0.1' || incoming.headers.host !== `127.0.0.1:${port}`) fail('LOOPBACK_ONLY');
        const url = new URL(incoming.url, origin); route = url.pathname;
        if (incoming.headers.origin && incoming.headers.origin !== origin) fail('ORIGIN_NOT_ALLOWED');
        if (incoming.headers['sec-fetch-site'] && !['same-origin','none'].includes(incoming.headers['sec-fetch-site'])) fail('ORIGIN_NOT_ALLOWED');
        const chunks = []; let size = 0;
        for await (const chunk of incoming) { size += chunk.length; if (size > 8192) fail('PAYLOAD_TOO_LARGE', 413); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes.toString()) : null;
        const request = new Request(origin + route, { method: incoming.method, headers: incoming.headers, ...(bytes.length ? { body: bytes } : {}) });
        actor = actorFor(request); operation = body?.operation || null;
        const cookieActor = actorByKey(/(?:^|;\s*)study_synthetic_actor=([^;]+)/.exec(incoming.headers.cookie || '')?.[1]) || STUDY_TEST_ACTORS[0];
        if (route === '/__study/identity' && incoming.method === 'GET') { status = 200; return json(response, { session: session(cookieActor) }); }
        if (route === '/__study/actor' && incoming.method === 'POST') {
          const next = actorByKey(body?.key); if (!next) fail('UNKNOWN_SYNTHETIC_ACTOR', 400);
          status = 200; return json(response, { session: session(next) }, status, { 'Set-Cookie': `study_synthetic_actor=${next.key}; Path=/; SameSite=Strict; HttpOnly` });
        }
        if (route.startsWith('/__study/') && incoming.method === 'POST') {
          if (!actor) fail('AUTH_REQUIRED', 401);
          if (route === '/__study/connect') {
            const issued = credentials.get(body?.participantToken); if (!issued || issued.actorId !== actor.id) fail('UNISSUED_OR_WRONG_ACTOR_TOKEN');
            const claims = await verifier.verify(body.participantToken);
            if (claims.sub !== issued.identity || claims.video?.room !== issued.roomName || claims.video?.roomJoin !== true || claims.exp <= Date.now()/1000) fail('INVALID_SYNTHETIC_TOKEN');
            const cutoff = cutoffs.get(issued.roomName + ':' + issued.identity);
            if (cutoff != null && (!Number.isFinite(claims.nbf) || claims.nbf <= cutoff)) fail('REVOKED_SYNTHETIC_TOKEN');
            const connectionId = randomBytes(16).toString('hex');
            connections.set(connectionId, { ...issued, connectionId, active: true }); metrics.connections++;
            status = 200; return json(response, { connectionId, identity: claims.sub, roomName: issued.roomName, name: claims.name });
          }
          const connection = connections.get(body?.connectionId);
          if (!connection || connection.actorId !== actor.id) fail('CONNECTION_OWNER_REQUIRED');
          if (route === '/__study/disconnect') connection.active = false;
          else if (route !== '/__study/connection') fail('UNKNOWN_SYNTHETIC_ROUTE', 404);
          status = 200; return json(response, { active: connection.active });
        }
        if (endpoint.has(route)) {
          if (incoming.method !== 'POST') fail('METHOD_NOT_ALLOWED', 405);
          const result = await handlers[endpoint.get(route)](request, env);
          status = result.status; return json(response, await result.json(), status);
        }
        if (incoming.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405);
        if (route === '/study-room/' || route === '/study-room/index.html') { status = 200; response.writeHead(status, { ...headers, 'Content-Type':'text/html' }); return response.end(html); }
        if (route === '/assets/study-room-live.js' || route === '/assets/study-room-live.css'
          || /^\/assets\/(?:icons\/[a-z-]+\/[a-z0-9-]+\.svg|brand\/[a-z0-9-]+\.(?:png|ico)|study-room\/[a-z0-9-]+\.webp)$/.test(route)) {
          const content = route.endsWith('.css') ? (await read(route.slice(1))).replace(/@import\s+url\([^)]*\)\s*;/g, '') : await readFile(path.join(ROOT, route.slice(1)));
          const mime = { '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.webp':'image/webp' }[path.extname(route)];
          status = 200; response.writeHead(status, { ...headers, 'Content-Type':mime }); return response.end(content);
        }
        fail('UNKNOWN_TEST_ROUTE', 404);
      } catch (error) {
        const sqlStatus = { PT400:400, PT409:409, PT429:429, '42501':403 }[error.code];
        status = error.status || sqlStatus || 500;
        const code = sqlStatus ? error.message : error.code || 'SYNTHETIC_HARNESS_ERROR';
        json(response, { ok:false, error:{ code, message: code } }, status);
      } finally { logs.push({ at:new Date().toISOString(), path:route, operation, actorKey:actor?.key || null, status }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    return { origin, output, actors: STUDY_TEST_ACTORS, metrics, logs, rpc,
      async request(key, route, body = {}) { const actor = actorByKey(key); return fetch(origin + route, { method:'POST', headers:{ 'Content-Type':'application/json', ...(actor ? { Authorization:'Bearer '+tokenFor(actor) } : {}) }, body:JSON.stringify(body) }); },
      async catalog() { return rpc('study_room_catalog_v2'); },
      holdRequest(key) { if (delayedRequest) fail('TEST_DELAY_ALREADY_PENDING'); let release; const promise = new Promise(resolve => { release = resolve; }); delayedRequest = { actorId:actorByKey(key).id, promise, release, committed:false }; },
      get heldRequestCommitted() { return delayedRequest?.committed === true; },
      releaseRequest() { const current = delayedRequest; delayedRequest = null; current?.release(); },
      async close() {
        if (closed) return; closed = true; const pending = delayedRequest; delayedRequest = null; pending?.release();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        await serial; await db.close();
        await writeFile(path.join(output, 'request-log.jsonl'), logs.map(row => JSON.stringify(row)).join('\n') + '\n');
        const sourceHashes = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, createHash('sha256').update(await readFile(path.join(ROOT,file))).digest('hex')])));
        await writeFile(path.join(output, 'harness.json'), JSON.stringify({ status:'CLOSED', sourceHashes, metrics, synthetic:true, actualSQL:true,
          substitutions:['HTML replaces external SDK/config/auth/background scripts with synthetic auth and inert SDK transport; actual Study live.js is unchanged.',
            'CSS external font imports removed for isolated rendering; no production bootstrap or font-loading claim.',
            'Admin authorization helper and prerequisite auth tables match the existing local SQL fixture; no hosted authentication.',
            'LiveKit active presence/revocation is a JWT-backed inert registry; no provider behavior or rate-limit capacity claim.'],
          realAuthentication:false, physicalMedia:false, providerNetwork:false, databasePersisted:false, productionChanges:false }, null, 2));
      },
    };
  } catch (error) { if (server) server.close(); await db.close(); throw error; }
}
