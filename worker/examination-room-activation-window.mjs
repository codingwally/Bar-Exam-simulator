export const EXAMINATION_ROOM_UNSCHEDULED_ACTIVATION_SECONDS = 24 * 60 * 60;

function activationWindowError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

export function resolveExaminationRoomActivationWindow({
  startsAt = null,
  durationSeconds,
  maximumExtraMinutes = 0,
  now = Date.now(),
} = {}) {
  const duration = Number(durationSeconds);
  const extraMinutes = Number(maximumExtraMinutes);
  const nowMs = Number(now);

  if (!Number.isSafeInteger(duration) || duration < 60 || duration > 86_400) {
    throw activationWindowError(
      'INVALID_DURATION',
      'durationSeconds must be an integer between 60 and 86400.',
    );
  }
  if (!Number.isFinite(extraMinutes) || extraMinutes < 0) {
    throw activationWindowError(
      'INVALID_EXTRA_MINUTES',
      'maximumExtraMinutes must be a non-negative number.',
    );
  }
  if (!Number.isFinite(nowMs)) {
    throw activationWindowError('INVALID_NOW', 'now must be a valid timestamp.');
  }

  const normalizedStart = String(startsAt || '').trim();
  const scheduledOpens = normalizedStart ? Date.parse(normalizedStart) : Number.NaN;
  if (normalizedStart && !Number.isFinite(scheduledOpens)) {
    throw activationWindowError(
      'INVALID_START_TIME',
      'startsAt must be a valid date when it is provided.',
    );
  }

  const scheduledCloses = Number.isFinite(scheduledOpens)
    ? scheduledOpens + (duration + extraMinutes * 60) * 1_000
    : Number.NaN;
  const usePublishedSchedule = Number.isFinite(scheduledCloses)
    && scheduledCloses > scheduledOpens
    && scheduledCloses > nowMs;
  const opens = usePublishedSchedule ? scheduledOpens : nowMs;
  const closes = usePublishedSchedule
    ? scheduledCloses
    : opens + EXAMINATION_ROOM_UNSCHEDULED_ACTIVATION_SECONDS * 1_000;

  return {
    opensAt: new Date(opens).toISOString(),
    closesAt: new Date(closes).toISOString(),
    durationSeconds: duration,
    maximumExtraMinutes: extraMinutes,
    scheduleSource: usePublishedSchedule ? 'published_exam' : 'room_key_issuance',
  };
}
