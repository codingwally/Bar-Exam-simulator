import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
  VideoStream,
  dispose,
} from "@livekit/rtc-node";

const APPROVED_STAGING_SUPABASE = "https://hlzqmreeoghbldnhlybr.supabase.co";
const APPROVED_STAGING_WORKER =
  "https://duediligence-examinations-staging.wallyesteban1993.workers.dev";
const APPROVED_STAGING_ROOM = "dd-study-room-admin-beta-staging-v1";
const STUDY_ROOM_MAX_ROOMS = 5;
const STUDY_ROOM_SLOTS = Object.freeze([
  Object.freeze({ roomKey: "1", label: "Library", kind: "library", microphoneAllowed: false, adminOnly: false }),
  Object.freeze({ roomKey: "2", label: "Room 1", kind: "general", microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: "3", label: "Room 2", kind: "general", microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: "4", label: "Room 3", kind: "general", microphoneAllowed: true, adminOnly: false }),
  Object.freeze({ roomKey: "5", label: "Inner Chamber", kind: "inner-chamber", microphoneAllowed: true, adminOnly: true }),
]);
const APPROVED_STAGING_ROOMS = Object.freeze(
  Array.from({ length: STUDY_ROOM_MAX_ROOMS }, (_unused, index) =>
    index === 0
      ? APPROVED_STAGING_ROOM
      : `${APPROVED_STAGING_ROOM}-${index + 1}`,
  ),
);
const STUDY_ROOM_MAX_PARTICIPANTS = 12;
const STUDY_ROOM_TOKEN_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 45_000;
const RTC_TIMEOUT_MS = 30_000;
const SUPABASE_ADMIN_MAX_ATTEMPTS = 4;
const SUPABASE_ADMIN_RETRY_BASE_MS = 350;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PARTICIPANT_ID_PATTERN = /^sr_[A-Za-z0-9_-]{24}$/u;
const TRACK_SID_PATTERN = /^TR_[A-Za-z0-9_-]{4,128}$/u;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

let checkpoint = "startup";

function assertPlainObject(value, message) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    message,
  );
  return value;
}

function approvedRoomKey(value) {
  const roomKey = String(value || "").trim();
  assert.match(roomKey, /^[1-5]$/u, "The smoke requested an invalid room slot.");
  return roomKey;
}

function approvedRoomName(roomKey) {
  return APPROVED_STAGING_ROOMS[Number(approvedRoomKey(roomKey)) - 1];
}

function decodeJwtSegment(value) {
  assert.match(
    value,
    /^[A-Za-z0-9_-]+$/u,
    "The participant token contains an invalid JWT segment.",
  );
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  assert.ok(
    decoded.length > 0 && decoded.length <= 8_192,
    "The participant token claim set is invalid.",
  );
  return assertPlainObject(
    JSON.parse(decoded),
    "The participant token claim set is invalid.",
  );
}

export function validateStudyRoomJwt(token, expected) {
  assert.ok(
    typeof token === "string" && token.length >= 80 && token.length <= 8_192,
    "The Study Room participant token is invalid.",
  );
  const segments = token.split(".");
  assert.equal(
    segments.length,
    3,
    "The Study Room participant token must be a signed JWT.",
  );
  const header = decodeJwtSegment(segments[0]);
  const claims = decodeJwtSegment(segments[1]);
  const nowSeconds = Math.floor(Date.now() / 1_000);

  assert.equal(
    header.alg,
    "HS256",
    "The Study Room token must use LiveKit HS256 signing.",
  );
  assert.ok(
    header.typ === undefined || header.typ === "JWT",
    "The Study Room token type is invalid.",
  );
  assert.equal(
    claims.iss,
    expected.issuer,
    "The Study Room token issuer is not the configured LiveKit key.",
  );
  assert.equal(
    claims.sub,
    expected.identity,
    "The Study Room token identity does not match the join response.",
  );
  assert.equal(
    claims.name,
    expected.nickname,
    "The Study Room token nickname does not match the join response.",
  );
  assert.ok(
    Number.isSafeInteger(claims.nbf),
    "The Study Room token is missing its not-before time.",
  );
  assert.ok(
    Number.isSafeInteger(claims.exp),
    "The Study Room token is missing its expiry time.",
  );
  assert.ok(
    claims.nbf <= nowSeconds + 30 && claims.nbf >= nowSeconds - 180,
    "The Study Room token not-before time is outside the release window.",
  );
  assert.equal(
    claims.exp - claims.nbf,
    STUDY_ROOM_TOKEN_TTL_SECONDS,
    "The Study Room token lifetime must remain ten minutes.",
  );
  assert.ok(
    claims.exp > nowSeconds,
    "The Study Room token is already expired.",
  );

  const video = assertPlainObject(
    claims.video,
    "The Study Room token is missing its video grant.",
  );
  assert.equal(
    video.room,
    expected.roomName,
    "The token is bound to the wrong Study Room.",
  );
  assert.equal(
    video.roomJoin,
    true,
    "The token is missing its roomJoin grant.",
  );
  assert.equal(
    video.canPublish,
    true,
    "The token is missing its canPublish grant.",
  );
  assert.equal(
    video.canSubscribe,
    true,
    "The token is missing its canSubscribe grant.",
  );
  assert.equal(video.canPublishData, true, "Room chat requires LiveKit data publication.");
  const expectedSources = expected.microphoneAllowed === false
    ? ["camera", "screen_share"]
    : ["camera", "microphone", "screen_share", "screen_share_audio"];
  assert.deepEqual(
    [...(video.canPublishSources || [])].sort(),
    [...expectedSources].sort(),
    expected.microphoneAllowed === false
      ? "Library must deny microphone and screen-share audio at the token layer."
      : "Standard Study Rooms must allow camera, microphone, and presentation sources.",
  );
  assert.notEqual(
    video.roomAdmin,
    true,
    "Participant tokens must not contain room-administrator grants.",
  );
  assert.notEqual(
    video.roomCreate,
    true,
    "Participant tokens must not contain room-creation grants.",
  );
  assert.equal(video.canUpdateOwnMetadata, true, "Raise hand requires participant attributes.");
  assert.equal(
    claims.roomConfig,
    undefined,
    "A join token must never auto-create or silently repair a room.",
  );
  assert.ok(
    !claims.metadata,
    "Participant tokens must not contain personal metadata.",
  );
  return claims;
}

