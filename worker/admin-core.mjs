export const ADMIN_SECTIONS = Object.freeze([
  'users', 'learning', 'support', 'corrections', 'subscriptions',
  'recovery', 'advertiser', 'controls', 'security',
]);

export const ADMIN_ACTIONS = Object.freeze([
  'support_update', 'correction_review', 'entitlement_change',
  'capability_change', 'role_change', 'discount_upsert',
  'website_control_update', 'recovery_case_update', 'aggregate_export',
]);

export const ADMIN_DIRECTORY_RECIPIENT_KEYS = Object.freeze([
  'wally', 'gilmar', 'ice', 'emrico',
]);

export const ADMIN_DIRECTORY_EXPORT_MAX_BYTES = 5 * 1024 * 1024;

export class AdminValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminValidationError';
  }
}

function isoDate(value, label) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) throw new AdminValidationError(`${label} is invalid.`);
  return date.toISOString();
}

export function normalizeDashboardRequest(payload) {
  const to = isoDate(payload?.to, 'Reporting end');
  const from = isoDate(payload?.from, 'Reporting start');
  const previousTo = isoDate(payload?.previousTo, 'Comparison end');
  const previousFrom = isoDate(payload?.previousFrom, 'Comparison start');
  if (new Date(from) >= new Date(to) || new Date(previousFrom) >= new Date(previousTo)) {
    throw new AdminValidationError('Reporting windows are invalid.');
  }
  if (new Date(to) - new Date(from) > 366 * 86_400_000) {
    throw new AdminValidationError('Reporting window exceeds 366 days.');
  }
  return { from, to, previousFrom, previousTo };
}

export function normalizeUserResponseExport(payload) {
  const targetUserId = String(payload?.targetUserId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    throw new AdminValidationError('Target user identifier is invalid.');
  }
  const reason = String(payload?.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new AdminValidationError('A reason of 5–1000 characters is required.');
  }
  const requestKey = String(payload?.requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new AdminValidationError('Request key is invalid.');
  }
  const from = isoDate(payload?.from, 'Export start');
  const to = isoDate(payload?.to, 'Export end');
  const span = new Date(to) - new Date(from);
  if (span <= 0 || span > 366 * 86_400_000) {
    throw new AdminValidationError('Export window must be between 1 minute and 366 days.');
  }
  return { targetUserId, reason, requestKey, from, to, limit: 2000 };
}

export function normalizeUserDirectoryRequest(payload, accessPurpose = 'dashboard') {
  if (!['dashboard', 'csv_export'].includes(accessPurpose)) {
    throw new AdminValidationError('Directory access purpose is invalid.');
  }
  const search = String(payload?.search || '').trim();
  if (search.length > 180) {
    throw new AdminValidationError('Directory search exceeds 180 characters.');
  }
  const requestKey = String(payload?.requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new AdminValidationError('Request key is invalid.');
  }
  if (accessPurpose === 'csv_export') {
    return { search: search || null, limit: 5000, offset: 0, requestKey, accessPurpose };
  }
  const limit = Math.min(100, Math.max(1, Number(payload?.limit) || 100));
  const offset = Math.max(0, Number(payload?.offset) || 0);
  return { search: search || null, limit, offset, requestKey, accessPurpose };
}

export function normalizeUserDirectoryEmailExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminValidationError('Directory email export payload is invalid.');
  }
  const allowedFields = new Set([
    'recipientKey', 'search', 'reason', 'requestKey', 'confirmed',
  ]);
  if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
    throw new AdminValidationError('Directory email export contains an unsupported field.');
  }
  const recipientKey = String(payload.recipientKey || '').trim();
  if (!ADMIN_DIRECTORY_RECIPIENT_KEYS.includes(recipientKey)) {
    throw new AdminValidationError('Choose an approved founder recipient.');
  }
  const reason = String(payload.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new AdminValidationError('A reason of 5–1000 characters is required.');
  }
  if (payload.confirmed !== true) {
    throw new AdminValidationError('Confirm the private directory delivery.');
  }
  const directory = normalizeUserDirectoryRequest(payload, 'csv_export');
  return { ...directory, recipientKey, reason, confirmed: true };
}

export function normalizeGlobalBetaChange(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminValidationError('Beta All Access change payload is invalid.');
  }
  const allowedFields = new Set(['enabled', 'reason', 'requestKey', 'confirmed']);
  if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
    throw new AdminValidationError('Beta All Access change contains an unsupported field.');
  }
  if (typeof payload.enabled !== 'boolean') {
    throw new AdminValidationError('Choose whether Beta All Access is enabled.');
  }
  if (payload.confirmed !== true) {
    throw new AdminValidationError('Confirm the Beta All Access policy change.');
  }
  const reason = String(payload.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new AdminValidationError('A reason of 5–1000 characters is required.');
  }
  const requestKey = String(payload.requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new AdminValidationError('Request key is invalid.');
  }
  return { enabled: payload.enabled, reason, requestKey, confirmed: true };
}

