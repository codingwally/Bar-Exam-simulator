import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./test-support.mjs";
import { createApp, buildDeliveryPayload, maintenance } from "./worker.mjs";

function fixture() {
  const db = createTestDatabase(), env = { EXAM_DB: db };
  const app = createApp({ authenticateAdmin: async () => ({ email: "owner@example.invalid", role: "owner" }) });
  const request = async (path, { method = "GET", data, cookie, origin = "https://exam.example.invalid" } = {}) => {
    const headers = new Headers();
    if (method !== "GET") headers.set("Origin", origin);
    if (data !== undefined) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);
    const response = await app.fetch(new Request(`https://exam.example.invalid${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }), env, {});
    const result = response.headers.get("Content-Type")?.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, response, data: result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const create = (extra = {}) => request("/api/admin/exams/create", { method: "POST", data: {
    operation_id: crypto.randomUUID(), title: "Statutory interpretation practice", kind: "practice",
    questions: [{ number: 1, text: "Discuss the first fact pattern.", instructions: "Explain your reasoning." }, { number: 2, text: "Discuss the second fact pattern." }], ...extra,
  } });
  const bootstrap = (cookie, extra = {}) => request("/api/browser/session", { method: "POST", cookie, data: extra });
  const register = (exam, cookie, extra = {}, access = "") => request(`/api/exams/${exam.slug}/attempt${access}`, { method: "POST", cookie, data: {
    name: "Synthetic Student", email: "student@example.invalid", consent: true, oneBrowser: true,
    editorId: "editor-one", registrationId: crypto.randomUUID(), ...extra,
  } });
  const state = (exam, cookie, access = "") => request(`/api/exams/${exam.slug}/state${access}`, { cookie });
  const save = (exam, cookie, question, answer = "Complete synthetic answer.") => request(`/api/exams/${exam.slug}/answers/${question}`, { method: "PUT", cookie,
    data: { operationId: crypto.randomUUID(), revision: 1, editorId: "editor-one", text: answer } });
  return { db, env, app, request, create, bootstrap, register, state, save };
}
const use = fn => async () => { const f = fixture(); try { await fn(f); } finally { f.db.close(); } };

test("published practice creation retains reviewed questions and private original source", use(async f => {
  const source = "Original page one\n\n1. Original numbering preserved.\n\nAnswer Key: instructor only";
  const created = await f.create({ duration_minutes: 20, instructions: "Read carefully.\nUse complete sentences.", source_text: source, source_filename: "Practice.docx", source_type: "docx" });
  assert.equal(created.status, 201);
  const exam = created.data.exam;
  assert.match(exam.student_url, /^\/exam\/p-[a-f0-9]{64}$/);
  assert.equal(exam.question_count, 2);
  assert.equal(exam.duration_minutes, 20);
  assert.equal(exam.published_version, 1);
  const detail = await f.request(`/api/admin/exams/${exam.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.source_text, source);
  assert.equal(detail.data.source_filename, "Practice.docx");
  assert.equal(detail.data.published.questions[0].instructions, "Explain your reasoning.");
  const publicState = await f.state(exam);
  assert.equal(publicState.data.exam.kind, "practice");
  assert.equal(publicState.data.exam.durationMinutes, 20);
  assert.equal(publicState.data.exam.instructions, "Read carefully.\nUse complete sentences.");
  assert.equal(JSON.stringify(publicState.data).includes(source), false);
  assert.equal(publicState.data.attempt, null);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM question_versions WHERE exam_id=?").get(exam.id).n, 1);
}));

test("idempotent concurrent creation produces exactly one immutable version and changed input conflicts", use(async f => {
  const operation_id = crypto.randomUUID();
  const results = await Promise.all([f.create({ operation_id }), f.create({ operation_id })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0].data.exam.id, results[1].data.exam.id);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM exams").get().n, 3);
  const repeat = await f.create({ operation_id });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.exam.student_url, results[0].data.exam.student_url);
  assert.equal((await f.create({ operation_id, duration_minutes: 6 })).status, 409);
  assert.equal((await f.create({ operation_id, source_text: "Changed source" })).status, 409);
  const draft = await f.request(`/api/admin/exams/${repeat.data.exam.id}/draft`, { method: "PUT", data: { expected_version: 1, questions: [{ number: 1, text: "Changed questions" }] } });
  assert.equal(draft.status, 403);
  assert.equal((await f.request(`/api/admin/exams/${repeat.data.exam.id}`)).data.published.questions.length, 2);
}));

