import assert from 'node:assert/strict';

await import('../assets/exam-session-controller.js');
const { STRICT_SECONDS, createExamSessionController } = globalThis.DueDiligenceExamSession;

let nowMs = 0;
let nextIntervalId = 1;
const intervals = new Map();
const expirations = [];
const controller = createExamSessionController({
  now: () => nowMs,
  setIntervalFn: (fn) => {
    const id = nextIntervalId++;
    intervals.set(id, fn);
    return id;
  },
  clearIntervalFn: (id) => intervals.delete(id),
  onExpire: (state) => expirations.push(state.currentQuestionId),
});

controller.beginSession('strict', 'LAB-001');
assert.equal(controller.snapshot().remainingSeconds, STRICT_SECONDS);
assert.equal(controller.activeIntervalCount(), 1);
assert.equal(intervals.size, 1);

nowMs = 120_000;
controller.tick();
assert.equal(controller.snapshot().remainingSeconds, 600, 'Strict timer must derive remaining time from timestamps.');

controller.pause();
assert.equal(controller.snapshot().status, 'paused');
assert.equal(controller.snapshot().remainingSeconds, 600);
assert.equal(controller.activeIntervalCount(), 0);

nowMs = 240_000;
assert.equal(controller.snapshot().remainingSeconds, 600, 'Paused time must not drift.');
controller.resume();
assert.equal(controller.activeIntervalCount(), 1);

nowMs = 840_000;
controller.tick();
controller.tick();
assert.equal(controller.snapshot().remainingSeconds, 0);
assert.equal(expirations.length, 1, 'Expiration must fire exactly once.');
assert.equal(controller.markAutomaticAdvanceHandled(), true);
assert.equal(controller.markAutomaticAdvanceHandled(), false, 'Automatic advance must be idempotent.');

controller.startQuestion('LAB-002');
assert.equal(controller.snapshot().remainingSeconds, STRICT_SECONDS);
assert.equal(controller.snapshot().questionElapsedSeconds, 0);
assert.equal(controller.activeIntervalCount(), 1);

controller.beginSession('selfPaced', 'LAB-003');
nowMs += 65_000;
controller.tick();
assert.equal(controller.snapshot().questionElapsedSeconds, 65);
assert.equal(controller.snapshot().remainingSeconds, 0);
assert.equal(expirations.length, 1, 'Self-paced mode must never expire.');

controller.beginSession('none', 'LAB-004');
assert.equal(controller.activeIntervalCount(), 0, 'Untimed review must not create an interval.');
assert.equal(controller.snapshot().status, 'idle');

controller.stop();
assert.equal(controller.activeIntervalCount(), 0);
assert.equal(intervals.size, 0);

console.log('Exam session controller tests passed.');
