import assert from 'node:assert/strict';
import test from 'node:test';
import maintenanceWorker from './maintenance-entry.mjs';

const origin = 'https://duediligence.ph';
const testPassword = 'test-maintenance-password';
const passwordBytes = new TextEncoder().encode(testPassword);
const passwordDigest = await crypto.subtle.digest('SHA-256', passwordBytes);
const passwordHash = Array.from(
  new Uint8Array(passwordDigest),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('');
const env = Object.freeze({
  ALLOWED_ORIGIN: origin,
  MAINTENANCE_MODE: 'true',
  MAINTENANCE_PASSWORD_HASH: passwordHash,
  MAINTENANCE_SIGNING_KEY: 'unit-test-maintenance-signing-key-32-bytes-minimum',
  MAINTENANCE_TOKEN_TTL_SECONDS: '600',
});

function request(path, options = {}) {
  return new Request(`https://worker.example${path}`, {
    method: options.method || 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.method === 'OPTIONS' ? undefined : JSON.stringify(options.body || {}),
  });
}

async function json(response) {
  return response.json();
}

test('maintenance password issues a signed token and validates it', async () => {
  const unlock = await maintenanceWorker.fetch(request('/maintenance/unlock', {
    body: { password: testPassword },
  }), env, {});
  assert.equal(unlock.status, 200);
  const unlocked = await json(unlock);
  assert.equal(unlocked.ok, true);
  assert.match(unlocked.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const status = await maintenanceWorker.fetch(request('/maintenance/status', {
    headers: { 'X-DD-Maintenance-Access': unlocked.token },
  }), env, {});
  assert.equal(status.status, 200);
  assert.equal((await json(status)).ok, true);
});

test('wrong password and tampered token are rejected', async () => {
  const wrong = await maintenanceWorker.fetch(request('/maintenance/unlock', {
    body: { password: 'incorrect' },
  }), env, {});
  assert.equal(wrong.status, 401);
  assert.equal((await json(wrong)).error.code, 'MAINTENANCE_PASSWORD_INVALID');

  const tampered = await maintenanceWorker.fetch(request('/maintenance/status', {
    headers: { 'X-DD-Maintenance-Access': 'invalid.invalid' },
  }), env, {});
  assert.equal(tampered.status, 401);
  assert.equal((await json(tampered)).error.code, 'MAINTENANCE_ACCESS_REQUIRED');
});

test('protected Worker routes are locked before maintenance access', async () => {
  const response = await maintenanceWorker.fetch(request('/access'), env, {});
  assert.equal(response.status, 503);
  const payload = await json(response);
  assert.equal(payload.maintenance, true);
  assert.equal(payload.error.code, 'MAINTENANCE_MODE');
});

test('preflight permits the maintenance token header', async () => {
  const response = await maintenanceWorker.fetch(request('/access', {
    method: 'OPTIONS',
  }), env, {});
  assert.equal(response.status, 204);
  assert.match(
    response.headers.get('Access-Control-Allow-Headers') || '',
    /X-DD-Maintenance-Access/,
  );
});

test('public launch bypasses maintenance without requiring a password token', async () => {
  const response = await maintenanceWorker.fetch(
    request('/not-a-real-route'),
    { ...env, MAINTENANCE_MODE: 'false' },
    {},
  );
  assert.equal(response.status, 404);
  const payload = await json(response);
  assert.equal(payload?.error?.code, 'NOT_FOUND');
  assert.notEqual(payload?.maintenance, true);
});