test("practice duration bounds, malformed questions and oversized source fail without creating partial examinations", use(async f => {
  for (const duration of [0, 361, -1, 1.5, "20", null])
    assert.equal((await f.create({ duration_minutes: duration })).status, 400);
  for (const questions of [[null], [{ number: 2, text: "Wrong first number" }], [{ number: 1, text: "Same" }, { number: 2, text: " same " }], [{ number: 1, text: "Answer Key: confidential" }]])
    assert.equal((await f.create({ questions })).status, 400);
  assert.equal((await f.create({ source_text: "x".repeat(1000001) })).status, 400);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_operations").get().n, 0);
  for (const duration of [1, 360, undefined]) {
    const result = await f.create({ duration_minutes: duration });
    assert.equal(result.status, 201);
    assert.equal(result.data.exam.duration_minutes, duration ?? 5);
    const cookie = (await f.bootstrap()).cookie;
    const attempt = await f.register(result.data.exam, cookie);
    assert.equal(attempt.status, 201);
    assert.equal(attempt.data.attempt.deadlineAt - attempt.data.attempt.startAt, (duration ?? 5) * 60000);
  }
}));

test("300-question creation respects D1 parameter limits and remains atomic on database failure", use(async f => {
  const originalPrepare = f.db.prepare;
  f.db.prepare = sql => {
    const statement = originalPrepare(sql), bind = statement.bind;
    statement.bind = (...values) => { assert.ok(values.length <= 100, `D1 parameter bound: ${values.length}`); return bind.call(statement, ...values); };
    return statement;
  };
  const questions = Array.from({ length: 300 }, (_, i) => ({ number: i + 1, text: `Fact pattern ${i + 1}.` }));
  const result = await f.create({ questions });
  assert.equal(result.status, 201);
  assert.equal(result.data.questions.length, 300);
  const batch = f.db.batch;
  f.db.batch = async statements => {
    const invalid = originalPrepare("INSERT INTO nonexistent_table VALUES(1)");
    return batch([...statements.slice(0, 3), invalid, ...statements.slice(3)]);
  };
  const failed = await f.create({ questions });
  assert.equal(failed.status, 503);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM exams").get().n, 3);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_operations").get().n, 1);
}));

test("one HttpOnly platform cookie serves many exams without per-exam cookie growth", use(async f => {
  const bootstrap = await f.bootstrap();
  assert.equal(bootstrap.status, 201);
  assert.match(bootstrap.cookie, /^__Host-dd_exam_platform=[a-f0-9]{64}$/);
  assert.match(bootstrap.response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax; Path=\//);
  assert.equal(JSON.stringify(bootstrap.data).includes(bootstrap.cookie.split("=")[1]), false);
  const again = await f.bootstrap(bootstrap.cookie);
  assert.equal(again.status, 200);
  assert.equal(again.cookie, undefined);
  for (let i = 0; i < 35; i++) {
    const exam = (await f.create({ title: `Practice ${i}` })).data.exam;
    const attempt = await f.register(exam, bootstrap.cookie);
    assert.equal(attempt.status, 201);
    assert.equal(attempt.cookie, undefined);
    assert.equal((await f.state(exam, bootstrap.cookie)).data.attempt.id, attempt.data.attempt.id);
  }
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_browsers").get().n, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_exam_sessions").get().n, 35);
  assert.equal(bootstrap.cookie.length, 88);
}));

