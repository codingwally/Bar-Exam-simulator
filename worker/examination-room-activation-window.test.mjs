import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMINATION_ROOM_UNSCHEDULED_ACTIVATION_SECONDS,
  resolveExaminationRoomActivationWindow,
} from './examination-room-activation-window.mjs';

const NOW = Date.parse('2026-08-27T10:00:00.000Z');

function secondsBetween(left, right) {
  return (Date.parse(right) - Date.parse(left)) / 1_000;
}

test('blank start time creates a fresh 24-hour room-key window', () => {
  const window = resolveExaminationRoomActivationWindow({
    startsAt: null,
    durationSeconds: 3_600,
    maximumExtraMinutes: 15,
    now: NOW,
  });
  assert.equal(window.opensAt, '2026-08-27T10:00:00.000Z');
  assert.equal(window.scheduleSource, 'room_key_issuance');
  assert.equal(
    secondsBetween(window.opensAt, window.closesAt),
    EXAMINATION_ROOM_UNSCHEDULED_ACTIVATION_SECONDS,
  );
  assert.equal(window.durationSeconds, 3_600);
  assert.equal(window.maximumExtraMinutes, 15);
});

test('an ended published schedule no longer blocks a new room key', () => {
  const window = resolveExaminationRoomActivationWindow({
    startsAt: '2026-08-26T08:00:00.000Z',
    durationSeconds: 7_200,
    now: NOW,
  });
  assert.equal(window.opensAt, '2026-08-27T10:00:00.000Z');
  assert.equal(window.scheduleSource, 'room_key_issuance');
  assert.equal(
    secondsBetween(window.opensAt, window.closesAt),
    EXAMINATION_ROOM_UNSCHEDULED_ACTIVATION_SECONDS,
  );
});

test('a future or still-running published schedule remains authoritative', () => {
  const window = resolveExaminationRoomActivationWindow({
    startsAt: '2026-08-27T09:30:00.000Z',
    durationSeconds: 3_600,
    maximumExtraMinutes: 15,
    now: NOW,
  });
  assert.equal(window.opensAt, '2026-08-27T09:30:00.000Z');
  assert.equal(window.closesAt, '2026-08-27T10:45:00.000Z');
  assert.equal(window.scheduleSource, 'published_exam');
});

test('a malformed nonblank start time is rejected', () => {
  assert.throws(
    () => resolveExaminationRoomActivationWindow({
      startsAt: 'not-a-date',
      durationSeconds: 3_600,
      now: NOW,
    }),
    (error) => error?.code === 'INVALID_START_TIME',
  );
});
