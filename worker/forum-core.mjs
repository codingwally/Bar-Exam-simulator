export const FORUM_LIMITS = Object.freeze({
  requestBytes: 16_000,
  postCharacters: 4_000,
  commentCharacters: 2_000,
  repostCharacters: 1_000,
  explanationCharacters: 1_000,
  sourceUrlCharacters: 2_000,
  feedPageSize: 10,
  maximumFeedPageSize: 20,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const REPORT_CATEGORIES = new Set([
  'harassment',
  'misinformation',
  'unsafe_link',
  'spam',
  'privacy',
  'other',
]);
const ADMIN_ACTIONS = new Set([
  'hide_content',
  'restore_content',
  'remove_content',
  'dismiss_report',
  'restrict_user',
  'remove_restriction',
]);

export class ForumValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ForumValidationError';
    this.code = code;
    this.status = status;
  }
}

export function forumUuid(value, label = 'Forum record') {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new ForumValidationError('INVALID_FORUM_REQUEST', `${label} is invalid.`);
  }
  return normalized.toLowerCase();
}

export function forumPlainText(value, options = {}) {
  const label = options.label || 'Content';
  const minimum = Number.isInteger(options.minimum) ? options.minimum : 1;
  const maximum = Number.isInteger(options.maximum) ? options.maximum : FORUM_LIMITS.postCharacters;
  const optional = options.optional === true;
  const normalized = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!normalized && optional) return null;
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ForumValidationError(
      'INVALID_FORUM_REQUEST',
      `${label} must contain ${minimum} to ${maximum} characters.`,
    );
  }
  if (options.forbidEmail === true && EMAIL_PATTERN.test(normalized)) {
    throw new ForumValidationError(
      'FORUM_PRIVATE_CONTACT',
      `${label} cannot contain an email address.`,
    );
  }
  return normalized;
}

export function forumSourceUrl(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (source.length > FORUM_LIMITS.sourceUrlCharacters) {
    throw new ForumValidationError('UNSAFE_FORUM_URL', 'The legal source URL is too long.');
  }
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new ForumValidationError(
      'UNSAFE_FORUM_URL',
      'Use a valid http:// or https:// legal source URL.',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ForumValidationError(
      'UNSAFE_FORUM_URL',
      'Use a valid http:// or https:// legal source URL without credentials.',
    );
  }
  return url.href;
}

