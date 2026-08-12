(function durableAuthSessionStorage(global) {
  'use strict';

  const PROBE_KEY = 'duediligence.auth.storage.probe';

  function browserStorage(name) {
    try {
      return global[name] || null;
    } catch {
      return null;
    }
  }

  function storageKey(supabaseUrl) {
    try {
      const projectRef = new URL(String(supabaseUrl || '')).hostname.split('.')[0];
      return projectRef ? `sb-${projectRef}-auth-token` : '';
    } catch {
      return '';
    }
  }

  function storageAvailable(storage) {
    if (!storage) return false;
    try {
      const previous = storage.getItem(PROBE_KEY);
      storage.setItem(PROBE_KEY, '1');
      if (previous === null) storage.removeItem(PROBE_KEY);
      else storage.setItem(PROBE_KEY, previous);
      return true;
    } catch {
      return false;
    }
  }

  function safeRead(storage, key) {
    try {
      return storage?.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function sessionExpiry(value) {
    try {
      const parsed = JSON.parse(value);
      const expiresAt = Number(parsed?.expires_at || parsed?.expiresAt || 0);
      return Number.isFinite(expiresAt) ? expiresAt : 0;
    } catch {
      return 0;
    }
  }

  function migrateValue(source, target, key, preferNewestSession = false) {
    const sourceValue = safeRead(source, key);
    if (!sourceValue) return;
    const targetValue = safeRead(target, key);
    const shouldCopy = !targetValue
      || !preferNewestSession
      || sessionExpiry(sourceValue) >= sessionExpiry(targetValue);
    try {
      if (shouldCopy) target.setItem(key, sourceValue);
      const targetAcceptedSource = safeRead(target, key) === sourceValue;
      const targetAlreadyNewer = preferNewestSession
        && sessionExpiry(targetValue) > sessionExpiry(sourceValue);
      if (targetAcceptedSource || targetAlreadyNewer) source.removeItem(key);
    } catch {
      // Keep the working session in its original store when migration is unavailable.
    }
  }

  function prepare(supabaseUrl) {
    const temporary = browserStorage('sessionStorage');
    const persistent = browserStorage('localStorage');
    if (!storageAvailable(persistent)) return temporary;

    const key = storageKey(supabaseUrl);
    if (key && temporary && temporary !== persistent) {
      migrateValue(temporary, persistent, key, true);
      migrateValue(temporary, persistent, `${key}-code-verifier`);
    }
    return persistent;
  }

  global.DueDiligenceAuthSessionStorage = Object.freeze({
    prepare,
    storageKey,
  });
})(window);
