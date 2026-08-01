(function privateBetaSession(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config?.workerUrl) return;

  const DISCLOSURE_VERSION = 'beta-disclosure-v1-2026-07-31';
  const STORAGE_KEYS = Object.freeze({
    flowId: 'duediligence.private-beta.flow.v1',
    pending: 'duediligence.private-beta.pending.v1',
    access: 'duediligence.private-beta.access.v1',
  });
  const EXPIRY_SKEW_MS = 5_000;

  function randomId(byteLength = 24) {
    const bytes = new Uint8Array(byteLength);
    global.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function sessionRead(key) {
    try {
      return global.sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function sessionWrite(key, value) {
    try {
      global.sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function sessionRemove(key) {
    try {
      global.sessionStorage.removeItem(key);
    } catch {
      // Access state is already unavailable when session storage cannot be read.
    }
  }

  function readExpiringRecord(key) {
    const raw = sessionRead(key);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      const expiresAtMs = new Date(record?.expiresAt || '').getTime();
      if (
        typeof record?.token !== 'string'
        || !record.token
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs <= Date.now() + EXPIRY_SKEW_MS
      ) {
        sessionRemove(key);
        return null;
      }
      return {
        token: record.token,
        expiresAt: new Date(expiresAtMs).toISOString(),
        disclosureVersion: String(record.disclosureVersion || ''),
        admissionKind: record.admissionKind || null,
      };
    } catch {
      sessionRemove(key);
      return null;
    }
  }

  function saveExpiringRecord(key, record) {
    const expiresAtMs = new Date(record?.expiresAt || '').getTime();
    if (
      typeof record?.token !== 'string'
      || !record.token
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= Date.now() + EXPIRY_SKEW_MS
    ) {
      throw new Error('Private-beta access could not be saved.');
    }
    if (!sessionWrite(key, JSON.stringify({
      token: record.token,
      expiresAt: new Date(expiresAtMs).toISOString(),
      disclosureVersion: String(record.disclosureVersion || ''),
      admissionKind: record.admissionKind || null,
    }))) {
      throw new Error('Private-beta access requires session storage in this browser.');
    }
  }

  function flowId() {
    const existing = sessionRead(STORAGE_KEYS.flowId);
    if (/^[A-Za-z0-9_-]{22,128}$/.test(existing)) return existing;
    const created = randomId();
    if (!sessionWrite(STORAGE_KEYS.flowId, created)) {
      throw new Error('Private-beta access requires session storage in this browser.');
    }
    return created;
  }

  function flowHeaders() {
    return { 'X-DD-Beta-Flow-ID': flowId() };
  }

  function accessHeaders() {
    const access = readExpiringRecord(STORAGE_KEYS.access);
    return access ? { 'X-DD-Beta-Access': access.token } : {};
  }

  function controlledError(payload, status) {
    const error = new Error(
      payload?.error?.message
      || 'Private-beta access could not be verified. Please try again.',
    );
    error.code = payload?.error?.code || 'PRIVATE_BETA_REQUEST_FAILED';
    error.status = status;
    return error;
  }

  async function request(path, body, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...flowHeaders(),
      ...(options.includeAccess === true ? accessHeaders() : {}),
      ...(options.authAccessToken
        ? { Authorization: `Bearer ${options.authAccessToken}` }
        : {}),
    };
    const response = await global.fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      cache: 'no-store',
      credentials: 'omit',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw controlledError(payload, response.status);
    return payload;
  }

  async function verifyCode({
    accessCode,
    disclosureEndReached,
    acknowledgements,
  } = {}) {
    const payload = await request('/beta/access/verify', {
      disclosureVersion: DISCLOSURE_VERSION,
      disclosureEndReached: disclosureEndReached === true,
      acknowledgements,
      accessCode: String(accessCode || ''),
    });
    saveExpiringRecord(STORAGE_KEYS.pending, payload.pending);
    return {
      disclosureVersion: payload.pending.disclosureVersion,
      expiresAt: payload.pending.expiresAt,
    };
  }

  async function completeAdmission({
    authAccessToken,
    disclosureEndReached,
    acknowledgements,
  } = {}) {
    const pending = readExpiringRecord(STORAGE_KEYS.pending);
    if (!pending) {
      const error = new Error('Verify the private-beta access code again.');
      error.code = 'PRIVATE_BETA_PENDING_REQUIRED';
      throw error;
    }
    const payload = await request('/beta/access/complete', {
      pendingToken: pending.token,
      disclosureEndReached: disclosureEndReached === true,
      acknowledgements,
    }, { authAccessToken });
    saveExpiringRecord(STORAGE_KEYS.access, payload.access);
    sessionRemove(STORAGE_KEYS.pending);
    return {
      allowed: payload.access.allowed === true,
      admissionKind: payload.access.admissionKind || null,
      disclosureVersion: payload.access.disclosureVersion,
      expiresAt: payload.access.expiresAt,
    };
  }

  async function policy() {
    const response = await global.fetch(`${config.workerUrl}/beta/access/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      credentials: 'omit',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw controlledError(payload, response.status);
    return {
      enabled: payload.policy?.enabled === true,
    };
  }

  async function status(authAccessToken) {
    const access = readExpiringRecord(STORAGE_KEYS.access);
    try {
      const payload = await request('/beta/access/status', {}, {
        authAccessToken,
        includeAccess: Boolean(access),
      });
      if (payload.access?.allowed !== true) {
        clearAccess();
        return { allowed: false };
      }
      return payload.access;
    } catch (error) {
      if ([401, 403].includes(error?.status)) clearAccess();
      throw error;
    }
  }

  function clearAccess() {
    sessionRemove(STORAGE_KEYS.pending);
    sessionRemove(STORAGE_KEYS.access);
  }

  function clear() {
    clearAccess();
    sessionRemove(STORAGE_KEYS.flowId);
  }

  global.DueDiligencePrivateBeta = Object.freeze({
    disclosureVersion: DISCLOSURE_VERSION,
    flowHeaders,
    accessHeaders,
    verifyCode,
    completeAdmission,
    policy,
    status,
    clearAccess,
    clear,
    getPending: () => readExpiringRecord(STORAGE_KEYS.pending),
    getAccess: () => readExpiringRecord(STORAGE_KEYS.access),
  });
})(window);
