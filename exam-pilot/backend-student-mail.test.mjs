import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./test-support.mjs";
import { createApp, buildDeliveryPayload, drainOutbox, maintenance } from "./worker.mjs";

const ORIGIN = "https://exam.example.invalid";
const SHEET = "synthetic_owner_only_sheet_123456789";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=123`;

function fixture() {
  const db = createTestDatabase();
  db.sqlite.prepare("INSERT INTO questions(id,exam_id,version,number,text,instructions) VALUES(?,'practice',1,2,?,'')")
    .run("practice-v1-q2", "Synthetic second question, left blank in the submission.");
  const env = { EXAM_DB: db, GOOGLE_SPREADSHEET_ID: SHEET };
  let identity = { email: "owner@example.invalid", role: "owner" };
  const app = createApp({ authenticateAdmin: async () => identity });
  async function request(path, { method = "GET", data, cookie } = {}) {
    const headers = new Headers();
    if (method !== "GET") headers.set("Origin", ORIGIN);
    if (data !== undefined) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);
    const response = await app.fetch(new Request(ORIGIN + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    }), env, {});
    const result = await response.json();
    return { status: response.status, data: result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const register = () => request("/api/exams/practice/attempt", {
    method: "POST", data: { name: "Synthetic examinee", email: "examinee@example.invalid", consent: true, oneBrowser: true, editorId: "synthetic-editor", registrationId: crypto.randomUUID() },
  });
  const save = (cookie, text = "Preserved numbered answer.\nExact Unicode: ñ ₱ 中文 🙂") => request("/api/exams/practice/answers/practice-v1-q1", {
    method: "PUT", cookie, data: { operationId: crypto.randomUUID(), editorId: "synthetic-editor", revision: 1, text },
  });
  const submit = cookie => request("/api/exams/practice/submit", {
    method: "POST", cookie, data: { operationId: crypto.randomUUID(), editorId: "synthetic-editor" },
  });
  return { db, env, request, register, save, submit, as(role) { identity = { email: role === "owner" ? "owner@example.invalid" : "reviewer@example.invalid", role }; } };
}
const use = fn => async () => { const f = fixture(); try { await fn(f); } finally { f.db.close(); } };

test("practice submission queues exactly one student confirmation from the frozen blank-inclusive answer set", use(async f => {
  const registration = await f.register();
  assert.equal(registration.status, 201);
  assert.equal((await f.save(registration.cookie)).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='student_receipt'").get().n, 0, "In-progress writing must not produce a successful-submission email");
  const done = await f.submit(registration.cookie);
  assert.equal(done.status, 200);
  const receipt = done.data.attempt.receipt;
  assert.equal(receipt.questionCount, 2);
  assert.equal(receipt.answeredCount, 1);
  for (let i = 0; i < 4; i++) assert.deepEqual((await f.submit(registration.cookie)).data.attempt.receipt, receipt);
  const jobs = f.db.sqlite.prepare("SELECT * FROM outbox WHERE attempt_id=? AND kind='final' ORDER BY target").all(registration.data.attempt.id);
  assert.deepEqual(jobs.map(job => job.target), ["owner_email", "sheets", "student_receipt"]);
  const student = jobs.find(job => job.target === "student_receipt");
  const payload = await buildDeliveryPayload(f.db, student);
  assert.equal(payload.attempt.email, "examinee@example.invalid");
  assert.equal(payload.receipt.id, receipt.id);
  assert.deepEqual(payload.answers.map(answer => answer.text), ["Preserved numbered answer.\nExact Unicode: ñ ₱ 中文 🙂", ""]);
  assert.deepEqual(payload.questions.map(question => question.number), [1, 2]);
}));

test("student delivery payload excludes instructor source, question text and exam-wide instructions while owner archives retain them", use(async f => {
  f.db.sqlite.prepare("UPDATE exams SET source_text=?,source_name=?,instructions=? WHERE id='practice'")
    .run("PRIVATE_INSTRUCTOR_SOURCE", "PRIVATE_SOURCE_FILENAME.docx", "PRIVATE_INSTRUCTOR_INSTRUCTIONS");
  f.db.sqlite.prepare("UPDATE questions SET text=? WHERE id='practice-v1-q1'").run("PRIVATE_PAPER_QUESTION_TEXT");
  const registration = await f.register();
  await f.save(registration.cookie);
  await f.submit(registration.cookie);
  const jobs = f.db.sqlite.prepare("SELECT * FROM outbox WHERE kind='final'").all();
  const student = await buildDeliveryPayload(f.db, jobs.find(job => job.target === "student_receipt"));
  const serialized = JSON.stringify(student);
  assert.equal(Object.hasOwn(student, "source"), false);
  assert.equal(Object.hasOwn(student.exam, "instructions"), false);
  for (const marker of ["PRIVATE_INSTRUCTOR_SOURCE", "PRIVATE_SOURCE_FILENAME", "PRIVATE_INSTRUCTOR_INSTRUCTIONS", "PRIVATE_PAPER_QUESTION_TEXT", SHEET])
    assert.equal(serialized.includes(marker), false, marker);
  assert.deepEqual(student.questions.map(question => Object.keys(question).sort()), [["id", "number"], ["id", "number"]]);
  const owner = await buildDeliveryPayload(f.db, jobs.find(job => job.target === "owner_email"));
  assert.equal(owner.source.text, "PRIVATE_INSTRUCTOR_SOURCE");
  assert.equal(owner.exam.instructions, "PRIVATE_INSTRUCTOR_INSTRUCTIONS");
  assert.equal(owner.questions[0].text, "PRIVATE_PAPER_QUESTION_TEXT");
}));

test("maintenance repairs a missing practice student confirmation without replacing its receipt or duplicating jobs", use(async f => {
  const registration = await f.register();
  await f.save(registration.cookie);
  const done = await f.submit(registration.cookie);
  const receipt = done.data.attempt.receipt;
  const attemptId = registration.data.attempt.id;
  f.db.sqlite.prepare("DELETE FROM outbox WHERE attempt_id=? AND target='student_receipt'").run(attemptId);
  for (let i = 0; i < 3; i++) await maintenance(f.env);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE attempt_id=? AND target='student_receipt' AND kind='final'").get(attemptId).n, 1);
  const state = await f.request("/api/exams/practice/state", { cookie: registration.cookie });
  assert.deepEqual(state.data.attempt.receipt, receipt);
  assert.equal(f.db.sqlite.prepare("SELECT text FROM final_answers WHERE attempt_id=? AND question_id='practice-v1-q1'").get(attemptId).text, "Preserved numbered answer.\nExact Unicode: ñ ₱ 中文 🙂");
}));

test("student email failure and manual retry preserve the receipt and use frozen answers instead of late writing", use(async f => {
  const registration = await f.register();
  await f.save(registration.cookie, "The immutable submitted answer.");
  const done = await f.submit(registration.cookie), receipt = done.data.attempt.receipt;
  await drainOutbox(f.env, 20, async job => {
    if (job.target === "student_receipt") throw Object.assign(new Error("private provider body"), { code: "synthetic_provider_failure" });
    return { reference: "synthetic-copy" };
  });
  const job = f.db.sqlite.prepare("SELECT * FROM outbox WHERE target='student_receipt'").get();
  assert.equal(job.status, "failed");
  assert.equal(job.last_error, "synthetic_provider_failure");
  assert.equal((await f.request(`/api/admin/jobs/${job.id}/retry`, { method: "POST", data: {} })).data.queued, true);
  f.db.sqlite.prepare("UPDATE answers SET text=? WHERE attempt_id=? AND question_id='practice-v1-q1'").run("Mutable current row must not replace submitted writing.", registration.data.attempt.id);
  await f.request("/api/exams/practice/recovery", { method: "POST", cookie: registration.cookie, data: { operationId: crypto.randomUUID(), questionId: "practice-v1-q1", revision: 2, text: "Separate late writing.", clientTime: new Date().toISOString() } });
  const delivered = [];
  await drainOutbox(f.env, 20, async item => { delivered.push(item); return { reference: "synthetic-student-confirmation" }; });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].target, "student_receipt");
  assert.deepEqual(delivered[0].payload.answers.map(answer => answer.text), ["The immutable submitted answer.", ""]);
  assert.deepEqual(delivered[0].payload.receipt, receipt);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='student_receipt'").get().n, 1);
  assert.deepEqual((await f.request("/api/exams/practice/state", { cookie: registration.cookie })).data.attempt.receipt, receipt);
}));

test("private Sheet destination and delivery references remain owner-only in both professor read APIs", use(async f => {
  const registration = await f.register();
  await f.save(registration.cookie);
  await f.submit(registration.cookie);
  const attemptId = registration.data.attempt.id;
  f.db.sqlite.prepare("UPDATE outbox SET status='sent',reference=? WHERE attempt_id=? AND target='sheets'").run(SHEET_URL, attemptId);
  const read = () => Promise.all([
    f.request("/api/admin/exams/practice/backups"),
    f.request(`/api/admin/attempts/${attemptId}`),
  ]);
  const owner = await read();
  assert.equal(owner[0].data.configuration.spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
  assert.ok(owner.every(response => JSON.stringify(response.data).includes(SHEET_URL)));
  f.as("examiner");
  const examiner = await read();
  assert.ok(examiner.every(response => response.status === 200));
  assert.equal(examiner[0].data.configuration.spreadsheetUrl, null);
  assert.ok(examiner.every(response => !JSON.stringify(response.data).includes(SHEET)));
  for (const path of ["/api/health", "/api/exams/practice/state"])
    assert.equal(JSON.stringify((await f.request(path)).data).includes(SHEET), false);
}));
