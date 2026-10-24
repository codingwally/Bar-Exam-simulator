import { deliverJob } from "./delivery.mjs";

// This Worker is deliberately independent of the public website and its database.
const DB_NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const COOKIE_DAYS = 180;
const MAX_ANSWER = 200000;
const MAX_BODY = 1500000;
const EVENT_TYPES = new Set([
  "consent",
  "session_start",
  "session_resume",
  "question_viewed",
  "question_changed",
  "save_success",
  "save_failure",
  "local_unsynced",
  "copy",
  "cut",
  "paste",
  "window_blur",
  "window_focus",
  "page_hidden",
  "page_visible",
  "online",
  "offline",
  "heartbeat",
  "heartbeat_missing",
  "page_unload",
  "pagehide",
  "beforeunload",
  "navigation_attempt",
  "second_session_attempt",
  "reconnect",
  "draft_recovery",
  "manual_submission",
  "timeout",
  "storage_failure",
  "readiness_check",
  "local_save",
  "server_save",
]);
const securityHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}
const fail = (status, code, message, extra) => {
  throw new ApiError(status, code, message, extra);
};
const id = () => crypto.randomUUID();
const now = () => Date.now();
const iso = (value) => (value == null ? null : new Date(value).toISOString());
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const one = (db, sql, ...values) => stmt(db, sql, ...values).first();
const all = async (db, sql, ...values) =>
  (await stmt(db, sql, ...values).all()).results || [];
