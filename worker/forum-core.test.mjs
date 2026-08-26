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
  normalizeQuorumAdminRequest,
  normalizeQuorumAvatar,
  normalizeQuorumCommandRequest,
  normalizeQuorumImage,
  normalizeQuorumQueryRequest,
} from './forum-core.mjs';

const origin = 'https://duediligence.ph';
const userA = '11111111-1111-4111-8111-111111111111';
const postA = '22222222-2222-4222-8222-222222222222';
const reportA = '33333333-3333-4333-8333-333333333333';
const entryA = 'qe_aaaaaaaaaaaaaaaaaaaa';
const commentA = 'qc_bbbbbbbbbbbbbbbbbbbb';
const memberA = 'qm_cccccccccccccccccccc';
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

test('simple Quorum entries require only body and type while accepting optional details', () => {
  const discussion = normalizeQuorumCommandRequest({
    operation: 'create_simple_entry',
    payload: {
      body: 'Incoming first-year student asking when enrollment dates are usually announced.',
      kind: 'discussion',
    },
  });
  assert.equal(discussion.payload.kind, 'discussion');
  assert.equal(discussion.payload.subject, null);
  assert.equal(discussion.payload.sourceUrl, null);

  const question = normalizeQuorumCommandRequest({
    operation: 'create_simple_entry',
    payload: {
      body: 'Which codal should I read first for Civil Law?',
      kind: 'question',
      subject: 'Civil Law',
      lawSchoolYear: '1L',
      sourceUrl: 'https://elibrary.judiciary.gov.ph/',
      imageAlt: 'A study desk with Philippine codals and handwritten notes.',
    },
  });
  assert.equal(question.payload.kind, 'question');
  assert.equal(question.payload.subject, 'Civil Law');
  assert.equal(question.payload.lawSchoolYear, '1L');
  assert.match(question.payload.sourceUrl, /^https:/);
});