export function normalizeAnswerHistoryRequest(payload, accessPurpose = 'summary') {
  if (!['summary', 'csv_export'].includes(accessPurpose)) {
    throw new AdminValidationError('Answer-history access purpose is invalid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminValidationError('Answer-history request is invalid.');
  }
  const allowedFields = new Set([
    'targetUserId', 'from', 'to', 'limit', 'reason', 'requestKey', 'confirmed',
  ]);
  if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
    throw new AdminValidationError('Answer-history request contains an unsupported field.');
  }
  if (payload.confirmed !== true) {
    throw new AdminValidationError('Confirm the private answer-history export.');
  }
  const targetUserId = String(payload.targetUserId || '').trim() || null;
  if (targetUserId
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    throw new AdminValidationError('Target user identifier is invalid.');
  }
  const reason = String(payload.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new AdminValidationError('A reason of 5–1000 characters is required.');
  }
  const requestKey = String(payload.requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new AdminValidationError('Request key is invalid.');
  }
  const fromOmitted = payload.from == null;
  const toOmitted = payload.to == null;
  if (fromOmitted !== toOmitted) {
    throw new AdminValidationError('Provide both answer-history dates or leave both empty for all time.');
  }
  let from = null;
  let to = null;
  if (!fromOmitted) {
    from = isoDate(payload.from, 'Export start');
    to = isoDate(payload.to, 'Export end');
    const span = new Date(to) - new Date(from);
    if (span <= 0 || span > 366 * 86_400_000) {
      throw new AdminValidationError('Answer-history window must be between 1 minute and 366 days.');
    }
  }
  const limit = accessPurpose === 'csv_export'
    ? 5000
    : Math.min(100, Math.max(1, Number(payload.limit) || 100));
  return {
    targetUserId,
    from,
    to,
    limit,
    reason,
    requestKey,
    confirmed: true,
    accessPurpose,
  };
}