test("client browserId cannot recover or rebind another browser's platform session", use(async f => {
  const allegedBrowserId = crypto.randomUUID();
  const first = await f.bootstrap(undefined, { browserId: allegedBrowserId });
  const exam1 = (await f.create()).data.exam, exam2 = (await f.create()).data.exam;
  const registrationId = crypto.randomUUID();
  const attempt1 = await f.register(exam1, first.cookie, { registrationId, browserId: allegedBrowserId });
  const attempt2 = await f.register(exam2, first.cookie);
  const attacker = await f.bootstrap(undefined, { browserId: allegedBrowserId });
  assert.notEqual(attacker.cookie, first.cookie);
  assert.equal((await f.state(exam1, attacker.cookie)).data.attempt, null);
  assert.equal((await f.state(exam2, attacker.cookie)).data.attempt, null);
  const separate = await f.register(exam1, attacker.cookie, { browserId: allegedBrowserId });
  assert.notEqual(separate.data.attempt.id, attempt1.data.attempt.id);
  assert.equal((await f.state(exam1, first.cookie)).data.attempt.id, attempt1.data.attempt.id);
  const third = await f.bootstrap(undefined, { browserId: allegedBrowserId });
  const scopedRetry = await f.register(exam1, third.cookie, { registrationId });
  assert.equal(scopedRetry.data.attempt.id, attempt1.data.attempt.id);
  assert.equal(scopedRetry.cookie, undefined);
  assert.equal((await f.state(exam2, third.cookie)).data.attempt, null);
  assert.equal((await f.state(exam2, first.cookie)).data.attempt.id, attempt2.data.attempt.id);
  assert.equal((await f.register(exam1)).data.error.code, "browser_session_required");
  assert.equal((await f.request("/api/browser/session", { method: "POST", data: {}, origin: "https://wrong.invalid" })).status, 403);
}));

test("concurrent exams and retried registrations map only their own attempt to one secure browser", use(async f => {
  const cookie = (await f.bootstrap()).cookie;
  const exams = (await Promise.all([f.create(), f.create()])).map(result => result.data.exam);
  const registrationId = crypto.randomUUID();
  const attempts = await Promise.all(exams.map(exam => f.register(exam, cookie, { registrationId })));
  assert.ok(attempts.every(result => result.status === 201));
  assert.notEqual(attempts[0].data.attempt.id, attempts[1].data.attempt.id);
  const repeats = await Promise.all(exams.map(exam => f.register(exam, cookie, { registrationId })));
  repeats.forEach((result, index) => assert.equal(result.data.attempt.id, attempts[index].data.attempt.id));
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n, 2);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_exam_sessions").get().n, 2);
}));

test("registration revocation racing a retry cannot grant an obsolete platform mapping", use(async f => {
  const oldCookie = (await f.bootstrap()).cookie, newCookie = (await f.bootstrap()).cookie;
  const exam = (await f.create()).data.exam, registrationId = crypto.randomUUID();
  const attempt = (await f.register(exam, oldCookie, { registrationId })).data.attempt;
  const originalPrepare = f.db.prepare;
  let injected = false;
  f.db.prepare = sql => {
    if (!injected && sql.startsWith("INSERT INTO platform_exam_sessions")) {
      injected = true;
      f.db.sqlite.prepare("DELETE FROM platform_exam_sessions WHERE attempt_id=?").run(attempt.id);
      f.db.sqlite.prepare("DELETE FROM sessions WHERE attempt_id=?").run(attempt.id);
    }
    return originalPrepare(sql);
  };
  const retry = await f.register(exam, newCookie, { registrationId });
  assert.equal(injected, true);
  assert.equal(retry.status, 401);
  assert.equal(retry.data.error.code, "recovery_required");
  assert.equal((await f.state(exam, newCookie)).data.attempt, null);
}));

test("expired browser cleanup removes access mappings without deleting preserved student work", use(async f => {
  const cookie = (await f.bootstrap()).cookie, exam = (await f.create()).data.exam;
  const attempt = (await f.register(exam, cookie)).data.attempt;
  await f.save(exam, cookie, attempt.questions[0].id, "Preserved after session expiry");
  f.db.sqlite.exec("UPDATE platform_browsers SET expires_at=0");
  await maintenance(f.env);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_browsers").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_exam_sessions").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT text FROM answers WHERE attempt_id=?").get(attempt.id).text, "Preserved after session expiry");
  assert.equal((await f.state(exam, cookie)).data.attempt, null);
}));

