import test from "node:test";
import assert from "node:assert/strict";
import {
  countdownText,
  ServerClock,
  saveSummary,
  toMillis,
  ExamApp,
  activityBatch,
  activityDetails,
  examSlug,
  textSize,
} from "../public/student.mjs";

test("exam links retain the actual dynamic slug for cookies, APIs and draft isolation", () => {
  assert.equal(examSlug("/exam/practice-6c07a1/"), "practice-6c07a1");
  assert.equal(examSlug("/practice"), "practice");
  assert.equal(examSlug("/official"), "official");
});
test("readability controls keep text sizes within usable bounds", () => {
  assert.equal(textSize(3), 14);
  assert.equal(textSize(100), 26);
  assert.equal(textSize("21"), 21);
  assert.equal(textSize(undefined), 18);
});
test("dynamic practice titles and durations use the configured examination", () => {
  const app = {
    slug: "practice-unique",
    state: {
      exam: {
        title: "Civil Law practice",
        kind: "practice",
        durationMinutes: 45,
      },
    },
    isPractice: ExamApp.prototype.isPractice,
  };
  assert.equal(ExamApp.prototype.examTitle.call(app), "Civil Law practice");
  assert.equal(app.isPractice(), true);
  assert.equal(ExamApp.prototype.durationMinutes.call(app), 45);
});
test("dynamic exams bootstrap one server-only browser session before exam API traffic", async () => {
  const calls = [];
  const app = new ExamApp(
    {},
    {
      slug: "practice-opaque",
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return new Response(
          JSON.stringify(
            url === "/api/browser/session"
              ? { ready: true }
              : { serverTime: 1792814400000 },
          ),
        );
      },
    },
  );
  await app.request();
  await app.request();
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/api/browser/session",
      "/api/exams/practice-opaque/state",
      "/api/exams/practice-opaque/state",
    ],
  );
  assert.equal(calls[0].options.body, "{}");
  assert.equal(calls[0].options.credentials, "same-origin");
});
test("a failed browser-session bootstrap can retry without leaking a client credential", async () => {
  let tries = 0;
  const app = new ExamApp(
    {},
    {
      slug: "practice-opaque",
      fetcher: async (url) =>
        new Response(
          JSON.stringify(url === "/api/browser/session" ? { ready: true } : {}),
          { status: url === "/api/browser/session" && !tries++ ? 503 : 200 },
        ),
    },
  );
  await assert.rejects(app.request(), /browser session could not be prepared/);
  await app.request();
  assert.equal(tries, 2);
});
test("an evicted browser cookie retries registration once with exactly the same private exam key", async () => {
  const calls = [];
  let registrations = 0;
  const app = new ExamApp(
    {},
    {
      slug: "practice-opaque",
      fetcher: async (url, options) => {
        calls.push({ url, body: options.body });
        return new Response(
          JSON.stringify(
            url.endsWith("/attempt") && !registrations++
              ? {
                  error: {
                    code: "browser_session_required",
                    message: "Prepare session",
                  },
                }
              : { ready: true },
          ),
          {
            status: url.endsWith("/attempt") && registrations === 1 ? 409 : 200,
          },
        );
      },
    },
  );
  await app.request("/attempt", {
    method: "POST",
    body: { registrationId: "unchanged-private-key" },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/api/browser/session",
      "/api/exams/practice-opaque/attempt",
      "/api/browser/session",
      "/api/exams/practice-opaque/attempt",
    ],
  );
  assert.equal(calls[1].body, calls[3].body);
});
test("a lost shared-cookie mapping reattaches only the already admitted exam with its existing key", async () => {
  const calls = [],
    values = new Map([
      ["dd-exam:practice-opaque:registration", "existing-private-exam-key"],
    ]);
  const existing = {
    id: "attempt-prior",
    name: "Synthetic prior student",
    email: "prior@example.test",
  };
  const app = {
    slug: "practice-opaque",
    editorId: "this-editor",
    state: { exam: { id: "exam-prior" }, attempt: existing },
    storage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
    async request(path, options) {
      calls.push({ path, options });
      return {
        exam: { id: "exam-prior", status: "OPEN" },
        attempt: path === "/attempt" ? existing : null,
      };
    },
    async acceptState(data) {
      this.accepted = data;
    },
  };
  await ExamApp.prototype.refresh.call(app);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/attempt");
  assert.equal(
    calls[1].options.body.registrationId,
    "existing-private-exam-key",
  );
  assert.equal(app.accepted.attempt.id, existing.id);
  assert.equal(app.refreshing, false);
});

