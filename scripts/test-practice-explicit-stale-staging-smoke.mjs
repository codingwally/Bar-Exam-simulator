import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const supabaseUrl = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/u, '');
const publishableKey = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const workerUrl = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/u, '');
const email = String(process.env.STAGING_SMOKE_EMAIL || '');
const password = String(process.env.STAGING_SMOKE_PASSWORD || '');
const questionId = String(process.env.STAGING_STALE_QUESTION_ID || '');
const issuanceId = String(process.env.STAGING_STALE_ISSUANCE_ID || '');

assert.equal(supabaseUrl, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.equal(workerUrl, 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev');
assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/u);
assert.match(email, /^dd-randomizer-smoke-[A-Za-z0-9]+@duediligence\.ph$/u);
assert.ok(password.length >= 24);
assert.match(questionId, /^[A-Za-z0-9_-]{3,200}$/u);
assert.match(issuanceId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu);

const sessionResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(30_000),
});
const session = await sessionResponse.json();
assert.equal(sessionResponse.status, 200, JSON.stringify(session));
assert.match(session.access_token, /^[A-Za-z0-9_.-]+$/u);

const requestId = `stale_${randomUUID().replaceAll('-', '')}`;
const response = await fetch(`${workerUrl}/exam/question`, {
  method: 'POST',
  headers: {
    Origin: workerUrl,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
  },
  body: JSON.stringify({
    subject: 'Labor Law',
    questionId,
    issuanceId,
    requestId,
  }),
  signal: AbortSignal.timeout(30_000),
});
const payload = await response.json();
assert.equal(response.status, 409, JSON.stringify(payload));
assert.equal(payload.error?.code, 'QUESTION_ALREADY_ANSWERED');
assert.equal(payload.question, undefined);
assert.doesNotMatch(JSON.stringify(payload), /Essay Question|Suggested Answer|Legal Basis/iu);

process.stdout.write('STAGING_STALE_RESTORE: PASS (answered question rejected without content disclosure)\n');
