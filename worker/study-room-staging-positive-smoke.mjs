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
const STUDY_ROOM_MAX_PARTICIPANTS = 12;
const STUDY_ROOM_TOKEN_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 45_000;
const RTC_TIMEOUT_MS = 30_000;
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
    APPROVED_STAGING_ROOM,
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
  assert.equal(
    video.canPublishData,
    false,
    "The token canPublishData grant must remain disabled.",
  );
  assert.deepEqual(
    [...(video.canPublishSources || [])].sort(),
    ["camera", "microphone"],
    "The Study Room token may publish only camera and microphone tracks.",
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
  assert.notEqual(
    video.canUpdateOwnMetadata,
    true,
    "Participant tokens must not contain metadata-update grants.",
  );

  const roomConfig = assertPlainObject(
    claims.roomConfig,
    "The Study Room token is missing its constrained room configuration.",
  );
  assert.equal(roomConfig.name, APPROVED_STAGING_ROOM);
  assert.equal(roomConfig.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(roomConfig.emptyTimeout, 600);
  assert.equal(roomConfig.departureTimeout, 120);
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
    body?.error?.code || body?.code || "REMOTE_CONTRACT_ERROR",
  );
  return /^[A-Z0-9_]{2,80}$/u.test(value) ? value : "REMOTE_CONTRACT_ERROR";
}

