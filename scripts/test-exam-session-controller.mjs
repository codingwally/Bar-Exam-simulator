import assert from 'node:assert/strict';

await import('../assets/exam-session-controller.js');
const { STRICT_SECONDS, createExamSessionController } = globalThis.DueDiligenceExamSession;

let nowMs = 0;
let nextIntervalId = 1;
const intervals = new Map();
const expirations = [];
const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};

function makeController(overrides = {}) {
  return createExamSessionController({
    now: () => nowMs,
    storage,
    storageKey: 'timer-test',
    setIntervalFn: (fn) => {
      const id = nextIntervalId++;
      intervals.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => intervals.delete(id),
    onExpire: (state) => expirations.push(state.currentQuestionId),
    ...overrides,
  });
}

const controller = makeController();
controller.beginSession('strict', 'LAB-001', { restore: false });
assert.equal(controller.snapshot().remainingSeconds, STRICT_SECONDS);
assert.equal(controller.activeIntervalCount(), 1);

nowMs = 120_000;
controller.tick();
assert.equal(controller.snapshot().remainingSeconds, 600);

controller.switchMode('selfPaced');
nowMs = 240_000;
controller.tick();
assert.equal(controller.snapshot().questionElapsedSeconds, 240);
assert.equal(controller.snapshot().remainingSeconds, 0);

controller.switchMode('strict');
assert.equal(
  controller.snapshot().remainingSeconds,
  480,
  'switching into Strict must not grant a fresh twelve minutes',
);

nowMs = 720_000;
controller.tick();
controller.tick();
assert.equal(controller.snapshot().remainingSeconds, 0);
assert.equal(expirations.length, 1, 'Strict expiration must fire exactly once.');
assert.equal(controller.markAutomaticAdvanceHandled(), true);
assert.equal(controller.markAutomaticAdvanceHandled(), false, 'expiration handling must be idempotent');

controller.startQuestion('LAB-002');
assert.equal(controller.snapshot().remainingSeconds, STRICT_SECONDS);
assert.equal(controller.snapshot().questionElapsedSeconds, 0);
assert.equal(controller.snapshot().totalElapsedSeconds, 720);

nowMs = 750_000;
controller.switchMode('none');
assert.equal(controller.activeIntervalCount(), 0, 'Summary Judgment needs no visible ticker');
nowMs = 810_000;
assert.equal(
  controller.snapshot().questionElapsedSeconds,
  90,
  'Summary Judgment must continue recording elapsed time in the background',
);

controller.switchMode('selfPaced');
assert.equal(controller.snapshot().questionElapsedSeconds, 90);
assert.equal(controller.activeIntervalCount(), 1);

controller.pause();
nowMs = 900_000;
assert.equal(controller.snapshot().questionElapsedSeconds, 90, 'paused time must not drift');
controller.resume();
assert.equal(controller.activeIntervalCount(), 1);

nowMs = 910_000;
controller.tick();
assert.equal(controller.snapshot().questionElapsedSeconds, 100);

const restoredExpirations = [];
const restored = makeController({
  onExpire: (state) => restoredExpirations.push(state.currentQuestionId),
});
assert.equal(restored.restore('LAB-002'), true);
assert.equal(restored.snapshot().questionElapsedSeconds, 100);
nowMs = 940_000;
assert.equal(
  restored.snapshot().questionElapsedSeconds,
  130,
  'reload reconstruction must use persisted wall-clock timestamps',
);
assert.equal(restoredExpirations.length, 0);

restored.stop({ reset: false });
assert.equal(restored.snapshot().status, 'stopped');
assert.equal(restored.activeIntervalCount(), 0);

controller.stop();
assert.equal(controller.activeIntervalCount(), 0);

console.log('Exam session controller tests passed.');