test("question IDs, saves, receipts and recovered drafts remain isolated between dynamic exams", use(async f => {
  const cookie = (await f.bootstrap()).cookie;
  const first = (await f.create({ duration_minutes: 1, source_text: "Private original", source_type: "text" })).data.exam;
  const second = (await f.create({ duration_minutes: 360 })).data.exam;
  const a = (await f.register(first, cookie)).data.attempt, b = (await f.register(second, cookie)).data.attempt;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.questions[0].id, b.questions[0].id);
  assert.equal((await f.save(second, cookie, a.questions[0].id)).status, 404);
  assert.equal((await f.save(first, cookie, a.questions[0].id, "First exam's exact text.\nSecond line.")).status, 200);
  const submitted = await f.request(`/api/exams/${first.slug}/submit`, { method: "POST", cookie, data: { operationId: crypto.randomUUID(), editorId: "editor-one" } });
  assert.equal(submitted.status, 200);
  const receipt = await f.state(first, cookie);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.data.attempt.receipt.questionCount, 2);
  assert.equal(receipt.data.attempt.receipt.id, submitted.data.attempt.receipt.id);
  const rows = f.db.sqlite.prepare("SELECT * FROM final_answers WHERE attempt_id=? ORDER BY question_id").all(a.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.text === "" && row.hash.length === 64));
  assert.equal((await f.state(second, cookie)).data.attempt.status, "active");
  assert.equal((await f.request(`/api/exams/${second.slug}/recovery`, { method: "POST", cookie, data: { operationId: crypto.randomUUID(), revision: 2, questionId: a.questions[0].id, text: "Wrong exam draft" } })).status, 404);
  assert.equal((await f.request(`/api/exams/${first.slug}/recovery`, { method: "POST", cookie, data: { operationId: crypto.randomUUID(), revision: 2, questionId: a.questions[0].id, text: "Late draft preserved separately" } })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT text FROM answers WHERE attempt_id=?").get(a.id).text, "First exam's exact text.\nSecond line.");
  const job = f.db.sqlite.prepare("SELECT * FROM outbox WHERE attempt_id=? AND target='sheets' AND kind='final'").get(a.id);
  const packet = await buildDeliveryPayload(f.db, job);
  assert.equal(packet.source.text, "Private original");
  assert.equal(packet.answers.length, 2);
  assert.equal(JSON.stringify((await f.state(first, cookie)).data).includes("Private original"), false);
}));

test("practice finals queue one owner email and Sheets job, retry provider failures without changing their receipt", use(async f => {
  const cookie = (await f.bootstrap()).cookie;
  const exam = (await f.create({ instructions: "Use complete explanations." })).data.exam;
  const attempt = (await f.register(exam, cookie)).data.attempt;
  await f.save(exam, cookie, attempt.questions[0].id, "Preserved practice submission.");
  const submit = () => f.request(`/api/exams/${exam.slug}/submit`, { method: "POST", cookie, data: { operationId: crypto.randomUUID(), editorId: "editor-one" } });
  const finalized = await submit();
  const receipt = finalized.data.attempt.receipt;
  assert.equal(finalized.status, 200);
  assert.equal((await submit()).data.attempt.receipt.id, receipt.id);
  const jobs = f.db.sqlite.prepare("SELECT * FROM outbox WHERE attempt_id=? AND kind='final' ORDER BY target").all(attempt.id);
  assert.deepEqual(jobs.map(job => job.target), ["owner_email", "sheets"]);
  const ownerJob = jobs.find(job => job.target === "owner_email");
  const packet = await buildDeliveryPayload(f.db, ownerJob);
  assert.equal(packet.exam.kind, "practice");
  assert.equal(packet.exam.instructions, "Use complete explanations.");
  assert.equal(packet.answers.length, 2);
  assert.equal(packet.answers[0].text, "Preserved practice submission.");
  assert.equal(packet.answers[1].text, "");
  await maintenance(f.env); // Providers are deliberately unconfigured in this test.
  const failed = f.db.sqlite.prepare("SELECT status,last_error FROM outbox WHERE id=?").get(ownerJob.id);
  assert.equal(failed.status, "failed");
  assert.equal((await f.state(exam, cookie)).data.attempt.receipt.checksum, receipt.checksum);
  f.db.sqlite.prepare("DELETE FROM outbox WHERE id=?").run(ownerJob.id);
  await maintenance(f.env); // Reconciliation repairs a missing owner delivery once.
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE attempt_id=? AND target='owner_email' AND kind='final'").get(attempt.id).n, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='student_receipt'").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='r2'").get().n, 0);
  assert.deepEqual((await f.state(exam, cookie)).data.attempt.receipt, receipt);
}));

