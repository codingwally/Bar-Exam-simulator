import assert from 'node:assert/strict';
import test from 'node:test';
import { googleAccessToken } from './google-oauth.mjs';

test('googleAccessToken fails closed when credentials are incomplete', async () => {
  await assert.rejects(
    googleAccessToken({}, async () => {
      throw new Error('fetch must not run');
    }),
    (error) => error?.safeCode === 'GOOGLE_AUTH_NOT_CONFIGURED',
  );
});

test('googleAccessToken exchanges the retained content-sync credentials', async () => {
  let observed;
  const token = await googleAccessToken({
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-token',
  }, async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ access_token: 'access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.equal(token, 'access-token');
  assert.equal(observed.url, 'https://oauth2.googleapis.com/token');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.body.get('grant_type'), 'refresh_token');
  assert.equal(observed.options.body.get('client_id'), 'client-id');
  assert.equal(observed.options.body.get('client_secret'), 'client-secret');
  assert.equal(observed.options.body.get('refresh_token'), 'refresh-token');
});

test('googleAccessToken exposes only a bounded safe failure code', async () => {
  await assert.rejects(
    googleAccessToken({
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-token',
    }, async () => new Response('{}', { status: 503 })),
    (error) => error?.safeCode === 'GOOGLE_TOKEN_FAILED_503',
  );
});
