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
const PUBLIC_ID_PATTERN = /^(qe|qc|qr|qm|qs|qn|qf|qx)_[a-f0-9]{20}$/;
const QUORUM_QUERY_OPERATIONS = new Set([
  'bootstrap',
  'feed',
  'saved',
  'unanswered',
  'entry',
  'comments',
  'circles',
  'circle',
  'notifications',
  'blocks',
  'profile',
  'search',
  'active_issues',
  'insights',
  'affirm_roster',
]);
const QUORUM_COMMAND_OPERATIONS = new Set([
  'create_entry',
  'create_simple_entry',
  'update_entry',
  'update_simple_entry',
  'delete_entry',
  'set_helpful',
  'set_affirm',
  'create_comment',
  'update_comment',
  'delete_comment',
  'create_repost',
  'delete_repost',
  'set_saved',
  'create_report',
  'set_block',
  'create_circle',
  'join_circle',
  'leave_circle',
  'archive_circle',
  'update_profile_settings',
  'mark_notification',
  'mark_all_notifications',
  'remove_attachment',
  'telemetry',
]);
const QUORUM_ADMIN_OPERATIONS = new Set(['queue', 'analytics', 'action']);
const QUORUM_ENTRY_TYPES = new Set([
  'ask_community',
  'discuss_legal_issue',
  'share_case_note',
  'request_study_help',
  'share_resource',
  'student_support',
  'school_bar_announcement',
]);
const QUORUM_SUBJECTS = new Set([
  'Political Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Mercantile Law',
  'Criminal Law',
  'Remedial Law',
  'Legal Ethics',
]);
const QUORUM_CATEGORIES = new Set([
  'philippine_legal_education',
  'philippine_jurisprudence',
  'bar_examination',
  'law_school_life',
  'career_internship',
  'student_support',
  'comparative_law',
]);
const QUORUM_IMAGE_MIMES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const QUORUM_REPORT_CATEGORIES = new Set([
  'harassment',
  'misinformation',
  'unsafe_link',
  'spam',
  'privacy',
  'sexual_content',
  'unlawful_content',
  'fundraising_spam',
  'unauthorized_advertising',
  'copyright',
  'impersonation',
  'academic_dishonesty',
  'other',
]);
const QUORUM_ADMIN_ACTIONS = new Set([
  'approve_announcement',
  'reject_announcement',
  'hide_entry',
  'restore_entry',
  'remove_entry',
  'hide_comment',
  'restore_comment',
  'remove_comment',
  'hide_circle',
  'restore_circle',
  'remove_circle',
  'lock_comments',
  'unlock_comments',
  'set_indicator',
  'dismiss_report',
  'restrict_user',
  'remove_restriction',
  'verify_profile',
  'unverify_profile',
]);
export const QUORUM_LIMITS = Object.freeze({
  requestBytes: 4_350_000,
  imageBytes: 3_145_728,
  entryCharacters: 4_000,
  commentCharacters: 2_000,
  repostCharacters: 1_000,
  circleDescriptionCharacters: 1_000,
  circleRulesCharacters: 2_000,
  searchCharacters: 120,
  pageSize: 10,
  maximumPageSize: 20,
});
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

function quorumObject(value, label = 'Quorum request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function quorumBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function quorumEnum(value, allowed, label, optional = false) {
  const normalized = String(value ?? '').trim();
  if (!normalized && optional) return null;
  if (!allowed.has(normalized)) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function quorumBoundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

export function forumPublicId(value, prefixes = null, label = 'Quorum record') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PUBLIC_ID_PATTERN.test(normalized)) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  if (prefixes && !prefixes.includes(normalized.slice(0, 2))) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function optionalPublicId(value, prefixes, label) {
  return value ? forumPublicId(value, prefixes, label) : null;
}

function quorumDate(value, label) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', `${label} is invalid.`);
  }
  return parsed.toISOString();
}