function runtimeConfiguration() {
  const supabaseUrl = String(
    process.env.STAGING_SUPABASE_URL || APPROVED_STAGING_SUPABASE,
  ).replace(/\/+$/u, "");
  const workerUrl = String(
    process.env.STAGING_EXAMINATION_WORKER_URL ||
      process.env.STUDY_ROOM_WORKER_URL ||
      APPROVED_STAGING_WORKER,
  ).replace(/\/+$/u, "");
  const origin = String(
    process.env.STAGING_EXAMINATION_ORIGIN ||
      process.env.STUDY_ROOM_ALLOWED_ORIGIN ||
      APPROVED_STAGING_WORKER,
  ).replace(/\/+$/u, "");
  const serviceRoleKey = String(
    process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();
  const publishableKey = String(
    process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || "",
  ).trim();
  const liveKitApiKey = String(process.env.LIVEKIT_API_KEY || "").trim();

  assert.equal(
    supabaseUrl,
    APPROVED_STAGING_SUPABASE,
    "Refusing to provision synthetic users outside the approved Supabase staging project.",
  );
  assert.equal(
    workerUrl,
    APPROVED_STAGING_WORKER,
    "Refusing to test Study Room endpoints outside the approved staging Worker.",
  );
  assert.equal(
    origin,
    APPROVED_STAGING_WORKER,
    "The positive smoke must use the approved staging origin.",
  );
  assert.match(
    serviceRoleKey,
    /^sb_secret_[A-Za-z0-9_-]{20,}$/u,
    "A dedicated staging Supabase secret key is required.",
  );
  assert.match(
    publishableKey,
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/u,
    "The staging Supabase publishable key is required.",
  );
  assert.match(
    liveKitApiKey,
    /^[A-Za-z0-9_-]{8,128}$/u,
    "The expected LiveKit API key is required to validate token issuer claims.",
  );

  return Object.freeze({
    liveKitApiKey,
    origin,
    publishableKey,
    serviceRoleKey,
    supabaseUrl,
    workerUrl,
  });
}

async function responseBody(response) {
  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (contentType.includes("application/json"))
    return response.json().catch(() => null);
  return null;
}

function safeRemoteCode(body) {
  const value = String(
    body?.error?.code ||
      body?.error_code ||
      body?.code ||
      "REMOTE_CONTRACT_ERROR",
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, "_")
    .slice(0, 80);
  return /^[A-Z0-9_]{2,80}$/u.test(value)
    ? value
    : "REMOTE_CONTRACT_ERROR";
}

async function requestJson(url, options = {}, expectedStatuses = [200]) {
  const response = await fetch(url, {
    redirect: "error",
    ...options,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!expectedStatuses.includes(response.status)) {
    const remoteCode = safeRemoteCode(body);
    const error = new Error(
      `${options.method || "GET"} ${new URL(url).pathname} returned ${response.status} ${remoteCode}`,
    );
    error.name = "RemoteRequestError";
    error.remoteStatus = response.status;
    error.remoteCode = remoteCode;
    throw error;
  }
  return { body, response };
}

function isRetryableSupabaseAdminFailure(error) {
  const status = Number(error?.remoteStatus || 0);
  const code = String(error?.remoteCode || "");
  return (
    [429, 500, 502, 503, 504].includes(status) ||
    (status === 403 && ["BAD_JWT", "UNRECOGNIZED_JWT_KID"].includes(code))
  );
}

async function requestSupabaseAdminJson(
  configuration,
  path,
  options = {},
  expectedStatuses = [200],
) {
  assert.match(
    path,
    /^\/auth\/v1\/admin\/users(?:\/|\?|$)/u,
    "The staging smoke attempted an unapproved Supabase Admin route.",
  );
  for (let attempt = 1; attempt <= SUPABASE_ADMIN_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestJson(
        `${configuration.supabaseUrl}${path}`,
        options,
        expectedStatuses,
      );
    } catch (error) {
      if (
        attempt >= SUPABASE_ADMIN_MAX_ATTEMPTS ||
        !isRetryableSupabaseAdminFailure(error)
      ) {
        throw error;
      }
      console.warn(
        `STUDY_ROOM_STAGING_POSITIVE: admin_api_retry=${attempt} status=${error.remoteStatus} code=${error.remoteCode}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, SUPABASE_ADMIN_RETRY_BASE_MS * 2 ** (attempt - 1)),
      );
    }
  }
  throw new Error("The Supabase Admin retry boundary was exhausted.");
}

function serviceHeaders(configuration, contentType = false) {
  return {
    apikey: configuration.serviceRoleKey,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
  };
}

async function createSyntheticUser(configuration, label, runId, createdUsers) {
  const email = `dd-study-room-${label}-${runId}@example.com`;
  const password = `Dd!${randomBytes(30).toString("base64url")}9z`;
  const { body: createdBody } = await requestSupabaseAdminJson(
    configuration,
    "/auth/v1/admin/users",
    {
      method: "POST",
      headers: serviceHeaders(configuration, true),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Synthetic Study Room ${label}` },
      }),
    },
    [200, 201],
  );
  const created = createdBody?.user || createdBody;
  assert.match(
    String(created?.id || ""),
    UUID_PATTERN,
    "Supabase did not create the synthetic user.",
  );
  const cleanupRecord = { id: created.id, token: null };
  createdUsers.push(cleanupRecord);

  const { body: session } = await requestJson(
    `${configuration.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: configuration.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  assert.ok(
    typeof session?.access_token === "string" &&
      session.access_token.length > 80,
    "Supabase did not issue a synthetic-user session.",
  );
  cleanupRecord.token = session.access_token;
  return Object.freeze({ id: created.id, token: session.access_token });
}

async function assignSyntheticRole(configuration, userId, role, assignedBy) {
  const { body } = await requestJson(
    `${configuration.supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        ...serviceHeaders(configuration, true),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        role,
        assigned_by: assignedBy || null,
        updated_at: new Date().toISOString(),
      }),
    },
    [200],
  );
  assert.equal(
    Array.isArray(body) ? body.length : 0,
    1,
    "The synthetic user role row was not updated exactly once.",
  );
  assert.equal(body[0]?.user_id, userId);
  assert.equal(body[0]?.role, role);
}

async function grantSyntheticFoundingAccess(configuration, actorUserId, member) {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const { body } = await requestJson(
    `${configuration.supabaseUrl}/rest/v1/free_beta_access?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(configuration, true),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: member.id,
        enabled: true,
        expires_at: expiresAt,
        reason: "Study Room subscriber staging verification",
        created_by: actorUserId,
        updated_by: actorUserId,
        access_program: "founding_beta_2026",
      }),
    },
    [200, 201],
  );
  assert.equal(Array.isArray(body) ? body.length : 0, 1);
  assert.equal(body[0]?.enabled, true);
  assert.equal(body[0]?.access_program, "founding_beta_2026");
}

async function acceptSyntheticCurrentTerms(configuration, member) {
  const settingsUrl = new URL(
    `${configuration.supabaseUrl}/rest/v1/platform_access_settings`,
  );
  settingsUrl.searchParams.set("singleton", "eq.true");
  settingsUrl.searchParams.set(
    "select",
    "current_terms_version,current_privacy_version",
  );
  const { body: rows } = await requestJson(settingsUrl, {
    headers: serviceHeaders(configuration),
  });
  assert.equal(
    Array.isArray(rows) ? rows.length : 0,
    1,
    "The current staging legal versions were unavailable.",
  );
  const termsVersion = String(rows[0]?.current_terms_version || "").trim();
  const privacyVersion = String(rows[0]?.current_privacy_version || "").trim();
  assert.match(termsVersion, /^[A-Za-z0-9._-]{5,120}$/u);
  assert.match(privacyVersion, /^[A-Za-z0-9._-]{5,120}$/u);
  await requestJson(
    `${configuration.supabaseUrl}/rest/v1/rpc/accept_terms`,
    {
      method: "POST",
      headers: {
        apikey: configuration.publishableKey,
        Authorization: `Bearer ${member.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_terms_version: termsVersion,
        p_privacy_version: privacyVersion,
        p_acceptance_source: "study_room_staging_smoke",
      }),
    },
    [200, 204],
  );
}

async function workerPost(
  configuration,
  path,
  token,
  payload,
  expectedStatuses = [200],
) {
  const { body, response } = await requestJson(
    `${configuration.workerUrl}${path}`,
    {
      method: "POST",
      headers: {
        Origin: configuration.origin,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(payload || {}),
    },
    expectedStatuses,
  );
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    configuration.origin,
    "The staging endpoint did not return the approved CORS origin.",
  );
  assert.match(
    String(response.headers.get("cache-control") || ""),
    /\bno-store\b/iu,
    "Authenticated Study Room responses must not be cached.",
  );
  return { body, response };
}

