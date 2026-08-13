(function privateWorkspaceCoordinator(global) {
  'use strict';

  const resets = new Set();
  const quarantinedLegacyKeys = new Set();
  let activeUserId = '';
  let identityGeneration = 0;

  function sessionUserId() {
    return String(global.DueDiligencePhase4?.getSession?.()?.user?.id || '').trim();
  }

  function safeSegment(value) {
    return encodeURIComponent(String(value || '').trim()).replace(/%/g, '_');
  }

  function scopedKey(feature, ...parts) {
    const userId = sessionUserId();
    if (!userId) return '';
    return ['duediligence.private', safeSegment(userId), safeSegment(feature), ...parts.map(safeSegment)]
      .join('.');
  }

  function quarantineLegacyKey(storage, key) {
    if (!storage || !key || quarantinedLegacyKeys.has(key)) return false;
    quarantinedLegacyKeys.add(key);
    try {
      const hadValue = storage.getItem(key) !== null;
      if (hadValue) {
        storage.removeItem(key);
        localStorage.setItem(
          `duediligence.legacy-quarantine-marker.${safeSegment(key)}`,
          JSON.stringify({ removedAt: new Date().toISOString(), reason: 'owner-unverifiable' }),
        );
      }
      return hadValue;
    } catch {
      return false;
    }
  }

  function registerReset(callback) {
    if (typeof callback !== 'function') return () => {};
    resets.add(callback);
    return () => resets.delete(callback);
  }

  function resetPrivateUi(nextUserId, previousUserId, reason) {
    identityGeneration += 1;
    for (const reset of resets) {
      try { reset({ nextUserId, previousUserId, reason, generation: identityGeneration }); } catch {}
    }
  }

  function synchronizeIdentity(reason = 'session') {
    const nextUserId = sessionUserId();
    if (nextUserId === activeUserId) return false;
    const previousUserId = activeUserId;
    activeUserId = nextUserId;
    try {
      if (nextUserId) sessionStorage.setItem('duediligence.offline.owner-hint.v1', nextUserId);
      else sessionStorage.removeItem('duediligence.offline.owner-hint.v1');
    } catch {}
    resetPrivateUi(nextUserId, previousUserId, reason);
    global.dispatchEvent(new CustomEvent('duediligence:workspace-identity', {
      detail: Object.freeze({
        authenticated: Boolean(nextUserId),
        previousUserId,
        userId: nextUserId,
        generation: identityGeneration,
      }),
    }));
    return true;
  }

  global.addEventListener('duediligence:session', () => synchronizeIdentity('session'));
  global.addEventListener('pageshow', (event) => {
    if (event.persisted) synchronizeIdentity('bfcache');
  });
  global.addEventListener('load', () => {
    [
      'duediligence.answer.drafts.v1',
      'duediligence.exam.workspace.v2',
      'duediligence.exam.timer.v2',
      'dd_attempts_v1',
      'duediligence.examinations.recovery.v1',
      'duediligence.subject-matter.catalog-state.v2',
      'duediligence.subject-matter.timer-mode.v1',
    ].forEach((key) => quarantineLegacyKey(localStorage, key));
    synchronizeIdentity('load');
  }, { once: true });

  global.DueDiligencePrivateWorkspace = Object.freeze({
    currentUserId: sessionUserId,
    generation: () => identityGeneration,
    quarantineLegacyKey,
    registerReset,
    scopedKey,
    synchronizeIdentity,
  });
}(window));