function safePayloadCopy(value, depth = 0) {
  if (depth > 4) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'The Quorum request is too deeply nested.');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.length > 8_000) {
      throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'A Quorum field is too long.');
    }
    return value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }
  if (Array.isArray(value)) {
    if (value.length > 50) {
      throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'The Quorum request contains too many items.');
    }
    return value.map((item) => safePayloadCopy(item, depth + 1));
  }
  const source = quorumObject(value);
  const keys = Object.keys(source);
  if (keys.length > 40) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'The Quorum request contains too many fields.');
  }
  return Object.fromEntries(keys.map((key) => {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) {
      throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'The Quorum request contains an invalid field.');
    }
    return [key, safePayloadCopy(source[key], depth + 1)];
  }));
}

export function normalizeQuorumQueryRequest(input = {}) {
  const request = quorumObject(input);
  const operation = String(request.operation || '').trim().toLowerCase();
  if (!QUORUM_QUERY_OPERATIONS.has(operation)) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'Choose a valid Quorum view.');
  }
  const payload = safePayloadCopy(request.payload || {});
  if (payload.limit !== undefined) {
    payload.limit = quorumBoundedInteger(
      payload.limit,
      1,
      QUORUM_LIMITS.maximumPageSize,
      QUORUM_LIMITS.pageSize,
    );
  }
  if (payload.query !== undefined) {
    payload.query = forumPlainText(payload.query, {
      label: 'Search',
      minimum: operation === 'search' ? 2 : 0,
      maximum: QUORUM_LIMITS.searchCharacters,
      optional: operation !== 'search',
    }) || '';
  }
  if (payload.sort !== undefined) {
    payload.sort = quorumEnum(payload.sort, new Set(['latest', 'oldest']), 'Sort');
  }
  if (payload.subject) payload.subject = quorumEnum(payload.subject, QUORUM_SUBJECTS, 'Subject');
  if (payload.entryType) payload.entryType = quorumEnum(payload.entryType, QUORUM_ENTRY_TYPES, 'Entry type');
  if (payload.category) payload.category = quorumEnum(payload.category, QUORUM_CATEGORIES, 'Category');
  if (payload.entryId) payload.entryId = forumPublicId(payload.entryId, ['qe'], 'Entry');
  if (payload.legacyPostId) payload.legacyPostId = forumUuid(payload.legacyPostId, 'Legacy entry');
  if (payload.circleId) payload.circleId = forumPublicId(payload.circleId, ['qs'], 'Study Circle');
  if (payload.memberId) payload.memberId = forumPublicId(payload.memberId, ['qm'], 'Member');
  if (payload.authorMemberId) payload.authorMemberId = forumPublicId(payload.authorMemberId, ['qm'], 'Member');
  if (payload.cursorId) payload.cursorId = forumPublicId(payload.cursorId, ['qe', 'qr'], 'Cursor');
  if (payload.cursorAt) payload.cursorAt = quorumDate(payload.cursorAt, 'Cursor');
  for (const key of ['savedOnly', 'joinedOnly', 'unansweredOnly']) {
    if (payload[key] !== undefined) payload[key] = quorumBoolean(payload[key], key);
  }
  return { operation, payload };
}