function validateAccessResponse(body, expectedRole, expectedAdministrator = true) {
  assert.equal(body?.ok, true);
  assert.equal(body?.allowed, true);
  assert.equal(body?.role, expectedRole);
  assert.equal(body?.administrator, expectedAdministrator);
  assert.equal(body?.canCreateRooms, expectedAdministrator);
  assert.equal(body?.maxRooms, STUDY_ROOM_MAX_ROOMS);
  assert.equal(body?.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(body?.recording, false);
}

function validatePublicRoomDescriptor(room, expectedRoomKey, expectedActive) {
  const slot = STUDY_ROOM_SLOTS[Number(approvedRoomKey(expectedRoomKey)) - 1];
  const descriptor = assertPlainObject(
    room,
    `Study Room ${expectedRoomKey} is missing from the room catalog.`,
  );
  assert.deepEqual(
    Object.keys(descriptor).sort(),
    [
      "active",
      "adminOnly",
      "canCreate",
      "canJoin",
      "capacity",
      "focusStartedAt",
      "kind",
      "label",
      "microphoneAllowed",
      "participantCount",
      "roomKey",
    ],
    "The public room descriptor exposed an unexpected field.",
  );
  assert.equal(descriptor.roomKey, expectedRoomKey);
  assert.equal(descriptor.label, slot.label);
  assert.equal(descriptor.kind, slot.kind);
  assert.equal(descriptor.microphoneAllowed, slot.microphoneAllowed);
  assert.equal(descriptor.adminOnly, slot.adminOnly);
  assert.equal(typeof descriptor.canCreate, "boolean");
  assert.equal(typeof descriptor.canJoin, "boolean");
  assert.equal(typeof descriptor.active, "boolean");
  if (typeof expectedActive === "boolean") {
    assert.equal(descriptor.active, expectedActive);
  }
  assert.equal(descriptor.capacity, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.ok(
    Number.isSafeInteger(descriptor.participantCount) &&
      descriptor.participantCount >= 0 &&
      descriptor.participantCount <= STUDY_ROOM_MAX_PARTICIPANTS,
    "The public room participant count is outside the configured capacity.",
  );
  if (descriptor.active) {
    assert.ok(
      Number.isFinite(Date.parse(descriptor.focusStartedAt)),
      "An active Study Room is missing its focus start time.",
    );
  } else {
    assert.equal(descriptor.focusStartedAt, null);
    assert.equal(descriptor.participantCount, 0);
  }
  return descriptor;
}

function validateRoomCatalog(body, expectedRole, expectedActiveKeys = null, expectedAdministrator = true) {
  assert.equal(body?.ok, true);
  assert.equal(body?.allowed, true);
  assert.equal(body?.role, expectedRole);
  assert.equal(body?.administrator, expectedAdministrator);
  assert.equal(body?.canCreateRooms, expectedAdministrator);
  assert.equal(body?.maxRooms, STUDY_ROOM_MAX_ROOMS);
  assert.equal(body?.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(body?.recording, false);
  assert.equal(body?.rooms?.length, STUDY_ROOM_MAX_ROOMS);
  const activeKeys = Array.isArray(expectedActiveKeys)
    ? new Set(expectedActiveKeys.map(approvedRoomKey))
    : null;
  const rooms = body.rooms.map((room, index) =>
    validatePublicRoomDescriptor(
      room,
      String(index + 1),
      activeKeys ? activeKeys.has(String(index + 1)) : undefined,
    ),
  );
  for (const room of rooms) {
    assert.equal(room.canCreate, expectedAdministrator);
    assert.equal(room.canJoin, room.adminOnly ? expectedAdministrator : true);
  }
  const serialized = JSON.stringify(body);
  for (const roomName of APPROVED_STAGING_ROOMS) {
    assert.equal(
      serialized.includes(roomName),
      false,
      "The room catalog must not expose internal LiveKit room names.",
    );
  }
  return rooms;
}

function validateCreatedRoom(body, expectedRoomKey, expectedStatus) {
  assert.equal(body?.ok, true);
  assert.equal(body?.created, expectedStatus === 201);
  validatePublicRoomDescriptor(body?.room, expectedRoomKey, true);
  assert.equal(
    JSON.stringify(body).includes(approvedRoomName(expectedRoomKey)),
    false,
    "Room creation must not expose the internal LiveKit room name.",
  );
}

function validateRejectedRoomOperation(body, expectedCode) {
  assert.equal(body?.ok, false);
  assert.equal(body?.error?.code, expectedCode);
  assert.equal(
    JSON.stringify(body).includes(APPROVED_STAGING_ROOM),
    false,
    "A rejected room operation exposed the internal LiveKit room name.",
  );
}

async function waitForRoomParticipantCounts(
  configuration,
  token,
  expectedRole,
  expectedMinimums,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const catalog = await workerPost(
      configuration,
      "/study-room/rooms",
      token,
      { operation: "list" },
    );
    const rooms = validateRoomCatalog(
      catalog.body,
      expectedRole,
      ["1", "2", "3", "4", "5"],
    );
    const settled = Object.entries(expectedMinimums).every(
      ([roomKey, minimum]) =>
        rooms[Number(approvedRoomKey(roomKey)) - 1].participantCount >= minimum,
    );
    if (settled) return rooms;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The five-room participant catalog did not settle in time.");
}

function validateJoinResponse(body, expectedNickname, issuer, expectedRoomKey) {
  const roomKey = approvedRoomKey(expectedRoomKey);
  const roomName = approvedRoomName(roomKey);
  assert.equal(body?.ok, true);
  assert.equal(body?.room_key, roomKey);
  const slot = STUDY_ROOM_SLOTS[Number(roomKey) - 1];
  assert.equal(body?.room_label, slot.label);
  assert.equal(body?.room_name, roomName);
  assert.equal(body?.room_kind, slot.kind);
  assert.equal(body?.microphone_allowed, slot.microphoneAllowed);
  assert.equal(body?.participant_name, expectedNickname);
  assert.match(
    String(body?.participant_identity || ""),
    PARTICIPANT_ID_PATTERN,
  );
  assert.equal(body?.expires_in_seconds, STUDY_ROOM_TOKEN_TTL_SECONDS);
  assert.equal(body?.recording, false);
  assert.ok(
    Number.isFinite(Date.parse(body?.focus_started_at)),
    "The Study Room join response is missing a shared focus start time.",
  );

  const serverUrl = new URL(String(body?.server_url || ""));
  assert.equal(serverUrl.protocol, "wss:");
  assert.equal(serverUrl.username, "");
  assert.equal(serverUrl.password, "");
  assert.equal(serverUrl.search, "");
  assert.equal(serverUrl.hash, "");
  assert.ok(
    serverUrl.hostname &&
      (serverUrl.pathname === "/" || serverUrl.pathname === ""),
    "The Study Room server URL must be an origin-only secure websocket URL.",
  );

  validateStudyRoomJwt(body.participant_token, {
    identity: body.participant_identity,
    issuer,
    nickname: expectedNickname,
    roomKey,
    roomName,
    microphoneAllowed: slot.microphoneAllowed,
  });
  return body;
}

function remoteParticipantIdentities(room) {
  const participants = room?.remoteParticipants;
  const values = typeof participants?.values === "function"
    ? [...participants.values()]
    : Object.values(participants || {});
  return new Set(
    values.map((participant) => participant?.identity).filter(Boolean),
  );
}

function withTimeout(label, promise, timeoutMs = RTC_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function waitForRoomEvent(room, event, label, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off(event, handler);
      reject(new Error(`${label} timed out`));
    }, RTC_TIMEOUT_MS);
    const handler = (...args) => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      room.off(event, handler);
      resolve(args);
    };
    room.on(event, handler);
  });
}

function waitForSubscribedTrack(room, participantIdentity, source, label) {
  return waitForRoomEvent(
    room,
    RoomEvent.TrackSubscribed,
    label,
    (_track, publication, participant) =>
      participant?.identity === participantIdentity &&
      publication?.source === source,
  ).then(([track, publication, participant]) => ({
    participant,
    publication,
    track,
  }));
}

