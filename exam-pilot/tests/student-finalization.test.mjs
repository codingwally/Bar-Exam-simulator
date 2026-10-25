import test from "node:test";
import assert from "node:assert/strict";
import { ExamApp } from "../public/student.mjs";

const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const state = finalized => ({
  serverTime: 1792814400000,
  exam: { id: "practice", title: "Synthetic exam", kind: "practice", status: "OPEN", questionCount: 1 },
  attempt: {
    id: "synthetic-final-attempt", name: "Synthetic student", email: "synthetic@example.invalid",
    status: finalized ? "finalized" : "active", startAt: 1792814400000, deadlineAt: 1792814700000,
    questions: [{ id: "q1", number: 1, text: "Synthetic question" }],
    answers: [{ questionId: "q1", revision: 1, text: "Saved complete answer", hash: "synthetic-hash", savedAt: 1792814400000 }],
    receipt: finalized ? { id: "synthetic-receipt", checksum: "immutable-checksum", questionCount: 1, answeredCount: 1, serverTime: 1792814410000 } : null,
  },
});

function controller(t, { initiallyFinalized = false } = {}) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const prior = new Map();
  const window = new EventTarget(), document = new EventTarget(), root = new EventTarget();
  window.getSelection = () => "";
  Object.assign(document, { hidden: false, visibilityState: "visible", activeElement: null });
  root.querySelectorAll = () => [];
  for (const [name, value] of Object.entries({ window, document, location: { hash: "", pathname: "/practice", search: "" } })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  t.after(() => {
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const calls = [], values = new Map(), controls = { finalized: initiallyFinalized, failEvents: 0, failRecovery: 0 };
  let app;
  app = new ExamApp(root, { slug: "practice", fetcher: async (url, options) => {
    const path = new URL(url, "https://synthetic.invalid").pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path.endsWith("/submit")) { controls.finalized = true; return Response.json(state(true)); }
    if (path.endsWith("/events")) {
      if (controls.failEvents-- > 0) return Response.json({ error: { code: "synthetic_outage" } }, { status: 503 });
      return Response.json({ accepted: body.events.map(event => event.id) });
    }
    if (path.endsWith("/recovery")) {
      if (controls.failRecovery-- > 0) return Response.json({ error: { code: "synthetic_outage" } }, { status: 503 });
      return Response.json({ recovered: true });
    }
    if (path.endsWith("/lease")) return Response.json({ lease: { editorId: app.editorId } });
    assert.ok(path.endsWith("/state"));
    return Response.json(state(controls.finalized));
  } });
  app.online = true;
  app.storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  app.acquireDeviceLock = async () => (app.deviceLock = true);
  for (const method of ["render", "updateSave", "updateWritable", "message", "updateToolsExpanded"]) app[method] = () => {};
  return { app, calls, controls, window, document, root };
}

test("manual submission leaves a stable receipt through 200 old heartbeat cycles with no periodic or focus writes", async t => {
  const { app, calls, window, document, root } = controller(t);
  await app.start(); await drain();
  await app.submit(); await drain();
  assert.ok(app.state.attempt.receipt);
  const receipt = JSON.stringify(app.state.attempt.receipt), before = calls.length;
  for (let i = 0; i < 200; i++) {
    t.mock.timers.tick(30000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    root.dispatchEvent(new Event("copy"));
    await drain();
  }
  assert.equal(calls.length, before, "An idle/focused receipt creates no state, lease or event requests");
  assert.equal(JSON.stringify(app.state.attempt.receipt), receipt);
  for (const timer of ["timer", "poller", "heartbeat", "leaseTimer", "syncTimer", "finalRetryTimer"]) assert.ok(!app[timer]);
  assert.equal(app.store.state.events.length, 0);
});

test("opening a previously finalized receipt starts no periodic requests or new session activity", async t => {
  const { app, calls } = controller(t, { initiallyFinalized: true });
  await app.start(); await drain();
  t.mock.timers.tick(30000 * 200); await drain();
  assert.deepEqual(calls.map(call => call.path), ["/api/exams/practice/state"]);
  assert.equal(app.state.attempt.receipt.id, "synthetic-receipt");
});

test("pre-final evidence retries with original IDs and timestamps, then the receipt becomes idle", async t => {
  const { app, calls, controls } = controller(t);
  await app.start(); await drain();
  app.record("beforeunload", { delivery: "best-effort" });
  const queued = structuredClone(app.store.state.events);
  app.online = false;
  await app.acceptState(state(true)); await drain();
  controls.failEvents = 1; app.online = true;
  await app.refresh(); await drain();
  assert.equal(app.store.state.events.length, queued.length);
  t.mock.timers.tick(30000); await drain();
  assert.equal(app.store.state.events.length, 0);
  const sent = calls.filter(call => call.path.endsWith("/events")).flatMap(call => call.body.events);
  for (const event of queued) assert.ok(sent.some(item => item.id === event.eventId && item.clientTime === event.clientTime && item.type === event.category));
  const before = calls.length;
  t.mock.timers.tick(30000 * 200); await drain();
  assert.equal(calls.length, before);
});

test("late offline writing can retry separately after finalization without restarting exam polling", async t => {
  const { app, calls, controls } = controller(t);
  await app.start(); await drain();
  app.store.write("q1", "Late offline paragraph retained separately.");
  controls.failRecovery = 1;
  await app.acceptState(state(true)); await drain();
  const receipt = JSON.stringify(app.state.attempt.receipt);
  t.mock.timers.tick(30000); await drain();
  const recovery = calls.filter(call => call.path.endsWith("/recovery"));
  assert.equal(recovery.length, 2);
  assert.equal(recovery[0].body.operationId, recovery[1].body.operationId);
  assert.equal(recovery[1].body.text, "Late offline paragraph retained separately.");
  const before = calls.length;
  t.mock.timers.tick(30000 * 200); await drain();
  assert.equal(calls.length, before);
  assert.equal(JSON.stringify(app.state.attempt.receipt), receipt);
});

test("receipt pagehide keeps one best-effort unload record while heartbeat and browsing activity stay stopped", async t => {
  const { app, calls, window } = controller(t, { initiallyFinalized: true });
  await app.start(); await drain();
  window.dispatchEvent(new Event("pagehide")); await drain();
  const events = calls.filter(call => call.path.endsWith("/events")).flatMap(call => call.body.events);
  assert.deepEqual(events.map(event => event.type), ["pagehide"]);
  assert.equal(events[0].details.delivery, "best-effort");
  assert.equal(typeof events[0].clientTime, "string");
  assert.equal(app.state.attempt.receipt.id, "synthetic-receipt");
});