test('Affirm supports exactly one of three reactions or removal', () => {
  for (const reaction of ['hear', 'see', 'feel']) {
    const normalized = normalizeQuorumCommandRequest({
      operation: 'set_affirm',
      payload: { entryId: entryA, reaction },
    });
    assert.equal(normalized.payload.reaction, reaction);
  }
  assert.equal(normalizeQuorumCommandRequest({
    operation: 'set_affirm',
    payload: { entryId: entryA, reaction: null },
  }).payload.reaction, null);
  assert.throws(() => normalizeQuorumCommandRequest({
    operation: 'set_affirm',
    payload: { entryId: entryA, reaction: 'like' },
  }), ForumValidationError);
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

test('legacy post creation is retired in favor of the privacy-safe Quorum command route', async () => {
  let rpcCalled = false;
  const restore = installForumFetch(async (url, options) => {
    rpcCalled = true;
    return Response.json({});
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
    assert.equal(response.status, 410);
    assert.equal(payload.error.code, 'FORUM_ROUTE_RETIRED');
    assert.equal(rpcCalled, false);
  } finally {
    restore();
  }
});

test('legacy post creation stays retired even for an unsafe URL payload', async () => {
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
    assert.equal(response.status, 410);
    assert.equal(payload.error.code, 'FORUM_ROUTE_RETIRED');
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

test('Quorum queries validate opaque identifiers and bound pagination', () => {
  const normalized = normalizeQuorumQueryRequest({
    operation: 'feed',
    payload: {
      limit: 500,
      subject: 'Labor Law',
      entryType: 'discuss_legal_issue',
      cursorAt: '2026-08-03T00:00:00Z',
      cursorId: entryA,
    },
  });
  assert.equal(normalized.operation, 'feed');
  assert.equal(normalized.payload.limit, 20);
  assert.equal(normalized.payload.cursorId, entryA);
  const sample = normalizeQuorumQueryRequest({ operation: 'sample_feed', payload: {} });
  assert.equal(sample.operation, 'sample_feed');
  assert.deepEqual(sample.payload, {});
  assert.throws(
    () => normalizeQuorumQueryRequest({
      operation: 'entry',
      payload: { entryId: postA },
    }),
    /Entry is invalid/i,
  );
});

test('Quorum entry normalization enforces taxonomy and ignores spoofed ownership', () => {
  const normalized = normalizeQuorumCommandRequest({
    operation: 'create_entry',
    payload: {
      authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: 'Article 279 applies to the dismissal because the employer supplied no lawful cause.',
      entryType: 'discuss_legal_issue',
      subject: 'Labor Law',
      category: 'bar_examination',
      sourceUrl: 'https://elibrary.judiciary.gov.ph/',
      opinionOnly: false,
      imageAlt: 'A study desk with a Labor Code and handwritten case notes.',
    },
  });
  assert.equal(normalized.operation, 'create_entry');
  assert.equal(normalized.payload.subject, 'Labor Law');
  assert.equal(
    normalized.payload.imageAlt,
    'A study desk with a Labor Code and handwritten case notes.',
  );
  assert.equal('authorUserId' in normalized.payload, false);
  assert.throws(
    () => normalizeQuorumCommandRequest({
      operation: 'create_entry',
      payload: {
        body: 'A case note without the case title.',
        entryType: 'share_case_note',
        subject: 'Labor Law',
        category: 'philippine_jurisprudence',
      },
    }),
    /case title/i,
  );
});

test('Quorum entry and comment payloads remain plain text and reject unsafe links', () => {
  const xss = '<img src=x onerror=alert(1)> The doctrine should be checked.';
  const normalized = normalizeQuorumCommandRequest({
    operation: 'create_comment',
    payload: { entryId: entryA, parentCommentId: commentA, body: xss },
  });
  assert.equal(normalized.payload.body, xss);
  assert.throws(
    () => normalizeQuorumCommandRequest({
      operation: 'create_entry',
      payload: {
        body: 'Unsafe source attempt.',
        entryType: 'ask_community',
        category: 'law_school_life',
        sourceUrl: 'javascript:alert(1)',
      },
    }),
    /URL/i,
  );
});

test('Quorum image validation accepts real signatures and rejects disguised files', () => {
  const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
  const png = normalizeQuorumImage({
    mimeType: 'image/png',
    dataBase64: Buffer.from(pngBytes).toString('base64'),
  });
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.extension, 'png');
  assert.throws(
    () => normalizeQuorumImage({
      mimeType: 'image/png',
      dataBase64: Buffer.from('MZ executable').toString('base64'),
    }),
    /file contents/i,
  );
});

test('Quorum profile photos enforce the same 3 MB upload boundary as post images', () => {
  const acceptedBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  const avatar = normalizeQuorumAvatar({
    mimeType: 'image/jpeg',
    dataBase64: Buffer.from(acceptedBytes).toString('base64'),
    width: 512,
    height: 512,
  });
  assert.equal(avatar.byteSize, acceptedBytes.byteLength);
  assert.equal(avatar.cropX, 0.5);
  assert.equal(avatar.cropY, 0.5);

  const boundaryCrop = normalizeQuorumAvatar({
    mimeType: 'image/jpeg',
    dataBase64: Buffer.from(acceptedBytes).toString('base64'),
    width: 512,
    height: 512,
    cropX: 0,
    cropY: 1,
  });
  assert.equal(boundaryCrop.cropX, 0, 'An exact left-edge crop must not be recentered.');
  assert.equal(boundaryCrop.cropY, 1, 'An exact bottom-edge crop must remain at the boundary.');

  const oversizedBytes = new Uint8Array(3_145_729);
  oversizedBytes.set([0xff, 0xd8, 0xff]);
  assert.throws(
    () => normalizeQuorumAvatar({
      mimeType: 'image/jpeg',
      dataBase64: Buffer.from(oversizedBytes).toString('base64'),
      width: 512,
      height: 512,
    }),
    /too large after optimization/i,
  );
  assert.deepEqual(
    normalizeQuorumCommandRequest({ operation: 'remove_profile_avatar', payload: {} }),
    { operation: 'remove_profile_avatar', payload: {} },
  );
});

test('Quorum moderation requires exact safe duration and opaque targets', () => {
  const normalized = normalizeQuorumAdminRequest({
    operation: 'action',
    payload: {
      action: 'restrict_user',
      memberId: memberA,
      durationHours: 24,
      reason: 'Repeated unauthorized advertising after warning.',
      requestId: 'quorumrequest1234567890',
    },
  }, 'quorumrequest1234567890');
  assert.equal(normalized.payload.durationHours, 24);
  assert.throws(
    () => normalizeQuorumAdminRequest({
      operation: 'action',
      payload: {
        action: 'restrict_user',
        memberId: memberA,
        durationHours: 0,
        reason: 'Repeated unauthorized advertising.',
        requestId: 'quorumrequest1234567890',
      },
    }, 'quorumrequest1234567890'),
    /1 hour/i,
  );
});

test('signed-out users cannot query any Quorum data', async () => {
  let storageCalled = false;
  const restore = installForumFetch(async () => {
    storageCalled = true;
    throw new Error('Quorum storage must not be called.');
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/query', { operation: 'feed', payload: { limit: 10 } }, false),
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

test('Quorum reads use the verified session identity and controlled RPC', async () => {
  let rpcBody;
  const restore = installForumFetch(async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_quorum_query_v2$/);
    rpcBody = JSON.parse(options.body);
    return Response.json({ items: [], hasMore: false, nextCursor: null });
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/query', {
        operation: 'feed',
        payload: { limit: 10, subject: 'Labor Law' },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.items, []);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal(rpcBody.p_operation, 'feed');
    assert.equal(rpcBody.p_payload.subject, 'Labor Law');
  } finally {
    restore();
  }
});

test('Quorum image signing preserves the Supabase storage API prefix', async () => {
  const imagePath = `entries/${entryA}/evidence.png`;
  const absoluteImagePath = `entries/${entryA}/absolute-evidence.jpg`;
  const restore = installForumFetch(async (url) => {
    if (url.endsWith('/rest/v1/rpc/forum_quorum_query_v2')) {
      return Response.json({
        items: [{
          entryId: entryA,
          body: 'A source-backed post with an image.',
          imagePath,
        }, {
          entryId: 'qe_bbbbbbbbbbbbbbbbbbbb',
          body: 'A second source-backed post with an image.',
          imagePath: absoluteImagePath,
        }],
        hasMore: false,
        nextCursor: null,
      });
    }
    if (url.endsWith('/storage/v1/object/sign/quorum-images')) {
      return Response.json([{
        path: imagePath,
        signedURL: `/object/sign/quorum-images/${imagePath}?token=opaque-test-token`,
      }, {
        path: absoluteImagePath,
        signedURL: `https://test.supabase.co/object/sign/quorum-images/${absoluteImagePath}?token=opaque-absolute-token`,
      }]);
    }
    throw new Error(`Unexpected Quorum image request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/query', {
        operation: 'feed',
        payload: { limit: 10 },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(
      payload.data.items[0].imageUrl,
      `https://test.supabase.co/storage/v1/object/sign/quorum-images/${imagePath}?token=opaque-test-token`,
    );
    assert.equal(
      payload.data.items[1].imageUrl,
      `https://test.supabase.co/storage/v1/object/sign/quorum-images/${absoluteImagePath}?token=opaque-absolute-token`,
    );
    assert.equal('imagePath' in payload.data.items[0], false);
    assert.equal('imagePath' in payload.data.items[1], false);
  } finally {
    restore();
  }
});

test('Quorum profile photo upload returns a signed avatar URL without exposing its object path', async () => {
  let avatarPath = '';
  let rpcBody = null;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.includes('/storage/v1/object/quorum-images/profiles/')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Cache-Control'], 'private, max-age=3600');
      avatarPath = decodeURIComponent(url.split('/quorum-images/')[1]);
      assert.match(avatarPath, /^profiles\/[a-f0-9]{24}\.jpg$/);
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_profile_avatar')) {
      rpcBody = JSON.parse(options.body);
      return Response.json({ previousPath: null });
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      assert.equal(JSON.parse(options.body).p_object_path, avatarPath);
      return Response.json({ state: 'active' });
    }
    if (url.endsWith('/storage/v1/object/sign/quorum-images')) {
      const signRequest = JSON.parse(options.body);
      assert.deepEqual(signRequest.paths, [avatarPath]);
      return Response.json([{
        path: avatarPath,
        signedURL: `/object/sign/quorum-images/${avatarPath}?token=signed-profile-photo-token`,
      }]);
    }
    throw new Error(`Unexpected profile photo upload request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal(rpcBody.p_payload.objectPath, avatarPath);
    assert.equal(
      payload.data.avatarUrl,
      `https://test.supabase.co/storage/v1/object/sign/quorum-images/${avatarPath}?token=signed-profile-photo-token`,
    );
    assert.equal('avatarPath' in payload.data, false);
  } finally {
    restore();
  }
});

test('Quorum profile photo upload aborts before storage when its cleanup intent is not durable', async () => {
  let storageCalls = 0;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      return Response.json({ message: 'database unavailable' }, { status: 503 });
    }
    if (url.includes('/storage/v1/object/quorum-images/profiles/')) {
      storageCalls += 1;
    }
    throw new Error(`Unexpected unsafe profile photo preflight request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'QUORUM_IMAGE_UNAVAILABLE');
    assert.match(payload.error.message, /Nothing was uploaded/);
    assert.equal(storageCalls, 0);
  } finally {
    restore();
  }
});

test('Quorum profile photo upload reports a saved-but-undisplayable signing failure truthfully', async () => {
  let avatarPath = '';
  let signAttempts = 0;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.includes('/storage/v1/object/quorum-images/profiles/')) {
      assert.equal(options.method, 'POST');
      avatarPath = decodeURIComponent(url.split('/quorum-images/')[1]);
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_profile_avatar')) {
      return Response.json({ previousPath: null });
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      return Response.json({ state: 'active' });
    }
    if (url.includes('/storage/v1/object/sign/quorum-images')) {
      signAttempts += 1;
      return Response.json({ message: 'signing unavailable' }, { status: 503 });
    }
    throw new Error(`Unexpected profile photo signing-failure request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.match(avatarPath, /^profiles\/[a-f0-9]{24}\.jpg$/);
    assert.equal(response.status, 502);
    assert.equal(payload.ok, false);
    assert.match(payload.error.message, /was saved, but it could not be displayed securely/i);
    assert.ok(signAttempts >= 4, 'batch and individual signing must both retry before failure');
  } finally {
    restore();
  }
});

test('Quorum profile photo replacement keeps failed old-object cleanup durably queued', async () => {
  const previousPath = 'profiles/bbbbbbbbbbbbbbbbbbbbbbbb.jpg';
  let avatarPath = '';
  let attemptedNewObjectDeletion = false;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.includes('/storage/v1/object/quorum-images/profiles/') && options.method === 'POST') {
      avatarPath = decodeURIComponent(url.split('/quorum-images/')[1]);
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_profile_avatar')) {
      return Response.json({
        updated: true,
        avatarPath,
        previousPath,
        cleanupQueued: true,
      });
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      const cleanupPath = JSON.parse(options.body).p_object_path;
      return Response.json({ state: cleanupPath === avatarPath ? 'active' : 'safe' });
    }
    if (url.endsWith('/rest/v1/rpc/forum_defer_profile_avatar_cleanup')) {
      assert.equal(JSON.parse(options.body).p_object_path, previousPath);
      return Response.json({ state: 'deferred', attemptCount: 1 });
    }
    if (url.endsWith(`/storage/v1/object/quorum-images/${previousPath}`)) {
      assert.equal(options.method, 'DELETE');
      return Response.json({ message: 'storage temporarily unavailable' }, { status: 503 });
    }
    if (avatarPath && url.endsWith(`/storage/v1/object/quorum-images/${avatarPath}`)) {
      attemptedNewObjectDeletion = true;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/storage/v1/object/sign/quorum-images')) {
      return Response.json([{
        path: avatarPath,
        signedURL: `/object/sign/quorum-images/${avatarPath}?token=replacement-token`,
      }]);
    }
    throw new Error(`Unexpected profile photo replacement request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(attemptedNewObjectDeletion, false, 'the newly active photo must remain stored');
    assert.equal('previousPath' in payload.data, false, 'private cleanup paths must not leak');
    assert.equal('cleanupQueued' in payload.data, false, 'internal queue state must not leak');
    assert.equal(
      payload.data.avatarUrl,
      `https://test.supabase.co/storage/v1/object/sign/quorum-images/${avatarPath}?token=replacement-token`,
    );
  } finally {
    restore();
  }
});

test('Quorum profile photo upload survives a lost RPC acknowledgement after commit', async () => {
  let avatarPath = '';
  let attemptedNewObjectDeletion = false;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.includes('/storage/v1/object/quorum-images/profiles/') && options.method === 'POST') {
      avatarPath = decodeURIComponent(url.split('/quorum-images/')[1]);
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_profile_avatar')) {
      throw new TypeError('response connection closed after database commit');
    }
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.')
        && (options.method || 'GET') === 'GET') {
      return Response.json([{ object_path: avatarPath }]);
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      return Response.json({ state: 'active' });
    }
    if (avatarPath && url.endsWith(`/storage/v1/object/quorum-images/${avatarPath}`)) {
      attemptedNewObjectDeletion = true;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/storage/v1/object/sign/quorum-images')) {
      return Response.json([{
        path: avatarPath,
        signedURL: `/object/sign/quorum-images/${avatarPath}?token=commit-readback-token`,
      }]);
    }
    throw new Error(`Unexpected lost-acknowledgement profile photo request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(attemptedNewObjectDeletion, false, 'readback-confirmed active storage must be preserved');
    assert.equal(
      payload.data.avatarUrl,
      `https://test.supabase.co/storage/v1/object/sign/quorum-images/${avatarPath}?token=commit-readback-token`,
    );
  } finally {
    restore();
  }
});