async function sendAndProveRoomMessage(sendingRoom, receivingRoom, senderIdentity) {
  const topic = "duediligence.study-room.chat.v1";
  const text = "Staging study partner check";
  const received = withTimeout(
    "room chat delivery",
    new Promise((resolve, reject) => {
      try {
        receivingRoom.registerTextStreamHandler(topic, async (reader, participant) => {
          try {
            assert.equal(participant?.identity, senderIdentity);
            resolve(await reader.readAll());
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    }),
  );
  const info = await sendingRoom.localParticipant.sendText(text, { topic });
  assert.equal(info.topic, topic);
  assert.ok(info.streamId);
  assert.equal(await received, text);
}

function syntheticAudioFrame(sequence) {
  const sampleRate = 48_000;
  const samplesPerChannel = 480;
  const frame = AudioFrame.create(sampleRate, 1, samplesPerChannel);
  const phaseOffset = sequence * samplesPerChannel;
  for (let index = 0; index < samplesPerChannel; index += 1) {
    frame.data[index] = Math.round(
      8_000 *
        Math.sin((2 * Math.PI * 880 * (phaseOffset + index)) / sampleRate),
    );
  }
  return frame;
}

function syntheticVideoFrame(sequence, width = 320, height = 180) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gold =
        (Math.floor(x / 20) + Math.floor(y / 20) + sequence) % 2 === 0;
      pixels[offset] = gold ? 213 : 4;
      pixels[offset + 1] = gold ? 166 : 25;
      pixels[offset + 2] = gold ? 45 : 50;
      pixels[offset + 3] = 255;
    }
  }
  return new VideoFrame(pixels, width, height, VideoBufferType.RGBA);
}

async function waitForAudibleFrame(reader) {
  return withTimeout(
    "synthetic microphone frame delivery",
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        assert.equal(
          done,
          false,
          "The subscribed microphone stream ended before a frame arrived.",
        );
        if (value?.data?.some((sample) => Math.abs(sample) >= 200))
          return value;
      }
    })(),
  );
}

async function publishAndProveSyntheticMedia(
  publisherRoom,
  subscriberRoom,
  publisherIdentity,
  resources,
) {
  const microphoneSubscribed = waitForSubscribedTrack(
    subscriberRoom,
    publisherIdentity,
    TrackSource.SOURCE_MICROPHONE,
    "microphone subscription",
  );
  const cameraSubscribed = waitForSubscribedTrack(
    subscriberRoom,
    publisherIdentity,
    TrackSource.SOURCE_CAMERA,
    "camera subscription",
  );

  const audioSource = new AudioSource(48_000, 1);
  const audioTrack = LocalAudioTrack.createAudioTrack(
    "synthetic-microphone",
    audioSource,
  );
  const videoSource = new VideoSource(320, 180);
  const videoTrack = LocalVideoTrack.createVideoTrack(
    "synthetic-camera",
    videoSource,
  );
  resources.tracks.add(audioTrack);
  resources.tracks.add(videoTrack);

  const audioOptions = new TrackPublishOptions();
  audioOptions.source = TrackSource.SOURCE_MICROPHONE;
  const videoOptions = new TrackPublishOptions();
  videoOptions.source = TrackSource.SOURCE_CAMERA;

  const audioPublication = await withTimeout(
    "microphone publication",
    publisherRoom.localParticipant.publishTrack(audioTrack, audioOptions),
  );
  const videoPublication = await withTimeout(
    "camera publication",
    publisherRoom.localParticipant.publishTrack(videoTrack, videoOptions),
  );
  assert.match(String(audioPublication.sid || ""), TRACK_SID_PATTERN);
  assert.match(String(videoPublication.sid || ""), TRACK_SID_PATTERN);

  const [remoteAudio, remoteVideo] = await Promise.all([
    microphoneSubscribed,
    cameraSubscribed,
    withTimeout(
      "microphone first subscription",
      audioPublication.waitForSubscription(),
    ),
    withTimeout(
      "camera first subscription",
      videoPublication.waitForSubscription(),
    ),
  ]);
  assert.equal(remoteAudio.publication.kind, TrackKind.KIND_AUDIO);
  assert.equal(remoteVideo.publication.kind, TrackKind.KIND_VIDEO);
  assert.equal(remoteAudio.publication.sid, audioPublication.sid);
  assert.equal(remoteVideo.publication.sid, videoPublication.sid);

  const audioReader = new AudioStream(remoteAudio.track, {
    sampleRate: 48_000,
    numChannels: 1,
    frameSizeMs: 10,
  }).getReader();
  const videoReader = new VideoStream(remoteVideo.track).getReader();
  resources.readers.add(audioReader);
  resources.readers.add(videoReader);

  const audibleFrame = waitForAudibleFrame(audioReader);
  const visibleFrame = withTimeout(
    "synthetic camera frame delivery",
    videoReader.read(),
  );
  const audioProducer = (async () => {
    for (let sequence = 0; sequence < 180; sequence += 1) {
      await audioSource.captureFrame(syntheticAudioFrame(sequence));
    }
  })();
  const videoProducer = (async () => {
    for (let sequence = 0; sequence < 60; sequence += 1) {
      videoSource.captureFrame(syntheticVideoFrame(sequence));
      await new Promise((resolve) => setTimeout(resolve, 34));
    }
  })();

  const [audioFrame, videoEvent] = await Promise.all([
    audibleFrame,
    visibleFrame,
  ]);
  assert.equal(audioFrame.sampleRate, 48_000);
  assert.equal(audioFrame.channels, 1);
  assert.ok(audioFrame.samplesPerChannel > 0);
  assert.equal(videoEvent.done, false);
  assert.equal(videoEvent.value?.frame?.width, 320);
  assert.equal(videoEvent.value?.frame?.height, 180);
  assert.ok(videoEvent.value?.frame?.data?.length > 0);
  await Promise.all([audioProducer, videoProducer]);

  return { audioPublication, videoPublication };
}

async function publishAndProveScreenShare(
  publisherRoom,
  subscriberRoom,
  publisherIdentity,
  resources,
) {
  const subscribed = waitForSubscribedTrack(
    subscriberRoom,
    publisherIdentity,
    TrackSource.SOURCE_SCREENSHARE,
    "screen-share subscription",
  );
  const source = new VideoSource(640, 360);
  const track = LocalVideoTrack.createVideoTrack("synthetic-screen-share", source);
  resources.tracks.add(track);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_SCREENSHARE;
  const localPublication = await withTimeout(
    "screen-share publication",
    publisherRoom.localParticipant.publishTrack(track, options),
  );
  const remote = await subscribed;
  assert.equal(remote.publication.sid, localPublication.sid);
  assert.equal(remote.publication.kind, TrackKind.KIND_VIDEO);
  const reader = new VideoStream(remote.track).getReader();
  resources.readers.add(reader);
  const visible = withTimeout("screen-share frame delivery", reader.read());
  source.captureFrame(syntheticVideoFrame(1, 640, 360));
  const event = await visible;
  assert.equal(event.done, false);
  assert.equal(event.value?.frame?.width, 640);
  assert.equal(event.value?.frame?.height, 360);
}

async function publishAndProveReconnectAudio(
  publisherRoom,
  subscriberRoom,
  publisherIdentity,
  resources,
) {
  const subscribed = waitForSubscribedTrack(
    subscriberRoom,
    publisherIdentity,
    TrackSource.SOURCE_MICROPHONE,
    "reconnected microphone subscription",
  );
  const source = new AudioSource(48_000, 1);
  const track = LocalAudioTrack.createAudioTrack(
    "synthetic-reconnect-microphone",
    source,
  );
  resources.tracks.add(track);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  const localPublication = await withTimeout(
    "reconnected microphone publication",
    publisherRoom.localParticipant.publishTrack(track, options),
  );
  const remote = await subscribed;
  assert.equal(remote.publication.sid, localPublication.sid);
  assert.equal(remote.publication.muted, false);
  const reader = new AudioStream(remote.track, {
    sampleRate: 48_000,
    numChannels: 1,
    frameSizeMs: 10,
  }).getReader();
  resources.readers.add(reader);
  const audibleFrame = waitForAudibleFrame(reader);
  for (let sequence = 0; sequence < 120; sequence += 1) {
    await source.captureFrame(syntheticAudioFrame(sequence));
  }
  const frame = await audibleFrame;
  assert.ok(frame.samplesPerChannel > 0);
}