test("practice without R2 never adds new R2 jobs and existing R2 evidence cannot mask a missing owner copy", use(async f => {
  f.env.EXAM_BACKUPS = { put: async () => {}, head: async () => null };
  const exam = (await f.create()).data.exam, cookie = (await f.bootstrap()).cookie;
  const attempt = (await f.register(exam, cookie)).data.attempt;
  await f.save(exam, cookie, attempt.questions[0].id);
  const finalized = await f.request(`/api/exams/${exam.slug}/submit`, { method: "POST", cookie, data: { operationId: crypto.randomUUID(), editorId: "editor-one" } });
  const originalR2 = f.db.sqlite.prepare("SELECT id FROM outbox WHERE target='r2' ORDER BY id").all();
  assert.equal(originalR2.length, 2);
  delete f.env.EXAM_BACKUPS;
  f.db.sqlite.exec("DELETE FROM outbox WHERE target='owner_email'");
  await maintenance(f.env);
  assert.deepEqual(f.db.sqlite.prepare("SELECT id FROM outbox WHERE target='r2' ORDER BY id").all(), originalR2);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='owner_email' AND kind='final'").get().n, 1);
  assert.equal((await f.state(exam, cookie)).data.attempt.receipt.id, finalized.data.attempt.receipt.id);
  const next = (await f.create()).data.exam;
  const nextAttempt = (await f.register(next, cookie)).data.attempt;
  await f.save(next, cookie, nextAttempt.questions[0].id);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE attempt_id=? AND target='r2'").get(nextAttempt.id).n, 0);
}));

test("official scheduling and new admission require R2 while existing sessions retain primary preservation", use(async f => {
  const questions = [{ number: 1, text: "Official fact pattern for synthetic backup check." }];
  assert.equal((await f.request("/api/admin/exams/official/draft", { method: "PUT", data: { expected_version: 0, questions } })).status, 200);
  const schedule = () => f.request("/api/admin/exams/official/schedule", { method: "POST", data: { starts_at: new Date(Date.now() + 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), confirmed: true, expected_draft_version: 1 } });
  assert.equal((await schedule()).data.error.code, "official_backup_required");
  f.env.EXAM_BACKUPS = { put: async () => {}, head: async () => null };
  assert.equal((await schedule()).status, 200);
  f.db.sqlite.exec("UPDATE exams SET starts_at=1 WHERE id='official'");
  const official = { id: "official", slug: "official" };
  const admitted = await f.register(official);
  assert.equal(admitted.status, 201);
  delete f.env.EXAM_BACKUPS;
  assert.equal((await f.register(official)).data.error.code, "official_backup_required");
  assert.equal((await f.save(official, admitted.cookie, admitted.data.attempt.questions[0].id, "Preserved despite provider outage.")).status, 200);
  const finalized = await f.request("/api/exams/official/submit", { method: "POST", cookie: admitted.cookie, data: { operationId: crypto.randomUUID(), editorId: "editor-one" } });
  assert.equal(finalized.status, 200);
  assert.ok(finalized.data.attempt.receipt.checksum);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE attempt_id=? AND target='r2' AND kind='final'").get(admitted.data.attempt.id).n, 1);
}));

function queryBudget(db, limit = 50) {
  let used = 0;
  const spend = count => { used += count; if (used > limit) throw new Error("Synthetic Free D1 invocation budget exceeded"); };
  const wrap = statement => ({
    sql: statement.sql, values: statement.values,
    bind: (...values) => wrap(statement.bind(...values)),
    first: (...args) => { spend(1); return statement.first(...args); },
    all: (...args) => { spend(1); return statement.all(...args); },
    run: (...args) => { spend(1); return statement.run(...args); },
  });
  return {
    prepare: sql => wrap(db.prepare(sql)),
    batch: statements => { spend(statements.length); return db.batch(statements); },
    reset: () => { used = 0; },
    used: () => used,
  };
}

