import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  ForumValidationError,
  forumDatabaseError,
  forumPlainText,
  forumSourceUrl,
  normalizeForumAdminAction,
  normalizeForumFeedRequest,
  normalizeForumPostRequest,
  normalizeForumReactionRequest,
  normalizeForumReportRequest,
} from './forum-core.mjs';

const origin = 'https://duediligence.ph';
const userA = '11111111-1111-4111-8111-111111111111';
const postA = '22222222-2222-4222-8222-222222222222';
const reportA = '33333333-3333-4333-8333-333333333333';
const baseEnv = Object.freeze({
  ALLOWED_ORIGIN: origin,
  GUEST_USAGE_HMAC_KEY: 'test-only-rate-key',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
});

function forumRequest(path, body = {}, authenticated = true) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      ...(authenticated ? { Authorization: 'Bearer verified-forum-session' } : {}),
    },
    body: JSON.stringify(body),
  });
}

function installForumFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: userA });
    }
    return handler(target, options);
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('plain-text normalization preserves legal formatting and removes unsafe controls', () => {
  const normalized = forumPlainText(' Answer:\r\nNo.\u0000\n\nLegal Basis:\tArticle 1159. ');
  assert.equal(normalized, 'Answer:\nNo.\n\nLegal Basis: Article 1159.');
  assert.match(normalized, /Answer:\nNo\./);
});

test('plain-text normalization does not interpret an XSS payload as markup', () => {
  const payload = '<img src=x onerror=alert(1)> Article 1159 applies.';
  assert.equal(forumPlainText(payload), payload);
});

test('public forum posts reject private email addresses', () => {
  assert.throws(
    () => normalizeForumPostRequest({
      body: 'Please send the private case notes to student@example.com.',
    }),
    (error) => error instanceof ForumValidationError
      && error.code === 'FORUM_PRIVATE_CONTACT',
  );
});

test('source URL validation accepts HTTPS and rejects script or credentialed URLs', () => {
  assert.equal(
    forumSourceUrl('https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904'),
    'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904',
  );
  for (const unsafe of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:secret@example.com/case',
    'ftp://example.com/case',
  ]) {
    assert.throws(() => forumSourceUrl(unsafe), ForumValidationError);
  }
});

test('feed cursors are bounded and UUID validated', () => {
  const request = normalizeForumFeedRequest({
    limit: 500,
    cursor: { createdAt: '2026-08-02T01:02:03Z', id: postA },
  });
  assert.equal(request.limit, 20);
  assert.equal(request.cursorAt, '2026-08-02T01:02:03.000Z');
  assert.equal(request.cursorId, postA);
  assert.throws(
    () => normalizeForumFeedRequest({ cursor: { createdAt: 'invalid', id: postA } }),
    /cursor/i,
  );
});

test('reaction requests require an explicit desired state for idempotency', () => {
  assert.deepEqual(
    normalizeForumReactionRequest({ postId: postA, liked: true }),
    { postId: postA, liked: true },
  );
  assert.throws(
    () => normalizeForumReactionRequest({ postId: postA }),
    /reaction state/i,
  );
});

test('reports require a supported target and category', () => {
  assert.deepEqual(
    normalizeForumReportRequest({
      targetType: 'post',
      targetId: postA,
      category: 'misinformation',
      explanation: 'The cited doctrine appears materially inaccurate.',
    }),
    {
      targetType: 'post',
      targetId: postA,
      category: 'misinformation',
      explanation: 'The cited doctrine appears materially inaccurate.',
    },
  );
  assert.throws(
    () => normalizeForumReportRequest({
      targetType: 'post',
      targetId: postA,
      category: 'unsupported',
    }),
    /category/i,
  );
});

test('moderation actions require a reason, safe duration, and idempotency key', () => {
  const action = normalizeForumAdminAction({
    action: 'restrict_user',
    targetId: reportA,
    reason: 'Repeated spam after a documented warning.',
    durationHours: 24,
  }, 'forumrequest1234567890');
  assert.equal(action.durationHours, 24);
  assert.throws(() => normalizeForumAdminAction({
    action: 'restrict_user',
    targetId: reportA,
    reason: 'Valid reason',
    durationHours: 0,
  }, 'forumrequest1234567890'), /1 hour/i);
});