async function safeReleaseRtcResources(resources) {
  const errors = [];
  for (const reader of resources.readers) {
    await reader.cancel().catch((error) => errors.push(error));
  }
  for (const room of [...resources.rooms].reverse()) {
    if (room.isConnected)
      await room.disconnect().catch((error) => errors.push(error));
  }
  for (const track of [...resources.tracks].reverse()) {
    await track.close().catch((error) => errors.push(error));
  }
  await dispose().catch((error) => errors.push(error));
  return errors;
}

function isSyntheticStudyRoomUser(user) {
  const email = String(user?.email || "").toLowerCase();
  const fullName = String(
    user?.user_metadata?.full_name || user?.raw_user_meta_data?.full_name || "",
  );
  return /^dd-study-room-(?:student|primary-admin|secondary-admin|founder-admin)-[a-z0-9-]+@example\.com$/u.test(
    email,
  ) && /^Synthetic Study Room (?:student|primary-admin|secondary-admin|founder-admin)$/u.test(
    fullName,
  );
}

async function listStaleSyntheticAdministrators(configuration) {
  // The hosted Supabase Auth collection endpoint can currently return a
  // platform-side 500. Enumerate only administrator IDs from the staging
  // authorization table, then use the existing audited administrator
  // directory to re-check both the synthetic email namespace and the exact
  // synthetic profile marker before deletion.
  const candidateLimit = 200;
  const candidateUrl = new URL(
    `${configuration.supabaseUrl}/rest/v1/user_roles`,
  );
  candidateUrl.searchParams.set(
    "role",
    "in.(admin,founder_admin,super_admin)",
  );
  candidateUrl.searchParams.set("select", "user_id,role");
  candidateUrl.searchParams.set("limit", String(candidateLimit));
  const { body: rows } = await requestJson(candidateUrl, {
    headers: serviceHeaders(configuration),
  });
  assert.ok(
    Array.isArray(rows) && rows.length < candidateLimit,
    "The staging administrator candidate set exceeded its reviewed cleanup boundary.",
  );
  const rolePriority = Object.freeze({ super_admin: 0, founder_admin: 1, admin: 2 });
  const candidates = rows
    .map((row) => ({
      id: String(row?.user_id || ""),
      role: String(row?.role || ""),
    }))
    .filter(
      (candidate) =>
        UUID_PATTERN.test(candidate.id) &&
        Object.hasOwn(rolePriority, candidate.role),
    )
    .sort((left, right) => rolePriority[left.role] - rolePriority[right.role]);
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  let directoryItems = null;
  for (const candidate of candidates) {
    try {
      const { body } = await requestJson(
        `${configuration.supabaseUrl}/rest/v1/rpc/admin_user_directory`,
        {
          method: "POST",
          headers: serviceHeaders(configuration, true),
          body: JSON.stringify({
            p_actor_user_id: candidate.id,
            p_search: "dd-study-room-",
            p_limit: 100,
            p_offset: 0,
            p_request_key: `study-room-cleanup-${randomBytes(12).toString("hex")}`,
            p_access_purpose: "dashboard",
          }),
        },
      );
      if (Array.isArray(body?.items)) {
        directoryItems = body.items;
        break;
      }
    } catch (error) {
      if (![400, 401, 403].includes(Number(error?.remoteStatus || 0))) {
        throw error;
      }
    }
  }
  assert.ok(
    Array.isArray(directoryItems),
    "No authorized staging administrator could verify stale synthetic users.",
  );
  return directoryItems
    .filter((entry) => candidateIds.has(String(entry?.id || "")))
    .filter((entry) =>
      isSyntheticStudyRoomUser({
        email: entry?.email,
        user_metadata: { full_name: entry?.display_name },
      }),
    )
    .map((entry) => ({ id: String(entry.id), token: null }));
}

