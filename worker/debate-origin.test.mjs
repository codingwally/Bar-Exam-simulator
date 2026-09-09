import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import { TARGET, smokeStaging } from '../scripts/debate-staging-release.mjs';

const sameOrigin = 'https://debate-staging.example';
const memberId = '10000000-0000-4000-8000-000000000001';
const excludedId = '10000000-0000-4000-8000-000000000002';
const env = {
  ALLOWED_ORIGIN: sameOrigin,
  SUPABASE_URL: 'https://origin-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  DEBATE_ROOM_ENABLED: 'false',
  DEBATE_PREVIEW_ACTOR_IDS: memberId,
};
const metadata = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' };
const readPaths = ['/access', '/events', '/discover', '/snapshot', '/messages', '/download', '/evidence/download'];
function request(path, headers = metadata, method = 'GET', origin = sameOrigin) {
  return new Request(origin + path, { method, headers });
}

async function withUpstream(run, options = {}) {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, env.SUPABASE_URL, 'Only the explicitly doubled Auth/SQL transport is allowed');
    calls.push({ path: url.pathname, init });
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init.headers).get('Authorization');
      if (token === 'Bearer expired') return Response.json({ message: 'Expired' }, { status: 401 });
      return Response.json({
        id: token === 'Bearer excluded' ? excludedId : memberId,
        email: 'synthetic-origin-test@example.invalid',
        email_confirmed_at: '2026-09-01T00:00:00Z',
        is_anonymous: false,
        user_metadata: { full_name: 'Synthetic Origin Test' },
        ...options.user,
      });
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-service-role');
    if (url.pathname === '/rest/v1/rpc/debate_v3_list') {
      assert.deepEqual(JSON.parse(init.body), { p_actor_id: memberId });
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/rpc/debate_v3_read') {
      return Response.json({ id: 'private-event', members: {} });
    }
    throw new Error('Unexpected upstream operation: ' + url.pathname);
  };
  try { await run(calls); } finally { globalThis.fetch = previous; }
}

test('actual Worker accepts same-origin Debate GET without Origin and preserves fresh bearer authorization', async () => {
  await withUpstream(async calls => {
    for (const extra of [{}, { Referer: sameOrigin + '/debate-room/' }]) {
      const incoming = request('/debate-room/events', { ...metadata, ...extra, Authorization: 'Bearer allowed' });
      assert.equal(incoming.headers.has('Origin'), false);
      const response = await worker.fetch(incoming, env);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).events, []);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), sameOrigin);
      assert.match(response.headers.get('Cache-Control'), /no-store/);
      assert.match(response.headers.get('Vary'), /Sec-Fetch-Site/);
    }
    assert.deepEqual(calls.map(c => c.path), [
      '/auth/v1/user', '/rest/v1/rpc/debate_v3_list',
      '/auth/v1/user', '/rest/v1/rpc/debate_v3_list',
    ], 'Each request still checks the current Auth account; no billing or credit activation');
  });
});

test('all seven known Debate GET paths reach their existing anonymous boundary', async () => {
  await withUpstream(async calls => {
    for (const path of readPaths) {
      const response = await worker.fetch(request('/debate-room' + path), env);
      assert.equal(response.status, path === '/access' ? 200 : 401, path);
      const body = await response.json();
      if (path === '/access') assert.equal(body.enabled, false);
      else assert.equal(body.error.code, 'AUTH_REQUIRED', path);
    }
    assert.equal(calls.length, 0);
  });
});

test('absent Origin exception rejects foreign targets, metadata, explicit Origin and conflicting Referer', async () => {
  await withUpstream(async calls => {
    const cases = [
      [{}, sameOrigin],
      [{ 'Sec-Fetch-Site': 'cross-site' }, sameOrigin],
      [{ 'Sec-Fetch-Site': 'same-site' }, sameOrigin],
      [{ 'Sec-Fetch-Site': 'none' }, sameOrigin],
      [{ 'Sec-Fetch-Site': 'unknown' }, sameOrigin],
      [{ 'Sec-Fetch-Site': 'same-origin, cross-site' }, sameOrigin],
      [{ 'Sec-Fetch-Site': 'Same-Origin' }, sameOrigin],
      [{ ...metadata, Origin: 'https://foreign.example' }, sameOrigin],
      [{ ...metadata, Origin: 'null' }, sameOrigin],
      [{ ...metadata, Origin: '' }, sameOrigin],
      [{ ...metadata, Referer: 'https://foreign.example/debate-room/' }, sameOrigin],
      [{ ...metadata, Referer: 'null' }, sameOrigin],
      [{ ...metadata, Referer: '' }, sameOrigin],
      [{ ...metadata, Referer: 'https://user:password@debate-staging.example/debate-room/' }, sameOrigin],
      [metadata, 'https://other-staging.example'],
      [metadata, 'http://debate-staging.example'],
      [metadata, 'https://debate-staging.example:444'],
    ];
    for (const [headers, target] of cases) {
      const response = await worker.fetch(request('/debate-room/events', { ...headers, Authorization: 'Bearer allowed' }, 'GET', target), env);
      assert.equal(response.status, 403, JSON.stringify({ headers, target }));
      assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    }
    assert.equal(calls.length, 0, 'Rejected origins must not reach Auth or service-role SQL');
  });
});