test("100 disconnected students finalize fairly over bounded Free D1 ticks without losing gaps, answers or receipts", use(async f => {
  const exam = (await f.create()).data.exam;
  const students = [];
  for (let i = 0; i < 100; i++) {
    const cookie = (await f.bootstrap()).cookie;
    const attempt = (await f.register(exam, cookie, { name: `Synthetic Student ${i}` })).data.attempt;
    await f.save(exam, cookie, attempt.questions[0].id, `Complete answer ${i}\nPreserved exact writing.`);
    students.push(attempt.id);
  }
  const time = Date.now();
  f.db.sqlite.prepare("UPDATE attempts SET deadline_at=?,last_seen_at=?").run(time - 1000, time - 120000);
  const budget = queryBudget(f.db);
  f.env.EXAM_DB = budget;
  const ticks = [];
  const receipts = new Map();
  for (let tick = 0; tick < 10; tick++) {
    budget.reset();
    await maintenance(f.env);
    ticks.push(budget.used());
    assert.ok(budget.used() <= 50);
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts WHERE status='finalized'").get().n, (tick + 1) * 10);
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='heartbeat_missing'").get().n, 100);
    for (const receipt of f.db.sqlite.prepare("SELECT * FROM submissions").all()) {
      assert.equal(receipt.checksum.length, 64);
      if (receipts.has(receipt.attempt_id)) assert.equal(receipts.get(receipt.attempt_id), JSON.stringify(receipt));
      else receipts.set(receipt.attempt_id, JSON.stringify(receipt));
    }
  }
  assert.equal(receipts.size, 100);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM final_answers").get().n, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='owner_email' AND kind='final'").get().n, 100);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE target='r2'").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE attempts>0").get().n, 20);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM answer_operations").get().n, 100);
  const observed = f.db.sqlite.prepare("SELECT details_json FROM events WHERE type='heartbeat_missing' LIMIT 1").get();
  assert.equal(JSON.parse(observed.details_json).cause, "unknown");
  const packet = await buildDeliveryPayload(f.db, f.db.sqlite.prepare("SELECT * FROM outbox WHERE target='owner_email' LIMIT 1").get());
  assert.equal(packet.answers.length, 2);
  assert.ok(packet.answers[0].text.includes("Preserved exact writing."));
  assert.equal(packet.answers[1].text, "");
  assert.ok(Math.max(...ticks) <= 35, `Expected provider headroom within Free allowance: ${ticks}`);
}));

test("examiner recovery revokes only its target attempt, preserves other exams and invalidates old registration", use(async f => {
  const oldCookie = (await f.bootstrap()).cookie, newCookie = (await f.bootstrap()).cookie;
  const first = (await f.create()).data.exam, second = (await f.create()).data.exam;
  const registrationId = crypto.randomUUID();
  const a = (await f.register(first, oldCookie, { registrationId })).data.attempt;
  const b = (await f.register(second, oldCookie)).data.attempt;
  await f.save(first, oldCookie, a.questions[0].id, "Preserved through recovery");
  const authorization = await f.request(`/api/admin/attempts/${a.id}/recovery`, { method: "POST", data: { confirmed: true, reason: "Replacement browser authorized." } });
  assert.equal(authorization.status, 200);
  assert.ok(authorization.data.recovery_url.includes(`/exam/${first.slug}#recover=`));
  const recover = () => f.request(`/api/exams/${first.slug}/recover`, { method: "POST", cookie: newCookie, data: { token: authorization.data.recovery_code } });
  const recovered = await recover();
  assert.equal(recovered.status, 200);
  assert.equal(recovered.cookie, undefined);
  assert.equal(recovered.data.attempt.deadlineAt, a.deadlineAt);
  assert.equal(recovered.data.attempt.answers[0].text, "Preserved through recovery");
  assert.equal((await f.state(first, oldCookie)).data.attempt, null);
  assert.equal((await f.state(second, oldCookie)).data.attempt.id, b.id);
  assert.equal((await f.state(second, newCookie)).data.attempt, null);
  assert.equal((await f.register(first, oldCookie, { registrationId })).status, 401);
  assert.equal((await recover()).status, 403);
}));

