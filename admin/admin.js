(function dueDiligenceAdmin(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const subscriptionActions = global.DueDiligenceSubscriptionActions;
  const titles = Object.freeze({
    executive: 'Executive Pulse',
    realtime: 'Live Activity',
    acquisition: 'Sign-ups',
    marketing: 'Acquisition',
    recent_users: 'Recent Users',
    users: 'Users',
    learning: 'Subject Performance',
    subjects: 'Question Bank',
    reliability: 'Grading Health',
    subscriptions: 'Subscriptions',
    paid_subscribers: 'Paid Subscribers',
    payments: 'Payments',
    refunds: 'Refunds',
    support: 'Support',
    corrections: 'Corrections',
    partnerships: 'Partnerships',
    controls: 'Controls',
    security: 'Audit Log',
    forum: 'Community Moderation',
    examinations: 'Exams',
    examination_room_v1: 'Examination Room',
    answer_exports: 'Answers',
    business_revenue: 'Revenue',
    business_projections: 'Projections',
    business_comparisons: 'Comparisons',
  });
  const sectionSubtitles = Object.freeze({
    executive: 'Executive command center for the Judicial Observatory.',
    realtime: 'Current signed-in activity and service demand.',
    recent_users: 'Signed-in sessions, time used, and recorded activity.',
    users: 'Complete account directory, access, and learning engagement.',
    acquisition: 'Registration funnel and account activation.',
    marketing: 'Recorded channels and sign-in acquisition.',
    learning: 'Subject-level performance from completed assessments.',
    reliability: 'Grading availability and response health.',
    subscriptions: 'Commercial access and introductory allowances.',
    paid_subscribers: 'Paid access, verification state, and entitlement expiry.',
    payments: 'Private payment-proof review and verification history.',
    refunds: 'Refund requests and recorded decisions.',
    support: 'Support cases requiring administrator attention.',
    corrections: 'Editorial correction submissions and review status.',
    forum: 'Community reports and moderation controls.',
    business_revenue: 'Verified commercial records and approved value.',
    business_projections: 'Transparent planning assumptions and forecasts.',
    business_comparisons: 'Current and previous operating-period comparison.',
    security: 'Administrator actions and sensitive-access history.',
    controls: 'Protected platform controls and feature state.',
    examination_room_v1: 'Professor publication review, room-key activation, lifecycle operations, and recovery.',
  });
  const requirements = Object.freeze({
    realtime: 'learner_analytics_viewer',
    recent_users: 'learner_analytics_viewer',
    users: 'learner_analytics_viewer',
    learning: 'learner_analytics_viewer',
    marketing: 'learner_analytics_viewer',
    subscriptions: 'subscription_admin',
    paid_subscribers: 'subscription_admin',
    payments: 'subscription_admin',
    refunds: 'subscription_admin',
    support: 'support_admin',
    corrections: 'correction_admin',
    partnerships: 'advertiser_report_viewer',
    controls: 'role_admin',
    security: 'role_admin',
    answer_exports: 'learner_analytics_viewer',
    business_revenue: 'subscription_admin',
    business_projections: 'subscription_admin',
    business_comparisons: 'learner_analytics_viewer',
    examination_room_v1: 'role_admin',
  });
  const state = {
    client: null,
    session: null,
    authorization: null,
    report: null,
    section: 'executive',
    operational: new Map(),
    action: null,
    actionInFlight: false,
    subscriptionRows: new Map(),
    premiumStatus: 'all',
    examinationData: null,
    userSearch: '',
    userOffset: 0,
    userTotal: 0,
    userDirectoryLoading: false,
    userDirectoryObserver: null,
    recentUserSearch: '',
    recentUserOffset: 0,
    recentUserTotal: 0,
    recentUserActivity: null,
    recentUserLoading: false,
    recentUserObserver: null,
    subscriptionSearch: '',
    subscriptionOffset: 0,
    paidSubscriberSearch: '',
    liveActivity: null,
    answerHistory: null,
    answerSearch: '',
    answerFeature: 'all',
    answerOffset: 0,
    quorumPosts: null,
    quorumPostSearch: '',
    quorumPostStatus: 'all',
    quorumPostOffset: 0,
    subscriptionExportRows: [],
    paidSubscriberRows: [],
    businessRevenueVisuals: null,
    businessComparisonVisuals: null,
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const EARLY_ACCESS_PLAN = Object.freeze({
    id: 'early_access_beta',
    name: 'Early Access',
    pricePhp: 149,
    expiresAt: '2026-10-01T23:59:59+08:00',
    salesCloseAt: '2026-10-01T00:00:00+08:00',
  });

  function commercialPlanLabel(planCode) {
    const code = String(planCode || '').trim().toLowerCase();
    if (code === 'early_access_beta') return 'Early Access';
    if (code === 'free') return 'Introductory access';
    if (['standard', 'premium'].includes(code)) return 'Legacy paid plan';
    return code ? humanizeAuditValue(code) : 'Introductory access';
  }

  function answerFeatureLabel(item = {}) {
    const supplied = String(item.feature || '').trim();
    if (supplied) return supplied;
    if (item.recordSource === 'practice') return 'Bar Question Practice';
    if (item.examTrack === 'per_subject') return 'Syllabus-Based Review';
    if (item.examTrack === 'bar_feels') return 'Bar Exam Simulation';
    return 'Feature not recorded';
  }

  function commercialAccountLabel(account = {}) {
    const now = Date.now();
    const expiry = new Date(account.subscription_expires_at || 0).getTime();
    const plan = String(account.subscription_plan || '').toLowerCase();
    const status = String(account.subscription_status || '').toLowerCase();
    const effective = String(account.effective_access || '').toLowerCase();
    const role = String(account.role || '').toLowerCase();
    if (['admin', 'founder_admin', 'super_admin'].includes(role)) return 'Administrator';
    if (account.free_beta_enabled
        && (!account.free_beta_expires_at || new Date(account.free_beta_expires_at).getTime() > now)) {
      return 'Founding Beta';
    }
    if (plan === 'early_access_beta') {
      if (['expired', 'cancelled', 'canceled'].includes(status) || (expiry && expiry <= now)) return 'Expired';
      if (status === 'active') return 'Early Access — verified';
      if (status === 'rejected') return 'Early Access — rejected';
      return 'Early Access — pending';
    }
    if (effective.includes('pending')) return 'Early Access — pending';
    if (effective.includes('rejected')) return 'Early Access — rejected';
    if (effective.includes('expired')) return 'Expired';
    return 'Introductory access';
  }

  function commercialPaymentLabel(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'approved') return 'Early Access — verified';
    if (normalized === 'rejected') return 'Early Access — rejected';
    if (normalized === 'expired') return 'Expired';
    return 'Early Access — pending';
  }

  function paymentNotificationLabel(row = {}) {
    const status = String(row.verification_email_status || '').toLowerCase();
    const attempts = Number(row.verification_email_attempts || 0);
    if (status === 'sent') return { className: 'ok', text: 'Sent to 5 verifiers' };
    if (status === 'sending') return { className: 'warn', text: `Sending${attempts ? ` · attempt ${attempts}` : ''}` };
    if (status === 'failed') return { className: 'danger', text: `Retry queued${attempts ? ` · attempt ${attempts}` : ''}` };
    if (status === 'suppressed') return { className: 'muted', text: 'Historical · not queued' };
    return { className: 'warn', text: 'Queued' };
  }

  function maskOperationalIdentifier(value, prefix = '') {
    const text = String(value || '').trim();
    if (!text) return prefix || 'Not available';
    if (!UUID_PATTERN.test(text)) return text;
    return `${prefix ? `${prefix} · ` : ''}${text.slice(0, 8)}…${text.slice(-4)}`;
  }

  function administratorIdentity(userId, directoryById = new Map()) {
    if (!userId) return 'System';
    const account = directoryById.get(String(userId));
    if (!account) return maskOperationalIdentifier(userId, 'Administrator');
    const name = String(account.display_name || '').trim() || 'Administrator';
    const email = String(account.email || '').trim();
    return email ? `${name} · ${email}` : name;
  }

  function humanizeAuditValue(value) {
    const text = String(value || '').trim().replace(/^phase4_/, '').replace(/_/g, ' ');
    if (!text) return 'Not available';
    return text.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function auditTargetLabel(row) {
    const target = String(row?.target_resource_id || '').trim();
    if (!target) return 'Not available';
    if (row?.target_resource_type === 'phase4_admin_section' && titles[target]) return titles[target];
    return maskOperationalIdentifier(target);
  }

  function toast(message) {
    const node = $('#admin-toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.classList.remove('show'), 3500);
  }

  function has(capability) {
    return state.authorization?.role === 'super_admin'
      || state.authorization?.capabilities?.includes(capability);
  }

  function sectionAllowed(section) {
    if (!titles[section]) return false;
    const founderOnly = ['forum', 'examinations', 'answer_exports'].includes(section);
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(
      state.authorization?.role,
    );
    if (founderOnly && !founderAuthorized) return false;
    if (['subscriptions', 'paid_subscribers'].includes(section)
        && (!has('subscription_admin') || !has('learner_analytics_viewer'))) {
      return false;
    }
    const needed = requirements[section];
    return !needed || has(needed);
  }

  function uuidKey() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function number(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return 'Not available';
    return Number(value).toLocaleString('en-PH', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function percentage(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return 'Not available';
    return `${(Number(value) * 100).toFixed(digits)}%`;
  }

  function dateTime(value) {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function trend(current, previous) {
    const now = Number(current);
    const before = Number(previous);
    if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) {
      return '<em>Comparison unavailable</em>';
    }
    const change = ((now - before) / before) * 100;
    const className = change >= 0 ? 'up' : 'down';
    const prefix = change >= 0 ? '+' : '';
    return `<em class="${className}">${prefix}${change.toFixed(1)}% vs prior period</em>`;
  }

  function insightData(label, value, options = {}) {
    return escapeHtml(JSON.stringify({
      label,
      value,
      copy: options.copy || 'Verified total for the selected reporting period.',
      source: options.source || 'Due Diligence website records',
    }));
  }

  function metric(label, value, comparison = null, formatter = number, options = {}) {
    const displayValue = formatter(value);
    const destination = options.section && sectionAllowed(options.section)
      ? `data-admin-section="${escapeHtml(options.section)}"`
      : `data-insight="${insightData(label, displayValue, options)}"`;
    const status = comparison == null
      ? `<em>${escapeHtml(options.subtext || '')}</em>`
      : trend(value, comparison);
    return `<button type="button" class="metric" ${destination}
      aria-label="${escapeHtml(options.section && sectionAllowed(options.section) ? 'Open' : 'Explain')} ${escapeHtml(label)}: ${escapeHtml(displayValue)}">
      <small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(displayValue)}</strong>${status}
      <span class="metric-cue">${escapeHtml(options.cue || (options.section && sectionAllowed(options.section) ? 'Open details' : 'How this is counted'))}</span></button>`;
  }

  function summaryMetric(label, value, subtext = '') {
    return `<div class="metric static-metric">
      <small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(value == null ? 'Not available' : value)}</strong>
      ${subtext ? `<em>${escapeHtml(subtext)}</em>` : ''}
    </div>`;
  }

  function heading(title, copy, actions = '') {
    return `<header class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>${actions}</header>`;
  }

  function empty(copy) {
    return `<div class="empty">${escapeHtml(copy)}</div>`;
  }

  function queueLink(label, copy, section) {
    return `<button type="button" class="queue-link" data-admin-section="${escapeHtml(section)}">
      <strong>${escapeHtml(label)}</strong><span>${escapeHtml(copy)}</span><span aria-hidden="true">View queue</span>
    </button>`;
  }

  function reportingWindow() {
    const days = Number($('#date-range').value || 30);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const previousTo = new Date(from);
    const previousFrom = new Date(previousTo.getTime() - days * 86_400_000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
    };
  }

  async function api(path, body = {}) {
    const token = state.session?.access_token;
    if (!token) throw new Error('Administrator sign-in is required.');
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': uuidKey(),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'Administrator request failed.');
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function loadReport(force = false) {
    if (state.report && !force) return state.report;
    $('#dashboard-view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    const payload = await api('/admin/dashboard', reportingWindow());
    state.report = payload.report;
    const meta = state.report.meta || {};
    $('#freshness b').textContent = meta.data_collection_start
      ? `Updated ${dateTime(meta.generated_at)}`
      : 'No verified analytics events yet';
    $('#system-banner').textContent = meta.data_collection_start
      ? `Data available since ${dateTime(meta.data_collection_start)}. Times shown in Asia/Manila.`
      : 'Analytics collection has no verified events yet. Historical figures are not fabricated.';
    return state.report;
  }

  async function loadOperational(section, force = false, search = null) {
    const key = `${section}:${search || ''}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/data', { section, search, limit: 100, offset: 0 });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadUserDirectory(
    force = false,
    search = state.userSearch,
    offset = state.userOffset,
  ) {
    const normalizedSearch = String(search || '').trim();
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const key = `directory:${normalizedSearch}:${normalizedOffset}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/user-directory', {
      search: normalizedSearch,
      limit: 100,
      offset: normalizedOffset,
      requestKey: uuidKey(),
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadRecentSignIns(force = false) {
    const key = 'recent-sign-ins';
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/recent-sign-ins', {
      limit: 7,
      requestKey: uuidKey(),
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadRecentUserActivity(
    force = false,
    search = state.recentUserSearch,
    offset = state.recentUserOffset,
  ) {
    const window = reportingWindow();
    const normalizedSearch = String(search || '').trim();
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const key = `recent-user-activity:${window.from}:${window.to}:${normalizedSearch}:${normalizedOffset}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/recent-user-activity', {
      search: normalizedSearch,
      from: window.from,
      to: window.to,
      limit: 100,
      offset: normalizedOffset,
      requestKey: uuidKey(),
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadPhase4Operational(section, force = false, search = null, offset = 0) {
    const premiumStatus = section === 'access' ? state.premiumStatus : 'all';
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const key = `phase4:${section}:${search || ''}:${premiumStatus}:${normalizedOffset}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/phase4-data', {
      section,
      search: search || '',
      limit: 100,
      offset: normalizedOffset,
      premiumStatus,
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadAllUserDirectory(force = false, search = '') {
    const normalizedSearch = String(search || '').trim();
    const key = `directory:all:${normalizedSearch}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await loadUserDirectory(force, normalizedSearch, offset);
      const pageItems = Array.isArray(page.items) ? page.items : [];
      if (offset === 0) total = Number(page.total || 0);
      items.push(...pageItems);
      offset += pageItems.length;
      if (!pageItems.length || items.length >= 5_000) break;
    } while (offset < total);
    const result = { items, total, truncated: offset < total };
    state.operational.set(key, result);
    return result;
  }

  async function loadAllPhase4Operational(section, force = false, search = '') {
    const normalizedSearch = String(search || '').trim();
    const key = `phase4:all:${section}:${normalizedSearch}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await loadPhase4Operational(section, force, normalizedSearch, offset);
      const pageItems = Array.isArray(page.items) ? page.items : [];
      if (offset === 0) total = Number(page.total || 0);
      items.push(...pageItems);
      offset += pageItems.length;
      if (!pageItems.length || items.length >= 5_000) break;
    } while (offset < total);
    const result = { items, total, truncated: offset < total };
    state.operational.set(key, result);
    return result;
  }

  async function loadRecentUserActivityWindow(from, to, force = false) {
    const key = `recent-user-activity:all:${from}:${to}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    // Aggregate totals, duration, daily activity, and activity mix already
    // cover the complete period. A bounded page is sufficient for the clearly
    // labelled device/hour sample and prevents a long serial request loop.
    const payload = await api('/admin/recent-user-activity', {
      search: '',
      from,
      to,
      limit: 100,
      offset: 0,
      requestKey: uuidKey(),
    });
    const page = payload.data || {};
    const items = Array.isArray(page.items) ? page.items : [];
    const total = Number(page.total || 0);
    const result = {
      ...page,
      items,
      total,
      truncated: items.length < total,
    };
    state.operational.set(key, result);
    return result;
  }

  async function loadForumModeration(force = false) {
    const window = reportingWindow();
    const key = `quorum:${window.from}:${window.to}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const [queue, analytics] = await Promise.all([
      api('/admin/quorum', {
        operation: 'queue',
        payload: { status: 'pending' },
      }),
      api('/admin/quorum', {
        operation: 'analytics',
        payload: { from: window.from, to: window.to },
      }),
    ]);
    const data = { queue: queue.data, analytics: analytics.data };
    state.operational.set(key, data);
    return data;
  }

  async function loadLiveActivity(force = false) {
    if (state.liveActivity && !force) return state.liveActivity;
    const payload = await api('/admin/live-activity', {
      limit: 100,
      requestKey: uuidKey(),
    });
    state.liveActivity = payload.data;
    return state.liveActivity;
  }

  async function loadAnswerHistory(force = false) {
    const key = `answers:${state.answerFeature}:${state.answerSearch}:${state.answerOffset}`;
    if (!force && state.operational.has(key)) {
      state.answerHistory = state.operational.get(key);
      return state.answerHistory;
    }
    const payload = await api('/admin/answer-history', {
      targetUserId: null,
      from: null,
      to: null,
      search: state.answerSearch || null,
      feature: state.answerFeature,
      limit: 100,
      offset: state.answerOffset,
    });
    state.answerHistory = payload.data;
    state.operational.set(key, state.answerHistory);
    return state.answerHistory;
  }

  function currentAnswerHistoryItems() {
    return Array.isArray(state.answerHistory?.items) ? state.answerHistory.items : [];
  }

  async function loadQuorumPosts(force = false) {
    if (state.quorumPosts && !force) return state.quorumPosts;
    const payload = await api('/admin/quorum/posts', {
      search: state.quorumPostSearch,
      status: state.quorumPostStatus,
      limit: 100,
      offset: state.quorumPostOffset,
      requestKey: uuidKey(),
    });
    state.quorumPosts = payload.data;
    return state.quorumPosts;
  }

  function compactText(value, emptyCopy = 'Not available') {
    const text = String(value || '').trim();
    return text || emptyCopy;
  }

  function detailCell(value, label = 'View') {
    const text = compactText(value);
    return {
      html: true,
      value: `<details class="record-detail"><summary>${escapeHtml(label)}</summary><div>${escapeHtml(text)}</div></details>`,
    };
  }

  function sourceLinksCell(value) {
    const sources = Array.isArray(value) ? value : [];
    const links = sources.map((source) => {
      const url = String(source?.url || '').trim();
      if (!/^https:\/\//i.test(url)) return '';
      const title = String(source?.title || source?.authority || 'Open reference').trim();
      return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></li>`;
    }).filter(Boolean);
    if (!links.length) return 'Not available';
    return {
      html: true,
      value: `<details class="record-detail"><summary>View reference links</summary><ul class="record-source-links">${links.join('')}</ul></details>`,
    };
  }

  function csvCell(value) {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, headers, rows) {
    const csv = `\uFEFF${[headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  }

  function visibleCellText(cell) {
    const copy = cell.cloneNode(true);
    copy.querySelectorAll('button, input, select, textarea').forEach((node) => node.remove());
    return String(copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function downloadCurrentSection() {
    const view = $('#dashboard-view');
    if (!view) return;
    const rangeControl = $('#reporting-range');
    const rows = [
      ['Page', titles[state.section] || 'Admin'],
      ['Downloaded', new Date().toISOString()],
      [rangeControl?.hidden ? 'Scope' : 'Date range', rangeControl?.hidden
        ? 'All records shown for the current filters'
        : ($('#date-range')?.selectedOptions?.[0]?.textContent || 'Current view')],
      [],
    ];

    view.querySelectorAll('.metric').forEach((item) => {
      rows.push([
        'Summary',
        item.querySelector('small')?.textContent?.trim() || 'Measure',
        item.querySelector('strong')?.textContent?.trim() || 'Not available',
        item.querySelector('em')?.textContent?.trim() || '',
      ]);
    });

    view.querySelectorAll('table').forEach((dataTable, index) => {
      const panel = dataTable.closest('.panel');
      const name = panel?.querySelector('h3')?.textContent?.trim() || `Table ${index + 1}`;
      rows.push([], [name]);
      rows.push([...dataTable.querySelectorAll('thead th')].map(visibleCellText));
      dataTable.querySelectorAll('tbody tr').forEach((row) => {
        rows.push([...row.querySelectorAll('td')].map(visibleCellText));
      });
    });

    view.querySelectorAll('.bar-row, .queue-link').forEach((item) => {
      const parts = [...item.children].map(visibleCellText).filter(Boolean);
      if (parts.length) rows.push(['Page detail', ...parts]);
    });

    view.querySelectorAll('.definition-list').forEach((list) => {
      const terms = [...list.querySelectorAll('dt')];
      terms.forEach((term) => {
        rows.push(['Page detail', visibleCellText(term), visibleCellText(term.nextElementSibling)]);
      });
    });

    view.querySelectorAll('.notice, .panel-note').forEach((note) => {
      const copy = visibleCellText(note);
      if (copy) rows.push(['Note', copy]);
    });

    if (rows.length === 4) {
      rows.push(['Page summary', String(view.textContent || '').replace(/\s+/g, ' ').trim()]);
    }
    const filenameSection = String(titles[state.section] || 'admin')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadCsv(`due-diligence-${filenameSection || 'admin'}-current-page.csv`, rows[0], rows.slice(1));
    toast('Current page data downloaded for Google Sheets. Use the page-specific download for the complete record set.');
  }

  function observatoryKpi(label, value, icon, tone = '', note = '') {
    return `<article class="observatory-kpi ${escapeHtml(tone)}">
      <div class="kpi-head"><span>${escapeHtml(label)}</span><i class="ph ${escapeHtml(icon)}" aria-hidden="true"></i></div>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>`;
  }

  function observatoryAction(label, copy, count, section, icon) {
    const enabled = sectionAllowed(section);
    return `<button type="button" class="observatory-action" ${enabled ? `data-admin-section="${escapeHtml(section)}"` : 'disabled'}>
      <i class="ph ${escapeHtml(icon)}" aria-hidden="true"></i>
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(copy)}</small></span>
      <span class="count">${escapeHtml(number(count))}</span>
    </button>`;
  }

  const OBSERVATORY_CHART_COLORS = Object.freeze([
    '#22c6d8', '#36d39b', '#d2aa55', '#a9a7e8', '#5d8fe8', '#f2767e', '#8fa2af',
  ]);

  function observatoryLegend(segments) {
    return `<div class="executive-legend">${segments.map((segment) => `
      <span><i style="--legend-color:${escapeHtml(segment.color)}"></i><b>${escapeHtml(segment.label)}</b><small>${escapeHtml(number(segment.value))}</small></span>
    `).join('')}</div>`;
  }

  function commercialAccessBadge(account = {}) {
    const label = commercialAccountLabel(account);
    const className = /verified|founding/i.test(label) ? 'ok'
      : /pending/i.test(label) ? 'warn'
        : /rejected|expired/i.test(label) ? 'danger' : 'muted';
    return `<span class="status ${className}">${escapeHtml(label)}</span>`;
  }

  function accountRemainingAllowance(account = {}) {
    const label = commercialAccountLabel(account);
    if (/verified|founding|admin/i.test(label)) return 'Unlimited';
    if (Number.isFinite(Number(account.free_grades_remaining))) {
      return `${number(account.free_grades_remaining)} remaining`;
    }
    return 'Not available';
  }

  function accountRegion(account = {}) {
    return String(account.current_region || '').trim() || 'Available after next sign-in';
  }

  function accountDevice(account = {}) {
    const category = String(account.current_device_category || '').trim();
    const details = [account.current_browser, account.current_operating_system]
      .map((value) => String(value || '').trim())
      .filter((value) => value && !/unknown|privacy-masked/i.test(value));
    const label = category ? humanizeAuditValue(category) : 'Available after next activity';
    return [label, ...details].join(' · ');
  }

  function durationLabel(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function recentActivityLabel(row = {}) {
    const labels = {
      session_start: 'Started session',
      sign_in_completed: 'Signed in',
      page_view: 'Viewed page',
      question_viewed: 'Opened question',
      grading_started: 'Submitted answer',
      grading_success: 'Answer graded',
      grading_failure: 'Grading failed',
      grading_timeout: 'Grading timed out',
      session_end: 'Ended session',
    };
    const event = String(row.latest_event_type || '').trim();
    const page = String(row.latest_page_area || '').trim();
    const result = String(row.latest_result_category || '').trim();
    const primary = labels[event] || (event ? humanizeAuditValue(event) : 'Session activity');
    const detail = [page && humanizeAuditValue(page), result && humanizeAuditValue(result)]
      .filter(Boolean)
      .join(' · ');
    return detail ? `${primary} · ${detail}` : primary;
  }

  function recentActivityAccessBadge(row = {}) {
    const label = String(row.effective_access || row.subscription_category || 'Introductory access');
    const className = /paid|founding/i.test(label) ? 'ok'
      : /administrator/i.test(label) ? 'muted'
        : /pending/i.test(label) ? 'warn' : 'muted';
    return `<span class="status ${className}">${escapeHtml(label)}</span>`;
  }

  function recentActivityRemaining(row = {}) {
    if (/paid|founding|administrator/i.test(String(row.effective_access || ''))) return 'Unlimited';
    return Number.isFinite(Number(row.free_grades_remaining))
      ? `${number(row.free_grades_remaining)} remaining`
      : 'Not available';
  }

  function executiveSubscriptionSegments(engagement = {}) {
    return Object.entries(engagement.subscriptionCounts || {})
      .map(([label, value], index) => ({
        label,
        value: Math.max(0, Number(value) || 0),
        color: OBSERVATORY_CHART_COLORS[index % OBSERVATORY_CHART_COLORS.length],
      }))
      .filter((segment) => segment.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 7);
  }

  function executiveDeviceSegments(report = {}) {
    return (report.devices || [])
      .map((row, index) => ({
        label: humanizeAuditValue(row.category || 'Other'),
        value: Math.max(0, Number(row.sessions) || 0),
        color: OBSERVATORY_CHART_COLORS[index % OBSERVATORY_CHART_COLORS.length],
      }))
      .filter((segment) => segment.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 7);
  }

  async function renderExecutive(report) {
    const current = report.current || {};
    const previous = report.previous || {};
    const traffic = current.traffic || {};
    const funnel = current.funnel || {};
    const learning = current.learning || {};
    const reliability = current.reliability || {};
    const engagement = report.engagement || report.engagementOverview || {};
    const betaAllAccess = report.betaAllAccess || {};
    const betaKnown = typeof betaAllAccess.enabled === 'boolean';
    const betaEnabled = betaAllAccess.enabled === true;
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(state.authorization?.role);
    const [directory, recentSignIns, paymentData] = await Promise.all([
      loadUserDirectory(false, '', 0).catch(() => ({ items: [], total: null })),
      loadRecentSignIns(false).catch(() => ({ items: [] })),
      sectionAllowed('payments')
        ? loadPhase4Operational('payments').catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
    ]);
    const recentAccounts = [...(
      recentSignIns.items?.length ? recentSignIns.items : directory.items || []
    )]
      .sort((left, right) => new Date(
        right.monitoring_recorded_at || right.last_sign_in_at || 0,
      ) - new Date(left.monitoring_recorded_at || left.last_sign_in_at || 0))
      .slice(0, 7);
    const signedInAccounts = engagement.signedInAccounts ?? directory.total;
    const answeringUsers = engagement.usersWithAnswers;
    const questionsAnswered = engagement.questionsAnswered ?? learning.successful_grades;
    const gradingSuccess = reliability.success_rate;
    const subscriptionSegments = executiveSubscriptionSegments(engagement);
    const deviceSegments = executiveDeviceSegments(report);
    const paymentRows = paymentData.items || [];
    const approvedRows = paymentRows.filter((row) => String(row.status || '').toLowerCase() === 'approved');
    const pendingRows = paymentRows.filter((row) => !['approved', 'rejected'].includes(String(row.status || '').toLowerCase()));
    const approvedValue = approvedRows.reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0);
    const pendingValue = pendingRows.reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0);
    const subjectRows = [...(report.subjects || [])]
      .map((row) => ({ label: row.subject || 'Unspecified', value: Math.max(0, Number(row.successful_grades) || 0) }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 7);
    const funnelRows = [
      { label: 'Visitors', value: Number(traffic.unique_visitors) || 0 },
      { label: 'Sign-in starts', value: Number(funnel.sign_in_started) || 0 },
      { label: 'Sign-in completed', value: Number(funnel.sign_in_completed) || 0 },
      { label: 'Registered', value: Number(funnel.registrations) || 0 },
      { label: 'First answer', value: Number(answeringUsers) || 0 },
    ];
    report.executiveVisuals = {
      activityLabels: ['Previous period', 'Selected period'],
      activityValues: [Number(previous.learning?.successful_grades) || 0, Number(learning.successful_grades) || 0],
      subscriptionSegments,
      deviceSegments,
      funnelRows,
      revenueRows: [
        { label: 'Approved value', value: approvedValue },
        { label: 'Pending request value', value: pendingValue },
      ],
      subjectRows,
    };
    return `
      <div class="observatory-kpis">
        ${observatoryKpi('Signed-in accounts', number(signedInAccounts), 'ph-users-three', 'cyan', 'All recorded accounts')}
        ${observatoryKpi('Answering users', number(answeringUsers), 'ph-user-focus', 'cyan', 'Accounts with at least one answer')}
        ${observatoryKpi('Questions answered', number(questionsAnswered), 'ph-chats-circle', 'cyan', 'Across website features')}
        ${observatoryKpi('Grading success', percentage(gradingSuccess), 'ph-shield-check', gradingSuccess != null && Number(gradingSuccess) < 0.95 ? 'red' : 'green', 'Selected reporting period')}
      </div>
      <div class="executive-chart-grid executive-chart-grid-top">
        <section class="observatory-card executive-activity-card">
          <div class="card-head"><div><h3>Activity Trend</h3><p>Successful grades · previous and selected period.</p></div><span class="status ok">Verified</span></div>
          <div class="chart-shell compact"><canvas id="observatory-activity-chart" aria-label="Successful grading activity comparison chart" role="img"></canvas></div>
          <div class="legend-row"><span class="cyan"><i></i>Successful answers</span></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>User Mix</h3><p>By server-resolved access category.</p></div></div>
          <div class="donut-layout"><div class="chart-shell compact"><canvas id="observatory-user-mix-chart" aria-label="User access category distribution chart" role="img"></canvas></div>${observatoryLegend(subscriptionSegments)}</div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Device Mix</h3><p>Session categories; identifiers are not collected.</p></div></div>
          <div class="donut-layout"><div class="chart-shell compact"><canvas id="observatory-device-chart" aria-label="Device category distribution chart" role="img"></canvas></div>${observatoryLegend(deviceSegments)}</div>
        </section>
      </div>
      <div class="executive-chart-grid executive-chart-grid-bottom">
        <section class="observatory-card">
          <div class="card-head"><div><h3>Sign-up Funnel</h3><p>Selected reporting period.</p></div></div>
          <div class="chart-shell compact"><canvas id="observatory-funnel-chart" aria-label="Sign-up funnel chart" role="img"></canvas></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Revenue Record</h3><p>Verified requests; not bank settlement.</p></div><button type="button" class="icon-link" data-admin-section="business_revenue" aria-label="Open revenue records"><i class="ph ph-arrow-up-right" aria-hidden="true"></i></button></div>
          <div class="chart-shell compact"><canvas id="observatory-revenue-chart" aria-label="Approved and pending payment request value chart" role="img"></canvas></div>
          <div class="revenue-summary"><span><b>${escapeHtml(`₱${number(approvedValue, 2)}`)}</b>Approved</span><span><b>${escapeHtml(`₱${number(pendingValue, 2)}`)}</b>Pending</span></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Top Subjects by Answers</h3><p>Completed grades in the selected period.</p></div></div>
          <div class="chart-shell compact"><canvas id="observatory-subject-chart" aria-label="Top subjects by successful answers chart" role="img"></canvas></div>
        </section>
      </div>
      <section class="observatory-card executive-recent-users">
        <div class="card-head"><div><h3>Recent Users</h3><p>Latest recorded account sign-ins.</p></div><button type="button" class="icon-link" data-admin-section="recent_users" aria-label="Open recent user activity"><span>View recent users</span><i class="ph ph-caret-right" aria-hidden="true"></i></button></div>
        ${table(['Name', 'Email', 'School', 'Last sign-in', 'Region', 'Device', 'Questions', 'Access', 'Remaining'], recentAccounts.map((account) => [
          account.display_name || 'Not provided', account.email || 'Not provided', account.school || 'Not provided', dateTime(account.last_sign_in_at),
          accountRegion(account), accountDevice(account), number(account.answered_question_count),
          { html: true, value: commercialAccessBadge(account) }, accountRemainingAllowance(account),
        ]))}
      </section>
      <details class="executive-operations observatory-card">
        <summary><span><i class="ph ph-bell-ringing" aria-hidden="true"></i>Operations &amp; access</span><small>${escapeHtml(number((Number(report.queues?.pending_payments) || 0) + (Number(report.queues?.pending_support) || 0) + (Number(report.queues?.pending_corrections) || 0) + (Number(engagement.openQuorumReports) || 0)))} open items</small></summary>
        <div class="executive-operations-grid">
          <div class="observatory-actions">
            ${observatoryAction('Payments', 'Proofs awaiting review', report.queues?.pending_payments, 'payments', 'ph-receipt')}
            ${observatoryAction('Support', 'Open cases', report.queues?.pending_support, 'support', 'ph-headset')}
            ${observatoryAction('Corrections', 'Editorial reviews', report.queues?.pending_corrections, 'corrections', 'ph-note-pencil')}
            ${observatoryAction('Community', 'Open reports', engagement.openQuorumReports, 'forum', 'ph-chats-circle')}
          </div>
          <div>
            <dl class="definition-list">
              <dt>Commercial enforcement</dt><dd>${!betaKnown ? 'Not confirmed' : betaEnabled ? 'Temporarily bypassed' : 'Active'}</dd>
              <dt>Introductory allowance</dt><dd>Five lifetime practice tokens</dd>
              <dt>Active manual entitlements</dt><dd>${escapeHtml(number(report.queues?.active_manual_entitlements))}</dd>
              <dt>Last access change</dt><dd>${escapeHtml(dateTime(betaAllAccess.updatedAt))}</dd>
            </dl>
            ${founderAuthorized && betaKnown ? `<div class="dialog-actions">${actionButton(
              betaEnabled ? 'Activate commercial enforcement' : 'Enable temporary safety access',
              'global_beta_change', 'global_beta_all_access',
              { currentEnabled: betaEnabled, enabled: !betaEnabled },
            ).value}</div>` : ''}
          </div>
        </div>
      </details>`;
  }

  function barList(rows) {
    const maximum = Math.max(1, ...rows.map((row) => Number(row[1]) || 0));
    if (!rows.some((row) => Number(row[1]) > 0)) return empty('No verified events in this period.');
    return `<div class="bar-list">${rows.map(([label, value]) => `
      <button type="button" class="bar-row" data-insight="${insightData(label, number(value), {
    copy: 'Verified event count for this step in the selected reporting period.',
    source: 'Due Diligence website records',
  })}"><span>${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, (Number(value) || 0) / maximum * 100)}%"></span></span>
        <strong>${number(value)}</strong></button>`).join('')}</div>`;
  }

  async function renderRealtime(report) {
    const activity = await loadLiveActivity();
    const current = report.current?.traffic || {};
    const previous = report.previous?.traffic || {};
    return `
      ${heading('Live Activity', 'Approximate activity totals for recent signed-in sessions. Exact online names are withheld because the current session records cannot reliably identify a person after sign-out or an account switch.')}
      <div class="metric-strip">
        ${metric('Active sessions · 5 minutes', activity.activeSignedInLast5Minutes, null, number, {
          subtext: 'Approximate · not exact people online',
        })}
        ${metric('Active sessions · 30 minutes', activity.activeSignedInLast30Minutes, null, number, {
          subtext: 'Approximate · may include stale sessions',
        })}
        ${metric('Sessions', current.sessions, previous.sessions)}
        ${metric('Average daily views', current.average_daily_views, previous.average_daily_views, (v) => number(v, 1))}
        ${metric('Average daily visitors', current.average_daily_unique_visitors, previous.average_daily_unique_visitors, (v) => number(v, 1))}
        ${metric('Daily users as % of monthly users', current.dau_mau_ratio, previous.dau_mau_ratio, percentage)}
        ${metric('Weekly users as % of monthly users', current.wau_mau_ratio, previous.wau_mau_ratio, percentage)}
      </div>
      <section class="panel">
        <div class="panel-title-row"><div><h3>Recent activity summary</h3><p class="panel-note">Use these totals for broad demand monitoring only. The Admin does not label a named user as online until sign-in, sign-out, and account switching can be matched reliably.</p></div><button class="secondary-button" id="download-live-activity" type="button">Download summary</button></div>
        ${table(['Measure', 'Value', 'Meaning'], [
          ['Activity in the last 5 minutes', number(activity.activeSignedInLast5Minutes), 'Approximate signed-in-session records'],
          ['Activity in the last 30 minutes', number(activity.activeSignedInLast30Minutes), 'Approximate signed-in-session records'],
        ])}
      </section>
      <div class="work-grid">
        <section class="panel"><h3>Signed-in and guest sessions</h3>${barList([
          ['Signed-in sessions', current.authenticated_sessions],
          ['Guest sessions', current.guest_sessions],
        ])}</section>
        <section class="panel"><h3>Device category</h3>${barList((report.devices || []).map((row) => [row.category, row.sessions]))}</section>
      </div>
      <section class="panel"><h3>How this is counted</h3><p class="panel-note">Activity is based on periodic visible-page updates. Existing records may continue after sign-out or be reused after an account switch, so this page intentionally shows totals rather than named people. Private answers, tokens, prompts, IP addresses, and full browser identifiers are not shown here.</p></section>`;
  }

  function renderAcquisition(report) {
    const funnel = report.current?.funnel || {};
    const retention = report.current?.retention || {};
    const retentionRows = ['d1', 'd7', 'd30'].map((horizon) => {
      const value = retention[horizon] || {};
      return [
        horizon.toUpperCase(),
        value.eligible_cohort == null ? 'Not available' : number(value.eligible_cohort),
        value.retained == null ? 'Not available' : number(value.retained),
        value.rate == null
          ? (value.matured ? 'Not available — insufficient sample' : 'Not available — cohort not mature')
          : percentage(value.rate),
      ];
    });
    return `
      ${heading('Visitors & Sign-ups', 'See where visitors came from and how they moved from sign-in to registration. Rates appear only when enough data exists.')}
      <div class="work-grid">
        <section class="panel"><h3>Source and medium</h3>${table(
          ['Source', 'Medium', 'Sessions'],
          (report.acquisition || []).map((row) => [row.source, row.medium, number(row.sessions)]),
        )}</section>
        <section class="panel"><h3>Guest-to-registration funnel</h3>${barList([
          ['Sign-in prompted', funnel.sign_in_prompted],
          ['Sign-in started', funnel.sign_in_started],
          ['Sign-in completed', funnel.sign_in_completed],
          ['Registrations', funnel.registrations],
          ['Onboarding completed', funnel.onboarding_completed],
        ])}</section>
      </div>
      <section class="panel"><h3>Conversion quality</h3>
        <div class="metric-strip">
          ${metric('Prompt-to-registration', funnel.registration_conversion_rate, null, percentage)}
          ${metric('Onboarding completion', funnel.onboarding_completion_rate, null, percentage)}
          ${metric('Guest activation', funnel.guest_activation_rate, null, percentage)}
        </div>
      </section>
      <section class="panel"><h3>Return visits</h3>
        ${table(['Time since sign-up', 'Users old enough to measure', 'Returned', 'Return rate'], retentionRows)}
        <p class="panel-note">One-day, seven-day, and 30-day return rates appear only after the full period has passed and at least five users can be measured.</p>
      </section>`;
  }

  function renderMarketing(report) {
    const funnel = report.current?.funnel || {};
    const traffic = report.current?.traffic || {};
    return `
      ${heading('Acquisition', 'Understand how people find Due Diligence and where the sign-in journey loses momentum. Only recorded source and session data are shown.')}
      <div class="observatory-kpis">
        ${observatoryKpi('Unique visitors', number(traffic.unique_visitors), 'ph-users-three', 'gold', 'Selected period')}
        ${observatoryKpi('Sign-in starts', number(funnel.sign_in_started), 'ph-sign-in', 'cyan', 'Recorded starts')}
        ${observatoryKpi('Registrations', number(funnel.registrations), 'ph-user-plus', 'green', 'Completed accounts')}
        ${observatoryKpi('Activation', percentage(funnel.guest_activation_rate), 'ph-lightning', 'gold', 'Recorded guest activation')}
      </div>
      <div class="observatory-grid">
        <section class="observatory-card">
          <div class="card-head"><div><h3>Source performance</h3><p>Sessions grouped by recorded source.</p></div></div>
          <div class="chart-shell"><canvas id="observatory-acquisition-chart" aria-label="Acquisition source chart" role="img"></canvas></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Sign-in funnel</h3><p>From prompt to completed onboarding.</p></div></div>
          ${barList([
            ['Prompted', funnel.sign_in_prompted], ['Started', funnel.sign_in_started],
            ['Completed', funnel.sign_in_completed], ['Registered', funnel.registrations],
            ['Onboarded', funnel.onboarding_completed],
          ])}
        </section>
        <section class="observatory-card wide">
          <div class="card-head"><div><h3>Recorded channels</h3><p>No channel is inferred when source data is absent.</p></div></div>
          ${table(['Source', 'Medium', 'Sessions'], (report.acquisition || []).map((row) => [row.source, row.medium, number(row.sessions)]))}
        </section>
      </div>`;
  }

  async function renderBusinessRevenue() {
    const [payments, refunds, directory] = await Promise.all([
      loadAllPhase4Operational('payments').catch(() => ({ items: [] })),
      loadAllPhase4Operational('refunds').catch(() => ({ items: [] })),
      loadAllUserDirectory().catch(() => ({ items: [] })),
    ]);
    const paymentRows = payments.items || [];
    const refundRows = refunds.items || [];
    const directoryRows = directory.items || [];
    const directoryById = new Map(directoryRows.map((account) => [String(account.id), account]));
    const approved = paymentRows.filter((row) => String(row.status).toLowerCase() === 'approved');
    const pending = paymentRows.filter((row) => !['approved', 'rejected'].includes(String(row.status).toLowerCase()));
    const rejected = paymentRows.filter((row) => String(row.status).toLowerCase() === 'rejected');
    const approvedValue = approved.reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0);
    const approvedRefunds = refundRows
      .filter((row) => String(row.status).toLowerCase() === 'approved')
      .reduce((sum, row) => sum + (Number(row.approved_refund_php) || 0), 0);
    const subscriberRecords = paidSubscriberRecords(directoryRows, paymentRows);
    const activePaid = subscriberRecords.filter(({ account, payment }) => paidSubscriberAccessState(account, payment).label === 'Active');
    const statusRows = [
      { label: 'Approved', value: approvedValue },
      { label: 'Pending', value: pending.reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0) },
      { label: 'Rejected', value: rejected.reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0) },
      { label: 'Refunded', value: approvedRefunds },
    ];
    state.businessRevenueVisuals = { statusRows };
    const recentRows = [...paymentRows]
      .sort((left, right) => new Date(right.submitted_at || 0) - new Date(left.submitted_at || 0))
      .slice(0, 20)
      .map((row) => [
        row.display_name || row.email || 'Not provided',
        { html: true, value: `<span class="status ${row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'danger' : 'warn'}">${escapeHtml(commercialPaymentLabel(row.status))}</span>`, sortValue: row.status },
        `₱${number(row.trusted_amount_php, 2)}`,
        { html: true, value: dateTime(row.submitted_at), sortValue: row.submitted_at || '' },
        row.reviewed_by ? administratorIdentity(row.reviewed_by, directoryById) : 'Pending review',
      ]);
    return `
      ${heading('Revenue', 'Commercial records derived from administrator-verified payment requests. These are operational records, not bank settlement or accounting statements.')}
      <div class="observatory-kpis">
        ${observatoryKpi('Approved requests', number(approved.length), 'ph-seal-check', 'green', 'Administrator verified')}
        ${observatoryKpi('Approved value', `₱${number(approvedValue, 2)}`, 'ph-currency-circle-dollar', 'gold', 'Request records')}
        ${observatoryKpi('Active paid access', number(activePaid.length), 'ph-identification-card', 'cyan', 'Current paid entitlements')}
        ${observatoryKpi('Net recorded value', `₱${number(Math.max(0, approvedValue - approvedRefunds), 2)}`, 'ph-chart-line-up', 'green', 'Approved less approved refunds')}
      </div>
      <div class="observatory-grid business-intelligence-grid">
        <section class="observatory-card">
          <div class="card-head"><div><h3>Recorded commercial value</h3><p>Value grouped by request state and approved refunds.</p></div></div>
          <div class="chart-shell"><canvas id="business-revenue-status-chart" aria-label="Recorded commercial value by state" role="img"></canvas></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Commercial operating state</h3><p>Counts are derived from protected payment and entitlement records.</p></div></div>
          ${table(['State', 'Records', 'Recorded amount'], [
            ['Paid verified', number(approved.length), `₱${number(approvedValue, 2)}`],
            ['Paid not verified', number(pending.length + rejected.length), `₱${number(statusRows[1].value + statusRows[2].value, 2)}`],
            ['Approved refunds', number(refundRows.filter((row) => String(row.status).toLowerCase() === 'approved').length), `₱${number(approvedRefunds, 2)}`],
            ['Active paid entitlements', number(activePaid.length), 'Access records'],
          ])}
        </section>
        <section class="observatory-card wide">
          <div class="card-head"><div><h3>Latest payment records</h3><p>Newest first. Select a heading to sort, or open the payment queue for proof review.</p></div><button type="button" class="secondary-button" data-admin-section="payments"><i class="ph ph-receipt" aria-hidden="true"></i>Review payments</button></div>
          ${table(['Student', 'Verification', 'Recorded amount', 'Submitted', 'Reviewed by'], recentRows)}
          <div class="notice"><strong>Accounting boundary.</strong> Bank settlement, transfer fees, taxes, and cash reconciliation are not connected. Only recorded administrator decisions are reported.</div>
        </section>
      </div>`;
  }

  async function renderBusinessProjections(report) {
    const [directory, payments] = await Promise.all([
      loadAllUserDirectory().catch(() => ({ items: [], total: 0 })),
      loadAllPhase4Operational('payments').catch(() => ({ items: [] })),
    ]);
    const directoryRows = directory.items || [];
    const paymentRows = payments.items || [];
    const verifiedPaid = paidSubscriberRecords(directoryRows, paymentRows)
      .filter(({ account, payment }) => paidSubscriberState(account, payment).label === 'Paid verified');
    const visitors = Math.max(
      Number(report.current?.traffic?.unique_visitors || 0),
      Number(directory.total || directoryRows.length || 0),
    );
    const observedConversion = visitors > 0 ? (verifiedPaid.length / visitors) * 100 : 0;
    const defaultRate = observedConversion > 0 ? observedConversion : 5;
    const approvedValue = paymentRows
      .filter((row) => String(row.status).toLowerCase() === 'approved')
      .reduce((sum, row) => sum + (Number(row.trusted_amount_php) || 0), 0);
    return `
      ${heading('Projections', 'Build a planning scenario from transparent assumptions. Forecasts are never mixed with verified performance.')}
      <div class="observatory-kpis">
        ${observatoryKpi('Recorded reach', number(visitors), 'ph-users-three', 'cyan', 'Larger of selected visitors or accounts')}
        ${observatoryKpi('Verified paid records', number(verifiedPaid.length), 'ph-seal-check', 'green', 'Protected commercial ledger')}
        ${observatoryKpi('Observed conversion', `${number(observedConversion, 2)}%`, 'ph-percent', 'gold', 'Verified paid ÷ recorded reach')}
        ${observatoryKpi('Approved value', `₱${number(approvedValue, 2)}`, 'ph-currency-circle-dollar', 'green', 'Recorded requests, not bank settlement')}
      </div>
      <section class="observatory-card">
        <div class="card-head"><div><h3>Commercial planning model</h3><p>Adjust reach, conversion, and price. Conservative and growth cases update automatically.</p></div><span class="status warn">Scenario</span></div>
        <div class="forecast-grid">
          <label>Reach<input id="scenario-visitors" type="number" min="0" step="1" value="${escapeHtml(visitors || 1000)}"></label>
          <label>Base conversion (%)<input id="scenario-rate" type="number" min="0" max="100" step="0.1" value="${escapeHtml(number(defaultRate, 2).replace(/,/g, ''))}"></label>
          <label>Price per access (₱)<input id="scenario-price" type="number" min="0" step="0.01" value="149"></label>
        </div>
        <div class="forecast-result forecast-scenarios" id="scenario-metrics" aria-live="polite">
          <div><span>Conservative · 75% of base</span><strong id="scenario-low-gross">₱0.00</strong><small id="scenario-low-customers">0 customers</small></div>
          <div class="forecast-primary"><span>Base scenario</span><strong id="scenario-gross">₱0.00</strong><small><b id="scenario-customers">0</b> customers · <b id="scenario-rpm">₱0.00</b> per 1,000 reached</small></div>
          <div><span>Growth · 125% of base</span><strong id="scenario-high-gross">₱0.00</strong><small id="scenario-high-customers">0 customers</small></div>
        </div>
        <p class="panel-note" id="scenario-output"></p>
      </section>
      <section class="observatory-card">
        <div class="card-head"><div><h3>Decision boundaries</h3><p>The model uses real recorded reach as a starting point; all scenario outputs remain assumptions.</p></div></div>
        ${table(['Input', 'Recorded baseline', 'Planning treatment'], [
          ['Reach', number(visitors), 'Editable'],
          ['Conversion', `${number(observedConversion, 2)}% observed`, 'Editable base; conservative and growth brackets are derived'],
          ['Price', '₱149.00 current recorded offer', 'Editable for planning only'],
          ['Costs and settlement', 'Not connected', 'Excluded rather than invented'],
        ])}
      </section>`;
  }

  function activityDeviceRows(items = []) {
    const counts = new Map();
    items.forEach((row) => {
      const category = humanizeAuditValue(row.current_device_category || 'unknown');
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts.entries()].map(([label, value]) => ({ label, value }));
  }

  function activityHourRows(items = []) {
    const counts = new Map();
    items.forEach((row) => {
      const value = row.latest_event_at || row.last_activity_at || row.started_at;
      const date = value ? new Date(value) : null;
      if (!date || !Number.isFinite(date.getTime())) return;
      const label = new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila', hour: 'numeric', hour12: true,
      }).format(date);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 8);
  }

  async function renderBusinessComparisons(report) {
    const window = reportingWindow();
    const [currentActivity, previousActivity] = await Promise.all([
      loadRecentUserActivityWindow(window.from, window.to)
        .catch(() => ({ items: [], summary: {}, activityMix: [], unavailable: true })),
      loadRecentUserActivityWindow(window.previousFrom, window.previousTo)
        .catch(() => ({ items: [], summary: {}, activityMix: [], unavailable: true })),
    ]);
    const currentSummary = currentActivity.summary || {};
    const previousSummary = previousActivity.summary || {};
    const currentDevices = activityDeviceRows(currentActivity.items || []);
    const previousDevices = activityDeviceRows(previousActivity.items || []);
    const deviceLabels = [...new Set([...currentDevices, ...previousDevices].map((row) => row.label))];
    const currentDeviceMap = new Map(currentDevices.map((row) => [row.label, row.value]));
    const previousDeviceMap = new Map(previousDevices.map((row) => [row.label, row.value]));
    const performanceRows = [
      ['Page views', report.current?.traffic?.page_views, report.previous?.traffic?.page_views],
      ['Unique visitors', report.current?.traffic?.unique_visitors, report.previous?.traffic?.unique_visitors],
      ['Registrations', report.current?.funnel?.registrations, report.previous?.funnel?.registrations],
      ['Successful grades', report.current?.learning?.successful_grades, report.previous?.learning?.successful_grades],
      ['Signed-in users', currentSummary.uniqueUsers, previousSummary.uniqueUsers],
      ['Signed-in sessions', currentSummary.sessions, previousSummary.sessions],
    ];
    state.businessComparisonVisuals = {
      performanceLabels: performanceRows.map(([label]) => label),
      currentValues: performanceRows.map(([, current]) => current),
      previousValues: performanceRows.map(([, , previous]) => previous),
      deviceLabels,
      currentDevices: deviceLabels.map((label) => currentDeviceMap.get(label) || 0),
      previousDevices: deviceLabels.map((label) => previousDeviceMap.get(label) || 0),
    };
    const currentHours = activityHourRows(currentActivity.items || []);
    const previousMix = new Map((previousActivity.activityMix || []).map((row) => [row.event_type, row.event_count]));
    return `
      ${heading('Comparisons', 'Compare the selected period with the immediately preceding period using the same definitions and reporting window.')}
      ${(currentActivity.unavailable || previousActivity.unavailable) ? '<div class="notice danger"><strong>Activity comparison is temporarily incomplete.</strong> The protected session ledger could not be loaded. No missing values were estimated; refresh after the service recovers.</div>' : ''}
      <div class="observatory-kpis">
        ${observatoryKpi('Signed-in users', number(currentSummary.uniqueUsers), 'ph-users', 'cyan', 'Selected period')}
        ${observatoryKpi('Sessions', number(currentSummary.sessions), 'ph-browser', 'gold', 'Selected period')}
        ${observatoryKpi('Average time used', durationLabel(currentSummary.averageDurationSeconds), 'ph-timer', 'green', 'Per session')}
        ${observatoryKpi('Total time used', durationLabel(currentSummary.totalDurationSeconds), 'ph-clock-countdown', 'cyan', 'Selected period')}
      </div>
      <div class="observatory-grid business-intelligence-grid">
        <section class="observatory-card wide">
          <div class="card-head"><div><h3>Operating comparison</h3><p>Current period versus the immediately preceding window.</p></div><span class="status ok">Like-for-like</span></div>
          <div class="chart-shell"><canvas id="observatory-comparison-chart" aria-label="Business period comparison chart" role="img"></canvas></div>
          <div class="legend-row"><span class="gold"><i></i>Current</span><span class="cyan"><i></i>Previous</span></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Device use</h3><p>Latest 100 sessions in each period, grouped by device category.</p></div></div>
          <div class="chart-shell"><canvas id="business-device-comparison-chart" aria-label="Device use comparison chart" role="img"></canvas></div>
          <div class="legend-row"><span class="gold"><i></i>Current</span><span class="cyan"><i></i>Previous</span></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Peak activity times</h3><p>Latest 100 sessions in the selected period, grouped by Asia/Manila hour.</p></div></div>
          ${table(['Time', 'Recorded sessions'], currentHours.map((row) => [row.label, number(row.value)]))}
        </section>
        <section class="observatory-card wide">
          <div class="card-head"><div><h3>Performance ledger</h3><p>Every measure uses the same selected and previous reporting windows.</p></div></div>
          ${table(['Measure', 'Current', 'Previous'], [
            ...performanceRows.map(([label, current, previous]) => [label, number(current), number(previous)]),
            ['Average session time', durationLabel(currentSummary.averageDurationSeconds), durationLabel(previousSummary.averageDurationSeconds)],
            ['Total signed-in time', durationLabel(currentSummary.totalDurationSeconds), durationLabel(previousSummary.totalDurationSeconds)],
          ])}
        </section>
        <section class="observatory-card wide">
          <div class="card-head"><div><h3>Activity mix</h3><p>Controlled events only; private answers and sensitive payloads are excluded.</p></div></div>
          ${table(['Activity', 'Current', 'Previous'], (currentActivity.activityMix || []).map((row) => [
            recentActivityLabel({ latest_event_type: row.event_type }),
            number(row.event_count),
            number(previousMix.get(row.event_type) || 0),
          ]))}
          ${(currentActivity.truncated || previousActivity.truncated) ? '<div class="notice"><strong>Sampling boundary.</strong> Duration totals and activity counts cover the full period. Device and peak-hour distributions use the latest 100 sessions per period.</div>' : ''}
        </section>
      </div>`;
  }

  function cellText(cell) {
    if (cell == null || cell === '') return 'Not available';
    if (Array.isArray(cell)) return cell.map(cellText).join(', ');
    if (typeof cell === 'object') {
      try { return JSON.stringify(cell); } catch { return 'Structured record'; }
    }
    return String(cell);
  }

  function tableHeaderLabel(header) {
    return typeof header === 'object' && header ? String(header.label || '') : String(header || '');
  }

  function tableHeaderHtml(headers) {
    return headers.map((header, index) => {
      const label = tableHeaderLabel(header);
      const sortable = typeof header === 'object' && header
        ? header.sortable !== false
        : !/^(actions?|proof|review|transfer)$/i.test(label);
      if (!sortable) return `<th scope="col">${escapeHtml(label)}</th>`;
      return `<th scope="col" aria-sort="none"><button type="button" class="table-sort" data-table-sort-index="${index}" aria-label="Sort by ${escapeHtml(label)}"><span>${escapeHtml(label)}</span><i class="ph ph-caret-up-down" aria-hidden="true"></i></button></th>`;
    }).join('');
  }

  function cellSortValue(cell) {
    if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'sortValue')) {
      return String(cell.sortValue ?? '');
    }
    if (cell?.html === true) {
      return String(cell.value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return cellText(cell);
  }

  function table(headers, rows) {
    if (!rows?.length) return empty('No verified records are available.');
    return `<div class="table-wrap"><table><thead><tr>${tableHeaderHtml(headers)}</tr></thead>
      <tbody>${rows.map((row) => tableRowHtml(headers, row)).join('')}</tbody></table></div>`;
  }

  function actionButton(label, action, target, payload = {}) {
    return {
      html: true,
      value: `<span class="row-actions"><button type="button" data-admin-action="${escapeHtml(action)}" data-target="${escapeHtml(target || '')}" data-payload="${escapeHtml(JSON.stringify(payload))}">${escapeHtml(label)}</button></span>`,
    };
  }

  const userDirectoryHeaders = [
    'Name', 'Email', 'Category', 'Access', 'Last sign-in', 'Region', 'Device',
    'Questions answered', 'Score', 'Actions',
  ];

  function userDirectoryCells(user, founderAuthorized) {
    return [
      user.display_name || 'Not provided',
      user.email,
      user.commercial_category ? humanizeAuditValue(user.commercial_category) : 'User',
      commercialAccountLabel(user),
      dateTime(user.last_sign_in_at),
      accountRegion(user),
      accountDevice(user),
      number(user.answered_question_count),
      user.average_score == null
        ? 'Not available'
        : `${number(user.average_score, 1)} average · ${number(user.latest_score, 1)} latest`,
      {
        html: true,
        value: `<div class="row-actions">
          ${founderAuthorized
            ? `<button type="button" data-view-user-answers data-user-email="${escapeHtml(user.email || '')}">View answers</button>`
            : ''}
          ${founderAuthorized
            ? actionButton('Download Q&A', 'user_response_export', user.id, {
              displayName: user.display_name || 'Not provided',
            }).value
            : ''}
          ${state.authorization?.role === 'super_admin' && user.role !== 'super_admin'
            ? actionButton('Change role', 'role_change', user.id, { role: user.role }).value
            : ''}
        </div>`,
      },
    ];
  }

  function tableRowHtml(headers, cells) {
    return `<tr>${cells.map((cell, index) => {
      const label = tableHeaderLabel(headers[index]) || `Column ${index + 1}`;
      return `<td data-label="${escapeHtml(label)}" data-sort-value="${escapeHtml(cellSortValue(cell))}">${cell?.html === true ? cell.value : escapeHtml(cellText(cell))}</td>`;
    }).join('')}</tr>`;
  }

  function userDirectoryRowsHtml(items, founderAuthorized) {
    return (items || [])
      .map((user) => tableRowHtml(userDirectoryHeaders, userDirectoryCells(user, founderAuthorized)))
      .join('');
  }

  const recentUserActivityHeaders = [
    'Name', 'Email', 'School', 'Started', 'Last activity', 'Time used',
    'Latest activity', 'Region', 'Device', 'Questions', 'Access', 'Remaining',
  ];

  function recentUserActivityCells(row = {}) {
    const active = row.active_now === true;
    return [
      {
        html: true,
        value: `<span class="recent-user-name"><i class="recent-user-presence${active ? ' active' : ''}" aria-hidden="true"></i><span>${escapeHtml(row.display_name || 'Not provided')}</span>${active ? '<small>Active now</small>' : ''}</span>`,
      },
      row.email || 'Not provided',
      row.school || 'Not provided',
      dateTime(row.started_at),
      dateTime(row.latest_event_at || row.last_activity_at),
      durationLabel(row.duration_seconds),
      recentActivityLabel(row),
      accountRegion(row),
      accountDevice(row),
      number(row.questions_answered),
      { html: true, value: recentActivityAccessBadge(row) },
      recentActivityRemaining(row),
    ];
  }

  function recentUserActivityRowsHtml(items) {
    return (items || [])
      .map((row) => tableRowHtml(recentUserActivityHeaders, recentUserActivityCells(row)))
      .join('');
  }

  async function renderRecentUsers() {
    state.recentUserObserver?.disconnect();
    state.recentUserObserver = null;
    state.recentUserOffset = 0;
    const data = await loadRecentUserActivity(false, state.recentUserSearch, 0);
    const items = Array.isArray(data.items) ? data.items : [];
    state.recentUserActivity = data;
    state.recentUserOffset = items.length;
    state.recentUserTotal = Number(data.total || 0);
    const hasMore = state.recentUserOffset < state.recentUserTotal;
    const summary = data.summary || {};
    return `
      ${heading('Recent Users', 'Signed-in sessions, time used, and the latest recorded activity. This page is separate from the complete Users directory.')}
      <div class="metric-strip recent-user-summary">
        ${summaryMetric('Active now', number(summary.activeNow), 'Last 5 minutes')}
        ${summaryMetric('Users', number(summary.uniqueUsers), 'Selected period')}
        ${summaryMetric('Sessions', number(summary.sessions), 'Selected period')}
        ${summaryMetric('Average time used', durationLabel(summary.averageDurationSeconds), 'Per signed-in session')}
        ${summaryMetric('Total time used', durationLabel(summary.totalDurationSeconds), 'Selected period')}
      </div>
      <div class="recent-user-chart-grid">
        <section class="observatory-card">
          <div class="card-head"><div><h3>Time used</h3><p>Recorded signed-in session time by Philippine date.</p></div></div>
          <div class="chart-shell"><canvas id="recent-users-duration-chart" aria-label="Signed-in time used by date" role="img"></canvas></div>
        </section>
        <section class="observatory-card">
          <div class="card-head"><div><h3>Recorded activity</h3><p>Most frequent controlled events; private content is excluded.</p></div></div>
          <div class="chart-shell"><canvas id="recent-users-activity-chart" aria-label="Recorded activity by type" role="img"></canvas></div>
        </section>
      </div>
      <section class="observatory-card recent-user-ledger">
        <div class="card-head recent-user-ledger-head"><div><h3>Session ledger</h3><p>Newest activity first. More sessions load automatically while scrolling.</p></div></div>
        <div class="table-tools"><input id="recent-user-search" type="search" value="${escapeHtml(state.recentUserSearch)}" placeholder="Search name, school, or email" aria-label="Search recent user activity"><button class="secondary-button" id="recent-user-search-button" type="button">Search</button><button class="secondary-button" id="open-user-directory" data-admin-section="users" type="button">Open all users</button></div>
        <div class="table-wrap recent-user-activity-table"><table><thead><tr>${tableHeaderHtml(recentUserActivityHeaders)}</tr></thead>
          <tbody id="recent-user-activity-body">${items.length ? recentUserActivityRowsHtml(items) : `<tr><td colspan="${recentUserActivityHeaders.length}">${empty('No signed-in session activity matches this view.')}</td></tr>`}</tbody></table></div>
        <div class="continuous-directory-footer" id="recent-user-activity-sentinel">
          <p class="panel-note" id="recent-user-activity-progress" role="status">Showing ${number(state.recentUserOffset)} of ${number(state.recentUserTotal)} matching session(s).</p>
          <button class="secondary-button" id="recent-users-load-more" type="button"${hasMore ? '' : ' hidden'}>Load more sessions</button>
        </div>
      </section>`;
  }

  async function renderUsers() {
    state.userDirectoryObserver?.disconnect();
    state.userDirectoryObserver = null;
    state.userOffset = 0;
    const data = await loadUserDirectory(false, state.userSearch, 0);
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(state.authorization?.role);
    const items = data.items || [];
    state.userOffset = items.length;
    state.userTotal = Number(data.total || 0);
    const hasMore = state.userOffset < state.userTotal;
    return `
      ${heading('Users', 'Search the complete account directory, review access and answer activity, or download the current user list for Google Sheets.')}
      <div class="table-tools"><input id="user-search" type="search" value="${escapeHtml(state.userSearch)}" placeholder="Search name, school, or email" aria-label="Search users"><button class="secondary-button" id="user-search-button">Search</button><button class="secondary-button" id="user-directory-export" type="button">Download user list</button></div>
      <div class="table-wrap recent-users-directory"><table><thead><tr>${tableHeaderHtml(userDirectoryHeaders)}</tr></thead>
        <tbody id="user-directory-body">${items.length ? userDirectoryRowsHtml(items, founderAuthorized) : `<tr><td colspan="${userDirectoryHeaders.length}">${empty('No matching user records are available.')}</td></tr>`}</tbody></table></div>
      <div class="continuous-directory-footer" id="user-directory-sentinel">
        <p class="panel-note" id="user-directory-progress" role="status">Showing ${number(state.userOffset)} of ${number(state.userTotal)} matching account(s).</p>
        <button class="secondary-button" id="users-load-more" type="button"${hasMore ? '' : ' hidden'}>Load more users</button>
      </div>
      ${founderAuthorized ? `<section class="panel">
        <h3>Email the user list to a founder</h3>
        <p class="panel-note">Choose an approved founder. The file includes exact email addresses and is recorded in the activity log.</p>
        <form class="exam-admin-form" id="user-directory-email-form">
          <label>Founder personal email
            <select id="user-directory-email-recipient" required>
              <option value="">Select founder…</option>
              <option value="wally">Wally</option>
              <option value="gilmar">Gilmar</option>
              <option value="ice">Ice</option>
              <option value="emrico">Emrico</option>
            </select>
          </label>
          <label>Reason for sending<textarea id="user-directory-email-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="user-directory-email-confirm" type="checkbox" required> I am authorized to send this user list to the selected founder.</label>
          <button class="secondary-button" type="submit">Email user list</button>
        </form>
      </section>` : ''}`;
  }

  async function renderAnswerExports(report) {
    const engagement = report.engagement || report.engagementOverview || {};
    const data = await loadAnswerHistory();
    const filteredItems = currentAnswerHistoryItems();
    const pageStart = Number(data.offset ?? state.answerOffset) + (filteredItems.length ? 1 : 0);
    const pageEnd = Number(data.offset ?? state.answerOffset) + filteredItems.length;
    const pageFeatureCounts = filteredItems.reduce((counts, item) => {
      const feature = answerFeatureLabel(item);
      counts[feature] = (counts[feature] || 0) + 1;
      return counts;
    }, {});
    const featureTotals = data.featureTotals || {
      bar_question_practice: pageFeatureCounts['Bar Question Practice'] || 0,
      syllabus_based_review: pageFeatureCounts['Syllabus-Based Review'] || 0,
      bar_exam_simulation: pageFeatureCounts['Bar Exam Simulation'] || 0,
    };
    const rows = filteredItems.map((item) => [
      item.userDisplayName || 'Not provided',
      item.userEmail || 'Not available',
      commercialPlanLabel(item.subscriptionCategory),
      answerFeatureLabel(item),
      item.subject || item.examTitle || 'Not available',
      detailCell(item.questionText, 'View question'),
      detailCell(item.submittedAnswer, 'View answer'),
      item.score == null ? 'Not graded' : number(item.score, 1),
      detailCell(item.suggestedAnswer, 'View suggested answer'),
      detailCell(item.modelAnswer, 'View model answer'),
      sourceLinksCell(item.displaySourceLinks),
      dateTime(item.submittedAt || item.answerSavedAt || item.completedAt),
    ]);
    return `
      ${heading('Answers', 'See exactly who answered, what they answered, and the stored score, suggested answer, and model answer. This page does not change simulator content or grading.')}
      <div class="metric-strip">
        ${summaryMetric('Users who answered', number(engagement.usersWithAnswers), 'All time')}
        ${summaryMetric('Questions answered', number(engagement.questionsAnswered), 'All time')}
        ${summaryMetric('Bar Question Practice', number(featureTotals.bar_question_practice || 0), 'All time')}
        ${summaryMetric('Syllabus-Based Review', number(featureTotals.syllabus_based_review || 0), 'All time')}
        ${summaryMetric('Bar Exam Simulation', number(featureTotals.bar_exam_simulation || 0), 'All time')}
      </div>
      <section class="panel">
        <div class="panel-title-row"><div><h3>Answer records</h3><p class="panel-note">Showing ${number(pageStart)}–${number(pageEnd)} of ${number(data.total)} matching answer record(s). “Not available” means that the source record does not contain that field.</p></div><button class="secondary-button" id="download-answer-view" type="button">Download this page</button></div>
        <div class="table-tools">
          <input id="answer-search" type="search" value="${escapeHtml(state.answerSearch)}" placeholder="Search name, email, question, or subject" aria-label="Search answer records">
          <select id="answer-feature" aria-label="Filter answer records by feature">
            <option value="all"${state.answerFeature === 'all' ? ' selected' : ''}>All features</option>
            <option value="bar_question_practice"${state.answerFeature === 'bar_question_practice' ? ' selected' : ''}>Bar Question Practice</option>
            <option value="syllabus_based_review"${state.answerFeature === 'syllabus_based_review' ? ' selected' : ''}>Syllabus-Based Review</option>
            <option value="bar_exam_simulation"${state.answerFeature === 'bar_exam_simulation' ? ' selected' : ''}>Bar Exam Simulation</option>
          </select>
          <button class="secondary-button" id="answer-filter-button" type="button">Apply filter</button>
        </div>
        <p class="panel-note">Syllabus-Based Review and Bar Exam Simulation content comes from the immutable version saved with that attempt. Bar Question Practice content is matched by question ID to the current published Question Bank. Reference links shown with a saved result are listed first when available.</p>
        ${table(['Name', 'Email', 'Access record', 'Feature', 'Subject or exam', 'Question', 'Student answer', 'Score', 'Suggested answer', 'Model answer', 'Reference links', 'Submitted'], rows)}
        <div class="pagination-bar">
          <p class="panel-note">Up to 100 records per page.</p>
          <div class="row-actions">
            <button class="secondary-button" id="answers-previous" type="button"${state.answerOffset > 0 ? '' : ' disabled'}>Previous</button>
            <button class="secondary-button" id="answers-next" type="button"${data.hasMore ? '' : ' disabled'}>Next</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <h3>Download complete answer history</h3>
        <p class="panel-note">The Google Sheets-compatible file includes exact names and emails plus all stored answer, score, feedback, suggested-answer, and model-answer fields.</p>
        <form class="exam-admin-form" id="answer-history-export-form">
          <div class="panel-grid">
            <label>From date (optional)<input id="answer-history-from" type="date"></label>
            <label>Through date (optional, inclusive)<input id="answer-history-to" type="date"></label>
          </div>
          <label>Reason for downloading<textarea id="answer-history-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="answer-history-confirm" type="checkbox" required> I am authorized to download private student work and will store it securely.</label>
          <button class="primary-button" type="submit">Download all answer records</button>
        </form>
      </section>`;
  }

  async function renderLearning(report) {
    const data = await loadUserDirectory(false, '', 0);
    const studentRows = (data.items || []).filter((row) => (
      !['admin', 'founder_admin', 'super_admin'].includes(String(row.role || '').toLowerCase())
    ));
    const engagement = report.engagement || report.engagementOverview || {};
    const current = report.current?.learning || {};
    return `
      ${heading('Learning Performance', 'Scores use the simulator’s 0–5 scale and one decimal place. Failed, timed-out, blocked, missing, and ungraded requests are not included in averages.')}
      <div class="metric-strip">
        ${metric('Attempt average', current.attempt_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Mastery average', current.mastery_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Median score', current.median_score, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Score sample', current.sample_size)}
        ${metric('Latest-answer sample', current.mastery_sample_size)}
        ${metric('Repeated-question improvement', current.average_improvement, null, (v) => v == null ? 'Not available' : `${Number(v) >= 0 ? '+' : ''}${number(v, 1)}`)}
        ${metric('Questions viewed', current.questions_viewed)}
        ${metric('Successful grades', current.successful_grades)}
        ${metric('Users with grades', engagement.usersWithAnswers)}
      </div>
      ${table(
        ['Name', 'Email', 'Access', 'Average score', 'Questions answered', 'Latest score', 'Last sign-in'],
        studentRows.map((row) => [
          row.display_name || 'Not provided', row.email || 'Not available',
          commercialAccountLabel(row),
          row.average_score == null ? 'Not available' : `${number(row.average_score, 1)} / 5`,
          number(row.answered_question_count),
          row.latest_score == null ? 'Not available' : `${number(row.latest_score, 1)} / 5`,
          dateTime(row.last_sign_in_at),
        ]),
      )}
      <p class="panel-note">This summary shows up to 100 accounts. Use Users for the complete searchable and downloadable list, or Answers for each stored question, response, score, suggested answer, and model answer. Mastery uses the latest successful score for each user and question.</p>`;
  }

  function renderSubjects(report) {
    return `
      ${heading('Question Bank', 'Content counts come from the published Question Bank. The stored count helps Admins confirm that the website is using the expected records.')}
      <div class="metric-strip">
        ${metric('Published subjects', report.inventory?.public_subjects)}
        ${metric('Published questions', report.inventory?.public_question_bank)}
        ${metric('Database subjects', report.inventory?.database_subjects)}
        ${metric('Database questions', report.inventory?.database_questions)}
      </div>
      ${table(
        ['Subject', 'Views', 'Grading starts', 'Successful', 'Failures', 'Average', 'Reliability'],
        (report.subjects || []).map((row) => [
          row.subject, number(row.question_views), number(row.grading_starts),
          number(row.successful_grades), number(row.failures),
          row.attempt_average == null ? 'Not available' : `${number(row.attempt_average, 1)} / 5`,
          row.low_sample ? 'Too few grades for a firm result' : `Based on ${number(row.sample_size)} grades`,
        ]),
      )}
      <p class="panel-note">Early results appear only after five successful grades and should not be treated as final. Corrections never change the live Question Bank automatically.</p>`;
  }

  function renderReliability(report) {
    const reliability = report.current?.reliability || {};
    return `
      ${heading('AI Grading Health', 'Recent grading service records. This is not a guaranteed uptime monitor, and private answers, prompts, passwords, and internal error details are not shown.')}
      <div class="metric-strip">
        ${metric('Grading starts', reliability.grading_started)}
        ${metric('Successes', reliability.grading_success)}
        ${metric('Failures', reliability.grading_failure)}
        ${metric('Timeouts', reliability.grading_timeout)}
        ${metric('Typical grading time', reliability.p50_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
        ${metric('Grading time for the slowest 5%', reliability.p95_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
      </div>
      ${table(
        ['Grading system', 'Successful grades', 'Failures', 'Slowest 5% grading time'],
        (report.models || []).map((row) => [
          row.model, number(row.successful_grades), number(row.failures),
          row.p95_latency_ms == null ? 'Not available' : `${number(row.p95_latency_ms)} ms`,
        ]),
      )}
      <div class="notice">AI grading cost is not yet connected, so no estimate is shown.</div>
      <p class="panel-note">Last successful grade: ${escapeHtml(dateTime(reliability.last_successful_grade))}</p>`;
  }

  function latestPaymentsByUser(payments = []) {
    const result = new Map();
    [...payments]
      .sort((left, right) => new Date(right.submitted_at || 0) - new Date(left.submitted_at || 0))
      .forEach((payment) => {
        if (payment.user_id && !result.has(payment.user_id)) result.set(payment.user_id, payment);
      });
    return result;
  }

  function paidSubscriberState(account = {}, payment = null) {
    const paymentStatus = String(payment?.status || '').toLowerCase();
    const subscriptionStatus = String(account.subscription_status || '').toLowerCase();
    if (paymentStatus === 'approved' || subscriptionStatus === 'active') {
      return { label: 'Paid verified', className: 'ok', rank: 3 };
    }
    if (payment && ['pending', 'needs_information', 'rejected', 'expired'].includes(paymentStatus)) {
      return { label: 'Paid not verified', className: 'warn', rank: 1 };
    }
    return { label: 'Paid', className: 'paid', rank: 2 };
  }

  function paidSubscriberAccessState(account = {}, payment = null) {
    const now = Date.now();
    const expiryValue = account.subscription_expires_at || payment?.provisional_access_expires_at || null;
    const expiry = expiryValue ? new Date(expiryValue).getTime() : 0;
    const subscriptionStatus = String(account.subscription_status || '').toLowerCase();
    const paymentStatus = String(payment?.status || '').toLowerCase();
    if (expiry && expiry <= now) return { label: 'Expired', className: 'danger' };
    if (subscriptionStatus === 'active') return { label: 'Active', className: 'ok' };
    if (paymentStatus === 'approved') return { label: 'Verified · activation pending', className: 'warn' };
    if (paymentStatus === 'rejected') return { label: 'Verification rejected', className: 'danger' };
    if (paymentStatus === 'needs_information') return { label: 'Needs information', className: 'warn' };
    if (paymentStatus === 'pending') return { label: 'Verification pending', className: 'warn' };
    return { label: humanizeAuditValue(subscriptionStatus || paymentStatus || 'recorded'), className: 'muted' };
  }

  function paidSubscriberExpiry(account = {}, payment = null) {
    return account.subscription_expires_at || payment?.provisional_access_expires_at || null;
  }

  function paidSubscriberExpiryAlert(expiryValue) {
    if (!expiryValue) return { label: 'No expiry recorded', className: 'muted', rank: 0 };
    const remaining = new Date(expiryValue).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return { label: 'Invalid expiry', className: 'danger', rank: 3 };
    if (remaining <= 0) return { label: '! Expired', className: 'danger', rank: 4 };
    if (remaining <= 5 * 86_400_000) {
      const days = Math.max(1, Math.ceil(remaining / 86_400_000));
      return { label: `! Expires in ${days} day${days === 1 ? '' : 's'}`, className: 'warn', rank: 2 };
    }
    return { label: 'Current', className: 'ok', rank: 1 };
  }

  function paidSubscriberRecords(accounts = [], payments = []) {
    const paymentByUser = latestPaymentsByUser(payments);
    return accounts
      .map((account) => ({ account, payment: paymentByUser.get(account.id) || null }))
      .filter(({ account, payment }) => {
        const plan = String(account.subscription_plan || '').toLowerCase();
        const source = String(account.subscription_source || '').toLowerCase();
        return Boolean(payment)
          || ['early_access_beta', 'standard', 'premium'].includes(plan)
          || /paid|payment|manual/.test(source);
      })
      .sort((left, right) => {
        const rightDate = right.payment?.submitted_at || right.account.subscription_starts_at || 0;
        const leftDate = left.payment?.submitted_at || left.account.subscription_starts_at || 0;
        return new Date(rightDate) - new Date(leftDate);
      });
  }

  async function renderPaidSubscribers() {
    const [directory, payments] = await Promise.all([
      loadAllUserDirectory(false, state.paidSubscriberSearch),
      loadAllPhase4Operational('payments'),
    ]);
    const records = paidSubscriberRecords(directory.items || [], payments.items || []);
    state.paidSubscriberRows = records;
    const verified = records.filter(({ account, payment }) => paidSubscriberState(account, payment).label === 'Paid verified');
    const notVerified = records.filter(({ account, payment }) => paidSubscriberState(account, payment).label === 'Paid not verified');
    const expiring = records.filter(({ account, payment }) => paidSubscriberExpiryAlert(paidSubscriberExpiry(account, payment)).rank >= 2);
    const rows = records.map(({ account, payment }) => {
      const paidState = paidSubscriberState(account, payment);
      const accessState = paidSubscriberAccessState(account, payment);
      const expiry = paidSubscriberExpiry(account, payment);
      const expiryAlert = paidSubscriberExpiryAlert(expiry);
      return [
        { html: true, value: `<strong>${escapeHtml(account.display_name || 'Not provided')}</strong><br><small>${escapeHtml(account.school || 'School not provided')}</small>`, sortValue: account.display_name || '' },
        account.email || 'Not available',
        commercialPlanLabel(account.subscription_plan || payment?.plan_code),
        { html: true, value: `<span class="status ${paidState.className}">${escapeHtml(paidState.label)}</span>`, sortValue: paidState.rank },
        { html: true, value: `<span class="status ${accessState.className}">${escapeHtml(accessState.label)}</span>`, sortValue: accessState.label },
        payment ? `₱${number(payment.trusted_amount_php, 2)}` : 'Historical paid record',
        { html: true, value: dateTime(payment?.submitted_at || account.subscription_starts_at), sortValue: payment?.submitted_at || account.subscription_starts_at || '' },
        { html: true, value: dateTime(account.subscription_starts_at || payment?.submitted_at), sortValue: account.subscription_starts_at || payment?.submitted_at || '' },
        { html: true, value: dateTime(expiry), sortValue: expiry || '' },
        { html: true, value: `<span class="status ${expiryAlert.className}">${escapeHtml(expiryAlert.label)}</span>`, sortValue: expiryAlert.rank },
        { html: true, value: dateTime(account.last_sign_in_at), sortValue: account.last_sign_in_at || '' },
      ];
    });
    return `
      ${heading('Paid Subscribers', 'A dedicated commercial ledger for paid records, verification state, active access, and entitlement expiry.')}
      <div class="observatory-kpis paid-subscriber-kpis">
        ${observatoryKpi('Paid records', number(records.length), 'ph-credit-card', 'cyan', 'Current and preserved paid records')}
        ${observatoryKpi('Paid verified', number(verified.length), 'ph-seal-check', 'green', 'Approved payment or active paid access')}
        ${observatoryKpi('Paid not verified', number(notVerified.length), 'ph-hourglass', 'gold', 'Pending, rejected, or needs information')}
        ${observatoryKpi('Expiry attention', number(expiring.length), 'ph-warning-circle', expiring.length ? 'red' : 'green', 'Expired or within five days')}
      </div>
      <section class="observatory-card commercial-ledger">
        <div class="card-head"><div><h3>Subscriber ledger</h3><p>Newest paid record first. Select any column heading to sort.</p></div></div>
        <div class="table-tools">
          <input id="paid-subscriber-search" type="search" value="${escapeHtml(state.paidSubscriberSearch)}" placeholder="Search name, school, or email" aria-label="Search paid subscribers">
          <button class="secondary-button" id="paid-subscriber-search-button" type="button">Search</button>
          <button class="secondary-button" id="download-paid-subscribers" type="button"><i class="ph ph-download-simple" aria-hidden="true"></i>Download ledger</button>
        </div>
        ${table(['Name', 'Email', 'Plan', 'Payment state', 'Access state', 'Amount', 'Payment recorded', 'Access starts', 'Access expires', 'Attention', 'Last sign-in'], rows)}
        ${directory.truncated || payments.truncated ? '<div class="notice danger">The protected result exceeded 5,000 records. Narrow the search before relying on this view.</div>' : ''}
      </section>`;
  }

  async function renderSubscriptions(report) {
    const [directory, introductoryAccess] = await Promise.all([
      loadUserDirectory(false, state.subscriptionSearch, state.subscriptionOffset),
      loadPhase4Operational('introductory_access', false, state.subscriptionSearch, state.subscriptionOffset)
        .catch(() => ({ items: [] })),
    ]);
    const betaAllAccess = report.betaAllAccess || {};
    const globalBetaKnown = typeof betaAllAccess.enabled === 'boolean';
    const globalBetaEnabled = betaAllAccess.enabled === true;
    const subscriptionCounts = report.engagement?.subscriptionCounts
      || report.engagementOverview?.subscriptionCounts
      || {};
    state.subscriptionRows.clear();
    const accounts = directory.items || [];
    const commercialLabels = accounts.map((account) => commercialAccountLabel(account));
    const tokenByUser = new Map((introductoryAccess.items || []).map((row) => [row.user_id, row]));
    const commercialCounts = commercialLabels.reduce((totals, label) => {
      totals[label] = (totals[label] || 0) + 1;
      return totals;
    }, {});
    state.subscriptionExportRows = accounts;
    const rows = accounts.map((account) => {
      const actionRow = Object.freeze({
        user_id: account.id,
        display_name: account.display_name,
        subscription_id: account.subscription_id || null,
        plan_code: account.subscription_plan || null,
        subscription_status: account.subscription_status || null,
        subscription_source: account.subscription_source || null,
        starts_at: account.subscription_starts_at || null,
        expires_at: account.subscription_expires_at || null,
        trial_expires_at: account.trial_expires_at || null,
        free_beta_enabled: Boolean(account.free_beta_enabled),
        free_beta_expires_at: account.free_beta_expires_at || null,
      });
      state.subscriptionRows.set(account.id, actionRow);
      const token = tokenByUser.get(account.id);
      const tokenCopy = token?.introductory_token_limit == null
        ? 'Not granted'
        : `${number(token.introductory_tokens_remaining)} of ${number(token.introductory_token_limit)} remaining`;
      return [
        account.display_name || 'Not provided',
        { html: true, value: `<strong>${escapeHtml(account.email || 'Not available')}</strong><br><small>${escapeHtml(tokenCopy)}</small>` },
        account.subscription_category || 'User',
        commercialPlanLabel(account.subscription_plan),
        account.subscription_status ? humanizeAuditValue(account.subscription_status) : 'No paid record',
        globalBetaEnabled ? 'Temporary safety access' : commercialAccountLabel(account),
        dateTime(account.last_sign_in_at),
        number(account.answered_question_count),
        globalBetaEnabled ? 'Temporary override' : (account.subscription_expires_at ? dateTime(account.subscription_expires_at) : 'Daily reset'),
        {
          html: true,
          value: `<div class="row-actions" data-subscription-actions-for="${escapeHtml(account.id)}" aria-label="Subscription actions for ${escapeHtml(account.display_name || account.email || account.id)}"></div>`,
        },
      ];
    });
    const pageStart = Number(directory.offset ?? state.subscriptionOffset) + (rows.length ? 1 : 0);
    const pageEnd = Number(directory.offset ?? state.subscriptionOffset) + rows.length;
    const canGoBack = state.subscriptionOffset > 0;
    const canGoForward = pageEnd < Number(directory.total || 0);
    return `
      ${heading('Subscriptions', 'Review each account’s commercial state and remaining introductory tokens. Access changes require a reason and are recorded.')}
      <div class="notice ${globalBetaKnown && globalBetaEnabled ? 'danger' : ''}"><strong>Launch safety access is ${!globalBetaKnown ? 'not confirmed' : globalBetaEnabled ? 'enabled' : 'disabled'}.</strong> ${!globalBetaKnown
        ? 'Refresh before making any access decision.'
        : globalBetaEnabled
        ? 'Every signed-in user temporarily bypasses commercial limits until an authorized founder activates commercial enforcement.'
        : 'Introductory-token, Founding Beta, provisional, and verified Early Access records determine access.'}</div>
      <div class="metric-strip">
        ${summaryMetric('Admin & Staff', number(subscriptionCounts['Admin & Staff'] || 0))}
        ${summaryMetric('Founding Beta', number(commercialCounts['Founding Beta'] || 0))}
        ${summaryMetric('Introductory access', number(commercialCounts['Introductory access'] || commercialCounts.Free || 0))}
        ${summaryMetric('Early Access — pending', number(commercialCounts['Early Access — pending'] || 0))}
        ${summaryMetric('Early Access — verified', number(commercialCounts['Early Access — verified'] || 0))}
        ${summaryMetric('Early Access — rejected', number(commercialCounts['Early Access — rejected'] || 0))}
        ${summaryMetric('Expired', number(commercialCounts.Expired || 0))}
      </div>
      <div class="table-tools">
        <input id="subscription-search" type="search" value="${escapeHtml(state.subscriptionSearch)}" placeholder="Search name, school, or email" aria-label="Search subscriptions">
        <button class="secondary-button" id="subscription-search-button" type="button">Search</button>
        <button class="secondary-button" id="download-subscriptions" type="button">Download subscriptions</button>
      </div>
      ${table(['Name', 'Email & tokens', 'Category', 'Plan record', 'Record status', 'Current access', 'Last sign-in', 'Questions answered', 'Resets or expires', 'Actions'], rows)}
      <div class="pagination-bar">
        <p class="panel-note">Showing ${number(pageStart)}–${number(pageEnd)} of ${number(directory.total)} matching account(s).</p>
        <div class="row-actions">
          <button class="secondary-button" id="subscriptions-previous" type="button"${canGoBack ? '' : ' disabled'}>Previous</button>
          <button class="secondary-button" id="subscriptions-next" type="button"${canGoForward ? '' : ' disabled'}>Next</button>
        </div>
      </div>
      <details class="panel record-detail">
        <summary>Show legacy access records</summary>
        <p class="panel-note">Historical trial and plan records remain preserved for audit and recovery. They are not offered for new purchase.</p>
        ${table(
          ['Name', 'Historical trial end', 'Founding-program record', 'Source', 'Historical status'],
          accounts.map((account) => [
            account.display_name || 'Not provided',
            dateTime(account.trial_expires_at),
            account.free_beta_enabled ? `Enabled${account.free_beta_expires_at ? ` until ${dateTime(account.free_beta_expires_at)}` : ''}` : 'Not enabled',
            account.subscription_source || 'Not available',
            account.subscription_status ? humanizeAuditValue(account.subscription_status) : 'None',
          ]),
        )}
      </details>
      <section class="panel">
        <h3>Commercial access options</h3>
        ${table(['Access', 'Price', 'Availability'], [
          ['Early Access', '₱149 promotional', 'Next manual renewal: October 1, 2026 at ₱199 · no automatic charge'],
        ])}
      </section>
      <section class="panel"><h3>Refund policy</h3><p class="panel-note">Eligible Early Access requests must be filed within seven calendar days of first provisional or paid access. The server calculates the unused-time amount through October 1, capped at ₱149; administrator review and manual payment confirmation are required.</p></section>`;
  }

  async function renderPayments() {
    const [data, proofAudit, directory] = await Promise.all([
      loadPhase4Operational('payments'),
      loadOperational('security', true).then((security) => (
        (security.items || [])
          .filter((row) => row.action_type === 'sensitive_data_viewed'
            && row.target_resource_type === 'payment_proof')
          .slice(0, 20)
      )).catch(() => []),
      loadAllUserDirectory().catch(() => ({ items: [] })),
    ]);
    const directoryById = new Map((directory.items || []).map((account) => [String(account.id), account]));
    return `
      ${heading('Payments', 'Review ₱149 Early Access requests. Private proofs open for five minutes, and every view is recorded in the activity log.')}
      <div class="notice danger"><strong>Money and access warning.</strong> Approval verifies the current Early Access term. The next manual renewal date is October 1, 2026 at ₱199. Confirm the student, amount, channel, reference, date, and private proof before proceeding.</div>
      ${table(
        ['Student', 'Amount & channel', 'Reference', 'Verification', 'Reviewed by', 'Verifier email', 'Proof', 'Submitted', 'Actions'],
        (data.items || []).map((row) => {
          const notification = paymentNotificationLabel(row);
          const studentDetails = [row.email, row.school, row.year_level].filter(Boolean);
          const proofDetails = [row.proof_original_name, row.proof_mime_type,
            row.proof_size_bytes ? `${Math.ceil(Number(row.proof_size_bytes) / 1024)} KiB` : '']
            .filter(Boolean);
          return [
            { html: true, value: `<strong>${escapeHtml(row.display_name || 'Not provided')}</strong>${studentDetails.length ? `<br><small>${escapeHtml(studentDetails.join(' · '))}</small>` : ''}` },
            { html: true, value: `<strong>₱${number(row.trusted_amount_php,2)}</strong><br><small>${escapeHtml(row.payment_method || 'Not provided')} · ${escapeHtml(row.payment_date || 'No date')}</small>` },
            row.transaction_reference,
            { html: true, value: `<span class="status ${row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'danger' : 'warn'}">${escapeHtml(commercialPaymentLabel(row.status))}</span>${row.provisional_access_expires_at ? `<br><small>Provisional until ${escapeHtml(dateTime(row.provisional_access_expires_at))}</small>` : ''}` },
            row.reviewed_by ? administratorIdentity(row.reviewed_by, directoryById) : 'Pending review',
            { html: true, value: `<span class="status ${notification.className}">${escapeHtml(notification.text)}</span>${row.verification_email_last_attempt_at ? `<br><small>${escapeHtml(dateTime(row.verification_email_last_attempt_at))}</small>` : ''}` },
            proofDetails.join(' · ') || 'Not available',
            dateTime(row.submitted_at),
            {
              html: true,
              value: `<div class="row-actions">
                ${['pending', 'needs_information'].includes(row.status) ? actionButton('Approve subscription', 'payment_review', row.id, {
                  status: row.status,
                  planCode: row.plan_code,
                  approvalOnly: true,
                }).value : ''}
                ${actionButton('View private proof', 'view_payment_proof', row.id, {
                  studentName: row.display_name || 'Not provided',
                  studentEmail: row.email || 'Not available',
                  amountPhp: row.trusted_amount_php,
                  paymentMethod: row.payment_method || 'Not provided',
                  paymentDate: row.payment_date || 'Not provided',
                  transactionReference: row.transaction_reference || 'Not provided',
                  proofOriginalName: row.proof_original_name || 'Not available',
                  proofMimeType: row.proof_mime_type || 'Not available',
                  proofSizeBytes: row.proof_size_bytes || null,
                  submittedAt: row.submitted_at || null,
                }).value}
              </div>`,
            },
          ];
        }),
      )}
      <section class="panel">
        <h3>Private proof access log</h3>
        <p class="panel-note">Every private-proof view is recorded here and in Security &amp; Activity Log. Payment history also keeps the same reason.</p>
        ${table(
          ['Viewed', 'Administrator', 'Payment request', 'Reason'],
          proofAudit.map((row) => [
            dateTime(row.occurred_at),
            administratorIdentity(row.actor_user_id, directoryById),
            row.target_resource_id || 'Not available',
            row.reason || 'Not provided',
          ]),
        )}
      </section>`;
  }

  async function renderRefunds() {
    const data = await loadPhase4Operational('refunds');
    return `
      ${heading('Refunds', 'Apply the published Philippine-peso policy and record payment, usage, and outage details before deciding.')}
      ${table(
        ['Student', 'Paid', 'Suggested', 'Approved', 'Status', 'Calculation', 'Submitted', 'Action'],
        (data.items || []).map((row) => [
          row.display_name || row.user_id, `₱${number(row.paid_amount_php,2)}`,
          `₱${number(row.suggested_refund_php,2)}`,
          row.approved_refund_php == null ? 'Pending decision' : `₱${number(row.approved_refund_php,2)}`,
          humanizeAuditValue(row.status), row.calculation_note, dateTime(row.submitted_at),
          actionButton('Review', 'refund_review', row.id, {
            status: row.status,
            suggestedRefundPhp: row.suggested_refund_php,
            approvedRefundPhp: row.approved_refund_php,
          }),
        ]),
      )}`;
  }

  async function renderSupport() {
    const [support, recovery] = await Promise.all([
      loadOperational('support'),
      has('account_recovery_admin') ? loadOperational('recovery') : Promise.resolve({ items: [], total: 0 }),
    ]);
    const supportRows = (support.items || []).map((row) => [
      humanizeAuditValue(row.category), row.message, humanizeAuditValue(row.priority),
      { html: true, value: `<span class="status ${row.overdue_24h ? 'danger' : 'warn'}">${escapeHtml(humanizeAuditValue(row.status))}</span>` },
      dateTime(row.created_at), row.overdue_24h ? 'Overdue' : 'Within target',
      actionButton('Update', 'support_update', row.id, { status: row.status, priority: row.priority }),
    ]);
    return `
      ${heading('Support', 'Resolve only what is necessary. Support messages may contain personal information and are limited to approved administrators.')}
      <div class="notice"><strong>Public recovery copy:</strong> Contact Support. We respond within 24 hours.</div>
      ${table(['Category', 'Message', 'Priority', 'Status', 'Created', '24-hour target', 'Action'], supportRows)}
      <section class="panel">
        <h3>Account help cases</h3>
        <div class="notice danger">Final account transfer is disabled because the current Google sign-in handoff has not been proven safe.</div>
        ${table(
          ['Case', 'Account ID', 'Status', 'Updated', 'Transfer'],
          (recovery.items || []).map((row) => [
            row.id, row.user_id, humanizeAuditValue(row.status), dateTime(row.updated_at), 'Disabled',
          ]),
        )}
        <p class="panel-note">A Support request alone never authorizes an account transfer. The original user account is preserved, and no final transfer action is available.</p>
      </section>`;
  }

  async function renderCorrections() {
    const data = await loadOperational('corrections');
    const rows = (data.items || []).map((row) => [
      row.question_bank_id, row.subject, humanizeAuditValue(row.correction_type),
      row.proposed_correction, row.explanation,
      {
        html: true,
        value: (row.source_urls || []).map((url) => {
          try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) return '';
            return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">Source</a>`;
          } catch { return ''; }
        }).join(' · ') || 'None supplied',
      },
      humanizeAuditValue(row.status),
      actionButton('Review', 'correction_review', row.id, { status: row.status }),
    ]);
    return `
      ${heading('Answer Corrections', 'Accept or reject is an editorial decision only. It never modifies live questions or suggested answers automatically.')}
      ${table(['Question', 'Subject', 'Type', 'Proposed correction', 'Explanation', 'Sources', 'Status', 'Action'], rows)}`;
  }

  async function renderPartnerships() {
    const data = await loadPhase4Operational('partnerships');
    return `
      ${heading('Partnerships', 'Review institutional, academic, content, technology, and media inquiries. Contact details are private, and access is recorded in the activity log.')}
      ${table(
        ['Type','Contact','Email','Organization','Message','Verified','Status','Assignee','Created','Action'],
        (data.items || []).map((row) => [
          humanizeAuditValue(row.inquiry_type), row.contact_name, row.contact_email,
          row.organization || 'Not provided', row.message,
          row.contact_verified ? 'Yes' : 'No', humanizeAuditValue(row.status),
          row.assignee_user_id || 'Unassigned', dateTime(row.created_at),
          actionButton('Update', 'partnership_update', row.id, {
            status: row.status,
            contactVerified: row.contact_verified,
            assigneeUserId: row.assignee_user_id,
          }),
        ]),
      )}`;
  }

  async function renderControls() {
    const data = await loadOperational('controls');
    const allowed = [
      ['announcement_text', 'Announcement text'],
      ['beta_label', 'Beta label'],
      ['support_availability_message', 'Support availability message'],
      ['pricing_section_visible', 'Pricing-section visibility'],
      ['promotional_content_visible', 'Approved promotional content visibility'],
      ['future_feature_status', 'Future-feature status'],
    ];
    return `
      ${heading('Website Settings', 'Only the settings shown below can be changed here. Code, passwords, grading instructions, security settings, and free-use limits cannot be edited here.')}
      ${table(
        ['Control', 'Current value', 'Published', 'Updated', 'Action'],
        allowed.map(([key, label]) => {
          const item = (data.items || []).find((row) => row.control_key === key);
          return [
            label, item ? JSON.stringify(item.value) : 'Not configured',
            item?.is_published ? 'Yes' : 'No', dateTime(item?.updated_at),
            actionButton('Configure', 'website_control_update', '', {
              control_key: key,
              value: item?.value || {},
              is_published: Boolean(item?.is_published),
            }),
          ];
        }),
      )}
      <details class="panel record-detail"><summary>Future Admin tools</summary><p class="panel-note">Prepared, but not active: automated payments, renewals, coaching schedules, organizations, institution dashboards, notifications, content publishing, experiments, daily summaries, and return-visit reporting.</p></details>`;
  }

  async function renderSecurity() {
    const [data, directory] = await Promise.all([
      loadOperational('security'),
      loadAllUserDirectory().catch(() => ({ items: [] })),
    ]);
    const directoryById = new Map((directory.items || []).map((account) => [String(account.id), account]));
    return `
      ${heading('Security & Activity Log', 'Only the Super Admin may choose who can use each Admin area. Admins cannot give themselves more access or create another Super Admin.')}
      <div class="notice">Wally remains the sole Super Admin. Founder Admin access is assigned to verified accounts; an email address written into website code does not grant founder access.</div>
      ${table(
        ['Time', 'Action', 'Actor', 'Record type', 'Record', 'Reason'],
        (data.items || []).map((row) => [
          dateTime(row.occurred_at), humanizeAuditValue(row.action_type),
          administratorIdentity(row.actor_user_id, directoryById),
          humanizeAuditValue(row.target_resource_type), auditTargetLabel(row),
          row.reason || 'Not provided',
        ]),
      )}
      <section class="panel"><h3>Admin permissions</h3><p class="panel-note">Founder and Super Admins receive full access to this dashboard. Other Admin accounts receive only the specific permissions assigned to them, and those permissions can be removed.</p></section>`;
  }

  function forumActionButtons(row) {
    const actions = [];
    const addAction = (label, action, target, payload = {}) => {
      const control = actionButton(label, action, target, payload).value;
      actions.push(control.replace(/^<span class="row-actions">|<\/span>$/g, ''));
    };
    if (row.contentStatus === 'visible') {
      addAction('Hide', 'forum_hide_content', row.id);
    } else {
      addAction('Restore', 'forum_restore_content', row.id);
    }
    if (row.contentStatus !== 'removed') {
      addAction('Remove', 'forum_remove_content', row.id);
    }
    if (row.status === 'pending') {
      addAction('Dismiss report', 'forum_dismiss_report', row.id);
    }
    addAction('Restrict author', 'forum_restrict_user', row.id, {
      durationHours: 24,
    });
    return { html: true, value: `<span class="row-actions">${actions.join('')}</span>` };
  }

  async function renderForumModeration() {
    const data = await loadForumModeration();
    const reportRows = (data.reports || []).map((row) => [
      dateTime(row.createdAt),
      row.targetType,
      row.category,
      row.explanation || 'No explanation supplied',
      row.content || 'Content is unavailable',
      `${row.author?.displayName || 'Due Diligence Member'}${row.author?.school ? ` · ${row.author.school}` : ''}`,
      row.contentStatus || 'Unavailable',
      row.status,
      forumActionButtons(row),
    ]);
    const restrictionRows = (data.restrictions || []).map((row) => [
      `${row.displayName || 'Due Diligence Member'}${row.school ? ` · ${row.school}` : ''}`,
      row.reason,
      dateTime(row.restrictedUntil),
      actionButton('Remove restriction', 'forum_remove_restriction', row.id),
    ]);
    return `
      ${heading('Community', 'Founder and Super Admin review only. Reports never reveal the reporting member, and post management never changes subscriptions or examination records.')}
      <div class="notice"><strong>Community safeguards:</strong> Plain-text publishing, source-link checks, rate limits, duplicate controls, private reporting, posting restrictions, and recorded moderation are active.</div>
      <section class="panel">
        <h3>Reported posts and comments</h3>
        ${table(
          ['Reported', 'Type', 'Category', 'Explanation', 'Content', 'Author', 'Content state', 'Report state', 'Actions'],
          reportRows,
        )}
      </section>
      <section class="panel">
        <h3>Active posting restrictions</h3>
        ${table(['Member', 'Reason', 'Restricted until', 'Action'], restrictionRows)}
      </section>`;
  }

  function quorumModerationActions(row) {
    const actions = [];
    const add = (label, action, target, payload = {}) => {
      const html = actionButton(label, action, target, payload).value;
      actions.push(html.replace(/^<span class="row-actions">|<\/span>$/g, ''));
    };
    const suffix = row.targetType === 'entry'
      ? 'entry'
      : row.targetType === 'comment' ? 'comment' : 'circle';
    if (['visible', 'active'].includes(row.contentStatus)) {
      add('Hide', `quorum_hide_${suffix}`, row.targetId);
    } else {
      add('Restore', `quorum_restore_${suffix}`, row.targetId);
    }
    if (row.contentStatus !== 'removed') add('Remove', `quorum_remove_${suffix}`, row.targetId);
    if (row.targetType === 'entry') {
      add(
        row.commentsLocked ? 'Unlock comments' : 'Lock comments',
        row.commentsLocked ? 'quorum_unlock_comments' : 'quorum_lock_comments',
        row.targetId,
      );
      add('Citation checked', 'quorum_set_indicator', row.targetId, {
        indicator: 'citation_checked',
        enabled: true,
      });
      add('Community correction', 'quorum_set_indicator', row.targetId, {
        indicator: 'community_correction',
        enabled: true,
      });
      add('Moderator reviewed', 'quorum_set_indicator', row.targetId, {
        indicator: 'moderator_reviewed',
        enabled: true,
      });
    }
    if (row.status === 'pending') add('Dismiss report', 'quorum_dismiss_report', row.reportId);
    if (row.author?.memberId) {
      add('Restrict author', 'quorum_restrict_user', row.author.memberId, { durationHours: 24 });
      add(
        row.author.verifiedAcademicIdentity ? 'Remove verified identity' : 'Verify academic identity',
        row.author.verifiedAcademicIdentity ? 'quorum_unverify_profile' : 'quorum_verify_profile',
        row.author.memberId,
      );
    }
    return { html: true, value: `<span class="row-actions">${actions.join('')}</span>` };
  }

  function quorumPostActions(row) {
    if (row.content_status === 'deleted_by_author') {
      return { html: true, value: '<span class="status">Deleted by author</span>' };
    }
    const actions = [];
    const add = (label, action, payload = {}) => {
      actions.push(actionButton(label, action, row.entry_id, payload).value);
    };
    if (row.content_status === 'visible') add('Hide', 'quorum_hide_entry');
    if (['hidden', 'removed'].includes(row.content_status)) add('Restore', 'quorum_restore_entry');
    if (row.content_status !== 'removed') add('Remove', 'quorum_remove_entry');
    if (!['removed'].includes(row.content_status)) {
      add(row.comments_locked ? 'Unlock comments' : 'Lock comments',
        row.comments_locked ? 'quorum_unlock_comments' : 'quorum_lock_comments');
    }
    return { html: true, value: `<div class="row-actions">${actions.join('')}</div>` };
  }

  async function renderQuorumModeration() {
    const [data, posts] = await Promise.all([
      loadForumModeration(),
      loadQuorumPosts(),
    ]);
    const queue = data.queue || {};
    const analytics = data.analytics || {};
    const values = analytics.metrics || {};
    const definitions = analytics.definitions || {};
    const metricSource = `Community production records; server-generated ${dateTime(analytics.lastUpdatedAt)}`;
    const reportRows = (queue.reports || []).map((row) => [
      dateTime(row.createdAt),
      row.targetType,
      row.category,
      row.explanation || 'No explanation supplied',
      row.content || 'Content is unavailable',
      `${row.author?.displayName || 'Due Diligence Member'}${row.author?.school ? ` · ${row.author.school}` : ''}`,
      row.contentStatus || 'Unavailable',
      row.status,
      quorumModerationActions(row),
    ]);
    const announcementRows = (queue.announcements || []).map((row) => [
      dateTime(row.createdAt),
      row.subject || 'Not classified',
      row.body,
      row.sourceUrl
        ? { html: true, value: `<a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">Review source</a>` }
        : 'No source supplied',
      row.author?.displayName || 'Due Diligence Member',
      {
        html: true,
        value: `<span class="row-actions">
          ${actionButton('Approve', 'quorum_approve_announcement', row.entryId).value}
          ${actionButton('Reject', 'quorum_reject_announcement', row.entryId).value}
        </span>`,
      },
    ]);
    const restrictionRows = (queue.restrictions || []).map((row) => [
      `${row.member?.displayName || 'Due Diligence Member'}${row.member?.school ? ` · ${row.member.school}` : ''}`,
      row.reason,
      dateTime(row.restrictedUntil),
      actionButton('Remove restriction', 'quorum_remove_restriction', row.restrictionId),
    ]);
    const postRows = (posts.items || []).map((row) => [
      dateTime(row.created_at),
      row.author_name || 'Not provided',
      row.author_email || 'Not available',
      row.entry_type || 'Post',
      row.subject || row.category || 'General',
      detailCell(row.body, 'View post'),
      row.content_status || 'Not available',
      number(row.comment_count),
      number(row.report_count),
      quorumPostActions(row),
    ]);
    const postStart = Number(posts.offset || 0) + (postRows.length ? 1 : 0);
    const postEnd = Number(posts.offset || 0) + postRows.length;
    return `
      ${heading('Community', 'Review every post, see the author’s exact email, and remove content when necessary. A member can still delete their own post.')}
      <section class="panel">
        <div class="panel-title-row"><div><h3>All Community posts</h3><p class="panel-note">Showing ${number(postStart)}–${number(postEnd)} of ${number(posts.total)} post(s). Admin actions are recorded.</p></div><button class="secondary-button" id="download-quorum-posts" type="button">Download all matching posts</button></div>
        <div class="table-tools">
          <input id="quorum-post-search" type="search" value="${escapeHtml(state.quorumPostSearch)}" placeholder="Search post, name, or email" aria-label="Search Community posts">
          <select id="quorum-post-status" aria-label="Filter Community posts">
            ${['all', 'visible', 'hidden', 'removed', 'deleted_by_author'].map((status) => `<option value="${status}"${state.quorumPostStatus === status ? ' selected' : ''}>${status === 'all' ? 'All posts' : humanizeAuditValue(status)}</option>`).join('')}
          </select>
          <button class="secondary-button" id="quorum-post-filter" type="button">Apply filter</button>
        </div>
        ${table(['Posted', 'Name', 'Email', 'Type', 'Topic', 'Post', 'Status', 'Comments', 'Reports', 'Actions'], postRows)}
        <div class="pagination-bar"><span></span><div class="row-actions">
          <button class="secondary-button" id="quorum-post-previous" type="button"${state.quorumPostOffset > 0 ? '' : ' disabled'}>Previous</button>
          <button class="secondary-button" id="quorum-post-next" type="button"${posts.hasMore ? '' : ' disabled'}>Next</button>
        </div></div>
      </section>
      <div class="notice"><strong>Reporting period:</strong> ${escapeHtml(dateTime(analytics.from))} to ${escapeHtml(dateTime(analytics.to))}. Updated ${escapeHtml(dateTime(analytics.lastUpdatedAt))}.</div>
      <div class="metric-strip">
        ${metric('Active Community users', values.activeUsers, null, number, { copy: definitions.activeUsers, source: metricSource })}
        ${metric('Posts created', values.entries, null, number, { copy: definitions.entries, source: metricSource })}
        ${metric('Comments & replies', values.commentsReplies, null, number, { copy: definitions.commentsReplies, source: metricSource })}
        ${metric('Affirm reactions', values.helpful, null, number, { copy: definitions.helpful, source: metricSource })}
        ${metric('Disseminations', values.citations, null, number, { copy: definitions.citations, source: metricSource })}
        ${metric('Saved authorities', values.saves, null, number, { copy: definitions.saves, source: metricSource })}
        ${metric('Study Circles', values.circles, null, number, { copy: definitions.circles, source: metricSource })}
        ${metric('Reports', values.reports, null, number, { copy: definitions.reports, source: metricSource })}
        ${metric('Moderation actions', values.moderationActions, null, number, { copy: definitions.moderationActions, source: metricSource })}
        ${metric('Unanswered questions', values.unansweredQuestions, null, number, { copy: definitions.unansweredQuestions, source: metricSource })}
        ${metric('Practice conversions', values.practiceConversions, null, number, { copy: definitions.practiceConversions, source: metricSource })}
        ${metric('Community loading or posting errors', values.failedRequests, null, number, { copy: definitions.failedRequests, source: metricSource })}
      </div>
      <div class="work-grid">
        <section class="panel"><h3>Activity by subject</h3>
          ${(analytics.bySubject || []).length
            ? barList(analytics.bySubject.map((row) => [row.label, row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
        <section class="panel"><h3>Posts by type</h3>
          ${(analytics.byEntryType || []).length
            ? barList(analytics.byEntryType.map((row) => [humanizeAuditValue(row.label), row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
      </div>
      <section class="panel">
        <h3>Reported posts and comments</h3>
        ${table(
          ['Reported', 'Type', 'Category', 'Explanation', 'Content', 'Author', 'Content state', 'Report state', 'Actions'],
          reportRows,
        )}
      </section>
      <section class="panel">
        <h3>Pending school and Bar announcements</h3>
        ${table(['Submitted', 'Subject', 'Announcement', 'Source', 'Author', 'Actions'], announcementRows)}
      </section>
      <section class="panel">
        <h3>Active posting restrictions</h3>
        ${table(['Member', 'Reason', 'Restricted until', 'Action'], restrictionRows)}
      </section>
      <section class="panel">
        <h3>Recent Community activity</h3>
        ${table(
          ['Time', 'Type', 'Record', 'Activity'],
          (analytics.recentActivity || []).map((row) => [
            dateTime(row.occurredAt),
            row.type,
            row.entryId || row.commentId || 'Not available',
            row.label,
          ]),
        )}
      </section>`;
  }

  async function examinationAdmin(operation, payload = {}) {
    const response = await api('/admin/examinations', { operation, ...payload });
    return response.data;
  }

  function examinationReason(form) {
    const reason = String(new FormData(form).get('reason') || '').trim();
    if (reason.length < 5) throw new Error('Provide a reason of at least five characters.');
    return reason;
  }

  function examinationOptions(items, valueKey, labelBuilder) {
    return (items || []).map((item) => `<option value="${escapeHtml(item[valueKey])}">
      ${escapeHtml(labelBuilder(item))}
    </option>`).join('');
  }

  async function renderExaminations(force = false) {
    if (!state.examinationData || force) {
      const [dashboard, audit] = await Promise.all([
        examinationAdmin('dashboard'),
        examinationAdmin('audit', { limit: 50, offset: 0 }),
      ]);
      state.examinationData = { ...dashboard, audit: audit.items || [] };
    }
    const data = state.examinationData;
    const definitions = data.definitions || [];
    const versions = data.versions || [];
    const draftVersions = versions.filter((version) => version.status === 'draft');
    const questions = data.approvedQuestions || [];
    const inventory = data.questionInventory || [];
    const recentAttempts = data.recentAttempts || [];
    const assignments = data.examinerAssignments || [];
    const definitionOptions = examinationOptions(
      definitions.filter((exam) => exam.status !== 'closed'),
      'examId',
      (exam) => `${exam.title} · ${exam.status}`,
    );
    const draftOptions = examinationOptions(
      draftVersions,
      'versionId',
      (version) => `${definitions.find((exam) => exam.examId === version.examId)?.title || version.examId} · ${version.label}`,
    );

    return `${heading(
      'Exams',
      'Create locked exam versions, publish approved questions, control access, and monitor real attempts.',
      '<button class="secondary-button" type="button" data-exam-admin-refresh>Refresh exam data</button>',
    )}
      <div class="metric-grid">
        ${metric('Examination definitions', definitions.length)}
        ${metric('Approved source questions', questions.length)}
        ${metric('Queued AI jobs', data.gradingQueue?.queued || 0)}
        ${metric('Pending human reviews', data.gradingQueue?.humanPending || 0)}
      </div>

      <section class="panel">
        <h3>Publication inventory</h3>
        ${inventory.length ? table(
          ['Subject', 'Approved', 'Pending', 'Total'],
          inventory.map((row) => [row.subject, row.approved, row.pending, row.total]),
        ) : empty('No examination-source questions have been imported.')}
        <p class="panel-note">A complete production Midterm or Final requires twenty unique approved questions. Controlled tests remain visibly labeled and may use fewer.</p>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <h3>Create exam</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_exam">
            <label>Title<input name="title" minlength="3" maxlength="180" required></label>
            <label>Area<select name="track"><option value="per_subject">Syllabus-Based Review</option><option value="bar_feels">Bar Exam Simulation</option></select></label>
            <label>Exam type<select name="assessmentKind"><option value="midterm">Midterm</option><option value="final">Final</option><option value="curated">Curated</option><option value="system_test">System test</option></select></label>
            <label>Subject<input name="subject" maxlength="120"></label>
            <label>Year level<input name="yearLevel" type="number" min="1" max="4"></label>
            <label class="check-row"><input name="testOnly" type="checkbox" checked> Controlled system test</label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Create draft exam</button>
          </form>
        </section>

        <section class="panel">
          <h3>Create locked exam version</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_version">
            <label>Examination<select name="examId" required><option value="">Select…</option>${definitionOptions}</select></label>
            <label>Version label<input name="label" value="Controlled beta v1" required></label>
            <label>Duration in minutes<input name="durationMinutes" type="number" min="1" max="240" value="60" required></label>
            <label>Timer mode<select name="timerMode"><option value="strict">Strict Scrutiny</option><option value="selfPaced">Quantum Meruit</option><option value="none">Summary Judgment</option></select></label>
            <label>Grading route<select name="gradingRoute"><option value="either">AI or Human</option><option value="ai">AI Assessment</option><option value="human">Human Examiner</option><option value="provisional">Provisional only</option></select></label>
            <label>Answer release<select name="answerReleaseRule"><option value="after_ai">After AI finalization</option><option value="after_human">After human finalization</option><option value="manual">Manual</option></select></label>
            <label>Instructions<textarea name="instructions" maxlength="8000">Answer every item using ALAC. Review all answers before final submission.</textarea></label>
            <label>Syllabus topics, one per line<textarea name="syllabus" maxlength="4000"></textarea></label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit" ${definitionOptions ? '' : 'disabled'}>Create version</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Attach approved questions and publish</h3>
        <form class="exam-admin-form exam-admin-question-form" data-exam-admin-form="set_questions">
          <label>Draft version<select name="versionId" required><option value="">Select…</option>${draftOptions}</select></label>
          <fieldset class="question-picker">
            <legend>Approved questions</legend>
            <div class="question-picker-list">
              ${questions.map((question) => `<label class="check-row"><input type="checkbox" name="questionIds" value="${escapeHtml(question.questionId)}">
                <span>${escapeHtml(`${question.sourceQuestionId} · ${question.subject} · ${question.topic || 'Topic not specified'}`)}</span></label>`).join('')}
            </div>
          </fieldset>
          <p class="panel-note">Tap or click each question to include it. The saved order follows the list shown above.</p>
          <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
          <div class="dialog-actions">
            <button class="secondary-button" type="submit" ${draftOptions ? '' : 'disabled'}>Save question order</button>
            <button class="primary-button" type="button" data-exam-admin-publish ${draftOptions ? '' : 'disabled'}>Publish selected draft</button>
          </div>
        </form>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <h3>Availability and status</h3>
          ${definitions.length ? table(
            ['Examination', 'Track', 'Version', 'Attempts', 'Actions'],
            definitions.map((exam) => [
              `${exam.title}${exam.testOnly ? ' · TEST' : ''}`,
              `${exam.track} / ${exam.assessmentKind}`,
              exam.version ? `${exam.version.label} · ${exam.version.questionCount} questions` : 'No active version',
              `${exam.attemptCounts?.active || 0} active · ${exam.attemptCounts?.submitted || 0} submitted`,
              { html: true, value: `<div class="admin-inline-actions">
                <button type="button" data-exam-lifecycle="set_availability" data-exam-id="${escapeHtml(exam.examId)}">Availability</button>
                <button type="button" data-exam-lifecycle="unpublish_exam" data-exam-id="${escapeHtml(exam.examId)}" ${exam.status !== 'published' ? 'disabled' : ''}>Unpublish</button>
                <button type="button" data-exam-lifecycle="close_exam" data-exam-id="${escapeHtml(exam.examId)}" ${exam.status === 'closed' ? 'disabled' : ''}>Close</button>
              </div>` },
            ]),
            true,
          ) : empty('No examination definitions exist.')}
        </section>
        <section class="panel">
          <h3>Exam access by user</h3>
          <form class="exam-admin-form" data-exam-admin-form="set_beta_access">
            <label>Account ID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Enable examination beta</label>
            <label>Expires at (optional)<input name="expiresAt" type="datetime-local"></label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Update examination access</button>
          </form>
          <hr>
          <form class="exam-admin-form" data-exam-admin-form="set_participant">
            <label>Published version<select name="versionId" required><option value="">Select…</option>${examinationOptions(versions.filter((version) => version.status === 'published'), 'versionId', (version) => version.label)}</select></label>
            <label>Account ID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Permit this participant</label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="secondary-button" type="submit">Update participant</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Recent exam attempts and grading status</h3>
        ${recentAttempts.length ? table(
          ['Started', 'Examination', 'Student', 'Status', 'Grading', 'Model answer'],
          recentAttempts.map((attempt) => [
            dateTime(attempt.startedAt),
            `${attempt.title}${attempt.subject ? ` · ${attempt.subject}` : ''}`,
            maskOperationalIdentifier(attempt.userId, 'Student'),
            attempt.status,
            attempt.gradingStatus,
            { html: true, value: `<button type="button" data-exam-release="${escapeHtml(attempt.attemptId)}"
              ${!['submitted', 'expired'].includes(attempt.status) ? 'disabled' : ''}>Release</button>` },
          ]),
          true,
        ) : empty('No examination attempts have been created.')}
      </section>

      <section class="panel">
        <h3>Human examiner assignments</h3>
        ${assignments.length ? table(
          ['Created', 'Assignment', 'Attempt', 'Status', 'Link handoff', 'Expires'],
          assignments.map((item) => [
            dateTime(item.createdAt),
            maskOperationalIdentifier(item.assignmentId),
            maskOperationalIdentifier(item.attemptId),
            item.status,
            item.invitationStatus === 'suppressed'
              ? 'Manual secure link'
              : item.invitationStatus === 'sent'
                ? 'Email sent (historical)'
                : item.invitationStatus,
            dateTime(item.expiresAt),
          ]),
        ) : empty('No human examiner assignments exist.')}
      </section>

      <section class="panel">
        <h3>Exam activity history</h3>
        ${(data.audit || []).length ? table(
          ['Time', 'Action', 'Resource', 'Reason'],
          data.audit.map((item) => [
            dateTime(item.createdAt),
            item.action,
            `${item.resourceType} · ${maskOperationalIdentifier(item.resourceId)}`,
            item.reason,
          ]),
        ) : empty('No examination administration actions have been recorded.')}
      </section>`;
  }

  async function submitExaminationAdminForm(form) {
    const operation = form.dataset.examAdminForm;
    const values = Object.fromEntries(new FormData(form));
    const reason = examinationReason(form);
    const payload = { operation, reason, requestKey: uuidKey() };
    if (operation === 'create_exam') {
      Object.assign(payload, {
        title: values.title,
        track: values.track,
        assessmentKind: values.assessmentKind,
        subject: values.subject,
        yearLevel: values.yearLevel || null,
        testOnly: form.elements.testOnly.checked,
      });
    } else if (operation === 'create_version') {
      Object.assign(payload, {
        examId: values.examId,
        label: values.label,
        durationSeconds: Number(values.durationMinutes) * 60,
        timerMode: values.timerMode,
        gradingRoute: values.gradingRoute,
        answerReleaseRule: values.answerReleaseRule,
        instructions: values.instructions,
        syllabus: String(values.syllabus || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      });
    } else if (operation === 'set_questions') {
      const questionIds = new FormData(form).getAll('questionIds').map(String);
      if (!questionIds.length) throw new Error('Choose at least one approved question.');
      Object.assign(payload, {
        versionId: values.versionId,
        questionIds,
      });
    } else if (operation === 'set_beta_access') {
      Object.assign(payload, {
        userId: values.userId,
        enabled: form.elements.enabled.checked,
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
      });
    } else if (operation === 'set_participant') {
      Object.assign(payload, {
        versionId: values.versionId,
        userId: values.userId,
        enabled: form.elements.enabled.checked,
      });
    }
    await examinationAdmin(operation, payload);
    state.examinationData = null;
    toast('Exam change completed and recorded.');
    await renderSection('examinations');
  }

  function bindExaminationAdmin() {
    $$('[data-exam-admin-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await submitExaminationAdminForm(form);
      } catch (error) {
        toast(error.message || 'The examination action could not be completed.');
        button.disabled = false;
      }
    }));
    $('[data-exam-admin-refresh]')?.addEventListener('click', async () => {
      state.examinationData = null;
      await renderSection('examinations');
    });
    $('[data-exam-admin-publish]')?.addEventListener('click', async () => {
      const form = $('[data-exam-admin-form="set_questions"]');
      const versionId = form?.elements.versionId.value;
      const reason = form?.elements.reason.value.trim();
      if (!versionId || reason.length < 5) {
        toast('Select a draft and provide a reason before publishing.');
        return;
      }
      if (!global.confirm('Publish this locked exam version? Active attempts will use this exact saved version.')) return;
      try {
        await examinationAdmin('publish_version', {
          operation: 'publish_version',
          versionId,
          reason,
          requestKey: uuidKey(),
        });
        state.examinationData = null;
        toast('Examination version published.');
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    });
    $$('[data-exam-lifecycle]').forEach((button) => button.addEventListener('click', async () => {
      const operation = button.dataset.examLifecycle;
      const label = operation.replaceAll('_', ' ');
      const reason = global.prompt(`Reason for ${label}:`, '');
      if (!reason || reason.trim().length < 5) return toast('A reason of at least five characters is required.');
      const payload = {
        operation,
        examId: button.dataset.examId,
        reason: reason.trim(),
        requestKey: uuidKey(),
      };
      if (operation === 'set_availability') {
        const availableFrom = global.prompt('Start date and time (for example, 2026-08-15 09:00; leave blank to start now):', '') || '';
        const availableUntil = global.prompt('End date and time (for example, 2026-08-15 12:00; leave blank for no end):', '') || '';
        payload.availableFrom = availableFrom ? new Date(availableFrom).toISOString() : null;
        payload.availableUntil = availableUntil ? new Date(availableUntil).toISOString() : null;
      } else if (!global.confirm(`Confirm ${label}? This access change is recorded in the activity log.`)) return;
      try {
        await examinationAdmin(operation, payload);
        state.examinationData = null;
        toast(`Examination ${label} completed.`);
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    }));
    $$('[data-exam-release]').forEach((button) => button.addEventListener('click', async () => {
      const reason = global.prompt('Reason for releasing the stored model answers:', '');
      if (!reason || reason.trim().length < 5) return toast('A reason of at least five characters is required.');
      if (!global.confirm('Release model answers to this attempt now? This cannot be hidden from the examinee afterward.')) return;
      try {
        await examinationAdmin('release_model_answers', {
          operation: 'release_model_answers',
          attemptId: button.dataset.examRelease,
          reason: reason.trim(),
          requestKey: uuidKey(),
        });
        state.examinationData = null;
        toast('Model answers released in the application. No automated email is sent.');
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    }));
  }

  function prepareCanvas(canvas) {
    if (!canvas) return null;
    const ratio = Math.min(2, global.devicePixelRatio || 1);
    const width = Math.max(280, Math.floor(canvas.clientWidth || 640));
    const height = Math.max(180, Math.floor(canvas.clientHeight || 230));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function drawGroupedBars(canvas, labels, primary, secondary) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const values = [...primary, ...secondary].map((value) => Math.max(0, Number(value) || 0));
    const maximum = Math.max(1, ...values);
    const left = 42;
    const right = 14;
    const top = 18;
    const bottom = 42;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    context.font = '14px Inter, sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let step = 0; step <= 4; step += 1) {
      const y = top + (plotHeight * step / 4);
      context.strokeStyle = 'rgba(143,162,175,0.16)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = '#c4d0d5';
      context.fillText(number(maximum * (1 - step / 4)), left - 7, y);
    }
    const groupWidth = plotWidth / Math.max(1, labels.length);
    const barWidth = Math.max(5, Math.min(22, groupWidth * 0.27));
    labels.forEach((label, index) => {
      const center = left + groupWidth * index + groupWidth / 2;
      const firstHeight = (Math.max(0, Number(primary[index]) || 0) / maximum) * plotHeight;
      const secondHeight = (Math.max(0, Number(secondary[index]) || 0) / maximum) * plotHeight;
      context.fillStyle = '#d2aa55';
      context.fillRect(center - barWidth - 2, top + plotHeight - firstHeight, barWidth, firstHeight);
      context.fillStyle = '#22c6d8';
      context.fillRect(center + 2, top + plotHeight - secondHeight, barWidth, secondHeight);
      context.fillStyle = '#d5dfe3';
      context.textAlign = 'center';
      context.textBaseline = 'top';
      const shortLabel = String(label).length > 13 ? `${String(label).slice(0, 11)}…` : String(label);
      context.fillText(shortLabel, center, top + plotHeight + 10);
    });
  }

  function drawDonut(canvas, segments, centerLabel = 'SESSIONS') {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const normalized = segments.map((segment) => ({
      label: segment.label,
      value: Math.max(0, Number(segment.value) || 0),
      color: segment.color,
    }));
    const total = normalized.reduce((sum, segment) => sum + segment.value, 0);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const inner = radius * 0.63;
    let angle = -Math.PI / 2;
    const drawable = total > 0 ? normalized : [{ label: 'No data', value: 1, color: '#263946' }];
    const drawableTotal = total > 0 ? total : 1;
    drawable.forEach((segment) => {
      const next = angle + (segment.value / drawableTotal) * Math.PI * 2;
      context.beginPath();
      context.arc(centerX, centerY, radius, angle, next);
      context.arc(centerX, centerY, inner, next, angle, true);
      context.closePath();
      context.fillStyle = segment.color;
      context.fill();
      angle = next;
    });
    context.fillStyle = '#f3f6f7';
    context.font = '700 24px Playfair Display, Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(number(total), centerX, centerY - 6);
    context.fillStyle = '#d5dfe3';
    context.font = '13px Inter, sans-serif';
    context.fillText(total > 0 ? String(centerLabel).toUpperCase() : 'NO DATA', centerX, centerY + 16);
  }

  function drawLineTrend(canvas, labels, values) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const normalized = values.map((value) => Math.max(0, Number(value) || 0));
    const maximum = Math.max(1, ...normalized);
    const left = 38;
    const right = 18;
    const top = 18;
    const bottom = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    context.font = '13px Inter, sans-serif';
    context.textBaseline = 'middle';
    context.textAlign = 'right';
    for (let step = 0; step <= 4; step += 1) {
      const y = top + (plotHeight * step / 4);
      context.strokeStyle = 'rgba(143,162,175,0.14)';
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = '#c4d0d5';
      context.fillText(number(maximum * (1 - step / 4)), left - 7, y);
    }
    const points = normalized.map((value, index) => ({
      x: labels.length <= 1 ? left + plotWidth / 2 : left + (plotWidth * index / (labels.length - 1)),
      y: top + plotHeight - (value / maximum) * plotHeight,
    }));
    const gradient = context.createLinearGradient(0, top, 0, top + plotHeight);
    gradient.addColorStop(0, 'rgba(34,198,216,0.34)');
    gradient.addColorStop(1, 'rgba(34,198,216,0.01)');
    context.beginPath();
    context.moveTo(points[0]?.x || left, top + plotHeight);
    points.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(points.at(-1)?.x || width - right, top + plotHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = '#22c6d8';
    context.lineWidth = 2.5;
    context.stroke();
    points.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, 4, 0, Math.PI * 2);
      context.fillStyle = '#071019';
      context.fill();
      context.strokeStyle = '#79e7f2';
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#d5dfe3';
      context.textAlign = index === 0 ? 'left' : index === points.length - 1 ? 'right' : 'center';
      context.textBaseline = 'top';
      context.fillText(String(labels[index] || ''), point.x, top + plotHeight + 10);
    });
  }

  function drawFunnel(canvas, rows) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const normalized = rows.map((row) => ({ label: row.label, value: Math.max(0, Number(row.value) || 0) }));
    const maximum = Math.max(1, ...normalized.map((row) => row.value));
    const left = 14;
    const right = 14;
    const labelWidth = Math.min(115, width * 0.34);
    const plotLeft = left;
    const plotRight = width - right - labelWidth;
    const center = (plotLeft + plotRight) / 2;
    const rowHeight = (height - 22) / Math.max(1, normalized.length);
    normalized.forEach((row, index) => {
      const ratio = Math.max(0.18, row.value / maximum);
      const nextRatio = Math.max(0.12, normalized[index + 1] ? normalized[index + 1].value / maximum : ratio * 0.7);
      const topWidth = (plotRight - plotLeft) * ratio;
      const bottomWidth = (plotRight - plotLeft) * nextRatio;
      const y = 8 + index * rowHeight;
      context.beginPath();
      context.moveTo(center - topWidth / 2, y);
      context.lineTo(center + topWidth / 2, y);
      context.lineTo(center + bottomWidth / 2, y + rowHeight - 3);
      context.lineTo(center - bottomWidth / 2, y + rowHeight - 3);
      context.closePath();
      context.fillStyle = OBSERVATORY_CHART_COLORS[index % 4];
      context.globalAlpha = 0.88;
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = '#d5dfe3';
      context.font = '13px Inter, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(String(row.label), plotRight + 10, y + rowHeight / 2 - 5);
      context.fillStyle = '#f3f6f7';
      context.font = '700 14px Inter, sans-serif';
      context.fillText(number(row.value), plotRight + 10, y + rowHeight / 2 + 9);
    });
  }

  function drawHorizontalBars(canvas, rows, options = {}) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const normalized = rows.map((row) => ({ label: row.label, value: Math.max(0, Number(row.value) || 0) }));
    const maximum = Math.max(1, ...normalized.map((row) => row.value));
    if (options.stacked) {
      const inset = 5;
      const top = 8;
      const rowHeight = Math.max(44, (height - top * 2) / Math.max(1, normalized.length));
      normalized.forEach((row, index) => {
        const y = top + index * rowHeight;
        const value = options.currency ? `₱${number(row.value, 2)}` : number(row.value);
        context.fillStyle = '#d5dfe3';
        context.font = '600 13px Inter, sans-serif';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(String(row.label), inset, y + 10);
        context.fillStyle = '#f3f6f7';
        context.font = '700 14px Inter, sans-serif';
        context.textAlign = 'right';
        context.fillText(value, width - inset, y + 10);
        const barY = y + 24;
        const trackWidth = width - inset * 2;
        const barWidth = trackWidth * row.value / maximum;
        context.fillStyle = 'rgba(210,170,85,0.13)';
        context.fillRect(inset, barY, trackWidth, Math.max(10, rowHeight * 0.28));
        const gradient = context.createLinearGradient(inset, 0, width - inset, 0);
        gradient.addColorStop(0, options.gold ? '#d2aa55' : '#36b7ca');
        gradient.addColorStop(1, options.gold ? '#f0cd78' : '#6ddbea');
        context.fillStyle = gradient;
        context.fillRect(inset, barY, barWidth, Math.max(10, rowHeight * 0.28));
      });
      return;
    }
    const labelWidth = Math.min(130, width * 0.42);
    const right = 34;
    const top = 10;
    const rowHeight = Math.max(20, (height - top * 2) / Math.max(1, normalized.length));
    normalized.forEach((row, index) => {
      const y = top + index * rowHeight;
      context.fillStyle = '#d5dfe3';
      context.font = '13px Inter, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const short = String(row.label).length > 22 ? `${String(row.label).slice(0, 20)}…` : String(row.label);
      context.fillText(short, 4, y + rowHeight / 2);
      const barX = labelWidth;
      const barWidth = Math.max(0, (width - labelWidth - right) * row.value / maximum);
      context.fillStyle = 'rgba(34,198,216,0.12)';
      context.fillRect(barX, y + rowHeight * 0.25, width - labelWidth - right, rowHeight * 0.5);
      const gradient = context.createLinearGradient(barX, 0, width - right, 0);
      gradient.addColorStop(0, options.gold ? '#d2aa55' : '#36b7ca');
      gradient.addColorStop(1, options.gold ? '#f0cd78' : '#6ddbea');
      context.fillStyle = gradient;
      context.fillRect(barX, y + rowHeight * 0.25, barWidth, rowHeight * 0.5);
      context.fillStyle = '#d5dfe3';
      context.font = '700 13px Inter, sans-serif';
      context.textAlign = 'right';
      const value = options.currency ? `₱${number(row.value, 2)}` : number(row.value);
      context.fillText(value, width - 3, y + rowHeight / 2);
    });
  }

  function acquisitionSourceRows(report) {
    const totals = new Map();
    (report.acquisition || []).forEach((row) => {
      const label = String(row.source || 'Unattributed');
      totals.set(label, (totals.get(label) || 0) + (Number(row.sessions) || 0));
    });
    return [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  }

  function mountObservatoryCharts(section, report) {
    requestAnimationFrame(() => {
      if (section === 'executive') {
        const visual = report.executiveVisuals || {};
        drawLineTrend($('#observatory-activity-chart'), visual.activityLabels || [], visual.activityValues || []);
        drawDonut($('#observatory-user-mix-chart'), visual.subscriptionSegments || [], 'Users');
        drawDonut($('#observatory-device-chart'), visual.deviceSegments || [], 'Sessions');
        drawFunnel($('#observatory-funnel-chart'), visual.funnelRows || []);
        drawHorizontalBars($('#observatory-revenue-chart'), visual.revenueRows || [], { currency: true, gold: true, stacked: true });
        drawHorizontalBars($('#observatory-subject-chart'), visual.subjectRows || []);
      } else if (section === 'marketing') {
        const sources = acquisitionSourceRows(report);
        drawGroupedBars($('#observatory-acquisition-chart'), sources.map(([label]) => label), sources.map(([, value]) => value), sources.map(() => 0));
      } else if (section === 'recent_users') {
        const activity = state.recentUserActivity || {};
        const daily = Array.isArray(activity.dailyActivity) ? activity.dailyActivity : [];
        const stride = Math.max(1, Math.ceil(daily.length / 7));
        drawLineTrend(
          $('#recent-users-duration-chart'),
          daily.map((row, index) => (index % stride === 0 || index === daily.length - 1)
            ? String(row.activity_date || '').slice(5)
            : ''),
          daily.map((row) => Number(row.duration_seconds || 0) / 60),
        );
        drawHorizontalBars(
          $('#recent-users-activity-chart'),
          (activity.activityMix || []).map((row) => ({
            label: recentActivityLabel({ latest_event_type: row.event_type }),
            value: row.event_count,
          })),
        );
      } else if (section === 'business_revenue') {
        drawHorizontalBars(
          $('#business-revenue-status-chart'),
          state.businessRevenueVisuals?.statusRows || [],
          { currency: true, gold: true, stacked: true },
        );
      } else if (section === 'business_comparisons') {
        const visual = state.businessComparisonVisuals || {};
        drawGroupedBars(
          $('#observatory-comparison-chart'),
          visual.performanceLabels || [],
          visual.currentValues || [],
          visual.previousValues || [],
        );
        drawGroupedBars(
          $('#business-device-comparison-chart'),
          visual.deviceLabels || [],
          visual.currentDevices || [],
          visual.previousDevices || [],
        );
      }
    });
  }

  async function renderSection(section) {
    if (!sectionAllowed(section)) {
      toast('Your administrator role does not have access to that section.');
      return false;
    }
    state.section = section;
    const title = titles[section] || 'Administration';
    $('#section-title').innerHTML = `${section === 'executive' ? '<i class="ph ph-wave-sine" aria-hidden="true"></i>' : ''}${escapeHtml(title)}`;
    if ($('#section-subtitle')) {
      $('#section-subtitle').textContent = sectionSubtitles[section] || 'Protected Due Diligence administration.';
    }
    const rangeControl = $('#reporting-range');
    if (rangeControl) {
      rangeControl.hidden = !['executive', 'realtime', 'recent_users', 'acquisition', 'marketing', 'learning', 'subjects', 'reliability', 'forum', 'business_projections', 'business_comparisons'].includes(section);
    }
    $$('#admin-nav button').forEach((button) => button.setAttribute(
      'aria-current',
      button.dataset.section === section ? 'page' : 'false',
    ));
    const additionalTool = $(`.nav-more button[data-section="${section}"]`);
    if (additionalTool) additionalTool.closest('details').open = true;
    setSidebarOpen(false);
    $('#dashboard-view').setAttribute('aria-busy', 'true');
    $('#dashboard-view').innerHTML = '<div class="dashboard-loading" role="status" aria-label="Loading administrator data"><div class="skeleton skeleton-kpis"></div><div class="skeleton skeleton-panels"></div></div>';
    try {
      const reportSections = new Set([
        'executive', 'realtime', 'acquisition', 'marketing', 'learning', 'subjects',
        'reliability', 'subscriptions', 'forum', 'answer_exports',
        'business_projections', 'business_comparisons',
      ]);
      const report = reportSections.has(section) ? await loadReport() : {};
      let html;
      if (section === 'executive') html = await renderExecutive(report);
      else if (section === 'realtime') html = await renderRealtime(report);
      else if (section === 'acquisition') html = renderAcquisition(report);
      else if (section === 'marketing') html = renderMarketing(report);
      else if (section === 'recent_users') html = await renderRecentUsers();
      else if (section === 'users') html = await renderUsers();
      else if (section === 'learning') html = await renderLearning(report);
      else if (section === 'subjects') html = renderSubjects(report);
      else if (section === 'reliability') html = renderReliability(report);
      else if (section === 'subscriptions') html = await renderSubscriptions(report);
      else if (section === 'paid_subscribers') html = await renderPaidSubscribers();
      else if (section === 'payments') html = await renderPayments();
      else if (section === 'refunds') html = await renderRefunds();
      else if (section === 'support') html = await renderSupport();
      else if (section === 'corrections') html = await renderCorrections();
      else if (section === 'partnerships') html = await renderPartnerships();
      else if (section === 'controls') html = await renderControls();
      else if (section === 'security') html = await renderSecurity();
      else if (section === 'forum') html = await renderQuorumModeration();
      else if (section === 'examinations') html = await renderExaminations();
      else if (section === 'examination_room_v1') html = await global.DueDiligenceExaminationRoomAdmin.render();
      else if (section === 'answer_exports') html = await renderAnswerExports(report);
      else if (section === 'business_revenue') html = await renderBusinessRevenue();
      else if (section === 'business_projections') html = await renderBusinessProjections(report);
      else if (section === 'business_comparisons') html = await renderBusinessComparisons(report);
      $('#dashboard-view').innerHTML = html;
      bindDynamic();
      mountObservatoryCharts(section, report);
      if (section === 'examinations') bindExaminationAdmin();
      if (section === 'examination_room_v1') {
        global.DueDiligenceExaminationRoomAdmin.bind({
          root: $('#dashboard-view'),
          toast,
          refresh: () => renderSection('examination_room_v1'),
        });
      }
      return true;
    } catch (error) {
      $('#dashboard-view').innerHTML = heading('Admin dashboard unavailable', error.message || 'Admin data could not be loaded.')
        + empty('Nothing was changed. Refresh after the connection or account permission is restored.');
      return false;
    } finally {
      $('#dashboard-view').removeAttribute('aria-busy');
    }
  }

  function actionField(label, id, value = '', type = 'text') {
    return `<label class="field">${escapeHtml(label)}<input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"></label>`;
  }

  function localDateTimeValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function isoFromLocalInput(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function accessActionPayload(row, descriptor) {
    return {
      operation: descriptor.operation,
      controlLabel: descriptor.label,
      displayName: row.display_name || 'Not provided',
      userId: row.user_id,
      subscriptionId: row.subscription_id || null,
      planCode: row.plan_code || null,
      status: row.subscription_status || null,
      source: row.subscription_source || null,
      startsAt: row.starts_at || null,
      expiresAt: row.expires_at || null,
      freeBetaEnabled: Boolean(row.free_beta_enabled),
      freeBetaExpiresAt: row.free_beta_expires_at || null,
    };
  }

  function mountSubscriptionActions() {
    $$('[data-subscription-actions-for]').forEach((mount) => {
      mount.replaceChildren();
      const row = state.subscriptionRows.get(mount.dataset.subscriptionActionsFor);
      const descriptors = subscriptionActions?.actionsForSubscription(
        row,
        state.authorization?.role,
      ) || [];
      if (!descriptors.length) {
        mount.textContent = 'No permitted actions';
        return;
      }
      const menu = document.createElement('details');
      menu.className = 'action-menu';
      const summary = document.createElement('summary');
      summary.textContent = 'Actions';
      summary.setAttribute(
        'aria-label',
        `Actions for ${row?.display_name || row?.user_id || 'student'}`,
      );
      const popover = document.createElement('div');
      popover.className = 'action-menu-popover';
      popover.setAttribute('role', 'menu');
      for (const descriptor of descriptors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = descriptor.label;
        button.dataset.tone = descriptor.tone;
        button.setAttribute('role', 'menuitem');
        button.addEventListener('click', () => {
          menu.open = false;
          openAction(
            descriptor.action,
            row.user_id,
            accessActionPayload(row, descriptor),
          );
        });
        popover.append(button);
      }
      menu.append(summary, popover);
      mount.append(menu);
    });
  }

  function appendInputField(container, labelText, id, options = {}) {
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.type = options.type || 'text';
    input.value = options.value || '';
    if (options.min != null) input.min = String(options.min);
    if (options.max != null) input.max = String(options.max);
    if (options.required) input.required = true;
    if (options.placeholder) input.placeholder = options.placeholder;
    label.append(input);
    container.append(label);
    return input;
  }

  function selectedPlan() {
    return document.querySelector('input[name="subscription-plan"]:checked')?.value || '';
  }

  function planDisplayName(planCode) {
    return commercialPlanLabel(planCode);
  }

  function proposedAccessDescription(action, payload) {
    const operation = payload.operation;
    if (action === 'free_beta_change') {
      return payload.enabled ? 'Enable Founding Beta access' : 'Disable Founding Beta access';
    }
    if (action === 'discount_assign') {
      const code = $('#action-discount-code')?.value?.trim().toUpperCase();
      return code ? `Apply verified discount code ${code}` : 'Apply a verified active discount code';
    }
    if (action === 'subscription_audit_view') return 'View this student’s recorded access history';
    if (['activate', 'complimentary', 'replace_plan'].includes(operation)) {
      const plan = selectedPlan() || payload.planCode || EARLY_ACCESS_PLAN.id;
      const verb = operation === 'activate' ? 'Activate'
        : operation === 'complimentary' ? 'Grant complimentary'
          : 'Change plan to';
      return `${verb} ${planDisplayName(plan)} · expires ${$('#action-expires')?.value || 'October 1, 2026 at 11:59 PM Philippine time'}`;
    }
    if (operation === 'pause') return 'Suspend the active Subscription';
    if (operation === 'resume') return 'Resume the suspended Subscription';
    if (operation === 'cancel') return 'Revoke the current Subscription';
    if (operation === 'expire') return 'Expire the current Subscription immediately';
    if (operation === 'restore') {
      return `Restore access until ${$('#action-expires')?.value || 'the required selected date'}`;
    }
    if (operation === 'extend') {
      return `Extend access by ${$('#action-days')?.value || 30} day(s)`;
    }
    if (operation === 'set_start_date') {
      return `Change start date to ${$('#action-starts')?.value || 'the selected date'}`;
    }
    if (operation === 'set_expiration_date') {
      return `Change expiration date to ${$('#action-expires')?.value || 'the selected date'}`;
    }
    return 'Apply the selected access change';
  }

  function updateActionContext() {
    if (!state.action || !subscriptionActions?.isAccessAction(state.action.action)) return;
    const payload = state.action.payload;
    $('#action-target').textContent = `${payload.displayName || 'Not provided'} · ${payload.userId || state.action.targetId}`;
    $('#action-current').textContent = `${planDisplayName(payload.planCode)} · ${payload.status || 'no Subscription'}`
      + `${payload.expiresAt ? ` · expires ${dateTime(payload.expiresAt)}` : ''}`;
    $('#action-proposed').textContent = proposedAccessDescription(state.action.action, payload);
  }

  function appendPlanOptions(container, payload) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'plan-options';
    const legend = document.createElement('legend');
    legend.textContent = 'Select the trusted plan';
    fieldset.append(legend);
    const plans = [{
      ...EARLY_ACCESS_PLAN,
      disabled: false,
      durationDays: null,
      statusLabel: 'Active',
      note: 'One-time launch access',
    }];
    const preferred = EARLY_ACCESS_PLAN.id;
    for (const plan of plans) {
      const label = document.createElement('label');
      label.className = `plan-option${plan.disabled ? ' disabled' : ''}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'subscription-plan';
      input.value = plan.id;
      input.disabled = plan.disabled;
      input.checked = !plan.disabled && plan.id === preferred;
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = plan.name;
      const details = document.createElement('small');
      details.textContent = 'One-time access through October 1, 2026 · all examination tracks';
      copy.append(name, details);
      const price = document.createElement('strong');
      price.className = 'plan-price';
      price.textContent = `₱${number(plan.pricePhp, 2)}`;
      label.append(input, copy, price);
      fieldset.append(label);
      input.addEventListener('change', updateActionContext);
    }
    container.append(fieldset);
  }

  function buildAccessActionFields(action, payload) {
    const container = $('#action-fields');
    container.replaceChildren();
    if (action === 'subscription_change') {
      if (['activate', 'complimentary', 'replace_plan'].includes(payload.operation)) {
        appendPlanOptions(container, payload);
        const input = appendInputField(
          container,
          'Early Access expiration (fixed commercial term)',
          'action-expires',
          {
            type: 'datetime-local',
            value: localDateTimeValue(EARLY_ACCESS_PLAN.expiresAt),
            required: true,
          },
        );
        input.readOnly = true;
        input.addEventListener('input', updateActionContext);
      } else if (payload.operation === 'extend') {
        const input = appendInputField(container, 'Extension in calendar days', 'action-days', {
          type: 'number', value: '30', min: 1, max: 366, required: true,
        });
        input.addEventListener('input', updateActionContext);
      } else if (payload.operation === 'set_start_date') {
        const input = appendInputField(container, 'New Subscription start date and time', 'action-starts', {
          type: 'datetime-local', value: localDateTimeValue(payload.startsAt), required: true,
        });
        input.addEventListener('input', updateActionContext);
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        const input = appendInputField(container, 'New Subscription expiration date and time', 'action-expires', {
          type: 'datetime-local', value: localDateTimeValue(payload.expiresAt), required: true,
        });
        input.addEventListener('input', updateActionContext);
      }
    } else if (action === 'free_beta_change') {
      payload.enabled = payload.operation === 'enable';
      if (payload.enabled) {
        appendInputField(container, 'Founding Beta expiration', 'action-expires', {
          type: 'datetime-local', value: localDateTimeValue(payload.freeBetaExpiresAt),
        }).addEventListener('input', updateActionContext);
      }
    } else if (action === 'discount_assign') {
      appendInputField(container, 'Active discount code', 'action-discount-code', {
        required: true, placeholder: 'Example: FOUNDING25',
      }).addEventListener('input', updateActionContext);
    }
  }

  function renderAuditHistory(result, payload) {
    const container = $('#audit-history');
    container.replaceChildren();
    $('#audit-target').textContent = `${payload.displayName || 'Not provided'} · ${payload.userId}`;
    const entries = [
      ...(result?.subscriptionHistory || []).map((entry) => ({
        title: `Subscription · ${entry.action}`,
        time: entry.occurredAt,
        copy: `${entry.planCode || 'No plan'} · ${entry.status || 'unknown'} · ${entry.reason || 'No reason recorded'}`,
      })),
      ...(result?.freeBetaHistory || []).map((entry) => ({
        title: `Founding Beta · ${entry.enabled ? 'enabled' : 'disabled'}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
      ...(result?.discountHistory || []).map((entry) => ({
        title: `Discount · ${entry.code || 'Unknown code'}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
      ...(result?.auditHistory || []).map((entry) => ({
        title: `Administrator audit · ${entry.actionType}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
    ].sort((left, right) => new Date(right.time || 0) - new Date(left.time || 0));
    if (!entries.length) {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty';
      emptyState.textContent = 'No access changes have been recorded for this student.';
      container.append(emptyState);
    }
    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'audit-entry';
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const copy = document.createElement('span');
      copy.textContent = `${dateTime(entry.time)} · ${entry.copy}`;
      article.append(title, copy);
      container.append(article);
    }
    $('#audit-dialog').showModal();
  }

  function openInsight(button) {
    let detail = {};
    try { detail = JSON.parse(button.dataset.insight || '{}'); } catch { detail = {}; }
    $('#insight-title').textContent = detail.label || 'Verified metric detail';
    $('#insight-value').textContent = detail.value || 'Not available';
    $('#insight-copy').textContent = detail.copy
      || 'Verified aggregate for the currently selected reporting period.';
    $('#insight-source').textContent = detail.source
      || 'Due Diligence production analytics aggregate';
    const window = reportingWindow();
    $('#insight-window').textContent = `${dateTime(window.from)} to ${dateTime(window.to)}`;
    $('#insight-generated').textContent = dateTime(state.report?.meta?.generated_at);
    $('#insight-dialog').showModal();
  }

  function closeInsight() {
    const dialog = $('#insight-dialog');
    if (dialog?.open) dialog.close('cancel');
  }

  function setSidebarOpen(open) {
    const sidebar = $('#sidebar');
    const scrim = $('#sidebar-scrim');
    const isMobile = global.matchMedia?.('(max-width: 820px)')?.matches === true;
    const wasOpen = sidebar?.classList.contains('open') === true;
    sidebar?.classList.toggle('open', open);
    $('#menu-button')?.setAttribute('aria-expanded', String(open));
    if (sidebar) {
      sidebar.inert = isMobile && !open;
      sidebar.setAttribute('aria-hidden', String(isMobile && !open));
    }
    if (scrim) scrim.hidden = !open;
    document.body.classList.toggle('admin-nav-open', isMobile && open);
    if (isMobile && open && !wasOpen) {
      global.setTimeout(() => sidebar?.querySelector('button[aria-current="page"]:not([hidden]), button:not([hidden])')?.focus(), 0);
    } else if (isMobile && !open && wasOpen) {
      $('#menu-button')?.focus();
    }
  }

  function cancelActionDialog(options = {}) {
    const dialog = $('#action-dialog');
    if (!dialog?.open) {
      state.action = null;
      return;
    }
    const consumeHistory = options.consumeHistory !== false;
    const historyArmed = history.state?.dueDiligenceAdminAction === true;
    dialog.close('cancel');
    state.action = null;
    state.actionInFlight = false;
    dialog.classList.remove('payment-proof-open');
    const reasonField = $('#action-reason')?.closest('label');
    if (reasonField) reasonField.hidden = false;
    const warning = $('#action-warning');
    if (warning) warning.hidden = false;
    const confirm = $('#action-confirm');
    if (confirm) confirm.hidden = false;
    const cancel = $('#action-dialog-cancel');
    if (cancel) cancel.textContent = 'Back';
    if (confirm) confirm.disabled = false;
    if (consumeHistory && historyArmed) history.back();
  }

  function authorizedPrivateProofUrl(value) {
    const signed = new URL(String(value || ''));
    const supabase = new URL(config.supabase.url);
    if (signed.protocol !== 'https:'
        || signed.origin !== supabase.origin
        || !signed.pathname.startsWith('/storage/v1/object/sign/payment-proofs/')) {
      throw new Error('The secure proof link was invalid. Nothing was opened.');
    }
    return signed.href;
  }

  function privateProofDetail(label, value) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Not available')}</dd></div>`;
  }

  function renderPrivatePaymentProof(response, reason) {
    const proof = response?.proof || {};
    const audit = response?.audit || {};
    const payload = state.action?.payload || {};
    const secureUrl = authorizedPrivateProofUrl(proof.url);
    const mimeType = String(proof.mimeType || payload.proofMimeType || '').toLowerCase();
    const size = Number(proof.sizeBytes ?? payload.proofSizeBytes);
    const sizeLabel = Number.isFinite(size) && size > 0
      ? `${Math.ceil(size / 1024).toLocaleString('en-PH')} KiB`
      : 'Not available';
    const preview = mimeType.startsWith('image/')
      ? `<img class="private-proof-image" src="${escapeHtml(secureUrl)}" alt="Private payment proof submitted by ${escapeHtml(payload.studentName || 'the student')}" referrerpolicy="no-referrer">`
      : mimeType === 'application/pdf'
        ? `<iframe class="private-proof-pdf" src="${escapeHtml(secureUrl)}" title="Private payment proof PDF" referrerpolicy="no-referrer"></iframe>`
        : '<p class="panel-note">This file type cannot be previewed safely in the dashboard.</p>';
    $('#action-title').textContent = 'Private payment proof';
    $('#action-fields').innerHTML = `
      <section class="private-proof-layout" aria-label="Private payment proof review">
        <div class="private-proof-preview">${preview}</div>
        <div class="private-proof-summary">
          <p class="eyebrow">Payment details</p>
          <dl class="private-proof-details">
            ${privateProofDetail('Student', payload.studentName)}
            ${privateProofDetail('Email', payload.studentEmail)}
            ${privateProofDetail('Amount', Number.isFinite(Number(payload.amountPhp)) ? `₱${number(payload.amountPhp, 2)}` : 'Not available')}
            ${privateProofDetail('Method', humanizeAuditValue(payload.paymentMethod))}
            ${privateProofDetail('Payment date', payload.paymentDate)}
            ${privateProofDetail('Reference', payload.transactionReference)}
            ${privateProofDetail('Submitted', dateTime(payload.submittedAt))}
            ${privateProofDetail('File', payload.proofOriginalName)}
            ${privateProofDetail('Type and size', [mimeType || payload.proofMimeType, sizeLabel].filter(Boolean).join(' · '))}
          </dl>
          <div class="private-proof-audit" role="status">
            <strong>Private access recorded</strong>
            <span>${escapeHtml(dateTime(audit.recordedAt))}</span>
            <p><b>Reason:</b> ${escapeHtml(audit.reason || reason)}</p>
            <small>This reason is stored in Payment history and Admin activity. The authorized proof link expires in five minutes.</small>
          </div>
          <a class="secondary-button private-proof-open" href="${escapeHtml(secureUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open full-size proof</a>
        </div>
      </section>`;
    $('#action-dialog').classList.add('payment-proof-open');
    state.action.payload.proofLoaded = true;
    state.action.payload.proofReviewReason = reason;
    const reasonField = $('#action-reason')?.closest('label');
    if (reasonField) reasonField.hidden = true;
    $('#action-warning').textContent = 'Review the image and payment details together. Approval sends the user an electronic receipt with this exact proof attached.';
    $('#action-confirm').hidden = false;
    $('#action-confirm').textContent = 'Approve subscription';
    $('#action-dialog-cancel').textContent = 'Done';
  }

  function openAction(action, targetId, payload) {
    state.action = { action, targetId: targetId || null, payload: { ...(payload || {}) } };
    state.actionInFlight = false;
    $('#action-dialog').classList.remove('payment-proof-open');
    const reasonField = $('#action-reason')?.closest('label');
    if (reasonField) reasonField.hidden = false;
    $('#action-warning').hidden = false;
    $('#action-confirm').hidden = false;
    $('#action-dialog-cancel').textContent = 'Back';
    let fields = '';
    let title = 'Confirm action';
    let warning = 'This change requires a reason and will be recorded in Admin activity.';
    if (action === 'support_update') {
      title = 'Update Support request';
      fields = `<label class="field">Status<select id="action-status">${['pending','in_progress','waiting_for_student','resolved','closed'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field">Priority<select id="action-priority">${['low','normal','high','urgent'].map((value) => `<option${payload.priority === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field">Internal note<textarea id="action-note" maxlength="4000"></textarea></label>`;
    } else if (action === 'correction_review') {
      title = 'Record editorial decision';
      fields = `<label class="field">Status<select id="action-status">${['pending','accepted','rejected'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field">Reviewer note<textarea id="action-note" maxlength="4000"></textarea></label>`;
      warning = 'Accept or reject records an editorial decision only. The live question bank will not change.';
    } else if (action === 'entitlement_change') {
      title = 'Adjust manual access';
      fields = `${actionField('Plan code', 'action-plan', payload.plan_code)}
        <label class="field">Status<select id="action-status">${['active','paused','canceled','expired'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        ${actionField('End date (optional)', 'action-until', '', 'date')}`;
      warning = 'This action changes the student’s access and may affect future billing records. Confirm the requested change and effective dates before continuing.';
    } else if (action === 'payment_review') {
      title = 'Approve subscription';
      fields = payload.approvalOnly === true
        ? '<div class="notice"><strong>Receipt delivery</strong><br>Confirming approves Early Access and sends the subscriber an electronic receipt with the exact reviewed payment proof attached.</div>'
        : `<label class="field">Decision<select id="action-status">
          <option value="approved">Approve Early Access</option>
          <option value="needs_information">Needs information</option>
          <option value="rejected">Reject</option>
        </select></label>`;
      warning = 'Approval activates the verified Early Access term and emails the user a professional electronic receipt with the exact reviewed payment proof attached. No automatic charge or renewal is scheduled.';
    } else if (action === 'view_payment_proof') {
      title = 'View private payment proof';
      fields = `<div class="notice"><strong>Review context</strong><br>${escapeHtml(payload.studentName || 'Not provided')} · ${escapeHtml(payload.transactionReference || 'No reference')} · ${Number.isFinite(Number(payload.amountPhp)) ? `₱${number(payload.amountPhp, 2)}` : 'Amount unavailable'}</div>`;
      warning = 'Enter why access is necessary. The reason is written to Payment history and Admin activity before the private image is displayed.';
    } else if (action === 'refund_review') {
      title = 'Review refund request';
      fields = `<label class="field">Decision<select id="action-status">
        <option value="needs_information">Needs information</option>
        <option value="approved">Approve amount</option>
        <option value="rejected">Reject</option>
        ${payload.status === 'approved' ? '<option value="paid">Mark paid</option>' : ''}
      </select></label>
      ${actionField('Approved refund in PHP', 'action-refund-amount', payload.approvedRefundPhp ?? payload.suggestedRefundPhp ?? '', 'number')}`;
      warning = 'Check the paid amount, payment date, usage, and any outage record. Mark paid only after the money was actually returned.';
    } else if (action === 'subscription_change') {
      const titlesByOperation = {
        activate: 'Activate Subscription',
        complimentary: 'Grant complimentary access',
        pause: 'Pause Subscription',
        resume: 'Resume Subscription',
        cancel: 'Revoke Subscription',
        expire: 'Expire Subscription',
        restore: 'Restore Subscription',
        extend: 'Extend Subscription',
        replace_plan: 'Change plan',
        set_start_date: 'Change Subscription start date',
        set_expiration_date: 'Change Subscription expiration date',
      };
      title = payload.controlLabel === 'Change Plan'
        ? 'Change plan'
        : titlesByOperation[payload.operation] || 'Manage Subscription';
      warning = payload.operation === 'complimentary'
        ? 'This immediately grants access without recording a payment. Confirm the student, trusted plan, and reason.'
        : 'This immediately changes access. Confirm the student, current status, proposed value, and reason before continuing.';
    } else if (action === 'free_beta_change') {
      title = payload.operation === 'enable' ? 'Enable Founding Beta access' : 'Disable Founding Beta access';
      warning = 'Founding Beta is complimentary unlimited access only through September 1, 2026. Confirm the approved account and fixed expiration.';
    } else if (action === 'discount_assign') {
      title = 'Apply verified discount';
      warning = 'Only an active server-verified code can be assigned. The browser cannot choose a discount value or trusted plan price.';
    } else if (action === 'subscription_audit_view') {
      title = 'View Subscription activity history';
      warning = 'Viewing this private history requires a reason and is recorded in Admin activity.';
    } else if (action === 'partnership_update') {
      title = 'Update partnership inquiry';
      fields = `<label class="field">Status<select id="action-status">${['new','reviewing','awaiting_reply','qualified','closed'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field"><span><input id="action-contact-verified" type="checkbox"${payload.contactVerified ? ' checked' : ''}> Contact ownership verified</span></label>
        ${actionField('Assignee account ID (optional)', 'action-assignee', payload.assigneeUserId || '')}`;
      warning = 'Contact verification means ownership was actually checked; do not mark it based only on valid email formatting.';
    } else if (action === 'role_change') {
      title = 'Change administrator role';
      fields = `<label class="field">Role<select id="action-role">
        ${[['student', 'User'], ['admin', 'Admin & Staff'], ['founder_admin', 'Founder Admin']].map(([value, label]) => `<option value="${value}"${payload.role === value ? ' selected' : ''}>${label}</option>`).join('')}
      </select></label>`;
      warning = 'Only the Super Admin may perform this action. Self-promotion, self-demotion, and creation of another Super Admin are prohibited.';
    } else if (action === 'website_control_update') {
      title = 'Update website setting';
      fields = `${actionField('Setting name', 'action-control', payload.control_key)}
        <label class="field">Setting value<textarea id="action-value" maxlength="8000">${escapeHtml(JSON.stringify(payload.value || {}, null, 2))}</textarea></label>
        <label class="field"><span><input id="action-published" type="checkbox"${payload.is_published ? ' checked' : ''}> Make this setting active</span></label>`;
      warning = 'Only approved website settings can be changed here. Code, passwords, grading rules, and unsafe changes are blocked.';
    } else if (action === 'reveal_email') {
      title = 'Reveal exact Docket email';
      warning = 'Exact email access is limited to approved administrators, requires a reason, and is recorded.';
    } else if (action === 'find_email') {
      title = 'Find Docket by exact email';
      fields = actionField('Exact email', 'action-email', '', 'email');
      warning = 'Exact email search is limited to approved administrators, requires a reason, and is recorded.';
    } else if (action === 'user_response_export') {
      const today = new Date();
      const from = new Date(today.getTime() - (365 * 86_400_000));
      fields = `${actionField('From date', 'action-export-from', from.toISOString().slice(0, 10), 'date')}
        ${actionField('Through date (inclusive)', 'action-export-to', today.toISOString().slice(0, 10), 'date')}`;
      title = 'Download private questions and answers';
      warning = 'This founder-only download contains private student work. Use it only for an approved purpose, store it securely, and do not redistribute it. The reason and file scope are recorded.';
    } else if (action === 'global_beta_change') {
      title = payload.enabled ? 'Enable temporary safety access' : 'Activate commercial enforcement';
      warning = payload.enabled
        ? 'This immediately lets all signed-in users bypass commercial limits as a temporary rollback safeguard, subject to legal acceptance and security restrictions.'
        : 'This immediately ends the temporary override so introductory-token, Founding Beta, provisional, and verified Early Access rules apply. Confirm the effect before continuing.';
    } else if (action.startsWith('quorum_')) {
      const quorumAction = action.slice('quorum_'.length);
      const quorumTitles = {
        approve_announcement: 'Approve Community announcement',
        reject_announcement: 'Reject Community announcement',
        hide_entry: 'Hide Community entry',
        restore_entry: 'Restore Community entry',
        remove_entry: 'Remove Community entry',
        hide_comment: 'Hide Community comment',
        restore_comment: 'Restore Community comment',
        remove_comment: 'Remove Community comment',
        hide_circle: 'Hide Study Circle',
        restore_circle: 'Restore Study Circle',
        remove_circle: 'Remove Study Circle',
        lock_comments: 'Lock comments',
        unlock_comments: 'Unlock comments',
        dismiss_report: 'Dismiss Community report',
        restrict_user: 'Restrict Community publishing',
        remove_restriction: 'Remove Community restriction',
        verify_profile: 'Approve Verified Academic Identity',
        unverify_profile: 'Remove Verified Academic Identity',
        set_indicator: 'Apply credibility indicator',
      };
      title = quorumTitles[quorumAction] || 'Moderate Community';
      if (quorumAction === 'restrict_user') {
        fields = `<label class="field">Restriction period<select id="action-duration">
          <option value="1">1 hour</option>
          <option value="24" selected>24 hours</option>
          <option value="72">3 days</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
          <option value="8760">365 days</option>
        </select></label>`;
      }
      warning = ['restrict_user', 'remove_restriction'].includes(quorumAction)
        ? 'This changes only the member’s ability to publish in Community. Examination, subscription, and payment access remain unchanged.'
        : 'This Community action requires a reason and is recorded in Admin activity.';
    } else if (action.startsWith('forum_')) {
      const forumAction = action.slice('forum_'.length);
      const forumTitles = {
        hide_content: 'Hide reported forum content',
        restore_content: 'Restore reported forum content',
        remove_content: 'Remove reported forum content',
        dismiss_report: 'Dismiss forum report',
        restrict_user: 'Restrict forum publishing',
        remove_restriction: 'Remove forum publishing restriction',
      };
      title = forumTitles[forumAction] || 'Moderate legacy community record';
      if (forumAction === 'restrict_user') {
        fields = `<label class="field">Restriction period<select id="action-duration">
          <option value="1">1 hour</option>
          <option value="24" selected>24 hours</option>
          <option value="72">3 days</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
          <option value="8760">365 days</option>
        </select></label>`;
      }
      warning = forumAction === 'restrict_user' || forumAction === 'remove_restriction'
        ? 'This changes only the member’s legacy community publishing state. It does not change examination, subscription, or payment access.'
        : 'This changes a Community post’s visibility or review status and is recorded in Admin activity.';
    }
    $('#action-title').textContent = title;
    const isAccessAction = Boolean(subscriptionActions?.isAccessAction(action));
    const isPaymentReview = action === 'payment_review';
    const isSensitiveExport = action === 'user_response_export';
    const isGlobalBetaAction = action === 'global_beta_change';
    const isForumAction = action.startsWith('forum_') || action.startsWith('quorum_');
    if (isAccessAction) buildAccessActionFields(action, state.action.payload);
    else $('#action-fields').innerHTML = fields;
    $('#action-context').hidden = !isAccessAction;
    $('#action-confirmation').hidden = !(isAccessAction || isForumAction || isSensitiveExport || isGlobalBetaAction);
    $('#action-confirmation-copy').textContent = isGlobalBetaAction
      ? `I understand this will ${payload.enabled ? 'enable temporary safety access for' : 'activate commercial enforcement for'} all signed-in users and that the immediate change is recorded.`
      : isSensitiveExport
      ? 'I am authorized to access this student work and will handle the downloaded file securely. I understand this download is recorded.'
      : isForumAction
        ? 'I checked the report or content and the proposed moderation action. I understand this immediate action is recorded.'
        : 'I checked the user, current access, and proposed change. I understand this immediate action is recorded.';
    $('#action-confirm-risk').checked = false;
    $('#action-confirm').textContent = action === 'subscription_audit_view'
      ? 'View activity history'
      : isSensitiveExport
        ? 'Download answer records'
        : isPaymentReview && payload.approvalOnly === true ? 'Confirm'
          : isPaymentReview ? 'Approve subscription'
          : isForumAction ? 'Confirm moderation action' : 'Confirm action';
    $('#action-warning').textContent = warning;
    $('#action-reason').value = '';
    if (isAccessAction) updateActionContext();
    $('#action-dialog').showModal();
    if (isPaymentReview) {
      const decision = $('#action-status');
      const syncPaymentDecision = () => {
        const selected = payload.approvalOnly === true ? 'approved' : decision?.value || 'approved';
        const isApproval = selected === 'approved';
        $('#action-title').textContent = isApproval
          ? 'Approve subscription'
          : selected === 'rejected' ? 'Reject payment request' : 'Request payment information';
        $('#action-confirm').textContent = isApproval
          ? payload.approvalOnly === true ? 'Confirm' : 'Approve subscription'
          : selected === 'rejected' ? 'Reject request' : 'Request information';
        $('#action-warning').textContent = isApproval
          ? 'Confirming activates the verified Early Access term and emails the user an electronic receipt with the exact reviewed proof attached. No automatic charge or renewal is scheduled.'
          : selected === 'rejected'
            ? 'Rejecting revokes provisional access and records your reason. No receipt is sent.'
            : 'The request remains unapproved while the user provides the missing information. No receipt is sent.';
      };
      decision?.addEventListener('change', syncPaymentDecision);
      syncPaymentDecision();
    }
    if (history.state?.dueDiligenceAdminAction !== true) {
      history.pushState(
        { ...(history.state || {}), dueDiligenceAdminAction: true },
        '',
        location.href,
      );
    }
  }

  async function confirmAction(event) {
    event.preventDefault();
    if (!state.action || state.actionInFlight) return;
    const accessAction = Boolean(subscriptionActions?.isAccessAction(state.action.action));
    const forumAction = state.action.action.startsWith('forum_')
      || state.action.action.startsWith('quorum_');
    const sensitiveExport = state.action.action === 'user_response_export';
    const globalBetaAction = state.action.action === 'global_beta_change';
    if ((accessAction || forumAction || sensitiveExport || globalBetaAction) && !$('#action-confirm-risk').checked) {
      toast(forumAction
        ? 'Confirm that you verified the report and moderation action.'
        : globalBetaAction
          ? 'Confirm that you understand the platform-wide access impact.'
        : sensitiveExport
          ? 'Confirm that you are authorized to download this private student work.'
          : 'Confirm that you verified the target and proposed access change.');
      return;
    }
    const reason = $('#action-reason').value.trim();
    if (reason.length < 5) {
      toast('Enter a reason of at least five characters.');
      return;
    }
    const action = state.action.action;
    const payload = { ...state.action.payload };
    if (action === 'view_payment_proof' && payload.proofLoaded === true) {
      openAction('payment_review', state.action.targetId, {
        ...payload,
        approvalOnly: true,
        status: 'approved',
      });
      $('#action-reason').value = payload.proofReviewReason || reason;
      return;
    }
    if (action === 'support_update') {
      payload.status = $('#action-status').value;
      payload.priority = $('#action-priority').value;
      payload.internal_note = $('#action-note').value.trim();
    } else if (action === 'correction_review') {
      payload.status = $('#action-status').value;
      payload.reviewer_note = $('#action-note').value.trim();
    } else if (action === 'entitlement_change') {
      payload.plan_code = $('#action-plan').value.trim();
      payload.status = $('#action-status').value;
      payload.effective_until = $('#action-until').value.trim() || null;
      payload.entitlement_action = payload.status === 'paused' ? 'pause'
        : payload.status === 'canceled' ? 'cancel'
          : payload.status === 'expired' ? 'expire' : 'adjust';
    } else if (action === 'payment_review') {
      payload.status = payload.approvalOnly === true ? 'approved' : $('#action-status').value;
    } else if (action === 'refund_review') {
      payload.status = $('#action-status').value;
      payload.approvedRefundPhp = Number($('#action-refund-amount').value);
    } else if (action === 'subscription_change') {
      if (['activate', 'complimentary', 'replace_plan'].includes(payload.operation)) {
        payload.planCode = selectedPlan();
        if (!payload.planCode) {
          toast('Select an available plan.');
          return;
        }
        payload.expiresAt = EARLY_ACCESS_PLAN.expiresAt;
        if (payload.planCode !== EARLY_ACCESS_PLAN.id) {
          toast('Only the current Early Access plan may be assigned.');
          return;
        }
      }
      if (payload.operation === 'extend') {
        payload.durationDays = Number($('#action-days').value);
      } else if (payload.operation === 'set_start_date') {
        payload.startsAt = isoFromLocalInput($('#action-starts').value);
        if (!payload.startsAt) {
          toast('Select a valid Subscription start date.');
          return;
        }
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        payload.expiresAt = isoFromLocalInput($('#action-expires').value);
        if (!payload.expiresAt) {
          toast('Select a valid Subscription expiration date.');
          return;
        }
      }
    } else if (action === 'free_beta_change') {
      payload.enabled = payload.operation === 'enable';
      payload.expiresAt = payload.enabled
        ? isoFromLocalInput($('#action-expires')?.value) : null;
    } else if (action === 'discount_assign') {
      payload.code = $('#action-discount-code').value.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(payload.code)) {
        toast('Enter a valid active discount code.');
        return;
      }
    } else if (action === 'partnership_update') {
      payload.status = $('#action-status').value;
      payload.contactVerified = $('#action-contact-verified').checked;
      payload.assigneeUserId = $('#action-assignee').value.trim() || null;
    } else if (action === 'role_change') {
      payload.role = $('#action-role').value;
    } else if (action === 'website_control_update') {
      payload.control_key = $('#action-control').value;
      try { payload.value = JSON.parse($('#action-value').value); } catch {
        toast('Control value must be valid JSON.');
        return;
      }
      payload.is_published = $('#action-published').checked;
    } else if (action === 'forum_restrict_user' || action === 'quorum_restrict_user') {
      payload.durationHours = Number($('#action-duration').value);
    }
    state.action.requestKey ||= uuidKey();
    state.actionInFlight = true;
    $('#action-confirm').disabled = true;
    try {
      if (action === 'reveal_email') {
        const response = await api('/admin/reveal-email', {
          targetUserId: state.action.targetId,
          reason,
        });
        toast(`Authorized email: ${response.data.email}`);
      } else if (action === 'find_email') {
        const response = await api('/admin/find-email', {
          email: $('#action-email').value.trim(),
          reason,
        });
        toast(response.data.found
          ? `Match: ${response.data.display_name || 'Unnamed Docket'} (${response.data.masked_email})`
          : 'No Docket matched that exact email.');
      } else if (action === 'user_response_export') {
        const fromValue = $('#action-export-from').value;
        const toValue = $('#action-export-to').value;
        const from = new Date(`${fromValue}T00:00:00.000Z`);
        const through = new Date(`${toValue}T00:00:00.000Z`);
        const to = new Date(through.getTime() + 86_400_000);
        if (!fromValue || !toValue || !Number.isFinite(from.getTime())
            || !Number.isFinite(to.getTime()) || from >= to
            || to - from > 366 * 86_400_000) {
          toast('Select a valid date range of no more than 365 inclusive days.');
          return;
        }
        const response = await fetch(`${config.workerUrl}/admin/user-responses/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({
            targetUserId: state.action.targetId,
            reason,
            requestKey: state.action.requestKey,
            from: from.toISOString(),
            to: to.toISOString(),
          }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The private Q&A export could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `due-diligence-user-${state.action.targetId}-questions-answers.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Private questions-and-answers file downloaded and recorded.');
      } else if (action === 'global_beta_change') {
        await api('/admin/global-beta/change', {
          enabled: payload.enabled === true,
          reason,
          requestKey: state.action.requestKey,
          confirmed: true,
        });
        state.report = null;
        toast(payload.enabled
          ? 'Temporary safety access enabled for all signed-in users.'
          : 'Commercial access enforcement activated.');
      } else if (action === 'view_payment_proof') {
        const response = await api('/admin/payment-proof', {
          paymentRequestId: state.action.targetId,
          reason,
        });
        renderPrivatePaymentProof(response, reason);
        toast('Private proof loaded. The access reason was recorded.');
        return;
      } else if (action.startsWith('quorum_')) {
        const quorumAction = action.slice('quorum_'.length);
        const actionPayload = {
          action: quorumAction,
          reason,
          requestId: state.action.requestKey,
        };
        if (quorumAction === 'dismiss_report') {
          actionPayload.reportId = state.action.targetId;
        } else if (quorumAction === 'remove_restriction') {
          actionPayload.restrictionId = state.action.targetId;
        } else if (['restrict_user', 'verify_profile', 'unverify_profile'].includes(quorumAction)) {
          actionPayload.memberId = state.action.targetId;
        } else {
          actionPayload.targetId = state.action.targetId;
        }
        if (quorumAction === 'restrict_user') {
          actionPayload.durationHours = payload.durationHours;
        }
        if (quorumAction === 'set_indicator') {
          actionPayload.indicator = payload.indicator;
          actionPayload.enabled = payload.enabled;
        }
        await api('/admin/quorum', {
          operation: 'action',
          payload: actionPayload,
        });
        toast('Community moderation action completed and recorded.');
      } else if (action.startsWith('forum_')) {
        await api('/admin/forum/action', {
          action: action.slice('forum_'.length),
          targetId: state.action.targetId,
          reason,
          durationHours: payload.durationHours || null,
          requestId: state.action.requestKey,
        });
        toast('Community moderation action completed and recorded.');
      } else {
        const phase4Actions = new Set([
          'payment_review','refund_review','subscription_change',
          'free_beta_change','partnership_update','provider_incident_clear',
          'role_change','discount_assign','subscription_audit_view',
        ]);
        const actionRequest = {
          action,
          targetId: state.action.targetId,
          payload,
          reason,
          requestKey: state.action.requestKey,
        };
        let response;
        if (phase4Actions.has(action)) {
          response = await api('/admin/phase4-action', actionRequest);
        } else response = await api('/admin/action', actionRequest);
        if (action === 'subscription_audit_view') {
          renderAuditHistory(response.data, payload);
          toast('Access history loaded and recorded.');
        } else if (action === 'payment_review') {
          const receiptStatus = response?.data?.subscriberReceipt?.status;
          if (payload.status === 'approved' && receiptStatus === 'sent') {
            toast('Subscription approved. The electronic receipt and reviewed proof were emailed to the user.');
          } else if (payload.status === 'approved') {
            toast('Subscription approved, but receipt delivery needs administrator attention.');
          } else {
            toast('Payment decision recorded. No subscriber receipt was sent.');
          }
        } else {
          toast('Access change completed, recorded, and refreshed.');
        }
      }
      cancelActionDialog();
      state.operational.clear();
      if (action.startsWith('quorum_')) state.quorumPosts = null;
      if (['subscription_change', 'free_beta_change', 'global_beta_change'].includes(action)) {
        state.report = null;
      }
      await renderSection(state.section);
    } catch (error) {
      toast(error.message || 'Action failed without changing production data.');
    } finally {
      state.actionInFlight = false;
      $('#action-confirm').disabled = false;
    }
  }

  function updateScenario() {
    const visitors = Math.max(0, Number($('#scenario-visitors')?.value) || 0);
    const rate = Math.min(100, Math.max(0, Number($('#scenario-rate')?.value) || 0));
    const price = Math.max(0, Number($('#scenario-price')?.value) || 0);
    const assumedCustomers = Math.round(visitors * rate / 100);
    const gross = assumedCustomers * price;
    const perThousand = visitors > 0 ? (gross / visitors) * 1000 : 0;
    const lowRate = rate * 0.75;
    const highRate = Math.min(100, rate * 1.25);
    const lowCustomers = Math.round(visitors * lowRate / 100);
    const highCustomers = Math.round(visitors * highRate / 100);
    const lowGross = lowCustomers * price;
    const highGross = highCustomers * price;
    if ($('#scenario-customers')) $('#scenario-customers').textContent = number(assumedCustomers);
    if ($('#scenario-gross')) $('#scenario-gross').textContent = `₱${number(gross, 2)}`;
    if ($('#scenario-rpm')) $('#scenario-rpm').textContent = `₱${number(perThousand, 2)}`;
    if ($('#scenario-low-customers')) $('#scenario-low-customers').textContent = `${number(lowCustomers)} customers`;
    if ($('#scenario-low-gross')) $('#scenario-low-gross').textContent = `₱${number(lowGross, 2)}`;
    if ($('#scenario-high-customers')) $('#scenario-high-customers').textContent = `${number(highCustomers)} customers`;
    if ($('#scenario-high-gross')) $('#scenario-high-gross').textContent = `₱${number(highGross, 2)}`;
    if ($('#scenario-output')) $('#scenario-output').textContent = `Planning estimate only: ${number(assumedCustomers)} assumed customers × ₱${number(price, 2)}. This is not actual or forecast-guaranteed revenue.`;
  }

  function bindAdminActionButtons(root = document) {
    $$('[data-admin-action]', root).forEach((button) => {
      if (button.dataset.adminActionBound === 'true') return;
      button.dataset.adminActionBound = 'true';
      button.addEventListener('click', () => {
        let payload = {};
        try { payload = JSON.parse(button.dataset.payload || '{}'); } catch { payload = {}; }
        openAction(button.dataset.adminAction, button.dataset.target, payload);
      });
    });
  }

  function bindUserAnswerButtons(root = document) {
    $$('[data-view-user-answers]', root).forEach((button) => {
      if (button.dataset.userAnswersBound === 'true') return;
      button.dataset.userAnswersBound = 'true';
      button.addEventListener('click', async () => {
        state.answerSearch = button.dataset.userEmail || '';
        state.answerFeature = 'all';
        state.answerOffset = 0;
        state.answerHistory = null;
        await renderSection('answer_exports');
      });
    });
  }

  function normalizedTableSortValue(rawValue) {
    const text = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!text || /^not (available|provided|granted)$/i.test(text)) return { type: 'empty', value: '' };
    const numberCandidate = text
      .replace(/[₱,$,%]/g, '')
      .replace(/\b(remaining|average|latest|requests?|sessions?|users?)\b/gi, '')
      .trim();
    if (/^-?\d+(?:\.\d+)?$/.test(numberCandidate)) {
      return { type: 'number', value: Number(numberCandidate) };
    }
    if (/\d{4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text)) {
      const timestamp = Date.parse(text);
      if (Number.isFinite(timestamp)) return { type: 'number', value: timestamp };
    }
    return { type: 'text', value: text.toLocaleLowerCase('en-PH') };
  }

  function bindSortableTables(root = document) {
    $$('.table-sort', root).forEach((button) => {
      if (button.dataset.tableSortBound === 'true') return;
      button.dataset.tableSortBound = 'true';
      button.addEventListener('click', () => {
        const tableElement = button.closest('table');
        const body = tableElement?.tBodies?.[0];
        if (!body) return;
        const index = Number(button.dataset.tableSortIndex);
        const header = button.closest('th');
        const nextDirection = header?.getAttribute('aria-sort') === 'ascending'
          ? 'descending'
          : 'ascending';
        [...tableElement.querySelectorAll('thead th')].forEach((cell) => cell.setAttribute('aria-sort', 'none'));
        header?.setAttribute('aria-sort', nextDirection);
        [...tableElement.querySelectorAll('.table-sort i')].forEach((icon) => {
          icon.className = 'ph ph-caret-up-down';
        });
        const icon = button.querySelector('i');
        if (icon) icon.className = `ph ${nextDirection === 'ascending' ? 'ph-caret-up' : 'ph-caret-down'}`;
        const rows = [...body.rows].filter((row) => row.cells.length > index && !row.cells[0]?.hasAttribute('colspan'));
        rows.forEach((row, originalIndex) => {
          if (!row.dataset.originalSortIndex) row.dataset.originalSortIndex = String(originalIndex);
        });
        rows.sort((left, right) => {
          const leftValue = normalizedTableSortValue(left.cells[index]?.dataset.sortValue || left.cells[index]?.textContent);
          const rightValue = normalizedTableSortValue(right.cells[index]?.dataset.sortValue || right.cells[index]?.textContent);
          if (leftValue.type === 'empty' && rightValue.type !== 'empty') return 1;
          if (rightValue.type === 'empty' && leftValue.type !== 'empty') return -1;
          let comparison = 0;
          if (leftValue.type === 'number' && rightValue.type === 'number') comparison = leftValue.value - rightValue.value;
          else comparison = String(leftValue.value).localeCompare(String(rightValue.value), 'en-PH', { numeric: true, sensitivity: 'base' });
          if (!comparison) comparison = Number(left.dataset.originalSortIndex) - Number(right.dataset.originalSortIndex);
          return nextDirection === 'ascending' ? comparison : -comparison;
        });
        rows.forEach((row) => body.append(row));
      });
    });
  }

  async function appendRecentUserActivityPage() {
    if (state.section !== 'recent_users'
        || state.recentUserLoading
        || state.recentUserOffset >= state.recentUserTotal) return;
    const button = $('#recent-users-load-more');
    const progress = $('#recent-user-activity-progress');
    const body = $('#recent-user-activity-body');
    if (!body) return;

    state.recentUserLoading = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading sessions…';
    }
    try {
      const data = await loadRecentUserActivity(
        false,
        state.recentUserSearch,
        state.recentUserOffset,
      );
      const items = Array.isArray(data.items) ? data.items : [];
      state.recentUserTotal = Number(data.total || state.recentUserTotal || 0);
      if (!items.length) {
        if (progress) progress.textContent = `Showing ${number(state.recentUserOffset)} of ${number(state.recentUserTotal)} matching session(s). No additional records were returned.`;
        if (button) button.hidden = true;
        state.recentUserObserver?.disconnect();
        return;
      }
      body.insertAdjacentHTML('beforeend', recentUserActivityRowsHtml(items));
      state.recentUserOffset += items.length;
      const hasMore = state.recentUserOffset < state.recentUserTotal;
      if (progress) progress.textContent = hasMore
        ? `Showing ${number(state.recentUserOffset)} of ${number(state.recentUserTotal)} matching session(s). More sessions load as you scroll.`
        : `Showing all ${number(state.recentUserTotal)} matching session(s).`;
      if (button) button.hidden = !hasMore;
      if (!hasMore) state.recentUserObserver?.disconnect();
    } catch (error) {
      toast(error.message || 'More recent activity could not be loaded.');
    } finally {
      state.recentUserLoading = false;
      if (button && !button.hidden) {
        button.disabled = false;
        button.textContent = 'Load more sessions';
      }
    }
  }

  async function appendUserDirectoryPage() {
    if (state.section !== 'users'
        || state.userDirectoryLoading
        || state.userOffset >= state.userTotal) return;
    const button = $('#users-load-more');
    const progress = $('#user-directory-progress');
    const body = $('#user-directory-body');
    if (!body) return;

    state.userDirectoryLoading = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading users…';
    }
    try {
      const startOffset = state.userOffset;
      const data = await loadUserDirectory(false, state.userSearch, startOffset);
      const items = Array.isArray(data.items) ? data.items : [];
      state.userTotal = Number(data.total || state.userTotal || 0);
      if (!items.length) {
        if (progress) progress.textContent = `Showing ${number(state.userOffset)} of ${number(state.userTotal)} matching account(s). No additional records were returned.`;
        if (button) button.hidden = true;
        state.userDirectoryObserver?.disconnect();
        return;
      }

      if (startOffset === 0) body.replaceChildren();
      const template = document.createElement('template');
      template.innerHTML = userDirectoryRowsHtml(
        items,
        ['founder_admin', 'super_admin'].includes(state.authorization?.role),
      );
      const fragment = template.content;
      bindAdminActionButtons(fragment);
      bindUserAnswerButtons(fragment);
      body.append(fragment);
      state.userOffset += items.length;

      const hasMore = state.userOffset < state.userTotal;
      if (progress) progress.textContent = hasMore
        ? `Showing ${number(state.userOffset)} of ${number(state.userTotal)} matching account(s). More users load as you scroll.`
        : `Showing all ${number(state.userTotal)} matching account(s).`;
      if (button) button.hidden = !hasMore;
      if (!hasMore) state.userDirectoryObserver?.disconnect();
    } catch (error) {
      if (progress) progress.textContent = `Showing ${number(state.userOffset)} of ${number(state.userTotal)} matching account(s).`;
      toast(error.message || 'More users could not be loaded. You can retry without losing the current list.');
    } finally {
      state.userDirectoryLoading = false;
      if (button && !button.hidden) {
        button.disabled = false;
        button.textContent = 'Load more users';
      }
    }
  }

  function bindDynamic() {
    mountSubscriptionActions();
    bindSortableTables();
    $$('[data-insight]').forEach((button) => button.addEventListener('click', () => openInsight(button)));
    $$('[data-admin-section]').forEach((button) => button.addEventListener('click', () => {
      const section = button.dataset.adminSection;
      if (sectionAllowed(section)) renderSection(section);
      else toast('Your administrator role does not have access to that section.');
    }));
    bindAdminActionButtons();
    $('#recent-user-search-button')?.addEventListener('click', async () => {
      state.recentUserSearch = $('#recent-user-search')?.value?.trim() || '';
      state.recentUserOffset = 0;
      state.recentUserActivity = null;
      await loadRecentUserActivity(true, state.recentUserSearch, 0);
      await renderSection('recent_users');
    });
    $('#recent-users-load-more')?.addEventListener('click', appendRecentUserActivityPage);
    const recentActivitySentinel = $('#recent-user-activity-sentinel');
    if (recentActivitySentinel && 'IntersectionObserver' in global
        && state.recentUserOffset < state.recentUserTotal) {
      state.recentUserObserver?.disconnect();
      state.recentUserObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) appendRecentUserActivityPage();
      }, { rootMargin: '600px 0px' });
      state.recentUserObserver.observe(recentActivitySentinel);
    }
    $('#user-search-button')?.addEventListener('click', async () => {
      const search = $('#user-search').value.trim();
      $('#dashboard-view').innerHTML = '<div class="skeleton"></div>';
      try {
        state.userSearch = search;
        state.userOffset = 0;
        await loadUserDirectory(true, search);
        await renderSection('users');
      } catch (error) { toast(error.message); }
    });
    bindUserAnswerButtons();
    $('#users-load-more')?.addEventListener('click', appendUserDirectoryPage);
    const directorySentinel = $('#user-directory-sentinel');
    if (directorySentinel && 'IntersectionObserver' in global && state.userOffset < state.userTotal) {
      state.userDirectoryObserver?.disconnect();
      state.userDirectoryObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) appendUserDirectoryPage();
      }, { rootMargin: '600px 0px' });
      state.userDirectoryObserver.observe(directorySentinel);
    }
    $('#download-live-activity')?.addEventListener('click', () => {
      downloadCsv('due-diligence-activity-summary.csv', [
        'Measure', 'Value', 'Meaning', 'Generated at',
      ], [
        ['Activity in the last 5 minutes', state.liveActivity?.activeSignedInLast5Minutes, 'Approximate signed-in-session records; not exact people online', state.liveActivity?.generatedAt],
        ['Activity in the last 30 minutes', state.liveActivity?.activeSignedInLast30Minutes, 'Approximate signed-in-session records; may include stale sessions', state.liveActivity?.generatedAt],
      ]);
      toast('Activity summary downloaded for Google Sheets.');
    });
    $('#answer-filter-button')?.addEventListener('click', async () => {
      state.answerSearch = $('#answer-search')?.value?.trim() || '';
      state.answerFeature = $('#answer-feature')?.value || 'all';
      state.answerOffset = 0;
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#answers-previous')?.addEventListener('click', async () => {
      state.answerOffset = Math.max(0, state.answerOffset - 100);
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#answers-next')?.addEventListener('click', async () => {
      state.answerOffset += 100;
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#download-answer-view')?.addEventListener('click', () => {
      const rows = currentAnswerHistoryItems().map((item) => [
        item.userDisplayName,
        item.userEmail,
        item.subscriptionCategory,
        answerFeatureLabel(item),
        item.subject,
        item.examTitle,
        item.questionText,
        item.questionTextSource,
        item.questionTextStatus,
        item.submittedAnswer,
        item.score,
        item.feedbackText,
        item.suggestedAnswer,
        item.suggestedAnswerSource,
        item.suggestedAnswerStatus,
        item.modelAnswer,
        item.modelAnswerSource,
        item.modelAnswerStatus,
        (item.resultSources || []).map((source) => source.url).filter(Boolean).join('\n'),
        (item.questionSourceLinks || []).map((source) => source.url).filter(Boolean).join('\n'),
        item.submittedAt || item.answerSavedAt || item.completedAt,
      ]);
      downloadCsv('due-diligence-answer-records-current-view.csv', [
        'Name', 'Email', 'Subscription', 'Feature', 'Subject', 'Exam', 'Question',
        'Question source', 'Question availability', 'Student answer', 'Score', 'Feedback',
        'Suggested answer', 'Suggested answer source', 'Suggested answer availability',
        'Model answer', 'Model answer source', 'Model answer availability',
        'Sources shown with result', 'Question reference links', 'Submitted',
      ], rows);
      toast('Current answer view downloaded for Google Sheets.');
    });
    $('#subscription-search-button')?.addEventListener('click', async () => {
      state.subscriptionSearch = $('#subscription-search')?.value?.trim() || '';
      state.subscriptionOffset = 0;
      await renderSection('subscriptions');
    });
    $('#paid-subscriber-search-button')?.addEventListener('click', async () => {
      state.paidSubscriberSearch = $('#paid-subscriber-search')?.value?.trim() || '';
      await renderSection('paid_subscribers');
    });
    $('#paid-subscriber-search')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $('#paid-subscriber-search-button')?.click();
    });
    $('#download-paid-subscribers')?.addEventListener('click', () => {
      downloadCsv('due-diligence-paid-subscribers.csv', [
        'Name', 'Email', 'School', 'Plan', 'Payment state', 'Access state', 'Amount PHP',
        'Payment recorded', 'Access starts', 'Access expires', 'Expiry attention', 'Last sign-in',
      ], state.paidSubscriberRows.map(({ account, payment }) => {
        const paidState = paidSubscriberState(account, payment);
        const accessState = paidSubscriberAccessState(account, payment);
        const expiry = paidSubscriberExpiry(account, payment);
        return [
          account.display_name || 'Not provided', account.email || 'Not available',
          account.school || 'Not provided', commercialPlanLabel(account.subscription_plan || payment?.plan_code),
          paidState.label, accessState.label,
          payment?.trusted_amount_php == null ? '' : number(payment.trusted_amount_php, 2),
          payment?.submitted_at || account.subscription_starts_at || '',
          account.subscription_starts_at || payment?.submitted_at || '', expiry || '',
          paidSubscriberExpiryAlert(expiry).label, account.last_sign_in_at || '',
        ];
      }));
      toast('Paid subscriber ledger downloaded for Google Sheets.');
    });
    $('#subscriptions-previous')?.addEventListener('click', async () => {
      state.subscriptionOffset = Math.max(0, state.subscriptionOffset - 100);
      await renderSection('subscriptions');
    });
    $('#subscriptions-next')?.addEventListener('click', async () => {
      state.subscriptionOffset += 100;
      await renderSection('subscriptions');
    });
    $('#download-subscriptions')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/subscriptions/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({ search: state.subscriptionSearch, requestKey: uuidKey() }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The subscription list could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-subscriptions.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
        toast('Subscriptions downloaded for Google Sheets.');
      } catch (error) { toast(error.message); }
    });
    $('#quorum-post-filter')?.addEventListener('click', async () => {
      state.quorumPostSearch = $('#quorum-post-search')?.value?.trim() || '';
      state.quorumPostStatus = $('#quorum-post-status')?.value || 'all';
      state.quorumPostOffset = 0;
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#quorum-post-previous')?.addEventListener('click', async () => {
      state.quorumPostOffset = Math.max(0, state.quorumPostOffset - 100);
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#quorum-post-next')?.addEventListener('click', async () => {
      state.quorumPostOffset += 100;
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#download-quorum-posts')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const items = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const payload = await api('/admin/quorum/posts', {
            search: state.quorumPostSearch,
            status: state.quorumPostStatus,
            limit: 100,
            offset,
            requestKey: uuidKey(),
          });
          const page = Array.isArray(payload.data?.items) ? payload.data.items : [];
          items.push(...page);
          hasMore = payload.data?.hasMore === true;
          offset += page.length;
          if (hasMore && (items.length >= 5000 || page.length === 0)) {
            throw new Error('More than 5,000 Community posts match. Narrow the search or status before downloading.');
          }
        }
        const rows = items.map((row) => [
          row.created_at,
          row.author_name,
          row.author_email,
          row.entry_type,
          row.subject || row.category,
          row.body,
          row.content_status,
          row.comment_count,
          row.report_count,
        ]);
        downloadCsv('due-diligence-quorum-posts.csv', [
          'Posted', 'Name', 'Email', 'Type', 'Topic', 'Post', 'Status', 'Comments', 'Reports',
        ], rows);
        toast('All matching Community posts downloaded for Google Sheets.');
      } catch (error) {
        toast(error.message || 'The Community post file could not be created.');
      } finally {
        button.disabled = false;
      }
    });
    $('#user-directory-export')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/user-directory/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({ search: state.userSearch, requestKey: uuidKey() }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The user list could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-users.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('User list downloaded for Google Sheets.');
      } catch (error) { toast(error.message); }
    });
    $('#user-directory-email-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const recipientKey = $('#user-directory-email-recipient')?.value || '';
      const reason = $('#user-directory-email-reason')?.value?.trim() || '';
      const confirmed = $('#user-directory-email-confirm')?.checked === true;
      if (!recipientKey || reason.length < 5 || !confirmed) {
        toast('Select a founder, provide a reason, and confirm that you are allowed to send the list.');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await api('/admin/user-directory/email', {
          search: state.userSearch,
          recipientKey,
          reason,
          requestKey: uuidKey(),
          confirmed: true,
        });
        toast(result.delivery?.status === 'sent'
          ? 'User list sent to the selected founder.'
          : `Email delivery status: ${result.delivery?.status || 'not confirmed'}.`);
        form.reset();
      } catch (error) {
        toast(error.message || 'The user list could not be sent.');
      } finally {
        button.disabled = false;
      }
    });
    $('#answer-history-export-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const reason = $('#answer-history-reason')?.value?.trim() || '';
      const confirmed = $('#answer-history-confirm')?.checked === true;
      const fromValue = $('#answer-history-from')?.value || '';
      const toValue = $('#answer-history-to')?.value || '';
      if (reason.length < 5 || !confirmed) {
        toast('Provide a reason and confirm that you are allowed to download private student work.');
        return;
      }
      if (Boolean(fromValue) !== Boolean(toValue)) {
        toast('Choose both dates or leave both blank to export the complete history.');
        return;
      }
      const from = fromValue ? new Date(`${fromValue}T00:00:00.000Z`) : null;
      const through = toValue ? new Date(`${toValue}T00:00:00.000Z`) : null;
      const to = through ? new Date(through.getTime() + 86_400_000) : null;
      if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))
          || (from && to && from >= to)) {
        toast('Select a valid answer-history date range.');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/answer-history/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({
            from: from?.toISOString() || null,
            to: to?.toISOString() || null,
            reason,
            requestKey: uuidKey(),
            confirmed: true,
          }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The complete answer-history export could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-all-answer-history.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Answer-history file downloaded for Google Sheets and recorded.');
      } catch (error) {
        toast(error.message || 'The complete answer-history export could not be created.');
      } finally {
        button.disabled = false;
      }
    });
    $('#print-report')?.addEventListener('click', () => global.print());
    $('#export-report')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify(reportingWindow()),
        });
        if (!response.ok) throw new Error('Dashboard summary could not be created.');
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-aggregate-report.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) { toast(error.message); }
    });
    ['scenario-visitors', 'scenario-rate', 'scenario-price'].forEach((id) => {
      $(`#${id}`)?.addEventListener('input', updateScenario);
    });
    if ($('#scenario-output')) updateScenario();
  }

  function applyNavigationAuthorization() {
    $$('#admin-nav button').forEach((button) => {
      button.hidden = !sectionAllowed(button.dataset.section);
    });
  }

  function deny(message) {
    $('#admin-gate').hidden = false;
    $('#admin-shell').hidden = true;
    $('#gate-title').textContent = 'Administrator access unavailable';
    $('#gate-copy').textContent = message;
    $('#gate-spinner').hidden = true;
    $('#gate-action').hidden = false;
  }

  async function initialize() {
    const demoMode = global.ExaminationRoomV1Api?.demoEnabled?.() === true;
    if (demoMode) {
      state.session = {
        access_token: 'local-demonstration',
        user: { id: 'local-founder-admin', email: 'founder@local.demo', user_metadata: { full_name: 'Founder Admin' } },
      };
      state.authorization = {
        role: 'super_admin',
        capabilities: Object.values(requirements).filter(Boolean),
      };
      $('#admin-gate').hidden = true;
      $('#admin-shell').hidden = false;
      if ($('#admin-dock-name')) $('#admin-dock-name').textContent = 'Founder Admin';
      if ($('#admin-dock-role')) $('#admin-dock-role').textContent = 'Local demonstration';
      applyNavigationAuthorization();
      const requested = global.location.hash.replace(/^#/, '');
      await renderSection(titles[requested] ? requested : 'examination_room_v1');
      return;
    }
    if (!config?.features?.adminDashboard
        || !global.supabase?.createClient
        || !subscriptionActions?.actionsForSubscription) {
      deny('The Admin dashboard is not configured.');
      return;
    }
    const authStorage = global.DueDiligenceAuthSessionStorage?.prepare?.(config.supabase.url)
      || global.localStorage
      || global.sessionStorage;
    state.client = global.supabase.createClient(config.supabase.url, config.supabase.publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: authStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session || null;
      if (event === 'SIGNED_OUT' && !$('#admin-shell').hidden) {
        deny('Your administrator session ended. Sign in again through Due Diligence, then return here.');
      }
    });
    const { data, error } = await state.client.auth.getSession();
    if (error || !data?.session?.access_token) {
      deny('Sign in through Due Diligence with a verified administrator account, then return here.');
      return;
    }
    state.session = data.session;
    try {
      const payload = await api('/admin/session');
      state.authorization = payload;
    } catch (error) {
      deny(error.message || 'This account is not authorized for administration.');
      return;
    }
    $('#admin-gate').hidden = true;
    $('#admin-shell').hidden = false;
    const sessionUser = state.session?.user || {};
    const accountName = sessionUser.user_metadata?.full_name
      || sessionUser.user_metadata?.name
      || sessionUser.email
      || 'Administrator';
    if ($('#admin-dock-name')) $('#admin-dock-name').textContent = accountName;
    if ($('#admin-dock-role')) $('#admin-dock-role').textContent = humanizeAuditValue(state.authorization?.role || 'administrator');
    applyNavigationAuthorization();
    const overviewReady = await renderSection('executive');
    if (!overviewReady && sectionAllowed('payments')) {
      const paymentsReady = await renderSection('payments');
      if (paymentsReady) {
        toast('Overview is temporarily unavailable. Payments remains available.');
      }
    }
  }

  $('#admin-nav')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-section]');
    if (button && !button.hidden && sectionAllowed(button.dataset.section)) {
      renderSection(button.dataset.section);
      global.history.replaceState(null, '', `${global.location.pathname}${global.location.search}#${button.dataset.section}`);
    }
  });
  $('#date-range')?.addEventListener('change', async () => {
    state.report = null;
    state.operational.clear();
    await renderSection(state.section);
  });
  $('#refresh-dashboard')?.addEventListener('click', async () => {
    const button = $('#refresh-dashboard');
    button.disabled = true;
    button.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i><span>Refreshing…</span>';
    state.report = null;
    state.operational.clear();
    state.liveActivity = null;
    state.recentUserActivity = null;
    state.answerHistory = null;
    state.quorumPosts = null;
    try {
      await renderSection(state.section);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="ph ph-arrows-clockwise" aria-hidden="true"></i><span>Refresh</span>';
    }
  });
  $('#download-current-section')?.addEventListener('click', downloadCurrentSection);
  $('#menu-button')?.addEventListener('click', () => {
    setSidebarOpen(!$('#sidebar').classList.contains('open'));
  });
  $('#sidebar-collapse')?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('admin-sidebar-collapsed');
    const button = $('#sidebar-collapse');
    button?.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    const icon = button?.querySelector('i');
    if (icon) icon.className = `ph ${collapsed ? 'ph-caret-double-right' : 'ph-caret-double-left'}`;
  });
  $('#sidebar-scrim')?.addEventListener('click', () => setSidebarOpen(false));
  global.matchMedia?.('(max-width: 820px)')?.addEventListener?.('change', () => setSidebarOpen(false));
  $('#admin-signout')?.addEventListener('click', async () => {
    await state.client?.auth.signOut();
    global.DueDiligencePrivateBeta?.clear?.();
    location.replace('../');
  });
  $('#action-form')?.addEventListener('submit', confirmAction);
  $('#action-dialog-close')?.addEventListener('click', () => cancelActionDialog());
  $('#action-dialog-cancel')?.addEventListener('click', () => cancelActionDialog());
  $('#action-dialog')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelActionDialog();
  });
  $('#action-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) cancelActionDialog();
  });
  $('#insight-dialog-close')?.addEventListener('click', closeInsight);
  $('#insight-dialog-dismiss')?.addEventListener('click', closeInsight);
  $('#insight-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeInsight();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#sidebar')?.classList.contains('open')) {
      setSidebarOpen(false);
    }
  });
  global.addEventListener('popstate', () => {
    if ($('#action-dialog')?.open) cancelActionDialog({ consumeHistory: false });
  });

  initialize().catch(() => deny('The Admin dashboard could not open. Nothing was changed.'));
})(window);