test("scheduled countdown is continuous at every required early-arrival interval", () => {
  for (const [seconds, expected] of [
    [172800, "2 days 00:00:00"],
    [7200, "02:00:00"],
    [1200, "00:20:00"],
    [360, "00:06:00"],
    [240, "00:04:00"],
    [30, "00:00:30"],
  ])
    assert.equal(countdownText(seconds * 1000), expected);
});
test("practice timer shows minutes and seconds and stops at zero", () => {
  assert.equal(countdownText(299000, true), "04:59");
  assert.equal(countdownText(-1000, true), "00:00");
  assert.equal(countdownText(0), "00:00:00");
});
test("server clock supports epoch milliseconds and ISO without using a changed device clock", () => {
  let tick = 10;
  const clock = new ServerClock(() => tick);
  const epoch = 1792814400000;
  clock.set(epoch);
  tick += 2500;
  assert.equal(clock.now(), epoch + 2500);
  clock.set(new Date(epoch).toISOString());
  tick += 500;
  assert.equal(clock.now(), epoch + 500);
  assert.equal(toMillis(epoch), epoch);
});
test("clock bounds network latency compensation", () => {
  const clock = new ServerClock(() => 0);
  clock.set(100000, 40000);
  assert.equal(clock.now(), 102000);
});
test("honest save status never says server saved while a draft is pending", () => {
  const store = {
    durable: true,
    pending: () => [{}],
    state: { answers: { Q1: { savedAt: 1000 } } },
  };
  assert.match(
    saveSummary(store, false, () => "12:00:00").text,
    /not yet synced/,
  );
  store.pending = () => [];
  assert.match(
    saveSummary(store, true, () => "12:00:00").text,
    /Saved to server at 12:00:00 PHT/,
  );
  store.durable = false;
  assert.match(
    saveSummary(store, true, () => "").text,
    /storage is unavailable/,
  );
});
test("visual timer expiry checks server state and cannot request an early manual submission", () => {
  let checks = 0;
  const app = {
    state: { exam: { status: "OPEN" } },
    clock: { now: () => 101 },
    deadline: () => 100,
    root: { querySelectorAll: () => [] },
    screen: "exam",
    closedLocally: false,
    updateWritable() {},
    updateSave() {},
    record() {},
    refresh: () => {
      checks++;
      return Promise.resolve();
    },
    submit() {
      throw new Error("A client timer must not manually submit");
    },
  };
  ExamApp.prototype.tick.call(app);
  assert.equal(checks, 1);
  assert.equal(app.closedLocally, true);
});
test("HTTP fetch retains the global receiver required by browser fetch", async () => {
  const app = new ExamApp(
    {},
    {
      slug: "practice",
      fetcher: function () {
        assert.equal(this, globalThis);
        return Promise.resolve(
          new Response(JSON.stringify({ serverTime: 1792814400000 })),
        );
      },
    },
  );
  const result = await app.request();
  assert.equal(result.serverTime, 1792814400000);
});
test("long queued clipboard records use bounded UTF-8 batches without truncating exact contents", () => {
  const text = "漢字".repeat(60000);
  const queue = Array.from({ length: 12 }, (_, i) => ({
    eventId: `event-${i}`,
    category: "paste",
    questionId: "Q1",
    clientTime: new Date().toISOString(),
    detail: { pastedText: text },
    provenance: "browser-observed",
  }));
  const batch = activityBatch(queue);
  assert.ok(batch.length < queue.length);
  assert.ok(
    new TextEncoder().encode(JSON.stringify({ events: batch })).byteLength <
      900000,
  );
  assert.equal(batch[0].details.pastedText, text);
  assert.equal(queue.length, 12);
});
test("oversized clipboard content is exactly reconstructable from ordered bounded Unicode-safe parts", () => {
  const text = '\u0000\n"\\漢字😀'.repeat(35000);
  for (const [type, field] of [
    ["copy", "selectedText"],
    ["cut", "selectedText"],
    ["paste", "pastedText"],
  ]) {
    const parts = activityDetails(
      type,
      { [field]: text, readable: true },
      () => "synthetic-group",
    );
    assert.ok(parts.length > 1);
    assert.equal(parts.map((part) => part[field]).join(""), text);
    assert.ok(
      parts.every(
        (part, index) =>
          part.groupId === "synthetic-group" &&
          part.part === index + 1 &&
          part.parts === parts.length &&
          part.originalCharacters === text.length &&
          JSON.stringify(part).length < 220000,
      ),
    );
    assert.ok(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part[field])));
  }
});
