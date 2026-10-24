import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./test-support.mjs";
import {
  createApp,
  maintenance,
  drainOutbox,
  buildDeliveryPayload,
  authenticateAdmin,
} from "./worker.mjs";

function fixture() {
  const db = createTestDatabase(),
    env = { EXAM_DB: db, EXAM_BACKUPS: { put: async () => {}, head: async () => null } },
    app = createApp({
      authenticateAdmin: async () => ({ email: "synthetic@example.invalid" }),
    });
  const request = async (
    path,
    {
      method = "GET",
      data,
      cookie,
      origin = "https://exam.example.invalid",
    } = {},
  ) => {
    const headers = new Headers();
    if (method !== "GET") headers.set("Origin", origin);
    if (cookie) headers.set("Cookie", cookie);
    if (data !== undefined) headers.set("Content-Type", "application/json");
    const response = await app.fetch(
      new Request(`https://exam.example.invalid${path}`, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
      {},
    );
    const payload = response.headers
      .get("Content-Type")
      ?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      response,
      status: response.status,
      data: payload,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const register = (slug = "practice", extra = {}) =>
    request(`/api/exams/${slug}/attempt`, {
      method: "POST",
      data: {
        name: "Synthetic Student",
        email: "synthetic@example.invalid",
        consent: true,
        oneBrowser: true,
        editorId: "editor-one",
        registrationId: crypto.randomUUID(),
        ...extra,
      },
    });
  const save = (
    cookie,
    rev = 1,
    answer = "Synthetic answer",
    op = crypto.randomUUID(),
    question = "practice-v1-q1",
    editor = "editor-one",
    slug = "practice",
  ) =>
    request(`/api/exams/${slug}/answers/${question}`, {
      method: "PUT",
      cookie,
      data: { operationId: op, editorId: editor, revision: rev, text: answer },
    });
  const configure = async (count = 3) => {
    const draft = await request("/api/admin/exams/official/draft", {
      method: "PUT",
      data: {
        expected_version: 0,
        questions: Array.from({ length: count }, (_, i) => ({
          number: i + 1,
          text: `Synthetic question ${i + 1}\nwith a complete fact pattern.`,
        })),
      },
    });
    assert.equal(draft.status, 200);
    const scheduled = await request("/api/admin/exams/official/schedule", {
      method: "POST",
      data: {
        starts_at: new Date(Date.now() + 2 * 86400000).toISOString(),
        ends_at: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString(),
        expected_draft_version: 1,
        confirmed: true,
      },
    });
    assert.equal(scheduled.status, 200);
    return scheduled;
  };
  const open = () =>
    db.sqlite
      .prepare("UPDATE exams SET starts_at=?,ends_at=? WHERE id=?")
      .run(Date.now() - 1000, Date.now() + 3600000, "official");
  return { db, env, app, request, register, save, configure, open };
}
const withFixture = (fn) => async () => {
  const f = fixture();
  try {
    await fn(f);
  } finally {
    f.db.close();
  }
};

test(
  "official boot state is empty and practice contains one approved question",
  withFixture(async (f) => {
    const official = await f.request("/api/exams/official/state");
    assert.equal(official.status, 200);
    assert.equal(official.data.exam.status, "UNCONFIGURED");
    assert.equal(official.data.exam.questionCount, 0);
    assert.equal(official.data.attempt, null);
    const denied = await f.register("official");
    assert.equal(denied.status, 409);
    assert.equal(denied.data.error.message, "Test is not available");
    const registered = await f.register();
    assert.equal(registered.status, 201);
    assert.equal(registered.data.attempt.questions.length, 1);
    assert.match(registered.data.attempt.questions[0].text, /\n\n/);
    assert.equal(
      registered.data.attempt.deadlineAt - registered.data.attempt.startAt,
      300000,
    );
    assert.doesNotMatch(JSON.stringify(registered.data), /Article VI/);
  }),
);
test(
  "HttpOnly Secure host cookie and privacy response headers",
  withFixture(async (f) => {
    const result = await f.register();
    const cookie = result.response.headers.get("set-cookie");
    assert.match(cookie, /__Host-/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(
      result.response.headers.get("cache-control"),
      "no-store, private",
    );
    assert.match(
      result.response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  }),
);
test(
  "same-browser session resumes with exact deadline and text",
  withFixture(async (f) => {
    const result = await f.register(),
      a = result.data.attempt;
    assert.equal((await f.save(result.cookie)).status, 200);
    const resumed = await f.request("/api/exams/practice/state", {
      cookie: result.cookie,
    });
    assert.equal(resumed.data.attempt.id, a.id);
    assert.equal(resumed.data.attempt.deadlineAt, a.deadlineAt);
    assert.equal(resumed.data.attempt.answers[0].text, "Synthetic answer");
  }),
);
test(
  "registration retries with private credential do not create a second attempt",
  withFixture(async (f) => {
    const credential = crypto.randomUUID(),
      first = await f.register("practice", { registrationId: credential }),
      again = await f.register("practice", { registrationId: credential });
    assert.equal(again.data.attempt.id, first.data.attempt.id);
    assert.equal(again.cookie, first.cookie);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      1,
    );
  }),
);
test(
  "concurrent registration with one private credential creates one attempt",
  withFixture(async (f) => {
    const registrationId = crypto.randomUUID(),
      results = await Promise.all(
        Array.from({ length: 10 }, () =>
          f.register("practice", { registrationId }),
        ),
      );
    assert.ok(results.every((r) => r.status === 200 || r.status === 201));
    assert.equal(new Set(results.map((r) => r.data.attempt.id)).size, 1);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      1,
    );
  }),
);
test(
  "name/email reuse never authorizes access to another attempt",
  withFixture(async (f) => {
    const a = await f.register(),
      b = await f.register();
    assert.notEqual(a.data.attempt.id, b.data.attempt.id);
    await f.save(a.cookie);
    const state = await f.request("/api/exams/practice/state", {
      cookie: b.cookie,
    });
    assert.equal(state.data.attempt.answers.length, 0);
    const noSession = await f.save(undefined);
    assert.equal(noSession.status, 401);
  }),
);
test(
  "forged cookie, cross-origin write and missing consent fail closed",
  withFixture(async (f) => {
    assert.equal(
      (
        await f.request("/api/exams/practice/attempt", {
          method: "POST",
          origin: "https://evil.invalid",
          data: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.register("practice", { consent: false })).status,
      400,
    );
    const forged = await f.request("/api/exams/practice/state", {
      cookie: "__Host-dd_exam_practice=" + "a".repeat(64),
    });
    assert.equal(forged.data.attempt, null);
  }),
);
test(
  "autosave retains full history and atomically enqueues independent jobs",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "first");
    await f.save(a.cookie, 4, "newest");
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM answer_operations").get().n,
      2,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM answers").get().text,
      "newest",
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE target='r2'")
        .get().n,
      2,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE target='sheets'")
        .get().n,
      1,
    );
  }),
);
test(
  "duplicate save is acknowledged, reused operation with changed writing is rejected",
  withFixture(async (f) => {
    const a = await f.register(),
      op = crypto.randomUUID();
    const first = await f.save(a.cookie, 1, "exact writing", op),
      again = await f.save(a.cookie, 1, "exact writing", op);
    assert.equal(again.status, 200);
    assert.equal(again.data.duplicate, true);
    assert.deepEqual(again.data.answer, first.data.answer);
    assert.equal((await f.save(a.cookie, 1, "changed", op)).status, 409);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM answer_operations").get().n,
      1,
    );
  }),
);
test(
  "inverted request order never overwrites newer writing",
  withFixture(async (f) => {
    const a = await f.register();
    assert.equal((await f.save(a.cookie, 5, "newer")).status, 200);
    const stale = await f.save(a.cookie, 2, "older");
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.answer.text, "newer");
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM answers").get().text,
      "newer",
    );
  }),
);
test(
  "second tab lease requires explicit takeover and stale editor cannot save",
  withFixture(async (f) => {
    const a = await f.register();
    const denied = await f.request("/api/exams/practice/lease", {
      method: "POST",
      cookie: a.cookie,
      data: { editorId: "editor-two" },
    });
    assert.equal(denied.status, 423);
    const takeover = await f.request("/api/exams/practice/lease", {
      method: "POST",
      cookie: a.cookie,
      data: { editorId: "editor-two", takeover: true },
    });
    assert.equal(takeover.status, 200);
    assert.equal((await f.save(a.cookie)).status, 423);
    assert.equal(
      (
        await f.save(
          a.cookie,
          1,
          "second editor",
          crypto.randomUUID(),
          "practice-v1-q1",
          "editor-two",
        )
      ).status,
      200,
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM events WHERE type='second_session_attempt'",
        )
        .get().n,
      1,
    );
  }),
);
test(
  "expired lease can be safely renewed after crash",
  withFixture(async (f) => {
    const a = await f.register();
    f.db.sqlite.exec("UPDATE attempts SET lease_expires_at=0");
    assert.equal(
      (
        await f.request("/api/exams/practice/lease", {
          method: "POST",
          cookie: a.cookie,
          data: { editorId: "reopened-editor" },
        })
      ).status,
      200,
    );
  }),
);
test(
  "manual finalization freezes all question slots, yields retrievable immutable receipt",
  withFixture(async (f) => {
    await f.configure(3);
    f.open();
    const a = await f.register("official"),
      qid = a.data.attempt.questions[0].id;
    await f.save(
      a.cookie,
      1,
      "first answer",
      crypto.randomUUID(),
      qid,
      "editor-one",
      "official",
    );
    const submit = () =>
      f.request("/api/exams/official/submit", {
        method: "POST",
        cookie: a.cookie,
        data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
      });
    const done = await submit();
    assert.equal(done.status, 200);
    const receipt = done.data.attempt.receipt;
    assert.equal(receipt.questionCount, 3);
    assert.equal(receipt.answeredCount, 1);
    assert.equal(receipt.finalizationType, "manual");
    assert.equal(receipt.checksum.length, 64);
    assert.equal(done.data.attempt.answers.length, 3);
    assert.equal((await submit()).data.attempt.receipt.id, receipt.id);
    assert.equal(
      (
        await f.save(
          a.cookie,
          2,
          "changed",
          crypto.randomUUID(),
          qid,
          "editor-one",
          "official",
        )
      ).status,
      409,
    );
    const restored = await f.request("/api/exams/official/state", {
      cookie: a.cookie,
    });
    assert.equal(restored.data.attempt.receipt.checksum, receipt.checksum);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE kind='final'")
        .get().n,
      4,
    );
  }),
);
test(
  "server cutoff closes writes and finalizes without a student submit or timely cron",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "on time");
    f.db.sqlite
      .prepare("UPDATE attempts SET deadline_at=?")
      .run(Date.now() - 1000);
    const write = await f.save(a.cookie, 2, "late");
    assert.equal(write.status, 409);
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM final_answers").get().text,
      "on time",
    );
    const state = await f.request("/api/exams/practice/state", {
      cookie: a.cookie,
    });
    assert.equal(state.data.attempt.receipt.finalizationType, "deadline");
  }),
);
test(
  "closed-tab deadline is finalized by maintenance with failed deliveries retained",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie);
    f.db.sqlite
      .prepare("UPDATE attempts SET deadline_at=?")
      .run(Date.now() - 1000);
    await maintenance(f.env);
    assert.equal(
      f.db.sqlite.prepare("SELECT status FROM attempts").get().status,
      "finalized",
    );
    assert.ok(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE status='failed'")
        .get().n > 0,
    );
  }),
);
test(
  "offline recovered draft stays separate and cannot rewrite official answers",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "on time");
    f.db.sqlite
      .prepare("UPDATE attempts SET deadline_at=?")
      .run(Date.now() - 1000);
    await f.request("/api/exams/practice/state", { cookie: a.cookie });
    const recovery = await f.request("/api/exams/practice/recovery", {
      method: "POST",
      cookie: a.cookie,
      data: {
        operationId: crypto.randomUUID(),
        questionId: "practice-v1-q1",
        revision: 2,
        text: "late offline writing",
        clientTime: "1900-01-01T00:00:00Z",
      },
    });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.data.officialSubmissionChanged, false);
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM final_answers").get().text,
      "on time",
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM recovered_drafts").get().text,
      "late offline writing",
    );
  }),
);
test(
  "scheduled waiting room discloses no question text at days and seconds before opening",
  withFixture(async (f) => {
    await f.configure();
    const waiting = await f.register("official");
    assert.equal(waiting.data.exam.status, "SCHEDULED");
    assert.deepEqual(waiting.data.attempt.questions, []);
    for (const milliseconds of [
      2 * 86400000,
      2 * 3600000,
      20 * 60000,
      6 * 60000,
      4 * 60000,
      30000,
    ]) {
      f.db.sqlite
        .prepare("UPDATE exams SET starts_at=?,ends_at=? WHERE id=?")
        .run(
          Date.now() + milliseconds,
          Date.now() + milliseconds + 3600000,
          "official",
        );
      const s = await f.request("/api/exams/official/state", {
        cookie: waiting.cookie,
      });
      assert.equal(s.data.exam.status, "SCHEDULED");
      assert.ok(s.data.exam.startAt - s.data.serverTime > milliseconds - 1000);
      assert.doesNotMatch(JSON.stringify(s.data), /Synthetic question/);
    }
    f.open();
    const opened = await f.request("/api/exams/official/state", {
      cookie: waiting.cookie,
    });
    assert.equal(opened.data.exam.status, "OPEN");
    assert.equal(opened.data.attempt.questions.length, 3);
    assert.equal(opened.data.attempt.status, "active");
  }),
);
test(
  "late unlisted student receives common deadline and no roster gate",
  withFixture(async (f) => {
    await f.configure();
    f.open();
    const a = await f.register("official"),
      b = await f.register("official", { email: "unlisted@example.invalid" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.data.attempt.deadlineAt, b.data.attempt.deadlineAt);
    assert.ok(b.data.attempt.deadlineAt - b.data.attempt.startAt < 3600000);
    f.db.sqlite
      .prepare("UPDATE exams SET ends_at=? WHERE id=?")
      .run(Date.now() - 1, "official");
    assert.equal((await f.register("official")).status, 409);
  }),
);
test(
  "100 simultaneous synthetic registrations, saves and complete CSV export",
  withFixture(async (f) => {
    await f.configure(20);
    f.open();
    const registrants = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        f.register("official", {
          name: `Synthetic ${i}`,
          email: `synthetic${i}@example.invalid`,
        }),
      ),
    );
    assert.ok(registrants.every((r) => r.status === 201));
    const saves = await Promise.all(
      registrants.map((r, i) =>
        f.save(
          r.cookie,
          1,
          `Synthetic response ${i}`,
          crypto.randomUUID(),
          r.data.attempt.questions[0].id,
          "editor-one",
          "official",
        ),
      ),
    );
    assert.ok(saves.every((r) => r.status === 200));
    const exported = await f.request("/api/admin/exams/official/export.csv");
    assert.equal(exported.status, 200);
    assert.equal(exported.data.split("\r\n").length, 2001);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      100,
    );
  }),
);
test(
  "activity text/timestamps preserved, duplicates safe and monitoring never changes status",
  withFixture(async (f) => {
    const a = await f.register(),
      events = [
        "copy",
        "paste",
        "page_hidden",
        "page_visible",
        "offline",
        "online",
        "heartbeat",
        "reconnect",
        "navigation_attempt",
        "save_failure",
      ].map((type) => ({
        id: crypto.randomUUID(),
        type,
        clientTime: "2099-01-01T00:00:00Z",
        questionId: "practice-v1-q1",
        details: { text: "exact synthetic selected / pasted words" },
      }));
    const post = () =>
      f.request("/api/exams/practice/events", {
        method: "POST",
        cookie: a.cookie,
        data: { events },
      });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).data.accepted.length, 10);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM events WHERE provenance LIKE 'client%'",
        )
        .get().n,
      10,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT status FROM attempts").get().status,
      "active",
    );
    assert.equal((await f.save(a.cookie)).status, 200);
    const page = await f.request(
      "/api/admin/exams/practice/events?search=pasted",
    );
    assert.equal(page.data.events.length, 10);
    assert.ok(
      page.data.events.every(
        (e) =>
          e.client_time === "2099-01-01T00:00:00Z" &&
          e.received_at < Date.now() + 10000,
      ),
    );
  }),
);
test(
  "chronological activity pagination includes every event exactly once",
  withFixture(async (f) => {
    const a = await f.register();
    for (let batch = 0; batch < 3; batch++)
      await f.request("/api/exams/practice/events", {
        method: "POST",
        cookie: a.cookie,
        data: {
          events: Array.from({ length: 80 }, () => ({
            id: crypto.randomUUID(),
            type: "heartbeat",
            details: {},
          })),
        },
      });
    let cursor = "",
      events = [];
    do {
      const r = await f.request(
        `/api/admin/exams/practice/events?cursor=${encodeURIComponent(cursor)}`,
      );
      events.push(...r.data.events);
      cursor = r.data.next_cursor;
    } while (cursor);
    assert.equal(events.length, 242);
    assert.equal(new Set(events.map((e) => e.id)).size, 242);
    assert.ok(
      events.every(
        (e, i) => i === 0 || events[i - 1].received_at <= e.received_at,
      ),
    );
  }),
);
test(
  "admin API and all admin assets fail closed without configured private authentication",
  withFixture(async (f) => {
    const app = createApp();
    for (const path of [
      "/api/admin/exams",
      "/admin/exams",
      "/admin.html",
      "/admin.mjs",
    ]) {
      const response = await app.fetch(
        new Request(`https://exam.example.invalid${path}`),
        f.env,
        {},
      );
      assert.equal(response.status, 503);
    }
    await assert.rejects(
      () =>
        authenticateAdmin(
          new Request("https://exam.example.invalid/admin/exams"),
          {
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test",
            ADMIN_EMAILS: "owner@example.invalid",
          },
        ),
      (e) => e.status === 401,
    );
  }),
);
test(
  "authorized recovery is single use and preserves deadline, revokes old session",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie);
    const created = await f.request(
      `/api/admin/attempts/${a.data.attempt.id}/recovery`,
      {
        method: "POST",
        data: { confirmed: true, reason: "Synthetic identity verified" },
      },
    );
    assert.equal(created.status, 200);
    const recovered = await f.request("/api/exams/practice/recover", {
      method: "POST",
      data: { token: created.data.recovery_code },
    });
    assert.equal(recovered.data.attempt.id, a.data.attempt.id);
    assert.equal(recovered.data.attempt.deadlineAt, a.data.attempt.deadlineAt);
    assert.equal(
      (await f.request("/api/exams/practice/state", { cookie: a.cookie })).data
        .attempt,
      null,
    );
    assert.equal(
      (
        await f.request("/api/exams/practice/recover", {
          method: "POST",
          data: { token: created.data.recovery_code },
        })
      ).status,
      403,
    );
  }),
);
test(
  "published questions are immutable after opening; draft edits do not leak",
  withFixture(async (f) => {
    await f.configure();
    f.open();
    const changed = await f.request("/api/admin/exams/official/draft", {
      method: "PUT",
      data: {
        expected_version: 1,
        questions: [
          { number: 1, text: "Changed synthetic draft, unpublished" },
        ],
      },
    });
    assert.equal(changed.status, 200);
    const registered = await f.register("official");
    assert.equal(registered.data.attempt.questions.length, 3);
    assert.doesNotMatch(
      JSON.stringify(registered.data),
      /Changed synthetic draft/,
    );
    const schedule = await f.request("/api/admin/exams/official/schedule", {
      method: "POST",
      data: {
        starts_at: new Date(Date.now() + 60000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
        expected_draft_version: 2,
        confirmed: true,
        reason: "changed",
      },
    });
    assert.equal(schedule.status, 409);
  }),
);
test(
  "CSV preserves blank slots, multiline data, and neutralizes spreadsheet formulas",
  withFixture(async (f) => {
    const a = await f.register("practice", { name: " =SUM(1,2)" });
    await f.save(a.cookie, 1, '\t=HYPERLINK("https://invalid")\nmultiline');
    const exported = await f.request("/api/admin/exams/practice/export.csv");
    assert.match(exported.data, /"'=SUM/);
    assert.match(exported.data, /"'\t=HYPERLINK/);
    assert.match(exported.data, /multiline/);
  }),
);
test(
  "outbox failures preserve primary saves and retry without revealing provider content",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie);
    await drainOutbox(f.env, 20, async () => {
      throw new Error("private writing must never reach diagnostics");
    });
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM answers").get().text,
      "Synthetic answer",
    );
    const failed = f.db.sqlite.prepare("SELECT * FROM outbox LIMIT 1").get();
    assert.equal(failed.status, "failed");
    assert.equal(failed.last_error, "Error");
    assert.ok(failed.next_attempt_at > Date.now());
    f.db.sqlite.exec("UPDATE outbox SET next_attempt_at=0");
    const delivered = [];
    await drainOutbox(f.env, 20, async (job) => {
      delivered.push(job);
      return { reference: "synthetic-private-backup" };
    });
    assert.ok(delivered.length >= 2);
    assert.ok(
      delivered.every((j) => j.payload.answers[0].text === "Synthetic answer"),
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE status='sent'")
        .get().n,
      2,
    );
  }),
);
test(
  "crash-recovered finalization recreates missing independent jobs with full blank-inclusive payload",
  withFixture(async (f) => {
    await f.configure(2);
    f.open();
    const a = await f.register("official");
    await f.request("/api/exams/official/submit", {
      method: "POST",
      cookie: a.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    f.db.sqlite.exec(
      "DELETE FROM outbox WHERE target IN ('owner_email','student_receipt')",
    );
    await maintenance(f.env);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE kind='final'")
        .get().n,
      4,
    );
    const job = f.db.sqlite
        .prepare("SELECT * FROM outbox WHERE target='owner_email'")
        .get(),
      payload = await buildDeliveryPayload(f.db, job);
    assert.equal(payload.answers.length, 2);
    assert.ok(payload.answers.every((answer) => answer.text === ""));
    assert.equal(payload.receipt.questionCount, 2);
  }),
);
test(
  "concurrent conflicting save UUID is rejected without replacing its first payload",
  withFixture(async (f) => {
    const a = await f.register(),
      op = crypto.randomUUID(),
      results = await Promise.all([
        f.save(a.cookie, 1, "one", op),
        f.save(a.cookie, 1, "two", op),
      ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM answer_operations").get().n,
      1,
    );
    const winner = results.findIndex((r) => r.status === 200);
    const committed = ["one", "two"][winner];
    assert.equal(f.db.sqlite.prepare("SELECT text FROM answers").get().text, committed);
    assert.equal(f.db.sqlite.prepare("SELECT text FROM answer_operations").get().text, committed);
  }),
);
test(
  "concurrent conflicting event UUID retains first committed observation and returns conflict",
  withFixture(async (f) => {
    const a = await f.register(),
      eventId = crypto.randomUUID();
    const send = (value) =>
      f.request("/api/exams/practice/events", {
        method: "POST",
        cookie: a.cookie,
        data: {
          events: [{ id: eventId, type: "paste", details: { text: value } }],
        },
      });
    const results = await Promise.all([
      send("original observation"),
      send("changed observation"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      JSON.parse(
        f.db.sqlite
          .prepare("SELECT details_json FROM events WHERE id=?")
          .get(eventId).details_json,
      ).text,
      results[0].status === 200
        ? "original observation"
        : "changed observation",
    );
  }),
);
test(
  "deadline crossing during database submission is labeled deadline and preserves prior on-time revision",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "on time");
    const original = f.db.batch;
    let injected = false;
    f.db.batch = async (statements) => {
      if (
        !injected &&
        statements.some((s) =>
          s.sql.includes("UPDATE attempts SET status='finalized'"),
        )
      ) {
        injected = true;
        f.db.sqlite
          .prepare("UPDATE attempts SET deadline_at=?")
          .run(Date.now() - 1000);
      }
      return original(statements);
    };
    const result = await f.request("/api/exams/practice/submit", {
      method: "POST",
      cookie: a.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.attempt.receipt.finalizationType, "deadline");
    assert.equal(result.data.attempt.answers[0].text, "on time");
  }),
);
test(
  "lease takeover between submit precheck and atomic close cannot finalize from stale editor",
  withFixture(async (f) => {
    const a = await f.register(),
      original = f.db.batch;
    let injected = false;
    f.db.batch = async (statements) => {
      if (
        !injected &&
        statements.some((s) =>
          s.sql.includes("UPDATE attempts SET status='finalized'"),
        )
      ) {
        injected = true;
        f.db.sqlite
          .prepare("UPDATE attempts SET lease_editor=?")
          .run("other-editor");
      }
      return original(statements);
    };
    const result = await f.request("/api/exams/practice/submit", {
      method: "POST",
      cookie: a.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    assert.equal(result.status, 423);
    assert.equal(
      f.db.sqlite.prepare("SELECT status FROM attempts").get().status,
      "active",
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM submissions").get().n,
      0,
    );
  }),
);
test(
  "private recovery rotates codes, rejects old registration credential and keeps old work",
  withFixture(async (f) => {
    const credential = crypto.randomUUID(),
      a = await f.register("practice", { registrationId: credential });
    await f.save(a.cookie);
    const authorize = () =>
      f.request(`/api/admin/attempts/${a.data.attempt.id}/recovery`, {
        method: "POST",
        data: { confirmed: true, reason: "Synthetic identity verified" },
      });
    const old = await authorize(),
      fresh = await authorize();
    assert.equal(
      (
        await f.request("/api/exams/practice/recover", {
          method: "POST",
          data: { token: old.data.recovery_code },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/exams/practice/recover", {
          method: "POST",
          data: { token: fresh.data.recovery_code },
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.register("practice", { registrationId: credential })).status,
      401,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      1,
    );
  }),
);
test(
  "server detects heartbeat uncertainty without discipline or editing restriction",
  withFixture(async (f) => {
    const a = await f.register();
    f.db.sqlite
      .prepare("UPDATE attempts SET last_seen_at=?")
      .run(Date.now() - 90000);
    const state = await f.request("/api/exams/practice/state", {
      cookie: a.cookie,
    });
    assert.equal(state.data.attempt.status, "active");
    const event = f.db.sqlite
      .prepare("SELECT * FROM events WHERE type='heartbeat_missing'")
      .get();
    assert.ok(event);
    assert.equal(JSON.parse(event.details_json).cause, "unknown");
    assert.equal((await f.save(a.cookie)).status, 200);
  }),
);
test(
  "practice readiness cannot pass because only a link was opened",
  withFixture(async (f) => {
    const a = await f.register(),
      detail = await f.request(`/api/admin/attempts/${a.data.attempt.id}`);
    assert.equal(detail.data.readiness.registered, true);
    assert.equal(detail.data.readiness.typing, false);
    assert.equal(detail.data.readiness.local_save, false);
    assert.equal(detail.data.readiness.server_save, false);
    assert.equal(detail.data.readiness.finalized, false);
  }),
);
test(
  "audited practice reset preserves old answers/deadline and permits fresh troubleshooting practice",
  withFixture(async (f) => {
    const credential = crypto.randomUUID(),
      a = await f.register("practice", { registrationId: credential });
    await f.save(a.cookie, 1, "old practice work");
    const reset = await f.request(
      `/api/admin/attempts/${a.data.attempt.id}/practice-reset`,
      {
        method: "POST",
        data: { confirmed: true, reason: "Synthetic browser troubleshooting" },
      },
    );
    assert.equal(reset.status, 200);
    assert.equal(
      (await f.request("/api/exams/practice/state", { cookie: a.cookie })).data
        .attempt,
      null,
    );
    const fresh = await f.register("practice", { registrationId: credential });
    assert.equal(fresh.status, 201);
    assert.notEqual(fresh.data.attempt.id, a.data.attempt.id);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT deadline_at FROM attempts WHERE id=?")
        .get(a.data.attempt.id).deadline_at,
      a.data.attempt.deadlineAt,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT text FROM answers WHERE attempt_id=?")
        .get(a.data.attempt.id).text,
      "old practice work",
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM admin_audit WHERE action='practice_reset'",
        )
        .get().n,
      1,
    );
  }),
);
test(
  "next official exam preserves immutable archives and stable empty current student route",
  withFixture(async (f) => {
    await f.configure(2);
    f.open();
    const a = await f.register("official");
    await f.request("/api/exams/official/submit", {
      method: "POST",
      cookie: a.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    f.db.sqlite
      .prepare("UPDATE exams SET ends_at=? WHERE id=?")
      .run(Date.now() - 1000, "official");
    const data = {
        label: "Synthetic next term examination",
        reason: "Previous term completed",
        confirmed: true,
        expected_current_exam_id: "official",
        operation_id: crypto.randomUUID(),
      },
      created = await f.request("/api/admin/exams", { method: "POST", data });
    assert.equal(created.status, 201);
    assert.notEqual(created.data.exam.id, "official");
    assert.equal(created.data.exam.student_url, "/official");
    const retry = await f.request("/api/admin/exams", { method: "POST", data });
    assert.equal(retry.data.exam.id, created.data.exam.id);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM exams WHERE kind='official'")
        .get().n,
      2,
    );
    const student = await f.request("/api/exams/official/state", {
      cookie: a.cookie,
    });
    assert.equal(student.data.exam.status, "UNCONFIGURED");
    assert.equal(student.data.exam.questionCount, 0);
    assert.equal(student.data.attempt, null);
    const archive = await f.request("/api/admin/exams/official");
    assert.equal(archive.data.exam.archived, true);
    assert.equal(archive.data.published.questions.length, 2);
    assert.equal(
      (
        await f.request("/api/admin/exams/official/draft", {
          method: "PUT",
          data: {
            expected_version: 1,
            questions: [{ number: 1, text: "mutate" }],
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.request("/api/exams/archived-official/state")).status,
      404,
    );
    assert.equal(
      (await f.request(`/api/admin/attempts/${a.data.attempt.id}`)).data.receipt
        .questionCount,
      2,
    );
  }),
);
test(
  "new official exam cannot replace scheduled/open examination or replay conflicting operation",
  withFixture(async (f) => {
    await f.configure();
    const data = {
      label: "New exam",
      reason: "Synthetic test",
      confirmed: true,
      expected_current_exam_id: "official",
      operation_id: crypto.randomUUID(),
    };
    assert.equal(
      (await f.request("/api/admin/exams", { method: "POST", data })).status,
      409,
    );
    f.open();
    assert.equal(
      (await f.request("/api/admin/exams", { method: "POST", data })).status,
      409,
    );
  }),
);
test(
  "draft validation rejects key leakage, normalized duplicates and truncation",
  withFixture(async (f) => {
    const save = (questions) =>
      f.request("/api/admin/exams/official/draft", {
        method: "PUT",
        data: { expected_version: 0, questions },
      });
    assert.equal(
      (
        await save([
          { number: 1, text: "Question", instructions: "x".repeat(10001) },
        ])
      ).status,
      400,
    );
    assert.equal(
      (
        await save([
          { number: 1, text: "Question\nSuggested answer: confidential" },
        ])
      ).status,
      400,
    );
    assert.equal(
      (
        await save([
          { number: 1, text: "Question  case" },
          { number: 2, text: "question case" },
        ])
      ).status,
      400,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT draft_version FROM exams WHERE id='official'")
        .get().draft_version,
      0,
    );
  }),
);
test(
  "confirmed rescheduling updates waiting registrants to same version and common deadline as latecomers",
  withFixture(async (f) => {
    await f.configure(2);
    const waiting = await f.register("official");
    const draft = await f.request("/api/admin/exams/official/draft", {
      method: "PUT",
      data: {
        expected_version: 1,
        questions: [
          { number: 1, text: "Replacement approved question one" },
          { number: 2, text: "Replacement approved question two" },
          { number: 3, text: "Replacement approved question three" },
        ],
      },
    });
    assert.equal(draft.status, 200);
    const start = Date.now() + 5000,
      end = start + 3600000,
      scheduled = await f.request("/api/admin/exams/official/schedule", {
        method: "POST",
        data: {
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(end).toISOString(),
          expected_draft_version: 2,
          confirmed: true,
          reason: "Examiner approved revised draft before opening",
        },
      });
    assert.equal(scheduled.status, 200);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT version FROM attempts WHERE id=?")
        .get(waiting.data.attempt.id).version,
      2,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT deadline_at FROM attempts WHERE id=?")
        .get(waiting.data.attempt.id).deadline_at,
      end,
    );
    f.db.sqlite
      .prepare("UPDATE exams SET starts_at=? WHERE slug='official'")
      .run(Date.now() - 1);
    const resumed = await f.request("/api/exams/official/state", {
        cookie: waiting.cookie,
      }),
      late = await f.register("official");
    assert.deepEqual(
      resumed.data.attempt.questions,
      late.data.attempt.questions,
    );
    assert.equal(resumed.data.attempt.deadlineAt, late.data.attempt.deadlineAt);
    assert.match(resumed.data.attempt.questions[0].text, /Replacement/);
  }),
);
test(
  "primary database outage never acknowledges an uncommitted answer and retry recovers",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "known committed");
    const original = f.db.batch,
      op = crypto.randomUUID();
    f.db.batch = async () => {
      throw new Error("synthetic database outage");
    };
    const failed = await f.save(a.cookie, 2, "pending browser writing", op);
    assert.equal(failed.status, 503);
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM answers").get().text,
      "known committed",
    );
    f.db.batch = original;
    assert.equal(
      (await f.save(a.cookie, 2, "pending browser writing", op)).status,
      200,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT text FROM answers").get().text,
      "pending browser writing",
    );
  }),
);
test(
  "concurrent outbox drains serialize each attempt and target",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie, 1, "revision one");
    await f.save(a.cookie, 2, "revision two");
    const active = new Set(),
      seen = [];
    const deliver = async (job) => {
      const key = `${job.attempt_id}:${job.target}`;
      assert.equal(active.has(key), false);
      active.add(key);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(job.id);
      active.delete(key);
      return { reference: "synthetic" };
    };
    await Promise.all([
      drainOutbox(f.env, 20, deliver),
      drainOutbox(f.env, 20, deliver),
    ]);
    assert.equal(new Set(seen).size, seen.length);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT COUNT(*) n FROM outbox WHERE status='sent'")
        .get().n,
      3,
    );
  }),
);
test(
  "pending final Sheets mirror cannot overtake an older remote write after the former 180-second lease",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie);
    f.db.sqlite.exec("UPDATE outbox SET status='sent' WHERE target='r2'");
    let release, started;
    const gate = new Promise((resolve) => (release = resolve)),
      entered = new Promise((resolve) => (started = resolve)),
      deliveries = [];
    const deliver = async (job) => {
      if (job.target === "sheets" && job.kind === "snapshot") {
        started();
        await gate;
      }
      deliveries.push({
        target: job.target,
        kind: job.kind,
        receipt: job.payload.receipt,
      });
      return { reference: "synthetic" };
    };
    const first = drainOutbox(f.env, 20, deliver);
    await entered;
    const lease = f.db.sqlite.prepare("SELECT lease_until FROM outbox WHERE target='sheets' AND status='processing'").get();
    assert.ok(lease.lease_until > Date.now() + 350000);
    assert.ok(lease.lease_until <= Date.now() + 360100);
    // Advance past the former lease while Google could still be processing a
    // client-aborted request. A newer final copy must remain behind this lock.
    f.db.sqlite.exec("UPDATE outbox SET lease_until=lease_until-181000 WHERE target='sheets' AND status='processing'");
    await f.request("/api/exams/practice/submit", {
      method: "POST",
      cookie: a.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    await drainOutbox(f.env, 20, deliver);
    assert.equal(
      deliveries.some((j) => j.target === "sheets" && j.kind === "final"),
      false,
    );
    release();
    await first;
    await drainOutbox(f.env, 20, deliver);
    const sheets = deliveries.filter((j) => j.target === "sheets");
    assert.deepEqual(
      sheets.map((j) => j.kind),
      ["snapshot", "final"],
    );
    assert.ok(sheets[1].receipt);
  }),
);
test(
  "backup pages and summary expose failures beyond first 100 records",
  withFixture(async (f) => {
    const a = await f.register();
    const insert = f.db.sqlite.prepare(
      "INSERT INTO outbox(id,target,attempt_id,dedupe_key,kind,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,'failed',0,?)",
    );
    for (let i = 0; i < 205; i++)
      insert.run(
        crypto.randomUUID(),
        "r2",
        a.data.attempt.id,
        `synthetic-${i}`,
        "snapshot",
        Date.now() + i,
      );
    const first = await f.request(
      "/api/admin/exams/practice/backups?status=failed",
    );
    assert.equal(first.data.summary.failed, 205);
    assert.equal(first.data.jobs.length, 100);
    let cursor = "",
      jobs = [];
    do {
      const response = await f.request(
        `/api/admin/exams/practice/backups?status=failed&cursor=${encodeURIComponent(cursor)}`,
      );
      jobs.push(...response.data.jobs);
      cursor = response.data.next_cursor;
    } while (cursor);
    assert.equal(jobs.length, 205);
    assert.equal(new Set(jobs.map((j) => j.id)).size, 205);
  }),
);
for (const count of [13, 25, 50])
  test(
    `${count} concurrent unlisted students can register with no enrollment cap`,
    withFixture(async (f) => {
      await f.configure(20);
      f.open();
      const results = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          f.register("official", { email: `load-${i}@example.invalid` }),
        ),
      );
      assert.ok(results.every((r) => r.status === 201));
      assert.equal(new Set(results.map((r) => r.data.attempt.id)).size, count);
      assert.equal(
        new Set(results.map((r) => r.data.attempt.deadlineAt)).size,
        1,
      );
    }),
  );
