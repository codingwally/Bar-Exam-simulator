import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./test-support.mjs";
import { createApp } from "./worker.mjs";

const secret = "0123456789abcdef".repeat(4),
  spreadsheet = "synthetic_private_sheet_id_1234567890";

function fixture(extra = {}) {
  const db = createTestDatabase(),
    env = {
      EXAM_DB: db,
      ADMIN_AUTH_MODE: "password",
      ADMIN_LOGIN_SECRET: secret,
      ADMIN_EMAILS: "owner@example.invalid",
      ASSETS: { fetch: async request => new Response(new URL(request.url).pathname) },
      ...extra,
    },
    app = createApp();
  const request = async (path, { method = "GET", data, cookie } = {}) => {
    const headers = new Headers();
    if (method !== "GET") headers.set("Origin", "https://exam.example.invalid");
    if (data !== undefined) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);
    const response = await app.fetch(new Request(`https://exam.example.invalid${path}`, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    }), env, {});
    const result = response.headers.get("Content-Type")?.includes("application/json")
      ? await response.json() : await response.text();
    return { response, status: response.status, data: result,
      cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = () => request("/api/admin/login", { method: "POST", data: { secret } });
  const configuration = async cookie => {
    const result = await request("/api/admin/exams/practice/backups", { cookie });
    assert.equal(result.status, 200);
    return result.data.configuration;
  };
  return { db, env, request, login, configuration };
}

test("private workbook destination is readable only by an authenticated examiner and reveals no credentials", async () => {
  const f = fixture({ GOOGLE_SPREADSHEET_ID: spreadsheet, EXAM_RELAY_SECRET: "private-relay-credential" });
  try {
    const anonymous = await f.request("/api/admin/exams/practice/backups");
    assert.equal(anonymous.status, 401);
    assert.equal(JSON.stringify(anonymous.data).includes(spreadsheet), false);
    const login = await f.login();
    assert.equal(login.status, 200);
    const config = await f.configuration(login.cookie);
    assert.equal(config.spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${spreadsheet}/edit`);
    assert.equal(config.sheets, false);
    assert.equal(config.email, false);
    assert.equal(config.studentReceipt, false);
    assert.equal(JSON.stringify(config).includes("private-relay-credential"), false);
    for (const path of ["/api/health", "/api/exams/practice/state"])
      assert.equal(JSON.stringify((await f.request(path)).data).includes(spreadsheet), false, path);
  } finally { f.db.close(); }
});

test("invalid spreadsheet identifiers never become clickable workbook destinations", async () => {
  const f = fixture();
  try {
    const login = await f.login();
    for (const id of [undefined, "short", "x".repeat(201), "../../private", "https://docs.google.com/spreadsheets/d/id", "synthetic_private_id?redirect=elsewhere"] ) {
      f.env.GOOGLE_SPREADSHEET_ID = id;
      assert.equal((await f.configuration(login.cookie)).spreadsheetUrl, null, String(id));
    }
    for (const id of ["A".repeat(20), spreadsheet, "b".repeat(200)]) {
      f.env.GOOGLE_SPREADSHEET_ID = id;
      assert.equal((await f.configuration(login.cookie)).spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${id}/edit`);
    }
  } finally { f.db.close(); }
});

test("owner relay capability and official student email capability remain distinct", async () => {
  const f = fixture({
    EMAIL_DELIVERY_ENABLED: "true",
    EXAM_RELAY_URL: "https://script.google.com/macros/s/synthetic/exec",
    EXAM_RELAY_SECRET: "synthetic-relay-key",
  });
  try {
    const login = await f.login();
    let config = await f.configuration(login.cookie);
    assert.equal(config.sheets, true);
    assert.equal(config.email, true);
    assert.equal(config.studentReceipt, false);
    f.env.RESEND_API_KEY = "synthetic-email-provider-key";
    assert.equal((await f.configuration(login.cookie)).studentReceipt, false);
    f.env.EXAM_EMAIL_FROM = "owner@example.invalid";
    config = await f.configuration(login.cookie);
    assert.equal(config.studentReceipt, true);
    assert.equal(JSON.stringify(config).includes(f.env.RESEND_API_KEY), false);
    f.env.EMAIL_DELIVERY_ENABLED = "false";
    config = await f.configuration(login.cookie);
    assert.equal(config.email, false);
    assert.equal(config.studentReceipt, false);
  } finally { f.db.close(); }
});

test("public PDF exporter assets do not open the private professor document readers or Worker source", async () => {
  const f = fixture();
  try {
    for (const path of ["/answer-pdf.mjs", "/pdf-vendor/pdf.mjs", "/fonts/inter-pdf.ttf", "/fonts/fraunces-pdf.ttf"]) {
      const result = await f.request(path);
      assert.equal(result.status, 200, path);
      assert.equal(result.data, path);
      assert.match(result.response.headers.get("Content-Security-Policy"), /script-src 'self'/);
      assert.match(result.response.headers.get("Cache-Control"), /no-store/);
    }
    for (const path of ["/admin.mjs", "/document-import.mjs", "/document-vendor/pdf.mjs", "/%61dmin.mjs"])
      assert.equal((await f.request(path)).status, 401, path);
    for (const path of ["/worker.mjs", "/delivery.mjs", "/pdf-vendor/private/secret.mjs", "/pdf-vendor/%2e%2e%2fworker.mjs"])
      assert.equal((await f.request(path)).status, 404, path);
  } finally { f.db.close(); }
});
