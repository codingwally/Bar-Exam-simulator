import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventInstant, eventLocalInput } from '../assets/debate-dates.js';
test('Manila schedule is independent of machine timezone and survives editing', () => {
  const instant = eventInstant('2026-09-15T19:30', 'Asia/Manila');
  assert.equal(instant, '2026-09-15T11:30:00.000Z');
  assert.equal(eventLocalInput(instant, 'Asia/Manila'), '2026-09-15T19:30');
  assert.equal(eventInstant('', 'Asia/Manila'), null);
});
test('rejects nonexistent, ambiguous, invalid dates and accepts fractional timezone offsets', () => {
  assert.throws(() => eventInstant('2026-03-08T02:30', 'America/New_York'), /does not exist/);
  assert.throws(() => eventInstant('2026-11-01T01:30', 'America/New_York'), /repeats/);
  assert.throws(() => eventInstant('2026-02-30T19:30', 'Asia/Manila'), /valid/);
  assert.throws(() => eventInstant('2026-09-15T19:30', 'invented/zone'));
  assert.equal(eventInstant('2026-09-15T19:30', 'Asia/Kathmandu'), '2026-09-15T13:45:00.000Z');
});