test('Quorum profile photo upload never deletes an ambiguous delayed-commit object', async () => {
  const previousPath = 'profiles/dddddddddddddddddddddddd.jpg';
  let avatarPath = '';
  let attemptedNewObjectDeletion = false;
  let queuedCleanup = null;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/storage/v1/object/quorum-images/profiles/') && options.method === 'POST') {
      avatarPath = decodeURIComponent(url.split('/quorum-images/')[1]);
      return new Response(null, { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_profile_avatar')) {
      throw new TypeError('gateway closed while database commit was still completing');
    }
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.')
        && (options.method || 'GET') === 'GET') {
      return Response.json([{ object_path: previousPath }]);
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?on_conflict=object_path')
        && options.method === 'POST') {
      queuedCleanup = JSON.parse(options.body);
      assert.equal(options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
      assert.ok(
        Date.parse(queuedCleanup.not_before) >= Date.now() + 9 * 60 * 1_000,
        'uncertain cleanup must wait long enough for any delayed commit to settle',
      );
      return new Response(null, { status: 201 });
    }
    if (avatarPath && url.endsWith(`/storage/v1/object/quorum-images/${avatarPath}`)) {
      attemptedNewObjectDeletion = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected delayed-commit profile photo request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage: {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
          width: 512,
          height: 512,
          cropX: 0.5,
          cropY: 0.5,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'QUORUM_PROFILE_UNCERTAIN');
    assert.match(payload.error.message, /Refresh your profile before trying again/);
    assert.equal(attemptedNewObjectDeletion, false, 'ambiguous commit storage must be preserved');
    assert.equal(queuedCleanup.object_path, avatarPath);
    assert.equal(queuedCleanup.user_id, userA);
  } finally {
    restore();
  }
});

test('scheduled Quorum profile photo reconciliation deletes queued private objects', async () => {
  const previousPath = 'profiles/cccccccccccccccccccccccc.webp';
  const calls = [];
  const restore = installForumFetch(async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      return Response.json({ ok: true, job: null });
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?')
        && (options.method || 'GET') === 'GET') {
      assert.match(url, /select=object_path/);
      assert.match(url, /not_before=lte\./);
      assert.match(url, /order=queued_at\.asc%2Cobject_path\.asc/);
      return Response.json([{ object_path: previousPath }]);
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      assert.equal(JSON.parse(options.body).p_object_path, previousPath);
      return Response.json({ state: 'safe' });
    }
    if (url.endsWith(`/storage/v1/object/quorum-images/${previousPath}`)) {
      assert.equal(options.method, 'DELETE');
      return new Response(null, { status: 204 });
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?')
        && options.method === 'DELETE') {
      assert.match(url, /object_path=eq\.profiles%2Fcccccccccccccccccccccccc\.webp/);
      assert.equal(options.headers.Prefer, 'return=minimal');
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected scheduled profile photo cleanup request: ${url}`);
  });
  try {
    let pendingCleanup = null;
    await worker.scheduled({}, baseEnv, {
      waitUntil(task) {
        pendingCleanup = task;
      },
    });
    assert.ok(pendingCleanup, 'scheduled cleanup must be registered with waitUntil');
    await pendingCleanup;
    assert.ok(
      calls.some(({ url }) => url.endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')),
      'the combined maintenance schedule must retain Examination Room recovery',
    );
    assert.deepEqual(
      calls
        .filter(({ url }) => !url.endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot'))
        .map(({ method }) => method),
      ['GET', 'POST', 'DELETE', 'DELETE'],
    );
  } finally {
    restore();
  }
});

test('scheduled Quorum reconciliation never deletes a cleanup path that became active', async () => {
  const activePath = 'profiles/eeeeeeeeeeeeeeeeeeeeeeee.png';
  let storageDeleteCalls = 0;
  let queueDeleteCalls = 0;
  const restore = installForumFetch(async (url, options) => {
    if (url.endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      return Response.json({ ok: true, job: null });
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?')
        && (options.method || 'GET') === 'GET') {
      return Response.json([{ object_path: activePath }]);
    }
    if (url.endsWith('/rest/v1/rpc/forum_profile_avatar_cleanup_state')) {
      return Response.json({ state: 'active' });
    }
    if (url.endsWith(`/storage/v1/object/quorum-images/${activePath}`)) {
      storageDeleteCalls += 1;
      return new Response(null, { status: 204 });
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?')
        && options.method === 'DELETE') {
      queueDeleteCalls += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected active-path reconciliation request: ${url}`);
  });
  try {
    let pendingCleanup = null;
    await worker.scheduled({}, baseEnv, {
      waitUntil(task) {
        pendingCleanup = task;
      },
    });
    await pendingCleanup;
    assert.equal(storageDeleteCalls, 0, 'an active profile photo must never be deleted');
    assert.equal(queueDeleteCalls, 0, 'the database claim atomically acknowledges an active marker');
  } finally {
    restore();
  }
});

