export const ANALYTICS_EVENT_TYPES = Object.freeze([
  'session_start',
  'session_heartbeat',
  'session_end',
  'page_view',
  'registration_completed',
  'onboarding_completed',
  'subject_selected',
  'exam_started',
  'question_viewed',
  'question_started',
  'grading_started',
  'grading_success',
  'grading_failure',
  'grading_timeout',
  'grading_rate_limited',
  'guest_first_grade',
  'guest_third_grade',
  'guest_limit_reached',
  'sign_in_prompted',
  'sign_in_started',
  'sign_in_completed',
  'pricing_viewed',
  'support_submitted',
  'correction_submitted',
  'entitlement_changed',
]);

const FORBIDDEN_KEYS = new Set([
  'answer', 'answer_text', 'student_answer', 'submission_text', 'raw_answer',
  'prompt', 'model_answer', 'draft', 'email', 'password', 'token', 'api_key',
  'service_role_key', 'ip', 'ip_address', 'raw_ip', 'user_agent', 'raw_user_agent',
]);

export class AnalyticsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsValidationError';
  }
}

function boundedText(value, maximum) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maximum) throw new AnalyticsValidationError('Analytics field exceeds its limit.');
  return text;
}

function assertUuid(value, label) {
  const text = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new AnalyticsValidationError(`${label} is invalid.`);
  }
  return text.toLowerCase();
}

function hasForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_KEYS.has(key.toLowerCase()) || hasForbiddenKey(nested)
  ));
}

export function normalizeAnalyticsEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AnalyticsValidationError('Analytics payload must be an object.');
  }
  const eventType = boundedText(payload.eventType, 80);
  if (!ANALYTICS_EVENT_TYPES.includes(eventType)) {
    throw new AnalyticsValidationError('Unsupported analytics event type.');
  }
  const eventKey = boundedText(payload.eventKey, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(eventKey || '')) {
    throw new AnalyticsValidationError('Analytics event key is invalid.');
  }
  const deviceCategory = boundedText(payload.deviceCategory, 20) || 'unknown';
  if (!['desktop', 'tablet', 'mobile', 'unknown'].includes(deviceCategory)) {
    throw new AnalyticsValidationError('Device category is invalid.');
  }
  const durationMs = payload.durationMs == null ? null : Number(payload.durationMs);
  const latencyMs = payload.latencyMs == null ? null : Number(payload.latencyMs);
  const score = payload.score == null ? null : Number(payload.score);
  if (durationMs != null && (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 14_400_000)) {
    throw new AnalyticsValidationError('Duration is invalid.');
  }
  if (latencyMs != null && (!Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 14_400_000)) {
    throw new AnalyticsValidationError('Latency is invalid.');
  }
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 5 || Math.round(score * 10) !== score * 10)) {
    throw new AnalyticsValidationError('Score is invalid.');
  }
  const metadata = payload.metadata == null ? {} : payload.metadata;
  if (typeof metadata !== 'object' || Array.isArray(metadata) || hasForbiddenKey(metadata)) {
    throw new AnalyticsValidationError('Sensitive or invalid analytics metadata is forbidden.');
  }
  return {
    sessionId: assertUuid(payload.sessionId, 'Session identifier'),
    visitorId: assertUuid(payload.visitorId, 'Visitor identifier'),
    eventKey,
    eventType,
    subject: boundedText(payload.subject, 120),
    questionId: boundedText(payload.questionId, 120),
    pageArea: boundedText(payload.pageArea, 80),
    resultCategory: boundedText(payload.resultCategory, 80),
    durationMs,
    latencyMs,
    modelName: boundedText(payload.modelName, 120),
    workerVersion: boundedText(payload.workerVersion, 120),
    score,
    deviceCategory,
    referralHost: boundedText(payload.referralHost, 253)?.toLowerCase() || null,
    utmSource: boundedText(payload.utmSource, 120),
    utmMedium: boundedText(payload.utmMedium, 120),
    utmCampaign: boundedText(payload.utmCampaign, 160),
    landingArea: boundedText(payload.landingArea, 80),
    metadata,
  };
}

export function analyticsRpcPayload(event, userId = null) {
  return {
    p_session_id: event.sessionId,
    p_visitor_id: event.visitorId,
    p_user_id: userId,
    p_event_key: event.eventKey,
    p_event_type: event.eventType,
    p_subject: event.subject,
    p_question_id: event.questionId,
    p_page_area: event.pageArea,
    p_result_category: event.resultCategory,
    p_duration_ms: event.durationMs,
    p_latency_ms: event.latencyMs,
    p_model_name: event.modelName,
    p_worker_version: event.workerVersion,
    p_score: event.score,
    p_device_category: event.deviceCategory,
    p_referral_host: event.referralHost,
    p_utm_source: event.utmSource,
    p_utm_medium: event.utmMedium,
    p_utm_campaign: event.utmCampaign,
    p_landing_area: event.landingArea,
    p_metadata: event.metadata,
  };
}
