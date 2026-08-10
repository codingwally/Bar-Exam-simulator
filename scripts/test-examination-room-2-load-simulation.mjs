import assert from 'node:assert/strict';
import { simulateExaminationRoomLoad } from './examination-room-2-load-simulation.mjs';

const result = simulateExaminationRoomLoad({
  candidates: 500,
  questions: 35,
  editsPerQuestion: 3,
  durationMinutes: 180,
  reconnectAtSeconds: 600,
  seed: 20260809,
});

assert.equal(result.mode, 'offline-simulation-only');
assert.equal(result.configuration.candidates, 500);
assert.equal(result.configuration.questions, 35);
assert.equal(result.byType['session.open'], 500);
assert.equal(result.byType['answer.save'], 500 * 35 * 3);
assert.equal(result.byType['answer.retry'], 1_000);
assert.equal(result.byType.submission, 500);
assert.equal(result.totalEvents, result.uniqueOperationIds);
assert.ok(result.maximumEventsPerSecond > 0);
assert.match(result.warning, /never point load traffic at production/);

console.log('Examination Room 2.0 500-candidate offline load simulation passed.');