test('same-origin metadata never exempts mutations, unknown Debate routes or unrelated routes', async () => {
  await withUpstream(async calls => {
    for (const [path, method] of [
      ['/debate-room/access', 'POST'], ['/debate-room/events', 'POST'],
      ['/debate-room/command', 'POST'], ['/debate-room/claim', 'POST'],
      ['/debate-room/media', 'POST'], ['/debate-room/outbox', 'POST'],
      ['/debate-room/evidence/upload', 'POST'], ['/debate-room/events', 'HEAD'],
      ['/debate-room/events', 'OPTIONS'], ['/debate-room/unknown', 'GET'],
      ['/debate-room/command', 'GET'], ['/debate-room/media', 'GET'],
      ['/study-room/access', 'GET'], ['/study-room/access', 'POST'],
      ['/admin/dashboard', 'POST'], ['/grade', 'POST'],
    ]) {
      const response = await worker.fetch(request(path, { ...metadata, Authorization: 'Bearer allowed' }, method), env);
      assert.equal(response.status, 403, method + ' ' + path);
      assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    }
    assert.equal(calls.length, 0);
  });
});

test('legitimate production cross-origin requests retain explicit Origin support', async () => {
  await withUpstream(async calls => {
    const production = { ...env, ALLOWED_ORIGIN: 'https://duediligence.ph' };
    const headers = { Origin: production.ALLOWED_ORIGIN, 'Sec-Fetch-Site': 'cross-site', Authorization: 'Bearer allowed' };
    const response = await worker.fetch(request('/debate-room/events', headers, 'GET', 'https://api.example.workers.dev'), production);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).events, []);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), production.ALLOWED_ORIGIN);
    const post = await worker.fetch(request('/debate-room/access', headers, 'POST', 'https://api.example.workers.dev'), production);
    assert.equal(post.status, 200, 'The original explicit-Origin POST boundary remains usable');
    assert.equal((await post.json()).enabled, true);
    assert.equal(calls.filter(c => c.path === '/auth/v1/user').length, 2);
  });
});

test('same-origin reads retain preview, token, active-account and event membership denials', async () => {
  await withUpstream(async calls => {
    for (const [authorization, status, code] of [
      ['Basic invalid', 401, 'INVALID_SESSION'],
      ['Bearer expired', 401, 'INVALID_SESSION'],
      ['Bearer excluded', 403, 'DEBATE_PREVIEW_RESTRICTED'],
    ]) {
      const response = await worker.fetch(request('/debate-room/events', { ...metadata, Authorization: authorization }), env);
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
    assert.equal(calls.some(c => c.path.startsWith('/rest/')), false);
    const response = await worker.fetch(request('/debate-room/snapshot?eventId=private-event', { ...metadata, Authorization: 'Bearer allowed' }), env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'NOT_MEMBER');
  });
  await withUpstream(async calls => {
    const response = await worker.fetch(request('/debate-room/events', { ...metadata, Authorization: 'Bearer allowed' }), env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'STUDY_ROOM_ACCOUNT_UNAVAILABLE');
    assert.equal(calls.length, 1);
  }, { user: { deleted_at: '2026-09-01T00:00:00Z' } });
});

test('staging smoke exercises the actual Worker API boundary without manufacturing Origin', async () => {
  await withUpstream(async calls => {
    const responses = [];
    const result = await smokeStaging({
      allowedToken: 'allowed', deniedToken: 'excluded', manifest: { hashes: {} },
      fetcher: async (url, options) => {
        const incoming = new Request(url, options);
        assert.equal(incoming.headers.has('Origin'), false);
        assert.equal(incoming.headers.get('Sec-Fetch-Site'), 'same-origin');
        const response = await worker.fetch(incoming, { ...env, ALLOWED_ORIGIN: TARGET.origin });
        responses.push(response.status);
        return response;
      },
    });
    assert.equal(result.status, 'PASS_STAGING_ASSETS_AND_AUTH_ONLY');
    assert.equal(result.fullOrganizerJourney, false);
    assert.deepEqual(responses, [200, 401, 403, 200]);
    assert.deepEqual(calls.map(c => c.path), ['/auth/v1/user', '/auth/v1/user', '/rest/v1/rpc/debate_v3_list']);
  });
});