function normalizeEntryPayload(payload, mode) {
  const normalized = {
    body: forumPlainText(payload.body, {
      label: 'Entry',
      maximum: QUORUM_LIMITS.entryCharacters,
      forbidEmail: true,
    }),
    entryType: quorumEnum(payload.entryType, QUORUM_ENTRY_TYPES, 'Entry type'),
    subject: quorumEnum(payload.subject, QUORUM_SUBJECTS, 'Subject', true),
    category: quorumEnum(payload.category, QUORUM_CATEGORIES, 'Category'),
    lawSchoolYear: forumPlainText(payload.lawSchoolYear, {
      label: 'Law-school year',
      maximum: 80,
      optional: true,
    }),
    caseTitle: forumPlainText(payload.caseTitle, {
      label: 'Case title',
      maximum: 300,
      optional: true,
    }),
    opinionOnly: payload.opinionOnly === undefined
      ? false
      : quorumBoolean(payload.opinionOnly, 'Opinion Only'),
    sourceUrl: forumSourceUrl(payload.sourceUrl),
    circleId: optionalPublicId(payload.circleId, ['qs'], 'Study Circle'),
  };
  if (mode === 'update') normalized.entryId = forumPublicId(payload.entryId, ['qe'], 'Entry');
  if (normalized.entryType === 'share_case_note' && !normalized.caseTitle) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'A case note requires a case title.');
  }
  if (['discuss_legal_issue', 'share_case_note'].includes(normalized.entryType)
      && !normalized.subject) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'Choose the relevant Bar subject.');
  }
  return normalized;
}