export function normalizeForumFeedRequest(payload = {}) {
  const rawLimit = Number(payload.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(FORUM_LIMITS.maximumFeedPageSize, Math.max(1, Math.floor(rawLimit)))
    : FORUM_LIMITS.feedPageSize;
  let cursorAt = null;
  let cursorId = null;
  if (payload.cursor !== undefined && payload.cursor !== null) {
    const candidate = payload.cursor;
    const timestamp = new Date(candidate?.createdAt || '');
    if (!Number.isFinite(timestamp.getTime())) {
      throw new ForumValidationError('INVALID_FORUM_CURSOR', 'The feed cursor is invalid.');
    }
    cursorAt = timestamp.toISOString();
    cursorId = forumUuid(candidate?.id, 'Feed cursor');
  }
  const postId = payload.postId ? forumUuid(payload.postId, 'Post') : null;
  return { limit, cursorAt, cursorId, postId };
}

export function normalizeForumPostRequest(payload = {}, mode = 'create') {
  const postId = mode === 'create' ? null : forumUuid(payload.postId, 'Post');
  return {
    postId,
    body: forumPlainText(payload.body, {
      label: 'Post',
      maximum: FORUM_LIMITS.postCharacters,
      forbidEmail: true,
    }),
    sourceUrl: forumSourceUrl(payload.sourceUrl),
  };
}

export function normalizeForumDeleteRequest(payload = {}, label = 'Post') {
  const property = label === 'Comment'
    ? 'commentId'
    : label === 'Repost'
      ? 'repostId'
      : 'postId';
  return { id: forumUuid(payload[property], label) };
}

export function normalizeForumCommentRequest(payload = {}, mode = 'create') {
  return {
    postId: mode === 'create' ? forumUuid(payload.postId, 'Post') : null,
    commentId: mode === 'create' ? null : forumUuid(payload.commentId, 'Comment'),
    body: forumPlainText(payload.body, {
      label: 'Comment',
      maximum: FORUM_LIMITS.commentCharacters,
      forbidEmail: true,
    }),
  };
}

export function normalizeForumReactionRequest(payload = {}) {
  if (typeof payload.liked !== 'boolean') {
    throw new ForumValidationError(
      'INVALID_FORUM_REQUEST',
      'The requested reaction state is invalid.',
    );
  }
  return {
    postId: forumUuid(payload.postId, 'Post'),
    liked: payload.liked,
  };
}

export function normalizeForumRepostRequest(payload = {}) {
  return {
    postId: forumUuid(payload.postId, 'Post'),
    commentary: forumPlainText(payload.commentary, {
      label: 'Repost commentary',
      maximum: FORUM_LIMITS.repostCharacters,
      optional: true,
      forbidEmail: true,
    }),
  };
}

export function normalizeForumReportRequest(payload = {}) {
  const targetType = String(payload.targetType || '').trim().toLowerCase();
  if (!['post', 'comment'].includes(targetType)) {
    throw new ForumValidationError('INVALID_FORUM_REPORT', 'Choose a post or comment to report.');
  }
  const category = String(payload.category || '').trim().toLowerCase();
  if (!REPORT_CATEGORIES.has(category)) {
    throw new ForumValidationError('INVALID_FORUM_REPORT', 'Choose a report category.');
  }
  return {
    targetType,
    targetId: forumUuid(payload.targetId, targetType === 'post' ? 'Post' : 'Comment'),
    category,
    explanation: forumPlainText(payload.explanation, {
      label: 'Report explanation',
      maximum: FORUM_LIMITS.explanationCharacters,
      optional: true,
    }),
  };
}

export function normalizeForumAdminQueue(payload = {}) {
  const status = String(payload.status || 'pending').trim().toLowerCase();
  if (!['pending', 'actioned', 'dismissed', 'all'].includes(status)) {
    throw new ForumValidationError('INVALID_FORUM_ADMIN_REQUEST', 'The moderation status is invalid.');
  }
  return {
    status,
    limit: Math.min(200, Math.max(1, Math.floor(Number(payload.limit) || 100))),
    offset: Math.min(10_000, Math.max(0, Math.floor(Number(payload.offset) || 0))),
  };
}

export function normalizeForumAdminAction(payload = {}, requestId = '') {
  const action = String(payload.action || '').trim().toLowerCase();
  if (!ADMIN_ACTIONS.has(action)) {
    throw new ForumValidationError('INVALID_FORUM_ADMIN_ACTION', 'The moderation action is invalid.');
  }
  const reason = forumPlainText(payload.reason, {
    label: 'Moderation reason',
    minimum: 5,
    maximum: 1_000,
  });
  const durationHours = action === 'restrict_user'
    ? Math.floor(Number(payload.durationHours))
    : null;
  if (action === 'restrict_user'
      && (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 8_760)) {
    throw new ForumValidationError(
      'INVALID_FORUM_ADMIN_ACTION',
      'Posting restrictions must last from 1 hour to 365 days.',
    );
  }
  const normalizedRequestId = String(requestId || payload.requestId || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalizedRequestId)) {
    throw new ForumValidationError(
      'INVALID_FORUM_ADMIN_ACTION',
      'A valid moderation request identifier is required.',
    );
  }
  return {
    action,
    targetId: forumUuid(payload.targetId, action === 'remove_restriction' ? 'Restriction' : 'Report'),
    reason,
    durationHours,
    requestId: normalizedRequestId,
  };
}

export function forumDatabaseError(errorMessage = '') {
  const message = String(errorMessage || '');
  const cases = [
    [/FORUM_AUTHENTICATION_REQUIRED/i, 'AUTHENTICATION_REQUIRED', 'Sign in to use Lex Forum.', 401],
    [/Founder administrator authorization required/i, 'ADMIN_FORBIDDEN', 'Founder administrator authorization is required.', 403],
    [/FORUM_OWNERSHIP_REQUIRED/i, 'FORUM_FORBIDDEN', 'You may change only your own forum content.', 403],
    [/FORUM_POSTING_RESTRICTED/i, 'FORUM_POSTING_RESTRICTED', 'Your Lex Forum posting access is temporarily restricted.', 403],
    [/FORUM_PRIVATE_CONTACT/i, 'FORUM_PRIVATE_CONTACT', 'Remove private contact information before publishing.', 400],
    [/FORUM_RATE_LIMITED/i, 'FORUM_RATE_LIMITED', 'Too many forum actions. Please wait and try again.', 429],
    [/FORUM_ADMIN_REQUEST_KEY_CONFLICT/i, 'FORUM_REQUEST_CONFLICT', 'This moderation request conflicts with an earlier action.', 409],
    [/FORUM_DUPLICATE_REPORT/i, 'FORUM_DUPLICATE_REPORT', 'You have already reported this content.', 409],
    [/FORUM_DUPLICATE_(POST|COMMENT)/i, 'FORUM_DUPLICATE_CONTENT', 'This content was just submitted.', 409],
    [/FORUM_(POST|COMMENT|REPOST|REPORT|RESTRICTION|TARGET)_NOT_FOUND/i, 'FORUM_NOT_FOUND', 'The forum record is no longer available.', 404],
    [/FORUM_.*_(INVALID|NOT_EDITABLE)/i, 'INVALID_FORUM_REQUEST', 'The forum request did not pass validation.', 400],
  ];
  const match = cases.find(([pattern]) => pattern.test(message));
  return match
    ? new ForumValidationError(match[1], match[2], match[3])
    : new ForumValidationError(
      'FORUM_UNAVAILABLE',
      'Lex Forum is temporarily unavailable. Please try again.',
      503,
    );
}