test('scheduled Examination Room recovery failures remain observable while avatar cleanup stays isolated', async () => {
  const restore = installForumFetch(async (url, options) => {
    if (url.endsWith('/rest/v1/rpc/examination_room_v1_claim_recovery_snapshot')) {
      throw new Error('test recovery outage');
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?')
        && (options.method || 'GET') === 'GET') {
      return Response.json([]);
    }
    throw new Error(`Unexpected scheduled maintenance request: ${url}`);
  });
  try {
    let pendingMaintenance = null;
    worker.scheduled({}, baseEnv, {
      waitUntil(task) {
        pendingMaintenance = task;
      },
    });
    assert.ok(pendingMaintenance, 'combined maintenance must be registered with waitUntil');
    await assert.rejects(pendingMaintenance, /test recovery outage/);
  } finally {
    restore();
  }
});

test('Quorum profile photo removal deletes only the authenticated member record and object', async () => {
  const avatarPath = 'profiles/aaaaaaaaaaaaaaaaaaaaaaaa.jpg';
  const calls = [];
  const restore = installForumFetch(async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.') && (options.method || 'GET') === 'GET') {
      assert.match(url, new RegExp(`user_id=eq\\.${userA}`));
      assert.match(url, /select=object_path&limit=1/);
      return Response.json([{ object_path: avatarPath }]);
    }
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.') && options.method === 'DELETE') {
      assert.match(url, new RegExp(`user_id=eq\\.${userA}`));
      assert.match(url, /object_path=eq\.profiles%2Faaaaaaaaaaaaaaaaaaaaaaaa\.jpg/);
      assert.equal(options.headers.Prefer, 'return=representation');
      return Response.json([{ object_path: avatarPath }]);
    }
    if (url.includes('/rest/v1/forum_profile_avatar_cleanup_jobs?') && options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith(`/storage/v1/object/quorum-images/${avatarPath}`)) {
      assert.equal(options.method, 'DELETE');
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected profile photo removal request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'remove_profile_avatar',
        payload: {},
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, { removed: true });
    assert.deepEqual(calls.map(({ method }) => method), ['GET', 'DELETE', 'DELETE', 'DELETE']);
  } finally {
    restore();
  }
});