export function normalizeQuorumCommandRequest(input = {}) {
  const request = quorumObject(input);
  const operation = String(request.operation || '').trim().toLowerCase();
  if (!QUORUM_COMMAND_OPERATIONS.has(operation)) {
    throw new ForumValidationError('INVALID_QUORUM_REQUEST', 'Choose a valid Quorum action.');
  }
  const payload = safePayloadCopy(request.payload || {});
  let normalized;
  if (operation === 'create_entry') {
    normalized = normalizeEntryPayload(payload, 'create');
  } else if (operation === 'create_simple_entry') {
    normalized = {
      body: forumPlainText(payload.body, {
        label: 'Entry',
        maximum: QUORUM_LIMITS.entryCharacters,
      }),
      kind: quorumEnum(
        payload.kind || 'discussion',
        new Set(['discussion', 'question']),
        'Entry type',
      ),
      subject: quorumEnum(payload.subject, QUORUM_SUBJECTS, 'Subject', true),
      lawSchoolYear: forumPlainText(payload.lawSchoolYear, {
        label: 'Law-school year',
        maximum: 80,
        optional: true,
      }),
      sourceUrl: forumSourceUrl(payload.sourceUrl),
      imageAlt: forumPlainText(payload.imageAlt, {
        label: 'Image description',
        maximum: 500,
        optional: true,
      }),
    };
  } else if (operation === 'update_entry') {
    normalized = normalizeEntryPayload(payload, 'update');
  } else if (operation === 'update_simple_entry') {
    normalized = {
      entryId: forumPublicId(payload.entryId, ['qe'], 'Entry'),
      body: forumPlainText(payload.body, {
        label: 'Entry',
        maximum: QUORUM_LIMITS.entryCharacters,
      }),
      kind: quorumEnum(
        payload.kind || 'discussion',
        new Set(['discussion', 'question']),
        'Entry type',
      ),
    };
  } else if (operation === 'delete_entry') {
    normalized = { entryId: forumPublicId(payload.entryId, ['qe'], 'Entry') };
  } else if (operation === 'set_helpful' || operation === 'set_saved') {
    normalized = {
      entryId: forumPublicId(payload.entryId, ['qe'], 'Entry'),
      enabled: quorumBoolean(payload.enabled, 'Requested state'),
    };
  } else if (operation === 'set_affirm') {
    normalized = {
      entryId: forumPublicId(payload.entryId, ['qe'], 'Entry'),
      reaction: quorumEnum(
        payload.reaction,
        new Set(['hear', 'see', 'feel']),
        'Affirm reaction',
        true,
      ),
    };
  } else if (operation === 'create_comment') {
    normalized = {
      entryId: forumPublicId(payload.entryId, ['qe'], 'Entry'),
      parentCommentId: optionalPublicId(payload.parentCommentId, ['qc'], 'Parent comment'),
      body: forumPlainText(payload.body, {
        label: 'Comment',
        maximum: QUORUM_LIMITS.commentCharacters,
        forbidEmail: true,
      }),
    };
  } else if (operation === 'update_comment') {
    normalized = {
      commentId: forumPublicId(payload.commentId, ['qc'], 'Comment'),
      body: forumPlainText(payload.body, {
        label: 'Comment',
        maximum: QUORUM_LIMITS.commentCharacters,
        forbidEmail: true,
      }),
    };
  } else if (operation === 'delete_comment') {
    normalized = { commentId: forumPublicId(payload.commentId, ['qc'], 'Comment') };
  } else if (operation === 'create_repost') {
    normalized = {
      entryId: forumPublicId(payload.entryId, ['qe'], 'Entry'),
      body: forumPlainText(payload.body, {
        label: 'Citation commentary',
        maximum: QUORUM_LIMITS.repostCharacters,
        optional: true,
        forbidEmail: true,
      }),
    };
  } else if (operation === 'delete_repost') {
    normalized = { citationId: forumPublicId(payload.citationId, ['qr'], 'Citation') };
  } else if (operation === 'create_report') {
    const targetType = quorumEnum(
      payload.targetType,
      new Set(['entry', 'comment', 'circle']),
      'Report target',
    );
    normalized = {
      targetType,
      targetId: forumPublicId(
        payload.targetId,
        targetType === 'entry' ? ['qe'] : targetType === 'comment' ? ['qc'] : ['qs'],
        'Report target',
      ),
      category: quorumEnum(payload.category, QUORUM_REPORT_CATEGORIES, 'Report category'),
      explanation: forumPlainText(payload.explanation, {
        label: 'Report explanation',
        maximum: 1_000,
        optional: true,
      }),
    };
  } else if (operation === 'set_block') {
    normalized = {
      memberId: forumPublicId(payload.memberId, ['qm'], 'Member'),
      enabled: quorumBoolean(payload.enabled, 'Requested state'),
    };
  } else if (operation === 'create_circle') {
    normalized = {
      name: forumPlainText(payload.name, { label: 'Circle name', minimum: 3, maximum: 100 }),
      description: forumPlainText(payload.description, {
        label: 'Circle description',
        minimum: 10,
        maximum: QUORUM_LIMITS.circleDescriptionCharacters,
        forbidEmail: true,
      }),
      subject: quorumEnum(payload.subject, QUORUM_SUBJECTS, 'Subject', true),
      school: forumPlainText(payload.school, {
        label: 'School',
        maximum: 200,
        optional: true,
        forbidEmail: true,
      }),
      rules: forumPlainText(payload.rules, {
        label: 'Circle rules',
        minimum: 10,
        maximum: QUORUM_LIMITS.circleRulesCharacters,
        forbidEmail: true,
      }),
    };
  } else if (['join_circle', 'leave_circle', 'archive_circle'].includes(operation)) {
    normalized = { circleId: forumPublicId(payload.circleId, ['qs'], 'Study Circle') };
  } else if (operation === 'update_profile_settings') {
    normalized = {
      profilePublic: quorumBoolean(payload.profilePublic, 'Profile visibility'),
      showSchool: quorumBoolean(payload.showSchool, 'School visibility'),
      showYear: quorumBoolean(payload.showYear, 'Year visibility'),
    };
  } else if (operation === 'mark_notification') {
    normalized = {
      notificationId: forumPublicId(payload.notificationId, ['qn'], 'Notification'),
    };
  } else if (operation === 'mark_all_notifications') {
    normalized = {};
  } else if (operation === 'remove_attachment') {
    normalized = { entryId: forumPublicId(payload.entryId, ['qe'], 'Entry') };
  } else if (operation === 'telemetry') {
    normalized = {
      eventType: quorumEnum(
        payload.eventType,
        new Set(['quorum_opened', 'practice_clicked', 'api_failed']),
        'Telemetry event',
      ),
      subject: forumPlainText(payload.subject, {
        label: 'Subject',
        maximum: 120,
        optional: true,
      }),
      entryType: forumPlainText(payload.entryType, {
        label: 'Entry type',
        maximum: 80,
        optional: true,
      }),
      resultCategory: forumPlainText(payload.resultCategory, {
        label: 'Result category',
        maximum: 80,
        optional: true,
      }),
    };
  }
  return { operation, payload: normalized };
}

