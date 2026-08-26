import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRoomKey, ROOM_KEY } from '../worker/examination-room-v1-core.mjs';

const APPROVED_STAGING_URL =
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const stagingUrl = String(
  process.env.STAGING_EXAMINATION_ROOM_URL || APPROVED_STAGING_URL,
).replace(/\/+$/u, '');

assert.equal(
  stagingUrl,
  APPROVED_STAGING_URL,
  'Refusing to run the Examination Room smoke against an unapproved environment.',
);

if (process.argv.includes('--preflight')) {
  console.log('Examination Room staging smoke preflight passed.');
  process.exit(0);
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function retry(label, operation, attempts = 15) {
  let lastFailure = 'no response';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (result.ok) return result.value;
      lastFailure = result.diagnostic;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'request failed';
    }
    if (attempt < attempts) await pause(4_000);
  }
  throw new Error(`${label} did not reach its approved contract: ${lastFailure}`);
}

async function fetchStaging(pathname, init = {}) {
  const url = new URL(pathname, `${stagingUrl}/`);
  url.searchParams.set('greenfield_smoke', String(Date.now()));
  const response = await fetch(url, {
    // Cloudflare may canonicalize an explicit .html route to its extensionless
    // equivalent. Follow only that normal same-origin static redirect.
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    ...init,
    headers: {
      'cache-control': 'no-cache',
      ...(init.headers || {}),
    },
  });
  if (new URL(response.url).origin !== new URL(stagingUrl).origin) {
    throw new Error('staging response left the approved origin');
  }
  return response;
}

const staticRoutes = [
  ['/examination-room/', '<title>Examination Room — Due Diligence</title>', 'professor page'],
  ['/examination-room/student.html', '<title>Examination Room | DueDiligence.ph</title>', 'student page'],
  ['/examination-room/api.js', 'class ExaminationRoomApiError', 'client API'],
];

for (const [pathname, marker, label] of staticRoutes) {
  await retry(label, async () => {
    const response = await fetchStaging(pathname);
    const contentType = response.headers.get('content-type') || '';
    const body = response.status === 200 ? await response.text() : '';
    const accepted = response.status === 200
      && body.includes(marker)
      && (pathname.endsWith('.js')
        ? /(?:javascript|text\/plain)/iu.test(contentType)
        : contentType.includes('text/html'));
    return {
      ok: accepted,
      value: true,
      diagnostic: `status=${response.status}, content-type=${contentType || 'missing'}`,
    };
  });
}

await retry('professor sign-in boundary', async () => {
  const response = await fetchStaging('/examination-room/v1/professor/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: stagingUrl,
    },
    body: JSON.stringify({ operation: 'session', payload: {} }),
  });
  const body = await response.json().catch(() => null);
  const accepted = response.status === 401
    && body?.ok === false
    && body?.error?.code === 'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED'
    && typeof body?.error?.message === 'string'
    && body.error.message.length > 0
    && typeof body?.error?.recovery === 'string'
    && body.error.recovery.length > 0
    && response.headers.get('access-control-allow-origin') === stagingUrl;
  return {
    ok: accepted,
    value: true,
    diagnostic: `status=${response.status}, code=${body?.error?.code || 'missing'}`,
  };
});

const randomPayload = Array.from(randomBytes(ROOM_KEY.PAYLOAD_LENGTH), (byte) => (
  ROOM_KEY.ALPHABET[byte % ROOM_KEY.ALPHABET.length]
)).join('');
const unusedRoomKey = createRoomKey(randomPayload);

await retry('student invalid-key boundary', async () => {
  const response = await fetchStaging('/examination-room/v1/student/preview', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: stagingUrl,
    },
    body: JSON.stringify({
      roomKey: unusedRoomKey,
      identity: {
        realName: 'Staging Contract Check',
        studentNumber: `SMOKE-${Date.now()}`,
        subject: 'Staging Contract Check',
        yearLevel: '1',
      },
    }),
  });
  const body = await response.json().catch(() => null);
  const accepted = response.status === 401
    && body?.ok === false
    && body?.error?.code === 'EXAM_ROOM_V1_ROOM_KEY_INVALID'
    && typeof body?.error?.message === 'string'
    && body.error.message.length > 0
    && typeof body?.error?.recovery === 'string'
    && body.error.recovery.length > 0
    && response.headers.get('access-control-allow-origin') === stagingUrl;
  return {
    ok: accepted,
    value: true,
    diagnostic: `status=${response.status}, code=${body?.error?.code || 'missing'}`,
  };
});

console.log('Examination Room staging static routes and public error contracts passed.');