export function resolveAdminDirectoryRecipient(rawJson, recipientKey) {
  let configured;
  try {
    configured = JSON.parse(String(rawJson || ''));
  } catch {
    return null;
  }
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return null;
  const recipient = String(configured[recipientKey] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  return recipient;
}

export function utf8Base64(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function normalizeOperationalRequest(payload) {
  const section = String(payload?.section || '').trim();
  if (!ADMIN_SECTIONS.includes(section)) throw new AdminValidationError('Unsupported admin section.');
  const search = String(payload?.search || '').trim().slice(0, 180) || null;
  const limit = Math.min(100, Math.max(1, Number(payload?.limit) || 50));
  const offset = Math.max(0, Number(payload?.offset) || 0);
  return { section, search, limit, offset };
}

export function normalizeAdminAction(payload) {
  const action = String(payload?.action || '').trim();
  if (!ADMIN_ACTIONS.includes(action)) throw new AdminValidationError('Unsupported administrator action.');
  const targetId = payload?.targetId == null || payload.targetId === '' ? null : String(payload.targetId);
  if (targetId && !/^[0-9a-f-]{36}$/i.test(targetId)) throw new AdminValidationError('Target identifier is invalid.');
  const reason = String(payload?.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw new AdminValidationError('A reason of 5–1000 characters is required.');
  const requestKey = String(payload?.requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) throw new AdminValidationError('Request key is invalid.');
  const actionPayload = payload?.payload;
  if (!actionPayload || typeof actionPayload !== 'object' || Array.isArray(actionPayload)) {
    throw new AdminValidationError('Action payload must be an object.');
  }
  const encoded = JSON.stringify(actionPayload);
  if (encoded.length > 16_000) throw new AdminValidationError('Action payload is too large.');
  return { action, targetId, reason, requestKey, payload: actionPayload };
}

export function safeCsvCell(value) {
  if (value == null) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function withUtf8Bom(csv) {
  return `\uFEFF${String(csv || '')}`;
}

export function aggregateCsv(snapshot) {
  const rows = [
    ['Metric', 'Current', 'Previous', 'Status'],
    ['Collection start', snapshot?.meta?.data_collection_start, '', snapshot?.meta?.freshness],
    ['Current viewers', snapshot?.realtime?.current_viewers, '', 'Five-minute validated session window'],
    ['Page views', snapshot?.current?.traffic?.page_views, snapshot?.previous?.traffic?.page_views, 'Verified analytics'],
    ['Unique visitors', snapshot?.current?.traffic?.unique_visitors, snapshot?.previous?.traffic?.unique_visitors, 'Privacy-safe identities'],
    ['Sessions', snapshot?.current?.traffic?.sessions, snapshot?.previous?.traffic?.sessions, 'Verified analytics'],
    ['Registrations', snapshot?.current?.funnel?.registrations, snapshot?.previous?.funnel?.registrations, 'Verified analytics'],
    ['Successful grades', snapshot?.current?.learning?.successful_grades, snapshot?.previous?.learning?.successful_grades, '0–5 grading events'],
    ['Grading success rate', snapshot?.current?.reliability?.success_rate, snapshot?.previous?.reliability?.success_rate, 'Service telemetry'],
    ['Paid subscribers', '', '', 'Not connected'],
    ['Revenue', '', '', 'No verified data'],
    ['Advertising CTR', '', '', 'Not configured'],
  ];
  return rows.map((row) => row.map(safeCsvCell).join(',')).join('\r\n');
}

export function userDirectoryCsv(items) {
  const headers = [
    'User ID', 'Display name', 'Email', 'School', 'Enrollment status',
    'Year level', 'Role', 'Retainer plan', 'Retainer status', 'Joined at',
    'Profile completed at', 'Last signed in', 'Last active', 'Sessions',
    'Questions answered', 'Practice questions answered',
    'Examination questions answered', 'Last answered at', 'Successful grades',
    'Marketing consent',
  ];
  const rows = (Array.isArray(items) ? items : []).map((item) => [
    item.id,
    item.display_name,
    item.email,
    item.school,
    item.enrollment_status,
    item.year_level,
    item.role,
    item.plan_code,
    item.entitlement_status,
    item.created_at,
    item.profile_completed_at,
    item.last_sign_in_at,
    item.last_active_at,
    item.session_count,
    item.answered_question_count,
    item.practice_answered_count,
    item.examination_answered_count,
    item.last_answered_at,
    item.successful_grade_count,
    item.marketing_consent,
  ]);
  return [headers, ...rows].map((row) => row.map(safeCsvCell).join(',')).join('\r\n');
}

export function userResponsesCsv(items, user = {}) {
  const headers = [
    'User email', 'Display name', 'Record source', 'User ID', 'Attempt ID', 'Exam title', 'Subject',
    'Question ID', 'Question text', 'Question provenance', 'Student answer',
    'Status', 'Score', 'Timer mode', 'Elapsed seconds', 'Submitted at', 'Completed at',
  ];
  const rows = (Array.isArray(items) ? items : []).map((item) => [
    user.email,
    user.displayName,
    item.recordSource,
    item.userId,
    item.attemptId,
    item.examTitle,
    item.subject,
    item.questionId,
    item.questionText,
    item.questionProvenance,
    item.studentAnswer,
    item.status,
    item.score,
    item.timerMode,
    item.elapsedSeconds,
    item.submittedAt,
    item.completedAt,
  ]);
  return [headers, ...rows].map((row) => row.map(safeCsvCell).join(',')).join('\r\n');
}

export function answerHistoryCsv(items) {
  const columns = [
    ['Record source', 'recordSource'],
    ['User ID', 'userId'],
    ['User email', 'userEmail'],
    ['Email status', 'emailStatus'],
    ['Attempt ID', 'attemptId'],
    ['Question ID', 'questionId'],
    ['Question text', 'questionText'],
    ['Question text source', 'questionTextSource'],
    ['Question text status', 'questionTextStatus'],
    ['Submitted answer', 'submittedAnswer'],
    ['Answer status', 'answerStatus'],
    ['Score', 'score'],
    ['Grade source', 'gradeSource'],
    ['AI score', 'aiScore'],
    ['Human score', 'humanScore'],
    ['Feedback', 'feedbackText'],
    ['AI feedback', 'aiFeedback'],
    ['Human feedback', 'humanFeedback'],
    ['Feedback status', 'feedbackStatus'],
    ['Suggested answer', 'suggestedAnswer'],
    ['Suggested answer source', 'suggestedAnswerSource'],
    ['Suggested answer status', 'suggestedAnswerStatus'],
    ['Model answer', 'modelAnswer'],
    ['Model answer source', 'modelAnswerSource'],
    ['Model answer status', 'modelAnswerStatus'],
    ['Subject', 'subject'],
    ['Exam title', 'examTitle'],
    ['Exam track', 'examTrack'],
    ['Assessment kind', 'assessmentKind'],
    ['Exam version label', 'examVersionLabel'],
    ['Exam version number', 'examVersionNumber'],
    ['Question ordinal', 'questionOrdinal'],
    ['Topic', 'topic'],
    ['Bar year', 'barYear'],
    ['Question number', 'questionNumber'],
    ['Difficulty', 'difficulty'],
    ['Attempt status', 'attemptStatus'],
    ['Timer mode', 'timerMode'],
    ['Elapsed seconds', 'elapsedSeconds'],
    ['Flagged', 'flagged'],
    ['Revision', 'revision'],
    ['Human review status', 'humanReviewStatus'],
    ['Provider or grader model', 'providerOrGraderModel'],
    ['Safe error code', 'safeErrorCode'],
    ['Started at', 'startedAt'],
    ['Answer saved at', 'answerSavedAt'],
    ['Submitted at', 'submittedAt'],
    ['Graded at', 'gradedAt'],
    ['Completed at', 'completedAt'],
  ];
  const rows = (Array.isArray(items) ? items : []).map((item) => (
    columns.map(([, key]) => item?.[key])
  ));
  return [columns.map(([label]) => label), ...rows]
    .map((row) => row.map(safeCsvCell).join(','))
    .join('\r\n');
}