function bytesFromBase64(value) {
  const source = String(value || '').trim();
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 !== 0) {
    throw new ForumValidationError('INVALID_QUORUM_IMAGE', 'The selected image is invalid.');
  }
  let binary;
  try {
    binary = atob(source);
  } catch {
    throw new ForumValidationError('INVALID_QUORUM_IMAGE', 'The selected image is invalid.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > QUORUM_LIMITS.imageBytes) {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'Use one JPEG, PNG, or WebP image no larger than 3 MB.',
    );
  }
  return bytes;
}

function imageSignatureMatches(bytes, mimeType) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((value, index) => bytes[index] === value);
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

export function normalizeQuorumImage(image) {
  if (image === undefined || image === null) return null;
  const candidate = quorumObject(image, 'Image');
  const mimeType = String(candidate.mimeType || '').trim().toLowerCase();
  const extension = QUORUM_IMAGE_MIMES[mimeType];
  if (!extension) {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'Use one JPEG, PNG, or WebP image no larger than 3 MB.',
    );
  }
  const bytes = bytesFromBase64(candidate.dataBase64);
  if (!imageSignatureMatches(bytes, mimeType)) {
    throw new ForumValidationError(
      'INVALID_QUORUM_IMAGE',
      'The file contents do not match the selected image type.',
    );
  }
  return { bytes, mimeType, extension, byteSize: bytes.byteLength };
}

