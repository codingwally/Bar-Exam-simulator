import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommunitySampleContent } from './community-sample-content.mjs';
import {
  ForumValidationError,
  normalizeQuorumCommandRequest,
  normalizeQuorumQueryRequest,
} from './forum-core.mjs';

test('Home sample feed contains exactly 23 fictional posts and 32 read-only comments', () => {
  const sample = buildCommunitySampleContent(Date.UTC(2026, 7, 21, 8));
  assert.equal(sample.sample, true);
  assert.equal(sample.readOnly, true);
  assert.deepEqual(sample.totals, { posts: 23, comments: 32 });
  assert.equal(sample.items.length, 23);
  assert.equal(sample.items.flatMap((post) => post.comments).length, 32);
  for (const post of sample.items) {
    assert.equal(post.sample, true);
    assert.equal(post.readOnly, true);
    assert.equal(post.commentsLocked, true);
    assert.equal(post.anonymous, true);
    assert.equal(post.author.memberId, null);
    assert.equal(post.author.school, null);
    assert.equal(post.author.year, null);
    assert.match(post.entryId, /^sample_post_\d{3}$/);
    for (const comment of post.comments) {
      assert.equal(comment.sample, true);
      assert.equal(comment.readOnly, true);
      assert.equal(comment.anonymous, true);
      assert.equal(comment.author.memberId, null);
    }
  }
});

test('Home sample copy contains no contact details, links, or copied-member identity fields', () => {
  const serialized = JSON.stringify(buildCommunitySampleContent());
  assert.doesNotMatch(serialized, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(serialized, /https?:\/\/|www\./i);
  assert.doesNotMatch(serialized, /facebook\.com|memberId":"[^"]+|studentNumber/i);
});

test('sample feed is queryable but sample IDs cannot enter real mutation commands', () => {
  const query = normalizeQuorumQueryRequest({ operation: 'sample_feed', payload: {} });
  assert.equal(query.operation, 'sample_feed');
  assert.throws(
    () => normalizeQuorumCommandRequest({
      operation: 'set_affirm',
      payload: { entryId: 'sample_post_001', reaction: 'hear' },
    }),
    ForumValidationError,
  );
});