test("practice reset and admission rotation preserve other exams, prior receipts and immutable links", use(async f => {
  const cookie = (await f.bootstrap()).cookie;
  const first = (await f.create()).data.exam, second = (await f.create()).data.exam;
  const registrationId = crypto.randomUUID();
  const a = (await f.register(first, cookie, { registrationId })).data.attempt;
  const b = (await f.register(second, cookie)).data.attempt;
  const rotate = await f.request(`/api/admin/exams/${first.id}/access-link`, { method: "POST", data: { action: "rotate", confirmed: true, reason: "New cohort", operation_id: crypto.randomUUID() } });
  assert.equal(rotate.status, 200);
  const newLink = rotate.data.exam.student_url;
  assert.ok(newLink.startsWith(`/exam/${first.slug}?access=`));
  assert.equal((await f.state(first)).status, 403);
  assert.equal((await f.state(first, cookie)).status, 200);
  const reset = await f.request(`/api/admin/attempts/${a.id}/practice-reset`, { method: "POST", data: { confirmed: true, reason: "Begin a fresh practice." } });
  assert.equal(reset.status, 200);
  assert.equal((await f.state(second, cookie)).data.attempt.id, b.id);
  const access = new URL(newLink, "https://exam.example.invalid").search;
  assert.equal((await f.state(first, cookie, access)).data.attempt, null);
  const fresh = await f.register(first, cookie, { registrationId }, access);
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.data.attempt.id, a.id);
  assert.ok(f.db.sqlite.prepare("SELECT id FROM attempts WHERE id=?").get(a.id));
}));

test("dynamic public shells and icons remain public while document parser assets require verified admin", use(async f => {
  f.env.ASSETS = { fetch: async request => new Response(new URL(request.url).pathname, { headers: { "Content-Type": new URL(request.url).pathname.endsWith(".svg") ? "image/svg+xml" : "text/plain" } }) };
  const deniedApp = createApp();
  for (const path of ["/import.mjs", "/document-import.mjs", "/document-vendor/pdf.mjs", "/document-vendor/pdf.worker.mjs", "/document-vendor/licenses/pdfjs-dist-LICENSE", "/%64ocument-import.mjs", "/%61dmin.mjs"])
    assert.equal((await deniedApp.fetch(new Request(`https://exam.example.invalid${path}`), f.env, {})).status, 503);
  for (const path of ["/exam/p-1234", "/exam/p-1234/", "/index.html", "/icons/file-text.svg"])
    assert.equal((await deniedApp.fetch(new Request(`https://exam.example.invalid${path}`), f.env, {})).status, 200);
  assert.equal((await f.request("/exam/p-1234")).data, "/index.html");
  assert.equal((await f.request("/document-vendor/pdf.worker.mjs")).status, 200);
  assert.equal((await f.request("/document-vendor/licenses/pdfjs-dist-LICENSE")).status, 200);
  assert.equal((await f.request("/document-vendor/licenses/nested/unlisted.txt")).status, 404);
  const visited = new Set();
  async function visitModule(path) {
    if (visited.has(path)) return;
    visited.add(path);
    assert.equal((await f.request(path)).status, 200, `Admin module dependency ${path} must be routed`);
    const module = readFileSync(new URL(`./public${path}`, import.meta.url), "utf8");
    for (const match of module.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g)) {
      const dependency = new URL(match[1], `https://exam.example.invalid${path}`).pathname;
      if (!dependency.startsWith("/document-vendor/")) await visitModule(dependency);
      else assert.equal((await f.request(dependency)).status, 200);
    }
  }
  await visitModule("/admin.mjs");
  assert.ok(visited.has("/import.mjs"));
  assert.ok(visited.has("/document-import.mjs"));
  assert.equal((await f.request("/unlisted-private-source.json")).status, 404);
}));

test("additive library migration preserves existing exams and attempt records with five-minute defaults", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE exams(id TEXT PRIMARY KEY,slug TEXT,updated_at INTEGER); CREATE TABLE attempts(id TEXT PRIMARY KEY,exam_id TEXT REFERENCES exams(id),name TEXT); INSERT INTO exams VALUES('practice','practice',123),('old','archived-old',456); INSERT INTO attempts VALUES('saved','practice','Retained student');");
    sqlite.exec(readFileSync(new URL("./migrations/0002_practice_library.sql", import.meta.url), "utf8"));
    assert.equal(sqlite.prepare("SELECT name FROM attempts WHERE id='saved'").get().name, "Retained student");
    assert.equal(sqlite.prepare("SELECT duration_minutes FROM exams WHERE id='practice'").get().duration_minutes, 5);
    assert.equal(sqlite.prepare("SELECT archived_at FROM exams WHERE id='old'").get().archived_at, 456);
    assert.equal(sqlite.prepare("SELECT source_text FROM exams WHERE id='practice'").get().source_text, "");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM platform_exam_sessions").get().n, 0);
  } finally { sqlite.close(); }
});
