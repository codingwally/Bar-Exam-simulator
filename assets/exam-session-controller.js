(function exposeExamSessionController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DueDiligenceExamSession = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildExamSessionController() {
  const STRICT_SECONDS = 12 * 60;
  const MODES = new Set(['strict', 'selfPaced', 'none']);

  function createExamSessionController(options = {}) {
    const now = options.now || (() => Date.now());
    const setIntervalFn = options.setIntervalFn || setInterval;
    const clearIntervalFn = options.clearIntervalFn || clearInterval;
    const onTick = options.onTick || (() => {});
    const onExpire = options.onExpire || (() => {});
    const intervalMs = Number(options.intervalMs) || 250;
    let intervalId = null;

    const state = {
      currentQuestionId: null,
      mode: 'none',
      status: 'idle',
      startedAt: null,
      pausedAt: null,
      accumulatedElapsedSeconds: 0,
      totalAccumulatedElapsedSeconds: 0,
      remainingSeconds: STRICT_SECONDS,
      hasExpired: false,
      automaticAdvanceHandled: false,
    };

    function elapsedSinceStart(at = now()) {
      if (state.status !== 'running' || state.startedAt == null) return 0;
      return Math.max(0, Math.floor((at - state.startedAt) / 1000));
    }

    function snapshot(at = now()) {
      const activeElapsed = elapsedSinceStart(at);
      const questionElapsedSeconds = state.accumulatedElapsedSeconds + activeElapsed;
      const totalElapsedSeconds = state.totalAccumulatedElapsedSeconds + activeElapsed;
      const remainingSeconds = state.mode === 'strict'
        ? Math.max(0, STRICT_SECONDS - questionElapsedSeconds)
        : 0;
      return {
        ...state,
        questionElapsedSeconds,
        totalElapsedSeconds,
        remainingSeconds,
      };
    }

    function clearTicker() {
      if (intervalId != null) {
        clearIntervalFn(intervalId);
        intervalId = null;
      }
    }

    function commitElapsed(at = now()) {
      const activeElapsed = elapsedSinceStart(at);
      state.accumulatedElapsedSeconds += activeElapsed;
      state.totalAccumulatedElapsedSeconds += activeElapsed;
      state.startedAt = null;
      state.remainingSeconds = state.mode === 'strict'
        ? Math.max(0, STRICT_SECONDS - state.accumulatedElapsedSeconds)
        : 0;
    }

    function tick() {
      const current = snapshot();
      state.remainingSeconds = current.remainingSeconds;
      onTick(current);
      if (
        state.mode === 'strict'
        && state.status === 'running'
        && current.remainingSeconds === 0
        && !state.hasExpired
      ) {
        commitElapsed();
        state.hasExpired = true;
        state.status = 'expired';
        state.remainingSeconds = 0;
        clearTicker();
        onTick(snapshot());
        onExpire(snapshot());
      }
    }

    function ensureTicker() {
      clearTicker();
      if (state.mode === 'none' || state.status !== 'running') return;
      intervalId = setIntervalFn(tick, intervalMs);
    }

    function beginSession(mode, questionId) {
      if (!MODES.has(mode)) throw new Error(`Unsupported timer mode: ${mode}`);
      clearTicker();
      state.currentQuestionId = questionId || null;
      state.mode = mode;
      state.status = mode === 'none' ? 'idle' : 'running';
      state.startedAt = mode === 'none' ? null : now();
      state.pausedAt = null;
      state.accumulatedElapsedSeconds = 0;
      state.totalAccumulatedElapsedSeconds = 0;
      state.remainingSeconds = mode === 'strict' ? STRICT_SECONDS : 0;
      state.hasExpired = false;
      state.automaticAdvanceHandled = false;
      onTick(snapshot());
      ensureTicker();
    }

    function startQuestion(questionId) {
      clearTicker();
      state.currentQuestionId = questionId || null;
      state.status = state.mode === 'none' ? 'idle' : 'running';
      state.startedAt = state.mode === 'none' ? null : now();
      state.pausedAt = null;
      state.accumulatedElapsedSeconds = 0;
      state.remainingSeconds = state.mode === 'strict' ? STRICT_SECONDS : 0;
      state.hasExpired = false;
      state.automaticAdvanceHandled = false;
      onTick(snapshot());
      ensureTicker();
    }

    function pause() {
      if (state.status !== 'running') return snapshot();
      commitElapsed();
      state.status = 'paused';
      state.pausedAt = now();
      clearTicker();
      onTick(snapshot());
      return snapshot();
    }

    function resume() {
      if (state.mode === 'none' || state.status !== 'paused' || state.hasExpired) return snapshot();
      state.status = 'running';
      state.startedAt = now();
      state.pausedAt = null;
      ensureTicker();
      tick();
      return snapshot();
    }

    function markAutomaticAdvanceHandled() {
      if (state.automaticAdvanceHandled) return false;
      state.automaticAdvanceHandled = true;
      return true;
    }

    function stop(options = {}) {
      clearTicker();
      if (state.status === 'running') commitElapsed();
      state.status = 'idle';
      state.startedAt = null;
      state.pausedAt = null;
      if (options.reset !== false) {
        state.currentQuestionId = null;
        state.mode = 'none';
        state.accumulatedElapsedSeconds = 0;
        state.totalAccumulatedElapsedSeconds = 0;
        state.remainingSeconds = STRICT_SECONDS;
        state.hasExpired = false;
        state.automaticAdvanceHandled = false;
      }
      onTick(snapshot());
    }

    function activeIntervalCount() {
      return intervalId == null ? 0 : 1;
    }

    return {
      STRICT_SECONDS,
      beginSession,
      startQuestion,
      pause,
      resume,
      stop,
      snapshot,
      tick,
      markAutomaticAdvanceHandled,
      activeIntervalCount,
    };
  }

  return { STRICT_SECONDS, createExamSessionController };
}));