test('Quorum profile photo removal fails truthfully when private-object deletion fails', async () => {
  const avatarPath = 'profiles/aaaaaaaaaaaaaaaaaaaaaaaa.jpg';
  let recordDeleteCalls = 0;
  const restore = installForumFetch(async (url, options) => {
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.') && (options.method || 'GET') === 'GET') {
      return Response.json([{ object_path: avatarPath }]);
    }
    if (url.endsWith(`/storage/v1/object/quorum-images/${avatarPath}`)) {
      assert.equal(options.method, 'DELETE');
      return Response.json({ message: 'storage unavailable' }, { status: 503 });
    }
    if (url.includes('/rest/v1/forum_profile_avatars?user_id=eq.') && options.method === 'DELETE') {
      recordDeleteCalls += 1;
      return Response.json([{ object_path: avatarPath }]);
    }
    throw new Error(`Unexpected profile photo failed-removal request: ${url}`);
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'remove_profile_avatar',
        payload: {},
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.ok, false);
    assert.match(payload.error.message, /could not be removed/i);
    assert.equal(recordDeleteCalls, 0, 'the recoverable database pointer must remain for retry');
  } finally {
    restore();
  }
});

test('Quorum insights and Affirm rosters use dedicated least-privilege RPCs', async () => {
  const calls = [];
  const restore = installForumFetch(async (url, options) => {
    calls.push({
      url,
      body: JSON.parse(options.body),
    });
    if (url.endsWith('/rest/v1/rpc/forum_quorum_insights')) {
      return Response.json({ trending: [], questions: [] });
    }
    if (url.endsWith('/rest/v1/rpc/forum_affirm_roster')) {
      return Response.json({
        entryId: entryA,
        groups: { hear: [], see: [], feel: [] },
      });
    }
    throw new Error(`Unexpected Quorum RPC: ${url}`);
  });
  try {
    const insightsResponse = await worker.fetch(
      forumRequest('/quorum/query', { operation: 'insights', payload: {} }),
      baseEnv,
    );
    const rosterResponse = await worker.fetch(
      forumRequest('/quorum/query', {
        operation: 'affirm_roster',
        payload: { entryId: entryA, limit: 60 },
      }),
      baseEnv,
    );
    assert.equal(insightsResponse.status, 200);
    assert.equal(rosterResponse.status, 200);
    assert.equal(calls[0].body.p_user_id, userA);
    assert.equal(calls[1].body.p_user_id, userA);
    assert.equal(calls[1].body.p_entry_id, entryA);
    assert.equal(calls[1].body.p_limit, 20);
  } finally {
    restore();
  }
});

