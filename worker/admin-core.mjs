export const ADMIN_SECTIONS = Object.freeze([
  'users', 'learning', 'support', 'corrections', 'subscriptions',
  'recovery', 'advertiser', 'controls', 'security',
]);

export const ADMIN_ACTIONS = Object.freeze([
  'support_update', 'correction_review', 'entitlement_change',
  'capability_change', 'role_change', 'discount_upsert',
  'website_control_update', 'recovery_case_update', 'aggregate_export',
]);

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
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
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