const run = (db, sql, ...values) => stmt(db, sql, ...values).run();
const changes = (result) => result.meta?.changes ?? result.changes ?? 0;
const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};
const hash = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
};
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "invalid_input", `Enter a valid ${label}.`);
  return value.trim();
}
function operation(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    fail(400, "invalid_operation", "A valid save identifier is required.");
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    fail(400, "invalid_revision", "The answer revision is invalid.");
  return value;
}
async function body(request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "json_required", "Please retry from the examination page.");
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY)
    fail(413, "request_too_large", "This request is too large.");
  const reader = request.body?.getReader(),
    decoder = new TextDecoder(),
    chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY) {
        reader.cancel().catch(() => {});
        fail(413, "request_too_large", "This request is too large.");
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  }
  chunks.push(decoder.decode());
  const raw = chunks.join("");
  try {
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || typeof data !== "object") throw Error();
    return data;
  } catch {
    fail(400, "invalid_json", "The request could not be read. Please retry.");
  }
}
function sameOrigin(request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      fail(
        403,
        "origin_denied",
        "Open the exam in its original browser tab and retry.",
      );
    if (request.headers.get("Sec-Fetch-Site") === "cross-site")
      fail(403, "origin_denied", "This request is not permitted.");
  }
}
const cookieName = (slug) => `__Host-dd_exam_${slug}`;
function readCookie(request, name) {
  const pair = (request.headers.get("Cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) || "";
}
const setCookie = (slug, value) =>
  `${cookieName(slug)}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_DAYS * 86400}`;
function examStatus(exam, time = now()) {
  if (exam.control === "cancelled") return "CANCELLED";
  if (exam.control === "paused") return "PAUSED";
  if (exam.kind === "practice") return "OPEN";
  if (!exam.published_version || !exam.starts_at || !exam.ends_at)
    return "UNCONFIGURED";
  if (time < exam.starts_at) return "SCHEDULED";
  if (time >= exam.ends_at) return "CLOSED";
  return "OPEN";
}
const publicExam = (exam) => ({
  id: exam.id,
  slug: exam.slug,
  title: exam.title,
  status: examStatus(exam),
  startAt: exam.starts_at,
  endAt: exam.ends_at,
  questionCount: exam.question_count || 0,
});
async function getExam(db, identifier, bySlug = false) {
  if (bySlug && !["practice", "official"].includes(identifier))
    fail(404, "exam_not_found", "This examination link does not exist.");
  const exam = await one(
    db,
    `SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id AND q.version=e.published_version) question_count FROM exams e WHERE ${bySlug ? "slug" : "id"}=?`,
    identifier,
  );
  if (!exam)
    fail(
      503,
      "not_initialized",
      "The examination service is being prepared. Please contact the examiner.",
    );
  return exam;
}
async function session(db, request, exam, required = false) {
  const value = readCookie(request, cookieName(exam.slug));
  let attempt = null;
  if (value && /^[a-f0-9]{64}$/.test(value))
    attempt = await one(
      db,
      `SELECT a.* FROM sessions s JOIN attempts a ON a.id=s.attempt_id WHERE s.token_hash=? AND a.exam_id=? AND s.expires_at>${DB_NOW}`,
      await hash(value),
      exam.id,
    );
  if (!attempt && required)
    fail(
      401,
      "session_required",
      "Your exam session could not be restored. Contact the examiner for recovery; your saved answers remain preserved.",
    );
  return attempt;
}
async function admissionAccess(exam, request) {
  if (!exam.admission_enabled)
    fail(
      403,
      "admission_revoked",
      "New registration is currently unavailable. Registered students can continue using their original browser. Contact the examiner for the current admission link.",
    );
  const access = new URL(request.url).searchParams.get("access") || "",
    digest = access && access.length <= 128 ? await hash(access) : null;
  if (exam.access_key_hash && exam.access_key_hash !== digest)
    fail(
      403,
      "admission_link_invalid",
      "This admission link has been replaced. Contact the examiner for the current link. Registered students can continue using their original browser.",
    );
  return digest;
}
async function audit(
  db,
  identity,
  action,
  examId = null,
  attemptId = null,
  details = {},
) {
  await run(
    db,
    "INSERT INTO admin_audit(id,identity,action,exam_id,attempt_id,received_at,details_json) VALUES(?,?,?,?,?,?,?)",
    id(),
    identity,
    action,
    examId,
    attemptId,
    now(),
    JSON.stringify(details),
  );
}
async function recordEvent(
  db,
  attempt,
  type,
  details = {},
  eventId = id(),
  clientTime = null,
  questionId = null,
  provenance = "server",
) {
  await run(
    db,
    "INSERT OR IGNORE INTO events(id,attempt_id,exam_id,question_id,type,client_time,received_at,provenance,details_json) VALUES(?,?,?,?,?,?,?,?,?)",
    eventId,
    attempt.id,
    attempt.exam_id,
    questionId,
    type,
    clientTime,
    now(),
    provenance,
    JSON.stringify(details),
  );
}
async function receipt(db, attempt) {
  const row = await one(
    db,
    "SELECT * FROM submissions WHERE attempt_id=?",
    attempt.id,
  );
  if (!row || !row.checksum) return null;
  return {
    id: row.receipt_id,
    examId: attempt.exam_id,
    attemptId: attempt.id,
    name: attempt.name,
    email: attempt.email,
    finalizationType: attempt.finalization_type,
    serverTime: attempt.finalized_at,
    questionCount: row.question_count,
    answeredCount: row.answered_count,
    checksum: row.checksum,
  };
}
async function enqueue(db, attemptId, target, kind, dedupeKey) {
  await run(
    db,
    `INSERT OR IGNORE INTO outbox(id,target,attempt_id,dedupe_key,kind,next_attempt_at,created_at) VALUES(?,?,?,?,?,${DB_NOW},${DB_NOW})`,
    id(),
    target,
    attemptId,
    dedupeKey,
    kind,
  );
}
async function ensureFinalJobs(db, attempt) {
  const exam = await one(
    db,
    "SELECT kind FROM exams WHERE id=?",
    attempt.exam_id,
  );
  for (const target of [
    "r2",
    "sheets",
    ...(exam.kind === "official" ? ["owner_email", "student_receipt"] : []),
  ])
    await enqueue(
      db,
      attempt.id,
      target,
      "final",
      `final:${attempt.id}:${target}`,
    );
}
async function finish(db, attempt, kind = "deadline", editorId = null) {
  const receiptId = id();
  // D1 batches are transactions. Closing the attempt and copying every question slot
  // happen together, preventing a save from changing the official answer set afterward.
  await db.batch([
    stmt(
      db,
      `UPDATE attempts SET status='finalized',finalized_at=${DB_NOW},finalization_type=CASE WHEN deadline_at<=${DB_NOW} THEN 'deadline' ELSE ? END WHERE id=? AND status IN ('active','waiting') AND (deadline_at<=${DB_NOW} OR (?='manual' AND lease_editor=? AND lease_expires_at>${DB_NOW} AND EXISTS(SELECT 1 FROM exams e WHERE e.id=attempts.exam_id AND e.control='normal' AND (e.kind='practice' OR (e.starts_at<=${DB_NOW} AND e.ends_at>${DB_NOW})))))`,
      kind,
      attempt.id,
      kind,
      editorId,
    ),
    stmt(
      db,
      `INSERT OR IGNORE INTO submissions(attempt_id,receipt_id,created_at) SELECT id,?,${DB_NOW} FROM attempts WHERE id=? AND status='finalized'`,
      receiptId,
      attempt.id,
    ),
    stmt(
      db,
      `INSERT OR IGNORE INTO final_answers(attempt_id,question_id,revision,text,hash,saved_at) SELECT a.id,q.id,COALESCE(ans.revision,0),COALESCE(ans.text,''),COALESCE(ans.hash,''),ans.saved_at FROM attempts a JOIN questions q ON q.exam_id=a.exam_id AND q.version=a.version LEFT JOIN answers ans ON ans.attempt_id=a.id AND ans.question_id=q.id WHERE a.id=? AND a.status='finalized'`,
      attempt.id,
    ),
  ]);
  attempt = await one(db, "SELECT * FROM attempts WHERE id=?", attempt.id);
  if (attempt.status !== "finalized") return attempt;
  const frozen = await all(
    db,
    "SELECT f.question_id,f.revision,f.text,f.hash,f.saved_at FROM final_answers f JOIN questions q ON q.id=f.question_id WHERE f.attempt_id=? ORDER BY q.number",
    attempt.id,
  );
  const checksum = await hash(JSON.stringify(frozen));
  await run(
    db,
    "UPDATE submissions SET checksum=?,question_count=?,answered_count=? WHERE attempt_id=? AND checksum IS NULL",
    checksum,
    frozen.length,
    frozen.filter((x) => x.text.trim()).length,
    attempt.id,
  );
  await ensureFinalJobs(db, attempt);
  return attempt;
}
async function refreshAttempt(db, attempt, exam) {
  if (!attempt) return null;
  if (attempt.status !== "finalized" && attempt.last_seen_at < now() - 45000) {
    await recordEvent(
      db,
      attempt,
      "heartbeat_missing",
      {
        lastServerContactAt: attempt.last_seen_at,
        gapDetectedAt: now(),
        cause: "unknown",
        assessment: "Connection/heartbeat uncertain; examiner review only",
      },
      `heartbeat-gap-${attempt.id}-${attempt.last_seen_at}`,
    );
  }
  if (attempt.status !== "finalized" && attempt.deadline_at <= now())
    return finish(db, attempt, "deadline");
  if (attempt.status === "waiting" && examStatus(exam) === "OPEN") {
    await run(
      db,
      `UPDATE attempts SET status='active',started_at=COALESCE(started_at,${DB_NOW}) WHERE id=? AND status='waiting' AND deadline_at>${DB_NOW}`,
      attempt.id,
    );
    attempt = await one(db, "SELECT * FROM attempts WHERE id=?", attempt.id);
  }
  return attempt;
}
async function state(db, exam, attempt) {
  attempt = await refreshAttempt(db, attempt, exam);
  const result = { exam: publicExam(exam), serverTime: now(), attempt: null };
  if (!attempt) return result;
  const canSee =
    examStatus(exam) === "OPEN" ||
    (attempt.status === "finalized" &&
      exam.control === "normal" &&
      (exam.kind === "practice" || exam.starts_at <= now()));
  const questions = canSee
    ? await all(
        db,
        "SELECT id,number,text,instructions,points FROM questions WHERE exam_id=? AND version=? ORDER BY number",
        exam.id,
        attempt.version,
      )
    : [];
  const answers = canSee
    ? await all(
        db,
        `SELECT question_id questionId,revision,text,hash,saved_at savedAt FROM ${attempt.status === "finalized" ? "final_answers" : "answers"} WHERE attempt_id=?`,
        attempt.id,
      )
    : [];
  result.attempt = {
    id: attempt.id,
    name: attempt.name,
    email: attempt.email,
    status: attempt.status,
    startAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    position: attempt.position,
    lease: {
      editorId: attempt.lease_editor,
      expiresAt: attempt.lease_expires_at,
    },
    questions,
    answers,
    receipt: await receipt(db, attempt),
  };
  return result;
}
async function acquireLease(db, attempt, editorId, takeover = false) {
  editorId = text(editorId, 100, "editor identifier");
  const old = attempt.lease_editor;
  await run(
    db,
    `UPDATE attempts SET lease_editor=?,lease_expires_at=${DB_NOW}+25000,last_seen_at=${DB_NOW} WHERE id=? AND (lease_editor=? OR lease_expires_at<=${DB_NOW} OR ?=1)`,
    editorId,
    attempt.id,
    editorId,
    takeover ? 1 : 0,
  );
  const updated = await one(
    db,
    "SELECT * FROM attempts WHERE id=?",
    attempt.id,
  );
  if (updated.lease_editor !== editorId)
    fail(
      423,
      "editor_in_use",
      "This exam is open in another tab. Close that tab or choose to continue here.",
      {
        lease: {
          editorId: updated.lease_editor,
          expiresAt: updated.lease_expires_at,
        },
      },
    );
  if (old && old !== editorId)
    await recordEvent(db, attempt, "second_session_attempt", {
      explicitTakeover: !!takeover,
    });
  return { editorId, expiresAt: updated.lease_expires_at };
}
async function requireQuestion(db, attempt, questionId) {
  const question = await one(
    db,
    "SELECT * FROM questions WHERE id=? AND exam_id=? AND version=?",
    questionId,
    attempt.exam_id,
    attempt.version,
  );
  if (!question)
    fail(
      404,
      "question_not_found",
      "This question is not part of your examination.",
    );
  return question;
}
async function studentApi(request, env, slug, tail) {
  const db = env.EXAM_DB,
    exam = await getExam(db, slug, true);
  let attempt = await session(db, request, exam);
  // Admission links authorize new enrollment only. Existing session credentials
  // and examiner-authorized recovery remain valid after link rotation/revocation.
  const admissionHash =
    !attempt && tail !== "recover"
      ? await admissionAccess(exam, request)
      : null;
  if (request.method === "GET" && tail === "state")
    return json(await state(db, exam, attempt));
  if (request.method === "POST" && tail === "attempt") {
    const data = await body(request);
    if (attempt) return json(await state(db, exam, attempt));
    if (!["OPEN", "SCHEDULED"].includes(examStatus(exam)))
      fail(
        409,
        "exam_unavailable",
        examStatus(exam) === "CLOSED"
          ? "Examination closed"
          : "Test is not available",
      );
    const name = text(data.name, 160, "full name"),
      email = text(data.email, 254, "email address").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "invalid_email", "Enter a valid email address.");
    if (data.consent !== true || data.oneBrowser !== true)
      fail(
        400,
        "consent_required",
        "Please read and acknowledge the examination notice.",
      );
    const registrationId = text(
      data.registrationId,
      120,
      "browser registration identifier",
    );
    if (!/^[a-zA-Z0-9_-]{32,120}$/.test(registrationId))
      fail(
        400,
        "registration_required",
        "A private browser registration identifier is required.",
      );
    const registrationHash = await hash(registrationId),
      previous = await one(
        db,
        "SELECT * FROM attempts WHERE exam_id=? AND registration_hash=?",
        exam.id,
        registrationHash,
      );
    if (previous) {
      const restoredToken = await hash(
        `dd-exam-session:${previous.id}:${registrationId}`,
      );
      // Registration credentials only restore their originally associated attempt.
      const existingSession = await one(
        db,
        "SELECT token_hash FROM sessions WHERE attempt_id=?",
        previous.id,
      );
      if (
        !existingSession ||
        existingSession.token_hash !== (await hash(restoredToken))
      )
        fail(
          401,
          "recovery_required",
          "This browser registration has been replaced by examiner recovery. Contact the examiner.",
        );
      return json(await state(db, exam, previous), 200, {
        "Set-Cookie": setCookie(slug, restoredToken),
      });
    }
    // This is a per-minute abuse limit, never an enrollment or roster limit.
    // A large allowance accommodates a whole class behind one school network.
    const window = Math.floor(now() / 60000) * 60000,
      network =
        request.headers.get("CF-Connecting-IP") || "unidentified-network";
    const windowKey = await hash(`${exam.id}:${network}:${window}`),
      limit = Math.max(
        600,
        Math.min(10000, Number(env.REGISTRATION_BURST_LIMIT) || 600),
      );
    await run(
      db,
      "INSERT INTO registration_windows(key_hash,window_start,requests) VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET requests=requests+1",
      windowKey,
      window,
    );
    if (
      (
        await one(
          db,
          "SELECT requests FROM registration_windows WHERE key_hash=?",
          windowKey,
        )
      ).requests > limit
    )
      fail(
        429,
        "registration_rate_limited",
        "Many new registrations arrived from this network. Please wait one minute and retry; there is no enrollment limit.",
      );
    const editorId = text(data.editorId, 100, "editor identifier"),
      attemptId = id(),
      rawToken = await hash(`dd-exam-session:${attemptId}:${registrationId}`),
      time = now();
    const deadline = exam.kind === "practice" ? time + 300000 : exam.ends_at;
    await db.batch([
      stmt(
        db,
        `INSERT OR IGNORE INTO attempts(id,exam_id,version,name,email,registration_hash,status,created_at,started_at,deadline_at,last_seen_at,lease_editor,lease_expires_at) SELECT ?,id,published_version,?,?,?,?, ?,?,?,?, ?,? FROM exams WHERE id=? AND control='normal' AND admission_enabled=1 AND (access_key_hash IS NULL OR access_key_hash=?) AND (kind='practice' OR (ends_at>${DB_NOW} AND published_version IS NOT NULL))`,
        attemptId,
        name,
        email,
        registrationHash,
        examStatus(exam) === "SCHEDULED" ? "waiting" : "active",
        time,
        examStatus(exam) === "SCHEDULED" ? null : time,
        deadline,
        time,
        editorId,
        time + 25000,
        exam.id,
        admissionHash,
      ),
      stmt(
        db,
        `INSERT INTO sessions(token_hash,attempt_id,expires_at) SELECT ?,id,? FROM attempts WHERE id=?`,
        await hash(rawToken),
        time + COOKIE_DAYS * 86400000,
        attemptId,
      ),
    ]);
    attempt = await one(db, "SELECT * FROM attempts WHERE id=?", attemptId);
    if (!attempt) {
      const concurrent = await one(
        db,
        "SELECT * FROM attempts WHERE exam_id=? AND registration_hash=?",
        exam.id,
        registrationHash,
      );
      if (concurrent)
        return json(await state(db, exam, concurrent), 200, {
          "Set-Cookie": setCookie(
            slug,
            await hash(`dd-exam-session:${concurrent.id}:${registrationId}`),
          ),
        });
      await admissionAccess(await getExam(db, slug, true), request);
      fail(409, "exam_closed", "Examination closed");
    }
    await recordEvent(db, attempt, "consent", {
      noticeVersion: "2026-10-24",
      oneBrowser: true,
    });
    await recordEvent(db, attempt, "session_start", {});
    return json(await state(db, exam, attempt), 201, {
      "Set-Cookie": setCookie(slug, rawToken),
    });
  }
  if (request.method === "POST" && tail === "recover") {
    const data = await body(request),
      recoveryHash = await hash(text(data.token, 200, "recovery code"));
    const found = await one(
      db,
      `SELECT r.* FROM recovery_tokens r JOIN attempts a ON a.id=r.attempt_id WHERE r.token_hash=? AND a.exam_id=? AND r.consumed_at IS NULL AND r.expires_at>${DB_NOW}`,
      recoveryHash,
      exam.id,
    );
    if (!found)
      fail(
        403,
        "recovery_invalid",
        "This recovery code is expired or has already been used. Contact the examiner.",
      );
    const result = await run(
      db,
      `UPDATE recovery_tokens SET consumed_at=${DB_NOW} WHERE token_hash=? AND consumed_at IS NULL AND expires_at>${DB_NOW}`,
      recoveryHash,
    );
    if (!changes(result))
      fail(409, "recovery_used", "This recovery code has already been used.");
    const rawToken = token();
    await db.batch([
      stmt(db, "DELETE FROM sessions WHERE attempt_id=?", found.attempt_id),
      stmt(
        db,
        "INSERT INTO sessions(token_hash,attempt_id,expires_at) VALUES(?,?,?)",
        await hash(rawToken),
        found.attempt_id,
        now() + COOKIE_DAYS * 86400000,
      ),
      stmt(
        db,
        "UPDATE attempts SET lease_editor=NULL,lease_expires_at=0 WHERE id=?",
        found.attempt_id,
      ),
    ]);
    attempt = await one(
      db,
      "SELECT * FROM attempts WHERE id=?",
      found.attempt_id,
    );
    await recordEvent(db, attempt, "admin_recovery", {});
    return json(await state(db, exam, attempt), 200, {
      "Set-Cookie": setCookie(slug, rawToken),
    });
  }
  attempt = await refreshAttempt(
    db,
    await session(db, request, exam, true),
    exam,
  );
  if (request.method === "POST" && tail === "lease") {
    const data = await body(request);
    return json({
      lease: await acquireLease(
        db,
        attempt,
        data.editorId,
        data.takeover === true,
      ),
      serverTime: now(),
    });
  }
  if (request.method === "PUT" && tail.startsWith("answers/")) {
    const data = await body(request),
      questionId = decodeURIComponent(tail.slice(8));
    await requireQuestion(db, attempt, questionId);
    const op = operation(data.operationId),
      rev = revision(data.revision),
      editorId = text(data.editorId, 100, "editor identifier");
    if (typeof data.text !== "string" || data.text.length > MAX_ANSWER)
      fail(
        400,
        "answer_too_large",
        "The answer exceeds the supported length. Download your draft and contact the examiner.",
      );
    const digest = await hash(data.text),
      prior = await one(db, "SELECT * FROM answer_operations WHERE id=?", op);
    if (prior) {
      if (
        prior.attempt_id !== attempt.id ||
        prior.question_id !== questionId ||
        prior.revision !== rev ||
        prior.hash !== digest
      )
        fail(
          409,
          "operation_conflict",
          "This save identifier was already used for different writing. Your draft remains in this browser.",
        );
      return json({
        answer: {
          questionId,
          revision: prior.revision,
          text: prior.text,
          hash: prior.hash,
          savedAt: prior.saved_at,
        },
        serverTime: now(),
        duplicate: true,
      });
    }
    if (attempt.status === "finalized" || examStatus(exam) !== "OPEN")
      fail(
        409,
        "exam_closed",
        "Official writing is closed. Your late or offline draft can be preserved separately.",
        { attempt: await state(db, exam, attempt) },
      );
    await db.batch([
      stmt(
        db,
        `INSERT OR IGNORE INTO answer_operations(id,attempt_id,question_id,revision,text,hash,saved_at) SELECT ?,a.id,?,?,?,?,${DB_NOW} FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND a.status='active' AND a.deadline_at>${DB_NOW} AND e.control='normal' AND a.lease_editor=? AND a.lease_expires_at>${DB_NOW} AND NOT EXISTS(SELECT 1 FROM answers an WHERE an.attempt_id=a.id AND an.question_id=? AND an.revision>=?)`,
        op,
        questionId,
        rev,
        data.text,
        digest,
        attempt.id,
        editorId,
        questionId,
        rev,
      ),
      stmt(
        db,
        `INSERT INTO answers(attempt_id,question_id,revision,text,hash,saved_at,operation_id) SELECT attempt_id,question_id,revision,text,hash,saved_at,id FROM answer_operations WHERE id=? AND attempt_id=? ON CONFLICT(attempt_id,question_id) DO UPDATE SET revision=excluded.revision,text=excluded.text,hash=excluded.hash,saved_at=excluded.saved_at,operation_id=excluded.operation_id WHERE excluded.revision>answers.revision`,
        op,
        attempt.id,
      ),
      stmt(
        db,
        `UPDATE attempts SET last_saved_at=(SELECT saved_at FROM answer_operations WHERE id=?),last_seen_at=${DB_NOW} WHERE id=? AND EXISTS(SELECT 1 FROM answer_operations WHERE id=?)`,
        op,
        attempt.id,
        op,
      ),
      stmt(
        db,
        `INSERT OR IGNORE INTO outbox(id,target,attempt_id,dedupe_key,kind,next_attempt_at,created_at) SELECT ?,'r2',attempt_id,?,'snapshot',${DB_NOW},${DB_NOW} FROM answer_operations WHERE id=? AND attempt_id=?`,
        id(),
        `save:${op}:r2`,
        op,
        attempt.id,
      ),
      stmt(
        db,
        `INSERT OR IGNORE INTO outbox(id,target,attempt_id,dedupe_key,kind,next_attempt_at,created_at) SELECT ?,'sheets',attempt_id,?,'snapshot',${DB_NOW},${DB_NOW} FROM answer_operations WHERE id=? AND attempt_id=?`,
        id(),
        `mirror:${attempt.id}:${Math.floor(now() / 30000)}`,
        op,
        attempt.id,
      ),
    ]);
    const saved = await one(
      db,
      "SELECT * FROM answer_operations WHERE id=? AND attempt_id=?",
      op,
      attempt.id,
    );
    if (!saved) {
      attempt = await refreshAttempt(
        db,
        await one(db, "SELECT * FROM attempts WHERE id=?", attempt.id),
        exam,
      );
      if (attempt.status === "finalized")
        fail(
          409,
          "exam_closed",
          "The examination deadline has passed. Your offline draft can be preserved separately.",
        );
      if (
        attempt.lease_editor !== editorId ||
        attempt.lease_expires_at <= now()
      )
        fail(
          423,
          "editor_in_use",
          "The editing session needs to be renewed. Your draft remains in this browser.",
        );
      const current = await one(
        db,
        "SELECT question_id questionId,revision,text,hash,saved_at savedAt FROM answers WHERE attempt_id=? AND question_id=?",
        attempt.id,
        questionId,
      );
      fail(
        409,
        "stale_revision",
        "A newer version of this answer has already been saved.",
        { answer: current },
      );
    }
    if (
      saved.question_id !== questionId ||
      saved.revision !== rev ||
      saved.hash !== digest
    )
      fail(
        409,
        "operation_conflict",
        "This save identifier was already used for different writing. Your draft remains in this browser.",
      );
    // Every committed revision and its R2 job are atomic. Sheets is coalesced to
    // thirty-second windows; finalization always queues a complete final mirror.
    return json({
      answer: {
        questionId,
        revision: saved.revision,
        text: saved.text,
        hash: saved.hash,
        savedAt: saved.saved_at,
      },
      serverTime: now(),
    });
  }
  if (request.method === "POST" && tail === "position") {
    const data = await body(request);
    await requireQuestion(db, attempt, data.questionId);
    await run(
      db,
      "UPDATE attempts SET position=?,last_seen_at=? WHERE id=?",
      data.questionId,
      now(),
      attempt.id,
    );
    return json({ saved: true, serverTime: now() });
  }
  if (request.method === "POST" && tail === "events") {
    const data = await body(request);
    if (!Array.isArray(data.events) || data.events.length > 100)
      fail(
        400,
        "invalid_events",
        "Send at most 100 activity records per request.",
      );
    const accepted = [];
    for (const event of data.events) {
      const eventId = operation(event.id);
      if (!EVENT_TYPES.has(event.type))
        fail(
          400,
          "invalid_event",
          "An activity record has an unsupported category.",
        );
      if (event.questionId)
        await requireQuestion(db, attempt, event.questionId);
      const details =
        event.details && typeof event.details === "object" ? event.details : {};
      if (JSON.stringify(details).length > 220000)
        fail(413, "event_too_large", "An activity record is too large.");
      const existing = await one(
        db,
        "SELECT * FROM events WHERE id=?",
        eventId,
      );
      const clientTime =
        typeof event.clientTime === "string"
          ? event.clientTime.slice(0, 80)
          : null;
      if (
        existing &&
        (existing.attempt_id !== attempt.id ||
          existing.type !== event.type ||
          existing.question_id !== (event.questionId || null) ||
          existing.client_time !== clientTime ||
          existing.details_json !== JSON.stringify(details))
      )
        fail(
          409,
          "event_conflict",
          "An activity identifier is already in use for a different record.",
        );
      await recordEvent(
        db,
        attempt,
        event.type,
        details,
        eventId,
        clientTime,
        event.questionId || null,
        "client-observed; time untrusted",
      );
      const committed = await one(
        db,
        "SELECT * FROM events WHERE id=?",
        eventId,
      );
      if (
        committed.attempt_id !== attempt.id ||
        committed.type !== event.type ||
        committed.question_id !== (event.questionId || null) ||
        committed.client_time !== clientTime ||
        committed.details_json !== JSON.stringify(details)
      )
        fail(
          409,
          "event_conflict",
          "An activity identifier is already in use for a different record.",
        );
      accepted.push(eventId);
    }
    await run(
      db,
      "UPDATE attempts SET last_seen_at=? WHERE id=?",
      now(),
      attempt.id,
    );
    return json({ accepted, serverTime: now() });
  }
  if (request.method === "POST" && tail === "submit") {
    const data = await body(request);
    operation(data.operationId);
    if (attempt.status === "finalized")
      return json(await state(db, exam, attempt));
    if (examStatus(exam) !== "OPEN")
      fail(
        409,
        "exam_not_open",
        "The examination is not open for submission. Your answers remain preserved.",
      );
    await acquireLease(db, attempt, data.editorId, false);
    attempt = await finish(db, attempt, "manual", data.editorId);
    if (attempt.status !== "finalized")
      fail(
        423,
        "editor_in_use",
        "The editing session changed before submission. Your answers remain preserved. Please retry from the active tab.",
      );
    await recordEvent(db, attempt, "manual_submission", {});
    return json(await state(db, exam, attempt));
  }
  if (request.method === "POST" && tail === "recovery") {
    const data = await body(request);
    const op = operation(data.operationId),
      rev = revision(data.revision);
    await requireQuestion(db, attempt, data.questionId);
    if (typeof data.text !== "string" || data.text.length > MAX_ANSWER)
      fail(400, "answer_too_large", "This recovered draft is too long.");
    const digest = await hash(data.text),
      prior = await one(db, "SELECT * FROM recovered_drafts WHERE id=?", op);
    if (
      prior &&
      (prior.attempt_id !== attempt.id ||
        prior.question_id !== data.questionId ||
        prior.hash !== digest ||
        prior.revision !== rev)
    )
      fail(
        409,
        "operation_conflict",
        "This recovery identifier was already used for different writing.",
      );
    await run(
      db,
      "INSERT OR IGNORE INTO recovered_drafts(id,attempt_id,question_id,revision,text,hash,client_time,received_at) VALUES(?,?,?,?,?,?,?,?)",
      op,
      attempt.id,
      data.questionId,
      rev,
      data.text,
      digest,
      typeof data.clientTime === "string" ? data.clientTime.slice(0, 80) : null,
      now(),
    );
    return json({
      preserved: true,
      label: "late/offline recovered draft",
      officialSubmissionChanged: false,
      hash: digest,
      serverTime: now(),
    });
  }
  fail(404, "route_not_found", "This examination action does not exist.");
}

// Validate Cloudflare Access cryptographically. Merely trusting an email header
// would let a caller bypass authentication on the workers.dev origin.
let accessKeys = { issuer: null, expires: 0, keys: [] };
function decode64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
}
export async function authenticateAdmin(request, env) {
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
  const issuer = team?.startsWith("https://") ? team : `https://${team || ""}`;
  const owners = (env.ADMIN_EMAILS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    examiners = (env.EXAMINER_EMAILS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    allowed = [...owners, ...examiners];
  if (
    !team ||
    !env.ACCESS_AUD ||
    !allowed.length ||
    !/^https:\/\/[a-zA-Z0-9-]+\.cloudflareaccess\.com$/.test(issuer)
  )
    fail(
      503,
      "admin_setup_required",
      "Private examiner authentication has not been configured. Contact the site owner.",
    );
  const raw = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!raw)
    fail(
      401,
      "admin_sign_in_required",
      "Sign in through the protected examiner address.",
    );
  try {
    const pieces = raw.split(".");
    if (pieces.length !== 3) throw Error();
    const header = JSON.parse(new TextDecoder().decode(decode64(pieces[0]))),
      claims = JSON.parse(new TextDecoder().decode(decode64(pieces[1])));
    if (
      header.alg !== "RS256" ||
      !header.kid ||
      claims.iss !== issuer ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= now() ||
      (claims.nbf != null &&
        (typeof claims.nbf !== "number" ||
          !Number.isFinite(claims.nbf) ||
          claims.nbf * 1000 > now() + 30000))
    )
      throw Error();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      !audiences.includes(env.ACCESS_AUD) ||
      !allowed.includes(String(claims.email || "").toLowerCase())
    )
      throw Error();
    if (
      accessKeys.issuer !== issuer ||
      accessKeys.expires < now() ||
      !accessKeys.keys.some((x) => x.kid === header.kid)
    ) {
      const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error();
      const keyData = await response.json();
      accessKeys = {
        issuer,
        expires: now() + 300000,
        keys: keyData.keys || [],
      };
    }
    const jwk = accessKeys.keys.find((x) => x.kid === header.kid);
    if (!jwk) throw Error();
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decode64(pieces[2]),
        new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
      ))
    )
      throw Error();
    const email = String(claims.email).toLowerCase();
    return {
      email,
      subject: claims.sub,
      role: owners.includes(email) ? "owner" : "examiner",
    };
  } catch {
    fail(
      401,
      "admin_sign_in_required",
      "Your examiner sign-in could not be verified. Sign in again through the protected address.",
    );
  }
}
const adminExam = (exam) => ({
  id: exam.id,
  label: exam.title,
  kind: exam.kind,
  archived: !["practice", "official"].includes(exam.slug),
  state: examStatus(exam),
  admission_enabled: !!exam.admission_enabled,
  question_count: exam.question_count || 0,
  starts_at: iso(exam.starts_at),
  ends_at: iso(exam.ends_at),
  student_url: ["practice", "official"].includes(exam.slug)
    ? `/${exam.slug}${exam.access_key ? `?access=${encodeURIComponent(exam.access_key)}` : ""}`
    : null,
});
function questionsInput(value) {
  if (!Array.isArray(value) || !value.length || value.length > 300)
    fail(
      400,
      "invalid_questions",
      "Provide between 1 and 300 complete questions.",
    );
  const seen = new Set();
  return value.map((q, i) => {
    if (q.number !== i + 1)
      fail(
        400,
        "invalid_numbering",
        "Question numbers must be consecutive, beginning with 1.",
      );
    const questionText = text(q.text, 80000, `text for Question ${i + 1}`),
      normalized = questionText.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(normalized))
      fail(
        400,
        "duplicate_question",
        `Question ${i + 1} duplicates another question.`,
      );
    seen.add(normalized);
    if (
      q.instructions != null &&
      (typeof q.instructions !== "string" || q.instructions.length > 10000)
    )
      fail(
        400,
        "invalid_instructions",
        `Question ${i + 1} instructions must contain no more than 10,000 characters. No content was saved.`,
      );
    if (
      /^\s*(?:answer\s*key|suggested\s+answer|model\s+answer|correct\s+answer)\s*[:—-]?/im.test(
        `${questionText}\n${q.instructions || ""}`,
      )
    )
      fail(
        400,
        "answer_key_detected",
        `Question ${i + 1} appears to contain an answer key. Remove instructor-only material before saving.`,
      );
    if (
      q.points != null &&
      (!Number.isFinite(Number(q.points)) ||
        Number(q.points) < 0 ||
        Number(q.points) > 10000)
    )
      fail(
        400,
        "invalid_points",
        "Question points must be a nonnegative number.",
      );
    return {
      number: i + 1,
      text: questionText,
      instructions: q.instructions || "",
      points: q.points == null ? null : Number(q.points),
    };
  });
}
async function detailExam(db, exam) {
  const published = exam.published_version
    ? {
        version: exam.published_version,
        questions: await all(
          db,
          "SELECT id,number,text,instructions,points FROM questions WHERE exam_id=? AND version=? ORDER BY number",
          exam.id,
          exam.published_version,
        ),
        starts_at: iso(exam.starts_at),
        ends_at: iso(exam.ends_at),
      }
    : null;
  return {
    exam: adminExam(exam),
    draft: {
      version: exam.draft_version,
      questions: parseJson(exam.draft_json),
    },
    published,
  };
}
const publicAttempt = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  status: a.status,
  started_at: iso(a.started_at),
  created_at: iso(a.created_at),
  last_seen_at: iso(a.last_seen_at),
  last_saved_at: iso(a.last_saved_at),
  deadline_at: iso(a.deadline_at),
  question_count: a.question_count || 0,
  answered_count: a.answered_count || 0,
  backup_status: a.backup_status || "pending",
});
const csvCell = (value) => {
  let str = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(str) || /^[\t\r\n]/.test(str))
    str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
};
function eventCursor(value) {
  const match = /^(\d+):([a-zA-Z0-9_-]+)$/.exec(value || "");
  return match ? { time: Number(match[1]), id: match[2] } : { time: 0, id: "" };
}
async function eventPage(db, examId, attemptId, search, cursor) {
  const after = eventCursor(cursor),
    events = await all(
      db,
      "SELECT * FROM events WHERE exam_id=? AND (?='' OR attempt_id=?) AND (type LIKE ? OR details_json LIKE ?) AND (received_at>? OR (received_at=? AND id>?)) ORDER BY received_at,id LIMIT 101",
      examId,
      attemptId || "",
      attemptId || "",
      `%${search}%`,
      `%${search}%`,
      after.time,
      after.time,
      after.id,
    );
  return {
    events: events
      .slice(0, 100)
      .map((e) => ({ ...e, details: parseJson(e.details_json) })),
    next_cursor:
      events.length > 100 ? `${events[99].received_at}:${events[99].id}` : null,
    limitations:
      "Browser observations require examiner review. Heartbeat gaps do not establish cause or misconduct.",
  };
}
async function adminApi(request, env, tail, identity) {
  const db = env.EXAM_DB,
    url = new URL(request.url),
    parts = tail.split("/").filter(Boolean);
  if (identity.role === "examiner" && request.method !== "GET")
    fail(
      403,
      "read_only_examiner",
      "Your examiner access permits reading and downloading results. Ask the owner to make examination changes.",
    );
  if (request.method === "GET" && tail === "exams") {
    const exams = await all(
      db,
      "SELECT e.*,(SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id AND q.version=e.published_version) question_count FROM exams e ORDER BY kind",
    );
    return json({ exams: exams.map(adminExam), identity });
  }
  if (request.method === "POST" && tail === "exams") {
    const data = await body(request),
      op = operation(data.operation_id),
      label = text(data.label, 180, "examination title"),
      reason = text(data.reason, 2000, "reason for starting a new examination");
    if (data.confirmed !== true)
      fail(
        400,
        "confirmation_required",
        "Confirm archiving the previous official examination and creating an empty one.",
      );
    const expected = text(
        data.expected_current_exam_id,
        100,
        "current examination identifier",
      ),
      digest = await hash(JSON.stringify({ label, reason, expected }));
    const existing = await one(
      db,
      "SELECT * FROM admin_operations WHERE id=?",
      op,
    );
    if (existing) {
      if (existing.kind !== "new_exam" || existing.payload_hash !== digest)
        fail(
          409,
          "operation_conflict",
          "This request identifier was used for a different examiner action.",
        );
      return json({
        exam: adminExam(await getExam(db, existing.result_exam_id)),
      });
    }
    const current = await getExam(db, "official", true);
    if (current.id !== expected)
      fail(
        409,
        "exam_conflict",
        "The current official examination changed. Reload and review it.",
      );
    if (!["UNCONFIGURED", "CLOSED", "CANCELLED"].includes(examStatus(current)))
      fail(
        409,
        "exam_in_progress",
        "The existing official examination is scheduled, open, or paused. Finish or explicitly cancel it before creating another.",
      );
    if (
      examStatus(current) === "UNCONFIGURED" &&
      (
        await one(
          db,
          "SELECT COUNT(*) count FROM attempts WHERE exam_id=?",
          current.id,
        )
      ).count
    )
      fail(
        409,
        "attempts_present",
        "The current official examination contains attempts and cannot be replaced while unconfigured.",
      );
    const newId = id(),
      time = now();
    await db.batch([
      stmt(
        db,
        `INSERT OR IGNORE INTO admin_operations(id,kind,result_exam_id,payload_hash,created_at) SELECT ?,'new_exam',?,?,${DB_NOW} FROM exams e WHERE e.id=? AND e.slug='official' AND (e.control='cancelled' OR e.ends_at<=${DB_NOW} OR (e.published_version IS NULL AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.exam_id=e.id)))`,
        op,
        newId,
        digest,
        current.id,
      ),
      stmt(
        db,
        "UPDATE exams SET slug='archived-'||id,updated_at=? WHERE id=? AND slug='official' AND EXISTS(SELECT 1 FROM admin_operations o WHERE o.id=? AND o.result_exam_id=?)",
        time,
        current.id,
        op,
        newId,
      ),
      stmt(
        db,
        "INSERT INTO exams(id,slug,title,kind,created_at,updated_at) SELECT ?,'official',?,'official',?,? FROM admin_operations o WHERE o.id=? AND o.result_exam_id=?",
        newId,
        label,
        time,
        time,
        op,
        newId,
      ),
    ]);
    const completed = await one(
      db,
      "SELECT * FROM admin_operations WHERE id=?",
      op,
    );
    if (!completed || completed.payload_hash !== digest)
      fail(
        409,
        "exam_conflict",
        "The examination changed before this request completed. Reload and review it.",
      );
    await audit(
      db,
      identity.email,
      "new_official_exam",
      completed.result_exam_id,
      null,
      { previousExamId: current.id, reason },
    );
    return json(
      { exam: adminExam(await getExam(db, completed.result_exam_id)) },
      201,
    );
  }
  if (parts[0] === "exams" && parts[1]) {
    const exam = await getExam(db, parts[1]),
      action = parts[2];
    if (
      !["practice", "official"].includes(exam.slug) &&
      request.method !== "GET"
    )
      fail(
        403,
        "archived_read_only",
        "Archived examination records are preserved as read-only.",
      );
    if (request.method === "GET" && !action)
      return json(await detailExam(db, exam));
    if (request.method === "POST" && action === "access-link") {
      const data = await body(request),
        reason = text(
          data.reason,
          2000,
          "reason for changing admission access",
        );
      if (
        data.confirmed !== true ||
        !["rotate", "revoke", "enable"].includes(data.action)
      )
        fail(
          400,
          "confirmation_required",
          "Confirm the admission-link action. Existing attempts will continue unchanged.",
        );
      const op = data.operation_id ? operation(data.operation_id) : id(),
        digest = await hash(
          JSON.stringify({ examId: exam.id, action: data.action, reason }),
        ),
        prior = await one(db, "SELECT * FROM admin_operations WHERE id=?", op);
      if (prior) {
        if (
          !prior.kind.startsWith("access_link:") ||
          prior.payload_hash !== digest
        )
          fail(
            409,
            "operation_conflict",
            "This request identifier was used for a different examiner action.",
          );
        return json(await detailExam(db, await getExam(db, exam.id)));
      }
      const key = data.action === "rotate" ? token() : null,
        keyHash = key ? await hash(key) : null,
        claim = `access_link:${id()}`;
      await db.batch([
        stmt(
          db,
          `INSERT OR IGNORE INTO admin_operations(id,kind,result_exam_id,payload_hash,created_at) SELECT ?,?,?,?,${DB_NOW} FROM exams WHERE id=? AND slug IN ('practice','official')`,
          op,
          claim,
          exam.id,
          digest,
          exam.id,
        ),
        stmt(
          db,
          `UPDATE exams SET admission_enabled=?,access_key=CASE WHEN ?='rotate' THEN ? ELSE access_key END,access_key_hash=CASE WHEN ?='rotate' THEN ? ELSE access_key_hash END,updated_at=${DB_NOW} WHERE id=? AND slug IN ('practice','official') AND EXISTS(SELECT 1 FROM admin_operations o WHERE o.id=? AND o.kind=?)`,
          data.action === "revoke" ? 0 : 1,
          data.action,
          key,
          data.action,
          keyHash,
          exam.id,
          op,
          claim,
        ),
      ]);
      const completed = await one(
        db,
        "SELECT * FROM admin_operations WHERE id=?",
        op,
      );
      if (!completed || completed.payload_hash !== digest)
        fail(
          409,
          "exam_conflict",
          "The examination changed before this request completed. Reload and review it.",
        );
      await audit(
        db,
        identity.email,
        `admission_${data.action}`,
        exam.id,
        null,
        { reason, existingAttemptsPreserved: true },
      );
      return json(await detailExam(db, await getExam(db, exam.id)));
    }
    if (request.method === "PUT" && action === "draft") {
      if (exam.kind !== "official")
        fail(403, "practice_fixed", "The approved practice question is fixed.");
      const data = await body(request),
        questions = questionsInput(data.questions);
      if (data.expected_version !== exam.draft_version)
        fail(
          409,
          "draft_conflict",
          "Another examiner changed the draft. Reload before saving.",
        );
      const result = await run(
        db,
        "UPDATE exams SET draft_json=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND draft_version=? AND slug='official'",
        JSON.stringify(questions),
        now(),
        exam.id,
        data.expected_version,
      );
      if (!changes(result))
        fail(
          409,
          "draft_conflict",
          "Another examiner changed the draft. Reload before saving.",
        );
      await audit(db, identity.email, "draft_saved", exam.id, null, {
        questionCount: questions.length,
      });
      return json(await detailExam(db, await getExam(db, exam.id)));
    }
    if (request.method === "POST" && action === "schedule") {
      const data = await body(request),
        start = Date.parse(data.starts_at),
        end = Date.parse(data.ends_at);
      if (exam.kind !== "official" || data.confirmed !== true)
        fail(
          400,
          "confirmation_required",
          "Confirm the questions and schedule before scheduling.",
        );
      if (
        exam.published_version === data.expected_draft_version &&
        exam.starts_at === start &&
        exam.ends_at === end
      )
        return json(await detailExam(db, exam));
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start >= end ||
        start <= now() ||
        end - start > 7 * 86400000
      )
        fail(
          400,
          "invalid_schedule",
          "Choose a future opening and a later closing, within seven days of opening.",
        );
      if (exam.starts_at && exam.starts_at <= now())
        fail(
          409,
          "exam_started",
          "The examination has started. Its published questions and schedule are preserved.",
        );
      if (data.expected_draft_version !== exam.draft_version)
        fail(
          409,
          "draft_conflict",
          "Reload the latest draft before scheduling.",
        );
      const questions = questionsInput(parseJson(exam.draft_json)),
        version = exam.draft_version;
      if (
        exam.published_version === version &&
        exam.starts_at === start &&
        exam.ends_at === end
      )
        return json(await detailExam(db, exam));
      const reason = exam.published_version
        ? text(data.reason, 2000, "reason for changing a scheduled examination")
        : "Initial question approval and schedule";
      // Never replace a published version. A changed draft receives a new version.
      const existing = await one(
        db,
        "SELECT version FROM question_versions WHERE exam_id=? AND version=?",
        exam.id,
        version,
      );
      const statements = [];
      if (!existing) {
        statements.push(
          stmt(
            db,
            "INSERT OR IGNORE INTO question_versions(exam_id,version,approved_at,approved_by) VALUES(?,?,?,?)",
            exam.id,
            version,
            now(),
            identity.email,
          ),
        );
        for (const q of questions)
          statements.push(
            stmt(
              db,
              "INSERT OR IGNORE INTO questions(id,exam_id,version,number,text,instructions,points) VALUES(?,?,?,?,?,?,?)",
              `${exam.id}-v${version}-q${q.number}`,
              exam.id,
              version,
              q.number,
              q.text,
              q.instructions,
              q.points,
            ),
          );
      }
      statements.push(
        stmt(
          db,
          `UPDATE exams SET published_version=?,starts_at=?,ends_at=?,control='normal',updated_at=? WHERE id=? AND draft_version=? AND (starts_at IS NULL OR starts_at>${DB_NOW})`,
          version,
          start,
          end,
          now(),
          exam.id,
          version,
        ),
      );
      statements.push(
        stmt(
          db,
          "UPDATE attempts SET version=?,deadline_at=? WHERE exam_id=? AND status='waiting' AND EXISTS(SELECT 1 FROM exams e WHERE e.id=attempts.exam_id AND e.published_version=? AND e.starts_at=? AND e.ends_at=?)",
          version,
          end,
          exam.id,
          version,
          start,
          end,
        ),
      );
      await db.batch(statements);
      const scheduled = await getExam(db, exam.id);
      if (
        scheduled.published_version !== version ||
        scheduled.starts_at !== start ||
        scheduled.ends_at !== end
      )
        fail(
          409,
          "draft_conflict",
          "The draft or schedule changed before this request completed. Reload and review it.",
        );
      await audit(db, identity.email, "scheduled", exam.id, null, {
        version,
        start,
        end,
        reason,
      });
      return json(await detailExam(db, scheduled));
    }
    if (request.method === "POST" && action === "control") {
      const data = await body(request);
      if (
        data.confirmed !== true ||
        !["pause", "resume", "cancel"].includes(data.action)
      )
        fail(
          400,
          "confirmation_required",
          "Confirm the examination control action.",
        );
      const reason = text(data.reason, 2000, "reason");
      const control = {
        pause: "paused",
        resume: "normal",
        cancel: "cancelled",
      }[data.action];
      if (exam.control === "cancelled" && data.action !== "cancel")
        fail(
          409,
          "cancelled",
          "A cancelled examination cannot be reopened. Its records remain preserved.",
        );
      const result = await run(
        db,
        "UPDATE exams SET control=?,updated_at=? WHERE id=? AND slug IN ('practice','official')",
        control,
        now(),
        exam.id,
      );
      if (!changes(result))
        fail(
          409,
          "archived_read_only",
          "This examination was archived before the action completed.",
        );
      await audit(db, identity.email, data.action, exam.id, null, { reason });
      return json(await detailExam(db, await getExam(db, exam.id)));
    }
    if (request.method === "GET" && action === "attempts") {
      await audit(db, identity.email, "attempt_list_read", exam.id);
      const search = (url.searchParams.get("search") || "").slice(0, 160),
        cursor = url.searchParams.get("cursor") || "",
        limit = 50;
      const rows = await all(
        db,
        `SELECT a.*,(SELECT COUNT(*) FROM questions q WHERE q.exam_id=a.exam_id AND q.version=a.version) question_count,(SELECT COUNT(*) FROM answers an WHERE an.attempt_id=a.id AND length(trim(an.text))>0) answered_count,(SELECT CASE WHEN COUNT(*)=0 THEN 'pending' WHEN SUM(status='sent')=COUNT(*) THEN 'sent' WHEN SUM(status='failed')>0 THEN 'failed' ELSE 'pending' END FROM outbox o WHERE o.attempt_id=a.id) backup_status FROM attempts a WHERE a.exam_id=? AND (a.name LIKE ? OR a.email LIKE ? OR a.id LIKE ?) AND a.id>? ORDER BY a.id LIMIT ?`,
        exam.id,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        cursor,
        limit + 1,
      );
      return json({
        attempts: rows.slice(0, limit).map(publicAttempt),
        next_cursor: rows.length > limit ? rows[limit - 1].id : null,
      });
    }
    if (request.method === "GET" && action === "backups") {
      await audit(db, identity.email, "delivery_status_read", exam.id);
      const after = eventCursor(url.searchParams.get("cursor")),
        status = url.searchParams.get("status") || "";
      if (
        status &&
        !["pending", "processing", "sent", "failed"].includes(status)
      )
        fail(400, "invalid_status", "Choose a valid delivery status.");
      const jobs = await all(
        db,
        "SELECT id,target,status,attempt_id,attempts,last_error,next_attempt_at,reference,sent_at,created_at FROM outbox WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id=?) AND (?='' OR status=?) AND (?=0 OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 101",
        exam.id,
        status,
        status,
        after.time,
        after.time,
        after.time,
        after.id,
      );
      const counts = await all(
          db,
          "SELECT status,COUNT(*) count FROM outbox WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id=?) GROUP BY status",
          exam.id,
        ),
        summary = { pending: 0, processing: 0, sent: 0, failed: 0 };
      for (const row of counts) summary[row.status] = row.count;
      return json({
        jobs: jobs.slice(0, 100),
        next_cursor:
          jobs.length > 100 ? `${jobs[99].created_at}:${jobs[99].id}` : null,
        summary,
        configuration: {
          r2: !!env.EXAM_BACKUPS,
          sheets: !!(
            env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_SPREADSHEET_ID
          ),
          email: !!(
            env.EMAIL_DELIVERY_ENABLED === "true" &&
            env.RESEND_API_KEY &&
            env.EXAM_EMAIL_FROM
          ),
          privateAdmin: !!env.ACCESS_AUD,
        },
      });
    }
    if (request.method === "GET" && action === "events") {
      await audit(db, identity.email, "events_read", exam.id);
      return json(
        await eventPage(
          db,
          exam.id,
          (url.searchParams.get("attempt_id") || "").slice(0, 100),
          (url.searchParams.get("search") || "").slice(0, 160),
          url.searchParams.get("cursor"),
        ),
      );
    }
    if (request.method === "GET" && action === "export.csv") {
      await audit(db, identity.email, "answers_exported", exam.id);
      const columns = [
        "attempt_id",
        "name",
        "email",
        "status",
        "started_at",
        "deadline_at",
        "finalized_at",
        "finalization_type",
        "question_number",
        "question_text",
        "answer",
        "revision",
        "hash",
        "saved_at",
        "receipt_id",
        "checksum",
      ];
      const encoder = new TextEncoder(),
        exportStartedAt = now();
      let cursorId = "",
        cursorNumber = 0,
        headerSent = false;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            if (!headerSent) {
              controller.enqueue(
                encoder.encode("\uFEFF" + columns.map(csvCell).join(",")),
              );
              headerSent = true;
              return;
            }
            const rows = await all(
              db,
              `SELECT a.id attempt_id,a.name,a.email,a.status,a.started_at,a.deadline_at,a.finalized_at,a.finalization_type,q.number question_number,q.text question_text,COALESCE(f.text,an.text,'') answer,COALESCE(f.revision,an.revision,0) revision,COALESCE(f.hash,an.hash,'') hash,COALESCE(f.saved_at,an.saved_at) saved_at,s.receipt_id,s.checksum FROM attempts a JOIN questions q ON q.exam_id=a.exam_id AND q.version=a.version LEFT JOIN answers an ON an.attempt_id=a.id AND an.question_id=q.id LEFT JOIN final_answers f ON f.attempt_id=a.id AND f.question_id=q.id LEFT JOIN submissions s ON s.attempt_id=a.id WHERE a.exam_id=? AND a.created_at<=? AND (a.id>? OR (a.id=? AND q.number>?)) ORDER BY a.id,q.number LIMIT 25`,
              exam.id,
              exportStartedAt,
              cursorId,
              cursorId,
              cursorNumber,
            );
            if (!rows.length) {
              controller.close();
              return;
            }
            controller.enqueue(
              encoder.encode(
                "\r\n" +
                  rows
                    .map((row) => columns.map((k) => csvCell(row[k])).join(","))
                    .join("\r\n"),
              ),
            );
            const last = rows[rows.length - 1];
            cursorId = last.attempt_id;
            cursorNumber = last.question_number;
          } catch {
            controller.error(
              new Error("The export could not be completed. Please retry."),
            );
          }
        },
      });
      return new Response(stream, {
        headers: {
          ...securityHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exam.slug}-responses.csv"`,
        },
      });
    }
  }
  if (parts[0] === "attempts" && parts[1]) {
    let attempt = await one(db, "SELECT * FROM attempts WHERE id=?", parts[1]);
    if (!attempt)
      fail(404, "attempt_not_found", "This attempt does not exist.");
    const exam = await getExam(db, attempt.exam_id);
    attempt = await refreshAttempt(db, attempt, exam);
    if (request.method === "GET" && !parts[2]) {
      await audit(db, identity.email, "attempt_read", exam.id, attempt.id);
      const observed = await all(
        db,
        "SELECT type,details_json FROM events WHERE attempt_id=? AND type IN ('local_save','offline','reconnect')",
        attempt.id,
      );
      const readiness = {
        registered: true,
        typing: !!(await one(
          db,
          "SELECT 1 FROM answer_operations WHERE attempt_id=? AND length(trim(text))>0 LIMIT 1",
          attempt.id,
        )),
        local_save: observed.some(
          (e) =>
            e.type === "local_save" &&
            parseJson(e.details_json).durable === true,
        ),
        server_save: attempt.last_saved_at != null,
        disconnect: observed.some((e) => e.type === "offline"),
        reconnect: observed.some((e) => e.type === "reconnect"),
        finalized: attempt.status === "finalized",
      };
      return json({
        attempt: publicAttempt(attempt),
        readiness,
        questions: await all(
          db,
          "SELECT id,number,text,instructions,points FROM questions WHERE exam_id=? AND version=? ORDER BY number",
          exam.id,
          attempt.version,
        ),
        answers: await all(
          db,
          `SELECT question_id,revision,text,hash,saved_at FROM ${attempt.status === "finalized" ? "final_answers" : "answers"} WHERE attempt_id=?`,
          attempt.id,
        ),
        recovered_drafts: await all(
          db,
          "SELECT * FROM recovered_drafts WHERE attempt_id=? ORDER BY received_at",
          attempt.id,
        ),
        receipt: await receipt(db, attempt),
        backups: await all(
          db,
          "SELECT id,target,status,attempts,last_error,next_attempt_at,reference FROM outbox WHERE attempt_id=? ORDER BY created_at DESC LIMIT 100",
          attempt.id,
        ),
      });
    }
    if (request.method === "GET" && parts[2] === "events") {
      await audit(db, identity.email, "events_read", exam.id, attempt.id);
      return json(
        await eventPage(
          db,
          exam.id,
          attempt.id,
          (url.searchParams.get("search") || "").slice(0, 160),
          url.searchParams.get("cursor"),
        ),
      );
    }
    if (request.method === "POST" && parts[2] === "recovery") {
      if (!["practice", "official"].includes(exam.slug))
        fail(
          403,
          "archived_read_only",
          "Archived attempts remain available to examiners; student recovery is unavailable.",
        );
      const data = await body(request);
      if (data.confirmed !== true)
        fail(
          400,
          "confirmation_required",
          "Confirm recovery of the existing attempt.",
        );
      const reason = text(data.reason, 2000, "recovery reason");
      const raw = token(),
        expires = now() + 600000;
      await db.batch([
        stmt(
          db,
          "UPDATE recovery_tokens SET consumed_at=? WHERE attempt_id=? AND consumed_at IS NULL",
          now(),
          attempt.id,
        ),
        stmt(
          db,
          "INSERT INTO recovery_tokens(token_hash,attempt_id,expires_at,created_by) VALUES(?,?,?,?)",
          await hash(raw),
          attempt.id,
          expires,
          identity.email,
        ),
      ]);
      await audit(
        db,
        identity.email,
        "recovery_authorized",
        exam.id,
        attempt.id,
        { reason, deadlineUnchanged: attempt.deadline_at },
      );
      return json({
        recovery_url: `${url.origin}${adminExam(exam).student_url}#recover=${raw}`,
        recovery_code: raw,
        expires_at: iso(expires),
        deadline_at: iso(attempt.deadline_at),
      });
    }
    if (request.method === "POST" && parts[2] === "practice-reset") {
      const data = await body(request);
      if (exam.kind !== "practice")
        fail(
          403,
          "official_reset_denied",
          "Official attempts cannot be reset. Their answers and original deadline remain preserved.",
        );
      if (data.confirmed !== true)
        fail(400, "confirmation_required", "Confirm this practice reset.");
      const reason = text(data.reason, 2000, "reset reason");
      await db.batch([
        stmt(db, "DELETE FROM sessions WHERE attempt_id=?", attempt.id),
        stmt(
          db,
          "UPDATE recovery_tokens SET consumed_at=? WHERE attempt_id=? AND consumed_at IS NULL",
          now(),
          attempt.id,
        ),
        stmt(
          db,
          "UPDATE attempts SET registration_hash=?,lease_editor=NULL,lease_expires_at=0 WHERE id=?",
          `reset:${id()}`,
          attempt.id,
        ),
      ]);
      await audit(db, identity.email, "practice_reset", exam.id, attempt.id, {
        reason,
        oldDeadlinePreserved: attempt.deadline_at,
        oldAnswersPreserved: true,
      });
      return json({
        reset: true,
        student_url: adminExam(exam).student_url,
        previous_attempt_id: attempt.id,
      });
    }
  }
  if (
    request.method === "POST" &&
    parts[0] === "jobs" &&
    parts[1] &&
    parts[2] === "retry"
  ) {
    await body(request);
    const job = await one(
      db,
      "SELECT status,lease_until FROM outbox WHERE id=?",
      parts[1],
    );
    if (job?.status === "processing" && job.lease_until > now())
      fail(
        409,
        "delivery_in_progress",
        "This backup is already being delivered. Wait for its current attempt before retrying.",
      );
    const result = await run(
      db,
      `UPDATE outbox SET status='pending',next_attempt_at=?,lease_until=0,last_error=NULL,claim_token=NULL WHERE id=? AND status!='sent' AND (status!='processing' OR lease_until<=${DB_NOW})`,
      now(),
      parts[1],
    );
    await audit(db, identity.email, "delivery_retry", null, null, {
      jobId: parts[1],
    });
    return json({ queued: changes(result) > 0 });
  }
  fail(404, "route_not_found", "This examiner action does not exist.");
}