test("Access JWT signature, audience, issuer, expiry and allowlisted identity are verified", async () => {
  const keys = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    ),
    publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  publicKey.kid = "synthetic-key";
  const b64 = (bytes) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_"),
    encode = (value) => b64(new TextEncoder().encode(JSON.stringify(value))),
    env = {
      ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com",
      ACCESS_AUD: "synthetic-audience",
      ADMIN_EMAILS: "owner@example.invalid",
    },
    claims = {
      iss: "https://synthetic.cloudflareaccess.com",
      aud: ["synthetic-audience"],
      email: "owner@example.invalid",
      sub: "synthetic-user",
      exp: Math.floor(Date.now() / 1000) + 60,
    };
  const sign = async (payload) => {
    const data = `${encode({ alg: "RS256", kid: "synthetic-key" })}.${encode(payload)}`;
    return `${data}.${b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data))))}`;
  };
  const request = (jwt) =>
      new Request("https://exam.example.invalid/admin/exams", {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
      }),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(
      url,
      "https://synthetic.cloudflareaccess.com/cdn-cgi/access/certs",
    );
    return Response.json({ keys: [publicKey] });
  };
  try {
    const signed = await sign(claims),
      owner = await authenticateAdmin(request(signed), env);
    assert.equal(owner.email, "owner@example.invalid");
    assert.equal(owner.role, "owner");
    assert.equal(
      (
        await authenticateAdmin(request(signed), {
          ...env,
          ADMIN_EMAILS: "other@example.invalid",
          EXAMINER_EMAILS: "owner@example.invalid",
        })
      ).role,
      "examiner",
    );
    for (const patch of [
      { aud: ["other-audience"] },
      { iss: "https://evil.invalid" },
      { email: "stranger@example.invalid" },
      { exp: 1 },
      { exp: "never" },
      { nbf: Math.floor(Date.now() / 1000) + 3600 },
    ])
      await assert.rejects(
        () =>
          sign({ ...claims, ...patch }).then((jwt) =>
            authenticateAdmin(request(jwt), env),
          ),
        (e) => e.status === 401,
      );
    const pieces = signed.split(".");
    pieces[1] = encode({ ...claims, sub: "forged-user" });
    await assert.rejects(
      () => authenticateAdmin(request(pieces.join(".")), env),
      (e) => e.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test(
  "readonly examiner can inspect/export but every admin mutation is denied",
  withFixture(async (f) => {
    const app = createApp({
        authenticateAdmin: async () => ({
          email: "examiner@example.invalid",
          role: "examiner",
        }),
      }),
      call = async (path, method = "GET") =>
        app.fetch(
          new Request(`https://exam.example.invalid${path}`, {
            method,
            headers:
              method === "GET"
                ? {}
                : {
                    Origin: "https://exam.example.invalid",
                    "Content-Type": "application/json",
                  },
            body: method === "GET" ? undefined : "{}",
          }),
          f.env,
          {},
        );
    assert.equal((await call("/api/admin/exams")).status, 200);
    assert.equal(
      (await call("/api/admin/exams/practice/export.csv")).status,
      200,
    );
    for (const [path, method] of [
      ["/api/admin/exams/official/draft", "PUT"],
      ["/api/admin/exams/official/schedule", "POST"],
      ["/api/admin/exams", "POST"],
      ["/api/admin/attempts/guessed/recovery", "POST"],
      ["/api/admin/jobs/guessed/retry", "POST"],
    ])
      assert.equal((await call(path, method)).status, 403);
  }),
);
test(
  "new-registration network burst limit does not cap enrollment or block an existing session",
  withFixture(async (f) => {
    const credential = crypto.randomUUID(),
      a = await f.register("practice", { registrationId: credential });
    f.db.sqlite.exec("UPDATE registration_windows SET requests=600");
    assert.equal((await f.register()).status, 429);
    assert.equal(
      (await f.register("practice", { registrationId: credential })).status,
      200,
    );
    assert.equal((await f.save(a.cookie)).status, 200);
    f.env.REGISTRATION_BURST_LIMIT = "10000";
    assert.equal((await f.register()).status, 201);
  }),
);
test(
  "oversized JSON body is bounded before parsing or database writes",
  withFixture(async (f) => {
    const response = await f.request("/api/exams/practice/attempt", {
      method: "POST",
      data: { padding: "x".repeat(1500001) },
    });
    assert.equal(response.status, 413);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      0,
    );
  }),
);
test(
  "manual retry cannot steal an active delivery lease and stale completion cannot change a new claim",
  withFixture(async (f) => {
    const a = await f.register();
    await f.save(a.cookie);
    const job = f.db.sqlite.prepare("SELECT * FROM outbox LIMIT 1").get();
    f.db.sqlite
      .prepare(
        "UPDATE outbox SET status='processing',lease_until=?,claim_token='active' WHERE id=?",
      )
      .run(Date.now() + 60000, job.id);
    assert.equal(
      (
        await f.request(`/api/admin/jobs/${job.id}/retry`, {
          method: "POST",
          data: {},
        })
      ).status,
      409,
    );
    f.db.sqlite
      .prepare("UPDATE outbox SET status='pending',lease_until=0 WHERE id=?")
      .run(job.id);
    await drainOutbox(f.env, 1, async (item) => {
      f.db.sqlite
        .prepare("UPDATE outbox SET claim_token='newer-claim' WHERE id=?")
        .run(item.id);
      return { reference: "old-completion" };
    });
    const changed = f.db.sqlite
      .prepare("SELECT * FROM outbox WHERE claim_token='newer-claim'")
      .get();
    assert.ok(changed);
    assert.equal(changed.status, "processing");
    assert.equal(changed.reference, null);
  }),
);
test(
  "explicit admission rotation protects new access while preserving existing answers, deadlines and receipts",
  withFixture(async (f) => {
    const original = await f.register();
    await f.save(original.cookie, 1, "preserved before rotation");
    const rotate = await f.request("/api/admin/exams/practice/access-link", {
      method: "POST",
      data: {
        action: "rotate",
        confirmed: true,
        reason: "Synthetic leaked admission link",
        operation_id: crypto.randomUUID(),
      },
    });
    assert.equal(rotate.status, 200);
    const link = new URL(
        rotate.data.exam.student_url,
        "https://exam.example.invalid",
      ),
      key = link.searchParams.get("access");
    assert.equal(key.length, 64);
    assert.equal((await f.request("/api/exams/practice/state")).status, 403);
    const publicState = await f.request(
      `/api/exams/practice/state?access=${key}`,
    );
    assert.equal(publicState.status, 200);
    assert.doesNotMatch(JSON.stringify(publicState.data), new RegExp(key));
    const resumed = await f.request("/api/exams/practice/state", {
      cookie: original.cookie,
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.attempt.id, original.data.attempt.id);
    assert.equal(
      resumed.data.attempt.deadlineAt,
      original.data.attempt.deadlineAt,
    );
    assert.equal(
      (await f.save(original.cookie, 2, "preserved after rotation")).status,
      200,
    );
    const joined = await f.request(
      `/api/exams/practice/attempt?access=${key}`,
      {
        method: "POST",
        data: {
          name: "New valid link student",
          email: "new@example.invalid",
          consent: true,
          oneBrowser: true,
          editorId: "new-editor",
          registrationId: crypto.randomUUID(),
        },
      },
    );
    assert.equal(joined.status, 201);
    const done = await f.request("/api/exams/practice/submit", {
      method: "POST",
      cookie: original.cookie,
      data: { operationId: crypto.randomUUID(), editorId: "editor-one" },
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.attempt.answers[0].text, "preserved after rotation");
    const checksum = done.data.attempt.receipt.checksum;
    await f.request("/api/admin/exams/practice/access-link", {
      method: "POST",
      data: {
        action: "revoke",
        confirmed: true,
        reason: "Synthetic admission closed",
      },
    });
    const receipt = await f.request("/api/exams/practice/state", {
      cookie: original.cookie,
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.attempt.receipt.checksum, checksum);
    assert.doesNotMatch(
      JSON.stringify(
        f.db.sqlite.prepare("SELECT details_json FROM admin_audit").all(),
      ),
      new RegExp(key),
    );
  }),
);
test(
  "revoke affects new admission only, existing waiting students still auto-open and save",
  withFixture(async (f) => {
    await f.configure();
    const waiting = await f.register("official");
    const revoked = await f.request("/api/admin/exams/official/access-link", {
      method: "POST",
      data: {
        action: "revoke",
        confirmed: true,
        reason: "Synthetic new-admission pause",
      },
    });
    assert.equal(revoked.data.exam.admission_enabled, false);
    assert.equal((await f.register("official")).status, 403);
    assert.equal(
      (await f.request("/api/exams/official/state", { cookie: waiting.cookie }))
        .status,
      200,
    );
    f.open();
    const opened = await f.request("/api/exams/official/state", {
      cookie: waiting.cookie,
    });
    assert.equal(opened.data.attempt.status, "active");
    assert.equal(opened.data.attempt.questions.length, 3);
    assert.equal(
      (
        await f.save(
          waiting.cookie,
          1,
          "continued despite closed admission",
          crypto.randomUUID(),
          opened.data.attempt.questions[0].id,
          "editor-one",
          "official",
        )
      ).status,
      200,
    );
    const enabled = await f.request("/api/admin/exams/official/access-link", {
      method: "POST",
      data: {
        action: "enable",
        confirmed: true,
        reason: "Synthetic new admission resumed",
      },
    });
    assert.equal(enabled.data.exam.student_url, "/official");
    assert.equal((await f.register("official")).status, 201);
  }),
);
test(
  "admission rotation retries are idempotent and ordinary draft uploads preserve the selected link",
  withFixture(async (f) => {
    const data = {
        action: "rotate",
        confirmed: true,
        reason: "Synthetic rotation with response retry",
        operation_id: crypto.randomUUID(),
      },
      results = await Promise.all(
        Array.from({ length: 5 }, () =>
          f.request("/api/admin/exams/official/access-link", {
            method: "POST",
            data,
          }),
        ),
      );
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(new Set(results.map((r) => r.data.exam.student_url)).size, 1);
    const link = results[0].data.exam.student_url;
    await f.request("/api/admin/exams/official/draft", {
      method: "PUT",
      data: {
        expected_version: 0,
        questions: [
          { number: 1, text: "Synthetic instructor supplied question" },
        ],
      },
    });
    assert.equal(
      (await f.request("/api/admin/exams/official")).data.exam.student_url,
      link,
    );
    const conflicting = await f.request(
      "/api/admin/exams/official/access-link",
      { method: "POST", data: { ...data, action: "revoke" } },
    );
    assert.equal(conflicting.status, 409);
  }),
);
test(
  "revocation between admission precheck and database insertion does not admit a new student",
  withFixture(async (f) => {
    const original = f.db.batch;
    let revoked = false;
    f.db.batch = async (statements) => {
      if (
        !revoked &&
        statements.some((s) => s.sql.includes("INSERT OR IGNORE INTO attempts"))
      ) {
        revoked = true;
        f.db.sqlite.exec(
          "UPDATE exams SET admission_enabled=0 WHERE id='practice'",
        );
      }
      return original(statements);
    };
    const response = await f.register();
    assert.equal(response.status, 403);
    assert.equal(
      f.db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n,
      0,
    );
  }),
);
test(
  "authorized recovery remains usable after admission revocation",
  withFixture(async (f) => {
    const a = await f.register(),
      recovery = await f.request(
        `/api/admin/attempts/${a.data.attempt.id}/recovery`,
        {
          method: "POST",
          data: {
            confirmed: true,
            reason: "Synthetic staff verified identity",
          },
        },
      );
    await f.request("/api/admin/exams/practice/access-link", {
      method: "POST",
      data: {
        action: "revoke",
        confirmed: true,
        reason: "Synthetic admission revoked",
      },
    });
    const restored = await f.request("/api/exams/practice/recover", {
      method: "POST",
      data: { token: recovery.data.recovery_code },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.attempt.id, a.data.attempt.id);
    assert.equal(
      (
        await f.request("/api/exams/practice/state", {
          cookie: restored.cookie,
        })
      ).status,
      200,
    );
  }),
);