async function requestJson(url, options = {}, expectedStatuses = [200]) {
  const response = await fetch(url, {
    redirect: "error",
    ...options,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${options.method || "GET"} ${new URL(url).pathname} returned ${response.status} ${safeRemoteCode(body)}`,
    );
  }
  return { body, response };
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
  const { body: createdBody } = await requestJson(
    `${configuration.supabaseUrl}/auth/v1/admin/users`,
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

function validateAccessResponse(body, expectedRole) {
  assert.equal(body?.ok, true);
  assert.equal(body?.allowed, true);
  assert.equal(body?.role, expectedRole);
  assert.equal(body?.roomName, APPROVED_STAGING_ROOM);
  assert.equal(body?.maxParticipants, STUDY_ROOM_MAX_PARTICIPANTS);
  assert.equal(body?.recording, false);
}

function validateJoinResponse(body, expectedNickname, issuer) {
  assert.equal(body?.ok, true);
  assert.equal(body?.room_name, APPROVED_STAGING_ROOM);
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
  });
  return body;
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

async function deleteSyntheticUsers(configuration, createdUsers) {
  const errors = [];
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
    await requestJson(
      `${configuration.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        headers: serviceHeaders(configuration),
      },
      [200, 204],
    ).catch((error) => errors.push(error));
  }
  if (!errors.length && createdUsers.length) {
    const filter = createdUsers
      .map((user) => encodeURIComponent(user.id))
      .join(",");
    const { body } = await requestJson(
      `${configuration.supabaseUrl}/rest/v1/user_roles?user_id=in.(${filter})&select=user_id`,
      { headers: serviceHeaders(configuration) },
    ).catch((error) => {
      errors.push(error);
      return { body: null };
    });
    if (body !== null && (!Array.isArray(body) || body.length !== 0)) {
      errors.push(
        new Error("Synthetic Supabase role rows remained after user deletion."),
      );
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
  let cleanupErrors = [];

  try {
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
    console.log("STUDY_ROOM_STAGING_POSITIVE: non_admin_denied=true");

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
    validateAccessResponse(primaryAccess.body, "super_admin");
    validateAccessResponse(secondaryAccess.body, "admin");
    console.log("STUDY_ROOM_STAGING_POSITIVE: authenticated_admin_access=true");

    checkpoint = "admin_join_and_jwt";
    const primaryNickname = "Participant 101";
    const secondaryNickname = "Participant 202";
    const primaryJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/admin/study-room/join",
          primaryAdmin.token,
          { nickname: primaryNickname },
          [201],
        )
      ).body,
      primaryNickname,
      configuration.liveKitApiKey,
    );
    const secondaryJoin = validateJoinResponse(
      (
        await workerPost(
          configuration,
          "/admin/study-room/join",
          secondaryAdmin.token,
          { nickname: secondaryNickname },
          [201],
        )
      ).body,
      secondaryNickname,
      configuration.liveKitApiKey,
    );
    assert.notEqual(
      primaryJoin.participant_identity,
      secondaryJoin.participant_identity,
    );
    assert.equal(primaryJoin.server_url, secondaryJoin.server_url);
    assert.equal(primaryJoin.focus_started_at, secondaryJoin.focus_started_at);
    console.log("STUDY_ROOM_STAGING_POSITIVE: jwt_claims=true");

    checkpoint = "livekit_connect";
    const primaryRoom = new Room();
    const secondaryRoom = new Room();
    resources.rooms.add(primaryRoom);
    resources.rooms.add(secondaryRoom);
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
    assert.equal(
      primaryRoom.localParticipant?.identity,
      primaryJoin.participant_identity,
    );
    assert.equal(
      secondaryRoom.localParticipant?.identity,
      secondaryJoin.participant_identity,
    );
    assert.equal(primaryRoom.name, APPROVED_STAGING_ROOM);
    assert.equal(secondaryRoom.name, APPROVED_STAGING_ROOM);
    console.log("STUDY_ROOM_STAGING_POSITIVE: livekit_participants=2");

    checkpoint = "synthetic_media_subscription";
    const publications = await publishAndProveSyntheticMedia(
      secondaryRoom,
      primaryRoom,
      secondaryJoin.participant_identity,
      resources,
    );
    console.log(
      "STUDY_ROOM_STAGING_POSITIVE: subscribed_microphone=true subscribed_camera=true",
    );

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
      "/admin/study-room/moderate",
      primaryAdmin.token,
      {
        operation: "mute",
        participantIdentity: secondaryJoin.participant_identity,
        trackSid: publications.audioPublication.sid,
      },
    );
    assert.equal(moderation.body?.ok, true);
    assert.equal(moderation.body?.result?.action, "muted");
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
          "/admin/study-room/join",
          secondaryAdmin.token,
          { nickname: secondaryNickname },
          [201],
        )
      ).body,
      secondaryNickname,
      configuration.liveKitApiKey,
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
  } finally {
    checkpoint = "rtc_cleanup";
    cleanupErrors.push(...(await safeReleaseRtcResources(resources)));
    checkpoint = "synthetic_user_cleanup";
    cleanupErrors.push(
      ...(await deleteSyntheticUsers(configuration, createdUsers)),
    );
  }

  if (cleanupErrors.length) {
    console.error(
      `STUDY_ROOM_STAGING_POSITIVE: synthetic_cleanup=false run_id=${runId}`,
    );
    throw new AggregateError(
      failure ? [failure, ...cleanupErrors] : cleanupErrors,
      "The Study Room staging smoke did not complete exact cleanup.",
    );
  }
  console.log(
    `STUDY_ROOM_STAGING_POSITIVE: synthetic_cleanup=true run_id=${runId}`,
  );
  if (failure) throw failure;
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
  const nickname = "Participant 101";
  const claims = {
    iss: issuer,
    sub: identity,
    name: nickname,
    nbf: now,
    exp: now + STUDY_ROOM_TOKEN_TTL_SECONDS,
    video: {
      room: APPROVED_STAGING_ROOM,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ["camera", "microphone"],
    },
    roomConfig: {
      name: APPROVED_STAGING_ROOM,
      emptyTimeout: 600,
      departureTimeout: 120,
      maxParticipants: STUDY_ROOM_MAX_PARTICIPANTS,
    },
  };
  validateStudyRoomJwt(createSelfTestToken(claims), {
    identity,
    issuer,
    nickname,
  });
  assert.throws(
    () =>
      validateStudyRoomJwt(
        createSelfTestToken({
          ...claims,
          video: { ...claims.video, canPublishData: true },
        }),
        { identity, issuer, nickname },
      ),
    /canPublishData/u,
  );
  assert.throws(
    () =>
      validateStudyRoomJwt(
        createSelfTestToken({
          ...claims,
          video: { ...claims.video, roomAdmin: true },
        }),
        { identity, issuer, nickname },
      ),
    /room-administrator/u,
  );

  assert.equal(TrackSource.SOURCE_CAMERA, 1);
  assert.equal(TrackSource.SOURCE_MICROPHONE, 2);
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
    console.error(
      `STUDY_ROOM_STAGING_POSITIVE: FAIL checkpoint=${checkpoint} kind=${errorKind || "Error"}`,
    );
    process.exitCode = 1;
  }
}
