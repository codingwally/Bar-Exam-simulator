(function exposeExamSessionController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DueDiligenceExamSession = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildExamSessionController() {
  const STRICT_SECONDS = 12 * 60;
  const MODES = new Set(['strict', 'selfPaced', 'none']);
  const STORAGE_VERSION = 2;

  function createExamSessionController(options = {}) {
    const now = options.now || (() => Date.now());
    const setIntervalFn = options.setIntervalFn || setInterval;
    const clearIntervalFn = options.clearIntervalFn || clearInterval;
    const onTick = options.onTick || (() => {});
    const onExpire = options.onExpire || (() => {});
    const intervalMs = Number(options.intervalMs) || 250;
    const storage = options.storage || null;
    const storageKey = options.storageKey || 'duediligence.exam.timer.v2';
    let intervalId = null;

    const state = {
      version: STORAGE_VERSION,
      currentQuestionId: null,
      mode: 'none',
      status: 'idle',
      startedAt: null,
      pausedAt: null,
      accumulatedElapsedMs: 0,
      totalAccumulatedElapsedMs: 0,
      remainingSeconds: STRICT_SECONDS,
      hasExpired: false,
      automaticAdvanceHandled: false,
      stoppedAt: null,
      updatedAt: null,
    };

    function safeRead() {
      if (!storage?.getItem) return null;
      try {
        const parsed = JSON.parse(storage.getItem(storageKey) || 'null');
        return parsed?.version === STORAGE_VERSION ? parsed : null;
      } catch {
        return null;
      }
    }

    function persist() {
      if (!storage?.setItem) return;
      try {
        state.updatedAt = now();
        storage.setItem(storageKey, JSON.stringify(state));
      } catch {
        // Persistence is best-effort; the live timer remains authoritative.
      }
    }

    function activeElapsedMs(at = now()) {
      if (state.status !== 'running' || state.startedAt == null) return 0;
      return Math.max(0, at - state.startedAt);
    }

    function snapshot(at = now()) {
      const activeMs = activeElapsedMs(at);
      const questionElapsedSeconds = Math.max(
        0,
        Math.floor((state.accumulatedElapsedMs + activeMs) / 1000),
      );
      const totalElapsedSeconds = Math.max(
        0,
        Math.floor((state.totalAccumulatedElapsedMs + activeMs) / 1000),
      );
      const remainingSeconds = state.mode === 'strict'
        ? Math.max(0, STRICT_SECONDS - questionElapsedSeconds)
        : 0;
      return {
        ...state,
        accumulatedElapsedSeconds: Math.floor(state.accumulatedElapsedMs / 1000),
        totalAccumulatedElapsedSeconds: Math.floor(state.totalAccumulatedElapsedMs / 1000),
        questionElapsedSeconds,
        totalElapsedSeconds,
        remainingSeconds,
        timerVisible: state.mode !== 'none',
      };
    }

    function clearTicker() {
      if (intervalId != null) {
        clearIntervalFn(intervalId);
        intervalId = null;
      }
    }

    function commitElapsed(at = now()) {
      const activeMs = activeElapsedMs(at);
      state.accumulatedElapsedMs += activeMs;
      state.totalAccumulatedElapsedMs += activeMs;
      state.startedAt = null;
      state.remainingSeconds = state.mode === 'strict'
        ? Math.max(0, STRICT_SECONDS - Math.floor(state.accumulatedElapsedMs / 1000))
        : 0;
    }

    function expireIfNeeded() {
      const current = snapshot();
      if (
        state.mode !== 'strict'
        || state.status !== 'running'
        || current.remainingSeconds > 0
        || state.hasExpired
      ) return false;

      commitElapsed();
      state.hasExpired = true;
      state.status = 'expired';
      state.remainingSeconds = 0;
      clearTicker();
      persist();
      onTick(snapshot());
      onExpire(snapshot());
      return true;
    }

    function tick() {
      const current = snapshot();
      state.remainingSeconds = current.remainingSeconds;
      onTick(current);
      if (!expireIfNeeded()) persist();
    }

    function ensureTicker() {
      clearTicker();
      if (state.status !== 'running' || state.mode === 'none') return;
      intervalId = setIntervalFn(tick, intervalMs);
    }

    function resetQuestionState(mode, questionId, resetTotal) {
      clearTicker();
      state.currentQuestionId = questionId || null;
      state.mode = mode;
      state.status = 'running';
      state.startedAt = now();
      state.pausedAt = null;
      state.accumulatedElapsedMs = 0;
      if (resetTotal) state.totalAccumulatedElapsedMs = 0;
      state.remainingSeconds = mode === 'strict' ? STRICT_SECONDS : 0;
      state.hasExpired = false;
      state.automaticAdvanceHandled = false;
      state.stoppedAt = null;
      persist();
      onTick(snapshot());
      ensureTicker();
    }

    function restore(questionId = null) {
      const saved = safeRead();
      if (!saved || (questionId && saved.currentQuestionId !== questionId)) return false;
      if (!MODES.has(saved.mode)) return false;
      Object.assign(state, {
        ...saved,
        accumulatedElapsedMs: Math.max(0, Number(saved.accumulatedElapsedMs) || 0),
        totalAccumulatedElapsedMs: Math.max(0, Number(saved.totalAccumulatedElapsedMs) || 0),
      });
      if (state.status === 'running' && state.startedAt == null) state.startedAt = now();
      ensureTicker();
      onTick(snapshot());
      if (!expireIfNeeded() && state.status === 'expired' && !state.automaticAdvanceHandled) {
        onExpire(snapshot());
      }
      return true;
    }

    function syncFromStorage() {
      const saved = safeRead();
      if (!saved || saved.currentQuestionId !== state.currentQuestionId) return false;
      if ((Number(saved.updatedAt) || 0) < (Number(state.updatedAt) || 0)) return false;
      Object.assign(state, saved);
      ensureTicker();
      onTick(snapshot());
      return true;
    }

    function beginSession(mode, questionId, beginOptions = {}) {
      if (!MODES.has(mode)) throw new Error(`Unsupported timer mode: ${mode}`);
      if (
        beginOptions.restore !== false
        && restore(questionId)
        && state.mode === mode
        && !['idle', 'stopped'].includes(state.status)
      ) return snapshot();
      resetQuestionState(mode, questionId, true);
      return snapshot();
    }

    function startQuestion(questionId) {
      resetQuestionState(state.mode, questionId, false);
      return snapshot();
    }

    function switchMode(mode) {
      if (!MODES.has(mode)) throw new Error(`Unsupported timer mode: ${mode}`);
      if (mode === state.mode) return snapshot();
      if (state.status === 'running') commitElapsed();
      state.mode = mode;
      state.remainingSeconds = mode === 'strict'
        ? Math.max(0, STRICT_SECONDS - Math.floor(state.accumulatedElapsedMs / 1000))
        : 0;
      if (!['expired', 'stopped', 'idle'].includes(state.status)) {
        state.status = state.status === 'paused' ? 'paused' : 'running';
        if (state.status === 'running') state.startedAt = now();
      }
      persist();
      onTick(snapshot());
      ensureTicker();
      if (mode === 'strict' && state.status === 'running') expireIfNeeded();
      return snapshot();
    }

    function pause() {
      if (state.status !== 'running') return snapshot();
      commitElapsed();
      state.status = 'paused';
      state.pausedAt = now();
      clearTicker();
      persist();
      onTick(snapshot());
      return snapshot();
    }

    function resume() {
      if (state.status !== 'paused' || state.hasExpired) return snapshot();
      state.status = 'running';
      state.startedAt = now();
      state.pausedAt = null;
      persist();
      ensureTicker();
      tick();
      return snapshot();
    }

    function markAutomaticAdvanceHandled() {
      if (state.automaticAdvanceHandled) return false;
      state.automaticAdvanceHandled = true;
      persist();
      return true;
    }

    function stop(stopOptions = {}) {
      clearTicker();
      if (state.status === 'running') commitElapsed();
      state.status = 'stopped';
      state.startedAt = null;
      state.pausedAt = null;
      state.stoppedAt = now();
      if (stopOptions.reset !== false) {
        state.currentQuestionId = null;
        state.mode = 'none';
        state.status = 'idle';
        state.accumulatedElapsedMs = 0;
        state.totalAccumulatedElapsedMs = 0;
        state.remainingSeconds = STRICT_SECONDS;
        state.hasExpired = false;
        state.automaticAdvanceHandled = false;
        state.stoppedAt = null;
      }
      persist();
      onTick(snapshot());
      return snapshot();
    }

    function activeIntervalCount() {
      return intervalId == null ? 0 : 1;
    }

    return {
      STRICT_SECONDS,
      beginSession,
      startQuestion,
      switchMode,
      pause,
      resume,
      restore,
      syncFromStorage,
      stop,
      snapshot,
      tick,
      markAutomaticAdvanceHandled,
      activeIntervalCount,
    };
  }

  return { STRICT_SECONDS, createExamSessionController };
}));