test('Quorum commands cannot spoof author identity', async () => {
  let rpcBody;
  const restore = installForumFetch(async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/forum_quorum_command_v2$/);
    rpcBody = JSON.parse(options.body);
    return Response.json({
      entryId: entryA,
      publicationStatus: 'published',
      message: 'Entry published in Quorum.',
    });
  });
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'create_entry',
        payload: {
          authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          body: 'The Labor Code applies to this question.',
          entryType: 'discuss_legal_issue',
          subject: 'Labor Law',
          category: 'bar_examination',
          opinionOnly: false,
        },
      }),
      baseEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.entryId, entryA);
    assert.equal(rpcBody.p_user_id, userA);
    assert.equal('authorUserId' in rpcBody.p_payload, false);
  } finally {
    restore();
  }
});

test('Quorum simple publishing and atomic Affirm use dedicated RPCs', async () => {
  const calls = [];
  const restore = installForumFetch(async (url, options) => {
    calls.push({
      url,
      body: JSON.parse(options.body),
    });
    if (url.endsWith('/rest/v1/rpc/forum_publish_simple')) {
      return Response.json({
        entryId: entryA,
        publicationStatus: 'published',
        message: 'Entry published in Quorum.',
      });
    }
    if (url.endsWith('/rest/v1/rpc/forum_set_affirm')) {
      return Response.json({
        entryId: entryA,
        reaction: 'feel',
        counts: { hear: 0, see: 0, feel: 1 },
      });
    }
    throw new Error(`Unexpected Quorum RPC: ${url}`);
  });
  try {
    const postResponse = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'create_simple_entry',
        payload: {
          authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          body: 'How did you build a sustainable codal-reading routine?',
          kind: 'question',
        },
      }),
      baseEnv,
    );
    const affirmResponse = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_affirm',
        payload: {
          entryId: entryA,
          reaction: 'feel',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      }),
      baseEnv,
    );
    assert.equal(postResponse.status, 201);
    assert.equal(affirmResponse.status, 200);
    assert.equal(calls[0].body.p_user_id, userA);
    assert.equal(calls[0].body.p_operation, 'create');
    assert.equal('authorUserId' in calls[0].body.p_payload, false);
    assert.equal(calls[1].body.p_user_id, userA);
    assert.equal(calls[1].body.p_entry_id, entryA);
    assert.equal(calls[1].body.p_reaction_type, 'feel');
    assert.equal('userId' in calls[1].body, false);
  } finally {
    restore();
  }
});

test('Quorum failures never expose credentials or session tokens', async () => {
  const restore = installForumFetch(async () => Response.json(
    { message: 'FORUM_POST_NOT_FOUND' },
    { status: 404 },
  ));
  try {
    const response = await worker.fetch(
      forumRequest('/quorum/command', {
        operation: 'set_helpful',
        payload: { entryId: entryA, enabled: true },
      }),
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