test('conflicting moderation retries return a controlled conflict', () => {
  const error = forumDatabaseError('FORUM_ADMIN_REQUEST_KEY_CONFLICT');
  assert.equal(error.status, 409);
  assert.equal(error.code, 'FORUM_REQUEST_CONFLICT');
  assert.doesNotMatch(error.message, /requestTargetId|requestKey|uuid/i);
});

test('signed-out users cannot retrieve the forum feed', async () => {
  let storageCalled = false;
  const restore = installForumFetch(async () => {
    storageCalled = true;
    throw new Error('Forum storage must not be called.');
  });
  try {
    const response = await worker.fetch(
      forumRequest('/forum/feed', { limit: 10 }, false),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(storageCalled, false);
  } finally {
    restore();
  }
});

test('authenticated feed requests use the verified user and return controlled JSON', async () => {
  let rpcBody;
  const restore = installForumFetch(async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_feed$/);
    rpcBody = JSON.parse(options.body);
    return Response.json({ items: [], hasMore: false, nextCursor: null });
  });
  try {
    const response = await worker.fetch(
      forumRequest('/forum/feed', { limit: 10 }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.feed.items, []);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal(rpcBody.p_limit, 10);
  } finally {
    restore();
  }
});

test('authenticated post creation cannot spoof author ownership', async () => {
  let rpcBody;
  const restore = installForumFetch(async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_create_post$/);
    rpcBody = JSON.parse(options.body);
    return Response.json({ id: postA, createdAt: '2026-08-02T00:00:00Z' });
  });
  try {
    const response = await worker.fetch(
      forumRequest('/forum/posts/create', {
        authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        body: 'The Labor Code provision should be read with the cited case.',
        sourceUrl: 'https://elibrary.judiciary.gov.ph/',
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.post.id, postA);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal('authorUserId' in rpcBody, false);
  } finally {
    restore();
  }
});

test('unsafe post URLs are rejected before forum storage', async () => {
  let rpcCalled = false;
  const restore = installForumFetch(async () => {
    rpcCalled = true;
    return Response.json({});
  });
  try {
    const response = await worker.fetch(
      forumRequest('/forum/posts/create', {
        body: 'A source-conscious legal discussion.',
        sourceUrl: 'javascript:alert(1)',
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'UNSAFE_FORUM_URL');
    assert.equal(rpcCalled, false);
  } finally {
    restore();
  }
});

test('reaction endpoint sends an idempotent desired state', async () => {
  let rpcBody;
  const restore = installForumFetch(async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_set_reaction$/);
    rpcBody = JSON.parse(options.body);
    return Response.json({ liked: true, count: 1 });
  });
  try {
    const response = await worker.fetch(
      forumRequest('/forum/reactions', { postId: postA, liked: true }),
      baseEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal(rpcBody.p_post_id, postA);
    assert.equal(rpcBody.p_liked, true);
  } finally {
    restore();
  }
});

test('ordinary users receive a controlled denial from moderation endpoints', async () => {
  const restore = installForumFetch(async (url) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_admin_queue$/);
    return Response.json(
      { message: 'Founder administrator authorization required' },
      { status: 403 },
    );
  });
  try {
    const response = await worker.fetch(
      forumRequest('/admin/forum/queue', { status: 'pending' }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, 'ADMIN_FORBIDDEN');
  } finally {
    restore();
  }
});

test('forum errors do not expose service-role credentials or request content', async () => {
  const restore = installForumFetch(async () => Response.json(
    { message: 'FORUM_POST_NOT_FOUND' },
    { status: 404 },
  ));
  try {
    const response = await worker.fetch(
      forumRequest('/forum/reactions', { postId: postA, liked: true }),
      baseEnv,
    );
    const raw = await response.text();
    assert.equal(response.status, 404);
    assert.doesNotMatch(raw, /test-only-service-role/);
    assert.doesNotMatch(raw, /verified-forum-session/);
  } finally {
    restore();
  }
});