export async function buildDeliveryPayload(db, job) {
  const attempt = await one(
      db,
      "SELECT * FROM attempts WHERE id=?",
      job.attempt_id,
    ),
    exam = await one(db, "SELECT * FROM exams WHERE id=?", attempt.exam_id);
  const questions = await all(
    db,
    "SELECT id,number,text,instructions,points FROM questions WHERE exam_id=? AND version=? ORDER BY number",
    exam.id,
    attempt.version,
  );
  const rows = await all(
    db,
    `SELECT question_id questionId,revision,text,hash,saved_at savedAt FROM ${job.kind === "final" ? "final_answers" : "answers"} WHERE attempt_id=?`,
    attempt.id,
  );
  const answers = questions.map(
    (q) =>
      rows.find((a) => a.questionId === q.id) || {
        questionId: q.id,
        revision: 0,
        text: "",
        hash: "",
        savedAt: null,
      },
  );
  return {
    schemaVersion: 1,
    exam: { id: exam.id, slug: exam.slug, title: exam.title },
    attempt: {
      id: attempt.id,
      name: attempt.name,
      email: attempt.email,
      startedAt: attempt.started_at,
      deadlineAt: attempt.deadline_at,
      status: attempt.status,
      finalizedAt: attempt.finalized_at,
    },
    questions,
    answers,
    receipt: await receipt(db, attempt),
  };
}
export async function drainOutbox(env, limit = 20, deliver = deliverJob) {
  const db = env.EXAM_DB;
  const jobs = await all(
    db,
    `SELECT * FROM outbox WHERE status IN ('pending','failed','processing') AND next_attempt_at<=${DB_NOW} AND lease_until<=${DB_NOW} ORDER BY CASE kind WHEN 'final' THEN 0 ELSE 1 END,created_at LIMIT ?`,
    limit,
  );
  for (const job of jobs) {
    const claimToken = id();
    const claim = await run(
      db,
      `UPDATE outbox SET status='processing',lease_until=${DB_NOW}+180000,attempts=attempts+1,claim_token=? WHERE id=? AND status IN ('pending','failed','processing') AND lease_until<=${DB_NOW} AND NOT EXISTS(SELECT 1 FROM outbox other WHERE other.id<>outbox.id AND other.attempt_id=outbox.attempt_id AND other.target=outbox.target AND other.status='processing' AND other.lease_until>${DB_NOW})`,
      claimToken,
      job.id,
    );
    if (!changes(claim)) continue;
    try {
      const payload = await buildDeliveryPayload(db, job),
        result = await deliver({ ...job, payload }, env);
      await run(
        db,
        "UPDATE outbox SET status='sent',sent_at=?,lease_until=0,last_error=NULL,reference=?,claim_token=NULL WHERE id=? AND claim_token=?",
        now(),
        result?.reference || null,
        job.id,
        claimToken,
      );
    } catch (error) {
      const retry =
        now() + Math.min(6 * 3600000, 30000 * 2 ** Math.min(job.attempts, 10));
      // Provider diagnostics may contain private content. Store only an error category.
      const safeError =
        String(error?.code || error?.name || "DeliveryError")
          .replace(/[^a-zA-Z0-9_ -]/g, "")
          .slice(0, 100) || "DeliveryError";
      await run(
        db,
        "UPDATE outbox SET status='failed',next_attempt_at=?,lease_until=0,last_error=?,claim_token=NULL WHERE id=? AND claim_token=?",
        retry,
        safeError,
        job.id,
        claimToken,
      );
    }
  }
  return jobs.length;
}
export async function maintenance(env) {
  const db = env.EXAM_DB;
  await run(
    db,
    "DELETE FROM registration_windows WHERE window_start<?",
    now() - 600000,
  );
  const gaps = await all(
    db,
    `SELECT * FROM attempts WHERE status IN ('waiting','active') AND last_seen_at<${DB_NOW}-45000 LIMIT 200`,
  );
  for (const attempt of gaps)
    await recordEvent(
      db,
      attempt,
      "heartbeat_missing",
      {
        lastServerContactAt: attempt.last_seen_at,
        gapDetectedAt: now(),
        cause: "unknown",
        assessment: "Connection/heartbeat uncertain; examiner review only",
      },
      `heartbeat-gap-${attempt.id}-${attempt.last_seen_at}`,
    );
  const expired = await all(
    db,
    `SELECT * FROM attempts WHERE status IN ('waiting','active') AND deadline_at<=${DB_NOW} LIMIT 200`,
  );
  for (const attempt of expired) await finish(db, attempt, "deadline");
  const incomplete = await all(
    db,
    "SELECT a.* FROM attempts a JOIN submissions s ON s.attempt_id=a.id JOIN exams e ON e.id=a.exam_id WHERE a.status='finalized' AND (s.checksum IS NULL OR (SELECT COUNT(*) FROM outbox o WHERE o.attempt_id=a.id AND o.kind='final')<CASE WHEN e.kind='official' THEN 4 ELSE 2 END) LIMIT 200",
  );
  for (const attempt of incomplete)
    await finish(db, attempt, attempt.finalization_type || "deadline");
  // Reconcile the small crash window between a committed answer and enqueueing backups.
  const unmirrored = await all(
    db,
    "SELECT a.* FROM attempts a WHERE a.last_saved_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.attempt_id=a.id) LIMIT 100",
  );
  for (const attempt of unmirrored)
    for (const target of ["r2", "sheets"])
      await enqueue(
        db,
        attempt.id,
        target,
        "snapshot",
        `reconcile:${attempt.id}:${attempt.last_saved_at}:${target}`,
      );
  await drainOutbox(env);
}
export function createApp(options = {}) {
  const adminAuthenticator =
    options.adminAuthenticator ||
    options.authenticateAdmin ||
    authenticateAdmin;
  return {
    async fetch(request, env, ctx) {
      try {
        sameOrigin(request);
        const url = new URL(request.url),
          path = url.pathname;
        if (path === "/api/health")
          return json({
            service: "constitutional-exam",
            database: !!env.EXAM_DB,
            privateBackup: !!env.EXAM_BACKUPS,
            serverTime: now(),
          });
        if (path.startsWith("/api/")) {
          if (!env.EXAM_DB)
            fail(
              503,
              "database_unavailable",
              "The examination service is unavailable. Writing saved in this browser is preserved; retry shortly.",
            );
          if (path.startsWith("/api/admin/")) {
            const identity = await adminAuthenticator(request, env);
            return await adminApi(request, env, path.slice(11), identity);
          }
          const match = path.match(/^\/api\/exams\/([^/]+)\/(.+)$/);
          if (match) {
            const response = await studentApi(request, env, match[1], match[2]);
            if (match[2] === "submit" && response.ok && ctx?.waitUntil)
              ctx.waitUntil(drainOutbox(env, 8));
            return response;
          }
          fail(404, "route_not_found", "This address does not exist.");
        }
        if (path.startsWith("/admin")) {
          await adminAuthenticator(request, env);
          if (
            ![
              "/admin/exams",
              "/admin.html",
              "/admin.mjs",
              "/admin.css",
            ].includes(path)
          )
            fail(404, "route_not_found", "This address does not exist.");
        }
        if (!env.ASSETS)
          return json(
            {
              error: {
                code: "assets_unavailable",
                message: "The examination page is being prepared.",
              },
            },
            503,
          );
        const assetPath = ["/practice", "/official"].includes(path)
          ? "/index.html"
          : path === "/admin/exams"
            ? "/admin.html"
            : path;
        const assetRequest = new Request(new URL(assetPath, url), request),
          response = await env.ASSETS.fetch(assetRequest);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(securityHeaders))
          headers.set(key, value);
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch (error) {
        if (error instanceof ApiError)
          return json(
            {
              error: {
                code: error.code,
                message: error.message,
                ...error.extra,
              },
              serverTime: now(),
            },
            error.status,
          );
        // Never expose SQL diagnostics, tokens, student writing, or provider responses.
        return json(
          {
            error: {
              code: "service_unavailable",
              message:
                "The service could not complete this request. Your browser draft remains available. Please retry.",
            },
            serverTime: now(),
          },
          503,
        );
      }
    },
    async scheduled(controller, env, ctx) {
      ctx.waitUntil(maintenance(env));
    },
  };
}
export default createApp();
