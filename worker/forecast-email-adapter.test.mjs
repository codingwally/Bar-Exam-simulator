import assert from 'node:assert/strict';
import test from 'node:test';
import { assertForecastResultEmailAvailable, sendForecastResultEmail, resolveForecastEmailUser } from './forecast-email-adapter.mjs';
import { createForecastResultExporter } from './forecast-result-export.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ENV = { FORECAST_RESULTS_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'test-only-key',
  FORECAST_RESULTS_EMAIL_FROM: 'Due Diligence Results <support@duediligence.ph>', SUPABASE_SERVICE_ROLE_KEY: 'test-auth-only' };
const MESSAGE = { to: 'verified@example.test', subject: 'Saved report', text: 'Saved report only.', html: '<p>Saved report only.</p>',
  attachment: { bytes: new TextEncoder().encode('%PDF-fixture'), filename: `duediligence-forecast-${OWNER}-r1.pdf`, contentType: 'application/pdf' },
  idempotencyKey: `forecast-result/${OWNER}/r1` };

test('dedicated mode and configuration must be available before any journal, PDF, identity lookup, or send', async () => {
  for (const env of [{}, { ...ENV, FORECAST_RESULTS_EMAIL_MODE: 'suppressed' }, { ...ENV, RESEND_API_KEY: '' }, { ...ENV, FORECAST_RESULTS_EMAIL_FROM: 'invalid\r\nheader' }]) {
    assert.throws(() => assertForecastResultEmailAvailable(env), { code: 'BAR_FORECAST_EMAIL_UNAVAILABLE' });
    assert.deepEqual(await sendForecastResultEmail(env, MESSAGE, () => assert.fail('no transport when suppressed')), { definitelyNotAccepted: true });
    const exporter = createForecastResultExporter({
      attemptStore: { getOwned: () => assert.fail('no saved report fetch on suppressed email') },
      rpc: () => assert.fail('no journal on suppressed email'), sendEmail: sendForecastResultEmail,
      assertEmailAvailable: assertForecastResultEmailAvailable,
      resolveVerifiedUser: () => assert.fail('no identity lookup on suppressed email'),
    });
    await assert.rejects(exporter.email(env, { id: OWNER }, OWNER), { code: 'BAR_FORECAST_EMAIL_UNAVAILABLE' });
  }
});

test('one explicit send has correct endpoint, verified recipient, exact attachment, and stable idempotency header', async () => {
  let calls = 0;
  const result = await sendForecastResultEmail(ENV, MESSAGE, async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers['Idempotency-Key'], MESSAGE.idempotencyKey);
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, [MESSAGE.to]);
    assert.equal(body.from, ENV.FORECAST_RESULTS_EMAIL_FROM);
    assert.equal(body.text, MESSAGE.text);
    assert.equal(body.html, MESSAGE.html);
    assert.deepEqual(Buffer.from(body.attachments[0].content, 'base64'), Buffer.from(MESSAGE.attachment.bytes));
    assert.equal(body.attachments[0].filename, MESSAGE.attachment.filename);
    assert.equal(body.attachments[0].content_type, 'application/pdf');
    return Response.json({ id: 'provider-fixture-id' });
  });
  assert.deepEqual(result, { accepted: true, providerMessageId: 'provider-fixture-id' });
  assert.equal(calls, 1);
  assert.equal(result.delivered, undefined);
});

test('invalid recipient, attachment, or key cannot reach transport', async () => {
  for (const changed of [
    { to: 'other@example.test\nBcc: victim@example.test' }, { idempotencyKey: 'bad key\n' },
    { attachment: { ...MESSAGE.attachment, contentType: 'text/html' } },
    { attachment: { ...MESSAGE.attachment, filename: '../../report.pdf' } },
    { attachment: { ...MESSAGE.attachment, bytes: new Uint8Array() } },
  ]) assert.deepEqual(await sendForecastResultEmail(ENV, { ...MESSAGE, ...changed }, () => assert.fail('invalid send reached transport')), { definitelyNotAccepted: true });
});

test('transport errors, malformed success, concurrent-key conflict, and server errors remain uncertain without retry', async () => {
  for (const response of [Response.json({ error: 'busy' }, { status: 409 }), Response.json({}, { status: 200 }),
    new Response('invalid json', { status: 200 }), Response.json({}, { status: 408 }), Response.json({}, { status: 503 })]) {
    let calls = 0;
    assert.deepEqual(await sendForecastResultEmail(ENV, MESSAGE, async () => { calls += 1; return response; }), { accepted: false });
    assert.equal(calls, 1);
  }
  assert.deepEqual(await sendForecastResultEmail(ENV, MESSAGE, async () => { throw new Error('Fixture network uncertainty'); }), { accepted: false });
  for (const status of [400, 401, 403, 404, 413, 422, 429]) {
    assert.deepEqual(await sendForecastResultEmail(ENV, MESSAGE, async () => Response.json({}, { status })), { definitelyNotAccepted: true });
  }
});

test('current Auth lookup is same-owner, HTTPS, service-authenticated, and strips all editable metadata', async () => {
  const user = await resolveForecastEmailUser(ENV, { id: OWNER }, 'https://project.supabase.co', async (url, options) => {
    assert.equal(String(url), `https://project.supabase.co/auth/v1/admin/users/${OWNER}`);
    assert.equal(options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(options.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    return Response.json({ id: OWNER, email: MESSAGE.to, email_confirmed_at: '2026-09-01T00:00:00Z', user_metadata: { email_verified: true }, app_metadata: { role: 'admin' } });
  });
  assert.deepEqual(user, { id: OWNER, email: MESSAGE.to, email_confirmed_at: '2026-09-01T00:00:00Z' });
  for (const body of [{ id: 'different-owner' }, { id: OWNER, banned_until: '2099-01-01T00:00:00Z' }]) {
    await assert.rejects(resolveForecastEmailUser(ENV, { id: OWNER }, 'https://project.supabase.co', async () => Response.json(body)), { code: 'BAR_FORECAST_EMAIL_ACCOUNT_UNAVAILABLE' });
  }
  await assert.rejects(resolveForecastEmailUser(ENV, { id: OWNER }, 'http://project.supabase.co', () => assert.fail('service credential over HTTP')), { code: 'BAR_FORECAST_EMAIL_ACCOUNT_UNAVAILABLE' });
  await assert.rejects(resolveForecastEmailUser({}, { id: OWNER }, 'https://project.supabase.co', () => assert.fail('missing service key')), { code: 'BAR_FORECAST_EMAIL_ACCOUNT_UNAVAILABLE' });
});

test('hard deadline also bounds a transport that ignores abort and a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const stalled = sendForecastResultEmail(ENV, MESSAGE, async (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  });
  t.mock.timers.tick(15000);
  assert.deepEqual(await stalled, { accepted: false });
  assert.equal(signal.aborted, true);
  const bodyStalled = resolveForecastEmailUser(ENV, { id: OWNER }, 'https://project.supabase.co', async () => ({ ok: true, json: () => new Promise(() => {}) }));
  t.mock.timers.tick(15000);
  await assert.rejects(bodyStalled, { code: 'BAR_FORECAST_EMAIL_ACCOUNT_UNAVAILABLE' });
  t.mock.timers.reset();
});