export function normalizeQuorumAdminRequest(input = {}, requestId = '') {
  const request = quorumObject(input);
  const operation = String(request.operation || '').trim().toLowerCase();
  if (!QUORUM_ADMIN_OPERATIONS.has(operation)) {
    throw new ForumValidationError('INVALID_QUORUM_ADMIN_REQUEST', 'Choose a valid Quorum admin view.');
  }
  const payload = safePayloadCopy(request.payload || {});
  if (operation === 'queue') {
    const status = String(payload.status || 'pending').trim().toLowerCase();
    if (!['pending', 'actioned', 'dismissed'].includes(status)) {
      throw new ForumValidationError('INVALID_QUORUM_ADMIN_REQUEST', 'The report status is invalid.');
    }
    return { operation, payload: { status } };
  }
  if (operation === 'analytics') {
    return {
      operation,
      payload: {
        from: quorumDate(payload.from, 'Start date'),
        to: quorumDate(payload.to, 'End date'),
      },
    };
  }
  const action = quorumEnum(payload.action, QUORUM_ADMIN_ACTIONS, 'Moderation action');
  const normalizedRequestId = String(requestId || payload.requestId || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalizedRequestId)) {
    throw new ForumValidationError(
      'INVALID_QUORUM_ADMIN_REQUEST',
      'A valid moderation request identifier is required.',
    );
  }
  const normalized = {
    action,
    reason: forumPlainText(payload.reason, {
      label: 'Moderation reason',
      minimum: 5,
      maximum: 1_000,
    }),
    requestId: normalizedRequestId,
  };
  if (['dismiss_report'].includes(action)) {
    normalized.reportId = forumPublicId(payload.reportId, ['qf'], 'Report');
  } else if (action === 'remove_restriction') {
    normalized.restrictionId = forumPublicId(payload.restrictionId, ['qx'], 'Restriction');
  } else if (['restrict_user', 'verify_profile', 'unverify_profile'].includes(action)) {
    normalized.memberId = forumPublicId(payload.memberId, ['qm'], 'Member');
  } else {
    const prefixes = action.includes('comment')
      ? ['qc']
      : action.includes('circle')
        ? ['qs']
        : ['qe'];
    normalized.targetId = forumPublicId(payload.targetId, prefixes, 'Moderation target');
  }
  if (action === 'restrict_user') {
    const durationHours = Number(payload.durationHours);
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 8_760) {
      throw new ForumValidationError(
        'INVALID_QUORUM_ADMIN_REQUEST',
        'Posting restrictions must last from 1 hour to 365 days.',
      );
    }
    normalized.durationHours = durationHours;
  }
  if (action === 'set_indicator') {
    normalized.indicator = quorumEnum(
      payload.indicator,
      new Set(['citation_checked', 'community_correction', 'moderator_reviewed']),
      'Credibility indicator',
    );
    normalized.enabled = quorumBoolean(payload.enabled, 'Indicator state');
  }
  return { operation, payload: normalized };
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
    [/FORUM_AUTHENTICATION_REQUIRED/i, 'AUTHENTICATION_REQUIRED', 'Sign in to use Quorum.', 401],
    [/Founder administrator authorization required/i, 'ADMIN_FORBIDDEN', 'Founder administrator authorization is required.', 403],
    [/FORUM_OWNERSHIP_REQUIRED/i, 'FORUM_FORBIDDEN', 'You may change only your own Quorum content.', 403],
    [/FORUM_CIRCLE_MEMBERSHIP_REQUIRED/i, 'FORUM_FORBIDDEN', 'Join this Study Circle before publishing there.', 403],
    [/FORUM_CIRCLE_OWNER_MUST_ARCHIVE/i, 'FORUM_CIRCLE_OWNER_MUST_ARCHIVE', 'Archive this Study Circle before leaving it as owner.', 409],
    [/FORUM_POSTING_RESTRICTED/i, 'FORUM_POSTING_RESTRICTED', 'Your Quorum publishing access is temporarily restricted.', 403],
    [/FORUM_POST_NOT_FOUND_OR_LOCKED/i, 'FORUM_COMMENTS_LOCKED', 'Comments are locked or this entry is unavailable.', 409],
    [/FORUM_ANNOUNCEMENT_NOT_PENDING/i, 'FORUM_REQUEST_CONFLICT', 'This announcement is no longer awaiting review.', 409],
    [/FORUM_PRIVATE_CONTACT/i, 'FORUM_PRIVATE_CONTACT', 'Remove private contact information before publishing.', 400],
    [/FORUM_RATE_LIMITED/i, 'FORUM_RATE_LIMITED', 'Too many Quorum actions. Please wait and try again.', 429],
    [/FORUM_ADMIN_REQUEST_KEY_CONFLICT/i, 'FORUM_REQUEST_CONFLICT', 'This moderation request conflicts with an earlier action.', 409],
    [/FORUM_DUPLICATE_REPORT/i, 'FORUM_DUPLICATE_REPORT', 'You have already reported this content.', 409],
    [/FORUM_DUPLICATE_(POST|COMMENT|REPOST)/i, 'FORUM_DUPLICATE_CONTENT', 'This content was just submitted.', 409],
    [/FORUM_(POST|COMMENT|REPOST|REPORT|RESTRICTION|TARGET|CIRCLE|MEMBER|NOTIFICATION|ATTACHMENT)_NOT_FOUND/i, 'FORUM_NOT_FOUND', 'The Quorum record is no longer available.', 404],
    [/FORUM_.*_(INVALID|REQUIRED|NOT_EDITABLE)/i, 'INVALID_FORUM_REQUEST', 'The Quorum request did not pass validation.', 400],
  ];
  const match = cases.find(([pattern]) => pattern.test(message));
  return match
    ? new ForumValidationError(match[1], match[2], match[3])
    : new ForumValidationError(
      'FORUM_UNAVAILABLE',
      'Quorum is temporarily unavailable. Please try again.',
      503,
    );
}