async function deleteSyntheticUsers(configuration, createdUsers) {
  const errors = [];
  const filter = createdUsers
    .map((user) => encodeURIComponent(user.id))
    .join(",");
  if (filter) {
    // Remove the exact synthetic authorization rows first. Some of them retain
    // the synthetic administrator as their actor, so deleting auth users first
    // can create a foreign-key cycle after a partially completed smoke run.
    for (const table of ["free_beta_access", "user_roles"]) {
      await requestJson(
        `${configuration.supabaseUrl}/rest/v1/${table}?user_id=in.(${filter})`,
        {
          method: "DELETE",
          headers: {
            ...serviceHeaders(configuration),
            Prefer: "return=minimal",
          },
        },
        [200, 204],
      ).catch((error) => errors.push(error));
    }
  }
  for (const user of [...createdUsers].reverse()) {
    if (user.token) {
      await requestJson(
        `${configuration.supabaseUrl}/auth/v1/logout?scope=global`,
        {
          method: "POST",
          headers: {
            apikey: configuration.publishableKey,
            Authorization: `Bearer ${user.token}`,
          },
        },
        [204],
      ).catch((error) => errors.push(error));
    }
    await requestSupabaseAdminJson(
      configuration,
      `/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        headers: serviceHeaders(configuration),
      },
      [200, 204],
    ).catch((error) => errors.push(error));
  }
  if (createdUsers.length) {
    for (const table of ["user_roles", "free_beta_access"]) {
      const { body } = await requestJson(
        `${configuration.supabaseUrl}/rest/v1/${table}?user_id=in.(${filter})&select=user_id`,
        { headers: serviceHeaders(configuration) },
      ).catch((error) => {
        errors.push(error);
        return { body: null };
      });
      if (body !== null && (!Array.isArray(body) || body.length !== 0)) {
        errors.push(
          new Error(`Synthetic Supabase ${table} rows remained after user deletion.`),
        );
      }
    }
  }
  return errors;
}

async function runPositiveSmoke() {
  const configuration = runtimeConfiguration();
  const runId = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const createdUsers = [];
  const resources = { readers: new Set(), rooms: new Set(), tracks: new Set() };
  let failure = null;
  let failureCheckpoint = "";
  let cleanupErrors = [];

  try {
    checkpoint = "stale_synthetic_cleanup";
    const staleUsers = await listStaleSyntheticAdministrators(configuration);
    const staleCleanupErrors = await deleteSyntheticUsers(
      configuration,
      staleUsers,
    );
    if (staleCleanupErrors.length) {
      throw new AggregateError(
        staleCleanupErrors,
        "A stale synthetic Study Room user could not be removed safely.",
      );
    }
    console.log(
      `STUDY_ROOM_STAGING_POSITIVE: stale_synthetic_cleanup=${staleUsers.length}`,
    );

    checkpoint = "synthetic_user_provisioning";
    const student = await createSyntheticUser(
      configuration,
      "student",
      runId,
      createdUsers,
    );
    const primaryAdmin = await createSyntheticUser(
      configuration,
      "primary-admin",
      runId,
      createdUsers,
    );
    const secondaryAdmin = await createSyntheticUser(
      configuration,
      "secondary-admin",
      runId,
      createdUsers,
    );
    const founderAdmin = await createSyntheticUser(
      configuration,
      "founder-admin",
      runId,
      createdUsers,
    );
    await assignSyntheticRole(configuration, student.id, "student", null);
    await assignSyntheticRole(
      configuration,
      primaryAdmin.id,
      "super_admin",
      null,
    );
    await assignSyntheticRole(
      configuration,
      secondaryAdmin.id,
      "admin",
      primaryAdmin.id,
    );
    await assignSyntheticRole(
      configuration,
      founderAdmin.id,
      "founder_admin",
      primaryAdmin.id,
    );

    checkpoint = "non_admin_boundary";
    const denied = await workerPost(
      configuration,
      "/admin/study-room/access",
      student.token,
      {},
      [403],
    );
    assert.equal(denied.body?.ok, false);
    assert.ok(
      ["ADMIN_FORBIDDEN", "STUDY_ROOM_ADMIN_REQUIRED"].includes(
        denied.body?.error?.code,
      ),
      "The non-admin request did not return an explicit administrator boundary.",
    );
    const deniedRooms = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      student.token,
      { operation: "list" },
      [403],
    );
    assert.equal(deniedRooms.body?.ok, false);
    assert.ok(
      ["ADMIN_FORBIDDEN", "STUDY_ROOM_ADMIN_REQUIRED"].includes(
        deniedRooms.body?.error?.code,
      ),
      "The room catalog did not preserve the administrator boundary.",
    );
    console.log("STUDY_ROOM_STAGING_POSITIVE: non_admin_denied=true");

    checkpoint = "subscriber_access";
    await acceptSyntheticCurrentTerms(configuration, student);
    await grantSyntheticFoundingAccess(configuration, primaryAdmin.id, student);
    const memberAccess = await workerPost(
      configuration,
      "/study-room/access",
      student.token,
      {},
    );
    validateAccessResponse(memberAccess.body, "member", false);
    const memberInitialCatalog = await workerPost(
      configuration,
      "/study-room/rooms",
      student.token,
      { operation: "list" },
    );
    validateRoomCatalog(memberInitialCatalog.body, "member", null, false);
    const memberCreateDenied = await workerPost(
      configuration,
      "/study-room/rooms",
      student.token,
      { operation: "create", roomKey: "2" },
      [403],
    );
    assert.equal(memberCreateDenied.body?.error?.code, "STUDY_ROOM_ADMIN_REQUIRED");
    console.log("STUDY_ROOM_STAGING_POSITIVE: subscriber_access=true subscriber_create_denied=true");

    checkpoint = "admin_access";
    const primaryAccess = await workerPost(
      configuration,
      "/admin/study-room/access",
      primaryAdmin.token,
      {},
    );
    const secondaryAccess = await workerPost(
      configuration,
      "/admin/study-room/access",
      secondaryAdmin.token,
      {},
    );
    const founderAccess = await workerPost(
      configuration,
      "/admin/study-room/access",
      founderAdmin.token,
      {},
    );
    validateAccessResponse(primaryAccess.body, "super_admin");
    validateAccessResponse(secondaryAccess.body, "admin");
    validateAccessResponse(founderAccess.body, "founder_admin");
    console.log(
      "STUDY_ROOM_STAGING_POSITIVE: authenticated_admin_access=true founder_admin_access=true",
    );

    checkpoint = "five_room_catalog_and_creation";
    const initialCatalog = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      primaryAdmin.token,
      { operation: "list" },
    );
    validateRoomCatalog(initialCatalog.body, "super_admin");

    for (let index = 0; index < STUDY_ROOM_MAX_ROOMS; index += 1) {
      const roomKey = String(index + 1);
      const created = await workerPost(
        configuration,
        "/admin/study-room/rooms",
        primaryAdmin.token,
        { operation: "create", roomKey },
        [200, 201],
      );
      validateCreatedRoom(created.body, roomKey, created.response.status);
    }

    const fullCatalog = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      secondaryAdmin.token,
      { operation: "list" },
    );
    validateRoomCatalog(fullCatalog.body, "admin", ["1", "2", "3", "4", "5"]);

    const sixthRoom = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      primaryAdmin.token,
      { operation: "create" },
      [409],
    );
    validateRejectedRoomOperation(
      sixthRoom.body,
      "STUDY_ROOM_ROOM_LIMIT_REACHED",
    );
    const invalidRoom = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      primaryAdmin.token,
      { operation: "create", roomKey: "6" },
      [400],
    );
    validateRejectedRoomOperation(
      invalidRoom.body,
      "STUDY_ROOM_ROOM_INVALID",
    );
    const rawRoomName = await workerPost(
      configuration,
      "/admin/study-room/rooms",
      primaryAdmin.token,
      { operation: "create", roomKey: APPROVED_STAGING_ROOM },
      [400],
    );
    validateRejectedRoomOperation(
      rawRoomName.body,
      "STUDY_ROOM_ROOM_INVALID",
    );
    console.log(
      "STUDY_ROOM_STAGING_POSITIVE: five_room_limit=true raw_room_names_rejected=true",
    );

    checkpoint = "member_admin_join_and_jwt";
    const memberNickname = "Participant #404";
    const primaryNickname = "Participant #101";
    const secondaryNickname = "Participant #202";
    const founderNickname = "Participant #303";
    const memberLibraryJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          student.token,
          { roomKey: "1", nickname: memberNickname },
          [201],
        )
      ).body,
      memberNickname,
      configuration.liveKitApiKey,
      "1",
    );
    assert.equal(memberLibraryJoin.microphone_allowed, false);
    const memberInnerDenied = await workerPost(
      configuration,
      "/study-room/join",
      student.token,
      { roomKey: "5", nickname: memberNickname },
      [403],
    );
    assert.equal(memberInnerDenied.body?.error?.code, "STUDY_ROOM_ADMIN_ROOM_REQUIRED");
    const primaryJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          primaryAdmin.token,
          { roomKey: "2", nickname: primaryNickname },
          [201],
        )
      ).body,
      primaryNickname,
      configuration.liveKitApiKey,
      "2",
    );
    const secondaryJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          secondaryAdmin.token,
          { roomKey: "2", nickname: secondaryNickname },
          [201],
        )
      ).body,
      secondaryNickname,
      configuration.liveKitApiKey,
      "2",
    );
    const founderJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          founderAdmin.token,
          { roomKey: "3", nickname: founderNickname },
          [201],
        )
      ).body,
      founderNickname,
      configuration.liveKitApiKey,
      "3",
    );
    const innerJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          founderAdmin.token,
          { roomKey: "5", nickname: founderNickname },
          [201],
        )
      ).body,
      founderNickname,
      configuration.liveKitApiKey,
      "5",
    );
    assert.equal(innerJoin.administrator, true);
    assert.notEqual(
      primaryJoin.participant_identity,
      secondaryJoin.participant_identity,
    );
    assert.equal(primaryJoin.server_url, secondaryJoin.server_url);
    assert.equal(primaryJoin.server_url, founderJoin.server_url);
    assert.equal(primaryJoin.focus_started_at, secondaryJoin.focus_started_at);
    assert.notEqual(primaryJoin.room_name, founderJoin.room_name);
    console.log("STUDY_ROOM_STAGING_POSITIVE: jwt_claims=true library_silent=true inner_chamber_admin_only=true");

    checkpoint = "livekit_connect";
    const primaryRoom = new Room();
    const secondaryRoom = new Room();
    const isolatedRoom = new Room();
    resources.rooms.add(primaryRoom);
    resources.rooms.add(secondaryRoom);
    resources.rooms.add(isolatedRoom);
    const seesSecondary = waitForRoomEvent(
      primaryRoom,
      RoomEvent.ParticipantConnected,
      "second participant connection",
      (participant) =>
        participant?.identity === secondaryJoin.participant_identity,
    );
    await withTimeout(
      "primary LiveKit connection",
      primaryRoom.connect(
        primaryJoin.server_url,
        primaryJoin.participant_token,
        {
          autoSubscribe: true,
          dynacast: true,
        },
      ),
    );
    await withTimeout(
      "secondary LiveKit connection",
      secondaryRoom.connect(
        secondaryJoin.server_url,
        secondaryJoin.participant_token,
        {
          autoSubscribe: true,
          dynacast: true,
        },
      ),
    );
    await seesSecondary;
    await withTimeout(
      "isolated LiveKit connection",
      isolatedRoom.connect(
        founderJoin.server_url,
        founderJoin.participant_token,
        {
          autoSubscribe: true,
          dynacast: true,
        },
      ),
    );
    assert.equal(
      primaryRoom.localParticipant?.identity,
      primaryJoin.participant_identity,
    );
    assert.equal(
      secondaryRoom.localParticipant?.identity,
      secondaryJoin.participant_identity,
    );
    assert.equal(
      isolatedRoom.localParticipant?.identity,
      founderJoin.participant_identity,
    );
    assert.equal(primaryRoom.name, approvedRoomName("2"));
    assert.equal(secondaryRoom.name, approvedRoomName("2"));
    assert.equal(isolatedRoom.name, approvedRoomName("3"));
    assert.equal(
      remoteParticipantIdentities(primaryRoom).has(
        founderJoin.participant_identity,
      ),
      false,
      "A participant in Room 2 leaked into Room 1.",
    );
    assert.equal(
      remoteParticipantIdentities(isolatedRoom).has(
        primaryJoin.participant_identity,
      ),
      false,
      "A participant in Room 1 leaked into Room 2.",
    );
    assert.equal(
      remoteParticipantIdentities(isolatedRoom).has(
        secondaryJoin.participant_identity,
      ),
      false,
      "A second participant in Room 1 leaked into Room 2.",
    );
    const connectedRooms = await waitForRoomParticipantCounts(
      configuration,
      founderAdmin.token,
      "founder_admin",
      { 2: 2, 3: 1 },
    );
    assert.ok(connectedRooms[1].participantCount >= 2);
    assert.ok(connectedRooms[2].participantCount >= 1);
    console.log("STUDY_ROOM_STAGING_POSITIVE: livekit_participants=2");
    console.log("STUDY_ROOM_STAGING_POSITIVE: room_isolation=true");

    checkpoint = "room_chat";
    await sendAndProveRoomMessage(
      secondaryRoom,
      primaryRoom,
      secondaryJoin.participant_identity,
    );
    console.log("STUDY_ROOM_STAGING_POSITIVE: room_chat=true");

    checkpoint = "raise_hand_attributes";
    const handRaised = waitForRoomEvent(
      primaryRoom,
      RoomEvent.ParticipantAttributesChanged,
      "raise-hand attribute propagation",
      (changedAttributes, participant) =>
        participant?.identity === secondaryJoin.participant_identity &&
        changedAttributes?.["dd.studyRoom.handRaised"] === "true",
    );
    await secondaryRoom.localParticipant.setAttributes({
      "dd.studyRoom.handRaised": "true",
    });
    await handRaised;
    console.log("STUDY_ROOM_STAGING_POSITIVE: raise_hand=true");

    checkpoint = "synthetic_media_subscription";
    const publications = await publishAndProveSyntheticMedia(
      secondaryRoom,
      primaryRoom,
      secondaryJoin.participant_identity,
      resources,
    );
    await publishAndProveSyntheticMedia(
      primaryRoom,
      secondaryRoom,
      primaryJoin.participant_identity,
      resources,
    );
    console.log(
      "STUDY_ROOM_STAGING_POSITIVE: bidirectional_microphone=true bidirectional_camera=true",
    );

    checkpoint = "screen_share";
    await publishAndProveScreenShare(
      primaryRoom,
      secondaryRoom,
      primaryJoin.participant_identity,
      resources,
    );
    console.log("STUDY_ROOM_STAGING_POSITIVE: screen_share=true");

    checkpoint = "server_side_mute";
    const muted = waitForRoomEvent(
      primaryRoom,
      RoomEvent.TrackMuted,
      "server-side microphone mute",
      (publication, participant) =>
        participant?.identity === secondaryJoin.participant_identity &&
        publication?.sid === publications.audioPublication.sid,
    );
    const moderation = await workerPost(
      configuration,
      "/study-room/moderate",
      primaryAdmin.token,
      {
        operation: "mute",
        roomKey: "2",
        participantIdentity: secondaryJoin.participant_identity,
        trackSid: publications.audioPublication.sid,
      },
    );
    assert.equal(moderation.body?.ok, true);
    assert.equal(moderation.body?.result?.action, "muted");
    assert.equal(moderation.body?.result?.roomKey, "2");
    assert.equal(
      moderation.body?.result?.participantIdentity,
      secondaryJoin.participant_identity,
    );
    assert.equal(
      moderation.body?.result?.trackSid,
      publications.audioPublication.sid,
    );
    const [mutedPublication] = await muted;
    assert.equal(mutedPublication.muted, true);
    console.log("STUDY_ROOM_STAGING_POSITIVE: server_side_mute=true");

    checkpoint = "livekit_reconnect";
    const disconnected = waitForRoomEvent(
      primaryRoom,
      RoomEvent.ParticipantDisconnected,
      "second participant disconnection",
      (participant) =>
        participant?.identity === secondaryJoin.participant_identity,
    );
    await secondaryRoom.disconnect();
    await disconnected;

    const reconnectJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/study-room/join",
          secondaryAdmin.token,
          { roomKey: "2", nickname: secondaryNickname },
          [201],
        )
      ).body,
      secondaryNickname,
      configuration.liveKitApiKey,
      "2",
    );
    assert.equal(
      reconnectJoin.participant_identity,
      secondaryJoin.participant_identity,
      "A reconnect must preserve the account-bound opaque identity.",
    );
    const reconnectedRoom = new Room();
    resources.rooms.add(reconnectedRoom);
    const reconnected = waitForRoomEvent(
      primaryRoom,
      RoomEvent.ParticipantConnected,
      "second participant reconnection",
      (participant) =>
        participant?.identity === reconnectJoin.participant_identity,
    );
    await withTimeout(
      "secondary LiveKit reconnection",
      reconnectedRoom.connect(
        reconnectJoin.server_url,
        reconnectJoin.participant_token,
        {
          autoSubscribe: true,
          dynacast: true,
        },
      ),
    );
    await reconnected;
    await publishAndProveReconnectAudio(
      reconnectedRoom,
      primaryRoom,
      reconnectJoin.participant_identity,
      resources,
    );
    console.log("STUDY_ROOM_STAGING_POSITIVE: reconnect=true");
  } catch (error) {
    failure = error;
    failureCheckpoint = checkpoint;
  } finally {
    checkpoint = "rtc_cleanup";
    // The public Worker deliberately has no room-deletion operation. Releasing
    // every synthetic RTC participant is the supported cleanup boundary; the
    // five fixed empty rooms then expire under their reviewed LiveKit timeout.
    cleanupErrors.push(...(await safeReleaseRtcResources(resources)));
    checkpoint = "synthetic_user_cleanup";
    cleanupErrors.push(
      ...(await deleteSyntheticUsers(configuration, createdUsers)),
    );
  }

  if (cleanupErrors.length) {
    checkpoint = failure
      ? `${failureCheckpoint || "unknown"}_and_cleanup`
      : "synthetic_user_cleanup";
    console.error(
      `STUDY_ROOM_STAGING_POSITIVE: synthetic_cleanup=false run_id=${runId}`,
    );
    const aggregate = new AggregateError(
      failure ? [failure, ...cleanupErrors] : cleanupErrors,
      "The Study Room staging smoke did not complete exact cleanup.",
    );
    const diagnosticError = failure || cleanupErrors[0];
    aggregate.remoteStatus = diagnosticError?.remoteStatus;
    aggregate.remoteCode = diagnosticError?.remoteCode;
    throw aggregate;
  }
  console.log(
    `STUDY_ROOM_STAGING_POSITIVE: synthetic_cleanup=true run_id=${runId}`,
  );
  console.log(
    "STUDY_ROOM_STAGING_POSITIVE: rtc_released=true fixed_room_expiry=true",
  );
  if (failure) {
    checkpoint = failureCheckpoint || checkpoint;
    throw failure;
  }
  console.log(
    "STUDY_ROOM_STAGING_POSITIVE_PASS secrets_not_logged=true pii_not_logged=true",
  );
}

async function runPreflight() {
  const packageJson = JSON.parse(
    await readFile(`${scriptDirectory}/package.json`, "utf8"),
  );
  assert.equal(
    packageJson.devDependencies?.["@livekit/rtc-node"],
    "0.13.34",
    "The reviewed Node realtime smoke-test SDK version must remain pinned.",
  );
  assert.equal(APPROVED_STAGING_ROOM, "dd-study-room-admin-beta-staging-v1");
  assert.equal(APPROVED_STAGING_ROOMS.length, STUDY_ROOM_MAX_ROOMS);
  assert.deepEqual(APPROVED_STAGING_ROOMS, [
    "dd-study-room-admin-beta-staging-v1",
    "dd-study-room-admin-beta-staging-v1-2",
    "dd-study-room-admin-beta-staging-v1-3",
    "dd-study-room-admin-beta-staging-v1-4",
    "dd-study-room-admin-beta-staging-v1-5",
  ]);
  assert.equal(new Set(APPROVED_STAGING_ROOMS).size, STUDY_ROOM_MAX_ROOMS);
  assert.equal(APPROVED_STAGING_WORKER.includes("-staging."), true);
  assert.equal(
    APPROVED_STAGING_SUPABASE.includes("hlzqmreeoghbldnhlybr"),
    true,
  );
  console.log("Study Room authenticated staging smoke preflight passed.");
}

function createSelfTestToken(claims) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

async function runSelfTest() {
  const now = Math.floor(Date.now() / 1_000);
  const identity = "sr_abcdefghijklmnopqrstuvwx";
  const issuer = "reviewed_api_key";
  const nickname = "Participant #101";
  assert.equal(
    isSyntheticStudyRoomUser({
      email: "dd-study-room-founder-admin-mtfxnwff-136fbe0c@example.com",
      user_metadata: { full_name: "Synthetic Study Room founder-admin" },
    }),
    true,
  );
  assert.equal(
    isSyntheticStudyRoomUser({
      email: "administrator@example.com",
      user_metadata: { full_name: "Synthetic Study Room founder-admin" },
    }),
    false,
  );
  assert.equal(safeRemoteCode({ error_code: "bad_jwt" }), "BAD_JWT");
  assert.equal(
    isRetryableSupabaseAdminFailure({
      remoteStatus: 403,
      remoteCode: "BAD_JWT",
    }),
    true,
  );
  assert.equal(
    isRetryableSupabaseAdminFailure({
      remoteStatus: 403,
      remoteCode: "ADMIN_FORBIDDEN",
    }),
    false,
  );
  const claimsForRoom = (roomKey) => {
    const slot = STUDY_ROOM_SLOTS[Number(approvedRoomKey(roomKey)) - 1];
    return ({
    iss: issuer,
    sub: identity,
    name: nickname,
    nbf: now,
    exp: now + STUDY_ROOM_TOKEN_TTL_SECONDS,
    video: {
      room: approvedRoomName(roomKey),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
      canPublishSources: slot.microphoneAllowed
        ? ["camera", "microphone", "screen_share", "screen_share_audio"]
        : ["camera", "screen_share"],
    },
    });
  };
  const claims = claimsForRoom("1");
  validateStudyRoomJwt(createSelfTestToken(claims), {
    identity,
    issuer,
    nickname,
    roomKey: "1",
    roomName: approvedRoomName("1"),
    microphoneAllowed: false,
  });
  validateStudyRoomJwt(createSelfTestToken(claimsForRoom("5")), {
    identity,
    issuer,
    nickname,
    roomKey: "5",
    roomName: approvedRoomName("5"),
    microphoneAllowed: true,
  });
  assert.throws(
    () =>
      validateStudyRoomJwt(
        createSelfTestToken({
          ...claims,
          video: { ...claims.video, canPublishData: false },
        }),
        {
          identity,
          issuer,
          nickname,
          roomKey: "1",
          roomName: approvedRoomName("1"),
          microphoneAllowed: false,
        },
      ),
    /Room chat/u,
  );
  assert.throws(
    () =>
      validateStudyRoomJwt(
        createSelfTestToken({
          ...claims,
          video: { ...claims.video, roomAdmin: true },
        }),
        {
          identity,
          issuer,
          nickname,
          roomKey: "1",
          roomName: approvedRoomName("1"),
          microphoneAllowed: false,
        },
      ),
    /room-administrator/u,
  );

  const roomDescriptors = Array.from(
    { length: STUDY_ROOM_MAX_ROOMS },
    (_unused, index) => ({
      roomKey: STUDY_ROOM_SLOTS[index].roomKey,
      label: STUDY_ROOM_SLOTS[index].label,
      kind: STUDY_ROOM_SLOTS[index].kind,
      microphoneAllowed: STUDY_ROOM_SLOTS[index].microphoneAllowed,
      adminOnly: STUDY_ROOM_SLOTS[index].adminOnly,
      canCreate: true,
      canJoin: true,
      active: true,
      participantCount: index === 0 ? 2 : 0,
      capacity: STUDY_ROOM_MAX_PARTICIPANTS,
      focusStartedAt: new Date(now * 1_000).toISOString(),
    }),
  );
  validateRoomCatalog(
    {
      ok: true,
      allowed: true,
      role: "admin",
      administrator: true,
      canCreateRooms: true,
      maxRooms: STUDY_ROOM_MAX_ROOMS,
      maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
      recording: false,
      rooms: roomDescriptors,
    },
    "admin",
    ["1", "2", "3", "4", "5"],
  );
  validateCreatedRoom(
    { ok: true, created: true, room: roomDescriptors[0] },
    "1",
    201,
  );
  validateRejectedRoomOperation(
    {
      ok: false,
      error: { code: "STUDY_ROOM_ROOM_INVALID" },
    },
    "STUDY_ROOM_ROOM_INVALID",
  );

  assert.equal(TrackSource.SOURCE_CAMERA, 1);
  assert.equal(TrackSource.SOURCE_MICROPHONE, 2);
  assert.equal(TrackSource.SOURCE_SCREENSHARE, 3);
  assert.equal(TrackKind.KIND_AUDIO, 1);
  assert.equal(TrackKind.KIND_VIDEO, 2);
  assert.equal(typeof AudioStream, "function");
  assert.equal(typeof VideoStream, "function");

  const audioFrame = AudioFrame.create(48_000, 1, 480);
  assert.equal(audioFrame.data.length, 480);
  assert.equal(audioFrame.sampleRate, 48_000);
  const videoFrame = syntheticVideoFrame(0, 32, 18);
  assert.equal(videoFrame.data.length, 32 * 18 * 4);
  assert.equal(videoFrame.type, VideoBufferType.RGBA);

  const audioSource = new AudioSource(48_000, 1);
  const videoSource = new VideoSource(32, 18);
  const audioTrack = LocalAudioTrack.createAudioTrack(
    "self-test-audio",
    audioSource,
  );
  const videoTrack = LocalVideoTrack.createVideoTrack(
    "self-test-video",
    videoSource,
  );
  assert.equal(audioTrack.kind, TrackKind.KIND_AUDIO);
  assert.equal(videoTrack.kind, TrackKind.KIND_VIDEO);
  await audioTrack.close();
  await videoTrack.close();
  await dispose();
  console.log("Study Room authenticated staging smoke self-test passed.");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].toLowerCase();

if (invokedDirectly) {
  try {
    if (process.argv.includes("--preflight")) {
      await runPreflight();
    } else if (process.argv.includes("--self-test")) {
      await runSelfTest();
    } else {
      await runPositiveSmoke();
    }
  } catch (error) {
    const errorKind = String(error?.name || "Error")
      .replace(/[^A-Za-z0-9_-]/gu, "")
      .slice(0, 40);
    const remoteStatus = Number.isSafeInteger(error?.remoteStatus)
      ? String(error.remoteStatus)
      : "none";
    const remoteCode = /^[A-Z0-9_]{2,80}$/u.test(
      String(error?.remoteCode || ""),
    )
      ? String(error.remoteCode)
      : "none";
    console.error(
      `STUDY_ROOM_STAGING_POSITIVE: FAIL checkpoint=${checkpoint} kind=${errorKind || "Error"} status=${remoteStatus} code=${remoteCode}`,
    );
    process.exitCode = 1;
  }
}
