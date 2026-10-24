import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./test-support.mjs";
import { createApp, maintenance } from "./worker.mjs";

// Public synthetic fixture only. Real deployment keys are generated privately.
const SECRET = "0123456789abcdef".repeat(4);
const SECOND_SECRET = "fedcba9876543210".repeat(4);
function fixture(extra = {}) {
  const db = createTestDatabase();
  const env = { EXAM_DB: db, ADMIN_AUTH_MODE: "password", ADMIN_LOGIN_SECRET: SECRET, ADMIN_EMAILS: "owner@example.invalid", ...extra };
  env.ASSETS = { fetch: async request => new Response(new URL(request.url).pathname, { headers: { "Content-Type": "text/plain" } }) };
  const app = createApp();
  const request = async (path, { method = "GET", data, cookie, origin = "https://exam.example.invalid", ip = "198.51.100.10", headers: additions = {} } = {}) => {
    const headers = new Headers({ "CF-Connecting-IP": ip, ...additions });
    if (method !== "GET" && origin !== null) headers.set("Origin", origin);
    if (data !== undefined) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);
    const response = await app.fetch(new Request(`https://exam.example.invalid${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }), env, {});
    const result = response.headers.get("Content-Type")?.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, response, data: result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = (secret = SECRET, options = {}) => request("/api/admin/login", { method: "POST", data: { secret }, ...options });
  const session = cookie => request("/api/admin/session", { cookie });
  return { db, env, app, request, login, session };
}
const use = fn => async () => { const f = fixture(); try { await fn(f); } finally { f.db.close(); } };

test("built-in login returns only an opaque one-hour Strict HttpOnly cookie and a verified owner identity", use(async f => {
  const login = await f.login();
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.identity, { email: "owner@example.invalid", role: "owner", auth_mode: "builtin" });
  assert.match(login.cookie, /^__Host-dd_exam_admin=[a-f0-9]{64}$/);
  assert.match(login.response.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=3600$/);
  assert.ok(new Date(login.data.expires_at).getTime() > Date.now() + 3590000);
  const token = login.cookie.split("=")[1];
  const stored = f.db.sqlite.prepare("SELECT * FROM admin_sessions").get();
  assert.equal(stored.token_hash.length, 64);
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.expires_at - stored.created_at, 3600000);
  assert.equal(JSON.stringify(login.data).includes(token), false);
  assert.equal(JSON.stringify(stored).includes(SECRET), false);
  const session = await f.session(login.cookie);
  assert.equal(session.status, 200);
  assert.equal(session.data.expires_at, login.data.expires_at);
  assert.equal(session.data.identity.auth_mode, "builtin");
  assert.equal((await f.request("/api/admin/exams", { cookie: login.cookie })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT action FROM admin_audit").get().action, "admin_signed_in");
  assert.equal(JSON.stringify(f.db.sqlite.prepare("SELECT * FROM admin_audit").all()).includes(token), false);
}));

test("anonymous, forged and secret-in-query requests cannot obtain an examiner session", use(async f => {
  const anonymous = await f.request("/api/admin/exams");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.data.error.auth_mode, "builtin");
  for (const cookie of ["__Host-dd_exam_admin=forged", `__Host-dd_exam_admin=${"a".repeat(64)}`])
    assert.equal((await f.session(cookie)).status, 401);
  for (const secret of ["wrong", "", null, 1, { value: SECRET }]) {
    const failure = await f.login(secret);
    assert.equal(failure.status, 401);
    assert.equal(failure.data.error.code, "admin_sign_in_failed");
    assert.equal(failure.cookie, undefined);
  }
  assert.equal((await f.request(`/api/admin/login?secret=${SECRET}`, { method: "POST", data: {} })).status, 401);
  assert.equal((await f.request("/api/admin/login", { method: "GET" })).status, 405);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
}));

test("only dedicated login assets are public; private modules, imports and document readers remain protected", use(async f => {
  for (const path of ["/admin/login", "/admin-login.html", "/admin-login.mjs", "/admin-login.css"])
    assert.equal((await f.request(path)).status, 200, path);
  const entry = await f.request("/admin/exams");
  assert.equal(entry.status, 303);
  assert.equal(entry.response.headers.get("Location"), "/admin/login");
  for (const path of ["/admin.mjs", "/admin.css", "/import.mjs", "/document-import.mjs", "/document-vendor/pdf.mjs", "/document-vendor/licenses/pdfjs-dist-LICENSE", "/%61dmin.mjs"])
    assert.equal((await f.request(path)).status, 401, path);
  const login = await f.login();
  for (const path of ["/admin.mjs", "/document-import.mjs", "/document-vendor/pdf.worker.mjs"])
    assert.equal((await f.request(path, { cookie: login.cookie })).status, 200, path);
  const signedIn = await f.request("/admin/login", { cookie: login.cookie });
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.response.headers.get("Location"), "/admin/exams");
  assert.equal((await f.request("/admin-login.mjs/private-secret")).status, 401);
}));

test("expiry and secret rotation invalidate an old cookie without extending sessions on reads", use(async f => {
  const login = await f.login();
  const before = f.db.sqlite.prepare("SELECT expires_at FROM admin_sessions").get().expires_at;
  await f.session(login.cookie);
  assert.equal(f.db.sqlite.prepare("SELECT expires_at FROM admin_sessions").get().expires_at, before);
  f.env.ADMIN_LOGIN_SECRET = SECOND_SECRET;
  assert.equal((await f.session(login.cookie)).status, 401);
  assert.equal((await f.login(SECRET)).status, 401);
  const replacement = await f.login(SECOND_SECRET);
  assert.equal(replacement.status, 200);
  f.db.sqlite.exec("UPDATE admin_sessions SET expires_at=0");
  assert.equal((await f.session(replacement.cookie)).status, 401);
}));

test("re-login rotates only the current browser credential, and logout revokes replay without signing out another browser", use(async f => {
  const first = await f.login(), other = await f.login();
  assert.notEqual(first.cookie, other.cookie);
  const rotated = await f.login(SECRET, { cookie: first.cookie });
  assert.notEqual(rotated.cookie, first.cookie);
  assert.equal((await f.session(first.cookie)).status, 401);
  assert.equal((await f.session(other.cookie)).status, 200);
  const logout = await f.request("/api/admin/logout", { method: "POST", cookie: rotated.cookie, data: {} });
  assert.equal(logout.status, 200);
  assert.equal(logout.data.signed_out, true);
  assert.match(logout.response.headers.get("Set-Cookie"), /SameSite=Strict; Path=\/; Max-Age=0$/);
  assert.equal((await f.session(rotated.cookie)).status, 401);
  assert.equal((await f.request("/api/admin/exams", { cookie: rotated.cookie })).status, 401);
  assert.equal((await f.session(other.cookie)).status, 200);
  assert.equal((await f.request("/api/admin/logout", { method: "POST", data: {} })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='admin_signed_out'").get().n, 1);
}));

test("exact Origin and cross-site protections apply to login, logout and all privileged writes", use(async f => {
  for (const origin of ["https://other.example.invalid", "null", null])
    assert.equal((await f.login(SECRET, { origin })).status, 403);
  assert.equal((await f.login(SECRET, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
  const login = await f.login();
  assert.equal((await f.request("/api/admin/logout", { method: "POST", cookie: login.cookie, data: {}, origin: "https://other.example.invalid" })).status, 403);
  assert.equal((await f.session(login.cookie)).status, 200);
  assert.equal((await f.request("/api/admin/exams/create", { method: "POST", cookie: login.cookie, data: {}, origin: "https://other.example.invalid" })).status, 403);
}));

test("non-local sign-in requires HTTPS before serving the login page or processing a credential", use(async f => {
  const entry = await f.app.fetch(new Request("http://exam.example.invalid/admin/login"), f.env, {});
  assert.equal(entry.status, 303);
  assert.equal(entry.headers.get("Location"), "https://exam.example.invalid/admin/login");
  const login = await f.app.fetch(new Request("http://exam.example.invalid/api/admin/login", { method: "POST", headers: { Origin: "http://exam.example.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ secret: SECRET }) }), f.env, {});
  assert.equal(login.status, 403);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
}));

test("failed sign-ins are bounded per hashed IP and a valid random key remains usable after a guessing burst", use(async f => {
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await f.login("wrong-key")).status, 401);
  const limited = await f.login("wrong-key");
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.retry_after_seconds, 600);
  assert.equal(limited.response.headers.get("Retry-After"), "600");
  assert.equal((await f.login()).status, 200);
  const rows = f.db.sqlite.prepare("SELECT * FROM admin_login_windows").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.key_hash.length === 64 && row.failures <= 101));
  assert.equal(JSON.stringify(rows).includes("198.51.100.10"), false);
  assert.equal(JSON.stringify(rows).includes("wrong-key"), false);
}));

test("global guessing budget caps distributed-network rows and counter growth under concurrent failures", use(async f => {
  const failures = await Promise.all(Array.from({ length: 120 }, (_, index) => f.login("wrong-key", { ip: `198.51.100.${index}` })));
  assert.ok(failures.every(result => [401, 429].includes(result.status)));
  assert.ok(failures.some(result => result.status === 429));
  const rows = f.db.sqlite.prepare("SELECT * FROM admin_login_windows").all();
  assert.ok(rows.length <= 101);
  assert.ok(rows.every(row => row.failures <= 101));
  assert.equal((await f.login("wrong-key", { ip: "203.0.113.240" })).status, 429);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_login_windows").get().n, rows.length);
  const writes = f.db.sqlite.prepare("SELECT total_changes() n").get().n;
  for (let index = 0; index < 20; index++)
    assert.equal((await f.login("wrong-key", { ip: `203.0.113.${index}` })).status, 429);
  assert.equal(f.db.sqlite.prepare("SELECT total_changes() n").get().n, writes, "Exhausted guessing budget must not keep consuming row writes");
  assert.equal((await f.login(SECRET, { ip: "203.0.113.241" })).status, 200);
}));

test("authentication modes are explicit and an Access header cannot authorize built-in owner access", use(async f => {
  assert.equal((await f.request("/api/admin/exams", { headers: { "Cf-Access-Jwt-Assertion": "forged.jwt.value", "Cf-Access-Authenticated-User-Email": "owner@example.invalid" } })).status, 401);
  const builtin = await f.login();
  f.env.ADMIN_AUTH_MODE = "access";
  f.env.ACCESS_TEAM_DOMAIN = "https://synthetic.cloudflareaccess.com";
  f.env.ACCESS_AUD = "synthetic-audience";
  assert.equal((await f.session(builtin.cookie)).status, 401);
  assert.equal((await f.login()).status, 409);
  delete f.env.ADMIN_AUTH_MODE;
  assert.equal((await f.login()).status, 409); // Access remains the compatibility default.
  f.env.ADMIN_AUTH_MODE = "unknown-mode";
  assert.equal((await f.request("/api/admin/exams")).status, 503);
}));

test("weak or missing configuration and an oversized login body fail closed", use(async f => {
  for (const secret of [undefined, "ordinary-password", "a".repeat(64)]) {
    f.env.ADMIN_LOGIN_SECRET = secret;
    assert.equal((await f.login()).status, 503);
    assert.equal((await f.request("/api/admin/exams")).status, 503);
  }
  f.env.ADMIN_LOGIN_SECRET = SECRET;
  assert.equal((await f.login("x".repeat(5000))).status, 413);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
}));

test("session rotation and its audit are atomic when the database fails", use(async f => {
  const original = await f.login();
  const batch = f.db.batch;
  f.db.batch = statements => {
    if (statements.some(statement => statement.sql.startsWith("INSERT INTO admin_sessions")))
      return batch([...statements.slice(0, 2), f.db.prepare("INSERT INTO missing_admin_test_table VALUES(1)")]);
    return batch(statements);
  };
  const failed = await f.login(SECRET, { cookie: original.cookie });
  assert.equal(failed.status, 503);
  assert.equal(failed.cookie, undefined);
  f.db.batch = batch;
  assert.equal((await f.session(original.cookie)).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit").get().n, 1);
}));

test("expired session cleanup preserves sign-in audit records and student answers", use(async f => {
  const student = await f.request("/api/exams/practice/attempt", { method: "POST", data: { name: "Synthetic Student", email: "student@example.invalid", consent: true, oneBrowser: true, editorId: "student-editor", registrationId: crypto.randomUUID() } });
  assert.equal(student.status, 201);
  const answer = "The student's exact original answer survives staff-session cleanup.";
  assert.equal((await f.request("/api/exams/practice/answers/practice-v1-q1", { method: "PUT", cookie: student.cookie, data: { operationId: crypto.randomUUID(), editorId: "student-editor", revision: 1, text: answer } })).status, 200);
  await f.login();
  f.db.sqlite.exec("UPDATE admin_sessions SET expires_at=0; INSERT INTO admin_login_windows VALUES('old-window',0,1)");
  await maintenance(f.env);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_login_windows").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='admin_signed_in'").get().n, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM exams").get().n, 2);
  assert.equal(f.db.sqlite.prepare("SELECT text FROM answers").get().text, answer);
  assert.equal(f.db.sqlite.prepare("SELECT text FROM answer_operations").get().text, answer);
}));

test("the additive administrator migration is safely repeatable and preserves existing records", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("CREATE TABLE retained_student_answers(text TEXT); INSERT INTO retained_student_answers VALUES('Preserved original answer');");
    const migration = readFileSync(new URL("./migrations/0003_admin_login.sql", import.meta.url), "utf8");
    sqlite.exec(migration);
    sqlite.exec(migration);
    assert.equal(sqlite.prepare("SELECT text FROM retained_student_answers").get().text, "Preserved original answer");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
  } finally { sqlite.close(); }
});
