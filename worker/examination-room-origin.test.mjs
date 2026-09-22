import assert from 'node:assert/strict';
import test from 'node:test';

import applicationWorker from './index.mjs';

const APPLICATION_URL = 'https://duediligence-gemini-examiner.wallyesteban1993.workers.dev';
const APEX_ORIGIN = 'https://duediligence.ph';
const WWW_ORIGIN = 'https://www.duediligence.ph';

function request(origin, pathname = '/examination-room/v1/student/command') {
  return new Request(`${APPLICATION_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      operation: 'submit',
      idempotencyKey: 'origin-contract-check-20260922',
      payload: { sessionId: 'not-a-session' },
    }),
  });
}

const env = {
  ALLOWED_ORIGIN: APEX_ORIGIN,
  EXAMINATION_ROOM_ENABLED: 'true',
  EXAMINATION_ROOM_KEY_PEPPER: 'test-only-examination-room-pepper-32-bytes-minimum',
};

test('Examination Room accepts both approved production hostnames', async () => {
  for (const origin of [APEX_ORIGIN, WWW_ORIGIN]) {
    const response = await applicationWorker.fetch(request(origin), env, {});
    const body = await response.json();
    assert.notEqual(body?.error?.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
});

test('www approval remains confined to Examination Room', async () => {
  const response = await applicationWorker.fetch(request(WWW_ORIGIN, '/grade'), env, {});
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('unapproved origins remain denied for Examination Room', async () => {
  const response = await applicationWorker.fetch(request('https://attacker.example'), env, {});
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'ORIGIN_NOT_ALLOWED');
});
